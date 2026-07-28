// Device-side value formatting on top of the host-tested logic/convert.hpp. See hp_convert.hpp.
#include "hp_convert.hpp"
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
