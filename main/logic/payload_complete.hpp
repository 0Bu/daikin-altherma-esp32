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

// Maximum JSON nesting depth tolerated in incoming MQTT payloads before parsing.
// The MQTT task stack is 6 KiB; recursive cJSON parse and delete consume ~64 bytes per depth level,
// so depth > 16 would dangerously eat into task stack. Legitimate room and energy meter payloads
// never exceed 4-5 levels.
inline constexpr size_t MQTT_JSON_MAX_DEPTH = 16;

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

} // namespace daik
