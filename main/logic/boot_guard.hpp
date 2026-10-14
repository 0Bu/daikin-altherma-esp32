#pragma once
// Boot-loop safe-mode decision logic (issue legacy-6) — IDF-free, host-tested. A bad *config* (most
// plausibly wrong RX/TX pins, but any setting that crashes a background task at start-up) can wedge
// the device in a reboot loop whose only exit today is `esptool erase_flash` over USB — breaking
// the project's "recover everything from the web UI" promise. This counts CRASH-only boots in NVS
// and, once a threshold is crossed, lets the device come up MINIMALLY (network + web UI + OTA, no
// poll / MQTT) so the offending config can be fixed remotely.
//
// This is a DIFFERENT failure class from the OTA rollback health-gate: that recovers a bad signed
// *image* and only arms after an update; it can't help a config crash-loop because both OTA slots
// read the same daik_cfg NVS. See docs/SECURITY.md.
//
// It also owns the ONE classification of a boot that both persisted recovery counters follow
// (BootKind below): the crash counter here and the heap watchdog's restart ladder
// (heap_watchdog.hpp). The device glue reads esp_reset_reason(), the heap watchdog's RAM marker and
// the stored counters and calls these: safe_mode.cpp classifies the boot once and applies the crash
// half, heap_guard.cpp applies the heap half of the same classification.
#include "crashinfo.hpp" // CrashReason enum — single source of the reset-reason codes (IDF-mirrored)
#include "heap_watchdog.hpp" // heap_restart_count_sane, HEAP_CRITICAL_HOLD_MS — the ladder's half

#include <cstdint>

namespace daik {

inline constexpr int BOOT_FAIL_THRESHOLD = 4;    // enter safe mode on the Nth consecutive crash boot
inline constexpr int BOOT_FAIL_MAX       = 100;  // saturate the stored counter (no overflow over years)

// Continuous uptime, counted from the end of the boot sequence (safe_mode_arm_healthy), that proves
// this boot is good and clears the crash counter.
//
// Ten minutes, not the thirty seconds it once was. A window that short only ever caught a fault
// that struck within half a minute of start-up. A crash that recurs deterministically 45 s into
// every boot, or a leak that panics after 200 s — still inside the heap watchdog's five-minute
// hold, so the watchdog never acts either — let the timer clear the counter first, every time. The
// counter never climbed past 1, safe mode never latched, and the device rebooted for ever, which is
// the one outcome this guard exists to end.
//
// Why 600: it is twice the heap watchdog's own hold (static_assert below), so a shortage that ends
// in a crash before the watchdog can act still accumulates here. The price is stated rather than
// hidden: four crashes, each less than ten minutes after its boot finished starting, latch safe
// mode even when they are unrelated — and a device that does that is in a reboot loop whatever the
// cause, which is exactly when the minimal, reachable state is the right one.
inline constexpr int BOOT_HEALTHY_S = 600;
static_assert(
    static_cast<long long>(BOOT_HEALTHY_S) * 1000 >= 2LL * HEAP_CRITICAL_HOLD_MS,
    "the healthy window must outlast the heap watchdog's hold, or a shortage that crashes "
    "before the watchdog acts can never accumulate");

// Enter safe mode once the crash-boot count reaches the threshold. No off-by-one: the counter is
// incremented BEFORE this check, so with threshold 4 the 4th crash makes fail_count == 4 == threshold.
inline bool boot_should_enter_safe_mode(int fail_count, int threshold = BOOT_FAIL_THRESHOLD) {
    return fail_count >= threshold;
}

// The stored counter as a count. A corrupt or first-run read (negative, or an unexpectedly large
// value from a garbled NVS blob) reads as 0: no writer ever stores a value outside
// 0..BOOT_FAIL_MAX.
inline int boot_fail_count_sane(int32_t stored) {
    return (stored < 0 || stored > BOOT_FAIL_MAX) ? 0 : static_cast<int>(stored);
}

// Saturating increment of the persisted counter. An unusable read is treated as 0 before
// incrementing (boot_fail_count_sane); the result saturates at BOOT_FAIL_MAX so a long crash-loop
// can never overflow the stored int.
inline int boot_next_fail_count(int32_t stored) {
    const int cur = boot_fail_count_sane(stored);
    return cur >= BOOT_FAIL_MAX ? BOOT_FAIL_MAX : cur + 1;
}

// May the healthy-uptime timer be armed on THIS boot? Everywhere EXCEPT while safe mode is latched
// — and that single condition is the difference between a LATCH and a
// crash-crash-crash-crash-then-one-quiet-boot CYCLE.
//
// Safe mode brings the device up with the X10A poll engine and the MQTT bridge DOWN, which is
// precisely where a config crash-loop lives (a wrong RX/TX pair wedging the poll task, a decode
// that panics on one unit's reply, a publish burst that exhausts the heap). So surviving
// BOOT_HEALTHY_S in safe mode is evidence about the RECOVERY surface — WiFi, the web UI, OTA — and
// says nothing whatever about the fault. Clearing the counter on it hands the next reboot the full
// stack again: it crashes again, and the counter climbs from zero. The device then spends
// BOOT_FAIL_THRESHOLD boots crash-looping for every one boot it is fixable in, which is the reboot
// loop this guard exists to end, merely slowed down — and the owner's browser window into it is one
// boot in five rather than a device that simply stays reachable.
//
// Nothing is stranded by refusing to arm. Every Clean boot (boot_classify) clears both counters,
// and every intentional way out of safe mode is one: a power cycle — the exit the recovery banner
// names —, a settings save that REBOOTS (not every save does: /set_hp applies its change live and
// leaves safe mode latched), an OTA install, the recovery button's factory reset. Safe mode
// therefore ends the moment somebody acts on it, and only then — which is the whole point of
// latching.
inline constexpr bool boot_healthy_timer_arms(bool safe_mode_latched) {
    return !safe_mode_latched;
}

// Does this reset reason count as a CRASH for safe-mode accumulation? Deliberately NARROWER than
// crashinfo's crash_reason_is_fault(): ONLY panic / interrupt-wdt / task-wdt / other-wdt / brownout
// accumulate. A clean power-on, an intentional software reboot (config save / OTA), a deep-sleep /
// USB / JTAG wake — and even a power-glitch or CPU-lockup, which a config change can't fix — do
// NOT. This is the key correctness point: normal provisioning is a rapid burst of config-save
// reboots (reset reason "sw"), and those must never be mistaken for a crash-loop.
//
// Brownout stays in the set on purpose: a supply that cannot carry the radio at start-up loops
// exactly like a config crash, and the minimal boot draws less.
inline bool boot_reset_was_crash(int reset_reason) {
    switch (static_cast<CrashReason>(reset_reason)) {
        case CrashReason::PANIC:
        case CrashReason::INT_WDT:
        case CrashReason::TASK_WDT:
        case CrashReason::OTHER_WDT:
        case CrashReason::BROWNOUT:
            return true;
        default:
            return false;
    }
}

// ── One classification, two independent counters ──────────────────────────────────────────────
// Two persisted counters drive recovery, and they answer different questions:
//   boot_fails — consecutive CRASH boots (safe_mode.cpp); BOOT_FAIL_THRESHOLD latches crash-loop
//                safe mode.
//   heap_rst   — consecutive heap-watchdog restarts (heap_guard.cpp); HEAP_MAX_CONSECUTIVE_RESTARTS
//                ends the ladder in heap safe mode.
//
// They used to reset EACH OTHER. Every "sw" reset cleared boot_fails — and the heap watchdog's
// restart is an esp_restart(), reset reason "sw" — while every boot of any kind consumed heap_rst.
// A fault that alternates between the two (a leak that sometimes panics before the watchdog's hold
// elapses and sometimes reaches it) therefore had each ladder knocked back by the other one's step
// and climbed neither: a reboot loop with no end, through two mechanisms that each exist to end
// one.
//
// Now every boot is classified ONCE, early in safe_mode_begin() before config_load, and each kind
// touches only what it has evidence about:
//   Crash     — boot_fails += 1; heap_rst carried untouched (a crash says nothing about whether
//               the shortage is gone).
//   HeapWatchdogRestart — boot_fails carried untouched (not a crash, and not evidence of health
//               either); heap_rst carried, so the ladder continues.
//   Clean     — both cleared: a power cycle, a rebooting save, an OTA install or a factory reset
//               is the owner acting, and the start of a fresh attempt.
// The healthy timer still clears boot_fails only (boot_healthy_timer_arms); nothing but a Clean
// boot clears heap_rst.
enum class BootKind : uint8_t {
    Clean, // everything else: power-on, pin reset, a rebooting save, an OTA install...
    Crash, // boot_reset_was_crash(): panic, interrupt/task/other watchdog, brownout
    HeapWatchdogRestart, // a "sw" reset the heap watchdog marked as its own (HeapRestartMarker)
};

// The heap watchdog's statement that the NEXT software reset is its own. The reset reason cannot
// say it: the watchdog restarts with esp_restart(), and "sw" is exactly what a settings save, an
// OTA install and a factory reset produce too. So the watchdog leaves this pair in RAM that
// survives a reset which keeps power (heap_guard.cpp places it in .noinit) immediately before its
// esp_restart(), and safe_mode_begin() reads AND clears it once, at the top of every boot.
//
// Two words — a magic and its complement — rather than a flag: .noinit is never initialised, so
// after a power-on the bytes are whatever the SRAM came up holding, and after an OTA install they
// are whatever the previous image kept at that address. One word could match by chance; a 64-bit
// pattern with an internal check does not in practice. And it is trusted only together with reset
// reason "sw" (boot_classify), so even a matching pattern after a power-on, a pin reset or a crash
// means nothing.
//
// Plain data with NO member initialisers, on purpose: an initialiser on an object placed in a
// NOLOAD section is silently dropped by the linker (history.cpp's PersistStore explains that trap),
// and the whole point is that start-up must not touch these bytes. Accessed through volatile
// references: the one store that matters sits immediately before a call that never returns, which
// is exactly the store an optimiser is entitled to question.
struct HeapRestartMarker {
    uint32_t magic;
    uint32_t check;
};
inline constexpr uint32_t HEAP_RESTART_MARKER_MAGIC = 0x48574452u; // "HWDR"

inline void heap_restart_marker_arm(volatile HeapRestartMarker& m) {
    m.magic = HEAP_RESTART_MARKER_MAGIC;
    m.check = ~HEAP_RESTART_MARKER_MAGIC;
}

// Read AND clear, so a marker can explain exactly one reset: the boot after the watchdog's restart
// consumes it, and any later "sw" reset — a settings save on that very boot — finds it gone.
inline bool heap_restart_marker_take(volatile HeapRestartMarker& m) {
    const bool valid =
        m.magic == HEAP_RESTART_MARKER_MAGIC && m.check == ~HEAP_RESTART_MARKER_MAGIC;
    m.magic = 0;
    m.check = 0;
    return valid;
}

// The classification. A crash reason wins over the marker: the watchdog arms the marker and then
// calls esp_restart(), whose shutdown handlers still run — a panic in one of them is a crash, and
// counts as one. The marker is believed only with reset reason "sw", the one reset its own
// esp_restart() can produce.
inline BootKind boot_classify(int reset_reason, bool heap_marker) {
    if (boot_reset_was_crash(reset_reason)) return BootKind::Crash;
    if (heap_marker && reset_reason == static_cast<int>(CrashReason::SW))
        return BootKind::HeapWatchdogRestart;
    return BootKind::Clean;
}

// What one boot does to boot_fails, decided from the classification and the stored value alone, so
// the glue only performs it.
struct CrashCounterStep {
    // The crash count this boot ACTED ON: what latched safe mode or did not, what /diag and the
    // syslog boot record report. On a crash boot whose write then fails it is a RAM-only figure
    // that NVS never got — safe_mode.cpp says so on /diag.
    int  count     = 0;
    bool write     = false; // persist `count` as boot_fails
    bool safe_mode = false; // latch crash-loop safe mode for this boot
};

inline CrashCounterStep boot_crash_counter_step(BootKind kind, int32_t stored) {
    if (kind == BootKind::Crash) {
        // Commit BEFORE the risky subsystems start (the glue runs before config_load), so the bump
        // survives the next crash.
        const int next = boot_next_fail_count(stored);
        return {next, true, boot_should_enter_safe_mode(next)};
    }
    // The heap watchdog's own restart is neither a crash nor evidence of health: carry the count
    // without a write, and latch nothing — only a crash boot ever latches crash-loop safe mode.
    if (kind == BootKind::HeapWatchdogRestart) return {boot_fail_count_sane(stored), false, false};
    // Clean: the counter starts over. Written only when there is something to clear — the ordinary
    // boot writes nothing at all, garbage included.
    return {0, stored != 0, false};
}

// What one boot does to heap_rst. `restarts` is the ladder position this boot honours
// (heap_guard_restarts(); heap_boot_must_be_minimal() of it is the end of the ladder), `clear` says
// whether the stored count must be written back to 0.
struct HeapLadderStep {
    uint8_t restarts = 0;
    bool    clear    = false;
};

inline HeapLadderStep boot_heap_ladder_step(BootKind kind, int32_t stored) {
    // A Clean boot never HONOURS the stored count, whatever it holds — not merely clears it. That
    // is what keeps a power cycle a real retry of the full stack: a count stuck at the cap because
    // the clear keeps failing would otherwise bring every later boot up minimal, power cycles
    // included, and the recovery banner's own instruction would stop working.
    if (kind == BootKind::Clean) return {0, stored != 0};
    // Crash and watchdog boots carry the count as stored, untouched; the watchdog writes the next
    // value itself before its next restart. An unusable value reads as 0 (heap_restart_count_sane).
    return {heap_restart_count_sane(stored), false};
}

} // namespace daik
