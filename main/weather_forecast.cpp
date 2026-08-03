#include "weather_forecast.hpp"

#include "config.hpp"
#include "diag_log.hpp"
#include "logic/open_meteo.hpp"
#include "logic/weather_forecast.hpp"
#include "sntp_time.hpp"
#include "wifi.hpp"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <exception>
#include <limits>
#include <string>
#include <vector>

namespace daik {
namespace {

constexpr size_t kPayloadMax = 8 * 1024;
constexpr int kHttpTimeoutMs = 20000;
constexpr int kTaskStack = 12288;
constexpr int kTaskPrio = 3;
constexpr const char* kProvider = "open-meteo";
constexpr const char* kModel = "icon_seamless";

WeatherForecastStatus s_status;
SemaphoreHandle_t s_mtx = xSemaphoreCreateMutex();
TaskHandle_t s_task = nullptr;

struct Lock {
    explicit Lock(SemaphoreHandle_t m) : m_(m) { if (m_) xSemaphoreTake(m_, portMAX_DELAY); }
    ~Lock() { if (m_) xSemaphoreGive(m_); }
    SemaphoreHandle_t m_;
};

std::string open_meteo_url(const Config& cfg) {
    // Only formatter-produced signed decimals enter this URL. `forecast_hours=6` is deliberately
    // larger than the four values normally needed: a request that crosses an hour boundary while
    // TLS is in flight still has two complete future one-hour bins after the next decision instant.
    return "https://api.open-meteo.com/v1/forecast?latitude=" +
           weather_coordinate_format_e6(cfg.weather_latitude_e6) + "&longitude=" +
           weather_coordinate_format_e6(cfg.weather_longitude_e6) +
           "&hourly=temperature_2m,shortwave_radiation&models=icon_seamless"
           "&forecast_hours=6&timeformat=unixtime&timezone=GMT&temperature_unit=celsius";
}

bool download_json(const Config& weather, std::string& out, std::string& error) {
    const std::string url = open_meteo_url(weather);
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.timeout_ms = kHttpTimeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.keep_alive_enable = false;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) { error = "out_of_memory"; return false; }
    esp_http_client_set_header(client, "Accept", "application/json");

    bool ok = false;
    const esp_err_t opened = esp_http_client_open(client, 0);
    if (opened != ESP_OK) {
        error = "connect_failed";
    } else if (esp_http_client_fetch_headers(client) < 0) {
        error = "response_failed";
    } else if (esp_http_client_get_status_code(client) != 200) {
        error = "http_" + std::to_string(esp_http_client_get_status_code(client));
    } else {
        const int64_t claimed = esp_http_client_get_content_length(client);
        if (claimed > static_cast<int64_t>(kPayloadMax)) {
            error = "payload_too_large";
        } else {
            out.clear();
            out.reserve(static_cast<size_t>(claimed > 0 ? std::min<int64_t>(claimed, 2048) : 2048));
            char chunk[1024];
            while (out.size() <= kPayloadMax) {
                const int n = esp_http_client_read(client, chunk, sizeof(chunk));
                if (n < 0) { error = "read_failed"; break; }
                if (n == 0) { ok = !out.empty(); if (!ok) error = "empty_payload"; break; }
                if (out.size() + static_cast<size_t>(n) > kPayloadMax) {
                    error = "payload_too_large";
                    break;
                }
                out.append(chunk, static_cast<size_t>(n));
            }
        }
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return ok;
}

bool json_number_array(cJSON* object, const char* key, std::vector<double>& out) {
    cJSON* array = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsArray(array)) return false;
    const int count = cJSON_GetArraySize(array);
    if (count < 3 || count > 12) return false;
    out.clear();
    out.reserve(static_cast<size_t>(count));
    for (int i = 0; i < count; ++i) {
        cJSON* item = cJSON_GetArrayItem(array, i);
        if (!cJSON_IsNumber(item) || !std::isfinite(item->valuedouble)) return false;
        out.push_back(item->valuedouble);
    }
    return true;
}

bool json_time_array(cJSON* object, std::vector<int64_t>& out) {
    std::vector<double> raw;
    if (!json_number_array(object, "time", raw)) return false;
    out.clear();
    out.reserve(raw.size());
    for (const double value : raw) {
        if (value < 0 || value > static_cast<double>(std::numeric_limits<int64_t>::max()) ||
            std::floor(value) != value)
            return false;
        out.push_back(static_cast<int64_t>(value));
    }
    return true;
}

bool json_unit(cJSON* units, const char* key, const char* expected) {
    cJSON* item = cJSON_GetObjectItemCaseSensitive(units, key);
    return cJSON_IsString(item) && item->valuestring && std::strcmp(item->valuestring, expected) == 0;
}

bool parse_forecast(const std::string& payload, int64_t fetched_unix_s,
                    WeatherForecastSample& sample, std::string& error) {
    cJSON* root = cJSON_ParseWithLength(payload.data(), payload.size());
    if (!root) { error = "json_invalid"; return false; }
    bool ok = false;
    do {
        cJSON* utc_offset = cJSON_GetObjectItemCaseSensitive(root, "utc_offset_seconds");
        cJSON* hourly = cJSON_GetObjectItemCaseSensitive(root, "hourly");
        cJSON* units = cJSON_GetObjectItemCaseSensitive(root, "hourly_units");
        if (!cJSON_IsNumber(utc_offset) || utc_offset->valuedouble != 0 ||
            !cJSON_IsObject(hourly) || !cJSON_IsObject(units)) {
            error = "payload_shape_invalid";
            break;
        }
        // Fail closed if the provider ever changes units despite the explicit query parameters.
        if (!json_unit(units, "time", "unixtime") ||
            !json_unit(units, "temperature_2m", "°C") ||
            !json_unit(units, "shortwave_radiation", "W/m²")) {
            error = "unit_mismatch";
            break;
        }
        std::vector<int64_t> times;
        std::vector<double> temperature;
        std::vector<double> shortwave;
        if (!json_time_array(hourly, times) ||
            !json_number_array(hourly, "temperature_2m", temperature) ||
            !json_number_array(hourly, "shortwave_radiation", shortwave)) {
            error = "payload_shape_invalid";
            break;
        }
        const WeatherValidation validation = open_meteo_derive_forecast(
            times, temperature, shortwave, fetched_unix_s, sample);
        if (!validation.valid) { error = validation.reason; break; }
        ok = true;
    } while (false);
    cJSON_Delete(root);
    return ok;
}

bool fetch_forecast(const Config& weather, WeatherForecastSample& sample, std::string& error) {
    std::string payload;
    if (!download_json(weather, payload, error)) return false;
    int64_t fetched_unix_s = -1;
    int32_t ms = 0;
    time_now(fetched_unix_s, ms);
    if (fetched_unix_s < 0) { error = "clock_unsynced"; return false; }
    return parse_forecast(payload, fetched_unix_s, sample, error);
}

void set_disabled() {
    Lock lk(s_mtx);
    s_status.configured = false;
    s_status.fetching = false;
    s_status.available = false;
    s_status.latitude.clear();
    s_status.longitude.clear();
    s_status.state = "disabled";
    s_status.reason = "not_configured";
    s_status.error.clear();
}

void weather_task(void*) {
    for (;;) {
        try {
            const Config cfg = config();
            if (!cfg.weather_enabled) {
                set_disabled();
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(60000));
                continue;
            }
            const std::string latitude = weather_coordinate_format_e6(cfg.weather_latitude_e6);
            const std::string longitude = weather_coordinate_format_e6(cfg.weather_longitude_e6);
            {
                Lock lk(s_mtx);
                if (s_status.latitude != latitude || s_status.longitude != longitude) {
                    s_status.has_value = false;
                    s_status.available = false;
                }
                s_status.configured = true;
                s_status.latitude = latitude;
                s_status.longitude = longitude;
                s_status.model = kModel;
            }
            if (!wifi_info().connected || !time_synced()) {
                {
                    Lock lk(s_mtx);
                    s_status.fetching = false;
                    s_status.available = false;
                    s_status.state = "waiting";
                    s_status.reason = !wifi_info().connected ? "network_unavailable" : "clock_unsynced";
                }
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(60000));
                continue;
            }

            int64_t now = -1;
            int32_t ms = 0;
            time_now(now, ms);
            {
                Lock lk(s_mtx);
                s_status.fetching = true;
                s_status.available = false;
                s_status.state = "fetching";
                s_status.reason.clear();
                s_status.error.clear();
                s_status.last_attempt_unix_s = now;
            }
            WeatherForecastSample sample;
            std::string error;
            const bool ok = fetch_forecast(cfg, sample, error);
            bool updated = false;
            if (ok) {
                Lock lk(s_mtx);
                const WeatherForecastSample previous{
                    1, kProvider, kModel, s_status.issued_unix_s, s_status.fetched_unix_s,
                    s_status.decision_unix_s, s_status.outdoor_mean_2h_c,
                    s_status.solar_energy_2h_wh_m2};
                if (s_status.has_value && weather_timestamp_moved_backward(sample, previous)) {
                    error = "provider_time_moved_backward";
                } else {
                    s_status.fetching = false;
                    s_status.available = true;
                    s_status.has_value = true;
                    s_status.state = "ok";
                    s_status.reason = "fresh";
                    s_status.error.clear();
                    s_status.issued_unix_s = sample.issued_unix_s;
                    s_status.fetched_unix_s = sample.fetched_unix_s;
                    s_status.decision_unix_s = sample.decision_unix_s;
                    s_status.outdoor_mean_2h_c = sample.outdoor_mean_2h_c;
                    s_status.solar_energy_2h_wh_m2 = sample.solar_energy_2h_wh_m2;
                    s_status.successes++;
                    updated = true;
                }
            }
            if (updated) diag_printf("weather: Open-Meteo ICON forecast updated\n");
            if (!ok || !error.empty()) {
                const std::string failure = error.empty() ? "fetch_failed" : error;
                {
                    Lock lk(s_mtx);
                    s_status.fetching = false;
                    s_status.available = false;
                    s_status.state = "error";
                    s_status.reason = "fetch_failed";
                    s_status.error = failure;
                    s_status.errors++;
                }
                diag_printf("weather: Open-Meteo fetch failed (%s)\n", failure.c_str());
            }
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS((ok && error.empty())
                                                  ? WEATHER_FETCH_INTERVAL_S * 1000u
                                                  : WEATHER_RETRY_INTERVAL_S * 1000u));
        } catch (const std::exception& e) {
            diag_printf("weather: task exception: %s\n", e.what());
            { Lock lk(s_mtx); s_status.fetching = false; s_status.available = false;
              s_status.state = "error"; s_status.reason = "fetch_failed";
              s_status.error = "out_of_memory"; s_status.errors++; }
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
        }
    }
}

}  // namespace

void weather_forecast_start() {
    if (s_task) return;
    if (!s_mtx) {
        s_status.state = "error";
        s_status.reason = "task_start_failed";
        s_status.error = "out_of_memory";
        diag_printf("weather: mutex allocation failed\n");
        return;
    }
    if (xTaskCreate(weather_task, "weather", kTaskStack, nullptr, kTaskPrio, &s_task) != pdPASS) {
        Lock lk(s_mtx);
        s_status.state = "error";
        s_status.reason = "task_start_failed";
        s_status.error = "out_of_memory";
    }
}

void weather_forecast_reconfigure() {
    if (s_task) xTaskNotifyGive(s_task);
}

WeatherForecastStatus weather_forecast_status() {
    Lock lk(s_mtx);
    return s_status;
}

}  // namespace daik
