#pragma once
// Should a periodic publisher HOLD OFF this cycle because a known TLS operation owns the heap?
//
// OTA can consume the largest contiguous internal heap block. TLS plus its operation
// buffer claim the largest contiguous block on a heap whose binding limit IS that block. Measured
// on the wired board (legacy-380), the MQTT publish task then threw `std::bad_alloc` on its next
// cycle and lost the observation.
//
// The publisher stands aside while OTA is active. That trades a gap-with-a-`bad_alloc`
// for a gap-with-a-reason — the same missing second of data, now deliberate, countable (heartbeat
// `mqtt_quiesced`) and no longer spending the heap it was going to fail on anyway.
//
// WHY THIS IS NOT JUST `return network_active`. The hold-off is BOUNDED. Activity is set by another
// operation and cleared by that operation's completion paths; if it stalls behind a dead TCP
// connection, a wedged TLS read or a bug that misses a clear, an unbounded rule would silence the
// heat-pump bridge for as long as the board stays up — no publishes, no heartbeat, and no
// `bad_alloc` either, so the one symptom that made legacy-380 visible at all would be gone too. A
// firmware that goes quiet forever because a fetch did not finish is strictly worse than one that
// drops a second of data per second. After the cap the publisher resumes and takes its chances with
// the OOM guard, which is exactly the behaviour that shipped before this file existed.
//
// Pure, IDF-free, host-tested (test/test_logic.cpp → test_ota_quiesce).
#include <cstdint>

namespace daik {

// Consecutive cycles a publisher will stand aside before it resumes regardless. At the 1 s publish
// cadence (POLL_INTERVAL_S) this is ten minutes: longer than the firmware's complete bounded OTA
// path and the host's 480-second authoritative observer. A 300-cycle cap matched the firmware-body
// deadline itself but started earlier, so it could re-admit polling/publishing during the last
// valid transfer seconds. The cap remains a finite escape if the activity flag gets stuck.
inline constexpr uint32_t OTA_QUIESCE_MAX_CYCLES = 600;

// Per-publisher hold-off state. Lives in the task's own frame — one publisher, one counter, no
// sharing and therefore no lock.
struct OtaQuiesceState {
    uint32_t held = 0;   // consecutive cycles held off so far (0 = running normally)
};

// Advance the hold-off for one cycle. Returns true if THIS cycle should be skipped.
//
// The counter resets the moment the operation ends, so each later operation gets the full budget
// rather than sharing one allowance across the boot.
inline bool ota_quiesce_step(OtaQuiesceState& st, bool network_active) {
    if (!network_active) { st.held = 0; return false; }
    if (st.held >= OTA_QUIESCE_MAX_CYCLES) return false;   // cap reached — resume, guard takes over
    ++st.held;
    return true;
}

// Did the publisher give up on holding off — i.e. is an operation still claimed to be running after
// the cap expired? Reported so "publisher resumed mid-operation" is distinguishable from "idle"
// rather than being inferred from a counter that stopped moving.
inline bool ota_quiesce_exhausted(const OtaQuiesceState& st, bool network_active) {
    return network_active && st.held >= OTA_QUIESCE_MAX_CYCLES;
}

} // namespace daik
