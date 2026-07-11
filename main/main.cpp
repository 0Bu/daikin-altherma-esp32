// daikin-altherma-esp32 — boot orchestration.
//
// Boot flow (mirrors tesla-key-esp32/main.cpp, retargeted to the Daikin poll engine):
//   1. NVS + runtime config load (config.cpp; defaults from Kconfig).
//   2. WiFi: if configured -> STA (with the endless-reconnect + gateway watchdog); else start
//      the captive setup portal (provisioning.cpp, SoftAP "daikin-altherma-setup").
//   3. mDNS (<hostname>.local), HTTP server (:80), MQTT/HA bridge, OTA health gate.
//   4. Heat-pump poll engine (hp_poll.cpp): owns the X10A UART, polls each interval, fills the
//      value cache the web UI / MQTT read.
//
// Most of the heavy lifting lives in the modules; this file just wires them up in order.
#include "esp_app_desc.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "config.hpp"
#include "diag_log.hpp"
#include "control.hpp"
#include "hp_poll.hpp"
#include "http_server.hpp"
#include "mqtt_ha.hpp"
#include "ota_update.hpp"
#include "provisioning.hpp"
#include "wifi.hpp"

static const char* TAG = "main";

extern "C" void app_main() {
    // --- NVS ---
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    daik::diag_log_init();
    daik::config_load();
    const daik::Config& cfg = daik::config();
    ESP_LOGI(TAG, "daikin-altherma-esp32 %s", esp_app_get_description()->version);
    ESP_LOGI(TAG, "cfg: profile=%s proto=%c rx=%d tx=%d poll=%ds",
             cfg.profile.c_str(), static_cast<char>(cfg.proto), cfg.rx_pin, cfg.tx_pin, cfg.poll_s);

    // --- Networking: STA or captive setup portal ---
    if (daik::wifi_configured()) {
        daik::wifi_start_sta();          // endless reconnect + gateway watchdog (see wifi.cpp)
    } else {
        daik::provisioning_start_ap();   // SoftAP + captive portal; serves www/setup.html
    }

    // --- Services ---
    daik::control_init();                // optional thermostat / SG relays (no-op if pins == -1)
    daik::http_start();                  // esp_http_server on :80 (web UI + config + OTA + MCP)
    daik::mqtt_ha_start();               // HA MQTT-Discovery bridge (no-op if mqtt_uri empty)
    daik::hp_poll_start();               // X10A poll engine
    daik::ota_health_gate_arm();         // keep rollback armed until this image proves healthy
}
