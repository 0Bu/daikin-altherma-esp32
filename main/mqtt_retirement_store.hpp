#pragma once

#include "logic/mqtt_retirement_store.hpp"

namespace daik {

enum class MqttRetirementStoreLoad { Missing, Ready, Error, Incompatible };

// Dedicated metadata namespace, owned by the MQTT task. All failures leave out unchanged.
MqttRetirementStoreLoad mqtt_retirement_store_load(MqttRetirementRecord& out) noexcept;

// Caller must finish predecessor retirement BEFORE saving, and save successfully BEFORE discovery.
// A failure is retryable; this function never initializes or erases NVS or changes the service
// blob. Refused (false, nothing written) while a factory reset has latched NVS
// (nvs_factory_reset_latched()): the record is one of the things that reset erases, and the running
// MQTT task must not recreate it between that erase and the reboot.
[[nodiscard]] bool mqtt_retirement_store_save(const MqttRetirementRecord& record) noexcept;

// The factory reset's erase of this store (recovery_button.cpp is its only caller). Erases every
// entry of the dedicated namespace and returns true only when nothing is left behind; a namespace
// or record that was never written is success, because "no record survives" already holds. False
// on any open/erase/commit failure — the reset then counts as INCOMPLETE and does not reboot.
// Serialized with mqtt_retirement_store_save(), so a save that was already past its latch check
// lands BEFORE this erase rather than after it.
[[nodiscard]] bool mqtt_retirement_forget() noexcept;

} // namespace daik
