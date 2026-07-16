#pragma once
// WiFi credential-rollback policy (wifi.cpp). Pure, IDF-free, host-tested (test/test_logic.cpp).
//
// POST /set_wifi stashes the working credentials as a one-shot NVS backup and reboots into the new
// ones. Something then has to decide, on that next boot, what "still no IP" means: the new
// credentials are WRONG (restore the backup — the device must not be strandable from the LAN), or
// the network simply is not back YET (keep waiting). The original rule was a blind 30 s deadline,
// which gets the common case exactly backwards. Reconfiguring a router and then pointing the device
// at it is the main reason anyone changes these credentials at all, and a router takes 1-3 min to
// come back — many times the deadline. The deadline expired, the old SSID was restored for a network
// that no longer existed, and the correct new credentials were gone.
//
// The disconnect reason is what separates evidence from mere silence:
//   - The AP answered and refused us (auth/handshake class) — positive evidence the credentials are
//     wrong. Roll back at the deadline, as before.
//   - The SSID was never seen at all (NO_AP_FOUND) — no evidence about the credentials whatsoever.
//     An absent AP is exactly what a rebooting router looks like. Keep trying for a materially
//     longer grace window before spending credentials that may well be right.
//   - Nothing conclusive (no disconnect at all — associated, still waiting on DHCP; a congested
//     WPA3 + all-channel scan + first DHCP lease legitimately approaches 30 s) — also not evidence.
//     Same grace.
//
// A rollback is destructive: the new credentials are discarded and cannot be recovered. So absence
// of evidence must buy patience, never a rollback, and only the AP itself saying "no" is allowed to
// be fast. Being wrong in the patient direction costs a delayed rollback; being wrong in the other
// direction cost the credentials.
#include <cstdint>

namespace daik {

// What a WIFI_EVENT_STA_DISCONNECTED reason says about the CREDENTIALS — not about the link. Codes
// are the IDF's wifi_err_reason_t (the 200-range is Espressif-specific); they stay plain ints here
// so this header remains IDF-free and host-testable.
enum class DiscoClass : uint8_t {
    None,      // no disconnect seen yet — inconclusive (may be associated, waiting on DHCP)
    Auth,      // the AP was reached and refused/failed the credentials — they are wrong
    ApAbsent,  // the SSID was not found — says nothing at all about the credentials
    Other,     // beacon timeout, assoc fail, ... — inconclusive
};

inline DiscoClass disco_class(int reason) {
    switch (reason) {
        case 0:                            // no STA_DISCONNECTED observed this boot
            return DiscoClass::None;
        case 15:                           // 4WAY_HANDSHAKE_TIMEOUT — the PSK did not verify
        case 202:                          // AUTH_FAIL
        case 204:                          // HANDSHAKE_TIMEOUT
        case 210:                          // NO_AP_FOUND_W_COMPATIBLE_SECURITY
        case 211:                          // NO_AP_FOUND_IN_AUTHMODE
            return DiscoClass::Auth;
        case 201:                          // NO_AP_FOUND — the SSID was not on the air
        case 212:                          // NO_AP_FOUND_IN_RSSI_THRESHOLD — heard, but out of range
            return DiscoClass::ApAbsent;
        default:
            return DiscoClass::Other;
    }
}

// Boot connect window: how long wifi_start_sta() waits for the first IP before deciding. Unchanged
// for an ordinary boot (no credential change pending) — the setup portal is the fallback there and a
// user is standing in front of it.
inline constexpr int WIFI_BOOT_WINDOW_S = 30;

// Grace window for a PENDING credential change when nothing implicates the credentials. Sized past
// the 1-3 min a router takes to reboot — the scenario that made the blind deadline destroy valid
// credentials. Bounded rather than endless: an SSID that never appears (a typo'd name) must still
// fall back to the network we know works.
inline constexpr int WIFI_ROLLBACK_GRACE_S = 180;

// Consecutive checkpoints (~60 s) the AP must keep refusing us before the fast path spends the new
// credentials. Two, not one, for the reason link_watch.hpp acts on the second proven-silent probe
// rather than the first: the reason slot is a SAMPLE, and one sample cannot tell "these credentials
// are wrong" from "a transient SAE failure happened to be the last thing logged when we looked".
// Sustained refusal across two checkpoints can. Still well inside issue #47's "~1 boot cycle".
inline constexpr int WIFI_AUTH_TO_ROLLBACK = 2;

enum class RollbackAction : uint8_t { Wait, RollBack };

// Consecutive-observation counter, in the shape link_watch.hpp uses. Reset by any checkpoint whose
// story is NOT "the AP refused us".
struct RollbackWatch { int auth = 0; };

// Decide, at a boot-window checkpoint, whether to restore the backup credentials. Called only while
// a credential change is pending and the STA still has no IP.
//   last      — class of the CURRENT story: the most recent disconnect reason, or None once the STA
//               has re-associated (wifi.cpp clears the slot on STA_CONNECTED — an earlier refusal
//               must not outlive the association that disproved it)
//   elapsed_s — seconds since the STA started
inline RollbackAction rollback_step(RollbackWatch& s, DiscoClass last, int elapsed_s) {
    // Before the ordinary window is even up, nothing is decided — not even for the auth class. Those
    // reasons (15/204/202) double as the transient WPA3-SAE failures wifi.cpp works around with
    // failure_retry_cnt/sae_pwe_h2e, so no early one may spend the new credentials.
    if (elapsed_s < WIFI_BOOT_WINDOW_S) return RollbackAction::Wait;

    if (last == DiscoClass::Auth) {
        if (++s.auth >= WIFI_AUTH_TO_ROLLBACK) return RollbackAction::RollBack;  // sustained "no"
    } else {
        s.auth = 0;   // anything else is not the AP refusing us — the streak is broken
    }
    // Nothing implicates the credentials (or not yet often enough): keep looking until the grace is
    // spent. This is the only path an absent SSID can ever take.
    return elapsed_s >= WIFI_ROLLBACK_GRACE_S ? RollbackAction::RollBack : RollbackAction::Wait;
}

} // namespace daik
