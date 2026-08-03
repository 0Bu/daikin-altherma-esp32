// The 24-hour trend rings. Policy (which rows, when a sample counts, the bucket math, the held-run
// encoding) lives in logic/history.hpp and is host-tested; this file is the plumbing: static
// storage, one mutex, and the fold from the poll cycle's values into a bucket.
#include "history.hpp"
#include "diag_log.hpp"
#include "logic/binary_semantics.hpp"
#include "logic/homehub_map.hpp"
#include "logic/history.hpp"

#include "esp_heap_caps.h"      // heap_caps_get_largest_free_block — the max_alloc trend
#include "esp_system.h"         // esp_get_free_heap_size — the free_heap trend
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
using logic::HOMEHUB_HISTORY_COUNT;
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
    // The row's OWN unit, captured with the label — never assumed to be °C. The catalog mixes them
    // freely (bar for the two pressures, none at all for flow/rps/pump, where the unit lives in the
    // label text), and a chart whose range readout and crosshair print "°C" over a bar series is the
    // #35-#39 shape: well-formed, plausible, wrongly labelled.
    char             unit[8] = {0};
};

Trend             s_ring[TREND_COUNT];
// Six paired HomeHub measurements plus BSH, 3-way-valve, Quiet and Smart-Grid states get a second ring. Unlike
// X10A trends,
// their labels/units are fixed by def/homehub.hpp, so this side needs no per-ring string buffers.
logic::TrendRing  s_mb_ring[HOMEHUB_HISTORY_COUNT];
static_assert(HOMEHUB_HISTORY_COUNT * logic::HISTORY_BYTES_PER_TREND == 5760,
              "ten HomeHub schematic histories should cost exactly 5760 bytes");
uint32_t          s_bucket = 0;                    // the bucket s_ring[*].pending belongs to
bool              s_have_bucket = false;
uint32_t          s_mb_bucket = 0;
bool              s_mb_have_bucket = false;
// When the newest sample was committed, on the MONOTONIC clock. The route turns this into the
// series' t0 (logic/history_t0): without it t0 was derived from `now` and drifted by up to a full
// bucket between commits, which mislabelled every timestamp and let a PINNED readout round onto
// the neighbouring sample. Monotonic because the commit may predate the first SNTP sync — its
// wall-clock instant is then unknowable, but its age never is. -1 = nothing committed yet.
int64_t           s_last_commit_us = -1;
int64_t           s_mb_last_commit_us = -1;
int64_t           s_last_commit_bucket = -1;
int64_t           s_mb_last_commit_bucket = -1;
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

// The value parse lives in logic/history.hpp (history_parse_tenths) so nonnumeric legacy/corrupt
// values and sentinel collisions are refused in host-tested code rather than on-device surprises.
inline bool value_tenths(const std::string& s, int& out) {
    return logic::history_parse_tenths(s.c_str(), out);
}

// Copy a fixed string into one of the Trend's own buffers, always NUL-terminated.
inline void copy_field(char* dst, size_t max, const char* src) {
    std::strncpy(dst, src, max - 1);
    dst[max - 1] = '\0';
}

} // namespace

void history_start() {
    if (s_mtx) return;                              // app_main is the sole caller; defensive idempotence
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("history: mutex alloc failed — trends disabled this boot\n");
}

void history_record(const CachedValue* v, size_t n) {
    if (!s_mtx || !v || !n) return;

    // Views for the pure pickers. Bounded by the profile row count; the poll cache holds at most one
    // entry per ValueDef row (logic/profile_view.hpp sizes both). A trend addresses its row by
    // (reg, off, unit, optional converter) — the label rides along only to be reported and to detect
    // a model change.
    //
    // These five live on the POLL TASK's stack, so their width is not a detail: as `unsigned`
    // the page and offset views would cost 2 KB between them instead of 512 B, for two values that
    // are a byte each everywhere else in the firmware. 3 KB total, per cycle.
    constexpr size_t kMaxRows = 256;
    const size_t rows = n < kMaxRows ? n : kMaxRows;
    const char* labels[kMaxRows];
    const char* units[kMaxRows];
    uint8_t     regs[kMaxRows];
    uint8_t     offs[kMaxRows];
    int16_t     convs[kMaxRows];
    for (size_t i = 0; i < rows; i++) {
        labels[i] = v[i].label.c_str();
        units[i]  = v[i].unit.c_str();
        regs[i]   = v[i].reg;
        offs[i]   = v[i].off;
        convs[i]  = static_cast<int16_t>(v[i].conv);
    }

    // The compressor witness decides whether the outdoor pages are still being refreshed. ABSENT is
    // unknown, not stopped (logic/history.hpp) — a profile without the row keeps recording.
    const int rps_i = logic::trend_rps_row(labels, regs, rows);
    bool rps_known = false, rps_running = false;
    if (rps_i >= 0) {
        int rps_tenths = 0;
        if (value_tenths(v[rps_i].value, rps_tenths)) { rps_known = true; rps_running = rps_tenths > 0; }
    }

    // Smart-Grid mode is one state assembled from TWO contact bits. Resolve both by their structural
    // semantics, never their labels; the generated catalog spells labels for humans, while these
    // converter-backed ids are the same contract /values uses. Presence and readability stay
    // separate: a timed-out contact leaves a gap but does not make the profile lose the feature.
    bool sg_c1_supported = false, sg_c2_supported = false;
    bool sg_c1_known = false, sg_c2_known = false;
    bool sg_c1_on = false, sg_c2_on = false;
    for (size_t i = 0; i < rows; i++) {
        const char* sid = logic::binary_semantic_for(v[i].reg, v[i].off, v[i].conv);
        if (!sid) continue;
        bool* supported = nullptr;
        bool* known = nullptr;
        bool* on = nullptr;
        if (std::strcmp(sid, "smart_grid_contact_1") == 0) {
            supported = &sg_c1_supported; known = &sg_c1_known; on = &sg_c1_on;
        } else if (std::strcmp(sid, "smart_grid_contact_2") == 0) {
            supported = &sg_c2_supported; known = &sg_c2_known; on = &sg_c2_on;
        } else continue;
        *supported = true;
        int tenths = 0;
        if (value_tenths(v[i].value, tenths) && (tenths == 0 || tenths == 10)) {
            *known = true;
            *on = tenths == 10;
        }
    }
    const bool sg_supported = sg_c1_supported && sg_c2_supported;
    const HistorySample sg_mode = logic::history_smart_grid_mode(
        sg_c1_known, sg_c1_on, sg_c2_known, sg_c2_on);

    const uint32_t bucket = logic::history_bucket(esp_timer_get_time());

    // The board's own memory, read BEFORE the lock: heap_caps_get_largest_free_block takes the
    // heap's internal lock, and taking that under ours would invent a lock order this file has no
    // reason to have (CLAUDE.md → never allocate while holding a mutex; the same argument applies to
    // taking a second, unrelated lock). Both are plain reads of a counter — nothing allocates.
    // A SPOT sample, folded like any other: the 5-minute bucket keeps the last one, so a transient
    // dip between samples is not captured. That is the right shape for the question these answer —
    // is the heap DRIFTING — and /status.sys.min_free_heap still carries the since-boot floor.
    const HistorySample free_heap = logic::history_bytes_tenths_kib(esp_get_free_heap_size());
    const HistorySample max_alloc =
        logic::history_bytes_tenths_kib(heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT));

    Lock lk(s_mtx);
    if (!lk.held) return;

    // Crossing into a new bucket closes every trend's open one (TrendRing::commit fills whatever was
    // skipped, so the time axis stays linear — see logic/history.hpp).
    if (s_have_bucket && bucket != s_bucket) {
        const uint32_t skipped = logic::history_skipped(s_bucket, bucket);
        for (auto& tr : s_ring) tr.ring.commit(skipped);
        s_last_commit_us = esp_timer_get_time();
        s_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
    }
    s_bucket = bucket;
    s_have_bucket = true;

    for (size_t t = 0; t < TREND_COUNT; t++) {
        Trend& tr = s_ring[t];
        const logic::TrendDef& d = logic::TRENDS[t];

        if (d.kind == logic::TrendKind::SmartGridMode) {
            if (!sg_supported) {
                if (tr.label[0]) tr.ring.reset();       // model no longer carries both contacts
                tr.label[0] = '\0';
                tr.unit[0] = '\0';
                continue;
            }
            copy_field(tr.label, sizeof(tr.label), d.label);
            copy_field(tr.unit, sizeof(tr.unit), d.unit);
            tr.ring.fold(sg_mode);
            continue;
        }

        // A BOARD trend has no row to resolve: its label and unit are fixed, it is never absent, and
        // no page can hold it over. Sampled above, outside the lock, like everything else here.
        if (d.kind == logic::TrendKind::FreeHeap || d.kind == logic::TrendKind::MaxAlloc) {
            copy_field(tr.label, sizeof(tr.label), d.label);
            copy_field(tr.unit, sizeof(tr.unit), d.unit);
            tr.ring.fold(d.kind == logic::TrendKind::FreeHeap ? free_heap : max_alloc);
            continue;
        }

        const int idx = logic::trend_select(d, regs, offs, units, convs, rows);
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
        const HistorySample sample =
            logic::history_store(has, tenths, regs[idx], rps_known, rps_running);
        if (d.kind == logic::TrendKind::BinaryEvent) tr.ring.fold_binary_event(sample);
        else tr.ring.fold(sample);
    }
}

void history_record_modbus(const CachedValue* v, size_t n) {
    if (!s_mtx) return;
    const uint32_t bucket = logic::history_bucket(esp_timer_get_time());

    // Parse before taking the history lock. strtod is locale-stable in this firmware and needs no
    // shared state from the rings; keeping it outside makes the critical section plain fixed-size
    // copies, just like the X10A path.
    HistorySample sample[HOMEHUB_HISTORY_COUNT];
    for (size_t t = 0; t < HOMEHUB_HISTORY_COUNT; t++) {
        sample[t] = HISTORY_NO_READING;
        if (!v) continue;
        const uint16_t wanted = logic::HOMEHUB_HISTORIES[t].offset;
        for (size_t i = 0; i < n; i++) {
            if (v[i].off != wanted) continue;
            int tenths = 0;
            if (value_tenths(v[i].value, tenths)) sample[t] = static_cast<HistorySample>(tenths);
            break;
        }
    }

    Lock lk(s_mtx);
    if (!lk.held) return;
    if (s_mb_have_bucket && bucket != s_mb_bucket) {
        const uint32_t skipped = logic::history_skipped(s_mb_bucket, bucket);
        for (auto& ring : s_mb_ring) ring.commit(skipped);
        s_mb_last_commit_us = esp_timer_get_time();
        s_mb_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
    }
    s_mb_bucket = bucket;
    s_mb_have_bucket = true;
    for (size_t t = 0; t < HOMEHUB_HISTORY_COUNT; t++) {
        if (logic::trend_cstr_eq(logic::HOMEHUB_HISTORIES[t].trend_id, "bsh_state"))
            s_mb_ring[t].fold_binary_event(sample[t]);
        else
            s_mb_ring[t].fold(sample[t]);
    }
}

size_t history_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= TREND_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return s_ring[t].ring.snapshot(out, max);
}

size_t history_modbus_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= HOMEHUB_HISTORY_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return s_mb_ring[t].snapshot(out, max);
}

// Copied out under the lock rather than returning the pointer: the poll task rewrites these buffers
// on a model change, and a caller holding the pointer would read one mid-write.
static size_t copy_under_lock(const char* src, char* out, size_t max) {
    std::strncpy(out, src, max - 1);
    out[max - 1] = '\0';
    return std::strlen(out);
}

int32_t history_newest_age_s() {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    if (!lk.held || s_last_commit_us < 0) return -1;
    const int64_t age_us = esp_timer_get_time() - s_last_commit_us;
    return age_us < 0 ? 0 : static_cast<int32_t>(age_us / 1000000);
}

int32_t history_modbus_newest_age_s() {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    if (!lk.held || s_mb_last_commit_us < 0) return -1;
    const int64_t age_us = esp_timer_get_time() - s_mb_last_commit_us;
    return age_us < 0 ? 0 : static_cast<int32_t>(age_us / 1000000);
}

static int64_t oldest_bucket_under_lock(int64_t newest, size_t sample_count) {
    return newest < 0 || !sample_count ? -1 : newest - static_cast<int64_t>(sample_count - 1);
}

int64_t history_oldest_bucket(size_t sample_count) {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    return lk.held ? oldest_bucket_under_lock(s_last_commit_bucket, sample_count) : -1;
}

int64_t history_modbus_oldest_bucket(size_t sample_count) {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    return lk.held ? oldest_bucket_under_lock(s_mb_last_commit_bucket, sample_count) : -1;
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
