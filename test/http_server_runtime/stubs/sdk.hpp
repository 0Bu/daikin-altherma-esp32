#pragma once
// Only SDK transport/state adapters; production HTTP dispatch and MCP code compile unchanged.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <map>
#include <string>
#include <vector>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_HTTPD_HANDLERS_FULL = 0x7005;
constexpr esp_err_t ESP_ERR_NOT_FOUND = 0x105, ESP_ERR_HTTPD_RESULT_TRUNC = 0x7008;
constexpr esp_err_t ESP_ERR_NO_MEM = 0x101;
using httpd_handle_t   = void*;
using httpd_method_t   = int;
constexpr int HTTP_GET = 0, HTTP_POST = 1, HTTPD_SOCK_ERR_TIMEOUT = -3;
constexpr int HTTPD_SOCK_ERR_FAIL = -1;
using httpd_recv_func_t           = int (*)(httpd_handle_t, int, char*, size_t, int);
using httpd_free_ctx_fn_t         = void (*)(void*);
struct httpd_req_t {
    httpd_handle_t handle      = reinterpret_cast<void*>(1);
    int            sockfd      = -1;
    httpd_method_t method      = HTTP_GET;
    const char*    uri         = "/";
    void*          user_ctx    = nullptr;
    size_t         content_len = 0, consumed = 0, fragment = 8192, recv_calls = 0, recv_bytes = 0,
           header_reads = 0;
    std::string                        body, response, status = "200 OK", content_type;
    std::map<std::string, std::string> headers, response_headers;
    std::deque<int>                    receive_script;
    bool                               header_failure = false;
    std::string                        failed_header;
    int                                fail_chunk = -1;
    unsigned                           chunks = 0, final_chunks = 0;
    size_t                             max_chunk = 0;
};
struct httpd_uri_t {
    const char*    uri                 = nullptr;
    httpd_method_t method              = HTTP_GET;
    esp_err_t (*handler)(httpd_req_t*) = nullptr;
    void* user_ctx                     = nullptr;
};
struct httpd_config_t {
    esp_err_t (*open_fn)(httpd_handle_t, int)              = nullptr;
    void (*close_fn)(httpd_handle_t, int)                  = nullptr;
    unsigned recv_wait_timeout                             = 5;
    bool (*uri_match_fn)(const char*, const char*, size_t) = nullptr;
    size_t max_uri_handlers = 8, stack_size = 4096;
    bool   lru_purge_enable = false;
};
inline httpd_config_t HTTPD_DEFAULT_CONFIG() { return {}; }
namespace sdk {
struct Session {
    void*               context      = nullptr;
    httpd_free_ctx_fn_t free_context = nullptr;
    httpd_recv_func_t   receive      = nullptr;
};
inline std::map<int, Session>   sessions;
inline bool                     fail_receive_override = false;
inline std::vector<httpd_uri_t> routes;
inline httpd_config_t           config;
inline bool                     fail_start        = false;
inline int                      fail_registration = -1;
inline unsigned                 start_calls = 0, registration_calls = 0;
inline std::string              log;
inline int64_t                  now = 0, clock_step = 0;
inline std::string              lower(std::string value) {
    for (auto& c : value)
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return value;
}
inline const std::string* header(httpd_req_t* req, const char* name) {
    for (const auto& [key, value] : req->headers)
        if (lower(key) == lower(name)) return &value;
    return nullptr;
}
template <typename... Args> void record(const char* format, Args... args) {
    char bytes[1024];
    if constexpr (sizeof...(args) == 0)
        std::snprintf(bytes, sizeof(bytes), "%s", format);
    else
        std::snprintf(bytes, sizeof(bytes), format, args...);
    log += bytes;
    log += '\n';
}
} // namespace sdk
inline int   httpd_req_to_sockfd(httpd_req_t* req) { return req->sockfd; }
inline void* httpd_sess_get_transport_ctx(httpd_handle_t, int fd) {
    const auto it = sdk::sessions.find(fd);
    return it == sdk::sessions.end() ? nullptr : it->second.context;
}
inline void httpd_sess_set_transport_ctx(httpd_handle_t, int fd, void* ctx,
                                         httpd_free_ctx_fn_t free_fn) {
    const auto it = sdk::sessions.find(fd);
    if (it == sdk::sessions.end()) return;
    if (it->second.context && it->second.free_context) it->second.free_context(it->second.context);
    it->second.context      = ctx;
    it->second.free_context = free_fn;
}
inline esp_err_t httpd_sess_set_recv_override(httpd_handle_t, int fd, httpd_recv_func_t fn) {
    const auto it = sdk::sessions.find(fd);
    if (it == sdk::sessions.end() || sdk::fail_receive_override) return ESP_FAIL;
    it->second.receive = fn;
    return ESP_OK;
}
#define ESP_LOGE(tag, format, ...) sdk::record(format, ##__VA_ARGS__)
#define ESP_LOGI(tag, format, ...) sdk::record(format, ##__VA_ARGS__)
inline const char* esp_err_to_name(esp_err_t error) {
    return error == ESP_ERR_HTTPD_HANDLERS_FULL ? "ESP_ERR_HTTPD_HANDLERS_FULL" : "ESP_FAIL";
}
inline int64_t esp_timer_get_time() {
    sdk::now += sdk::clock_step;
    return sdk::now;
}
inline bool      httpd_uri_match_wildcard(const char*, const char*, size_t) { return true; }
inline esp_err_t httpd_start(httpd_handle_t* handle, const httpd_config_t* config) {
    ++sdk::start_calls;
    sdk::config = *config;
    if (sdk::fail_start) return ESP_FAIL;
    *handle = reinterpret_cast<void*>(1);
    return ESP_OK;
}
inline esp_err_t httpd_register_uri_handler(httpd_handle_t, const httpd_uri_t* route) {
    const int index = static_cast<int>(sdk::registration_calls++);
    if (index == sdk::fail_registration || sdk::routes.size() >= sdk::config.max_uri_handlers)
        return ESP_ERR_HTTPD_HANDLERS_FULL;
    sdk::routes.push_back(*route);
    return ESP_OK;
}
inline size_t httpd_req_get_hdr_value_len(httpd_req_t* req, const char* name) {
    ++req->header_reads;
    const auto* value = sdk::header(req, name);
    return value ? value->size() : 0;
}
inline esp_err_t httpd_req_get_hdr_value_str(httpd_req_t* req, const char* name, char* out,
                                             size_t cap) {
    const auto* value = sdk::header(req, name);
    if (req->header_failure || sdk::lower(req->failed_header) == sdk::lower(name)) return ESP_FAIL;
    if (!value) return ESP_ERR_NOT_FOUND;
    if (value->size() >= cap) return ESP_ERR_HTTPD_RESULT_TRUNC;
    std::memcpy(out, value->c_str(), value->size() + 1);
    return ESP_OK;
}
inline int httpd_req_recv(httpd_req_t* req, char* dst, size_t cap) {
    ++req->recv_calls;
    if (!req->receive_script.empty()) {
        const int result = req->receive_script.front();
        req->receive_script.pop_front();
        if (result <= 0) return result;
        cap = std::min(cap, static_cast<size_t>(result));
    }
    if (req->consumed == req->body.size()) return 0;
    const size_t count = std::min({cap, req->fragment, req->body.size() - req->consumed});
    std::memcpy(dst, req->body.data() + req->consumed, count);
    req->consumed += count;
    req->recv_bytes += count;
    return static_cast<int>(count);
}
inline esp_err_t httpd_resp_set_status(httpd_req_t* req, const char* status) {
    req->status = status;
    return ESP_OK;
}
inline esp_err_t httpd_resp_set_type(httpd_req_t* req, const char* type) {
    req->content_type = type;
    return ESP_OK;
}
inline esp_err_t httpd_resp_set_hdr(httpd_req_t* req, const char* name, const char* value) {
    req->response_headers[name] = value;
    return ESP_OK;
}
inline esp_err_t httpd_resp_send(httpd_req_t* req, const char* bytes, size_t size) {
    req->response.assign(bytes ? bytes : "", size);
    return ESP_OK;
}
inline esp_err_t httpd_resp_sendstr(httpd_req_t* req, const char* text) {
    return httpd_resp_send(req, text, std::strlen(text));
}
inline esp_err_t httpd_resp_send_500(httpd_req_t* req) {
    req->status = "500 Internal Server Error";
    return httpd_resp_sendstr(req, "500");
}
inline esp_err_t httpd_resp_send_chunk(httpd_req_t* req, const char* bytes, size_t size) {
    if (req->fail_chunk == static_cast<int>(req->chunks)) return ESP_FAIL;
    if (!bytes)
        ++req->final_chunks;
    else {
        ++req->chunks;
        req->max_chunk = std::max(req->max_chunk, size);
        req->response.append(bytes, size);
    }
    return ESP_OK;
}
struct esp_app_desc_t {
    const char* version = "fixture-version";
};
inline const esp_app_desc_t* esp_app_get_description() {
    static esp_app_desc_t desc;
    return &desc;
}
