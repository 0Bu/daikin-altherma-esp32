// Complete production ENV III unit. Sensor bytes, scheduler and history storage are adapters.
#include "sdk.hpp"
#include <iostream>
#include <new>
#ifndef ENV3_PRODUCTION_SOURCE
#error "Bind the complete production ENV III translation unit"
#endif
#include ENV3_PRODUCTION_SOURCE

namespace adapter {
daik::Config cfg;
}
namespace daik {
Config config() {
    ++sdk::config_reads;
    if (sdk::fail_config_copy) throw std::bad_alloc();
    return adapter::cfg;
}
void diag_printf(const char*, ...) {}
void history_record_env3(bool valid, float, float, float) { sdk::history_valid.push_back(valid); }
} // namespace daik
namespace test {
using namespace daik;
#define REQUIRE(c)                                                                                 \
    do {                                                                                           \
        if (!(c))                                                                                  \
            throw std::runtime_error(std::string(__func__) + ":" + std::to_string(__LINE__) +      \
                                     ": " #c);                                                     \
    } while (0)
void reset() {
    g_runtime     = Runtime{};
    sdk::now_us   = 1000000;
    sdk::bus_adds = sdk::bus_deletes = sdk::device_adds = sdk::device_deletes = 0;
    sdk::chip_reads = sdk::sht_reads = sdk::null_transactions = sdk::polls = 0;
    sdk::stop_polls                                                        = 1;
    sdk::bus_fails = sdk::task_fails = sdk::bad_chip = sdk::bad_crc = false;
    sdk::chip_transient = sdk::sht_transmit_fails = sdk::sht_receive_fails = false;
    sdk::qmp_receive_fails = sdk::ignore_config_writes = false;
    sdk::add_fail_address = sdk::config_reads = 0;
    sdk::fail_config_copy                     = false;
    sdk::bus                                  = {};
    sdk::sht = sdk::qmp = {};
    sdk::registers      = {};
    sdk::task_fn        = nullptr;
    sdk::task_arg       = nullptr;
    sdk::on_poll        = {};
    sdk::history_valid.clear();
    adapter::cfg                 = Config{};
    adapter::cfg.env3_enabled    = true;
    adapter::cfg.board_user_set  = true;
    adapter::cfg.board_preset_id = BoardPresetId::M5StackAtomS3Lite;
    adapter::cfg.env3_sda        = 5;
    adapter::cfg.env3_scl        = 6;
}
void run_task() {
    REQUIRE(sdk::task_fn);
    try {
        sdk::task_fn(sdk::task_arg);
    } catch (const sdk::Stop&) {
        return;
    }
    throw std::runtime_error("task returned unexpectedly");
}
void board_start() {
    reset();
    adapter::cfg.env3_enabled = false;
    env3_start();
    REQUIRE(!env3_status().started && !sdk::task_fn);
    adapter::cfg.env3_enabled    = true;
    adapter::cfg.board_preset_id = BoardPresetId::SeeedXiaoEsp32S3;
    env3_start();
    REQUIRE(!env3_status().started && !sdk::task_fn);
    adapter::cfg.board_preset_id = BoardPresetId::M5StackAtomS3Lite;
    env3_start();
    REQUIRE(env3_status().started && !env3_status().connected && !env3_status().fresh);
    REQUIRE(std::string(env3_status().error) == "collecting" && sdk::task_fn);
}
void task_start_failure() {
    reset();
    sdk::task_fails = true;
    env3_start();
    const auto status = env3_status();
    REQUIRE(status.started && !status.connected && !status.fresh);
    REQUIRE(status.errors == 1 && std::string(status.error) == "task_start_failed");
    REQUIRE(sdk::history_valid == std::vector<bool>{false});
    REQUIRE(!sdk::bus.live && !sdk::task_fn);
}
void probe_success() {
    reset();
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::Ok);
    REQUIRE(sdk::bus_deletes == 1 && sdk::device_deletes == 2);
    REQUIRE(sdk::bus.sda == 5 && sdk::bus.scl == 6 && sdk::sht_reads == 1);
    REQUIRE(!sdk::bus.live && !sdk::sht.live && !sdk::qmp.live);
    REQUIRE(sdk::history_valid.empty() && !env3_status().started);
}
void probe_chip_crc() {
    reset();
    sdk::bad_chip = true;
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::Qmp6988Unavailable);
    REQUIRE(sdk::chip_reads == 2 && sdk::sht_reads == 0 && sdk::device_deletes == 2);
    reset();
    sdk::chip_transient = true;
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::Ok && sdk::chip_reads == 2);
    reset();
    sdk::bad_crc = true;
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::Sht30Unavailable);
    REQUIRE(sdk::sht_reads == 2 && sdk::device_deletes == 2 && sdk::bus_deletes == 1);
    reset();
    sdk::sht_transmit_fails = true;
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::Sht30Unavailable);
    REQUIRE(sdk::sht_reads == 0 && sdk::bus_deletes == 1);
}
void probe_resources() {
    reset();
    sdk::bus_fails = true;
    REQUIRE(env3_probe(5, 6) == Env3ProbeResult::BusUnavailable);
    REQUIRE(sdk::bus_deletes == 0 && sdk::device_deletes == 0);
    for (int address : {0x44, 0x70}) {
        reset();
        sdk::add_fail_address = address;
        REQUIRE(env3_probe(5, 6) == Env3ProbeResult::BusUnavailable);
        REQUIRE(sdk::bus_deletes == 1 && sdk::device_deletes == (address == 0x70 ? 1 : 0));
        REQUIRE(sdk::null_transactions == 0);
    }
}
void initialize_retry() {
    reset();
    SensorBus sensor;
    sdk::add_fail_address = 0x70;
    REQUIRE(!initialize(sensor, 5, 6) && sensor.sht && !sensor.qmp);
    sdk::add_fail_address = 0;
    REQUIRE(initialize(sensor, 5, 6));
    REQUIRE(sdk::bus_adds == 1 && sdk::device_adds == 3 && sdk::null_transactions == 0);
    REQUIRE(sdk::registers[0xf4] == 0x33 && sdk::registers[0xf1] == 0x02);
    delete_bus(sensor);
    reset();
    sdk::ignore_config_writes = true;
    REQUIRE(!initialize(sensor, 5, 6));
    REQUIRE(!sensor.initialized);
    delete_bus(sensor);
}
void sample_lifecycle() {
    reset();
    env3_start();
    run_task();
    auto status = env3_status();
    REQUIRE(status.samples == 1 && status.errors == 0 && status.connected && status.fresh);
    REQUIRE(status.pressure_hpa >= 300 && status.pressure_hpa <= 1100);
    const auto sample_us = g_runtime.sample_us;
    sdk::now_us          = sample_us + 30000000;
    REQUIRE(env3_status().fresh);
    sdk::now_us++;
    REQUIRE(!env3_status().fresh && env3_status().connected);
    sdk::now_us = sample_us - 1;
    REQUIRE(!env3_status().fresh && env3_status().age_s == 0);
    reset();
    sdk::stop_polls = 3;
    sdk::on_poll    = [] {
        const auto state = env3_status();
        if (sdk::polls == 1) {
            REQUIRE(state.connected && state.samples == 1);
            sdk::bad_crc = true;
        } else if (sdk::polls == 2) {
            REQUIRE(!state.connected && !state.fresh && state.samples == 1 && state.errors == 1);
            REQUIRE(std::string(state.error) == "sht30_crc");
            sdk::bad_crc = false;
        }
    };
    env3_start();
    run_task();
    status = env3_status();
    REQUIRE(status.samples == 2 && status.errors == 1 && status.connected && status.fresh);
    REQUIRE(sdk::history_valid == std::vector<bool>({true, false, true}));
    REQUIRE(sdk::bus_adds == 1 && sdk::device_adds == 2);
}
void task_config_oom() {
    reset();
    env3_start();
    const int reads       = sdk::config_reads;
    adapter::cfg.env3_sda = 7;
    adapter::cfg.env3_scl = 8;
    sdk::fail_config_copy = true;
    run_task();
    REQUIRE(sdk::config_reads == reads);
    REQUIRE(env3_status().samples == 1 && env3_status().fresh);
    REQUIRE(sdk::bus.sda == 5 && sdk::bus.scl == 6);
}
using Case         = std::pair<const char*, void (*)()>;
const Case cases[] = {
    {"board_start", board_start},           {"task_start_failure", task_start_failure},
    {"probe_success", probe_success},       {"probe_chip_crc", probe_chip_crc},
    {"probe_resources", probe_resources},   {"initialize_retry", initialize_retry},
    {"sample_lifecycle", sample_lifecycle}, {"task_config_oom", task_config_oom}};
} // namespace test
int main(int argc, char** argv) {
    int count = 0;
    for (const auto& entry : test::cases) {
        if (argc == 2 && std::string(argv[1]) != entry.first) continue;
        try {
            entry.second();
            ++count;
            std::cout << "PASS " << entry.first << '\n';
        } catch (const std::exception& e) {
            std::cerr << "FAIL " << entry.first << ": " << e.what() << '\n';
            return 1;
        }
    }
    if (!count) return 2;
    std::cout << "PASS total=" << count << '\n';
}
