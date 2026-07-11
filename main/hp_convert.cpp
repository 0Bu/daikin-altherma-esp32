// Device-side value formatting on top of the host-tested logic/convert.hpp. See hp_convert.hpp.
#include "hp_convert.hpp"
#include "logic/convert.hpp"
#include "logic/crc.hpp"
#include <cstdio>

namespace daik {

bool hp_format(const ValueDef& def, const uint8_t* payload, int payload_len, std::string& out) {
    // TODO: pass the configured refrigerant type (R32/R410A/R22) once exposed in config.
    if (def.offset + def.size > payload_len) return false;
    Reading r = convert(def, payload + def.offset);
    if (r.unimpl) return false;
    if (!r.ok && r.text[0] == '\0') return false;
    if (r.text[0]) { out = r.text; return true; }
    char b[32];
    // One decimal for scaled temperatures; integers otherwise.
    bool frac = (def.conv >= 103 && def.conv <= 119) || def.conv == 405;
    snprintf(b, sizeof(b), frac ? "%.1f" : "%.0f", r.value);
    out = b;
    return true;
}

} // namespace daik
