#pragma once
// Pure runtime-config model + validation. IDF-free so the web-UI payload validation and the
// pin/interval rules are host-tested (test/test_logic.cpp), then reused by config.cpp (which
// only adds the NVS load/save around it).
#include <cstdint>
#include <string>
#include "crc.hpp"

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

    // ── Auto-detected MODEL (not the link). Set by hp_detect.cpp; see logic/detect.hpp. ──
    // SESSION-ONLY: applied to the in-RAM config via config_set_runtime and NEVER persisted — the
    // model is re-detected on every boot (config_load seeds profile="auto"), so a swapped unit is
    // re-identified. The fingerprint lets /status recompute the candidate set cheaply (no re-probe).
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

// Validate a config coming from the web UI. Returns false + a reason on the first problem. Pass the
// target's highest GPIO as `max_gpio` so pins are checked against the actual chip. The two range
// checks exist to name WHICH pin is wrong; link_pins_valid is the authority on the pair itself, so a
// rule added there is inherited here.
inline bool validate(const Config& c, std::string& reason, int max_gpio = 48) {
    if (!gpio_in_range(c.rx_pin, max_gpio)) { reason = "rx_pin out of range"; return false; }
    if (!gpio_in_range(c.tx_pin, max_gpio)) { reason = "tx_pin out of range"; return false; }
    if (!link_pins_valid(c.rx_pin, c.tx_pin, max_gpio)) { reason = "rx_pin and tx_pin must differ"; return false; }
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
