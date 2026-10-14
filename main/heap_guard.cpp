// Heap watchdog device glue (see heap_guard.hpp). The decision is the pure, host-tested
// logic/heap_watchdog.hpp; this file samples the heap, narrates the escalation and performs the
// restart.
#include "heap_guard.hpp"

#include "logic/boot_guard.hpp" // the boot classification, HeapRestartMarker
#include "logic/heap_watchdog.hpp"
#include "diag_log.hpp"
#include "nvs_storage.hpp"
#include "safe_mode.hpp"
#include "ota_update.hpp"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_attr.h" // __NOINIT_ATTR — the restart marker must survive esp_restart()
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_timer.h"

#include <type_traits>

namespace daik {

namespace {

// Persisted in the daik_cfg namespace like boot_fails, so a factory reset (nvs_erase_all) clears it
// with the rest of the configuration. An i32 rather than a formatted string on purpose: the whole
// restart path has to stay allocation-free, and nvs_set_str takes a std::string the caller would
// have to build on a heap that is by definition failing.
const char* HEAP_RESTARTS_KEY = "heap_rst";

HeapWatchdog s_wd;
uint8_t      s_restarts          = 0; // consecutive watchdog restarts this boot honours
bool         s_exhausted_logged = false;
bool         s_reset_hold_logged = false; // the factory-reset hold has been said on /diag
uint32_t     s_watch_minutes = 0; // countdown lines already emitted for the current critical run

// The watchdog's "the next reset is mine" statement (logic/boot_guard.hpp's HeapRestartMarker), in
// .noinit DRAM: not zeroed by start-up, so it survives the esp_restart() it explains — the same
// medium the history rings ride across a reset that keeps power. Armed in exactly one place,
// immediately before that esp_restart() in heap_guard_sample(); read and cleared in exactly one,
// heap_guard_take_restart_marker(), from safe_mode_begin() at the top of every boot. Plain data, so
// the definition emits no initialiser image into the NOLOAD section.
static_assert(std::is_trivially_default_constructible<HeapRestartMarker>::value,
              "an initialiser on the restart marker would be dropped from .noinit silently");
__NOINIT_ATTR volatile HeapRestartMarker s_restart_marker;

// Transition (Armed/Recovered) narration budget. The Watching line below has always been throttled,
// for a reason stated there — the diag ring is 6 KB, and a line a second evicts the episode's own
// evidence before the restart it is meant to explain. The transitions next to it were not, and on
// the bench board that is exactly what happened (legacy-399): 78 Armed against 4 Watching, and
// /diag was 89% heap: narration with the boot line already gone.
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

// The restart is held while a factory reset is erasing stored data (heap_guard.hpp says why). Said
// once per boot, not once a second: the run stays critical, so the Restart verdict comes back on
// every later sample and asks again.
void note_restart_held_for_factory_reset() {
    if (s_reset_hold_logged) return;
    s_reset_hold_logged = true;
    diag_printf("heap: restart HELD — a factory reset is erasing stored data and restarts the "
                "device itself; restarting now could boot a partially erased device\n");
}

} // namespace

size_t heap_largest_internal_block() {
    return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
}

uint8_t heap_guard_restarts() { return s_restarts; }

bool heap_guard_take_restart_marker() { return heap_restart_marker_take(s_restart_marker); }

void heap_guard_begin() {
    // The heap half of the ONE classification safe_mode_begin() made for this boot. A clean boot
    // never honours the stored count, whatever it holds; a crash or watchdog boot carries it as is.
    const BootKind       kind   = safe_mode_boot_kind();
    const int32_t        stored = nvs_get_i32(HEAP_RESTARTS_KEY, 0);
    const HeapLadderStep step   = boot_heap_ladder_step(kind, stored);
    s_restarts                  = step.restarts;

    if (step.clear) {
        // A clean boot with a count stored: the owner power-cycled, saved, updated or reset, and
        // the ladder starts over. Only a FAILED clear is worth a line.
        const esp_err_t err = nvs_set_i32(HEAP_RESTARTS_KEY, 0);
        if (err != ESP_OK) {
            // Not the bad direction it used to be: a clean boot ignores the stale count, so a power
            // cycle can never come up minimal on it (boot_heap_ladder_step). What it still costs is
            // a head start for the next CRASH or watchdog boot, which carries the stored count by
            // design — so this boot says so, with the figure that would be inherited.
            diag_printf("heap: clean boot, FAILED to clear a stored heap-restart count of %ld "
                        "(err=%s) — ignored now, but a later crash or watchdog restart would "
                        "inherit it\n",
                        static_cast<long>(stored), esp_err_to_name(err));
        }
    }
    if (s_restarts == 0) return; // nothing inherited: the ordinary case

    // THE END OF THE LADDER (legacy-407). A boot that inherited the full count is the one the cap
    // used to let come up with everything running and then sit there, wedged and unreachable, five
    // minutes later. It now comes up MINIMAL instead — and this is the right place for that
    // decision rather than the sample site, because here the poll engine and the MQTT bridge have
    // not started yet: the heap is freed from the first second of the boot, not 300 s into it, and
    // there is nothing to tear down (which the header rejects doing, since deinit paths allocate).
    //
    // It also ENDS the ladder by construction rather than by counting: safe mode never creates the
    // poll task, heap_guard_sample() is only ever called from it, so no further restart is
    // reachable from this state. What the sample site's own cap branch guards is now the case where
    // that invariant has been broken.
    //
    // The breadcrumb is NOT cleared here any more: it stays at the cap until a clean boot, so a
    // crash inside the minimal boot comes back minimal rather than handing the full stack another
    // ladder — a crash is no evidence that the shortage is gone. The power cycle this line
    // recommends is a clean boot, and a clean boot never honours the count (boot_heap_ladder_step).
    if (heap_boot_must_be_minimal(s_restarts)) {
        safe_mode_latch_heap();
        diag_printf("heap: %u consecutive restarts did not fix the shortage — coming up MINIMAL "
                    "(poll engine + MQTT never started) so the web UI and OTA have the heap to "
                    "answer. Install a newer build; a power cycle retries the full stack\n",
                    static_cast<unsigned>(s_restarts));
    }

    // Carried, not consumed: the next watchdog restart writes s_restarts + 1 itself, and a crash
    // boot in between inherits the same count again. Which of the two this boot is matters to the
    // reader — a crash in the middle of a ladder is a different story from a clean climb.
    diag_printf("heap: this boot follows %u consecutive heap-watchdog restart(s)%s\n",
                static_cast<unsigned>(s_restarts),
                kind == BootKind::Crash ? ", carried across a crash reset" : "");
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
            // A factory reset is erasing stored data: hold the restart, and touch nothing — no
            // breadcrumb write, no marker (heap_guard.hpp). Asked BEFORE the write, so a held
            // restart leaves no count behind for a restart that never happened.
            if (nvs_factory_reset_latched()) {
                note_restart_held_for_factory_reset();
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
            // Asked again after the drain: the recovery button can latch its reset during those
            // 300 ms, and the latch, not the first answer, is what a restart must respect.
            if (nvs_factory_reset_latched()) {
                note_restart_held_for_factory_reset();
                return;
            }
            // The marker goes in LAST, immediately before the restart and nowhere else, so it can
            // only ever describe this esp_restart(): every path that leaves above — the cap, the
            // factory-reset hold — leaves it unset, and no other "sw" reset (a settings save, an
            // OTA install) can be taken for the watchdog's own (logic/boot_guard.hpp's
            // boot_classify).
            heap_restart_marker_arm(s_restart_marker);
            esp_restart();
    }
}

} // namespace daik
