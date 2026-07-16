#include "syslog.hpp"
#include "config.hpp"
#include "wifi.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "safe_mode.hpp"
#include "logic/bootlog.hpp"
#include "logic/syslog_policy.hpp"
#include "esp_app_desc.h"
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
#include <new>
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

// Frame one line as RFC 5424 and push it as a single UDP datagram. The one send path — used by the
// queue drain AND by the one-shot boot replay, so both get identical framing/error handling.
enum class SendResult { Ok, Empty, SocketFailed, SendFailed };

// `out_err` (optional) receives the errno CAPTURED AT THE FAILING CALL, before close(). The caller
// cannot read errno itself once this returns: close() is free to set errno, so a call site reading
// it afterwards may classify the close instead of the send — and this errno now decides whether the
// resolve throttle is cleared (logic/syslog_policy.hpp), so a wrong value costs a probe storm.
static SendResult syslog_sendto(const struct sockaddr_in& dest, const char* text, size_t len,
                                int* out_err = nullptr) {
    if (out_err) *out_err = 0;
    while (len > 0 && (text[len - 1] == '\n' || text[len - 1] == '\r' || text[len - 1] == ' ')) {
        len--;
    }
    if (len == 0) return SendResult::Empty;

    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) {
        if (out_err) *out_err = errno;
        return SendResult::SocketFailed;
    }

    char packet[320];
    // RFC 5424: <PRI=14 user.info>1 SP TIMESTAMP HOSTNAME APP PROCID MSGID SD SP MSG.
    // HOSTNAME must be the device's real network name (CONFIG_DAIKIN_HOSTNAME) so syslog entries
    // correlate with the host as seen over DHCP/mDNS — never a shortened alias.
    int pkt_len = std::snprintf(packet, sizeof(packet), "<14>1 - " CONFIG_DAIKIN_HOSTNAME " - - - - %.*s",
                                static_cast<int>(len), text);
    SendResult r = SendResult::Ok;
    if (pkt_len > 0) {
        // snprintf returns the length it WOULD have written; clamp to what fits or sendto reads OOB.
        if (pkt_len > static_cast<int>(sizeof(packet)) - 1) pkt_len = static_cast<int>(sizeof(packet)) - 1;
        if (sendto(sock, packet, pkt_len, 0, (struct sockaddr*)&dest, sizeof(dest)) < 0) {
            if (out_err) *out_err = errno;
            r = SendResult::SendFailed;
        }
    }
    close(sock);
    return r;
}

// One place for "a send just failed", so the sendto and socket-creation paths can't drift apart.
//
// Two things this must NOT do, both learned from a board that wedged itself:
//   * Clear the resolve throttle on a TRANSIENT error (logic/syslog_policy.hpp). Only a hard routing
//     error justifies an immediate getaddrinfo() + 3×1 s ICMP probe; on ENOMEM — the ghost-
//     association case, where every datagram fails — doing that per failed line turns a chatty diag
//     stream into a probe storm that runs hardest exactly when the link is worst. Holding the
//     throttle costs nothing: the ordinary 10 s cadence still re-checks.
//   * Log per failure. At an X10A timeout every ~0.3 s that is several lines a second, which is how
//     the /diag ring ends up 100 % syslog-failure spam with the actual fault long overwritten. Log
//     the transition instead — one line when forwarding breaks, one when it recovers.
static void handle_send_failure(int err, const char* what, bool& resolved, bool& logged_state,
                                bool& have_checked, bool& send_failing) {
    const bool hard = syslog_error_is_hard(err);
    set_status(false, false, hard ? "Send failed" : "Send failed (transient)");
    if (hard) {
        resolved     = false;   // re-resolve + re-probe now: the route/destination is implicated
        logged_state = false;
        have_checked = false;
    }
    if (!send_failing) {
        send_failing = true;
        diag_printf("syslog: %s failed (error %d, %s) — forwarding paused\n",
                    what, err, hard ? "hard: re-resolving" : "transient: holding destination");
    }
}

// Replay the boot records ONCE, as soon as a collector is resolved. diag_crash_capture() runs at the
// top of app_main — before WiFi, before this task exists — so its crash line could only ever reach
// the in-RAM diag ring, which a chatty failure mode (an X10A timeout every ~0.3 s) overwrites within
// a minute. Result: the single most useful line for forensics was readable nowhere. The boot line
// goes out on every boot (build identity: without it a log stream cannot be tied to a binary); the
// crash records only when there is a real crash to report (build_crash_log_lines returns 0 otherwise).
//
// Sent straight down syslog_sendto(), NOT via diag_printf(): by now the queue is typically full of
// the boot backlog (nothing drains it until WiFi + DNS are up), and syslog_send()'s enqueue is
// non-blocking — it would silently drop exactly the lines this exists to save. Returns false if a
// send failed, leaving the one-shot unlatched so the next resolve retries.
//
// Consequence of bypassing diag_printf: these lines carry no "[uptime]" prefix, unlike every other
// forwarded line. That is deliberate — they describe the PREVIOUS boot, so stamping them with this
// boot's uptime (a few seconds) would date the crash wrong. The collector's own receive timestamp
// remains the only honest clock here (the device has no RTC).
static bool syslog_replay_boot(const struct sockaddr_in& dest) {
    // Best-effort diagnostics must never take the device down. The record builders allocate (~800 B
    // total, worst case), and an uncaught std::bad_alloc here would unwind through the FreeRTOS/C
    // task frames → std::terminate → reboot; because the replay re-runs on EVERY boot that would be
    // a boot LOOP, not a one-off crash. Latch the one-shot on OOM rather than retrying forever: a
    // device that can't spare 800 bytes has a worse problem than a missing log line.
    try {
        char elf_sha[65] = {0};
        esp_app_get_elf_sha256(elf_sha, sizeof(elf_sha));

        BootIdent id;
        id.version   = esp_app_get_description()->version;
        id.elf_sha   = elf_sha;
        id.reason    = diag_crash_info().reason;
        id.safe_mode = safe_mode_active();

        const std::string boot = build_boot_line(id);
        if (syslog_sendto(dest, boot.data(), boot.size()) != SendResult::Ok) return false;

        // Short-lived and small (<= 3 lines, each capped at ~200 bytes by construction — see
        // logic/bootlog.hpp): no risk to the contiguous-block budget this firmware runs against.
        std::string lines[CRASH_LOG_LINE_MAX];
        const int n = build_crash_log_lines(diag_crash_info(), lines, CRASH_LOG_LINE_MAX);
        for (int i = 0; i < n; i++) {
            if (syslog_sendto(dest, lines[i].data(), lines[i].size()) != SendResult::Ok) return false;
        }
        diag_printf("syslog: replayed boot record + %d crash line(s)\n", n);
        return true;
    } catch (const std::bad_alloc&) {
        diag_printf("syslog: boot replay skipped (out of memory)\n");
        return true;
    }
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
        bool have_checked = false;    // false → re-resolve immediately (boot / config change / HARD send error)
        bool send_failing = false;    // latch: forwarding is broken → log the transition, not every line
        bool replayed = false;        // one-shot: the boot/crash records have gone out (see
                                      // syslog_replay_boot) — never re-sent on a re-resolve/reconnect
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
                    // First reachable collector of this boot → replay what happened before it existed.
                    // Ahead of the queue drain, so the crash leads the backlog rather than trailing it.
                    if (!replayed) replayed = syslog_replay_boot(dest_addr);
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
                    int err = 0;
                    switch (syslog_sendto(dest_addr, msg.text, msg.len, &err)) {
                        case SendResult::Ok:
                            if (send_failing) {   // first line through after an outage
                                diag_printf("syslog: forwarding recovered\n");
                                send_failing = false;
                            }
                            break;
                        case SendResult::Empty:   // nothing to send — neither success nor failure
                            break;
                        // Whether this clears the resolve throttle now depends on WHICH error it was
                        // (logic/syslog_policy.hpp), not merely that one occurred.
                        case SendResult::SendFailed:
                            handle_send_failure(err, "sendto", resolved, logged_state,
                                                have_checked, send_failing);
                            break;
                        case SendResult::SocketFailed:
                            handle_send_failure(err, "socket creation", resolved, logged_state,
                                                have_checked, send_failing);
                            break;
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
