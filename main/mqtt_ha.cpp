// Home Assistant MQTT-Discovery bridge (see mqtt_ha.hpp + docs/ARCHITECTURE.md → MQTT bridge).
// esp-mqtt client in its own publish task:
//   • TLS policy: credentials present ⇒ mqtts:// + CA-verified (esp_crt_bundle); NEVER send
//     credentials over plaintext (no silent fallback — refuse with an error in /status.mqtt).
//   • One client carries the retained <base>/status transport LWT from its initial connection.
//     Independent HomeHub, ENV III and board diagnostics remain publishable without X10A.
//     X10A discovery requires both transport and <base>/x10a/status, whose 15-second observation
//     grace never extends a retained state into fresh evidence. Recovery announces source online
//     only after a fresh state seed is accepted. A short empty sweep does not retain empty X10A.
//   • On (re)connect: mark transport online, seed each source from its own current liveness, and
//     retract frozen retired discovery with broker-confirmed cleanup. An OTA pause withdraws
//     transport availability before its clean stop, which otherwise discards the LWT.
//   • Each cycle: publish X10A's grouped JSON to <base>/x10a, the generation-checked flat HomeHub
//     JSON to <base>/modbus and each fresh ENV III sample to <base>/env3.
//     A disconnected HomeHub publishes `{}`, and an unavailable/stale ENV III omits its three
//     readings (keeping only its samples/errors I2C counters), rather than carrying an old
//     reading forward. Message topics sit directly under
//     <base> — one board per base topic; the node
//     id identifies the DEVICE only in each discovery config's uniq_id/dev.ids + the
//     <prefix>/<component>/<node>/<group>_<object_id> discovery topic. That node id is derived from
//     the BASE TOPIC (logic/ha_device.hpp), not from the board's MAC, so replacing the ESP32 keeps
//     ONE HA device and its entities; the full hardware MAC identifies the MQTT client and a
//     secondary dev.ids entry. Legacy short-MAC identities require operator migration rather than
//     guessed ownership. The entity id carries the REGISTER GROUP because uniq_id and the
//     discovery topic are flat namespaces while a label is unique only within its page
//     (legacy-221). Frozen ungrouped and relabelled entities under the current owned namespace are
//     retracted before replacement discovery.
//   • Every HEARTBEAT_INTERVAL_S (10 s): rebuild + publish board/link diagnostics
//     (logic/heartbeat.hpp) to <base>/heartbeat.
//   • Once per (re)connect: RETAIN the boot-time crash summary (logic/crashinfo.hpp) on
//   <base>/crash
//     ONLY when the reset was a real fault or a core-dump is still in flash. On a normal boot,
//     probe the topic and delete it only if the broker still holds an older crash; a clean broker
//     gets no empty publish, so live MQTT clients do not invent a payload-less /crash node. When a
//     crash IS reported it drives one diagnostic HA entity — a "dump waiting" flag (the reset
//     reason is the heartbeat's own "Reset Reason" sensor, so a crash entity for it would be a
//     duplicate). Reason/backtrace only; never the raw dump or any secret.
// Read-only circulation subscriptions use exact topics. Bounded migration probes also look for
// actually-retained <base>/state, <base>/modbus/status and resolved <base>/crash payloads; a clean
// broker receives no empty publish on any of them. No-op if mqtt_uri is empty. Memory-safe:
// discovery is one small publish per value; the state JSON is a single few-KB build, guarded
// against OOM.
#include "mqtt_ha.hpp"
#include "mqtt_retirement_store.hpp"
#include "net.hpp"
#include "config.hpp"
#include "logic/task_failure.hpp"
#include "checkup.hpp"
#include "heater_context_store.hpp"
#include "def/homehub.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "heap_guard.hpp"
#include "json_guard.hpp"
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
#include "logic/heartbeat.hpp"
#include "logic/heater_context_payload.hpp"
#include "logic/hydronic_payload.hpp"
#include "logic/mqtt_base.hpp"   // mqtt_base_effective — the installation's base topic, host-tested
#include "logic/mqtt_cleanup.hpp"
#include "logic/mqtt_discovery_owner.hpp"
#include "logic/mqtt_retirement.hpp"
#include "logic/mqtt_retirement_identity.hpp"
#include "logic/mqtt_group.hpp"
#include "logic/mqtt_publish_gate.hpp"
#include "logic/ota_quiesce.hpp" // stand aside while an OTA TLS op owns the heap (legacy-380)
#include "logic/payload_complete.hpp"
#include "logic/mqtt_source.hpp"
#include "logic/mqtt_weather_retirement.hpp"
#include "logic/reset_reason.hpp"
#include "esp_mac.h"
#include "ota_update.hpp"          // ota_download_active — the flag the quiesce above reads
#include "sntp_time.hpp"
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
#include <type_traits>
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
static std::atomic<bool>        s_circulation_reconfigure{false};
static std::atomic<bool>        s_circulation_probe_reconfigure{false};
// Queue the retired forecast once per boot, with bounded retry and PUBACK tracking.
static std::atomic<bool>        s_weather_cleanup_requested{true};
static std::atomic<bool>        s_modbus_cleanup_requested{false};
static std::atomic<bool>        s_env3_cleanup_requested{false};
// Source cleanup state is owned by mqtt_task. The event task contributes only fixed-size PUBACK
// evidence and the epoch of the connected client; Settings writers contribute the request bits
// above. A new client epoch restarts the idempotent sequence, while a reconnect of the same client
// preserves esp-mqtt's queued packet and its expected message id.
static MqttCleanupScheduler         s_source_cleanup;
static MqttRetirementDelivery       s_retirement_delivery;
static void                         service_source_cleanup_evidence();
static MqttCleanupEvidenceQueue<32> s_source_cleanup_evidence;
static std::atomic<bool>            s_source_cleanup_evidence_lost{false};
static std::atomic<uint32_t>        s_mqtt_client_epoch{0};
static std::atomic<uint32_t>        s_connected_client_epoch{0};
static uint32_t                     s_source_cleanup_evidence_drops_reported = 0; // mqtt_task only

// The task starts one LWT-bearing transport immediately. Definitions live beside its builder;
// forward declarations
// keep the publish loop above the configuration/lifecycle glue without duplicating either contract.
static bool      build_client(const Config& c);
static esp_err_t start_client_transport();
static bool start_current_client();
// Counted publish wrapper, defined with mqtt_publish_id() below; the OTA pause step precedes both.
static bool mqtt_publish(const std::string& topic, const char* payload, int len, int qos,
                         int retain);

// MQTT_EVENT_DATA runs on esp-mqtt's unguarded event task. It therefore only copies into this one
// bounded frame and posts it to a queue; JSON parsing and all std::string work stay on the
// exception-guarded mqtt_task. 1024 B comfortably covers the 435 B Shelly test payload while
// keeping an accidentally huge subscribed document from consuming the ESP32 heap.
//
// Eight bounded descriptors absorb live/probe circulation bursts before the next task tick.
static constexpr size_t CIRCULATION_QUEUE_DEPTH        = 8;
static constexpr size_t CIRCULATION_PAYLOAD_MAX        = 1024;
static constexpr size_t DISCOVERY_OWNER_PAYLOAD_MAX = 2048;
static constexpr size_t CIRCULATION_PAYLOAD_RING_BYTES = 3584;
struct CirculationMqttFrame {
    char     topic[MQTT_SOURCE_TOPIC_MAX + 1]     = {0};
    char     payload[CIRCULATION_PAYLOAD_MAX + 1] = {0};
    size_t payload_len = 0;
    uint64_t received_ms = 0;
    int64_t received_unix_s = -1;
    uint32_t circulation_epoch                 = 0;
    uint32_t probe_generation                  = 0;
    bool   retained = false;
};
// Variable-length inbound topics and payloads share one static SPSC ring rather than allocating
// eight worst-case 1,256-byte frames in internal heap (~6 KiB net DRAM reclaimed).
// Zero default init keeps static scratch metadata descriptors in BSS; callers populate all fields.
struct CirculationMqttFrameQueued {
    int64_t  received_unix_s   = 0;
    uint64_t received_ms       = 0;
    uint32_t circulation_epoch = 0;
    uint32_t probe_generation  = 0;
    uint16_t ring_offset       = 0;
    uint16_t topic_len         = 0;
    uint16_t payload_len       = 0;
    bool     retained          = false;
};
static_assert(sizeof(CirculationMqttFrameQueued) <= 48,
              "inbound frame queue descriptor must stay compact");
static QueueHandle_t         s_inbound_queue = nullptr;
static uint8_t               s_inbound_payload_ring[CIRCULATION_PAYLOAD_RING_BYTES]{};
static uint32_t              s_inbound_ring_produced = 0; // esp-mqtt event task only
static size_t                s_inbound_ring_pos      = 0; // esp-mqtt event task only
static std::atomic<uint32_t> s_inbound_ring_consumed{0};  // mqtt_task updates, event task acquires
static CirculationMqttFrameQueued s_inbound_rx_meta{};    // esp-mqtt event task only
static CirculationMqttFrameQueued s_inbound_task_meta{};  // mqtt_task only
// These scratch objects are never consumed before the event path fills their metadata or the
// task receives a complete frame from its queue. A zero-only startup image keeps their buffers in
// BSS; time_now always replaces the event timestamp, including -1 before clock synchronization.
constexpr CirculationMqttFrame circulation_frame_scratch() {
    CirculationMqttFrame frame;
    frame.received_unix_s = 0;
    return frame;
}
// esp-mqtt delivers one packet's fragments sequentially on its single event task. Sharing one
// event-task reassembly union avoids keeping a separate 1,256-byte CirculationMqttFrame static
// alongside the 2,048-byte discovery-owner reassembly buffer.
union EventMqttRxScratch {
    CirculationMqttFrame circulation;
    char               discovery[DISCOVERY_OWNER_PAYLOAD_MAX];
    constexpr EventMqttRxScratch() : circulation(circulation_frame_scratch()) {}
};
static EventMqttRxScratch  s_event_rx;
static CirculationMqttFrame& s_inbound_rx         = s_event_rx.circulation;
static CirculationMqttFrame  s_inbound_task_frame = circulation_frame_scratch(); // mqtt_task-owned
static bool                  s_inbound_rx_active  = false;
static bool                s_event_rx_discovery_active = false;
static size_t                s_inbound_rx_received       = 0;
// Written by the event task, read + reported by mqtt_task — the same split as the flags above, and
// std::atomic for the reason stated there. Relaxed ordering: it is a counter, ordering nothing and
// synchronising nothing, and taking a lock on the event task is what this hand-off exists to avoid.
static std::atomic<uint32_t>       s_inbound_dropped{0};
static uint32_t                    s_inbound_dropped_reported = 0;
static std::array<std::string, 31> s_mqtt_strings;
static CirculationSourceStatus  s_circulation_status;
static CirculationPowerTracker s_circulation_tracker;
static SourceTimestampHighWater s_circulation_source_time; // guarded by s_mtx
static_assert(std::is_nothrow_move_assignable<CirculationSourceStatus>::value,
              "circulation status commits must not allocate or throw");
static std::atomic<uint32_t> s_circulation_requested_epoch{1};
static uint32_t              s_circulation_applied_epoch = 0; // guarded by s_mtx
struct CirculationProbeState {
    CirculationSourceTestConfig config;
    uint32_t generation=0;
    bool active=false, subscribed=false, passed=false, retained=false;
    double power_w=0.0;
    CirculationPowerState state=CirculationPowerState::Unknown;
    CirculationTestProofClock   clock;
    std::string error;
};
static CirculationProbeState s_circulation_probe;
static std::atomic<uint32_t> s_circulation_probe_capture_generation{0};
static SemaphoreHandle_t     s_circulation_probe_sem              = nullptr;
static std::string&          s_circulation_subscribed_topic       = s_mqtt_strings[0];
static bool                  s_circulation_subscription_retry     = false; // mqtt_task only
static std::string&          s_circulation_probe_subscribed_topic = s_mqtt_strings[1];
static uint32_t              s_circulation_probe_task_generation  = 0;
static std::string&          s_circulation_binding_topic          = s_mqtt_strings[2];
static std::string&          s_circulation_binding_power_path     = s_mqtt_strings[3];
static std::string&          s_circulation_binding_time_path      = s_mqtt_strings[4];
static bool                  s_circulation_capture_enabled        = false;
static uint32_t s_circulation_runtime_max_age_s = CIRC_SOURCE_MAX_AGE_DEFAULT_S; // guarded by s_mtx
static uint16_t s_circulation_on_tenths_w = 0, s_circulation_off_tenths_w = 0;
static uint32_t s_circulation_confirm_s = 0; // applied policy, guarded by s_mtx

// RAII guard around s_mtx (same idiom as config.cpp / hp_poll.cpp). Replaces the raw take/give pairs
// so a throw on a reader (the broker copy in mqtt_status) can't strand the mutex and wedge every
// later reader/writer at portMAX_DELAY.
namespace {
// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
using Lock = SemGuard;
} // namespace

// Persisted so the pointers handed to esp-mqtt (and reused by the task) stay valid.
static std::string& s_uri                   = s_mqtt_strings[5];
static std::string& s_user                  = s_mqtt_strings[6];
static std::string& s_pass                  = s_mqtt_strings[7];
static std::string& s_node                  = s_mqtt_strings[8];
static std::string& s_board                 = s_mqtt_strings[9];
static std::string& s_base                  = s_mqtt_strings[10];
static std::string& s_prefix                = s_mqtt_strings[11];
static std::string& s_avail                 = s_mqtt_strings[12];
static std::string& s_x10a_avail            = s_mqtt_strings[13];
static std::string& s_x10a                  = s_mqtt_strings[14];
static std::string& s_modbus                = s_mqtt_strings[15];
static std::string& s_retired_forecast      = s_mqtt_strings[16];
static std::string& s_env3                  = s_mqtt_strings[17];
static std::string& s_retired_weather       = s_mqtt_strings[18];
static std::string& s_retired_modbus_status = s_mqtt_strings[19];
static std::string& s_legacy_state          = s_mqtt_strings[20];
static std::string& s_heartbeat             = s_mqtt_strings[21];
static std::string& s_crash                 = s_mqtt_strings[22];
static std::string& s_heater_buh_topic      = s_mqtt_strings[29];
static std::string& s_heater_bsh_topic      = s_mqtt_strings[30];
static std::string& s_announced_profile =
    s_mqtt_strings[23]; // profile we last published discovery for (mqtt_task only)
static std::string& s_discovered_profile =
    s_mqtt_strings[24]; // survives reconnect's reannounce reset
// Store provenance never restores Config or detection. Bit 0 records a real scoped predecessor
// load in this boot; saving a same-boot record cannot claim reboot restoration.
enum : uint32_t {
    RETIRE_LOADED_PREDECESSOR = 0x001,
    RETIRE_BOOTSTRAP_BOUNDARY = 0x002,
    RETIRE_FOREIGN_BOUNDARY   = 0x004,
    RETIRE_LOAD_ERROR         = 0x008,
    RETIRE_INCOMPATIBLE       = 0x010,
    RETIRE_SAVE_ERROR         = 0x020,
    RETIRE_PENDING            = 0x040,
    RETIRE_CURRENT_DURABLE    = 0x080,
    RETIRE_OPERATOR_MIGRATION = 0x100
};
static std::atomic<uint32_t>  s_retirement_evidence{0};
static bool                   s_retirement_store_loaded = false;
static bool                   s_retirement_store_scoped = false;
static MqttRetirementRecord   s_retirement_record, s_retirement_staged;
static int64_t                s_retirement_load_retry_us = 0, s_retirement_save_retry_us = 0;
static uint32_t               s_retirement_log_state           = UINT32_MAX;
static constexpr int64_t      RETIREMENT_STORE_RETRY_US        = 5 * 1000 * 1000;
static std::string&           s_retiring_profile_target        = s_mqtt_strings[25];
static size_t                 s_retiring_profile_row           = 0;
static size_t                 s_retiring_profile_shape         = 0;
static bool                   s_retiring_current_unpublishable = false;
static std::string&           s_current_profile_retired        = s_mqtt_strings[26];
static MqttRetirementIdentity s_retiring_identity;
static MqttRetirementScan     s_retiring_scan;
static bool                   s_retiring_identity_ready    = false;
static constexpr size_t       PROFILE_RETIRE_WORK_BUDGET   = 128;
static bool        s_periodic_discovery_pending = false, s_periodic_discovery_again = false;
static uint8_t     s_periodic_discovery_step = 0;
static void        service_periodic_discovery_retirement();
static void                   request_periodic_discovery_retirement() noexcept;
static uint64_t    s_last_x10a_digest = 0;            // per-topic dedup guards (mqtt_task only):
                                                      // fnv1a64 of the last X10A payload — the old
                                                      // full-string copy cost a permanent ~3 KB block
                                                      // and one copy per cycle (private issue 10)
static MqttPayloadDigest s_last_modbus_digest;
static uint32_t          s_last_x10a_cache_gen   = 0;
static uint32_t          s_last_modbus_cache_gen = 0;
static bool              s_last_modbus_live      = false;
static MqttPayloadDigest s_last_env3_digest;
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
// Stale-identity migration (mqtt_task only) — see retract_legacy_fixed / retract_stale_values below.
static bool         s_legacy_fixed_retracted = false; // heartbeat + crash entities: once per boot
static size_t       s_legacy_fixed_step      = 0;
static std::string& s_stale_values_profile =
    s_mqtt_strings[27]; // value entities: the profile they were
                        // retracted for ("" = not yet). Keyed on the
                        // profile, not a bool, because the row set IS
                        // the profile: a re-detect (POST /detect, or
                        // an ambiguous first fingerprint settling)
                        // brings rows the earlier pass never saw.
static std::string& s_stale_values_pending_profile = s_mqtt_strings[28];
static size_t       s_stale_values_step            = 0;
// Written false by the event task on DISCONNECT, written true + read by the publish task -> atomic.
static std::atomic<bool> s_heartbeat_announced{
    false}; // diagnostic discovery streamed this connection?
static bool         s_mqtt_ever_connected = false;     // event-task-only: first connect vs. a RE-connect
static std::atomic<uint32_t> s_connected_session_epoch{
    0}; // every CONNECT, including same-client reconnect

// Only the two preserved nodes can collide with historical lossy slugs. Before any discovery
// mutation, replay both whole namespaces (including old Modbus discovery). The event task owns
// this fixed receive buffer; the publish task consumes only atomic results and SUBACK evidence.
// Keep the subscriptions after admission so a later conflicting config closes the boundary too.
enum class DiscoveryOwnerState : uint8_t { Pending, Admitted, Blocked, Encoded };
static std::atomic<DiscoveryOwnerState> s_discovery_owner_state{DiscoveryOwnerState::Pending};
static bool s_discovery_owner_required = true; // immutable while the MQTT client is running
static std::array<std::string, 2> s_discovery_owner_filters; // staged before client start
static constexpr uint32_t         DISCOVERY_OWNER_CONFIG_MAX  = 512;
static constexpr uint32_t         DISCOVERY_OWNER_QUIET_MS = 5000, DISCOVERY_OWNER_TOTAL_MS = 30000;
static size_t                s_discovery_owner_received = 0, s_discovery_owner_total = 0;
static bool                       s_discovery_owner_rx_active   = false;
static bool                       s_discovery_owner_uses_inbound_rx = false;
static std::atomic<bool>     s_discovery_owner_fragment_pending{false};
static std::atomic<uint32_t> s_discovery_owner_last_data_ms{0}, s_discovery_owner_started_ms{0};
static std::atomic<uint32_t> s_discovery_owner_configs{0};
static MqttCleanupEvidenceQueue<32> s_discovery_owner_subacks;
static std::atomic<bool>            s_discovery_owner_suback_lost{false};
static uint32_t              s_discovery_owner_session = 0; // remaining scalars are mqtt_task-owned
static std::array<int, 2>    s_discovery_owner_sub_ids{{-1, -1}};
static uint8_t               s_discovery_owner_ack_mask = 0;
static uint32_t              s_discovery_owner_ack_ms   = 0;
static bool                  s_discovery_owner_logged   = false;
static std::atomic<uint32_t> s_discovery_owner_admitted_session{0};
static bool                  s_discovery_owner_skipped =
    false; // mqtt_task only; replay abandoned ledgers after migration

static bool discovery_mutation_allowed() noexcept {
    const auto state = s_discovery_owner_state.load(std::memory_order_acquire);
    return (state == DiscoveryOwnerState::Admitted &&
            s_discovery_owner_admitted_session.load(std::memory_order_acquire) ==
                s_connected_session_epoch.load(std::memory_order_acquire)) ||
           state == DiscoveryOwnerState::Encoded;
}

static bool discovery_topic_guarded(const std::string& topic) noexcept {
    return s_discovery_owner_required && mqtt_discovery_namespace_topic(topic, s_prefix, s_node);
}

static void discovery_owner_block() noexcept {
    s_discovery_owner_state.store(DiscoveryOwnerState::Blocked, std::memory_order_release);
    s_retirement_evidence.fetch_or(RETIRE_OPERATOR_MIGRATION, std::memory_order_release);
}

static void capture_discovery_owner_frame(esp_mqtt_event_handle_t e) noexcept {
    if (!s_discovery_owner_required || !e || (e->client && e->client != s_client)) return;
    if (e->current_data_offset == 0) {
        if (s_discovery_owner_rx_active) discovery_owner_block(); // interrupted document
        s_discovery_owner_rx_active   = false;
        s_discovery_owner_uses_inbound_rx = false;
        s_discovery_owner_fragment_pending.store(false, std::memory_order_release);
        if (!e->topic || e->topic_len <= 0 ||
            !mqtt_discovery_namespace_topic(
                std::string_view(e->topic, static_cast<size_t>(e->topic_len)), s_prefix, s_node))
            return;
        if (e->total_data_len == 0 && e->data_len == 0) return; // a tombstone holds no config
        s_discovery_owner_last_data_ms.store(static_cast<uint32_t>(esp_timer_get_time() / 1000),
                                             std::memory_order_release);
        if (e->total_data_len <= 0 ||
            static_cast<size_t>(e->total_data_len) > DISCOVERY_OWNER_PAYLOAD_MAX) {
            discovery_owner_block();
            return;
        }
        s_discovery_owner_total     = static_cast<size_t>(e->total_data_len);
        s_discovery_owner_received  = 0;
        s_discovery_owner_rx_active = true;
        // Payloads <= CIRCULATION_PAYLOAD_MAX reassemble in s_event_rx.circulation.payload so a
        // discovery packet that also matches an explicit input topic shares one active union
        // member; larger discovery payloads (> 1024 B) are always rejected by
        // capture_circulation_frame.
        s_discovery_owner_uses_inbound_rx = s_discovery_owner_total <= CIRCULATION_PAYLOAD_MAX;
        if (s_discovery_owner_uses_inbound_rx) {
            if (s_event_rx_discovery_active) {
                new (&s_event_rx.circulation) CirculationMqttFrame(circulation_frame_scratch());
                s_event_rx_discovery_active = false;
            }
        } else if (!s_event_rx_discovery_active) {
            new (&s_event_rx.discovery) char[DISCOVERY_OWNER_PAYLOAD_MAX];
            s_event_rx_discovery_active = true;
        }
        s_discovery_owner_fragment_pending.store(true, std::memory_order_release);
        if (s_discovery_owner_state.load(std::memory_order_acquire) ==
                DiscoveryOwnerState::Pending &&
            s_discovery_owner_configs.fetch_add(1, std::memory_order_relaxed) >=
                DISCOVERY_OWNER_CONFIG_MAX)
            discovery_owner_block();
    }
    if (!s_discovery_owner_rx_active) return;
    if (e->current_data_offset < 0 || e->data_len <= 0 || !e->data ||
        static_cast<size_t>(e->current_data_offset) != s_discovery_owner_received ||
        e->total_data_len != static_cast<int>(s_discovery_owner_total) ||
        static_cast<size_t>(e->data_len) > s_discovery_owner_total - s_discovery_owner_received ||
        (s_discovery_owner_uses_inbound_rx == s_event_rx_discovery_active)) {
        discovery_owner_block();
        s_discovery_owner_rx_active   = false;
        s_discovery_owner_uses_inbound_rx = false;
        s_discovery_owner_fragment_pending.store(false, std::memory_order_release);
        return;
    }
    char* const payload_buf =
        s_discovery_owner_uses_inbound_rx ? s_event_rx.circulation.payload : s_event_rx.discovery;
    std::memcpy(payload_buf + s_discovery_owner_received, e->data,
                static_cast<size_t>(e->data_len));
    s_discovery_owner_received += static_cast<size_t>(e->data_len);
    s_discovery_owner_last_data_ms.store(static_cast<uint32_t>(esp_timer_get_time() / 1000),
                                         std::memory_order_release);
    if (s_discovery_owner_received == s_discovery_owner_total) {
        if (!mqtt_discovery_payload_owned(payload_buf, s_discovery_owner_total, s_base, s_node,
                                          s_board))
            discovery_owner_block();
        s_discovery_owner_rx_active   = false;
        s_discovery_owner_uses_inbound_rx = false;
        s_discovery_owner_fragment_pending.store(false, std::memory_order_release);
    }
}

static void service_discovery_owner_guard() {
    if (!s_connected.load(std::memory_order_acquire) || !s_discovery_owner_required) return;
    const uint32_t session = s_connected_session_epoch.load(std::memory_order_acquire);
    if (session != s_discovery_owner_session) {
        s_discovery_owner_session  = session;
        s_discovery_owner_sub_ids  = {{-1, -1}};
        s_discovery_owner_ack_mask = 0;
        s_discovery_owner_ack_ms   = 0;
        s_discovery_owner_logged   = false;
        auto admitted              = DiscoveryOwnerState::Admitted;
        s_discovery_owner_state.compare_exchange_strong(admitted, DiscoveryOwnerState::Pending,
                                                        std::memory_order_acq_rel);
        MqttCleanupDeliveryEvidence stale;
        while (s_discovery_owner_subacks.pop(stale)) {}
    }
    const uint32_t now   = static_cast<uint32_t>(esp_timer_get_time() / 1000);
    auto           state = s_discovery_owner_state.load(std::memory_order_acquire);
    if (state == DiscoveryOwnerState::Pending) {
        for (size_t i = 0; i < s_discovery_owner_sub_ids.size(); ++i)
            if (s_discovery_owner_sub_ids[i] < 0)
                s_discovery_owner_sub_ids[i] =
                    esp_mqtt_client_subscribe(s_client, s_discovery_owner_filters[i].c_str(), 1);
        // Drain after recording IDs: the callback can run synchronously before subscribe returns.
        MqttCleanupDeliveryEvidence ack;
        while (s_discovery_owner_subacks.pop(ack)) {
            if (ack.client_epoch != session) continue;
            for (size_t i = 0; i < s_discovery_owner_sub_ids.size(); ++i)
                if (s_discovery_owner_sub_ids[i] >= 0 &&
                    ack.msg_id == s_discovery_owner_sub_ids[i]) {
                    if (ack.outcome != MqttCleanupDeliveryOutcome::Published) {
                        discovery_owner_block();
                        continue;
                    }
                    const uint8_t bit = static_cast<uint8_t>(1U << i);
                    if (!(s_discovery_owner_ack_mask & bit)) s_discovery_owner_ack_ms = now;
                    s_discovery_owner_ack_mask |= bit;
                }
        }
        if (s_discovery_owner_suback_lost.exchange(false, std::memory_order_acq_rel))
            discovery_owner_block();
        if (now - s_discovery_owner_started_ms.load(std::memory_order_acquire) >=
            DISCOVERY_OWNER_TOTAL_MS)
            discovery_owner_block();
        const uint32_t last = s_discovery_owner_last_data_ms.load(std::memory_order_acquire);
        if (s_discovery_owner_ack_mask == 3 &&
            now - s_discovery_owner_ack_ms >= DISCOVERY_OWNER_QUIET_MS &&
            now - last >= DISCOVERY_OWNER_QUIET_MS &&
            !s_discovery_owner_fragment_pending.load(std::memory_order_acquire)) {
            auto pending = DiscoveryOwnerState::Pending;
            s_discovery_owner_admitted_session.store(session, std::memory_order_release);
            s_discovery_owner_state.compare_exchange_strong(pending, DiscoveryOwnerState::Admitted,
                                                            std::memory_order_acq_rel);
        }
    } else {
        MqttCleanupDeliveryEvidence ignored;
        while (s_discovery_owner_subacks.pop(ignored)) {}
    }
    state = s_discovery_owner_state.load(std::memory_order_acquire);
    if (state == DiscoveryOwnerState::Blocked && !s_discovery_owner_logged) {
        s_discovery_owner_logged = true;
        diag_printf("mqtt: discovery namespace ownership unproven; operator migration required; "
                    "telemetry continues\n");
    }
}
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
// (legacy-380). Both are written only on the publish task, but they are read by the /status builder
// on the httpd task, so they are atomic rather than plain like pub_ok/pub_fail above. `skipped` is
// bumped from inside the OOM catch handler, where an atomic add is the only kind of bookkeeping
// that is guaranteed not to throw a second time.
static std::atomic<uint32_t> s_mqtt_skipped{0};
static std::atomic<uint32_t> s_mqtt_quiesced{0};
static std::atomic<bool> s_x10a_publish_required{false};
static std::atomic<bool> s_x10a_publish_proven{false};
static std::atomic<bool> s_publish_network_quiesced{true};
static std::atomic<bool>     s_transport_connecting{false};
inline constexpr uint32_t    TRANSPORT_PAUSE_OWNER_MASK      = 0x3fffffffu;
inline constexpr uint32_t    TRANSPORT_PAUSE_WITHDRAW_STAGED = 0x40000000u;
inline constexpr uint32_t    TRANSPORT_PAUSE_WITHDRAW_ARMED  = 0x80000000u;
// Single atomic word packing owner count + staged/armed OTA availability withdrawal intent so
// overlapping pause/resume transitions cannot clobber each other across preemption.
static std::atomic<uint32_t> s_transport_pause_state{0};
static std::atomic<bool>     s_transport_paused{false};
static std::atomic<bool>     s_client_running{false};
static_assert(std::atomic<bool>::is_always_lock_free && std::atomic<uint32_t>::is_always_lock_free,
              "MQTT network quiesce acknowledgement must remain allocation- and lock-free");

static bool transport_pause_requested() noexcept {
    return (s_transport_pause_state.load(std::memory_order_acquire) & TRANSPORT_PAUSE_OWNER_MASK) !=
           0;
}

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

static bool competing_tls_active() { return ota_download_active(); }

static bool mqtt_transport_tls_configured() {
    // mqtt_task owns s_uri after startup; no Config copy or status mutex is needed on this hot path.
    return s_uri.rfind("mqtts://", 0) == 0 || s_uri.rfind("wss://", 0) == 0;
}

constexpr size_t kMqttTlsResumeMinFree = 56 * 1024;
constexpr size_t kMqttTlsResumeMinLargest = 24 * 1024;
constexpr unsigned kMqttTlsResumeStableSamples = 4;
constexpr unsigned kMqttResumeBackoffMaxS = 60;

// Task-owned scalar state for restarting esp-mqtt after OTA released the constrained
// network heap. Keep the transport work itself out of mqtt_task: the size-optimised ESP-IDF 6.0.2
// build otherwise folds single-use helpers into that already allocation-rich function, consuming
// the stack margin restored after the earlier mqtt_pub overflow. This state is only 16 bytes and
// retains no payload, Config or TLS allocation — in particular it must not recreate dev.13's
// boot-long buffers or bypass the heap gates below.
struct MqttTransportResumeState {
    unsigned stable_samples = 0;
    unsigned wait_s = 0;
    unsigned backoff_s = 1;
    bool heap_wait_logged = false;
};
static_assert(sizeof(MqttTransportResumeState) == 16,
              "MQTT resume state must remain scalar-only and stack-bounded");

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
// This is a byte cap, not a pre-allocation. The source queue contributes one small tombstone; the
// remaining headroom covers the four bounded retained probes, availability and the bounded crash
// report without permitting an unreachable broker to grow esp-mqtt's QoS outbox indefinitely.
static constexpr uint64_t MQTT_OUTBOX_LIMIT_BYTES = 8 * 1024;

// Non-allocating under the lock: `err` is always a string literal, stored as a bare pointer. Runs on
// esp-mqtt's event task with no exception guard, so an allocating std::string assignment that threw
// would abort() — and, under a raw take/give, strand the mutex too. Both are gone now.
static void set_status(bool connected, const char* err) {
    Lock lk(s_mtx);
    s_status.connected = connected;
    if (err) s_error = err;
    else if (connected) s_error = "";
}

// esp_mqtt_client_stop() joins the producer task and then deletes every queued item without a
// DELETED event. Only after that join may mqtt_task discard stale ring evidence and release the
// scheduler's one in-flight id. The active step itself remains selected and is retried after the
// same client handle reconnects.
static void source_cleanup_outbox_cleared_after_transport_stop() noexcept {
    s_source_cleanup.outbox_cleared_after_transport_stop();
    s_retirement_delivery.outbox_cleared_after_transport_stop();
    s_source_cleanup_evidence.clear_after_producer_stop();
    s_source_cleanup_evidence_lost.store(false, std::memory_order_release);
    s_connected_client_epoch.store(0, std::memory_order_release);
}

static inline void release_string_capacity(std::string& s) {
    if (s.empty() && s.capacity() > 0) std::string{}.swap(s);
}

static __attribute__((noinline)) void release_paused_state_caches() {
    s_last_modbus_digest.clear();
    s_last_env3_digest.clear();
    s_announced_profile.clear();
    release_string_capacity(s_announced_profile);
}

// The clean stop below discards the installation LWT, and an OTA install can restart the board
// before this client reconnects (logic/mqtt_publish_gate.hpp). Publish the retained `offline` on
// the same ordered stream first: esp-mqtt writes a connected publish synchronously, so the broker
// stores it before it reads the DISCONNECT. No std::string is built; esp-mqtt makes two small
// outbox allocations (freed by the stop) plus the TLS record any write needs. A failed write aborts
// the session without DISCONNECT, so the broker fires the LWT instead; a refused publish only
// leaves the previous, unwithdrawn behaviour.
static __attribute__((noinline)) void mqtt_ota_withdraw_online() {
    constexpr uint32_t withdraw_bits =
        TRANSPORT_PAUSE_WITHDRAW_ARMED | TRANSPORT_PAUSE_WITHDRAW_STAGED;
    const bool ota_pause =
        (s_transport_pause_state.fetch_and(~withdraw_bits, std::memory_order_acq_rel) &
         withdraw_bits) != 0;
    if (!mqtt_pause_withdraws_online(ota_pause, s_client != nullptr,
                                     s_connected.load(std::memory_order_acquire)))
        return;
    // esp-mqtt also accepts a QoS-1 publish that a racing disconnect left queued; the stop then
    // deletes it, but that dropped session already fired the LWT.
    if (mqtt_publish(s_avail, "offline", 0, 1, 1))
        diag_printf("mqtt: availability offline accepted before the OTA transport stop\n");
    else
        diag_printf("mqtt: availability offline refused before the OTA transport stop\n");
}

// Stop the complete esp-mqtt transport before acknowledging a competing OTA TLS owner.
// esp-mqtt owns a separate task which can otherwise keep allocating record/keepalive/subscription
// state after mqtt_task stopped publishing. This helper is deliberately scalar-only and is called
// before the held path publishes s_publish_network_quiesced=true.
static __attribute__((noinline)) void mqtt_transport_pause_if_requested() {
    if (!transport_pause_requested() || !s_client_running.load(std::memory_order_acquire) ||
        !s_client)
        return;

    s_publish_network_quiesced.store(false, std::memory_order_release);
    mqtt_ota_withdraw_online();
    const esp_err_t stop_rc = esp_mqtt_client_stop(s_client);
    if (stop_rc == ESP_OK) {
        source_cleanup_outbox_cleared_after_transport_stop();
        s_client_running.store(false, std::memory_order_release);
        s_transport_connecting.store(false, std::memory_order_release);
        s_transport_paused.store(true, std::memory_order_release);
        s_connected.store(false, std::memory_order_release);
        set_status(false, "paused for network heap");
        release_paused_state_caches();
        diag_printf("mqtt: transport paused for network heap\n");
    } else {
        diag_printf("mqtt: transport pause failed (%s)\n", esp_err_to_name(stop_rc));
    }
}

// A full fixed evidence ring means mqtt_task cannot know whether the one cleanup PUBACK or DELETED
// event was lost. Stop/join the producer and clear its outbox before retrying the same idempotent
// step; this preserves the one-cleanup-item bound instead of guessing and queuing a duplicate.
static __attribute__((noinline)) bool mqtt_cleanup_evidence_recovery_step(int delay_s) {
    if (!s_source_cleanup_evidence_lost.load(std::memory_order_acquire)) return false;
    if (!s_client_running.load(std::memory_order_acquire) || !s_client) {
        source_cleanup_outbox_cleared_after_transport_stop();
        return false;
    }

    s_publish_network_quiesced.store(false, std::memory_order_release);
    const esp_err_t stop_rc = esp_mqtt_client_stop(s_client);
    if (stop_rc == ESP_OK) {
        source_cleanup_outbox_cleared_after_transport_stop();
        s_client_running.store(false, std::memory_order_release);
        s_transport_connecting.store(false, std::memory_order_release);
        s_transport_paused.store(true, std::memory_order_release);
        s_connected.store(false, std::memory_order_release);
        set_status(false, "restarting after MQTT cleanup evidence loss");
        release_paused_state_caches();
        diag_printf("mqtt: cleanup evidence lost — transport stopped for bounded retry\n");
    } else {
        diag_printf("mqtt: cleanup evidence recovery stop failed (%s)\n", esp_err_to_name(stop_rc));
    }
    s_publish_network_quiesced.store(true, std::memory_order_release);
    vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
    return true;
}

// Return true after this cycle deliberately stood aside. The caller immediately continues the
// task loop, before constructing MqttPublishActivity, Config, snapshots or payload strings.
static __attribute__((noinline)) bool
mqtt_network_hold_step(OtaQuiesceState& quiesce, bool ota_busy, bool& hold_logged, int delay_s) {
    if (!ota_quiesce_step(quiesce, ota_busy)) return false;

    s_mqtt_quiesced.fetch_add(1, std::memory_order_relaxed);
    if (!hold_logged) {                                // once per operation; the ring is small
        diag_printf("mqtt: holding off publishes during OTA\n");
        hold_logged = true;
    }
    mqtt_transport_pause_if_requested();
    s_publish_network_quiesced.store(true, std::memory_order_release);
    vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
    return true;
}

// Return false after a bounded wait/failure delay so mqtt_task can continue its loop without
// allocating or publishing. A TLS broker must still pass the exact four-sample 56/24-KiB gate;
// plaintext resumes immediately, and every direct start failure retains the existing capped
// exponential backoff instead of churning the fragmented heap once per second.
static __attribute__((noinline)) bool mqtt_transport_resume_step(MqttTransportResumeState& state,
                                                                 int delay_s) {
    if (!s_transport_paused.load(std::memory_order_acquire) || transport_pause_requested() ||
        !s_client)
        return true;

    if (state.wait_s > 0) {
        --state.wait_s;
        vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
        return false;
    }
    if (mqtt_transport_tls_configured()) {
        const size_t free_internal = heap_caps_get_free_size(MALLOC_CAP_8BIT |
                                                             MALLOC_CAP_INTERNAL);
        const size_t largest = heap_largest_internal_block();
        if (free_internal < kMqttTlsResumeMinFree ||
            largest < kMqttTlsResumeMinLargest) {
            state.stable_samples = 0;
            if (!state.heap_wait_logged) {
                diag_printf("mqtt: waiting to resume TLS transport (free=%u B largest=%u B)\n",
                            static_cast<unsigned>(free_internal),
                            static_cast<unsigned>(largest));
                state.heap_wait_logged = true;
            }
            set_status(false, "waiting for network heap");
            vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
            return false;
        }
        if (++state.stable_samples < kMqttTlsResumeStableSamples) {
            vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
            return false;
        }
    }
    // Reset the status BEFORE the start, as in start_current_client(): after it,
    // MQTT_EVENT_CONNECTED can arrive at any moment, and a later "disconnected" write would stick
    // while the client is in fact connected (/status and the delivery gate then wait for a
    // reconnect that never comes).
    set_status(false, "");
    const esp_err_t start_rc = start_client_transport();
    if (start_rc != ESP_OK) {
        set_status(false, "transport resume failed");
        diag_printf("mqtt: transport resume failed (%s) — retry in %u s\n",
                    esp_err_to_name(start_rc), state.backoff_s);
        state.wait_s = state.backoff_s;
        state.backoff_s = state.backoff_s < kMqttResumeBackoffMaxS / 2
                        ? state.backoff_s * 2
                        : kMqttResumeBackoffMaxS;
        state.stable_samples = 0;
        vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
        return false;
    }
    s_client_running.store(true, std::memory_order_release);
    s_transport_paused.store(false, std::memory_order_release);
    state = {};
    diag_printf("mqtt: transport resumed after network heap operation\n");
    return true;
}

// Full eFuse MAC identifies this hardware independently of the installation's base topic.
// A failed read must not fabricate an all-zero client id and evict a different board.
static std::string board_id() {
    uint8_t         m[6];
    const esp_err_t e = esp_read_mac(m, ESP_MAC_WIFI_STA);
    if (e != ESP_OK) {
        diag_printf("mqtt: failed to read board MAC (%s)\n", esp_err_to_name(e));
        return {};
    }
    return ha_board_id(m, sizeof(m));
}

// Every outbound publish funnels through here so the heartbeat's mqtt_count/mqtt_fails reflect
// every discovery/state/heartbeat/availability message, not just one of them. esp_mqtt_client_publish() returns the message id (>=0) on success
// or -1 if it couldn't even be queued (e.g. dropped mid-disconnect).
static int mqtt_publish_id(const std::string& topic, const char* payload, int len, int qos,
                           int retain) {
    if (discovery_topic_guarded(topic) && !discovery_mutation_allowed()) return -1;
    const int rc = esp_mqtt_client_publish(s_client, topic.c_str(), payload, len, qos, retain);
    if (rc >= 0) s_mqtt_pub_ok++; else s_mqtt_pub_fail++;
    // Feed the watchdog per completed publish — mirrors poll_once's per-register reset. A single
    // (re)connect cycle bursts ~30 publishes (discovery + crash + state + heartbeat), and each
    // esp_mqtt_client_publish() can block up to the client's network timeout; without this a
    // slow-but-alive broker/link could push one burst past the 20 s budget and reboot a task that
    // is still making progress. This runs only in mqtt_pub (the sole caller path), which is
    // subscribed, so a genuinely wedged write still trips the timeout — a progressing one never does.
    esp_task_wdt_reset();
    return rc;
}

static bool mqtt_publish(const std::string& topic, const char* payload, int len, int qos,
                         int retain) {
    return mqtt_publish_id(topic, payload, len, qos, retain) >= 0;
}

// Source cleanup needs an unambiguous queue result. esp_mqtt_client_publish() can enqueue QoS 1,
// fail its synchronous socket write and still return -1; retrying that apparent failure would leave
// two copies in the outbox. The enqueue API either returns the tracked id or proves that no item
// was admitted, while esp-mqtt's own task performs the network write.
static int mqtt_enqueue_id(const std::string& topic, const char* payload, int len, int qos,
                           int retain) {
    const int rc =
        esp_mqtt_client_enqueue(s_client, topic.c_str(), payload, len, qos, retain, false);
    if (rc >= 0)
        s_mqtt_pub_ok++;
    else
        s_mqtt_pub_fail++;
    esp_task_wdt_reset();
    return rc;
}

// Source cleanup and discovery/probe retirement share one global QoS-1 admission bound. Keep the
// returned id without allocating and drain again for a PUBACK that raced the enqueue return.
static bool retire_exact_topic(MqttRetirementOwner owner, const std::string& topic) {
    service_source_cleanup_evidence();
    if (s_retirement_delivery.take_confirmed(owner)) return true;
    if (discovery_topic_guarded(topic) && !discovery_mutation_allowed()) {
        // A blocked namespace is a migration boundary, not an acknowledged tombstone. Retire
        // cursors may abandon its configs so independent raw-base telemetry keeps progressing.
        const bool blocked =
            s_discovery_owner_state.load(std::memory_order_acquire) == DiscoveryOwnerState::Blocked;
        if (blocked) s_retirement_delivery.abandon_discovery_for_operator_migration(owner);
        const bool skip = blocked && !s_retirement_delivery.busy();
        s_discovery_owner_skipped |= skip;
        return skip;
    }
    const uint32_t epoch = s_connected_client_epoch.load(std::memory_order_acquire);
    // A newly requested source withdrawal takes the next vacant slot rather than waiting behind
    // hundreds of legacy aliases. An existing unconfirmed/expired retirement still owns its exact
    // item until PUBACK; after confirmation the cursor can yield without losing any topic.
    const bool source_pending = s_source_cleanup.suppress(MqttCleanupSource::Weather) ||
                                s_source_cleanup.suppress(MqttCleanupSource::Modbus) ||
                                s_source_cleanup.suppress(MqttCleanupSource::Env3);
    if (!s_connected.load(std::memory_order_acquire) || s_source_cleanup.in_flight() ||
        (source_pending && !s_retirement_delivery.busy()) ||
        !s_retirement_delivery.can_queue(owner, epoch))
        return false;
    const int id = mqtt_enqueue_id(topic, "", 0, 1, 1);
    if (id >= 0) {
        s_retirement_delivery.queued(owner, epoch, id);
        service_source_cleanup_evidence();
    }
    return s_retirement_delivery.take_confirmed(owner);
}

struct RetainedProbeProgress {
    bool subscribe_retry  = false;
    bool delete_confirmed = false;
};
static std::array<RetainedProbeProgress, 4> s_retained_probe_progress;

static size_t retained_probe_index(std::atomic<bool>& seen) noexcept {
    if (&seen == &s_legacy_state_seen) return 0;
    if (&seen == &s_retired_modbus_status_seen) return 1;
    if (&seen == &s_retired_weather_seen) return 2;
    return 3;
}

static MqttRetirementOwner retained_probe_owner(size_t index) noexcept {
    return static_cast<MqttRetirementOwner>(static_cast<uint8_t>(MqttRetirementOwner::LegacyProbe) +
                                            index);
}

// Start and service one exact-topic retained cleanup probe. Both functions run only on mqtt_task;
// the esp-mqtt event task communicates the matching retained DATA event through `seen`. Keeping the
// broker write here preserves mqtt_publish()'s single-task watchdog/counter contract.
static void start_retained_cleanup_probe(const std::string& topic, std::atomic<bool>& seen,
                                         bool& active, int64_t& deadline_us,
                                         const char* diagnostic_name) {
    auto& progress = s_retained_probe_progress[retained_probe_index(seen)];
    if (!active && !progress.subscribe_retry) {
        seen                      = false;
        progress.delete_confirmed = false;
    }
    const int sub_id = esp_mqtt_client_subscribe(s_client, topic.c_str(), 0);
    progress.subscribe_retry = sub_id < 0;
    if (sub_id >= 0) {
        active      = true;
        deadline_us = esp_timer_get_time() + RETIRED_TOPIC_PROBE_US;
    }
    if (sub_id < 0)
        diag_printf("mqtt: %s cleanup probe could not be queued\n", diagnostic_name);
}

static void service_retained_cleanup_probe(const std::string& topic, std::atomic<bool>& seen,
                                           bool& active, int64_t& deadline_us) {
    const size_t index    = retained_probe_index(seen);
    auto&        progress = s_retained_probe_progress[index];
    if (progress.subscribe_retry) {
        if (esp_mqtt_client_subscribe(s_client, topic.c_str(), 0) < 0) return;
        progress.subscribe_retry = false;
        active                   = true;
        deadline_us              = esp_timer_get_time() + RETIRED_TOPIC_PROBE_US;
    }
    if (!active) return;
    const bool retained_seen = seen.load(std::memory_order_acquire);
    const bool probe_done = esp_timer_get_time() >= deadline_us;
    if (retained_seen && !progress.delete_confirmed) {
        if (!retire_exact_topic(retained_probe_owner(index), topic)) return;
        progress.delete_confirmed = true;
    }
    if (retained_seen || probe_done) {
        if (esp_mqtt_client_unsubscribe(s_client, topic.c_str()) < 0) return;
        active = false;
        seen                      = false;
        progress.delete_confirmed = false;
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
        const def::HomeHubReg* reg = def::homehub_definition(cache[i].modbus_definition);
        if (reg && reg->offset != cache[i].off) reg = nullptr;
        if (!reg) continue;   // fail closed: an untyped field must not reach a typed MQTT contract
        out.push_back({"modbus", object_id(reg->label), cache[i].value,
                       def::homehub_is_text(*reg) ? PublishedKind::Text : PublishedKind::Number});
    }
    return out;
}

[[gnu::noinline]] static void build_ha_config_topic(std::string& out, const char* component,
                                                    const char* group, const char* key) {
    out.clear();
    out.reserve(s_prefix.size() + std::strlen(component) + s_node.size() +
                (group ? std::strlen(group) + 1 : 0) + std::strlen(key) + 10);
    out += s_prefix;
    out += '/';
    out += component;
    out += '/';
    out += s_node;
    out += '/';
    if (group) {
        out += group;
        out += '_';
    }
    out += key;
    out += "/config";
}

// Frozen obsolete board-diagnostic entities under the CURRENT installation namespace only.
// A short-MAC-era topic cannot prove which physical board owns it; operator migration handles
// those ambiguous namespaces rather than automatically deleting another installation's entities.
static bool retract_legacy_fixed() {
    constexpr size_t count = RETIRED_HEARTBEAT_SENSOR_COUNT + RETIRED_CRASH_SENSOR_COUNT;
    std::string      topic;
    for (size_t budget = 0; budget < 8 && s_legacy_fixed_step < count; ++budget) {
        const size_t i         = s_legacy_fixed_step;
        const char*  component = nullptr;
        const char*  obj_id    = nullptr;
        if (i < RETIRED_HEARTBEAT_SENSOR_COUNT) {
            const auto& sensor = RETIRED_HEARTBEAT_SENSORS[i];
            component          = sensor.component;
            obj_id             = sensor.object_id;
        } else {
            const auto& sensor = RETIRED_CRASH_SENSORS[i - RETIRED_HEARTBEAT_SENSOR_COUNT];
            component          = sensor.component;
            obj_id             = sensor.object_id;
        }
        build_ha_config_topic(topic, component, nullptr, obj_id);
        if (!retire_exact_topic(MqttRetirementOwner::LegacyFixed, topic)) return false;
        ++s_legacy_fixed_step;
    }
    if (s_legacy_fixed_step != count) return false;
    s_legacy_fixed_retracted = true;
    return true;
}

// Frozen ungrouped and pre-override label configs in this installation namespace. Each exact
// tombstone advances its bounded cursor only after PUBACK; current grouped identities are kept.
// Ambiguous board/slug predecessors require operator migration; recorder history is not guaranteed.
[[gnu::noinline]] static bool build_stale_topic(std::string& topic, size_t shape,
                                                const ValueDef& d) {
    const std::string obj = object_id(d.label);
    if (obj.empty()) return false;
    const std::string key = shape == 2 ? row_object_id(d) : obj;
    build_ha_config_topic(topic,
                          shape == 2 ? ha_component(d)
                                     : (shape == 1 || shape == 4 ? "binary_sensor" : "sensor"),
                          nullptr, key.c_str());
    return true;
}

static bool retract_stale_values(const std::string& profile_id) {
    if (s_stale_values_pending_profile.empty()) {
        s_stale_values_pending_profile = profile_id; // prepare before any SDK effect
        s_stale_values_step            = 0;
    }
    const auto       prof = def::resolved(def::lookup(s_stale_values_pending_profile.c_str()));
    constexpr size_t shapes =
        5; // current-label ungrouped sensor/binary + old-label grouped/sensor/binary
    constexpr size_t nodes  = 1; // only the current installation namespace is owned
    const size_t     count  = prof.count() * shapes * nodes;
    size_t           budget = 0;
    std::string      topic;
    while (budget < 8 && s_stale_values_step < count) {
        const size_t   shape = s_stale_values_step % shapes;
        const size_t   entry = s_stale_values_step / shapes;
        const ValueDef raw   = prof[entry % prof.count()];
        const ValueDef d     = shape < 2 ? logic::adjudicated(raw, prof.profile_id) : raw;
        const bool     relabeled =
            !logic::label_str_eq(raw.label, logic::adjudicated(raw, prof.profile_id).label);
        if (!conv_publishable(d.conv) || (shape >= 2 && !relabeled) ||
            ((shape == 1 || shape == 4) && !conv_is_binary(d.conv)) ||
            !build_stale_topic(topic, shape, d)) {
            ++s_stale_values_step;
            continue;
        }
        if (!retire_exact_topic(MqttRetirementOwner::StaleValues, topic)) return false;
        ++s_stale_values_step;
        ++budget;
    }
    if (s_stale_values_step != count) return false;
    s_stale_values_profile.swap(s_stale_values_pending_profile);
    s_stale_values_pending_profile.clear();
    return s_stale_values_profile == profile_id;
}

static void retirement_evidence_update(uint32_t clear, uint32_t set) noexcept {
    uint32_t before = s_retirement_evidence.load(std::memory_order_relaxed);
    // The event task can now raise the namespace-migration bit while mqtt_task updates journal
    // provenance. A load/store pair would lose that independent observed boundary.
    while (!s_retirement_evidence.compare_exchange_weak(
        before, (before & ~clear) | set, std::memory_order_release, std::memory_order_relaxed)) {}
}

static void retirement_store_note(uint32_t state, const char* message) noexcept {
    if (state == s_retirement_log_state) return;
    s_retirement_log_state = state;
    diag_printf("mqtt: retirement metadata %s\n", message);
}

// Called only inside mqtt_task's allocation boundary. A failed or incompatible load is read-only
// and retryable; a foreign namespace is an explicit operator migration, never deletion authority.
static bool load_retirement_provenance() {
    if (s_retirement_store_loaded) return true;
    const int64_t now = esp_timer_get_time();
    if (now < s_retirement_load_retry_us) return false;
    const auto loaded = mqtt_retirement_store_load(s_retirement_staged);
    if (loaded == MqttRetirementStoreLoad::Error ||
        loaded == MqttRetirementStoreLoad::Incompatible) {
        const uint32_t error =
            loaded == MqttRetirementStoreLoad::Error ? RETIRE_LOAD_ERROR : RETIRE_INCOMPATIBLE;
        retirement_evidence_update(RETIRE_LOAD_ERROR | RETIRE_INCOMPATIBLE | RETIRE_CURRENT_DURABLE,
                                   error | RETIRE_PENDING);
        retirement_store_note(error, loaded == MqttRetirementStoreLoad::Error
                                         ? "read failed; discovery deferred"
                                         : "incompatible; owner repair required");
        s_retirement_load_retry_us = now + RETIREMENT_STORE_RETRY_US;
        return false;
    }
    uint32_t    evidence = 0;
    bool        scoped   = false;
    std::string predecessor;
    if (loaded == MqttRetirementStoreLoad::Ready) {
        scoped = s_base == s_retirement_staged.base && s_board == s_retirement_staged.board_id;
        if (!scoped)
            evidence = RETIRE_FOREIGN_BOUNDARY | RETIRE_OPERATOR_MIGRATION;
        else if (!s_retirement_staged.profile_id[0])
            evidence = RETIRE_BOOTSTRAP_BOUNDARY | RETIRE_OPERATOR_MIGRATION;
        else if (!def::has_profile(s_retirement_staged.profile_id)) {
            retirement_evidence_update(RETIRE_LOAD_ERROR | RETIRE_CURRENT_DURABLE,
                                       RETIRE_INCOMPATIBLE | RETIRE_PENDING);
            retirement_store_note(RETIRE_INCOMPATIBLE,
                                  "unknown predecessor profile; owner repair required");
            s_retirement_load_retry_us = now + RETIREMENT_STORE_RETRY_US;
            return false;
        } else {
            predecessor =
                s_retirement_staged.profile_id; // stage before committing loaded ownership
            evidence = RETIRE_LOADED_PREDECESSOR;
        }
    } else
        evidence = RETIRE_BOOTSTRAP_BOUNDARY | RETIRE_OPERATOR_MIGRATION;
    s_discovered_profile.swap(predecessor);
    if (scoped) s_retirement_record = s_retirement_staged;
    s_retirement_store_scoped = scoped;
    s_retirement_store_loaded = true;
    retirement_evidence_update(RETIRE_LOAD_ERROR | RETIRE_INCOMPATIBLE, evidence);
    retirement_store_note(evidence,
                          evidence & RETIRE_FOREIGN_BOUNDARY
                              ? "foreign owner boundary; only the current namespace may migrate"
                          : evidence & RETIRE_BOOTSTRAP_BOUNDARY
                              ? "bootstrap boundary; unknown older profiles need operator migration"
                              : "scoped predecessor loaded");
    return true;
}

// All predecessor deletions must be ACK-complete before calling this: even a rejected NVS commit
// can leave Q written through. A reboot may then read Q, so it must never need forgotten P deletes.
static bool save_retirement_provenance(const std::string& profile_id) noexcept {
    if (s_retirement_store_scoped && profile_id == s_retirement_record.profile_id) {
        retirement_evidence_update(RETIRE_SAVE_ERROR | RETIRE_PENDING, RETIRE_CURRENT_DURABLE);
        return true;
    }
    const int64_t now = esp_timer_get_time();
    if (now < s_retirement_save_retry_us) return false;
    if (!mqtt_retirement_record_make(s_retirement_staged, s_base, s_board, profile_id) ||
        !mqtt_retirement_store_save(s_retirement_staged)) {
        retirement_evidence_update(RETIRE_CURRENT_DURABLE, RETIRE_SAVE_ERROR | RETIRE_PENDING);
        retirement_store_note(RETIRE_SAVE_ERROR, "save failed; discovery deferred");
        s_retirement_save_retry_us = now + RETIREMENT_STORE_RETRY_US;
        return false;
    }
    s_retirement_record        = s_retirement_staged;
    s_retirement_store_scoped  = true;
    s_retirement_save_retry_us = 0;
    retirement_evidence_update(RETIRE_SAVE_ERROR | RETIRE_PENDING, RETIRE_CURRENT_DURABLE);
    retirement_store_note(RETIRE_CURRENT_DURABLE, "current profile durable before discovery");
    return true;
}

// The remembered prior profile is independent of reconnect reannouncement. Enumerate only its
// current grouped configs/companions missing from the replacement, then current quarantined rows;
// never delete another base/node or a wildcard. No vector of profiles, rows or topics is built.
static void invalidate_profile_announcement() noexcept { s_announced_profile.clear(); }

static bool retract_profile_cutover(const std::string& profile_id) {
    if (s_retiring_profile_target.empty() && s_current_profile_retired == profile_id) return true;
    // Invalidate before cursor progress, including its last ACK: P->Q->P must reannounce P
    // after queued P deletes finish, even if P's earlier cleanup was already cached.
    invalidate_profile_announcement();
    if (s_retiring_profile_target.empty()) {
        s_retiring_profile_target = profile_id;
        s_retiring_profile_row = s_retiring_profile_shape = 0;
        s_retiring_current_unpublishable =
            s_discovered_profile.empty() || s_discovered_profile == profile_id;
        s_retiring_identity_ready = false;
        s_retiring_scan           = {};
    }
    const auto  target   = def::resolved(def::lookup(s_retiring_profile_target.c_str()));
    const auto  previous = def::resolved(def::lookup(s_discovered_profile.c_str()));
    size_t      work     = PROFILE_RETIRE_WORK_BUDGET;
    std::string topic;
    while (work) {
        const auto& prof = s_retiring_current_unpublishable ? target : previous;
        if (s_retiring_profile_row >= prof.count()) {
            if (s_retiring_current_unpublishable) {
                s_current_profile_retired.swap(s_retiring_profile_target);
                s_retiring_profile_target.clear();
                return s_current_profile_retired == profile_id;
            }
            s_retiring_current_unpublishable = true;
            s_retiring_profile_row = s_retiring_profile_shape = 0;
            s_retiring_identity_ready                         = false;
            s_retiring_scan                                   = {};
            continue;
        }
        const ValueDef d         = logic::adjudicated(prof, s_retiring_profile_row);
        const size_t   shape     = s_retiring_profile_shape;
        const bool     candidate = conv_publishable(d.conv) &&
                               (!s_retiring_current_unpublishable || !row_publishable(d)) &&
                               (shape == 0 || d.conv == 203);
        if (candidate) {
            if (!s_retiring_identity_ready) {
                --work;
                const auto made = mqtt_retirement_identity_make(
                    s_retiring_identity, d, shape == 0 ? nullptr : FAULT_COMPANIONS[shape - 1].key);
                if (made == MqttRetirementIdentityResult::TooLong) {
                    retirement_evidence_update(RETIRE_CURRENT_DURABLE,
                                               RETIRE_INCOMPATIBLE | RETIRE_PENDING);
                    retirement_store_note(RETIRE_INCOMPATIBLE,
                                          "discovery identity exceeds bound; retirement deferred");
                    return false;
                }
                if (made == MqttRetirementIdentityResult::Ready) s_retiring_identity_ready = true;
            }
            if (s_retiring_identity_ready && !s_retiring_current_unpublishable &&
                mqtt_retirement_scan_step(s_retiring_identity, target, s_retiring_scan, work) ==
                    MqttRetirementPresence::Pending)
                return false;
        } else
            --work;
        if (s_retiring_identity_ready &&
            (s_retiring_current_unpublishable ||
             s_retiring_scan.result == MqttRetirementPresence::Absent)) {
            if (!work) return false;
            --work;
            if (shape == 0) {
                const std::string slug = object_id(d.label);
                build_ha_config_topic(topic, ha_component(d), group_for_page(d.reg), slug.c_str());
            } else {
                build_ha_config_topic(topic, "binary_sensor", group_for_page(d.reg),
                                      FAULT_COMPANIONS[shape - 1].key);
            }
            if (!retire_exact_topic(MqttRetirementOwner::Profile, topic)) return false;
        }
        s_retiring_identity_ready = false;
        s_retiring_scan           = {};
        if (++s_retiring_profile_shape == 1 + FAULT_COMPANION_COUNT) {
            s_retiring_profile_shape = 0;
            ++s_retiring_profile_row;
        }
    }
    return false;
}

// A started retirement must not depend on fresh X10A evidence or a still-selected profile. Finish
// its frozen exact-topic job before admitting another cleanup owner; only discovery replacements
// stay behind the ordinary publish gate. Small profile-name copies are staged before SDK effects.
static void service_pending_retirement() {
    service_retained_cleanup_probe(s_legacy_state, s_legacy_state_seen, s_legacy_probe_active,
                                   s_legacy_probe_deadline_us);
    service_retained_cleanup_probe(s_retired_modbus_status, s_retired_modbus_status_seen,
                                   s_retired_modbus_status_probe_active,
                                   s_retired_modbus_status_probe_deadline_us);
    service_retained_cleanup_probe(s_retired_weather, s_retired_weather_seen,
                                   s_retired_weather_probe_active,
                                   s_retired_weather_probe_deadline_us);
    service_retained_cleanup_probe(s_crash, s_crash_seen, s_crash_probe_active,
                                   s_crash_probe_deadline_us);
    if (s_retirement_delivery.owner() == MqttRetirementOwner::LegacyFixed ||
        (s_legacy_fixed_step > 0 && !s_legacy_fixed_retracted))
        retract_legacy_fixed();
    if (!s_stale_values_pending_profile.empty()) {
        const std::string pending = s_stale_values_pending_profile;
        retract_stale_values(pending);
    }
    if (!s_retiring_profile_target.empty()) {
        invalidate_profile_announcement();
        const std::string target = s_retiring_profile_target;
        retract_profile_cutover(target);
    }
    service_periodic_discovery_retirement();
}

static void service_discovery_admission_reset() {
    if (!s_discovery_owner_skipped || !discovery_mutation_allowed() || s_retirement_delivery.busy())
        return;
    // An operator cleaned the collision and reconnected. The old in-flight tombstone has been
    // accounted for; only now may skipped cursors restart instead of claiming an earlier deletion.
    s_legacy_fixed_retracted = false;
    s_legacy_fixed_step      = 0;
    s_stale_values_profile.clear();
    s_stale_values_pending_profile.clear();
    s_stale_values_step = 0;
    s_current_profile_retired.clear();
    s_retiring_profile_target.clear();
    s_retiring_profile_row = s_retiring_profile_shape = 0;
    s_retiring_identity_ready                         = false;
    s_retiring_scan                                   = {};
    s_announced_profile.clear();
    s_heartbeat_announced        = false;
    s_env3_discovery_announced   = false;
    s_periodic_discovery_pending = false;
    s_periodic_discovery_again   = false;
    request_periodic_discovery_retirement();
    s_source_cleanup.request_all();
    s_discovery_owner_skipped = false;
}

[[gnu::noinline]] static bool mqtt_publish_retained_str(const std::string& topic,
                                                        const std::string& payload) {
    return mqtt_publish(topic, payload.c_str(), 0, 0, 1);
}

// Stream one retained discovery config per value of the active profile. Every entity points at the
// X10A topic (s_x10a) and pulls its value out via a value_template. A bit-flag row lands
// under the binary_sensor component, everything else under sensor (logic/discovery.hpp ha_component).
static bool publish_x10a_discovery() {
    if (!discovery_mutation_allowed()) return false;
    const std::string profile_id = config_profile();
    if (profile_id == "auto" || !def::has_profile(profile_id.c_str())) return false;
    if (!load_retirement_provenance()) return false;
    // The VIEW, not the raw profile: every row hp_poll caches needs a discovery config, and the
    // applicable overlay blocks (def/overlay.hpp) are part of that row set. Announcing fewer rows than the
    // X10A topic carries would leave the extra values in MQTT with no HA entity to land in.
    const auto prof = def::resolved(def::lookup(profile_id.c_str()));
    // Delete every frozen superseded identity under the current namespace FIRST — ungrouped ids
    // (legacy-221) and relabelled rows. Ambiguous MAC-era namespaces require operator migration.
    // The freed entity_id is what the replacements below reclaim. Runs once per profile, not once
    // per (re)connect: a broker restart must not re-send ~200 deletes for entities that no longer
    // exist under those ids.
    retirement_evidence_update(RETIRE_CURRENT_DURABLE, RETIRE_PENDING);
    if (!retract_profile_cutover(profile_id)) return false;
    if (s_stale_values_profile != profile_id && !retract_stale_values(profile_id)) return false;
    // Allocate the remembered commit before the first replacement SDK effect. Partial discovery
    // is remembered as belonging to this profile even if a later builder throws; a subsequent
    // profile change therefore retires every possible config from that partially emitted set.
    std::string discovered = profile_id;
    if (!save_retirement_provenance(profile_id)) return false;
    s_discovered_profile.swap(discovered);
    bool        accepted = true;
    std::string ct;
    for (size_t i = 0; i < prof.count(); i++) {
        const ValueDef d = logic::adjudicated(prof, i); // wire truth, not the generator label
        // The confirmed pre-pass already removed current quarantined/detect-only configs and
        // their companions. No unavailable or unproven row may be reintroduced here.
        if (!row_publishable(d)) {
            continue;
        }
        if (!conv_publishable(d.conv)) continue;
        const std::string obj = object_id(d.label);
        if (obj.empty()) continue;
        build_ha_config_topic(ct, ha_component(d), group_for_page(d.reg), obj.c_str());
        accepted =
            mqtt_publish_retained_str(ct, discovery_config(s_node, s_board, s_x10a, s_avail, d)) &&
            accepted; // retained
        // The DERIVED numeric fault flags that ride beside a textual error class (legacy-209 defect
        // 4). Announced here, from the same row loop that publishes the class itself, so the entity
        // set and the payload cannot drift apart — the direct cache encoder emits these keys for
        // exactly the rows this branch announces.
        if (d.conv == 203) {
            const std::string group = group_for_page(d.reg);
            for (size_t k = 0; k < FAULT_COMPANION_COUNT; k++) {
                const FaultCompanion& c = FAULT_COMPANIONS[k];
                build_ha_config_topic(ct, "binary_sensor", group.c_str(), c.key);
                accepted = mqtt_publish_retained_str(ct, companion_discovery_config(s_node, s_board,
                                                                                    s_x10a, s_avail,
                                                                                    group, c)) &&
                           accepted; // retained
            }
        }
    }
    return accepted;
}

static bool publish_env3_discovery() {
    if (!discovery_mutation_allowed()) return false;
    bool ok = true;
    for (size_t i = 0; i < ENV3_HA_SENSOR_COUNT; ++i) {
        const Env3HaSensor& sensor = ENV3_HA_SENSORS[i];
        const std::string topic = env3_discovery_topic(s_prefix, s_node, sensor);
        const std::string config = env3_discovery_config(s_node, s_board, s_env3, s_avail, sensor);
        if (!mqtt_publish(topic, config.c_str(), 0, 0, 1)) ok = false;
    }
    return ok;
}

// Reconnects and the independent timer retire the frozen HomeHub/forecast discovery ledgers.
// Repeat idempotently after a broker restore, using the shared ACK cursor while current source
// telemetry stays live. A reconnect during a pass schedules one further complete pass.
static void request_periodic_discovery_retirement() noexcept {
    if (s_periodic_discovery_pending)
        s_periodic_discovery_again = true;
    else {
        s_periodic_discovery_pending = true;
        s_periodic_discovery_step    = 0;
    }
}

static void service_periodic_discovery_retirement() {
    if (!s_periodic_discovery_pending) return;
    constexpr size_t count = RETIRED_MODBUS_HA_SENSOR_COUNT + RETIRED_WEATHER_HA_SENSOR_COUNT;
    for (size_t work = 0; work < 8 && s_periodic_discovery_step < count; ++work) {
        const size_t      i = s_periodic_discovery_step;
        const std::string topic =
            i < RETIRED_MODBUS_HA_SENSOR_COUNT
                ? retired_modbus_discovery_topic(s_prefix, s_node, RETIRED_MODBUS_HA_SENSORS[i])
                : retired_weather_discovery_topic(
                      s_prefix, s_node,
                      RETIRED_WEATHER_HA_SENSORS[i - RETIRED_MODBUS_HA_SENSOR_COUNT]);
        if (!retire_exact_topic(MqttRetirementOwner::PeriodicDiscovery, topic)) return;
        ++s_periodic_discovery_step;
    }
    if (s_periodic_discovery_step == count) {
        s_periodic_discovery_pending = s_periodic_discovery_again;
        s_periodic_discovery_again   = false;
        s_periodic_discovery_step    = 0;
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
    if (!force && s_last_x10a_digest_valid && probe.digest == s_last_x10a_digest) return true;

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

static bool publish_modbus_state(bool& published_live) {
    bool live = false;
    const std::vector<GroupedValue> values = current_modbus_values(live);
    const std::string js = live ? build_flat_json(values) : std::string("{}");
    if (!s_last_modbus_digest.matches(js)) {
        if (!mqtt_publish(s_modbus, js.c_str(), static_cast<int>(js.size()), 0, 1)) return false;
        s_last_modbus_digest.record(js);
    }
    published_live = live;
    return true;
}

struct RetainedCleanupCycle {
    bool weather = false;
    bool modbus  = false;
    bool env3    = false;
};

static_assert(MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT == RETIRED_WEATHER_HA_SENSOR_COUNT);
static_assert(MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT == RETIRED_MODBUS_HA_SENSOR_COUNT);
static_assert(MQTT_ENV3_CLEANUP_DISCOVERY_COUNT == ENV3_HA_SENSOR_COUNT);

static std::string source_cleanup_topic(const MqttCleanupAction& action) {
    if (action.topic == MqttCleanupTopic::State) {
        switch (action.source) {
        case MqttCleanupSource::Weather:
            return s_retired_forecast;
        case MqttCleanupSource::Modbus:
            return s_modbus;
        case MqttCleanupSource::Env3:
            return s_env3;
        case MqttCleanupSource::None:
            return {};
        }
    }
    if (action.topic == MqttCleanupTopic::RetiredDiscovery) {
        if (action.source == MqttCleanupSource::Weather &&
            action.index < RETIRED_WEATHER_HA_SENSOR_COUNT) {
            const auto& s = RETIRED_WEATHER_HA_SENSORS[action.index];
            std::string out;
            build_ha_config_topic(out, s.component, nullptr, s.object_id);
            return out;
        }
        if (action.source == MqttCleanupSource::Modbus &&
            action.index < RETIRED_MODBUS_HA_SENSOR_COUNT)
            return retired_modbus_discovery_topic(s_prefix, s_node,
                                                  RETIRED_MODBUS_HA_SENSORS[action.index]);
    }
    if (action.topic == MqttCleanupTopic::Env3Discovery &&
        action.source == MqttCleanupSource::Env3 && action.index < ENV3_HA_SENSOR_COUNT)
        return env3_discovery_topic(s_prefix, s_node, ENV3_HA_SENSORS[action.index]);
    return {};
}

static void apply_source_cleanup_completion(const MqttCleanupCompletion& completion) {
    if (completion.discovery_skipped)
        diag_printf(
            "mqtt: superseded source state deleted; discovery left for operator migration\n");
    switch (completion.source) {
    case MqttCleanupSource::Weather:
        if (!completion.discovery_skipped)
            diag_printf("mqtt: superseded Weather state and retired discovery deleted\n");
        break;
    case MqttCleanupSource::Modbus:
        s_modbus_disabled_cleaned = true;
        s_last_modbus_digest.clear();
        if (!completion.discovery_skipped)
            diag_printf("mqtt: superseded HomeHub state and retired discovery deleted\n");
        break;
    case MqttCleanupSource::Env3:
        s_last_env3_digest.clear();
        s_last_env3_samples        = 0;
        s_env3_discovery_announced = false;
        s_env3_disabled_cleaned    = !completion.env3_enabled;
        if (!completion.discovery_skipped)
            diag_printf("mqtt: superseded ENV III state%s deleted\n",
                        completion.env3_enabled ? "" : " and discovery");
        break;
    case MqttCleanupSource::None:
        break;
    }
}

static void service_source_cleanup_evidence() {
    MqttCleanupDeliveryEvidence evidence;
    while (s_source_cleanup_evidence.pop(evidence)) {
        if (s_retirement_delivery.evidence(evidence)) continue;
        if (evidence.outcome == MqttCleanupDeliveryOutcome::Published) {
            if (s_source_cleanup.acknowledge(evidence))
                apply_source_cleanup_completion(s_source_cleanup.take_completion());
        } else if (s_source_cleanup.retry_deleted(evidence)) {
            diag_printf("mqtt: source cleanup outbox item expired — retrying the same step\n");
        }
    }
    const uint32_t dropped = s_source_cleanup_evidence.dropped();
    if (dropped != s_source_cleanup_evidence_drops_reported) {
        s_source_cleanup_evidence_drops_reported = dropped;
        diag_printf("mqtt: source cleanup delivery evidence overflow (%u); restarting transport\n",
                    static_cast<unsigned>(dropped));
    }
}

// A source identity or consent change explicitly invalidates retained evidence. Consume all three
// request bits into the pure scheduler before selecting one step: queued sources therefore remain
// suppressed while another source waits for its PUBACK. A queue admission is not completion, and a
// missing PUBACK does not enqueue another copy on the next one-second cycle.
static RetainedCleanupCycle service_requested_topic_cleanup(const Config& c) {
    s_source_cleanup.begin_cycle();
    const bool     connected       = s_connected.load(std::memory_order_acquire);
    const uint32_t connected_epoch = s_connected_client_epoch.load(std::memory_order_acquire);
    if (connected && connected_epoch != 0) s_source_cleanup.reconstruct_for_client(connected_epoch);
    if (s_weather_cleanup_requested.exchange(false, std::memory_order_acq_rel))
        s_source_cleanup.request(MqttCleanupSource::Weather);
    if (s_modbus_cleanup_requested.exchange(false, std::memory_order_acq_rel))
        s_source_cleanup.request(MqttCleanupSource::Modbus);
    if (s_env3_cleanup_requested.exchange(false, std::memory_order_acq_rel))
        s_source_cleanup.request(MqttCleanupSource::Env3);

    // Drain before queueing so an unrelated older PUBACK can never be mistaken for a newly reused
    // numeric message id. Drain again after storing the id to cover a callback that ran before
    // esp_mqtt_client_enqueue() returned it to this task.
    service_source_cleanup_evidence();
    load_retirement_provenance();
    service_pending_retirement();
    const bool              env3_enabled = c.env3_enabled && env3_board_supported(c);
    const MqttCleanupAction action       = s_source_cleanup.next_action(
        connected && connected_epoch == s_source_cleanup.client_epoch() &&
            !s_retirement_delivery.busy(),
        env3_enabled);
    if (action) {
        const std::string topic = source_cleanup_topic(action);
        if (!topic.empty()) {
            if (action.topic != MqttCleanupTopic::State && discovery_topic_guarded(topic) &&
                !discovery_mutation_allowed()) {
                if (s_discovery_owner_state.load(std::memory_order_acquire) ==
                        DiscoveryOwnerState::Blocked &&
                    s_source_cleanup.skip_discovery_for_operator_migration()) {
                    s_discovery_owner_skipped = true;
                    apply_source_cleanup_completion(s_source_cleanup.take_completion());
                }
            } else {
                const uint32_t epoch  = s_source_cleanup.client_epoch();
                const int      msg_id = mqtt_enqueue_id(topic, "", 0, 1, 1);
                if (msg_id >= 0) {
                    if (!s_source_cleanup.publish_queued(epoch, msg_id))
                        diag_printf("mqtt: source cleanup scheduler rejected queued tombstone\n");
                    service_source_cleanup_evidence();
                }
            }
        }
    }

    RetainedCleanupCycle suppressed;
    suppressed.weather = s_source_cleanup.suppress(MqttCleanupSource::Weather);
    suppressed.modbus  = s_source_cleanup.suppress(MqttCleanupSource::Modbus);
    suppressed.env3    = s_source_cleanup.suppress(MqttCleanupSource::Env3);
    return suppressed;
}

// ENV III is independent observation telemetry and not part of either heat-pump payload. Three HA
// discovery entities read this same document. Publish every successful sensor sample, even if
// rounding produces the same JSON, so a time-series subscriber sees the sensor's real 10 s sampling
// cadence. Errors/staleness publish a counter-only `{samples,errors}` document once; each entity's
// availability template sees its missing reading key and becomes unavailable instead of carrying a
// plausible retained outdoor value forward.
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
    if (new_sample || !s_last_env3_digest.matches(js)) {
        if (mqtt_publish(s_env3, js.c_str(), static_cast<int>(js.size()), 0, 1)) {
            s_last_env3_digest.record(js);
            s_last_env3_samples = env.samples;
        }
    }
}

// Stream one retained discovery config per diagnostic sensor (logic/heartbeat.hpp). These describe
// the ESP32 board + X10A link itself, not a heat-pump value, so — unlike X10A discovery —
// they don't wait on profile detection: WiFi signal and free heap are meaningful even while
// profile == "auto".
[[gnu::noinline]] static bool publish_heartbeat_discovery() {
    if (!discovery_mutation_allowed()) return false;
    if (!s_legacy_fixed_retracted && !retract_legacy_fixed()) return false;
    bool        accepted = true;
    std::string ct;
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
        const HeartbeatSensor& s = HEARTBEAT_SENSORS[i];
        build_ha_config_topic(ct, s.component, nullptr, s.object_id);
        accepted = mqtt_publish_retained_str(
                       ct, heartbeat_discovery_config(s_node, s_board, s_heartbeat, s_avail, s)) &&
                   accepted; // retained
    }
    return accepted;
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
static void publish_crash(bool discovery = true) {
    if (discovery && discovery_mutation_allowed()) {
        if (!s_legacy_fixed_retracted && !retract_legacy_fixed()) return;
        std::string ct;
        for (int i = 0; i < CRASH_SENSOR_COUNT; i++) {
            const CrashSensor& s = CRASH_SENSORS[i];
            build_ha_config_topic(ct, s.component, nullptr, s.object_id);
            mqtt_publish_retained_str(
                ct, crash_discovery_config(s_node, s_board, s_crash, s_avail, s)); // retained
        }
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
            // A previously admitted delete must finish before a replacement retained crash. Keep
            // subscription ownership on a rejected teardown, then retry this publication later.
            if (s_retirement_delivery.owner() == MqttRetirementOwner::CrashProbe &&
                !s_retirement_delivery.take_confirmed(MqttRetirementOwner::CrashProbe))
                return;
            if (esp_mqtt_client_unsubscribe(s_client, s_crash.c_str()) < 0) return;
            s_crash_probe_active = false;
            s_crash_seen = false;
            s_retained_probe_progress[3] = {};
        }
        // A rejected initial subscription owns no live topic, but its deferred retry must also be
        // cancelled before retaining a new notable crash that the old probe would otherwise delete.
        s_retained_probe_progress[3].subscribe_retry = false;
        mqtt_publish(s_crash, js.c_str(), static_cast<int>(js.size()), 0, 1);   // retained
    } else {
        start_retained_cleanup_probe(s_crash, s_crash_seen, s_crash_probe_active,
                                     s_crash_probe_deadline_us, "crash topic");
    }
    s_crash_dump_pub    = ci.coredump;
    s_crash_notable_pub = !js.empty();
}

// Snapshot board/link diagnostics from the IDF heap/timer APIs + the poll/WiFi/MQTT state, and
// publish it to the heartbeat topic (not retained). Called on a fixed HEARTBEAT_INTERVAL_S cadence
// (mqtt_task) — diagnostics, not real-time telemetry, so unlike the source topics it always publishes
// rather than only on change.
static __attribute__((noinline)) std::string build_heartbeat_payload() {
    HpStats  hp = hp_stats();
    WifiInfo wi = wifi_info();
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
    // and asking from this one would file all five under mqtt_pub's name.
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
    // The cycles that produced nothing (legacy-380). poll_skipped comes from the OTHER task's
    // counter, not from `hp` above: hp_stats() describes cycles that RAN, and a sweep that threw
    // never committed.
    f.mqtt_skipped    = s_mqtt_skipped.load(std::memory_order_relaxed);
    f.mqtt_quiesced   = s_mqtt_quiesced.load(std::memory_order_relaxed);
    f.poll_skipped    = hp_skipped_cycles();
    f.bus_connected   = hp.connected;
    f.bus_proto                   = static_cast<char>(config_x10a_protocol());
    f.registers       = hp.registers;
    f.values          = hp.values;
    f.crc_err         = hp.crc_err;
    f.timeout_err     = hp.timeout_err;
    f.rx_received     = hp.rx_ok;
    f.rx_fails        = hp.rx_fail_total;
    f.last_ok_s       = hp.last_ok_s;
    f.ou_freshness                = hp.ou_freshness;
    const ModbusStatus mbs = mb_status();
    f.modbus_enabled   = mbs.enabled;
    f.modbus_connected = mbs.connected;
    f.modbus_rx        = mbs.rx_ok;
    f.modbus_fails     = mbs.rx_fail;
    f.modbus_stack_min_free_bytes = stack_watch_min_free_bytes(StackWatch::Modbus);
    f.cycling                     = checkup_cycling_evidence();
    f.modbus_cycling              = checkup_cycling_evidence(DiagnosticsSource::Modbus);
    f.stop_context                = stop_context_payload_fields(checkup_stop_context_report());
    return build_heartbeat_json(f, HYDRONIC_FLAT_JSON_MAX_BYTES);
}

static __attribute__((noinline)) void append_heartbeat_hydronic(std::string& js) {
    if (js.empty() || js.back() != '}') return;
    js.pop_back(); // the base builder returns one complete object
    append_hydronic_json(js, checkup_hydronic_report(), true);
    js.push_back('}');
}

[[gnu::noinline]] static void publish_heater_context() {
    checkup_heater_context_expire();
    logic::HeaterContextPayloadFields fields{};
    heater_context_payload(fields);
    // One small message at a time. Both use the SAME atomic two-heater evidence snapshot.
    for (uint8_t h = 0; h < logic::heater_context::HEATERS; ++h) {
        std::string json;
        json.reserve(2048);
        append_heater_context_json(json, fields, true, h);
        mqtt_publish(h ? s_heater_bsh_topic : s_heater_buh_topic, json.c_str(),
                     static_cast<int>(json.size()), 0, 0);
    }
}

static __attribute__((noinline)) void publish_heartbeat() {
    std::string js = build_heartbeat_payload();
    append_heartbeat_hydronic(js);
    mqtt_publish(s_heartbeat, js.c_str(), static_cast<int>(js.size()), 0, 0);   // not retained
}

// Namespace replay also delivers discovery configs. They belong to the ownership guard, unless
// this exact topic is additionally an active explicit input. These bounded comparisons borrow
// only applied binding strings under the existing RAII mutex; the event callback allocates none.
[[gnu::noinline]] static bool discovery_topic_is_current_input(std::string_view topic) {
    if (!s_mtx) return false;
    Lock       lk(s_mtx);
    const auto matches = [topic](const std::string& binding) noexcept {
        return !binding.empty() && topic == std::string_view(binding);
    };
    if (s_circulation_capture_enabled &&
        mqtt_source_epoch_current(s_circulation_requested_epoch.load(std::memory_order_acquire),
                                  s_circulation_applied_epoch,
                                  s_circulation_requested_epoch.load(std::memory_order_acquire)) &&
        matches(s_circulation_binding_topic))
        return true;
    const uint32_t generation =
        s_circulation_probe_capture_generation.load(std::memory_order_acquire);
    return generation != 0 && s_circulation_probe.active &&
           s_circulation_probe.generation == generation &&
           matches(s_circulation_probe.config.topic);
}

// Reassemble a possibly-fragmented MQTT DATA event without allocating. Unrelated discovery does
// not consume the source queue; the explicit-input decision is bound to the first fragment.
static void capture_circulation_frame(esp_mqtt_event_handle_t e) {
    if (e && e->current_data_offset == 0 && e->topic && e->topic_len > 0 &&
        mqtt_discovery_namespace_topic(
            std::string_view(e->topic, static_cast<size_t>(e->topic_len)), s_prefix, s_node) &&
        !discovery_topic_is_current_input(
            std::string_view(e->topic, static_cast<size_t>(e->topic_len)))) {
        s_inbound_rx_active = false;
        return;
    }
    if (!e || !s_inbound_queue || e->total_data_len <= 0 ||
        e->total_data_len > static_cast<int>(CIRCULATION_PAYLOAD_MAX)) {
        s_inbound_rx_active = false;
        return;
    }
    if (e->current_data_offset == 0 && s_event_rx_discovery_active) {
        new (&s_event_rx.circulation) CirculationMqttFrame(circulation_frame_scratch());
        s_event_rx_discovery_active = false;
    }
    if (e->current_data_offset == 0) {
        s_inbound_rx.circulation_epoch =
            s_circulation_requested_epoch.load(std::memory_order_acquire);
        s_inbound_rx.probe_generation =
            s_circulation_probe_capture_generation.load(std::memory_order_acquire);
        s_inbound_rx_received = 0;
        s_inbound_rx_active =
            e->topic && e->topic_len > 0 && e->topic_len <= static_cast<int>(MQTT_SOURCE_TOPIC_MAX);
        if (!s_inbound_rx_active) return;
        std::memcpy(s_inbound_rx.topic, e->topic, static_cast<size_t>(e->topic_len));
        s_inbound_rx.topic[e->topic_len] = '\0';
        s_inbound_rx.payload_len         = static_cast<size_t>(e->total_data_len);
        s_inbound_rx.retained            = e->retain != 0;
        s_inbound_rx.received_ms         = static_cast<uint64_t>(esp_timer_get_time() / 1000);
        int32_t received_sub_ms = 0;
        time_now(s_inbound_rx.received_unix_s, received_sub_ms);
    }
    if (!s_inbound_rx_active || s_event_rx_discovery_active ||
        !mqtt_fragment_fits(e->current_data_offset, e->data_len, e->total_data_len,
                            s_inbound_rx_received, s_inbound_rx.payload_len,
                            CIRCULATION_PAYLOAD_MAX) ||
        (e->data_len > 0 && !e->data)) {
        s_inbound_rx_active = false;
        return;
    }
    if (e->data_len > 0)
        std::memcpy(s_inbound_rx.payload + e->current_data_offset, e->data,
                    static_cast<size_t>(e->data_len));
    s_inbound_rx_received += static_cast<size_t>(e->data_len);
    if (s_inbound_rx_received == s_inbound_rx.payload_len) {
        s_inbound_rx.payload[s_inbound_rx.payload_len] = '\0';
        const size_t   topic_len                       = std::strlen(s_inbound_rx.topic);
        const size_t   total_len                       = topic_len + s_inbound_rx.payload_len;
        const uint32_t consumed = s_inbound_ring_consumed.load(std::memory_order_acquire);
        const uint32_t used     = s_inbound_ring_produced - consumed;
        bool           enqueued = false;
        if (topic_len > 0 && topic_len <= MQTT_SOURCE_TOPIC_MAX &&
            mqtt_ring_can_reserve(used, CIRCULATION_PAYLOAD_RING_BYTES, total_len)) {
            const size_t after_topic =
                mqtt_ring_write(s_inbound_payload_ring, CIRCULATION_PAYLOAD_RING_BYTES,
                                s_inbound_ring_pos, s_inbound_rx.topic, topic_len);
            const size_t after_payload =
                mqtt_ring_write(s_inbound_payload_ring, CIRCULATION_PAYLOAD_RING_BYTES, after_topic,
                                s_inbound_rx.payload, s_inbound_rx.payload_len);
            s_inbound_rx_meta.received_unix_s   = s_inbound_rx.received_unix_s;
            s_inbound_rx_meta.received_ms       = s_inbound_rx.received_ms;
            s_inbound_rx_meta.circulation_epoch = s_inbound_rx.circulation_epoch;
            s_inbound_rx_meta.probe_generation  = s_inbound_rx.probe_generation;
            s_inbound_rx_meta.ring_offset       = static_cast<uint16_t>(s_inbound_ring_pos);
            s_inbound_rx_meta.topic_len         = static_cast<uint16_t>(topic_len);
            s_inbound_rx_meta.payload_len       = static_cast<uint16_t>(s_inbound_rx.payload_len);
            s_inbound_rx_meta.retained          = s_inbound_rx.retained;
            if (xQueueSend(s_inbound_queue, &s_inbound_rx_meta, 0) == pdTRUE) {
                s_inbound_ring_pos = after_payload;
                s_inbound_ring_produced += static_cast<uint32_t>(total_len);
                enqueued = true;
            }
        }
        if (!enqueued) s_inbound_dropped.fetch_add(1, std::memory_order_relaxed);
        s_inbound_rx_active = false;
    }
}

static cJSON* mqtt_source_json_item(cJSON* root, const std::string& path) {
    cJSON* node = root;
    size_t pos = 0;
    char   key[MQTT_SOURCE_KEY_MAX + 1];
    while (pos < path.size()) {
        const size_t dot = path.find('.', pos);
        const size_t end = dot == std::string::npos ? path.size() : dot;
        const size_t len = end - pos;  // validated by POST/load contract; still fail closed here
        if (len == 0 || len > MQTT_SOURCE_KEY_MAX || !cJSON_IsObject(node)) return nullptr;
        std::memcpy(key, path.data() + pos, len);
        key[len] = '\0';
        node = cJSON_GetObjectItemCaseSensitive(node, key);
        if (!node) return nullptr;
        pos = dot == std::string::npos ? path.size() : dot + 1;
    }
    return node;
}

static bool mqtt_source_payload_timestamp(cJSON* item, int64_t& unix_s, const char*& source) {
    if (cJSON_IsString(item) && item->valuestring &&
        mqtt_source_parse_rfc3339(item->valuestring, unix_s)) {
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

struct DecodedCirculationFrame {
    bool valid=false;
    double power_w=0.0;
    int64_t source_unix_s=-1;
    const char* timestamp_source="payload_unix_s";
    const char* error=nullptr;
};

static __attribute__((noinline)) DecodedCirculationFrame
decode_circulation_frame(const CirculationMqttFrame& frame, const std::string& power_path,
                         const std::string& timestamp_path) {
    DecodedCirculationFrame out;
    if (frame.payload_len == 0 ||
        !json_payload_strings_ok(std::string_view(frame.payload, frame.payload_len))) {
        out.error = "payload is not valid JSON";
        return out;
    }
    if (!json_payload_depth_ok(std::string_view(frame.payload, frame.payload_len))) {
        out.error = "payload nesting depth exceeded";
        return out;
    }
    const char* parse_end = nullptr;
    JsonGuard root(cJSON_ParseWithLengthOpts(frame.payload, frame.payload_len, &parse_end, false));
    if (!root) { out.error = "payload is not valid JSON"; return out; }
    const char* payload_end = frame.payload + frame.payload_len;
    if (!parse_end || parse_end < frame.payload || parse_end > payload_end ||
        !json_suffix_is_whitespace(
            std::string_view(parse_end, static_cast<size_t>(payload_end - parse_end)))) {
        out.error = "payload has trailing data";
        return out;
    }
    cJSON* power = mqtt_source_json_item(root.get(), power_path);
    if (!cJSON_IsNumber(power) || !std::isfinite(power->valuedouble) ||
        power->valuedouble < 0.0 || power->valuedouble > CIRC_SOURCE_POWER_MAX_W) {
        out.error = "Power path is missing, not numeric or out of range";
        return out;
    }
    cJSON* timestamp = mqtt_source_json_item(root.get(), timestamp_path);
    if (!mqtt_source_payload_timestamp(timestamp, out.source_unix_s, out.timestamp_source)) {
        out.error = "Timestamp path is missing or not RFC3339/Unix seconds";
        return out;
    }
    if (frame.received_unix_s >= 0 &&
        out.source_unix_s > frame.received_unix_s + MQTT_SOURCE_FUTURE_TOLERANCE_S) {
        out.error = "Source timestamp is in the future";
        return out;
    }
    out.power_w = power->valuedouble;
    out.valid = true;
    return out;
}

static MqttSourceFreshness circulation_frame_freshness(const CirculationMqttFrame&    frame,
                                                       const DecodedCirculationFrame& decoded,
                                                       uint32_t                       max_age_s) {
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    return mqtt_source_freshness(true, frame.retained, true, decoded.source_unix_s,
                                 frame.received_ms, now_unix_s,
                                 static_cast<uint64_t>(esp_timer_get_time() / 1000), max_age_s);
}

static void reset_circulation_status_locked(bool configured) {
    s_circulation_status = CirculationSourceStatus{};
    s_circulation_status.configured = configured;
    s_circulation_tracker.reset();
}

static bool circulation_epoch_current_locked(uint32_t epoch) {
    return mqtt_source_epoch_current(epoch, s_circulation_applied_epoch,
                                     s_circulation_requested_epoch.load(std::memory_order_acquire));
}

static bool circulation_request_current_locked(uint32_t epoch, const Config& c) {
    return circulation_epoch_current_locked(epoch) &&
           c.circulation_topic == s_circulation_binding_topic &&
           c.circulation_power_path == s_circulation_binding_power_path &&
           c.circulation_time_path == s_circulation_binding_time_path &&
           (c.diagnostics_enabled && !c.circulation_topic.empty()) ==
               s_circulation_capture_enabled &&
           c.circulation_max_age_s == s_circulation_runtime_max_age_s &&
           c.circulation_on_tenths_w == s_circulation_on_tenths_w &&
           c.circulation_off_tenths_w == s_circulation_off_tenths_w &&
           c.circulation_confirm_s == s_circulation_confirm_s;
}

static void service_circulation_subscription(const Config& c, uint32_t epoch) {
    const bool configured = !c.circulation_topic.empty();
    const bool capture_enabled = c.diagnostics_enabled && configured;
    bool       changed         = false;
    {
        Lock lk(s_mtx);
        if (epoch != s_circulation_requested_epoch.load(std::memory_order_acquire)) return;
        changed = c.circulation_topic != s_circulation_binding_topic ||
                  c.circulation_power_path != s_circulation_binding_power_path ||
                  c.circulation_time_path != s_circulation_binding_time_path ||
                  capture_enabled != s_circulation_capture_enabled;
    }
    std::array<std::string, 3> binding;
    if (changed) binding = {c.circulation_topic, c.circulation_power_path, c.circulation_time_path};
    {
        Lock lk(s_mtx);
        if (epoch != s_circulation_requested_epoch.load(std::memory_order_acquire)) return;
        if (changed) {
            const bool mapping_changed =
                c.circulation_topic != s_circulation_binding_topic ||
                c.circulation_power_path != s_circulation_binding_power_path ||
                c.circulation_time_path != s_circulation_binding_time_path;
            s_circulation_binding_topic.swap(binding[0]);
            s_circulation_binding_power_path.swap(binding[1]);
            s_circulation_binding_time_path.swap(binding[2]);
            s_circulation_capture_enabled = capture_enabled;
            reset_circulation_status_locked(configured);
            if (mapping_changed) s_circulation_source_time.reset();
        }
        s_circulation_runtime_max_age_s = c.circulation_max_age_s;
        s_circulation_on_tenths_w       = c.circulation_on_tenths_w;
        s_circulation_off_tenths_w      = c.circulation_off_tenths_w;
        s_circulation_confirm_s         = c.circulation_confirm_s;
        s_circulation_status.configured = configured;
        s_circulation_applied_epoch     = epoch;
    }

    if (!capture_enabled) {
        s_circulation_reconfigure.exchange(false);
        const bool retired =
            s_circulation_subscribed_topic.empty() || !s_connected ||
            s_circulation_subscribed_topic == s_circulation_probe_subscribed_topic ||
            esp_mqtt_client_unsubscribe(s_client, s_circulation_subscribed_topic.c_str()) >= 0;
        if (retired) s_circulation_subscribed_topic.clear();
        s_circulation_subscription_retry = !retired;
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        s_circulation_status.subscribed = false;
        if (!retired) s_circulation_status.error = "MQTT unsubscribe failed";
        return;
    }

    const char* invalid = nullptr;
    if (!circulation_source_config_valid(
            c.circulation_name, c.circulation_topic, c.circulation_power_path,
            c.circulation_time_path, c.circulation_max_age_s,
            c.circulation_on_tenths_w, c.circulation_off_tenths_w,
            c.circulation_confirm_s, &invalid)) {
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        s_circulation_status.subscribed = false;
        s_circulation_status.error = invalid ? invalid : "invalid circulation source config";
        s_circulation_status.errors++;
        return;
    }

    const bool force = s_circulation_reconfigure.exchange(false);
    if (force) {
        // Keep the reconnect request through any later allocation failure. The prior cleanup
        // owner can still match even though a clean broker session needs a new SUBSCRIBE.
        s_circulation_subscription_retry = true;
        // Reconnects and persisted threshold/age changes both require a fresh, confirmed state.
        // A previously confirmed ON/OFF must not cross either boundary as current evidence.
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        reset_circulation_status_locked(configured);
    }
    if (!s_connected) {
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        s_circulation_status.subscribed = false;
        return;
    }
    if (!force && !s_circulation_subscription_retry &&
        s_circulation_subscribed_topic == c.circulation_topic)
        return;
    std::string prepared_owner = c.circulation_topic;
    if (!s_circulation_subscribed_topic.empty() &&
        s_circulation_subscribed_topic != c.circulation_topic) {
        if (s_circulation_subscribed_topic != s_circulation_probe_subscribed_topic &&
            esp_mqtt_client_unsubscribe(s_client, s_circulation_subscribed_topic.c_str()) < 0) {
            s_circulation_subscription_retry = true;
            Lock lk(s_mtx);
            if (!circulation_epoch_current_locked(epoch)) return;
            s_circulation_status.subscribed = false;
            s_circulation_status.error      = "MQTT unsubscribe failed";
            s_circulation_status.errors++;
            return;
        }
        s_circulation_subscribed_topic.clear();
    }

    const int id = esp_mqtt_client_subscribe(s_client, c.circulation_topic.c_str(), 0);
    if (id >= 0) s_circulation_subscribed_topic.swap(prepared_owner);
    s_circulation_subscription_retry = id < 0;
    {
        Lock lk(s_mtx);
        if (!circulation_epoch_current_locked(epoch)) return;
        s_circulation_status.subscribed = id >= 0;
        s_circulation_status.error = id >= 0 ? "" : "MQTT subscribe failed";
        if (id < 0) s_circulation_status.errors++;
    }
    if (id >= 0) {
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
        const bool retired =
            s_circulation_probe_subscribed_topic.empty() || !s_connected ||
            s_circulation_probe_subscribed_topic == s_circulation_subscribed_topic ||
            esp_mqtt_client_unsubscribe(s_client, s_circulation_probe_subscribed_topic.c_str()) >=
                0;
        if (retired) s_circulation_probe_subscribed_topic.clear();
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
        const bool retired =
            s_circulation_probe_subscribed_topic.empty() ||
            s_circulation_probe_subscribed_topic == s_circulation_subscribed_topic ||
            esp_mqtt_client_unsubscribe(s_client, s_circulation_probe_subscribed_topic.c_str()) >=
                0;
        if (retired) s_circulation_probe_subscribed_topic.clear();
        s_circulation_probe_task_generation = 0;
        return;
    }
    if (s_circulation_probe_task_generation == generation) return;
    // A second Test can arrive before the previous inactive probe's cleanup cycle. Retire that
    // owner before replacing it; a rejected SDK unsubscribe keeps the identity for the next tick.
    if (!s_circulation_probe_subscribed_topic.empty() &&
        s_circulation_probe_subscribed_topic != candidate.topic) {
        if (s_circulation_probe_subscribed_topic != s_circulation_subscribed_topic &&
            esp_mqtt_client_unsubscribe(s_client, s_circulation_probe_subscribed_topic.c_str()) <
                0) {
            Lock lk(s_mtx);
            if (s_circulation_probe.active && s_circulation_probe.generation == generation) {
                s_circulation_probe.subscribed = false;
                s_circulation_probe.error      = "MQTT unsubscribe failed";
            }
            return;
        }
        s_circulation_probe_subscribed_topic.clear();
    }
    // Re-subscribe UNCONDITIONALLY, including when this exact topic is already the saved source's.
    // This asks the broker to deliver the retained value again, so pressing Test has a bounded
    // answer instead of depending on when the source happens to publish next. Skipping it here made
    // re-testing an unchanged mapping wait for a live publish inside the 12 s window, so an
    // on-change-only meter answered 422 and /set_circulation then refused the save with the proof
    // gate — the mapping blamed for the probe.
    const int id = esp_mqtt_client_subscribe(s_client, candidate.topic.c_str(), 0);
    // Configuration alone does not prove another owner exists: its SDK subscribe may have failed.
    // Commit the accepted cleanup identity before the status-generation check, without allocation.
    if (id >= 0 && candidate.topic != s_circulation_subscribed_topic)
        s_circulation_probe_subscribed_topic.swap(candidate.topic);
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
    s_circulation_probe_task_generation = generation;
    if (signal && s_circulation_probe_sem) xSemaphoreGive(s_circulation_probe_sem);
}

static __attribute__((noinline)) void
service_circulation_probe_frame(const CirculationMqttFrame& frame) {
    // Topic ownership is checked under the lock; decoding only needs the two paths and limits.
    struct {
        std::string power_path, timestamp_path;
        uint32_t    max_age_s   = 0;
        uint16_t    on_tenths_w = 0, off_tenths_w = 0;
    } candidate;
    uint32_t generation = 0;
    {
        Lock lk(s_mtx);
        if (!s_circulation_probe.active ||
            frame.probe_generation != s_circulation_probe.generation ||
            frame.topic != s_circulation_probe.config.topic)
            return;
        candidate.power_path     = s_circulation_probe.config.power_path;
        candidate.timestamp_path = s_circulation_probe.config.timestamp_path;
        candidate.max_age_s      = s_circulation_probe.config.max_age_s;
        candidate.on_tenths_w    = s_circulation_probe.config.on_tenths_w;
        candidate.off_tenths_w   = s_circulation_probe.config.off_tenths_w;
        generation               = s_circulation_probe.generation;
    }
    const DecodedCirculationFrame decoded =
        decode_circulation_frame(frame, candidate.power_path, candidate.timestamp_path);
    const uint64_t           tested_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    const MqttSourceFreshness freshness =
        decoded.valid ? circulation_frame_freshness(frame, decoded, candidate.max_age_s)
                      : MqttSourceFreshness{};
    bool signal = false;
    {
        Lock lk(s_mtx);
        if (!s_circulation_probe.active || s_circulation_probe.generation != generation) return;
        if (!decoded.valid) {
            s_circulation_probe.error = decoded.error ? decoded.error : "Source value is invalid";
            return;
        }
        if (!freshness.fresh) {
            s_circulation_probe.error =
                freshness.reason ? freshness.reason : "Source value is stale";
            return;
        }
        s_circulation_probe.active   = false;
        s_circulation_probe.passed = true;
        s_circulation_probe.retained = frame.retained;
        s_circulation_probe.power_w = decoded.power_w;
        s_circulation_probe.state = circulation_power_class(
            decoded.power_w, candidate.on_tenths_w, candidate.off_tenths_w);
        s_circulation_probe.clock = {tested_ms, freshness.age_s, decoded.source_unix_s, true};
        s_circulation_probe.error.clear();
        signal = true;
    }
    if (signal && s_circulation_probe_sem) xSemaphoreGive(s_circulation_probe_sem);
}

static __attribute__((noinline)) void service_circulation_frame(const CirculationMqttFrame& frame,
                                                                const Config&               c) {
    if (!c.diagnostics_enabled || c.circulation_topic.empty() ||
        frame.topic != c.circulation_topic) return;
    CirculationSourceStatus  candidate;
    CirculationPowerTracker  tracker;
    SourceTimestampHighWater source_time;
    {
        Lock lk(s_mtx);
        if (!circulation_request_current_locked(frame.circulation_epoch, c)) return;
        candidate   = s_circulation_status;
        tracker     = s_circulation_tracker;
        source_time = s_circulation_source_time;
    }
    candidate.messages++;
    const DecodedCirculationFrame decoded = decode_circulation_frame(
        frame, c.circulation_power_path, c.circulation_time_path);
    if (!decoded.valid) {
        candidate.error = decoded.error ? decoded.error : "Source value is invalid";
        candidate.errors++;
        candidate.rejections++;
    } else if (!source_time.allows(decoded.source_unix_s)) {
        candidate.error = "Source timestamp moved backward";
        candidate.errors++;
        candidate.rejections++;
    } else {
        const MqttSourceFreshness freshness =
            circulation_frame_freshness(frame, decoded, c.circulation_max_age_s);
        if (!freshness.fresh) {
            candidate.error = freshness.reason ? freshness.reason : "Source value is stale";
            candidate.rejections++;
        } else {
            if (candidate.has_value && (frame.received_ms < candidate.received_ms ||
                                        frame.received_ms - candidate.received_ms >
                                            static_cast<uint64_t>(c.circulation_max_age_s) * 1000))
                tracker.reset();
            tracker.observe(decoded.power_w, frame.received_ms, c.circulation_on_tenths_w,
                            c.circulation_off_tenths_w, c.circulation_confirm_s);
            candidate.power_w          = decoded.power_w;
            candidate.received_ms      = frame.received_ms;
            candidate.received_unix_s  = frame.received_unix_s;
            candidate.source_unix_s    = decoded.source_unix_s;
            candidate.retained         = frame.retained;
            candidate.has_source_time  = true;
            candidate.has_value        = true;
            candidate.timestamp_source = decoded.timestamp_source;
            candidate.state            = tracker.confirmed;
            candidate.error.clear();
            (void)source_time.accept(decoded.source_unix_s);
        }
    }
    // Error/timestamp strings and tracker updates are staged. The request guard prevents an old
    // decoder from repopulating a deleted/replaced source; OOM preserves all prior raw evidence.
    Lock lk(s_mtx);
    if (!circulation_request_current_locked(frame.circulation_epoch, c)) return;
    s_circulation_status      = std::move(candidate);
    s_circulation_tracker     = tracker;
    s_circulation_source_time = source_time;
}

// Each source handler is a sibling. The queue dispatcher owns no mapping or status snapshot.
static __attribute__((noinline)) void service_circulation_frames(const Config& c) {
    if (!s_inbound_queue) return;
    const uint32_t dropped = s_inbound_dropped.load(std::memory_order_relaxed);
    if (dropped != s_inbound_dropped_reported) {
        diag_printf("mqtt: %lu inbound source frame(s) dropped — queue full\n",
                    static_cast<unsigned long>(dropped - s_inbound_dropped_reported));
        s_inbound_dropped_reported = dropped;
    }
    while (xQueueReceive(s_inbound_queue, &s_inbound_task_meta, 0) == pdTRUE) {
        if (s_inbound_task_meta.topic_len == 0 ||
            s_inbound_task_meta.topic_len > MQTT_SOURCE_TOPIC_MAX ||
            s_inbound_task_meta.payload_len == 0 ||
            s_inbound_task_meta.payload_len > CIRCULATION_PAYLOAD_MAX ||
            s_inbound_task_meta.ring_offset >= CIRCULATION_PAYLOAD_RING_BYTES)
            continue;
        const size_t after_topic = mqtt_ring_read(
            s_inbound_payload_ring, CIRCULATION_PAYLOAD_RING_BYTES, s_inbound_task_meta.ring_offset,
            s_inbound_task_frame.topic, s_inbound_task_meta.topic_len);
        s_inbound_task_frame.topic[s_inbound_task_meta.topic_len] = '\0';
        (void)mqtt_ring_read(s_inbound_payload_ring, CIRCULATION_PAYLOAD_RING_BYTES, after_topic,
                             s_inbound_task_frame.payload, s_inbound_task_meta.payload_len);
        s_inbound_task_frame.payload[s_inbound_task_meta.payload_len] = '\0';
        s_inbound_task_frame.payload_len       = s_inbound_task_meta.payload_len;
        s_inbound_task_frame.received_ms       = s_inbound_task_meta.received_ms;
        s_inbound_task_frame.received_unix_s   = s_inbound_task_meta.received_unix_s;
        s_inbound_task_frame.circulation_epoch = s_inbound_task_meta.circulation_epoch;
        s_inbound_task_frame.probe_generation  = s_inbound_task_meta.probe_generation;
        s_inbound_task_frame.retained          = s_inbound_task_meta.retained;
        s_inbound_ring_consumed.fetch_add(
            static_cast<uint32_t>(s_inbound_task_meta.topic_len) +
                static_cast<uint32_t>(s_inbound_task_meta.payload_len),
            std::memory_order_release);
        if (!c.diagnostics_enabled) continue;
        service_circulation_probe_frame(s_inbound_task_frame);
        service_circulation_frame(s_inbound_task_frame, c);
    }
}

// esp-mqtt owns its transport/TLS task, so the firmware publish-cycle acknowledgement alone cannot
// describe a handshake or reconnect. MQTT_EVENT_BEFORE_CONNECT runs synchronously on that task
// immediately before esp_transport_connect(). It must not wait here: the callback owns esp-mqtt's
// MQTT_API_LOCK, while the publisher task needs that same lock to stop/join the client for an
// advertised OTA owner. A wait in this callback can deadlock that stop until the publisher's
// task watchdog fires. Publish the activity and return; the network owner waits for the publisher
// task to stop the complete client and acknowledge `mqtt_transport_network_quiesced()`.
static void mqtt_transport_before_connect() {
    s_transport_connecting.store(true, std::memory_order_release);
}

static void on_mqtt(void*, esp_event_base_t, int32_t id, void* data) {
    // mqtt 1.1.0 dispatches these three events on its transport task. ERROR/DISCONNECTED can
    // instead run inside a synchronous publish/subscribe caller, so they must not sample this slot.
    if (id == MQTT_EVENT_BEFORE_CONNECT || id == MQTT_EVENT_CONNECTED || id == MQTT_EVENT_DATA)
        stack_watch_sample(StackWatch::SdkMqtt);
    switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_BEFORE_CONNECT:
        mqtt_transport_before_connect();
        break;
    case MQTT_EVENT_CONNECTED:
        s_discovery_owner_admitted_session.store(0, std::memory_order_release);
        s_discovery_owner_rx_active   = false;
        s_discovery_owner_uses_inbound_rx = false;
        s_inbound_rx_active               = false;
        s_discovery_owner_fragment_pending.store(false, std::memory_order_release);
        s_discovery_owner_configs.store(0, std::memory_order_relaxed);
        s_discovery_owner_last_data_ms.store(0, std::memory_order_release);
        s_discovery_owner_started_ms.store(static_cast<uint32_t>(esp_timer_get_time() / 1000),
                                           std::memory_order_release);
        s_discovery_owner_suback_lost.store(false, std::memory_order_release);
        s_discovery_owner_state.store(s_discovery_owner_required ? DiscoveryOwnerState::Pending
                                                                 : DiscoveryOwnerState::Encoded,
                                      std::memory_order_release);
        if (s_mqtt_ever_connected) s_mqtt_reconnects.fetch_add(1);   // a later CONNECTED is a RE-connect
        s_mqtt_ever_connected = true;
        // mqtt_task reconstructs retained-source cleanup once per CLIENT epoch. A reconnect of this
        // same handle preserves its in-flight QoS-1 outbox item and must not enqueue a duplicate.
        s_connected_client_epoch.store(s_mqtt_client_epoch.load(std::memory_order_acquire),
                                       std::memory_order_release);
        // Publish the connection flag after its epoch. An acquiring mqtt_task can never observe a
        // connected client with epoch zero and queue a tombstone whose returned id cannot be
        // tracked.
        s_connected.store(true, std::memory_order_release);
        s_connected_session_epoch.fetch_add(1, std::memory_order_release);
        s_announce                      = true;
        s_circulation_reconfigure       = true;
        s_circulation_probe_reconfigure = true;
        set_status(true, nullptr);
        diag_printf("mqtt: transport client connected\n");
        s_transport_connecting.store(false, std::memory_order_release);
        stack_watch_sample(StackWatch::SdkMqtt);
        break;
    case MQTT_EVENT_DISCONNECTED:
        s_connected           = false;
        s_heartbeat_announced = false;
        set_status(false, nullptr);
        {
            Lock lk(s_mtx);
            s_circulation_status.subscribed = false;
        }
        diag_printf("mqtt: disconnected (will retry)\n");
        s_transport_connecting.store(false, std::memory_order_release);
        break;
    case MQTT_EVENT_ERROR: {
        auto*       e   = static_cast<esp_mqtt_event_handle_t>(data);
        const char* why = "connection error";
        if (e && e->error_handle) {
            if (e->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT)
                why = "tls/tcp error";
            else if (e->error_handle->connect_return_code != MQTT_CONNECTION_ACCEPTED)
                why = "broker refused (auth/creds?)";
        }
        set_status(false, why);
        diag_printf("mqtt: %s\n", why);
        break;
    }
    case MQTT_EVENT_PUBLISHED: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        if (e &&
            !s_source_cleanup_evidence.push({s_mqtt_client_epoch.load(std::memory_order_acquire),
                                             e->msg_id, MqttCleanupDeliveryOutcome::Published}))
            s_source_cleanup_evidence_lost.store(true, std::memory_order_release);
        break;
    }
    case MQTT_EVENT_SUBSCRIBED: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        if (s_discovery_owner_required && e && (!e->client || e->client == s_client) &&
            !s_discovery_owner_subacks.push(
                {s_connected_session_epoch.load(std::memory_order_acquire), e->msg_id,
                 e->data && e->data_len == 1 && e->total_data_len == 1 &&
                         e->current_data_offset == 0 &&
                         (!e->error_handle ||
                          e->error_handle->error_type != MQTT_ERROR_TYPE_SUBSCRIBE_FAILED) &&
                         static_cast<unsigned char>(e->data[0]) <= 1
                     ? MqttCleanupDeliveryOutcome::Published
                     : MqttCleanupDeliveryOutcome::Deleted}))
            s_discovery_owner_suback_lost.store(true, std::memory_order_release);
        break;
    }
    case MQTT_EVENT_DELETED: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        if (e &&
            !s_source_cleanup_evidence.push({s_mqtt_client_epoch.load(std::memory_order_acquire),
                                             e->msg_id, MqttCleanupDeliveryOutcome::Deleted}))
            s_source_cleanup_evidence_lost.store(true, std::memory_order_release);
        break;
    }
    case MQTT_EVENT_DATA: {
        auto* e = static_cast<esp_mqtt_event_handle_t>(data);
        capture_discovery_owner_frame(e);
        capture_circulation_frame(e);
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

// The withdrawal path samples POD only; HpStats owns strings and cannot be copied safely
// before a low-heap source withdrawal. The cache owner already applies the exact monotonic grace.
static __attribute__((noinline)) MqttPublishGateDecision mqtt_cycle_gate(MqttPublishGateState state,
                                                                         bool& x10a_connected) {
    const HpMqttSourceState hp = hp_mqtt_source_state();
    x10a_connected             = hp.connected;
    return mqtt_publish_gate_step(state, hp.recent, s_connected.load());
}

static __attribute__((noinline)) bool crash_publication_changed() {
    const CrashInfo current = diag_crash_info_live();
    return current.coredump != s_crash_dump_pub || crash_is_notable(current) != s_crash_notable_pub;
}

// Publish task: announce on (re)connect / profile change, then publish both source JSON documents
// when they change. The per-cycle body is guarded — an OOM std::string build must skip the cycle,
// not throw through the FreeRTOS task and reboot the device. Keep the -Os helper boundaries bound
// to the ELF gate. Synchronous SDK writes can re-enter TLS certificate verification; builders and
// binding staging return before those writes. Static paths retain at least 1 KiB on the 7 KiB
// publisher stack; hardware minima are separate evidence.
static void mqtt_task(void*) {
    esp_task_wdt_add(NULL);                            // watch the publish task for a wedged broker write
    int heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S;    // publish immediately on the first connected cycle
    int ha_retire_elapsed_s = HA_RETIRE_INTERVAL_S;
    MqttPublishGateState publish_gate                 = MqttPublishGateState::Unavailable;
    uint32_t             availability_session_epoch   = 0;
    bool                 transport_online_accepted    = false;
    int                  source_availability_accepted = -1; // unknown / offline / online
    OtaQuiesceState network_quiesce;                   // current TLS operation's hold-off budget
    bool network_quiesce_logged     = false;           // one diag line per operation, not per cycle
    bool network_quiesce_cap_logged = false;           // and one if that budget ever runs out
    MqttTransportResumeState transport_resume;
    TaskFailureEpisode       failures;

    // Start one LWT-bearing transport immediately unless OTA already claimed the network
    // heap during startup; in that case mark the transport paused so mqtt_transport_resume_step()
    // starts it cleanly after the competing TLS window releases.
    if (mqtt_initial_start_deferred(transport_pause_requested(), competing_tls_active())) {
        s_transport_paused.store(true, std::memory_order_release);
    } else if (!start_current_client()) {
        transport_resume.wait_s = transport_resume.backoff_s;
    }
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
        // STAND ASIDE while an OTA operation owns the heap (legacy-380). Placed
        // above the try, before the first allocation of the cycle: everything below this point
        // builds std::strings, and on the heap a TLS session leaves behind, the largest of them is
        // what throws. Skipping the cycle on purpose costs the same second of data the bad_alloc
        // cost, spends none of the block the download needs, and — unlike the throw — says so in a
        // counter.
        //
        // The watchdog is fed ABOVE this, so a long download cannot false-trip it. The esp-mqtt
        // transport is cleanly stopped below as well: that removes MQTTS record churn and yields a
        // short deliberate broker gap without publishing the LWT, then the same client is resumed.
        // Only an OTA pause first retains `offline`, because an install restarts the board inside
        // that gap (mqtt_ota_withdraw_online()).
        // Bounded by logic/ota_quiesce.hpp — an operation that never finishes must not silence the
        // bridge for the rest of the boot.
        const bool ota_busy = ota_download_active();
        if (mqtt_network_hold_step(network_quiesce, ota_busy, network_quiesce_logged, delay_s))
            continue;
        if (mqtt_cleanup_evidence_recovery_step(delay_s)) continue;
        {
        MqttPublishActivity publish_activity;
        // The network owner has released its flag and pause request. Recreate esp-mqtt's transport
        // task before ordinary subscription/publish work resumes. MQTTS gets the same stable
        // contiguous-heap admission as the other TLS clients; direct start failures back off rather
        // than churning the just-fragmented heap every second.
        if (!mqtt_transport_resume_step(transport_resume, delay_s)) continue;
        // Not holding off this cycle — either no TLS operation is running, or the budget ran out
        // while one still is. Those two are worth telling apart in the log: the second means the
        // publisher is back to competing with a TLS session for the heap, so a `publish skipped` can
        // legitimately reappear and it is not a regression of this fix. Once per episode, then
        // rearmed when the operation ends.
        if (ota_quiesce_exhausted(network_quiesce, ota_busy)) {
            if (!network_quiesce_cap_logged) {
                diag_printf("mqtt: TLS hold-off budget spent after %u cycles, publishing again\n",
                            static_cast<unsigned>(OTA_QUIESCE_MAX_CYCLES));
                network_quiesce_cap_logged = true;
            }
        } else {
            network_quiesce_logged     = false;        // rearm both lines for the next operation
            network_quiesce_cap_logged = false;
        }

        // Before any Config/HpStats allocation, consume ACK evidence and withdraw stale X10A.
        // The accepted markers advance only on SDK acceptance and are reset for EVERY session.
        service_source_cleanup_evidence();
        bool                          x10a_connected = false;
        const MqttPublishGateDecision gate = mqtt_cycle_gate(publish_gate, x10a_connected);
        publish_gate                       = gate.next;
        const uint32_t session_epoch = s_connected_session_epoch.load(std::memory_order_acquire);
        if (s_connected && session_epoch != availability_session_epoch) {
            availability_session_epoch   = session_epoch;
            transport_online_accepted    = false;
            source_availability_accepted = -1;
            s_last_x10a_digest_valid     = false;
            s_x10a_publish_proven.store(false, std::memory_order_release);
            s_last_x10a_cache_gen = 0;
        }
        if (!gate.publish_cycle) {
            s_last_x10a_digest_valid = false;
            s_x10a_publish_proven.store(false, std::memory_order_release);
            s_last_x10a_cache_gen = 0;
        }
        if (s_connected && !s_x10a_publish_proven.load(std::memory_order_acquire) &&
            source_availability_accepted != 0 && mqtt_publish(s_x10a_avail, "offline", 0, 1, 1))
            source_availability_accepted = 0;
        if (s_connected && !transport_online_accepted && mqtt_publish(s_avail, "online", 0, 0, 1))
            transport_online_accepted = true;

        // Static literals only: a low-heap failure report must not allocate another string.
        const char* publish_stage = "config";
        try {
            publish_stage = "discovery ownership";
            service_discovery_owner_guard();
            service_discovery_admission_reset();
            publish_stage = "config";
            const uint32_t circulation_epoch =
                s_circulation_requested_epoch.load(std::memory_order_acquire);
            const Config cycle_config = config();
            publish_stage = "subscriptions";
            service_circulation_subscription(cycle_config, circulation_epoch);
            service_circulation_probe_subscription(cycle_config);
            service_circulation_frames(cycle_config);
            // The circulation witness is MQTT-owned and remains meaningful while X10A auto-detect
            // is backing off on a silent bus. Record it on this task's independent one-second tick;
            // tying it to hp_poll would leave /status.history.rows empty exactly in that case.
            if (cycle_config.diagnostics_enabled) history_record_circulation();
            const RetainedCleanupCycle cleanup_cycle =
                service_requested_topic_cleanup(cycle_config);
            // HA may have been offline for the connect-time tombstones. Repeat only the permanently
            // retired discovery deletes on this independent timer, outside X10A publication
            // authority, so a silent heat-pump bus cannot strand legacy entities after HA returns.
            // A pending/active source cleanup includes the same deletes and holds this timer;
            // only X10A state/discovery remains inside gate.publish_cycle below.
            publish_stage = "retire";
            if (s_connected) {
                if (cleanup_cycle.modbus || cleanup_cycle.weather) {
                    ha_retire_elapsed_s = 0;
                } else {
                    ha_retire_elapsed_s += delay_s;
                    if (ha_retire_elapsed_s >= HA_RETIRE_INTERVAL_S) {
                        if (!s_periodic_discovery_pending) request_periodic_discovery_retirement();
                        ha_retire_elapsed_s = 0;
                    }
                }
            }

            if (s_connected) {
                publish_stage = "announce";
                if (s_announce.exchange(false)) {              // consume: just (re)connected
                    request_periodic_discovery_retirement();
                    s_announced_profile.clear();               // force a fresh discovery below
                    s_last_x10a_digest = 0;                    // force full per-topic state re-seeds
                    s_last_x10a_digest_valid = false;
                    s_x10a_publish_proven.store(false, std::memory_order_release);
                    s_last_modbus_digest.clear();
                    s_last_x10a_cache_gen   = 0;
                    s_last_modbus_cache_gen = 0;
                    s_last_env3_digest.clear();
                    s_last_env3_samples = 0;
                    // Force the board/link diagnostic discovery to re-publish on THIS (re)connect. The
                    // disconnect handler also clears s_heartbeat_announced, but a DISCONNECT landing
                    // mid-discovery (after the check below, before the publishes finish) could leave it
                    // stuck true and skip discovery after the next reconnect. Tying the reset to the
                    // announce — set on EVERY connect — closes that race.
                    s_heartbeat_announced = false;
                    heartbeat_elapsed_s = HEARTBEAT_INTERVAL_S; // publish it right away, then every 10 s
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
                    // The raw-base crash record has independent ownership. A preserved-node
                    // discovery collision must not hold an old crash after a normal boot, or
                    // suppress this boot's notable record while HA migration remains pending.
                    publish_crash(false);
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
                    if (publish_heartbeat_discovery()) {
                        publish_crash(); // crash report if notable, else stale-record probe
                        s_heartbeat_announced = true;
                    }
                }
                // Only this source depends on the X10A observation boundary. Its cache marker
                // cannot advance on a refused write; recovery/reconnect force a fresh accepted
                // seed.
                publish_stage = "x10a";
                if (gate.publish_cycle) {
                    const std::string& prof           = cycle_config.profile;
                    bool               seed_attempted = false;
                    if (prof != "auto" && prof != s_announced_profile) {
                        if (publish_x10a_discovery()) s_announced_profile = prof;
                        if (x10a_connected && !s_last_x10a_digest_valid) {
                            seed_attempted = true;
                            if (publish_x10a_state(cycle_config, true))
                                s_last_x10a_cache_gen = hp_cache_generation();
                        }
                    }
                    if (x10a_connected && prof != "auto" && !seed_attempted) {
                        const uint32_t x10a_gen = hp_cache_generation();
                        if ((x10a_gen != s_last_x10a_cache_gen || !s_last_x10a_digest_valid) &&
                            publish_x10a_state(cycle_config, false))
                            s_last_x10a_cache_gen = x10a_gen;
                    }
                    // A slow SDK write may outlive the grace. Re-sample the source before claiming
                    // online, and retry a refused availability write without regenerating its
                    // payload.
                    if (s_x10a_publish_proven.load(std::memory_order_acquire) &&
                        hp_mqtt_source_state().recent && source_availability_accepted != 1 &&
                        mqtt_publish(s_x10a_avail, "online", 0, 1, 1))
                        source_availability_accepted = 1;
                }
                // prof == auto is not an X10A seed; independent sources below still publish.

                publish_stage = "modbus";
                if (!cleanup_cycle.modbus) {
                    const RetainedSourceAction modbus_action =
                        retained_source_action(mb_target_enabled(), s_modbus_disabled_cleaned);
                    if (modbus_action == RetainedSourceAction::PublishCurrent) {
                        // State publication is independent of Home Assistant discovery. This also
                        // starts correctly when MQTT connects before the separate Modbus task, or
                        // when Modbus is enabled dynamically through POST /set_hp. The atomically
                        // installed target intent — not a retiring task's status — prevents Off's
                        // tombstone from being replaced by retained `{}`. A-to-B remains enabled
                        // and may publish `{}` for the configured new source from the following
                        // cycle.
                        s_modbus_disabled_cleaned = false;
                        const uint32_t mb_gen     = mb_cache_generation();
                        if (mqtt_source_state_needs_publish(mb_gen, s_last_modbus_cache_gen,
                                                            mb_values_live(), s_last_modbus_live,
                                                            !s_last_modbus_digest.empty())) {
                            if (publish_modbus_state(s_last_modbus_live))
                                s_last_modbus_cache_gen = mb_gen;
                        }
                    } else if (modbus_action == RetainedSourceAction::DeleteRetained) {
                        // Covers a live POST /set_hp disable. Discovery and the duplicate status
                        // topic are already retired; admit the delete to the ACK-driven source
                        // queue.
                        s_modbus_cleanup_requested.store(true, std::memory_order_release);
                        s_last_modbus_cache_gen = 0;
                    }
                }

                publish_stage = "env3";
                if (!cleanup_cycle.env3) {
                    const bool env3_enabled =
                        cycle_config.env3_enabled && env3_board_supported(cycle_config);
                    if (env3_enabled) {
                        s_env3_disabled_cleaned = false;
                        if (!s_env3_discovery_announced) {
                            if (publish_env3_discovery()) {
                                s_env3_discovery_announced = true;
                                diag_printf("mqtt: ENV III HA discovery announced\n");
                            }
                        }
                        publish_env3_state();
                    } else if (!s_env3_disabled_cleaned) {
                        // Disabling the configured sensor removes its retained data topic and its
                        // three retained discovery configs through the ACK-driven source queue.
                        s_env3_cleanup_requested.store(true, std::memory_order_release);
                    }
                }

                // Fixed cadence for the board and transport heartbeat.
                publish_stage = "heartbeat";
                heartbeat_elapsed_s += delay_s;
                if (heartbeat_elapsed_s >= HEARTBEAT_INTERVAL_S) {
                    publish_heartbeat();
                    if (cycle_config.diagnostics_enabled) publish_heater_context();
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
                    if (crash_publication_changed()) publish_crash();
                    heartbeat_elapsed_s = 0;
                }
            }
            failures.succeeded();
        } catch (const std::exception& e) {
            // Count every failed cycle. Log the first failure with allocation-free INTERNAL
            // heap samples; a successful cycle rearms the next episode's diagnostic.
            s_mqtt_skipped.fetch_add(1, std::memory_order_relaxed);
            if (failures.first_failure())
                diag_printf("mqtt: publish skipped at %s (%s; free=%u B largest=%u B)\n",
                            publish_stage, e.what(),
                            static_cast<unsigned>(
                                heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL)),
                            static_cast<unsigned>(heap_largest_internal_block()));
        } catch (...) {
            s_mqtt_skipped.fetch_add(1, std::memory_order_relaxed);
            if (failures.first_failure())
                diag_printf("mqtt: publish skipped at %s (oom?; free=%u B largest=%u B)\n",
                            publish_stage,
                            static_cast<unsigned>(
                                heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL)),
                            static_cast<unsigned>(heap_largest_internal_block()));
        }
        }
        vTaskDelay(pdMS_TO_TICKS(delay_s * 1000));
    }
}

// Validate URI/credentials and build the single broker-LWT transport.
static bool build_client(const Config& c) {
    s_uri  = c.mqtt_uri;
    s_user = c.mqtt_user;
    s_pass = c.mqtt_pass;

    const bool has_scheme = s_uri.find("://") != std::string::npos;
    const bool is_tls     = s_uri.rfind("mqtts://", 0) == 0 || s_uri.rfind("wss://", 0) == 0;
    const bool has_creds  = !s_user.empty() || !s_pass.empty();
    if (!has_scheme) s_uri.insert(0, "mqtt://"); // bare host:port -> plaintext scheme

    // Credentials must never travel in cleartext (docs/SECURITY.md) — require mqtts, no fallback.
    if (has_creds && !is_tls) {
        set_status(false, "credentials require mqtts:// or wss:// (won't send them in cleartext)");
        diag_printf("mqtt: refusing plaintext broker with credentials — use mqtts://\n");
        return false;
    }

    esp_mqtt_client_config_t cfg = {};
    cfg.task.stack_size          = 6144; // pinned SDK default, explicitly bound to the ELF budget
    cfg.broker.address.uri = s_uri.c_str();
    if (is_tls) cfg.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.credentials.client_id = s_board.c_str();   // per-BOARD: a client id must be unique per connection
    if (!s_user.empty()) cfg.credentials.username = s_user.c_str();
    if (!s_pass.empty()) cfg.credentials.authentication.password = s_pass.c_str();
    cfg.session.keepalive         = 30;
    cfg.outbox.limit              = MQTT_OUTBOX_LIMIT_BYTES;
    {
        cfg.session.last_will.topic   = s_avail.c_str();
        cfg.session.last_will.msg     = "offline";
        cfg.session.last_will.msg_len = 7;
        cfg.session.last_will.qos     = 1;
        cfg.session.last_will.retain  = 1;
    }

    s_client = esp_mqtt_client_init(&cfg);
    if (!s_client) { set_status(false, "mqtt init failed"); return false; }
    if (esp_mqtt_client_register_event(s_client, static_cast<esp_mqtt_event_id_t>(MQTT_EVENT_ANY),
                                       on_mqtt, nullptr) != ESP_OK) {
        esp_mqtt_client_destroy(s_client);
        s_client = nullptr;
        set_status(false, "event registration failed");
        return false;
    }
    uint32_t client_epoch = s_mqtt_client_epoch.fetch_add(1, std::memory_order_acq_rel) + 1;
    if (client_epoch == 0) {
        client_epoch = 1;
        s_mqtt_client_epoch.store(client_epoch, std::memory_order_release);
    }
    {
        Lock lk(s_mtx);
        s_status.tls = is_tls;
    }
    return true;
}

static esp_err_t start_client_transport() { return esp_mqtt_client_start(s_client); }

static bool start_current_client() {
    if (!s_client) {
        set_status(false, "mqtt init failed");
        return false;
    }
    // Reset the status BEFORE the start. By the time start_client_transport() returns, esp-mqtt's
    // own task may already have delivered MQTT_EVENT_CONNECTED — a LAN broker answers within
    // milliseconds — and a status write here would overwrite that truth with "disconnected" until
    // some later reconnect. From the start on, only the event handler writes the connection state.
    set_status(false, "");
    const esp_err_t rc = start_client_transport();
    if (rc == ESP_OK) {
        s_client_running.store(true, std::memory_order_release);
        s_transport_paused.store(false, std::memory_order_release);
        return true;
    }
    set_status(false, "client start failed");
    diag_printf("mqtt: client start failed (%s)\n", esp_err_to_name(rc));
    // No task/session started. Keep this initialized client for the task's bounded resume retry.
    s_transport_paused.store(true, std::memory_order_release);
    s_client_running.store(false, std::memory_order_release);
    return false;
}

void mqtt_ha_start() {
    MqttStartupActivity startup_activity;
    const Config& c = config();
    s_x10a_publish_required.store(!c.mqtt_uri.empty(), std::memory_order_release);
    s_mtx = xSemaphoreCreateMutex();
    if (!s_mtx) {
        // HTTP is already serving /status, and the bridge writes std::strings (broker, the
        // circulation error text) that it copies. Without the mutex every such write would race a
        // reader, so the bridge stays off this boot rather than running unsynchronized; the
        // statuses keep their defaults, which no one writes.
        diag_printf("mqtt: status mutex alloc failed — MQTT bridge disabled this boot\n");
        return;
    }
    {
        // Under the lock even at startup: mqtt_status() and friends start locking the moment s_mtx
        // exists, and httpd was started before this bridge.
        Lock lk(s_mtx);
        s_status.configured             = !c.mqtt_uri.empty();
        s_status.broker                 = c.mqtt_uri;
        s_circulation_status.configured = !c.circulation_topic.empty();
        s_circulation_runtime_max_age_s = c.circulation_max_age_s;
    }
    // The circulation test shares std::strings with the HTTP task, so it also needs its own
    // hand-off semaphore; s_mtx is guaranteed above.
    s_circulation_probe_sem = xSemaphoreCreateBinary();
    if (!s_circulation_probe_sem)
        diag_printf("mqtt: circulation-source test semaphore alloc failed\n");
    if (!s_status.configured) return;

    // Preserve any concurrent OTA lease. The HTTP server may already have requested one.
    s_inbound_ring_produced = 0;
    s_inbound_ring_pos      = 0;
    s_inbound_ring_consumed.store(0, std::memory_order_release);
    s_inbound_queue = xQueueCreate(CIRCULATION_QUEUE_DEPTH, sizeof(CirculationMqttFrameQueued));
    if (!s_inbound_queue) {
        Lock lk(s_mtx);
        s_circulation_status.error = "receive queue alloc failed";
        s_circulation_status.errors++;
        diag_printf("mqtt: circulation receive queue alloc failed\n");
    }

    // Resolved ONCE, here, because every topic root and the HA node id below derive from it — a
    // second copy of the empty-means-default rule is how one of them would end up on another base.
    s_base  = mqtt_base_effective(c.mqtt_base, CONFIG_DAIKIN_MQTT_BASE_TOPIC);
    s_node  = device_node_id(s_base); // HA device id: the installation, NOT this board
    s_board = board_id();             // complete hardware MAC: MQTT client id + secondary dev.ids
    if (s_board.empty()) {
        set_status(false, "board MAC read failed");
        return;
    }
    s_prefix = CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX;
    s_discovery_owner_required = mqtt_preserved_discovery_base(s_base);
    for (size_t k = 0; k < 2; ++k) {
        auto& f = s_discovery_owner_filters[k];
        f       = s_prefix;
        f += "/+/";
        f += s_node;
        f += k ? "_modbus/+/config" : "/+/config";
    }
    s_discovery_owner_state.store(s_discovery_owner_required ? DiscoveryOwnerState::Pending
                                                             : DiscoveryOwnerState::Encoded,
                                  std::memory_order_release);
    struct BaseTopicInit {
        uint8_t     slot;
        const char* suffix;
    };
    static constexpr BaseTopicInit kBaseTopics[] = {
        {12, "/status"},                     // s_avail
        {13, "/x10a/status"},                // s_x10a_avail
        {14, "/x10a"},                       // s_x10a
        {15, "/modbus"},                     // s_modbus
        {16, "/weather/openmeteo/forecast"}, // s_retired_forecast
        {18, "/weather_forecast"},           // s_retired_weather
        {19, "/modbus/status"},              // s_retired_modbus_status
        {20, "/state"},                      // s_legacy_state
        {21, "/heartbeat"},                  // s_heartbeat
        {22, "/crash"},                      // s_crash
        {29, "/heater/buh"},                 // s_heater_buh_topic
        {30, "/heater/bsh"},                 // s_heater_bsh_topic
    };
    for (const auto& t : kBaseTopics) {
        std::string& dst = s_mqtt_strings[t.slot];
        dst              = s_base;
        dst += t.suffix;
    }
    s_env3 = env3_topic(s_base);
    if (!build_client(c)) return; // policy error already surfaced
    // The task starts the LWT transport without waiting for any observation source.
    set_status(false, "");
    // Hardware coredump: the 4 KiB task hit the ESP32-S3 stack-end watchpoint while building the
    // heartbeat after Config gained the observer configuration. heartbeat.hpp no longer creates
    // chained temporary strings. Seven KiB covers the reviewed synchronous TLS publish path;
    // payload builders return before entering the SDK transport.
    if (xTaskCreate(mqtt_task, "mqtt_pub", 7168, nullptr, TASK_PRIO_MQTT, nullptr) != pdPASS) {
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

void mqtt_transport_pause_for_network_heap() {
    uint32_t cur = s_transport_pause_state.load(std::memory_order_acquire);
    for (;;) {
        const uint32_t owners = cur & TRANSPORT_PAUSE_OWNER_MASK;
        if (owners == TRANSPORT_PAUSE_OWNER_MASK) return;
        uint32_t next = (cur & ~TRANSPORT_PAUSE_OWNER_MASK) | (owners + 1);
        if (next & TRANSPORT_PAUSE_WITHDRAW_STAGED)
            next = (next & ~TRANSPORT_PAUSE_WITHDRAW_STAGED) | TRANSPORT_PAUSE_WITHDRAW_ARMED;
        if (s_transport_pause_state.compare_exchange_weak(cur, next, std::memory_order_acq_rel,
                                                          std::memory_order_acquire))
            return;
    }
}

void mqtt_transport_resume_after_network_heap() {
    uint32_t cur = s_transport_pause_state.load(std::memory_order_acquire);
    while ((cur & TRANSPORT_PAUSE_OWNER_MASK) > 0) {
        const uint32_t owners = cur & TRANSPORT_PAUSE_OWNER_MASK;
        uint32_t       next   = (cur & ~TRANSPORT_PAUSE_OWNER_MASK) | (owners - 1);
        if (owners == 1) next &= ~TRANSPORT_PAUSE_WITHDRAW_ARMED;
        if (s_transport_pause_state.compare_exchange_weak(cur, next, std::memory_order_acq_rel,
                                                          std::memory_order_acquire))
            return;
    }
}

void mqtt_transport_withdraw_online_on_pause() {
    s_transport_pause_state.fetch_or(TRANSPORT_PAUSE_WITHDRAW_STAGED, std::memory_order_acq_rel);
}

bool mqtt_transport_network_quiesced() {
    return !s_client_running.load(std::memory_order_acquire) ||
           s_transport_paused.load(std::memory_order_acquire);
}

CirculationSourceStatus circulation_source_status(const Config& c) {
    CirculationSourceStatus st;
    if (s_mtx) {
        Lock lk(s_mtx);
        if (circulation_request_current_locked(
                s_circulation_requested_epoch.load(std::memory_order_acquire), c))
            st = s_circulation_status;
    }
    st.configured = !c.circulation_topic.empty();
    const uint64_t now_ms = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t now_unix_s = -1;
    int32_t now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    const MqttSourceFreshness freshness =
        mqtt_source_freshness(st.has_value, st.retained, st.has_source_time, st.source_unix_s,
                              st.received_ms, now_unix_s, now_ms, c.circulation_max_age_s);
    st.fresh = freshness.fresh;
    st.age_known = freshness.age_known;
    st.age_s = freshness.age_s;
    st.freshness_reason = freshness.reason ? freshness.reason : "no_value";
    if (!st.fresh) st.state = CirculationPowerState::Unknown;
    return st;
}

uint32_t circulation_source_generation() {
    return s_circulation_requested_epoch.load(std::memory_order_acquire);
}

CirculationPumpSample circulation_pump_sample() {
    // Poll-task hot path: copy only POD under the MQTT mutex. Calling circulation_source_status()
    // here would copy several std::strings plus the whole Config every sweep, creating permanent
    // heap churn merely to obtain two booleans. The applied-epoch check alone withdraws a replaced
    // source as soon as its reconfiguration is requested, so no Config snapshot is needed here.
    bool configured = false, has_value = false, retained = false, has_source_time = false;
    uint64_t received_ms = 0;
    int64_t source_unix_s = -1;
    uint32_t max_age_s = CIRC_SOURCE_MAX_AGE_DEFAULT_S;
    CirculationPowerState state = CirculationPowerState::Unknown;
    {
        Lock           lk(s_mtx);
        const uint32_t requested = s_circulation_requested_epoch.load(std::memory_order_acquire);
        if (!circulation_epoch_current_locked(requested)) return {false, false, false};
        configured      = s_circulation_capture_enabled && s_circulation_status.configured;
        has_value       = s_circulation_status.has_value;
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
    const bool fresh = mqtt_source_freshness(has_value, retained, has_source_time, source_unix_s,
                                             received_ms, now_unix_s, now_ms, max_age_s)
                           .fresh;
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
        s_circulation_probe.clock  = {};
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
        s_circulation_probe_capture_generation.store(generation, std::memory_order_release);
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
    const uint64_t now_ms     = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    int64_t        now_unix_s = -1;
    int32_t        now_sub_ms = 0;
    time_now(now_unix_s, now_sub_ms);
    Lock lk(s_mtx);
    return s_circulation_probe.passed && s_circulation_probe.generation == proof &&
           s_circulation_probe.clock.current(now_unix_s, now_ms, candidate.max_age_s) &&
           s_circulation_probe.config.topic == candidate.topic &&
           s_circulation_probe.config.power_path == candidate.power_path &&
           s_circulation_probe.config.timestamp_path == candidate.timestamp_path &&
           s_circulation_probe.config.max_age_s == candidate.max_age_s &&
           s_circulation_probe.config.on_tenths_w == candidate.on_tenths_w &&
           s_circulation_probe.config.off_tenths_w == candidate.off_tenths_w &&
           s_circulation_probe.config.confirm_s == candidate.confirm_s;
}

void mqtt_circulation_set_diagnostics(bool configured) {
    Lock     lk(s_mtx);
    uint32_t next = s_circulation_requested_epoch.load(std::memory_order_relaxed) + 1;
    s_circulation_requested_epoch.store(next ? next : 1, std::memory_order_release);
    s_circulation_reconfigure       = true;
    s_circulation_probe_reconfigure = true;
    if (lk.acquired()) {
        reset_circulation_status_locked(configured);
        s_circulation_probe.active = false;
        s_circulation_probe.passed = false;
        s_circulation_probe_capture_generation.store(0, std::memory_order_release);
    }
}

void mqtt_circulation_reconfigure(bool configured) {
    {
        Lock     lk(s_mtx);
        uint32_t next = s_circulation_requested_epoch.load(std::memory_order_relaxed) + 1;
        s_circulation_requested_epoch.store(next ? next : 1, std::memory_order_release);
        s_circulation_reconfigure       = true;
        s_circulation_probe_reconfigure = true;
        // Without the mutex no task publishes a status; leave the defaults and the probe untouched
        // rather than writing state a poll-task reader could observe unsynchronised.
        if (lk.acquired()) {
            reset_circulation_status_locked(configured);
            s_circulation_probe.active = false;
            s_circulation_probe.passed = false;
            s_circulation_probe_capture_generation.store(0, std::memory_order_release);
        }
    }
    // Withdraw the old witness first, then change consumer identity without nesting their locks.
    checkup_dhw_reset();
    history_circulation_reset();
}

void mqtt_request_modbus_cleanup() { s_modbus_cleanup_requested = true; }

uint32_t mqtt_retirement_evidence() noexcept {
    return s_retirement_evidence.load(std::memory_order_acquire);
}

} // namespace daik
