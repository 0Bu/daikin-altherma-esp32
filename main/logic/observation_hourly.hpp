#pragma once
// A separate hourly observation journal. Physical source 3 deliberately stays a Checkup
// envelope: older firmware can find its physical head while refusing these different bytes.
#include "logic/history_persist.hpp"
#include "logic/stop_context.hpp"
#include <cstring>
#include <type_traits>

namespace daik::logic {

constexpr int64_t  OBSERVATION_HOUR_US    = 3600000000LL;
constexpr int64_t  OBSERVATION_DAY_US     = 24 * OBSERVATION_HOUR_US;
constexpr size_t   OBSERVATION_INDEX_CAP  = 47;
constexpr size_t   OBSERVATION_QUEUE_CAP  = 4;
constexpr uint16_t OBSERVATION_PARTIAL    = 1u;
constexpr uint16_t OBSERVATION_BARRIER    = 2u;
constexpr uint16_t OBSERVATION_QUEUE_LOSS = 4u;
constexpr uint16_t OBSERVATION_CLOCK_LOSS = 8u;
constexpr uint32_t OBSERVATION_METHOD     = 1;

struct ObservationIdentity {
    uint32_t source_fp          = 0;
    uint32_t model_fp           = 0;
    uint32_t schema_fp          = 0;
    uint32_t consent_generation = 0;
};
inline bool observation_identity_equal(const ObservationIdentity& a, const ObservationIdentity& b) {
    return a.source_fp == b.source_fp && a.model_fp == b.model_fp && a.schema_fp == b.schema_fp &&
           a.consent_generation == b.consent_generation;
}
inline bool observation_identity_valid(const ObservationIdentity& a) {
    return a.source_fp && a.model_fp && a.schema_fp;
}

struct ObservationHourlyPayload {
    ObservationIdentity identity;
    int64_t             first_unix_us = -1;
    int64_t             last_unix_us  = -1;
    uint64_t            readable_us   = 0;
    StopContextCounters counters;
    uint16_t            flags   = 0;
    uint16_t            dropped = 0; // cumulative loss watermark for this observation identity
};
static_assert(std::is_trivially_copyable<ObservationHourlyPayload>::value,
              "hourly publication must remain a nonallocating POD copy");
constexpr size_t OBSERVATION_WORDS         = (sizeof(ObservationHourlyPayload) + 1) / 2;
constexpr size_t OBSERVATION_PAYLOAD_BYTES = OBSERVATION_WORDS * 2;
static_assert(OBSERVATION_PAYLOAD_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES,
              "observation hour must fit the unchanged journal slot");

// Never journal unspecified struct/tail padding from producer or flash-owner stacks. In
// particular StopContextCounters ends with a bool. Copy named fields into a zeroed byte image.
inline void observation_encode(const ObservationHourlyPayload& p, void* destination) {
    auto* bytes = static_cast<uint8_t*>(destination);
    std::memset(bytes, 0, OBSERVATION_PAYLOAD_BYTES);
    const auto copy = [bytes](size_t offset, const void* field, size_t size) {
        std::memcpy(bytes + offset, field, size);
    };
#define OBSERVATION_COPY(field)                                                                    \
    copy(offsetof(ObservationHourlyPayload, field), &p.field, sizeof(p.field))
    OBSERVATION_COPY(identity);
    OBSERVATION_COPY(first_unix_us);
    OBSERVATION_COPY(last_unix_us);
    OBSERVATION_COPY(readable_us);
    OBSERVATION_COPY(flags);
    OBSERVATION_COPY(dropped);
#undef OBSERVATION_COPY
    constexpr size_t counters = offsetof(ObservationHourlyPayload, counters);
#define OBSERVATION_COUNTER_COPY(field)                                                            \
    copy(counters + offsetof(StopContextCounters, field), &p.counters.field,                       \
         sizeof(p.counters.field))
    OBSERVATION_COUNTER_COPY(witnessed_stops_recent_heating);
    OBSERVATION_COUNTER_COPY(positive);
    OBSERVATION_COUNTER_COPY(evaluable);
    OBSERVATION_COUNTER_COPY(complete);
    OBSERVATION_COUNTER_COPY(unclassified);
    OBSERVATION_COUNTER_COPY(unknown);
    OBSERVATION_COUNTER_COPY(partial);
    OBSERVATION_COUNTER_COPY(censored);
    OBSERVATION_COUNTER_COPY(target_changed);
    OBSERVATION_COUNTER_COPY(time_overflow);
    OBSERVATION_COUNTER_COPY(saturated);
#undef OBSERVATION_COUNTER_COPY
}

inline uint32_t observation_fingerprint() {
    const uint32_t shape[] = {0x53544f50u,
                              OBSERVATION_METHOD,
                              static_cast<uint32_t>(sizeof(ObservationHourlyPayload)),
                              static_cast<uint32_t>(offsetof(ObservationHourlyPayload, counters)),
                              static_cast<uint32_t>(sizeof(StopContextCounters)),
                              static_cast<uint32_t>(STOP_CONTEXT_WINDOW_US),
                              static_cast<uint32_t>(STOP_CONTEXT_MAX_GAP_US),
                              STOP_CONTEXT_LOW_RPS_TENTHS,
                              static_cast<uint32_t>(STOP_CONTEXT_ABOVE_TARGET_TENTHS),
                              STOP_CONTEXT_CATEGORIES,
                              static_cast<uint32_t>(STOP_CONTEXT_TARGET_STABLE_US)};
    const uint32_t fp      = config_crc32_final(config_crc32_update(
        CONFIG_CRC32_INIT, reinterpret_cast<const uint8_t*>(shape), sizeof(shape)));
    return fp ? fp : 1;
}
inline bool observation_header_matches(const HistoryJournalHeader& h) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           history_journal_header_matches(h, observation_fingerprint(), OBSERVATION_WORDS, 3600);
}
inline int64_t observation_bucket(int64_t unix_us) {
    return unix_us >= 0 ? unix_us / OBSERVATION_HOUR_US : INT64_MIN;
}
inline bool observation_in_window(int64_t bucket, int64_t now_unix_us) {
    // Whole-hour expiry: a partial old hour cannot keep its newest seconds for another hour.
    return bucket >= 0 && now_unix_us >= 0 && bucket <= observation_bucket(now_unix_us) &&
           bucket > observation_bucket(now_unix_us - OBSERVATION_DAY_US);
}
inline bool observation_payload_valid(const ObservationHourlyPayload& p, int64_t bucket) {
    const auto&    c          = p.counters;
    const uint16_t population = c.witnessed_stops_recent_heating;
    if (c.unclassified > population || c.unknown > population || c.partial > population ||
        c.censored > population || c.target_changed > population || c.time_overflow > population)
        return false;
    for (size_t i = 0; i < STOP_CONTEXT_CATEGORIES; ++i)
        if (c.positive[i] > c.evaluable[i] || c.complete[i] > c.evaluable[i] ||
            c.evaluable[i] > population)
            return false;
    if ((p.flags & OBSERVATION_BARRIER) && (p.readable_us != 0 || population != 0 || c.saturated ||
                                            p.first_unix_us != p.last_unix_us || p.dropped != 0))
        return false;
    return observation_identity_valid(p.identity) && bucket >= 0 &&
           bucket <= INT64_MAX / OBSERVATION_HOUR_US - 24 && p.first_unix_us >= 0 &&
           p.last_unix_us >= p.first_unix_us && observation_bucket(p.first_unix_us) == bucket &&
           observation_bucket(p.last_unix_us) == bucket &&
           p.readable_us <= static_cast<uint64_t>(OBSERVATION_HOUR_US) &&
           !(p.flags & ~(OBSERVATION_PARTIAL | OBSERVATION_BARRIER | OBSERVATION_QUEUE_LOSS |
                         OBSERVATION_CLOCK_LOSS));
}
inline void observation_merge(ObservationHourlyPayload& into, const ObservationHourlyPayload& add) {
    if (into.first_unix_us < 0 || add.first_unix_us < into.first_unix_us)
        into.first_unix_us = add.first_unix_us;
    if (add.last_unix_us > into.last_unix_us) into.last_unix_us = add.last_unix_us;
    into.readable_us += add.readable_us;
    if (into.readable_us > static_cast<uint64_t>(OBSERVATION_HOUR_US)) {
        into.readable_us = OBSERVATION_HOUR_US;
        into.flags |= OBSERVATION_PARTIAL;
    }
    stop_context_merge(into.counters, add.counters);
    into.flags |= add.flags;
    if (add.dropped > into.dropped) into.dropped = add.dropped;
}

// Slots are retained by absolute hour and newest sequence, rather than a 288-sample raster.
// 47 candidates cover the usual revision seam. Capacity clipping is explicit and never inferred
// as coverage. Index fields are host/target-measured by the runtime harness and target ELF gate.
struct ObservationIndexEntry {
    int64_t  bucket   = INT64_MIN;
    uint64_t sequence = 0;
    uint16_t slot     = 0;
    bool     barrier  = false;
};
struct ObservationIndex {
    ObservationIndexEntry entries[OBSERVATION_INDEX_CAP];
    uint8_t               count                = 0;
    bool                  clipped              = false;
    int64_t               clipped_until_bucket = INT64_MIN;
};
inline void observation_index_add(ObservationIndex& ix, int64_t bucket, uint64_t sequence,
                                  uint16_t slot, bool barrier = false) {
    for (size_t i = 0; i < ix.count; ++i) {
        if (ix.entries[i].bucket != bucket || ix.entries[i].barrier != barrier ||
            (barrier && ix.entries[i].sequence != sequence))
            continue;
        if (sequence > ix.entries[i].sequence) ix.entries[i] = {bucket, sequence, slot, barrier};
        return;
    }
    if (ix.count < OBSERVATION_INDEX_CAP) {
        ix.entries[ix.count++] = {bucket, sequence, slot, barrier};
        return;
    }
    size_t oldest = 0;
    for (size_t i = 1; i < ix.count; ++i)
        if (ix.entries[i].bucket < ix.entries[oldest].bucket) oldest = i;
    const int64_t dropped_bucket =
        bucket > ix.entries[oldest].bucket ? ix.entries[oldest].bucket : bucket;
    if (bucket > ix.entries[oldest].bucket) ix.entries[oldest] = {bucket, sequence, slot, barrier};
    // More than 47 candidates in a day can happen under repeated resets. Losing an old hour
    // outside the newest day is ordinary expiry; losing an in-day reset fence fails closed.
    int64_t newest = bucket;
    for (size_t i = 0; i < ix.count; ++i)
        if (ix.entries[i].bucket > newest) newest = ix.entries[i].bucket;
    if (dropped_bucket > newest - 24) {
        ix.clipped          = true;
        const int64_t until = dropped_bucket + 24;
        if (until > ix.clipped_until_bucket) ix.clipped_until_bucket = until;
    }
}

} // namespace daik::logic
