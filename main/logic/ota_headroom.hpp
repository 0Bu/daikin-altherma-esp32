#pragma once
// Allocation headroom required before an OTA transfer or image validation starts.
//
// The HTTPS transfer and the post-TLS Secure-Boot-v2 verifier are different allocation phases.
// Both allocate from INTERNAL 8-bit RAM, but TLS needs materially more aggregate and contiguous
// headroom than RSA/PSA validation after the HTTP client has been destroyed.  Total free heap alone
// is therefore not enough: a fragmented heap can report tens of kilobytes free while no single
// block is large enough.  Keep this rule IDF-free and host-testable; the device adapter in
// ota_update.cpp supplies the internal-heap samples, so PSRAM/default-capability bytes cannot make
// either gate look healthier than the allocator it protects.
#include <cstddef>

namespace daik {

struct OtaHeapHeadroom {
    size_t min_free_bytes;
    size_t min_largest_block_bytes;
    unsigned stable_samples;
};

// Live OTA evidence separates the two phases:
//   - firmware TLS failed twice at about 46-47 KiB free, while successful transfers began at
//     58-63 KiB free with an approximately 30-32 KiB largest block;
//   - RSA-3072 validation succeeds after TLS cleanup at the older measured 24/12 KiB floor.
// The transfer floor matches the independently measured weather-TLS admission budget and requires
// four consecutive samples, preventing a single allocator recovery edge from authorizing a
// multi-megabyte download. These are gates, not reservations; TLS and the verifier remain
// authoritative and every malformed, unsigned or wrongly-signed image is still rejected.
inline constexpr OtaHeapHeadroom OTA_TRANSFER_HEADROOM = {56 * 1024, 24 * 1024, 4};
inline constexpr OtaHeapHeadroom OTA_VALIDATION_HEADROOM = {24 * 1024, 12 * 1024, 2};

// Compatibility names keep the verifier's independently measured budget explicit.
inline constexpr size_t OTA_VERIFY_MIN_FREE_BYTES          = 24 * 1024;
inline constexpr size_t OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES = 12 * 1024;

inline bool ota_headroom_ok(const OtaHeapHeadroom& requirement, size_t free_bytes,
                            size_t largest_free_block) {
    return free_bytes >= requirement.min_free_bytes &&
           largest_free_block >= requirement.min_largest_block_bytes;
}

inline unsigned ota_headroom_streak_next(const OtaHeapHeadroom& requirement,
                                         unsigned current_streak, size_t free_bytes,
                                         size_t largest_free_block) {
    if (!ota_headroom_ok(requirement, free_bytes, largest_free_block)) return 0;
    return current_streak < requirement.stable_samples ? current_streak + 1 : current_streak;
}

inline bool ota_verify_headroom_ok(size_t free_bytes, size_t largest_free_block) {
    return ota_headroom_ok(OTA_VALIDATION_HEADROOM, free_bytes, largest_free_block);
}

} // namespace daik
