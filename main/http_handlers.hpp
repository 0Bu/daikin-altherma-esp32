#pragma once
// Shared split-map for the HTTP handlers registered on the server created in http_server.cpp.
// Each translation unit registers its own routes so the handlers stay grouped by concern while
// sharing one server + one OOM guard.
#include "esp_http_server.h"
#include "logic/http_surface.hpp"   // HttpSurface — which routes each trust surface exposes (F01)

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

// Like http_register, but only if the trust `surface` exposes this route (logic/http_surface.hpp).
// The concern-registration functions below call this for every route so the AP/LAN boundary is one
// host-tested policy rather than a per-file judgement call.
void http_register_on(httpd_handle_t s, HttpSurface surface, const char* uri, httpd_method_t method,
                      esp_err_t (*fn)(httpd_req_t*));

// Route registration (one per concern). `surface` selects which routes are exposed: on the open
// setup AP only the provisioning routes register; on the trusted LAN, the full API.
void http_register_status(httpd_handle_t s, HttpSurface surface);   // http_status.cpp
void http_register_config(httpd_handle_t s, HttpSurface surface);   // http_config.cpp
void http_register_ota(httpd_handle_t s, HttpSurface surface);      // http_ota.cpp
void http_register_mcp(httpd_handle_t s, HttpSurface surface);      // mcp_server.cpp
void http_register_captive(httpd_handle_t s);  // http_status.cpp — MUST be registered last (both surfaces)

// There is deliberately NO live-push surface here. The dashboard polls /status and /values; the
// /events WebSocket and its broadcast registry were removed — see docs/ARCHITECTURE.md
// "Push vs. poll" for the measured case (#238 wedged a stream silently, #241 put the /status
// builder on the task that owns the X10A UART).

} // namespace daik
