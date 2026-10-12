#pragma once
// No socket, TLS, RTOS scheduler or heap implementation is supplied by this seam.
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_TIMEOUT = 0x107;
using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
using TaskHandle_t          = void*;
using SemaphoreHandle_t     = int*;
constexpr BaseType_t pdPASS = 1, pdTRUE = 1;
constexpr TickType_t portMAX_DELAY = UINT32_MAX, portTICK_PERIOD_MS = 1;
#define pdMS_TO_TICKS(n) (static_cast<TickType_t>(n))
struct FakeHttp {
    size_t offset = 0;
    bool   live = false, opened = false;
};
using esp_http_client_handle_t = FakeHttp*;
struct esp_http_client_config_t {
    const char* url                       = nullptr;
    int         timeout_ms                = 0;
    esp_err_t (*crt_bundle_attach)(void*) = nullptr;
    bool keep_alive_enable                = false;
};
namespace sdk {
struct Stop {};
// Exclude the adapter's own strings/vectors from production request-allocation observations.
inline unsigned adapter_allocation_depth = 0;
struct AdapterAllocationScope {
    AdapterAllocationScope() { ++adapter_allocation_depth; }
    ~AdapterAllocationScope() { --adapter_allocation_depth; }
};
inline bool                     fail_request_alloc = false;
inline TickType_t               ticks              = 0;
inline int                      mutex = 0, lock_depth = 0;
inline bool                     deadline_ready = true, task_fails = false, init_fails = false;
inline bool                     message_complete = true, read_fails = false;
inline esp_err_t                open_result = ESP_OK, arm_result = ESP_OK;
inline int                      status = 200, inits = 0, closes = 0, cleanups = 0, reads = 0;
inline int                      pauses = 0, resumes = 0, notified = 0;
inline int64_t                  claimed = -1, announced = 1;
inline TickType_t               open_ticks = 0, header_ticks = 0, read_ticks = 0;
inline size_t                   chunk_size = 1024;
inline std::string              body, url;
inline std::vector<int>         timeouts;
inline std::vector<std::string> events;
inline FakeHttp                 client;
inline void (*task_fn)(void*) = nullptr;
inline std::function<void(TickType_t)> on_delay, on_notify;
inline std::function<void()>           on_read, on_open, on_cleanup;
inline bool                            json_parse_fails = false;
inline bool                            fail_cpp_alloc = false, fail_alloc_after_parse = false;
inline size_t                          json_prefix_length = 0;
inline int                             json_parses = 0, json_deletes = 0;
} // namespace sdk
inline TickType_t xTaskGetTickCount() { return sdk::ticks; }
inline void       vTaskDelay(TickType_t ticks) {
    sdk::ticks += ticks;
    if (sdk::on_delay) sdk::on_delay(ticks);
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, uint32_t, void*, UBaseType_t,
                              TaskHandle_t* task) {
    if (sdk::task_fails) return 0;
    sdk::task_fn = fn;
    if (task) *task = &sdk::task_fn;
    return pdPASS;
}
inline SemaphoreHandle_t xSemaphoreCreateMutex() { return &sdk::mutex; }
inline BaseType_t        xSemaphoreTake(SemaphoreHandle_t sem, TickType_t) {
    if (!sem) return 0;
    ++sdk::lock_depth;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t) {
    --sdk::lock_depth;
    return pdTRUE;
}
inline void     xTaskNotifyGive(TaskHandle_t) { ++sdk::notified; }
inline uint32_t ulTaskNotifyTake(BaseType_t, TickType_t ticks) {
    if (ticks && sdk::on_notify) sdk::on_notify(ticks);
    sdk::ticks += ticks;
    return 0;
}
inline esp_err_t                esp_crt_bundle_attach(void*) { return ESP_OK; }
inline esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t* cfg) {
    ++sdk::inits;
    if (sdk::init_fails) return nullptr;
    sdk::AdapterAllocationScope adapter_allocations;
    sdk::url    = cfg->url;
    sdk::client = {0, true, false};
    sdk::events.push_back("init");
    return &sdk::client;
}
inline esp_err_t esp_http_client_open(FakeHttp* client, int) {
    sdk::ticks += sdk::open_ticks;
    if (sdk::on_open) sdk::on_open();
    client->opened = sdk::open_result == ESP_OK;
    sdk::AdapterAllocationScope adapter_allocations;
    sdk::events.push_back("open");
    return sdk::open_result;
}
inline esp_err_t esp_http_client_set_header(FakeHttp*, const char*, const char*) { return ESP_OK; }
inline esp_err_t esp_http_client_set_timeout_ms(FakeHttp*, int value) {
    sdk::AdapterAllocationScope adapter_allocations;
    sdk::timeouts.push_back(value);
    return ESP_OK;
}
inline int64_t esp_http_client_fetch_headers(FakeHttp*) {
    sdk::ticks += sdk::header_ticks;
    return sdk::announced;
}
inline int     esp_http_client_get_status_code(FakeHttp*) { return sdk::status; }
inline int64_t esp_http_client_get_content_length(FakeHttp*) { return sdk::claimed; }
inline int     esp_http_client_read(FakeHttp* client, char* output, int capacity) {
    ++sdk::reads;
    sdk::ticks += sdk::read_ticks;
    if (sdk::on_read) sdk::on_read();
    if (sdk::read_fails) return -1;
    const size_t remaining = sdk::body.size() - client->offset;
    const size_t amount =
        std::min(remaining, std::min(sdk::chunk_size, static_cast<size_t>(capacity)));
    std::memcpy(output, sdk::body.data() + client->offset, amount);
    client->offset += amount;
    return static_cast<int>(amount);
}
inline bool esp_http_client_is_complete_data_received(FakeHttp*) { return sdk::message_complete; }
inline esp_err_t esp_http_client_close(FakeHttp* client) {
    ++sdk::closes;
    client->opened = false;
    sdk::AdapterAllocationScope adapter_allocations;
    sdk::events.push_back("close");
    return ESP_OK;
}
inline esp_err_t esp_http_client_cleanup(FakeHttp* client) {
    ++sdk::cleanups;
    client->live = false;
    {
        sdk::AdapterAllocationScope adapter_allocations;
        sdk::events.push_back("cleanup");
    }
    if (sdk::on_cleanup) sdk::on_cleanup();
    return ESP_OK;
}
