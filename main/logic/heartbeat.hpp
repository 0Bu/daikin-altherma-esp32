#pragma once
// Board/link "heartbeat" — technical diagnostics (free heap, uptime, WiFi signal/reconnects, MQTT
// publish stats, X10A bus counters) published periodically to a separate MQTT topic, distinct from
// the heat-pump state JSON (logic/mqtt_group.hpp). Pure string building, IDF-free, host-tested
// (test/test_logic.cpp). Mirrors the "device diagnostics" pattern other ESP32 HA bridges expose
// (e.g. EMS-ESP's `<base>/heartbeat` topic: bus_status, freemem, rssi, rx/txfails, uptime).
#include <cstdint>
#include <cstdio>
#include <string>
#include "mqtt_group.hpp"   // json_append_escaped

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

    bool        wifi_connected  = false;
    int8_t      wifi_rssi       = 0;   // valid only if wifi_connected
    uint32_t    wifi_reconnects = 0;   // cumulative since boot (wifi_reconnect_count())

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
};

// Heartbeat topic: <base>/<node>/heartbeat — separate from the shared state topic so a Telegraf/HA
// consumer can subscribe to device health independently of heat-pump values.
inline std::string heartbeat_topic(const std::string& base, const std::string& node) {
    return base + "/" + node + "/heartbeat";
}

// WiFi signal quality 0-100%, the same dBm->% mapping other ESP32 firmware (and most consumer WiFi
// stacks) use: -50 dBm or better is 100%, -100 dBm or worse is 0%, linear between (2% per dBm).
inline int wifi_signal_quality_pct(int8_t rssi) {
    if (rssi <= -100) return 0;
    if (rssi >= -50)  return 100;
    return 2 * (static_cast<int>(rssi) + 100);
}

// "Ddd+HH:MM:SS.mmm" uptime display string (matches the format other ESP32 HA bridges show, e.g.
// EMS-ESP's heartbeat.uptime "007+21:05:31.860"). uptime_s/uptime_ms are also emitted as plain
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
    j += "\"wifi\":{\"connected\":"; j += f.wifi_connected ? "true" : "false";
    j += ",\"rssi\":"; j += f.wifi_connected ? std::to_string(f.wifi_rssi) : "null";
    j += ",\"quality_pct\":"; j += f.wifi_connected ? std::to_string(wifi_signal_quality_pct(f.wifi_rssi)) : "null";
    j += ",\"reconnects\":" + std::to_string(f.wifi_reconnects) + "},";
    j += "\"mqtt\":{\"connected\":"; j += f.mqtt_connected ? "true" : "false";
    j += ",\"count\":" + std::to_string(f.mqtt_count);
    j += ",\"fails\":" + std::to_string(f.mqtt_fails);
    j += ",\"reconnects\":" + std::to_string(f.mqtt_reconnects) + "},";
    j += "\"bus\":{\"connected\":"; j += f.bus_connected ? "true" : "false";
    j += ",\"proto\":\""; j += f.bus_proto; j += "\"";
    j += ",\"registers\":" + std::to_string(f.registers);
    j += ",\"values\":" + std::to_string(f.values);
    j += ",\"crc_err\":" + std::to_string(f.crc_err);
    j += ",\"timeout_err\":" + std::to_string(f.timeout_err);
    j += ",\"rx_received\":" + std::to_string(f.rx_received);
    j += ",\"rx_fails\":" + std::to_string(f.rx_fails);
    j += ",\"last_ok_s\":" + std::to_string(f.last_ok_s);
    j += "},";
    // The X10A protocol has no write command (docs/ARCHITECTURE.md → MQTT bridge is read-only), so
    // tx.writes/fails are always 0 — reported for parity with the EMS-ESP-style field set rather
    // than because this firmware could ever be busy writing.
    j += "\"tx\":{\"reads\":" + std::to_string(f.rx_received + f.rx_fails) +
         ",\"writes\":0,\"fails\":0}";
    j += "}";
    return j;
}

// One HA diagnostic entity sourced from the heartbeat topic. `path1` may be nullptr for a
// top-level field. All of these get `"ent_cat":"diagnostic"` so HA tucks them under the device's
// Diagnostics section rather than mixing them into the heat-pump value list. `state_class` is ""
// for non-numeric/binary entities, "measurement" for a fluctuating reading, or "total_increasing"
// for a monotonic since-boot counter (so HA's long-term stats handle a reboot's reset correctly).
struct HeartbeatSensor {
    const char* component;     // "sensor" | "binary_sensor"
    const char* object_id;
    const char* name;
    const char* path0;
    const char* path1;         // nullptr = top-level field
    const char* unit;          // "" = none
    const char* device_class;  // "" = none
    const char* state_class;   // "" | "measurement" | "total_increasing"
};

inline const HeartbeatSensor HEARTBEAT_SENSORS[] = {
    {"sensor",        "wifi_signal",      "WiFi Signal",         "wifi", "rssi",        "dBm", "signal_strength", "measurement"},
    {"sensor",        "wifi_quality",     "WiFi Quality",        "wifi", "quality_pct", "%",   "",                 "measurement"},
    {"sensor",        "wifi_reconnects",  "WiFi Reconnects",     "wifi", "reconnects",  "",    "",                 "total_increasing"},
    {"sensor",        "free_heap",        "Free Heap",           "free_heap", nullptr,  "B",   "",                 "measurement"},
    {"sensor",        "uptime",           "Uptime",              "uptime_s", nullptr,   "s",   "duration",         "measurement"},
    {"binary_sensor", "bus_status",       "X10A Bus",            "bus", "connected",    "",    "connectivity",     ""},
    {"sensor",        "bus_crc_err",      "X10A CRC Errors",     "bus", "crc_err",      "",    "",                 "total_increasing"},
    {"sensor",        "bus_timeout_err",  "X10A Timeout Errors", "bus", "timeout_err",  "",    "",                 "total_increasing"},
    {"sensor",        "bus_rx_received",  "X10A RX Received",    "bus", "rx_received",  "",    "",                 "total_increasing"},
    {"sensor",        "bus_rx_fails",     "X10A RX Fails",       "bus", "rx_fails",     "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_count",       "MQTT Publishes",      "mqtt", "count",       "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_fails",       "MQTT Publish Fails",  "mqtt", "fails",       "",    "",                 "total_increasing"},
    {"sensor",        "mqtt_reconnects",  "MQTT Reconnects",     "mqtt", "reconnects",  "",    "",                 "total_increasing"},
};
inline constexpr int HEARTBEAT_SENSOR_COUNT =
    sizeof(HEARTBEAT_SENSORS) / sizeof(HEARTBEAT_SENSORS[0]);

inline std::string heartbeat_discovery_topic(const std::string& prefix, const std::string& node,
                                             const HeartbeatSensor& s) {
    return prefix + "/" + s.component + "/" + node + "/" + s.object_id + "/config";
}

inline std::string heartbeat_discovery_config(const std::string& node, const std::string& hb_topic,
                                              const std::string& avail_topic,
                                              const HeartbeatSensor& s) {
    std::string j = "{";
    j += "\"name\":\""; j += s.name; j += "\",";
    j += "\"uniq_id\":\""; j += node; j += "_"; j += s.object_id; j += "\",";
    j += "\"stat_t\":\""; j += hb_topic; j += "\",";
    j += "\"val_tpl\":\"{{ value_json['"; j += s.path0; j += "']";
    if (s.path1) { j += "['"; j += s.path1; j += "']"; }
    j += " }}\",";
    j += "\"avty_t\":\""; j += avail_topic; j += "\",";
    if (s.unit[0])         { j += "\"unit_of_meas\":\""; j += s.unit; j += "\","; }
    if (s.device_class[0]) { j += "\"dev_cla\":\""; j += s.device_class; j += "\","; }
    if (s.state_class[0])  { j += "\"stat_cla\":\""; j += s.state_class; j += "\","; }
    j += "\"ent_cat\":\"diagnostic\",";
    j += "\"dev\":{\"ids\":[\""; j += node; j += "\"],\"name\":\"Daikin Altherma\",";
    j += "\"mf\":\"Daikin\",\"mdl\":\"Altherma\"}";
    j += "}";
    return j;
}

} // namespace daik
