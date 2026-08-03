#include "env3.hpp"

#include "config.hpp"
#include "diag_log.hpp"
#include "logic/env3.hpp"

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include <cmath>
#include <cstring>

namespace daik {
namespace {

constexpr uint32_t POLL_MS = 10000;
constexpr int64_t FRESH_US = 30000000;
constexpr int I2C_TIMEOUT_MS = 100;

struct Runtime {
    Env3Status status;
    int64_t sample_us = 0;
};

Runtime g_runtime;
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

void publish_error(const char* error) {
    portENTER_CRITICAL(&g_mux);
    g_runtime.status.started = true;
    g_runtime.status.connected = false;
    g_runtime.status.error = error;
    ++g_runtime.status.errors;
    portEXIT_CRITICAL(&g_mux);
}

void publish_sample(float temperature_c, float humidity_pct, float pressure_hpa) {
    portENTER_CRITICAL(&g_mux);
    g_runtime.status.started = true;
    g_runtime.status.connected = true;
    g_runtime.status.temperature_c = temperature_c;
    g_runtime.status.humidity_pct = humidity_pct;
    g_runtime.status.pressure_hpa = pressure_hpa;
    g_runtime.status.error = "none";
    ++g_runtime.status.samples;
    g_runtime.sample_us = esp_timer_get_time();
    portEXIT_CRITICAL(&g_mux);
}

esp_err_t write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t value) {
    const uint8_t bytes[2] = {reg, value};
    return i2c_master_transmit(dev, bytes, sizeof(bytes), I2C_TIMEOUT_MS);
}

esp_err_t read_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t* data, size_t size) {
    return i2c_master_transmit_receive(dev, &reg, 1, data, size, I2C_TIMEOUT_MS);
}

struct SensorBus {
    i2c_master_bus_handle_t bus = nullptr;
    i2c_master_dev_handle_t sht = nullptr;
    i2c_master_dev_handle_t qmp = nullptr;
    Env3QmpCalibration calibration;
    bool initialized = false;
};

bool add_device(i2c_master_bus_handle_t bus, uint8_t address, i2c_master_dev_handle_t& out) {
    i2c_device_config_t cfg = {};
    cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    cfg.device_address = address;
    cfg.scl_speed_hz = 400000;
    return i2c_master_bus_add_device(bus, &cfg, &out) == ESP_OK;
}

bool create_bus(SensorBus& sensor, int sda, int scl) {
    if (!sensor.bus) {
        i2c_master_bus_config_t cfg = {};
        cfg.i2c_port = I2C_NUM_0;
        cfg.sda_io_num = static_cast<gpio_num_t>(sda);
        cfg.scl_io_num = static_cast<gpio_num_t>(scl);
        cfg.clk_source = I2C_CLK_SRC_DEFAULT;
        cfg.glitch_ignore_cnt = 7;
        cfg.flags.enable_internal_pullup = true;
        if (i2c_new_master_bus(&cfg, &sensor.bus) != ESP_OK) return false;
    }
    return true;
}

void delete_bus(SensorBus& sensor) {
    if (sensor.qmp) {
        i2c_master_bus_rm_device(sensor.qmp);
        sensor.qmp = nullptr;
    }
    if (sensor.sht) {
        i2c_master_bus_rm_device(sensor.sht);
        sensor.sht = nullptr;
    }
    if (sensor.bus) {
        i2c_del_master_bus(sensor.bus);
        sensor.bus = nullptr;
    }
    sensor.initialized = false;
}

bool initialize(SensorBus& sensor, int sda, int scl) {
    if (!create_bus(sensor, sda, scl)) return false;
    // Device handles can fail independently (for example under low heap). Retry only the missing
    // handle on the next cycle; never call an I2C transaction with a null handle after a partial add.
    if (!sensor.sht && !add_device(sensor.bus, ENV3_SHT30_ADDR, sensor.sht)) return false;
    if (!sensor.qmp && !add_device(sensor.bus, ENV3_QMP6988_ADDR, sensor.qmp)) return false;

    uint8_t chip_id = 0;
    if (read_reg(sensor.qmp, 0xd1, &chip_id, 1) != ESP_OK || chip_id != 0x5c) return false;
    if (write_reg(sensor.qmp, 0xe0, 0xe6) != ESP_OK) return false;
    vTaskDelay(pdMS_TO_TICKS(20));
    if (write_reg(sensor.qmp, 0xe0, 0x00) != ESP_OK) return false;
    vTaskDelay(pdMS_TO_TICKS(20));
    uint8_t calibration[25] = {};
    if (read_reg(sensor.qmp, 0xa0, calibration, sizeof(calibration)) != ESP_OK) return false;
    sensor.calibration = env3_qmp_calibration(calibration);
    // M5's reference setup: IIR coefficient 4, pressure 8x, temperature 1x, normal mode.
    if (write_reg(sensor.qmp, 0xf1, 0x02) != ESP_OK ||
        write_reg(sensor.qmp, 0xf4, 0x33) != ESP_OK) return false;
    vTaskDelay(pdMS_TO_TICKS(20));
    sensor.initialized = true;
    return true;
}

bool read_sample(SensorBus& sensor, float& temperature_c, float& humidity_pct,
                 float& pressure_hpa, const char*& error) {
    const uint8_t command[2] = {0x2c, 0x06};
    if (i2c_master_transmit(sensor.sht, command, sizeof(command), I2C_TIMEOUT_MS) != ESP_OK) {
        error = "sht30_write"; return false;
    }
    vTaskDelay(pdMS_TO_TICKS(20));
    uint8_t sht_raw[6] = {};
    if (i2c_master_receive(sensor.sht, sht_raw, sizeof(sht_raw), I2C_TIMEOUT_MS) != ESP_OK) {
        error = "sht30_read"; return false;
    }
    if (!env3_decode_sht30(sht_raw, temperature_c, humidity_pct)) {
        error = "sht30_crc"; return false;
    }
    uint8_t qmp_raw[6] = {};
    if (read_reg(sensor.qmp, 0xf7, qmp_raw, sizeof(qmp_raw)) != ESP_OK) {
        error = "qmp6988_read"; return false;
    }
    float qmp_temperature = 0.0f;
    env3_decode_qmp6988(sensor.calibration, qmp_raw, qmp_temperature, pressure_hpa);
    if (!env3_sample_plausible(temperature_c, humidity_pct, pressure_hpa)) {
        error = "implausible_sample"; return false;
    }
    return true;
}

void task(void*) {
    const Config cfg = config();
    SensorBus sensor;
    for (;;) {
        if (!sensor.initialized && !initialize(sensor, cfg.env3_sda, cfg.env3_scl)) {
            publish_error("sensor_not_found");
        } else {
            float temperature = 0.0f, humidity = 0.0f, pressure = 0.0f;
            const char* error = "read_failed";
            if (read_sample(sensor, temperature, humidity, pressure, error)) {
                publish_sample(temperature, humidity, pressure);
            } else {
                publish_error(error);
                sensor.initialized = false;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
    }
}

} // namespace

Env3ProbeResult env3_probe(int sda, int scl) {
    SensorBus sensor;
    const auto finish = [&](Env3ProbeResult result) {
        delete_bus(sensor);
        return result;
    };
    if (!create_bus(sensor, sda, scl) ||
        !add_device(sensor.bus, ENV3_SHT30_ADDR, sensor.sht) ||
        !add_device(sensor.bus, ENV3_QMP6988_ADDR, sensor.qmp))
        return finish(Env3ProbeResult::BusUnavailable);

    // QMP6988 identifies itself as 0x5c at 0xd1.  Retry once so a single line disturbance cannot
    // turn a correctly wired sensor into a rejected save.
    bool qmp_ok = false;
    for (int attempt = 0; attempt < 2 && !qmp_ok; ++attempt) {
        uint8_t chip_id = 0;
        qmp_ok = read_reg(sensor.qmp, 0xd1, &chip_id, 1) == ESP_OK && chip_id == 0x5c;
    }
    if (!qmp_ok) return finish(Env3ProbeResult::Qmp6988Unavailable);

    // SHT30 has no chip-id register.  A successful single-shot transaction with both documented
    // CRC bytes valid is the positive identity/reachability proof instead of merely seeing 0x44 ACK.
    bool sht_ok = false;
    for (int attempt = 0; attempt < 2 && !sht_ok; ++attempt) {
        const uint8_t command[2] = {0x2c, 0x06};
        uint8_t raw[6] = {};
        if (i2c_master_transmit(sensor.sht, command, sizeof(command), I2C_TIMEOUT_MS) != ESP_OK)
            continue;
        vTaskDelay(pdMS_TO_TICKS(20));
        if (i2c_master_receive(sensor.sht, raw, sizeof(raw), I2C_TIMEOUT_MS) != ESP_OK)
            continue;
        float temperature = 0.0f, humidity = 0.0f;
        sht_ok = env3_decode_sht30(raw, temperature, humidity);
    }
    return finish(sht_ok ? Env3ProbeResult::Ok : Env3ProbeResult::Sht30Unavailable);
}

void env3_start() {
    const Config cfg = config();
    // config_load and POST /set_env3 enforce this too. Keep the task boundary fail-closed so a
    // future caller cannot start an M5Stack-only accessory from a stale or handcrafted Config.
    if (!cfg.env3_enabled || !env3_board_supported(cfg)) return;
    portENTER_CRITICAL(&g_mux);
    g_runtime.status.started = true;
    g_runtime.status.error = "collecting";
    portEXIT_CRITICAL(&g_mux);
    if (xTaskCreate(task, "env3", 4096, nullptr, 4, nullptr) != pdPASS) {
        publish_error("task_start_failed");
        ESP_LOGE("env3", "task start failed");
        return;
    }
    ESP_LOGI("env3", "ENV III started: SDA=%d SCL=%d", cfg.env3_sda, cfg.env3_scl);
}

Env3Status env3_status() {
    portENTER_CRITICAL(&g_mux);
    Env3Status out = g_runtime.status;
    const int64_t sample_us = g_runtime.sample_us;
    portEXIT_CRITICAL(&g_mux);
    if (sample_us > 0) {
        const int64_t age_us = esp_timer_get_time() - sample_us;
        out.age_s = static_cast<uint32_t>(age_us > 0 ? age_us / 1000000 : 0);
        out.fresh = out.connected && age_us >= 0 && age_us <= FRESH_US;
    }
    return out;
}

} // namespace daik
