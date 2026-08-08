#pragma once
// Should a periodic publisher HOLD OFF this cycle because an OTA download owns the heap?
//
// An `esp_https_ota` install is a known, bounded, self-inflicted memory event: the TLS session plus
// the download buffer claim the largest contiguous block on a heap whose binding limit IS that
// block. Measured on the wired board (#380), the MQTT publish task then threw `std::bad_alloc` on
// its next cycle, the task guard caught it, the cycle was skipped and the reading was gone — once
// per second until the install finished, 125 of them in one day, with `min_free_heap` bottoming out
// at 812 B. Nothing crashed; the guards did exactly their job. But the publisher was competing with
// the download for a block it could not win, and losing SILENTLY.
//
// So the publisher stands aside while the download runs. That trades a gap-with-a-`bad_alloc` for a
// gap-with-a-reason — the same missing second of data, now deliberate, countable (heartbeat
// `mqtt_quiesced`) and no longer spending the heap it was going to fail on anyway. The device
// reboots into the new image at the end of the download regardless, so the gap was never avoidable.
//
// WHY THIS IS NOT JUST `return ota_active`. The hold-off is BOUNDED. `ota_active` is set by another
// task and cleared on that task's exit paths; if a download stalls behind a dead TCP connection, a
// wedged TLS read or a bug that misses a clear, an unbounded rule would silence the heat-pump bridge
// for as long as the board stays up — no publishes, no heartbeat, and no `bad_alloc` either, so the
// one symptom that made #380 visible at all would be gone too. A firmware that goes quiet forever
// because an update did not finish is strictly worse than one that drops a second of data per
// second. After the cap the publisher resumes and takes its chances with the OOM guard, which is
// exactly the behaviour that shipped before this file existed.
//
// Pure, IDF-free, host-tested (test/test_logic.cpp → test_ota_quiesce).
#include <cstdint>

namespace daik {

// Consecutive cycles a publisher will stand aside before it resumes regardless. At the 1 s publish
// cadence (POLL_INTERVAL_S) this is five minutes — comfortably longer than any real install of a
// ~1.5 MB image over this link (tens of seconds), and short enough that a download which is never
// going to finish costs a bounded outage rather than the rest of the boot.
inline constexpr uint32_t OTA_QUIESCE_MAX_CYCLES = 300;

// Per-publisher hold-off state. Lives in the task's own frame — one publisher, one counter, no
// sharing and therefore no lock.
struct OtaQuiesceState {
    uint32_t held = 0;   // consecutive cycles held off so far (0 = running normally)
};

// Advance the hold-off for one cycle. Returns true if THIS cycle should be skipped.
//
// `ota_active` is the device-side "a download is in flight right now" flag (ota_download_active()).
// The counter resets the moment the download ends, so a device that installs many updates over a
// long uptime gets the full budget for each one rather than a budget shared across the boot.
inline bool ota_quiesce_step(OtaQuiesceState& st, bool ota_active) {
    if (!ota_active) { st.held = 0; return false; }
    if (st.held >= OTA_QUIESCE_MAX_CYCLES) return false;   // cap reached — resume, guard takes over
    ++st.held;
    return true;
}

// Did the publisher give up on holding off — i.e. is a download still claimed to be running after
// the cap expired? Reported so the "publisher resumed mid-download" state is distinguishable from
// "no download at all" rather than being inferred from a counter that stopped moving.
inline bool ota_quiesce_exhausted(const OtaQuiesceState& st, bool ota_active) {
    return ota_active && st.held >= OTA_QUIESCE_MAX_CYCLES;
}

} // namespace daik
