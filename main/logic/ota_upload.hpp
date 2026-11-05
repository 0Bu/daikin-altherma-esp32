#pragma once
#include "ota_channel.hpp"
#include "ota_manifest.hpp"
#include <cstddef>

namespace daik {

inline constexpr int64_t OTA_UPLOAD_BUDGET_US = 300'000'000;

// Explicit local testing can reinstall the same version or an older signed build. The saved
// channel, never a request parameter or the image's version label, grants this capability.
inline bool ota_upload_allowed(OtaChannel channel, size_t length, size_t partition_size,
                               const char* sha256) noexcept {
    return channel == OtaChannel::Dev && length >= 4096 && length <= partition_size &&
           ota_sha256_hex_valid(sha256);
}

} // namespace daik
