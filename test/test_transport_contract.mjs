// THE TRANSPORT BOUNDARY, asserted over source TEXT — the question the host suite cannot ask.
//
// test/test_logic.cpp proves what logic/net_link.hpp DECIDES: the wire wins the route, a wired
// board starts no radio and opens no portal, the probe refuses a pad the X10A link owns. What it
// can never prove is that the firmware still CALLS those rules from the places that matter, and
// every defect this file guards against is a call site quietly going back to what it used to say:
//
//   1. THE TRUST SURFACE. http_server.cpp used to derive it from `esp_wifi_get_mode() ==
//      WIFI_MODE_STA`. That reads WIFI_MODE_NULL on a board carried by a cable — no station is ever
//      started there — and would serve the restricted provisioning route set on the LAN the device
//      is reachable on: no /status, no config, no OTA, and no radio to fix it through. The inverse
//      simplification ("a wire is up, therefore trust") re-opens F01 itself, because the setup AP
//      can be radiating at the same time and esp_http_server registers routes per SERVER, not per
//      interface. Only the AP's own existence is the right input, so that is what is pinned.
//   2. THE PORTAL FORK. main.cpp must gate provisioning_start_ap() on net_portal_needed(). A board
//      with a cable and no stored SSID otherwise opens an OPEN SoftAP nobody is coming to
//      configure — which then restricts the surface above, so the two defects compound.
//   3. THE PROBE GUARD. net.cpp must ask net_eth_probe_allowed() before it installs an SPI bus.
//      This is the only destructive one: the probe drives a clock and a chip-select, and
//      docs/BOARDS.md offers GPIO5/6 for X10A on the very board the PoE base is made for, so an
//      unguarded probe clocks edges onto the heat pump's service bus. The symptom would be an X10A
//      link that answers erratically at boot — the hardest thing in this project to attribute.
//   4. THE RADIO STAYS OFF. Nothing may call wifi_start_sta() unconditionally again: that would
//      restore the ~50 KB of heap and the second netif this transport exists to avoid, silently,
//      while every test above still passes.
//   5. LEASE LIFECYCLE + OFF-LINK CLIENTS. GOT_IP is not a forever-latch: LOST_IP/link-down must
//      revoke both the lease flag and wake bit, and OTA/weather/syslog/MQTT pre-flight must ask the
//      transport-neutral boundary rather than silently withholding wired service.
//   6. FAILURE UNWIND. The positive probe leaves an SPI bus installed. Every later allocation or
//      start failure must reverse all resources before WiFi fallback, including a failed start that
//      already moved the IDF driver FSM to START. Otherwise ENOMEM poisons the fallback by design.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// Comments in these files DISCUSS the rejected shapes at length (that is the point of them), so
// every assertion below is made against code with comment lines stripped.
const code = (rel) => read(rel)
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const server = code("main/http_server.cpp");
assert.ok(/http_surface_for\(\s*ap_up\s*\)/.test(server) ||
          /http_surface_for\(\s*provisioning_ap_active\(\)\s*\)/.test(server),
  "http_server.cpp must pick the trust surface with http_surface_for(<the setup AP is up>)");
assert.ok(!/esp_wifi_get_mode/.test(server),
  "http_server.cpp must not derive the trust surface from the WiFi mode — a wired board has no " +
  "station, and that read withholds the whole API from the cable");
assert.ok(!/HttpSurface::TrustedLan\s*:\s*HttpSurface::SetupAp/.test(server),
  "the surface must come from the rule, not from a ternary re-derived at the call site");

const main = code("main/main.cpp");
assert.ok(/net_portal_needed\(/.test(main),
  "main.cpp must gate the setup portal on net_portal_needed()");
assert.ok(/net_wifi_start_needed\(/.test(main),
  "main.cpp must gate the WiFi station on net_wifi_start_needed()");
// The portal call may appear exactly once, and only inside that gate.
const portalCalls = main.match(/provisioning_start_ap\(\)/g) || [];
assert.equal(portalCalls.length, 1, "provisioning_start_ap() must have exactly one call site");
assert.ok(/net_portal_needed\([^)]*\)\)\s*\n?\s*daik::provisioning_start_ap\(\)/.test(main),
  "the portal must be opened only under net_portal_needed()");
const staCalls = main.match(/wifi_start_sta\(\)/g) || [];
assert.equal(staCalls.length, 1, "wifi_start_sta() must have exactly one call site");
assert.ok(/net_wifi_start_needed\([^;]*\)\)\s*\n?\s*wifi_up\s*=\s*daik::wifi_start_sta\(\)/.test(main),
  "the radio must be started only under net_wifi_start_needed() — a wired board keeps it off");
// The wire is asked FIRST. Ordering is the policy: probing after the WiFi window would spend the
// boot budget on a radio the device is not going to use.
assert.ok(main.indexOf("net_eth_start()") < main.indexOf("wifi_start_sta()"),
  "main.cpp must ask the wire before the radio");

const net = code("main/net.cpp");
assert.ok(/net_eth_probe_allowed\(/.test(net),
  "net.cpp must consult net_eth_probe_allowed() before touching the SPI pads");
assert.ok(net.indexOf("net_eth_probe_allowed(") < net.indexOf("spi_bus_initialize("),
  "the probe guard must run BEFORE the SPI bus is installed — after it, the pads are already driven");
// The guard's input must be the LIVE config, not an empty reservation that would make it vacuous.
assert.ok(/net_eth_probe_allowed\(\s*pins\s*,\s*in_use\s*\)/.test(net) &&
          /config_reserved_pins\(c\)\.plus\(config_link_pins\(c\)\)/.test(net),
  "the probe guard must be given the configured X10A / sensor / indicator pins");
// A failed probe must hand the pads back, or a board without a base loses GPIO5-8 for X10A.
assert.ok(/spi_bus_free\(/.test(net), "a failed probe must free the SPI bus again");

const cleanupStart = net.indexOf("static void eth_start_cleanup(");
const cleanupEnd = net.indexOf("bool net_eth_start()", cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart,
  "the Ethernet construction unwind must remain a single identifiable function");
const cleanup = net.slice(cleanupStart, cleanupEnd);
const cleanupSteps = [
  "esp_eth_stop(",
  "esp_event_handler_unregister(IP_EVENT, IP_EVENT_ETH_LOST_IP",
  "esp_event_handler_unregister(IP_EVENT, IP_EVENT_ETH_GOT_IP",
  "esp_event_handler_unregister(ETH_EVENT, ESP_EVENT_ANY_ID",
  "esp_eth_del_netif_glue(",
  "esp_eth_driver_uninstall(",
  "owned.mac->del(",
  "owned.phy->del(",
  "esp_netif_destroy(",
  "vEventGroupDelete(",
  "spi_bus_free(",
];
let previousCleanupStep = -1;
for (const step of cleanupSteps) {
  const position = cleanup.indexOf(step);
  assert.ok(position > previousCleanupStep,
    `Ethernet failure cleanup must contain ${step} in reverse acquisition order`);
  previousCleanupStep = position;
}
assert.match(cleanup, /s_eth_glue\s*=\s*nullptr/,
  "failure cleanup must clear the released glue handle");
assert.match(cleanup, /s_eth_handle\s*=\s*nullptr/,
  "failure cleanup must clear the released driver handle");
assert.match(cleanup, /s_eth_netif\s*=\s*nullptr/,
  "failure cleanup must clear the destroyed netif handle");
assert.match(cleanup, /s_events\s*=\s*nullptr/,
  "failure cleanup must clear the deleted EventGroup handle");

const startBegin = net.indexOf("bool net_eth_start()");
const startEnd = net.indexOf("EthInfo net_eth_info()", startBegin);
const ethStart = net.slice(startBegin, startEnd);
const guardCreate = ethStart.indexOf("EthStartResources owned;");
const driverStart = ethStart.indexOf("esp_eth_start(s_eth_handle)");
const guardRelease = ethStart.indexOf("owned.keep_running()");
const firstWait = ethStart.indexOf("xEventGroupWaitBits(");
assert.ok(guardCreate >= 0 && driverStart > guardCreate && guardRelease > driverStart &&
          firstWait > guardRelease,
  "the unwind guard must cover every post-probe construction step and release only after start");
assert.match(ethStart,
  /owned\.start_attempted\s*=\s*true[\s\S]*esp_eth_start\(s_eth_handle\)[\s\S]*if \(start_err != ESP_OK\)[\s\S]*return false;[\s\S]*owned\.keep_running\(\)/,
  "an esp_eth_start failure must stay guard-owned so cleanup can stop its partially-started FSM");

assert.ok(/id\s*==\s*IP_EVENT_ETH_LOST_IP\)\s*\{\s*clear_eth_lease\(\)/.test(net) &&
          /esp_event_handler_register\(\s*IP_EVENT\s*,\s*IP_EVENT_ETH_LOST_IP\s*,\s*on_eth/.test(net),
  "Ethernet LOST_IP must be handled and registered, not just GOT_IP");
assert.ok(/id\s*==\s*ETHERNET_EVENT_DISCONNECTED\)\s*\{[\s\S]*?clear_eth_lease\(\)/.test(net),
  "a physical Ethernet disconnect must revoke the lease even if LOST_IP is not delivered first");
assert.ok(/clear_eth_lease\(\)[\s\S]*?s_lease\.store\(false\)[\s\S]*?xEventGroupClearBits/.test(net),
  "losing the Ethernet address must clear both the lease flag and the GOT_IP wake bit");
assert.ok(/net_eth_boot_ready\(\s*\(bits\s*&\s*GOT_IP_BIT\)\s*!=\s*0\s*,\s*s_lease\.load\(\)\s*\)/.test(net),
  "the Ethernet boot verdict must combine the wake event with the current lease");
assert.ok(/net_eth_fallback_watch_needed\(\s*s_present\.load\(\)\s*,\s*s_carried_boot\.load\(\)\s*\)/.test(net),
  "fallback watch creation must use boot provenance, not a lease that can vanish before task start");

const ota = code("main/ota_update.cpp");
assert.ok(/\.link\s*=\s*net_kind\(\)/.test(ota) &&
          /\.recovery_surface\s*=\s*provisioning_ap_active\(\)/.test(ota) &&
          /health_gate_decide\([\s\S]*?service\s*\)/.test(ota),
  "OTA health must sample an active transport and an actually running recovery portal");
assert.ok(/\.x10a_required\s*=\s*hp_link_connected\(\)/.test(ota) &&
          !/const\s+HpStats\s+hp\s*=\s*hp_stats\(\)/.test(ota),
  "rollback proof must sample the X10A link without allocating a copied HpStats string");
assert.ok(!/wifi_info\(\)\.connected/.test(ota),
  "OTA health must not equate network health with WiFi association");
assert.ok(!/\.recovery_surface\s*=\s*wifi_configured\(\)/.test(ota),
  "no stored SSID must not invent a portal on a wired boot that deliberately kept it off");

const weather = code("main/weather_forecast.cpp");
const syslog = code("main/syslog.cpp");
assert.ok(/net_is_up\(\)/.test(weather) && !/wifi_info\(\)\.connected/.test(weather),
  "Open-Meteo reachability must be transport-neutral");
assert.ok(/net_is_up\(\)/.test(syslog) && !/wifi_info\(\)\.connected/.test(syslog),
  "syslog reachability must be transport-neutral");

// The pads a DETECTED controller owns must reach the pickers and the request path, in both
// directions — the reservation rule board_pins.hpp states for the X10A link and the indicator.
const status = code("main/http_status.cpp");
const config = code("main/http_config.cpp");
const setMqttStart = config.indexOf("static esp_err_t set_mqtt(");
const setMqttEnd = config.indexOf("static esp_err_t set_ref_temp(", setMqttStart);
assert.ok(setMqttStart >= 0 && setMqttEnd > setMqttStart,
  "the source contract must be able to isolate the MQTT save handler");
const setMqtt = config.slice(setMqttStart, setMqttEnd);
assert.ok(/if\s*\(\s*!net_is_up\(\)\s*\)[\s\S]*?Network not connected/.test(setMqtt) &&
          !/wifi_info\(\)\.connected/.test(setMqtt),
  "the MQTT save pre-flight must be reachable over either transport");
assert.ok((status.match(/net_eth_reserved_pins\(\)/g) || []).length >= 4,
  "every offered pin list must withhold the Ethernet pads");
assert.ok((config.match(/net_eth_reserved_pins\(\)/g) || []).length >= 3,
  "the /set_hp, /set_board and ENV III request paths must all refuse an Ethernet pad");

console.log("transport: trust/boot/probe boundaries, Ethernet lease lifecycle and transport-neutral " +
            "off-link clients are pinned");
