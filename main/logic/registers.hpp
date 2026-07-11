#pragma once
// Register-buffer value extraction. IDF-free + host-tested. Byte order and sign match the classic
// Altherma monitor semantics (cross-checked against two independent X10A implementations): a value
// is a 16-bit field read with an endianness flag — flag 0 = little-endian (LSB first), flag 1 =
// big-endian — and sign is chosen by the converter (logic/convert.hpp): convs 101-111 signed,
// 151-165 unsigned. A 1-byte field uses data[0] only.
#include <cstdint>

namespace daik {

// Unsigned 16-bit read. big_endian=false → (data[1]<<8)|data[0] (flag 0); true → (data[0]<<8)|data[1].
inline uint16_t read_u16(const uint8_t* data, int size, bool big_endian) {
    if (size <= 1) return data[0];
    return big_endian ? static_cast<uint16_t>((data[0] << 8) | data[1])
                      : static_cast<uint16_t>((data[1] << 8) | data[0]);
}

// Two's-complement signed 16-bit read of the same field. (A 1-byte field has its high byte 0, so
// it is effectively 0..255 — matching the reference, which never sets bit 15 for size 1.)
inline int16_t read_s16(const uint8_t* data, int size, bool big_endian) {
    return static_cast<int16_t>(read_u16(data, size, big_endian));
}

// Bounds check: is (offset, size) within a reply payload of `payload_len` bytes?
inline bool in_bounds(int offset, int size, int payload_len) {
    return offset >= 0 && size > 0 && offset + size <= payload_len;
}

} // namespace daik
