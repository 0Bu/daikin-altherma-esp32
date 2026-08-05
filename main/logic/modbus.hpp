#pragma once
// Modbus TCP framing + HomeHub value codecs. Pure + IDF-free so test/test_logic.cpp can assert it
// on the host; the device wrapper (hp_modbus.cpp, a later phase) only adds the lwIP socket around
// these. This is the transport core for the firmware-EXCLUSIVE Modbus TCP link to a Daikin HomeHub
// (EKRHH) — INTENDED to read/write the registers the HomeHub exposes: all input registers (read-only
// by the Modbus spec itself) and the holding registers, including the Smart Grid / power-limit /
// setpoint ones (EKRHH guide §9.2.1 regs 56-58) — not just an internal decision-engine subset (see
// issue #32 / docs/SECURITY.md for how that surface is exposed).
//
// Compatibility is NOT unconditional (EKRHH guide 4P744838-1E): the Modbus register set requires
// Unified MMI2 firmware >= 7.8.0 on the audited ERGA-EV / EHBH / X-E family, and individual registers
// can be inoperative per model — e.g. holding registers 59 and 61 are not operational on Micon
// 20002203 (a read returns the 32766 "unavailable" sentinel, mb_is_special() below, and a write is
// rejected by the hub). Treat "every register" as the ceiling of the data model, gated by the hub's
// firmware version and per-model availability, not a guarantee every offset is live on a given unit.
//
// Wire facts (EKRHH Installer reference guide 4P744838-1E, §9): Modbus TCP on port 502 (no
// encryption). Modbus is big-endian on the wire. Frame = MBAP header [txn(2), proto=0(2), len(2),
// unit(1)] + PDU. Unlike Modbus RTU there is NO CRC — integrity is the MBAP length + TCP checksum.
// Data-model register offsets in the HomeHub tables are 1-based; the wire PDU address is 0-based
// (offset N -> PDU address N-1). Holding registers are read/write (FC03 read, FC06 write-single,
// FC16 write-multiple); input registers are read-only (FC04). Register value formats: Temp16 (signed
// /100 -> °C), Pow16 (signed /100 -> kW), Int16 (signed, as-is), Text16 (2 ASCII chars = hi/lo byte,
// e.g. 0x5538 -> "U8"). Special return values 32765/32766/32767 mean wait/unavailable/unsupported —
// never real data.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>

namespace daik {

// ── Constants ─────────────────────────────────────────────────────────────────────────────────
inline constexpr uint16_t MODBUS_TCP_PORT     = 502;   // plaintext port. The hub also offers Modbus-
                                                      // over-TLS on :802 (EKRHH guide); this client
                                                      // uses plaintext :502 by CHOICE — trusted-LAN
                                                      // only, the same posture as the rest of the API
inline constexpr uint8_t  MODBUS_DEFAULT_UNIT = 1;     // RTU slave / TCP unit id default (1..247)
inline constexpr int      MBAP_LEN            = 7;     // txn(2)+proto(2)+len(2)+unit(1)

// Per-request register maxima (Modbus application protocol §6.3/6.12). They exist because each PDU
// states its payload size in ONE byte: a read response carries a 1-byte count (2*qty <= 255 -> 125),
// and an FC16 request carries a 1-byte count plus addr/qty (-> 123). A larger qty cannot be framed.
inline constexpr uint16_t MB_MAX_READ_REGS  = 125;
inline constexpr uint16_t MB_MAX_WRITE_REGS = 123;

// Modbus function codes we speak (holding = R/W, input = read-only).
enum class MbFunc : uint8_t {
    ReadHolding   = 0x03,
    ReadInput     = 0x04,
    WriteSingle   = 0x06,
    WriteMultiple = 0x10,
};

// Special register values (§9.2.3): treat as "no value", never as data.
inline constexpr uint16_t MB_WAIT        = 32765;   // requested value not loaded yet (hub syncing)
inline constexpr uint16_t MB_UNAVAILABLE = 32766;   // register not available in this configuration
inline constexpr uint16_t MB_UNSUPPORTED = 32767;   // device does not support the register
inline bool mb_is_special(uint16_t raw) { return raw >= MB_WAIT && raw <= MB_UNSUPPORTED; }

// ── Big-endian 16-bit helpers (Modbus wire order) ───────────────────────────────────────────────
inline void mb_put_u16(uint8_t* p, uint16_t v) {
    p[0] = static_cast<uint8_t>(v >> 8);
    p[1] = static_cast<uint8_t>(v & 0xFF);
}
inline uint16_t mb_get_u16(const uint8_t* p) {
    return static_cast<uint16_t>((p[0] << 8) | p[1]);
}

// Data-model offset (1-based, as printed in the HomeHub tables) -> wire PDU address (0-based).
// Offset 0 is invalid (returns false).
inline bool mb_pdu_address(uint16_t data_model_offset, uint16_t& pdu_addr) {
    if (data_model_offset == 0) return false;
    pdu_addr = static_cast<uint16_t>(data_model_offset - 1);
    return true;
}

// ── Request builders (return the full ADU length, or -1 if the buffer is too small / args bad) ──

// FC03 read-holding / FC04 read-input request: MBAP(7) + PDU[fc, addr(2), qty(2)] = 12 bytes.
inline int mb_build_read(uint8_t* buf, size_t buflen, uint16_t txn, uint8_t unit, MbFunc fc,
                         uint16_t addr, uint16_t qty) {
    const size_t need = MBAP_LEN + 5;
    if (buf == nullptr || buflen < need) return -1;
    if (fc != MbFunc::ReadHolding && fc != MbFunc::ReadInput) return -1;
    if (qty == 0 || qty > MB_MAX_READ_REGS) return -1;
    mb_put_u16(buf + 0, txn);          // transaction id (echoed by the reply)
    mb_put_u16(buf + 2, 0);            // protocol id = 0
    mb_put_u16(buf + 4, 6);            // length = unit(1) + PDU(5)
    buf[6] = unit;
    buf[7] = static_cast<uint8_t>(fc);
    mb_put_u16(buf + 8, addr);
    mb_put_u16(buf + 10, qty);
    return static_cast<int>(need);
}

// THERE IS NO WRITE-REQUEST BUILDER. FC06/FC16 framing helpers existed here until the register-54
// actuation path was retired (#294): this firmware cannot construct a Modbus write frame at all, so
// "read-only" is a property of the code rather than of a guard around a dormant capability. The
// parser below still CLASSIFIES a write echo — inert, since no such reply can arrive — because that
// branch is part of the one shared response parser every read goes through.
// ── Response parsing ────────────────────────────────────────────────────────────────────────────
enum class MbParse {
    Ok,            // well-formed, request-bound, non-exception response (read data in `payload`, or a
                   // write echo that matched the request)
    Exception,     // valid Modbus exception response (see `exc_code`)
    TooShort,      // fewer bytes than a minimal MBAP + PDU
    BadProtocol,   // MBAP protocol id != 0
    BadLength,     // MBAP length field inconsistent with the buffer length
    TxnMismatch,   // transaction id does not echo the request
    UnitMismatch,  // unit id does not match the request
    FcMismatch,    // function code is neither the expected one nor its exception
    Malformed,     // byte count / PDU length inconsistent (incl. an exception PDU with trailing bytes)
    QtyMismatch,   // read reply carries a different register count than the quantity we requested
    EchoMismatch,  // write echo address/value/quantity does not match what we sent
};

// Stable, human-readable protocol reasons for diagnostics. The web UI localises the structured
// error code/detail from /status; these English strings are the equally important /diag + Syslog
// evidence, where a bare enum ordinal would make an intermittent wire failure impossible to triage.
inline const char* mb_parse_reason(MbParse p) {
    switch (p) {
        case MbParse::Ok:           return "valid response";
        case MbParse::Exception:    return "Modbus exception";
        case MbParse::TooShort:     return "response too short";
        case MbParse::BadProtocol:  return "invalid protocol id";
        case MbParse::BadLength:    return "invalid response length";
        case MbParse::TxnMismatch:  return "transaction id mismatch";
        case MbParse::UnitMismatch: return "unit id mismatch";
        case MbParse::FcMismatch:   return "function code mismatch";
        case MbParse::Malformed:    return "malformed response";
        case MbParse::QtyMismatch:  return "register count mismatch";
        case MbParse::EchoMismatch: return "write echo mismatch";
    }
    return "unknown response error";
}

// Modbus Application Protocol exception codes. Keep the numeric code beside this text in every log
// and /status payload: an implementation may return a future/vendor code this table does not know.
inline const char* mb_exception_reason(uint8_t code) {
    switch (code) {
        case 1:  return "illegal function";
        case 2:  return "illegal data address";
        case 3:  return "illegal data value";
        case 4:  return "server device failure";
        case 5:  return "acknowledge";
        case 6:  return "server device busy";
        case 8:  return "memory parity error";
        case 10: return "gateway path unavailable";
        case 11: return "gateway target failed to respond";
        default: return "unknown exception";
    }
}

struct MbResponse {
    bool           ok          = false;   // Ok: a read payload or a matched write echo is present
    bool           exception   = false;   // server returned a Modbus exception
    uint8_t        exc_code    = 0;       // exception code when `exception`
    uint16_t       txn         = 0;       // echoed transaction id
    uint8_t        unit        = 0;
    uint8_t        fc          = 0;       // function code (exception bit stripped)
    const uint8_t* payload     = nullptr; // read responses: first register byte (big-endian)
    int            payload_len = 0;       // read responses: byte count (2 * register count)
    uint16_t       echo_addr   = 0;       // write responses: the register address echoed by the server
    uint16_t       echo_value  = 0;       // write responses: FC06 the value written, FC16 the quantity
};

// Parse a full ADU and BIND it to the request that produced it. Validates the MBAP echo
// (proto/len/txn/unit) and the PDU shape for `expect_fc`, then cross-checks the response against the
// request — an unbound parser accepted a reply for a different address/value/quantity as long as the
// framing was valid, which is exactly what must not slip through before a write-capable link is wired:
//   • reads (FC03/FC04): `expect_qty_or_value` is the register quantity requested; the reply's
//     register count must equal it (QtyMismatch otherwise). A read reply does NOT echo the start
//     address — that binding is inherently unavailable on Modbus — so `expect_addr` is unused for
//     reads, and the transaction id is what ties a read reply to its request.
//   • writes (FC06/FC16): the echo carries [addr, value|qty]; both must equal `expect_addr` and
//     `expect_qty_or_value` (the value written for FC06, the register quantity for FC16), else
//     EchoMismatch. The echoed pair is also surfaced in out.echo_addr / out.echo_value so the caller
//     can confirm (or log) the committed write without re-parsing the wire.
inline MbParse mb_parse_response(const uint8_t* adu, int adu_len, uint16_t expect_txn,
                                 uint8_t expect_unit, MbFunc expect_fc,
                                 uint16_t expect_addr, uint16_t expect_qty_or_value, MbResponse& out) {
    out = MbResponse{};
    if (adu == nullptr || adu_len < MBAP_LEN + 1) return MbParse::TooShort;

    const uint16_t txn   = mb_get_u16(adu + 0);
    const uint16_t proto = mb_get_u16(adu + 2);
    const uint16_t len   = mb_get_u16(adu + 4);
    const uint8_t  unit  = adu[6];
    out.txn = txn;
    out.unit = unit;

    if (proto != 0) return MbParse::BadProtocol;
    // MBAP length counts the unit byte + everything after the length field.
    if (static_cast<int>(len) != adu_len - 6) return MbParse::BadLength;
    if (txn != expect_txn) return MbParse::TxnMismatch;
    if (unit != expect_unit) return MbParse::UnitMismatch;

    const uint8_t* pdu    = adu + MBAP_LEN;
    const int      pdu_len = adu_len - MBAP_LEN;
    const uint8_t  raw_fc  = pdu[0];

    // Exception: high bit of the function code is set, a 1-byte exception code follows. The PDU must
    // be EXACTLY [fc|0x80, exc_code] (2 bytes) — the old `< 2` check accepted an exception PDU with
    // trailing bytes. The MBAP length above already agrees with the buffer, so those extra bytes are a
    // genuine inconsistency, not framing slack.
    if (raw_fc & 0x80) {
        if (pdu_len != 2) return MbParse::Malformed;
        if ((raw_fc & 0x7F) != static_cast<uint8_t>(expect_fc)) return MbParse::FcMismatch;
        out.fc        = static_cast<uint8_t>(expect_fc);
        out.exception = true;
        out.exc_code  = pdu[1];
        return MbParse::Exception;
    }
    if (raw_fc != static_cast<uint8_t>(expect_fc)) return MbParse::FcMismatch;
    out.fc = raw_fc;

    if (expect_fc == MbFunc::ReadHolding || expect_fc == MbFunc::ReadInput) {
        // Read response: [fc, bytecount, data(bytecount)].
        if (pdu_len < 2) return MbParse::Malformed;
        const int bytecount = pdu[1];
        if (bytecount % 2 != 0) return MbParse::Malformed;
        if (pdu_len != 2 + bytecount) return MbParse::Malformed;
        out.payload     = pdu + 2;
        out.payload_len = bytecount;
        // Bind to the request: the server must return exactly the register count we asked for. A short
        // (or long) reply is a desync, not a partial success — refuse it rather than decode fewer/more
        // registers than the caller believes it requested.
        if (bytecount / 2 != static_cast<int>(expect_qty_or_value)) return MbParse::QtyMismatch;
    } else {
        // Write-single / write-multiple echo: [fc, addr(2), value|qty(2)] = 5 bytes.
        if (pdu_len != 5) return MbParse::Malformed;
        out.echo_addr  = mb_get_u16(pdu + 1);
        out.echo_value = mb_get_u16(pdu + 3);
        // Bind to the request: FC06 echoes the address + value written, FC16 the address + quantity.
        // A mismatch means the hub acted on a different register/value than we asked — never treat
        // that as a confirmed write.
        if (out.echo_addr != expect_addr || out.echo_value != expect_qty_or_value)
            return MbParse::EchoMismatch;
    }
    out.ok = true;
    return MbParse::Ok;
}

// Number of 16-bit registers in a read response payload.
inline int mb_reg_count(const MbResponse& r) { return r.payload_len / 2; }

// Bounds-checked extraction of the index-th register (big-endian) from a read response.
inline bool mb_reg_at(const MbResponse& r, int index, uint16_t& out_val) {
    if (!r.ok || r.payload == nullptr || index < 0 || index >= mb_reg_count(r)) return false;
    out_val = mb_get_u16(r.payload + index * 2);
    return true;
}

// ── Value codecs ────────────────────────────────────────────────────────────────────────────────
enum class MbType { Int16, Temp16, Pow16, Text16 };

struct MbValue {
    bool   ok      = false;   // a real value is present
    bool   special = false;   // one of the 32765/66/67 sentinels (no value)
    double value   = 0.0;     // physical value: °C (Temp16), kW (Pow16), or the integer (Int16)
    char   text[4] = {0};     // Text16: up to 2 ASCII chars + NUL
};

// Decode a raw register value per its HomeHub data type. The special-value guard applies first, so a
// sentinel never leaks in as a (large positive) reading.
inline MbValue mb_decode(MbType t, uint16_t raw) {
    MbValue v;
    if (mb_is_special(raw)) { v.special = true; return v; }
    switch (t) {
        case MbType::Int16:  v.value = static_cast<int16_t>(raw);         v.ok = true; break;
        case MbType::Temp16: v.value = static_cast<int16_t>(raw) / 100.0; v.ok = true; break;
        case MbType::Pow16:  v.value = static_cast<int16_t>(raw) / 100.0; v.ok = true; break;
        case MbType::Text16:
            v.text[0] = static_cast<char>((raw >> 8) & 0xFF);
            v.text[1] = static_cast<char>(raw & 0xFF);
            v.text[2] = '\0';
            v.ok = true;
            break;
    }
    return v;
}

// Encode a physical value into a raw register (for holding-register writes) — the inverse of
// mb_decode. Temp16/Pow16 scale ×100 then round to nearest; Int16 rounds as-is. Returns false and
// leaves `raw` untouched unless the value round-trips exactly, which rules out three ways a bad
// setpoint could otherwise reach the pump looking legitimate:
//   • out of int16 range — a plain cast would wrap (400.00 °C -> -255.36 °C, sign flipped);
//   • lands on a 32765/66/67 sentinel — mb_decode would read our own write back as "no value";
//   • not finite — std::lround(NaN/inf) has no defined result.
// Text16 is rejected here (it is two packed chars, not a number): use mb_encode_text16.
inline bool mb_encode(MbType t, double physical, uint16_t& raw) {
    if (t == MbType::Text16) return false;
    if (!std::isfinite(physical)) return false;
    const double scaled = (t == MbType::Temp16 || t == MbType::Pow16) ? physical * 100.0 : physical;
    if (scaled < -32768.5 || scaled > 32767.5) return false;   // pre-round guard: lround can't overflow
    const long r = std::lround(scaled);
    if (r < -32768 || r > 32767) return false;                 // .5 cases rounding onto the boundary
    const uint16_t enc = static_cast<uint16_t>(static_cast<int16_t>(r));
    if (mb_is_special(enc)) return false;
    raw = enc;
    return true;
}

// Encode a 2-character Text16 register from its high/low ASCII bytes.
inline uint16_t mb_encode_text16(char hi, char lo) {
    return static_cast<uint16_t>((static_cast<uint8_t>(hi) << 8) | static_cast<uint8_t>(lo));
}

// ── mDNS HomeHub filter ─────────────────────────────────────────────────────────────────────────
inline char mb_ascii_lower(char c) {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c - 'A' + 'a') : c;
}

// An mDNS `_http._tcp` browse returns many responders — including THIS firmware's own advert
// (hostname "daikin-altherma-esp32") and unrelated HTTP devices. The HomeHub's hostname is
// "homehub-524288-<serial>" (EKRHH guide §13.1.2), so match that prefix case-insensitively to keep
// only real HomeHubs. NUL-terminated input; a shorter string simply fails the prefix.
inline bool is_homehub_hostname(const char* host) {
    if (host == nullptr) return false;
    static const char pfx[] = "homehub-";
    for (int i = 0; pfx[i] != '\0'; i++) {
        if (mb_ascii_lower(host[i]) != pfx[i]) return false;
    }
    return true;
}

// Index of the first HomeHub in a list of mDNS host/instance names, or -1 if none match.
inline int mb_first_homehub(const char* const* names, int n) {
    for (int i = 0; i < n; i++)
        if (names[i] != nullptr && is_homehub_hostname(names[i])) return i;
    return -1;
}

// Render the IPv4 address carried by the selected mDNS result. Kept IDF-free so discovery's status
// contract is host-tested: expose the selected A record, not the serial-derived mDNS name. The four
// arguments deliberately match ESP-IDF's
// IP2STR(&addr) expansion at the device call site.
inline std::string mb_ipv4_string(unsigned a, unsigned b, unsigned c, unsigned d) {
    if (a > 255 || b > 255 || c > 255 || d > 255) return {};
    char text[16];
    const int n = std::snprintf(text, sizeof(text), "%u.%u.%u.%u", a, b, c, d);
    return n > 0 && n < static_cast<int>(sizeof(text)) ? std::string(text) : std::string();
}

} // namespace daik
