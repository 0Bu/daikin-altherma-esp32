// Home Assistant MQTT-Discovery bridge (see mqtt_ha.hpp + docs/ARCHITECTURE.md → MQTT bridge).
// esp-mqtt client in its own publish task:
//   • TLS policy: credentials present ⇒ mqtts:// + CA-verified (esp_crt_bundle); NEVER send
//     credentials over plaintext (no silent fallback — refuse with an error in /status.mqtt).
//   • On (re)connect: mark availability "online", stream one retained discovery config per value of
//     the active profile (logic/discovery.hpp) — a bit-flag row as a `binary_sensor` reading 1/0,
//     every other row as a `sensor` — then publish the full grouped state JSON.
//   • Each cycle: rebuild the grouped state JSON (logic/mqtt_group.hpp) and publish it to the ONE
//     shared topic <base>/state — but only when the payload actually changed, so a quiet pump doesn't
//     spam the broker. Message topics sit directly under <base> — one board per base topic; the node
//     id identifies the DEVICE only in each discovery config's uniq_id/dev.ids + the
//     <prefix>/<component>/<node>/<group>_<object_id> discovery topic. That node id is derived from
//     the BASE TOPIC (logic/ha_device.hpp), not from the board's MAC, so replacing the ESP32 keeps
//     ONE HA device and its entities; this board's MAC-derived id stays on as the MQTT client id and
//     a second dev.ids entry (HA merges on it, so an install upgrading from a MAC-identified build
//     keeps its device). The entity id carries the REGISTER GROUP because uniq_id and the discovery
//     topic are flat namespaces while a label is unique only within its page (#221). The configs an
//     older build published under a superseded identity — the MAC node id, and the un-grouped entity
//     ids — are retracted in one pass before any replacement goes out.
//   • Every HEARTBEAT_INTERVAL_S (10 s): rebuild + publish the board/link diagnostics JSON
//     (logic/heartbeat.hpp) to <base>/heartbeat — diagnostics, not real-time telemetry, so unlike the
//     state topic it's a fixed cadence, not publish-on-change.
//   • Once per (re)connect: RETAIN the boot-time crash summary (logic/crashinfo.hpp) on <base>/crash
//     ONLY when the reset was a real fault or a core-dump is still in flash; a normal boot clears the
//     topic (zero-length retained) so no crash message lingers once the problem is resolved. When a
//     crash IS reported it drives one diagnostic HA entity — a "dump waiting" flag (the reset reason
//     is the heartbeat's own "Reset Reason" sensor, so a crash entity for it would be a duplicate).
//     Reason/backtrace only; never the raw dump or any secret.
// Read-only: no command subscriptions. No-op if mqtt_uri is empty. Memory-safe: discovery is one
// small publish per value; the state JSON is a single few-KB build, guarded against OOM.
#include "mqtt_ha.hpp"
#include "config.hpp"
#include "def/overlay.hpp"
#include "def/registry.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "hp_poll.hpp"
#include "logic/availability.hpp"
#include "logic/convert.hpp"   // conv_is_binary, published_kind — a row's wire type and entity domain
#include "logic/crashinfo.hpp"
#include "logic/conv_override.hpp"
#include "logic/discovery.hpp"
#include "logic/fault_state.hpp"
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
static std::string s_uri, s_user, s_pass, s_node, s_board, s_base, s_prefix, s_avail, s_state,
                   s_heartbeat, s_crash;
static std::string s_announced_profile;               // profile we last published discovery for (mqtt_task only)
static std::string s_last_json;                       // last state JSON published (dedup guard; mqtt_task only)
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
static bool         s_crash_dump_pub      = false;     // mqtt_task-only: `coredump` flag last published on s_crash

// Cumulative publish counters for the heartbeat's mqtt_{count,fails,reconnects} — see mqtt_publish().
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

// This BOARD's own id, daikin_<mac3> (STA MAC low 3 bytes). It is the MQTT client id (which must be
// unique per connection — two boards briefly online during a swap must not kick each other off the
// broker) and a second `dev.ids` entry so HA merges an install that was set up under the old
// MAC-based identity into the one device. It is NOT the HA device id any more: that is s_node,
// derived from the base topic (logic/ha_device.hpp), so replacing the ESP32 keeps the device.
static std::string board_id() {
    uint8_t m[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, m);
    char b[20];
    std::snprintf(b, sizeof(b), "daikin_%02x%02x%02x", m[3], m[4], m[5]);
    return b;
}

// Every outbound publish funnels through here so the heartbeat's mqtt_count/mqtt_fails reflect
// every discovery/state/heartbeat/availability message, not just one of them. esp_mqtt_client_publish() returns the message id (>=0) on success
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

// Current publishable values from the poll cache, grouped by register page. The scratch buffer is
// sized to the active profile's row count — an exact upper bound on the cached value count, so
// nothing is truncated out of the JSON without over-allocating a fixed worst case.
//
// `out` is reserved to that count PLUS the derived companions, counted in a first pass rather than
// assumed. The companions are not cached rows, so reserving the snapshot count alone leaves the
// vector one entry short on every profile that carries an error class — and this runs on the publish
// task once a SECOND for the life of the device, so the shortfall is a grow/copy/free of a vector of
// three-std::string elements every cycle, forever. That is precisely the incremental-realloc churn
// hp_poll's own `fresh.reserve(view.count())` exists to avoid, on a heap whose binding limit is the
// largest contiguous block. Counting conv-203 rows is ~116 integer compares; the allocation it
// avoids is not.
//
// Two rows are dropped here rather than published:
//   • no value this cycle (the register timed out, or the reading was refused by the plausibility
//     envelope / the availability ledger) — absence, stated by absence;
//   • a HELD-OVER reading (#209 defect 5): the outdoor unit is resting and answering with its last
//     run's numbers. Republishing those in a fresh payload is what made an hours-old outdoor
//     temperature look freshly observed to every consumer downstream. The heartbeat's
//     bus_ou_held_over says WHY the field went away, so this reads as a resting unit and not as a
//     broken link.
static std::vector<GroupedValue> current_grouped() {
    const size_t cap = def::lookup_view(config().profile.c_str()).count();
    std::vector<CachedValue> cache(cap ? cap : 1);
    const size_t n = hp_values_snapshot(cache.data(), cache.size());
    std::vector<GroupedValue> out;
    size_t cap_out = n;                                    // + the companions each error class adds
    for (size_t i = 0; i < n; i++)
        if (cache[i].conv == 203) cap_out += FAULT_COMPANION_COUNT;
    out.reserve(cap_out);
    for (size_t i = 0; i < n; i++) {
        if (cache[i].value.empty()) continue;
        if (cache[i].held) continue;
        const char* group = group_for_page(cache[i].reg);
        out.push_back({group, object_id(cache[i].label.c_str()), cache[i].value,
                       published_kind(cache[i].conv)});
        // A textual error class also publishes its permanently-numeric companions, so a metrics
        // consumer that cannot store "U4" still sees the fault go active (#209 defect 4). Derived
        // from the class, in the class's own group; an unreadable class publishes neither rather than
        // asserting "no fault" on a byte nobody could decode.
        if (cache[i].conv == 203) {
            const FaultClass fc = fault_class_from_text(cache[i].value.c_str());
            if (fault_companions_publishable(fc))
                for (size_t k = 0; k < FAULT_COMPANION_COUNT; k++)
                    out.push_back({group, FAULT_COMPANIONS[k].key, fault_companion_state(k, fc),
                                   PublishedKind::Number});
        }
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
    s_legacy_fixed_retracted = true;
    if (s_board == s_node) return;     // ids coincide -> there is no separate legacy identity
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++)
        mqtt_publish(heartbeat_discovery_topic(s_prefix, s_board, HEARTBEAT_SENSORS[i]), "", 0, 0, 1);
    for (int i = 0; i < CRASH_SENSOR_COUNT; i++)
        mqtt_publish(crash_discovery_topic(s_prefix, s_board, CRASH_SENSORS[i]), "", 0, 0, 1);
    for (int i = 0; i < RETIRED_CRASH_SENSOR_COUNT; i++)
        mqtt_publish(crash_discovery_topic(s_prefix, RETIRED_CRASH_SENSORS[i].component, s_board,
                                           RETIRED_CRASH_SENSORS[i].object_id), "", 0, 0, 1);
    diag_printf("mqtt: retired legacy HA device %s (now %s)\n", s_board.c_str(), s_node.c_str());
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

// Both migrations at once, as ONE pass that completes before any replacement config is published.
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
    s_stale_values_profile = profile_id;
}

// Stream one retained discovery config per value of the active profile. Every entity points at the
// one shared state topic (s_state) and pulls its value out via a value_template. A bit-flag row lands
// under the binary_sensor component, everything else under sensor (logic/discovery.hpp ha_component).
static void publish_discovery() {
    const std::string profile_id = config().profile;
    // The VIEW, not the raw profile: every row hp_poll caches needs a discovery config, and the
    // page-0x10 supplement (def/overlay.hpp) is part of that row set. Announcing fewer rows than the
    // state topic carries would leave the extra values in MQTT with no HA entity to land in.
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
        const std::string cfg = discovery_config(s_node, s_board, s_state, s_avail, d);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
        // The DERIVED numeric fault flags that ride beside a textual error class (#209 defect 4).
        // Announced here, from the same row loop that publishes the class itself, so the entity set
        // and the payload cannot drift apart — current_grouped() emits these keys for exactly the
        // rows this branch announces.
        if (d.conv == 203) {
            const std::string group = group_for_page(d.reg);
            for (size_t k = 0; k < FAULT_COMPANION_COUNT; k++) {
                const FaultCompanion& c = FAULT_COMPANIONS[k];
                mqtt_publish(companion_discovery_topic(s_prefix, s_node, group, c.key),
                             companion_discovery_config(s_node, s_board, s_state, s_avail, group, c)
                                 .c_str(),
                             0, 0, 1);            // retained
            }
        }
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
    if (!s_legacy_fixed_retracted) retract_legacy_fixed();   // delete the old ids FIRST
    for (int i = 0; i < HEARTBEAT_SENSOR_COUNT; i++) {
        const HeartbeatSensor& s = HEARTBEAT_SENSORS[i];
        const std::string ct  = heartbeat_discovery_topic(s_prefix, s_node, s);
        const std::string cfg = heartbeat_discovery_config(s_node, s_board, s_heartbeat, s_avail, s);
        mqtt_publish(ct, cfg.c_str(), 0, 0, 1);   // retained
    }
}

// Crash/reset diagnostics (logic/crashinfo.hpp): delete any retired entity, stream the discovery
// config for the "dump waiting" binary_sensor, then
// publish <base>/crash — but ONLY when the last reset is NOTABLE (a real fault OR an orphan core-dump
// still in flash). A normal boot (USB re-enumeration, config-save / OTA reboot, clean power-on) is
// not a crash, so build_crash_mqtt_payload() returns "" and we publish a zero-length RETAINED message
// that CLEARS the topic: no crash message is sent when nothing crashed, and a stale crash record
// disappears from the broker (and HA) as soon as the device reboots cleanly — i.e. once the problem
// is resolved. The reset reason is still surfaced (unconditionally) by the heartbeat's own "Reset
// Reason" sensor, so clearing here loses nothing. Retained so a late subscriber still sees a live
// crash; captured once at boot (diag_crash.cpp) so the summary never changes at runtime. Never
// carries secrets or the raw dump — just the reason + a raw-hex backtrace; the binary stays behind
// GET /coredump.
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
    // /coredump?clear=1 while the device runs turns an orphan-dump boot NOT-notable, so this then
    // publishes "" and clears the retained topic (a stale true would otherwise be replayed forever).
    const CrashInfo   ci = diag_crash_info_live();
    const std::string js = build_crash_mqtt_payload(ci);   // "" when not notable -> clears the topic
    mqtt_publish(s_crash, js.c_str(), static_cast<int>(js.size()), 0, 1);   // retained (zero-len clears)
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
    // One cached boot reason (diag_crash.cpp), three renderings: the slug a human reads, the raw
    // code a metrics store can keep, and the fault flag an alert fires on. Bound once so all three
    // are demonstrably the same reading rather than three lookups that only look identical.
    const CrashInfo& boot = diag_crash_info();
    f.reset_reason      = reset_reason_name(boot.reason);
    f.reset_reason_code = boot.reason;
    f.reset_fault       = crash_reason_is_fault(boot.reason);
    if (time_synced()) {
        int64_t unix_s; int32_t ms;
        time_now(unix_s, ms);
        f.time = rfc3339_utc(unix_s, ms);
    }
    f.wifi_connected  = wi.connected;
    f.wifi_rssi       = wi.rssi;
    f.wifi_reconnects = wifi_reconnect_count();
    // Pre-render the MAC strings here (keeps logic/heartbeat.hpp IDF-free, same as `time`). The STA's
    // own MAC is always present; the AP BSSID only while associated ("" -> JSON null, like /status).
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
    f.ou_held_over    = hp.ou_held_over;

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
                    publish_crash();                            // crash report if notable, else clears the topic
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
                    // Dump Waiting" ON until the next reconnect (and, for an orphan-dump-only boot,
                    // leave a stale crash record no longer backed by anything). Re-check on the
                    // heartbeat cadence (one 4-byte flash read, no summary parse) and republish only
                    // on a real change — publish_crash() then re-decides notability and clears the
                    // topic if the boot is no longer notable.
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
    cfg.credentials.client_id = s_board.c_str();   // per-BOARD: a client id must be unique per connection
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

    s_base   = CONFIG_DAIKIN_MQTT_BASE_TOPIC;
    s_node   = device_node_id(s_base);   // HA device id: the installation, NOT this board
    s_board  = board_id();               // this board: MQTT client id + dev.ids merge key
    s_prefix = CONFIG_DAIKIN_MQTT_DISCOVERY_PREFIX;
    s_avail     = availability_topic(s_base);
    s_state     = state_topic(s_base);
    s_heartbeat = heartbeat_topic(s_base);
    s_crash     = crash_topic(s_base);

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
