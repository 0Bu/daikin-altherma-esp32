#pragma once
// WHEN to put raw X10A page bytes on /diag from the POLL path — the missing half of logic/hexdump.hpp.
//
// hexdump.hpp names its own limitation, and it is the reason #194 is still open: the raw dump fires
// only on a DETECT pass (boot, or POST /detect), and a detect pass essentially never coincides with
// a compressor run. Target Evap. Temp. is only wrong WHILE the compressor runs — at rest it decodes
// to 240.6 °C and the ±200 °C envelope already drops it — so the bytes behind the impossible value
// have never been captured at the instant it is impossible, and #194's diagnosis had to be
// back-derived from a number already rounded to one decimal. Issue #209 asks for exactly this
// capture ("record the raw target bytes … while the compressor is running") and cannot be closed
// without it: quarantining the row (logic/availability.hpp) stops the false value reaching Home
// Assistant, but only the wire bytes can decide the scale and let the row come back.
//
// The cadence is the whole design. A dump every poll cycle would be 1 line/second into a 6 KB diag
// ring and out to syslog — it would evict the rest of the boot's evidence within a minute, which is
// precisely how the crash records used to be lost (see syslog.cpp's boot replay). So:
//
//   • nothing while the compressor is stopped — the detect-pass dump already covers that state, and
//     it is the state where the value is NOT wrong;
//   • one dump on the stopped → running EDGE, which is the sample that matters most (it is the
//     transition where #194 measured the row stepping into the impossible range);
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
inline bool raw_capture_due(RawCaptureState& s, bool running, int64_t now_us) {
    if (!running) {
        // Re-arm the EDGE, not the budget. A unit that cycles hourly gets one dump per start until
        // the budget runs out, which is the sampling anyone diagnosing this would ask for.
        s.was_running = false;
        return false;
    }
    const bool due = !s.was_running || now_us >= s.next_us;
    s.was_running  = true;
    if (!due || s.emitted >= RAW_CAPTURE_MAX) return false;
    s.emitted++;
    s.next_us = now_us + static_cast<int64_t>(RAW_CAPTURE_PERIOD_S) * 1000000;
    return true;
}

} // namespace daik::logic
