#pragma once
// Captive setup portal: SoftAP "daikin-altherma-setup" + a DNS catch-all so any request opens
// www/setup.html (served gzipped from the embedded setup.html.gz). Runs when no WiFi is
// configured; POST /set_wifi persists creds and reboots into STA. Ported from
// tesla-key-esp32/provisioning.cpp.

namespace daik {

void provisioning_start_ap();

} // namespace daik
