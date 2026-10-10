#pragma once

#include <cstddef>
#include <cstring>

namespace daik {

inline constexpr char   kDiagTruncatedMarker[] = "[... truncated ...]\n";
inline constexpr size_t kDiagMarkerLen         = sizeof(kDiagTruncatedMarker) - 1;

// A clipped printf must still end its record. Otherwise the next record becomes an unmarked
// continuation, and a wrapped tail may later expose an identifier without its redaction prefix.
inline size_t diag_finish_record(char* line, size_t len, size_t capacity, bool truncated) {
    if (!line || !capacity) return 0;
    if (len > capacity) len = capacity;
    if (truncated || (len == capacity && line[len - 1] != '\n')) {
        const size_t suffix = capacity < kDiagMarkerLen ? capacity : kDiagMarkerLen;
        if (len > capacity - suffix) len = capacity - suffix;
        std::memcpy(line + len, kDiagTruncatedMarker + kDiagMarkerLen - suffix, suffix);
        return len + suffix;
    }
    if (len && line[len - 1] != '\n') line[len++] = '\n';
    return len;
}

// Return only complete physical records, oldest to newest. A wrapped ring's oldest byte may
// already be inside an identifier whose marker was overwritten: discard through the next newline
// even when the ring fits the output. A size-clipped tail follows the same rule. If no complete
// boundary survives, return only the explicit truncation marker, never an unrecognizable suffix.
inline size_t diag_dump_tail(const char* ring, size_t ring_size, size_t len, bool wrapped,
                             char* out, size_t max) {
    if (!ring || !ring_size || !out || !max || len > ring_size || (wrapped && len == ring_size))
        return 0;
    const size_t total = wrapped ? ring_size : len;
    if (!total) return 0;
    auto char_at = [&](size_t i) -> char { return ring[wrapped ? (len + i) % ring_size : i]; };

    size_t end = total;
    while (end && char_at(end - 1) != '\n') --end;
    const bool clipped = wrapped || total > max || end != total;
    if (!clipped) {
        std::memcpy(out, ring, total);
        return total;
    }
    const size_t marker = max < kDiagMarkerLen ? max : kDiagMarkerLen;
    std::memcpy(out, kDiagTruncatedMarker, marker);
    if (max <= kDiagMarkerLen) return marker;

    const size_t budget = max - marker;
    size_t       start  = total > budget ? total - budget : 0;
    if ((wrapped && start == 0) || (start && char_at(start - 1) != '\n')) {
        while (start < total && char_at(start) != '\n') ++start;
        if (start < total) ++start;
    }
    if (start >= end) return marker;
    for (size_t i = start; i < end; ++i) out[marker + i - start] = char_at(i);
    return marker + end - start;
}

} // namespace daik
