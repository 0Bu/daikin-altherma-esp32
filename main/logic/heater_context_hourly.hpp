#pragma once

#include "heater_context.hpp"
#include <climits>
#include <cstddef>
#include <cstdint>

namespace daik::logic::heater_context_hourly {

constexpr int64_t HOUR_US = 3600000000LL;
static_assert(heater_context::MAX_GAP_US < HOUR_US, "one interval crosses at most one hour seam");
struct Piece {
    int64_t  bucket          = -1;
    uint32_t first_offset_us = 0;
    uint32_t last_offset_us  = 0;
    uint32_t duration_us     = 0;
    bool     samples         = false;
};
struct Split {
    Piece    pieces[2];
    uint32_t interval_us = 0;
    uint8_t  count       = 0;
    bool     seeded      = false;
};
static_assert(sizeof(Split) <= 64, "bounded hour-boundary metadata");

// Date both endpoints with the same admitted clock offset. A continued <=15s interval crosses
// at most one UTC-hour seam. Splitting credits only its already qualified durations; the single
// real endpoint sample belongs to its actual end hour, including exactly on the hour boundary.
// The caller must retire clock corrections before this function: it never invents a new endpoint.
inline bool split(heater_context::Admission admission, int64_t previous_wall_us,
                  int64_t sample_wall_us, Split& result) {
    if ((admission != heater_context::Admission::Seeded &&
         admission != heater_context::Admission::Continued) ||
        sample_wall_us < 0)
        return false;
    Split         next{};
    const int64_t bucket = sample_wall_us / HOUR_US;
    const auto    offset = static_cast<uint32_t>(sample_wall_us % HOUR_US);
    if (admission == heater_context::Admission::Seeded) {
        next.pieces[0] = {bucket, offset, offset, 0, true};
        next.count     = 1;
        next.seeded    = true;
    } else {
        if (previous_wall_us < 0 || previous_wall_us >= sample_wall_us ||
            sample_wall_us - previous_wall_us > heater_context::MAX_GAP_US)
            return false;
        next.interval_us              = static_cast<uint32_t>(sample_wall_us - previous_wall_us);
        const int64_t previous_bucket = previous_wall_us / HOUR_US;
        const auto    previous_offset = static_cast<uint32_t>(previous_wall_us % HOUR_US);
        if (previous_bucket == bucket) {
            next.pieces[0] = {bucket, previous_offset, offset, next.interval_us, true};
            next.count     = 1;
        } else {
            const auto before = static_cast<uint32_t>(HOUR_US - previous_offset);
            next.pieces[0]    = {previous_bucket, previous_offset, static_cast<uint32_t>(HOUR_US),
                                 before, false};
            next.pieces[1]    = {bucket, 0, offset, next.interval_us - before, true};
            next.count        = 2;
        }
    }
    result = next; // failure preserves the caller's last valid plan
    return true;
}

inline bool valid_split(const Split& plan) {
    if (!plan.count || plan.count > 2 || plan.interval_us > heater_context::MAX_GAP_US)
        return false;
    uint32_t total = 0;
    for (size_t i = 0; i < plan.count; ++i) {
        const auto& p = plan.pieces[i];
        if (p.bucket < 0 || p.first_offset_us >= HOUR_US || p.first_offset_us > p.last_offset_us ||
            p.last_offset_us > HOUR_US || p.bucket > (INT64_MAX - p.last_offset_us) / HOUR_US ||
            p.duration_us != p.last_offset_us - p.first_offset_us ||
            p.duration_us > plan.interval_us || p.samples != (i + 1 == plan.count) ||
            (p.samples && p.last_offset_us >= HOUR_US))
            return false;
        total += p.duration_us;
    }
    if (total != plan.interval_us) return false;
    if (plan.seeded) return plan.count == 1 && plan.interval_us == 0;
    if (!plan.interval_us) return false;
    if (plan.count == 2) {
        const auto& before = plan.pieces[0];
        const auto& after  = plan.pieces[1];
        if (after.bucket <= before.bucket || after.bucket - before.bucket != 1 ||
            before.last_offset_us != HOUR_US || after.first_offset_us != 0)
            return false;
    }
    return true;
}

// `delta` is a fresh zeroed Hour passed to exactly one reducer step. Each duration is therefore
// either zero or that one qualified interval, and each sample counter is zero or one. Reject
// aggregates here: proportionally dividing accumulated category time would fabricate placement.
inline bool valid_delta(const heater_context::Hour& delta, uint32_t interval_us) {
    if (interval_us > heater_context::MAX_GAP_US) return false;
    for (const auto& c : delta.heater) {
        if (c.saturated || c.samples > 1 || c.readable_samples > c.samples ||
            c.on_samples > c.readable_samples)
            return false;
        const auto duration = [interval_us](uint32_t value) {
            return value == 0 || value == interval_us;
        };
#define HC_DURATION(field)                                                                         \
    if (!duration(c.field)) return false
        HC_DURATION(readable_us);
        HC_DURATION(on_us);
        HC_DURATION(off_us);
        HC_DURATION(transition_us);
        HC_DURATION(unreadable_us);
        HC_DURATION(union_us);
        HC_DURATION(overlap_us);
        HC_DURATION(unknown_context_us);
        HC_DURATION(unclassified_us);
        HC_DURATION(complete_context_us);
#undef HC_DURATION
        if (uint64_t(c.on_us) + c.off_us + c.transition_us != c.readable_us ||
            uint64_t(c.readable_us) + c.unreadable_us != (c.samples ? interval_us : 0) ||
            uint64_t(c.union_us) + c.unclassified_us != c.on_us ||
            uint64_t(c.unknown_context_us) + c.complete_context_us != c.on_us ||
            c.overlap_us > c.union_us || (c.readable_us && c.readable_samples != 1) ||
            (c.on_us && c.on_samples != 1) || (c.off_us && c.on_samples != 0))
            return false;
        unsigned positives = 0;
        bool     all_known = c.on_us != 0;
        for (size_t k = 0; k < heater_context::CATEGORIES; ++k) {
            if (!duration(c.positive_us[k]) || !duration(c.evaluable_on_us[k]) ||
                c.positive_us[k] > c.evaluable_on_us[k] || c.evaluable_on_us[k] > c.on_us ||
                c.positive_samples[k] > c.evaluable_on_samples[k] ||
                c.evaluable_on_samples[k] > c.on_samples ||
                (c.evaluable_on_us[k] && c.evaluable_on_samples[k] != 1) ||
                (c.evaluable_on_us[k] && bool(c.positive_us[k]) != bool(c.positive_samples[k])))
                return false;
            if (c.positive_us[k]) ++positives;
            if (c.evaluable_on_us[k] != c.on_us) all_known = false;
        }
        if (c.union_us != (positives ? c.on_us : 0) ||
            c.overlap_us != (positives > 1 ? c.on_us : 0) ||
            c.complete_context_us != (all_known ? c.on_us : 0))
            return false;
    }
    return true;
}

// No full Hour/Fragment automatic copy. The owner supplies distinct unpublished staging and
// folds each piece exactly once into the matching hourly candidate before queue/claim handling.
inline bool merge_piece(heater_context::Hour& into, const heater_context::Hour& delta,
                        const Split& plan, size_t index) {
    if (&into == &delta || !valid_split(plan) || index >= plan.count ||
        !valid_delta(delta, plan.interval_us))
        return false;
    const auto& p = plan.pieces[index];
    for (size_t h = 0; h < heater_context::HEATERS; ++h) {
        auto&       target = into.heater[h];
        const auto& source = delta.heater[h];
#define HC_DURATION(field)                                                                         \
    heater_context::add(target.field, source.field ? p.duration_us : 0, target.saturated)
        HC_DURATION(readable_us);
        HC_DURATION(on_us);
        HC_DURATION(off_us);
        HC_DURATION(transition_us);
        HC_DURATION(unreadable_us);
        HC_DURATION(union_us);
        HC_DURATION(overlap_us);
        HC_DURATION(unknown_context_us);
        HC_DURATION(unclassified_us);
        HC_DURATION(complete_context_us);
#undef HC_DURATION
#define HC_SAMPLE(field)                                                                           \
    if (p.samples) heater_context::add(target.field, source.field, target.saturated)
        HC_SAMPLE(samples);
        HC_SAMPLE(readable_samples);
        HC_SAMPLE(on_samples);
        for (size_t k = 0; k < heater_context::CATEGORIES; ++k) {
            heater_context::add(target.positive_us[k], source.positive_us[k] ? p.duration_us : 0,
                                target.saturated);
            heater_context::add(target.evaluable_on_us[k],
                                source.evaluable_on_us[k] ? p.duration_us : 0, target.saturated);
            HC_SAMPLE(positive_samples[k]);
            HC_SAMPLE(evaluable_on_samples[k]);
        }
#undef HC_SAMPLE
    }
    return true;
}

} // namespace daik::logic::heater_context_hourly
