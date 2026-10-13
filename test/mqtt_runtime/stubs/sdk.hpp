#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <stdexcept>
using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1;
inline const char*  esp_err_to_name(esp_err_t) { return "host-adapter"; }
using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0, pdPASS = 1;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(x) (static_cast<TickType_t>(x))
#define CONFIG_DAIKIN_MQTT_BASE_TOPIC "daikin-altherma-esp32"
#define CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX "homeassistant"
#define CONFIG_IDF_TARGET "esp32s3"
constexpr unsigned MALLOC_CAP_8BIT = 1, MALLOC_CAP_INTERNAL = 2;
constexpr int      ESP_MAC_WIFI_STA = 0;
struct FakeSemaphore {
    bool held   = false;
    bool binary = false;
};
using SemaphoreHandle_t = FakeSemaphore*;
struct FakeQueue {
    std::array<std::array<uint8_t, 1600>, 8> rows{};
    size_t                                   item_size = 0, depth = 0, head = 0, count = 0;
};
using QueueHandle_t          = FakeQueue*;
using TaskHandle_t           = void*;
using esp_event_base_t       = const char*;
using esp_mqtt_event_id_t    = int;
constexpr int MQTT_EVENT_ANY = -1, MQTT_EVENT_BEFORE_CONNECT = 1, MQTT_EVENT_CONNECTED = 2,
              MQTT_EVENT_DISCONNECTED = 3, MQTT_EVENT_ERROR = 4, MQTT_EVENT_PUBLISHED = 5,
              MQTT_EVENT_DELETED = 6, MQTT_EVENT_DATA = 7, MQTT_EVENT_SUBSCRIBED = 8,
              MQTT_ERROR_TYPE_TCP_TRANSPORT = 1, MQTT_CONNECTION_ACCEPTED = 0,
              MQTT_ERROR_TYPE_SUBSCRIBE_FAILED = 2;
struct esp_mqtt_error_codes_t {
    int error_type = 0, connect_return_code = 0;
};
struct FakeMqtt;
struct esp_mqtt_event_t {
    FakeMqtt*               client         = nullptr;
    char*                   topic          = nullptr;
    int                     topic_len      = 0;
    char*                   data           = nullptr;
    int                     data_len       = 0;
    int                     total_data_len = 0, current_data_offset = 0, retain = 0, msg_id = 0;
    esp_mqtt_error_codes_t* error_handle = nullptr;
};
using esp_mqtt_event_handle_t = esp_mqtt_event_t*;
struct FakeMqtt {
    void (*handler)(void*, esp_event_base_t, int32_t, void*) = nullptr;
    void* handler_arg                                        = nullptr;
};
using esp_mqtt_client_handle_t = FakeMqtt*;
struct esp_mqtt_client_config_t {
    struct {
        int stack_size = 0;
    } task;
    struct {
        struct {
            const char* uri = nullptr;
        } address;
        struct {
            esp_err_t (*crt_bundle_attach)(void*) = nullptr;
        } verification;
    } broker;
    struct {
        const char* client_id = nullptr;
        const char* username  = nullptr;
        struct {
            const char* password = nullptr;
        } authentication;
    } credentials;
    struct {
        int keepalive = 0;
        struct {
            const char* topic   = nullptr;
            const char* msg     = nullptr;
            int         msg_len = 0, qos = 0, retain = 0;
        } last_will;
    } session;
    struct {
        uint64_t limit = 0;
    } outbox;
};
struct esp_app_desc_t {
    const char* version = "host-witness";
};
namespace sdk {
inline TickType_t ticks = 100000;
inline int        locks = 0, takes = 0, gives = 0, delays = 0, resets = 0, samples = 0;
inline int                             sdk_task_samples = 0;
inline bool       fail_locked_new = false;
inline bool       fail_next_new   = false;
inline int        failed_news = 0, allocation_fail_lock_depth = 0;
inline std::function<void(TickType_t)> on_delay;
inline void (*task_fn)(void*) = nullptr;
inline FakeSemaphore mutex, binary;
inline FakeQueue     queue;
inline FakeMqtt      client;
inline int           message_id = 0, publish_calls = 0, subscribe_calls = 0;
inline int                  start_calls = 0, start_failures = 0, destroy_calls = 0;
inline int                    init_calls = 0, stop_calls = 0;
inline esp_err_t              mac_result = ESP_OK;
inline std::array<uint8_t, 6> mac{2, 1, 1, 1, 1, 1};
inline char                   client_id[160]{}, will_topic[256]{}, will_payload[32]{};
inline int                    will_qos = 0, will_retain = 0;
inline esp_err_t            registration_result        = ESP_OK;
inline bool          reject_new_after_subscribe = false;
inline int           unsubscribe_calls          = 0;
inline char          last_subscribed_topic[256]{}, last_unsubscribed_topic[256]{};
inline std::array<bool, 64> subscribe_failures{};
inline std::array<bool, 64> unsubscribe_failures{}, unsubscribe_accepted{};
inline std::array<std::array<char, 256>, 64> subscribed_topics{}, unsubscribed_topics{};
inline std::array<std::array<char, 256>, 16> live_topics{};
inline std::function<void(const char*, int)> on_subscribe;
struct PublishTrace {
    std::array<char, 1024> topic{};
    std::array<char, 4096> payload{};
    int                    length = 0, qos = 0, retain = 0;
    bool                   accepted = false, enqueued = false;
};
inline std::array<PublishTrace, 512> published{};
inline void (*on_publish)(const PublishTrace&)          = nullptr;
inline bool                         reject_next_publish = false, reject_new_after_publish = false;
inline char                         reject_publish_topic[256]{};

inline int record_publish(const char* topic, const char* payload, int len, int qos, int retain,
                          bool enqueued) {
    const size_t bytes = len == 0 && payload ? std::strlen(payload) : static_cast<size_t>(len);
    if (publish_calls >= static_cast<int>(published.size()) ||
        std::strlen(topic) >= published[0].topic.size() || bytes >= published[0].payload.size())
        throw std::runtime_error("adapter publish trace bound exceeded");
    PublishTrace& row = published[publish_calls++];
    std::strcpy(row.topic.data(), topic);
    if (bytes) std::memcpy(row.payload.data(), payload, bytes);
    row.payload[bytes]  = '\0';
    row.length          = static_cast<int>(bytes);
    row.qos             = qos;
    row.retain          = retain;
    row.enqueued        = enqueued;
    row.accepted        = !reject_next_publish && std::strcmp(topic, reject_publish_topic) != 0;
    if (std::strcmp(topic, reject_publish_topic) == 0) reject_publish_topic[0] = '\0';
    reject_next_publish = false;
    const int id        = row.accepted ? ++message_id : -1;
    if (on_publish) on_publish(row);
    if (row.accepted && reject_new_after_publish) {
        reject_new_after_publish = false;
        fail_next_new = true; // final adapter action; only production work after SDK accept sees it
    }
    return id;
}

inline void record_topic(std::array<char, 256>& destination, const char* topic) {
    if (std::strlen(topic) >= destination.size())
        throw std::runtime_error("adapter topic bound exceeded");
    std::strcpy(destination.data(), topic);
}
inline bool topic_live(const char* topic) {
    for (const auto& live : live_topics)
        if (std::strcmp(live.data(), topic) == 0) return true;
    return false;
}
inline void retain_topic(const char* topic) {
    if (topic_live(topic)) return; // the broker has one exact-topic subscription per client
    for (auto& live : live_topics) {
        if (live[0] == '\0') {
            record_topic(live, topic);
            return;
        }
    }
    throw std::runtime_error("adapter live subscription bound exceeded");
}
inline int unsubscribe_count(const char* topic) {
    int count = 0;
    for (int i = 0; i < unsubscribe_calls; ++i)
        if (std::strcmp(unsubscribed_topics[i].data(), topic) == 0) ++count;
    return count;
}
inline int accepted_unsubscribe_count(const char* topic) {
    int count = 0;
    for (int i = 0; i < unsubscribe_calls; ++i)
        if (unsubscribe_accepted[i] && std::strcmp(unsubscribed_topics[i].data(), topic) == 0)
            ++count;
    return count;
}
} // namespace sdk
inline TickType_t xTaskGetTickCount() { return sdk::ticks; }
inline void       vTaskDelay(TickType_t ticks) {
    ++sdk::delays;
    sdk::ticks += ticks;
    if (sdk::on_delay) sdk::on_delay(ticks);
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, uint32_t, void*, UBaseType_t,
                              TaskHandle_t*) {
    sdk::task_fn = fn;
    return pdPASS;
}
inline void vTaskDelete(TaskHandle_t) { throw std::runtime_error("unexpected task deletion"); }
inline SemaphoreHandle_t xSemaphoreCreateMutex() { return &sdk::mutex; }
inline SemaphoreHandle_t xSemaphoreCreateBinary() {
    sdk::binary.binary = true;
    return &sdk::binary;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t sem, TickType_t) {
    if (!sem || sem->held) throw std::runtime_error("semaphore already held or null");
    sem->held = true;
    ++sdk::locks;
    ++sdk::takes;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t sem) {
    if (!sem) throw std::runtime_error("semaphore give null");
    if (!sem->binary && !sem->held) throw std::runtime_error("semaphore not owned");
    if (sem->held) {
        sem->held = false;
        --sdk::locks;
        ++sdk::gives;
    }
    return pdTRUE;
}
inline QueueHandle_t xQueueCreate(size_t depth, size_t size) {
    if (depth > 8 || size > 1600) throw std::runtime_error("queue bound");
    sdk::queue           = {};
    sdk::queue.depth     = depth;
    sdk::queue.item_size = size;
    return &sdk::queue;
}
inline BaseType_t xQueueSend(QueueHandle_t q, const void* row, TickType_t) {
    if (q->count == q->depth) return pdFALSE;
    std::memcpy(q->rows[(q->head + q->count) % q->depth].data(), row, q->item_size);
    ++q->count;
    return pdTRUE;
}
inline BaseType_t xQueueReceive(QueueHandle_t q, void* row, TickType_t) {
    if (!q->count) return pdFALSE;
    std::memcpy(row, q->rows[q->head].data(), q->item_size);
    q->head = (q->head + 1) % q->depth;
    --q->count;
    return pdTRUE;
}
inline int64_t esp_timer_get_time() { return int64_t(sdk::ticks) * 1000; }
inline int     esp_task_wdt_add(void*) { return 0; }
inline int     esp_task_wdt_delete(void*) { return 0; }
inline int     esp_task_wdt_reset() {
    ++sdk::resets;
    return 0;
}
inline size_t    heap_caps_get_free_size(unsigned) { return 100000; }
inline size_t    esp_get_free_heap_size() { return 100000; }
inline size_t    esp_get_minimum_free_heap_size() { return 90000; }
inline void      esp_restart() { throw std::runtime_error("unexpected restart"); }
inline esp_err_t esp_read_mac(uint8_t* mac, int) {
    // Failure may leave nonzero bytes in the caller buffer: the production return-code check,
    // rather than a fabricated/zeroed MAC fallback, must prevent client creation.
    std::memcpy(mac, sdk::mac.data(), 6);
    return sdk::mac_result;
}
inline esp_err_t             esp_crt_bundle_attach(void*) { return ESP_OK; }
inline const esp_app_desc_t* esp_app_get_description() {
    static esp_app_desc_t desc;
    return &desc;
}
inline esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t* cfg) {
    ++sdk::init_calls;
    std::snprintf(sdk::client_id, sizeof(sdk::client_id), "%s", cfg->credentials.client_id);
    std::snprintf(sdk::will_topic, sizeof(sdk::will_topic), "%s",
                  cfg->session.last_will.topic ? cfg->session.last_will.topic : "");
    std::snprintf(sdk::will_payload, sizeof(sdk::will_payload), "%s",
                  cfg->session.last_will.msg ? cfg->session.last_will.msg : "");
    sdk::will_qos    = cfg->session.last_will.qos;
    sdk::will_retain = cfg->session.last_will.retain;
    return &sdk::client;
}
inline esp_err_t esp_mqtt_client_destroy(FakeMqtt* client) {
    ++sdk::destroy_calls;
    client->handler = nullptr;
    return ESP_OK;
}
inline esp_err_t esp_mqtt_client_register_event(FakeMqtt* c, int,
                                                void (*fn)(void*, esp_event_base_t, int32_t, void*),
                                                void* arg) {
    if (sdk::registration_result != ESP_OK) return sdk::registration_result;
    c->handler     = fn;
    c->handler_arg = arg;
    return ESP_OK;
}
inline esp_err_t esp_mqtt_client_start(FakeMqtt* c) {
    ++sdk::start_calls;
    if (sdk::start_failures > 0) {
        --sdk::start_failures;
        return ESP_FAIL;
    }
    if (c->handler) c->handler(c->handler_arg, "mqtt", MQTT_EVENT_CONNECTED, nullptr);
    return ESP_OK;
}
inline esp_err_t esp_mqtt_client_stop(FakeMqtt*) {
    ++sdk::stop_calls;
    return ESP_OK;
}
inline int       esp_mqtt_client_subscribe(FakeMqtt*, const char* topic, int) {
    const int row = sdk::subscribe_calls++;
    if (static_cast<size_t>(row) >= sdk::subscribed_topics.size())
        throw std::runtime_error("adapter subscribe trace bound exceeded");
    sdk::record_topic(sdk::subscribed_topics[row], topic);
    std::strncpy(sdk::last_subscribed_topic, topic, sizeof(sdk::last_subscribed_topic) - 1);
    const int id = sdk::subscribe_failures[row] ? -1 : ++sdk::message_id;
    if (id >= 0) sdk::retain_topic(topic);
    if (sdk::on_subscribe) sdk::on_subscribe(topic, id);
    if (sdk::reject_new_after_subscribe) {
        sdk::reject_new_after_subscribe = false;
        sdk::fail_next_new =
            true; // final adapter action; only subsequent production new may consume it
    }
    return id;
}
inline int esp_mqtt_client_unsubscribe(FakeMqtt*, const char* topic) {
    const int row = sdk::unsubscribe_calls++;
    if (static_cast<size_t>(row) >= sdk::unsubscribed_topics.size())
        throw std::runtime_error("adapter unsubscribe trace bound exceeded");
    sdk::record_topic(sdk::unsubscribed_topics[row], topic);
    std::strncpy(sdk::last_unsubscribed_topic, topic, sizeof(sdk::last_unsubscribed_topic) - 1);
    if (sdk::unsubscribe_failures[row]) return -1;
    sdk::unsubscribe_accepted[row] = true;
    for (auto& live : sdk::live_topics)
        if (std::strcmp(live.data(), topic) == 0) live.fill('\0');
    return ++sdk::message_id;
}
inline int esp_mqtt_client_publish(FakeMqtt*, const char* topic, const char* payload, int len,
                                   int qos, int retain) {
    return sdk::record_publish(topic, payload, len, qos, retain, false);
}
inline int esp_mqtt_client_enqueue(FakeMqtt*, const char* topic, const char* payload, int len,
                                   int qos, int retain, bool) {
    return sdk::record_publish(topic, payload, len, qos, retain, true);
}
