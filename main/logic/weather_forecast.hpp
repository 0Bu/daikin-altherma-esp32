#pragma once
// Open-Meteo forecast contract shared by the on-device HTTPS/JSON fetcher and host tests. A saved
// location is the source-specific collection/privacy boundary; a request additionally requires the
// device-wide diagnostics consent and ordinary non-safe-mode operation. An active source fetches
// every 45 minutes, derives bounded comparison features and never stores the provider response or
// writes heat-pump controls. Clearing the location sends no request. Forecast is optional.
#include <array>
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
inline constexpr double WEATHER_HUMIDITY_MIN_PCT = 0.0;
inline constexpr double WEATHER_HUMIDITY_MAX_PCT = 100.0;
inline constexpr double WEATHER_PRESSURE_MIN_HPA = 200.0;
inline constexpr double WEATHER_PRESSURE_MAX_HPA = 1200.0;
inline constexpr size_t WEATHER_HOURLY_CAP = 6;
// Two hours of global irradiance. The generous physical bound catches unit errors (not weather).
inline constexpr double WEATHER_SOLAR_MAX_WH_M2 = 3000.0;

// Boot-latched availability of the task which owns the optional Weather source. A source/consent
// mutation may clear source-bound observations, but it must not erase the fact that no worker can
// service the newly configured source during this boot.
enum class WeatherTaskStartState : uint8_t {
    NotStarted,
    Available,
    DeadlineUnavailable,
    TaskStartFailed,
};

struct WeatherTaskFailure {
    const char* reason = nullptr;
    const char* error  = nullptr;

    constexpr explicit operator bool() const noexcept { return reason != nullptr; }
};

inline constexpr WeatherTaskFailure weather_task_failure(bool configured, bool diagnostics_enabled,
                                                         WeatherTaskStartState state) noexcept {
    if (!configured || !diagnostics_enabled) return {};
    switch (state) {
    case WeatherTaskStartState::Available:
        return {};
    case WeatherTaskStartState::DeadlineUnavailable:
        return {"deadline_unavailable", "deadline_unavailable"};
    case WeatherTaskStartState::TaskStartFailed:
        return {"task_start_failed", "out_of_memory"};
    case WeatherTaskStartState::NotStarted:
        return {"task_unavailable", "task_unavailable"};
    }
    return {"task_unavailable", "task_unavailable"};
}

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

// Causal state machine for the non-persistent refresh witness. Completion is final: a source-change
// cancellation and the old network attempt may race after the value commit, but only the first
// completion is allowed to decide whether this exact token succeeded. OTA serialization is not a
// completion: the same outstanding token may be released and claimed again after OTA becomes idle.
inline uint64_t weather_refresh_claim(uint64_t requested_token, uint64_t completed_token,
                                      uint64_t& started_token) {
    if (requested_token == completed_token) return 0;
    started_token = requested_token;
    return requested_token;
}

inline bool weather_refresh_complete(uint64_t requested_token, uint64_t started_token,
                                     uint64_t token, bool success, uint64_t& completed_token,
                                     uint64_t& success_token) {
    if (token == 0 || requested_token != token || started_token != token ||
        completed_token == token)
        return false;
    if (success) success_token = token;
    completed_token = token;
    return true;
}

inline bool weather_refresh_defer(uint64_t requested_token, uint64_t started_token, uint64_t token,
                                  uint64_t completed_token) {
    return token != 0 && requested_token == token && started_token == token &&
           completed_token != token;
}

inline void weather_refresh_cancel_outstanding(uint64_t  requested_token,
                                               uint64_t& completed_token) {
    if (requested_token != completed_token) completed_token = requested_token;
}

// ── Fetch headroom gate ──────────────────────────────────────────────────────────────────────────
//
// One Open-Meteo fetch transiently claims ≈ 16 KiB mbedTLS in-buffer + 4 KiB out-buffer, HTTP/TCP
// buffers, the response string and the cJSON tree, on a heap whose binding limit is the largest
// CONTIGUOUS internal block. Live evidence (private issue 10): one fetch landed
// on a fragmentation trough and pushed the boot's `min_free_heap` low-water to 800 B; it survived
// only because the claim is brief. The gate below keeps the next fetch OUT of such a trough. Its
// 24 KiB contiguous floor rejects the measured 15.9 KiB trough but still admits the board's healthy
// 31.7 KiB allocator ceiling; requiring the issue's provisional 40 KiB largest-block suggestion
// would disable weather permanently on that board. The 56 KiB aggregate floor leaves roughly
// 16 KiB outside the measured ~40 KiB transient claim. A refusal uses the ordinary 5-minute retry,
// not a full 45-minute raster skip, so a valid forecast does not cross its 90-minute stale boundary.
inline constexpr size_t WEATHER_FETCH_MIN_FREE_BYTES          = 56 * 1024;
inline constexpr size_t WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES = 24 * 1024;

inline bool weather_fetch_headroom_ok(size_t free_bytes, size_t largest_free_block) {
    return free_bytes >= WEATHER_FETCH_MIN_FREE_BYTES &&
           largest_free_block >= WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES;
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
    // Bounded provider-timestamped points for the optional future graph. The existing two-hour
    // comparison features above remain the decision/evidence contract; these arrays are additive
    // presentation data and never drive heat-pump control.
    size_t hourly_count = 0;
    std::array<int64_t, WEATHER_HOURLY_CAP> hourly_unix_s{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_temperature_c{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_humidity_pct{};
    std::array<double, WEATHER_HOURLY_CAP> hourly_pressure_hpa{};
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
    if (s.hourly_count > WEATHER_HOURLY_CAP || s.hourly_count == 1)
        return fail("invalid_hourly_count");
    for (size_t i = 0; i < s.hourly_count; ++i) {
        if ((!i && s.hourly_unix_s[i] != s.decision_unix_s) ||
            (i && s.hourly_unix_s[i] - s.hourly_unix_s[i - 1] != 3600))
            return fail("invalid_hourly_time");
        if (!std::isfinite(s.hourly_temperature_c[i]) ||
            s.hourly_temperature_c[i] < WEATHER_OUTDOOR_MIN_C ||
            s.hourly_temperature_c[i] > WEATHER_OUTDOOR_MAX_C)
            return fail("invalid_hourly_temperature");
        if (!std::isfinite(s.hourly_humidity_pct[i]) ||
            s.hourly_humidity_pct[i] < WEATHER_HUMIDITY_MIN_PCT ||
            s.hourly_humidity_pct[i] > WEATHER_HUMIDITY_MAX_PCT)
            return fail("invalid_hourly_humidity");
        if (!std::isfinite(s.hourly_pressure_hpa[i]) ||
            s.hourly_pressure_hpa[i] < WEATHER_PRESSURE_MIN_HPA ||
            s.hourly_pressure_hpa[i] > WEATHER_PRESSURE_MAX_HPA)
            return fail("invalid_hourly_pressure");
    }
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
