#pragma once
// X10A UART transport. Wraps logic/crc.hpp (frame build / CRC / reply-length) around the
// ESP-IDF uart_driver on the configured rx/tx pins at 9600 8E1. Ported from ESPAltherma
// include/comm.h (queryRegistry).
#include <cstddef>
#include <cstdint>
#include "logic/crc.hpp"

namespace daik {

// (Re)initialise UART1 on the given pins. Safe to call again on a pin change.
bool hp_uart_init(int rx_pin, int tx_pin);
void hp_uart_deinit();

// Query one register. Writes the reply into buf (capacity buflen); returns the number of
// verified bytes (payload framing intact, CRC ok) or <0 on timeout / error / bad CRC. The
// caller extracts values via the active profile (hp_poll.cpp).
int hp_query(uint8_t reg, Protocol proto, uint8_t* buf, size_t buflen);

} // namespace daik
