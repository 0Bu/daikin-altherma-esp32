#pragma once
#include <cstddef>
#include <string_view>

namespace daik {

// Length of one well-formed UTF-8 Unicode scalar, or zero for an invalid/incomplete prefix.
// Callers choose their boundary policy: incoming JSON rejects it; outgoing device text replaces
// each invalid byte with U+FFFD. Valid sequences always retain their original bytes.
inline size_t utf8_sequence_length(std::string_view bytes) noexcept {
    if (bytes.empty()) return 0;
    const auto first = static_cast<unsigned char>(bytes[0]);
    if (first < 0x80) return 1;
    unsigned scalar = 0, minimum = 0;
    size_t   count = 0;
    if (first >= 0xC2 && first <= 0xDF) {
        scalar  = first & 0x1F;
        minimum = 0x80;
        count   = 2;
    } else if (first >= 0xE0 && first <= 0xEF) {
        scalar  = first & 0x0F;
        minimum = 0x800;
        count   = 3;
    } else if (first >= 0xF0 && first <= 0xF4) {
        scalar  = first & 0x07;
        minimum = 0x10000;
        count   = 4;
    } else {
        return 0;
    }
    if (bytes.size() < count) return 0;
    for (size_t i = 1; i < count; ++i) {
        const auto next = static_cast<unsigned char>(bytes[i]);
        if ((next & 0xC0) != 0x80) return 0;
        scalar = (scalar << 6) | (next & 0x3F);
    }
    if (scalar < minimum || scalar > 0x10FFFF || (scalar >= 0xD800 && scalar <= 0xDFFF)) return 0;
    return count;
}

} // namespace daik
