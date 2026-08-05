#pragma once
// Read-only MQTT power source for the potable-water circulation pump.  The source says whether the
// pump actually drew power; a Shelly relay output is deliberately not part of this contract because
// output=ON with apower=0 W is a normal and observed state.  Validation and hysteresis are IDF-free
// so the HTTP API, MQTT runtime and host tests share one definition.
#include <cstdint>
#include <string_view>

#include "reference_temperature.hpp"  // exact-topic/path validators + retained freshness contract

namespace daik {

inline constexpr size_t CIRC_SOURCE_NAME_MAX = 48;
inline constexpr uint32_t CIRC_SOURCE_MAX_AGE_DEFAULT_S = 120;
inline constexpr uint32_t CIRC_SOURCE_MAX_AGE_MIN_S = 10;
inline constexpr uint32_t CIRC_SOURCE_MAX_AGE_MAX_S = 3600;
inline constexpr uint16_t CIRC_SOURCE_ON_TENTHS_W_DEFAULT = 30;   // 3.0 W
inline constexpr uint16_t CIRC_SOURCE_OFF_TENTHS_W_DEFAULT = 10;  // 1.0 W
inline constexpr uint16_t CIRC_SOURCE_CONFIRM_DEFAULT_S = 60;
inline constexpr uint16_t CIRC_SOURCE_CONFIRM_MIN_S = 1;
inline constexpr uint16_t CIRC_SOURCE_CONFIRM_MAX_S = 600;
inline constexpr double CIRC_SOURCE_POWER_MAX_W = 100000.0;

inline bool circulation_source_config_valid(std::string_view name, std::string_view topic,
                                            std::string_view power_path,
                                            std::string_view timestamp_path,
                                            uint32_t max_age_s, uint16_t on_tenths_w,
                                            uint16_t off_tenths_w, uint16_t confirm_s,
                                            const char** why = nullptr) {
    auto fail = [&](const char* text) { if (why) *why = text; return false; };
    if (name.size() > CIRC_SOURCE_NAME_MAX) return fail("Source name is too long");
    if (!reference_topic_valid(topic, why)) return false;
    if (topic.empty()) return true;                 // empty topic is the explicit disabled state
    if (!reference_json_path_valid(power_path, why)) return false;
    if (!reference_json_path_valid(timestamp_path, why)) return false;
    if (max_age_s < CIRC_SOURCE_MAX_AGE_MIN_S || max_age_s > CIRC_SOURCE_MAX_AGE_MAX_S)
        return fail("Maximum age must be between 10 and 3600 seconds");
    if (on_tenths_w <= off_tenths_w)
        return fail("ON threshold must be greater than OFF threshold");
    if (confirm_s < CIRC_SOURCE_CONFIRM_MIN_S || confirm_s > CIRC_SOURCE_CONFIRM_MAX_S)
        return fail("Confirmation time must be between 1 and 600 seconds");
    return true;
}

enum class CirculationPowerState : uint8_t { Unknown = 0, Off = 1, On = 2 };

inline const char* circulation_power_state_name(CirculationPowerState state) {
    switch (state) {
        case CirculationPowerState::Off: return "off";
        case CirculationPowerState::On:  return "on";
        default:                         return "unknown";
    }
}

inline CirculationPowerState circulation_power_class(double power_w, uint16_t on_tenths_w,
                                                      uint16_t off_tenths_w) {
    if (power_w < 0.0 || power_w > CIRC_SOURCE_POWER_MAX_W) return CirculationPowerState::Unknown;
    const double tenths_w = power_w * 10.0;
    if (tenths_w >= on_tenths_w) return CirculationPowerState::On;
    if (tenths_w <= off_tenths_w) return CirculationPowerState::Off;
    return CirculationPowerState::Unknown;           // hysteresis band: keep the last proof
}

// A threshold crossing is accepted only after a later sample confirms that the same class persisted
// for `confirm_s`.  Merely waiting after one retained message is not enough evidence.  Values in the
// hysteresis band cancel a pending transition but preserve an already confirmed state.
struct CirculationPowerTracker {
    CirculationPowerState confirmed = CirculationPowerState::Unknown;
    CirculationPowerState candidate = CirculationPowerState::Unknown;
    uint64_t candidate_since_ms = 0;

    void reset() { confirmed = candidate = CirculationPowerState::Unknown; candidate_since_ms = 0; }

    void observe(double power_w, uint64_t received_ms, uint16_t on_tenths_w,
                 uint16_t off_tenths_w, uint16_t confirm_s) {
        const CirculationPowerState sample =
            circulation_power_class(power_w, on_tenths_w, off_tenths_w);
        if (sample == CirculationPowerState::Unknown) {
            candidate = CirculationPowerState::Unknown;
            candidate_since_ms = 0;
            return;
        }
        if (sample == confirmed) {
            candidate = CirculationPowerState::Unknown;
            candidate_since_ms = 0;
            return;
        }
        if (sample != candidate || received_ms < candidate_since_ms) {
            candidate = sample;
            candidate_since_ms = received_ms;
            return;
        }
        if (received_ms - candidate_since_ms >= static_cast<uint64_t>(confirm_s) * 1000) {
            confirmed = sample;
            candidate = CirculationPowerState::Unknown;
            candidate_since_ms = 0;
        }
    }
};

}  // namespace daik
