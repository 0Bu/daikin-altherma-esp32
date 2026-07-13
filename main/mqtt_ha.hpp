#pragma once
// Home Assistant MQTT-Discovery bridge. Its own task: connects to mqtt_uri (mqtts + CA-verified
// when credentials are present — no silent plaintext fallback), streams one discovery config
// per value on (re)connect (logic/discovery.hpp), then republishes the retained state
// JSON every DAIKIN_MQTT_PUBLISH_INTERVAL_S. Read-only: no command subscriptions — the firmware
// never actuates the heat pump, it only mirrors X10A telemetry. No-op if mqtt_uri is empty.
#include <string>

namespace daik {

void mqtt_ha_start();

// For /status.mqtt
struct MqttStatus { bool configured=false, connected=false, tls=false; std::string broker, error; };
MqttStatus mqtt_status();

} // namespace daik
