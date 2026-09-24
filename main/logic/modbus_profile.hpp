#pragma once
// Pure decision logic and state machine for Modbus profile auto-detection.
// Distinguishes base Daikin HomeHub (EKRHH / Altherma 3) from Altherma 4 units.
// Architecture rule: main/logic/ takes no def/ dependency.
#include <cstdint>
#include <string>
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
    bool          is_definitive; // whether this decision concludes the profile
    bool          is_affirmative;// whether this decision is affirmative (hardware-verified)
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
        return {current_profile, ok || failure_type == MbFailureType::Exception, !ok, true, true};
    }

    if (failure_type == MbFailureType::None) {
        if (is_extended_register(reg)) {
            if (is_valid_altherma4_probe_value(reg, raw_value)) {
                return {ModbusProfile::Altherma4, true, false, true, true};
            }
            if (raw_value == MB_UNSUPPORTED || raw_value == MB_UNAVAILABLE) {
                // Device affirmatively answered that the extended register is unsupported
                // or unavailable -> definitively HomeHub.
                return {ModbusProfile::HomeHub, true, false, true, true};
            }
            if (raw_value == MB_WAIT) {
                // Hub is syncing / waiting: do not count against retry budget, stay in Auto.
                return {ModbusProfile::Auto, true, false, false, false};
            }
            // Other non-valid raw values (e.g. 0 bar or > 600):
            // Fall back after consecutive retries or stay in Auto.
            if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
                return {ModbusProfile::HomeHub, true, false, true, false};
            }
            return {ModbusProfile::Auto, true, false, false, false};
        }
        return {current_profile, true, false, false, false};
    }

    if (failure_type == MbFailureType::Exception) {
        if (is_extended_register(reg)) {
            // Modbus Exception 02 (Illegal Data Address) affirmatively confirms this unit
            // does not have extended registers -> fall back definitively to HomeHub without error.
            if (failure_detail == 0x02 || failure_detail <= 0) {
                return {ModbusProfile::HomeHub, true, false, true, true};
            }
            // Transient exception (e.g. 06 Server Busy): stay in Auto to retry on next cycle.
            if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
                return {ModbusProfile::HomeHub, true, false, true, false};
            }
            return {ModbusProfile::Auto, true, false, false, false};
        }
        return {current_profile, true, true, false, false};
    }

    // Transport failures (Timeout, ConnectionClosed, InvalidResponse) on probe:
    if (is_extended_register(reg)) {
        // On transient transport error, stay in Auto unless retries are exhausted.
        if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
            return {ModbusProfile::HomeHub, false, false, true, false};
        }
        return {ModbusProfile::Auto, false, false, false, false};
    }

    return {current_profile, false, true, false, false};
}

// Pure state tracker for Modbus probe attempts across sessions and reconnects.
// Bookkeeps target endpoint, consecutive probe failures, active profile and affirmative resolution.
struct ModbusProbeTracker {
    std::string   target_host;
    int           target_port          = 0;
    int           target_unit          = 0;
    ModbusProfile active_profile       = ModbusProfile::Auto;
    ModbusProfile affirmative_profile  = ModbusProfile::Auto;
    int           consecutive_failures = 0;

    // Called when a socket opens to (host, port, unit).
    // Returns the profile to activate for this session.
    ModbusProfile on_socket_open(const std::string& host, int port, int unit) {
        if (host != target_host || port != target_port || unit != target_unit) {
            // Target changed: reset all probe state.
            target_host          = host;
            target_port          = port;
            target_unit          = unit;
            active_profile       = ModbusProfile::Auto;
            affirmative_profile  = ModbusProfile::Auto;
            consecutive_failures = 0;
            return ModbusProfile::Auto;
        }
        // Same target: if we have an affirmative resolution, use it.
        if (affirmative_profile != ModbusProfile::Auto) {
            active_profile = affirmative_profile;
            return affirmative_profile;
        }
        // If retries were exhausted on this target, stay on HomeHub fallback
        // so we don't reconnect-loop, but affirmative_profile remains Auto.
        if (consecutive_failures >= MODBUS_PROBE_MAX_RETRIES) {
            active_profile = ModbusProfile::HomeHub;
            return ModbusProfile::HomeHub;
        }
        active_profile = ModbusProfile::Auto;
        return ModbusProfile::Auto;
    }

    // Evaluate a probe attempt and update tracker state.
    ModbusProfileDecision evaluate_probe(MbFailureType failure_type, int failure_detail,
                                         uint16_t reg, uint16_t raw_value = 0) {
        int failures_for_eval = consecutive_failures;
        if (failure_type == MbFailureType::None && raw_value == MB_WAIT) {
            // Hub is syncing: do not count against retry budget.
        } else if (failure_type != MbFailureType::None ||
                   !is_valid_altherma4_probe_value(reg, raw_value)) {
            bool is_affirmative_homehub = false;
            if (failure_type == MbFailureType::Exception &&
                (failure_detail == 0x02 || failure_detail <= 0)) {
                is_affirmative_homehub = true;
            } else if (failure_type == MbFailureType::None &&
                       (raw_value == MB_UNSUPPORTED || raw_value == MB_UNAVAILABLE)) {
                is_affirmative_homehub = true;
            }
            if (!is_affirmative_homehub) {
                failures_for_eval = ++consecutive_failures;
            }
        }

        ModbusProfileDecision dec = evaluate_probe_result(
            active_profile, failure_type, failure_detail, reg, raw_value, failures_for_eval);

        if (dec.is_definitive) {
            active_profile = dec.next_profile;
            if (dec.is_affirmative) {
                affirmative_profile  = dec.next_profile;
                consecutive_failures = 0;
            }
        }
        return dec;
    }
};

} // namespace daik::logic
