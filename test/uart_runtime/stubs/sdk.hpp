#pragma once
// ESP-IDF v6.1 UART return shapes. The production TU owns parsing and error decisions.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_INVALID_STATE = 0x103,
                    ESP_ERR_TIMEOUT = 0x107;
using TickType_t                    = uint32_t;
#define pdMS_TO_TICKS(n) (static_cast<TickType_t>(n))
using uart_port_t                        = int;
constexpr uart_port_t UART_NUM_1         = 1;
constexpr int         UART_PIN_NO_CHANGE = -1, UART_DATA_8_BITS = 3, UART_PARITY_EVEN = 2,
              UART_STOP_BITS_1 = 1, UART_HW_FLOWCTRL_DISABLE = 0, UART_SCLK_DEFAULT = 0;
struct uart_config_t {
    int baud_rate = 0, data_bits = 0, parity = 0, stop_bits = 0, flow_ctrl = 0, source_clk = 0;
};

namespace sdk {
inline int64_t now_us    = 0;
inline bool    installed = false, param_fails = false, pin_fails = false, install_fails = false;
inline bool    withdraw_at_write = false, withdraw_at_wait = false, tx_timeout = false;
inline int     negative_read_call = 0, partial_bulk_cap = 0, initial_empty_reads = 0;
inline int64_t positive_read_us = 0;
inline int installs = 0, deletes = 0, pin_sets = 0, flushes = 0, writes = 0, waits = 0, reads = 0;
inline int transmitted = 0, rx_buffer_size = 0, tx_buffer_size = -1;
inline std::vector<uint8_t>              pending_reply, rx;
inline std::vector<std::vector<uint8_t>> requests;
inline std::vector<int>                  read_sizes;
inline std::string                       logs;
inline size_t                            cursor = 0;
inline void                              clear_transaction() {
    now_us            = 0;
    withdraw_at_write = withdraw_at_wait = tx_timeout = false;
    negative_read_call = partial_bulk_cap = initial_empty_reads = 0;
    positive_read_us                                            = 0;
    flushes = writes = waits = reads = transmitted = 0;
    pending_reply.clear();
    rx.clear();
    requests.clear();
    read_sizes.clear();
    logs.clear();
    cursor = 0;
}
} // namespace sdk

inline const char* esp_err_to_name(esp_err_t e) {
    if (e == ESP_OK) return "ESP_OK";
    if (e == ESP_ERR_INVALID_STATE) return "ESP_ERR_INVALID_STATE";
    if (e == ESP_ERR_TIMEOUT) return "ESP_ERR_TIMEOUT";
    return "ESP_FAIL";
}
inline int64_t   esp_timer_get_time() { return sdk::now_us; }
inline esp_err_t uart_param_config(uart_port_t, const uart_config_t*) {
    return sdk::param_fails ? ESP_FAIL : ESP_OK;
}
inline esp_err_t uart_set_pin(uart_port_t, int, int, int, int) {
    ++sdk::pin_sets;
    return sdk::pin_fails ? ESP_FAIL : ESP_OK;
}
inline esp_err_t uart_driver_install(uart_port_t, int rx_size, int tx_size, int, void*, int) {
    ++sdk::installs;
    if (sdk::install_fails || sdk::installed) return ESP_ERR_INVALID_STATE;
    sdk::installed      = true;
    sdk::rx_buffer_size = rx_size;
    sdk::tx_buffer_size = tx_size;
    return ESP_OK;
}
inline esp_err_t uart_driver_delete(uart_port_t) {
    ++sdk::deletes;
    if (!sdk::installed) return ESP_ERR_INVALID_STATE;
    sdk::installed = false;
    return ESP_OK;
}
inline esp_err_t uart_flush_input(uart_port_t) {
    ++sdk::flushes;
    // A missing driver cannot read stale RX or successfully send a later request.
    if (!sdk::installed) return ESP_FAIL;
    sdk::rx.clear();
    sdk::cursor = 0;
    return ESP_OK;
}
inline int uart_write_bytes(uart_port_t, const void* bytes, size_t size) {
    ++sdk::writes;
    // With TX ring size zero, IDF returns -1 on argument/driver validation failure or
    // the complete accepted length, never a short positive count.
    if (sdk::withdraw_at_write) sdk::installed = false;
    if (!sdk::installed) return -1;
    const auto* p = static_cast<const uint8_t*>(bytes);
    sdk::requests.emplace_back(p, p + size);
    sdk::transmitted += static_cast<int>(size);
    sdk::rx     = sdk::pending_reply;
    sdk::cursor = 0;
    return static_cast<int>(size);
}
inline esp_err_t uart_wait_tx_done(uart_port_t, TickType_t ticks) {
    ++sdk::waits;
    if (sdk::withdraw_at_wait) sdk::installed = false;
    if (!sdk::installed) return ESP_FAIL;
    if (sdk::tx_timeout) {
        sdk::now_us += static_cast<int64_t>(ticks) * 1000;
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}
inline int uart_read_bytes(uart_port_t, void* out, uint32_t size, TickType_t ticks) {
    ++sdk::reads;
    sdk::read_sizes.push_back(static_cast<int>(size));
    if (!sdk::installed) return -1;
    if (sdk::reads == sdk::negative_read_call) {
        // The installed driver's RX mutex take waits for the caller's full budget.
        sdk::now_us += static_cast<int64_t>(ticks) * 1000;
        return -1;
    }
    if (sdk::reads <= sdk::initial_empty_reads) {
        sdk::now_us += static_cast<int64_t>(ticks) * 1000;
        return 0;
    }
    const auto available = sdk::rx.size() - sdk::cursor;
    size_t     n         = std::min<size_t>(available, size);
    if (size > 1 && sdk::partial_bulk_cap > 0)
        n = std::min<size_t>(n, static_cast<size_t>(sdk::partial_bulk_cap));
    if (n == 0) sdk::now_us += static_cast<int64_t>(ticks) * 1000;
    if (n) std::memcpy(out, sdk::rx.data() + sdk::cursor, n);
    if (n) sdk::now_us += sdk::positive_read_us;
    sdk::cursor += n;
    return static_cast<int>(n);
}
