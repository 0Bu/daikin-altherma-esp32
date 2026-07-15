#pragma once
// Split an MQTT broker URI into host + port + TLS flag. IDF-free and host-tested
// (test/test_logic.cpp) so the edge cases — default ports, a bare host, a scheme-only string, a
// trailing colon, an IPv6 literal — are asserted on the host instead of only discovered on-device.
//
// Used by the /set_mqtt save-time broker pre-flight (http_config.cpp): the parsed host/port feed the
// DNS lookup + TCP probe, and is_tls selects the CA-bundle path. The scheme/TLS policy mirrors
// mqtt_ha.cpp build_client() (mqtts://|wss:// => TLS; default 8883 for TLS, 1883 otherwise) so the
// pre-flight and the live bridge parse a broker identically.
#include <string>

namespace daik {

// Parse `uri` into (host, port, is_tls). Returns false if the host is empty or the explicit port is
// not a number. Accepts a bare `host[:port]` or a `mqtt(s)://` / `ws(s)://` URL. An IPv6 literal is
// parsed with its brackets intact (the caller's AF_INET resolve then rejects it) — never mis-split.
inline bool parse_mqtt_uri(const std::string& uri, std::string& host, int& port, bool& is_tls) {
    std::string s = uri;
    is_tls = false;
    if (s.rfind("mqtts://", 0) == 0 || s.rfind("wss://", 0) == 0) {
        is_tls = true;
    }
    size_t pos = s.find("://");
    if (pos != std::string::npos) {
        s = s.substr(pos + 3);
    }
    // Split off an explicit :port only when the trailing colon is NOT inside an IPv6 literal's
    // brackets (i.e. no ']' at/after it) — otherwise treat the whole remainder as the host and apply
    // the scheme's default port.
    size_t colon = s.find_last_of(':');
    if (colon != std::string::npos && s.find_first_of(']', colon) == std::string::npos) {
        host = s.substr(0, colon);
        try {
            port = std::stoi(s.substr(colon + 1));
        } catch (...) {
            return false;
        }
    } else {
        host = s;
        port = is_tls ? 8883 : 1883;
    }
    return !host.empty();
}

} // namespace daik
