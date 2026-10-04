#pragma once

// IDF-free completeness rules shared by HTTP consumers and strict JSON adapters.

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace daik {

inline bool http_body_complete(int64_t content_length, size_t received_bytes,
                               bool message_complete) {
    if (!message_complete) return false;
    return content_length < 0 || static_cast<uint64_t>(content_length) == received_bytes;
}

inline bool json_suffix_is_whitespace(std::string_view suffix) {
    for (const char byte : suffix)
        if (byte != ' ' && byte != '\t' && byte != '\r' && byte != '\n') return false;
    return true;
}

// Bound recursive cJSON parse/delete before any external document reaches them. Sixteen levels
// leave room for the callers even on the 6 KiB MQTT stack; HTTP and Weather use the same limit.
inline constexpr size_t JSON_MAX_DEPTH      = 16;
inline constexpr size_t MQTT_JSON_MAX_DEPTH = JSON_MAX_DEPTH;

inline bool json_payload_depth_ok(std::string_view json, size_t max_depth = MQTT_JSON_MAX_DEPTH) {
    size_t depth     = 0;
    bool   in_string = false;
    bool   escaped   = false;
    for (const char c : json) {
        if (in_string) {
            if (escaped) {
                escaped = false;
            } else if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                in_string = false;
            }
            continue;
        }
        if (c == '"') {
            in_string = true;
            escaped   = false;
            continue;
        }
        if (c == '{' || c == '[') {
            ++depth;
            if (depth > max_depth) return false;
        } else if (c == '}' || c == ']') {
            if (depth > 0) --depth;
        }
    }
    return true;
}

// The parser adapter must return its end pointer. Rejected suffixes are destroyed here so callers
// cannot accidentally accept a valid prefix followed by another document, garbage or a NUL byte.
// Callbacks keep this rule independent of cJSON/IDF and let host tests prove preflight ordering.
template <typename Parse, typename Destroy>
auto json_parse_bounded(std::string_view payload, Parse parse, Destroy destroy,
                        size_t max_depth = JSON_MAX_DEPTH)
    -> decltype(parse(payload.data(), payload.size(), static_cast<const char**>(nullptr))) {
    if (payload.empty() || !json_payload_depth_ok(payload, max_depth)) return nullptr;
    const char* end  = nullptr;
    auto        root = parse(payload.data(), payload.size(), &end);
    if (!root) return nullptr;
    const char* limit = payload.data() + payload.size();
    if (!end || end < payload.data() || end > limit ||
        !json_suffix_is_whitespace(std::string_view(end, static_cast<size_t>(limit - end)))) {
        destroy(root);
        return nullptr;
    }
    return root;
}

} // namespace daik
