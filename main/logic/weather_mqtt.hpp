#pragma once
// Retained MQTT evidence for the weather input known to the firmware. One atomic JSON document
// keeps values, provenance and freshness flags from being observed at different generations. The
// configured coordinates are deliberately excluded: they are not needed to reconstruct a control
// decision and would disclose the installation's precise location.
#include "json.hpp"
#include "ha_device.hpp"
#include "weather_forecast.hpp"

#include <cstdint>
#include <limits>
#include <string>

namespace daik {

struct WeatherMqttSnapshot {
    bool configured = false;
    bool fetching = false;
    bool available = false;
    bool has_value = false;
    double outdoor_mean_2h_c = 0.0;
    double solar_energy_2h_wh_m2 = 0.0;
    int64_t issued_unix_s = -1;
    int64_t fetched_unix_s = -1;
    int64_t forecast_start_unix_s = -1;
    int64_t last_attempt_unix_s = -1;
    uint32_t successes = 0;
    uint32_t errors = 0;
    std::string model = "icon_seamless";
    std::string state = "disabled";
    std::string reason = "not_configured";
    std::string error;
};

inline std::string weather_forecast_topic(const std::string& base) {
    return base + "/weather_forecast";
}

struct WeatherHaSensor {
    const char* component;
    const char* object_id;
    const char* name;
    const char* json_path;
    const char* unit;
    const char* device_class;
    const char* state_class;
    bool diagnostic;
    bool require_forecast_available;
};

inline const WeatherHaSensor WEATHER_HA_SENSORS[] = {
    {"sensor", "weather_forecast_outdoor_mean_2h", "Forecast Outdoor Temperature (2h Mean)",
     "outdoor_mean_2h_c", "°C", "temperature", "measurement", false, true},
    {"sensor", "weather_forecast_solar_energy_2h", "Forecast Solar Energy (2h)",
     "solar_energy_2h_wh_m2", "Wh/m²", "", "measurement", false, true},
    {"binary_sensor", "weather_forecast_available", "Forecast Available",
     "available", "", "", "", true, false},
    {"binary_sensor", "weather_forecast_fresh", "Forecast Fresh",
     "fresh", "", "", "", true, false},
};
inline constexpr int WEATHER_HA_SENSOR_COUNT =
    sizeof(WEATHER_HA_SENSORS) / sizeof(WEATHER_HA_SENSORS[0]);

inline std::string weather_discovery_topic(const std::string& prefix, const std::string& node,
                                           const WeatherHaSensor& s) {
    return prefix + "/" + s.component + "/" + node + "/" + s.object_id + "/config";
}

inline std::string weather_discovery_config(const std::string& node,
                                            const std::string& board_id,
                                            const std::string& weather_topic,
                                            const std::string& avail_topic,
                                            const WeatherHaSensor& s) {
    std::string out = "{\"name\":\"";
    json_append_escaped(out, s.name);
    out += "\",\"uniq_id\":\"";
    out += node;
    out += '_';
    out += s.object_id;
    out += "\",\"stat_t\":\"";
    out += weather_topic;
    out += "\",\"val_tpl\":\"{{ value_json.";
    out += s.json_path;
    out += " }}\",";
    if (s.require_forecast_available) {
        // Both sources matter: LWT catches an offline ESP32, while the retained forecast document
        // catches a live board whose provider data failed or aged out.
        out += "\"availability\":[{\"topic\":\"";
        out += avail_topic;
        out += "\",\"payload_available\":\"online\",\"payload_not_available\":\"offline\"},";
        out += "{\"topic\":\"";
        out += weather_topic;
        out += "\",\"value_template\":\"{{ 'online' if value_json.available == 1 else 'offline' }}\",";
        out += "\"payload_available\":\"online\",\"payload_not_available\":\"offline\"}],";
        out += "\"availability_mode\":\"all\",";
    } else {
        out += "\"avty_t\":\"";
        out += avail_topic;
        out += "\",";
    }
    if (s.component[0] == 'b') out += "\"pl_on\":\"1\",\"pl_off\":\"0\",";
    if (s.unit[0]) {
        out += "\"unit_of_meas\":\"";
        json_append_escaped(out, s.unit);
        out += "\",";
    }
    if (s.device_class[0]) {
        out += "\"dev_cla\":\"";
        out += s.device_class;
        out += "\",";
    }
    if (s.state_class[0]) {
        out += "\"stat_cla\":\"";
        out += s.state_class;
        out += "\",";
    }
    if (s.diagnostic) out += "\"ent_cat\":\"diagnostic\",";
    out += device_json(node, board_id);
    out += '}';
    return out;
}

inline void weather_mqtt_append_string(std::string& out, const char* key,
                                       const std::string& value) {
    out += ",\"";
    out += key;
    out += "\":\"";
    json_append_escaped(out, value);
    out += '"';
}

inline void weather_mqtt_append_timestamp(std::string& out, const char* key, int64_t value) {
    out += ",\"";
    out += key;
    out += "\":";
    out += value >= 0 ? std::to_string(value) : "null";
}

inline std::string build_weather_mqtt_json(const WeatherMqttSnapshot& s, int64_t now_unix_s) {
    const WeatherFreshness freshness = weather_freshness(
        s.has_value, s.fetched_unix_s, now_unix_s);
    // `available` means usable for a decision now, not merely that an older diagnostic value exists.
    const bool available = s.configured && s.available && freshness.fresh;
    int64_t valid_until_unix_s = -1;
    if (s.has_value && s.fetched_unix_s >= 0 &&
        s.fetched_unix_s <= std::numeric_limits<int64_t>::max() - WEATHER_MAX_AGE_S)
        valid_until_unix_s = s.fetched_unix_s + WEATHER_MAX_AGE_S;

    std::string out;
    out.reserve(600);
    out += "{\"schema\":1,\"provider\":\"open-meteo\"";
    weather_mqtt_append_string(out, "model", s.model);
    out += ",\"configured\":";
    out += s.configured ? "1" : "0";
    out += ",\"fetching\":";
    out += s.fetching ? "1" : "0";
    out += ",\"available\":";
    out += available ? "1" : "0";
    out += ",\"fresh\":";
    out += freshness.fresh ? "1" : "0";
    out += ",\"has_value\":";
    out += s.has_value ? "1" : "0";
    weather_mqtt_append_string(out, "state", s.state);
    weather_mqtt_append_string(out, "reason", s.reason);
    weather_mqtt_append_string(out, "freshness_reason", freshness.reason);
    weather_mqtt_append_string(out, "error", s.error);
    out += ",\"max_age_s\":";
    out += std::to_string(WEATHER_MAX_AGE_S);
    weather_mqtt_append_timestamp(out, "issued_unix_s", s.issued_unix_s);
    weather_mqtt_append_timestamp(out, "fetched_unix_s", s.fetched_unix_s);
    weather_mqtt_append_timestamp(out, "forecast_start_unix_s", s.forecast_start_unix_s);
    weather_mqtt_append_timestamp(out, "valid_until_unix_s", valid_until_unix_s);
    weather_mqtt_append_timestamp(out, "last_attempt_unix_s", s.last_attempt_unix_s);
    out += ",\"outdoor_mean_2h_c\":";
    out += s.has_value ? std::to_string(s.outdoor_mean_2h_c) : "null";
    out += ",\"solar_energy_2h_wh_m2\":";
    out += s.has_value ? std::to_string(s.solar_energy_2h_wh_m2) : "null";
    out += ",\"successes\":";
    out += std::to_string(s.successes);
    out += ",\"errors\":";
    out += std::to_string(s.errors);
    out += '}';
    return out;
}

}  // namespace daik
