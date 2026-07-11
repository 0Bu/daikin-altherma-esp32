// Home Assistant MQTT-Discovery bridge. See mqtt_ha.hpp and docs/ARCHITECTURE.md → MQTT bridge.
// The esp-mqtt client + streamed discovery is a TODO; the
// discovery payload builder itself is the host-tested logic/discovery.hpp. No-op if mqtt_uri
// empty.
#include "mqtt_ha.hpp"
#include "config.hpp"
#include "esp_log.h"

namespace daik {

static MqttStatus s_status;

void mqtt_ha_start() {
    const Config& c = config();
    s_status.configured = !c.mqtt_uri.empty();
    s_status.broker     = c.mqtt_uri;
    if (!s_status.configured) return;
    // TODO: esp_mqtt_client_init (mqtts+CA when credentials present, no silent plaintext
    // fallback), on connect stream logic::discovery_config() per enabled value, then republish
    // the retained <base>/<node>/state JSON every CONFIG_DAIKIN_MQTT_PUBLISH_INTERVAL_S.
    ESP_LOGW("mqtt", "bridge TODO — broker=%s", c.mqtt_uri.c_str());
}

MqttStatus mqtt_status() { return s_status; }

} // namespace daik
