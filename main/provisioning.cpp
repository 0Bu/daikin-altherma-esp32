// Captive setup portal: SoftAP "daikin-altherma-esp32-setup" so WiFi can be entered from a phone.
// This file brings up the SoftAP + a captive-portal DNS; the setup page (setup.html) and /set_wifi
// are served by the ONE shared :80 server (http_server.cpp / http_status.cpp), which serves
// setup.html while unprovisioned. Running a second httpd here would collide on port 80
// (EADDRINUSE). See provisioning.hpp.
#include "provisioning.hpp"
#include "captive_dns.hpp"
#include "diag_log.hpp"
#include "logic/captive.hpp"

#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include <cstdio>
#include <cstring>

namespace daik {

// Set once the SoftAP is actually up; read by http_start() to pick the trust surface.
static bool s_ap_active = false;

bool provisioning_ap_active() { return s_ap_active; }

static const char* TAG = "prov";

// RFC 8910 DHCP option 114 (Captive-Portal Identification). NOT const and NOT a local: IDF stores
// the POINTER it is handed (esp_netif.h: "set operation copies the pointer to the URI, so it is
// owned by the application"), so this must outlive the DHCP server — the same lifetime trap as
// sntp_time.cpp's server string. Filled from CAPTIVE_PORTAL_URI at run time rather than spelled out
// again, so the address stays written in exactly one place (logic/captive.hpp).
static char s_portal_uri[32];

// Make the SoftAP DHCP hand out 192.168.4.1 as the DNS server, so every client resolves through
// our captive DNS (captive_dns.cpp) and its connectivity probe lands on the setup page — plus the
// RFC 8910 portal URI, which modern iOS/Android prefer over probing at all.
//
// Every step is CHECKED rather than fired and forgotten: a silent failure here IS the "portal
// doesn't pop" report, and the old code discarded all four return codes.
//
// Failures go to diag_printf, which in AP mode reaches the serial console only — GET /diag is
// withheld from the setup-AP surface on purpose (logic/http_surface.hpp: the ring can carry
// WiFi/MQTT secrets and the radio is open) and syslog has no network yet. The ring is still the
// right sink: main.cpp also lands here when a first-boot STA connect fails, and that board keeps
// running, so the reason belongs in the same log as the WiFi failure that preceded it.
static void offer_self_as_dns() {
    esp_netif_t* ap = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    if (!ap) { diag_printf("prov: no AP netif — DHCP hands out no DNS, portal won't auto-pop\n"); return; }

    esp_netif_dns_info_t dns = {};
    dns.ip.type            = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = ESP_IP4TOADDR(CAPTIVE_PORTAL_OCTETS[0], CAPTIVE_PORTAL_OCTETS[1],
                                           CAPTIVE_PORTAL_OCTETS[2], CAPTIVE_PORTAL_OCTETS[3]);
    uint8_t offer_dns = 0x02;   // dhcps_offer_t OFFER_DNS — advertise the DNS option

    std::snprintf(s_portal_uri, sizeof s_portal_uri, "%s", CAPTIVE_PORTAL_URI);

    // The DHCP server must be STOPPED to accept option/DNS changes; restart it either way below.
    esp_err_t stop = esp_netif_dhcps_stop(ap);
    if (stop != ESP_OK && stop != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED)
        diag_printf("prov: dhcps_stop failed (%s)\n", esp_err_to_name(stop));

    esp_err_t e = esp_netif_set_dns_info(ap, ESP_NETIF_DNS_MAIN, &dns);
    if (e != ESP_OK) diag_printf("prov: set_dns_info failed (%s)\n", esp_err_to_name(e));

    e = esp_netif_dhcps_option(ap, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER,
                               &offer_dns, sizeof(offer_dns));
    if (e != ESP_OK)
        diag_printf("prov: DNS option not offered (%s) — portal won't auto-pop\n", esp_err_to_name(e));

    // Advertised as well as, never instead of, the DNS+probe path: option 114 is honoured by recent
    // iOS/Android only, and a client that ignores it still finds the portal via the probe redirect.
    e = esp_netif_dhcps_option(ap, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI,
                               s_portal_uri, std::strlen(s_portal_uri));
    if (e != ESP_OK) diag_printf("prov: RFC 8910 portal URI not offered (%s)\n", esp_err_to_name(e));

    e = esp_netif_dhcps_start(ap);
    if (e != ESP_OK) diag_printf("prov: dhcps_start failed (%s) — clients get no lease\n", esp_err_to_name(e));
}

void provisioning_start_ap() {
    esp_netif_create_default_wifi_ap();
    // AP-ONLY, deliberately. An earlier version ran APSTA with an idle station interface for one
    // reason: esp_wifi_scan_start() needs a STARTED STA, and the setup page filled its SSID dropdown
    // from GET /scan. The portal now takes the SSID as free text and never scans, so that interface
    // (and the channel-hopping blip a scan inflicts on the associated phone) buys nothing — and
    // AP-only keeps the open radio to exactly the one job it has here.
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));
    // Keep the setup AP configuration out of the driver's NVS too. `daik_cfg` is the one persistent
    // authority; the AP is reconstructed on every unprovisioned boot.
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));

    wifi_config_t ap = {};
    strcpy(reinterpret_cast<char*>(ap.ap.ssid), "daikin-altherma-esp32-setup");
    ap.ap.ssid_len       = strlen("daikin-altherma-esp32-setup");
    ap.ap.max_connection = 4;
    ap.ap.authmode       = WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
    ESP_ERROR_CHECK(esp_wifi_start());
    // Before the DNS/captive plumbing, not after: http_start() reads this to pick its trust
    // surface, and an AP that is radiating while the flag still says "no portal" is the one
    // ordering that would widen the surface on an open radio.
    s_ap_active = true;

    offer_self_as_dns();
    captive_dns_start();   // resolves every lookup to 192.168.4.1 -> captive-portal auto-popup
    ESP_LOGI(TAG, "setup AP 'daikin-altherma-esp32-setup' up (http://%s)", CAPTIVE_PORTAL_IP);
    diag_printf("prov: setup AP up, portal at %s\n", CAPTIVE_PORTAL_URI);
    // HTTP (setup.html + /set_wifi + captive catch-all) is served by http_start().
}

} // namespace daik
