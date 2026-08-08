#pragma once
// Captive setup portal: SoftAP "daikin-altherma-esp32-setup" + a DNS catch-all so any request opens
// www/setup.html (served gzipped from the embedded setup.html.gz). Runs when no WiFi is
// configured; POST /set_wifi persists creds and reboots into STA.

namespace daik {

void provisioning_start_ap();

// Is the OPEN setup SoftAP running right now? THE input to the HTTP trust surface
// (logic/http_surface.hpp's http_surface_for): the restricted route set exists because an
// unauthenticated radio client can associate, so it is this AP's existence that must decide —
// not the absence of a WiFi station, which a board carried by an Ethernet cable also has.
bool provisioning_ap_active();

} // namespace daik
