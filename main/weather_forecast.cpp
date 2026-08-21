#include "weather_forecast.hpp"

#include "config.hpp"
#include "diag_log.hpp"
#include "http_client_diag.hpp"
#include "hp_modbus.hpp"
#include "hp_poll.hpp"
#include "logic/open_meteo.hpp"
#include "logic/weather_forecast.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "sntp_time.hpp"
#include "syslog.hpp"
#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/task.h"
#include <algorithm>
#include <atomic>
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
constexpr TickType_t kDownloadDeadline = pdMS_TO_TICKS(60000);
// Longer than the MQTT publisher's one-second cadence. Set the active flag first, give MQTT time to
// release its snapshot, then wait explicitly for the allocation-rich X10A sweep to acknowledge.
constexpr int kNetworkQuiesceLeadMs = 1100;
constexpr int kPollQuiesceWaitMs = 15000;
constexpr int kAllocatorRetryMs = 250;
constexpr int kTaskStack = 12288;
constexpr UBaseType_t kTaskPrio = TASK_PRIO_WEATHER;   // see main/task_config.hpp
constexpr const char* kProvider = "open-meteo";
constexpr const char* kModel = "icon_seamless";

WeatherForecastStatus s_status;
SemaphoreHandle_t s_mtx = xSemaphoreCreateMutex();
TaskHandle_t s_task = nullptr;
std::atomic<bool> s_network_active{false};
static_assert(std::atomic<bool>::is_always_lock_free,
              "weather network activity must remain allocation- and lock-free");

struct NetworkActivity {
    NetworkActivity() {
        s_network_active.store(true, std::memory_order_release);
        mqtt_transport_pause_for_network_heap();
    }
    ~NetworkActivity() {
        mqtt_transport_resume_after_network_heap();
        s_network_active.store(false, std::memory_order_release);
    }
};

// C APIs do not participate in C++ unwinding. Keep their cleanup attached to the owning scope so a
// std::bad_alloc from an error string, response append or parse vector cannot leak the HTTP/TLS
// client or cJSON tree into the next five-minute retry.
struct HttpClientCleanup {
    explicit HttpClientCleanup(esp_http_client_handle_t handle) : handle(handle) {}
    HttpClientCleanup(const HttpClientCleanup&) = delete;
    HttpClientCleanup& operator=(const HttpClientCleanup&) = delete;
    ~HttpClientCleanup() {
        if (!handle) return;
        esp_http_client_close(handle);
        esp_http_client_cleanup(handle);
    }
    esp_http_client_handle_t handle;
};

struct JsonCleanup {
    explicit JsonCleanup(cJSON* root) : root(root) {}
    JsonCleanup(const JsonCleanup&) = delete;
    JsonCleanup& operator=(const JsonCleanup&) = delete;
    ~JsonCleanup() { cJSON_Delete(root); }
    cJSON* root;
};

// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
using Lock = SemGuard;

std::string open_meteo_url(const Config& cfg) {
    // Only formatter-produced signed decimals enter this URL. `forecast_hours=6` is deliberately
    // larger than the four values normally needed: a request that crosses an hour boundary while
    // TLS is in flight still has two complete future one-hour bins after the next decision instant.
    return "https://api.open-meteo.com/v1/forecast?latitude=" +
           weather_coordinate_format_e6(cfg.weather_latitude_e6) + "&longitude=" +
           weather_coordinate_format_e6(cfg.weather_longitude_e6) +
           "&hourly=temperature_2m,relative_humidity_2m,surface_pressure,shortwave_radiation"
           "&models=icon_seamless"
           "&forecast_hours=6&timeformat=unixtime&timezone=GMT&temperature_unit=celsius";
}

bool download_json(const Config& weather, std::string& out, std::string& error,
                   bool& heap_refused, HttpClientProbe& headroom) {
    // Make every firmware-owned response/error allocation before the final headroom sample. The
    // response is capped at kPayloadMax, so append() cannot grow while the TLS client is alive.
    out.clear();
    out.reserve(kPayloadMax);
    error.reserve(32);
    const std::string url = open_meteo_url(weather);
    const HttpClientProbe before = http_client_probe();
    headroom = before;
    heap_refused = !weather_fetch_headroom_ok(before.free_internal, before.largest_internal);
    if (heap_refused) return false;
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.timeout_ms = kHttpTimeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.keep_alive_enable = false;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        http_client_log_init_failure("weather", before);
        error = "out_of_memory";
        return false;
    }
    HttpClientCleanup cleanup(client);
    esp_http_client_set_header(client, "Accept", "application/json");

    bool ok = false;
    const TickType_t download_started = xTaskGetTickCount();
    const esp_err_t opened = esp_http_client_open(client, 0);
    if (opened != ESP_OK) {
        http_client_log_open_failure("weather", client, opened, before);
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
            char chunk[1024];
            while (out.size() <= kPayloadMax) {
                const TickType_t elapsed = xTaskGetTickCount() - download_started;
                if (elapsed >= kDownloadDeadline) {
                    error = "download_timeout";
                    break;
                }
                const uint64_t remaining_ms =
                    static_cast<uint64_t>(kDownloadDeadline - elapsed) * portTICK_PERIOD_MS;
                const int timeout_ms = remaining_ms < static_cast<uint64_t>(kHttpTimeoutMs)
                                     ? static_cast<int>(remaining_ms) : kHttpTimeoutMs;
                esp_http_client_set_timeout_ms(client, timeout_ms > 0 ? timeout_ms : 1);
                const int n = esp_http_client_read(client, chunk, sizeof(chunk));
                if (n <= 0 && xTaskGetTickCount() - download_started >= kDownloadDeadline) {
                    error = "download_timeout";
                    break;
                }
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
    JsonCleanup cleanup(root);
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
            !json_unit(units, "relative_humidity_2m", "%") ||
            !json_unit(units, "surface_pressure", "hPa") ||
            !json_unit(units, "shortwave_radiation", "W/m²")) {
            error = "unit_mismatch";
            break;
        }
        std::vector<int64_t> times;
        std::vector<double> temperature;
        std::vector<double> humidity;
        std::vector<double> pressure;
        std::vector<double> shortwave;
        if (!json_time_array(hourly, times) ||
            !json_number_array(hourly, "temperature_2m", temperature) ||
            !json_number_array(hourly, "relative_humidity_2m", humidity) ||
            !json_number_array(hourly, "surface_pressure", pressure) ||
            !json_number_array(hourly, "shortwave_radiation", shortwave)) {
            error = "payload_shape_invalid";
            break;
        }
        const WeatherValidation validation = open_meteo_derive_forecast(
            times, temperature, humidity, pressure, shortwave, fetched_unix_s, sample);
        if (!validation.valid) { error = validation.reason; break; }
        ok = true;
    } while (false);
    return ok;
}

bool fetch_forecast(const Config& weather, WeatherForecastSample& sample, std::string& error,
                    bool& heap_refused, HttpClientProbe& headroom) {
    std::string payload;
    if (!download_json(weather, payload, error, heap_refused, headroom)) return false;
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
    s_status.hourly_count = 0;
    s_status.latitude.clear();
    s_status.longitude.clear();
    s_status.state = "disabled";
    s_status.reason = "not_configured";
    s_status.error.clear();
}

// A saved location is dormant while the device-wide diagnostics switch is off. set_disabled clears
// every runtime value in either inactive state; the coordinates remain in Config and become active
// again only after explicit consent is restored.

void weather_task(void*) {
    for (;;) {
        try {
            // OTA owns the same scarce internal heap for TLS and RSA validation.  Check before the
            // Config/string snapshot so a scheduled forecast does not start allocating after OTA
            // requested quiescence.  The second check inside NetworkActivity below closes the race
            // where both tasks passed their first check at the same instant.
            if (ota_download_active()) {
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
                continue;
            }
            const Config cfg = config();
            if (!cfg.diagnostics_enabled || !cfg.weather_enabled) {
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
                    s_status.hourly_count = 0;
                }
                s_status.configured = true;
                s_status.latitude = latitude;
                s_status.longitude = longitude;
                s_status.model = kModel;
            }
            const bool network_up = net_is_up();
            if (!network_up || !time_synced()) {
                {
                    Lock lk(s_mtx);
                    s_status.fetching = false;
                    s_status.available = false;
                    s_status.state = "waiting";
                    s_status.reason = !network_up ? "network_unavailable" : "clock_unsynced";
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
                s_status.state = "fetching";
                s_status.reason.clear();
                s_status.error.clear();
                s_status.last_attempt_unix_s = now;
            }
            WeatherForecastSample sample;
            std::string error;
            bool ok = false;
            bool ota_preempted = false;
            bool poll_quiesce_failed = false;
            bool mqtt_quiesce_failed = false;
            bool modbus_quiesce_failed = false;
            bool syslog_quiesce_failed = false;
            bool heap_refused = false;
            HttpClientProbe headroom;
            {
                NetworkActivity activity;
                vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));
                // Set our flag first, then re-read OTA's.  If OTA won the race it either observes
                // this flag and waits, or observes it before we set it; in the latter case this
                // re-check sees OTA and no TLS allocation starts.  There is no interval in which
                // both clients may legitimately proceed.
                const TickType_t poll_wait_started = xTaskGetTickCount();
                while ((!hp_poll_network_quiesced() || !mqtt_publish_network_quiesced() ||
                        !mqtt_transport_network_quiesced() ||
                        !mb_network_quiesced() || !syslog_network_quiesced()) &&
                       xTaskGetTickCount() - poll_wait_started <
                           pdMS_TO_TICKS(kPollQuiesceWaitMs))
                    vTaskDelay(pdMS_TO_TICKS(kAllocatorRetryMs));
                poll_quiesce_failed = !hp_poll_network_quiesced();
                mqtt_quiesce_failed = !mqtt_publish_network_quiesced();
                if (!mqtt_quiesce_failed)
                    mqtt_quiesce_failed = !mqtt_transport_network_quiesced();
                modbus_quiesce_failed = !mb_network_quiesced();
                syslog_quiesce_failed = !syslog_network_quiesced();
                ota_preempted = ota_download_active();
                if (!ota_preempted && !poll_quiesce_failed && !mqtt_quiesce_failed &&
                    !modbus_quiesce_failed && !syslog_quiesce_failed)
                    ok = fetch_forecast(cfg, sample, error, heap_refused, headroom);
            }
            if (ota_preempted) {
                {
                    Lock lk(s_mtx);
                    s_status.fetching = false;
                    s_status.state = "waiting";
                    s_status.reason = "ota_active";
                    s_status.error.clear();
                }
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
                continue;
            }
            if (poll_quiesce_failed || mqtt_quiesce_failed || modbus_quiesce_failed ||
                syslog_quiesce_failed) {
                const HttpClientProbe blocked = http_client_probe();
                diag_printf("weather: %s did not quiesce (free=%u B largest=%u B)\n",
                            poll_quiesce_failed ? "X10A poll" : mqtt_quiesce_failed ? "MQTT publisher" :
                            modbus_quiesce_failed ? "HomeHub poll" : "Syslog",
                            static_cast<unsigned>(blocked.free_internal),
                            static_cast<unsigned>(blocked.largest_internal));
                { Lock lk(s_mtx); s_status.fetching = false; s_status.state = "waiting";
                  s_status.reason = poll_quiesce_failed ? "x10a_busy" :
                                    mqtt_quiesce_failed ? "mqtt_busy" :
                                    modbus_quiesce_failed ? "homehub_busy" : "syslog_busy"; }
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
                continue;
            }
            if (heap_refused) {
                diag_printf("weather: fetch skipped by low heap (free=%u B largest=%u B; "
                            "need %u/%u B)\n",
                            static_cast<unsigned>(headroom.free_internal),
                            static_cast<unsigned>(headroom.largest_internal),
                            static_cast<unsigned>(WEATHER_FETCH_MIN_FREE_BYTES),
                            static_cast<unsigned>(WEATHER_FETCH_MIN_LARGEST_BLOCK_BYTES));
                { Lock lk(s_mtx); s_status.fetching = false; s_status.state = "waiting";
                  s_status.reason = "heap_headroom"; }
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
                continue;
            }
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
                    s_status.hourly_count = sample.hourly_count;
                    s_status.hourly_unix_s = sample.hourly_unix_s;
                    s_status.hourly_temperature_c = sample.hourly_temperature_c;
                    s_status.hourly_humidity_pct = sample.hourly_humidity_pct;
                    s_status.hourly_pressure_hpa = sample.hourly_pressure_hpa;
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
            // These three assignments run while the original throw was most likely a bad_alloc, and
            // they are safe only because "error" (5), "fetch_failed" (12) and "out_of_memory" (13)
            // all fit libstdc++'s 15-char SSO buffer and therefore cannot allocate. That is
            // load-bearing: a 16-character reason string here turns this handler into a re-throw out
            // of the task, i.e. std::terminate and a reboot.
            { Lock lk(s_mtx); s_status.fetching = false; s_status.available = false;
              s_status.state = "error"; s_status.reason = "fetch_failed";
              s_status.error = "out_of_memory"; s_status.errors++; }
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
        } catch (...) {
            // The task boundary is a C frame boundary: an escaping non-std throw is std::terminate
            // and a reboot. Nothing in the fetch path throws a non-std type today (the HTTP client
            // and the JSON parser are C, and only std::string/std::vector throw) — this is the
            // GUARANTEE, which every other task loop here already has (mqtt_task, poll_task,
            // mb_task, syslog_task, status_led_task) and which this one was missing.
            diag_printf("weather: task exception (non-std)\n");
            { Lock lk(s_mtx); s_status.fetching = false; s_status.available = false;
              s_status.state = "error"; s_status.reason = "fetch_failed";
              s_status.error = "internal_error"; s_status.errors++; }
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

bool weather_fetch_active() {
    return s_network_active.load(std::memory_order_acquire);
}

}  // namespace daik
