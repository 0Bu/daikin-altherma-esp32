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
inline unsigned  fail_mutex_create = 0;
inline unsigned  takes = 0, gives = 0;
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
    ++sdk::mutex_count;
    if (sdk::mutex_count == sdk::fail_mutex_create) return nullptr;
    if (sdk::mutex_count == 1) {
        sdk::mutex = {};
        return &sdk::mutex;
    }
    if (sdk::mutex_count > 4) throw std::runtime_error("modeled mutex pool exhausted");
    auto& mutex = sdk::additional_mutexes[sdk::mutex_count - 2];
    mutex       = {};
    return &mutex;
}
namespace sdk {
inline bool     measure_busy_lock   = false;
inline unsigned blocking_busy_takes = 0;
} // namespace sdk
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t wait) {
    if (sdk::before_take) {
        auto f           = sdk::before_take;
        sdk::before_take = nullptr;
        f();
    }
    if (!s) return pdFALSE;
    if (s->owned) {
        if (!wait) return pdFALSE;
        if (sdk::measure_busy_lock) {
            ++sdk::blocking_busy_takes;
            return pdFALSE;
        }
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

#include <cstddef>
#include <utility>
#include <vector>
inline constexpr esp_err_t ESP_FAIL                 = -1;
inline constexpr esp_err_t ESP_ERR_INVALID_ARG      = 2;
inline constexpr esp_err_t ESP_ERR_INVALID_SIZE     = 3;
inline constexpr esp_err_t ESP_ERR_INVALID_RESPONSE = 4;
struct esp_partition_t {
    uint32_t address;
    size_t   size;
};
inline constexpr int ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_ANY = 0xff;
namespace journal_sdk {
inline std::vector<uint8_t>                   flash;
inline std::vector<std::pair<size_t, size_t>> erased_ranges;
inline unsigned                               reads = 0, writes = 0, erases = 0;
inline unsigned                               fail_read = 0, fail_write = 0, fail_erase = 0;
inline bool                                   accept_then_fail = false;
inline int64_t                                unix_origin      = 1699999200;
inline bool                                   synced           = true;
inline unsigned                               core_appended = 0, core_restore = 0, stop_expiry = 0;
inline bool                                   core_pending = false;
inline int64_t                                core_bucket  = INT64_MIN;

inline void (*during_find)() = nullptr;
inline void (*during_read)() = nullptr;
} // namespace journal_sdk
const esp_partition_t* esp_partition_find_first(int, int, const char*);
esp_err_t              esp_partition_read(const esp_partition_t*, size_t, void*, size_t);
esp_err_t              esp_partition_write(const esp_partition_t*, size_t, const void*, size_t);
esp_err_t              esp_partition_erase_range(const esp_partition_t*, size_t, size_t);
inline uint32_t        esp_get_free_heap_size() { return 100000; }
