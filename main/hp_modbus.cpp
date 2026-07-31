// THE HOMEHUB MODBUS STACK: transport + poll task + cache, a second INDEPENDENT source beside the
// X10A one (hp_modbus.hpp, docs/MODBUS_PROTOCOL.md). Read-only by construction — mb_read only, no
// write function anywhere in this file.
//
// Everything here is owned by ONE task (mb_task, below) exactly as hp_poll owns the X10A UART, and
// other tasks see only the mutex-guarded snapshots. The socket is opened once and reused; any read
// failure closes it so the next cycle reconnects — the self-healing shape hp_comm.cpp uses for the
// UART, applied to a socket.
//
// The task exists only while a gateway ADDRESS is known: no address means no task, no socket, no mDNS
// traffic and no stack. That is what makes this second source free for the devices that do not have
// one, and it is why the X10A poll task could give its 4 KB back (hp_poll.cpp).
#include "hp_modbus.hpp"
#include "config.hpp"
#include "def/homehub.hpp"
#include "diag_log.hpp"
#include "logic/detect_backoff.hpp"   // the SAME backoff the X10A sweep uses on a silent bus
#include "logic/homehub_map.hpp"      // the concept a register pairs on
#include "logic/modbus_snapshot.hpp"  // a cache is live only for the TCP session that committed it

#include "esp_netif.h"
#include "esp_netif_ip_addr.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "mdns.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include <sys/socket.h>
#include <netdb.h>
#include <fcntl.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

namespace daik {

// Whole-reply budget for one register read. Each recv CALL is bounded by SO_RCVTIMEO below; this
// bounds the reassembly of the entire ADU, which is the part the Task Watchdog cares about (the poll
// task resets once per register, so one read must stay well inside the 20 s TWDT budget).
static constexpr int MB_READ_TIMEOUT_MS = 1500;

// ── Link state (read by /status + heartbeat) ──────────────────────────────────────────────────────
static SemaphoreHandle_t s_mtx = nullptr;   // guards s_status; created in mb_init()
static ModbusStatus      s_status;          // guarded by s_mtx
static uint32_t          s_link_generation = 0; // guarded by s_mtx; zero = no connected session yet

// ── Poll-task-owned socket state (no lock — single owner, exactly like hp_comm.cpp's s_rx/s_tx) ─────
static int         s_sock     = -1;   // open socket, or -1
static uint16_t    s_txn      = 0;    // Modbus transaction id (echoed by the reply; wraps freely)
static std::string s_req_host;        // the REQUESTED host this socket is for ("" = auto-discovery)
static int         s_req_port = 0;
static int         s_unit     = 0;    // Modbus unit id addressed on this socket
static bool        s_have_req = false;// whether s_req_* describe the current socket

// ── The value cache — this stack's own, deliberately NOT hp_poll's ──────────────────────────────
// Two independent sources need two caches: sharing one would mean a dead X10A bus wipes the HomeHub
// readings on its next commit, which is precisely the coupling this design exists to avoid.
static SemaphoreHandle_t s_cache_mtx = nullptr;
static std::vector<CachedValue> s_cache;
static uint32_t s_cache_generation = 0;      // guarded by s_cache_mtx; session that committed s_cache

// Task handle + the connect backoff. A failed connect with no host configured is a ~3 s blocking
// mDNS browse, so retrying every cycle would leave this task permanently blocked and the LAN
// permanently browsed. Reuses the X10A sweep's host-tested policy rather than inventing a second one.
static TaskHandle_t  s_task = nullptr;
static DetectBackoff s_backoff;
static int64_t       s_next_try_us = 0;

enum class MbFailureType {
    None,
    RequestBuild,
    SendTimeout,
    SendFailed,
    ResponseTimeout,
    ConnectionClosed,
    ReceiveFailed,
    InvalidResponse,
    Exception,
};

// One failed register read. Fixed-size facts only: the poll loop can preserve the FIRST real cause
// without allocating or letting every later "socket already closed" attempt overwrite it.
struct MbFailure {
    MbFailureType type   = MbFailureType::None;
    int           detail = -1;    // errno, Modbus exception code, or MbParse ordinal
    uint16_t      reg    = 0;     // 1-based HomeHub data-model offset
};

// RAII guard around s_mtx (same idiom as hp_poll.cpp/config.cpp): releases on unwind so a
// std::bad_alloc thrown while copying strings out never strands the mutex.
namespace {
struct Lock {
    explicit Lock(SemaphoreHandle_t m) : m_(m) { if (m_) xSemaphoreTake(m_, portMAX_DELAY); }
    ~Lock() { if (m_) xSemaphoreGive(m_); }
    SemaphoreHandle_t m_;
};
}  // namespace


ModbusStatus mb_status() {
    if (!s_mtx) return ModbusStatus{};
    Lock lk(s_mtx);
    return s_status;
}

// ── Status writers. Strings are built BY THE CALLER and swapped in (noexcept) so nothing allocates
// under the lock — the rule hp_poll.cpp's commit follows for exactly the same reason. ──────────────
static void status_target(std::string host, int port, int unit, bool discovering) {
    Lock lk(s_mtx);
    s_status.host.swap(host);
    s_status.port        = port;
    s_status.unit_id     = unit;
    s_status.discovering = discovering;
    s_status.connected   = false;
}
static void status_error(std::string code, std::string msg, int detail = -1, int reg = 0,
                         bool link_down = true) {
    // `msg` is swapped under the mutex, so preserve the line to be logged in a fixed buffer first.
    // Logging while holding s_mtx would invert the status/diag mutex order and invite a deadlock.
    char log_line[192];
    std::snprintf(log_line, sizeof(log_line), "%s", msg.c_str());
    bool changed = false;
    {
        Lock lk(s_mtx);
        changed = s_status.last_error_code != code || s_status.last_error != msg ||
                  s_status.last_error_detail != detail || s_status.last_error_register != reg;
        if (link_down) s_status.connected = false;
        s_status.discovering        = false;
        s_status.last_error_detail  = detail;
        s_status.last_error_register = reg;
        s_status.last_error_code.swap(code);
        s_status.last_error.swap(msg);
    }
    // One line per transition, not one per one-second retry. A clean poll clears the current error,
    // so the same fault is logged again if it genuinely returns after recovery.
    if (changed) diag_printf("modbus: %s\n", log_line);
}

static void status_recovered() {
    bool recovered = false;
    {
        Lock lk(s_mtx);
        recovered = !s_status.last_error_code.empty() || !s_status.last_error.empty();
        s_status.last_error_code.clear();
        s_status.last_error.clear();
        s_status.last_error_detail   = -1;
        s_status.last_error_register = 0;
    }
    if (recovered) diag_printf("modbus: communication recovered\n");
}
// A successful TCP connect starts a new SESSION, but does not make the old cache live. The link only
// becomes `connected` after this session has committed its first poll below. Reserving generation
// zero makes a pre-first-poll cache impossible to mistake for current even on the first connection.
static void status_socket_open(std::string host, int port, int unit) {
    Lock lk(s_mtx);
    s_status.host.swap(host);
    s_status.port        = port;
    s_status.unit_id     = unit;
    s_status.connected   = false;
    s_status.discovering = false;
    if (++s_link_generation == 0) ++s_link_generation;  // zero stays the "no session" sentinel
}

// ── Address resolution ──────────────────────────────────────────────────────────────────────────
// A ".local" name is resolved over mDNS (mdns_query_a wants the bare label, no ".local"); anything
// else — a dotted IP or an ordinary DNS hostname — goes through getaddrinfo. IPv4 only (the HomeHub
// is a LAN device and this whole path is trusted-LAN).
static bool resolve_host(const std::string& host, int port, sockaddr_in& out) {
    memset(&out, 0, sizeof(out));
    out.sin_family = AF_INET;
    out.sin_port   = htons(static_cast<uint16_t>(port));
    static const char dot_local[] = ".local";
    const size_t ll = sizeof(dot_local) - 1;
    if (host.size() > ll && host.compare(host.size() - ll, ll, dot_local) == 0) {
        const std::string name = host.substr(0, host.size() - ll);
        esp_ip4_addr_t a{};
        if (mdns_query_a(name.c_str(), 2000, &a) != ESP_OK) return false;
        out.sin_addr.s_addr = a.addr;
        return true;
    }
    addrinfo hints{};
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;
    char portbuf[8];
    std::snprintf(portbuf, sizeof(portbuf), "%d", port);
    if (getaddrinfo(host.c_str(), portbuf, &hints, &res) != 0 || res == nullptr) return false;
    memcpy(&out, res->ai_addr, sizeof(sockaddr_in));
    out.sin_port = htons(static_cast<uint16_t>(port));   // keep the requested port explicitly
    freeaddrinfo(res);
    return true;
}

// mDNS-discover a HomeHub: browse _http._tcp (the service EKRHH advertises, guide §2.5), keep the
// first responder whose hostname is "homehub-*" (logic/modbus.hpp is_homehub_hostname — this browse
// also hears OUR OWN _http advert and unrelated HTTP devices, so the filter is mandatory), and take
// its first IPv4. `found` returns that numeric address for persistence and /status — discovery uses
// the mDNS name to IDENTIFY the HomeHub, but the editable Host field must show the resolved IP.
static bool discover_homehub(std::string& found) {
    mdns_result_t* results = nullptr;
    if (mdns_query_ptr("_http", "_tcp", 3000, 20, &results) != ESP_OK) return false;
    bool ok = false;
    int  matches = 0;
    for (mdns_result_t* r = results; r != nullptr; r = r->next) {
        const char* name = r->hostname ? r->hostname : r->instance_name;
        if (name == nullptr || !is_homehub_hostname(name)) continue;
        matches++;
        if (ok) continue;   // keep counting (to warn on multiples) but commit to the first match
        // Take the A RECORD, not the serial-derived hostname. The request that started discovery had
        // an empty Host field; once discovery succeeds that field must contain the concrete IP the
        // user can see, copy and diagnose. A result without an embedded A record gets one explicit
        // query before it is rejected.
        for (mdns_ip_addr_t* a = r->addr; a != nullptr; a = a->next) {
            if (a->addr.type == ESP_IPADDR_TYPE_V4 && a->addr.u_addr.ip4.addr != 0) {
                found = mb_ipv4_string(IP2STR(&a->addr.u_addr.ip4));
                ok    = !found.empty();
                break;
            }
        }
        if (!ok) {
            esp_ip4_addr_t a4{};
            if (mdns_query_a(name, 2000, &a4) == ESP_OK && a4.addr != 0) {
                found = mb_ipv4_string(IP2STR(&a4));
                ok = !found.empty();
            }
        }
    }
    mdns_query_results_free(results);
    // Several hubs on one LAN is unusual; the user chose auto-discovery, so use the first one that
    // RESOLVED and say so, rather than silently picking among them. Gated on `ok` — with nothing
    // resolved there is no address to print, and "using " followed by nothing reads like a bug.
    if (ok && matches > 1) diag_printf("modbus: %d HomeHubs discovered via mDNS — using %s\n",
                                       matches, found.c_str());
    return ok;
}

// Non-blocking connect with a select() timeout (the tcp_port_probe idiom from http_config.cpp), then
// return to blocking with a per-read SO_RCVTIMEO for mb_read's recv loop. Returns the socket or -1;
// `out_err` preserves the error from the call that ACTUALLY failed (close() may change errno).
static int connect_socket(const sockaddr_in& addr, int timeout_ms, int& out_err) {
    out_err = 0;
    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock < 0) { out_err = errno; return -1; }
    const int flags = fcntl(sock, F_GETFL, 0);
    if (flags < 0 || fcntl(sock, F_SETFL, flags | O_NONBLOCK) < 0) {
        out_err = errno;
        close(sock);
        return -1;
    }
    int r = connect(sock, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr));
    if (r < 0 && errno == EINPROGRESS) {
        fd_set w;
        FD_ZERO(&w);
        FD_SET(sock, &w);
        timeval tv{ timeout_ms / 1000, (timeout_ms % 1000) * 1000 };
        r = select(sock + 1, nullptr, &w, nullptr, &tv);
        if (r > 0) {
            int so_err = 0;
            socklen_t l = sizeof(so_err);
            if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &so_err, &l) != 0) {
                out_err = errno;
                r = -1;
            } else if (so_err != 0) {
                out_err = so_err;
                r = -1;
            } else {
                r = 0;
            }
        } else if (r == 0) {
            out_err = ETIMEDOUT;
            r = -1;
        } else {
            out_err = errno;
            r = -1;
        }
    } else if (r < 0) {
        out_err = errno;
        r = -1;
    }
    if (r != 0) { close(sock); return -1; }
    if (fcntl(sock, F_SETFL, flags) < 0) {             // back to blocking
        out_err = errno;
        close(sock);
        return -1;
    }
    // Per-CALL recv timeout. recv_adu additionally bounds the WHOLE reply with MB_READ_TIMEOUT_MS —
    // this alone would not, since a peer trickling a byte per call keeps every call successful.
    timeval rt{ MB_READ_TIMEOUT_MS / 1000, (MB_READ_TIMEOUT_MS % 1000) * 1000 };
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &rt, sizeof(rt));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &rt, sizeof(rt));
    return sock;
}

static const char* connect_error_code(int err) {
    if (err == ETIMEDOUT)    return "connect_timeout";
    if (err == ECONNREFUSED) return "connection_refused";
    if (err == ENETUNREACH)  return "network_unreachable";
    if (err == EHOSTUNREACH) return "host_unreachable";
    return "connect_failed";
}

static std::string connect_error_message(int err) {
    switch (err) {
        case ETIMEDOUT:    return "connection timed out";
        case ECONNREFUSED: return "connection refused (Modbus TCP port closed)";
        case ENETUNREACH:  return "network unreachable";
        case EHOSTUNREACH: return "HomeHub unreachable";
        default: {
            char msg[128];
            std::snprintf(msg, sizeof(msg), "connection failed (errno %d: %s)", err,
                          std::strerror(err));
            return msg;
        }
    }
}

static void close_sock() {
    if (s_sock >= 0) { close(s_sock); s_sock = -1; }
    s_have_req = false;
}

static void mb_disconnect() {
    close_sock();
    status_target(std::string(), 0, 0, false);
}

// The ONE-SHOT search. Called at most once per boot, from the task below, and ONLY when nothing is
// known — then the caller persists the outcome, INCLUDING the empty one, which is what stops the
// next boot searching again. Deliberately NOT reachable from mb_ensure_connected: a connect path
// that can browse browses on every failed cycle, i.e. a permanent multicast sweep on a LAN that has
// no gateway, which is precisely the case the search has already answered.
static bool mb_discover_once(std::string& found) {
    status_target(std::string(), 0, 0, /*discovering=*/true);
    const bool ok = discover_homehub(found);
    esp_task_wdt_reset();                      // the browse blocks for up to ~3 s
    if (!ok) status_error(std::string("mdns_not_found"),
                          std::string("no HomeHub found via mDNS — not searching again"));
    return ok;
}

static bool mb_ensure_connected(const std::string& host, int port, int unit_id,
                                bool migrate_discovered_name) {
    // No address, nothing to dial. There is no browse here — see mb_discover_once.
    if (host.empty()) {
        status_error(std::string("no_address"), std::string("no HomeHub address configured"));
        return false;
    }
    // Reuse a healthy socket for the same target — a read failure will have close_sock()'d it, so
    // s_sock >= 0 here means the last cycle's link is still good.
    if (s_sock >= 0 && s_have_req && host == s_req_host && port == s_req_port && unit_id == s_unit)
        return true;
    close_sock();
    // Announce the target before the blocking resolve, so /status shows what the device is
    // attempting rather than going silent for seconds.
    status_target(host, port, unit_id, /*discovering=*/false);

    sockaddr_in addr{};
    std::string resolved = host;
    esp_task_wdt_reset();   // DNS/mDNS resolution can take a couple of seconds
    if (!resolve_host(host, port, addr)) {
        status_error(std::string("resolve_failed"),
                     std::string("HomeHub address could not be resolved"));
        return false;
    }
    if (migrate_discovered_name) {
        // Pre-change firmware persisted homehub-<serial>.local in mb_dhost. Resolve it once, then
        // replace ONLY that task-owned discovery value with the same numeric contract new searches
        // use. A manual mb_host never sets migrate_discovered_name and is left byte-for-byte intact.
        esp_ip4_addr_t ip{};
        ip.addr = addr.sin_addr.s_addr;
        std::string ipv4 = mb_ipv4_string(IP2STR(&ip));
        if (!ipv4.empty()) {
            resolved.swap(ipv4);
            config_save_modbus_found(resolved);
            diag_printf("modbus: migrated discovered gateway hostname to IPv4\n");
        }
    }
    int connect_err = 0;
    const int sock = connect_socket(addr, 2000, connect_err);
    esp_task_wdt_reset();
    if (sock < 0) {
        status_error(std::string(connect_error_code(connect_err)),
                     connect_error_message(connect_err), connect_err);
        return false;
    }
    s_sock     = sock;
    s_req_host = resolved;
    s_req_port = port;
    s_unit     = unit_id;
    s_have_req = true;
    status_socket_open(std::move(resolved), port, unit_id);
    return true;
}

// Read exactly `n` bytes, giving up at the absolute monotonic deadline `deadline_us`.
//
// SO_RCVTIMEO bounds each recv CALL, which is not the same as bounding the read: a peer that trickles
// one byte per timeout keeps every call "successful" and the loop runs as long as it likes. This task
// is Task-Watchdog-subscribed with a 20 s budget and resets once per register, so an unbounded read
// here is a reboot waiting for a slow or hostile peer. The deadline bounds the whole reassembly.
static bool recv_all(int sock, uint8_t* buf, int n, int64_t deadline_us, MbFailure& failure) {
    int got = 0;
    while (got < n) {
        if (esp_timer_get_time() >= deadline_us) {
            failure.type = MbFailureType::ResponseTimeout;
            failure.detail = ETIMEDOUT;
            return false;
        }
        const int r = recv(sock, buf + got, n - got, 0);
        if (r == 0) {
            failure.type = MbFailureType::ConnectionClosed;
            failure.detail = 0;
            return false;
        }
        if (r < 0) {
            const int err = errno;   // capture before close() or another libc call can overwrite it
            failure.detail = err;
            if (err == EAGAIN || err == EWOULDBLOCK || err == ETIMEDOUT)
                failure.type = MbFailureType::ResponseTimeout;
            else if (err == ECONNRESET || err == ENOTCONN || err == EPIPE)
                failure.type = MbFailureType::ConnectionClosed;
            else
                failure.type = MbFailureType::ReceiveFailed;
            return false;
        }
        got += r;
    }
    return true;
}

// Read one Modbus TCP ADU: the 6-byte MBAP prefix (txn, proto, length), then `length` more bytes
// (unit + PDU). Returns the total ADU length, or -1 on timeout / short read / an implausible length.
// The whole reply must land within MB_READ_TIMEOUT_MS of the request — see recv_all.
static int recv_adu(int sock, uint8_t* buf, int buflen, MbFailure& failure) {
    if (buflen < MBAP_LEN) { failure.type = MbFailureType::InvalidResponse; return -1; }
    const int64_t deadline = esp_timer_get_time() + MB_READ_TIMEOUT_MS * 1000;
    if (!recv_all(sock, buf, 6, deadline, failure)) return -1;
    const int len = (buf[4] << 8) | buf[5];            // bytes after the length field (unit + PDU)
    if (len < 2 || 6 + len > buflen) {                 // >=2: at least unit + a 1-byte PDU
        failure.type = MbFailureType::InvalidResponse;
        return -1;
    }
    if (!recv_all(sock, buf + 6, len, deadline, failure)) return -1;
    return 6 + len;
}

static bool mb_read(MbFunc space, uint16_t addr, uint16_t qty, MbResponse& out,
                    MbFailure& failure) {
    failure = MbFailure{};
    if (s_sock < 0) {
        failure.type = MbFailureType::ConnectionClosed;
        failure.detail = ENOTCONN;
        return false;
    }
    uint8_t req[16];
    const uint16_t txn  = ++s_txn;
    const uint8_t  unit = static_cast<uint8_t>(s_unit);
    const int n = mb_build_read(req, sizeof(req), txn, unit, space, addr, qty);
    if (n < 0) {
        failure.type = MbFailureType::RequestBuild;
        { Lock lk(s_mtx); s_status.rx_fail++; }
        return false;
    }
    const int sent = send(s_sock, req, n, 0);
    if (sent != n) {
        const int err = sent < 0 ? errno : EIO;
        failure.detail = err;
        if (err == EAGAIN || err == EWOULDBLOCK || err == ETIMEDOUT)
            failure.type = MbFailureType::SendTimeout;
        else if (err == ECONNRESET || err == ENOTCONN || err == EPIPE)
            failure.type = MbFailureType::ConnectionClosed;
        else
            failure.type = MbFailureType::SendFailed;
        close_sock();
        { Lock lk(s_mtx); s_status.rx_fail++; s_status.connected = false; }
        return false;
    }
    uint8_t adu[260];                                  // max Modbus TCP ADU = 7 + 253
    const int got = recv_adu(s_sock, adu, sizeof(adu), failure);
    if (got < 0) {
        close_sock();
        { Lock lk(s_mtx); s_status.rx_fail++; s_status.connected = false; }
        return false;
    }
    const MbParse p = mb_parse_response(adu, got, txn, unit, space, addr, qty, out);
    if (p == MbParse::Ok) {
        Lock lk(s_mtx);
        s_status.rx_ok++;
        return true;
    }
    // An Exception is a VALID reply (the register is simply unreadable now) — count it but keep the
    // socket. Any framing / txn / desync error means the stream is out of step: drop the socket so
    // the next cycle reconnects rather than mis-parsing every following reply.
    {
        Lock lk(s_mtx);
        s_status.rx_fail++;
    }
    if (p == MbParse::Exception) {
        failure.type = MbFailureType::Exception;
        failure.detail = out.exc_code;
    } else {
        failure.type = MbFailureType::InvalidResponse;
        failure.detail = static_cast<int>(p);
        close_sock();
        Lock lk(s_mtx);
        s_status.connected = false;
    }
    return false;
}

static const char* failure_code(MbFailureType type) {
    switch (type) {
        case MbFailureType::RequestBuild:     return "request_failed";
        case MbFailureType::SendTimeout:      return "send_timeout";
        case MbFailureType::SendFailed:       return "send_failed";
        case MbFailureType::ResponseTimeout:  return "response_timeout";
        case MbFailureType::ConnectionClosed: return "connection_closed";
        case MbFailureType::ReceiveFailed:    return "receive_failed";
        case MbFailureType::InvalidResponse:  return "invalid_response";
        case MbFailureType::Exception:        return "modbus_exception";
        case MbFailureType::None:             return "";
    }
    return "read_failed";
}

static std::string failure_message(const MbFailure& f) {
    char msg[176];
    switch (f.type) {
        case MbFailureType::RequestBuild:
            std::snprintf(msg, sizeof(msg), "could not build Modbus request for register %u",
                          static_cast<unsigned>(f.reg));
            break;
        case MbFailureType::SendTimeout:
            std::snprintf(msg, sizeof(msg), "Modbus request send timed out at register %u",
                          static_cast<unsigned>(f.reg));
            break;
        case MbFailureType::SendFailed:
            std::snprintf(msg, sizeof(msg), "Modbus request send failed at register %u (errno %d: %s)",
                          static_cast<unsigned>(f.reg), f.detail, std::strerror(f.detail));
            break;
        case MbFailureType::ResponseTimeout:
            std::snprintf(msg, sizeof(msg), "HomeHub response timed out at register %u",
                          static_cast<unsigned>(f.reg));
            break;
        case MbFailureType::ConnectionClosed:
            std::snprintf(msg, sizeof(msg), "HomeHub closed the connection at register %u",
                          static_cast<unsigned>(f.reg));
            break;
        case MbFailureType::ReceiveFailed:
            std::snprintf(msg, sizeof(msg), "HomeHub receive failed at register %u (errno %d: %s)",
                          static_cast<unsigned>(f.reg), f.detail, std::strerror(f.detail));
            break;
        case MbFailureType::InvalidResponse: {
            const char* reason = f.detail >= static_cast<int>(MbParse::TooShort) &&
                                 f.detail <= static_cast<int>(MbParse::EchoMismatch)
                               ? mb_parse_reason(static_cast<MbParse>(f.detail))
                               : "invalid MBAP length";
            std::snprintf(msg, sizeof(msg), "invalid Modbus response at register %u (%s)",
                          static_cast<unsigned>(f.reg), reason);
            break;
        }
        case MbFailureType::Exception:
            std::snprintf(msg, sizeof(msg), "HomeHub rejected register %u (Modbus exception %d: %s)",
                          static_cast<unsigned>(f.reg), f.detail,
                          mb_exception_reason(static_cast<uint8_t>(f.detail)));
            break;
        case MbFailureType::None:
            msg[0] = '\0';
            break;
    }
    return msg;
}

// ── One poll cycle ───────────────────────────────────────────────────────────────────────────────
// Reads the whole HomeHub map into this stack's own cache. Structurally the twin of hp_poll's
// poll_once(): sized reserve up front, everything staged in locals, one non-allocating commit.
static void mb_poll_once() {
    const Config& c = config();
    if (!mb_ensure_connected(config_modbus_host(c), c.mb_port, c.mb_unit_id,
                             config_modbus_discovery_needs_ipv4(c))) {
        // THE CACHE GOES WITH THE LINK. Keeping it was a real defect: /values kept serving the last
        // good readings, the browser had no way to tell they were minutes old, and it went on
        // printing them as the live second opinion — complete with a computed "difference" against a
        // live X10A value, which is a number about two instants presented as a number about two
        // instruments. Everything else in this firmware refuses exactly that (a held-over outdoor
        // reading blanks rather than being shown dimmer), and this link has no equivalent of the
        // trend rings that make hp_poll keep its own cache. Dropped, so "a modbus row exists" means
        // "it was read this cycle" everywhere at once.
        {
            Lock lk(s_cache_mtx);
            s_cache.clear();
            s_cache_generation = 0;
        }
        { Lock lk(s_mtx); s_status.values = 0; }
        // Back off before retrying — see s_backoff. Applied by SKIPPING cycles, never by lengthening
        // the delay, so the top-of-loop watchdog reset keeps its cadence.
        s_next_try_us = esp_timer_get_time() +
                        static_cast<int64_t>(detect_backoff_step(s_backoff, false)) * 1000000;
        return;                                    // mb_ensure_connected already set the status
    }
    detect_backoff_step(s_backoff, true);          // connected — back to full cadence

    // Owned by this poll task. A reconnect cannot happen again until this cycle returns, while the
    // mutex makes the generation visible to concurrent /values snapshots without a data race.
    uint32_t cycle_generation = 0;
    {
        Lock lk(s_mtx);
        cycle_generation = s_link_generation;
    }

    std::vector<CachedValue> fresh;
    fresh.reserve(def::HOMEHUB_REG_COUNT);
    MbFailure first_failure;

    for (int i = 0; i < def::HOMEHUB_REG_COUNT; i++) {
        esp_task_wdt_reset();                      // each read is a bounded LAN round-trip
        const def::HomeHubReg& r = def::HOMEHUB_REGS[i];
        uint16_t pdu = 0;
        if (!mb_pdu_address(r.offset, pdu)) continue;
        MbResponse resp;
        MbFailure failure;
        if (!mb_read(r.space, pdu, 1, resp, failure)) {
            failure.reg = r.offset;
            // Preserve the first exception while the link itself remains healthy. If a later
            // transport/protocol failure actually drops the link, that becomes the displayed cause:
            // otherwise a harmless unsupported register would hide the timeout that turned the row
            // red.
            if (first_failure.type == MbFailureType::None ||
                (first_failure.type == MbFailureType::Exception &&
                 failure.type != MbFailureType::Exception)) {
                first_failure = failure;
            }
            // A valid Modbus exception applies to this register only, so continue and publish every
            // row that did answer. Every other failure closed (or invalidated) the stream: trying the
            // remaining registers would only overwrite the original cause with "not connected".
            if (failure.type != MbFailureType::Exception) break;
            continue;
        }
        uint16_t raw = 0;
        if (!mb_reg_at(resp, 0, raw)) {
            first_failure = MbFailure{MbFailureType::InvalidResponse,
                                      static_cast<int>(MbParse::Malformed), r.offset};
            close_sock();
            { Lock lk(s_mtx); s_status.connected = false; }
            break;
        }
        CachedValue cv;
        cv.label = r.label;
        cv.unit  = r.unit;
        // The synthetic page, never the EKRHH offset: those collide with real X10A page numbers
        // (offset 16 == page 0x10). `off` carries the true offset, which is what
        // logic/homehub_map.hpp pairs on and what /values emits as the concept.
        cv.reg  = def::HOMEHUB_GROUP_REG;
        cv.off  = static_cast<uint8_t>(r.offset);
        // conv only TYPES the value downstream (conv_is_binary for /values, published_kind for MQTT).
        // No X10A decode runs here — homehub_format already produced the string — so these are
        // BORROWED kinds, not claims that a HomeHub register is an X10A one: 204 for the Text16
        // error code, and a bit-flag id for a register the catalog marks Binary, which is
        // what makes /values emit `"binary":true` so the browser renders ON/OFF instead of a bare 1.
        // Named enums keep their raw numeric Modbus constants and deliberately carry no binary
        // marker. /values adds their semantic enum id separately, so the visual UI can name them
        // without turning MQTT's mode 2 into the text "Recommended on".
        // The MQTT bridge looks the register definition up by `off` and does not use this borrowed
        // converter to type Modbus JSON; this marker therefore remains limited to generic row/UI use.
        cv.conv = (r.type == MbType::Text16) ? 204 : def::homehub_is_binary(r) ? 300 : 0;
        cv.held = false;                           // no held-over concept on this link
        char buf[24];
        if (def::homehub_format(r, raw, buf, sizeof(buf))) cv.value = buf;
        fresh.push_back(std::move(cv));
    }

    const int committed = static_cast<int>(fresh.size());
    {
        Lock lk(s_cache_mtx);
        s_cache = std::move(fresh);                // move-assign: steals the buffer, cannot throw
        s_cache_generation = cycle_generation;
    }
    bool current_session = false;
    {
        Lock lk(s_mtx);
        // rx_ok/rx_fail are NOT touched here: mb_read already counts every read as it happens, and
        // a second tally added on top double-counted every successful one — a counter with two
        // owners is a counter nobody can reason about. There is no per-cycle tally at all now.
        //
        // `values` is the size of the cache just COMMITTED, not the catalog size and not the read
        // count. It answers "how many rows does this link have right now", so a partly-answering hub
        // reports the truth and a dropped link reports 0 (set in the failed-connect path above)
        // instead of the number of registers we would LIKE to have. Deliberately the COMMITTED size
        // rather than a count of successful reads: a read can succeed and still yield no row (a
        // reply whose register word does not extract), so a read count over-reports by exactly the
        // rows nobody can see. Same quantity hp_stats().values reports for the X10A cache.
        // Only a poll that still owns the current open socket can publish this session as live. A
        // framing/transport failure closes it in mb_read and keeps connected=false; Modbus exception
        // replies leave the socket open and commit the rows that really answered.
        current_session = s_sock >= 0 && s_link_generation == cycle_generation;
        s_status.values = current_session ? committed : 0;
        s_status.connected = current_session;
    }
    if (first_failure.type != MbFailureType::None) {
        status_error(std::string(failure_code(first_failure.type)),
                     failure_message(first_failure), first_failure.detail, first_failure.reg,
                     /*link_down=*/!current_session);
    } else if (current_session) {
        // The error is CURRENT state, not history. A complete clean cycle clears it and records the
        // recovery once in /diag + Syslog.
        status_recovered();
    }
}

// The task. Self-guarded like every other allocating FreeRTOS loop here (CLAUDE.md → Memory
// constraints): an escaping std::bad_alloc would reach std::terminate and reboot the board over a
// SECOND, optional data source — the one failure this stack must never cause the other one.
//
// It exits itself when the HomeHub is disabled, which is what makes "no HomeHub, no stack" literal
// rather than a claim: the task, its 6 KB stack and the socket all go away.
static void mb_task(void*) {
    esp_task_wdt_add(NULL);
    // The ONE-SHOT mDNS search, before the first read attempt and at most once in this task's life.
    // It runs only when NOTHING is known — no typed address, no recorded discovery, never searched —
    // and its outcome is persisted either way. Persisting the EMPTY outcome is the load-bearing half:
    // it is what tells every later boot that this LAN has no gateway, so the browse never happens
    // again. A HomeHub added afterwards is a manual address entry, which is a deliberate act and
    // needs no search.
    try {
        if (config_modbus_should_search(config())) {
            std::string found;
            const bool ok = mb_discover_once(found);
            // TWO statements, not one with a substituted tail, and the split is a REDACTION
            // requirement rather than a style choice. `found` is the hub's LAN IP — the same value
            // /status?redact=1 withholds as modbus.host — so this success line needs a rule in
            // logic/redact.hpp. The failure is already emitted by status_error() without an address,
            // and therefore needs no redaction rule or duplicate line here.
            if (ok) diag_printf("modbus: one-shot mDNS search found gateway %s\n", found.c_str());
            config_save_modbus_found(ok ? found : std::string());
        }
    } catch (...) {
        diag_printf("modbus: one-shot search skipped (oom?)\n");
    }
    for (;;) {
        esp_task_wdt_reset();
        try {
            // The ADDRESS is the switch: no address, no stack. Re-read every cycle so clearing it in
            // the UI retires the task live, exactly as the old enable flag did.
            if (config_modbus_host(config()).empty()) break;
            if (esp_timer_get_time() >= s_next_try_us) mb_poll_once();
        } catch (const std::exception& e) {
            // Keep the allocation guard allocation-free: constructing the UI error itself can throw
            // when the exception was std::bad_alloc. Transport/protocol failures take the structured
            // status_error() path before reaching this last-resort guard.
            diag_printf("modbus: cycle skipped (%s)\n", e.what());
        } catch (...) {
            diag_printf("modbus: cycle skipped (oom?)\n");
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));
    }
    mb_disconnect();
    {
        Lock lk(s_mtx);
        s_status.enabled = false;
        s_status.values  = 0;
    }
    {
        Lock lk(s_cache_mtx);
        s_cache.clear();
        s_cache_generation = 0;
    }
    diag_printf("modbus: no gateway address — stack stopped\n");
    esp_task_wdt_delete(NULL);
    s_task = nullptr;
    vTaskDelete(nullptr);
}

// Create the task if the HomeHub is enabled and it is not already running. 6144, not hp_poll's 8192
// and not the 4096 the other diag_printf tasks take: this task runs getaddrinfo()/mdns_query_*() and
// the socket calls directly on its own stack, and syslog.cpp has already measured that same chain at
// 6144 with the note "4096 is too thin for that call chain". Its own locals are small (a 260 B ADU,
// a 23-row vector) — nothing like the /status builder that drove hp_poll's sizing.
// Start the task when a gateway is KNOWN — or when the one-shot search has never run, since the
// search itself lives in the task (it blocks for ~3 s, and this is the task that may block).
static void mb_task_start_if_enabled() {
    const Config& c = config();
    if (s_task || (config_modbus_host(c).empty() && !config_modbus_should_search(c))) return;
    { Lock lk(s_mtx); s_status.enabled = true; }
    s_backoff.silent = 0;
    s_next_try_us    = 0;
    if (xTaskCreate(mb_task, "hp_modbus", 6144, nullptr, 4, &s_task) != pdPASS) {
        s_task = nullptr;
        { Lock lk(s_mtx); s_status.enabled = false; }
        diag_printf("modbus: task alloc failed — HomeHub readings unavailable this boot\n");
    }
}

void mb_start() {
    // The mutexes exist even when the stack does not, so /status can answer `enabled:false` rather
    // than an empty object before any task is created.
    if (!s_mtx)       s_mtx       = xSemaphoreCreateMutex();
    if (!s_cache_mtx) s_cache_mtx = xSemaphoreCreateMutex();
    if (!s_mtx || !s_cache_mtx) {
        diag_printf("modbus: mutex alloc failed — HomeHub stack disabled this boot\n");
        return;
    }
    mb_task_start_if_enabled();
}

void mb_reconfigure() {
    if (!s_mtx) return;
    {
        // A changed address must not keep the old socket. The task owns s_req_*, so it is not touched
        // from here — the reset below makes the next cycle re-evaluate and reconnect on its own.
        s_backoff.silent = 0;
        s_next_try_us    = 0;
    }
    {
        // A saved address is a new attempt. Do not show the previous target's failure under it while
        // the task is resolving/connecting; the next clean poll or concrete failure owns this state.
        Lock lk(s_mtx);
        s_status.last_error_code.clear();
        s_status.last_error.clear();
        s_status.last_error_detail   = -1;
        s_status.last_error_register = 0;
    }
    mb_task_start_if_enabled();
    // Clearing the address is handled BY the task (it re-reads it at the top of each cycle and
    // retires itself), so nothing is torn down from the httpd task here — the socket has exactly one
    // owner and it stays that way.
}

size_t mb_values_capacity() { return static_cast<size_t>(def::HOMEHUB_REG_COUNT); }

size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live) {
    live = false;
    if (!s_cache_mtx) return 0;
    size_t n = 0;
    uint32_t cache_generation = 0;
    {
        Lock lk(s_cache_mtx);
        n = s_cache.size() < max ? s_cache.size() : max;
        for (size_t i = 0; i < n; i++) out[i] = s_cache[i];
        cache_generation = s_cache_generation;
    }
    // The link is re-read AFTER the copy, and that order is what makes the payload invariant TRUE
    // rather than merely intended. The cache and the link state sit behind two different mutexes,
    // so a caller that checks `connected` and then copies has a window: mb_read can mark the link
    // down in between and the response still carries the previous session's rows under a guarantee
    // that they were read this cycle.
    //
    // Reading it afterwards closes the disconnect window without nesting the two locks. Comparing
    // generations closes the opposite RECONNECT window as well: if this copy came from session N
    // and session N+1 commits between the copy and this status read, connected may already be true
    // again, but the generations differ and the caller still omits these old rows.
    {
        Lock lk(s_mtx);
        live = logic::modbus_cache_is_live(
            s_status.connected, s_link_generation, cache_generation);
    }
    return n;
}

}  // namespace daik
