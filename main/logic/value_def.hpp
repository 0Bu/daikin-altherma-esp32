#pragma once
// A single queryable value — a row of
//   {registryID, offset, convId, dataSize, dataType, label}
// These rows are generated into main/def/*.hpp by tools/profiles/gen_profiles.py from Daikin's
// decoded value catalog. IDF-free so the host tests can use it.
#include <cstdint>

namespace daik {

struct ValueDef {
    uint8_t     reg;     // registry id, e.g. 0x61
    uint8_t     offset;  // byte offset within the register reply payload
    int         conv;    // converter id (see logic/convert.hpp)
    uint8_t     size;    // number of bytes
    int         type;    // dataType / HA unit code: 1=°C, 2=bar, 3=A, -1=generic
    const char* label;   // human label (English)
};

} // namespace daik
