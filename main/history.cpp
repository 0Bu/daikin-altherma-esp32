// The 24-hour trend rings. Policy (which rows, when a sample counts, the bucket math, the held-run
// encoding) lives in logic/history.hpp and is host-tested; this file is the plumbing: static
// storage, one mutex, and the fold from the poll cycle's values into a bucket.
#include "history.hpp"
#include "checkup.hpp"                // fourth journal source: exact hourly diagnostic buckets
#include "config.hpp"
#include "diag_log.hpp"
#include "def/homehub.hpp"
#include "heap_guard.hpp"
#include "logic/binary_semantics.hpp"
#include "logic/env3.hpp"
#include "logic/history_persist.hpp"
#include "logic/homehub_map.hpp"
#include "logic/history.hpp"
#include "logic/state_dwell.hpp" // DWELL_REBOOT_BLIND_S — the project's one restart allowance
#include "mqtt_ha.hpp"
#include "safe_mode.hpp" // safe_mode_active — no producer runs there, so nothing adopts
#include "sntp_time.hpp"

#include "esp_attr.h"           // __NOINIT_ATTR — the whole of step 1 rests on this one attribute
// esp_heap_caps.h is deliberately absent: the largest-free-block sample now goes through
// heap_guard.hpp's ONE internal-DRAM sampler, so no site here spells out a capability mask.
#include "esp_partition.h"      // the persistent upper-flash `history` journal
#include "esp_system.h"         // esp_get_free_heap_size — the free_heap trend
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <type_traits>

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
    // label text), and a chart whose range readout and crosshair print "°C" over a bar series is
    // the legacy-35–legacy-39 shape: well-formed, plausible, wrongly labelled.
    char             unit[8] = {0};
};

// ── The persisted region ────────────────────────────────────────────────────────────────────────
// Every ring in the firmware, in ONE struct, so it can be sealed and re-adopted as a unit — and so
// nothing can be added to the trend set without landing inside the fingerprint that guards it.
//
// The samples are the SAME memory that is served to /history; there is no shadow copy. That is the
// entire reason step 1 costs nothing: a duplicate would be another ~30 KB of DRAM on a board whose
// measured low-water free heap is ~101 KB, which is a real price for a nice-to-have. What it costs
// instead is that the region can never be zero-initialised by the startup code, which is precisely
// the property being bought.
struct PersistedHistory {
    // Checked before a single sample is believed — see logic/history_persist.hpp for what each of
    // them rules out. `crc` covers the SEALED fields only (persist_crc below).
    uint32_t magic;
    uint16_t version;
    // Boots that adopted this region and have not committed a bucket since: incremented and
    // resealed at adoption, zeroed by every commit of any raster. Refused at one or more
    // (HistoryRestore::NotCommitted). Saturating; sealed, so a flipped bit is a bad_crc and not a
    // forgiven crash loop.
    uint8_t boots_since_commit;
    // Whether the ENV III producer existed in the boot that sealed this region (configured,
    // supported by the board, not in safe mode). A frozen ring is believed only when this and the
    // current boot both say so (logic::history_env3_ring_adoptable).
    uint8_t  env3_live;
    uint32_t catalog_fp;
    uint32_t crc;
    uint32_t x10a_target_fp;  // detected profile/link/fingerprint for the .noinit plant rings
    uint32_t mb_target_fp;  // host/port/unit identity for the .noinit HomeHub rings
    // Which circulation witness the circulation ring's samples were recorded under (HIST-01/b;
    // logic::history_circulation_identity, zero = none). Sealed with the rings it describes: a
    // surviving ring whose witness is no longer the configured one is retired at startup, and the
    // flash writer stamps this onto the records that carry the ring's column.
    uint32_t circulation_fp;
    // What the rounding of each raster's last adoption left unbooked (+) or over-booked (-), in
    // microseconds (logic::history_adopt_booking), carried into the next adoption of that raster
    // so the rounding errors of repeated restarts cancel instead of adding up. Index =
    // logic::HistoryJournalSource of the raster (X10A, HomeHub, ENV III). It lives HERE rather than
    // in the liveness record because it describes the rings of this region, is written once per
    // adoption under the one reseal the adoption does anyway, and is cleared with them by every
    // wipe and retirement; the liveness record is rewritten and re-hashed on every poll cycle and
    // must stay at the few instants it measures.
    int32_t residual_us[logic::HISTORY_LIVENESS_RASTERS];

    Trend ring[TREND_COUNT];
    // Eight paired HomeHub measurements plus BSH, 3-way-valve, Quiet, Smart-Grid and the standalone
    // disinfection state get a second ring. Unlike X10A trends,
    // their labels/units are fixed by def/homehub.hpp, so this side needs no per-ring string buffers.
    logic::TrendRing mb_ring[HOMEHUB_HISTORY_COUNT];
    logic::TrendRing env3_ring[ENV3_HISTORY_COUNT];
};
static_assert(HOMEHUB_HISTORY_COUNT * logic::HISTORY_BYTES_PER_TREND == 7488,
              "thirteen HomeHub histories should cost exactly 7488 bytes");
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
// The flash image also avoids carrying a same-size initialiser for rings that startup would
// replace.
union PersistStore {
    PersistedHistory v;
    PersistStore() {}      // deliberately leaves v untouched
    ~PersistStore() {}
};
__NOINIT_ATTR PersistStore s_store;

// One name for the region, so no call site has to know about the union.
inline PersistedHistory& P() { return s_store.v; }

// The liveness record (logic/history_persist.hpp): when the device last gave a sign of life and
// when each raster last committed, on this boot's clock. Its own seal and its own variable, so the
// poll task can refresh it every cycle without touching the ~30 KB seal above. Plain data, so the
// definition emits no initialiser image into a NOLOAD section; startup writes it explicitly, after
// judging the previous boot's. Every writer holds s_mtx except startup, which is single-threaded.
static_assert(std::is_trivially_default_constructible<logic::HistoryLiveness>::value,
              "an initialiser on the liveness record would be dropped from .noinit silently");
__NOINIT_ATTR logic::HistoryLiveness s_liveness;

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
// wall-clock instant is then unknowable, but its age never is. A flash seed claims the monotonic
// raster boundary of the open bucket (logic::history_raster_boundary_us), so the restored samples
// sit on the same grid as every later commit. INT64_MIN means "none".
constexpr int64_t kNoCommitUs = INT64_MIN;
static_assert(kNoCommitUs == logic::HISTORY_NO_COMMIT_US,
              "the commit sentinel is one definition shared with logic::history_snapshot_meta");
int64_t           s_last_commit_us = kNoCommitUs;
int64_t           s_mb_last_commit_us = kNoCommitUs;
int64_t           s_env3_last_commit_us = kNoCommitUs;
int64_t           s_last_commit_bucket = -1;
int64_t           s_mb_last_commit_bucket = -1;
int64_t           s_env3_last_commit_bucket = -1;
// ENV III has no identity and no producer while it is disabled, so its ring needs two facts of its
// own (HIST-03/e). `s_env3_enabled`: the sensor's task exists this boot — fixed at startup, from
// the configuration and the board, never in safe mode. `s_env3_fed`: that task has recorded into
// the ring at least once this boot. The journal writes ENV III records only for a ring that is
// both, so a frozen ring is never filed under the buckets it happens to be adopted into.
bool s_env3_enabled = false;
bool s_env3_fed     = false;
// The journal must not file an adopted sample twice (logic::history_adopt_floor_bucket), per
// source (index = logic::HistoryJournalSource of the trend sources). `s_adopt_real_end_us` is the
// monotonic instant at which the newest REAL sample adopted at startup ended, set once by
// history_start() and spent by the journal writer's first look after it; `s_adopt_floor_bucket`
// is the wall bucket that look decided the writer may not append at or before. INT64_MIN: none.
// Owned by s_mtx, like the rings they describe, and cleared wherever a source's journal cursor is
// reset (forget_adopt_floor).
int64_t s_adopt_real_end_us[logic::HISTORY_LIVENESS_RASTERS]  = {INT64_MIN, INT64_MIN, INT64_MIN};
int64_t s_adopt_floor_bucket[logic::HISTORY_LIVENESS_RASTERS] = {INT64_MIN, INT64_MIN, INT64_MIN};

inline void forget_adopt_floor(size_t src) {
    if (src >= logic::HISTORY_LIVENESS_RASTERS) return;
    s_adopt_real_end_us[src]  = INT64_MIN;
    s_adopt_floor_bucket[src] = INT64_MIN;
}
std::atomic<bool> s_reset_requested{false};
std::atomic<uint32_t> s_x10a_target_fp{0};
std::atomic<bool> s_mb_reset_requested{false};
std::atomic<uint32_t> s_mb_identity_generation{1};
std::atomic<uint32_t> s_mb_target_fp{0};
std::atomic<bool> s_circulation_reset_requested{false};
// The CURRENT circulation witness identity (logic::history_circulation_identity; zero = no witness
// configured or consented). history_circulation_reset() publishes the new one together with its
// deferred reset, under s_mtx; P().circulation_fp is the identity of what the ring HOLDS and only
// catches up when that reset is consumed. The flash restore compares records against this one.
std::atomic<uint32_t> s_circulation_fp{0};
// Browser cache lifetime, separate from every producer's source-generation admission token. It
// changes only when a history lifetime is retired, so A -> B -> A between status polls is visible
// even though the final configuration has the same bytes as before.
std::atomic<uint32_t> s_history_epoch{1};
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "history browser epoch must remain allocation- and lock-free");
SemaphoreHandle_t s_mtx = nullptr;

inline void bump_history_epoch() noexcept {
    uint32_t previous = s_history_epoch.load(std::memory_order_relaxed);
    uint32_t next;
    do {
        next = previous + 1;
        if (next == 0) next = 1; // zero is never a valid browser lifetime
    } while (!s_history_epoch.compare_exchange_weak(previous, next, std::memory_order_release,
                                                    std::memory_order_relaxed));
}

// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
// Everything inside a critical section in this file is a plain integer copy — nothing allocates —
// so the unwind safety is belt-and-braces here rather than the reason the guard is used.
using Lock = SemGuard;

// The value parse lives in logic/history.hpp (history_parse_tenths) so nonnumeric legacy/corrupt
// values and sentinel collisions are refused in host-tested code rather than on-device surprises.
inline bool value_tenths(const std::string& s, int& out) {
    return logic::history_parse_tenths(s.c_str(), out);
}

// Copy a fixed string into one of the Trend's own buffers, always NUL-terminated. Returns whether
// the bytes actually MOVED, which is what keeps the persistence seal cheap: the fold loop rewrites
// every label once a second with the identical text, and re-sealing ~30 KB for that would cost a
// CRC per second forever to record nothing.
inline bool copy_field(char* dst, size_t max, const char* src) {
    if (std::strncmp(dst, src, max - 1) == 0) return false;
    std::strncpy(dst, src, max - 1);
    dst[max - 1] = '\0';
    return true;
}

// ── Sealing the region, and adopting it again ───────────────────────────────────────────────────
bool                  s_persist_dirty = false;
logic::HistoryRestore s_persist_verdict = logic::HistoryRestore::NoRecord;

// Armed only when this boot ADOPTED its rings, spent by the first detection — see
// history_reset_on_detect() for why detection alone is not evidence that the unit changed.
bool s_adopt_detect_grace = false;
bool s_detect_seen = false;

// WHAT THE SEAL COVERS — and the one field it deliberately does not.
//
// `pending`, the bucket currently being folded, is EXCLUDED. Including it is the obvious choice and
// would defeat the whole feature: pending changes on every fold, i.e. once a second, so the CRC
// would be stale for all but a few microseconds out of every five minutes — and a crash, the case
// this exists for most, would land in the stale window essentially always, discarding a day of
// perfectly intact readings. Excluding pending keeps ordinary folds from changing sealed bytes.
// Commits, adoption, resets and source bookkeeping also reseal the region; a valid seal establishes
// integrity, not sample age. The previous boot's open bucket is dropped on restore: a partial
// five minutes was never a completed sample.
inline uint32_t persist_crc_ring(uint32_t crc, const logic::TrendRing& r) {
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(r.buf), sizeof(r.buf));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&r.count), sizeof(r.count));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&r.head), sizeof(r.head));
    return crc;
}

inline uint32_t persist_crc() {
    uint32_t crc = CONFIG_CRC32_INIT;
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().x10a_target_fp),
                              sizeof(P().x10a_target_fp));
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().mb_target_fp),
                              sizeof(P().mb_target_fp));
    // Which circulation witness the sealed ring belongs to (HIST-01/b).
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(&P().circulation_fp),
                              sizeof(P().circulation_fp));
    // The two guards about AGE (HIST-03): a counter that a flipped bit must not be able to clear,
    // and whether the ENV III ring was ever fed. Both change at a commit or at startup, never per
    // fold, so covering them costs no extra seal.
    crc = config_crc32_update(crc, &P().boots_since_commit, sizeof(P().boots_since_commit));
    crc = config_crc32_update(crc, &P().env3_live, sizeof(P().env3_live));
    // The booking residuals, which describe the rings below and change only at an adoption.
    crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(P().residual_us),
                              sizeof(P().residual_us));
    for (const auto& t : P().ring) {
        crc = persist_crc_ring(crc, t.ring);
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(t.label), sizeof(t.label));
        crc = config_crc32_update(crc, reinterpret_cast<const uint8_t*>(t.unit), sizeof(t.unit));
    }
    for (const auto& r : P().mb_ring)   crc = persist_crc_ring(crc, r);
    for (const auto& r : P().env3_ring) crc = persist_crc_ring(crc, r);
    return config_crc32_final(crc);
}

// Called at the end of every record cycle, but only pays the ~30 KB CRC when a commit, a reset or a
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

inline bool x10a_rings_have_samples() {
    for (const auto& t : P().ring)
        if (t.ring.count) return true;
    return false;
}

// Start this boot with nothing. REQUIRED rather than defensive: the region is uninitialised storage,
// so without this every count, head and label would be whatever the last firmware left in DRAM.
inline void persist_wipe(uint32_t catalog_fp, uint32_t x10a_target_fp, uint32_t mb_target_fp,
                         uint32_t circulation_fp, bool env3_live) {
    std::memset(&P(), 0, sizeof(PersistedHistory));
    // memset alone is NOT enough and the difference is a wrong reading rather than a crash: zero is
    // a perfectly valid sample, while `pending` must start at the NO_READING sentinel or every ring
    // would commit a confident 0.0 for its first bucket.
    for (auto& t : P().ring)        t.ring.reset();
    for (auto& r : P().mb_ring)     r.reset();
    for (auto& r : P().env3_ring)   r.reset();
    P().magic      = logic::HISTORY_PERSIST_MAGIC;
    P().version    = logic::HISTORY_PERSIST_VERSION;
    P().boots_since_commit = 0; // nothing adopted: nothing is pending commit
    // Nothing is left for a booking remainder to describe (the memset above zeroed it; stated so
    // that a refusal, which reaches this wipe, visibly starts the diffusion over).
    for (auto& r : P().residual_us) r = 0;
    P().env3_live      = env3_live ? 1 : 0;
    P().catalog_fp = catalog_fp;
    P().x10a_target_fp = x10a_target_fp;
    P().mb_target_fp = mb_target_fp;
    P().circulation_fp = circulation_fp;
    s_persist_dirty = true;
    persist_seal_locked();
}

uint32_t current_mb_target_fp() {
    const Config& c = config();
    return logic::history_homehub_target_fingerprint(
        config_modbus_host(c).c_str(), static_cast<uint32_t>(c.mb_port),
        static_cast<uint32_t>(c.mb_unit_id));
}

// Book the stretch of time between the previous boot's last commit and this boot's first bucket as
// explicit no-reading samples (logic::history_adopt_booking says how many), on every ring of the
// raster that holds samples. Without it the adopted newest sample is simply claimed to have ended
// at boot and that stretch collapses to nothing: every restart slides the older part of the curve
// later by the time it did not measure, and the slides of repeated restarts add up in one
// direction. A ring without samples has no seam and stays empty. Boot time only, single-threaded,
// and before the region is sealed.
inline void persist_book_unobserved(const uint32_t (&gaps)[logic::HISTORY_LIVENESS_RASTERS]) {
    for (auto& t : P().ring) t.ring.append_gaps(gaps[0]);
    for (auto& r : P().mb_ring) r.append_gaps(gaps[1]);
    for (auto& r : P().env3_ring) r.append_gaps(gaps[2]);
}

// Re-anchor the surviving rings onto THIS boot's monotonic clock. No wall clock is consulted and
// none is needed: the bytes only survive a reset that kept power, so the downtime is a reset of
// about a second (booked as the allowance, with the rest of the stretch, by the caller). The newest
// sample, after the gaps persist_book_unobserved appended, is claimed to have been committed at
// the monotonic raster boundary of this boot (`claim_us`, logic::history_raster_boundary_us), the
// grid every later commit lands on, so the first live commit comes one raster step later and its
// wall bucket follows the claim's. The claim is only as good as what the caller could measure,
// which is why it adopts nothing the guards of logic::history_restore_verdict refused (safe mode,
// a boot that adopted and never committed, an X10A raster the liveness record cannot measure).
// Behind them each seam's rounding error is carried to the next one (the sealed residual) and the
// rest is the downtime and sign-of-life uncertainty (logic/history_persist.hpp, "Booking the
// stretch an adoption cannot see"); the flash journal keeps absolute wall positions and does not
// accumulate it.
//
// Per SOURCE, because they are independent: a board whose HomeHub was switched off since the last
// boot must fall back to the normal first-bucket seeding for that source rather than claim a commit
// that never happened. The liveness record gets the same instant, so the next boot judges this
// one's claim against what this boot actually committed.
inline void persist_adopt(int64_t claim_us) {
    const uint32_t bucket = logic::history_bucket(claim_us);
    const int64_t  prev   = static_cast<int64_t>(bucket) - 1;

    bool x10a = false;
    for (auto& t : P().ring) { t.ring.pending = HISTORY_NO_READING; if (t.ring.count) x10a = true; }
    for (auto& r : P().mb_ring)   r.pending = HISTORY_NO_READING;
    for (auto& r : P().env3_ring) r.pending = HISTORY_NO_READING;

    if (x10a) {
        s_have_bucket = true; s_bucket = bucket;
        s_last_commit_us               = claim_us;
        s_last_commit_bucket           = prev;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::X10a, claim_us);
    }
    if (rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT)) {
        s_mb_have_bucket = true; s_mb_bucket = bucket;
        s_mb_last_commit_us                  = claim_us;
        s_mb_last_commit_bucket              = prev;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Modbus, claim_us);
    }
    if (rings_have_samples(P().env3_ring, ENV3_HISTORY_COUNT)) {
        s_env3_have_bucket = true; s_env3_bucket = bucket;
        s_env3_last_commit_us                    = claim_us;
        s_env3_last_commit_bucket                = prev;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Env3, claim_us);
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
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::X10a,
                                           s_last_commit_us);
        }
    } else if (bucket > s_bucket) {
        // `>`, not `!=`. Both callers read the clock and compute the bucket BEFORE taking s_mtx, so
        // if the other task crosses a five-minute boundary inside that window the loser arrives
        // with a bucket BEHIND the raster. history_skipped() correctly answers 0 there, but
        // commit(0) still ran: every ring took a spurious NO_READING sample and s_bucket moved
        // BACKWARDS, skewing the whole time axis by one slot and making the newest-age meta read
        // from an older instant. Only reachable since legacy-367 gave the raster a second,
        // independent advancer.
        const uint32_t skipped = logic::history_skipped(s_bucket, bucket);
        for (auto& tr : P().ring) tr.ring.commit(skipped);
        s_persist_dirty = true;
        s_last_commit_us = now_us;
        s_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        // A real commit: this boot has now advanced the data it adopted, so the next boot may
        // adopt it again (HIST-03/a), and the liveness record has a fresh commit to measure from.
        P().boots_since_commit = 0;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::X10a, now_us);
    }
    // MONOTONIC for the same reason the branch above is: the loser of the read-clock-then-lock race
    // must not drag the raster back a slot, which would make the NEXT advance commit a skip that
    // never happened.
    if (!s_have_bucket || bucket > s_bucket) s_bucket = bucket;
    s_have_bucket = true;
}

// The board's own memory, read BEFORE any lock: heap_caps_get_largest_free_block takes the heap's
// internal lock, and taking that under ours would invent a lock order this file has no reason to
// have (AGENTS.md → Memory, concurrency, and HTTP safety; the same argument applies to a second,
// unrelated lock). Both are plain reads of a counter — nothing allocates.
struct BoardSample {
    HistorySample free_heap = HISTORY_NO_READING;
    HistorySample max_alloc = HISTORY_NO_READING;
};

inline BoardSample sample_board() {
    BoardSample b;
    b.free_heap = logic::history_bytes_tenths_kib(esp_get_free_heap_size());
    b.max_alloc = logic::history_bytes_tenths_kib(
        heap_largest_internal_block());
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
    // The ring now holds gaps under the witness the reset was requested for, and from here on the
    // flash records that carry its column say so (HIST-01/b).
    P().circulation_fp = s_circulation_fp.load();
    s_persist_dirty    = true;
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
// separate rasters, the same reason /values keeps two arrays — but the persistence machinery has to
// be able to name one ring across all of them. The VALUES are part of the flash record layout, so
// they are pinned rather than incidental. File-local: no caller outside this translation unit
// addresses a ring this way.
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

// Which HomeHub ring is an EVENT timeline rather than a sampled state.
bool homehub_event_ring(size_t idx) {
    return idx < HOMEHUB_HISTORY_COUNT && logic::HOMEHUB_HISTORIES[idx].event;
}

// The ABSOLUTE (wall-clock) bucket of a source's newest committed sample, or INT64_MIN when there is
// none or the clock has never synced. This is the anchor everything that outlives the boot hangs on:
// the ring's own bucket index is monotonic-since-boot and means nothing to the next boot, so a
// snapshot without this is a curve with no position on the axis — and there is no honest default,
// which is why the whole path is skipped rather than guessed at.
int64_t wall_bucket_of_instant_locked(int64_t instant_us) {
    if (!time_synced() || instant_us == kNoCommitUs) return INT64_MIN;
    int64_t unix_s = -1; int32_t ms = 0;
    time_now(unix_s, ms);
    if (unix_s < 0) return INT64_MIN;
    return logic::history_anchor_bucket(unix_s, esp_timer_get_time(), instant_us,
                                        logic::HISTORY_DT_S, ms);
}

int64_t source_anchor_bucket_locked(HistorySource src) {
    return wall_bucket_of_instant_locked(source_last_commit_us(src));
}

// ── The history flash journal ───────────────────────────────────────────────────────────────────
// One dense trend vector per completed five-minute bucket, one exact diagnostic payload per
// completed hour, or one rare catalog manifest, appended into 256-byte slots. A manifest binds the
// vector indices to stable semantic ids without repeating them in every bucket. Sixteen slots share
// a 4 KiB erase sector and the whole 4 MiB partition is traversed before any sector is reused. The
// commit word is programmed last, so a power cut can invalidate only the record being written; the
// preceding slot remains the head.
struct FlashJournalRecord {
    logic::HistoryJournalHeader header;
    // Raw because ordinary trend records carry dense int16 samples, source four carries one
    // CheckupJournalPayload, and the manifest flag changes the payload to uint32 ids. For ordinary
    // and checkup records value_count remains a count of 16-bit words, so old v1 trend records stay
    // byte-for-byte readable.
    alignas(8) uint8_t payload[logic::HISTORY_JOURNAL_SLOT_BYTES -
                               logic::HISTORY_JOURNAL_HEADER_BYTES];
};
static_assert(sizeof(FlashJournalRecord) == logic::HISTORY_JOURNAL_SLOT_BYTES,
              "one journal record is exactly one physical slot");
static_assert(logic::CHECKUP_JOURNAL_PAYLOAD_BYTES <= sizeof(FlashJournalRecord::payload),
              "one diagnostic hour must fit the shared journal slot");

const esp_partition_t* s_flash_part = nullptr;
SemaphoreHandle_t s_flash_mtx = nullptr;       // serialises poll service, shutdown and factory erase
bool s_flash_shutdown_started = false;         // the shutdown handler must not flush twice
std::atomic<bool> s_flash_forgotten{false};     // factory reset crosses button/poll/shutdown tasks
bool s_flash_restore_done = false;
bool s_flash_checkup_restore_done = false;
bool s_flash_scan_ok = false;

constexpr size_t kTotalRings = logic::HISTORY_FLASH_TOTAL_RINGS;
constexpr size_t kJournalSources = logic::HISTORY_JOURNAL_SOURCE_COUNT;
constexpr size_t kRestoreRingsPerTick = 4;

size_t   s_flash_next_slot = 0;
uint64_t s_flash_next_sequence = 1;
int64_t  s_flash_last_bucket[kJournalSources] = {INT64_MIN, INT64_MIN, INT64_MIN, INT64_MIN};
int64_t  s_flash_newest_bucket[kJournalSources] = {INT64_MIN, INT64_MIN, INT64_MIN, INT64_MIN};
int64_t  s_flash_oldest_bucket[kJournalSources] = {INT64_MIN, INT64_MIN, INT64_MIN, INT64_MIN};
uint16_t s_flash_restore_slots[kJournalSources][HISTORY_SAMPLES] = {};
uint16_t s_flash_restore_slot_count[kJournalSources] = {};
size_t   s_flash_restore_ring = 0;
size_t   s_flash_restored_rings = 0;
size_t   s_flash_service_source = 0;

struct FlashManifestCache {
    bool     valid;
    uint8_t  source;
    uint16_t count;
    uint16_t rings[3];
    uint32_t catalog_fp;
    uint32_t schema_fp;
    uint64_t sequence;
    int64_t  bucket;
    int8_t   stored_index[logic::HISTORY_MANIFEST_MAX_IDS];
};
static_assert(sizeof(FlashManifestCache) <= 96,
              "four manifest generations per source must stay below 1.2 KiB total");
FlashManifestCache s_flash_manifests[3][logic::HISTORY_MANIFEST_CACHE_PER_SOURCE];
// The manifest the journal appended LAST for this build's catalog, per source — by sequence, not by
// bucket (see logic::HistoryManifestCurrent).
logic::HistoryManifestCurrent s_flash_manifest_current[3];

// An append that keeps failing at one slot. Cleared by the next success; all of it is owned by
// s_flash_mtx.
size_t   s_flash_fail_slot    = SIZE_MAX; // the slot of the latest failure (SIZE_MAX: none)
uint8_t  s_flash_fail_count   = 0;        // consecutive failures at that slot
bool     s_flash_fail_episode = false;    // a failure was logged and no append has succeeded since
uint16_t s_flash_fail_total   = 0;        // failures in this episode (saturating)
uint16_t s_flash_fail_skipped = 0;        // sectors abandoned in this episode (saturating)
bool     s_flash_fail_paused  = false;    // the episode spent its abandon budget: slow retries only
int64_t  s_flash_fail_last_us = INT64_MIN; // esp_timer time of the latest failed attempt

// A source whose append cursor lies beyond its clock is REPORTED, never rewritten (see "A bucket
// from the future" in logic/history_persist.hpp). The writer's line is logged once per source and
// episode: the latch is set by the report and cleared ONLY by that source's next successful data
// append — not by a "cursor is no longer ahead" observation, because the anchor jitters by one
// bucket and the line must not flap with it. The restore's line is once per source and boot (the
// checkup restore is retried every tick until it settles, so it needs the latch as much as the
// trend sources do). All of it is owned by s_flash_mtx.
bool s_flash_ahead_logged[kJournalSources]         = {};
bool s_flash_restore_ahead_logged[kJournalSources] = {};

// Static scratch avoids adding a 4 KiB scan buffer or four 576-byte restore blocks to the poll
// task's measured 8 KiB stack. All access is serialised on the poll task or s_flash_mtx.
alignas(8) uint8_t s_flash_sector[logic::HISTORY_FLASH_ERASE_BYTES];
HistorySample s_flash_restore_blocks[kRestoreRingsPerTick][HISTORY_SAMPLES];
static HistorySample s_splice_live[HISTORY_SAMPLES];
static HistorySample s_splice_out[HISTORY_SAMPLES];

HistorySource source_of_slot(size_t slot, size_t& idx) {
    if (slot < TREND_COUNT) { idx = slot; return HistorySource::X10a; }
    if (slot < TREND_COUNT + HOMEHUB_HISTORY_COUNT) {
        idx = slot - TREND_COUNT; return HistorySource::Modbus;
    }
    idx = slot - TREND_COUNT - HOMEHUB_HISTORY_COUNT;
    return HistorySource::Env3;
}

} // namespace

// Declared here rather than in the header: only history_start() calls them, and only once.
static void history_flash_start();
static size_t history_flash_service_journal(size_t max_records, TickType_t wait_ticks);

void history_start() {
    if (s_mtx) return;                              // app_main is the sole caller; defensive idempotence
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("history: mutex alloc failed — trends disabled this boot\n");

    // BEFORE any producer task exists, so nothing can fold into a ring that is about to be wiped or
    // adopted. app_main calls this ahead of hp_poll_start()/mqtt_start(), which is what makes the
    // whole decision single-threaded and lock-free.
    const uint32_t want_fp = logic::history_catalog_fingerprint();
    const Config& boot_config = config();
    s_x10a_target_fp.store(boot_config.x10a_identity_fp);
    const uint32_t want_mb_target_fp = current_mb_target_fp();
    s_mb_target_fp.store(want_mb_target_fp);
    const uint32_t want_circulation_fp = logic::history_circulation_identity(boot_config);
    s_circulation_fp.store(want_circulation_fp);
    const uint32_t reason  = static_cast<uint32_t>(esp_reset_reason());
    const bool     safe    = safe_mode_active();
    // ENV III has a producer only when env3_start() will create its task: configured, supported by
    // the board and not in safe mode (which starts no optional source at all).
    s_env3_enabled       = !safe && boot_config.env3_enabled && env3_board_supported(boot_config);
    const bool env3_keep = logic::history_env3_ring_adoptable(P().env3_live != 0, s_env3_enabled);
    // The HomeHub rings are adopted only for the target they were recorded under; any other target
    // retires them below (and a HomeHub disabled at runtime keeps its ring but stops its raster, so
    // the target the ring was sealed under is no longer the configured one).
    const bool mb_keep = P().mb_target_fp == want_mb_target_fp;
    // What the previous boot's liveness record has to MEASURE: the rasters whose samples THIS boot
    // would adopt, which is the same decision the retire steps below make (env3_keep, mb_keep). A
    // ring those steps drop anyway has nothing to book, and weighing it would let a source that is
    // gone refuse the trends that are not. The X10A raster alone decides the region; an
    // unmeasurable HomeHub or ENV III raster retires only its own rings
    // (logic::history_raster_plan). A raster that merely stalled is measurable and is booked.
    const bool weighed[logic::HISTORY_LIVENESS_RASTERS] = {
        x10a_rings_have_samples(),
        mb_keep && rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT),
        env3_keep && rings_have_samples(P().env3_ring, ENV3_HISTORY_COUNT)};
    const logic::HistoryRasterPlan plan = logic::history_raster_plan(s_liveness, weighed);
    s_persist_verdict                   = logic::history_restore_verdict(
        reason, P().magic, P().version, P().catalog_fp, want_fp, P().crc, persist_crc(), safe,
        P().boots_since_commit, plan.region_bookable);
    // The numbers behind a refusal or a retirement, while the previous boot's record is still
    // unread: that the record itself did not verify, or that it holds no usable commit for the
    // raster, is the whole diagnosis (a raster that merely stalled is booked, not refused).
    const auto log_unmeasured = [](const char* what, logic::HistoryRasterState state) {
        diag_printf("history: %s liveness %s (sign-of-life %lld us; last commit x10a %lld, modbus "
                    "%lld, env3 %lld us)\n",
                    what,
                    state == logic::HistoryRasterState::NoRecord ? "record unreadable"
                                                                 : "records no usable commit",
                    static_cast<long long>(s_liveness.sign_us),
                    static_cast<long long>(s_liveness.commit_us[0]),
                    static_cast<long long>(s_liveness.commit_us[1]),
                    static_cast<long long>(s_liveness.commit_us[2]));
    };
    if (s_persist_verdict == logic::HistoryRestore::StaleCommit)
        log_unmeasured("X10A", plan.state[static_cast<size_t>(logic::HistoryJournalSource::X10a)]);
    const int64_t start_us = esp_timer_get_time();
    if (s_persist_verdict == logic::HistoryRestore::Accept) {
        if (P().x10a_target_fp != boot_config.x10a_identity_fp) {
            for (size_t t = 0; t < TREND_COUNT; ++t) {
                if (independent_trend(logic::TRENDS[t])) continue;
                P().ring[t].ring.reset();
                P().ring[t].label[0] = '\0';
                P().ring[t].unit[0] = '\0';
            }
            P().x10a_target_fp = boot_config.x10a_identity_fp;
            // The rings the remainder described are gone; the board and circulation rings that
            // stay start their diffusion over.
            P().residual_us[static_cast<size_t>(logic::HistoryJournalSource::X10a)] = 0;
            s_persist_dirty = true;
            persist_seal_locked();
            diag_printf("history: X10A RAM rings rejected (detected identity changed)\n");
        }
        if (P().mb_target_fp != want_mb_target_fp) {
            // Config can be committed just before a software reset, before the Modbus task consumes
            // its deferred reset. Preserve independent sources but never adopt the prior HomeHub as
            // the new target merely because DRAM survived.
            for (auto& r : P().mb_ring) r.reset();
            P().mb_target_fp = want_mb_target_fp;
            s_persist_dirty = true;
            persist_seal_locked();
            diag_printf("history: HomeHub RAM rings rejected (configured target changed)\n");
        }
        if (P().circulation_fp != want_circulation_fp) {
            // The witness was remapped, or diagnostics were switched, between the previous boot's
            // last seal and this one. The surviving samples belong to the retired source, so only
            // the circulation ring is dropped; the X10A and board rings beside it are unaffected.
            for (size_t t = 0; t < TREND_COUNT; ++t) {
                if (!circulation_trend(logic::TRENDS[t])) continue;
                P().ring[t].ring.reset();
                P().ring[t].label[0] = '\0';
                P().ring[t].unit[0]  = '\0';
            }
            P().circulation_fp = want_circulation_fp;
            s_persist_dirty    = true;
            persist_seal_locked();
            diag_printf("history: circulation RAM ring rejected (witness identity changed)\n");
        }
        if (!env3_keep && rings_have_samples(P().env3_ring, ENV3_HISTORY_COUNT)) {
            // A ring nothing has fed since it was sealed, or that nothing will feed now: adopting
            // it would treat it as fed until the reset and let the journal file the frozen
            // readings under today's buckets (HIST-03/e).
            for (auto& r : P().env3_ring) r.reset();
            s_persist_dirty = true;
            diag_printf("history: ENV III RAM ring rejected (sensor %s)\n",
                        s_env3_enabled ? "was not running when it was sealed"
                                       : "is not running this boot");
        }
        // A raster the record cannot measure retires its own rings alone. The verdict above
        // already accepted the region on the X10A raster's word, so a HomeHub whose record entry
        // is unusable costs the trends nothing but its own.
        if (plan.retire_modbus) {
            for (auto& r : P().mb_ring) r.reset();
            s_persist_dirty = true;
            log_unmeasured("HomeHub RAM rings retired:",
                           plan.state[static_cast<size_t>(logic::HistoryJournalSource::Modbus)]);
        }
        if (plan.retire_env3) {
            for (auto& r : P().env3_ring) r.reset();
            s_persist_dirty = true;
            log_unmeasured("ENV III RAM ring retired:",
                           plan.state[static_cast<size_t>(logic::HistoryJournalSource::Env3)]);
        }
        // The stretch between each adopted raster's last commit and this boot's first bucket,
        // measured from the PREVIOUS boot's record (the fresh one below overwrites it), is booked
        // as explicit no-reading samples, a stall of the raster included; the newest of them is
        // claimed for the raster boundary that opened this boot's first bucket. The rounding
        // remainder of the previous adoption is carried in and the new one carried out, so the
        // rounding errors of repeated restarts cancel. Only a raster whose rings hold samples AFTER
        // the retire steps above has a seam: for every other one the count and the remainder are
        // zero, which is also what the boot line reports (a retired ring was booked nothing).
        const int64_t claim_us = logic::history_raster_boundary_us(start_us);
        const bool    has[logic::HISTORY_LIVENESS_RASTERS] = {
            x10a_rings_have_samples(), rings_have_samples(P().mb_ring, HOMEHUB_HISTORY_COUNT),
            rings_have_samples(P().env3_ring, ENV3_HISTORY_COUNT)};
        uint32_t gaps[logic::HISTORY_LIVENESS_RASTERS];
        for (size_t i = 0; i < logic::HISTORY_LIVENESS_RASTERS; ++i) {
            logic::HistoryAdoptBooking booking{0, 0};
            if (has[i])
                booking = logic::history_adopt_booking(s_liveness.sign_us, s_liveness.commit_us[i],
                                                       logic::DWELL_REBOOT_BLIND_S, claim_us,
                                                       P().residual_us[i]);
            gaps[i]            = booking.gaps;
            P().residual_us[i] = booking.residual_us;
            s_adopt_real_end_us[i] =
                has[i] ? logic::history_adopt_real_end_us(claim_us, booking.gaps) : INT64_MIN;
        }
        persist_book_unobserved(gaps);
        // Adopted: from here until a bucket commits, the next boot must not adopt it blindly.
        P().env3_live          = s_env3_enabled ? 1 : 0;
        P().boots_since_commit = logic::history_counter_next(P().boots_since_commit);
        s_persist_dirty        = true;
        persist_seal_locked();
        logic::history_liveness_begin(s_liveness, start_us);
        persist_adopt(claim_us);
        // The rings carry the previous identity in their labels, so this boot's first detection can
        // defer to the per-row check rather than wiping on sight — history_reset_on_detect().
        s_adopt_detect_grace = true;
        diag_printf(
            "history: rings kept across a %s reset (RAM survived; unobserved buckets booked "
            "x10a %u, modbus %u, env3 %u)\n",
            crash_reason_slug(reason), static_cast<unsigned>(gaps[0]),
            static_cast<unsigned>(gaps[1]), static_cast<unsigned>(gaps[2]));
    } else {
        persist_wipe(want_fp, boot_config.x10a_identity_fp, want_mb_target_fp, want_circulation_fp,
                     s_env3_enabled);
        logic::history_liveness_begin(s_liveness, start_us);
        // Not noise: "wrong_catalog" after an update explains a chart that emptied itself for a
        // reason nobody would otherwise be able to reconstruct, and "bad_crc" on a board that was
        // never power-cycled is a memory fault worth seeing.
        diag_printf("history: rings start empty (%s)\n", logic::history_restore_slug(s_persist_verdict));
    }
    history_flash_start();
    // Registered whether or not a journal exists: the sign of life it records is independent of it
    // (history_flash_save drains only a journal that was found and scanned).
    const esp_err_t shutdown_err = esp_register_shutdown_handler(history_flash_save);
    if (shutdown_err != ESP_OK)
        diag_printf("history: shutdown handler not registered (%s)\n",
                    esp_err_to_name(shutdown_err));
}

bool history_checkup_flash_pending() {
    return s_flash_part && s_flash_scan_ok && !s_flash_checkup_restore_done;
}

const char* history_persist_state() { return logic::history_restore_slug(s_persist_verdict); }

// The poll task's sign of life, every cycle — including the cycles that skip all work (a network
// hold-off) and the ones spent detecting. Cheap by construction: a try-lock, a store and a CRC over
// the 32 bytes of instants in the liveness record, never the ~30 KB seal, and nothing allocates. A
// contended lock skips the write; a later successful touch refreshes it. Until then the record can
// lag behind actual uptime. The next boot books only the measured record stretch plus its fixed
// allowance; an unmeasured tail until reset can be under-booked. noexcept because this sits on the
// poll task's per-cycle path and an unwind through a C task frame terminates the process.
void history_liveness_touch() noexcept {
    if (!s_mtx) return;
    Lock lk(s_mtx, 0);
    if (!lk.acquired()) return;
    logic::history_liveness_touch(s_liveness, esp_timer_get_time());
}

uint32_t history_epoch() noexcept { return s_history_epoch.load(std::memory_order_acquire); }

uint32_t history_x10a_identity(const char* profile, int32_t rx_pin, int32_t tx_pin, char proto) {
    return logic::history_x10a_target_fingerprint(profile, rx_pin, tx_pin, proto);
}

void history_reset() {
    if (!s_mtx) return;
    // Same lock order as the journal service. Waiting for an in-flight fold before arming the reset
    // prevents that old cycle from consuming the new flag and then becoming the first sample of the
    // replacement identity.
    Lock flash_lk(s_flash_mtx);
    if (s_flash_mtx && !flash_lk.acquired()) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    s_x10a_target_fp.store(0);
    s_reset_requested.store(true);
    if (s_flash_mtx) {
        const size_t src = static_cast<size_t>(logic::HistoryJournalSource::X10a);
        s_flash_last_bucket[src] = INT64_MIN;
        s_flash_newest_bucket[src] = INT64_MIN;
        s_flash_oldest_bucket[src] = INT64_MIN;
        s_flash_restore_slot_count[src] = 0;
        forget_adopt_floor(src);
    }
    bump_history_epoch();
}

// The DETECTION path's reset — hp_detect_run's only entry, and separate from history_reset() for a
// reason that only became visible on a board with a bus attached.
//
// Detection resolves a profile on EVERY boot: the model is RAM-only by design, so there is nothing
// persisted to compare it against and the sweep always runs. Treating "detection resolved" as "the
// observation identity changed" was therefore correct while the rings died at every reboot anyway —
// and became wrong the moment .noinit started carrying them across one. Measured on the live board:
// history_start() adopted all rings ("persist":"accept"), and four seconds later this reset threw
// the X10A rings away again, leaving only HomeHub and ENV III. The feature delivered nothing on
// exactly the boards that have a heat pump attached.
//
// A board WITHOUT a bus never reaches this call — the profile stays "auto" — which is why the bench
// board showed a complete restore and could not have caught it. The absence of the bus hid it.
//
// So the first detection after an ADOPTED boot defers to a better-informed check instead of guessing.
// The adopted rings still carry the previous identity in their labels, and history_record() already
// compares those against the newly resolved ones per row (history_row_identity_changed) and wipes if
// and only if the unit really is a different one — the same rule that protects a running board from
// a mid-session model change, now simply allowed to answer for a reboot too. A generic fallback or a
// swapped unit spells its rows differently and is still wiped; a re-detect of the same unit is not.
//
// ONE boot, ONE detection: every later call resets exactly as before, so a genuine re-detect, a link
// rewire or a /set_hp model change is unaffected.
void history_reset_on_detect(uint32_t identity_fp) {
    if (!s_mtx || identity_fp == 0) return;
    Lock flash_lk(s_flash_mtx);
    if (s_flash_mtx && !flash_lk.acquired()) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    s_detect_seen = true;
    const uint32_t previous = s_x10a_target_fp.load();
    if (s_adopt_detect_grace && previous == identity_fp) {
        s_adopt_detect_grace = false;
        return;
    }
    s_adopt_detect_grace = false;
    s_x10a_target_fp.store(identity_fp);
    s_reset_requested.store(true);
    if (s_flash_mtx && previous != identity_fp) {
        // The initial boot scan was scoped to the persisted identity. If detection proves another
        // unit, fail closed for this boot rather than splicing any prior target into it.
        const size_t src = static_cast<size_t>(logic::HistoryJournalSource::X10a);
        s_flash_last_bucket[src] = INT64_MIN;
        s_flash_newest_bucket[src] = INT64_MIN;
        s_flash_oldest_bucket[src] = INT64_MIN;
        s_flash_restore_slot_count[src] = 0;
        forget_adopt_floor(src);
    }
    bump_history_epoch();
}

void history_modbus_reset(uint32_t target_fp) noexcept {
    // Same deferred-reset boundary as X10A: a HomeHub host/port/unit edit can race the old poll
    // cycle, so the Modbus task clears and reseeds its rings before folding the new identity. Bump
    // generation and arm that reset under the SAME mutex as the fold: an old cycle either completes
    // entirely before this boundary (and readers are then hidden by the pending flag), or observes
    // the new generation and is refused. It can never consume B's reset and fold A as B's first row.
    if (!s_mtx) return;
    // Flash service takes flash -> history while assembling records. Use the same order so a target
    // change cannot race an old scoped record into the journal or restore index.
    Lock flash_lk(s_flash_mtx);
    if (s_flash_mtx && !flash_lk.acquired()) return;
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    uint32_t next = s_mb_identity_generation.load() + 1;
    if (next == 0) next = 1;  // zero remains an invalid/pre-init sentinel
    s_mb_identity_generation.store(next);
    s_mb_target_fp.store(target_fp);
    s_mb_reset_requested.store(true);
    if (s_flash_mtx) {
        const size_t src = static_cast<size_t>(logic::HistoryJournalSource::Modbus);
        s_flash_last_bucket[src] = INT64_MIN;
        s_flash_newest_bucket[src] = INT64_MIN;
        s_flash_oldest_bucket[src] = INT64_MIN;
        s_flash_restore_slot_count[src] = 0;
        forget_adopt_floor(src);
    }
    bump_history_epoch();
}

uint32_t history_modbus_generation() { return s_mb_identity_generation.load(); }

void history_circulation_reset() {
    if (!s_mtx) return;
    // The identity of the witness the live configuration defines, read BEFORE the history lock: it
    // takes the config mutex, and the callers (a /set_* handler after its save, app_main's consent
    // opt-out) hold neither lock. The hash is allocation-free, which is what with_config demands.
    const uint32_t identity =
        with_config([](const Config& c) { return logic::history_circulation_identity(c); });
    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    s_circulation_fp.store(identity);
    s_circulation_reset_requested.store(true);
    bump_history_epoch();
}

void history_checkup_reset() {
    // The caller already retired the diagnostic producer generation. That remains a browser
    // lifecycle change even when this board has no compatible flash journal/index to clear.
    if (!s_flash_mtx) {
        bump_history_epoch();
        return;
    }
    Lock lk(s_flash_mtx);
    if (!lk.acquired()) {
        bump_history_epoch();
        return;
    }
    const size_t src = static_cast<size_t>(logic::HistoryJournalSource::Checkup);
    // The generation embedded in each payload is the durable identity. Resetting the cursor also
    // permits the first completed hour of the new generation to replace a same-hour predecessor.
    s_flash_last_bucket[src] = INT64_MIN;
    s_flash_restore_slot_count[src] = 0;
    s_flash_checkup_restore_done = true;
    bump_history_epoch();
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
        if (!lk.acquired()) return;
        if (s_flash_forgotten.load()) return;
        advance_raster_locked(now_us, bucket);
        fold_board_locked(board);
        persist_seal_locked();
    }
    // OUTSIDE the lock, and that is not a style choice: the restore takes the same non-recursive
    // mutex through history_splice_snapshot, so calling it from inside this critical section would
    // deadlock the task that owns the X10A UART. It rides this tick because this is the one producer
    // that runs unconditionally, on every cycle, whether or not the bus ever answers.
    history_service_flash_restore();
    history_flash_service_journal(/*max_records=*/3, /*wait_ticks=*/0);
}

void history_record_circulation() {
    if (!s_mtx) return;
    const uint32_t              circulation_generation = circulation_source_generation();
    const CirculationPumpSample circulation            = circulation_pump_sample();
    const int64_t now_us = esp_timer_get_time();
    const uint32_t bucket = logic::history_bucket(now_us);

    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (s_flash_forgotten.load()) return;
    if (circulation_generation != circulation_source_generation()) return;
    advance_raster_locked(now_us, bucket);
    reset_circulation_locked(bucket);
    fold_circulation_locked(circulation);
    persist_seal_locked();
}

void history_record(const CachedValue* v, size_t n, uint32_t source_generation) {
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
        labels[i] = v[i].label;
        units[i]  = v[i].unit;
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

    const uint32_t              circulation_generation = circulation_source_generation();
    const CirculationPumpSample circulation            = circulation_pump_sample();

    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (s_flash_forgotten.load()) return;
    if (!hp_poll_generation_matches(source_generation) || s_x10a_target_fp.load() == 0) return;

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
    const bool reset_requested = s_reset_requested.exchange(false);
    if (reset_requested || identity_changed) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (size_t t = 0; t < TREND_COUNT; t++) {
            if (independent_trend(logic::TRENDS[t])) continue;
            P().ring[t].ring.reset_with_gaps(completed);
            P().ring[t].label[0] = '\0';
            P().ring[t].unit[0] = '\0';
        }
        P().x10a_target_fp = s_x10a_target_fp.load();
        // Retired rings take their booking remainder with them.
        P().residual_us[static_cast<size_t>(logic::HistoryJournalSource::X10a)] = 0;
        s_persist_dirty = true;
        // Public reset requests published their epoch before the deferred clear. Only a newly
        // discovered row-identity mismatch needs another retirement event here.
        if (!reset_requested && identity_changed) bump_history_epoch();
    }
    if (circulation_generation == circulation_source_generation()) reset_circulation_locked(bucket);

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
        if (copy_field(tr.unit, sizeof(tr.unit), v[idx].unit)) s_persist_dirty = true;

        int tenths = 0;
        const bool has = value_tenths(v[idx].value, tenths);
        const HistorySample sample =
            logic::history_store(has, tenths, regs[idx], rps_known, rps_running);
        if (d.kind == logic::TrendKind::BinaryEvent) tr.ring.fold_binary_event(sample);
        else tr.ring.fold(sample);
    }
    if (circulation_generation == circulation_source_generation())
        fold_circulation_locked(circulation);
    persist_seal_locked();
}

void history_record_modbus(const CachedValue* v, size_t n, uint32_t identity_generation) {
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
            const auto* row = def::homehub_definition(v[i].modbus_definition);
            if (!row || !logic::homehub_history_row_matches(logic::HOMEHUB_HISTORIES[t], *row,
                    def::homehub_has_quiet_activity(*row))) continue;
            int tenths = 0;
            if (value_tenths(v[i].value, tenths)) sample[t] = static_cast<HistorySample>(tenths);
            break;
        }
    }

    Lock lk(s_mtx);
    if (!lk.acquired()) return;
    if (s_flash_forgotten.load()) return;
    // A /set_hp target change can land while this cycle is reading the old HomeHub. Never consume the
    // pending reset or fold that old sample into the freshly-reset identity.
    if (identity_generation == 0 || identity_generation != s_mb_identity_generation.load()) return;
    if (!s_mb_have_bucket) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().mb_ring) ring.reset_with_gaps(completed);
        s_persist_dirty = true;
        if (completed) {
            s_mb_last_commit_us = static_cast<int64_t>(bucket) * logic::HISTORY_DT_S * 1000000;
            s_mb_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Modbus,
                                           s_mb_last_commit_us);
        }
    } else if (bucket != s_mb_bucket) {
        const uint32_t skipped = logic::history_skipped(s_mb_bucket, bucket);
        for (auto& ring : P().mb_ring) ring.commit(skipped);
        s_persist_dirty = true;
        s_mb_last_commit_us = now_us;
        s_mb_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        P().boots_since_commit  = 0;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Modbus, now_us);
    }
    s_mb_bucket = bucket;
    s_mb_have_bucket = true;
    if (s_mb_reset_requested.exchange(false)) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().mb_ring) ring.reset_with_gaps(completed);
        P().mb_target_fp = s_mb_target_fp.load();
        P().residual_us[static_cast<size_t>(logic::HistoryJournalSource::Modbus)] = 0;
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
    if (!lk.acquired()) return;
    if (s_flash_forgotten.load()) return;
    // The producer is alive and feeding: from here the journal may file this ring's buckets.
    s_env3_fed = true;
    if (!s_env3_have_bucket) {
        const size_t completed = logic::history_completed_samples(bucket);
        for (auto& ring : P().env3_ring) ring.reset_with_gaps(completed);
        s_persist_dirty = true;
        if (completed) {
            s_env3_last_commit_us = static_cast<int64_t>(bucket) * logic::HISTORY_DT_S * 1000000;
            s_env3_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Env3,
                                           s_env3_last_commit_us);
        }
    } else if (bucket != s_env3_bucket) {
        const uint32_t skipped = logic::history_skipped(s_env3_bucket, bucket);
        for (auto& ring : P().env3_ring) ring.commit(skipped);
        s_persist_dirty = true;
        s_env3_last_commit_us = now_us;
        s_env3_last_commit_bucket = static_cast<int64_t>(bucket) - 1;
        P().boots_since_commit    = 0;
        logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Env3, now_us);
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

// The series' time-axis facts, taken from the SAME critical section as its samples (HIST-01/e). The
// route used to ask for them afterwards, through three further getters that each took the lock
// again; a bucket commit between the copy and the getter shifted sample zero by one bucket under a
// t0/b0 that still described the old ring. Every caller below holds s_mtx, copies the samples and
// fills `meta` before releasing it, and nothing in here allocates.
static void clear_snapshot_meta(logic::HistoryMeta* meta) {
    if (!meta) return;
    meta->newest_age_s  = -1;
    meta->oldest_bucket = -1;
}

static void fill_snapshot_meta_locked(logic::HistoryMeta* meta, int64_t last_commit_us,
                                      int64_t last_commit_bucket, size_t n) {
    if (!meta) return;
    meta->newest_age_s  = logic::history_meta_newest_age_s(esp_timer_get_time(), last_commit_us);
    meta->oldest_bucket = logic::history_meta_oldest_bucket(last_commit_bucket, n);
}

size_t history_snapshot(size_t t, HistorySample* out, size_t max, uint32_t* epoch,
                        logic::HistoryMeta* meta) {
    if (epoch) *epoch = 0;
    clear_snapshot_meta(meta);
    if (t >= TREND_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (lk.acquired() && epoch) *epoch = history_epoch();
    // Do not expose the old physical identity while its deferred reset is waiting for the poll task.
    if (!lk.acquired() || s_flash_forgotten.load() ||
        (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    const size_t n = P().ring[t].ring.snapshot(out, max);
    fill_snapshot_meta_locked(meta, s_last_commit_us, s_last_commit_bucket, n);
    return n;
}

size_t history_modbus_snapshot(size_t t, HistorySample* out, size_t max, uint32_t* epoch,
                               logic::HistoryMeta* meta) {
    if (epoch) *epoch = 0;
    clear_snapshot_meta(meta);
    if (t >= HOMEHUB_HISTORY_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (lk.acquired() && epoch) *epoch = history_epoch();
    if (!lk.acquired() || s_flash_forgotten.load() || s_mb_reset_requested.load()) return 0;
    const size_t n = P().mb_ring[t].snapshot(out, max);
    fill_snapshot_meta_locked(meta, s_mb_last_commit_us, s_mb_last_commit_bucket, n);
    return n;
}

size_t history_env3_snapshot(size_t t, HistorySample* out, size_t max, uint32_t* epoch,
                             logic::HistoryMeta* meta) {
    if (epoch) *epoch = 0;
    clear_snapshot_meta(meta);
    if (t >= ENV3_HISTORY_COUNT || !out || !max || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (lk.acquired() && epoch) *epoch = history_epoch();
    if (!lk.acquired() || s_flash_forgotten.load()) return 0;
    const size_t n = P().env3_ring[t].snapshot(out, max);
    fill_snapshot_meta_locked(meta, s_env3_last_commit_us, s_env3_last_commit_bucket, n);
    return n;
}

// Copied out under the lock rather than returning the pointer: the poll task rewrites these buffers
// on a model change, and a caller holding the pointer would read one mid-write.
static size_t copy_under_lock(const char* src, char* out, size_t max) {
    std::strncpy(out, src, max - 1);
    out[max - 1] = '\0';
    return std::strlen(out);
}

// ── Splicing an older snapshot in behind the live samples ───────────────────────────────────────
// The stored record needs a synced clock, then its absolute bucket can seed an otherwise-empty live
// side immediately. That is what makes the device flash record — not a browser cache — sufficient
// during the first five minutes after an OTA.
//
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

// Give a source that has not closed a bucket in this boot an honest present-day endpoint. The
// splice below fills every elapsed bucket after the stored anchor with explicit gaps, so a longer
// restart never slides old readings forward. The boot's monotonic raster then continues from its
// current open bucket exactly like a normal first observation.
//
// The newest restored sample claims to have been committed at the LAST MONOTONIC BOUNDARY, not at
// the start of the open wall bucket (HIST-03/c). Every later commit of this boot lands on that
// monotonic grid, so the first one comes exactly one raster step after the seed and its wall
// bucket follows the seed's by one. Claiming the wall bucket's start put the seed on a different
// grid, and the first commit then fell into the very wall bucket the seed had claimed in a fixed
// share of restores, duplicating a bucket and shifting every restored sample one bucket early.
bool seed_source_timeline_locked(HistorySource src, int64_t stored_anchor, int64_t& live_anchor) {
    int64_t unix_s = -1; int32_t ms = 0;
    time_now(unix_s, ms);
    if (unix_s < 0) return false;
    const int64_t  now_us    = esp_timer_get_time();
    const uint32_t bucket    = logic::history_bucket(now_us);
    const int64_t  commit_us = logic::history_raster_boundary_us(now_us);
    live_anchor = logic::history_anchor_bucket(unix_s, now_us, commit_us, logic::HISTORY_DT_S, ms);
    if (stored_anchor > live_anchor) return false;       // stored clock was ahead — never slide it back

    const int64_t mono_commit_bucket = bucket ? static_cast<int64_t>(bucket) - 1 : -1;

    switch (src) {
        case HistorySource::X10a:
            if (!s_have_bucket) { s_have_bucket = true; s_bucket = bucket; }
            s_last_commit_us = commit_us; s_last_commit_bucket = mono_commit_bucket;
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::X10a,
                                           commit_us);
            // If SNTP won the race against first detection, let the latter validate/fill labels
            // instead of immediately wiping the just-restored samples.
            if (!s_detect_seen) s_adopt_detect_grace = true;
            break;
        case HistorySource::Modbus:
            if (!s_mb_have_bucket) { s_mb_have_bucket = true; s_mb_bucket = bucket; }
            s_mb_last_commit_us = commit_us; s_mb_last_commit_bucket = mono_commit_bucket;
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Modbus,
                                           commit_us);
            break;
        case HistorySource::Env3:
            if (!s_env3_have_bucket) { s_env3_have_bucket = true; s_env3_bucket = bucket; }
            s_env3_last_commit_us = commit_us; s_env3_last_commit_bucket = mono_commit_bucket;
            logic::history_liveness_commit(s_liveness, logic::HistoryJournalSource::Env3,
                                           commit_us);
            break;
    }
    return true;
}

bool splice_locked(HistorySource src, size_t idx, const HistorySample* v, size_t n, uint32_t stride,
                   int64_t newest_bucket) {
    logic::TrendRing* r = ring_at(src, idx);
    if (!r || !v || !n || newest_bucket == INT64_MIN) return false;

    int64_t live_anchor = source_anchor_bucket_locked(src);
    if (live_anchor == INT64_MIN && !seed_source_timeline_locked(src, newest_bucket, live_anchor))
        return false;
    const size_t live_n = r->snapshot(s_splice_live, HISTORY_SAMPLES);

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
                                    size_t n, uint32_t stride, int64_t newest_bucket,
                                    uint32_t circulation_identity) {
    if (!s_mtx) return false;
    Lock lk(s_mtx);
    if (!lk.acquired()) return false;
    // The same guard the live reader uses: never rebuild a ring whose physical identity is about to
    // be discarded anyway.
    if (src == HistorySource::X10a && s_reset_requested.load()) return false;
    if (src == HistorySource::Modbus && s_mb_reset_requested.load()) return false;
    // HIST-01/b: the circulation column is the external witness's, not the heat pump's, and its
    // identity moves on its own. While a circulation reset is pending the ring still holds the
    // retired witness's samples. And a block assembled from records of one witness must not be
    // spliced into a ring that has moved to another between that assembly and this lock — the
    // reset may have been consumed meanwhile, so the pending flag alone would not catch it.
    if (src == HistorySource::X10a && logic::history_trend_is_circulation(idx) &&
        !logic::history_circulation_restore_allowed(circulation_identity, P().circulation_fp,
                                                    s_circulation_reset_requested.load()))
        return false;
    const bool ok = splice_locked(src, idx, v, n, stride, newest_bucket);
    persist_seal_locked();
    return ok;
}

size_t history_label(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.acquired() || (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    return copy_under_lock(P().ring[t].label, out, max);
}

size_t history_unit(size_t t, char* out, size_t max) {
    if (!out || !max) return 0;
    out[0] = '\0';
    if (t >= TREND_COUNT || !s_mtx) return 0;
    Lock lk(s_mtx);
    if (!lk.acquired() || (s_reset_requested.load() && !independent_trend(logic::TRENDS[t])) ||
        (s_circulation_reset_requested.load() && circulation_trend(logic::TRENDS[t]))) return 0;
    return copy_under_lock(P().ring[t].unit, out, max);
}

// ── History flash journal: scan, restore, append ─────────────────────────────────────────────────
namespace {

static_assert(static_cast<uint8_t>(HistorySource::X10a) ==
                  static_cast<uint8_t>(logic::HistoryJournalSource::X10a) &&
              static_cast<uint8_t>(HistorySource::Modbus) ==
                  static_cast<uint8_t>(logic::HistoryJournalSource::Modbus) &&
              static_cast<uint8_t>(HistorySource::Env3) ==
                  static_cast<uint8_t>(logic::HistoryJournalSource::Env3),
              "RAM and flash source ids are one wire contract");

logic::HistoryJournalSource journal_source(HistorySource src) {
    return static_cast<logic::HistoryJournalSource>(static_cast<uint8_t>(src));
}

bool flash_is_manifest(const logic::HistoryJournalHeader& h) {
    return h.flags == logic::HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST &&
           h.source < static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);
}

void flash_manifest_cache_reset() {
    for (auto& by_source : s_flash_manifests)
        for (auto& m : by_source) m = {};
    for (auto& current : s_flash_manifest_current) current = {};
}

const FlashManifestCache* flash_manifest_find(const logic::HistoryJournalHeader& h) {
    if (h.source >= 3) return nullptr;
    for (const auto& m : s_flash_manifests[h.source]) {
        if (!m.valid || m.catalog_fp != h.catalog_fp || m.source != h.source ||
            m.count != h.value_count) continue;
        bool same = true;
        for (size_t i = 0; i < 3; ++i)
            if (m.rings[i] != h.rings[i]) { same = false; break; }
        if (same) return &m;
    }
    return nullptr;
}

bool flash_manifest_cache_add(const FlashJournalRecord& r) {
    const auto& h = r.header;
    const auto* ids = reinterpret_cast<const uint32_t*>(r.payload);
    if (!logic::history_journal_manifest_payload_matches(h, ids) || h.source >= 3) return false;
    auto& cache = s_flash_manifests[h.source];
    size_t chosen = logic::HISTORY_MANIFEST_CACHE_PER_SOURCE;
    uint64_t oldest = UINT64_MAX;
    for (size_t i = 0; i < logic::HISTORY_MANIFEST_CACHE_PER_SOURCE; ++i) {
        if (cache[i].valid && cache[i].catalog_fp == h.catalog_fp) {
            if (cache[i].sequence >= h.sequence) return true;
            chosen = i;
            break;
        }
        if (!cache[i].valid) { chosen = i; break; }
        if (cache[i].sequence < oldest) { oldest = cache[i].sequence; chosen = i; }
    }
    if (chosen >= logic::HISTORY_MANIFEST_CACHE_PER_SOURCE) return false;
    auto& out = cache[chosen];
    out = {};
    out.valid = true;
    out.source = h.source;
    out.count = h.value_count;
    for (size_t i = 0; i < 3; ++i) out.rings[i] = h.rings[i];
    out.catalog_fp = h.catalog_fp;
    out.schema_fp = logic::history_journal_schema_fingerprint(h);
    out.sequence = h.sequence;
    out.bucket = h.bucket;
    for (auto& index : out.stored_index) index = -1;
    const auto source = static_cast<logic::HistoryJournalSource>(h.source);
    const size_t current_count = logic::history_journal_source_rings(source);
    for (size_t current = 0; current < current_count; ++current) {
        const uint32_t id = logic::history_series_id(source, current);
        for (size_t stored = 0; stored < h.value_count; ++stored) {
            if (ids[stored] != id) continue;
            out.stored_index[current] = static_cast<int8_t>(stored);
            break;
        }
    }
    // The most recently APPENDED manifest of this build's generation is the current one. The
    // append path hands in a record whose sequence is the highest in the journal, and the boot scan
    // meets them in physical order, so the sequence comparison inside the helper picks the same one
    // in both. Never compare buckets here: after a cursor reset the new manifest is deliberately
    // OLDER than its predecessor, and refusing it livelocked the writer (HIST-02/a).
    const bool current_generation =
        h.catalog_fp == P().catalog_fp &&
        h.value_count == logic::history_journal_source_rings(
                             static_cast<logic::HistoryJournalSource>(h.source)) &&
        out.schema_fp == logic::history_current_series_list_fingerprint(
                             static_cast<logic::HistoryJournalSource>(h.source));
    (void)logic::history_manifest_adopt(s_flash_manifest_current[h.source], current_generation,
                                        h.catalog_fp, h.bucket, h.sequence);
    return true;
}

bool flash_trend_scope_matches(const logic::HistoryJournalHeader& h) {
    if (h.source == static_cast<uint8_t>(logic::HistoryJournalSource::X10a))
        return logic::history_journal_scope(h) == s_x10a_target_fp.load();
    if (h.source == static_cast<uint8_t>(logic::HistoryJournalSource::Modbus))
        return logic::history_journal_scope(h) == s_mb_target_fp.load();
    return h.source == static_cast<uint8_t>(logic::HistoryJournalSource::Env3);
}

bool flash_current_layout_matches(const logic::HistoryJournalHeader& h) {
    return logic::history_journal_trend_layout_matches(
        h, P().catalog_fp, static_cast<uint16_t>(TREND_COUNT),
        static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT),
        static_cast<uint16_t>(ENV3_HISTORY_COUNT));
}

bool flash_record_physically_valid(const FlashJournalRecord& r) {
    const auto& h = r.header;
    const bool checkup = h.source ==
        static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);
    const bool header_ok =
        checkup
            ? logic::history_journal_checkup_header_structural_matches(h, logic::CHECKUP_DT_S)
            : (flash_is_manifest(h) ? logic::history_journal_manifest_header_matches(h)
                                    : logic::history_journal_trend_header_structural_matches(h));
    const size_t payload_bytes = logic::history_journal_payload_bytes(h);
    if (!header_ok || payload_bytes > sizeof(r.payload)) return false;
    if (flash_is_manifest(h) && !logic::history_journal_manifest_payload_matches(
            h, reinterpret_cast<const uint32_t*>(r.payload))) return false;
    return header_ok && h.crc ==
        logic::history_journal_crc_bytes(h, r.payload, payload_bytes);
}

bool flash_record_valid(const FlashJournalRecord& r) {
    if (!flash_record_physically_valid(r)) return false;
    const auto& h = r.header;
    if (flash_is_manifest(h)) return false;
    if (h.source == static_cast<uint8_t>(logic::HistoryJournalSource::Checkup))
        return logic::history_journal_header_matches(
            h, logic::checkup_journal_fingerprint(),
            static_cast<uint16_t>(logic::CHECKUP_JOURNAL_WORDS), logic::CHECKUP_DT_S);
    if (!flash_trend_scope_matches(h)) return false;
    return flash_current_layout_matches(h) ||
           logic::history_legacy_disinfection_layout_matches(h) ||
           flash_manifest_find(h) != nullptr;
}

int flash_record_stored_index(const logic::HistoryJournalHeader& h, size_t current_index) {
    if (h.source >= 3) return -1;
    const auto src = static_cast<logic::HistoryJournalSource>(h.source);
    if (current_index >= logic::history_journal_source_rings(src)) return -1;
    if (flash_current_layout_matches(h)) return static_cast<int>(current_index);
    if (logic::history_legacy_disinfection_layout_matches(h))
        return logic::history_legacy_disinfection_stored_index(src, current_index);
    const auto* manifest = flash_manifest_find(h);
    return manifest ? manifest->stored_index[current_index] : -1;
}

esp_err_t flash_read_record(size_t slot, FlashJournalRecord& out) {
    if (!s_flash_part || slot >= logic::HISTORY_JOURNAL_SLOT_COUNT) return ESP_ERR_INVALID_ARG;
    return esp_partition_read(s_flash_part, logic::history_journal_slot_offset(slot),
                              &out, sizeof(out));
}

// Pass 1 finds the newest committed record and each source's latest bucket. Pass 2 walks backwards
// from that physical head and remembers only slots inside the source's last 24-hour window. The
// restore index is 1.7 KiB and the bounded manifest cache stays below 1.2 KiB; retaining a second
// ~30 KiB matrix beside the live rings would defeat the static memory budget this feature was
// designed around.
bool flash_journal_scan() {
    uint64_t highest_sequence = 0;
    uint64_t newest_sequence[kJournalSources] = {};
    size_t head_slot = 0;
    size_t valid_records = 0;
    size_t bad_records = 0;
    flash_manifest_cache_reset();
    for (size_t src = 0; src < kJournalSources; src++) {
        s_flash_last_bucket[src] = INT64_MIN;
        s_flash_newest_bucket[src] = INT64_MIN;
        s_flash_oldest_bucket[src] = INT64_MIN;
        s_flash_restore_slot_count[src] = 0;
    }

    for (size_t sector = 0; sector < logic::HISTORY_FLASH_PARTITION_BYTES;
         sector += logic::HISTORY_FLASH_ERASE_BYTES) {
        const esp_err_t e = esp_partition_read(s_flash_part, sector, s_flash_sector,
                                               sizeof(s_flash_sector));
        if (e != ESP_OK) {
            diag_printf("history: journal scan failed at 0x%x (%s)\n",
                        static_cast<unsigned>(sector), esp_err_to_name(e));
            return false;
        }
        for (size_t local = 0; local < logic::HISTORY_JOURNAL_SLOTS_PER_SECTOR; local++) {
            const size_t slot = sector / logic::HISTORY_JOURNAL_SLOT_BYTES + local;
            const uint8_t* raw = s_flash_sector + local * logic::HISTORY_JOURNAL_SLOT_BYTES;
            FlashJournalRecord r;
            std::memcpy(&r, raw, sizeof(r));
            if (!flash_record_physically_valid(r)) {
                if (r.header.magic == logic::HISTORY_JOURNAL_MAGIC &&
                    r.header.commit == logic::HISTORY_JOURNAL_COMMITTED &&
                    r.header.catalog_fp == P().catalog_fp)
                    bad_records++;
                continue;
            }
            valid_records++;
            if (flash_is_manifest(r.header)) (void)flash_manifest_cache_add(r);
            if (r.header.sequence > highest_sequence) {
                highest_sequence = r.header.sequence;
                head_slot = slot;
            }
        }
    }

    s_flash_next_sequence = highest_sequence ? highest_sequence + 1 : 1;
    s_flash_next_slot = highest_sequence
        ? (head_slot + 1) % logic::HISTORY_JOURNAL_SLOT_COUNT : 0;

    bool   done[kJournalSources] = {};
    size_t remaining             = kJournalSources;
    for (size_t src = 0; src < kJournalSources; src++) {
        newest_sequence[src] = 0;
    }
    if (highest_sequence) {
        size_t slot = head_slot;
        size_t seen_valid = 0;
        for (size_t visited = 0; visited < logic::HISTORY_JOURNAL_SLOT_COUNT && remaining;
             visited++) {
            FlashJournalRecord r;
            const esp_err_t e = flash_read_record(slot, r);
            if (e != ESP_OK) {
                diag_printf("history: journal index failed at slot %u (%s)\n",
                            static_cast<unsigned>(slot), esp_err_to_name(e));
                return false;
            }
            if (flash_record_physically_valid(r)) {
                seen_valid++;
            }
            if (flash_record_valid(r)) {
                const size_t src = r.header.source;
                if (newest_sequence[src] == 0) {
                    newest_sequence[src]       = r.header.sequence;
                    s_flash_newest_bucket[src] = r.header.bucket;
                    s_flash_last_bucket[src]   = r.header.bucket;
                }
                if (!done[src]) {
                    const size_t retain =
                        src == static_cast<size_t>(logic::HistoryJournalSource::Checkup)
                            ? logic::CHECKUP_COMPLETED_BUCKETS
                            : HISTORY_SAMPLES;
                    const int64_t oldest =
                        s_flash_newest_bucket[src] - static_cast<int64_t>(retain - 1);
                    if (r.header.bucket < oldest) {
                        done[src] = true;
                        remaining--;
                    } else if (r.header.bucket <= s_flash_newest_bucket[src] &&
                               s_flash_restore_slot_count[src] < retain) {
                        s_flash_restore_slots[src][s_flash_restore_slot_count[src]++] =
                            static_cast<uint16_t>(slot);
                        if (s_flash_oldest_bucket[src] == INT64_MIN ||
                            r.header.bucket < s_flash_oldest_bucket[src])
                            s_flash_oldest_bucket[src] = r.header.bucket;
                    }
                }
            }
            if (seen_valid >= valid_records) break;   // young journal: do not read 16k erased slots
            slot = slot ? slot - 1 : logic::HISTORY_JOURNAL_SLOT_COUNT - 1;
        }
    }

    for (size_t src = 0; src < kJournalSources; ++src)
        if (newest_sequence[src] == 0) done[src] = true;

    const size_t checkup_src = static_cast<size_t>(logic::HistoryJournalSource::Checkup);
    s_flash_checkup_restore_done = newest_sequence[checkup_src] == 0;
    if (!highest_sequence) s_flash_restore_done = true;
    diag_printf("history: journal ready (%u valid, %u torn/invalid, next slot %u, %u-byte records)\n",
                static_cast<unsigned>(valid_records), static_cast<unsigned>(bad_records),
                static_cast<unsigned>(s_flash_next_slot),
                static_cast<unsigned>(logic::HISTORY_JOURNAL_SLOT_BYTES));
    return true;
}

esp_err_t flash_region_erased(size_t offset, size_t bytes, bool& erased) {
    if (bytes > sizeof(s_flash_sector)) return ESP_ERR_INVALID_SIZE;
    const esp_err_t e = esp_partition_read(s_flash_part, offset, s_flash_sector, bytes);
    if (e != ESP_OK) return e;
    erased = true;
    for (size_t i = 0; i < bytes; i++) {
        if (s_flash_sector[i] != 0xff) { erased = false; break; }
    }
    return ESP_OK;
}

esp_err_t flash_prepare_next_slot(size_t& slot) {
    slot = s_flash_next_slot;
    bool erased = false;
    if (slot % logic::HISTORY_JOURNAL_SLOTS_PER_SECTOR == 0) {
        const size_t sector_offset = logic::history_journal_slot_offset(slot);
        esp_err_t e = flash_region_erased(sector_offset, logic::HISTORY_FLASH_ERASE_BYTES, erased);
        if (e != ESP_OK) return e;
        if (!erased)
            return esp_partition_erase_range(s_flash_part, sector_offset,
                                             logic::HISTORY_FLASH_ERASE_BYTES);
        return ESP_OK;
    }

    esp_err_t e = flash_region_erased(logic::history_journal_slot_offset(slot),
                                      logic::HISTORY_JOURNAL_SLOT_BYTES, erased);
    if (e != ESP_OK) return e;
    if (erased) return ESP_OK;

    // A non-erased slot after the head is a torn program. Never erase its sector: it also contains
    // the last committed records. Sacrifice the remaining slots and continue at the next sector.
    slot = logic::history_journal_write_slot(slot, erased);
    s_flash_next_slot = slot;
    const size_t sector_offset = logic::history_journal_slot_offset(slot);
    e = flash_region_erased(sector_offset, logic::HISTORY_FLASH_ERASE_BYTES, erased);
    if (e != ESP_OK) return e;
    return erased ? ESP_OK : esp_partition_erase_range(s_flash_part, sector_offset,
                                                        logic::HISTORY_FLASH_ERASE_BYTES);
}

// What a builder found out about a cursor that is ahead of its clock. A builder only REPORTS it: it
// returns "not built" and hands the numbers to flash_build_for_service, which logs them once the
// history mutex is released. The trend builder runs under s_mtx, and critical sections in this file
// stay plain integer copies: diag_printf takes the diag-ring mutex and does console I/O. Nothing is
// rewound or rewritten — see "A bucket from the future" in logic/history_persist.hpp.
struct FutureCursorNote {
    bool    future = false;     // the builder had a clock and found the cursor ahead of it
    int64_t cursor = INT64_MIN; // the source's append cursor
    int64_t bound  = INT64_MIN; // the newest bucket its clock vouches for
};

// Builds the next trend record of `src`. Returns false when there is nothing to append — or when
// the cursor is ahead of the source's own live anchor (`note`), which the builder only reports:
// rewinding it here would assume the CURRENT clock is the right one, and a boot that synchronised
// to a wrong past time would then rewrite the live window under wrong buckets.
bool flash_build_next_record(HistorySource src, FlashJournalRecord& out, TickType_t wait_ticks,
                             FutureCursorNote& note) {
    std::memset(&out, 0xff, sizeof(out));
    Lock lk(s_mtx, wait_ticks);
    if (!lk.acquired()) return false;
    // A source whose identity reset is still pending (a /set_hp or detection committed the new
    // identity, the deferred clear has not run yet) still holds the OLD unit's samples in its rings
    // while the scope stamped below is already the NEW unit's: the record would pass every check on
    // the next boot and restore A's curve under B. The live readers, the splice and the restore all
    // refuse in this state; the writer has to as well. For HomeHub this also covers a disabled hub,
    // whose pending reset is never consumed — its backlog must not be written under the empty host.
    if (src == HistorySource::X10a && (s_x10a_target_fp.load() == 0 || s_reset_requested.load()))
        return false;
    if (src == HistorySource::Modbus && s_mb_reset_requested.load()) return false;
    // ENV III has no identity to scope its records by, so the only thing that says a ring is being
    // measured is that its producer exists and has fed it this boot. A frozen ring (sensor
    // disabled, or a restore that nothing has extended yet) would otherwise be filed, sample by
    // sample, under the recent buckets it was adopted or seeded into (HIST-03/e).
    if (src == HistorySource::Env3 &&
        !logic::history_env3_append_allowed(s_env3_enabled, s_env3_fed))
        return false;

    const size_t src_i = static_cast<size_t>(src);
    const size_t value_count = logic::history_journal_source_rings(journal_source(src));
    const int64_t anchor = source_anchor_bucket_locked(src);
    if (anchor == INT64_MIN || !value_count) return false;

    // A cursor beyond the anchor can never be reached (target > anchor below), so every append is
    // refused until the clock catches up with it — which is the intended outcome, not a fault to
    // repair: the journal cannot tell stamps from a wrong far-future boot from a wrong PAST clock
    // now. The slack keeps the anchor's one-bucket jitter from being reported as a fault.
    if (logic::history_cursor_in_future(s_flash_last_bucket[src_i], anchor,
                                        logic::HISTORY_CURSOR_FUTURE_SLACK_BUCKETS)) {
        note.future = true;
        note.cursor = s_flash_last_bucket[src_i];
        note.bound  = anchor;
        return false;
    }

    size_t max_count = 0;
    for (size_t i = 0; i < value_count; i++) {
        const logic::TrendRing* r = ring_at(src, i);
        if (r && r->count > max_count) max_count = r->count;
    }
    if (!max_count) return false;

    // An adopted ring is the previous boot's, shifted by the seam: its newest REAL sample can sit
    // a bucket later than the bucket the journal already holds it under, and the walk below would
    // file the same reading again where nothing was measured. The first look after the adoption
    // decides, once, whether the journal already holds that sample (the cursor is within reach of
    // it) and lifts the cursor over it; later looks only apply the decision. A cursor that is
    // missing or far behind says those samples were never filed, and they still are.
    if (src_i < logic::HISTORY_LIVENESS_RASTERS && s_adopt_real_end_us[src_i] != INT64_MIN) {
        s_adopt_floor_bucket[src_i] = logic::history_adopt_floor_bucket(
            s_flash_last_bucket[src_i], wall_bucket_of_instant_locked(s_adopt_real_end_us[src_i]));
        s_adopt_real_end_us[src_i] = INT64_MIN;
    }
    const int64_t cursor = src_i < logic::HISTORY_LIVENESS_RASTERS
                               ? logic::history_adopt_floor_cursor(s_flash_last_bucket[src_i],
                                                                   s_adopt_floor_bucket[src_i])
                               : s_flash_last_bucket[src_i];
    const int64_t oldest = anchor - static_cast<int64_t>(max_count - 1);
    int64_t       target = cursor == INT64_MIN ? oldest : cursor + 1;
    if (target < oldest) target = oldest;       // backlog older than the live 24-hour ring is gone
    if (target > anchor) return false;
    const size_t age = static_cast<size_t>(anchor - target);

    auto& h = out.header;
    h.magic = logic::HISTORY_JOURNAL_MAGIC;
    h.version = logic::HISTORY_JOURNAL_VERSION;
    h.source = static_cast<uint8_t>(journal_source(src));
    h.flags = (src == HistorySource::X10a || src == HistorySource::Modbus)
        ? logic::HISTORY_JOURNAL_FLAG_TARGET_SCOPED : 0;
    h.catalog_fp = P().catalog_fp;
    h.crc = 0;
    h.commit = logic::HISTORY_JOURNAL_ERASED;
    h.value_count = static_cast<uint16_t>(value_count);
    h.slot_bytes = static_cast<uint16_t>(logic::HISTORY_JOURNAL_SLOT_BYTES);
    h.sequence = s_flash_next_sequence;
    h.bucket = target;
    h.dt_s = logic::HISTORY_DT_S;
    h.rings[0] = static_cast<uint16_t>(TREND_COUNT);
    h.rings[1] = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    h.rings[2] = static_cast<uint16_t>(ENV3_HISTORY_COUNT);
    h.reserved = 0xffff;
    if (src == HistorySource::X10a) {
        logic::history_journal_set_scope(h, s_x10a_target_fp.load());
        // HIST-01/b: name the witness the circulation COLUMN of this record was recorded under —
        // the identity of what the ring holds (P(), sealed with it), not the configured one: while
        // a reset is pending the ring still holds the retired witness's samples and the record
        // must say so. Header bytes pad[8..11]; logic::history_journal_set_circulation_identity
        // says why the previous firmware reads such a record unchanged.
        logic::history_journal_set_circulation_identity(h, P().circulation_fp);
    } else if (src == HistorySource::Modbus) {
        logic::history_journal_set_scope(h, s_mb_target_fp.load());
    }
    for (size_t i = 0; i < value_count; i++) {
        HistorySample sample = HISTORY_NO_READING;
        const logic::TrendRing* r = ring_at(src, i);
        if (r) (void)r->sample_from_newest(age, sample);
        std::memcpy(out.payload + i * sizeof(sample), &sample, sizeof(sample));
    }
    h.crc = logic::history_journal_crc_bytes(
        h, out.payload, value_count * sizeof(HistorySample));
    return true;
}

bool flash_manifest_due(HistorySource src, int64_t bucket) {
    const size_t i = static_cast<size_t>(src);
    if (i >= 3) return false;
    return logic::history_manifest_due(s_flash_manifest_current[i], P().catalog_fp, bucket);
}

bool flash_build_manifest_record(HistorySource src, int64_t bucket, FlashJournalRecord& out) {
    const auto source = journal_source(src);
    const size_t value_count = logic::history_journal_source_rings(source);
    if (static_cast<size_t>(src) >= 3 || bucket == INT64_MIN || !value_count ||
        value_count > logic::HISTORY_MANIFEST_MAX_IDS) return false;
    std::memset(&out, 0xff, sizeof(out));
    auto* ids = reinterpret_cast<uint32_t*>(out.payload);
    if (logic::history_current_series_ids(source, ids, logic::HISTORY_MANIFEST_MAX_IDS) != value_count)
        return false;

    auto& h = out.header;
    h.magic = logic::HISTORY_JOURNAL_MAGIC;
    h.version = logic::HISTORY_JOURNAL_VERSION;
    h.source = static_cast<uint8_t>(source);
    h.flags = logic::HISTORY_JOURNAL_FLAG_CATALOG_MANIFEST;
    h.catalog_fp = P().catalog_fp;
    h.crc = 0;
    h.commit = logic::HISTORY_JOURNAL_ERASED;
    h.value_count = static_cast<uint16_t>(value_count);
    h.slot_bytes = static_cast<uint16_t>(logic::HISTORY_JOURNAL_SLOT_BYTES);
    h.sequence = s_flash_next_sequence;
    h.bucket = bucket;
    h.dt_s = logic::HISTORY_DT_S;
    h.rings[0] = static_cast<uint16_t>(TREND_COUNT);
    h.rings[1] = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    h.rings[2] = static_cast<uint16_t>(ENV3_HISTORY_COUNT);
    h.reserved = 0xffff;
    logic::history_journal_set_schema_fingerprint(
        h, logic::history_series_list_fingerprint(source, ids, value_count));
    h.crc = logic::history_journal_crc_bytes(
        h, out.payload, value_count * sizeof(uint32_t));
    return true;
}

bool flash_build_next_checkup_record(FlashJournalRecord& out, TickType_t wait_ticks,
                                     FutureCursorNote& note) {
    (void)wait_ticks; // checkup_flash_next uses the non-blocking independent owner lock
    std::memset(&out, 0xff, sizeof(out));
    int64_t unix_s = -1; int32_t ms = 0;
    time_now(unix_s, ms);
    if (unix_s < 0) return false;

    const size_t src_i = static_cast<size_t>(logic::HistoryJournalSource::Checkup);
    // Same situation as the trend sources (HIST-02/b), checked against the wall clock rather than a
    // live anchor: checkup_flash_next answers "nothing to write" both when the cursor is current
    // and when it is ahead of everything it can ever produce, so a future-stamped record freezes
    // the diagnostic journal until the corrected clock reaches it. The newest live hour never lies
    // beyond the wall hour, which makes this a bound no legitimate cursor exceeds. Like the trend
    // builder this only reports it; nothing is rewound.
    const int64_t wall_bucket = logic::checkup_journal_bucket(unix_s);
    if (logic::history_cursor_in_future(s_flash_last_bucket[src_i], wall_bucket,
                                        logic::HISTORY_CURSOR_FUTURE_SLACK_BUCKETS)) {
        note.future = true;
        note.cursor = s_flash_last_bucket[src_i];
        note.bound  = wall_bucket;
        return false;
    }
    int64_t bucket = INT64_MIN;
    logic::CheckupJournalPayload payload;
    if (!checkup_flash_next(unix_s, s_flash_last_bucket[src_i], bucket, payload)) return false;

    auto& h = out.header;
    h.magic = logic::HISTORY_JOURNAL_MAGIC;
    h.version = logic::HISTORY_JOURNAL_VERSION;
    h.source = static_cast<uint8_t>(logic::HistoryJournalSource::Checkup);
    h.flags = 0;
    h.catalog_fp = logic::checkup_journal_fingerprint();
    h.crc = 0;
    h.commit = logic::HISTORY_JOURNAL_ERASED;
    h.value_count = static_cast<uint16_t>(logic::CHECKUP_JOURNAL_WORDS);
    h.slot_bytes = static_cast<uint16_t>(logic::HISTORY_JOURNAL_SLOT_BYTES);
    h.sequence = s_flash_next_sequence;
    h.bucket = bucket;
    h.dt_s = logic::CHECKUP_DT_S;
    h.rings[0] = static_cast<uint16_t>(TREND_COUNT);
    h.rings[1] = static_cast<uint16_t>(HOMEHUB_HISTORY_COUNT);
    h.rings[2] = static_cast<uint16_t>(ENV3_HISTORY_COUNT);
    h.reserved = 0xffff;
    std::memcpy(out.payload, &payload, sizeof(payload));
    // The count is word-rounded. Keep the possible final padding byte deterministic and covered by
    // CRC instead of inheriting the erased 0xff left by the slot initialisation.
    if (logic::CHECKUP_JOURNAL_PAYLOAD_BYTES > sizeof(payload))
        std::memset(out.payload + sizeof(payload), 0,
                    logic::CHECKUP_JOURNAL_PAYLOAD_BYTES - sizeof(payload));
    h.crc = logic::history_journal_crc_bytes(
        h, out.payload, logic::CHECKUP_JOURNAL_PAYLOAD_BYTES);
    return true;
}

// One attempt to append `r`. `slot` is the slot the attempt targeted, whatever its outcome, so the
// caller can account for a failure against it.
esp_err_t flash_append_record_at(FlashJournalRecord& r, size_t& slot) {
    slot        = 0;
    esp_err_t e = flash_prepare_next_slot(slot);
    if (e != ESP_OK) return e;
    const size_t offset = logic::history_journal_slot_offset(slot);
    const size_t body_bytes = sizeof(r.header) + logic::history_journal_payload_bytes(r.header);
    e = esp_partition_write(s_flash_part, offset, &r, body_bytes);
    if (e == ESP_OK) {
        const uint32_t commit = logic::HISTORY_JOURNAL_COMMITTED;
        e = esp_partition_write(s_flash_part,
                                offset + offsetof(logic::HistoryJournalHeader, commit),
                                &commit, sizeof(commit));
    }
    FlashJournalRecord verify;
    const esp_err_t read_e = flash_read_record(slot, verify);
    const bool committed = read_e == ESP_OK && flash_record_physically_valid(verify) &&
                           verify.header.sequence == r.header.sequence &&
                           verify.header.bucket == r.header.bucket;
    // A low-level program call may report an error after the chip accepted the bytes. The readback
    // is the authority: treating a valid committed record as failed would retry the same sequence in
    // another slot and make head selection ambiguous on the next boot.
    if (!committed) return e != ESP_OK ? e : (read_e != ESP_OK ? read_e : ESP_ERR_INVALID_RESPONSE);

    const size_t src = r.header.source;
    if (flash_is_manifest(r.header)) {
        if (!flash_manifest_cache_add(verify)) return ESP_ERR_INVALID_RESPONSE;
    } else {
        s_flash_last_bucket[src] = r.header.bucket;
        s_flash_newest_bucket[src] = r.header.bucket;
    }
    s_flash_next_slot = (slot + 1) % logic::HISTORY_JOURNAL_SLOT_COUNT;
    s_flash_next_sequence++;
    return ESP_OK;
}

// One sector is abandoned by either of two paths — the explicit skip in flash_note_append_failure,
// or the cursor moving by itself in flash_prepare_next_slot — and the first abandon of an episode
// is logged from whichever finds it (the torn jump used to count silently, so an episode that began
// with one never printed the line).
void flash_count_abandoned_sector(size_t from_slot, size_t to_slot) {
    if (s_flash_fail_skipped < UINT16_MAX) s_flash_fail_skipped++;
    if (s_flash_fail_skipped == 1)
        diag_printf("history: journal abandoned the sector at slot %u, continuing at slot %u\n",
                    static_cast<unsigned>(from_slot), static_cast<unsigned>(to_slot));
}

// An append failed at `slot`. The service retries on the next poll tick, and used to do so forever
// at the same slot with one diag line per tick (the 6 KB diag ring then holds nothing else) while
// the cursor never moved and nothing after it was persisted (HIST-02/c). Now: the first failure of
// an episode is logged, the second consecutive one at the same slot abandons that sector
// (logic::history_journal_failure_step), and the recovery is logged once. An episode may abandon
// only HISTORY_JOURNAL_MAX_ABANDONED_SECTORS sectors: every landing sector is erased, so an
// unbounded sweep would erase the whole retained history. After that the cursor stays on the
// failing slot, one diag line says so, and the service retries once a minute (the throttle at the
// top of history_flash_service_journal) until an append succeeds.
void flash_note_append_failure(size_t slot, esp_err_t e, const logic::HistoryJournalHeader& h) {
    if (slot != s_flash_fail_slot) {
        // A failure at a slot other than the previous one: either the first of the episode, or the
        // cursor moved by itself — flash_prepare_next_slot sacrifices the rest of a sector whose
        // slot was programmed but never committed and lands on the next sector's first slot. That
        // is an abandoned sector just like a skip below (our own skip clears the slot, so it is not
        // counted twice) and it counts against the same budget.
        if (s_flash_fail_slot != SIZE_MAX) flash_count_abandoned_sector(s_flash_fail_slot, slot);
        s_flash_fail_slot  = slot;
        s_flash_fail_count = 0;
    }
    if (s_flash_fail_count < UINT8_MAX) s_flash_fail_count++;
    if (s_flash_fail_total < UINT16_MAX) s_flash_fail_total++;
    if (!s_flash_fail_episode) {
        s_flash_fail_episode = true;
        diag_printf("history: journal %s append failed at slot %u (%s) — retrying; repeats stay "
                    "silent until it recovers\n",
                    flash_is_manifest(h) ? "manifest" : "record", static_cast<unsigned>(slot),
                    esp_err_to_name(e));
    }
    const logic::HistoryJournalFailureStep step =
        logic::history_journal_failure_step(slot, s_flash_fail_count, s_flash_fail_skipped);
    if (step.paused) {
        s_flash_fail_last_us = esp_timer_get_time();
        if (!s_flash_fail_paused) {
            s_flash_fail_paused = true;
            diag_printf("history: journal paused after %u abandoned sectors; retrying every %u s\n",
                        static_cast<unsigned>(s_flash_fail_skipped),
                        static_cast<unsigned>(logic::HISTORY_JOURNAL_PAUSED_RETRY_S));
        }
        return; // the cursor stays on the failing slot
    }
    if (step.next_slot == slot) return;
    s_flash_next_slot  = step.next_slot;
    s_flash_fail_slot  = SIZE_MAX;
    s_flash_fail_count = 0;
    flash_count_abandoned_sector(slot, step.next_slot);
}

void flash_note_append_success(size_t slot) {
    if (s_flash_fail_episode)
        diag_printf("history: journal append recovered at slot %u after %u failed attempt(s), "
                    "%u sector(s) abandoned\n",
                    static_cast<unsigned>(slot), static_cast<unsigned>(s_flash_fail_total),
                    static_cast<unsigned>(s_flash_fail_skipped));
    s_flash_fail_slot    = SIZE_MAX;
    s_flash_fail_count   = 0;
    s_flash_fail_episode = false;
    s_flash_fail_total   = 0;
    s_flash_fail_skipped = 0;
    s_flash_fail_paused  = false;
    s_flash_fail_last_us = INT64_MIN;
}

esp_err_t flash_append_record(FlashJournalRecord& r) {
    size_t          slot = 0;
    const esp_err_t e    = flash_append_record_at(r, slot);
    if (e == ESP_OK) {
        flash_note_append_success(slot);
        // The ONLY place an ahead-of-the-clock episode ends: the source appended data again. A
        // manifest says nothing about the cursor, and a "no longer ahead" observation must not
        // end it either (see s_flash_ahead_logged).
        if (!flash_is_manifest(r.header)) s_flash_ahead_logged[r.header.source] = false;
    } else {
        flash_note_append_failure(slot, e, r.header);
    }
    return e;
}

// Log, once per source and episode, that its append cursor lies beyond its clock. Called with
// s_flash_mtx held and s_mtx NOT held: the builder has returned, and diag_printf (the diag-ring
// mutex, console I/O) never runs inside a history critical section.
void flash_note_cursor_ahead(size_t src_i, const FutureCursorNote& note) {
    if (s_flash_ahead_logged[src_i]) return;
    s_flash_ahead_logged[src_i] = true;
    diag_printf("history: journal source %u is ahead of the clock (bucket %lld > %lld) — flash "
                "persistence for it waits until the clock passes; nothing is rewritten\n",
                static_cast<unsigned>(src_i), static_cast<long long>(note.cursor),
                static_cast<long long>(note.bound));
}

// The restore's counterpart: one line per source and boot when the newest bucket the scan indexed
// lies beyond the synchronised wall bucket. Nothing is changed. The trend splice refuses the whole
// snapshot and checkup_flash_restore refuses the hours beyond the clock one by one (it restores
// in-window hours only when the boot scan indexed them, i.e. within a day below the newest stamped
// hour), exactly as they always did, and the journal is not
// re-indexed or rewritten, because it cannot tell stamps from a wrong far-future boot from a wrong
// PAST clock now. Caller holds s_flash_mtx.
void flash_note_restore_ahead(size_t src_i, int64_t newest, int64_t wall_bucket) {
    if (s_flash_restore_ahead_logged[src_i] ||
        !logic::history_cursor_in_future(newest, wall_bucket))
        return;
    s_flash_restore_ahead_logged[src_i] = true;
    diag_printf("history: journal source %u has records stamped ahead of the clock (bucket %lld > "
                "%lld) — those are not restored\n",
                static_cast<unsigned>(src_i), static_cast<long long>(newest),
                static_cast<long long>(wall_bucket));
}

// The next record of source `src_i` for the journal service, or false. A cursor that is ahead of
// the source's clock yields false and one report (flash_note_cursor_ahead) — no rewind, no walk.
bool flash_build_for_service(size_t src_i, FlashJournalRecord& r, TickType_t wait_ticks) {
    FutureCursorNote note;
    const bool       built =
        src_i == static_cast<size_t>(logic::HistoryJournalSource::Checkup)
                  ? flash_build_next_checkup_record(r, wait_ticks, note)
                  : flash_build_next_record(static_cast<HistorySource>(src_i), r, wait_ticks, note);
    if (note.future) flash_note_cursor_ahead(src_i, note);
    return built;
}

} // namespace

// Move the restore to `ring`; it is complete once it has passed the last ring. Poll task only.
static void flash_restore_advance_to(size_t ring) {
    s_flash_restore_ring = ring;
    if (ring < kTotalRings) return;
    s_flash_restore_done = true;
    diag_printf("history: journal restore complete (%u/%u rings extended, 5-min raster)\n",
                static_cast<unsigned>(s_flash_restored_rings), static_cast<unsigned>(kTotalRings));
}

static void history_restore_checkup_flash() {
    if (s_flash_checkup_restore_done || !s_flash_mtx) return;
    const size_t src = static_cast<size_t>(logic::HistoryJournalSource::Checkup);
    static_assert(sizeof(CheckupFlashRecord) * logic::CHECKUP_COMPLETED_BUCKETS <=
                      sizeof(s_flash_sector),
                  "cold diagnostic restore reuses the 4 KiB journal scan scratch");
    auto* records = reinterpret_cast<CheckupFlashRecord*>(s_flash_sector);
    size_t count = 0;
    Lock flash_lk(s_flash_mtx, 0);
    if (!flash_lk.acquired()) return;
    // The index is newest-first. Replay oldest-first so checkup_flash_restore can resolve a
    // duplicate bucket by taking the later entry, matching the trend splice's rule.
    for (size_t k = s_flash_restore_slot_count[src]; k > 0; k--) {
        FlashJournalRecord r;
        const esp_err_t e = flash_read_record(s_flash_restore_slots[src][k - 1], r);
        if (e != ESP_OK) {
            diag_printf("checkup: flash restore stopped (%s)\n", esp_err_to_name(e));
            s_flash_checkup_restore_done = true;
            return;
        }
        if (!flash_record_valid(r) || r.header.source != src ||
            count >= logic::CHECKUP_COMPLETED_BUCKETS)
            continue;
        CheckupFlashRecord& out = records[count++];
        out.bucket = r.header.bucket;
        std::memcpy(&out.payload, r.payload, sizeof(out.payload));
    }
    int64_t unix_s = -1;
    int32_t ms     = 0;
    time_now(unix_s, ms);
    // Hours stamped beyond the wall hour are refused by checkup_flash_restore exactly as before;
    // the journal is not touched. Only say so, once.
    if (unix_s >= 0)
        flash_note_restore_ahead(src, s_flash_newest_bucket[src],
                                 logic::checkup_journal_bucket(unix_s));
    const CheckupFlashRestoreResult result =
        checkup_flash_restore(records, count, unix_s);
    if (result != CheckupFlashRestoreResult::Deferred)
        s_flash_checkup_restore_done = true;
}

// Restore at most four rings per poll tick. Each batch reads a source's indexed records once and
// transposes four values into ring-shaped blocks: at most HISTORY_SAMPLES slot reads of
// HISTORY_JOURNAL_SLOT_BYTES (~74 KiB), 2.3 KiB of static scratch and no heap allocation. A source
// whose indexed window lies beyond the wall bucket is restored from nothing (the splice refuses it)
// and reported once; it is never re-indexed or rewritten.
void history_service_flash_restore() {
    if (s_flash_forgotten.load() || !s_flash_scan_ok || !time_synced()) return;
    history_restore_checkup_flash();
    if (s_flash_restore_done) return;
    if (s_flash_restore_ring >= kTotalRings) { s_flash_restore_done = true; return; }

    size_t first_idx = 0;
    const HistorySource src = source_of_slot(s_flash_restore_ring, first_idx);
    if ((src == HistorySource::X10a && s_reset_requested.load()) ||
        (src == HistorySource::Modbus && s_mb_reset_requested.load())) {
        // Skip the WHOLE source instead of waiting for the reset to be consumed. A HomeHub disable
        // never consumes its reset, and an X10A bus that never resolves a profile (/detect or
        // /set_hp onto a dead bus) never does either; returning here left the restore stuck at this
        // ring for good, so s_flash_restore_done stayed false and history_flash_service_journal
        // appended nothing for ANY source until the next reboot. history_reset() and
        // history_modbus_reset() clear the source's restore index together with arming the reset,
        // so there is nothing to restore for it in this boot anyway. (history_reset_on_detect() for
        // an UNCHANGED unit keeps its index, but that reset is consumed by the very poll cycle that
        // armed it; a restore tick that does catch it pending only forgoes this source for this
        // boot — its records stay in the journal for the next one — instead of stalling the rest.)
        diag_printf("history: journal restore skips source %u (its identity reset is pending)\n",
                    static_cast<unsigned>(src));
        flash_restore_advance_to(logic::history_restore_next_source_ring(s_flash_restore_ring));
        return;
    }
    const size_t source_rings = logic::history_journal_source_rings(journal_source(src));
    size_t batch = source_rings - first_idx;
    if (batch > kRestoreRingsPerTick) batch = kRestoreRingsPerTick;
    for (size_t b = 0; b < batch; b++)
        for (size_t i = 0; i < HISTORY_SAMPLES; i++)
            s_flash_restore_blocks[b][i] = HISTORY_NO_READING;

    const size_t  src_i       = static_cast<size_t>(src);
    const int64_t newest      = s_flash_newest_bucket[src_i];
    bool          read_failed = false;
    // HIST-01/b: the identity the circulation column may be restored under, read once for the whole
    // batch, and whether any record of it has fed this batch's block yet. A record is X10A-scoped,
    // but its circulation column belongs to the external witness it names; the other columns of the
    // same record are restored regardless.
    const uint32_t circ_now                       = s_circulation_fp.load();
    const bool     circ_pending                   = s_circulation_reset_requested.load();
    bool           circ_fed[kRestoreRingsPerTick] = {};
    if (newest != INT64_MIN) {
        Lock flash_lk(s_flash_mtx, 0);
        if (!flash_lk.acquired()) return;
        if (s_flash_forgotten.load()) return;
        // HIST-02/b: a window stamped beyond the wall clock is not restored — the splice below
        // refuses a snapshot newer than the live ring, as it always did — and not re-indexed
        // either: the journal cannot tell a wrong far-future boot from a wrong PAST clock now. The
        // latch makes the line once per source and boot, however many batches the source takes.
        int64_t unix_s = -1;
        int32_t ms     = 0;
        time_now(unix_s, ms);
        if (unix_s >= 0)
            flash_note_restore_ahead(src_i, newest, logic::history_bucket_from_unix(unix_s));
        const int64_t oldest = newest - static_cast<int64_t>(HISTORY_SAMPLES - 1);
        // Index is newest-first; replay oldest-first so a newer duplicate bucket wins defensively.
        for (size_t k = s_flash_restore_slot_count[src_i]; k > 0; k--) {
            FlashJournalRecord r;
            const esp_err_t e = flash_read_record(s_flash_restore_slots[src_i][k - 1], r);
            if (e != ESP_OK) { read_failed = true; break; }
            if (!flash_record_valid(r) || r.header.bucket < oldest || r.header.bucket > newest)
                continue;
            const size_t pos = static_cast<size_t>(r.header.bucket - oldest);
            const uint32_t record_circulation =
                logic::history_journal_circulation_identity(r.header);
            for (size_t b = 0; b < batch; b++) {
                const bool x10a = src == HistorySource::X10a;
                if (x10a && !logic::history_x10a_column_restorable(
                                first_idx + b, record_circulation, circ_now, circ_pending))
                    continue;
                const int stored = flash_record_stored_index(r.header, first_idx + b);
                if (stored < 0 || static_cast<size_t>(stored) >= r.header.value_count) continue;
                HistorySample sample = HISTORY_NO_READING;
                std::memcpy(&sample,
                            r.payload + static_cast<size_t>(stored) * sizeof(HistorySample),
                            sizeof(sample));
                s_flash_restore_blocks[b][pos] = sample;
                if (x10a && logic::history_trend_is_circulation(first_idx + b)) circ_fed[b] = true;
            }
        }
    }
    if (read_failed) {
        s_flash_restore_done = true;
        diag_printf("history: journal restore stopped (flash read failed)\n");
        return;
    }

    if (newest != INT64_MIN) {
        const size_t start = logic::history_flash_restore_start(
            s_flash_oldest_bucket[src_i], newest, HISTORY_SAMPLES);
        for (size_t b = 0; b < batch; b++) {
            // A circulation column with no record of the current witness has nothing to restore;
            // splicing its all-gap block would only dress the ring up as a restored one.
            if (src == HistorySource::X10a && logic::history_trend_is_circulation(first_idx + b) &&
                !circ_fed[b])
                continue;
            if (start < HISTORY_SAMPLES &&
                history_splice_snapshot(src, first_idx + b, s_flash_restore_blocks[b] + start,
                                        HISTORY_SAMPLES - start, 1, newest, circ_now))
                s_flash_restored_rings++;
        }
    }
    flash_restore_advance_to(s_flash_restore_ring + batch);
}

static size_t history_flash_service_journal(size_t max_records, TickType_t wait_ticks) {
    if (!s_flash_part || !s_flash_mtx || !s_flash_scan_ok || s_flash_forgotten.load() ||
        !s_flash_restore_done || !time_synced()) return 0;
    Lock flash_lk(s_flash_mtx, wait_ticks);
    if (!flash_lk.acquired()) return 0;
    // The button task may have requested the wipe after the optimistic check but while this service
    // was waiting for the flash owner. Never append after the erase completed.
    if (s_flash_forgotten.load()) return 0;
    // A failure episode that spent its abandon budget pauses the whole journal (the cursor is one
    // shared position): one attempt per HISTORY_JOURNAL_PAUSED_RETRY_S, none in between.
    if (!logic::history_journal_retry_due(s_flash_fail_paused, esp_timer_get_time(),
                                          s_flash_fail_last_us))
        return 0;

    size_t written = 0;
    while (written < max_records) {
        bool appended = false;
        for (size_t try_src = 0; try_src < kJournalSources; try_src++) {
            const size_t src_i = (s_flash_service_source + try_src) % kJournalSources;
            // Profile detection can legitimately take minutes while X10A is unavailable. Keep the
            // independent trend sources durable during that wait, but never append a diagnostic
            // record ahead of its one-shot restore or it could become the apparent journal head.
            if (src_i == static_cast<size_t>(logic::HistoryJournalSource::Checkup) &&
                !s_flash_checkup_restore_done)
                continue;
            FlashJournalRecord r;
            if (!flash_build_for_service(src_i, r, wait_ticks)) continue;
            if (src_i < 3 &&
                flash_manifest_due(static_cast<HistorySource>(src_i), r.header.bucket)) {
                const int64_t manifest_bucket = r.header.bucket;
                // Reuse the one 256-byte stack record. Keeping the already-built data record beside
                // a manifest would consume another 256 bytes on poll's measured tight stack; the
                // same data bucket is rebuilt on the next loop after this durable schema barrier.
                if (!flash_build_manifest_record(
                        static_cast<HistorySource>(src_i), manifest_bucket, r)) {
                    diag_printf("history: catalog manifest build failed for source %u\n",
                                static_cast<unsigned>(src_i));
                    return written;
                }
                // A failure is accounted (and, once per episode, logged) inside
                // flash_append_record; the early return stays so a failing slot costs one attempt
                // per tick, not three.
                if (flash_append_record(r) != ESP_OK) return written;
                written++;
                appended = true;
                // Keep this source selected: the data vector whose manifest was just committed is
                // still pending and must follow before another source consumes the bounded budget.
                s_flash_service_source = src_i;
                break;
            }
            if (flash_append_record(r) != ESP_OK) return written;
            written++;
            appended = true;
            s_flash_service_source = (src_i + 1) % kJournalSources;
            break;
        }
        if (!appended) break;
    }
    return written;
}

// Eligible completed buckets are queued for journal draining. The shutdown handler provides a
// bounded additional drain before an intentional restart; it never rewrites a ~30 KiB snapshot.
//
// It also gives the liveness record its last sign of life, first and whether or not a journal
// exists. The wait is short: a restart that has already switched the boot partition must never be
// stranded behind a contended history lock. A missed touch leaves an unmeasured interval between
// the last successful update and reset; the fixed allowance need not cover that entire interval.
void history_flash_save() {
    if (s_mtx) {
        Lock lk(s_mtx, pdMS_TO_TICKS(50));
        if (lk.acquired()) logic::history_liveness_touch(s_liveness, esp_timer_get_time());
    }
    if (!s_flash_part || s_flash_shutdown_started || s_flash_forgotten.load()) return;
    s_flash_shutdown_started = true;
    const size_t written = history_flash_service_journal(/*max_records=*/12, pdMS_TO_TICKS(200));
    if (written)
        diag_printf("history: journal flushed %u record(s) before reboot\n",
                    static_cast<unsigned>(written));
}

// The factory reset deletes the user's configuration; the plant history it recorded is theirs too.
// Erasing all 4 MiB costs one cycle per sector and is deliberately reserved for this explicit action.
bool history_flash_forget() {
    s_flash_forgotten.store(true);
    // Readers are suppressed immediately, even if the subsequent physical erase fails. Retire
    // browser leases at that privacy boundary rather than letting them display the forgotten data.
    bump_history_epoch();
    const auto wipe_ram_and_index = []() {
        if (!s_mtx) return false;
        Lock history_lk(s_mtx);
        if (!history_lk.acquired()) return false;
        persist_wipe(logic::history_catalog_fingerprint(), s_x10a_target_fp.load(),
                     s_mb_target_fp.load(), s_circulation_fp.load(), s_env3_enabled);
        s_bucket = s_mb_bucket = s_env3_bucket = 0;
        s_have_bucket = s_mb_have_bucket = s_env3_have_bucket = false;
        s_last_commit_us = s_mb_last_commit_us = s_env3_last_commit_us = kNoCommitUs;
        s_last_commit_bucket = s_mb_last_commit_bucket = s_env3_last_commit_bucket = -1;
        // Nothing is left to measure: every raster starts over, like a boot with no samples.
        logic::history_liveness_begin(s_liveness, esp_timer_get_time());
        s_reset_requested.store(false);
        s_mb_reset_requested.store(false);
        s_circulation_reset_requested.store(false);
        s_adopt_detect_grace = false;
        s_persist_verdict = logic::HistoryRestore::NoRecord;

        // The index describes the bytes just erased. Clear it too so a request in the short
        // interval before reboot cannot splice an old slot back into the now-empty RAM rings.
        for (size_t src = 0; src < kJournalSources; ++src) {
            s_flash_last_bucket[src] = INT64_MIN;
            s_flash_newest_bucket[src] = INT64_MIN;
            s_flash_oldest_bucket[src] = INT64_MIN;
            s_flash_restore_slot_count[src] = 0;
            forget_adopt_floor(src);
        }
        flash_manifest_cache_reset();
        s_flash_restore_done = true;
        s_flash_checkup_restore_done = true;
        s_flash_scan_ok = false;
        return true;
    };

    if (!s_flash_part) return wipe_ram_and_index(); // no compatible journal exists to erase
    if (!s_flash_mtx) return false;
    // Flash service takes flash -> history in that order while building a record. Keep the same
    // order here: once this lock is ours no stale record can be appended after the erase, and once
    // the history lock is ours no producer can refill the RAM region after it is wiped.
    Lock flash_lk(s_flash_mtx);
    if (!flash_lk.acquired()) return false;
    esp_err_t e = ESP_FAIL;
    for (int attempt = 1; attempt <= 3 && e != ESP_OK; ++attempt) {
        e = esp_partition_erase_range(s_flash_part, 0, s_flash_part->size);
        if (e != ESP_OK)
            diag_printf("history: journal erase attempt %d/3 failed (%s)\n",
                        attempt, esp_err_to_name(e));
    }
    if (e != ESP_OK) return false;                 // remain forgotten; never append on the way out
    return wipe_ram_and_index();
}

static void history_flash_start() {
    s_flash_part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "history");
    if (s_flash_part && (s_flash_part->address != logic::HISTORY_FLASH_PARTITION_OFFSET ||
                         s_flash_part->size != logic::HISTORY_FLASH_PARTITION_BYTES)) {
        diag_printf("history: wrong partition geometry at 0x%x (%u bytes) — ignored\n",
                    static_cast<unsigned>(s_flash_part->address),
                    static_cast<unsigned>(s_flash_part->size));
        s_flash_part = nullptr;
    }
    if (!s_flash_part) {
        diag_printf("history: official 4 MiB partition unavailable — install the 8 MB table\n");
        return;
    }
    s_flash_mtx = xSemaphoreCreateMutex();
    if (!s_flash_mtx) {
        diag_printf("history: journal mutex alloc failed — flash persistence disabled\n");
        s_flash_part = nullptr;
        return;
    }
    s_flash_scan_ok = flash_journal_scan();
    if (!s_flash_scan_ok) {
        diag_printf("history: journal disabled this boot (scan incomplete)\n");
        return;
    }
}

} // namespace daik
