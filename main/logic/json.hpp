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
inline void json_append_escaped(std::string& out, std::string_view s) {
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

// `s` as a complete, quoted JSON string — the whole-value form of the above.
inline std::string json_quote(std::string_view s) {
    std::string o;
    o.reserve(s.size() + 2);                     // exact for the common escape-free case
    o += '"';
    json_append_escaped(o, s);
    o += '"';
    return o;
}

} // namespace daik
