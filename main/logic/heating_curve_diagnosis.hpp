#pragma once
// Deterministic, I/O-free HEATING-CURVE DIAGNOSIS sampler.
//
// The implementation no longer contains a controller: it samples the raw room
// deviation during confirmed SPACE-HEATING windows. A room-temperature error is an observation, not
// a calibrated leaving-water-temperature correction; emitter type, water volume, building inertia,
// valves and the room thermostat all affect that transfer. Nothing here quantizes, clamps, slews or
// proposes a setpoint, and nothing here can address the plant.
#include <cmath>
#include <cstdint>

namespace daik::logic {

inline constexpr uint8_t HEATING_CURVE_DIAGNOSIS_METHOD_VERSION = 2;
inline constexpr int64_t HEATING_CURVE_SAMPLE_CADENCE_MS = 30 * 60 * 1000;

enum class HeatingCurveState : uint8_t {
    Off       = 0,
    Recording = 1,
    Hold      = 2,
    Degraded  = 3,
    Blocked   = 4,
};

// Values 5..11 intentionally retain the deployed reason-code meanings. Codes 3 and 4 belonged to
// the retired actuator deadband/rate-limit path and are left unused rather than silently reused.
enum class HeatingCurveReason : uint8_t {
    Disabled            = 0,
    SampleRecorded      = 1,
    SamplingInterval    = 2,
    RoomUnavailable     = 5,
    X10aUnavailable     = 6,
    HomeHubUnavailable  = 7,
    PlantGateUnknown    = 8,
    PlantInactive       = 9,
    ForecastUnavailable = 10,
    ClockInvalid        = 11,
    HeatingModeUnknown  = 12,
    NonHeatingMode      = 13,
};

inline const char* heating_curve_state_name(HeatingCurveState state) {
    switch (state) {
    case HeatingCurveState::Off:       return "off";
    case HeatingCurveState::Recording: return "recording";
    case HeatingCurveState::Hold:      return "hold";
    case HeatingCurveState::Degraded:  return "degraded";
    case HeatingCurveState::Blocked:   return "blocked";
    }
    return "blocked";
}

inline const char* heating_curve_reason_name(HeatingCurveReason reason) {
    switch (reason) {
    case HeatingCurveReason::Disabled:            return "disabled";
    case HeatingCurveReason::SampleRecorded:      return "sample_recorded";
    case HeatingCurveReason::SamplingInterval:    return "sampling_interval";
    case HeatingCurveReason::RoomUnavailable:     return "room_unavailable";
    case HeatingCurveReason::X10aUnavailable:     return "x10a_unavailable";
    case HeatingCurveReason::HomeHubUnavailable:  return "homehub_unavailable";
    case HeatingCurveReason::PlantGateUnknown:    return "plant_gate_unknown";
    case HeatingCurveReason::PlantInactive:       return "plant_inactive";
    case HeatingCurveReason::ForecastUnavailable: return "forecast_unavailable";
    case HeatingCurveReason::ClockInvalid:        return "clock_invalid";
    case HeatingCurveReason::HeatingModeUnknown:  return "heating_mode_unknown";
    case HeatingCurveReason::NonHeatingMode:      return "non_heating_mode";
    }
    return "clock_invalid";
}

struct HeatingCurveInputs {
    bool armed = false;  // configured MQTT room source; forecast is deliberately optional
    bool room_control_eligible = false;
    double room_error_k = 0.0;
    bool x10a_connected = false;
    bool homehub_connected = false;
    bool plant_gate_known = false;
    bool plant_gate_active = false;
    bool heating_mode_known = false;
    bool heating_mode_active = false;
    bool forecast_available = false;
    int64_t now_ms = -1;
    int64_t now_unix_s = -1;
    bool room_has_source_time = false;
    int64_t room_source_unix_s = -1;
    bool room_age_known = false;
    uint64_t room_age_s = 0;
};

struct HeatingCurveSnapshot {
    bool armed = false;
    HeatingCurveState state = HeatingCurveState::Off;
    HeatingCurveReason reason = HeatingCurveReason::Disabled;

    bool sample_eligible = false;
    bool has_current_room_error = false;
    bool has_last_sample = false;
    bool forecast_available = false;
    bool plant_gate_known = false;
    bool plant_gate_active = false;
    bool heating_mode_known = false;
    bool heating_mode_active = false;

    double current_room_error_k = 0.0;
    double last_sample_room_error_k = 0.0;
    bool room_has_source_time = false;
    int64_t room_source_unix_s = -1;
    bool room_age_known = false;
    uint64_t room_age_s = 0;
    int64_t last_sample_unix_s = -1;
    uint32_t sequence = 0;
    uint32_t evaluations = 0;
    uint32_t samples = 0;
    uint32_t holds = 0;
    uint32_t blocks = 0;
};

class HeatingCurveDiagnosis {
public:
    const HeatingCurveSnapshot& snapshot() const { return s_; }

    const HeatingCurveSnapshot& evaluate(const HeatingCurveInputs& in) {
        s_.armed = in.armed;
        s_.sample_eligible = false;
        s_.has_current_room_error = false;
        s_.forecast_available = in.forecast_available;
        s_.plant_gate_known = in.plant_gate_known;
        s_.plant_gate_active = in.plant_gate_known && in.plant_gate_active;
        s_.heating_mode_known = in.heating_mode_known;
        s_.heating_mode_active = in.heating_mode_known && in.heating_mode_active;
        s_.room_has_source_time = in.room_has_source_time;
        s_.room_source_unix_s = in.room_source_unix_s;
        s_.room_age_known = in.room_age_known;
        s_.room_age_s = in.room_age_s;

        if (!in.armed) {
            reset_samples();
            last_now_ms_ = -1;
            s_.state = HeatingCurveState::Off;
            s_.reason = HeatingCurveReason::Disabled;
            return s_;
        }
        s_.evaluations++;

        // An idle plant is the normal all-summer state. Ask whether space conditioning is running
        // before judging the room source or clock, but never call a COOLING window "heating" merely
        // because HomeHub register 53 deliberately covers both modes.
        if (!in.homehub_connected) return blocked(HeatingCurveReason::HomeHubUnavailable);
        if (!in.plant_gate_known) return blocked(HeatingCurveReason::PlantGateUnknown);
        if (!in.plant_gate_active) return hold(HeatingCurveReason::PlantInactive);
        if (!in.heating_mode_known) return blocked(HeatingCurveReason::HeatingModeUnknown);
        if (!in.heating_mode_active) return hold(HeatingCurveReason::NonHeatingMode);

        if (!in.room_control_eligible || !std::isfinite(in.room_error_k))
            return blocked(HeatingCurveReason::RoomUnavailable);
        if (!in.x10a_connected) return blocked(HeatingCurveReason::X10aUnavailable);
        if (in.now_ms < 0 || in.now_unix_s < 0 ||
            (last_now_ms_ >= 0 && in.now_ms < last_now_ms_))
            return blocked(HeatingCurveReason::ClockInvalid);
        last_now_ms_ = in.now_ms;

        s_.sample_eligible = true;
        s_.has_current_room_error = true;
        s_.current_room_error_k = in.room_error_k;
        s_.state = in.forecast_available ? HeatingCurveState::Recording
                                         : HeatingCurveState::Degraded;

        if (last_sample_ms_ >= 0 &&
            in.now_ms - last_sample_ms_ < HEATING_CURVE_SAMPLE_CADENCE_MS) {
            s_.reason = HeatingCurveReason::SamplingInterval;
            return s_;
        }

        s_.has_last_sample = true;
        s_.last_sample_room_error_k = in.room_error_k;
        s_.last_sample_unix_s = in.now_unix_s;
        last_sample_ms_ = in.now_ms;
        s_.sequence++;
        s_.samples++;
        s_.reason = in.forecast_available ? HeatingCurveReason::SampleRecorded
                                          : HeatingCurveReason::ForecastUnavailable;
        return s_;
    }

private:
    const HeatingCurveSnapshot& hold(HeatingCurveReason reason) {
        s_.state = HeatingCurveState::Hold;
        s_.reason = reason;
        s_.holds++;
        return s_;
    }

    const HeatingCurveSnapshot& blocked(HeatingCurveReason reason) {
        s_.state = HeatingCurveState::Blocked;
        s_.reason = reason;
        s_.blocks++;
        return s_;
    }

    void reset_samples() {
        last_sample_ms_ = -1;
        s_.has_last_sample = false;
        s_.last_sample_room_error_k = 0.0;
        s_.last_sample_unix_s = -1;
    }

    HeatingCurveSnapshot s_{};
    int64_t last_sample_ms_ = -1;
    int64_t last_now_ms_ = -1;
};

}  // namespace daik::logic
