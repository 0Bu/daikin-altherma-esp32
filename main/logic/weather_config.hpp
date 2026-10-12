#pragma once

#include "config_model.hpp"
#include <cstdint>
#include <type_traits>

namespace daik {

struct WeatherConfigSnapshot {
    bool     diagnostics_enabled    = false;
    bool     weather_enabled        = false;
    uint32_t diagnostics_generation = 0;
    int32_t  weather_latitude_e6    = 0;
    int32_t  weather_longitude_e6   = 0;
};

static_assert(std::is_trivially_copyable_v<WeatherConfigSnapshot>);

inline WeatherConfigSnapshot weather_config_snapshot(const Config& config) noexcept {
    return {config.diagnostics_enabled, config.weather_enabled, config.diagnostics_generation,
            config.weather_latitude_e6, config.weather_longitude_e6};
}

} // namespace daik
