// Heap watchdog device glue (see heap_guard.hpp). The decision is the pure, host-tested
// logic/heap_watchdog.hpp; this file samples the heap, narrates the escalation and performs the
// restart.
#include "heap_guard.hpp"

#include "logic/heap_watchdog.hpp"
#include "diag_log.hpp"
#include "nvs_storage.hpp"
#include "ota_update.hpp"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_timer.h"

namespace daik {

namespace {

// Persisted in the daik_cfg namespace like boot_fails, so a factory reset (nvs_erase_all) clears it
// with the rest of the configuration. An i32 rather than a formatted string on purpose: the whole
// restart path has to stay allocation-free, and nvs_set_str takes a std::string the caller would
// have to build on a heap that is by definition failing.
const char* HEAP_RESTARTS_KEY = "heap_rst";

HeapWatchdog s_wd;
uint8_t      s_restarts = 0;      // consecutive watchdog restarts this boot inherited
bool         s_exhausted_logged = false;
uint32_t     s_watch_minutes = 0; // countdown lines already emitted for the current critical run

uint32_t now_ms() { return static_cast<uint32_t>(esp_timer_get_time() / 1000); }

} // namespace

size_t heap_largest_internal_block() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
}

uint8_t heap_guard_restarts() { return s_restarts; }

void heap_guard_begin() {
    s_restarts = heap_restart_count_sane(nvs_get_i32(HEAP_RESTARTS_KEY, 0));
    if (s_restarts == 0) return;   // the ordinary case writes nothing at all

    // Clear it NOW, so the count only ever spans restarts this guard actually made: a device that
    // reaches this line again without the watchdog having re-written the key in between has had an
    // ordinary boot, and the run is over.
    const esp_err_t err = nvs_set_i32(HEAP_RESTARTS_KEY, 0);
    if (err == ESP_OK) {
        diag_printf("heap: this boot follows %u consecutive heap-watchdog restart(s)\n",
                    static_cast<unsigned>(s_restarts));
    } else {
        // The bad direction, so it is said loudly: a breadcrumb stuck at the cap makes
        // heap_may_restart() refuse forever, and the watchdog silently stops being able to escape a
        // real wedge. The device stays up and reachable either way, which is why this is a warning
        // and not a refusal to boot.
        diag_printf("heap: this boot follows %u consecutive heap-watchdog restart(s), but FAILED to "
                    "clear the counter (err=%s) — the watchdog may refuse further restarts\n",
                    static_cast<unsigned>(s_restarts), esp_err_to_name(err));
    }
}

void heap_guard_sample() {
    HeapSample s;
    s.largest_block = heap_largest_internal_block();
    s.now_ms        = now_ms();
    s.ota_busy      = ota_busy();

    const HeapVerdict v = heap_watch(s_wd, s);
    switch (v.action) {
        case HeapAction::Ok:
            return;

        case HeapAction::Armed:
            s_watch_minutes = 0;
            diag_printf("heap: largest internal block %u B < %u B — restart in %lus unless it "
                        "recovers\n",
                        static_cast<unsigned>(s.largest_block),
                        static_cast<unsigned>(HEAP_CRITICAL_BYTES),
                        static_cast<unsigned long>(heap_restart_in_ms(0) / 1000));
            return;

        case HeapAction::Watching: {
            // One countdown line a minute, not one a second: the diag ring is 6 KB and 300 lines
            // would evict the rest of the episode's evidence — including the Armed line that says
            // when this started — before the restart it is meant to explain.
            const uint32_t minute = v.critical_ms / 60000u;
            if (minute <= s_watch_minutes) return;
            s_watch_minutes = minute;
            diag_printf("heap: still critical (%u B) after %lus — restart in %lus\n",
                        static_cast<unsigned>(s.largest_block),
                        static_cast<unsigned long>(v.critical_ms / 1000),
                        static_cast<unsigned long>(heap_restart_in_ms(v.critical_ms) / 1000));
            return;
        }

        case HeapAction::Recovered:
            s_exhausted_logged = false;
            s_watch_minutes    = 0;
            if (v.ota_excused)
                diag_printf("heap: critical run of %lus set aside — an OTA is in flight and holds "
                            "the largest allocations this firmware makes\n",
                            static_cast<unsigned long>(v.critical_ms / 1000));
            else
                diag_printf("heap: recovered after %lus (largest internal block %u B)\n",
                            static_cast<unsigned long>(v.critical_ms / 1000),
                            static_cast<unsigned>(s.largest_block));
            return;

        case HeapAction::Restart:
            if (!heap_may_restart(s_restarts)) {
                // Said once, not once a second: the run stays critical, so this branch is reached on
                // every subsequent sample.
                if (!s_exhausted_logged) {
                    s_exhausted_logged = true;
                    diag_printf("heap: still critical after %lus, but %u consecutive restarts have "
                                "not fixed it — staying up, degraded. Install a newer build or "
                                "power-cycle to reset the count\n",
                                static_cast<unsigned long>(v.critical_ms / 1000),
                                static_cast<unsigned>(s_restarts));
                }
                return;
            }
            {
                const int32_t next = static_cast<int32_t>(s_restarts) + 1;
                // Best-effort: a failed write costs the NEXT boot its knowledge of this one, which
                // under-counts (see heap_restart_count_sane) and is the safe direction. It must not
                // stop the restart — the wedge is the thing being escaped.
                const esp_err_t err = nvs_set_i32(HEAP_RESTARTS_KEY, next);
                diag_printf("heap: largest internal block %u B < %u B for %lus — restarting "
                            "deliberately (%ld/%u)%s\n",
                            static_cast<unsigned>(s.largest_block),
                            static_cast<unsigned>(HEAP_CRITICAL_BYTES),
                            static_cast<unsigned long>(v.critical_ms / 1000),
                            static_cast<long>(next),
                            static_cast<unsigned>(HEAP_MAX_CONSECUTIVE_RESTARTS),
                            err == ESP_OK ? "" : " (counter write failed)");
            }
            // The /diag ring does not survive the restart and the .noinit history rings carry no
            // text, so syslog is the only place this line can be read afterwards. Give its task a
            // moment to drain the datagram before the reset — best-effort, and bounded well inside
            // the poll task's own watchdog budget (reset at the top of this cycle).
            vTaskDelay(pdMS_TO_TICKS(300));
            esp_restart();
    }
}

} // namespace daik
