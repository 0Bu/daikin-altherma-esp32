#pragma once
// Pure runtime-config model + validation. IDF-free so the web-UI payload validation and the
// pin/interval rules are host-tested (test/test_logic.cpp), then reused by config.cpp (which
// only adds the NVS load/save around it).
#include <cstdint>
#include <string>
#include "crc.hpp"

namespace daik {

struct Config {
    std::string wifi_ssid;
    std::string wifi_pass;
    std::string mqtt_uri;          // "" = MQTT disabled
    std::string mqtt_user;
    std::string mqtt_pass;
    std::string hostname = "daikin-altherma-esp32";
    std::string profile  = "auto";  // "auto" = detect on next poll cycle; else a concrete profile id
    std::string lang     = "en";
    Protocol    proto    = Protocol::I;  // initial guess before detection; then the detected variant
    int         rx_pin   = 44;
    int         tx_pin   = 43;
    int         poll_s   = 2;        // minimal by default — near-real-time; MQTT publishes only changes
    int         therm_pin = -1;     // -1 = disabled
    int         sg1_pin   = -1;
    int         sg2_pin   = -1;
    // Which values of the profile are enabled (opaque id set); serialized as a comma list.
    std::string val_mask;
    // Demo mode: fabricate plausible readings instead of polling the X10A UART (logic/demo.hpp).
    bool        demo      = false;

    // ── Auto-detection (protocol + model). Set by hp_detect.cpp; see logic/detect.hpp. ──
    // profile_auto: the profile was auto-derived and not yet pinned by the user. When true the web
    // UI shows the detected/ambiguous model set; a manual pick sets it false. proto and profile are
    // persisted results of detection; the fingerprint below lets /status recompute the candidate set
    // cheaply (no re-probe).
    bool        profile_auto = true;
    uint32_t    fp_pages     = 0;   // page mask that answered (logic/detect.hpp page_bit)
    int         fp_kw_tenths = -1;  // O/U capacity in 0.1 kW; -1 = unknown
    std::string fp_eeprom;          // rendered O/U EEPROM digits (display only)
    bool        fp_valid     = false;
};

// Highest GPIO across the supported targets (s3/c6 to 48, c5 to 28, classic esp32 to 39). The
// per-target UI narrows this further via /models pin_hint; this is the coarse guard.
inline bool gpio_in_range(int p) { return p >= 0 && p <= 48; }

// Validate a config coming from the web UI. Returns false + a reason on the first problem.
inline bool validate(const Config& c, std::string& reason) {
    if (!gpio_in_range(c.rx_pin)) { reason = "rx_pin out of range"; return false; }
    if (!gpio_in_range(c.tx_pin)) { reason = "tx_pin out of range"; return false; }
    if (c.rx_pin == c.tx_pin)     { reason = "rx_pin and tx_pin must differ"; return false; }
    if (c.poll_s < 1 || c.poll_s > 600) { reason = "poll interval must be 1..600 s"; return false; }
    if (c.proto != Protocol::I && c.proto != Protocol::S) { reason = "protocol must be I or S"; return false; }
    for (int p : {c.therm_pin, c.sg1_pin, c.sg2_pin})
        if (p != -1 && !gpio_in_range(p)) { reason = "control pin out of range"; return false; }
    // A control pin must not collide with the X10A UART pins.
    for (int p : {c.therm_pin, c.sg1_pin, c.sg2_pin})
        if (p != -1 && (p == c.rx_pin || p == c.tx_pin)) { reason = "control pin conflicts with RX/TX"; return false; }
    return true;
}

inline Protocol parse_protocol(const std::string& s) {
    return (!s.empty() && (s[0] == 'S' || s[0] == 's')) ? Protocol::S : Protocol::I;
}

} // namespace daik
