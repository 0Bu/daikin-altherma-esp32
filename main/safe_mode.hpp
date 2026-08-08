#pragma once
// Boot-loop safe mode (issue #6) — device glue over the pure logic/boot_guard.hpp. Counts crash-only
// boots in the daik_cfg NVS namespace (so a factory reset / nvs_erase_all clears it too) and latches
// a safe-mode flag once BOOT_FAIL_THRESHOLD crash boots accumulate. In safe mode, main.cpp brings the
// device up minimally — WiFi + web UI + OTA only — and skips the X10A poll engine and MQTT bridge, so
// a bad config (e.g. wrong RX/TX pins) can be corrected from the browser instead of over USB.
namespace daik {

// Call ONCE early in app_main, after NVS init + config_load, before any risky subsystem starts.
// Reads esp_reset_reason() + the persisted crash counter: a crash reset increments + commits the
// counter (before the risky subsystems, so the bump survives another crash) and latches safe mode at
// the threshold; a clean / intentional reboot resets the counter to 0 (a provisioning burst never trips).
void safe_mode_begin();

// The latched safe-mode flag — drives /status.sys.safe_mode and the main.cpp boot wiring.
bool safe_mode_active();

// WHY this boot is minimal, as a stable slug for /status.sys.safe_mode_cause, or nullptr when it is
// not. Two causes reach the same state by different routes and need DIFFERENT advice, which is the
// whole reason this exists rather than a bare bool:
//
//   "crash_loop" — BOOT_FAIL_THRESHOLD crash boots accumulated. The configuration is the suspect,
//                  and the RX/TX pins are the first thing to check.
//   "heap"       — the heap watchdog exhausted its restart ladder (#407). The configuration is
//                  almost certainly fine; checking the pins would send the reader to fix something
//                  that is already correct, which is exactly what a recovery banner must not do.
const char* safe_mode_cause();

// Latch safe mode for THIS boot because the heap watchdog gave up, not because boots were crashing.
// Called from heap_guard_begin(), which runs after safe_mode_begin() and before main.cpp's
// `if (!safe_mode_active())` gate — so the poll engine and the MQTT bridge are never started at all,
// rather than being started and then found to be the thing eating the heap.
//
// It does NOT touch the crash counter: this boot is not a crash boot and must not be recorded as
// one. The state lasts exactly this boot, because heap_guard_begin() consumes the breadcrumb that
// caused it — so a power cycle gives the full stack a fresh attempt, which is what somebody who has
// just installed a newer build wants, and costs at most one more ladder if they have not.
void safe_mode_latch_heap();

// One-shot timer: after BOOT_HEALTHY_S of continuous uptime, clear the crash counter so a single old
// crash doesn't accumulate with a much later, unrelated one. Arm once after services are up.
//
// A NO-OP while safe mode is latched (logic/boot_guard.hpp's boot_healthy_timer_arms), which is what
// makes safe mode a latch rather than a cycle: uptime earned with the poll engine and MQTT down is
// evidence about the recovery surface, not about the fault that is still in the config. The caller
// may therefore call this unconditionally — the guard lives here, not at the call site.
void safe_mode_arm_healthy();

} // namespace daik
