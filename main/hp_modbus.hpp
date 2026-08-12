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
// It has no STEADY-STATE cost when absent: a fresh device performs one bounded automatic discovery
// before HTTP starts, persists that decision, and an empty address thereafter creates no task or
// traffic. The user may still run a manual search from the HomeHub dialog.
//
// The stack is READ-ONLY, and that is now a property of the code rather than of a guard: the
// register-54 actuator built for #300 was REMOVED with the retirement of dynamic LWT actuation
// (#294 — SHADOW is the terminal state of that epic). No Modbus write function code is issued
// anywhere in this firmware, there is no intent API, and there is no HTTP/MQTT/MCP write route.
// The observation-only pieces kept from that work are the two PLANT GATES below: ordinary FC04
// reads that prove normal space operation and distinguish heating from cooling.
#include <cstddef>
#include <cstdint>
#include <string>
#include "hp_poll.hpp"      // CachedValue — the shared row shape, so /values needs no second type
#include "logic/modbus.hpp"

namespace daik {

// Link diagnostics for /status.modbus and the MQTT heartbeat. `enabled` is runtime task existence
// and therefore requires a saved host.
struct ModbusStatus {
    bool        enabled     = false;   // task active (a configured address is being polled)
    bool        connected   = false;   // current socket has committed a full cycle and is still live
    bool        discovering = false;   // compatibility field; explicit UI search is request-local
    std::string host;                  // configured address ("" = disabled)
    int         port    = 0;
    int         unit_id = 0;
    uint32_t    rx_ok   = 0;           // successful register reads since boot
    uint32_t    rx_fail = 0;           // failed reads since boot
    int         values  = 0;           // rows in the cache after the last cycle
    // The current failure, not a historical counter. `last_error_code` is stable/localisable for the
    // UI; `last_error` is the complete human-readable /diag + Syslog wording. detail carries errno,
    // a Modbus exception code or an MbParse ordinal, and register carries the 1-based EKRHH offset.
    std::string last_error_code;
    std::string last_error;
    int         last_error_detail   = -1;
    int         last_error_register = 0;
    // HomeHub input register 53 says SPACE HEATING OR COOLING is in normal operation. It cannot by
    // itself license a heating-curve sample. Input register 38 supplies the current mode; both must be
    // known and mode must be Heating before the diagnosis records a room-error sample.
    // `known` is false whenever the register did not answer this cycle or answered a sentinel — an
    // unknown gate must never read as "inactive", which would look like an ordinary quiet plant.
    bool        plant_gate_known  = false;
    bool        plant_gate_active = false;
    bool        heating_mode_known  = false;
    bool        heating_mode_active = false;
};

// Start the stack. Creates the status mutex always (so /status can report `enabled:false` before any
// task exists) and the task only when the config enables it. Called once from app_main.
void mb_start();

// Complete the fresh-device one-shot discovery before httpd/background config writers start. No-op
// after any persisted result or explicit host save/delete, in safe mode, or without a LAN lease.
void mb_autodiscover_initial();

// Ask the stack to re-read its config — POST /set_hp. Starts the task if the HomeHub was just
// enabled, stops it if just disabled, and drops a cached socket when the address changed. Safe to
// call from the httpd task.
void mb_reconfigure();

// Run the bounded mDNS search used by the HomeHub dialog's explicit Search button. This does not
// modify configuration or the running Modbus link: success returns a numeric IPv4 for the form,
// and only a later POST /set_hp save makes it persistent. Failure returns false after the bounded
// attempts, leaving an existing/manual entry untouched.
bool mb_discover_homehub(std::string& found);

// Thread-safe snapshot of the link state.
ModbusStatus mb_status();

// Thread-safe snapshot copy of the HomeHub value cache. Returns the count written. Rows carry the
// same CachedValue shape as the X10A cache, so /values and the browser need no second row type;
// `reg` is the synthetic def::HOMEHUB_GROUP_REG and `off` the EKRHH offset, which is what
// logic/homehub_map.hpp pairs on.
//
// `live` reports whether the LINK was still up once the copy had been taken AND whether the cache
// was committed by that same TCP session. Rows come from its latest full cycle, at most
// logic::MB_FULL_CYCLE_TICKS - 1 poll intervals old while the link remains live. A caller that
// publishes them must honour `live`: false means the rows may predate a disconnect/reconnect and the
// snapshot must not be served. It is an
// out-param rather than a separate mb_status() call because that separate call is exactly the race
// — the cache and link state are behind two mutexes, so only the accessor can tie them into one
// generation-checked answer.
size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live);

// The cache's upper bound (def::HOMEHUB_REG_COUNT) — callers size their snapshot buffer from this.
size_t mb_values_capacity();

}  // namespace daik
