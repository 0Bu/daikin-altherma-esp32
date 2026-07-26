// Heat-pump poll engine. One task owns the X10A UART; each cycle it queries the active
// profile's registers, decodes the values, and publishes them to a thread-safe cache.
#include "hp_poll.hpp"
#include "config.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "hp_convert.hpp"
#include "hp_detect.hpp"
#include "history.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include "logic/detect_backoff.hpp"
#include "http_handlers.hpp"

#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <atomic>
#include <cstdio>
#include <exception>
#include <vector>

namespace daik {

static SemaphoreHandle_t      s_mtx = nullptr;
static std::vector<CachedValue> s_cache;
static HpStats               s_stats;
static int64_t               s_last_ok_us = -1;

// Auto-detect backoff state — poll-task-owned, RAM only (model/detection is never persisted: it is
// re-derived every boot). s_next_detect_us gates the next silent-bus sweep on the monotonic clock;
// s_detect_reset is the httpd->poll one-shot that forces a fast re-detect after POST /detect or
// POST /set_hp (cross-task, so it MUST be atomic, not a plain bool). See logic/detect_backoff.hpp.
static DetectBackoff         s_backoff;
static int64_t               s_next_detect_us = 0;
static std::atomic<bool>     s_detect_reset{false};

// RAII guard around s_mtx (same idiom as config.cpp), used by every take in this file. It matters
// most for the readers: they copy std::strings OUT of s_stats/s_cache under the lock, so they can
// throw std::bad_alloc mid-critical-section. Releasing on unwind makes that a skipped read (every
// caller guards — the HTTP handlers via handle_all, ws_broadcast_* and status_led_task/mqtt_task via
// their own) instead of a mutex left held, which would block the poll task on its next commit and
// wedge the device into a watchdog reboot — defeating poll_task's guard. The writers' commits are
// non-allocating and cannot throw, but they take it through Lock as well: it costs nothing, and it
// keeps a later edit that adds an allocating field to a commit from silently reintroducing the bug.
namespace {
struct Lock {
    explicit Lock(SemaphoreHandle_t m) : m_(m) { if (m_) xSemaphoreTake(m_, portMAX_DELAY); }
    ~Lock() { if (m_) xSemaphoreGive(m_); }
    SemaphoreHandle_t m_;
};
}  // namespace

static void poll_once() {
    const Config& c    = config();
    const auto&   prof = def::lookup(c.profile.c_str());
    // The GENERATED rows plus the page-0x10 protection words (def/overlay.hpp). Everything below
    // iterates the VIEW; `prof` survives only for the two calls that need a flat contiguous array
    // (see the profile_refrigerant comment below).
    const auto    view = def::resolved(prof);
    // If the UART can't be brought up on these pins, do NOT sweep: every hp_query would then read an
    // uninstalled driver and emit a misleading "HP timeout — check X10A cable / GND" per register.
    // Name the real cause once and keep the last good cache. (validate()/config_load now reject
    // reserved pins, so this is a belt-and-braces guard rather than the common path.)
    if (!hp_uart_init(c.rx_pin, c.tx_pin)) {
        char eb[48];
        snprintf(eb, sizeof(eb), "UART init failed (rx=%d tx=%d)", c.rx_pin, c.tx_pin);
        std::string err = eb;                              // built before the lock (allocates)
        {
            Lock lk(s_mtx);
            s_stats.connected = false;
            s_stats.last_error.swap(err);                  // noexcept — see the commit below
        }
        return;
    }

    std::vector<CachedValue> fresh;
    fresh.reserve(view.count());  // exact upper bound (<= 1 entry per ValueDef row): one sized allocation
                                 // instead of ~log2(count) grow/free pairs + the transient old+new
                                 // buffer coexistence — lowers peak on the WIRED path too. Still under
                                 // poll_task's try/catch, so an OOM here remains a skipped cycle.
    bool      any_ok = false;
    int       regs   = 0;
    uint8_t   seen[256] = {0};
    // The BASE table, not the view: this scans for the profile's refrigerant row to pick the conv-405
    // saturation curve, and the supplement carries no pressure or conv-405 row — a static_assert in
    // def/overlay.hpp pins that, so this stays correct rather than merely true today. Same reasoning
    // for the table handed to hp_format() below.
    const int rtype  = profile_refrigerant(prof.values, prof.count);   // conv-405 curve selector

    // Stat deltas are staged in locals and folded into s_stats under s_mtx at the end of the cycle.
    // NOTHING in the sweep may touch s_stats directly: hp_stats() readers (MQTT heartbeat, /status,
    // the WS status broadcast) copy it under the mutex, and an unlocked last_error assignment would
    // free the old std::string buffer while a reader is copying it — use-after-free on a flaky bus,
    // where this path runs every second.
    uint32_t    d_rx_ok = 0, d_rx_fail = 0, d_timeout = 0, d_crc = 0;
    std::string err;                                                   // last error text, if any

    for (size_t i = 0; i < view.count(); i++) {
        // Detect-only rows (ValueDef::no_publish) never contribute a queryable register: a page whose
        // rows are ALL flagged is not read at all, saving one bus round-trip per cycle. The page still
        // counts toward the profile's DETECTION signature (def/signatures.hpp reads every row), which
        // is exactly why the row is kept rather than deleted.
        if (view[i].no_publish) continue;
        uint8_t reg = view[i].reg;
        if (seen[reg]) continue;
        seen[reg] = 1;
        regs++;
        // Feed the watchdog once per register: each hp_query blocks up to its serial timeout, so a
        // silent bus makes the whole sweep take (regs × timeout). Resetting per read keeps a
        // slow-but-progressing sweep from ever looking like a hang — only a genuinely stuck read trips.
        esp_task_wdt_reset();

        uint8_t buf[64];
        int n = hp_query(reg, c.proto, buf, sizeof(buf));
        if (n < 0) {
            d_rx_fail++;
            if (n == -1)      d_timeout++;
            else if (n == -3) d_crc++;
            char eb[32];
            snprintf(eb, sizeof(eb), "reg 0x%02X error %d", reg, n);   // identify the failing register
            err = eb;
            continue;
        }
        d_rx_ok++;
        any_ok = true;
        const int      poff    = payload_offset(c.proto);
        const int      paylen  = n - poff - 1;                 // minus header, minus CRC byte
        const uint8_t* payload = buf + poff;

        for (size_t k = 0; k < view.count(); k++) {
            if (view[k].reg != reg) continue;
            if (view[k].no_publish) continue;   // detect-only: decoded for nobody (MIXED page)
            CachedValue cv;
            cv.label = view[k].label;
            cv.unit  = unit_for_datatype(view[k].type);
            cv.reg   = view[k].reg;
            cv.off   = view[k].offset;
            cv.conv  = view[k].conv;
            std::string val;
            // The whole table goes along: reading_plausible needs it to tell a refrigerant pressure
            // (0 bar impossible) from the water one (0 bar = a drained system, and real). The BASE
            // table is the right argument here — see the profile_refrigerant note above.
            if (hp_format(view[k], payload, paylen, rtype, val, prof.values, prof.count))
                cv.value = val;
            fresh.push_back(std::move(cv));
        }
    }

    // Feed the trend rings BEFORE the commit and OUTSIDE the cache mutex: history.cpp takes its own
    // lock, and holding both would create a two-mutex order this file has no other reason to have.
    // `fresh` is still ours here — after the move below it is empty.
    history_record(fresh.data(), fresh.size());

    // One commit, one lock site, and deliberately non-allocating: the vector move-assign steals
    // fresh's buffer and last_error is swapped (noexcept) rather than assigned, so the critical
    // section cannot throw. Lock backs that up — keep both, the invariant is what makes this correct
    // and the guard is what keeps a future allocating field here from stranding the mutex. The
    // buffers swap hands back to `err`/`fresh` are freed after the give, when no reader can see them.
    {
        Lock lk(s_mtx);
        s_cache            = std::move(fresh);
        s_stats.connected  = any_ok;
        s_stats.registers  = regs;
        s_stats.values     = static_cast<int>(s_cache.size());
        s_stats.rx_ok         += d_rx_ok;
        s_stats.rx_fail_total += d_rx_fail;
        s_stats.timeout_err   += d_timeout;
        s_stats.crc_err       += d_crc;
        if (!err.empty()) s_stats.last_error.swap(err);
        if (any_ok) s_last_ok_us = esp_timer_get_time();
    }
}

// Auto-detection cycle: sweep protocol + fingerprint the unit, then apply proto/pins/profile to the
// in-RAM config (logic/detect.hpp, hp_detect.cpp). Runs in place of a normal cycle while
// config().profile == "auto". The MODEL (profile + fingerprint) is session-only, re-detected fresh
// every boot; the LINK cache (pins + protocol) is persisted, but only when it changed (a swapped
// wire self-corrects once, then subsequent boots confirm it with no NVS write). Only commits when
// the bus actually answered, so a not-yet-wired unit simply retries instead of being pinned to "generic".
static bool poll_detect() {                                    // returns true iff the bus answered
    DetectResult d = hp_detect_run();
    if (!d.bus_ok) {
        std::string err = "no X10A response (detecting)";     // built before the lock: it allocates
        {
            Lock lk(s_mtx);
            s_stats.connected  = false;
            s_stats.last_error.swap(err);                      // noexcept — see poll_once's commit
            s_stats.timeout_err++;
            s_stats.rx_fail_total++;
        }
        return false;                                          // keep "auto" — retry per backoff
    }
    // Commit ONLY the fields detection owns — the link (persisted) and the model (RAM). Never a
    // whole-Config write-back: the snapshot below is read on the poll task while the httpd task may
    // be saving credentials, and a whole-struct save would carry this snapshot's stale wifi/mqtt
    // fields over a /set_wifi that landed during the sweep — silently reverting it after the user
    // already got {"ok":true}. logic/config_model.hpp holds the ownership rule.
    const Config c          = config();
    const bool link_changed = (c.rx_pin != d.rx) || (c.tx_pin != d.tx) || (c.proto != d.proto);
    // Persist the link cache only on change (auto-corrected pins, e.g. a swapped wire); an unchanged
    // link is already live in RAM, so there is nothing to patch and no NVS write to make.
    if (link_changed && !config_save_link(d.rx, d.tx, d.proto))
        diag_printf("detect: link cache write failed — pins %d/%d active this session, re-detect next boot\n",
                    d.rx, d.tx);
    // Read with the best-fit representative (deterministic ranking, not registry order). Every
    // candidate in the set is register-equivalent, so this picks correct VALUES regardless of which
    // marketing variant it names; nothing matched but bus answered → generic Altherma profile.
    config_set_model(d.best.empty() ? "generic" : d.best, d.page_mask, d.kw_tenths, d.iu_kw_tenths,
                     d.eeprom);
    return true;
}

// The cycle body allocates freely — poll_once builds up to ~116 CachedValues (3 std::strings each)
// every second, hp_detect_run grows more — so the whole body is guarded like mqtt_task's: an OOM in a
// fragmented moment (concurrent MQTT TLS reconnect, /set_mqtt's probe client) must skip the cycle and
// keep the last good cache, not throw through this FreeRTOS task into std::terminate() and reboot.
// The ws_broadcast_* self-guards stay: they recover finer-grained (skip one client/frame, not the
// cycle), and this handler is only their backstop.
static void poll_task(void*) {
    esp_task_wdt_add(NULL);                                    // this task owns the X10A UART — watch it
    int ticks = 0;
    for (;;) {
        esp_task_wdt_reset();                                  // top of cycle; poll_once also resets per register
        ticks++;
        try {
            if (config().profile == "auto") {
                // Silent-bus detect backoff: sweep at the poll floor at first, then stretch toward the
                // ceiling the longer the bus stays quiet (logic/detect_backoff.hpp). Applied by SKIPPING
                // sweep ticks — the top-of-loop esp_task_wdt_reset() above still fires every second, so
                // any ceiling is watchdog-safe. A resolved profile leaves "auto" and is polled below the
                // same cycle, exactly as before; a skipped cycle leaves the UART untouched (no churn).
                if (s_detect_reset.exchange(false)) { s_backoff.silent = 0; s_next_detect_us = 0; }
                const int64_t now = esp_timer_get_time();
                if (now >= s_next_detect_us) {
                    const bool answered = poll_detect();
                    const int  wait_s   = detect_backoff_step(s_backoff, answered);
                    s_next_detect_us    = now + static_cast<int64_t>(wait_s) * 1000000;
                }
            }
            if (config().profile != "auto") poll_once();       // then poll it (same cycle if resolved)
            ws_broadcast_values();
            if (ticks >= 4) {
                ticks = 0;
                ws_broadcast_status();
            }
        } catch (const std::exception& e) {
            diag_printf("poll: cycle skipped (%s)\n", e.what());
        } catch (...) {
            diag_printf("poll: cycle skipped (oom?)\n");
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));     // fixed 1 s cadence
    }
}

void hp_poll_start() {
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("hp_poll: cache mutex alloc failed — value snapshots return empty\n");
    // The poll engine is the core of the device; if its task can't be created there is no heat-pump
    // polling at all. Report it loudly — the web UI + OTA still come up, so the board stays fixable.
    if (xTaskCreate(poll_task, "hp_poll", 8192, nullptr, 5, nullptr) != pdPASS)
        diag_printf("hp_poll: poll task alloc failed — X10A polling disabled this boot\n");
}

size_t hp_values_snapshot(CachedValue* out, size_t max) {
    if (!s_mtx) return 0;
    Lock lk(s_mtx);
    size_t n = s_cache.size() < max ? s_cache.size() : max;
    for (size_t i = 0; i < n; i++) out[i] = s_cache[i];
    return n;
}

HpStats hp_stats() {
    HpStats st;
    if (!s_mtx) return st;
    Lock lk(s_mtx);
    st = s_stats;
    st.last_ok_s = s_last_ok_us < 0 ? -1
                 : static_cast<int32_t>((esp_timer_get_time() - s_last_ok_us) / 1000000);
    return st;
}

void hp_poll_reconfigure() {
    // POST /detect and POST /set_hp (new pins) run on the httpd task and put profile back to "auto".
    // Drop any accumulated detect backoff so a just-rewired bus is swept on the NEXT poll cycle, not
    // up to DETECT_MAX_INTERVAL_S later. Cross-task (httpd->poll), so it MUST be atomic — the poll
    // task consumes it via exchange() at the top of its auto branch. (Config itself is re-read there
    // every cycle already; this only resets the backoff timer.)
    s_detect_reset.store(true);
}

} // namespace daik
