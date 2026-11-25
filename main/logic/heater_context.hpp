#pragma once

#include "checkup.hpp"
#include "outdoor_evidence.hpp"
#include <climits>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <type_traits>

namespace daik::logic::heater_context {

// Reported flag co-occurrence, separately for BUH and BSH. Contexts overlap; they do not
// identify causes, delivered heat, consumption or whether heater operation was necessary.
// These gap, recovery, temperature and notice limits are provisional project rules.
constexpr int64_t  MAX_GAP_US  = 15000000;
constexpr int64_t  RECOVERY_US = 300000000; // project look-back/tail, not a Daikin limit
constexpr uint64_t NOTICE_US   = 900000000; // accumulated sampled time, not consecutive runtime
constexpr int      MILD_TENTHS = 20;        // cold <= +2.0 C; mild > +2.0 C, project split
constexpr size_t   HEATERS = 2, CATEGORIES = 9;
enum class Bit : uint8_t { Unknown, Off, On };
enum class Heater : uint8_t { Buh, Bsh };
enum class Category : uint8_t {
    Emergency,
    Error,
    DefrostRecovery,
    DhwRoute,
    Silent,
    ColdOutdoor,
    MildOutdoor,
    CompressorOff,
    QuietMildHeating
};
constexpr uint16_t mask(Category c) { return static_cast<uint16_t>(1u << unsigned(c)); }
constexpr uint16_t ALL = (1u << CATEGORIES) - 1;
constexpr Bit      tri_or(Bit a, Bit b) {
    if (a == Bit::On || b == Bit::On) return Bit::On;
    if (a == Bit::Off && b == Bit::Off) return Bit::Off;
    return Bit::Unknown;
}
constexpr Bit tri_and(Bit a, Bit b) {
    if (a == Bit::Off || b == Bit::Off) return Bit::Off;
    if (a == Bit::On && b == Bit::On) return Bit::On;
    return Bit::Unknown;
}
constexpr Bit truth(bool known, bool on) { return !known ? Bit::Unknown : on ? Bit::On : Bit::Off; }

// Known means supported and readable in the same admitted sweep. Optional unknown inputs
// suppress only their dependent contexts. External outdoor evidence, if supplied by a later
// adapter, must keep its own real source/generation/freshness; it supplies no X10A flag witness.
struct Sample {
    Bit                  heater[HEATERS]{};
    Bit                  emergency = Bit::Unknown, error = Bit::Unknown, defrost = Bit::Unknown;
    Bit                  silent = Bit::Unknown, dhw = Bit::Unknown, compressor_off = Bit::Unknown;
    CheckupOperatingMode mode               = CheckupOperatingMode::Unknown;
    OutdoorSource        outdoor_source     = OutdoorSource::None;
    uint32_t             outdoor_generation = 0;
    int16_t              outdoor_tenths     = 0;
    bool                 outdoor_known      = false;
};
// Compact hourly clocks use microseconds: 3,600,000,000 < UINT32_MAX. They are NOT 24 h totals.
// Wide aggregate instantiation below preserves exact addition over the maximum 24 h horizon.
template <class Time, class Count> struct Counters {
    Time  readable_us = 0, on_us = 0, off_us = 0, transition_us = 0, unreadable_us = 0;
    Time  positive_us[CATEGORIES]{}, evaluable_on_us[CATEGORIES]{};
    Time  union_us = 0, overlap_us = 0, unknown_context_us = 0, unclassified_us = 0;
    Time  complete_context_us = 0;
    Count samples = 0, readable_samples = 0, on_samples = 0;
    Count positive_samples[CATEGORIES]{}, evaluable_on_samples[CATEGORIES]{};
    bool  saturated = false;
};
using HourCounters = Counters<uint32_t, uint16_t>;
using Totals       = Counters<uint64_t, uint32_t>;
struct Hour {
    HourCounters heater[HEATERS];
};
static_assert(std::is_trivially_copyable<Hour>::value, "nonallocating POD");
static_assert(sizeof(HourCounters) <= 160 && sizeof(Totals) <= 320,
              "heater-context representation bound");
template <class T, class U> inline void add(T& into, U value, bool& saturated) {
    if (uint64_t(value) > uint64_t(std::numeric_limits<T>::max() - into)) {
        into      = std::numeric_limits<T>::max();
        saturated = true;
    } else
        into = T(into + value);
}
struct Endpoint {
    Bit context[CATEGORIES]{};
};
struct State {
    Sample   previous;
    Endpoint previous_context;
    int64_t  previous_us = -1, recovery_until_us = -1, uncertain_until_us = -1;
    uint32_t generation = 0, schema_fp = 0;
    uint16_t capability_mask   = 0;
    uint8_t  supported_heaters = 0;
    bool     active            = false;
};
static_assert(std::is_trivially_copyable<State>::value && std::is_standard_layout<State>::value &&
                  sizeof(State) <= 96 && sizeof(Sample) <= 24,
              "bounded nonallocating reducer");
enum class Admission : uint8_t { Paused, Seeded, Continued };
inline void pause(State& s) {
    s.active      = false;
    s.previous_us = -1;
}
inline int64_t deadline(int64_t now) {
    return now <= INT64_MAX - RECOVERY_US ? now + RECOVERY_US : INT64_MAX;
}
inline Endpoint endpoint(State& st, const Sample& s, int64_t now, bool continuous) {
    Endpoint   e;
    const bool heating       = s.dhw == Bit::Off && s.mode == CheckupOperatingMode::Heating;
    const bool segment_known = s.dhw != Bit::Unknown && s.mode != CheckupOperatingMode::Unknown;
    if (!continuous) {
        st.recovery_until_us  = -1;
        st.uncertain_until_us = deadline(now);
    }
    if (s.defrost == Bit::Unknown) {
        st.recovery_until_us  = -1;
        st.uncertain_until_us = deadline(now);
    } else if (continuous && st.previous.defrost == Bit::On && s.defrost == Bit::Off && heating &&
               st.previous.dhw == Bit::Off && st.previous.mode == CheckupOperatingMode::Heating) {
        st.recovery_until_us  = deadline(now);
        st.uncertain_until_us = -1;
    }
    // No resumption after route/cooling/unknown-segment interruption; a new witnessed edge is
    // needed.
    if (!heating) st.recovery_until_us = -1;
    Bit recovery = Bit::Unknown;
    if (segment_known) {
        if (!heating)
            recovery = Bit::Off;
        else if (st.recovery_until_us >= 0 && now < st.recovery_until_us)
            recovery = Bit::On;
        else if (now >= st.uncertain_until_us)
            recovery = Bit::Off;
    }
    e.context[size_t(Category::Emergency)]       = s.emergency;
    e.context[size_t(Category::Error)]           = s.error;
    e.context[size_t(Category::DefrostRecovery)] = tri_or(s.defrost, recovery);
    e.context[size_t(Category::DhwRoute)]        = s.dhw;
    e.context[size_t(Category::Silent)]          = s.silent;
    e.context[size_t(Category::ColdOutdoor)] =
        truth(s.outdoor_known, s.outdoor_tenths <= MILD_TENTHS);
    e.context[size_t(Category::MildOutdoor)] =
        truth(s.outdoor_known, s.outdoor_tenths > MILD_TENTHS);
    e.context[size_t(Category::CompressorOff)] = s.compressor_off;
    const Bit space                            = truth(segment_known, heating);
    e.context[size_t(Category::QuietMildHeating)] =
        tri_and(space, tri_and(s.silent, e.context[size_t(Category::MildOutdoor)]));
    for (size_t k = 0; k < CATEGORIES; ++k)
        if (!(st.capability_mask & (1u << k))) e.context[k] = Bit::Unknown;
    return e;
}

// The owner folds a per-sweep delta into one open hour. Split real crossing intervals at the
// absolute-hour seam without inventing sensor endpoints; sample counts belong to the ending hour.
// A model/consent change must retire the old identity and pause before calling this reducer:
// generation/schema/masks alone do not encode the owner's complete lifecycle identity.
// Source/schema/capability transitions break continuity; caller also retires old identity totals.
// `enabled=false`, an invalid clock or missing source confirmation never seeds a future endpoint.
inline Admission step(State& st, Hour& hour, int64_t now, uint32_t generation, uint32_t schema_fp,
                      uint8_t supported_heaters, uint16_t capability_mask, const Sample& s,
                      bool enabled = true) {
    if (!enabled || now < 0 || now > INT64_MAX - RECOVERY_US || !generation || !schema_fp) {
        pause(st);
        return Admission::Paused;
    }
    const bool continuous = st.active && generation == st.generation && schema_fp == st.schema_fp &&
                            supported_heaters == st.supported_heaters &&
                            capability_mask == st.capability_mask && now > st.previous_us &&
                            uint64_t(now) - uint64_t(st.previous_us) <= uint64_t(MAX_GAP_US);
    st.generation        = generation;
    st.schema_fp         = schema_fp;
    st.supported_heaters = supported_heaters;
    st.capability_mask   = capability_mask;
    const auto e         = endpoint(st, s, now, continuous);
    for (size_t h = 0; h < HEATERS; ++h) {
        if (!(supported_heaters & (1u << h))) continue;
        auto& c = hour.heater[h];
        add(c.samples, 1u, c.saturated);
        if (s.heater[h] != Bit::Unknown) add(c.readable_samples, 1u, c.saturated);
        if (s.heater[h] == Bit::On) {
            add(c.on_samples, 1u, c.saturated);
            for (size_t k = 0; k < CATEGORIES; ++k) {
                if (e.context[k] != Bit::Unknown) add(c.evaluable_on_samples[k], 1u, c.saturated);
                if (e.context[k] == Bit::On) add(c.positive_samples[k], 1u, c.saturated);
            }
        }
        if (!continuous) continue;
        const uint32_t dt = uint32_t(now - st.previous_us);
        const Bit      a = st.previous.heater[h], b = s.heater[h];
        if (a == Bit::Unknown || b == Bit::Unknown) {
            add(c.unreadable_us, dt, c.saturated);
            continue;
        }
        add(c.readable_us, dt, c.saturated);
        if (a != b) {
            add(c.transition_us, dt, c.saturated);
            continue;
        }
        if (a == Bit::Off) {
            add(c.off_us, dt, c.saturated);
            continue;
        }
        add(c.on_us, dt, c.saturated);
        unsigned positives = 0;
        bool     all_known = true;
        for (size_t k = 0; k < CATEGORIES; ++k) {
            const bool outdoor = k == size_t(Category::ColdOutdoor) ||
                                 k == size_t(Category::MildOutdoor) ||
                                 k == size_t(Category::QuietMildHeating);
            const bool same_outdoor =
                !outdoor || (st.previous.outdoor_source == s.outdoor_source &&
                             st.previous.outdoor_generation == s.outdoor_generation);
            const Bit before = st.previous_context.context[k], after = e.context[k];
            // Different endpoint states are not a full interval of either state.
            const bool known = same_outdoor && before != Bit::Unknown && before == after;
            if (known)
                add(c.evaluable_on_us[k], dt, c.saturated);
            else
                all_known = false;
            if (known && after == Bit::On) {
                add(c.positive_us[k], dt, c.saturated);
                ++positives;
            }
        }
        if (positives)
            add(c.union_us, dt, c.saturated);
        else
            add(c.unclassified_us, dt, c.saturated);
        if (positives > 1) add(c.overlap_us, dt, c.saturated);
        if (!all_known)
            add(c.unknown_context_us, dt, c.saturated);
        else
            add(c.complete_context_us, dt, c.saturated);
    }
    st.previous         = s;
    st.previous_context = e;
    st.previous_us      = now;
    st.active           = true;
    return continuous ? Admission::Continued : Admission::Seeded;
}

template <class A, class B> inline void merge(A& into, const B& src) {
#define HEATER_CONTEXT_ADD(field) add(into.field, src.field, into.saturated)
    HEATER_CONTEXT_ADD(readable_us);
    HEATER_CONTEXT_ADD(on_us);
    HEATER_CONTEXT_ADD(off_us);
    HEATER_CONTEXT_ADD(transition_us);
    HEATER_CONTEXT_ADD(unreadable_us);
    HEATER_CONTEXT_ADD(union_us);
    HEATER_CONTEXT_ADD(overlap_us);
    HEATER_CONTEXT_ADD(unknown_context_us);
    HEATER_CONTEXT_ADD(unclassified_us);
    HEATER_CONTEXT_ADD(complete_context_us);
    HEATER_CONTEXT_ADD(samples);
    HEATER_CONTEXT_ADD(readable_samples);
    HEATER_CONTEXT_ADD(on_samples);
    for (size_t k = 0; k < CATEGORIES; ++k) {
        HEATER_CONTEXT_ADD(positive_us[k]);
        HEATER_CONTEXT_ADD(evaluable_on_us[k]);
        HEATER_CONTEXT_ADD(positive_samples[k]);
        HEATER_CONTEXT_ADD(evaluable_on_samples[k]);
    }
    into.saturated = into.saturated || src.saturated;
#undef HEATER_CONTEXT_ADD
}
inline bool notice(const Totals& c, Category category) {
    return (category == Category::Silent || category == Category::MildOutdoor ||
            category == Category::QuietMildHeating) &&
           c.positive_us[size_t(category)] >= NOTICE_US;
}
// A negative result remains a bounded sampled absence; it is never an OK/normal assessment.
struct CoverageGate {
    uint64_t horizon_us = 0;
    bool     confirmed = false, dated = false, full_span = false;
    bool     partial = true, pending = true, loss = false;
};
inline bool absence_assessable(const Totals& c, Category category, uint16_t supported,
                               const CoverageGate& g) {
    return (supported & mask(category)) && g.confirmed && g.dated && g.full_span && !g.partial &&
           !g.pending && !g.loss &&
           g.horizon_us >= uint64_t(CHECKUP_COMPLETED_BUCKETS) * CHECKUP_DT_S * 1000000u &&
           g.horizon_us <= uint64_t(CHECKUP_WINDOW_US) && !c.saturated &&
           c.readable_us == g.horizon_us && !c.transition_us && !c.unreadable_us &&
           c.evaluable_on_us[size_t(category)] == c.on_us;
}

} // namespace daik::logic::heater_context
