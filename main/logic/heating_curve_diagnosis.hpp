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
    // The sampler is not RUNNING at all — it lives on the MQTT publish task, which does not exist
    // when the broker is unconfigured (mqtt_ha.cpp returns before creating it) or when the board came
    // up in safe mode (main.cpp skips every optional consumer). The snapshot is then still
    // default-constructed, i.e. Off/Disabled, while `armed` is derived from the saved room mapping
    // plus active HomeHub at
    // request time — so /status reported `armed:true` beside `reason:"disabled"`, and the UI, keying
    // on the state alone, told the reader to set up the very room source sitting configured one row
    // below. This reason exists so those two situations stop sharing a wording: Disabled means "no
    // room source is mapped", this one means "one is, and nothing is evaluating it".
    SamplerInactive     = 14,
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
    case HeatingCurveReason::SamplerInactive:     return "sampler_inactive";
    }
    return "clock_invalid";
}

// Is this snapshot one the evaluator never produced?
//
// The evaluator assigns `s_.armed = in.armed` before anything else, so a snapshot it HAS touched can
// never carry armed=true together with Off/Disabled — that combination means the reporting surface
// computed `armed` from the configuration while the sampler's task was never created (no broker, or
// safe mode). /status is the only surface that can see it: the MQTT heartbeat exists only when the
// task does. Pure so the substitution is asserted rather than re-derived at the call site, and so it
// stays one rule if a second reporting surface ever appears.
inline bool heating_curve_sampler_inactive(bool armed_by_config, HeatingCurveState state,
                                           HeatingCurveReason reason) {
    return armed_by_config && state == HeatingCurveState::Off &&
           reason == HeatingCurveReason::Disabled;
}

// The reason a reporting surface should publish, given what the configuration says about arming.
// Identity in every ordinary case; SamplerInactive exactly when the snapshot is untouched.
inline HeatingCurveReason heating_curve_reported_reason(bool armed_by_config,
                                                        HeatingCurveState state,
                                                        HeatingCurveReason reason) {
    return heating_curve_sampler_inactive(armed_by_config, state, reason)
         ? HeatingCurveReason::SamplerInactive : reason;
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
    // Optional LOCAL outdoor-air context for a recorded event, from the ENV III accessory when one
    // is configured and its sample is fresh. A room error alone cannot separate a heating curve that
    // is too STEEP from one shifted too HIGH: +0.5 K at -5 C and +0.5 K at +12 C ask for opposite
    // corrections and produce an identical record without this axis. Deliberately NOT a gate — an
    // installation without the sensor samples exactly as before, so this only widens what an event
    // carries. The caller owns freshness; an unavailable or non-finite value records as absent
    // rather than as a zero that would read like 0 C.
    bool outdoor_available = false;
    double outdoor_temperature_c = 0.0;
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
    // Live outdoor context, and the value AS IT STOOD at the recorded event. The two are separate
    // because the sensor may fail between events: the last sample keeps the reading it was taken
    // with, and a later sample without the sensor clears it rather than inheriting an older one.
    bool has_outdoor_temperature = false;
    bool has_last_sample_outdoor = false;
    bool plant_gate_known = false;
    bool plant_gate_active = false;
    bool heating_mode_known = false;
    bool heating_mode_active = false;

    double current_room_error_k = 0.0;
    double last_sample_room_error_k = 0.0;
    double outdoor_temperature_c = 0.0;
    double last_sample_outdoor_temperature_c = 0.0;
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
        // Recorded beside the forecast flag and BEFORE the arming check, like every other piece of
        // optional context: it is reported whatever the state, and no branch below reads it.
        s_.has_outdoor_temperature =
            in.outdoor_available && std::isfinite(in.outdoor_temperature_c);
        s_.outdoor_temperature_c = s_.has_outdoor_temperature ? in.outdoor_temperature_c : 0.0;
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
        // Assigned UNCONDITIONALLY with the event: a sample taken while the sensor is missing must
        // clear the previous event's reading, never inherit it under a new timestamp.
        s_.has_last_sample_outdoor = s_.has_outdoor_temperature;
        s_.last_sample_outdoor_temperature_c =
            s_.has_outdoor_temperature ? in.outdoor_temperature_c : 0.0;
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
        s_.has_last_sample_outdoor = false;
        s_.last_sample_outdoor_temperature_c = 0.0;
        s_.last_sample_unix_s = -1;
    }

    HeatingCurveSnapshot s_{};
    int64_t last_sample_ms_ = -1;
    int64_t last_now_ms_ = -1;
};

}  // namespace daik::logic
