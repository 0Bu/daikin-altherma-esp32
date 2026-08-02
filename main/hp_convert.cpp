// Device-side value formatting on top of the host-tested logic/convert.hpp. See hp_convert.hpp.
#include "hp_convert.hpp"
#include "logic/availability.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include "logic/error_codes.hpp"
#include <cstdio>

namespace daik {

bool hp_format(const ValueDef& def, const uint8_t* payload, int payload_len, int rtype,
               std::string& out, const ValueDef* profile, size_t count) {
    if (def.offset + def.size > payload_len) return false;
    Reading r = convert(def, payload + def.offset, rtype);   // rtype selects the conv-405 curve
    if (r.unimpl) return false;
    // Drop impossible placeholders: a °C reading off the physical envelope (576 °C, ±3276.x), or a
    // refrigerant pressure at 0 bar (an unreported transducer — a sealed circuit is never at vacuum).
    if (!reading_plausible(def, r, profile, count)) return false;
    // Then the adjudicated per-row availability ledger (logic/availability.hpp): a value the envelope
    // above cannot see is wrong because it is perfectly ordinary — a target temperature of exactly
    // 0 °C on a row that is simply not populated on this unit (#209 defect 2). Applied here, beside
    // reading_plausible and for the same reason, so convert() keeps its intrinsic per-converter
    // semantics and the domain audit still sees them unchanged.
    // Page-context policies need the same payload this value was decoded from. In particular, an
    // all-zero 0xA1 reply identifies an absent second-outdoor-unit page; a zero in one populated
    // thermistor row does not. Passing the whole current reply keeps that distinction structural.
    if (!value_available(def, r.ok, r.value, payload, static_cast<size_t>(payload_len))) return false;
    if (!r.ok && r.text[0] == '\0') return false;
    // conv 204 (fault code) gets an English description appended when the table covers it. Exact
    // ON/OFF text is normalized defensively even though all current binary/fan converters are
    // numeric already: no future text converter may reintroduce those wire values.
    if (r.text[0]) {
        if (const char* binary = on_off_number(r.text)) out = binary;
        else out = (def.conv == 204) ? format_error_code(r.text) : r.text;
        return true;
    }
    char b[32];
    // Per-converter decimal precision (logic/convert.hpp): 2 for ×0.01, 1 for scaled, 0 for integers.
    snprintf(b, sizeof(b), "%.*f", display_decimals(def.conv), r.value);
    out = b;
    return true;
}

} // namespace daik
