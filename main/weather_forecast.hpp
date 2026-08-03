#pragma once
#include <cstdint>
#include <string>

namespace daik {

struct WeatherForecastStatus {
    bool configured=false, fetching=false, available=false, has_value=false;
    double outdoor_mean_2h_c=0.0, solar_energy_2h_wh_m2=0.0;
    int64_t issued_unix_s=-1, fetched_unix_s=-1, decision_unix_s=-1,
            last_attempt_unix_s=-1;
    uint32_t successes=0, errors=0;
    std::string latitude, longitude, model="icon_seamless", state="disabled", reason, error;
};

void weather_forecast_start();
void weather_forecast_reconfigure();
WeatherForecastStatus weather_forecast_status();

}  // namespace daik
