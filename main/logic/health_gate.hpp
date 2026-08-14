#pragma once
// OTA rollback health-gate decision. IDF-free + host-tested. ota_update.cpp arms this only for an
// image the bootloader booted in PENDING_VERIFY state (i.e. one installed via esp_ota_* — a real
// OTA). Such an image stays rollback-armed until it calls esp_ota_mark_app_valid_cancel_rollback();
// if it reboots before that, the bootloader reverts to the previous slot. This header decides WHEN
// to make that call, so a boots-but-broken update (e.g. a network regression that never gets online
// and so can never be re-flashed OTA) is left un-committed and reverts on the next reboot, instead of
// being sealed in as "valid" the moment it merely survives a timer. See docs/SECURITY.md → Boot
// recovery. USB/@flash_args images boot in UNDEFINED state (blank otadata), never PENDING_VERIFY, so
// none of this runs for them — the gate cannot strand a fresh board (which has no previous slot).
#include <cstdint>

#include "net_link.hpp"

namespace daik {

enum class HealthVerdict {
    Wait,    // keep observing; not enough evidence either way yet
    Commit,  // proven healthy -> cancel rollback, seal this image in as valid
    GiveUp,  // no health within the hard cap -> leave PENDING_VERIFY; a reboot rolls back
};

// Decide the health verdict for a PENDING_VERIFY image.
//   elapsed_s      seconds this image has been running (monotonic uptime since boot)
//   base_window_s  minimum uptime before committing even a healthy image — survives an early
//                  crash-loop (a crash inside this window reboots -> bootloader rolls back)
//   hard_cap_s     stop waiting after this; if still unhealthy -> GiveUp (must be > base_window_s)
//   link             active IP transport; either WiFi OR Ethernet proves connectivity
//   recovery_surface  the captive setup AP is actually running in this boot
//
// "healthy" = connectivity proven on either transport OR a recovery surface that is truly up.
// Deriving setup mode from "no stored SSID" is wrong for a wired boot: that path deliberately keeps
// the AP off, and if the lease disappears before the base window it has neither transport nor
// portal. Passing the observed AP state keeps that image rollback-armed. Using NetLink rather than
// a WiFi-shaped bool also makes the wired-lease + stored-SSID case part of the type-level contract.
inline HealthVerdict health_gate_decide(int elapsed_s, int base_window_s, int hard_cap_s,
                                        NetLink link, bool recovery_surface) {
    const bool healthy = link != NetLink::None || recovery_surface;
    if (elapsed_s >= base_window_s && healthy) return HealthVerdict::Commit;
    if (elapsed_s >= hard_cap_s)               return HealthVerdict::GiveUp;
    return HealthVerdict::Wait;
}

} // namespace daik
