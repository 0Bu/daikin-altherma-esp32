#pragma once

#include <string_view>

namespace daik {

inline std::string_view http_trim_ows(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    return value;
}

inline std::string_view http_strip_weak_etag(std::string_view value) {
    value = http_trim_ows(value);
    if (value.size() >= 2 && value[0] == 'W' && value[1] == '/') value.remove_prefix(2);
    return http_trim_ows(value);
}

// If-None-Match uses weak comparison for GET/HEAD.  Parse a validator list without allocating and
// without splitting on a comma inside an opaque quoted tag.  The dashboard emits a quoted SHA-256,
// but accepting a standards-shaped list keeps proxies and browser cache layers interoperable.
inline bool http_if_none_match(std::string_view header, std::string_view current_etag) {
    current_etag = http_strip_weak_etag(current_etag);
    if (current_etag.empty()) return false;

    size_t pos = 0;
    while (pos < header.size()) {
        while (pos < header.size() && (header[pos] == ' ' || header[pos] == '\t' || header[pos] == ',')) pos++;
        if (pos >= header.size()) break;

        const size_t start = pos;
        bool quoted = false;
        while (pos < header.size()) {
            const char c = header[pos];
            if (c == '"') quoted = !quoted;
            if (c == ',' && !quoted) break;
            pos++;
        }
        const std::string_view candidate = http_trim_ows(header.substr(start, pos - start));
        if (candidate == "*" || http_strip_weak_etag(candidate) == current_etag) return true;
        if (pos < header.size()) pos++;
    }
    return false;
}

} // namespace daik
