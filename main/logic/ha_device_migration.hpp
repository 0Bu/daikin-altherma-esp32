#pragma once
// One-time migration gate for HomeHub MQTT discovery. Builds before v1 published Modbus entities
// under a separate HA device. Merely changing dev.ids does not move an existing MQTT entity in
// Home Assistant: the retained config has to be removed, then announced again. The firmware keeps
// the same discovery topics and unique ids so entity ids, recorder history and customisations stay
// intact; this gate only supplies a bounded delete/re-add window and a persisted completion version.
// IDF-free so reconnect/timing/failure semantics are host-tested.
#include <cstdint>

namespace daik {

inline constexpr const char* HA_MODBUS_DEVICE_MIGRATION_KEY = "ha_mb_device"; // NVS keys: max 15
inline constexpr int32_t HA_MODBUS_DEVICE_MIGRATION_VERSION = 1;
inline constexpr int64_t HA_MODBUS_DEVICE_MIGRATION_DELAY_US = 3LL * 1000 * 1000;

struct HaModbusDeviceMigration {
    bool    pending  = false;
    bool    waiting  = false;
    int64_t deadline_us = 0;

    void load(int32_t stored_version) {
        pending = stored_version < HA_MODBUS_DEVICE_MIGRATION_VERSION;
        waiting = false;
        deadline_us = 0;
    }

    // Called once per MQTT connect. A reconnect before replacement restarts the full safe window:
    // retained deletes are idempotent, while publishing too soon could leave entities on the old
    // device in a slow Home Assistant event loop.
    bool begin(bool modbus_enabled, int64_t now_us) {
        if (!pending || !modbus_enabled) return false;
        waiting = true;
        deadline_us = now_us + HA_MODBUS_DEVICE_MIGRATION_DELAY_US;
        return true;
    }

    bool replacement_due(int64_t now_us) const {
        return !waiting || now_us >= deadline_us;
    }

    // Complete only after replacement discovery has been queued (or after the disabled path has
    // removed the old configs). The caller persists the version; a failed NVS write deliberately
    // leaves pending=true so a later reconnect/boot retries rather than silently stranding entities.
    bool completion_needs_persist() {
        waiting = false;
        return pending;
    }

    void persisted() { pending = false; waiting = false; }
};

} // namespace daik
