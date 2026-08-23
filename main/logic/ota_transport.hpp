#pragma once
// Fail-closed URL policy for the signed OTA transport.  The signature protects firmware
// authenticity, while HTTPS protects availability/metadata and prevents a network attacker from
// feeding arbitrary multi-megabyte responses to the flash writer.  Keep the parser small,
// allocation-free and host-testable; esp_http_client remains responsible for full URL parsing.
#include <cstddef>
#include <cstdint>
#include <limits>
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

// A partial firmware response is accepted only when the server proves exactly which suffix it is
// serving.  Content-Range is untrusted wire text, so parse it without allocation and saturate the
// header count: duplicated fields remain ambiguous even if both happen to carry the same value.
struct OtaContentRangeState {
    unsigned header_count = 0;
    bool valid = false;
    uint64_t start = 0;
    uint64_t end = 0;
    uint64_t total = 0;
};

inline void ota_content_range_reset(OtaContentRangeState& state) {
    state = {};
}

inline bool ota_parse_u64(std::string_view value, size_t& pos, uint64_t& out) noexcept {
    if (pos >= value.size() || value[pos] < '0' || value[pos] > '9') return false;
    uint64_t parsed = 0;
    do {
        const unsigned digit = static_cast<unsigned>(value[pos] - '0');
        if (parsed > (std::numeric_limits<uint64_t>::max() - digit) / 10) return false;
        parsed = parsed * 10 + digit;
        ++pos;
    } while (pos < value.size() && value[pos] >= '0' && value[pos] <= '9');
    out = parsed;
    return true;
}

inline bool ota_content_range_parse(std::string_view value, uint64_t& start, uint64_t& end,
                                    uint64_t& total) noexcept {
    size_t pos = 0;
    while (pos < value.size() && (value[pos] == ' ' || value[pos] == '\t')) ++pos;
    constexpr std::string_view unit = "bytes";
    if (value.size() - pos < unit.size()) return false;
    for (size_t i = 0; i < unit.size(); ++i)
        if (value[pos + i] != unit[i]) return false;
    pos += unit.size();
    if (pos >= value.size() || (value[pos] != ' ' && value[pos] != '\t')) return false;
    while (pos < value.size() && (value[pos] == ' ' || value[pos] == '\t')) ++pos;
    if (!ota_parse_u64(value, pos, start) || pos >= value.size() || value[pos++] != '-')
        return false;
    if (!ota_parse_u64(value, pos, end) || pos >= value.size() || value[pos++] != '/')
        return false;
    if (!ota_parse_u64(value, pos, total)) return false;
    while (pos < value.size() && (value[pos] == ' ' || value[pos] == '\t')) ++pos;
    return pos == value.size() && total > 0 && start <= end && end < total;
}

inline void ota_content_range_observe(OtaContentRangeState& state,
                                      std::string_view value) noexcept {
    if (state.header_count < 2) ++state.header_count;
    if (state.header_count != 1) {
        state.valid = false;
        return;
    }
    state.valid = ota_content_range_parse(value, state.start, state.end, state.total);
}

inline bool ota_content_range_matches(const OtaContentRangeState& state,
                                      uint64_t expected_start,
                                      uint64_t expected_total) noexcept {
    return state.header_count == 1 && state.valid && expected_start < expected_total &&
           state.start == expected_start && state.end == expected_total - 1 &&
           state.total == expected_total;
}

constexpr unsigned OTA_TRANSFER_MAX_RESUMES = 2;

inline bool ota_transfer_resume_allowed(unsigned resumes, uint64_t stream_started_at,
                                        uint64_t written, uint64_t total,
                                        bool deadline_reached) noexcept {
    return resumes < OTA_TRANSFER_MAX_RESUMES && !deadline_reached && total > 0 &&
           stream_started_at < written && written < total;
}

} // namespace daik
