#pragma once
// Publish-only-changed-values logic for the MQTT bridge. IDF-free + host-tested. The heat pump is
// polled at a short interval for near-real-time readings, but Home Assistant should only receive a
// value when it actually changed — so the (pending) esp-mqtt client keeps a snapshot of what it
// last published and, each cycle, publishes only the delta. This header is that pure decision;
// mqtt_ha.cpp calls it once the client is wired (currently a stub — see docs/ARCHITECTURE.md).
#include <string>
#include <vector>

namespace daik {

// One publishable reading: key = HA object_id (state-topic field), value = formatted string.
struct PubValue {
    std::string key;
    std::string value;
};

// Return the subset of `current` that changed versus `prev` (a key absent from `prev`, or with a
// different value, counts as changed; an unchanged value is skipped). Pure — does not mutate; after
// publishing the returned deltas the caller replaces its stored snapshot with `current`. O(n·m) but
// the value set is small (a few dozen per profile). A full retained republish (all values) is done
// separately on (re)connect, not here.
inline std::vector<PubValue> mqtt_changed(const std::vector<PubValue>& prev,
                                          const std::vector<PubValue>& current) {
    std::vector<PubValue> out;
    for (const auto& cur : current) {
        const std::string* was = nullptr;
        for (const auto& p : prev) if (p.key == cur.key) { was = &p.value; break; }
        if (!was || *was != cur.value) out.push_back(cur);
    }
    return out;
}

} // namespace daik
