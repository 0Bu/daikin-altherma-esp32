#pragma once
// Home Assistant MQTT-Discovery bridge. Its own task: connects to mqtt_uri (mqtts + CA-verified
// when credentials are present — no silent plaintext fallback), streams one discovery config
// per value on (re)connect (logic/discovery.hpp), republishes retained heat-pump state when its
// value set changes, and publishes each fresh ENV III sample on its own retained topic with three
// discovery entities (temperature, humidity, pressure). Read-only: no command subscriptions —
// optional exact inbound subscriptions assemble one configured room sample and never actuate the
// heat pump. No-op if mqtt_uri is empty.
#include <cstdint>
#include <string>
#include "logic/heating_curve_diagnosis.hpp"
#include "logic/circulation_source.hpp"
#include "logic/reference_temperature.hpp"

namespace daik {

void mqtt_ha_start();

// For /status.mqtt
struct MqttStatus { bool configured=false, connected=false, tls=false; std::string broker, error; };
MqttStatus mqtt_status();

// Publish cycles that produced nothing, since boot — the heartbeat's mqtt_skipped/mqtt_quiesced
// (#380). `skipped` threw and lost the reading; `quiesced` stood aside on purpose while an OTA
// download or weather fetch owned the heap (logic/ota_quiesce.hpp). Reported on /status too, and not only on the
// heartbeat, because the heartbeat needs a BROKER: an installation whose MQTT is misconfigured — or
// one being debugged over the LAN with nothing subscribed — is exactly where a reader is asking why
// values keep disappearing, and it is the one place that could not answer.
struct MqttSkipStats { uint32_t skipped = 0, quiesced = 0; };
MqttSkipStats mqtt_skip_stats();

// Has the firmware publish cycle left its allocating work, with no esp-mqtt TLS handshake/reconnect
// in flight? True when no publisher task exists. Weather and OTA use this acknowledgement before TLS.
bool mqtt_publish_network_quiesced();

// Observation + decision-readiness status for the one configured living-room source. `received_ms` is
// monotonic MQTT arrival time; source_unix_s is present only when the configured payload field was
// parsed. The status endpoint derives freshness from these without mutating the captured sample.
// The write-free shadow controller reads this canonical view. There is no actuator to call.
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

// Last write-free controller evaluation. The state machine is owned by mqtt_task and guarded by
// the MQTT status mutex; HTTP/status readers receive a copy. No actuator object crosses this API.
logic::HeatingCurveSnapshot heating_curve_status();

// Wake the existing MQTT task after POST /set_ref_temp. Topic changes are re-evaluated live without
// a second MQTT client or reboot, but subscription/decoding remains gated by the v19 diagnostics
// master. Once enabled, the new binding starts without a value and becomes usable only after its
// runtime decoder accepts a fresh payload.
void mqtt_reference_reconfigure();

// Independent read-only power witness for the potable-water circulation pump.  It shares the
// already-authenticated MQTT client but has its own exact topic, parser, freshness and test proof.
struct CirculationSourceStatus {
    bool configured=false, subscribed=false, has_value=false, retained=false, has_source_time=false;
    bool fresh=false, age_known=false;
    double power_w=0.0;
    uint64_t received_ms=0, age_s=0;
    int64_t received_unix_s=-1, source_unix_s=-1;
    uint32_t messages=0, errors=0, rejections=0;
    CirculationPowerState state=CirculationPowerState::Unknown;
    std::string timestamp_source, freshness_reason, error;
};
CirculationSourceStatus circulation_source_status();

struct CirculationPumpSample { bool configured=false, known=false, on=false; };
CirculationPumpSample circulation_pump_sample();

struct CirculationSourceTestConfig {
    std::string topic, power_path, timestamp_path;
    uint32_t max_age_s=0;
    uint16_t on_tenths_w=0, off_tenths_w=0, confirm_s=0;
};
struct CirculationSourceTestResult {
    bool passed=false, retained=false;
    double power_w=0.0;
    CirculationPowerState state=CirculationPowerState::Unknown;
    uint32_t proof=0;
    std::string error;
};
CirculationSourceTestResult mqtt_circulation_test(const CirculationSourceTestConfig& candidate,
                                                  uint32_t timeout_ms);
bool mqtt_circulation_test_proof_valid(uint32_t proof,
                                       const CirculationSourceTestConfig& candidate);
void mqtt_circulation_reconfigure();

// Explicit Settings disables own these two retained-topic tombstones. They are the only outbound
// MQTT operations allowed before X10A proves installation publication authority; ordinary state,
// discovery, diagnostics and automatic cleanup remain gated. Requests stay pending while the
// broker is disconnected and are discarded if the corresponding source is re-enabled first.
void mqtt_request_weather_cleanup();
void mqtt_request_modbus_cleanup();

} // namespace daik
