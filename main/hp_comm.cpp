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
    uint8_t req[4];
    int qlen = build_request(reg, proto, req);
    uart_flush_input(PORT);
    uart_write_bytes(PORT, reinterpret_cast<const char*>(req), qlen);

    int replyLen = reply_len(reg, proto);
    int len = 0;
    const int64_t start = esp_timer_get_time();
    const int64_t TIMEOUT_US = 300000;   // serial reply timeout (300 ms)

    while (len < replyLen && (esp_timer_get_time() - start) < TIMEOUT_US) {
        uint8_t ch;
        if (uart_read_bytes(PORT, &ch, 1, pdMS_TO_TICKS(20)) == 1) {
            if (static_cast<size_t>(len) < buflen) buf[len] = ch;
            len++;
            if (proto == Protocol::I && len == 3) {
                replyLen = reply_len_dynamic(buf);
                if (!is_valid_dynamic_len(replyLen, buflen)) {
                    diag_printf("HP invalid dynamic reply len %d (max %u) on reg 0x%02x\n", replyLen, buflen, reg);
                    return -1;
                }
            }
            if (len == 2 && is_error_reply(buf, len)) {
                diag_printf("HP error 0x15 0xEA on reg 0x%02x (try protocol S?)\n", reg);
                return -2;
            }
        }
    }
    if (len == 0)         { diag_printf("HP timeout reg 0x%02x — check X10A cable / GND\n", reg); return -1; }
    if (len < replyLen)   { diag_printf("HP short reply reg 0x%02x %d/%d\n", reg, len, replyLen); return -1; }
    if (!crc_ok(buf, len)) { diag_printf("HP wrong CRC reg 0x%02x\n", reg); return -3; }
    return len;
}

} // namespace daik
