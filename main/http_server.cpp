// esp_http_server on :80. Creates the server and lets each concern register its own routes.
// Handlers should guard heavy work under a try/catch that returns 503 on OOM (memory is the
// binding constraint on these chips) — see the note in http_common.cpp.
#include "http_server.hpp"
#include "http_handlers.hpp"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_wifi.h"   // esp_wifi_get_mode — pick the HTTP trust surface (F01)
#include <unistd.h>

namespace daik {

static httpd_handle_t s_server = nullptr;

static void ws_close_fn(httpd_handle_t hd, int sockfd) {
    http_unregister_ws_client(sockfd);
    close(sockfd);
}

void http_start() {
    httpd_config_t cfg   = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn     = httpd_uri_match_wildcard;
    cfg.max_uri_handlers = 24;
    cfg.lru_purge_enable = true;
    cfg.stack_size       = 8192;
    cfg.close_fn         = ws_close_fn;
    if (httpd_start(&s_server, &cfg) != ESP_OK) {
        ESP_LOGE("http", "server start failed");
        return;
    }
    // Pick the trust surface from the WiFi mode, FAILING CLOSED: only a definitely-detected station
    // mode (WIFI_MODE_STA, the normal path) is the trusted LAN. Any esp_wifi_get_mode() error, or
    // AP/APSTA/NULL (the setup portal runs APSTA — provisioning.cpp), falls to the restricted
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
