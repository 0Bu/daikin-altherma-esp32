#pragma once
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <stdexcept>
using esp_err_t             = int;
constexpr esp_err_t ESP_OK  = 0;
using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
using TaskHandle_t          = void*;
constexpr BaseType_t pdPASS = 1, pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(n) (static_cast<TickType_t>(n))
struct StaticSemaphore_t {
    bool     binary = false;
    bool     owned  = false;
    unsigned count  = 0;
};
using SemaphoreHandle_t = StaticSemaphore_t*;
namespace sdk {
struct Stop {};
inline int64_t           now_us      = 1000000;
inline unsigned          delay_count = 0, lock_depth = 0, takes = 0, gives = 0;
inline unsigned          watchdog_resets = 0, watchdog_adds = 0, stack_samples = 0;
inline unsigned          queries = 0, uart_inits = 0, failures = 0, failed_lock_depth = 999;
inline unsigned          checkup_unread = 0, dwell_unread = 0, history_commits = 0;
inline unsigned          skipped_logs      = 0;
inline size_t            failed_bytes      = 0;
inline bool              fail_poll_reserve = false, fail_next_new = false, ota_active = false;
inline StaticSemaphore_t mutex;
inline void (*task_fn)(void*)       = nullptr;
inline void (*on_delay)(TickType_t) = nullptr;
} // namespace sdk
inline int64_t esp_timer_get_time() { return sdk::now_us; }
inline int     esp_task_wdt_reset() {
    ++sdk::watchdog_resets;
    return ESP_OK;
}
inline int esp_task_wdt_add(void*) {
    ++sdk::watchdog_adds;
    return ESP_OK;
}
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    sdk::mutex = {};
    return &sdk::mutex;
}
inline SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* s) {
    *s = {};
    return s;
}
inline SemaphoreHandle_t xSemaphoreCreateBinaryStatic(StaticSemaphore_t* s) {
    *s        = {};
    s->binary = true;
    return s;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t ticks) {
    if (!s) return pdFALSE;
    if (s->binary) {
        if (!s->count) return pdFALSE;
        --s->count;
        return pdTRUE;
    }
    if (s->owned) {
        if (ticks == 0) return pdFALSE;
        throw std::runtime_error("adapter detected stranded nonrecursive mutex");
    }
    s->owned = true;
    ++sdk::lock_depth;
    ++sdk::takes;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t s) {
    if (!s) return pdFALSE;
    if (s->binary) {
        s->count = 1;
        return pdTRUE;
    }
    if (!s->owned || !sdk::lock_depth)
        throw std::runtime_error("adapter detected unowned mutex release");
    s->owned = false;
    --sdk::lock_depth;
    ++sdk::gives;
    return pdTRUE;
}
inline void vTaskDelay(TickType_t ticks) {
    ++sdk::delay_count;
    sdk::now_us += static_cast<int64_t>(ticks) * 1000;
    if (sdk::on_delay) sdk::on_delay(ticks);
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, uint32_t, void*, UBaseType_t,
                              TaskHandle_t*) {
    sdk::task_fn = fn;
    return pdPASS;
}
