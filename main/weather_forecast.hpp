#pragma once
#include <array>
#include <cstdint>
#include <string>

#include "logic/weather_forecast.hpp"

namespace daik {

struct WeatherForecastStatus {
    bool configured=false, fetching=false, available=false, has_value=false;
    double outdoor_mean_2h_c=0.0, solar_energy_2h_wh_m2=0.0;
    size_t hourly_count=0;
    std::array<int64_t, WEATHER_HOURLY_CAP> hourly_unix_s{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_temperature_c{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_humidity_pct{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_pressure_hpa{};
    int64_t issued_unix_s=-1, fetched_unix_s=-1, decision_unix_s=-1,
            last_attempt_unix_s=-1;
    uint32_t successes=0, errors=0;
    std::string latitude, longitude, model="icon_seamless", state="disabled", reason, error;
};

void weather_forecast_start();
void weather_forecast_reconfigure();
WeatherForecastStatus weather_forecast_status();
// Lock-free signal for the allocation-rich HTTPS interval. The MQTT publisher reads this before
// constructing its snapshots so it can leave the largest contiguous heap block to TLS.
bool weather_fetch_active();

}  // namespace daik
