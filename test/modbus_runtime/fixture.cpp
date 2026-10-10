// Execute the complete production HomeHub translation unit against SDK-shaped adapters.
// POSIX sockets are real; the optional transport clock model advances SDK time at syscall
// boundaries. See README.md for evidence limits. No copied transport, poll, status or task
// implementation.
#include "sdk.hpp"
#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdarg>
#include <iostream>
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
#define send sdk::timed_send
#define recv sdk::timed_recv
#include HUB_PRODUCTION_SOURCE
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
int create_calls = 0, delete_calls = 0, delays = 0, wdt_add = 0, wdt_delete = 0, wdt_reset = 0,
    mdns_ptr_calls = 0;
std::vector<TaskHandle_t>      tasks;
std::vector<SemaphoreHandle_t> mutexes;
std::function<void()>          on_delay, on_wdt_delete, on_mutex_give;
thread_local int               lock_depth = 0;
int64_t                        time_us() {
    if (!real_clock.load()) return clock_us.load();
    return std::chrono::duration_cast<std::chrono::microseconds>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
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
bool         config_throws = false, net_up = true, ota_active = false, weather_active = false;
int      config_reads = 0, config_saves = 0, history_calls = 0, history_gaps = 0, stack_samples = 0;
uint32_t history_generation = 1;
std::function<void()>    history_hook;
std::vector<std::string> logs;
std::vector<daik::CachedValue> history_rows;
} // namespace adapter
namespace daik {
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
    adapter::logs.emplace_back(buf);
}
bool     net_is_up() { return adapter::net_up; }
bool     ota_download_active() { return adapter::ota_active; }
bool     weather_fetch_active() { return adapter::weather_active; }
void     stack_watch_sample(StackWatch) noexcept { ++adapter::stack_samples; }
uint32_t history_modbus_generation() { return adapter::history_generation; }
void     history_modbus_reset(uint32_t) noexcept { ++adapter::history_generation; }
void     history_record_modbus(const CachedValue* v, size_t n, uint32_t gen) {
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

void reset() {
    sdk::on_delay      = {};
    sdk::on_wdt_delete = {};
    sdk::on_mutex_give = {};
    sdk::on_send       = {};
    sdk::watchdog_feeds.clear();
    sdk::transport_time_model = false;
    sdk::send_delay_us        = 0;
    sdk::receive_delay_us     = 1499000;
    sdk::mdns_results         = nullptr;
    sdk::discovery_time_model = false;
    sdk::mdns_a_calls         = 0;
    close_sock();
    for (auto t : sdk::tasks) delete t;
    sdk::tasks.clear();
    for (auto m : sdk::mutexes) delete m;
    sdk::mutexes.clear();
    s_mtx                  = nullptr;
    s_cache_mtx            = nullptr;
    s_status               = ModbusStatus{};
    s_task                 = nullptr;
    s_link_generation      = 0;
    s_last_reply_ms        = -1;
    s_poll_observed        = false;
    s_full_cache_status_ms = -1;
    s_plant_gate_ms        = -1;
    s_heating_mode_ms      = -1;
    s_plant_outdoor_ms     = -1;
    s_req_host.clear();
    s_req_port   = 0;
    s_unit       = 0;
    s_have_req   = false;
    s_txn        = 0;
    s_cycle_tick = 0;
    s_cache.clear();
    s_cache_generation        = 0;
    s_cache_target_generation = 0;
    s_cache_commit_ms         = 0;
    s_target_generation       = 1;
    s_target_enabled          = false;
    s_mb_task_running         = false;
    s_ota_quiesced            = false;
    s_network_quiesced        = true;
    s_reconfigure_reset       = false;
    s_next_try_us             = 0;
    s_mb_cache_revision       = 1;
    s_active_profile          = ModbusProfile::Auto;
    s_probe_tracker           = logic::ModbusProbeTracker{};
    s_backoff                 = DetectBackoff{};
    for (bool& b : s_batch_split) b = false;
    sdk::clock_us               = 1000000;
    sdk::real_clock             = false;
    sdk::fail_task_create       = false;
    sdk::fail_mutex_create      = false;
    sdk::create_calls           = 0;
    sdk::delete_calls           = 0;
    sdk::delays                 = 0;
    sdk::wdt_add                = 0;
    sdk::wdt_delete             = 0;
    sdk::wdt_reset              = 0;
    sdk::mdns_ptr_calls         = 0;
    sdk::lock_depth             = 0;
    adapter::cfg                = Config{};
    adapter::config_throws      = false;
    adapter::ota_active         = false;
    adapter::weather_active     = false;
    adapter::net_up             = true;
    adapter::config_reads       = 0;
    adapter::config_saves       = 0;
    adapter::history_calls      = 0;
    adapter::history_gaps       = 0;
    adapter::history_generation = 1;
    adapter::stack_samples      = 0;
    adapter::history_hook       = {};
    adapter::logs.clear();
    adapter::history_rows.clear();
    mb_start();
    REQUIRE(s_mtx && s_cache_mtx);
    REQUIRE(sdk::create_calls == 0);
}
struct Pair {
    int a = -1, b = -1;
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
    s_plant_outdoor_ms           = 1000;
    s_status.plant_gate_known    = true;
    s_status.plant_gate_active   = true;
    s_status.heating_mode_known  = true;
    s_status.heating_mode_active = true;
    s_status.plant_outdoor       = logic::outdoor_homehub_evidence(true, true, 12.0);
    CachedValue cv;
    cv.value = "12";
    cv.label = "Outdoor";
    cv.unit  = "°C";
    s_cache.push_back(cv);
}
void snapshot_generation() {
    REQUIRE(MB_CACHE_MAX_AGE_S == 537); // Derived from the current native full/fallback read plan.
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
    REQUIRE(status.values == 0 && !status.plant_gate_known);
    std::cout << "bounds reply=" << MB_REPLY_MAX_AGE_S << "s cache=" << MB_CACHE_MAX_AGE_S << "s\n";
}
void reconfigure_generations() {
    reset();
    seed_cache();
    s_status.last_error_code = "old";
    const auto gen           = s_target_generation.load();
    const auto revision      = mb_cache_generation();
    mb_reconfigure(false);
    REQUIRE(s_target_generation == gen + 1 && !mb_target_enabled());
    REQUIRE(!mb_values_live());
    REQUIRE(s_cache.empty() && mb_cache_generation() == revision + 1);
    const auto status = mb_status();
    REQUIRE(!status.connected && status.values == 0 && !status.plant_gate_known &&
            !status.heating_mode_known);
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
    REQUIRE(!status_socket_open("old", 502, 1, gen));
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
    MbFunc space;
    uint16_t offset;
    uint16_t raw;
};
struct WireRequest {
    MbFunc space;
    uint16_t offset;
    uint16_t count;
};
struct Peer {
    Pair                  pair{300};
    std::atomic<bool>     stop{false};
    std::thread           thread;
    std::atomic<int>      requests{0};
    std::atomic<uint16_t> outdoor{1200};
    std::atomic<bool>     break_link{false};
    std::atomic<bool>     batch_exception{false};
    std::atomic<bool>     probe_exception{false};
    std::mutex           response_mutex;
    std::vector<RegisterWord> words;
    std::vector<WireRequest> wire_requests;
    explicit Peer(bool fallback = false, ModbusProfile profile = ModbusProfile::HomeHub,
                  const std::vector<RegisterWord>& initial_words = {})
        : batch_exception(fallback), words(initial_words) {
        adapter::cfg.mb_host    = "harness-peer";
        adapter::cfg.mb_port    = 502;
        adapter::cfg.mb_unit_id = 1;
        s_sock                  = pair.a;
        pair.a                  = -1;
        s_req_host              = adapter::cfg.mb_host;
        s_req_port              = 502;
        s_unit                  = 1;
        s_have_req              = true;
        s_target_enabled        = true;
        REQUIRE(status_socket_open(s_req_host, 502, 1, s_target_generation));
        if (profile != ModbusProfile::Auto) {
            s_active_profile                    = profile;
            s_probe_tracker.affirmative_profile = profile;
            s_probe_tracker.active_profile      = profile;
            s_probe_tracker.profile_basis       = ModbusProfileBasis::Affirmative;
        }
        thread                              = std::thread([this] {
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
                if ((batch_exception && qty > 1) ||
                    (probe_exception && req[7] == 4 && addr == 78 && qty == 1))
                    r = {req[0], req[1], 0, 0, 0, 3, req[6], uint8_t(req[7] | 0x80), 2};
                else {
                    std::vector<uint16_t> response_words;
                    for (uint16_t i = 0; i < qty; ++i) {
                        const uint16_t off = addr + i + 1;
                        uint16_t w = off == 44 ? outdoor.load() : 1;
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
    MbFunc space;
    uint16_t offset;
    uint16_t raw;
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
    {MbFunc::ReadInput, 65, 4, "4"},
    {MbFunc::ReadInput, 66, 45, "45"},
    {MbFunc::ReadInput, 67, 100, "100"},
    {MbFunc::ReadInput, 68, 75, "75"},
    {MbFunc::ReadInput, 74, 3550, "35.5"},
    {MbFunc::ReadInput, 75, 4900, "49.0"},
    {MbFunc::ReadInput, 76, 5200, "52.0"},
    {MbFunc::ReadInput, 77, 4800, "48.0"},
    {MbFunc::ReadInput, 79, 185, "1.85"},
    {MbFunc::ReadInput, 80, 3300, "33.0"},
    {MbFunc::ReadInput, 83, 3, "3"},
};
std::vector<CatalogFixture> catalog_fixture(bool native) {
    std::vector<CatalogFixture> rows(std::begin(HOMEHUB_WORDS), std::end(HOMEHUB_WORDS));
    if (native) {
        rows.erase(std::remove_if(rows.begin(), rows.end(), [](const auto& row) {
                       return row.space == MbFunc::ReadHolding && row.offset == 57;
                   }), rows.end());
        for (auto& row : rows)
            if (row.space == MbFunc::ReadHolding && row.offset == 9) {
                row.raw = 2;
                row.formatted = "2";
            }
        rows.insert(rows.end(), std::begin(NATIVE_EXTRA_WORDS), std::end(NATIVE_EXTRA_WORDS));
    }
    return rows;
}
std::vector<RegisterWord> wire_words(bool native) {
    std::vector<RegisterWord> words;
    for (const auto& row : catalog_fixture(native)) words.push_back({row.space, row.offset, row.raw});
    return words;
}
std::vector<CachedValue> snapshot_rows(bool expected_live = true) {
    std::vector<CachedValue> rows(mb_values_capacity());
    bool live = false;
    const auto count = mb_values_snapshot(rows.data(), rows.size(), live);
    REQUIRE(live == expected_live);
    rows.resize(count);
    return rows;
}
const CachedValue& cached_row(const std::vector<CachedValue>& rows, uint16_t offset) {
    const auto row = std::find_if(rows.begin(), rows.end(), [=](const auto& value) {
        return value.off == offset;
    });
    REQUIRE(row != rows.end());
    REQUIRE(std::count_if(rows.begin(), rows.end(), [=](const auto& value) {
        return value.off == offset;
    }) == 1);
    return *row;
}
void require_catalog_rows(const std::vector<CachedValue>& rows, bool native) {
    const auto fixture = catalog_fixture(native);
    REQUIRE(rows.size() == (native ? 42u : 32u));
    REQUIRE(rows.size() == fixture.size());
    const auto* definitions = native ? def::ALTHERMA4_REGS : def::HOMEHUB_REGS;
    const int count = native ? def::ALTHERMA4_REG_COUNT : def::HOMEHUB_REG_COUNT;
    for (int i = 0; i < count; ++i) {
        const auto& definition = definitions[i];
        const auto& row = cached_row(rows, definition.offset);
        const auto* resolved = def::homehub_definition(row.modbus_definition);
        REQUIRE(resolved == &definition);
        REQUIRE(def::homehub_definition_is_altherma4(row.modbus_definition) == native);
        REQUIRE(row.reg == def::HOMEHUB_GROUP_REG && !row.held);
        REQUIRE(row.label == definition.label && row.unit == definition.unit);
        REQUIRE(row.conv == (definition.type == MbType::Text16 ? 204 :
                             definition.kind == def::HomeHubValueKind::Binary ? 300 : 0));
        const auto expected = std::find_if(fixture.begin(), fixture.end(), [&](const auto& value) {
            return value.space == definition.space && value.offset == definition.offset;
        });
        REQUIRE(expected != fixture.end());
        REQUIRE(row.value == expected->formatted);
    }
}
void require_request_spans(const std::vector<WireRequest>& requests, bool native) {
    std::vector<WireRequest> expected = {
        {MbFunc::ReadHolding, 1, 4}, {MbFunc::ReadHolding, 6, 2},
        {MbFunc::ReadHolding, 9, 2}, {MbFunc::ReadHolding, 54, 1},
        {MbFunc::ReadHolding, 56, native ? uint16_t{1} : uint16_t{3}},
        {MbFunc::ReadInput, 21, 3}, {MbFunc::ReadInput, 30, 4},
        {MbFunc::ReadInput, 37, 2}, {MbFunc::ReadInput, 40, 6},
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
        if (a.space != b.space) return static_cast<uint8_t>(a.space) < static_cast<uint8_t>(b.space);
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
    REQUIRE(def::homehub_definition(cached_row(rows, 9).modbus_definition)->kind ==
            def::HomeHubValueKind::Binary);
    REQUIRE(std::string(cached_row(rows, 57).label) == "Power limit during Recommended on / buffering");
    REQUIRE(std::string(cached_row(rows, 58).label) == "General power limit");
    // EKRHH input38 has no zero/None state; native's recognized inactive zero must not leak here.
    peer.set_word(MbFunc::ReadInput, 38, 0);
    s_cycle_tick = 0;
    mb_poll_once();
    const auto zero_rows = snapshot_rows();
    const auto& zero = cached_row(zero_rows, 38);
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
    Peer peer(false, ModbusProfile::Altherma4, wire_words(true));
    std::vector<uint16_t> raw_values;
    for (uint16_t raw = 0; raw <= max_value + 1; ++raw) raw_values.push_back(raw);
    raw_values.insert(raw_values.end(), {17, MB_WAIT, MB_UNAVAILABLE, MB_UNSUPPORTED});
    for (uint16_t raw : raw_values) {
        peer.set_word(space, offset, raw);
        s_cycle_tick = 0;
        mb_poll_once();
        const auto rows = snapshot_rows();
        const auto& row = cached_row(rows, offset);
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
    const auto rows = snapshot_rows();
    const auto& row = cached_row(rows, 58);
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
    peer.batch_exception = false;
    const auto first_requests = peer.requests_snapshot().size();
    mb_poll_once();
    rows = snapshot_rows();
    require_catalog_rows(rows, true);
    const auto requests = peer.requests_snapshot();
    require_request_spans(std::vector<WireRequest>(requests.begin() + first_requests, requests.end()),
                          true);
}
void probe_homehub_rows() {
    // An affirmative unsupported-register exception leaves all32 baseline definitions intact.
    for (bool exception : {false, true}) {
        reset();
        auto words = wire_words(false);
        words.push_back({MbFunc::ReadInput, 79, MB_UNSUPPORTED});
        Peer peer(false, ModbusProfile::Auto, words);
        peer.probe_exception = exception;
        mb_poll_once();
        require_catalog_rows(snapshot_rows(), false);
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
        require_catalog_rows(snapshot_rows(), false);
        REQUIRE(mb_status().profile == ModbusProfile::Auto);
        REQUIRE(mb_status().profile_basis == ModbusProfileBasis::Probing);
        REQUIRE(peer.requests == MB_PLAN.count + 1);
    }
}
void definition_snapshot_cutover() {
    for (const auto profile : {ModbusProfile::HomeHub, ModbusProfile::Altherma4}) {
        reset();
        const bool native = profile == ModbusProfile::Altherma4;
        Peer peer(false, profile, wire_words(native));
        mb_poll_once();
        auto retained_copy = snapshot_rows();
        bool called = false;
        sdk::on_mutex_give = [&] {
            if (called) return;
            called = true;
            adapter::cfg.mb_host = "replacement-unresolved";
            mb_reconfigure(true);
        };
        auto overlapping_copy = snapshot_rows(false);
        sdk::on_mutex_give = {};
        REQUIRE(called && !mb_values_live() && s_cache.empty());
        REQUIRE(mb_active_profile() == ModbusProfile::Auto);
        // Both copied buffers keep their own row identity even though they are no longer live.
        require_catalog_rows(retained_copy, native);
        require_catalog_rows(overlapping_copy, native);
    }
}
void poll_full_fast_break() {
    reset();
    Peer peer;
    mb_poll_once();
    const auto revision = mb_cache_generation();
    const auto count    = s_cache.size();
    REQUIRE(count == static_cast<size_t>(def::HOMEHUB_REG_COUNT));
    REQUIRE(mb_values_live());
    auto st = mb_status();
    REQUIRE(st.connected && st.plant_gate_known && st.plant_gate_active && st.heating_mode_known &&
            st.heating_mode_active);
    REQUIRE(st.plant_outdoor.available && st.plant_outdoor.temperature_c == 12.0);
    const auto requests = peer.requests.load();
    peer.outdoor        = 1800;
    sdk::clock_us.fetch_add(1000000);
    mb_poll_once();
    st = mb_status();
    REQUIRE(mb_cache_generation() == revision && s_cache.size() == count);
    REQUIRE(st.plant_outdoor.temperature_c == 18.0);
    REQUIRE(peer.requests.load() > requests && peer.requests.load() - requests < MB_PLAN.count);
    peer.break_link = true;
    sdk::clock_us.fetch_add(1000000);
    mb_poll_once();
    st = mb_status();
    REQUIRE(!st.connected && st.values == 0 && !st.plant_gate_known && !st.heating_mode_known &&
            !st.plant_outdoor.available);
    REQUIRE(!mb_values_live());
    REQUIRE(st.last_error_code == "connection_closed");
}
void poll_batch_fallback() {
    reset();
    Peer peer(true);
    mb_poll_once();
    REQUIRE(mb_values_live());
    REQUIRE(s_cache.size() == static_cast<size_t>(def::HOMEHUB_REG_COUNT));
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
    REQUIRE(s_plant_gate_ms == 0 && s_heating_mode_ms == 0 && s_plant_outdoor_ms == 0);
    CachedValue rows[64];
    bool        live = false;
    REQUIRE(mb_values_snapshot(rows, 64, live) == static_cast<size_t>(def::HOMEHUB_REG_COUNT));
    REQUIRE(live && mb_values_live());
    const auto st = mb_status();
    REQUIRE(st.connected && st.values == def::HOMEHUB_REG_COUNT);
    REQUIRE(st.plant_gate_known && st.heating_mode_known && st.plant_outdoor.available);
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
    reset();
    REQUIRE(!mb_status().enabled && !mb_target_enabled() && hp_modbus_ota_quiesced() &&
            mb_network_quiesced());
    for (int i = 0; i < 3; ++i) mb_reconfigure(false);
    REQUIRE(sdk::create_calls == 0 && sdk::mdns_ptr_calls == 0);
    sdk::fail_task_create = true;
    mb_reconfigure(true);
    REQUIRE(sdk::create_calls == 1 && !s_task && !mb_status().enabled);
    REQUIRE(mb_target_enabled() && hp_modbus_ota_quiesced());
    sdk::fail_task_create = false;
    mb_reconfigure(true);
    REQUIRE(sdk::create_calls == 2 && s_task && mb_status().enabled);
    const auto task = s_task;
    for (int i = 0; i < 3; ++i) mb_reconfigure(true);
    REQUIRE(sdk::create_calls == 2 && s_task == task);
    REQUIRE(task->stack == 6144 && task->priority == TASK_PRIO_MODBUS);
    mb_reconfigure(false);
    task->fn(task->arg);
    REQUIRE(sdk::wdt_add == 1 && sdk::wdt_delete == 1 && sdk::delete_calls == 1);
    REQUIRE(!s_task && !mb_status().enabled && s_cache.empty() && s_sock == -1 &&
            hp_modbus_ota_quiesced());
    mb_reconfigure(true);
    REQUIRE(s_task && sdk::create_calls == 3);
}
void retiring_reenable() {
    reset();
    mb_reconfigure(true);
    const auto old = s_task;
    mb_reconfigure(false);
    sdk::on_wdt_delete = [&] {
        mb_reconfigure(true);
        REQUIRE(s_task == old && sdk::create_calls == 1);
    };
    old->fn(old->arg);
    sdk::on_wdt_delete = {};
    REQUIRE(sdk::create_calls == 2 && s_task != old && mb_target_enabled());
    REQUIRE(!s_mb_task_running && !s_ota_quiesced);
    REQUIRE(mb_status().enabled);
    const auto successor    = s_task;
    adapter::weather_active = true;
    bool saw_running        = false;
    sdk::on_delay           = [&] {
        saw_running = s_mb_task_running;
        REQUIRE(saw_running && !hp_modbus_ota_quiesced());
        mb_reconfigure(false);
    };
    successor->fn(successor->arg);
    REQUIRE(saw_running && !s_task && sdk::delete_calls == 2);
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
        mb_reconfigure(false);
    };
    ota_task->fn(ota_task->arg);
    REQUIRE(!s_task && sdk::delete_calls == 1);
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
                    {"definition_snapshot_cutover", test::definition_snapshot_cutover},
                    {"poll_full_fast_break", test::poll_full_fast_break},
                    {"poll_batch_fallback", test::poll_batch_fallback},
                    {"poll_cutover", test::poll_cutover},
                    {"zero_cache_commit", test::zero_cache_commit},
                    {"profile_cutover", test::profile_cutover},
                    {"cache_count", test::cache_count},
                    {"discovery_budget", test::discovery_budget},
                    {"fallback_watchdog", test::fallback_watchdog},
                    {"gate_age", test::gate_age},
                    {"lifecycle", test::lifecycle},
                    {"retiring_reenable", test::retiring_reenable},
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
