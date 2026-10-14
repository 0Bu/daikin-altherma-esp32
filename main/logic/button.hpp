#pragma once
// The recovery button's press classifier: how a stream of raw GPIO samples becomes "held long
// enough to factory-reset". Pure + IDF-free so the thresholds, the debounce and — most importantly
// — the ABORT path are host-tested (test/test_logic.cpp) rather than only ever exercised by
// physically holding a button on a desk.
//
// What this guards. The action it gates is destructive and IRREVERSIBLE: recovery_button.cpp erases
// the whole "daik_cfg" NVS namespace (WiFi credentials, MQTT broker + credentials, syslog/NTP, the
// X10A link cache, the safe-mode crash counter) plus the history journal, the raw coredump and the
// MQTT retirement record, keeps only the board-hardware statement (preset, indicator, button) and
// reboots into the setup portal. That is the point — it is the only recovery path when the device
// is on a network the user can no longer reach, where the web UI is by definition unavailable — but
// it means a false Fire costs the user their whole configuration. Hence:
//
//   * a LONG hold (BUTTON_FIRE_MS), not a click, so a knocked enclosure cannot trigger it;
//   * a debounced PRESS (BUTTON_PRESS_SAMPLES), so a contact that only flickers closed — an
//     undebounced or marginal input — never starts the countdown at all;
//   * a debounced release (BUTTON_RELEASE_SAMPLES), so a contact bounce mid-hold neither restarts
//     the countdown nor — worse — reads as a fresh press;
//   * an ARM checkpoint partway through (BUTTON_ARM_MS) that lights the indicator, so the user is
//     told what is about to happen while there is still time to let go. Without it the only
//     feedback would arrive after the config is already gone;
//   * a BOOT GATE (ButtonBootGate below), so a button that is already held when the task starts —
//     a stuck switch, a short, a finger on it at power-up — is never mistaken for a press.
//
// Sampling is the caller's business; the state machine only needs monotonic timestamps and is
// correct at any sample period (the tests drive it at several). recovery_button.cpp samples every
// BUTTON_SAMPLE_MS.
//
// A SAMPLING STALL (the button task starved or blocked for longer than a threshold) is
// indistinguishable from a coarse sample period, and is treated the same way: the samples on either
// side of the gap are trusted as one hold measured from its first pressed sample. A stall that
// spans a threshold therefore reports it on the first sample after the gap, and one that spans BOTH
// reports Fired directly, without an Armed warning first — the debounce still had to see
// BUTTON_PRESS_SAMPLES consecutive pressed samples, so it cannot turn a flicker into a fire, and a
// user who is still holding the button at the end of the gap did hold it that long. Pinned by the
// tests, so a change to this trade-off is a deliberate one.
#include <cstdint>

namespace daik {

// Hold thresholds, measured from the FIRST pressed sample of the debounced press — a clean press
// keeps the exact boundaries it had before the press debounce existed.
inline constexpr uint32_t BUTTON_ARM_MS  = 1500;   // indicator switches to the armed warning
inline constexpr uint32_t BUTTON_FIRE_MS = 5000;   // erase + reboot
// Consecutive pressed samples that START a hold. The release debounce below needs three
// consecutive released samples, so without a matching press debounce a pin that reads pressed in
// only one sample out of every three would never be seen to let go: its isolated "pressed" samples
// would carry a hold all the way to the erase. Requiring the same run length on the way in closes
// that, and costs a clean press nothing — the hold is still dated from the run's first sample.
inline constexpr int BUTTON_PRESS_SAMPLES = 3;
// Consecutive released samples that count as a real release. At the 20 ms sample period this is
// 60 ms of continuous open contact — longer than any switch bounce, far shorter than a human
// "let go". A single stray released sample must NOT cancel a hold: the user would get a silent
// abort with no way to tell why, and would just hold it again. The boot gate uses the same count.
inline constexpr int      BUTTON_RELEASE_SAMPLES = 3;
inline constexpr uint32_t BUTTON_SAMPLE_MS       = 20;

enum class ButtonEvent : uint8_t {
    None,
    Armed,      // crossed BUTTON_ARM_MS, still held — show the warning, the wipe has NOT happened
    Fired,      // crossed BUTTON_FIRE_MS — the caller erases + reboots
    Aborted,    // released after Armed but before Fired — clear the warning, nothing was erased
};

// New fields are appended, never inserted, so a positional initializer of the older shape keeps
// meaning what it meant.
struct ButtonState {
    bool     down        = false; // a debounced hold is in progress
    uint64_t down_at_ms  = 0;     // that hold's first pressed sample
    int      release_run = 0;     // consecutive released samples inside the hold
    // The Armed edge is behind this hold: reported, or superseded by Fired. Fired sets it too, so a
    // still-held button after a reset that returned (failed or incomplete) can never re-arm.
    bool     armed       = false;
    bool     fired       = false;
    int      press_run   = 0; // consecutive pressed samples while idle — the press debounce
    uint64_t press_at_ms = 0; // first sample of that run; becomes down_at_ms
};

// Feed one sample. `pressed` is already polarity-corrected by the caller (recovery_button.cpp
// applies btn_active_low), `now_ms` is monotonic. Returns at most one event per call — the
// thresholds are edges, so Armed and Fired each fire at most once per hold even though the
// predicate stays true for every later sample of that hold.
inline ButtonEvent button_update(ButtonState& st, bool pressed, uint64_t now_ms) {
    if (pressed) {
        st.release_run = 0;
        if (!st.down) {
            if (st.press_run == 0) st.press_at_ms = now_ms; // the contact closed here
            // Not a press yet: until the run is long enough it is only a flicker.
            if (++st.press_run < BUTTON_PRESS_SAMPLES) return ButtonEvent::None;
            // Debounced rising edge — start a fresh hold, dated from the run's FIRST sample, and
            // judge this confirming sample against the thresholds like any later one (it can only
            // cross one after a sampling stall; see the file comment).
            st.down       = true;
            st.down_at_ms = st.press_at_ms;
            st.press_run  = 0;
            st.armed      = false;
            st.fired      = false;
        }
        // now_ms is monotonic, so this cannot underflow; a caller that violates that would only
        // ever make the hold look SHORTER (no spurious fire).
        const uint64_t held = now_ms - st.down_at_ms;
        // Fire is checked first: at a coarse sample period a single sample can cross both
        // thresholds, and in that case the erase is what the user asked for — reporting Armed and
        // waiting a whole extra sample would just delay it. Firing also closes the Armed edge for
        // the rest of this hold: if the reset returns (it failed or is incomplete), the caller has
        // already handed the indicator back, and a late Armed would re-light the warning for an
        // erase that cannot fire again in this hold — with nothing left to clear it on release.
        if (!st.fired && held >= BUTTON_FIRE_MS) {
            st.fired = true;
            st.armed = true;
            return ButtonEvent::Fired;
        }
        if (!st.armed && held >= BUTTON_ARM_MS)  { st.armed = true; return ButtonEvent::Armed; }
        return ButtonEvent::None;
    }

    if (!st.down) { // idle: a released sample breaks a forming press
        st.press_run = 0;
        return ButtonEvent::None;
    }
    if (++st.release_run < BUTTON_RELEASE_SAMPLES) return ButtonEvent::None;   // bounce, not a release

    const bool warn_was_shown = st.armed && !st.fired;
    st = ButtonState{};                       // debounced release — back to idle
    // Only a hold that got as far as showing the warning needs the indicator handed back; a short
    // press never asserted anything and must stay silent, and a fired hold's caller already handed
    // it back when the reset returned.
    return warn_was_shown ? ButtonEvent::Aborted : ButtonEvent::None;
}

// The boot gate: a button already held when the task starts is NOT a press. A stuck switch, a
// wiring short, or a user who powered the board up with a finger on it would otherwise start a hold
// that fires five seconds into the boot — before the user could possibly have decided to reset
// anything. The pin must first be seen RELEASED for BUTTON_RELEASE_SAMPLES consecutive samples,
// the same evidence the hold needs for a real release: one bounced "released" sample of a contact
// that is in fact still closed must not open the gate, or the still-closed contact would then
// start, and finish, a hold on its own.
struct ButtonBootGate {
    int  released_run = 0;
    bool open         = false;
};

// Feed every sample here first; true once the gate is open (and from then on). The sample that
// opens it is a released one, so the caller may pass it on to button_update as well — a released
// sample while idle is a no-op there.
inline bool button_boot_gate_open(ButtonBootGate& gate, bool pressed) {
    if (gate.open) return true;
    gate.released_run = pressed ? 0 : gate.released_run + 1;
    gate.open         = gate.released_run >= BUTTON_RELEASE_SAMPLES;
    return gate.open;
}

}  // namespace daik
