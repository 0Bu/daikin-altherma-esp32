// X10A UART transport over the ESP-IDF uart driver.
#include "hp_comm.hpp"
#include "diag_log.hpp"
#include "logic/uart_plan.hpp"
#include "driver/uart.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

namespace daik {

static const uart_port_t PORT = UART_NUM_1;
static bool s_inited = false;
static int  s_rx = -1, s_tx = -1;

bool hp_uart_init(int rx, int tx) {
    // The detect sweep re-inits per candidate and alternates the pins {44,43}<->{43,44} every poll
    // second on a silent bus. Reinstalling the driver each time (uart_driver_delete + install)
    // allocated a fresh 256 B RX ring + driver struct + sync primitives ~2x/second and fragmented the
    // heap until an unrelated allocation crashed (a symbolized coredump: hp_poll's std::vector build
    // threw a bad_alloc too starved to unwind -> std::terminate -> abort). So install ONCE, then a
    // genuine pin change is a register-only uart_set_pin re-route that allocates nothing.
    // logic/uart_plan.hpp holds the (host-tested) decision.
    switch (uart_plan(s_inited, s_rx, s_tx, rx, tx)) {
    case UartAction::Noop:
        return true;

    case UartAction::Remap:
        // Driver stays installed — re-route the signals only. NO heap, NO delete. A failed set_pin
        // leaves the driver valid on the OLD pins (safer than the old delete-first path, which could
        // strand s_inited==true with no driver).
        if (uart_set_pin(PORT, tx, rx, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK) return false;
        uart_flush_input(PORT);                     // drop bytes latched on the OLD pins (redundant
                                                    // with hp_query's flush — keeps the invariant local)
        s_rx = rx; s_tx = tx;
        return true;

    case UartAction::Install: {                     // first bring-up only
        uart_config_t cfg = {};
        cfg.baud_rate   = 9600;
        cfg.data_bits   = UART_DATA_8_BITS;
        cfg.parity      = UART_PARITY_EVEN;         // 8E1 — the X10A framing
        cfg.stop_bits   = UART_STOP_BITS_1;
        cfg.flow_ctrl   = UART_HW_FLOWCTRL_DISABLE;
        cfg.source_clk  = UART_SCLK_DEFAULT;
        // Order matters: set_pin BEFORE install. If the pin config fails (a reserved GPIO can reach the
        // link cache via /set_hp, whose validate() only range-checks — unlike the UI's board_pins
        // filter), NO driver is installed, so s_inited stays false and the detect sweep cleanly falls
        // through to the next candidate pair. Installing first and failing on set_pin would leak the
        // driver AND wedge every later install (ESP_ERR_INVALID_STATE) — the X10A link dead the whole boot.
        if (uart_param_config(PORT, &cfg) != ESP_OK) return false;
        if (uart_set_pin(PORT, tx, rx, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE) != ESP_OK) return false;
        if (uart_driver_install(PORT, 256, 0, 0, nullptr, 0) != ESP_OK) return false;
        s_inited = true; s_rx = rx; s_tx = tx;
        return true;
    }
    }
    return false;   // unreachable — satisfies -Werror=return-type (pinned in main/CMakeLists.txt)
}

void hp_uart_deinit() {
    if (s_inited) { uart_driver_delete(PORT); s_inited = false; }
}

HpQueryResult hp_query_detailed(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen,
                                HpQueryLogPolicy log_policy) {
    // The buffer has to hold the reply we are about to ASK FOR. Checked before the request goes out
    // rather than while parsing it: there is no point putting a query on the bus whose answer we
    // would have to abandon, and the answer is knowable here.
    //
    // This cannot fire today — reply_len() maxes at 18 and both call sites pass 64 bytes — and that
    // is exactly why it is worth stating. It was an invariant held across three files by agreement,
    // and the loop below is not self-protecting the way it looks: the write is guarded per byte, but
    // `len` counts every byte RECEIVED whether or not it was stored, so a replyLen past buflen ends
    // in crc_ok(buf, len) reading past the end of the buffer. An out-of-bounds READ that the
    // per-byte write guard cannot prevent, and that no static analyser finds either, since it needs
    // the caller's buffer size and the register table at once. One local check retires it.
    int replyLen = reply_len(reg, proto);
    if (!reply_len_valid(proto, replyLen, buflen)) {
        if (hp_query_should_log(log_policy, HpQueryFailure::InvalidLength))
            diag_printf("HP reply buffer too small for reg 0x%02x: need %d, have %u (rx=%d tx=%d)\n",
                        reg, replyLen, static_cast<unsigned>(buflen), s_rx, s_tx);
        return {HpReplyKind::InvalidLength, 0};
    }

    uint8_t req[4];
    int qlen = build_request(reg, proto, req);
    uart_flush_input(PORT);
    uart_write_bytes(PORT, reinterpret_cast<const char*>(req), qlen);

    int len = 0;
    const int64_t start = esp_timer_get_time();
    while (len < replyLen && (esp_timer_get_time() - start) < HP_QUERY_TIMEOUT_US) {
        uint8_t ch;
        if (uart_read_bytes(PORT, &ch, 1, pdMS_TO_TICKS(20)) == 1) {
            if (static_cast<size_t>(len) < buflen) buf[len] = ch;
            len++;
            if (proto == Protocol::I && len == 3) {
                replyLen = reply_len_dynamic(buf);
                if (!reply_len_valid(proto, replyLen, buflen)) {
                    if (hp_query_should_log(log_policy, HpQueryFailure::InvalidLength))
                        diag_printf("HP invalid dynamic reply len %d (max %u) on reg 0x%02x (rx=%d tx=%d)\n",
                                    replyLen, static_cast<unsigned>(buflen), reg, s_rx, s_tx);
                    return {HpReplyKind::InvalidLength, len};
                }
            }
            if (len == 2 && is_error_reply(buf, len)) {
                if (hp_query_should_log(log_policy, HpQueryFailure::Rejected))
                    diag_printf("HP query rejected for reg 0x%02x (protocol %c, reply 0x15 0xEA; rx=%d tx=%d)\n",
                                reg, static_cast<char>(proto), s_rx, s_tx);
                return {HpReplyKind::Rejected, len};
            }
        }
    }
    // The pure classifier is the production rule as well as the host-test target; do not keep a
    // second handwritten precedence ladder here that can drift on wrong-page/short/CRC replies.
    const HpReplyKind kind = hp_reply_classify(reg, proto, buf, len, replyLen);
    switch (kind) {
        case HpReplyKind::NoReply:
            if (hp_query_should_log(log_policy, HpQueryFailure::NoReply))
                diag_printf("HP no reply for reg 0x%02x (protocol %c; rx=%d tx=%d)\n",
                            reg, static_cast<char>(proto), s_rx, s_tx);
            break;
        case HpReplyKind::ShortReply:
            if (hp_query_should_log(log_policy, HpQueryFailure::ShortReply))
                diag_printf("HP short reply reg 0x%02x %d/%d (rx=%d tx=%d)\n",
                            reg, len, replyLen, s_rx, s_tx);
            break;
        case HpReplyKind::BadCrc:
            if (hp_query_should_log(log_policy, HpQueryFailure::BadCrc))
                diag_printf("HP wrong CRC reg 0x%02x (rx=%d tx=%d)\n", reg, s_rx, s_tx);
            break;
        case HpReplyKind::UnexpectedReply:
            if (hp_query_should_log(log_policy, HpQueryFailure::UnexpectedReply))
                diag_printf("HP unexpected reply reg 0x%02x got 0x%02x/0x%02x (rx=%d tx=%d)\n",
                            reg, buf[0], buf[1], s_rx, s_tx);
            break;
        case HpReplyKind::Ok:
        case HpReplyKind::Rejected:      // NAK returns immediately above
        case HpReplyKind::InvalidLength: // rejected before/while reading above
            break;
    }
    return {kind, len};
}

int hp_query(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen,
             HpQueryLogPolicy log_policy) {
    const HpQueryResult result = hp_query_detailed(reg, proto, buf, buflen, log_policy);
    switch (result.kind) {
        case HpReplyKind::Ok:       return result.received;
        case HpReplyKind::Rejected: return -2;
        case HpReplyKind::BadCrc:   return -3;
        default:                    return -1;
    }
}

} // namespace daik
