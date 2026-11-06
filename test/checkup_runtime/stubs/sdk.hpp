#pragma once
// Deterministic host ports only. Real production headers and SemGuard remain in use.
#include <cstdint>
#include <stdexcept>
using esp_err_t                    = int;
inline constexpr esp_err_t ESP_OK  = 0;
using TickType_t                   = uint32_t;
using BaseType_t                   = int;
inline constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
inline constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(v) (static_cast<TickType_t>(v))
#define __NOINIT_ATTR
struct HostMutex {
    bool owned = false;
};
using SemaphoreHandle_t = HostMutex*;
namespace sdk {
inline int64_t   now_us = 1000000;
inline HostMutex mutex;
inline HostMutex additional_mutexes[3];
inline unsigned  mutex_count = 0;
inline unsigned  takes = 0, gives = 0;
inline bool      fail_take_once = false;
inline bool      fail_create_once = false;
inline void (*before_take)() = nullptr;
inline void (*shutdown)()    = nullptr;
} // namespace sdk
inline int64_t     esp_timer_get_time() { return sdk::now_us; }
inline int         esp_reset_reason() { return 1; } // modeled cold/clean power-on
inline const char* esp_err_to_name(esp_err_t) { return "host-adapter"; }
inline esp_err_t   esp_register_shutdown_handler(void (*fn)()) {
    sdk::shutdown = fn;
    return ESP_OK;
}
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    if (sdk::fail_create_once) {
        sdk::fail_create_once = false;
        return nullptr;
    }
    if (sdk::mutex_count++ == 0) {
        sdk::mutex = {};
        return &sdk::mutex;
    }
    if (sdk::mutex_count > 4) throw std::runtime_error("modeled mutex pool exhausted");
    auto& mutex = sdk::additional_mutexes[sdk::mutex_count - 2];
    mutex       = {};
    return &mutex;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t wait) {
    if (sdk::before_take) {
        auto f           = sdk::before_take;
        sdk::before_take = nullptr;
        f();
    }
    if (!s) return pdFALSE;
    if (sdk::fail_take_once) {
        sdk::fail_take_once = false;
        return pdFALSE;
    }
    if (s->owned) {
        if (!wait) return pdFALSE;
        throw std::runtime_error("modeled recursive lock");
    }
    s->owned = true;
    ++sdk::takes;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t s) {
    if (!s || !s->owned) throw std::runtime_error("modeled unmatched give");
    s->owned = false;
    ++sdk::gives;
    return pdTRUE;
}
