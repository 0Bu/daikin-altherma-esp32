#include "fake_runtime.hpp"

#include <cstdlib>
#include <iostream>
#include <new>
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

// A configured, previously detected installation as config_load would hand it over. The revision is
// the live one every snapshot of it carries.
daik::Config config_named(std::string name) {
    daik::Config config;
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
    config.env3_enabled           = true;
    config.rx_pin                 = 44;
    config.tx_pin                 = 43;
    config.proto                  = daik::Protocol::I;
    config.x10a_identity_fp       = 1;
    config.runtime_revision       = 1;
    return config;
}

// First durable state of a device: both entries written by the production service save.
void seed_durable(ConfigCoordinator& coordinator) {
    CHECK_EQ(coordinator.save(coordinator.snapshot(), /*owns_link=*/false).result,
             daik::ConfigSaveResult::Saved);
}

// The /set_hp X10A edit as the handler derives it: the parsed patch applied to a snapshot.
daik::Config with_pins(daik::Config snapshot, int rx, int tx) {
    daik::SetHpX10aPatch patch;
    patch.rx_sent = true;
    patch.rx      = rx;
    patch.tx_sent = true;
    patch.tx      = tx;
    bool reset    = false;
    CHECK(daik::set_hp_apply_x10a(snapshot, patch, reset));
    return snapshot;
}

// The other X10A edit: pinning a concrete model profile. The id is a RAM-only string longer than
// the small-string buffer, so a save that takes it must replace live's "auto" buffer.
daik::Config with_profile(daik::Config snapshot, const char* profile) {
    daik::SetHpX10aPatch patch;
    patch.profile_sent = true;
    patch.profile      = profile;
    bool reset         = false;
    CHECK(daik::set_hp_apply_x10a(snapshot, patch, reset));
    return snapshot;
}

void test_nvs_atomic_save_reboot_and_failures(bool mutate_atomicity) {
    FakeNvs           nvs(mutate_atomicity);
    ConfigCoordinator running(nvs, config_named("original"));
    seed_durable(running);

    // Re-create the adapter: only durable bytes, parsed by the production decoder, cross reboot.
    ConfigPersistenceAdapter rebooted(nvs);
    daik::ConfigBlob         loaded;
    CHECK(rebooted.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("original"));
    CHECK_EQ(loaded.diagnostics_generation, uint32_t{7});

    // A failed set leaves the previous entry in place, in RAM and after a reboot. There is no
    // second failure point: nvs_commit is a no-op on IDF v6.1, so the set is the whole write.
    daik::Config replacement = running.snapshot();
    replacement.wifi_ssid    = "new-net";
    nvs.fail_next_set_no_space();
    const daik::ConfigSaveOutcome failed = running.save(replacement, false);
    CHECK_EQ(failed.result, daik::ConfigSaveResult::Failed);
    CHECK_EQ(failed.failed, daik::ConfigSaveStep::ServiceWrite);
    CHECK_EQ(running.snapshot().wifi_ssid, std::string("original"));
    ConfigPersistenceAdapter after_failure(nvs);
    CHECK(after_failure.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("original"));

    CHECK_EQ(running.save(replacement, false).result, daik::ConfigSaveResult::Saved);
    ConfigPersistenceAdapter final_reboot(nvs);
    CHECK(final_reboot.load_config(loaded));
    CHECK_EQ(loaded.wifi_ssid, std::string("new-net"));

    const DetectedLinkCommit detected = running.commit_detected_link(
        running.snapshot().runtime_revision, 16, 17, daik::Protocol::S, 0x12345678u);
    CHECK(detected.committed);
    CHECK(detected.saved);
    daik::LinkBlob loaded_link;
    CHECK(final_reboot.load_link(loaded_link));
    CHECK_EQ(loaded_link.rx_pin, 16);
    CHECK_EQ(loaded_link.tx_pin, 17);
    CHECK_EQ(loaded_link.proto, 'S');
    CHECK_EQ(loaded_link.identity_fp, uint32_t{0x12345678u});
}

void test_config_detection_http_interleaving() {
    FakeNvs           nvs;
    ConfigCoordinator coordinator(nvs, config_named("before"));
    seed_durable(coordinator);
    const uint32_t initial_revision = coordinator.snapshot().runtime_revision;

    daik::Config stale_http_snapshot = coordinator.snapshot();
    stale_http_snapshot.mqtt_uri     = "mqtts://new-broker.local";

    VirtualScheduler        scheduler;
    DetectedLinkCommit      detection;
    bool                    model_saved = false;
    daik::ConfigSaveOutcome http;
    scheduler.after(10, [&] {
        detection = coordinator.commit_detected_link(initial_revision, 1, 2, daik::Protocol::S,
                                                     0xAABBCCDDu);
    });
    scheduler.after(15, [&] {
        model_saved = coordinator.commit_detected_model(detection.revision, "altherma3_r_erga");
    });
    scheduler.after(20, [&] { http = coordinator.save(stale_http_snapshot, false); });
    scheduler.run();

    CHECK(detection.committed);
    CHECK(detection.saved);
    CHECK(model_saved);
    CHECK_EQ(http.result, daik::ConfigSaveResult::Saved);
    CHECK_EQ(scheduler.now_ms(), uint64_t{20});
    CHECK_EQ(coordinator.snapshot().mqtt_uri, std::string("mqtts://new-broker.local"));
    CHECK_EQ(coordinator.snapshot().rx_pin, 1);
    CHECK_EQ(coordinator.snapshot().tx_pin, 2);
    CHECK(coordinator.snapshot().proto == daik::Protocol::S);
    CHECK_EQ(coordinator.snapshot().profile, std::string("altherma3_r_erga"));
    CHECK_EQ(coordinator.snapshot().fp_valid, true);

    ConfigPersistenceAdapter rebooted(nvs);
    daik::ConfigBlob         service;
    daik::LinkBlob           link;
    CHECK(rebooted.load_config(service));
    CHECK(rebooted.load_link(link));
    CHECK_EQ(service.mqtt_uri, std::string("mqtts://new-broker.local"));
    CHECK_EQ(link.identity_fp, uint32_t{0xAABBCCDDu});

    // Case B: Save-before-detection (HTTP commits first, then detection commits)
    {
        daik::Config snap = coordinator.snapshot();
        snap.wifi_ssid    = "new-net";
        CHECK_EQ(coordinator.save(snap, false).result, daik::ConfigSaveResult::Saved);
        CHECK_EQ(coordinator.snapshot().wifi_ssid, std::string("new-net"));
        CHECK_EQ(coordinator.snapshot().profile, std::string("altherma3_r_erga"));
        CHECK_EQ(coordinator.snapshot().fp_valid, true);

        // Detection re-commits with new model
        const uint32_t cur_rev = coordinator.snapshot().runtime_revision;
        CHECK(coordinator.commit_detected_model(cur_rev, "altherma3_geo"));
        CHECK_EQ(coordinator.snapshot().profile, std::string("altherma3_geo"));
        CHECK_EQ(coordinator.snapshot().fp_valid, true);
        CHECK_EQ(coordinator.snapshot().wifi_ssid, std::string("new-net"));
    }

    // Case C (CFG-04): an X10A /set_hp owns the link but derived its model fields from its
    // snapshot. A detection commit after that snapshot makes the save Stale: nothing is written and
    // the detected link and model survive. The handler's retry from a fresh snapshot then commits
    // its pins without reverting the model, and writes only the link entry (CFG-03).
    {
        const daik::Config       stale_hp   = with_pins(coordinator.snapshot(), 10, 11);
        const DetectedLinkCommit overtaking = coordinator.commit_detected_link(
            stale_hp.runtime_revision, 3, 4, daik::Protocol::I, 0x55667788u);
        CHECK(overtaking.committed);
        CHECK(coordinator.commit_detected_model(overtaking.revision, "altherma3_r_erga"));
        CHECK(stale_hp.runtime_revision != coordinator.snapshot().runtime_revision);
        const size_t sets_before = nvs.set_calls();
        CHECK_EQ(coordinator.save(stale_hp, /*owns_link=*/true).result,
                 daik::ConfigSaveResult::Stale);
        CHECK_EQ(nvs.set_calls(), sets_before);
        CHECK_EQ(coordinator.snapshot().rx_pin, 3);
        CHECK_EQ(coordinator.snapshot().tx_pin, 4);
        CHECK_EQ(coordinator.snapshot().profile, std::string("altherma3_r_erga"));
        CHECK_EQ(coordinator.snapshot().fp_valid, true);
        ConfigPersistenceAdapter after_refusal(nvs);
        daik::LinkBlob           refused_link;
        CHECK(after_refusal.load_link(refused_link));
        CHECK_EQ(refused_link.rx_pin, 3);
        CHECK_EQ(refused_link.identity_fp, uint32_t{0x55667788u});

        const daik::Config fresh_hp = with_pins(coordinator.snapshot(), 10, 11);
        const size_t       cfg_sets = nvs.sets(daik::CONFIG_KEY_SERVICE);
        CHECK_EQ(coordinator.save(fresh_hp, /*owns_link=*/true).result,
                 daik::ConfigSaveResult::Saved);
        CHECK_EQ(nvs.sets(daik::CONFIG_KEY_SERVICE), cfg_sets);
        CHECK_EQ(coordinator.snapshot().rx_pin, 10);
        CHECK_EQ(coordinator.snapshot().tx_pin, 11);
        CHECK(coordinator.snapshot().proto == daik::Protocol::I);
        CHECK_EQ(coordinator.snapshot().profile, std::string("altherma3_r_erga"));
        CHECK_EQ(coordinator.snapshot().fp_valid, true);
    }
}

void test_config_save_failure_boundaries() {
    // Service save, "cfg" write fails: the first write is the only one attempted, nothing durable
    // and nothing in RAM changes, and a reboot finds the previous entries.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        const size_t link_sets = nvs.sets(daik::CONFIG_KEY_LINK);

        daik::Config request = coordinator.snapshot();
        request.wifi_ssid    = "new-net";
        nvs.fail_next_set_no_space(daik::CONFIG_KEY_SERVICE);
        const daik::ConfigSaveOutcome out = coordinator.save(request, false);
        CHECK_EQ(out.result, daik::ConfigSaveResult::Failed);
        CHECK_EQ(out.failed, daik::ConfigSaveStep::ServiceWrite);
        CHECK_EQ(nvs.sets(daik::CONFIG_KEY_LINK), link_sets);
        CHECK_EQ(coordinator.snapshot().wifi_ssid, std::string("original"));
        CHECK_EQ(coordinator.snapshot().runtime_revision, request.runtime_revision);
        daik::ConfigBlob service;
        CHECK(ConfigPersistenceAdapter(nvs).load_config(service));
        CHECK_EQ(service.wifi_ssid, std::string("original"));
    }

    // Service save, the best-effort "link" write fails after "cfg" landed: the request is saved.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        daik::Config request = coordinator.snapshot();
        request.wifi_ssid    = "new-net";
        nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);
        const daik::ConfigSaveOutcome out = coordinator.save(request, false);
        CHECK_EQ(out.result, daik::ConfigSaveResult::Saved);
        CHECK_EQ(out.failed, daik::ConfigSaveStep::LinkWrite);
        CHECK_EQ(coordinator.snapshot().wifi_ssid, std::string("new-net"));
        daik::ConfigBlob         service;
        daik::LinkBlob           link;
        ConfigPersistenceAdapter rebooted(nvs);
        CHECK(rebooted.load_config(service));
        CHECK(rebooted.load_link(link));
        CHECK_EQ(service.wifi_ssid, std::string("new-net"));
        CHECK_EQ(link.rx_pin, 44);
    }

    // X10A save: only the link entry is ever set. The armed "cfg" failure stays unspent, which is
    // what proves no "cfg" write was attempted; the next service save then trips it.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        const size_t cfg_sets = nvs.sets(daik::CONFIG_KEY_SERVICE);
        nvs.fail_next_set_no_space(daik::CONFIG_KEY_SERVICE);

        const daik::ConfigSaveOutcome out =
            coordinator.save(with_pins(coordinator.snapshot(), 10, 11), /*owns_link=*/true);
        CHECK_EQ(out.result, daik::ConfigSaveResult::Saved);
        CHECK_EQ(out.failed, daik::ConfigSaveStep::None);
        CHECK_EQ(nvs.sets(daik::CONFIG_KEY_SERVICE), cfg_sets);
        CHECK(nvs.failure_pending());
        CHECK_EQ(coordinator.snapshot().rx_pin, 10);
        daik::LinkBlob link;
        CHECK(ConfigPersistenceAdapter(nvs).load_link(link));
        CHECK_EQ(link.rx_pin, 10);
        CHECK_EQ(link.tx_pin, 11);

        CHECK_EQ(coordinator.save(coordinator.snapshot(), false).result,
                 daik::ConfigSaveResult::Failed);
        CHECK(!nvs.failure_pending());
    }

    // X10A save, the link write fails: no side effect at all. Nothing durable, no "cfg" attempt,
    // RAM and the revision exactly as they were, so a retry starts from the same snapshot.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        const size_t       cfg_sets = nvs.sets(daik::CONFIG_KEY_SERVICE);
        const daik::Config before   = coordinator.snapshot();
        nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);

        const daik::ConfigSaveOutcome out =
            coordinator.save(with_pins(before, 10, 11), /*owns_link=*/true);
        CHECK_EQ(out.result, daik::ConfigSaveResult::Failed);
        CHECK_EQ(out.failed, daik::ConfigSaveStep::LinkWrite);
        CHECK_EQ(nvs.sets(daik::CONFIG_KEY_SERVICE), cfg_sets);
        CHECK_EQ(coordinator.snapshot().rx_pin, 44);
        CHECK_EQ(coordinator.snapshot().tx_pin, 43);
        CHECK_EQ(coordinator.snapshot().runtime_revision, before.runtime_revision);
        daik::LinkBlob link;
        CHECK(ConfigPersistenceAdapter(nvs).load_link(link));
        CHECK_EQ(link.rx_pin, 44);
        CHECK_EQ(link.tx_pin, 43);
    }

    // CFG-03/a: config_load sanitised the RAM config without persisting it (ENV III fell back to
    // disabled, its stored mapping kept for repair). An X10A pin repair must not write that RAM
    // view over the stored service settings, and a reboot afterwards must still find them.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        const auto cfg_before = nvs.get(daik::CONFIG_KEY_SERVICE);
        CHECK(cfg_before.has_value());
        coordinator.sanitize_ram_only([](daik::Config& live) { live.env3_enabled = false; });
        CHECK(!coordinator.snapshot().env3_enabled);

        CHECK_EQ(coordinator.save(with_pins(coordinator.snapshot(), 10, 11), true).result,
                 daik::ConfigSaveResult::Saved);
        CHECK(nvs.get(daik::CONFIG_KEY_SERVICE) == cfg_before); // byte-identical
        ConfigPersistenceAdapter rebooted(nvs);
        daik::ConfigBlob         service;
        daik::LinkBlob           link;
        CHECK(rebooted.load_config(service));
        CHECK(rebooted.load_link(link));
        CHECK(service.env3_enabled);
        CHECK_EQ(link.rx_pin, 10);
        CHECK_EQ(link.tx_pin, 11);
    }

    // Detection's link commit: a failed cache write still applies the proven link to this session
    // and says so; a reboot finds the previous cache, which the identity check then rejects.
    {
        FakeNvs           nvs;
        ConfigCoordinator coordinator(nvs, config_named("original"));
        seed_durable(coordinator);
        nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);
        const DetectedLinkCommit out = coordinator.commit_detected_link(
            coordinator.snapshot().runtime_revision, 16, 17, daik::Protocol::S, 0x77u);
        CHECK(out.committed);
        CHECK(!out.saved);
        CHECK_EQ(coordinator.snapshot().rx_pin, 16);
        CHECK(coordinator.snapshot().proto == daik::Protocol::S);
        daik::LinkBlob link;
        CHECK(ConfigPersistenceAdapter(nvs).load_link(link));
        CHECK_EQ(link.rx_pin, 44);
        CHECK_EQ(link.identity_fp, uint32_t{1});
    }
}

void test_config_transactions_allocate_nothing_after_first_write(bool mutate_late_allocation) {
    // The global allocation functions of this binary count the calling thread's allocations while a
    // transaction's store is alive. Whatever can throw must happen before the first durable write,
    // so nothing may allocate once it has begun — on success or on any failure that follows it.
    // Staging must have allocated, otherwise a zero would only show that the counter is blind.
    // Reach: the paths below only. A late allocation shows as soon as it happens, but a publication
    // that copies instead of moving allocates only when the new value outgrows the buffer it
    // replaces, so the scenarios that publish a longer string (the service saves and the X10A
    // profile pin) are the ones that prove the move; the pin-only and detected-link scenarios
    // publish no string.
    auto expect_quiet = [&](const ConfigCoordinator& coordinator, size_t writes) {
        const TransactionWitness& witness = coordinator.witness();
        CHECK_EQ(witness.writes, writes);
        CHECK(witness.staging_allocations > 0);
        CHECK_EQ(witness.late_allocations, size_t{0});
    };
    struct Scenario {
        FakeNvs           nvs;
        ConfigCoordinator coordinator;
        explicit Scenario(bool allocate_late)
            : coordinator(nvs, config_named("original"), allocate_late) {}
        daik::Config service_request() const {
            daik::Config request = coordinator.snapshot();
            request.wifi_ssid    = std::string(40, 'x'); // past the small-string buffer
            return request;
        }
    };

    { // service save: success
        Scenario s(mutate_late_allocation);
        CHECK_EQ(s.coordinator.save(s.service_request(), false).result,
                 daik::ConfigSaveResult::Saved);
        expect_quiet(s.coordinator, 2);
    }
    { // service save: the "cfg" write fails
        Scenario s(mutate_late_allocation);
        s.nvs.fail_next_set_no_space(daik::CONFIG_KEY_SERVICE);
        CHECK_EQ(s.coordinator.save(s.service_request(), false).result,
                 daik::ConfigSaveResult::Failed);
        expect_quiet(s.coordinator, 1);
    }
    { // service save: the "link" write fails after "cfg" landed
        Scenario s(mutate_late_allocation);
        s.nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);
        CHECK_EQ(s.coordinator.save(s.service_request(), false).result,
                 daik::ConfigSaveResult::Saved);
        expect_quiet(s.coordinator, 2);
    }
    { // X10A save: success
        Scenario s(mutate_late_allocation);
        CHECK_EQ(s.coordinator.save(with_pins(s.coordinator.snapshot(), 10, 11), true).result,
                 daik::ConfigSaveResult::Saved);
        expect_quiet(s.coordinator, 1);
    }
    { // X10A save: publishing a longer string than live holds. Publication by copy would have to
      // allocate here (copy-assigning an equal string reuses its buffer and would go unseen), so
      // this scenario, like the service saves above, is what proves the move.
        Scenario s(mutate_late_allocation);
        CHECK_EQ(s.coordinator
                     .save(with_profile(s.coordinator.snapshot(),
                                        "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"),
                           true)
                     .result,
                 daik::ConfigSaveResult::Saved);
        CHECK_EQ(s.coordinator.snapshot().profile.size(), size_t{48});
        expect_quiet(s.coordinator, 1);
    }
    { // X10A save: the "link" write fails
        Scenario s(mutate_late_allocation);
        s.nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);
        CHECK_EQ(s.coordinator.save(with_pins(s.coordinator.snapshot(), 10, 11), true).result,
                 daik::ConfigSaveResult::Failed);
        expect_quiet(s.coordinator, 1);
    }
    { // detected link: success
        Scenario                 s(mutate_late_allocation);
        const DetectedLinkCommit out = s.coordinator.commit_detected_link(
            s.coordinator.snapshot().runtime_revision, 16, 17, daik::Protocol::S, 0x77u);
        CHECK(out.committed);
        CHECK(out.saved);
        expect_quiet(s.coordinator, 1);
    }
    { // detected link: the cache write fails but the session still takes the link
        Scenario s(mutate_late_allocation);
        s.nvs.fail_next_set_no_space(daik::CONFIG_KEY_LINK);
        const DetectedLinkCommit out = s.coordinator.commit_detected_link(
            s.coordinator.snapshot().runtime_revision, 16, 17, daik::Protocol::S, 0x77u);
        CHECK(out.committed);
        CHECK(!out.saved);
        expect_quiet(s.coordinator, 1);
    }
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

void test_http_leftover_body_bounded_after_response(bool mutate_deadline) {
    // A peer announced a body the handler did not read and now trickles it, one byte every 40 ms,
    // each well inside the 1000 ms socket timeout. IDF's own purge would follow it to the end; the
    // discard must stop at its 200 ms budget so the trampoline closes the session instead.
    const HttpDiscardResult trickle = run_http_body_discard(64, 40, 1000, 200, !mutate_deadline);
    CHECK(!trickle.settled);
    CHECK(trickle.received < size_t{64});
    CHECK(trickle.elapsed_ms >= uint64_t{150});
    CHECK(trickle.elapsed_ms <= uint64_t{1500});

    // A small remainder already in the buffer — a JSON body behind a 503 or 415 — is settled at
    // once, so the connection stays reusable and the answer is not cut off by a reset.
    const HttpDiscardResult buffered = run_http_body_discard(300, 0, 1000, 200, true);
    CHECK(buffered.settled);
    CHECK_EQ(buffered.received, size_t{300});

    // More than the largest route buffer is never followed, even when it arrives promptly.
    const HttpDiscardResult oversized =
        run_http_body_discard(daik::BODY_DISCARD_MAX_BYTES + 1000, 0, 1000, 2000, true);
    CHECK(!oversized.settled);
    CHECK(oversized.received <= daik::BODY_DISCARD_MAX_BYTES + 128);
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

// Count the allocations of this binary for the allocation witness in fake_runtime.hpp. Counting is
// per thread and only while a transaction's store is armed, so nothing else is affected. Every
// replaceable plain form — scalar, array and nothrow — is defined here and forwards to the scalar
// one, which is the only place that allocates or counts, so no allocation can be freed by a
// mismatched deallocator should a sanitizer ever be added. Over-aligned forms are not replaced:
// they keep their library allocator pair, are not counted, and are not used by the code under test.
void* operator new(std::size_t size) {
    runtime_test::allocation_trap_hit();
    if (void* memory = std::malloc(size != 0 ? size : 1)) return memory;
    throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void* operator new(std::size_t size, const std::nothrow_t&) noexcept {
    try {
        return ::operator new(size);
    } catch (...) {
        return nullptr;
    }
}
void* operator new[](std::size_t size, const std::nothrow_t&) noexcept {
    try {
        return ::operator new(size);
    } catch (...) {
        return nullptr;
    }
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void* memory) noexcept { ::operator delete(memory); }
void operator delete[](void* memory, std::size_t) noexcept { ::operator delete(memory); }
void operator delete(void* memory, const std::nothrow_t&) noexcept { ::operator delete(memory); }
void operator delete[](void* memory, const std::nothrow_t&) noexcept { ::operator delete(memory); }

int main(int argc, char** argv) {
    bool mutate_atomicity            = false;
    bool mutate_late_allocation      = false;
    bool mutate_http_header_deadline = false;
    bool mutate_http_body_deadline   = false;
    bool mutate_http_discard         = false;
    bool mutate_weather_completion   = false;
    for (int i = 1; i < argc; ++i) {
        const std::string_view arg(argv[i]);
        if (arg == "--mutate-nvs-atomicity")
            mutate_atomicity = true;
        else if (arg == "--mutate-config-late-allocation")
            mutate_late_allocation = true;
        else if (arg == "--mutate-http-header-deadline")
            mutate_http_header_deadline = true;
        else if (arg == "--mutate-http-body-deadline")
            mutate_http_body_deadline = true;
        else if (arg == "--mutate-http-discard-deadline")
            mutate_http_discard = true;
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
        {"config save failure boundaries", test_config_save_failure_boundaries},
        {"config transactions allocate nothing after the first write",
         [=] {
             test_config_transactions_allocate_nothing_after_first_write(mutate_late_allocation);
         }},
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
        {"HTTP leftover body bounded after response",
         [=] { test_http_leftover_body_bounded_after_response(mutate_http_discard); }},
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
