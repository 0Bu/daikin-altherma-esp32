#pragma once
// A Modbus cache belongs to the TCP session that produced it. `connected` alone cannot prove that:
// a snapshot may copy the previous session's cache immediately before a reconnect publishes the new
// socket as connected. The generation comparison closes that window without nesting the status and
// cache mutexes. Generation zero is reserved for "no session has committed data yet".
#include <cstdint>

namespace daik::logic {

// The full cache is refreshed every N ticks, while every tick also spends time reading the peer.
// Its age budget must include those reads, including one batch exception followed by single reads.
// A separate reply-age bound detects a stopped/OOM worker without waiting for this larger budget.
inline constexpr uint32_t modbus_cache_max_age_s(uint32_t full_cycle_ticks,
                                                 uint32_t poll_interval_ms,
                                                 uint32_t request_budget_ms, uint32_t full_requests,
                                                 uint32_t fast_requests) {
    const uint64_t duration_ms =
        (static_cast<uint64_t>(full_cycle_ticks) + 1) * poll_interval_ms +
        (static_cast<uint64_t>(full_requests) +
         static_cast<uint64_t>(full_cycle_ticks > 0 ? full_cycle_ticks - 1 : 0) * fast_requests) *
            request_budget_ms;
    const uint64_t seconds = (duration_ms + 999) / 1000;
    return seconds > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(seconds);
}

inline bool modbus_cache_is_live(bool connected, uint32_t link_generation,
                                 uint32_t cache_generation, uint32_t target_generation,
                                 uint32_t cache_target_generation, uint32_t cache_age_s,
                                 uint32_t max_age_s, uint32_t reply_age_s = 0,
                                 uint32_t max_reply_age_s = UINT32_MAX) {
    return connected && link_generation != 0 && target_generation != 0 &&
           cache_generation == link_generation && cache_target_generation == target_generation &&
           cache_age_s <= max_age_s && reply_age_s <= max_reply_age_s;
}

}  // namespace daik::logic
