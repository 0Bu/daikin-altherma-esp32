#pragma once
// Profile definition for Daikin Altherma 4 Modbus TCP telemetry.
// UNVERIFIED — reconstructed from public reference definitions; no capture from a real unit in this repository.
// Missing evidence: a vendor Modbus-map page or telemetry capture from a physical Altherma 4 unit.
#include "homehub.hpp"

namespace daik::def {

// Daikin Altherma 4 Modbus register catalog. Extends the EKRHH/UC3 catalog with native Altherma 4
// telemetry: demand response mode (65), valve positions (66, 67), pump speed (68), outdoor and
// valve leaving water temperatures (74, 75), dual tank temperatures (76, 77), water pressure (79),
// leaving water target (80), and operating state (83).
inline constexpr HomeHubReg ALTHERMA4_REGS[] = {
    // ── Faults (input) ──────────────────────────────────────────────────────────────────────────
    {21, MbFunc::ReadInput, MbType::Int16, 1, "", "Unit abnormality",
     HomeHubValueKind::UnitAbnormality},
    {22, MbFunc::ReadInput, MbType::Text16, 1, "", "Unit abnormality code"},
    {23, MbFunc::ReadInput, MbType::Int16, 1, "", "Unit abnormality sub code"},
    // ── Plant STATE (input) ─────────────────────────────────────────────────────────────────────
    {30, MbFunc::ReadInput, MbType::Int16, 1, "", "Circulation pump running",
     HomeHubValueKind::Binary},
    {31, MbFunc::ReadInput, MbType::Int16, 1, "", "Compressor running", HomeHubValueKind::Binary},
    {32, MbFunc::ReadInput, MbType::Int16, 1, "", "Booster heater run", HomeHubValueKind::Binary},
    {33, MbFunc::ReadInput, MbType::Int16, 1, "", "Disinfection operation",
     HomeHubValueKind::Binary},
    {37, MbFunc::ReadInput, MbType::Int16, 1, "", "3-way valve", HomeHubValueKind::ThreeWayValve},
    {52, MbFunc::ReadInput, MbType::Int16, 1, "", "DHW normal operation", HomeHubValueKind::Binary},
    {53, MbFunc::ReadInput, MbType::Int16, 1, "", "Space heating/cooling normal operation",
     HomeHubValueKind::Binary},
    {38, MbFunc::ReadInput, MbType::Int16, 1, "", "Current operation mode",
     HomeHubValueKind::CurrentOperationMode},
    // ── Temperatures (input, Temp16 = signed /100 °C) ───────────────────────────────────────────
    {40, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature PHE"},
    {41, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature BUH"},
    {42, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Return water temperature"},
    {43, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature"},
    {44, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Outside air temperature"},
    {45, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Liquid refrigerant temperature"},
    {50, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Remote controller room temperature Main"},
    // ── Flow + power (input) ────────────────────────────────────────────────────────────────────
    {49, MbFunc::ReadInput, MbType::Int16, 100, "L/min", "Flow rate"},
    {51, MbFunc::ReadInput, MbType::Pow16, 1, "kW", "Heat pump power consumption"},
    // ── Setpoints + modes (holding; read-back only) ──────────────────────────────────────────────
    {1, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Leaving water Main Heating setpoint"},
    {2, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Leaving water Main Cooling setpoint"},
    {3, MbFunc::ReadHolding, MbType::Int16, 1, "", "Operation mode",
     HomeHubValueKind::OperationMode},
    {4, MbFunc::ReadHolding, MbType::Int16, 1, "", "Space heating/cooling ON/OFF",
     HomeHubValueKind::Binary},
    {6, MbFunc::ReadHolding, MbType::Int16, 1, "°C",
     "Room thermostat control Heating setpoint Main"},
    {7, MbFunc::ReadHolding, MbType::Int16, 1, "°C",
     "Room thermostat control Cooling setpoint Main"},
    {9, MbFunc::ReadHolding, MbType::Int16, 1, "", "Quiet mode operation",
     HomeHubValueKind::Binary},
    {10, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "DHW reheat setpoint"},
    {54, MbFunc::ReadHolding, MbType::Int16, 1, "K", "Leaving water Main Heating offset"},
    {56, MbFunc::ReadHolding, MbType::Int16, 1, "", "Smart Grid operation mode",
     HomeHubValueKind::SmartGridMode},
    {57, MbFunc::ReadHolding, MbType::Pow16, 1, "kW",
     "Power limit during Recommended on / buffering"},
    {58, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "General power limit"},
    // ── Extended Altherma 4 registers (input) ───────────────────────────────────────────────────
    {65, MbFunc::ReadInput, MbType::Int16, 1, "", "Demand response mode",
     HomeHubValueKind::SmartGridMode},
    {66, MbFunc::ReadInput, MbType::Int16, 1, "%", "Bypass valve position"},
    {67, MbFunc::ReadInput, MbType::Int16, 1, "%", "Tank valve position"},
    {68, MbFunc::ReadInput, MbType::Int16, 1, "%", "Circulation pump speed"},
    {74, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature outdoor"},
    {75, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature tank valve"},
    {76, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature upper"},
    {77, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature lower"},
    {79, MbFunc::ReadInput, MbType::Int16, 100, "bar", "Water pressure"},
    {80, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Heating/cooling target"},
    {83, MbFunc::ReadInput, MbType::Int16, 1, "", "Unit operation mode",
     HomeHubValueKind::OperationMode},
};
inline constexpr int ALTHERMA4_REG_COUNT = sizeof(ALTHERMA4_REGS) / sizeof(ALTHERMA4_REGS[0]);

inline constexpr const HomeHubReg* altherma4_find(uint16_t offset) {
    for (int i = 0; i < ALTHERMA4_REG_COUNT; i++)
        if (ALTHERMA4_REGS[i].offset == offset) return &ALTHERMA4_REGS[i];
    return nullptr;
}

}  // namespace daik::def
