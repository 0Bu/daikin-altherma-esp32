// Shared HTTP helpers. See http_handlers.hpp.
//
// OOM discipline: heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest
// contiguous free block). A handler that builds a big response should wrap it in a try/catch and
// return 503 on std::bad_alloc rather than letting an uncaught throw unwind through C frames to
// std::terminate -> abort() -> reboot. Stream large output (e.g. /diag) instead of one big
// std::string. (See docs/ARCHITECTURE.md → Memory constraints.)
#include "http_handlers.hpp"

namespace daik {

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

int http_read_body(httpd_req_t* req, char* buf, size_t max) {
    int total = req->content_len;
    if (total <= 0 || static_cast<size_t>(total) >= max) return -1;
    int r = httpd_req_recv(req, buf, total);
    if (r <= 0) return -1;
    buf[r] = '\0';
    return r;
}

} // namespace daik
