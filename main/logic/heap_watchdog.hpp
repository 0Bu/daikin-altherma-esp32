#pragma once
// Last-resort escalation for a heap this device can no longer recover from. Pure, IDF-free,
// host-tested (test/test_logic.cpp). The device glue is heap_guard.cpp.
//
// WHY THIS EXISTS. Every OOM guard in this firmware turns "out of memory" into "recover and
// continue", and every one of them is right to: http_common.cpp's handle_all trampoline answers
// 503, each allocating task loop catches std::bad_alloc and — in the words of CLAUDE.md's own rule
// — skips "the cycle keeping the last good state", the MQTT bridge drops one publish. That is the
// correct response to a TRANSIENT shortage and must stay.
//
// What nothing here has ever asked is the NEXT question: what if it never recovers? Compose those
// guards and the result is a device that is powered, associated, answering 503 to every request,
// republishing nothing, and reporting no fault — for as long as the shortage lasts, which may be
// until somebody walks to the board. The poll task allocates a value vector every cycle, the httpd
// task builds a ~6 KB /values snapshot per request, the MQTT bridge builds a grouped document per
// change, and OTA and the weather client each want a whole TLS session; a fragmented heap starves
// all of them at once. Each one catches, logs at most once, and tries again a second later.
//
// A hang is the worst failure shape available. A crash reboots in seconds and leaves a reset reason,
// a core dump and a syslog record; a wedge looks exactly like a powered-off device, heals never, and
// reports nothing — CLAUDE.md's "Memory constraints" section already names the cost ("A reboot loop
// also stops the poll cycle and drops MQTT availability"), and an unbroken wedge pays that cost
// permanently instead of for four seconds. So: when the heap has been unusable CONTINUOUSLY for
// long enough that no transient explains it, restart deliberately.
//
// WHY A RESTART AND NOT IN-PLACE RECOVERY. Rebooting is the crude answer, so it is worth stating why
// the alternatives are worse rather than merely unchosen:
//   - Tearing down and re-initialising the subsystems (WiFi, esp-mqtt, the HTTP server) runs the
//     failing component's OWN code at the moment it is failing, and deinit paths allocate. A throw
//     there unwinds into a task loop and reaches std::terminate — an UNCONTROLLED restart with no
//     breadcrumb, which is strictly worse than the controlled one. Crash-only design says the same
//     thing structurally: a restart is trustworthy only when it does not depend on the broken part.
//   - A ballast block freed under pressure costs permanent internal DRAM on a board whose binding
//     limit is the largest CONTIGUOUS block. This path needs no headroom at all: it is
//     allocation-free by construction, down to the i32 NVS breadcrumb.
//   - heap_caps_register_failed_alloc_callback() runs inside the allocator, in whatever task or ISR
//     happened to ask for memory, and cannot satisfy the allocation. It is a sensor, not an actor.
//   - There is no defragmentation call to make.
//
// WHY IT CANNOT SIMPLY REBOOT ON THE FIRST bad_alloc. One failed allocation is exactly the transient
// the existing guards handle correctly, and this firmware has legitimate bursts that touch the
// largest block hard — an OTA download, several browsers polling /values and /status at once, a
// /diag dump. All of those resolve in seconds. The trigger is therefore a LONG, UNBROKEN run below
// the threshold, which no burst can reach.
//
// WHY largest_block AND NOT free. The binding limit on this chip is the largest contiguous free
// block, not the total — the reason /status.sys reports both, and the reason history.hpp carries the
// two as a PAIR (a leak is a slope; fragmentation is the two lines separating). A fragmented heap
// shows a perfectly survivable `free` while no single allocation of any size can be served.
//
// WHY *INTERNAL* largest_block. The sample must come from MALLOC_CAP_8BIT|MALLOC_CAP_INTERNAL, not
// MALLOC_CAP_DEFAULT: the latter reports the maximum across every heap carrying the cap, and a board
// with PSRAM registers it there (sdkconfig.defaults documents CONFIG_SPIRAM as an uncomment-if-you-
// have-it option). Such a board in the exact wedge — internal DRAM at 768 B — would read several
// megabytes and never trigger, i.e. this would be a silent no-op on the one board with the extra
// RAM. The thresholds below are internal-DRAM numbers and mean nothing against any other sample, so
// heap_guard.hpp exposes ONE sampler (heap_largest_internal_block) and every reporting site in the
// firmware now shares it.
#include <cstdint>
#include <cstddef>

namespace daik {

// Below this, the largest contiguous block can no longer satisfy the allocations normal operation
// makes. The scale is set by the firmware's own stated needs rather than guessed: http_config.cpp's
// /set_mqtt pre-flight already refuses to open even a PLAINTEXT probe below 12 KB and a TLS one
// below 48 KB. 4 KB is far under the point at which the device has stopped being able to do its job,
// and far over a genuinely wedged heap, so it separates the two without needing a tight estimate of
// either.
inline constexpr size_t HEAP_CRITICAL_BYTES = 4096;

// How long it must stay below that, without a single sample recovering, before we act. Long enough
// that no burst — an OTA, a /diag dump, a detect sweep, several concurrent browser polls — can reach
// it, since all of those resolve in seconds.
inline constexpr uint32_t HEAP_CRITICAL_HOLD_MS = 300000;   // 5 minutes

// After this many CONSECUTIVE watchdog restarts, stop restarting. Five is proof that a restart does
// not fix this particular fault: if the shortage re-develops from a fresh boot within minutes we
// would otherwise reboot forever, and a reboot loop drops MQTT availability and the poll cycle on
// every pass. Staying up in the degraded state is also useless, but it stops cycling the radio, it
// keeps the web UI and OTA reachable so a newer build can be installed, and it leaves a reset reason
// somebody can read. The count resets on any ordinary boot, so this can only ever bound a genuine
// restart LOOP, never an isolated self-heal.
inline constexpr uint8_t HEAP_MAX_CONSECUTIVE_RESTARTS = 5;

// The action AND the transition that produced it. The transitions exist so the sample site can
// narrate the whole escalation — armed, counting down, recovered, fired — instead of only the last
// line. Syslog is the only post-mortem source that survives the restart (the /diag ring is RAM and
// the .noinit history rings carry no text), so a reader has to be able to reconstruct why the device
// rebooted from the log stream alone.
enum class HeapAction : uint8_t {
    Ok,         // healthy, and healthy on the previous sample too — nothing to say
    Recovered,  // a critical run just ENDED (the heap came back, or an OTA excused it)
    Armed,      // this sample OPENED a critical run — the countdown to a restart starts here
    Watching,   // still critical, the hold time has not elapsed
    Restart,    // sustained exhaustion: restart deliberately
};

struct HeapVerdict {
    HeapAction action = HeapAction::Ok;
    // How long the run THIS verdict describes has lasted: elapsed so far for Watching/Restart, the
    // total length of the run that just ended for Recovered, 0 otherwise. Logged rather than the
    // configured hold, so the line states what actually happened — the sample cadence means a fired
    // run has always lasted somewhat LONGER than HEAP_CRITICAL_HOLD_MS.
    uint32_t   critical_ms = 0;
    // Recovered because an OTA is in flight, not because the heap healed. A different sentence in
    // the log: one says the device is fine again, the other says we declined to judge it.
    bool       ota_excused = false;
};

struct HeapWatchdog {
    bool     critical = false;   // currently inside an unbroken critical run
    uint32_t since_ms = 0;       // when that run started (only meaningful while critical)
};

struct HeapSample {
    size_t   largest_block = 0;  // heap_largest_internal_block() — INTERNAL matters, see the header
    uint32_t now_ms        = 0;  // monotonic; a 32-bit wrap is handled
    bool     ota_busy      = false;  // an OTA check/download is in flight
};

inline constexpr bool heap_may_restart(uint8_t consecutive) {
    return consecutive < HEAP_MAX_CONSECUTIVE_RESTARTS;
}

// How many consecutive watchdog restarts the persisted breadcrumb represents. Anything that is not
// one of ours — a negative value, or a count past the cap from a garbled or future writer — reads as
// 0, so an unusable breadcrumb can only ever UNDER-count. That direction is deliberate: under-counting
// costs at most a few extra restarts, while over-counting would SUPPRESS a restart the device needs.
inline constexpr uint8_t heap_restart_count_sane(int32_t stored) {
    if (stored < 0 || stored > HEAP_MAX_CONSECUTIVE_RESTARTS) return 0;
    return static_cast<uint8_t>(stored);
}

// How long until a restart, given how long the run has already lasted. Saturates at 0 rather than
// wrapping, so a countdown in the log can never print a nonsense ~49-day figure.
inline constexpr uint32_t heap_restart_in_ms(uint32_t critical_ms) {
    return critical_ms >= HEAP_CRITICAL_HOLD_MS ? 0 : HEAP_CRITICAL_HOLD_MS - critical_ms;
}

// Feed one sample. Call it on a fixed cadence; the decision uses elapsed TIME, not sample count, so
// the cadence can change without moving the threshold.
inline HeapVerdict heap_watch(HeapWatchdog& w, const HeapSample& s) {
    // An OTA legitimately holds the largest allocations this firmware ever makes (a TLS session plus
    // the image window), so a low reading during one proves nothing. CLEAR the run rather than merely
    // skipping the sample: skipping would let a critical run that started BEFORE the download resume
    // its clock afterwards and fire mid-install, which is the one restart that could leave a
    // half-written slot behind.
    if (s.ota_busy || s.largest_block >= HEAP_CRITICAL_BYTES) {
        if (!w.critical) return {HeapAction::Ok, 0, false};
        // Ending a run is worth a line: it is the difference between "the device healed itself" and
        // a silence the reader would have to interpret.
        const uint32_t ran = static_cast<uint32_t>(s.now_ms - w.since_ms);
        // Excused means the OTA is what saved it — the heap itself is still below the threshold. An
        // OTA running while the heap is healthy again is an ordinary recovery, not an excusal.
        const bool excused = s.ota_busy && s.largest_block < HEAP_CRITICAL_BYTES;
        w.critical = false;
        return {HeapAction::Recovered, ran, excused};
    }
    if (!w.critical) {
        w.critical = true;
        w.since_ms = s.now_ms;
        return {HeapAction::Armed, 0, false};
    }
    // Unsigned subtraction, so a 32-bit millisecond wrap inside the hold window still measures the
    // true elapsed time instead of going hugely negative and firing instantly.
    const uint32_t held = static_cast<uint32_t>(s.now_ms - w.since_ms);
    if (held >= HEAP_CRITICAL_HOLD_MS) return {HeapAction::Restart, held, false};
    return {HeapAction::Watching, held, false};
}

} // namespace daik
