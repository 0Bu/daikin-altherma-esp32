#include "mqtt_retirement_store.hpp"
#include "nvs.h"
#include "nvs_storage.hpp" // nvs_factory_reset_latched — the factory-reset write latch
#include "rtos_guard.hpp"

namespace daik {
namespace {
constexpr const char* NAMESPACE = "mqtt_retire";
constexpr const char* KEY       = "provenance";

using Lock = SemGuard;
// Serializes the record write with the factory reset's erase of it. The latch alone is a
// check-then-act: a save that read "not latched" just before the reset latched could still be
// writing when mqtt_retirement_forget() runs — or, preempted, write after it — and the reboot would
// come up with a record the reset claimed to have erased. Under this lock a save either finishes
// before the erase starts, or starts after it and sees the latch (set by nvs_erase_all(), which the
// reset runs first). Created during static initialization, before any task can call in — the same
// allocation-free pattern ota_update.cpp and syslog.cpp use for their own mutexes.
StaticSemaphore_t s_mtx_storage;
SemaphoreHandle_t s_mtx = xSemaphoreCreateMutexStatic(&s_mtx_storage);
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
    Lock lk(s_mtx);
    // The latch is read UNDER the lock forget() takes; see s_mtx. A refusal is the ordinary
    // retryable save failure: discovery stays deferred, and the reboot that ends the reset (or the
    // owner's next retry of an incomplete one) makes the question moot.
    if (!lk.acquired() || nvs_factory_reset_latched()) return false;
    nvs_handle_t handle;
    if (::nvs_open(NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;
    esp_err_t error = ::nvs_set_blob(handle, KEY, bytes, sizeof(bytes));
    if (error == ESP_OK) error = ::nvs_commit(handle);
    ::nvs_close(handle);
    return error == ESP_OK;
}

bool mqtt_retirement_forget() noexcept {
    Lock lk(s_mtx);
    if (!lk.acquired()) return false;
    nvs_handle_t handle;
    // Probe read-only first. A read-only open of a namespace that was never written reports
    // NOT_FOUND without creating it; a read-write open would create an empty namespace entry — a
    // flash write that can itself fail on a full partition and turn "nothing to erase" into an
    // incomplete reset.
    const esp_err_t probed = ::nvs_open(NAMESPACE, NVS_READONLY, &handle);
    if (probed == ESP_ERR_NVS_NOT_FOUND) return true;
    if (probed != ESP_OK) return false;
    ::nvs_close(handle);
    if (::nvs_open(NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;
    // The whole dedicated namespace, not just KEY: anything another build may have kept here is
    // retirement metadata of the same installation, and the reset promises none of it survives.
    esp_err_t erased = ::nvs_erase_all(handle);
    if (erased == ESP_OK) erased = ::nvs_commit(handle);
    ::nvs_close(handle);
    return erased == ESP_OK;
}

} // namespace daik
