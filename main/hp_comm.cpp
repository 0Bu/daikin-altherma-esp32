// X10A UART transport over the ESP-IDF uart driver.
#include "hp_comm.hpp"
#include "diag_log.hpp"
#include "driver/uart.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

namespace daik {

static const uart_port_t PORT = UART_NUM_1;
static bool s_inited = false;
static int  s_rx = -1, s_tx = -1;

bool hp_uart_init(int rx, int tx) {
    if (s_inited && rx == s_rx && tx == s_tx) return true;
    if (s_inited) uart_driver_delete(PORT);
    uart_config_t cfg = {};
    cfg.baud_rate   = 9600;
    cfg.data_bits   = UART_DATA_8_BITS;
    cfg.parity      = UART_PARITY_EVEN;              // 8E1 — the X10A framing
    cfg.stop_bits   = UART_STOP_BITS_1;
    cfg.flow_ctrl   = UART_HW_FLOWCTRL_DISABLE;
    cfg.source_clk  = UART_SCLK_DEFAULT;
    if (uart_param_config(PORT, &cfg) != ESP_OK) return false;
    if (uart_set_pin(PORT, tx, rx, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK) return false;
    if (uart_driver_install(PORT, 256, 0, 0, nullptr, 0) != ESP_OK) return false;
    s_inited = true; s_rx = rx; s_tx = tx;
    return true;
}

void hp_uart_deinit() {
    if (s_inited) { uart_driver_delete(PORT); s_inited = false; }
}

int hp_query(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen) {
    // --- Mock / Dummy Values Simulation for ERGA04-08E ---
    if (proto == Protocol::I) {
        uint8_t payload[32] = {0};
        int paylen = 0;
        
        switch (reg) {
            case 0x00:
                paylen = 16;
                payload[12] = 60; // 6.0 kW capacity
                break;
            case 0x11:
                paylen = 6;
                payload[0] = 0x11; payload[1] = 0x22; payload[2] = 0x33;
                payload[3] = 0x44; payload[4] = 0x55; payload[5] = 0x66;
                break;
            case 0x10:
                paylen = 16;
                payload[0] = 1; // Heating
                payload[6] = 45 & 0xFF; payload[7] = (45 >> 8) & 0xFF; // Target Evap 4.5 C
                payload[8] = 350 & 0xFF; payload[9] = (350 >> 8) & 0xFF; // Target Cond 35.0 C
                break;
            case 0x20:
                paylen = 16;
                payload[0] = 85 & 0xFF; payload[1] = (85 >> 8) & 0xFF; // Outdoor air temp 8.5 C
                payload[2] = 60 & 0xFF; payload[3] = (60 >> 8) & 0xFF; // Heat exch 6.0 C
                payload[4] = 650 & 0xFF; payload[5] = (650 >> 8) & 0xFF; // Discharge 65.0 C
                payload[6] = 40 & 0xFF; payload[7] = (40 >> 8) & 0xFF; // Suction 4.0 C
                payload[8] = 50 & 0xFF; payload[9] = (50 >> 8) & 0xFF; // Heat exch mid 5.0 C
                payload[10] = 250 & 0xFF; payload[11] = (250 >> 8) & 0xFF; // Liquid temp 25.0 C
                payload[12] = 210 & 0xFF; payload[13] = (210 >> 8) & 0xFF; // High pressure 21.0 bar
                payload[14] = 75 & 0xFF; payload[15] = (75 >> 8) & 0xFF; // Low pressure 7.5 bar
                break;
            case 0x21:
                paylen = 16;
                payload[0] = 42 & 0xFF; payload[1] = (42 >> 8) & 0xFF; // INV primary 4.2 A
                payload[2] = 35 & 0xFF; payload[3] = (35 >> 8) & 0xFF; // INV secondary 3.5 A
                payload[4] = 430 & 0xFF; payload[5] = (430 >> 8) & 0xFF; // INV fin 43.0 C
                payload[6] = 310 & 0xFF; payload[7] = (310 >> 8) & 0xFF; // Fan 1 fin 31.0 C
                payload[8] = 320 & 0xFF; payload[9] = (320 >> 8) & 0xFF; // Fan 2 fin 32.0 C
                payload[10] = 750 & 0xFF; payload[11] = (750 >> 8) & 0xFF; // Comp outlet 75.0 C
                break;
            case 0x30:
                paylen = 16;
                payload[0] = 45; // INV frequency 45 rps (BE size 1)
                payload[1] = 5;  // Fan 1 step 5
                payload[2] = 0;  // Fan 2 step 0
                payload[3] = 250 & 0xFF; payload[4] = (250 >> 8) & 0xFF; // Exp valve 1 250 pls
                break;
            case 0xA0:
                paylen = 16;
                payload[0] = 50 & 0xFF; payload[1] = (50 >> 8) & 0xFF; // Suction temp 5.0 C
                payload[2] = 55 & 0xFF; payload[3] = (55 >> 8) & 0xFF; // Heat exch temp 5.5 C
                payload[4] = 240 & 0xFF; payload[5] = (240 >> 8) & 0xFF; // Liquid pipe 24.0 C
                payload[6] = 200 & 0xFF; payload[7] = (200 >> 8) & 0xFF; // Pressure 20.0 bar
                payload[8] = 150 & 0xFF; payload[9] = (150 >> 8) & 0xFF; // Exp valve 3 150 pls
                payload[14] = 580 & 0xFF; payload[15] = (580 >> 8) & 0xFF; // Comp port temp 58.0 C
                break;
            case 0xA1:
                paylen = 16;
                payload[0] = 350 & 0xFF; payload[1] = (350 >> 8) & 0xFF; // Water inlet 35.0 C
                payload[2] = 400 & 0xFF; payload[3] = (400 >> 8) & 0xFF; // Water outlet 40.0 C
                payload[5] = 720 & 0xFF; payload[6] = (720 >> 8) & 0xFF; // Target discharge 72.0 C
                payload[7] = 610 & 0xFF; payload[8] = (610 >> 8) & 0xFF; // Target port 61.0 C
                break;
            case 0x60:
                paylen = 16;
                payload[2] = 0x58; // Heating + DHW, Thermostat ON
                payload[6] = 4;    // I/U capacity code
                payload[7] = 480 & 0xFF; payload[8] = (480 >> 8) & 0xFF; // DHW setpoint 48.0 C
                payload[9] = 350 & 0xFF; payload[10] = (350 >> 8) & 0xFF; // LW setpoint main 35.0 C
                payload[11] = 0x90; // Water flow switch ON, Benefit kWh ON
                payload[12] = 0x82; // 2way valve ON (heat), pump ON
                break;
            case 0x61:
                paylen = 16;
                payload[2] = 385 & 0xFF; payload[3] = (385 >> 8) & 0xFF; // Leaving water before BUH 38.5 C
                payload[4] = 390 & 0xFF; payload[5] = (390 >> 8) & 0xFF; // Leaving water after BUH 39.0 C
                payload[6] = 370 & 0xFF; payload[7] = (370 >> 8) & 0xFF; // Refrig temp liquid 37.0 C
                payload[8] = 335 & 0xFF; payload[9] = (335 >> 8) & 0xFF; // Inlet water temp 33.5 C
                payload[10] = 465 & 0xFF; payload[11] = (465 >> 8) & 0xFF; // DHW tank 46.5 C
                payload[12] = 215 & 0xFF; payload[13] = (215 >> 8) & 0xFF; // Indoor ambient 21.5 C
                payload[14] = 220 & 0xFF; payload[15] = (220 >> 8) & 0xFF; // Ext indoor ambient 22.0 C
                break;
            case 0x62:
                paylen = 18;
                payload[2] = 0x08; // Space heating ON
                payload[3] = 300 & 0xFF; payload[4] = (300 >> 8) & 0xFF; // LW setpoint add 30.0 C
                payload[5] = 220 & 0xFF; payload[6] = (220 >> 8) & 0xFF; // RT setpoint 22.0 C
                payload[8] = 0x01; // Space H Operation output ON
                payload[9] = 125 & 0xFF; payload[10] = (125 >> 8) & 0xFF; // Flow rate 12.5 l/min
                payload[11] = 18;  // Water pressure 1.8 bar (size 1)
                payload[12] = 45;  // Water pump signal 45% (size 1)
                payload[15] = 150 & 0xFF; payload[16] = (150 >> 8) & 0xFF; // Refrig pressure 15.0 bar
                break;
            case 0x63:
                paylen = 18;
                payload[14] = 10; // CT sensor L1 current 5.0 A (raw 10)
                break;
            case 0x64:
                paylen = 16;
                payload[3] = 38 & 0xFF; payload[4] = (38 >> 8) & 0xFF; // BE COP 3.8
                payload[5] = 350 & 0xFF; payload[6] = (350 >> 8) & 0xFF; // Hybrid heating target 35.0 C
                payload[7] = 400 & 0xFF; payload[8] = (400 >> 8) & 0xFF; // Boiler heating target 40.0 C
                payload[10] = (3725 >> 8) & 0xFF; payload[11] = 3725 & 0xFF; // Mixed water 37.25 C (BE)
                payload[12] = 450 & 0xFF; payload[13] = (450 >> 8) & 0xFF; // 2nd DHW temp 45.0 C
                break;
            default:
                break;
        }

        if (paylen > 0) {
            size_t reply_size = paylen + 4;
            if (reply_size <= buflen) {
                buf[0] = 0x40;
                buf[1] = reg;
                buf[2] = paylen + 2;
                for (int i = 0; i < paylen; i++) buf[3 + i] = payload[i];
                buf[3 + paylen] = crc(buf, 3 + paylen);
                return static_cast<int>(reply_size);
            }
        }
    }
    return -2;
}

} // namespace daik
