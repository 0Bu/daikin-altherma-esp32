// The 24-hour trend rings. Policy (which rows, when a sample counts, the bucket math, the held-run
// encoding) lives in logic/history.hpp and is host-tested; this file is the plumbing: static
// storage, one mutex, and the fold from the poll cycle's values into a bucket.
#include "history.hpp"
#include "diag_log.hpp"
#include "logic/binary_semantics.hpp"
#include "logic/env3.hpp"
#include "logic/history_persist.hpp"
#include "logic/homehub_map.hpp"
#include "logic/history.hpp"
#include "mqtt_ha.hpp"
#include "sntp_time.hpp"

#include "esp_attr.h"           // __NOINIT_ATTR — the whole of step 1 rests on this one attribute
#include "esp_heap_caps.h"      // heap_caps_get_largest_free_block — the max_alloc trend
#include "esp_partition.h"      // the optional `hist` snapshot partition
#include "esp_system.h"         // esp_get_free_heap_size — the free_heap trend
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <atomic>
#include <cmath>
#include <cstdint>
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

// ── The persisted region ────────────────────────────────────────────────────────────────────────
// Every ring in the firmware, in ONE struct, so it can be sealed and re-adopted as a unit — and so
// nothing can be added to the trend set without landing inside the fingerprint that guards it.
//
// The samples are the SAME memory that is served to /history; there is no shadow copy. That is the
// entire reason step 1 costs nothing: a duplicate would be another 28 KB of DRAM on a board whose
// measured low-water free heap is ~101 KB, which is a real price for a nice-to-have. What it costs
// instead is that the region can never be zero-initialised by the startup code, which is precisely
// the property being bought.
struct PersistedHistory {
    // Checked before a single sample is believed — see logic/history_persist.hpp for what each of
    // them rules out. `crc` covers the SEALED fields only (persist_crc below).
    uint32_t magic;
    uint16_t version;
    uint16_t pad;
    uint32_t catalog_fp;
    uint32_t crc;

    Trend ring[TREND_COUNT];
    // Eight paired HomeHub measurements plus BSH, 3-way-valve, Quiet and Smart-Grid states get a
    // second ring. Unlike X10A trends,
    // their labels/units are fixed by def/homehub.hpp, so this side needs no per-ring string buffers.
    logic::TrendRing mb_ring[HOMEHUB_HISTORY_COUNT];
    logic::TrendRing env3_ring[ENV3_HISTORY_COUNT];
};
static_assert(HOMEHUB_HISTORY_COUNT * logic::HISTORY_BYTES_PER_TREND == 6912,
              "twelve HomeHub schematic histories should cost exactly 6912 bytes");
static_assert(ENV3_HISTORY_COUNT * logic::HISTORY_BYTES_PER_TREND == 1728,
              "three ENV III histories should cost exactly 1728 bytes");

// UNINITIALISED STORAGE, and the union is what makes it that. `Trend`/`TrendRing` carry non-static
// data member initialisers (`pending` starts at the non-zero HISTORY_NO_READING, which is why the
// rings have always lived in .data rather than .bss), so a plain definition emits an initialiser
// image — and an initialiser image placed in a NOLOAD section is silently dropped by the linker,
// leaving a variable that LOOKS initialised in the source and is not. A union with a user-provided
// empty constructor emits no initialiser at all, which is the standard C++ way to say "these bytes
// are whatever they were". history_start() then explicitly initialises them on any boot that does
// not adopt them, so nothing here is ever read before it is written.
//
// Side effect worth stating because it is a real win rather than a rounding error: the flash image
// SHRINKS by the size of the rings (~26.5 KB), since .data carried a copy of every zero.
union PersistStore {
    PersistedHistory v;
    PersistStore() {}      // deliberately leaves v untouched
    ~PersistStore() {}
};
__NOINIT_ATTR PersistStore s_store;

// One name for the region, so no call site has to know about the union.
inline PersistedHistory& P() { return s_store.v; }

// Why the raster metadata below is NOT in the persisted region: every one of these is a MONOTONIC
// bucket index, and the monotonic clock restarts at zero on the next boot. Carrying them across
// would place the restored samples in a time frame that no longer exists — the restore path
// re-seeds them against the new boot's clock instead (see persist_restore).
uint32_t          s_bucket = 0;                    // the bucket P().ring[*].pending belongs to
bool              s_have_bucket = false;
uint32_t          s_mb_bucket = 0;
bool              s_mb_have_bucket = false;
uint32_t          s_env3_bucket = 0;
bool              s_env3_have_bucket = false;
// When the newest sample was committed, on the MONOTONIC clock. The route turns this into the
// series' t0 (logic/history_t0): without it t0 was derived from `now` and drifted by up to a full
// bucket between commits, which mislabelled every timestamp and let a PINNED readout round onto
// the neighbouring sample. Monotonic because the commit may predate the first SNTP sync — its
// wall-clock instant is then unknowable, but its age never is. -1 = nothing committed yet.
int64_t           s_last_commit_us = -1;
int64_t           s_mb_last_commit_us = -1;
int64_t           s_env3_last_commit_us = -1;
int64_t           s_last_commit_bucket = -1;
int64_t           s_mb_last_commit_bucket = -1;
int64_t           s_env3_last_commit_bucket = -1;
std::atomic<bool> s_reset_requested{false};
std::atomic<bool> s_mb_reset_requested{false};
std::atomic<bool> s_circulation_reset_requested{false};
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

// Copy a fixed string into one of the Trend's own buffers, always NUL-terminated. Returns whether
// the bytes actually MOVED, which is what keeps the persistence seal cheap: the fold loop rewrites
// every label once a second with the identical text, and re-sealing 28 KB for that would cost a CRC
// per second forever to record nothing.
inline bool copy_field(char* dst, size_t max, const char* src) {
    if (std::strncmp(dst, src, max - 1) == 0) return false;
    std::strncpy(dst, src, max - 1);
    dst[max - 1] = '\0';
    return true;
}

// ── Sealing the region, and adopting it again ───────────────────────────────────────────────────
bool                  s_persist_dirty = false;
logic::HistoryRestore s_persist_verdict = logic::HistoryRestore::NoRecord;

// WHAT THE SEAL COVERS — and the one field it deliberately does not.
//
// `pending`, the bucket currently being folded, is EXCLUDED. Including it is the obvious choice and
// would defeat the whole feature: pending changes on every fold, i.e. once a second, so the CRC
// would be stale for all but a few microseconds out of every five minutes — and a crash, the case
// this exists for most, would land in the stale window essentially always, discarding a day of
// perfectly intact readings. Excluded, the sealed bytes change ONLY at a commit, so the seal written
// after the last commit stays valid right up to the next one. The open bucket is dropped on restore,
// which is the honest answer anyway: a partial five minutes was never a sample.
inline uint32_t persist_crc_ring(uint32_t crc, const logic::TrendRing& r) {
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(r.buf), sizeof(r.buf));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&r.count), sizeof(r.count));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&r.head), sizeof(r.head));
    return crc;
}

inline uint32_t persist_crc() {
    uint32_t crc = CONFIG_CRC32_INIT;
    for (const auto& t : P().ring) {
        crc = persist_crc_ring(crc, t.ring);
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(t.label), sizeof(t.label));
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(t.unit), sizeof(t.unit));
    }
    for (const auto& r : P().mb_ring)   crc = persist_crc_ring(crc, r);
    for (const auto& r : P().env3_ring) crc = persist_crc_ring(crc, r);
    return config_crc32_final(crc);
}

// Called at the end of every record cycle, but only pays the ~28 KB CRC when a commit, a reset or a
// genuine label change actually moved a sealed byte — about once per five minutes per source rather
// than five times a second.
inline void persist_seal_locked() {
    if (!s_persist_dirty) return;
    P().crc = persist_crc();
    s_persist_dirty = false;
}

inline bool rings_have_samples(const logic::TrendRing* r, size_t n) {
    for (size_t i = 0; i < n; i++) if (r[i].count) return true;
    return false;
}

// Start this boot with nothing. REQUIRED rather than defensive: the region is uninitialised storage,
// so without this every count, head and label would be whatever the last firmware left in DRAM.
inline void persist_wipe(uint32_t catalog_fp) {
    std::memset(&P(), 0, sizeof(PersistedHistory));
    // memset alone is NOT enough and the difference is a wrong reading rather than a crash: zero is
    // a perfectly valid sample, while `pending` must start at the NO_READING sentinel or every ring
    // would commit a confident 0.0 for its first bucket.
    for (auto& t : P().ring)        t.ring.reset();
    for (auto& r : P().mb_ring)     r.reset();
    for (auto& r : P().env3_ring)   r.reset();
    P().magic      = logic::HISTORY_PERSIST_MAGIC;
    P().version    = logic::HISTORY_PERSIST_VERSION;
    P().pad        = 0;
    P().catalog_fp = catalog_fp;
    s_persist_dirty = true;
    persist_seal_locked();
}

// Re-anchor the surviving rings onto THIS boot's monotonic clock. No wall clock is consulted and
// none is needed: the bytes only survive a reset that kept power, and such a reset completes in
// about a second, so the newest sample is treated as having been committed at boot. The resulting
// error is bounded by one HISTORY_DT_S — the bucket that was open when the device went down.
//
// Per SOURCE, because they are independent: a board whose HomeHub was switched off since the last
// boot must fall back to the normal first-bucket seeding for that source rather than claim a commit
// that never happened.
inline void persist_adopt(int64_t now_us) {
    const uint32_t bucket = logic::history_bucket(now_us);
    const int64_t  prev   = static_cast<int64_t>(bucket) - 1;

    bool x10a = false;
    for (auto& t : P().ring) { t.ring.pending = HISTORY_NO_READING; if (t.ring.count) x10a = true; }
    for (auto& r : P().mb_ring)   r.pending = HISTORY_NO_READING;
    for (auto& r : P().env3_ring) r.pending = HISTORY_NO_READING;

    if (x10a) {
        s_have_bucket = true; s_bucket = bucket;
        s_last_commit_us = now_us; s_last_commit_bucket = prev;
    }
    if (rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT)) {
        s_mb_have_bucket = true; s_mb_bucket = bucket;
        s_mb_last_commit_us = now_us; s_mb_last_commit_bucket = prev;
    }
    if (rings_have_samples(P().env3_ring, ENV3_HISTORY_COUNT)) {
        s_env3_have_bucket = true; s_env3_bucket = bucket;
        s_env3_last_commit_us = now_us; s_env3_last_commit_bucket = prev;
    }
}

inline bool board_trend(const logic::TrendDef& d) {
    return d.kind == logic::TrendKind::FreeHeap || d.kind == logic::TrendKind::MaxAlloc;
}

inline bool circulation_trend(const logic::TrendDef& d) {
    return d.kind == logic::TrendKind::CirculationState;
}

inline bool independent_trend(const logic::TrendDef& d) {
    return board_trend(d) || circulation_trend(d);
}

// Move the shared X10A/board/MQTT raster to `bucket`. Both the X10A poll task and the independent
// MQTT witness call this under s_mtx; whichever arrives first closes the old bucket exactly once.
// Committing every ring preserves a common boot-aligned axis and writes explicit gaps for sources
// that did not answer during that bucket.
inline void advance_raster_locked(int64_t now_us, uint32_t bucket) {
    if (!s_have_bucket) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& tr : P().ring) tr.ring.reset_with_gaps(completed);
        s_persist_dirty = true;
        if (completed) {
            s_last_commit_us = static_cast<int64_t>(bucket) * logic::HISTORY_DT_S * 1000000;
            s_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        }
    } else if (bucket > s_bucket) {
        // `>`, not `!=`. Both callers read the clock and compute the bucket BEFORE taking s_mtx, so
        // if the other task crosses a five-minute boundary inside that window the loser arrives with
        // a bucket BEHIND the raster. history_skipped() correctly answers 0 there, but commit(0)
        // still ran: every ring took a spurious NO_READING sample and s_bucket moved BACKWARDS,
        // skewing the whole time axis by one slot and making history_newest_age_s() read from an
        // older instant. Only reachable since #367 gave the raster a second, independent advancer.
        const uint32_t skipped = logic::history_skipped(s_bucket, bucket);
        for (auto& tr : P().ring) tr.ring.commit(skipped);
        s_persist_dirty = true;
        s_last_commit_us = now_us;
        s_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
    }
    // MONOTONIC for the same reason the branch above is: the loser of the read-clock-then-lock race
    // must not drag the raster back a slot, which would make the NEXT advance commit a skip that
    // never happened.
    if (!s_have_bucket || bucket > s_bucket) s_bucket = bucket;
    s_have_bucket = true;
}

// The board's own memory, read BEFORE any lock: heap_caps_get_largest_free_block takes the heap's
// internal lock, and taking that under ours would invent a lock order this file has no reason to
// have (CLAUDE.md → never allocate while holding a mutex; the same argument applies to a second,
// unrelated lock). Both are plain reads of a counter — nothing allocates.
struct BoardSample {
    HistorySample free_heap = HISTORY_NO_READING;
    HistorySample max_alloc = HISTORY_NO_READING;
};

inline BoardSample sample_board() {
    BoardSample b;
    b.free_heap = logic::history_bytes_tenths_kib(esp_get_free_heap_size());
    b.max_alloc = logic::history_bytes_tenths_kib(
        heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT));
    return b;
}

// A BOARD trend has no row to resolve: its label and unit are fixed, it is never absent, and no page
// can hold it over. A SPOT sample, folded like any other — the 5-minute bucket keeps the last one, so
// a transient dip between samples is not captured. That is the right shape for the question these
// answer (is the heap DRIFTING), and /status.sys.min_free_heap still carries the since-boot floor.
inline void fold_board_locked(const BoardSample& board) {
    for (size_t t = 0; t < TREND_COUNT; t++) {
        const logic::TrendDef& d = logic::TRENDS[t];
        if (!board_trend(d)) continue;
        Trend& tr = P().ring[t];
        if (copy_field(tr.label, sizeof(tr.label), d.label)) s_persist_dirty = true;
        if (copy_field(tr.unit, sizeof(tr.unit), d.unit)) s_persist_dirty = true;
        tr.ring.fold(d.kind == logic::TrendKind::FreeHeap ? board.free_heap : board.max_alloc);
    }
}

inline void reset_circulation_locked(uint32_t bucket) {
    if (!s_circulation_reset_requested.exchange(false)) return;
    const size_t completed = logic::history_completed_samples(bucket);
    for (size_t t = 0; t < TREND_COUNT; t++) {
        if (!circulation_trend(logic::TRENDS[t])) continue;
        P().ring[t].ring.reset_with_gaps(completed);
        P().ring[t].label[0] = '\0';
        P().ring[t].unit[0] = '\0';
        s_persist_dirty = true;
    }
}

inline void fold_circulation_locked(const CirculationPumpSample& circulation) {
    for (size_t t = 0; t < TREND_COUNT; t++) {
        const logic::TrendDef& d = logic::TRENDS[t];
        if (!circulation_trend(d)) continue;
        Trend& tr = P().ring[t];
        // NO SOURCE CONFIGURED -> no label, and /status.history.rows therefore omits the row
        // entirely, which is how every other optional source states its absence (modbus_rows and
        // env3_rows are gated on their stack being enabled). Labelling it unconditionally offered a
        // trend the device can never fill, so the Diagnostics card drew "no readings yet" under a row
        // that says "not configured" — an absent feature reported as an empty chart, which is exactly
        // what logic/history.hpp's rule refuses. The ring is left untouched: the raster still commits
        // it, so the pending NO_READING becomes an honest gap and a source configured LATER starts on
        // the same 24-hour axis as every other series.
        if (!circulation.configured) {
            if (tr.label[0] || tr.unit[0]) s_persist_dirty = true;
            tr.label[0] = '\0';
            tr.unit[0] = '\0';
            continue;
        }
        if (copy_field(tr.label, sizeof(tr.label), d.label)) s_persist_dirty = true;
        if (copy_field(tr.unit, sizeof(tr.unit), d.unit)) s_persist_dirty = true;
        const HistorySample sample = circulation.known
            ? static_cast<HistorySample>(circulation.on ? 10 : 0) : HISTORY_NO_READING;
        tr.ring.fold(sample);
    }
}

// Which instrument a ring belongs to. The three are never merged — they keep separate liveness and
// separate rasters, the same reason /values keeps two arrays — but the snapshot machinery has to be
// able to name one ring across all of them. The VALUES are part of the flash record's layout (they
// index FlashHeader::anchor), so they are pinned rather than incidental. File-local: no caller
// outside this translation unit addresses a ring this way.
enum class HistorySource : uint8_t { X10a = 0, Modbus = 1, Env3 = 2 };

// ── One ring, addressed across all three sources ────────────────────────────────────────────────
// The snapshot machinery (flash and MQTT alike) is generic over the source, so it needs one way to
// reach a ring. Deliberately NOT a merge of the three: they keep separate liveness and separate
// rasters, exactly as /values keeps two arrays.
logic::TrendRing* ring_at(HistorySource src, size_t idx) {
    switch (src) {
        case HistorySource::X10a:   return idx < TREND_COUNT ? &P().ring[idx].ring : nullptr;
        case HistorySource::Modbus: return idx < HOMEHUB_HISTORY_COUNT ? &P().mb_ring[idx] : nullptr;
        case HistorySource::Env3:   return idx < ENV3_HISTORY_COUNT ? &P().env3_ring[idx] : nullptr;
    }
    return nullptr;
}

int64_t source_last_commit_us(HistorySource src) {
    switch (src) {
        case HistorySource::X10a:   return s_last_commit_us;
        case HistorySource::Modbus: return s_mb_last_commit_us;
        case HistorySource::Env3:   return s_env3_last_commit_us;
    }
    return -1;
}

// Which HomeHub ring is an EVENT timeline rather than a sampled state. Stated once because two
// places need the identical rule and they must not drift: the recorder folds it with
// fold_binary_event, and the snapshot encoder OR-folds it across the coarse group. A row that was
// event-folded going in and decimated going out would lose exactly the pulses the first fold exists
// to catch.
bool homehub_event_ring(size_t idx) {
    return idx < HOMEHUB_HISTORY_COUNT &&
           logic::trend_cstr_eq(logic::HOMEHUB_HISTORIES[idx].trend_id, "bsh_state");
}

// The same question across all three sources, for the snapshot encoder.
bool ring_is_event(HistorySource src, size_t idx) {
    switch (src) {
        case HistorySource::X10a:
            return idx < TREND_COUNT && logic::TRENDS[idx].kind == logic::TrendKind::BinaryEvent;
        case HistorySource::Modbus: return homehub_event_ring(idx);
        case HistorySource::Env3:   return false;   // three measurements, no event rows
    }
    return false;
}

// Named for the one diag line that has to say WHICH source's stored rings were given up on.
const char* source_slug(HistorySource src) {
    switch (src) {
        case HistorySource::X10a:   return "x10a";
        case HistorySource::Modbus: return "homehub";
        case HistorySource::Env3:   return "env3";
    }
    return "unknown";
}

// How long the restore cursor will wait for a source to close its first bucket before writing that
// source's stored rings off. Six buckets: long enough for a HomeHub that powers up with the house
// rather than with this board, short enough that the sources behind it in the slot order are not
// held hostage by one that is simply not there this boot.
constexpr int64_t RESTORE_WAIT_LIMIT_US =
    static_cast<int64_t>(logic::HISTORY_DT_S) * 6 * 1000000LL;

// The ABSOLUTE (wall-clock) bucket of a source's newest committed sample, or INT64_MIN when there is
// none or the clock has never synced. This is the anchor everything that outlives the boot hangs on:
// the ring's own bucket index is monotonic-since-boot and means nothing to the next boot, so a
// snapshot without this is a curve with no position on the axis — and there is no honest default,
// which is why the whole path is skipped rather than guessed at.
int64_t source_anchor_bucket_locked(HistorySource src) {
    if (!time_synced()) return INT64_MIN;
    const int64_t commit_us = source_last_commit_us(src);
    if (commit_us < 0) return INT64_MIN;
    int64_t unix_s = -1; int32_t ms = 0;
    time_now(unix_s, ms);
    if (unix_s < 0) return INT64_MIN;
    const int64_t age_us = esp_timer_get_time() - commit_us;
    const int64_t age_s  = age_us < 0 ? 0 : age_us / 1000000;
    return logic::history_bucket_from_unix(unix_s - age_s);
}

// ── The `hist` partition ────────────────────────────────────────────────────────────────────────
// A COARSE snapshot of every ring, written once per intentional reboot. It exists for the one case
// the .noinit region structurally cannot cover: an OTA moves the new image's sections, so the bytes
// are not where the new build looks for them.
//
// OPTIONAL BY CONSTRUCTION, and this is the load-bearing part rather than defensive coding: a
// partition table is NOT delivered by esp_https_ota (it writes the app slot alone and never touches
// the table at 0x8000), so every device updated over the air keeps the table it was flashed with and
// simply has no such partition. A null lookup therefore means "this board cannot do step 2", exactly
// the absent-feature shape feature_gate.hpp states — never an error, never a retry.
struct FlashHeader {
    uint32_t magic;        //  0
    uint16_t version;      //  4
    uint16_t stride;       //  6
    uint32_t catalog_fp;   //  8
    uint32_t crc;          // 12 — covers everything from `samples` onward, header and payload alike
    uint16_t samples;      // 16 — coarse samples per ring
    uint16_t rings[3];     // 18 — X10A / HomeHub / ENV III ring counts, pinning the payload layout
    int64_t  anchor[3];    // 24 — absolute newest bucket per source; INT64_MIN = that source has none
    uint8_t  pad[16];      // 48
};
static_assert(sizeof(FlashHeader) == 64, "the flash record header is a wire format — keep it 64 B");

const esp_partition_t* s_flash_part = nullptr;
bool s_flash_saved_this_boot = false;      // the shutdown handler must not run twice
bool s_flash_forgotten = false;            // a factory reset must not be re-written on the way out
bool s_flash_restore_done = false;

constexpr size_t kCoarseBytes = logic::HISTORY_COARSE_SAMPLES * sizeof(HistorySample);
constexpr size_t kTotalRings  = TREND_COUNT + HOMEHUB_HISTORY_COUNT + ENV3_HISTORY_COUNT;
static_assert(sizeof(FlashHeader) + kTotalRings * kCoarseBytes <= 0x2000,
              "the coarse record must fit the 8 KB gap between coredump and ota_0");

HistorySource source_of_slot(size_t slot, size_t& idx) {
    if (slot < TREND_COUNT) { idx = slot; return HistorySource::X10a; }
    if (slot < TREND_COUNT + HOMEHUB_HISTORY_COUNT) {
        idx = slot - TREND_COUNT; return HistorySource::Modbus;
    }
    idx = slot - TREND_COUNT - HOMEHUB_HISTORY_COUNT;
    return HistorySource::Env3;
}

// Coarse-encode one ring into `out`, under the lock. Returns the count written.
size_t coarse_of_ring_locked(HistorySource src, size_t idx, HistorySample* out) {
    const logic::TrendRing* r = ring_at(src, idx);
    if (!r) return 0;
    HistorySample full[HISTORY_SAMPLES];
    const size_t n = r->snapshot(full, HISTORY_SAMPLES);
    if (!n) return 0;
    return logic::history_coarse_encode(full, n, logic::HISTORY_COARSE_STRIDE, out,
                                        logic::HISTORY_COARSE_SAMPLES, ring_is_event(src, idx));
}

} // namespace

// Declared here rather than in the header: only history_start() calls it, and only once.
static void history_flash_start();

void history_start() {
    if (s_mtx) return;                              // app_main is the sole caller; defensive idempotence
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("history: mutex alloc failed — trends disabled this boot\n");

    // BEFORE any producer task exists, so nothing can fold into a ring that is about to be wiped or
    // adopted. app_main calls this ahead of hp_poll_start()/mqtt_start(), which is what makes the
    // whole decision single-threaded and lock-free.
    const uint32_t want_fp = logic::history_catalog_fingerprint();
    const uint32_t reason  = static_cast<uint32_t>(esp_reset_reason());
    s_persist_verdict = logic::history_restore_verdict(reason, P().magic, P().version,
                                                       P().catalog_fp, want_fp, P().crc, persist_crc());
    if (s_persist_verdict == logic::HistoryRestore::Accept) {
        persist_adopt(esp_timer_get_time());
        diag_printf("history: rings kept across a %s reset (RAM survived)\n",
                    crash_reason_slug(reason));
    } else {
        persist_wipe(want_fp);
        // Not noise: "wrong_catalog" after an update explains a chart that emptied itself for a
        // reason nobody would otherwise be able to reconstruct, and "bad_crc" on a board that was
        // never power-cycled is a memory fault worth seeing.
        diag_printf("history: rings start empty (%s)\n", logic::history_restore_slug(s_persist_verdict));
    }
    history_flash_start();
}

const char* history_persist_state() { return logic::history_restore_slug(s_persist_verdict); }

void history_reset() {
    // The request may come from the httpd task while the poll task owns the current fold. Defer the
    // reset to history_record(), like checkup_reset(), so one task performs both reset and reseed
    // under the existing history mutex.
    s_reset_requested.store(true);
}

void history_modbus_reset() {
    // Same deferred-reset boundary as X10A: a HomeHub host/port/unit edit can race the old poll
    // cycle, so the Modbus task clears and reseeds its rings before folding the new identity.
    s_mb_reset_requested.store(true);
}

void history_circulation_reset() {
    s_circulation_reset_requested.store(true);
}

// The BOARD's own 24-hour trends (free heap, largest contiguous block) — their ONE producer.
//
// They used to be folded inside history_record(), which is reached only from poll_once(), which the
// poll task calls only once a profile is resolved. A bus that never answers keeps the profile on
// "auto" forever, so on exactly the board someone is debugging — wrong RX/TX, unplugged X10A cable,
// unit powered down — the two memory curves recorded nothing, their labels stayed empty and
// /status.history.rows omitted them: an unrelated board-health feature disappearing because a heat
// pump was unreachable. poll_once()'s own UART-init early return had the same effect on a resolved
// profile.
//
// So the sampling lives here and the poll task calls it unconditionally at the top of every cycle,
// before it decides whether to detect or to sweep. One owner, no branch that can skip it — which is
// what makes the regression structurally unavailable rather than merely fixed. These trends are
// independent of the heat-pump identity in every other respect already (history_reset() exempts
// them, trend_row_matches refuses to resolve them against a row); this makes their PRODUCER
// independent too.
void history_record_board() {
    if (!s_mtx) return;
    const BoardSample board = sample_board();
    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);

    {
        Lock lk(s_mtx);
        if (!lk.held) return;
        advance_raster_locked(now_us, bucket);
        fold_board_locked(board);
        persist_seal_locked();
    }
    // OUTSIDE the lock, and that is not a style choice: the restore takes the same non-recursive
    // mutex through history_splice_snapshot, so calling it from inside this critical section would
    // deadlock the task that owns the X10A UART. It rides this tick because this is the one producer
    // that runs unconditionally, on every cycle, whether or not the bus ever answers.
    history_service_flash_restore();
}

void history_record_circulation() {
    if (!s_mtx) return;
    const CirculationPumpSample circulation = circulation_pump_sample();
    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);

    Lock lk(s_mtx);
    if (!lk.held) return;
    advance_raster_locked(now_us, bucket);
    reset_circulation_locked(bucket);
    fold_circulation_locked(circulation);
    persist_seal_locked();
}

void history_record(const CachedValue* v, size_t n) {
    if (!s_mtx) return;
    if (!v) n = 0;

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

    // Resolve every row once before the lock. Besides avoiding a second catalog scan, this lets a
    // changed non-empty label reset ALL X10A plant rings together before any current-bucket sample
    // is folded. Board histories are independent of the heat-pump identity and remain intact.
    int selected[TREND_COUNT];
    for (size_t t = 0; t < TREND_COUNT; t++) {
        const logic::TrendDef& d = logic::TRENDS[t];
        selected[t] = (d.kind == logic::TrendKind::Row ||
                       d.kind == logic::TrendKind::BinaryState ||
                       d.kind == logic::TrendKind::BinaryEvent)
            ? logic::trend_select(d, regs, offs, units, convs, rows) : -1;
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

    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);

    const CirculationPumpSample circulation = circulation_pump_sample();

    Lock lk(s_mtx);
    if (!lk.held) return;

    // Every X10A and board ring shares the monotonic boot epoch. If polling starts late, seed the
    // already-completed part of the 24-hour window with explicit gaps instead of giving each source
    // a different apparent start time.
    advance_raster_locked(now_us, bucket);

    bool identity_changed = false;
    for (size_t t = 0; t < TREND_COUNT; t++) {
        const int idx = selected[t];
        if (idx >= 0 && logic::history_row_identity_changed(P().ring[t].label, idx, labels[idx])) {
            identity_changed = true;
            break;
        }
    }
    if (s_reset_requested.exchange(false) || identity_changed) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (size_t t = 0; t < TREND_COUNT; t++) {
            if (independent_trend(logic::TRENDS[t])) continue;
            P().ring[t].ring.reset_with_gaps(completed);
            P().ring[t].label[0] = '\0';
            P().ring[t].unit[0] = '\0';
        }
        s_persist_dirty = true;
    }
    reset_circulation_locked(bucket);

    for (size_t t = 0; t < TREND_COUNT; t++) {
        Trend& tr = P().ring[t];
        const logic::TrendDef& d = logic::TRENDS[t];

        if (d.kind == logic::TrendKind::SmartGridMode) {
            if (!sg_supported) {
                // A page timeout can hide either contact for one sweep. Preserve the established
                // identity and let the untouched NO_READING pending value become a gap; an actual
                // model/link change arrives through history_reset() above.
                continue;
            }
            if (copy_field(tr.label, sizeof(tr.label), d.label)) s_persist_dirty = true;
            if (copy_field(tr.unit, sizeof(tr.unit), d.unit)) s_persist_dirty = true;
            tr.ring.fold(sg_mode);
            continue;
        }

        // A BOARD trend is recorded by history_record_board() alone, on the poll task's
        // unconditional top-of-cycle tick. It must NOT also be folded here: this function is reached
        // only through poll_once(), i.e. only once a profile is resolved, and folding it in both
        // places is what let a single owner look like two (see history_record_board).
        if (board_trend(d)) continue;

        if (d.kind == logic::TrendKind::CirculationState) continue;
        const int idx = selected[t];
        // Missing in this sweep means NO READING, not NO FEATURE. Keep the established label, unit
        // and ring; pending is already NO_READING and the bucket commit will preserve the gap.
        if (idx < 0) continue;
        if (copy_field(tr.label, sizeof(tr.label), labels[idx])) s_persist_dirty = true;
        if (copy_field(tr.unit, sizeof(tr.unit), v[idx].unit.c_str())) s_persist_dirty = true;

        int tenths = 0;
        const bool has = value_tenths(v[idx].value, tenths);
        const HistorySample sample =
            logic::history_store(has, tenths, regs[idx], rps_known, rps_running);
        if (d.kind == logic::TrendKind::BinaryEvent) tr.ring.fold_binary_event(sample);
        else tr.ring.fold(sample);
    }
    fold_circulation_locked(circulation);
    persist_seal_locked();
}

void history_record_modbus(const CachedValue* v, size_t n) {
    if (!s_mtx) return;
    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);

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
    if (!s_mb_have_bucket) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().mb_ring) ring.reset_with_gaps(completed);
        s_persist_dirty = true;
        if (completed) {
            s_mb_last_commit_us = static_cast<int64_t>(bucket) * logic::HISTORY_DT_S * 1000000;
            s_mb_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        }
    } else if (bucket != s_mb_bucket) {
        const uint32_t skipped = logic::history_skipped(s_mb_bucket, bucket);
        for (auto& ring : P().mb_ring) ring.commit(skipped);
        s_persist_dirty = true;
        s_mb_last_commit_us = now_us;
        s_mb_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
    }
    s_mb_bucket = bucket;
    s_mb_have_bucket = true;
    if (s_mb_reset_requested.exchange(false)) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().mb_ring) ring.reset_with_gaps(completed);
        s_persist_dirty = true;
    }
    for (size_t t = 0; t < HOMEHUB_HISTORY_COUNT; t++) {
        if (homehub_event_ring(t)) P().mb_ring[t].fold_binary_event(sample[t]);
        else                       P().mb_ring[t].fold(sample[t]);
    }
    persist_seal_locked();
}

void history_record_env3(bool valid, float temperature_c, float humidity_pct, float pressure_hpa) {
    if (!s_mtx) return;
    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);
    HistorySample sample[ENV3_HISTORY_COUNT] = {
        HISTORY_NO_READING, HISTORY_NO_READING, HISTORY_NO_READING,
    };
    const bool accepted = valid && env3_sample_plausible(temperature_c, humidity_pct, pressure_hpa);
    if (accepted) {
        sample[0] = static_cast<HistorySample>(std::lround(temperature_c * 10.0f));
        sample[1] = static_cast<HistorySample>(std::lround(humidity_pct * 10.0f));
        sample[2] = static_cast<HistorySample>(std::lround(pressure_hpa * 10.0f));
    }

    Lock lk(s_mtx);
    if (!lk.held) return;
    if (!s_env3_have_bucket) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().env3_ring) ring.reset_with_gaps(completed);
        s_persist_dirty = true;
        if (completed) {
            s_env3_last_commit_us = static_cast<int64_t>(bucket) * logic::HISTORY_DT_S * 1000000;
            s_env3_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        }
    } else if (bucket != s_env3_bucket) {
        const uint32_t skipped = logic::history_skipped(s_env3_bucket, bucket);
        for (auto& ring : P().env3_ring) ring.commit(skipped);
        s_persist_dirty = true;
        s_env3_last_commit_us = now_us;
        s_env3_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
    }
    s_env3_bucket = bucket;
    s_env3_have_bucket = true;
    // An intermittent error later in a bucket must not erase an earlier complete observation. If
    // the whole bucket has no valid sample, its untouched pending sentinel commits as an honest gap.
    if (accepted) {
        for (size_t t = 0; t < ENV3_HISTORY_COUNT; ++t) P().env3_ring[t].fold(sample[t]);
    }
    persist_seal_locked();
}

size_t history_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= TREND_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    // Do not expose the old physical identity while its deferred reset is waiting for the poll task.
    if (!lk.held || (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    return P().ring[t].ring.snapshot(out, max);
}

size_t history_modbus_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= HOMEHUB_HISTORY_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held || s_mb_reset_requested.load()) return 0;
    return P().mb_ring[t].snapshot(out, max);
}

size_t history_env3_snapshot(size_t t, HistorySample* out, size_t max) {
    if (t >= ENV3_HISTORY_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held) return 0;
    return P().env3_ring[t].snapshot(out, max);
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
    if (!lk.held || s_mb_reset_requested.load() || s_mb_last_commit_us < 0) return -1;
    const int64_t age_us = esp_timer_get_time() - s_mb_last_commit_us;
    return age_us < 0 ? 0 : static_cast<int32_t>(age_us / 1000000);
}

int32_t history_env3_newest_age_s() {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    if (!lk.held || s_env3_last_commit_us < 0) return -1;
    const int64_t age_us = esp_timer_get_time() - s_env3_last_commit_us;
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
    return lk.held && !s_mb_reset_requested.load()
        ? oldest_bucket_under_lock(s_mb_last_commit_bucket, sample_count) : -1;
}

int64_t history_env3_oldest_bucket(size_t sample_count) {
    if (!s_mtx) return -1;
    Lock lk(s_mtx);
    return lk.held ? oldest_bucket_under_lock(s_env3_last_commit_bucket, sample_count) : -1;
}

// ── Splicing an older snapshot in behind the live samples ───────────────────────────────────────
// The stored record arrives LATE — it needs a synced clock and a live side that has committed at
// least one bucket — which is exactly why it is spliced by absolute bucket rather than appended.
//
// Two scratch buffers in .bss rather than on the poll task's stack: 1152 bytes is a seventh of that
// task's 8 KB, and this runs on the same task that owns the X10A UART and already spends ~3 KB per
// cycle in history_record(). Safe because every caller holds the history mutex.
static logic::HistorySample s_splice_live[HISTORY_SAMPLES];
static logic::HistorySample s_splice_out[HISTORY_SAMPLES];

namespace {

// Replace a ring's committed contents, keeping the bucket currently being folded. `pending` is not
// part of the splice: it belongs to a bucket that has not closed, and the older snapshot has nothing
// to say about it.
void ring_replace_locked(logic::TrendRing& r, const HistorySample* v, size_t n) {
    const HistorySample pending = r.pending;
    r.reset();
    for (size_t i = 0; i < n; i++) r.push(v[i]);
    r.pending = pending;
}

bool splice_locked(HistorySource src, size_t idx, const HistorySample* v, size_t n, uint32_t stride,
                   int64_t newest_bucket) {
    logic::TrendRing* r = ring_at(src, idx);
    if (!r || !v || !n || newest_bucket == INT64_MIN) return false;

    // A source with NOTHING COMMITTED YET is refused rather than seeded from the snapshot, and the
    // reason is the metadata rather than the samples: s_*_last_commit_us would still say "nothing
    // committed", so the route would report no t0 and the browser would draw a series it cannot
    // place in time. Waiting for the first commit costs at most one bucket and keeps every
    // downstream number consistent — an absolute anchor is exactly what a late splice already has.
    const int64_t live_anchor = source_anchor_bucket_locked(src);
    if (live_anchor == INT64_MIN) return false;
    const size_t live_n = r->snapshot(s_splice_live, HISTORY_SAMPLES);
    if (!live_n) return false;

    logic::HistorySnapshotView view;
    view.v = v; view.n = n; view.stride = stride; view.newest_bucket = newest_bucket;
    const size_t len = logic::history_splice(view, s_splice_live, live_n, live_anchor,
                                             s_splice_out, HISTORY_SAMPLES);
    if (len <= live_n) return false;                 // nothing older survived the window — not an error
    ring_replace_locked(*r, s_splice_out, len);
    s_persist_dirty = true;
    return true;
}

} // namespace

// The locking wrapper the flash restore uses. File-local since the MQTT snapshot path was dropped:
// nothing outside this file splices a stored series in any more.
static bool history_splice_snapshot(HistorySource src, size_t idx, const logic::HistorySample* v,
                                    size_t n, uint32_t stride, int64_t newest_bucket) {
    if (!s_mtx) return false;
    Lock lk(s_mtx);
    if (!lk.held) return false;
    // The same guard the live reader uses: never rebuild a ring whose physical identity is about to
    // be discarded anyway.
    if (src == HistorySource::X10a && s_reset_requested.load()) return false;
    if (src == HistorySource::Modbus && s_mb_reset_requested.load()) return false;
    const bool ok = splice_locked(src, idx, v, n, stride, newest_bucket);
    persist_seal_locked();
    return ok;
}

size_t history_label(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held || (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    return copy_under_lock(P().ring[t].label, out, max);
}

size_t history_unit(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.held || (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    return copy_under_lock(P().ring[t].unit, out, max);
}

// ── The `hist` partition: write on the way out, splice back on the way in ───────────────────────
namespace {

// Fill one 48-slot block RIGHT-ALIGNED: the newest coarse sample always lands in the last slot, so
// the decoder can position the whole block from a single anchor without also storing a per-ring
// count. A ring with less than a full day pads its OLD end with the absence sentinel, which is what
// that time genuinely was.
void coarse_block_locked(size_t slot, HistorySample* block) {
    for (size_t i = 0; i < logic::HISTORY_COARSE_SAMPLES; i++) block[i] = HISTORY_NO_READING;
    size_t idx = 0;
    const HistorySource src = source_of_slot(slot, idx);
    HistorySample coarse[logic::HISTORY_COARSE_SAMPLES];
    const size_t m = coarse_of_ring_locked(src, idx, coarse);
    for (size_t i = 0; i < m; i++)
        block[logic::HISTORY_COARSE_SAMPLES - m + i] = coarse[i];
}

FlashHeader s_flash_header{};
bool        s_flash_header_read = false;
bool        s_flash_header_valid = false;
size_t      s_flash_restore_slot = 0;

// Returns false on a read error rather than folding it into the CRC value: a failed read that
// happened to produce the stored checksum would admit an unverified record, and "the flash could not
// be read" is a different finding from "the flash disagrees".
bool flash_payload_crc(uint32_t crc, uint32_t& out) {
    HistorySample block[logic::HISTORY_COARSE_SAMPLES];
    for (size_t slot = 0; slot < kTotalRings; slot++) {
        if (esp_partition_read(s_flash_part, sizeof(FlashHeader) + slot * kCoarseBytes,
                               block, kCoarseBytes) != ESP_OK) return false;
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(block), kCoarseBytes);
    }
    out = config_crc32_final(crc);
    return true;
}

// Read and validate the stored record ONCE per boot. Needs no clock — the anchors inside it are
// absolute, so the record can be judged long before SNTP has anything to say.
void flash_header_load() {
    if (s_flash_header_read || !s_flash_part) return;
    s_flash_header_read = true;
    if (esp_partition_read(s_flash_part, 0, &s_flash_header, sizeof(FlashHeader)) != ESP_OK) return;
    const FlashHeader& h = s_flash_header;
    // The catalog fingerprint does the same job here as in RAM: an OTA that moved TRENDS must not
    // let slot 12 be decoded as whatever slot 12 means now. This is the case that actually happens,
    // since surviving an OTA is the entire reason this partition exists.
    if (h.magic != logic::HISTORY_PERSIST_MAGIC || h.version != logic::HISTORY_PERSIST_VERSION ||
        h.stride != logic::HISTORY_COARSE_STRIDE || h.samples != logic::HISTORY_COARSE_SAMPLES ||
        h.rings[0] != TREND_COUNT || h.rings[1] != HOMEHUB_HISTORY_COUNT ||
        h.rings[2] != ENV3_HISTORY_COUNT || h.catalog_fp != P().catalog_fp) {
        diag_printf("history: stored snapshot ignored (not this build's trend catalog)\n");
        return;
    }
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&h) + 16, sizeof(FlashHeader) - 16);
    uint32_t payload_crc = 0;
    if (!flash_payload_crc(crc, payload_crc) || payload_crc != h.crc) {
        diag_printf("history: stored snapshot ignored (checksum)\n");
        return;
    }
    s_flash_header_valid = true;
}

} // namespace

// ONE ring per call, driven off the poll task's own top-of-cycle tick. Bounded on purpose: a burst
// of 46 flash reads plus 46 splices under the history mutex would be a multi-millisecond stall on
// the task that owns the X10A UART, to recover a chart nobody is looking at yet. At one per second
// the whole set is back within a minute, and every splice is positioned by absolute bucket, so
// arriving late costs nothing at all.
void history_service_flash_restore() {
    if (s_flash_restore_done || !s_flash_part || s_flash_forgotten) return;
    flash_header_load();
    if (!s_flash_header_valid) { s_flash_restore_done = true; return; }
    // TWO conditions, and the second is the one that is easy to miss. A splice needs an absolute
    // anchor on BOTH sides: the stored record carries its own, but the live side's comes from the
    // newest COMMITTED sample, and nothing is committed until the first bucket closes. Starting
    // earlier would walk the whole cursor while every splice failed for want of a live anchor, and
    // the cursor only goes forward — the snapshot would be silently skipped for the whole boot.
    if (!time_synced()) return;
    if (esp_timer_get_time() < static_cast<int64_t>(logic::HISTORY_DT_S) * 1100000LL) return;

    size_t idx = 0;
    const HistorySource src = source_of_slot(s_flash_restore_slot, idx);
    const int64_t anchor = s_flash_header.anchor[static_cast<size_t>(src)];

    // WAIT for a source that has not closed its first bucket yet rather than spending the slot on
    // it. The uptime gate above only proves that SOME source has committed — the poll task runs
    // unconditionally, a HomeHub on a switch that powers up late does not. Since the cursor only
    // moves forward, spending the slot here would drop that source's twelve rings for the entire
    // boot even though a perfectly good record for them is sitting in flash. Bounded, so a source
    // that never returns cannot stall the rest of the set behind it; every splice is positioned
    // absolutely, so waiting costs nothing but the wait.
    if (anchor != INT64_MIN && source_last_commit_us(src) < 0) {
        if (esp_timer_get_time() < RESTORE_WAIT_LIMIT_US) return;
        diag_printf("history: stored %s rings dropped (source never reported this boot)\n",
                    source_slug(src));
    } else if (anchor != INT64_MIN) {
        HistorySample block[logic::HISTORY_COARSE_SAMPLES];
        if (esp_partition_read(s_flash_part, sizeof(FlashHeader) + s_flash_restore_slot * kCoarseBytes,
                               block, kCoarseBytes) == ESP_OK) {
            // Drop the write-side padding before splicing, or the restored window is 24 hours wide
            // regardless of how little is actually in it — see history_coarse_lead_skip.
            const size_t skip = logic::history_coarse_lead_skip(block, logic::HISTORY_COARSE_SAMPLES);
            if (skip < logic::HISTORY_COARSE_SAMPLES)
                history_splice_snapshot(src, idx, block + skip,
                                        logic::HISTORY_COARSE_SAMPLES - skip,
                                        logic::HISTORY_COARSE_STRIDE, anchor);
        }
    }
    if (++s_flash_restore_slot >= kTotalRings) {
        s_flash_restore_done = true;
        diag_printf("history: stored snapshot spliced back in\n");
    }
}

// Runs from esp_register_shutdown_handler, i.e. on whichever task called esp_restart() — the httpd
// task for a /set_* save, the OTA task for an install. Costs one 8 KB erase plus ~4.4 KB of writes,
// about 100 ms added to a reboot, and it is the only flash write this feature ever makes: once per
// intentional restart is a few hundred writes a year against a 100k-cycle part.
void history_flash_save() {
    if (!s_flash_part || s_flash_saved_this_boot || s_flash_forgotten) return;
    s_flash_saved_this_boot = true;
    // A BOUNDED take, unlike every other lock in this file. A shutdown handler that blocks forever
    // does not merely skip a snapshot, it stops the device rebooting at all — which for the OTA path
    // means a board that has already written its new image and will not start it.
    if (!s_mtx || xSemaphoreTake(s_mtx, pdMS_TO_TICKS(200)) != pdTRUE) {
        diag_printf("history: reboot snapshot skipped (history busy)\n");
        return;
    }

    FlashHeader h{};
    h.magic      = logic::HISTORY_PERSIST_MAGIC;
    h.version    = logic::HISTORY_PERSIST_VERSION;
    h.stride     = static_cast<uint16_t>(logic::HISTORY_COARSE_STRIDE);
    h.catalog_fp = P().catalog_fp;
    h.samples    = static_cast<uint16_t>(logic::HISTORY_COARSE_SAMPLES);
    h.rings[0]   = static_cast<uint16_t>(TREND_COUNT);
    h.rings[1]   = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    h.rings[2]   = static_cast<uint16_t>(ENV3_HISTORY_COUNT);
    h.anchor[0]  = source_anchor_bucket_locked(HistorySource::X10a);
    h.anchor[1]  = source_anchor_bucket_locked(HistorySource::Modbus);
    h.anchor[2]  = source_anchor_bucket_locked(HistorySource::Env3);

    // Nothing anchorable means nothing writable: without a synced clock at THIS moment there is no
    // absolute position for any of it, and a record that cannot be placed is worse than none.
    if (h.anchor[0] == INT64_MIN && h.anchor[1] == INT64_MIN && h.anchor[2] == INT64_MIN) {
        xSemaphoreGive(s_mtx);
        diag_printf("history: reboot snapshot skipped (no synced clock to anchor it)\n");
        return;
    }

    // Two passes over the rings rather than one 4.4 KB buffer: the buffer would be either a heap
    // allocation on the way to a reboot, or 4.4 KB of permanent .bss for something used once a boot.
    // Encoding twice is a few hundred microseconds and the rings cannot move — the lock is held.
    HistorySample block[logic::HISTORY_COARSE_SAMPLES];
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&h) + 16, sizeof(FlashHeader) - 16);
    for (size_t slot = 0; slot < kTotalRings; slot++) {
        coarse_block_locked(slot, block);
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(block), kCoarseBytes);
    }
    h.crc = config_crc32_final(crc);

    esp_err_t e = esp_partition_erase_range(s_flash_part, 0, s_flash_part->size);
    if (e == ESP_OK) e = esp_partition_write(s_flash_part, 0, &h, sizeof(FlashHeader));
    for (size_t slot = 0; slot < kTotalRings && e == ESP_OK; slot++) {
        coarse_block_locked(slot, block);
        e = esp_partition_write(s_flash_part, sizeof(FlashHeader) + slot * kCoarseBytes,
                                block, kCoarseBytes);
    }
    xSemaphoreGive(s_mtx);
    if (e != ESP_OK) diag_printf("history: reboot snapshot failed (%s)\n", esp_err_to_name(e));
}

// The factory reset deletes the user's configuration; the plant history it recorded is theirs too,
// so it goes with it. The flag is what stops the shutdown handler writing the whole thing back out
// milliseconds later on the reboot that same reset triggers.
void history_flash_forget() {
    s_flash_forgotten = true;
    if (!s_flash_part) return;
    const esp_err_t e = esp_partition_erase_range(s_flash_part, 0, s_flash_part->size);
    if (e != ESP_OK) diag_printf("history: snapshot erase failed (%s)\n", esp_err_to_name(e));
}

static void history_flash_start() {
    s_flash_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "hist");
    if (!s_flash_part) {
        // ABSENT, not broken. A device updated over the air keeps the partition table it was
        // flashed with — esp_https_ota writes the app slot alone — so this is the normal state for
        // every board that has not been re-flashed over USB since the table changed.
        diag_printf("history: no `hist` partition — reboot snapshot unavailable on this board\n");
        return;
    }
    const esp_err_t e = esp_register_shutdown_handler(history_flash_save);
    if (e != ESP_OK) diag_printf("history: shutdown handler not registered (%s)\n", esp_err_to_name(e));
}

} // namespace daik
