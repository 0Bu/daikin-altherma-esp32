// esp_http_server on :80. Creates the server and lets each concern register its own routes.
// Handlers should guard heavy work under a try/catch that returns 503 on OOM (memory is the
// binding constraint on these chips) — see the note in http_common.cpp.
#include "http_server.hpp"
#include "http_handlers.hpp"
#include "diag_log.hpp" // diag_printf — a failed start must not be serial-only
#include "esp_http_server.h"
#include "esp_log.h"
#include "provisioning.hpp"   // provisioning_ap_active — picks the HTTP trust surface (F01)

namespace daik {

static httpd_handle_t s_server = nullptr;

void http_start() {
    httpd_config_t cfg   = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn     = httpd_uri_match_wildcard;
    // EXACTLY the number of routes registered below on the trusted-LAN surface — count them with
    //   awk '/http_register[(]s|http_register_on[(]s|httpd_register_uri_handler[(]s/{n++} END{print
    //   n}' main/http_*.cpp main/mcp_server.cpp
    // (minus http_common.cpp's own two definitions) — and raise it in the same commit that adds
    // one. Overflowing is SILENT and hits the WRONG route: httpd_register_uri_handler returns
    // ESP_ERR_HTTPD_HANDLERS_FULL, and the casualty is whatever registers LAST, which is
    // deliberately the captive/SPA catch-all — so the symptom of a missing route would be deep
    // links breaking, not the new route 404ing. http_register() now logs a failed registration for
    // that reason. Keep exact total 40, including the dev-only binary upload.
    cfg.max_uri_handlers = 40; // includes the dev-only signed binary upload
    cfg.lru_purge_enable = true;
    // Covers header parsing, body reads and the SDK's own leftover purge. Each blocking receive
    // retains the SDK's five-second timeout. Ordinary requests get 30 s; admitted dev uploads
    // extend only their own session to 300 s while retaining the first-header start time.
    cfg.recv_wait_timeout = 5;
    cfg.open_fn           = http_open_session;
    cfg.close_fn          = http_close_session;
    // Named ELF path ceilings include bounded JSON recursion and retain 2 KiB for headroom.
    cfg.stack_size = 10240;
    const esp_err_t start_err = httpd_start(&s_server, &cfg);
    if (start_err != ESP_OK) {
        // No retry and no restart, as before: everything main.cpp starts after this still starts
        // and works without the web UI, and a reboot loop would take it down with it. But the
        // failure is no longer serial-only. The diag ring cannot be read over HTTP once this has
        // failed — diag_printf also forwards to syslog (started before this), which is then the one
        // place a remote reader can learn why the web UI is gone. (It echoes to serial too.)
        diag_printf("http: server start failed (%s) — no web UI, API, MCP or OTA until a reboot\n",
                    esp_err_to_name(start_err));
        return;
    }
    // Pick the trust surface from the ONE fact that decides it: is the OPEN provisioning SoftAP
    // running? logic/http_surface.hpp's http_surface_for() carries the reasoning, including why
    // this replaced a test on the WiFi MODE — that test read WIFI_MODE_NULL on a board carried by
    // an Ethernet cable (the radio is deliberately never started there, main.cpp) and would have
    // withheld the entire API from the LAN the device is reachable on, with no radio to fix it
    // through. Decided ONCE here: http_start() runs after the transport fork has settled.
    const bool ap_up          = provisioning_ap_active();
    const HttpSurface surface = http_surface_for(ap_up);

    http_register_status(s_server, surface);
    http_register_config(s_server, surface);
    http_register_ota(s_server, surface);
    http_register_mcp(s_server, surface);
    http_register_captive(s_server);   // catch-all — both surfaces, keep last so specific routes win
    ESP_LOGI("http", "server on :80 (%s surface)", ap_up ? "setup-AP" : "trusted-LAN");
}

httpd_handle_t http_server_handle() {
    return s_server;
}

} // namespace daik
