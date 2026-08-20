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
//
// The sharper case is a reading that is impossible yet lands INSIDE reading_plausible()'s ±200 °C
// window, so no gate ever fires and it reaches Home Assistant and Grafana as a real measurement:
// measured on a live unit, Target Evap. Temp. (page 0x10 offset 6) reached 199.6 °C — 0.4 °C under
// the ceiling — and the two outdoor pressures (page 0x20 offsets 12/14) stayed at 0.0 bar through
// every sample taken while the compressor ran at 42 rps with 104.5 °C discharge, where an R32 high
// side runs 25-40 bar. A plausibility bound cannot catch those; only the wire bytes distinguish an
// absent sensor from a wrong offset, which is why 0x10 and 0x20 are dumped too.
//
// HISTORICAL LIMITATION: this dump is emitted ONLY on a detect pass — at boot, or on POST /detect.
// A detect pass essentially never coincides with a compressor run, and Target Evap. Temp. was only
// wrong WHILE the compressor ran. #209 added the complementary runtime capture and the resulting
// wire evidence resolved #194 through logic/conv_override.hpp. The detect dump remains intentionally
// separate: it answers page/layout questions during discovery, while raw_capture.hpp samples a
// bounded number of running-state frames.
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
