// daikin-altherma-esp32 — boot orchestration.
//
// Boot flow:
//   1. NVS + runtime config load (config.cpp; defaults from Kconfig).
//   2. WiFi: if configured -> STA (with the endless-reconnect + gateway watchdog); else start
//      the captive setup portal (provisioning.cpp, SoftAP "daikin-altherma-esp32-setup").
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

#include "config.hpp"
#include "diag_crash.hpp"
#include "diag_log.hpp"
#include "history.hpp"
#include "syslog.hpp"
#include "hp_poll.hpp"
#include "hp_modbus.hpp"
#include "http_server.hpp"
#include "mqtt_ha.hpp"
#include "ota_update.hpp"
#include "provisioning.hpp"
#include "recovery_button.hpp"
#include "safe_mode.hpp"
#include "sntp_time.hpp"
#include "status_led.hpp"
#include "wifi.hpp"

static const char* TAG = "main";

extern "C" void app_main() {
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
    daik::syslog_init();
    const daik::Config& cfg = daik::config();
    ESP_LOGI(TAG, "daikin-altherma-esp32 %s", esp_app_get_description()->version);
    ESP_LOGI(TAG, "cfg: profile=%s proto=%c rx=%d tx=%d",
             cfg.profile.c_str(), static_cast<char>(cfg.proto), cfg.rx_pin, cfg.tx_pin);

    // --- Networking: STA or captive setup portal ---
    // wifi_start_sta() returns false on a first-boot connect failure (creds presumed wrong) after
    // tearing the STA stack back down, so the portal comes up on a clean WiFi state. Runtime drops
    // (once online) are handled forever by wifi.cpp's reconnect handler + gateway watchdog.
    if (!daik::wifi_configured() || !daik::wifi_start_sta()) {
        daik::provisioning_start_ap();   // SoftAP + captive portal; serves www/setup.html
    }

    // --- Wall clock ---
    // The network stack was initialized once above. Harmless to start before the STA has an IP (or
    // in AP-only setup mode) — the client idles/retries on its own task until one shows up.
    daik::sntp_time_start();

    // --- Services ---
    // The web UI + OTA are ALWAYS started (they are the recovery surface). In safe mode the two
    // background subsystems a bad config could crash on — the X10A poll engine and the MQTT bridge —
    // are skipped, so a wrong-pin config-loop stays fixable from the browser instead of over USB.
    // History has two independent producer tasks. Create their shared lock before either starts —
    // and before HTTP can ask for a snapshot — rather than racing two lazy creators on first boot.
    daik::history_start();
    daik::http_start();                  // esp_http_server on :80 (web UI + config + OTA + MCP)
    if (!daik::safe_mode_active()) {
        daik::mqtt_ha_start();           // HA MQTT-Discovery bridge (no-op if mqtt_uri empty)
        daik::hp_poll_start();           // X10A poll engine
        // The HomeHub Modbus stack — a SECOND, INDEPENDENT source (docs/MODBUS_PROTOCOL.md), not an
        // alternative to the line above: both run, and neither notices the other failing. The
        // A saved address is polled; an empty address creates no task/socket/traffic and never
        // triggers discovery. mDNS runs only from the dialog's explicit Search action.
        // Skipped in safe mode for the same reason the two above are: a boot-looping board is being
        // recovered through the web UI, and every optional consumer stays out of the way.
        daik::mb_start();
    } else {
        ESP_LOGW(TAG, "SAFE MODE: X10A poll engine + HomeHub stack + MQTT bridge skipped — recover the config via the web UI");
    }
    daik::ota_health_gate_arm();         // keep rollback armed until this image proves healthy
    daik::safe_mode_arm_healthy();       // clear the crash counter after BOOT_HEALTHY_S of continuous uptime
}
