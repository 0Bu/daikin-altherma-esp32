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

// One-shot timer: after BOOT_HEALTHY_S of continuous uptime, clear the crash counter so a single old
// crash doesn't accumulate with a much later, unrelated one. Arm once after services are up.
void safe_mode_arm_healthy();

} // namespace daik
