// SNTP client bring-up. See sntp_time.hpp.
#include "sntp_time.hpp"
#include "config.hpp"
#include "diag_log.hpp"
#include "esp_err.h"
#include "esp_netif_sntp.h"
#include "sdkconfig.h"
#include <sys/time.h>

namespace daik {

// Backs the `const char*` the SNTP client is handed: lwip's sntp module stores the pointer itself
// (it does not copy the string), so it must stay valid for the client's whole lifetime — a
// function-local std::string from config().ntp_server would dangle the moment sntp_time_start()
// returns. File-scope static gives it process lifetime. Resolved once at startup from the runtime
// config (config.cpp already folds the NVS override / Kconfig default down to one non-empty string,
// same as syslog_host); POST /set_ntp changes it by rebooting into a fresh config_load(), not by
// mutating this live, so there's no reason to re-read config() anywhere below.
static std::string s_server;
// Set from the sync callback (an internal SNTP task), read from the httpd/diag/syslog tasks — a
// single flag write/read needs nothing heavier than volatile. Once true it never reverts: a later
// resolve failure doesn't undo the settimeofday() the first successful sync already applied, so the
// wall clock stays valid (if increasingly stale) rather than flapping back to "unsynced".
static volatile bool s_synced = false;

static void on_sync(struct timeval*) {
    if (!s_synced) diag_printf("sntp: time synced (%s)\n", s_server.c_str());
    s_synced = true;
}

void sntp_time_start() {
    s_server = config().ntp_server;
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(s_server.c_str());
    cfg.sync_cb      = on_sync;
    cfg.wait_for_sync = false;   // nobody blocks on the sync semaphore here — skip allocating one
    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK) diag_printf("sntp: init failed (%s): %s\n", s_server.c_str(), esp_err_to_name(err));
}

bool time_synced() { return s_synced; }

void time_now(int64_t& unix_s, int32_t& ms) {
    if (!s_synced) { unix_s = -1; ms = 0; return; }
    // Read straight from newlib's clock rather than tracking our own uptime-since-sync offset: the
    // sync callback already drove it via settimeofday(), and re-deriving it here would just be a
    // second, driftable copy of what gettimeofday() already gives for free.
    struct timeval tv{};
    gettimeofday(&tv, nullptr);
    unix_s = tv.tv_sec;
    ms     = static_cast<int32_t>(tv.tv_usec / 1000);
}

TimeStatus time_status() {
    TimeStatus s;
    s.synced = s_synced;
    s.server = s_server;
    int32_t ms;
    time_now(s.unix_time, ms);
    return s;
}

} // namespace daik
