#pragma once
// Pure hex rendering for RAW X10A page payloads on the diag log. IDF-free, so the truncation and
// bounds behaviour are host-tested rather than discovered on a board.
//
// Decoded values alone cannot distinguish a wrong converter, byte offset or model layout from an
// unpopulated measurement. Raw replies preserve that distinction. Numeric patterns on 0xA0/0xA1
// alone establish neither presence nor absence; availability.hpp evaluates structural evidence.
// Even a temperature inside reading_plausible()'s −60 to 200 °C envelope can be a wrong decode:
// Target Evap. Temp. once reached 199.6 °C before its converter adjudication. Dumps of identity,
// outdoor and indoor pages provide the wire evidence needed to resolve such cases.
//
// Detection uses this renderer for discovery probes. The separate raw_capture.hpp cadence samples
// a bounded number of running-state frames, which discovery alone may miss.
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
