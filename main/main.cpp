// daikin-altherma-esp32 — boot orchestration.
//
// Boot flow:
//   1. NVS + runtime config load (config.cpp; defaults from Kconfig).
//   2. Network transport: the OPTIONAL wired link first (net.cpp — a W5500 on SPI, in practice an
//      ATOMIC PoE Base; absent on every board without one and then a single register read), else
//      WiFi STA if configured, else the captive setup portal (provisioning.cpp, SoftAP
//      "daikin-altherma-esp32-setup"). A wired board never opens that portal.
//   3. SNTP (wall clock), mDNS (<hostname>.local), HTTP server (:80), MQTT/HA bridge, OTA health gate.
//   4. Heat-pump poll engine (hp_poll.cpp): owns the X10A UART, polls each interval, fills the
//      value cache the web UI / MQTT read.
//
// Most of the heavy lifting lives in the modules; this file just wires them up in order.
#include "esp_app_desc.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "nvs_flash.h"

#include <cstdlib>      // abort — the deliberate ending for a boot sequence that threw
#include <exception>

#include "config.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "env3.hpp"
#include "checkup.hpp"
#include "history.hpp"
#include "syslog.hpp"
#include "hp_poll.hpp"
#include "hp_modbus.hpp"
#include "http_server.hpp"
#include "mqtt_ha.hpp"
#include "net.hpp"
#include "ota_update.hpp"
#include "provisioning.hpp"
#include "recovery_button.hpp"
#include "heap_guard.hpp"
#include "safe_mode.hpp"
#include "state_dwell.hpp"
#include "sntp_time.hpp"
#include "status_led.hpp"
#include "wifi.hpp"
#include "weather_forecast.hpp"

static const char* TAG = "main";

static void boot_sequence() {
    // --- NVS ---
    // A full partition or a newer-IDF layout is recoverable: erase + retry. ANY other error (and the
    // residual after a failed erase/retry) is NOT ignored — the old code checked only the two known
    // codes and let every other one fall through, booting on with persistence silently unavailable.
    // We continue on purpose (the web-UI recovery surface must still come up, and nvs_get_* already
    // fall back to their defaults when nvs_open fails) but make the degraded state LOUD, and replay it
    // into the diag ring below once it exists so it also reaches /diag + syslog.
    esp_err_t nvs_err = nvs_flash_init();
    if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        if (nvs_flash_erase() == ESP_OK) nvs_err = nvs_flash_init();
    }
    if (nvs_err != ESP_OK)
        ESP_LOGE(TAG, "nvs_flash_init failed: %s — continuing WITHOUT persistence this boot "
                      "(config, WiFi-rollback backup and the safe-mode crash counter are not durable)",
                 esp_err_to_name(nvs_err));
    // ESP-NETIF is a process-wide singleton and its API contract requires exactly one call from
    // app startup. Keeping it here also makes the STA-failure -> setup-portal fallback safe: both
    // network branches create their own netif, but neither re-initializes the global stack.
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    daik::diag_log_init();
    if (nvs_err != ESP_OK)               // now that the diag ring exists, record the degraded boot
        daik::diag_printf("nvs: init failed (%s) — running WITHOUT persistence this boot\n",
                          esp_err_to_name(nvs_err));
    daik::diag_crash_capture();          // read reset reason + core-dump summary once, before services
    daik::config_load();
    // --- Board-local hardware (status indicator + recovery button) ---
    // AFTER config_load, not before: both the indicator's pin/driver and the button's pin are
    // runtime settings now (one image, several boards — see logic/config_model.hpp), so starting
    // them earlier would read an unloaded config. It costs the few tens of milliseconds of NVS init
    // and crash capture above, during which the indicator stays dark; the alternative was a
    // compile-time pin, which is the thing this replaces.
    // The button starts even in safe mode (below): a boot-looping board is exactly when a physical
    // factory reset is the only way back in.
    daik::status_led_start();
    daik::recovery_button_start();
    daik::safe_mode_begin();             // crash-loop guard: count crash boots, latch safe mode past threshold
    daik::heap_guard_begin();            // read + clear the heap-watchdog restart breadcrumb this boot inherited
    daik::syslog_init();
    const daik::Config& cfg = daik::config();
    ESP_LOGI(TAG, "daikin-altherma-esp32 %s", esp_app_get_description()->version);
    ESP_LOGI(TAG, "cfg: profile=%s proto=%c rx=%d tx=%d",
             cfg.profile.c_str(), static_cast<char>(cfg.proto), cfg.rx_pin, cfg.tx_pin);

    // --- Networking: Ethernet, then STA, then the captive setup portal ---
    // THE ORDER IS THE POLICY, and each step is a host-tested rule in logic/net_link.hpp rather
    // than an `if` invented here:
    //
    //   1. The wire is asked FIRST, and cheaply. net_eth_start() answers in ~4 s when no cable is
    //      connected (the PHY reports link as soon as auto-negotiation completes) and only then
    //      spends a DHCP deadline. On a board with no W5500 at all it is one SPI register read.
    //   2. WiFi starts only if the wire did NOT come up (net_wifi_start_needed): a wired board must
    //      not pay ~50 KB of heap and a second netif for a radio nothing will route over.
    //   3. The portal opens only if NEITHER did (net_portal_needed). This is the rule a wire makes
    //      load-bearing: a wired board with no stored SSID has wifi_up == false and would otherwise
    //      open an OPEN SoftAP nobody is coming to configure — while that AP restricts the HTTP
    //      surface (logic/http_surface.hpp), withholding the whole API from the LAN the device is
    //      actually reachable on.
    //
    // wifi_start_sta() still returns false on a first-boot connect failure (creds presumed wrong)
    // after tearing the STA stack down, so the portal comes up on a clean WiFi state. Runtime drops
    // are handled forever by wifi.cpp's reconnect handler + gateway watchdog; a runtime loss of the
    // WIRE on a board that has no station running is handled by net_eth_fallback_start() below.
    const bool eth_up = daik::net_eth_start();
    bool wifi_up = false;
    if (daik::net_wifi_start_needed(eth_up, daik::wifi_configured()))
        wifi_up = daik::wifi_start_sta();
    if (daik::net_portal_needed(eth_up, wifi_up))
        daik::provisioning_start_ap();   // SoftAP + captive portal; serves www/setup.html
    daik::net_eth_fallback_start();      // no-op unless the wire is what carries this boot

    // --- Wall clock ---
    // The network stack was initialized once above. Harmless to start before the STA has an IP (or
    // in AP-only setup mode) — the client idles/retries on its own task until one shows up.
    daik::sntp_time_start();

    // --- Services ---
    // The web UI + OTA are ALWAYS started (they are the recovery surface). In safe mode all optional
    // background consumers — X10A, MQTT, Open-Meteo weather, and HomeHub — are skipped, so a bad-config
    // boot loop stays fixable from the browser instead of over USB.
    // History has two independent producer tasks. Create their shared lock before either starts —
    // and before HTTP can ask for a snapshot — rather than racing two lazy creators on first boot.
    daik::history_start();
    daik::checkup_start();   // same rule: judge .noinit before a producer task exists
    daik::dwell_start();     // and the per-row state ages, judged on the same terms
    daik::http_start();                  // esp_http_server on :80 (web UI + config + OTA + MCP)
    if (!daik::safe_mode_active()) {
        daik::env3_start();              // optional outdoor climate sensor (no-op unless configured)
        // Start the core X10A owner before MQTT so the bridge can promote as soon as a valid bus
        // response arrives. Until then MQTT uses a no-LWT subscriber-only connection for the room
        // source; no installation discovery/state/diagnostic payload is published.
        daik::hp_poll_start();           // X10A poll engine
        daik::mqtt_ha_start();           // HA MQTT-Discovery bridge (no-op if mqtt_uri empty)
        daik::weather_forecast_start();  // direct Open-Meteo HTTPS/JSON fetch (no-op without location)
        // The HomeHub Modbus stack — a SECOND, INDEPENDENT source (docs/MODBUS_PROTOCOL.md), not an
        // alternative to the line above: both run, and neither notices the other failing. The
        // A saved address is polled; an empty address creates no task/socket/traffic and never
        // triggers discovery. mDNS runs only from the dialog's explicit Search action.
        // Skipped in safe mode for the same reason the consumers above are: a boot-looping board is being
        // recovered through the web UI, and every optional consumer stays out of the way.
        daik::mb_start();
    } else {
        ESP_LOGW(TAG, "SAFE MODE: ENV III + X10A + HomeHub + MQTT + Open-Meteo weather skipped — recover the config via the web UI");
    }
    daik::ota_health_gate_arm();         // keep rollback armed until this image proves healthy
    daik::safe_mode_arm_healthy();       // clear the crash counter after BOOT_HEALTHY_S of continuous uptime
}

// An escape from the boot sequence, named and then made to count.
//
// app_main is a C frame boundary like every HTTP handler and task loop this firmware already guards
// (CLAUDE.md → "Every allocating FreeRTOS task loop must self-guard"): an exception that leaves it
// reaches std::terminate and abort()s ANONYMOUSLY, with the reset reason the only evidence that
// anything happened. And boot is not a fanciful place to throw — config_load(), http_start() and the
// service starts below it all allocate, on a device whose whole memory section is about
// std::bad_alloc being reachable.
//
// ABORT is the deliberate choice among the three endings, and the other two are actively wrong here:
//   • RETURNING would leave a half-initialised firmware claiming to run — some services up, some
//     not, and /status reporting a device that does not exist.
//   • esp_restart() looks like the careful option and is the worst one: safe_mode_begin() classifies
//     a "sw" reset as an INTENTIONAL reboot and CLEARS the crash counter on it (boot_reset_was_crash
//     excludes it by name, so a provisioning burst cannot false-trip safe mode). A boot sequence
//     that throws every time would therefore restart forever without ever accumulating a single
//     crash boot — the one failure mode safe mode exists to end, made permanent by the mechanism
//     meant to end it.
//   • abort() panics, which is a crash reset: it writes a core dump, and it COUNTS. Four of them and
//     safe_mode latches, the poll engine and MQTT stay down, and the device comes up on the web UI
//     where the configuration that caused it can be fixed. The existing machinery does the work.
[[noreturn]] static void boot_failed(const char* what) {
    // Serial first, because it is the only sink guaranteed to exist this early — the diag ring may
    // not be initialised, and syslog certainly is not.
    ESP_LOGE(TAG, "boot sequence threw (%s) — aborting so this counts as a crash boot", what);
    daik::diag_printf("boot: FAILED — boot sequence threw (%s)\n", what);
    abort();
}

extern "C" void app_main() {
    try {
        boot_sequence();
    } catch (const std::exception& e) {
        boot_failed(e.what());
    } catch (...) {
        boot_failed("unknown exception");
    }
}
