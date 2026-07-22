// Home Assistant MQTT-Discovery bridge (see mqtt_ha.hpp + docs/ARCHITECTURE.md → MQTT bridge).
// esp-mqtt client in its own publish task:
//   • TLS policy: credentials present ⇒ mqtts:// + CA-verified (esp_crt_bundle); NEVER send
//     credentials over plaintext (no silent fallback — refuse with an error in /status.mqtt).
//   • On (re)connect: mark availability "online", stream one retained discovery config per value of
//     the active profile (logic/discovery.hpp), then publish the full grouped state JSON.
//   • Each cycle: rebuild the grouped state JSON (logic/mqtt_group.hpp) and publish it to the ONE
//     shared topic <base>/<node>/state — but only when the payload actually changed, so a quiet
//     pump doesn't spam the broker.
//   • Every HEARTBEAT_INTERVAL_S (10 s): rebuild + publish the board/link diagnostics JSON
//     (logic/heartbeat.hpp) to <base>/<node>/heartbeat — diagnostics, not real-time telemetry, so
//     unlike the state topic it's a fixed cadence, not publish-on-change.
//   • Once per (re)connect: RETAIN the boot-time crash summary (logic/crashinfo.hpp) on
//     <base>/<node>/crash — last reset reason + a "dump waiting" flag, as two diagnostic HA
//     entities. Reason/backtrace only; never the raw dump or any secret.
// Read-only: no command subscriptions. No-op if mqtt_uri is empty. Memory-safe: discovery is one
// small publish per value; the state JSON is a single few-KB build, guarded against OOM.
#include "mqtt_ha.hpp"
#include "config.hpp"
#include "def/registry.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/crashinfo.hpp"
#include "logic/discovery.hpp"
#include "logic/heartbeat.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/reset_reason.hpp"
#include "logic/timestamp.hpp"
#include "sntp_time.hpp"
#include "wifi.hpp"

#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "mqtt_client.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <atomic>
#include <cstdio>
#include <exception>
#include <string>
#include <vector>

namespace daik {

static esp_mqtt_client_handle_t s_client = nullptr;
static SemaphoreHandle_t        s_mtx    = nullptr;   // guards s_status + s_error
static MqttStatus               s_status;
// Error text stored as a string LITERAL pointer, NOT in s_status.error: set_status runs on esp-mqtt's
// event task (on_mqtt), which has no exception guard, so it must not allocate. mqtt_status() stringifies
// it for the caller under the lock (a reader may allocate under RAII). s_status.error stays unused.
static const char*              s_error   = "";
// Shared between esp-mqtt's event task (on_mqtt) and the publish task (mqtt_task). std::atomic, not
// volatile: volatile gives no cross-task visibility/ordering under the C++ memory model. Each is a
// standalone flag/counter (no multi-field invariant to lock), so a plain atomic is enough — the
// publish task tolerates eventual consistency (it re-announces on the next cycle after a reconnect).
static std::atomic<bool>        s_connected{false};
static std::atomic<bool>        s_announce{false};   // set on connect -> task re-announces (consumed
                                                     // once via exchange(false) so a reconnect can't
                                                     // be lost to a racing clear)

// RAII guard around s_mtx (same idiom as config.cpp / hp_poll.cpp). Replaces the raw take/give pairs
// so a throw on a reader (the broker copy in mqtt_status) can't strand the mutex and wedge every
// later reader/writer at portMAX_DELAY.
namespace {
struct Lock {
    explicit Lock(SemaphoreHandle_t m) : m_(m) { if (m_) xSemaphoreTake(m_, portMAX_DELAY); }
    ~Lock() { if (m_) xSemaphoreGive(m_); }
    SemaphoreHandle_t m_;
};
}  // namespace

// Persisted so the pointers handed to esp-mqtt (and reused by the task) stay valid.
static std::string s_uri, s_user, s_pass, s_node, s_base, s_prefix, s_avail, s_state, s_heartbeat, s_crash;
static std::string s_announced_profile;               // profile we last published discovery for (mqtt_task only)
static std::string s_last_json;                       // last state JSON published (dedup guard; mqtt_task only)
// Written false by the event task on DISCONNECT, written true + read by the publish task -> atomic.
static std::atomic<bool> s_heartbeat_announced{false}; // diagnostic discovery streamed this connection?
static bool         s_mqtt_ever_connected = false;     // event-task-only: first connect vs. a RE-connect
static bool         s_crash_dump_pub      = false;     // mqtt_task-only: `coredump` flag last published on s_crash

// Cumulative publish counters for the heartbeat's mqtt.{count,fails,reconnects} — see mqtt_publish().
// pub_ok/pub_fail are touched only on the publish task (mqtt_publish + publish_heartbeat both run
// there), so they stay plain; reconnects is bumped on the EVENT task and read on the publish task, so
// it is atomic.
static uint32_t s_mqtt_pub_ok   = 0;
static uint32_t s_mqtt_pub_fail = 0;
static std::atomic<uint32_t> s_mqtt_reconnects{0};

// Heartbeat is diagnostics, not real-time telemetry — publish on a fixed cadence rather than on
// every poll cycle.
static constexpr int HEARTBEAT_INTERVAL_S = 10;

// Non-allocating under the lock: `err` is always a string literal, stored as a bare pointer. Runs on
// esp-mqtt's event task with no exception guard, so an allocating std::string assignment that threw
// would abort() — and, under a raw take/give, strand the mutex too. Both are gone now.
static void set_status(bool connected, const char* err) {
    Lock lk(s_mtx);
    s_status.connected = connected;
    if (err) s_error = err;
    else if (connected) s_error = "";
}

// node id daikin_<mac3> (STA MAC low 3 bytes) — stable across config changes.
static std::string node_id() {
    uint8_t m[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, m);
    char b[20];
    std::snprintf(b, sizeof(b), "daikin_%02x%02x%02x", m[3], m[4], m[5]);
    return b;
}

// Every outbound publish funnels through here so the heartbeat's mqtt.count/mqtt.fails (the
// EMS-ESP-style "mqttcount"/"mqttfails" pair) reflect every discovery/state/heartbeat/availability
// message, not just one of them. esp_mqtt_client_publish() returns the message id (>=0) on success
// or -1 if it couldn't even be queued (e.g. dropped mid-disconnect).
static void mqtt_publish(const std::string& topic, const char* payload, int len, int qos, int retain) {
    const int rc = esp_mqtt_client_publish(s_client, topic.c_str(), payload, len, qos, retain);
    if (rc >= 0) s_mqtt_pub_ok++; else s_mqtt_pub_fail++;
    // Feed the watchdog per completed publish — mirrors poll_once's per-register reset. A single
    // (re)connect cycle bursts ~30 publishes (discovery + crash + state + heartbeat), and each
    // esp_mqtt_client_publish() can block up to the client's network timeout; without this a
    // slow-but-alive broker/link could push one burst past the 20 s budget and reboot a task that
    // is still making progress. This runs only in mqtt_pub (the sole caller path), which is
    // subscribed, so a genuinely wedged write still trips the timeout — a progressing one never does.
    esp_task_wdt_reset();
}

// Layout-marker / grid converters carry no measured value (docs/REGISTERS.md §3.6) — no sensor.
static bool is_publishable(int conv) { return !(conv == 0 || (conv >= 995 && conv <= 999)); }

// Current publishable values from the poll cache, grouped by register page (skip "no data"). The
// scratch buffer is sized to the active profile's row count — an exact upper bound on the cached
// value count, so nothing is truncated out of the JSON without over-allocating a fixed worst case.
static std::vector<GroupedValue> current_grouped() {
    const size_t cap = def::lookup(config().profile.c_str()).count;
    std::vector<CachedValue> cache(cap ? cap : 1);
    const size_t n = hp_values_snapshot(cache.data(), cache.size());
    std::vector<GroupedValue> out;
    out.reserve(n);
    for (size_t i = 0; i < n; i++) {
        if (cache[i].value.empty()) continue;
        out.push_back({group_for_page(cache[i].reg), object_id(cache[i].label.c_str()),
                       cache[i].value});
    }
    return out;
}

// Stream one retained discovery config per value of the active profile. Every sensor points at the
// one shared state topic (s_state) and pulls its value out via a value_template.
static void publish_discovery() {
    const auto& prof = def::lookup(config().profile.c_str());
    for (size_t i = 0; i < prof.count; i++) {
        const ValueDef& d = prof.values[i];
        if (!is_publishable(d.conv)) continue;
        const std::string obj = object_id(d.label);
        if (obj.empty()) continue;
        const std::string ct  = discovery_topic(s_prefix, s_node, d);
        const std::string cfg = discovery_config(s_node, s_state, s_avail, d);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
}

// Build + publish the grouped state JSON to the shared topic, but only when it changed since the
// last publish (`force` overrides for the post-(re)connect seed). Returns true if it published.
static bool publish_state(bool force) {
    const std::string js = build_grouped_json(current_grouped());
    if (!force && js == s_last_json) return false;
    mqtt_publish(s_state, js.c_str(), static_cast<int>(js.size()), 0, 1);       // retained
    s_last_json = js;
    return true;
}

// Stream one retained discovery config per diagnostic sensor (logic/heartbeat.hpp). These describe
// the ESP32 board + X10A link itself, not a heat-pump value, so — unlike publish_discovery() —
// they don't wait on profile detection: WiFi signal and free heap are meaningful even while
// profile == "auto".
static void publish_heartbeat_discovery() {
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
        const HeartbeatSensor& s = HEARTBEAT_SENSORS[i];
        const std::string ct  = heartbeat_discovery_topic(s_prefix, s_node, s);
        const std::string cfg = heartbeat_discovery_config(s_node, s_heartbeat, s_avail, s);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
}

// Crash/reset diagnostics (logic/crashinfo.hpp): stream the two diagnostic discovery configs, then
// RETAIN the boot-time crash summary on <base>/<node>/crash. The payload is captured once at boot
// (diag_crash.cpp) so it never changes at runtime — retained + published once per (re)connect means
// a late subscriber (Home Assistant, or Telegraf → VictoriaLogs) still sees the last reset. It is
// ALWAYS published (even a clean boot reports reason="sw"/"poweron"), so the "Last Reset Reason"
// sensor reflects the current boot instead of a stale crash. Never carries secrets or the raw dump —
// just the reason + a raw-hex backtrace; the full binary stays behind GET /coredump.
static void publish_crash() {
    for (int i = 0; i < CRASH_SENSOR_COUNT; i++) {
        const CrashSensor& s = CRASH_SENSORS[i];
        const std::string ct  = crash_discovery_topic(s_prefix, s_node, s);
        const std::string cfg = crash_discovery_config(s_node, s_crash, s_avail, s);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
    // _live(): the "Crash Dump Waiting" binary_sensor must not latch ON once the dump is pulled +
    // cleared — this topic is RETAINED, so a stale true would be replayed to every later subscriber.
    const CrashInfo   ci = diag_crash_info_live();
    const std::string js = build_crash_json(ci);
    mqtt_publish(s_crash, js.c_str(), static_cast<int>(js.size()), 0, 1);   // retained
    s_crash_dump_pub = ci.coredump;
}

// Snapshot board/link diagnostics from the IDF heap/timer APIs + the poll/WiFi/MQTT state, and
// publish it to the heartbeat topic (not retained). Called on a fixed HEARTBEAT_INTERVAL_S cadence
// (mqtt_task) — diagnostics, not real-time telemetry, so unlike the state topic it always publishes
// rather than only on change.
static void publish_heartbeat() {
    HpStats  hp = hp_stats();
    WifiInfo wi = wifi_info();
    HeartbeatFields f;
    f.version         = esp_app_get_description()->version;
    f.platform        = CONFIG_IDF_TARGET;
    f.uptime_ms       = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    f.free_heap       = esp_get_free_heap_size();
    f.min_free_heap   = esp_get_minimum_free_heap_size();
    f.max_alloc       = heap_caps_get_largest_free_block(MALLOC_CAP_DEFAULT);
    f.reset_reason    = reset_reason_name(diag_crash_info().reason);   // cached boot reason (diag_crash.cpp)
    if (time_synced()) {
        int64_t unix_s; int32_t ms;
        time_now(unix_s, ms);
        f.time = rfc3339_utc(unix_s, ms);
    }
    f.wifi_connected  = wi.connected;
    f.wifi_rssi       = wi.rssi;
    f.wifi_reconnects = wifi_reconnect_count();
    f.mqtt_connected  = s_connected;
    f.mqtt_count      = s_mqtt_pub_ok;
    f.mqtt_fails      = s_mqtt_pub_fail;
    f.mqtt_reconnects = s_mqtt_reconnects;
    f.bus_connected   = hp.connected;
    f.bus_proto       = static_cast<char>(config().proto);
    f.registers       = hp.registers;
    f.values          = hp.values;
    f.crc_err         = hp.crc_err;
    f.timeout_err     = hp.timeout_err;
    f.rx_received     = hp.rx_ok;
    f.rx_fails        = hp.rx_fail_total;
    f.last_ok_s       = hp.last_ok_s;

    const std::string js = build_heartbeat_json(f);
    mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);   // not retained
}

static void on_mqtt(void*, esp_event_base_t, int32_t id, void* data) {
    switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
        if (s_mqtt_ever_connected) s_mqtt_reconnects.fetch_add(1);   // a later CONNECTED is a RE-connect
        s_mqtt_ever_connected = true;
        s_connected = true; s_announce = true; set_status(true, nullptr);
        diag_printf("mqtt: connected\n");
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false; s_heartbeat_announced = false; set_status(false, nullptr);
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

// Publish task: announce on (re)connect / profile change, then publish the grouped state JSON when
// it changes. The per-cycle body is guarded — an OOM std::string build must skip the cycle, not
// throw through the FreeRTOS task and reboot the device.
static void mqtt_task(void*) {
    esp_task_wdt_add(NULL);                            // watch the publish task for a wedged broker write
    int heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S;    // publish immediately on the first connected cycle
    for (;;) {
        // Feed the watchdog unconditionally at the top of every cycle — the loop wakes each second
        // regardless of connection state, so this must NOT be gated on s_connected or an actual
        // publish, or a long MQTT disconnect (no publishes) would false-trip the timeout.
        esp_task_wdt_reset();
        const int delay_s = POLL_INTERVAL_S;

        try {
            if (s_connected) {
                if (s_announce.exchange(false)) {              // consume: just (re)connected
                    s_announced_profile.clear();               // force a fresh discovery below
                    s_last_json.clear();                       // force a full state re-seed
                    // Force the board/link diagnostic discovery to re-publish on THIS (re)connect. The
                    // disconnect handler also clears s_heartbeat_announced, but a DISCONNECT landing
                    // mid-discovery (after the check below, before the publishes finish) could leave it
                    // stuck true and skip discovery after the next reconnect. Tying the reset to the
                    // announce — set on EVERY connect — closes that race.
                    s_heartbeat_announced = false;
                    heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S; // publish it right away, then every 10 s
                    mqtt_publish(s_avail, "online", 0, 0, 1);
                }
                if (!s_heartbeat_announced) {                  // board/link diagnostics — independent
                    publish_heartbeat_discovery();              // of heat-pump profile detection
                    publish_crash();                            // last reset reason + dump-waiting flag
                    s_heartbeat_announced = true;
                }
                const std::string prof = config().profile;
                if (prof != "auto" && prof != s_announced_profile) {
                    publish_discovery();                       // discovery for the (new) profile
                    s_announced_profile = prof;
                    publish_state(true);                       // full retained seed
                } else if (!s_announced_profile.empty() && prof == s_announced_profile) {
                    publish_state(false);                      // republish only when it changed
                }
                // prof == "auto" (detection pending): wait — don't publish transient generic sensors.

                // Fixed HEARTBEAT_INTERVAL_S cadence — diagnostics, not real-time telemetry, so it
                // doesn't need the state topic's every-cycle publish-on-change treatment.
                heartbeat_elapsed_s += delay_s;
                if (heartbeat_elapsed_s >= HEARTBEAT_INTERVAL_S) {
                    publish_heartbeat();
                    // The crash topic is RETAINED but otherwise only published once per connect, so a
                    // dump pulled + cleared (/coredump?clear=1) mid-session would leave HA's "Crash
                    // Dump Waiting" ON until the next reconnect. Re-check on the heartbeat cadence
                    // (one 4-byte flash read, no summary parse) and republish only on a real change.
                    // Done HERE, not in the /coredump handler: mqtt_publish() feeds the Task Watchdog
                    // and is only valid from this (subscribed) task.
                    if (diag_crash_coredump_present() != s_crash_dump_pub) publish_crash();
                    heartbeat_elapsed_s = 0;
                }
            }
        } catch (const std::exception& e) {
            diag_printf("mqtt: publish skipped (%s)\n", e.what());
        } catch (...) {
            diag_printf("mqtt: publish skipped (oom?)\n");
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
    { Lock lk(s_mtx); s_status.tls = is_tls; }
    return true;
}

void mqtt_ha_start() {
    const Config& c = config();
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("mqtt: status mutex alloc failed — status reads run unsynchronized\n");
    s_status.configured = !c.mqtt_uri.empty();
    s_status.broker     = c.mqtt_uri;
    if (!s_status.configured) return;

    s_node   = node_id();
    s_base   = CONFIG_DAIKIN_MQTT_BASE_TOPIC;
    s_prefix = CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX;
    s_avail     = availability_topic(s_base, s_node);
    s_state     = state_topic(s_base, s_node);
    s_heartbeat = heartbeat_topic(s_base, s_node);
    s_crash     = crash_topic(s_base, s_node);

    if (!build_client()) return;                               // policy error already surfaced
    esp_mqtt_client_start(s_client);
    if (xTaskCreate(mqtt_task, "mqtt_pub", 4096, nullptr, 4, nullptr) != pdPASS) {
        // No publish task -> discovery/state/heartbeat never go out. The client keeps its connection
        // (and LWT), but say so rather than looking configured-but-silent in /status.
        set_status(false, "publish task alloc failed");
        diag_printf("mqtt: publish task alloc failed — no MQTT publishing this boot\n");
    }
}

MqttStatus mqtt_status() {
    if (!s_mtx) return s_status;
    Lock lk(s_mtx);
    MqttStatus st = s_status;   // reader may allocate under an RAII lock (the broker std::string copy)
    st.error = s_error;         // error is kept as a literal pointer; stringified here, under the lock
    return st;
}

} // namespace daik
