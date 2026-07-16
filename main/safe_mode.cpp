// Boot-loop safe mode (see safe_mode.hpp). Pure decision logic is logic/boot_guard.hpp (host-tested);
// this file is the thin device glue: the NVS crash counter + the esp_reset_reason() read + the
// healthy-uptime timer.
#include "safe_mode.hpp"

#include "logic/boot_guard.hpp"
#include "nvs_storage.hpp"
#include "diag_log.hpp"

#include "esp_system.h"
#include "esp_timer.h"

namespace daik {

// Persisted in the daik_cfg namespace (nvs_storage.hpp) so it survives OTA and a future factory reset
// (nvs_erase_all of daik_cfg) wipes it along with the rest of the config — issue #6 / #9.
static const char* BOOT_FAILS_KEY = "boot_fails";

static bool s_safe_mode = false;

void safe_mode_begin() {
    const int reason = static_cast<int>(esp_reset_reason());
    if (boot_reset_was_crash(reason)) {
        const int32_t stored = nvs_get_i32(BOOT_FAILS_KEY, 0);
        const int     next   = boot_next_fail_count(stored);
        // Commit BEFORE the risky subsystems so the bump survives another crash.
        const esp_err_t err = nvs_set_i32(BOOT_FAILS_KEY, next);
        s_safe_mode = boot_should_enter_safe_mode(next);
        if (err == ESP_OK) {
            diag_printf("boot: crash reset, crash_boots=%d%s\n",
                        next, s_safe_mode ? " -> SAFE MODE (poll + MQTT paused)" : "");
        } else {
            // Report what NVS still holds, not the RAM-only `next`. A failed write means every
            // crash boot re-reads `stored` and recomputes the same `next`, so the count can never
            // reach the threshold — the crash loop this guard exists for would spin forever. A
            // wedged flash is itself a plausible cause of that loop, so this line is the only
            // warning that the guard is out of action.
            diag_printf("boot: crash reset, FAILED to persist crash counter (err=%s) — stuck at "
                        "%ld, safe mode cannot latch%s\n", esp_err_to_name(err),
                        static_cast<long>(stored),
                        s_safe_mode ? " (SAFE MODE this boot only)" : "");
        }
    } else {
        // Clean / intentional reboot (power-on, config-save restart, OTA) — a burst of these during
        // provisioning must never accumulate into a false trip, so reset the counter.
        if (nvs_get_i32(BOOT_FAILS_KEY, 0) != 0) {
            const esp_err_t err = nvs_set_i32(BOOT_FAILS_KEY, 0);
            if (err != ESP_OK)
                diag_printf("boot: FAILED to clear crash counter (err=%s) — unrelated crash boots "
                            "keep accumulating and may false-trip safe mode\n", esp_err_to_name(err));
        }
        s_safe_mode = false;
    }
}

bool safe_mode_active() { return s_safe_mode; }

static void healthy_timer_cb(void*) {
    if (nvs_get_i32(BOOT_FAILS_KEY, 0) != 0) {
        const esp_err_t err = nvs_set_i32(BOOT_FAILS_KEY, 0);
        if (err == ESP_OK)
            diag_printf("boot: healthy for %ds, cleared crash counter\n", BOOT_HEALTHY_S);
        else
            diag_printf("boot: healthy for %ds, FAILED to clear crash counter (err=%s) — unrelated "
                        "crash boots keep accumulating and may false-trip safe mode\n",
                        BOOT_HEALTHY_S, esp_err_to_name(err));
    }
}

void safe_mode_arm_healthy() {
    esp_timer_create_args_t args = {};
    args.callback        = &healthy_timer_cb;
    args.dispatch_method = ESP_TIMER_TASK;
    args.name            = "safe_healthy";
    esp_timer_handle_t h = nullptr;
    if (esp_timer_create(&args, &h) == ESP_OK)
        esp_timer_start_once(h, static_cast<uint64_t>(BOOT_HEALTHY_S) * 1000000ULL);
}

} // namespace daik
