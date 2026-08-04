#pragma once
// Home Assistant MQTT-Discovery bridge. Its own task: connects to mqtt_uri (mqtts + CA-verified
// when credentials are present — no silent plaintext fallback), streams one discovery config
// per value on (re)connect (logic/discovery.hpp), republishes retained heat-pump state when its
// value set changes, and publishes each fresh ENV III sample on its own retained topic with three
// discovery entities (temperature, humidity, pressure). Read-only: no command subscriptions —
// the one optional inbound subscription captures a configured reference-temperature number and
// never actuates the heat pump. No-op if mqtt_uri is empty.
#include <cstdint>
#include <string>
#include "logic/reference_temperature.hpp"

namespace daik {

void mqtt_ha_start();

// For /status.mqtt
struct MqttStatus { bool configured=false, connected=false, tls=false; std::string broker, error; };
MqttStatus mqtt_status();

// Observation + decision-readiness status for the one configured living-room source. `received_ms` is
// monotonic MQTT arrival time; source_unix_s is present only when the configured payload field was
// parsed. The status endpoint derives freshness from these without mutating the captured sample.
// No heat-pump control logic reads this yet; the canonical fields are evidence for the later shadow
// controller and never call the HomeHub actuator.
struct ReferenceTemperatureStatus {
    bool configured=false, subscribed=false, has_value=false, retained=false, has_source_time=false;
    double temperature_c=0.0;
    bool has_setpoint=false, has_enabled=false, enabled=false, has_hvac_mode=false;
    double setpoint_c=0.0;
    uint64_t received_ms=0;
    int64_t received_unix_s=-1;
    int64_t source_unix_s=-1;
    uint32_t messages=0, errors=0, rejections=0;
    ReferenceRoomReason rejection_reason=ReferenceRoomReason::InvalidPayload;
    std::string hvac_mode, timestamp_source, eligibility_error, error;
};
ReferenceTemperatureStatus reference_temperature_status();

// A candidate mapping is tested on the existing authenticated MQTT connection without publishing
// it to Config/NVS. The call waits for one value that passes the same JSON/timestamp/freshness
// checks as the live source. `proof` is non-zero only after that value arrived; POST /set_ref_temp
// presents it back so an untested mapping cannot be persisted through either the UI or a raw POST.
struct ReferenceTemperatureTestConfig {
    std::string topic, temperature_path, setpoint_path, timestamp_path, enabled_path, hvac_mode_path;
    uint32_t max_age_s = 0;
};
struct ReferenceTemperatureTestResult {
    bool passed=false, retained=false;
    bool control_eligible=false, has_enabled=false, enabled=false, has_hvac_mode=false;
    double temperature_c=0.0, setpoint_c=0.0, room_error_k=0.0;
    uint32_t proof=0;
    ReferenceRoomReason reason=ReferenceRoomReason::InvalidPayload;
    std::string hvac_mode, error;
};
ReferenceTemperatureTestResult mqtt_reference_test(const ReferenceTemperatureTestConfig& candidate,
                                                    uint32_t timeout_ms);
bool mqtt_reference_test_proof_valid(uint32_t proof,
                                     const ReferenceTemperatureTestConfig& candidate);

// Wake the existing MQTT task after POST /set_ref_temp. Topic changes are applied live; the
// firmware does not create a second MQTT client and does not reboot. This also retires the consumed
// transient test proof.
void mqtt_reference_reconfigure();

// Explicit Settings disables own these two retained-topic tombstones. They are the only outbound
// MQTT operations allowed before X10A proves installation publication authority; ordinary state,
// discovery, diagnostics and automatic cleanup remain gated. Requests stay pending while the
// broker is disconnected and are discarded if the corresponding source is re-enabled first.
void mqtt_request_weather_cleanup();
void mqtt_request_modbus_cleanup();

} // namespace daik
