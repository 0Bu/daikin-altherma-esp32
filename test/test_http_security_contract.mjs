import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const common = read("main/http_common.cpp");
const status = read("main/http_status.cpp");
const mcp = read("main/mcp_server.cpp");
const appState = read("main/www/js/app_state.js");

// The policy belongs in the one trampoline every registered route traverses, before the real
// handler is invoked. A concern-local check would recreate the original MCP-only gap.
const handleAll = common.slice(common.indexOf("static esp_err_t handle_all"),
                               common.indexOf("void http_register("));
assert.match(handleAll, /!provisioning_ap_active\(\)[\s\S]*trusted_lan_headers_allowed\(req\)/,
  "trusted-LAN requests must pass the shared Host/Origin/Fetch-Metadata policy");
assert.match(handleAll, /json_post_allowed\(req\)/,
  "body-bearing POSTs must pass the shared application/json policy");
assert.ok(handleAll.indexOf("trusted_lan_headers_allowed(req)") < handleAll.indexOf("return fn(req)"),
  "the browser boundary must run before the route handler");
assert.match(common, /net_eth_info\(\)/, "Ethernet's current IP must be an allowed device identity");
assert.match(common, /wifi_info\(\)/, "WiFi's current IP must be an allowed device identity");
assert.doesNotMatch(mcp, /mcp_origin_allowed|httpd_req_get_hdr_value_len\(req, "Origin"\)/,
  "MCP must not retain a WiFi-only copy of the now-global policy");

// GET /diag and GET /coredump are read-only; mutation has explicit POST endpoints. Keep the UI's
// full-report deletion on its already-safe POST route too.
const diagGet = status.slice(status.indexOf("static esp_err_t h_diag("),
                             status.indexOf("static esp_err_t h_diag_clear("));
const coredumpGet = status.slice(status.indexOf("static esp_err_t h_coredump("),
                                 status.indexOf("static esp_err_t h_coredump_clear("));
assert.doesNotMatch(diagGet, /diag_clear\(|"clear"/);
assert.doesNotMatch(coredumpGet, /esp_core_dump_image_erase\(|"clear"/);
assert.match(status, /"\/diag\/clear", HTTP_POST, h_diag_clear/);
assert.match(status, /"\/coredump\/clear", HTTP_POST, h_coredump_clear/);
assert.match(status, /"\/crash\/dismiss", HTTP_POST, h_crash_dismiss/);
assert.match(appState, /fetch\("\/crash\/dismiss", \{ method: "POST" \}\)/,
  "Delete report must remain a POST device action");

// All seven user-entered JSON selectors must use the redacting writer. The redaction audit covers
// count/list drift and never-wrapped new Config strings; this pins the current high-risk set by name.
for (const member of [
  "ref_temp_path", "ref_temp_setpoint_path", "ref_temp_time_path",
  "ref_temp_enabled_path", "ref_temp_hvac_mode_path",
  "circulation_power_path", "circulation_time_path",
]) {
  assert.match(status, new RegExp(`jstr_r\\(c\\.${member}, redact\\)`),
    `${member} must be redacted in public bug reports`);
}

console.log("http security contract: ok");
