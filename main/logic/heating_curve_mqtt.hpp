#pragma once
// Domain telemetry for the read-only heating-curve diagnosis. Unlike the board/link heartbeat, this
// payload groups the accepted room source and the derived diagnosis under their own stable objects
// on <base>/heating_curve. Pure string building, IDF-free and host-tested.
#include <cstdint>
#include <string>

namespace daik {

inline constexpr uint8_t HEATING_CURVE_MQTT_SCHEMA_VERSION = 1;

struct HeatingCurveMqttFields {
    // Canonical single-room input (#288). Unavailable numbers render null; numeric validity flags
    // and a stable reason code let metrics consumers distinguish absence from a real zero.
    bool        room_temperature_valid = false;
    bool        room_setpoint_valid = false;
    bool        room_control_eligible = false;
    bool        room_has_source_time = false;
    bool        room_age_known = false;
    double      room_temperature_c = 0.0;
    double      room_setpoint_c = 0.0;
    double      room_error_k = 0.0;
    int64_t     room_source_unix_s = -1;
    uint64_t    room_age_s = 0;
    uint8_t     room_reason_code = 1;
    uint32_t    room_messages = 0;
    uint32_t    room_errors = 0;
    uint32_t    room_rejections = 0;

    // Versioned raw diagnosis evidence. This is not a leaving-water command or calibrated
    // correction. `sequence` plus `last_sample_unix_s` is the durable sample-event contract.
    uint8_t     method_version = 0;
    bool        armed = false;
    uint8_t     state = 0;
    uint8_t     reason = 0;
    bool        sample_eligible = false;
    bool        forecast_available = false;
    bool        plant_gate_known = false;
    bool        plant_gate_active = false;
    bool        heating_mode_known = false;
    bool        heating_mode_active = false;
    bool        has_current_room_error = false;
    bool        has_last_sample = false;
    bool        has_diagnosis_room_source_time = false;
    bool        diagnosis_room_age_known = false;
    double      current_room_error_k = 0.0;
    double      last_sample_room_error_k = 0.0;
    int64_t     diagnosis_room_source_unix_s = -1;
    uint64_t    diagnosis_room_age_s = 0;
    int64_t     last_sample_unix_s = -1;
    uint32_t    sequence = 0;
    uint32_t    evaluations = 0;
    uint32_t    samples = 0;
    uint32_t    holds = 0;
    uint32_t    blocks = 0;
};

inline std::string heating_curve_topic(const std::string& base) {
    return base + "/heating_curve";
}

// Booleans intentionally ride as 1/0 numbers: the existing Telegraf JSON pipeline keeps numeric
// fields and drops JSON bools. Topic + object names now provide the grouping, so the leaf keys do
// not repeat `room_` / `heating_curve_` prefixes.
inline std::string build_heating_curve_mqtt_json(const HeatingCurveMqttFields& f) {
    std::string j = "{\"schema_version\":";
    j += std::to_string(HEATING_CURVE_MQTT_SCHEMA_VERSION);
    j += ",\"room\":{";
    j += "\"source_id\":\"living_room\",\"calibration_k\":0";
    j += ",\"temperature_valid\":"; j += f.room_temperature_valid ? "1" : "0";
    j += ",\"setpoint_valid\":"; j += f.room_setpoint_valid ? "1" : "0";
    j += ",\"control_eligible\":"; j += f.room_control_eligible ? "1" : "0";
    j += ",\"temperature_c\":";
    j += f.room_temperature_valid ? std::to_string(f.room_temperature_c) : "null";
    j += ",\"setpoint_c\":";
    j += f.room_setpoint_valid ? std::to_string(f.room_setpoint_c) : "null";
    j += ",\"error_k\":";
    j += f.room_control_eligible ? std::to_string(f.room_error_k) : "null";
    j += ",\"source_unix_s\":";
    j += f.room_has_source_time ? std::to_string(f.room_source_unix_s) : "null";
    j += ",\"age_s\":";
    j += f.room_age_known ? std::to_string(f.room_age_s) : "null";
    j += ",\"reason_code\":"; j += std::to_string(f.room_reason_code);
    j += ",\"counters\":{";
    j += "\"messages\":"; j += std::to_string(f.room_messages);
    j += ",\"errors\":"; j += std::to_string(f.room_errors);
    j += ",\"rejections\":"; j += std::to_string(f.room_rejections);
    j += "}}";

    j += ",\"diagnosis\":{";
    j += "\"method_version\":"; j += std::to_string(f.method_version);
    j += ",\"armed\":"; j += f.armed ? "1" : "0";
    j += ",\"state\":"; j += std::to_string(f.state);
    j += ",\"reason\":"; j += std::to_string(f.reason);
    j += ",\"sample_eligible\":"; j += f.sample_eligible ? "1" : "0";
    j += ",\"forecast_available\":"; j += f.forecast_available ? "1" : "0";
    j += ",\"gates\":{";
    j += "\"plant_known\":"; j += f.plant_gate_known ? "1" : "0";
    j += ",\"plant_active\":"; j += f.plant_gate_active ? "1" : "0";
    j += ",\"heating_mode_known\":"; j += f.heating_mode_known ? "1" : "0";
    j += ",\"heating_mode_active\":"; j += f.heating_mode_active ? "1" : "0";
    j += "}";
    j += ",\"room_evidence\":{";
    j += "\"current_error_k\":";
    j += f.has_current_room_error ? std::to_string(f.current_room_error_k) : "null";
    j += ",\"source_unix_s\":";
    j += f.has_diagnosis_room_source_time
       ? std::to_string(f.diagnosis_room_source_unix_s) : "null";
    j += ",\"age_s\":";
    j += f.diagnosis_room_age_known ? std::to_string(f.diagnosis_room_age_s) : "null";
    j += "}";
    j += ",\"last_sample\":{";
    j += "\"room_error_k\":";
    j += f.has_last_sample ? std::to_string(f.last_sample_room_error_k) : "null";
    j += ",\"unix_s\":";
    j += f.has_last_sample ? std::to_string(f.last_sample_unix_s) : "null";
    j += ",\"sequence\":"; j += std::to_string(f.sequence);
    j += "}";
    j += ",\"counters\":{";
    j += "\"evaluations\":"; j += std::to_string(f.evaluations);
    j += ",\"samples\":"; j += std::to_string(f.samples);
    j += ",\"holds\":"; j += std::to_string(f.holds);
    j += ",\"blocks\":"; j += std::to_string(f.blocks);
    j += "}}}";
    return j;
}

}  // namespace daik
