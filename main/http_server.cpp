// esp_http_server on :80. Creates the server and lets each concern register its own routes.
// Handlers should guard heavy work under a try/catch that returns 503 on OOM (memory is the
// binding constraint on these chips) — see the note in http_common.cpp.
#include "http_server.hpp"
#include "http_handlers.hpp"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_wifi.h"   // esp_wifi_get_mode — pick the HTTP trust surface (F01)

namespace daik {

static httpd_handle_t s_server = nullptr;

void http_start() {
    httpd_config_t cfg   = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn     = httpd_uri_match_wildcard;
    // EXACTLY the number of routes registered below on the trusted-LAN surface — count them with
    //   grep -c 'http_register(s\|http_register_on(s\|httpd_register_uri_handler(s' main/http_*.cpp main/mcp_server.cpp
    // (minus http_common.cpp's own two definitions) — and raise it in the same commit that adds one.
    // Overflowing is SILENT and hits the WRONG route: httpd_register_uri_handler returns
    // ESP_ERR_HTTPD_HANDLERS_FULL, and the casualty is whatever registers LAST, which is deliberately
    // the captive/SPA catch-all — so the symptom of a missing route would be deep links breaking,
    // not the new route 404ing. http_register() now logs a failed registration for that reason.
    // 24 since /events went away with the WebSocket push (docs/ARCHITECTURE.md "Push vs. poll"),
    // 25 when POST /set_lang (the UI language override) was added, 26 for /favicon.ico, 27 for the
    // dashboard's dedicated 96 px heat-pump brand icon, 28 for POST /set_ref_temp, and 29 for
    // explicit HomeHub discovery.
    cfg.max_uri_handlers = 29;
    cfg.lru_purge_enable = true;
    // 12 KB, not the 8 KB this ran on through v1.0.12 — MEASURED, not padded. v1.0.12 panicked and
    // the core dump's task table read `httpd 7728/460`: the task had been 7732 bytes deep at its last
    // context switch, 460 bytes off its floor. Since a switch happens at an arbitrary point, the true
    // peak is at least that and unbounded above it; it went past the floor and wrote 0x4 over the
    // TCB's pvThreadLocalStoragePointers[0], which sits just below `pxStack`. The task then died ~44 s
    // later in lwip (`pthread_getspecific` → LoadProhibited on 0x4) with a backtrace pointing at a
    // WebSocket send (a transport that no longer exists) — nowhere near the code that actually
    // corrupted it. Every other task in that dump had >= 1.8 KB free; httpd was the sole outlier,
    // because http_append_status_json() runs here and is by far the largest thing this task does.
    // 460 bytes of margin was the bug and #163's extra JSON was only the straw. The peak is
    // separately cut in http_status.cpp. This is now the ONLY task that builds /status (#241), and
    // 4376 concurrent GET /status left it at 1456 used of 12288.
    cfg.stack_size       = 12288;
    if (httpd_start(&s_server, &cfg) != ESP_OK) {
        ESP_LOGE("http", "server start failed");
        return;
    }
    // Pick the trust surface from the WiFi mode, FAILING CLOSED: only a definitely-detected station
    // mode (WIFI_MODE_STA, the normal path) is the trusted LAN. Any esp_wifi_get_mode() error, or
    // AP/APSTA/NULL (the setup portal runs AP — provisioning.cpp), falls to the restricted
    // setup-AP surface. A security boundary must never WIDEN on an unreadable mode: the previous
    // `!= AP && != APSTA` test treated a query error as trusted-LAN and would have exposed /coredump,
    // /diag and the config/OTA/MCP surface to an unauthenticated radio client (F01). Decided ONCE
    // here: http_start() runs after wifi_start_sta()/provisioning_start_ap() have set the mode.
    // logic/http_surface.hpp owns which routes each surface exposes.
    wifi_mode_t mode = WIFI_MODE_NULL;
    const bool sta_trusted = (esp_wifi_get_mode(&mode) == ESP_OK && mode == WIFI_MODE_STA);
    const HttpSurface surface = sta_trusted ? HttpSurface::TrustedLan : HttpSurface::SetupAp;

    http_register_status(s_server, surface);
    http_register_config(s_server, surface);
    http_register_ota(s_server, surface);
    http_register_mcp(s_server, surface);
    http_register_captive(s_server);   // catch-all — both surfaces, keep last so specific routes win
    ESP_LOGI("http", "server on :80 (%s surface)", sta_trusted ? "trusted-LAN" : "setup-AP");
}

httpd_handle_t http_server_handle() {
    return s_server;
}

} // namespace daik
