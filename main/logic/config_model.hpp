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
    std::string hostname = "daikin-altherma";
    std::string profile  = "generic";
    std::string lang     = "en";
    Protocol    proto    = Protocol::I;
    int         rx_pin   = 44;
    int         tx_pin   = 43;
    int         poll_s   = 30;
    int         therm_pin = -1;     // -1 = disabled
    int         sg1_pin   = -1;
    int         sg2_pin   = -1;
    // Which values of the profile are enabled (opaque id set); serialized as a comma list.
    std::string val_mask;
};

// Highest GPIO across the supported targets (esp32c6/s3 go to 48; classic esp32 to 39). The
// per-target UI narrows this further via /models pin_hint; this is the coarse guard.
inline bool gpio_in_range(int p) { return p >= 0 && p <= 48; }

// Validate a config coming from the web UI. Returns false + a reason on the first problem.
inline bool validate(const Config& c, std::string& reason) {
    if (!gpio_in_range(c.rx_pin)) { reason = "rx_pin out of range"; return false; }
    if (!gpio_in_range(c.tx_pin)) { reason = "tx_pin out of range"; return false; }
    if (c.rx_pin == c.tx_pin)     { reason = "rx_pin and tx_pin must differ"; return false; }
    if (c.poll_s < 5 || c.poll_s > 600) { reason = "poll interval must be 5..600 s"; return false; }
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
