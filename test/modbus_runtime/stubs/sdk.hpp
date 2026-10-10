#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <vector>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
using TickType_t                   = uint32_t;
using UBaseType_t                  = unsigned;
using BaseType_t                   = int;
constexpr BaseType_t pdTRUE        = 1;
constexpr BaseType_t pdPASS        = 1;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(x) (static_cast<TickType_t>(x))
struct FakeMutex {
    std::mutex mutex;
};
using SemaphoreHandle_t = FakeMutex*;
struct FakeTask {
    void (*fn)(void*);
    void*    arg;
    unsigned stack;
    unsigned priority;
};
using TaskHandle_t = FakeTask*;
namespace sdk {
extern std::atomic<int64_t>  clock_us;
extern std::atomic<bool>     real_clock;
extern bool                  transport_time_model;
extern int64_t               send_delay_us;
extern int64_t               receive_delay_us;
extern std::function<void()> on_send;
extern std::vector<int64_t>  watchdog_feeds;
ssize_t                      timed_send(int, const void*, size_t, int);
ssize_t                      timed_recv(int, void*, size_t, int);
extern bool                  fail_task_create;
extern bool                  fail_mutex_create;
extern int create_calls, delete_calls, delays, wdt_add, wdt_delete, wdt_reset, mdns_ptr_calls;
extern std::vector<TaskHandle_t>      tasks;
extern std::vector<SemaphoreHandle_t> mutexes;
extern std::function<void()>          on_delay, on_wdt_delete, on_mutex_give;
extern thread_local int               lock_depth;
int64_t                               time_us();
} // namespace sdk
inline int64_t           esp_timer_get_time() { return sdk::time_us(); }
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    if (sdk::fail_mutex_create) return nullptr;
    auto* m = new FakeMutex;
    sdk::mutexes.push_back(m);
    return m;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t m, TickType_t ticks) {
    if (!m) return 0;
    if (ticks == 0 && !m->mutex.try_lock()) return 0;
    if (ticks != 0) m->mutex.lock();
    ++sdk::lock_depth;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t m) {
    --sdk::lock_depth;
    m->mutex.unlock();
    if (sdk::on_mutex_give) sdk::on_mutex_give();
    return pdTRUE;
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, unsigned stack, void* arg,
                              unsigned priority, TaskHandle_t* handle) {
    ++sdk::create_calls;
    if (sdk::fail_task_create) return 0;
    auto* t = new FakeTask{fn, arg, stack, priority};
    sdk::tasks.push_back(t);
    *handle = t;
    return pdPASS;
}
inline void vTaskDelay(TickType_t ticks) {
    ++sdk::delays;
    sdk::clock_us.fetch_add(static_cast<int64_t>(ticks) * 1000);
    if (sdk::on_delay) sdk::on_delay();
}
inline void vTaskDelete(TaskHandle_t) { ++sdk::delete_calls; }
inline int  esp_task_wdt_add(TaskHandle_t) {
    ++sdk::wdt_add;
    return 0;
}
inline int esp_task_wdt_delete(TaskHandle_t) {
    ++sdk::wdt_delete;
    if (sdk::on_wdt_delete) sdk::on_wdt_delete();
    return 0;
}
inline int esp_task_wdt_reset() {
    ++sdk::wdt_reset;
    sdk::watchdog_feeds.push_back(sdk::time_us());
    return 0;
}
constexpr int ESP_OK             = 0;
constexpr int ESP_IPADDR_TYPE_V4 = 0;
struct esp_ip4_addr_t {
    uint32_t addr = 0;
};
struct esp_ip_addr_t {
    int type = 0;
    union Address {
        esp_ip4_addr_t ip4;
        Address() : ip4{} {}
    } u_addr;
};
struct mdns_ip_addr_t {
    esp_ip_addr_t   addr;
    mdns_ip_addr_t* next = nullptr;
};
struct mdns_result_t {
    const char*     hostname      = nullptr;
    const char*     instance_name = nullptr;
    mdns_ip_addr_t* addr          = nullptr;
    mdns_result_t*  next          = nullptr;
};
#define IP2STR(ip)                                                                                 \
    static_cast<unsigned>((ip)->addr & 0xff), static_cast<unsigned>(((ip)->addr >> 8) & 0xff),     \
        static_cast<unsigned>(((ip)->addr >> 16) & 0xff),                                          \
        static_cast<unsigned>(((ip)->addr >> 24) & 0xff)
namespace sdk {
extern mdns_result_t* mdns_results;
extern bool           discovery_time_model;
extern int            mdns_a_calls;
} // namespace sdk
inline int mdns_query_a(const char*, int timeout_ms, esp_ip4_addr_t*) {
    ++sdk::mdns_a_calls;
    if (sdk::discovery_time_model) sdk::clock_us.fetch_add(timeout_ms * 1000LL);
    return -1;
}
inline int mdns_query_ptr(const char*, const char*, int, int, mdns_result_t** result) {
    ++sdk::mdns_ptr_calls;
    if (sdk::discovery_time_model) sdk::clock_us.fetch_add(3000000);
    *result = sdk::mdns_results;
    return *result ? ESP_OK : -1;
}
inline void mdns_query_results_free(mdns_result_t*) {}
