// GET /status used to materialise its complete ~8.7 KiB body in one growing std::string. libstdc++'s
// capacity growth then asked the fragmented INTERNAL heap for roughly 15 KiB contiguously while
// OTA/weather TLS was live, and the shared OOM guard returned 503. Pin the production route to the
// same host-tested 1 KiB sink as /values; MCP get_status streams its small JSON-RPC framing around
// that same serializer instead of restoring a whole-body allocation.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const status = read("main/http_status.cpp");
const sink = read("main/logic/chunk_sink.hpp");
const heartbeat = read("main/logic/heartbeat.hpp");

assert.match(status,
  /template <typename JsonOut>\s*\nstatic void append_status_json\(JsonOut& j, bool redact\)/,
  "the status serializer must accept both owning and bounded output sinks");
assert.match(status,
  /using HttpJsonChunks = BoundedChunkSink<HttpChunkEmitter, 1024>;/,
  "HTTP JSON responses must keep a strict 1 KiB contiguous transport bound");
assert.match(status,
  /esp_err_t http_send_status_json\([\s\S]*?HttpJsonChunks chunks\(HttpChunkEmitter\{req\}\);[\s\S]*?out \+= prefix;[\s\S]*?append_status_json\(out, redact\);[\s\S]*?out \+= suffix;/,
  "the shared status sender must stream a protocol prefix + status + suffix through one sink");

const routeStart = status.indexOf("static esp_err_t h_status(httpd_req_t* req)");
const routeEnd = status.indexOf("\n}\n\nstruct ValuesSnapshot", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart,
  "the contract must isolate GET /status from the following values implementation");
const route = status.slice(routeStart, routeEnd);
assert.match(route, /return http_send_status_json\(req, \{\}, \{\}, redact\);/,
  "GET /status must use the shared bounded status sender");
assert.doesNotMatch(route, /std::string\s+j\b|http_append_status_json\(j|http_send_json\(/,
  "GET /status must never restore a whole-body owning string");

assert.doesNotMatch(status, /void http_append_status_json\(std::string&/,
  "status must not retain an owning compatibility wrapper");
assert.match(sink,
  /while \(!value\.empty\(\)\)[\s\S]*?const size_t take = std::min\(available, value\.size\(\)\)[\s\S]*?value\.remove_prefix\(take\)/,
  "one large append must be split before the production buffer can exceed its bound");
assert.match(sink,
  /emission_started_ = true;[\s\S]*?emit_\([\s\S]*?if \(!sink\.emission_started\(\)\) throw;[\s\S]*?return false;/,
  "a serializer exception must remain a clean 503 before commit and abort the response after commit");
assert.match(heartbeat,
  /template <typename JsonOut>\s+inline void append_stack_bytes\(JsonOut& j, uint32_t bytes\)/,
  "status helpers used by the streamed instantiation must not force an owning std::string");

console.log("status heap contract: GET /status and MCP get_status use one bounded streamed serializer");
