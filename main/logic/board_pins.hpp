#pragma once
// The ESP32-S3 GPIOs safe to offer in the X10A RX/TX pin *dropdown* (drives the dashboard's picker,
// which the UI shows only when auto-detection has NOT locked a working pin pair; once the bus
// answers on a pair, the UI shows the pins read-only instead — no picking needed).
//
// This is a CHIP-level safe set, not a claim about any specific board's silkscreen: firmware has no
// way to learn which of a chip's pins are actually wired out to a header on the PCB it happens to be
// soldered to (no board-ID EEPROM, nothing the ESP32-S3 itself can report) — that's a hardware fact,
// not something software can discover at runtime. What IS knowable, and what this list is built
// from, is which GPIOs the chip itself reserves for something else regardless of board:
//   - SPI flash (GPIO26-32) — every board needs boot flash, wired here unconditionally.
//   - Octal-mode flash/PSRAM (GPIO33-37, SPIIO4-7/DQS) — reserved only on builds whose flash and/or
//     PSRAM actually run in Octal I/O; a Quad/no-PSRAM build (this project's current sdkconfig:
//     FLASHMODE_DIO, no CONFIG_SPIRAM) leaves them free, so this is the one axis that genuinely
//     varies with the FIRMWARE's own build config rather than the board — see `octal_spi` below.
//   - Strapping pins (GPIO0 boot-mode/DTR, GPIO3 JTAG-source-select, GPIO45 VDD_SPI voltage,
//     GPIO46 boot-message mute) — repurposing these can change what the chip does on its NEXT reset.
//   - USB-JTAG (GPIO19/20, fixed in silicon) — this project's console runs on native
//     USB-Serial/JTAG (CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG), i.e. these two ARE already spoken for.
//   - Dedicated 4-wire JTAG (GPIO39-42, MTCK/MTDO/MTDI/MTMS) — reserved so an external debug probe
//     stays usable; costs only 4 pins out of 45.
// Facts verified against the pinned ESP-IDF v6.0.2 toolchain (components/esp_hal_gpspi/esp32s3/
// include/soc/spi_pins.h, soc/soc_caps.h, docs/en/api-reference/peripherals/gpio/esp32s3.inc,
// docs/en/api-guides/jtag-debugging/esp32s3.inc) — not board vendor documentation.
//
// GPIO43/44 (this project's Kconfig X10A default) and GPIO1/2/4-18/21/38/47/48 fall outside every
// reserved category and are the generically safe candidates on ANY ESP32-S3 board wired normally —
// whether or not that board actually breaks each one out to a header is for the user to know, same
// as it always was for GPIO43/44.
//
// Pure header (no IDF), so it's host-tested in test/test_logic.cpp; the `octal_spi` and `reserved`
// inputs are supplied by the caller, computed from Kconfig at the IDF-side call site
// (http_status.cpp), since this header must not itself depend on CONFIG_* macros.

namespace daik {

struct BoardPins {
    const int* pins;   // usable X10A GPIOs, strictly ascending
    int        count;
};

// Upper bound on a returned list — sizes a caller's buffer for board_pins_offerable(). Asserted
// against the real lists host-side, so it can't silently drift from the arrays below.
inline constexpr int BOARD_PINS_MAX = 28;

// octal_spi: true if THIS build's flash and/or PSRAM run Octal I/O (GPIO33-37 then carry
// SPIIO4-7/DQS and are unsafe for anything else); false (Quad/Dual flash, no PSRAM or Quad PSRAM)
// leaves them free. Defaults to true — the conservative, always-safe answer — so a caller that
// forgets to pass it never gets an unsafe list.
inline BoardPins board_pins(const char* /*target*/ = nullptr, bool octal_spi = true) {
    // Octal builds additionally reserve GPIO33-37; everything else about the two lists is identical.
    static const int conservative[] = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                                        21, 38, 43, 44, 47, 48};
    static const int permissive[]   = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                                        21, 33, 34, 35, 36, 37, 38, 43, 44, 47, 48};
    if (octal_spi) return {conservative, (int)(sizeof(conservative) / sizeof(int))};
    return {permissive, (int)(sizeof(permissive) / sizeof(int))};
}

// The pins actually OFFERED to the user: board_pins() minus `reserved` — a GPIO this firmware has
// already claimed for itself, i.e. the status LED (CONFIG_DAIKIN_STATUS_LED_GPIO, default 21 and
// enabled by default; -1 = nothing reserved). Chip-safe is not the same as free: status_led.cpp
// drives its pin as a push-pull OUTPUT once per tick, so offering it would hand the user a pick that
// silently cannot work — on TX the LED fights the UART, on RX it overpowers the bus and the port
// reads the LED instead of the heat pump. The dropdown must not recommend a pin the firmware itself
// is using.
//
// Writes into a CALLER-owned buffer and returns the count, rather than returning a shared static
// list: build_status_json_string() runs on the httpd task AND on the poll task's WS broadcaster, so
// a filtered static would be a data race between them. Returns pins strictly ascending, like
// board_pins(). Size `out` with BOARD_PINS_MAX.
inline int board_pins_offerable(int* out, int cap, bool octal_spi, int reserved = -1) {
    BoardPins bp = board_pins(nullptr, octal_spi);
    int n = 0;
    for (int i = 0; i < bp.count && n < cap; i++) {
        if (bp.pins[i] == reserved) continue;
        out[n++] = bp.pins[i];
    }
    return n;
}

// Membership test for the SAME set board_pins_offerable() emits: is `pin` chip-safe for this build
// AND not the firmware-reserved pin? The authoritative request path (config_model.hpp validate) and
// the load-path guard (config.cpp) both call this so the pins a /set_hp — or a persisted link cache —
// can hold match exactly the set the UI offers. Without it, validate()'s range-only check accepted a
// curl POST that routed the X10A UART onto the SPI-flash pins (GPIO26-32): flash traffic corrupts, the
// board crash-loops, and the toxic pair is already persisted so every boot re-tries it.
inline bool board_pin_offerable(int pin, bool octal_spi, int reserved = -1) {
    if (pin == reserved) return false;
    BoardPins bp = board_pins(nullptr, octal_spi);
    for (int i = 0; i < bp.count; i++)
        if (bp.pins[i] == pin) return true;
    return false;
}

} // namespace daik
