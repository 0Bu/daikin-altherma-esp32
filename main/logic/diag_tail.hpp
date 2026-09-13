#pragma once

#include <cstddef>
#include <cstring>

namespace daik {

inline constexpr char   kDiagTruncatedMarker[] = "[... truncated ...]\n";
inline constexpr size_t kDiagMarkerLen         = sizeof(kDiagTruncatedMarker) - 1;

// Dump the diagnostic ring buffer into `out`, bounded by `max` bytes.
// If the ring content fits in `max`, the entire ring is copied from oldest to newest.
// If the ring content exceeds `max`, the newest bounded tail is returned, prepended by
// kDiagTruncatedMarker, and aligned to start at a complete line when possible.
inline size_t diag_dump_tail(const char* ring, size_t ring_size, size_t len, bool wrapped,
                             char* out, size_t max) {
    if (!out || max == 0) return 0;
    const size_t total = wrapped ? ring_size : len;
    if (total == 0) return 0;

    auto char_at = [&](size_t logical_idx) -> char {
        if (!wrapped) return ring[logical_idx];
        return ring[(len + logical_idx) % ring_size];
    };

    if (total <= max) {
        if (!wrapped) {
            std::memcpy(out, ring, len);
            return len;
        }
        const size_t tail = ring_size - len;
        std::memcpy(out, ring + len, tail);
        std::memcpy(out + tail, ring, len);
        return ring_size;
    }

    // Truncated: output kDiagTruncatedMarker + newest bytes
    if (max <= kDiagMarkerLen) {
        std::memcpy(out, kDiagTruncatedMarker, max);
        return max;
    }

    const size_t payload_budget = max - kDiagMarkerLen;
    size_t       logical_start  = total - payload_budget;

    // Prefer starting at a complete line: if logical_start is mid-line, find next newline
    if (char_at(logical_start - 1) != '\n') {
        for (size_t i = logical_start; i < total; ++i) {
            if (char_at(i) == '\n') {
                if (i + 1 < total) {
                    logical_start = i + 1;
                }
                break;
            }
        }
    }

    std::memcpy(out, kDiagTruncatedMarker, kDiagMarkerLen);
    const size_t payload_len = total - logical_start;

    if (!wrapped) {
        std::memcpy(out + kDiagMarkerLen, ring + logical_start, payload_len);
    } else {
        const size_t phys_start = (len + logical_start) % ring_size;
        if (phys_start + payload_len <= ring_size) {
            std::memcpy(out + kDiagMarkerLen, ring + phys_start, payload_len);
        } else {
            const size_t chunk1 = ring_size - phys_start;
            const size_t chunk2 = payload_len - chunk1;
            std::memcpy(out + kDiagMarkerLen, ring + phys_start, chunk1);
            std::memcpy(out + kDiagMarkerLen + chunk1, ring, chunk2);
        }
    }

    return kDiagMarkerLen + payload_len;
}

} // namespace daik
