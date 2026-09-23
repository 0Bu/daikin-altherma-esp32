#pragma once
// Pure decision logic and state machine for Modbus profile auto-detection.
// Distinguishes base Daikin HomeHub (EKRHH / Altherma 3) from Altherma 4 units.
#include <cstdint>
#include "../def/altherma4.hpp"
#include "../def/homehub.hpp"
#include "config_model.hpp"
#include "modbus.hpp"

namespace daik::logic {

enum class MbFailureType {
    None,
    RequestBuild,
    SendTimeout,
    SendFailed,
    ResponseTimeout,
    ConnectionClosed,
    ReceiveFailed,
    InvalidResponse,
    Exception,
};

struct MbFailure {
    MbFailureType type   = MbFailureType::None;
    int           detail = -1; // errno, Modbus exception code, or MbParse ordinal
    uint16_t      reg    = 0;  // 1-based HomeHub data-model offset
};

// Maximum offset in the base HomeHub catalog.
// Offsets beyond this are extended Altherma 4 registers.
inline constexpr uint16_t MODBUS_BASE_MAX_OFFSET = 58;
static_assert(def::HOMEHUB_REGS[def::HOMEHUB_REG_COUNT - 1].offset <= MODBUS_BASE_MAX_OFFSET,
              "Base HomeHub max offset invariant");

inline constexpr bool is_extended_register(uint16_t offset) {
    return offset > MODBUS_BASE_MAX_OFFSET;
}

// Single register used to probe extended capabilities (Water pressure, offset 79).
inline constexpr uint16_t MODBUS_PROBE_REGISTER = 79;

inline bool is_valid_altherma4_probe_value(uint16_t reg, uint16_t raw) {
    if (mb_is_special(raw)) return false;
    if (reg == MODBUS_PROBE_REGISTER) {
        // Hydronic water pressure in bar * 100. Plausible range: > 0 and <= 600 (0..6.0 bar).
        return raw > 0 && raw <= 600;
    }
    return true;
}

struct ModbusProfileDecision {
    ModbusProfile next_profile;
    bool          link_ok;       // whether the connection / session should be kept alive
    bool          count_failure; // whether this outcome counts as an rx_fail error
};

inline ModbusProfileDecision evaluate_probe_result(ModbusProfile current_profile,
                                                   MbFailureType failure_type, int failure_detail,
                                                   uint16_t reg, uint16_t raw_value = 0) {
    if (current_profile != ModbusProfile::Auto) {
        bool ok = (failure_type == MbFailureType::None);
        return {current_profile, ok || failure_type == MbFailureType::Exception, !ok};
    }

    if (failure_type == MbFailureType::None) {
        if (is_extended_register(reg)) {
            if (is_valid_altherma4_probe_value(reg, raw_value)) {
                return {ModbusProfile::Altherma4, true, false};
            }
            if (raw_value == MB_UNSUPPORTED) {
                // Device explicitly answered that the extended register is unsupported -> HomeHub
                return {ModbusProfile::HomeHub, true, false};
            }
            // Other non-valid raw values (e.g. 0 bar or transient MB_WAIT):
            // stay in Auto without falsely promoting to Altherma4
            return {ModbusProfile::Auto, true, false};
        }
        return {current_profile, true, false};
    }

    if (failure_type == MbFailureType::Exception) {
        if (is_extended_register(reg)) {
            // Modbus Exception 02 (Illegal Data Address) confirms this unit does not have
            // extended registers -> fall back safely to HomeHub without error.
            if (failure_detail == 0x02 || failure_detail <= 0) {
                return {ModbusProfile::HomeHub, true, false};
            }
            // Transient exception (e.g. 06 Server Busy): stay in Auto to retry on next cycle.
            return {ModbusProfile::Auto, true, true};
        }
        return {current_profile, true, true};
    }

    // Transport failures (Timeout, ConnectionClosed, InvalidResponse) on probe:
    if (is_extended_register(reg)) {
        // EKRHH hub that closed the connection or timed out on unknown register:
        // fall back safely to HomeHub. Socket needs reconnect, but do not count error.
        return {ModbusProfile::HomeHub, false, false};
    }

    return {current_profile, false, true};
}

} // namespace daik::logic
