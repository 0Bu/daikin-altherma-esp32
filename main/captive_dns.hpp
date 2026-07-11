#pragma once
// Captive-portal DNS: a tiny UDP :53 responder that resolves EVERY name to the SoftAP address
// (192.168.4.1), so a phone joining the setup AP has its connectivity probe (captive.apple.com,
// connectivitycheck.gstatic.com, msftconnecttest.com, …) redirected to the on-device setup page —
// which makes the OS auto-open the captive-portal window. Started only in SoftAP setup mode
// (provisioning.cpp); a no-op once WiFi is configured.

namespace daik {

void captive_dns_start();

} // namespace daik
