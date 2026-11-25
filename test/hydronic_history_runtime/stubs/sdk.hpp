#pragma once
// Reuse the deterministic mutex/clock port; production service headers remain real.
#include "../../checkup_runtime/stubs/sdk.hpp"
#include <cstddef>
#include <vector>
inline constexpr esp_err_t ESP_FAIL = -1, ESP_ERR_INVALID_ARG = 2, ESP_ERR_INVALID_SIZE = 3,
                           ESP_ERR_INVALID_RESPONSE = 4, ESP_ERR_INVALID_STATE = 5,
                           ESP_ERR_NOT_FINISHED = 6;
struct esp_partition_t {
    uint32_t address;
    size_t   size;
};
inline constexpr int ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_ANY = 0xff;
namespace journal_sdk {
inline std::vector<uint8_t>                   flash;
inline std::vector<std::pair<size_t, size_t>> erased_ranges;
inline unsigned                               reads = 0, writes = 0, erases = 0;
inline unsigned                               fail_read = 0, fail_write = 0;
inline bool                                   accept_then_fail = false;
inline int64_t                                unix_origin      = 1699999200;
inline bool                                   synced           = true;
inline unsigned                               core_appended = 0, core_restore = 0;
inline unsigned                               stop_expiry = 0, hydronic_expiry = 0;
inline size_t                                 core_restored_records = 0;
inline bool                                   core_pending          = false;
inline int64_t                                core_bucket           = INT64_MIN;
} // namespace journal_sdk
const esp_partition_t* esp_partition_find_first(int, int, const char*);
esp_err_t              esp_partition_read(const esp_partition_t*, size_t, void*, size_t);
esp_err_t              esp_partition_write(const esp_partition_t*, size_t, const void*, size_t);
esp_err_t              esp_partition_erase_range(const esp_partition_t*, size_t, size_t);
inline uint32_t        esp_get_free_heap_size() { return 100000; }
