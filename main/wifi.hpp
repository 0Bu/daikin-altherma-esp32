#pragma once
// WiFi station bring-up with the endless-reconnect + gateway watchdog behaviour ported from
// tesla-key-esp32/main.cpp: first-ever connect has a bounded budget then falls back to the
// setup portal (creds presumed wrong); once online at least once, later drops reconnect
// forever; a ~30 s ICMP-to-gateway watchdog catches missed-deauth "ghost" associations and
// forces one reconnect (never reboots). See docs/ARCHITECTURE.md → WiFi/LAN connectivity.

namespace daik {

// True if WiFi credentials are configured (NVS or Kconfig).
bool wifi_configured();

// Start STA, block until connected (or fall back to the setup portal on first-boot failure),
// then start the background reconnect handler + watchdog. Also starts mDNS (<hostname>.local).
void wifi_start_sta();

// Scan result for the web-UI/captive-portal SSID list.
struct WifiScanEntry { char ssid[33]; int8_t rssi; };
int  wifi_scan(WifiScanEntry* out, int max);   // returns count

} // namespace daik
