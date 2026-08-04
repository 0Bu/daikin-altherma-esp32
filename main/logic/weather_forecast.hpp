#pragma once
// Open-Meteo forecast contract shared by the on-device HTTPS/JSON fetcher and host tests. The
// With the explicit dynamic-LWT Firmware switch in SHADOW, the firmware requests one configured
// coordinate every 45 minutes, derives only the two bounded features needed by #288, and never
// stores the provider response or writes heat-pump controls. OFF preserves the location but sends
// no request.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

namespace daik {

inline constexpr uint32_t WEATHER_MAX_AGE_S = 90 * 60;
inline constexpr uint32_t WEATHER_FETCH_INTERVAL_S = 45 * 60;
inline constexpr uint32_t WEATHER_RETRY_INTERVAL_S = 5 * 60;
inline constexpr int64_t WEATHER_FUTURE_TOLERANCE_S = 60;
inline constexpr double WEATHER_OUTDOOR_MIN_C = -90.0;
inline constexpr double WEATHER_OUTDOOR_MAX_C = 70.0;
// Two hours of global irradiance. The generous physical bound catches unit errors (not weather).
inline constexpr double WEATHER_SOLAR_MAX_WH_M2 = 3000.0;

inline constexpr int32_t WEATHER_LATITUDE_MIN_E6 = -90 * 1000000;
inline constexpr int32_t WEATHER_LATITUDE_MAX_E6 =  90 * 1000000;
inline constexpr int32_t WEATHER_LONGITUDE_MIN_E6 = -180 * 1000000;
inline constexpr int32_t WEATHER_LONGITUDE_MAX_E6 =  180 * 1000000;

struct WeatherLocationParse {
    bool valid = false;
    bool enabled = false;
    int32_t latitude_e6 = 0;
    int32_t longitude_e6 = 0;
    const char* reason = "invalid_location";
};

// Strict decimal parser for the URL/config boundary: optional '-', digits, optional decimal point
// (dot or German comma), at most six fractional digits. Exponents, whitespace, '+' and URL
// delimiters are rejected; the URL is later emitted from signed microdegrees with a dot.
inline bool weather_coordinate_parse_e6(std::string_view text, int32_t minimum, int32_t maximum,
                                        int32_t& out) {
    if (text.empty() || text.size() > 16) return false;
    size_t p = 0;
    bool negative = false;
    if (text[p] == '-') { negative = true; ++p; }
    if (p >= text.size() || text[p] < '0' || text[p] > '9') return false;
    int64_t whole = 0;
    while (p < text.size() && text[p] >= '0' && text[p] <= '9') {
        whole = whole * 10 + (text[p++] - '0');
        if (whole > 180) return false;
    }
    int64_t fraction = 0;
    int digits = 0;
    if (p < text.size() && (text[p] == '.' || text[p] == ',')) {
        ++p;
        if (p >= text.size()) return false;
        while (p < text.size() && text[p] >= '0' && text[p] <= '9') {
            if (digits == 6) return false;
            fraction = fraction * 10 + (text[p++] - '0');
            ++digits;
        }
    }
    if (p != text.size()) return false;
    while (digits < 6) {
        fraction *= 10;
        ++digits;
    }
    int64_t value = whole * 1000000 + fraction;
    if (negative) value = -value;
    if (value < minimum || value > maximum) return false;
    out = static_cast<int32_t>(value);
    return true;
}

inline WeatherLocationParse weather_location_parse(std::string_view latitude,
                                                   std::string_view longitude) {
    if (latitude.empty() && longitude.empty()) return {true, false, 0, 0, "disabled"};
    if (latitude.empty() || longitude.empty()) return {false, false, 0, 0, "both_coordinates_required"};
    int32_t lat = 0, lon = 0;
    if (!weather_coordinate_parse_e6(latitude, WEATHER_LATITUDE_MIN_E6,
                                     WEATHER_LATITUDE_MAX_E6, lat))
        return {false, false, 0, 0, "invalid_latitude"};
    if (!weather_coordinate_parse_e6(longitude, WEATHER_LONGITUDE_MIN_E6,
                                     WEATHER_LONGITUDE_MAX_E6, lon))
        return {false, false, 0, 0, "invalid_longitude"};
    return {true, true, lat, lon, "ok"};
}

inline bool weather_location_e6_valid(bool enabled, int32_t latitude_e6, int32_t longitude_e6) {
    if (!enabled) return latitude_e6 == 0 && longitude_e6 == 0;
    return latitude_e6 >= WEATHER_LATITUDE_MIN_E6 && latitude_e6 <= WEATHER_LATITUDE_MAX_E6 &&
           longitude_e6 >= WEATHER_LONGITUDE_MIN_E6 && longitude_e6 <= WEATHER_LONGITUDE_MAX_E6;
}

inline std::string weather_coordinate_format_e6(int32_t value) {
    const bool negative = value < 0;
    const int64_t magnitude = negative ? -static_cast<int64_t>(value) : value;
    char out[24];
    std::snprintf(out, sizeof(out), "%s%lld.%06lld", negative ? "-" : "",
                  static_cast<long long>(magnitude / 1000000),
                  static_cast<long long>(magnitude % 1000000));
    return out;
}

inline bool weather_reason_valid(std::string_view reason) {
    return reason == "fetch_failed" || reason == "payload_invalid" ||
           reason == "incomplete_horizon";
}

struct WeatherForecastSample {
    int version = 0;
    std::string_view provider;
    std::string_view model;
    // The forecast endpoint does not publish its source model-run issue time. Keep this explicit
    // and unavailable (-1), rather than relabelling the HTTP fetch time as provider provenance.
    int64_t issued_unix_s = -1;
    int64_t fetched_unix_s = -1;
    int64_t decision_unix_s = -1;
    double outdoor_mean_2h_c = 0.0;
    double solar_energy_2h_wh_m2 = 0.0;
};

struct WeatherValidation {
    bool valid = false;
    const char* reason = "invalid";
};

// `received_unix_s` is the synchronized wall clock captured after the HTTPS response. It is
// optional in host tests (-1), but when available prevents an impossible future fetch time.
inline WeatherValidation weather_validate(const WeatherForecastSample& s,
                                           int64_t received_unix_s = -1) {
    auto fail = [](const char* why) { return WeatherValidation{false, why}; };
    if (s.version != 1) return fail("unsupported_version");
    if (s.provider != "open-meteo") return fail("invalid_provider");
    if (s.model != "icon_seamless") return fail("invalid_model");
    if (s.fetched_unix_s < 0 || s.decision_unix_s < 0)
        return fail("missing_timestamp");
    // The features describe the two hours following a decision instant. An adapter may align that
    // instant to the next hour (the #288 example does), but may not relabel arbitrary later weather.
    if (s.decision_unix_s < s.fetched_unix_s - WEATHER_FUTURE_TOLERANCE_S ||
        s.decision_unix_s > s.fetched_unix_s + 60 * 60)
        return fail("invalid_decision_time");
    if (received_unix_s >= 0 &&
        s.fetched_unix_s > received_unix_s + WEATHER_FUTURE_TOLERANCE_S)
        return fail("future_fetch");
    if (!std::isfinite(s.outdoor_mean_2h_c) ||
        s.outdoor_mean_2h_c < WEATHER_OUTDOOR_MIN_C ||
        s.outdoor_mean_2h_c > WEATHER_OUTDOOR_MAX_C)
        return fail("invalid_outdoor_mean");
    if (!std::isfinite(s.solar_energy_2h_wh_m2) || s.solar_energy_2h_wh_m2 < 0.0 ||
        s.solar_energy_2h_wh_m2 > WEATHER_SOLAR_MAX_WH_M2)
        return fail("invalid_solar_energy");
    return {true, "ok"};
}

struct WeatherFreshness {
    bool fresh = false;
    bool age_known = false;
    uint64_t age_s = 0;
    const char* reason = "no_value";
};

// Fetch age measures direct Open-Meteo availability. Provider issue time is deliberately unavailable
// because this endpoint does not expose it; never synthesize it from the fetch time.
inline WeatherFreshness weather_freshness(bool has_value, int64_t fetched_unix_s,
                                          int64_t now_unix_s,
                                          uint32_t max_age_s = WEATHER_MAX_AGE_S) {
    WeatherFreshness f;
    if (!has_value) return f;
    if (now_unix_s < 0) { f.reason = "clock_unsynced"; return f; }
    if (fetched_unix_s > now_unix_s + WEATHER_FUTURE_TOLERANCE_S) {
        f.reason = "future_fetch";
        return f;
    }
    f.age_known = true;
    f.age_s = fetched_unix_s > now_unix_s
            ? 0 : static_cast<uint64_t>(now_unix_s - fetched_unix_s);
    if (f.age_s > max_age_s) { f.reason = "stale"; return f; }
    f.fresh = true;
    f.reason = "fresh";
    return f;
}

inline bool weather_timestamp_moved_backward(const WeatherForecastSample& next,
                                             const WeatherForecastSample& previous) {
    return next.fetched_unix_s < previous.fetched_unix_s ||
           next.decision_unix_s < previous.decision_unix_s ||
           (next.issued_unix_s >= 0 && previous.issued_unix_s >= 0 &&
            next.issued_unix_s < previous.issued_unix_s);
}

}  // namespace daik
