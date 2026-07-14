// esp_http_server on :80. Creates the server and lets each concern register its own routes.
// Handlers should guard heavy work under a try/catch that returns 503 on OOM (memory is the
// binding constraint on these chips) — see the note in http_common.cpp.
#include "http_server.hpp"
#include "http_handlers.hpp"
#include "esp_http_server.h"
#include "esp_log.h"
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
    http_register_status(s_server);
    http_register_config(s_server);
    http_register_ota(s_server);
    http_register_mcp(s_server);
    http_register_captive(s_server);   // catch-all — keep last so specific routes win
    ESP_LOGI("http", "server on :80");
}

httpd_handle_t http_server_handle() {
    return s_server;
}

} // namespace daik
