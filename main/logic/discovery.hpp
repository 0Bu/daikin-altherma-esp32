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

inline std::string discovery_topic(const std::string& prefix, const std::string& node,
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
    if (!unit.empty()) { j += "\"unit_of_meas\":\""; j += unit; j += "\","; }
    if (!dc.empty())   { j += "\"dev_cla\":\"";      j += dc;   j += "\","; j += "\"stat_cla\":\"measurement\","; }
    j += "\"dev\":{\"ids\":[\""; j += node; j += "\"],\"name\":\"Daikin Altherma\",";
    j += "\"mf\":\"Daikin\",\"mdl\":\"Altherma\"}";
    j += "}";
    return j;
}

} // namespace daik
