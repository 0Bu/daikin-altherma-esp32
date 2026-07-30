#pragma once
// THE HOMEHUB MODBUS STACK — a second, INDEPENDENT source of readings beside the X10A one
// (issue #32). Its own task, its own cache, its own link state; it shares nothing with hp_poll.cpp
// but the heat pump it describes.
//
// That independence is the whole design (docs/MODBUS_PROTOCOL.md). The two links fail for entirely
// unrelated reasons — X10A at the cable, the pin or the framing; Modbus at the LAN, mDNS or the hub —
// so coupling them would let either failure mask the other. Pulled service cable: the HomeHub keeps
// reporting. LAN down: X10A keeps polling. Neither notices the other.
//
// It also costs NOTHING when absent: the task is created only when a gateway address is known
// (config_modbus_host) or the one-shot search has yet to run, so a
// device with no HomeHub has no task, no socket, no mDNS traffic and no stack.
//
// READ-ONLY, and here that is a choice rather than a limitation of the wire: unlike X10A — which has
// no write command at all — Modbus would allow one. There is no write function in this header, no
// caller for one, and no HTTP or MQTT route that could reach it. Actuation is P3.
#include <cstddef>
#include <cstdint>
#include <string>
#include "hp_poll.hpp"      // CachedValue — the shared row shape, so /values needs no second type
#include "logic/modbus.hpp"

namespace daik {

// Link diagnostics for /status.modbus + the MQTT heartbeat. Read-only: no write counters, because
// there is no write path. `enabled` distinguishes "off" from "on but not connected" — the UI shows
// nothing at all for the first and a state for the second.
struct ModbusStatus {
    bool        enabled     = false;   // is this stack running at all? (a gateway address is known)
    bool        connected   = false;   // a socket is open AND the last read cycle succeeded
    bool        discovering = false;   // mDNS browse in progress, nothing resolved yet
    std::string host;                  // the RESOLVED / discovered host ("" = none yet)
    int         port    = 0;
    int         unit_id = 0;
    uint32_t    rx_ok   = 0;           // successful register reads since boot
    uint32_t    rx_fail = 0;           // failed reads since boot
    int         values  = 0;           // rows in the cache after the last cycle
    std::string last_error;
};

// Start the stack. Creates the status mutex always (so /status can report `enabled:false` before any
// task exists) and the task only when the config enables it. Called once from app_main.
void mb_start();

// Ask the stack to re-read its config — POST /set_hp. Starts the task if the HomeHub was just
// enabled, stops it if just disabled, and drops a cached socket when the address changed. Safe to
// call from the httpd task.
void mb_reconfigure();

// Thread-safe snapshot of the link state.
ModbusStatus mb_status();

// Thread-safe snapshot copy of the HomeHub value cache. Returns the count written. Rows carry the
// same CachedValue shape as the X10A cache, so /values and the browser need no second row type;
// `reg` is the synthetic def::HOMEHUB_GROUP_REG and `off` the EKRHH offset, which is what
// logic/homehub_map.hpp pairs on.
//
// `live` reports whether the LINK was still up once the copy had been taken, and a caller that
// publishes these rows must honour it: false means the rows may predate a disconnect and the
// snapshot must not be served. It is an out-param rather than a separate mb_status() call because
// that separate call is exactly the race — the cache and the link state are behind two mutexes, so
// only the accessor can tie them into one answer.
size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live);

// The cache's upper bound (def::HOMEHUB_REG_COUNT) — callers size their snapshot buffer from this.
size_t mb_values_capacity();

}  // namespace daik
