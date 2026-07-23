#pragma once
// Home Assistant MQTT-Discovery payload builder. Pure string building, IDF-free, so the exact
// bytes HA receives are asserted on the host (test/test_logic.cpp) rather than on the device.
// mqtt_ha.cpp streams one of these per value on (re)connect; every sensor points at the ONE shared
// grouped-JSON state topic (logic/mqtt_group.hpp) via a value_template.
#include <string>
#include "value_def.hpp"
#include "convert.hpp"
#include "mqtt_group.hpp"

namespace daik {

// HA object_id: lowercase, alnum-only, spaces/others -> '_'.
inline std::string object_id(const char* label) {
    std::string o;
    for (const char* p = label; *p; ++p) {
        char c = *p;
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) o += c;
        else if (!o.empty() && o.back() != '_')             o += '_';
    }
    while (!o.empty() && o.back() == '_') o.pop_back();
    return o;
}

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
// availability.
inline std::string discovery_config(const std::string& node, const std::string& state_topic,
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
    // A binary row's state is the number 1/0 (logic/mqtt_group.hpp binary_state_number), which the
    // template renders as "1"/"0" — so pl_on/pl_off must be spelled out; HA's defaults are "ON"/"OFF"
    // and would leave every one of these entities stuck at `unknown`. No unit / device_class /
    // state_class: every 300-307 row is dataType -1, so unit and dc are empty here anyway, and a
    // meaningful HA device_class (running / problem / heat) is a per-LABEL domain judgement — exactly
    // the kind of guess that produced #35-#39 — so it is deliberately left unset rather than inferred.
    if (conv_is_binary(def.conv)) { j += "\"pl_on\":\"1\",\"pl_off\":\"0\","; }
    if (!unit.empty()) { j += "\"unit_of_meas\":\""; j += unit; j += "\","; }
    if (!dc.empty())   { j += "\"dev_cla\":\"";      j += dc;   j += "\","; j += "\"stat_cla\":\"measurement\","; }
    j += "\"dev\":{\"ids\":[\""; j += node; j += "\"],\"name\":\"Daikin Altherma\",";
    j += "\"mf\":\"Daikin\",\"mdl\":\"Altherma\"}";
    j += "}";
    return j;
}

} // namespace daik
