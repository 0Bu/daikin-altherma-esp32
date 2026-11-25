#pragma once
#include <cstdint>
#include <cstdlib>
using TickType_t            = uint32_t;
constexpr int        pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
struct StaticSemaphore_t {
    bool owned = false;
};
using SemaphoreHandle_t = StaticSemaphore_t*;
namespace sdk {
inline SemaphoreHandle_t mutex  = nullptr;
inline int64_t           now_us = 0, origin_us = 472222LL * 3600000000LL;
inline bool              synced = true, busy = false;
inline unsigned          reads = 0;
inline void (*read_hook)()     = nullptr;
inline void (*on_wait)()       = nullptr;
inline unsigned blocking_waits = 0;
} // namespace sdk
inline SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* p) {
    sdk::mutex = p;
    return p;
}
inline int xSemaphoreTake(SemaphoreHandle_t p, TickType_t ticks) {
    if (!p) return pdFALSE;
    if (sdk::busy || p->owned) {
        if (!ticks) return pdFALSE;
        ++sdk::blocking_waits;
        if (!sdk::on_wait) std::abort();
        auto callback = sdk::on_wait;
        sdk::on_wait  = nullptr;
        callback();
        if (sdk::busy || p->owned) std::abort();
    }
    p->owned = true;
    return pdTRUE;
}
inline int xSemaphoreGive(SemaphoreHandle_t p) {
    if (!p || !p->owned) std::abort();
    p->owned = false;
    return pdTRUE;
}
inline int64_t esp_timer_get_time() { return sdk::now_us; }
