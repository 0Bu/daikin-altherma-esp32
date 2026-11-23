#pragma once
#include <cstdint>
#include <stdexcept>
using TickType_t            = uint32_t;
constexpr int        pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
struct HostMutex {
    bool owned = false;
};
using SemaphoreHandle_t = HostMutex*;
namespace sdk {
inline HostMutex mutex;
inline int64_t   now_us        = 1000000;
inline int64_t   origin_us     = 1699999200LL * 1000000; // exact UTC hour
inline bool      synced        = true;
inline unsigned  reads         = 0;
inline unsigned  creates       = 0;
inline bool      fail_create   = false;
inline unsigned  fail_takes    = 0;
inline void (*before_create)() = nullptr;
inline void (*before_take)()   = nullptr;
} // namespace sdk
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    ++sdk::creates;
    if (sdk::before_create) {
        const auto hook    = sdk::before_create;
        sdk::before_create = nullptr;
        hook();
    }
    return sdk::fail_create ? nullptr : &sdk::mutex;
}
inline int xSemaphoreTake(SemaphoreHandle_t mutex, TickType_t ticks) {
    if (sdk::before_take) {
        const auto hook  = sdk::before_take;
        sdk::before_take = nullptr;
        hook();
    }
    if (!mutex) return pdFALSE;
    if (sdk::fail_takes) {
        --sdk::fail_takes;
        return pdFALSE;
    }
    if (mutex->owned) {
        if (!ticks) return pdFALSE;
        throw std::runtime_error("recursive hydronic lock");
    }
    mutex->owned = true;
    return pdTRUE;
}
inline int xSemaphoreGive(SemaphoreHandle_t mutex) {
    if (!mutex || !mutex->owned) throw std::runtime_error("unmatched hydronic mutex give");
    mutex->owned = false;
    return pdTRUE;
}
inline int64_t esp_timer_get_time() { return sdk::now_us; }
