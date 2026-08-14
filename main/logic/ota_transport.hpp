#pragma once
// Fail-closed URL policy for the signed OTA transport.  The signature protects firmware
// authenticity, while HTTPS protects availability/metadata and prevents a network attacker from
// feeding arbitrary multi-megabyte responses to the flash writer.  Keep the parser small,
// allocation-free and host-testable; esp_http_client remains responsible for full URL parsing.
#include <cstddef>
#include <string_view>

namespace daik {

inline char ota_ascii_lower(char c) {
    return c >= 'A' && c <= 'Z' ? static_cast<char>(c + ('a' - 'A')) : c;
}

inline bool ota_ascii_prefix_ieq(std::string_view value, std::string_view prefix) {
    if (value.size() < prefix.size()) return false;
    for (size_t i = 0; i < prefix.size(); ++i)
        if (ota_ascii_lower(value[i]) != ota_ascii_lower(prefix[i])) return false;
    return true;
}

inline bool ota_url_chars_safe(std::string_view value) {
    for (const unsigned char c : value)
        if (c <= 0x20 || c == 0x7f || c == '\\') return false;
    return true;
}

inline bool ota_url_is_absolute_https(std::string_view value) {
    constexpr std::string_view scheme = "https://";
    if (!ota_ascii_prefix_ieq(value, scheme) || value.size() == scheme.size()) return false;
    if (!ota_url_chars_safe(value)) return false;
    // Require a non-empty authority. `https:///path` is not an HTTPS origin.
    const char first_authority = value[scheme.size()];
    return first_authority != '/' && first_authority != '?' && first_authority != '#';
}

// Redirects may stay on the same HTTPS origin with an ordinary relative reference.  Protocol-
// relative `//host` is rejected deliberately: making the authority switch visually look like a
// path is unnecessary for the feed and has produced parser inconsistencies in other URL stacks.
inline bool ota_url_is_https_or_relative(std::string_view value) {
    if (value.empty() || !ota_url_chars_safe(value)) return false;
    if (ota_url_is_absolute_https(value)) return true;
    if (value.size() >= 2 && value[0] == '/' && value[1] == '/') return false;

    // Any colon before a path/query/fragment delimiter declares a scheme.  Only the absolute
    // HTTPS case above is permitted; this rejects http:, ws:, data: and ambiguous drive syntax.
    for (const char c : value) {
        if (c == ':') return false;
        if (c == '/' || c == '?' || c == '#') break;
    }
    return true;
}

// One redirect response must carry exactly one unambiguous Location. ESP-IDF appends the values of
// repeated Location headers into its internal `client->location` string; treating only the last
// callback as authoritative can therefore validate an HTTPS second header while
// esp_http_client_set_redirection() still parses a concatenation beginning with an HTTP first one.
// Saturate at two because the security decision needs only "zero / one / duplicate", and fail
// closed on every duplicate regardless of header order.
struct OtaRedirectLocationState {
    unsigned location_count = 0;
    bool location_secure = false;
};

inline void ota_redirect_location_reset(OtaRedirectLocationState& state) {
    state.location_count = 0;
    state.location_secure = false;
}

inline void ota_redirect_location_observe(OtaRedirectLocationState& state,
                                          std::string_view value) {
    if (state.location_count < 2) ++state.location_count;
    if (state.location_count == 1)
        state.location_secure = ota_url_is_https_or_relative(value);
    else
        state.location_secure = false;
}

inline bool ota_redirect_location_accepted(const OtaRedirectLocationState& state) {
    return state.location_count == 1 && state.location_secure;
}

} // namespace daik
