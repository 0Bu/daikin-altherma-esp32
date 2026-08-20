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
// The board's MAC-derived id stays in play as a SECOND `dev.ids` entry: HA's device registry matches
// a device by ANY of its identifiers and merges the rest in, so an install upgrading from a
// MAC-identified build keeps its existing device (and with it its area, name and device-level
// settings) instead of gaining a third one. It also keeps the identifier a downgrade would publish.
// Pure + IDF-free so the exact bytes HA receives are asserted on the host (test/test_logic.cpp).
#include <string>

namespace daik {

// Slug rules shared by every id this firmware generates (HA object ids, the device node id):
// lowercase, keep alnum, collapse every other run into a single '_', no leading/trailing '_'.
inline void ha_slug_into(std::string& o, const char* s) {
    o.clear();
    for (const char* p = s; *p; ++p) {
        char c = *p;
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) o += c;
        else if (!o.empty() && o.back() != '_')             o += '_';
    }
    while (!o.empty() && o.back() == '_') o.pop_back();
}

// The owning form. The into-slot form above exists so the per-second X10A publish path can re-slug
// into a reused string buffer (private issue 10): the returned temporary here is a heap allocation
// for every label longer than the SSO buffer, once per row per cycle, which is exactly the churn the
// bounded publish buffer removes.
inline std::string ha_slug(const char* s) {
    std::string o;
    ha_slug_into(o, s);
    return o;
}

// The HA device / discovery-topic node id for an installation, from its MQTT base topic:
// "daikin-altherma-esp32" -> "daikin_altherma_esp32". Board-independent BY DESIGN (see above).
// A base topic that slugifies to nothing still has to yield a usable topic segment, so it falls
// back to a constant rather than producing "<prefix>/sensor//<obj>/config".
inline std::string device_node_id(const std::string& base) {
    std::string id = ha_slug(base.c_str());
    return id.empty() ? std::string("daikin") : id;
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
