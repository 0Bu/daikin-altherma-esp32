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
void                 stack_watch_sample(StackWatch) noexcept { ++sdk::samples; }
uint32_t             stack_watch_min_free_bytes(StackWatch) noexcept { return 4096; }
size_t               heap_largest_internal_block() { return 40000; }
uint8_t              heap_guard_restarts() { return 0; }
HpStats              hp_stats() { return {}; }
uint32_t             hp_cache_generation() { return 0; }
uint32_t             hp_skipped_cycles() { return 0; }
HpX10aJsonProbe      hp_values_x10a_json_probe(const char*, uint64_t) { return {}; }
HpX10aJsonCopyResult hp_values_x10a_json_copy(std::string&, size_t, uint64_t, uint32_t, const char*,
                                              uint64_t) {
    return HpX10aJsonCopyResult::SourceMismatch;
}
bool         mb_target_enabled() noexcept { return false; }
ModbusStatus mb_status() { return {}; }
size_t       mb_values_capacity() { return 0; }
size_t       mb_values_snapshot(CachedValue*, size_t, bool& live) {
    live = false;
    return 0;
}
bool                  mb_values_live() { return false; }
uint32_t              mb_cache_generation() { return 0; }
Env3Status            env3_status() { return {}; }
WeatherForecastStatus weather_forecast_status() { return {}; }
void                  history_record_circulation() {}
void                  history_circulation_reset() {}
void                  checkup_dhw_reset() {}
CrashInfo             diag_crash_info() { return {}; }
CrashInfo             diag_crash_info_live() { return {}; }
WifiInfo              wifi_info() { return {}; }
uint32_t              wifi_reconnect_count() { return 0; }
EthInfo               net_eth_info() { return {}; }
NetLink               net_kind() { return NetLink::None; }
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
    adapter::cfg.circulation_name               = "Circulation";
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
    json_both(valid + std::string("\0", 1) + "junk", false, "trailing");
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
    require(json_witness::parses == 38, "BOTH_PRODUCTION_CONSUMERS_USED_REAL_CJSON");
    require(json_witness::live == 0 && json_witness::allocations == json_witness::frees,
            "REAL_CJSON_ALL_ALLOCATIONS_RELEASED");
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
