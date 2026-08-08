// Heap watchdog device glue (see heap_guard.hpp). The decision is the pure, host-tested
// logic/heap_watchdog.hpp; this file samples the heap, narrates the escalation and performs the
// restart.
#include "heap_guard.hpp"

#include "logic/heap_watchdog.hpp"
#include "diag_log.hpp"
#include "nvs_storage.hpp"
#include "safe_mode.hpp"
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

// Transition (Armed/Recovered) narration budget. The Watching line below has always been throttled,
// for a reason stated there — the diag ring is 6 KB, and a line a second evicts the episode's own
// evidence before the restart it is meant to explain. The transitions next to it were not, and on
// the bench board that is exactly what happened (#399): 78 Armed against 4 Watching, and /diag was
// 89% heap: narration with the boot line already gone.
//
// HEAP_RECOVERY_BYTES is the real fix — a transition now needs a swing across the whole band rather
// than a ~512 B flicker, so these are rare by construction. This is the second line of defence, for
// a workload that swings wider than predicted: the log budget must not depend on having guessed the
// allocation pattern right.
//
// The FIRST transition after a quiet period is always logged — an episode must keep its anchor,
// which is precisely what the Watching throttle preserves by never suppressing the Armed line.
// Suppressed transitions are COUNTED and reported on the next line that does go out, so a throttled
// log still says the heap was flapping instead of quietly looking stable.
constexpr uint32_t TRANSITION_QUIET_MS = 60000;
uint32_t s_last_transition_ms = 0;
bool     s_transition_logged  = false;   // false until the first transition of this boot
uint32_t s_suppressed         = 0;

uint32_t now_ms() { return static_cast<uint32_t>(esp_timer_get_time() / 1000); }

// May this Armed/Recovered line go out now? Bumps the budget when it says yes, counts when it says
// no. The Restart line never asks — a deliberate reboot is always worth its one line.
bool transition_may_log(uint32_t now) {
    if (s_transition_logged && static_cast<uint32_t>(now - s_last_transition_ms) < TRANSITION_QUIET_MS) {
        s_suppressed++;
        return false;
    }
    s_last_transition_ms = now;
    s_transition_logged  = true;
    return true;
}

// Emitted as its own line rather than appended to the caller's format string: the callers already
// build their message from several runtime values, and threading an optional tail through each of
// them is how a format string acquires a wrong argument.
void note_suppressed() {
    if (s_suppressed == 0) return;
    diag_printf("heap: %lu further transition(s) in the last %lus were not logged — the heap is "
                "flapping across the critical band\n",
                static_cast<unsigned long>(s_suppressed),
                static_cast<unsigned long>(TRANSITION_QUIET_MS / 1000));
    s_suppressed = 0;
}

} // namespace

size_t heap_largest_internal_block() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
}

uint8_t heap_guard_restarts() { return s_restarts; }

void heap_guard_begin() {
    s_restarts = heap_restart_count_sane(nvs_get_i32(HEAP_RESTARTS_KEY, 0));
    if (s_restarts == 0) return;   // the ordinary case writes nothing at all

    // THE END OF THE LADDER (#407). A boot that inherited the full count is the one the cap used to
    // let come up with everything running and then sit there, wedged and unreachable, five minutes
    // later. It now comes up MINIMAL instead — and this is the right place for that decision rather
    // than the sample site, because here the poll engine and the MQTT bridge have not started yet:
    // the heap is freed from the first second of the boot, not 300 s into it, and there is nothing
    // to tear down (which the header rejects doing, since deinit paths allocate).
    //
    // It also ENDS the ladder by construction rather than by counting: safe mode never creates the
    // poll task, heap_guard_sample() is only ever called from it, so no further restart is reachable
    // from this state. What the sample site's own cap branch guards is now the case where that
    // invariant has been broken.
    if (heap_boot_must_be_minimal(s_restarts)) {
        safe_mode_latch_heap();
        diag_printf("heap: %u consecutive restarts did not fix the shortage — coming up MINIMAL "
                    "(poll engine + MQTT never started) so the web UI and OTA have the heap to "
                    "answer. Install a newer build; a power cycle retries the full stack\n",
                    static_cast<unsigned>(s_restarts));
    }

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
            if (!transition_may_log(s.now_ms)) return;
            note_suppressed();
            diag_printf("heap: largest internal block %u B < %u B — restart in %lus unless it "
                        "recovers past %u B\n",
                        static_cast<unsigned>(s.largest_block),
                        static_cast<unsigned>(HEAP_CRITICAL_BYTES),
                        static_cast<unsigned long>(heap_restart_in_ms(0) / 1000),
                        static_cast<unsigned>(HEAP_RECOVERY_BYTES));
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
            if (!transition_may_log(s.now_ms)) return;
            note_suppressed();
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
                    // Not reachable while the invariant holds: a boot that inherited the full count
                    // comes up in safe mode (heap_guard_begin), and safe mode never creates the poll
                    // task this function is called from. Kept, and worded as the anomaly it would
                    // be, because deleting it would remove the only thing bounding the ladder if
                    // that invariant is ever broken — and an unbounded restart loop is a worse
                    // failure than the wedge.
                    diag_printf("heap: still critical after %lus at the restart cap (%u) while NOT "
                                "minimal — the end-of-ladder safe-mode latch did not take. Staying "
                                "up rather than restarting forever; install a newer build\n",
                                static_cast<unsigned long>(v.critical_ms / 1000),
                                static_cast<unsigned>(s_restarts));
                }
                return;
            }
            {
                // Flush the flap count BEFORE the restart line: this is the last chance it has to
                // reach syslog, and "the heap was flapping" is part of why the device rebooted.
                note_suppressed();
                const int32_t next = static_cast<int32_t>(s_restarts) + 1;
                // Best-effort: a failed write costs the NEXT boot its knowledge of this one, which
                // under-counts (see heap_restart_count_sane) and is the safe direction. It must not
                // stop the restart — the wedge is the thing being escaped.
                const esp_err_t err = nvs_set_i32(HEAP_RESTARTS_KEY, next);
                // States the RECOVERY threshold, not the arm one. With hysteresis the firing sample
                // can legitimately sit between the two — it did on the board, at 4608 B — and
                // printing "< 4096 B" beside a 4608 B reading is a log line asserting something
                // untrue about the number next to it. What the run actually proves is that the heap
                // never climbed clear.
                diag_printf("heap: largest internal block %u B never cleared %u B for %lus — "
                            "restarting deliberately (%ld/%u)%s\n",
                            static_cast<unsigned>(s.largest_block),
                            static_cast<unsigned>(HEAP_RECOVERY_BYTES),
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
