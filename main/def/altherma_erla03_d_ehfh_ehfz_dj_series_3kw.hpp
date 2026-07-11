#pragma once
// GENERATED profile from X10A value definitions: Altherma(ERLA03 D EHFH-EHFZ DJ series 3kW)
// Curated HA sensor set. Rows are {reg, offset, conv, size, type, label}; `default_on`
// marks source default-displayed values. Full register map: docs/REGISTERS.md.
#include "../logic/value_def.hpp"

namespace daik::def {

inline constexpr ValueDef altherma_erla03_d_ehfh_ehfz_dj_series_3kw[] = {
    {0x00, 0, 802, 0, -1, "*Refrigerant type"},
    {0x00, 12, 105, 1, -1, "O/U capacity (kW)"},  // default_on
    {0x10, 0, 217, 1, -1, "Operation Mode"},  // default_on
    {0x10, 1, 304, 1, -1, "Defrost Operation"},  // default_on
    {0x10, 4, 203, 1, -1, "Error type"},  // default_on
    {0x10, 5, 204, 1, -1, "Error Code"},  // default_on
    {0x10, 6, 114, 2, 1, "Target Evap. Temp."},  // default_on
    {0x10, 8, 114, 2, 1, "Target Cond. Temp."},  // default_on
    {0x20, 0, 105, 2, 1, "R1T-Outdoor air temp."},  // default_on
    {0x20, 2, 105, 2, 1, "O/U Heat Exch. Temp."},
    {0x20, 4, 105, 2, 1, "Discharge pipe temp."},  // default_on
    {0x20, 6, 105, 2, 1, "Suction pipe temp."},
    {0x20, 8, 105, 2, 1, "Heat exchanger mid-temp."},  // default_on
    {0x20, 10, 105, 2, 1, "Liquid pipe temp.(R6T)"},
    {0x20, 12, 105, 2, 1, "Heat sink temp."},  // default_on
    {0x20, 14, 105, 2, 2, "Pressure sensor"},
    {0x20, 14, 405, 2, 1, "Pressure sensor(T)"},
    {0x21, 0, 105, 2, -1, "INV primary current (A)"},  // default_on
    {0x21, 2, 105, 2, -1, "INV secondary current (A)"},  // default_on
    {0x21, 7, 105, 2, 1, "Brine inlet temp."},
    {0x21, 9, 105, 2, 1, "Brine outlet temp."},
    {0x21, 11, 105, 2, 1, "Refrig. temp. evap. In"},
    {0x21, 13, 105, 2, 1, "Refrig. temp. evap.Out"},
    {0x60, 2, 315, 1, -1, "I/U operation mode"},  // default_on
    {0x60, 2, 303, 1, -1, "Thermostat ON/OFF"},  // default_on
    {0x60, 2, 302, 1, -1, "Freeze Protection"},  // default_on
    {0x60, 2, 301, 1, -1, "Silent Mode"},  // default_on
    {0x60, 2, 300, 1, -1, "Freeze Protection for water piping"},  // default_on
    {0x60, 3, 204, 1, -1, "Error Code"},  // default_on
    {0x60, 5, 203, 1, -1, "Error type"},  // default_on
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
    {0x61, 14, 105, 2, 1, "Ext. indoor ambient sensor (R6T)"},  // default_on
    {0x62, 2, 307, 1, -1, "Reheat ON/OFF"},  // default_on
    {0x62, 2, 306, 1, -1, "Storage ECO ON/OFF"},  // default_on
    {0x62, 2, 305, 1, -1, "Storage comfort ON/OFF"},  // default_on
    {0x62, 2, 304, 1, -1, "Powerful DHW Operation. ON/OFF"},  // default_on
    {0x62, 2, 303, 1, -1, "Space heating Operation ON/OFF"},  // default_on
    {0x62, 2, 300, 1, -1, "Emergency (indoor) active/not active"},  // default_on
    {0x62, 3, 105, 2, 1, "LW setpoint (add)"},  // default_on
    {0x62, 5, 105, 2, 1, "RT setpoint"},  // default_on
    {0x62, 8, 303, 1, -1, "Tank preheat ON/OFF"},  // default_on
    {0x62, 8, 302, 1, -1, "Circulation pump operation"},  // default_on
    {0x62, 8, 301, 1, -1, "Alarm output"},  // default_on
    {0x62, 8, 300, 1, -1, "Space H Operation output"},  // default_on
    {0x62, 9, 105, 2, -1, "Flow sensor (l/min)"},  // default_on
    {0x62, 11, 105, 1, 2, "Water pressure"},  // default_on
    {0x62, 12, 152, 1, -1, "Water pump signal (0:max-100:stop)"},  // default_on
    {0x62, 15, 105, 2, 2, "Refrigerant pressure sensor"},  // default_on
    {0x62, 15, 405, 2, 1, "Pressure sensor(T)"},  // default_on
    {0x64, 2, 316, 1, -1, "Hybrid Op. Mode"},
    {0x64, 2, 303, 1, -1, "Boiler Operation Demand"},
    {0x64, 2, 302, 1, -1, "Boiler DHW Demand"},
    {0x64, 3, 105, 2, -1, "BE_COP"},
    {0x64, 5, 105, 2, 1, "Hybrid Heating Target Temp."},
    {0x64, 7, 105, 2, 1, "Boiler Heating Target Temp."},
    {0x64, 10, 118, 2, 1, "Mixed water temp."},  // default_on
    {0x64, 12, 105, 2, 1, "2nd Domestic hot water temperature"},  // default_on
};

} // namespace daik::def
