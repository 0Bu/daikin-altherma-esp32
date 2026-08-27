#pragma once

// Wrap-safe monotonic deadline arithmetic shared by the ESP-IDF socket watchdog and its host
// tests. Tick counters are unsigned and may wrap once between `started` and `now`; subtraction in
// that unsigned domain is the FreeRTOS contract used throughout the firmware.

#include <cstdint>
#include <type_traits>

namespace daik {

template <typename Tick>
constexpr Tick http_deadline_remaining_ticks(Tick started, Tick now, Tick duration) noexcept {
    static_assert(std::is_integral<Tick>::value && std::is_unsigned<Tick>::value,
                  "deadline ticks must be an unsigned integral type");
    const Tick elapsed = static_cast<Tick>(now - started);
    return elapsed >= duration ? Tick{0} : static_cast<Tick>(duration - elapsed);
}

template <typename Tick>
constexpr bool http_deadline_reached_at(Tick started, Tick now, Tick duration) noexcept {
    return http_deadline_remaining_ticks(started, now, duration) == Tick{0};
}

inline constexpr uint64_t http_deadline_ticks_to_us(uint64_t remaining_ticks,
                                                    uint64_t tick_period_ms) noexcept {
    return remaining_ticks * tick_period_ms * 1000u;
}

} // namespace daik
