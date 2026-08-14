// esp_http_server on :80. Creates the server and lets each concern register its own routes.
// Handlers should guard heavy work under a try/catch that returns 503 on OOM (memory is the
// binding constraint on these chips) — see the note in http_common.cpp.
#include "http_server.hpp"
#include "http_handlers.hpp"
#include "esp_http_server.h"
#include "esp_log.h"
#include "provisioning.hpp"   // provisioning_ap_active — picks the HTTP trust surface (F01)

namespace daik {

static httpd_handle_t s_server = nullptr;

void http_start() {
    httpd_config_t cfg   = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn     = httpd_uri_match_wildcard;
    // EXACTLY the number of routes registered below on the trusted-LAN surface — count them with
    //   awk '/http_register[(]s|http_register_on[(]s|httpd_register_uri_handler[(]s/{n++} END{print n}' main/http_*.cpp main/mcp_server.cpp
    // (minus http_common.cpp's own two definitions) — and raise it in the same commit that adds one.
    // Overflowing is SILENT and hits the WRONG route: httpd_register_uri_handler returns
    // ESP_ERR_HTTPD_HANDLERS_FULL, and the casualty is whatever registers LAST, which is deliberately
    // the captive/SPA catch-all — so the symptom of a missing route would be deep links breaking,
    // not the new route 404ing. http_register() now logs a failed registration for that reason.
    // 24 since /events went away with the WebSocket push (docs/ARCHITECTURE.md "Push vs. poll"),
    // 25 when POST /set_lang (the UI language override) was added, 26 for /favicon.ico, 27 for the
    // dashboard's dedicated 96 px heat-pump brand icon, 28 for POST /set_ref_temp, 29 for explicit
    // HomeHub discovery, 30 for the direct Open-Meteo location setting, 31 for ENV III, 32 for the
    // OFF/SHADOW dynamic-LWT mode — and back to 31 when that route was RETIRED: the heating-curve
    // diagnosis arms itself from the two sources it reads, so there is no mode to POST; 32/33 are
    // the circulation-power test/persist pair. The room source's former pre-save test route had
    // raised the total to 34; removing it returned the exact total to 33. The explicit master
    // diagnostics consent route raises the current exact total to 34.
    cfg.max_uri_handlers = 34;
    cfg.lru_purge_enable = true;
    // 16 KB, not the 8 KB this ran on through v1.0.12 — MEASURED, not padded. v1.0.12 panicked and
    // the core dump's task table read `httpd 7728/460`: the task had been 7732 bytes deep at its last
    // context switch, 460 bytes off its floor. Since a switch happens at an arbitrary point, the true
    // peak is at least that and unbounded above it; it went past the floor and wrote 0x4 over the
    // TCB's pvThreadLocalStoragePointers[0], which sits just below `pxStack`. The task then died ~44 s
    // later in lwip (`pthread_getspecific` → LoadProhibited on 0x4) with a backtrace pointing at a
    // WebSocket send (a transport that no longer exists) — nowhere near the code that actually
    // corrupted it. Every other task in that dump had >= 1.8 KB free; httpd was the sole outlier,
    // because http_append_status_json() runs here and is by far the largest thing this task does.
    // 460 bytes of margin was the bug and #163's extra JSON was only the straw. The peak is
    // separately cut in http_status.cpp. This is now the ONLY task that builds /status (#241).
    //
    // 12 KB became insufficient again when ENV III extended that builder. The exact signed CI ELFs
    // show its fixed frame growing from 0x2630 (9776) bytes in dev.295 to 0x2950 (10576) in dev.296:
    // only 1712 bytes remained for config()'s nested Config/std::string copy, HTTPD itself and
    // interrupts. The dev.296 live OTA then double-faulted in config() with the current task's TCB
    // overwritten and rolled back. 16 KB leaves 5808 bytes above the fixed frame; keep the number
    // tied to the decoded dump + ELF evidence rather than shrinking it from an idle heap reading.
    cfg.stack_size       = 16384;
    if (httpd_start(&s_server, &cfg) != ESP_OK) {
        ESP_LOGE("http", "server start failed");
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
