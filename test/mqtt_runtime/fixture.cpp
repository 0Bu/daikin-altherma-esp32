// Complete production MQTT TU. SDK, scheduler, and unrelated service boundaries are host adapters.
#include "sdk.hpp"
#include "cJSON.h"
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <new>
#include <string>
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
#ifndef MQTT_PRODUCTION_SOURCE
#error MQTT_PRODUCTION_SOURCE must identify the complete current production TU
#endif
#include MQTT_PRODUCTION_SOURCE

void* operator new(size_t size) {
    if (sdk::fail_next_new || (sdk::fail_locked_new && sdk::locks > 0)) {
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
int          config_locks = 0, skipped_logs = 0;
char         last_skip[256]{};
daik::HpStats               hp;
daik::WifiInfo              wifi{};
daik::ModbusStatus          modbus;
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
namespace daik {
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
}
void stack_watch_sample(StackWatch slot) noexcept {
    if (slot == StackWatch::Mqtt) ++sdk::samples;
    if (slot == StackWatch::SdkMqtt) ++sdk::sdk_task_samples;
}
uint32_t stack_watch_min_free_bytes(StackWatch slot) noexcept {
    return adapter::stack_minima[static_cast<size_t>(slot)];
}
size_t               heap_largest_internal_block() { return 40000; }
uint8_t              heap_guard_restarts() { return 0; }
HpStats              hp_stats() { return adapter::hp; }
uint32_t             hp_cache_generation() { return 0; }
uint32_t             hp_skipped_cycles() { return adapter::poll_skips; }
HpX10aJsonProbe      hp_values_x10a_json_probe(const char*, uint64_t) { return {}; }
HpX10aJsonCopyResult hp_values_x10a_json_copy(std::string&, size_t, uint64_t, uint32_t, const char*,
                                              uint64_t) {
    return HpX10aJsonCopyResult::SourceMismatch;
}
bool         mb_target_enabled() noexcept { return false; }
ModbusStatus mb_status() { return adapter::modbus; }
size_t       mb_values_capacity() { return 0; }
size_t       mb_values_snapshot(CachedValue*, size_t, bool& live) {
    live = false;
    return 0;
}
bool                  mb_values_live() { return false; }
uint32_t              mb_cache_generation() { return 0; }
Env3Status            env3_status() { return {}; }
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
    unix_s = 1700000000 + sdk::ticks / 1000;
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
void initial_config() {
    adapter::cfg.mqtt_uri = "mqtt://host-witness";
    adapter::cfg.mqtt_base.assign(80, 'm'); // guarantees the ordinary Config copy allocates
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
    auto gate = daik::mqtt_cycle_gate(daik::MqttPublishGateState::SubscriberOnly, connected);
    require(connected && gate.promote_publisher && !gate.publish_cycle &&
                gate.next == daik::MqttPublishGateState::Active,
            "SCALAR_HP_GATE_PRESERVES_FIRST_SOURCE_PROMOTION");
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
int main(int argc, char** argv) {
    const char* scenario = argc > 1 ? argv[1] : "ref_oom_recovery";
    try {
        cJSON_Hooks hooks{json_witness::allocate, json_witness::release};
        cJSON_InitHooks(&hooks);
        if (std::strcmp(scenario, "ref_oom_recovery") == 0)
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
