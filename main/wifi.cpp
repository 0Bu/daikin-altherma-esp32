// WiFi station bring-up + scan + mDNS. See wifi.hpp. The endless-reconnect handler and the
// gateway ICMP watchdog (docs/ARCHITECTURE.md → WiFi/LAN connectivity) are TODO ports from
// tesla-key-esp32/main.cpp — the STA connect + mDNS below are enough for a first bring-up.
#include "wifi.hpp"
#include "config.hpp"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "mdns.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <cstring>

namespace daik {

static const char* TAG = "wifi";
static EventGroupHandle_t s_events;
static const int CONNECTED_BIT = BIT0;

bool wifi_configured() { return !config().wifi_ssid.empty(); }

static void on_wifi(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        // TODO: port the first-boot budget + endless-reconnect-after-first-IP logic.
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto* e = static_cast<ip_event_got_ip_t*>(data);
        ESP_LOGI(TAG, "connected, ip=" IPSTR, IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(s_events, CONNECTED_BIT);
    }
}

static void start_mdns() {
    if (mdns_init() != ESP_OK) return;
    mdns_hostname_set(config().hostname.c_str());
    mdns_service_add(nullptr, "_http", "_tcp", 80, nullptr, 0);
}

void wifi_start_sta() {
    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, nullptr, nullptr);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, nullptr, nullptr);

    wifi_config_t wc = {};
    const Config& c  = config();
    strncpy(reinterpret_cast<char*>(wc.sta.ssid), c.wifi_ssid.c_str(), sizeof(wc.sta.ssid) - 1);
    strncpy(reinterpret_cast<char*>(wc.sta.password), c.wifi_pass.c_str(), sizeof(wc.sta.password) - 1);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Wait up to 30 s for the first IP; on failure the caller could fall back to the portal.
    xEventGroupWaitBits(s_events, CONNECTED_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(30000));
    start_mdns();
}

int wifi_scan(WifiScanEntry* out, int max) {
    wifi_scan_config_t sc = {};
    if (esp_wifi_scan_start(&sc, true) != ESP_OK) return 0;
    uint16_t n = 0;
    esp_wifi_scan_get_ap_num(&n);
    if (n > 20) n = 20;
    wifi_ap_record_t recs[20];
    esp_wifi_scan_get_ap_records(&n, recs);
    int count = 0;
    for (int i = 0; i < n && count < max; i++) {
        strncpy(out[count].ssid, reinterpret_cast<char*>(recs[i].ssid), sizeof(out[count].ssid) - 1);
        out[count].ssid[sizeof(out[count].ssid) - 1] = '\0';
        out[count].rssi = recs[i].rssi;
        count++;
    }
    return count;
}

} // namespace daik
