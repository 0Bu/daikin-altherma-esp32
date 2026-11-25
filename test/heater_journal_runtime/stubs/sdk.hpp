#pragma once
#include <cstddef>
#include <cstdint>
#include <stdexcept>
using esp_err_t                   = int;
inline constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_INVALID_ARG = 2;
inline constexpr esp_err_t ESP_ERR_INVALID_SIZE = 3, ESP_ERR_INVALID_STATE = 4;
inline constexpr esp_err_t ESP_ERR_INVALID_RESPONSE = 5, ESP_ERR_NOT_FINISHED = 6;
using TickType_t                   = uint32_t;
using BaseType_t                   = int;
inline constexpr BaseType_t pdTRUE = 1, pdFALSE = 0;
inline constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(value) (static_cast<TickType_t>(value))
struct HostMutex {
    bool owned = false;
};
using SemaphoreHandle_t = HostMutex*;
using StaticSemaphore_t = HostMutex;
struct esp_partition_t {
    size_t size;
};
namespace sdk {
inline int64_t    now_us = 1000000, origin_us = 1700002800000000LL;
inline int64_t    record_read_cost_us = 0;
inline bool       synced              = true;
inline unsigned   takes = 0, gives = 0, lock_depth = 0;
inline HostMutex  flash_mutex;
inline HostMutex* store_mutex           = nullptr;
inline bool       store_busy            = false;
inline bool       busy_after_store_give = false;
inline unsigned   busy_zero_waits = 0, busy_blocking_takes = 0;
} // namespace sdk
inline int64_t           esp_timer_get_time() { return sdk::now_us; }
inline const char*       esp_err_to_name(esp_err_t) { return "host-transport-error"; }
inline SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* storage) {
    if (!storage) return nullptr;
    *storage = {};
    if (!sdk::store_mutex) sdk::store_mutex = storage;
    return storage;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t mutex, TickType_t wait) {
    if (!mutex) return pdFALSE;
    // Model another owner being runnable: a nonblocking attempt loses, a blocking one
    // waits for that owner and then acquires. This is a contention witness, not RTOS timing.
    if (mutex == sdk::store_mutex && sdk::store_busy) {
        if (!wait) {
            ++sdk::busy_zero_waits;
            return pdFALSE;
        }
        sdk::store_busy = false;
        ++sdk::busy_blocking_takes;
    }
    if (mutex->owned) {
        if (!wait) return pdFALSE;
        throw std::runtime_error("recursive modeled mutex");
    }
    mutex->owned = true;
    ++sdk::takes;
    ++sdk::lock_depth;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t mutex) {
    if (!mutex || !mutex->owned || !sdk::lock_depth)
        throw std::runtime_error("unbalanced modeled mutex");
    mutex->owned = false;
    ++sdk::gives;
    --sdk::lock_depth;
    if (mutex == sdk::store_mutex && sdk::busy_after_store_give) {
        sdk::busy_after_store_give = false;
        sdk::store_busy            = true;
    }
    return pdTRUE;
}
esp_err_t esp_partition_read(const esp_partition_t*, size_t, void*, size_t);
esp_err_t esp_partition_write(const esp_partition_t*, size_t, const void*, size_t);
esp_err_t esp_partition_erase_range(const esp_partition_t*, size_t, size_t);
