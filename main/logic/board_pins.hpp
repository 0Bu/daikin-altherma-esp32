#pragma once
// List of GPIOs usable for the X10A UART wiring — the pins actually broken out (and safe) on the
// reference board. Drives the dashboard ESP32 card's RX/TX pin *dropdown*, which the UI shows only
// when auto-detection has NOT locked a working pin pair; the user then picks from real, wire-able
// pins. Power pads (GND/VCC) and not-broken-out GPIOs never appear (e.g. GPIO47 on the XIAO
// ESP32-S3), and pins that don't exist on the chip can't be listed. Once the bus answers on a pair,
// the UI shows the pins read-only instead — no picking needed.
//
// The firmware targets esp32s3 only: the Seeed XIAO ESP32-S3 (the project's reference board), pads
// D0..D10 = GPIO 1..9,43,44; GPIO16/17 and 47/48 are NOT broken out, so they are absent. The
// `target` argument is accepted (and ignored) so callers need not special-case it. Pure header (no
// IDF), so it's host-tested in test/test_logic.cpp.
#include <cstring>

namespace daik {

struct BoardPins {
    const int* pins;   // usable X10A GPIOs, strictly ascending
    int        count;
};

// Usable X10A GPIOs for the reference board (s3).
inline BoardPins board_pins(const char* /*target*/ = nullptr) {
    static const int esp32s3[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 43, 44};                             // XIAO ESP32-S3 pads (D0..D10; D6=43/TX, D7=44/RX)
    return {esp32s3, (int)(sizeof(esp32s3) / sizeof(int))};
}

} // namespace daik
