#pragma once
// X10A owns the outbound MQTT identity. A board that has never received an X10A reply may be an
// unwired bench/debug board carrying the same persisted base topic as the installed controller; it
// must not connect with the installation's LWT or publish discovery, diagnostics, auxiliary-source
// data or cleanup tombstones. After the first reply the normal MQTT client may start. A later bus
// loss marks an already-active installation offline once, then suppresses every publish until the
// bus returns.

namespace daik {

enum class MqttPublishGateState {
    WaitingForX10a,
    Active,
    Paused,
};

struct MqttPublishGateDecision {
    MqttPublishGateState next = MqttPublishGateState::WaitingForX10a;
    bool start_client = false;     // first X10A proof: the client (and only now its LWT) may start
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
    case MqttPublishGateState::WaitingForX10a:
        if (x10a_connected) {
            d.next = MqttPublishGateState::Active;
            d.start_client = true;
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
