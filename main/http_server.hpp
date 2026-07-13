#pragma once
// esp_http_server on :80. Every handler runs under the handle_all try/catch OOM guard (returns
// 503 instead of crashing — memory is the binding constraint). Route registration is split
// across http_status.cpp (GET UI/status/values/models/diag/scan), http_config.cpp (POST
// /set_*), http_ota.cpp (/ota/*) and mcp_server.cpp (/mcp).

#include "esp_http_server.h"

namespace daik {

void http_start();
httpd_handle_t http_server_handle();

} // namespace daik
