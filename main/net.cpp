// The optional wired transport — W5500 over SPI (see net.hpp for what it is and is not).
//
// Structure mirrors the rule this project applies to every other optional subsystem: the runtime
// gate is LITERAL. With no controller on the bus there is no netif, no driver, no task and no
// event handler — the SPI bus itself is freed again — so a WiFi-only board is byte-for-byte the
// device it was before this file existed. Every policy decision (who wins the route, whether WiFi
// starts, whether the portal opens, when a pulled cable earns a reboot, whether the probe may run
// at all) lives in logic/net_link.hpp where it is host-tested; this file is the SPI, the events
// and the two deadlines.
#include "net.hpp"

#include "config.hpp"
#include "diag_log.hpp"
#include "logic/config_model.hpp"
#include "ota_update.hpp"
#include "task_config.hpp"
#include "sdkconfig.h"
#include "wifi.hpp"

#include "esp_app_desc.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "mdns.h"

#if CONFIG_DAIKIN_ETH_ENABLED
#include "driver/spi_master.h"
#include "esp_eth.h"
// ESP-IDF 6.0 moved the SPI Ethernet chip drivers out of the core esp_eth component; the W5500
// MAC/PHY pair now comes from the espressif/w5500 managed component (main/idf_component.yml),
// which carries these two headers and the shared WIZnet SPI layer beneath them.
#include "esp_eth_mac_w5500.h"
#include "esp_eth_phy_w5500.h"
#endif

#include <atomic>
#include <cstdio>
#include <cstring>

namespace daik {

static const char* TAG = "net";

// ── mDNS ─────────────────────────────────────────────────────────────────────────────────────
// One owner, called by whichever transport comes up first. The latch prevents a second caller from
// trying to add the same service again after mdns_init(); it belongs here rather than at the two
// transport call sites so WiFi and Ethernet cannot drift into separate responder lifecycles.
static std::atomic<bool> s_mdns_started{false};

void net_mdns_start() {
    bool expected = false;
    if (!s_mdns_started.compare_exchange_strong(expected, true)) return;
    if (mdns_init() != ESP_OK) {
        s_mdns_started.store(false);   // let the other transport try when it comes up
        diag_printf("net: mDNS init failed — <hostname>.local will not resolve this boot\n");
        return;
    }
    // Both results are CHECKED, for the same reason the init above is: the failure is otherwise
    // SILENT. The responder is running, so nothing anywhere reports a fault — the name simply never
    // resolves, and the symptom reaching the user is "the device disappeared" with the diag ring
    // saying nothing at all. It is worst on a WIRED board, which has no setup AP to fall back to and
    // for which <hostname>.local is the one address anybody knows. The name is deliberately NOT
    // interpolated (it is a compile-time constant, and the neighbouring line already states it as
    // literal text — an identifier-shaped argument is what the redaction audit exists to question).
    esp_err_t err = mdns_hostname_set(CONFIG_DAIKIN_HOSTNAME);
    if (err != ESP_OK)
        diag_printf("net: mDNS hostname set failed (%s) — <hostname>.local will not resolve this boot\n",
                    esp_err_to_name(err));
    // Product first is deliberate: mdns 1.12.0 copies these small values during this call and, if
    // an unusually late TXT allocation fails, can retain the prefix it already copied. The stable
    // identity therefore survives ahead of optional routing/version detail. Nothing installation-
    // specific (MAC, board, IP, SSID or configured service data) is multicast.
    mdns_txt_item_t http_txt[] = {
        {"product", CONFIG_DAIKIN_HOSTNAME},
        {"path", "/"},
        {"version", esp_app_get_description()->version},
    };
    err = mdns_service_add(CONFIG_DAIKIN_HOSTNAME, "_http", "_tcp", 80, http_txt,
                           sizeof(http_txt) / sizeof(http_txt[0]));
    if (err != ESP_OK)
        diag_printf("net: mDNS _http service add failed (%s) — the device will not be discoverable\n",
                    esp_err_to_name(err));
}

// ── pins ─────────────────────────────────────────────────────────────────────────────────────

EthPins net_eth_pins() {
#if CONFIG_DAIKIN_ETH_ENABLED
    return EthPins{CONFIG_DAIKIN_ETH_SPI_SCLK, CONFIG_DAIKIN_ETH_SPI_CS,
                   CONFIG_DAIKIN_ETH_SPI_MISO, CONFIG_DAIKIN_ETH_SPI_MOSI};
#else
    return EthPins{};
#endif
}

#if !CONFIG_DAIKIN_ETH_ENABLED

// A build without the transport answers every question with "no wire", so nothing above this file
// needs an #ifdef — the same shape env3.cpp and hp_modbus.cpp use for a subsystem that is absent.
ReservedPins net_eth_reserved_pins() { return ReservedPins{}; }
bool         net_eth_probe()         { return false; }
bool         net_eth_start()         { return false; }
bool         net_eth_present()       { return false; }
EthInfo      net_eth_info()          { return EthInfo{}; }
void         net_eth_fallback_start(){ }
NetLink      net_kind()              { return net_link_active(false, wifi_link_up()); }
bool         net_is_up()             { return wifi_link_up(); }

#else   // CONFIG_DAIKIN_ETH_ENABLED

// ── state ────────────────────────────────────────────────────────────────────────────────────
// Written on the event-loop task, read from the http / mqtt / led / fallback tasks. Atomics, not
// volatile: the readers need the happens-before edge, not merely a non-elided load. Each is a
// single value with no multi-field invariant, so no mutex is involved — the same reasoning
// wifi.cpp states for its own flags.

static std::atomic<bool> s_present{false};   // a controller answered the identity probe
static std::atomic<bool> s_link{false};      // the PHY reports a negotiated cable
static std::atomic<bool> s_lease{false};     // DHCP gave us an address
// Boot provenance, deliberately not cleared with s_lease: the fallback watcher must still be
// created if the lease disappears after net_eth_start() selected the wire but before main.cpp gets
// to net_eth_fallback_start().
static std::atomic<bool> s_carried_boot{false};

static esp_eth_handle_t            s_eth_handle = nullptr;
static esp_netif_t*                s_eth_netif  = nullptr;
static esp_eth_netif_glue_handle_t s_eth_glue   = nullptr;
static EventGroupHandle_t          s_events     = nullptr;
static const int GOT_IP_BIT = BIT0;

bool net_eth_present() { return s_present.load(); }

NetLink net_kind()  { return net_link_active(s_lease.load(), wifi_link_up()); }
bool    net_is_up() { return net_kind() != NetLink::None; }

ReservedPins net_eth_reserved_pins() {
    // Only once a controller has actually been FOUND. The empty answer is the load-bearing one:
    // GPIO5-8 are ordinary, offerable pads on every board without a PoE base — the XIAO breaks all
    // four out and docs/BOARDS.md offers 5/6 for X10A — so reserving them unconditionally would
    // take four pins away from every existing install to describe hardware it does not have.
    return s_present.load() ? net_eth_pins().reserved() : ReservedPins{};
}

// ── the identity probe ───────────────────────────────────────────────────────────────────────

// VERSIONR lives at 0x0039 of the W5500's Common Register block and reads a fixed 0x04 on every
// part — the only positive way to tell "a controller is wired to these pads" from "these pads are
// floating". A floating MISO reads 0x00 or 0xFF, so there is no realistic false positive.
static constexpr uint16_t kVersionReg = 0x0039;
static constexpr uint8_t  kVersionVal = 0x04;

static spi_host_device_t eth_spi_host() { return SPI2_HOST; }

// One byte out of the Common Register block: 3 bytes of address phase (16-bit offset + a control
// byte whose BSB/RWB/OM fields select "common block, read, variable length") then the data byte,
// so one 4-byte full-duplex transfer does it.
static bool w5500_read_common(spi_device_handle_t dev, uint16_t reg, uint8_t* out) {
    uint8_t tx[4] = {static_cast<uint8_t>(reg >> 8), static_cast<uint8_t>(reg & 0xFF), 0x00, 0x00};
    uint8_t rx[4] = {0, 0, 0, 0};
    spi_transaction_t t = {};
    t.length    = sizeof(tx) * 8;
    t.tx_buffer = tx;
    t.rx_buffer = rx;
    if (spi_device_polling_transmit(dev, &t) != ESP_OK) return false;
    *out = rx[3];
    return true;
}

bool net_eth_probe() {
    if (s_present.load()) return true;

    const EthPins pins = net_eth_pins();
    // Refuse rather than fight. The reservation is built from the LIVE config, so a user who has
    // put X10A on the header pins (or an ENV III, or the indicator) simply has no Ethernet — and
    // keeps a service bus nobody clocked a chip-select onto. See net_eth_probe_allowed().
    const Config& c = config();
    const ReservedPins in_use = config_reserved_pins(c).plus(config_link_pins(c));
    if (!net_eth_probe_allowed(pins, in_use)) {
        diag_printf("net: not probing for Ethernet — GPIO%d/%d/%d/%d overlap the configured "
                    "X10A/sensor/indicator pins\n", pins.sclk, pins.cs, pins.miso, pins.mosi);
        return false;
    }

    spi_bus_config_t buscfg = {};
    buscfg.mosi_io_num   = pins.mosi;
    buscfg.miso_io_num   = pins.miso;
    buscfg.sclk_io_num   = pins.sclk;
    buscfg.quadwp_io_num = -1;
    buscfg.quadhd_io_num = -1;
    if (spi_bus_initialize(eth_spi_host(), &buscfg, SPI_DMA_CH_AUTO) != ESP_OK) {
        diag_printf("net: Ethernet probe — SPI bus init failed; continuing on WiFi\n");
        return false;
    }

    spi_device_interface_config_t devcfg = {};
    devcfg.mode           = 0;                     // the W5500 is SPI mode 0
    devcfg.clock_speed_hz = CONFIG_DAIKIN_ETH_SPI_CLOCK_MHZ * 1000 * 1000;
    devcfg.spics_io_num   = pins.cs;
    devcfg.queue_size     = 1;

    spi_device_handle_t dev = nullptr;
    uint8_t ver   = 0;
    bool    found = false;
    if (spi_bus_add_device(eth_spi_host(), &devcfg, &dev) == ESP_OK) {
        found = w5500_read_common(dev, kVersionReg, &ver) && ver == kVersionVal;
        spi_bus_remove_device(dev);    // the driver adds its own device with its own config
    }

    if (!found) {
        // Give the pads back exactly as they were found. A board with no base must be able to use
        // GPIO5-8 for X10A afterwards, which an installed-but-idle SPI bus would prevent.
        spi_bus_free(eth_spi_host());
        ESP_LOGI(TAG, "no W5500 on SPI (VERSIONR=0x%02x, expected 0x%02x) — WiFi only",
                 ver, kVersionVal);
        return false;
    }

    diag_printf("net: W5500 found on SCLK%d/CS%d/MISO%d/MOSI%d @ %d MHz\n",
                pins.sclk, pins.cs, pins.miso, pins.mosi, CONFIG_DAIKIN_ETH_SPI_CLOCK_MHZ);
    s_present.store(true);
    return true;
}

// ── bring-up ─────────────────────────────────────────────────────────────────────────────────

// Above WIFI_STA_DEF's 100 (esp_netif_defaults.h ships ETH_DEF at 50), so the wire takes the
// DEFAULT ROUTE when both transports hold a lease. Precise about what that buys, because half of
// it is a well-known lwIP asymmetry rather than a setting:
//   • OFF-LINK destinations — the MQTT broker, syslog, SNTP, the OTA feed, Open-Meteo — go to
//     netif_default, and route_prio is exactly what esp_netif uses to choose it.
//   • ON-LINK destinations do NOT consult it: ip4_route() walks netif_list and takes the first
//     up netif whose subnet matches, so with both interfaces on one /24 same-subnet traffic
//     leaves over whichever registered first.
// Accepted rather than fought: forcing per-packet source selection across two netifs on one subnet
// means overriding the stack's routing, and the case it would improve is the runtime hot-plug —
// where WiFi is already running anyway. The benefit this transport exists for lives in the
// boot-with-cable path, where WiFi is never started and there IS no second netif.
static constexpr int kRoutePrio = 128;

// TWO questions, two deadlines. Answering them with one timer is the mistake worth naming: a board
// with no credentials would sit dark for the whole lease window before its setup AP appeared —
// precisely when somebody is standing next to it waiting for that AP.
static constexpr int kLinkGraceMs = 4000;   // "is a cable connected?" — auto-negotiation, seconds
static constexpr int kLinkPollMs  = 250;
static constexpr int kLeaseTries  = 3;      // × CONFIG_DAIKIN_ETH_WAIT_S once the cable IS there

static void clear_eth_lease() {
    s_lease.store(false);
    // The bit wakes the boot task; it must describe the CURRENT lease rather than remember that a
    // lease existed once. IP_EVENT_ETH_LOST_IP covers DHCP/address loss while the PHY stays up,
    // and ETHERNET_EVENT_DISCONNECTED covers a pulled cable even if LOST_IP is not emitted first.
    if (s_events) xEventGroupClearBits(s_events, GOT_IP_BIT);
}

static void on_eth(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == ETH_EVENT && id == ETHERNET_EVENT_CONNECTED) {
        s_link.store(true);
        diag_printf("net: Ethernet link up\n");
    } else if (base == ETH_EVENT && id == ETHERNET_EVENT_DISCONNECTED) {
        s_link.store(false);
        clear_eth_lease();
        diag_printf("net: Ethernet link down\n");
    } else if (base == IP_EVENT && id == IP_EVENT_ETH_GOT_IP) {
        auto* e = static_cast<ip_event_got_ip_t*>(data);
        ESP_LOGI(TAG, "eth ip=" IPSTR, IP2STR(&e->ip_info.ip));
        s_lease.store(true);
        if (s_events) xEventGroupSetBits(s_events, GOT_IP_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_ETH_LOST_IP) {
        clear_eth_lease();
        diag_printf("net: Ethernet IP lease lost\n");
    }
}

// Every object below exists only because the positive VERSIONR probe left SPI2 installed. A failed
// bring-up must unwind all of it before main.cpp starts WiFi, otherwise the fallback begins under
// exactly the heap pressure that caused the wired path to fail. The guard makes every early return
// before keep_running() share one reverse-order teardown instead of maintaining seven partial lists.
struct EthStartResources {
    esp_eth_phy_t* phy = nullptr;
    esp_eth_mac_t* mac = nullptr;
    bool eth_handler = false;
    bool got_ip_handler = false;
    bool lost_ip_handler = false;
    bool start_attempted = false;
    bool armed = true;

    EthStartResources() = default;
    EthStartResources(const EthStartResources&) = delete;
    EthStartResources& operator=(const EthStartResources&) = delete;
    ~EthStartResources() noexcept;

    void keep_running() { armed = false; }
};

static void cleanup_error(const char* step, esp_err_t err) {
    if (err != ESP_OK)
        diag_printf("net: Ethernet cleanup %s failed (%s)\n", step, esp_err_to_name(err));
}

static void eth_start_cleanup(EthStartResources& owned) {
    // esp_eth_start() changes the driver's FSM to START before PHY negotiation, event posting and
    // timer start. Any of those can fail, so a failed start still needs a stop attempt to return the
    // FSM to STOP before esp_eth_driver_uninstall(). ESP_ERR_INVALID_STATE is harmless here: either
    // start never crossed that boundary, or stop already moved the FSM before a later stop step failed.
    if (owned.start_attempted && s_eth_handle) {
        const esp_err_t err = esp_eth_stop(s_eth_handle);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) cleanup_error("stop", err);
    }

    // Reverse registration order. Nothing may retain on_eth before the EventGroup it references is
    // deleted; only handlers whose registration succeeded are ours to unregister.
    if (owned.lost_ip_handler)
        cleanup_error("unregister lost-ip handler",
                      esp_event_handler_unregister(IP_EVENT, IP_EVENT_ETH_LOST_IP, on_eth));
    if (owned.got_ip_handler)
        cleanup_error("unregister got-ip handler",
                      esp_event_handler_unregister(IP_EVENT, IP_EVENT_ETH_GOT_IP, on_eth));
    if (owned.eth_handler)
        cleanup_error("unregister Ethernet handler",
                      esp_event_handler_unregister(ETH_EVENT, ESP_EVENT_ANY_ID, on_eth));

    s_link.store(false);
    clear_eth_lease();

    // Glue owns the driver's extra reference and its default IP/ETH handlers. It must disappear
    // before uninstall; there is no separate esp_netif_detach API in the selected ESP-IDF 6.1.
    if (s_eth_glue) {
        cleanup_error("delete netif glue", esp_eth_del_netif_glue(s_eth_glue));
        s_eth_glue = nullptr;
    }

    bool driver_released = s_eth_handle == nullptr;
    if (s_eth_handle) {
        const esp_err_t err = esp_eth_driver_uninstall(s_eth_handle);
        cleanup_error("driver uninstall", err);
        if (err == ESP_OK) {
            s_eth_handle = nullptr;
            driver_released = true;
        }
    }

    // PHY was allocated before MAC below, so MAC then PHY is the true reverse order. The W5500 MAC
    // owns the SPI device, RX task/buffer and polling timer; deleting it is what makes spi_bus_free
    // legal. Never free either object while a driver that still references them survived uninstall.
    bool mac_released = owned.mac == nullptr;
    if (driver_released) {
        if (owned.mac) {
            const esp_err_t err = owned.mac->del(owned.mac);
            cleanup_error("MAC delete", err);
            if (err == ESP_OK) {
                owned.mac = nullptr;
                mac_released = true;
            }
        }
        if (owned.phy) {
            const esp_err_t err = owned.phy->del(owned.phy);
            cleanup_error("PHY delete", err);
            if (err == ESP_OK) owned.phy = nullptr;
        }
    }

    if (s_eth_netif) {
        esp_netif_destroy(s_eth_netif);
        s_eth_netif = nullptr;
    }
    if (s_events) {
        vEventGroupDelete(s_events);
        s_events = nullptr;
    }

    // The probe installed the bus before every object above. Free it last, and only after the MAC
    // successfully removed its SPI device; otherwise spi_bus_free would fail with a live child.
    if (driver_released && mac_released)
        cleanup_error("SPI bus free", spi_bus_free(eth_spi_host()));
}

EthStartResources::~EthStartResources() noexcept {
    if (armed) eth_start_cleanup(*this);
}

bool net_eth_start() {
    s_carried_boot.store(false);
    if (!net_eth_probe()) return false;

    EthStartResources owned;

    s_events = xEventGroupCreate();
    if (!s_events) {
        diag_printf("net: Ethernet event group alloc failed — continuing on WiFi\n");
        return false;
    }

    // `static` because esp_netif keeps the POINTER it is handed, not a copy — the same lifetime
    // trap provisioning.cpp's captive-portal URI and sntp_time.cpp's server string carry.
    static esp_netif_inherent_config_t base_cfg = ESP_NETIF_INHERENT_DEFAULT_ETH();
    base_cfg.route_prio          = kRoutePrio;
    esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
    netif_cfg.base               = &base_cfg;
    s_eth_netif = esp_netif_new(&netif_cfg);
    if (!s_eth_netif) {
        diag_printf("net: Ethernet netif alloc failed — continuing on WiFi\n");
        return false;
    }
    // Advertise the hostname over DHCP (option 12) BEFORE the lease is requested, exactly as the
    // station does, so the router registers the same name for either transport.
    const esp_err_t hostname_err = esp_netif_set_hostname(s_eth_netif, CONFIG_DAIKIN_HOSTNAME);
    if (hostname_err != ESP_OK)
        diag_printf("net: Ethernet DHCP hostname set failed (%s) — options 12/60 may be absent\n",
                    esp_err_to_name(hostname_err));

    const EthPins pins = net_eth_pins();
    spi_device_interface_config_t devcfg = {};
    devcfg.mode           = 0;
    devcfg.clock_speed_hz = CONFIG_DAIKIN_ETH_SPI_CLOCK_MHZ * 1000 * 1000;
    devcfg.spics_io_num   = pins.cs;
    devcfg.queue_size     = 20;

    eth_w5500_config_t w5500_cfg = ETH_W5500_DEFAULT_CONFIG(eth_spi_host(), &devcfg);
    // POLLING mode: the ATOMIC PoE Base routes SCLK/CS/MISO/MOSI and power only, so there is no
    // interrupt line to wire. Supported rather than a workaround — ESP-IDF ships a CI config for
    // exactly this — and it bounds RX LATENCY, not throughput: each poll drains everything queued
    // in the W5500's 16 KB buffer.
    w5500_cfg.base.int_gpio_num   = -1;
    w5500_cfg.base.poll_period_ms = CONFIG_DAIKIN_ETH_POLL_MS;

    eth_mac_config_t mac_cfg = ETH_MAC_DEFAULT_CONFIG();
    eth_phy_config_t phy_cfg = ETH_PHY_DEFAULT_CONFIG();
    phy_cfg.reset_gpio_num   = -1;   // no reset line on the base either; the driver resets over SPI

    // PHY first, MAC second: the latter owns the W5500 SPI device, RX task/buffer and poll timer, so
    // reverse-order cleanup can delete MAC (and detach that SPI device) before PHY and the bus.
    owned.phy = esp_eth_phy_new_w5500(&phy_cfg);
    owned.mac = esp_eth_mac_new_w5500(&w5500_cfg, &mac_cfg);
    if (!owned.mac || !owned.phy) {
        diag_printf("net: W5500 mac/phy alloc failed — continuing on WiFi\n");
        return false;
    }

    esp_eth_config_t eth_cfg = ETH_DEFAULT_CONFIG(owned.mac, owned.phy);
    if (esp_eth_driver_install(&eth_cfg, &s_eth_handle) != ESP_OK) {
        diag_printf("net: W5500 driver install failed — continuing on WiFi\n");
        return false;
    }

    // The W5500 carries no MAC of its own (no EEPROM), so one must be supplied. ESP_MAC_ETH is the
    // chip's eFuse-derived Ethernet address — stable across reboots and distinct from the WiFi STA
    // MAC, so the two interfaces can never collide on one LAN.
    uint8_t mac_addr[6] = {0};
    if (esp_read_mac(mac_addr, ESP_MAC_ETH) == ESP_OK)
        esp_eth_ioctl(s_eth_handle, ETH_CMD_S_MAC_ADDR, mac_addr);

    s_eth_glue = esp_eth_new_netif_glue(s_eth_handle);
    if (!s_eth_glue || esp_netif_attach(s_eth_netif, s_eth_glue) != ESP_OK) {
        diag_printf("net: W5500 netif attach failed — continuing on WiFi\n");
        return false;
    }

    const esp_err_t eth_handler =
        esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID, on_eth, nullptr);
    const esp_err_t got_ip_handler =
        esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, on_eth, nullptr);
    const esp_err_t lost_ip_handler =
        esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_LOST_IP, on_eth, nullptr);
    owned.eth_handler = eth_handler == ESP_OK;
    owned.got_ip_handler = got_ip_handler == ESP_OK;
    owned.lost_ip_handler = lost_ip_handler == ESP_OK;
    if (eth_handler != ESP_OK || got_ip_handler != ESP_OK || lost_ip_handler != ESP_OK) {
        // LOST_IP is part of the transport's correctness boundary, not optional diagnostics: without
        // it a DHCP loss leaves net_kind()/OTA health latched online forever. Do not start a wired
        // interface whose lease lifecycle cannot be observed. The guard unregisters only handlers
        // that landed, then releases every allocation behind them.
        diag_printf("net: Ethernet event handler registration failed (%s/%s/%s) — continuing on WiFi\n",
                    esp_err_to_name(eth_handler), esp_err_to_name(got_ip_handler),
                    esp_err_to_name(lost_ip_handler));
        return false;
    }
    owned.start_attempted = true;
    const esp_err_t start_err = esp_eth_start(s_eth_handle);
    if (start_err != ESP_OK) {
        diag_printf("net: W5500 start failed (%s) — continuing on WiFi\n",
                    esp_err_to_name(start_err));
        return false;
    }
    // From here, no-link/no-DHCP are availability outcomes rather than construction failures: keep
    // the driver hot so a later cable/lease can still win the route alongside WiFi.
    owned.keep_running();

    // Phase 1 — is a cable connected at all? Seconds, not tens of seconds: the PHY reports link as
    // soon as auto-negotiation completes. No link by the grace window means no cable or a dead
    // port, and nothing is coming, so hand over NOW instead of spending a lease deadline on it.
    EventBits_t bits = 0;
    for (int waited = 0; waited < kLinkGraceMs && !s_link.load(); waited += kLinkPollMs) {
        bits = xEventGroupWaitBits(s_events, GOT_IP_BIT, pdFALSE, pdFALSE,
                                   pdMS_TO_TICKS(kLinkPollMs));
        if (bits & GOT_IP_BIT) break;    // a fast DHCP server can beat the link event here
    }
    if (!(bits & GOT_IP_BIT) && !s_link.load()) {
        diag_printf("net: no Ethernet link after %d ms — no cable or a dead port; the driver stays "
                    "up and will claim the wire if it appears\n", kLinkGraceMs);
        return false;
    }

    // Phase 2 — the cable IS there, so wait properly for the lease. Falling back here would start
    // the radio on a board that is about to be wired anyway, spending ~50 KB of heap and putting a
    // second netif on the same subnet. A cap still applies, so a segment with no DHCP server at
    // all ends up somewhere.
    const int wait_ms = CONFIG_DAIKIN_ETH_WAIT_S * 1000;
    for (int i = 0; !(bits & GOT_IP_BIT) && i < kLeaseTries; i++) {
        bits = xEventGroupWaitBits(s_events, GOT_IP_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(wait_ms));
        if (bits & GOT_IP_BIT) break;
        if (!s_link.load()) {
            diag_printf("net: Ethernet link went away while waiting for DHCP — falling back\n");
            break;
        }
        diag_printf("net: Ethernet cable is up but no DHCP lease after %d s — still waiting\n",
                    (i + 1) * CONFIG_DAIKIN_ETH_WAIT_S);
    }
    if (net_eth_boot_ready((bits & GOT_IP_BIT) != 0, s_lease.load())) {
        s_carried_boot.store(true);
        net_mdns_start();
        diag_printf("net: Ethernet carries this boot — the WiFi radio stays off\n");
        return true;
    }
    // The driver stays running on purpose: a lease that arrives later is still claimed, and the
    // wire then wins the default route. Leaving WiFi to run alongside is the cost of that, and it
    // is the right trade — an unreachable board is worse than two live interfaces.
    diag_printf("net: no DHCP lease on Ethernet after %d s — falling back to WiFi\n",
                kLeaseTries * CONFIG_DAIKIN_ETH_WAIT_S);
    return false;
}

EthInfo net_eth_info() {
    EthInfo info{};
    info.present = s_present.load();
    if (!info.present) return info;
    info.link  = s_link.load();
    info.lease = s_lease.load();

    esp_netif_ip_info_t ip{};
    if (info.lease && s_eth_netif && esp_netif_get_ip_info(s_eth_netif, &ip) == ESP_OK &&
        ip.ip.addr != 0)
        snprintf(info.ip, sizeof(info.ip), IPSTR, IP2STR(&ip.ip));

    if (s_eth_handle) {
        esp_eth_ioctl(s_eth_handle, ETH_CMD_G_MAC_ADDR, info.mac);
        if (info.link) {
            eth_speed_t  sp = ETH_SPEED_10M;
            eth_duplex_t dx = ETH_DUPLEX_HALF;
            if (esp_eth_ioctl(s_eth_handle, ETH_CMD_G_SPEED, &sp) == ESP_OK)
                info.speed_mbps = (sp == ETH_SPEED_100M) ? 100 : 10;
            if (esp_eth_ioctl(s_eth_handle, ETH_CMD_G_DUPLEX_MODE, &dx) == ESP_OK)
                info.full_duplex = (dx == ETH_DUPLEX_FULL);
        }
    }
    return info;
}

// ── losing the wire ──────────────────────────────────────────────────────────────────────────
// Only ever created on a board that came up WIRED (net_eth_fallback_start is a no-op otherwise),
// so this task does not exist on any device without a PoE base. See logic/net_link.hpp for why the
// verdict is a reboot rather than starting a station here.

static void eth_fallback_task(void*) {
    EthFallbackWatch watch{};
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(ETH_FALLBACK_PERIOD_S * 1000));
        try {
            const bool configured = wifi_configured();
            const EthFallbackAction act =
                net_eth_fallback_step(watch, s_lease.load(), wifi_running(), configured);
            if (act == EthFallbackAction::Wait && watch.down_periods == 1)
                diag_printf("net: Ethernet lease lost — %d s before rebooting onto WiFi\n",
                            ETH_FALLBACK_PERIOD_S * ETH_FALLBACK_PERIODS);
            if (act != EthFallbackAction::Restart) continue;

            // An OTA in flight owns the device: interrupting a download re-runs it from scratch,
            // and interrupting an INSTALL is the one moment a reboot can leave a half-written
            // slot. The watch has already been spent, so this simply re-earns its verdict.
            if (ota_status().state == "updating") {
                diag_printf("net: Ethernet still down, but an OTA is running — deferring the "
                            "reboot\n");
                continue;
            }
            diag_printf("net: Ethernet has been down for %d s and WiFi is configured — rebooting "
                        "to come up on the radio\n", ETH_FALLBACK_PERIOD_S * ETH_FALLBACK_PERIODS);
            vTaskDelay(pdMS_TO_TICKS(500));   // let the diag line reach syslog first
            esp_restart();
        } catch (const std::exception& e) {
            diag_printf("net: fallback watch cycle failed (%s) — retrying\n", e.what());
        } catch (...) {
            diag_printf("net: fallback watch cycle failed — retrying\n");
        }
    }
}

void net_eth_fallback_start() {
    // Nothing to watch unless the wire is what brought this boot up: a board that fell back to
    // WiFi already has the radio's own endless reconnect, and one with no controller has no wire
    // to lose.
    if (!net_eth_fallback_watch_needed(s_present.load(), s_carried_boot.load())) return;
    if (xTaskCreate(eth_fallback_task, "eth_fb", 3072, nullptr, TASK_PRIO_ETH_FALLBACK, nullptr) != pdPASS)
        diag_printf("net: fallback watch task alloc failed — a pulled cable will need a manual "
                    "power cycle\n");
}

#endif  // CONFIG_DAIKIN_ETH_ENABLED

} // namespace daik
