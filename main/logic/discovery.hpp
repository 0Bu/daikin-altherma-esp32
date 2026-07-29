#pragma once
// Home Assistant MQTT-Discovery payload builder. Pure string building, IDF-free, so the exact
// bytes HA receives are asserted on the host (test/test_logic.cpp) rather than on the device.
// mqtt_ha.cpp streams one of these per value on (re)connect; every sensor points at the ONE shared
// grouped-JSON state topic (logic/mqtt_group.hpp) via a value_template.
#include <string>
#include "value_def.hpp"
#include "convert.hpp"
#include "fault_state.hpp"
#include "ha_device.hpp"
#include "mqtt_group.hpp"

namespace daik {

// HA object_id: lowercase, alnum-only, spaces/others -> '_' (logic/ha_device.hpp ha_slug — the same
// rules the device node id is built with).
inline std::string object_id(const char* label) { return ha_slug(label); }

// HA component (the discovery topic's <component> segment + the entity domain) for one value: a
// bit-flag row is a `binary_sensor`, everything else a `sensor`. Keyed on the converter id via
// conv_is_binary, the same predicate the state-payload encoder uses.
inline const char* ha_component(const ValueDef& def) {
    return conv_is_binary(def.conv) ? "binary_sensor" : "sensor";
}

inline std::string discovery_topic(const std::string& prefix, const std::string& node,
                                   const ValueDef& def) {
    return prefix + "/" + ha_component(def) + "/" + node + "/" + object_id(def.label) + "/config";
}

// The topic a value's discovery config was published on by builds BEFORE the binary_sensor split,
// when EVERY row was a `sensor`. For a binary row this is now a stale retained config that HA would
// keep as a second, permanently-unavailable text entity, so the bridge deletes it (zero-length
// retained publish) alongside publishing the new one — the RETIRED_CRASH_SENSORS pattern, except the
// old topic is derivable from the row instead of needing a hand-maintained table. Returns the same
// string as discovery_topic() for a non-binary row, where there is nothing to retire.
inline std::string retired_sensor_discovery_topic(const std::string& prefix, const std::string& node,
                                                  const ValueDef& def) {
    return prefix + "/sensor/" + node + "/" + object_id(def.label) + "/config";
}

// Shared retained state topic: <base>/state. ALL sensors read from this one topic — the bridge
// publishes a single grouped JSON object of every value (logic/mqtt_group.hpp) and each sensor's
// value_template subscripts its group + object out of it. The device-disambiguating node id lives in
// each discovery config's uniq_id/dev.ids (below), NOT in the message topic — one board per <base>,
// so the payload topics sit directly under it.
inline std::string state_topic(const std::string& base) {
    return base + "/state";
}

// Device availability topic (LWT): <base>/status -> "online"/"offline".
inline std::string availability_topic(const std::string& base) {
    return base + "/status";
}

// Discovery config JSON for one value. `state_topic` is the ONE shared grouped-JSON topic; the
// value_template subscripts this value's group + object out of it (bracket notation, so a slug that
// starts with a digit — "2way_valve…" — is still valid). `avail_topic` ties the sensor to device
// availability. `node` is the stable installation id (logic/ha_device.hpp) and `board_id` this
// board's own MAC-derived id — see device_json() for why the device carries both.
inline std::string discovery_config(const std::string& node, const std::string& board_id,
                                    const std::string& state_topic,
                                    const std::string& avail_topic, const ValueDef& def) {
    const std::string obj   = object_id(def.label);
    const std::string group = group_for_page(def.reg);
    const std::string unit  = unit_for_datatype(def.type);
    const std::string dc    = device_class_for_datatype(def.type);
    std::string j = "{";
    j += "\"name\":\"";       j += def.label; j += "\",";
    j += "\"uniq_id\":\"";    j += node; j += "_"; j += obj; j += "\",";
    j += "\"stat_t\":\"";     j += state_topic; j += "\",";
    j += "\"val_tpl\":\"{{ value_json['"; j += group; j += "']['"; j += obj; j += "'] }}\",";
    j += "\"avty_t\":\"";     j += avail_topic; j += "\",";
    // A binary row's state is the number 1/0 (logic/convert.hpp), which the template renders as
    // "1"/"0" — so pl_on/pl_off must be spelled out; HA's defaults are "ON"/"OFF"
    // and would leave every one of these entities stuck at `unknown`. No unit / device_class /
    // state_class: every 300-307 row is dataType -1, so unit and dc are empty here anyway, and a
    // meaningful HA device_class (running / problem / heat) is a per-LABEL domain judgement — exactly
    // the kind of guess that produced #35-#39 — so it is deliberately left unset rather than inferred.
    if (conv_is_binary(def.conv)) { j += "\"pl_on\":\"1\",\"pl_off\":\"0\","; }
    if (!unit.empty()) { j += "\"unit_of_meas\":\""; j += unit; j += "\","; }
    if (!dc.empty())   { j += "\"dev_cla\":\"";      j += dc;   j += "\","; j += "\"stat_cla\":\"measurement\","; }
    j += device_json(node, board_id);
    j += "}";
    return j;
}

// ── DERIVED companion entities ───────────────────────────────────────────────────────────────────
// A companion is a field the bridge PUBLISHES but the catalog does not contain: today, the numeric
// error_active/warning_active pair beside a textual conv-203 error class (logic/fault_state.hpp,
// #209 defect 4). It lives in the same group object as the row it is derived from, so its JSON key
// needs no prefix — but HA entity ids share one flat namespace across groups, and a profile carries
// an error class on BOTH the outdoor and the hydronic page, so the entity id and name are scoped by
// the group. `<group>_<key>` and "<Group> <Name>": outdoor_state_error_active, "Outdoor State Error
// Active".
//
// Always a binary_sensor with an explicit pl_on "1" / pl_off "0" — the state is the NUMBER 1/0, and
// HA's defaults are "ON"/"OFF", which is what parked every bit-flag entity at `unknown` before the
// split. device_class "problem" is HA's own semantics for "on means something is wrong" and says
// nothing about the plant, so it is not the kind of per-label domain guess ha_component deliberately
// declines to make for the catalog rows.
inline std::string companion_object_id(const std::string& group, const char* key) {
    return group + "_" + key;
}

inline std::string companion_discovery_topic(const std::string& prefix, const std::string& node,
                                             const std::string& group, const char* key) {
    return prefix + "/binary_sensor/" + node + "/" + companion_object_id(group, key) + "/config";
}

inline std::string companion_discovery_config(const std::string& node, const std::string& board_id,
                                              const std::string& state_topic,
                                              const std::string& avail_topic,
                                              const std::string& group, const FaultCompanion& c) {
    const std::string obj = companion_object_id(group, c.key);
    std::string j = "{";
    j += "\"name\":\"";    j += group_display_name(group); j += ' '; j += c.name; j += "\",";
    j += "\"uniq_id\":\""; j += node; j += "_"; j += obj; j += "\",";
    j += "\"stat_t\":\"";  j += state_topic; j += "\",";
    j += "\"val_tpl\":\"{{ value_json['"; j += group; j += "']['"; j += c.key; j += "'] }}\",";
    j += "\"avty_t\":\"";  j += avail_topic; j += "\",";
    j += "\"pl_on\":\"1\",\"pl_off\":\"0\",";
    j += "\"dev_cla\":\"problem\",";
    j += device_json(node, board_id);
    j += "}";
    return j;
}

} // namespace daik
