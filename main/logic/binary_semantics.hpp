#pragma once
// NAMED MEANINGS FOR THE FEW X10A BIT ROWS THAT ARE NOT PLAIN ON/OFF FLAGS.
//
// Converter family 300-307 deliberately keeps one common wire/publication contract: numeric 0/1.
// Most rows really are activity/output flags (pump running, defrost active, thermostat demand), the
// 3-way valve encodes a selected path and the two Smart-Grid contacts form one four-state mode. The
// historical `valve_heat` id for the 2-way/heating-cooling output is retained for API/history
// compatibility, but its presentation remains ON/OFF: this output is separate from the controller's
// configured/current mode and its zero cannot safely be promoted to Cooling.
//
// The rule is structural rather than label-based. Labels are generated, vary between profiles and
// are an API/history identity; (register page, byte offset, converter) is the actual bit identity.
// The returned stable id is optional metadata for presentation consumers only. It does not change
// decoding, MQTT, Home Assistant, history or the numeric /values payload.
#include <cstdint>

namespace daik::logic {

inline constexpr const char* binary_semantic_for(uint8_t reg, uint8_t off, int conv) {
    if (reg == 0x60 && off == 12 && conv == 306) return "valve_dhw";
    if (reg == 0x60 && off == 12 && conv == 307) return "valve_heat";
    if (reg == 0x60 && off == 11 && conv == 301) return "smart_grid_contact_1";
    if (reg == 0x60 && off == 11 && conv == 302) return "smart_grid_contact_2";
    return nullptr;
}

} // namespace daik::logic
