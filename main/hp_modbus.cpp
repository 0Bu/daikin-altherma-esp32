// THE HOMEHUB MODBUS STACK: transport + poll task + cache, a second INDEPENDENT source beside the
// X10A one (hp_modbus.hpp, docs/MODBUS_PROTOCOL.md). READ-ONLY: this file issues no Modbus write
// function code at all. The register-54 actuator that legacy-300 built here was removed when
// dynamic LWT actuation was retired (legacy-294), so "no write" is a property of the code, not of a
// guard around it.
//
// Everything here is owned by ONE task (mb_task, below) exactly as hp_poll owns the X10A UART, and
// other tasks see only the mutex-guarded snapshots. The socket is opened once and reused; any read
// failure closes it so the next cycle reconnects — the self-healing shape hp_comm.cpp uses for the
// UART, applied to a socket.
//
// The task exists only while a saved address is active. A fresh device performs one bounded search
// before HTTP starts and persists even a miss; after that, empty configuration creates no task,
// socket, mDNS browse or HomeHub traffic. The dialog can still trigger a manual search.
#include <atomic>

#include "hp_modbus.hpp"
#include "config.hpp"
#include "logic/task_failure.hpp"
#include "def/homehub.hpp"
#include "diag_log.hpp"
#include "history.hpp"
#include "heap_guard.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "stack_watch.hpp"
#include "weather_forecast.hpp"
#include "logic/config_store.hpp"
#include "logic/detect_backoff.hpp" // the SAME backoff the X10A sweep uses on a silent bus
#include "logic/homehub_map.hpp"    // the concept a register pairs on
#include "logic/heap_watchdog.hpp"
#include "logic/modbus_plan.hpp"    // WHICH requests a cycle issues — batching + the gate cadence
#include "logic/modbus_profile.hpp" // auto-detection state machine and extended registers
#include "logic/modbus_snapshot.hpp" // a cache is live only for the TCP session that committed it

#include "esp_netif.h"
#include "esp_heap_caps.h"
#include "esp_netif_ip_addr.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "arch/sys_arch.h"
#include "lwip/sys.h"
#include "mdns.h"
#include "freertos/FreeRTOS.h"
#include "task_config.hpp" // TASK_PRIO_* — the firmware-wide priority table
#include "freertos/semphr.h"
#include "rtos_guard.hpp" // SemGuard — the ONE unwind-safe mutex guard
#include "freertos/task.h"
#include <sys/socket.h>
#include <netdb.h>
#include <fcntl.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>
#include <vector>
#include "logic/ota_quiesce.hpp"
#include "ota_update.hpp"

extern "C" sys_sem_t* daikin_lwip_thread_sem_get(void);

namespace daik {

// Whole-reply budget for one register read. Each recv CALL is bounded by SO_RCVTIMEO below; this
// bounds the reassembly of the entire ADU, which is the part the Task Watchdog cares about (the
// poll task resets once per register, so one read must stay well inside the 20 s TWDT budget).
static constexpr int MB_READ_TIMEOUT_MS = 1500;
// send() can use one timeout; a final recv() can overrun the whole-reply deadline by one timeout.
// Allow that declared transport path while expiring a worker that makes no more network progress.
static constexpr uint32_t MB_REQUEST_BUDGET_MS = 3 * MB_READ_TIMEOUT_MS;
static constexpr uint32_t MB_REPLY_MAX_AGE_S =
    (MB_REQUEST_BUDGET_MS + 2 * POLL_INTERVAL_S * 1000 + 999) / 1000;
// The observed LAN advertises well over 20 HTTP services, while the old browse capped its result
// list at 20. Since mDNS ordering is not stable, that could omit a perfectly healthy HomeHub. Keep
// enough headroom for a busy home LAN and repeat a missed multicast query a few times, but stop the
// explicit button-triggered search after one bounded request.
static constexpr int MB_DISCOVERY_MAX_RESULTS = 64;
static constexpr int MB_DISCOVERY_ATTEMPTS    = 3;
static constexpr int MB_DISCOVERY_RETRY_MS    = 1000;
// Browse plus all missing A records share one attempt budget, not one timeout per responder.
static constexpr int MB_DISCOVERY_ATTEMPT_MS = 5000;

// ── Link state (read by /status + heartbeat)
// ──────────────────────────────────────────────────────
static StaticSemaphore_t s_mtx_storage;
static SemaphoreHandle_t s_mtx = nullptr; // guards s_status; created in mb_init()
static ModbusStatus      s_status;        // guarded by s_mtx
// Writers store the error without allocating. Only mb_status() materializes the public strings.
static constexpr size_t MB_ERROR_MESSAGE_BYTES = 176;
static const char*      s_status_error_code    = ""; // static literals, guarded by s_mtx
static char             s_status_error_message[MB_ERROR_MESSAGE_BYTES]{}; // guarded by s_mtx
static uint32_t         s_link_generation = 0;  // guarded by s_mtx; zero = no connected session yet
static int64_t          s_last_reply_ms   = -1; // guarded by s_mtx; this session's last valid reply
static bool             s_poll_observed = false; // guarded by s_mtx; last attempted cycle completed

// Guarded by s_mtx. Each gate uses its own successful register reply time.
static int64_t s_full_cache_status_ms = -1; // exact cache commit time mirror
static int64_t s_plant_gate_ms        = -1; // input 53
static int64_t s_space_route_ms       = -1; // input 37
static int64_t s_heating_mode_ms      = -1; // input 38
static int64_t s_dhw_operation_ms     = -1; // input 52
static int64_t s_plant_outdoor_ms     = -1; // input 44

// The input 31 observation and its timestamp are guarded by s_mtx.
static int64_t          s_compressor_ms = -1;
static ModbusCompressor s_compressor    = ModbusCompressor::Unknown;

// ── Poll-task-owned socket state (no lock — single owner, exactly like hp_comm.cpp's s_rx/s_tx)
// ─────
static int         s_sock = -1; // open socket, or -1
static uint16_t    s_txn  = 0;  // Modbus transaction id (echoed by the reply; wraps freely)
static std::string s_req_host;  // the configured host this socket is for
static int         s_req_port              = 0;
static int         s_unit                  = 0;     // Modbus unit id addressed on this socket
static bool        s_have_req              = false; // whether s_req_* describe the current socket
static uint32_t    s_req_target_generation = 0;
static uint32_t    s_req_history_expected_generation = 0;
static uint32_t    s_req_history_generation          = 0;
static logic::HistoryModbusTarget s_req_configured_target{};
static uint32_t                   s_req_peer_ipv4 = 0;
// The read cadence (logic/modbus_plan.hpp). Tick 0 is a FULL cycle, so a session that has just
// opened publishes the whole map rather than only the fast gate/context batches — which is why
// mb_session_reset() zeroes it on every new socket rather than letting it run across sessions.
static uint32_t s_cycle_tick = 0;
// Per-batch fallback to single-register reads. A Modbus EXCEPTION is a valid reply about ONE
// register, but a batched request cannot say which of its registers it was about — so a batch that
// excepts is re-read register by register, and stays that way for the SESSION. Sticky rather than
// per-cycle because the usual cause is permanent for this hub configuration (a register the unit
// does not implement); re-probing it as a batch every cycle would pay the exception forever and
// still fall back. Cleared on reconnect: a different hub, or the same hub reconfigured, deserves
// the cheap plan again.
static bool s_batch_split[def::ALTHERMA4_REG_COUNT] = {false};
// Currently detected or active Modbus profile. Starts in Auto, transitions affirmatively to
// Altherma4 on valid water pressure on probe register 79, or to HomeHub on Modbus Exception 02,
// sentinel unsupported, or bounded fallback on transient/unavailable/value retries. Managed
// across sessions by logic::ModbusProbeTracker.
static std::atomic<ModbusProfile> s_active_profile{ModbusProfile::Auto};
static logic::ModbusProbeTracker  s_probe_tracker;

// ── The value cache — this stack's own, deliberately NOT hp_poll's ──────────────────────────────
// Two independent sources need two caches: sharing one would mean a dead X10A bus wipes the HomeHub
// readings on its next commit, which is precisely the coupling this design exists to avoid.
static StaticSemaphore_t        s_cache_mtx_storage;
static SemaphoreHandle_t        s_cache_mtx = nullptr;
static std::vector<CachedValue> s_cache;
static uint32_t s_cache_generation = 0; // guarded by s_cache_mtx; session that committed s_cache
static uint32_t s_cache_target_generation =
    0; // guarded by s_cache_mtx; configured HomeHub identity
static uint32_t s_cache_history_generation = 0; // guarded by s_cache_mtx; confirmed History scope
static int64_t  s_cache_commit_ms =
    -1; // guarded by s_cache_mtx; timestamp of last successful commit

// Task handle + the connect backoff. s_task is read/written under s_mtx so a /set_hp that lands
// while the old task is retiring cannot race it into starting two tasks. Discovery is never part of
// this loop; normal connect failures reuse the X10A sweep's host-tested policy.
static TaskHandle_t     s_task                 = nullptr;
static bool             s_task_retiring        = false; // written by worker under s_mtx
static int64_t          s_task_retry_us        = 0;     // guarded by s_mtx
// Full-cache rows, bounded host copies and temporary socket/receive allocations.
static constexpr size_t MB_FIRST_SWEEP_RESERVE =
    def::ALTHERMA4_REG_COUNT * sizeof(CachedValue) + 5 * (CONFIG_BLOB_MAX_STR + 1) + 4096;
static DetectBackoff s_backoff;
// The HTTP task never mutates s_backoff: it bumps the target generation and sends an atomic
// one-shot; the poll task alone consumes that request and resets its own backoff. This mirrors
// hp_poll.cpp and removes the former plain-int data race. The generation also invalidates a
// cycle/cache that belongs to the previous HomeHub before the poll task has had time to close that
// socket.
static std::atomic<int64_t>  s_next_try_us{0};
static std::atomic<bool>     s_reconfigure_reset{false};
static std::atomic<bool>     s_mb_task_running{false};
static std::atomic<bool>     s_ota_quiesced{false};
static std::atomic<uint32_t> s_mb_cache_revision{1};
static std::atomic<uint32_t> s_target_generation{1};
// Mirrors the persisted HomeHub enable decision. /set_hp stages this bool before its durable write,
// then mb_reconfigure() installs it without copying the string-owning Config after that boundary.
static std::atomic<bool> s_target_enabled{false};
static std::atomic<bool> s_start_allowed{false};
static std::atomic<bool> s_start_in_flight{false};
static std::atomic<bool> s_network_quiesced{true};
static_assert(std::atomic<bool>::is_always_lock_free,
              "HomeHub network quiesce acknowledgement must remain allocation- and lock-free");

// Claim the allocation-rich part of one HomeHub cycle. OTA raises its flag first and then waits
// for this acknowledgement; the recheck immediately after construction closes the opposite race.
// The destructor restores quiescence even when the task's exception boundary catches an OOM.
struct MbNetworkActivity {
    MbNetworkActivity() { s_network_quiesced.store(false); }
    ~MbNetworkActivity() { s_network_quiesced.store(true); }
};

// Creation and the new task may overlap. Each owner must release only its own claim.
struct MbTaskCreation {
    MbTaskCreation() { s_start_in_flight.store(true); }
    ~MbTaskCreation() { s_start_in_flight.store(false); }
};

using logic::MbFailure;
using logic::MbFailureType;

// RAII guard around s_mtx (same idiom as hp_poll.cpp/config.cpp): releases on unwind so a
// std::bad_alloc thrown while copying strings out never strands the mutex.
namespace {
// The ONE unwind-safe mutex guard, shared by every file in this firmware (main/rtos_guard.hpp).
// This used to be a private copy here; nine of them had drifted into two different shapes.
using Lock = SemGuard;
} // namespace

static uint32_t mb_reply_age_locked() {
    return logic::modbus_observation_age_s(s_last_reply_ms, esp_timer_get_time() / 1000);
}

static void reset_observation_times_locked() {
    s_full_cache_status_ms = -1;
    s_plant_gate_ms        = -1;
    s_space_route_ms       = -1;
    s_heating_mode_ms      = -1;
    s_dhw_operation_ms     = -1;
    s_plant_outdoor_ms     = -1;
    s_compressor_ms        = -1;
    s_compressor           = ModbusCompressor::Unknown;
}

// ── Status writers. Strings are built BY THE CALLER and swapped in (noexcept) so nothing allocates
// under the lock — the rule hp_poll.cpp's commit follows for exactly the same reason.
// ──────────────
static bool status_target(std::string host, int port, int unit, bool discovering,
                          uint32_t expected_target_generation = 0) {
    Lock lk(s_mtx);
    if (expected_target_generation != 0 &&
        s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
        return false;
    s_status.host.swap(host);
    s_status.port        = port;
    s_status.unit_id     = unit;
    s_status.discovering = discovering;
    s_status.connected   = false;
    s_last_reply_ms      = -1;
    s_poll_observed      = false;
    reset_observation_times_locked();
    return true;
}
[[gnu::noinline]] static bool status_error(const char* code, const char* msg, int detail, int reg,
                                           bool link_down, uint32_t expected_target_generation) {
    bool changed = false;
    {
        Lock lk(s_mtx);
        if (expected_target_generation != 0 &&
            s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
            return false;
        changed = std::strcmp(s_status_error_code, code) != 0 ||
                  std::strcmp(s_status_error_message, msg) != 0 ||
                  s_status.last_error_detail != detail || s_status.last_error_register != reg;
        if (link_down) s_status.connected = false;
        s_status.discovering         = false;
        s_status.last_error_detail   = detail;
        s_status.last_error_register = reg;
        if (changed) {
            s_status_error_code = code;
            std::strncpy(s_status_error_message, msg, sizeof(s_status_error_message) - 1);
            s_status_error_message[sizeof(s_status_error_message) - 1] = '\0';
        }
    }
    // One line per transition, not one per one-second retry. A clean poll clears the current error,
    // so the same fault is logged again if it genuinely returns after recovery. Use the caller's
    // still-live message outside s_mtx to keep the status and logging locks independent.
    if (changed) diag_printf("modbus: %s\n", msg);
    return true;
}

static void clear_status_error_locked() {
    s_status_error_code          = "";
    s_status_error_message[0]    = '\0';
    s_status.last_error_detail   = -1;
    s_status.last_error_register = 0;
}

static bool status_recovered(uint32_t expected_target_generation = 0) {
    bool recovered = false;
    {
        Lock lk(s_mtx);
        if (expected_target_generation != 0 &&
            s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
            return false;
        recovered = s_status_error_code[0] != '\0' || s_status_error_message[0] != '\0';
        clear_status_error_locked();
    }
    if (recovered) diag_printf("modbus: communication recovered\n");
    return true;
}

// A new user-selected target is a new attempt, so an old failure is no longer the
// CURRENT state while that attempt is in flight. Unlike status_recovered(), this does not log a
// recovery before any successful communication has happened.
static bool status_clear_error(uint32_t expected_target_generation = 0) {
    Lock lk(s_mtx);
    if (expected_target_generation != 0 &&
        s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
        return false;
    clear_status_error_locked();
    return true;
}
// A successful TCP connect starts a new SESSION, but does not make the old cache live. The link
// only becomes `connected` after this session has committed its first poll below. Reserving
// generation zero makes a pre-first-poll cache impossible to mistake for current even on the first
// connection.
static bool status_socket_open(std::string host, int port, int unit, uint32_t peer_ipv4,
                               uint32_t expected_target_generation) {
    // A NEW SESSION STARTS A NEW READ CADENCE. Tick 0 is a full cycle, so the first poll of this
    // socket publishes the whole map instead of only the fast batches; and the per-batch fallback
    // to single reads is forgotten, because the reason for it (a register this hub does not
    // implement) is a property of the peer we may have just stopped talking to.
    s_cycle_tick = 0;
    for (bool& split : s_batch_split) split = false;
    const uint32_t      now_s = static_cast<uint32_t>(esp_timer_get_time() / 1000000ULL);
    const ModbusProfile prof  = s_probe_tracker.on_socket_open(host, port, unit, peer_ipv4, now_s);
    s_active_profile.store(prof, std::memory_order_release);
    Lock lk(s_mtx);
    if (s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
        return false;
    s_status.host.swap(host);
    s_status.port      = port;
    s_status.unit_id   = unit;
    s_status.connected = false;
    s_last_reply_ms    = -1;
    s_poll_observed    = false;
    reset_observation_times_locked();
    s_status.discovering   = false;
    s_status.profile       = prof;
    s_status.profile_basis = s_probe_tracker.profile_basis;
    if (++s_link_generation == 0) ++s_link_generation; // zero stays the "no session" sentinel
    history_modbus_candidate(ntohl(peer_ipv4));
    return true;
}

// ── Address resolution ──────────────────────────────────────────────────────────────────────────
// A ".local" name is resolved over mDNS (mdns_query_a wants the bare label, no ".local"); anything
// else — a dotted IP or an ordinary DNS hostname — goes through getaddrinfo. IPv4 only (the HomeHub
// is a LAN device and this whole path is trusted-LAN).
static bool resolve_host(const std::string& host, int port, sockaddr_in& out) {
    memset(&out, 0, sizeof(out));
    out.sin_family                = AF_INET;
    out.sin_port                  = htons(static_cast<uint16_t>(port));
    static const char dot_local[] = ".local";
    const size_t      ll          = sizeof(dot_local) - 1;
    if (host.size() > ll && host.compare(host.size() - ll, ll, dot_local) == 0) {
        const std::string name = host.substr(0, host.size() - ll);
        esp_ip4_addr_t    a{};
        if (mdns_query_a(name.c_str(), 2000, &a) != ESP_OK) return false;
        out.sin_addr.s_addr = a.addr;
        return true;
    }
    addrinfo hints{};
    hints.ai_family   = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res     = nullptr;
    char      portbuf[8];
    std::snprintf(portbuf, sizeof(portbuf), "%d", port);
    if (getaddrinfo(host.c_str(), portbuf, &hints, &res) != 0 || res == nullptr) return false;
    memcpy(&out, res->ai_addr, sizeof(sockaddr_in));
    out.sin_port = htons(static_cast<uint16_t>(port)); // keep the requested port explicitly
    freeaddrinfo(res);
    return true;
}

// mDNS-discover a HomeHub: browse _http._tcp (the service EKRHH advertises, guide §2.5), keep the
// first responder whose hostname is "homehub-*" (logic/modbus.hpp is_homehub_hostname — this browse
// also hears OUR OWN _http advert and unrelated HTTP devices, so the filter is mandatory), and take
// its first IPv4. `found` returns that numeric address for this session and /status — discovery
// uses the mDNS name to IDENTIFY the HomeHub, but the editable Host field must show the resolved
// IP.
static bool discover_homehub(std::string& found) {
    const int64_t  deadline_us = esp_timer_get_time() + MB_DISCOVERY_ATTEMPT_MS * 1000;
    mdns_result_t* results     = nullptr;
    if (mdns_query_ptr("_http", "_tcp", 3000, MB_DISCOVERY_MAX_RESULTS, &results) != ESP_OK)
        return false;
    bool ok         = false;
    int  matches    = 0;
    int  responders = 0;
    for (mdns_result_t* r = results; r != nullptr; r = r->next) {
        responders++;
        const char* name = r->hostname ? r->hostname : r->instance_name;
        if (name == nullptr || !is_homehub_hostname(name)) continue;
        matches++;
        if (ok) continue; // keep counting (to warn on multiples) but commit to the first match
        // Take the A RECORD, not the serial-derived hostname. The request that started discovery
        // had an empty Host field; once discovery succeeds that field must contain the concrete IP
        // the user can see, copy and diagnose. A result without an embedded A record gets one
        // explicit query before it is rejected.
        for (mdns_ip_addr_t* a = r->addr; a != nullptr; a = a->next) {
            if (a->addr.type == ESP_IPADDR_TYPE_V4 && a->addr.u_addr.ip4.addr != 0) {
                found = mb_ipv4_string(IP2STR(&a->addr.u_addr.ip4));
                ok    = !found.empty();
                break;
            }
        }
        if (!ok) {
            esp_ip4_addr_t a4{};
            const int64_t  remaining_ms = (deadline_us - esp_timer_get_time()) / 1000;
            const int      lookup_ms = remaining_ms > 2000 ? 2000 : static_cast<int>(remaining_ms);
            if (lookup_ms > 0 && mdns_query_a(name, lookup_ms, &a4) == ESP_OK && a4.addr != 0) {
                found = mb_ipv4_string(IP2STR(&a4));
                ok    = !found.empty();
            }
        }
    }
    mdns_query_results_free(results);
    // Several hubs on one LAN is unusual. Both automatic and manual discovery deliberately use the
    // first one that RESOLVED and say so, rather than silently picking among them. Gated on `ok` —
    // with nothing resolved there is no address to print, and "using " followed by nothing is
    // noise.
    if (ok && matches > 1)
        diag_printf("modbus: %d HomeHubs discovered via mDNS — using %s\n", matches, found.c_str());
    if (!ok && responders >= MB_DISCOVERY_MAX_RESULTS)
        diag_printf("modbus: mDNS browse reached its %d-result safety limit without a HomeHub\n",
                    MB_DISCOVERY_MAX_RESULTS);
    return ok;
}

static bool discover_homehub_bounded(std::string& found, const char* origin) {
    for (int attempt = 1; attempt <= MB_DISCOVERY_ATTEMPTS; attempt++) {
        found.clear();
        if (discover_homehub(found)) {
            // The success line contains a private LAN IP and is covered by logic/redact.hpp.
            diag_printf("modbus: %s mDNS search found gateway %s\n", origin, found.c_str());
            return true;
        }
        if (attempt < MB_DISCOVERY_ATTEMPTS) {
            diag_printf("modbus: %s mDNS search attempt %d/%d found no HomeHub — retrying\n",
                        origin, attempt, MB_DISCOVERY_ATTEMPTS);
            vTaskDelay(pdMS_TO_TICKS(MB_DISCOVERY_RETRY_MS));
        }
    }
    diag_printf("modbus: no HomeHub found via %s mDNS search after %d attempts\n", origin,
                MB_DISCOVERY_ATTEMPTS);
    return false;
}

bool mb_discover_homehub(std::string& found) { return discover_homehub_bounded(found, "manual"); }

void mb_autodiscover_initial() {
    Config c = config();
    if (!config_modbus_should_search(c)) return;
    // A stored settings blob this build could not use (a newer layout after a rollback, damage, a
    // read error) leaves the running config on the fallback, whose pending search decision is not
    // the owner's. Persisting its outcome would replace that blob with the fallback image, so skip
    // the search entirely rather than spend it on a result that may not be written. The decision
    // stays pending and runs on the first networked boot after an explicit save.
    if (config_stored_blob_unreadable()) {
        diag_printf("modbus: initial mDNS search skipped — stored settings unreadable, kept\n");
        return;
    }
    // Do not consume the one-shot decision in the captive portal or before a LAN lease exists. The
    // next networked boot is still the device's first meaningful opportunity to see the HomeHub.
    if (!net_is_up()) {
        diag_printf("modbus: initial mDNS search deferred — no LAN lease\n");
        return;
    }

    std::string found;
    const bool  ok = discover_homehub_bounded(found, "initial");
    // This function is called before http_start(), so config_save's whole-blob write cannot race a
    // web save. Persist the decision even on a miss: later hubs are configured manually and boot
    // never becomes a continuous multicast scan loop.
    c = config();
    if (!config_modbus_should_search(c)) return;
    c.mb_discovery_done = true;
    if (ok) c.mb_host = found;
    if (!config_save(c)) {
        diag_printf(
            "modbus: initial discovery result could not be persisted — no HomeHub enabled\n");
        return;
    }
    if (ok)
        diag_printf("modbus: initial HomeHub address saved\n");
    else
        diag_printf(
            "modbus: initial search completed without a HomeHub — future search is manual\n");
}

static bool close_sock() {
    s_have_req = false;
    // lwIP can fail before deleting the socket. Keep ownership until close succeeds.
    if (s_sock >= 0 && close(s_sock) != 0 && errno != EBADF) return false;
    s_sock = -1;
    return true;
}

// Non-blocking connect with a select() timeout, then return to blocking with bounded
// sends and reads. Keep a failed setup's descriptor owned if lwIP cannot close it yet.
static int connect_socket(const sockaddr_in& addr, int timeout_ms, int& out_err) {
    out_err        = 0;
    const int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock < 0) {
        out_err = errno;
        return -1;
    }
    s_sock = sock;
    // Install both timeouts before connecting. A connected socket's FIN allocation
    // retry uses the send timeout in lwIP. An unopened socket needs no FIN.
    const timeval rt{MB_READ_TIMEOUT_MS / 1000, (MB_READ_TIMEOUT_MS % 1000) * 1000};
    if (setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &rt, sizeof(rt)) != 0 ||
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &rt, sizeof(rt)) != 0) {
        out_err = errno;
        close_sock();
        return -1;
    }
    const int flags = fcntl(sock, F_GETFL, 0);
    if (flags < 0 || fcntl(sock, F_SETFL, flags | O_NONBLOCK) < 0) {
        out_err = errno;
        close_sock();
        return -1;
    }
    int r = connect(sock, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr));
    if (r < 0 && errno == EINPROGRESS) {
        fd_set w;
        FD_ZERO(&w);
        FD_SET(sock, &w);
        timeval tv{timeout_ms / 1000, (timeout_ms % 1000) * 1000};
        r = select(sock + 1, nullptr, &w, nullptr, &tv);
        if (r > 0) {
            int       so_err = 0;
            socklen_t l      = sizeof(so_err);
            if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &so_err, &l) != 0) {
                out_err = errno;
                r       = -1;
            } else if (so_err != 0) {
                out_err = so_err;
                r       = -1;
            } else {
                r = 0;
            }
        } else if (r == 0) {
            out_err = ETIMEDOUT;
            r       = -1;
        } else {
            out_err = errno;
            r       = -1;
        }
    } else if (r < 0) {
        out_err = errno;
        r       = -1;
    }
    if (r != 0) {
        close_sock();
        return -1;
    }
    if (fcntl(sock, F_SETFL, flags) < 0) { // back to blocking
        out_err = errno;
        close_sock();
        return -1;
    }
    return sock;
}

static const char* connect_error_code(int err) {
    if (err == ETIMEDOUT) return "connect_timeout";
    if (err == ECONNREFUSED) return "connection_refused";
    if (err == ENETUNREACH) return "network_unreachable";
    if (err == EHOSTUNREACH) return "host_unreachable";
    return "connect_failed";
}

[[gnu::noinline]] static void report_connect_error(int err, uint32_t generation) {
    const char* message;
    char        formatted[128];
    switch (err) {
    case ETIMEDOUT:
        message = "connection timed out";
        break;
    case ECONNREFUSED:
        message = "connection refused (Modbus TCP port closed)";
        break;
    case ENETUNREACH:
        message = "network unreachable";
        break;
    case EHOSTUNREACH:
        message = "HomeHub unreachable";
        break;
    default:
        std::snprintf(formatted, sizeof(formatted), "connection failed (errno %d: %s)", err,
                      std::strerror(err));
        message = formatted;
        break;
    }
    status_error(connect_error_code(err), message, err, 0, true, generation);
}

static bool mb_ensure_connected(const std::string& host, int port, int unit_id,
                                uint32_t expected_target_generation, uint32_t history_generation) {
    if (s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
        return false;
    // No address, nothing to dial. There is deliberately no discovery fallback here.
    if (host.empty()) {
        status_error("no_address", "no HomeHub address configured", -1, 0, true,
                     expected_target_generation);
        return false;
    }
    // Reuse only a healthy socket for the same target. A failed close leaves ownership
    // with this task but clears the request binding.
    if (s_sock >= 0 && s_have_req && host == s_req_host && port == s_req_port &&
        unit_id == s_unit && s_req_target_generation == expected_target_generation &&
        s_target_generation.load(std::memory_order_acquire) == expected_target_generation)
        return true;
    if (!close_sock()) {
        status_error("close_pending", "waiting for HomeHub socket cleanup", errno, 0, true,
                     expected_target_generation);
        return false;
    }
    // Announce the target before the blocking resolve, so /status shows what the device is
    // attempting rather than going silent for seconds.
    if (!status_clear_error(expected_target_generation) ||
        !status_target(host, port, unit_id, /*discovering=*/false, expected_target_generation))
        return false;

    sockaddr_in addr{};
    std::string request_host = host;
    std::string status_host  = host;
    // Reserve any new profile-tracker host storage before acquiring a socket.
    s_probe_tracker.target_host.reserve(host.size());
    esp_task_wdt_reset(); // DNS/mDNS resolution can take a couple of seconds
    if (!resolve_host(host, port, addr)) {
        status_error("resolve_failed", "HomeHub address could not be resolved", -1, 0, true,
                     expected_target_generation);
        return false;
    }
    if (s_target_generation.load(std::memory_order_acquire) != expected_target_generation)
        return false;
    int       connect_err = 0;
    const int sock        = connect_socket(addr, 2000, connect_err);
    esp_task_wdt_reset();
    if (sock < 0) {
        report_connect_error(connect_err, expected_target_generation);
        return false;
    }
    if (s_target_generation.load(std::memory_order_acquire) != expected_target_generation) {
        close_sock();
        return false;
    }
    s_req_host.swap(request_host);
    s_req_port = port;
    s_unit     = unit_id;
    if (!status_socket_open(std::move(status_host), port, unit_id, addr.sin_addr.s_addr,
                            expected_target_generation)) {
        close_sock();
        return false;
    }
    s_req_configured_target           = history_modbus_target(host, port, unit_id);
    s_req_peer_ipv4                   = ntohl(addr.sin_addr.s_addr);
    s_req_history_expected_generation = history_generation;
    s_req_history_generation          = 0;
    s_req_target_generation           = expected_target_generation;
    s_have_req                        = true;
    return true;
}

// Read exactly `n` bytes, giving up at the absolute monotonic deadline `deadline_us`.
//
// SO_RCVTIMEO bounds each recv CALL, which is not the same as bounding the read: a peer that
// trickles one byte per timeout keeps every call "successful" and the loop runs as long as it
// likes. This task is Task-Watchdog-subscribed with a 20 s budget and resets once per register, so
// an unbounded read here is a reboot waiting for a slow or hostile peer. The deadline bounds the
// whole reassembly.
static bool recv_all(int sock, uint8_t* buf, int n, int64_t deadline_us, MbFailure& failure) {
    int got = 0;
    while (got < n) {
        if (esp_timer_get_time() >= deadline_us) {
            failure.type   = MbFailureType::ResponseTimeout;
            failure.detail = ETIMEDOUT;
            return false;
        }
        const int r = recv(sock, buf + got, n - got, 0);
        if (r == 0) {
            failure.type   = MbFailureType::ConnectionClosed;
            failure.detail = 0;
            return false;
        }
        if (r < 0) {
            const int err  = errno; // capture before close() or another libc call can overwrite it
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
// (unit + PDU). Returns the total ADU length, or -1 on timeout / short read / an implausible
// length. The whole reply must land within MB_READ_TIMEOUT_MS of the request — see recv_all.
static int recv_adu(int sock, uint8_t* buf, int buflen, MbFailure& failure) {
    if (buflen < MBAP_LEN) {
        failure.type = MbFailureType::InvalidResponse;
        return -1;
    }
    const int64_t deadline = esp_timer_get_time() + MB_READ_TIMEOUT_MS * 1000;
    if (!recv_all(sock, buf, 6, deadline, failure)) return -1;
    const int len = (buf[4] << 8) | buf[5]; // bytes after the length field (unit + PDU)
    if (len < 2 || 6 + len > buflen) {      // >=2: at least unit + a 1-byte PDU
        failure.type = MbFailureType::InvalidResponse;
        return -1;
    }
    if (!recv_all(sock, buf + 6, len, deadline, failure)) return -1;
    return 6 + len;
}

// A read and the bytes it points into, as ONE object with ONE lifetime. `MbResponse::payload` is a
// pointer INTO the received ADU (logic/modbus.hpp parses in place), so the buffer may not belong to
// mb_read: it did, and every caller was therefore reading a dead stack frame the moment it
// extracted a register. It worked only because nothing was called between the read and the
// extraction — a property of the call sites of the day, not of the code, and the kind of thing an
// added esp_task_wdt_reset() or diag_printf() turns into a plausible WRONG register value with no
// error anywhere. The buffer now lives in the caller's frame, beside the response that borrows it.
struct MbRead {
    uint8_t    adu[MB_ADU_MAX];
    MbResponse resp;
    int64_t    observed_ms = -1; // successful parse time; shared by every word in this reply
};

static bool mb_read(MbFunc space, uint16_t addr, uint16_t qty, MbRead& io, MbFailure& failure,
                    bool is_probe = false) {
    MbResponse& out = io.resp;
    out             = MbResponse{};
    io.observed_ms  = -1;
    failure         = MbFailure{};
    if (s_sock < 0) {
        failure.type   = MbFailureType::ConnectionClosed;
        failure.detail = ENOTCONN;
        return false;
    }
    uint8_t        req[16];
    const uint16_t txn  = ++s_txn;
    const uint8_t  unit = static_cast<uint8_t>(s_unit);
    const int      n    = mb_build_read(req, sizeof(req), txn, unit, space, addr, qty);
    if (n < 0) {
        failure.type = MbFailureType::RequestBuild;
        if (!is_probe) {
            Lock lk(s_mtx);
            s_status.rx_fail++;
        }
        return false;
    }
    // Every request owns a feed, including each single read after a batched exception and probes.
    // A batch-level feed alone leaves six slow fallback reads outside the 20 s watchdog budget.
    esp_task_wdt_reset();
    const int sent = send(s_sock, req, n, 0);
    if (sent != n) {
        const int err  = sent < 0 ? errno : EIO;
        failure.detail = err;
        if (err == EAGAIN || err == EWOULDBLOCK || err == ETIMEDOUT)
            failure.type = MbFailureType::SendTimeout;
        else if (err == ECONNRESET || err == ENOTCONN || err == EPIPE)
            failure.type = MbFailureType::ConnectionClosed;
        else
            failure.type = MbFailureType::SendFailed;
        close_sock();
        {
            Lock lk(s_mtx);
            if (!is_probe) s_status.rx_fail++;
            s_status.connected = false;
        }
        return false;
    }
    const int got = recv_adu(s_sock, io.adu, sizeof(io.adu), failure);
    if (got < 0) {
        close_sock();
        {
            Lock lk(s_mtx);
            if (!is_probe) s_status.rx_fail++;
            s_status.connected = false;
        }
        return false;
    }
    const MbParse p = mb_parse_response(io.adu, got, txn, unit, space, qty, out);
    if (p == MbParse::Ok) {
        io.observed_ms = esp_timer_get_time() / 1000;
        Lock lk(s_mtx);
        s_status.rx_ok++;
        s_last_reply_ms = io.observed_ms;
        return true;
    }
    // An Exception is a VALID reply (the register is simply unreadable now) — count it but keep the
    // socket. Any framing / txn / desync error means the stream is out of step: drop the socket so
    // the next cycle reconnects rather than mis-parsing every following reply.
    if (!is_probe) {
        Lock lk(s_mtx);
        s_status.rx_fail++;
    }
    if (p == MbParse::Exception) {
        {
            Lock lk(s_mtx);
            s_last_reply_ms = esp_timer_get_time() / 1000;
        }
        failure.type   = MbFailureType::Exception;
        failure.detail = out.exc_code;
    } else {
        failure.type   = MbFailureType::InvalidResponse;
        failure.detail = static_cast<int>(p);
        close_sock();
        Lock lk(s_mtx);
        s_status.connected = false;
    }
    return false;
}

static const char* failure_code(MbFailureType type) {
    switch (type) {
    case MbFailureType::RequestBuild:
        return "request_failed";
    case MbFailureType::SendTimeout:
        return "send_timeout";
    case MbFailureType::SendFailed:
        return "send_failed";
    case MbFailureType::ResponseTimeout:
        return "response_timeout";
    case MbFailureType::ConnectionClosed:
        return "connection_closed";
    case MbFailureType::ReceiveFailed:
        return "receive_failed";
    case MbFailureType::InvalidResponse:
        return "invalid_response";
    case MbFailureType::Exception:
        return "modbus_exception";
    case MbFailureType::None:
        return "";
    }
    return "read_failed";
}

static void failure_message(const MbFailure& f, char (&msg)[MB_ERROR_MESSAGE_BYTES]) {
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
                                     f.detail <= static_cast<int>(MbParse::QtyMismatch)
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
}

// Keep the fixed diagnostic formatting buffer off the poll frame and report after the commit.
[[gnu::noinline]] static void report_cycle_result(const MbFailure& failure, bool full,
                                                  bool current_session, uint32_t generation) {
    if (failure.type != MbFailureType::None) {
        char message[MB_ERROR_MESSAGE_BYTES];
        failure_message(failure, message);
        status_error(failure_code(failure.type), message, failure.detail, failure.reg,
                     /*link_down=*/!current_session, generation);
    } else if (logic::mb_cycle_proves_recovery(full, current_session)) {
        // A fast cycle cannot prove the remaining rows recovered.
        status_recovered(generation);
    }
}

// ── The read plan, resolved at COMPILE time ─────────────────────────────────────────────────────
// logic/modbus_plan.hpp is constexpr throughout, so the batching of def::HOMEHUB_REGS is settled by
// the compiler and lives in flash: no RAM for a table that cannot change, and — the part that
// matters more — its shape is asserted HERE, where it is used, rather than checked at runtime by
// code that would have no useful answer if the check failed.
namespace {
template <size_t N> struct MbPlanT {
    uint8_t        order[N] = {};
    logic::MbBatch batch[N] = {};
    int            count    = 0;
    bool           ok       = false;
};

template <size_t N> constexpr MbPlanT<N> mb_plan_make_from(const def::HomeHubReg (&regs)[N]) {
    MbPlanT<N> p;
    MbFunc     spaces[N]  = {};
    uint16_t   offsets[N] = {};
    for (size_t i = 0; i < N; i++) {
        spaces[i]  = regs[i].space;
        offsets[i] = regs[i].offset;
    }
    p.ok = logic::mb_plan_order(spaces, offsets, static_cast<int>(N), p.order);
    if (!p.ok) return p;
    p.count = logic::mb_plan_build(spaces, offsets, static_cast<int>(N), p.order, p.batch,
                                   static_cast<int>(N));
    p.ok    = p.count > 0;
    return p;
}

constexpr auto MB_PLAN = mb_plan_make_from<def::HOMEHUB_REG_COUNT>(def::HOMEHUB_REGS);
static_assert(MB_PLAN.ok, "HomeHub register table does not yield a usable read plan");
static_assert(MB_PLAN.count * 3 <= def::HOMEHUB_REG_COUNT,
              "batching no longer collapses the HomeHub map — re-check the register offsets");
static_assert(
    [] {
        for (const auto& reg : def::HOMEHUB_REGS) {
            if (reg.offset > logic::MODBUS_BASE_MAX_OFFSET) return false;
        }
        return true;
    }(),
    "Base HomeHub max offset invariant");

constexpr auto MB_PLAN_ALTHERMA4 = mb_plan_make_from<def::ALTHERMA4_REG_COUNT>(def::ALTHERMA4_REGS);
static_assert(MB_PLAN_ALTHERMA4.ok, "Altherma 4 register table does not yield a usable read plan");
static_assert(MB_PLAN_ALTHERMA4.count == 15,
              "Altherma 4 request budget changed — re-check the documented native map");
static_assert((1 + logic::mb_plan_max_requests(MB_PLAN_ALTHERMA4.batch, MB_PLAN_ALTHERMA4.count,
                                               true)) *
                      MB_REQUEST_BUDGET_MS <
                  logic::HISTORY_DT_S * 1000,
              "A full sweep including a profile probe must fit inside one history interval");
static_assert(def::homehub_find(31)->space == MbFunc::ReadInput &&
                  def::homehub_find(31)->kind == def::HomeHubValueKind::Binary &&
                  def::altherma4_find(31)->space == MbFunc::ReadInput &&
                  def::altherma4_find(31)->kind == def::HomeHubValueKind::Binary,
              "The compressor reply must have the same meaning across profile detection");
static constexpr uint32_t MB_CACHE_MAX_AGE_S = logic::modbus_cache_max_age_s(
    logic::MB_FULL_CYCLE_TICKS, POLL_INTERVAL_S * 1000, MB_REQUEST_BUDGET_MS,
    logic::mb_plan_max_requests(MB_PLAN_ALTHERMA4.batch, MB_PLAN_ALTHERMA4.count, true),
    logic::mb_plan_max_requests(MB_PLAN_ALTHERMA4.batch, MB_PLAN_ALTHERMA4.count, false));
} // namespace

ModbusStatus mb_status() {
    if (!s_mtx) return ModbusStatus{};
    Lock         lk(s_mtx);
    ModbusStatus s       = s_status;
    s.last_error_code    = s_status_error_code;
    s.last_error         = s_status_error_message;
    const int64_t now_ms = esp_timer_get_time() / 1000;
    const bool    observed =
        s.connected && s_poll_observed &&
        logic::modbus_observation_age_s(s_last_reply_ms, now_ms) <= MB_REPLY_MAX_AGE_S;
    if (!observed ||
        logic::modbus_observation_age_s(s_full_cache_status_ms, now_ms) > MB_CACHE_MAX_AGE_S)
        s.values = 0;
    // Link replies are not new measurements of previous-cycle inputs. Each input expires from
    // the response that actually supplied its word, even while another slow sweep makes progress.
    if (!observed ||
        logic::modbus_observation_age_s(s_plant_gate_ms, now_ms) > MB_REPLY_MAX_AGE_S) {
        s.plant_gate_known  = false;
        s.plant_gate_active = false;
    }
    if (!observed ||
        logic::modbus_observation_age_s(s_space_route_ms, now_ms) > MB_REPLY_MAX_AGE_S) {
        s.space_route_known  = false;
        s.space_route_active = false;
    }
    if (!observed ||
        logic::modbus_observation_age_s(s_heating_mode_ms, now_ms) > MB_REPLY_MAX_AGE_S) {
        s.heating_mode_known  = false;
        s.heating_mode_active = false;
    }
    if (!observed ||
        logic::modbus_observation_age_s(s_dhw_operation_ms, now_ms) > MB_REPLY_MAX_AGE_S) {
        s.dhw_operation_known  = false;
        s.dhw_operation_active = false;
    }
    if (!observed ||
        logic::modbus_observation_age_s(s_plant_outdoor_ms, now_ms) > MB_REPLY_MAX_AGE_S)
        s.plant_outdoor = logic::OutdoorEvidence{};
    return s;
}

// ── One poll cycle ───────────────────────────────────────────────────────────────────────────────
// Reads the HomeHub map into this stack's own cache. Structurally the twin of hp_poll's
// poll_once(): sized reserve up front, everything staged in locals, one non-allocating commit.
//
// TWO CADENCES (logic/modbus_plan.hpp). A FULL cycle reads every batch and commits a new cache; the
// cycles between it read only the batches carrying diagnosis gates or fast outdoor context and
// commit only those facts and the link state. The link used to issue one request per register per
// second — 31 MBAP round-trips a second at a hub that also serves the Onecta app, the MMI and evcc
// — for a map whose fastest-moving member is a water temperature.
static bool mb_poll_once() {
    const uint32_t cycle_target_generation = s_target_generation.load(std::memory_order_acquire);
    struct ModbusTargetConfig {
        int     mb_port    = 0;
        uint8_t mb_unit_id = 0;
    };
    std::string        target;
    ModbusTargetConfig c;
    with_config([&](const Config& cfg) {
        target       = config_modbus_host(cfg);
        c.mb_port    = cfg.mb_port;
        c.mb_unit_id = cfg.mb_unit_id;
    });

    // /set_hp owns configured history identity. Bind only the resolved peer here, with a
    // generation captured before DNS so an old connection cannot override a configuration save.
    const uint32_t           history_generation = history_modbus_generation();
    std::vector<CachedValue> fresh;
    if (logic::mb_cycle_is_full(s_cycle_tick) || s_sock < 0 || !s_have_req ||
        s_req_target_generation != cycle_target_generation || target != s_req_host ||
        c.mb_port != s_req_port || c.mb_unit_id != s_unit)
        fresh.reserve(def::ALTHERMA4_REG_COUNT);

    if (!mb_ensure_connected(target, c.mb_port, c.mb_unit_id, cycle_target_generation,
                             history_generation)) {
        // THE CACHE GOES WITH THE LINK. Keeping it was a real defect: /values kept serving the last
        // good readings, the browser had no way to tell they were minutes old, and it went on
        // printing them as the live second opinion — complete with a computed "difference" against
        // a live X10A value, which is a number about two instants presented as a number about two
        // instruments. Everything else in this firmware refuses exactly that (a held-over outdoor
        // reading blanks rather than being shown dimmer). The LIVE cache is therefore dropped; the
        // separate trend rings retain only timestamped past samples and receive an explicit gap for
        // this failed cycle. The value cache is otherwise refreshed by full cycles and remains
        // bounded by the full cadence, including the declared request and fallback budgets.
        {
            Lock lk(s_cache_mtx);
            s_cache.clear();
            s_cache_generation         = 0;
            s_cache_target_generation  = 0;
            s_cache_history_generation = 0;
            s_cache_commit_ms          = 0;
            s_mb_cache_revision.fetch_add(1, std::memory_order_release);
        }
        {
            Lock lk(s_mtx);
            s_status.values = 0;
        }
        history_record_modbus(nullptr, 0, history_generation); // advance this identity with a gap
        // Back off before retrying — see s_backoff. Applied by SKIPPING cycles, never by
        // lengthening the delay, so the top-of-loop watchdog reset keeps its cadence.
        s_next_try_us = esp_timer_get_time() +
                        static_cast<int64_t>(detect_backoff_step(s_backoff, false)) * 1000000;
        return false; // mb_ensure_connected already set the status
    }
    detect_backoff_step(s_backoff, true); // connected — back to full cadence

    // Owned by this poll task. A reconnect cannot happen again until this cycle returns, while the
    // mutex makes the generation visible to concurrent /values snapshots without a data race.
    uint32_t cycle_generation = 0;
    {
        Lock lk(s_mtx);
        cycle_generation = s_link_generation;
    }

    // A FULL cycle rebuilds the cache. A fast cycle refreshes the gates and named context without
    // replacing the full value cache.
    const bool full = logic::mb_cycle_is_full(s_cycle_tick);

    uint32_t  first_history_bucket = 0;
    size_t    history_split        = 0;
    MbFailure first_failure;
    // One capture in take_row instead of nine independent references. Keeping these small facts
    // together avoids growing the poll frame each time an admission operand is added.
    struct PlantGates {
        bool             plant_gate_known     = false;
        bool             plant_gate_active    = false;
        bool             space_route_known    = false;
        bool             space_route_active   = false;
        bool             heating_mode_known   = false;
        bool             heating_mode_active  = false;
        bool             received_data        = false;
        ModbusCompressor compressor           = ModbusCompressor::Unknown;
        int64_t          plant_gate_ms        = -1;
        int64_t          space_route_ms       = -1;
        int64_t          heating_mode_ms      = -1;
        int64_t          compressor_ms        = -1;
        int64_t          dhw_operation_ms     = -1;
        bool             dhw_operation_active = false;
    } gates;
    bool    outdoor_row_answered  = false;
    double  outdoor_temperature_c = 0.0;
    int64_t plant_outdoor_ms      = -1;

    // Preserve the first failure, but never let a harmless per-register exception hide a timeout:
    // if a later transport/protocol failure actually drops the link, that becomes the displayed
    // cause.
    const auto note_failure = [&](const MbFailure& f) {
        if (first_failure.type == MbFailureType::None ||
            (first_failure.type == MbFailureType::Exception && f.type != MbFailureType::Exception))
            first_failure = f;
    };

    // One register word: gates/fast context always, a cache row only on a full cycle. Gates are
    // read from the SAME word the row is built from — they are not a second read and cannot
    // disagree with it.
    const auto take_row = [&](const def::HomeHubReg& r, uint16_t raw, int64_t observed_ms) {
        if (r.space == MbFunc::ReadInput && r.offset == 31 && raw <= 1) {
            gates.compressor    = raw == 1 ? ModbusCompressor::On : ModbusCompressor::Off;
            gates.compressor_ms = observed_ms;
        }
        if (r.space == MbFunc::ReadInput && r.offset == 52 && raw <= 1) {
            gates.dhw_operation_active = raw == 1;
            gates.dhw_operation_ms     = observed_ms;
        }
        // THE SPACE-OPERATION GATE — input register 53 explicitly covers heating AND cooling. It
        // does not exclude DHW routing: input 37 must independently report space, and input 38
        // distinguishes heating from cooling. A sentinel/out-of-range word leaves `known`
        // false: an unknown gate must never read as "inactive", which is an ordinary quiet plant.
        if (r.space == MbFunc::ReadInput && r.offset == 53 && !mb_is_special(raw) && raw <= 1) {
            gates.plant_gate_known  = true;
            gates.plant_gate_active = raw == 1;
            gates.plant_gate_ms     = observed_ms;
        }
        if (r.space == MbFunc::ReadInput && r.offset == 37 && !mb_is_special(raw) && raw <= 1) {
            gates.space_route_known  = true;
            gates.space_route_active = raw == 0;
            gates.space_route_ms     = observed_ms;
        }
        if (r.space == MbFunc::ReadInput && r.offset == 38 && !mb_is_special(raw) &&
            (raw == 1 || raw == 2 ||
             (raw == 0 && r.kind == def::HomeHubValueKind::Altherma4CurrentOperationMode))) {
            gates.heating_mode_known  = true;
            gates.heating_mode_active = raw == 1;
            gates.heating_mode_ms     = observed_ms;
        }
        // Input 44's 40..45 batch is explicitly selected on every fast cycle by modbus_plan.hpp.
        // Decode the exact reply word here; the current-session half of freshness is applied after
        // the sweep, once it is known. It remains context only — selecting the batch is not a gate.
        if (r.space == MbFunc::ReadInput && r.offset == 44) {
            MbValue decoded;
            if (def::homehub_decode(r, raw, decoded)) {
                outdoor_row_answered  = true;
                outdoor_temperature_c = decoded.value;
                plant_outdoor_ms      = observed_ms;
            }
        }
        if (!full) return;
        // A provisional EKRHH decode cannot distinguish Quiet activity from native selection.
        if (r.space == MbFunc::ReadHolding && r.offset == 9 &&
            r.kind != def::HomeHubValueKind::Altherma4QuietSelection)
            return;
        CachedValue cv;
        cv.label = r.label;
        cv.unit  = r.unit;
        // The synthetic page, never the EKRHH offset: those collide with real X10A page numbers
        // (offset 16 == page 0x10). `off` carries the true offset, which is what
        // logic/homehub_map.hpp pairs on and what /values emits as the concept.
        cv.reg               = def::HOMEHUB_GROUP_REG;
        cv.off               = static_cast<uint8_t>(r.offset);
        cv.modbus_definition = def::homehub_definition_id(r);
        // Software profile selection cannot attest the gateway's physical flow divisor.
        cv.modbus_flow_scale_unverified = r.space == MbFunc::ReadInput && r.offset == 49;
        // conv only TYPES the value downstream (conv_is_binary for /values, published_kind for
        // MQTT). No X10A decode runs here — homehub_format already produced the string — so these
        // are BORROWED kinds, not claims that a HomeHub register is an X10A one: 204 for the Text16
        // error code, and a bit-flag id for a register the catalog marks Binary, which is
        // what makes /values emit `"binary":true` so the browser renders ON/OFF instead of a
        // bare 1. Named enums keep their raw numeric Modbus constants and deliberately carry no
        // binary marker. /values adds their semantic enum id separately, so the visual UI can name
        // them without turning MQTT's mode 2 into the text "Recommended on". API/MQTT resolve the
        // snapshot's definition token, including mixed base/probe sweeps. They never borrow a
        // different profile's row at the same offset.
        cv.conv = (r.type == MbType::Text16) ? 204 : def::homehub_is_binary(r) ? 300 : 0;
        cv.held = false; // no held-over concept on this link
        char buf[24];
        if (def::homehub_format(r, raw, buf, sizeof(buf))) cv.value = buf;
        const uint32_t bucket = logic::history_bucket(observed_ms * 1000);
        if (fresh.empty()) first_history_bucket = bucket;
        if (bucket == first_history_bucket) history_split = fresh.size() + 1;
        fresh.push_back(std::move(cv));
    };

    // One buffer for the whole sweep, declared where the RESPONSES are read rather than inside
    // mb_read: the response borrows these bytes (see MbRead), so they have to outlive the call that
    // filled them. Hoisted out of the loop because it is 260 bytes on a 6 KB task stack — reused,
    // not re-created per batch.
    MbRead io;
    bool   link_broken = false; // a transport/framing failure ended the stream

    const ModbusProfile    cur_prof      = s_active_profile.load(std::memory_order_acquire);
    const bool             use_altherma4 = (cur_prof == ModbusProfile::Altherma4);
    const int              plan_count    = use_altherma4 ? MB_PLAN_ALTHERMA4.count : MB_PLAN.count;
    const logic::MbBatch*  plan_batches  = use_altherma4 ? MB_PLAN_ALTHERMA4.batch : MB_PLAN.batch;
    const uint8_t*         plan_orders   = use_altherma4 ? MB_PLAN_ALTHERMA4.order : MB_PLAN.order;
    const def::HomeHubReg* active_regs   = use_altherma4 ? def::ALTHERMA4_REGS : def::HOMEHUB_REGS;

    // Read the rows of one batch one register at a time. The fallback path, and the whole path for
    // a single-register batch. `break`s on anything but an exception, for the reason the batch loop
    // does: every other failure closed or desynced the stream, so continuing would only overwrite
    // the original cause with "not connected".
    const auto read_singly = [&](const logic::MbBatch& b) {
        for (uint8_t k = 0; k < b.count; k++) {
            const def::HomeHubReg& r   = active_regs[plan_orders[b.row_first + k]];
            uint16_t               pdu = 0;
            if (!mb_pdu_address(r.offset, pdu)) continue;
            MbFailure failure;
            if (!mb_read(r.space, pdu, 1, io, failure)) {
                failure.reg = r.offset;
                note_failure(failure);
                if (failure.type != MbFailureType::Exception) {
                    link_broken = true;
                    return;
                }
                continue; // an exception is about THIS register only
            }
            uint16_t raw = 0;
            if (!mb_reg_at(io.resp, 0, raw)) {
                first_failure = MbFailure{MbFailureType::InvalidResponse,
                                          static_cast<int>(MbParse::Malformed), r.offset};
                close_sock();
                {
                    Lock lk(s_mtx);
                    s_status.connected = false;
                }
                link_broken = true;
                return;
            }
            gates.received_data = true;
            take_row(r, raw, io.observed_ms);
        }
    };

    for (int bi = 0; bi < plan_count && !link_broken; bi++) {
        const logic::MbBatch& b = plan_batches[bi];
        if (!full && !logic::mb_batch_is_fast(b)) continue;
        esp_task_wdt_reset(); // each request is a bounded LAN round-trip

        if (b.count <= 1 || s_batch_split[bi]) {
            read_singly(b);
            continue;
        }

        uint16_t pdu = 0;
        if (!mb_pdu_address(b.first_offset, pdu)) {
            read_singly(b);
            continue;
        }
        MbFailure failure;
        if (!mb_read(b.space, pdu, b.count, io, failure)) {
            failure.reg = b.first_offset;
            if (failure.type != MbFailureType::Exception) {
                note_failure(failure);
                link_broken = true;
                continue;
            }
            // An exception is a valid reply about ONE register, and a batched request cannot say
            // which. Re-read this run singly — this cycle and, since the usual cause is a register
            // this hub simply does not implement, every cycle of this session. The exception itself
            // is NOT recorded here: the single reads are about to reproduce it against the register
            // it actually belongs to, which is the one worth naming on /status.
            s_batch_split[bi] = true;
            diag_printf(
                "modbus: batch %u..%u answered an exception — reading it register by register\n",
                static_cast<unsigned>(b.first_offset),
                static_cast<unsigned>(b.first_offset + b.count - 1));
            read_singly(b);
            continue;
        }
        for (uint8_t k = 0; k < b.count; k++) {
            const def::HomeHubReg& r   = active_regs[plan_orders[b.row_first + k]];
            uint16_t               raw = 0;
            if (!mb_reg_at(io.resp, k, raw)) {
                // The parse already bound the reply to the requested quantity, so this is a
                // contradiction rather than a short reply — treat it exactly as the single-read
                // path does and drop the stream.
                first_failure = MbFailure{MbFailureType::InvalidResponse,
                                          static_cast<int>(MbParse::Malformed), r.offset};
                close_sock();
                {
                    Lock lk(s_mtx);
                    s_status.connected = false;
                }
                link_broken = true;
                break;
            }
            gates.received_data = true;
            take_row(r, raw, io.observed_ms);
        }
    }

    // Extended capability probe: when running in Auto or when periodic backoff has elapsed,
    // probe a single extended register (MODBUS_PROBE_REGISTER = 79, Water pressure) at the end of
    // each full cycle.
    const uint32_t now_s = static_cast<uint32_t>(esp_timer_get_time() / 1000000ULL);
    const bool can_probe = (cur_prof == ModbusProfile::Auto) || s_probe_tracker.should_probe(now_s);

    bool profile_promoted = false;
    if (full && can_probe && !link_broken && s_sock >= 0) {
        uint16_t probe_pdu = 0;
        if (mb_pdu_address(logic::MODBUS_PROBE_REGISTER, probe_pdu)) {
            MbFailure probe_failure;
            if (mb_read(MbFunc::ReadInput, probe_pdu, 1, io, probe_failure, /*is_probe=*/true)) {
                uint16_t raw = 0;
                if (mb_reg_at(io.resp, 0, raw)) {
                    auto decision = s_probe_tracker.evaluate_probe(
                        logic::MbFailureType::None, 0, logic::MODBUS_PROBE_REGISTER, raw, now_s);
                    if (decision.is_definitive) {
                        s_active_profile.store(decision.next_profile, std::memory_order_release);
                        if (decision.next_profile == ModbusProfile::Altherma4) {
                            profile_promoted = cur_prof != ModbusProfile::Altherma4;
                            if (profile_promoted) {
                                // The baseline was decoded as EKRHH. Do not publish its
                                // profile-sensitive enums/labels or quiet activity after learning
                                // this target is native.
                                fresh.clear();
                                history_split = 0;
                                for (bool& split : s_batch_split) split = false;
                            }
                            diag_printf(
                                "modbus: detected Altherma 4 profile via probe register %u\n",
                                static_cast<unsigned>(logic::MODBUS_PROBE_REGISTER));
                            if (const def::HomeHubReg* pr =
                                    def::altherma4_find(logic::MODBUS_PROBE_REGISTER)) {
                                take_row(*pr, raw, io.observed_ms);
                            }
                        } else {
                            diag_printf("modbus: probe register %u answered %u — selected HomeHub "
                                        "profile%s\n",
                                        static_cast<unsigned>(logic::MODBUS_PROBE_REGISTER),
                                        static_cast<unsigned>(raw),
                                        decision.is_affirmative ? " (affirmative)" : " (fallback)");
                        }
                    }
                }
            } else {
                probe_failure.reg = logic::MODBUS_PROBE_REGISTER;
                auto decision =
                    s_probe_tracker.evaluate_probe(probe_failure.type, probe_failure.detail,
                                                   logic::MODBUS_PROBE_REGISTER, 0, now_s);
                if (decision.is_definitive) {
                    s_active_profile.store(decision.next_profile, std::memory_order_release);
                    for (bool& split : s_batch_split) split = false;
                    diag_printf("modbus: probe register %u concluded %s (type %d / detail %d%s)\n",
                                static_cast<unsigned>(logic::MODBUS_PROBE_REGISTER),
                                decision.next_profile == ModbusProfile::HomeHub ? "HomeHub"
                                                                                : "Altherma4",
                                static_cast<int>(probe_failure.type), probe_failure.detail,
                                decision.is_affirmative ? ", affirmative" : ", fallback");
                }
                if (!decision.link_ok) {
                    close_sock();
                    {
                        Lock lk(s_mtx);
                        s_status.connected = false;
                    }
                    link_broken = true;
                }
                if (decision.count_failure) {
                    note_failure(probe_failure);
                }
            }
        }
    }

    bool current_session = false;
    bool bind_history    = false;
    {
        Lock lk(s_mtx);
        // The task owns the socket and generation, so this answer cannot change before the cache
        // commit below. Resolve it while `fresh` is still available to the history recorder.
        current_session =
            s_have_req && s_link_generation == cycle_generation &&
            s_target_generation.load(std::memory_order_acquire) == cycle_target_generation;
        bind_history = current_session && s_req_history_generation == 0 && gates.received_data &&
                       s_last_reply_ms >= 0;
    }
    const logic::OutdoorEvidence plant_outdoor = logic::outdoor_homehub_evidence(
        outdoor_row_answered, current_session, outdoor_temperature_c);
    // A provisional socket can qualify only through a completed ordinary read. Retry a contended
    // bind at the normal poll cadence.
    if (bind_history &&
        s_target_generation.load(std::memory_order_acquire) == cycle_target_generation)
        s_req_history_generation = history_modbus_bind_peer(
            s_req_configured_target, s_req_peer_ipv4, s_req_history_expected_generation);
    // A FAST CYCLE COMMITS NO VALUE CACHE. Publishing its subset would hand the trend rings a
    // bucket in which every full-only row looks like a failure to read. The cache and the rings
    // stay with the last FULL cycle. Its age
    // includes both poll delays and bounded requests — and `values`/`connected` below still report
    // this cycle's link, so a hub that went away is visible within a second rather than within a
    // cadence.
    if (!full) {
        bool final_current_session = false;
        {
            Lock lk(s_mtx);
            final_current_session =
                s_have_req && s_link_generation == cycle_generation &&
                s_target_generation.load(std::memory_order_acquire) == cycle_target_generation;
            // Not `committed`: nothing was. A LIVE session keeps the count of the last full cycle,
            // because the rows it counts are still the rows /values will serve. A session that
            // ended reports 0 for the same reason the full path does — the cache is about to go
            // with it.
            if (!final_current_session) {
                s_status.values        = 0;
                s_full_cache_status_ms = -1;
            }
            s_status.connected = final_current_session;
            s_poll_observed    = final_current_session;
            if (s_target_generation.load(std::memory_order_acquire) == cycle_target_generation) {
                s_status.profile       = s_active_profile.load(std::memory_order_relaxed);
                s_status.profile_basis = s_probe_tracker.profile_basis;
            }
            s_status.plant_gate_known    = final_current_session && gates.plant_gate_known;
            s_status.plant_gate_active   = final_current_session && gates.plant_gate_active;
            s_status.space_route_known   = final_current_session && gates.space_route_known;
            s_status.space_route_active  = final_current_session && gates.space_route_active;
            s_status.heating_mode_known  = final_current_session && gates.heating_mode_known;
            s_status.heating_mode_active = final_current_session && gates.heating_mode_active;
            s_status.plant_outdoor =
                final_current_session ? plant_outdoor : logic::OutdoorEvidence{};
            s_plant_gate_ms              = final_current_session ? gates.plant_gate_ms : -1;
            s_space_route_ms             = final_current_session ? gates.space_route_ms : -1;
            s_heating_mode_ms            = final_current_session ? gates.heating_mode_ms : -1;
            s_dhw_operation_ms           = final_current_session ? gates.dhw_operation_ms : -1;
            s_status.dhw_operation_known = s_dhw_operation_ms >= 0;
            s_status.dhw_operation_active =
                s_status.dhw_operation_known && gates.dhw_operation_active;
            s_plant_outdoor_ms = final_current_session ? plant_outdoor_ms : -1;
            s_compressor    = final_current_session ? gates.compressor : ModbusCompressor::Unknown;
            s_compressor_ms = final_current_session ? gates.compressor_ms : -1;
        }
        report_cycle_result(first_failure, full, final_current_session, cycle_target_generation);
        s_cycle_tick++;
        return false;
    }

    // Re-check immediately before committing the two externally visible stores. If /set_hp landed
    // after the session check, its generation/history-identity changes make both commits refuse the
    // old target rather than presenting A as the first sample of B.
    if (s_target_generation.load(std::memory_order_acquire) != cycle_target_generation)
        current_session = false;
    if (s_req_history_generation) {
        constexpr int64_t bucket_us  = static_cast<int64_t>(logic::HISTORY_DT_S) * 1000000;
        const uint32_t    now_bucket = logic::history_bucket(esp_timer_get_time());
        // A bounded full sweep takes less than one raster period. If the task was delayed beyond
        // that bound, keep the live cache and book a history gap instead of guessing reply slots.
        if (current_session && history_split && now_bucket - first_history_bucket <= 1) {
            history_record_modbus(fresh.data(), history_split, s_req_history_generation,
                                  first_history_bucket * bucket_us);
            if (now_bucket != first_history_bucket)
                history_record_modbus(fresh.data() + history_split, fresh.size() - history_split,
                                      s_req_history_generation, now_bucket * bucket_us);
        } else {
            history_record_modbus(nullptr, 0, s_req_history_generation);
        }
    }

    const int     committed       = static_cast<int>(fresh.size());
    const int64_t cache_commit_ms = esp_timer_get_time() / 1000;
    {
        Lock lk(s_cache_mtx);
        // Re-check while owning the store. If /set_hp bumped the target before waiting for this
        // lock, refuse the old buffer; if it bumps afterwards, mb_reconfigure waits and clears it
        // itself.
        if (s_target_generation.load(std::memory_order_acquire) == cycle_target_generation) {
            s_cache            = std::move(fresh); // move-assign: steals the buffer, cannot throw
            s_cache_generation = cycle_generation;
            s_cache_target_generation  = cycle_target_generation;
            s_cache_history_generation = s_req_history_generation;
            s_cache_commit_ms          = cache_commit_ms;
            s_mb_cache_revision.fetch_add(1, std::memory_order_release);
        } else {
            s_cache.clear();
            s_cache_generation         = 0;
            s_cache_target_generation  = 0;
            s_cache_history_generation = 0;
            s_cache_commit_ms          = -1;
            s_mb_cache_revision.fetch_add(1, std::memory_order_release);
        }
    }
    bool final_current_session = false;
    {
        Lock lk(s_mtx);
        // rx_ok/rx_fail are NOT touched here: mb_read already counts every read as it happens, and
        // a second tally added on top double-counted every successful one — a counter with two
        // owners is a counter nobody can reason about. There is no per-cycle tally at all now.
        //
        // `values` is the size of the cache just COMMITTED, not the catalog size and not the read
        // count. It answers "how many rows does this link have right now", so a partly-answering
        // hub reports the truth and a dropped link reports 0 (set in the failed-connect path above)
        // instead of the number of registers we would LIKE to have. Deliberately the COMMITTED size
        // rather than a count of successful reads: a read can succeed and still yield no row (a
        // reply whose register word does not extract), so a read count over-reports by exactly the
        // rows nobody can see. Same quantity hp_stats().values reports for the X10A cache.
        // Only a poll that still owns the current open socket can publish this session as live. A
        // framing/transport failure closes it in mb_read and keeps connected=false; Modbus
        // exception replies leave the socket open and commit the rows that really answered.
        final_current_session =
            s_have_req && s_link_generation == cycle_generation &&
            s_target_generation.load(std::memory_order_acquire) == cycle_target_generation;
        s_status.values    = final_current_session ? committed : 0;
        s_status.connected = final_current_session;
        s_poll_observed    = final_current_session;
        if (s_target_generation.load(std::memory_order_acquire) == cycle_target_generation) {
            s_status.profile       = s_active_profile.load(std::memory_order_relaxed);
            s_status.profile_basis = s_probe_tracker.profile_basis;
        }
        s_status.plant_gate_known    = final_current_session && gates.plant_gate_known;
        s_status.plant_gate_active   = final_current_session && gates.plant_gate_active;
        s_status.space_route_known   = final_current_session && gates.space_route_known;
        s_status.space_route_active  = final_current_session && gates.space_route_active;
        s_status.heating_mode_known  = final_current_session && gates.heating_mode_known;
        s_status.heating_mode_active = final_current_session && gates.heating_mode_active;
        s_status.plant_outdoor = final_current_session ? plant_outdoor : logic::OutdoorEvidence{};
        s_full_cache_status_ms = final_current_session ? cache_commit_ms : -1;
        s_plant_gate_ms        = final_current_session ? gates.plant_gate_ms : -1;
        s_space_route_ms       = final_current_session ? gates.space_route_ms : -1;
        s_heating_mode_ms      = final_current_session ? gates.heating_mode_ms : -1;

        s_dhw_operation_ms            = final_current_session ? gates.dhw_operation_ms : -1;
        s_status.dhw_operation_known  = s_dhw_operation_ms >= 0;
        s_status.dhw_operation_active = s_status.dhw_operation_known && gates.dhw_operation_active;

        s_plant_outdoor_ms = final_current_session ? plant_outdoor_ms : -1;
        s_compressor       = final_current_session ? gates.compressor : ModbusCompressor::Unknown;
        s_compressor_ms    = final_current_session ? gates.compressor_ms : -1;
    }
    report_cycle_result(first_failure, full, final_current_session, cycle_target_generation);
    s_cycle_tick = profile_promoted ? 0 : s_cycle_tick + 1;
    return final_current_session && committed > 0 && !profile_promoted;
}

static void mb_record_poll_gap() {
    // No Config or formatted error allocation on an OOM path. An incomplete full sweep can have
    // received replies before it threw; those replies prove a socket, not a refreshed value map.
    Lock lk(s_mtx);
    s_poll_observed = false;
}

// Retire on the owner task. A save racing cleanup can reuse this same stack after
// the socket and cache have crossed the disable boundary.
static bool mb_retire_if_disabled(bool ready) {
    {
        Lock lk(s_mtx);
        if (!s_task_retiring && s_target_enabled.load(std::memory_order_acquire)) return false;
        s_task_retiring  = true;
        s_status.enabled = false;
    }
    if (!close_sock()) {
        status_error("close_pending", "waiting for HomeHub socket cleanup", errno, 0, true, 0);
        return false;
    }
    diag_printf("modbus: HomeHub disabled by empty configuration — connection closed\n");
    status_target(std::string(), 0, 0, false);
    {
        Lock lk(s_mtx);
        s_status.values = 0;
        s_last_reply_ms = -1;
        s_poll_observed = false;
        reset_observation_times_locked();
        s_ota_quiesced.store(false, std::memory_order_release);
        if (!s_target_enabled.load(std::memory_order_acquire)) return true;
        s_task_retiring  = false;
        s_status.enabled = ready;
    }
    return false;
}

// Verify both task-local lwIP state and watchdog registration before touching the network.
static bool mb_admit_worker(bool& lwip_ready, TaskFailureEpisode& failures) noexcept {
    if (!lwip_ready) {
        if (daikin_lwip_thread_sem_get() == nullptr) {
            if (failures.first_failure()) diag_printf("modbus: worker initialization pending\n");
            return false;
        }
        lwip_ready = true;
    }
    if (esp_task_wdt_add(nullptr) != ESP_OK) {
        if (failures.first_failure()) diag_printf("modbus: worker initialization pending\n");
        return false;
    }
    failures.succeeded();
    return true;
}

// Keep allocating poll work inside the task's exception boundary. The disabled source releases
// its socket, watchdog subscription and task stack.
static void mb_task(void*) {
    bool               ready               = false;
    bool               lwip_ready          = false;
    bool               first_sweep_pending = true;
    OtaQuiesceState    ota_quiesce;
    bool               ota_quiesce_logged     = false;
    bool               ota_quiesce_cap_logged = false;
    TaskFailureEpisode failures;
    for (;;) {
        if (ready) esp_task_wdt_reset();
        // Moved here from the end of the loop when the original four watched stacks got one sampler
        // (stack_watch.hpp): behaviourally identical, since the FreeRTOS mark is retrospective, and
        // it now sits at the same loop boundary — above the `break` that retires this task, so the
        // last cycle before a HomeHub is disabled is recorded like every other.
        stack_watch_sample(StackWatch::Modbus);
        // /set_hp withdraws the old observations before this worker closes its socket.
        // TCP close can allocate a FIN segment. Use the same network claim as a poll and
        // wait out a TLS owner without copying Config or reactivating the old source.
        if (s_task_retiring || !s_target_enabled.load(std::memory_order_acquire)) {
            bool wait_for_tls = false;
            {
                const MbNetworkActivity network_activity;
                const bool              ota_active = ota_download_active();
                wait_for_tls                       = ota_active || weather_fetch_active();
                if (wait_for_tls) {
                    s_ota_quiesced.store(ota_active, std::memory_order_release);
                } else if (mb_retire_if_disabled(ready)) {
                    break;
                }
            }
            if (wait_for_tls || s_task_retiring) {
                vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));
                continue;
            }
            ota_quiesce        = {};
            ota_quiesce_logged = ota_quiesce_cap_logged = false;
            first_sweep_pending                         = true;
            failures.succeeded();
            continue;
        }

        const bool ota_active = ota_download_active();
        if (ota_quiesce_step(ota_quiesce, ota_active)) {
            s_ota_quiesced.store(true, std::memory_order_release);
            if (ready) esp_task_wdt_reset();
            if (!ota_quiesce_logged) {
                diag_printf("modbus: holding off sweeps during OTA\n");
                ota_quiesce_logged = true;
            }
            vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));
            continue;
        }
        s_ota_quiesced.store(false, std::memory_order_release);
        if (ota_quiesce_exhausted(ota_quiesce, ota_active)) {
            if (!ota_quiesce_cap_logged) {
                diag_printf(
                    "modbus: OTA hold-off budget spent after %u cycles, awaiting TLS release\n",
                    static_cast<unsigned>(OTA_QUIESCE_MAX_CYCLES));
                ota_quiesce_cap_logged = true;
            }
        } else {
            ota_quiesce_logged     = false;
            ota_quiesce_cap_logged = false;
        }

        if (weather_fetch_active()) {
            vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));
            continue;
        }
        {
            MbNetworkActivity network_activity;
            if (ota_download_active() || weather_fetch_active()) {
                // Recheck closes the opposite race if OTA or weather began right as we
                // claimed network activity. Exit scope immediately so MbNetworkActivity
                // destructor restores s_network_quiesced to true before the inter-cycle delay.
            } else if ((ready || (ready = mb_admit_worker(lwip_ready, failures))) &&
                       s_target_enabled.load(std::memory_order_acquire) && !ota_download_active() &&
                       !weather_fetch_active()) {
                if (s_reconfigure_reset.exchange(false, std::memory_order_acq_rel)) {
                    s_backoff.silent = 0;
                    s_next_try_us.store(0, std::memory_order_release);
                    first_sweep_pending = true;
                }
                bool enough_heap = true;
                if (first_sweep_pending) {
                    esp_task_wdt_reset();
                    // The stack, semaphore and watchdog have already claimed their memory.
                    // Recheck before the first socket and cache allocations.
                    constexpr size_t first_sweep_reserve =
                        HEAP_RECOVERY_BYTES + MB_FIRST_SWEEP_RESERVE;
                    enough_heap = heap_largest_internal_block() >= first_sweep_reserve &&
                                  heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL) >=
                                      first_sweep_reserve;
                    if (!enough_heap) {
                        if (close_sock()) {
                            Lock lk(s_mtx);
                            s_status.enabled   = false;
                            s_status.connected = false;
                            s_poll_observed    = false;
                            s_task_retry_us    = esp_timer_get_time() + 5 * 1000000;
                            break;
                        }
                        mb_record_poll_gap();
                        status_error("close_pending", "waiting for HomeHub socket cleanup", errno,
                                     0, true, s_target_generation.load(std::memory_order_acquire));
                    } else {
                        Lock lk(s_mtx);
                        s_mb_task_running.store(true, std::memory_order_release);
                        s_status.enabled = true;
                    }
                }
                try {
                    if (enough_heap && esp_timer_get_time() >= s_next_try_us) {
                        if (mb_poll_once()) first_sweep_pending = false;
                        failures.succeeded();
                    }
                } catch (const std::exception& e) {
                    // Keep the allocation guard allocation-free: constructing the UI error itself
                    // can throw when the exception was std::bad_alloc. Transport/protocol failures
                    // take the structured status_error() path before reaching this last-resort
                    // guard.
                    mb_record_poll_gap();
                    if (first_sweep_pending) s_next_try_us = esp_timer_get_time() + 5 * 1000000;
                    if (failures.first_failure())
                        diag_printf("modbus: cycle skipped (%s)\n", e.what());
                } catch (...) {
                    mb_record_poll_gap();
                    if (first_sweep_pending) s_next_try_us = esp_timer_get_time() + 5 * 1000000;
                    if (failures.first_failure()) diag_printf("modbus: cycle skipped (oom?)\n");
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_S * 1000));
    }
    if (ready) esp_task_wdt_delete(nullptr);
    {
        // The network claim has ended. Keep the old handle until this point so a new worker
        // cannot claim the network before the old worker has published quiescence.
        Lock lk(s_mtx);
        s_mb_task_running.store(false, std::memory_order_release);
        s_task_retiring = false;
        s_task          = nullptr;
    }
    vTaskDelete(nullptr);
}

// Create the task if the HomeHub is enabled and it is not already running. 6144, not hp_poll's 8192
// and not the 4096 the other diag_printf tasks take: this task runs getaddrinfo()/mdns_query_*()
// and the socket calls directly on its own stack, and syslog.cpp has already measured that same
// chain at 6144 with the note "4096 is too thin for that call chain". Its own locals are small (a
// 260 B ADU, a 23-row vector) — nothing like the /status builder that drove hp_poll's sizing. Start
// only when a persistent address is configured. Empty means no task, no browse, no requests.
static void mb_task_start_if_enabled() noexcept {
    if (!s_start_allowed.load(std::memory_order_acquire) ||
        !s_target_enabled.load(std::memory_order_acquire))
        return;
    bool alloc_failed = false;
    {
        Lock lk(s_mtx);
        if (s_task || !s_target_enabled.load(std::memory_order_acquire)) return;
        const int64_t now_us = esp_timer_get_time();
        if (now_us < s_task_retry_us) return;
        const MbTaskCreation creation;
        // Announce before rereading the TLS owners. Their quiescence checks observe this claim.
        if (ota_download_active() || weather_fetch_active()) return;
        // All startup allocations may come from the same extent. Leave recovery headroom
        // after the stack, TCB, semaphore, watchdog entry and initial sweep.
        constexpr size_t stack_bytes          = 6144;
        constexpr size_t worker_setup_reserve = sizeof(StaticTask_t) + 4096;
        constexpr size_t startup_reserve = stack_bytes + worker_setup_reserve + HEAP_RECOVERY_BYTES;
        const size_t free_bytes = heap_caps_get_free_size(MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
        if (heap_largest_internal_block() < startup_reserve || free_bytes < startup_reserve) {
            s_task_retry_us = now_us + 5 * 1000000;
            return;
        }
        s_backoff.silent = 0;
        s_next_try_us    = 0;
        if (xTaskCreate(mb_task, "hp_modbus", stack_bytes, nullptr, TASK_PRIO_MODBUS, &s_task) !=
            pdPASS) {
            s_task          = nullptr;
            s_task_retry_us = now_us + 5 * 1000000;
            alloc_failed    = true;
        }
    }
    // Logged OUTSIDE s_mtx — the rule status_error() in this file states and enforces for exactly
    // this reason ("logging while holding s_mtx would invert the status/diag mutex order and invite
    // a deadlock"). No deadlock is reachable today, since nothing takes the diag mutex and then
    // this one, but a convention that holds everywhere except the failure path is not a convention.
    if (alloc_failed) diag_printf("modbus: task alloc failed — HomeHub polling unavailable\n");
}

bool mb_network_quiesced() { return !s_start_in_flight.load() && s_network_quiesced.load(); }

bool mb_target_enabled() noexcept { return s_target_enabled.load(std::memory_order_acquire); }

void mb_retry_start() noexcept {
    if (s_mtx && s_cache_mtx) mb_task_start_if_enabled();
}

bool mb_task_pending() noexcept {
    if (!s_mtx || !s_cache_mtx) return true;
    Lock lk(s_mtx);
    return !s_task || !s_status.enabled || s_task_retiring;
}

void mb_init() {
    // The mutexes exist even when the stack does not, so /status can answer `enabled:false` rather
    // than an empty object before any task is created.
    if (!s_mtx) s_mtx = xSemaphoreCreateMutexStatic(&s_mtx_storage);
    if (!s_cache_mtx) s_cache_mtx = xSemaphoreCreateMutexStatic(&s_cache_mtx_storage);
    if (!s_mtx || !s_cache_mtx) {
        diag_printf("modbus: mutex initialization failed — HomeHub stack disabled this boot\n");
        return;
    }
    // Discovery may have saved a target since boot took its first Config snapshot.
    const bool enabled = with_config([](const Config& c) { return config_modbus_enabled(c); });
    s_target_enabled.store(enabled, std::memory_order_release);
}

void mb_start() {
    s_start_allowed.store(true, std::memory_order_release);
    mb_retry_start();
}

void mb_reconfigure(bool enabled) noexcept {
    if (!s_mtx || !s_cache_mtx) return;
    {
        // Generation and every target-bound status fact change under ONE lock. If an old poll owns
        // it first, this clear runs after its commit; if this request owns it first, every guarded
        // writer observes the new generation and refuses. There is no interval in which readers can
        // observe generation B with target A's connected/gates/error state.
        Lock     lk(s_mtx);
        uint32_t next = s_target_generation.load(std::memory_order_relaxed) + 1;
        if (next == 0) next = 1; // zero remains the pre-init/no-target sentinel
        s_target_generation.store(next, std::memory_order_release);
        clear_status_error_locked();
        s_status.connected = false;
        s_last_reply_ms    = -1;
        s_poll_observed    = false;
        reset_observation_times_locked();
        s_status.profile             = ModbusProfile::Auto;
        s_status.profile_basis       = ModbusProfileBasis::Probing;
        s_status.values              = 0;
        s_status.plant_gate_known    = false;
        s_status.plant_gate_active   = false;
        s_status.space_route_known   = false;
        s_status.space_route_active  = false;
        s_status.heating_mode_known  = false;
        s_status.heating_mode_active = false;
        s_status.plant_outdoor       = logic::OutdoorEvidence{};
    }
    {
        // Release the previous target's cache before its worker needs memory for socket cleanup.
        std::vector<CachedValue> invalidated_cache;
        Lock                     lk(s_cache_mtx);
        s_cache.swap(invalidated_cache);
        s_cache_generation         = 0;
        s_cache_target_generation  = 0;
        s_cache_history_generation = 0;
        s_cache_commit_ms          = -1;
        s_mb_cache_revision.fetch_add(1, std::memory_order_release);
    }
    s_next_try_us.store(0, std::memory_order_release);
    s_reconfigure_reset.store(true, std::memory_order_release);
    s_target_enabled.store(enabled, std::memory_order_release);
    mb_task_start_if_enabled();
    // Clearing the address is handled BY the task: its allocation-free atomic target flag is read
    // at the top of each cycle and retires it without another fallible Config snapshot. Nothing is
    // torn down from the httpd task here — the socket has exactly one owner and it stays that way.
}

size_t mb_values_capacity() { return static_cast<size_t>(def::ALTHERMA4_REG_COUNT); }

ModbusProfile mb_active_profile() {
    if (!s_mtx) return ModbusProfile::Auto;
    Lock lk(s_mtx);
    return s_status.profile;
}

size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live, uint32_t* history_generation,
                          ModbusActivity* activity) {
    live = false;
    if (history_generation) *history_generation = 0;
    if (activity) *activity = {};
    if (!s_cache_mtx) return 0;
    size_t   n                        = 0;
    uint32_t cache_generation         = 0;
    uint32_t cache_target_generation  = 0;
    uint32_t cache_history_generation = 0;
    uint32_t cache_age_s              = 0;
    uint32_t target_generation        = 0;
    {
        Lock lk(s_cache_mtx);
        n = s_cache.size() < max ? s_cache.size() : max;
        for (size_t i = 0; i < n; i++) out[i] = s_cache[i];
        cache_generation         = s_cache_generation;
        cache_target_generation  = s_cache_target_generation;
        cache_history_generation = s_cache_history_generation;
        cache_age_s =
            logic::modbus_observation_age_s(s_cache_commit_ms, esp_timer_get_time() / 1000);
    }
    // The link is re-read AFTER the copy, and that order is what makes the payload invariant TRUE
    // rather than merely intended. The cache and the link state sit behind two different mutexes,
    // so a caller that checks `connected` and then copies has a window: mb_read can mark the link
    // down in between and the response still carries the previous session's last full-cycle rows as
    // though they belonged to a live session.
    //
    // Reading it afterwards closes the disconnect window without nesting the two locks. Comparing
    // generations closes the opposite RECONNECT window as well: if this copy came from session N
    // and session N+1 commits between the copy and this status read, connected may already be true
    // again, but the generations differ and the caller still omits these old rows.
    {
        Lock lk(s_mtx);
        target_generation          = s_target_generation.load(std::memory_order_acquire);
        const uint32_t reply_age_s = mb_reply_age_locked();
        live = logic::modbus_cache_is_live(s_status.connected && s_poll_observed, s_link_generation,
                                           cache_generation, target_generation,
                                           cache_target_generation, cache_age_s, MB_CACHE_MAX_AGE_S,
                                           reply_age_s, MB_REPLY_MAX_AGE_S);
        if (activity && s_status.connected && s_poll_observed &&
            reply_age_s <= MB_REPLY_MAX_AGE_S) {
            const int64_t now_ms = esp_timer_get_time() / 1000;
            if (logic::modbus_observation_age_s(s_compressor_ms, now_ms) <= MB_REPLY_MAX_AGE_S)
                activity->compressor = s_compressor;
            if (s_status.dhw_operation_known &&
                logic::modbus_observation_age_s(s_dhw_operation_ms, now_ms) <= MB_REPLY_MAX_AGE_S)
                activity->dhw = s_status.dhw_operation_active;
            if (s_status.plant_gate_known &&
                logic::modbus_observation_age_s(s_plant_gate_ms, now_ms) <= MB_REPLY_MAX_AGE_S)
                activity->space = s_status.plant_gate_active;
        }
    }
    // Seqlock-style retry boundary: a target change overlapping the two-lock snapshot is never
    // live.
    if (target_generation != s_target_generation.load(std::memory_order_acquire)) {
        live = false;
        if (activity) *activity = {};
    }
    if (history_generation && live && cache_history_generation == history_modbus_generation())
        *history_generation = cache_history_generation;
    return n;
}

bool mb_values_live() {
    // Same two-lock/generation/age decision as the copying accessor, without allocating a vector
    // merely to notice an expiry on the MQTT task's one-second tick.
    bool live = false;
    mb_values_snapshot(nullptr, 0, live);
    return live;
}

bool hp_modbus_ota_quiesced() {
    return !s_mb_task_running.load(std::memory_order_acquire) ||
           s_ota_quiesced.load(std::memory_order_acquire);
}

uint32_t mb_cache_generation() { return s_mb_cache_revision.load(std::memory_order_acquire); }

} // namespace daik
