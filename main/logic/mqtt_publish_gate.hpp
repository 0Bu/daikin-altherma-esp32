#pragma once
#include <cstdint>

// MQTT transport and X10A are separate availability authorities. Every client carries the broker
// LWT; auxiliary sources, diagnostics and subscriptions do not depend on this X10A-only gate.
// X10A occasionally loses a whole poll sweep, so the current-cycle bit alone is not outage
// evidence. The monotonic age of the last answering sweep provides the debounce without hiding a
// sustained cable/unit failure. The only other `offline` is the OTA-pause withdrawal at the end of
// this file.

namespace daik {

enum class MqttPublishGateState {
    Unavailable,
    Active,
    Paused,
};

// A retained auxiliary source has two independent facts during reconfiguration: the durable target
// intent changes synchronously, while its worker may remain alive until the next task cycle.
// Publish from the intent, never from task-liveness, or a disable can tombstone and then recreate
// retained `{}` before the retiring worker observes its stop request. An enabled A-to-B cutover
// deliberately publishes the new source's empty state after deleting A; it is configured even
// before B answers.
enum class RetainedSourceAction {
    PublishCurrent,
    DeleteRetained,
    Idle,
};

inline constexpr RetainedSourceAction retained_source_action(bool target_enabled,
                                                             bool retained_deleted) {
    if (target_enabled) return RetainedSourceAction::PublishCurrent;
    return retained_deleted ? RetainedSourceAction::Idle : RetainedSourceAction::DeleteRetained;
}

// The poll loop runs nominally once per second, but each sweep also spends time on the wire. Use
// elapsed source age rather than a cycle counter so MQTT/TLS hold-offs cannot stretch or shorten the
// outage decision. This matches the existing plant-observation boundary: a gap of 15 seconds is no
// longer continuous evidence (logic/checkup.hpp).
inline constexpr int32_t MQTT_X10A_OFFLINE_GRACE_S = 15;

inline constexpr bool x10a_source_is_recent(int32_t last_ok_s) {
    return last_ok_s >= 0 && last_ok_s < MQTT_X10A_OFFLINE_GRACE_S;
}

// Apply the same observation boundary to an actual monotonic source timestamp. Unknown and
// future timestamps cannot establish freshness; subtract only after that ordering check.
inline constexpr bool x10a_source_time_is_recent(int64_t now_us, int64_t observed_us) {
    return observed_us >= 0 && now_us >= observed_us &&
           now_us - observed_us < static_cast<int64_t>(MQTT_X10A_OFFLINE_GRACE_S) * 1000000;
}

inline constexpr bool mqtt_x10a_available(bool x10a_connected, int32_t last_ok_s) {
    (void)x10a_connected; // current-cycle loss is debounced solely by the last real observation
    return x10a_source_is_recent(last_ok_s);
}

// Cache expiry changes the wire state even when the worker committed no new revision. Retrying a
// failed publication must also leave the previous revision/liveness marker in place.
inline constexpr bool mqtt_source_state_needs_publish(uint32_t revision,
                                                      uint32_t published_revision, bool live,
                                                      bool published_live,
                                                      bool have_published_payload) {
    return !have_published_payload || revision != published_revision || live != published_live;
}

struct MqttPublishGateDecision {
    MqttPublishGateState next          = MqttPublishGateState::Unavailable;
    bool                 publish_cycle = false; // X10A discovery/state publication is allowed
    bool publish_offline = false; // source withdrawal; runtime retries until SDK acceptance
    bool resumed = false;          // bus recovered without requiring a broker reconnect
};

inline MqttPublishGateDecision mqtt_publish_gate_step(MqttPublishGateState state, bool x10a_recent,
                                                      bool mqtt_connected) {
    MqttPublishGateDecision d;
    d.next = state;
    switch (state) {
    case MqttPublishGateState::Unavailable:
        if (x10a_recent) {
            d.next = MqttPublishGateState::Active;
            d.publish_cycle = mqtt_connected;
            d.resumed       = true;
        }
        break;
    case MqttPublishGateState::Active:
        if (x10a_recent) {
            d.publish_cycle = mqtt_connected;
        } else {
            d.next = MqttPublishGateState::Paused;
            d.publish_offline = mqtt_connected;
        }
        break;
    case MqttPublishGateState::Paused:
        if (x10a_recent) {
            d.next = MqttPublishGateState::Active;
            d.publish_cycle = mqtt_connected;
            d.resumed = true;
        }
        break;
    }
    return d;
}

// The network-heap pause stops esp-mqtt cleanly. Its DISCONNECT makes the broker discard the
// broker LWT while the retained availability still reads `online`. An OTA install ends in
// esp_restart() with that transport still stopped, so the retained transport status must be
// withdrawn before a clean stop even when no X10A reply has arrived.
// Every OTA pause therefore withdraws it first, the check too: an install always consumes a
// completed check, and when the install follows before an MQTTS client has passed its resume gate,
// the install's own pause finds the client already stopped. Otherwise the resumed publisher's
// ordinary reconnect announce restores transport `online` and the install withdraws it
// again; a check or failed install resumes the same way. A pause that finds the client stopped or
// reconnecting after an earlier stop cannot withdraw anything (docs/ARCHITECTURE.md).
// A Weather pause is never followed by a restart and keeps its short gap without availability
// churn. Every client carries this transport LWT, and only a connected client
// can still put the marker on the stream ahead of the DISCONNECT.
inline constexpr bool mqtt_pause_withdraws_online(bool ota_pause, bool publisher_client,
                                                  bool mqtt_connected) {
    return ota_pause && publisher_client && mqtt_connected;
}

} // namespace daik
