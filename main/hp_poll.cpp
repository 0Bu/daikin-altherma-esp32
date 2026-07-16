// Heat-pump poll engine. One task owns the X10A UART; each cycle it queries the active
// profile's registers, decodes the values, and publishes them to a thread-safe cache.
#include "hp_poll.hpp"
#include "config.hpp"
#include "def/registry.hpp"
#include "diag_log.hpp"
#include "hp_comm.hpp"
#include "hp_convert.hpp"
#include "hp_detect.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include "http_handlers.hpp"

#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <cstdio>
#include <exception>
#include <vector>

namespace daik {

static SemaphoreHandle_t      s_mtx = nullptr;
static std::vector<CachedValue> s_cache;
static HpStats               s_stats;
static int64_t               s_last_ok_us = -1;

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
    hp_uart_init(c.rx_pin, c.tx_pin);

    std::vector<CachedValue> fresh;
    bool      any_ok = false;
    int       regs   = 0;
    uint8_t   seen[256] = {0};
    const int rtype  = profile_refrigerant(prof.values, prof.count);   // conv-405 curve selector

    // Stat deltas are staged in locals and folded into s_stats under s_mtx at the end of the cycle.
    // NOTHING in the sweep may touch s_stats directly: hp_stats() readers (MQTT heartbeat, /status,
    // the WS status broadcast) copy it under the mutex, and an unlocked last_error assignment would
    // free the old std::string buffer while a reader is copying it — use-after-free on a flaky bus,
    // where this path runs every second.
    uint32_t    d_rx_ok = 0, d_rx_fail = 0, d_timeout = 0, d_crc = 0;
    std::string err;                                                   // last error text, if any

    for (size_t i = 0; i < prof.count; i++) {
        uint8_t reg = prof.values[i].reg;
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

        for (size_t k = 0; k < prof.count; k++) {
            if (prof.values[k].reg != reg) continue;
            CachedValue cv;
            cv.label = prof.values[k].label;
            cv.unit  = unit_for_datatype(prof.values[k].type);
            cv.reg   = prof.values[k].reg;
            std::string val;
            if (hp_format(prof.values[k], payload, paylen, rtype, val)) cv.value = val;
            fresh.push_back(std::move(cv));
        }
    }

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
static void poll_detect() {
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
        return;                                                // keep "auto" — retry next cycle
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
    config_set_model(d.best.empty() ? "generic" : d.best, d.page_mask, d.kw_tenths, d.eeprom);
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
            if (config().profile == "auto") poll_detect();     // resolves to a concrete profile
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
    xTaskCreate(poll_task, "hp_poll", 8192, nullptr, 5, nullptr);
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

void hp_poll_reconfigure() { /* poll_task re-reads config() at the top of each cycle */ }

} // namespace daik
