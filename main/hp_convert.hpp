#pragma once
// Device-side value formatting: takes a decoded logic::Reading + its ValueDef and produces the
// display/publish string (number formatting, enum label, unit). The numeric/curve maths lives
// in logic/convert.hpp (host-tested); this only formats.
#include <cstddef>
#include <string>
#include "logic/value_def.hpp"

namespace daik {

// Format a value for the /values API and MQTT (e.g. "34.5"). `rtype` is the active profile's
// refrigerant converter id (801-805; see logic::profile_refrigerant) and only affects conv-405
// saturation-temperature rows. Returns false if the reading is absent/unimplemented (skip it).
//
// `profile`/`count` are the active model's whole ValueDef table. reading_plausible() needs it to tell
// a refrigerant pressure from a water one (a 0-bar refrigerant reading is an unreported transducer, a
// 0-bar water reading is a drained system) — see logic/convert.hpp. Optional: omitting it keeps the
// °C-envelope filtering and skips only the pressure rule.
bool hp_format(const ValueDef& def, const uint8_t* payload, int payload_len, int rtype,
               std::string& out, const ValueDef* profile = nullptr, size_t count = 0);

} // namespace daik
