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
    uint8_t     off = 0; // byte offset within that page's reply. With `reg` and `unit` it is the
                         // row's IDENTITY — how logic/history.hpp addresses a trended row, since
                         // the catalog's labels neither name one quantity consistently nor name
                         // different quantities differently (see that header). Never displayed.
    bool        binary = false; // converter 300-307: value stays numeric 0/1 on every wire surface;
                                // /values exposes this metadata so the browser can localise it
                                // without guessing from a label or from the number itself.
};

// Health/status counters for /status.hp.
struct HpStats {
    bool     connected    = false;
    int32_t  last_ok_s    = -1;   // seconds since last fully-good cycle (-1 = never)
    int      registers    = 0;
    int      values       = 0;
    uint32_t crc_err      = 0;
    uint32_t timeout_err  = 0;
    // Cumulative since boot (never reset) — the heartbeat's bus_rx_received/bus_rx_fails
    // (logic/heartbeat.hpp). rx_ok+rx_fail_total = every register query ever attempted;
    // rx_fail_total = crc_err+timeout_err+other reply errors (e.g. the 0x15 0xEA bus-busy reply).
    uint32_t rx_ok         = 0;
    uint32_t rx_fail_total = 0;
    std::string last_error;
};

// Thread-safe snapshot copy of the current value cache. Returns count written.
size_t   hp_values_snapshot(CachedValue* out, size_t max);
HpStats  hp_stats();

// Signal the poll task to re-read config (called by /set_hp after config_save).
void hp_poll_reconfigure();

} // namespace daik
