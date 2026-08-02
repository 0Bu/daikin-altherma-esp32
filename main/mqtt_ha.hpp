#pragma once
// Home Assistant MQTT-Discovery bridge. Its own task: connects to mqtt_uri (mqtts + CA-verified
// when credentials are present — no silent plaintext fallback), streams one discovery config
// per value on (re)connect (logic/discovery.hpp), then republishes the retained state
// JSON whenever the value set changes (checked each poll cycle). Read-only: no command subscriptions —
// the one optional inbound subscription captures a configured reference-temperature number and
// never actuates the heat pump. No-op if mqtt_uri is empty.
#include <cstdint>
#include <string>

namespace daik {

void mqtt_ha_start();

// For /status.mqtt
struct MqttStatus { bool configured=false, connected=false, tls=false; std::string broker, error; };
MqttStatus mqtt_status();

// Observation status for the one configured reference-temperature source. `received_ms` is
// monotonic MQTT arrival time; source_unix_s is present only when the configured payload field was
// parsed. The status endpoint derives freshness from these without mutating the captured sample.
// No heat-pump control logic reads this yet.
struct ReferenceTemperatureStatus {
    bool configured=false, subscribed=false, has_value=false, retained=false, has_source_time=false;
    double temperature_c=0.0;
    uint64_t received_ms=0;
    int64_t received_unix_s=-1;
    int64_t source_unix_s=-1;
    uint32_t messages=0, errors=0;
    std::string timestamp_source, error;
};
ReferenceTemperatureStatus reference_temperature_status();

// Wake the existing MQTT task after POST /set_ref_temp. Topic changes are applied live; the
// firmware does not create a second MQTT client and does not reboot.
void mqtt_reference_reconfigure();

} // namespace daik
