#pragma once
// Pure decision logic and state machine for Modbus profile auto-detection.
// Distinguishes base Daikin HomeHub (EKRHH / Altherma 3) from Altherma 4 units.
// Architecture rule: main/logic/ takes no def/ dependency.
#include <cstdint>
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
    bool          is_definitive; // whether this decision is affirmative / permanent for the target
};

// Evaluate probe result. consecutive_failures counts repeated non-affirmative attempts.
// Max 3 retries on transport/transient faults before defaulting to HomeHub.
inline constexpr int MODBUS_PROBE_MAX_RETRIES = 3;

inline ModbusProfileDecision evaluate_probe_result(ModbusProfile current_profile,
                                                   MbFailureType failure_type, int failure_detail,
                                                   uint16_t reg, uint16_t raw_value = 0,
                                                   int consecutive_failures = 1) {
    if (current_profile != ModbusProfile::Auto) {
        bool ok = (failure_type == MbFailureType::None);
        return {current_profile, ok || failure_type == MbFailureType::Exception, !ok, true};
    }

    if (failure_type == MbFailureType::None) {
        if (is_extended_register(reg)) {
            if (is_valid_altherma4_probe_value(reg, raw_value)) {
                return {ModbusProfile::Altherma4, true, false, true};
            }
            if (raw_value == MB_UNSUPPORTED || raw_value == MB_UNAVAILABLE) {
                // Device affirmatively answered that the extended register is unsupported
                // or unavailable -> definitively HomeHub.
                return {ModbusProfile::HomeHub, true, false, true};
            }
            // Other non-valid raw values (e.g. 0 bar or transient MB_WAIT):
            // Fall back after consecutive retries or stay in Auto.
            if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
                return {ModbusProfile::HomeHub, true, false, true};
            }
            return {ModbusProfile::Auto, true, false, false};
        }
        return {current_profile, true, false, false};
    }

    if (failure_type == MbFailureType::Exception) {
        if (is_extended_register(reg)) {
            // Modbus Exception 02 (Illegal Data Address) affirmatively confirms this unit
            // does not have extended registers -> fall back definitively to HomeHub without error.
            if (failure_detail == 0x02 || failure_detail <= 0) {
                return {ModbusProfile::HomeHub, true, false, true};
            }
            // Transient exception (e.g. 06 Server Busy): stay in Auto to retry on next cycle.
            if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
                return {ModbusProfile::HomeHub, true, false, true};
            }
            return {ModbusProfile::Auto, true, false, false};
        }
        return {current_profile, true, true, false};
    }

    // Transport failures (Timeout, ConnectionClosed, InvalidResponse) on probe:
    if (is_extended_register(reg)) {
        // On transient transport error, stay in Auto unless retries are exhausted.
        if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
            return {ModbusProfile::HomeHub, false, false, true};
        }
        return {ModbusProfile::Auto, false, false, false};
    }

    return {current_profile, false, true, false};
}

} // namespace daik::logic
