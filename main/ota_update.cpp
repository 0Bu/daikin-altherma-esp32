// Pull-based signed OTA. See ota_update.hpp and docs/ARCHITECTURE.md → OTA. The manifest
// check + esp_https_ota download + downgrade gate are TODO; the rollback health gate below is
// implemented so a bad OTA image reverts.
#include "ota_update.hpp"
#include "logic/health_gate.hpp"
#include "wifi.hpp"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace daik {

static OtaStatus s_status;

const char* ota_img_suffix() {
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    return "-s3";
#elif defined(CONFIG_IDF_TARGET_ESP32C3)
    return "-c3";
#elif defined(CONFIG_IDF_TARGET_ESP32C6)
    return "-c6";
#elif defined(CONFIG_IDF_TARGET_ESP32C5)
    return "-c5";
#else
    return "";   // classic esp32
#endif
}

void ota_check_async(int64_t /*browser_epoch_ms*/) {
    // TODO: fetch CONFIG_DAIKIN_OTA_MANIFEST_URL, compare "version" to running, set s_status.
    s_status.state   = "idle";
    s_status.current = esp_app_get_description()->version;
    ESP_LOGW("ota", "check TODO");
}

void ota_update_async() {
    // TODO: esp_https_ota into the inactive slot with the downgrade gate + signature verify.
    s_status.state = "idle";
    ESP_LOGW("ota", "update TODO");
}

OtaStatus ota_status() {
    s_status.current = esp_app_get_description()->version;
    return s_status;
}

// Keep rollback armed until this OTA image has proven HEALTHY, not merely survived a timer: it must
// have run for a base window (survives an early crash-loop -> bootloader reverts) AND reached
// connectivity (STA online, or the setup portal if it has no credentials). A boots-but-broken update
// — e.g. a WiFi regression that can never get online to be re-flashed — is left PENDING_VERIFY, so
// the next reboot rolls back to the previous slot instead of sealing the break in. The decision is
// the host-tested daik::health_gate_decide(); see logic/health_gate.hpp + docs/SECURITY.md.
//
// Only PENDING_VERIFY images are rollback-armed, and those exist ONLY via esp_ota_set_boot_partition
// (a real OTA), which always leaves a valid previous slot. A USB/@flash_args image boots in
// UNDEFINED state (blank otadata) and short-circuits below — so this can never strand a fresh board.
static constexpr int kHealthBaseWindowS = 90;    // min uptime before committing a healthy image
static constexpr int kHealthHardCapS    = 600;   // keep trying to commit this long; a genuinely
                                                 // good image at a briefly-offline site still gets
                                                 // sealed in. Only a still-offline image past this
                                                 // stays rollback-armed (reverts on next reboot).
static constexpr int kHealthPollS       = 5;     // re-evaluate cadence

static void health_gate_task(void*) {
    const esp_partition_t* running = esp_ota_get_running_partition();
    esp_ota_img_states_t st;
    if (esp_ota_get_state_partition(running, &st) != ESP_OK || st != ESP_OTA_IMG_PENDING_VERIFY) {
        vTaskDelete(nullptr);   // not a rollback-armed OTA image (USB flash / already valid) -> nothing to do
        return;
    }
    for (int elapsed = 0;; elapsed += kHealthPollS) {
        const bool connected = wifi_info().connected;
        const HealthVerdict v = health_gate_decide(elapsed, kHealthBaseWindowS, kHealthHardCapS,
                                                   wifi_configured(), connected);
        if (v == HealthVerdict::Commit) {
            esp_ota_mark_app_valid_cancel_rollback();
            ESP_LOGI("ota", "image marked valid (health gate passed after %ds, wifi=%d)", elapsed, connected);
            break;
        }
        if (v == HealthVerdict::GiveUp) {
            ESP_LOGW("ota", "health gate: no connectivity after %ds; leaving image PENDING_VERIFY "
                            "-> next reboot rolls back to the previous firmware", elapsed);
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(kHealthPollS * 1000));
    }
    vTaskDelete(nullptr);
}

void ota_health_gate_arm() {
    xTaskCreate(health_gate_task, "ota_health", 3072, nullptr, 4, nullptr);
}

} // namespace daik
