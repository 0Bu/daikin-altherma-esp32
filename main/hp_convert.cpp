// Device-side value formatting on top of the host-tested logic/convert.hpp. See hp_convert.hpp.
#include "hp_convert.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include <cstdio>

namespace daik {

bool hp_format(const ValueDef& def, const uint8_t* payload, int payload_len, int rtype,
               std::string& out) {
    if (def.offset + def.size > payload_len) return false;
    Reading r = convert(def, payload + def.offset, rtype);   // rtype selects the conv-405 curve
    if (r.unimpl) return false;
    if (!r.ok && r.text[0] == '\0') return false;
    if (r.text[0]) { out = r.text; return true; }
    char b[32];
    // Per-converter decimal precision (logic/convert.hpp): 2 for ×0.01, 1 for scaled, 0 for integers.
    snprintf(b, sizeof(b), "%.*f", display_decimals(def.conv), r.value);
    out = b;
    return true;
}

} // namespace daik
