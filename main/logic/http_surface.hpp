#pragma once
// HTTP trust-surface policy. The device serves its HTTP API on one of two very different surfaces:
//
//   SetupAp    — the fallback provisioning SoftAP (provisioning.cpp), which is WIFI_AUTH_OPEN: ANY
//                radio client in range can associate, with no credential. So only the routes needed
//                to join a network may be exposed there.
//   TrustedLan — the configured home network (STA). The full read/config/OTA/MCP API is exposed;
//                the security boundary is the LAN itself (docs/SECURITY.md, no auth/TLS by design).
//
// The bug this closes (F01): http_start() registered EVERY route regardless of mode, so on the open
// setup AP a nearby client could fetch /coredump or /diag (which can carry WiFi/MQTT secrets), read
// live state, and reach service configuration, OTA and MCP. Restricting the AP to the provisioning
// surface is what keeps the open radio from being a full control plane.
//
// Pure + host-tested (test/test_logic.cpp) so the boundary is asserted, not scattered across the
// registration call sites. http_common.cpp's http_register_on() gates each route through here; the
// captive catch-all ("/*") is registered on BOTH surfaces separately (it only ever serves the setup
// page / SPA shell, never data), so it is intentionally not listed below.
#include <string_view>

namespace daik {

enum class HttpSurface { SetupAp, TrustedLan };

// Does `surface` expose a route at `path` with the given method? On the trusted LAN, everything.
// On the open setup AP, ONLY: GET / , GET /index.html (setup.html), GET /favicon.ico (an inert
// static asset), and POST /set_wifi (submit credentials). Every other route —
// status/values/models/diag/coredump, the remaining /set_*
// config, /detect, OTA and MCP — is withheld: an unregistered GET falls through to the captive
// catch-all (the setup page, never data), and an unregistered POST simply 404s.
//
// /scan is trusted-LAN-only, not part of this surface: the portal takes the SSID as free text and
// never scans, so serving a survey of every AP in range (SSIDs + RSSI, i.e. a location fingerprint)
// to any unauthenticated client that associates would buy nothing back.
inline bool http_surface_serves(HttpSurface surface, std::string_view path, bool is_post) {
    if (surface == HttpSurface::TrustedLan) return true;
    if (is_post) return path == "/set_wifi";
    return path == "/" || path == "/index.html" || path == "/favicon.ico";
}

}  // namespace daik
