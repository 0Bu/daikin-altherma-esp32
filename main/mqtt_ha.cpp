// Home Assistant MQTT-Discovery bridge (see mqtt_ha.hpp + docs/ARCHITECTURE.md → MQTT bridge).
// esp-mqtt client in its own publish task:
//   • TLS policy: credentials present ⇒ mqtts:// + CA-verified (esp_crt_bundle); NEVER send
//     credentials over plaintext (no silent fallback — refuse with an error in /status.mqtt).
//   • On (re)connect: mark availability "online", stream one retained discovery config per value of
//     the active profile (logic/discovery.hpp), then seed each value's retained state topic.
//   • Each cycle: publish ONLY the values that changed (logic/mqtt_delta.hpp) — the poll interval is
//     short (near-real-time) but the broker only sees deltas.
// Read-only: no command subscriptions. No-op if mqtt_uri is empty. Memory-safe: discovery/state are
// small per-value publishes, never one big contiguous JSON.
#include "mqtt_ha.hpp"
#include "config.hpp"
#include "def/registry.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/discovery.hpp"
#include "logic/mqtt_delta.hpp"

#include "esp_crt_bundle.h"
#include "esp_wifi.h"
#include "mqtt_client.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <cstdio>
#include <string>
#include <vector>

namespace daik {

static esp_mqtt_client_handle_t s_client = nullptr;
static SemaphoreHandle_t        s_mtx    = nullptr;   // guards s_status
static MqttStatus               s_status;
static volatile bool            s_connected = false;
static volatile bool            s_announce  = false;  // set on connect -> task re-announces

// Persisted so the pointers handed to esp-mqtt (and reused by the task) stay valid.
static std::string s_uri, s_user, s_pass, s_node, s_base, s_prefix, s_avail;
static std::string s_announced_profile;               // profile we last published discovery for
static std::vector<PubValue> s_last;                  // last published per-value snapshot

static void set_status(bool connected, const char* err) {
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    s_status.connected = connected;
    if (err) s_status.error = err;
    else if (connected) s_status.error.clear();
    xSemaphoreGive(s_mtx);
}

// node id daikin_<mac3> (STA MAC low 3 bytes) — stable across config changes.
static std::string node_id() {
    uint8_t m[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, m);
    char b[20];
    std::snprintf(b, sizeof(b), "daikin_%02x%02x%02x", m[3], m[4], m[5]);
    return b;
}

// Layout-marker / grid converters carry no measured value (docs/REGISTERS.md §3.6) — no sensor.
static bool is_publishable(int conv) { return !(conv == 0 || (conv >= 995 && conv <= 999)); }

// Current publishable values from the poll cache: object_id -> formatted value (skip "no data").
static std::vector<PubValue> current_values() {
    std::vector<CachedValue> cache(64);
    const size_t n = hp_values_snapshot(cache.data(), cache.size());
    std::vector<PubValue> out;
    out.reserve(n);
    for (size_t i = 0; i < n; i++) {
        if (cache[i].value.empty()) continue;
        out.push_back({object_id(cache[i].label.c_str()), cache[i].value});
    }
    return out;
}

// Stream one retained discovery config per value of the active profile.
static void publish_discovery() {
    const auto& prof = def::lookup(config().profile.c_str());
    for (size_t i = 0; i < prof.count; i++) {
        const ValueDef& d = prof.values[i];
        if (!is_publishable(d.conv)) continue;
        const std::string obj = object_id(d.label);
        if (obj.empty()) continue;
        const std::string ct  = discovery_topic(s_prefix, s_node, d);
        const std::string st  = value_state_topic(s_base, s_node, d);
        const std::string cfg = discovery_config(s_node, st, s_avail, d);
        esp_mqtt_client_publish(s_client, ct.c_str(), cfg.c_str(), 0, 0, 1);   // retained
    }
}

static void publish_values(const std::vector<PubValue>& vals) {
    for (const auto& v : vals) {
        const std::string t = s_base + "/" + s_node + "/" + v.key + "/state";
        esp_mqtt_client_publish(s_client, t.c_str(), v.value.c_str(), 0, 0, 1); // retained
    }
}

static void on_mqtt(void*, esp_event_base_t, int32_t id, void* data) {
    switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
        s_connected = true; s_announce = true; set_status(true, nullptr);
        diag_printf("mqtt: connected\n");
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false; set_status(false, nullptr);
        diag_printf("mqtt: disconnected (will retry)\n");
        break;
    case MQTT_EVENT_ERROR: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        const char* why = "connection error";
        if (e && e->error_handle) {
            if (e->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT)       why = "tls/tcp error";
            else if (e->error_handle->connect_return_code != MQTT_CONNECTION_ACCEPTED) why = "broker refused (auth/creds?)";
        }
        set_status(false, why);
        diag_printf("mqtt: %s\n", why);
        break; }
    default: break;
    }
}

// Publish task: announce on (re)connect / profile change, then publish only changed values.
static void mqtt_task(void*) {
    for (;;) {
        int delay_s = config().poll_s;
        if (delay_s < 1) delay_s = 1;

        if (s_connected) {
            if (s_announce) {                                  // just (re)connected
                s_announce = false;
                s_announced_profile.clear();                   // force a fresh discovery below
                esp_mqtt_client_publish(s_client, s_avail.c_str(), "online", 0, 0, 1);
            }
            const std::string prof = config().profile;
            if (prof != "auto" && prof != s_announced_profile) {
                publish_discovery();                           // discovery for the (new) profile
                s_announced_profile = prof;
                s_last = current_values();
                publish_values(s_last);                        // full retained seed
            } else if (!s_announced_profile.empty() && prof == s_announced_profile) {
                auto cur = current_values();
                publish_values(mqtt_changed(s_last, cur));     // deltas only
                s_last = std::move(cur);
            }
            // prof == "auto" (detection pending): wait — don't publish transient generic sensors.
        }
        vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
    }
}

// Validate the URI/credential combination and build the client. Returns false (with an error set in
// /status.mqtt) if the config would leak credentials over plaintext.
static bool build_client() {
    const Config& c = config();
    s_uri  = c.mqtt_uri;
    s_user = c.mqtt_user;
    s_pass = c.mqtt_pass;

    const bool has_scheme = s_uri.find("://") != std::string::npos;
    const bool is_tls     = s_uri.rfind("mqtts://", 0) == 0 || s_uri.rfind("wss://", 0) == 0;
    const bool has_creds  = !s_user.empty() || !s_pass.empty();
    if (!has_scheme) s_uri = "mqtt://" + s_uri;                // bare host:port -> plaintext scheme

    // Credentials must never travel in cleartext (docs/SECURITY.md) — require mqtts, no fallback.
    if (has_creds && !is_tls) {
        set_status(false, "credentials require mqtts:// (won't send them in cleartext)");
        diag_printf("mqtt: refusing plaintext broker with credentials — use mqtts://\n");
        return false;
    }

    esp_mqtt_client_config_t cfg = {};
    cfg.broker.address.uri = s_uri.c_str();
    if (is_tls) cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.credentials.client_id = s_node.c_str();
    if (!s_user.empty()) cfg.credentials.username = s_user.c_str();
    if (!s_pass.empty()) cfg.credentials.authentication.password = s_pass.c_str();
    cfg.session.keepalive         = 30;
    cfg.session.last_will.topic   = s_avail.c_str();
    cfg.session.last_will.msg     = "offline";
    cfg.session.last_will.msg_len = 7;
    cfg.session.last_will.qos     = 1;
    cfg.session.last_will.retain  = 1;

    s_client = esp_mqtt_client_init(&cfg);
    if (!s_client) { set_status(false, "mqtt init failed"); return false; }
    esp_mqtt_client_register_event(s_client, static_cast<esp_mqtt_event_id_t>(MQTT_EVENT_ANY),
                                   on_mqtt, nullptr);
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    s_status.tls = is_tls;
    xSemaphoreGive(s_mtx);
    return true;
}

void mqtt_ha_start() {
    const Config& c = config();
    s_mtx = xSemaphoreCreateMutex();
    s_status.configured = !c.mqtt_uri.empty();
    s_status.broker     = c.mqtt_uri;
    if (!s_status.configured) return;

    s_node   = node_id();
    s_base   = CONFIG_DAIKIN_MQTT_BASE_TOPIC;
    s_prefix = CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX;
    s_avail  = availability_topic(s_base, s_node);

    if (!build_client()) return;                               // policy error already surfaced
    esp_mqtt_client_start(s_client);
    xTaskCreate(mqtt_task, "mqtt_pub", 4096, nullptr, 4, nullptr);
}

MqttStatus mqtt_status() {
    if (!s_mtx) return s_status;
    xSemaphoreTake(s_mtx, portMAX_DELAY);
    MqttStatus st = s_status;
    xSemaphoreGive(s_mtx);
    return st;
}

} // namespace daik
