#pragma once
// The heat-pump poll engine. One task owns the X10A UART: each interval (POLL_INTERVAL_S) it builds
// the register set from the active profile, queries each register, decodes the values and writes
// them into a thread-safe cache the web UI (/values) and the MQTT bridge read. Config changes from
// /set_hp apply at the top of the next cycle (no reboot). See docs/ARCHITECTURE.md → The poll engine.
#include <cstddef>
#include <cstdint>
#include <string>

namespace daik {

void hp_poll_start();

// One cached reading.
struct CachedValue {
    std::string label;
    std::string value;   // formatted; empty = not available this cycle
    std::string unit;
    uint8_t     reg = 0; // X10A register page it came from (MQTT groups values by page)
};

// Health/status counters for /status.hp.
struct HpStats {
    bool     connected    = false;
    int32_t  last_ok_s    = -1;   // seconds since last fully-good cycle (-1 = never)
    int      registers    = 0;
    int      values       = 0;
    uint32_t crc_err      = 0;
    uint32_t timeout_err  = 0;
    std::string last_error;
};

// Thread-safe snapshot copy of the current value cache. Returns count written.
size_t   hp_values_snapshot(CachedValue* out, size_t max);
HpStats  hp_stats();

// Signal the poll task to re-read config (called by /set_hp after config_save).
void hp_poll_reconfigure();

} // namespace daik
