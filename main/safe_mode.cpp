// Boot-loop safe mode (see safe_mode.hpp). Pure decision logic is logic/boot_guard.hpp
// (host-tested); this file is the thin device glue: the boot classification, the NVS crash counter
// + the esp_reset_reason() read + the healthy-uptime timer.
#include "safe_mode.hpp"

#include "logic/boot_guard.hpp"
#include "heap_guard.hpp" // heap_guard_take_restart_marker — the watchdog's half of the evidence
#include "nvs_storage.hpp"
#include "diag_log.hpp"

#include "esp_system.h"
#include "esp_timer.h"

namespace daik {

// Persisted in the daik_cfg namespace (nvs_storage.hpp) so it survives OTA and a future factory
// reset (nvs_erase_all of daik_cfg) wipes it along with the rest of the config — issue
// legacy-6 / legacy-9.
static const char* BOOT_FAILS_KEY = "boot_fails";

static bool s_safe_mode = false;
// A string LITERAL, never a std::string: this is read by the /status builder and set on a path the
// heap watchdog reaches when allocation is already failing, so it must not be able to allocate.
static const char* s_cause = nullptr;
static esp_timer_handle_t s_healthy_timer = nullptr;
// This boot's classification and the crash count it acted on. Written once by safe_mode_begin(), on
// the main task before any other task exists, and only read afterwards.
static BootKind s_boot_kind   = BootKind::Clean;
static int      s_crash_boots = 0;

void safe_mode_begin() {
    const int reason = static_cast<int>(esp_reset_reason());
    // The heap watchdog's marker is read — and CLEARED — here and nowhere else, on every boot and
    // whatever the reset reason, so it can explain at most the one reset that followed it.
    // boot_classify() believes it only together with reset reason "sw".
    const bool heap_marker = heap_guard_take_restart_marker();
    s_boot_kind            = boot_classify(reason, heap_marker);

    const int32_t          stored = nvs_get_i32(BOOT_FAILS_KEY, 0);
    const CrashCounterStep step   = boot_crash_counter_step(s_boot_kind, stored);
    s_crash_boots                 = step.count;
    s_safe_mode                   = step.safe_mode;
    s_cause                       = step.safe_mode ? "crash_loop" : nullptr;
    // Commit BEFORE the risky subsystems (this runs before config_load), so a crash boot's bump
    // survives the next crash.
    const esp_err_t err = step.write ? nvs_set_i32(BOOT_FAILS_KEY, step.count) : ESP_OK;

    switch (s_boot_kind) {
    case BootKind::Crash:
        if (err == ESP_OK) {
            diag_printf("boot: crash reset, crash_boots=%d%s\n", step.count,
                        s_safe_mode ? " -> SAFE MODE (poll + MQTT paused)" : "");
        } else {
            // Report what NVS still holds, not the RAM-only count. A failed write means every
            // crash boot re-reads `stored` and recomputes the same count, so it can never reach
            // the threshold — the crash loop this guard exists for would spin forever. A wedged
            // flash is itself a plausible cause of that loop, so this line is the only warning
            // that the guard is out of action.
            diag_printf("boot: crash reset, FAILED to persist crash counter (err=%s) — stuck at "
                        "%ld, safe mode cannot latch%s\n",
                        esp_err_to_name(err), static_cast<long>(stored),
                        s_safe_mode ? " (SAFE MODE this boot only)" : "");
        }
        break;
    case BootKind::HeapWatchdogRestart:
        // Neither a crash nor a clean start: the count is carried without a write, so a fault that
        // alternates between watchdog restarts and crashes still climbs this ladder instead of
        // having it wiped by every "sw" reset. Said only when there is a count to carry.
        if (step.count != 0)
            diag_printf("boot: heap-watchdog restart, crash counter carried at %d\n", step.count);
        break;
    case BootKind::Clean:
        // Clean / intentional reboot (power-on, config-save restart, OTA) — a burst of these
        // during provisioning must never accumulate into a false trip, so the counter was reset.
        if (err != ESP_OK)
            diag_printf("boot: FAILED to clear crash counter (err=%s) — unrelated crash boots "
                        "keep accumulating and may false-trip safe mode\n",
                        esp_err_to_name(err));
        break;
    }
}

BootKind safe_mode_boot_kind() { return s_boot_kind; }

int safe_mode_crash_boots() { return s_crash_boots; }

bool safe_mode_active() { return s_safe_mode; }

const char* safe_mode_cause() { return s_safe_mode ? s_cause : nullptr; }

// See safe_mode.hpp. Deliberately does NOT write boot_fails: this boot is not a crash boot, and
// recording it as one would make the NEXT genuine crash arrive with a head start it did not earn.
void safe_mode_latch_heap() {
    s_safe_mode = true;
    s_cause     = "heap";
}

// boot_fails ONLY. The heap watchdog's ladder (heap_rst) is deliberately not touched: ten healthy
// minutes say nothing about a shortage that takes longer to build, and only a clean boot clears it
// (logic/boot_guard.hpp's boot_heap_ladder_step). safe_mode_crash_boots() keeps reporting the count
// this boot started with.
static void healthy_timer_cb(void* arg) {
    if (nvs_get_i32(BOOT_FAILS_KEY, 0) != 0) {
        const esp_err_t err = nvs_set_i32(BOOT_FAILS_KEY, 0);
        if (err == ESP_OK)
            diag_printf("boot: healthy for %ds, cleared crash counter\n", BOOT_HEALTHY_S);
        else
            diag_printf("boot: healthy for %ds, FAILED to clear crash counter (err=%s) — unrelated "
                        "crash boots keep accumulating and may false-trip safe mode\n",
                        BOOT_HEALTHY_S, esp_err_to_name(err));
    }

    // esp_timer stops a one-shot before entering its callback, but keeps the timer object allocated
    // until the owner deletes it. `arg` points at static handle storage (not at this function's old
    // stack), so clearing it after a successful delete also makes an accidental second arm safe.
    auto* const timer = static_cast<esp_timer_handle_t*>(arg);
    if (timer != nullptr && *timer != nullptr) {
        const esp_err_t err = esp_timer_delete(*timer);
        if (err == ESP_OK)
            *timer = nullptr;
        else
            diag_printf("boot: FAILED to delete healthy timer (err=%s)\n", esp_err_to_name(err));
    }
}

void safe_mode_arm_healthy() {
    // Refused while safe mode is latched — see boot_healthy_timer_arms() for why staying up with the
    // poll engine and MQTT switched off is not evidence that the fault is gone. Said out loud rather
    // than skipped silently: a counter that deliberately does NOT age out looks like a bug to the
    // next person reading /diag, and the line names the way out.
    if (!boot_healthy_timer_arms(s_safe_mode)) {
        diag_printf(
            "boot: SAFE MODE — healthy timer NOT armed; with the poll engine and MQTT down, "
            "staying up says nothing about the fault. Fix the config or install a newer "
            "build — a power cycle, a rebooting save, an OTA install or a factory reset "
            "clears the counter\n");
        return;
    }

    if (s_healthy_timer != nullptr) {
        diag_printf("boot: healthy timer already armed\n");
        return;
    }

    esp_timer_create_args_t args = {};
    args.callback        = &healthy_timer_cb;
    args.arg             = &s_healthy_timer;
    args.dispatch_method = ESP_TIMER_TASK;
    args.name            = "safe_healthy";
    const esp_err_t create_err = esp_timer_create(&args, &s_healthy_timer);
    if (create_err != ESP_OK) {
        diag_printf("boot: FAILED to create healthy timer (err=%s) — crash counter will not age "
                    "out this boot\n", esp_err_to_name(create_err));
        return;
    }

    const esp_err_t start_err = esp_timer_start_once(
        s_healthy_timer, static_cast<uint64_t>(BOOT_HEALTHY_S) * 1000000ULL);
    if (start_err != ESP_OK) {
        diag_printf("boot: FAILED to start healthy timer (err=%s) — crash counter will not age "
                    "out this boot\n", esp_err_to_name(start_err));
        const esp_err_t delete_err = esp_timer_delete(s_healthy_timer);
        if (delete_err == ESP_OK)
            s_healthy_timer = nullptr;
        else
            diag_printf("boot: FAILED to delete unstarted healthy timer (err=%s)\n",
                        esp_err_to_name(delete_err));
    }
}

} // namespace daik
