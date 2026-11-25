#include "hydronic_observation_store.hpp"
#include "rtos_guard.hpp"
#include "sntp_time.hpp"
#include "esp_timer.h"
#include <atomic>
#include <climits>
#include <new>
#include <type_traits>

namespace daik {
namespace {
namespace hydronic_store {
using namespace logic;
std::atomic<SemaphoreHandle_t> s_mutex{nullptr};
std::atomic<bool>              s_forget_latched{false};
static_assert(std::atomic<SemaphoreHandle_t>::is_always_lock_free &&
                  std::atomic<bool>::is_always_lock_free,
              "early privacy/read paths must not allocate or acquire a hidden atomic lock");
SemaphoreHandle_t   store_mutex() { return s_mutex.load(std::memory_order_acquire); }
ObservationIdentity s_identity;
uint32_t            s_source_generation = 0, s_epoch = 0;
bool                s_enabled = false, s_confirmed = false, s_sealed = false;
bool                s_restore_pending = true, s_restore_blocked = false, s_barrier_pending = false;
bool                s_clock_bad     = false;
int64_t             s_clock_last_us = -1, s_offset_us = INT64_MIN, s_last_sample_us = -1;
int64_t             s_open_bucket = INT64_MIN;
// Private inactive images keep typed objects alive from constant initialization in .bss. Start
// installs canonical live defaults before publishing the mutex; scratch is consumed only
// after a complete successful reader admission and is never reset by clear_live().
constexpr HydronicHourlyPayload kInactivePayload = [] {
    HydronicHourlyPayload p;
    p.first_unix_us = p.last_unix_us = 0;
    p.first_accepted_unix_us = p.last_accepted_unix_us = 0;
    p.kind                                             = static_cast<HydronicHourlyKind>(0);
    return p;
}();
HydronicHourlyPayload s_open = kInactivePayload;
struct Queued {
    HydronicHourlyPayload payload;
    int64_t               bucket  = INT64_MIN;
    uint32_t              token   = 0;
    bool                  claimed = false;
};
// Named immutable defaults avoid forming full nonzero-default payloads on caller stacks.
constexpr HydronicHourlyPayload     kEmptyPayload{};
constexpr Queued                    kEmptyQueued{};
constexpr HydronicObservationReport kEmptyReport{};

constexpr Queued                    kInactiveQueued{kInactivePayload, 0, 0, false};
constexpr HydronicObservationReport kInactiveReport = [] {
    HydronicObservationReport r;
    r.totals.first_evidence_unix_us = r.totals.last_evidence_unix_us = 0;
    r.totals.first_accepted_unix_us = r.totals.last_accepted_unix_us = 0;
    r.minimum_windows.first_bucket                                   = 0;
    r.partial = r.restore_pending = false;
    return r;
}();
static_assert(OBSERVATION_QUEUE_CAP == 4, "each private inactive queue entry must be explicit");
Queued   s_queue[OBSERVATION_QUEUE_CAP] = {kInactiveQueued, kInactiveQueued, kInactiveQueued,
                                           kInactiveQueued};
uint32_t s_token = 0, s_claim_token = 0;
bool     s_claim_barrier                     = false;
HydronicObservationReport s_completed        = kInactiveReport;
int64_t                   s_completed_expiry = INT64_MIN, s_archive_first_bucket = INT64_MIN;
int64_t                   s_archive_wake_us = 0;
constexpr size_t          kArchiveHours     = HYDRONIC_WINDOW_HOURS;
constexpr uint8_t         kFirstSample = 4, kLastSample = 8;
static_assert(OBSERVATION_HOUR_US < UINT32_MAX, "archive offsets must fit within uint32");
struct ArchiveEdges {
    uint32_t first_plus_one[kArchiveHours]; // zero marks a missing hour
    uint32_t last[kArchiveHours];
    uint8_t  membership[kArchiveHours]; // duration bits plus accepted points at the two edges
};
// The History flash mutex serializes staging. Publication copies the edges and aggregate
// together under the Store lock, after checking the same epoch.
ArchiveEdges              s_archive, s_staged_archive;
HydronicObservationReport s_staged_report  = kInactiveReport;
uint16_t                  s_dropped        = 0;
bool                      s_drop_saturated = false;
// Only the exclusive flash owner touches this index or scratch. Producer/report never read
// physical flash and use only the mutex-protected closed aggregate and their live deltas.
// Keep the zero-byte member active until the exclusive flash owner needs the index. Its
// first hook may run before Start. Placement construction preserves the exact shared index
// defaults without a flash-backed initializer or a full automatic index temporary.
union HydronicIndexStorage {
    unsigned char    bytes[sizeof(ObservationIndex)];
    ObservationIndex index;
    constexpr HydronicIndexStorage() : bytes{} {}
};
static_assert(sizeof(HydronicIndexStorage) == sizeof(ObservationIndex) &&
                  alignof(HydronicIndexStorage) >= alignof(ObservationIndex) &&
                  std::is_trivially_destructible<ObservationIndex>::value &&
                  std::is_trivially_destructible<HydronicIndexStorage>::value,
              "flash-owner index storage must preserve alignment and trivial destruction");
HydronicIndexStorage s_index_storage;
bool s_index_ready = false; // exclusive flash owner only, including initialization/reset
ObservationIndex& flash_index_state(bool reset = false) {
    if (reset || !s_index_ready) {
        auto* index   = ::new (&s_index_storage.index) ObservationIndex;
        s_index_ready = true;
        return *index;
    }
    return s_index_storage.index; // only the explicitly constructed active union member
}
HydronicHourlyPayload s_hydronic_flash_payload = kInactivePayload;
bool                  s_rebuild                = true;
enum class ReceiptResult : uint8_t { Retry, Appended, Rejected };
struct Receipt {
    uint32_t      token = 0, epoch = 0;
    bool          barrier = false;
    ReceiptResult result  = ReceiptResult::Retry;
    bool          pending = false;
};
Receipt s_receipt, s_transaction;

int64_t wall_now() {
    if (!time_synced()) return -1;
    int64_t seconds = -1;
    int32_t ms      = 0;
    time_now(seconds, ms);
    if (seconds < 0 || seconds > (INT64_MAX - 999999) / 1000000 || ms < 0 || ms > 999) return -1;
    return seconds * 1000000 + ms * 1000;
}
void clear_live() {
    s_open        = kEmptyPayload;
    s_open_bucket = INT64_MIN;
    for (auto& q : s_queue) q = kEmptyQueued;
    s_last_sample_us   = -1;
    s_completed        = kEmptyReport;
    s_completed_expiry = s_archive_first_bucket = INT64_MIN;
    s_archive_wake_us                           = 0;
    s_claim_token                               = 0;
    s_claim_barrier                             = false;
    s_sealed                                    = false;
    s_dropped                                   = 0;
    s_drop_saturated                            = false;
    ++s_epoch;
}
void restart_clock() {
    s_offset_us     = INT64_MIN;
    s_clock_bad     = false;
    s_clock_last_us = -1;
}
void invalidate_clock() {
    // Never retime previously collected hours onto a replacement wall/monotonic projection.
    clear_live();
    s_clock_bad       = true;
    s_restore_blocked = true;
    s_restore_pending = true;
    s_barrier_pending = s_enabled && s_confirmed;
}
bool date_clock(int64_t now_us, int64_t now_wall) {
    if (s_clock_bad || now_us < 0 || now_wall < now_us) return false;
    if (s_clock_last_us >= 0 && now_us < s_clock_last_us) {
        invalidate_clock();
        return false;
    }
    const int64_t offset = now_wall - now_us;
    if (s_offset_us == INT64_MIN) s_offset_us = offset;
    const int64_t delta = offset > s_offset_us ? offset - s_offset_us : s_offset_us - offset;
    if (delta > 2000000) {
        invalidate_clock();
        return false;
    }
    s_clock_last_us = now_us;
    return true;
}
int64_t dated(int64_t us) {
    return us >= 0 && s_offset_us >= 0 && us <= INT64_MAX - s_offset_us ? us + s_offset_us : -1;
}
void lose() {
    if (s_dropped < UINT16_MAX)
        ++s_dropped;
    else
        s_drop_saturated = true;
}
bool enqueue(int64_t bucket, const HydronicHourlyPayload& p) {
    if (!hydronic_hourly_valid(p, bucket)) {
        lose();
        return false;
    }
    for (auto& q : s_queue) {
        if (q.bucket != bucket || q.claimed ||
            !observation_identity_equal(q.payload.identity, p.identity))
            continue;
        if (hydronic_hourly_merge(q.payload, p)) return true;
        lose();
        return false;
    }
    for (auto& q : s_queue) {
        if (q.bucket != INT64_MIN) continue;
        q.payload = p;
        q.bucket  = bucket;
        q.token   = ++s_token;
        if (!q.token) q.token = ++s_token;
        return true;
    }
    lose(); // durable lower-bound watermark accompanies every later successful data append
    return false;
}
void close_open() {
    if (s_open_bucket == INT64_MIN) return;
    if (s_open.observed_us < static_cast<uint64_t>(OBSERVATION_HOUR_US))
        s_open.flags |= HYDRONIC_HOUR_PARTIAL;
    enqueue(s_open_bucket, s_open);
    s_open        = kEmptyPayload;
    s_open_bucket = INT64_MIN;
}
void expire_live(int64_t now_wall) {
    if (s_open_bucket != INT64_MIN && observation_bucket(now_wall) > s_open_bucket) close_open();
    for (auto& q : s_queue)
        if (q.bucket != INT64_MIN && !observation_in_window(q.bucket, now_wall) && !q.claimed)
            q = kEmptyQueued;
    if ((s_completed_expiry != INT64_MIN && now_wall >= s_completed_expiry) ||
        (now_wall >= 0 && s_completed.totals.last_evidence_unix_us > now_wall)) {
        // Expiry and a tolerated UTC rollback can both make the published archive inadmissible.
        // Withdraw its sums and edges together. The flash owner rebuilds and schedules any
        // deferred records using their original dates.
        s_completed        = kEmptyReport;
        s_completed_expiry = s_archive_first_bucket = INT64_MIN;
        s_restore_pending                           = true;
    }
}
void open_at(int64_t first, int64_t last, uint8_t duration_edges) {
    const int64_t bucket = observation_bucket(first);
    if (s_open_bucket != bucket) {
        close_open();
        s_open_bucket   = bucket;
        s_open.identity = s_identity;
    }
    hydronic_extend_evidence(s_open.first_unix_us, s_open.last_unix_us, s_open.duration_edges,
                             first, last, duration_edges);
}
bool delta_valid(const HydronicDelta& d) {
    if (d.to_us < 0 || d.from_us < -1 || (d.from_us >= 0 && d.from_us >= d.to_us) ||
        (d.limitations & ~HYDRONIC_KNOWN_LIMITATIONS) ||
        (d.agree_limitations & ~AGREEMENT_KNOWN_LIMITATIONS) ||
        static_cast<unsigned>(d.reason) > static_cast<unsigned>(HydronicReason::Overflow) ||
        static_cast<unsigned>(d.agree_reason) > static_cast<unsigned>(AgreementReason::Overflow) ||
        d.command_accepted > d.accepted || d.r1_r4_window_started > d.r1_r4_accepted ||
        d.r2_r1_window_started > d.r2_r1_accepted)
        return false;
    if (d.observed_us || d.candidate_us || d.qualified_us || d.r1_r4_qualified_us ||
        d.r2_r1_qualified_us) {
        if (d.from_us < 0 || d.from_us >= d.to_us || d.to_us - d.from_us > HYDRONIC_MAX_GAP_US)
            return false;
        const uint64_t dt = static_cast<uint64_t>(d.to_us - d.from_us);
        // Tracker intervals are wholly admitted or absent for each independent duration.
        // An arbitrary partial duration does not locate a real subinterval at an hour seam.
        if ((d.observed_us && d.observed_us != dt) || (d.candidate_us && d.candidate_us != dt) ||
            (d.qualified_us && d.qualified_us != dt) ||
            (d.r1_r4_qualified_us && d.r1_r4_qualified_us != dt) ||
            (d.r2_r1_qualified_us && d.r2_r1_qualified_us != dt) ||
            d.candidate_us > d.observed_us || d.qualified_us > d.candidate_us ||
            d.r1_r4_qualified_us > d.observed_us || d.r2_r1_qualified_us > d.observed_us)
            return false;
    }
    if (d.r1_r4_accepted &&
        (d.r1_r4_milli < -HYDRONIC_SPREAD_MAX_MILLI || d.r1_r4_milli > HYDRONIC_SPREAD_MAX_MILLI))
        return false;
    if (d.r2_r1_accepted &&
        (d.r2_r1_milli < -HYDRONIC_SPREAD_MAX_MILLI || d.r2_r1_milli > HYDRONIC_SPREAD_MAX_MILLI))
        return false;
    return !d.accepted ||
           (d.spread_milli >= -HYDRONIC_SPREAD_MAX_MILLI &&
            d.spread_milli <= HYDRONIC_SPREAD_MAX_MILLI && d.flow_milli > 0 &&
            d.flow_milli <= HYDRONIC_FLOW_MAX_MILLI &&
            (!d.command_accepted ||
             (d.command_milli >= 0 && d.command_milli <= HYDRONIC_COMMAND_MAX_MILLI)));
}
void reanchor_minimum_windows(HydronicMinimumWindows& windows, int64_t first_bucket) {
    if (first_bucket == windows.first_bucket) return;
    const int64_t     shift = first_bucket - windows.first_bucket;
    constexpr int64_t hours = kArchiveHours;
    auto&             masks = windows.masks;
    if (windows.first_bucket < 0 || shift >= hours || shift <= -hours) {
        std::memset(masks, 0, sizeof(masks));
    } else if (shift > 0) {
        std::memmove(masks, masks + shift, (hours - shift) * sizeof(*masks));
        std::memset(masks + hours - shift, 0, shift * sizeof(*masks));
    } else {
        std::memmove(masks - shift, masks, (hours + shift) * sizeof(*masks));
        std::memset(masks, 0, -shift * sizeof(*masks));
    }
    windows.first_bucket = first_bucket;
}
void add_report(HydronicObservationReport& into, const HydronicHourlyPayload& p) {
    if (p.samples && (!into.totals.samples || p.flow.min_milli <= into.totals.flow.min_milli)) {
        auto& windows = into.minimum_windows;
        if (!into.totals.samples || p.flow.min_milli < into.totals.flow.min_milli) {
            std::memset(windows.masks, 0, sizeof(windows.masks));
            windows.locations_missing = false;
        }
        const int64_t hour = observation_bucket(p.first_unix_us) - windows.first_bucket;
        if (windows.first_bucket >= 0 && hour >= 0 && hour < static_cast<int64_t>(kArchiveHours))
            windows.masks[hour] |= p.flow_min_evidence & HYDRONIC_MINIMUM_SLOTS;
        else
            windows.locations_missing = true;
        windows.locations_missing |= (p.flow_min_evidence & HYDRONIC_MINIMUM_LOCATION_MISSING) != 0;
    }
    hydronic_totals_add(into.totals, p);
    into.partial |= p.flags != 0;
    if (p.dropped > into.dropped) into.dropped = p.dropped;
}
HydronicReadResult read_hydronic_entry(HydronicObservationReader    reader,
                                       const ObservationIndexEntry& e, HydronicHourlyPayload& p) {
    int64_t  bucket   = INT64_MIN;
    uint64_t sequence = 0;
    if (!reader) return HydronicReadResult::Retry;
    const auto result = reader(e.slot(), bucket, sequence, p);
    if (result != HydronicReadResult::Valid) return result;
    return bucket == e.bucket() && sequence == e.sequence() && hydronic_hourly_valid(p, bucket) &&
                   p.kind == HydronicHourlyKind::Data
               ? HydronicReadResult::Valid
               : HydronicReadResult::Invalid;
}
void apply_receipt() {
    if (hydronic_observation_suppressed()) {
        s_receipt.pending = false;
        return;
    }
    if (!s_receipt.pending) return;
    if (s_receipt.epoch == s_epoch) {
        const bool appended = s_receipt.result == ReceiptResult::Appended;
        if (s_receipt.barrier) {
            if (appended) {
                s_barrier_pending = false;
                s_restore_blocked = false;
            }
            s_claim_barrier = false;
        } else {
            for (auto& q : s_queue) {
                if (q.token != s_receipt.token || !q.claimed) continue;
                if (s_receipt.result == ReceiptResult::Retry) {
                    q.claimed = false;
                } else {
                    if (!appended) lose(); // Permanent conflict: retain the archive, retire once.
                    q = kEmptyQueued;
                }
            }
            s_claim_token = 0;
        }
        if (appended) s_restore_pending = true;
        if (s_receipt.result != ReceiptResult::Retry) s_rebuild = true;
    }
    s_receipt.pending = false;
}
void finish_transaction(ReceiptResult result) {
    if (hydronic_observation_suppressed()) return;
    s_receipt         = s_transaction;
    s_receipt.result  = result;
    s_receipt.pending = true;
    SemGuard lk(store_mutex(), 0);
    if (lk) apply_receipt();
}
int archive_hour(int64_t bucket) {
    if (s_archive_first_bucket == INT64_MIN) return -1;
    const int64_t hour = bucket - s_archive_first_bucket;
    if (hour < 0 || hour >= static_cast<int64_t>(kArchiveHours) || !s_archive.first_plus_one[hour])
        return -1;
    return static_cast<int>(hour);
}
bool outside_archive_span(const HydronicHourlyPayload& payload, int hour) {
    if (hour < 0) return true;
    const int64_t start = (s_archive_first_bucket + hour) * OBSERVATION_HOUR_US;
    const int64_t first = start + s_archive.first_plus_one[hour] - 1;
    const int64_t last  = start + s_archive.last[hour];
    const uint8_t edges = s_archive.membership[hour];
    const bool    after = hydronic_evidence_before(
        last, edges & kLastSample ? last : -1, edges, payload.first_unix_us,
        payload.first_accepted_unix_us, payload.duration_edges);
    const bool before = hydronic_evidence_before(
        payload.last_unix_us, payload.last_accepted_unix_us, payload.duration_edges, first,
        edges & kFirstSample ? first : -1, edges);
    return before || after;
}
} // namespace hydronic_store
using namespace hydronic_store;
} // namespace

bool hydronic_observation_suppressed() { return s_forget_latched.load(std::memory_order_acquire); }
void hydronic_observation_start(bool enabled, uint32_t consent_generation) {
    if (hydronic_observation_suppressed()) return;
    // App startup is the sole creator. Publish only after initialization, while holding the
    // new mutex. Early recovery/readers safely observe null, and forget's separate atomic
    // intent survives a failed allocation or a race anywhere in this creation window.
    auto mutex = store_mutex();
    if (!mutex) mutex = xSemaphoreCreateMutex();
    SemGuard lk(mutex);
    if (!lk) return;
    clear_live();
    s_identity                    = {};
    s_identity.consent_generation = consent_generation;
    s_source_generation           = 0;
    s_enabled                     = enabled && !hydronic_observation_suppressed();
    s_confirmed                   = false;
    s_restore_pending             = s_enabled;
    s_restore_blocked = s_barrier_pending = false;
    restart_clock();
    s_mutex.store(mutex, std::memory_order_release);
}
void hydronic_observation_bind(uint32_t source_fp, uint32_t model_fp, uint32_t schema_fp,
                               uint32_t source_generation, bool allow_restore) {
    if (hydronic_observation_suppressed()) return;
    SemGuard lk(store_mutex());
    if (!lk || hydronic_observation_suppressed()) return;
    const ObservationIdentity next{source_fp, model_fp, schema_fp, s_identity.consent_generation};
    const bool                was_confirmed = s_confirmed;
    const bool changed = s_confirmed && (!observation_identity_equal(s_identity, next) ||
                                         s_source_generation != source_generation);
    if (changed || !allow_restore) {
        clear_live(); // including same-identity allow_restore=false: withdraw immediately
        restart_clock();
        s_restore_blocked = true;
        s_barrier_pending = true;
    }
    s_identity          = next;
    s_source_generation = source_generation;
    s_confirmed         = s_enabled && source_generation && observation_identity_valid(next);
    if (!was_confirmed || changed || !allow_restore) s_restore_pending = s_confirmed;
}
void hydronic_observation_set_diagnostics(bool enabled, uint32_t consent_generation) {
    if (hydronic_observation_suppressed()) return;
    SemGuard lk(store_mutex());
    if (!lk || hydronic_observation_suppressed()) return;
    // Same-generation pause/resume: keep completed/queued/open 24h buckets intact,
    // reset live sample continuity, and withdraw active confirmation while paused.
    if (consent_generation != 0 && consent_generation == s_identity.consent_generation) {
        s_last_sample_us = -1;
        s_sealed         = false;
        s_enabled        = enabled;
        s_confirmed      = enabled && s_source_generation && observation_identity_valid(s_identity);
        if (s_confirmed && s_rebuild) s_restore_pending = true;
        return;
    }
    clear_live();
    s_enabled                     = enabled;
    s_identity.consent_generation = consent_generation;
    s_confirmed                   = false;
    s_restore_blocked             = true;
    s_barrier_pending = s_restore_pending = enabled;
    restart_clock();
}
void hydronic_observation_reset() {
    if (hydronic_observation_suppressed()) return;
    SemGuard lk(store_mutex());
    if (!lk || hydronic_observation_suppressed()) return;
    clear_live();
    restart_clock();
    s_confirmed       = false;
    s_restore_blocked = true;
    s_barrier_pending = s_restore_pending = s_enabled;
}
void hydronic_observation_record(const logic::HydronicDelta& d) {
    if (hydronic_observation_suppressed()) return;
    SemGuard lk(store_mutex());
    if (!lk || hydronic_observation_suppressed() || !s_enabled || !s_confirmed || s_sealed) return;
    const int64_t now_us = esp_timer_get_time(), wall = wall_now();
    const bool    any_work = d.accepted || d.observed_us || d.r1_r4_accepted || d.r2_r1_accepted ||
                          d.r1_r4_qualified_us || d.r2_r1_qualified_us;
    if (!date_clock(now_us, wall)) {
        if (any_work) lose();
        return;
    }
    expire_live(wall);
    if (!delta_valid(d) || d.to_us > now_us ||
        (s_last_sample_us >= 0 &&
         (d.to_us <= s_last_sample_us ||
          ((d.observed_us || d.r1_r4_qualified_us || d.r2_r1_qualified_us) &&
           d.from_us < s_last_sample_us)))) {
        if (any_work) lose();
        return;
    }
    // bind() owns identity/generation fences. A tracker identity-change flag may accompany
    // that already-performed bind; the delta itself never guesses a persistent identity.
    const int64_t at = dated(d.to_us);
    if (at < 0 || !observation_in_window(observation_bucket(at), wall)) return;
    if (d.observed_us) {
        int64_t begin = dated(d.from_us);
        if (begin < 0) {
            lose();
            return;
        }
        while (begin < at) { // <=15 s admits at most two hour pieces
            const int64_t bucket = observation_bucket(begin);
            const int64_t edge   = (bucket + 1) * OBSERVATION_HOUR_US;
            const int64_t end    = at < edge ? at : edge;
            if (observation_in_window(bucket, wall)) {
                open_at(begin, end - 1, HYDRONIC_DUR_BOTH);
                const uint32_t duration = static_cast<uint32_t>(end - begin);
                s_open.observed_us += duration;
                if (d.candidate_us) s_open.candidate_us += duration;
                if (d.qualified_us) s_open.qualified_us += duration;
                if (d.r1_r4_qualified_us) s_open.r1_r4_qualified_us += duration;
                if (d.r2_r1_qualified_us) s_open.r2_r1_qualified_us += duration;
                s_open.limitations |= d.limitations;
                if (d.r1_r4_qualified_us || d.r2_r1_qualified_us)
                    s_open.agree_limitations |= d.agree_limitations;
            }
            begin = end;
        }
    }
    if (d.accepted) {
        if (s_open_bucket == observation_bucket(at) && s_open.samples == UINT32_MAX) {
            lose();
            s_open.limitations |= HydronicCounterSaturated;
        } else {
            open_at(at, at, 0);
            s_open.spread.fold(d.spread_milli, s_open.samples);
            if (!s_open.samples || d.flow_milli < s_open.flow.min_milli)
                s_open.flow_min_evidence = hydronic_minimum_slot(at);
            else if (d.flow_milli == s_open.flow.min_milli)
                s_open.flow_min_evidence |= hydronic_minimum_slot(at);
            s_open.flow.fold(d.flow_milli, s_open.samples);
            if (!s_open.samples) s_open.first_accepted_unix_us = at;
            s_open.last_accepted_unix_us = at;
            ++s_open.samples;
            if (d.command_accepted) {
                s_open.command.fold(d.command_milli, s_open.command_samples);
                ++s_open.command_samples;
            }
            s_open.limitations |= d.limitations;
        }
    }
    const auto record_agreement_pair = [&](bool accepted, bool window_started, int32_t value_milli,
                                           uint32_t& samples, uint16_t& windows,
                                           HydronicRange& range) {
        if (!accepted) return;
        if (s_open_bucket == observation_bucket(at) &&
            (samples == UINT32_MAX || (window_started && windows == UINT16_MAX))) {
            lose();
            s_open.agree_limitations |= AgreementCounterSaturated;
        } else {
            open_at(at, at, 0);
            range.fold(value_milli, samples);
            ++samples;
            if (window_started) ++windows;
            s_open.agree_limitations |= d.agree_limitations;
        }
    };
    record_agreement_pair(d.r1_r4_accepted, d.r1_r4_window_started, d.r1_r4_milli,
                          s_open.r1_r4_samples, s_open.r1_r4_windows, s_open.r1_r4);
    record_agreement_pair(d.r2_r1_accepted, d.r2_r1_window_started, d.r2_r1_milli,
                          s_open.r2_r1_samples, s_open.r2_r1_windows, s_open.r2_r1);
    if (s_open_bucket == observation_bucket(at) &&
        (d.agree_limitations & AgreementCounterSaturated))
        s_open.agree_limitations |= AgreementCounterSaturated;
    s_last_sample_us = d.to_us;
}
void hydronic_observation_seal() {
    if (hydronic_observation_suppressed()) return;
    SemGuard lk(store_mutex());
    if (!lk || hydronic_observation_suppressed()) return;
    close_open();
    s_sealed = true;
}
HydronicObservationReport hydronic_observation_report() {
    HydronicObservationReport r = kEmptyReport;
    if (hydronic_observation_suppressed()) {
        r.restore_pending = false;
        return r;
    }
    SemGuard lk(store_mutex());
    if (!lk) return r;
    if (hydronic_observation_suppressed()) {
        r.restore_pending = false;
        return r;
    }
    const int64_t wall    = wall_now();
    r.restore_pending     = s_restore_pending;
    r.persistence_pending = s_barrier_pending;
    if (!s_enabled || !s_confirmed) return r;
    r.confirmed = true;
    r.dropped   = s_dropped;
    if (!date_clock(esp_timer_get_time(), wall)) {
        r.restore_pending     = s_restore_pending;
        r.persistence_pending = s_barrier_pending;
        if (hydronic_observation_suppressed()) {
            r                 = kEmptyReport;
            r.restore_pending = false;
        }
        return r;
    }
    expire_live(wall);
    r           = s_completed;
    const int64_t first_bucket = observation_bucket(wall) - static_cast<int64_t>(kArchiveHours - 1);
    reanchor_minimum_windows(r.minimum_windows, first_bucket >= 0 ? first_bucket : 0);
    r.confirmed = r.dated = true;
    r.restore_pending     = s_restore_pending;
    r.persistence_pending = s_barrier_pending;
    r.partial |= s_restore_pending || s_clock_bad || s_dropped != 0;
    if (s_dropped > r.dropped) r.dropped = s_dropped;
    r.totals.saturated |= s_drop_saturated;
    r.totals.agree_saturated |= s_drop_saturated;
    if (s_drop_saturated) {
        r.totals.limitations |= HydronicCounterSaturated;
        r.totals.agree_limitations |= AgreementCounterSaturated;
    }
    if (observation_in_window(s_open_bucket, wall)) {
        const int archived = archive_hour(s_open_bucket);
        if (outside_archive_span(s_open, archived)) {
            add_report(r, s_open);
            if (archived < 0) ++r.observed_hours;
        } else {
            r.partial = true;
        }
    }
    for (const auto& q : s_queue) {
        if (!observation_in_window(q.bucket, wall)) continue;
        if (!outside_archive_span(q.payload, archive_hour(q.bucket))) {
            r.partial             = true;
            r.persistence_pending = true;
            continue;
        }
        add_report(r, q.payload);
        r.persistence_pending = true;
    }
    // observed_hours is a lower bound for completed hours plus a distinct open hour, never
    // a revision count. Missing hours and source gaps remain separate from sample means.
    r.partial |= r.totals.observed_us < static_cast<uint64_t>(OBSERVATION_DAY_US);
    if (hydronic_observation_suppressed()) {
        r                 = kEmptyReport;
        r.restore_pending = false;
    }
    return r;
}

void hydronic_observation_flash_index_reset() {
    // Preserve cleanup of an existing index after forget, without first constructing an
    // unused index for a suppressed boot.
    if (s_index_ready || !hydronic_observation_suppressed()) flash_index_state(true);
    s_rebuild = true;
    s_receipt = {};
}
void hydronic_observation_flash_index_incomplete() {
    if (hydronic_observation_suppressed()) return;
    observation_index_incomplete(flash_index_state());
    s_rebuild = true;
}
void hydronic_observation_flash_index(int64_t bucket, uint64_t sequence, uint16_t slot,
                                      const logic::HydronicHourlyPayload& payload) {
    if (hydronic_observation_suppressed()) return;
    if (!hydronic_hourly_valid(payload, bucket)) {
        hydronic_observation_flash_index_incomplete();
        return;
    }
    observation_index_add(flash_index_state(), bucket, sequence, slot,
                          payload.kind == HydronicHourlyKind::Fence ? &payload.identity : nullptr);
    s_rebuild = true;
}
void hydronic_observation_flash_service(HydronicObservationReader reader) {
    if (hydronic_observation_suppressed()) return;
    auto&               index = flash_index_state();
    int64_t             wall  = -1;
    ObservationIdentity identity;
    uint32_t            epoch;
    bool                blocked;
    {
        SemGuard lk(store_mutex(), 0);
        if (!lk || hydronic_observation_suppressed() || !s_enabled || !s_confirmed) return;
        wall = wall_now();
        if (!date_clock(esp_timer_get_time(), wall)) return;
        if (index.clipped && observation_bucket(wall) >= index.clipped_until_bucket) {
            index.clipped = false;
            s_rebuild     = true;
        }
        apply_receipt();
        expire_live(wall);
        if (!s_rebuild && !s_restore_pending &&
            (s_completed_expiry == INT64_MIN || wall < s_completed_expiry) &&
            (!s_archive_wake_us || wall < s_archive_wake_us))
            return;
        identity = s_identity;
        epoch    = s_epoch;
        blocked  = s_restore_blocked;
    }
    if (blocked) return;
    auto& rebuilt              = s_staged_report;
    rebuilt                    = kEmptyReport;
    rebuilt.partial            = index.clipped;
    rebuilt.restore_pending    = false;
    const int64_t wall_bucket  = observation_bucket(wall);
    const int64_t first_bucket = wall_bucket - static_cast<int64_t>(kArchiveHours - 1);
    rebuilt.minimum_windows.first_bucket = first_bucket >= 0 ? first_bucket : 0;
    for (auto& first : s_staged_archive.first_plus_one) first = 0;
    int64_t    expiry = INT64_MIN, wake = 0;
    const auto defer_until = [&wake](int64_t at) {
        if (!wake || at < wake) wake = at;
    };
    const uint64_t barrier     = observation_index_fence_sequence(index, identity);
    bool           read_failed = false;
    bool           retry       = false;
    for (size_t i = 0; i < index.count && !index.clipped && !hydronic_observation_suppressed();
         ++i) {
        const auto& e = index.entries[i];
        if (observation_index_is_fence(index, i) || e.sequence() <= barrier) continue;
        const int64_t bucket = e.bucket();
        if (bucket > wall_bucket) {
            // The index has only the bucket. Read the record once its hour can be admitted.
            defer_until(bucket * OBSERVATION_HOUR_US);
            continue;
        }
        if (!observation_in_window(bucket, wall)) continue;
        auto&      p      = s_hydronic_flash_payload;
        const auto result = read_hydronic_entry(reader, e, p);
        if (result == HydronicReadResult::Retry) {
            retry = true;
            break;
        }
        if (result == HydronicReadResult::Invalid) {
            read_failed = true;
            continue;
        }
        if (!observation_identity_equal(p.identity, identity)) continue;
        if (p.last_unix_us > wall) {
            defer_until(p.last_unix_us);
            continue;
        }
        add_report(rebuilt, p);
        ++rebuilt.observed_hours;
        const size_t  hour                    = static_cast<size_t>(bucket - first_bucket);
        const int64_t start                   = bucket * OBSERVATION_HOUR_US;
        s_staged_archive.first_plus_one[hour] = static_cast<uint32_t>(p.first_unix_us - start) + 1;
        s_staged_archive.last[hour]           = static_cast<uint32_t>(p.last_unix_us - start);
        s_staged_archive.membership[hour] =
            p.duration_edges | (p.first_accepted_unix_us == p.first_unix_us ? kFirstSample : 0) |
            (p.last_accepted_unix_us == p.last_unix_us ? kLastSample : 0);
        const int64_t end = (bucket + static_cast<int64_t>(kArchiveHours)) * OBSERVATION_HOUR_US;
        if (expiry == INT64_MIN || end < expiry) expiry = end;
    }
    rebuilt.partial |= read_failed;
    SemGuard lk(store_mutex(), 0);
    if (!lk || hydronic_observation_suppressed() || epoch != s_epoch ||
        !observation_identity_equal(identity, s_identity))
        return;
    const int64_t publish_wall = wall_now();
    // A transient read error cannot replace the last qualified archive with a subset.
    if (!date_clock(esp_timer_get_time(), publish_wall) || publish_wall < wall ||
        (expiry != INT64_MIN && publish_wall >= expiry) || (wake && publish_wall >= wake) ||
        retry) {
        expire_live(publish_wall);
        s_restore_pending = true;
        s_rebuild         = true;
        return;
    }
    s_completed            = rebuilt;
    s_completed_expiry     = expiry;
    s_archive              = s_staged_archive;
    s_archive_first_bucket = first_bucket;
    s_archive_wake_us      = wake;
    if (rebuilt.dropped > s_dropped) s_dropped = rebuilt.dropped;
    s_drop_saturated |= rebuilt.dropped == UINT16_MAX &&
                        (rebuilt.totals.saturated || rebuilt.totals.agree_saturated);
    s_restore_pending = false;
    s_rebuild         = false;
}
bool hydronic_observation_flash_next(HydronicObservationReader reader, int64_t& bucket,
                                     logic::HydronicHourlyPayload& payload) {
    if (hydronic_observation_suppressed()) return false;
    auto& index = flash_index_state();
    // A permanently invalid head does not prevent this service turn from offering a later
    // record, including during shutdown. Bound the extra work by the existing queue capacity.
    for (size_t attempt = 0; attempt < OBSERVATION_QUEUE_CAP; ++attempt) {
        int64_t wall = -1;
        {
            SemGuard lk(store_mutex(), 0);
            if (!lk || hydronic_observation_suppressed()) return false;
            wall = wall_now();
            apply_receipt();
            if (!s_enabled || !s_confirmed || s_claim_token || s_claim_barrier || wall < 0)
                return false;
            const bool clock_valid = date_clock(esp_timer_get_time(), wall);
            expire_live(wall);
            if (s_barrier_pending) {
                payload               = kEmptyPayload;
                payload.identity      = s_identity;
                payload.first_unix_us = payload.last_unix_us = wall;
                payload.kind                                 = HydronicHourlyKind::Fence;
                payload.flags                                = HYDRONIC_HOUR_PARTIAL;
                if (s_clock_bad) payload.flags |= HYDRONIC_HOUR_CLOCK_LOSS;
                bucket          = observation_bucket(wall);
                s_claim_barrier = true;
                s_transaction   = {0, s_epoch, true, ReceiptResult::Retry, false};
                return !hydronic_observation_suppressed();
            }
            if (!clock_valid || index.clipped_until_bucket == INT64_MAX || s_restore_pending)
                return false;
            Queued* chosen = nullptr;
            for (auto& q : s_queue) {
                if (q.bucket == INT64_MIN || q.claimed) continue;
                const uint32_t earlier = chosen ? chosen->token - q.token : 0;
                if (!chosen || (earlier && earlier < 0x80000000u)) chosen = &q;
            }
            if (!chosen) return false;
            chosen->claimed = true;
            s_claim_token   = chosen->token;
            s_transaction   = {s_claim_token, s_epoch, false, ReceiptResult::Retry, false};
            bucket          = chosen->bucket;
            payload         = chosen->payload;
            if (s_dropped) {
                payload.flags |= HYDRONIC_HOUR_PARTIAL | HYDRONIC_HOUR_QUEUE_LOSS;
                payload.dropped = s_dropped;
                if (s_drop_saturated) {
                    payload.limitations |= HydronicCounterSaturated;
                    payload.agree_limitations |= AgreementCounterSaturated;
                }
            }
        }
        bool           conflict = false;
        const uint64_t barrier  = observation_index_fence_sequence(index, payload.identity);
        for (size_t i = 0; i < index.count && !hydronic_observation_suppressed(); ++i) {
            const auto& e = index.entries[i];
            if (observation_index_is_fence(index, i) || e.bucket() != bucket ||
                e.sequence() <= barrier)
                continue;
            auto&      base   = s_hydronic_flash_payload;
            const auto result = read_hydronic_entry(reader, e, base);
            if (result == HydronicReadResult::Retry) {
                hydronic_observation_flash_failed();
                return false;
            }
            if (result == HydronicReadResult::Invalid) {
                // Do not replace an unreadable base with a revision missing its old evidence.
                conflict = true;
                break;
            }
            if (observation_identity_equal(base.identity, payload.identity)) {
                if (!observation_in_window(e.bucket(), wall) || base.last_unix_us > wall) {
                    hydronic_observation_flash_failed();
                    return false;
                }
                conflict = !hydronic_hourly_merge(base, payload);
                if (!conflict) payload = base;
            }
            break;
        }
        if (conflict || !hydronic_hourly_valid(payload, bucket)) {
            finish_transaction(ReceiptResult::Rejected);
            continue;
        }
        return !hydronic_observation_suppressed();
    }
    return false;
}
void hydronic_observation_flash_appended(int64_t bucket, uint64_t sequence, uint16_t slot,
                                         const logic::HydronicHourlyPayload& payload) {
    if (hydronic_observation_suppressed()) return;
    hydronic_observation_flash_index(bucket, sequence, slot, payload);
    finish_transaction(ReceiptResult::Appended);
}
void hydronic_observation_flash_failed() { finish_transaction(ReceiptResult::Retry); }
void hydronic_observation_forget() {
    s_forget_latched.store(true, std::memory_order_release);
    SemGuard lk(store_mutex(), 0);
    if (!lk) return;
    clear_live();
    s_enabled = s_confirmed = s_barrier_pending = s_restore_pending = false;
    s_restore_blocked                                               = true;
}
} // namespace daik
