#pragma once
// Split an MQTT broker URI into host + port + TLS flag. IDF-free and host-tested
// (test/test_logic.cpp) so the edge cases — default ports, a bare host, a scheme-only string, a
// trailing colon, an IPv6 literal — are asserted on the host instead of only discovered on-device.
//
// Used by the /set_mqtt save-time broker pre-flight (http_config.cpp): the parsed host/port feed the
// DNS lookup + TCP probe, and is_tls selects the CA-bundle path. The scheme/TLS policy mirrors
// mqtt_ha.cpp build_client() (mqtts://|wss:// => TLS) so the pre-flight and the live bridge parse a
// broker identically.
//
// The scheme defaults MUST match what esp-mqtt itself assumes, because the pre-flight probes a port
// the CLIENT will later connect to: a divergence means a save either passes on a port nothing
// listens on or fails on a port the client never uses. esp-mqtt defaults ws://->80 and wss://->443
// (the WebSocket transports are plain HTTP(S) ports), NOT the 1883/8883 the raw-TCP transports use.
#include <string>

namespace daik {

// Parse `uri` into (host, port, is_tls). Returns false — with `err` (optional) set to a UI-ready
// reason — if the host is empty, the explicit port is not a plain number, or the port is outside the
// TCP range. Accepts a bare `host[:port]` or a `mqtt(s)://` / `ws(s)://` URL. An IPv6 literal is
// parsed with its brackets intact (the caller's AF_INET resolve then rejects it) — never mis-split.
inline bool parse_mqtt_uri(const std::string& uri, std::string& host, int& port, bool& is_tls,
                           const char** err = nullptr) {
    const auto fail = [&](const char* why) { if (err) *err = why; return false; };
    std::string s = uri;
    is_tls = false;
    const bool is_ws = s.rfind("ws://", 0) == 0 || s.rfind("wss://", 0) == 0;
    if (s.rfind("mqtts://", 0) == 0 || s.rfind("wss://", 0) == 0) {
        is_tls = true;
    }
    size_t pos = s.find("://");
    if (pos != std::string::npos) {
        s = s.substr(pos + 3);
    }
    // Drop any path BEFORE the port split, or it lands in the port field: `/mqtt` is the de-facto
    // standard path for MQTT-over-WebSocket (`wss://host:8084/mqtt`), so this is the normal shape of
    // a ws(s) broker, not an edge case. Only host/port are taken here — the caller hands esp-mqtt the
    // FULL uri (path included), so nothing is lost by trimming it off the pre-flight's copy.
    size_t slash = s.find('/');
    if (slash != std::string::npos) s = s.substr(0, slash);
    // Split off an explicit :port only when the trailing colon is NOT inside an IPv6 literal's
    // brackets (i.e. no ']' at/after it) — otherwise treat the whole remainder as the host and apply
    // the scheme's default port.
    size_t colon = s.find_last_of(':');
    if (colon != std::string::npos && s.find_first_of(']', colon) == std::string::npos) {
        host = s.substr(0, colon);
        const std::string port_str = s.substr(colon + 1);
        // Require ALL digits rather than leaning on stoi, which skips leading whitespace, accepts a
        // sign, and stops at the first non-digit (reporting "1883x" as 1883). esp-mqtt's own URL
        // parser accepts none of those — and a pre-flight that reads a port differently from the
        // client is exactly what this header exists to prevent.
        if (port_str.empty() || port_str.find_first_not_of("0123456789") != std::string::npos)
            return fail("Invalid port");
        try {
            port = std::stoi(port_str);
        } catch (...) {
            return fail("Invalid port");        // all digits but past int range
        }
        // Out of range is caught HERE, not at the socket: the probe's htons() truncates (:65537 ->
        // :1) and would happily report a wrong port reachable.
        if (port < 1 || port > 65535) return fail("Invalid port");
    } else {
        host = s;
        port = is_ws ? (is_tls ? 443 : 80) : (is_tls ? 8883 : 1883);
    }
    if (host.empty()) return fail("Invalid broker URI");
    return true;
}

} // namespace daik
