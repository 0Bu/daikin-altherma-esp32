#pragma once
// Ready-made board-hardware settings: the onboard status-indicator and recovery-button facts of the
// reference boards, as ONE table the web UI's "Board" dropdown fills its five fields from.
//
// WHY THIS EXISTS. One published esp32s3 image serves every board, so the indicator and the button
// are runtime settings (config_model.hpp, POST /set_board) seeded from Kconfig — and the shipped
// Kconfig seed is the XIAO's plain LED on GPIO21. Flash or OTA that image onto an M5Stack AtomS3
// Lite, whose only light is a WS2812 on GPIO35, and the firmware drives a pin with nothing on it:
// the board looks dead while being perfectly healthy, and nothing on /diag says otherwise. The five
// numbers that fix it are a documented per-board fact (docs/BOARDS.md) that the user should not have
// to transcribe from a datasheet into five form fields.
//
// WHY IT IS FIRMWARE DATA rather than a table in www/app.js: a browser-side copy would be a SECOND
// statement of the same board facts, free to drift from docs/BOARDS.md and from the validator with
// nothing to catch it — and a preset that fills pins the device then REJECTS is worse than no preset
// at all. Living here, it is served through /status.board.presets (so the modal's presets and its
// pin dropdowns arrive in one payload, no second fetch to fail) and the CI logic test asserts every
// offered preset passes the very validator POST /set_board applies (board_hw_valid).
//
// WHAT IT IS NOT: a claim about which board this is. The firmware cannot learn what it is soldered
// to — there is no board-ID EEPROM and nothing the ESP32-S3 can report (board_pins.hpp says this at
// length for the X10A pin set, and it is no more knowable here). Picking a preset is the USER
// telling the firmware what the hardware is; it is a shortcut through the same five fields, never a
// detection result. Which is also why the list stays short: a board earns an entry by being one the
// project documents and tests against, not by existing.
#include "board_pins.hpp"

namespace daik {

// Mirrors the five board-local fields of Config (config_model.hpp) — deliberately a plain aggregate
// of exactly those, so applying a preset is a field-for-field copy with nowhere for a translation
// bug to hide.
struct BoardPreset {
    const char* name;
    int         led_gpio;        // -1 = no indicator on this board
    int         led_type;        // LedType as int (0 = plain GPIO, 1 = WS2812), like Config::led_type
    bool        led_inverted;    // GPIO type only; a WS2812 encodes "off" as the zero colour
    int         btn_gpio;        // -1 = no button broken out (the XIAO) — NOT "user must wire one"
    bool        btn_active_low;
};

// Upper bound on a returned list, for sizing a caller's buffer. Asserted against the real table
// host-side so it cannot silently drift.
inline constexpr int BOARD_PRESETS_MAX = 2;

// The full table. Source of truth for these numbers is docs/BOARDS.md (the per-board hardware
// inventory); keep the two in step — the doc is where a board's facts are argued and cited, this is
// where they are executed.
inline const BoardPreset* board_presets_all(int& count) {
    static const BoardPreset presets[] = {
        // The wiring reference (docs/WIRING.md): WS2812C-2020 on GPIO35, front button on GPIO41.
        // GPIO41 is MTDI, a dedicated-JTAG pad — legal for board-local I/O and withheld only from
        // the X10A picker, which is exactly the asymmetry board_pins.hpp's local-I/O set exists for.
        {"M5Stack AtomS3 Lite", 35, 1, false, 41, true},
        // Plain single-colour LED, ACTIVE LOW (pin driven LOW = lit). No button broken out, so the
        // preset leaves the recovery button off rather than guessing a free pin for the user to
        // solder to: an unconfigured input floats, and a floating pin that reads "pressed" for five
        // seconds factory-resets a board nobody touched (recovery_button.cpp).
        {"Seeed XIAO ESP32-S3", 21, 0, true, -1, true},
    };
    count = (int)(sizeof(presets) / sizeof(presets[0]));
    return presets;
}

// The presets THIS BUILD and THIS CONFIG can actually apply. A preset whose LED or button pin is
// unusable here is withheld rather than offered and then refused at POST time — the same rule
// board_pins_offerable() applies to the X10A dropdown and board_pins_local() applies to the two
// local pickers, for the same reason: a pick that cannot work is not a pick. Two independent axes
// make a preset unusable:
//
//   `octal_spi`  the firmware's own build config. GPIO35 (the AtomS3 Lite's WS2812) is free on this
//                project's Quad-flash/no-PSRAM build and carries SPIIO4 on an Octal one.
//   `link`       the X10A link's live rx/tx (config_link_pins). board_hw_valid() refuses a local pin
//                that equals either, so a preset colliding with the user's current wiring is a
//                dropdown entry whose only outcome is a 400. Runtime, hence a parameter: the same
//                build serves a user who has moved the link onto the pad a preset wants.
//
// Writes borrowed pointers into a CALLER-owned buffer (size it with BOARD_PRESETS_MAX) and returns
// the count, like board_pins_offerable(): http_append_status_json() runs on the httpd task AND on
// the poll task's WS broadcaster, so a filtered shared static would be a data race between them. The
// pointed-to table is immutable and has static storage duration, so the pointers stay valid.
inline int board_presets_offerable(const BoardPreset** out, int cap, bool octal_spi,
                                   ReservedPins link = {}) {
    int all_n = 0;
    const BoardPreset* all = board_presets_all(all_n);
    int n = 0;
    for (int i = 0; i < all_n && n < cap; i++) {
        const int led = all[i].led_gpio, btn = all[i].btn_gpio;
        if (led >= 0 && (!board_pin_local_io(led, octal_spi) || link.claims(led))) continue;
        if (btn >= 0 && (!board_pin_local_io(btn, octal_spi) || link.claims(btn))) continue;
        out[n++] = &all[i];
    }
    return n;
}

} // namespace daik
