#pragma once
// Deterministic, I/O-free leaving-water shadow controller — the HEATING-CURVE DIAGNOSIS.
// Its proposal is a MEASUREMENT, never a command: aggregated over a heating season it answers
// whether the weather-dependent curve is set correctly. Nothing here can reach the plant.
//
// This file deliberately has no dependency on the Modbus transport. The runtime
// adapter may observe HomeHub/X10A facts and publish this snapshot, but there is no type here that
// can address a register or offer an actuator intent. That structural boundary is the safety proof
// for SHADOW: a proposed offset is evidence only.
#include <cmath>
#include <cstdint>

namespace daik::logic {

enum class DynamicLwtMode : uint8_t {
    Off    = 0,
    Shadow = 1,
};

inline constexpr bool dynamic_lwt_mode_valid(DynamicLwtMode mode) {
    return mode == DynamicLwtMode::Off || mode == DynamicLwtMode::Shadow;
}

inline constexpr DynamicLwtMode dynamic_lwt_mode_from_int(int value) {
    return value == static_cast<int>(DynamicLwtMode::Shadow) ? DynamicLwtMode::Shadow
                                                             : DynamicLwtMode::Off;
}

inline const char* dynamic_lwt_mode_name(DynamicLwtMode mode) {
    return mode == DynamicLwtMode::Shadow ? "shadow" : "off";
}

inline bool dynamic_lwt_mode_parse(const char* value, DynamicLwtMode& out) {
    if (!value) return false;
    if (value[0] == 'o' && value[1] == 'f' && value[2] == 'f' && value[3] == '\0') {
        out = DynamicLwtMode::Off;
        return true;
    }
    if (value[0] == 's' && value[1] == 'h' && value[2] == 'a' && value[3] == 'd' &&
        value[4] == 'o' && value[5] == 'w' && value[6] == '\0') {
        out = DynamicLwtMode::Shadow;
        return true;
    }
    return false;  // ACTIVE is intentionally not part of the accepted vocabulary.
}

enum class DynamicLwtState : uint8_t {
    Off      = 0,
    Shadow   = 1,
    Hold     = 2,
    Degraded = 3,
    Failsafe = 4,
};

enum class DynamicLwtReason : uint8_t {
    Disabled            = 0,
    ShadowDecision      = 1,
    CadenceWait         = 2,
    Deadband            = 3,
    RateLimited         = 4,
    RoomUnavailable     = 5,
    X10aUnavailable     = 6,
    HomeHubUnavailable  = 7,
    PlantGateUnknown    = 8,
    PlantInactive       = 9,
    ForecastUnavailable = 10,
    ClockInvalid        = 11,
};

inline const char* dynamic_lwt_state_name(DynamicLwtState state) {
    switch (state) {
    case DynamicLwtState::Off:      return "off";
    case DynamicLwtState::Shadow:   return "shadow";
    case DynamicLwtState::Hold:     return "hold";
    case DynamicLwtState::Degraded: return "degraded";
    case DynamicLwtState::Failsafe: return "failsafe";
    }
    return "failsafe";
}

inline const char* dynamic_lwt_reason_name(DynamicLwtReason reason) {
    switch (reason) {
    case DynamicLwtReason::Disabled:            return "disabled";
    case DynamicLwtReason::ShadowDecision:      return "shadow_decision";
    case DynamicLwtReason::CadenceWait:         return "cadence_wait";
    case DynamicLwtReason::Deadband:            return "deadband";
    case DynamicLwtReason::RateLimited:         return "rate_limited";
    case DynamicLwtReason::RoomUnavailable:     return "room_unavailable";
    case DynamicLwtReason::X10aUnavailable:     return "x10a_unavailable";
    case DynamicLwtReason::HomeHubUnavailable:  return "homehub_unavailable";
    case DynamicLwtReason::PlantGateUnknown:    return "plant_gate_unknown";
    case DynamicLwtReason::PlantInactive:       return "plant_inactive";
    case DynamicLwtReason::ForecastUnavailable: return "forecast_unavailable";
    case DynamicLwtReason::ClockInvalid:        return "clock_invalid";
    }
    return "clock_invalid";
}

inline constexpr double  DYNAMIC_LWT_P_GAIN              = 1.0;
inline constexpr double  DYNAMIC_LWT_DEADBAND_K          = 0.25;
inline constexpr int16_t DYNAMIC_LWT_OFFSET_MIN_K        = -2;
inline constexpr int16_t DYNAMIC_LWT_OFFSET_MAX_K        = 2;
inline constexpr int16_t DYNAMIC_LWT_MAX_STEP_K          = 1;
inline constexpr int64_t DYNAMIC_LWT_DECISION_CADENCE_MS = 30 * 60 * 1000;

struct DynamicLwtInputs {
    DynamicLwtMode mode = DynamicLwtMode::Off;
    bool room_control_eligible = false;
    double room_error_k = 0.0;
    bool x10a_connected = false;
    bool homehub_connected = false;
    bool plant_gate_known = false;
    bool plant_gate_active = false;
    bool forecast_available = false;
    int64_t now_ms = -1;
    bool room_has_source_time = false;
    int64_t room_source_unix_s = -1;
    bool room_age_known = false;
    uint64_t room_age_s = 0;
};

struct DynamicLwtSnapshot {
    DynamicLwtMode mode = DynamicLwtMode::Off;
    DynamicLwtState state = DynamicLwtState::Off;
    DynamicLwtReason reason = DynamicLwtReason::Disabled;

    bool decision_eligible = false;
    bool proposal_produced = false;
    bool has_terms = false;
    bool has_requested_offset = false;
    bool deadband = false;
    bool quantized = false;
    bool clamped = false;
    bool rate_limited = false;
    bool forecast_available = false;
    bool plant_gate_known = false;
    bool plant_gate_active = false;

    double room_error_k = 0.0;
    double p_term_k = 0.0;
    double unclamped_offset_k = 0.0;
    int16_t bounded_offset_k = 0;
    int16_t requested_offset_k = 0;
    int16_t forecast_contribution_k = 0;  // permanently zero — the forecast is evidence, not input

    bool room_has_source_time = false;
    int64_t room_source_unix_s = -1;
    bool room_age_known = false;
    uint64_t room_age_s = 0;
    int64_t last_decision_ms = -1;
    uint32_t sequence = 0;
    uint32_t evaluations = 0;
    uint32_t decisions = 0;
    uint32_t holds = 0;
    uint32_t failsafes = 0;
};

inline int16_t dynamic_lwt_quantize(double value) {
    // Whole-kelvin HomeHub granularity. std::round specifies halves away from zero.
    return static_cast<int16_t>(std::round(value));
}

class DynamicLwtShadowController {
public:
    const DynamicLwtSnapshot& snapshot() const { return s_; }

    const DynamicLwtSnapshot& evaluate(const DynamicLwtInputs& in) {
        s_.mode = dynamic_lwt_mode_valid(in.mode) ? in.mode : DynamicLwtMode::Off;
        s_.proposal_produced = false;
        s_.decision_eligible = false;
        s_.has_terms = false;
        s_.has_requested_offset = false;
        s_.deadband = false;
        s_.quantized = false;
        s_.clamped = false;
        s_.rate_limited = false;
        s_.forecast_available = in.forecast_available;
        s_.plant_gate_known = in.plant_gate_known;
        s_.plant_gate_active = in.plant_gate_known && in.plant_gate_active;
        s_.room_has_source_time = in.room_has_source_time;
        s_.room_source_unix_s = in.room_source_unix_s;
        s_.room_age_known = in.room_age_known;
        s_.room_age_s = in.room_age_s;

        if (s_.mode == DynamicLwtMode::Off) {
            // OFF is a real disarm, not merely a display state. Re-enabling SHADOW starts from no
            // remembered proposal and may evaluate immediately.
            reset_proposal_memory();
            s_.last_decision_ms = -1;
            last_now_ms_ = -1;
            s_.state = DynamicLwtState::Off;
            s_.reason = DynamicLwtReason::Disabled;
            return s_;
        }
        s_.evaluations++;
        if (in.now_ms < 0 || (last_now_ms_ >= 0 && in.now_ms < last_now_ms_))
            return failsafe(DynamicLwtReason::ClockInvalid);
        last_now_ms_ = in.now_ms;
        if (!in.room_control_eligible || !std::isfinite(in.room_error_k))
            return failsafe(DynamicLwtReason::RoomUnavailable);
        if (!in.x10a_connected) return failsafe(DynamicLwtReason::X10aUnavailable);
        if (!in.homehub_connected) return failsafe(DynamicLwtReason::HomeHubUnavailable);
        if (!in.plant_gate_known) return failsafe(DynamicLwtReason::PlantGateUnknown);
        if (!in.plant_gate_active) {
            // A stopped plant carries no actionable proposal across its hold interval. When it
            // becomes active again, start a fresh, rate-limited decision from neutral immediately.
            reset_proposal_memory();
            s_.state = DynamicLwtState::Hold;
            s_.reason = DynamicLwtReason::PlantInactive;
            s_.holds++;
            return s_;
        }

        s_.decision_eligible = true;
        s_.room_error_k = in.room_error_k;
        s_.p_term_k = in.room_error_k * DYNAMIC_LWT_P_GAIN;
        s_.unclamped_offset_k = s_.p_term_k;
        s_.has_terms = true;
        s_.state = in.forecast_available ? DynamicLwtState::Shadow : DynamicLwtState::Degraded;
        const int16_t quantized = target_from_error(in.room_error_k);
        s_.bounded_offset_k = quantized;

        if (cadence_from_ms_ >= 0 &&
            in.now_ms - cadence_from_ms_ < DYNAMIC_LWT_DECISION_CADENCE_MS) {
            s_.reason = DynamicLwtReason::CadenceWait;
            s_.has_requested_offset = have_last_requested_;
            s_.requested_offset_k = last_requested_k_;
            return s_;
        }

        int16_t requested = quantized;
        // OFF/boot/failsafe/hold all restart at the neutral 0 K proposal. Therefore "max 1 K per
        // decision" also covers the FIRST decision; it is not a loophole that may jump to ±2 K.
        const int16_t previous = have_last_requested_ ? last_requested_k_ : 0;
        const int delta = static_cast<int>(requested) - static_cast<int>(previous);
        if (delta > DYNAMIC_LWT_MAX_STEP_K) {
            requested = static_cast<int16_t>(previous + DYNAMIC_LWT_MAX_STEP_K);
            s_.rate_limited = true;
        } else if (delta < -DYNAMIC_LWT_MAX_STEP_K) {
            requested = static_cast<int16_t>(previous - DYNAMIC_LWT_MAX_STEP_K);
            s_.rate_limited = true;
        }

        have_last_requested_ = true;
        last_requested_k_ = requested;
        s_.requested_offset_k = requested;
        s_.has_requested_offset = true;
        s_.proposal_produced = true;
        s_.last_decision_ms = in.now_ms;
        cadence_from_ms_ = in.now_ms;
        s_.sequence++;
        s_.decisions++;
        s_.reason = s_.rate_limited ? DynamicLwtReason::RateLimited
                  : s_.deadband ? DynamicLwtReason::Deadband
                  : !in.forecast_available ? DynamicLwtReason::ForecastUnavailable
                                           : DynamicLwtReason::ShadowDecision;
        return s_;
    }

private:
    void reset_proposal_memory() {
        have_last_requested_ = false;
        last_requested_k_ = 0;
        cadence_from_ms_ = -1;
    }

    const DynamicLwtSnapshot& failsafe(DynamicLwtReason reason) {
        // Never let a proposal or its cadence survive missing safety evidence. The last decision
        // timestamp stays visible for diagnosis, but recovery is a fresh step from neutral.
        reset_proposal_memory();
        s_.state = DynamicLwtState::Failsafe;
        s_.reason = reason;
        s_.failsafes++;
        return s_;
    }

    int16_t target_from_error(double room_error_k) {
        if (std::fabs(room_error_k) <= DYNAMIC_LWT_DEADBAND_K) {
            s_.deadband = true;
            return 0;
        }
        const int16_t q = dynamic_lwt_quantize(room_error_k * DYNAMIC_LWT_P_GAIN);
        s_.quantized = std::fabs(room_error_k * DYNAMIC_LWT_P_GAIN - static_cast<double>(q)) > 1e-9;
        if (q < DYNAMIC_LWT_OFFSET_MIN_K) {
            s_.clamped = true;
            return DYNAMIC_LWT_OFFSET_MIN_K;
        }
        if (q > DYNAMIC_LWT_OFFSET_MAX_K) {
            s_.clamped = true;
            return DYNAMIC_LWT_OFFSET_MAX_K;
        }
        return q;
    }

    DynamicLwtSnapshot s_{};
    bool have_last_requested_ = false;
    int16_t last_requested_k_ = 0;
    int64_t cadence_from_ms_ = -1;
    int64_t last_now_ms_ = -1;
};

}  // namespace daik::logic
