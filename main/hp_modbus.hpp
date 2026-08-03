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
// It has no STEADY-STATE cost when absent: an empty saved address creates no task and performs no
// discovery. mDNS discovery runs only when the user presses Search in the HomeHub dialog.
//
// WP3 (#300) adds one deliberately narrow exception to the read stack: an internal, default-off
// actuator for the signed leaving-water offset at holding register 54. It remains the sole socket
// owner. There is no raw-register API and no HTTP/MQTT/MCP write route.
#include <cstddef>
#include <cstdint>
#include <string>
#include "hp_poll.hpp"      // CachedValue — the shared row shape, so /values needs no second type
#include "logic/modbus.hpp"
#include "logic/homehub_actuator.hpp"

namespace daik {

// Link + actuator diagnostics for /status.modbus and the MQTT heartbeat. `enabled` is runtime task
// existence and therefore requires a saved host. ActuatorSnapshot keeps requested, echoed,
// confirmed, effective and blocked facts separate; callers must not collapse them to one "set" bit.
struct ModbusStatus {
    bool        enabled     = false;   // task active (a configured address is being polled)
    bool        connected   = false;   // current socket has committed at least one fresh poll cycle
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
    logic::ActuatorSnapshot actuator;
    uint32_t    task_stack_min_free_words = 0;  // FreeRTOS high-water mark; 0 until task runs
};

// Start the stack. Creates the status mutex always (so /status can report `enabled:false` before any
// task exists) and the task only when the config enables it. Called once from app_main.
void mb_start();

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

// Internal domain API. Callers can request only an LWT offset; they cannot choose a Modbus address,
// function code or raw word. The one-slot mailbox is allocation-free and coalesces newer intents.
// The request still fails closed unless actuation is enabled, the link is live, writer ownership is
// explicitly Firmware, and the poll task obtains a fresh FC03 baseline immediately before FC06.
logic::ActuatorOffer mb_request_lwt_offset(const logic::LwtOffsetIntent& intent);

// Ownership is unresolved on every boot. The component that completes the evcc/direct-writer
// migration must explicitly grant Firmware ownership before any request can pass. This API changes
// policy state only; it performs no I/O.
void mb_set_actuation_writer_ownership(logic::ActuatorWriterOwnership ownership);

// Best-effort failsafe/orderly-stop restore request. The hp_modbus task performs it on its socket;
// callers never write directly. Power loss/crash cannot guarantee a network round-trip restore.
void mb_request_actuation_restore();

// Thread-safe snapshot copy of the HomeHub value cache. Returns the count written. Rows carry the
// same CachedValue shape as the X10A cache, so /values and the browser need no second row type;
// `reg` is the synthetic def::HOMEHUB_GROUP_REG and `off` the EKRHH offset, which is what
// logic/homehub_map.hpp pairs on.
//
// `live` reports whether the LINK was still up once the copy had been taken AND whether the cache
// was committed by that same TCP session. A caller that publishes these rows must honour it: false
// means the rows may predate a disconnect/reconnect and the snapshot must not be served. It is an
// out-param rather than a separate mb_status() call because that separate call is exactly the race
// — the cache and link state are behind two mutexes, so only the accessor can tie them into one
// generation-checked answer.
size_t mb_values_snapshot(CachedValue* out, size_t max, bool& live);

// The cache's upper bound (def::HOMEHUB_REG_COUNT) — callers size their snapshot buffer from this.
size_t mb_values_capacity();

}  // namespace daik
