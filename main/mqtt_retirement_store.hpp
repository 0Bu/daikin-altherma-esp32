#pragma once

#include "logic/mqtt_retirement_store.hpp"

namespace daik {

enum class MqttRetirementStoreLoad { Missing, Ready, Error, Incompatible };

// Dedicated metadata namespace, owned by the MQTT task. All failures leave out unchanged.
MqttRetirementStoreLoad mqtt_retirement_store_load(MqttRetirementRecord& out) noexcept;

// Caller must finish predecessor retirement BEFORE saving, and save successfully BEFORE discovery.
// A failure is retryable; this function never initializes or erases NVS or changes the service
// blob.
[[nodiscard]] bool mqtt_retirement_store_save(const MqttRetirementRecord& record) noexcept;

} // namespace daik
