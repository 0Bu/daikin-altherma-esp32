// WiFi station bring-up + scan + mDNS. See wifi.hpp. The endless-reconnect handler and the
// gateway ICMP watchdog (docs/ARCHITECTURE.md → WiFi/LAN connectivity) are TODO — the STA
// connect + mDNS below are enough for a first bring-up.
#include "wifi.hpp"
#include "config.hpp"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "mdns.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <cstdio>
#include <cstring>

namespace daik {

static const char* TAG = "wifi";
static EventGroupHandle_t s_events;
static esp_netif_t* s_sta_netif = nullptr;   // kept for live IP lookup (wifi_info)
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
    s_sta_netif = esp_netif_create_default_wifi_sta();
    // Advertise our hostname to the router via DHCP (option 12) BEFORE the DHCP client runs, so the
    // router's client list shows "daikin-altherma-esp32", not the IDF default "espressif". This is
    // the DHCP name; mDNS (start_mdns) sets the matching <hostname>.local name separately.
    if (s_sta_netif) esp_netif_set_hostname(s_sta_netif, config().hostname.c_str());
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

    // Disable WiFi modem sleep. The IDF default is WIFI_PS_MIN_MODEM: the radio sleeps between
    // DTIM beacons and only wakes at the DTIM interval to pull buffered downlink packets, which
    // adds ~100-300 ms (and, with TCP retransmits, occasionally seconds) of non-deterministic
    // latency to every inbound request — the HTTP UI then "sometimes takes very long to answer".
    // This is a mains-powered bridge, so we trade the small idle-power saving for a responsive UI.
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

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

WifiInfo wifi_info() {
    WifiInfo info{};
    esp_netif_ip_info_t ip{};
    if (s_sta_netif && esp_netif_get_ip_info(s_sta_netif, &ip) == ESP_OK && ip.ip.addr != 0) {
        snprintf(info.ip, sizeof(info.ip), IPSTR, IP2STR(&ip.ip));
        info.connected = true;
        wifi_ap_record_t ap{};
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) info.rssi = ap.rssi;
    }
    return info;
}

} // namespace daik
