#pragma once
// X10A frame handling. Pure + IDF-free so
// test/test_logic.cpp can assert it against real captured frames on the host. The device
// wrapper (hp_comm.cpp) only adds the UART read/write around these.
#include <cstdint>

namespace daik {

enum class Protocol : char { I = 'I', S = 'S' };

// Checksum: 8-bit sum of bytes, then bitwise-NOT.
inline uint8_t crc(const uint8_t* src, int len) {
    uint8_t b = 0;
    for (int i = 0; i < len; i++) b = static_cast<uint8_t>(b + src[i]);
    return static_cast<uint8_t>(~b);
}

// Build the request frame for a register query into buf[0..3]. Returns the frame length.
//   Protocol I: {0x03, 0x40, reg, crc}   (len 4)
//   Protocol S: {0x02, reg, crc}         (len 3)
inline int build_request(uint8_t reg, Protocol proto, uint8_t buf[4]) {
    if (proto == Protocol::S) {
        buf[0] = 0x02; buf[1] = reg; buf[2] = crc(buf, 2); return 3;
    }
    buf[0] = 0x03; buf[1] = 0x40; buf[2] = reg; buf[3] = crc(buf, 3); return 4;
}

// Expected reply length. Protocol I starts at 12 and is overridden once byte[2] is read
// (actual = buf[2] + 2, see reply_len_dynamic). Protocol S is fixed per register.
inline int reply_len(uint8_t reg, Protocol proto) {
    if (proto == Protocol::I) return 12;
    switch (reg) {
        case 0x50: return 6;
        // NOTE: There is an unverified discrepancy in S-protocol register 0x56.
        // Some protocol documentation suggests the size is 6 bytes, but our implementation
        // currently uses 4 bytes. This remains to be verified against real hardware.
        case 0x56: return 4;
        default:   return 18;
    }
}

// Protocol-I dynamic override applied after 3 bytes are read.
inline int reply_len_dynamic(const uint8_t* buf) { return buf[2] + 2; }

// Can a reply of this length be READ INTO a buffer of this size? Applied to BOTH lengths a query
// can expect — reply_len()'s static one before the request goes out, and reply_len_dynamic()'s
// protocol-I override once byte 2 arrives — so the bound is one rule with one definition rather
// than a per-call-site comparison. (It was named is_valid_dynamic_len while the static length went
// unchecked; the name would now be a lie, and hp_comm.cpp's read loop counts every byte it
// receives whether or not it stored it, so an unchecked length is an out-of-bounds READ in
// crc_ok(buf, len) that the loop's own per-byte write guard cannot prevent.)
// `<=` and not `<`: a reply of exactly buflen bytes occupies indices 0..buflen-1 and fits.
inline bool reply_len_fits(int reply_len, size_t buflen) {
    return reply_len >= 0 && static_cast<size_t>(reply_len) <= buflen;
}

inline bool reply_len_valid(Protocol proto, int reply_len, size_t buflen) {
    // A normal I reply needs opcode, page, LEN and checksum even with an empty payload. The 2-byte
    // NAK is recognized separately before dynamic length parsing.
    const int minimum = proto == Protocol::I ? 4 : 2;
    return reply_len >= minimum && reply_len_fits(reply_len, buflen);
}

// HP "did not understand the request" reply (both protocols).
inline bool is_error_reply(const uint8_t* buf, int len) {
    return len >= 2 && buf[0] == 0x15 && buf[1] == 0xea;
}

// Verify the trailing-byte checksum over the first len-1 bytes.
inline bool crc_ok(const uint8_t* buf, int len) {
    return len >= 1 && crc(buf, len - 1) == buf[len - 1];
}

// A CRC-valid Protocol-I reply still belongs to a particular request: bytes 0/1 must echo the
// read opcode and requested page. Protocol S has no documented equivalent echo, so only I applies
// this identity check. Kept pure so wrong-page and partial-frame cases are host tested.
enum class HpReplyKind : uint8_t {
    Ok,
    NoReply,
    Rejected,
    ShortReply,
    BadCrc,
    UnexpectedReply,
    InvalidLength,
};

inline HpReplyKind hp_reply_classify(uint8_t reg, Protocol proto, const uint8_t* buf,
                                     int received, int expected) {
    if (!buf || received <= 0) return HpReplyKind::NoReply;
    if (received >= 2 && is_error_reply(buf, received)) return HpReplyKind::Rejected;
    if (expected < 0 || received < expected) return HpReplyKind::ShortReply;
    if (!crc_ok(buf, received)) return HpReplyKind::BadCrc;
    if (proto == Protocol::I && (buf[0] != 0x40 || buf[1] != reg))
        return HpReplyKind::UnexpectedReply;
    return HpReplyKind::Ok;
}

// Where the value payload starts inside a full reply (past the header): protocol S = 1,
// protocol I = 3.
inline int payload_offset(Protocol proto) { return proto == Protocol::S ? 1 : 3; }

} // namespace daik
