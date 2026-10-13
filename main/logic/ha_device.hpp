#pragma once
// The Home Assistant DEVICE identity published by this firmware. X10A values, board/link
// diagnostics and the crash report are discovery surfaces of ONE installation and therefore share
// one device identifier. HomeHub Modbus values remain on MQTT but are not exposed to HA.
//
// The id is derived from the MQTT BASE TOPIC — the INSTALLATION — and NOT from the board's MAC.
// It used to be `daikin_<mac3>`, which made the HA device an identity of the *hardware*: replacing
// the ESP32 produced a second "Daikin Altherma" device with a fresh set of entities, and every
// long-term statistic started over (the old entities stayed behind as permanently-unavailable
// duplicates). One base topic already means one board (the message topics sit directly under it),
// so the base topic is the honest identity: swap the board, keep the device.
//
// The secondary hardware identifier uses the complete MAC in a separate namespace. The historical
// three-byte alias can identify more than one board, so it is retired through the explicit owner
// migration in docs/MQTT.md rather than advertised as a compatibility alias.
// Pure + IDF-free so the exact bytes HA receives are asserted on the host (test/test_logic.cpp).
#include <cstdint>
#include <string>

namespace daik {

// Slug rules shared by every id this firmware generates (HA object ids, the device node id):
// lowercase, keep alnum, collapse every other run into a single '_', no leading/trailing '_'.
//
// The append form is the allocation-free primitive. It delays a separator until the next
// alphanumeric byte, so trailing punctuation never needs a pop_back-capable owning string. That
// lets the X10A JSON counting and writing passes use the exact same slugger with their non-owning
// sinks instead of materialising one std::string per row.
template <typename Out>
inline void ha_slug_append(Out& out, const char* s) {
    bool emitted = false;
    bool separator_pending = false;
    for (const char* p = s ? s : ""; *p; ++p) {
        char c = *p;
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        const bool alnum = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        if (!alnum) {
            if (emitted) separator_pending = true;
            continue;
        }
        if (separator_pending) out += '_';
        out += c;
        emitted = true;
        separator_pending = false;
    }
}

inline void ha_slug_into(std::string& o, const char* s) {
    o.clear();
    ha_slug_append(o, s);
}

// The owning form remains for discovery and host helpers. The per-second X10A state path uses the
// append form directly, avoiding one temporary heap string per label.
inline std::string ha_slug(const char* s) {
    std::string o;
    ha_slug_into(o, s);
    return o;
}

// Lowercase alphanumeric segments separated by one '-' retain their existing node. Every other
// accepted raw base is encoded exactly in a namespace that the single-separator slugger cannot
// produce. MQTT validates the raw base's size and alphabet before it reaches this builder.
inline bool ha_canonical_installation_base(const std::string& base) {
    bool needs_alnum = true;
    for (const unsigned char c : base) {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            needs_alnum = false;
        } else if (c == '-' && !needs_alnum) {
            needs_alnum = true;
        } else {
            return false;
        }
    }
    return !needs_alnum;
}

inline std::string device_node_id(const std::string& base) {
    std::string id = ha_slug(base.c_str());
    if (id.empty()) return "daikin"; // invalid/non-sluggable callers; accepted bases never use this
    if (ha_canonical_installation_base(base)) return id;
    id                   = "daikin_altherma_esp32__";
    constexpr char hex[] = "0123456789abcdef";
    for (const unsigned char c : base) {
        id += hex[c >> 4];
        id += hex[c & 15];
    }
    return id;
}

// Full hardware identities are disjoint from both canonical nodes and the raw-base hex namespace.
// Missing, multicast and sentinel addresses cannot become a shared synthetic identity.
inline std::string ha_board_id(const uint8_t* mac, size_t length) {
    if (!mac || length != 6 || (mac[0] & 1)) return {};
    bool all_zero = true;
    for (size_t i = 0; i < length; ++i) all_zero = all_zero && mac[i] == 0;
    if (all_zero) return {};
    std::string    id    = "daikin_altherma_esp32__board_";
    constexpr char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < length; ++i) {
        id += hex[mac[i] >> 4];
        id += hex[mac[i] & 15];
    }
    return id;
}

// Preserve the two deployed legacy entity sets; their suffixes are checked against real catalogs.
// Every custom installation has an unambiguous node/entity boundary, including canonical nodes.
inline const char* ha_entity_separator(const std::string& node) noexcept {
    return node == "daikin_altherma_esp32" || node == "daikin_altherma_esp32_bench" ? "_" : "__";
}

// An HA entity this firmware ONCE published and no longer does. Its retained discovery config must
// be actively DELETED (a zero-length retained publish to the old topic), or an install upgraded from
// an older build keeps a stale, permanently-"unavailable" entity forever — the broker replays the
// config to HA on every restart, and nothing else will ever contradict it.
//
// Here rather than beside either list because BOTH diagnostic surfaces retire entities under the
// same rule and the same failure mode: crashinfo.hpp's RETIRED_CRASH_SENSORS ("Last Reset Reason",
// an exact duplicate of the heartbeat's own) and heartbeat.hpp's RETIRED_HEARTBEAT_SENSORS. A
// retired id is also permanently BURNED — test_entity_identity() refuses to let a live entity claim
// one back, since it would inherit the corpse instead of getting a fresh registry entry.
struct RetiredHaSensor {
    const char* component;   // discovery-topic <component> segment ("sensor" | "binary_sensor")
    const char* object_id;
};

// Share the fixed discovery identity sequence without extra temporary strings. Names and object
// IDs here are repository literals; the installation node has already passed the slug rules.
inline __attribute__((noinline)) void ha_discovery_identity(std::string&       out,
                                                            const std::string& node,
                                                            const char*        name,
                                                            const char*        object_id) {
    out += "\"name\":\"";
    out += name;
    out += "\",\"uniq_id\":\"";
    out += node;
    out += ha_entity_separator(node);
    out += object_id;
    out += "\",";
}

// The `dev` object of a discovery config: the stable installation id first, this board's own id
// second (omitted when empty, or when it IS the stable id — HA rejects a duplicated identifier).
inline std::string device_json(const std::string& node, const std::string& board_id) {
    std::string j = "\"dev\":{\"ids\":[\"";
    j += node; j += "\"";
    if (!board_id.empty() && board_id != node) { j += ",\""; j += board_id; j += "\""; }
    j += "],\"name\":\"Daikin Altherma\",\"mf\":\"Daikin\",\"mdl\":\"Altherma X10A\"}";
    return j;
}

// Retired Modbus discovery used a source-specific entity namespace so an identically named X10A
// entity could not collide with it. Keep the frozen namespace builder so firmware upgrades can
// publish retained tombstones to the exact old topics.
inline std::string modbus_entity_node_id(const std::string& x10a_node) {
    return x10a_node + "_modbus";
}

} // namespace daik
