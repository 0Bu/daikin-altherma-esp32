#pragma once
#include <cstdint>

// X10A owns the outbound MQTT identity, not the broker connection. A board that has never received
// an X10A reply may still connect WITHOUT the installation LWT and subscribe to its configured
// reference-temperature topic, but it must not publish discovery, diagnostics, auxiliary-source
// data or cleanup tombstones. The first X10A reply promotes that read-only session to the ordinary
// LWT-bearing publisher. A later, CONFIRMED bus loss marks an already-active installation offline
// once, then suppresses every ordinary publish until the bus returns; inbound subscriptions stay
// alive. X10A occasionally loses a whole poll sweep, so the current-cycle bit alone is not outage
// evidence. The monotonic age of the last answering sweep provides the debounce without hiding a
// sustained cable/unit failure.

namespace daik {

enum class MqttPublishGateState {
    SubscriberOnly,
    Active,
    Paused,
};

// The poll loop runs nominally once per second, but each sweep also spends time on the wire. Use
// elapsed source age rather than a cycle counter so MQTT/TLS hold-offs cannot stretch or shorten the
// outage decision. This matches the existing plant-observation boundary: a gap of 15 seconds is no
// longer continuous evidence (logic/checkup.hpp).
inline constexpr int32_t MQTT_X10A_OFFLINE_GRACE_S = 15;

inline constexpr bool mqtt_x10a_available(bool x10a_connected, int32_t last_ok_s) {
    return x10a_connected ||
           (last_ok_s >= 0 && last_ok_s < MQTT_X10A_OFFLINE_GRACE_S);
}

struct MqttPublishGateDecision {
    MqttPublishGateState next = MqttPublishGateState::SubscriberOnly;
    bool promote_publisher = false; // first X10A proof: reconnect with the installation LWT armed
    bool publish_cycle = false;    // ordinary discovery/state/heartbeat publication is allowed
    bool publish_offline = false;  // one transition marker for a previously active installation
    bool resumed = false;          // bus recovered without requiring a broker reconnect
};

inline MqttPublishGateDecision mqtt_publish_gate_step(MqttPublishGateState state,
                                                      bool x10a_connected,
                                                      int32_t x10a_last_ok_s,
                                                      bool mqtt_connected) {
    MqttPublishGateDecision d;
    d.next = state;
    const bool x10a_available = mqtt_x10a_available(x10a_connected, x10a_last_ok_s);
    switch (state) {
    case MqttPublishGateState::SubscriberOnly:
        if (x10a_available) {
            d.next = MqttPublishGateState::Active;
            d.promote_publisher = true;
        }
        break;
    case MqttPublishGateState::Active:
        if (x10a_available) {
            d.publish_cycle = mqtt_connected;
        } else {
            d.next = MqttPublishGateState::Paused;
            d.publish_offline = mqtt_connected;
        }
        break;
    case MqttPublishGateState::Paused:
        if (x10a_available) {
            d.next = MqttPublishGateState::Active;
            d.publish_cycle = mqtt_connected;
            d.resumed = true;
        }
        break;
    }
    return d;
}

} // namespace daik
