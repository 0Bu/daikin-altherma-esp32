#pragma once

// Deterministic host adapters for the ESP-IDF boundaries which cannot be linked into the ordinary
// pure-logic test binary.  These fakes deliberately model transactions, stream fragmentation,
// reconnects and task scheduling; they are not source-text assertions.  Production decisions stay
// in the IDF-free headers included below and are called by the adapters.

#include "logic/chunk_sink.hpp"
#include "logic/config_store.hpp"
#include "logic/crc.hpp"
#include "logic/http_body.hpp"
#include "logic/http_deadline.hpp"
#include "logic/modbus.hpp"
#include "logic/mqtt_publish_gate.hpp"
#include "logic/payload_complete.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <limits>
#include <map>
#include <mutex>
#include <optional>
#include <queue>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

namespace runtime_test {

// ── Deterministic time and failpoints ───────────────────────────────────────────────────────────

class VirtualScheduler {
public:
    using Task = std::function<void()>;

    uint64_t now_ms() const { return now_ms_; }

    void after(uint64_t delay_ms, Task task) {
        queue_.push(Event{now_ms_ + delay_ms, next_order_++, std::move(task)});
    }

    bool run_one() {
        if (queue_.empty()) return false;
        Event event = queue_.top();
        queue_.pop();
        now_ms_ = event.at_ms;
        event.task();
        return true;
    }

    bool run_one_until(uint64_t deadline_ms) {
        if (queue_.empty() || queue_.top().at_ms > deadline_ms) {
            now_ms_ = std::max(now_ms_, deadline_ms);
            return false;
        }
        return run_one();
    }

    void run() {
        while (run_one()) {}
    }

    void advance_to(uint64_t target_ms) {
        while (!queue_.empty() && queue_.top().at_ms <= target_ms) run_one();
        now_ms_ = std::max(now_ms_, target_ms);
    }

private:
    struct Event {
        uint64_t at_ms;
        uint64_t order;
        Task     task;
    };
    struct Later {
        bool operator()(const Event& a, const Event& b) const {
            if (a.at_ms != b.at_ms) return a.at_ms > b.at_ms;
            return a.order > b.order;
        }
    };

    uint64_t                                              now_ms_     = 0;
    uint64_t                                              next_order_ = 0;
    std::priority_queue<Event, std::vector<Event>, Later> queue_;
};

// Real POSIX-socket adapter for the blocking receive shape in ESP-IDF v6.0.2. Both
// esp_http_client_fetch_headers() and esp_http_client_read() can call the transport repeatedly
// inside one public API invocation. A byte inside every receive timeout therefore defeats that
// per-call limit unless an independent socket watchdog interrupts the invocation.
enum class HttpBlockingCall : uint8_t { FetchHeaders, ReadBody };

struct HttpTrickleResult {
    size_t   received        = 0;
    bool     call_completed  = false;
    bool     socket_shutdown = false;
    bool     timed_out       = false;
    uint64_t elapsed_ms      = 0;
};

inline HttpTrickleResult run_http_socket_trickle(HttpBlockingCall call, uint64_t trickle_ms,
                                                 uint64_t transport_timeout_ms,
                                                 uint64_t absolute_deadline_ms,
                                                 bool     socket_watchdog_enabled) {
    int sockets[2] = {-1, -1};
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sockets) != 0)
        throw std::runtime_error("socketpair failed");

    const timeval timeout{static_cast<time_t>(transport_timeout_ms / 1000),
                          static_cast<suseconds_t>((transport_timeout_ms % 1000) * 1000)};
    if (setsockopt(sockets[0], SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)) != 0) {
        close(sockets[0]);
        close(sockets[1]);
        throw std::runtime_error("SO_RCVTIMEO failed");
    }
#ifdef SO_NOSIGPIPE
    const int no_sigpipe = 1;
    (void)setsockopt(sockets[1], SOL_SOCKET, SO_NOSIGPIPE, &no_sigpipe, sizeof(no_sigpipe));
#endif

    // Completion is deliberately more than one second after the 200 ms watchdog used by the
    // regression tests. Even a heavily delayed scheduler cannot let a short burst cross the finish
    // line before the watchdog thread gets CPU; the mutation remains bounded at about 1.3 s.
    const std::string bytes   = call == HttpBlockingCall::FetchHeaders
                                    ? std::string(28, 'h') + "\r\n\r\n"
                                    : std::string(32, 'b');
    const auto        started = std::chrono::steady_clock::now();
    std::atomic<bool> stop_writer{false};
    std::atomic<bool> deadline_fired{false};
    std::thread       writer([&] {
        for (size_t i = 0; i < bytes.size() && !stop_writer.load(); ++i) {
            std::this_thread::sleep_until(started +
                                                std::chrono::milliseconds((i + 1) * trickle_ms));
            if (stop_writer.load()) break;
            int send_flags = 0;
#ifdef MSG_NOSIGNAL
            send_flags = MSG_NOSIGNAL;
#endif
            if (send(sockets[1], bytes.data() + i, 1, send_flags) != 1) break;
        }
    });
    std::thread watchdog;
    if (socket_watchdog_enabled) {
        watchdog = std::thread([&] {
            std::this_thread::sleep_until(started +
                                          std::chrono::milliseconds(absolute_deadline_ms));
            deadline_fired.store(true);
            (void)shutdown(sockets[0], SHUT_RDWR);
        });
    }

    HttpTrickleResult result;
    std::string       received;
    received.reserve(bytes.size());
    while (received.size() < bytes.size()) {
        char      byte = 0;
        const int n    = static_cast<int>(recv(sockets[0], &byte, 1, 0));
        if (n <= 0) break;
        received.push_back(byte);
        if (call == HttpBlockingCall::FetchHeaders && received.size() >= 4 &&
            received.compare(received.size() - 4, 4, "\r\n\r\n") == 0)
            break;
    }

    result.received = received.size();
    result.call_completed =
        call == HttpBlockingCall::FetchHeaders
            ? received.size() >= 4 && received.compare(received.size() - 4, 4, "\r\n\r\n") == 0
            : received.size() == bytes.size();
    result.socket_shutdown = deadline_fired.load();
    result.elapsed_ms = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
                                                  std::chrono::steady_clock::now() - started)
                                                  .count());
    result.timed_out  = result.socket_shutdown || daik::http_deadline_reached_at<uint64_t>(
                                                     0, result.elapsed_ms, absolute_deadline_ms);

    stop_writer.store(true);
    if (watchdog.joinable()) watchdog.join();
    writer.join();
    close(sockets[0]);
    close(sockets[1]);
    return result;
}

class AllocationFailpoint {
public:
    void fail_on(size_t ordinal) {
        calls_   = 0;
        fail_on_ = ordinal;
    }
    void clear() {
        calls_   = 0;
        fail_on_ = 0;
    }
    void checkpoint(std::string_view label) {
        last_label_ = std::string(label);
        ++calls_;
        if (fail_on_ != 0 && calls_ == fail_on_) throw std::bad_alloc();
    }
    size_t             calls() const { return calls_; }
    const std::string& last_label() const { return last_label_; }

private:
    size_t      calls_   = 0;
    size_t      fail_on_ = 0;
    std::string last_label_;
};

enum class NvsResult { Ok, NoSpace, CommitFailed };

class FakeNvs {
public:
    explicit FakeNvs(bool mutate_atomicity = false) : mutate_atomicity_(mutate_atomicity) {}

    void fail_next_set_no_space() { fail_set_ = true; }
    void fail_next_commit() { fail_commit_ = true; }

    NvsResult atomic_put(std::string key, std::vector<uint8_t> value) {
        ++set_calls_;
        if (fail_set_) {
            fail_set_ = false;
            return NvsResult::NoSpace;
        }

        // NVS stages the new value and changes the durable entry only after commit.  The mutation
        // used by the runner selftest violates precisely this property, so the reboot test—not an
        // explicit "mutation flag" assertion—must catch it.
        pending_ = Entry{std::move(key), std::move(value)};
        if (mutate_atomicity_) durable_[pending_->key] = pending_->value;
        if (fail_commit_) {
            fail_commit_ = false;
            pending_.reset();
            return NvsResult::CommitFailed;
        }
        durable_[pending_->key] = pending_->value;
        pending_.reset();
        ++commit_calls_;
        return NvsResult::Ok;
    }

    std::optional<std::vector<uint8_t>> get(std::string_view key) const {
        const auto it = durable_.find(std::string(key));
        if (it == durable_.end()) return std::nullopt;
        return it->second;
    }

    size_t set_calls() const { return set_calls_; }
    size_t commit_calls() const { return commit_calls_; }

private:
    struct Entry {
        std::string          key;
        std::vector<uint8_t> value;
    };

    bool                                                  mutate_atomicity_ = false;
    bool                                                  fail_set_         = false;
    bool                                                  fail_commit_      = false;
    size_t                                                set_calls_        = 0;
    size_t                                                commit_calls_     = 0;
    std::optional<Entry>                                  pending_;
    std::unordered_map<std::string, std::vector<uint8_t>> durable_;
};

// Executes the real on-flash serializers around the fake NVS transaction.  Reconstructing this
// object with the same FakeNvs is the host equivalent of a reboot: no RAM state is carried over.
class ConfigPersistenceAdapter {
public:
    ConfigPersistenceAdapter(FakeNvs& nvs, AllocationFailpoint& allocations)
        : nvs_(nvs), allocations_(allocations) {}

    NvsResult save_config(const daik::ConfigBlob& config) {
        if (!daik::config_blob_strings_fit(config)) return NvsResult::NoSpace;
        allocations_.checkpoint("config serialize");
        return nvs_.atomic_put("cfg", daik::config_blob_serialize(config));
    }

    NvsResult save_link(const daik::LinkBlob& link) {
        allocations_.checkpoint("link serialize");
        return nvs_.atomic_put("link", daik::link_blob_serialize(link));
    }

    bool load_config(daik::ConfigBlob& out) const {
        const auto raw = nvs_.get("cfg");
        return raw && daik::config_blob_deserialize(raw->data(), raw->size(), out);
    }

    bool load_link(daik::LinkBlob& out) const {
        const auto raw = nvs_.get("link");
        return raw && daik::link_blob_deserialize(raw->data(), raw->size(), out);
    }

private:
    FakeNvs&             nvs_;
    AllocationFailpoint& allocations_;
};

struct RuntimeConfigSnapshot {
    daik::ConfigBlob service;
    daik::LinkBlob   link;
    uint32_t         revision = 0;
};

// Minimal executable form of config.cpp's ownership rule: detection owns only the link and uses a
// revision compare-and-commit; an HTTP writer with a stale snapshot carries the newer link forward.
class ConfigCoordinator {
public:
    ConfigCoordinator(ConfigPersistenceAdapter& persistence, RuntimeConfigSnapshot initial)
        : persistence_(persistence), current_(std::move(initial)) {}

    RuntimeConfigSnapshot snapshot() const { return current_; }

    bool commit_detected_link(uint32_t expected_revision, const daik::LinkBlob& link) {
        if (current_.revision != expected_revision) return false;
        if (persistence_.save_link(link) != NvsResult::Ok) return false;
        current_.link = link;
        ++current_.revision;
        return true;
    }

    bool save_http(RuntimeConfigSnapshot requested, bool require_link) {
        if (requested.revision != current_.revision) requested.link = current_.link;
        if (persistence_.save_config(requested.service) != NvsResult::Ok) return false;
        const bool link_ok = persistence_.save_link(requested.link) == NvsResult::Ok;
        if (require_link && !link_ok) return false;
        current_.service = std::move(requested.service);
        if (link_ok) current_.link = requested.link;
        ++current_.revision;
        return true;
    }

private:
    ConfigPersistenceAdapter& persistence_;
    RuntimeConfigSnapshot     current_;
};

// ── OOM-safe HTTP and periodic task adapters ────────────────────────────────────────────────────

struct FakeHttpConnection {
    int                      status          = 0;
    int                      response_starts = 0;
    bool                     final_chunk     = false;
    bool                     closed          = false;
    std::vector<std::string> chunks;

    bool emit(std::string_view bytes, bool final) {
        if (closed) return false;
        if (!bytes.empty()) {
            if (response_starts == 0) {
                status          = 200;
                response_starts = 1;
            }
            chunks.emplace_back(bytes);
        }
        if (final) final_chunk = true;
        return true;
    }

    void service_unavailable() {
        if (response_starts != 0) throw std::logic_error("second HTTP response after commit");
        status          = 503;
        response_starts = 1;
        final_chunk     = true;
    }
};

inline void serve_chunked_json(FakeHttpConnection& connection, AllocationFailpoint& allocations,
                               std::string_view payload, bool fail_after_first_chunk) {
    try {
        allocations.checkpoint("HTTP snapshot");
        auto emit = [&connection](std::string_view bytes, bool final) {
            return connection.emit(bytes, final);
        };
        daik::BoundedChunkSink<decltype(emit), 8> sink(emit);
        const bool complete = daik::finish_bounded_stream(sink, [&](auto& stream) {
            if (!fail_after_first_chunk) {
                stream += payload;
                return;
            }
            stream += payload.substr(0, std::min<size_t>(8, payload.size()));
            stream += '!'; // forces the full first buffer to be emitted
            allocations.checkpoint("HTTP serializer after commit");
            stream += payload.substr(std::min<size_t>(8, payload.size()));
        });
        if (!complete) connection.closed = true;
    } catch (const std::bad_alloc&) {
        if (connection.response_starts == 0)
            connection.service_unavailable();
        else
            connection.closed = true;
    } catch (...) {
        if (connection.response_starts == 0) {
            connection.status          = 500;
            connection.response_starts = 1;
            connection.final_chunk     = true;
        } else {
            connection.closed = true;
        }
    }
}

class PeriodicTaskAdapter {
public:
    PeriodicTaskAdapter(VirtualScheduler& scheduler, AllocationFailpoint& allocations,
                        std::vector<std::string> samples)
        : scheduler_(scheduler), allocations_(allocations), samples_(std::move(samples)) {}

    void start() {
        scheduler_.after(0, [this] { cycle(); });
    }

    size_t             completed() const { return completed_; }
    size_t             skipped_oom() const { return skipped_oom_; }
    size_t             cycles() const { return cycles_; }
    const std::string& last_good() const { return last_good_; }
    bool               lock_available() {
        if (!mutex_.try_lock()) return false;
        mutex_.unlock();
        return true;
    }

private:
    void cycle() {
        const size_t index = cycles_++;
        try {
            allocations_.checkpoint("periodic task build");
            std::string staged = samples_.at(index); // allocating work is outside the mutex
            std::lock_guard<std::mutex> lock(mutex_);
            last_good_.swap(staged);
            ++completed_;
        } catch (const std::bad_alloc&) {
            ++skipped_oom_;
        }
        if (cycles_ < samples_.size()) scheduler_.after(1000, [this] { cycle(); });
    }

    VirtualScheduler&        scheduler_;
    AllocationFailpoint&     allocations_;
    std::vector<std::string> samples_;
    std::mutex               mutex_;
    std::string              last_good_;
    size_t                   completed_   = 0;
    size_t                   skipped_oom_ = 0;
    size_t                   cycles_      = 0;
};

// ── Stream fakes ────────────────────────────────────────────────────────────────────────────────

class FakeBodyStream {
public:
    enum class Kind { Data, Timeout, Error };
    struct Event {
        Kind        kind;
        std::string data;
    };

    explicit FakeBodyStream(std::deque<Event> events) : events_(std::move(events)) {}

    daik::BodyChunk recv(char* dst, size_t cap) {
        ++recv_calls_;
        if (events_.empty()) return {daik::BodyRecv::Error, 0};
        Event& event = events_.front();
        if (event.kind == Kind::Timeout) {
            events_.pop_front();
            return {daik::BodyRecv::Timeout, 0};
        }
        if (event.kind == Kind::Error) {
            events_.pop_front();
            return {daik::BodyRecv::Error, 0};
        }
        const size_t take = std::min(cap, event.data.size());
        std::memcpy(dst, event.data.data(), take);
        event.data.erase(0, take);
        if (event.data.empty()) events_.pop_front();
        return {daik::BodyRecv::Data, take};
    }

    size_t recv_calls() const { return recv_calls_; }

private:
    std::deque<Event> events_;
    size_t            recv_calls_ = 0;
};

inline int read_body(FakeBodyStream& source, char* dst, size_t cap, size_t announced) {
    return daik::http_body_read(dst, cap, announced,
                                [&source](char* out, size_t len) { return source.recv(out, len); });
}

class FakeSerial {
public:
    explicit FakeSerial(VirtualScheduler& scheduler) : scheduler_(scheduler) {}

    void enqueue_now(std::vector<uint8_t> bytes) {
        for (const uint8_t byte : bytes) incoming_.push_back(byte);
    }

    void enqueue_after(uint64_t delay_ms, std::vector<uint8_t> bytes) {
        scheduler_.after(delay_ms, [this, bytes = std::move(bytes)] {
            for (const uint8_t byte : bytes) incoming_.push_back(byte);
        });
    }

    void flush_input() {
        incoming_.clear();
        ++flushes_;
    }

    void write(const uint8_t* bytes, size_t length) { written_.assign(bytes, bytes + length); }

    bool read_byte(uint8_t& out, uint64_t deadline_ms) {
        while (incoming_.empty() && scheduler_.now_ms() < deadline_ms) {
            if (!scheduler_.run_one_until(deadline_ms)) break;
        }
        if (incoming_.empty()) return false;
        out = incoming_.front();
        incoming_.pop_front();
        return true;
    }

    const std::vector<uint8_t>& written() const { return written_; }
    size_t                      flushes() const { return flushes_; }

private:
    VirtualScheduler&    scheduler_;
    std::deque<uint8_t>  incoming_;
    std::vector<uint8_t> written_;
    size_t               flushes_ = 0;
};

struct X10AQueryResult {
    daik::HpReplyKind       kind     = daik::HpReplyKind::NoReply;
    int                     received = 0;
    std::array<uint8_t, 64> bytes{};
};

inline X10AQueryResult query_x10a(FakeSerial& serial, VirtualScheduler& scheduler, uint8_t reg,
                                  daik::Protocol protocol, uint64_t timeout_ms = 200) {
    X10AQueryResult result;
    int             expected = daik::reply_len(reg, protocol);
    if (!daik::reply_len_valid(protocol, expected, result.bytes.size())) {
        result.kind = daik::HpReplyKind::InvalidLength;
        return result;
    }
    uint8_t   request[4]  = {};
    const int request_len = daik::build_request(reg, protocol, request);
    serial.flush_input();
    serial.write(request, static_cast<size_t>(request_len));

    const uint64_t deadline = scheduler.now_ms() + timeout_ms;
    while (result.received < expected && scheduler.now_ms() <= deadline) {
        uint8_t byte = 0;
        if (!serial.read_byte(byte, deadline)) break;
        result.bytes[static_cast<size_t>(result.received++)] = byte;
        if (result.received == 2 && daik::is_error_reply(result.bytes.data(), result.received)) {
            result.kind = daik::HpReplyKind::Rejected;
            return result;
        }
        if (protocol == daik::Protocol::I && result.received == 3) {
            expected = daik::reply_len_dynamic(result.bytes.data());
            if (!daik::reply_len_valid(protocol, expected, result.bytes.size())) {
                result.kind = daik::HpReplyKind::InvalidLength;
                return result;
            }
        }
    }
    result.kind =
        daik::hp_reply_classify(reg, protocol, result.bytes.data(), result.received, expected);
    return result;
}

// TCP delivers a byte stream, not packets.  read_exact consumes arbitrary peer fragments and keeps
// unused bytes for the next read, matching recv_all/recv_adu in hp_modbus.cpp.
class FakeTcpStream {
public:
    void feed(std::vector<uint8_t> fragment) { fragments_.push_back(std::move(fragment)); }

    bool read_exact(uint8_t* dst, size_t wanted) {
        size_t copied = 0;
        while (copied < wanted) {
            if (fragments_.empty() || !open_) return false;
            std::vector<uint8_t>& front = fragments_.front();
            const size_t          take  = std::min(wanted - copied, front.size() - front_offset_);
            std::memcpy(dst + copied, front.data() + front_offset_, take);
            copied += take;
            front_offset_ += take;
            if (front_offset_ == front.size()) {
                fragments_.pop_front();
                front_offset_ = 0;
            }
        }
        return true;
    }

    void send(const uint8_t* data, size_t size) { outbound_.assign(data, data + size); }
    void close() { open_ = false; }
    bool open() const { return open_; }
    const std::vector<uint8_t>& outbound() const { return outbound_; }

private:
    std::deque<std::vector<uint8_t>> fragments_;
    size_t                           front_offset_ = 0;
    bool                             open_         = true;
    std::vector<uint8_t>             outbound_;
};

struct ModbusReadResult {
    daik::MbParse                         parse = daik::MbParse::TooShort;
    daik::MbResponse                      response;
    std::array<uint8_t, daik::MB_ADU_MAX> adu{};
    int                                   adu_length = 0;
};

inline ModbusReadResult read_modbus(FakeTcpStream& transport, uint16_t txn, uint8_t unit,
                                    daik::MbFunc function, uint16_t address, uint16_t quantity) {
    ModbusReadResult result;
    uint8_t          request[16] = {};
    const int        request_len =
        daik::mb_build_read(request, sizeof(request), txn, unit, function, address, quantity);
    if (request_len < 0) return result;
    transport.send(request, static_cast<size_t>(request_len));

    if (!transport.read_exact(result.adu.data(), 6)) {
        transport.close();
        return result;
    }
    const uint16_t remaining = daik::mb_get_u16(result.adu.data() + 4);
    if (remaining < 2 || static_cast<size_t>(6 + remaining) > result.adu.size() ||
        !transport.read_exact(result.adu.data() + 6, remaining)) {
        transport.close();
        return result;
    }
    result.adu_length = 6 + remaining;
    result.parse      = daik::mb_parse_response(result.adu.data(), result.adu_length, txn, unit,
                                                function, quantity, result.response);
    // Production keeps a valid exception response on the same socket; framing/request-binding
    // failures mean the byte stream is desynchronised and force reconnect.
    if (result.parse != daik::MbParse::Ok && result.parse != daik::MbParse::Exception)
        transport.close();
    return result;
}

// ── MQTT broker and bridge lifecycle ────────────────────────────────────────────────────────────

struct LastWill {
    std::string topic;
    std::string payload;
    bool        retained = true;
};

class FakeBroker {
public:
    void connect(std::string client_id, std::optional<LastWill> will) {
        sessions_[std::move(client_id)] = Session{true, std::move(will)};
    }

    void publish(std::string_view client_id, std::string topic, std::string payload,
                 bool retained) {
        const auto it = sessions_.find(std::string(client_id));
        if (it == sessions_.end() || !it->second.connected)
            throw std::logic_error("publish from disconnected MQTT client");
        messages_.push_back({topic, payload, retained});
        if (retained) {
            if (payload.empty())
                retained_.erase(topic);
            else
                retained_[std::move(topic)] = std::move(payload);
        }
    }

    void disconnect(std::string_view client_id, bool unexpected) {
        auto it = sessions_.find(std::string(client_id));
        if (it == sessions_.end() || !it->second.connected) return;
        it->second.connected = false;
        if (unexpected && it->second.will) {
            const LastWill& will = *it->second.will;
            messages_.push_back({will.topic, will.payload, will.retained});
            if (will.retained) retained_[will.topic] = will.payload;
        }
    }

    std::optional<std::string> retained(std::string_view topic) const {
        const auto it = retained_.find(std::string(topic));
        if (it == retained_.end()) return std::nullopt;
        return it->second;
    }

    bool connected(std::string_view client_id) const {
        const auto it = sessions_.find(std::string(client_id));
        return it != sessions_.end() && it->second.connected;
    }

    size_t message_count() const { return messages_.size(); }

private:
    struct Session {
        bool                    connected;
        std::optional<LastWill> will;
    };
    struct Message {
        std::string topic;
        std::string payload;
        bool        retained;
    };

    std::unordered_map<std::string, Session>     sessions_;
    std::unordered_map<std::string, std::string> retained_;
    std::vector<Message>                         messages_;
};

class MqttBridgeAdapter {
public:
    MqttBridgeAdapter(FakeBroker& broker, std::string client_id, std::string base)
        : broker_(broker), client_id_(std::move(client_id)), base_(std::move(base)) {}

    void connect_subscriber() {
        broker_.connect(client_id_, std::nullopt);
        mqtt_connected_ = true;
        ++connections_;
    }

    daik::MqttPublishGateDecision observe_x10a(bool connected, int32_t last_ok_s) {
        auto decision = daik::mqtt_publish_gate_step(state_, connected, last_ok_s, mqtt_connected_);
        state_        = decision.next;
        if (decision.promote_publisher) {
            broker_.disconnect(client_id_, false);
            broker_.connect(client_id_, LastWill{base_ + "/status", "offline", true});
            ++connections_;
            broker_.publish(client_id_, base_ + "/status", "online", true);
            publisher_      = true;
            mqtt_connected_ = true;
        }
        if (decision.publish_offline)
            broker_.publish(client_id_, base_ + "/status", "offline", true);
        if (decision.resumed) broker_.publish(client_id_, base_ + "/status", "online", true);
        return decision;
    }

    void publish_state(std::string payload) {
        if (!publisher_ || state_ != daik::MqttPublishGateState::Active)
            throw std::logic_error("ordinary publish outside active X10A gate");
        broker_.publish(client_id_, base_ + "/x10a", std::move(payload), true);
    }

    void delete_retained(std::string topic) {
        broker_.publish(client_id_, std::move(topic), "", true);
    }

    void lose_connection() {
        broker_.disconnect(client_id_, true);
        mqtt_connected_ = false;
    }

    void reconnect() {
        broker_.connect(client_id_, publisher_ ? std::optional<LastWill>(
                                                     LastWill{base_ + "/status", "offline", true})
                                               : std::nullopt);
        mqtt_connected_ = true;
        ++connections_;
        if (publisher_) broker_.publish(client_id_, base_ + "/status", "online", true);
    }

    size_t connections() const { return connections_; }
    bool   publisher() const { return publisher_; }

private:
    FakeBroker&                broker_;
    std::string                client_id_;
    std::string                base_;
    daik::MqttPublishGateState state_          = daik::MqttPublishGateState::SubscriberOnly;
    bool                       mqtt_connected_ = false;
    bool                       publisher_      = false;
    size_t                     connections_    = 0;
};

inline std::vector<uint8_t> x10a_i_reply(uint8_t reg, std::initializer_list<uint8_t> payload) {
    std::vector<uint8_t> reply{0x40, reg, static_cast<uint8_t>(payload.size() + 2)};
    reply.insert(reply.end(), payload.begin(), payload.end());
    reply.push_back(daik::crc(reply.data(), static_cast<int>(reply.size())));
    return reply;
}

inline std::vector<uint8_t> modbus_read_response(uint16_t txn, uint8_t unit, daik::MbFunc function,
                                                 std::initializer_list<uint16_t> values) {
    const uint8_t        byte_count = static_cast<uint8_t>(values.size() * 2);
    std::vector<uint8_t> adu(static_cast<size_t>(9 + byte_count));
    daik::mb_put_u16(adu.data(), txn);
    daik::mb_put_u16(adu.data() + 2, 0);
    daik::mb_put_u16(adu.data() + 4, static_cast<uint16_t>(3 + byte_count));
    adu[6]        = unit;
    adu[7]        = static_cast<uint8_t>(function);
    adu[8]        = byte_count;
    size_t offset = 9;
    for (uint16_t value : values) {
        daik::mb_put_u16(adu.data() + offset, value);
        offset += 2;
    }
    return adu;
}

inline std::vector<uint8_t> modbus_exception_response(uint16_t txn, uint8_t unit,
                                                      daik::MbFunc function, uint8_t code) {
    std::vector<uint8_t> adu(9);
    daik::mb_put_u16(adu.data(), txn);
    daik::mb_put_u16(adu.data() + 2, 0);
    daik::mb_put_u16(adu.data() + 4, 3);
    adu[6] = unit;
    adu[7] = static_cast<uint8_t>(static_cast<uint8_t>(function) | 0x80u);
    adu[8] = code;
    return adu;
}

} // namespace runtime_test
