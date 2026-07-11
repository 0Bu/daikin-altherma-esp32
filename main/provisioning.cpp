// Captive setup portal: SoftAP "daikin-altherma-esp32-setup" so WiFi can be entered from a phone.
// This file brings up the SoftAP + a captive-portal DNS; the setup page (setup.html), /scan and
// /set_wifi are served by the ONE shared :80 server (http_server.cpp / http_status.cpp), which
// serves setup.html while unprovisioned. Running a second httpd here would collide on port 80
// (EADDRINUSE). See provisioning.hpp.
#include "provisioning.hpp"
#include "captive_dns.hpp"

#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include <cstring>

namespace daik {

static const char* TAG = "prov";

// Make the SoftAP DHCP hand out 192.168.4.1 as the DNS server, so every client resolves through
// our captive DNS (captive_dns.cpp) and its connectivity probe lands on the setup page.
static void offer_self_as_dns() {
    esp_netif_t* ap = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    if (!ap) return;
    esp_netif_dns_info_t dns = {};
    dns.ip.type            = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = ESP_IP4TOADDR(192, 168, 4, 1);
    uint8_t offer_dns = 0x02;   // dhcps_offer_t OFFER_DNS — advertise the DNS option
    esp_netif_dhcps_stop(ap);
    esp_netif_set_dns_info(ap, ESP_NETIF_DNS_MAIN, &dns);
    esp_netif_dhcps_option(ap, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &offer_dns, sizeof(offer_dns));
    esp_netif_dhcps_start(ap);
}

void provisioning_start_ap() {
    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));

    wifi_config_t ap = {};
    strcpy(reinterpret_cast<char*>(ap.ap.ssid), "daikin-altherma-esp32-setup");
    ap.ap.ssid_len       = strlen("daikin-altherma-esp32-setup");
    ap.ap.max_connection = 4;
    ap.ap.authmode       = WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
    ESP_ERROR_CHECK(esp_wifi_start());

    offer_self_as_dns();
    captive_dns_start();   // resolves every lookup to 192.168.4.1 -> captive-portal auto-popup
    ESP_LOGI(TAG, "setup AP 'daikin-altherma-esp32-setup' up (http://192.168.4.1)");
    // HTTP (setup.html + /scan + /set_wifi + captive catch-all) is served by http_start().
}

} // namespace daik
