#pragma once
// The recovery button's press classifier: how a stream of raw GPIO samples becomes "held long
// enough to factory-reset". Pure + IDF-free so the thresholds, the debounce and — most importantly
// — the ABORT path are host-tested (test/test_logic.cpp) rather than only ever exercised by
// physically holding a button on a desk.
//
// What this guards. The action it gates is destructive and IRREVERSIBLE: button.cpp erases the whole
// "daik_cfg" NVS namespace (WiFi credentials, MQTT broker + credentials, syslog/NTP, the X10A link
// cache, the safe-mode crash counter) and reboots into the setup portal. That is the point — it is
// the only recovery path when the device is on a network the user can no longer reach, where the
// web UI is by definition unavailable — but it means a false Fire costs the user their whole
// configuration. Hence:
//
//   * a LONG hold (BUTTON_FIRE_MS), not a click, so a knocked enclosure cannot trigger it;
//   * a debounced release (BUTTON_RELEASE_SAMPLES), so a contact bounce mid-hold neither restarts
//     the countdown nor — worse — reads as a fresh press;
//   * an ARM checkpoint partway through (BUTTON_ARM_MS) that lights the indicator, so the user is
//     told what is about to happen while there is still time to let go. Without it the only
//     feedback would arrive after the config is already gone.
//
// Sampling is the caller's business; the state machine only needs monotonic timestamps and is
// correct at any sample period (the tests drive it at several). button.cpp samples every
// BUTTON_SAMPLE_MS.
#include <cstdint>

namespace daik {

// Hold thresholds, measured from the first pressed sample.
inline constexpr uint32_t BUTTON_ARM_MS  = 1500;   // indicator switches to the armed warning
inline constexpr uint32_t BUTTON_FIRE_MS = 5000;   // erase + reboot
// Consecutive released samples that count as a real release. At the 20 ms sample period this is
// 60 ms of continuous open contact — longer than any switch bounce, far shorter than a human
// "let go". A single stray released sample must NOT cancel a hold: the user would get a silent
// abort with no way to tell why, and would just hold it again.
inline constexpr int      BUTTON_RELEASE_SAMPLES = 3;
inline constexpr uint32_t BUTTON_SAMPLE_MS       = 20;

enum class ButtonEvent : uint8_t {
    None,
    Armed,      // crossed BUTTON_ARM_MS, still held — show the warning, the wipe has NOT happened
    Fired,      // crossed BUTTON_FIRE_MS — the caller erases + reboots
    Aborted,    // released after Armed but before Fired — clear the warning, nothing was erased
};

struct ButtonState {
    bool     down        = false;
    uint64_t down_at_ms  = 0;
    int      release_run = 0;
    bool     armed       = false;
    bool     fired       = false;
};

// Feed one sample. `pressed` is already polarity-corrected by the caller (button.cpp applies
// btn_active_low), `now_ms` is monotonic. Returns at most one event per call — the thresholds are
// edges, so Armed and Fired each fire exactly once per hold even though the predicate stays true
// for every later sample of that hold.
inline ButtonEvent button_update(ButtonState& st, bool pressed, uint64_t now_ms) {
    if (pressed) {
        st.release_run = 0;
        if (!st.down) {                       // rising edge — start a fresh hold
            st.down       = true;
            st.down_at_ms = now_ms;
            st.armed      = false;
            st.fired      = false;
            return ButtonEvent::None;
        }
        // now_ms is monotonic, so this cannot underflow; a caller that violates that would only
        // ever make the hold look SHORTER (no spurious fire).
        const uint64_t held = now_ms - st.down_at_ms;
        // Fire is checked first: at a coarse sample period a single sample can cross both
        // thresholds, and in that case the erase is what the user asked for — reporting Armed and
        // waiting a whole extra sample would just delay it.
        if (!st.fired && held >= BUTTON_FIRE_MS) { st.fired = true; return ButtonEvent::Fired; }
        if (!st.armed && held >= BUTTON_ARM_MS)  { st.armed = true; return ButtonEvent::Armed; }
        return ButtonEvent::None;
    }

    if (!st.down) return ButtonEvent::None;   // idle, and staying idle
    if (++st.release_run < BUTTON_RELEASE_SAMPLES) return ButtonEvent::None;   // bounce, not a release

    const bool warn_was_shown = st.armed && !st.fired;
    st = ButtonState{};                       // debounced release — back to idle
    // Only a hold that got as far as showing the warning needs the indicator handed back; a short
    // press never asserted anything and must stay silent.
    return warn_was_shown ? ButtonEvent::Aborted : ButtonEvent::None;
}

}  // namespace daik
