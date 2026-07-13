#pragma once
// GENERATED-STYLE example profile — Daikin Altherma 3 R (outdoor ERGA04-08E, indoor ETBH,
// tank EKHWSP). Rows are {reg, offset, conv, size, type, label} (English labels here).
//
// In the real build tools/catalog/gen_profiles.py emits one such header per model family from
// Daikin's decoded catalog catalog; this hand-written sample shows the shape the generator
// targets, and gives the host tests + a first real device something to run against.
#include "../logic/value_def.hpp"

namespace daik::def {

inline constexpr ValueDef altherma3_r_erga[] = {
    {0x10,  0, 217, 1, -1, "Operation Mode"},
    {0x10,  4, 203, 1, -1, "Operation / Fault"},
    {0x10,  5, 204, 1, -1, "Fault Code"},
    {0x20,  0, 105, 2,  1, "Outdoor Air Temp (R1T)"},
    {0x20,  2, 105, 2,  1, "O/U Heat Exchanger Temp"},
    {0x20, 12, 405, 2,  1, "High Pressure (sat. °C)"},
    {0x20, 14, 405, 2,  1, "Low Pressure (sat. °C)"},
    {0x21,  0, 105, 2, -1, "INV Primary Current (A)"},
    {0x21,  2, 105, 2, -1, "INV Compressor Current (A)"},
    {0x30,  0, 152, 1, -1, "Compressor Speed (rps)"},
    {0x30,  1, 211, 1, -1, "Fan 1 (step)"},
    {0x60,  7, 105, 2,  1, "DHW Setpoint"},
    {0x60,  9, 105, 2,  1, "Leaving Water Setpoint (main)"},
    {0x61,  2, 105, 2,  1, "Leaving Water Temp after PHE (R1T)"},
    {0x61,  4, 105, 2,  1, "Leaving Water Temp after BUH (R2T)"},
    {0x61,  8, 105, 2,  1, "Return Water Temp before PHE (R4T)"},
    {0x61, 10, 105, 2,  1, "DHW Tank Temp (R5T)"},
    {0x62,  9, 105, 2, -1, "Flow Rate (l/min)"},
    {0x62, 11, 105, 1,  2, "Water Pressure"},
    {0x62, 12, 152, 1, -1, "Pump Speed"},
    {0x63, 14, 161, 1, -1, "CT Sensor (L1)"},
    {0x63, 15, 161, 1, -1, "CT Sensor (L2)"},
    {0x63, 16, 161, 1, -1, "CT Sensor (L3)"},
};

} // namespace daik::def
