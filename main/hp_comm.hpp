#pragma once
// X10A UART transport. Wraps logic/crc.hpp (frame build / CRC / reply-length) around the
// ESP-IDF uart_driver on the configured rx/tx pins at 9600 8E1.
#include <cstddef>
#include <cstdint>
#include "logic/crc.hpp"
#include "logic/hp_query_log.hpp"

namespace daik {

// (Re)initialise UART1 on the given pins. Safe to call again on a pin change.
bool hp_uart_init(int rx_pin, int tx_pin);
void hp_uart_deinit();

struct HpQueryResult {
    HpReplyKind kind = HpReplyKind::NoReply;
    int received = 0;  // copied bytes, including partial and negative replies
};

// Detailed result for diagnostics. It retains raw bytes for NAK, CRC, wrong-echo and short replies;
// hp_query() below keeps the established integer contract for the poll and detection paths.
HpQueryResult hp_query_detailed(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen,
                                HpQueryLogPolicy log_policy = HpQueryLogPolicy::All);

// Query one register. Writes the reply into buf (capacity buflen); returns the number of verified
// bytes (payload framing intact, CRC ok) or <0 on timeout / rejection / bad CRC. Detection passes
// use IntegrityOnly because absent pages are an expected part of fingerprinting; normal polling
// keeps All because it queries only pages selected for the detected profile.
int hp_query(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen,
             HpQueryLogPolicy log_policy = HpQueryLogPolicy::All);

} // namespace daik
