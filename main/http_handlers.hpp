#pragma once
// Shared split-map for the HTTP handlers registered on the server created in http_server.cpp.
// Each translation unit registers its own routes so the handlers stay grouped by concern while
// sharing one server + one OOM guard. (Ported split from tesla-key-esp32/http_handlers.hpp.)
#include "esp_http_server.h"

namespace daik {

// Shared helpers (http_common.cpp)
esp_err_t http_send_json(httpd_req_t* req, const char* json);
esp_err_t http_send_gzip(httpd_req_t* req, const char* content_type,
                         const unsigned char* start, const unsigned char* end);
// Read a JSON request body into a bounded buffer; returns bytes or <0.
int       http_read_body(httpd_req_t* req, char* buf, size_t max);

// Route registration (one per concern)
void http_register_status(httpd_handle_t s);   // http_status.cpp
void http_register_config(httpd_handle_t s);   // http_config.cpp
void http_register_ota(httpd_handle_t s);      // http_ota.cpp
void http_register_mcp(httpd_handle_t s);      // mcp_server.cpp

} // namespace daik
