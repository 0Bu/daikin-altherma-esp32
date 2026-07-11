// Optional control relays (thermostat + SG-Ready). No-op unless the pins are configured. See
// control.hpp and docs/README.md → Optional control. Ported in spirit from ESPAltherma's
// PIN_THERM / PIN_SG1 / PIN_SG2 handling.
#include "control.hpp"
#include "config.hpp"
#include "driver/gpio.h"
#include "esp_log.h"

namespace daik {

static const char* TAG = "control";
static int s_sg_mode = 0;

static void cfg_output(int pin) {
    if (pin < 0) return;
    gpio_config_t io = {};
    io.pin_bit_mask = 1ULL << pin;
    io.mode         = GPIO_MODE_OUTPUT;
    gpio_config(&io);
    gpio_set_level((gpio_num_t)pin, 0);
}

void control_init() {
    const Config& c = config();
    cfg_output(c.therm_pin);
    cfg_output(c.sg1_pin);
    cfg_output(c.sg2_pin);
    if (c.therm_pin >= 0 || c.sg1_pin >= 0)
        ESP_LOGI(TAG, "control pins: therm=%d sg1=%d sg2=%d", c.therm_pin, c.sg1_pin, c.sg2_pin);
}

void control_set_thermostat(bool on) {
    const Config& c = config();
    if (c.therm_pin >= 0) gpio_set_level((gpio_num_t)c.therm_pin, on ? 1 : 0);
}

void control_set_sg_mode(int mode) {
    // SG-Ready truth table (ESPAltherma README): 0 open/open, 1 open/close, 2 close/open,
    // 3 close/close. SG1=bit1, SG2=bit0 per that table.
    const Config& c = config();
    s_sg_mode = mode & 0x3;
    if (c.sg1_pin >= 0) gpio_set_level((gpio_num_t)c.sg1_pin, (s_sg_mode >> 1) & 1);
    if (c.sg2_pin >= 0) gpio_set_level((gpio_num_t)c.sg2_pin, s_sg_mode & 1);
}

int control_sg_mode() { return s_sg_mode; }

} // namespace daik
