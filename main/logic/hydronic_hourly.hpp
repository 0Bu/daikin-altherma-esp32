#pragma once
// Independent HYDR bytes on the unchanged physical Checkup envelope. Durations describe
// admitted intervals; sample ranges belong to their actual endpoint hour. No monotonic
// timestamp is portable across boots and none is encoded here.
#include "logic/hydronic_observation.hpp"
#include "logic/observation_hourly.hpp"
#include <climits>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <type_traits>

namespace daik::logic {

constexpr uint32_t HYDRONIC_METHOD          = 1;
constexpr size_t   HYDRONIC_PAYLOAD_BYTES   = 124;
constexpr size_t   HYDRONIC_WORDS           = HYDRONIC_PAYLOAD_BYTES / 2;
constexpr uint16_t HYDRONIC_HOUR_PARTIAL    = 1u;
constexpr uint16_t HYDRONIC_HOUR_QUEUE_LOSS = 2u;
constexpr uint16_t HYDRONIC_HOUR_CLOCK_LOSS = 4u;
constexpr uint8_t  HYDRONIC_DUR_FIRST = 1u, HYDRONIC_DUR_LAST = 2u;
constexpr uint8_t  HYDRONIC_DUR_BOTH = HYDRONIC_DUR_FIRST | HYDRONIC_DUR_LAST;
constexpr uint8_t  HYDRONIC_KNOWN_LIMITATIONS =
    HydronicUnobservablePhase | HydronicCommandUnavailable | HydronicCounterSaturated;
constexpr int32_t HYDRONIC_SPREAD_MAX_MILLI  = 260000; // TEMP_MAX_C - TEMP_MIN_C
constexpr int32_t HYDRONIC_FLOW_MAX_MILLI    = 3276700;
constexpr int32_t HYDRONIC_COMMAND_MAX_MILLI = 100000;
enum class HydronicHourlyKind : uint8_t { Data = 1, Fence = 2 };

struct HydronicHourlyPayload {
    ObservationIdentity identity;
    int64_t             first_unix_us = -1, last_unix_us = -1; // dated evidence in this hour only
    int64_t             first_accepted_unix_us = -1, last_accepted_unix_us = -1;
    HydronicRange       spread, flow, command;
    uint32_t            observed_us = 0, candidate_us = 0, qualified_us = 0;
    uint32_t            samples = 0, command_samples = 0;
    uint16_t            flags = 0, dropped = 0;
    uint8_t             limitations    = HydronicNoLimitation;
    HydronicHourlyKind  kind           = HydronicHourlyKind::Data;
    uint8_t             duration_edges = 0;
};
// Rolling totals exceed a single hour's uint32 duration and sample budgets. These timestamps
// are explicit UTC dates, unlike HydronicCounters' live monotonic timestamps.
struct HydronicTotals {
    uint64_t      observed_us = 0, candidate_us = 0, qualified_us = 0;
    uint64_t      samples = 0, command_samples = 0;
    HydronicRange spread, flow, command;
    int64_t       first_evidence_unix_us = -1, last_evidence_unix_us = -1;
    int64_t       first_accepted_unix_us = -1, last_accepted_unix_us = -1;
    uint8_t       limitations    = HydronicNoLimitation;
    bool          saturated      = false;
    uint8_t       duration_edges = 0;
};
static_assert(HYDRONIC_PAYLOAD_BYTES <= HISTORY_JOURNAL_PAYLOAD_BYTES &&
                  HYDRONIC_PAYLOAD_BYTES % 2 == 0,
              "HYDR must fit the unchanged journal payload");
static_assert(std::is_trivially_copyable<HydronicHourlyPayload>::value &&
                  std::is_trivially_copyable<HydronicTotals>::value,
              "HYDR producer and reader copies must not allocate");
static_assert(OBSERVATION_INDEX_CAP + OBSERVATION_QUEUE_CAP + 1 <=
                  static_cast<uint64_t>(INT64_MAX) /
                      (static_cast<uint64_t>(UINT32_MAX) * HYDRONIC_FLOW_MAX_MILLI),
              "bounded rolling sample sums must fit int64 without narrowing counts");
static_assert(HYDRONIC_SPREAD_MAX_MILLI == static_cast<int32_t>((TEMP_MAX_C - TEMP_MIN_C) * 1000),
              "update the HYDR method when temperature bounds change");

inline bool hydronic_range_valid(const HydronicRange& r, uint32_t count, int32_t low,
                                 int32_t high) {
    if (!count) return !r.sum_milli && !r.min_milli && !r.max_milli;
    return r.min_milli >= low && r.max_milli <= high && r.min_milli <= r.max_milli &&
           r.sum_milli >= static_cast<int64_t>(r.min_milli) * (count - 1) + r.max_milli &&
           r.sum_milli <= static_cast<int64_t>(r.max_milli) * (count - 1) + r.min_milli;
}
inline bool hydronic_hourly_valid(const HydronicHourlyPayload& p, int64_t bucket) {
    if (!observation_identity_valid(p.identity) || bucket < 0 ||
        bucket > INT64_MAX / OBSERVATION_HOUR_US - 24 || p.first_unix_us < 0 ||
        p.last_unix_us < p.first_unix_us || observation_bucket(p.first_unix_us) != bucket ||
        observation_bucket(p.last_unix_us) != bucket ||
        p.observed_us > static_cast<uint64_t>(OBSERVATION_HOUR_US) ||
        p.candidate_us > p.observed_us || p.qualified_us > p.candidate_us ||
        p.command_samples > p.samples ||
        (p.flags &
         ~(HYDRONIC_HOUR_PARTIAL | HYDRONIC_HOUR_QUEUE_LOSS | HYDRONIC_HOUR_CLOCK_LOSS)) ||
        (p.limitations & ~HYDRONIC_KNOWN_LIMITATIONS) || (p.duration_edges & ~HYDRONIC_DUR_BOTH) ||
        !hydronic_range_valid(p.spread, p.samples, -HYDRONIC_SPREAD_MAX_MILLI,
                              HYDRONIC_SPREAD_MAX_MILLI) ||
        !hydronic_range_valid(p.flow, p.samples, 1, HYDRONIC_FLOW_MAX_MILLI) ||
        !hydronic_range_valid(p.command, p.command_samples, 0, HYDRONIC_COMMAND_MAX_MILLI))
        return false;
    if (!p.samples) {
        if (p.first_accepted_unix_us != -1 || p.last_accepted_unix_us != -1) return false;
    } else if (p.first_accepted_unix_us < p.first_unix_us ||
               p.last_accepted_unix_us < p.first_accepted_unix_us ||
               p.last_accepted_unix_us > p.last_unix_us ||
               (p.samples == 1 && p.first_accepted_unix_us != p.last_accepted_unix_us))
        return false;
    if (p.kind == HydronicHourlyKind::Fence)
        return p.first_unix_us == p.last_unix_us && !p.observed_us && !p.candidate_us &&
               !p.qualified_us && !p.samples && !p.command_samples && !p.dropped &&
               !p.limitations && !p.duration_edges && !(p.flags & HYDRONIC_HOUR_QUEUE_LOSS);
    if (p.kind != HydronicHourlyKind::Data || (!p.observed_us && !p.samples) ||
        (p.dropped && !(p.flags & HYDRONIC_HOUR_QUEUE_LOSS)))
        return false;
    const bool first_timed = (p.duration_edges & HYDRONIC_DUR_FIRST) != 0;
    const bool last_timed  = (p.duration_edges & HYDRONIC_DUR_LAST) != 0;
    const bool two_edges   = p.first_unix_us != p.last_unix_us;
    // Each inclusive edge belongs to duration, an accepted sample, or both. A one-tick span
    // names the same edge twice. Count only distinct timed ticks toward the duration bounds.
    if ((!two_edges && first_timed != last_timed) ||
        (!first_timed && p.first_accepted_unix_us != p.first_unix_us) ||
        (!last_timed && p.last_accepted_unix_us != p.last_unix_us))
        return false;
    const unsigned timed_edges = first_timed + (two_edges && last_timed);
    const auto     span        = static_cast<uint64_t>(p.last_unix_us - p.first_unix_us) + 1;
    return p.observed_us >= timed_edges &&
           p.observed_us <= span - (two_edges ? 2u : 1u) + timed_edges;
}

inline void hydronic_extend_evidence(int64_t& first, int64_t& last, uint8_t& edges,
                                     int64_t add_first, int64_t add_last, uint8_t add_edges) {
    if (first < 0 || add_first < first) {
        first = add_first;
        edges = (edges & ~HYDRONIC_DUR_FIRST) | (add_edges & HYDRONIC_DUR_FIRST);
    } else if (add_first == first) {
        edges |= add_edges & HYDRONIC_DUR_FIRST;
    }
    if (add_last > last) {
        last  = add_last;
        edges = (edges & ~HYDRONIC_DUR_LAST) | (add_edges & HYDRONIC_DUR_LAST);
    } else if (add_last == last) {
        edges |= add_edges & HYDRONIC_DUR_LAST;
    }
}

// A shared tick may contain duration from one side and an accepted point from the other.
// Interior gaps are unknown at this granularity, so only the exact shared edge is admissible.
inline bool hydronic_evidence_before(int64_t last, int64_t last_sample, uint8_t last_edges,
                                     int64_t first, int64_t first_sample, uint8_t first_edges) {
    return last < first ||
           (last == first &&
            !((last_edges & HYDRONIC_DUR_LAST) && (first_edges & HYDRONIC_DUR_FIRST)) &&
            (last_sample != last || first_sample != first));
}

inline void hydronic_range_merge(HydronicRange& into, uint64_t previous, const HydronicRange& add,
                                 uint64_t count) {
    if (!count) return;
    if (!previous) {
        into = add;
        return;
    }
    into.sum_milli += add.sum_milli;
    if (add.min_milli < into.min_milli) into.min_milli = add.min_milli;
    if (add.max_milli > into.max_milli) into.max_milli = add.max_milli;
}
// Merge only disjoint duration ticks and accepted points of the same identity/hour.
// Refusal is atomic.
inline bool hydronic_hourly_merge(HydronicHourlyPayload& into, const HydronicHourlyPayload& add) {
    const int64_t bucket = observation_bucket(into.first_unix_us);
    if (!hydronic_hourly_valid(into, bucket) || !hydronic_hourly_valid(add, bucket) ||
        into.kind != HydronicHourlyKind::Data || add.kind != HydronicHourlyKind::Data ||
        !observation_identity_equal(into.identity, add.identity) ||
        add.samples > UINT32_MAX - into.samples ||
        add.command_samples > UINT32_MAX - into.command_samples)
        return false;
    const bool before =
        hydronic_evidence_before(into.last_unix_us, into.last_accepted_unix_us, into.duration_edges,
                                 add.first_unix_us, add.first_accepted_unix_us, add.duration_edges);
    if (!before && !hydronic_evidence_before(add.last_unix_us, add.last_accepted_unix_us,
                                             add.duration_edges, into.first_unix_us,
                                             into.first_accepted_unix_us, into.duration_edges))
        return false;
    const int64_t first = before ? into.first_unix_us : add.first_unix_us;
    const int64_t last  = before ? add.last_unix_us : into.last_unix_us;
    // Both inputs already bound candidate/qualified time by observed time. Their merged span
    // belongs to one hour, including the representation's possible final inclusive microsecond.
    if (static_cast<uint64_t>(into.observed_us) + add.observed_us >
        static_cast<uint64_t>(last - first) + 1)
        return false;
    hydronic_range_merge(into.spread, into.samples, add.spread, add.samples);
    hydronic_range_merge(into.flow, into.samples, add.flow, add.samples);
    hydronic_range_merge(into.command, into.command_samples, add.command, add.command_samples);
    if (add.samples) {
        if (!into.samples || add.first_accepted_unix_us < into.first_accepted_unix_us)
            into.first_accepted_unix_us = add.first_accepted_unix_us;
        if (add.last_accepted_unix_us > into.last_accepted_unix_us)
            into.last_accepted_unix_us = add.last_accepted_unix_us;
    }
    hydronic_extend_evidence(into.first_unix_us, into.last_unix_us, into.duration_edges,
                             add.first_unix_us, add.last_unix_us, add.duration_edges);
    into.observed_us += add.observed_us;
    into.candidate_us += add.candidate_us;
    into.qualified_us += add.qualified_us;
    into.samples += add.samples;
    into.command_samples += add.command_samples;
    into.flags |= add.flags;
    into.limitations |= add.limitations;
    if (add.dropped > into.dropped) into.dropped = add.dropped;
    return true;
}
inline void hydronic_totals_add(HydronicTotals& into, const HydronicHourlyPayload& p) {
    hydronic_extend_evidence(into.first_evidence_unix_us, into.last_evidence_unix_us,
                             into.duration_edges, p.first_unix_us, p.last_unix_us,
                             p.duration_edges);
    hydronic_range_merge(into.spread, into.samples, p.spread, p.samples);
    hydronic_range_merge(into.flow, into.samples, p.flow, p.samples);
    hydronic_range_merge(into.command, into.command_samples, p.command, p.command_samples);
    if (p.samples) {
        if (!into.samples || p.first_accepted_unix_us < into.first_accepted_unix_us)
            into.first_accepted_unix_us = p.first_accepted_unix_us;
        if (p.last_accepted_unix_us > into.last_accepted_unix_us)
            into.last_accepted_unix_us = p.last_accepted_unix_us;
    }
    into.observed_us += p.observed_us;
    into.candidate_us += p.candidate_us;
    into.qualified_us += p.qualified_us;
    into.samples += p.samples;
    into.command_samples += p.command_samples;
    into.limitations |= p.limitations;
    into.saturated |= (p.limitations & HydronicCounterSaturated) != 0;
}

// Explicit little-endian fields never expose ABI padding, native enum widths or endianness.
// Byte 122 carries the duration edge membership. The remaining reserved byte stays zero.
inline constexpr void hydronic_put(uint8_t*& at, uint64_t value, unsigned bytes) {
    for (unsigned i = 0; i < bytes; ++i) {
        *at++ = static_cast<uint8_t>(value);
        value >>= 8;
    }
}
inline uint64_t hydronic_get(const uint8_t*& at, unsigned bytes) {
    uint64_t value = 0;
    for (unsigned i = 0; i < bytes; ++i) value |= static_cast<uint64_t>(*at++) << (i * 8);
    return value;
}
inline int64_t hydronic_signed64(uint64_t value) {
    return value <= INT64_MAX ? static_cast<int64_t>(value)
                              : -1 - static_cast<int64_t>(UINT64_MAX - value);
}
inline int32_t hydronic_signed32(uint32_t value) {
    return value <= INT32_MAX ? static_cast<int32_t>(value)
                              : -1 - static_cast<int32_t>(UINT32_MAX - value);
}
inline void hydronic_encode(const HydronicHourlyPayload& p, void* destination) {
    auto* at = static_cast<uint8_t*>(destination);
    hydronic_put(at, p.identity.source_fp, 4);
    hydronic_put(at, p.identity.model_fp, 4);
    hydronic_put(at, p.identity.schema_fp, 4);
    hydronic_put(at, p.identity.consent_generation, 4);
    hydronic_put(at, static_cast<uint64_t>(p.first_unix_us), 8);
    hydronic_put(at, static_cast<uint64_t>(p.last_unix_us), 8);
    hydronic_put(at, static_cast<uint64_t>(p.first_accepted_unix_us), 8);
    hydronic_put(at, static_cast<uint64_t>(p.last_accepted_unix_us), 8);
    hydronic_put(at, p.observed_us, 4);
    hydronic_put(at, p.candidate_us, 4);
    hydronic_put(at, p.qualified_us, 4);
    hydronic_put(at, p.samples, 4);
    hydronic_put(at, p.command_samples, 4);
    for (const auto* r : {&p.spread, &p.flow, &p.command}) {
        hydronic_put(at, static_cast<uint64_t>(r->sum_milli), 8);
        hydronic_put(at, static_cast<uint32_t>(r->min_milli), 4);
        hydronic_put(at, static_cast<uint32_t>(r->max_milli), 4);
    }
    hydronic_put(at, p.flags, 2);
    hydronic_put(at, p.dropped, 2);
    hydronic_put(at, p.limitations, 1);
    hydronic_put(at, static_cast<uint8_t>(p.kind), 1);
    hydronic_put(at, p.duration_edges, 1);
    hydronic_put(at, 0, 1);
}
inline bool hydronic_decode(const void* source, size_t bytes, int64_t bucket,
                            HydronicHourlyPayload& p) {
    if (!source || bytes != HYDRONIC_PAYLOAD_BYTES) return false;
    const auto* at                = static_cast<const uint8_t*>(source);
    p.identity.source_fp          = static_cast<uint32_t>(hydronic_get(at, 4));
    p.identity.model_fp           = static_cast<uint32_t>(hydronic_get(at, 4));
    p.identity.schema_fp          = static_cast<uint32_t>(hydronic_get(at, 4));
    p.identity.consent_generation = static_cast<uint32_t>(hydronic_get(at, 4));
    p.first_unix_us               = hydronic_signed64(hydronic_get(at, 8));
    p.last_unix_us                = hydronic_signed64(hydronic_get(at, 8));
    p.first_accepted_unix_us      = hydronic_signed64(hydronic_get(at, 8));
    p.last_accepted_unix_us       = hydronic_signed64(hydronic_get(at, 8));
    p.observed_us                 = static_cast<uint32_t>(hydronic_get(at, 4));
    p.candidate_us                = static_cast<uint32_t>(hydronic_get(at, 4));
    p.qualified_us                = static_cast<uint32_t>(hydronic_get(at, 4));
    p.samples                     = static_cast<uint32_t>(hydronic_get(at, 4));
    p.command_samples             = static_cast<uint32_t>(hydronic_get(at, 4));
    for (auto* r : {&p.spread, &p.flow, &p.command}) {
        r->sum_milli = hydronic_signed64(hydronic_get(at, 8));
        r->min_milli = hydronic_signed32(static_cast<uint32_t>(hydronic_get(at, 4)));
        r->max_milli = hydronic_signed32(static_cast<uint32_t>(hydronic_get(at, 4)));
    }
    p.flags          = static_cast<uint16_t>(hydronic_get(at, 2));
    p.dropped        = static_cast<uint16_t>(hydronic_get(at, 2));
    p.limitations    = static_cast<uint8_t>(hydronic_get(at, 1));
    p.kind           = static_cast<HydronicHourlyKind>(hydronic_get(at, 1));
    p.duration_edges = static_cast<uint8_t>(hydronic_get(at, 1));
    return hydronic_get(at, 1) == 0 && hydronic_hourly_valid(p, bucket);
}
inline constexpr uint32_t hydronic_fingerprint() {
    constexpr uint32_t fingerprint = [] {
        const uint32_t rules[] = {
            0x48594452u,
            HYDRONIC_METHOD,
            HYDRONIC_PAYLOAD_BYTES,
            static_cast<uint32_t>(HYDRONIC_SETTLE_US),
            static_cast<uint32_t>(HYDRONIC_MAX_GAP_US),
            HYDRONIC_SPREAD_MAX_MILLI,
            HYDRONIC_FLOW_MAX_MILLI,
            HYDRONIC_COMMAND_MAX_MILLI,
            HYDRONIC_KNOWN_LIMITATIONS,
            2u}; // inclusive duration edge membership / sample-weighted ranges
        uint8_t bytes[sizeof(rules)]{};
        auto*   at = bytes;
        for (uint32_t rule : rules) hydronic_put(at, rule, 4);
        const uint32_t fp =
            config_crc32_final(config_crc32_update(CONFIG_CRC32_INIT, bytes, sizeof(bytes)));
        return fp ? fp : 1;
    }();
    return fingerprint;
}

inline bool hydronic_header_matches(const HistoryJournalHeader& h) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           history_journal_header_matches(h, hydronic_fingerprint(), HYDRONIC_WORDS, 3600);
}
// Builder-owned append dispatch only; committed evidence still requires the strict reader.
inline bool hydronic_append_owned(const HistoryJournalHeader& h) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           h.catalog_fp == hydronic_fingerprint();
}
inline bool hydronic_header_recognizable(const HistoryJournalHeader& h) {
    // The current catalog marker identifies this format even if another envelope field is
    // damaged. It may have been a fence; failed admission cannot establish otherwise.
    return h.magic == HISTORY_JOURNAL_MAGIC && h.commit == HISTORY_JOURNAL_COMMITTED &&
           h.catalog_fp == hydronic_fingerprint();
}

} // namespace daik::logic
