// Home Assistant MQTT-Discovery bridge (see mqtt_ha.hpp + docs/ARCHITECTURE.md → MQTT bridge).
// esp-mqtt client in its own publish task:
//   • TLS policy: credentials present ⇒ mqtts:// + CA-verified (esp_crt_bundle); NEVER send
//     credentials over plaintext (no silent fallback — refuse with an error in /status.mqtt).
//   • X10A owns the outbound installation identity, not inbound observation: before the first valid
//     X10A reply, connect without the shared installation LWT and service only the configured
//     reference-temperature subscription/test. The first reply replaces that read-only session with
//     the normal LWT-bearing publisher. After activation, a bus loss lasting 15 seconds marks
//     availability offline once and then suppresses every ordinary publish until X10A returns;
//     subscriptions stay alive. A shorter whole-sweep dropout neither flaps availability nor emits
//     an empty X10A document.
//   • On (re)connect: mark availability "online", stream retained discovery configs for the active
//     X10A profile, diagnostics and enabled ENV III, and retract every retired HomeHub/weather
//     discovery config. HomeHub values stay on MQTT for non-HA consumers, but are deliberately not
//     exposed as HA entities; weather has no HA entities either.
//   • Each cycle: publish X10A's grouped JSON to <base>/x10a, the generation-checked flat HomeHub
//     JSON to <base>/modbus, and — only while Open-Meteo is configured — an atomic
//     forecast/provenance snapshot to <base>/weather/openmeteo/forecast when changed, plus each fresh
//     ENV III sample on <base>/env3.
//     A disconnected HomeHub publishes `{}`, and an unavailable/stale ENV III omits its three
//     readings (keeping only its samples/errors I2C counters), rather than carrying an old
//     reading forward. Message topics sit directly under
//     <base> — one board per base topic; the node
//     id identifies the DEVICE only in each discovery config's uniq_id/dev.ids + the
//     <prefix>/<component>/<node>/<group>_<object_id> discovery topic. That node id is derived from
//     the BASE TOPIC (logic/ha_device.hpp), not from the board's MAC, so replacing the ESP32 keeps
//     ONE HA device and its entities; this board's MAC-derived id stays on as the MQTT client id and
//     a second dev.ids entry (HA merges on it, so an install upgrading from a MAC-identified build
//     keeps its device). The entity id carries the REGISTER GROUP because uniq_id and the discovery
//     topic are flat namespaces while a label is unique only within its page (#221). The configs an
//     older build published under a superseded identity — the MAC node id, and the un-grouped entity
//     ids — are retracted in one pass before any replacement goes out.
//   • Every HEARTBEAT_INTERVAL_S (10 s): rebuild + publish board/link diagnostics
//     (logic/heartbeat.hpp) to <base>/heartbeat and the separately grouped room-source/heating-curve
//     evidence (logic/heating_curve_mqtt.hpp) to <base>/heating_curve. Both use a fixed cadence,
//     unlike real-time source topics which publish on change.
//   • Once per (re)connect: RETAIN the boot-time crash summary (logic/crashinfo.hpp) on <base>/crash
//     ONLY when the reset was a real fault or a core-dump is still in flash. On a normal boot, probe
//     the topic and delete it only if the broker still holds an older crash; a clean broker gets no
//     empty publish, so live MQTT clients do not invent a payload-less /crash node. When a crash IS
//     reported it drives one diagnostic HA entity — a "dump waiting" flag (the reset reason
//     is the heartbeat's own "Reset Reason" sensor, so a crash entity for it would be a duplicate).
//     Reason/backtrace only; never the raw dump or any secret.
// Read-only with respect to plant commands: one logical room source may assemble temperature,
// target and source time from three exact topics (or use a fixed target). Bounded exact-topic probes
// also look for actually-retained <base>/state,
// <base>/modbus/status and resolved <base>/crash payloads; a clean broker receives no empty publish
// on any of them.
// No-op if mqtt_uri is empty. Memory-safe: discovery is one small publish per value; the state JSON
// is a single few-KB build, guarded against OOM.
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "config.hpp"
#include "checkup.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "heap_guard.hpp"
#include "stack_watch.hpp"
#include "env3.hpp"
#include "hp_poll.hpp"
#include "hp_modbus.hpp"
#include "history.hpp"
#include "logic/availability.hpp"
#include "logic/convert.hpp"   // conv_is_binary, published_kind — a row's wire type and entity domain
#include "logic/crashinfo.hpp"
#include "logic/conv_override.hpp"
#include "logic/discovery.hpp"
#include "logic/env3.hpp"
#include "logic/fault_state.hpp"
#include "logic/ha_device.hpp"
#include "logic/heating_curve_mqtt.hpp"
#include "logic/heartbeat.hpp"
#include "logic/mqtt_base.hpp"   // mqtt_base_effective — the installation's base topic, host-tested
#include "logic/mqtt_group.hpp"
#include "logic/mqtt_publish_gate.hpp"
#include "logic/ota_quiesce.hpp"   // stand aside while an OTA/weather TLS op owns the heap (#380)
#include "logic/reference_temperature.hpp"
#include "logic/reset_reason.hpp"
#include "logic/weather_mqtt.hpp"
#include "esp_mac.h"
#include "ota_update.hpp"          // ota_download_active — the flag the quiesce above reads
#include "sntp_time.hpp"
#include "weather_forecast.hpp"
#include "wifi.hpp"

#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"   // the allocation-free heap snapshot the publish-skip catch logs (issue 10 E)
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "mqtt_client.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp"   // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/queue.h"
#include "freertos/task.h"

#include "cJSON.h"

#include <atomic>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <string_view>
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
static std::atomic<bool>        s_ref_reconfigure{false};
static std::atomic<bool>        s_circulation_reconfigure{false};
static std::atomic<bool>        s_circulation_probe_reconfigure{false};
static std::atomic<bool>        s_weather_cleanup_requested{false};
static std::atomic<bool>        s_modbus_cleanup_requested{false};

// The task starts a subscriber-only client immediately, then replaces it with an LWT-bearing client
// after the first X10A proof. Definitions live beside the client builder below; forward declarations
// keep the publish loop above the configuration/lifecycle glue without duplicating either contract.
static bool build_client(bool publisher_lwt);
static bool start_current_client();
static bool promote_client_to_publisher();

// MQTT_EVENT_DATA runs on esp-mqtt's unguarded event task. It therefore only copies into this one
// bounded frame and posts it to a queue; JSON parsing and all std::string work stay on the
// exception-guarded mqtt_task. 1024 B comfortably covers the 435 B Shelly test payload while keeping
// an accidentally huge subscribed document from consuming the ESP32 heap.
//
// THE QUEUE HOLDS MORE THAN ONE FRAME, and that is not headroom for its own sake. It was length 1
// with xQueueOverwrite (keep-newest) when exactly ONE topic was subscribed (#318). Since then the
// circulation witness (#361) added a second SAVED source and a pre-save probe, while the
// retained-cleanup migration added four more subscriptions — and the drain still happens once per
// mqtt_task cycle, i.e. once a SECOND. Every frame arriving inside one cycle but the last was
// discarded, unread, with nothing logged.
//
// That is not a rare race: the circulation witness is a smart plug publishing at roughly 1 Hz, which
// is precisely what #367's pulse tracking is written for. With a three-topic room source configured
// beside it, room frames would otherwise be dropped continuously.
//
// Eight slots (8 x ~1.2 KB, allocated once at MQTT start) cover the room source's three independent
// value topics, the saved/probed circulation source and cleanup bursts inside one drain interval.
// On overflow the NEWEST frame is dropped rather than
// the oldest: everything queued is drained in the same cycle a moment later, so the difference is
// at most one second of age, and drop-newest needs no second 1.2 KB scratch frame to shuffle
// through. The count is reported, because a silent drop here is exactly what hid this for two
// releases.
static constexpr size_t REF_QUEUE_DEPTH = 8;
static constexpr size_t REF_TEMP_PAYLOAD_MAX = 1024;
struct ReferenceMqttFrame {
    char   topic[REF_TEMP_TOPIC_MAX + 1] = {0};
    char   payload[REF_TEMP_PAYLOAD_MAX + 1] = {0};
    size_t payload_len = 0;
    uint64_t received_ms = 0;
    int64_t received_unix_s = -1;
    bool   retained = false;
};
static QueueHandle_t       s_ref_queue = nullptr;
static ReferenceMqttFrame  s_ref_rx;
static ReferenceMqttFrame  s_ref_task_frame;          // mqtt_task-owned; keeps ~1.2 KB off its stack
static bool                s_ref_rx_active = false;
// Written by the event task, read + reported by mqtt_task — the same split as the flags above, and
// std::atomic for the reason stated there. Relaxed ordering: it is a counter, ordering nothing and
// synchronising nothing, and taking a lock on the event task is what this hand-off exists to avoid.
static std::atomic<uint32_t> s_ref_dropped{0};
static uint32_t            s_ref_dropped_reported = 0;
static ReferenceTemperatureStatus s_ref_status;
static logic::HeatingCurveDiagnosis s_heating_curve_diagnosis;  // guarded by s_mtx
inline constexpr size_t REF_VALUE_TOPIC_COUNT = 3;
using ReferenceTopicSet = std::array<std::string, REF_VALUE_TOPIC_COUNT>;
static ReferenceTopicSet s_ref_subscribed_topics;  // mqtt_task only
static bool                s_ref_subscription_announced = false; // one success line per binding
static std::string         s_ref_binding_topic;     // resets captured value when either half changes
static std::string         s_ref_binding_path;
static std::string         s_ref_binding_setpoint_topic;
static std::string         s_ref_binding_setpoint_path;
static uint16_t            s_ref_binding_fixed_setpoint_tenths = 0;
static std::string         s_ref_binding_time_topic;
static std::string         s_ref_binding_time_path;
static std::string         s_ref_binding_enabled_path;
static std::string         s_ref_binding_hvac_mode_path;
static bool                s_ref_capture_enabled = false; // saved mapping may remain while OFF
static std::string         s_ref_last_logged_error;       // mqtt_task only; rate-limits bad mappings
static uint64_t            s_ref_last_error_log_ms = 0;
static bool reference_topic_owned(const std::string& topic);

static CirculationSourceStatus s_circulation_status;
static CirculationPowerTracker s_circulation_tracker;
struct CirculationProbeState {
    CirculationSourceTestConfig config;
    uint32_t generation=0;
    bool active=false, subscribed=false, passed=false, retained=false;
    double power_w=0.0;
    CirculationPowerState state=CirculationPowerState::Unknown;
    std::string error;
};
static CirculationProbeState s_circulation_probe;
static SemaphoreHandle_t s_circulation_probe_sem = nullptr;
static std::string s_circulation_subscribed_topic;
static std::string s_circulation_probe_subscribed_topic;
static uint32_t s_circulation_probe_task_generation = 0;
static std::string s_circulation_binding_topic;
static std::string s_circulation_binding_power_path;
static std::string s_circulation_binding_time_path;
static bool s_circulation_capture_enabled = false;
static uint32_t s_circulation_runtime_max_age_s = CIRC_SOURCE_MAX_AGE_DEFAULT_S; // guarded by s_mtx

// RAII guard around s_mtx (same idiom as config.cpp / hp_poll.cpp). Replaces the raw take/give pairs
// so a throw on a reader (the broker copy in mqtt_status) can't strand the mutex and wedge every
// later reader/writer at portMAX_DELAY.
namespace {
// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
using Lock = SemGuard;
}  // namespace

// Persisted so the pointers handed to esp-mqtt (and reused by the task) stay valid.
static std::string s_uri, s_user, s_pass, s_node, s_board, s_base, s_prefix, s_avail, s_x10a,
                   s_modbus, s_weather, s_env3, s_retired_weather, s_retired_modbus_status,
                   s_legacy_state, s_heartbeat, s_heating_curve_topic, s_crash;
static std::string s_announced_profile;               // profile we last published discovery for (mqtt_task only)
static uint64_t    s_last_x10a_digest = 0;            // per-topic dedup guards (mqtt_task only):
                                                      // fnv1a64 of the last X10A payload — the old
                                                      // full-string copy cost a permanent ~3 KB block
                                                      // and one copy per cycle (private issue 10)
static std::string s_last_modbus_json;
static std::string s_last_weather_json;
static std::string s_last_env3_json;
// Rate-limit the hard-cap diagnostic. The payload itself is no longer boot-long storage: dev.12's
// persistent cache/group vectors and dev.13's static 12 KiB JSON block made the live 129-row board
// permanently unable to build /status. The two-pass cache accessor below allocates exactly one
// changed payload only for the synchronous QoS0 call and releases it immediately afterwards.
static bool        s_x10a_json_oversize_logged = false;
static bool                          s_last_x10a_digest_valid = false;
static uint32_t    s_last_env3_samples          = 0;
static bool        s_modbus_disabled_cleaned    = false;
static bool        s_env3_disabled_cleaned      = false;
static bool        s_env3_discovery_announced   = false;
// Retained-topic cleanup: probe retired topics and a resolved crash without unconditionally
// publishing empty payloads on every reconnect. The event task only raises each `seen` flag;
// subscribe/delete/unsubscribe remain on mqtt_task, preserving the
// single-publisher rule. The
// bounded probes repeat on reconnect until an old value is found and deleted; once the broker is
// clean they are read-only and silent.
static std::atomic<bool> s_legacy_state_seen{false};
static std::atomic<bool> s_retired_modbus_status_seen{false};
static std::atomic<bool> s_retired_weather_seen{false};
static std::atomic<bool> s_crash_seen{false};
static bool              s_legacy_probe_active = false;               // mqtt_task only
static bool              s_retired_modbus_status_probe_active = false; // mqtt_task only
static bool              s_retired_weather_probe_active = false;      // mqtt_task only
static bool              s_crash_probe_active = false;                // mqtt_task only
static int64_t           s_legacy_probe_deadline_us = 0;              // mqtt_task only
static int64_t           s_retired_modbus_status_probe_deadline_us = 0; // mqtt_task only
static int64_t           s_retired_weather_probe_deadline_us = 0;     // mqtt_task only
static int64_t           s_crash_probe_deadline_us = 0;               // mqtt_task only
static bool              s_disabled_weather_cleaned = false;          // mqtt_task only
// Stale-identity migration (mqtt_task only) — see retract_legacy_fixed / retract_stale_values below.
static bool        s_legacy_fixed_retracted = false;   // heartbeat + crash entities: once per boot
static std::string s_stale_values_profile;             // value entities: the profile they were
                                                       // retracted for ("" = not yet). Keyed on the
                                                       // profile, not a bool, because the row set IS
                                                       // the profile: a re-detect (POST /detect, or
                                                       // an ambiguous first fingerprint settling)
                                                       // brings rows the earlier pass never saw.
// Written false by the event task on DISCONNECT, written true + read by the publish task -> atomic.
static std::atomic<bool> s_heartbeat_announced{false}; // diagnostic discovery streamed this connection?
static bool         s_mqtt_ever_connected = false;     // event-task-only: first connect vs. a RE-connect
static std::atomic<bool> s_client_is_publisher{false};  // set before this client's event task starts
static bool         s_crash_dump_pub      = false;     // mqtt_task-only: `coredump` at last crash-topic sync
static bool         s_crash_notable_pub   = false;     // mqtt_task-only: was that sync a crash publish or cleanup probe?

// Cumulative publish counters for the heartbeat's mqtt_{count,fails,reconnects} — see mqtt_publish().
// pub_ok/pub_fail are touched only on the publish task (every helper funnels through mqtt_publish),
// so they stay plain; reconnects is bumped on the EVENT task and read on the publish task, so it is
// atomic.
static uint32_t s_mqtt_pub_ok   = 0;
static uint32_t s_mqtt_pub_fail = 0;
static std::atomic<uint32_t> s_mqtt_reconnects{0};

// Publish cycles that produced NOTHING, split by cause — the heartbeat's mqtt_skipped/mqtt_quiesced
// (#380). Both are written only on the publish task, but they are read by the /status builder on the
// httpd task, so they are atomic rather than plain like pub_ok/pub_fail above. `skipped` is bumped
// from inside the OOM catch handler, where an atomic add is the only kind of bookkeeping that is
// guaranteed not to throw a second time.
static std::atomic<uint32_t> s_mqtt_skipped{0};
static std::atomic<uint32_t> s_mqtt_quiesced{0};
static std::atomic<bool> s_x10a_publish_required{false};
static std::atomic<bool> s_x10a_publish_proven{false};
static std::atomic<bool> s_publish_network_quiesced{true};
static std::atomic<bool> s_transport_connecting{false};
static_assert(std::atomic<bool>::is_always_lock_free,
              "MQTT network quiesce acknowledgement must remain allocation- and lock-free");

// The held branch publishes the acknowledgement directly. Every non-held cycle owns this guard,
// so the bit returns to true even when an allocation throws into the task's exception boundary.
struct MqttPublishActivity {
    MqttPublishActivity() {
        s_publish_network_quiesced.store(false, std::memory_order_release);
    }
    ~MqttPublishActivity() {
        s_publish_network_quiesced.store(true, std::memory_order_release);
    }
};

static bool competing_tls_active() {
    return ota_download_active() || weather_fetch_active();
}

// HTTP/OTA is already reachable when app_main calls mqtt_ha_start(). Claim the publish allocator
// before the very first Config/topic/client allocation, then either hand ownership to mqtt_task or
// restore "no task" on every early return. This closes the pre-xTaskCreate startup window without
// adding a mutex or an allocating status read to the network gate.
struct MqttStartupActivity {
    MqttStartupActivity() {
        // HTTP/OTA already exists. Claim, recheck, and yield the claim if that owner won first. If
        // the owner rises after a successful recheck it sees our false acknowledgement and waits.
        // This is the same two-party handshake as BEFORE_CONNECT, applied before config() allocates.
        const TickType_t started = xTaskGetTickCount();
        const TickType_t max_wait = pdMS_TO_TICKS(OTA_QUIESCE_MAX_CYCLES * 1000u);
        for (;;) {
            s_publish_network_quiesced.store(false, std::memory_order_release);
            if (!competing_tls_active()) return;
            s_publish_network_quiesced.store(true, std::memory_order_release);
            if (xTaskGetTickCount() - started >= max_wait) {
                s_publish_network_quiesced.store(false, std::memory_order_release);
                return;
            }
            vTaskDelay(pdMS_TO_TICKS(250));
        }
    }
    ~MqttStartupActivity() {
        if (handed_off) return;
        s_publish_network_quiesced.store(true, std::memory_order_release);
    }
    void hand_off() { handed_off = true; }
    bool handed_off = false;
};

// Heartbeat is diagnostics, not real-time telemetry — publish on a fixed cadence rather than on
// every poll cycle.
static constexpr int HEARTBEAT_INTERVAL_S = 10;
// A retained tombstone is not stored by the broker. If HA was offline during the firmware's MQTT
// connect, it would miss that removal and keep the old registry entities. Repeating this low-volume
// retirement burst makes cleanup eventually reliable without ever reintroducing a config payload.
static constexpr int HA_RETIRE_INTERVAL_S = 5 * 60;
static constexpr int64_t RETIRED_TOPIC_PROBE_US = 5LL * 1000 * 1000;

// Non-allocating under the lock: `err` is always a string literal, stored as a bare pointer. Runs on
// esp-mqtt's event task with no exception guard, so an allocating std::string assignment that threw
// would abort() — and, under a raw take/give, strand the mutex too. Both are gone now.
static void set_status(bool connected, const char* err) {
    Lock lk(s_mtx);
    s_status.connected = connected;
    if (err) s_error = err;
    else if (connected) s_error = "";
}

// This BOARD's own id, daikin_<mac3> (STA MAC low 3 bytes). It is the MQTT client id (which must be
// unique per connection — two boards briefly online during a swap must not kick each other off the
// broker) and a second `dev.ids` entry so HA merges an install that was set up under the old
// MAC-based identity into the one device. It is NOT the HA device id any more: that is s_node,
// derived from the base topic (logic/ha_device.hpp), so replacing the ESP32 keeps the device.
static std::string board_id() {
    uint8_t m[6] = {0};
    // Read the interface MAC from eFuse, not the WiFi driver. An Ethernet-first board intentionally
    // never initialises that driver; esp_wifi_get_mac() then fails and used to collapse every such
    // board onto daikin_000000, making them disconnect one another at the broker.
    const esp_err_t e = esp_read_mac(m, ESP_MAC_WIFI_STA);
    if (e != ESP_OK)
        diag_printf("mqtt: failed to read board MAC (%s)\n", esp_err_to_name(e));
    char b[20];
    std::snprintf(b, sizeof(b), "daikin_%02x%02x%02x", m[3], m[4], m[5]);
    return b;
}

// Every outbound publish funnels through here so the heartbeat's mqtt_count/mqtt_fails reflect
// every discovery/state/heartbeat/availability message, not just one of them. esp_mqtt_client_publish() returns the message id (>=0) on success
// or -1 if it couldn't even be queued (e.g. dropped mid-disconnect).
static bool mqtt_publish(const std::string& topic, const char* payload, int len, int qos, int retain) {
    const int rc = esp_mqtt_client_publish(s_client, topic.c_str(), payload, len, qos, retain);
    if (rc >= 0) s_mqtt_pub_ok++; else s_mqtt_pub_fail++;
    // Feed the watchdog per completed publish — mirrors poll_once's per-register reset. A single
    // (re)connect cycle bursts ~30 publishes (discovery + crash + state + heartbeat), and each
    // esp_mqtt_client_publish() can block up to the client's network timeout; without this a
    // slow-but-alive broker/link could push one burst past the 20 s budget and reboot a task that
    // is still making progress. This runs only in mqtt_pub (the sole caller path), which is
    // subscribed, so a genuinely wedged write still trips the timeout — a progressing one never does.
    esp_task_wdt_reset();
    return rc >= 0;
}

// Start and service one exact-topic retained cleanup probe. Both functions run only on mqtt_task;
// the esp-mqtt event task communicates the matching retained DATA event through `seen`. Keeping the
// broker write here preserves mqtt_publish()'s single-task watchdog/counter contract.
static void start_retained_cleanup_probe(const std::string& topic, std::atomic<bool>& seen,
                                         bool& active, int64_t& deadline_us,
                                         const char* diagnostic_name) {
    seen = false;
    const int sub_id = esp_mqtt_client_subscribe(s_client, topic.c_str(), 0);
    active = sub_id >= 0;
    deadline_us = esp_timer_get_time() + RETIRED_TOPIC_PROBE_US;
    if (sub_id < 0)
        diag_printf("mqtt: %s cleanup probe could not be queued\n", diagnostic_name);
}

static void service_retained_cleanup_probe(const std::string& topic, std::atomic<bool>& seen,
                                           bool& active, int64_t deadline_us) {
    if (!active) return;
    const bool retained_seen = seen.exchange(false);
    const bool probe_done = esp_timer_get_time() >= deadline_us;
    if (retained_seen) {
        // QoS 1 makes the one required delete durable at the broker. Later reconnect probes receive
        // nothing and therefore publish nothing — no visible empty topic is recreated.
        mqtt_publish(topic, "", 0, 1, 1);
    }
    if (retained_seen || probe_done) {
        esp_mqtt_client_unsubscribe(s_client, topic.c_str());
        active = false;
    }
}

// Current HomeHub values, but only when the accessor proves the copied cache belongs to the TCP
// session that is still connected. The register definition supplies the permanent JSON type. Only
// Text16 is text; flags, enums and ordinary values retain their numeric Modbus constants.
static std::vector<GroupedValue> current_modbus_values(bool& live) {
    const size_t cap = mb_values_capacity();
    std::vector<CachedValue> cache(cap ? cap : 1);
    const size_t n = mb_values_snapshot(cache.data(), cache.size(), live);
    std::vector<GroupedValue> out;
    if (!live) return out;
    out.reserve(n);
    for (size_t i = 0; i < n; i++) {
        if (cache[i].value.empty()) continue;
        const def::HomeHubReg* reg = def::homehub_find(cache[i].off);
        if (!reg) continue;   // fail closed: an untyped field must not reach a typed MQTT contract
        out.push_back({"modbus", object_id(reg->label), cache[i].value,
                       def::homehub_is_text(*reg) ? PublishedKind::Text : PublishedKind::Number});
    }
    return out;
}

// ── Legacy (MAC-identified) discovery configs ────────────────────────────────────────────────────
// Builds up to this one identified the HA DEVICE by this board's MAC (node id daikin_<mac3>), so
// replacing the ESP32 produced a SECOND "Daikin Altherma" device in HA and every entity — with it,
// every long-term statistic — started over. The device id now comes from the MQTT base topic
// (logic/ha_device.hpp): the installation, not the hardware.
//
// The configs published under the old MAC id are RETAINED, so they would otherwise outlive the
// change and keep their entities as permanently-unavailable duplicates. Each is deleted
// (zero-length retained publish) exactly once per boot and — crucially — BEFORE the replacement
// config for the same entity goes out: HA drops the old registry entry, freeing its entity_id, and
// the new entity (same device, since the board id rides along in dev.ids and HA merges on it; same
// name) takes that entity_id back. History and statistics are keyed by entity_id and carry over;
// per-entity UI customisations are keyed by unique_id and do not.
//
// Only THIS board's own legacy topics can be retracted — a board that has already been swapped out
// is gone and cannot clean up after itself. docs/HOME_ASSISTANT.md says how to remove its leftovers.
static void retract_legacy_fixed() {   // heartbeat + crash entities (no profile needed)
    if (s_board == s_node) {           // ids coincide -> there is no separate legacy identity
        s_legacy_fixed_retracted = true;
        return;
    }
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        mqtt_publish(heartbeat_discovery_topic(s_prefix, s_board, HEARTBEAT_SENSORS[i]), "", 0, 0, 1);
    for (int i = 0; i < RETIRED_HEARTBEAT_SENSOR_COUNT; i++)
        mqtt_publish(heartbeat_discovery_topic(s_prefix, RETIRED_HEARTBEAT_SENSORS[i].component,
                                               s_board, RETIRED_HEARTBEAT_SENSORS[i].object_id),
                     "", 0, 0, 1);
    for (int i = 0; i < CRASH_SENSOR_COUNT; i++)
        mqtt_publish(crash_discovery_topic(s_prefix, s_board, CRASH_SENSORS[i]), "", 0, 0, 1);
    for (int i = 0; i < RETIRED_CRASH_SENSOR_COUNT; i++)
        mqtt_publish(crash_discovery_topic(s_prefix, RETIRED_CRASH_SENSORS[i].component, s_board,
                                           RETIRED_CRASH_SENSORS[i].object_id), "", 0, 0, 1);
    // Latched AFTER the publishes, the rule retract_stale_values states and this function did not
    // follow: the topic builders allocate, so a bad_alloc part-way through unwinds to mqtt_task's
    // catch — and a guard already set would mean the remaining legacy configs are never retried for
    // the rest of the boot, leaving permanently-unavailable duplicate entities in HA with nothing
    // logged. On the equal-ids path above there is nothing to publish, so latching there is right.
    s_legacy_fixed_retracted = true;
}

// ── Ungrouped (pre-#221) value discovery configs ─────────────────────────────────────────────────
// Builds up to this one put only the LABEL SLUG in a value's entity id and discovery topic, leaving
// out the register group. Two rows sharing a label on different pages therefore landed on ONE topic
// under ONE uniq_id, and HA created one entity where the device publishes two — a unit reporting an
// outdoor fault and a hydronic one showed a single "Error Code" (#221). Both are now group-scoped.
//
// So every row has up to TWO stale retained configs per node id — the `sensor` form every build ever
// wrote, plus the `binary_sensor` form post-split builds wrote for a bit-flag row — and they are
// retained, so they outlive the upgrade as permanently-unavailable duplicates unless deleted.
static void retract_ungrouped_values(const logic::ProfileView& prof, const std::string& node) {
    for (size_t i = 0; i < prof.count(); i++) {
        const ValueDef  d = logic::adjudicated(prof[i]);   // wire truth, not the generator label
        // Every row an older build published — including a row that is detect-only (no_publish)
        // TODAY: it was a plain sensor before the flag existed, and that config is still retained.
        if (!conv_publishable(d.conv) || object_id(d.label).empty()) continue;
        mqtt_publish(ungrouped_discovery_topic(s_prefix, node, "sensor", d), "", 0, 0, 1);
        if (conv_is_binary(d.conv))
            mqtt_publish(ungrouped_discovery_topic(s_prefix, node, "binary_sensor", d), "", 0, 0, 1);
    }
}

// ── Relabelled (pre-label-override) value discovery configs (#230 A) ───────────────────────────────
// logic/label_override.hpp republishes a row under a spec-correct label when the generator's was
// wrong — today the four "Fan 1 (10 rpm)" fan-step rows, now announced as "Fan 1 (step)". The label
// is the entity id, so a build before the override published each such row under a DIFFERENT grouped
// id (actuators_fan_1_10_rpm), whose retained config would otherwise survive the upgrade as a
// permanently-unavailable duplicate. Delete it — built from the RAW (pre-override) label, which is
// exactly the "frozen literal" the migration needs: it is NOT what this build writes (that is now the
// adjudicated label), so discovery_topic(raw) targets the superseded config and nothing live.
// General over any future label override; fires only on a row a label override actually changed.
// (Unlike a rename, a VictoriaMetrics series cannot be carried across by any firmware action —
// actuators_fan_1_10_rpm simply stops and actuators_fan_1_step starts at zero for a unit on one of
// the four profiles; the reference install already published the majority _step spelling.)
static void retract_relabeled_values(const logic::ProfileView& prof, const std::string& node) {
    for (size_t i = 0; i < prof.count(); i++) {
        const ValueDef raw = prof[i];
        if (logic::label_str_eq(raw.label, logic::adjudicated(raw).label)) continue;  // no override here
        if (!conv_publishable(raw.conv) || object_id(raw.label).empty()) continue;
        // Every superseded shape the OLD label was ever published under: the #221 GROUPED id
        // (actuators_fan_1_10_rpm — every build since #232), and the pre-#221 UNGROUPED bare slug
        // (fan_1_10_rpm — for a device upgrading straight from before #221, skipping the grouped era).
        mqtt_publish(discovery_topic(s_prefix, node, raw), "", 0, 0, 1);
        mqtt_publish(ungrouped_discovery_topic(s_prefix, node, "sensor", raw), "", 0, 0, 1);
        if (conv_is_binary(raw.conv))
            mqtt_publish(ungrouped_discovery_topic(s_prefix, node, "binary_sensor", raw), "", 0, 0, 1);
    }
}

// All migrations at once, as ONE pass that completes before any replacement config is published.
// That ordering is the whole mechanism: HA frees a deleted entity's entity_id, and the replacement
// reclaims it — carrying recorder history and long-term statistics, which are keyed on entity_id.
// Doing the deletes in bulk rather than one-immediately-before-each-row also puts ~130 messages of
// separation between a removal and the add that wants its id back, instead of one.
//
// The MAC-era half must use the FROZEN topic shape too, not discovery_topic(): that helper now emits
// the grouped form, so building a legacy delete from it would delete a topic no build ever wrote and
// leave the real ones behind.
// The "done" guard is latched AFTER the passes, not before: an allocation failure part-way through
// throws out to the mqtt_task try/catch, and a guard already set would mean the remaining stale
// topics are never retried — every one of them a permanently-unavailable orphan entity, with no
// error visible anywhere. Retrying is free and idempotent (a zero-length retained publish to a topic
// already cleared is a no-op), so the failure mode should be "does it again", not "silently stops".
static void retract_stale_values(const logic::ProfileView& prof, const std::string& profile_id) {
    retract_ungrouped_values(prof, s_node);                          // #221: the un-grouped ids
    if (s_board != s_node) retract_ungrouped_values(prof, s_board);  // ...and the MAC-era device
    retract_relabeled_values(prof, s_node);                          // #230 A: superseded label ids
    if (s_board != s_node) retract_relabeled_values(prof, s_board);
    s_stale_values_profile = profile_id;
}

// Stream one retained discovery config per value of the active profile. Every entity points at the
// X10A topic (s_x10a) and pulls its value out via a value_template. A bit-flag row lands
// under the binary_sensor component, everything else under sensor (logic/discovery.hpp ha_component).
static void publish_x10a_discovery() {
    const std::string profile_id = config().profile;
    // The VIEW, not the raw profile: every row hp_poll caches needs a discovery config, and the
    // applicable overlay blocks (def/overlay.hpp) are part of that row set. Announcing fewer rows than the
    // X10A topic carries would leave the extra values in MQTT with no HA entity to land in.
    const auto prof = def::resolved(def::lookup(profile_id.c_str()));
    // Delete every config published under a superseded identity FIRST — the un-grouped ids (#221)
    // and, on a board that predates the base-topic device id, the MAC-era ones. The freed entity_id
    // is what the replacements below reclaim. Runs once per profile, not once per (re)connect: a
    // broker restart must not re-send ~200 deletes for entities that no longer exist under those ids.
    if (s_stale_values_profile != profile_id) retract_stale_values(prof, profile_id);
    for (size_t i = 0; i < prof.count(); i++) {
        const ValueDef  d = logic::adjudicated(prof[i]);   // wire truth, not the generator label
        // A row the firmware does not publish — the generator's detect-only flag, or the availability
        // ledger's Unproven verdict (logic/availability.hpp). RETRACT rather than merely skip: an
        // install upgrading from a build that DID publish this row already has a RETAINED discovery
        // config in the broker, which would survive forever as a permanently-unavailable HA entity —
        // and for a QUARANTINED row it is worse than an orphan, since HA would keep the last false
        // value it was ever sent (145-200 °C for Target Evap. Temp.) as that entity's state until
        // something replaced it. A zero-length retained payload deletes it, and is harmless on a
        // fresh install where the topic never existed. Only the CURRENT (grouped) topic is retracted
        // here: this is a live rule about a row THIS build stopped publishing, not a migration, and
        // the row's pre-#221 shapes are the bulk pass's job above — which covers it, since that pass
        // deliberately ignores row_publishable (an older build announced it as an ordinary sensor).
        if (!row_publishable(d)) {
            if (!object_id(d.label).empty())
                mqtt_publish(discovery_topic(s_prefix, s_node, d), "", 0, 0, 1);
            continue;
        }
        if (!conv_publishable(d.conv)) continue;
        const std::string obj = object_id(d.label);
        if (obj.empty()) continue;
        const std::string ct  = discovery_topic(s_prefix, s_node, d);
        const std::string cfg = discovery_config(s_node, s_board, s_x10a, s_avail, d);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
        // The DERIVED numeric fault flags that ride beside a textual error class (#209 defect 4).
        // Announced here, from the same row loop that publishes the class itself, so the entity set
        // and the payload cannot drift apart — the direct cache encoder emits these keys for exactly
        // the rows this branch announces.
        if (d.conv == 203) {
            const std::string group = group_for_page(d.reg);
            for (size_t k = 0; k < FAULT_COMPANION_COUNT; k++) {
                const FaultCompanion& c = FAULT_COMPANIONS[k];
                mqtt_publish(companion_discovery_topic(s_prefix, s_node, group, c.key),
                             companion_discovery_config(s_node, s_board, s_x10a, s_avail, group, c)
                                 .c_str(),
                             0, 0, 1);            // retained
            }
        }
    }
}

// Builds up to v1.0.0-dev.257 exposed all HomeHub registers through HA discovery. They are retired:
// delete those exact retained configs on every MQTT connection and periodically thereafter, and
// never publish replacements. The repeat is intentional and idempotent — it also cleans a broker
// restored from an old backup, while keeping the independent <base>/modbus state stream available
// to Telegraf and other MQTT clients.
static void retract_modbus_discovery() {
    for (int i = 0; i < def::HOMEHUB_REG_COUNT; i++)
        mqtt_publish(modbus_discovery_topic(s_prefix, s_node, def::HOMEHUB_REGS[i]), "", 0, 0, 1);
}

static void publish_env3_discovery() {
    for (size_t i = 0; i < ENV3_HA_SENSOR_COUNT; ++i) {
        const Env3HaSensor& sensor = ENV3_HA_SENSORS[i];
        const std::string topic = env3_discovery_topic(s_prefix, s_node, sensor);
        const std::string config = env3_discovery_config(s_node, s_board, s_env3, s_avail, sensor);
        mqtt_publish(topic, config.c_str(), 0, 0, 1);
    }
}

static void retract_env3_discovery() {
    for (size_t i = 0; i < ENV3_HA_SENSOR_COUNT; ++i)
        mqtt_publish(env3_discovery_topic(s_prefix, s_node, ENV3_HA_SENSORS[i]), "", 0, 0, 1);
}

// Builds up to v1.0.0-dev.295 briefly exposed the forecast as four HA entities. Forecast history
// now has one explicit consumer contract on MQTT instead; delete the frozen discovery topics and
// never publish replacement configs. Repeating this with the Modbus retirement also cleans brokers
// restored from a backup made while those entities existed.
static void retract_weather_discovery() {
    for (int i = 0; i < RETIRED_WEATHER_HA_SENSOR_COUNT; ++i) {
        const RetiredHaSensor& sensor = RETIRED_WEATHER_HA_SENSORS[i];
        mqtt_publish(retired_weather_discovery_topic(s_prefix, s_node, sensor), "", 0, 0, 1);
    }
}

// Build + publish each source independently. The X10A payload is grouped by register page; the
// Modbus topic is flat because its topic already supplies the source group. When the HomeHub link is
// not live, `{}` actively removes every state instead of retaining values from an old TCP session.
//
// X10A is a two-pass bounded path. The poll-cache accessor counts + hashes the committed cache
// without allocating. Unchanged state stops there. A changed state reserves ONE exact-sized local
// payload outside the cache mutex, then re-enters only long enough to verify the revision and write
// into that already-sized block. The synchronous QoS0 publish consumes it before the local is
// released. No second cache, slug vector or maximum-sized boot-long block survives the call — those
// were the dev.12/dev.13 regression that made /status permanently return 503 on the real plant.
// The 12 KiB value remains a refusal ceiling, not a reservation. The digest advances only when
// esp-mqtt accepts the write, so an immediate broker failure is retried on the next cycle.
static bool publish_x10a_state(const Config& config, bool force) {
    const HpX10aJsonProbe probe = hp_values_x10a_json_probe(
        config.profile.c_str(), config.x10a_identity_fp);
    if (!probe.source_matches) {
        diag_printf("mqtt: X10A snapshot does not match the active profile/identity; state deferred\n");
        return false;
    }
    if (probe.bytes > X10A_GROUPED_JSON_MAX_BYTES) {
        if (!s_x10a_json_oversize_logged) {
            diag_printf("mqtt: X10A payload needs %u B; %u B safety ceiling refuses it\n",
                        static_cast<unsigned>(probe.bytes),
                        static_cast<unsigned>(X10A_GROUPED_JSON_MAX_BYTES));
            s_x10a_json_oversize_logged = true;
        }
        return false;
    }
    s_x10a_json_oversize_logged = false;
    if (!force && s_last_x10a_digest_valid && probe.digest == s_last_x10a_digest) return false;

    std::string payload;
    payload.reserve(probe.bytes); // the only changed-state allocation; exact and outside s_cache lock
    const HpX10aJsonCopyResult copied = hp_values_x10a_json_copy(
        payload, probe.bytes, probe.digest, probe.revision,
        config.profile.c_str(), config.x10a_identity_fp);
    if (copied == HpX10aJsonCopyResult::SourceMismatch) {
        diag_printf("mqtt: X10A snapshot source changed during payload build; state deferred\n");
        return false;
    }
    if (copied == HpX10aJsonCopyResult::BufferTooSmall) {
        diag_printf("mqtt: exact X10A payload reservation supplied less than %u B\n",
                    static_cast<unsigned>(probe.bytes));
        return false;
    }
    if (copied == HpX10aJsonCopyResult::RevisionChanged) return false; // retry next one-second cycle
    if (!mqtt_publish(s_x10a, payload.c_str(), static_cast<int>(payload.size()), 0, 1))
        return false;
    s_last_x10a_digest = probe.digest;
    s_last_x10a_digest_valid = true;
    s_x10a_publish_proven.store(true, std::memory_order_release);
    return true;
}

static void publish_modbus_state() {
    bool live = false;
    const std::vector<GroupedValue> values = current_modbus_values(live);
    const std::string js = live ? build_flat_json(values) : std::string("{}");
    if (js != s_last_modbus_json) {
        mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1);
        s_last_modbus_json = js;
    }
}

// A user who clears one of these source configurations is explicitly asking the retained document
// to disappear. That intent is narrower than installation publication authority: it may send only
// a zero-length retained tombstone, even while X10A is absent, and cannot announce or replace any
// value. Keep the request armed through broker outages; re-enabling before delivery cancels it.
static void service_requested_topic_cleanup(const Config& c) {
    if (!s_connected) return;
    if (s_weather_cleanup_requested.exchange(false)) {
        if (!c.weather_enabled) {
            mqtt_publish(s_weather, "", 0, 1, 1);
            s_disabled_weather_cleaned = true;
            diag_printf("mqtt: inactive weather forecast topic deleted\n");
        }
    }
    if (s_modbus_cleanup_requested.exchange(false)) {
        if (!config_modbus_enabled(c)) {
            mqtt_publish(s_modbus, "", 0, 1, 1);
            s_modbus_disabled_cleaned = true;
            s_last_modbus_json.clear();
            diag_printf("mqtt: user-disabled Modbus topic deleted\n");
        }
    }
}

static void publish_weather_state(bool config_enabled) {
    const WeatherForecastStatus status = weather_forecast_status();
    const WeatherMqttAction action = weather_mqtt_action(config_enabled, status.configured);
    if (action != WeatherMqttAction::Publish) {
        // Never retain or repeatedly publish a synthetic "not configured" forecast. A real disable
        // is explicit user intent, so send one retained tombstone directly. The previous probe-first
        // path could miss the retained delivery and leave the forecast behind; an idempotent empty
        // retained publish is the broker's definitive delete operation. During the short
        // enable/reconfigure race, simply wait for the weather task's status to catch up.
        s_last_weather_json.clear();
        if (action == WeatherMqttAction::CleanupRetained && !s_disabled_weather_cleaned) {
            mqtt_publish(s_weather, "", 0, 1, 1);
            s_disabled_weather_cleaned = true;
            diag_printf("mqtt: disabled weather forecast topic deleted\n");
        }
        return;
    }
    // Re-enabling makes the next disable a new cleanup transition.
    s_disabled_weather_cleaned = false;
    int64_t now_unix_s = -1;
    int32_t now_ms = 0;
    time_now(now_unix_s, now_ms);
    const WeatherMqttSnapshot snapshot{
        status.configured, status.fetching, status.available, status.has_value,
        status.outdoor_mean_2h_c, status.solar_energy_2h_wh_m2,
        status.issued_unix_s, status.fetched_unix_s, status.decision_unix_s,
        status.last_attempt_unix_s, status.successes, status.errors,
        status.model, status.state, status.reason, status.error};
    const std::string js = build_weather_mqtt_json(snapshot, now_unix_s);
    if (js != s_last_weather_json) {
        mqtt_publish(s_weather, js.c_str(), static_cast<int>(js.size()), 0, 1);
        s_last_weather_json = js;
    }
}

// ENV III is independent observation telemetry and not part of either heat-pump payload. Three HA
// discovery entities read this same document. Publish every successful sensor sample, even if
// rounding produces the same JSON, so a time-series subscriber sees the sensor's real 10 s sampling
// cadence. Errors/staleness publish `{}` once; each entity's availability template sees its missing
// key and becomes unavailable instead of carrying a plausible retained outdoor value forward.
static void publish_env3_state() {
    const Env3Status env = env3_status();
    const std::string js = build_env3_mqtt_json(env.fresh, env.temperature_c,
                                                env.humidity_pct, env.pressure_hpa,
                                                env.samples, env.errors);
    // The sample COUNTER is now part of the document, so a new reading already changes `js` and the
    // second term would carry this on its own. The explicit check stays: it is what states the rule
    // — the sensor's real 10 s cadence must reach a time-series subscriber even when the rounded
    // text repeats — and leaving it implicit in a payload field would make a future decision to
    // drop that field silently reintroduce the gap that reads like a dropout.
    const bool new_sample = env.fresh && env.samples != s_last_env3_samples;
    if (new_sample || js != s_last_env3_json) {
        mqtt_publish(s_env3, js.c_str(), static_cast<int>(js.size()), 0, 1);
        s_last_env3_json = js;
    }
    s_last_env3_samples = env.samples;
}

// Stream one retained discovery config per diagnostic sensor (logic/heartbeat.hpp). These describe
// the ESP32 board + X10A link itself, not a heat-pump value, so — unlike X10A discovery —
// they don't wait on profile detection: WiFi signal and free heap are meaningful even while
// profile == "auto".
static void publish_heartbeat_discovery() {
    if (!s_legacy_fixed_retracted) retract_legacy_fixed();   // delete the old ids FIRST
    // Delete any entity we USED to publish here but no longer do — a zero-length retained message to
    // its old discovery topic removes it from HA, so an install upgraded from an older build doesn't
    // keep a stale, permanently-unavailable "Device Time" / "WiFi Quality". Same contract as the
    // crash topic's RETIRED_CRASH_SENSORS; cheap + retained, so once per (re)connect is fine.
    for (int i = 0; i < RETIRED_HEARTBEAT_SENSOR_COUNT; i++) {
        const RetiredHaSensor& r = RETIRED_HEARTBEAT_SENSORS[i];
        mqtt_publish(heartbeat_discovery_topic(s_prefix, r.component, s_node, r.object_id), "", 0, 0, 1);
    }
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
        const HeartbeatSensor& s = HEARTBEAT_SENSORS[i];
        const std::string ct  = heartbeat_discovery_topic(s_prefix, s_node, s);
        const std::string cfg = heartbeat_discovery_config(s_node, s_board, s_heartbeat, s_avail, s);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
}

// Crash/reset diagnostics (logic/crashinfo.hpp): delete any retired entity, stream the discovery
// config for the "dump waiting" binary_sensor, then publish <base>/crash — but ONLY when the last
// reset is NOTABLE (a real fault OR an orphan core-dump still in flash). A normal boot (USB
// re-enumeration, config-save / OTA reboot, clean power-on) is not a crash, so
// build_crash_mqtt_payload() returns "". Do NOT publish that empty payload unconditionally: although
// a retained tombstone is not stored by the broker, every live subscriber sees it and may display a
// payload-less /crash node. Instead, briefly subscribe to the exact topic and delete it only when the
// broker proves that an older retained crash is still present. Thus a clean broker is read-only and
// silent, while stale crash records still disappear after a clean boot or explicit dismissal. The
// reset reason is surfaced independently by the heartbeat's own "Reset Reason" sensor. A real crash
// is retained so a late subscriber still sees it; it never carries secrets or the raw dump — just
// the reason + a raw-hex backtrace; the binary stays behind GET /coredump.
static void publish_crash() {
    if (!s_legacy_fixed_retracted) retract_legacy_fixed();   // delete the old ids FIRST (see above)
    // Delete any entity we USED to publish here but no longer do — a zero-length retained message to
    // its old discovery topic removes it from HA, so an install upgraded from an older build doesn't
    // keep a stale, permanently-unavailable entity (e.g. the old "Last Reset Reason" sensor, now the
    // heartbeat's job). Cheap + retained, so once per (re)connect is fine.
    for (int i = 0; i < RETIRED_CRASH_SENSOR_COUNT; i++) {
        const RetiredHaSensor& r = RETIRED_CRASH_SENSORS[i];
        const std::string ct = crash_discovery_topic(s_prefix, r.component, s_node, r.object_id);
        mqtt_publish(ct, "", 0, 0, 1);   // retained, zero-length -> deletes the discovery config
    }
    for (int i = 0; i < CRASH_SENSOR_COUNT; i++) {
        const CrashSensor& s = CRASH_SENSORS[i];
        const std::string ct  = crash_discovery_topic(s_prefix, s_node, s);
        const std::string cfg = crash_discovery_config(s_node, s_board, s_crash, s_avail, s);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
    // _live(): read `coredump` from flash, not the boot-time cache — a dump pulled + cleared via
    // POST /coredump/clear while the device runs turns an orphan-dump boot NOT-notable, so the cleanup
    // probe below removes an older retained record (a stale true would otherwise replay forever).
    const CrashInfo   ci = diag_crash_info_live();
    const std::string js = build_crash_mqtt_payload(ci);
    if (!js.empty()) {
        // Defensive: notability normally cannot change false -> true without a reboot, but never let
        // a cleanup probe race a newly-published crash if a future runtime source changes that rule.
        if (s_crash_probe_active) {
            esp_mqtt_client_unsubscribe(s_client, s_crash.c_str());
            s_crash_probe_active = false;
            s_crash_seen = false;
        }
        mqtt_publish(s_crash, js.c_str(), static_cast<int>(js.size()), 0, 1);   // retained
    } else {
        start_retained_cleanup_probe(s_crash, s_crash_seen, s_crash_probe_active,
                                     s_crash_probe_deadline_us, "crash topic");
    }
    s_crash_dump_pub    = ci.coredump;
    s_crash_notable_pub = !js.empty();
}

// Evaluate the diagnosis every mqtt_task cycle, including while publication is paused or the broker
// is down. Tying evaluation to publish_heartbeat() would leave the last verdict looking healthy
// during exactly the X10A/MQTT failures that must block it. Arming is derived here rather than read
// from a controller mode: heating_curve_diagnosis_armed() answers it from the explicit diagnostics
// consent plus the room-source and HomeHub configuration the editors show, so withdrawing any
// required prerequisite disarms on the next cycle.
static logic::HeatingCurveSnapshot evaluate_heating_curve(const Config& cfg, const HpStats& hp) {
    if (!cfg.diagnostics_enabled) {
        logic::HeatingCurveInputs in;
        in.armed = false;
        Lock lk(s_mtx);
        return s_heating_curve_diagnosis.evaluate(in);
    }
    const ReferenceTemperatureStatus rt = reference_temperature_status();
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    const ReferenceFreshness freshness = reference_freshness(
        rt.has_value, rt.retained, rt.has_source_time, rt.source_unix_s, rt.received_ms,
        now_unix_s, now_ms, cfg.ref_temp_max_age_s);
    ReferenceRoomRaw room_raw;
    room_raw.configured = !cfg.ref_temp_topic.empty();
    room_raw.has_temperature = rt.has_value;
    room_raw.payload_valid = rt.error.empty();
    room_raw.temperature_c = rt.temperature_c;
    room_raw.has_source_time = rt.has_source_time;
    room_raw.setpoint_mapped = cfg.ref_temp_fixed_setpoint_tenths != 0 ||
                               !cfg.ref_temp_setpoint_topic.empty() ||
                               !cfg.ref_temp_setpoint_path.empty();
    room_raw.has_setpoint = rt.has_setpoint;
    room_raw.setpoint_c = rt.setpoint_c;
    room_raw.enabled_mapped = !cfg.ref_temp_enabled_path.empty();
    room_raw.has_enabled = rt.has_enabled;
    room_raw.enabled = rt.enabled;
    room_raw.hvac_mode_mapped = !cfg.ref_temp_hvac_mode_path.empty();
    room_raw.has_hvac_mode = rt.has_hvac_mode;
    room_raw.hvac_mode = rt.hvac_mode;
    room_raw.payload_reason = rt.rejection_reason;
    const ReferenceRoomSample room = reference_room_sample(room_raw, freshness);

    const ModbusStatus mbs = mb_status();
    const WeatherForecastStatus wx = weather_forecast_status();
    WeatherFreshness wx_freshness = weather_freshness(
        cfg.weather_enabled && wx.has_value, wx.fetched_unix_s, now_unix_s, WEATHER_MAX_AGE_S);
    if (!wx.available) wx_freshness.fresh = false;

    logic::HeatingCurveInputs in;
    in.armed = heating_curve_diagnosis_armed(cfg);
    in.room_control_eligible = room.control_eligible;
    in.room_error_k = room.room_error_k;
    in.x10a_connected = hp.connected;
    in.homehub_connected = mbs.connected;
    in.plant_gate_known = mbs.plant_gate_known;
    in.plant_gate_active = mbs.plant_gate_active;
    in.heating_mode_known = mbs.heating_mode_known;
    in.heating_mode_active = mbs.heating_mode_active;
    in.forecast_available = cfg.weather_enabled && wx.available && wx_freshness.fresh;
    // Optional local outdoor-air axis for the recorded event. Gated on the SAME two conditions the
    // ENV III MQTT document uses (fresh AND plausible), so a reading this firmware refuses to
    // publish can never be attached to a sample instead. Absent sensor -> absent field; sampling
    // itself is unaffected, which is why nothing here touches `armed` or any gate.
    const Env3Status env3 = env3_status();
    in.outdoor = logic::outdoor_env3_evidence(
        env3.fresh,
        env3_sample_plausible(env3.temperature_c, env3.humidity_pct, env3.pressure_hpa),
        static_cast<double>(env3.temperature_c));
    // HomeHub input 44 is decoded from an explicit fast-context batch in the SAME current cycle as
    // the gates. Requiring both the evidence object's current-session seal and the link's current
    // connected state prevents an old successful cycle from being attached to a later event after
    // the socket drops.
    in.plant_outdoor = logic::outdoor_homehub_evidence(
        mbs.plant_outdoor.available, mbs.connected,
        mbs.plant_outdoor.temperature_c);
    in.now_ms = static_cast<int64_t>(now_ms);
    in.now_unix_s = now_unix_s;
    in.room_has_source_time = rt.has_value && rt.has_source_time;
    in.room_source_unix_s = rt.source_unix_s;
    in.room_age_known = freshness.age_known;
    in.room_age_s = freshness.age_s;
    Lock lk(s_mtx);
    return s_heating_curve_diagnosis.evaluate(in);
}

// Snapshot board/link diagnostics from the IDF heap/timer APIs + the poll/WiFi/MQTT state, and
// publish it to the heartbeat topic (not retained). Called on a fixed HEARTBEAT_INTERVAL_S cadence
// (mqtt_task) — diagnostics, not real-time telemetry, so unlike the source topics it always publishes
// rather than only on change.
static void publish_heartbeat() {
    HpStats  hp = hp_stats();
    WifiInfo wi = wifi_info();
    const Config cfg = config();
    HeartbeatFields f;
    f.version         = esp_app_get_description()->version;
    f.platform        = CONFIG_IDF_TARGET;
    f.uptime_ms       = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    f.free_heap       = esp_get_free_heap_size();
    f.min_free_heap   = esp_get_minimum_free_heap_size();
    f.max_alloc       = heap_largest_internal_block();
    // What the heap watchdog already DID about that headroom. Its restart is an esp_restart(), so
    // reset_reason below reads "sw" and reset_fault 0 — the same shape a settings save produces —
    // and this count is the only field that tells the two apart.
    f.heap_restarts   = heap_guard_restarts();
    // The stack budget (stack_watch.hpp). Read here rather than sampled here: each task records its
    // OWN mark from its own loop, because uxTaskGetStackHighWaterMark answers for the CALLING task
    // and asking from this one would file all four under mqtt_pub's name.
    f.httpd_stack_min_free_bytes = stack_watch_min_free_bytes(StackWatch::Httpd);
    f.poll_stack_min_free_bytes  = stack_watch_min_free_bytes(StackWatch::Poll);
    f.mqtt_stack_min_free_bytes  = stack_watch_min_free_bytes(StackWatch::Mqtt);
    // One cached boot reason (diag_crash.cpp), three renderings: the slug a human reads, the raw
    // code a metrics store can keep, and the fault flag an alert fires on. Bound once so all three
    // are demonstrably the same reading rather than three lookups that only look identical.
    const CrashInfo& boot = diag_crash_info();
    f.reset_reason      = reset_reason_name(boot.reason);
    f.reset_reason_code = boot.reason;
    f.reset_fault       = crash_reason_is_fault(boot.reason);
    f.wifi_connected  = wi.connected;
    f.wifi_rssi       = wi.rssi;
    f.wifi_reconnects = wifi_reconnect_count();
    // Pre-render the MAC strings here to keep logic/heartbeat.hpp IDF-free. The STA's own MAC is
    // always present; the AP BSSID only while associated ("" -> JSON null, like /status).
    char mac_str[18];
    std::snprintf(mac_str, sizeof(mac_str), "%02X:%02X:%02X:%02X:%02X:%02X",
                  wi.mac[0], wi.mac[1], wi.mac[2], wi.mac[3], wi.mac[4], wi.mac[5]);
    f.wifi_mac = mac_str;
    if (wi.connected) {
        char bssid_str[18];
        std::snprintf(bssid_str, sizeof(bssid_str), "%02X:%02X:%02X:%02X:%02X:%02X",
                      wi.bssid[0], wi.bssid[1], wi.bssid[2], wi.bssid[3], wi.bssid[4], wi.bssid[5]);
        f.wifi_bssid = bssid_str;
    }
    // The transport, so a wired board is not read as permanently offline by a consumer that only
    // has wifi_connected to go on (logic/heartbeat.hpp states why these are numbers).
    const EthInfo eth = net_eth_info();
    f.net_link    = static_cast<uint8_t>(net_kind());
    f.eth_present = eth.present;
    f.eth_link    = eth.link;
    f.mqtt_connected  = s_connected;
    f.mqtt_count      = s_mqtt_pub_ok;
    f.mqtt_fails      = s_mqtt_pub_fail;
    f.mqtt_reconnects = s_mqtt_reconnects;
    // The cycles that produced nothing (#380). poll_skipped comes from the OTHER task's counter, not
    // from `hp` above: hp_stats() describes cycles that RAN, and a sweep that threw never committed.
    f.mqtt_skipped    = s_mqtt_skipped.load(std::memory_order_relaxed);
    f.mqtt_quiesced   = s_mqtt_quiesced.load(std::memory_order_relaxed);
    f.poll_skipped    = hp_skipped_cycles();
    f.bus_connected   = hp.connected;
    f.bus_proto       = static_cast<char>(cfg.proto);
    f.registers       = hp.registers;
    f.values          = hp.values;
    f.crc_err         = hp.crc_err;
    f.timeout_err     = hp.timeout_err;
    f.rx_received     = hp.rx_ok;
    f.rx_fails        = hp.rx_fail_total;
    f.last_ok_s       = hp.last_ok_s;
    f.ou_held_over    = hp.ou_held_over;
    const ModbusStatus mbs = mb_status();
    f.modbus_enabled   = mbs.enabled;
    f.modbus_connected = mbs.connected;
    f.modbus_rx        = mbs.rx_ok;
    f.modbus_fails     = mbs.rx_fail;
    f.modbus_stack_min_free_bytes = stack_watch_min_free_bytes(StackWatch::Modbus);
    const std::string js = build_heartbeat_json(f);
    mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);   // not retained
}

// Publish the accepted room observation and read-only heating-curve diagnosis on their own domain
// topic. Keeping these out of HeartbeatFields makes the board/link payload independent of any room
// mapping or heating policy; the nested objects keep related evidence together for generic MQTT
// browsers while retaining numeric leaves for Telegraf/VictoriaMetrics.
static void publish_heating_curve_telemetry() {
    const Config cfg = config();
    if (!cfg.diagnostics_enabled) return;
    HeatingCurveMqttFields f;
    const ReferenceTemperatureStatus rt = reference_temperature_status();
    const uint64_t room_now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t room_now_unix_s = -1;
    int32_t room_now_sub_ms = 0;
    time_now(room_now_unix_s, room_now_sub_ms);
    const ReferenceFreshness room_freshness = reference_freshness(
        rt.has_value, rt.retained, rt.has_source_time, rt.source_unix_s, rt.received_ms,
        room_now_unix_s, room_now_ms, cfg.ref_temp_max_age_s);
    ReferenceRoomRaw room_raw;
    room_raw.configured = !cfg.ref_temp_topic.empty();
    room_raw.has_temperature = rt.has_value;
    room_raw.payload_valid = rt.error.empty();
    room_raw.temperature_c = rt.temperature_c;
    room_raw.has_source_time = rt.has_source_time;
    room_raw.setpoint_mapped = cfg.ref_temp_fixed_setpoint_tenths != 0 ||
                               !cfg.ref_temp_setpoint_topic.empty() ||
                               !cfg.ref_temp_setpoint_path.empty();
    room_raw.has_setpoint = rt.has_setpoint;
    room_raw.setpoint_c = rt.setpoint_c;
    room_raw.enabled_mapped = !cfg.ref_temp_enabled_path.empty();
    room_raw.has_enabled = rt.has_enabled;
    room_raw.enabled = rt.enabled;
    room_raw.hvac_mode_mapped = !cfg.ref_temp_hvac_mode_path.empty();
    room_raw.has_hvac_mode = rt.has_hvac_mode;
    room_raw.hvac_mode = rt.hvac_mode;
    room_raw.payload_reason = rt.rejection_reason;
    const ReferenceRoomSample room = reference_room_sample(room_raw, room_freshness);
    f.room_temperature_valid = room.temperature_valid;
    f.room_setpoint_valid = room.setpoint_valid;
    f.room_control_eligible = room.control_eligible;
    f.room_temperature_c = room.temperature_c;
    f.room_setpoint_c = room.setpoint_c;
    f.room_error_k = room.room_error_k;
    f.room_has_source_time = rt.has_value && rt.has_source_time;
    f.room_source_unix_s = rt.source_unix_s;
    f.room_age_known = room_freshness.age_known;
    f.room_age_s = room_freshness.age_s;
    f.room_reason_code = static_cast<uint8_t>(room.reason);
    f.room_messages = rt.messages;
    f.room_errors = rt.errors;
    f.room_rejections = rt.rejections;

    // Evaluation runs every mqtt_task cycle, outside the publication gate. This is the latest
    // fail-closed snapshot, not a second evaluation tied to the 10-second reporting cadence.
    const logic::HeatingCurveSnapshot diagnosis = heating_curve_status();
    f.method_version = logic::HEATING_CURVE_DIAGNOSIS_METHOD_VERSION;
    f.armed = diagnosis.armed;
    f.state = static_cast<uint8_t>(diagnosis.state);
    f.reason = static_cast<uint8_t>(diagnosis.reason);
    f.sample_eligible = diagnosis.sample_eligible;
    f.forecast_available = diagnosis.forecast_available;
    f.outdoor_available = diagnosis.has_outdoor_temperature;
    f.outdoor_source = diagnosis.outdoor_source;
    f.has_last_sample_outdoor = diagnosis.has_last_sample_outdoor;
    f.last_sample_outdoor_temperature_c = diagnosis.last_sample_outdoor_temperature_c;
    f.last_sample_outdoor_source = diagnosis.last_sample_outdoor_source;
    f.plant_outdoor_available = diagnosis.has_plant_outdoor_temperature;
    f.plant_outdoor_source = diagnosis.plant_outdoor_source;
    f.has_last_sample_plant_outdoor = diagnosis.has_last_sample_plant_outdoor;
    f.last_sample_plant_outdoor_temperature_c =
        diagnosis.last_sample_plant_outdoor_temperature_c;
    f.last_sample_plant_outdoor_source = diagnosis.last_sample_plant_outdoor_source;
    f.plant_gate_known = diagnosis.plant_gate_known;
    f.plant_gate_active = diagnosis.plant_gate_active;
    f.heating_mode_known = diagnosis.heating_mode_known;
    f.heating_mode_active = diagnosis.heating_mode_active;
    f.has_current_room_error = diagnosis.has_current_room_error;
    f.has_last_sample = diagnosis.has_last_sample;
    f.has_diagnosis_room_source_time = diagnosis.room_has_source_time;
    f.diagnosis_room_age_known = diagnosis.room_age_known;
    f.current_room_error_k = diagnosis.current_room_error_k;
    f.last_sample_room_error_k = diagnosis.last_sample_room_error_k;
    f.diagnosis_room_source_unix_s = diagnosis.room_source_unix_s;
    f.diagnosis_room_age_s = diagnosis.room_age_s;
    f.last_sample_unix_s = diagnosis.last_sample_unix_s;
    f.sequence = diagnosis.sequence;
    f.evaluations = diagnosis.evaluations;
    f.samples = diagnosis.samples;
    f.holds = diagnosis.holds;
    f.blocks = diagnosis.blocks;

    const std::string js = build_heating_curve_mqtt_json(f);
    mqtt_publish(s_heating_curve_topic, js.c_str(), static_cast<int>(js.size()), 0, 0);
}

// Reassemble a possibly-fragmented MQTT DATA event without allocating. Every complete frame is
// handed to mqtt_task; that task decides whether it is the currently configured reference topic.
static void capture_reference_frame(esp_mqtt_event_handle_t e) {
    if (!e || !s_ref_queue || e->total_data_len <= 0 ||
        e->total_data_len > static_cast<int>(REF_TEMP_PAYLOAD_MAX)) {
        s_ref_rx_active = false;
        return;
    }
    if (e->current_data_offset == 0) {
        s_ref_rx_active = e->topic && e->topic_len > 0 &&
                          e->topic_len <= static_cast<int>(REF_TEMP_TOPIC_MAX);
        if (!s_ref_rx_active) return;
        std::memcpy(s_ref_rx.topic, e->topic, static_cast<size_t>(e->topic_len));
        s_ref_rx.topic[e->topic_len] = '\0';
        s_ref_rx.payload_len = static_cast<size_t>(e->total_data_len);
        s_ref_rx.retained = e->retain != 0;
        s_ref_rx.received_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
        int32_t received_sub_ms = 0;
        time_now(s_ref_rx.received_unix_s, received_sub_ms);
    }
    if (!s_ref_rx_active || e->current_data_offset < 0 || e->data_len < 0 ||
        e->current_data_offset + e->data_len > e->total_data_len ||
        e->total_data_len != static_cast<int>(s_ref_rx.payload_len)) {
        s_ref_rx_active = false;
        return;
    }
    if (e->data_len > 0)
        std::memcpy(s_ref_rx.payload + e->current_data_offset, e->data,
                    static_cast<size_t>(e->data_len));
    if (e->current_data_offset + e->data_len == e->total_data_len) {
        s_ref_rx.payload[s_ref_rx.payload_len] = '\0';
        if (xQueueSend(s_ref_queue, &s_ref_rx, 0) != pdTRUE)
            s_ref_dropped.fetch_add(1, std::memory_order_relaxed);
        s_ref_rx_active = false;
    }
}

static cJSON* reference_json_item(cJSON* root, const std::string& path) {
    cJSON* node = root;
    size_t pos = 0;
    char key[REF_TEMP_KEY_MAX + 1];
    while (pos < path.size()) {
        const size_t dot = path.find('.', pos);
        const size_t end = dot == std::string::npos ? path.size() : dot;
        const size_t len = end - pos;  // validated by POST/load contract; still fail closed here
        if (len == 0 || len > REF_TEMP_KEY_MAX || !cJSON_IsObject(node)) return nullptr;
        std::memcpy(key, path.data() + pos, len);
        key[len] = '\0';
        node = cJSON_GetObjectItemCaseSensitive(node, key);
        if (!node) return nullptr;
        pos = dot == std::string::npos ? path.size() : dot + 1;
    }
    return node;
}

static bool reference_payload_timestamp(cJSON* item, int64_t& unix_s, const char*& source) {
    if (cJSON_IsString(item) && item->valuestring &&
        reference_parse_rfc3339(item->valuestring, unix_s)) {
        source = "payload_rfc3339";
        return true;
    }
    if (cJSON_IsNumber(item) && std::isfinite(item->valuedouble) &&
        item->valuedouble == std::floor(item->valuedouble) &&
        item->valuedouble >= 0 && item->valuedouble <= 4133980800.0) {
        unix_s = static_cast<int64_t>(item->valuedouble);
        source = "payload_unix_s";
        return true;
    }
    return false;
}

struct DecodedReferenceFrame {
    bool valid=false, temperature_updated=false, setpoint_updated=false, timestamp_updated=false;
    bool has_source_time=false, has_setpoint=false;
    bool has_enabled=false, enabled=false, has_hvac_mode=false, control_parse_error=false;
    double temperature_c=0.0, setpoint_c=0.0;
    int64_t source_unix_s=-1;
    ReferenceRoomReason error_reason=ReferenceRoomReason::InvalidPayload;
    ReferenceRoomReason control_reason=ReferenceRoomReason::Eligible;
    std::string hvac_mode;
    const char* timestamp_source="mqtt_arrival";
    const char* error=nullptr;
    const char* control_error=nullptr;
};

// The saved mapping is interpreted only when an actual MQTT frame arrives. Configuration accepts
// an unverified path intentionally; this decoder supplies the runtime error and fail-closed state.
static DecodedReferenceFrame decode_reference_frame(const ReferenceMqttFrame& frame,
                                                     const std::string& temperature_topic,
                                                     const std::string& temperature_path,
                                                     const std::string& setpoint_topic,
                                                     const std::string& setpoint_path,
                                                     const std::string& timestamp_topic,
                                                     const std::string& timestamp_path,
                                                     const std::string& enabled_path,
                                                     const std::string& hvac_mode_path) {
    DecodedReferenceFrame out;
    const bool temperature_frame = frame.topic == temperature_topic;
    const bool setpoint_frame = !setpoint_topic.empty() && frame.topic == setpoint_topic;
    const bool timestamp_frame = !timestamp_topic.empty() && frame.topic == timestamp_topic;
    if (!temperature_frame && !setpoint_frame && !timestamp_frame) return out;
    cJSON* root = cJSON_ParseWithLength(frame.payload, frame.payload_len);
    if (!root) { out.error = "payload is not valid JSON"; return out; }
    if (temperature_frame) {
        cJSON* item = reference_json_item(root, temperature_path);
        if (!cJSON_IsNumber(item) || !std::isfinite(item->valuedouble)) {
            cJSON_Delete(root);
            out.error = "Temperature path is missing or not numeric";
            return out;
        }
        out.temperature_updated = true;
        out.temperature_c = item->valuedouble;
    }
    if (setpoint_frame) {
        cJSON* setpoint_item = reference_json_item(root, setpoint_path);
        if (cJSON_IsNumber(setpoint_item) && std::isfinite(setpoint_item->valuedouble)) {
            out.setpoint_updated = true;
            out.has_setpoint = true;
            out.setpoint_c = setpoint_item->valuedouble;
        } else {
            cJSON_Delete(root);
            out.error_reason = ReferenceRoomReason::MissingSetpoint;
            out.error = "Setpoint path is missing or not numeric";
            return out;
        }
    }
    if (timestamp_frame) {
        cJSON* timestamp_item = reference_json_item(root, timestamp_path);
        if (!reference_payload_timestamp(timestamp_item, out.source_unix_s,
                                         out.timestamp_source)) {
            cJSON_Delete(root);
            out.error_reason = ReferenceRoomReason::MissingSourceTime;
            out.error = "Timestamp path is missing or not RFC3339/Unix seconds";
            return out;
        }
        out.timestamp_updated = true;
        out.has_source_time = true;
        if (frame.received_unix_s >= 0 &&
            out.source_unix_s > frame.received_unix_s + REF_TEMP_FUTURE_TOLERANCE_S) {
            cJSON_Delete(root);
            out.error_reason = ReferenceRoomReason::FutureTimestamp;
            out.error = "Source timestamp is in the future";
            return out;
        }
    }
    if (temperature_frame && !enabled_path.empty()) {
        cJSON* enabled_item = reference_json_item(root, enabled_path);
        if (cJSON_IsBool(enabled_item)) {
            out.has_enabled = true;
            out.enabled = cJSON_IsTrue(enabled_item);
        } else if (cJSON_IsNumber(enabled_item) &&
                   (enabled_item->valuedouble == 0.0 || enabled_item->valuedouble == 1.0)) {
            out.has_enabled = true;
            out.enabled = enabled_item->valuedouble == 1.0;
        } else if (!out.control_parse_error) {
            out.control_parse_error = true;
            out.control_reason = ReferenceRoomReason::MissingEnabledState;
            out.control_error = "Enabled path is missing or not boolean/0/1";
        }
    }
    if (temperature_frame && !hvac_mode_path.empty()) {
        cJSON* hvac_item = reference_json_item(root, hvac_mode_path);
        if (cJSON_IsString(hvac_item) && hvac_item->valuestring &&
            std::strlen(hvac_item->valuestring) <= 16) {
            out.has_hvac_mode = true;
            out.hvac_mode = hvac_item->valuestring;
        } else if (!out.control_parse_error) {
            out.control_parse_error = true;
            out.control_reason = ReferenceRoomReason::MissingHvacMode;
            out.control_error = "HVAC mode path is missing or not a short string";
        }
    }
    cJSON_Delete(root);
    out.valid = true;
    return out;
}

// A source timestamp must not move backwards relative to the last value accepted for this exact
// mapping. This is part of acceptance, not just status rendering. A different topic/path binding
// has no prior sample;
// service_reference_subscription resets the status when that new mapping is applied.
static bool reference_timestamp_moved_backward(const DecodedReferenceFrame& decoded,
                                                const std::string& timestamp_topic,
                                                const std::string& timestamp_path) {
    if (!decoded.has_source_time) return false;
    Lock lk(s_mtx);
    return timestamp_topic == s_ref_binding_time_topic &&
           timestamp_path == s_ref_binding_time_path && s_ref_status.has_value &&
           s_ref_status.has_source_time && decoded.source_unix_s < s_ref_status.source_unix_s;
}

struct DecodedCirculationFrame {
    bool valid=false;
    double power_w=0.0;
    int64_t source_unix_s=-1;
    const char* timestamp_source="payload_unix_s";
    const char* error=nullptr;
};

static DecodedCirculationFrame decode_circulation_frame(const ReferenceMqttFrame& frame,
                                                        const std::string& power_path,
                                                        const std::string& timestamp_path) {
    DecodedCirculationFrame out;
    cJSON* root = cJSON_ParseWithLength(frame.payload, frame.payload_len);
    if (!root) { out.error = "payload is not valid JSON"; return out; }
    cJSON* power = reference_json_item(root, power_path);
    if (!cJSON_IsNumber(power) || !std::isfinite(power->valuedouble) ||
        power->valuedouble < 0.0 || power->valuedouble > CIRC_SOURCE_POWER_MAX_W) {
        cJSON_Delete(root);
        out.error = "Power path is missing, not numeric or out of range";
        return out;
    }
    cJSON* timestamp = reference_json_item(root, timestamp_path);
    if (!reference_payload_timestamp(timestamp, out.source_unix_s, out.timestamp_source)) {
        cJSON_Delete(root);
        out.error = "Timestamp path is missing or not RFC3339/Unix seconds";
        return out;
    }
    if (frame.received_unix_s >= 0 &&
        out.source_unix_s > frame.received_unix_s + REF_TEMP_FUTURE_TOLERANCE_S) {
        cJSON_Delete(root);
        out.error = "Source timestamp is in the future";
        return out;
    }
    out.power_w = power->valuedouble;
    out.valid = true;
    cJSON_Delete(root);
    return out;
}

static ReferenceFreshness circulation_frame_freshness(const ReferenceMqttFrame& frame,
                                                       const DecodedCirculationFrame& decoded,
                                                       uint32_t max_age_s) {
    return reference_freshness(true, frame.retained, true, decoded.source_unix_s,
                               frame.received_ms, frame.received_unix_s, frame.received_ms,
                               max_age_s);
}

static bool circulation_timestamp_moved_backward(const DecodedCirculationFrame& decoded,
                                                  const std::string& topic,
                                                  const std::string& power_path,
                                                  const std::string& timestamp_path) {
    Lock lk(s_mtx);
    return topic == s_circulation_binding_topic &&
           power_path == s_circulation_binding_power_path &&
           timestamp_path == s_circulation_binding_time_path &&
           s_circulation_status.has_value &&
           decoded.source_unix_s < s_circulation_status.source_unix_s;
}

static void reset_circulation_status_locked(bool configured) {
    s_circulation_status = CirculationSourceStatus{};
    s_circulation_status.configured = configured;
    s_circulation_tracker.reset();
}

static void service_circulation_subscription(const Config& c) {
    const bool configured = !c.circulation_topic.empty();
    const bool capture_enabled = c.diagnostics_enabled && configured;
    if (c.circulation_topic != s_circulation_binding_topic ||
        c.circulation_power_path != s_circulation_binding_power_path ||
        c.circulation_time_path != s_circulation_binding_time_path ||
        capture_enabled != s_circulation_capture_enabled) {
        s_circulation_binding_topic = c.circulation_topic;
        s_circulation_binding_power_path = c.circulation_power_path;
        s_circulation_binding_time_path = c.circulation_time_path;
        s_circulation_capture_enabled = capture_enabled;
        Lock lk(s_mtx);
        s_circulation_runtime_max_age_s = c.circulation_max_age_s;
        reset_circulation_status_locked(configured);
    } else {
        Lock lk(s_mtx);
        s_circulation_runtime_max_age_s = c.circulation_max_age_s;
        s_circulation_status.configured = configured;
    }

    if (!capture_enabled) {
        s_circulation_reconfigure.exchange(false);
        if (!s_circulation_subscribed_topic.empty() && s_connected &&
            !reference_topic_owned(s_circulation_subscribed_topic))
            esp_mqtt_client_unsubscribe(s_client, s_circulation_subscribed_topic.c_str());
        s_circulation_subscribed_topic.clear();
        Lock lk(s_mtx);
        s_circulation_status.subscribed = false;
        return;
    }

    const char* invalid = nullptr;
    if (!circulation_source_config_valid(
            c.circulation_name, c.circulation_topic, c.circulation_power_path,
            c.circulation_time_path, c.circulation_max_age_s,
            c.circulation_on_tenths_w, c.circulation_off_tenths_w,
            c.circulation_confirm_s, &invalid)) {
        Lock lk(s_mtx);
        s_circulation_status.subscribed = false;
        s_circulation_status.error = invalid ? invalid : "invalid circulation source config";
        s_circulation_status.errors++;
        return;
    }

    const bool force = s_circulation_reconfigure.exchange(false);
    if (force) {
        // Reconnects and persisted threshold/age changes both require a fresh, confirmed state.
        // A previously confirmed ON/OFF must not cross either boundary as current evidence.
        Lock lk(s_mtx);
        reset_circulation_status_locked(configured);
    }
    if (!s_connected) {
        Lock lk(s_mtx);
        s_circulation_status.subscribed = false;
        return;
    }
    if (!force && s_circulation_subscribed_topic == c.circulation_topic) return;
    if (!s_circulation_subscribed_topic.empty() &&
        s_circulation_subscribed_topic != c.circulation_topic &&
        !reference_topic_owned(s_circulation_subscribed_topic))
        esp_mqtt_client_unsubscribe(s_client, s_circulation_subscribed_topic.c_str());

    const int id = esp_mqtt_client_subscribe(s_client, c.circulation_topic.c_str(), 0);
    {
        Lock lk(s_mtx);
        s_circulation_status.subscribed = id >= 0;
        s_circulation_status.error = id >= 0 ? "" : "MQTT subscribe failed";
        if (id < 0) s_circulation_status.errors++;
    }
    if (id >= 0) {
        s_circulation_subscribed_topic = c.circulation_topic;
        diag_printf("mqtt: circulation power subscription active\n");
    }
}

static void service_circulation_probe_subscription(const Config& saved) {
    if (!saved.diagnostics_enabled) {
        bool signal = false;
        {
            Lock lk(s_mtx);
            signal = s_circulation_probe.active;
            s_circulation_probe.active = false;
            s_circulation_probe.passed = false;
            s_circulation_probe.error = "Plant diagnostics are disabled";
        }
        if (!s_circulation_probe_subscribed_topic.empty() && s_connected &&
            !reference_topic_owned(s_circulation_probe_subscribed_topic) &&
            s_circulation_probe_subscribed_topic != s_circulation_subscribed_topic)
            esp_mqtt_client_unsubscribe(s_client, s_circulation_probe_subscribed_topic.c_str());
        s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        if (signal && s_circulation_probe_sem) xSemaphoreGive(s_circulation_probe_sem);
        return;
    }
    if (!s_connected) return;
    if (s_circulation_probe_reconfigure.exchange(false))
        s_circulation_probe_task_generation = 0;
    bool active = false;
    uint32_t generation = 0;
    CirculationSourceTestConfig candidate;
    {
        Lock lk(s_mtx);
        active = s_circulation_probe.active;
        generation = s_circulation_probe.generation;
        if (active) candidate = s_circulation_probe.config;
    }
    if (!active) {
        if (!s_circulation_probe_subscribed_topic.empty() &&
            s_circulation_probe_subscribed_topic != saved.circulation_topic &&
            !reference_topic_owned(s_circulation_probe_subscribed_topic))
            esp_mqtt_client_unsubscribe(s_client, s_circulation_probe_subscribed_topic.c_str());
        s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        return;
    }
    if (s_circulation_probe_task_generation == generation) return;
    // Re-subscribe UNCONDITIONALLY, including when this exact topic is already the saved source's.
    // This asks the broker to deliver the retained value again, so pressing Test has a bounded
    // answer instead of depending on when the source happens to publish next. Skipping it here made
    // re-testing an unchanged mapping wait for a live publish inside the 12 s window, so an
    // on-change-only meter answered 422 and /set_circulation then refused the save with the proof
    // gate — the mapping blamed for the probe.
    const int id = esp_mqtt_client_subscribe(s_client, candidate.topic.c_str(), 0);
    bool signal = false;
    {
        Lock lk(s_mtx);
        if (s_circulation_probe.active && s_circulation_probe.generation == generation) {
            s_circulation_probe.subscribed = id >= 0;
            if (id < 0) {
                s_circulation_probe.active = false;
                s_circulation_probe.error = "MQTT subscribe failed";
                signal = true;
            }
        }
    }
    // Recorded only when this topic is not already owned by another subscription, so the cleanup
    // above cannot unsubscribe a topic the saved source still needs.
    if (id >= 0 && candidate.topic != saved.circulation_topic)
        s_circulation_probe_subscribed_topic = candidate.topic;
    s_circulation_probe_task_generation = generation;
    if (signal && s_circulation_probe_sem) xSemaphoreGive(s_circulation_probe_sem);
}

static void set_reference_error(const char* error, ReferenceRoomReason reason, bool count_error) {
    const char* text = error && *error ? error : "Source value is invalid";
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    const bool should_log = s_ref_last_logged_error != text ||
        now_ms - s_ref_last_error_log_ms >= 60000;
    {
        Lock lk(s_mtx);
        s_ref_status.error = text;   // mqtt_task is exception-guarded; Lock is RAII
        s_ref_status.rejection_reason = reason;
        if (count_error) { s_ref_status.errors++; s_ref_status.rejections++; }
    }
    if (should_log) {
        diag_printf("mqtt: reference temperature payload rejected: %s\n", text);
        s_ref_last_logged_error = text;
        s_ref_last_error_log_ms = now_ms;
    }
}

static bool reference_topic_set_contains(const ReferenceTopicSet& topics,
                                         const std::string& topic) {
    if (topic.empty()) return false;
    for (const std::string& candidate : topics)
        if (candidate == topic) return true;
    return false;
}

static void reference_topic_set_add(ReferenceTopicSet& topics, const std::string& topic) {
    if (topic.empty() || reference_topic_set_contains(topics, topic)) return;
    for (std::string& slot : topics) {
        if (slot.empty()) { slot = topic; return; }
    }
}

static ReferenceTopicSet reference_topics(const Config& c) {
    ReferenceTopicSet topics;
    reference_topic_set_add(topics, c.ref_temp_topic);
    if (c.ref_temp_fixed_setpoint_tenths == 0)
        reference_topic_set_add(topics, c.ref_temp_setpoint_topic.empty()
            ? c.ref_temp_topic : c.ref_temp_setpoint_topic);
    if (!c.ref_temp_time_topic.empty() || !c.ref_temp_time_path.empty())
        reference_topic_set_add(topics, c.ref_temp_time_topic.empty()
            ? c.ref_temp_topic : c.ref_temp_time_topic);
    return topics;
}

static bool reference_topic_owned(const std::string& topic) {
    return reference_topic_set_contains(s_ref_subscribed_topics, topic);
}

static void unsubscribe_reference_topic_if_unused(const std::string& topic,
                                                  const ReferenceTopicSet& keep) {
    if (topic.empty() || !s_connected || reference_topic_set_contains(keep, topic) ||
        topic == s_circulation_subscribed_topic || topic == s_circulation_probe_subscribed_topic)
        return;
    esp_mqtt_client_unsubscribe(s_client, topic.c_str());
}

// Apply topic edits on the existing MQTT client. A binding change retires the old raw value: a
// reading extracted by the previous path must never appear under the new sensor identity.
static void service_reference_subscription(const Config& c) {
    // The mapping may remain saved while diagnostics are off. Only the Firmware-card master consent
    // opens the subscription; switching it off clears the runtime sample and unsubscribes live.
    const bool configured = !c.ref_temp_topic.empty();
    const bool capture_enabled = c.diagnostics_enabled && configured;
    if (c.ref_temp_topic != s_ref_binding_topic || c.ref_temp_path != s_ref_binding_path ||
        c.ref_temp_setpoint_topic != s_ref_binding_setpoint_topic ||
        c.ref_temp_setpoint_path != s_ref_binding_setpoint_path ||
        c.ref_temp_fixed_setpoint_tenths != s_ref_binding_fixed_setpoint_tenths ||
        c.ref_temp_time_topic != s_ref_binding_time_topic ||
        c.ref_temp_time_path != s_ref_binding_time_path ||
        c.ref_temp_enabled_path != s_ref_binding_enabled_path ||
        c.ref_temp_hvac_mode_path != s_ref_binding_hvac_mode_path ||
        capture_enabled != s_ref_capture_enabled) {
        s_ref_binding_topic = c.ref_temp_topic;
        s_ref_binding_path = c.ref_temp_path;
        s_ref_binding_setpoint_topic = c.ref_temp_setpoint_topic;
        s_ref_binding_setpoint_path = c.ref_temp_setpoint_path;
        s_ref_binding_fixed_setpoint_tenths = c.ref_temp_fixed_setpoint_tenths;
        s_ref_binding_time_topic = c.ref_temp_time_topic;
        s_ref_binding_time_path = c.ref_temp_time_path;
        s_ref_binding_enabled_path = c.ref_temp_enabled_path;
        s_ref_binding_hvac_mode_path = c.ref_temp_hvac_mode_path;
        s_ref_capture_enabled = capture_enabled;
        s_ref_subscription_announced = false;
        s_ref_last_logged_error.clear();
        s_ref_last_error_log_ms = 0;
        Lock lk(s_mtx);
        s_ref_status.has_value = false;
        s_ref_status.has_source_time = false;
        s_ref_status.has_setpoint = c.ref_temp_fixed_setpoint_tenths != 0;
        s_ref_status.setpoint_c = static_cast<double>(c.ref_temp_fixed_setpoint_tenths) / 10.0;
        s_ref_status.has_enabled = false;
        s_ref_status.has_hvac_mode = false;
        s_ref_status.received_ms = 0;
        s_ref_status.received_unix_s = -1;
        s_ref_status.source_unix_s = -1;
        s_ref_status.retained = false;
        s_ref_status.messages = 0;
        s_ref_status.errors = 0;
        s_ref_status.rejections = 0;
        s_ref_status.timestamp_source.clear();
        s_ref_status.hvac_mode.clear();
        s_ref_status.eligibility_error.clear();
        s_ref_status.rejection_reason = ReferenceRoomReason::InvalidPayload;
        s_ref_status.error.clear();
    }
    {
        Lock lk(s_mtx);
        s_ref_status.configured = configured;
    }

    // Deleting the topic is the collection boundary. Drop the live subscription and the captured
    // runtime values with it.
    if (!capture_enabled) {
        s_ref_reconfigure.exchange(false);
        for (const std::string& topic : s_ref_subscribed_topics)
            unsubscribe_reference_topic_if_unused(topic, {});
        s_ref_subscribed_topics = {};
        Lock lk(s_mtx);
        s_ref_status.subscribed = false;
        s_ref_status.error.clear();
        return;
    }

    const char* invalid = nullptr;
    const std::string setpoint_topic = c.ref_temp_setpoint_topic.empty() &&
            c.ref_temp_fixed_setpoint_tenths == 0 ? c.ref_temp_topic : c.ref_temp_setpoint_topic;
    const bool time_mapped = !c.ref_temp_time_topic.empty() || !c.ref_temp_time_path.empty();
    const std::string time_topic = !time_mapped ? "" :
        (c.ref_temp_time_topic.empty() ? c.ref_temp_topic : c.ref_temp_time_topic);
    if (!reference_temperature_config_valid(c.ref_temp_name, c.ref_temp_topic,
                                            c.ref_temp_path, setpoint_topic,
                                            c.ref_temp_setpoint_path,
                                            c.ref_temp_fixed_setpoint_tenths,
                                            time_topic, c.ref_temp_time_path,
                                            c.ref_temp_enabled_path,
                                            c.ref_temp_hvac_mode_path,
                                            c.ref_temp_max_age_s, &invalid)) {
        for (const std::string& topic : s_ref_subscribed_topics)
            unsubscribe_reference_topic_if_unused(topic, {});
        s_ref_subscribed_topics = {};
        Lock lk(s_mtx);
        s_ref_status.subscribed = false;
        s_ref_status.rejection_reason = ReferenceRoomReason::InvalidPayload;
        s_ref_status.error = invalid ? invalid : "invalid reference temperature config";
        return;
    }

    const bool force = s_ref_reconfigure.exchange(false);
    if (!s_connected) {
        Lock lk(s_mtx);
        s_ref_status.subscribed = false;
        if (!configured) s_ref_subscribed_topics = {};
        return;
    }
    const ReferenceTopicSet desired = reference_topics(c);
    if (!force && s_ref_subscribed_topics == desired) return;

    for (const std::string& old_topic : s_ref_subscribed_topics)
        unsubscribe_reference_topic_if_unused(old_topic, desired);
    ReferenceTopicSet subscribed;
    bool all_subscribed = true;
    for (const std::string& topic : desired) {
        if (topic.empty()) continue;
        const int id = esp_mqtt_client_subscribe(s_client, topic.c_str(), 0);
        if (id >= 0) reference_topic_set_add(subscribed, topic);
        else all_subscribed = false;
    }
    s_ref_subscribed_topics = subscribed;
    {
        Lock lk(s_mtx);
        s_ref_status.subscribed = all_subscribed;
        s_ref_status.error = all_subscribed ? "" : "MQTT subscribe failed";
        if (!all_subscribed) s_ref_status.errors++;
    }
    if (all_subscribed) {
        if (!s_ref_subscription_announced) {
            s_ref_subscription_announced = true;
            diag_printf("mqtt: reference temperature source subscribed\n");
        }
    }
}

static void service_circulation_probe_frame(const ReferenceMqttFrame& frame) {
    CirculationSourceTestConfig candidate;
    uint32_t generation = 0;
    {
        Lock lk(s_mtx);
        if (!s_circulation_probe.active || frame.topic != s_circulation_probe.config.topic) return;
        candidate = s_circulation_probe.config;
        generation = s_circulation_probe.generation;
    }
    const DecodedCirculationFrame decoded = decode_circulation_frame(
        frame, candidate.power_path, candidate.timestamp_path);
    const ReferenceFreshness freshness = decoded.valid
        ? circulation_frame_freshness(frame, decoded, candidate.max_age_s)
        : ReferenceFreshness{};
    bool signal = false;
    {
        Lock lk(s_mtx);
        if (!s_circulation_probe.active || s_circulation_probe.generation != generation) return;
        if (!decoded.valid) {
            s_circulation_probe.error = decoded.error ? decoded.error : "Source value is invalid";
            return;
        }
        if (!freshness.fresh) {
            s_circulation_probe.error = freshness.reason ? freshness.reason : "Source value is stale";
            return;
        }
        s_circulation_probe.active = false;
        s_circulation_probe.passed = true;
        s_circulation_probe.retained = frame.retained;
        s_circulation_probe.power_w = decoded.power_w;
        s_circulation_probe.state = circulation_power_class(
            decoded.power_w, candidate.on_tenths_w, candidate.off_tenths_w);
        s_circulation_probe.error.clear();
        signal = true;
    }
    if (signal && s_circulation_probe_sem) xSemaphoreGive(s_circulation_probe_sem);
}

static void service_circulation_frame(const ReferenceMqttFrame& frame, const Config& c) {
    service_circulation_probe_frame(frame);
    if (!c.diagnostics_enabled || c.circulation_topic.empty() ||
        frame.topic != c.circulation_topic) return;
    {
        Lock lk(s_mtx);
        s_circulation_status.messages++;
    }
    const DecodedCirculationFrame decoded = decode_circulation_frame(
        frame, c.circulation_power_path, c.circulation_time_path);
    if (!decoded.valid) {
        Lock lk(s_mtx);
        s_circulation_status.error = decoded.error ? decoded.error : "Source value is invalid";
        s_circulation_status.errors++;
        s_circulation_status.rejections++;
        return;
    }
    if (circulation_timestamp_moved_backward(decoded, c.circulation_topic,
                                             c.circulation_power_path,
                                             c.circulation_time_path)) {
        Lock lk(s_mtx);
        s_circulation_status.error = "Source timestamp moved backward";
        s_circulation_status.errors++;
        s_circulation_status.rejections++;
        return;
    }
    const ReferenceFreshness freshness =
        circulation_frame_freshness(frame, decoded, c.circulation_max_age_s);
    if (!freshness.fresh) {
        Lock lk(s_mtx);
        s_circulation_status.error = freshness.reason ? freshness.reason : "Source value is stale";
        s_circulation_status.rejections++;
        return;
    }
    Lock lk(s_mtx);
    if (s_circulation_status.has_value &&
        (frame.received_ms < s_circulation_status.received_ms ||
         frame.received_ms - s_circulation_status.received_ms >
             static_cast<uint64_t>(c.circulation_max_age_s) * 1000))
        s_circulation_tracker.reset();
    s_circulation_tracker.observe(decoded.power_w, frame.received_ms,
                                  c.circulation_on_tenths_w,
                                  c.circulation_off_tenths_w,
                                  c.circulation_confirm_s);
    s_circulation_status.power_w = decoded.power_w;
    s_circulation_status.received_ms = frame.received_ms;
    s_circulation_status.received_unix_s = frame.received_unix_s;
    s_circulation_status.source_unix_s = decoded.source_unix_s;
    s_circulation_status.retained = frame.retained;
    s_circulation_status.has_source_time = true;
    s_circulation_status.has_value = true;
    s_circulation_status.timestamp_source = decoded.timestamp_source;
    s_circulation_status.state = s_circulation_tracker.confirmed;
    s_circulation_status.error.clear();
}

static void service_reference_frames(const Config& c) {
    if (!s_ref_queue) return;
    // Report a dropped frame ONCE per new drop rather than per frame: this is the failure that hid
    // for two releases behind a keep-newest queue of one, so it must never be silent again, and a
    // per-frame line would evict the rest of the boot from the 6 KB diag ring under the very
    // overload it is reporting.
    const uint32_t dropped = s_ref_dropped.load(std::memory_order_relaxed);
    if (dropped != s_ref_dropped_reported) {
        diag_printf("mqtt: %lu inbound source frame(s) dropped — queue full\n",
                    static_cast<unsigned long>(dropped - s_ref_dropped_reported));
        s_ref_dropped_reported = dropped;
    }
    const std::string setpoint_topic = c.ref_temp_fixed_setpoint_tenths != 0 ? "" :
        (c.ref_temp_setpoint_topic.empty() ? c.ref_temp_topic : c.ref_temp_setpoint_topic);
    const bool timestamp_mapped = !c.ref_temp_time_topic.empty() || !c.ref_temp_time_path.empty();
    const std::string timestamp_topic = !timestamp_mapped ? "" :
        (c.ref_temp_time_topic.empty() ? c.ref_temp_topic : c.ref_temp_time_topic);
    const ReferenceTopicSet saved_topics = reference_topics(c);
    while (xQueueReceive(s_ref_queue, &s_ref_task_frame, 0) == pdTRUE) {
        const ReferenceMqttFrame& frame = s_ref_task_frame;
        if (!c.diagnostics_enabled) continue;
        service_circulation_frame(frame, c);
        if (c.ref_temp_topic.empty() || !reference_topic_set_contains(saved_topics, frame.topic))
            continue;
        {
            Lock lk(s_mtx);
            s_ref_status.messages++;
        }
        const DecodedReferenceFrame decoded = decode_reference_frame(
            frame, c.ref_temp_topic, c.ref_temp_path,
            setpoint_topic, c.ref_temp_setpoint_path,
            timestamp_topic, c.ref_temp_time_path,
            c.ref_temp_enabled_path, c.ref_temp_hvac_mode_path);
        if (!decoded.valid) {
            {
                Lock lk(s_mtx);
                if (frame.topic == c.ref_temp_topic) s_ref_status.has_value = false;
                if (!setpoint_topic.empty() && frame.topic == setpoint_topic)
                    s_ref_status.has_setpoint = false;
                if (frame.topic == timestamp_topic) s_ref_status.has_source_time = false;
            }
            set_reference_error(decoded.error ? decoded.error : "Source value is invalid",
                                decoded.error_reason, true);
            continue;
        }

        if (reference_timestamp_moved_backward(decoded, timestamp_topic,
                                               c.ref_temp_time_path)) {
            set_reference_error("Source timestamp moved backward",
                                ReferenceRoomReason::BackwardTimestamp, true);
            continue;
        }
        bool first_valid_payload = false;
        bool recovered_mapping = false;
        ReferenceTemperatureStatus aggregate;
        {
            Lock lk(s_mtx);
            if (decoded.temperature_updated) {
                first_valid_payload = !s_ref_status.has_value;
                s_ref_status.temperature_c = decoded.temperature_c;
                s_ref_status.has_enabled = decoded.has_enabled;
                s_ref_status.enabled = decoded.enabled;
                s_ref_status.has_hvac_mode = decoded.has_hvac_mode;
                s_ref_status.hvac_mode = decoded.hvac_mode;
                s_ref_status.received_ms = frame.received_ms;
                s_ref_status.received_unix_s = frame.received_unix_s;
                s_ref_status.retained = frame.retained;
                if (timestamp_topic.empty()) s_ref_status.timestamp_source = "mqtt_arrival";
                s_ref_status.has_value = true;
            }
            if (decoded.setpoint_updated) {
                s_ref_status.has_setpoint = true;
                s_ref_status.setpoint_c = decoded.setpoint_c;
            }
            if (decoded.timestamp_updated) {
                s_ref_status.has_source_time = true;
                s_ref_status.source_unix_s = decoded.source_unix_s;
                s_ref_status.timestamp_source = decoded.timestamp_source;
            }
            s_ref_status.rejection_reason = ReferenceRoomReason::Eligible;
            s_ref_status.eligibility_error = decoded.control_error ? decoded.control_error : "";
            const bool setpoint_required = c.ref_temp_fixed_setpoint_tenths == 0;
            const bool complete = s_ref_status.has_value &&
                (!setpoint_required || s_ref_status.has_setpoint) &&
                (!timestamp_mapped || s_ref_status.has_source_time);
            recovered_mapping = complete && !s_ref_status.error.empty();
            if (complete) s_ref_status.error.clear();
            if (decoded.control_parse_error) s_ref_status.errors++;
            aggregate = s_ref_status;
        }
        if (recovered_mapping) {
            diag_printf("mqtt: reference temperature mapping recovered\n");
            s_ref_last_logged_error.clear();
            s_ref_last_error_log_ms = 0;
        }
        const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
        int64_t now_unix_s = -1;
        int32_t now_sub_ms = 0;
        time_now(now_unix_s, now_sub_ms);
        const ReferenceFreshness freshness = reference_freshness(
            aggregate.has_value, aggregate.retained, aggregate.has_source_time,
            aggregate.source_unix_s, aggregate.received_ms,
            now_unix_s, now_ms, c.ref_temp_max_age_s);
        ReferenceRoomRaw room_raw;
        room_raw.configured = true;
        room_raw.has_temperature = aggregate.has_value;
        room_raw.temperature_c = aggregate.temperature_c;
        room_raw.has_source_time = aggregate.has_source_time;
        room_raw.setpoint_mapped = c.ref_temp_fixed_setpoint_tenths != 0 ||
                                   !c.ref_temp_setpoint_topic.empty() ||
                                   !c.ref_temp_setpoint_path.empty();
        room_raw.has_setpoint = aggregate.has_setpoint;
        room_raw.setpoint_c = aggregate.setpoint_c;
        room_raw.enabled_mapped = !c.ref_temp_enabled_path.empty();
        room_raw.has_enabled = aggregate.has_enabled;
        room_raw.enabled = aggregate.enabled;
        room_raw.hvac_mode_mapped = !c.ref_temp_hvac_mode_path.empty();
        room_raw.has_hvac_mode = aggregate.has_hvac_mode;
        room_raw.hvac_mode = aggregate.hvac_mode;
        const ReferenceRoomSample room = reference_room_sample(room_raw, freshness);
        if (!room.control_eligible) {
            Lock lk(s_mtx);
            s_ref_status.rejections++;
        }
        if (first_valid_payload)
            diag_printf("mqtt: reference temperature source received first valid payload%s\n",
                        frame.retained ? " (retained)" : "");
    }
}

// esp-mqtt owns its transport/TLS task, so the firmware publish-cycle acknowledgement alone cannot
// describe a handshake or reconnect. MQTT_EVENT_BEFORE_CONNECT runs synchronously on that task
// immediately before esp_transport_connect(). This two-phase handshake either waits behind the
// already-advertised OTA/weather owner, or marks transport allocation active and rechecks the owner
// before returning. A network owner that starts in either store/check gap therefore sees
// s_transport_connecting=true; one that won first keeps MQTT before the TLS call.
//
// The wait has the same five-minute cap as the publisher/poll holds. A broken activity flag must not
// suppress broker reconnects forever; after the cap the pre-fix behavior resumes, while the remote
// operation's own bounded acknowledgement wait still reports/refuses the collision where possible.
static void mqtt_transport_before_connect() {
    // This callback runs under esp-mqtt's MQTT_API_LOCK. If the firmware publish/startup path
    // already owns the allocator it may be about to call esp_mqtt_client_stop(), which needs that
    // same lock. Never wait behind a later OTA/weather claimant in that ordering: claim transport
    // immediately and let the remote owner wait on the already-false publish acknowledgement.
    if (!s_publish_network_quiesced.load(std::memory_order_acquire)) {
        s_transport_connecting.store(true, std::memory_order_release);
        return;
    }
    const TickType_t started = xTaskGetTickCount();
    const TickType_t max_wait = pdMS_TO_TICKS(OTA_QUIESCE_MAX_CYCLES * 1000u);
    for (;;) {
        const bool network_active = competing_tls_active();
        const bool wait_spent = xTaskGetTickCount() - started >= max_wait;
        if (network_active && !wait_spent) {
            s_transport_connecting.store(false, std::memory_order_release);
            vTaskDelay(pdMS_TO_TICKS(250));
            continue;
        }
        s_transport_connecting.store(true, std::memory_order_release);
        if (!competing_tls_active() || wait_spent) return;
        // The owner rose between our first check and publication. Withdraw, let it pass, retry.
        s_transport_connecting.store(false, std::memory_order_release);
    }
}

static void on_mqtt(void*, esp_event_base_t, int32_t id, void* data) {
    switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_BEFORE_CONNECT:
        mqtt_transport_before_connect();
        break;
    case MQTT_EVENT_CONNECTED:
        if (s_mqtt_ever_connected) s_mqtt_reconnects.fetch_add(1);   // a later CONNECTED is a RE-connect
        s_mqtt_ever_connected = true;
        s_connected = true; s_announce = true; s_ref_reconfigure = true;
        s_circulation_reconfigure = true;
        s_circulation_probe_reconfigure = true; set_status(true, nullptr);
        diag_printf("mqtt: %s client connected\n",
                    s_client_is_publisher ? "publisher" : "observation");
        s_transport_connecting.store(false, std::memory_order_release);
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected = false; s_heartbeat_announced = false; set_status(false, nullptr);
        { Lock lk(s_mtx); s_ref_status.subscribed = false; s_circulation_status.subscribed = false; }
        diag_printf("mqtt: disconnected (will retry)\n");
        s_transport_connecting.store(false, std::memory_order_release);
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
    case MQTT_EVENT_DATA: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        capture_reference_frame(e);
        if (e && retained_cleanup_candidate(s_legacy_state, e->topic, e->topic_len,
                                            e->retain, e->total_data_len,
                                            e->current_data_offset)) {
            s_legacy_state_seen = true;
        }
        if (e && retained_cleanup_candidate(s_retired_modbus_status, e->topic, e->topic_len,
                                            e->retain, e->total_data_len,
                                            e->current_data_offset)) {
            s_retired_modbus_status_seen = true;
        }
        if (e && retained_cleanup_candidate(s_retired_weather, e->topic, e->topic_len,
                                            e->retain, e->total_data_len,
                                            e->current_data_offset)) {
            s_retired_weather_seen = true;
        }
        if (e && retained_cleanup_candidate(s_crash, e->topic, e->topic_len,
                                            e->retain, e->total_data_len,
                                            e->current_data_offset)) {
            s_crash_seen = true;
        }
        break; }
    default: break;
    }
}

// Publish task: announce on (re)connect / profile change, then publish both source JSON documents
// when they change. The per-cycle body is guarded — an OOM std::string build must skip the cycle, not
// throw through the FreeRTOS task and reboot the device.
static void mqtt_task(void*) {
    esp_task_wdt_add(NULL);                            // watch the publish task for a wedged broker write
    int heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S;    // publish immediately on the first connected cycle
    int ha_retire_elapsed_s = HA_RETIRE_INTERVAL_S;
    MqttPublishGateState publish_gate = MqttPublishGateState::SubscriberOnly;
    bool publisher_promotion_failed = false;
    OtaQuiesceState network_quiesce;                   // current TLS operation's hold-off budget
    bool network_quiesce_logged     = false;           // one diag line per operation, not per cycle
    bool network_quiesce_cap_logged = false;           // and one if that budget ever runs out

    // Broker reachability and inbound observation do not depend on X10A. This first client carries
    // no installation LWT, and the gate below still encloses EVERY explicit publish. It can therefore
    // subscribe to the room source without letting an unwired board speak for the installation.
    if (!start_current_client()) {
        s_publish_network_quiesced.store(true, std::memory_order_release);
        esp_task_wdt_delete(NULL);
        vTaskDelete(NULL);
    }
    diag_printf("mqtt: subscriber-only client started (publishing waits for X10A)\n");
    for (;;) {
        // Feed the watchdog unconditionally at the top of every cycle — the loop wakes each second
        // regardless of connection state, so this must NOT be gated on s_connected or an actual
        // publish, or a long MQTT disconnect (no publishes) would false-trip the timeout.
        esp_task_wdt_reset();
        // This task's stack headroom, recorded beside the watchdog reset and for the same reason:
        // it is the one statement of the cycle that no branch reaches past. That matters more here
        // than in the other loops — the OTA hold-off below `continue`s out of the cycle entirely,
        // so an end-of-loop sample would stop recording during precisely the episode (a TLS session
        // competing for the heap) worth watching. The mark is retrospective, so the top of the loop
        // still reports the deepest frame the task has ever built.
        stack_watch_sample(StackWatch::Mqtt);
        const int delay_s = POLL_INTERVAL_S;

        // STAND ASIDE while an OTA or weather HTTPS operation owns the heap (#380). Placed above
        // the try, before the first allocation of the cycle: everything below this point builds
        // std::strings, and on the heap a TLS session leaves behind, the largest of them is what
        // throws. Skipping
        // the cycle on purpose costs the same second of data the bad_alloc cost, spends none of the
        // block the download needs, and — unlike the throw — says so in a counter.
        //
        // The watchdog is fed ABOVE this, so a long download cannot false-trip it. The broker
        // connection is unaffected: esp-mqtt runs keepalive on its own task, so a publisher that
        // publishes nothing for a minute stays connected and HA sees a gap, not an `offline`.
        // Bounded by logic/ota_quiesce.hpp — an operation that never finishes must not silence the
        // bridge for the rest of the boot.
        const bool ota_busy = ota_download_active();
        const bool weather_busy = weather_fetch_active();
        const bool network_busy = ota_busy || weather_busy;
        if (ota_quiesce_step(network_quiesce, network_busy)) {
            s_mqtt_quiesced.fetch_add(1, std::memory_order_relaxed);
            if (!network_quiesce_logged) {             // once per operation; the ring is small
                diag_printf("mqtt: holding off publishes during the %s TLS operation\n",
                            ota_busy ? "OTA" : "weather");
                network_quiesce_logged = true;
            }
            s_publish_network_quiesced.store(true, std::memory_order_release);
            vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
            continue;
        }
        {
        MqttPublishActivity publish_activity;
        // Not holding off this cycle — either no TLS operation is running, or the budget ran out
        // while one still is. Those two are worth telling apart in the log: the second means the
        // publisher is back to competing with a TLS session for the heap, so a `publish skipped` can
        // legitimately reappear and it is not a regression of this fix. Once per episode, then
        // rearmed when the operation ends.
        if (ota_quiesce_exhausted(network_quiesce, network_busy)) {
            if (!network_quiesce_cap_logged) {
                diag_printf("mqtt: TLS hold-off budget spent after %u cycles, publishing again\n",
                            static_cast<unsigned>(OTA_QUIESCE_MAX_CYCLES));
                network_quiesce_cap_logged = true;
            }
        } else {
            network_quiesce_logged     = false;        // rearm both lines for the next operation
            network_quiesce_cap_logged = false;
        }

        // Static literals only: the catch path must say WHICH allocation-rich phase failed without
        // allocating another string on the heap that just refused one.
        const char* publish_stage = "gate";
        try {
            const HpStats hp = hp_stats();
            const MqttPublishGateDecision gate = mqtt_publish_gate_step(
                publish_gate, hp.connected, hp.last_ok_s, s_connected.load());

            // The first valid bus response upgrades the existing subscriber-only session to a fresh
            // client whose CONNECT packet carries the installation LWT. A clean stop means the old
            // no-LWT session cannot emit `offline`; publication begins only after the replacement
            // client reports MQTT_EVENT_CONNECTED on a later cycle.
            if (gate.promote_publisher && !publisher_promotion_failed) {
                if (promote_client_to_publisher()) {
                    publish_gate = gate.next;
                } else {
                    publisher_promotion_failed = true; // do not repeat a stop/destroy transition
                }
            } else if (!gate.promote_publisher) {
                publish_gate = gate.next;
            }

            // SubscriberOnly/Paused services exact-topic inbound subscriptions and bounded frame
            // decoding. The only outbound exception is a user-requested retained tombstone for a
            // just-disabled weather/HomeHub source. Ordinary publication remains below
            // gate.publish_cycle, so no discovery/state/heartbeat/value payload can escape.
            publish_stage = "config";
            const Config ref_config = config();
            publish_stage = "subscriptions";
            service_reference_subscription(ref_config);
            service_circulation_subscription(ref_config);
            service_circulation_probe_subscription(ref_config);
            service_reference_frames(ref_config);
            // The circulation witness is MQTT-owned and remains meaningful while X10A auto-detect
            // is backing off on a silent bus. Record it on this task's independent one-second tick;
            // tying it to hp_poll would leave /status.history.rows empty exactly in that case.
            if (ref_config.diagnostics_enabled) history_record_circulation();
            service_requested_topic_cleanup(ref_config);
            publish_stage = "heating_curve";
            evaluate_heating_curve(ref_config, hp);

            if (gate.publish_offline) {
                mqtt_publish(s_avail, "offline", 0, 1, 1);
                diag_printf("mqtt: X10A unavailable — publishing paused\n");
            }

            // A bus recovery on the same broker session needs only a fresh availability/state seed;
            // discovery is already retained. If the broker reconnected while the bus was down,
            // s_announce remains set and the full ordinary reconnect path below owns the reseed.
            if (gate.resumed && s_connected && !s_announce.load()) {
                mqtt_publish(s_avail, "online", 0, 0, 1);
                s_last_x10a_digest = 0;
                s_last_x10a_digest_valid = false;
                s_x10a_publish_proven.store(false, std::memory_order_release);
                heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S;
                diag_printf("mqtt: X10A restored — publishing resumed\n");
            }

            if (gate.publish_cycle) {
                publish_stage = "announce";
                if (s_announce.exchange(false)) {              // consume: just (re)connected
                    s_announced_profile.clear();               // force a fresh discovery below
                    s_last_x10a_digest = 0;                    // force full per-topic state re-seeds
                    s_last_x10a_digest_valid = false;
                    s_x10a_publish_proven.store(false, std::memory_order_release);
                    s_last_modbus_json.clear();
                    s_last_weather_json.clear();
                    s_disabled_weather_cleaned = false;
                    s_last_env3_json.clear();
                    s_last_env3_samples = 0;
                    s_modbus_disabled_cleaned = false;
                    s_env3_disabled_cleaned = false;
                    s_env3_discovery_announced = false;
                    // Force the board/link diagnostic discovery to re-publish on THIS (re)connect. The
                    // disconnect handler also clears s_heartbeat_announced, but a DISCONNECT landing
                    // mid-discovery (after the check below, before the publishes finish) could leave it
                    // stuck true and skip discovery after the next reconnect. Tying the reset to the
                    // announce — set on EVERY connect — closes that race.
                    s_heartbeat_announced = false;
                    heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S; // publish it right away, then every 10 s
                    mqtt_publish(s_avail, "online", 0, 0, 1);
                    // HomeHub values remain an MQTT contract, but their former HA entities are
                    // permanently retired. Retained tombstones remove existing entities and make a
                    // restored stale broker converge again on the next reconnect.
                    retract_modbus_discovery();
                    retract_weather_discovery();
                    ha_retire_elapsed_s = 0;
                    // Probe before deleting a retired data topic. Publishing tombstones
                    // unconditionally here recreates visible empty topics on every reconnect after
                    // the broker is already clean. DATA events raise the atomic flags only for
                    // non-empty retained values on these exact topics.
                    start_retained_cleanup_probe(s_legacy_state, s_legacy_state_seen,
                                                 s_legacy_probe_active,
                                                 s_legacy_probe_deadline_us, "legacy state");
                    start_retained_cleanup_probe(s_retired_modbus_status,
                                                 s_retired_modbus_status_seen,
                                                 s_retired_modbus_status_probe_active,
                                                 s_retired_modbus_status_probe_deadline_us,
                                                 "retired Modbus status");
                    start_retained_cleanup_probe(s_retired_weather, s_retired_weather_seen,
                                                 s_retired_weather_probe_active,
                                                 s_retired_weather_probe_deadline_us,
                                                 "retired weather forecast");
                }
                service_retained_cleanup_probe(s_legacy_state, s_legacy_state_seen,
                                               s_legacy_probe_active,
                                               s_legacy_probe_deadline_us);
                service_retained_cleanup_probe(s_retired_modbus_status,
                                               s_retired_modbus_status_seen,
                                               s_retired_modbus_status_probe_active,
                                               s_retired_modbus_status_probe_deadline_us);
                service_retained_cleanup_probe(s_retired_weather, s_retired_weather_seen,
                                               s_retired_weather_probe_active,
                                               s_retired_weather_probe_deadline_us);
                service_retained_cleanup_probe(s_crash, s_crash_seen,
                                               s_crash_probe_active,
                                               s_crash_probe_deadline_us);
                if (!s_heartbeat_announced) {                  // board/link diagnostics — independent
                    publish_heartbeat_discovery();              // of heat-pump profile detection
                    publish_crash();                            // crash report if notable, else stale-record probe
                    s_heartbeat_announced = true;
                }
                publish_stage = "x10a";
                const std::string& prof = ref_config.profile;
                if (prof != "auto" && prof != s_announced_profile) {
                    publish_x10a_discovery();                  // discovery for the (new) profile
                    s_announced_profile = prof;
                    // A short all-page timeout stays inside the availability grace, but poll_once()
                    // correctly replaced its cache with an empty snapshot. Do not turn that honest
                    // local absence into a retained `{}` for every downstream consumer. The next
                    // answering sweep seeds state because the digest guard is still invalid here.
                    if (hp.connected) publish_x10a_state(ref_config, true);
                } else if (hp.connected && !s_announced_profile.empty() &&
                           prof == s_announced_profile) {
                    publish_x10a_state(ref_config, false);     // republish only when it changed
                }
                // prof == "auto" (detection pending): wait — don't publish transient generic sensors.

                publish_stage = "modbus";
                const bool modbus_enabled = mb_status().enabled;
                if (modbus_enabled) {
                    // State publication is independent of Home Assistant discovery. This also
                    // starts correctly when MQTT connects before the separate Modbus task, or when
                    // Modbus is enabled dynamically through POST /set_hp.
                    s_modbus_disabled_cleaned = false;
                    publish_modbus_state();
                } else if (!s_modbus_disabled_cleaned) {
                    // Covers a live POST /set_hp disable. Discovery and the duplicate status topic
                    // are already retired; remove only the independent data topic.
                    mqtt_publish(s_modbus, "", 0, 0, 1);
                    s_last_modbus_json.clear();
                    s_modbus_disabled_cleaned = true;
                }

                // Weather remains an independent firmware input. MQTT archives it while its saved
                // location exists; deleting the location removes the retained predecessor without
                // publishing a synthetic disabled document. No HA entities are created.
                publish_stage = "weather";
                publish_weather_state(ref_config.diagnostics_enabled && ref_config.weather_enabled);

                publish_stage = "env3";
                const bool env3_enabled = ref_config.env3_enabled && env3_board_supported(ref_config);
                if (env3_enabled) {
                    s_env3_disabled_cleaned = false;
                    if (!s_env3_discovery_announced) {
                        publish_env3_discovery();
                        s_env3_discovery_announced = true;
                        diag_printf("mqtt: ENV III HA discovery announced\n");
                    }
                    publish_env3_state();
                } else if (!s_env3_disabled_cleaned) {
                    // Disabling the configured sensor removes its retained data topic and its three
                    // retained discovery configs. The tombstones are repeated after every reconnect
                    // so a restored old broker converges instead of resurrecting ghost entities.
                    mqtt_publish(s_env3, "", 0, 0, 1);
                    retract_env3_discovery();
                    s_last_env3_json.clear();
                    s_last_env3_samples = 0;
                    s_env3_discovery_announced = false;
                    s_env3_disabled_cleaned = true;
                }

                // HA may have been offline for the connect-time tombstones. Repeat the retired-topic
                // cleanup periodically so it converges after HA returns; no retained config is ever
                // recreated, and the independent /modbus + /weather data streams are untouched.
                publish_stage = "retire";
                ha_retire_elapsed_s += delay_s;
                if (ha_retire_elapsed_s >= HA_RETIRE_INTERVAL_S) {
                    retract_modbus_discovery();
                    retract_weather_discovery();
                    ha_retire_elapsed_s = 0;
                }

                // Fixed HEARTBEAT_INTERVAL_S cadence for both technical heartbeat and the separate
                // heating-curve domain snapshot; neither needs every-cycle publish-on-change.
                publish_stage = "heartbeat";
                heartbeat_elapsed_s += delay_s;
                if (heartbeat_elapsed_s >= HEARTBEAT_INTERVAL_S) {
                    publish_heartbeat();
                    if (ref_config.diagnostics_enabled) publish_heating_curve_telemetry();
                    // The crash topic is RETAINED but otherwise only published once per connect, so a
                    // dump pulled + cleared (POST /coredump/clear) mid-session would leave HA's "Crash
                    // Dump Waiting" ON until the next reconnect (and, for an orphan-dump-only boot,
                    // leave a stale crash record no longer backed by anything). Re-check on the
                    // heartbeat cadence (one 4-byte flash read, no summary parse) and republish only
                    // on a real change — publish_crash() then re-decides notability and probes away
                    // an older retained topic if the boot is no longer notable.
                    // Done HERE, not in the /coredump handler: mqtt_publish() feeds the Task Watchdog
                    // and is only valid from this (subscribed) task.
                    //
                    // NOTABILITY is checked beside the dump flag, not derived from it: dismissing a
                    // crash (POST /crash/dismiss) on a FAULT boot that left no dump — a stack
                    // overflow overruns the dump too, which is how the crashes here actually look —
                    // changes no flash byte, so a dump-only test would leave the retained crash
                    // record standing in HA after the user deleted it on the device.
                    const CrashInfo cnow = diag_crash_info_live();
                    if (cnow.coredump != s_crash_dump_pub ||
                        crash_is_notable(cnow) != s_crash_notable_pub) publish_crash();
                    heartbeat_elapsed_s = 0;
                }
            }
        } catch (const std::exception& e) {
            // COUNT FIRST, then log — diag_printf allocates, so on the heap that caused this it can
            // throw again, and a throw inside a catch handler is std::terminate (the reboot this
            // guard exists to prevent). The atomic add cannot fail, so the cycle is recorded even
            // when the line describing it never reaches the ring — which is the whole complaint in
            // #380: the ring was the only evidence, and a chatty boot overwrites it.
            //
            // The heap snapshot rides the SAME line (private issue 10 E): both sampler calls are
            // allocation-free, and the throw second's free/largest-block pair is what identifies the
            // collision partner (status build, TLS teardown tail, …) that split the block mid-cycle
            // — the one datum every earlier `publish skipped` line lacked, which made the events
            // provably heap-healthy at 10-s sampling and unprovable at the throw instant.
            s_mqtt_skipped.fetch_add(1, std::memory_order_relaxed);
            diag_printf("mqtt: publish skipped at %s (%s; free=%u B largest=%u B)\n", publish_stage,
                        e.what(),
                        static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_8BIT |
                                                                      MALLOC_CAP_INTERNAL)),
                        static_cast<unsigned>(heap_largest_internal_block()));
        } catch (...) {
            s_mqtt_skipped.fetch_add(1, std::memory_order_relaxed);
            diag_printf("mqtt: publish skipped at %s (oom?; free=%u B largest=%u B)\n", publish_stage,
                        static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_8BIT |
                                                                      MALLOC_CAP_INTERNAL)),
                        static_cast<unsigned>(heap_largest_internal_block()));
        }
        }
        vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
    }
}

// Validate the URI/credential combination and build one of two client modes. The initial
// subscriber-only client deliberately has no shared installation LWT; after X10A proof the task
// rebuilds it with publisher_lwt=true. Both modes use the same broker/TLS/credential identity.
// Returns false (with an error set in /status.mqtt) if the config would leak credentials over
// plaintext.
static bool build_client(bool publisher_lwt) {
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
    cfg.credentials.client_id = s_board.c_str();   // per-BOARD: a client id must be unique per connection
    if (!s_user.empty()) cfg.credentials.username = s_user.c_str();
    if (!s_pass.empty()) cfg.credentials.authentication.password = s_pass.c_str();
    cfg.session.keepalive         = 30;
    if (publisher_lwt) {
        cfg.session.last_will.topic   = s_avail.c_str();
        cfg.session.last_will.msg     = "offline";
        cfg.session.last_will.msg_len = 7;
        cfg.session.last_will.qos     = 1;
        cfg.session.last_will.retain  = 1;
    }

    s_client = esp_mqtt_client_init(&cfg);
    if (!s_client) { set_status(false, "mqtt init failed"); return false; }
    s_client_is_publisher = publisher_lwt;
    esp_mqtt_client_register_event(s_client, static_cast<esp_mqtt_event_id_t>(MQTT_EVENT_ANY),
                                   on_mqtt, nullptr);
    { Lock lk(s_mtx); s_status.tls = is_tls; }
    return true;
}

static bool start_current_client() {
    if (!s_client) {
        set_status(false, "mqtt init failed");
        return false;
    }
    const esp_err_t rc = esp_mqtt_client_start(s_client);
    if (rc == ESP_OK) {
        set_status(false, "");
        return true;
    }
    set_status(false, "client start failed");
    diag_printf("mqtt: client start failed (%s)\n", esp_err_to_name(rc));
    esp_mqtt_client_destroy(s_client);               // start failed: no task/session is running
    s_client = nullptr;
    return false;
}

// Replace the connected/read-only client rather than mutating its CONNECT contract in place. The
// old session is stopped cleanly (so there is no LWT at all), then destroyed before the publisher
// client is allocated, avoiding two simultaneous MQTT/TLS clients on this heap-constrained board.
// This runs on mqtt_task, never inside esp-mqtt's event handler, which is the API's required stop
// boundary. Task-owned subscription bookkeeping is cleared because the broker discarded the old
// clean session; MQTT_EVENT_CONNECTED on the replacement forces both exact-topic subscriptions.
static bool promote_client_to_publisher() {
    if (!s_client) {
        set_status(false, "mqtt init failed");
        return false;
    }
    const esp_err_t stop_rc = esp_mqtt_client_stop(s_client);
    if (stop_rc != ESP_OK) {
        set_status(false, "client stop failed");
        diag_printf("mqtt: subscriber client stop failed (%s)\n", esp_err_to_name(stop_rc));
        return false;
    }
    // esp_mqtt_client_stop() deliberately emits no DISCONNECTED event. Withdraw a possible
    // BEFORE_CONNECT claim explicitly after the transport task has stopped; MqttPublishActivity
    // still keeps the firmware acknowledgement false throughout this promotion.
    s_transport_connecting.store(false, std::memory_order_release);

    s_connected = false;
    set_status(false, "");
    {
        Lock lk(s_mtx);
        s_ref_status.subscribed = false;
        s_circulation_status.subscribed = false;
    }
    s_ref_subscribed_topics = {};
    s_circulation_subscribed_topic.clear();
    s_circulation_probe_subscribed_topic.clear();
    s_circulation_probe_task_generation = 0;
    esp_mqtt_client_destroy(s_client);
    s_client = nullptr;

    if (!build_client(true) || !start_current_client()) {
        diag_printf("mqtt: publisher client promotion failed\n");
        return false;
    }
    diag_printf("mqtt: X10A proven — publisher client started with installation LWT\n");
    return true;
}

void mqtt_ha_start() {
    MqttStartupActivity startup_activity;
    const Config& c = config();
    s_x10a_publish_required.store(!c.mqtt_uri.empty(), std::memory_order_release);
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) diag_printf("mqtt: status mutex alloc failed — status reads run unsynchronized\n");
    s_status.configured = !c.mqtt_uri.empty();
    s_status.broker     = c.mqtt_uri;
    s_ref_status.configured = !c.ref_temp_topic.empty();
    s_circulation_status.configured = !c.circulation_topic.empty();
    s_circulation_runtime_max_age_s = c.circulation_max_age_s;
    // The circulation test shares std::strings with the HTTP task, so it is safe only when both
    // synchronization objects exist.
    s_circulation_probe_sem = s_mtx ? xSemaphoreCreateBinary() : nullptr;
    if (!s_circulation_probe_sem)
        diag_printf("mqtt: circulation-source test semaphore alloc failed\n");
    if (!s_status.configured) return;

    s_ref_queue = xQueueCreate(REF_QUEUE_DEPTH, sizeof(ReferenceMqttFrame));
    if (!s_ref_queue) {
        s_ref_status.error = "receive queue alloc failed";
        s_ref_status.errors++;
        s_circulation_status.error = "receive queue alloc failed";
        s_circulation_status.errors++;
        diag_printf("mqtt: reference receive queue alloc failed\n");
    }

    // The installation's base topic: the persisted value when set, else the compile-time default.
    // Resolved ONCE, here, because the thirteen topics and the HA node id below all derive from it —
    // a second copy of the empty-means-default rule is how one of them would end up on another base.
    s_base   = mqtt_base_effective(config().mqtt_base, CONFIG_DAIKIN_MQTT_BASE_TOPIC);
    s_node   = device_node_id(s_base);   // HA device id: the installation, NOT this board
    s_board  = board_id();               // this board: MQTT client id + dev.ids merge key
    s_prefix = CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX;
    s_avail     = availability_topic(s_base);
    s_x10a      = x10a_topic(s_base);
    s_modbus    = modbus_topic(s_base);
    s_weather   = weather_forecast_topic(s_base);
    s_env3      = env3_topic(s_base);
    s_retired_weather = retired_weather_forecast_topic(s_base);
    s_retired_modbus_status = retired_modbus_status_topic(s_base);
    s_legacy_state = legacy_state_topic(s_base);
    s_heartbeat = heartbeat_topic(s_base);
    s_heating_curve_topic = heating_curve_topic(s_base);
    s_crash     = crash_topic(s_base);
    if (!build_client(false)) return;                          // policy error already surfaced
    // mqtt_task starts this no-LWT client immediately for inbound reference observations. Every
    // explicit publish stays behind the X10A gate, and only the first valid bus response replaces
    // this handle with a client whose CONNECT packet arms the shared installation LWT.
    set_status(false, "");
    // Hardware coredump: the 4 KiB task hit the ESP32-S3 stack-end watchpoint while building the
    // heartbeat after Config gained the reference-source strings. heartbeat.hpp no longer creates
    // chained temporary strings, and 6 KiB restores explicit headroom for future bounded mappings.
    if (xTaskCreate(mqtt_task, "mqtt_pub", 6144, nullptr, TASK_PRIO_MQTT, nullptr) != pdPASS) {
        // No task -> the client was built but never started, so neither subscriptions nor publishes
        // are possible. Keep the startup claim through cleanup; its destructor releases the claim
        // only after the client and diagnostic work finish.
        esp_mqtt_client_destroy(s_client);
        s_client = nullptr;
        set_status(false, "publish task alloc failed");
        diag_printf("mqtt: publish task alloc failed — no MQTT activity this boot\n");
    } else {
        startup_activity.hand_off();
    }
}

MqttStatus mqtt_status() {
    if (!s_mtx) return s_status;
    Lock lk(s_mtx);
    MqttStatus st = s_status;   // reader may allocate under an RAII lock (the broker std::string copy)
    st.error = s_error;         // error is kept as a literal pointer; stringified here, under the lock
    return st;
}

MqttSkipStats mqtt_skip_stats() {
    // No lock: both are atomics, and s_mtx guards s_status/s_error, not these. Taking it here would
    // put the /status builder behind the publish task's status writes for two counter reads.
    MqttSkipStats st;
    st.skipped  = s_mqtt_skipped.load(std::memory_order_relaxed);
    st.quiesced = s_mqtt_quiesced.load(std::memory_order_relaxed);
    return st;
}

bool mqtt_x10a_publish_proven() {
    return s_x10a_publish_proven.load(std::memory_order_acquire);
}

bool mqtt_x10a_publish_required() {
    return s_x10a_publish_required.load(std::memory_order_acquire);
}

bool mqtt_publish_network_quiesced() {
    return s_publish_network_quiesced.load(std::memory_order_acquire) &&
           !s_transport_connecting.load(std::memory_order_acquire);
}

ReferenceTemperatureStatus reference_temperature_status() {
    if (!s_mtx) return s_ref_status;
    Lock lk(s_mtx);
    return s_ref_status;
}

logic::HeatingCurveSnapshot heating_curve_status() {
    if (!s_mtx) return s_heating_curve_diagnosis.snapshot();
    Lock lk(s_mtx);
    return s_heating_curve_diagnosis.snapshot();
}

void mqtt_reference_reconfigure() {
    s_ref_reconfigure = true;
}

CirculationSourceStatus circulation_source_status() {
    CirculationSourceStatus st;
    if (!s_mtx) st = s_circulation_status;
    else {
        Lock lk(s_mtx);
        st = s_circulation_status;
    }
    const Config c = config();
    st.configured = !c.circulation_topic.empty();
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    const ReferenceFreshness freshness = reference_freshness(
        st.has_value, st.retained, st.has_source_time, st.source_unix_s,
        st.received_ms, now_unix_s, now_ms, c.circulation_max_age_s);
    st.fresh = freshness.fresh;
    st.age_known = freshness.age_known;
    st.age_s = freshness.age_s;
    st.freshness_reason = freshness.reason ? freshness.reason : "no_value";
    if (!st.fresh) st.state = CirculationPowerState::Unknown;
    return st;
}

CirculationPumpSample circulation_pump_sample() {
    // Poll-task hot path: copy only POD under the MQTT mutex. Calling circulation_source_status()
    // here would copy several std::strings plus the whole Config every sweep, creating permanent
    // heap churn merely to obtain two booleans.
    bool configured = false, has_value = false, retained = false, has_source_time = false;
    uint64_t received_ms = 0;
    int64_t source_unix_s = -1;
    uint32_t max_age_s = CIRC_SOURCE_MAX_AGE_DEFAULT_S;
    CirculationPowerState state = CirculationPowerState::Unknown;
    {
        Lock lk(s_mtx);
        configured = s_circulation_status.configured;
        has_value = s_circulation_status.has_value;
        retained = s_circulation_status.retained;
        has_source_time = s_circulation_status.has_source_time;
        received_ms = s_circulation_status.received_ms;
        source_unix_s = s_circulation_status.source_unix_s;
        state = s_circulation_status.state;
        max_age_s = s_circulation_runtime_max_age_s;
    }
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    const bool fresh = reference_freshness(
        has_value, retained, has_source_time, source_unix_s,
        received_ms, now_unix_s, now_ms, max_age_s).fresh;
    return {configured, fresh && state != CirculationPowerState::Unknown,
            fresh && state == CirculationPowerState::On};
}

CirculationSourceTestResult mqtt_circulation_test(
    const CirculationSourceTestConfig& candidate, uint32_t timeout_ms) {
    CirculationSourceTestResult result;
    if (!s_mtx || !s_circulation_probe_sem) {
        result.error = "Circulation source test is unavailable";
        return result;
    }
    if (!s_connected) { result.error = "MQTT broker is not connected"; return result; }

    CirculationSourceTestConfig prepared = candidate;
    xSemaphoreTake(s_circulation_probe_sem, 0);
    uint32_t generation = 0;
    {
        Lock lk(s_mtx);
        if (s_circulation_probe.active) {
            result.error = "Another circulation source test is already running";
            return result;
        }
        generation = s_circulation_probe.generation + 1;
        if (generation == 0 || generation > 0x7fffffffu) generation = 1;
        s_circulation_probe.passed = false;
        s_circulation_probe.config.topic.swap(prepared.topic);
        s_circulation_probe.config.power_path.swap(prepared.power_path);
        s_circulation_probe.config.timestamp_path.swap(prepared.timestamp_path);
        s_circulation_probe.config.max_age_s = prepared.max_age_s;
        s_circulation_probe.config.on_tenths_w = prepared.on_tenths_w;
        s_circulation_probe.config.off_tenths_w = prepared.off_tenths_w;
        s_circulation_probe.config.confirm_s = prepared.confirm_s;
        s_circulation_probe.generation = generation;
        s_circulation_probe.active = true;
        s_circulation_probe.subscribed = false;
        s_circulation_probe.retained = false;
        s_circulation_probe.power_w = 0.0;
        s_circulation_probe.state = CirculationPowerState::Unknown;
        s_circulation_probe.error.clear();
    }
    s_circulation_probe_reconfigure = true;
    xSemaphoreTake(s_circulation_probe_sem, pdMS_TO_TICKS(timeout_ms));
    {
        Lock lk(s_mtx);
        if (s_circulation_probe.generation == generation && s_circulation_probe.passed) {
            result.passed = true;
            result.retained = s_circulation_probe.retained;
            result.power_w = s_circulation_probe.power_w;
            result.state = s_circulation_probe.state;
            result.proof = generation;
        } else if (s_circulation_probe.generation == generation) {
            s_circulation_probe.active = false;
            result.error = s_circulation_probe.error.empty()
                         ? "No fresh value received before the test timed out"
                         : s_circulation_probe.error;
        } else {
            result.error = "Circulation source test was replaced";
        }
    }
    s_circulation_probe_reconfigure = true;
    return result;
}

bool mqtt_circulation_test_proof_valid(uint32_t proof,
                                       const CirculationSourceTestConfig& candidate) {
    if (!s_mtx || proof == 0) return false;
    Lock lk(s_mtx);
    return s_circulation_probe.passed && s_circulation_probe.generation == proof &&
           s_circulation_probe.config.topic == candidate.topic &&
           s_circulation_probe.config.power_path == candidate.power_path &&
           s_circulation_probe.config.timestamp_path == candidate.timestamp_path &&
           s_circulation_probe.config.max_age_s == candidate.max_age_s &&
           s_circulation_probe.config.on_tenths_w == candidate.on_tenths_w &&
           s_circulation_probe.config.off_tenths_w == candidate.off_tenths_w &&
           s_circulation_probe.config.confirm_s == candidate.confirm_s;
}

void mqtt_circulation_reconfigure() {
    s_circulation_reconfigure = true;
    s_circulation_probe_reconfigure = true;
    checkup_dhw_reset();                // source identity/threshold changes invalidate attribution only
    history_circulation_reset();
    if (!s_mtx) return;
    Lock lk(s_mtx);
    s_circulation_probe.active = false;
    s_circulation_probe.passed = false;
}

void mqtt_request_weather_cleanup() { s_weather_cleanup_requested = true; }
void mqtt_request_modbus_cleanup() { s_modbus_cleanup_requested = true; }

} // namespace daik
