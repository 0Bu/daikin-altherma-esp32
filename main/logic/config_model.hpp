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
    std::string profile  = "auto";  // "auto" = detect on next poll cycle; else a concrete profile id
    std::string wifi_ssid_backup;
    std::string wifi_pass_backup;
    bool        wifi_rollback_active = false;
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

// Coarse GPIO upper-bound guard. `max_gpio` is the target's highest GPIO number; the device caller
// passes its real per-target value (SOC_GPIO_PIN_COUNT-1), so a pin above the running chip's range
// is rejected — e.g. the ESP32-S3 default 44 on an ESP32-C3 (max GPIO 21). The default 48 (S3 max)
// is only the host-test fallback. This is a range guard, not a full per-pad reachability map.
inline bool gpio_in_range(int p, int max_gpio = 48) { return p >= 0 && p <= max_gpio; }

// Validate a config coming from the web UI. Returns false + a reason on the first problem. Pass the
// target's highest GPIO as `max_gpio` so pins are checked against the actual chip.
inline bool validate(const Config& c, std::string& reason, int max_gpio = 48) {
    if (!gpio_in_range(c.rx_pin, max_gpio)) { reason = "rx_pin out of range"; return false; }
    if (!gpio_in_range(c.tx_pin, max_gpio)) { reason = "tx_pin out of range"; return false; }
    if (c.rx_pin == c.tx_pin)     { reason = "rx_pin and tx_pin must differ"; return false; }
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
