// The 24-hour trend rings. Policy (which rows, when a sample counts, the bucket math, the held-run
// encoding) lives in logic/history.hpp and is host-tested; this file is the plumbing: static
// storage, one mutex, and the fold from the poll cycle's values into a bucket.
#include "history.hpp"
#include "diag_log.hpp"
#include "logic/history.hpp"

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>

namespace daik {

using logic::HistorySample;
using logic::HISTORY_HELD_OVER;
using logic::HISTORY_NO_READING;
using logic::HISTORY_SAMPLES;
using logic::TREND_COUNT;

namespace {

// Long enough for every label in the generated catalog (the longest is well under 48 chars); a
// truncated copy would only ever cost a spurious ring reset, never a wrong reading.
constexpr size_t kLabelMax = 64;

// The ring mechanics live in logic/history.hpp (host-tested); this pairs one with the row it is
// recording. The label is a COPY — it cannot be a pointer into the poll cache, whose std::strings
// are rebuilt every cycle. It is kept so a model change (POST /detect re-resolves the profile)
// DISCARDS the buffer: the same trend on a different profile is a different sensor, and continuing
// the line would splice two units' data into one curve.
struct Trend {
    logic::TrendRing ring;
    char             label[kLabelMax] = {0};
    // The row's OWN unit, captured with the label. Not derived and NOT assumed to be °C: both
    // trends happen to be temperatures today (every matching row in all 45 profiles is conv 105 /
    // type 1), but the whole promise of the TRENDS table is that adding a trend is one row — and the
    // first pressure or current trend would otherwise be charted, and range-labelled, as °C. That is
    // the #35-#39 shape: well-formed, plausible, wrongly labelled.
    char             unit[8] = {0};
};

Trend             s_ring[TREND_COUNT];
uint32_t          s_bucket = 0;                    // the bucket s_ring[*].pending belongs to
bool              s_have_bucket = false;
SemaphoreHandle_t s_mtx = nullptr;

// RAII lock, same idiom as hp_poll.cpp/config.cpp. Everything inside a critical section here is a
// plain int16/char copy — nothing allocates, so an unwind cannot strand the mutex.
struct Lock {
    SemaphoreHandle_t m;
    bool held;
    explicit Lock(SemaphoreHandle_t mtx) : m(mtx), held(mtx && xSemaphoreTake(mtx, portMAX_DELAY) == pdTRUE) {}
    ~Lock() { if (held) xSemaphoreGive(m); }
    Lock(const Lock&) = delete;
    Lock& operator=(const Lock&) = delete;
};

// The value parse lives in logic/history.hpp (history_parse_tenths) so "ON" -> refused and the
// sentinel clamp are host-tested rather than discovered on a device.
inline bool value_tenths(const std::string& s, int& out) {
    return logic::history_parse_tenths(s.c_str(), out);
}

} // namespace

void history_record(const CachedValue* v, size_t n) {
    if (!s_mtx) {
        s_mtx = xSemaphoreCreateMutex();           // created on the poll task, the only creator
        if (!s_mtx) {
            diag_printf("history: mutex alloc failed — trends disabled this boot\n");
            return;
        }
    }
    if (!v || !n) return;

    // Label/reg views for the pure pickers. Bounded by the profile row count; the poll cache holds
    // at most one entry per ValueDef row (logic/profile_view.hpp sizes both).
    constexpr size_t kMaxRows = 256;
    const size_t rows = n < kMaxRows ? n : kMaxRows;
    const char* labels[kMaxRows];
    unsigned    regs[kMaxRows];
    for (size_t i = 0; i < rows; i++) { labels[i] = v[i].label.c_str(); regs[i] = v[i].reg; }

    // The compressor witness decides whether the outdoor pages are still being refreshed. ABSENT is
    // unknown, not stopped (logic/history.hpp) — a profile without the row keeps recording.
    const int rps_i = logic::trend_rps_row(labels, regs, rows);
    bool rps_known = false, rps_running = false;
    if (rps_i >= 0) {
        int rps_tenths = 0;
        if (value_tenths(v[rps_i].value, rps_tenths)) { rps_known = true; rps_running = rps_tenths > 0; }
    }

    const uint32_t bucket = logic::history_bucket(esp_timer_get_time());

    Lock lk(s_mtx);
    if (!lk.held) return;

    // Crossing into a new bucket closes every trend's open one (TrendRing::commit fills whatever was
    // skipped, so the time axis stays linear — see logic/history.hpp).
    if (s_have_bucket && bucket != s_bucket) {
        const uint32_t skipped = logic::history_skipped(s_bucket, bucket);
        for (auto& tr : s_ring) tr.ring.commit(skipped);
    }
    s_bucket = bucket;
    s_have_bucket = true;

    for (size_t t = 0; t < TREND_COUNT; t++) {
        Trend& tr = s_ring[t];
        const int idx = logic::trend_select(logic::TRENDS[t], labels, regs, rows);
        const char* label = idx >= 0 ? labels[idx] : "";

        if (std::strncmp(label, tr.label, kLabelMax - 1) != 0) {    // different row -> different sensor
            tr.ring.reset();
            std::strncpy(tr.label, label, kLabelMax - 1);
            tr.label[kLabelMax - 1] = '\0';
        }
        if (idx < 0) { tr.unit[0] = '\0'; continue; }
        std::strncpy(tr.unit, v[idx].unit.c_str(), sizeof(tr.unit) - 1);
        tr.unit[sizeof(tr.unit) - 1] = '\0';

        int tenths = 0;
        const bool has = value_tenths(v[idx].value, tenths);
        tr.ring.fold(logic::history_store(has, tenths, regs[idx], rps_known, rps_running));
    }
}

size_t history_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= TREND_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return s_ring[t].ring.snapshot(out, max);
}

// Copied out under the lock rather than returning the pointer: the poll task rewrites these buffers
// on a model change, and a caller holding the pointer would read one mid-write.
static size_t copy_under_lock(const char* src, char* out, size_t max) {
    std::strncpy(out, src, max - 1);
    out[max - 1] = '\0';
    return std::strlen(out);
}

size_t history_label(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return copy_under_lock(s_ring[t].label, out, max);
}

size_t history_unit(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return copy_under_lock(s_ring[t].unit, out, max);
}

} // namespace daik
