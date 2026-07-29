// Shared HTTP helpers. See http_handlers.hpp.
//
// OOM discipline: heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest
// contiguous free block). EVERY route registered via http_register() runs under handle_all, which
// catches std::bad_alloc and returns 503 instead of letting an uncaught throw unwind through
// esp_http_server's C frames to std::terminate -> abort() -> reboot. Handlers should still stream
// large output (e.g. /diag) instead of one big std::string. (See docs/ARCHITECTURE.md → Memory constraints.)
#include "http_handlers.hpp"
#include "diag_log.hpp"   // diag_printf — a route that failed to register must not do so silently
#include "logic/http_body.hpp"
#include "esp_err.h"
#include <new>          // std::bad_alloc

namespace daik {

// The single OOM/exception guard every HTTP handler runs under. http_register() stashes the real
// handler in user_ctx and installs this trampoline as the route handler; we call the real handler
// inside try/catch so an out-of-memory throw (std::string / cJSON / TLS) turns into a 503 rather
// than crashing the device (which would also drop the poll cycle + MQTT availability).
static esp_err_t handle_all(httpd_req_t* req) {
    auto fn = reinterpret_cast<esp_err_t (*)(httpd_req_t*)>(req->user_ctx);
    if (!fn) return httpd_resp_send_500(req);
    try {
        return fn(req);
    } catch (const std::bad_alloc&) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_sendstr(req, "out of memory");
    } catch (...) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_sendstr(req, "handler error");
    }
}

void http_register(httpd_handle_t s, const char* uri, httpd_method_t method,
                   esp_err_t (*fn)(httpd_req_t*)) {
    httpd_uri_t u = {};
    u.uri      = uri;
    u.method   = method;
    u.handler  = handle_all;
    u.user_ctx = reinterpret_cast<void*>(fn);
    // SAY SO when a route doesn't get in. The only realistic failure is ESP_ERR_HTTPD_HANDLERS_FULL
    // (cfg.max_uri_handlers is sized exactly to the route count in http_server.cpp), and discarding it
    // made the symptom appear somewhere else entirely: the casualty is whatever registers LAST — the
    // captive/SPA catch-all — so adding a route would break deep links while the new route worked.
    const esp_err_t err = httpd_register_uri_handler(s, &u);
    if (err != ESP_OK) diag_printf("http: route %s not registered: %s\n", uri, esp_err_to_name(err));
}

void http_register_on(httpd_handle_t s, HttpSurface surface, const char* uri, httpd_method_t method,
                      esp_err_t (*fn)(httpd_req_t*)) {
    // The AP/LAN boundary is one host-tested decision (logic/http_surface.hpp), not a per-route
    // judgement scattered across files: on the open setup AP a withheld GET falls through to the
    // captive catch-all (the setup page, never data) and a withheld POST 404s.
    if (http_surface_serves(surface, uri, method == HTTP_POST))
        http_register(s, uri, method, fn);
}

esp_err_t http_send_json(httpd_req_t* req, const char* json) {
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

esp_err_t http_send_gzip(httpd_req_t* req, const char* content_type,
                         const unsigned char* start, const unsigned char* end) {
    httpd_resp_set_type(req, content_type);
    httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    return httpd_resp_send(req, reinterpret_cast<const char*>(start), end - start);
}

// Reassemble the body across however many segments it arrives in — the loop and its stall bound
// are host-tested in logic/http_body.hpp; what stays here is the part that is IDF's: translating
// httpd_req_recv's return codes into the three cases the policy reasons about.
int http_read_body(httpd_req_t* req, char* buf, size_t max) {
    return http_body_read(buf, max, req->content_len, [req](char* dst, size_t len) -> BodyChunk {
        const int r = httpd_req_recv(req, dst, len);
        if (r == HTTPD_SOCK_ERR_TIMEOUT) return { BodyRecv::Timeout, 0 };
        if (r <= 0)                      return { BodyRecv::Error,   0 };
        return { BodyRecv::Data, static_cast<size_t>(r) };
    });
}

} // namespace daik
