#pragma once
// Auto-detect backoff policy (hp_poll.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// While profile=="auto" the poll task sweeps detection every cycle. On a SILENT bus (no pump wired,
// or wiring wrong) each sweep drives hp_uart_init() per candidate pair and blocks ~1.2 s in serial
// probes, then logs a diag line, forever. Even after logic/uart_plan.hpp makes the reroute heap-free,
// that is CPU + UART ("GPIO 43/44 not usable" ~1/s) + log churn every ~2 s indefinitely, and it is
// the safety net if a delete+install fallback is ever needed. A WIRED unit fingerprints on cycle 1
// and the sweep STOPS, so the right move is to STRETCH the cadence the longer the bus stays silent
// while NEVER slowing the common case (the first sweep, and every run that answers, stay at the floor).
//
// WDT SAFETY: this is applied by SKIPPING sweep ticks, keeping poll_task's 1 s top-of-loop
// esp_task_wdt_reset() — never by lengthening vTaskDelay. So the ceiling is a detection-LATENCY
// choice, not a watchdog constraint (a post-boot-wired unit is re-swept within the ceiling, or
// instantly via POST /detect). Non-allocating, so detect_backoff_step is safe under the poll mutex.
#include <cstdint>

namespace daik {

inline constexpr int DETECT_MIN_INTERVAL_S = 1;    // floor = poll cadence; first sweep + every answer
inline constexpr int DETECT_MAX_INTERVAL_S = 60;   // ceiling once the bus has stayed silent
inline constexpr int DETECT_BACKOFF_AFTER  = 3;    // consecutive silent sweeps at full cadence first
inline constexpr int DETECT_SILENT_MAX     = DETECT_BACKOFF_AFTER + 30;  // saturate (already at ceiling)

// Consecutive silent-detect counter. Reset the moment a sweep fingerprints the bus.
struct DetectBackoff { int silent = 0; };

// Seconds to wait before the next sweep, given how many CONSECUTIVE sweeps found no unit. Full cadence
// through the grace window (silent <= DETECT_BACKOFF_AFTER), then geometric growth CLAMPED to
// [MIN, MAX]. Growth begins at silent == DETECT_BACKOFF_AFTER + 1 (shift 1).
inline int detect_backoff_interval_s(int silent) {
    if (silent <= DETECT_BACKOFF_AFTER) return DETECT_MIN_INTERVAL_S;
    const int shift = silent - DETECT_BACKOFF_AFTER;
    if (shift >= 30) return DETECT_MAX_INTERVAL_S;                       // shift guard: no UB (long is
                                                                        // 32-bit on the device), already
                                                                        // saturated far below this
    const long v = static_cast<long>(DETECT_MIN_INTERVAL_S) << shift;
    return v >= DETECT_MAX_INTERVAL_S ? DETECT_MAX_INTERVAL_S : static_cast<int>(v);
}

// Advance one sweep. `fingerprinted` = the sweep saw a unit. Returns seconds to wait before the next
// sweep. Non-allocating — safe to call under the poll mutex.
inline int detect_backoff_step(DetectBackoff& s, bool fingerprinted) {
    if (fingerprinted) { s.silent = 0; return DETECT_MIN_INTERVAL_S; }  // a swapped-in unit is swept at once
    if (s.silent < DETECT_SILENT_MAX) s.silent++;                       // saturating, like boot_guard's count
    return detect_backoff_interval_s(s.silent);
}

} // namespace daik
