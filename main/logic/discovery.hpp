#pragma once
// Home Assistant MQTT-Discovery payload builder. Pure string building, IDF-free, so the exact
// bytes HA receives are asserted on the host (test/test_logic.cpp) rather than on the device.
// mqtt_ha.cpp streams one of these per value on (re)connect. X10A sensors point at the grouped
// <base>/x10a payload; HomeHub sensors point at the independent flat <base>/modbus payload.
#include <string>
#include "value_def.hpp"
#include "convert.hpp"
#include "fault_state.hpp"
#include "ha_device.hpp"
#include "mqtt_group.hpp"
#include "../def/homehub.hpp"

namespace daik {

// HA object_id: lowercase, alnum-only, spaces/others -> '_' (logic/ha_device.hpp ha_slug — the same
// rules the device node id is built with). This is the STATE-payload key and the VictoriaMetrics
// series suffix; the ENTITY id is row_object_id() below, which scopes it by the register group.
inline std::string object_id(const char* label) { return ha_slug(label); }

// Layout-marker / grid converters carry no measured value (docs/REGISTERS.md §3.6) — no entity, no
// series. Here rather than in mqtt_ha.cpp (where it was a file-static) because the catalog-wide
// identity tests have to enumerate EXACTLY the rows the bridge announces, and a second copy of this
// rule in the test would be a test of the copy — the reason lwt_select.hpp and ou_stale.hpp both
// exist as shared headers rather than as a rule restated per consumer.
inline constexpr bool conv_publishable(int conv) { return !(conv == 0 || (conv >= 995 && conv <= 999)); }

// HA component (the discovery topic's <component> segment + the entity domain) for one value: a
// bit-flag row is a `binary_sensor`, everything else a `sensor`. Keyed on the converter id via
// conv_is_binary, the same predicate the state-payload encoder uses.
inline const char* ha_component(const ValueDef& def) {
    return conv_is_binary(def.conv) ? "binary_sensor" : "sensor";
}

// An ENTITY id: the register group and the key, joined. The one place that rule is written — the
// catalog rows below and the derived companions at the bottom of this file both route through it,
// so the two can never disagree about the shape of an id.
inline std::string scoped_object_id(const std::string& group, const std::string& key) {
    std::string o;
    o.reserve(group.size() + 1 + key.size());
    o += group;
    o += '_';
    o += key;
    return o;
}

// A catalog row's HA entity id. The label alone is NOT enough (#221): it is unique only within its
// register page, while `uniq_id` and the discovery TOPIC are both flat namespaces. The catalog
// carries "Error Code" on the outdoor page AND on the hydronic one, and before this the second
// discovery config landed on the first one's topic under the first one's id — so the broker kept one
// payload, HA created one entity, and a unit reporting two faults showed one. Nothing errored; in HA
// it reads as a sensor the model does not have.
//
// The state payload never had this problem (it nests by group), which is exactly why the defect was
// invisible outside Home Assistant — and why object_id() above must NOT change with this: it is the
// state key and the VictoriaMetrics series suffix, and forking those is #217's whole subject.
//
// Structural — every row, not just the ones that happen to collide today. A rule that scoped only
// the collisions would make an entity's identity depend on which OTHER rows the detected profile
// carries, so a re-detect onto a neighbouring model could rename a live entity and strand its
// history: the #217 series fork, moved into HA.
inline std::string row_object_id(const ValueDef& def) {
    return scoped_object_id(group_for_page(def.reg), object_id(def.label));
}

// Labels the catalog places on MORE THAN ONE register page. The id is group-scoped for every row
// now, so a shared label no longer collapses two rows into one entity — but the NAME is what HA
// turns into the default entity_id, and two entities both called "Error Code" land as
// sensor.…_error_code and sensor.…_error_code_2, which tells nobody which unit each one reads. So a
// row whose label is on this list is NAMED by its group too — "Outdoor State Error Code" /
// "Hydronic Error Code" — the rule the derived companions below have always followed.
//
// Only these. Group-scoping every name would give every one of the ~164 entities a new entity_id,
// and recorder history plus long-term statistics are keyed on entity_id: the other ~154 keep their
// name, so they delete-and-reclaim their own id and their history carries over.
//
// A hand-maintained ledger and deliberately NOT a scan of the detected profile: "Target Discharge
// Temp." collides on exactly one profile, so a name computed from the live row set would differ per
// model and a re-detect would rename a running entity — the damage this issue is about. The cost is
// that a profile carrying only one side of a pair still gets the qualified name; the gain is a name
// that is identical on every model forever. test_metric_identity() asserts this list is EXACTLY the
// set of label slugs the shipped catalog reuses across pages, so a sixth cannot appear unnoticed.
inline constexpr const char* AMBIGUOUS_LABEL_SLUGS[] = {
    "error_code", "error_type", "mixed_water_temp", "pressure_sensor_t", "target_discharge_temp",
};
inline constexpr size_t AMBIGUOUS_LABEL_SLUG_COUNT =
    sizeof(AMBIGUOUS_LABEL_SLUGS) / sizeof(AMBIGUOUS_LABEL_SLUGS[0]);

inline bool label_slug_is_ambiguous(const std::string& obj) {
    for (size_t i = 0; i < AMBIGUOUS_LABEL_SLUG_COUNT; i++)
        if (obj == AMBIGUOUS_LABEL_SLUGS[i]) return true;
    return false;
}

// The HA friendly name: the catalog label, group-qualified only when that label is reused across
// pages (see the ledger above).
inline std::string entity_name(const ValueDef& def) {
    if (!label_slug_is_ambiguous(object_id(def.label))) return def.label;
    std::string n = group_display_name(group_for_page(def.reg));
    n += ' ';
    n += def.label;
    return n;
}

inline std::string discovery_topic(const std::string& prefix, const std::string& node,
                                   const ValueDef& def) {
    return prefix + "/" + ha_component(def) + "/" + node + "/" + row_object_id(def) + "/config";
}

// The topic shapes a value's discovery config was published on by builds BEFORE #221, when the
// object segment was the bare label slug with no register group. TWO exist per row: every build ever
// wrote the `sensor` form, and builds after the binary_sensor split wrote the `binary_sensor` form
// for a bit-flag row. Both are RETAINED, so both outlive an upgrade as permanently-unavailable
// duplicate entities unless the bridge deletes them (zero-length retained publish) — the
// RETIRED_CRASH_SENSORS pattern, except the old topic is derivable from the row instead of needing a
// hand-maintained table.
//
// A FROZEN literal shape, never built from today's helpers: a migration that derives what the
// previous build wrote from the current code deletes whatever the current code would write, i.e.
// nothing. `component` is the caller's choice precisely so both shapes are reachable.
inline std::string ungrouped_discovery_topic(const std::string& prefix, const std::string& node,
                                             const char* component, const ValueDef& def) {
    return prefix + "/" + component + "/" + node + "/" + object_id(def.label) + "/config";
}

inline std::string x10a_topic(const std::string& base) {
    return base + "/x10a";
}

inline std::string modbus_topic(const std::string& base) {
    return base + "/modbus";
}

inline std::string modbus_availability_topic(const std::string& base) {
    return base + "/modbus/status";
}

// Builds before the source split published X10A values here. mqtt_ha.cpp deletes this retained topic
// on every connect so an upgraded broker cannot keep presenting a frozen legacy payload.
inline std::string legacy_state_topic(const std::string& base) {
    return base + "/state";
}

// Device availability topic (LWT): <base>/status -> "online"/"offline".
inline std::string availability_topic(const std::string& base) {
    return base + "/status";
}

// Discovery config JSON for one X10A value. `state_topic` is the shared X10A grouped-JSON topic; the
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
    // name/uniq_id are the ENTITY identity and carry the group (#221); `obj` below is the STATE key
    // and must not — it is what mqtt_group.hpp nests and what VictoriaMetrics is keyed on (#217).
    j += "\"name\":\"";       j += entity_name(def); j += "\",";
    j += "\"uniq_id\":\"";    j += node; j += "_"; j += row_object_id(def); j += "\",";
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

// ── HomeHub Modbus entities ─────────────────────────────────────────────────────────────────────
// A separate HA device group and a flat payload. These are sensor/binary_sensor discovery configs
// only: no command topic, number, switch, select or other writable component is ever emitted.
inline const char* modbus_ha_component(const def::HomeHubReg& reg) {
    return def::homehub_is_binary(reg) ? "binary_sensor" : "sensor";
}

inline std::string modbus_discovery_topic(const std::string& prefix, const std::string& x10a_node,
                                          const def::HomeHubReg& reg) {
    const std::string node = modbus_device_node_id(x10a_node);
    return prefix + "/" + modbus_ha_component(reg) + "/" + node + "/" +
           object_id(reg.label) + "/config";
}

inline std::string modbus_device_class(const def::HomeHubReg& reg) {
    if (std::string(reg.unit) == "°C") return "temperature";
    if (std::string(reg.unit) == "kW") return "power";
    return "";
}

inline std::string modbus_discovery_config(const std::string& x10a_node,
                                           const std::string& state_topic,
                                           const std::string& device_avail_topic,
                                           const std::string& modbus_avail_topic,
                                           const def::HomeHubReg& reg) {
    const std::string node = modbus_device_node_id(x10a_node);
    const std::string obj  = object_id(reg.label);
    const std::string dc   = modbus_device_class(reg);
    std::string j = "{";
    j += "\"name\":\"";       j += reg.label; j += "\",";
    j += "\"uniq_id\":\"";    j += node; j += "_"; j += obj; j += "\",";
    j += "\"stat_t\":\"";     j += state_topic; j += "\",";
    j += "\"val_tpl\":\"{{ value_json['"; j += obj; j += "'] }}\",";
    // BOTH conditions must be online: the board/MQTT client (LWT) and this independent HomeHub link.
    // A single shared availability topic would leave old Modbus states looking live after a LAN/link
    // failure; a Modbus-only one would miss an ESP32 crash whose retained link status was still online.
    j += "\"avty\":[{\"topic\":\""; j += device_avail_topic;
    j += "\"},{\"topic\":\""; j += modbus_avail_topic; j += "\"}],\"avty_mode\":\"all\",";
    if (def::homehub_is_binary(reg)) j += "\"pl_on\":\"1\",\"pl_off\":\"0\",";
    if (reg.unit[0]) { j += "\"unit_of_meas\":\""; j += reg.unit; j += "\","; }
    if (!dc.empty()) { j += "\"dev_cla\":\""; j += dc; j += "\",\"stat_cla\":\"measurement\","; }
    j += modbus_device_json(x10a_node);
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
    return scoped_object_id(group, key);   // same rule as a catalog row's id — see row_object_id
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
