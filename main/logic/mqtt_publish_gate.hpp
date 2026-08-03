#pragma once
// X10A owns the outbound MQTT identity, not the broker connection. A board that has never received
// an X10A reply may still connect WITHOUT the installation LWT and subscribe to its configured
// reference-temperature topic, but it must not publish discovery, diagnostics, auxiliary-source
// data or cleanup tombstones. The first X10A reply promotes that read-only session to the ordinary
// LWT-bearing publisher. A later bus loss marks an already-active installation offline once, then
// suppresses every ordinary publish until the bus returns; inbound subscriptions stay alive.

namespace daik {

enum class MqttPublishGateState {
    SubscriberOnly,
    Active,
    Paused,
};

struct MqttPublishGateDecision {
    MqttPublishGateState next = MqttPublishGateState::SubscriberOnly;
    bool promote_publisher = false; // first X10A proof: reconnect with the installation LWT armed
    bool publish_cycle = false;    // ordinary discovery/state/heartbeat publication is allowed
    bool publish_offline = false;  // one transition marker for a previously active installation
    bool resumed = false;          // bus recovered without requiring a broker reconnect
};

inline MqttPublishGateDecision mqtt_publish_gate_step(MqttPublishGateState state,
                                                      bool x10a_connected,
                                                      bool mqtt_connected) {
    MqttPublishGateDecision d;
    d.next = state;
    switch (state) {
    case MqttPublishGateState::SubscriberOnly:
        if (x10a_connected) {
            d.next = MqttPublishGateState::Active;
            d.promote_publisher = true;
        }
        break;
    case MqttPublishGateState::Active:
        if (x10a_connected) {
            d.publish_cycle = mqtt_connected;
        } else {
            d.next = MqttPublishGateState::Paused;
            d.publish_offline = mqtt_connected;
        }
        break;
    case MqttPublishGateState::Paused:
        if (x10a_connected) {
            d.next = MqttPublishGateState::Active;
            d.publish_cycle = mqtt_connected;
            d.resumed = true;
        }
        break;
    }
    return d;
}

} // namespace daik
