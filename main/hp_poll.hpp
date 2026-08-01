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
    bool        held = false;   // the source PAGE was not refreshed this cycle: the outdoor unit is
                                // resting and is answering with its last run's numbers
                                // (logic/ou_stale.hpp). The value is kept — the trend ring needs to
                                // tell "held over" from "no reading" — but it is not a measurement,
                                // so the MQTT bridge withholds it (#209 defect 5).
                                //
                                // ORDER MATTERS HERE, which is why the one-byte fields are grouped:
                                // `conv` is 4-byte aligned, so putting it between `off` and `held`
                                // pads twice and costs 4 bytes MORE per row than putting it last.
                                // Two snapshot buffers hold ~116 of these as one CONTIGUOUS block
                                // each (build_values_array on the httpd task, current_x10a_values on the
                                // publish task), and the binding limit on this board is the largest
                                // contiguous block — so a field-ordering slip is a real ~460 B of
                                // extra peak, not a style point.
    int         conv = 0;       // the row's converter id — the one piece of metadata every consumer
                                // needs, and the reason none of the DERIVED facts are cached beside
                                // it: `conv_is_binary(conv)` says whether /values should mark the
                                // row as a 1/0 flag for the browser, `published_kind(conv)` says
                                // what JSON type the MQTT bridge must give it, and conv 203 is what
                                // earns a derived numeric fault companion (logic/fault_state.hpp).
                                // Re-deriving any of those from the formatted TEXT instead is how a
                                // field ends up changing type between states (#209 defect 3), and
                                // caching each as its own flag would grow the struct once per
                                // question asked.
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
    // SOURCE freshness of the outdoor unit's own pages this cycle (logic/ou_stale.hpp) — the
    // heartbeat's bus_ou_held_over. Bus health and source freshness are different facts, and a
    // consumer that only has the first one reads a resting unit as a broken link.
    bool     ou_held_over  = false;
    std::string last_error;
};

// The max cache row count for the ACTIVE transport (X10A profile rows, or the HomeHub map on Modbus
// TCP) — /values and the MQTT bridge size their snapshot buffers from this so no row is truncated.
size_t   hp_values_capacity();

// Thread-safe snapshot copy of the current value cache. Returns count written.
size_t   hp_values_snapshot(CachedValue* out, size_t max);
HpStats  hp_stats();

// Signal the poll task to re-read config (called by /set_hp after config_save).
void hp_poll_reconfigure();

} // namespace daik
