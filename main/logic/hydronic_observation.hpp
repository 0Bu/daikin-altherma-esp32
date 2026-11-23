#pragma once
// Descriptive common water-side heat-exchanger observations, never an emitter measurement or a
// hydraulic verdict. The 600 s run-up is a project filter, not proof of thermal stationarity.
#include <climits>
#include <cmath>
#include <cstdint>

#include "convert.hpp"

namespace daik::logic {

constexpr int64_t HYDRONIC_SETTLE_US  = 600000000;
constexpr int64_t HYDRONIC_MAX_GAP_US = 15000000;
// Encoding validity bound for positive conv-105 values, not a manufacturer physical flow limit.
constexpr double  HYDRONIC_FLOW_MAX_L_MIN = 3276.7;
constexpr uint8_t HYDRONIC_ALL_PHASES     = 15;

enum class HydronicBit : uint8_t { Unknown, Off, On };
enum class HydronicMode : uint8_t { Unknown, Heating, Cooling, Other };
enum class HydronicReason : uint8_t {
    None,
    Unsupported,
    NoConsent,
    NoSource,
    MissingWitness,
    InvalidReading,
    PumpOff,
    CompressorOff,
    NotHeating,
    Dhw,
    Defrost,
    Buh,
    SpecialPhase,
    Settling,
    PollGap,
    Clock,
    SourceChanged,
    ConsentChanged,
    Overflow,
    Forgotten // live report only; never emitted as a stored delta
};
enum HydronicLimitation : uint8_t {
    HydronicNoLimitation       = 0,
    HydronicUnobservablePhase  = 1u << 0,
    HydronicCommandUnavailable = 1u << 1,
    HydronicCounterSaturated   = 1u << 2
};

struct HydronicSample {
    bool         supported         = false;
    bool         phase_ambiguous   = false;
    uint8_t      phase_supported   = 0;
    bool         command_supported = false;
    bool         leaving_known = false, return_known = false, flow_known = false, rps_known = false;
    double       leaving_c = 0, return_c = 0, flow_l_min = 0, rps = 0;
    HydronicBit  pump = HydronicBit::Unknown, valve_dhw = HydronicBit::Unknown;
    HydronicBit  defrost = HydronicBit::Unknown;
    HydronicBit  buh1 = HydronicBit::Unknown, buh2 = HydronicBit::Unknown;
    HydronicMode mode           = HydronicMode::Unknown;
    HydronicBit  phase[4]       = {}; // restart standby, startup, oil return, pressure equalizing
    bool         command_known  = false;
    double       command_signal = 0; // inverted controller command, never measured speed
    bool         secondary_known = false;
    double       secondary_c     = 0;
};

struct HydronicDecision {
    bool           observed = false, eligible = false, command_valid = false;
    HydronicReason reason       = HydronicReason::Unsupported;
    uint8_t        limitations  = HydronicNoLimitation;
    int32_t        spread_milli = 0, flow_milli = 0, command_milli = 0;
};

inline int32_t hydronic_milli(double value) {
    return static_cast<int32_t>(value * 1000.0 + (value < 0 ? -0.5 : 0.5));
}
inline bool hydronic_temperature_valid(double value) {
    return std::isfinite(value) && value >= TEMP_MIN_C && value <= TEMP_MAX_C;
}
inline HydronicDecision hydronic_decide(const HydronicSample& s) {
    HydronicDecision d;
    if (s.phase_supported != HYDRONIC_ALL_PHASES) d.limitations |= HydronicUnobservablePhase;
    d.command_valid = s.command_supported && s.command_known && std::isfinite(s.command_signal) &&
                      s.command_signal >= 0 && s.command_signal <= 100;
    if (d.command_valid)
        d.command_milli = hydronic_milli(100.0 - s.command_signal);
    else
        d.limitations |= HydronicCommandUnavailable;
    if (!s.supported || s.phase_ambiguous) return d;
    d.reason = HydronicReason::MissingWitness;
    if (!s.leaving_known || !s.return_known || !s.flow_known || !s.rps_known ||
        s.pump == HydronicBit::Unknown || s.valve_dhw == HydronicBit::Unknown ||
        s.defrost == HydronicBit::Unknown || s.buh1 == HydronicBit::Unknown ||
        s.buh2 == HydronicBit::Unknown || s.mode == HydronicMode::Unknown)
        return d;
    for (unsigned k = 0; k < 4; ++k)
        if ((s.phase_supported & (1u << k)) && s.phase[k] == HydronicBit::Unknown) return d;
    d.reason = HydronicReason::InvalidReading;
    if (!hydronic_temperature_valid(s.leaving_c) || !hydronic_temperature_valid(s.return_c) ||
        !std::isfinite(s.flow_l_min) || s.flow_l_min < 0 ||
        s.flow_l_min > HYDRONIC_FLOW_MAX_L_MIN || !std::isfinite(s.rps) || s.rps < 0 ||
        s.rps > 65535) // conv-152 domain; no guessed model speed limit
        return d;
    d.observed = true; // readable witnesses include known OFF/non-heating observations
    d.reason   = HydronicReason::PumpOff;
    if (s.pump != HydronicBit::On) return d;
    d.reason = HydronicReason::CompressorOff;
    if (s.rps <= 0) return d;
    d.reason = HydronicReason::NotHeating;
    if (s.mode != HydronicMode::Heating) return d;
    d.reason = HydronicReason::Dhw;
    if (s.valve_dhw != HydronicBit::Off) return d;
    d.reason = HydronicReason::Defrost;
    if (s.defrost != HydronicBit::Off) return d;
    d.reason = HydronicReason::Buh;
    if (s.buh1 != HydronicBit::Off || s.buh2 != HydronicBit::Off) return d;
    d.reason = HydronicReason::SpecialPhase;
    for (unsigned k = 0; k < 4; ++k)
        if (s.phase[k] == HydronicBit::On) return d;
    d.reason = HydronicReason::InvalidReading;
    if (s.flow_l_min == 0) return d;
    d.eligible     = true;
    d.reason       = HydronicReason::None;
    d.spread_milli = hydronic_milli(s.leaving_c - s.return_c);
    d.flow_milli   = hydronic_milli(s.flow_l_min);
    return d;
}

// Fixed milli-units preserve fractional pump-command inversion. The accepted population is
// SAMPLE weighted. Even UINT32_MAX samples at the wire/envelope maxima fit these int64 sums.
struct HydronicRange {
    int64_t sum_milli = 0;
    int32_t min_milli = 0, max_milli = 0;
    void    fold(int32_t value, uint32_t previous_samples) {
        if (!previous_samples)
            min_milli = max_milli = value;
        else {
            if (value < min_milli) min_milli = value;
            if (value > max_milli) max_milli = value;
        }
        sum_milli += value;
    }
    double mean(uint32_t samples) const {
        return samples ? static_cast<double>(sum_milli) / samples / 1000.0 : 0;
    }
};
struct HydronicCounters {
    uint64_t      observed_us = 0, candidate_us = 0, qualified_us = 0;
    uint32_t      samples = 0, command_samples = 0;
    HydronicRange spread, flow, command;
    int64_t       first_accepted_us = -1, last_accepted_us = -1;
    uint8_t       limitations = HydronicNoLimitation;
    bool          saturated   = false;
};
struct HydronicDelta {
    // Durations refer only to [from_us, to_us]; consumers may partition that interval by hour.
    int64_t        from_us = -1, to_us = -1;
    uint64_t       observed_us = 0, candidate_us = 0, qualified_us = 0;
    bool           accepted = false, command_accepted = false, identity_changed = false;
    int32_t        spread_milli = 0, flow_milli = 0, command_milli = 0;
    HydronicReason reason      = HydronicReason::Unsupported;
    uint8_t        limitations = HydronicNoLimitation;
};
struct SecondarySupplyComparison {
    int64_t  since_us = -1, first_accepted_us = -1, latest_sweep_start_us = -1;
    int64_t  sum_milli   = 0;
    uint64_t duration_us = 0;
    uint32_t samples     = 0;

    bool current(int64_t now_us) const {
        return samples && latest_sweep_start_us >= 0 && now_us >= latest_sweep_start_us &&
               now_us - latest_sweep_start_us <= HYDRONIC_MAX_GAP_US;
    }
};
struct HydronicTracker {
    HydronicCounters          counters;
    SecondarySupplyComparison secondary;
    uint32_t                  source_generation = 0, consent_generation = 0;
    int64_t                   last_us = -1, eligible_since_us = -1;
    int64_t        last_completion_us = -1; // epoch guard survives continuity interruptions
    bool           previous_observed = false, previous_eligible = false, previous_qualified = false;
    bool           consent = false, bound = false;
    HydronicReason reason = HydronicReason::Unsupported;
    void           reset_continuity() {
        last_us = eligible_since_us = -1;
        previous_observed = previous_eligible = previous_qualified = false;
        secondary                                                  = {};
    }
    void reset() { *this = HydronicTracker{}; }
};

inline void hydronic_record_secondary(SecondarySupplyComparison& comparison,
                                      const HydronicSample& sample, bool eligible, bool accepted,
                                      int64_t now_us, int64_t sweep_us) {
    if (!eligible || !sample.leaving_known || !sample.secondary_known ||
        !hydronic_temperature_valid(sample.leaving_c) ||
        !hydronic_temperature_valid(sample.secondary_c)) {
        comparison = {};
        return;
    }
    if (comparison.since_us < 0) comparison.since_us = now_us;
    if (!accepted || now_us - comparison.since_us < HYDRONIC_SETTLE_US ||
        comparison.samples == UINT32_MAX)
        return;
    if (comparison.first_accepted_us < 0) comparison.first_accepted_us = now_us;
    comparison.latest_sweep_start_us = now_us - sweep_us;
    comparison.duration_us           = static_cast<uint64_t>(now_us - comparison.first_accepted_us);
    comparison.sum_milli += hydronic_milli(sample.leaving_c - sample.secondary_c);
    ++comparison.samples;
}

inline void hydronic_add_time(uint64_t& total, uint64_t delta, bool& saturated) {
    if (delta > UINT64_MAX - total) {
        total     = UINT64_MAX;
        saturated = true;
    } else
        total += delta;
}

// The caller provides one completed SAME-sweep sample, monotonic completion time and actual
// sweep duration. A sweep lasting >15 s is itself a blind interval. Exactly 15 s connects;
// exactly 600 s accepts the first sample, but only two qualified endpoints credit duration.
inline HydronicDelta hydronic_record(HydronicTracker& t, const HydronicSample& s, int64_t now_us,
                                     int64_t sweep_us, uint32_t source_generation,
                                     uint32_t consent_generation, bool consent) {
    HydronicDelta out;
    out.to_us              = now_us;
    HydronicReason barrier = HydronicReason::None;
    if (t.bound && t.source_generation != source_generation)
        barrier = HydronicReason::SourceChanged;
    if (t.bound && (t.consent_generation != consent_generation || t.consent != consent))
        barrier = HydronicReason::ConsentChanged;
    if (!t.bound || barrier != HydronicReason::None) {
        t.reset();
        t.source_generation  = source_generation;
        t.consent_generation = consent_generation;
        t.consent            = consent;
        t.bound              = true;
        out.identity_changed = barrier != HydronicReason::None;
    }
    const auto stop = [&](HydronicReason reason) {
        t.reset_continuity();
        t.reason = out.reason = reason;
        return out;
    };
    if (!consent) return stop(HydronicReason::NoConsent);
    if (!source_generation) return stop(HydronicReason::NoSource);
    // Accepted timestamps and local totals share one monotonic epoch. A backwards/repeated
    // completion cannot extend that population into a replacement clock. Durable hours belong
    // to the caller and are unaffected; the rejected sweep contributes nothing.
    if (now_us < 0 || (t.last_completion_us >= 0 && now_us <= t.last_completion_us)) {
        t.counters           = HydronicCounters{};
        t.last_completion_us = now_us; // rejected baseline; the next increasing sample may restart
        return stop(HydronicReason::Clock);
    }
    t.last_completion_us = now_us; // a completed but unusable sweep still observes the clock
    if (sweep_us < 0 || sweep_us > now_us) return stop(HydronicReason::Clock);
    if (sweep_us > HYDRONIC_MAX_GAP_US) return stop(HydronicReason::PollGap);
    const auto d    = hydronic_decide(s);
    out.limitations = d.limitations;
    out.reason      = d.reason;
    uint64_t dt     = 0;
    if (t.last_us >= 0) {
        if (now_us - t.last_us > HYDRONIC_MAX_GAP_US) {
            t.reset_continuity();
            barrier = HydronicReason::PollGap;
        } else {
            out.from_us = t.last_us;
            dt          = static_cast<uint64_t>(now_us - t.last_us);
        }
    }
    if (d.observed && t.previous_observed) out.observed_us = dt;
    if (d.eligible && t.previous_eligible) out.candidate_us = dt;
    if (!d.eligible)
        t.eligible_since_us = -1;
    else if (!t.previous_eligible)
        t.eligible_since_us = now_us;
    const bool qualified = d.eligible && t.eligible_since_us >= 0 &&
                           now_us - t.eligible_since_us >= HYDRONIC_SETTLE_US;
    if (qualified && t.previous_qualified) out.qualified_us = dt;
    hydronic_add_time(t.counters.observed_us, out.observed_us, t.counters.saturated);
    hydronic_add_time(t.counters.candidate_us, out.candidate_us, t.counters.saturated);
    hydronic_add_time(t.counters.qualified_us, out.qualified_us, t.counters.saturated);
    if (qualified) {
        if (t.counters.samples == UINT32_MAX) {
            t.counters.saturated = true;
            out.reason           = HydronicReason::Overflow;
        } else {
            t.counters.spread.fold(d.spread_milli, t.counters.samples);
            t.counters.flow.fold(d.flow_milli, t.counters.samples);
            ++t.counters.samples;
            if (t.counters.first_accepted_us < 0) t.counters.first_accepted_us = now_us;
            t.counters.last_accepted_us = now_us;
            out.accepted                = true;
            out.spread_milli            = d.spread_milli;
            out.flow_milli              = d.flow_milli;
            if (d.command_valid) {
                if (t.counters.command_samples == UINT32_MAX)
                    t.counters.saturated = true;
                else {
                    t.counters.command.fold(d.command_milli, t.counters.command_samples++);
                    out.command_accepted = true;
                    out.command_milli    = d.command_milli;
                }
            }
        }
        t.counters.limitations |= d.limitations;
    } else if (d.eligible)
        out.reason = HydronicReason::Settling;
    hydronic_record_secondary(t.secondary, s, d.eligible, out.accepted, now_us, sweep_us);
    if (barrier != HydronicReason::None) out.reason = barrier;
    if (t.counters.saturated) {
        out.limitations |= HydronicCounterSaturated;
        t.counters.limitations |= HydronicCounterSaturated;
    }
    t.last_us            = now_us;
    t.previous_observed  = d.observed;
    t.previous_eligible  = d.eligible;
    t.previous_qualified = qualified;
    t.reason             = out.reason;
    return out;
}

// A deliberately skipped/failed poll is not a synthetic compressor-OFF sample.
inline void hydronic_poll_gap(HydronicTracker& t) {
    t.reset_continuity();
    t.reason = HydronicReason::PollGap;
}

} // namespace daik::logic
