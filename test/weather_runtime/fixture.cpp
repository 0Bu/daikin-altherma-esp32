// Complete production Weather unit. The default JSON seam consumes explicitly constructed ASTs;
// optional lock-resolved cJSON compiles the real lexer. HTTP/deadline/RTOS remain host adapters.
#include "sdk.hpp"
#include "cJSON.h"
#include <iomanip>
#include <iostream>
#include <limits>
#include <new>
#include <optional>
#include <sstream>
#ifdef WEATHER_REAL_CJSON
static cJSON* fixture_parse(const char* text, size_t length, const char** end,
                            cJSON_bool terminate) {
    ++sdk::json_parses;
    if (sdk::json_parse_fails) return nullptr;
    cJSON* root = cJSON_ParseWithLengthOpts(text, length, end, terminate);
    if (sdk::fail_alloc_after_parse) sdk::fail_cpp_alloc = true;
    return root;
}
static void fixture_delete(cJSON* root) {
    ++sdk::json_deletes;
    cJSON_Delete(root);
}
#define cJSON_ParseWithLengthOpts fixture_parse
#define cJSON_Delete fixture_delete
#endif
#ifndef WEATHER_PRODUCTION_SOURCE
#error "Bind the complete production Weather translation unit"
#endif
#include WEATHER_PRODUCTION_SOURCE

namespace allocation_witness {
enum class Kind { None, ConfigCopy, NetworkRequest };
struct Entry {
    void*  pointer = nullptr;
    size_t bytes   = 0;
    Kind   kind    = Kind::None;
};
struct Snapshot {
    unsigned config_count = 0, request_count = 0;
    size_t   config_bytes = 0, request_bytes = 0;
};
Entry      entries[512];
bool       config_copy_active = false, config_ref_active = false, overflow = false;
bool       have_resume = false, have_wait = false;
unsigned   config_copy_calls  = 0;
unsigned   config_allocations = 0;
TickType_t wait_ticks         = 0;
Snapshot   at_resume, at_wait;
struct ConfigCopyScope {
    ConfigCopyScope() {
        ++config_copy_calls;
        config_copy_active = true;
    }
    ~ConfigCopyScope() { config_copy_active = false; }
};
void allocated(void* pointer, size_t bytes) noexcept {
    Kind kind = (config_copy_active || config_ref_active) ? Kind::ConfigCopy
                : (sdk::adapter_allocation_depth == 0 && daik::weather_fetch_active())
                    ? Kind::NetworkRequest
                    : Kind::None;
    if (kind == Kind::None) return;
    if (kind == Kind::ConfigCopy) ++config_allocations;
    for (auto& entry : entries)
        if (!entry.pointer) {
            entry = {pointer, bytes, kind};
            return;
        }
    overflow = true;
}
void released(void* pointer) noexcept {
    if (!pointer) return;
    for (auto& entry : entries)
        if (entry.pointer == pointer) {
            entry = {};
            return;
        }
}
Snapshot snapshot() noexcept {
    Snapshot out;
    for (const auto& entry : entries) {
        if (!entry.pointer) continue;
        if (entry.kind == Kind::ConfigCopy) {
            ++out.config_count;
            out.config_bytes += entry.bytes;
        } else {
            ++out.request_count;
            out.request_bytes += entry.bytes;
        }
    }
    return out;
}
void resumed() noexcept {
    if (have_resume) return;
    at_resume   = snapshot();
    have_resume = true;
}
void waiting(TickType_t ticks) noexcept {
    if (have_wait) return;
    at_wait    = snapshot();
    wait_ticks = ticks;
    have_wait  = true;
}
void reset() noexcept {
    for (auto& entry : entries) entry = {};
    config_copy_active = config_ref_active = overflow = have_resume = have_wait = false;
    config_copy_calls                                                           = 0;
    config_allocations                                                          = 0;
    wait_ticks                                                                  = 0;
    at_resume = at_wait = {};
}
} // namespace allocation_witness
void* operator new(size_t size) {
    if (sdk::fail_cpp_alloc) throw std::bad_alloc();
    if (sdk::fail_request_alloc && sdk::adapter_allocation_depth == 0 &&
        daik::weather_fetch_active())
        throw std::bad_alloc();
    if (void* p = std::malloc(size ? size : 1)) {
        allocation_witness::allocated(p, size);
        return p;
    }
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept {
    allocation_witness::released(p);
    std::free(p);
}
void operator delete(void* p, size_t) noexcept {
    allocation_witness::released(p);
    std::free(p);
}
void* operator new[](size_t n) { return ::operator new(n); }
void  operator delete[](void* p) noexcept {
    allocation_witness::released(p);
    std::free(p);
}
void operator delete[](void* p, size_t) noexcept {
    allocation_witness::released(p);
    std::free(p);
}

namespace adapter {
daik::Config          cfg;
bool                  network_up = true, synced = true, ota_active = false, poll_quiesced = true;
bool                  mqtt_quiesced = true, modbus_quiesced = true, syslog_quiesced = true;
int64_t               unix_s = 1800000000;
daik::HttpClientProbe probe{100000, 60000, 4096};
int                   config_reads = 0;
bool                  config_oom   = false;
} // namespace adapter
namespace daik {
Config config() {
    ++adapter::config_reads;
    if (adapter::config_oom) throw std::bad_alloc();
    allocation_witness::ConfigCopyScope copied;
    return adapter::cfg;
}
namespace detail {
void config_lock() {
    ++sdk::lock_depth;
    allocation_witness::config_ref_active = true;
}
void config_unlock() {
    allocation_witness::config_ref_active = false;
    --sdk::lock_depth;
}
const Config& config_ref_locked() { return adapter::cfg; }
} // namespace detail
void diag_printf(const char*, ...) {}
bool net_is_up() { return adapter::network_up; }
bool time_synced() { return adapter::synced; }
void time_now(int64_t& unix_s, int32_t& ms) {
    unix_s = adapter::unix_s;
    ms     = 0;
}
bool ota_download_active() { return adapter::ota_active; }
bool hp_poll_network_quiesced() { return adapter::poll_quiesced; }
bool mqtt_publish_network_quiesced() { return adapter::mqtt_quiesced; }
bool mqtt_transport_network_quiesced() { return adapter::mqtt_quiesced; }
bool mb_network_quiesced() { return adapter::modbus_quiesced; }
bool syslog_network_quiesced() { return adapter::syslog_quiesced; }
void mqtt_transport_pause_for_network_heap() { ++sdk::pauses; }
void mqtt_transport_resume_after_network_heap() {
    allocation_witness::resumed();
    ++sdk::resumes;
}
void                  stack_watch_sample(StackWatch) noexcept {}
HttpClientProbe       http_client_probe() noexcept { return adapter::probe; }
void                  http_client_log_init_failure(const char*, const HttpClientProbe&) noexcept {}
HttpClientOpenFailure http_client_log_open_failure(const char*, esp_http_client_handle_t,
                                                   esp_err_t e, const HttpClientProbe&) noexcept {
    return {e, 0, 0, 0};
}
bool http_deadline_ready() noexcept { return sdk::deadline_ready; }
HttpSocketDeadline::~HttpSocketDeadline() { (void)disarm(); }
esp_err_t HttpSocketDeadline::arm(esp_http_client_handle_t, TickType_t start,
                                  TickType_t duration) noexcept {
    started_  = start;
    duration_ = duration;
    active_   = sdk::arm_result == ESP_OK;
    return sdk::arm_result;
}
bool HttpSocketDeadline::expired() const noexcept {
    return expired_latched_ || (active_ && sdk::ticks - started_ >= duration_);
}
bool HttpSocketDeadline::disarm() noexcept {
    expired_latched_ = expired();
    if (active_) {
        sdk::AdapterAllocationScope adapter_allocations;
        sdk::events.push_back("disarm");
    }
    active_ = false;
    return expired_latched_;
}
} // namespace daik
namespace test {
using namespace daik;
#define REQUIRE(c)                                                                                 \
    do {                                                                                           \
        if (!(c))                                                                                  \
            throw std::runtime_error(std::string(__func__) + ":" + std::to_string(__LINE__) +      \
                                     ": " #c);                                                     \
    } while (0)
constexpr int64_t NOW = 1800000000;
struct Payload {
    std::vector<double> times{static_cast<double>(NOW), static_cast<double>(NOW + 3600),
                              static_cast<double>(NOW + 7200), static_cast<double>(NOW + 10800)};
    std::vector<double> temperature{10, 12, 14, 16}, humidity{40, 45, 50, 55};
    std::vector<double> pressure{1000, 1001, 1002, 1003}, shortwave{0, 100, 200, 300};
    int                 utc_offset    = 0;
    std::string         pressure_unit = "hPa";
};
void reset() {
#ifndef WEATHER_REAL_CJSON
    if (sdk::json_tree) cJSON_Delete(sdk::json_tree);
    sdk::json_tree = nullptr;
#endif
    sdk::ticks          = 0;
    sdk::lock_depth     = 0;
    sdk::deadline_ready = true;
    sdk::task_fails = sdk::init_fails = sdk::read_fails = false;
    sdk::message_complete                               = true;
    sdk::open_result = sdk::arm_result = ESP_OK;
    sdk::status                        = 200;
    sdk::inits = sdk::closes = sdk::cleanups = sdk::reads = 0;
    sdk::pauses = sdk::resumes = sdk::notified = 0;
    sdk::claimed                               = -1;
    sdk::announced                             = 1;
    sdk::open_ticks = sdk::header_ticks = sdk::read_ticks = 0;
    sdk::chunk_size                                       = 1024;
    sdk::body                                             = "{\"fixture\":true}";
    sdk::url.clear();
    sdk::events.clear();
    sdk::timeouts.clear();
    sdk::client   = {};
    sdk::task_fn  = nullptr;
    sdk::on_delay = sdk::on_notify = {};
    sdk::on_open = sdk::on_read = sdk::on_cleanup = {};
    sdk::json_parse_fails                         = false;
    sdk::fail_cpp_alloc = sdk::fail_alloc_after_parse = false;
    sdk::fail_request_alloc                           = false;
    sdk::json_prefix_length                           = 0;
    sdk::json_parses = sdk::json_deletes = 0;
    adapter::cfg                         = Config{};
    adapter::cfg.weather_enabled = adapter::cfg.diagnostics_enabled = true;
    adapter::cfg.weather_latitude_e6                                = 12345678;
    adapter::cfg.weather_longitude_e6                               = 23456789;
    adapter::network_up = adapter::synced = adapter::poll_quiesced = true;
    adapter::mqtt_quiesced = adapter::modbus_quiesced = adapter::syslog_quiesced = true;
    adapter::ota_active = adapter::config_oom = false;
    adapter::unix_s                           = NOW;
    adapter::probe                            = {100000, 60000, 4096};
    adapter::config_reads                     = 0;
    s_status                                  = WeatherForecastStatus{};
    s_task                                    = nullptr;
    s_mtx                                     = &sdk::mutex;
    s_task_start_state                        = WeatherTaskStartState::NotStarted;
    s_source_admission                        = SourceAdmission::Idle;
    s_source_generation                       = 0;
    s_refresh_next_token = s_refresh_requested_token = s_refresh_started_token = 0;
    s_refresh_completed_token = s_refresh_success_token = 0;
    allocation_witness::reset();
}
cJSON* array(const std::vector<double>& values) {
    cJSON* result = cJSON_CreateArray();
    for (double value : values) cJSON_AddItemToArray(result, cJSON_CreateNumber(value));
    return result;
}
cJSON* tree(const Payload& p) {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddItemToObject(root, "utc_offset_seconds", cJSON_CreateNumber(p.utc_offset));
    cJSON* hourly = cJSON_CreateObject();
    cJSON_AddItemToObject(root, "hourly", hourly);
    cJSON_AddItemToObject(hourly, "time", array(p.times));
    cJSON_AddItemToObject(hourly, "temperature_2m", array(p.temperature));
    cJSON_AddItemToObject(hourly, "relative_humidity_2m", array(p.humidity));
    cJSON_AddItemToObject(hourly, "surface_pressure", array(p.pressure));
    cJSON_AddItemToObject(hourly, "shortwave_radiation", array(p.shortwave));
    cJSON* units = cJSON_CreateObject();
    cJSON_AddItemToObject(root, "hourly_units", units);
    for (auto item : {std::pair<const char*, const char*>{"time", "unixtime"},
                      {"temperature_2m", "°C"},
                      {"relative_humidity_2m", "%"},
                      {"surface_pressure", p.pressure_unit.c_str()},
                      {"shortwave_radiation", "W/m²"}})
        cJSON_AddItemToObject(units, item.first, cJSON_CreateString(item.second));
    return root;
}
std::string prepare(const Payload& p = {}) {
    std::ostringstream text;
    text << std::setprecision(17) << "{\"utc_offset_seconds\":" << p.utc_offset << ",\"hourly\":{";
    bool first = true;
    for (auto item : {std::pair<const char*, const std::vector<double>*>{"time", &p.times},
                      {"temperature_2m", &p.temperature},
                      {"relative_humidity_2m", &p.humidity},
                      {"surface_pressure", &p.pressure},
                      {"shortwave_radiation", &p.shortwave}}) {
        if (!first) text << ',';
        first = false;
        text << '"' << item.first << "\":[";
        for (size_t i = 0; i < item.second->size(); ++i) {
            if (i) text << ',';
            text << (*item.second)[i];
        }
        text << ']';
    }
    text << "},\"hourly_units\":{\"time\":\"unixtime\",\"temperature_2m\":\"°C\","
            "\"relative_humidity_2m\":\"%\",\"surface_pressure\":\""
         << p.pressure_unit << "\",\"shortwave_radiation\":\"W/m²\"}}";
    std::string payload     = text.str();
    sdk::json_prefix_length = payload.size();
#ifndef WEATHER_REAL_CJSON
    if (sdk::json_tree) cJSON_Delete(sdk::json_tree);
    sdk::json_tree = tree(p);
#endif
    return payload;
}
void epoch_bounds() {
    reset();
    for (double value : {std::ldexp(1.0, 63), std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::quiet_NaN(), -1.0, 10.5}) {
        Payload p;
        p.times[1]                = value;
        cJSON*               root = tree(p);
        std::vector<int64_t> result;
        const bool           accepted =
            json_time_array(cJSON_GetObjectItemCaseSensitive(root, "hourly"), result);
        cJSON_Delete(root);
        REQUIRE(!accepted);
    }
    Payload p;
    p.times[1]                = std::nextafter(std::ldexp(1.0, 63), 0.0);
    cJSON*               root = tree(p);
    std::vector<int64_t> result;
    const bool accepted = json_time_array(cJSON_GetObjectItemCaseSensitive(root, "hourly"), result);
    cJSON_Delete(root);
    REQUIRE(accepted && result[1] > 0 && result[1] < INT64_MAX);
}
void forecast_parse() {
    reset();
    WeatherForecastSample sample;
    std::string           error;
    REQUIRE(parse_forecast(prepare(), NOW, sample, error));
    REQUIRE(sample.outdoor_mean_2h_c == 13 && sample.solar_energy_2h_wh_m2 == 300);
    REQUIRE(sample.hourly_count == 4 && sample.hourly_pressure_hpa[2] == 1002);
    REQUIRE(sdk::json_parses == 1 && sdk::json_deletes == 1);
    Payload p;
    p.pressure_unit = "Pa";
    REQUIRE(!parse_forecast(prepare(p), NOW, sample, error) && error == "unit_mismatch");
    p            = Payload{};
    p.utc_offset = 3600;
    REQUIRE(!parse_forecast(prepare(p), NOW, sample, error) && error == "payload_shape_invalid");
    p = Payload{};
    p.humidity.pop_back();
    REQUIRE(!parse_forecast(prepare(p), NOW, sample, error) && error == "payload_shape_invalid");
    p = Payload{};
    p.times[2]++;
    REQUIRE(!parse_forecast(prepare(p), NOW, sample, error) && error == "non_hourly_horizon");
    REQUIRE(sdk::json_deletes == sdk::json_parses);
}
void json_guards() {
    reset();
    WeatherForecastSample sample;
    std::string           error;
    REQUIRE(!parse_forecast(prepare() + "{}", NOW, sample, error));
    REQUIRE(error == "json_trailing_data" && sdk::json_deletes == 1);
    REQUIRE(parse_forecast(prepare() + " \t\r\n", NOW, sample, error));
    const int         parsed = sdk::json_parses;
    const std::string deep   = std::string(17, '[') + "0" + std::string(17, ']');
    REQUIRE(!parse_forecast(deep, NOW, sample, error) && error == "json_invalid");
    REQUIRE(sdk::json_parses == parsed);
    sdk::json_parse_fails = true;
    REQUIRE(!parse_forecast(prepare(), NOW, sample, error) && error == "json_invalid");
}
void json_cleanup() {
    reset();
    WeatherForecastSample sample;
    std::string           error;
    const auto            payload = prepare();
    REQUIRE(parse_forecast(payload, NOW, sample, error));
    REQUIRE(sdk::json_deletes == 1);
    const auto next             = prepare();
    sdk::fail_alloc_after_parse = true;
    bool caught                 = false;
    try {
        (void)parse_forecast(next, NOW, sample, error);
    } catch (const std::bad_alloc&) {
        caught = true;
    }
    sdk::fail_cpp_alloc = false;
    REQUIRE(caught && sdk::json_deletes == 2);
}
struct Download {
    std::string     body, error;
    bool            heap_refused = false;
    HttpClientProbe probe;
    bool            run() {
        return download_json(weather_config_snapshot(adapter::cfg), body, error, heap_refused,
                                        probe);
    }
};
void cleanup_assertions() {
    REQUIRE(sdk::closes == 1 && sdk::cleanups == 1 && !sdk::client.live);
    REQUIRE(sdk::events.size() >= 2);
    REQUIRE(sdk::events[sdk::events.size() - 2] == "close" && sdk::events.back() == "cleanup");
}
void transport_success() {
    reset();
    Download d;
    sdk::claimed = static_cast<int64_t>(sdk::body.size());
    REQUIRE(d.run() && d.body == sdk::body && d.error.empty() && !d.heap_refused);
    REQUIRE(sdk::url.find("latitude=12.345678&longitude=23.456789") != std::string::npos);
    REQUIRE(sdk::events ==
            std::vector<std::string>({"init", "open", "disarm", "close", "cleanup"}));
    cleanup_assertions();
}
void transport_completion() {
    for (int variant = 0; variant < 3; ++variant) {
        reset();
        sdk::claimed          = variant == 0 ? static_cast<int64_t>(sdk::body.size() + 1) : -1;
        sdk::message_complete = variant == 0;
        if (variant == 2) sdk::body.clear();
        Download d;
        REQUIRE(!d.run() && d.error == "incomplete_payload");
        cleanup_assertions();
    }
    reset();
    sdk::body.clear();
    Download d;
    REQUIRE(!d.run() && d.error == "empty_payload");
    cleanup_assertions();
}
void transport_chunk_boundaries() {
    for (size_t length : {size_t{255}, size_t{256}, size_t{257}, size_t{511}, size_t{512},
                          size_t{513}, size_t{8191}, size_t{8192}}) {
        for (size_t chunk : {size_t{1}, size_t{17}, size_t{255}, size_t{256}, size_t{1024}}) {
            for (bool known_length : {true, false}) {
                reset();
                sdk::body.resize(length);
                for (size_t i = 0; i < length; ++i)
                    sdk::body[i] = static_cast<char>('a' + i % 26);
                sdk::chunk_size = chunk;
                if (known_length) sdk::claimed = static_cast<int64_t>(length);
                Download d;
                REQUIRE(d.run() && d.body == sdk::body && d.error.empty());
                cleanup_assertions();
            }
        }
    }
}
void transport_body_cap() {
    for (bool known_length : {true, false}) {
        reset();
        sdk::body.assign(8193, 'a');
        if (known_length) sdk::claimed = 8193;
        Download d;
        REQUIRE(!d.run() && d.error == "payload_too_large" && d.body.size() <= 8192);
        if (known_length) REQUIRE(sdk::reads == 0);
        cleanup_assertions();
    }
}
void transport_deadline() {
    for (int phase = 0; phase < 3; ++phase) {
        reset();
        if (phase == 0) sdk::open_ticks = 60000;
        if (phase == 1) sdk::header_ticks = 60000;
        if (phase == 2) {
            sdk::body.assign(20, 'a');
            sdk::chunk_size = 1;
            sdk::read_ticks = 5000;
        }
        Download d;
        REQUIRE(!d.run() && d.error == "download_timeout");
        REQUIRE(sdk::ticks == 60000);
        cleanup_assertions();
    }
}
void transport_failures() {
    for (int failure = 0; failure < 5; ++failure) {
        reset();
        if (failure == 0) sdk::open_result = ESP_FAIL;
        if (failure == 1) sdk::arm_result = ESP_FAIL;
        if (failure == 2) sdk::announced = -1;
        if (failure == 3) sdk::status = 503;
        if (failure == 4) sdk::read_fails = true;
        Download d;
        REQUIRE(!d.run());
        cleanup_assertions();
    }
    reset();
    sdk::on_read = [] { throw std::bad_alloc(); };
    Download d;
    bool     caught = false;
    try {
        d.run();
    } catch (const std::bad_alloc&) {
        caught = true;
    }
    REQUIRE(caught);
    cleanup_assertions();
}
void transport_admission() {
    reset();
    adapter::probe.largest_internal = 1;
    Download d;
    REQUIRE(!d.run() && d.heap_refused && sdk::inits == 0);
    reset();
    sdk::deadline_ready = false;
    REQUIRE(!d.run() && d.error == "deadline_unavailable" && sdk::inits == 0);
    reset();
    sdk::init_fails = true;
    REQUIRE(!d.run() && d.error == "out_of_memory" && sdk::cleanups == 0);
}
void source_transaction() {
    reset();
    weather_forecast_start();
    s_status.has_value = s_status.available = true;
    s_status.hourly_count                   = 4;
    s_status.fetched_unix_s                 = NOW;
    uint64_t token                          = 0;
    REQUIRE(weather_forecast_request_refresh(token) && token != 0);
    {
        WeatherSourceChange aborted(false, false);
        REQUIRE(aborted);
        REQUIRE(s_status.has_value && s_source_generation == 0);
    }
    REQUIRE(s_status.has_value && s_source_generation == 0 &&
            s_source_admission == SourceAdmission::Idle);
    {
        WeatherSourceChange saved(false, false);
        REQUIRE(saved);
        saved.commit();
    }
    REQUIRE(s_source_generation == 1 && !s_status.has_value && !s_status.available);
    REQUIRE(s_status.hourly_count == 0 && s_status.fetched_unix_s == -1 &&
            s_status.state == "disabled");
    REQUIRE(s_refresh_completed_token == token && s_refresh_success_token != token);
    REQUIRE(s_source_admission == SourceAdmission::Idle && sdk::lock_depth == 0);
}
void source_admission_generation() {
    reset();
    s_source_generation = 1;
    {
        NetworkActivity stale(0);
        REQUIRE(!stale && !weather_fetch_active() && sdk::pauses == 0);
    }
    {
        NetworkActivity active(1);
        REQUIRE(active && weather_fetch_active() && sdk::pauses == 1);
        WeatherSourceChange denied(false, false);
        REQUIRE(!denied && sdk::ticks == 4000);
        REQUIRE(s_source_generation == 1 && weather_fetch_active());
    }
    REQUIRE(sdk::resumes == 1 && s_source_admission == SourceAdmission::Idle);
    s_status.has_value = true;
    REQUIRE(!invalidate_if_generation(0, false, false) && s_status.has_value);
}
// Capture the first real terminal wait. The harness then stops an endless task via an exception;
// production catches that synthetic stop once, and a second stop escapes its catch's final wait.
// Assertions use only the first captured status, before synthetic shutdown touched it.
WeatherForecastStatus task_iteration() {
    std::optional<WeatherForecastStatus> completed;
    sdk::on_notify = [&](TickType_t ticks) {
        allocation_witness::waiting(ticks);
        if (!completed) completed = weather_forecast_status();
        throw sdk::Stop{};
    };
    weather_forecast_start();
    REQUIRE(sdk::task_fn);
    try {
        sdk::task_fn(nullptr);
    } catch (const sdk::Stop&) {}
    sdk::on_notify = {};
    REQUIRE(completed && sdk::lock_depth == 0);
    return *completed;
}
void task_consent_generation() {
    reset();
    adapter::cfg.diagnostics_enabled = false;
    auto result                      = task_iteration();
    REQUIRE(!result.available && !result.has_value && result.reason == "diagnostics_disabled");
    REQUIRE(sdk::inits == 0);
    reset();
    sdk::body     = prepare();
    sdk::on_delay = [](TickType_t delay) {
        if (delay == 1100) adapter::cfg.diagnostics_enabled = false;
    };
    result = task_iteration();
    REQUIRE(!result.has_value && !result.available && sdk::inits == 0);
    REQUIRE(sdk::pauses == 1 && sdk::resumes == 1);
    reset();
    sdk::body       = prepare();
    sdk::on_cleanup = [] { adapter::cfg.diagnostics_enabled = false; };
    result          = task_iteration();
    REQUIRE(sdk::inits == 1 && !result.has_value && !result.available);
    REQUIRE(result.reason == "diagnostics_disabled");
}
// /values may enter during the lead; Weather must raise its TLS phase, drain that reader before any
// HTTP client exists, refuse new readers while TLS runs, lower the phase afterwards, and fail
// closed as http_busy without a client when a reader never leaves.
void task_values_reader_drain() {
    reset();
    sdk::body             = prepare();
    bool lead_reader      = false;
    bool drained_in_phase = false;
    bool refused_in_tls   = false;
    int  drain_steps      = 0;
    sdk::on_delay         = [&](TickType_t delay) {
        if (delay == 1100) {
            lead_reader = weather_values_reader_enter();
        } else if (delay == 20 && ++drain_steps == 3) {
            drained_in_phase = s_values_tls.tls_active() && sdk::inits == 0;
            weather_values_reader_leave();
        }
    };
    sdk::on_open = [&] {
        refused_in_tls = !weather_values_reader_enter() && s_values_tls.tls_active();
    };
    auto result = task_iteration();
    REQUIRE(lead_reader && drain_steps == 3 && drained_in_phase && refused_in_tls);
    REQUIRE(result.has_value && result.available && sdk::inits == 1);
    REQUIRE(!s_values_tls.tls_active() && s_values_tls.readers() == 0);
    REQUIRE(weather_values_reader_enter());
    weather_values_reader_leave();
    reset();
    sdk::body = prepare();
    weather_forecast_start();
    uint64_t token = 0;
    REQUIRE(weather_forecast_request_refresh(token) && token != 0);
    sdk::on_delay = [](TickType_t delay) {
        if (delay == 1100) REQUIRE(weather_values_reader_enter());
    };
    result = task_iteration();
    REQUIRE(!result.has_value && result.state == "waiting" && result.reason == "http_busy");
    REQUIRE(result.refresh_completed_token == token && result.refresh_success_token != token);
    REQUIRE(sdk::inits == 0 && sdk::pauses == 1 && sdk::resumes == 1);
    REQUIRE(!s_values_tls.tls_active() && s_values_tls.readers() == 1);
    weather_values_reader_leave();
}
void task_oom_start() {
    reset();
    sdk::task_fails = true;
    weather_forecast_start();
    REQUIRE(weather_forecast_status().reason == "task_start_failed" && !sdk::task_fn);
    reset();
    sdk::deadline_ready = false;
    weather_forecast_start();
    REQUIRE(weather_forecast_status().reason == "deadline_unavailable" && !sdk::task_fn);
    reset();
    sdk::body               = prepare();
    sdk::fail_request_alloc = true;
    const auto result       = task_iteration();
    REQUIRE(!result.available && result.error == "out_of_memory" && result.errors == 1);
    REQUIRE(sdk::inits == 0);
    REQUIRE(sdk::pauses == 1 && sdk::resumes == 1);
}
void task_success() {
    reset();
    sdk::body = prepare();
    weather_forecast_start();
    uint64_t token = 0;
    REQUIRE(weather_forecast_request_refresh(token));
    const auto result = task_iteration();
    REQUIRE(result.has_value && result.available && result.successes == 1);
    REQUIRE(result.outdoor_mean_2h_c == 13 && result.solar_energy_2h_wh_m2 == 300);
    REQUIRE(result.refresh_completed_token == token && result.refresh_success_token == token);
    REQUIRE(sdk::pauses == sdk::resumes && sdk::cleanups == 1 && sdk::json_deletes == 1);
}
void task_rejected_retains_sample() {
    for (int failure = 0; failure < 3; ++failure) {
        reset();
        sdk::body           = prepare();
        const auto accepted = task_iteration();
        REQUIRE(accepted.has_value && accepted.available && accepted.successes == 1);
        // Restore the captured real commit after the harness's synthetic task shutdown.
        s_status       = accepted;
        uint64_t token = 0;
        REQUIRE(weather_forecast_request_refresh(token));
        if (failure == 0) {
            sdk::body    = prepare();
            sdk::claimed = static_cast<int64_t>(sdk::body.size() + 1);
        } else if (failure == 1) {
            sdk::body = "{";
#ifndef WEATHER_REAL_CJSON
            sdk::json_parse_fails = true; // AST mode models the parser's rejection, not lexing.
#endif
        } else {
            Payload overflow;
            overflow.times[1] = std::ldexp(1.0, 63);
            sdk::body         = prepare(overflow);
        }
        adapter::unix_s   = NOW + 60;
        const auto failed = task_iteration();
        REQUIRE(failed.has_value && !failed.available && !failed.fetching);
        REQUIRE(failed.state == "error" && failed.reason == "fetch_failed");
        REQUIRE(failed.error == (failure == 0   ? "incomplete_payload"
                                 : failure == 1 ? "json_invalid"
                                                : "payload_shape_invalid"));
        REQUIRE(failed.successes == accepted.successes && failed.errors == accepted.errors + 1);
        REQUIRE(failed.latitude == accepted.latitude && failed.longitude == accepted.longitude);
        REQUIRE(failed.model == accepted.model && failed.issued_unix_s == accepted.issued_unix_s);
        REQUIRE(failed.fetched_unix_s == accepted.fetched_unix_s);
        REQUIRE(failed.decision_unix_s == accepted.decision_unix_s);
        REQUIRE(failed.outdoor_mean_2h_c == accepted.outdoor_mean_2h_c);
        REQUIRE(failed.solar_energy_2h_wh_m2 == accepted.solar_energy_2h_wh_m2);
        REQUIRE(failed.hourly_count == accepted.hourly_count);
        REQUIRE(failed.hourly_unix_s == accepted.hourly_unix_s);
        REQUIRE(failed.hourly_temperature_c == accepted.hourly_temperature_c);
        REQUIRE(failed.hourly_humidity_pct == accepted.hourly_humidity_pct);
        REQUIRE(failed.hourly_pressure_hpa == accepted.hourly_pressure_hpa);
        REQUIRE(failed.refresh_completed_token == token && failed.refresh_success_token != token);
        REQUIRE(s_source_generation == 0 && sdk::pauses == sdk::resumes);
    }
}
void source_aba() {
    reset();
    const Config source_a = adapter::cfg;
    sdk::body             = prepare();
    auto accepted         = task_iteration();
    REQUIRE(accepted.has_value && accepted.available);
    s_status                      = accepted;
    const uint32_t old_generation = s_source_generation;
    uint64_t       old_token      = 0;
    REQUIRE(weather_forecast_request_refresh(old_token));
    {
        SemGuard lock(s_mtx);
        REQUIRE(claim_refresh_request_locked() == old_token);
    }
    {
        WeatherSourceChange to_b(true, true);
        REQUIRE(to_b);
        adapter::cfg.weather_latitude_e6 += 1000000;
        to_b.commit();
    }
    REQUIRE(s_source_generation == old_generation + 1 && !s_status.has_value);
    REQUIRE(s_refresh_completed_token == old_token && s_refresh_success_token != old_token);
    {
        WeatherSourceChange to_a(true, true);
        REQUIRE(to_a);
        adapter::cfg = source_a;
        to_a.commit();
    }
    REQUIRE(s_source_generation == old_generation + 2 && !s_status.has_value);
    REQUIRE(adapter::cfg.weather_latitude_e6 == source_a.weather_latitude_e6);
    REQUIRE(adapter::cfg.weather_longitude_e6 == source_a.weather_longitude_e6);
    Payload replacement;
    replacement.temperature = {20, 22, 24, 26};
    sdk::body               = prepare(replacement);
    uint64_t current_token  = 0;
    REQUIRE(weather_forecast_request_refresh(current_token) && current_token > old_token);
    accepted = task_iteration();
    REQUIRE(accepted.has_value && accepted.available && accepted.outdoor_mean_2h_c == 23);
    REQUIRE(accepted.refresh_success_token == current_token);
    s_status = accepted;
    // Identical A coordinates cannot authorize the original A worker's late invalidation/result.
    REQUIRE(!invalidate_if_generation(old_generation, false, false));
    {
        NetworkActivity stale(old_generation);
        REQUIRE(!stale);
    }
    complete_refresh_request(old_token, true);
    const auto retained = weather_forecast_status();
    REQUIRE(retained.has_value && retained.available && retained.outdoor_mean_2h_c == 23);
    REQUIRE(retained.latitude == accepted.latitude && retained.longitude == accepted.longitude);
    REQUIRE(retained.fetched_unix_s == accepted.fetched_unix_s);
    REQUIRE(retained.refresh_completed_token == current_token);
    REQUIRE(retained.refresh_success_token == current_token);
    REQUIRE(s_source_generation == old_generation + 2);
}
void task_allocation_lifetimes() {
    for (int state = 0; state < 6; ++state) {
        reset();
        // These public topic/name values are synthetic and force real string-copy allocations.
        // Credentials remain empty; the Config projection must not copy any unrelated string.
        adapter::cfg.mqtt_base.assign(160, 'm');
        adapter::cfg.ref_temp_name.assign(96, 'n');
        adapter::cfg.ref_temp_topic.assign(192, 't');
        adapter::cfg.ref_temp_setpoint_topic.assign(192, 's');
        adapter::cfg.ref_temp_time_topic.assign(192, 'u');
        adapter::cfg.circulation_name.assign(96, 'c');
        adapter::cfg.circulation_topic.assign(192, 'p');
        sdk::body = prepare();
        if (state == 1) sdk::status = 503;
        if (state == 2) adapter::probe.largest_internal = 1;
        if (state == 3) adapter::cfg.diagnostics_enabled = false;
        if (state == 4) adapter::network_up = false;
        if (state == 5) adapter::ota_active = true;
        const auto completed = task_iteration();
        REQUIRE(!allocation_witness::overflow && allocation_witness::have_wait);
        REQUIRE(allocation_witness::config_copy_calls == 0 && adapter::config_reads == 0);
        REQUIRE(allocation_witness::config_allocations == 0);
        const auto wait = allocation_witness::at_wait;
        REQUIRE(wait.config_count == 0 && wait.config_bytes == 0);
        REQUIRE(wait.request_count == 0 && wait.request_bytes == 0);
        const TickType_t expected_wait = state == 0  ? 2700000
                                         : state < 3 ? 300000
                                         : state < 5 ? 60000
                                                     : 1000;
        REQUIRE(allocation_witness::wait_ticks == expected_wait);
        REQUIRE(allocation_witness::have_resume == (state < 3));
        if (allocation_witness::have_resume) {
            const auto resume = allocation_witness::at_resume;
            REQUIRE(resume.config_count == 0 && resume.config_bytes == 0);
            REQUIRE(resume.request_count == 0 && resume.request_bytes == 0);
        }
        REQUIRE(sdk::pauses == sdk::resumes);
        REQUIRE(completed.available == (state == 0));
    }
}
void real_lexer() {
#ifdef WEATHER_REAL_CJSON
    reset();
    WeatherForecastSample sample;
    std::string           error;
    for (const std::string& payload :
         {std::string{}, std::string("{"), std::string("[1,]"), std::string("{\"hourly\":{bad}}")})
        REQUIRE(!parse_forecast(payload, NOW, sample, error) && error == "json_invalid");
    std::string embedded = prepare();
    embedded.push_back('\0');
    embedded += "{}";
    REQUIRE(!parse_forecast(embedded, NOW, sample, error) && error == "json_invalid");
    const std::string prefix = prepare().substr(0, prepare().size() - 1) + ",\"extra\":\"";
    for (const std::string& suffix :
         {std::string("a") + '\0' + "b\"}", std::string(R"(a\u0000b"})"), std::string("a\nb\"}")})
        REQUIRE(!parse_forecast(prefix + suffix, NOW, sample, error) && error == "json_invalid");
    REQUIRE(parse_forecast(prefix + R"(a\\u0000b\n\t"})", NOW, sample, error));
    REQUIRE(parse_forecast(prefix + R"(a\u0041\u00Af"})", NOW, sample, error));
    REQUIRE(!parse_forecast(prefix + R"(a\u000"})", NOW, sample, error) && error == "json_invalid");
    for (const std::string_view escape : {"uZZZZ", "uZ000", "u0Z00", "u00Z0", "u000Z"}) {
        REQUIRE(
            !parse_forecast(prefix + "a\\" + std::string(escape) + "b\"}", NOW, sample, error) &&
            error == "json_invalid");
        REQUIRE(!parse_forecast(prepare().substr(0, prepare().size() - 1) + ",\"a\\" +
                                    std::string(escape) + "b\":1}",
                                NOW, sample, error) &&
                error == "json_invalid");
    }
    Payload overflow;
    overflow.times[1] = std::ldexp(1.0, 63);
    REQUIRE(!parse_forecast(prepare(overflow), NOW, sample, error) &&
            error == "payload_shape_invalid");
#else
    throw std::runtime_error("real_lexer requires --real-cjson with lock-resolved cJSON");
#endif
}
using Case         = std::pair<const char*, void (*)()>;
const Case cases[] = {{"epoch_bounds", epoch_bounds},
                      {"forecast_parse", forecast_parse},
                      {"json_guards", json_guards},
                      {"json_cleanup", json_cleanup},
                      {"transport_success", transport_success},
                      {"transport_completion", transport_completion},
                      {"transport_body_cap", transport_body_cap},
                      {"transport_chunk_boundaries", transport_chunk_boundaries},
                      {"transport_deadline", transport_deadline},
                      {"transport_failures", transport_failures},
                      {"transport_admission", transport_admission},
                      {"source_transaction", source_transaction},
                      {"source_admission_generation", source_admission_generation},
                      {"task_consent_generation", task_consent_generation},
                      {"task_values_reader_drain", task_values_reader_drain},
                      {"task_oom_start", task_oom_start},
                      {"task_success", task_success},
                      {"task_rejected_retains_sample", task_rejected_retains_sample},
                      {"source_aba", source_aba},
                      {"task_allocation_lifetimes", task_allocation_lifetimes}};
} // namespace test
int main(int argc, char** argv) {
    if (argc == 2 && std::string(argv[1]) == "real_lexer") {
        try {
            test::real_lexer();
            std::cout << "PASS real_lexer\n";
            return 0;
        } catch (const std::exception& e) {
            std::cerr << "FAIL real_lexer: " << e.what() << '\n';
            return 1;
        }
    }
    int count = 0;
    for (const auto& entry : test::cases) {
        if (argc == 2 && std::string(argv[1]) != entry.first) continue;
        try {
            entry.second();
            ++count;
            std::cout << "PASS " << entry.first << '\n';
        } catch (const std::exception& e) {
            std::cerr << "FAIL " << entry.first << ": " << e.what() << '\n';
            return 1;
        }
    }
    if (!count) return 2;
    std::cout << "allocation witness table_bytes=" << sizeof(allocation_witness::entries)
              << " config_projection_bytes=" << sizeof(daik::WeatherConfigSnapshot) << '\n';
    std::cout << "PASS total=" << count << '\n';
}
