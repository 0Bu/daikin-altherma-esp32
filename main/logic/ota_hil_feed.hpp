#pragma once
// Ephemeral release-HIL OTA feed selection and offer binding.  IDF-free + host-tested.
//
// Release HIL must exercise the byte-identical public candidate, while production promotion must
// exercise the inventory-pinned bench release leg without persisting a channel change. Neither feed
// can be compiled into a special firmware build. Instead, trusted-LAN GET /ota/check may supply one
// bounded pair of HTTPS URLs. The pair is deliberately transient: it is copied into the OTA task,
// then bound to the exact successful offer generation and copied once more into the accepted update
// task. It is never written to Config/NVS and a later request cannot replace it.
#include "ota_channel.hpp"
#include "ota_manifest.hpp"
#include "ota_transport.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string_view>

namespace daik {

inline constexpr size_t OTA_FEED_URL_MAX      = 255;
inline constexpr size_t OTA_FEED_URL_CAPACITY = OTA_FEED_URL_MAX + 1;

struct OtaFeedUrls {
    std::array<char, OTA_FEED_URL_CAPACITY> manifest{};
    std::array<char, OTA_FEED_URL_CAPACITY> firmware_base{};
};

enum class OtaHilFeedHeaderResult : uint8_t {
    DefaultFeed,
    OverrideFeed,
    PartialPair,
    InvalidUrl,
};

inline void ota_feed_urls_clear(OtaFeedUrls& urls) { urls = {}; }

template <size_t N>
inline bool ota_fixed_text_view(const std::array<char, N>& text, std::string_view& out) {
    size_t length = 0;
    while (length < N && text[length] != '\0') ++length;
    if (length == N) {
        out = {};
        return false;
    }
    out = std::string_view(text.data(), length);
    return true;
}

inline bool ota_feed_url_copy(std::array<char, OTA_FEED_URL_CAPACITY>& out,
                              std::string_view                         value) {
    out.fill('\0');
    if (value.size() > OTA_FEED_URL_MAX) return false;
    if (!value.empty()) std::memcpy(out.data(), value.data(), value.size());
    return true;
}

inline bool ota_feed_urls_copy(OtaFeedUrls& out, std::string_view manifest,
                               std::string_view firmware_base) {
    OtaFeedUrls candidate{};
    if (!ota_feed_url_copy(candidate.manifest, manifest) ||
        !ota_feed_url_copy(candidate.firmware_base, firmware_base)) {
        ota_feed_urls_clear(out);
        return false;
    }
    out = candidate;
    return true;
}

template <size_t N>
inline bool ota_fixed_text_append(std::array<char, N>& out, size_t& length,
                                  std::string_view suffix) noexcept {
    static_assert(N > 0, "fixed OTA text needs a terminator slot");
    if (length >= N || suffix.size() > N - length - 1) return false;
    if (!suffix.empty()) std::memcpy(out.data() + length, suffix.data(), suffix.size());
    length += suffix.size();
    out[length] = '\0';
    return true;
}

// Resolve the two compile-time/default feed URLs without constructing a std::string. This helper
// runs only after a check has won the OTA busy preflight, but it still has to be allocation-free:
// accepting a harmless repeated /ota/check must not spend the contiguous heap which the active TLS
// operation is protecting. Empty configuration retains the historical behavior and is copied as
// an empty pair so the asynchronous task can publish the specific "No update URL configured"
// diagnosis instead of turning it into an ambiguous task-creation refusal.
inline bool ota_default_feed_urls(OtaChannel channel, std::string_view release_manifest,
                                  std::string_view firmware_root, OtaFeedUrls& out) noexcept {
    OtaFeedUrls candidate{};
    if (channel == OtaChannel::Release) {
        if (!ota_feed_url_copy(candidate.manifest, release_manifest) ||
            !ota_feed_url_copy(candidate.firmware_base, firmware_root)) {
            ota_feed_urls_clear(out);
            return false;
        }
        size_t base_length = firmware_root.size();
        if (base_length > 0 && candidate.firmware_base[base_length - 1] != '/' &&
            !ota_fixed_text_append(candidate.firmware_base, base_length, "/")) {
            ota_feed_urls_clear(out);
            return false;
        }
    } else {
        if (firmware_root.empty()) {
            ota_feed_urls_clear(out);
            return true;
        }
        size_t base_length = 0;
        if (!ota_fixed_text_append(candidate.firmware_base, base_length, firmware_root) ||
            (candidate.firmware_base[base_length - 1] != '/' &&
             !ota_fixed_text_append(candidate.firmware_base, base_length, "/")) ||
            !ota_fixed_text_append(candidate.firmware_base, base_length, kOtaDevSubdir) ||
            !ota_fixed_text_append(candidate.firmware_base, base_length, "/")) {
            ota_feed_urls_clear(out);
            return false;
        }
        size_t manifest_length = 0;
        if (!ota_fixed_text_append(candidate.manifest, manifest_length,
                                   std::string_view(candidate.firmware_base.data(), base_length)) ||
            !ota_fixed_text_append(candidate.manifest, manifest_length, "manifest.json")) {
            ota_feed_urls_clear(out);
            return false;
        }
    }
    out = candidate;
    return true;
}

inline bool ota_feed_urls_valid(const OtaFeedUrls& urls) {
    std::string_view manifest;
    std::string_view firmware_base;
    return ota_fixed_text_view(urls.manifest, manifest) &&
           ota_fixed_text_view(urls.firmware_base, firmware_base) &&
           ota_url_is_absolute_https(manifest) && ota_url_is_absolute_https(firmware_base) &&
           firmware_base.back() == '/';
}

// Validate the HTTP header pair without allocation.  Presence is kept separate from value length
// so an explicitly empty header is rejected as an invalid URL instead of silently selecting the
// production CONFIG feed.
inline OtaHilFeedHeaderResult ota_hil_feed_headers(bool manifest_present, std::string_view manifest,
                                                   bool             firmware_base_present,
                                                   std::string_view firmware_base,
                                                   OtaFeedUrls&     out) {
    if (!manifest_present && !firmware_base_present) {
        ota_feed_urls_clear(out);
        return OtaHilFeedHeaderResult::DefaultFeed;
    }
    if (manifest_present != firmware_base_present) {
        ota_feed_urls_clear(out);
        return OtaHilFeedHeaderResult::PartialPair;
    }
    if (manifest.empty() || firmware_base.empty() || manifest.size() > OTA_FEED_URL_MAX ||
        firmware_base.size() > OTA_FEED_URL_MAX || !ota_url_is_absolute_https(manifest) ||
        !ota_url_is_absolute_https(firmware_base) || firmware_base.back() != '/') {
        ota_feed_urls_clear(out);
        return OtaHilFeedHeaderResult::InvalidUrl;
    }
    if (!ota_feed_urls_copy(out, manifest, firmware_base)) {
        ota_feed_urls_clear(out);
        return OtaHilFeedHeaderResult::InvalidUrl;
    }
    return OtaHilFeedHeaderResult::OverrideFeed;
}

// The signed artifact identity and its two effective source URLs form one mutex-owned lease.  The
// update path calls ota_offer_binding_copy_feed(), rather than separately comparing the identity
// and then reading URLs, so a generation replacement can never create a mixed snapshot.
struct OtaOfferBinding {
    uint32_t             generation = 0;
    std::array<char, 8>  channel{};
    std::array<char, 32> version{};
    std::array<char, 65> app_sha256{};
    OtaFeedUrls          feed{};
};

inline void ota_offer_binding_clear(OtaOfferBinding& binding) { binding = {}; }

template <size_t N>
inline bool ota_offer_text_copy(std::array<char, N>& out, std::string_view value) {
    out.fill('\0');
    if (value.empty() || value.size() >= N) return false;
    std::memcpy(out.data(), value.data(), value.size());
    return true;
}

inline bool ota_offer_binding_set(OtaOfferBinding& out, uint32_t generation,
                                  std::string_view channel, std::string_view version,
                                  const char* app_sha256, const OtaFeedUrls& feed) {
    OtaOfferBinding candidate{};
    if (generation == 0 || (channel != "release" && channel != "dev") ||
        !ota_offer_text_copy(candidate.channel, channel) ||
        !ota_offer_text_copy(candidate.version, version) || !ota_sha256_hex_valid(app_sha256) ||
        !ota_feed_urls_valid(feed)) {
        ota_offer_binding_clear(out);
        return false;
    }
    candidate.generation = generation;
    std::memcpy(candidate.app_sha256.data(), app_sha256, candidate.app_sha256.size());
    candidate.feed = feed;
    out            = candidate;
    return true;
}

inline bool ota_offer_binding_copy_feed(const OtaOfferBinding& binding, uint32_t generation,
                                        std::string_view channel, std::string_view version,
                                        const char* app_sha256, OtaFeedUrls& out) {
    ota_feed_urls_clear(out);
    std::string_view bound_channel;
    std::string_view bound_version;
    if (generation == 0 || binding.generation != generation ||
        !ota_fixed_text_view(binding.channel, bound_channel) ||
        !ota_fixed_text_view(binding.version, bound_version) || bound_channel != channel ||
        bound_version != version || !ota_sha256_hex_valid(app_sha256) ||
        std::memcmp(binding.app_sha256.data(), app_sha256, binding.app_sha256.size()) != 0)
        return false;
    out = binding.feed;
    return true;
}

} // namespace daik
