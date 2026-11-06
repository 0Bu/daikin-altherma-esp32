#include "stop_observation_store.hpp"
#include "rtos_guard.hpp"
#include "sntp_time.hpp"
#include "esp_timer.h"
#include <climits>
#include <cstring>
#include <atomic>

namespace daik {
namespace {
using namespace logic;
// Start is the sole creator. Publish only fully initialized protected state; an early recovery
// forget must remain effective even when there is no mutex to acquire yet.
std::atomic<SemaphoreHandle_t> s_mutex{nullptr};
SemaphoreHandle_t s_start_mutex = nullptr; // startup owner only, unpublished on failure
std::atomic<bool> s_forgotten{false};      // per boot, never cleared by any public lifecycle
static_assert(std::atomic<SemaphoreHandle_t>::is_always_lock_free &&
                  std::atomic<bool>::is_always_lock_free,
              "early recovery suppression must not allocate or acquire hidden locks");
ObservationIdentity      s_identity;
uint32_t                 s_source_generation = 0;
uint32_t                 s_epoch             = 0;
bool                     s_enabled           = false;
bool                     s_confirmed         = false;
bool                     s_sealed            = false;
bool                     s_restore_pending   = true;
bool                     s_restore_blocked   = false;
bool                     s_barrier_pending   = false;
bool                     s_clock_bad         = false;
int64_t                  s_clock_last_us     = -1;
int64_t                  s_offset_us         = INT64_MIN;
int64_t                  s_last_sample_us    = -1;
bool                     s_last_readable     = false;
int64_t                  s_open_bucket       = INT64_MIN;
ObservationHourlyPayload s_open;
struct Queued {
    ObservationHourlyPayload payload;
    int64_t                  bucket  = INT64_MIN;
    uint32_t                 token   = 0;
    bool                     claimed = false;
};
// Copy immutable defaults directly into owned storage. Forming these nonzero-default PODs as
// automatic temporaries would stack several full payloads on small shutdown callers.
constexpr ObservationHourlyPayload kEmptyPayload{};
constexpr Queued                   kEmptyQueued{};
constexpr StopObservationReport    kEmptyReport{};
constexpr StopObservationReport    kSuppressedReport = [] {
    StopObservationReport r;
    r.restore_pending = false; // a forgotten boot will never attempt another restoration
    return r;
}();
Queued                s_queue[OBSERVATION_QUEUE_CAP];
uint32_t              s_token         = 0;
uint32_t              s_claim_token   = 0;
bool                  s_claim_barrier = false;
StopObservationReport s_completed;
int64_t               s_completed_expiry        = INT64_MIN;
int64_t               s_completed_newest_bucket = INT64_MIN;
uint16_t              s_dropped                 = 0;
bool                  s_drop_saturated          = false;
// Flash-owner state only. No producer/report ever traverses this index or invokes its reader.
ObservationIndex s_index;
// The exclusive flash owner consumes each read before starting another. One reusable record
// keeps nested restore/replay off the small shutdown stacks; producer/report paths never use it.
ObservationHourlyPayload s_flash_payload;
bool                     s_rebuild = true;
struct Receipt {
    uint32_t token   = 0;
    uint32_t epoch   = 0;
    bool     barrier = false;
    bool     success = false;
    bool     pending = false;
};
Receipt s_receipt;     // flash owner only, applied while holding the observation lock
Receipt s_transaction; // immutable claim metadata for the current flash-owner transaction

int64_t wall_now() {
    if (!time_synced()) return -1;
    int64_t seconds = -1;
    int32_t ms      = 0;
    time_now(seconds, ms);
    if (seconds < 0 || seconds > (INT64_MAX - 999999) / 1000000 || ms < 0 || ms > 999) return -1;
    return seconds * 1000000 + ms * 1000;
}
void invalidate_clock();
bool date_clock(int64_t now_us, int64_t now_wall) {
    if (s_clock_bad) return false;
    if (now_us < 0 || now_wall < now_us) return false;
    if (s_clock_last_us >= 0 && now_us < s_clock_last_us) {
        invalidate_clock();
        return false;
    }
    const int64_t offset = now_wall - now_us;
    if (s_offset_us == INT64_MIN) s_offset_us = offset;
    const int64_t delta = offset > s_offset_us ? offset - s_offset_us : s_offset_us - offset;
    if (delta > 2000000) {
        // A clock correction never slides already collected evidence onto a different hour.
        invalidate_clock();
        return false;
    }
    s_clock_last_us = now_us;
    return true;
}
int64_t dated(int64_t monotonic_us) {
    return monotonic_us >= 0 && s_offset_us >= 0 && monotonic_us <= INT64_MAX - s_offset_us
               ? monotonic_us + s_offset_us
               : -1;
}
void lose() {
    if (s_dropped < UINT16_MAX)
        ++s_dropped;
    else
        s_drop_saturated = true;
}
void clear_live() {
    s_open        = kEmptyPayload;
    s_open_bucket = INT64_MIN;
    for (auto& q : s_queue) q = kEmptyQueued;
    s_last_sample_us          = -1;
    s_last_readable           = false;
    s_completed               = kEmptyReport;
    s_completed_expiry        = INT64_MIN;
    s_completed_newest_bucket = INT64_MIN;
    s_claim_token             = 0;
    s_claim_barrier           = false;
    s_sealed                  = false;
    s_dropped                 = 0;
    s_drop_saturated          = false;
    ++s_epoch;
}
void invalidate_clock() {
    // Retire dated data and queued deltas rather than relabeling them. In-flight rebuilds lose
    // their epoch; a committed fence is required before another boot may restore this scope.
    clear_live();
    s_clock_bad       = true;
    s_restore_blocked = true;
    s_restore_pending = true;
    s_barrier_pending = s_enabled && s_confirmed;
}
bool enqueue(int64_t bucket, const ObservationHourlyPayload& p) {
    if (bucket < 0) {
        lose();
        return false;
    }
    for (auto& q : s_queue) {
        if (q.bucket != bucket || q.claimed) continue;
        observation_merge(q.payload, p);
        return true;
    }
    for (auto& q : s_queue) {
        if (q.bucket != INT64_MIN) continue;
        q.payload = p;
        q.bucket  = bucket;
        q.token   = ++s_token;
        // Zero is reserved for the barrier transaction.
        if (!q.token) q.token = ++s_token;
        return true;
    }
    // A bounded queue cannot promise an unbounded flash outage. Loss remains visible for this
    // observation identity and on every subsequent record, rather than disappearing silently.
    lose();
    return false;
}
void close_open() {
    if (s_open_bucket == INT64_MIN) return;
    if (s_open.readable_us < static_cast<uint64_t>(OBSERVATION_HOUR_US))
        s_open.flags |= OBSERVATION_PARTIAL;
    enqueue(s_open_bucket, s_open);
    s_open        = kEmptyPayload;
    s_open_bucket = INT64_MIN;
}
void expire_live(int64_t now_wall) {
    if (s_open_bucket != INT64_MIN && observation_bucket(now_wall) > s_open_bucket) close_open();
    for (auto& q : s_queue) {
        if (q.bucket != INT64_MIN && !observation_in_window(q.bucket, now_wall) && !q.claimed)
            q = kEmptyQueued;
    }
    if (s_completed_expiry != INT64_MIN && now_wall >= s_completed_expiry) {
        // Until the flash owner can rebuild the smaller sum, fail closed. No stale count is served
        // while a producer or the flash mutex is stalled.
        s_completed         = kEmptyReport;
        s_completed.partial = true;
        s_restore_pending   = true;
    }
}
void add_report(StopObservationReport& r, const ObservationHourlyPayload& p) {
    stop_context_merge(r.counters, p.counters);
    r.readable_us += p.readable_us;
    r.partial |= p.flags != 0;
    if (p.dropped > r.dropped) r.dropped = p.dropped;
}
bool read_entry(StopObservationReader reader, const ObservationIndexEntry& e,
                ObservationHourlyPayload& p) {
    int64_t  bucket   = INT64_MIN;
    uint64_t sequence = 0;
    return !stop_observation_suppressed() && reader && reader(e.slot(), bucket, sequence, p) &&
           !stop_observation_suppressed() && bucket == e.bucket() && sequence == e.sequence() &&
           observation_payload_valid(p, bucket);
}
void apply_receipt() {
    if (stop_observation_suppressed()) return;
    if (!s_receipt.pending) return;
    if (s_receipt.epoch == s_epoch) {
        if (s_receipt.barrier) {
            if (s_receipt.success) {
                s_barrier_pending = false;
                s_restore_blocked = false;
                // Discard the pre-reset index candidates only after the fence is durable. The
                // fence itself remains indexed, so a reboot makes the same selection.
            }
            s_claim_barrier = false;
        } else {
            for (auto& q : s_queue) {
                if (q.token != s_receipt.token || !q.claimed) continue;
                if (s_receipt.success)
                    q = kEmptyQueued;
                else
                    q.claimed = false;
            }
            s_claim_token = 0;
        }
        if (s_receipt.success) s_restore_pending = true;
    }
    s_receipt.pending = false;
}
} // namespace

bool stop_observation_suppressed() { return s_forgotten.load(std::memory_order_acquire); }

void stop_observation_start(bool enabled, uint32_t consent_generation) {
    if (stop_observation_suppressed()) return;
    // Only this startup path allocates. Retain a failed first-acquire candidate privately so a
    // repeated start neither leaks it nor exposes state which has not been initialized.
    auto mutex = s_mutex.load(std::memory_order_acquire);
    if (!mutex) {
        if (!s_start_mutex) s_start_mutex = xSemaphoreCreateMutex();
        mutex = s_start_mutex;
    }
    SemGuard lk(mutex);
    if (!lk || stop_observation_suppressed()) return;
    clear_live();
    s_identity                    = {};
    s_identity.consent_generation = consent_generation;
    s_enabled                     = enabled;
    s_confirmed                   = false;
    s_restore_pending             = enabled;
    s_restore_blocked             = false;
    s_barrier_pending             = false;
    s_offset_us                   = INT64_MIN;
    s_clock_bad                   = false;
    s_clock_last_us               = -1;
    s_dropped                     = 0;
    s_mutex.store(mutex, std::memory_order_release);
}

void stop_observation_bind(uint32_t source_fp, uint32_t model_fp, uint32_t schema_fp,
                           uint32_t source_generation, bool allow_restore) {
    if (stop_observation_suppressed()) return;
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (!lk || stop_observation_suppressed()) return;
    const ObservationIdentity next{source_fp, model_fp, schema_fp, s_identity.consent_generation};
    const bool changed = s_confirmed && (!observation_identity_equal(s_identity, next) ||
                                         s_source_generation != source_generation);
    if (changed) {
        clear_live();
        s_offset_us       = INT64_MIN;
        s_clock_bad       = false;
        s_clock_last_us   = -1;
        s_restore_blocked = true;
        s_barrier_pending = true;
    }
    s_identity          = next;
    s_source_generation = source_generation;
    s_confirmed         = s_enabled && observation_identity_valid(next);
    if (!allow_restore) {
        s_restore_blocked = true;
        s_barrier_pending = true;
    }
    s_restore_pending = s_confirmed;
}

void stop_observation_set_diagnostics(bool enabled, uint32_t consent_generation) {
    if (stop_observation_suppressed()) return;
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (!lk || stop_observation_suppressed()) return;
    clear_live();
    s_enabled                     = enabled;
    s_identity.consent_generation = consent_generation;
    s_confirmed                   = false;
    s_restore_blocked             = true;
    s_barrier_pending             = enabled;
    s_restore_pending             = enabled;
    s_dropped                     = 0;
    s_offset_us                   = INT64_MIN;
    s_clock_bad                   = false;
    s_clock_last_us               = -1;
}

void stop_observation_reset() {
    if (s_forgotten.load(std::memory_order_acquire)) return;
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (!lk || s_forgotten.load(std::memory_order_acquire)) return;
    clear_live();
    s_offset_us       = INT64_MIN;
    s_clock_bad       = false;
    s_clock_last_us   = -1;
    s_confirmed       = false;
    s_restore_blocked = true;
    s_barrier_pending = s_enabled;
    s_restore_pending = s_enabled;
}

void stop_observation_record(int64_t sample_us, bool rps_readable,
                             const logic::StopContextEvent& finalized) {
    if (stop_observation_suppressed()) return;
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (!lk || stop_observation_suppressed() || !s_enabled || !s_confirmed || s_sealed) return;
    const int64_t now_us = esp_timer_get_time();
    const int64_t wall   = wall_now();
    if (!date_clock(now_us, wall)) {
        s_last_sample_us = -1;
        s_last_readable  = false;
        if (finalized.valid) lose();
        return;
    }
    expire_live(wall);
    const int64_t at = dated(sample_us);
    // An older measurement can wait behind a newer admitted producer. It is stale input, not
    // proof that the monotonic clock went backwards; never close that producer's newer hour.
    if (sample_us < 0 || sample_us > now_us || at < 0 ||
        (s_last_sample_us >= 0 && sample_us < s_last_sample_us)) {
        if (finalized.valid) lose();
        return;
    }
    const int64_t bucket = observation_bucket(at);
    if (!observation_in_window(bucket, wall)) return;
    if (s_open_bucket != bucket) {
        close_open();
        s_open_bucket        = bucket;
        s_open.identity      = s_identity;
        s_open.first_unix_us = at;
        s_open.last_unix_us  = at;
    }
    if (s_last_sample_us >= 0 && sample_us >= s_last_sample_us &&
        sample_us - s_last_sample_us <= STOP_CONTEXT_MAX_GAP_US && s_last_readable &&
        rps_readable) {
        const int64_t previous = dated(s_last_sample_us);
        const int64_t start    = bucket * OBSERVATION_HOUR_US;
        // On an hour seam the old endpoint belongs to the closed hour too. Book each side of
        // the witnessed <=15s interval separately, never an inferred core coverage duration.
        if (previous < start) {
            ObservationHourlyPayload seam;
            seam.identity      = s_identity;
            seam.first_unix_us = previous;
            seam.last_unix_us  = start - 1;
            seam.readable_us   = static_cast<uint64_t>(start - previous);
            enqueue(bucket - 1, seam);
        }
        const int64_t begin = previous < start ? start : previous;
        s_open.readable_us += static_cast<uint64_t>(at - begin);
    }
    s_open.last_unix_us = at;
    s_last_sample_us    = sample_us;
    s_last_readable     = rps_readable;
    if (finalized.valid) {
        const int64_t edge        = dated(finalized.stop_us);
        const int64_t edge_bucket = observation_bucket(edge);
        if (finalized.source_generation != s_source_generation || finalized.stop_us > sample_us ||
            !observation_in_window(edge_bucket, wall)) {
            lose();
        } else {
            ObservationHourlyPayload event;
            event.identity      = s_identity;
            event.first_unix_us = event.last_unix_us = edge;
            event.counters                           = stop_context_counters(finalized);
            if (edge_bucket == s_open_bucket)
                observation_merge(s_open, event);
            else
                enqueue(edge_bucket, event);
        }
    }
}

void stop_observation_seal() {
    if (stop_observation_suppressed()) return;
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (!lk || stop_observation_suppressed()) return;
    close_open();
    s_sealed = true;
}

StopObservationReport stop_observation_report() {
    StopObservationReport r;
    if (stop_observation_suppressed()) {
        r = kSuppressedReport;
        return r;
    }
    SemGuard lk(s_mutex.load(std::memory_order_acquire));
    if (stop_observation_suppressed()) {
        r = kSuppressedReport;
        return r;
    }
    if (!lk) return r;
    const int64_t now_wall = wall_now();
    if (!s_enabled || !s_confirmed) {
        r.restore_pending     = s_restore_pending;
        r.persistence_pending = s_barrier_pending;
        if (stop_observation_suppressed()) r = kSuppressedReport;
        return r;
    }
    if (!date_clock(esp_timer_get_time(), now_wall)) {
        r.confirmed = true; // source identity is known even when its dated projection is refused
        r.restore_pending     = s_restore_pending;
        r.persistence_pending = s_barrier_pending;
        r.dropped             = s_dropped;
        if (stop_observation_suppressed()) r = kSuppressedReport;
        return r;
    }
    expire_live(now_wall);
    r                     = s_completed;
    r.confirmed           = true;
    r.dated               = true; // checked against both clocks under this same lock above
    r.restore_pending     = s_restore_pending;
    r.persistence_pending = s_barrier_pending;
    r.partial |= s_restore_pending || s_clock_bad || s_dropped != 0;
    if (s_dropped > r.dropped) r.dropped = s_dropped;
    r.counters.saturated |= s_drop_saturated;
    if (observation_in_window(s_open_bucket, now_wall)) {
        add_report(r, s_open);
        if (s_open_bucket != s_completed_newest_bucket) ++r.observed_hours;
    }
    for (const auto& q : s_queue) {
        if (!observation_in_window(q.bucket, now_wall)) continue;
        add_report(r, q.payload);
        r.persistence_pending = true;
        // Delta corrections may refer to an already counted hour; hours is a lower-bound
        // completed-hour count plus a currently open hour, not a count of queue entries.
    }
    r.partial |= r.readable_us < static_cast<uint64_t>(OBSERVATION_DAY_US);
    if (stop_observation_suppressed()) r = kSuppressedReport;
    return r;
}

void stop_observation_flash_index_reset() {
    if (stop_observation_suppressed()) return;
    s_index   = {};
    s_rebuild = true;
    s_receipt = {};
}
void stop_observation_flash_index(int64_t bucket, uint64_t sequence, uint16_t slot,
                                  const logic::ObservationHourlyPayload& payload) {
    if (s_forgotten.load(std::memory_order_acquire)) return;
    if (!observation_payload_valid(payload, bucket)) {
        stop_observation_flash_index_incomplete();
        return;
    }
    observation_index_add(s_index, bucket, sequence, slot,
                          (payload.flags & OBSERVATION_BARRIER) ? &payload.identity : nullptr);
    s_rebuild = true;
}
void stop_observation_flash_index_incomplete() {
    if (stop_observation_suppressed()) return;
    observation_index_incomplete(s_index);
    s_rebuild = true;
}

void stop_observation_flash_service(StopObservationReader reader) {
    if (stop_observation_suppressed()) return;
    int64_t             now_wall = -1;
    ObservationIdentity identity;
    uint32_t            epoch;
    bool                blocked;
    {
        SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
        if (!lk || stop_observation_suppressed() || !s_enabled || !s_confirmed) return;
        now_wall = wall_now();
        if (!date_clock(esp_timer_get_time(), now_wall)) return;
        if (s_index.clipped && observation_bucket(now_wall) >= s_index.clipped_until_bucket) {
            s_index.clipped = false;
            s_rebuild       = true;
        }
        apply_receipt();
        expire_live(now_wall);
        if (!s_rebuild && !s_restore_pending &&
            (s_completed_expiry == INT64_MIN || now_wall < s_completed_expiry))
            return;
        identity = s_identity;
        epoch    = s_epoch;
        blocked  = s_restore_blocked;
    }
    if (blocked) return;
    StopObservationReport rebuilt;
    rebuilt.partial              = s_index.clipped;
    rebuilt.restore_pending      = false;
    int64_t        expiry        = INT64_MIN;
    int64_t        newest_bucket = INT64_MIN;
    const uint64_t barrier       = observation_index_fence_sequence(s_index, identity);
    bool           read_failed   = false;
    // Fences are validated snapshot metadata. Never reread a recycled fence slot or date a
    // sequence-order reset as measurement coverage. Only measurement entries use the reader.
    for (size_t i = 0; i < s_index.count && !s_index.clipped; ++i) {
        const auto& e = s_index.entries[i];
        if (observation_index_is_fence(s_index, i) || e.sequence() <= barrier ||
            !observation_in_window(e.bucket(), now_wall))
            continue;
        auto& p = s_flash_payload;
        if (!read_entry(reader, e, p)) {
            read_failed = true;
            continue;
        }
        if (!observation_identity_equal(p.identity, identity) || p.last_unix_us > now_wall)
            continue;
        add_report(rebuilt, p);
        ++rebuilt.observed_hours;
        if (e.bucket() > newest_bucket) newest_bucket = e.bucket();
        const int64_t end = (e.bucket() + 24) * OBSERVATION_HOUR_US;
        if (expiry == INT64_MIN || end < expiry) expiry = end;
    }
    rebuilt.partial |= read_failed;
    SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
    if (!lk || stop_observation_suppressed() || epoch != s_epoch ||
        !observation_identity_equal(identity, s_identity))
        return;
    const int64_t publish_wall = wall_now();
    if (!date_clock(esp_timer_get_time(), publish_wall) || publish_wall < now_wall ||
        (expiry != INT64_MIN && publish_wall >= expiry)) {
        expire_live(publish_wall);
        s_restore_pending = true;
        s_rebuild         = true;
        return;
    }
    s_completed               = rebuilt;
    s_completed_expiry        = expiry;
    s_completed_newest_bucket = newest_bucket;
    // A restored notice remains known for this lifecycle even when the record carrying it ages
    // out. Propagate that lower-bound watermark into later commits, rather than silently clearing
    // the loss qualification after a reboot followed by an hour rollover.
    if (rebuilt.dropped > s_dropped) s_dropped = rebuilt.dropped;
    s_drop_saturated |= rebuilt.dropped == UINT16_MAX && rebuilt.counters.saturated;
    s_restore_pending = false;
    s_rebuild         = read_failed;
}

bool stop_observation_flash_next(StopObservationReader reader, int64_t& bucket,
                                 logic::ObservationHourlyPayload& payload) {
    if (stop_observation_suppressed()) return false;
    int64_t now_wall = -1;
    {
        SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
        if (!lk || stop_observation_suppressed()) return false;
        now_wall = wall_now();
        apply_receipt();
        if (!s_enabled || !s_confirmed || s_claim_token || s_claim_barrier || now_wall < 0)
            return false;
        const bool clock_valid = date_clock(esp_timer_get_time(), now_wall);
        expire_live(now_wall);
        if (s_barrier_pending) {
            payload               = kEmptyPayload;
            payload.identity      = s_identity;
            payload.first_unix_us = payload.last_unix_us = now_wall;
            payload.flags   = OBSERVATION_BARRIER | OBSERVATION_PARTIAL;
            bucket          = observation_bucket(now_wall);
            s_claim_barrier = true;
            s_transaction   = {0, s_epoch, true, false, false};
            return !stop_observation_suppressed();
        }
        if (!clock_valid) return false;
        if (s_index.clipped_until_bucket == INT64_MAX) return false;
        if (s_restore_pending) return false;
        Queued* chosen = nullptr;
        for (auto& q : s_queue)
            if (q.bucket != INT64_MIN && !q.claimed && (!chosen || q.bucket < chosen->bucket))
                chosen = &q;
        if (!chosen) return false;
        chosen->claimed = true;
        s_claim_token   = chosen->token;
        s_transaction   = {s_claim_token, s_epoch, false, false, false};
        bucket          = chosen->bucket;
        payload         = chosen->payload;
        if (s_dropped) {
            payload.flags |= OBSERVATION_PARTIAL | OBSERVATION_QUEUE_LOSS;
            payload.dropped = s_dropped;
            payload.counters.saturated |= s_drop_saturated;
        }
    }
    // A late event is a delta until the owner reads the hour's newest committed revision. Do
    // not resurrect pre-reset records; service/index filtering and the explicit barrier bind it.
    const uint64_t barrier = observation_index_fence_sequence(s_index, payload.identity);
    for (size_t i = 0; i < s_index.count; ++i) {
        const auto& e = s_index.entries[i];
        if (observation_index_is_fence(s_index, i) || e.bucket() != bucket ||
            e.sequence() <= barrier)
            continue;
        auto& base = s_flash_payload;
        if (!read_entry(reader, e, base)) {
            stop_observation_flash_failed();
            return false;
        }
        if (observation_identity_equal(base.identity, payload.identity)) {
            if (!observation_in_window(e.bucket(), now_wall) || base.last_unix_us > now_wall) {
                stop_observation_flash_failed();
                return false;
            }
            observation_merge(base, payload);
            payload = base;
        }
        break;
    }
    return !stop_observation_suppressed();
}

void stop_observation_flash_appended(int64_t bucket, uint64_t sequence, uint16_t slot,
                                     const logic::ObservationHourlyPayload& payload) {
    if (stop_observation_suppressed()) return;
    stop_observation_flash_index(bucket, sequence, slot, payload);
    if (stop_observation_suppressed()) return;
    s_receipt         = s_transaction;
    s_receipt.success = true;
    s_receipt.pending = true;
    SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
    if (lk) apply_receipt();
}
void stop_observation_flash_failed() {
    if (stop_observation_suppressed()) return;
    s_receipt         = s_transaction;
    s_receipt.success = false;
    s_receipt.pending = true;
    SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
    if (lk) apply_receipt();
}
void stop_observation_forget() {
    // Publish the privacy barrier before touching a nullable/contended mutex. No lifecycle call
    // may clear this per-boot fact, including a delayed start after an incomplete factory reset.
    s_forgotten.store(true, std::memory_order_release);
    SemGuard lk(s_mutex.load(std::memory_order_acquire), 0);
    if (!lk) return;
    clear_live();
    s_enabled         = false;
    s_confirmed       = false;
    s_barrier_pending = false;
    s_restore_blocked = true;
    s_restore_pending = false;
}
} // namespace daik
