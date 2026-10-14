#pragma once
// Browser-facing HTTP request policy for the trusted-LAN server.
//
// The LAN is the device's authentication boundary, but a browser can be driven by a hostile page
// outside that LAN. DNS rebinding is the sharp case: the browser keeps the attacker's origin while
// its hostname is rebound to this device. Therefore the Host header is compared with identities the
// device actually owns (its fixed mDNS name and current WiFi/Ethernet IPv4 addresses), rather than
// comparing Origin with Host — the hostile pair would agree with itself. Origin and Fetch Metadata
// add independent browser signals. Native clients send neither and remain supported; when they do
// send Host, it must still name the device.
//
// Pure and allocation-free so the complete decision is host-tested. http_common.cpp only obtains
// bounded header values and supplies the live addresses.
#include <cstddef>
#include <string_view>

namespace daik {

inline bool http_ascii_iequal(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); ++i) {
        char ac = a[i], bc = b[i];
        if (ac >= 'A' && ac <= 'Z') ac = static_cast<char>(ac - 'A' + 'a');
        if (bc >= 'A' && bc <= 'Z') bc = static_cast<char>(bc - 'A' + 'a');
        if (ac != bc) return false;
    }
    return true;
}

inline bool http_authority_allowed(std::string_view authority, std::string_view hostname,
                                   std::string_view wifi_ip, std::string_view eth_ip) {
    if (authority.empty()) return false;
    if (authority.size() > 3 && authority.substr(authority.size() - 3) == ":80")
        authority.remove_suffix(3);
    // No other port, user-info, path or bracket syntax is a valid identity for this IPv4-only :80
    // server. Rejecting it here also keeps an attacker from hiding a suffix behind punctuation.
    if (authority.empty() || authority.find_first_of("/@[]:") != std::string_view::npos)
        return false;

    if (!hostname.empty()) {
        // Avoid allocating hostname + ".local" on the httpd task.
        constexpr std::string_view suffix = ".local";
        if (authority.size() == hostname.size() + suffix.size() &&
            http_ascii_iequal(authority.substr(0, hostname.size()), hostname) &&
            http_ascii_iequal(authority.substr(hostname.size()), suffix))
            return true;
    }
    return (!wifi_ip.empty() && authority == wifi_ip) ||
           (!eth_ip.empty() && authority == eth_ip);
}

inline bool http_origin_allowed(std::string_view origin, std::string_view hostname,
                                std::string_view wifi_ip, std::string_view eth_ip) {
    constexpr std::string_view scheme = "http://";
    if (origin.size() <= scheme.size() ||
        !http_ascii_iequal(origin.substr(0, scheme.size()), scheme))
        return false;
    return http_authority_allowed(origin.substr(scheme.size()), hostname, wifi_ip, eth_ip);
}

struct HttpRequestHeaders {
    std::string_view host;
    std::string_view origin;
    std::string_view fetch_site;
    bool host_present       = false;
    bool origin_present     = false;
    bool fetch_site_present = false;
};

inline bool http_lan_request_allowed(const HttpRequestHeaders& h, std::string_view hostname,
                                     std::string_view wifi_ip, std::string_view eth_ip) {
    const bool browser_signalled = h.origin_present || h.fetch_site_present;

    // HTTP/1.0/native probes may omit Host. A browser cannot: if it supplies any browser-only
    // signal, a missing Host is malformed and fails closed.
    if (!h.host_present) return !browser_signalled;
    if (!http_authority_allowed(h.host, hostname, wifi_ip, eth_ip)) return false;

    if (h.origin_present && !http_origin_allowed(h.origin, hostname, wifi_ip, eth_ip)) return false;
    if (h.fetch_site_present) {
        // `none` is a direct user navigation; same-site is harmless once Host is independently
        // pinned to the device. Cross-site and unknown future values fail closed.
        if (h.fetch_site != "same-origin" && h.fetch_site != "same-site" && h.fetch_site != "none")
            return false;
    }
    return true;
}

// Every POST with a body in this firmware is JSON. Requiring its real media type removes the
// CORS-safelisted text/plain/form shapes that can be emitted cross-origin without preflight.
inline bool http_json_content_type(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t')) value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    const std::size_t semi = value.find(';');
    std::string_view media = value.substr(0, semi);
    while (!media.empty() && (media.back() == ' ' || media.back() == '\t')) media.remove_suffix(1);
    if (!http_ascii_iequal(media, "application/json")) return false;
    if (semi == std::string_view::npos) return true;
    // A semicolon must introduce a non-empty parameter; its exact charset spelling is irrelevant to
    // cJSON, but accepting a bare separator would make malformed inputs look intentional.
    std::string_view params = value.substr(semi + 1);
    while (!params.empty() && (params.front() == ' ' || params.front() == '\t')) params.remove_prefix(1);
    return !params.empty();
}

// Only registered OTA paths may bypass the busy/low-heap guard. Unknown /ota/... GETs reach the
// SPA catch-all, so a prefix match would admit a dashboard asset beside the writer's TLS heap.
// When memory is low or an OTA update is actively downloading, all non-OTA routes
// are early-rejected with 503 so background browser polling doesn't fragment the TLS receive heap.
inline bool http_is_ota_route(std::string_view uri, bool is_post = false) {
    uri = uri.substr(0, uri.find('?'));
    if (is_post) return uri == "/ota/update";
    return uri == "/ota/status" || uri == "/ota/check" || uri == "/ota/changelog";
}

inline std::string_view http_accept_trim_ows(std::string_view value) {
    while (!value.empty() && (value.front() == ' ' || value.front() == '\t'))
        value.remove_prefix(1);
    while (!value.empty() && (value.back() == ' ' || value.back() == '\t')) value.remove_suffix(1);
    return value;
}

// Commas and semicolons inside quoted parameter values are not field separators.
inline std::string_view http_header_token(std::string_view& input, char delimiter) {
    bool        quoted = false, escaped = false;
    std::size_t end = 0;
    for (; end < input.size(); ++end) {
        const char c = input[end];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (quoted && c == '\\') {
            escaped = true;
            continue;
        }
        if (c == '"') {
            quoted = !quoted;
            continue;
        }
        if (!quoted && c == delimiter) break;
    }
    const std::string_view token = input.substr(0, end);
    input.remove_prefix(end < input.size() ? end + 1 : end);
    return http_accept_trim_ows(token);
}

// RFC 9110 qvalue: zero excludes a representation; values have at most three decimal places.
inline bool http_quality_nonzero(std::string_view value) {
    if (value.empty() || (value[0] != '0' && value[0] != '1')) return false;
    bool nonzero = value[0] == '1';
    if (value.size() == 1) return nonzero;
    if (value.size() > 5 || value[1] != '.') return false;
    for (std::size_t i = 2; i < value.size(); ++i) {
        if (value[i] < '0' || value[i] > '9' || (value[0] == '1' && value[i] != '0')) return false;
        nonzero = nonzero || value[i] != '0';
    }
    return nonzero;
}

// Only explicitly accepted, nonzero-weight media types select the MCP GET transport.
inline bool http_accepts_media_type(std::string_view accept, std::string_view wanted) {
    while (!accept.empty()) {
        std::string_view item = http_header_token(accept, ',');
        if (!http_ascii_iequal(http_header_token(item, ';'), wanted)) continue;
        bool accepted = true, seen_quality = false;
        while (!item.empty()) {
            const std::string_view parameter = http_header_token(item, ';');
            const std::size_t      equal     = parameter.find('=');
            if (!http_ascii_iequal(http_accept_trim_ows(parameter.substr(0, equal)), "q")) continue;
            if (seen_quality || equal == std::string_view::npos) {
                accepted = false;
                break;
            }
            seen_quality = true;
            accepted     = http_quality_nonzero(http_accept_trim_ows(parameter.substr(equal + 1)));
        }
        if (accepted) return true;
    }
    return false;
}

} // namespace daik
