#pragma once
// Board/link "heartbeat" — technical diagnostics (free heap, uptime, WiFi signal/reconnects, MQTT
// publish stats, X10A bus counters) published periodically to a separate MQTT topic, distinct from
// the heat-pump state JSON (logic/mqtt_group.hpp). Pure string building, IDF-free, host-tested
// (test/test_logic.cpp). Mirrors the "device diagnostics" pattern other ESP32 HA bridges expose
// on their own `<base>/heartbeat` topic: link status, free memory, RSSI, rx failures, uptime.
#include <cstdint>
#include <cstdio>
#include <string>
#include "ha_device.hpp"   // device_json — one X10A HA device across values/diagnostics/crash
#include "json.hpp"        // json_append_escaped

namespace daik {

// Snapshot of everything the heartbeat payload reports. Gathered on the device from wifi_info(),
// wifi_reconnect_count(), hp_stats(), the mqtt task's own publish counters, and the IDF heap/timer
// APIs; nothing here touches hardware.
struct HeartbeatFields {
    std::string version;
    std::string platform;
    uint64_t    uptime_ms     = 0;   // monotonic ms since boot; uptime_s + the "Ddd+HH:MM:SS.mmm"
                                      // display string are both derived from this in the JSON builder
    uint32_t    free_heap     = 0;   // esp_get_free_heap_size()
    uint32_t    min_free_heap = 0;   // esp_get_minimum_free_heap_size() — worst-case low-water mark
    uint32_t    max_alloc     = 0;   // heap_caps_get_largest_free_block() — the binding OOM limit
    // HOW MANY CONSECUTIVE HEAP-WATCHDOG RESTARTS preceded this boot (heap_guard_restarts(); 0 on an
    // ordinary one). Already on /status.sys, and it belongs here for the reason reset_reason_code
    // does: without it a self-restarting board is INDISTINGUISHABLE in a metrics store from a
    // healthy one somebody keeps saving settings on. The restart heap_guard.cpp makes is an
    // esp_restart(), so it reports the same "sw" reset reason a /set_* save produces and
    // `reset_fault` stays 0 — every other field in this payload agrees that nothing went wrong. A
    // board cycling through its restart ladder every five minutes would show as a sawtooth in
    // uptime_s and nothing else, which is the same "reboot nobody can attribute" that #215 spent a
    // week reconstructing from syslog.
    //
    // NOT `total_increasing`: this is a per-boot CONSTANT, not a counter. It reports the count the
    // boot inherited and heap_guard_begin() clears the breadcrumb, so it reads 2 for the whole life
    // of the third boot in a ladder and 0 for the whole life of the next healthy one.
    uint8_t     heap_restarts = 0;
    // THE OTHER MEMORY BUDGET (stack_watch.hpp). Bytes free at the worst point since boot, per
    // watched task; 0 = never sampled and is rendered as JSON null, never as a number — a task that
    // has not run is not a task with no stack left, and the Modbus slot stays 0 forever on the
    // majority of boards that have no HomeHub.
    //
    // Payload-only, no HA entity, like the modbus_* block below and for the same reason: this is a
    // developer/fleet diagnostic whose value is the TREND across firmware versions, and five more
    // diagnostic entities in HA would be five more things a reader has to rule out. The trend is
    // what nothing could see before — every one of the three shipped overflows was read off a core
    // dump's task table AFTER the board died, and #318's 1200 bytes of frame growth accumulated
    // across releases with no single change announcing it.
    uint32_t    httpd_stack_min_free_bytes  = 0;
    uint32_t    poll_stack_min_free_bytes   = 0;
    uint32_t    mqtt_stack_min_free_bytes   = 0;
    uint32_t    weather_stack_min_free_bytes = 0;
    std::string reset_reason;         // reset_reason_name() slug — why the device last booted
    // The SAME answer as a NUMBER. The slug above is the readable one and stays, but a metrics
    // consumer never sees it: Telegraf's json parser takes numeric fields only, so `reset_reason` is
    // dropped on the way to VictoriaMetrics exactly like a bool is (the reason the three connectivity
    // flags below are 1/0). Measured on this install: a board restarting 55x in 7 days, 5 of them
    // panics, and not one restart was attributable in the store — the distribution had to be
    // reconstructed from syslog (#215). `reset_reason_code` is the raw CrashReason value, the same
    // number /status.last_crash already publishes as `reason_code`, so there is one vocabulary and no
    // second table; `reset_fault` is crash_reason_is_fault() as 1/0, because "was the last boot a
    // FAULT" is the question an alert actually asks and it must not require the consumer to carry a
    // copy of the code list. Deliberately NOT a new HA entity: the "Reset Reason" text sensor already
    // says this to a human, and a numeric twin beside it is the duplicate that got the crash topic's
    // "Last Reset Reason" retired.
    uint32_t    reset_reason_code = 0;
    bool        reset_fault       = false;

    bool        wifi_connected  = false;
    int8_t      wifi_rssi       = 0;   // valid only if wifi_connected
    uint32_t    wifi_reconnects = 0;   // cumulative since boot (wifi_reconnect_count())
    // Pre-rendered "AA:BB:CC:DD:EE:FF" MAC strings so this header stays IDF-free: wifi_mac is this
    // STA's own MAC (always present); wifi_bssid is the associated AP's MAC
    // ("" while offline -> JSON null, since there is no AP). Both let an HA/Telegraf consumer pin a
    // heartbeat to a specific board and see which AP it roamed onto — the /status.wifi.mac/.bssid
    // pair, now on the diagnostics stream too.
    std::string wifi_mac;
    std::string wifi_bssid;

    // WHICH TRANSPORT carries the device (logic/net_link.hpp's NetLink as its raw number: 0 none,
    // 1 wifi, 2 eth), plus whether a wired controller is present and negotiated. A NUMBER for the
    // reason reset_reason_code is one — Telegraf keeps numeric fields and drops strings — and it is
    // here rather than only on /status because without it a wired board reads as permanently
    // OFFLINE in a metrics store: wifi_connected sits at 0 forever, truthfully, while the device is
    // up and publishing the very series that say so. Nothing else in this payload can distinguish
    // "no network" from "a network with no radio in it".
    //
    // Deliberately NO new HA entity for any of the three: a wired install is the minority case, and
    // the transport is already visible where it matters (the dashboard's ESP32 card, /status.net).
    // An entity that reads "wifi" on every existing board forever is one more thing to rule out,
    // which is exactly the test that retired "Device Time" and "WiFi Quality".
    uint8_t     net_link      = 0;
    bool        eth_present   = false;
    bool        eth_link      = false;

    bool        mqtt_connected  = false;
    uint32_t    mqtt_count      = 0;   // successful publishes (state+heartbeat+heating_curve+discovery)
    uint32_t    mqtt_fails      = 0;   // cumulative failed esp_mqtt_client_publish() calls
    uint32_t    mqtt_reconnects = 0;   // cumulative RE-connects (excludes the first-ever connect)
    // WHAT NEVER GOT PUBLISHED, and why — the counters #380 was opened for. `mqtt_fails` above counts
    // a failed publish CALL; neither of these ever reached one, so until now the loss was invisible
    // outside a `/diag` ring that the next chatty boot overwrites. Both count cycles of the 1 s
    // publish task, so either against uptime_s reads directly as "fraction of seconds this board had
    // nothing to say".
    //
    // mqtt_skipped  — the cycle THREW (std::bad_alloc; the task guard caught it) and the reading is
    //                 gone. The wired board logged 337 of these in 30 days, 125 in the last of them,
    //                 every one immediately before an OTA reboot.
    // mqtt_quiesced — the cycle stood aside DELIBERATELY because an OTA/weather TLS operation
    //                 owned the heap
    //                 (logic/ota_quiesce.hpp). Same missing second, stated reason.
    //
    // Kept as two counters rather than one "cycles lost" precisely so the fix is legible in the
    // store: the intended shape after #380 is `quiesced` stepping once per install while `skipped`
    // stops rising at all, and a combined counter could not tell that from no change whatsoever.
    uint32_t    mqtt_skipped    = 0;
    uint32_t    mqtt_quiesced   = 0;

    // The same question asked of the X10A poll task, and the WORSE half of it: a skipped publish
    // drops a value that was read, a skipped poll means the read never happened — so history.cpp
    // records a NO_READING indistinguishable from a bus fault, and the bus counters below stay
    // silent because nothing was attempted. 32 of these in the same 30 days.
    uint32_t    poll_skipped   = 0;

    bool        bus_connected  = false;   // hp_stats().connected — X10A link up this cycle
    char        bus_proto      = '?';
    int         registers      = 0;
    int         values         = 0;
    uint32_t    crc_err        = 0;
    uint32_t    timeout_err    = 0;
    int32_t     last_ok_s      = -1;      // seconds since last cycle with any valid X10A reply
    uint32_t    rx_received    = 0;       // cumulative successful register reads (HpStats.rx_ok)
    uint32_t    rx_fails       = 0;       // cumulative failed reads (HpStats.rx_fail_total)
    // SOURCE freshness, which is a different question from publish freshness (#209 defect 5). The
    // outdoor unit refreshes its OWN pages only while it runs (logic/ou_stale.hpp); stopped, it keeps
    // answering with the last run's numbers. The bridge withholds those readings from the state
    // topic, so a consumer sees the field disappear — and this flag is what tells it WHY, without a
    // per-field timestamp in a payload published every second. "The device is publishing, the bus is
    // healthy, and the outdoor unit is simply not measuring right now" is otherwise indistinguishable
    // from a broken link on the consumer's side.
    bool        ou_held_over   = false;

    // The HomeHub Modbus stack (issue #32) — a SECOND, INDEPENDENT source, so these are its OWN
    // counters and say nothing about the X10A bus above (that is the point: the two fail separately).
    // All zero on a device without a HomeHub, which is a real fleet/config distinction rather than
    // the always-constant kind that got bus_tx_writes dropped. There are no write counters and no
    // actuator fields: the link issues no Modbus write at all (#294 retired the register-54 write
    // path), which is why nothing here mirrors bus_tx_writes' fate of reporting a constant zero.
    bool        modbus_enabled   = false;  // is the second stack running at all on this device?
    bool        modbus_connected = false;
    uint32_t    modbus_rx        = 0;   // successful HomeHub register reads since boot
    uint32_t    modbus_fails     = 0;   // failed reads since boot
    // The HomeHub watched stack — same source and same 0-means-never-sampled rule as the other four
    // slots (stack_watch.hpp). It USED to be published as a bare 0 on every board without a
    // HomeHub, i.e. as "0 bytes of stack free" on the majority of the fleet: a plausible-looking
    // number for a task that does not exist. It is null now, like its four siblings.
    uint32_t    modbus_stack_min_free_bytes = 0;
};

// Bytes free -> JSON, with the shared never-sampled rule in ONE place rather than at five call
// sites. Absence is a first-class answer here: a metrics consumer drops a null field and records no
// sample, which is exactly right, where a 0 would draw a line at the bottom of the chart and read
// as a board one byte from death.
template <typename JsonOut> inline void append_stack_bytes(JsonOut& j, uint32_t bytes) {
    if (bytes == 0)
        j += "null";
    else
        j += std::to_string(bytes);
}

// Heartbeat topic: <base>/heartbeat — separate from the source value topics so a Telegraf/HA consumer
// can subscribe to device health independently of heat-pump values.
inline std::string heartbeat_topic(const std::string& base) {
    return base + "/heartbeat";
}

// "Ddd+HH:MM:SS.mmm" uptime display string, e.g. "007+21:05:31.860" — the form other ESP32 HA
// bridges show. uptime_s/uptime_ms are also emitted as plain
// numbers for anything that wants to graph or alert on them without parsing this string.
inline std::string format_uptime(uint64_t uptime_ms) {
    const uint64_t ms      = uptime_ms % 1000;
    const uint64_t s_total = uptime_ms / 1000;
    const uint64_t sec     = s_total % 60;
    const uint64_t m_total = s_total / 60;
    const uint64_t min     = m_total % 60;
    const uint64_t h_total = m_total / 60;
    const uint64_t hour    = h_total % 24;
    const uint64_t days    = h_total / 24;
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%03llu+%02llu:%02llu:%02llu.%03llu",
                  static_cast<unsigned long long>(days), static_cast<unsigned long long>(hour),
                  static_cast<unsigned long long>(min), static_cast<unsigned long long>(sec),
                  static_cast<unsigned long long>(ms));
    return buf;
}

// The payload is a FLAT object: the former wifi/mqtt/bus sub-objects are gone, each field carried as
// its block name + "_" prefix (wifi_connected, mqtt_count, bus_rx_received, …). A flat map is what a
// Telegraf/InfluxDB line-protocol consumer and an HA value_template both want — no per-consumer
// nesting to subscript through — and it keeps every heartbeat key a plain snake_case identifier.
inline std::string build_heartbeat_json(const HeartbeatFields& f) {
    const uint32_t uptime_s = static_cast<uint32_t>(f.uptime_ms / 1000);
    // mqtt_pub has to build this on a small FreeRTOS stack. Keep every append sequential: expressions
    // such as `literal + std::to_string(value) + literal` retain multiple temporary std::strings in
    // one frame. A hardware core dump caught that exact shape at the stack-end watchpoint even though
    // the heap allocation itself was only 31 bytes.
    std::string j = "{";
    j += "\"version\":\""; json_append_escaped(j, f.version); j += "\",";
    j += "\"platform\":\""; json_append_escaped(j, f.platform); j += "\",";
    j += "\"uptime_s\":"; j += std::to_string(uptime_s); j += ",";
    j += "\"uptime\":\""; j += format_uptime(f.uptime_ms); j += "\",";
    j += "\"free_heap\":"; j += std::to_string(f.free_heap); j += ",";
    j += "\"min_free_heap\":"; j += std::to_string(f.min_free_heap); j += ",";
    j += "\"max_alloc\":"; j += std::to_string(f.max_alloc); j += ",";
    // Beside the heap it reports on: the count of consecutive heap-watchdog restarts this boot
    // inherited, which is the only field here that can attribute a "sw" reset to the watchdog.
    j += "\"heap_restarts\":"; j += std::to_string(static_cast<unsigned>(f.heap_restarts)); j += ",";
    // The stack budget, per watched task — null where the task has never run (see the fields).
    j += "\"httpd_stack_min_free_bytes\":"; append_stack_bytes(j, f.httpd_stack_min_free_bytes); j += ",";
    j += "\"poll_stack_min_free_bytes\":";  append_stack_bytes(j, f.poll_stack_min_free_bytes);  j += ",";
    j += "\"mqtt_stack_min_free_bytes\":";  append_stack_bytes(j, f.mqtt_stack_min_free_bytes);  j += ",";
    j += "\"weather_stack_min_free_bytes\":";
    append_stack_bytes(j, f.weather_stack_min_free_bytes);
    j += ",";
    j += "\"reset_reason\":\""; json_append_escaped(j, f.reset_reason); j += "\",";
    // Numeric twin of the slug above — see HeartbeatFields. A string never reaches a metrics store.
    j += "\"reset_reason_code\":"; j += std::to_string(f.reset_reason_code); j += ",";
    j += "\"reset_fault\":"; j += f.reset_fault ? "1" : "0"; j += ",";
    // The three connectivity flags ride as the NUMBERS 1/0, not JSON bools. Measured on this
    // install's Telegraf → VictoriaMetrics pipeline: wifi_connected/mqtt_connected/bus_connected were
    // the only heartbeat fields that never became series — the json parser drops a bool exactly like
    // it drops a string, and a metrics store has nowhere to put either. Same reasoning and same
    // encoding as the X10A topic's bit-flag rows (logic/convert.hpp); HA is
    // served by the matching pl_on "1" / pl_off "0" below.
    // (The crash topic keeps its true/false + `| lower` template: it is an event payload, published
    // empty on a normal boot and deliberately not subscribed by the metrics pipeline, so it has no
    // consumer that a bool costs anything — and its binary_sensor already reads correctly in HA.)
    // wifi_* — rssi null while offline (a stale reading must not leak); mac always present;
    // bssid null while offline (no AP).
    j += "\"wifi_connected\":"; j += f.wifi_connected ? "1" : "0";
    j += ",\"wifi_rssi\":"; j += f.wifi_connected ? std::to_string(f.wifi_rssi) : "null";
    j += ",\"wifi_reconnects\":"; j += std::to_string(f.wifi_reconnects);
    j += ",\"wifi_mac\":";
    if (f.wifi_mac.empty()) j += "null";
    else { j += "\""; j += f.wifi_mac; j += "\""; }
    j += ",\"wifi_bssid\":";
    if (f.wifi_bssid.empty()) j += "null";
    else { j += "\""; j += f.wifi_bssid; j += "\""; }
    // net_* — the transport, as numbers (see the field comments).
    j += ",\"net_link\":";    j += std::to_string(static_cast<int>(f.net_link));
    j += ",\"eth_present\":"; j += f.eth_present ? "1" : "0";
    j += ",\"eth_link\":";    j += f.eth_link ? "1" : "0";
    // mqtt_*
    j += ",\"mqtt_connected\":"; j += f.mqtt_connected ? "1" : "0";
    j += ",\"mqtt_count\":"; j += std::to_string(f.mqtt_count);
    j += ",\"mqtt_fails\":"; j += std::to_string(f.mqtt_fails);
    j += ",\"mqtt_reconnects\":"; j += std::to_string(f.mqtt_reconnects);
    // Cycles that produced nothing — an OOM skip and a deliberate OTA/weather TLS hold-off (#380).
    j += ",\"mqtt_skipped\":"; j += std::to_string(f.mqtt_skipped);
    j += ",\"mqtt_quiesced\":"; j += std::to_string(f.mqtt_quiesced);
    // poll_* — the X10A sweep that never ran, so nothing below was even attempted.
    j += ",\"poll_skipped\":"; j += std::to_string(f.poll_skipped);
    // bus_*
    j += ",\"bus_connected\":"; j += f.bus_connected ? "1" : "0";
    j += ",\"bus_proto\":\""; j += f.bus_proto; j += "\"";
    j += ",\"bus_registers\":"; j += std::to_string(f.registers);
    j += ",\"bus_values\":"; j += std::to_string(f.values);
    j += ",\"bus_last_ok_s\":"; j += std::to_string(f.last_ok_s);
    j += ",\"bus_rx_received\":"; j += std::to_string(f.rx_received);
    j += ",\"bus_rx_fails\":"; j += std::to_string(f.rx_fails);
    j += ",\"bus_crc_err\":"; j += std::to_string(f.crc_err);
    j += ",\"bus_timeout_err\":"; j += std::to_string(f.timeout_err);
    // 1/0 NUMBER like the three connectivity flags above, and for the same measured reason.
    j += ",\"bus_ou_held_over\":"; j += f.ou_held_over ? "1" : "0";
    // Read commands actually sent. There is no bus_tx_writes/bus_tx_fails companion: the X10A
    // protocol has no write command (docs/ARCHITECTURE.md → the MQTT bridge is read-only), so both
    // were hardcoded 0 and could never become anything else. They were carried for parity with the
    // field set of another ESP32 HA bridge, which is not a reason this project keeps a field — a
    // metric that cannot vary is a line on a dashboard that always reads zero and an entity a reader
    // has to rule out. Dropped in #215; neither was ever an HA entity, so nothing is orphaned.
    j += ",\"bus_tx_reads\":"; j += std::to_string(f.rx_received + f.rx_fails);
    // Modbus TCP (HomeHub) link — payload-only (no HA entity; see HeartbeatFields). The connectivity
    // flag rides as a 1/0 NUMBER like the others, for the same metrics-consumer reason.
    j += ",\"modbus_enabled\":"; j += f.modbus_enabled ? "1" : "0";
    j += ",\"modbus_connected\":"; j += f.modbus_connected ? "1" : "0";
    j += ",\"modbus_rx\":"; j += std::to_string(f.modbus_rx);
    j += ",\"modbus_fails\":"; j += std::to_string(f.modbus_fails);
    j += ",\"modbus_stack_min_free_bytes\":"; append_stack_bytes(j, f.modbus_stack_min_free_bytes);
    j += "}";
    return j;
}

// One HA diagnostic entity sourced from the heartbeat topic. All of these get
// `"ent_cat":"diagnostic"` so HA tucks them under the device's Diagnostics section rather than
// mixing them into the heat-pump value list. `state_class` is "" for non-numeric/binary entities,
// "measurement" for a fluctuating reading, or "total_increasing" for a monotonic since-boot counter
// (so HA's long-term stats handle a reboot's reset correctly).
struct HeartbeatSensor {
    const char* component;     // "sensor" | "binary_sensor"
    const char* object_id;
    const char* name;
    const char* json_path;     // Flat JSON key, e.g. "wifi_rssi", "bus_rx_received", "free_heap"
    const char* unit;          // "" = none
    const char* device_class;  // "" = none
    const char* state_class;   // "" | "measurement" | "total_increasing"
};

inline const HeartbeatSensor HEARTBEAT_SENSORS[] = {
    {"sensor", "wifi_signal", "WiFi Signal", "wifi_rssi", "dBm", "signal_strength", "measurement"},
    {"sensor", "wifi_reconnects", "WiFi Reconnects", "wifi_reconnects", "", "", "total_increasing"},
    // MAC (this STA) + BSSID (the associated AP) as text diagnostics — which physical board, and
    // which AP it roamed onto. No unit/device_class/state_class; bssid reads HA-"unknown" while
    // offline (null).
    {"sensor", "wifi_mac", "WiFi MAC", "wifi_mac", "", "", ""},
    {"sensor", "wifi_bssid", "WiFi BSSID", "wifi_bssid", "", "", ""},
    {"sensor", "free_heap", "Free Heap", "free_heap", "B", "", "measurement"},
    // Heap low-water mark + largest contiguous free block: both already ride the payload, exposed
    // as their own diagnostic sensors so a slow leak (min_free_heap creeping down) or fragmentation
    // (max_alloc — the binding OOM limit on this firmware) is graphable/alertable in HA.
    {"sensor", "min_free_heap", "Min Free Heap", "min_free_heap", "B", "", "measurement"},
    {"sensor", "max_alloc", "Largest Free Block", "max_alloc", "B", "", "measurement"},
    // An ENTITY, unlike the five stack watermarks beside it in the payload, and the difference is
    // who acts on it: a stack low-water mark is a trend a maintainer reads across releases, this is
    // a fact the OWNER of the board needs to know today — "your device restarted itself because it
    // ran out of memory" — and it is the one thing that separates a heap give-up from the "sw"
    // reset a settings save produces. It does not duplicate "Reset Reason": that entity says `sw`
    // for both, which is exactly the ambiguity this resolves.
    //
    // `measurement`, NOT `total_increasing`: the value is the count this BOOT inherited and it
    // returns to 0 on the next healthy boot, so a monotonic state class would make HA's long-term
    // statistics read every recovery as a counter reset and every ladder as an unrelated new total.
    {"sensor", "heap_restarts", "Heap Watchdog Restarts", "heap_restarts", "", "", "measurement"},
    {"sensor", "uptime", "Uptime", "uptime_s", "s", "duration", "measurement"},
    {"sensor", "reset_reason", "Reset Reason", "reset_reason", "", "", ""},
    {"binary_sensor", "bus_status", "X10A Bus", "bus_connected", "", "connectivity", ""},
    // Source freshness, not link health — deliberately NOT device_class "connectivity"/"problem":
    // an outdoor unit resting is the normal state of a heat pump for most of the day, and typing it
    // as a fault would turn every quiet afternoon into an alert.
    {"binary_sensor", "ou_held_over", "Outdoor Data Held Over", "bus_ou_held_over", "", "", ""},
    {"sensor", "bus_crc_err", "X10A CRC Errors", "bus_crc_err", "", "", "total_increasing"},
    {"sensor", "bus_timeout_err", "X10A Timeout Errors", "bus_timeout_err", "", "",
     "total_increasing"},
    {"sensor", "bus_rx_received", "X10A RX Received", "bus_rx_received", "", "",
     "total_increasing"},
    {"sensor", "bus_rx_fails", "X10A RX Fails", "bus_rx_fails", "", "", "total_increasing"},
    {"sensor", "mqtt_count", "MQTT Publishes", "mqtt_count", "", "", "total_increasing"},
    {"sensor", "mqtt_fails", "MQTT Publish Fails", "mqtt_fails", "", "", "total_increasing"},
    {"sensor", "mqtt_reconnects", "MQTT Reconnects", "mqtt_reconnects", "", "", "total_increasing"},
    // The three #380 loss counters. Entities, not payload-only like the modbus_* block, because the
    // whole point of the issue is that this loss had no consumer: it is the thing to ALERT on, and
    // a number nobody can put on a dashboard is how it stayed invisible for 337 dropped publishes.
    // `total_increasing` so HA's long-term statistics read a reboot as a counter reset rather than
    // a cliff — and a reboot is exactly what ends every episode these count.
    {"sensor", "mqtt_skipped", "MQTT Cycles Skipped", "mqtt_skipped", "", "", "total_increasing"},
    {"sensor", "mqtt_quiesced", "MQTT Cycles Held (TLS)", "mqtt_quiesced", "", "",
     "total_increasing"},
    {"sensor", "poll_skipped", "X10A Cycles Skipped", "poll_skipped", "", "", "total_increasing"},
};
inline constexpr int HEARTBEAT_SENSOR_COUNT =
    sizeof(HEARTBEAT_SENSORS) / sizeof(HEARTBEAT_SENSORS[0]);

// HA entities this firmware ONCE published on the heartbeat topic and no longer does (RetiredHaSensor
// + why a retraction is mandatory, logic/ha_device.hpp). Both were dropped under the rule that
// already retired the crash topic's "Last Reset Reason": an entity that repeats what another one on
// the same device already says is not a second reading, it is a second thing to rule out.
//
// `device_time` published the SNTP wall clock as a device_class "timestamp" sensor. Its stated
// purpose was catching a drifted or never-synced clock, and every part of that failed in practice:
// the value is re-sent every HEARTBEAT_INTERVAL_S, so HA renders it as "N seconds ago" — which is
// what HA's own last_updated on any of the other entities here already says, for free and without a
// clock. What it did do is change on EVERY heartbeat, i.e. one recorder row every 10 s, permanently,
// for a fact no dashboard can read and no automation asked for. The two questions it was supposed to
// answer are both still answered, and better: /status.ntp reports {server, synced, time} directly
// (with `synced` false being the failure this actually catches), and syslog carries the same clock in
// every RFC 5424 TIMESTAMP. A wall clock is worth REPORTING; it is not worth an entity.
//
// `wifi_quality` published wifi_signal_quality_pct(rssi) — 2*(rssi+100), clamped — beside the
// "WiFi Signal" sensor carrying that very rssi. A deterministic function of another entity on the
// same device carries no information of its own: it cannot disagree, cannot fail independently, and
// cannot show anything dBm does not already show. A reader who prefers percent can template it in HA
// from the dBm entity; the firmware should not publish the same measurement twice. The
// `wifi_quality_pct` payload field went with it — it existed only to feed this entity, so keeping it
// would leave the duplicate in every heartbeat while hiding it from the one consumer that showed it.
inline const RetiredHaSensor RETIRED_HEARTBEAT_SENSORS[] = {
    {"sensor", "device_time"},    // the wall clock: /status.ntp + syslog say it, an entity need not
    {"sensor", "wifi_quality"},   // a pure function of "WiFi Signal" (rssi)
};
inline constexpr int RETIRED_HEARTBEAT_SENSOR_COUNT =
    sizeof(RETIRED_HEARTBEAT_SENSORS) / sizeof(RETIRED_HEARTBEAT_SENSORS[0]);

inline std::string heartbeat_discovery_topic(const std::string& prefix, const std::string& component,
                                             const std::string& node, const std::string& object_id) {
    return prefix + "/" + component + "/" + node + "/" + object_id + "/config";
}
inline std::string heartbeat_discovery_topic(const std::string& prefix, const std::string& node,
                                             const HeartbeatSensor& s) {
    return heartbeat_discovery_topic(prefix, s.component, node, s.object_id);
}

inline std::string heartbeat_discovery_config(const std::string& node, const std::string& board_id,
                                              const std::string& hb_topic,
                                              const std::string& avail_topic,
                                              const HeartbeatSensor& s) {
    std::string j = "{";
    j += "\"name\":\""; j += s.name; j += "\",";
    j += "\"uniq_id\":\""; j += node; j += "_"; j += s.object_id; j += "\",";
    j += "\"stat_t\":\""; j += hb_topic; j += "\",";
    j += "\"val_tpl\":\"{{ value_json."; j += s.json_path; j += " }}\",";
    j += "\"avty_t\":\""; j += avail_topic; j += "\",";
    // A binary_sensor here reads a 1/0 NUMBER (see build_heartbeat_json), so it must say so: HA's
    // pl_on/pl_off default to "ON"/"OFF" and match neither 1/0 nor the `True`/`False` a JSON bool used
    // to render as — which is why the "X10A Bus" entity never left `unknown` before this.
    if (s.component[0] == 'b') { j += "\"pl_on\":\"1\",\"pl_off\":\"0\","; }   // "binary_sensor"
    if (s.unit[0])         { j += "\"unit_of_meas\":\""; j += s.unit; j += "\","; }
    if (s.device_class[0]) { j += "\"dev_cla\":\""; j += s.device_class; j += "\","; }
    if (s.state_class[0])  { j += "\"stat_cla\":\""; j += s.state_class; j += "\","; }
    j += "\"ent_cat\":\"diagnostic\",";
    j += device_json(node, board_id);
    j += "}";
    return j;
}

} // namespace daik
