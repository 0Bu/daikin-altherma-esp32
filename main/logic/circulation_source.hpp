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

// A threshold crossing is accepted only after later samples confirm it for `confirm_s`. The Wilo
// witness is a pulsed load in practice: while its controller is active, apower rises above the ON
// threshold for roughly five seconds and returns to zero between pulses. Treat repeated ON evidence
// with no gap longer than `confirm_s` as one activity train, while OFF still needs `confirm_s` of
// uninterrupted OFF evidence. A lone spike therefore cannot switch the state, but a real pulse train
// can. Values in the hysteresis band interrupt OFF confirmation and preserve an already confirmed
// state; merely waiting after one retained message is never evidence.
struct CirculationPowerTracker {
    CirculationPowerState confirmed = CirculationPowerState::Unknown;
    uint64_t on_since_ms = 0, last_on_ms = 0, off_since_ms = 0, last_observed_ms = 0;
    bool has_on_evidence = false, has_off_evidence = false, has_observation = false;

    void reset() {
        confirmed = CirculationPowerState::Unknown;
        on_since_ms = last_on_ms = off_since_ms = last_observed_ms = 0;
        has_on_evidence = has_off_evidence = has_observation = false;
    }

    void observe(double power_w, uint64_t received_ms, uint16_t on_tenths_w,
                 uint16_t off_tenths_w, uint16_t confirm_s) {
        if (has_observation && received_ms < last_observed_ms) reset();
        has_observation = true;
        last_observed_ms = received_ms;

        const CirculationPowerState sample =
            circulation_power_class(power_w, on_tenths_w, off_tenths_w);
        const uint64_t confirm_ms = static_cast<uint64_t>(confirm_s) * 1000;
        if (sample == CirculationPowerState::Unknown) {
            // A hysteresis-band value proves neither OFF nor a new ON pulse. It must break the
            // continuous OFF clock, but the last decisive ON sample still anchors pulse activity.
            has_off_evidence = false;
            off_since_ms = 0;
            return;
        }

        if (sample == CirculationPowerState::On) {
            has_off_evidence = false;
            off_since_ms = 0;
            if (!has_on_evidence || received_ms - last_on_ms > confirm_ms)
                on_since_ms = received_ms;
            has_on_evidence = true;
            last_on_ms = received_ms;
            if (confirmed != CirculationPowerState::On &&
                received_ms - on_since_ms >= confirm_ms)
                confirmed = CirculationPowerState::On;
            return;
        }

        if (!has_off_evidence) off_since_ms = received_ms;
        has_off_evidence = true;
        if (has_on_evidence && received_ms - last_on_ms >= confirm_ms) {
            has_on_evidence = false;
            on_since_ms = last_on_ms = 0;
        }
        if (confirmed != CirculationPowerState::Off &&
            received_ms - off_since_ms >= confirm_ms)
            confirmed = CirculationPowerState::Off;
    }
};

}  // namespace daik
