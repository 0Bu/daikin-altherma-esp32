import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const common = read("main/http_common.cpp");
const status = read("main/http_status.cpp");
const mcp = read("main/mcp_server.cpp");
const configRoutes = read("main/http_config.cpp");
const surface = read("main/logic/http_surface.hpp");
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

// The free register probe puts a frame on a shared physical bus and spends a poll cycle's bus time,
// so it must stay a POST registered through the surface gate: a GET would be takeable by a link
// prefetcher, and a raw http_register would put a bus-driving route on the OPEN setup AP.
assert.match(configRoutes, /http_register_on\(s, surface, "\/hp\/query", HTTP_POST, hp_query_probe\)/,
  "the register probe must be a surface-gated POST");
assert.doesNotMatch(configRoutes, /http_register\(s, "\/hp\/query"/,
  "the register probe must never bypass the AP/LAN surface gate");
assert.match(surface, /\/hp\/query/,
  "the trust-surface policy must name the register probe among the trusted-LAN-only routes");
// X10A has no write command, and the probe is the one route that takes a caller-chosen register.
// It must therefore reach the bus through hp_probe_run() alone — never by framing its own request.
assert.match(configRoutes, /hp_probe_run\(/, "the probe must go through the poll task's hand-off");
assert.doesNotMatch(configRoutes, /build_request\(|uart_write_bytes\(/,
  "no HTTP handler may frame or write an X10A request itself");

// The register picker reuses the trusted-LAN-only /models handler. It must stream the exact active
// profile when available, explicitly label a generic diagnostic fallback while detection is
// unresolved/stale, and escape ValueDef labels rather than growing /status or owning the response.
const activeModels = status.slice(status.indexOf("static esp_err_t h_active_model_values("),
                                  status.indexOf("static esp_err_t h_models("));
assert.match(activeModels, /const Config c = config\(\)[\s\S]*HttpJsonChunks j/,
  "the active-profile snapshot must allocate before streaming starts so OOM remains a clean 503");
assert.match(activeModels, /probe_catalog_profile\(def::profiles, c\.profile, fallback\)[\s\S]*\\"definition\\"[\s\S]*\\"fallback\\"[\s\S]*def::resolved\(\*profile\)/,
  "auto or stale ids may use generic rows only with explicit definition/fallback provenance");
assert.match(activeModels, /probe_catalog_row\(row\)/,
  "only tuples accepted by the probe contract may reach the register menu");
assert.match(activeModels, /Cache-Control[\s\S]*no-store/,
  "the installation-specific register catalog must not survive detection or firmware changes in a browser cache");
assert.match(activeModels, /json_append_quoted\(j, row\.label\)/,
  "the exact ValueDef label must be JSON-escaped into the streamed response");
assert.match(status, /models_active_requested\(req\)[\s\S]*h_active_model_values\(req\)/,
  "GET /models?active=1 must dispatch through the existing trusted-LAN model route");

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
