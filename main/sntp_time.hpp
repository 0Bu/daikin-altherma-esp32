#pragma once
// SNTP time sync: establishes wall-clock UTC from the network so diag/syslog lines and /status can
// carry a real timestamp instead of only uptime-since-boot. See sntp_time.cpp + docs/ARCHITECTURE.md.
#include <cstdint>
#include <string>

namespace daik {

// Starts the SNTP client (poll mode, config().ntp_server — NVS override of CONFIG_DAIKIN_NTP_SERVER,
// runtime-editable via POST /set_ntp same as syslog_host/POST /set_syslog). Call once, after
// esp_netif_init() has run (main.cpp calls it right after WiFi STA / setup-AP bring-up, both of
// which already call esp_netif_init()) and after config_load() has populated the runtime config.
// Non-blocking: the IDF SNTP client resolves + retries the server on its own internal task, so this
// is harmless to start before the STA even has an IP — it just idles until one shows up (and, in
// AP-only setup mode, until the device is reconfigured for STA and rebooted).
void sntp_time_start();

// True once at least one SNTP reply has landed since boot. Once true it stays true — a later
// resolve failure doesn't revoke a wall clock that newlib's settimeofday() already applied.
bool time_synced();

// Current UTC instant, split for logic/timestamp.hpp's rfc3339_utc(unix_s, ms). {-1, 0} if
// time_synced() is false — never a plausible-looking pre-epoch/garbage value.
void time_now(int64_t& unix_s, int32_t& ms);

struct TimeStatus {
    bool        synced    = false;
    std::string server;      // the configured NTP server (display only — not necessarily who answered)
    int64_t     unix_time  = -1;
};

TimeStatus time_status();

} // namespace daik
