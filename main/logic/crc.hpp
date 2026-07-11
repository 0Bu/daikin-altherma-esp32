#pragma once
// X10A frame handling — ported verbatim from ESPAltherma include/comm.h. Pure + IDF-free so
// test/test_logic.cpp can assert it against real captured frames on the host. The device
// wrapper (hp_comm.cpp) only adds the UART read/write around these.
#include <cstdint>

namespace daik {

enum class Protocol : char { I = 'I', S = 'S' };

// Checksum: 8-bit sum of bytes, then bitwise-NOT. (ESPAltherma getCRC)
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
        case 0x56: return 4;
        default:   return 18;
    }
}

// Protocol-I dynamic override applied after 3 bytes are read.
inline int reply_len_dynamic(const uint8_t* buf) { return buf[2] + 2; }

// HP "did not understand the request" reply (both protocols).
inline bool is_error_reply(const uint8_t* buf, int len) {
    return len >= 2 && buf[0] == 0x15 && buf[1] == 0xea;
}

// Verify the trailing-byte checksum over the first len-1 bytes.
inline bool crc_ok(const uint8_t* buf, int len) {
    return len >= 1 && crc(buf, len - 1) == buf[len - 1];
}

// Where the value payload starts inside a full reply (past the header): protocol S = 1,
// protocol I = 3 (ESPAltherma Converter::readRegistryValues).
inline int payload_offset(Protocol proto) { return proto == Protocol::S ? 1 : 3; }

} // namespace daik
