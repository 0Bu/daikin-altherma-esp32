#pragma once
#include <cstdint>
#include <stdexcept>
using TickType_t            = uint32_t;
using BaseType_t            = int;
constexpr int        pdTRUE = 1, pdFALSE = 0;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
struct HostMutex {
    bool owned = false;
};
using SemaphoreHandle_t = HostMutex*;
namespace sdk {
inline HostMutex mutexes[4];
inline unsigned  created      = 0;
inline int64_t   now_us       = 1000000;
inline int64_t   origin_us    = 1699999200LL * 1000000;
inline bool      synced       = true;
inline unsigned  reads        = 0;
inline unsigned  create_calls = 0, takes = 0, gives = 0;
inline bool      fail_create = false, fail_take_once = false;
inline void (*before_take)()   = nullptr;
inline void (*before_create)() = nullptr;
inline void (*after_create)()  = nullptr;
inline void (*before_clock)()  = nullptr;
} // namespace sdk
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    ++sdk::create_calls;
    if (sdk::before_create) {
        const auto hook    = sdk::before_create;
        sdk::before_create = nullptr;
        hook();
    }
    if (sdk::fail_create) return nullptr;
    if (sdk::created == 4) throw std::runtime_error("mutex pool exhausted");
    auto mutex = &sdk::mutexes[sdk::created++];
    if (sdk::after_create) {
        const auto hook   = sdk::after_create;
        sdk::after_create = nullptr;
        hook();
    }
    return mutex;
}
inline int xSemaphoreTake(SemaphoreHandle_t m, TickType_t ticks) {
    if (sdk::before_take) {
        const auto hook  = sdk::before_take;
        sdk::before_take = nullptr;
        hook();
    }
    if (!m) return pdFALSE;
    if (sdk::fail_take_once) {
        sdk::fail_take_once = false;
        return pdFALSE;
    }
    if (m->owned) {
        if (!ticks) return pdFALSE;
        throw std::runtime_error("recursive observation lock");
    }
    m->owned = true;
    ++sdk::takes;
    return pdTRUE;
}
inline int xSemaphoreGive(SemaphoreHandle_t m) {
    if (!m || !m->owned) throw std::runtime_error("unmatched mutex give");
    m->owned = false;
    ++sdk::gives;
    return pdTRUE;
}
inline int64_t esp_timer_get_time() {
    if (sdk::before_clock) {
        const auto hook   = sdk::before_clock;
        sdk::before_clock = nullptr;
        hook();
    }
    return sdk::now_us;
}
