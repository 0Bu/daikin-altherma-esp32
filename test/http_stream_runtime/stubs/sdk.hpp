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
using httpd_handle_t               = void*;
using httpd_method_t               = int;
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
    unsigned emission_attempts = 0, replacement_responses = 0, late_status_changes = 0;
};
struct httpd_uri_t {
    const char*    uri                 = nullptr;
    httpd_method_t method              = HTTP_GET;
    esp_err_t (*handler)(httpd_req_t*) = nullptr;
    void* user_ctx                     = nullptr;
};
struct httpd_config_t {
    esp_err_t (*open_fn)(httpd_handle_t, int)              = nullptr;
    unsigned recv_wait_timeout                             = 5;
    bool (*uri_match_fn)(const char*, const char*, size_t) = nullptr;
    size_t max_uri_handlers = 8, stack_size = 4096;
    bool   lru_purge_enable = false;
};
inline httpd_config_t HTTPD_DEFAULT_CONFIG() { return {}; }
namespace sdk {
inline bool   track_allocations = false;
inline size_t allocations = 0, fail_allocation = 0;
inline void (*after_chunk)() = nullptr;
struct TransportAllocation {
    bool previous = track_allocations;
    TransportAllocation() { track_allocations = false; }
    ~TransportAllocation() { track_allocations = previous; }
};
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
    TransportAllocation transport;
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
    sdk::TransportAllocation transport;
    const auto*              value = sdk::header(req, name);
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
    sdk::TransportAllocation transport;
    if (req->emission_attempts) ++req->late_status_changes;
    req->status = status;
    return ESP_OK;
}
inline esp_err_t httpd_resp_set_type(httpd_req_t* req, const char* type) {
    sdk::TransportAllocation transport;
    req->content_type = type;
    return ESP_OK;
}
inline esp_err_t httpd_resp_set_hdr(httpd_req_t* req, const char* name, const char* value) {
    sdk::TransportAllocation transport;
    req->response_headers[name] = value;
    return ESP_OK;
}
inline esp_err_t httpd_resp_send(httpd_req_t* req, const char* bytes, size_t size) {
    sdk::TransportAllocation transport;
    if (req->emission_attempts) ++req->replacement_responses;
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
    sdk::TransportAllocation transport;
    if (bytes) ++req->emission_attempts;
    if (req->fail_chunk == static_cast<int>(req->chunks)) {
        req->fail_chunk = -1;
        return ESP_FAIL;
    }
    if (!bytes)
        ++req->final_chunks;
    else {
        ++req->chunks;
        req->max_chunk = std::max(req->max_chunk, size);
        req->response.append(bytes, size);
        if (req->chunks == 1 && sdk::after_chunk) sdk::after_chunk();
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

using TickType_t            = uint32_t;
using BaseType_t            = int;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX, portTICK_PERIOD_MS = 1;
#define pdMS_TO_TICKS(value) static_cast<TickType_t>(value)
struct FixtureMutex {
    bool held = false;
};
using SemaphoreHandle_t = FixtureMutex*;
using StaticSemaphore_t = FixtureMutex;
inline FixtureMutex      fixture_mutex;
inline SemaphoreHandle_t xSemaphoreCreateMutex() { return &fixture_mutex; }
inline BaseType_t        xSemaphoreTake(SemaphoreHandle_t m, TickType_t) {
    if (!m || m->held) return pdFALSE;
    m->held = true;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t m) {
    if (m) m->held = false;
    return pdTRUE;
}
inline uint32_t   fixture_ticks = 0;
inline TickType_t xTaskGetTickCount() { return fixture_ticks; }
inline void (*fixture_delay)(TickType_t) = nullptr;
inline void vTaskDelay(TickType_t ticks) {
    fixture_ticks += ticks;
    if (fixture_delay) fixture_delay(ticks);
}
inline uint32_t esp_random() { return 0x10203040; }
inline int      esp_reset_reason() { return 1; }
inline uint32_t esp_get_free_heap_size() { return 65536; }
inline uint32_t esp_get_minimum_free_heap_size() { return 32768; }
inline void     esp_app_get_elf_sha256(char* out, size_t cap) {
    if (cap) {
        std::memset(out, 'a', cap - 1);
        out[cap - 1] = '\0';
    }
}
struct esp_partition_t {
    size_t address = 0, size = 0;
};
constexpr int                 ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_DATA_COREDUMP = 3;
inline const esp_partition_t* esp_partition_find_first(int, int, const char*) { return nullptr; }
inline esp_err_t              esp_partition_read(const esp_partition_t*, size_t, void*, size_t) {
    return ESP_FAIL;
}
inline esp_err_t esp_core_dump_image_get(size_t*, size_t*) { return ESP_FAIL; }
inline esp_err_t esp_core_dump_image_erase() { return ESP_FAIL; }
constexpr int    HTTPD_414_URI_TOO_LONG = 414, HTTPD_500_INTERNAL_SERVER_ERROR = 500;
constexpr int    HTTPD_400_BAD_REQUEST = 400, HTTPD_404_NOT_FOUND = 404;
inline size_t    httpd_req_get_url_query_len(httpd_req_t* req) {
    const char* q = std::strchr(req->uri, '?');
    return q ? std::strlen(q + 1) : 0;
}
inline esp_err_t httpd_req_get_url_query_str(httpd_req_t* req, char* out, size_t cap) {
    const char* q = std::strchr(req->uri, '?');
    if (!q) return ESP_ERR_NOT_FOUND;
    if (std::strlen(q + 1) >= cap) return ESP_ERR_HTTPD_RESULT_TRUNC;
    std::strcpy(out, q + 1);
    return ESP_OK;
}
inline esp_err_t httpd_query_key_value(const char* query, const char* key, char* out, size_t cap) {
    const size_t key_length = std::strlen(key);
    while (*query) {
        const char* end = std::strchr(query, '&');
        if (!end) end = query + std::strlen(query);
        if (static_cast<size_t>(end - query) > key_length &&
            std::memcmp(query, key, key_length) == 0 && query[key_length] == '=') {
            const size_t length = static_cast<size_t>(end - query) - key_length - 1;
            if (length >= cap) return ESP_ERR_HTTPD_RESULT_TRUNC;
            std::memcpy(out, query + key_length + 1, length);
            out[length] = '\0';
            return ESP_OK;
        }
        query = *end ? end + 1 : end;
    }
    return ESP_ERR_NOT_FOUND;
}
inline esp_err_t httpd_resp_send_err(httpd_req_t* req, int error, const char* message) {
    httpd_resp_set_status(req, error == 414 ? "414 URI Too Long" : "500 Internal Server Error");
    return httpd_resp_sendstr(req, message);
}
#define __NOINIT_ATTR
