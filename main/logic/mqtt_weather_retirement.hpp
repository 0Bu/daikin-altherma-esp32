#pragma once
// Frozen discovery identities for retired weather data. Keep only the cleanup contract.
#include "ha_device.hpp"

#include <string>

namespace daik {

inline const RetiredHaSensor RETIRED_WEATHER_HA_SENSORS[] = {
    {"sensor", "weather_forecast_outdoor_mean_2h"},
    {"sensor", "weather_forecast_solar_energy_2h"},
    {"binary_sensor", "weather_forecast_available"},
    {"binary_sensor", "weather_forecast_fresh"},
};
inline constexpr int RETIRED_WEATHER_HA_SENSOR_COUNT =
    sizeof(RETIRED_WEATHER_HA_SENSORS) / sizeof(RETIRED_WEATHER_HA_SENSORS[0]);

inline std::string retired_weather_discovery_topic(const std::string&     prefix,
                                                   const std::string&     node,
                                                   const RetiredHaSensor& sensor) {
    return prefix + "/" + sensor.component + "/" + node + "/" + sensor.object_id + "/config";
}

} // namespace daik
