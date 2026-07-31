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
#include "ui_lang.hpp"      // UiLang — the web UI's manual language override (else browser-detected)

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
    // THE ADDRESS IS THE SWITCH. There is no separate enable flag: the stack runs when — and only
    // when — a gateway address is known, so a board with none costs no task, no socket and no mDNS
    // traffic, which is the property a flag was there to guarantee. A flag beside the address would
    // be a second way to say the same thing, and the two can disagree.
    //
    // mb_host is the MANUALLY entered address ("" = none entered). It is not the whole answer: the
    // address actually used is manual-else-discovered (config_modbus_host), because the one-shot
    // search below writes its result to its own key.
    std::string mb_host;
    int         mb_port     = MODBUS_TCP_PORT;      // Modbus TCP port (502; the plaintext HomeHub default)
    int         mb_unit_id  = MODBUS_DEFAULT_UNIT;  // Modbus unit/slave id (1..247, default 1)
    // ── The one-shot mDNS search result — PERSISTED, and written by the MODBUS task alone ────────
    // The search is SUPPORTING, not continuous: the firmware browses ONCE, on the first boot that
    // has no address at all, and then records what it learned. Found -> mb_dhost holds the resolved IPv4
    // and the stack runs from then on. Not found -> mb_searched latches true and NO LATER BOOT
    // BROWSES AGAIN; adding a HomeHub afterwards is a manual mb_host entry, which is a deliberate act
    // and needs no search. That is why these two are not in the atomic credential blob: mb_host has
    // exactly ONE writer (httpd, POST /set_hp) while these have exactly one OTHER writer (the Modbus
    // task), and a task that saves a whole Config saves whatever it snapshotted — the same two-owner
    // problem the rx/tx link cache is split out for. The IP is deliberately visible/editable in the
    // Host field; if DHCP later changes it, the resulting reachability error says exactly what failed
    // and the user can clear/re-enter the address.
    std::string mb_dhost;                 // IPv4 address the mDNS search resolved ("" = none)
    bool        mb_searched  = false;     // true once the one-shot search has run (found or not)

    // SAFETY FLAG for the future in-firmware actuation path (#32 P3), default OFF. P1/P2 build only
    // the READ stack — nothing writes a pump register — so this flag currently gates nothing; it is
    // persisted here so P3 lands without another blob-version bump, and so the UI/API can already
    // report it. There is no external writer by design.
    bool        actuation_enabled = false;

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
    // what nobody has said anything about. The web UI needs the difference to name the board in its
    // preset dropdown without CLAIMING one nobody chose (#256), and without the opposite failure
    // (#257): a modal that opens on "Custom" although the values are exactly the preset the user
    // just saved, so re-picking their own board submits an unchanged form.
    //
    // NOT in the atomic config blob, unlike the five values it describes, and that is a decision
    // rather than an oversight. The flag never NAMES a board — the UI derives the name from the live
    // field values (syncPresetSelection) and this only decides whether a name may be shown at all —
    // so a flag that drifted from the values cannot produce a WRONG board name, only the "Custom"
    // the UI already falls back to. That removes the all-or-nothing argument that puts one-writer
    // fields in the blob, and it avoids a blob version bump, which is not free here: two other
    // branches already carry a v5 and a v6 blob, and a version a build does not know reads on the
    // device as a wiped configuration (config_blob_deserialize refuses it, the legacy per-key
    // fallback is empty, and the board comes up in the setup portal with its credentials intact but
    // unread).
    bool        board_user_set = false;

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

// Apply the detected X10A link. Non-allocating, so it cannot throw inside the config mutex.
// The address the Modbus stack should dial, and — because the address is the switch — whether that
// stack exists at all. Manual entry WINS over the discovered IPv4 address, and does not erase it: a user
// who types an address is correcting what the search found, and clearing the field again must fall
// back to the search result rather than to nothing. Pure so the precedence is asserted once instead
// of re-derived at each call site (the task's gate, its connect, /status and the UI).
inline const std::string& config_modbus_host(const Config& c) {
    return c.mb_host.empty() ? c.mb_dhost : c.mb_host;
}

// Should the one-shot mDNS search run on this boot? Only when NOTHING is known: no manual address,
// no recorded discovery, and the search has never completed. Latching on mb_searched rather than on
// "mb_dhost is empty" is the whole point — a search that found nothing must be remembered as HAVING
// RUN, or every boot browses the LAN again for a gateway that is not there.
inline bool config_modbus_should_search(const Config& c) {
    return c.mb_host.empty() && c.mb_dhost.empty() && !c.mb_searched;
}

// Upgrade migration for devices that persisted the serial-derived mDNS label before discovery was
// changed to store its A record. Never rewrite a manually entered host, even if the user chose a
// homehub-* name deliberately; only the Modbus task-owned discovery field is eligible.
inline bool config_modbus_discovery_needs_ipv4(const Config& c) {
    return c.mb_host.empty() && !c.mb_dhost.empty() && is_homehub_hostname(c.mb_dhost.c_str());
}

// Record the one-shot search's outcome in the live config. `host` is empty when nothing answered —
// mb_searched latches either way, which is what makes the search one-shot.
inline void apply_modbus_found(Config& c, std::string host) {
    c.mb_dhost    = std::move(host);
    c.mb_searched = true;
}

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
inline ReservedPins config_reserved_pins(const Config& c) { return ReservedPins{c.led_gpio, c.btn_gpio}; }

// The MIRROR of the above: the GPIOs the X10A link occupies, for the LED/button pin pickers
// (/status.board.pins_local via board_pins_local). The reservation has to run in both directions or
// it protects only one of them — board_hw_valid() below rejects an indicator or button pin that
// equals rx/tx, so a picker that still offers those two is offering a pick the device will refuse.
// Two named factories rather than one, because which pair is reserved is the caller's statement of
// intent; board_pins.hpp's ReservedPins is deliberately anonymous about it (pin_a/pin_b).
inline ReservedPins config_link_pins(const Config& c) { return ReservedPins{c.rx_pin, c.tx_pin}; }

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

// ── What POST /set_board actually has to DO ─────────────────────────────────────────────────────
// TWO independent facts can move, and conflating them is what produced #257. The five HARDWARE
// values decide whether a REBOOT is needed (both are claimed once at task start — the WS2812 opens
// an RMT channel, the button installs a pull). Whether the user has STATED this hardware
// (board_user_set) decides only what the modal may call the board next time, and needs no reboot at
// all. Pure so the four combinations are asserted rather than re-derived at the route.
//
// The case that matters is `values same, not yet stated`: a XIAO owner picking "Seeed XIAO" on a
// device still carrying the Kconfig defaults changes no value, so the old route answered
// {"reboot":false} and saved NOTHING — the statement was dropped, the modal re-opened on "Custom",
// and the user re-picked their board forever. It is a SAVE (persist the statement) with NO reboot.
inline bool board_hw_same(const Config& a, const Config& b) {
    return a.led_gpio == b.led_gpio && a.led_type == b.led_type && a.led_inverted == b.led_inverted &&
           a.btn_gpio == b.btn_gpio && a.btn_active_low == b.btn_active_low;
}
// A reboot is owed to a HARDWARE change alone: recording the statement changes nothing a driver holds.
inline bool board_reboot_needed(const Config& want, const Config& cur) { return !board_hw_same(want, cur); }
// ...but a save is owed to either. `want.board_user_set` is true for every /set_board request (the
// submit IS the statement), so this reduces to "the values moved, or we had not recorded it yet".
inline bool board_save_needed(const Config& want, const Config& cur) {
    return !board_hw_same(want, cur) || (want.board_user_set && !cur.board_user_set);
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
    // like syslog_host — empty means mDNS auto-discovery, never invalid.
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

} // namespace daik
