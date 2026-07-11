// Runtime config: daik::Config backed by NVS, seeded from Kconfig defaults. See config.hpp.
#include "config.hpp"
#include "nvs_storage.hpp"
#include "sdkconfig.h"

namespace daik {

static Config g_cfg;

Config& config() { return g_cfg; }

void config_load() {
    Config& c   = g_cfg;
    c.wifi_ssid = nvs_get_str("wifi_ssid", CONFIG_DAIKIN_WIFI_SSID);
    c.wifi_pass = nvs_get_str("wifi_pass", CONFIG_DAIKIN_WIFI_PASSWORD);
    c.mqtt_uri  = nvs_get_str("mqtt_uri", CONFIG_DAIKIN_MQTT_BROKER_URI);
    c.mqtt_user = nvs_get_str("mqtt_user", CONFIG_DAIKIN_MQTT_USERNAME);
    c.mqtt_pass = nvs_get_str("mqtt_pass", CONFIG_DAIKIN_MQTT_PASSWORD);
    c.hostname  = nvs_get_str("hostname", CONFIG_DAIKIN_HOSTNAME);
    c.profile   = nvs_get_str("profile", CONFIG_DAIKIN_PROFILE);
    c.lang      = nvs_get_str("lang", CONFIG_DAIKIN_LANG);
    c.proto     = parse_protocol(nvs_get_str("proto", CONFIG_DAIKIN_PROTOCOL));
    c.rx_pin    = nvs_get_i32("rx_pin", CONFIG_DAIKIN_RX_PIN);
    c.tx_pin    = nvs_get_i32("tx_pin", CONFIG_DAIKIN_TX_PIN);
    c.poll_s    = nvs_get_i32("poll_s", CONFIG_DAIKIN_POLL_INTERVAL_S);
    c.therm_pin = nvs_get_i32("therm_pin", CONFIG_DAIKIN_THERM_PIN);
    c.sg1_pin   = nvs_get_i32("sg1_pin", CONFIG_DAIKIN_SG1_PIN);
    c.sg2_pin   = nvs_get_i32("sg2_pin", CONFIG_DAIKIN_SG2_PIN);
    c.val_mask  = nvs_get_str("val_mask", "");
    c.demo      = nvs_get_i32("demo", 0) != 0;
}

bool config_save(const Config& c) {
    bool ok = true;
    ok &= nvs_set_str("wifi_ssid", c.wifi_ssid);
    ok &= nvs_set_str("wifi_pass", c.wifi_pass);
    ok &= nvs_set_str("mqtt_uri", c.mqtt_uri);
    ok &= nvs_set_str("mqtt_user", c.mqtt_user);
    ok &= nvs_set_str("mqtt_pass", c.mqtt_pass);
    ok &= nvs_set_str("hostname", c.hostname);
    ok &= nvs_set_str("profile", c.profile);
    ok &= nvs_set_str("lang", c.lang);
    ok &= nvs_set_str("proto", std::string(1, static_cast<char>(c.proto)));
    ok &= nvs_set_i32("rx_pin", c.rx_pin);
    ok &= nvs_set_i32("tx_pin", c.tx_pin);
    ok &= nvs_set_i32("poll_s", c.poll_s);
    ok &= nvs_set_i32("therm_pin", c.therm_pin);
    ok &= nvs_set_i32("sg1_pin", c.sg1_pin);
    ok &= nvs_set_i32("sg2_pin", c.sg2_pin);
    ok &= nvs_set_str("val_mask", c.val_mask);
    ok &= nvs_set_i32("demo", c.demo ? 1 : 0);
    if (ok) g_cfg = c;
    return ok;
}

} // namespace daik
