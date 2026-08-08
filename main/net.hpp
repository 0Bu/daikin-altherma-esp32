#pragma once
#include <cstdint>

#include "logic/board_pins.hpp"
#include "logic/net_link.hpp"

// The OPTIONAL wired transport — a W5500 Ethernet controller on SPI, in practice an M5Stack
// AtomS3 Lite seated on an ATOMIC PoE Base, where one cable carries both power and the LAN.
//
// It is a SECOND TRANSPORT, not a second SOURCE: unlike the HomeHub (hp_modbus.cpp) or ENV III
// (env3.cpp), which observe the plant independently, this carries exactly the same MQTT, syslog,
// SNTP, OTA and HTTP traffic the radio would. So nothing above it branches on the transport — the
// bridge does not know or care — and the whole surface is the handful of questions below.
//
// Runtime-detected, never a board variant: CI publishes ONE esp32s3 image, so net_eth_probe()
// reads the controller's identity register once at boot and a board without one frees the SPI bus
// again. Everything here answers "no" on such a board, and on a build with
// CONFIG_DAIKIN_ETH_ENABLED off it answers "no" without any Ethernet code being linked at all.
//
// WHAT IT COSTS THE USER is a fact about pins and belongs where the API is: the base occupies the
// AtomS3 Lite's whole side header (GPIO5/6/7/8/38), leaving only the Grove port — which X10A
// needs. An Ethernet install therefore has no pins left for ENV III. That is stated in
// docs/BOARDS.md and enforced here rather than discovered: net_eth_reserved_pins() withholds the
// four pads from every picker, in both directions, exactly as the X10A link and the indicator
// already withhold theirs from each other.
namespace daik {

// Which pads a W5500 would sit on (CONFIG_DAIKIN_ETH_SPI_*). Reported even when no controller is
// present, so /status and the docs can say WHERE it would go; all -1 on a build without support.
EthPins net_eth_pins();

// The pads to withhold from the X10A / ENV III / indicator / button pickers — the four SPI pins
// once a controller has ACTUALLY been found on them, and nothing otherwise. Empty is the important
// half: a board with no W5500 must keep every one of those GPIOs offerable, since on the XIAO they
// are ordinary pads people wire X10A to.
ReservedPins net_eth_reserved_pins();

// Is a W5500 wired to those pads? Probes the SPI bus ONCE and caches the answer; cheap by design
// (one identity register, no wait for a link or a lease) because the BOOT FORK depends on it —
// a wired board must not be sent to a captive portal it does not need.
//
// Refuses to probe at all when one of the four pads is already spoken for by the X10A link, an
// enabled ENV III, the indicator or the button (logic/net_link.hpp's net_eth_probe_allowed): the
// probe drives a clock and a chip-select, and on a board with X10A moved to the header pins those
// edges would land on the heat pump's service bus.
bool net_eth_probe();

// Bring the interface up and wait for a DHCP lease. True only WITH a lease in hand — a controller
// with no cable, a dead switch port or an absent DHCP server all return false so the caller can
// give WiFi its turn. The driver keeps running either way, so a cable plugged in later still comes
// up (and then wins the default route).
bool net_eth_start();

// Has this board got a wire at all, independent of whether it currently holds a lease? The
// question net_kind() cannot answer while a link is still coming up, and what lets the UI say
// "Ethernet, no cable" instead of silently showing nothing.
bool net_eth_present();

// Which transport carries the device right now (logic/net_link.hpp). Combines the Ethernet lease
// tracked here with wifi_link_up(), so callers never have to.
NetLink net_kind();

// True while SOME transport holds an IP — the transport-neutral successor to wifi_info().connected
// for everything that only needs to know whether the device is on a network at all (the status
// indicator, the absence copy in the UI).
bool net_is_up();

// Live wired-link facts for /status.net.eth. `link` is the PHY's own answer (is a cable
// negotiated) and is deliberately separate from `lease`: "cable in, DHCP still thinking" and "no
// cable" are different states and only one of them is worth waiting for. speed_mbps/full_duplex
// are meaningful only while `link`; ip is empty without a lease, never a stale one.
struct EthInfo {
    bool    present     = false;
    bool    link        = false;
    bool    lease       = false;
    char    ip[16]      = {0};
    uint8_t mac[6]      = {0};
    int     speed_mbps  = 0;
    bool    full_duplex = false;
};
EthInfo net_eth_info();

// Start the task that watches for the cable being PULLED from a board that came up wired. Such a
// board has no WiFi station running (logic/net_link.hpp's net_wifi_start_needed), so its recovery
// is a deliberate reboot into the same boot fork — see net_eth_fallback_step() for why that is the
// right answer rather than growing a station at runtime. No-op unless Ethernet actually carries
// this boot; harmless to call otherwise.
void net_eth_fallback_start();

// mDNS (<hostname>.local + the _http._tcp record), started by whichever transport comes up first
// and idempotent so the second one is a no-op. It used to live inside wifi_start_sta(), which
// meant a wired board — the one case where the LAN is most likely to be the only way in — silently
// had no <hostname>.local name at all.
void net_mdns_start();

} // namespace daik
