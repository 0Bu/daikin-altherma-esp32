// Contract test for the self-documenting GET /mcp page. GET must stay a static, local help surface;
// the JSON-RPC protocol remains on POST and the page must not contact or inspect the device itself.
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../main/www/mcp_dashboard.html");
const css = read("../main/www/mcp_dashboard.css");
const js = read("../main/www/mcp_dashboard.js");
const server = read("../main/mcp_server.cpp");
const cmake = read("../main/CMakeLists.txt");

const occurrences = (text, needle) => text.split(needle).length - 1;
assert.equal(occurrences(html, "/*@@INLINE:style.css@@*/"), 1, "CSS marker must appear exactly once");
assert.equal(occurrences(html, "//@@INLINE:app.js@@"), 1, "JS marker must appear exactly once");
assert.equal(occurrences(css, "@@INLINE:"), 0, "CSS must not contain asset markers");
assert.equal(occurrences(js, "@@INLINE:"), 0, "JS must not contain asset markers");

const assembled = html
  .replace("/*@@INLINE:style.css@@*/\n", css)
  .replace("//@@INLINE:app.js@@\n", js);
assert.ok(!assembled.includes("@@INLINE:"), "assembled page must not retain markers");
assert.ok(assembled.includes("Model Context Protocol") && assembled.includes("Streamable HTTP"),
  "page must explain what the endpoint is and name its transport");
assert.ok(assembled.includes("mcpServers") && assembled.includes("curl -sS"),
  "page must provide client configuration and a wire example");
assert.ok(assembled.includes("get_status") && assembled.includes("get_hp_values"),
  "page must document both read-only tools");
assert.ok(assembled.includes("trusted LAN") && assembled.includes("no authentication"),
  "page must make the endpoint security boundary clear");
assert.doesNotMatch(assembled, /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i,
  "page must not load external assets");

assert.match(js, /location\.origin.*location\.pathname/s,
  "examples must derive the exact URL serving the page");
assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|WebSocket/,
  "static help page must not make network requests");
assert.doesNotMatch(js, /tools\/list|tools\/call/,
  "static help page must not inspect or invoke tools");
assert.doesNotMatch(js, /\.innerHTML\s*=/,
  "page content must not be rendered through innerHTML");

assert.match(cmake, /mcp\.html\.gz/, "firmware must embed the pre-compressed page");
assert.match(server, /http_send_gzip\(req,\s*"text\/html",\s*mcp_html_gz_start/s,
  "GET /mcp must serve the embedded page");
assert.match(server, /Content-Security-Policy/, "page response must carry a CSP");
assert.match(server, /connect-src 'none'/, "static page CSP must prohibit network connections");
assert.doesNotMatch(server, /405 Method Not Allowed|POST only/,
  "GET /mcp must no longer return the placeholder 405 response");

console.log("MCP page: local assets, static setup help, and GET response contract pass");
