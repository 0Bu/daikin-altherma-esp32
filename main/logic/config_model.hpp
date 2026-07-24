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

namespace daik {

// Fixed poll cadence: the heat pump is queried every second (near-real-time; the MQTT bridge
// publishes only changes, so a fast poll is cheap). Not runtime-configurable.
inline constexpr int POLL_INTERVAL_S = 1;

struct Config {
    std::string wifi_ssid;
    std::string wifi_pass;
    std::string mqtt_uri;          // "" = MQTT disabled
    std::string mqtt_user;
    std::string mqtt_pass;
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

    // ── Auto-detected MODEL (not the link). Set by hp_detect.cpp; see logic/detect.hpp. ──
    // SESSION-ONLY: applied to the in-RAM config via config_set_model (apply_model, below) and NEVER
    // persisted — the model is re-detected on every boot (config_load seeds profile="auto"), so a
    // swapped unit is re-identified. The fingerprint lets /status recompute the candidate set cheaply
    // (no re-probe). (config_set_runtime — whole-struct RAM publish — survives only for POST /detect's
    // reset to "auto"; the poll task uses the field-owned config_set_model so it never reverts creds.)
    uint32_t    fp_pages     = 0;   // page mask that answered (logic/detect.hpp page_bit)
    int         fp_kw_tenths = -1;  // O/U capacity in 0.1 kW; -1 = unknown
    std::string fp_eeprom;          // rendered O/U EEPROM digits (display only)
    bool        fp_valid     = false;
};

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

// Apply the detected X10A link. Non-allocating, so it cannot throw inside the config mutex.
inline void apply_link(Config& c, int rx_pin, int tx_pin, Protocol proto) {
    c.rx_pin = rx_pin;
    c.tx_pin = tx_pin;
    c.proto  = proto;
}

// Apply the detected model + fingerprint. Takes its strings BY VALUE and swaps them in (both
// noexcept), so this too allocates nothing while the caller holds the mutex.
inline void apply_model(Config& c, std::string profile, uint32_t fp_pages, int fp_kw_tenths,
                        std::string fp_eeprom) {
    c.profile.swap(profile);
    c.fp_eeprom.swap(fp_eeprom);
    c.fp_pages     = fp_pages;
    c.fp_kw_tenths = fp_kw_tenths;
    c.fp_valid     = true;
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
inline ReservedPins config_reserved_pins(const Config& c) { return ReservedPins{c.led_gpio, c.btn_gpio}; }

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
    }
    if (c.btn_gpio >= 0) {
        if (!gpio_in_range(c.btn_gpio, max_gpio))          { reason = "btn_gpio out of range";  return false; }
        if (!board_pin_local_io(c.btn_gpio, octal_spi))    { reason = "btn_gpio is a reserved GPIO"; return false; }
        if (c.btn_gpio == c.rx_pin || c.btn_gpio == c.tx_pin) { reason = "btn_gpio is in use by the X10A link"; return false; }
        if (c.btn_gpio == c.led_gpio)                      { reason = "btn_gpio and led_gpio must differ"; return false; }
    }
    return true;
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
    return true;
}

// Validate WiFi credentials from POST /set_wifi. The SSID must be 1..32 bytes (the 802.11 limit);
// the password is either empty (open network) or a WPA-PSK-length 8..63 bytes. Same bounds the web
// UI enforces client-side (main/www/app.js) — kept here so the authoritative check is host-tested.
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

} // namespace daik
