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
    bool          link_ok;        // whether the connection / session should be kept alive
    bool          count_failure;  // whether this outcome counts as an rx_fail error
    bool          is_definitive;  // whether this decision concludes the profile
    bool          is_affirmative; // whether this decision is affirmative (hardware-verified)
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

inline constexpr uint32_t MODBUS_PROBE_INITIAL_BACKOFF_S = 600;    // 10 minutes
inline constexpr uint32_t MODBUS_PROBE_MAX_BACKOFF_S     = 14400;  // 4 hours

// Pure state tracker for Modbus probe attempts across sessions and reconnects.
// Bookkeeps target endpoint, consecutive probe failures, active profile, affirmative resolution,
// and exponential back-off re-probing after retry exhaustion.
struct ModbusProbeTracker {
    std::string        target_host;
    int                target_port          = 0;
    int                target_unit          = 0;
    ModbusProfile      active_profile       = ModbusProfile::Auto;
    ModbusProfile      affirmative_profile  = ModbusProfile::Auto;
    ModbusProfileBasis profile_basis        = ModbusProfileBasis::Probing;
    int                consecutive_failures = 0;
    int                exhaustion_count     = 0;
    uint32_t           next_reprobe_time_s  = 0;

    // Called when a socket opens to (host, port, unit).
    // now_s: monotonic seconds since boot.
    ModbusProfile on_socket_open(const std::string& host, int port, int unit, uint32_t now_s = 0) {
        if (host != target_host || port != target_port || unit != target_unit) {
            // Target changed: reset all probe state.
            target_host          = host;
            target_port          = port;
            target_unit          = unit;
            active_profile       = ModbusProfile::Auto;
            affirmative_profile  = ModbusProfile::Auto;
            profile_basis        = ModbusProfileBasis::Probing;
            consecutive_failures = 0;
            exhaustion_count     = 0;
            next_reprobe_time_s  = 0;
            return ModbusProfile::Auto;
        }
        // Same target: if we have an affirmative resolution, use it permanently.
        if (affirmative_profile != ModbusProfile::Auto) {
            active_profile = affirmative_profile;
            profile_basis  = ModbusProfileBasis::Affirmative;
            return affirmative_profile;
        }
        // If in backoff period after retry exhaustion:
        if (next_reprobe_time_s > 0) {
            if (now_s < next_reprobe_time_s) {
                active_profile = ModbusProfile::HomeHub;
                profile_basis  = ModbusProfileBasis::Fallback;
                return ModbusProfile::HomeHub;
            }
            // Backoff elapsed: probe again.
            next_reprobe_time_s  = 0;
            consecutive_failures = 0;
        }
        active_profile = ModbusProfile::Auto;
        profile_basis  = ModbusProfileBasis::Probing;
        return ModbusProfile::Auto;
    }

    // Whether the caller should perform an extended register probe during the cycle.
    bool should_probe(uint32_t now_s = 0) const {
        if (affirmative_profile != ModbusProfile::Auto) {
            return false;
        }
        if (next_reprobe_time_s > 0 && now_s < next_reprobe_time_s) {
            return false;
        }
        return true;
    }

    // Evaluate a probe attempt and update tracker state.
    // now_s: monotonic seconds since boot (used to calculate backoff if exhausted).
    ModbusProfileDecision evaluate_probe(MbFailureType failure_type, int failure_detail,
                                         uint16_t reg, uint16_t raw_value = 0,
                                         uint32_t now_s = 0) {
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

        const ModbusProfile eval_profile =
            (affirmative_profile == ModbusProfile::Auto) ? ModbusProfile::Auto : active_profile;
        ModbusProfileDecision dec = evaluate_probe_result(
            eval_profile, failure_type, failure_detail, reg, raw_value, failures_for_eval);

        if (dec.is_definitive) {
            active_profile = dec.next_profile;
            if (dec.is_affirmative) {
                affirmative_profile  = dec.next_profile;
                profile_basis        = ModbusProfileBasis::Affirmative;
                consecutive_failures = 0;
                exhaustion_count     = 0;
                next_reprobe_time_s  = 0;
            } else {
                profile_basis = ModbusProfileBasis::Fallback;
                const uint32_t shift = std::min(exhaustion_count, 6);
                uint32_t delay_s = MODBUS_PROBE_INITIAL_BACKOFF_S << shift;
                if (delay_s > MODBUS_PROBE_MAX_BACKOFF_S) {
                    delay_s = MODBUS_PROBE_MAX_BACKOFF_S;
                }
                next_reprobe_time_s  = now_s + delay_s;
                exhaustion_count++;
                consecutive_failures = 0;
            }
        } else {
            profile_basis = ModbusProfileBasis::Probing;
        }
        return dec;
    }
};

} // namespace daik::logic
