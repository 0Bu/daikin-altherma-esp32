// WiFi station bring-up. Connects to the STRONGEST AP for the SSID (all-channel scan + connect by
// signal), then keeps the link up with two layers: an endless-reconnect handler (bounded budget on
// the first-ever connect → setup portal if the creds are wrong; reconnect forever once online) and
// an ICMP-to-gateway watchdog that catches missed-deauth "ghost" associations no event reports.
// Also starts mDNS (<hostname>.local). See wifi.hpp and docs/ARCHITECTURE.md → WiFi/LAN.
#include "wifi.hpp"
#include "config.hpp"
#include "diag_log.hpp"
#include "logic/link_watch.hpp"
#include "logic/wifi_rollback.hpp"
#include "sdkconfig.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "net.hpp"
#include "ping/ping_sock.h"
#include "lwip/ip_addr.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp"   // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <atomic>
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

// Cross-task flags below are std::atomic, not volatile: volatile carries no cross-task visibility or
// ordering guarantee under the C++ memory model — sharing a flag between the WiFi event task and the
// HTTP / watchdog / main tasks is exactly what atomics are for. Each is a single value with no
// multi-field invariant, so a plain atomic (default seq_cst) is enough; no mutex is needed.
//
// True only while the STA holds an IP. Gates esp_wifi_sta_get_ap_info() (wifi_info) so it never
// reads the AP record mid-association, when its fields are transiently null and a concurrent read
// faults (LoadProhibited). Written from the event-loop task, read from the HTTP / watchdog tasks.
static std::atomic<bool> s_wifi_connected{false};
// Set true on the first GOT_IP, never cleared. Distinguishes a boot-time connect (budget spent →
// creds presumed wrong → setup portal) from a runtime drop (creds known-good → reconnect forever).
static std::atomic<bool> s_wifi_ever_connected{false};
// Cumulative RE-connect count (excludes the first-ever GOT_IP) — see wifi_reconnect_count().
static std::atomic<uint32_t> s_reconnects{0};
// Reason code of the most recent STA_DISCONNECTED (0 = none seen this boot). Read by the boot-window
// rollback decision to tell "the AP refused these credentials" from "the AP was not there at all" —
// logic/wifi_rollback.hpp owns what each reason means.
static std::atomic<int> s_last_disco_reason{0};
// True only for a boot that carries a PENDING credential change (POST /set_wifi armed a one-shot
// backup). It makes this boot the trial run for the new credentials — the only boot allowed to
// discard them — and holds the first-boot retry budget open for the whole grace window below.
static std::atomic<bool> s_rollback_pending{false};

bool wifi_configured() { return !config().wifi_ssid.empty(); }

static void on_wifi(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_CONNECTED) {
        // Associated — the AP accepted us, so whatever refused us earlier is history, not evidence.
        // Clearing the slot is what keeps the rollback decision reading the CURRENT story: without
        // it, a transient SAE failure at t=10 s would still be the "last reason" at the t=30 s
        // checkpoint even though we are, right now, associated to the new AP and merely waiting on a
        // first DHCP lease — and the boot window would roll back credentials that had just worked.
        s_last_disco_reason = 0;
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_connected = false;
        auto* d = static_cast<wifi_event_sta_disconnected_t*>(data);

        // Remember WHY, for the boot-window rollback decision (logic/wifi_rollback.hpp). Recording
        // the reason is ALL this handler does with it: reasons 15/202/204 mean "wrong credentials"
        // only where wrong credentials are a live hypothesis, i.e. while a credential change is
        // pending. They are also the transient WPA3-SAE failures this very file works around below
        // (failure_retry_cnt, sae_pwe_h2e) and has observed live on a healthy network. An earlier
        // revision rebooted the device after 5 of them in a row whenever it had ever been online —
        // which handed a passing RF storm the power to strand a perfectly healthy bridge in the open
        // setup portal, with good credentials in NVS and no way back short of a power cycle. That is
        // the exact inversion of the invariant this handler exists to keep, so the reboot is gone:
        // once online, EVERY disconnect reason is just something to reconnect through, forever.
        s_last_disco_reason = d ? d->reason : 0;

        if (!s_wifi_ever_connected && s_retry_num >= MAX_RETRY && !s_rollback_pending) {
            // Never online AND the boot budget is spent → creds are almost certainly wrong. Stop so
            // wifi_start_sta() unblocks on FAIL_BIT and the caller opens the setup portal. With a
            // credential change pending the budget does NOT apply: there the DEADLINE owns the
            // decision (logic/wifi_rollback.hpp), and giving up after ten fast NO_AP_FOUND scans
            // would roll back before a rebooting router ever had a chance to answer.
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
        if (s_wifi_ever_connected) s_reconnects.fetch_add(1);   // a later GOT_IP is a RE-connect
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
static const int kWdPingTimeoutMs = 1000; // per-echo timeout
static const int kWdPingCount     = 3;    // echoes per check; healthy if ≥1 replies
// The re-association thresholds live in logic/link_watch.hpp (WD_UNREACHABLE_TO_REASSOC /
// WD_BLIND_TO_REASSOC) so the policy they express is host-tested rather than asserted here.

// File-scope so the control block + semaphore outlive any in-flight esp_ping session: the ping's
// internal thread is NOT joined by esp_ping_delete_session() and calls wd_on_ping_end()
// unconditionally once started. A per-call frame would be a use-after-free if take() timed out
// first; file-scope storage removes the window (a stale give is drained at the next probe).
struct WdPing { SemaphoreHandle_t done; uint32_t received; };
static WdPing s_wd = { nullptr, 0 };

// True the first time the gateway answers ICMP, never cleared. Until a baseline exists we have no
// evidence this gateway answers echo at all, so a router that drops LAN ICMP must NOT read as "link
// dead" (that would re-associate a healthy link every ~60 s forever). A real ghost replied before.
static std::atomic<bool> s_gw_ever_reachable{false};

static void wd_on_ping_end(esp_ping_handle_t hdl, void* args) {
    auto* p = static_cast<WdPing*>(args);
    uint32_t recv = 0;
    esp_ping_get_profile(hdl, ESP_PING_PROF_REPLY, &recv, sizeof(recv));
    p->received = recv;
    xSemaphoreGive(p->done);
}

// Blocking ICMP echo to the current default gateway. Reports what was ESTABLISHED, not a verdict:
// Reachable (≥1 reply), Unreachable (the probe ran, nothing replied) or Unmeasurable (it could not
// be taken at all). The distinction matters — folding "couldn't measure" into "reachable" is what
// let a wedged board look healthy to this watchdog forever, and silently. logic/link_watch.hpp
// decides what to DO with each; this function only observes.
static GwProbe gateway_probe() {
    if (!s_wd.done) return GwProbe::Unmeasurable;   // watchdog not fully initialised yet
    esp_netif_ip_info_t ip{};
    if (!s_sta_netif || esp_netif_get_ip_info(s_sta_netif, &ip) != ESP_OK || ip.gw.addr == 0)
        return GwProbe::Unreachable;   // no gateway/lease while link=up IS a proven broken link

    char gw[16];
    esp_ip4addr_ntoa(&ip.gw, gw, sizeof(gw));
    ip_addr_t target{};
    if (!ipaddr_aton(gw, &target)) return GwProbe::Unmeasurable;   // can't address it → can't measure

    esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
    cfg.target_addr = target;
    cfg.count       = kWdPingCount;
    cfg.timeout_ms  = kWdPingTimeoutMs;
    cfg.interval_ms = 250;

    esp_ping_callbacks_t cbs = {};
    cbs.cb_args     = &s_wd;
    cbs.on_ping_end = wd_on_ping_end;

    esp_ping_handle_t hdl = nullptr;
    // The allocation that goes first under memory pressure — and memory pressure is exactly what
    // accompanies the wedge this watchdog exists to break. Reporting it as Unmeasurable (rather than
    // as healthy) is what makes a blind watchdog visible instead of indistinguishable from a good link.
    if (esp_ping_new_session(&cfg, &cbs, &hdl) != ESP_OK || !hdl)
        return GwProbe::Unmeasurable;

    xSemaphoreTake(s_wd.done, 0);  // drain any stale give from a prior timed-out probe
    s_wd.received = 0;
    esp_ping_start(hdl);
    // Wait out the whole sequence (count × (timeout + interval)) plus margin. A take() timeout is
    // harmless because s_wd is persistent (see above).
    xSemaphoreTake(s_wd.done, pdMS_TO_TICKS(kWdPingCount * (kWdPingTimeoutMs + 250) + 2000));
    esp_ping_stop(hdl);
    vTaskDelay(pdMS_TO_TICKS(100)); // allow the ping task context to safely exit before deletion
    esp_ping_delete_session(hdl);

    if (s_wd.received > 0) { s_gw_ever_reachable = true; return GwProbe::Reachable; }
    return GwProbe::Unreachable;   // the probe ran and nothing answered — proven silence
}

static void wifi_watchdog_task(void*) {
    s_wd.done = xSemaphoreCreateBinary();
    if (!s_wd.done) {
        // Without the completion semaphore every probe would report Unmeasurable (gateway_probe
        // guards on it), which the policy eventually reads as a wedge and would re-associate a
        // healthy link on a timer. Don't run blind — retire the task and log it.
        diag_printf("wifi: watchdog semaphore alloc failed — ghost-association recovery disabled\n");
        vTaskDelete(nullptr);
        return;
    }
    LinkWatch lw;              // consecutive-observation counters; the policy owns the thresholds
    bool blind_logged = false; // latch: one line per blind SPELL, not one per 30 s period
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(kWdPeriodS * 1000));

        // When the link already knows it is down, the endless-retry handler owns recovery — there is
        // nothing for the watchdog to detect (the ghost case is link=up by definition), and
        // counting/logging every period would only flood the /diag ring across a long router outage.
        const bool link_up = s_wifi_connected;
        const GwProbe probe = link_up ? gateway_probe() : GwProbe::Unmeasurable;
        const WdAction act  = link_watch_step(lw, link_up, probe, s_gw_ever_reachable);

        // diag_printf, not ESP_LOGW: only diag lines reach /diag and syslog → VictoriaLogs. The old
        // ESP_LOGW lines existed but were serial-only, so a board that wedged in a ghost association
        // left NO watchdog trace anywhere off-device — the one place a post-mortem would look.
        if (link_up && probe == GwProbe::Unreachable)
            diag_printf("wifi: watchdog — no LAN connectivity (%d/%d, link=up)\n",
                        lw.unreachable, WD_UNREACHABLE_TO_REASSOC);
        if (link_up && probe == GwProbe::Unmeasurable && !blind_logged) {
            blind_logged = true;   // cleared once a probe runs again (below)
            diag_printf("wifi: watchdog — cannot probe the gateway (link=up); "
                        "acting after %d blind periods\n", WD_BLIND_TO_REASSOC);
        }
        // Unlatch once a probe actually runs again — and also when the link goes knowingly down,
        // since we stop probing there: leaving it latched would swallow the first line of the NEXT
        // blind spell after the link returns.
        if (!link_up || probe != GwProbe::Unmeasurable) blind_logged = false;

        if (act != WdAction::Reassociate) continue;

        // Act ONLY on a link this gateway has verified before (link_watch_step gates on
        // s_gw_ever_reachable, so its silence is real rather than a firewall). One disconnect is
        // enough — the handler's else-branch reconnects (s_wifi_ever_connected is true), so we don't
        // call esp_wifi_connect() ourselves and avoid a cross-task double-connect.
        diag_printf("wifi: watchdog — %s; forcing re-association\n",
                    probe == GwProbe::Unmeasurable ? "blind for too long while link claims up"
                                                   : "ghost association");
        esp_wifi_disconnect();   // drops the ghost link → handler reconnects (known-good creds)
    }
}

// True once esp_wifi_start() has run in STA mode this boot, cleared again by wifi_stop_sta(). It
// answers "is there a radio to fall back on", which a board that came up on Ethernet needs and
// cannot get from s_wifi_connected (a station retrying an association is running but not up).
static std::atomic<bool> s_sta_running{false};

bool wifi_running() { return s_sta_running.load(); }
bool wifi_link_up() { return s_wifi_connected.load(); }

// Tear the STA stack fully down so the caller can bring up the AP setup portal on a clean WiFi
// state (provisioning_start_ap() re-runs esp_wifi_init(), which aborts if WiFi is still up). Only
// reached on a first-boot connect failure. Handlers are unregistered FIRST so the disconnect that
// esp_wifi_stop() raises can't re-enter on_wifi() and fire another esp_wifi_connect().
static void wifi_stop_sta() {
    if (s_h_wifi) { esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, s_h_wifi); s_h_wifi = nullptr; }
    if (s_h_ip)   { esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, s_h_ip);  s_h_ip = nullptr; }
    esp_wifi_stop();
    esp_wifi_deinit();
    s_sta_running = false;
    if (s_sta_netif) { esp_netif_destroy_default_wifi(s_sta_netif); s_sta_netif = nullptr; }
    if (s_events) { vEventGroupDelete(s_events); s_events = nullptr; }
}

bool wifi_start_sta() {
    s_events = xEventGroupCreate();
    if (!s_events) {
        // The connect handshake (this function's wait + the event handler's SetBits) is entirely
        // driven through this event group; a null handle would fault the moment either touched it.
        // Fail safe: report false so main.cpp brings up the setup portal instead.
        ESP_LOGE(TAG, "event group alloc failed — cannot start STA; falling back to setup portal");
        return false;
    }
    s_sta_netif = esp_netif_create_default_wifi_sta();
    // Advertise our hostname to the router via DHCP (option 12) BEFORE the DHCP client runs, so the
    // router's client list shows "daikin-altherma-esp32", not the IDF default "espressif". This is
    // the DHCP name; mDNS (start_mdns) sets the matching <hostname>.local name separately.
    if (s_sta_netif) {
        const esp_err_t hostname_err = esp_netif_set_hostname(s_sta_netif, CONFIG_DAIKIN_HOSTNAME);
        if (hostname_err != ESP_OK)
            diag_printf("wifi: DHCP hostname set failed (%s) — options 12/60 may be absent\n",
                        esp_err_to_name(hostname_err));
    }
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));
    // `daik_cfg` is the sole persistence authority. IDF defaults to WIFI_STORAGE_FLASH, which would
    // silently duplicate SSID/password in its own NVS namespace and let them survive our factory
    // reset. Select RAM before the first set_config; config_load supplies them again every boot.
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, nullptr, &s_h_wifi);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, nullptr, &s_h_ip);

    wifi_config_t wc = {};
    const Config& c  = config();
    strncpy(reinterpret_cast<char*>(wc.sta.ssid), c.wifi_ssid.c_str(), sizeof(wc.sta.ssid) - 1);
    strncpy(reinterpret_cast<char*>(wc.sta.password), c.wifi_pass.c_str(), sizeof(wc.sta.password) - 1);

    // Is this boot the trial run for freshly-changed credentials? Latched BEFORE esp_wifi_start()
    // below, because the very first STA_DISCONNECTED can arrive before this function reaches its
    // wait — and the handler reads it to decide whether the boot retry budget still applies.
    const bool rollback_pending = c.wifi_rollback_active && !c.wifi_ssid_backup.empty();
    s_rollback_pending          = rollback_pending;

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

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    s_sta_running = true;

    // Disable WiFi modem sleep. The IDF default is WIFI_PS_MIN_MODEM: the radio sleeps between
    // DTIM beacons and only wakes at the DTIM interval to pull buffered downlink packets, which
    // adds ~100-300 ms (and, with TCP retransmits, occasionally seconds) of non-deterministic
    // latency to every inbound request — the HTTP UI then "sometimes takes very long to answer".
    // This is a mains-powered bridge, so we trade the small idle-power saving for a responsive UI.
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    // Block until the first IP, or until the boot window decides we are not getting one. An ordinary
    // boot gets the flat WIFI_BOOT_WINDOW_S: the setup portal is its fallback and a user is waiting
    // on it. A boot carrying a PENDING credential change is re-evaluated at each checkpoint instead
    // of merely expiring — rollback_step() spends the new credentials only once the AP has actually
    // refused them, and otherwise keeps hunting for an SSID that may just be a router still coming
    // back up (logic/wifi_rollback.hpp).
    EventBits_t bits = 0;
    RollbackWatch rw;
    for (int elapsed = 0;;) {
        bits = xEventGroupWaitBits(s_events, CONNECTED_BIT | FAIL_BIT, pdFALSE, pdFALSE,
                                   pdMS_TO_TICKS(WIFI_BOOT_WINDOW_S * 1000));
        elapsed += WIFI_BOOT_WINDOW_S;
        if (bits & (CONNECTED_BIT | FAIL_BIT)) break;
        if (!rollback_pending) break;   // no change pending → the flat window owns the decision
        if (rollback_step(rw, disco_class(s_last_disco_reason), elapsed) == RollbackAction::RollBack) break;
        ESP_LOGW(TAG, "new credentials: no IP after %d s (last reason %d) — the AP may still be "
                      "coming back; retrying up to %d s before rolling back",
                 elapsed, s_last_disco_reason.load(), WIFI_ROLLBACK_GRACE_S);
    }
    if (!(bits & CONNECTED_BIT)) {
        if (rollback_pending) {
            Config rollback_cfg = config();
            ESP_LOGW(TAG, "STA connect failed with new credentials (last reason %d) — rolling back to %s",
                     s_last_disco_reason.load(), rollback_cfg.wifi_ssid_backup.c_str());
            rollback_cfg.wifi_ssid = rollback_cfg.wifi_ssid_backup;
            rollback_cfg.wifi_pass = rollback_cfg.wifi_pass_backup;
            rollback_cfg.wifi_rollback_active = false;
            rollback_cfg.wifi_ssid_backup = "";
            rollback_cfg.wifi_pass_backup = "";
            // One-shot outcome marker, persisted so it survives the reboot this rollback is about to
            // take. Without it the dashboard simply shows the old SSID again and the rollback is
            // indistinguishable from a save that never happened — the user re-enters the same
            // credentials and waits out the same three minutes. Cleared by the next POST /set_wifi.
            rollback_cfg.wifi_rolled_back = true;
            // Only reboot into a rollback that actually persisted. The restore lives in NVS alone, so
            // if the write failed the next boot re-reads the SAME new credentials, spends the whole
            // window again and rolls back again — a reboot loop for as long as NVS misbehaves, with
            // no way in. On failure fall through to the setup portal below: reachable beats looping.
            if (config_save(rollback_cfg)) {
                vTaskDelay(pdMS_TO_TICKS(500));
                esp_restart();
            }
            // A false result here now means the one atomic blob did not land — not an unrelated
            // self-healing link-cache maintenance failure — so the restored credentials themselves
            // are definitely not durable. Erring toward the portal costs a re-entry; rebooting would
            // re-read the rejected credentials and risk the loop this branch exists to avoid.
            diag_printf("wifi: rollback restore to '%s' was not persisted — opening the setup "
                        "portal rather than risk a reboot loop\n",
                        rollback_cfg.wifi_ssid.c_str());
        }
        ESP_LOGW(TAG, "STA connect failed on first boot — falling back to setup portal");
        wifi_stop_sta();
        return false;
    }

    // The new credentials work — commit to them and drop the backup. Note what is NOT cleared here:
    // wifi_rolled_back. The boot right after a rollback is a SUCCESSFUL one (onto the restored
    // network), so clearing the marker on success would erase it before anyone could read it. Only
    // the next POST /set_wifi retires it.
    s_rollback_pending = false;
    Config success_cfg = config();
    if (success_cfg.wifi_rollback_active) {
        const std::string stale_backup = success_cfg.wifi_ssid_backup;
        success_cfg.wifi_rollback_active = false;
        success_cfg.wifi_ssid_backup = "";
        success_cfg.wifi_pass_backup = "";
        // Harmless right now — we're online either way — but a surviving flag means the next failed
        // connect would "roll back" to credentials the user already replaced. Log and carry on: this
        // connection is good, and refusing it over a stale flag would be the worse trade.
        if (!config_save(success_cfg))
            diag_printf("wifi: could not clear the rollback backup ('%s') — "
                        "a later connect failure may restore it\n", stale_backup.c_str());
    }

    net_mdns_start();
    // Ghost-association watchdog. Started only once online; it self-guards on s_wifi_connected.
    // 4096, not 3072: this task now reports through diag_printf (so its decisions reach /diag +
    // syslog, not just the serial console), and that call chain nests syslog_send inside
    // diag_printf — measured at ~700 B of frame depth this task never carried while it used
    // ESP_LOGW. 4096 is what every other diag_printf-calling task here is sized at (mqtt_pub;
    // hp_poll takes 8192). The canary (CONFIG_FREERTOS_CHECK_STACKOVERFLOW_CANARY) turns an
    // overflow into a reboot — which would land during the memory-pressure wedge this watchdog
    // exists to break, i.e. exactly when it must not.
    if (xTaskCreate(wifi_watchdog_task, "wifi_wd", 4096, nullptr, TASK_PRIO_WIFI_WD, nullptr) != pdPASS)
        diag_printf("wifi: watchdog task alloc failed — ghost-association recovery disabled this boot\n");
    return true;
}

esp_err_t wifi_forget_persisted_config() {
    bool temporary_init = false;
    esp_err_t e = esp_wifi_set_storage(WIFI_STORAGE_FLASH);
    if (e == ESP_ERR_WIFI_NOT_INIT) {
        wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
        e = esp_wifi_init(&ic);
        if (e != ESP_OK) return e;
        temporary_init = true;
        e = esp_wifi_set_storage(WIFI_STORAGE_FLASH);
    }
    if (e == ESP_OK) e = esp_wifi_restore();
    if (temporary_init) {
        const esp_err_t deinit = esp_wifi_deinit();
        if (e == ESP_OK) e = deinit;
    }
    return e;
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
        if (s_wifi_connected && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
            info.rssi = ap.rssi;
            memcpy(info.bssid, ap.bssid, 6);
            const char* std_ = ap.phy_11ax ? "Wi-Fi 6"
                             : ap.phy_11ac ? "Wi-Fi 5"
                             : ap.phy_11n  ? "Wi-Fi 4"
                             : ap.phy_11g  ? "802.11g"
                             : ap.phy_11b  ? "802.11b" : "Wi-Fi";
            strncpy(info.std, std_, sizeof(info.std) - 1);
            info.std[sizeof(info.std) - 1] = '\0';
        }
    }
    // This identity exists even when an Ethernet-first boot never starts the WiFi driver.
    // Reporting it directly from eFuse keeps /status transport-neutral too.
    (void)esp_read_mac(info.mac, ESP_MAC_WIFI_STA);
    return info;
}

uint32_t wifi_reconnect_count() { return s_reconnects; }

} // namespace daik
