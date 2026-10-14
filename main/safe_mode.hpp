#pragma once
// Boot-loop safe mode (issue legacy-6) — device glue over the pure logic/boot_guard.hpp. Counts
// crash-only boots in the daik_cfg NVS namespace (so a factory reset / nvs_erase_all clears it too)
// and latches a safe-mode flag once BOOT_FAIL_THRESHOLD crash boots accumulate. In safe mode,
// main.cpp brings the device up minimally so a bad config (e.g. wrong RX/TX pins) can be corrected
// from the browser instead of over USB:
//
//   still started — network (Ethernet / STA / setup portal), SNTP, syslog, the web UI and its API,
//                   OTA and its health gate, history / checkup / state-age bookkeeping (without
//                   adopting RAM), the status indicator and the recovery button
//   skipped       — ENV III, the X10A poll engine (and with it the heap watchdog's sampling), the
//                   MQTT bridge, the Open-Meteo weather client and HomeHub, including its one-shot
//                   initial discovery
#include "logic/boot_guard.hpp" // BootKind

namespace daik {

// Call ONCE, at the very top of app_main: after nvs_flash_init + nvs_storage_init (so the counter
// is durable and serialised with a factory reset), BEFORE config_load and every risky subsystem.
// Classifies this boot (logic/boot_guard.hpp's boot_classify) from esp_reset_reason() and the heap
// watchdog's RAM marker, which it reads and clears — the one place either happens — and applies the
// crash half of that classification: a crash reset increments + commits the counter (before the
// risky subsystems, so the bump survives another crash) and latches safe mode at the threshold; the
// heap watchdog's own restart carries the counter untouched; any other reset clears it (a
// provisioning burst of config-save reboots never trips).
void safe_mode_begin();

// The classification safe_mode_begin() made for this boot. heap_guard_begin() applies the heap half
// of it — one classification, read by both counters, so they can never disagree about what kind of
// boot this was. BootKind::Clean before safe_mode_begin() has run.
BootKind safe_mode_boot_kind();

// The crash count this boot acted on (logic/boot_guard.hpp's CrashCounterStep::count): the value
// that latched crash-loop safe mode or did not. 0 on a clean boot. Reported in the syslog boot
// record (logic/bootlog.hpp), because the /diag line that states it is written long before syslog
// exists.
int safe_mode_crash_boots();

// The latched safe-mode flag — drives /status.sys.safe_mode and the main.cpp boot wiring.
bool safe_mode_active();

// WHY this boot is minimal, as a stable slug for /status.sys.safe_mode_cause, or nullptr when it is
// not. Two causes reach the same state by different routes and need DIFFERENT advice, which is the
// whole reason this exists rather than a bare bool:
//
//   "crash_loop" — BOOT_FAIL_THRESHOLD crash boots accumulated. The configuration is the suspect,
//                  and the RX/TX pins are the first thing to check.
//   "heap"       — the heap watchdog exhausted its restart ladder (legacy-407). The configuration
//                  is almost certainly fine; checking the pins would send the reader to fix
//                  something that is already correct, which is exactly what a recovery banner must
//                  not do. Wins over "crash_loop" when both hold (heap_guard_begin runs second).
const char* safe_mode_cause();

// Latch safe mode for THIS boot because the heap watchdog gave up, not because boots were crashing.
// Called from heap_guard_begin(), which runs after safe_mode_begin() and before main.cpp's
// `if (!safe_mode_active())` gate — so the poll engine and the MQTT bridge are never started at
// all, rather than being started and then found to be the thing eating the heap.
//
// It does NOT touch the crash counter: this boot is not a crash boot and must not be recorded as
// one. The state lasts until the next CLEAN boot (logic/boot_guard.hpp's BootKind): the breadcrumb
// that caused it stays at the cap, a crash in the minimal boot carries it into another minimal
// boot, and a power cycle — the exit the recovery banner names —, a settings save that reboots, an
// OTA install or a factory reset clears it and gives the full stack a fresh attempt. That is what
// somebody who has just installed a newer build wants, and it costs at most one more ladder if they
// have not.
void safe_mode_latch_heap();

// One-shot timer: after BOOT_HEALTHY_S of continuous uptime, clear the crash counter so a single
// old crash doesn't accumulate with a much later, unrelated one. Arm once after services are up. It
// clears boot_fails ONLY: the heap watchdog's restart ladder is cleared by nothing but a clean
// boot.
//
// A NO-OP while safe mode is latched (logic/boot_guard.hpp's boot_healthy_timer_arms), which is
// what makes safe mode a latch rather than a cycle: uptime earned with the poll engine and MQTT
// down is evidence about the recovery surface, not about the fault that is still in the config. The
// caller may therefore call this unconditionally — the guard lives here, not at the call site.
void safe_mode_arm_healthy();

} // namespace daik
