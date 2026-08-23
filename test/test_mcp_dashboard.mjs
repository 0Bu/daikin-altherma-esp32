// Contract test for the self-documenting GET /mcp page. GET must stay a static, local help surface;
// the JSON-RPC protocol remains on POST and the page must not contact or inspect the device itself.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

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

// The copy buttons restore their own label after 1600 ms. That label used to be read fresh on every
// click — AFTER the clipboard await — and the pending restore was never cancelled, so a second click
// inside the window captured the transient "Copied" as the text to go back to. Both timers then
// fired in order and the button read "Copied" permanently: the page's one piece of interactive
// feedback, stuck telling the user something it could no longer know. Executed rather than asserted
// on source text, because the defect is an interleaving of two clicks and a timer.
{
  class Node {
    constructor(id = "", text = "") {
      this.id = id;
      this.textContent = text;
      this.dataset = {};
      this.classes = new Set();
      this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c) };
    }
    addEventListener(type, handler) { if (type === "click") this.onClick = handler; }
  }

  const endpoint = new Node("endpoint-url");
  const clientJson = new Node("client-json");
  const curlExample = new Node("curl-example");
  const copyButton = new Node("", "Copy");
  copyButton.dataset.copy = "endpoint-url";
  const nodes = { "endpoint-url": endpoint, "client-json": clientJson, "curl-example": curlExample };

  const timers = [];
  let nextTimerId = 1;
  const context = {
    document: {
      getElementById: (id) => nodes[id] || null,
      querySelectorAll: () => [copyButton],
    },
    location: { origin: "http://daikin-altherma-esp32.local", pathname: "/mcp" },
    navigator: { clipboard: { async writeText() {} } },
    isSecureContext: true,
    setTimeout(fn, ms) { timers.push({ id: nextTimerId, fn, ms }); return nextTimerId++; },
    clearTimeout(id) {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
  };
  context.window = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(js, sandbox, { filename: "main/www/mcp_dashboard.js" });

  assert.equal(endpoint.textContent, "http://daikin-altherma-esp32.local/mcp",
    "the page names the exact URL it is served from");
  assert.ok(copyButton.onClick, "each [data-copy] button gets a click handler");

  const pristine = copyButton.textContent;
  await sandbox.copyTarget(copyButton);
  assert.equal(copyButton.textContent, "Copied", "a copy reports success on the button");
  assert.equal(timers.length, 1, "one restore is owed after one click");

  await sandbox.copyTarget(copyButton);   // second click, still inside the 1600 ms window
  assert.equal(timers.length, 1, "a second click replaces the pending restore instead of adding one");

  for (const timer of timers.splice(0)) timer.fn();
  assert.equal(copyButton.textContent, pristine,
    "the button returns to its original label, never to a transient one");
  assert.equal(copyButton.classes.has("copied"), false, "the success styling is cleared with it");
}

console.log("MCP page: local assets, static setup help, GET response and copy-button contract pass");
