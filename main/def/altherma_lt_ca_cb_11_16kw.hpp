#pragma once
// GENERATED profile from X10A value definitions: Altherma(LT_CA_CB_11-16kW)
// Curated HA sensor set. Rows are {reg, offset, conv, size, type, label}; `default_on`
// marks source default-displayed values. Full register map: docs/REGISTERS.md.
#include "../logic/value_def.hpp"

namespace daik::def {

inline constexpr ValueDef altherma_lt_ca_cb_11_16kw[] = {
    {0x00, 0, 801, 0, -1, "*Refrigerant type"},
    {0x00, 12, 105, 1, -1, "O/U capacity (kW)"},  // default_on
    {0x10, 0, 217, 1, -1, "Operation Mode"},  // default_on
    {0x10, 1, 304, 1, -1, "Defrost Operation"},  // default_on
    {0x10, 4, 203, 1, -1, "Error type"},  // default_on
    {0x10, 5, 204, 1, -1, "Error Code"},  // default_on
    {0x10, 6, 114, 2, 1, "Target Evap. Temp."},  // default_on
    {0x10, 8, 114, 2, 1, "Target Cond. Temp."},  // default_on
    {0x20, 0, 105, 2, 1, "R1T-Outdoor air temp."},  // default_on
    {0x20, 2, 105, 2, 1, "R4T-Deicer temp."},  // default_on
    {0x20, 4, 105, 2, 1, "R2T-INV discharge pipe temp."},  // default_on
    {0x20, 6, 105, 2, 1, "Suction pipe temp."},  // default_on
    {0x20, 8, 105, 2, 1, "Heat exchanger mid-temp."},  // default_on
    {0x20, 10, 105, 2, 1, "Liquid pipe temp.(R6T)"},  // default_on
    {0x20, 12, 105, 2, 1, "Heat sink temp."},  // default_on
    {0x20, 14, 105, 2, 2, "Pressure"},  // default_on
    {0x20, 14, 405, 2, 1, "Pressure(T)"},  // default_on
    {0x21, 0, 105, 2, -1, "INV primary current (A)"},  // default_on
    {0x21, 2, 105, 2, -1, "INV secondary current (A)"},  // default_on
    {0x21, 7, 105, 2, 1, "Brine inlet temp."},
    {0x21, 9, 105, 2, 1, "Brine outlet temp."},
    {0x21, 11, 105, 2, 1, "Refrig. temp. evap. In"},  // default_on
    {0x21, 13, 105, 2, 1, "Refrig. temp. evap.Out"},  // default_on
    {0x30, 0, 152, 1, -1, "INV frequency (rps)"},  // default_on
    {0x30, 1, 211, 1, -1, "Fan 1 (step)"},  // default_on
    {0x30, 2, 211, 1, -1, "Fan 2 (step)"},  // default_on
    {0x30, 3, 151, 2, -1, "Expansion valve 1 (pls)"},  // default_on
    {0x30, 5, 151, 2, -1, "Expansion valve 2 (pls)"},  // default_on
    {0x60, 2, 315, 1, -1, "I/U operation mode"},  // default_on
    {0x60, 2, 303, 1, -1, "Thermostat ON/OFF"},  // default_on
    {0x60, 2, 302, 1, -1, "Freeze Protection"},  // default_on
    {0x60, 2, 301, 1, -1, "Silent Mode"},  // default_on
    {0x60, 2, 300, 1, -1, "Freeze Protection for water piping"},  // default_on
    {0x60, 3, 204, 1, -1, "Error Code"},  // default_on
    {0x60, 6, 219, 1, -1, "I/U capacity code"},  // default_on
    {0x60, 7, 105, 2, 1, "DHW setpoint"},  // default_on
    {0x60, 9, 105, 2, 1, "LW setpoint (main)"},  // default_on
    {0x60, 11, 307, 1, -1, "Water flow switch"},  // default_on
    {0x60, 11, 305, 1, -1, "Thermal protector BSH"},  // default_on
    {0x60, 11, 304, 1, -1, "Benefit kWh rate power supply"},  // default_on
    {0x60, 11, 300, 1, -1, "Bivalent Operation"},  // default_on
    {0x60, 12, 307, 1, -1, "2way valve(On:Heat_Off:Cool)"},  // default_on
    {0x60, 12, 306, 1, -1, "3way valve(On:DHW_Off:Space)"},  // default_on
    {0x60, 12, 305, 1, -1, "BSH"},  // default_on
    {0x60, 12, 304, 1, -1, "BUH Step1"},  // default_on
    {0x60, 12, 303, 1, -1, "BUH Step2"},  // default_on
    {0x60, 12, 301, 1, -1, "Water pump operation"},  // default_on
    {0x60, 12, 300, 1, -1, "Solar pump operation"},  // default_on
    {0x61, 2, 105, 2, 1, "Leaving water temp. before BUH (R1T)"},  // default_on
    {0x61, 4, 105, 2, 1, "Leaving water temp. after BUH (R2T)"},  // default_on
    {0x61, 6, 105, 2, 1, "Refrig. Temp. liquid side (R3T)"},  // default_on
    {0x61, 8, 105, 2, 1, "Inlet water temp.(R4T)"},  // default_on
    {0x61, 10, 105, 2, 1, "DHW tank temp. (R5T)"},  // default_on
    {0x61, 12, 105, 2, 1, "Indoor ambient temp. (R1T)"},  // default_on
    {0x61, 14, 105, 2, 1, "Ext. indoor ambient sensor (R6T)"},
    {0x62, 2, 307, 1, -1, "Reheat ON/OFF"},  // default_on
    {0x62, 2, 306, 1, -1, "Storage ECO ON/OFF"},  // default_on
    {0x62, 2, 305, 1, -1, "Storage comfort ON/OFF"},  // default_on
    {0x62, 2, 304, 1, -1, "Powerful DHW Operation. ON/OFF"},
    {0x62, 2, 303, 1, -1, "Space heating Operation ON/OFF"},
    {0x62, 2, 300, 1, -1, "Emergency (indoor) active/not active"},  // default_on
    {0x62, 3, 105, 2, 1, "LW setpoint (add)"},
    {0x62, 5, 105, 2, 1, "RT setpoint"},
    {0x62, 8, 303, 1, -1, "Tank preheat ON/OFF"},  // default_on
    {0x62, 8, 302, 1, -1, "Circulation pump operation"},
    {0x62, 8, 301, 1, -1, "Alarm output"},
    {0x62, 8, 300, 1, -1, "Space H Operation output"},
    {0x62, 9, 105, 2, -1, "Flow sensor (l/min)"},
    {0x62, 11, 105, 1, 2, "Water pressure"},
    {0x62, 12, 152, 1, -1, "Water pump signal (0:max-100:stop)"},
    {0x64, 2, 316, 1, -1, "Hybrid Op. Mode"},
    {0x64, 2, 303, 1, -1, "Boiler Operation Demand"},
    {0x64, 2, 302, 1, -1, "Boiler DHW Demand"},
    {0x64, 3, 105, 2, -1, "BE_COP"},
    {0x64, 5, 105, 2, 1, "Hybrid Heating Target Temp."},
    {0x64, 7, 105, 2, 1, "Boiler Heating Target Temp."},
    {0x64, 10, 118, 2, 1, "Mixed water temp.(R7T)"},  // default_on
};

} // namespace daik::def
