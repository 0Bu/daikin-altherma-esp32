#pragma once
// OTA rollback health-gate decision. IDF-free + host-tested. ota_update.cpp arms this only for an
// image the bootloader booted in PENDING_VERIFY state (i.e. one installed via esp_ota_* — a real
// OTA). Such an image stays rollback-armed until it calls esp_ota_mark_app_valid_cancel_rollback();
// if it reboots before that, the bootloader reverts to the previous slot. This header decides WHEN
// to make that call, so a boots-but-broken update (e.g. a network regression that never gets online
// and so can never be re-flashed OTA) is left un-committed and reverts on the next reboot, instead
// of being sealed in as "valid" the moment it merely survives a timer. See docs/SECURITY.md → Boot
// recovery. Blank/no-record otadata (the ordinary USB bootstrap case) is reported by IDF as a state
// read error, never PENDING_VERIFY; ota_update.cpp latches that as Unknown and does not run this
// verdict. The gate therefore cannot strand a fresh board (which has no previous slot), while the
// public status also avoids inventing a known-safe rollback state.
#include <cstddef>
#include <cstdint>

#include "net_link.hpp"

namespace daik {

enum class HealthVerdict {
    Wait,    // keep observing; not enough evidence either way yet
    Commit,  // proven healthy -> cancel rollback, seal this image in as valid
    GiveUp,  // no health within the hard cap -> leave PENDING_VERIFY; a reboot rolls back
};

// A connected socket is necessary but no longer sufficient evidence for committing an OTA image.
// dev.13 stayed online while its boot-long X10A buffers fragmented internal RAM until /status
// returned 503, so the old link-only gate sealed a broken image in as valid. Keep the extra facts
// primitive and allocation-free: ota_update.cpp samples them without constructing a status JSON.
struct OtaServiceHealth {
    NetLink link = NetLink::None;
    bool recovery_surface = false;
    bool heap_ready = false;
    bool allocation_failures = false;
    bool x10a_required = false;
    bool x10a_published = false;
};

constexpr size_t OTA_HEALTH_MIN_FREE_BYTES = 24u * 1024u;
constexpr size_t OTA_HEALTH_MIN_LARGEST_BLOCK_BYTES = 16u * 1024u;

inline bool ota_health_heap_ready(size_t free_bytes, size_t largest_free_block) {
    return free_bytes >= OTA_HEALTH_MIN_FREE_BYTES &&
           largest_free_block >= OTA_HEALTH_MIN_LARGEST_BLOCK_BYTES;
}

// Decide the health verdict for a PENDING_VERIFY image.
//   elapsed_s      seconds this image has been running (monotonic uptime since boot)
//   base_window_s  minimum uptime before committing even a healthy image — survives an early
//                  crash-loop (a crash inside this window reboots -> bootloader rolls back)
//   hard_cap_s     stop waiting after this; if still unhealthy -> GiveUp (must be > base_window_s)
//   service           link/recovery evidence plus heap and X10A-publish proof
//
// "healthy" = a recovery surface that is truly up, OR connectivity plus enough contiguous heap,
// no allocation-failure cycle, and (when live X10A + configured MQTT make it possible) one
// accepted retained publish.
// Deriving setup mode from "no stored SSID" is wrong for a wired boot: that path deliberately keeps
// the AP off, and if the lease disappears before the base window it has neither transport nor
// portal. Passing the observed AP state keeps that image rollback-armed. Using NetLink rather than
// a WiFi-shaped bool also makes the wired-lease + stored-SSID case part of the type-level contract.
inline HealthVerdict health_gate_decide(int elapsed_s, int base_window_s, int hard_cap_s,
                                        const OtaServiceHealth& service) {
    const bool x10a_ready = !service.x10a_required || service.x10a_published;
    const bool normal_service = service.link != NetLink::None && service.heap_ready &&
                                !service.allocation_failures && x10a_ready;
    const bool healthy = service.recovery_surface || normal_service;
    if (elapsed_s >= base_window_s && healthy) return HealthVerdict::Commit;
    if (elapsed_s >= hard_cap_s)               return HealthVerdict::GiveUp;
    return HealthVerdict::Wait;
}

} // namespace daik
