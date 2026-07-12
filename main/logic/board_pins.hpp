#pragma once
// Per-target list of GPIOs usable for the X10A UART wiring — the pins actually broken out (and safe)
// on the reference board for each supported chip. Drives the dashboard ESP32 card's RX/TX pin
// *dropdown*, which the UI shows only when auto-detection has NOT locked a working pin pair; the user
// then picks from real, wire-able pins. Power pads (GND/VCC) and not-broken-out GPIOs never appear
// (e.g. GPIO47 on the XIAO ESP32-S3), and pins that don't exist on the chip can't be listed. Once the
// bus answers on a pair, the UI shows the pins read-only instead — no picking needed.
//
// esp32s3 is the Seeed XIAO ESP32-S3 (the project's reference board): pads D0..D10 = GPIO 1..9,43,44;
// GPIO16/17 and 47/48 are NOT broken out, so they are absent. c3/c6 are the matching Seeed XIAO
// boards; esp32 is a classic DevKit safe-GPIO set; c5 is a conservative default. Pure header (no IDF),
// so it's host-tested in test/test_logic.cpp.
#include <cstring>

namespace daik {

struct BoardPins {
    const int* pins;   // usable X10A GPIOs, strictly ascending
    int        count;
};

// Usable X10A GPIOs for a CONFIG_IDF_TARGET string. Unknown/null target → the reference board (s3).
inline BoardPins board_pins(const char* target) {
    static const int esp32s3[] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 43, 44};                             // XIAO ESP32-S3 pads (D0..D10; D6=43/TX, D7=44/RX)
    static const int esp32c3[] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 21};                            // XIAO ESP32-C3 pads (D6=21/TX, D7=20/RX)
    static const int esp32c6[] = {0, 1, 2, 16, 17, 18, 19, 20, 21, 22, 23};                       // XIAO ESP32-C6 pads (D6=16/TX, D7=17/RX)
    static const int esp32c5[] = {0, 1, 3, 4, 5, 6, 10, 11};                                      // ESP32-C5 conservative safe set (default 4/5)
    static const int esp32[]   = {4, 5, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};  // classic ESP32 DevKit safe GPIOs (default 16/17)

    if (target) {
        if (!std::strcmp(target, "esp32s3")) return {esp32s3, (int)(sizeof(esp32s3) / sizeof(int))};
        if (!std::strcmp(target, "esp32c3")) return {esp32c3, (int)(sizeof(esp32c3) / sizeof(int))};
        if (!std::strcmp(target, "esp32c6")) return {esp32c6, (int)(sizeof(esp32c6) / sizeof(int))};
        if (!std::strcmp(target, "esp32c5")) return {esp32c5, (int)(sizeof(esp32c5) / sizeof(int))};
        if (!std::strcmp(target, "esp32"))   return {esp32,   (int)(sizeof(esp32) / sizeof(int))};
    }
    return {esp32s3, (int)(sizeof(esp32s3) / sizeof(int))};
}

} // namespace daik
