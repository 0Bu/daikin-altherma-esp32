#pragma once
// Shared split-map for the HTTP handlers registered on the server created in http_server.cpp.
// Each translation unit registers its own routes so the handlers stay grouped by concern while
// sharing one server + one OOM guard.
#include "esp_http_server.h"

namespace daik {

// Shared helpers (http_common.cpp)
esp_err_t http_send_json(httpd_req_t* req, const char* json);
esp_err_t http_send_gzip(httpd_req_t* req, const char* content_type,
                         const unsigned char* start, const unsigned char* end);
// Read a JSON request body into a bounded buffer; returns bytes or <0.
int       http_read_body(httpd_req_t* req, char* buf, size_t max);

// Register a route whose handler runs under the shared handle_all try/catch OOM guard: an uncaught
// std::bad_alloc (tight heap: WiFi+MQTT+TLS) becomes a 503 instead of unwinding through
// esp_http_server's C dispatch to std::terminate -> reboot. Register EVERY route through this, not
// httpd_register_uri_handler directly. See http_common.cpp and docs/ARCHITECTURE.md -> Memory constraints.
void http_register(httpd_handle_t s, const char* uri, httpd_method_t method,
                   esp_err_t (*fn)(httpd_req_t*));

// Route registration (one per concern)
void http_register_status(httpd_handle_t s);   // http_status.cpp
void http_register_config(httpd_handle_t s);   // http_config.cpp
void http_register_ota(httpd_handle_t s);      // http_ota.cpp
void http_register_mcp(httpd_handle_t s);      // mcp_server.cpp
void http_register_captive(httpd_handle_t s);  // http_status.cpp — MUST be registered last

void http_register_ws_client(int fd);
void http_unregister_ws_client(int fd);
void ws_broadcast_values();
void ws_broadcast_status();

} // namespace daik
