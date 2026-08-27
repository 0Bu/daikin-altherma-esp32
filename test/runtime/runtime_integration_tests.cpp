#include "fake_runtime.hpp"

#include <cstdlib>
#include <iostream>
#include <sstream>

namespace {

using namespace runtime_test;

class Failure : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

#define CHECK(condition)                                                                           \
    do {                                                                                           \
        if (!(condition)) {                                                                        \
            std::ostringstream message;                                                            \
            message << __FILE__ << ':' << __LINE__ << ": CHECK(" #condition ") failed";            \
            throw Failure(message.str());                                                          \
        }                                                                                          \
    } while (false)

#define CHECK_EQ(actual, expected)                                                                 \
    do {                                                                                           \
        const auto check_actual   = (actual);                                                      \
        const auto check_expected = (expected);                                                    \
        if (!(check_actual == check_expected)) {                                                   \
            std::ostringstream message;                                                            \
            message << __FILE__ << ':' << __LINE__                                                 \
                    << ": CHECK_EQ(" #actual ", " #expected ") failed";                            \
            throw Failure(message.str());                                                          \
        }                                                                                          \
    } while (false)

daik::ConfigBlob config_named(std::string name) {
    daik::ConfigBlob config;
    config.wifi_ssid              = std::move(name);
    config.wifi_pass              = "secret";
    config.mqtt_uri               = "mqtt://broker.local";
    config.mqtt_base              = "daikin-altherma-esp32/plant";
    config.mb_host                = "homehub.local";
    config.mb_port                = 502;
    config.mb_unit_id             = 1;
    config.mb_discovery_done      = true;
    config.diagnostics_enabled    = true;
    config.diagnostics_generation = 7;
    return config;
}

void test_nvs_atomic_save_reboot_and_failures(bool mutate_atomicity) {
    AllocationFailpoint      allocations;
    FakeNvs                  nvs(mutate_atomicity);
    ConfigPersistenceAdapter running(nvs, allocations);

    const daik::ConfigBlob original = config_named("original");
    CHECK_EQ(running.save_config(original), NvsResult::Ok);

    // Re-create the adapter: only committed bytes, parsed by the production decoder, cross reboot.
    ConfigPersistenceAdapter rebooted(nvs, allocations);
    daik::ConfigBlob         loaded;
    CHECK(rebooted.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("original"));
    CHECK_EQ(loaded.diagnostics_generation, uint32_t{7});

    const daik::ConfigBlob replacement = config_named("replacement");
    nvs.fail_next_set_no_space();
    CHECK_EQ(rebooted.save_config(replacement), NvsResult::NoSpace);
    ConfigPersistenceAdapter after_full_reboot(nvs, allocations);
    CHECK(after_full_reboot.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("original"));

    nvs.fail_next_commit();
    CHECK_EQ(after_full_reboot.save_config(replacement), NvsResult::CommitFailed);
    ConfigPersistenceAdapter after_commit_failure_reboot(nvs, allocations);
    CHECK(after_commit_failure_reboot.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("original"));

    CHECK_EQ(after_commit_failure_reboot.save_config(replacement), NvsResult::Ok);
    ConfigPersistenceAdapter final_reboot(nvs, allocations);
    CHECK(final_reboot.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("replacement"));

    daik::LinkBlob link{44, 43, 'I', 0x12345678u};
    CHECK_EQ(final_reboot.save_link(link), NvsResult::Ok);
    daik::LinkBlob loaded_link;
    CHECK(final_reboot.load_link(loaded_link));
    CHECK_EQ(loaded_link.rx_pin, 44);
    CHECK_EQ(loaded_link.tx_pin, 43);
    CHECK_EQ(loaded_link.identity_fp, uint32_t{0x12345678u});
}

void test_config_detection_http_interleaving() {
    AllocationFailpoint      allocations;
    FakeNvs                  nvs;
    ConfigPersistenceAdapter persistence(nvs, allocations);
    RuntimeConfigSnapshot    initial{config_named("before"), daik::LinkBlob{44, 43, 'I', 1}, 1};
    CHECK_EQ(persistence.save_config(initial.service), NvsResult::Ok);
    CHECK_EQ(persistence.save_link(initial.link), NvsResult::Ok);
    ConfigCoordinator coordinator(persistence, initial);

    RuntimeConfigSnapshot stale_http_snapshot = coordinator.snapshot();
    stale_http_snapshot.service.mqtt_uri      = "mqtts://new-broker.local";

    VirtualScheduler scheduler;
    bool             detection_saved = false;
    bool             http_saved      = false;
    scheduler.after(10, [&] {
        detection_saved =
            coordinator.commit_detected_link(1, daik::LinkBlob{1, 2, 'S', 0xAABBCCDDu});
    });
    scheduler.after(20, [&] { http_saved = coordinator.save_http(stale_http_snapshot, false); });
    scheduler.run();

    CHECK(detection_saved);
    CHECK(http_saved);
    CHECK_EQ(scheduler.now_ms(), uint64_t{20});
    CHECK_EQ(coordinator.snapshot().service.mqtt_uri, std::string("mqtts://new-broker.local"));
    CHECK_EQ(coordinator.snapshot().link.rx_pin, 1);
    CHECK_EQ(coordinator.snapshot().link.tx_pin, 2);
    CHECK_EQ(coordinator.snapshot().link.proto, 'S');

    ConfigPersistenceAdapter rebooted(nvs, allocations);
    daik::ConfigBlob         service;
    daik::LinkBlob           link;
    CHECK(rebooted.load_config(service));
    CHECK(rebooted.load_link(link));
    CHECK_EQ(service.mqtt_uri, std::string("mqtts://new-broker.local"));
    CHECK_EQ(link.identity_fp, uint32_t{0xAABBCCDDu});
}

void test_oom_http_and_task_guarantees() {
    AllocationFailpoint allocations;
    FakeHttpConnection  before_commit;
    allocations.fail_on(1);
    serve_chunked_json(before_commit, allocations, "{\"healthy\":true}", false);
    CHECK_EQ(before_commit.status, 503);
    CHECK_EQ(before_commit.response_starts, 1);
    CHECK(before_commit.final_chunk);
    CHECK(before_commit.chunks.empty());

    FakeHttpConnection after_commit;
    allocations.fail_on(2);
    serve_chunked_json(after_commit, allocations, "{\"long\":\"payload\"}", true);
    CHECK_EQ(after_commit.status, 200);
    CHECK_EQ(after_commit.response_starts, 1);
    CHECK(after_commit.closed);
    CHECK(!after_commit.final_chunk);
    CHECK_EQ(after_commit.chunks.size(), size_t{1});

    VirtualScheduler scheduler;
    allocations.fail_on(2);
    PeriodicTaskAdapter task(scheduler, allocations, {"sample-1", "sample-2", "sample-3"});
    task.start();
    CHECK(scheduler.run_one());
    CHECK_EQ(task.last_good(), std::string("sample-1"));
    CHECK(scheduler.run_one());
    CHECK_EQ(task.last_good(), std::string("sample-1")); // OOM preserves the prior observation
    CHECK_EQ(task.skipped_oom(), size_t{1});
    CHECK(task.lock_available());
    CHECK(scheduler.run_one());
    CHECK_EQ(task.cycles(), size_t{3});
    CHECK_EQ(task.completed(), size_t{2});
    CHECK_EQ(task.skipped_oom(), size_t{1});
    CHECK_EQ(task.last_good(), std::string("sample-3"));
    CHECK(task.lock_available());
    CHECK_EQ(scheduler.now_ms(), uint64_t{2000});
}

void test_x10a_fragment_noise_and_nak() {
    VirtualScheduler scheduler;
    FakeSerial       serial(scheduler);
    serial.enqueue_now({0x99, 0x88, 0x77}); // uart_flush_input must remove stale noise
    const std::vector<uint8_t> reply = x10a_i_reply(0x10, {0x12, 0x34});
    serial.enqueue_after(5, {reply[0]});
    serial.enqueue_after(25, {reply[1], reply[2]});
    serial.enqueue_after(60, {reply[3], reply[4], reply[5]});
    const X10AQueryResult fragmented = query_x10a(serial, scheduler, 0x10, daik::Protocol::I);
    CHECK_EQ(fragmented.kind, daik::HpReplyKind::Ok);
    CHECK_EQ(fragmented.received, 6);
    CHECK_EQ(serial.flushes(), size_t{1});
    uint8_t expected_request[4] = {};
    CHECK_EQ(daik::build_request(0x10, daik::Protocol::I, expected_request), 4);
    CHECK(std::equal(serial.written().begin(), serial.written().end(), expected_request));

    VirtualScheduler     noisy_scheduler;
    FakeSerial           noisy(noisy_scheduler);
    std::vector<uint8_t> corrupted = reply;
    corrupted.insert(corrupted.begin() + 3,
                     0x55); // noise within the active frame cannot look valid
    noisy.enqueue_after(1, corrupted);
    const X10AQueryResult noisy_result =
        query_x10a(noisy, noisy_scheduler, 0x10, daik::Protocol::I);
    CHECK(noisy_result.kind == daik::HpReplyKind::BadCrc ||
          noisy_result.kind == daik::HpReplyKind::UnexpectedReply);

    VirtualScheduler nak_scheduler;
    FakeSerial       nak(nak_scheduler);
    nak.enqueue_after(3, {0x15});
    nak.enqueue_after(15, {0xEA});
    const X10AQueryResult rejected = query_x10a(nak, nak_scheduler, 0x20, daik::Protocol::I);
    CHECK_EQ(rejected.kind, daik::HpReplyKind::Rejected);
    CHECK_EQ(rejected.received, 2);
}

void test_modbus_fragment_exception_and_desync() {
    const uint16_t txn  = 0x1234;
    const uint8_t  unit = 1;
    const auto     response =
        modbus_read_response(txn, unit, daik::MbFunc::ReadInput, {0x0123, 0xFF9C});
    FakeTcpStream fragmented;
    fragmented.feed({response.begin(), response.begin() + 2});
    fragmented.feed({response.begin() + 2, response.begin() + 7});
    fragmented.feed({response.begin() + 7, response.begin() + 8});
    fragmented.feed({response.begin() + 8, response.end()});
    ModbusReadResult ok = read_modbus(fragmented, txn, unit, daik::MbFunc::ReadInput, 40, 2);
    CHECK_EQ(ok.parse, daik::MbParse::Ok);
    CHECK(fragmented.open());
    CHECK_EQ(fragmented.outbound().size(), size_t{12});
    uint16_t first  = 0;
    uint16_t second = 0;
    CHECK(daik::mb_reg_at(ok.response, 0, first));
    CHECK(daik::mb_reg_at(ok.response, 1, second));
    CHECK_EQ(first, uint16_t{0x0123});
    CHECK_EQ(second, uint16_t{0xFF9C});

    const auto exception = modbus_exception_response(txn + 1, unit, daik::MbFunc::ReadHolding, 2);
    FakeTcpStream exception_stream;
    exception_stream.feed({exception.begin(), exception.begin() + 6});
    exception_stream.feed({exception.begin() + 6, exception.end()});
    ModbusReadResult exc =
        read_modbus(exception_stream, txn + 1, unit, daik::MbFunc::ReadHolding, 56, 1);
    CHECK_EQ(exc.parse, daik::MbParse::Exception);
    CHECK(exc.response.exception);
    CHECK_EQ(exc.response.exc_code, uint8_t{2});
    CHECK(exception_stream.open());

    const auto    stale = modbus_read_response(txn + 1, unit, daik::MbFunc::ReadInput, {1});
    FakeTcpStream desynchronised;
    desynchronised.feed(stale);
    ModbusReadResult mismatch =
        read_modbus(desynchronised, txn + 2, unit, daik::MbFunc::ReadInput, 41, 1);
    CHECK_EQ(mismatch.parse, daik::MbParse::TxnMismatch);
    CHECK(!desynchronised.open());
}

void test_mqtt_reconnect_retained_and_lwt_lifecycle() {
    FakeBroker        broker;
    MqttBridgeAdapter bridge(broker, "board-a", "daikin-altherma-esp32/plant");
    bridge.connect_subscriber();
    CHECK_EQ(bridge.connections(), size_t{1});
    CHECK(!bridge.publisher());

    const auto waiting = bridge.observe_x10a(false, -1);
    CHECK_EQ(waiting.next, daik::MqttPublishGateState::SubscriberOnly);
    CHECK(!broker.retained("daikin-altherma-esp32/plant/status"));

    const auto promoted = bridge.observe_x10a(true, 0);
    CHECK(promoted.promote_publisher);
    CHECK(bridge.publisher());
    CHECK_EQ(bridge.connections(), size_t{2});
    CHECK_EQ(*broker.retained("daikin-altherma-esp32/plant/status"), std::string("online"));
    bridge.publish_state("{\"hydronic\":{\"leaving_water\":31.2}}");
    CHECK(broker.retained("daikin-altherma-esp32/plant/x10a"));

    // One missed sweep stays active; reaching the production 15-second grace emits offline once.
    const auto grace = bridge.observe_x10a(false, 14);
    CHECK(grace.publish_cycle);
    const auto offline = bridge.observe_x10a(false, 15);
    CHECK(offline.publish_offline);
    CHECK_EQ(*broker.retained("daikin-altherma-esp32/plant/status"), std::string("offline"));

    const auto resumed = bridge.observe_x10a(true, 0);
    CHECK(resumed.resumed);
    CHECK_EQ(*broker.retained("daikin-altherma-esp32/plant/status"), std::string("online"));

    broker.publish("board-a", "homeassistant/sensor/retired/config", "{\"old\":true}", true);
    CHECK(broker.retained("homeassistant/sensor/retired/config"));
    bridge.delete_retained("homeassistant/sensor/retired/config");
    CHECK(!broker.retained("homeassistant/sensor/retired/config"));

    bridge.lose_connection();
    CHECK_EQ(*broker.retained("daikin-altherma-esp32/plant/status"), std::string("offline"));
    bridge.reconnect();
    CHECK_EQ(bridge.connections(), size_t{3});
    CHECK_EQ(*broker.retained("daikin-altherma-esp32/plant/status"), std::string("online"));
}

void test_http_body_segmented_oversized_and_chunked() {
    const std::string http_json = "{\"mqtt\":\"mqtt://broker\"}";
    FakeBodyStream    http({
        {FakeBodyStream::Kind::Data, "{\"mqtt\""},
        {FakeBodyStream::Kind::Timeout, ""},
        {FakeBodyStream::Kind::Data, ":\"mqtt://"},
        {FakeBodyStream::Kind::Data, "broker\"}"},
    });
    char              http_buffer[64] = {};
    CHECK_EQ(read_body(http, http_buffer, sizeof(http_buffer), http_json.size()),
             static_cast<int>(http_json.size()));
    CHECK_EQ(std::string(http_buffer), http_json);

    const std::string second_json = "{\"jsonrpc\":\"2.0\"}";
    FakeBodyStream    second_body({
        {FakeBodyStream::Kind::Data, "{"},
        {FakeBodyStream::Kind::Data, "\"jsonrpc\":"},
        {FakeBodyStream::Kind::Data, "\"2.0\"}"},
    });
    char              second_buffer[32] = {};
    CHECK_EQ(read_body(second_body, second_buffer, sizeof(second_buffer), second_json.size()),
             static_cast<int>(second_json.size()));
    CHECK_EQ(std::string(second_buffer), second_json);

    FakeBodyStream oversized({{FakeBodyStream::Kind::Data, std::string(64, 'x')}});
    char           bounded[64] = {};
    CHECK_EQ(read_body(oversized, bounded, sizeof(bounded), sizeof(bounded)), -1);
    CHECK_EQ(oversized.recv_calls(), size_t{0});

    FakeBodyStream second_oversized({{FakeBodyStream::Kind::Data, std::string(32, 'x')}});
    char           second_bounded[32] = {};
    CHECK_EQ(
        read_body(second_oversized, second_bounded, sizeof(second_bounded), sizeof(second_bounded)),
        -1);
    CHECK_EQ(second_oversized.recv_calls(), size_t{0});

    FakeBodyStream stalled({
        {FakeBodyStream::Kind::Timeout, ""},
        {FakeBodyStream::Kind::Timeout, ""},
        {FakeBodyStream::Kind::Timeout, ""},
        {FakeBodyStream::Kind::Data, "{}"},
    });
    CHECK_EQ(read_body(stalled, bounded, sizeof(bounded), 2), -1);
    CHECK_EQ(stalled.recv_calls(), size_t{3});

    std::vector<std::string> chunks;
    bool                     final = false;
    auto                     emit  = [&](std::string_view bytes, bool is_final) {
        CHECK(bytes.size() <= 5);
        if (!bytes.empty()) chunks.emplace_back(bytes);
        if (is_final) final = true;
        return true;
    };
    daik::BoundedChunkSink<decltype(emit), 5> sink(emit);
    CHECK(daik::finish_bounded_stream(sink, [](auto& stream) {
        stream += "0123456789";
        stream += "abcdef";
    }));
    std::string reconstructed;
    for (const std::string& chunk : chunks) reconstructed += chunk;
    CHECK_EQ(reconstructed, std::string("0123456789abcdef"));
    CHECK(final);
    CHECK_EQ(sink.max_buffered(), size_t{5});
}

void test_http_absolute_deadline_stops_trickling_headers(bool mutate_watchdog) {
    // A real socketpair delivers one header byte every 40 ms. Every blocking recv satisfies its
    // 1000 ms transport timeout, but the complete header arrives only after the 200 ms operation
    // deadline. The independent shutdown thread must wake the active recv at that original bound.
    const HttpTrickleResult result =
        run_http_socket_trickle(HttpBlockingCall::FetchHeaders, 40, 1000, 200, !mutate_watchdog);
    CHECK(result.timed_out);
    CHECK(result.socket_shutdown);
    CHECK(!result.call_completed);
    CHECK(result.received < size_t{32});
    CHECK(result.elapsed_ms >= uint64_t{150});
    CHECK(result.elapsed_ms <= uint64_t{5000});
}

void test_http_absolute_deadline_stops_trickling_body(bool mutate_watchdog) {
    // This is the corresponding esp_http_client_read() shape: IDF keeps filling the caller's
    // requested buffer internally. A partial positive return after shutdown is still a timeout,
    // which is why production checks the watchdog verdict regardless of the returned byte count.
    const HttpTrickleResult result =
        run_http_socket_trickle(HttpBlockingCall::ReadBody, 40, 1000, 200, !mutate_watchdog);
    CHECK(result.timed_out);
    CHECK(result.socket_shutdown);
    CHECK(!result.call_completed);
    CHECK(result.received < size_t{32});
    CHECK(result.elapsed_ms >= uint64_t{150});
    CHECK(result.elapsed_ms <= uint64_t{5000});
}

void test_weather_rejects_incomplete_http_body(bool mutate_completion_gate) {
    auto accepted = [&](int64_t claimed, size_t received, bool parser_complete) {
        return mutate_completion_gate ||
               daik::http_body_complete(claimed, received, parser_complete);
    };

    // A syntactically valid JSON prefix is still unusable when HTTP framing proves that bytes are
    // missing. Unknown-length/chunked responses require the parser's complete-message verdict too.
    CHECK(!accepted(512, 384, true));
    CHECK(!accepted(512, 384, false));
    CHECK(!accepted(-1, 384, false));
    CHECK(accepted(384, 384, true));
    CHECK(accepted(-1, 384, true));
}

struct TestCase {
    const char*           name;
    std::function<void()> run;
};

} // namespace

int main(int argc, char** argv) {
    bool mutate_atomicity            = false;
    bool mutate_http_header_deadline = false;
    bool mutate_http_body_deadline   = false;
    bool mutate_weather_completion   = false;
    for (int i = 1; i < argc; ++i) {
        const std::string_view arg(argv[i]);
        if (arg == "--mutate-nvs-atomicity")
            mutate_atomicity = true;
        else if (arg == "--mutate-http-header-deadline")
            mutate_http_header_deadline = true;
        else if (arg == "--mutate-http-body-deadline")
            mutate_http_body_deadline = true;
        else if (arg == "--mutate-weather-body-completion")
            mutate_weather_completion = true;
        else {
            std::cerr << "unknown argument: " << arg << '\n';
            return 2;
        }
    }

    const std::vector<TestCase> tests{
        {"nvs atomic save, reboot and failures",
         [=] { test_nvs_atomic_save_reboot_and_failures(mutate_atomicity); }},
        {"config detection and HTTP controlled interleaving",
         test_config_detection_http_interleaving},
        {"OOM-safe HTTP and periodic task", test_oom_http_and_task_guarantees},
        {"X10A fragmented, noisy and NAK replay", test_x10a_fragment_noise_and_nak},
        {"Modbus fragmented, exception and desync", test_modbus_fragment_exception_and_desync},
        {"MQTT reconnect, retained and LWT lifecycle",
         test_mqtt_reconnect_retained_and_lwt_lifecycle},
        {"HTTP body segmented, oversized and chunked",
         test_http_body_segmented_oversized_and_chunked},
        {"HTTP absolute deadline stops trickling headers",
         [=] { test_http_absolute_deadline_stops_trickling_headers(mutate_http_header_deadline); }},
        {"HTTP absolute deadline stops trickling body",
         [=] { test_http_absolute_deadline_stops_trickling_body(mutate_http_body_deadline); }},
        {"Weather rejects incomplete HTTP body",
         [=] { test_weather_rejects_incomplete_http_body(mutate_weather_completion); }},
    };

    size_t failed = 0;
    for (const TestCase& test : tests) {
        try {
            test.run();
            std::cout << "PASS  " << test.name << '\n';
        } catch (const std::exception& error) {
            ++failed;
            std::cerr << "FAIL  " << test.name << "\n      " << error.what() << '\n';
        }
    }

    if (failed != 0) {
        std::cerr << "runtime integration: " << failed << '/' << tests.size() << " failed\n";
        return 1;
    }
    std::cout << "runtime integration: " << tests.size() << '/' << tests.size() << " passed\n";
    return 0;
}
