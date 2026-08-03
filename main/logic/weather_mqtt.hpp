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

// The persisted config and the weather task's runtime snapshot can briefly disagree while
// POST /set_weather wakes the task. Publishing is allowed only after both agree that weather is
// configured. Disabling is different from that short enable transition: it owns a retained-topic
// cleanup probe so an older forecast cannot survive after its source was removed.
enum class WeatherMqttAction { Suppress, Publish, CleanupRetained };

inline WeatherMqttAction weather_mqtt_action(bool config_enabled, bool runtime_configured) {
    if (!config_enabled) return WeatherMqttAction::CleanupRetained;
    return runtime_configured ? WeatherMqttAction::Publish : WeatherMqttAction::Suppress;
}

inline std::string weather_forecast_topic(const std::string& base) {
    return base + "/weather/openmeteo/forecast";
}

// Frozen names from the short-lived HA Discovery contract. Weather is an input to the firmware and
// an MQTT evidence stream, not a second HA weather integration. Keep only these tombstone targets so
// an upgraded board removes the four retained configs that an earlier build may have published.
inline const RetiredHaSensor RETIRED_WEATHER_HA_SENSORS[] = {
    {"sensor", "weather_forecast_outdoor_mean_2h"},
    {"sensor", "weather_forecast_solar_energy_2h"},
    {"binary_sensor", "weather_forecast_available"},
    {"binary_sensor", "weather_forecast_fresh"},
};
inline constexpr int RETIRED_WEATHER_HA_SENSOR_COUNT =
    sizeof(RETIRED_WEATHER_HA_SENSORS) / sizeof(RETIRED_WEATHER_HA_SENSORS[0]);

inline std::string retired_weather_discovery_topic(const std::string& prefix,
                                                   const std::string& node,
                                                   const RetiredHaSensor& sensor) {
    return prefix + "/" + sensor.component + "/" + node + "/" + sensor.object_id + "/config";
}

// Frozen predecessor of weather_forecast_topic(). It is probed and deleted only when a non-empty
// retained payload still exists, so upgrading does not leave two forecast contracts behind.
inline std::string retired_weather_forecast_topic(const std::string& base) {
    return base + "/weather_forecast";
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
