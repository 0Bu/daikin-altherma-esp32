// Execute real HTTP startup/common trampoline/MCP TUs with SDK-shaped transport adapters.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test/http_server_runtime");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-http-server-runtime-"));
const sanitizer = process.argv.includes("--sanitizer=undefined");
const sourcePaths = {
  common: "main/http_common.cpp", server: "main/http_server.cpp", mcp: "main/mcp_server.cpp",
  mcpLogic: "main/logic/mcp.hpp", request: "main/logic/http_request.hpp",
  statusRoutes: "main/http_status.cpp", configRoutes: "main/http_config.cpp", otaRoutes: "main/http_ota.cpp",
};
const sources = Object.fromEntries(Object.entries(sourcePaths).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), "utf8")]));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commands = [];
function execute(command, args, requireSuccess = true) {
  commands.push([command, ...args]);
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000, cwd: root });
  if (requireSuccess) assert.equal(result.status, 0, `${command}: ${result.error || ""}\n${result.stdout}${result.stderr}`);
  return result;
}
function registration(source, name) {
  const match = source.match(new RegExp(`void ${name}\\([^]*?\\n}`, "m"));
  assert.ok(match, `production registration function ${name} missing`);
  // These registration bodies are copied verbatim; only service bodies are mocked below.
  return match[0];
}
const routeFunctions = [registration(sources.statusRoutes, "http_register_status"),
  registration(sources.configRoutes, "http_register_config"), registration(sources.otaRoutes, "http_register_ota"),
  registration(sources.statusRoutes, "http_register_captive")];
const serviceNames = [...new Set([...routeFunctions.join("\n").matchAll(/http_register(?:_on)?\([^;]+,\s*(\w+)\);/g)].map(match => match[1]))];
const routeGroupPath = path.join(temporary, "production-route-groups.cpp");
fs.writeFileSync(routeGroupPath, `namespace daik {\n${serviceNames.map(name =>
  `static esp_err_t ${name}(httpd_req_t* req) { return fixture::handler(req, "${name}"); }`).join("\n")}\n${routeFunctions.join("\n")}\n}\n`);
const sanitizers = sanitizer ? ["-fsanitize=undefined", "-fno-sanitize-recover=all"] : [];
const flags = ["-std=c++20", "-O0", "-g", "-Wall", "-Wextra", "-Wno-unused-parameter",
  ...sanitizers, "-DCONFIG_DAIKIN_HOSTNAME=\"daikin-altherma-esp32\"",
  `-I${path.join(fixture,"stubs")}`, `-I${path.join(root,"main")}`];
const cxx = process.env.CXX || "c++";
const mutations = [
  { name: "empty-header-treated-absent", file: "common", scenario: "lan_header_policy",
    before: /present\s*= result != ESP_ERR_NOT_FOUND;/, after: "present = len != 0;" },
  { name: "empty-version-treated-absent", file: "mcp", scenario: "protocol_header_guard",
    before: "const bool version_present = version_result != ESP_ERR_NOT_FOUND;",
    after: "const bool version_present = version_len != 0;" },
  { name: "host-policy-bypass", file: "common", scenario: "lan_header_policy",
    before: "!provisioning_ap_active() && !trusted_lan_headers_allowed(req)", after: "false" },
  { name: "media-policy-bypass", file: "common", scenario: "post_media_policy",
    before: "if (!json_post_allowed(req))", after: "if (false)" },
  { name: "busy-post-bypass", file: "common", scenario: "ota_exact_route_guard",
    before: "req->method == HTTP_POST && ota_busy()", after: "false" },
  { name: "heap-policy-bypass", file: "common", scenario: "ota_exact_route_guard",
    before: "heap_largest_internal_block() < 6144", after: "false" },
  { name: "ap-ota-exemption", file: "common", scenario: "ota_exact_route_guard",
    before: /const bool ota_route\s*=\s*!provisioning_ap_active\(\) &&\s*/, after: "const bool ota_route = " },
  { name: "registration-failure-silenced", file: "common", scenario: "startup_and_registration_failures",
    before: 'if (err != ESP_OK) diag_printf', after: 'if (false) diag_printf' },
  { name: "unread-body-settlement-bypass", file: "common", scenario: "unread_body_bound",
    before: "return discard_unread_body(req) ? ESP_OK : ESP_FAIL;", after: "return ESP_OK;" },
  { name: "oom-response-regression", file: "common", scenario: "exception_boundary",
    before: 'httpd_resp_sendstr(req, "out of memory")', after: 'httpd_resp_sendstr(req, "handler error")' },
  { name: "route-capacity-regression", file: "server", scenario: "registration_oracle",
    before: "cfg.max_uri_handlers = 39;", after: "cfg.max_uri_handlers = 38;" },
  { name: "open-ap-mcp-exposure", file: "mcp", scenario: "registration_oracle",
    before: 'http_register_on(s, surface, "/mcp", HTTP_POST, mcp_post);',
    after: 'http_register(s, "/mcp", HTTP_POST, mcp_post);' },
  { name: "wrong-tool-stream", file: "mcp", scenario: "streamed_tool_snapshots",
    before: 'if (r.tool == "get_status")', after: 'if (r.tool == "get_hp_values")' },
  { name: "stream-suffix-loss", file: "mcp", scenario: "streamed_tool_snapshots",
    before: "return http_send_values_json(req, response, suffix);", after: 'return http_send_values_json(req, response, "");' },
  { name: "version-header-bypass", file: "mcp", scenario: "protocol_header_guard",
    before: "if (version_present &&", after: "if (false &&" },
  { name: "headerless-march-default", file: "mcp", scenario: "protocol_header_guard",
    before: "if (!version_present && r.method != McpMethod::Initialize)", after: "if (false)" },
  { name: "unknown-tool-accepted", file: "mcpLogic", scenario: "unsupported_write_dispatch",
    before: 'if (out.tool != "get_status" && out.tool != "get_hp_values")', after: "if (false)" },
  { name: "arguments-write-accepted", file: "mcpLogic", scenario: "unsupported_write_dispatch",
    before: "if (seen_arguments || !no_arguments_object(r)) return false;", after: "if (seen_arguments || !r.value()) return false;" },
  { name: "malformed-notification-accepted", file: "mcpLogic", scenario: "malformed_notifications",
    before: "if (seen_params && !mcp_detail::object_value(params_begin, params_end)) {", after: "if (false) {" },
  { name: "invalid-utf8-accepted", file: "mcpLogic", scenario: "invalid_utf8_rejected",
    before: "if (c >= 0x80) {", after: "if (false) {" },
  { name: "parse-error-echoes-untrusted-id", file: "mcpLogic", scenario: "malformed_wire_and_null_error_id",
    before: /auto parse_error = \[\] \{\s*McpRequest error;\s*error.error = -32700;\s*return error;\s*\};/,
    after: "auto parse_error = [&out] { out.error = -32700; return out; };" },
  { name: "unsupported-march-negotiated", file: "mcpLogic", scenario: "initialize_and_revisions",
    before: 'return requested == "2025-06-18" ||', after: 'return requested == "2025-03-26" || requested == "2025-06-18" ||' },
  { name: "get-sse-returned-html", file: "mcp", scenario: "mcp_get_transport_headers",
    before: 'http_accepts_media_type(accept, "text/event-stream") &&', after: 'false &&' },
  { name: "zero-weight-html-accepted", file: "request", scenario: "mcp_get_transport_headers",
    before: /accepted\s*= http_quality_nonzero\(http_accept_trim_ows\(parameter.substr\(equal \+ 1\)\)\);/, after: "accepted = true;" },
  { name: "legacy-ota-prefix-exemption", file: "request", scenario: "ota_exact_route_guard", special: "legacy-ota" },
  { name: "ota-method-exemption", file: "request", scenario: "ota_exact_route_guard",
    before: 'if (is_post) return uri == "/ota/update";', after: 'if (uri == "/ota/update") return true;' },
];
function changedSource(mutation) {
  if (mutation.special === "legacy-ota") {
    const match = sources.request.match(/inline bool http_is_ota_route\([^]*?\n}/);
    assert.ok(match, "OTA helper source anchor absent");
    return sources.request.replace(match[0], `inline bool http_is_ota_route(std::string_view uri, bool = false) {
      if (uri == "/ota") return true;
      return uri.size() > 4 && uri.substr(0, 4) == "/ota" && (uri[4] == '/' || uri[4] == '?');
    }`);
  }
  const matches = typeof mutation.before === "string" ? sources[mutation.file].split(mutation.before).length - 1
    : [...sources[mutation.file].matchAll(new RegExp(mutation.before.source, mutation.before.flags + "g"))].length;
  assert.equal(matches, 1,
    `${mutation.name}: unique source anchor required`);
  return sources[mutation.file].replace(mutation.before, mutation.after);
}
function compile(tag, mutation) {
  const directory = path.join(temporary,tag); fs.mkdirSync(directory);
  const effective = { ...sources };
  if (mutation) effective[mutation.file] = changedSource(mutation);
  // Rebind quoted helper includes explicitly: a mutant never silently loads the original header.
  const mcpHeader = path.join(directory,"mcp.hpp"), requestHeader = path.join(directory,"http_request.hpp");
  fs.writeFileSync(mcpHeader,effective.mcpLogic.replace('#include "json.hpp"', `#include "${path.join(root,"main/logic/json.hpp")}"`));
  fs.writeFileSync(requestHeader,effective.request);
  const common = path.join(directory,"http_common.cpp"), server = path.join(directory,"http_server.cpp"), mcp = path.join(directory,"mcp_server.cpp");
  fs.writeFileSync(common,effective.common.replace('"logic/http_request.hpp"',JSON.stringify(requestHeader)));
  fs.writeFileSync(server,effective.server);
  fs.writeFileSync(mcp,effective.mcp.replace('"logic/mcp.hpp"',JSON.stringify(mcpHeader))
    .replace('"logic/http_request.hpp"',JSON.stringify(requestHeader)));
  const binary = path.join(directory,"fixture");
  execute(cxx,[...flags,"-MMD","-MF",path.join(directory,"inputs.d"),
    `-DHTTP_COMMON_SOURCE=${JSON.stringify(common)}`, `-DHTTP_SERVER_SOURCE=${JSON.stringify(server)}`,
    `-DMCP_SERVER_SOURCE=${JSON.stringify(mcp)}`, `-DROUTE_GROUP_SOURCE=${JSON.stringify(routeGroupPath)}`,
    path.join(fixture,"fixture.cpp"),"-o",binary]);
  return binary;
}
try {
  const compiler = execute(cxx,["--version"]).stdout.trim();
  const baseline = execute(compile("production"),[]);
  assert.match(baseline.stdout,/PASS total=21\b/);
  const wireResponses = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const line of baseline.stdout.trim().split("\n")) {
    if (!line.startsWith("JSONHEX ")) { console.log(line); continue; }
    const [,oracle,hex] = line.match(/^JSONHEX (\S+) ([0-9a-f]+)$/) || [];
    assert.ok(hex,"raw wire response must be emitted losslessly as hex");
    const response = JSON.parse(decoder.decode(Buffer.from(hex,"hex")));
    assert.equal(typeof response,"object",`${oracle}: response must be an object`);
    if (response.jsonrpc) {
      assert.equal(response.jsonrpc,"2.0");
      assert.ok(Object.hasOwn(response,"id"),`${oracle}: response id missing`);
      if (response.error) {
        assert.ok([-32700,-32600,-32601,-32602].includes(response.error.code));
        assert.equal(typeof response.error.message,"string");
      }
      if (response.result?.protocolVersion) {
        assert.ok(["2025-06-18","2025-11-25"].includes(response.result.protocolVersion));
        assert.deepEqual(response.result.serverInfo,{ name:"daikin-altherma-esp32",version:"fixture-version" });
      }
      if (response.result?.tools) {
        assert.deepEqual(response.result.tools.map(tool => tool.name),["get_status","get_hp_values"]);
        for (const tool of response.result.tools) {
          assert.deepEqual(tool.inputSchema,{ type:"object",properties:{},additionalProperties:false });
          assert.deepEqual(tool.annotations,{ readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false });
        }
      }
      if (response.result?.structuredContent) {
        const result = response.result;
        assert.equal(result.isError,false);
        assert.equal(typeof result.structuredContent,"object");
        assert.equal(Array.isArray(result.structuredContent),false);
        const isStatus = Object.hasOwn(result.structuredContent,"version");
        assert.deepEqual(result.content,[{ type:"text",text:isStatus
          ? "Current device and heat-pump status." : "Current decoded heat-pump readings." }]);
        if (!isStatus) {
          assert.equal(result.structuredContent.values.unicode,"Wärmepumpe");
          assert.equal(result.structuredContent.values.quoted,'a"b\\c');
        }
      }
    }
    wireResponses.push({ oracle,hex });
  }
  assert.ok(wireResponses.length >= 30,"independent native JSON/UTF8 oracle saw too few responses");
  const negativeControls = [];
  if (!process.argv.includes("--no-mutations")) {
    for (const mutation of mutations) {
      const result = execute(compile(mutation.name,mutation),[mutation.scenario],false);
      assert.equal(result.status,1,`${mutation.name}: oracle must reject compiling mutant\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr,new RegExp(`^FAIL ${mutation.scenario}:`,"m"));
      negativeControls.push({ name: mutation.name, oracle: mutation.scenario, stdout: result.stdout, stderr: result.stderr,
        mutatedSourceSha256: sha(changedSource(mutation)) });
      console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
    }
  }
  let sanitizerControl = null;
  if (sanitizer) {
    const tripwire = { name: "sanitizer-overflow-tripwire", file: "common",
      before: "esp_err_t http_send_json(httpd_req_t* req, const char* json) {",
      after: "esp_err_t http_send_json(httpd_req_t* req, const char* json) {\n" +
        "    volatile int maximum = 2147483647; volatile int overflow = maximum + 1; (void)overflow;" };
    const result = execute(compile(tripwire.name,tripwire),["initialize_and_revisions"],false);
    assert.notEqual(result.status,0,"UBSan overflow tripwire must terminate");
    assert.match(result.stderr,/runtime error: signed integer overflow/);
    assert.doesNotMatch(result.stdout,/PASS initialize_and_revisions/);
    sanitizerControl = { exitCode: result.status, stderr: result.stderr, mutatedSourceSha256: sha(changedSource(tripwire)) };
    console.log("sanitizer control: signed-overflow tripwire terminated before passing oracle");
  }
  for (const [key,file] of Object.entries(sourcePaths))
    assert.equal(fs.readFileSync(path.join(root,file),"utf8"),sources[key],`production source changed while fixture ran: ${file}`);
  const sourceHashes = Object.fromEntries(Object.entries(sourcePaths).map(([key,file]) => [file,sha(sources[key])]));
  sourceHashes["dependencies.lock"] = sha(fs.readFileSync(path.join(root,"dependencies.lock")));
  sourceHashes["test/test_http_server_runtime.mjs"] = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
  // Record the full compiler dependency closure, including all SDK/service headers and generated
  // import bindings. Local copies are evidence in the record even after temporary cleanup.
  const dependencyText = fs.readFileSync(path.join(temporary,"production/inputs.d"),"utf8").replace(/\\\n/g," ");
  const compiledInputs = Object.fromEntries(dependencyText.slice(dependencyText.indexOf(":")+1).trim().split(/\s+/)
    .filter(Boolean).map(file => [file,sha(fs.readFileSync(file))]));
  const head = execute("git",["-c","core.fsmonitor=false","rev-parse","HEAD"]).stdout.trim();
  const record = { compiler, sanitizers: sanitizer ? "undefined-no-recover" : "none", commands,
    baseline: baseline.stdout.split("\n").filter(line => !line.startsWith("JSONHEX ")).join("\n"),
    wireResponses, negativeControls, sanitizerControl, sourceHashes, compiledInputs,
    productionHead: head, routeGroupSha256: sha(fs.readFileSync(routeGroupPath)),
    claimLimits: [
      "Complete unextracted production http_common.cpp, http_server.cpp and mcp_server.cpp translation units execute.",
      "Only the four status/config/OTA/captive registration functions are extracted verbatim. Their service bodies are counted adapters; production body/config/OTA implementations are not exercised.",
      "The SDK registration adapter invokes the production common trampoline; independent checked-in URI/method/order oracles assert AP5 and LAN39.",
      "MCP parser, version/notification/dispatch/catalog/framing and common HTTP headers/body/time/exception guards run against SDK-shaped adapters; snapshot serializers are controlled shared adapters.",
      "HTTP sockets, FreeRTOS scheduling, live device heap/stack, NVS, physical source truth, signing, OTA delivery and rendered browser behavior are separate evidence.",
    ] };
  if (process.env.HTTP_RUNTIME_RECORD) fs.writeFileSync(process.env.HTTP_RUNTIME_RECORD,JSON.stringify(record,null,2)+"\n");
  console.log(`production HTTP server runtime: 21 cases, ${negativeControls.length} compiling negative controls; sanitizer=${record.sanitizers}`);
  for (const [file,hash] of Object.entries(sourceHashes)) console.log(`input ${file} sha256=${hash}`);
} finally { fs.rmSync(temporary,{ recursive: true, force: true }); }
