#pragma once
// Pure runtime-config model + validation. IDF-free so the web-UI payload validation and the
// pin/interval rules are host-tested (test/test_logic.cpp), then reused by config.cpp (which
// only adds the NVS load/save around it).
#include <cstdint>
#include <string>
#include "crc.hpp"
#include "board_pins.hpp"   // board_pin_offerable — the chip-reserved-pin rule validate() enforces
#include "led_pattern.hpp"  // LedType — the indicator back-end, now a runtime choice not a Kconfig one
#include "ota_channel.hpp"  // OtaChannel — which published feed this device follows
#include "modbus.hpp"       // MODBUS_TCP_PORT / MODBUS_DEFAULT_UNIT — the mb_* field defaults
#include "dynamic_lwt_controller.hpp"
#include "reference_temperature.hpp"
#include "ui_lang.hpp"      // UiLang — the web UI's manual language override (else browser-detected)

namespace daik {

// Stable identity of a board preset explicitly selected by the user. `Custom` is also the default
// numeric value; board_user_set distinguishes untouched build defaults from a deliberately saved
// Custom selection. The preset table maps these ids to names, vendors and hardware values.
enum class BoardPresetId : uint8_t {
    Custom = 0,
    M5StackAtomS3Lite = 1,
    SeeedXiaoEsp32S3 = 2,
};

// Fixed poll cadence: the heat pump is queried every second (near-real-time; the MQTT bridge
// publishes only changes, so a fast poll is cheap). Not runtime-configurable.
inline constexpr int POLL_INTERVAL_S = 1;

struct Config {
    std::string wifi_ssid;
    std::string wifi_pass;
    std::string mqtt_uri;          // "" = MQTT disabled
    std::string mqtt_user;
    std::string mqtt_pass;
    // One exact MQTT source for the living-room sample. An empty topic disables capture;
    // dot-separated paths select current/target, source timestamp and optional heating eligibility.
    // Without a timestamp path only a live non-retained MQTT arrival may be fresh; retained values
    // require source time so a reconnect cannot reset their age (logic/reference_temperature.hpp).
    std::string ref_temp_name;
    std::string ref_temp_topic;
    std::string ref_temp_path;
    std::string ref_temp_setpoint_path;
    std::string ref_temp_time_path;
    std::string ref_temp_enabled_path;
    std::string ref_temp_hvac_mode_path;
    uint32_t    ref_temp_max_age_s = REF_TEMP_MAX_AGE_DEFAULT_S;
    // Open-Meteo location in signed microdegrees. The explicit bit keeps (0°, 0°) representable;
    // disabled coordinates are canonicalized to zero and produce no weather traffic.
    bool        weather_enabled = false;
    int32_t     weather_latitude_e6 = 0;
    int32_t     weather_longitude_e6 = 0;
    // No dynamic-LWT mode field: the heating-curve diagnosis arms itself from the two sources below
    // (dynamic_lwt_armed), so there is nothing here to persist, migrate or leave stale. Its retired
    // blob byte is still written as zero — see config_store.hpp.
    std::string syslog_host;       // "" = Syslog disabled
    int         syslog_port = 514;
    // SNTP server (main/sntp_time.cpp). Unlike syslog_host, "" is not "off" — SNTP has no disabled
    // state, it just idles until a route to the server exists — so an empty save is read by
    // config_load() as "reset to the CONFIG_DAIKIN_NTP_SERVER compile-time default", the same way a
    // missing NVS key falls back to it on first boot. Runtime-overridable via POST /set_ntp, exactly
    // like syslog_host is via /set_syslog.
    std::string ntp_server;
    std::string profile  = "auto";  // "auto" = detect on next poll cycle; else a concrete profile id
    // Which OTA feed this device follows (logic/ota_channel.hpp) — PERSISTED, one writer (POST
    // /set_ota). Release by default: a merge to main no longer cuts a release, so the two feeds
    // move at completely different rates and a device must never drift onto the fast one by
    // accident. Applied LIVE (no reboot) — ota_update.cpp reads it when it fetches, nothing claims
    // it at task start the way the LED driver does.
    OtaChannel  ota_channel = OtaChannel::Release;
    // Manual web-UI language override (logic/ui_lang.hpp) — PERSISTED, one writer (POST /set_lang).
    // Auto by default: the browser keeps auto-detecting the language until the user picks one, and
    // only then does the device state a language that overrides every client's browser guess.
    // Applied LIVE (no reboot) — the UI reads it from /status; nothing claims it at task start.
    UiLang      ui_lang = UiLang::Auto;
    // One-shot WiFi credential rollback (POST /set_wifi -> wifi.cpp). The working credentials are
    // stashed here and `wifi_rollback_active` armed before the new ones are tried; the boot that
    // tries them either commits (clears both) or restores the backup. See logic/wifi_rollback.hpp.
    std::string wifi_ssid_backup;
    std::string wifi_pass_backup;
    bool        wifi_rollback_active = false;
    // Outcome marker: the last credential change was UNDONE — the new credentials never got a lease
    // and wifi.cpp restored the ones above. Persisted so it outlives the rollback's own reboot, and
    // surfaced as /status.wifi.rolled_back; otherwise a rollback is silent and the dashboard just
    // shows the old SSID, exactly as if the save had never been made. Cleared by the next /set_wifi.
    bool        wifi_rolled_back = false;
    // X10A link cache — PERSISTED (config.cpp): the wiring/protocol is boot-invariant, cached and
    // tried first by the detection sweep, re-persisted on change (hp_poll.cpp poll_detect).
    Protocol    proto    = Protocol::I;  // last detected framing (I/S); tried first, then the other
    int         rx_pin   = 44;
    int         tx_pin   = 43;

    // ── The HomeHub Modbus stack — PERSISTED (issue #32) ─────────────────────────────────────────
    // A SECOND, INDEPENDENT source, not an alternative to the X10A link above. The two share no
    // wire, no framing, no register model and no failure mode, so they run as separate tasks with
    // separate caches and separate link states (docs/MODBUS_PROTOCOL.md): X10A keeps working when
    // the LAN is down, and the HomeHub keeps reporting when the service cable is out. There is
    // deliberately NO "which transport" selector — that would model an exclusivity the hardware
    // does not have, and it is what an earlier revision of this got wrong.
    //
    // The configured HomeHub address. Empty has one unambiguous meaning: HomeHub is disabled, so no
    // Modbus task is created and neither mDNS nor the HomeHub is queried. Discovery is an explicit
    // user action in the edit dialog; a successful search merely fills this persistent field when
    // the user saves. It is never armed by boot or represented as a hidden runtime mode.
    std::string mb_host;
    int         mb_port     = MODBUS_TCP_PORT;      // Modbus TCP port (502; the plaintext HomeHub default)
    int         mb_unit_id  = MODBUS_DEFAULT_UNIT;  // Modbus unit/slave id (1..247, default 1)
    // Optional M5Stack ENV III outdoor-climate sensor. Both devices on the unit share one I2C
    // pair (SHT30 0x44 + QMP6988 0x70). Disabled by default so an OTA never starts driving pins the
    // user did not wire. Runtime pins keep the single published ESP32-S3 image board-neutral.
    bool        env3_enabled = false;
    int         env3_sda     = 2;
    int         env3_scl     = 1;

    // ── Board-local hardware: the status indicator + the recovery button — PERSISTED ─────────────
    // RUNTIME, not Kconfig, and that is the whole point. CI publishes ONE esp32s3 image
    // (scripts/ci-build-all.sh), but the boards it runs on disagree about their own onboard parts:
    // a Seeed XIAO ESP32-S3 has a plain active-low LED on GPIO21 and no button; an M5Stack AtomS3
    // Lite has a WS2812 on GPIO35 and a button on GPIO41. Compiling either in would fork the
    // published artifact (and with it the manifest, the web installer and the OTA feed) per board.
    // So the image carries BOTH drivers and picks from NVS at boot — exactly the way the X10A
    // rx/tx pins already work. Kconfig supplies only the first-boot defaults.
    // -1 = absent/disabled, and it is the default for the button on purpose: an unconfigured input
    // pin FLOATS, and a floating pin that reads low for five seconds would factory-reset a board
    // nobody touched. Opt-in, never inherited from a default.
    int         led_gpio       = -1;
    int         led_type       = static_cast<int>(LedType::Gpio);   // stored as int: it is on-flash
    bool        led_inverted   = false;   // true = active-low (drive LOW to light); GPIO type only
    int         btn_gpio       = -1;
    bool        btn_active_low = true;    // the usual wiring: pin to GND through the switch
    // Did the USER state this hardware, or are these merely the build's defaults? The five values
    // above cannot answer it: a fresh device is seeded from Kconfig, and those happen to EQUAL the
    // XIAO preset — so "GPIO21, plain, active-low" is both what a XIAO owner deliberately saved and
    // what nobody has said anything about. `board_preset_id` is the concrete statement — never
    // inferred from LED/button values at runtime — while this flag distinguishes untouched defaults
    // from an explicitly saved Custom board. Both ride atomically with the five hardware fields in
    // blob v12, while remaining semantically independent: a user may disable Atom's onboard LED or
    // reset button without changing which physical board this is.
    bool        board_user_set = false;
    BoardPresetId board_preset_id = BoardPresetId::Custom;

    // ── Auto-detected MODEL (not the link). Set by hp_detect.cpp; see logic/detect.hpp. ──
    // SESSION-ONLY: applied to the in-RAM config via config_set_model (apply_model, below) and NEVER
    // persisted — the model is re-detected on every boot (config_load seeds profile="auto"), so a
    // swapped unit is re-identified. The fingerprint lets /status recompute the candidate set cheaply
    // (no re-probe). (config_set_runtime — whole-struct RAM publish — survives only for POST /detect's
    // reset to "auto"; the poll task uses the field-owned config_set_model so it never reverts creds.)
    uint32_t    fp_pages     = 0;   // page mask that answered (logic/detect.hpp page_bit)
    int         fp_kw_tenths = -1;  // O/U capacity in 0.1 kW; -1 = unknown
    // I/U capacity code (reg 0x60 offset 6, same 0.1 kW units); -1 = unknown. Kept BESIDE the O/U
    // capacity rather than folded into it: the two are different measurements of the plant and only
    // one of them is the outdoor unit's own report. It is carried here — not just consumed inside
    // detection's ranking — because a unit whose 0x00 descriptor is too short to hold offset 12
    // leaves fp_kw_tenths at -1 forever, and the Model card then showed NO capacity at all while the
    // device knew the indoor unit's rated code the whole time. /status reports it as its own field
    // so the UI can say which unit the figure came from instead of implying an O/U reading.
    int         fp_iu_kw_tenths = -1;
    std::string fp_eeprom;          // rendered O/U EEPROM digits (display only)
    bool        fp_valid     = false;
};

// WHETHER THE HEATING-CURVE DIAGNOSIS RUNS — derived from the configuration, never switched. It is
// armed exactly while both of the inputs it describes exist: a decodable MQTT room-temperature
// source (which needs a broker to arrive over) and a forecast location. Nothing is persisted, so
// there is no mode to migrate, no stale SHADOW to disarm on boot, and no way for the answer to
// disagree with the configuration a reader can see. Deleting either source disarms it by the same
// definition that armed it.
//
// The HomeHub is deliberately NOT in here even though the plant gate comes from it. A missing
// mb_host is a missing PREREQUISITE and belongs in the running state (failsafe homehub_unavailable),
// where the UI names it and points at the setting; folding it in here would silently hide the whole
// card from anyone who has not set one up yet, which is how they would find out they need one.
inline bool dynamic_lwt_armed(const Config& c) {
    return !c.mqtt_uri.empty() && !c.ref_temp_topic.empty() && !c.ref_temp_path.empty() &&
           !c.ref_temp_setpoint_path.empty() && !c.ref_temp_time_path.empty() && c.weather_enabled;
}

// ── Field-owned patches (config.cpp applies these to the live config under its mutex) ────────────
// Two tasks write the config: the httpd task (/set_*) and the poll task (auto-detection). A writer
// that commits a whole Config snapshot commits everything it read AT SNAPSHOT TIME — so a detection
// cycle whose snapshot predates a POST /set_wifi would write the OLD credentials back over the new
// ones, and the user's change would vanish after {"ok":true}. Detection therefore patches only the
// fields it OWNS and never carries a stale copy of anyone else's:
//
//   LINK  (rx/tx/proto)                  — persisted; owned by detection, overridable via /set_hp
//   MODEL (profile + fingerprint fp_*)   — RAM-only, re-derived every boot; owned by detection
//
// Whole-struct config_save() stays for the HTTP handlers: they own the credential fields and are
// serialized against each other on the single httpd task.
//
// The rule is therefore ASYMMETRIC, on purpose. It closes poll→httpd (a detection commit can no
// longer revert credentials) but not httpd→poll: a /set_* save still republishes its whole snapshot,
// so it can revert a link commit that landed in its own sub-millisecond snapshot→save window. That
// direction is left open because it is self-correcting and cheap — detection re-runs and re-fixes
// the link — whereas the credentials it protects are user-entered and unrecoverable.

// Decide whether a whole-struct config save achieved what its CALLER requires. The atomic service
// blob and the self-healing X10A link cache are deliberately different durability domains:
//
//   * ordinary /set_wifi|mqtt|syslog|ntp|board|ota saves own only blob fields; once that one atomic
//     write lands, a link-cache maintenance failure must not turn the already-committed request into
//     a false HTTP 500;
//   * /set_hp owns the link and therefore requires all three link keys as well.
//
// Kept pure so the distinction cannot silently collapse back to "any cache error means nothing was
// saved" in config.cpp.
inline bool config_save_succeeded(bool blob_ok, bool link_ok, bool require_link) {
    return blob_ok && (!require_link || link_ok);
}

// The address the Modbus stack should dial. Empty is disabled. Keeping this accessor makes the
// task, /status and UI share that single rule instead of reintroducing an implicit Auto state.
inline const std::string& config_modbus_host(const Config& c) {
    return c.mb_host;
}

inline bool config_modbus_enabled(const Config& c) { return !c.mb_host.empty(); }

inline void apply_link(Config& c, int rx_pin, int tx_pin, Protocol proto) {
    c.rx_pin = rx_pin;
    c.tx_pin = tx_pin;
    c.proto  = proto;
}

// Apply the detected model + fingerprint. Takes its strings BY VALUE and swaps them in (both
// noexcept), so this too allocates nothing while the caller holds the mutex.
inline void apply_model(Config& c, std::string profile, uint32_t fp_pages, int fp_kw_tenths,
                        int fp_iu_kw_tenths, std::string fp_eeprom) {
    c.profile.swap(profile);
    c.fp_eeprom.swap(fp_eeprom);
    c.fp_pages        = fp_pages;
    c.fp_kw_tenths    = fp_kw_tenths;
    c.fp_iu_kw_tenths = fp_iu_kw_tenths;
    c.fp_valid        = true;
}

// Coarse GPIO upper-bound guard. `max_gpio` is the target's highest GPIO number; the device caller
// passes its real per-target value (SOC_GPIO_PIN_COUNT-1), so a pin above the running chip's range
// is rejected — e.g. the ESP32-S3 default 44 on an ESP32-C3 (max GPIO 21). The default 48 (S3 max)
// is only the host-test fallback. This is a range guard, not a full per-pad reachability map.
inline bool gpio_in_range(int p, int max_gpio = 48) { return p >= 0 && p <= max_gpio; }

// The X10A link rule, as a PAIR: two individually-legal pins are still an illegal link if they name
// the same pad. One predicate because two paths must apply it — the request path (validate, below)
// and the LOAD path (config.cpp). The latter needs it because config_save commits rx_pin and tx_pin
// as separate NVS writes, so flash can hold a pair that no request could have set.
inline bool link_pins_valid(int rx, int tx, int max_gpio = 48) {
    return gpio_in_range(rx, max_gpio) && gpio_in_range(tx, max_gpio) && rx != tx;
}

// The full link rule: the pair rule (above) PLUS the chip-reserved-pin rule (logic/board_pins.hpp).
// Two individually-legal, distinct pins are still an illegal link if either names a pad this
// chip/build reserves (SPI flash, strapping, JTAG, USB-Serial/JTAG, octal-SPI) or the pin the status
// indicator or the recovery button already occupies — the range-only link_pins_valid could not see
// those. Both the request path (validate) and the LOAD path (config.cpp) apply it, so a /set_hp and a
// persisted cache can only hold a pair the UI would also have offered. `octal_spi` is supplied by the
// caller from Kconfig (config.cpp hw_octal_spi()) and `reserved` from the live config
// (config_reserved_pins), keeping this header CONFIG_-free.
inline bool link_pins_safe(int rx, int tx, bool octal_spi, ReservedPins reserved, int max_gpio = 48) {
    return link_pins_valid(rx, tx, max_gpio)
        && board_pin_offerable(rx, octal_spi, reserved)
        && board_pin_offerable(tx, octal_spi, reserved);
}

// The GPIOs the firmware itself drives, as board_pins.hpp's `reserved` input. One accessor so the
// three places that need it — /status's pin dropdown, /set_hp's validation and config_load()'s
// load-path re-check — cannot disagree about which pins are spoken for.
inline ReservedPins config_reserved_pins(const Config& c) {
    return c.env3_enabled ? ReservedPins{c.led_gpio, c.btn_gpio, c.env3_sda, c.env3_scl}
                          : ReservedPins{c.led_gpio, c.btn_gpio};
}

// The MIRROR of the above: the GPIOs the X10A link occupies, for the LED/button pin pickers
// (/status.board.pins_local via board_pins_local). The reservation has to run in both directions or
// it protects only one of them — board_hw_valid() below rejects an indicator or button pin that
// equals rx/tx, so a picker that still offers those two is offering a pick the device will refuse.
// Named factories rather than one ambiguous helper, because which subsystem is reserved is the
// caller's statement of intent; board_pins.hpp's ReservedPins is deliberately anonymous about it.
inline ReservedPins config_link_pins(const Config& c) { return ReservedPins{c.rx_pin, c.tx_pin}; }

// Reservations for board-local pickers/presets and for the ENV III picker respectively. Keeping
// the directions explicit prevents either dialog from offering a GPIO the other subsystem owns.
inline ReservedPins config_board_reserved_pins(const Config& c) {
    return c.env3_enabled ? ReservedPins{c.rx_pin, c.tx_pin, c.env3_sda, c.env3_scl}
                          : ReservedPins{c.rx_pin, c.tx_pin};
}
inline ReservedPins config_env3_reserved_pins(const Config& c) {
    return ReservedPins{c.rx_pin, c.tx_pin, c.led_gpio, c.btn_gpio};
}

// Validate the board-local hardware half of a config (POST /set_board, and the load path). Separate
// from validate() below because it is checked on its own route and must name its own field; the two
// share the collision rules so a pin can never be claimed twice.
//
// Both pins are optional (-1 = absent) and are checked against board_pin_local_io, NOT against the
// X10A offerable set: the indicator and the button legitimately sit on the dedicated-JTAG pads that
// the X10A dropdown withholds as a preference (board_pins.hpp explains the difference — the AtomS3
// Lite's button is on GPIO41). What they may NOT do is collide: with each other, or with the X10A
// link, in either direction. Checking it here as well as in validate() is not redundant — the two
// routes can be called in either order, and whichever runs second must see the other's pins.
inline bool board_hw_valid(const Config& c, std::string& reason, int max_gpio = 48,
                           bool octal_spi = true) {
    if (!led_type_valid(c.led_type)) { reason = "led_type unknown"; return false; }
    if (c.led_gpio >= 0) {
        if (!gpio_in_range(c.led_gpio, max_gpio))          { reason = "led_gpio out of range";  return false; }
        if (!board_pin_local_io(c.led_gpio, octal_spi))    { reason = "led_gpio is a reserved GPIO"; return false; }
        if (c.led_gpio == c.rx_pin || c.led_gpio == c.tx_pin) { reason = "led_gpio is in use by the X10A link"; return false; }
        if (c.env3_enabled && (c.led_gpio == c.env3_sda || c.led_gpio == c.env3_scl)) { reason = "led_gpio is in use by ENV III"; return false; }
    }
    if (c.btn_gpio >= 0) {
        if (!gpio_in_range(c.btn_gpio, max_gpio))          { reason = "btn_gpio out of range";  return false; }
        if (!board_pin_local_io(c.btn_gpio, octal_spi))    { reason = "btn_gpio is a reserved GPIO"; return false; }
        if (c.btn_gpio == c.rx_pin || c.btn_gpio == c.tx_pin) { reason = "btn_gpio is in use by the X10A link"; return false; }
        if (c.env3_enabled && (c.btn_gpio == c.env3_sda || c.btn_gpio == c.env3_scl)) { reason = "btn_gpio is in use by ENV III"; return false; }
        if (c.btn_gpio == c.led_gpio)                      { reason = "btn_gpio and led_gpio must differ"; return false; }
    }
    return true;
}

// ── What POST /set_board actually has to DO ─────────────────────────────────────────────────────
// TWO independent facts can move, and conflating them is what produced #257. The five HARDWARE
// values decide whether a REBOOT is needed (both are claimed once at task start — the WS2812 opens
// an RMT channel, the button installs a pull). The explicitly selected preset id decides which board
// the firmware may name and which vendor-gated accessories it may enable; changing identity without
// changing hardware needs a SAVE but no reboot. Pure so the combinations are asserted here.
//
// The case that matters is `values same, not yet stated`: a XIAO owner picking "Seeed XIAO" on a
// device still carrying the Kconfig defaults changes no value, so the old route answered
// {"reboot":false} and saved NOTHING — the statement was dropped, the modal re-opened on "Custom",
// and the user re-picked their board forever. It is a SAVE (persist the statement) with NO reboot.
inline bool board_hw_same(const Config& a, const Config& b) {
    return a.led_gpio == b.led_gpio && a.led_type == b.led_type && a.led_inverted == b.led_inverted &&
           a.btn_gpio == b.btn_gpio && a.btn_active_low == b.btn_active_low;
}
inline bool board_identity_same(const Config& a, const Config& b) {
    return a.board_user_set == b.board_user_set && a.board_preset_id == b.board_preset_id;
}
// A reboot is owed to a HARDWARE change alone: recording the statement changes nothing a driver holds.
inline bool board_reboot_needed(const Config& want, const Config& cur) { return !board_hw_same(want, cur); }
// ...but a save is owed to hardware or explicit identity. Atom -> Custom with identical fields is a
// real statement change, even though no driver needs a reboot.
inline bool board_save_needed(const Config& want, const Config& cur) {
    return !board_hw_same(want, cur) || !board_identity_same(want, cur);
}

// Validate a config coming from the web UI. Returns false + a reason on the first problem. Pass the
// target's highest GPIO as `max_gpio` so pins are checked against the actual chip. The two range
// checks exist to name WHICH pin is wrong; link_pins_valid is the authority on the pair itself, so a
// rule added there is inherited here.
// `octal_spi`/`reserved` gate the chip-reserved-pin check (board_pins.hpp); their defaults
// (conservative octal=true, nothing reserved) keep the pair check strict for host tests that don't
// pass them. The device call site (http_config.cpp /set_hp) passes the real values so a reserved
// GPIO — a flash/strapping/JTAG pad, or the pin the indicator/button holds — is rejected with the pin named
// instead of range-accepted and persisted into a crash loop.
inline bool validate(const Config& c, std::string& reason, int max_gpio = 48,
                     bool octal_spi = true, ReservedPins reserved = {}) {
    if (!gpio_in_range(c.rx_pin, max_gpio)) { reason = "rx_pin out of range"; return false; }
    if (!gpio_in_range(c.tx_pin, max_gpio)) { reason = "tx_pin out of range"; return false; }
    if (!link_pins_valid(c.rx_pin, c.tx_pin, max_gpio)) { reason = "rx_pin and tx_pin must differ"; return false; }
    if (!board_pin_offerable(c.rx_pin, octal_spi, reserved)) { reason = "rx_pin is a reserved GPIO"; return false; }
    if (!board_pin_offerable(c.tx_pin, octal_spi, reserved)) { reason = "tx_pin is a reserved GPIO"; return false; }
    if (c.proto != Protocol::I && c.proto != Protocol::S) { reason = "protocol must be I or S"; return false; }
    if (!c.syslog_host.empty() && (c.syslog_port < 1 || c.syslog_port > 65535)) { reason = "syslog_port out of range"; return false; }
    // Modbus TCP link params. Checked UNCONDITIONALLY (not gated on transport): the struct defaults
    // 502/1 pass for every X10A config, so this only bites a bad Modbus setting. mb_host is free text
    // like syslog_host — empty disables the optional HomeHub stack and is valid.
    if (c.mb_port < 1 || c.mb_port > 65535)   { reason = "mb_port out of range"; return false; }
    if (c.mb_unit_id < 1 || c.mb_unit_id > 247) { reason = "mb_unit_id out of range"; return false; }
    return true;
}

// Validate WiFi credentials from POST /set_wifi. The SSID must be 1..32 bytes (the 802.11 limit);
// the password is either empty (open network) or a WPA-PSK-length 8..63 bytes. Same bounds the web
// UI enforces client-side (main/www/js/settings.js) — kept here so the authoritative check is host-tested.
// Returns false + a reason on the first problem.
inline bool wifi_credentials_valid(const std::string& ssid, const std::string& pass, std::string& reason) {
    if (ssid.empty() || ssid.size() > 32)                     { reason = "invalid ssid";     return false; }
    if (!pass.empty() && (pass.size() < 8 || pass.size() > 63)) { reason = "invalid password"; return false; }
    return true;
}

inline Protocol parse_protocol(const std::string& s) {
    return (!s.empty() && (s[0] == 'S' || s[0] == 's')) ? Protocol::S : Protocol::I;
}

// A /set_hp update carries the model "profile" only when the request explicitly sends it. A
// wiring-only patch (RX/TX pins, no "profile" key) OMITS it, and such a patch must not disturb a
// settled detection. Only an explicit "auto" — a re-detect request or the Wiring Save — clears the
// cached fingerprint so the next poll re-sweeps; a concrete id pins the model and leaves the
// fingerprint alone. Returns whether fp_valid should be cleared.
inline bool set_hp_clears_fingerprint(bool profile_present, const std::string& profile_value) {
    return profile_present && profile_value == "auto";
}

// The rolling X10A observation belongs to one physical link/profile identity. An explicit profile
// request is an identity statement even when its text matches the current value; changing either
// wire may attach a different unit. HomeHub-only fields share /set_hp but are an independent source
// and must not discard X10A evidence.
inline bool set_hp_resets_checkup(bool profile_present, int old_rx, int old_tx,
                                  int new_rx, int new_tx) {
    return profile_present || old_rx != new_rx || old_tx != new_tx;
}

// HomeHub history belongs to one physical Modbus target. Actuation consent and other /set_hp fields
// do not change that identity; host, port or unit id do. The recorder preserves the common 24-hour
// raster but turns the elapsed part into gaps so values from two gateways are never spliced.
inline bool homehub_history_identity_changed(const std::string& old_host, int old_port, int old_unit,
                                             const std::string& new_host, int new_port, int new_unit) {
    return old_host != new_host || old_port != new_port || old_unit != new_unit;
}

} // namespace daik
