// Complete production MQTT TU. SDK, scheduler, and unrelated service boundaries are host adapters.
#include "sdk.hpp"
#include "cJSON.h"
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <set>
#include <string>
namespace cleanup_witness {
bool early_ack = false;
int  enqueue(FakeMqtt*, const char*, const char*, int, int, int, bool);
} // namespace cleanup_witness
namespace cpp_witness {
// Arm only around a production preparation call. Long topics force each owned string to allocate.
int fail_after = -1, attempted = 0;
} // namespace cpp_witness
namespace json_witness {
int   parses = 0, deletes = 0, allocations = 0, frees = 0, live = 0;
bool  fail_next  = false;
int   fail_after = -1;
void* allocate(size_t size) {
    if (fail_next) {
        fail_next = false;
        return nullptr;
    }
    if (fail_after == 0) {
        fail_after = -1;
        return nullptr;
    }
    if (fail_after > 0) --fail_after;
    if (void* pointer = std::malloc(size)) {
        ++allocations;
        ++live;
        return pointer;
    }
    return nullptr;
}
void release(void* pointer) {
    if (pointer) {
        ++frees;
        --live;
        std::free(pointer);
    }
}
static cJSON* parse(const char* bytes, size_t length, const char** end, cJSON_bool terminate) {
    ++parses;
    return cJSON_ParseWithLengthOpts(bytes, length, end, terminate);
}
static void destroy(cJSON* root) {
    if (root) ++deletes;
    cJSON_Delete(root);
}
} // namespace json_witness
#define cJSON_ParseWithLengthOpts json_witness::parse
#define cJSON_Delete json_witness::destroy
#define esp_mqtt_client_enqueue cleanup_witness::enqueue
#ifndef MQTT_PRODUCTION_SOURCE
#error MQTT_PRODUCTION_SOURCE must identify the complete current production TU
#endif
#include MQTT_PRODUCTION_SOURCE
#undef esp_mqtt_client_enqueue

namespace cleanup_witness {
int enqueue(FakeMqtt* client, const char* topic, const char* bytes, int length, int qos,
            int retained, bool store) {
    const int id = esp_mqtt_client_enqueue(client, topic, bytes, length, qos, retained, store);
    if (early_ack && id >= 0) {
        esp_mqtt_event_t event{};
        event.msg_id = id;
        daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_PUBLISHED, &event);
    }
    return id;
}
} // namespace cleanup_witness

void* operator new(size_t size) {
    const bool staged_failure = cpp_witness::fail_after == 0;
    if (cpp_witness::fail_after >= 0) ++cpp_witness::attempted;
    if (cpp_witness::fail_after > 0) --cpp_witness::fail_after;
    if (staged_failure || sdk::fail_next_new || (sdk::fail_locked_new && sdk::locks > 0)) {
        cpp_witness::fail_after = -1;
        sdk::fail_locked_new = false;
        sdk::fail_next_new   = false;
        ++sdk::failed_news;
        sdk::allocation_fail_lock_depth = sdk::locks;
        throw std::bad_alloc();
    }
    if (void* pointer = std::malloc(size ? size : 1)) return pointer;
    throw std::bad_alloc();
}
void  operator delete(void* p) noexcept { std::free(p); }
void  operator delete(void* p, size_t) noexcept { std::free(p); }
void* operator new[](size_t size) { return ::operator new(size); }
void  operator delete[](void* p) noexcept { std::free(p); }
void  operator delete[](void* p, size_t) noexcept { std::free(p); }

namespace adapter {
daik::Config cfg;
int          config_locks = 0, skipped_logs = 0, retirement_logs = 0;
int64_t                                                            clock_shift_s = 0;
char         last_skip[256]{};
daik::HpStats               hp;
daik::WifiInfo              wifi{};
daik::ModbusStatus          modbus;
bool                           modbus_enabled = false, modbus_live = false;
uint32_t                       modbus_generation = 0, x10a_generation = 0;
std::vector<daik::CachedValue> modbus_values;
daik::Env3Status               env;
std::string                    x10a_payload;
daik::WeatherForecastStatus weather;
daik::CrashInfo             boot, live_crash;
daik::EthInfo               ethernet;
daik::NetLink               link            = daik::NetLink::None;
uint32_t                    wifi_reconnects = 0, poll_skips = 0;
std::array<uint32_t, static_cast<size_t>(daik::StackWatch::COUNT)> stack_minima = [] {
    std::array<uint32_t, static_cast<size_t>(daik::StackWatch::COUNT)> minima{};
    minima.fill(4096);
    return minima;
}();
} // namespace adapter
namespace retirement_witness {
daik::MqttRetirementRecord    durable;
daik::MqttRetirementStoreLoad result     = daik::MqttRetirementStoreLoad::Missing;
int                           load_calls = 0, save_calls = 0, save_failures = 0;
int                           expected_ack_count = 0, observed_ack_count = 0;
bool                          write_through_failure = false, reject_new_after_save = false;
bool                          save_before_retirement = false;
} // namespace retirement_witness
namespace daik {
MqttRetirementStoreLoad mqtt_retirement_store_load(MqttRetirementRecord& out) noexcept {
    ++retirement_witness::load_calls;
    if (retirement_witness::result == MqttRetirementStoreLoad::Ready)
        out = retirement_witness::durable;
    return retirement_witness::result;
}
bool mqtt_retirement_store_save(const MqttRetirementRecord& record) noexcept {
    ++retirement_witness::save_calls;
    retirement_witness::save_before_retirement |=
        retirement_witness::observed_ack_count < retirement_witness::expected_ack_count;
    const bool accepted = retirement_witness::save_failures == 0;
    if (!accepted) --retirement_witness::save_failures;
    if (accepted || retirement_witness::write_through_failure) {
        retirement_witness::durable = record;
        retirement_witness::result  = MqttRetirementStoreLoad::Ready;
    }
    if (accepted && retirement_witness::reject_new_after_save) {
        retirement_witness::reject_new_after_save = false;
        sdk::fail_next_new                        = true;
    }
    return accepted;
}
Config      config() { return adapter::cfg; }
std::string config_profile() { return adapter::cfg.profile; }
Protocol    config_x10a_protocol() { return adapter::cfg.proto; }
namespace detail {
void          config_lock() { ++adapter::config_locks; }
void          config_unlock() { --adapter::config_locks; }
const Config& config_ref_locked() { return adapter::cfg; }
} // namespace detail
bool ota_download_active() { return false; }
bool weather_fetch_active() { return false; }
void diag_printf(const char* format, ...) {
    // Production contract: diag_printf is bounded/no-throw and does not allocate.
    char    line[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(line, sizeof(line), format, args);
    va_end(args);
    if (std::strstr(line, "publish skipped")) {
        ++adapter::skipped_logs;
        std::snprintf(adapter::last_skip, sizeof(adapter::last_skip), "%.*s",
                      static_cast<int>(sizeof(adapter::last_skip) - 1), line);
    }
    if (std::strstr(line, "retirement metadata")) ++adapter::retirement_logs;
}
void stack_watch_sample(StackWatch slot) noexcept {
    if (slot == StackWatch::Mqtt) ++sdk::samples;
    if (slot == StackWatch::SdkMqtt) ++sdk::sdk_task_samples;
}
uint32_t stack_watch_min_free_bytes(StackWatch slot) noexcept {
    return adapter::stack_minima[static_cast<size_t>(slot)];
}
size_t            heap_largest_internal_block() { return 40000; }
uint8_t           heap_guard_restarts() { return 0; }
HpStats           hp_stats() { return adapter::hp; }
HpMqttSourceState hp_mqtt_source_state() {
    const bool recent = mqtt_x10a_available(adapter::hp.connected, adapter::hp.last_ok_s);
    return {adapter::hp.connected && recent, recent};
}
uint32_t        hp_cache_generation() { return adapter::x10a_generation; }
uint32_t        hp_skipped_cycles() { return adapter::poll_skips; }
HpX10aJsonProbe hp_values_x10a_json_probe(const char*, uint64_t) {
    if (!hp_mqtt_source_state().connected || adapter::x10a_payload.empty()) return {};
    return {true, adapter::x10a_payload.size(), adapter::x10a_generation + 1,
            adapter::x10a_generation};
}
HpX10aJsonCopyResult hp_values_x10a_json_copy(std::string& out, size_t, uint64_t, uint32_t,
                                              const char*, uint64_t) {
    if (!hp_mqtt_source_state().connected || adapter::x10a_payload.empty())
        return HpX10aJsonCopyResult::SourceMismatch;
    out = adapter::x10a_payload;
    return HpX10aJsonCopyResult::Ok;
}
bool         mb_target_enabled() noexcept { return adapter::modbus_enabled; }
ModbusStatus mb_status() { return adapter::modbus; }
size_t       mb_values_capacity() { return adapter::modbus_values.size(); }
size_t       mb_values_snapshot(CachedValue* out, size_t capacity, bool& live) {
    live               = adapter::modbus_live;
    const size_t count = std::min(capacity, adapter::modbus_values.size());
    for (size_t i = 0; i < count; ++i) out[i] = adapter::modbus_values[i];
    return count;
}
bool                  mb_values_live() { return adapter::modbus_live; }
uint32_t              mb_cache_generation() { return adapter::modbus_generation; }
Env3Status            env3_status() { return adapter::env; }
WeatherForecastStatus weather_forecast_status() { return adapter::weather; }
void                  history_record_circulation() {}
void                  history_circulation_reset() {}
void                  checkup_dhw_reset() {}
CrashInfo             diag_crash_info() { return adapter::boot; }
CrashInfo             diag_crash_info_live() { return adapter::live_crash; }
WifiInfo              wifi_info() { return adapter::wifi; }
uint32_t              wifi_reconnect_count() { return adapter::wifi_reconnects; }
EthInfo               net_eth_info() { return adapter::ethernet; }
NetLink               net_kind() { return adapter::link; }
void                  time_now(int64_t& unix_s, int32_t& ms) {
    unix_s = 1700000000 + sdk::ticks / 1000 + adapter::clock_shift_s;
    ms     = sdk::ticks % 1000;
}
} // namespace daik

struct StopTask {};
int  checks = 0;
void require(bool condition, const char* assertion) {
    ++checks;
    if (!condition) {
        std::fprintf(stderr, "ASSERTION %s FAILED\n", assertion);
        std::exit(2);
    }
}
void feed(const char* topic, const char* payload, bool retained = false) {
    esp_mqtt_event_t e{};
    e.topic          = const_cast<char*>(topic);
    e.topic_len      = static_cast<int>(std::strlen(topic));
    e.data           = const_cast<char*>(payload);
    e.data_len       = static_cast<int>(std::strlen(payload));
    e.total_data_len = e.data_len;
    e.retain         = retained;
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DATA, &e);
}
void initial_config(const char* base = nullptr) {
    adapter::cfg.mqtt_uri = "mqtt://host-witness";
    if (base)
        adapter::cfg.mqtt_base = base;
    else
        adapter::cfg.mqtt_base.assign(80, 'm'); // ordinary Config copy must allocate
    adapter::cfg.profile                        = "auto";
    adapter::cfg.diagnostics_enabled            = true;
    adapter::cfg.ref_temp_topic                 = "room";
    adapter::cfg.ref_temp_path                  = "temperature";
    adapter::cfg.ref_temp_time_path             = "time";
    adapter::cfg.ref_temp_enabled_path          = "enabled";
    adapter::cfg.ref_temp_fixed_setpoint_tenths = 220;
    adapter::cfg.ref_temp_max_age_s             = 600;
    adapter::cfg.circulation_name               = "DHW circulation";
    adapter::cfg.circulation_topic              = "circulation";
    adapter::cfg.circulation_power_path         = "power";
    adapter::cfg.circulation_time_path          = "time";
    adapter::cfg.circulation_max_age_s          = 600;
    adapter::cfg.circulation_confirm_s          = 1;
    daik::mqtt_ha_start();
    require(sdk::task_fn != nullptr, "MQTT_TASK_CREATED");
}
void check_cycle(TickType_t delay) {
    require(delay == 1000, "MQTT_NORMAL_ONE_SECOND_DELAY");
    require(daik::mqtt_publish_network_quiesced(), "MQTT_ACTIVITY_RELEASED_AT_DELAY");
    require(sdk::locks == 0 && !sdk::mutex.held, "MQTT_MUTEX_RELEASED_AT_DELAY");
    require(sdk::takes == sdk::gives, "MQTT_LOCK_OWNERSHIP_BALANCED");
    require(adapter::config_locks == 0, "CONFIG_LOCK_OWNERSHIP_BALANCED");
}
void startup_failure_recovery() {
    initial_config();
    sdk::start_failures = 2;
    sdk::on_delay       = [](TickType_t delay) {
        require(delay == 1000 && sdk::locks == 0 && !sdk::mutex.held && sdk::takes == sdk::gives &&
                          adapter::config_locks == 0,
                      "START_FAILURE_WAIT_RELEASES_LOCKS_AND_DELAYS_NORMALLY");
        require(sdk::destroy_calls == 0, "START_FAILURE_PRESERVES_REUSABLE_CLIENT");
        require(sdk::start_calls <= sdk::delays + 1, "START_FAILURE_RETRY_IS_RATE_BOUNDED");
        if (sdk::delays == 1)
            require(sdk::start_calls == 1, "INITIAL_START_FAILURE_DELAYS_FIRST_RETRY");
        if (sdk::delays == 3)
            require(sdk::start_calls == 2, "START_FAILURE_BACKOFF_RETAINS_WAIT_CYCLE");
        if (sdk::delays == 4) {
            check_cycle(delay);
            require(sdk::start_calls == 3 && daik::s_client_running.load() &&
                              daik::mqtt_status().connected,
                          "START_FAILURE_RECOVERS_WITHOUT_REBOOT");
            require(daik::s_ref_status.subscribed && daik::s_circulation_status.subscribed,
                          "START_FAILURE_RECOVERY_SERVICES_INBOUND_WITHOUT_X10A");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {
    } catch (const std::runtime_error&) {
        require(false, "START_FAILURE_KEEPS_PUBLISH_TASK_ALIVE");
    }
}

void event_registration_failure() {
    adapter::cfg.mqtt_uri    = "mqtt://host-witness";
    sdk::registration_result = ESP_FAIL;
    daik::mqtt_ha_start();
    require(!sdk::task_fn && !daik::s_client && sdk::start_calls == 0,
            "REGISTRATION_FAILURE_CANNOT_START_UNOBSERVED_CLIENT");
    require(sdk::destroy_calls == 1 && sdk::locks == 0,
            "REGISTRATION_FAILURE_RELEASES_INITIALIZED_CLIENT");
    require(daik::mqtt_status().error == "event registration failed",
            "REGISTRATION_FAILURE_REPORTS_ITS_ACTUAL_CAUSE");
}

void ref_oom_recovery() {
    initial_config();
    feed("room", R"({"temperature":20,"time":1700000100})");
    feed("circulation", R"({"power":50,"time":1700000100})");
    sdk::on_delay = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 1) {
            require(daik::s_ref_status.has_value && daik::s_ref_status.has_source_time,
                    "REFERENCE_BASELINE_PRESENT");
            require(daik::s_ref_status.temperature_c == 20 &&
                        daik::s_ref_status.source_unix_s == 1700000100,
                    "REFERENCE_BASELINE_RAW_EVIDENCE");
            require(daik::s_ref_status.eligibility_error.size() > 32,
                    "REFERENCE_ALLOCATING_SNAPSHOT_SEEDED");
            require(daik::s_circulation_status.has_value &&
                        daik::s_circulation_status.source_unix_s == 1700000100,
                    "CIRCULATION_BASELINE_PRESENT");
            feed("room", R"({"temperature":99,"time":1700000101,"enabled":true})");
            sdk::fail_locked_new = true;
        } else if (sdk::delays == 2) {
            require(sdk::failed_news == 1 && sdk::allocation_fail_lock_depth == 1,
                    "REAL_CPP_ALLOCATION_FAILED_UNDER_STATUS_LOCK");
            require(daik::mqtt_skip_stats().skipped == 1, "OOM_COUNTED_ONCE");
            require(adapter::skipped_logs == 1 && std::strstr(adapter::last_skip, "subscriptions"),
                    "OOM_REPORTED_AT_SOURCE_STAGE");
            require(daik::s_ref_status.temperature_c == 20 &&
                        daik::s_ref_status.source_unix_s == 1700000100 &&
                        daik::s_ref_status.has_value && daik::s_ref_status.has_source_time &&
                        daik::s_ref_status.messages == 1,
                    "OOM_PRESERVES_LAST_GOOD_REFERENCE_STATE");
            require(!daik::s_ref_source_time.allows(1700000099),
                    "OOM_PRESERVES_REFERENCE_TIME_WATERMARK");
            require(daik::s_circulation_status.power_w == 50 &&
                        daik::s_circulation_status.source_unix_s == 1700000100,
                    "OOM_PRESERVES_OTHER_SOURCE_STATE");
            feed("room", R"({"temperature":21,"time":1700000102,"enabled":true})");
            feed("circulation", R"({"power":55,"time":1700000102})");
        } else if (sdk::delays == 3) {
            require(daik::s_ref_status.temperature_c == 21 &&
                        daik::s_ref_status.source_unix_s == 1700000102 &&
                        daik::s_ref_status.messages == 2 &&
                        daik::s_ref_status.eligibility_error.empty(),
                    "REFERENCE_RECOVERS_ON_NEXT_SUCCESSFUL_ITERATION");
            require(daik::s_circulation_status.power_w == 55 &&
                        daik::s_circulation_status.source_unix_s == 1700000102,
                    "CIRCULATION_RECOVERS_ON_NEXT_SUCCESSFUL_ITERATION");
            require(daik::mqtt_skip_stats().skipped == 1 && sdk::resets >= 3 && sdk::samples == 3,
                    "RECOVERY_RETAINS_COUNT_AND_FEEDS_WATCHDOG");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void circulation_oom_recovery() {
    initial_config();
    feed("room", R"({"temperature":20,"time":1700000100,"enabled":true})");
    feed("circulation", R"({"power":50,"time":1700000100})");
    sdk::ticks += 1000;
    feed("circulation", R"({"power":50,"time":1700000101})");
    feed("circulation", R"({"power":"invalid","time":1700000101})");
    sdk::on_delay = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 1) {
            require(daik::s_circulation_status.has_value &&
                        daik::s_circulation_status.has_source_time &&
                        daik::s_circulation_status.power_w == 50 &&
                        daik::s_circulation_status.source_unix_s == 1700000101 &&
                        daik::s_circulation_status.error.size() > 32,
                    "CIRCULATION_ALLOCATING_SNAPSHOT_SEEDED");
            require(daik::s_circulation_status.state == daik::CirculationPowerState::On &&
                        daik::s_circulation_tracker.confirmed == daik::CirculationPowerState::On,
                    "CIRCULATION_CONFIRMED_ON_BASELINE_SEEDED");
            feed("circulation", R"({"power":99,"time":1700000102})");
            sdk::fail_locked_new = true;
        } else if (sdk::delays == 2) {
            require(sdk::failed_news == 1 && sdk::allocation_fail_lock_depth == 1,
                    "REAL_CPP_ALLOCATION_FAILED_UNDER_STATUS_LOCK");
            require(daik::mqtt_skip_stats().skipped == 1, "OOM_COUNTED_ONCE");
            require(daik::s_circulation_status.has_value &&
                        daik::s_circulation_status.has_source_time &&
                        daik::s_circulation_status.power_w == 50 &&
                        daik::s_circulation_status.source_unix_s == 1700000101 &&
                        daik::s_circulation_status.messages == 3 &&
                        daik::s_circulation_status.errors == 1,
                    "OOM_PRESERVES_LAST_GOOD_CIRCULATION_STATE");
            require(daik::s_circulation_status.state == daik::CirculationPowerState::On &&
                        daik::s_circulation_tracker.confirmed == daik::CirculationPowerState::On,
                    "OOM_PRESERVES_CIRCULATION_CONFIRMED_STATE_AND_TRACKER");
            require(!daik::s_circulation_source_time.allows(1700000100),
                    "OOM_PRESERVES_CIRCULATION_TIME_WATERMARK");
            require(daik::s_ref_status.temperature_c == 20 &&
                        daik::s_ref_status.source_unix_s == 1700000100,
                    "OOM_PRESERVES_OTHER_SOURCE_STATE");
            feed("circulation", R"({"power":55,"time":1700000103})");
        } else if (sdk::delays == 3) {
            require(daik::s_circulation_status.power_w == 55 &&
                        daik::s_circulation_status.source_unix_s == 1700000103 &&
                        daik::s_circulation_status.messages == 4 &&
                        daik::s_circulation_status.error.empty(),
                    "CIRCULATION_RECOVERS_ON_NEXT_SUCCESSFUL_ITERATION");
            require(daik::mqtt_skip_stats().skipped == 1 && sdk::resets >= 3 && sdk::samples == 3,
                    "RECOVERY_RETAINS_COUNT_AND_FEEDS_WATCHDOG");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void failure_episodes() {
    initial_config();
    feed("room", R"({"temperature":20,"time":1700000100})");
    sdk::on_delay = [](TickType_t delay) {
        check_cycle(delay);
        switch (sdk::delays) {
        case 1:
            require(daik::s_ref_status.has_value &&
                        daik::s_ref_status.eligibility_error.size() > 32,
                    "EPISODE_ALLOCATING_LAST_GOOD_STATE_SEEDED");
            feed("room", R"({"temperature":90,"time":1700000101})");
            sdk::fail_locked_new = true;
            break;
        case 2:
            require(sdk::failed_news == 1 && daik::mqtt_skip_stats().skipped == 1 &&
                        adapter::skipped_logs == 1,
                    "FIRST_FAILURE_COUNTS_AND_LOGS_EPISODE");
            require(daik::s_ref_status.temperature_c == 20 &&
                        daik::s_ref_status.source_unix_s == 1700000100,
                    "FIRST_FAILURE_PRESERVES_LAST_GOOD_STATE");
            feed("room", R"({"temperature":91,"time":1700000102})");
            sdk::fail_locked_new = true;
            break;
        case 3:
            require(sdk::failed_news == 2 && daik::mqtt_skip_stats().skipped == 2,
                    "CONSECUTIVE_FAILURES_COUNT_EACH_SKIPPED_CYCLE");
            require(adapter::skipped_logs == 1, "CONSECUTIVE_FAILURES_LOG_ONCE_PER_EPISODE");
            require(daik::s_ref_status.temperature_c == 20 &&
                        daik::s_ref_status.source_unix_s == 1700000100,
                    "CONSECUTIVE_FAILURES_PRESERVE_LAST_GOOD_STATE");
            feed("room", R"({"temperature":21,"time":1700000103})");
            break;
        case 4:
            require(daik::s_ref_status.temperature_c == 21 &&
                        daik::s_ref_status.source_unix_s == 1700000103,
                    "SUCCESSFUL_ITERATION_RECOVERS_AND_REARMS_EPISODE");
            feed("room", R"({"temperature":92,"time":1700000104})");
            sdk::fail_locked_new = true;
            break;
        case 5:
            require(sdk::failed_news == 3 && daik::mqtt_skip_stats().skipped == 3 &&
                        adapter::skipped_logs == 2,
                    "NEW_FAILURE_EPISODE_LOGS_AGAIN_AFTER_RECOVERY");
            require(daik::s_ref_status.temperature_c == 21 &&
                        daik::s_ref_status.source_unix_s == 1700000103,
                    "NEW_FAILURE_EPISODE_PRESERVES_LAST_GOOD_STATE");
            feed("room", R"({"temperature":22,"time":1700000105,"enabled":true})");
            break;
        case 6:
            require(daik::s_ref_status.temperature_c == 22 &&
                        daik::s_ref_status.source_unix_s == 1700000105 &&
                        daik::s_ref_status.eligibility_error.empty(),
                    "SECOND_EPISODE_RECOVERS_ON_SUCCESSFUL_ITERATION");
            require(daik::mqtt_skip_stats().skipped == 3 && adapter::skipped_logs == 2 &&
                        sdk::samples == 6,
                    "EPISODES_RETAIN_ALL_COUNTS_AND_SAMPLE_EVERY_ITERATION");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void reconfigure_config_oom() {
    initial_config();
    feed("room", R"({"temperature":20,"time":1700000100,"enabled":true})");
    feed("circulation", R"({"power":50,"time":1700000100})");
    sdk::on_delay = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 1) {
            require(daik::reference_temperature_status(adapter::cfg).has_value,
                    "REFERENCE_BASELINE_PRESENT");
            require(daik::circulation_source_status(adapter::cfg).has_value,
                    "CIRCULATION_BASELINE_PRESENT");
            daik::mqtt_reference_reconfigure();
            daik::mqtt_circulation_reconfigure(true);
            require(!daik::reference_temperature_status(adapter::cfg).has_value &&
                        !daik::circulation_source_status(adapter::cfg).has_value,
                    "RECONFIGURATION_WITHDRAWS_BEFORE_NEXT_TASK_ITERATION");
            sdk::fail_next_new = true;
        } else if (sdk::delays == 2) {
            require(sdk::failed_news == 1 && sdk::allocation_fail_lock_depth == 0,
                    "REAL_CPP_CONFIG_ALLOCATION_FAILED");
            require(daik::mqtt_skip_stats().skipped == 1 &&
                        std::strstr(adapter::last_skip, "config"),
                    "CONFIG_OOM_COUNTED_AND_REPORTED");
            require(!daik::reference_temperature_status(adapter::cfg).has_value &&
                        !daik::circulation_source_status(adapter::cfg).has_value,
                    "CONFIG_OOM_DOES_NOT_REPUBLISH_WITHDRAWN_SOURCE_STATE");
            require(!daik::s_ref_source_time.allows(1700000099) &&
                        !daik::s_circulation_source_time.allows(1700000099),
                    "CONFIG_OOM_PRESERVES_BOTH_SOURCE_TIME_WATERMARKS");
            feed("room", R"({"temperature":21,"time":1700000102,"enabled":true})");
            feed("circulation", R"({"power":55,"time":1700000102})");
        } else if (sdk::delays == 3) {
            require(daik::reference_temperature_status(adapter::cfg).temperature_c == 21 &&
                        daik::reference_temperature_status(adapter::cfg).source_unix_s ==
                            1700000102,
                    "REFERENCE_RECONFIGURATION_RECOVERS_ON_SUCCESS");
            require(daik::circulation_source_status(adapter::cfg).power_w == 55 &&
                        daik::circulation_source_status(adapter::cfg).source_unix_s == 1700000102,
                    "CIRCULATION_RECONFIGURATION_RECOVERS_ON_SUCCESS");
            require(daik::mqtt_skip_stats().skipped == 1, "RECOVERY_DOES_NOT_INVENT_NEW_OOM");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void circulation_probe_postsubscribe_oom() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string synthetic_topic = "mem02-public-probe/" + std::string(120, 'p');
    {
        daik::Lock lk(daik::s_mtx);
        daik::s_circulation_probe.config.topic          = synthetic_topic;
        daik::s_circulation_probe.config.power_path     = "power";
        daik::s_circulation_probe.config.timestamp_path = "time";
        daik::s_circulation_probe.config.max_age_s      = 600;
        daik::s_circulation_probe.config.on_tenths_w    = 100;
        daik::s_circulation_probe.config.off_tenths_w   = 50;
        daik::s_circulation_probe.config.confirm_s      = 1;
        daik::s_circulation_probe.generation            = 42;
        daik::s_circulation_probe.active                = true;
        daik::s_circulation_probe.subscribed            = false;
    }
    std::string fresh_owner;
    daik::s_circulation_probe_subscribed_topic.swap(fresh_owner);
    daik::s_circulation_probe_task_generation = 0;
    require(daik::s_circulation_probe_subscribed_topic.empty() &&
                daik::s_circulation_probe_subscribed_topic.capacity() < synthetic_topic.size(),
            "CIRCULATION_PROBE_NO_PRIOR_OWNER_CAPACITY");
    const int before_subscribes     = sdk::subscribe_calls;
    sdk::reject_new_after_subscribe = true;
    bool threw                      = false;
    try {
        daik::service_circulation_probe_subscription(adapter::cfg);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    const bool allocation_refusal_still_armed = sdk::fail_next_new;
    sdk::fail_next_new                        = false;
    require(sdk::subscribe_calls == before_subscribes + 1 &&
                std::strcmp(sdk::last_subscribed_topic, synthetic_topic.c_str()) == 0,
            "CIRCULATION_PROBE_SUBSCRIBE_SUCCEEDED_FOR_EXACT_CANDIDATE");
    // Check the owner first: restoring the allocating assignment must fail this ownership oracle,
    // after the SDK side effect, without an uncaught exception or a compile failure.
    require(daik::s_circulation_probe_subscribed_topic == synthetic_topic &&
                daik::s_circulation_probe_task_generation == 42,
            "CIRCULATION_PROBE_SUBSCRIPTION_CLEANUP_OWNERSHIP");
    require(!threw && sdk::failed_news == 0 && allocation_refusal_still_armed,
            "CIRCULATION_PROBE_POSTSUBSCRIBE_COMMIT_DOES_NOT_ALLOCATE");
    require(daik::s_circulation_probe.subscribed && daik::s_circulation_probe.active,
            "CIRCULATION_PROBE_SUBSCRIBE_STATUS_RECORDED");
    require(sdk::locks == 0 && !sdk::mutex.held && sdk::takes == sdk::gives,
            "CIRCULATION_PROBE_POSTSUBSCRIBE_LOCKS_RELEASED");
    daik::s_circulation_probe.active = false;
    const int before_unsubscribes    = sdk::unsubscribe_calls;
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(sdk::unsubscribe_calls == before_unsubscribes + 1 &&
                std::strcmp(sdk::last_unsubscribed_topic, synthetic_topic.c_str()) == 0,
            "CIRCULATION_PROBE_INACTIVE_CLEANUP_UNSUBSCRIBES_EXACT_CANDIDATE_ONCE");
    require(daik::s_circulation_probe_subscribed_topic.empty() &&
                daik::s_circulation_probe_task_generation == 0,
            "CIRCULATION_PROBE_INACTIVE_CLEANUP_RELEASES_OWNERSHIP");
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(sdk::unsubscribe_calls == before_unsubscribes + 1,
            "CIRCULATION_PROBE_CLEANUP_DOES_NOT_REPEAT_UNSUBSCRIBE");
    require(sdk::locks == 0 && !sdk::mutex.held && sdk::takes == sdk::gives,
            "CIRCULATION_PROBE_CLEANUP_LOCKS_RELEASED");
}
void circulation_saved_postsubscribe_oom() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-saved-circulation/" + std::string(100, 'c');
    adapter::cfg.circulation_topic = topic;
    std::string fresh_owner;
    daik::s_circulation_subscribed_topic.swap(fresh_owner);
    require(daik::s_circulation_subscribed_topic.capacity() < topic.size(),
            "SAVED_CIRCULATION_NO_PRIOR_OWNER_CAPACITY");
    const uint32_t epoch            = daik::s_circulation_requested_epoch.load();
    sdk::reject_new_after_subscribe = true;
    bool threw                      = false;
    try {
        daik::service_circulation_subscription(adapter::cfg, epoch);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    const bool refusal_still_armed = sdk::fail_next_new;
    sdk::fail_next_new             = false;
    require(sdk::subscribe_calls == 1 &&
                std::strcmp(sdk::last_subscribed_topic, topic.c_str()) == 0,
            "SAVED_CIRCULATION_SDK_ACCEPTED_EXACT_TOPIC");
    require(daik::s_circulation_subscribed_topic == topic,
            "SAVED_CIRCULATION_SUBSCRIPTION_CLEANUP_OWNERSHIP");
    require(!threw && sdk::failed_news == 0 && refusal_still_armed,
            "SAVED_CIRCULATION_POSTSUBSCRIBE_COMMIT_DOES_NOT_ALLOCATE");
    require(daik::s_circulation_status.subscribed, "SAVED_CIRCULATION_SUBSCRIBE_STATUS_RECORDED");
    require(sdk::locks == 0 && !sdk::mutex.held && sdk::takes == sdk::gives,
            "SAVED_CIRCULATION_POSTSUBSCRIBE_LOCKS_RELEASED");
    adapter::cfg.circulation_topic.clear();
    daik::mqtt_circulation_reconfigure(true);
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_calls == 1 &&
                std::strcmp(sdk::last_unsubscribed_topic, topic.c_str()) == 0,
            "SAVED_CIRCULATION_DISABLED_CLEANUP_UNSUBSCRIBES_EXACT_TOPIC_ONCE");
    require(daik::s_circulation_subscribed_topic.empty() && !daik::s_circulation_status.subscribed,
            "SAVED_CIRCULATION_DISABLED_CLEANUP_RELEASES_OWNERSHIP");
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_calls == 1, "SAVED_CIRCULATION_CLEANUP_DOES_NOT_REPEAT_UNSUBSCRIBE");
}
void subscription_locks_released() {
    require(sdk::locks == 0 && !sdk::mutex.held && sdk::takes == sdk::gives &&
                adapter::config_locks == 0,
            "SAVED_SUBSCRIPTION_LOCK_OWNERSHIP_BALANCED");
}
void clean_broker_reconnect() {
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DISCONNECTED, nullptr);
    // Model a clean session: the broker has lost its subscriptions, while production cleanup
    // owners still identify the previously accepted topics on this same client handle.
    for (auto& topic : sdk::live_topics) topic.fill('\0');
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
}
void circulation_saved_reconnect_oom() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-reconnect-circulation/" + std::string(80, 'c');
    adapter::cfg.circulation_topic = topic;
    const uint32_t epoch           = daik::s_circulation_requested_epoch.load();
    daik::service_circulation_subscription(adapter::cfg, epoch);
    require(daik::s_circulation_subscribed_topic == topic && sdk::topic_live(topic.c_str()) &&
                daik::s_circulation_status.subscribed && !daik::s_circulation_subscription_retry,
            "CIRCULATION_RECONNECT_OOM_ACCEPTED_UNCHANGED_OWNER_BASELINE");
    clean_broker_reconnect();
    const int before        = sdk::subscribe_calls;
    cpp_witness::attempted  = 0;
    cpp_witness::fail_after = 0; // prepared_owner, after the reconnect force is consumed
    bool threw              = false;
    try {
        daik::service_circulation_subscription(adapter::cfg, epoch);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    cpp_witness::fail_after = -1;
    require(threw && cpp_witness::attempted == 1 && sdk::failed_news == 1 &&
                sdk::allocation_fail_lock_depth == 0,
            "CIRCULATION_RECONNECT_OWNER_PREPARATION_REAL_BAD_ALLOC");
    require(sdk::subscribe_calls == before && !sdk::topic_live(topic.c_str()) &&
                daik::s_circulation_subscribed_topic == topic &&
                !daik::s_circulation_status.subscribed && !daik::s_circulation_reconfigure,
            "CIRCULATION_RECONNECT_OOM_RETAINS_OWNER_WITHOUT_BROKER_EFFECT");
    const bool retry_pending = daik::s_circulation_subscription_retry;
    subscription_locks_released();
    daik::service_circulation_subscription(adapter::cfg, epoch);
    require(sdk::subscribe_calls == before + 1 && sdk::topic_live(topic.c_str()) &&
                daik::s_circulation_subscribed_topic == topic &&
                daik::s_circulation_status.subscribed,
            "CIRCULATION_RECONNECT_OOM_NEXT_CYCLE_RESUBSCRIBES_TOPIC");
    require(retry_pending && !daik::s_circulation_subscription_retry,
            "CIRCULATION_RECONNECT_RETRY_SURVIVES_OOM_AND_CLEARS_AFTER_ACCEPTANCE");
    feed(topic.c_str(), R"({"power":58,"time":1700000100})");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_circulation_status.has_value && daik::s_circulation_status.power_w == 58 &&
                daik::s_circulation_status.source_unix_s == 1700000100,
            "CIRCULATION_RECONNECT_ACCEPTED_SUBSCRIPTION_RECEIVES_CURRENT_WIRE_VALUE");
    subscription_locks_released();
}
void circulation_saved_epoch_change() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-epoch-circulation/" + std::string(90, 'e');
    adapter::cfg.circulation_topic = topic;
    const uint32_t epoch           = daik::s_circulation_requested_epoch.load();
    sdk::on_subscribe              = [](const char*, int id) {
        require(id >= 0, "CIRCULATION_EPOCH_CONTROL_ACCEPTED_BY_SDK");
        daik::mqtt_circulation_reconfigure(true);
    };
    daik::service_circulation_subscription(adapter::cfg, epoch);
    sdk::on_subscribe = {};
    require(daik::s_circulation_requested_epoch.load() != epoch && sdk::topic_live(topic.c_str()),
            "CIRCULATION_EPOCH_CHANGED_AFTER_SDK_SIDE_EFFECT");
    require(daik::s_circulation_subscribed_topic == topic,
            "CIRCULATION_EPOCH_CHANGE_RETAINS_ACCEPTED_CLEANUP_OWNER");
    require(!daik::s_circulation_status.subscribed,
            "CIRCULATION_OLD_EPOCH_DOES_NOT_CLAIM_CURRENT_SUBSCRIPTION");
    subscription_locks_released();
    adapter::cfg.circulation_topic.clear();
    daik::mqtt_circulation_reconfigure(true);
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(topic.c_str()) == 1 && !sdk::topic_live(topic.c_str()),
            "CIRCULATION_EPOCH_CHANGE_LATER_CLEANUP_UNSUBSCRIBES_ONCE");
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(topic.c_str()) == 1,
            "CIRCULATION_EPOCH_CHANGE_CLEANUP_DOES_NOT_REPEAT");
    subscription_locks_released();
}
void circulation_saved_retry() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-retry-circulation/" + std::string(80, 'r');
    adapter::cfg.circulation_topic = topic;
    sdk::subscribe_failures[0]     = true;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(!sdk::topic_live(topic.c_str()) && daik::s_circulation_subscribed_topic.empty() &&
                !daik::s_circulation_status.subscribed,
            "CIRCULATION_FAILED_NEW_TOPIC_HAS_NO_OWNER_OR_FALSE_STATUS");
    subscription_locks_released();
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::subscribe_calls == 2 && sdk::topic_live(topic.c_str()) &&
                daik::s_circulation_subscribed_topic == topic &&
                daik::s_circulation_status.subscribed,
            "CIRCULATION_FAILED_NEW_SUBSCRIPTION_RECOVERS_ON_RETRY");
    daik::mqtt_circulation_reconfigure(true);
    sdk::subscribe_failures[sdk::subscribe_calls] = true;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::topic_live(topic.c_str()) && daik::s_circulation_subscribed_topic == topic,
            "CIRCULATION_FAILED_RESUBSCRIBE_RETAINS_LIVE_PRIOR_OWNER");
    require(!daik::s_circulation_status.subscribed,
            "CIRCULATION_FAILED_RESUBSCRIBE_DOES_NOT_CLAIM_SUCCESS");
    feed(topic.c_str(), R"({"power":57,"time":1700000100})");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_circulation_status.has_value && daik::s_circulation_status.power_w == 57 &&
                daik::s_circulation_status.source_unix_s == 1700000100,
            "CIRCULATION_STILL_LIVE_SUBSCRIPTION_CAN_UPDATE_AFTER_FAILED_RESUBSCRIBE");
    subscription_locks_released();
    const int before_retry = sdk::subscribe_calls;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::subscribe_calls == before_retry + 1 && daik::s_circulation_status.subscribed,
            "CIRCULATION_PRIOR_OWNER_EQUALITY_DOES_NOT_BYPASS_RETRY");
    require(daik::s_circulation_status.has_value && daik::s_circulation_status.power_w == 57 &&
                daik::s_circulation_status.source_unix_s == 1700000100,
            "CIRCULATION_SUBSCRIBE_RETRY_PRESERVES_ACCEPTED_SOURCE_EVIDENCE");
    adapter::cfg.circulation_topic.clear();
    daik::mqtt_circulation_reconfigure(true);
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(topic.c_str()) == 1 && !sdk::topic_live(topic.c_str()),
            "CIRCULATION_RETRY_FINAL_CLEANUP_UNSUBSCRIBES_ONCE");
    subscription_locks_released();
}
void circulation_saved_replacement_failure() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string old_topic    = "mem01-public-replaced-circulation/" + std::string(70, 'o');
    const std::string new_topic    = "mem01-public-replacement-circulation/" + std::string(70, 'n');
    adapter::cfg.circulation_topic = old_topic;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    adapter::cfg.circulation_topic = new_topic;
    daik::mqtt_circulation_reconfigure(true);
    sdk::subscribe_failures[sdk::subscribe_calls] = true;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(old_topic.c_str()) == 1 && !sdk::topic_live(old_topic.c_str()) &&
                !sdk::topic_live(new_topic.c_str()) &&
                daik::s_circulation_subscribed_topic.empty() &&
                !daik::s_circulation_status.subscribed,
            "CIRCULATION_FAILED_REPLACEMENT_RETIRES_OLD_OWNER_ONCE");
    subscription_locks_released();
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::topic_live(new_topic.c_str()) && daik::s_circulation_status.subscribed &&
                daik::s_circulation_subscribed_topic == new_topic &&
                sdk::unsubscribe_count(old_topic.c_str()) == 1,
            "CIRCULATION_REPLACEMENT_RETRY_DOES_NOT_UNSUBSCRIBE_RETIRED_OWNER_AGAIN");
    adapter::cfg.circulation_topic.clear();
    daik::mqtt_circulation_reconfigure(true);
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(new_topic.c_str()) == 1 &&
                sdk::unsubscribe_count(old_topic.c_str()) == 1,
            "CIRCULATION_REPLACEMENT_FINAL_CLEANUP_IS_EXACT");
    subscription_locks_released();
}
daik::ReferenceTopicSet saved_reference_topics() {
    adapter::cfg.ref_temp_topic = "mem01-public-reference/temperature/" + std::string(70, 't');
    adapter::cfg.ref_temp_setpoint_topic =
        "mem01-public-reference/setpoint/" + std::string(70, 's');
    adapter::cfg.ref_temp_time_topic = "mem01-public-reference/time/" + std::string(70, 'u');
    adapter::cfg.ref_temp_fixed_setpoint_tenths = 0;
    adapter::cfg.ref_temp_setpoint_path         = "setpoint";
    return daik::reference_topics(adapter::cfg);
}
void reference_saved_reconnect_oom() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto     topics = saved_reference_topics();
    const uint32_t epoch  = daik::s_ref_requested_epoch.load();
    daik::service_reference_subscription(adapter::cfg, epoch);
    require(daik::s_ref_subscribed_topics == topics && daik::s_ref_status.subscribed &&
                !daik::s_ref_subscription_retry,
            "REFERENCE_RECONNECT_OOM_ACCEPTED_UNCHANGED_OWNER_BASELINE");
    // Fail the setpoint and time copies, then each of the three desired-topic slot copies. The
    // mapping and accepted owners stay unchanged, so only post-force preparation is under test.
    for (int allocation = 0; allocation < 5; ++allocation) {
        clean_broker_reconnect();
        for (const auto& topic : topics)
            require(!sdk::topic_live(topic.c_str()),
                    "REFERENCE_CLEAN_SESSION_HAS_NO_SUBSCRIPTIONS");
        const int before        = sdk::subscribe_calls;
        const int failed_before = sdk::failed_news;
        cpp_witness::attempted  = 0;
        cpp_witness::fail_after = allocation;
        bool threw              = false;
        try {
            daik::service_reference_subscription(adapter::cfg, epoch);
        } catch (const std::bad_alloc&) {
            threw = true;
        }
        cpp_witness::fail_after = -1;
        require(threw && cpp_witness::attempted == allocation + 1 &&
                    sdk::failed_news == failed_before + 1 && sdk::allocation_fail_lock_depth == 0,
                "REFERENCE_RECONNECT_PREPARATION_REAL_BAD_ALLOC");
        require(sdk::subscribe_calls == before && daik::s_ref_subscribed_topics == topics &&
                    !daik::s_ref_status.subscribed && !daik::s_ref_reconfigure,
                "REFERENCE_RECONNECT_OOM_RETAINS_PRIOR_OWNERS_WITHOUT_BROKER_EFFECT");
        const bool retry_pending = daik::s_ref_subscription_retry;
        subscription_locks_released();
        daik::service_reference_subscription(adapter::cfg, epoch);
        bool all_live = true;
        for (const auto& topic : topics) all_live = all_live && sdk::topic_live(topic.c_str());
        require(sdk::subscribe_calls == before + 3 && all_live &&
                    daik::s_ref_subscribed_topics == topics && daik::s_ref_status.subscribed &&
                    daik::s_ref_status.error.empty(),
                "REFERENCE_RECONNECT_OOM_NEXT_CYCLE_RESUBSCRIBES_ALL_TOPICS");
        require(retry_pending && !daik::s_ref_subscription_retry,
                "REFERENCE_RECONNECT_RETRY_SURVIVES_OOM_AND_CLEARS_AFTER_ACCEPTANCE");
        feed(topics[0].c_str(), R"({"temperature":21,"enabled":true})");
        feed(topics[1].c_str(), R"({"setpoint":22})");
        feed(topics[2].c_str(), R"({"time":1700000100})");
        daik::service_reference_frames(adapter::cfg);
        require(daik::s_ref_status.has_value && daik::s_ref_status.temperature_c == 21 &&
                    daik::s_ref_status.has_setpoint && daik::s_ref_status.setpoint_c == 22 &&
                    daik::s_ref_status.has_source_time &&
                    daik::s_ref_status.source_unix_s == 1700000100,
                "REFERENCE_RECONNECT_ACCEPTED_SUBSCRIPTIONS_RECEIVE_CURRENT_WIRE_VALUES");
        subscription_locks_released();
    }
}
void reference_cleanup_once(const daik::ReferenceTopicSet& topics) {
    adapter::cfg.ref_temp_topic.clear();
    daik::mqtt_reference_reconfigure();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    for (const auto& topic : topics)
        require(sdk::unsubscribe_count(topic.c_str()) == 1 && !sdk::topic_live(topic.c_str()),
                "REFERENCE_CLEANUP_UNSUBSCRIBES_EACH_ACCEPTED_TOPIC_ONCE");
    require(daik::s_ref_subscribed_topics == daik::ReferenceTopicSet{} &&
                !daik::s_ref_status.subscribed,
            "REFERENCE_CLEANUP_RELEASES_ALL_OWNERS_AND_STATUS");
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    for (const auto& topic : topics)
        require(sdk::unsubscribe_count(topic.c_str()) == 1,
                "REFERENCE_CLEANUP_DOES_NOT_REPEAT_UNSUBSCRIBE");
    subscription_locks_released();
}
void reference_saved_postsubscribe_oom(bool final_copy) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto              topics = saved_reference_topics();
    daik::ReferenceTopicSet fresh_owner;
    daik::s_ref_subscribed_topics.swap(fresh_owner);
    for (size_t i = 0; i < topics.size(); ++i)
        require(daik::s_ref_subscribed_topics[i].capacity() < topics[i].size(),
                "REFERENCE_NO_PRIOR_OWNER_ARRAY_CAPACITY");
    if (final_copy) {
        sdk::on_subscribe = [](const char*, int) {
            if (sdk::subscribe_calls == 3) sdk::reject_new_after_subscribe = true;
        };
    } else {
        sdk::reject_new_after_subscribe = true;
    }
    bool threw = false;
    try {
        daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    const bool refusal_still_armed = sdk::fail_next_new;
    sdk::fail_next_new             = false;
    sdk::on_subscribe              = {};
    require(daik::s_ref_subscribed_topics == topics,
            final_copy ? "SAVED_REFERENCE_FINAL_OWNER_ARRAY_COMMITTED"
                       : "SAVED_REFERENCE_ACCEPTED_TOPIC_CLEANUP_OWNERSHIP");
    require(sdk::subscribe_calls == 3, "REFERENCE_SDK_ATTEMPTED_ALL_THREE_EXACT_TOPICS");
    for (const auto& topic : topics)
        require(sdk::topic_live(topic.c_str()), "REFERENCE_SDK_ACCEPTED_EXACT_TOPIC");
    require(!threw && sdk::failed_news == 0 && refusal_still_armed,
            "REFERENCE_POSTSUBSCRIBE_OWNER_COMMITS_DO_NOT_ALLOCATE");
    require(daik::s_ref_status.subscribed && daik::s_ref_status.error.empty(),
            "REFERENCE_COMPLETE_SUBSCRIPTION_STATUS_RECORDED");
    subscription_locks_released();
    reference_cleanup_once(topics);
}
void reference_saved_partial_retry() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto topics          = saved_reference_topics();
    sdk::subscribe_failures[1] = true;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(sdk::subscribe_calls == 3 && sdk::topic_live(topics[0].c_str()) &&
                !sdk::topic_live(topics[1].c_str()) && sdk::topic_live(topics[2].c_str()),
            "REFERENCE_PARTIAL_BATCH_SDK_RESULTS_ARE_INDEPENDENT");
    require(daik::reference_topic_owned(topics[0]) && !daik::reference_topic_owned(topics[1]) &&
                daik::reference_topic_owned(topics[2]),
            "REFERENCE_PARTIAL_BATCH_RETAINS_ONLY_ACCEPTED_NEW_OWNERS");
    require(!daik::s_ref_status.subscribed && !daik::s_ref_status.error.empty(),
            "REFERENCE_PARTIAL_BATCH_DOES_NOT_CLAIM_FULL_SUBSCRIPTION");
    subscription_locks_released();
    const int before_retry = sdk::subscribe_calls;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(sdk::subscribe_calls > before_retry && daik::s_ref_subscribed_topics == topics &&
                sdk::topic_live(topics[1].c_str()) && daik::s_ref_status.subscribed &&
                daik::s_ref_status.error.empty(),
            "REFERENCE_PARTIAL_BATCH_RECOVERS_ON_LATER_RETRY");
    subscription_locks_released();
    reference_cleanup_once(topics);
}
void reference_saved_prior_owner_failure(bool retry) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto topics = saved_reference_topics();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(daik::s_ref_subscribed_topics == topics && daik::s_ref_status.subscribed,
            "REFERENCE_PRIOR_LIVE_OWNER_BASELINE");
    daik::mqtt_reference_reconfigure();
    sdk::subscribe_failures[sdk::subscribe_calls + 1] = true;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(daik::s_ref_subscribed_topics == topics && sdk::topic_live(topics[1].c_str()) &&
                sdk::unsubscribe_count(topics[1].c_str()) == 0,
            "REFERENCE_FAILED_RESUBSCRIBE_RETAINS_STILL_LIVE_PRIOR_OWNER");
    require(!daik::s_ref_status.subscribed,
            "REFERENCE_FAILED_RESUBSCRIBE_DOES_NOT_CLAIM_FULL_SUCCESS");
    feed(topics[0].c_str(), R"({"temperature":21,"enabled":true})");
    feed(topics[1].c_str(), R"({"setpoint":22})");
    feed(topics[2].c_str(), R"({"time":1700000100})");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.has_value && daik::s_ref_status.temperature_c == 21 &&
                daik::s_ref_status.has_setpoint && daik::s_ref_status.setpoint_c == 22 &&
                daik::s_ref_status.has_source_time &&
                daik::s_ref_status.source_unix_s == 1700000100,
            "REFERENCE_STILL_LIVE_SUBSCRIPTIONS_UPDATE_AFTER_FAILED_RESUBSCRIBE");
    subscription_locks_released();
    if (retry) {
        const int before_retry = sdk::subscribe_calls;
        daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
        require(sdk::subscribe_calls > before_retry && daik::s_ref_status.subscribed &&
                    daik::s_ref_status.error.empty(),
                "REFERENCE_PRIOR_OWNER_ARRAY_EQUALITY_DOES_NOT_BYPASS_RETRY");
        require(daik::s_ref_status.has_value && daik::s_ref_status.temperature_c == 21 &&
                    daik::s_ref_status.has_setpoint && daik::s_ref_status.setpoint_c == 22 &&
                    daik::s_ref_status.has_source_time &&
                    daik::s_ref_status.source_unix_s == 1700000100,
                "REFERENCE_SUBSCRIBE_RETRY_PRESERVES_ACCEPTED_SOURCE_EVIDENCE");
    }
    reference_cleanup_once(topics);
}
void reference_saved_replacement_partial_failure() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto old_topics = saved_reference_topics();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    adapter::cfg.ref_temp_topic = "mem01-public-new-reference/temperature/" + std::string(60, 'n');
    adapter::cfg.ref_temp_time_topic = "mem01-public-new-reference/time/" + std::string(60, 'm');
    const auto new_topics            = daik::reference_topics(adapter::cfg);
    daik::mqtt_reference_reconfigure();
    sdk::subscribe_failures[sdk::subscribe_calls + 1] = true; // prior still-live setpoint
    sdk::subscribe_failures[sdk::subscribe_calls + 2] = true; // new timestamp was never accepted
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(sdk::unsubscribe_count(old_topics[0].c_str()) == 1 &&
                sdk::unsubscribe_count(old_topics[2].c_str()) == 1 &&
                !sdk::topic_live(old_topics[0].c_str()) && !sdk::topic_live(old_topics[2].c_str()),
            "REFERENCE_REPLACEMENT_RETIRES_EACH_REMOVED_OLD_OWNER_ONCE");
    require(daik::reference_topic_owned(new_topics[0]) &&
                daik::reference_topic_owned(new_topics[1]) &&
                !daik::reference_topic_owned(new_topics[2]) &&
                sdk::topic_live(new_topics[0].c_str()) && sdk::topic_live(new_topics[1].c_str()) &&
                !sdk::topic_live(new_topics[2].c_str()) && !daik::s_ref_status.subscribed,
            "REFERENCE_PARTIAL_REPLACEMENT_DISTINGUISHES_NEW_AND_PRIOR_OWNERS");
    subscription_locks_released();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(daik::s_ref_subscribed_topics == new_topics && daik::s_ref_status.subscribed &&
                sdk::unsubscribe_count(old_topics[0].c_str()) == 1 &&
                sdk::unsubscribe_count(old_topics[2].c_str()) == 1,
            "REFERENCE_REPLACEMENT_RETRY_PRESERVES_EXACT_RETIRED_CLEANUP");
    reference_cleanup_once(new_topics);
}
void circulation_unsubscribe_rejection(bool replacement) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string old_topic    = "mem01-public-circulation-retire/" + std::string(60, 'o');
    const std::string new_topic    = "mem01-public-circulation-next/" + std::string(60, 'n');
    adapter::cfg.circulation_topic = old_topic;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    adapter::cfg.circulation_topic = replacement ? new_topic : "";
    daik::mqtt_circulation_reconfigure(true);
    const int before_subscribe                        = sdk::subscribe_calls;
    sdk::unsubscribe_failures[sdk::unsubscribe_calls] = true;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(daik::s_circulation_subscribed_topic == old_topic &&
                sdk::topic_live(old_topic.c_str()) && !daik::s_circulation_status.subscribed &&
                sdk::accepted_unsubscribe_count(old_topic.c_str()) == 0,
            "CIRCULATION_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER");
    require(sdk::subscribe_calls == before_subscribe,
            "CIRCULATION_REJECTED_RETIRE_STARTS_NO_NEW_SUBSCRIPTION");
    subscription_locks_released();
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(sdk::unsubscribe_count(old_topic.c_str()) == 2 &&
                sdk::accepted_unsubscribe_count(old_topic.c_str()) == 1 &&
                !sdk::topic_live(old_topic.c_str()),
            "CIRCULATION_REJECTED_RETIRE_RECOVERS_WITH_ONE_ACCEPTED_UNSUBSCRIBE");
    if (replacement) {
        require(daik::s_circulation_subscribed_topic == new_topic &&
                    sdk::topic_live(new_topic.c_str()) && daik::s_circulation_status.subscribed,
                "CIRCULATION_REPLACEMENT_STARTS_ONLY_AFTER_RETIRED_OWNER_RELEASED");
        adapter::cfg.circulation_topic.clear();
        daik::mqtt_circulation_reconfigure(true);
        daik::service_circulation_subscription(adapter::cfg,
                                               daik::s_circulation_requested_epoch.load());
        require(sdk::accepted_unsubscribe_count(new_topic.c_str()) == 1,
                "CIRCULATION_UNSUBSCRIBE_RETRY_NEW_OWNER_CLEANUP_EXACT");
    }
    require(daik::s_circulation_subscribed_topic.empty() &&
                sdk::accepted_unsubscribe_count(old_topic.c_str()) == 1,
            "CIRCULATION_UNSUBSCRIBE_RETRY_LEAVES_NO_STALE_OWNER");
    subscription_locks_released();
}
void reference_unsubscribe_rejection(bool replacement) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const auto old_topics = saved_reference_topics();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    adapter::cfg.ref_temp_topic =
        replacement ? "mem01-public-reference-next/" + std::string(60, 'n') : "";
    const auto new_topics = daik::reference_topics(adapter::cfg);
    daik::mqtt_reference_reconfigure();
    const int before_subscribe                        = sdk::subscribe_calls;
    sdk::unsubscribe_failures[sdk::unsubscribe_calls] = true;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(daik::reference_topic_owned(old_topics[0]) && sdk::topic_live(old_topics[0].c_str()) &&
                sdk::accepted_unsubscribe_count(old_topics[0].c_str()) == 0 &&
                !daik::s_ref_status.subscribed,
            "REFERENCE_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER");
    require(sdk::subscribe_calls == before_subscribe,
            "REFERENCE_REJECTED_RETIRE_STARTS_NO_NEW_SUBSCRIPTION");
    subscription_locks_released();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(sdk::unsubscribe_count(old_topics[0].c_str()) == 2 &&
                sdk::accepted_unsubscribe_count(old_topics[0].c_str()) == 1 &&
                !sdk::topic_live(old_topics[0].c_str()),
            "REFERENCE_REJECTED_RETIRE_RECOVERS_WITH_ONE_ACCEPTED_UNSUBSCRIBE");
    if (replacement) {
        require(daik::s_ref_subscribed_topics == new_topics && daik::s_ref_status.subscribed,
                "REFERENCE_REPLACEMENT_STARTS_ONLY_AFTER_RETIRED_OWNER_RELEASED");
        reference_cleanup_once(new_topics);
    } else {
        require(daik::s_ref_subscribed_topics == daik::ReferenceTopicSet{},
                "REFERENCE_UNSUBSCRIBE_RETRY_RELEASES_ALL_OWNERS");
        for (const auto& topic : old_topics)
            require(sdk::accepted_unsubscribe_count(topic.c_str()) == 1,
                    "REFERENCE_UNSUBSCRIBE_RETRY_EACH_TOPIC_RELEASED_ONCE");
    }
    subscription_locks_released();
}
void circulation_probe_unsubscribe_rejection(bool diagnostics_disabled) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic = "mem01-public-probe-retire/" + std::string(60, 'p');
    sdk::retain_topic(topic.c_str());
    daik::s_circulation_probe_subscribed_topic = topic;
    daik::s_circulation_probe.active           = false;
    if (diagnostics_disabled) adapter::cfg.diagnostics_enabled = false;
    sdk::unsubscribe_failures[sdk::unsubscribe_calls] = true;
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic == topic && sdk::topic_live(topic.c_str()) &&
                sdk::accepted_unsubscribe_count(topic.c_str()) == 0,
            "PROBE_REJECTED_UNSUBSCRIBE_RETAINS_EXACT_LIVE_OWNER");
    subscription_locks_released();
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic.empty() && !sdk::topic_live(topic.c_str()) &&
                sdk::unsubscribe_count(topic.c_str()) == 2 &&
                sdk::accepted_unsubscribe_count(topic.c_str()) == 1,
            "PROBE_REJECTED_RETIRE_RECOVERS_WITH_ONE_ACCEPTED_UNSUBSCRIBE");
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(sdk::unsubscribe_count(topic.c_str()) == 2,
            "PROBE_REJECTED_RETIRE_DOES_NOT_REPEAT_ACCEPTED_CLEANUP");
    subscription_locks_released();
}
void shared_subscription_owners() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-shared-source/" + std::string(60, 's');
    adapter::cfg.ref_temp_topic    = topic;
    adapter::cfg.circulation_topic = topic;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    adapter::cfg.ref_temp_topic.clear();
    daik::mqtt_reference_reconfigure();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(!daik::reference_topic_owned(topic) && daik::s_circulation_subscribed_topic == topic &&
                sdk::topic_live(topic.c_str()) && sdk::unsubscribe_count(topic.c_str()) == 0,
            "REFERENCE_RETIRE_PRESERVES_SHARED_CIRCULATION_OWNER");
    daik::s_circulation_probe_subscribed_topic = topic;
    daik::s_circulation_probe.active           = false;
    adapter::cfg.circulation_topic.clear();
    daik::mqtt_circulation_reconfigure(true);
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(daik::s_circulation_subscribed_topic.empty() &&
                daik::s_circulation_probe_subscribed_topic == topic &&
                sdk::topic_live(topic.c_str()) && sdk::unsubscribe_count(topic.c_str()) == 0,
            "CIRCULATION_RETIRE_PRESERVES_SHARED_PROBE_OWNER");
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic.empty() && !sdk::topic_live(topic.c_str()) &&
                sdk::unsubscribe_count(topic.c_str()) == 1,
            "FINAL_SHARED_OWNER_RELEASE_UNSUBSCRIBES_EXACT_TOPIC_ONCE");
    subscription_locks_released();
}
void prepare_active_probe(const std::string& topic, uint32_t generation) {
    daik::Lock lk(daik::s_mtx);
    daik::s_circulation_probe.config.topic          = topic;
    daik::s_circulation_probe.config.power_path     = "power";
    daik::s_circulation_probe.config.timestamp_path = "time";
    daik::s_circulation_probe.config.max_age_s      = 600;
    daik::s_circulation_probe.config.on_tenths_w    = 100;
    daik::s_circulation_probe.config.off_tenths_w   = 50;
    daik::s_circulation_probe.config.confirm_s      = 1;
    daik::s_circulation_probe.generation            = generation;
    daik::s_circulation_probe.active                = true;
    daik::s_circulation_probe.subscribed            = false;
}
void probe_active_replacement(bool reject_retire) {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string old_topic = "mem01-public-old-active-probe/" + std::string(60, 'o');
    const std::string new_topic = "mem01-public-new-active-probe/" + std::string(60, 'n');
    prepare_active_probe(old_topic, 41);
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic == old_topic &&
                sdk::topic_live(old_topic.c_str()),
            "PROBE_ACTIVE_REPLACEMENT_PRIOR_OWNER_SEEDED");
    // The next HTTP test can start before mqtt_task has observed the inactive old probe.
    prepare_active_probe(new_topic, 42);
    const int before_subscribe = sdk::subscribe_calls;
    if (reject_retire) sdk::unsubscribe_failures[sdk::unsubscribe_calls] = true;
    const auto before_new_subscribe = [&](const char* topic, int) {
        if (std::strcmp(topic, new_topic.c_str()) == 0)
            require(!sdk::topic_live(old_topic.c_str()),
                    "PROBE_ACTIVE_REPLACEMENT_RETIRES_OLD_OWNER_BEFORE_NEW_SUBSCRIBE");
    };
    if (!reject_retire) sdk::on_subscribe = before_new_subscribe;
    daik::service_circulation_probe_subscription(adapter::cfg);
    if (reject_retire) {
        require(daik::s_circulation_probe_subscribed_topic == old_topic &&
                    sdk::topic_live(old_topic.c_str()) &&
                    sdk::subscribe_calls == before_subscribe &&
                    !daik::s_circulation_probe.subscribed,
                "PROBE_ACTIVE_REJECTED_RETIRE_RETAINS_OWNER_AND_DEFERS_NEW_EFFECT");
        subscription_locks_released();
        sdk::on_subscribe = before_new_subscribe;
        daik::service_circulation_probe_subscription(adapter::cfg);
    }
    sdk::on_subscribe = {};
    require(daik::s_circulation_probe_subscribed_topic == new_topic &&
                sdk::topic_live(new_topic.c_str()) && !sdk::topic_live(old_topic.c_str()) &&
                sdk::accepted_unsubscribe_count(old_topic.c_str()) == 1 &&
                daik::s_circulation_probe.subscribed,
            "PROBE_ACTIVE_REPLACEMENT_COMMITS_ONLY_NEW_CLEANUP_OWNER");
    subscription_locks_released();
    daik::s_circulation_probe.active = false;
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(sdk::accepted_unsubscribe_count(new_topic.c_str()) == 1 &&
                sdk::accepted_unsubscribe_count(old_topic.c_str()) == 1 &&
                daik::s_circulation_probe_subscribed_topic.empty(),
            "PROBE_ACTIVE_REPLACEMENT_FINAL_CLEANUP_EXACT");
    subscription_locks_released();
}
void probe_saved_config_without_owner() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string topic        = "mem01-public-unaccepted-saved-probe/" + std::string(60, 'p');
    adapter::cfg.circulation_topic = topic;
    sdk::subscribe_failures[0]     = true;
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
    require(daik::s_circulation_subscribed_topic.empty() && !sdk::topic_live(topic.c_str()),
            "PROBE_SAVED_TOPIC_CONFIGURATION_HAS_NO_ACCEPTED_OWNER");
    prepare_active_probe(topic, 42);
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic == topic && sdk::topic_live(topic.c_str()) &&
                daik::s_circulation_probe.subscribed,
            "PROBE_ACCEPTED_SAVED_CONFIG_TOPIC_RETAINS_OWN_CLEANUP_IDENTITY");
    daik::s_circulation_probe.active = false;
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(!sdk::topic_live(topic.c_str()) &&
                sdk::accepted_unsubscribe_count(topic.c_str()) == 1 &&
                daik::s_circulation_probe_subscribed_topic.empty(),
            "PROBE_CONFIGURED_BUT_UNOWNED_SAVED_TOPIC_IS_CLEANED_EXACTLY_ONCE");
    subscription_locks_released();
}
void probe_active_shared_prior_owner() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    const std::string old_topic = "mem01-public-shared-old-probe/" + std::string(60, 's');
    const std::string new_topic = "mem01-public-unshared-new-probe/" + std::string(60, 'n');
    adapter::cfg.ref_temp_topic = old_topic;
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    daik::s_circulation_probe_subscribed_topic = old_topic;
    daik::s_circulation_probe_task_generation  = 41;
    prepare_active_probe(new_topic, 42);
    daik::service_circulation_probe_subscription(adapter::cfg);
    require(daik::s_circulation_probe_subscribed_topic == new_topic &&
                sdk::topic_live(old_topic.c_str()) && sdk::topic_live(new_topic.c_str()) &&
                sdk::unsubscribe_count(old_topic.c_str()) == 0,
            "PROBE_ACTIVE_REPLACEMENT_PRESERVES_OTHER_ACTUAL_PRIOR_OWNER");
    daik::s_circulation_probe.active = false;
    daik::service_circulation_probe_subscription(adapter::cfg);
    adapter::cfg.ref_temp_topic.clear();
    daik::mqtt_reference_reconfigure();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    require(sdk::accepted_unsubscribe_count(old_topic.c_str()) == 1 &&
                sdk::accepted_unsubscribe_count(new_topic.c_str()) == 1,
            "PROBE_ACTIVE_SHARED_REPLACEMENT_FINAL_CLEANUP_EXACT");
    subscription_locks_released();
}
daik::ReferenceMqttFrame json_frame(const std::string& payload) {
    daik::ReferenceMqttFrame frame{};
    require(payload.size() <= daik::REF_TEMP_PAYLOAD_MAX, "JSON_FIXTURE_FITS_PRODUCTION_FRAME");
    std::strcpy(frame.topic, "source");
    std::memcpy(frame.payload, payload.data(), payload.size());
    frame.payload_len     = payload.size();
    frame.received_unix_s = 1700000100;
    return frame;
}
void json_both(const std::string& payload, bool accepted, const char* expected_error = nullptr) {
    const auto frame = json_frame(payload);
    const auto ref = daik::decode_reference_frame(frame, "source", "temperature", "", "", "source",
                                                  "time", "enabled", "");
    require(ref.valid == accepted, "REAL_CJSON_REFERENCE_EXPECTED_ACCEPTANCE");
    if (expected_error)
        require(ref.error && std::strstr(ref.error, expected_error),
                "REAL_CJSON_REFERENCE_EXPECTED_REJECTION_REASON");
    require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
            "REAL_CJSON_REFERENCE_OWNERSHIP_BALANCED");
    const auto circ = daik::decode_circulation_frame(frame, "power", "time");
    require(circ.valid == accepted, "REAL_CJSON_CIRCULATION_EXPECTED_ACCEPTANCE");
    if (expected_error)
        require(circ.error && std::strstr(circ.error, expected_error),
                "REAL_CJSON_CIRCULATION_EXPECTED_REJECTION_REASON");
    require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
            "REAL_CJSON_CIRCULATION_OWNERSHIP_BALANCED");
}
void real_json_consumers() {
    const std::string valid = R"({"temperature":20,"power":50,"time":1700000100,"enabled":true})";
    json_both(valid, true);
    json_both(valid + " \t\r\n", true);
    json_both(valid + "junk", false, "trailing");
    json_both(valid + "{}", false, "trailing");
    json_both(valid + std::string("\0", 1) + "junk", false, "not valid");
    const std::string with_extra     = valid.substr(0, valid.size() - 1) + ",\"extra\":\"";
    const int         before_strings = json_witness::parses;
    json_both(with_extra + "a" + std::string(1, '\0') + "b\"}", false, "not valid");
    json_both(with_extra + R"(a\u0000b"})", false, "not valid");
    json_both(with_extra + "a\nb\"}", false, "not valid");
    require(json_witness::parses == before_strings,
            "UNREPRESENTABLE_STRINGS_REJECTED_BEFORE_REAL_CJSON_PARSE");
    for (const std::string_view escape : {"uZZZZ", "uZ000", "u0Z00", "u00Z0", "u000Z"}) {
        json_both(with_extra + "a\\" + std::string(escape) + "b\"}", false, "not valid");
        json_both(valid.substr(0, valid.size() - 1) + ",\"a\\" + std::string(escape) + "b\":1}",
                  false, "not valid");
    }
    require(json_witness::parses == before_strings,
            "MALFORMED_UNICODE_REJECTED_BEFORE_REAL_CJSON_PARSE");
    json_both(with_extra + R"(a\u000"})", false, "not valid");
    json_both(with_extra + R"(a\\u0000b\n\t"})", true);
    json_both(with_extra + R"(a\u0041\u00Af"})", true);
    json_both(
        R"({"temperature":20,"power":50,"time":1700000100,"enabled":true,"literal":"{[\\\" ]}"})",
        true);
    const std::string suffix = ",\"extra\":";
    const std::string prefix = valid.substr(0, valid.size() - 1) + suffix;
    json_both(prefix + std::string(daik::JSON_MAX_DEPTH - 1, '[') + "0" +
                  std::string(daik::JSON_MAX_DEPTH - 1, ']') + "}",
              true);
    const int parses = json_witness::parses;
    json_both(prefix + std::string(daik::JSON_MAX_DEPTH, '[') + "0" +
                  std::string(daik::JSON_MAX_DEPTH, ']') + "}",
              false, "depth");
    require(json_witness::parses == parses, "EXCESS_DEPTH_REJECTED_BEFORE_REAL_CJSON_PARSE");
    json_both(R"({"temperature":20,"power":50,"time":1700000100,"enabled":true,)", false,
              "not valid");
    json_both(R"({"temperature":"20","power":"50","time":1700000100})", false, "not numeric");
    json_both(R"({"temperature":null,"power":false,"time":1700000100})", false, "not numeric");
    json_both(R"({"time":1700000100})", false, "missing");
    json_both(R"({"temperature":20,"power":50,"time":"wrong type"})", false, "Timestamp path");
    json_both("null", false, "missing");
    json_both("[]", false, "missing");
    const auto frame = json_frame(valid);
    for (int allowed : {1, 3, 5}) {
        json_witness::fail_after = allowed;
        const auto partial_ref   = daik::decode_reference_frame(frame, "source", "temperature", "",
                                                                "", "source", "time", "enabled", "");
        require(!partial_ref.valid && json_witness::fail_after == -1,
                "REAL_CJSON_REFERENCE_PARTIAL_TREE_ALLOC_FAILURE_FAILS_CLOSED");
        require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
                "REAL_CJSON_REFERENCE_PARTIAL_TREE_ALLOC_FAILURE_RELEASED");
        json_witness::fail_after = allowed;
        const auto partial_circ  = daik::decode_circulation_frame(frame, "power", "time");
        require(!partial_circ.valid && json_witness::fail_after == -1,
                "REAL_CJSON_CIRCULATION_PARTIAL_TREE_ALLOC_FAILURE_FAILS_CLOSED");
        require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
                "REAL_CJSON_CIRCULATION_PARTIAL_TREE_ALLOC_FAILURE_RELEASED");
    }
    json_witness::fail_next = true;
    const auto ref = daik::decode_reference_frame(frame, "source", "temperature", "", "", "source",
                                                  "time", "enabled", "");
    require(!ref.valid && ref.error && std::strstr(ref.error, "not valid"),
            "REAL_CJSON_REFERENCE_ALLOC_FAILURE_FAILS_CLOSED");
    require(!json_witness::fail_next && json_witness::live == 0,
            "REAL_CJSON_REFERENCE_ALLOC_FAILURE_RELEASED");
    json_witness::fail_next = true;
    const auto circ         = daik::decode_circulation_frame(frame, "power", "time");
    require(!circ.valid && circ.error && std::strstr(circ.error, "not valid"),
            "REAL_CJSON_CIRCULATION_ALLOC_FAILURE_FAILS_CLOSED");
    require(!json_witness::fail_next && json_witness::live == 0,
            "REAL_CJSON_CIRCULATION_ALLOC_FAILURE_RELEASED");
    json_both(valid, true);
    require(json_witness::parses == 40, "BOTH_PRODUCTION_CONSUMERS_USED_REAL_CJSON");
    require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
            "REAL_CJSON_ALL_ALLOCATIONS_RELEASED");
}
void sdk_event_stack_owner() {
    initial_config();
    for (const int event : {MQTT_EVENT_BEFORE_CONNECT, MQTT_EVENT_CONNECTED, MQTT_EVENT_DATA}) {
        const int before = sdk::sdk_task_samples;
        daik::on_mqtt(nullptr, nullptr, event, nullptr);
        require(sdk::sdk_task_samples > before, "SDK_OWNER_EVENT_RECORDS_OWN_STACK");
    }
    const int before = sdk::sdk_task_samples;
    for (const int event :
         {MQTT_EVENT_ERROR, MQTT_EVENT_DISCONNECTED, MQTT_EVENT_PUBLISHED, MQTT_EVENT_DELETED}) {
        daik::on_mqtt(nullptr, nullptr, event, nullptr);
        require(sdk::sdk_task_samples == before, "CALLER_EVENT_DOES_NOT_MISFILE_SDK_STACK");
    }
    require(sdk::samples == 0, "SDK_EVENT_DOES_NOT_MISFILE_PUBLISHER_STACK");
}

cJSON* parse_wire(const sdk::PublishTrace& wire) {
    require(wire.length > 0 && static_cast<size_t>(wire.length) == std::strlen(wire.payload.data()),
            "OUTGOING_WIRE_HAS_EXACT_BOUNDED_PAYLOAD_LENGTH");
    const char* end = nullptr;
    cJSON* root = cJSON_ParseWithLengthOpts(wire.payload.data(), static_cast<size_t>(wire.length),
                                            &end, false);
    require(root && cJSON_IsObject(root) && end == wire.payload.data() + wire.length,
            "OUTGOING_WIRE_IS_COMPLETE_REAL_CJSON_OBJECT");
    return root;
}
void wire_number(cJSON* object, const char* key, double expected, const char* oracle) {
    const cJSON* item = cJSON_GetObjectItemCaseSensitive(object, key);
    require(cJSON_IsNumber(item) && item->valuedouble == expected, oracle);
}
void wire_text(cJSON* object, const char* key, const char* expected, const char* oracle) {
    const cJSON* item = cJSON_GetObjectItemCaseSensitive(object, key);
    require(cJSON_IsString(item) && std::strcmp(item->valuestring, expected) == 0, oracle);
}
void outgoing_heartbeat() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    sdk::ticks                  = 123456;
    adapter::cfg.proto          = daik::Protocol::S;
    adapter::hp.connected       = true;
    adapter::hp.last_ok_s       = 3;
    adapter::hp.registers       = 9;
    adapter::hp.values          = 11;
    adapter::hp.rx_ok           = 23;
    adapter::hp.rx_fail_total   = 4;
    adapter::hp.ou_held_over    = true;
    adapter::wifi.connected     = true;
    adapter::wifi.rssi          = -47;
    const uint8_t device_mac[6] = {0x02, 0, 0, 0, 0, 1};
    const uint8_t ap_mac[6]     = {0x02, 0, 0, 0, 0, 2};
    std::copy(std::begin(device_mac), std::end(device_mac), adapter::wifi.mac);
    std::copy(std::begin(ap_mac), std::end(ap_mac), adapter::wifi.bssid);
    adapter::wifi_reconnects = 7;
    adapter::poll_skips      = 13;
    adapter::boot.reason     = static_cast<uint32_t>(daik::CrashReason::PANIC);
    adapter::link            = daik::NetLink::Wifi;
    adapter::modbus.enabled = adapter::modbus.connected                 = true;
    adapter::modbus.rx_ok                                               = 19;
    adapter::stack_minima[static_cast<size_t>(daik::StackWatch::Httpd)] = 2345;
    adapter::stack_minima[static_cast<size_t>(daik::StackWatch::Mqtt)]  = 0;
    daik::s_mqtt_pub_ok                                                 = 41;
    daik::s_mqtt_pub_fail                                               = 2;
    daik::s_mqtt_skipped                                                = 3;
    sdk::reject_new_after_publish                                       = true;
    daik::publish_heartbeat();
    const bool refusal_armed = sdk::fail_next_new;
    sdk::fail_next_new       = false;
    require(sdk::publish_calls == 1 && sdk::published[0].accepted && sdk::published[0].qos == 0 &&
                sdk::published[0].retain == 0 && !sdk::published[0].enqueued &&
                sdk::published[0].topic.data() == std::string(80, 'm') + "/heartbeat",
            "HEARTBEAT_USES_OWN_TOPIC_AND_NONRETAINED_PUBLISH");
    require(refusal_armed && sdk::failed_news == 0,
            "HEARTBEAT_EMIT_RETURNS_WITHOUT_CPP_ALLOCATION_AFTER_SDK_ACCEPT");
    {
        daik::JsonGuard root(parse_wire(sdk::published[0]));
        wire_text(root.get(), "version", "host-witness", "HEARTBEAT_DEVICE_VERSION_ON_WIRE");
        wire_text(root.get(), "platform", "esp32s3", "HEARTBEAT_PLATFORM_ON_WIRE");
        wire_text(root.get(), "uptime", "000+00:02:03.456", "HEARTBEAT_UPTIME_ON_WIRE");
        wire_number(root.get(), "uptime_s", 123, "HEARTBEAT_UPTIME_SECONDS_ON_WIRE");
        wire_number(root.get(), "free_heap", 100000, "HEARTBEAT_FREE_HEAP_ON_WIRE");
        wire_number(root.get(), "min_free_heap", 90000, "HEARTBEAT_MIN_FREE_HEAP_ON_WIRE");
        wire_number(root.get(), "max_alloc", 40000, "HEARTBEAT_LARGEST_INTERNAL_BLOCK_ON_WIRE");
        wire_number(root.get(), "httpd_stack_min_free_bytes", 2345,
                    "HEARTBEAT_HTTP_STACK_BYTES_ON_WIRE");
        require(
            cJSON_IsNull(cJSON_GetObjectItemCaseSensitive(root.get(), "mqtt_stack_min_free_bytes")),
            "HEARTBEAT_UNSAMPLED_STACK_REMAINS_NULL");
        wire_text(root.get(), "reset_reason", "panic", "HEARTBEAT_BOOT_REASON_TEXT_ON_WIRE");
        wire_number(root.get(), "reset_reason_code", 4, "HEARTBEAT_BOOT_REASON_CODE_ON_WIRE");
        wire_number(root.get(), "reset_fault", 1, "HEARTBEAT_BOOT_FAULT_ON_WIRE");
        wire_number(root.get(), "wifi_connected", 1, "HEARTBEAT_WIFI_CONNECTED_NUMERIC_ON_WIRE");
        wire_number(root.get(), "wifi_rssi", -47, "HEARTBEAT_WIFI_SIGNAL_ON_WIRE");
        wire_number(root.get(), "wifi_reconnects", 7, "HEARTBEAT_WIFI_RECONNECTS_ON_WIRE");
        wire_text(root.get(), "wifi_mac", "02:00:00:00:00:01", "HEARTBEAT_DEVICE_IDENTITY_ON_WIRE");
        wire_text(root.get(), "wifi_bssid", "02:00:00:00:00:02", "HEARTBEAT_AP_IDENTITY_ON_WIRE");
        wire_number(root.get(), "net_link", 1, "HEARTBEAT_TRANSPORT_ON_WIRE");
        wire_number(root.get(), "mqtt_connected", 1, "HEARTBEAT_MQTT_CONNECTION_ON_WIRE");
        wire_number(root.get(), "mqtt_count", 41, "HEARTBEAT_PUBLISH_COUNTER_SNAPSHOT_ON_WIRE");
        wire_number(root.get(), "mqtt_fails", 2, "HEARTBEAT_PUBLISH_FAILURES_ON_WIRE");
        wire_number(root.get(), "mqtt_skipped", 3, "HEARTBEAT_SKIPPED_CYCLES_ON_WIRE");
        wire_number(root.get(), "poll_skipped", 13, "HEARTBEAT_POLL_SKIPPED_CYCLES_ON_WIRE");
        wire_number(root.get(), "bus_connected", 1, "HEARTBEAT_X10A_CONNECTED_ON_WIRE");
        wire_text(root.get(), "bus_proto", "S", "HEARTBEAT_X10A_PROTOCOL_ON_WIRE");
        wire_number(root.get(), "bus_registers", 9, "HEARTBEAT_X10A_REGISTERS_ON_WIRE");
        wire_number(root.get(), "bus_values", 11, "HEARTBEAT_X10A_VALUES_ON_WIRE");
        wire_number(root.get(), "bus_rx_received", 23, "HEARTBEAT_X10A_RECEIVED_ON_WIRE");
        wire_number(root.get(), "bus_rx_fails", 4, "HEARTBEAT_X10A_FAILURES_ON_WIRE");
        wire_number(root.get(), "bus_tx_reads", 27, "HEARTBEAT_X10A_TOTAL_READS_ON_WIRE");
        wire_number(root.get(), "bus_ou_held_over", 1, "HEARTBEAT_X10A_HELD_SOURCE_ON_WIRE");
        wire_number(root.get(), "modbus_connected", 1, "HEARTBEAT_MODBUS_CONNECTED_ON_WIRE");
        wire_number(root.get(), "modbus_rx", 19, "HEARTBEAT_MODBUS_READS_ON_WIRE");
    }
    require(json_witness::live == 0 && sdk::locks == 0 && sdk::takes == sdk::gives,
            "HEARTBEAT_WIRE_INSPECTION_RELEASES_JSON_AND_MUTEX_OWNERSHIP");
    require(daik::s_mqtt_pub_ok == 42 && daik::s_mqtt_pub_fail == 2 && sdk::resets == 1,
            "HEARTBEAT_ACCEPT_UPDATES_PUBLISH_COUNTER_AND_WATCHDOG");
}
void outgoing_weather() {
    initial_config();
    daik::publish_weather_state(true);
    require(sdk::publish_calls == 0 && !daik::s_weather_cleanup_requested.load(),
            "WEATHER_ENABLE_TRANSITION_SUPPRESSES_UNCONFIGURED_RUNTIME");
    adapter::weather.configured = adapter::weather.available = adapter::weather.has_value = true;
    adapter::weather.outdoor_mean_2h_c                                                    = 7.25;
    adapter::weather.solar_energy_2h_wh_m2                                                = 150.5;
    adapter::weather.issued_unix_s  = 1700000060;
    adapter::weather.fetched_unix_s = adapter::weather.decision_unix_s = 1700000100;
    adapter::weather.last_attempt_unix_s                               = 1700000100;
    adapter::weather.successes                                         = 2;
    adapter::weather.errors                                            = 1;
    adapter::weather.state                                             = "ready";
    std::string fresh_cache;
    daik::s_last_weather_json.swap(fresh_cache);
    sdk::reject_new_after_publish = true;
    bool threw                    = false;
    try {
        daik::publish_weather_state(true);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    const bool refusal_armed = sdk::fail_next_new;
    sdk::fail_next_new       = false;
    require(sdk::publish_calls == 1 && sdk::published[0].accepted &&
                sdk::published[0].topic.data() ==
                    std::string(80, 'm') + "/weather/openmeteo/forecast" &&
                sdk::published[0].qos == 0 && sdk::published[0].retain == 1,
            "WEATHER_EMITS_OWN_RETAINED_FORECAST_TOPIC");
    require(daik::s_last_weather_json == sdk::published[0].payload.data(),
            "WEATHER_ACCEPTED_PAYLOAD_COMMITTED_TO_CACHE");
    require(!threw && refusal_armed && sdk::failed_news == 0,
            "WEATHER_CACHE_COMMIT_DOES_NOT_ALLOCATE_AFTER_SDK_ACCEPT");
    {
        daik::JsonGuard root(parse_wire(sdk::published[0]));
        wire_number(root.get(), "schema", 1, "WEATHER_SCHEMA_ON_WIRE");
        wire_text(root.get(), "provider", "open-meteo", "WEATHER_PROVIDER_ON_WIRE");
        wire_text(root.get(), "model", "icon_seamless", "WEATHER_MODEL_ON_WIRE");
        wire_number(root.get(), "configured", 1, "WEATHER_CONFIGURED_ON_WIRE");
        wire_number(root.get(), "available", 1, "WEATHER_AVAILABILITY_ON_WIRE");
        wire_number(root.get(), "fresh", 1, "WEATHER_FRESHNESS_ON_WIRE");
        wire_number(root.get(), "outdoor_mean_2h_c", 7.25, "WEATHER_TEMPERATURE_ON_WIRE");
        wire_number(root.get(), "solar_energy_2h_wh_m2", 150.5, "WEATHER_SOLAR_ENERGY_ON_WIRE");
        wire_number(root.get(), "issued_unix_s", 1700000060, "WEATHER_ISSUE_TIME_ON_WIRE");
        wire_number(root.get(), "fetched_unix_s", 1700000100, "WEATHER_FETCH_TIME_ON_WIRE");
        wire_number(root.get(), "forecast_start_unix_s", 1700000100,
                    "WEATHER_DECISION_TIME_ON_WIRE");
        wire_number(root.get(), "successes", 2, "WEATHER_SUCCESS_COUNT_ON_WIRE");
        wire_number(root.get(), "errors", 1, "WEATHER_ERROR_COUNT_ON_WIRE");
        require(!cJSON_GetObjectItemCaseSensitive(root.get(), "latitude") &&
                    !cJSON_GetObjectItemCaseSensitive(root.get(), "longitude"),
                "WEATHER_FORECAST_WIRE_EXCLUDES_LOCATION_CONFIGURATION");
    }
    const std::string accepted_cache = daik::s_last_weather_json;
    daik::publish_weather_state(true);
    require(sdk::publish_calls == 1, "WEATHER_UNCHANGED_ACCEPTED_PAYLOAD_SUPPRESSES_REPEAT");
    adapter::weather.outdoor_mean_2h_c = 8.75;
    adapter::weather.successes         = 3;
    sdk::reject_next_publish           = true;
    daik::publish_weather_state(true);
    require(sdk::publish_calls == 2 && !sdk::published[1].accepted &&
                daik::s_last_weather_json == accepted_cache,
            "WEATHER_REJECTED_SDK_PUBLISH_RETAINS_LAST_ACCEPTED_CACHE");
    daik::publish_weather_state(true);
    require(sdk::publish_calls == 3 && sdk::published[2].accepted &&
                daik::s_last_weather_json == sdk::published[2].payload.data(),
            "WEATHER_REJECTED_PAYLOAD_RETRIES_UNTIL_ACCEPTED");
    {
        daik::JsonGuard root(parse_wire(sdk::published[2]));
        wire_number(root.get(), "outdoor_mean_2h_c", 8.75, "WEATHER_NEW_TEMPERATURE_ON_WIRE");
        wire_number(root.get(), "successes", 3, "WEATHER_NEW_SUCCESS_COUNT_ON_WIRE");
    }
    const std::string new_cache = daik::s_last_weather_json;
    daik::publish_weather_state(false);
    require(sdk::publish_calls == 3 && daik::s_weather_cleanup_requested.load() &&
                daik::s_last_weather_json == new_cache,
            "WEATHER_DISABLE_REQUESTS_CLEANUP_WITHOUT_SYNTHETIC_FORECAST_OR_CACHE_RESET");
    require(daik::s_mqtt_pub_ok == 2 && daik::s_mqtt_pub_fail == 1 && sdk::resets == 3 &&
                json_witness::live == 0,
            "WEATHER_ACCEPT_REJECT_COUNTERS_AND_JSON_OWNERSHIP_BALANCED");
}
void outgoing_curve() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    feed("room", R"({"temperature":20.5,"time":1700000100,"enabled":true})");
    daik::service_reference_frames(adapter::cfg);
    daik::publish_heating_curve_telemetry(adapter::cfg);
    require(sdk::publish_calls == 1 && sdk::published[0].accepted &&
                sdk::published[0].topic.data() == std::string(80, 'm') + "/heating_curve" &&
                sdk::published[0].qos == 0 && sdk::published[0].retain == 0,
            "CURVE_TELEMETRY_USES_OWN_NONRETAINED_DOMAIN_TOPIC");
    {
        daik::JsonGuard root(parse_wire(sdk::published[0]));
        wire_number(root.get(), "schema_version", 3, "CURVE_SCHEMA_VERSION_ON_WIRE");
        cJSON* room = cJSON_GetObjectItemCaseSensitive(root.get(), "room");
        require(cJSON_IsObject(room), "CURVE_ROOM_EVIDENCE_IS_OWN_OBJECT");
        wire_text(room, "source_id", "living_room", "CURVE_ROOM_SOURCE_ID_ON_WIRE");
        wire_number(room, "temperature_valid", 1, "CURVE_ROOM_TEMPERATURE_VALID_ON_WIRE");
        wire_number(room, "setpoint_valid", 1, "CURVE_ROOM_SETPOINT_VALID_ON_WIRE");
        wire_number(room, "control_eligible", 1, "CURVE_ROOM_ELIGIBILITY_ON_WIRE");
        wire_number(room, "temperature_c", 20.5, "CURVE_ACCEPTED_ROOM_TEMPERATURE_ON_WIRE");
        wire_number(room, "setpoint_c", 22, "CURVE_FIXED_ROOM_TARGET_ON_WIRE");
        wire_number(room, "error_k", 1.5, "CURVE_RAW_ROOM_DIFFERENCE_ON_WIRE");
        wire_number(room, "source_unix_s", 1700000100, "CURVE_SOURCE_TIME_ON_WIRE");
        wire_number(room, "age_s", 0, "CURVE_FRESH_ROOM_AGE_ON_WIRE");
        cJSON* diagnosis = cJSON_GetObjectItemCaseSensitive(root.get(), "diagnosis");
        require(cJSON_IsObject(diagnosis), "CURVE_DIAGNOSIS_IS_INDEPENDENT_OBJECT");
        wire_number(diagnosis, "method_version", 2, "CURVE_METHOD_VERSION_ON_WIRE");
        wire_number(diagnosis, "armed", 0, "CURVE_UNEVALUATED_DIAGNOSIS_DOES_NOT_CLAIM_ARMED");
    }
    adapter::cfg.diagnostics_enabled = false;
    daik::publish_heating_curve_telemetry(adapter::cfg);
    require(sdk::publish_calls == 1, "CURVE_DISABLED_CONSENT_SUPPRESSES_PUBLICATION");
    require(json_witness::live == 0 && sdk::locks == 0 && sdk::takes == sdk::gives,
            "CURVE_TELEMETRY_RELEASES_JSON_AND_MUTEX_OWNERSHIP");
}
void scalar_snapshot_helpers() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    adapter::hp.connected = true;
    adapter::hp.last_ok_s = 1;
    bool connected        = false;
    auto gate = daik::mqtt_cycle_gate(daik::MqttPublishGateState::Unavailable, connected);
    require(connected && gate.resumed && gate.publish_cycle &&
                gate.next == daik::MqttPublishGateState::Active,
            "SCALAR_HP_GATE_PRESERVES_FIRST_SOURCE_PERMISSION");
    gate = daik::mqtt_cycle_gate(daik::MqttPublishGateState::Active, connected);
    require(connected && gate.publish_cycle && !gate.publish_offline,
            "SCALAR_HP_GATE_PRESERVES_CURRENT_PUBLISH_PERMISSION");
    adapter::hp.connected = false;
    adapter::hp.last_ok_s = 16;
    gate                  = daik::mqtt_cycle_gate(daik::MqttPublishGateState::Active, connected);
    require(!connected && !gate.publish_cycle && gate.publish_offline &&
                gate.next == daik::MqttPublishGateState::Paused,
            "SCALAR_HP_GATE_PRESERVES_CONFIRMED_SOURCE_WITHDRAWAL");
    require(!daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_UNCHANGED_NORMAL_BOOT");
    adapter::live_crash.reason = static_cast<uint32_t>(daik::CrashReason::PANIC);
    require(daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_DETECTS_NEW_NOTABILITY");
    daik::s_crash_notable_pub = true;
    require(!daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_ACCEPTED_NOTABILITY_STABLE");
    adapter::live_crash.coredump = true;
    require(daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_DETECTS_NEW_DUMP");
    daik::s_crash_dump_pub = true;
    require(!daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_ACCEPTED_DUMP_STABLE");
    adapter::live_crash.dismissed = true;
    require(daik::crash_publication_changed(), "SCALAR_CRASH_HELPER_DETECTS_DISMISSED_NOTABILITY");
}
std::array<std::string, 5> discovery_documents(const std::string& base,
                                               const std::string& board = "daikin_fixture") {
    const auto           node  = daik::device_node_id(base);
    const auto           state = daik::x10a_topic(base), avail = daik::availability_topic(base);
    const daik::ValueDef row{0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"};
    return {
        daik::discovery_config(node, board, state, avail, row),
        daik::env3_discovery_config(node, board, daik::env3_topic(base), avail,
                                    daik::ENV3_HA_SENSORS[0]),
        daik::companion_discovery_config(node, board, state, avail, "hydronic",
                                         daik::FAULT_COMPANIONS[0]),
        daik::heartbeat_discovery_config(node, board, base + "/heartbeat", avail,
                                         daik::HEARTBEAT_SENSORS[0]),
        daik::crash_discovery_config(node, board, base + "/crash", avail, daik::CRASH_SENSORS[0])};
}
void discovery_topic_roundtrip() {
    // Literal ordinary documents measured on the original source before the escaping change.
    const std::string device =
        R"json("dev":{"ids":["daikin_altherma_esp32","daikin_fixture"],"name":"Daikin Altherma","mf":"Daikin","mdl":"Altherma X10A"})json";
    const char* prefixes[] = {
        R"json({"name":"DHW Tank Temp (R5T)","uniq_id":"daikin_altherma_esp32_hydronic_temps_dhw_tank_temp_r5t","stat_t":"daikin-altherma-esp32/x10a","val_tpl":"{{ value_json.get('hydronic_temps', {}).get('dhw_tank_temp_r5t', 'None') }}","availability":[{"topic":"daikin-altherma-esp32/status"},{"topic":"daikin-altherma-esp32/x10a/status"}],"availability_mode":"all","unit_of_meas":"°C","dev_cla":"temperature","stat_cla":"measurement",)json",
        R"json({"name":"ENV III Temperature","uniq_id":"daikin_altherma_esp32_env3_temperature","stat_t":"daikin-altherma-esp32/env3","val_tpl":"{{ value_json.get('temperature_c') }}","availability":[{"topic":"daikin-altherma-esp32/status"},{"topic":"daikin-altherma-esp32/env3","value_template":"{{ 'online' if value_json.get('temperature_c') is number else 'offline' }}"}],"availability_mode":"all","unit_of_meas":"°C","dev_cla":"temperature","stat_cla":"measurement",)json",
        R"json({"name":"Hydronic Error Active","uniq_id":"daikin_altherma_esp32_hydronic_error_active","stat_t":"daikin-altherma-esp32/x10a","val_tpl":"{{ value_json.get('hydronic', {}).get('error_active', 'None') }}","availability":[{"topic":"daikin-altherma-esp32/status"},{"topic":"daikin-altherma-esp32/x10a/status"}],"availability_mode":"all","pl_on":"1","pl_off":"0","dev_cla":"problem",)json",
        R"json({"name":"WiFi Signal","uniq_id":"daikin_altherma_esp32_wifi_signal","stat_t":"daikin-altherma-esp32/heartbeat","val_tpl":"{{ value_json.wifi_rssi }}","avty_t":"daikin-altherma-esp32/status","unit_of_meas":"dBm","dev_cla":"signal_strength","stat_cla":"measurement","ent_cat":"diagnostic",)json",
        R"json({"name":"Crash Dump Waiting","uniq_id":"daikin_altherma_esp32_coredump","stat_t":"daikin-altherma-esp32/crash","val_tpl":"{{ value_json.coredump | lower }}","pl_on":"true","pl_off":"false","avty_t":"daikin-altherma-esp32/status","dev_cla":"problem","ent_cat":"diagnostic",)json",
    };
    for (const std::string stored :
         {"", "plant\"one", "plant\\one", "plant\\nroom", "plant\"one\\room", "fixture/温度"}) {
        require(daik::mqtt_base_valid(stored),
                "DISCOVERY_BASE_IS_ACCEPTED_BY_PRODUCTION_VALIDATOR");
        const std::string base       = daik::mqtt_base_effective(stored, "daikin-altherma-esp32");
        const auto        documents  = discovery_documents(base);
        const char*       suffixes[] = {"/x10a", "/env3", "/x10a", "/heartbeat", "/crash"};
        for (size_t i = 0; i < documents.size(); ++i) {
            const auto&     bytes = documents[i];
            const char*     end   = nullptr;
            daik::JsonGuard object(
                cJSON_ParseWithLengthOpts(bytes.c_str(), bytes.size(), &end, false));
            require(object && cJSON_IsObject(object.get()) && end == bytes.data() + bytes.size(),
                    "DISCOVERY_IS_COMPLETE_JSON_FOR_ACCEPTED_TOPIC_BYTES");
            wire_text(object.get(), "stat_t", (base + suffixes[i]).c_str(),
                      "DISCOVERY_STATE_TOPIC_ROUNDTRIPS_EXACT_BYTES");
            if (i <= 2) {
                cJSON* availability =
                    cJSON_GetObjectItemCaseSensitive(object.get(), "availability");
                require(cJSON_IsArray(availability) && cJSON_GetArraySize(availability) == 2,
                        "ENV_DISCOVERY_RETAINS_BOTH_AVAILABILITY_AUTHORITIES");
                wire_text(cJSON_GetArrayItem(availability, 0), "topic", (base + "/status").c_str(),
                          "ENV_DISCOVERY_DEVICE_AVAILABILITY_TOPIC_ROUNDTRIPS");
                wire_text(cJSON_GetArrayItem(availability, 1), "topic",
                          (base + (i == 1 ? "/env3" : "/x10a/status")).c_str(),
                          "SOURCE_DISCOVERY_AVAILABILITY_TOPIC_ROUNDTRIPS");
            } else {
                wire_text(object.get(), "avty_t", (base + "/status").c_str(),
                          "DISCOVERY_AVAILABILITY_TOPIC_ROUNDTRIPS_EXACT_BYTES");
            }
            if (stored.empty())
                require(bytes == std::string(prefixes[i]) + device + '}',
                        "DISCOVERY_DEFAULT_DOCUMENT_REMAINS_BYTE_IDENTICAL");
        }
    }
}
void prepare_inbound() {
    initial_config();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    daik::service_circulation_subscription(adapter::cfg,
                                           daik::s_circulation_requested_epoch.load());
}
void fragment(const std::string& payload, int offset, int length, int total = -1) {
    esp_mqtt_event_t e{};
    e.topic               = offset == 0 ? const_cast<char*>("room") : nullptr;
    e.topic_len           = offset == 0 ? 4 : 0;
    e.data                = const_cast<char*>(payload.data() + offset);
    e.data_len            = length;
    e.total_data_len      = total < 0 ? static_cast<int>(payload.size()) : total;
    e.current_data_offset = offset;
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DATA, &e);
}
const std::string room_payload = R"({"temperature":20,"time":1700000100,"enabled":true})";
void              callback_fragments() {
    prepare_inbound();
    fragment(room_payload, 0, 7);
    require(sdk::queue.count == 0 && !daik::s_ref_status.has_value,
                         "FRAGMENT_PREFIX_CANNOT_ENTER_SOURCE_OWNER");
    fragment(room_payload, 7, static_cast<int>(room_payload.size()) - 7);
    require(sdk::queue.count == 1, "COMPLETE_FRAGMENTED_FRAME_QUEUED_ONCE");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.temperature_c == 20 && daik::s_ref_status.messages == 1,
                         "FRAGMENTED_FRAME_REACHES_PRODUCTION_SOURCE_OWNER");
    fragment(room_payload, 0, 7);
    fragment(room_payload, 8, static_cast<int>(room_payload.size()) - 8);
    require(!daik::s_ref_rx_active && sdk::queue.count == 0, "GAPPED_FRAGMENT_RETIRES_CAPTURE");
    fragment(room_payload, 0, 7);
    fragment(room_payload, 6, static_cast<int>(room_payload.size()) - 6);
    require(!daik::s_ref_rx_active && sdk::queue.count == 0,
                         "OVERLAPPING_FRAGMENT_RETIRES_CAPTURE");
    feed("room", room_payload.c_str());
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.messages == 2, "CAPTURE_RECOVERS_AFTER_MALFORMED_FRAGMENT");
}
void callback_payload_bounds() {
    prepare_inbound();
    std::string maximum = room_payload;
    maximum.append(daik::REF_TEMP_PAYLOAD_MAX - maximum.size(), ' ');
    fragment(maximum, 0, 500);
    fragment(maximum, 500, static_cast<int>(maximum.size()) - 500);
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.messages == 1 && daik::s_ref_status.temperature_c == 20,
            "EXACT_MAXIMUM_PAYLOAD_PASSES_COMPLETE_JSON_OWNER");
    maximum += ' ';
    fragment(maximum, 0, static_cast<int>(maximum.size()));
    require(!daik::s_ref_rx_active && sdk::queue.count == 0,
            "OVERSIZED_PAYLOAD_NEVER_ENTERS_QUEUE");
}
void callback_epoch_cutover() {
    prepare_inbound();
    fragment(room_payload, 0, 7);
    daik::mqtt_reference_reconfigure();
    fragment(room_payload, 7, static_cast<int>(room_payload.size()) - 7);
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    daik::service_reference_frames(adapter::cfg);
    require(!daik::s_ref_status.has_value, "PREDECESSOR_FRAGMENT_EPOCH_CANNOT_SEED_SUCCESSOR");
    feed("room", room_payload.c_str());
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.has_value, "SUCCESSOR_EPOCH_ACCEPTS_ITS_OWN_CAPTURE");
}
void callback_queue_full() {
    prepare_inbound();
    for (size_t i = 0; i < daik::REF_QUEUE_DEPTH; ++i) feed("room", room_payload.c_str());
    feed("room", R"({"temperature":21,"time":1700000101,"enabled":true})");
    require(daik::s_ref_dropped.load() == 1 && !daik::s_ref_status.has_value,
            "QUEUE_FULL_CALLBACK_ONLY_COUNTS_DROP_WITHOUT_OWNER_STATUS_WRITE");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_status.messages == daik::REF_QUEUE_DEPTH &&
                daik::s_ref_status.temperature_c == 20 && sdk::queue.count == 0,
            "QUEUE_OVERFLOW_PRESERVES_QUEUED_EVIDENCE_AND_NORMAL_DRAIN");
}
void callback_timestamp_order() {
    prepare_inbound();
    feed("room", room_payload.c_str());
    daik::service_reference_frames(adapter::cfg);
    feed("room", R"({"temperature":"invalid","time":1700000101})");
    daik::service_reference_frames(adapter::cfg);
    feed("room", R"({"temperature":21,"time":1700000099,"enabled":true})");
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_ref_source_time.last_unix_s == 1700000100 &&
                daik::s_ref_status.temperature_c == 20 &&
                daik::s_ref_status.rejection_reason == daik::ReferenceRoomReason::BackwardTimestamp,
            "PRODUCTION_INVALID_PAYLOAD_CANNOT_RESET_TIMESTAMP_HIGH_WATER");
    adapter::cfg.ref_temp_time_path.clear();
    daik::mqtt_reference_reconfigure();
    daik::service_reference_subscription(adapter::cfg, daik::s_ref_requested_epoch.load());
    feed("room", R"({"temperature":20,"enabled":true})", true);
    daik::service_reference_frames(adapter::cfg);
    const auto status    = daik::reference_temperature_status(adapter::cfg);
    const auto freshness = daik::reference_room_freshness(
        false, status.has_value, status.retained, status.has_source_time, status.source_unix_s,
        status.received_ms, 1700000100, sdk::ticks, adapter::cfg.ref_temp_max_age_s);
    require(status.has_value && !status.has_source_time && status.source_unix_s == -1 &&
                status.retained && !freshness.fresh &&
                std::strcmp(freshness.reason, "retained_without_timestamp") == 0,
            "RETAINED_WITHOUT_SOURCE_TIME_CANNOT_FABRICATE_FRESH_ROOM_EVIDENCE");
}
void begin_probe(uint32_t generation, uint32_t max_age_s = 10) {
    auto& probe      = daik::s_circulation_probe;
    probe.config     = {"circulation", "power", "time", max_age_s, 100, 50, 1};
    probe.generation = generation;
    probe.active     = true;
    probe.passed     = false;
    probe.clock      = {};
    daik::s_circulation_probe_capture_generation.store(generation);
}
void probe_capture_generation() {
    prepare_inbound();
    feed("circulation", R"({"power":50,"time":1700000100})");
    begin_probe(42);
    daik::service_reference_frames(adapter::cfg);
    require(daik::s_circulation_probe.active && !daik::s_circulation_probe.passed,
            "PRETEST_QUEUED_FRAME_CANNOT_PROVE_SUCCESSOR_TEST");
    feed("circulation", R"({"power":50,"time":1700000100})");
    daik::service_reference_frames(adapter::cfg);
    require(daik::mqtt_circulation_test_proof_valid(42, daik::s_circulation_probe.config),
            "CURRENT_TEST_CAPTURE_PROVES_EXACT_MAPPING");
    require(!daik::mqtt_circulation_test_proof_valid(0, daik::s_circulation_probe.config),
            "ZERO_PROOF_IS_ALWAYS_REJECTED");
    begin_probe(43);
    feed("circulation", R"({"power":50,"time":1700000100})");
    begin_probe(44);
    daik::service_reference_frames(adapter::cfg);
    require(!daik::s_circulation_probe.passed, "REPLACED_TEST_CAPTURE_CANNOT_PROVE_SUCCESSOR");
}
void probe_proof_expiry() {
    prepare_inbound();
    begin_probe(42);
    feed("circulation", R"({"power":50,"time":1700000098})", true);
    daik::service_reference_frames(adapter::cfg);
    require(daik::mqtt_circulation_test_proof_valid(42, daik::s_circulation_probe.config),
            "FRESH_RETAINED_OBSERVATION_CAN_PROVE_CURRENT_MAPPING");
    sdk::ticks += 8000;
    require(daik::mqtt_circulation_test_proof_valid(42, daik::s_circulation_probe.config),
            "PROOF_IS_VALID_AT_EXISTING_INCLUSIVE_MAX_AGE");
    sdk::ticks += 1000;
    require(!daik::mqtt_circulation_test_proof_valid(42, daik::s_circulation_probe.config),
            "PROOF_EXPIRES_WITH_ORIGINAL_OBSERVATION");
    adapter::clock_shift_s = -10;
    require(!daik::mqtt_circulation_test_proof_valid(42, daik::s_circulation_probe.config),
            "CLOCK_ROLLBACK_CANNOT_EXTEND_ORIGINAL_PROOF_LIFETIME");
    adapter::clock_shift_s = 0;
    begin_probe(43);
    feed("circulation", R"({"power":50,"time":1700000109})");
    sdk::ticks += 11000;
    daik::service_reference_frames(adapter::cfg);
    require(!daik::s_circulation_probe.passed, "QUEUE_DELAY_CANNOT_REFRESH_STALE_PROBE_EVIDENCE");
}
using daik::MqttCleanupDeliveryOutcome;
using daik::MqttRetirementOwner;

void cleanup_fixture() {
    daik::s_client                 = &sdk::client;
    daik::s_mtx                    = &sdk::mutex;
    daik::s_connected              = true;
    daik::s_client_running         = true;
    daik::s_mqtt_client_epoch      = 17;
    daik::s_connected_client_epoch = 17;
    daik::s_prefix                 = "homeassistant";
    daik::s_node                   = "daikin_altherma_esp32_install";
    daik::s_board                  = "daikin_abcdef";
    daik::s_base                   = "daikin-altherma-esp32-install";
    daik::s_avail                  = "daikin-altherma-esp32-install/availability";
    daik::s_x10a                   = "daikin-altherma-esp32-install/x10a";
    daik::s_weather                = "daikin-altherma-esp32-install/weather/openmeteo/forecast";
    daik::s_modbus                 = "daikin-altherma-esp32-install/modbus";
    daik::s_env3                   = "daikin-altherma-esp32-install/env3";
    daik::s_legacy_state           = "daikin-altherma-esp32-install/state";
    daik::s_retired_modbus_status  = "daikin-altherma-esp32-install/modbus/status";
    daik::s_retired_weather        = "daikin-altherma-esp32-install/weather/forecast";
    daik::s_crash                  = "daikin-altherma-esp32-install/crash";
}

void cleanup_event(int                        id,
                   MqttCleanupDeliveryOutcome outcome = MqttCleanupDeliveryOutcome::Published,
                   uint32_t                   epoch   = 17) {
    if (epoch != 17) {
        require(daik::s_source_cleanup_evidence.push({epoch, id, outcome}),
                "CLEANUP_EVIDENCE_RING_HAS_ROOM");
        return;
    }
    esp_mqtt_event_t event{};
    event.msg_id = id;
    daik::on_mqtt(nullptr, "mqtt",
                  outcome == MqttCleanupDeliveryOutcome::Published ? MQTT_EVENT_PUBLISHED
                                                                   : MQTT_EVENT_DELETED,
                  &event);
}

void reset_cleanup_trace() {
    sdk::publish_calls = 0;
    sdk::published     = {};
}

const sdk::PublishTrace* last_accepted(const std::string& topic) {
    for (int i = sdk::publish_calls - 1; i >= 0; --i)
        if (sdk::published[i].accepted && topic == sdk::published[i].topic.data())
            return &sdk::published[i];
    return nullptr;
}
int accepted_count(const std::string& topic, const char* payload = nullptr) {
    int count = 0;
    for (int i = 0; i < sdk::publish_calls; ++i) {
        const auto& row = sdk::published[i];
        if (row.accepted && topic == row.topic.data() &&
            (!payload || std::strcmp(payload, row.payload.data()) == 0))
            ++count;
    }
    return count;
}
void independent_sources_fixture() {
    adapter::cfg.env3_enabled    = true;
    adapter::cfg.board_user_set  = true;
    adapter::cfg.board_preset_id = daik::BoardPresetId::M5StackAtomS3Lite;
    adapter::cfg.weather_enabled = true;
    adapter::modbus_enabled = adapter::modbus_live = true;
    adapter::modbus_generation                     = 8;
    daik::CachedValue row;
    row.modbus_definition = 1;
    row.off               = daik::def::homehub_definition(row.modbus_definition)->offset;
    row.value             = "1";
    adapter::modbus_values.push_back(row);
    adapter::env.fresh = adapter::env.connected = true;
    adapter::env.temperature_c                  = 17.25f;
    adapter::env.humidity_pct                   = 43;
    adapter::env.pressure_hpa                   = 1000;
    adapter::env.samples                        = 7;
    adapter::weather.configured = adapter::weather.available = adapter::weather.has_value = true;
    adapter::weather.outdoor_mean_2h_c                                                    = 7.25;
    adapter::weather.solar_energy_2h_wh_m2                                                = 150.5;
    adapter::weather.issued_unix_s  = 1700000060;
    adapter::weather.fetched_unix_s = adapter::weather.decision_unix_s = 1700000100;
    adapter::weather.state                                             = "ready";
    adapter::live_crash.reason   = static_cast<uint32_t>(daik::CrashReason::PANIC);
    adapter::live_crash.coredump = true;
    cleanup_witness::early_ack   = true;
    initial_config();
    // Inbound observations are independent of the X10A owner too.
    feed("room", R"({"temperature":20,"time":1700000100,"enabled":true})");
}
void require_independent_fresh() {
    const auto* mb  = last_accepted(daik::s_modbus);
    const auto* env = last_accepted(daik::s_env3);
    require(mb && mb->length > 2 && mb->retain == 1,
            "NEVER_SEEN_X10A_PUBLISHES_TYPED_HOMEHUB_STATE");
    require(env && std::strstr(env->payload.data(), "\"temperature_c\":17.25") && env->retain == 1,
            "NEVER_SEEN_X10A_PUBLISHES_FRESH_ENV_STATE");
    require(last_accepted(daik::s_weather) && last_accepted(daik::s_heartbeat) &&
                last_accepted(daik::s_crash),
            "NEVER_SEEN_X10A_PUBLISHES_WEATHER_HEARTBEAT_CRASH");
    require(daik::s_ref_status.has_value && daik::s_ref_status.subscribed,
            "NEVER_SEEN_X10A_SERVICES_REFERENCE_SUBSCRIPTION");
}
void transport_source_lifecycle() {
    independent_sources_fixture();
    int x10a_seed_count = 0;
    sdk::on_delay       = [&](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 45) {
            require_independent_fresh();
            require(accepted_count(daik::s_avail, "online") == 1 &&
                              accepted_count(daik::s_x10a_avail, "offline") == 1 &&
                              !last_accepted(daik::s_x10a),
                          "NEVER_SEEN_SOURCE_OFFLINE_TRANSPORT_ONLINE");
            require(std::strcmp(sdk::will_topic, daik::s_avail.c_str()) == 0 &&
                              std::strcmp(sdk::will_payload, "offline") == 0 && sdk::will_qos == 1 &&
                              sdk::will_retain == 1,
                          "INITIAL_TRANSPORT_ARMS_RETAINED_OFFLINE_LWT");
            adapter::cfg.profile = "altherma_gshp2";
            daik::s_stale_values_profile =
                adapter::cfg.profile; // earlier frozen cleanup is acknowledged
            adapter::hp.connected    = true;
            adapter::hp.last_ok_s    = 0;
            adapter::x10a_payload    = R"({"hydronic":{"flow_rate":9.0}})";
            adapter::x10a_generation = 11;
        } else if (sdk::delays == 46) {
            const auto* seed   = last_accepted(daik::s_x10a);
            const auto* online = last_accepted(daik::s_x10a_avail);
            require(seed && seed->length > 2 && online &&
                              std::strcmp(online->payload.data(), "online") == 0 && seed < online,
                          "SOURCE_ONLINE_FOLLOWS_ACCEPTED_FRESH_STATE_SEED");
            require(sdk::start_calls == 1 && sdk::init_calls == 1 && sdk::stop_calls == 0 &&
                              sdk::destroy_calls == 0,
                          "FIRST_X10A_EVIDENCE_KEEPS_SAME_LWT_TRANSPORT");
            x10a_seed_count       = accepted_count(daik::s_x10a);
            adapter::hp.connected = false;
            adapter::hp.last_ok_s = 14;
            adapter::x10a_payload.clear(); // a real empty sweep retains no new JSON
        } else if (sdk::delays == 47) {
            require(accepted_count(daik::s_x10a) == x10a_seed_count &&
                              std::strcmp(last_accepted(daik::s_x10a_avail)->payload.data(), "online") ==
                                  0,
                          "FOURTEEN_SECOND_EMPTY_SWEEP_NEITHER_FLAPS_NOR_RETAINS_EMPTY_X10A");
            adapter::hp.last_ok_s = 15;
            adapter::env.samples++;
            adapter::modbus_values[0].value = "2";
            adapter::modbus_generation++;
        } else if (sdk::delays == 48) {
            require(accepted_count(daik::s_x10a_avail, "offline") == 2 &&
                              accepted_count(daik::s_avail, "online") == 1 &&
                              accepted_count(daik::s_avail, "offline") == 0,
                          "EXACT_FIFTEEN_SECOND_OUTAGE_WITHDRAWS_ONLY_SOURCE");
            require(accepted_count(daik::s_modbus) >= 2 && accepted_count(daik::s_env3) >= 2,
                          "X10A_OUTAGE_CONTINUES_INDEPENDENT_SOURCE_PUBLICATION");
            adapter::hp.connected = true;
            adapter::hp.last_ok_s = 0;
            adapter::x10a_payload = R"({"hydronic":{"flow_rate":9.0}})";
        } else if (sdk::delays == 49) {
            require(accepted_count(daik::s_x10a) == x10a_seed_count + 1 &&
                              accepted_count(daik::s_x10a_avail, "online") == 2,
                          "RECOVERY_RESEEDS_UNCHANGED_REVISION_BEFORE_SOURCE_ONLINE");
            adapter::modbus_live = false;
            adapter::env.fresh   = false;
        } else if (sdk::delays == 50) {
            require(std::strcmp(last_accepted(daik::s_modbus)->payload.data(), "{}") == 0,
                          "HOMEHUB_EXPIRY_WITHOUT_REVISION_WITHDRAWS_RETAINED_VALUES");
            require(!std::strstr(last_accepted(daik::s_env3)->payload.data(), "temperature_c") &&
                              std::strstr(last_accepted(daik::s_env3)->payload.data(), "samples"),
                          "ENV_EXPIRY_WITHOUT_NEW_SAMPLE_WITHDRAWS_ONLY_READINGS");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void independent_source_reconnect() {
    independent_sources_fixture();
    sdk::on_delay = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 45) {
            require_independent_fresh();
            adapter::modbus_live = false;
            adapter::env.fresh   = false;
            daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DISCONNECTED, nullptr);
            daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
        } else if (sdk::delays == 46) {
            require(accepted_count(daik::s_avail, "online") == 2 &&
                        accepted_count(daik::s_x10a_avail, "offline") == 2 &&
                        accepted_count(daik::s_x10a_avail, "online") == 0,
                    "RECONNECT_RESEEDS_TRANSPORT_WITHOUT_FABRICATING_X10A_FRESHNESS");
            require(std::strcmp(last_accepted(daik::s_modbus)->payload.data(), "{}") == 0 &&
                        !std::strstr(last_accepted(daik::s_env3)->payload.data(), "temperature_c"),
                    "RECONNECT_CANNOT_RESEED_STALE_AUXILIARY_VALUES");
            require(sdk::init_calls == 1 && sdk::destroy_calls == 0 && sdk::start_calls == 1,
                    "BROKER_RECONNECT_PRESERVES_SINGLE_CLIENT_IDENTITY");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void independent_source_cutover() {
    independent_sources_fixture();
    int  mb_before = 0, env_before = 0;
    bool peer_started = false, peer_completed = false;
    sdk::on_delay = [&](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 45) {
            require_independent_fresh();
            mb_before                 = accepted_count(daik::s_modbus);
            env_before                = accepted_count(daik::s_env3);
            adapter::modbus_enabled   = false;
            adapter::cfg.env3_enabled = false;
            daik::mqtt_request_modbus_cleanup();
            cleanup_witness::early_ack = false;
        } else if (sdk::delays > 45 && !peer_started) {
            require(accepted_count(daik::s_modbus) - mb_before <= 1 &&
                        accepted_count(daik::s_env3) - env_before <= 1,
                    "DISABLED_SOURCES_CANNOT_RECREATE_RETAINED_EMPTY_OR_STALE_STATE");
            if (daik::s_source_cleanup.in_flight())
                cleanup_event(daik::s_source_cleanup.in_flight_id(),
                              MqttCleanupDeliveryOutcome::Published,
                              daik::s_mqtt_client_epoch.load());
            if (daik::s_modbus_disabled_cleaned && daik::s_env3_disabled_cleaned) {
                require(last_accepted(daik::s_modbus)->length == 0 &&
                            last_accepted(daik::s_env3)->length == 0,
                        "INDEPENDENT_DISABLE_FINISHES_ONLY_AFTER_SOURCE_CLEANUP_PUBACK");
                peer_started            = true;
                adapter::modbus_enabled = true;
                adapter::modbus_live    = false;
                daik::mqtt_request_modbus_cleanup();
                cleanup_witness::early_ack = true;
            }
        } else if (peer_started && !peer_completed &&
                   !daik::s_source_cleanup.suppress(daik::MqttCleanupSource::Modbus)) {
            // Completed-this-cycle is still suppressed; the next cycle may expose B's absence.
            if (last_accepted(daik::s_modbus)->length != 0) {
                require(std::strcmp(last_accepted(daik::s_modbus)->payload.data(), "{}") == 0,
                        "HOMEHUB_PEER_CHANGE_CANNOT_RESURRECT_PREDECESSOR_VALUES");
                adapter::modbus_values[0].value = "3";
                adapter::modbus_live            = true;
                adapter::modbus_generation++;
                peer_completed = true;
            }
        } else if (peer_completed) {
            require(last_accepted(daik::s_modbus)->length > 2 &&
                        accepted_count(daik::s_x10a_avail, "online") == 0,
                    "NEW_HOMEHUB_PEER_PUBLISHES_WITHOUT_X10A_PROOF");
            throw StopTask{};
        }
        require(sdk::delays < 150, "INDEPENDENT_SOURCE_CUTOVER_MAKES_BOUNDED_PROGRESS");
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}
void availability_retry_oom() {
    initial_config();
    adapter::hp.last_error.assign(80,
                                  'h'); // HpStats would allocate; POD withdrawal must not copy it
    sdk::fail_next_new       = true;
    sdk::reject_next_publish = true; // refuse the initial source-offline marker
    sdk::on_delay            = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 1) {
            require(daik::mqtt_skip_stats().skipped == 1 &&
                                   accepted_count(daik::s_x10a_avail, "offline") == 0,
                               "CONFIG_OOM_CANNOT_CONSUME_REJECTED_SOURCE_WITHDRAWAL");
            sdk::fail_next_new = true;
        } else if (sdk::delays == 2) {
            require(daik::mqtt_skip_stats().skipped == 2 &&
                                   accepted_count(daik::s_x10a_avail, "offline") == 1,
                               "SOURCE_WITHDRAWAL_RETRIES_BEFORE_CONFIG_COPY_OOM");
            daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DISCONNECTED, nullptr);
            daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
            std::strcpy(sdk::reject_publish_topic, daik::s_avail.c_str());
        } else if (sdk::delays == 3) {
            require(accepted_count(daik::s_avail, "online") == 1,
                               "REJECTED_TRANSPORT_ONLINE_DOES_NOT_ADVANCE_ACCEPTED_MARKER");
        } else if (sdk::delays == 4) {
            require(accepted_count(daik::s_avail, "online") == 2 &&
                                   accepted_count(daik::s_x10a_avail, "offline") == 2,
                               "TRANSPORT_ONLINE_RETRIES_AFTER_SDK_REJECTION");
            adapter::cfg.profile         = "altherma_gshp2";
            daik::s_stale_values_profile = daik::s_announced_profile = adapter::cfg.profile;
            adapter::hp.connected                                    = true;
            adapter::hp.last_ok_s                                    = 0;
            adapter::x10a_generation                                 = 2;
            adapter::x10a_payload = R"({"hydronic":{"flow_rate":9}})";
            std::strcpy(sdk::reject_publish_topic, daik::s_x10a.c_str());
        } else if (sdk::delays == 5) {
            require(accepted_count(daik::s_x10a_avail, "online") == 0 &&
                                   !daik::s_x10a_publish_proven.load(),
                               "REFUSED_X10A_SEED_CANNOT_CLAIM_SOURCE_ONLINE");
            std::strcpy(sdk::reject_publish_topic, daik::s_x10a_avail.c_str());
        } else if (sdk::delays == 6) {
            require(accepted_count(daik::s_x10a) == 1 &&
                                   accepted_count(daik::s_x10a_avail, "online") == 0,
                               "REFUSED_X10A_SEED_RETRIES_WITHOUT_NEW_REVISION");
        } else if (sdk::delays == 7) {
            require(accepted_count(daik::s_x10a) == 1 &&
                                   accepted_count(daik::s_x10a_avail, "online") == 1,
                               "SOURCE_ONLINE_RETRIES_REFUSED_MARKER_WITHOUT_DUPLICATING_ACCEPTED_SEED");
            adapter::x10a_generation = 3;
            adapter::x10a_payload    = R"({"hydronic":{"flow_rate":10}})";
            std::strcpy(sdk::reject_publish_topic, daik::s_x10a.c_str());
        } else if (sdk::delays == 8) {
            require(accepted_count(daik::s_x10a) == 1 && daik::s_last_x10a_cache_gen == 2,
                               "REFUSED_CHANGED_X10A_STATE_PRESERVES_ACCEPTED_GENERATION");
        } else if (sdk::delays == 9) {
            require(accepted_count(daik::s_x10a) == 2 && daik::s_last_x10a_cache_gen == 3,
                               "REFUSED_CHANGED_X10A_STATE_RETRIES_SAME_GENERATION");
            adapter::hp.connected = false;
            adapter::hp.last_ok_s = 15;
            std::strcpy(sdk::reject_publish_topic, daik::s_x10a_avail.c_str());
            sdk::fail_next_new = true;
            // A real in-flight ACK is drained even when Config cannot be copied this cycle.
            require(daik::s_source_cleanup.in_flight(), "CONFIG_OOM_ACK_WITNESS_HAS_INFLIGHT_ID");
            cleanup_event(daik::s_source_cleanup.in_flight_id(),
                                     MqttCleanupDeliveryOutcome::Published, daik::s_mqtt_client_epoch.load());
        } else if (sdk::delays == 10) {
            require(!daik::s_source_cleanup.in_flight() &&
                                   daik::s_source_cleanup_evidence.dropped() == 0,
                               "CONFIG_OOM_STILL_DRAINS_EXACT_CLEANUP_ACK_EVIDENCE");
            require(accepted_count(daik::s_x10a_avail, "offline") == 2,
                               "REFUSED_OUTAGE_WITHDRAWAL_KEEPS_RETRY_PENDING");
        } else if (sdk::delays == 11) {
            require(accepted_count(daik::s_x10a_avail, "offline") == 3,
                               "OUTAGE_WITHDRAWAL_RETRIES_AFTER_SDK_REJECTION_AND_OOM");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {
    } catch (const std::bad_alloc&) {
        require(false, "WITHDRAWAL_DOES_NOT_ALLOCATE_HP_STATS");
    }
}
void full_mac_identity() {
    initial_config();
    const std::string first           = sdk::client_id;
    const auto        first_documents = discovery_documents(daik::s_base, daik::s_board);
    const std::string first_device    = daik::device_json(daik::s_node, daik::s_board);
    require(first.find("daikin_altherma_esp32__board_020101010101") == 0,
            "CLIENT_ID_USES_COMPLETE_UNICAST_HARDWARE_MAC");
    esp_mqtt_client_destroy(daik::s_client); // fixture tears down the first unstarted SDK handle
    daik::s_client = nullptr;
    sdk::task_fn   = nullptr;
    sdk::mac[0]    = 4; // same final three bytes, distinct physical board
    daik::mqtt_ha_start();
    require(first != sdk::client_id &&
                first_device != daik::device_json(daik::s_node, daik::s_board),
            "MATCHING_MAC_SUFFIX_BOARDS_HAVE_DISTINCT_CLIENT_AND_DEVICE_IDS");
    for (const auto& bytes : first_documents)
        require(bytes.find(first) != std::string::npos,
                "ALL_DISCOVERY_FAMILIES_KEEP_HARDWARE_SECONDARY_DEVICE_IDENTIFIER");
    // Automatic cleanup may touch current-node frozen aliases, never either board namespace.
    daik::s_connected              = true;
    cleanup_witness::early_ack     = true;
    daik::s_connected_client_epoch = daik::s_mqtt_client_epoch.load();
    daik::retract_legacy_fixed();
    for (int i = 0; i < sdk::publish_calls; ++i)
        require(!std::strstr(sdk::published[i].topic.data(), "__board_") &&
                    !std::strstr(sdk::published[i].topic.data(), "/daikin_010101/"),
                "AUTOMATIC_RETIREMENT_NEVER_GUESSES_LEGACY_BOARD_NAMESPACE_OWNERSHIP");
}
void full_mac_read_failure() {
    adapter::cfg.mqtt_uri = "mqtt://host-witness";
    sdk::mac_result       = ESP_FAIL;
    daik::mqtt_ha_start();
    require(!sdk::task_fn && !daik::s_client && sdk::init_calls == 0 && sdk::start_calls == 0,
            "MAC_READ_FAILURE_CANNOT_START_FABRICATED_CLIENT_IDENTITY");
    require(daik::mqtt_status().error == "board MAC read failed",
            "MAC_READ_FAILURE_REPORTS_EXPLICIT_STARTUP_ERROR");
}

void legacy_retirement_delivery() {
    cleanup_fixture();
    sdk::reject_next_publish = true;
    require(!daik::retract_legacy_fixed() && !daik::s_legacy_fixed_retracted &&
                daik::s_legacy_fixed_step == 0,
            "LEGACY_REJECTED_ENQUEUE_RETAINS_CURSOR_AND_LATCH");
    require(!daik::retract_legacy_fixed() && daik::s_legacy_fixed_step == 0 &&
                !daik::s_legacy_fixed_retracted,
            "LEGACY_QUEUE_ADMISSION_IS_NOT_BROKER_ACK");
    const std::string first    = sdk::published[1].topic.data();
    const int         first_id = sdk::message_id;
    for (int i = 0; i < 4; ++i) daik::retract_legacy_fixed();
    require(sdk::publish_calls == 2, "LEGACY_MISSING_ACK_NEVER_DUPLICATES_OUTBOX_ITEM");
    cleanup_event(first_id + 100);
    cleanup_event(first_id, MqttCleanupDeliveryOutcome::Published, 16);
    daik::retract_legacy_fixed();
    require(daik::s_legacy_fixed_step == 0 && sdk::publish_calls == 2,
            "LEGACY_ONLY_EXACT_EPOCH_AND_ID_ADVANCE_CURSOR");
    daik::service_requested_topic_cleanup(adapter::cfg);
    require(sdk::publish_calls == 2 && !daik::s_source_cleanup.in_flight(),
            "SOURCE_CLEANUP_CANNOT_QUEUE_BESIDE_DISCOVERY_RETIREMENT");
    cleanup_event(first_id, MqttCleanupDeliveryOutcome::Deleted);
    daik::retract_legacy_fixed();
    require(sdk::publish_calls == 3 && sdk::published[2].topic.data() == first &&
                daik::s_legacy_fixed_step == 0,
            "LEGACY_DELETED_OUTBOX_RETRIES_SAME_CURSOR");
    const int retry_id = sdk::message_id;
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DISCONNECTED, nullptr);
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    daik::retract_legacy_fixed();
    require(sdk::publish_calls == 3, "LEGACY_SAME_CLIENT_RECONNECT_PRESERVES_OUTBOX_ITEM");
    daik::source_cleanup_outbox_cleared_after_transport_stop();
    daik::s_mqtt_client_epoch      = 18;
    daik::s_connected_client_epoch = 18;
    daik::retract_legacy_fixed();
    require(sdk::publish_calls == 4 && sdk::published[3].topic.data() == first &&
                daik::s_legacy_fixed_step == 0,
            "LEGACY_TRANSPORT_STOP_RETRIES_EXACT_UNCONFIRMED_TOPIC");
    cleanup_event(retry_id);
    daik::retract_legacy_fixed();
    require(daik::s_legacy_fixed_step == 0, "LEGACY_REPLACEMENT_IGNORES_OLD_CLIENT_ACK");
    daik::s_source_cleanup_evidence.push(
        {18, sdk::message_id, MqttCleanupDeliveryOutcome::Published});
    daik::retract_legacy_fixed();
    require(daik::s_legacy_fixed_step == 1 && !daik::s_legacy_fixed_retracted,
            "LEGACY_ACK_ADVANCES_ONLY_ONE_STEP");
    std::set<std::string> retired{first};
    for (int iterations = 0; iterations < 128 && !daik::s_legacy_fixed_retracted; ++iterations) {
        for (int i = 0; i < sdk::publish_calls; ++i) {
            const auto& row = sdk::published[i];
            require(row.length == 0 && row.qos == 1 && row.retain == 1 && row.enqueued,
                    "LEGACY_RETIREMENT_USES_TRACKED_RETAINED_QOS1");
            if (row.accepted && (std::strstr(row.topic.data(), "/device_time/config") ||
                                 std::strstr(row.topic.data(), "/wifi_quality/config") ||
                                 std::strstr(row.topic.data(), "/last_reset/config")))
                retired.insert(row.topic.data());
        }
        if (daik::s_retirement_delivery.in_flight())
            daik::s_source_cleanup_evidence.push(
                {18, daik::s_retirement_delivery.msg_id(), MqttCleanupDeliveryOutcome::Published});
        if (daik::s_source_cleanup.in_flight())
            daik::s_source_cleanup_evidence.push(
                {18, daik::s_source_cleanup.in_flight_id(), MqttCleanupDeliveryOutcome::Published});
        reset_cleanup_trace();
        daik::service_requested_topic_cleanup(adapter::cfg);
        daik::retract_legacy_fixed();
    }
    require(daik::s_legacy_fixed_retracted && !daik::s_retirement_delivery.busy(),
            "LEGACY_COMPLETE_SET_FINISHES_ONLY_AFTER_ALL_ACKS");
    require(retired.size() ==
                daik::RETIRED_HEARTBEAT_SENSOR_COUNT + daik::RETIRED_CRASH_SENSOR_COUNT,
            "LEGACY_ALL_FROZEN_HEARTBEAT_AND_CRASH_TOPICS_RETIRED");
    reset_cleanup_trace();
    daik::service_requested_topic_cleanup(adapter::cfg);
    daik::s_weather_cleanup_requested = true;
    daik::service_requested_topic_cleanup(adapter::cfg);
    require(sdk::publish_calls == 1 && daik::s_source_cleanup.in_flight(),
            "SOURCE_CLEANUP_RESUMES_AFTER_RETIREMENT");
    require(!daik::retire_exact_topic(MqttRetirementOwner::Profile, first) &&
                sdk::publish_calls == 1,
            "DISCOVERY_RETIREMENT_CANNOT_QUEUE_BESIDE_SOURCE_CLEANUP");
}

void retirement_oom_recovery() {
    cleanup_fixture();
    daik::s_prefix     = std::string(90, 'p');
    sdk::fail_next_new = true;
    bool threw         = false;
    try {
        daik::retract_legacy_fixed();
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    require(threw && sdk::publish_calls == 0 && daik::s_legacy_fixed_step == 0 &&
                !daik::s_legacy_fixed_retracted,
            "RETIREMENT_PREPARATION_OOM_RETAINS_UNSENT_CURSOR");
    sdk::reject_new_after_publish = true;
    daik::retract_legacy_fixed();
    require(sdk::publish_calls == 1 && sdk::fail_next_new &&
                daik::s_retirement_delivery.in_flight(),
            "RETIREMENT_ADMITTED_ID_COMMIT_DOES_NOT_ALLOCATE");
    threw = false;
    try {
        daik::retract_legacy_fixed();
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    require(threw && sdk::publish_calls == 1 && daik::s_legacy_fixed_step == 0 &&
                daik::s_retirement_delivery.in_flight(),
            "RETIREMENT_LATER_OOM_CANNOT_LOSE_INFLIGHT_OWNER");
    cleanup_event(sdk::message_id);
    daik::retract_legacy_fixed();
    require(daik::s_legacy_fixed_step == 1 && sdk::publish_calls == 2,
            "RETIREMENT_RECOVERS_CURSOR_AFTER_OOM_AND_EXACT_ACK");
}

void retained_probe_delivery() {
    cleanup_fixture();
    sdk::subscribe_failures[0] = true;
    daik::start_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                       daik::s_legacy_probe_active,
                                       daik::s_legacy_probe_deadline_us, "legacy state");
    require(!daik::s_legacy_probe_active, "PROBE_REJECTED_SUBSCRIBE_IS_NOT_ACTIVE");
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(daik::s_legacy_probe_active && sdk::subscribe_calls == 2,
            "PROBE_REJECTED_SUBSCRIBE_RETRIES_NEXT_SERVICE");
    feed(daik::s_legacy_state.c_str(), "old retained state", true);
    sdk::reject_next_publish = true;
    sdk::ticks += 10000;
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(daik::s_legacy_state_seen && daik::s_legacy_probe_active && sdk::unsubscribe_calls == 0,
            "PROBE_REJECTED_DELETE_PRESERVES_SEEN_AND_OWNER_PAST_DEADLINE");
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    const int id = sdk::message_id;
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(sdk::publish_calls == 2 && sdk::unsubscribe_calls == 0 && daik::s_legacy_state_seen,
            "PROBE_QUEUE_ACCEPTANCE_WAITS_FOR_ACK_WITHOUT_DUPLICATE_DELETE");
    daik::start_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                       daik::s_legacy_probe_active,
                                       daik::s_legacy_probe_deadline_us, "legacy state");
    require(daik::s_legacy_state_seen, "PROBE_RECONNECT_CANNOT_CONSUME_PENDING_RETAINED_EVIDENCE");
    cleanup_event(id);
    sdk::unsubscribe_failures[0] = true;
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(daik::s_legacy_probe_active && daik::s_legacy_state_seen && sdk::publish_calls == 2,
            "PROBE_REJECTED_UNSUBSCRIBE_PRESERVES_CONFIRMED_DELETE_OWNER");
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(!daik::s_legacy_probe_active && !daik::s_legacy_state_seen && sdk::publish_calls == 2 &&
                sdk::accepted_unsubscribe_count(daik::s_legacy_state.c_str()) == 1,
            "PROBE_CONFIRMED_DELETE_RETIRES_OWNER_ON_ACCEPTED_UNSUBSCRIBE");
    daik::start_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                       daik::s_legacy_probe_active,
                                       daik::s_legacy_probe_deadline_us, "legacy state");
    sdk::ticks += 10000;
    daik::service_retained_cleanup_probe(daik::s_legacy_state, daik::s_legacy_state_seen,
                                         daik::s_legacy_probe_active,
                                         daik::s_legacy_probe_deadline_us);
    require(sdk::publish_calls == 2 && !daik::s_legacy_probe_active,
            "PROBE_CLEAN_BROKER_IS_READ_ONLY_AND_SILENT");
}

void stale_value_retirement() {
    cleanup_fixture();
    const std::string profile = "altherma_lt_11_16kw_hydrosplit_hydro_unit";
    sdk::reject_next_publish  = true;
    daik::retract_stale_values(profile);
    require(daik::s_stale_values_step == 0 && daik::s_stale_values_profile.empty(),
            "STALE_VALUES_REJECTED_DELETE_CANNOT_LATCH_PROFILE");
    daik::retract_stale_values(profile);
    require(daik::s_stale_values_step == 0 && daik::s_stale_values_profile.empty(),
            "STALE_VALUES_QUEUE_ADMISSION_CANNOT_LATCH_PROFILE");
    std::set<std::string> retired;
    bool                  done = false;
    for (int cycles = 0; cycles < 2048 && !done; ++cycles) {
        for (int i = 0; i < sdk::publish_calls; ++i) {
            const auto& row = sdk::published[i];
            require(row.length == 0 && row.qos == 1 && row.retain == 1 && row.enqueued,
                    "STALE_VALUES_EVERY_TOPIC_USES_TRACKED_TOMBSTONE");
            if (row.accepted) retired.insert(row.topic.data());
        }
        reset_cleanup_trace();
        if (daik::s_retirement_delivery.in_flight())
            cleanup_event(daik::s_retirement_delivery.msg_id());
        done = daik::retract_stale_values(profile);
    }
    require(done && daik::s_stale_values_profile == profile && !daik::s_retirement_delivery.busy(),
            "STALE_VALUES_COMPLETE_ONLY_AFTER_ALL_EXACT_ACKS");
    require(
        retired.count(
            "homeassistant/sensor/daikin_altherma_esp32_install/actuators_fan_1_10_rpm/config") &&
            retired.count(
                "homeassistant/sensor/daikin_altherma_esp32_install/fan_1_10_rpm/config") &&
            !retired.count("homeassistant/sensor/daikin_abcdef/actuators_fan_1_10_rpm/config") &&
            !retired.count(
                "homeassistant/sensor/daikin_altherma_esp32_install/actuators_fan_1_step/config"),
        "STALE_VALUES_FROZEN_LABEL_SHAPES_NEVER_DELETE_CURRENT_GROUPED_ID");
    for (const auto& topic : retired)
        require(topic.find("/daikin_altherma_esp32_install/") != std::string::npos,
                "STALE_VALUES_ONLY_PROVEN_CURRENT_INSTALLATION_NAMESPACE");
}

std::set<std::string> fixture_profile_topics(const std::string& profile) {
    std::set<std::string> topics;
    const auto            rows = daik::def::resolved(daik::def::lookup(profile.c_str()));
    for (size_t i = 0; i < rows.count(); ++i) {
        const auto row = daik::logic::adjudicated(rows[i]);
        if (!daik::row_publishable(row) || !daik::conv_publishable(row.conv) ||
            daik::object_id(row.label).empty())
            continue;
        topics.insert(daik::discovery_topic(daik::s_prefix, daik::s_node, row));
        if (row.conv == 203)
            for (size_t k = 0; k < daik::FAULT_COMPANION_COUNT; ++k)
                topics.insert(daik::companion_discovery_topic(daik::s_prefix, daik::s_node,
                                                              daik::group_for_page(row.reg),
                                                              daik::FAULT_COMPANIONS[k].key));
    }
    return topics;
}

void profile_cutover_delivery() {
    cleanup_fixture();
    require(daik::mqtt_retirement_record_make(retirement_witness::durable, daik::s_base,
                                              daik::s_board, "altherma3_r_erga"),
            "PROFILE_FIXTURE_HAS_SCOPED_DURABLE_PREDECESSOR");
    retirement_witness::result = daik::MqttRetirementStoreLoad::Ready;
    daik::s_discovered_profile = "altherma3_r_erga";
    daik::s_announced_profile
        .clear(); // actual reconnect used to lose the only prior-profile record
    adapter::cfg.profile             = "protocol_s";
    daik::s_stale_values_profile     = adapter::cfg.profile;
    const auto            old_topics = fixture_profile_topics(daik::s_discovered_profile);
    const auto            new_topics = fixture_profile_topics(adapter::cfg.profile);
    std::set<std::string> expected;
    for (const auto& topic : old_topics)
        if (!new_topics.count(topic)) expected.insert(topic);
    require(!expected.empty(), "PROFILE_FIXTURE_HAS_REAL_OBSOLETE_GROUPED_CONFIGS");
    sdk::reject_next_publish = true;
    require(!daik::publish_x10a_discovery() && daik::s_discovered_profile == "altherma3_r_erga",
            "PROFILE_REJECTED_RETIREMENT_BLOCKS_REPLACEMENT_DISCOVERY");
    const auto old_rows = daik::def::resolved(daik::def::lookup("altherma3_r_erga"));
    require(daik::s_retiring_profile_row < old_rows.count() &&
                daik::s_retiring_profile_shape == 0 &&
                daik::discovery_topic(
                    daik::s_prefix, daik::s_node,
                    daik::logic::adjudicated(old_rows[daik::s_retiring_profile_row])) ==
                    sdk::published[0].topic.data(),
            "PROFILE_REJECTED_RETIREMENT_RETAINS_EXACT_CURSOR");
    require(sdk::publish_calls == 1 && sdk::published[0].length == 0,
            "PROFILE_REPLACEMENT_WAITING_EMITS_NO_CONFIG");
    std::set<std::string> deleted, published;
    bool                  complete = false;
    for (int cycles = 0; cycles < 1024 && !complete; ++cycles) {
        for (int i = 0; i < sdk::publish_calls; ++i) {
            const auto& row = sdk::published[i];
            if (row.length == 0) {
                require(row.qos == 1 && row.retain == 1 && row.enqueued,
                        "PROFILE_OBSOLETE_CONFIG_USES_TRACKED_QOS1_TOMBSTONE");
                if (row.accepted) deleted.insert(row.topic.data());
            } else {
                require(daik::s_current_profile_retired == adapter::cfg.profile &&
                            !daik::s_retirement_delivery.busy(),
                        "PROFILE_EVERY_REPLACEMENT_FOLLOWS_CONFIRMED_RETIREMENT");
                published.insert(row.topic.data());
            }
        }
        reset_cleanup_trace();
        if (daik::s_retirement_delivery.in_flight())
            cleanup_event(daik::s_retirement_delivery.msg_id());
        complete = daik::publish_x10a_discovery();
    }
    for (int i = 0; i < sdk::publish_calls; ++i)
        if (sdk::published[i].length != 0) published.insert(sdk::published[i].topic.data());
    require(complete && daik::s_discovered_profile == adapter::cfg.profile,
            "PROFILE_REPLACEMENT_DISCOVERY_COMPLETES_AFTER_ACKS");
    for (const auto& topic : expected)
        require(deleted.count(topic), "PROFILE_ALL_OBSOLETE_GROUPED_AND_COMPANION_CONFIGS_RETIRED");
    for (const auto& topic : new_topics)
        require(!deleted.count(topic), "PROFILE_COMMON_OR_NEW_CURRENT_CONFIG_IS_NEVER_RETRACTED");
    require(published == new_topics,
            "PROFILE_REPLACEMENT_PUBLISHES_COMPLETE_CURRENT_DISCOVERY_SET");
    require(deleted.count("homeassistant/binary_sensor/daikin_altherma_esp32_install/"
                          "outdoor_state_error_active/config"),
            "PROFILE_OBSOLETE_FAULT_COMPANION_IS_RETIRED");
}

void periodic_discovery_delivery() {
    cleanup_fixture();
    daik::s_source_cleanup.reconstruct_for_client(17);
    for (int id = 1;; ++id) {
        const auto action = daik::s_source_cleanup.next_action(true, false);
        if (!action) break;
        require(daik::s_source_cleanup.publish_queued(17, id) &&
                    daik::s_source_cleanup.acknowledge({17, id}),
                "PERIODIC_FIXTURE_STARTS_WITH_CONVERGED_SOURCE_SCHEDULER");
        daik::s_source_cleanup.take_completion();
    }
    daik::s_source_cleanup.begin_cycle();
    std::set<std::string> expected, deleted;
    for (const auto& row : daik::RETIRED_MODBUS_HA_SENSORS)
        expected.insert(daik::retired_modbus_discovery_topic(daik::s_prefix, daik::s_node, row));
    for (const auto& row : daik::RETIRED_WEATHER_HA_SENSORS)
        expected.insert(daik::retired_weather_discovery_topic(daik::s_prefix, daik::s_node, row));
    daik::request_periodic_discovery_retirement();
    sdk::reject_next_publish = true;
    daik::service_periodic_discovery_retirement();
    require(daik::s_periodic_discovery_step == 0 && daik::s_periodic_discovery_pending &&
                !daik::s_retirement_delivery.busy(),
            "PERIODIC_REJECTED_DELETE_CANNOT_ADVANCE_LEDGER");
    daik::service_periodic_discovery_retirement();
    const std::string first = sdk::published[1].topic.data();
    const int         id    = sdk::message_id;
    for (int i = 0; i < 4; ++i) daik::service_periodic_discovery_retirement();
    require(daik::s_periodic_discovery_step == 0 && sdk::publish_calls == 2 &&
                daik::s_retirement_delivery.in_flight(),
            "PERIODIC_QUEUE_ACCEPTANCE_WAITS_FOR_EXACT_PUBACK");
    cleanup_event(id + 100);
    cleanup_event(id, MqttCleanupDeliveryOutcome::Published, 16);
    daik::service_periodic_discovery_retirement();
    require(daik::s_periodic_discovery_step == 0 && sdk::publish_calls == 2,
            "PERIODIC_WRONG_ID_OR_EPOCH_NEVER_ADVANCES_LEDGER");
    cleanup_event(id, MqttCleanupDeliveryOutcome::Deleted);
    daik::service_periodic_discovery_retirement();
    require(daik::s_periodic_discovery_step == 0 && sdk::publish_calls == 3 &&
                sdk::published[2].topic.data() == first,
            "PERIODIC_OUTBOX_EXPIRY_RETRIES_SAME_EXACT_TOPIC");
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_DISCONNECTED, nullptr);
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    daik::service_periodic_discovery_retirement();
    require(sdk::publish_calls == 3 && daik::s_periodic_discovery_step == 0,
            "PERIODIC_SAME_CLIENT_RECONNECT_PRESERVES_INFLIGHT_CURSOR");
    daik::request_periodic_discovery_retirement();
    daik::s_env3_cleanup_requested = true;
    cleanup_event(sdk::message_id);
    daik::service_requested_topic_cleanup(adapter::cfg);
    require(daik::s_source_cleanup.in_flight() && !daik::s_retirement_delivery.in_flight() &&
                daik::s_periodic_discovery_pending && daik::s_periodic_discovery_step == 1,
            "PERIODIC_ACK_YIELDS_NEXT_SLOT_TO_SOURCE_WITHDRAWAL");
    reset_cleanup_trace();
    int source_acks = 0;
    for (int cycles = 0;
         cycles < 256 && (daik::s_periodic_discovery_pending || daik::s_source_cleanup.in_flight());
         ++cycles) {
        if (daik::s_retirement_delivery.in_flight())
            cleanup_event(daik::s_retirement_delivery.msg_id());
        if (daik::s_source_cleanup.in_flight()) {
            cleanup_event(daik::s_source_cleanup.in_flight_id());
            ++source_acks;
        }
        daik::service_requested_topic_cleanup(adapter::cfg);
        require(!daik::s_source_cleanup.in_flight() || !daik::s_retirement_delivery.in_flight(),
                "PERIODIC_AND_SOURCE_HAVE_ONE_GLOBAL_CLEANUP_OUTBOX_ITEM");
        for (int i = 0; i < sdk::publish_calls; ++i) {
            const auto& row = sdk::published[i];
            require(row.length == 0 && row.qos == 1 && row.retain == 1 && row.enqueued,
                    "PERIODIC_EVERY_RETIREMENT_IS_TRACKED_QOS1");
            const std::string topic = row.topic.data();
            if (expected.count(topic) && row.accepted)
                deleted.insert(topic);
            else
                require(topic == daik::s_env3 || topic.find("/env3_") != std::string::npos,
                        "PERIODIC_LEDGER_NEVER_DELETES_CURRENT_OR_FOREIGN_TOPIC");
        }
        reset_cleanup_trace();
    }
    require(!daik::s_periodic_discovery_pending && deleted == expected && source_acks == 4,
            "PERIODIC_FROZEN_HOMEHUB_WEATHER_LEDGER_AND_QUEUED_RECONNECT_COMPLETE");
    daik::request_periodic_discovery_retirement();
    daik::service_periodic_discovery_retirement();
    require(daik::s_retirement_delivery.in_flight(), "PERIODIC_STOP_FIXTURE_HAS_PENDING_ITEM");
    const std::string stopped = sdk::published[0].topic.data();
    daik::source_cleanup_outbox_cleared_after_transport_stop();
    daik::on_mqtt(nullptr, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    daik::service_periodic_discovery_retirement();
    require(sdk::publish_calls == 2 && sdk::published[1].topic.data() == stopped &&
                daik::s_periodic_discovery_step == 0,
            "PERIODIC_STOPPED_TRANSPORT_RETRIES_WITHOUT_FORGETTING_LEDGER");
}

void periodic_discovery_task_timer() {
    independent_sources_fixture();
    bool timer_seen = false;
    int  pending_id = -1;
    sdk::on_delay   = [&](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 290) cleanup_witness::early_ack = false;
        if (sdk::delays >= 290 &&
            daik::s_retirement_delivery.owner() == MqttRetirementOwner::PeriodicDiscovery) {
            if (!timer_seen) {
                timer_seen = true;
                pending_id = daik::s_retirement_delivery.msg_id();
                adapter::env.samples++;
                adapter::env.temperature_c = 18.25f;
            } else {
                require(daik::s_retirement_delivery.msg_id() == pending_id &&
                              daik::s_periodic_discovery_step == 0,
                          "PERIODIC_TASK_TIMER_RETAINS_MISSING_ACK_ITEM");
                require(last_accepted(daik::s_env3) != nullptr,
                          "PERIODIC_TASK_WAITING_ACK_STILL_PUBLISHES_CURRENT_SOURCE");
                throw StopTask{};
            }
        }
        if (sdk::delays == 350) {
            require(timer_seen, "PERIODIC_TASK_TIMER_REQUESTS_LEDGER_AFTER_INTERVAL");
            throw StopTask{};
        }
        reset_cleanup_trace();
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
    require(timer_seen, "PERIODIC_TASK_TIMER_REQUESTS_LEDGER_AFTER_INTERVAL");
}

void profile_return_during_retirement() {
    initial_config("daikin-altherma-esp32-install");
    const std::string prior       = "altherma_gshp2";
    const std::string replacement = "generic";
    require(daik::mqtt_retirement_record_make(retirement_witness::durable, daik::s_base,
                                              daik::s_board, prior),
            "PROFILE_RETURN_FIXTURE_HAS_DURABLE_REAL_GSHP_PREDECESSOR");
    retirement_witness::result = daik::MqttRetirementStoreLoad::Ready;
    daik::s_discovered_profile = daik::s_announced_profile = daik::s_current_profile_retired =
        prior;
    daik::s_stale_values_profile = prior;
    adapter::cfg.profile         = prior;
    adapter::hp.connected        = true;
    adapter::hp.last_ok_s        = 0;
    adapter::x10a_payload        = R"({"hydronic":{"flow_rate":9}})";
    adapter::x10a_generation     = 7;
    const std::string brine      = daik::s_prefix + "/sensor/" + daik::s_node +
                              "/outdoor_sensors_entering_brine_temp_r5t/config";
    const auto            expected    = fixture_profile_topics(prior);
    bool                  requested_q = false, switched_back = false, brine_deleted = false;
    bool                  brine_refused = false, source_check = false;
    std::set<std::string> reannounced;
    sdk::on_delay = [&](TickType_t delay) {
        check_cycle(delay);
        for (int i = 0; i < sdk::publish_calls; ++i) {
            const auto& row = sdk::published[i];
            if (row.accepted && row.length == 0 && brine == row.topic.data()) brine_deleted = true;
            if (requested_q && expected.count(row.topic.data()) && row.length > 0) {
                require(switched_back && daik::s_retiring_profile_target.empty(),
                        "PROFILE_RETURN_NEVER_REANNOUNCES_BEFORE_FROZEN_RETIREMENT_FINISHES");
                if (row.accepted)
                    reannounced.insert(row.topic.data());
                else if (brine == row.topic.data())
                    brine_refused = true;
            }
        }
        if (!requested_q && daik::s_announced_profile == prior) {
            adapter::cfg.profile         = replacement;
            daik::s_stale_values_profile = replacement;
            requested_q                  = true;
        }
        if (daik::s_source_cleanup.in_flight())
            cleanup_event(daik::s_source_cleanup.in_flight_id(),
                          MqttCleanupDeliveryOutcome::Published, daik::s_mqtt_client_epoch.load());
        if (daik::s_retirement_delivery.in_flight()) {
            const int id = daik::s_retirement_delivery.msg_id();
            if (!switched_back && brine_deleted) {
                adapter::cfg.profile         = prior;
                daik::s_stale_values_profile = prior;
                switched_back                = true;
                adapter::x10a_generation++;
                adapter::x10a_payload = R"({"hydronic":{"flow_rate":10}})";
                std::snprintf(sdk::reject_publish_topic, sizeof(sdk::reject_publish_topic), "%s",
                              brine.c_str());
                source_check = true;
                reset_cleanup_trace();
                return; // hold the queued brine delete's ACK across the return to P
            }
            if (switched_back && brine_deleted)
                require(reannounced.empty() && daik::s_retiring_profile_target == replacement,
                        "PROFILE_RETURN_CACHED_P_CANNOT_BYPASS_FROZEN_Q_JOB");
            if (source_check) {
                require(last_accepted(daik::s_x10a) != nullptr,
                        "PROFILE_RETURN_WAITING_DELETE_ACK_STILL_PUBLISHES_CURRENT_X10A");
                source_check = false;
            }
            cleanup_event(id, MqttCleanupDeliveryOutcome::Published,
                          daik::s_mqtt_client_epoch.load());
        }
        if (switched_back && daik::s_announced_profile == prior && brine_deleted) {
            require(reannounced == expected,
                    "PROFILE_RETURN_REANNOUNCES_ALL_P_CONFIGS_AFTER_DELAYED_DELETE_ACKS");
            require(brine_refused, "PROFILE_RETURN_REJECTED_BRINE_CONFIG_RETRIES_FULL_DISCOVERY");
            require(std::strcmp(retirement_witness::durable.profile_id, prior.c_str()) == 0,
                    "PROFILE_RETURN_JOURNAL_NEVER_FORGETS_LAST_POSSIBLY_ANNOUNCED_P");
            throw StopTask{};
        }
        require(sdk::delays < 1024, "PROFILE_RETURN_COMPLETES_WITH_BOUNDED_CURSOR_RETRIES");
        reset_cleanup_trace();
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
    require(brine_deleted && switched_back && reannounced.count(brine),
            "PROFILE_RETURN_REAL_ENTERING_BRINE_ENTITY_IS_RESTORED");
}

void profile_retirement_scan_bounds() {
    cleanup_fixture();
    const std::string previous = "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw";
    const std::string target   = "altherma_ebla_edla_d_series_4_8kw_monobloc";
    daik::s_discovered_profile = previous;
    auto prepare               = [&] {
        daik::s_retiring_profile_target        = target;
        daik::s_retiring_current_unpublishable = false;
        daik::s_retiring_profile_row           = 128;
        daik::s_retiring_profile_shape         = 0;
        daik::s_retiring_identity_ready        = false;
        daik::s_retiring_scan                  = {};
    };
    prepare();
    require(!daik::retract_profile_cutover(target) && daik::s_retiring_profile_row == 128 &&
                daik::s_retiring_scan.row == 127 &&
                daik::s_retiring_scan.result == daik::MqttRetirementPresence::Pending &&
                sdk::publish_calls == 0,
            "PROFILE_SCANNER_WORK_SLICE_CANNOT_DECLARE_PARTIAL_REPLACEMENT_ABSENT");
    prepare();
    sdk::fail_next_new = true;
    bool failed        = false;
    try {
        daik::retract_profile_cutover(target);
    } catch (const std::bad_alloc&) {
        failed = true;
    }
    const bool still_armed = sdk::fail_next_new;
    sdk::fail_next_new     = false;
    require(!failed && still_armed && sdk::publish_calls == 0 && daik::s_retiring_scan.row == 127,
            "PROFILE_SCANNER_PENDING_COMPARISONS_AND_PREPARATION_ALLOCATE_NOTHING");
    daik::retract_profile_cutover(target);
    require(daik::s_retiring_profile_row > 128 && sdk::publish_calls == 0,
            "PROFILE_SCANNER_RESUMES_AND_PRESERVES_LATE_COMMON_GROUPED_CONFIG");
}

void retirement_early_ack() {
    cleanup_fixture();
    cleanup_witness::early_ack = true;
    const std::string topic    = daik::s_legacy_state;
    require(daik::retire_exact_topic(MqttRetirementOwner::LegacyProbe, topic) &&
                !daik::s_retirement_delivery.busy() && sdk::publish_calls == 1,
            "RETIREMENT_ACK_BEFORE_ENQUEUE_RETURN_IS_PRESERVED");
    cleanup_witness::early_ack = false;
    daik::retire_exact_topic(MqttRetirementOwner::LegacyProbe, topic);
    for (int i = 0; i < 32; ++i) cleanup_event(sdk::message_id + 100 + i);
    cleanup_event(sdk::message_id);
    require(daik::s_source_cleanup_evidence_lost, "RETIREMENT_EVIDENCE_OVERFLOW_REPORTS_LOSS");
    daik::service_source_cleanup_evidence();
    require(daik::s_retirement_delivery.in_flight(),
            "RETIREMENT_LOST_ACK_NEVER_ADVANCES_OR_DUPLICATES");
    require(daik::mqtt_cleanup_evidence_recovery_step(1) &&
                !daik::s_retirement_delivery.in_flight(),
            "RETIREMENT_EVIDENCE_RECOVERY_STOPS_TRANSPORT_BEFORE_RETRY");
}

void retirement_after_gate_withdrawal() {
    cleanup_fixture();
    const std::string prior = "altherma3_r_erga";
    daik::retract_stale_values(prior);
    require(daik::s_retirement_delivery.in_flight(), "WITHDRAWAL_FIXTURE_HAS_STARTED_RETIREMENT");
    adapter::cfg.profile = "auto"; // replacement discovery cannot run while detection is pending
    bool interrupted     = false;
    int  source_acks     = 0;
    for (int cycles = 0; cycles < 512 && !daik::s_stale_values_pending_profile.empty(); ++cycles) {
        reset_cleanup_trace();
        if (daik::s_retirement_delivery.in_flight())
            cleanup_event(daik::s_retirement_delivery.msg_id());
        if (daik::s_source_cleanup.in_flight()) {
            cleanup_event(daik::s_source_cleanup.in_flight_id());
            ++source_acks;
        }
        daik::service_requested_topic_cleanup(
            adapter::cfg); // actual pre-publish-gate production step
        interrupted = interrupted || daik::s_source_cleanup.in_flight();
        require(!daik::s_source_cleanup.in_flight() || !daik::s_retirement_delivery.in_flight(),
                "WITHDRAWAL_CLEANUP_STILL_HAS_ONE_GLOBAL_OUTBOX_ITEM");
        for (int i = 0; i < sdk::publish_calls; ++i)
            require(sdk::published[i].length == 0,
                    "WITHDRAWAL_COMPLETION_DOES_NOT_EMIT_REPLACEMENT_DISCOVERY");
    }
    require(daik::s_stale_values_pending_profile.empty() && daik::s_stale_values_profile == prior &&
                !daik::s_retirement_delivery.busy() && interrupted &&
                source_acks == daik::MQTT_SOURCE_CLEANUP_MAX_STEPS,
            "WITHDRAWAL_FROZEN_RETIREMENT_FINISHES_AND_UNBLOCKS_SOURCE_CLEANUP");
}

void journal_seed(const char* profile, const char* base = nullptr, const char* board = nullptr) {
    require(daik::mqtt_retirement_record_make(retirement_witness::durable,
                                              base ? base : daik::s_base.c_str(),
                                              board ? board : daik::s_board.c_str(), profile),
            "JOURNAL_FIXTURE_RECORD_HAS_BOUNDED_VALID_FIELDS");
    retirement_witness::result = daik::MqttRetirementStoreLoad::Ready;
}

void journal_discovery_trace(const sdk::PublishTrace& row) {
    if (row.length == 0) return;
    require((daik::mqtt_retirement_evidence() & 0x080) != 0 &&
                retirement_witness::result == daik::MqttRetirementStoreLoad::Ready &&
                std::strcmp(retirement_witness::durable.profile_id, adapter::cfg.profile.c_str()) ==
                    0,
            "JOURNAL_CURRENT_RECORD_DURABLE_BEFORE_FIRST_DISCOVERY_SDK_EFFECT");
}

void journal_reboot_volatile_state() {
    // Emulate a fresh MQTT TU's volatile globals after producer stop; only the model's durable
    // record and broker ACKed tombstones survive. This is not a physical reboot/power-loss claim.
    daik::source_cleanup_outbox_cleared_after_transport_stop();
    daik::s_retirement_delivery = {};
    daik::s_source_cleanup      = {};
    daik::s_discovered_profile.clear();
    daik::s_announced_profile.clear();
    daik::s_retiring_profile_target.clear();
    daik::s_retiring_profile_row = daik::s_retiring_profile_shape = 0;
    daik::s_retiring_current_unpublishable                        = false;
    daik::s_retiring_identity_ready                               = false;
    daik::s_retiring_scan                                         = {};
    daik::s_periodic_discovery_pending = daik::s_periodic_discovery_again = false;
    daik::s_periodic_discovery_step                                       = 0;
    daik::s_current_profile_retired.clear();
    daik::s_stale_values_pending_profile.clear();
    daik::s_stale_values_profile.clear();
    daik::s_stale_values_step       = 0;
    daik::s_retirement_store_loaded = daik::s_retirement_store_scoped = false;
    daik::s_retirement_record = daik::s_retirement_staged = {};
    daik::s_retirement_load_retry_us = daik::s_retirement_save_retry_us = 0;
    daik::s_retirement_evidence                                         = 0;
    daik::s_retirement_log_state                                        = UINT32_MAX;
    daik::s_mqtt_client_epoch++;
    daik::s_connected_client_epoch = daik::s_mqtt_client_epoch.load();
    reset_cleanup_trace();
}

std::set<std::string> journal_obsolete_topics(const char* previous, const char* current) {
    const auto            old_topics = fixture_profile_topics(previous);
    const auto            new_topics = fixture_profile_topics(current);
    std::set<std::string> expected;
    for (const auto& topic : old_topics)
        if (!new_topics.count(topic)) expected.insert(topic);
    retirement_witness::expected_ack_count = static_cast<int>(expected.size());
    return expected;
}

void journal_ack_current(const std::set<std::string>& expected,
                         std::set<std::string>&       acknowledged) {
    if (!daik::s_retirement_delivery.in_flight()) return;
    const sdk::PublishTrace* trace = nullptr;
    for (int i = sdk::publish_calls - 1; i >= 0; --i)
        if (sdk::published[i].accepted && sdk::published[i].enqueued) {
            trace = &sdk::published[i];
            break;
        }
    require(trace != nullptr, "JOURNAL_ACK_MATCHES_ACTUALLY_ADMITTED_TOMBSTONE");
    const std::string topic = trace->topic.data();
    cleanup_event(daik::s_retirement_delivery.msg_id(), MqttCleanupDeliveryOutcome::Published,
                  daik::s_mqtt_client_epoch.load());
    if (expected.count(topic)) acknowledged.insert(topic);
    retirement_witness::observed_ack_count = static_cast<int>(acknowledged.size());
}

bool journal_drive(const std::set<std::string>& expected, std::set<std::string>& acknowledged) {
    for (int cycle = 0; cycle < 2048; ++cycle) {
        journal_ack_current(expected, acknowledged);
        reset_cleanup_trace();
        if (daik::publish_x10a_discovery()) return true;
        if (daik::mqtt_retirement_evidence() & 0x020) return false;
    }
    return false;
}

void journal_reboot_mid_retirement() {
    cleanup_fixture();
    journal_seed("altherma3_r_erga");
    adapter::cfg.profile           = "protocol_s";
    daik::s_stale_values_profile   = adapter::cfg.profile;
    const auto            expected = journal_obsolete_topics("altherma3_r_erga", "protocol_s");
    std::set<std::string> acknowledged;
    sdk::on_publish          = journal_discovery_trace;
    sdk::reject_next_publish = true;
    require(!daik::publish_x10a_discovery() && retirement_witness::save_calls == 0 &&
                (daik::mqtt_retirement_evidence() & 0x001),
            "JOURNAL_READY_PREDECESSOR_LOADED_BEFORE_REJECTED_RETIREMENT");
    require(adapter::cfg.profile == "protocol_s" &&
                daik::s_discovered_profile == "altherma3_r_erga",
            "JOURNAL_LOADED_PREDECESSOR_NEVER_RESTORES_ACTIVE_DETECTION");
    reset_cleanup_trace();
    daik::publish_x10a_discovery();
    journal_ack_current(expected, acknowledged);
    reset_cleanup_trace();
    daik::publish_x10a_discovery();
    require(!acknowledged.empty() && acknowledged.size() < expected.size() &&
                retirement_witness::save_calls == 0 &&
                std::strcmp(retirement_witness::durable.profile_id, "altherma3_r_erga") == 0,
            "JOURNAL_PARTIAL_ACK_CURSOR_CANNOT_REPLACE_DURABLE_PREDECESSOR");
    journal_reboot_volatile_state();
    daik::s_stale_values_profile = adapter::cfg.profile;
    require(journal_drive(expected, acknowledged),
            "JOURNAL_REBOOT_RELOAD_RESTARTS_IDEMPOTENT_PREDECESSOR_RETIREMENT");
    require(retirement_witness::load_calls == 2 && acknowledged == expected &&
                !retirement_witness::save_before_retirement && retirement_witness::save_calls == 1,
            "JOURNAL_ALL_PREDECESSOR_ACKS_PRECEDE_TARGET_SAVE_ACROSS_REBOOT");
    require((daik::mqtt_retirement_evidence() & 0x081) == 0x081 &&
                std::strcmp(retirement_witness::durable.profile_id, "protocol_s") == 0,
            "JOURNAL_REBOOT_LOAD_AND_CURRENT_DURABILITY_HAVE_SEPARATE_EVIDENCE");
}

void journal_reboot_after_save() {
    cleanup_fixture();
    adapter::cfg.profile         = "protocol_s";
    daik::s_stale_values_profile = adapter::cfg.profile;
    std::set<std::string> empty, acknowledged;
    sdk::on_publish                           = journal_discovery_trace;
    retirement_witness::reject_new_after_save = true;
    bool threw                                = false;
    try {
        journal_drive(empty, acknowledged);
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    require(threw && retirement_witness::save_calls == 1 &&
                std::strcmp(retirement_witness::durable.profile_id, "protocol_s") == 0,
            "JOURNAL_SAVE_SURVIVES_FAILURE_BEFORE_FIRST_DISCOVERY_BUILD");
    require((daik::mqtt_retirement_evidence() & 0x001) == 0 &&
                (daik::mqtt_retirement_evidence() & 0x080),
            "JOURNAL_SAME_BOOT_SAVE_CANNOT_CLAIM_REBOOT_RESTORATION");
    journal_reboot_volatile_state();
    daik::s_stale_values_profile = adapter::cfg.profile;
    require(journal_drive(empty, acknowledged) && retirement_witness::save_calls == 1 &&
                (daik::mqtt_retirement_evidence() & 0x001),
            "JOURNAL_REBOOT_AFTER_SAVE_LOADS_TARGET_WITHOUT_ERASING_OR_REWRITING_IT");
    sdk::reject_next_publish = true;
    reset_cleanup_trace();
    require(!daik::publish_x10a_discovery(), "JOURNAL_REFUSED_DISCOVERY_REMAINS_UNANNOUNCED");
    reset_cleanup_trace();
    require(daik::publish_x10a_discovery() && retirement_witness::save_calls == 1,
            "JOURNAL_DISCOVERY_SDK_RETRY_DOES_NOT_REWRITE_DURABLE_METADATA");
}

void journal_commit_write_through_failure() {
    cleanup_fixture();
    journal_seed("altherma3_r_erga");
    adapter::cfg.profile           = "protocol_s";
    daik::s_stale_values_profile   = adapter::cfg.profile;
    const auto            expected = journal_obsolete_topics("altherma3_r_erga", "protocol_s");
    std::set<std::string> acknowledged;
    sdk::on_publish                           = journal_discovery_trace;
    retirement_witness::save_failures         = 1;
    retirement_witness::write_through_failure = true;
    require(!journal_drive(expected, acknowledged) && acknowledged == expected &&
                !retirement_witness::save_before_retirement,
            "JOURNAL_FAILED_COMMIT_WRITE_THROUGH_CANNOT_FORGET_UNRETIRED_PREDECESSOR");
    require((daik::mqtt_retirement_evidence() & 0x020) &&
                !(daik::mqtt_retirement_evidence() & 0x080) &&
                daik::s_discovered_profile == "altherma3_r_erga" &&
                std::strcmp(retirement_witness::durable.profile_id, "protocol_s") == 0,
            "JOURNAL_FAILED_COMMIT_BLOCKS_DISCOVERY_DESPITE_WRITE_THROUGH");
    const int saves = retirement_witness::save_calls;
    for (int i = 0; i < 20; ++i) {
        daik::publish_x10a_discovery();
        require(retirement_witness::save_calls == saves,
                "JOURNAL_FAILED_SAVE_RETRY_IS_TIME_BOUNDED");
    }
    require(retirement_witness::save_calls == saves, "JOURNAL_FAILED_SAVE_RETRY_IS_TIME_BOUNDED");
    journal_reboot_volatile_state();
    daik::s_stale_values_profile = adapter::cfg.profile;
    require(journal_drive(expected, acknowledged) && retirement_witness::save_calls == saves &&
                acknowledged == expected,
            "JOURNAL_REBOOT_AFTER_FAILED_COMMIT_NEEDS_NO_FORGOTTEN_PREDECESSOR_DELETES");
    adapter::cfg.profile          = "altherma3_r_erga";
    daik::s_stale_values_profile  = adapter::cfg.profile;
    const auto            reverse = journal_obsolete_topics("protocol_s", "altherma3_r_erga");
    std::set<std::string> reverse_acknowledged;
    retirement_witness::observed_ack_count    = 0;
    retirement_witness::save_failures         = 1;
    retirement_witness::write_through_failure = false;
    require(!journal_drive(reverse, reverse_acknowledged) &&
                std::strcmp(retirement_witness::durable.profile_id, "protocol_s") == 0,
            "JOURNAL_REJECTED_SAVE_PRESERVES_PRIOR_DURABLE_RECORD");
    sdk::ticks += 5000;
    require(journal_drive(reverse, reverse_acknowledged) &&
                !(daik::mqtt_retirement_evidence() & 0x020) &&
                std::strcmp(retirement_witness::durable.profile_id, "altherma3_r_erga") == 0,
            "JOURNAL_FAILED_SAVE_RECOVERS_AFTER_BOUNDED_RETRY_WITHOUT_REBOOT");
}

void journal_load_errors() {
    cleanup_fixture();
    adapter::cfg.profile       = "protocol_s";
    retirement_witness::result = daik::MqttRetirementStoreLoad::Error;
    for (int i = 0; i < 20; ++i)
        require(!daik::publish_x10a_discovery(), "JOURNAL_LOAD_ERROR_DEFERS_DISCOVERY");
    require(retirement_witness::load_calls == 1 && retirement_witness::save_calls == 0 &&
                sdk::publish_calls == 0 && adapter::retirement_logs == 1 &&
                (daik::mqtt_retirement_evidence() & 0x008),
            "JOURNAL_LOAD_ERROR_RETRIES_AND_LOGS_ONLY_AT_BOUNDED_TRANSITIONS");
    sdk::ticks += 5000;
    retirement_witness::result = daik::MqttRetirementStoreLoad::Incompatible;
    require(!daik::publish_x10a_discovery() && retirement_witness::save_calls == 0 &&
                (daik::mqtt_retirement_evidence() & 0x010),
            "JOURNAL_CORRUPTION_NEVER_INITIALIZES_OR_OVERWRITES_METADATA");
    sdk::ticks += 5000;
    journal_seed("unknown_retired_profile");
    require(!daik::publish_x10a_discovery() && retirement_witness::save_calls == 0 &&
                sdk::publish_calls == 0,
            "JOURNAL_UNKNOWN_PROFILE_NEVER_FALLS_BACK_TO_FABRICATED_GENERIC_RETIREMENT");
    sdk::ticks += 5000;
    journal_seed("altherma3_r_erga");
    daik::s_stale_values_profile   = adapter::cfg.profile;
    const auto            expected = journal_obsolete_topics("altherma3_r_erga", "protocol_s");
    std::set<std::string> acknowledged;
    require(journal_drive(expected, acknowledged) && !(daik::mqtt_retirement_evidence() & 0x018),
            "JOURNAL_LOAD_FAILURE_RECOVERS_WITHOUT_ERASING_OWNER_RECORD");
}

void journal_foreign_scope(bool board_only = false) {
    cleanup_fixture();
    journal_seed("altherma3_r_erga",
                 board_only ? daik::s_base.c_str() : "daikin-altherma-esp32-other",
                 board_only ? "daikin_altherma_esp32__board_040404040404" : daik::s_board.c_str());
    adapter::cfg.profile         = "protocol_s";
    daik::s_stale_values_profile = adapter::cfg.profile;
    std::set<std::string> empty, acknowledged;
    sdk::on_publish = journal_discovery_trace;
    require(journal_drive(empty, acknowledged),
            "JOURNAL_FOREIGN_OWNER_CAN_MIGRATE_ONLY_CURRENT_NAMESPACE");
    require((daik::mqtt_retirement_evidence() & 0x104) == 0x104 &&
                !(daik::mqtt_retirement_evidence() & 0x001) &&
                std::strcmp(retirement_witness::durable.base, daik::s_base.c_str()) == 0 &&
                std::strcmp(retirement_witness::durable.board_id, daik::s_board.c_str()) == 0,
            "JOURNAL_FOREIGN_BINDING_REMAINS_EXPLICIT_OPERATOR_MIGRATION_EVIDENCE");
    for (int i = 0; i < sdk::publish_calls; ++i)
        require(!std::strstr(sdk::published[i].topic.data(), "other") &&
                    !std::strstr(sdk::published[i].topic.data(), "040404040404") &&
                    !std::strchr(sdk::published[i].topic.data(), '#') &&
                    !std::strchr(sdk::published[i].topic.data(), '+'),
                "JOURNAL_FOREIGN_NAMESPACE_IS_NEVER_AUTOMATICALLY_RETRACTED");
}

void journal_bootstrap_auto() {
    cleanup_fixture();
    adapter::cfg.profile = "auto";
    require(daik::load_retirement_provenance() &&
                (daik::mqtt_retirement_evidence() & 0x102) == 0x102,
            "JOURNAL_MISSING_RECORD_HAS_EXPLICIT_UNKNOWN_UPGRADE_BOUNDARY");
    require(!daik::publish_x10a_discovery() && retirement_witness::save_calls == 0,
            "JOURNAL_AUTO_TARGET_NEVER_OVERWRITES_LAST_POSSIBLY_ANNOUNCED_PROFILE");
    journal_reboot_volatile_state();
    journal_seed("altherma3_r_erga");
    require(daik::load_retirement_provenance() && daik::s_discovered_profile == "altherma3_r_erga",
            "JOURNAL_SCOPED_PREDECESSOR_LOADS_WHILE_DETECTION_IS_AUTO");
    adapter::cfg.profile.clear();
    require(!daik::publish_x10a_discovery() && retirement_witness::save_calls == 0 &&
                std::strcmp(retirement_witness::durable.profile_id, "altherma3_r_erga") == 0,
            "JOURNAL_EMPTY_TARGET_PRESERVES_RETIREMENT_PROVENANCE");
}

void journal_load_oom_recovery() {
    cleanup_fixture();
    journal_seed("altherma_lt_11_16kw_hydrosplit_hydro_unit");
    sdk::fail_next_new = true;
    bool threw         = false;
    try {
        daik::load_retirement_provenance();
    } catch (const std::bad_alloc&) {
        threw = true;
    }
    require(threw && !daik::s_retirement_store_loaded && daik::s_discovered_profile.empty() &&
                !(daik::mqtt_retirement_evidence() & 0x001),
            "JOURNAL_LOAD_STRING_OOM_CANNOT_CONSUME_OR_CLAIM_PREDECESSOR");
    require(daik::load_retirement_provenance() && retirement_witness::load_calls == 2 &&
                daik::s_discovered_profile == "altherma_lt_11_16kw_hydrosplit_hydro_unit" &&
                (daik::mqtt_retirement_evidence() & 0x001),
            "JOURNAL_LOAD_OOM_RETRIES_AND_COMMITS_REAL_RESTORATION_WITHOUT_SDK_EFFECTS");
    require(sdk::publish_calls == 0 && retirement_witness::save_calls == 0,
            "JOURNAL_LOAD_IS_READ_ONLY_AND_NOT_DETECTION_AUTHORITY");
}

void journal_failure_live_metrics() {
    initial_config();
    retirement_witness::result = daik::MqttRetirementStoreLoad::Incompatible;
    adapter::cfg.profile       = "altherma_gshp2";
    adapter::hp.connected      = true;
    adapter::hp.last_ok_s      = 0;
    adapter::x10a_generation   = 7;
    adapter::x10a_payload      = R"({"hydronic":{"flow_rate":9}})";
    sdk::on_delay              = [](TickType_t delay) {
        check_cycle(delay);
        if (sdk::delays == 1) {
            require(accepted_count(daik::s_x10a) == 1 &&
                                     accepted_count(daik::s_x10a_avail, "online") == 1 &&
                                     retirement_witness::save_calls == 0 &&
                                     (daik::mqtt_retirement_evidence() & 0x010),
                                 "JOURNAL_FAILURE_CANNOT_BLOCK_CURRENT_X10A_METRICS_OR_TRUTHFUL_AVAILABILITY");
            adapter::x10a_generation = 8;
            adapter::x10a_payload    = R"({"hydronic":{"flow_rate":10}})";
        } else if (sdk::delays == 2) {
            require(accepted_count(daik::s_x10a) == 2 && daik::s_last_x10a_cache_gen == 8,
                                 "JOURNAL_FAILURE_STILL_PUBLISHES_CHANGED_CURRENT_METRICS");
            throw StopTask{};
        }
    };
    try {
        sdk::task_fn(nullptr);
    } catch (const StopTask&) {}
}

void journal_prior_quarantined_row() {
    cleanup_fixture();
    journal_seed("altherma_ebla_edla_d_series_4_8kw_monobloc");
    adapter::cfg.profile         = "protocol_s";
    daik::s_stale_values_profile = adapter::cfg.profile;
    auto expected =
        journal_obsolete_topics("altherma_ebla_edla_d_series_4_8kw_monobloc", "protocol_s");
    const std::string historical =
        "homeassistant/sensor/daikin_altherma_esp32_install/hybrid_be_cop/config";
    expected.insert(historical);
    retirement_witness::expected_ack_count = static_cast<int>(expected.size());
    std::set<std::string> acknowledged;
    require(journal_drive(expected, acknowledged) && acknowledged.count(historical),
            "JOURNAL_PREDECESSOR_QUARANTINE_CANNOT_HIDE_HISTORICAL_GROUPED_CONFIG");
    require(!retirement_witness::save_before_retirement,
            "JOURNAL_HISTORICAL_QUARANTINED_PREDECESSOR_IS_ACKED_BEFORE_TARGET_SAVE");
}

int main(int argc, char** argv) {
    const char* scenario = argc > 1 ? argv[1] : "ref_oom_recovery";
    try {
        cJSON_Hooks hooks{json_witness::allocate, json_witness::release};
        cJSON_InitHooks(&hooks);
        if (std::strcmp(scenario, "transport_source_lifecycle") == 0)
            transport_source_lifecycle();
        else if (std::strcmp(scenario, "independent_source_reconnect") == 0)
            independent_source_reconnect();
        else if (std::strcmp(scenario, "independent_source_cutover") == 0)
            independent_source_cutover();
        else if (std::strcmp(scenario, "availability_retry_oom") == 0)
            availability_retry_oom();
        else if (std::strcmp(scenario, "full_mac_identity") == 0)
            full_mac_identity();
        else if (std::strcmp(scenario, "full_mac_read_failure") == 0)
            full_mac_read_failure();
        else if (std::strcmp(scenario, "legacy_retirement_delivery") == 0)
            legacy_retirement_delivery();
        else if (std::strcmp(scenario, "retirement_oom_recovery") == 0)
            retirement_oom_recovery();
        else if (std::strcmp(scenario, "retained_probe_delivery") == 0)
            retained_probe_delivery();
        else if (std::strcmp(scenario, "stale_value_retirement") == 0)
            stale_value_retirement();
        else if (std::strcmp(scenario, "profile_cutover_delivery") == 0)
            profile_cutover_delivery();
        else if (std::strcmp(scenario, "periodic_discovery_delivery") == 0)
            periodic_discovery_delivery();
        else if (std::strcmp(scenario, "periodic_discovery_task_timer") == 0)
            periodic_discovery_task_timer();
        else if (std::strcmp(scenario, "profile_return_during_retirement") == 0)
            profile_return_during_retirement();
        else if (std::strcmp(scenario, "profile_retirement_scan_bounds") == 0)
            profile_retirement_scan_bounds();
        else if (std::strcmp(scenario, "retirement_early_ack") == 0)
            retirement_early_ack();
        else if (std::strcmp(scenario, "retirement_after_gate_withdrawal") == 0)
            retirement_after_gate_withdrawal();
        else if (std::strcmp(scenario, "journal_reboot_mid_retirement") == 0)
            journal_reboot_mid_retirement();
        else if (std::strcmp(scenario, "journal_reboot_after_save") == 0)
            journal_reboot_after_save();
        else if (std::strcmp(scenario, "journal_commit_write_through_failure") == 0)
            journal_commit_write_through_failure();
        else if (std::strcmp(scenario, "journal_load_errors") == 0)
            journal_load_errors();
        else if (std::strcmp(scenario, "journal_foreign_scope") == 0)
            journal_foreign_scope();
        else if (std::strcmp(scenario, "journal_foreign_board_scope") == 0)
            journal_foreign_scope(true);
        else if (std::strcmp(scenario, "journal_bootstrap_auto") == 0)
            journal_bootstrap_auto();
        else if (std::strcmp(scenario, "journal_load_oom_recovery") == 0)
            journal_load_oom_recovery();
        else if (std::strcmp(scenario, "journal_failure_live_metrics") == 0)
            journal_failure_live_metrics();
        else if (std::strcmp(scenario, "journal_prior_quarantined_row") == 0)
            journal_prior_quarantined_row();
        else if (std::strcmp(scenario, "discovery_topic_roundtrip") == 0)
            discovery_topic_roundtrip();
        else if (std::strcmp(scenario, "callback_fragments") == 0)
            callback_fragments();
        else if (std::strcmp(scenario, "callback_payload_bounds") == 0)
            callback_payload_bounds();
        else if (std::strcmp(scenario, "callback_epoch_cutover") == 0)
            callback_epoch_cutover();
        else if (std::strcmp(scenario, "callback_queue_full") == 0)
            callback_queue_full();
        else if (std::strcmp(scenario, "callback_timestamp_order") == 0)
            callback_timestamp_order();
        else if (std::strcmp(scenario, "probe_capture_generation") == 0)
            probe_capture_generation();
        else if (std::strcmp(scenario, "probe_proof_expiry") == 0)
            probe_proof_expiry();
        else if (std::strcmp(scenario, "startup_failure_recovery") == 0)
            startup_failure_recovery();
        else if (std::strcmp(scenario, "event_registration_failure") == 0)
            event_registration_failure();
        else if (std::strcmp(scenario, "ref_oom_recovery") == 0)
            ref_oom_recovery();
        else if (std::strcmp(scenario, "circulation_oom_recovery") == 0)
            circulation_oom_recovery();
        else if (std::strcmp(scenario, "failure_episodes") == 0)
            failure_episodes();
        else if (std::strcmp(scenario, "reconfigure_config_oom") == 0)
            reconfigure_config_oom();
        else if (std::strcmp(scenario, "circulation_probe_postsubscribe_oom") == 0)
            circulation_probe_postsubscribe_oom();
        else if (std::strcmp(scenario, "circulation_saved_postsubscribe_oom") == 0)
            circulation_saved_postsubscribe_oom();
        else if (std::strcmp(scenario, "circulation_saved_epoch_change") == 0)
            circulation_saved_epoch_change();
        else if (std::strcmp(scenario, "circulation_saved_retry") == 0)
            circulation_saved_retry();
        else if (std::strcmp(scenario, "circulation_saved_reconnect_oom") == 0)
            circulation_saved_reconnect_oom();
        else if (std::strcmp(scenario, "circulation_saved_replacement_failure") == 0)
            circulation_saved_replacement_failure();
        else if (std::strcmp(scenario, "reference_saved_postsubscribe_oom") == 0)
            reference_saved_postsubscribe_oom(false);
        else if (std::strcmp(scenario, "reference_saved_final_owner_oom") == 0)
            reference_saved_postsubscribe_oom(true);
        else if (std::strcmp(scenario, "reference_saved_partial_retry") == 0)
            reference_saved_partial_retry();
        else if (std::strcmp(scenario, "reference_saved_prior_owner_cleanup") == 0)
            reference_saved_prior_owner_failure(false);
        else if (std::strcmp(scenario, "reference_saved_prior_owner_retry") == 0)
            reference_saved_prior_owner_failure(true);
        else if (std::strcmp(scenario, "reference_saved_reconnect_oom") == 0)
            reference_saved_reconnect_oom();
        else if (std::strcmp(scenario, "reference_saved_replacement_partial_failure") == 0)
            reference_saved_replacement_partial_failure();
        else if (std::strcmp(scenario, "circulation_unsubscribe_rejection") == 0)
            circulation_unsubscribe_rejection(false);
        else if (std::strcmp(scenario, "circulation_replace_unsubscribe_rejection") == 0)
            circulation_unsubscribe_rejection(true);
        else if (std::strcmp(scenario, "reference_unsubscribe_rejection") == 0)
            reference_unsubscribe_rejection(false);
        else if (std::strcmp(scenario, "reference_replace_unsubscribe_rejection") == 0)
            reference_unsubscribe_rejection(true);
        else if (std::strcmp(scenario, "probe_unsubscribe_rejection") == 0)
            circulation_probe_unsubscribe_rejection(false);
        else if (std::strcmp(scenario, "probe_disabled_unsubscribe_rejection") == 0)
            circulation_probe_unsubscribe_rejection(true);
        else if (std::strcmp(scenario, "shared_subscription_owners") == 0)
            shared_subscription_owners();
        else if (std::strcmp(scenario, "probe_active_replacement") == 0)
            probe_active_replacement(false);
        else if (std::strcmp(scenario, "probe_active_replacement_retire_rejection") == 0)
            probe_active_replacement(true);
        else if (std::strcmp(scenario, "probe_saved_config_without_owner") == 0)
            probe_saved_config_without_owner();
        else if (std::strcmp(scenario, "probe_active_shared_prior_owner") == 0)
            probe_active_shared_prior_owner();
        else if (std::strcmp(scenario, "sdk_event_stack_owner") == 0)
            sdk_event_stack_owner();
        else if (std::strcmp(scenario, "outgoing_heartbeat") == 0)
            outgoing_heartbeat();
        else if (std::strcmp(scenario, "outgoing_weather") == 0)
            outgoing_weather();
        else if (std::strcmp(scenario, "outgoing_curve") == 0)
            outgoing_curve();
        else if (std::strcmp(scenario, "scalar_snapshot_helpers") == 0)
            scalar_snapshot_helpers();
        else if (std::strcmp(scenario, "real_json_consumers") == 0)
            real_json_consumers();
        else
            throw std::runtime_error("unknown scenario");
        std::printf("PASS %s (%d named checks)\n", scenario, checks);
    } catch (const std::exception& e) {
        std::fprintf(stderr, "UNCAUGHT %s\n", e.what());
        return 3;
    }
}
