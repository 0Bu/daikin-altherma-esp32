#pragma once
// Pure Open-Meteo response derivation. Transport JSON is decoded by the firmware with cJSON; this
// header owns the time-window and unit conversion that must remain host-testable. Open-Meteo's
// hourly shortwave_radiation is the mean W/m² over the preceding hour, so two adjacent one-hour
// values sum numerically to Wh/m² for the two-hour decision window.
#include <cmath>
#include <cstdint>
#include <vector>

#include "weather_forecast.hpp"

namespace daik {

inline WeatherValidation open_meteo_derive_forecast(const std::vector<int64_t>& times,
                                                     const std::vector<double>& temperature_c,
                                                     const std::vector<double>& shortwave_w_m2,
                                                     int64_t fetched_unix_s,
                                                     WeatherForecastSample& out) {
    auto fail = [](const char* why) { return WeatherValidation{false, why}; };
    if (times.size() != temperature_c.size() || times.size() != shortwave_w_m2.size())
        return fail("payload_shape_invalid");

    size_t decision = 0;
    while (decision < times.size() && times[decision] < fetched_unix_s) ++decision;
    if (decision + 2 >= times.size()) return fail("incomplete_horizon");
    if (times[decision + 1] - times[decision] != 3600 ||
        times[decision + 2] - times[decision + 1] != 3600)
        return fail("non_hourly_horizon");

    const double t1 = temperature_c[decision + 1];
    const double t2 = temperature_c[decision + 2];
    const double r1 = shortwave_w_m2[decision + 1];
    const double r2 = shortwave_w_m2[decision + 2];
    if (!std::isfinite(t1) || !std::isfinite(t2) || !std::isfinite(r1) ||
        !std::isfinite(r2))
        return fail("missing_horizon_value");

    out = WeatherForecastSample{1, "open-meteo", "icon_seamless", -1, fetched_unix_s,
                                times[decision], (t1 + t2) / 2.0, r1 + r2};
    return weather_validate(out, fetched_unix_s);
}

}  // namespace daik
