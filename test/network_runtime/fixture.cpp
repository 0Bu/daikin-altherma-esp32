// Execute complete production translation units with deterministic SDK-shaped event/queue adapters.
// This is host evidence for wiring and lifecycle, not RF, DHCP-server or UDP-delivery acceptance.
#include "sdk.hpp"
#include <cstdlib>
#include <cstdarg>
#include <ctime>
#include <iostream>
#include <limits>
#include <new>
#ifndef WIFI_PRODUCTION_SOURCE
#error "Compile against the complete current main/wifi.cpp"
#endif
#ifndef SYSLOG_PRODUCTION_SOURCE
#error "Compile against the complete current main/syslog.cpp"
#endif
#define TAG WIFI_TAG
#include WIFI_PRODUCTION_SOURCE
#undef TAG
static bool     fail_calendar_conversion = false;
static std::tm* fixture_gmtime_r(const std::time_t* time, std::tm* output) {
    if (!fail_calendar_conversion) return ::gmtime_r(time, output);
    // A failed libc conversion need not preserve the output buffer. Leave a plausible date so
    // removing the production return-value guard fails deterministically, without undefined reads.
    *output         = {};
    output->tm_year = 70;
    output->tm_mday = 1;
    return nullptr;
}
namespace syslog_episode {
enum class Recovery { Unconfigured, NetworkDown, CompleteCycle };
struct StopTask {};
inline Recovery recovery = Recovery::CompleteCycle;
inline bool     active   = false;
inline unsigned cycles = 0, allocation_failures = 0, lock_depth = 0;
inline unsigned failure_delays = 0, idle_delays = 0, idle_receives = 0;
} // namespace syslog_episode
static int fixture_getaddrinfo(const char* host, const char* service, const addrinfo* hints,
                               addrinfo** result) {
    if (syslog_episode::active) return EAI_NONAME;
    return ::getaddrinfo(host, service, hints, result);
}
#define getaddrinfo fixture_getaddrinfo
#define TAG SYSLOG_TAG
#define gmtime_r fixture_gmtime_r
#define socket sdk::udp_socket
#define sendto sdk::udp_sendto
#define close sdk::udp_close
#include SYSLOG_PRODUCTION_SOURCE
#undef socket
#undef sendto
#undef close
#undef TAG
#undef gmtime_r
#undef getaddrinfo

void* operator new(size_t size) {
    if (syslog_episode::active && sdk::forbid_alloc) ++syslog_episode::allocation_failures;
    if (sdk::forbid_alloc) throw std::bad_alloc();
    if (void* p = std::malloc(size ? size : 1)) return p;
    throw std::bad_alloc();
}
void  operator delete(void* p) noexcept { std::free(p); }
void  operator delete(void* p, size_t) noexcept { std::free(p); }
void* operator new[](size_t n) { return ::operator new(n); }
void  operator delete[](void* p) noexcept { std::free(p); }
void  operator delete[](void* p, size_t) noexcept { std::free(p); }

namespace adapter {
daik::Config             cfg;
int                      saves   = 0;
bool                     save_ok = true;
std::vector<std::string> logs;
int64_t                  unix_s = -1;
int32_t                  ms     = 0;
daik::StackWatch         stack_owner = daik::StackWatch::COUNT;
std::array<unsigned, static_cast<unsigned>(daik::StackWatch::COUNT)> stack_samples{};
} // namespace adapter
namespace daik {
void stack_watch_sample(StackWatch slot) noexcept {
    if (slot != adapter::stack_owner || slot == StackWatch::COUNT) {
        std::fprintf(stderr, "FAIL stack_sampler_exact_network_owner\n");
        std::exit(1);
    }
    ++adapter::stack_samples[static_cast<unsigned>(slot)];
}
Config config() { return adapter::cfg; }
bool   config_save(const Config& c) {
    ++adapter::saves;
    if (adapter::save_ok) adapter::cfg = c;
    return adapter::save_ok;
}
bool config_wifi_configured() { return !adapter::cfg.wifi_ssid.empty(); }
// Every scenario here loads a usable stored blob; the kept-blob gate is pinned at source level by
// test/test_config_ownership_contract.mjs.
bool config_stored_blob_unreadable() { return false; }
namespace detail {
void config_lock() {
    if (!syslog_episode::active) return;
    ++syslog_episode::cycles;
    ++syslog_episode::lock_depth;
    const bool recovered = syslog_episode::cycles == 3;
    if (recovered && syslog_episode::recovery == syslog_episode::Recovery::Unconfigured)
        adapter::cfg.syslog_host.clear();
    else
        adapter::cfg.syslog_host.assign(80, 'a');
    s_wifi_connected =
        !(recovered && syslog_episode::recovery == syslog_episode::Recovery::NetworkDown);
    sdk::forbid_alloc = !recovered;
}
void config_unlock() {
    if (!syslog_episode::active) return;
    sdk::forbid_alloc = false;
    --syslog_episode::lock_depth;
}
const Config& config_ref_locked() { return adapter::cfg; }
} // namespace detail
bool      nvs_storage_available() { return true; }
bool      nvs_restart_held_by_factory_reset(const char*) { return false; }
void      net_mdns_start() { ++sdk::mdns_starts; }
bool      net_is_up() { return wifi_link_up(); }
bool      ota_download_active() { return false; }
bool      weather_fetch_active() { return false; }
bool      safe_mode_active() { return false; }
// The boot record's recovery fields (logic/bootlog.hpp): an ordinary clean boot.
const char* safe_mode_cause() { return nullptr; }
int         safe_mode_crash_boots() { return 0; }
uint8_t     heap_guard_restarts() { return 0; }
CrashInfo diag_crash_info() { return CrashInfo{}; }
void      time_now(int64_t& unix_s, int32_t& ms) {
    unix_s = adapter::unix_s;
    ms     = adapter::ms;
}
void diag_printf(const char* format, ...) {
    char    text[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(text, sizeof(text), format, args);
    va_end(args);
    adapter::logs.emplace_back(text);
    // Match the actual diag forwarding relationship, including its reentrant loop guard.
    syslog_send(text, std::strlen(text));
}
} // namespace daik
namespace test {
using namespace daik;
#define REQUIRE(c)                                                                                 \
    do {                                                                                           \
        if (!(c))                                                                                  \
            throw std::runtime_error(std::string(__func__) + ":" + std::to_string(__LINE__) +      \
                                     ": " #c);                                                     \
    } while (0)

void reset() {
    adapter::stack_owner = StackWatch::COUNT;
    adapter::stack_samples.fill(0);
    syslog_episode::active = false;
    syslog_episode::cycles = syslog_episode::allocation_failures = syslog_episode::lock_depth = 0;
    syslog_episode::failure_delays = syslog_episode::idle_delays = syslog_episode::idle_receives =
        0;
    sdk::on_queue_receive = {};
    sdk::forbid_alloc = false;
    sdk::on_start = sdk::on_netif_read = sdk::on_ap_read = {};
    sdk::on_wait                                         = {};
    sdk::on_delay                                        = {};
    for (auto p : sdk::handlers) delete p;
    for (auto p : sdk::events) delete p;
    for (auto p : sdk::semaphores) delete p;
    for (auto p : sdk::tasks) delete p;
    for (auto p : sdk::queues) delete p;
    for (auto p : sdk::netifs) delete p;
    sdk::handlers.clear();
    sdk::events.clear();
    sdk::semaphores.clear();
    sdk::tasks.clear();
    sdk::queues.clear();
    sdk::netifs.clear();
    sdk::wait_budgets.clear();
    sdk::ticks                   = 0;
    sdk::connects                = 0;
    sdk::restarts                = 0;
    sdk::mdns_starts             = 0;
    sdk::netif_reads             = 0;
    sdk::ap_reads                = 0;
    sdk::queue_sends             = 0;
    sdk::lock_depth              = 0;
    sdk::fail_dynamic_mutex      = false;
    sdk::dynamic_mutex_creations = 0;
    sdk::queue_reject            = false;
    sdk::fail_send               = false;
    sdk::scan_count              = 0;
    sdk::scan_start_result = sdk::scan_records_result = ESP_OK;
    sdk::scan_record_reads = sdk::scan_clears = 0;
    sdk::scan_pending                         = false;
    sdk::packets.clear();
    s_events    = nullptr;
    s_sta_netif = nullptr;
    s_h_wifi = s_h_ip     = nullptr;
    s_retry_num           = 0;
    s_wifi_connected      = false;
    s_wifi_ever_connected = false;
    s_reconnects          = 0;
    s_last_disco_reason   = 0;
    s_rollback_pending    = false;
    s_sta_running         = false;
    s_wd                  = {nullptr, 0};
    s_gw_ever_reachable   = false;
    s_queue               = nullptr;
    s_status_mtx          = xSemaphoreCreateMutexStatic(&s_status_mtx_storage);
    s_queue_dropped       = 0;
    s_resolved = s_reachable = false;
    s_error                  = "";
    s_network_quiesced       = true;
    s_ping                   = {nullptr, 0};
    adapter::cfg             = Config{};
    adapter::cfg.wifi_ssid   = "test-wifi";
    adapter::cfg.wifi_pass   = "password";
    adapter::saves           = 0;
    adapter::save_ok         = true;
    adapter::logs.clear();
    adapter::unix_s = -1;
    adapter::ms     = 0;
}
void got_ip() {
    s_sta_netif->ip.ip.addr = inet_addr("192.0.2.8");
    s_sta_netif->ip.gw.addr = inet_addr("192.0.2.1");
    ip_event_got_ip_t event{s_sta_netif, s_sta_netif->ip};
    sdk::emit(IP_EVENT, IP_EVENT_STA_GOT_IP, &event);
}
void start_connected() {
    sdk::on_start = got_ip;
    REQUIRE(wifi_start_sta());
    REQUIRE(sdk::mdns_starts == 1);
}
void lost_lease() {
    reset();
    start_connected();
    REQUIRE(wifi_link_up());
    REQUIRE(wifi_running());
    REQUIRE(wifi_info().connected);
    const int reads = sdk::ap_reads, netif_reads = sdk::netif_reads, connects = sdk::connects;
    sdk::emit(IP_EVENT, IP_EVENT_STA_LOST_IP);
    REQUIRE(!wifi_link_up());
    REQUIRE(wifi_running());
    REQUIRE(!(s_events->bits & CONNECTED_BIT));
    REQUIRE(s_sta_netif->ip.ip.addr != 0); // SDK cache deliberately retains the former address
    const auto info = wifi_info();
    REQUIRE(!info.connected && info.ip[0] == 0 && info.rssi == 0 && info.std[0] == 0);
    REQUIRE(sdk::ap_reads == reads);
    REQUIRE(sdk::netif_reads == netif_reads);
    REQUIRE(sdk::connects == connects); // lease loss alone must not force re-association
    got_ip();
    REQUIRE(wifi_link_up());
    REQUIRE(wifi_info().connected);
    REQUIRE(wifi_reconnect_count() == 1);
}
void disconnect_retry() {
    reset();
    start_connected();
    wifi_event_sta_disconnected_t event{202, -55};
    for (int i = 0; i < 50; ++i) sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &event);
    REQUIRE(!wifi_link_up());
    REQUIRE(!(s_events->bits & CONNECTED_BIT));
    REQUIRE(!(s_events->bits & FAIL_BIT));
    REQUIRE(sdk::connects == 51);
    REQUIRE(!wifi_info().connected);
    got_ip();
    REQUIRE(wifi_reconnect_count() == 1);
}
void foreign_ip() {
    reset();
    sdk::on_start = [] {
        esp_netif_t       foreign;
        ip_event_got_ip_t event{&foreign, {}};
        sdk::emit(IP_EVENT, IP_EVENT_ETH_GOT_IP, &event);
        sdk::emit(IP_EVENT, IP_EVENT_STA_GOT_IP, &event);
        REQUIRE(!wifi_link_up());
        REQUIRE(!(s_events->bits & CONNECTED_BIT));
        got_ip();
        sdk::emit(IP_EVENT, IP_EVENT_ETH_LOST_IP);
        REQUIRE(wifi_link_up());
    };
    REQUIRE(wifi_start_sta());
    REQUIRE(wifi_reconnect_count() == 0);
}
void snapshot_loss() {
    reset();
    start_connected();
    sdk::on_netif_read = [] { sdk::emit(IP_EVENT, IP_EVENT_STA_LOST_IP); };
    const auto info    = wifi_info();
    REQUIRE(!info.connected && info.ip[0] == 0 && info.rssi == 0);
    sdk::on_netif_read = {};
    got_ip();
    sdk::on_ap_read    = [] { sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED); };
    const auto ap_info = wifi_info();
    REQUIRE(!ap_info.connected && ap_info.ip[0] == 0 && ap_info.rssi == 0);
    REQUIRE(ap_info.mac[0] == 2);
}
void snapshot_reacquisition() {
    reset();
    start_connected();
    auto reacquire = [] {
        sdk::emit(IP_EVENT, IP_EVENT_STA_LOST_IP);
        got_ip();
        s_sta_netif->ip.ip.addr = inet_addr("192.0.2.9");
    };
    sdk::on_netif_read = reacquire;
    const auto old_ip  = wifi_info();
    REQUIRE(wifi_link_up());
    REQUIRE(!old_ip.connected && old_ip.ip[0] == 0 && old_ip.mac[0] == 2);
    sdk::on_netif_read = {};
    const auto current = wifi_info();
    REQUIRE(current.connected && std::string(current.ip) == "192.0.2.9");
    sdk::on_ap_read   = reacquire;
    const auto old_ap = wifi_info();
    REQUIRE(wifi_link_up());
    REQUIRE(!old_ap.connected && old_ap.ip[0] == 0 && old_ap.mac[0] == 2);
}
void scan_failure() {
    reset();
    sdk::scan_count = 2;
    WifiScanEntry out[2]{};
    REQUIRE(wifi_scan(out, 1) == 1 && std::string(out[0].ssid) == "test-wifi");
    REQUIRE(out[0].rssi == -40);
    REQUIRE(wifi_scan(out, 2) == 2 && std::string(out[1].ssid) == "fallback");
    std::strcpy(out[0].ssid, "fallback");
    out[0].rssi              = -90;
    sdk::scan_record_reads   = 0;
    sdk::scan_clears         = 0;
    sdk::scan_pending        = false;
    sdk::scan_records_result = ESP_FAIL;
    REQUIRE(wifi_scan(out, 2) == 0 && sdk::scan_record_reads == 1);
    REQUIRE(!sdk::scan_pending && sdk::scan_clears == 1);
    REQUIRE(std::string(out[0].ssid) == "fallback" && out[0].rssi == -90);
    sdk::scan_start_result = ESP_FAIL;
    REQUIRE(wifi_scan(out, 2) == 0 && sdk::scan_record_reads == 1);
    REQUIRE(!sdk::scan_pending && sdk::scan_clears == 2);
}
void stale_boot_wake() {
    reset();
    adapter::cfg.wifi_rollback_active = true;
    adapter::cfg.wifi_ssid_backup     = "fallback";
    int waits                         = 0;
    sdk::on_wait                      = [&waits](FakeEvents* group, TickType_t timeout) {
        ++waits;
        if (waits == 1) {
            sdk::ticks += 7000;
            got_ip();
            const auto wake = group->bits;
            sdk::emit(IP_EVENT, IP_EVENT_STA_LOST_IP);
            return wake; // event snapshot predates the loss delivered before task resumption
        }
        REQUIRE(timeout == 23000);
        REQUIRE(adapter::saves == 0); // no premature credential acceptance/rollback
        got_ip();
        return group->bits;
    };
    REQUIRE(wifi_start_sta());
    REQUIRE(waits == 2);
    REQUIRE(adapter::saves == 1 && !adapter::cfg.wifi_rollback_active);
    REQUIRE(adapter::cfg.wifi_ssid == "test-wifi");
}
void stale_boot_timeout() {
    reset();
    int waits    = 0;
    sdk::on_wait = [&waits](FakeEvents* group, TickType_t timeout) {
        ++waits;
        if (waits == 1) {
            sdk::ticks += 7000;
            got_ip();
            const auto wake = group->bits;
            sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED);
            return wake;
        }
        REQUIRE(timeout == 23000);
        sdk::ticks += timeout;
        return group->bits;
    };
    REQUIRE(!wifi_start_sta());
    REQUIRE(waits == 2 && sdk::ticks == 30000);
    REQUIRE(!wifi_running() && !wifi_link_up());
    REQUIRE(sdk::handlers.empty());
    REQUIRE(adapter::saves == 0 && sdk::restarts == 0);
}
void boot_retry_budget() {
    reset();
    sdk::on_start = [] {
        wifi_event_sta_disconnected_t event{201, -80};
        for (int i = 0; i < 11; ++i) sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &event);
    };
    REQUIRE(!wifi_start_sta());
    REQUIRE(sdk::connects == 11);
    REQUIRE(sdk::handlers.empty() && !wifi_running());
}
void pending_rollback() {
    reset();
    adapter::cfg.wifi_rollback_active = true;
    adapter::cfg.wifi_ssid_backup     = "fallback";
    adapter::cfg.wifi_pass_backup     = "old-password";
    adapter::save_ok                  = false; // failed persistence must not reboot
    sdk::on_start                     = [] {
        wifi_event_sta_disconnected_t event{201, -80};
        for (int i = 0; i < 15; ++i) sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &event);
        REQUIRE(!(s_events->bits & FAIL_BIT));
    };
    REQUIRE(!wifi_start_sta());
    REQUIRE(sdk::ticks == 180000);
    REQUIRE(adapter::saves == 1 && sdk::restarts == 0);
    REQUIRE(adapter::cfg.wifi_ssid == "test-wifi" && adapter::cfg.wifi_rollback_active);
}
void successful_auth_rollback() {
    reset();
    adapter::cfg.wifi_rollback_active = true;
    adapter::cfg.wifi_ssid_backup     = "fallback";
    adapter::cfg.wifi_pass_backup     = "old-password";
    sdk::on_start                     = [] {
        wifi_event_sta_disconnected_t event{202, -45};
        for (int i = 0; i < 15; ++i) sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, &event);
        REQUIRE(!(s_events->bits & FAIL_BIT)); // a pending trial owns the deadline, not MAX_RETRY
    };
    bool restarted = false;
    try {
        (void)wifi_start_sta();
    } catch (const RestartRequest&) {
        restarted = true;
    }
    REQUIRE(restarted && sdk::restarts == 1 && adapter::saves == 1);
    REQUIRE(sdk::ticks == 60500 && sdk::wait_budgets.size() == 2);
    REQUIRE(adapter::cfg.wifi_ssid == "fallback" && adapter::cfg.wifi_pass == "old-password");
    REQUIRE(!adapter::cfg.wifi_rollback_active && adapter::cfg.wifi_rolled_back);
    REQUIRE(adapter::cfg.wifi_ssid_backup.empty() && adapter::cfg.wifi_pass_backup.empty());
}
void queue_rejection() {
    reset();
    syslog_send("no queue", 8);
    REQUIRE(s_queue_dropped == 0);
    syslog_init();
    for (int i = 0; i < 32; ++i) syslog_send("message", 7);
    REQUIRE(syslog_status().queue_dropped == 0 && s_queue->count == 32);
    const size_t log_count = adapter::logs.size();
    sdk::forbid_alloc      = true;
    syslog_send("rejected", 8);
    syslog_send("rejected", 8);
    sdk::forbid_alloc = false;
    REQUIRE(syslog_status().queue_dropped == 2 && adapter::logs.size() == log_count);
    SyslogMsg msg;
    REQUIRE(xQueueReceive(s_queue, &msg, 0) == pdTRUE);
    REQUIRE(msg.len == 7 && std::string(msg.text) == "message");
    syslog_send("recovered", 9);
    REQUIRE(syslog_status().queue_dropped == 2 && s_queue->count == 32);
}
void reentrant_suppression() {
    reset();
    syslog_init();
    sdk::queue_reject = true;
    const int sends   = sdk::queue_sends;
    diag_printf("[123.4] syslog: forwarding paused\n");
    REQUIRE(sdk::queue_sends == sends && syslog_status().queue_dropped == 0);
    diag_printf("[123.4] wifi: reconnecting\n");
    REQUIRE(sdk::queue_sends == sends + 1 && syslog_status().queue_dropped == 1);
    diag_printf("syslog: forwarding recovered\n");
    REQUIRE(syslog_status().queue_dropped == 1);
}
void queue_saturation() {
    reset();
    syslog_init();
    sdk::queue_reject = true;
    s_queue_dropped   = UINT32_MAX - 1;
    syslog_send("one", 3);
    syslog_send("two", 3);
    REQUIRE(syslog_status().queue_dropped == UINT32_MAX);
}
void timestamp_framing() {
    reset();
    sockaddr_in destination{};
    destination.sin_family                                      = AF_INET;
    destination.sin_addr.s_addr                                 = htonl(INADDR_LOOPBACK);
    int                                                  sender = -1;
    const std::array<std::pair<int64_t, const char*>, 4> cases{{
        {1700000000, "2023-11-14T22:13:20.007Z"},
        {-1, "-"},
        {253402300800LL, "-"},
        {INT64_MAX, "-"},
    }};
    for (const auto& item : cases) {
        adapter::unix_s = item.first;
        adapter::ms     = 7;
        REQUIRE(syslog_sendto(sender, destination, "sample\n", 7) == SendResult::Ok);
        const std::string expected =
            std::string("<14>1 ") + item.second + " daikin-altherma-esp32 - - - - sample";
        REQUIRE(sdk::packets.back() == expected);
    }
    fail_calendar_conversion = true;
    adapter::unix_s          = 1700000000;
    REQUIRE(syslog_sendto(sender, destination, "sample", 6) == SendResult::Ok);
    REQUIRE(sdk::packets.back() == "<14>1 - daikin-altherma-esp32 - - - - sample");
    fail_calendar_conversion = false;
    sdk::fail_send           = true;
    REQUIRE(syslog_sendto(sender, destination, "sample", 6) == SendResult::SendFailed);
    REQUIRE(s_queue_dropped == 0); // failed UDP sending is not failed queue enqueue
}
void status_mutex_failure() {
    reset();
    sdk::fail_dynamic_mutex = true;
    syslog_init();
    REQUIRE(sdk::dynamic_mutex_creations == 0);
    REQUIRE(s_status_mtx != nullptr && sdk::tasks.size() == 1);
    set_status(true, true, "sample");
    const auto status = syslog_status();
    REQUIRE(status.resolved && status.reachable && status.error == "sample");
    REQUIRE(sdk::lock_depth == 0 && !s_status_mtx->held);
    try {
        SemGuard guard(s_status_mtx);
        REQUIRE(guard.acquired());
        throw std::bad_alloc();
    } catch (const std::bad_alloc&) {}
    REQUIRE(sdk::lock_depth == 0 && !s_status_mtx->held);
    {
        SemGuard missing(nullptr, 0);
        REQUIRE(!missing.acquired());
    }
    REQUIRE(sdk::lock_depth == 0);
}

// Two failed snapshots, one successful idle/full cycle, then two independent failures.
// Real operator-new rejection proves once-per-episode logging without changing task cadence.
void syslog_episode_recovery(syslog_episode::Recovery recovery) {
    reset();
    syslog_init();
    REQUIRE(sdk::tasks.size() == 1);
    syslog_episode::recovery = recovery;
    adapter::cfg.syslog_host.assign(80, 'a');
    syslog_episode::active = true;
    sdk::on_delay          = [](TickType_t ticks) {
        REQUIRE(syslog_episode::lock_depth == 0 && sdk::lock_depth == 0);
        if (ticks == 2000) {
            REQUIRE(syslog_episode::cycles == 3);
            ++syslog_episode::idle_delays;
        } else if (ticks == 1000) {
            ++syslog_episode::failure_delays;
            // This delay is outside the caught try body, so the sentinel stops the task.
            if (syslog_episode::failure_delays == 4) throw syslog_episode::StopTask{};
        } else
            REQUIRE(false);
    };
    sdk::on_queue_receive = [](TickType_t ticks) {
        REQUIRE(syslog_episode::cycles == 3);
        if (ticks == portMAX_DELAY || ticks == 500)
            ++syslog_episode::idle_receives;
        else
            REQUIRE(false);
    };
    bool stopped = false;
    try {
        adapter::stack_owner = StackWatch::Syslog;
        sdk::tasks.front()->fn(sdk::tasks.front()->arg);
    } catch (const syslog_episode::StopTask&) {
        stopped = true;
    }
    adapter::stack_owner   = StackWatch::COUNT;
    syslog_episode::active = false;
    sdk::forbid_alloc      = false;
    sdk::on_delay          = {};
    sdk::on_queue_receive  = {};
    REQUIRE(stopped);
    REQUIRE(syslog_episode::cycles == 5 && syslog_episode::allocation_failures == 4);
    REQUIRE(adapter::stack_samples[static_cast<unsigned>(StackWatch::Syslog)] == 5);
    REQUIRE(syslog_episode::failure_delays == 4);
    REQUIRE(syslog_episode::lock_depth == 0 && sdk::lock_depth == 0);
    REQUIRE(syslog_network_quiesced());
    if (recovery == syslog_episode::Recovery::NetworkDown)
        REQUIRE(syslog_episode::idle_delays == 1 && syslog_episode::idle_receives == 0);
    else
        REQUIRE(syslog_episode::idle_delays == 0 && syslog_episode::idle_receives == 1);
    unsigned reports = 0;
    for (const auto& log : adapter::logs)
        if (log.find("syslog: task cycle skipped") != std::string::npos) ++reports;
    REQUIRE(reports == 2); // consecutive failures produce one report, recovery starts a new episode
}
void syslog_unconfigured_episode() {
    syslog_episode_recovery(syslog_episode::Recovery::Unconfigured);
}
void syslog_network_down_episode() {
    syslog_episode_recovery(syslog_episode::Recovery::NetworkDown);
}
void syslog_complete_cycle_episode() {
    syslog_episode_recovery(syslog_episode::Recovery::CompleteCycle);
}

} // namespace test
int main(int argc, char** argv) {
    const std::pair<const char*, void (*)()> cases[] = {
        {"lost_lease", test::lost_lease},
        {"disconnect_retry", test::disconnect_retry},
        {"foreign_ip", test::foreign_ip},
        {"snapshot_loss", test::snapshot_loss},
        {"snapshot_reacquisition", test::snapshot_reacquisition},
        {"scan_failure", test::scan_failure},
        {"stale_boot_wake", test::stale_boot_wake},
        {"stale_boot_timeout", test::stale_boot_timeout},
        {"boot_retry_budget", test::boot_retry_budget},
        {"pending_rollback", test::pending_rollback},
        {"successful_auth_rollback", test::successful_auth_rollback},
        {"queue_rejection", test::queue_rejection},
        {"reentrant_suppression", test::reentrant_suppression},
        {"queue_saturation", test::queue_saturation},
        {"timestamp_framing", test::timestamp_framing},
        {"status_mutex_failure", test::status_mutex_failure},
        {"syslog_unconfigured_episode", test::syslog_unconfigured_episode},
        {"syslog_network_down_episode", test::syslog_network_down_episode},
        {"syslog_complete_cycle_episode", test::syslog_complete_cycle_episode},
    };
    unsigned count = 0;
    for (const auto& item : cases) {
        if (argc == 2 && std::string(argv[1]) != item.first) continue;
        try {
            item.second();
            ++count;
            std::cout << "PASS " << item.first << '\n';
        } catch (const std::exception& e) {
            sdk::forbid_alloc = false;
            std::cerr << "FAIL " << item.first << ": " << e.what() << '\n';
            return 1;
        }
    }
    test::reset();
    std::cout << "PASS total=" << count << '\n';
    return count ? 0 : 2;
}
