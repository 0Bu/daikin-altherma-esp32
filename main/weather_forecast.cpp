#include "weather_forecast.hpp"

#include "config.hpp"
#include "diag_log.hpp"
#include "http_client_diag.hpp"
#include "http_deadline.hpp"
#include "hp_modbus.hpp"
#include "hp_poll.hpp"
#include "logic/http_deadline.hpp"
#include "logic/open_meteo.hpp"
#include "logic/payload_complete.hpp"
#include "logic/weather_forecast.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "sntp_time.hpp"
#include "stack_watch.hpp"
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
#include <cstdlib>
#include <cstring>
#include <exception>
#include <limits>
#include <string>
#include <type_traits>
#include <utility>
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
constexpr TickType_t  kSourceCancelWait     = pdMS_TO_TICKS(4000);
constexpr int kTaskStack = 12288;
constexpr UBaseType_t kTaskPrio = TASK_PRIO_WEATHER;   // see main/task_config.hpp
constexpr const char* kProvider = "open-meteo";
constexpr const char* kModel = "icon_seamless";

WeatherForecastStatus s_status;
SemaphoreHandle_t s_mtx = xSemaphoreCreateMutex();
std::atomic<TaskHandle_t>          s_task{nullptr};
std::atomic<WeatherTaskStartState> s_task_start_state{WeatherTaskStartState::NotStarted};
enum class SourceAdmission : uint8_t { Idle, Network, SourceChangePending, SourceChange };
std::atomic<SourceAdmission> s_source_admission{SourceAdmission::Idle};
std::atomic<uint32_t>        s_source_generation{0};
// Guarded by s_mtx. These live outside s_status so a source-status invalidation cannot erase an
// accepted HIL request or let an old source's completion be mistaken for the replacement source.
uint64_t s_refresh_next_token      = 0;
uint64_t s_refresh_requested_token = 0;
uint64_t s_refresh_started_token   = 0;
uint64_t s_refresh_completed_token = 0;
uint64_t s_refresh_success_token   = 0;
static_assert(std::atomic<SourceAdmission>::is_always_lock_free,
              "weather source admission must remain allocation- and lock-free");
static_assert(std::atomic<WeatherTaskStartState>::is_always_lock_free,
              "weather task availability must remain allocation- and lock-free");
static_assert(std::atomic<TaskHandle_t>::is_always_lock_free,
              "weather task publication must remain allocation- and lock-free");
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "weather source generations must remain allocation- and lock-free");

// Called with s_mtx held at the same boundary that turns `fetching` true. If the refresh POST won
// that lock first, this exact cycle owns its token; if an unrelated cycle won first, the request is
// left for the next cycle. A preflight deferral may claim the same outstanding token again, but no
// other fetch can complete it.
uint64_t claim_refresh_request_locked() noexcept {
    return weather_refresh_claim(s_refresh_requested_token, s_refresh_completed_token,
                                 s_refresh_started_token);
}

void complete_refresh_request(uint64_t token, bool success) noexcept {
    if (token == 0 || !s_mtx) return;
    SemGuard lk(s_mtx);
    (void)weather_refresh_complete(s_refresh_requested_token, s_refresh_started_token, token,
                                   success, s_refresh_completed_token, s_refresh_success_token);
}

// Defaults to fail-closed completion on every return/continue/exception after a request token has
// been claimed. finish() runs explicitly before long sleeps, so /status never waits 45 minutes to
// learn the result of an already-finished explicit attempt. Only the real forecast commit succeeds;
// OTA/quiesce/headroom deferrals are completed as failed and can never inherit a later retry edge.
struct RefreshRequestAttempt {
    uint64_t token = 0;

    ~RefreshRequestAttempt() noexcept { finish(false); }

    void finish(bool success) noexcept {
        if (token == 0) return;
        complete_refresh_request(token, success);
        token = 0;
    }
};

struct NetworkActivity {
    explicit NetworkActivity(uint32_t source_generation) {
        SourceAdmission expected = SourceAdmission::Idle;
        if (!s_source_admission.compare_exchange_strong(expected, SourceAdmission::Network,
                                                        std::memory_order_acq_rel,
                                                        std::memory_order_acquire))
            return;
        // A handler may advance the token just before losing the admission CAS above. In that
        // ordering it will wait for us, so release immediately without touching MQTT or the peer.
        if (s_source_generation.load(std::memory_order_acquire) != source_generation) {
            release_admission();
            return;
        }
        admitted = true;
        mqtt_transport_pause_for_network_heap();
    }
    ~NetworkActivity() {
        if (!admitted) return;
        mqtt_transport_resume_after_network_heap();
        release_admission();
    }
    explicit operator bool() const { return admitted; }
    bool     admitted = false;

private:
    static void release_admission() noexcept {
        // A waiting HTTP mutation owns Pending and receives a direct handoff. If its bounded wait
        // expired first, it changed Pending back to Network and this path releases ordinary Idle.
        SourceAdmission expected = SourceAdmission::SourceChangePending;
        if (s_source_admission.compare_exchange_strong(expected, SourceAdmission::SourceChange,
                                                       std::memory_order_acq_rel,
                                                       std::memory_order_acquire))
            return;
        expected = SourceAdmission::Network;
        if (s_source_admission.compare_exchange_strong(expected, SourceAdmission::Idle,
                                                       std::memory_order_acq_rel,
                                                       std::memory_order_acquire))
            return;
        std::abort();
    }
};

// C APIs do not participate in C++ unwinding. Keep their cleanup attached to the owning scope so a
// std::bad_alloc from an error string, response append or parse vector cannot leak the HTTP/TLS
// client or cJSON tree into the next five-minute retry.
struct HttpClientCleanup {
    HttpClientCleanup(esp_http_client_handle_t handle, HttpSocketDeadline& deadline)
        : handle(handle), deadline(deadline) {}
    HttpClientCleanup(const HttpClientCleanup&) = delete;
    HttpClientCleanup& operator=(const HttpClientCleanup&) = delete;
    ~HttpClientCleanup() {
        if (!handle) return;
        // The owner joins a possibly dispatched socket-shutdown callback before close can release
        // the descriptor for reuse. The deadline object's later destructor is then a no-op.
        (void)deadline.disarm();
        esp_http_client_close(handle);
        esp_http_client_cleanup(handle);
    }
    esp_http_client_handle_t handle;
    HttpSocketDeadline&      deadline;
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

// Keep the reviewed Weather task stages as real ELF symbols. The static stack gate deliberately
// sums the task frame with the mutually exclusive download and parse frames; inlining these helpers
// would make that proof disappear rather than prove a smaller path.
__attribute__((noinline)) bool download_json(const Config& weather, std::string& out,
                                             std::string& error, bool& heap_refused,
                                             HttpClientProbe& headroom) {
    if (!http_deadline_ready()) {
        error = "deadline_unavailable";
        return false;
    }
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
    HttpSocketDeadline socket_deadline;
    HttpClientCleanup  cleanup(client, socket_deadline);
    esp_http_client_set_header(client, "Accept", "application/json");

    auto set_timeout_to_deadline = [&](TickType_t started) {
        const TickType_t remaining =
            http_deadline_remaining_ticks(started, xTaskGetTickCount(), kDownloadDeadline);
        if (remaining == 0) return false;
        const uint64_t remaining_ms = static_cast<uint64_t>(remaining) * portTICK_PERIOD_MS;
        const int      timeout_ms   = remaining_ms < static_cast<uint64_t>(kHttpTimeoutMs)
                                          ? static_cast<int>(remaining_ms)
                                          : kHttpTimeoutMs;
        esp_http_client_set_timeout_ms(client, timeout_ms > 0 ? timeout_ms : 1);
        return true;
    };

    bool             ok               = false;
    const TickType_t download_started = xTaskGetTickCount();
    const esp_err_t  opened           = esp_http_client_open(client, 0);
    if (opened != ESP_OK) {
        http_client_log_open_failure("weather", client, opened, before);
        error = http_deadline_reached_at(download_started, xTaskGetTickCount(), kDownloadDeadline)
                    ? "download_timeout"
                    : "connect_failed";
    } else if (!set_timeout_to_deadline(download_started)) {
        error = "download_timeout";
    } else {
        const esp_err_t arm_err = socket_deadline.arm(client, download_started, kDownloadDeadline);
        if (arm_err != ESP_OK) {
            error = arm_err == ESP_ERR_TIMEOUT ? "download_timeout" : "deadline_unavailable";
        } else {
            const int64_t announced = esp_http_client_fetch_headers(client);
            if (socket_deadline.expired()) {
                error = "download_timeout";
            } else if (announced < 0) {
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
                        if (!set_timeout_to_deadline(download_started)) {
                            error = "download_timeout";
                            break;
                        }
                        const int n = esp_http_client_read(client, chunk, sizeof(chunk));
                        if (socket_deadline.expired()) {
                            error = "download_timeout";
                            break;
                        }
                        if (n < 0) {
                            error = "read_failed";
                            break;
                        }
                        if (n == 0) {
                            const bool complete = http_body_complete(
                                claimed, out.size(),
                                esp_http_client_is_complete_data_received(client));
                            if (!complete) {
                                error = "incomplete_payload";
                                break;
                            }
                            ok = !out.empty();
                            if (!ok) error = "empty_payload";
                            break;
                        }
                        if (out.size() + static_cast<size_t>(n) > kPayloadMax) {
                            error = "payload_too_large";
                            break;
                        }
                        out.append(chunk, static_cast<size_t>(n));
                    }
                }
            }
        }
    }
    // Stop or join before returning into JSON parsing and before HttpClientCleanup closes the fd.
    if (socket_deadline.disarm()) {
        ok    = false;
        error = "download_timeout";
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

__attribute__((noinline)) bool parse_forecast(const std::string& payload, int64_t fetched_unix_s,
                                              WeatherForecastSample& sample, std::string& error) {
    const char* parse_end = nullptr;
    cJSON*      root = cJSON_ParseWithLengthOpts(payload.data(), payload.size(), &parse_end, false);
    if (!root) {
        error = "json_invalid";
        return false;
    }
    JsonCleanup cleanup(root);
    const char* payload_end = payload.data() + payload.size();
    if (!parse_end || parse_end < payload.data() || parse_end > payload_end ||
        !json_suffix_is_whitespace(
            std::string_view(parse_end, static_cast<size_t>(payload_end - parse_end)))) {
        error = "json_trailing_data";
        return false;
    }
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

__attribute__((noinline)) bool fetch_forecast(const Config& weather, WeatherForecastSample& sample,
                                              std::string& error, bool& heap_refused,
                                              HttpClientProbe& headroom) {
    std::string payload;
    if (!download_json(weather, payload, error, heap_refused, headroom)) return false;
    int64_t fetched_unix_s = -1;
    int32_t ms = 0;
    time_now(fetched_unix_s, ms);
    if (fetched_unix_s < 0) { error = "clock_unsynced"; return false; }
    return parse_forecast(payload, fetched_unix_s, sample, error);
}

WeatherForecastStatus invalidated_status_for(bool configured, bool diagnostics_enabled,
                                             WeatherTaskStartState task_state) {
    // Build every allocating string before a source-change admission gate or status mutex is held.
    // The returned object is installed only by noexcept swap after a successful Config save.
    WeatherForecastStatus replacement;
    replacement.configured            = configured;
    replacement.fetching              = false;
    replacement.available             = false;
    replacement.has_value             = false;
    replacement.outdoor_mean_2h_c     = 0.0;
    replacement.solar_energy_2h_wh_m2 = 0.0;
    replacement.hourly_count          = 0;
    replacement.hourly_unix_s         = {};
    replacement.hourly_temperature_c  = {};
    replacement.hourly_humidity_pct   = {};
    replacement.hourly_pressure_hpa   = {};
    replacement.issued_unix_s         = -1;
    replacement.fetched_unix_s        = -1;
    replacement.decision_unix_s       = -1;
    replacement.last_attempt_unix_s   = -1;
    replacement.successes             = 0;
    replacement.errors                = 0;
    replacement.latitude.clear();
    replacement.longitude.clear();
    replacement.error.clear();
    const WeatherTaskFailure task_failure =
        weather_task_failure(configured, diagnostics_enabled, task_state);
    if (task_failure) {
        replacement.state  = "error";
        replacement.reason = task_failure.reason;
        replacement.error  = task_failure.error;
    } else {
        replacement.state  = configured && diagnostics_enabled ? "waiting" : "disabled";
        replacement.reason = !configured            ? "not_configured"
                             : !diagnostics_enabled ? "diagnostics_disabled"
                                                    : "location_changed";
    }
    return replacement;
}

WeatherForecastStatus invalidated_status(bool configured, bool diagnostics_enabled) {
    return invalidated_status_for(configured, diagnostics_enabled,
                                  s_task_start_state.load(std::memory_order_acquire));
}

static_assert(std::is_nothrow_swappable_v<WeatherForecastStatus>,
              "source invalidation commit must remain allocation-free and noexcept");

bool invalidate_if_generation(uint32_t expected_generation, bool configured,
                              bool diagnostics_enabled) {
    WeatherForecastStatus replacement = invalidated_status(configured, diagnostics_enabled);
    Lock lk(s_mtx);
    if (s_source_generation.load(std::memory_order_acquire) != expected_generation) return false;
    using std::swap;
    swap(s_status, replacement);
    return true;
}

// A saved location is dormant while the device-wide diagnostics switch is off. Invalidation clears
// every runtime value in either inactive state; the coordinates remain in Config and become active
// again only after explicit consent is restored.

void weather_task(void*) {
    // xTaskCreate may schedule this worker before it returns the handle to app_main. Do not
    // snapshot Config or sleep on a pre-publication state: the starter first release-publishes the
    // handle, then Available. A concurrent HTTP save before that edge needs no notification because
    // this first real loop necessarily reads its final Config/generation.
    while (s_task_start_state.load(std::memory_order_acquire) != WeatherTaskStartState::Available)
        vTaskDelay(1);
    for (;;) {
        // Retrospective high-water mark for the largest firmware-owned task. Sample at the loop
        // boundary for every lifecycle state, then again immediately after the TLS/HTTP/JSON
        // interval so release HIL cannot observe a successful refresh token before its deepest
        // stack path has been recorded.
        stack_watch_sample(StackWatch::Weather);
        const uint32_t source_generation = s_source_generation.load(std::memory_order_acquire);
        RefreshRequestAttempt refresh_attempt;
        try {
            // OTA owns the same scarce internal heap for TLS and RSA validation.  Check before the
            // Config/string snapshot so a scheduled forecast does not start allocating after OTA
            // requested quiescence.  The second check inside NetworkActivity below closes the race
            // where both tasks passed their first check at the same instant.
            if (ota_download_active()) {
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
                continue;
            }
            // Bind before the Config snapshot. Every HTTP-side source/consent transition advances
            // this token while holding s_mtx, so even A -> B -> A cannot become indistinguishable.
            const Config cfg = config();
            if (!cfg.diagnostics_enabled || !cfg.weather_enabled) {
                (void)invalidate_if_generation(source_generation, cfg.weather_enabled,
                                               cfg.diagnostics_enabled);
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(60000));
                continue;
            }
            const std::string latitude = weather_coordinate_format_e6(cfg.weather_latitude_e6);
            const std::string longitude = weather_coordinate_format_e6(cfg.weather_longitude_e6);
            bool              location_changed = false;
            {
                Lock lk(s_mtx);
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
                location_changed = s_status.latitude != latitude || s_status.longitude != longitude;
                if (!location_changed) s_status.configured = true;
            }
            if (location_changed) {
                WeatherForecastStatus replacement = invalidated_status(true, true);
                replacement.latitude              = latitude;
                replacement.longitude             = longitude;
                replacement.model                 = kModel;
                Lock lk(s_mtx);
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
                using std::swap;
                swap(s_status, replacement);
            }
            const bool network_up = net_is_up();
            if (!network_up || !time_synced()) {
                {
                    Lock lk(s_mtx);
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
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
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
                refresh_attempt.token = claim_refresh_request_locked();
                // The POST publishes its token and Give while holding this same mutex. If this
                // already-running natural cycle won the token, consume that now-redundant wake;
                // otherwise its long final wait would return immediately and start a second TLS
                // owner after HIL had already accepted this token's success. A sleeping task has
                // consumed the Give in its blocking Take already, so this zero-time drain is
                // benign.
                if (refresh_attempt.token != 0) ulTaskNotifyTake(pdTRUE, 0);
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
            bool                  source_preempted      = false;
            bool heap_refused = false;
            HttpClientProbe headroom;
            {
                NetworkActivity activity(source_generation);
                if (!activity) {
                    source_preempted = true;
                } else {
                    vTaskDelay(pdMS_TO_TICKS(kNetworkQuiesceLeadMs));
                    // Set our flag first, then re-read OTA's. If OTA won the race it either
                    // observes this flag and waits, or observes it before we set it; in the latter
                    // case this re-check sees OTA and no TLS allocation starts. There is no
                    // interval in which both clients may legitimately proceed.
                    const TickType_t poll_wait_started = xTaskGetTickCount();
                    while (
                        (!hp_poll_network_quiesced() || !mqtt_publish_network_quiesced() ||
                         !mqtt_transport_network_quiesced() || !mb_network_quiesced() ||
                         !syslog_network_quiesced()) &&
                        s_source_generation.load(std::memory_order_acquire) == source_generation &&
                        xTaskGetTickCount() - poll_wait_started < pdMS_TO_TICKS(kPollQuiesceWaitMs))
                        vTaskDelay(pdMS_TO_TICKS(kAllocatorRetryMs));
                    poll_quiesce_failed = !hp_poll_network_quiesced();
                    mqtt_quiesce_failed = !mqtt_publish_network_quiesced();
                    if (!mqtt_quiesce_failed)
                        mqtt_quiesce_failed = !mqtt_transport_network_quiesced();
                    modbus_quiesce_failed = !mb_network_quiesced();
                    syslog_quiesce_failed = !syslog_network_quiesced();
                    ota_preempted         = ota_download_active();
                    // A config handler owns source-change admission before its fallible save, then
                    // advances the generation only at durable commit. Re-read the exact Config
                    // identity too, then admit TLS only if neither consent nor coordinates changed
                    // during the scheduling/quiesce window.
                    const Config before_fetch = config();
                    source_preempted =
                        s_source_generation.load(std::memory_order_acquire) != source_generation ||
                        !before_fetch.diagnostics_enabled || !before_fetch.weather_enabled ||
                        before_fetch.diagnostics_generation != cfg.diagnostics_generation ||
                        before_fetch.weather_latitude_e6 != cfg.weather_latitude_e6 ||
                        before_fetch.weather_longitude_e6 != cfg.weather_longitude_e6;
                    if (!ota_preempted && !poll_quiesce_failed && !mqtt_quiesce_failed &&
                        !modbus_quiesce_failed && !syslog_quiesce_failed && !source_preempted)
                        ok = fetch_forecast(cfg, sample, error, heap_refused, headroom);
                }
            }
            stack_watch_sample(StackWatch::Weather);
            // A location/consent save may race the old request. Bind every result and failure to
            // the exact source snapshot that initiated it before changing public status.
            const Config current = config();
            const bool   config_changed =
                !current.diagnostics_enabled || !current.weather_enabled ||
                current.diagnostics_generation != cfg.diagnostics_generation ||
                current.weather_latitude_e6 != cfg.weather_latitude_e6 ||
                current.weather_longitude_e6 != cfg.weather_longitude_e6;
            if (config_changed) {
                (void)invalidate_if_generation(source_generation, current.weather_enabled,
                                               current.diagnostics_enabled);
                continue;
            }
            if (source_preempted) {
                // SourceChange owns network admission before the durable save. If the save later
                // fails, the old source remains authoritative, so settle this preempted attempt now
                // instead of leaving /status.fetching true until OTA permits another cycle. A
                // successful commit increments the generation and swaps a fully invalidated status;
                // in that ordering this old attempt must not touch it.
                {
                    Lock lk(s_mtx);
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
                    s_status.fetching = false;
                    s_status.state    = "waiting";
                    s_status.reason   = "source_busy";
                    s_status.error.clear();
                }
                refresh_attempt.finish(false);
                vTaskDelay(pdMS_TO_TICKS(25));
                continue;
            }
            if (s_source_generation.load(std::memory_order_acquire) != source_generation) continue;
            if (ota_preempted) {
                {
                    Lock lk(s_mtx);
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
                    s_status.fetching = false;
                    s_status.state = "waiting";
                    s_status.reason = "ota_active";
                    s_status.error.clear();
                }
                refresh_attempt.finish(false);
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
                {
                    Lock lk(s_mtx);
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
                    s_status.fetching = false;
                    s_status.state    = "waiting";
                    s_status.reason   = poll_quiesce_failed     ? "x10a_busy"
                                        : mqtt_quiesce_failed   ? "mqtt_busy"
                                        : modbus_quiesce_failed ? "homehub_busy"
                                                                : "syslog_busy";
                }
                refresh_attempt.finish(false);
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
                {
                    Lock lk(s_mtx);
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
                    s_status.fetching = false;
                    s_status.state    = "waiting";
                    s_status.reason   = "heap_headroom";
                }
                refresh_attempt.finish(false);
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
                continue;
            }
            bool updated = false;
            if (ok) {
                Lock lk(s_mtx);
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
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
                    if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                        continue;
                    s_status.fetching = false;
                    s_status.available = false;
                    s_status.state = "error";
                    s_status.reason = "fetch_failed";
                    s_status.error = failure;
                    s_status.errors++;
                }
                diag_printf("weather: Open-Meteo fetch failed (%s)\n", failure.c_str());
            }
            refresh_attempt.finish(updated);
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
            {
                Lock lk(s_mtx);
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
                s_status.fetching  = false;
                s_status.available = false;
                s_status.state     = "error";
                s_status.reason    = "fetch_failed";
                s_status.error     = "out_of_memory";
                s_status.errors++;
            }
            refresh_attempt.finish(false);
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
        } catch (...) {
            // The task boundary is a C frame boundary: an escaping non-std throw is std::terminate
            // and a reboot. Nothing in the fetch path throws a non-std type today (the HTTP client
            // and the JSON parser are C, and only std::string/std::vector throw) — this is the
            // GUARANTEE, which every other task loop here already has (mqtt_task, poll_task,
            // mb_task, syslog_task, status_led_task) and which this one was missing.
            diag_printf("weather: task exception (non-std)\n");
            {
                Lock lk(s_mtx);
                if (s_source_generation.load(std::memory_order_acquire) != source_generation)
                    continue;
                s_status.fetching  = false;
                s_status.available = false;
                s_status.state     = "error";
                s_status.reason    = "fetch_failed";
                s_status.error     = "internal_error";
                s_status.errors++;
            }
            refresh_attempt.finish(false);
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(WEATHER_RETRY_INTERVAL_S * 1000u));
        }
    }
}

}  // namespace

void weather_forecast_start() {
    if (s_task.load(std::memory_order_acquire)) return;
    if (!s_mtx) {
        s_task_start_state.store(WeatherTaskStartState::TaskStartFailed, std::memory_order_release);
        diag_printf("weather: mutex allocation failed\n");
        return;
    }
    if (!http_deadline_ready()) {
        s_task_start_state.store(WeatherTaskStartState::DeadlineUnavailable,
                                 std::memory_order_release);
        diag_printf("weather: HTTP deadline owner unavailable\n");
        return;
    }
    TaskHandle_t created_task = nullptr;
    if (xTaskCreate(weather_task, "weather", kTaskStack, nullptr, kTaskPrio, &created_task) !=
        pdPASS) {
        s_task_start_state.store(WeatherTaskStartState::TaskStartFailed, std::memory_order_release);
        diag_printf("weather: task allocation failed\n");
        return;
    }
    // The worker can run before xTaskCreate() returns. Until success is known, NotStarted remains
    // deliberately fail-closed. Publish its handle before the release edge that opens its first
    // Config snapshot, so HTTP notification and refresh paths never race a non-atomic handle.
    s_task.store(created_task, std::memory_order_release);
    s_task_start_state.store(WeatherTaskStartState::Available, std::memory_order_release);
}

void weather_forecast_reconfigure() {
    if (TaskHandle_t task = s_task.load(std::memory_order_acquire)) xTaskNotifyGive(task);
}

static bool begin_source_change() noexcept {
    // One atomic state owns both sides of admission. Separate pending/active atomics permit the
    // store-buffering outcome in which both sides believe they won; this CAS state cannot. Hold the
    // SourceChange state across the fallible save and synchronous invalidation in the HTTP handler.
    const TickType_t started      = xTaskGetTickCount();
    bool             owns_handoff = false;
    do {
        const SourceAdmission observed = s_source_admission.load(std::memory_order_acquire);
        if (owns_handoff) {
            if (observed == SourceAdmission::SourceChange) return true;
            if (observed != SourceAdmission::SourceChangePending) std::abort();
        } else if (observed == SourceAdmission::Idle) {
            SourceAdmission expected = SourceAdmission::Idle;
            if (s_source_admission.compare_exchange_strong(expected, SourceAdmission::SourceChange,
                                                           std::memory_order_acq_rel,
                                                           std::memory_order_acquire)) {
                return true;
            }
        } else if (observed == SourceAdmission::Network) {
            SourceAdmission expected = SourceAdmission::Network;
            owns_handoff             = s_source_admission.compare_exchange_strong(
                expected, SourceAdmission::SourceChangePending, std::memory_order_acq_rel,
                std::memory_order_acquire);
        }
        if (xTaskGetTickCount() - started >= kSourceCancelWait) break;
        vTaskDelay(pdMS_TO_TICKS(25));
    } while (true);

    if (owns_handoff) {
        // Cancel a still-running handoff without changing the source generation: the old request is
        // valid because this HTTP mutation returns 503 unchanged. If the network owner completed
        // concurrently, its Pending->SourceChange CAS won and this handler owns the handoff.
        SourceAdmission expected = SourceAdmission::SourceChangePending;
        if (s_source_admission.compare_exchange_strong(expected, SourceAdmission::Network,
                                                       std::memory_order_acq_rel,
                                                       std::memory_order_acquire))
            return false;
        if (expected == SourceAdmission::SourceChange) return true;
        std::abort();
    }
    return false;
}

static void release_source_change() noexcept {
    SourceAdmission expected = SourceAdmission::SourceChange;
    if (!s_source_admission.compare_exchange_strong(
            expected, SourceAdmission::Idle, std::memory_order_acq_rel, std::memory_order_acquire))
        std::abort();
}

WeatherSourceChange::WeatherSourceChange(bool configured, bool diagnostics_enabled)
    : replacement_(invalidated_status_for(configured, diagnostics_enabled,
                                          WeatherTaskStartState::Available)),
      configured_(configured), diagnostics_enabled_(diagnostics_enabled), failure_state_("error"),
      not_started_reason_("task_unavailable"), not_started_error_("task_unavailable"),
      deadline_reason_("deadline_unavailable"), deadline_error_("deadline_unavailable"),
      task_start_reason_("task_start_failed"), task_start_error_("out_of_memory"),
      held_(s_mtx && begin_source_change()) {}

WeatherSourceChange::~WeatherSourceChange() noexcept {
    if (!held_) return;
    release_source_change();
    weather_forecast_reconfigure();
}

void WeatherSourceChange::commit() noexcept {
    if (!held_ ||
        s_source_admission.load(std::memory_order_acquire) != SourceAdmission::SourceChange)
        std::abort();
    {
        Lock lk(s_mtx);
        // SourceChange may have staged while boot was still deciding whether the worker could
        // start. Re-read the final latch under the commit mutex and select an already-allocated
        // replacement with noexcept swaps; no post-NVS allocation or stale waiting state is
        // allowed.
        std::string* failure_reason = nullptr;
        std::string* failure_error  = nullptr;
        if (configured_ && diagnostics_enabled_) {
            switch (s_task_start_state.load(std::memory_order_acquire)) {
            case WeatherTaskStartState::Available:
                break;
            case WeatherTaskStartState::DeadlineUnavailable:
                failure_reason = &deadline_reason_;
                failure_error  = &deadline_error_;
                break;
            case WeatherTaskStartState::TaskStartFailed:
                failure_reason = &task_start_reason_;
                failure_error  = &task_start_error_;
                break;
            case WeatherTaskStartState::NotStarted:
                failure_reason = &not_started_reason_;
                failure_error  = &not_started_error_;
                break;
            }
        }
        if (failure_reason) {
            using std::swap;
            swap(replacement_.state, failure_state_);
            swap(replacement_.reason, *failure_reason);
            swap(replacement_.error, *failure_error);
        }
        s_source_generation.fetch_add(1, std::memory_order_acq_rel);
        // A source/consent transaction supersedes any accepted explicit refresh. Complete that
        // exact token as unsuccessful so it cannot block later requests or be satisfied by B.
        weather_refresh_cancel_outstanding(s_refresh_requested_token, s_refresh_completed_token);
        using std::swap;
        swap(s_status, replacement_);
    }
    release_source_change();
    held_ = false;
}

bool weather_forecast_request_refresh(uint64_t& token) noexcept {
    token             = 0;
    TaskHandle_t task = s_task.load(std::memory_order_acquire);
    if (!task || !s_mtx) return false;
    {
        Lock lk(s_mtx);
        task = s_task.load(std::memory_order_acquire);
        if (!task || s_refresh_requested_token != s_refresh_completed_token) return false;
        ++s_refresh_next_token;
        if (s_refresh_next_token == 0) ++s_refresh_next_token;
        s_refresh_requested_token = s_refresh_next_token;
        token                     = s_refresh_requested_token;
        // Publish token + wake as one s_mtx transaction. The task claims under this mutex too, so
        // it can never drain before this Give lands and leave a late duplicate-cycle wake queued.
        xTaskNotifyGive(task);
    }
    return true;
}

WeatherForecastStatus weather_forecast_status() {
    WeatherForecastStatus status;
    {
        // A null mutex means its allocation failed before app_main. In that state no task or source
        // transaction can mutate s_status, so the default snapshot is immutable and safe to copy.
        Lock lk(s_mtx);
        status                         = s_status;
        status.refresh_requested_token = s_refresh_requested_token;
        status.refresh_started_token   = s_refresh_started_token;
        status.refresh_completed_token = s_refresh_completed_token;
        status.refresh_success_token   = s_refresh_success_token;
    }
    // Materialise the fixed atomic failure only in the caller's HTTP/MQTT exception boundary. The
    // infrastructure/OOM path itself performs no string write, allocation or unlocked mutation.
    const WeatherTaskFailure task_failure =
        weather_task_failure(true, true, s_task_start_state.load(std::memory_order_acquire));
    if (task_failure) {
        // The caller supplies the durable config authority separately. Marking the runtime snapshot
        // configured lets an active config publish the failure; disabled configs still own cleanup.
        status.configured = true;
        status.fetching   = false;
        status.available  = false;
        status.state      = "error";
        status.reason     = task_failure.reason;
        status.error      = task_failure.error;
    }
    return status;
}

bool weather_fetch_active() {
    const SourceAdmission state = s_source_admission.load(std::memory_order_acquire);
    return state == SourceAdmission::Network || state == SourceAdmission::SourceChangePending;
}

}  // namespace daik
