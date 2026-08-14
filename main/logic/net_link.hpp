#pragma once
// WHICH TRANSPORT carries this device's IP, and what the firmware may do about it — the pure half
// of the optional W5500 Ethernet link (net.cpp).
//
// Until this existed the firmware had exactly one network predicate, and it was WiFi-shaped:
// wifi_info().connected. "The link is up" and "the radio is associated" were one sentence, which
// is true on every board this project shipped to and silently wrong on the first one with a cable.
// Four rules live here rather than as `if`s inside the boot sequence, and each is here because
// getting it wrong is invisible on the desk and expensive in a utility room:
//
//   1. net_link_active() — who carries the route when BOTH transports hold a lease. The wire wins.
//   2. net_wifi_start_needed() / net_portal_needed() — the boot fork. A WIRED board must not be
//      sent to a captive setup AP it has no reason to run: the portal exists to collect
//      credentials, and a device already on the LAN needs none. This is also the rule that keeps
//      the HTTP trust surface honest — see http_surface.hpp, whose input is "is the setup AP
//      running", not "is the radio in station mode".
//   3. net_eth_boot_ready() / net_eth_fallback_watch_needed() / net_eth_fallback_step() — keep
//      the lease event, the boot verdict and the later cable-loss recovery as three explicit
//      states. The recovery answer is a deliberate REBOOT, not a shortcut: see the functions.
//   4. net_eth_probe_allowed() — whether the SPI identity probe may drive those four pads at all.
//      The probe writes a clock and a chip-select; on a board where the user has put the X10A UART
//      on GPIO5/6 (a documented AtomS3 Lite alternative, docs/BOARDS.md) that is a transmitter
//      driving the heat pump's service bus. Refusing to probe is the only safe answer, and it
//      costs a board with no W5500 exactly nothing.
//
// IDF-free and Kconfig-free like every other logic/ header: the four GPIO numbers are the CALLER's
// (net.cpp reads CONFIG_DAIKIN_ETH_SPI_*), so this file can be host-tested against pins no board
// here has.
#include <cstdint>

#include "board_pins.hpp"

namespace daik {

// Which transport currently carries the default route. `None` is not an error — it is the normal
// first seconds of a boot, and the state a board with no cable and no credentials stays in while
// its setup portal is up.
//
// Deliberately not a bool: /status has to NAME the transport for a remote triage, and the two
// differ in what can even be reported about them (an RSSI and a BSSID exist only for one, a
// negotiated speed and duplex only for the other).
enum class NetLink : uint8_t { None = 0, Wifi = 1, Eth = 2 };

inline const char* net_link_str(NetLink k) {
    switch (k) {
        case NetLink::Wifi: return "wifi";
        case NetLink::Eth:  return "eth";
        default:            return "none";
    }
}

// Which transport carries the route when both lease flags are known. BOTH can be held at once: a
// board whose W5500 found no lease at boot falls back to WiFi with the Ethernet driver still
// running, so a cable plugged in later brings the wire up ALONGSIDE the radio.
//
// Ethernet wins whenever it has a lease. lwIP does NOT agree by default — ESP-IDF ships
// WIFI_STA_DEF at route_prio 100 and ETH_DEF at 50 — so net.cpp raises the Ethernet netif's
// priority when it creates it. That governs the DEFAULT route, i.e. off-link traffic; on-link
// traffic follows netif_list order whatever this says. This function decides what the DEVICE
// reports about itself (/status.net, the heartbeat, the indicator), and those must agree with each
// other regardless of what the routing table does with same-subnet peers.
inline NetLink net_link_active(bool eth_lease, bool wifi_lease) {
    if (eth_lease)  return NetLink::Eth;
    if (wifi_lease) return NetLink::Wifi;
    return NetLink::None;
}

// ── The boot fork ────────────────────────────────────────────────────────────────────────────
// Read these two together; they partition one decision and are separate only because the boot
// sequence learns their inputs at different moments (the wire answers in seconds, WiFi takes a
// window).

// Should the WiFi station be started at all this boot? No, when the wire already holds a lease:
// starting the radio anyway would spend ~50 KB of heap on a board whose binding limit is the
// largest CONTIGUOUS free block, and put a second netif on the same subnet for nothing. The cost
// of NOT starting it is that a pulled cable has no live radio to fall back to — which is exactly
// what net_eth_fallback_step() below is for, and it is the cheaper half of the trade: pulling the
// cable is a deliberate act, while the heap is spent on every boot forever.
inline bool net_wifi_start_needed(bool eth_lease, bool wifi_configured) {
    return wifi_configured && !eth_lease;
}

// Should the captive setup portal be opened? Only when NO transport came up. `wifi_up` is what
// wifi_start_sta() returned (false when it was never started, or when the first-boot budget was
// spent on credentials that do not work).
//
// The eth_lease term is the load-bearing one and it is why this is a function: a wired board with
// no stored SSID reaches this point with wifi_up == false, and the pre-Ethernet code would have
// opened an OPEN SoftAP on it — permanently, since nobody is coming to configure a device that is
// already reachable. That AP is not merely useless: while it is up the HTTP server serves the
// restricted provisioning surface (logic/http_surface.hpp), so the full API would be withheld from
// the wire the user is actually using.
inline bool net_portal_needed(bool eth_lease, bool wifi_up) {
    return !eth_lease && !wifi_up;
}

// A GOT_IP event is only a wake-up, not a permanent lease. The event bit is cleared on LOST_IP and
// link-down in net.cpp, but the event-loop and boot tasks can still interleave between the wait and
// this verdict. Requiring the current lease as well prevents a stale local EventBits_t snapshot
// from carrying the boot after the address has already gone away.
inline bool net_eth_boot_ready(bool got_ip_event, bool eth_lease) {
    return got_ip_event && eth_lease;
}

// Whether to create the cable-loss watcher is a BOOT-PROVENANCE question, not a current-lease
// question. The lease can disappear in the small interval after net_eth_start() returns true and
// before main.cpp creates the watcher. Remembering that Ethernet carried the boot closes that race:
// a loss in the interval still earns the normal grace-counted reboot onto configured WiFi.
inline bool net_eth_fallback_watch_needed(bool eth_present, bool eth_carried_boot) {
    return eth_present && eth_carried_boot;
}

// ── Losing the wire ──────────────────────────────────────────────────────────────────────────
// A board that came up wired has no WiFi station running (net_wifi_start_needed above). When the
// cable is pulled it therefore has no transport at all, and no way to grow one: wifi_start_sta()
// blocks for a boot window, writes the mDNS/watchdog setup a running system already did, and can
// fail into a setup portal — none of which is safe to do from an event handler on a live device.
//
// So the answer is a deliberate REBOOT, and it is defensible precisely here: the boot sequence
// already contains the whole decision (no cable → WiFi → portal), it is re-run from scratch, and
// this project's own history now survives it (the trend rings live in .noinit across a reset that
// keeps power — logic/history_persist.hpp). A reboot costs ~5 s of an outage that has already
// started. The alternative, growing a station at runtime, duplicates the boot fork in a second
// place where it can drift.
//
// It is GRACE-COUNTED rather than immediate for the reason every watchdog in this firmware is: a
// switch rebooting, a cable reseated, or a PoE injector power-cycling all look exactly like a
// pulled cable for a few seconds, and rebooting on each would turn a 3-second blip into a
// 15-second one, repeatedly.
inline constexpr int ETH_FALLBACK_PERIOD_S   = 5;   // how often net.cpp samples this
inline constexpr int ETH_FALLBACK_PERIODS    = 6;   // ~30 s of proven silence before acting

struct EthFallbackWatch {
    int down_periods = 0;
};

enum class EthFallbackAction : uint8_t {
    Idle,      // nothing to do — the wire is up, or a live radio already carries the device
    Wait,      // the wire is down and we are counting toward a restart
    Restart,   // proven gone, and there IS a configured network to come back on
};

// One sample. `wifi_running` means a WiFi station exists in this boot (whether or not it currently
// holds a lease) — if one does, the transport loss is already handled by wifi.cpp's endless
// reconnect and there is nothing here to do.
//
// A board with NO configured WiFi never counts at all: there is nothing to fall back TO, so
// rebooting would only replace a device waiting for its cable with a device waiting for its cable
// having lost its uptime, its diag ring and its MQTT session. It keeps the driver running and the
// wire is reclaimed the moment it returns.
inline EthFallbackAction net_eth_fallback_step(EthFallbackWatch& w, bool eth_lease,
                                               bool wifi_running, bool wifi_configured,
                                               int periods_to_restart = ETH_FALLBACK_PERIODS) {
    if (eth_lease || wifi_running || !wifi_configured) {
        w.down_periods = 0;
        return EthFallbackAction::Idle;
    }
    if (++w.down_periods < periods_to_restart) return EthFallbackAction::Wait;
    // Spend the run either way, so a board that cannot restart (the caller may refuse — an OTA is
    // in flight) re-earns the verdict instead of asserting it on every later period.
    w.down_periods = 0;
    return EthFallbackAction::Restart;
}

// ── The SPI pads ─────────────────────────────────────────────────────────────────────────────

// The four pads the W5500 sits on. Anonymous about direction like board_pins.hpp's ReservedPins
// is about ownership: what matters downstream is the SET, not which wire is which.
struct EthPins {
    int sclk = -1;
    int cs   = -1;
    int miso = -1;
    int mosi = -1;

    constexpr bool claims(int pin) const {
        return pin >= 0 && (pin == sclk || pin == cs || pin == miso || pin == mosi);
    }
    // As a reservation, so the X10A / ENV III / LED / button pickers can withhold these pads once
    // a controller has actually been found on them.
    constexpr ReservedPins reserved() const { return ReservedPins{sclk, cs, miso, mosi}; }
};

// Are the four configured pads usable at all — four real, DISTINCT GPIOs? A build that leaves one
// at -1 (or repeats one) has no Ethernet, and saying so here means net.cpp never installs an SPI
// bus on a half-specified configuration.
inline bool net_eth_pins_valid(const EthPins& p) {
    if (p.sclk < 0 || p.cs < 0 || p.miso < 0 || p.mosi < 0) return false;
    return p.sclk != p.cs   && p.sclk != p.miso && p.sclk != p.mosi &&
           p.cs   != p.miso && p.cs   != p.mosi &&
           p.miso != p.mosi;
}

// May the identity probe run? Only when the pads are usable AND none of them is already spoken for
// by something this firmware drives — the X10A link, an enabled ENV III, the status indicator or
// the recovery button (`in_use`, built by the caller from the live Config).
//
// This is the one guard whose absence would be actively destructive rather than merely useless.
// The probe drives SCLK and CS and clocks a 4-byte frame; on an AtomS3 Lite with X10A moved to the
// header pins (docs/BOARDS.md offers exactly GPIO5/6 for that) those edges land on the heat pump's
// service bus. The failure would not look like a wiring conflict either — it would look like an
// X10A bus that answers erratically at boot, which is the hardest symptom in this project to
// attribute. A board with the PoE base has none of those pins configured, so refusing costs it
// nothing.
inline bool net_eth_probe_allowed(const EthPins& p, ReservedPins in_use) {
    if (!net_eth_pins_valid(p)) return false;
    return !(in_use.claims(p.sclk) || in_use.claims(p.cs) ||
             in_use.claims(p.miso) || in_use.claims(p.mosi));
}

} // namespace daik
