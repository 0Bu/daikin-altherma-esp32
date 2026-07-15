#include "syslog.hpp"
#include "config.hpp"
#include "wifi.hpp"
#include "diag_log.hpp"
#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "ping/ping_sock.h"
#include "lwip/ip_addr.h"
#include "lwip/etharp.h"
#include "lwip/netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <cstring>
#include <cstdio>
#include <string_view>

namespace daik {

struct SyslogMsg {
    char text[256];
    uint16_t len;
};

static QueueHandle_t s_queue = nullptr;
static SemaphoreHandle_t s_status_mtx = nullptr;
static SyslogStatus s_status;

// File-scope so the control block + semaphore outlive any in-flight esp_ping session: the ping's
// internal thread is NOT joined by esp_ping_delete_session() and calls the callback unconditionally
// once started. A per-call stack frame would be a use-after-free if take() timed out first; file-scope
// storage removes the window (a stale give is drained at the next probe). Mirrors wifi.cpp's s_wd.
struct PingCtl { SemaphoreHandle_t done; uint32_t received; };
static PingCtl s_ping = { nullptr, 0 };

static void set_status(bool resolved, bool reachable, const std::string& error) {
    if (s_status_mtx && xSemaphoreTake(s_status_mtx, portMAX_DELAY) == pdTRUE) {
        s_status.resolved = resolved;
        s_status.reachable = reachable;
        s_status.error = error;
        xSemaphoreGive(s_status_mtx);
    }
}

SyslogStatus syslog_status() {
    SyslogStatus copy;
    const Config& c = config();
    copy.configured = !c.syslog_host.empty();
    copy.host = c.syslog_host;
    copy.port = c.syslog_port;
    copy.resolved = false;
    copy.reachable = false;
    if (s_status_mtx && xSemaphoreTake(s_status_mtx, portMAX_DELAY) == pdTRUE) {
        copy.resolved = s_status.resolved;
        copy.reachable = s_status.reachable;
        copy.error = s_status.error;
        xSemaphoreGive(s_status_mtx);
    }
    return copy;
}

static void syslog_on_ping_end(esp_ping_handle_t hdl, void* args) {
    auto* p = static_cast<PingCtl*>(args);
    uint32_t recv = 0;
    esp_ping_get_profile(hdl, ESP_PING_PROF_REPLY, &recv, sizeof(recv));
    p->received = recv;
    xSemaphoreGive(p->done);
}

// ADVISORY reachability probe — never a delivery gate (syslog is best-effort UDP, and a healthy
// collector routinely firewalls ICMP). ARP for a local-subnet host (L2, so it works even when the
// host drops ICMP), else an ICMP echo. Returns "could we confirm the host answers?" for the /status
// hint only; when it can't measure it returns false ("unverified"), and forwarding proceeds anyway.
static bool syslog_ping_host(const struct in_addr& ip) {
    struct netif* net = netif_default;
    if (net) {
        uint32_t mask = net->netmask.u_addr.ip4.addr;
        bool is_local = ((ip.s_addr & mask) == (net->ip_addr.u_addr.ip4.addr & mask));
        if (is_local) {
            // Provoke an ARP request with a 0-length datagram, then read the ARP cache back.
            int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
            if (sock >= 0) {
                struct sockaddr_in addr{};
                addr.sin_family = AF_INET;
                addr.sin_port = htons(514);
                addr.sin_addr = ip;
                char buf = 0;
                sendto(sock, &buf, 0, 0, (struct sockaddr*)&addr, sizeof(addr));
                close(sock);
            }
            vTaskDelay(pdMS_TO_TICKS(150)); // let the ARP reply land
            ip4_addr_t ipaddr; ipaddr.addr = ip.s_addr;
            struct eth_addr* eth_ret = nullptr;
            const ip4_addr_t* ip_ret = nullptr;
            if (etharp_find_addr(net, &ipaddr, &eth_ret, &ip_ret) >= 0) return true;
        }
    }

    // ICMP echo (remote host, or a local host not yet in the ARP cache).
    if (!s_ping.done) return false;   // probe not initialised → can't measure → advisory "unverified"
    ip_addr_t target{};
    target.type = IPADDR_TYPE_V4;
    target.u_addr.ip4.addr = ip.s_addr;

    esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
    cfg.target_addr = target;
    cfg.count       = 2;
    cfg.timeout_ms  = 800;
    cfg.interval_ms = 200;

    esp_ping_callbacks_t cbs = {};
    cbs.cb_args     = &s_ping;
    cbs.on_ping_end = syslog_on_ping_end;

    esp_ping_handle_t hdl = nullptr;
    if (esp_ping_new_session(&cfg, &cbs, &hdl) != ESP_OK || !hdl) return false;

    xSemaphoreTake(s_ping.done, 0);   // drain a stale give from a prior timed-out probe
    s_ping.received = 0;
    esp_ping_start(hdl);
    // A take() timeout here is harmless because s_ping is persistent (see above).
    xSemaphoreTake(s_ping.done, pdMS_TO_TICKS(2200));
    esp_ping_stop(hdl);
    vTaskDelay(pdMS_TO_TICKS(50));    // let the ping task context exit before deletion
    esp_ping_delete_session(hdl);
    return s_ping.received > 0;
}

void syslog_init() {
    s_status_mtx = xSemaphoreCreateMutex();
    s_ping.done  = xSemaphoreCreateBinary();
    s_queue = xQueueCreate(32, sizeof(SyslogMsg));
    if (!s_queue) return;

    xTaskCreate([](void*) {
        struct sockaddr_in dest_addr{};
        bool resolved = false;        // DNS resolved → dest_addr valid → forwarding lines
        bool reachable = false;       // advisory probe result (see syslog_ping_host)
        std::string last_host;
        int last_port = -1;
        bool logged_state = false;    // one-shot log of the current resolve outcome
        bool have_checked = false;    // false → re-resolve immediately (boot / config change / send error)
        TickType_t last_check = 0;
        const TickType_t check_interval = pdMS_TO_TICKS(10000); // re-resolve + re-probe cadence

        while (true) {
            const Config& c = config();
            bool configured = !c.syslog_host.empty();
            bool wifi_ok = wifi_info().connected;

            if (!configured) {
                if (resolved || reachable) { resolved = reachable = false; set_status(false, false, ""); }
                // Block until a line arrives, then drop it (nothing to forward) — no busy-spin.
                SyslogMsg msg;
                xQueueReceive(s_queue, &msg, portMAX_DELAY);
                continue;
            }

            if (!wifi_ok) {
                if (resolved) { resolved = false; reachable = false; set_status(false, false, "WiFi disconnected"); }
                vTaskDelay(pdMS_TO_TICKS(2000));
                continue;
            }

            // Config changed → re-resolve now.
            if (c.syslog_host != last_host || c.syslog_port != last_port) {
                resolved = false; reachable = false;
                last_host = c.syslog_host;
                last_port = c.syslog_port;
                logged_state = false;
                have_checked = false;
                set_status(false, false, "");
                diag_printf("syslog: target set to %s:%d\n", last_host.c_str(), last_port);
            }

            // Throttle the resolve+probe to check_interval. NOTE: gate on have_checked, NOT on
            // !resolved — a persistently failing DNS/host must not re-run getaddrinfo()+ping every
            // loop (that churned ~3 KB of ping-session heap every ~2.4 s, a fragmentation risk).
            TickType_t now = xTaskGetTickCount();
            if (!have_checked || (now - last_check >= check_interval)) {
                last_check = now;
                have_checked = true;

                struct addrinfo hints{}, *res = nullptr;
                hints.ai_family = AF_INET;
                hints.ai_socktype = SOCK_DGRAM;
                char port_str[16];
                std::snprintf(port_str, sizeof(port_str), "%d", c.syslog_port);
                int err = getaddrinfo(c.syslog_host.c_str(), port_str, &hints, &res);
                if (err == 0 && res != nullptr) {
                    std::memcpy(&dest_addr, res->ai_addr, sizeof(struct sockaddr_in));
                    freeaddrinfo(res);
                    resolved = true;                                   // DNS ok → forward regardless
                    reachable = syslog_ping_host(dest_addr.sin_addr);  // advisory only
                    set_status(true, reachable, "");
                    if (!logged_state) {
                        char ip_str[32];
                        inet_ntop(AF_INET, &dest_addr.sin_addr, ip_str, sizeof(ip_str));
                        diag_printf("syslog: forwarding to %s (%s), reachable=%s\n",
                                    c.syslog_host.c_str(), ip_str, reachable ? "yes" : "no-ping-reply");
                        logged_state = true;
                    }
                } else {
                    resolved = false; reachable = false;
                    set_status(false, false, "DNS lookup failed");
                    if (!logged_state) {
                        diag_printf("syslog: DNS lookup failed for %s (error %d)\n", c.syslog_host.c_str(), err);
                        logged_state = true;
                    }
                }
            }

            // Forward one queued line while a destination is resolved. Delivery is gated on DNS only
            // (resolved), never on the advisory reachability probe.
            SyslogMsg msg;
            if (xQueueReceive(s_queue, &msg, pdMS_TO_TICKS(500)) == pdTRUE) {
                if (resolved) {
                    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
                    if (sock >= 0) {
                        int len = msg.len;
                        while (len > 0 && (msg.text[len - 1] == '\n' || msg.text[len - 1] == '\r' || msg.text[len - 1] == ' ')) {
                            len--;
                        }
                        if (len > 0) {
                            char packet[320];
                            // RFC 5424: <PRI=14 user.info>1 SP TIMESTAMP HOSTNAME APP PROCID MSGID SD SP MSG.
                            // HOSTNAME must be the device's real network name (CONFIG_DAIKIN_HOSTNAME) so
                            // syslog entries correlate with the host as seen over DHCP/mDNS — never a shortened alias.
                            int pkt_len = std::snprintf(packet, sizeof(packet), "<14>1 - " CONFIG_DAIKIN_HOSTNAME " - - - - %.*s",
                                                   len, msg.text);
                            if (pkt_len > 0) {
                                int send_res = sendto(sock, packet, pkt_len, 0, (struct sockaddr*)&dest_addr, sizeof(dest_addr));
                                if (send_res < 0) {
                                    // Hard socket error (e.g. ENETUNREACH) → force a fresh resolve next loop.
                                    set_status(false, false, "Send failed");
                                    resolved = false;
                                    logged_state = false;
                                    have_checked = false;
                                    diag_printf("syslog: sendto failed (error %d)\n", errno);
                                }
                            }
                        }
                        close(sock);
                    } else {
                        set_status(false, false, "Socket creation failed");
                        resolved = false;
                        logged_state = false;
                        have_checked = false;
                        diag_printf("syslog: socket creation failed (error %d)\n", errno);
                    }
                }
            }
        }
        // 6144: this task runs getaddrinfo() + raw socket()/sendto() directly on its own stack (unlike
        // esp-mqtt, whose socket work lives in an internal task). 4096 is too thin for that call chain.
    }, "syslog_task", 6144, nullptr, 3, nullptr);
}

void syslog_send(const char* msg, size_t len) {
    if (!s_queue) return;

    // Loop guard: the syslog task's own diagnostics all contain the "syslog:" module tag, so drop
    // them before enqueue (they still appear in /diag). A substring match — not a prefix — because
    // diag_printf prepends an uptime stamp ("[  123.456] syslog: …").
    std::string_view sv(msg, len);
    if (sv.find("syslog:") != std::string_view::npos) {
        return;
    }

    SyslogMsg m;
    if (len >= sizeof(m.text)) {
        len = sizeof(m.text) - 1;
    }
    std::memcpy(m.text, msg, len);
    m.text[len] = '\0';
    m.len = len;
    xQueueSend(s_queue, &m, 0); // Non-blocking send
}

} // namespace daik
