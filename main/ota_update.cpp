// Pull-based signed OTA. See ota_update.hpp and docs/ARCHITECTURE.md → OTA. The manifest
// check + esp_https_ota download + downgrade gate are TODO ports from tesla-key-esp32/
// ota_update.cpp; the rollback health gate below is implemented so a bad OTA image reverts.
#include "ota_update.hpp"
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
#else
    return "";   // classic esp32
#endif
}

void ota_check_async(int64_t /*browser_epoch_ms*/) {
    // TODO: fetch CONFIG_DAIKIN_OTA_MANIFEST_URL, compare "version" to running, set s_status.
    s_status.state   = "idle";
    s_status.current = esp_app_get_description()->version;
    ESP_LOGW("ota", "check TODO — port from tesla-key-esp32/ota_update.cpp");
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

// Keep rollback armed until this freshly-flashed image has run healthily for ~90 s. If it
// crash-loops before that, the bootloader reverts to the previous slot. (See sdkconfig.defaults
// CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE.)
static void health_gate_task(void*) {
    vTaskDelay(pdMS_TO_TICKS(90000));
    const esp_partition_t* running = esp_ota_get_running_partition();
    esp_ota_img_states_t st;
    if (esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY) {
        esp_ota_mark_app_valid_cancel_rollback();
        ESP_LOGI("ota", "image marked valid (health gate passed)");
    }
    vTaskDelete(nullptr);
}

void ota_health_gate_arm() {
    xTaskCreate(health_gate_task, "ota_health", 3072, nullptr, 4, nullptr);
}

} // namespace daik
