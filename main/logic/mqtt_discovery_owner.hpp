#pragma once
// Bounded, allocation-free ownership checks for retained HA discovery in preserved namespaces.
// Ownership is a commissioning boundary, not an atomic MQTT compare-and-swap: one installation
// owns a raw base, and the broker must replay its retained configs before discovery is admitted.
#include "ota_manifest.hpp"
#include <string_view>

namespace daik {

inline bool mqtt_preserved_discovery_base(std::string_view base) noexcept {
    return base == "daikin-altherma-esp32" || base == "daikin-altherma-esp32-bench";
}

// HA's complete discovery shape, including retired source-specific Modbus nodes. Unknown objects
// and components still matter: a foreign config anywhere in this namespace blocks all mutation.
inline bool mqtt_discovery_namespace_topic(std::string_view topic, std::string_view prefix,
                                           std::string_view node) noexcept {
    if (prefix.empty() || node.empty()) return false;
    if (topic.size() <= prefix.size() || topic.substr(0, prefix.size()) != prefix ||
        topic[prefix.size()] != '/')
        return false;
    topic.remove_prefix(prefix.size() + 1);
    const size_t component = topic.find('/');
    if (component == 0 || component == std::string_view::npos) return false;
    topic.remove_prefix(component + 1);
    const size_t node_end = topic.find('/');
    if (node_end == std::string_view::npos) return false;
    const auto actual_node = topic.substr(0, node_end);
    const bool modbus      = actual_node.size() == node.size() + 7 &&
                        actual_node.substr(0, node.size()) == node &&
                        actual_node.substr(node.size()) == "_modbus";
    if (actual_node != node && !modbus) return false;
    topic.remove_prefix(node_end + 1);
    const size_t object = topic.find('/');
    return object != 0 && object != std::string_view::npos && topic.substr(object) == "/config";
}

namespace discovery_owner_detail {
using View = std::string_view;

// Relevant strings deliberately accept the publisher's raw UTF-8 and simple JSON escapes. Unicode
// escapes and HA's '~' shorthand cannot establish an exact raw-base identity and require migration.
inline bool string_byte(View value, size_t& i, char& out) noexcept {
    if (i >= value.size()) return false;
    out = value[i++];
    if (out != '\\') return static_cast<unsigned char>(out) >= 0x20;
    if (i >= value.size()) return false;
    const char escaped = value[i++];
    switch (escaped) {
    case '"':
        out = '"';
        return true;
    case '\\':
        out = '\\';
        return true;
    case '/':
        out = '/';
        return true;
    default:
        return false;
    }
}

inline bool equals(View encoded, View expected) noexcept {
    size_t i = 0, j = 0;
    char   byte;
    while (i < encoded.size()) {
        if (!string_byte(encoded, i, byte) || j == expected.size() || byte != expected[j++])
            return false;
    }
    return j == expected.size();
}

inline bool topic_equals(View encoded, View base, View suffix) noexcept {
    size_t i = 0, j = 0;
    char   byte;
    while (i < encoded.size()) {
        if (!string_byte(encoded, i, byte) || byte == '~') return false;
        if (j < base.size()) {
            if (byte != base[j]) return false;
        } else if (j - base.size() >= suffix.size() || byte != suffix[j - base.size()])
            return false;
        ++j;
    }
    return j == base.size() + suffix.size();
}

inline bool topic_owned(View encoded, View base, bool availability) noexcept {
    // An arbitrary descendant is not ownership: an old base such as '<base>/温度' can collapse to
    // the preserved node too. Match complete known source suffixes, never merely base + '/'.
    if (availability) {
        for (View suffix : {"/status", "/x10a/status", "/env3", "/modbus/status"})
            if (topic_equals(encoded, base, suffix)) return true;
    } else {
        for (View suffix :
             {"/x10a", "/state", "/modbus", "/heartbeat", "/crash", "/env3", "/weather_forecast",
              "/weather/forecast", "/weather/openmeteo/forecast"})
            if (topic_equals(encoded, base, suffix)) return true;
    }
    return false;
}

struct Parser {
    const char* json;
    size_t      len, pos = 0;
    View        base, node, board;
    bool        state_seen = false, device_seen = false;

    bool string(View& out) noexcept {
        detail::skip_ws(json, len, pos);
        size_t start, end, next;
        if (!detail::scan_string(json, len, pos, start, end, next)) return false;
        out = View(json + start, end - start);
        pos = next;
        return true;
    }
    bool token(char c) noexcept {
        detail::skip_ws(json, len, pos);
        if (pos == len || json[pos] != c) return false;
        ++pos;
        return true;
    }
    bool key(View& out) noexcept {
        if (!string(out)) return false;
        size_t i = 0;
        char   byte;
        while (i < out.size())
            if (!string_byte(out, i, byte)) return false;
        return true;
    }
    bool end(char c) noexcept {
        detail::skip_ws(json, len, pos);
        if (pos == len || json[pos] != c) return false;
        ++pos;
        return true;
    }
    bool owned_topic(bool availability = false) noexcept {
        View value;
        return string(value) && topic_owned(value, base, availability);
    }
    bool identifiers() noexcept {
        if (!token('[')) return false;
        bool match = false;
        if (end(']')) return false;
        do {
            View id;
            if (!string(id)) return false;
            const bool modbus = id.size() == node.size() + 7 && id.substr(0, node.size()) == node &&
                                id.substr(node.size()) == "_modbus";
            match |= equals(id, node) || modbus || (!board.empty() && equals(id, board));
            if (end(']')) return match;
        } while (token(','));
        return false;
    }
    bool device() noexcept {
        if (!token('{')) return false;
        bool ids_seen = false;
        if (end('}')) return false;
        do {
            View key;
            if (!this->key(key) || !token(':')) return false;
            if (equals(key, "ids") || equals(key, "identifiers")) {
                if (ids_seen || !identifiers()) return false;
                ids_seen = true;
            } else if (!detail::skip_json_value(json, len, pos, 1))
                return false;
            if (end('}')) return ids_seen;
        } while (token(','));
        return false;
    }
    bool availability_entry() noexcept {
        if (!token('{')) return false;
        bool topic_seen = false;
        if (end('}')) return false;
        do {
            View key;
            if (!this->key(key) || !token(':')) return false;
            if (equals(key, "topic")) {
                if (topic_seen || !owned_topic(true)) return false;
                topic_seen = true;
            } else if (!detail::skip_json_value(json, len, pos, 2))
                return false;
            if (end('}')) return topic_seen;
        } while (token(','));
        return false;
    }
    bool availability() noexcept {
        if (!token('[') || end(']')) return false;
        do {
            if (!availability_entry()) return false;
            if (end(']')) return true;
        } while (token(','));
        return false;
    }
    bool parse() noexcept {
        if (!json || !token('{') || end('}')) return false;
        bool availability_seen = false;
        do {
            View key;
            if (!this->key(key) || !token(':')) return false;
            if (equals(key, "~")) return false;
            if (equals(key, "stat_t") || equals(key, "state_topic")) {
                if (state_seen || !owned_topic()) return false;
                state_seen = true;
            } else if (equals(key, "dev") || equals(key, "device")) {
                if (device_seen || !device()) return false;
                device_seen = true;
            } else if (equals(key, "avty_t") || equals(key, "availability_topic")) {
                if (availability_seen || !owned_topic(true)) return false;
                availability_seen = true;
            } else if (equals(key, "avty") || equals(key, "availability")) {
                if (availability_seen || !availability()) return false;
                availability_seen = true;
            } else if (!detail::skip_json_value(json, len, pos, 1))
                return false;
            if (end('}')) {
                detail::skip_ws(json, len, pos);
                return pos == len && state_seen && device_seen;
            }
        } while (token(','));
        return false;
    }
};
} // namespace discovery_owner_detail

inline bool mqtt_discovery_payload_owned(const char* json, size_t length, std::string_view base,
                                         std::string_view node, std::string_view board) noexcept {
    return discovery_owner_detail::Parser{json, length, 0, base, node, board}.parse();
}

} // namespace daik
