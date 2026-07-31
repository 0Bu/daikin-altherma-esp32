#pragma once
// NAMED MEANINGS FOR THE FEW X10A BIT ROWS THAT ARE NOT PLAIN ON/OFF FLAGS.
//
// Converter family 300-307 deliberately keeps one common wire/publication contract: numeric 0/1.
// Most rows really are activity flags (pump running, defrost active, thermostat demand), but two
// valves encode a selected path and the two Smart-Grid contacts form one four-state mode. Rendering
// all of those as ON/OFF throws away meaning the generated catalog itself documents.
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
