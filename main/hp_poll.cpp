// Heat-pump poll engine. One task owns the X10A UART; each cycle it queries the active
// profile's registers, decodes the values, and publishes them to a thread-safe cache.
#include "hp_poll.hpp"
#include "checkup.hpp"
#include "config.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "hp_convert.hpp"
#include "hp_detect.hpp"
#include "history.hpp"
#include "logic/availability.hpp"
#include "logic/conv_override.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include "logic/detect.hpp"    // detect_commit_no_match — the rule poll_detect applies to an empty match
#include "logic/detect_backoff.hpp"
#include "logic/hexdump.hpp"
#include "logic/history.hpp"   // history_parse_tenths — the SAME parse history.cpp applies to the witness
#include "logic/ou_stale.hpp"
#include "logic/raw_capture.hpp"
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

// Consecutive bus-answering sweeps that matched no profile. Poll-task-owned, RAM only, like the
// backoff above. Falling back to `generic` costs ~46 rows including every derived figure, so it
// waits for corroboration rather than acting on one sweep (detect_commit_no_match, #214).
static int                   s_no_match = 0;

// Raw page-dump budget for the RUNNING compressor (logic/raw_capture.hpp) — poll-task-owned, RAM
// only, never refilled within a boot. The detect-pass dump in hp_detect.cpp captures the same pages
// at REST; this one exists because the values #194 is about are only wrong while the unit runs.
static logic::RawCaptureState s_raw_capture;

// RAII guard around s_mtx (same idiom as config.cpp), used by every take in this file. It matters
// most for the readers: they copy std::strings OUT of s_stats/s_cache under the lock, so they can
// throw std::bad_alloc mid-critical-section. Releasing on unwind makes that a skipped read (every
// caller guards — the HTTP handlers via handle_all, status_led_task/mqtt_task via their own)
// instead of a mutex left held, which would block the poll task on its next commit and
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
    logic::CheckupCoverage checkup_coverage;
    for (size_t i = 0; i < view.count(); i++) {
        if (!row_publishable(view[i])) continue;
        const ValueDef row = logic::adjudicated(view[i]);
        logic::checkup_cover_row(checkup_coverage, row.reg, row.offset, row.conv, row.label);
    }
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
        checkup_record(nullptr, 0, false, false, checkup_coverage);
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
    // the status LED) copy it under the mutex, and an unlocked last_error assignment would
    // free the old std::string buffer while a reader is copying it — use-after-free on a flaky bus,
    // where this path runs every second.
    uint32_t    d_rx_ok = 0, d_rx_fail = 0, d_timeout = 0, d_crc = 0;
    std::string err;                                                   // last error text, if any

    // Raw payloads of the two pages whose LAYOUT is still an open question, kept for the run-time
    // dump below (see logic/raw_capture.hpp). Stack-resident and tiny; only written when the page
    // answers this cycle, so a page that went silent yields no dump rather than a stale one.
    uint8_t raw10[32]; int raw10_len = -1;
    uint8_t raw20[32]; int raw20_len = -1;

    for (size_t i = 0; i < view.count(); i++) {
        // Unpublishable rows never contribute a queryable register: a page whose rows are ALL
        // unpublishable is not read at all, saving one bus round-trip per cycle. The page still
        // counts toward the profile's DETECTION signature (def/signatures.hpp reads every row), which
        // is exactly why such a row is kept rather than deleted. Two reasons a row lands here — the
        // generator's detect-only flag and the availability ledger's Unproven verdict — and
        // row_publishable() is the one predicate that composes them, so this loop, the decode loop
        // below and mqtt_ha's discovery cannot disagree about the row set.
        if (!row_publishable(view[i])) continue;
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
        // Stash the raw bytes of the two pages the run-time dump is about. Copied rather than
        // re-queried later: a second read would be a different instant, and the whole point is the
        // bytes BEHIND the decoded values this same cycle produced.
        if (reg == 0x10 || reg == 0x20) {
            uint8_t*   dst = (reg == 0x10) ? raw10 : raw20;
            int&       len = (reg == 0x10) ? raw10_len : raw20_len;
            const int  cap = paylen < 32 ? paylen : 32;
            for (int b = 0; b < cap; b++) dst[b] = payload[b];
            len = paylen;
        }

        for (size_t k = 0; k < view.count(); k++) {
            if (view[k].reg != reg) continue;
            if (!row_publishable(view[k])) continue;   // decoded for nobody (see the loop above)
            // The row as it is actually encoded on the wire, not as the generator labelled it
            // (logic/conv_override.hpp). Applied HERE, at the point the row enters the pipeline, so
            // the decode, the cached converter id and everything downstream that keys on it —
            // published_kind, conv_is_binary, display_decimals — cannot disagree about one row.
            const ValueDef def = logic::adjudicated(view[k]);
            CachedValue cv;
            cv.label = def.label;
            cv.unit  = unit_for_datatype(def.type);
            cv.reg   = def.reg;
            cv.off   = def.offset;
            cv.conv  = def.conv;
            std::string val;
            // The whole table goes along: reading_plausible needs it to tell a refrigerant pressure
            // (0 bar impossible) from the water one (0 bar = a drained system, and real). The BASE
            // table is the right argument here — see the profile_refrigerant note above.
            if (hp_format(def, payload, paylen, rtype, val, prof.values, prof.count))
                cv.value = val;
            fresh.push_back(std::move(cv));
        }
    }

    // ── SOURCE freshness: which of these readings is the outdoor unit still measuring? ────────────
    // The outdoor unit refreshes its OWN pages (0x20 sensors, 0x21 inverter) only while it RUNS;
    // stopped, it answers with the last run's numbers (logic/ou_stale.hpp, measured). The web UI has
    // applied that rule since v1.0.13 — the FIRMWARE had not, so the MQTT state topic kept
    // republishing the last run's outdoor air in a freshly-timestamped payload, and #209 measured the
    // consequence against a HomeHub reference: exact agreement at every point while the compressor
    // ran, a mean 1.19 K (max 2.0 K) error over the 195 points while it rested.
    //
    // The value is MARKED, not dropped. history.cpp needs the number to distinguish HELD_OVER from
    // NO_READING (a gap in the chart for the right reason), and the browser already renders "—" on
    // its own. What the mark buys is the MQTT bridge withholding it — a consumer that has no
    // compressor state cannot make that call for itself.
    // The parse is logic/history.hpp's own history_parse_tenths, not a local strtod: history.cpp
    // asks the same question of the same string one call later (its trends distinguish HELD_OVER
    // from NO_READING), and two parses that disagree about, say, a nonnumeric witness value would
    // make the trend ring and the MQTT bridge blank different rows. One function, one answer.
    bool rps_known = false, rps_running = false;
    for (const auto& cv : fresh) {
        if (!logic::ou_is_rps_witness(cv.label.c_str(), cv.reg)) continue;
        int rps_tenths = 0;
        if (logic::history_parse_tenths(cv.value.c_str(), rps_tenths)) {
            rps_known   = true;                        // absent/unreadable stays UNKNOWN, not stopped
            rps_running = rps_tenths > 0;
        }
        break;
    }
    for (auto& cv : fresh)
        cv.held = logic::ou_reading_held_over(cv.reg, rps_known, rps_running);
    const bool ou_held = rps_known && !rps_running;

    // ── RAW page bytes WHILE THE COMPRESSOR RUNS (#194's decisive experiment, #209 root cause) ────
    // The only evidence that can separate a wrong converter scale from a wrong offset for
    // Target Evap. Temp., and it has never been captured: hp_detect.cpp dumps the same pages, but
    // only on a detect pass, which is always a unit at rest — the state where the value is not wrong.
    // Budgeted and edge-triggered so this cannot flood the 6 KB diag ring (logic/raw_capture.hpp).
    if (logic::raw_capture_due(s_raw_capture, rps_running, esp_timer_get_time())) {
        const struct { uint8_t reg; const uint8_t* buf; int len; } run_raw[] = {
            {0x10, raw10, raw10_len}, {0x20, raw20, raw20_len},
        };
        for (const auto& pg : run_raw) {
            if (pg.len < 0) continue;                  // page not read this cycle — nothing to say
            char hex[104];                             // 32 B -> 95 chars + NUL; see logic/hexdump.hpp
            const int capped = pg.len < 32 ? pg.len : 32;
            hex_render(pg.buf, capped, hex, static_cast<int>(sizeof(hex)));
            diag_printf("poll: raw 0x%02X len=%d [%s] (running)\n", pg.reg, pg.len, hex);
        }
    }

    // Feed the trend rings BEFORE the commit and OUTSIDE the cache mutex: history.cpp takes its own
    // lock, and holding both would create a two-mutex order this file has no other reason to have.
    // `fresh` is still ours here — after the move below it is empty.
    history_record(fresh.data(), fresh.size());

    // The rolling X10A observation, on the same terms and for the same reason it is here rather than derived
    // later: compressor starts, defrosts and backup-heater minutes are EVENTS, and an event that
    // happens between two samples of a 5-minute trend ring leaves no trace in it at all — which is
    // precisely the short-run evidence the observation exists to preserve (logic/checkup.hpp). The compressor
    // state is handed over rather than re-derived, so the checkup and the held-over marking above
    // can never disagree about whether the unit was running.
    checkup_record(fresh.data(), fresh.size(), rps_known, rps_running, checkup_coverage);

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
        s_stats.ou_held_over = ou_held;
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
    // Read with the best-fit representative. The ranking is deterministic and — since #230 B —
    // independent of the order the registry is written in (the last tie-break is the lowest profile
    // id), so a reordered table cannot move the entity ids and series this unit publishes. Where the
    // ranking genuinely ties, the survivors are NOT guaranteed to decode alike: that tie is on the
    // page count and the kW-class span, coarser than the row tables (logic/detect.hpp carries the
    // measurement), and the exact variant is not knowable from bus data — which is why /status reports
    // the candidate set and `ambiguous` rather than asserting one model.
    //
    // Nothing matched, but the bus answered: that is either a unit this catalog does not know, or a
    // fingerprint with a page bit missing. The two are indistinguishable in a single sweep and cost
    // wildly different amounts — `generic` drops ~99 rows to 53 and loses leaving water, compressor
    // speed and every pressure — so it is not acted on until a SECOND sweep agrees
    // (detect_commit_no_match, logic/detect.hpp). Keeping "auto" means the next cycle simply
    // re-detects; the model is RAM-only either way, so nothing is persisted by waiting.
    if (d.best.empty()) {
        s_no_match++;
        if (!detect_commit_no_match(s_no_match)) {
            diag_printf("detect: no profile matched (pass %d/%d) — re-detecting before falling back to generic\n",
                        s_no_match, DETECT_NO_MATCH_CONFIRMATIONS);
            return true;                               // bus answered; keep "auto" and sweep again
        }
        diag_printf("detect: no profile matched on %d consecutive sweeps — reading with generic\n",
                    s_no_match);
    } else {
        s_no_match = 0;
    }
    // The profile/link now names a new observation identity. This is deliberately before the
    // same-cycle poll: checkup_record consumes the reset and discards that in-flight boundary sample;
    // the following sweep seeds only the resolved unit.
    checkup_reset();
    config_set_model(d.best.empty() ? "generic" : d.best, d.page_mask, d.kw_tenths, d.iu_kw_tenths,
                     d.eeprom);
    return true;
}

// The cycle body allocates freely — poll_once builds up to ~116 CachedValues (3 std::strings each)
// every second, hp_detect_run grows more — so the whole body is guarded like mqtt_task's: an OOM in a
// fragmented moment (concurrent MQTT TLS reconnect, /set_mqtt's probe client) must skip the cycle and
// keep the last good cache, not throw through this FreeRTOS task into std::terminate() and reboot.
//
// This task no longer PUBLISHES to the browser at all. It used to end each cycle in
// ws_broadcast_values() and every fourth in ws_broadcast_status(), which is how the /status builder
// came to run here (#241) — the dashboard now polls /status and /values on the httpd task instead
// (docs/ARCHITECTURE.md "Push vs. poll"). What this task does is read the bus and commit the cache.
static void poll_task(void*) {
    esp_task_wdt_add(NULL);                                    // this task owns the link — watch it
    for (;;) {
        esp_task_wdt_reset();                                  // top of cycle; poll_once also resets per register
        try {
            if (config().profile == "auto") {
                // Silent-bus detect backoff: sweep at the poll floor at first, then stretch toward the
                // ceiling the longer the bus stays quiet (logic/detect_backoff.hpp). Applied by SKIPPING
                // sweep ticks — the top-of-loop esp_task_wdt_reset() above still fires every second, so
                // any ceiling is watchdog-safe. A resolved profile leaves "auto" and is polled below the
                // same cycle, exactly as before; a skipped cycle leaves the UART untouched (no churn).
                // A user-forced re-detect starts from a clean slate: the no-match tally is evidence
                // about the PREVIOUS sweeps, and carrying it over would let a fresh request inherit
                // a confirmation it never earned.
                if (s_detect_reset.exchange(false)) {
                    s_backoff.silent = 0; s_next_detect_us = 0; s_no_match = 0;
                }
                const int64_t now = esp_timer_get_time();
                if (now >= s_next_detect_us) {
                    const bool answered = poll_detect();
                    const int  wait_s   = detect_backoff_step(s_backoff, answered);
                    s_next_detect_us    = now + static_cast<int64_t>(wait_s) * 1000000;
                }
            }
            if (config().profile != "auto") poll_once();       // then poll it (same cycle if resolved)
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
    //
    // 8192, and it STAYS 8192 because the HomeHub link is a separate task with its own stack.
    //
    // That is worth stating, because a previous revision of the Modbus work had this at 12288: it
    // polled both links from THIS task, which added getaddrinfo()/mdns_query_*()/socket calls to a
    // stack sized without them. syslog.cpp has measured that same chain at 6144 ("4096 is too thin
    // for that call chain"), so the raise was correct — but it charged 4 KB of heap to EVERY device,
    // including the majority with no HomeHub at all. Splitting the two sources into independent
    // stacks moved that call chain to hp_modbus.cpp's own task, which exists only when a HomeHub is
    // configured. The devices that do not have one pay nothing.
    //
    // What remains on this task is what it ran on for months: poll_once + hp_detect_run. #241's
    // overflow was http_append_status_json() reached from the WebSocket broadcaster that used to
    // live here, and that is gone (docs/ARCHITECTURE.md "Push vs. poll"):
    //
    //     TCB             NAME PRIO C/B  STACK USED/FREE
    //     0x3fcc84cc   hp_poll      5/5      7664/520          <- died on the stack watchpoint
    //     0x3fcbf3b4     httpd      5/5     1456/10820
    //
    // Nothing on /status reports stack headroom, so the task table's USED/FREE column in the next
    // core dump is the only place to check this (CLAUDE.md -> Memory constraints). If a future change
    // gives this task a large builder or a deep call chain again, raise it in the SAME commit — and
    // note that a builder shared by two tasks is only ever as safe as its smallest stack.
    if (xTaskCreate(poll_task, "hp_poll", 8192, nullptr, 5, nullptr) != pdPASS)
        diag_printf("hp_poll: poll task alloc failed — X10A polling disabled this boot\n");
}

// The MAXIMUM number of rows THIS cache can hold, so /values and the MQTT bridge size their snapshot
// buffers correctly. Under-sizing silently TRUNCATES rows out of a snapshot — the #35-#39
// absent-value shape. The HomeHub is a separate stack with its own mb_values_capacity().
size_t hp_values_capacity() { return def::lookup_view(config().profile.c_str()).count(); }

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
