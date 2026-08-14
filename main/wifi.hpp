#pragma once
#include <cstdint>
#include "esp_err.h"
// WiFi station bring-up. Connects to the STRONGEST AP for the SSID (all-channel scan + connect
// by signal), so a multi-AP / mesh network no longer strands the bridge on the first (often weak)
// AP it hears. Plus an endless-reconnect + gateway watchdog: first-ever connect has a bounded
// budget then falls back to the setup portal (creds presumed wrong); once online at least once,
// later drops reconnect forever; a ~30 s ICMP-to-gateway watchdog catches missed-deauth "ghost"
// associations and forces one reconnect (never reboots). See docs/ARCHITECTURE.md → WiFi/LAN.

namespace daik {

// True if WiFi credentials are configured (NVS or Kconfig).
bool wifi_configured();

// Start STA and block until the first IP (or the first-boot connect budget is exhausted). On
// success starts mDNS (<hostname>.local) + the background gateway watchdog and returns true; the
// endless-reconnect handler stays armed for later drops. Returns false on a first-boot failure
// (creds presumed wrong) after tearing the STA stack down — the caller should then open the setup
// portal (provisioning_start_ap()). See docs/ARCHITECTURE.md → WiFi/LAN connectivity.
bool wifi_start_sta();

// Erase the ESP-IDF WiFi driver's legacy persistent STA/AP configuration. Runtime configuration is
// RAM-only in this firmware; this exists for factory-reset migration from builds that used IDF's
// default FLASH storage and therefore duplicated SSID/password outside `daik_cfg`.
[[nodiscard]] esp_err_t wifi_forget_persisted_config();

// Scan result for the web-UI/captive-portal SSID list.
struct WifiScanEntry { char ssid[33]; int8_t rssi; };
int  wifi_scan(WifiScanEntry* out, int max);   // returns count

// Live station link info for the dashboard: current IP + signal. `connected` is true once the
// STA has a DHCP lease; `rssi` is valid only then (0 otherwise). SSID lives in Config.
struct WifiInfo {
    char ip[16];
    int8_t rssi;
    bool connected;
    uint8_t bssid[6];
    char std[16];
    uint8_t mac[6];
};
WifiInfo wifi_info();

// Does a WiFi station EXIST this boot? False on a board that came up wired (net.cpp), where the
// radio is deliberately never started, and false in the setup portal (that is a SoftAP, not a
// station). Distinct from wifi_link_up() below: a station that is retrying an association is
// running and not up, and only the first of those two facts says whether a lost wire has anything
// to fall back on (logic/net_link.hpp's net_eth_fallback_step).
bool wifi_running();

// Does the station hold a DHCP lease RIGHT NOW? The transport-neutral question is net_is_up()
// (net.hpp); this is the WiFi half of it, and the guard that makes reading the AP record safe.
bool wifi_link_up();

// Cumulative count of successful RE-connects since boot (the first-ever GOT_IP doesn't count) —
// for the MQTT heartbeat (logic/heartbeat.hpp). Every drop the endless-reconnect handler recovers
// from (router reboot, roaming, a delivered deauth, a watchdog-forced re-association) increments
// this once it gets a new IP.
uint32_t wifi_reconnect_count();

} // namespace daik
