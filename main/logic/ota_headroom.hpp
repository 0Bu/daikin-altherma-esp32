#pragma once
// Allocation headroom required before an OTA transfer or image validation starts.
//
// Secure-Boot-v2 validation allocates RSA/PSA working state from INTERNAL 8-bit RAM.  Total free
// heap alone is therefore not enough: a fragmented heap can report tens of kilobytes free while no
// single block is large enough for the verifier.  Keep this rule IDF-free and host-testable; the
// device adapter in ota_update.cpp supplies heap_caps_get_free_size(INTERNAL) and the largest
// internal block, so PSRAM/default-capability bytes cannot make this gate look healthier than the
// allocator the verifier actually uses.
#include <cstddef>

namespace daik {

// The healthy ESP32-S3 board has about 58 KiB free and a 17 KiB largest internal block at idle.
// These floors leave room for the RSA-3072/PSA verifier without pretending that aggregate free
// bytes can substitute for a contiguous allocation.  They are gates, not reservations: the actual
// verifier remains authoritative and still rejects every malformed, unsigned or wrongly-signed
// image.
inline constexpr size_t OTA_VERIFY_MIN_FREE_BYTES          = 24 * 1024;
inline constexpr size_t OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES = 12 * 1024;

inline bool ota_verify_headroom_ok(size_t free_bytes, size_t largest_free_block) {
    return free_bytes >= OTA_VERIFY_MIN_FREE_BYTES &&
           largest_free_block >= OTA_VERIFY_MIN_LARGEST_BLOCK_BYTES;
}

} // namespace daik
