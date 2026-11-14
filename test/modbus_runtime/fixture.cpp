// Execute the complete production HomeHub translation unit against SDK-shaped adapters.
// POSIX sockets are real; the optional transport clock model advances SDK time at syscall
// boundaries. See README.md for evidence limits. No copied transport, poll, status or task
// implementation.
#include "sdk.hpp"
#include "../history_modbus_target_stub.hpp"
#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdarg>
#include <cstdlib>
#include <iostream>
#include <new>
#include <stdexcept>
#include <thread>
#include <array>
#include <functional>
#include <iterator>
#include <limits>
#include <unistd.h>
#ifndef HUB_PRODUCTION_SOURCE
#error "Compile this fixture against the complete current main/hp_modbus.cpp"
#endif
namespace sdk {
int connect_test_peer(int fd, const sockaddr* address, socklen_t length);
int set_socket_option(int fd, int level, int option, const void* value, socklen_t length);
int close_test_socket(int fd);
thread_local bool     fail_allocations     = false;
thread_local unsigned rejected_allocations = 0;
} // namespace sdk
void* operator new(std::size_t bytes) {
    if (sdk::fail_allocations) {
        ++sdk::rejected_allocations;
        throw std::bad_alloc();
    }
    if (void* ptr = std::malloc(bytes ? bytes : 1)) return ptr;
    throw std::bad_alloc();
}
void operator delete(void* ptr) noexcept { std::free(ptr); }
void operator delete(void* ptr, std::size_t) noexcept { std::free(ptr); }
#define connect sdk::connect_test_peer
#define setsockopt sdk::set_socket_option
#define close sdk::close_test_socket
#define send sdk::timed_send
#define recv sdk::timed_recv
#include HUB_PRODUCTION_SOURCE
#undef connect
#undef setsockopt
#undef close
#undef send
#undef recv

namespace sdk {
std::atomic<int64_t>  clock_us{1000000};
std::atomic<bool>     real_clock{false};
bool                  transport_time_model = false;
int64_t               send_delay_us = 0, receive_delay_us = 1499000;
mdns_result_t*        mdns_results         = nullptr;
bool                  discovery_time_model = false;
int                   mdns_a_calls         = 0;
std::function<void()> on_send;
std::vector<int64_t>  watchdog_feeds;
bool                  fail_task_create = false, fail_mutex_create = false;
unsigned              fail_wdt_add = 0, fail_lwip_alloc = 0, fail_lwip_retain = 0;
unsigned              lwip_gets = 0, lwip_frees = 0;
void*                 lwip_retained = nullptr;
int create_calls = 0, delete_calls = 0, delays = 0, wdt_add = 0, wdt_delete = 0, wdt_reset = 0,
    mdns_ptr_calls = 0;
std::vector<TaskHandle_t>      tasks;
std::vector<SemaphoreHandle_t> mutexes;
std::function<void()>          on_delay, on_wdt_add, on_wdt_delete, on_mutex_give;
thread_local int               lock_depth = 0;

esp_ip4_addr_t                               mdns_a_result{};
std::array<std::pair<uint32_t, uint16_t>, 2> tcp_peer_routes{};
int                                          fail_socket_option = 0;
unsigned                                     fail_socket_close  = 0;
unsigned                                     socket_connects    = 0;

int64_t time_us() {
    if (!real_clock.load()) return clock_us.load();
    return std::chrono::duration_cast<std::chrono::microseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
}
int connect_test_peer(int fd, const sockaddr* address, socklen_t length) {
    ++socket_connects;
    // Model two resolved peers with separate real TCP listeners on the single portable
    // IPv4 loopback address, including on macOS with no additional loopback aliases.
    if (address->sa_family == AF_INET && length == sizeof(sockaddr_in)) {
        const auto& target = *reinterpret_cast<const sockaddr_in*>(address);
        for (const auto& [peer_ipv4, listen_port] : tcp_peer_routes) {
            if (listen_port == 0 || peer_ipv4 != target.sin_addr.s_addr) continue;
            sockaddr_in local     = target;
            local.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
            local.sin_port        = htons(listen_port);
            return ::connect(fd, reinterpret_cast<const sockaddr*>(&local), sizeof(local));
        }
    }
    return ::connect(fd, address, length);
}
int set_socket_option(int fd, int level, int option, const void* value, socklen_t length) {
    if (option == fail_socket_option) {
        errno = ENOMEM;
        return -1;
    }
    return ::setsockopt(fd, level, option, value, length);
}
int close_test_socket(int fd) {
    if (fail_socket_close) {
        --fail_socket_close;
        errno = ENOMEM;
        return -1;
    }
    return ::close(fd);
}
ssize_t timed_send(int fd, const void* b, size_t n, int flags) {
    const auto result = ::send(fd, b, n, flags);
    if (transport_time_model) clock_us.fetch_add(send_delay_us);
    if (on_send) on_send();
    return result;
}
ssize_t timed_recv(int fd, void* b, size_t n, int flags) {
    const auto result = ::recv(fd, b, n, flags);
    if (transport_time_model && result > 0) clock_us.fetch_add(receive_delay_us);
    return result;
}
} // namespace sdk
namespace adapter {
daik::Config cfg;
std::mutex   config_mutex;
size_t       largest_block = 32 * 1024;
size_t       free_bytes    = 64 * 1024;
bool         config_throws = false, net_up = true, ota_active = false, weather_active = false;
int config_reads = 0, config_saves = 0, history_calls = 0, history_gaps = 0, stack_samples = 0;

uint32_t history_generation    = 1;
uint32_t history_peer          = 0;
bool     history_bind_busy     = false;
unsigned history_bind_attempts = 0;

std::function<void()> history_hook;

std::vector<std::string>       logs;
char                           pressure_log[512]{};
unsigned                       pressure_log_count = 0;
std::vector<daik::CachedValue> history_rows;
std::array<int64_t, 2>         history_reply_slots{};
std::array<bool, 2>            history_reply_heater{};
} // namespace adapter
std::size_t heap_caps_get_free_size(unsigned) { return adapter::free_bytes; }

namespace daik {
size_t heap_largest_internal_block() { return adapter::largest_block; }

Config config() {
    ++adapter::config_reads;
    if (adapter::config_throws) throw std::bad_alloc();
    return adapter::cfg;
}
bool config_save(const Config& c) {
    ++adapter::config_saves;
    adapter::cfg = c;
    return true;
}
// Every scenario here loads a usable stored blob; the kept-blob gate of the initial HomeHub search
// is pinned at source level by test/test_config_ownership_contract.mjs.
bool config_stored_blob_unreadable() { return false; }
namespace detail {
void          config_lock() { adapter::config_mutex.lock(); }
void          config_unlock() { adapter::config_mutex.unlock(); }
const Config& config_ref_locked() {
    ++adapter::config_reads;
    if (adapter::config_throws) throw std::bad_alloc();
    return adapter::cfg;
}
} // namespace detail
void diag_printf(const char* fmt, ...) {
    if (sdk::lock_depth != 0) throw std::runtime_error("diag logging under status/cache mutex");
    char    buf[512];
    va_list ap;
    va_start(ap, fmt);
    std::vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    // Production diagnostics use fixed buffers. The normal vector sink is test-only.
    if (sdk::fail_allocations) {
        std::snprintf(adapter::pressure_log, sizeof(adapter::pressure_log), "%s", buf);
        ++adapter::pressure_log_count;
    } else {
        adapter::logs.emplace_back(buf);
    }
}
bool                       net_is_up() { return adapter::net_up; }
bool                       ota_download_active() { return adapter::ota_active; }
bool                       weather_fetch_active() { return adapter::weather_active; }
void                       stack_watch_sample(StackWatch) noexcept { ++adapter::stack_samples; }
uint32_t                   history_modbus_generation() { return adapter::history_generation; }
void                       history_modbus_candidate(uint32_t) noexcept {}
logic::HistoryModbusTarget history_modbus_target(std::string_view host, int port,
                                                 int unit) noexcept {
    return fixture_port::history_modbus_target(host, port, unit);
}
void history_modbus_reset(const logic::HistoryModbusTarget&) noexcept {
    ++adapter::history_generation;
}
uint32_t history_modbus_bind_peer(const logic::HistoryModbusTarget&, uint32_t peer,
                                  uint32_t expected) noexcept {
    ++adapter::history_bind_attempts;
    if (adapter::history_bind_busy || !peer || expected != adapter::history_generation) return 0;
    if (peer != adapter::history_peer) {
        adapter::history_peer = peer;
        ++adapter::history_generation;
    }
    return adapter::history_generation;
}
void history_record_modbus(const CachedValue* v, size_t n, uint32_t gen, int64_t observed_us) {
    if (adapter::history_calls < 2) {
        const auto slot                    = static_cast<size_t>(adapter::history_calls);
        adapter::history_reply_slots[slot] = observed_us;
        for (size_t i = 0; i < n; ++i)
            if (v[i].off == 32 && v[i].value == "1") adapter::history_reply_heater[slot] = true;
    }
    ++adapter::history_calls;
    if (!v || !n || gen != adapter::history_generation) ++adapter::history_gaps;
    adapter::history_rows.clear();
    if (v && n && gen == adapter::history_generation) adapter::history_rows.assign(v, v + n);
    if (adapter::history_hook) adapter::history_hook();
}
} // namespace daik
namespace test {
#define REQUIRE(c)                                                                                 \
    do {                                                                                           \
        if (!(c))                                                                                  \
            throw std::runtime_error(std::string(__func__) + ":" + std::to_string(__LINE__) +      \
                                     ": " #c);                                                     \
    } while (0)
using namespace daik;
using daik::logic::MbFailure;
using daik::logic::MbFailureType;

void reset(bool fail_dynamic_mutex_create = false) {
    sdk::fail_allocations     = false;
    sdk::rejected_allocations = 0;
    sdk::on_delay             = {};
    sdk::on_wdt_add           = {};
    sdk::on_wdt_delete        = {};
    sdk::on_mutex_give        = {};
    sdk::on_send              = {};
    sdk::watchdog_feeds.clear();
    sdk::transport_time_model = false;
    sdk::send_delay_us        = 0;
    sdk::receive_delay_us     = 1499000;
    sdk::mdns_results         = nullptr;
    sdk::discovery_time_model = false;
    sdk::mdns_a_calls         = 0;
    sdk::mdns_a_result        = {};
    sdk::tcp_peer_routes      = {};
    sdk::fail_socket_option   = 0;
    sdk::fail_socket_close    = 0;
    sdk::socket_connects      = 0;
    close_sock();
    for (auto t : sdk::tasks) delete t;
    sdk::tasks.clear();
    for (auto m : sdk::mutexes) delete m;
    sdk::mutexes.clear();
    s_mtx       = nullptr;
    s_cache_mtx = nullptr;
    s_status    = ModbusStatus{};
    clear_status_error_locked();
    s_task                 = nullptr;
    s_task_retiring        = false;
    s_link_generation      = 0;
    s_last_reply_ms        = -1;
    s_poll_observed        = false;
    s_full_cache_status_ms = -1;
    s_plant_gate_ms        = -1;
    s_heating_mode_ms      = -1;
    s_space_route_ms       = -1;
    s_plant_outdoor_ms     = -1;
    s_compressor_ms        = -1;
    s_compressor           = ModbusCompressor::Unknown;
    s_req_host.clear();
    s_req_port                        = 0;
    s_unit                            = 0;
    s_have_req                        = false;
    s_req_target_generation           = 0;
    s_req_history_expected_generation = 0;
    s_req_history_generation          = 0;
    s_req_configured_target           = {};
    s_req_peer_ipv4                   = 0;
    s_txn                             = 0;
    s_cycle_tick                      = 0;
    s_cache.clear();
    s_cache_generation         = 0;
    s_cache_target_generation  = 0;
    s_cache_history_generation = 0;
    s_cache_commit_ms          = 0;
    s_target_generation        = 1;
    s_target_enabled           = false;
    s_start_allowed            = false;
    s_start_in_flight          = false;
    s_task_retry_us            = 0;
    s_mb_task_running          = false;
    s_ota_quiesced             = false;
    s_network_quiesced         = true;
    s_reconfigure_reset        = false;
    s_next_try_us              = 0;
    s_mb_cache_revision        = 1;
    s_active_profile           = ModbusProfile::Auto;
    s_probe_tracker            = logic::ModbusProbeTracker{};
    s_backoff                  = DetectBackoff{};
    for (bool& b : s_batch_split) b = false;
    sdk::clock_us         = 1000000;
    sdk::real_clock       = false;
    sdk::fail_task_create = false;
    sdk::fail_wdt_add = sdk::fail_lwip_alloc = sdk::fail_lwip_retain = 0;
    sdk::lwip_gets = sdk::lwip_frees = 0;
    std::free(sdk::lwip_retained);
    sdk::lwip_retained             = nullptr;
    sdk::fail_mutex_create         = fail_dynamic_mutex_create;
    sdk::create_calls              = 0;
    sdk::delete_calls              = 0;
    sdk::delays                    = 0;
    sdk::wdt_add                   = 0;
    sdk::wdt_delete                = 0;
    sdk::wdt_reset                 = 0;
    sdk::mdns_ptr_calls            = 0;
    sdk::lock_depth                = 0;
    adapter::cfg                   = Config{};
    adapter::config_throws         = false;
    adapter::largest_block         = 32 * 1024;
    adapter::free_bytes            = 64 * 1024;
    adapter::ota_active            = false;
    adapter::weather_active        = false;
    adapter::net_up                = true;
    adapter::config_reads          = 0;
    adapter::config_saves          = 0;
    adapter::history_calls         = 0;
    adapter::history_reply_slots   = {};
    adapter::history_reply_heater  = {};
    adapter::history_gaps          = 0;
    adapter::history_generation    = 1;
    adapter::history_peer          = 0;
    adapter::history_bind_busy     = false;
    adapter::history_bind_attempts = 0;
    adapter::stack_samples         = 0;
    adapter::history_hook          = {};
    adapter::logs.clear();
    adapter::pressure_log[0]    = '\0';
    adapter::pressure_log_count = 0;
    adapter::history_rows.clear();
    mb_init();
    mb_start();
    REQUIRE(s_mtx && s_cache_mtx);
    REQUIRE(sdk::create_calls == 0);
}
struct Pair {
    int a = -1, b = -1;
    Pair(int client, int server) : a(client), b(server) {}
    explicit Pair(int timeout_ms = 40) {
        int pair[2];
        if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) throw std::runtime_error("socketpair");
        a = pair[0];
        b = pair[1];
        timeval tv{timeout_ms / 1000, (timeout_ms % 1000) * 1000};
        REQUIRE(!setsockopt(a, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)));
        REQUIRE(!setsockopt(b, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)));
    }
    ~Pair() {
        if (a >= 0) close(a);
        if (b >= 0) close(b);
    }
};
struct TcpListener {
    int      fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    uint16_t port;
    TcpListener() {
        REQUIRE(fd >= 0);
        sockaddr_in address{};
        address.sin_family      = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        REQUIRE(::bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == 0);
        REQUIRE(listen(fd, 1) == 0);
        socklen_t length = sizeof(address);
        REQUIRE(getsockname(fd, reinterpret_cast<sockaddr*>(&address), &length) == 0);
        port = ntohs(address.sin_port);
    }
    ~TcpListener() { close(fd); }
    int accept_peer() const {
        const int accepted = accept(fd, nullptr, nullptr);
        REQUIRE(accepted >= 0);
        return accepted;
    }
};
std::vector<uint8_t> reply(uint16_t txn, uint8_t unit, uint8_t fc,
                           const std::vector<uint16_t>& words) {
    std::vector<uint8_t> r{
        uint8_t(txn >> 8),        uint8_t(txn), 0, 0, 0, uint8_t(3 + 2 * words.size()), unit, fc,
        uint8_t(2 * words.size())};
    for (auto w : words) {
        r.push_back(uint8_t(w >> 8));
        r.push_back(uint8_t(w));
    }
    return r;
}
void inject(Pair& p, const std::vector<uint8_t>& bytes) {
    REQUIRE(send(p.b, bytes.data(), bytes.size(), 0) == static_cast<ssize_t>(bytes.size()));
}
void bind(Pair& p) {
    s_sock             = p.a;
    p.a                = -1;
    s_unit             = 1;
    s_status.connected = true;
    s_poll_observed    = true;
}
void deadline() {
    reset();
    sdk::real_clock = true;
    Pair              p(80);
    std::atomic<bool> stop{false};
    std::thread       peer([&] {
        for (int i = 0; i < 20 && !stop; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            uint8_t b = uint8_t(i);
            if (send(p.b, &b, 1, 0) != 1) break;
        }
    });
    uint8_t           buf[20]{};
    MbFailure         failure;
    const auto        begin   = std::chrono::steady_clock::now();
    const bool        ok      = recv_all(p.a, buf, 20, sdk::time_us() + 120000, failure);
    const auto        elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - begin)
                             .count();
    stop = true;
    peer.join();
    REQUIRE(!ok);
    REQUIRE(failure.type == MbFailureType::ResponseTimeout);
    REQUIRE(elapsed >= 100 && elapsed < 3000);
    sdk::real_clock = false;
}
void receive_boundaries() {
    reset();
    sdk::real_clock = true;
    {
        Pair      p;
        uint8_t   b = 0;
        MbFailure f;
        REQUIRE(!recv_all(p.a, &b, 1, sdk::time_us() + 100000, f));
        REQUIRE(f.type == MbFailureType::ResponseTimeout);
        REQUIRE(f.detail == EAGAIN || f.detail == EWOULDBLOCK);
    }
    {
        Pair p;
        shutdown(p.b, SHUT_WR);
        uint8_t   b;
        MbFailure f;
        REQUIRE(!recv_all(p.a, &b, 1, sdk::time_us() + 100000, f));
        REQUIRE(f.type == MbFailureType::ConnectionClosed);
    }
    {
        Pair                 p;
        std::vector<uint8_t> data{0, 1, 0, 0, 0, 3, 1, 0x84, 2};
        std::thread          peer([&] {
            for (auto b : data) {
                REQUIRE(send(p.b, &b, 1, 0) == 1);
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
        });
        uint8_t              b[260]{};
        MbFailure            f;
        const int            n = recv_adu(p.a, b, sizeof(b), f);
        peer.join();
        REQUIRE(n == 9);
        REQUIRE(std::equal(data.begin(), data.end(), b));
    }
    for (uint16_t len : {uint16_t(0), uint16_t(1), uint16_t(255), uint16_t(65535)}) {
        Pair p;
        inject(p, {0, 1, 0, 0, uint8_t(len >> 8), uint8_t(len)});
        uint8_t   b[260]{};
        MbFailure f;
        REQUIRE(recv_adu(p.a, b, sizeof(b), f) == -1);
        REQUIRE(f.type == MbFailureType::InvalidResponse);
    }
    {
        Pair      p;
        uint8_t   b[6];
        MbFailure f;
        REQUIRE(recv_adu(p.a, b, sizeof(b), f) == -1);
        REQUIRE(f.type == MbFailureType::InvalidResponse);
    }
    {
        Pair p;
        inject(p, {0, 1, 0, 0, 0, 4, 1});
        shutdown(p.b, SHUT_WR);
        uint8_t   b[260];
        MbFailure f;
        REQUIRE(recv_adu(p.a, b, sizeof(b), f) == -1);
        REQUIRE(f.type == MbFailureType::ConnectionClosed);
    }
    sdk::real_clock = false;
}
void whole_adu_deadline() {
    reset();
    sdk::real_clock = true;
    Pair              p(300);
    std::atomic<bool> stop{false};
    const auto        bytes = reply(1, 1, 4, {0x1234});
    std::thread       peer([&] {
        for (auto b : bytes) {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            if (stop || send(p.b, &b, 1, 0) != 1) break;
        }
    });
    uint8_t           b[260];
    MbFailure         f;
    const auto        begin = std::chrono::steady_clock::now();
    const int         n     = recv_adu(p.a, b, sizeof(b), f);
    stop                    = true;
    peer.join();
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - begin)
                             .count();
    REQUIRE(n == -1);
    REQUIRE(f.type == MbFailureType::ResponseTimeout);
    REQUIRE(elapsed >= 1500 && elapsed < 10000);
    sdk::real_clock = false;
}
void read_success_lifetime() {
    for (auto fc : {MbFunc::ReadHolding, MbFunc::ReadInput}) {
        reset();
        Pair p;
        bind(p);
        inject(p, reply(1, 1, uint8_t(fc), {0x1234, 0xabcd}));
        MbRead    io;
        MbFailure f;
        REQUIRE(mb_read(fc, 52, 2, io, f));
        REQUIRE(s_status.rx_ok == 1);
        REQUIRE(s_status.rx_fail == 0);
        REQUIRE(io.resp.payload >= io.adu && io.resp.payload < io.adu + sizeof(io.adu));
        volatile uint8_t clobber[2048];
        for (size_t i = 0; i < sizeof(clobber); ++i) clobber[i] = uint8_t(i);
        uint16_t word = 0;
        REQUIRE(mb_reg_at(io.resp, 0, word) && word == 0x1234);
        REQUIRE(mb_reg_at(io.resp, 1, word) && word == 0xabcd);
        uint8_t request[12];
        REQUIRE(recv(p.b, request, sizeof(request), 0) == 12);
        REQUIRE(request[7] == uint8_t(fc));
        REQUIRE(request[7] == 3 || request[7] == 4);
    }
}
void transaction() {
    reset();
    Pair p;
    bind(p);
    inject(p, reply(2, 1, 4, {1}));
    MbRead    io;
    MbFailure f;
    REQUIRE(!mb_read(MbFunc::ReadInput, 52, 1, io, f));
    REQUIRE(f.type == MbFailureType::InvalidResponse);
    REQUIRE(s_sock == -1 && !s_status.connected);
    REQUIRE(s_status.rx_fail == 1 && s_status.rx_ok == 0);
}
void read_failures() {
    for (int kind = 0; kind < 5; ++kind) {
        reset();
        Pair p;
        bind(p);
        auto r = reply(1, 1, 4, {1});
        if (kind == 0) r[6] = 2;
        if (kind == 1) r[7] = 3;
        if (kind == 2) r[2] = 1;
        if (kind == 3) r[8] = 0;
        if (kind == 4) r = reply(1, 1, 4, {1, 2});
        inject(p, r);
        MbRead    io;
        MbFailure f;
        REQUIRE(!mb_read(MbFunc::ReadInput, 52, 1, io, f));
        REQUIRE(f.type == MbFailureType::InvalidResponse);
        REQUIRE(s_sock == -1);
        REQUIRE(s_status.rx_fail == 1);
    }
    {
        reset();
        Pair p;
        bind(p);
        inject(p, {0, 1, 0, 0, 0, 3, 1, 0x84, 2});
        MbRead    io;
        MbFailure f;
        REQUIRE(!mb_read(MbFunc::ReadInput, 78, 1, io, f));
        REQUIRE(f.type == MbFailureType::Exception && f.detail == 2);
        REQUIRE(s_sock >= 0);
        REQUIRE(s_status.rx_fail == 1);
        REQUIRE(s_last_reply_ms == 1000);
    }
    {
        reset();
        Pair p;
        bind(p);
        inject(p, {0, 1, 0, 0, 0, 3, 1, 0x84, 2});
        MbRead    io;
        MbFailure f;
        REQUIRE(!mb_read(MbFunc::ReadInput, 78, 1, io, f, true));
        REQUIRE(s_status.rx_fail == 0);
    }
    {
        reset();
        Pair p;
        bind(p);
        shutdown(p.b, SHUT_WR);
        MbRead    io;
        MbFailure f;
        REQUIRE(!mb_read(MbFunc::ReadInput, 52, 1, io, f));
        REQUIRE(f.type == MbFailureType::ConnectionClosed);
        REQUIRE(s_sock == -1);
    }
    {
        reset();
        Pair p;
        bind(p);
        MbRead    io;
        MbFailure f;
        REQUIRE(!mb_read(MbFunc::ReadInput, 52, 0, io, f));
        REQUIRE(f.type == MbFailureType::RequestBuild);
        REQUIRE(s_sock >= 0 && s_status.rx_fail == 1);
    }
}
void seed_cache() {
    s_target_enabled             = true;
    s_link_generation            = 7;
    s_cache_generation           = 7;
    s_cache_target_generation    = s_target_generation;
    s_status.connected           = true;
    s_poll_observed              = true;
    s_status.values              = 1;
    s_last_reply_ms              = 1000;
    s_cache_commit_ms            = 1000;
    s_full_cache_status_ms       = 1000;
    s_plant_gate_ms              = 1000;
    s_heating_mode_ms            = 1000;
    s_space_route_ms             = 1000;
    s_plant_outdoor_ms           = 1000;
    s_status.plant_gate_known    = true;
    s_status.plant_gate_active   = true;
    s_status.heating_mode_known  = true;
    s_status.heating_mode_active = true;
    s_status.space_route_known   = true;
    s_status.space_route_active  = true;
    s_status.plant_outdoor       = logic::outdoor_homehub_evidence(true, true, 12.0);
    CachedValue cv;
    cv.value = "12";
    cv.label = "Outdoor";
    cv.unit  = "°C";
    s_cache.push_back(cv);
}
void snapshot_generation() {
    REQUIRE(MB_CACHE_MAX_AGE_S == 627); // Derived from the current native full/fallback read plan.
    reset();
    seed_cache();
    CachedValue out[1];
    bool        live = false;
    REQUIRE(mb_values_snapshot(out, 1, live) == 1 && live);
    s_cache_generation = 6;
    REQUIRE(mb_values_snapshot(out, 1, live) == 1 && !live);
    s_cache_generation        = 7;
    s_cache_target_generation = s_target_generation + 1;
    REQUIRE(mb_values_snapshot(out, 1, live) == 1 && !live);
    s_cache_target_generation = s_target_generation;
    s_link_generation         = 0;
    REQUIRE(!mb_values_live());
}
void expiry() {
    reset();
    seed_cache();
    REQUIRE(mb_values_live());
    sdk::clock_us = (1000 + MB_REPLY_MAX_AGE_S * 1000LL) * 1000;
    REQUIRE(mb_values_live());
    sdk::clock_us.fetch_add(1000);
    REQUIRE(!mb_values_live());
    auto status = mb_status();
    REQUIRE(status.values == 0 && !status.plant_gate_known && !status.heating_mode_known &&
            !status.space_route_known && !status.space_route_active &&
            !status.plant_outdoor.available);
    reset();
    seed_cache();
    sdk::clock_us   = (1000 + MB_CACHE_MAX_AGE_S * 1000LL) * 1000;
    s_last_reply_ms = sdk::clock_us / 1000;
    REQUIRE(mb_values_live());
    sdk::clock_us.fetch_add(1000);
    s_last_reply_ms = sdk::clock_us / 1000;
    REQUIRE(!mb_values_live());
    reset();
    seed_cache();
    sdk::clock_us = 500000;
    REQUIRE(!mb_values_live());
    reset();
    seed_cache();
    mb_record_poll_gap();
    REQUIRE(!mb_values_live());
    status = mb_status();
    REQUIRE(status.values == 0 && !status.plant_gate_known && !status.space_route_known &&
            !status.space_route_active);
    std::cout << "bounds reply=" << MB_REPLY_MAX_AGE_S << "s cache=" << MB_CACHE_MAX_AGE_S << "s\n";
}
void reconfigure_generations() {
    reset();
    seed_cache();
    const auto gen = s_target_generation.load();
    REQUIRE(status_error("old", "old diagnostic", 2, 53, false, gen));
    REQUIRE(mb_status().last_error == "old diagnostic");
    const auto revision = mb_cache_generation();
    mb_reconfigure(false);
    REQUIRE(s_target_generation == gen + 1 && !mb_target_enabled());
    REQUIRE(!mb_values_live());
    REQUIRE(s_cache.empty() && mb_cache_generation() == revision + 1);
    const auto status = mb_status();
    REQUIRE(!status.connected && status.values == 0 && !status.plant_gate_known &&
            !status.heating_mode_known && !status.space_route_known && !status.space_route_active);
    REQUIRE(s_space_route_ms == -1);
    REQUIRE(status.last_error_code.empty());
    REQUIRE(!status_target("old", 502, 1, false, gen));
    REQUIRE(!status_error("old", "old", 2, 53, true, gen));
    REQUIRE(!status_recovered(gen));
    REQUIRE(!status_clear_error(gen));
    // A rejected old-target socket can still mutate the task-owned probe state. Public
    // readers must use the generation-bound status, not that internal stale result.
    s_probe_tracker.target_host         = "old";
    s_probe_tracker.target_port         = 502;
    s_probe_tracker.target_unit         = 1;
    s_probe_tracker.affirmative_profile = ModbusProfile::Altherma4;
    REQUIRE(!status_socket_open("old", 502, 1, 0, gen));
    REQUIRE(s_active_profile == ModbusProfile::Altherma4);
    const auto after_stale_open = mb_status();
    REQUIRE(after_stale_open.profile == ModbusProfile::Auto);
    REQUIRE(after_stale_open.profile_basis == ModbusProfileBasis::Probing);
    REQUIRE(mb_active_profile() == ModbusProfile::Auto);
    s_target_generation = UINT32_MAX;
    mb_reconfigure(false);
    REQUIRE(s_target_generation == 1);
}
struct RegisterWord {
    MbFunc   space;
    uint16_t offset;
    uint16_t raw;
};
struct WireRequest {
    MbFunc   space;
    uint16_t offset;
    uint16_t count;
};
struct Peer {
    Pair                      pair;
    std::atomic<bool>         stop{false};
    std::thread               thread;
    std::atomic<int>          requests{0};
    std::atomic<uint16_t>     outdoor{1200};
    std::atomic<bool>         break_link{false};
    std::atomic<bool>         batch_exception{false};
    std::atomic<int>          probe_exception{-1};
    std::atomic<bool>         all_exceptions{false};
    std::atomic<bool>         space_route_exception{false};
    std::atomic<bool>         compressor_exception{false};
    std::mutex                response_mutex;
    std::vector<RegisterWord> words;
    std::vector<WireRequest>  wire_requests;
    explicit Peer(bool fallback = false, ModbusProfile profile = ModbusProfile::HomeHub,
                  const std::vector<RegisterWord>& initial_words = {})
        : pair(300), batch_exception(fallback), words(initial_words) {
        adapter::cfg.mb_host     = "harness-peer";
        adapter::cfg.mb_port     = 502;
        adapter::cfg.mb_unit_id  = 1;
        s_sock                   = pair.a;
        pair.a                   = -1;
        s_req_host               = adapter::cfg.mb_host;
        s_req_port               = 502;
        s_unit                   = 1;
        s_have_req               = true;
        s_req_target_generation  = s_target_generation;
        s_req_history_generation = adapter::history_generation;
        s_target_enabled         = true;
        REQUIRE(status_socket_open(s_req_host, 502, 1, 0, s_target_generation));
        if (profile != ModbusProfile::Auto) {
            s_active_profile                    = profile;
            s_probe_tracker.affirmative_profile = profile;
            s_probe_tracker.active_profile      = profile;
            s_probe_tracker.profile_basis       = ModbusProfileBasis::Affirmative;
        }
        start();
    }
    Peer(int accepted, const std::vector<RegisterWord>& initial_words)
        : pair(-1, accepted), words(initial_words) {
        start();
    }
    void start() {
        thread = std::thread([this] {
            while (!stop) {
                uint8_t req[12];
                int     n = 0;
                while (n < 12 && !stop) {
                    const int got = recv(pair.b, req + n, 12 - n, 0);
                    if (got > 0)
                        n += got;
                    else if (got == 0)
                        return;
                    else if (errno != EAGAIN && errno != EWOULDBLOCK)
                        return;
                }
                if (n != 12) return;
                ++requests;
                if (break_link) {
                    shutdown(pair.b, SHUT_WR);
                    return;
                }
                const uint16_t txn = (req[0] << 8) | req[1], addr = (req[8] << 8) | req[9],
                               qty = (req[10] << 8) | req[11];
                if (req[7] != 3 && req[7] != 4) std::abort();
                const auto space = static_cast<MbFunc>(req[7]);
                {
                    std::lock_guard<std::mutex> lock(response_mutex);
                    wire_requests.push_back({space, static_cast<uint16_t>(addr + 1), qty});
                }
                std::vector<uint8_t> r;
                const int            probe_code =
                    req[7] == 4 && addr == 78 && qty == 1 ? probe_exception.load() : -1;
                if (all_exceptions || (batch_exception && qty > 1) ||
                    (space_route_exception && req[7] == 4 && addr == 36 && qty == 1) ||
                    (compressor_exception && req[7] == 4 && addr == 30 && qty == 1) ||
                    probe_code >= 0)
                    r = {req[0],
                         req[1],
                         0,
                         0,
                         0,
                         3,
                         req[6],
                         uint8_t(req[7] | 0x80),
                         static_cast<uint8_t>(probe_code >= 0 ? probe_code : 2)};
                else {
                    std::vector<uint16_t> response_words;
                    for (uint16_t i = 0; i < qty; ++i) {
                        const uint16_t off = addr + i + 1;
                        uint16_t       w   = off == 44 ? outdoor.load() : 1;
                        {
                            std::lock_guard<std::mutex> lock(response_mutex);
                            for (const auto& word : words)
                                if (word.space == space && word.offset == off) w = word.raw;
                        }
                        response_words.push_back(w);
                    }
                    r = reply(txn, req[6], req[7], response_words);
                }
                if (send(pair.b, r.data(), r.size(), 0) != static_cast<ssize_t>(r.size())) return;
            }
        });
    }
    void set_word(MbFunc space, uint16_t offset, uint16_t raw) {
        std::lock_guard<std::mutex> lock(response_mutex);
        for (auto& word : words)
            if (word.space == space && word.offset == offset) {
                word.raw = raw;
                return;
            }
        words.push_back({space, offset, raw});
    }
    std::vector<WireRequest> requests_snapshot() {
        std::lock_guard<std::mutex> lock(response_mutex);
        return wire_requests;
    }
    ~Peer() {
        stop = true;
        shutdown(pair.b, SHUT_RDWR);
        if (thread.joinable()) thread.join();
    }
};

struct CatalogFixture {
    MbFunc      space;
    uint16_t    offset;
    uint16_t    raw;
    const char* formatted;
};
// Independent wire/format expectations: distinct words make a swapped response index visible.
// These are synthetic inputs, not captured plant values or physical validation of the catalog.
const CatalogFixture HOMEHUB_WORDS[] = {
    {MbFunc::ReadInput, 21, 2, "2"},
    {MbFunc::ReadInput, 22, 0x4334, "C4"},
    {MbFunc::ReadInput, 23, 7, "7"},
    {MbFunc::ReadInput, 30, 1, "1"},
    {MbFunc::ReadInput, 31, 0, "0"},
    {MbFunc::ReadInput, 32, 1, "1"},
    {MbFunc::ReadInput, 33, 0, "0"},
    {MbFunc::ReadInput, 37, 1, "1"},
    {MbFunc::ReadInput, 52, 0, "0"},
    {MbFunc::ReadInput, 53, 1, "1"},
    {MbFunc::ReadInput, 38, 1, "1"},
    {MbFunc::ReadInput, 40, 3450, "34.5"},
    {MbFunc::ReadInput, 41, 3500, "35.0"},
    {MbFunc::ReadInput, 42, 3000, "30.0"},
    {MbFunc::ReadInput, 43, 4850, "48.5"},
    {MbFunc::ReadInput, 44, 1200, "12.0"},
    {MbFunc::ReadInput, 45, static_cast<uint16_t>(-550), "-5.5"},
    {MbFunc::ReadInput, 50, 2150, "21.5"},
    {MbFunc::ReadInput, 49, 1234, "12.3"},
    {MbFunc::ReadInput, 51, 789, "7.9"},
    {MbFunc::ReadHolding, 1, 35, "35"},
    {MbFunc::ReadHolding, 2, 18, "18"},
    {MbFunc::ReadHolding, 3, 2, "2"},
    {MbFunc::ReadHolding, 4, 1, "1"},
    {MbFunc::ReadHolding, 6, 21, "21"},
    {MbFunc::ReadHolding, 7, 23, "23"},
    {MbFunc::ReadHolding, 9, 1, "1"},
    {MbFunc::ReadHolding, 10, 50, "50"},
    {MbFunc::ReadHolding, 54, static_cast<uint16_t>(-2), "-2"},
    {MbFunc::ReadHolding, 56, 2, "2"},
    {MbFunc::ReadHolding, 57, 450, "4.5"},
    {MbFunc::ReadHolding, 58, 600, "6.0"},
};
const CatalogFixture NATIVE_EXTRA_WORDS[] = {
    {MbFunc::ReadInput, 65, 4, "4"},       {MbFunc::ReadInput, 66, 45, "45"},
    {MbFunc::ReadInput, 67, 100, "100"},   {MbFunc::ReadInput, 68, 75, "75"},
    {MbFunc::ReadInput, 74, 3550, "35.5"}, {MbFunc::ReadInput, 75, 4900, "49.0"},
    {MbFunc::ReadInput, 76, 5200, "52.0"}, {MbFunc::ReadInput, 77, 4800, "48.0"},
    {MbFunc::ReadInput, 79, 185, "1.85"},  {MbFunc::ReadInput, 80, 3300, "33.0"},
    {MbFunc::ReadInput, 83, 3, "3"},
};
std::vector<CatalogFixture> catalog_fixture(bool native) {
    std::vector<CatalogFixture> rows(std::begin(HOMEHUB_WORDS), std::end(HOMEHUB_WORDS));
    if (native) {
        rows.erase(std::remove_if(rows.begin(), rows.end(),
                                  [](const auto& row) {
                                      return row.space == MbFunc::ReadHolding && row.offset == 57;
                                  }),
                   rows.end());
        for (auto& row : rows)
            if (row.space == MbFunc::ReadHolding && row.offset == 9) {
                row.raw       = 2;
                row.formatted = "2";
            }
        rows.insert(rows.end(), std::begin(NATIVE_EXTRA_WORDS), std::end(NATIVE_EXTRA_WORDS));
    }
    return rows;
}
std::vector<RegisterWord> wire_words(bool native) {
    std::vector<RegisterWord> words;
    for (const auto& row : catalog_fixture(native))
        words.push_back({row.space, row.offset, row.raw});
    return words;
}
std::vector<CachedValue> snapshot_rows(bool      expected_live      = true,
                                       uint32_t* history_generation = nullptr) {
    std::vector<CachedValue> rows(mb_values_capacity());
    bool                     live = false;
    const auto count = mb_values_snapshot(rows.data(), rows.size(), live, history_generation);
    REQUIRE(live == expected_live);
    rows.resize(count);
    return rows;
}
const CachedValue& cached_row(const std::vector<CachedValue>& rows, uint16_t offset) {
    const auto row = std::find_if(rows.begin(), rows.end(),
                                  [=](const auto& value) { return value.off == offset; });
    REQUIRE(row != rows.end());
    REQUIRE(std::count_if(rows.begin(), rows.end(),
                          [=](const auto& value) { return value.off == offset; }) == 1);
    return *row;
}
void require_catalog_rows(const std::vector<CachedValue>& rows, bool native) {
    const auto fixture = catalog_fixture(native);
    REQUIRE(rows.size() == (native ? 42u : 31u));
    REQUIRE(rows.size() + (native ? 0u : 1u) == fixture.size());
    const auto* definitions = native ? def::ALTHERMA4_REGS : def::HOMEHUB_REGS;
    const int   count       = native ? def::ALTHERMA4_REG_COUNT : def::HOMEHUB_REG_COUNT;
    for (int i = 0; i < count; ++i) {
        const auto& definition = definitions[i];
        if (!native && definition.space == MbFunc::ReadHolding && definition.offset == 9) {
            REQUIRE(std::none_of(rows.begin(), rows.end(),
                                 [](const auto& row) { return row.off == 9; }));
            continue;
        }
        const auto& row      = cached_row(rows, definition.offset);
        const auto* resolved = def::homehub_definition(row.modbus_definition);
        REQUIRE(resolved == &definition);
        REQUIRE(def::homehub_definition_is_altherma4(row.modbus_definition) == native);
        REQUIRE(row.modbus_flow_scale_unverified == (row.off == 49));
        REQUIRE(row.reg == def::HOMEHUB_GROUP_REG && !row.held);
        REQUIRE(row.label == definition.label && row.unit == definition.unit);
        REQUIRE(row.conv == (definition.type == MbType::Text16                  ? 204
                             : definition.kind == def::HomeHubValueKind::Binary ? 300
                                                                                : 0));
        const auto expected = std::find_if(fixture.begin(), fixture.end(), [&](const auto& value) {
            return value.space == definition.space && value.offset == definition.offset;
        });
        REQUIRE(expected != fixture.end());
        REQUIRE(row.value == expected->formatted);
    }
}
void require_request_spans(const std::vector<WireRequest>& requests, bool native) {
    std::vector<WireRequest> expected = {
        {MbFunc::ReadHolding, 1, 4},
        {MbFunc::ReadHolding, 6, 2},
        {MbFunc::ReadHolding, 9, 2},
        {MbFunc::ReadHolding, 54, 1},
        {MbFunc::ReadHolding, 56, native ? uint16_t{1} : uint16_t{3}},
        {MbFunc::ReadInput, 21, 3},
        {MbFunc::ReadInput, 30, 4},
        {MbFunc::ReadInput, 37, 2},
        {MbFunc::ReadInput, 40, 6},
        {MbFunc::ReadInput, 49, 5},
    };
    if (native) {
        expected.push_back({MbFunc::ReadHolding, 58, 1});
        expected.push_back({MbFunc::ReadInput, 65, 4});
        expected.push_back({MbFunc::ReadInput, 74, 4});
        expected.push_back({MbFunc::ReadInput, 79, 2});
        expected.push_back({MbFunc::ReadInput, 83, 1});
    }
    const auto less = [](const auto& a, const auto& b) {
        if (a.space != b.space)
            return static_cast<uint8_t>(a.space) < static_cast<uint8_t>(b.space);
        return a.offset < b.offset;
    };
    auto actual = requests;
    std::sort(actual.begin(), actual.end(), less);
    std::sort(expected.begin(), expected.end(), less);
    REQUIRE(actual.size() == expected.size());
    for (size_t i = 0; i < expected.size(); ++i) {
        REQUIRE(actual[i].space == expected[i].space);
        REQUIRE(actual[i].offset == expected[i].offset);
        REQUIRE(actual[i].count == expected[i].count);
    }
}
void homehub_definition_rows() {
    reset();
    Peer peer(false, ModbusProfile::HomeHub, wire_words(false));
    mb_poll_once();
    require_catalog_rows(snapshot_rows(), false);
    require_catalog_rows(adapter::history_rows, false);
    require_request_spans(peer.requests_snapshot(), false);
    REQUIRE(mb_status().profile == ModbusProfile::HomeHub);
    REQUIRE(def::homehub_definition(0) == nullptr && def::homehub_definition(255) == nullptr);
    auto foreign = def::HOMEHUB_REGS[0];
    REQUIRE(def::homehub_definition_id(foreign) == 0);
    const auto rows = snapshot_rows();
    REQUIRE(std::none_of(rows.begin(), rows.end(), [](const auto& row) { return row.off == 9; }));
    REQUIRE(std::string(cached_row(rows, 57).label) ==
            "Power limit during Recommended on / buffering");
    REQUIRE(std::string(cached_row(rows, 58).label) == "General power limit");
    // EKRHH input38 has no zero/None state; native's recognized inactive zero must not leak here.
    peer.set_word(MbFunc::ReadInput, 38, 0);
    s_cycle_tick = 0;
    mb_poll_once();
    const auto  zero_rows = snapshot_rows();
    const auto& zero      = cached_row(zero_rows, 38);
    REQUIRE(zero.value == "0");
    REQUIRE(def::homehub_definition(zero.modbus_definition)->kind ==
            def::HomeHubValueKind::CurrentOperationMode);
    REQUIRE(!mb_status().heating_mode_known && !mb_status().heating_mode_active);
}
void native_definition_rows() {
    reset();
    Peer peer(false, ModbusProfile::Altherma4, wire_words(true));
    mb_poll_once();
    require_catalog_rows(snapshot_rows(), true);
    require_catalog_rows(adapter::history_rows, true);
    require_request_spans(peer.requests_snapshot(), true);
    REQUIRE(mb_status().profile == ModbusProfile::Altherma4);
    REQUIRE(mb_status().values == 42 && MB_PLAN_ALTHERMA4.count == 15);
    REQUIRE(def::altherma4_find(57) == nullptr);
}
void native_enum_case(uint16_t offset, MbFunc space, def::HomeHubValueKind expected_kind,
                      const char* expected_enum, uint16_t max_value) {
    reset();
    Peer                  peer(false, ModbusProfile::Altherma4, wire_words(true));
    std::vector<uint16_t> raw_values;
    for (uint16_t raw = 0; raw <= max_value + 1; ++raw) raw_values.push_back(raw);
    raw_values.insert(raw_values.end(), {17, MB_WAIT, MB_UNAVAILABLE, MB_UNSUPPORTED});
    for (uint16_t raw : raw_values) {
        peer.set_word(space, offset, raw);
        s_cycle_tick = 0;
        mb_poll_once();
        const auto  rows       = snapshot_rows();
        const auto& row        = cached_row(rows, offset);
        const auto* definition = def::homehub_definition(row.modbus_definition);
        REQUIRE(definition != nullptr);
        REQUIRE(definition->kind == expected_kind);
        REQUIRE(std::string(def::homehub_enum_id(definition->kind)) == expected_enum);
        REQUIRE(definition->offset == offset && definition->space == space);
        REQUIRE(def::homehub_definition_is_altherma4(row.modbus_definition));
        REQUIRE(row.conv == 0);
        REQUIRE(row.value == (mb_is_special(raw) ? std::string{} : std::to_string(raw)));
        if (offset == 38) {
            const auto status = mb_status();
            REQUIRE(status.heating_mode_known == (raw <= 2));
            REQUIRE(status.heating_mode_active == (raw == 1));
        }
        if (offset == 9) {
            REQUIRE(std::string(row.label) == "Quiet mode selection");
            REQUIRE(!def::homehub_has_quiet_activity(*definition));
            REQUIRE(logic::homehub_concept_for(9, false) == nullptr);
            REQUIRE(logic::homehub_history_for(9, false) == nullptr);
        }
    }
}
void native_current_mode() {
    native_enum_case(38, MbFunc::ReadInput, def::HomeHubValueKind::Altherma4CurrentOperationMode,
                     "altherma4_current_operation_mode", 2);
}
void native_demand_response() {
    native_enum_case(65, MbFunc::ReadInput, def::HomeHubValueKind::Altherma4DemandResponse,
                     "altherma4_demand_response", 4);
}
void native_unit_mode() {
    native_enum_case(83, MbFunc::ReadInput, def::HomeHubValueKind::Altherma4UnitOperationMode,
                     "altherma4_unit_operation_mode", 4);
}
void native_quiet_selection() {
    native_enum_case(9, MbFunc::ReadHolding, def::HomeHubValueKind::Altherma4QuietSelection,
                     "altherma4_quiet_selection", 2);
}
void native_power_label() {
    reset();
    Peer peer(false, ModbusProfile::Altherma4, wire_words(true));
    mb_poll_once();
    const auto  rows       = snapshot_rows();
    const auto& row        = cached_row(rows, 58);
    const auto* definition = def::homehub_definition(row.modbus_definition);
    REQUIRE(definition != nullptr && std::string(definition->label) == "Imposed power limit");
    REQUIRE(std::string(row.label) == "Imposed power limit" && row.value == "6.0" &&
            std::string(row.unit) == "kW");
    REQUIRE(def::homehub_definition_is_altherma4(row.modbus_definition));
    REQUIRE(definition->space == MbFunc::ReadHolding && definition->type == MbType::Pow16);
}
void probe_native_promotion() {
    reset();
    Peer peer(true, ModbusProfile::Auto, wire_words(true));
    mb_poll_once();
    auto rows = snapshot_rows();
    REQUIRE(rows.size() == 1 && rows[0].off == 79 && rows[0].value == "1.85");
    REQUIRE(def::homehub_definition(rows[0].modbus_definition) == def::altherma4_find(79));
    REQUIRE(adapter::history_rows.size() == 1 && adapter::history_rows[0].off == 79);
    REQUIRE(adapter::history_rows[0].modbus_definition == rows[0].modbus_definition);
    const auto status = mb_status();
    REQUIRE(status.profile == ModbusProfile::Altherma4 &&
            status.profile_basis == ModbusProfileBasis::Affirmative && status.values == 1);
    // The baseline tried batches, exceptions then singles. Native fallback budgets start clean.
    REQUIRE(peer.requests > MB_PLAN.count + 1);
    for (bool split : s_batch_split) REQUIRE(!split);
    REQUIRE(s_cycle_tick == 0);
    peer.batch_exception      = false;
    const auto first_requests = peer.requests_snapshot().size();
    mb_poll_once();
    rows = snapshot_rows();
    require_catalog_rows(rows, true);
    const auto requests = peer.requests_snapshot();
    require_request_spans(
        std::vector<WireRequest>(requests.begin() + first_requests, requests.end()), true);
}
void probe_homehub_rows() {
    // An unsupported-register answer selects the baseline software map. Flow stays provisional.
    for (bool exception : {false, true}) {
        reset();
        auto words = wire_words(false);
        words.push_back({MbFunc::ReadInput, 79, MB_UNSUPPORTED});
        Peer peer(false, ModbusProfile::Auto, words);
        peer.probe_exception = exception ? 2 : -1;
        mb_poll_once();
        const auto rows = snapshot_rows();
        require_catalog_rows(rows, false);
        REQUIRE(cached_row(rows, 49).modbus_flow_scale_unverified);
        REQUIRE(mb_status().profile == ModbusProfile::HomeHub);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Affirmative);
        REQUIRE(peer.requests == MB_PLAN.count + 1);
    }
    // Pending/invalid probes do not append a speculative native row or relabel the baseline.
    for (uint16_t raw : {uint16_t{0}, MB_WAIT, MB_UNAVAILABLE}) {
        reset();
        auto words = wire_words(false);
        words.push_back({MbFunc::ReadInput, 79, raw});
        Peer peer(false, ModbusProfile::Auto, words);
        mb_poll_once();
        const auto rows = snapshot_rows();
        require_catalog_rows(rows, false);
        REQUIRE(cached_row(rows, 49).modbus_flow_scale_unverified);
        REQUIRE(mb_status().profile == ModbusProfile::Auto);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Probing);
        REQUIRE(peer.requests == MB_PLAN.count + 1);
    }

    // Exception code zero is not affirmative capability evidence. The same baseline reading
    // remains provisional through retries, fallback and the affirmative software selection.
    reset();
    auto words = wire_words(false);
    words.push_back({MbFunc::ReadInput, 79, MB_WAIT});
    Peer peer(false, ModbusProfile::Auto, words);
    peer.probe_exception = 0;
    for (int attempt = 0; attempt < logic::MODBUS_PROBE_MAX_RETRIES; ++attempt) {
        s_cycle_tick = 0;
        mb_poll_once();
        REQUIRE(cached_row(snapshot_rows(), 49).modbus_flow_scale_unverified);
    }
    REQUIRE(mb_status().profile == ModbusProfile::HomeHub);
    REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Fallback);
    const auto fallback  = snapshot_rows();
    peer.probe_exception = -1;
    peer.set_word(MbFunc::ReadInput, 79, MB_UNSUPPORTED);
    sdk::clock_us = uint64_t{s_probe_tracker.next_reprobe_time_s} * 1000000;
    s_cycle_tick  = 0;
    mb_poll_once();
    REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Affirmative);
    const auto affirmative = snapshot_rows();
    REQUIRE(cached_row(affirmative, 49).modbus_flow_scale_unverified);
    REQUIRE(cached_row(fallback, 49).modbus_flow_scale_unverified);
    REQUIRE(cached_row(fallback, 49).value == cached_row(affirmative, 49).value);
}
void native_gateway_baseline() {
    // These are native-backed words, even when the gateway cannot answer native probe input 79.
    for (const auto& [word, exception] :
         {std::pair{MB_UNSUPPORTED, -1}, std::pair{MB_UNSUPPORTED, 2},
          std::pair{MB_UNAVAILABLE, -1}}) {
        reset();
        Peer peer(false, ModbusProfile::Auto, wire_words(true));
        peer.set_word(MbFunc::ReadInput, 79, word);
        peer.set_word(MbFunc::ReadInput, 49, 0x0960);
        peer.set_word(MbFunc::ReadHolding, 9, 1); // native Automatic selection
        peer.probe_exception = exception;
        mb_poll_once();
        const auto rows = snapshot_rows();
        REQUIRE(cached_row(rows, 49).value == "24.0");
        REQUIRE(cached_row(rows, 49).modbus_flow_scale_unverified);
        for (const auto* cache :
             {&rows, static_cast<const std::vector<CachedValue>*>(&adapter::history_rows)})
            REQUIRE(std::none_of(cache->begin(), cache->end(),
                                 [](const auto& row) { return row.off == 9; }));
        REQUIRE(mb_status().profile != ModbusProfile::Altherma4);
    }
}
ModbusActivity current_activity() {
    bool           live = false;
    ModbusActivity result;
    mb_values_snapshot(nullptr, 0, live, nullptr, &result);
    return result;
}

ModbusCompressor current_compressor() { return current_activity().compressor; }

void probe_resolved_peer_reconnect() {
    reset();
    const TcpListener first, replacement;
    const uint32_t    first_ipv4       = htonl(0xc0000232);
    const uint32_t    replacement_ipv4 = htonl(0xc0000233);
    sdk::tcp_peer_routes    = {{{first_ipv4, first.port}, {replacement_ipv4, replacement.port}}};
    adapter::cfg.mb_host    = "reconnect-harness.local";
    adapter::cfg.mb_port    = first.port;
    adapter::cfg.mb_unit_id = 1;
    s_target_enabled        = true;
    const auto generation   = s_target_generation.load();
    const auto open         = [&](uint32_t ipv4, const TcpListener& listener) {
        sdk::mdns_a_result.addr = ipv4;
        REQUIRE(mb_ensure_connected(adapter::cfg.mb_host, adapter::cfg.mb_port, 1, generation,
                                            history_modbus_generation()));
        REQUIRE(mb_status().host == "reconnect-harness.local" && !mb_values_live());
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        return listener.accept_peer();
    };
    const auto disconnect = [&](Peer& peer) {
        peer.break_link = true;
        mb_poll_once();
        REQUIRE(s_sock < 0 && !mb_values_live());
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
    };

    uint32_t first_history_generation = 0;
    {
        Peer peer(open(first_ipv4, first),
                  {{MbFunc::ReadInput, 49, 1234}, {MbFunc::ReadInput, 79, MB_UNSUPPORTED}});
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::On);
        REQUIRE(cached_row(snapshot_rows(), 49).modbus_flow_scale_unverified);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Affirmative);
        REQUIRE(peer.requests == MB_PLAN.count + 1);
        first_history_generation = adapter::history_generation;
        REQUIRE(first_history_generation > 1);
        disconnect(peer);
    }
    {
        Peer peer(open(first_ipv4, first),
                  {{MbFunc::ReadInput, 49, 1234}, {MbFunc::ReadInput, 79, MB_WAIT}});
        mb_poll_once();
        REQUIRE(cached_row(snapshot_rows(), 49).modbus_flow_scale_unverified);
        REQUIRE(peer.requests == MB_PLAN.count); // Same resolved peer retains affirmative evidence.
        REQUIRE(adapter::history_generation == first_history_generation);
        disconnect(peer);
    }
    {
        Peer peer(open(replacement_ipv4, replacement), std::vector<RegisterWord>{});
        REQUIRE(adapter::history_generation == first_history_generation);
        REQUIRE(s_req_history_generation == 0);
        peer.all_exceptions  = true;
        peer.probe_exception = 0; // Preserve provisional profile selection for the retry.
        const auto attempts  = adapter::history_bind_attempts;
        mb_poll_once();
        REQUIRE(adapter::history_bind_attempts == attempts);
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        REQUIRE(adapter::history_generation == first_history_generation);
        disconnect(peer);
    }
    {
        Peer peer(open(replacement_ipv4, replacement), std::vector<RegisterWord>{});
        REQUIRE(adapter::history_generation == first_history_generation);
        sdk::on_send = [] { throw std::bad_alloc(); };
        bool caught  = false;
        try {
            mb_poll_once();
        } catch (const std::bad_alloc&) {
            caught = true;
        }
        sdk::on_send = {};
        REQUIRE(caught && adapter::history_generation == first_history_generation);
        close_sock();
    }
    {
        Peer peer(open(replacement_ipv4, replacement), {{MbFunc::ReadInput, 31, 0},
                                                        {MbFunc::ReadInput, 49, 1570},
                                                        {MbFunc::ReadInput, 79, MB_WAIT}});
        REQUIRE(adapter::history_generation == first_history_generation);
        adapter::history_bind_busy = true;
        const auto calls           = adapter::history_calls;
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::Off);
        uint32_t   cache_history_generation = UINT32_MAX;
        const auto rows                     = snapshot_rows(true, &cache_history_generation);
        REQUIRE(cache_history_generation == 0 && adapter::history_calls == calls);
        const auto& flow = cached_row(rows, 49);
        REQUIRE(flow.value == "15.7" && flow.modbus_flow_scale_unverified);
        REQUIRE(adapter::history_generation == first_history_generation);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Probing);
        REQUIRE(peer.requests == MB_PLAN.count + 1);
        adapter::history_bind_busy = false;
        mb_poll_once(); // fast retry binds, but leaves the prior full-cache provenance at zero
        REQUIRE(adapter::history_generation == first_history_generation + 1);
        REQUIRE(adapter::history_calls == calls);
        (void)snapshot_rows(true, &cache_history_generation);
        REQUIRE(cache_history_generation == 0);

        peer.set_word(MbFunc::ReadInput, 79, MB_UNSUPPORTED);
        s_cycle_tick = 0;
        mb_poll_once();
        REQUIRE(cached_row(snapshot_rows(true, &cache_history_generation), 49)
                    .modbus_flow_scale_unverified);
        REQUIRE(cached_row(adapter::history_rows, 49).modbus_flow_scale_unverified);
        REQUIRE(cache_history_generation == adapter::history_generation);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Affirmative);
        ++adapter::history_generation;
        (void)snapshot_rows(true, &cache_history_generation);
        REQUIRE(cache_history_generation == 0);
    }
    REQUIRE(s_target_generation == generation && sdk::mdns_a_calls == 5);
    close_sock();
}
void definition_snapshot_cutover() {
    for (const auto profile : {ModbusProfile::HomeHub, ModbusProfile::Altherma4}) {
        reset();
        const bool native = profile == ModbusProfile::Altherma4;
        Peer       peer(false, profile, wire_words(native));
        mb_poll_once();
        auto retained_copy = snapshot_rows();
        bool called        = false;
        sdk::on_mutex_give = [&] {
            if (called) return;
            called               = true;
            adapter::cfg.mb_host = "replacement-unresolved";
            mb_reconfigure(true);
        };
        auto overlapping_copy = snapshot_rows(false);
        sdk::on_mutex_give    = {};
        REQUIRE(called && !mb_values_live() && s_cache.empty());
        REQUIRE(mb_active_profile() == ModbusProfile::Auto);
        // Both copied buffers keep their own row identity even though they are no longer live.
        require_catalog_rows(retained_copy, native);
        require_catalog_rows(overlapping_copy, native);
    }
}
void poll_full_fast_break() {
    reset();
    Peer peer(false, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 37, 0}});
    mb_poll_once();
    const auto revision = mb_cache_generation();
    const auto count    = s_cache.size();
    REQUIRE(count == static_cast<size_t>(def::HOMEHUB_REG_COUNT - 1));
    REQUIRE(mb_values_live());
    auto st = mb_status();
    REQUIRE(st.connected && st.plant_gate_known && st.plant_gate_active && st.heating_mode_known &&
            st.heating_mode_active && st.space_route_known && st.space_route_active);
    REQUIRE(st.plant_outdoor.available && st.plant_outdoor.temperature_c == 12.0);
    const auto requests = peer.requests.load();
    peer.outdoor        = 1800;
    peer.set_word(MbFunc::ReadInput, 37, 1);
    sdk::clock_us.fetch_add(1000000);
    mb_poll_once();
    st = mb_status();
    REQUIRE(mb_cache_generation() == revision && s_cache.size() == count);
    REQUIRE(st.plant_outdoor.temperature_c == 18.0);
    REQUIRE(st.space_route_known && !st.space_route_active);
    REQUIRE(peer.requests.load() > requests && peer.requests.load() - requests < MB_PLAN.count);
    peer.break_link = true;
    sdk::clock_us.fetch_add(1000000);
    mb_poll_once();
    st = mb_status();
    REQUIRE(!st.connected && st.values == 0 && !st.plant_gate_known && !st.heating_mode_known &&
            !st.space_route_known && !st.space_route_active && !st.plant_outdoor.available);
    REQUIRE(!mb_values_live());
    REQUIRE(st.last_error_code == "connection_closed");
}
void poll_batch_fallback() {
    reset();
    Peer peer(true);
    mb_poll_once();
    REQUIRE(mb_values_live());
    REQUIRE(s_cache.size() == static_cast<size_t>(def::HOMEHUB_REG_COUNT - 1));
    const int first = peer.requests;
    REQUIRE(first > MB_PLAN.count);
    bool split = false;
    for (bool b : s_batch_split) split = split || b;
    REQUIRE(split);
    sdk::clock_us.fetch_add(1000000);
    mb_poll_once();
    REQUIRE(mb_values_live());
    REQUIRE(peer.requests > first);
}
void poll_history_reply_boundary() {
    reset();
    Peer              peer(true, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 32, 1}});
    constexpr int64_t boundary = logic::HISTORY_DT_S * 1000000LL;
    sdk::clock_us              = boundary - 200000;
    sdk::on_send               = [&] {
        if (s_status.rx_ok == 22) sdk::clock_us = boundary + 200000;
    };
    mb_poll_once();
    sdk::on_send = {};
    REQUIRE(adapter::history_calls == 2);
    REQUIRE(adapter::history_reply_slots[0] == 0 && adapter::history_reply_slots[1] == boundary);
    REQUIRE(adapter::history_reply_heater[0] && !adapter::history_reply_heater[1]);
}
void partial_sweep_allocation_pressure() {
    reset();
    Peer peer(true, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 49, 1234}});
    mb_poll_once(); // Warm the previous cache, the recorder adapter and the single-read plan.
    REQUIRE(cached_row(snapshot_rows(), 49).value == "12.3");
    const auto revision      = mb_cache_generation();
    const auto history_calls = adapter::history_calls;
    peer.set_word(MbFunc::ReadInput, 49, 1570);
    peer.space_route_exception = true;
    s_cycle_tick               = 0;
    unsigned sends             = 0;
    sdk::on_send               = [&] {
        // The split plan issues one request per register. Keep allocations available through
        // construction of the new sweep; refuse them as its final valid row arrives.
        if (++sends == def::HOMEHUB_REG_COUNT) sdk::fail_allocations = true;
    };
    bool completed = false;
    try {
        mb_poll_once();
        completed = true;
    } catch (const std::bad_alloc&) {}
    const bool exercised_pressure = sdk::fail_allocations;
    sdk::fail_allocations         = false;
    sdk::on_send                  = {};
    REQUIRE(exercised_pressure && sends == def::HOMEHUB_REG_COUNT);
    REQUIRE(completed && sdk::rejected_allocations == 0);
    REQUIRE(mb_cache_generation() == revision + 1 && s_cycle_tick == 1);
    REQUIRE(adapter::history_calls == history_calls + 1);
    REQUIRE(cached_row(adapter::history_rows, 49).value == "15.7");
    const auto rows = snapshot_rows();
    REQUIRE(cached_row(rows, 49).value == "15.7");
    REQUIRE(std::none_of(rows.begin(), rows.end(), [](const auto& row) { return row.off == 37; }));
    const auto  status = mb_status();
    const char* error  = "HomeHub rejected register 37 (Modbus exception 2: illegal data address)";
    REQUIRE(status.connected && status.values == static_cast<int>(rows.size()));
    REQUIRE(status.last_error_code == "modbus_exception" && status.last_error == error);
    REQUIRE(status.last_error_detail == 2 && status.last_error_register == 37);
    REQUIRE(adapter::pressure_log_count == 1 &&
            std::string(adapter::pressure_log) == std::string("modbus: ") + error + "\n");

    const auto logs = adapter::logs.size();
    s_cycle_tick    = 0;
    mb_poll_once();
    REQUIRE(adapter::logs.size() == logs);
    peer.space_route_exception = false;
    mb_poll_once(); // A healthy fast cycle cannot clear a full-cycle error.
    REQUIRE(mb_status().last_error == error && adapter::logs.size() == logs);
    s_cycle_tick = 0;
    mb_poll_once();
    const auto recovered = mb_status();
    REQUIRE(recovered.last_error_code.empty() && recovered.last_error.empty());
    REQUIRE(recovered.last_error_detail == -1 && recovered.last_error_register == 0);
    REQUIRE(adapter::logs.size() == logs + 1 &&
            adapter::logs.back() == "modbus: communication recovered\n");
}
void compressor_witness() {
    for (const auto profile : {ModbusProfile::HomeHub, ModbusProfile::Altherma4}) {
        reset();
        Peer peer(
            false, profile,
            {{MbFunc::ReadInput, 31, 1}, {MbFunc::ReadInput, 52, 0}, {MbFunc::ReadInput, 53, 1}});
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::On);
        REQUIRE(current_activity().dhw == false && current_activity().space == true);
        REQUIRE(mb_status().dhw_operation_known && !mb_status().dhw_operation_active);
        const auto revision = mb_cache_generation();
        peer.set_word(MbFunc::ReadInput, 31, 0);
        peer.set_word(MbFunc::ReadInput, 52, 1);
        peer.set_word(MbFunc::ReadInput, 53, 0);
        sdk::clock_us.fetch_add(1000000);
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::Off);
        REQUIRE(current_activity().dhw == true && current_activity().space == false);
        REQUIRE(mb_status().dhw_operation_known && mb_status().dhw_operation_active);
        REQUIRE(mb_cache_generation() == revision);
        REQUIRE(cached_row(snapshot_rows(), 31).value == "1");
        REQUIRE(cached_row(snapshot_rows(), 52).value == "0");

        for (const uint16_t invalid : {uint16_t{2}, MB_WAIT, MB_UNAVAILABLE, MB_UNSUPPORTED}) {
            s_cycle_tick = 1;
            peer.set_word(MbFunc::ReadInput, 31, invalid);
            mb_poll_once();
            REQUIRE(current_compressor() == ModbusCompressor::Unknown);
            REQUIRE(mb_values_live());
        }

        peer.set_word(MbFunc::ReadInput, 31, 1);
        s_cycle_tick = 1;
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::On);
        const int64_t expiry_us = (s_compressor_ms + MB_REPLY_MAX_AGE_S * 1000LL) * 1000;
        sdk::clock_us           = expiry_us;
        s_last_reply_ms         = expiry_us / 1000;
        REQUIRE(current_compressor() == ModbusCompressor::On);
        sdk::clock_us.fetch_add(1000);
        REQUIRE(mb_values_live());
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        const auto dhw_expiry_us = (s_dhw_operation_ms + MB_REPLY_MAX_AGE_S * 1000LL) * 1000;
        sdk::clock_us            = dhw_expiry_us + 1000;
        s_last_reply_ms          = sdk::clock_us / 1000;
        REQUIRE(mb_values_live());
        REQUIRE(!mb_status().dhw_operation_known && !mb_status().dhw_operation_active);
        REQUIRE(!current_activity().dhw && !current_activity().space);

        s_cycle_tick = 1;
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::On);
        peer.batch_exception      = true;
        peer.compressor_exception = true;
        s_cycle_tick              = 1;
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        REQUIRE(mb_values_live());
        REQUIRE(mb_status().last_error_register == 31);

        peer.compressor_exception = false;
        s_cycle_tick              = 1;
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::On);
        REQUIRE(status_socket_open(s_req_host, 502, 1, 1, s_target_generation));
        const auto disconnected = current_activity();
        REQUIRE(disconnected.compressor == ModbusCompressor::Unknown && !disconnected.dhw &&
                !disconnected.space);
        peer.set_word(MbFunc::ReadInput, 31, 0);
        mb_poll_once();
        REQUIRE(current_compressor() == ModbusCompressor::Off);
        unsigned released  = 0;
        sdk::on_mutex_give = [&] {
            // Overlap the second lock's completed snapshot, before its generation recheck.
            if (++released == 2) mb_reconfigure(false);
        };
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
        sdk::on_mutex_give = {};
        REQUIRE(released >= 2);
        REQUIRE(current_compressor() == ModbusCompressor::Unknown);
    }
}

void space_route_values() {
    // Independent wire expectations: 0 is the space circuit, 1 is DHW, and neither an unknown enum
    // nor a protocol sentinel proves either route. Both profiles and both commit paths use the
    // actual production row decoder; the fast path must not rebuild the full values cache.
    struct RouteCase {
        uint16_t raw;
        bool     known, active;
    };
    const RouteCase cases[]{{0, true, true},
                            {1, true, false},
                            {2, false, false},
                            {MB_WAIT, false, false},
                            {MB_UNAVAILABLE, false, false},
                            {MB_UNSUPPORTED, false, false}};
    for (const auto profile : {ModbusProfile::HomeHub, ModbusProfile::Altherma4}) {
        reset();
        Peer peer(false, profile, {{MbFunc::ReadInput, 37, 0}});
        mb_poll_once();
        REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
        for (uint32_t tick : {0u, 1u}) {
            for (const auto& expected : cases) {
                peer.set_word(MbFunc::ReadInput, 37, expected.raw);
                s_cycle_tick = tick;
                sdk::clock_us.fetch_add(1000000);
                const auto revision = mb_cache_generation();
                mb_poll_once();
                const auto st = mb_status();
                REQUIRE(st.connected && st.plant_gate_known && st.plant_gate_active &&
                        st.heating_mode_known && st.heating_mode_active);
                REQUIRE(st.space_route_known == expected.known);
                REQUIRE(st.space_route_active == expected.active);
                REQUIRE(s_space_route_ms == (expected.known ? sdk::clock_us / 1000 : -1));
                REQUIRE((mb_cache_generation() != revision) == (tick == 0));
            }
        }
    }
}
void space_route_missing() {
    for (const auto profile : {ModbusProfile::HomeHub, ModbusProfile::Altherma4}) {
        reset();
        Peer peer(false, profile, {{MbFunc::ReadInput, 37, 0}});
        mb_poll_once();
        REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
        for (uint32_t tick : {0u, 1u}) {
            // An exception for this one register leaves the socket and other gate replies healthy.
            // Their new replies must not renew the previously observed space-route word.
            peer.batch_exception       = true;
            peer.space_route_exception = true;
            s_cycle_tick               = tick;
            sdk::clock_us.fetch_add(1000000);
            mb_poll_once();
            auto st = mb_status();
            REQUIRE(st.connected && st.plant_gate_known && st.plant_gate_active &&
                    st.heating_mode_known && st.heating_mode_active);
            REQUIRE(!st.space_route_known && !st.space_route_active && s_space_route_ms == -1);
            REQUIRE(st.last_error_register == 37);
            peer.space_route_exception = false;
            s_cycle_tick               = tick;
            sdk::clock_us.fetch_add(1000000);
            mb_poll_once();
            st = mb_status();
            REQUIRE(st.connected && st.space_route_known && st.space_route_active);
        }
    }
}
void space_route_age() {
    reset();
    seed_cache();
    sdk::clock_us   = (1000 + MB_REPLY_MAX_AGE_S * 1000LL) * 1000;
    s_last_reply_ms = sdk::clock_us / 1000;
    REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
    sdk::clock_us.fetch_add(1000); // The first millisecond beyond the inclusive own-reply bound.
    s_last_reply_ms   = sdk::clock_us / 1000;
    s_plant_gate_ms   = s_last_reply_ms;
    s_heating_mode_ms = s_last_reply_ms;
    auto st           = mb_status();
    REQUIRE(st.connected && st.plant_gate_known && st.heating_mode_known);
    REQUIRE(!st.space_route_known && !st.space_route_active);
    for (int64_t absent_or_future : {int64_t{-1}, s_last_reply_ms + 1}) {
        s_space_route_ms = absent_or_future;
        st               = mb_status();
        REQUIRE(st.connected && !st.space_route_known && !st.space_route_active);
    }
    for (uint32_t tick : {0u, 1u}) {
        reset();
        Peer peer(false, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 37, 0}});
        mb_poll_once();
        REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
        peer.batch_exception      = true;
        s_cycle_tick              = tick;
        sdk::transport_time_model = true;
        mb_poll_once();
        sdk::transport_time_model = false;
        const int64_t now_ms      = sdk::clock_us / 1000;
        st                        = mb_status();
        // Execute the complete long fallback sweep. Its late successful replies and final commit
        // cannot turn the early input37 response into a newly observed route, on either path.
        REQUIRE(st.connected && mb_values_live());
        REQUIRE(logic::modbus_observation_age_s(s_space_route_ms, now_ms) > MB_REPLY_MAX_AGE_S);
        REQUIRE(!st.space_route_known && !st.space_route_active);
    }
}
void space_route_cutover() {
    for (bool fast : {false, true}) {
        reset();
        Peer peer(false, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 37, 0}});
        mb_poll_once();
        REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
        s_cycle_tick             = fast ? 1 : 0;
        const auto revision      = s_mb_cache_revision.load();
        int        fast_requests = 0;
        for (int i = 0; i < MB_PLAN.count; ++i)
            if (logic::mb_batch_is_fast(MB_PLAN.batch[i])) ++fast_requests;
        const auto final_rx_ok              = s_status.rx_ok + fast_requests;
        bool       called                   = false;
        int        releases_after_last_read = 0;
        sdk::on_mutex_give                  = [&] {
            if (called) return;
            if (fast) {
                if (s_status.rx_ok != final_rx_ok || ++releases_after_last_read != 2) return;
            } else if (s_mb_cache_revision.load() == revision) {
                return;
            }
            called               = true;
            adapter::cfg.mb_host = "replacement-unresolved";
            mb_reconfigure(false);
        };
        mb_poll_once();
        sdk::on_mutex_give = {};
        REQUIRE(called && !mb_values_live());
        const auto st = mb_status();
        REQUIRE(!st.connected && !st.space_route_known && !st.space_route_active);
        // Check the actual commit too: mb_status's disconnected-age filter must not conceal an
        // old target's affirmative route or response timestamp written after reconfiguration.
        REQUIRE(!s_status.space_route_known && !s_status.space_route_active &&
                s_space_route_ms == -1);
    }
    reset();
    Peer peer(false, ModbusProfile::HomeHub, {{MbFunc::ReadInput, 37, 0}});
    mb_poll_once();
    REQUIRE(mb_status().space_route_known && mb_status().space_route_active);
    close_sock();
    REQUIRE(status_socket_open("successor-session", 502, 1, 0, s_target_generation));
    const auto st = mb_status();
    REQUIRE(!st.space_route_known && !st.space_route_active && s_space_route_ms == -1);
}
void poll_cutover() {
    // A source change after the initial current-session check must still invalidate commit.
    {
        reset();
        Peer peer;
        bool called           = false;
        adapter::history_hook = [&] {
            if (!called) {
                called               = true;
                adapter::cfg.mb_host = "new-peer";
                mb_reconfigure(false);
            }
        };
        mb_poll_once();
        REQUIRE(called && s_cache.empty() && !mb_values_live());
        const auto st = mb_status();
        REQUIRE(!st.connected && st.values == 0 && !st.plant_gate_known && !st.heating_mode_known);
    }
    // Full path: cut over immediately after the new cache is installed and before status commit.
    {
        reset();
        Peer peer;
        bool called        = false;
        sdk::on_mutex_give = [&] {
            if (called || s_cache.empty()) return;
            called = true;
            mb_reconfigure(false);
        };
        mb_poll_once();
        sdk::on_mutex_give = {};
        REQUIRE(called && !mb_values_live());
        const auto st = mb_status();
        REQUIRE(!st.connected && st.values == 0 && !st.plant_gate_known && !st.heating_mode_known);
        REQUIRE(st.profile == ModbusProfile::Auto &&
                st.profile_basis == ModbusProfileBasis::Probing);
        REQUIRE(mb_active_profile() == ModbusProfile::Auto);
    }
    // Fast path: after the completed last read, the next status-mutex release is the
    // current-session check immediately preceding final status commit.
    {
        reset();
        Peer peer;
        mb_poll_once();
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Affirmative);
        int fast_requests = 0;
        for (int i = 0; i < MB_PLAN.count; ++i)
            if (logic::mb_batch_is_fast(MB_PLAN.batch[i])) ++fast_requests;
        const auto final_rx_ok              = s_status.rx_ok + fast_requests;
        bool       called                   = false;
        int        releases_after_last_read = 0;
        sdk::on_mutex_give                  = [&] {
            if (called || s_status.rx_ok != final_rx_ok) return;
            if (++releases_after_last_read != 2) return;
            called = true;
            mb_reconfigure(false);
        };
        mb_poll_once();
        sdk::on_mutex_give = {};
        REQUIRE(called && !mb_values_live());
        const auto st = mb_status();
        REQUIRE(!st.connected && st.values == 0 && !st.plant_gate_known && !st.heating_mode_known);
        REQUIRE(st.profile == ModbusProfile::Auto &&
                st.profile_basis == ModbusProfileBasis::Probing);
        REQUIRE(mb_active_profile() == ModbusProfile::Auto);
    }
}
void zero_cache_commit() {
    reset();
    sdk::clock_us = 0;
    Peer peer;
    mb_poll_once();
    REQUIRE(s_cache_commit_ms == 0 && s_full_cache_status_ms == 0 && s_last_reply_ms == 0);
    REQUIRE(s_plant_gate_ms == 0 && s_heating_mode_ms == 0 && s_space_route_ms == 0 &&
            s_plant_outdoor_ms == 0);
    CachedValue rows[64];
    bool        live = false;
    REQUIRE(mb_values_snapshot(rows, 64, live) == static_cast<size_t>(def::HOMEHUB_REG_COUNT - 1));
    REQUIRE(live && mb_values_live());
    const auto st = mb_status();
    REQUIRE(st.connected && st.values == def::HOMEHUB_REG_COUNT - 1);
    REQUIRE(st.plant_gate_known && st.heating_mode_known && st.space_route_known &&
            !st.space_route_active && st.plant_outdoor.available);
}

void profile_cutover() {
    reset();
    seed_cache();
    s_active_profile       = ModbusProfile::Altherma4;
    s_status.profile       = ModbusProfile::Altherma4;
    s_status.profile_basis = ModbusProfileBasis::Affirmative;
    adapter::cfg.mb_host   = "unresolved-harness.local";
    mb_reconfigure(true);
    mb_poll_once();
    const auto st = mb_status();
    REQUIRE(st.host == "unresolved-harness.local" && st.last_error_code == "resolve_failed");
    std::cout << "target-profile profile=" << int(st.profile) << " basis=" << int(st.profile_basis)
              << " connected=" << st.connected << "\n";
    REQUIRE(st.profile == ModbusProfile::Auto && st.profile_basis == ModbusProfileBasis::Probing);
    REQUIRE(mb_active_profile() == ModbusProfile::Auto);
}
void cache_count() {
    reset();
    Peer peer;
    mb_poll_once();
    const auto committed_count = s_cache.size();
    sdk::clock_us.fetch_add((MB_CACHE_MAX_AGE_S + 1) * 1000000LL);
    mb_poll_once();
    const auto  st   = mb_status();
    bool        live = true;
    CachedValue rows[64];
    const auto  n = mb_values_snapshot(rows, 64, live);
    std::cout << "expired-cache status.values=" << st.values << " stored-rows=" << n
              << " live=" << live << " reply-age=" << mb_reply_age_locked() << "s\n";
    REQUIRE(!live && st.connected);
    REQUIRE(st.values == 0 && n == committed_count);
}
void fallback_watchdog() {
    reset();
    Peer peer(true);
    sdk::transport_time_model = true;
    mb_poll_once();
    sdk::transport_time_model = false;
    int64_t maximum           = 0;
    for (size_t i = 1; i < sdk::watchdog_feeds.size(); ++i)
        maximum = std::max(maximum, sdk::watchdog_feeds[i] - sdk::watchdog_feeds[i - 1]);
    std::cout << "fallback-watchdog max-between-resets=" << maximum / 1000
              << "ms requests=" << peer.requests << " resets=" << sdk::watchdog_feeds.size()
              << "\n";
    REQUIRE(mb_status().connected);
    REQUIRE(maximum < 20000000);
}
void gate_age() {
    reset();
    Peer peer;
    mb_poll_once();
    const int64_t committed_ms = sdk::clock_us / 1000;
    bool          observed     = false;
    peer.batch_exception       = true;
    s_cycle_tick               = 0;
    sdk::transport_time_model  = true;
    sdk::on_send               = [&] {
        if (observed) return;
        const auto elapsed = sdk::clock_us / 1000 - committed_ms;
        if (elapsed < 8000) return;
        const auto st = mb_status();
        observed      = true;
        std::cout << "observation-age age=" << elapsed << "ms reply-age=" << mb_reply_age_locked()
                  << "s gate-known=" << st.plant_gate_known
                  << " outdoor-known=" << st.plant_outdoor.available << "\n";
        REQUIRE(elapsed > MB_REPLY_MAX_AGE_S * 1000LL);
        REQUIRE(!st.plant_gate_known && !st.heating_mode_known && !st.plant_outdoor.available);
    };
    mb_poll_once();
    sdk::transport_time_model = false;
    sdk::on_send              = {};
    REQUIRE(observed);
    // These are NEW measurements from the sweep just committed. A long sweep must not
    // rejuvenate early input38/44 merely because its cache and last reply were committed now.
    const int64_t now_ms    = sdk::clock_us / 1000;
    const auto    completed = mb_status();
    REQUIRE(completed.connected && mb_values_live());
    REQUIRE(logic::modbus_observation_age_s(s_heating_mode_ms, now_ms) > MB_REPLY_MAX_AGE_S);
    REQUIRE(logic::modbus_observation_age_s(s_plant_outdoor_ms, now_ms) > MB_REPLY_MAX_AGE_S);
    REQUIRE(!completed.heating_mode_known && !completed.heating_mode_active);
    REQUIRE(!completed.plant_outdoor.available);
    std::cout << "completed-sweep input38-age=" << now_ms - s_heating_mode_ms
              << "ms input44-age=" << now_ms - s_plant_outdoor_ms << "ms\n";
}

void discovery_budget() {
    reset();
    std::array<mdns_result_t, 64> results;
    for (size_t i = 0; i < results.size(); ++i) {
        results[i].hostname = "homehub-unresolved";
        results[i].next     = i + 1 < results.size() ? &results[i + 1] : nullptr;
    }
    sdk::mdns_results         = results.data();
    sdk::discovery_time_model = true;
    const int64_t start       = sdk::clock_us;
    std::string   found;
    REQUIRE(!mb_discover_homehub(found));
    const auto elapsed = (sdk::clock_us - start) / 1000000;
    std::cout << "discovery controlled-elapsed=" << elapsed
              << "s browse-calls=" << sdk::mdns_ptr_calls << " a-calls=" << sdk::mdns_a_calls
              << "\n";
    REQUIRE(elapsed > 0 && elapsed <= 17 && sdk::mdns_ptr_calls >= 1 && sdk::mdns_ptr_calls <= 3 &&
            sdk::mdns_a_calls < 192);
    sdk::mdns_results         = nullptr;
    sdk::discovery_time_model = false;
}

void lifecycle() {
    reset(/*fail_dynamic_mutex_create=*/true);
    REQUIRE(!mb_status().enabled && !mb_target_enabled() && hp_modbus_ota_quiesced() &&
            mb_network_quiesced());
    for (int i = 0; i < 3; ++i) mb_reconfigure(false);
    REQUIRE(sdk::create_calls == 0 && sdk::mdns_ptr_calls == 0);
    s_start_allowed = false; // same initialized state visible to HTTP before core boot completes
    mb_reconfigure(true);
    mb_retry_start();
    REQUIRE(sdk::create_calls == 0 && mb_target_enabled() && mb_task_pending());
    adapter::weather_active = true;
    mb_start();
    REQUIRE(sdk::create_calls == 0 && mb_task_pending() && mb_network_quiesced());
    adapter::weather_active = false;
    adapter::ota_active     = true;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 0 && mb_task_pending() && mb_network_quiesced());
    adapter::ota_active    = false;
    adapter::largest_block = 6144 + sizeof(StaticTask_t) + 4096 + HEAP_RECOVERY_BYTES - 1;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 0 && !s_task && mb_task_pending());
    adapter::largest_block++;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 0 && mb_task_pending());
    sdk::clock_us += 5000000;
    adapter::free_bytes = 6144 + sizeof(StaticTask_t) + 4096 + HEAP_RECOVERY_BYTES - 1;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 0 && mb_task_pending());
    adapter::free_bytes++;
    sdk::clock_us += 5000000;
    sdk::fail_task_create = true;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 1 && !s_task && !mb_status().enabled);
    REQUIRE(mb_target_enabled() && hp_modbus_ota_quiesced());
    REQUIRE(mb_task_pending());
    const uint32_t generation = s_target_generation.load();
    sdk::fail_task_create     = false;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 1 && mb_task_pending());
    sdk::clock_us += 5000000;
    mb_retry_start();
    REQUIRE(sdk::create_calls == 2 && s_task && !mb_status().enabled);
    REQUIRE(mb_task_pending() && s_target_generation.load() == generation);
    const auto task = s_task;
    // A second boot-side request cannot allocate a duplicate or retire the saved target.
    mb_start();
    REQUIRE(mb_target_enabled() && sdk::create_calls == 2 && s_task == task);
    for (int i = 0; i < 3; ++i) mb_reconfigure(true);
    REQUIRE(sdk::create_calls == 2 && s_task == task);
    REQUIRE(task->stack == 6144 && task->priority == TASK_PRIO_MODBUS);
    s_cache.reserve(16);
    mb_reconfigure(false);
    task->fn(task->arg);
    REQUIRE(sdk::wdt_add == 0 && sdk::wdt_delete == 0 && sdk::delete_calls == 1);
    REQUIRE(!s_task && !mb_status().enabled && s_cache.empty() && s_sock == -1 &&
            hp_modbus_ota_quiesced());
    REQUIRE(s_cache.capacity() == 0);
    mb_reconfigure(true);
    REQUIRE(s_task && sdk::create_calls == 3);
}
void retiring_reenable() {
    reset();
    mb_reconfigure(true);
    const auto old = s_task;
    // The retiring stack can still be charged to the heap when the new save lands.
    sdk::fail_task_create = true;
    bool reenabled        = false;
    bool cleanup_pending  = false;
    sdk::on_mutex_give    = [&] {
        if (!s_task_retiring || reenabled) return;
        reenabled = true;
        mb_reconfigure(true);
        cleanup_pending = s_task == old && sdk::create_calls == 1 && mb_task_pending();
    };
    bool saw_running        = false;
    sdk::on_delay           = [&] {
        if (sdk::delays == 1) {
            REQUIRE(!mb_task_pending());
            mb_reconfigure(false);
            return;
        }
        saw_running = s_mb_task_running;
        REQUIRE(s_task == old && sdk::create_calls == 1 && mb_target_enabled());
        REQUIRE(mb_status().enabled && !mb_task_pending());
        REQUIRE(sdk::wdt_add == 1 && sdk::wdt_delete == 0);
        REQUIRE(saw_running && !hp_modbus_ota_quiesced());
        mb_reconfigure(false);
    };
    old->fn(old->arg);
    REQUIRE(cleanup_pending && saw_running && !s_task && sdk::delete_calls == 1 &&
            sdk::wdt_delete == 1);

    reset();
    mb_reconfigure(true);
    const auto deleting = s_task;
    sdk::on_delay       = [&] { mb_reconfigure(false); };
    sdk::on_wdt_delete  = [&] {
        REQUIRE(mb_network_quiesced());
        mb_reconfigure(true);
        REQUIRE(s_task == deleting && sdk::create_calls == 1 && mb_task_pending());
    };
    deleting->fn(deleting->arg);
    REQUIRE(!s_task && mb_target_enabled() && mb_network_quiesced());
    mb_retry_start();
    REQUIRE(s_task && s_task != deleting && mb_task_pending() && sdk::create_calls == 2);
}
void worker_admission_pressure() {
    reset();
    sdk::fail_lwip_alloc = 1;
    sdk::fail_wdt_add    = 2;
    mb_reconfigure(true);
    adapter::ota_active = true;
    const auto worker   = s_task;
    REQUIRE(worker && mb_task_pending() && !mb_status().enabled);
    sdk::on_delay = [&] {
        REQUIRE(mb_network_quiesced());
        if (sdk::delays == 1) {
            REQUIRE(sdk::lwip_gets == 0 && sdk::wdt_add == 0 && sdk::wdt_reset == 0);
            adapter::ota_active     = false;
            adapter::weather_active = true;
        } else if (sdk::delays == 2) {
            REQUIRE(sdk::lwip_gets == 0 && sdk::wdt_add == 0 && sdk::wdt_reset == 0);
            adapter::weather_active = false;
        } else if (sdk::delays < 6) {
            REQUIRE(mb_task_pending() && !mb_status().enabled && hp_modbus_ota_quiesced());
            REQUIRE(sdk::wdt_reset == 0 && sdk::wdt_delete == 0 && s_sock == -1);
        } else {
            REQUIRE(sdk::lwip_gets == 2 && sdk::lwip_frees == 0);
            REQUIRE(sdk::wdt_add == 3 && sdk::wdt_reset > 0);
            REQUIRE(mb_status().enabled && !mb_task_pending() && !hp_modbus_ota_quiesced());
            mb_reconfigure(false);
        }
    };
    worker->fn(worker->arg);
    REQUIRE(!s_task && sdk::wdt_delete == 1 && sdk::delete_calls == 1);

    reset();
    sdk::fail_lwip_retain = 2;
    mb_reconfigure(true);
    const auto unready = s_task;
    sdk::on_delay      = [&] {
        REQUIRE(sdk::lwip_gets == static_cast<unsigned>(sdk::delays));
        if (sdk::delays < 3) {
            REQUIRE(mb_task_pending() && !mb_status().enabled && hp_modbus_ota_quiesced());
            REQUIRE(sdk::lwip_frees == sdk::lwip_gets && !sdk::lwip_retained);
            REQUIRE(sdk::wdt_add == 0 && sdk::wdt_reset == 0 && sdk::wdt_delete == 0);
            REQUIRE(s_sock == -1);
        } else {
            REQUIRE(sdk::lwip_frees == 2 && sdk::lwip_retained && sdk::wdt_add == 1);
            REQUIRE(!mb_task_pending() && mb_status().enabled);
            mb_reconfigure(false);
        }
    };
    unready->fn(unready->arg);
    REQUIRE(!s_task && sdk::delete_calls == 1 && sdk::wdt_delete == 1);
}
void first_sweep_heap_pressure() {
    for (bool largest : {false, true}) {
        reset();
        mb_reconfigure(true);
        const auto worker = s_task;
        REQUIRE(worker && mb_task_pending());
        auto& available         = largest ? adapter::largest_block : adapter::free_bytes;
        available               = HEAP_RECOVERY_BYTES + MB_FIRST_SWEEP_RESERVE - 1;
        const auto config_reads = adapter::config_reads;
        sdk::on_delay           = [] {
            mb_reconfigure(false);
            throw std::runtime_error("first sweep ran without recovery heap");
        };
        worker->fn(worker->arg);
        REQUIRE(!s_task && mb_task_pending() && mb_target_enabled());
        REQUIRE(sdk::wdt_add == 1 && sdk::wdt_delete == 1 && sdk::delete_calls == 1);
        REQUIRE(adapter::config_reads == config_reads && sdk::socket_connects == 0);
        REQUIRE(mb_network_quiesced() && hp_modbus_ota_quiesced());
        available = 64 * 1024;
        mb_retry_start();
        REQUIRE(!s_task && sdk::create_calls == 1);
        sdk::clock_us += 5000000;
        mb_retry_start();
        REQUIRE(s_task && s_task != worker && sdk::create_calls == 2);
    }
}
void first_sweep_after_tls() {
    reset();
    mb_reconfigure(true);
    const auto worker = s_task;
    const auto reads  = adapter::config_reads;
    sdk::on_wdt_add   = [] { adapter::ota_active = true; };
    sdk::on_delay     = [&] {
        if (sdk::delays != 1) throw std::runtime_error("first sweep used a stale heap check");
        REQUIRE(mb_network_quiesced() && sdk::wdt_add == 1 && adapter::config_reads == reads);
        REQUIRE(mb_task_pending() && !mb_status().enabled);
        adapter::largest_block = HEAP_RECOVERY_BYTES + MB_FIRST_SWEEP_RESERVE - 1;
        adapter::ota_active    = false;
    };
    worker->fn(worker->arg);
    REQUIRE(!s_task && mb_task_pending() && mb_target_enabled());
    REQUIRE(sdk::wdt_add == 1 && sdk::wdt_delete == 1 && sdk::delete_calls == 1);
    REQUIRE(adapter::config_reads == reads && sdk::socket_connects == 0);
}
void socket_setup_and_retirement() {
    for (int option : {SO_RCVTIMEO, SO_SNDTIMEO}) {
        reset();
        TcpListener listener;
        mb_reconfigure(true);
        const auto     worker   = s_task;
        const uint32_t target   = s_target_generation.load();
        sdk::fail_socket_option = option;
        sdk::fail_socket_close  = 2;
        REQUIRE(!mb_ensure_connected("127.0.0.1", listener.port, 1, target, 1));
        REQUIRE(s_sock >= 0 && !s_have_req && !mb_status().connected && sdk::socket_connects == 0);
        const int owned         = s_sock;
        sdk::fail_socket_option = 0;
        REQUIRE(!mb_ensure_connected("127.0.0.1", listener.port, 1, target, 1));
        REQUIRE(s_sock == owned && sdk::socket_connects == 0);
        REQUIRE(mb_ensure_connected("127.0.0.1", listener.port, 1, target, 1));
        const int peer = listener.accept_peer();
        close(peer);
        const int connected = s_sock;
        mb_reconfigure(false);
        sdk::fail_socket_close = 2;
        sdk::on_delay          = [&] {
            REQUIRE(s_task == worker && s_task_retiring && s_sock == connected && !s_have_req);
            REQUIRE(mb_network_quiesced() && sdk::socket_connects == 1);
            if (sdk::delays == 1)
                mb_reconfigure(true);
            else
                mb_reconfigure(false);
        };
        worker->fn(worker->arg);
        REQUIRE(!s_task && s_sock == -1 && sdk::delays == 2 && sdk::delete_calls == 1);
    }
}
void task_oom_and_quiesce() {
    reset();
    seed_cache();
    adapter::cfg.mb_host = "harness-peer";
    mb_reconfigure(true);
    seed_cache();
    const auto task        = s_task;
    adapter::config_throws = true;
    bool checked           = false;
    sdk::on_delay          = [&] {
        checked = true;
        REQUIRE(sdk::delays == 1 && s_cache.size() == 1 && !mb_values_live());
        REQUIRE(mb_network_quiesced());
        REQUIRE(adapter::config_mutex.try_lock());
        adapter::config_mutex.unlock();
        mb_reconfigure(false);
    };
    task->fn(task->arg);
    REQUIRE(checked && sdk::delete_calls == 1 && !s_task);
    REQUIRE(sdk::lock_depth == 0);
    reset();
    mb_reconfigure(true);
    adapter::ota_active = true;
    const auto ota_task = s_task;
    sdk::on_delay       = [&] {
        REQUIRE(hp_modbus_ota_quiesced() && mb_network_quiesced());
        REQUIRE(adapter::config_reads == 1);
        if (sdk::delays == 1) {
            mb_reconfigure(false);
        } else {
            REQUIRE(sdk::delays == 2 && s_task == ota_task && !mb_target_enabled());
            adapter::ota_active = false;
        }
    };
    ota_task->fn(ota_task->arg);
    REQUIRE(sdk::delays == 2 && !s_task && sdk::delete_calls == 1);
}
} // namespace test
int main(int argc, char** argv) {
    std::signal(SIGPIPE, SIG_IGN);
    using T = std::pair<const char*, void (*)()>;
    const T tests[]{{"deadline", test::deadline},
                    {"receive_boundaries", test::receive_boundaries},
                    {"whole_adu_deadline", test::whole_adu_deadline},
                    {"read_success_lifetime", test::read_success_lifetime},
                    {"transaction", test::transaction},
                    {"read_failures", test::read_failures},
                    {"snapshot_generation", test::snapshot_generation},
                    {"expiry", test::expiry},
                    {"reconfigure_generations", test::reconfigure_generations},
                    {"homehub_definition_rows", test::homehub_definition_rows},
                    {"native_definition_rows", test::native_definition_rows},
                    {"native_current_mode", test::native_current_mode},
                    {"native_demand_response", test::native_demand_response},
                    {"native_unit_mode", test::native_unit_mode},
                    {"native_quiet_selection", test::native_quiet_selection},
                    {"native_power_label", test::native_power_label},
                    {"probe_native_promotion", test::probe_native_promotion},
                    {"probe_homehub_rows", test::probe_homehub_rows},
                    {"native_gateway_baseline", test::native_gateway_baseline},
                    {"probe_resolved_peer_reconnect", test::probe_resolved_peer_reconnect},
                    {"definition_snapshot_cutover", test::definition_snapshot_cutover},
                    {"poll_full_fast_break", test::poll_full_fast_break},
                    {"poll_batch_fallback", test::poll_batch_fallback},
                    {"poll_history_reply_boundary", test::poll_history_reply_boundary},
                    {"partial_sweep_allocation_pressure", test::partial_sweep_allocation_pressure},
                    {"compressor_witness", test::compressor_witness},
                    {"space_route_values", test::space_route_values},
                    {"space_route_missing", test::space_route_missing},
                    {"space_route_age", test::space_route_age},
                    {"space_route_cutover", test::space_route_cutover},
                    {"poll_cutover", test::poll_cutover},
                    {"zero_cache_commit", test::zero_cache_commit},
                    {"profile_cutover", test::profile_cutover},
                    {"cache_count", test::cache_count},
                    {"discovery_budget", test::discovery_budget},
                    {"fallback_watchdog", test::fallback_watchdog},
                    {"gate_age", test::gate_age},
                    {"lifecycle", test::lifecycle},
                    {"retiring_reenable", test::retiring_reenable},
                    {"worker_admission_pressure", test::worker_admission_pressure},
                    {"first_sweep_heap_pressure", test::first_sweep_heap_pressure},
                    {"first_sweep_after_tls", test::first_sweep_after_tls},
                    {"socket_setup_and_retirement", test::socket_setup_and_retirement},
                    {"task_oom_and_quiesce", test::task_oom_and_quiesce}};
    std::cout.setf(std::ios::unitbuf);
    int count = 0;
    for (auto& t : tests) {
        if (argc > 1 && std::string(argv[1]) != t.first) continue;
        try {
            t.second();
            std::cout << "PASS " << t.first << "\n";
            ++count;
        } catch (const std::exception& e) {
            std::cerr << "FAIL " << t.first << ": " << e.what() << "\n";
            return 1;
        }
    }
    if (!count) return 2;
    test::reset();
    std::cout << "PASS total=" << count << "\n";
    return 0;
}
