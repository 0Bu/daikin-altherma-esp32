#pragma once
// Board/link "heartbeat" — technical diagnostics (free heap, uptime, WiFi signal/reconnects, MQTT
// publish stats, X10A bus counters) published periodically to a separate MQTT topic, distinct from
// the heat-pump state JSON (logic/mqtt_group.hpp). Pure string building, IDF-free, host-tested
// (test/test_logic.cpp). Mirrors the "device diagnostics" pattern other ESP32 HA bridges expose
// on their own `<base>/heartbeat` topic: link status, free memory, RSSI, rx failures, uptime.
#include <cstdint>
#include <cstdio>
#include <string>
#include "ha_device.hpp"   // device_json — one HA device across values/diagnostics/crash
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
    // Pre-rendered "AA:BB:CC:DD:EE:FF" MAC strings so this header stays IDF-free (same contract as
    // `time`): wifi_mac is this STA's own MAC (always present); wifi_bssid is the associated AP's MAC
    // ("" while offline -> JSON null, since there is no AP). Both let an HA/Telegraf consumer pin a
    // heartbeat to a specific board and see which AP it roamed onto — the /status.wifi.mac/.bssid
    // pair, now on the diagnostics stream too.
    std::string wifi_mac;
    std::string wifi_bssid;

    bool        mqtt_connected  = false;
    uint32_t    mqtt_count      = 0;   // cumulative successful publishes (state+heartbeat+discovery)
    uint32_t    mqtt_fails      = 0;   // cumulative failed esp_mqtt_client_publish() calls
    uint32_t    mqtt_reconnects = 0;   // cumulative RE-connects (excludes the first-ever connect)

    bool        bus_connected  = false;   // hp_stats().connected — X10A link up this cycle
    char        bus_proto      = '?';
    int         registers      = 0;
    int         values         = 0;
    uint32_t    crc_err        = 0;
    uint32_t    timeout_err    = 0;
    int32_t     last_ok_s      = -1;      // seconds since last fully-good X10A cycle (-1 = never)
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
};

// Heartbeat topic: <base>/heartbeat — separate from the shared state topic so a Telegraf/HA consumer
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
    std::string j = "{";
    j += "\"version\":\""; json_append_escaped(j, f.version); j += "\",";
    j += "\"platform\":\""; json_append_escaped(j, f.platform); j += "\",";
    j += "\"uptime_s\":" + std::to_string(uptime_s) + ",";
    j += "\"uptime\":\"" + format_uptime(f.uptime_ms) + "\",";
    j += "\"free_heap\":" + std::to_string(f.free_heap) + ",";
    j += "\"min_free_heap\":" + std::to_string(f.min_free_heap) + ",";
    j += "\"max_alloc\":" + std::to_string(f.max_alloc) + ",";
    j += "\"reset_reason\":\""; json_append_escaped(j, f.reset_reason); j += "\",";
    // Numeric twin of the slug above — see HeartbeatFields. A string never reaches a metrics store.
    j += "\"reset_reason_code\":" + std::to_string(f.reset_reason_code) + ",";
    j += "\"reset_fault\":"; j += f.reset_fault ? "1" : "0"; j += ",";
    // The three connectivity flags ride as the NUMBERS 1/0, not JSON bools. Measured on this
    // install's Telegraf → VictoriaMetrics pipeline: wifi_connected/mqtt_connected/bus_connected were
    // the only heartbeat fields that never became series — the json parser drops a bool exactly like
    // it drops a string, and a metrics store has nowhere to put either. Same reasoning and same
    // encoding as the state topic's bit-flag rows (logic/convert.hpp); HA is
    // served by the matching pl_on "1" / pl_off "0" below.
    // (The crash topic keeps its true/false + `| lower` template: it is an event payload, published
    // empty on a normal boot and deliberately not subscribed by the metrics pipeline, so it has no
    // consumer that a bool costs anything — and its binary_sensor already reads correctly in HA.)
    // wifi_* — rssi null while offline (a stale reading must not leak); mac always present;
    // bssid null while offline (no AP).
    j += "\"wifi_connected\":"; j += f.wifi_connected ? "1" : "0";
    j += ",\"wifi_rssi\":"; j += f.wifi_connected ? std::to_string(f.wifi_rssi) : "null";
    j += ",\"wifi_reconnects\":" + std::to_string(f.wifi_reconnects);
    j += ",\"wifi_mac\":"; j += f.wifi_mac.empty() ? "null" : ("\"" + f.wifi_mac + "\"");
    j += ",\"wifi_bssid\":"; j += f.wifi_bssid.empty() ? "null" : ("\"" + f.wifi_bssid + "\"");
    // mqtt_*
    j += ",\"mqtt_connected\":"; j += f.mqtt_connected ? "1" : "0";
    j += ",\"mqtt_count\":" + std::to_string(f.mqtt_count);
    j += ",\"mqtt_fails\":" + std::to_string(f.mqtt_fails);
    j += ",\"mqtt_reconnects\":" + std::to_string(f.mqtt_reconnects);
    // bus_*
    j += ",\"bus_connected\":"; j += f.bus_connected ? "1" : "0";
    j += ",\"bus_proto\":\""; j += f.bus_proto; j += "\"";
    j += ",\"bus_registers\":" + std::to_string(f.registers);
    j += ",\"bus_values\":" + std::to_string(f.values);
    j += ",\"bus_last_ok_s\":" + std::to_string(f.last_ok_s);
    j += ",\"bus_rx_received\":" + std::to_string(f.rx_received);
    j += ",\"bus_rx_fails\":" + std::to_string(f.rx_fails);
    j += ",\"bus_crc_err\":" + std::to_string(f.crc_err);
    j += ",\"bus_timeout_err\":" + std::to_string(f.timeout_err);
    // 1/0 NUMBER like the three connectivity flags above, and for the same measured reason.
    j += ",\"bus_ou_held_over\":"; j += f.ou_held_over ? "1" : "0";
    // Read commands actually sent. There is no bus_tx_writes/bus_tx_fails companion: the X10A
    // protocol has no write command (docs/ARCHITECTURE.md → the MQTT bridge is read-only), so both
    // were hardcoded 0 and could never become anything else. They were carried for parity with the
    // field set of another ESP32 HA bridge, which is not a reason this project keeps a field — a
    // metric that cannot vary is a line on a dashboard that always reads zero and an entity a reader
    // has to rule out. Dropped in #215; neither was ever an HA entity, so nothing is orphaned.
    j += ",\"bus_tx_reads\":" + std::to_string(f.rx_received + f.rx_fails);
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
    {"sensor",        "wifi_signal",      "WiFi Signal",         "wifi_rssi",        "dBm", "signal_strength", "measurement"},
    {"sensor",        "wifi_reconnects",  "WiFi Reconnects",     "wifi_reconnects",  "",    "",                 "total_increasing"},
    // MAC (this STA) + BSSID (the associated AP) as text diagnostics — which physical board, and which
    // AP it roamed onto. No unit/device_class/state_class; bssid reads HA-"unknown" while offline (null).
    {"sensor",        "wifi_mac",         "WiFi MAC",            "wifi_mac",         "",    "",                 ""},
    {"sensor",        "wifi_bssid",       "WiFi BSSID",          "wifi_bssid",       "",    "",                 ""},
    {"sensor",        "free_heap",        "Free Heap",           "free_heap",        "B",   "",                 "measurement"},
    // Heap low-water mark + largest contiguous free block: both already ride the payload, exposed as
    // their own diagnostic sensors so a slow leak (min_free_heap creeping down) or fragmentation
    // (max_alloc — the binding OOM limit on this firmware) is graphable/alertable in HA.
    {"sensor",        "min_free_heap",    "Min Free Heap",       "min_free_heap",    "B",   "",                 "measurement"},
    {"sensor",        "max_alloc",        "Largest Free Block",  "max_alloc",        "B",   "",                 "measurement"},
    {"sensor",        "uptime",           "Uptime",              "uptime_s",         "s",   "duration",         "measurement"},
    {"sensor",        "reset_reason",     "Reset Reason",        "reset_reason",     "",    "",                 ""},
    {"binary_sensor", "bus_status",       "X10A Bus",            "bus_connected",    "",    "connectivity",     ""},
    // Source freshness, not link health — deliberately NOT device_class "connectivity"/"problem":
    // an outdoor unit resting is the normal state of a heat pump for most of the day, and typing it
    // as a fault would turn every quiet afternoon into an alert.
    {"binary_sensor", "ou_held_over",     "Outdoor Data Held Over", "bus_ou_held_over", "", "",         ""},
    {"sensor",        "bus_crc_err",      "X10A CRC Errors",     "bus_crc_err",      "",    "",                 "total_increasing"},
    {"sensor",        "bus_timeout_err",  "X10A Timeout Errors", "bus_timeout_err",  "",    "",                 "total_increasing"},
    {"sensor",        "bus_rx_received",  "X10A RX Received",    "bus_rx_received",  "",    "",                 "total_increasing"},
    {"sensor",        "bus_rx_fails",     "X10A RX Fails",       "bus_rx_fails",     "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_count",       "MQTT Publishes",      "mqtt_count",       "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_fails",       "MQTT Publish Fails",  "mqtt_fails",       "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_reconnects",  "MQTT Reconnects",     "mqtt_reconnects",  "",    "",                 "total_increasing"},
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
