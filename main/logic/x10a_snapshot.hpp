#pragma once
// Allocation-free alignment of a compact X10A cache into a caller-owned stable profile layout.
// IDF-free and host-tested; hp_poll.cpp invokes it while holding the cache mutex.
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace daik::logic {

enum class X10aSnapshotAlignResult {
    Ok,
    IdentityMismatch,
    ValueTooLarge,
};

inline bool x10a_snapshot_source_matches(const char* committed_profile,
                                         uint64_t committed_fingerprint,
                                         const char* expected_profile,
                                         uint64_t expected_fingerprint) {
    return committed_profile && expected_profile &&
           std::strcmp(committed_profile, expected_profile) == 0 &&
           committed_fingerprint == expected_fingerprint;
}

template <typename Row>
inline bool x10a_snapshot_identity_equal(const Row& a, const Row& b) {
    if (a.reg != b.reg || a.off != b.off || a.conv != b.conv) return false;
    return a.label == b.label ||
           (a.label && b.label && std::strcmp(a.label, b.label) == 0);
}

template <typename Row>
inline X10aSnapshotAlignResult x10a_snapshot_align(Row* out, size_t count,
                                                    const Row* source, size_t source_count) {
    // Validate the complete source first. A profile race, duplicate source row or undersized value
    // leaves the caller's previous stable snapshot untouched rather than partially updating it.
    for (size_t src = 0; src < source_count; src++) {
        for (size_t prior = 0; prior < src; prior++)
            if (x10a_snapshot_identity_equal(source[prior], source[src]))
                return X10aSnapshotAlignResult::IdentityMismatch;
        size_t dst = count;
        for (size_t i = 0; i < count; i++) {
            if (x10a_snapshot_identity_equal(out[i], source[src])) {
                dst = i;
                break;
            }
        }
        if (dst == count) return X10aSnapshotAlignResult::IdentityMismatch;
        if (source[src].value.size() > out[dst].value.capacity())
            return X10aSnapshotAlignResult::ValueTooLarge;
    }

    for (size_t i = 0; i < count; i++) {
        out[i].value.clear();
        out[i].held = false;
    }
    for (size_t src = 0; src < source_count; src++) {
        for (size_t dst = 0; dst < count; dst++) {
            if (!x10a_snapshot_identity_equal(out[dst], source[src])) continue;
            out[dst].value.assign(source[src].value.data(), source[src].value.size());
            out[dst].held = source[src].held;
            break;
        }
    }
    return X10aSnapshotAlignResult::Ok;
}

}  // namespace daik::logic
