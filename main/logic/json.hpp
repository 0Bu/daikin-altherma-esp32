#pragma once
// RFC 8259 JSON string encoding — the ONE encoder every JSON payload this firmware emits goes
// through: /status, /values and /scan (http_status.cpp's jstr), the MQTT source-value topics
// (mqtt_group.hpp), the heartbeat (heartbeat.hpp) and the crash topic (crashinfo.hpp). IDF-free
// and host-tested, because the strings it encodes are NOT all ours — an SSID is arbitrary
// attacker-chosen bytes (any AP in radio range), and a device string carries whatever the bus or
// a config write put there.
//
// RFC 8259 §7 requires escaping '"', '\' AND every control character below 0x20. Escaping only the
// first two — as this encoder did before — let an AP named "Free<LF>WiFi" put a raw newline inside
// a JSON string, so the whole payload fails JSON.parse ("Bad control character in string literal").
// Historically that broke the setup portal, which parsed GET /scan to fill an SSID dropdown; the
// portal now takes a TYPED SSID and fetches nothing, but the hostile bytes did not go away — they
// still reach the dashboard through /status.wifi.ssid (the associated AP names itself) and /scan,
// where one unparseable field takes down the ENTIRE response, not just that field.
//
// This sits BENEATH the DOM escaping of any SSID that is rendered (issue #52, fixed in #65 — the
// dashboard's esc()). The two are orthogonal and neither subsumes the other: #65 stops a hostile
// SSID from being interpolated as MARKUP, while this encoder only guarantees the bytes PARSE as
// JSON — an SSID of `"><script>` is already valid JSON here, and conversely a body that fails
// JSON.parse never reaches those DOM nodes at all. Do not read a fix on either layer as covering
// the other.
#include <string>
#include <string_view>

namespace daik {

// Append `s` to `out` as the INSIDE of a JSON string (callers supply the quotes), escaping the
// full RFC 8259 set. Everything from 0x20 up other than '"' and '\' passes through verbatim —
// including 0x7F (DEL), which the RFC does NOT require escaping, and raw UTF-8, whose bytes are
// legal unescaped and must survive intact for an SSID like "Café".
template <typename JsonOut>
inline void json_append_escaped(JsonOut& out, std::string_view s) {
    static const char hex[] = "0123456789abcdef";
    for (const char c : s) {
        // MUST be unsigned: `char` is signed on both xtensa and the host, so a UTF-8 lead byte
        // like 0xC3 tests as -61 and a signed `c < 0x20` would mangle every non-ASCII SSID.
        const unsigned char u = static_cast<unsigned char>(c);
        switch (u) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (u < 0x20) {                  // no shorthand form -> \u00XX (RFC 8259 §7)
                    out += "\\u00";
                    out += hex[u >> 4];
                    out += hex[u & 0x0F];
                } else {
                    out += c;
                }
        }
    }
}

// Append `s` as a complete quoted JSON string to either std::string or a bounded streaming sink.
// Keeping the escaping here prevents a transport-specific serializer from drifting from RFC 8259.
template <typename JsonOut>
inline void json_append_quoted(JsonOut& out, std::string_view s) {
    out += '"';
    json_append_escaped(out, s);
    out += '"';
}

// A byte counter exposing the same `operator+=` surface as std::string and BoundedChunkSink, so the
// ESCAPING template above can run against it unchanged: `json_escaped_size` reuses the one encoder
// instead of keeping a parallel escape table that could drift from it. The X10A publish path uses
// this for its exact-size counting pass before writing into a once-allocated buffer
// (logic/mqtt_group.hpp) — a payload whose size was counted by different rules than the bytes that
// follow it would realloc mid-write, which is the doubling churn the counting pass exists to remove.
struct CountingOut {
    size_t n = 0;

    CountingOut& operator+=(char) {
        ++n;
        return *this;
    }
    CountingOut& operator+=(const char* s) {
        while (*s != '\0') {
            ++n;
            ++s;
        }
        return *this;
    }
    CountingOut& operator+=(const std::string& s) {
        n += s.size();
        return *this;
    }
    CountingOut& operator+=(std::string_view s) {
        n += s.size();
        return *this;
    }
};

// A non-owning, fixed-capacity byte sink with the same append surface as std::string. The caller
// provides `capacity + 1` bytes so this can keep a trailing NUL for C APIs without counting it as
// payload. An overflow is sticky and writes no partial fragment; callers can therefore count first,
// append once, and fail closed without a heap allocation or a truncated JSON document.
class BoundedJsonBuffer {
public:
    BoundedJsonBuffer(char* storage, size_t capacity)
        : storage_(storage), capacity_(capacity) {
        clear();
    }

    void clear() {
        size_ = 0;
        overflowed_ = false;
        if (storage_) storage_[0] = '\0';
    }

    BoundedJsonBuffer& operator+=(char c) {
        append(std::string_view(&c, 1));
        return *this;
    }
    BoundedJsonBuffer& operator+=(const char* s) {
        append(s ? std::string_view(s) : std::string_view{});
        return *this;
    }
    BoundedJsonBuffer& operator+=(const std::string& s) {
        append(s);
        return *this;
    }
    BoundedJsonBuffer& operator+=(std::string_view s) {
        append(s);
        return *this;
    }

    const char* c_str() const { return storage_ ? storage_ : ""; }
    const char* data() const { return c_str(); }
    size_t size() const { return size_; }
    size_t capacity() const { return capacity_; }
    bool overflowed() const { return overflowed_; }

private:
    void append(std::string_view s) {
        if (overflowed_) return;
        if (!storage_ || s.size() > capacity_ - size_) {
            overflowed_ = true;
            return;
        }
        for (const char c : s) storage_[size_++] = c;
        storage_[size_] = '\0';
    }

    char*  storage_ = nullptr;
    size_t capacity_ = 0;
    size_t size_ = 0;
    bool   overflowed_ = false;
};

// Exact encoded byte counts, allocation-free, using the same template instantiation that writes the
// real bytes. `json_quoted_size` includes the surrounding quotes (RFC 8259 §7 string = quotes +
// inside).
inline size_t json_escaped_size(std::string_view s) {
    CountingOut out;
    json_append_escaped(out, s);
    return out.n;
}

inline size_t json_quoted_size(std::string_view s) { return json_escaped_size(s) + 2; }

// `s` as a complete, quoted JSON string — the owning whole-value form of the above.
inline std::string json_quote(std::string_view s) {
    std::string o;
    o.reserve(s.size() + 2);                     // exact for the common escape-free case
    json_append_quoted(o, s);
    return o;
}

} // namespace daik
