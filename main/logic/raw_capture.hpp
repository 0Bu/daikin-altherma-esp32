#pragma once
// WHEN to put raw X10A page bytes on /diag from the POLL path — the missing half of
// logic/hexdump.hpp.
//
// A detect-pass dump may miss the running state. Before the Target Evap. Temp. adjudication,
// its 240.6 °C stopped-state decode exceeded the 200 °C ceiling and was withheld, while wrong
// running-state values passed the envelope. Runtime wire evidence resolved that distinction
// through logic/conv_override.hpp; this cadence remains useful for later converter/layout cases.
//
// The cadence is the whole design. A dump every poll cycle would be 1 line/second into a 6 KB diag
// ring and out to syslog — it would evict the rest of the boot's evidence within a minute, which is
// precisely how the crash records used to be lost (see syslog.cpp's boot replay). So:
//
//   • nothing while the compressor is stopped — the detect-pass dump already covers that state;
//   • one dump on the stopped → running EDGE, which is the sample that matters most (it is the
//     transition where legacy-194 measured the row stepping into the impossible range);
//   • then one every RAW_CAPTURE_PERIOD_S while it keeps running, so a long run yields a short
//     series rather than a single point — two candidate scales that both fit one sample may not fit
//     a curve;
//   • at most RAW_CAPTURE_MAX per boot, so a unit that cycles all day cannot fill the ring. The
//     budget is per BOOT and never refills: the question is "what do these bytes read at run time",
//     and eight answers settle it or nothing will.
//
// Pure so the edge/period/budget interaction is asserted on the host — it is a state machine with
// three inputs whose failure mode (a silently exhausted budget, or a dump that repeats every cycle)
// is invisible on a board until the log is already ruined.
#include <cstdint>

namespace daik::logic {

inline constexpr int RAW_CAPTURE_PERIOD_S = 300;   // 5 min between dumps within one run
inline constexpr int RAW_CAPTURE_MAX      = 8;     // per boot, never refilled

struct RawCaptureState {
    bool    was_running = false;
    int64_t next_us     = 0;
    int     emitted     = 0;
};

// Should this cycle emit a raw page dump? Advances `s`; call exactly once per poll cycle.
inline bool raw_capture_due(RawCaptureState& s, bool running, int64_t now_us,
                            bool payload_available = true) {
    if (!running) {
        // Re-arm the EDGE, not the budget. A unit that cycles hourly gets one dump per start until
        // the budget runs out, which is the sampling anyone diagnosing this would ask for.
        s.was_running = false;
        return false;
    }
    // A missed page is not a capture. Keep the edge/period pending until bytes actually arrive.
    if (!payload_available) return false;
    const bool due = !s.was_running || now_us >= s.next_us;
    s.was_running  = true;
    if (!due || s.emitted >= RAW_CAPTURE_MAX) return false;
    s.emitted++;
    s.next_us = now_us + static_cast<int64_t>(RAW_CAPTURE_PERIOD_S) * 1000000;
    return true;
}

} // namespace daik::logic
