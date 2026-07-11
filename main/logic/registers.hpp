#pragma once
// Register-buffer value extraction. IDF-free + host-tested.
#include <cstdint>

namespace daik {

// Read `size` bytes starting at `data` as an integer. ESPAltherma's getSignedValue equivalent:
// little-endian, optionally sign-extended. (VALIDATE against captured frames in test/ — a wrong
// endianness/sign here silently corrupts every numeric reading; that is exactly why this lives
// in a host-tested header rather than buried in a .cpp.)
inline long read_int(const uint8_t* data, int size, bool is_signed) {
    long v = 0;
    for (int i = 0; i < size; i++) v |= static_cast<long>(data[i]) << (8 * i);
    if (is_signed && size > 0 && (data[size - 1] & 0x80)) v -= (1L << (8 * size));
    return v;
}

// Bounds check: is (offset, size) within a reply payload of `payload_len` bytes?
inline bool in_bounds(int offset, int size, int payload_len) {
    return offset >= 0 && size > 0 && offset + size <= payload_len;
}

} // namespace daik
