#pragma once
// Boot-loop safe-mode decision logic (issue #6) — IDF-free, host-tested. A bad *config* (most
// plausibly wrong RX/TX pins, but any setting that crashes a background task at start-up) can wedge
// the device in a reboot loop whose only exit today is `esptool erase_flash` over USB — breaking the
// project's "recover everything from the web UI" promise. This counts CRASH-only boots in NVS and,
// once a threshold is crossed, lets the device come up MINIMALLY (network + web UI + OTA, no poll /
// MQTT) so the offending config can be fixed remotely.
//
// This is a DIFFERENT failure class from the OTA rollback health-gate: that recovers a bad signed
// *image* and only arms after an update; it can't help a config crash-loop because both OTA slots
// read the same daik_cfg NVS. See docs/SECURITY.md.
//
// The device glue (safe_mode.cpp) reads esp_reset_reason() + the persisted counter and calls these.
#include "crashinfo.hpp"   // CrashReason enum — single source of the reset-reason codes (IDF-mirrored)

namespace daik {

inline constexpr int BOOT_FAIL_THRESHOLD = 4;    // enter safe mode on the Nth consecutive crash boot
inline constexpr int BOOT_HEALTHY_S      = 30;   // continuous uptime that proves this boot is good
inline constexpr int BOOT_FAIL_MAX       = 100;  // saturate the stored counter (no overflow over years)

// Enter safe mode once the crash-boot count reaches the threshold. No off-by-one: the counter is
// incremented BEFORE this check, so with threshold 4 the 4th crash makes fail_count == 4 == threshold.
inline bool boot_should_enter_safe_mode(int fail_count, int threshold = BOOT_FAIL_THRESHOLD) {
    return fail_count >= threshold;
}

// Saturating increment of the persisted counter. A corrupt or first-run read (negative, or an
// unexpectedly large value from a garbled NVS blob) is treated as 0 before incrementing; the result
// saturates at BOOT_FAIL_MAX so a long crash-loop can never overflow the stored int.
inline int boot_next_fail_count(int32_t stored) {
    int cur = (stored < 0 || stored > BOOT_FAIL_MAX) ? 0 : static_cast<int>(stored);
    if (cur >= BOOT_FAIL_MAX) return BOOT_FAIL_MAX;
    return cur + 1;
}

// Does this reset reason count as a CRASH for safe-mode accumulation? Deliberately NARROWER than
// crashinfo's crash_reason_is_fault(): ONLY panic / interrupt-wdt / task-wdt / other-wdt / brownout
// accumulate. A clean power-on, an intentional software reboot (config save / OTA), a deep-sleep /
// USB / JTAG wake — and even a power-glitch or CPU-lockup, which a config change can't fix — do NOT.
// This is the key correctness point: normal provisioning is a rapid burst of config-save reboots
// (reset reason "sw"), and those must never be mistaken for a crash-loop.
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

} // namespace daik
