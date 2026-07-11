#pragma once
// Value-definition profile registry: maps a profile id (chosen in the web UI from the
// indoor/outdoor/tank selection) to its embedded ValueDef table. In the real build,
// tools/gen_defs.py appends generated profiles here and to the model→profile map served by
// GET /models. This hand-written index wires up the sample profile.
#include <cstddef>
#include <cstring>
#include "../logic/value_def.hpp"
#include "altherma3_r_erga.hpp"

namespace daik::def {

// Minimal generic fallback: a few near-universal registers so an unknown unit still reports
// something. Real "generic" profile is generated from ESPAltherma DEFAULT.h.
inline constexpr ValueDef generic[] = {
    {0x10, 0, 217, 1, -1, "Operation Mode"},
    {0x20, 0, 105, 2,  1, "Outdoor Air Temp (R1T)"},
    {0x61, 10, 105, 2, 1, "DHW Tank Temp (R5T)"},
};

struct Profile {
    const char*     id;
    const ValueDef* values;
    size_t          count;
};

inline constexpr Profile profiles[] = {
    {"generic",         generic,          sizeof(generic) / sizeof(generic[0])},
    {"altherma3_r_erga", altherma3_r_erga, sizeof(altherma3_r_erga) / sizeof(altherma3_r_erga[0])},
};

// Look a profile up by id, falling back to "generic".
inline const Profile& lookup(const char* id) {
    for (const auto& p : profiles)
        if (id && std::strcmp(p.id, id) == 0) return p;
    return profiles[0]; // generic
}

} // namespace daik::def
