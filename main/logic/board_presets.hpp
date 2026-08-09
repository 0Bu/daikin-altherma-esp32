#pragma once
// Ready-made board-hardware settings: the onboard status-indicator and recovery-button facts of the
// reference boards, plus the GPIOs each board actually exposes for external I2C accessories, as ONE
// table the web UI's "Board" dropdown fills from.
//
// WHY THIS EXISTS. One published esp32s3 image serves every board, so the indicator and the button
// are runtime settings (config_model.hpp, POST /set_board) seeded from Kconfig — and the shipped
// Kconfig seed is the XIAO's plain LED on GPIO21. Flash or OTA that image onto an M5Stack AtomS3
// Lite, whose only light is a WS2812 on GPIO35, and the firmware drives a pin with nothing on it:
// the board looks dead while being perfectly healthy, and nothing on /diag says otherwise. The five
// numbers that fix it — and the header-pin inventory that keeps accessory selectors honest — are
// documented per-board facts (docs/BOARDS.md) that the user should not have to transcribe from a
// datasheet into form fields.
//
// WHY IT IS FIRMWARE DATA rather than a table in www/js/settings.js: a browser-side copy would be a SECOND
// statement of the same board facts, free to drift from docs/BOARDS.md and from the validator with
// nothing to catch it — and a preset that fills pins the device then REJECTS is worse than no preset
// at all. Living here, it is served through /status.board.presets (so the modal's presets and its
// pin dropdowns arrive in one payload, no second fetch to fail) and the CI logic test asserts every
// offered preset passes the very validator POST /set_board applies (board_hw_valid).
//
// WHAT IT IS NOT: a claim about which board this is. The firmware cannot learn what it is soldered
// to — there is no board-ID EEPROM and nothing the ESP32-S3 can report (board_pins.hpp says this at
// length for the X10A pin set, and it is no more knowable here). Picking a preset is the USER
// telling the firmware what the hardware is; its stable id is persisted together with the same five
// configurable fields, never discovered from them. Which is also why the list stays short: a board
// earns an entry by being one the project documents and tests against, not by existing.
#include "board_pins.hpp"
#include "config_model.hpp"

namespace daik {

// Vendor is an explicit property of a user-selectable board preset, never inferred from its
// display name. Features tied to an accessory ecosystem (currently M5Stack ENV III) use it together
// with explicit connector metadata, without hard-coding one model name or accidentally enabling on
// a different vendor whose LED/button pins happen to match.
enum class BoardVendor : uint8_t { Unknown = 0, M5Stack, Seeed };

inline const char* board_vendor_name(BoardVendor vendor) {
    switch (vendor) {
        case BoardVendor::M5Stack: return "m5stack";
        case BoardVendor::Seeed:   return "seeed";
        default:                   return "unknown";
    }
}

// The five LED/button members mirror the board-local fields of Config (config_model.hpp), so applying
// a preset remains a field-for-field copy with nowhere for a translation bug to hide. `x10a_pins`
// and `i2c_pins` are different: they are immutable board metadata used to narrow external-bus
// pickers to pads that physically exist on this board. They are not persisted because the preset id
// already names the fact. Keep the two inventories separate even where they currently match: UART
// suitability and hardware-proven I2C suitability are different claims (GPIO39 on Atom is the
// concrete reason not to collapse them).
struct BoardPreset {
    BoardPresetId id;
    const char* key;               // stable JSON/config key; display name may change independently
    const char* name;
    BoardVendor vendor;
    int         led_gpio;        // -1 = no indicator on this board
    int         led_type;        // LedType as int (0 = plain GPIO, 1 = WS2812), like Config::led_type
    bool        led_inverted;    // GPIO type only; a WS2812 encodes "off" as the zero colour
    int         btn_gpio;        // -1 = no button broken out (the XIAO) — NOT "user must wire one"
    bool        btn_active_low;
    const int*  x10a_pins;       // physically exposed GPIOs allowed for the X10A UART
    int         x10a_pin_count;
    const int*  i2c_pins;        // physically exposed GPIOs allowed for an external I2C accessory
    int         i2c_pin_count;
};

// Upper bound on a returned list, for sizing a caller's buffer. Asserted against the real table
// host-side so it cannot silently drift.
inline constexpr int BOARD_PRESETS_MAX = 2;
inline constexpr int BOARD_X10A_PINS_MAX = 10;
inline constexpr int BOARD_I2C_PINS_MAX = 8;

// Board-physical X10A inventories from docs/BOARDS.md. Every entry must additionally pass the
// generic chip/build safety rule below; the table answers only the fact that rule cannot know:
// whether the PCB actually routes the pad to a usable connector/header.
inline constexpr int ATOMS3_LITE_X10A_PINS[] = {1, 2, 5, 6, 7, 8, 38};
inline constexpr int XIAO_ESP32S3_X10A_PINS[] = {1, 2, 4, 5, 6, 7, 8, 9, 43, 44};

// AtomS3 Lite pin map C124: Grove G1/G2 and side-header G5-G8/G38 are usable for ENV III. Although
// GPIO39 is physically exposed beside GPIO38, repeated ENV III tests on separate AtomS3 Lite boards
// did not establish reliable I2C communication on that pad. Keep it out of both dropdowns and the
// request validator instead of offering a wiring combination that cannot pass the save-time probe.
// Onboard-only GPIO4/35/41 and chip pads absent from the headers are deliberately omitted as well.
inline constexpr int ATOMS3_LITE_I2C_PINS[] = {1, 2, 5, 6, 7, 8, 38};

// The full table. Source of truth for these numbers is docs/BOARDS.md (the per-board hardware
// inventory); keep the two in step — the doc is where a board's facts are argued and cited, this is
// where they are executed. Display-equipped boards are intentionally absent: the firmware has no
// display driver or display role, so offering their non-display pin subset would falsely claim
// board support.
inline const BoardPreset* board_presets_all(int& count) {
    static const BoardPreset presets[] = {
        // The wiring reference (docs/WIRING.md): WS2812C-2020 on GPIO35, front button on GPIO41.
        // GPIO41 is MTDI, a dedicated-JTAG pad — legal for board-local I/O and withheld only from
        // the X10A picker, which is exactly the asymmetry board_pins.hpp's local-I/O set exists for.
        {BoardPresetId::M5StackAtomS3Lite, "m5stack_atoms3_lite",
         "M5Stack AtomS3 Lite", BoardVendor::M5Stack, 35, 1, false, 41, true,
         ATOMS3_LITE_X10A_PINS, static_cast<int>(sizeof(ATOMS3_LITE_X10A_PINS) / sizeof(int)),
         ATOMS3_LITE_I2C_PINS, static_cast<int>(sizeof(ATOMS3_LITE_I2C_PINS) / sizeof(int))},
        // Plain single-colour LED, ACTIVE LOW (pin driven LOW = lit). No button broken out, so the
        // preset leaves the recovery button off rather than guessing a free pin for the user to
        // solder to: an unconfigured input floats, and a floating pin that reads "pressed" for five
        // seconds factory-resets a board nobody touched (recovery_button.cpp).
        {BoardPresetId::SeeedXiaoEsp32S3, "seeed_xiao_esp32s3",
         "Seeed XIAO ESP32-S3", BoardVendor::Seeed, 21, 0, true, -1, true,
         XIAO_ESP32S3_X10A_PINS, static_cast<int>(sizeof(XIAO_ESP32S3_X10A_PINS) / sizeof(int)),
         nullptr, 0},
    };
    count = (int)(sizeof(presets) / sizeof(presets[0]));
    return presets;
}

inline const BoardPreset* board_preset_by_id(BoardPresetId id) {
    int count = 0;
    const BoardPreset* presets = board_presets_all(count);
    for (int i = 0; i < count; ++i)
        if (presets[i].id == id) return &presets[i];
    return nullptr;
}

inline const BoardPreset* board_preset_by_key(const std::string& key) {
    int count = 0;
    const BoardPreset* presets = board_presets_all(count);
    for (int i = 0; i < count; ++i)
        if (key == presets[i].key) return &presets[i];
    return nullptr;
}

inline const char* board_preset_key(BoardPresetId id) {
    if (id == BoardPresetId::Custom) return "custom";
    const BoardPreset* preset = board_preset_by_id(id);
    return preset ? preset->key : "";
}

// Field matching exists only for the pre-v12 migration: that legacy format recorded that board
// settings had been saved, but not which physical board the user had selected. Current firmware
// persists identity independently. The onboard LED/button defaults are useful starting values, not
// an identity proof: an AtomS3 Lite remains an AtomS3 Lite when its indicator or reset button is
// deliberately disabled.
inline bool board_preset_matches(const BoardPreset& p, const Config& c) {
    if (p.led_gpio != c.led_gpio) return false;
    if (p.led_gpio >= 0) {
        if (p.led_type != c.led_type) return false;
        if (p.led_type == 0 && p.led_inverted != c.led_inverted) return false;
    }
    if (p.btn_gpio != c.btn_gpio) return false;
    if (p.btn_gpio >= 0 && p.btn_active_low != c.btn_active_low) return false;
    return true;
}

// Identity validation used on POST and load. A current-format identity is the user's explicit board
// selection, not a reverse lookup from configurable peripherals. The ordinary hardware validator
// independently rejects unsafe GPIOs and collisions.
inline bool board_identity_valid(const Config& c, std::string& reason) {
    if (!c.board_user_set) {
        if (c.board_preset_id == BoardPresetId::Custom) return true;
        reason = "board preset requires an explicit selection";
        return false;
    }
    if (c.board_preset_id == BoardPresetId::Custom) return true;
    if (!board_preset_by_id(c.board_preset_id)) {
        reason = "board preset is unknown";
        return false;
    }
    return true;
}

inline const BoardPreset* board_selected_preset(const Config& c) {
    if (!c.board_user_set || c.board_preset_id == BoardPresetId::Custom) return nullptr;
    return board_preset_by_id(c.board_preset_id);
}

// Upgrade helper for pre-v12 firmware: the old `board_set` bit stated that these hardware values
// had been submitted but did not store which preset was picked. Recover the same name the old UI
// displayed; untouched defaults have board_user_set=false and never enter this path.
inline BoardPresetId board_legacy_preset_id(const Config& c) {
    if (!c.board_user_set) return BoardPresetId::Custom;
    int count = 0;
    const BoardPreset* presets = board_presets_all(count);
    for (int i = 0; i < count; ++i)
        if (board_preset_matches(presets[i], c)) return presets[i].id;
    return BoardPresetId::Custom;
}

inline BoardVendor board_selected_vendor(const Config& c) {
    const BoardPreset* preset = board_selected_preset(c);
    return preset ? preset->vendor : BoardVendor::Unknown;
}

// Board-aware X10A pins. board_pin_offerable() remains the chip/build authority; the preset adds
// the physical connector/header membership the ESP32-S3 cannot discover. Runtime reservations
// remove GPIOs currently driven by the status LED, recovery button, ENV III or Ethernet. A Custom
// board has no inventory and deliberately continues to use the generic chip-safe path at the call
// site rather than pretending an empty preset means no usable pins.
inline bool board_preset_x10a_pin_offerable(const BoardPreset* preset, int pin, bool octal_spi,
                                            ReservedPins used = {}) {
    if (!preset || !board_pin_offerable(pin, octal_spi, used)) return false;
    for (int i = 0; i < preset->x10a_pin_count; ++i)
        if (preset->x10a_pins[i] == pin) return true;
    return false;
}

inline int board_preset_x10a_pins_offerable(const BoardPreset* preset, int* out, int cap,
                                             bool octal_spi, ReservedPins used = {}) {
    if (!preset || !out || cap <= 0) return 0;
    int n = 0;
    for (int i = 0; i < preset->x10a_pin_count && n < cap; ++i) {
        const int pin = preset->x10a_pins[i];
        if (board_preset_x10a_pin_offerable(preset, pin, octal_spi, used)) out[n++] = pin;
    }
    return n;
}

// Board-aware external-I2C pins. The generic X10A list intentionally withholds every dedicated
// JTAG pad and cannot know which chip pads reach a connector. A selected board can answer both
// questions: membership in its documented header list, followed by the chip-level local-I/O safety
// rule. The latter can admit dedicated JTAG for board-local peripherals, but GPIO39 is deliberately
// absent from Atom's ENV III inventory after hardware tests; flash, strapping,
// USB-console and build-dependent Octal-SPI conflicts. Runtime reservations remove occupied pads.
inline bool board_preset_i2c_pin_offerable(const BoardPreset* preset, int pin, bool octal_spi,
                                           ReservedPins used = {}) {
    if (!preset || used.claims(pin) || !board_pin_local_io(pin, octal_spi)) return false;
    for (int i = 0; i < preset->i2c_pin_count; ++i)
        if (preset->i2c_pins[i] == pin) return true;
    return false;
}

inline int board_preset_i2c_pins_offerable(const BoardPreset* preset, int* out, int cap,
                                            bool octal_spi, ReservedPins used = {}) {
    if (!preset || !out || cap <= 0) return 0;
    int n = 0;
    for (int i = 0; i < preset->i2c_pin_count && n < cap; ++i) {
        const int pin = preset->i2c_pins[i];
        if (board_preset_i2c_pin_offerable(preset, pin, octal_spi, used)) out[n++] = pin;
    }
    return n;
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
// the count, like board_pins_offerable() and for the same reason: the filter is per-request, so a
// shared static would be a data race between any two callers that disagree about it (it was one
// while http_append_status_json() also ran on the poll task's WS broadcaster, removed in #241). The
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
