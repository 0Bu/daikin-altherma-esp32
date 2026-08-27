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

} // namespace daik
