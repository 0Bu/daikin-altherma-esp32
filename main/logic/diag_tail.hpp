#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace daik {

inline constexpr size_t kDiagRingBytes         = 6144;
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

// Monotonic byte-sequence cursor over the circular log buffer. It avoids materializing a second
// 6 KiB copy on /diag while keeping the same truncation and complete-line guarantees as
// diag_dump_tail().
struct DiagStreamCursor {
    uint64_t next_seq   = 0;
    uint64_t end_seq    = 0;
    size_t   marker_pos = 0;
    size_t   marker_len = 0;
};

inline DiagStreamCursor diag_stream_begin(const char* ring, size_t ring_size, size_t len,
                                          bool wrapped, uint64_t written, size_t max_bytes) {
    DiagStreamCursor cur{};
    if (!ring || !ring_size || !max_bytes || len > ring_size || (wrapped && len == ring_size))
        return cur;
    const size_t total = wrapped ? ring_size : len;
    if (!total || written < total || (wrapped && len != written % ring_size) ||
        (!wrapped && written != len))
        return cur;
    const uint64_t oldest_seq = written - total;
    auto char_at = [&](size_t i) -> char { return ring[wrapped ? (len + i) % ring_size : i]; };

    size_t end = total;
    while (end && char_at(end - 1) != '\n') --end;
    const bool clipped = wrapped || total > max_bytes || end != total;
    if (!clipped) {
        cur.next_seq = oldest_seq;
        cur.end_seq  = oldest_seq + total;
        return cur;
    }
    cur.marker_len = max_bytes < kDiagMarkerLen ? max_bytes : kDiagMarkerLen;
    if (max_bytes <= kDiagMarkerLen) return cur;

    const size_t budget = max_bytes - cur.marker_len;
    size_t       start  = total > budget ? total - budget : 0;
    if ((wrapped && start == 0) || (start && char_at(start - 1) != '\n')) {
        while (start < total && char_at(start) != '\n') ++start;
        if (start < total) ++start;
    }
    if (start >= end) return cur;
    cur.next_seq = oldest_seq + start;
    cur.end_seq  = oldest_seq + end;
    return cur;
}

// Read the next slice (up to `cap` bytes) referenced by `cur`. When `whole_lines` is true, every
// payload chunk stops on a newline boundary so redacted streaming never splits a line across two
// redact_diag_line() calls.
inline size_t diag_stream_read(DiagStreamCursor& cur, const char* ring, size_t ring_size,
                               uint64_t written, char* out, size_t cap, bool whole_lines) {
    if (!ring || !ring_size || !out || !cap) return 0;
    size_t pos = 0;
    if (cur.marker_pos < cur.marker_len) {
        const size_t rem = cur.marker_len - cur.marker_pos;
        if (whole_lines && cap < rem) return 0;
        const size_t n = rem < cap ? rem : cap;
        std::memcpy(out, kDiagTruncatedMarker + cur.marker_pos, n);
        cur.marker_pos += n;
        pos += n;
    }
    if (cur.next_seq >= cur.end_seq || pos == cap) return pos;
    if (written < cur.end_seq) {
        cur.next_seq = cur.end_seq;
        return pos;
    }
    const uint64_t live_oldest = written > ring_size ? written - ring_size : 0;
    if (cur.next_seq < live_oldest) {
        // Concurrent logging wrapped past this cursor offset: skip through the overwritten line's
        // terminator so an unmarked tail fragment cannot be emitted without its prefix.
        cur.next_seq = live_oldest;
        while (cur.next_seq < cur.end_seq && ring[cur.next_seq % ring_size] != '\n') ++cur.next_seq;
        if (cur.next_seq < cur.end_seq) ++cur.next_seq;
        if (cur.next_seq >= cur.end_seq) return pos;
    }
    while (cur.next_seq < cur.end_seq) {
        size_t avail =
            static_cast<size_t>(std::min<uint64_t>(cap - pos, cur.end_seq - cur.next_seq));
        for (size_t i = 0; i < avail; ++i) out[pos + i] = ring[(cur.next_seq + i) % ring_size];
        if (whole_lines && cur.next_seq + avail < cur.end_seq) {
            size_t eol = avail;
            while (eol > 0 && out[pos + eol - 1] != '\n') --eol;
            if (eol == 0) {
                if (pos == 0) {
                    while (cur.next_seq < cur.end_seq && ring[cur.next_seq % ring_size] != '\n')
                        ++cur.next_seq;
                    if (cur.next_seq < cur.end_seq) ++cur.next_seq;
                    continue;
                }
                return pos;
            }
            avail = eol;
        }
        cur.next_seq += avail;
        pos += avail;
        break;
    }
    return pos;
}

} // namespace daik
