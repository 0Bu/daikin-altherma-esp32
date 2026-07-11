#pragma once
// A single queryable value, mirroring ESPAltherma's LabelDef row
//   {registryID, offset, convId, dataSize, dataType, label}
// (see ESPAltherma include/labeldef.h). These rows are generated into main/def/*.hpp by
// tools/gen_defs.py from the ESPAltherma def/* files. IDF-free so the host tests can use it.
#include <cstdint>

namespace daik {

struct ValueDef {
    uint8_t     reg;     // registry id, e.g. 0x61
    uint8_t     offset;  // byte offset within the register reply payload
    int         conv;    // converter id (see logic/convert.hpp)
    uint8_t     size;    // number of bytes
    int         type;    // ESPAltherma dataType (reserved / converter-specific)
    const char* label;   // human label (language-specific table)
};

} // namespace daik
