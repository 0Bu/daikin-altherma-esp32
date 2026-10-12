#pragma once
// Deterministic SDK-shaped I2C/task seam; the production sensor TU owns all decisions.
#include <array>
#include <cstdint>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <vector>

using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1;
inline const char*  esp_err_to_name(esp_err_t e) { return e == ESP_OK ? "ESP_OK" : "ESP_FAIL"; }
using TickType_t                        = uint32_t;
using BaseType_t                        = int;
using UBaseType_t                       = unsigned;
using TaskHandle_t                      = void*;
constexpr BaseType_t pdPASS             = 1;
constexpr TickType_t portTICK_PERIOD_MS = 1;
#define pdMS_TO_TICKS(n) (static_cast<TickType_t>(n))
using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(p) ((void)(p))
#define portEXIT_CRITICAL(p) ((void)(p))
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGE(...) ((void)0)

using gpio_num_t        = int;
constexpr int I2C_NUM_0 = 0, I2C_CLK_SRC_DEFAULT = 0, I2C_ADDR_BIT_LEN_7 = 0;
struct FakeBus {
    int  sda = -1, scl = -1;
    bool live = false;
};
struct FakeDevice {
    int  address = 0;
    bool live    = false;
};
using i2c_master_bus_handle_t = FakeBus*;
using i2c_master_dev_handle_t = FakeDevice*;
struct i2c_master_bus_config_t {
    int        i2c_port   = 0;
    gpio_num_t sda_io_num = 0, scl_io_num = 0;
    int        clk_source = 0, glitch_ignore_cnt = 0;
    struct {
        bool enable_internal_pullup = false;
    } flags;
};
struct i2c_device_config_t {
    int dev_addr_length = 0, device_address = 0, scl_speed_hz = 0;
};
namespace sdk {
struct Stop {};
inline int64_t    now_us   = 1000000;
inline int        bus_adds = 0, bus_deletes = 0, device_adds = 0, device_deletes = 0;
inline int        chip_reads = 0, sht_reads = 0, null_transactions = 0, polls = 0, stop_polls = 1;
inline bool       bus_fails = false, task_fails = false, bad_chip = false, bad_crc = false;
inline bool       chip_transient = false, sht_transmit_fails = false, sht_receive_fails = false;
inline bool       qmp_receive_fails = false, ignore_config_writes = false;
inline int        add_fail_address = 0, config_reads = 0;
inline bool       fail_config_copy = false;
inline FakeBus    bus;
inline FakeDevice sht, qmp;
inline std::array<uint8_t, 256> registers{};
inline void (*task_fn)(void*)          = nullptr;
inline void*                  task_arg = nullptr;
inline std::function<void()>  on_poll;
inline std::array<uint8_t, 6> sht_raw{0x66, 0x66, 0x93, 0x80, 0x00, 0xa2};
inline std::array<uint8_t, 6> qmp_raw{0xad, 0xc6, 0xc0, 0x80, 0x00, 0x00};
inline std::vector<bool>      history_valid;
inline bool                   valid(FakeDevice* p) {
    if (p && p->live) return true;
    ++null_transactions;
    return false;
}
} // namespace sdk
inline int64_t esp_timer_get_time() { return sdk::now_us; }
inline void    vTaskDelay(TickType_t ticks) {
    sdk::now_us += static_cast<int64_t>(ticks) * 1000;
    if (ticks == 10000) {
        ++sdk::polls;
        if (sdk::on_poll) sdk::on_poll();
        if (sdk::polls >= sdk::stop_polls) throw sdk::Stop{};
    }
}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, uint32_t, void* arg, UBaseType_t,
                              TaskHandle_t*) {
    if (sdk::task_fails) return 0;
    sdk::task_fn  = fn;
    sdk::task_arg = arg;
    return pdPASS;
}
inline esp_err_t i2c_new_master_bus(const i2c_master_bus_config_t* cfg, FakeBus** out) {
    ++sdk::bus_adds;
    if (sdk::bus_fails) return ESP_FAIL;
    sdk::bus = {cfg->sda_io_num, cfg->scl_io_num, true};
    *out     = &sdk::bus;
    return ESP_OK;
}
inline esp_err_t i2c_del_master_bus(FakeBus* bus) {
    if (!bus || !bus->live) throw std::runtime_error("double bus cleanup");
    bus->live = false;
    ++sdk::bus_deletes;
    return ESP_OK;
}
inline esp_err_t i2c_master_bus_add_device(FakeBus* bus, const i2c_device_config_t* cfg,
                                           FakeDevice** out) {
    ++sdk::device_adds;
    if (!bus || !bus->live || sdk::add_fail_address == cfg->device_address) return ESP_FAIL;
    FakeDevice* device = cfg->device_address == 0x44 ? &sdk::sht : &sdk::qmp;
    if (device->live) throw std::runtime_error("duplicate device allocation");
    *device = {cfg->device_address, true};
    *out    = device;
    return ESP_OK;
}
inline esp_err_t i2c_master_bus_rm_device(FakeDevice* dev) {
    if (!dev || !dev->live) throw std::runtime_error("double device cleanup");
    dev->live = false;
    ++sdk::device_deletes;
    return ESP_OK;
}
inline esp_err_t i2c_master_transmit(FakeDevice* dev, const uint8_t* bytes, size_t n, int) {
    if (!sdk::valid(dev) || n != 2) return ESP_FAIL;
    if (dev->address == 0x44) return sdk::sht_transmit_fails ? ESP_FAIL : ESP_OK;
    if (!sdk::ignore_config_writes) sdk::registers[bytes[0]] = bytes[1];
    return ESP_OK;
}
inline esp_err_t i2c_master_receive(FakeDevice* dev, uint8_t* bytes, size_t n, int) {
    if (!sdk::valid(dev) || n != 6) return ESP_FAIL;
    ++sdk::sht_reads;
    if (sdk::sht_receive_fails) return ESP_FAIL;
    std::memcpy(bytes, sdk::sht_raw.data(), n);
    if (sdk::bad_crc) bytes[2] ^= 1;
    return ESP_OK;
}
inline esp_err_t i2c_master_transmit_receive(FakeDevice* dev, const uint8_t* reg, size_t tx_n,
                                             uint8_t* out, size_t n, int) {
    if (!sdk::valid(dev) || tx_n != 1) return ESP_FAIL;
    if (*reg == 0xd1 && n == 1) {
        ++sdk::chip_reads;
        *out = sdk::bad_chip || (sdk::chip_transient && sdk::chip_reads == 1) ? 0 : 0x5c;
    } else if (*reg == 0xa0 && n == 25) {
        std::memset(out, 0, n); // synthetic calibration, deliberately not field evidence
    } else if (*reg == 0xf7 && n == 6) {
        if (sdk::qmp_receive_fails) return ESP_FAIL;
        std::memcpy(out, sdk::qmp_raw.data(), n);
    } else if (n == 1) {
        *out = sdk::registers[*reg];
    } else
        return ESP_FAIL;
    return ESP_OK;
}
