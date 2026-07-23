#pragma once
// Pure hex rendering for RAW X10A page payloads on the diag log. IDF-free, so the truncation and
// bounds behaviour are host-tested rather than discovered on a board.
//
// Why this exists: HTTP exposes only DECODED values (/values, /status.detect), so when a decoded
// value is physically impossible there is no way to tell a wrong converter from a wrong byte offset
// from a page whose layout simply differs on this unit — the wire bytes are the only evidence that
// separates them, and they never leave the device. The 0xA0/0xA1 (O/U-II) rows are exactly that
// case: several read a constant 0.0 while others read ~190 °C on the same unit under load, which is
// the signature of an offset/layout mismatch, not a dead page. One diag line per probed page turns
// that from a hypothesis into a decidable question.
#include <cstdint>

namespace daik {

// Renders data[0..len) as lowercase space-separated hex ("a0 1f 00 …") into out[0..outmax).
// Always NUL-terminates when outmax > 0. Returns the number of characters written, EXCLUDING the
// terminator — so a caller can tell a truncated dump from a complete one by comparing against the
// 3*len-1 a full render would need.
//
// Truncation is by whole bytes: a payload that does not fit stops after the last COMPLETE pair
// rather than emitting half a byte, since a trailing nibble would read as a different value and a
// hex dump exists precisely to be read literally. diag_printf's line buffer is 256 B and a page
// payload is at most 32 B (96 chars), so on the real call path this never truncates — the bound is
// here so a future caller with a smaller buffer degrades legibly instead of scribbling past it.
inline int hex_render(const uint8_t* data, int len, char* out, int outmax) {
    if (out == nullptr || outmax <= 0) return 0;
    out[0] = '\0';
    if (data == nullptr || len <= 0) return 0;

    static const char kDigits[] = "0123456789abcdef";
    int w = 0;
    for (int i = 0; i < len; i++) {
        // Each byte needs 2 chars, plus a leading space for every byte after the first, plus the
        // NUL. Bail before writing a partial pair.
        const int need = (i == 0 ? 2 : 3);
        if (w + need + 1 > outmax) break;
        if (i > 0) out[w++] = ' ';
        out[w++] = kDigits[(data[i] >> 4) & 0x0F];
        out[w++] = kDigits[data[i] & 0x0F];
    }
    out[w] = '\0';
    return w;
}

} // namespace daik
