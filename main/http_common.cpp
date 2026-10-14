// Shared HTTP helpers. See http_handlers.hpp.
//
// OOM discipline: heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest
// contiguous free block). EVERY route registered via http_register() runs under handle_all, which
// catches std::bad_alloc and returns 503 instead of letting an uncaught throw unwind through
// esp_http_server's C frames to std::terminate -> abort() -> reboot. Handlers should still stream
// large output (e.g. /diag) instead of one big std::string. (See docs/ARCHITECTURE.md → Memory constraints.)
#include "http_handlers.hpp"
#include "diag_log.hpp"   // diag_printf — a route that failed to register must not do so silently
#include "heap_guard.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "provisioning.hpp"
#include "stack_watch.hpp"
#include "logic/http_body.hpp"
#include "logic/http_ingress.hpp"
#include "logic/http_request.hpp"
#include "wifi.hpp"
#include "esp_err.h"
#include "esp_timer.h"
#include <cstring>
#include <new>          // std::bad_alloc
#include <cerrno>
#include <unistd.h>
#include "lwip/sockets.h"

namespace daik {

// Record the httpd task's stack headroom on EVERY exit from handle_all — the normal return, the
// 503 and the 500 — because the request that came closest to the limit is exactly the one that
// threw. A destructor rather than three call sites: it also covers a future early return, and this
// task carries the deepest call chain in the firmware
// (mcp_post -> http_send_status_json -> append_status_json), which
// overflowed twice (v1.0.12, legacy-318) and was diagnosed both times from a core dump. Costs one
// FreeRTOS read per request; the number leaves the board on the MQTT heartbeat (stack_watch.hpp).
namespace {
struct HttpIngressSession {
    HttpIngressBudget budget;
    bool              admitted = false;
};
void free_ingress_budget(void* state) { delete static_cast<HttpIngressSession*>(state); }

int receive_with_budget(httpd_handle_t server, int socket, char* bytes, size_t size, int flags) {
    auto* state = static_cast<HttpIngressSession*>(httpd_sess_get_transport_ctx(server, socket));
    if (!state || !state->admitted || !bytes) return HTTPD_SOCK_ERR_FAIL;
    auto* budget = &state->budget;
    if (!budget->admit(esp_timer_get_time())) return HTTPD_SOCK_ERR_FAIL;
    const int received     = recv(socket, bytes, size, flags);
    const int socket_error = errno;
    // A last successful read must not admit a request that finished after its total budget.
    if (budget->expired(esp_timer_get_time())) return HTTPD_SOCK_ERR_FAIL;
    if (received >= 0) return received;
    return socket_error == EAGAIN || socket_error == EWOULDBLOCK || socket_error == EINTR
               ? HTTPD_SOCK_ERR_TIMEOUT
               : HTTPD_SOCK_ERR_FAIL;
}

void finish_receive_budget(httpd_req_t* req) {
    auto* state = static_cast<HttpIngressSession*>(
        httpd_sess_get_transport_ctx(req->handle, httpd_req_to_sockfd(req)));
    if (state) state->budget.finish();
}

struct SampleHttpdStackOnExit {
    ~SampleHttpdStackOnExit() { stack_watch_sample(StackWatch::Httpd); }
};

bool read_header(httpd_req_t* req, const char* name, char* out, size_t cap, bool& present) {
    const size_t len = httpd_req_get_hdr_value_len(req, name);
    if (len >= cap) return false;
    // IDF returns length zero for both absent and supplied-empty headers. Only its value getter
    // distinguishes them; a supplied-empty Origin/Host must reach the policy as present.
    const esp_err_t result = httpd_req_get_hdr_value_str(req, name, out, cap);
    present                = result != ESP_ERR_NOT_FOUND;
    if (!present) {
        if (cap) out[0] = '\0';
        return len == 0;
    }
    return result == ESP_OK;
}

esp_err_t reject_request(httpd_req_t* req, const char* status, const char* message) {
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_sendstr(req, message);
}

bool trusted_lan_headers_allowed(httpd_req_t* req) {
    char host[96] = {}, origin[128] = {}, fetch_site[24] = {};
    HttpRequestHeaders headers{};
    if (!read_header(req, "Host", host, sizeof(host), headers.host_present) ||
        !read_header(req, "Origin", origin, sizeof(origin), headers.origin_present) ||
        !read_header(req, "Sec-Fetch-Site", fetch_site, sizeof(fetch_site),
                     headers.fetch_site_present))
        return false;
    headers.host       = host;
    headers.origin     = origin;
    headers.fetch_site = fetch_site;

    const WifiInfo wifi = wifi_info();
    const EthInfo  eth  = net_eth_info();
    return http_lan_request_allowed(headers, CONFIG_DAIKIN_HOSTNAME, wifi.ip, eth.ip);
}

bool json_post_allowed(httpd_req_t* req) {
    if (req->method != HTTP_POST || req->content_len == 0) return true;
    char content_type[96] = {};
    bool present = false;
    return read_header(req, "Content-Type", content_type, sizeof(content_type), present) && present &&
           http_json_content_type(content_type);
}

bool request_framing_allowed(httpd_req_t* req) {
    char value[32]      = {};
    bool length_present = false, transfer_present = false;
    // Only presence matters for unsupported transfer coding, including a supplied-empty field.
    if (!read_header(req, "Transfer-Encoding", value, 1, transfer_present) || transfer_present ||
        !read_header(req, "Content-Length", value, sizeof(value), length_present))
        return false;
    return !length_present || http_content_length_matches(value, req->content_len);
}

// Settle the body bytes the client still owes after its response (logic/http_body.hpp explains why
// IDF's own purge must never receive an unbounded remainder). noinline keeps the scratch buffer out
// of handle_then_settle_body's frame, which inlines handle_all under the deepest call chain on this
// task.
__attribute__((noinline)) bool discard_unread_body(httpd_req_t* req) {
    char          scratch[128];
    const int64_t deadline_us = esp_timer_get_time() + BODY_DISCARD_BUDGET_US;
    return http_body_discard(
        [req, &scratch]() -> BodyChunk {
            // 0: nothing remains, or the peer closed — then IDF's purge fails at once and closes
            // the session itself. Either way nothing can block.
            const int r = httpd_req_recv(req, scratch, sizeof(scratch));
            if (r == 0) return {BodyRecv::End, 0};
            if (r == HTTPD_SOCK_ERR_TIMEOUT) return {BodyRecv::Timeout, 0};
            if (r < 0) return {BodyRecv::Error, 0};
            return {BodyRecv::Data, static_cast<size_t>(r)};
        },
        [deadline_us]() -> bool { return esp_timer_get_time() >= deadline_us; });
}
} // namespace

// The single OOM/exception guard every HTTP handler runs under. http_register() stashes the real
// handler in user_ctx and installs this trampoline (behind handle_then_settle_body) as the route
// handler; we call the real handler
// inside try/catch so an out-of-memory throw (std::string / cJSON / TLS) turns into a 503 rather
// than crashing the device (which would also drop the poll cycle + MQTT availability).
static esp_err_t handle_all(httpd_req_t* req) {
    SampleHttpdStackOnExit sampler;
    auto                   fn = reinterpret_cast<esp_err_t (*)(httpd_req_t*)>(req->user_ctx);
    try {
        // Framing must precede every successful early response. IDF exposes a size_t length
        // parsed from uint64_t and does not decode chunked bodies; closing here prevents an
        // unread suffix becoming another request even when the narrowed length is zero.
        if (!request_framing_allowed(req)) {
            reject_request(req, "400 Bad Request", "unsupported request framing");
            return ESP_FAIL;
        }
        if (!fn) return httpd_resp_send_500(req);
        // Once the async OTA task owns TLS, every other POST is either allocation-rich (JSON,
        // Config, DNS/MQTT probes) or can reboot/change device state underneath the inactive-slot
        // write. Refuse before Host/body parsing and before any route-specific allocation. The
        // already accepted /ota/update POST raced this flag while it was still false; any later
        // update/config/MCP/probe POST is deliberately a small retryable busy response.
        if (req->method == HTTP_POST && ota_busy())
            return reject_request(req, "503 Service Unavailable",
                                  "Network TLS operation in progress; retry shortly");

        // The captive portal must answer arbitrary probe Host names so an OS can discover it. On
        // the configured LAN, however, every route — static UI, read API and POST control alike —
        // accepts only this device's mDNS/current-IP identities. This is the global DNS-rebinding
        // boundary; MCP used to enforce a WiFi-only copy inside one handler while every other route
        // remained reachable through a rebound hostname.
        if (!provisioning_ap_active() && !trusted_lan_headers_allowed(req))
            return reject_request(req, "403 Forbidden", "request origin not allowed");

        const bool ota_route =
            !provisioning_ap_active() && http_is_ota_route(req->uri, req->method == HTTP_POST);
        if (ota_download_active() && !ota_route)
            return reject_request(req, "503 Service Unavailable", "update in progress");
        if (heap_largest_internal_block() < 6144 && !ota_route)
            return reject_request(req, "503 Service Unavailable", "heap low");

        // All body-bearing POST handlers parse JSON. text/plain and HTML-form bodies are
        // deliberately refused: both are CORS-safelisted request shapes a hostile page can emit
        // without preflight. Bodyless actions (/detect, /ota/update, /crash/dismiss and the clear
        // endpoints) remain available to native clients without inventing an empty JSON envelope.
        if (!json_post_allowed(req))
            return reject_request(req, "415 Unsupported Media Type", "application/json required");
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

// What esp_http_server calls. Every answer — route, early rejection or the OOM/exception guard —
// passes here, so a body the client still owes is settled in one place: a session that cannot
// settle it within the bound returns ESP_FAIL and is closed instead of reaching IDF's unbounded
// purge.
static esp_err_t handle_then_settle_body(httpd_req_t* req) {
    const esp_err_t result = handle_all(req);
    if (result != ESP_OK) return result;
    if (!discard_unread_body(req)) return ESP_FAIL;
    finish_receive_budget(req);
    return ESP_OK;
}

esp_err_t http_open_session(httpd_handle_t server, int socket) {
    // The SDK owns this small context and frees it on every close, including failed opening.
    // No HTTP callback can unwind through the SDK's C frames.
    auto* budget = new (std::nothrow) HttpIngressSession;
    if (!budget) return ESP_ERR_NO_MEM;
    httpd_sess_set_transport_ctx(server, socket, budget, free_ingress_budget);
    if (httpd_sess_get_transport_ctx(server, socket) != budget) {
        delete budget;
        return ESP_FAIL;
    }
    const esp_err_t result = httpd_sess_set_recv_override(server, socket, receive_with_budget);
    if (result == ESP_OK) budget->admitted = true;
    return result;
}

void http_close_session(httpd_handle_t server, int socket) {
    const auto* state =
        static_cast<HttpIngressSession*>(httpd_sess_get_transport_ctx(server, socket));
    // IDF 6.1 deletes a failed open session, then accept_conn closes its descriptor again.
    // Failed admission therefore leaves the one close to accept_conn. Admitted sessions close
    // here normally; the SDK frees the transport context after this callback in both cases.
    if (state && state->admitted) close(socket);
}

void http_register(httpd_handle_t s, const char* uri, httpd_method_t method,
                   esp_err_t (*fn)(httpd_req_t*)) {
    httpd_uri_t u = {};
    u.uri         = uri;
    u.method      = method;
    u.handler     = handle_then_settle_body;
    u.user_ctx    = reinterpret_cast<void*>(fn);
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
    const int64_t deadline_us = esp_timer_get_time() + 30'000'000LL;
    return http_body_read(
        buf, max, req->content_len,
        [req](char* dst, size_t len) -> BodyChunk {
            const int r = httpd_req_recv(req, dst, len);
            if (r == HTTPD_SOCK_ERR_TIMEOUT) return {BodyRecv::Timeout, 0};
            if (r <= 0) return {BodyRecv::Error, 0};
            return {BodyRecv::Data, static_cast<size_t>(r)};
        },
        [deadline_us]() -> bool { return esp_timer_get_time() >= deadline_us; });
}

} // namespace daik
