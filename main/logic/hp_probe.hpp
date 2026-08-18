#pragma once
// FREE REGISTER PROBE — ask the bus a question the value catalog has not already answered.
//
// Every other decode path in this firmware starts from a generated ValueDef: the catalog asserts
// "page 0x60, offset 11, conv 105, 1 byte is the flow-line temperature", and the poll engine reads
// exactly the rows the detected profile names. That is the right shape for producing telemetry and
// the wrong shape for producing EVIDENCE, because it can only ever confirm what the catalog already
// claims. Three questions the shipped surface cannot answer, all of them live:
//
//   • "What does an unmapped model put on this page?" — 44 profiles exist, the fleet has more. A
//     user whose unit detects as `generic` has no way to find out what its pages carry, so no way
//     to contribute a profile. Today that requires editing def/*.hpp, building and flashing.
//   • "Is this row's CONVERTER right?" — logic/conv_override.hpp exists precisely because the
//     generator's id is demonstrably wrong on some rows, and #194's Target Evap. Temp. (page 0x10
//     offset 6, decoding to an impossible 199.6 °C under load) is still open. Deciding a scale
//     needs the same bytes read through several converters at once, which no shipped path does.
//   • "Are these bytes even where the catalog thinks they are?" — an offset/layout mismatch and a
//     dead sensor look identical once a value is formatted (logic/hexdump.hpp's opening argument).
//
// logic/hexdump.hpp and logic/raw_capture.hpp put raw page bytes on /diag and get closest, but both
// are OBSERVATIONS on the firmware's own schedule: they dump the pages the active profile already
// polls, at moments the firmware picks. This header is the missing half — a QUESTION, asked on
// demand, about a page nobody mapped, with the answer's raw bytes attached.
//
// WHAT THIS DELIBERATELY IS NOT: a write path. X10A has no write command in either framing
// (docs/X10A_PROTOCOL.md §3) — build_request() can only ever emit a read — so an arbitrary register
// byte is an arbitrary READ and nothing else. An unknown page answers 0x15 0xEA or stays silent.
// Nothing here can change a setting on the unit, and that property comes from the protocol, not
// from restraint in this file.
//
// Pure and IDF-free so the request bounds, the reply-status mapping and — the part that actually
// carries risk — the CONVERTER SWEEP are asserted on the host. The sweep runs every candidate
// converter over caller-supplied bytes, which is a much wider input domain than the poll path ever
// reaches: the catalog only ever pairs a converter with the offsets its own model uses, while this
// pairs every converter with whatever byte the user pointed at. Table-bounds behaviour under
// arbitrary bytes is therefore a host test here, not a discovery on someone's board.
#include <cstdint>
#include "convert.hpp"
#include "value_def.hpp"

namespace daik {

// A reply payload never exceeds this on either framing: protocol I's dynamic length is buf[2]+2
// against a 64-byte read buffer, protocol S is fixed at 18. 32 is the same ceiling
// logic/hexdump.hpp's callers copy into, kept identical so a probe and a raw dump of the same page
// can be compared byte for byte.
inline constexpr int PROBE_MAX_PAYLOAD = 32;

// ── The REQUEST, and why it is validated before the bus is touched ────────────────────────────
// A malformed probe must never reach hp_query(): the bus is a shared, half-duplex, 1 Hz-scheduled
// resource that the poll engine owns, and spending a round-trip on a request whose answer we
// already know we cannot use is the same mistake hp_query's own reply_len_fits() pre-check retired.
// Everything decidable without the reply is decided here.
struct ProbeRequest {
    int reg    = -1;   // 0x00-0xFF — the page to ask for
    int offset = -1;   // byte offset INSIDE the reply payload (payload_offset() already removed)
    int size   = 0;    // field width, 1 or 2 bytes (every implemented converter reads one or two)
    int conv   = -1;   // converter id, or PROBE_SWEEP to decode through every candidate at once
};

// `conv` sentinel: decode through the whole candidate table instead of one named converter. This is
// the mode that answers "which scale is this", so it is the DEFAULT the HTTP layer applies when the
// caller names no converter — asking a user to guess a converter id before they can see any value
// is exactly the loop this feature exists to break.
inline constexpr int PROBE_SWEEP = -1;

enum class ProbeReject : uint8_t { None, Register, Offset, Size, Converter };

inline const char* probe_reject_name(ProbeReject r) {
    switch (r) {
        case ProbeReject::None:      return "";
        case ProbeReject::Register:  return "reg must be 0..255";
        case ProbeReject::Offset:    return "offset must be 0..31";
        case ProbeReject::Size:      return "size must be 1 or 2";
        case ProbeReject::Converter: return "conv must be 0..999 or omitted";
    }
    return "invalid request";
}

// Bounds only — NOT "does this page exist" or "is this converter implemented". Both of those are
// answers the probe exists to produce: rejecting an unknown page here would make the tool unable to
// explore, and rejecting an unimplemented converter would hide the one fact ("nothing decodes these
// bytes") that tells a contributor a new converter is needed. The reply reports both as outcomes.
inline ProbeReject probe_validate(const ProbeRequest& q) {
    if (q.reg < 0 || q.reg > 0xFF)                    return ProbeReject::Register;
    if (q.offset < 0 || q.offset >= PROBE_MAX_PAYLOAD) return ProbeReject::Offset;
    if (q.size != 1 && q.size != 2)                    return ProbeReject::Size;
    if (q.conv != PROBE_SWEEP && (q.conv < 0 || q.conv > 999)) return ProbeReject::Converter;
    return ProbeReject::None;
}

// ── The OUTCOME of an executed probe ──────────────────────────────────────────────────────────
// Distinct statuses rather than one bool, because the four failure modes mean opposite things to
// whoever is holding the multimeter: NoReply is usually wiring or a page this unit does not have,
// Rejected is the unit explicitly refusing a page it parsed, BadCrc is a link that is passing bytes
// but corrupting them (a level-shifter symptom, docs/README.md → Voltage and wiring), and Timeout
// is our own scheduler never getting to it. Collapsing them would send everyone to the same wrong
// fix first.
enum class ProbeStatus : uint8_t {
    Ok,          // a CRC-verified reply with a usable payload
    Busy,        // another probe is already in flight — one bus, one question at a time
    NoLink,      // no poll task / UART could not be brought up on the configured pins
    Timeout,     // the poll task did not serve the request in time (OTA hold-off, a long sweep)
    NoReply,     // nothing came back within the serial timeout
    Rejected,    // the unit answered 0x15 0xEA — request understood, page refused
    BadCrc,      // bytes arrived, checksum failed
    ShortReply,  // framing intact but the payload is too small to hold the requested slice
    OutOfBounds, // the reply is real and the requested (offset,size) lies past its payload
};

inline const char* probe_status_name(ProbeStatus s) {
    switch (s) {
        case ProbeStatus::Ok:          return "ok";
        case ProbeStatus::Busy:        return "busy";
        case ProbeStatus::NoLink:      return "no_link";
        case ProbeStatus::Timeout:     return "timeout";
        case ProbeStatus::NoReply:     return "no_reply";
        case ProbeStatus::Rejected:    return "rejected";
        case ProbeStatus::BadCrc:      return "bad_crc";
        case ProbeStatus::ShortReply:  return "short_reply";
        case ProbeStatus::OutOfBounds: return "out_of_bounds";
    }
    return "error";
}

// hp_query()'s negative returns, named. The mapping lives here rather than at the call site so the
// transport's codes have exactly one interpretation: hp_comm.cpp returns -2 for the 0x15 0xEA
// refusal and -3 for a checksum failure, and everything else it can fail on (no reply, short reply,
// an impossible dynamic length) comes back as -1 with the distinguishing detail already in the diag
// ring. -1 is therefore reported as NoReply, which is what it is in every case a user can act on.
inline ProbeStatus probe_status_from_query(int n) {
    if (n > 0)  return ProbeStatus::Ok;
    if (n == -2) return ProbeStatus::Rejected;
    if (n == -3) return ProbeStatus::BadCrc;
    return ProbeStatus::NoReply;
}

// Does the requested slice lie inside the payload we actually got back? Separate from
// probe_validate() because it needs the reply: `offset` is bounded against the protocol maximum
// before the query and against THIS page's real length after it, and the two answers differ exactly
// when a page is shorter than the caller assumed — which is itself a finding worth reporting.
inline bool probe_slice_fits(int offset, int size, int payload_len) {
    return offset >= 0 && size > 0 && payload_len > 0 && offset + size <= payload_len;
}

// ── The CANDIDATE TABLE ───────────────────────────────────────────────────────────────────────
// Which converters a sweep tries, per field width. Not "all implemented ids": the enum converters
// are the point (an unknown byte reading "Heating" is a strong signal), but the unimplemented
// stubs are not — convert() returns unimpl for them, so including them would add empty rows to
// every answer.
//
// ORDER IS THE DEDUP POLICY. Several converters are numerically identical on most inputs — 105,
// 107, 114 and 119 are all signed-LE ×0.1 and differ only in whether 0x8000 is treated as "no
// data"; 211, 214, 215 and 219 are all just data[0]. A sweep that printed each separately would
// answer a question about scale with twelve rows saying the same number, so identical decodes are
// merged and the FIRST id in this table is the one the merged row is named after. The order
// therefore puts the most explanatory representative first: the temperature reading before the raw
// count, the raw byte before the masked counters.
struct ProbeCandidate {
    int     conv;
    uint8_t size;   // the field width this candidate is offered for
};

inline constexpr ProbeCandidate PROBE_CANDIDATES[] = {
    // 2-byte fields: scale/sign/endianness — the family the "which converter" question is about.
    {105, 2}, {106, 2},                       // signed ×0.1 LE / BE — the temperature pair
    {107, 2}, {108, 2}, {114, 2}, {119, 2},   // same maths, 0x8000 = no data (alias unless sentinel)
    {101, 2}, {102, 2},                       // signed raw
    {103, 2}, {104, 2},                       // signed /256
    {109, 2}, {110, 2},                       // signed /256 ×2
    {111, 2},                                 // signed ×0.5
    {118, 2},                                 // signed BE ×0.01
    {151, 2}, {152, 2},                       // unsigned raw
    {161, 2},                                 // unsigned ×0.5 — CT current
    {405, 2},                                 // pressure -> saturation temperature
    // 1-byte fields: the raw byte, then the readings that mask or index it.
    {211, 1}, {219, 1}, {214, 1}, {215, 1},   // data[0] verbatim (aliases of each other)
    {310, 1}, {311, 1},                       // 3-bit windows, bits 4-6 and 0-2
    {217, 1}, {203, 1}, {204, 1}, {315, 1}, {316, 1},   // enum / error-code labels
    {300, 1}, {301, 1}, {302, 1}, {303, 1},
    {304, 1}, {305, 1}, {306, 1}, {307, 1},   // bit flags, bit 0..7
};

inline constexpr int PROBE_CANDIDATE_COUNT =
    static_cast<int>(sizeof(PROBE_CANDIDATES) / sizeof(PROBE_CANDIDATES[0]));

// How many candidates one field width offers. Every candidate ends up in exactly one row — either
// naming it or merged into it as an alias — so this one number bounds BOTH the row count (nothing
// merged) and any single row's alias list (everything merged into one).
inline constexpr int probe_candidate_count_for(uint8_t size) {
    int n = 0;
    for (int i = 0; i < PROBE_CANDIDATE_COUNT; i++)
        if (PROBE_CANDIDATES[i].size == size) n++;
    return n;
}

// DERIVED, not chosen: the widest field's candidate count. Deriving it is what makes truncation
// structurally impossible rather than merely unlikely — a hand-picked ceiling that fell one short
// would drop a row, and a dropped row is indistinguishable from a converter that had nothing to
// say, which is the single confusion this feature must not introduce. Adding a candidate above
// resizes the answer automatically.
inline constexpr int PROBE_MAX_DECODES =
    probe_candidate_count_for(1) > probe_candidate_count_for(2) ? probe_candidate_count_for(1)
                                                                : probe_candidate_count_for(2);
inline constexpr int PROBE_MAX_ALIASES = PROBE_MAX_DECODES - 1;

// The sweep's whole output is ONE stack array in the HTTP handler, on the task with the deepest
// call chain in the firmware (16 KB, and http_append_status_json already spends ~10.5 KB of it —
// see http_server.cpp). So the per-row cost is deliberate: `uint16_t` aliases and a bound derived
// from the table rather than rounded up. MEASURED at today's table: 19 rows x 80 bytes = 1520 bytes,
// against ~4.6 KB for the obvious `int alias[PROBE_CANDIDATE_COUNT]` in a hand-picked 24-row array.
// This is not premature: a stack budget is exactly what killed the httpd task twice (v1.0.12, #318).
static_assert(PROBE_MAX_DECODES <= 32,
              "a sweep's output is one httpd-stack array — keep the candidate table small enough "
              "that it stays under about 2 KB");

// One decoded answer. `alias` names the other converters that produced a byte-identical decode, so
// a merged row still says exactly which ids it stands for — a contributor writing a catalog entry
// needs the id, and "105" and "119" are not interchangeable in a def/*.hpp row even when they agree
// on today's bytes.
struct ProbeDecode {
    int    conv        = 0;
    bool   ok          = false;   // convert() produced a numeric value
    bool   is_text     = false;   // convert() produced a label instead
    double value       = 0.0;
    char   text[24]    = {0};
    uint16_t alias[PROBE_MAX_ALIASES] = {0};   // uint16_t: converter ids are <= 999, and this array
                                              // is what the row's stack cost is made of (see above)
    int    alias_count = 0;
};

// Two decodes are the SAME answer when every observable field agrees. Deliberately an exact
// double comparison and not an epsilon: both sides come from the same converter code over the same
// bytes, so equal inputs give bit-identical results, and an epsilon would merge two scales that
// genuinely differ by a hair (103 vs 109 on a small value) into one row and hide the choice the
// user is here to make.
inline bool probe_decode_same(const ProbeDecode& a, const Reading& r) {
    if (a.ok != r.ok || a.is_text != (r.text[0] != '\0')) return false;
    if (a.is_text) {
        for (int i = 0; i < static_cast<int>(sizeof(a.text)); i++) {
            if (a.text[i] != r.text[i]) return false;
            if (a.text[i] == '\0') return true;
        }
        return true;
    }
    return a.value == r.value;
}

// Decode `payload[offset .. offset+size)` through every candidate of this width, merging identical
// answers. Returns the number of distinct rows written to `out` (at most `max`).
//
// `rtype` is the refrigerant curve conv 405 needs. The caller passes the ACTIVE profile's value
// where one is resolved; the R32 default matches convert()'s and covers every unit that has not
// been identified yet — which, on the `generic` profile this tool is most useful on, is all of them.
inline int probe_sweep(const uint8_t* payload, int payload_len, int offset, int size,
                       ProbeDecode* out, int max, int rtype = 802) {
    if (!payload || !out || max <= 0) return 0;
    if (!probe_slice_fits(offset, size, payload_len)) return 0;

    int n = 0;
    for (int i = 0; i < PROBE_CANDIDATE_COUNT; i++) {
        if (PROBE_CANDIDATES[i].size != size) continue;
        const ValueDef def{static_cast<uint8_t>(0), static_cast<uint8_t>(offset),
                           PROBE_CANDIDATES[i].conv, static_cast<uint8_t>(size), -1, ""};
        const Reading r = convert(def, payload + offset, rtype);
        // An unimplemented id contributes nothing: it is not an answer, and printing it as one
        // would put an empty row beside a real decode with no way to tell them apart.
        if (r.unimpl) continue;
        // A converter that RAN but refused the value (405 on a non-positive pressure, 107 on the
        // 0x8000 sentinel) is deliberately kept, as its own "refused" answer: "conv 107 reads this
        // as the no-data marker" is precisely the evidence that separates a sentinel from a real
        // -3276.8 °C reading, and getting that distinction right is the difference between a
        // correct and an incorrect catalog row. Such rows merge with each other like any other
        // identical decode.
        bool merged = false;
        for (int k = 0; k < n; k++) {
            if (!probe_decode_same(out[k], r)) continue;
            // The bound cannot be reached — every candidate lands in exactly one row, so a row can
            // absorb at most the width's candidate count minus itself — but a table edit that broke
            // that invariant must overwrite nothing.
            if (out[k].alias_count < PROBE_MAX_ALIASES)
                out[k].alias[out[k].alias_count++] = static_cast<uint16_t>(PROBE_CANDIDATES[i].conv);
            merged = true;
            break;
        }
        if (merged) continue;
        if (n >= max) break;   // bounded output; the table is ordered so the informative rows land first

        ProbeDecode d;
        d.conv    = PROBE_CANDIDATES[i].conv;
        d.ok      = r.ok;
        d.is_text = r.text[0] != '\0';
        d.value   = r.value;
        for (int c = 0; c < static_cast<int>(sizeof(d.text)); c++) d.text[c] = r.text[c];
        d.text[sizeof(d.text) - 1] = '\0';
        out[n++] = d;
    }
    return n;
}

// Decode through ONE named converter. Same shape as a sweep row so the HTTP layer renders one
// list either way — a caller who named a converter gets a one-element answer, not a different
// response schema. `unimpl` is reported rather than hidden: "this id decodes nothing" is a real
// answer to "what is conv 462".
inline bool probe_decode_one(const uint8_t* payload, int payload_len, int offset, int size,
                             int conv, ProbeDecode& out, bool& unimpl, int rtype = 802) {
    unimpl = false;
    if (!payload || !probe_slice_fits(offset, size, payload_len)) return false;
    const ValueDef def{static_cast<uint8_t>(0), static_cast<uint8_t>(offset), conv,
                       static_cast<uint8_t>(size), -1, ""};
    const Reading r = convert(def, payload + offset, rtype);
    if (r.unimpl) { unimpl = true; return false; }
    out         = ProbeDecode{};
    out.conv    = conv;
    out.ok      = r.ok;
    out.is_text = r.text[0] != '\0';
    out.value   = r.value;
    for (int c = 0; c < static_cast<int>(sizeof(out.text)); c++) out.text[c] = r.text[c];
    out.text[sizeof(out.text) - 1] = '\0';
    return true;
}

}  // namespace daik
