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
// Project filter constants for passive water-temperature agreement during quiescent pump-only
// circulation, NOT published Daikin controller limits or factory tolerances.
constexpr int64_t AGREEMENT_SETTLE_US        = 600'000'000LL;
constexpr int64_t AGREEMENT_STABLE_WINDOW_US = 300'000'000LL;
constexpr int64_t AGREEMENT_STABLE_SUB_US    = 30'000'000LL;
constexpr size_t  AGREEMENT_STABLE_SUBS      = 10;
constexpr int32_t AGREEMENT_DRIFT_MAX_MILLI  = 500;
constexpr int32_t AGREEMENT_FLOW_MIN_MILLI   = 5000;
static_assert(AGREEMENT_STABLE_SUBS * AGREEMENT_STABLE_SUB_US == AGREEMENT_STABLE_WINDOW_US,
              "agreement sub-buckets must span the exact 300 s stationarity window");
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
enum class AgreementReason : uint8_t {
    None,
    Unsupported,
    NoConsent,
    NoSource,
    MissingWitness,
    InvalidReading,
    PumpOff,
    LowFlow,
    CompressorActive,
    HeaterActive,
    Defrost,
    ValveChanged,
    Settling,
    NotStationary,
    PollGap,
    Clock,
    SourceChanged,
    ConsentChanged,
    Overflow,
    Forgotten // live report only; never emitted as a stored delta
};
enum AgreementLimitation : uint8_t {
    AgreementNoLimitation     = 0,
    AgreementR2tUnavailable   = 1u << 0,
    AgreementDhwRoute         = 1u << 1,
    AgreementCounterSaturated = 1u << 2
};
constexpr uint8_t AGREEMENT_KNOWN_LIMITATIONS =
    AgreementR2tUnavailable | AgreementDhwRoute | AgreementCounterSaturated;

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
    bool         post_buh_supported = false;
    bool         post_buh_ambiguous = false;
    bool         post_buh_known     = false;
    double       post_buh_c         = 0;
    bool         bsh_supported      = false;
    bool         bsh_ambiguous      = false;
    HydronicBit  bsh                = HydronicBit::Unknown;
};

struct HydronicDecision {
    bool           observed = false, eligible = false, command_valid = false;
    HydronicReason reason       = HydronicReason::Unsupported;
    uint8_t        limitations  = HydronicNoLimitation;
    int32_t        spread_milli = 0, flow_milli = 0, command_milli = 0;
};

struct AgreementDecision {
    bool            eligible    = false;
    bool            r2_valid    = false;
    AgreementReason reason      = AgreementReason::Unsupported;
    uint8_t         limitations = AgreementNoLimitation;
    int32_t         r1_milli = 0, r4_milli = 0, r2_milli = 0;
    int32_t         r1_r4_milli = 0, r2_r1_milli = 0;
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

inline AgreementDecision agreement_decide(const HydronicSample& s, const HydronicDecision& base) {
    AgreementDecision a;
    const bool r2_valid = s.post_buh_supported && !s.post_buh_ambiguous && s.post_buh_known &&
                          hydronic_temperature_valid(s.post_buh_c);
    a.r2_valid = r2_valid;
    if (!r2_valid) a.limitations |= AgreementR2tUnavailable;
    if (!base.observed) {
        if (base.reason == HydronicReason::Unsupported)
            a.reason = AgreementReason::Unsupported;
        else if (base.reason == HydronicReason::MissingWitness)
            a.reason = AgreementReason::MissingWitness;
        else
            a.reason = AgreementReason::InvalidReading;
        return a;
    }
    if (s.bsh_supported && s.bsh == HydronicBit::Unknown) {
        a.reason = AgreementReason::MissingWitness;
        return a;
    }
    if (s.pump != HydronicBit::On) {
        a.reason = AgreementReason::PumpOff;
        return a;
    }
    if (s.rps > 0) {
        a.reason = AgreementReason::CompressorActive;
        return a;
    }
    if (s.defrost != HydronicBit::Off) {
        a.reason = AgreementReason::Defrost;
        return a;
    }
    if (s.buh1 != HydronicBit::Off || s.buh2 != HydronicBit::Off) {
        a.reason = AgreementReason::HeaterActive;
        return a;
    }
    if (s.bsh_supported && s.bsh == HydronicBit::On) {
        a.reason = AgreementReason::HeaterActive;
        return a;
    }
    if (s.bsh_ambiguous && s.valve_dhw == HydronicBit::On) {
        a.reason = AgreementReason::HeaterActive;
        return a;
    }
    if (hydronic_milli(s.flow_l_min) < AGREEMENT_FLOW_MIN_MILLI) {
        a.reason = AgreementReason::LowFlow;
        return a;
    }
    if (s.valve_dhw == HydronicBit::On) a.limitations |= AgreementDhwRoute;
    a.eligible    = true;
    a.reason      = AgreementReason::None;
    a.r1_milli    = hydronic_milli(s.leaving_c);
    a.r4_milli    = hydronic_milli(s.return_c);
    a.r1_r4_milli = hydronic_milli(s.leaving_c - s.return_c);
    if (r2_valid) {
        a.r2_milli    = hydronic_milli(s.post_buh_c);
        a.r2_r1_milli = hydronic_milli(s.post_buh_c - s.leaving_c);
    }
    return a;
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
    int64_t         from_us = -1, to_us = -1;
    uint64_t        observed_us = 0, candidate_us = 0, qualified_us = 0;
    bool            accepted = false, command_accepted = false, identity_changed = false;
    int32_t         spread_milli = 0, flow_milli = 0, command_milli = 0;
    HydronicReason  reason             = HydronicReason::Unsupported;
    uint8_t         limitations        = HydronicNoLimitation;
    uint64_t        r1_r4_qualified_us = 0, r2_r1_qualified_us = 0;
    int32_t         r1_r4_milli = 0, r2_r1_milli = 0;
    bool            r1_r4_accepted = false, r2_r1_accepted = false;
    bool            r1_r4_window_started = false, r2_r1_window_started = false;
    AgreementReason agree_reason      = AgreementReason::Unsupported;
    uint8_t         agree_limitations = AgreementNoLimitation;
};
struct AgreementSubBucket {
    uint32_t seq   = 0;
    bool     valid = false;
    int32_t  min_a = 0, max_a = 0;
    int32_t  min_b = 0, max_b = 0;
};
struct AgreementPairState {
    int64_t            start_us = -1;
    uint32_t           last_seq = 0;
    AgreementSubBucket history[AGREEMENT_STABLE_SUBS]{};
    AgreementSubBucket active{};
    bool               previous_accepted = false;
    bool               episode_counted   = false;

    void reset_stability() {
        start_us = -1;
        last_seq = 0;
        for (auto& b : history) b = {};
        active            = {};
        previous_accepted = false;
    }
    void reset_run() {
        reset_stability();
        episode_counted = false;
    }
    bool step(int64_t now_us, int32_t val_a, int32_t val_b) {
        if (start_us < 0) {
            start_us = now_us;
            last_seq = 0;
            active   = {0, true, val_a, val_a, val_b, val_b};
            return false;
        }
        const uint64_t elapsed = static_cast<uint64_t>(now_us - start_us);
        const uint64_t seq64   = elapsed / static_cast<uint64_t>(AGREEMENT_STABLE_SUB_US);
        if (seq64 > UINT32_MAX) {
            reset_stability();
            start_us = now_us;
            active   = {0, true, val_a, val_a, val_b, val_b};
            return false;
        }
        const uint32_t seq = static_cast<uint32_t>(seq64);
        if (seq > last_seq) {
            history[active.seq % AGREEMENT_STABLE_SUBS] = active;
            for (uint32_t s = last_seq + 1; s < seq && s - last_seq <= AGREEMENT_STABLE_SUBS; ++s)
                history[s % AGREEMENT_STABLE_SUBS] = {};
            if (seq - last_seq > AGREEMENT_STABLE_SUBS)
                for (auto& b : history) b = {};
            active   = {seq, true, val_a, val_a, val_b, val_b};
            last_seq = seq;
        } else {
            if (val_a < active.min_a) active.min_a = val_a;
            if (val_a > active.max_a) active.max_a = val_a;
            if (val_b < active.min_b) active.min_b = val_b;
            if (val_b > active.max_b) active.max_b = val_b;
        }
        if (now_us - start_us < AGREEMENT_STABLE_WINDOW_US) return false;
        int32_t min_a = active.min_a, max_a = active.max_a;
        int32_t min_b = active.min_b, max_b = active.max_b;
        for (uint32_t k = 1; k <= AGREEMENT_STABLE_SUBS; ++k) {
            const uint32_t want = seq - k;
            const auto&    b    = history[want % AGREEMENT_STABLE_SUBS];
            if (!b.valid) return false;
            if (b.min_a < min_a) min_a = b.min_a;
            if (b.max_a > max_a) max_a = b.max_a;
            if (b.min_b < min_b) min_b = b.min_b;
            if (b.max_b > max_b) max_b = b.max_b;
        }
        return (static_cast<int64_t>(max_a) - min_a) <= AGREEMENT_DRIFT_MAX_MILLI &&
               (static_cast<int64_t>(max_b) - min_b) <= AGREEMENT_DRIFT_MAX_MILLI;
    }
};
struct AgreementCounters {
    uint64_t      r1_r4_qualified_us = 0, r2_r1_qualified_us = 0;
    uint32_t      r1_r4_samples = 0, r2_r1_samples = 0;
    uint32_t      r1_r4_windows = 0, r2_r1_windows = 0;
    HydronicRange r1_r4, r2_r1;
    uint8_t       limitations = AgreementNoLimitation;
    bool          saturated   = false;
};
struct AgreementTracker {
    AgreementCounters  counters;
    AgreementPairState r1_r4, r2_r1;
    int64_t            eligible_since_us  = -1;
    HydronicBit        candidate_valve    = HydronicBit::Unknown;
    bool               previous_quiescent = false;
    AgreementReason    reason             = AgreementReason::Unsupported;

    void reset_continuity() {
        eligible_since_us  = -1;
        candidate_valve    = HydronicBit::Unknown;
        previous_quiescent = false;
        r1_r4.reset_run();
        r2_r1.reset_run();
    }
    void reset() {
        counters = AgreementCounters{};
        reset_continuity();
        reason = AgreementReason::Unsupported;
    }
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
    AgreementTracker          agreement;
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
        agreement.reset_continuity();
    }
    void reset() {
        counters  = HydronicCounters{};
        secondary = {};
        agreement.reset();
        source_generation = consent_generation = 0;
        last_us = eligible_since_us = last_completion_us = -1;
        previous_observed = previous_eligible = previous_qualified = false;
        consent = bound = false;
        reason          = HydronicReason::Unsupported;
    }
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

inline void hydronic_record_agreement(AgreementTracker& a, const AgreementDecision& d,
                                      HydronicBit valve_dhw, int64_t now_us, uint64_t dt,
                                      AgreementReason agree_barrier, HydronicDelta& out) {
    out.agree_limitations = d.limitations;
    out.agree_reason      = d.reason;
    if (!d.r2_valid) a.r2_r1.reset_stability();
    if (!d.eligible) {
        a.reset_continuity();
    } else {
        if (a.previous_quiescent && a.candidate_valve != valve_dhw) {
            a.reset_continuity();
            agree_barrier = AgreementReason::ValveChanged;
        }
        if (!a.previous_quiescent) {
            a.eligible_since_us = now_us;
            a.candidate_valve   = valve_dhw;
        }
        const bool r1_r4_stationary = a.r1_r4.step(now_us, d.r1_milli, d.r4_milli);
        const bool r2_r1_stationary =
            d.r2_valid ? a.r2_r1.step(now_us, d.r2_milli, d.r1_milli) : false;
        const bool settled = now_us - a.eligible_since_us >= AGREEMENT_SETTLE_US;
        if (!settled) {
            out.agree_reason = AgreementReason::Settling;
        } else {
            const auto admit_pair =
                [&](AgreementPairState& pair, bool stationary, uint32_t& samples, uint32_t& windows,
                    uint64_t& qualified_us, HydronicRange& range, int32_t delta_milli,
                    bool& out_accepted, bool& out_win, int32_t& out_milli, uint64_t& out_qual_us) {
                    if (!stationary) {
                        pair.previous_accepted = false;
                        return;
                    }
                    if (samples == UINT32_MAX || (!pair.episode_counted && windows == UINT32_MAX)) {
                        a.counters.saturated   = true;
                        pair.previous_accepted = false;
                        return;
                    }
                    range.fold(delta_milli, samples);
                    ++samples;
                    out_accepted = true;
                    out_milli    = delta_milli;
                    if (!pair.episode_counted) {
                        pair.episode_counted = true;
                        out_win              = true;
                        ++windows;
                    }
                    if (pair.previous_accepted) {
                        out_qual_us = dt;
                        hydronic_add_time(qualified_us, dt, a.counters.saturated);
                    }
                    pair.previous_accepted = true;
                };
            admit_pair(a.r1_r4, r1_r4_stationary, a.counters.r1_r4_samples,
                       a.counters.r1_r4_windows, a.counters.r1_r4_qualified_us, a.counters.r1_r4,
                       d.r1_r4_milli, out.r1_r4_accepted, out.r1_r4_window_started, out.r1_r4_milli,
                       out.r1_r4_qualified_us);
            admit_pair(a.r2_r1, d.r2_valid && r2_r1_stationary, a.counters.r2_r1_samples,
                       a.counters.r2_r1_windows, a.counters.r2_r1_qualified_us, a.counters.r2_r1,
                       d.r2_r1_milli, out.r2_r1_accepted, out.r2_r1_window_started, out.r2_r1_milli,
                       out.r2_r1_qualified_us);
            if (out.r1_r4_accepted || out.r2_r1_accepted) {
                out.agree_reason = AgreementReason::None;
                a.counters.limitations |= d.limitations;
            } else if (r1_r4_stationary || (d.r2_valid && r2_r1_stationary)) {
                out.agree_reason = AgreementReason::Overflow;
            } else {
                out.agree_reason = AgreementReason::NotStationary;
            }
        }
        a.previous_quiescent = true;
    }
    if (agree_barrier != AgreementReason::None) out.agree_reason = agree_barrier;
    if (a.counters.saturated) {
        out.agree_limitations |= AgreementCounterSaturated;
        a.counters.limitations |= AgreementCounterSaturated;
    }
    a.reason = out.agree_reason;
}

// The caller provides one completed SAME-sweep sample, monotonic completion time and actual
// sweep duration. A sweep lasting >15 s is itself a blind interval. Exactly 15 s connects;
// exactly 600 s accepts the first sample, but only two qualified endpoints credit duration.
inline HydronicDelta hydronic_record(HydronicTracker& t, const HydronicSample& s, int64_t now_us,
                                     int64_t sweep_us, uint32_t source_generation,
                                     uint32_t consent_generation, bool consent) {
    HydronicDelta out;
    out.to_us                     = now_us;
    HydronicReason  barrier       = HydronicReason::None;
    AgreementReason agree_barrier = AgreementReason::None;
    if (t.bound && t.source_generation != source_generation) {
        barrier       = HydronicReason::SourceChanged;
        agree_barrier = AgreementReason::SourceChanged;
    }
    if (t.bound && (t.consent_generation != consent_generation || t.consent != consent)) {
        barrier       = HydronicReason::ConsentChanged;
        agree_barrier = AgreementReason::ConsentChanged;
    }
    if (!t.bound || barrier != HydronicReason::None) {
        t.reset();
        t.source_generation  = source_generation;
        t.consent_generation = consent_generation;
        t.consent            = consent;
        t.bound              = true;
        out.identity_changed = barrier != HydronicReason::None;
    }
    const auto stop = [&](HydronicReason reason, AgreementReason agree_reason) {
        t.reset_continuity();
        t.reason = out.reason = reason;
        t.agreement.reason = out.agree_reason = agree_reason;
        return out;
    };
    if (!consent) return stop(HydronicReason::NoConsent, AgreementReason::NoConsent);
    if (!source_generation) return stop(HydronicReason::NoSource, AgreementReason::NoSource);
    // Accepted timestamps and local totals share one monotonic epoch. A backwards/repeated
    // completion cannot extend that population into a replacement clock. Durable hours belong
    // to the caller and are unaffected; the rejected sweep contributes nothing.
    if (now_us < 0 || (t.last_completion_us >= 0 && now_us <= t.last_completion_us)) {
        t.counters           = HydronicCounters{};
        t.agreement.counters = AgreementCounters{};
        t.last_completion_us = now_us; // rejected baseline; the next increasing sample may restart
        return stop(HydronicReason::Clock, AgreementReason::Clock);
    }
    t.last_completion_us = now_us; // a completed but unusable sweep still observes the clock
    if (sweep_us < 0 || sweep_us > now_us)
        return stop(HydronicReason::Clock, AgreementReason::Clock);
    if (sweep_us > HYDRONIC_MAX_GAP_US)
        return stop(HydronicReason::PollGap, AgreementReason::PollGap);
    const auto d       = hydronic_decide(s);
    const auto d_agree = agreement_decide(s, d);
    out.limitations    = d.limitations;
    out.reason         = d.reason;
    uint64_t dt        = 0;
    if (t.last_us >= 0) {
        if (now_us - t.last_us > HYDRONIC_MAX_GAP_US) {
            t.reset_continuity();
            barrier       = HydronicReason::PollGap;
            agree_barrier = AgreementReason::PollGap;
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
    hydronic_record_agreement(t.agreement, d_agree, s.valve_dhw, now_us, dt, agree_barrier, out);
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
    t.reason           = HydronicReason::PollGap;
    t.agreement.reason = AgreementReason::PollGap;
}

} // namespace daik::logic
