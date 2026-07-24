#pragma once
// Captive-portal reply policy: what the ONE catch-all route ("/*", http_status.cpp) answers with.
//
// The portal only auto-pops if the joining device's OS connectivity probe is answered the way that
// OS recognises. Every OS probes a well-known URL over plain HTTP right after associating:
//
//   iOS/macOS  GET http://captive.apple.com/hotspot-detect.html   expects a body of "Success"
//   Android    GET http://connectivitycheck.gstatic.com/generate_204   expects 204 + empty body
//   Windows    GET http://www.msftconnecttest.com/connecttest.txt  expects "Microsoft Connect Test"
//
// captive_dns.cpp points all three names at us, so the probe lands on the catch-all. The bug this
// closes: the catch-all served the setup PAGE (200 + the gzip-compressed setup.html) to those
// probes. That is not what any of the three agents look for — they are not browsers:
//
//   * A 302 with a Location header is the one signal all three understand as "you are behind a
//     portal". A 200 carrying a body is only a heuristic fallback, and Android additionally runs a
//     parallel HTTPS probe it cannot reach here, so a 200 could leave it undecided rather than
//     showing the sign-in prompt.
//   * Content-Encoding: gzip was set unconditionally (http_common.cpp's http_send_gzip). The probe
//     agents are minimal HTTP clients, not the WebKit view that later renders the portal. A
//     redirect has an EMPTY body, which takes gzip off the probe path entirely — the page itself is
//     still served compressed to the real browser that follows the redirect.
//
// So: in setup mode every unmatched GET redirects to the portal root, and only the portal root
// itself serves the page. In STA mode nothing changes — the catch-all is the dashboard's SPA shell
// there, and turning a deep link into a redirect would break it.
//
// Pure + host-tested (test/test_logic.cpp) rather than an `if` inside the handler, because the
// STA-mode carve-out is the part that is easy to regress and impossible to notice: a portal that
// stops popping is reported, a dashboard deep link that starts redirecting is not.
#include <string_view>

namespace daik {

// The SoftAP's own address, in the two forms the firmware needs it. Declared here so the four
// places that advertise it cannot drift apart: the DNS A-record answer and the DHCP server's own
// address use the OCTETS, the HTTP Location header and the RFC 8910 option-114 payload use the
// URI. A redirect pointing somewhere the DNS does not answer for is a dead end, and nothing would
// catch it — so the literal is written once, here.
inline constexpr unsigned char CAPTIVE_PORTAL_OCTETS[4] = {192, 168, 4, 1};
inline constexpr const char*   CAPTIVE_PORTAL_IP        = "192.168.4.1";
inline constexpr const char*   CAPTIVE_PORTAL_URI       = "http://192.168.4.1/";

enum class CaptiveReply {
    Page,      // serve the HTML (setup page in AP mode, dashboard shell in STA mode)
    Redirect,  // 302 -> CAPTIVE_PORTAL_URI
};

// `setup_mode` = a SoftAP is live (WIFI_MODE_AP/APSTA), i.e. this is the provisioning portal.
// The portal root stays a Page even though it is registered as its own route: the catch-all is
// registered last so it should never see "/", and a redirect loop if it ever did would be far
// worse than the redundant check costs.
inline CaptiveReply captive_reply_for(std::string_view path, bool setup_mode) {
    if (!setup_mode) return CaptiveReply::Page;
    if (path == "/" || path == "/index.html") return CaptiveReply::Page;
    return CaptiveReply::Redirect;
}

}  // namespace daik
