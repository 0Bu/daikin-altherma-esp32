// WiFi station bring-up. Connects to the STRONGEST AP for the SSID (all-channel scan + connect by
// signal), then keeps the link up with two layers: an endless-reconnect handler (bounded budget on
// the first-ever connect → setup portal if the creds are wrong; reconnect forever once online) and
// an ICMP-to-gateway watchdog that catches missed-deauth "ghost" associations no event reports.
// Also starts mDNS (<hostname>.local). See wifi.hpp and docs/ARCHITECTURE.md → WiFi/LAN.
#include "wifi.hpp"
#include "config.hpp"
#include "sdkconfig.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "mdns.h"
#include "ping/ping_sock.h"
#include "lwip/ip_addr.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <cstdio>
#include <cstring>

namespace daik {

static const char* TAG = "wifi";
static EventGroupHandle_t s_events;
static esp_netif_t* s_sta_netif = nullptr;   // kept for live IP lookup (wifi_info) + watchdog
static esp_event_handler_instance_t s_h_wifi = nullptr, s_h_ip = nullptr;
static const int CONNECTED_BIT = BIT0;
static const int FAIL_BIT      = BIT1;

static int s_retry_num       = 0;
static const int MAX_RETRY   = 10;   // first-boot connect attempts before falling back to the portal

// True only while the STA holds an IP. Gates esp_wifi_sta_get_ap_info() (wifi_info) so it never
// reads the AP record mid-association, when its fields are transiently null and a concurrent read
// faults (LoadProhibited). Written from the event-loop task, read from the HTTP / watchdog tasks.
static volatile bool s_wifi_connected = false;
// Set true on the first GOT_IP, never cleared. Distinguishes a boot-time connect (budget spent →
// creds presumed wrong → setup portal) from a runtime drop (creds known-good → reconnect forever).
static volatile bool s_wifi_ever_connected = false;
// Cumulative RE-connect count (excludes the first-ever GOT_IP) — see wifi_reconnect_count().
static volatile uint32_t s_reconnects = 0;

bool wifi_configured() { return !config().wifi_ssid.empty(); }

static void on_wifi(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_connected = false;
        // reason tells a transient SAE/handshake failure (15 4WAY_TIMEOUT, 202 AUTH_FAIL,
        // 204 HANDSHAKE_TIMEOUT) apart from wrong creds (201/211) or a real outage (200/8/deauth).
        auto* d = static_cast<wifi_event_sta_disconnected_t*>(data);
        if (!s_wifi_ever_connected && s_retry_num >= MAX_RETRY) {
            // Never online AND the boot budget is spent → creds are almost certainly wrong. Stop so
            // wifi_start_sta() unblocks on FAIL_BIT and the caller opens the setup portal.
            ESP_LOGW(TAG, "first-boot connect budget spent (last reason %d) → setup portal",
                     d ? d->reason : -1);
            xEventGroupSetBits(s_events, FAIL_BIT);
        } else {
            // Within the boot budget, OR online before (a runtime drop: router reboot, roaming, a
            // delivered deauth). Creds known-good → reconnect FOREVER; never strand the bridge.
            esp_wifi_connect();
            s_retry_num++;
            // Throttle so a long outage can't flood the /diag ring, but always carry the reason/rssi.
            if (s_retry_num <= MAX_RETRY || s_retry_num % 20 == 0)
                ESP_LOGI(TAG, "wifi (re)connect attempt %d (reason %d, rssi %d)",
                         s_retry_num, d ? d->reason : -1, d ? d->rssi : 0);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto* e = static_cast<ip_event_got_ip_t*>(data);
        ESP_LOGI(TAG, "connected, ip=" IPSTR, IP2STR(&e->ip_info.ip));
        if (s_wifi_ever_connected) s_reconnects = s_reconnects + 1;   // a later GOT_IP is a RE-connect
        s_retry_num           = 0;
        s_wifi_connected      = true;
        s_wifi_ever_connected = true;
        xEventGroupSetBits(s_events, CONNECTED_BIT);
    }
}

// ─── Connectivity watchdog ───────────────────────────────────────────────────────────────────
// The endless-reconnect handler above recovers any drop the STA KNOWS about. It cannot see a
// "ghost" association: a missed deauth leaves the stack believing it is still up (keeps the IP,
// keeps emitting TCP that times out) while the AP forwards nothing and NO STA_DISCONNECTED ever
// fires — so the handler never runs. This task closes that gap: it ICMP-echoes the default gateway
// every kWdPeriodS and, only for the ghost case (link up, yet a gateway that HAS answered before
// now doesn't), forces one esp_wifi_disconnect() so the handler re-associates with the known-good
// creds. It deliberately NEVER reboots — a reboot during an AP outage would exhaust the boot budget
// and drop into the setup portal, abandoning good credentials.

static const int kWdPeriodS       = 30;   // connectivity-check cadence
static const int kWdFailToReassoc = 2;    // consecutive failed checks (~60 s) → re-associate
static const int kWdPingTimeoutMs = 1000; // per-echo timeout
static const int kWdPingCount     = 3;    // echoes per check; healthy if ≥1 replies

// File-scope so the control block + semaphore outlive any in-flight esp_ping session: the ping's
// internal thread is NOT joined by esp_ping_delete_session() and calls wd_on_ping_end()
// unconditionally once started. A per-call frame would be a use-after-free if take() timed out
// first; file-scope storage removes the window (a stale give is drained at the next probe).
struct WdPing { SemaphoreHandle_t done; uint32_t received; };
static WdPing s_wd = { nullptr, 0 };

// True the first time the gateway answers ICMP, never cleared. Until a baseline exists we have no
// evidence this gateway answers echo at all, so a router that drops LAN ICMP must NOT read as "link
// dead" (that would re-associate a healthy link every ~60 s forever). A real ghost replied before.
static volatile bool s_gw_ever_reachable = false;

static void wd_on_ping_end(esp_ping_handle_t hdl, void* args) {
    auto* p = static_cast<WdPing*>(args);
    uint32_t recv = 0;
    esp_ping_get_profile(hdl, ESP_PING_PROF_REPLY, &recv, sizeof(recv));
    p->received = recv;
    xSemaphoreGive(p->done);
}

// Blocking ICMP echo to the current default gateway. True if ≥1 reply came back. Returns true (no
// false alarm) whenever the probe can't even be set up — the watchdog must act only on a *proven*
// failure to reach a gateway that DOES answer ICMP, never on its own inability to measure.
static bool gateway_reachable() {
    if (!s_wd.done) return true;   // watchdog not fully initialised yet
    esp_netif_ip_info_t ip{};
    if (!s_sta_netif || esp_netif_get_ip_info(s_sta_netif, &ip) != ESP_OK || ip.gw.addr == 0)
        return false;              // no gateway/lease → not reachable

    char gw[16];
    esp_ip4addr_ntoa(&ip.gw, gw, sizeof(gw));
    ip_addr_t target{};
    if (!ipaddr_aton(gw, &target)) return true;   // unparseable → don't false-alarm

    esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
    cfg.target_addr = target;
    cfg.count       = kWdPingCount;
    cfg.timeout_ms  = kWdPingTimeoutMs;
    cfg.interval_ms = 250;

    esp_ping_callbacks_t cbs = {};
    cbs.cb_args     = &s_wd;
    cbs.on_ping_end = wd_on_ping_end;

    esp_ping_handle_t hdl = nullptr;
    if (esp_ping_new_session(&cfg, &cbs, &hdl) != ESP_OK || !hdl)
        return true;               // probe setup failed → don't false-alarm

    xSemaphoreTake(s_wd.done, 0);  // drain any stale give from a prior timed-out probe
    s_wd.received = 0;
    esp_ping_start(hdl);
    // Wait out the whole sequence (count × (timeout + interval)) plus margin. A take() timeout is
    // harmless because s_wd is persistent (see above).
    xSemaphoreTake(s_wd.done, pdMS_TO_TICKS(kWdPingCount * (kWdPingTimeoutMs + 250) + 2000));
    esp_ping_stop(hdl);
    vTaskDelay(pdMS_TO_TICKS(100)); // allow the ping task context to safely exit before deletion
    esp_ping_delete_session(hdl);

    bool ok = s_wd.received > 0;
    if (ok) s_gw_ever_reachable = true;
    return ok;
}

static void wifi_watchdog_task(void*) {
    s_wd.done = xSemaphoreCreateBinary();
    int fails = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(kWdPeriodS * 1000));

        // When the link already knows it is down, the endless-retry handler owns recovery — there is
        // nothing for the watchdog to detect (the ghost case is link=up by definition), and
        // counting/logging every period would only flood the /diag ring across a long router outage.
        if (!s_wifi_connected) { fails = 0; continue; }
        if (gateway_reachable()) { fails = 0; continue; }

        fails++;
        ESP_LOGW(TAG, "watchdog: no LAN connectivity (%d/%d, link=up)", fails, kWdFailToReassoc);
        if (fails < kWdFailToReassoc) continue;
        fails = 0;

        // Act ONLY on a true ghost association: link still believes it is up AND this gateway has
        // answered ICMP before (so its silence is real, not a firewall). One disconnect is enough —
        // the handler's else-branch reconnects (s_wifi_ever_connected is true), so we don't call
        // esp_wifi_connect() ourselves and avoid a cross-task double-connect.
        if (!s_gw_ever_reachable) {
            ESP_LOGW(TAG, "watchdog: gateway has never answered ICMP — not forcing re-assoc");
            continue;
        }
        ESP_LOGW(TAG, "watchdog: ghost association — forcing WiFi re-association");
        esp_wifi_disconnect();   // drops the ghost link → handler reconnects (known-good creds)
    }
}

static void start_mdns() {
    if (mdns_init() != ESP_OK) return;
    mdns_hostname_set(CONFIG_DAIKIN_HOSTNAME);
    mdns_service_add(nullptr, "_http", "_tcp", 80, nullptr, 0);
}

// Tear the STA stack fully down so the caller can bring up the AP setup portal on a clean WiFi
// state (provisioning_start_ap() re-runs esp_wifi_init(), which aborts if WiFi is still up). Only
// reached on a first-boot connect failure. Handlers are unregistered FIRST so the disconnect that
// esp_wifi_stop() raises can't re-enter on_wifi() and fire another esp_wifi_connect().
static void wifi_stop_sta() {
    if (s_h_wifi) { esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, s_h_wifi); s_h_wifi = nullptr; }
    if (s_h_ip)   { esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, s_h_ip);  s_h_ip = nullptr; }
    esp_wifi_stop();
    esp_wifi_deinit();
    if (s_sta_netif) { esp_netif_destroy_default_wifi(s_sta_netif); s_sta_netif = nullptr; }
}

bool wifi_start_sta() {
    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    s_sta_netif = esp_netif_create_default_wifi_sta();
    // Advertise our hostname to the router via DHCP (option 12) BEFORE the DHCP client runs, so the
    // router's client list shows "daikin-altherma-esp32", not the IDF default "espressif". This is
    // the DHCP name; mDNS (start_mdns) sets the matching <hostname>.local name separately.
    if (s_sta_netif) esp_netif_set_hostname(s_sta_netif, CONFIG_DAIKIN_HOSTNAME);
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, nullptr, &s_h_wifi);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, nullptr, &s_h_ip);

    wifi_config_t wc = {};
    const Config& c  = config();
    strncpy(reinterpret_cast<char*>(wc.sta.ssid), c.wifi_ssid.c_str(), sizeof(wc.sta.ssid) - 1);
    strncpy(reinterpret_cast<char*>(wc.sta.password), c.wifi_pass.c_str(), sizeof(wc.sta.password) - 1);

    // Pick the STRONGEST AP for the SSID, not the first one heard. The IDF default WIFI_FAST_SCAN
    // stops at the first matching BSSID (channel-order/timing dependent), so on a multi-AP network
    // (mesh / several access points sharing one SSID) this stationary bridge latches onto whatever
    // answers first — often a distant, weak AP — and the ESP32 STA never roams off it. That is the
    // "weak WiFi signal" symptom. WIFI_ALL_CHANNEL_SCAN scans every channel; WIFI_CONNECT_AP_BY_SIGNAL
    // then connects to the highest-RSSI AP. Costs ~1-2 s more per connect; the config persists across
    // reconnects, so every later WIFI_EVENT_STA_DISCONNECTED reconnect re-selects the strongest AP too.
    wc.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    wc.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;

    // Stick with the ranked (strongest) AP across a transient association/SAE hiccup instead of
    // immediately dropping to a weaker one. The default failure_retry_cnt is 0 → the driver abandons
    // the top-ranked AP on the first failure and connects to the next-strongest (observed live: a
    // transient WPA3-SAE auth failure on the −47 dBm AP handed us a −74 dBm one). Requires
    // WIFI_ALL_CHANNEL_SCAN (set above). Each retry is one connect attempt, still within the
    // first-boot budget below; after this many the driver does fall back, so a truly-down strong AP
    // still yields a connection.
    wc.sta.failure_retry_cnt = 3;

    // Advertise BOTH SAE PWE methods. wc is zero-initialised, which would leave this UNSPECIFIED and
    // fall back to Hunt-and-Peck (the device logged "WPA3-SAE HUNT_AND_PECK") — the slower, more
    // timing-sensitive derivation that is likelier to time out. Hash-to-Element is then used when the
    // AP supports it (build: CONFIG_ESP_WIFI_ENABLE_SAE_H2E); H&P stays the fallback for older APs.
    wc.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

#ifdef CONFIG_DAIKIN_WIFI_PREFER_5G
    // ESP32-C5 (dual-band) opt-in: when the SSID is band-steered onto both 2.4 and 5 GHz, give 5 GHz
    // APs a fixed RSSI bonus so the BY_SIGNAL sort above prefers the (usually cleaner) 5 GHz radio.
    // Band mode stays AUTO, so a unit out of 5 GHz range still falls back to 2.4 GHz — no reconnect
    // trap. Gated behind CONFIG_DAIKIN_WIFI_PREFER_5G (Kconfig depends on SOC_WIFI_SUPPORT_5G, so the
    // field and this block exist only on the C5). 10 dB: prefer 5 GHz unless it is >~10 dB weaker.
    wc.sta.threshold.rssi_5g_adjustment = 10;
#endif

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Disable WiFi modem sleep. The IDF default is WIFI_PS_MIN_MODEM: the radio sleeps between
    // DTIM beacons and only wakes at the DTIM interval to pull buffered downlink packets, which
    // adds ~100-300 ms (and, with TCP retransmits, occasionally seconds) of non-deterministic
    // latency to every inbound request — the HTTP UI then "sometimes takes very long to answer".
    // This is a mains-powered bridge, so we trade the small idle-power saving for a responsive UI.
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    // Block until the first IP or the first-boot budget is exhausted (creds presumed wrong).
    EventBits_t bits = xEventGroupWaitBits(s_events, CONNECTED_BIT | FAIL_BIT, pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(30000));
    if (!(bits & CONNECTED_BIT)) {
        ESP_LOGW(TAG, "STA connect failed on first boot — falling back to setup portal");
        wifi_stop_sta();
        return false;
    }

    start_mdns();
    // Ghost-association watchdog. Started only once online; it self-guards on s_wifi_connected.
    xTaskCreate(wifi_watchdog_task, "wifi_wd", 3072, nullptr, 4, nullptr);
    return true;
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
        // Only read the AP record while the link is up: mid-association its fields are transiently
        // null and a concurrent read faults (LoadProhibited). See s_wifi_connected.
        wifi_ap_record_t ap{};
        if (s_wifi_connected && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) info.rssi = ap.rssi;
    }
    return info;
}

uint32_t wifi_reconnect_count() { return s_reconnects; }

} // namespace daik
