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
    // Monotonic causal witness for the non-persistent HIL refresh endpoint. A release gate accepts
    // only its exact token; an unrelated scheduled/retry fetch cannot satisfy it via `successes`.
    uint64_t refresh_requested_token = 0, refresh_started_token = 0, refresh_completed_token = 0,
             refresh_success_token = 0;
    std::string latitude, longitude, model="icon_seamless", state="disabled", reason, error;
};

void weather_forecast_start();
void weather_forecast_reconfigure();
// Unwind-safe source/consent mutation transaction. Construction stages the completely cleared
// replacement plus every task-start failure string before taking admission, then waits briefly for
// an already-admitted network interval. A false object means the HTTP mutation must return 503
// unchanged. commit() is called only after config_save(); under the mutex it selects the final
// boot-latched task state using noexcept swaps, installs the replacement and reopens Weather. Any
// return/exception before commit releases admission in the destructor.
class WeatherSourceChange {
public:
    WeatherSourceChange(bool configured, bool diagnostics_enabled);
    WeatherSourceChange(const WeatherSourceChange&)            = delete;
    WeatherSourceChange& operator=(const WeatherSourceChange&) = delete;
    ~WeatherSourceChange() noexcept;
    explicit operator bool() const noexcept { return held_; }
    void     commit() noexcept;

private:
    WeatherForecastStatus replacement_;
    bool                  configured_          = false;
    bool                  diagnostics_enabled_ = false;
    std::string           failure_state_;
    std::string           not_started_reason_;
    std::string           not_started_error_;
    std::string           deadline_reason_;
    std::string           deadline_error_;
    std::string           task_start_reason_;
    std::string           task_start_error_;
    bool                  held_ = false;
};
// Request one immediate cycle only when the task exists and no earlier explicit refresh is still
// outstanding. Returns its monotonic causal token through `token`; zero/false is never accepted.
bool weather_forecast_request_refresh(uint64_t& token) noexcept;
// Copies the mutex-owned runtime snapshot, then materialises any boot-latched task-start failure in
// the calling HTTP/MQTT exception boundary. A failed start path itself never allocates or mutates
// string state, including when the mutex allocation failed.
WeatherForecastStatus weather_forecast_status();
// Lock-free signal for the allocation-rich HTTPS interval. The MQTT publisher reads this before
// constructing its snapshots so it can leave the largest contiguous heap block to TLS.
bool weather_fetch_active();

}  // namespace daik
