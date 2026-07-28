#pragma once
// Register-page -> friendly MQTT group name, plus the grouped-JSON state payload builder. IDF-free
// and host-tested (test/test_logic.cpp) so the exact bytes the broker — and Home Assistant's
// value_template / a Telegraf JSON parser — receive are asserted on the host, not the device.
//
// The MQTT bridge publishes ONE retained JSON object to <base>/state per cycle. Values are
// grouped one level deep by their X10A register page:
//     { "<group>": { "<object_id>": value, … }, … }   (max nesting depth 1)
// Each HA discovery config points every sensor at this shared topic with a value_template that
// subscripts the group + object (logic/discovery.hpp).
#include <cstdint>
#include <string>
#include <vector>
#include "json.hpp"   // json_append_escaped — the shared RFC 8259 string encoder

namespace daik {

// X10A register page -> stable, human-readable group key (docs/X10A_PROTOCOL.md §5 page catalog).
// Pages outside the catalog fall back to "other". Names are snake_case and safe as raw JSON keys.
inline const char* group_for_page(uint8_t reg) {
    switch (reg) {
        case 0x00: return "outdoor_identity";
        case 0x10: return "outdoor_state";
        case 0x11: return "outdoor_eeprom";
        case 0x20: return "outdoor_sensors";
        case 0x21: return "inverter";
        case 0x30: return "actuators";
        case 0xA0: return "outdoor_aux";
        case 0xA1: return "water_hx";
        case 0x60: return "hydronic";
        case 0x61: return "hydronic_temps";
        case 0x62: return "hydronic_state";
        case 0x63: return "mains_current";
        case 0x64: return "hybrid";
        case 0x65: return "mixing";
        default:   return "other";
    }
}

// True if `s` is a JSON number as produced by hp_format ("-3.5", "48", "0.0"): an optional leading
// '-', at least one digit, at most one '.' with a digit on each side. Enum/text values ("Heating",
// "A1", "R32") are not. Numbers are emitted unquoted, text quoted.
inline bool is_json_number(const std::string& s) {
    if (s.empty()) return false;
    size_t i = 0;
    if (s[i] == '-' && ++i == s.size()) return false;
    bool digit = false, dot = false;
    for (; i < s.size(); ++i) {
        const char c = s[i];
        if (c >= '0' && c <= '9') { digit = true; continue; }
        if (c == '.' && !dot && digit) {                 // one dot, and only after a digit
            dot   = true;
            digit = false;                               // now require a fractional digit
            continue;
        }
        return false;
    }
    return digit;
}

// One publishable reading destined for the grouped JSON.
struct GroupedValue {
    std::string group;   // group_for_page(reg)
    std::string key;     // object_id(label)
    std::string value;   // formatted string (hp_format)
};

// Build the retained state payload { "<group>": { "<key>": value, … }, … }. Groups and keys keep
// first-seen order (the poll cache is already page-ordered). Numeric values are emitted unquoted,
// enum/text values quoted. Pure — the device streams the result to <base>/state.
inline std::string build_grouped_json(const std::vector<GroupedValue>& vals) {
    std::vector<std::string>                     order;    // group names, in first-seen order
    std::vector<std::vector<const GroupedValue*>> buckets; // values per group, index-aligned to order
    for (const auto& v : vals) {
        size_t gi = 0;
        for (; gi < order.size(); ++gi) if (order[gi] == v.group) break;
        if (gi == order.size()) { order.push_back(v.group); buckets.emplace_back(); }
        buckets[gi].push_back(&v);
    }
    std::string j = "{";
    j.reserve(vals.size() * 32 + 16);                     // avoid incremental-doubling realloc churn
    for (size_t gi = 0; gi < order.size(); ++gi) {
        if (gi) j += ',';
        j += '"'; j += order[gi]; j += "\":{";
        const auto& bucket = buckets[gi];
        for (size_t k = 0; k < bucket.size(); ++k) {
            if (k) j += ',';
            j += '"'; j += bucket[k]->key; j += "\":";
            const std::string& val = bucket[k]->value;
            if (is_json_number(val)) { j += val; }
            else { j += '"'; json_append_escaped(j, val); j += '"'; }
        }
        j += '}';
    }
    j += '}';
    return j;
}

} // namespace daik
