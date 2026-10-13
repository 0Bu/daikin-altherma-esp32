#include "mqtt_retirement_store.hpp"
#include "nvs.h"

namespace daik {
namespace {
constexpr const char* NAMESPACE = "mqtt_retire";
constexpr const char* KEY       = "provenance";
} // namespace

MqttRetirementStoreLoad mqtt_retirement_store_load(MqttRetirementRecord& out) noexcept {
    nvs_handle_t    handle;
    const esp_err_t opened = ::nvs_open(NAMESPACE, NVS_READONLY, &handle);
    if (opened == ESP_ERR_NVS_NOT_FOUND) return MqttRetirementStoreLoad::Missing;
    if (opened != ESP_OK) return MqttRetirementStoreLoad::Error;
    size_t    size  = 0;
    esp_err_t error = ::nvs_get_blob(handle, KEY, nullptr, &size);
    if (error != ESP_OK || size != MQTT_RETIREMENT_STORE_BYTES) {
        ::nvs_close(handle);
        if (error == ESP_ERR_NVS_NOT_FOUND) return MqttRetirementStoreLoad::Missing;
        return error == ESP_OK ? MqttRetirementStoreLoad::Incompatible
                               : MqttRetirementStoreLoad::Error;
    }
    uint8_t bytes[MQTT_RETIREMENT_STORE_BYTES];
    error = ::nvs_get_blob(handle, KEY, bytes, &size);
    ::nvs_close(handle);
    if (error != ESP_OK) return MqttRetirementStoreLoad::Error;
    return mqtt_retirement_decode(bytes, size, out) ? MqttRetirementStoreLoad::Ready
                                                    : MqttRetirementStoreLoad::Incompatible;
}

bool mqtt_retirement_store_save(const MqttRetirementRecord& record) noexcept {
    uint8_t bytes[MQTT_RETIREMENT_STORE_BYTES];
    if (!mqtt_retirement_encode(record, bytes, sizeof(bytes))) return false;
    nvs_handle_t handle;
    if (::nvs_open(NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;
    esp_err_t error = ::nvs_set_blob(handle, KEY, bytes, sizeof(bytes));
    if (error == ESP_OK) error = ::nvs_commit(handle);
    ::nvs_close(handle);
    return error == ESP_OK;
}

} // namespace daik
