#pragma once
// The heat-pump poll engine. One task owns the X10A UART: each interval (POLL_INTERVAL_S) it builds
// the register set from the active profile, queries each register, decodes the values and writes
// them into a thread-safe cache the web UI (/values) and the MQTT bridge read. Config changes from
// /set_hp apply at the top of the next cycle (no reboot). See docs/ARCHITECTURE.md → The poll engine.
#include <cstddef>
#include <cstdint>
#include <string>
#include "logic/crc.hpp"        // Protocol — the framing a probe reply was read with
#include "logic/hp_probe.hpp"   // ProbeStatus — the outcomes hp_probe_run() reports

namespace daik {

void hp_poll_start();

// One cached reading.
struct CachedValue {
    // Borrowed from generated catalog/override tables or string literals. These pointers remain
    // valid for the firmware lifetime; only the formatted value is owned by each snapshot row.
    const char* label = "";
    std::string value;   // formatted; empty = not available this cycle
    const char* unit = "";
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
                                // Two snapshot buffers hold one resolved profile as a CONTIGUOUS block
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
    int32_t  last_ok_s    = -1;   // seconds since last cycle with any valid reply (-1 = never)
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

// Copy the current cache into a caller-prepared, profile-stable layout. The caller supplies the
// row identities (label/reg/off/conv) and pre-reserves each value string. Missing rows are cleared
// in place; no destination is resized and no allocation occurs under the cache mutex. False means
// the profile changed underneath the caller or one formatted value exceeded its reserved slot.
bool     hp_values_snapshot_aligned(CachedValue* out, size_t count, const char* expected_profile,
                                    uint64_t expected_identity_fp);

// Allocation-free MQTT probe of the committed X10A cache. The first call counts and hashes the
// exact grouped JSON while holding the cache mutex. A changed payload is then allocated by the
// caller OUTSIDE the mutex; the copy call serializes only if the same cache revision is still
// committed. This avoids both an allocating copy under the mutex and the boot-long duplicate
// vectors/buffer that exhausted the real 129-row board in dev.12/dev.13.
struct HpX10aJsonProbe {
    bool     source_matches = false;
    size_t   bytes = 0;
    uint64_t digest = 0;
    uint32_t revision = 0;
};

enum class HpX10aJsonCopyResult {
    Ok,
    SourceMismatch,
    RevisionChanged,
    BufferTooSmall,
};

HpX10aJsonProbe hp_values_x10a_json_probe(const char* expected_profile,
                                          uint64_t expected_identity_fp);
HpX10aJsonCopyResult hp_values_x10a_json_copy(std::string& out, size_t expected_bytes,
                                              uint64_t expected_digest,
                                              uint32_t expected_revision,
                                              const char* expected_profile,
                                              uint64_t expected_identity_fp);
HpStats  hp_stats();

// Poll cycles the task guard DROPPED — a sweep that threw (std::bad_alloc under OTA/TLS heap
// pressure) and never reached the bus (#380). Deliberately NOT a field of HpStats: every counter in
// there describes a cycle that RAN, is committed by poll_once() under the stats mutex, and is read
// by callers asking "how is the bus doing?". These cycles never got that far — folding them in would
// have the sweep's own commit path report the cycles where no commit happened. Lock-free and
// allocation-free, because the increment happens inside the OOM catch handler.
uint32_t hp_skipped_cycles();

// Has the running X10A task observed either OTA or weather's lock-free network-heap quiesce request
// and left its allocation-rich cycle? True also when no poll task exists.
bool hp_poll_network_quiesced();

// OTA-facing compatibility name; the acknowledgement is shared with weather.
bool hp_poll_ota_quiesced();

// Identity token for one complete X10A cycle. A config change bumps it before arming the consumer
// resets; cache/history/checkup/dwell commits accept only the token captured before their bus read.
uint32_t hp_poll_generation();
bool     hp_poll_generation_matches(uint32_t generation);

// Signal the poll task to re-read config (called by /set_hp after config_save).
void hp_poll_reconfigure();

// ── Free register probe (logic/hp_probe.hpp, POST /hp/query) ─────────────────────────────────────
// One CRC-verified reply to one caller-chosen register, with the raw frame attached.
//
// This runs ON THE POLL TASK and not on the httpd task that asks for it, for the same reason
// everything else that touches the bus does: the link is half-duplex with exactly one master, and a
// second task writing a request while a sweep is mid-reply desynchronises the reader — the failure
// would not be a lost probe but corrupted PUBLISHED values, from a query no consumer of those
// values ever made. The submitter therefore hands over a register and blocks; the poll task serves
// at most one probe per cycle, between two sweeps, and hands back the bytes.
//
// The reply carries the FRAME, not a decoded value. Decoding is the caller's (logic/hp_probe.hpp),
// and keeping it out here is deliberate: the whole point of the feature is that the catalog's
// decode may be the thing under suspicion, so the transport must not pre-interpret what it read.
struct HpProbeReply {
    ProbeStatus status      = ProbeStatus::NoLink;
    Protocol    proto       = Protocol::I;   // the framing actually used (config's cached/detected one)
    int         rx_pin      = -1;
    int         tx_pin      = -1;
    uint8_t     frame[64]   = {};            // the complete reply INCLUDING header and checksum
    int         frame_len   = 0;
    int         payload_off = 0;             // where the value bytes start inside frame[]
    int         payload_len = 0;             // frame_len - payload_off - 1 (the checksum byte)
};

// Ask for `reg` and wait up to `timeout_ms` for the poll task to serve it. Returns false only for
// Busy/NoLink/Timeout — every bus-level outcome is reported through `out.status`, which is the
// distinction the caller has to relay (a refused page and a wedged scheduler are different findings).
// Allocation-free: it must stay callable from the httpd task under the same heap pressure that
// makes every other handler return 503.
bool hp_probe_run(uint8_t reg, HpProbeReply& out, int timeout_ms);

} // namespace daik
