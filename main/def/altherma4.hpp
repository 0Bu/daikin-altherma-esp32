#pragma once
// Profile definition for Daikin Altherma 4 Modbus TCP telemetry.
// Source: Daikin Configuration reference guide 4P773396-1C (2026.02), MMI v3.x.x, §7.2.
// No physical Altherma 4 capture is available. Existing flow/pump/pressure assumptions remain
// unverified where the guide leaves scaling or units ambiguous; see docs/MODBUS_PROTOCOL.md.
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
     HomeHubValueKind::Altherma4CurrentOperationMode},
    // ── Temperatures (input, Temp16 = signed /100 °C) ───────────────────────────────────────────
    {40, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature PHE"},
    {41, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature BUH"},
    {42, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Return water temperature"},
    {43, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature"},
    {44, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Outside air temperature"},
    {45, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Liquid refrigerant temperature"},
    {50, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Remote controller room temperature Main"},
    // ── Flow + power (input) ────────────────────────────────────────────────────────────────────
    // Retained assumption: the native guide does not state EKRHH's /100 factor for input 49.
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
    {9, MbFunc::ReadHolding, MbType::Int16, 1, "", "Quiet mode selection",
     HomeHubValueKind::Altherma4QuietSelection},
    {10, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "DHW reheat setpoint"},
    {54, MbFunc::ReadHolding, MbType::Int16, 1, "K", "Weather-dependent Main Heating offset"},
    {56, MbFunc::ReadHolding, MbType::Int16, 1, "", "Smart Grid operation mode",
     HomeHubValueKind::SmartGridMode},
    // Holding 57 has no native mapping in §7.2.1; do not inherit the EKRHH-only row.
    {58, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "Imposed power limit"},
    // ── Extended Altherma 4 registers (input) ───────────────────────────────────────────────────
    {65, MbFunc::ReadInput, MbType::Int16, 1, "", "Demand response mode",
     HomeHubValueKind::Altherma4DemandResponse},
    {66, MbFunc::ReadInput, MbType::Int16, 1, "%", "Bypass valve position"},
    {67, MbFunc::ReadInput, MbType::Int16, 1, "%", "Tank valve position"},
    // Retained assumption: §7.2 prints a pump-speed name but an L/min unit; % is unverified.
    {68, MbFunc::ReadInput, MbType::Int16, 1, "%", "Circulation pump speed"},
    {74, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature pre-PHE outdoor"},
    {75, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Leaving water temperature tank valve"},
    {76, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature upper"},
    {77, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Domestic Hot Water temperature lower"},
    // Retained assumption: 10..600 is printed with bar; the centibar interpretation needs a capture.
    {79, MbFunc::ReadInput, MbType::Int16, 100, "bar", "Water pressure"},
    {80, MbFunc::ReadInput, MbType::Temp16, 1, "°C", "Space heating/cooling target Main zone"},
    {83, MbFunc::ReadInput, MbType::Int16, 1, "", "Unit operation mode",
     HomeHubValueKind::Altherma4UnitOperationMode},
};
inline constexpr int ALTHERMA4_REG_COUNT = sizeof(ALTHERMA4_REGS) / sizeof(ALTHERMA4_REGS[0]);
static_assert(logic::modbus_offsets_unique(ALTHERMA4_REGS), "Altherma 4 public offsets must be unique");

inline constexpr const HomeHubReg* altherma4_find(uint16_t offset) {
    for (int i = 0; i < ALTHERMA4_REG_COUNT; i++)
        if (ALTHERMA4_REGS[i].offset == offset) return &ALTHERMA4_REGS[i];
    return nullptr;
}

}  // namespace daik::def

namespace daik::def {
inline constexpr uint8_t homehub_definition_id(const HomeHubReg& row) {
    return logic::modbus_definition_id(HOMEHUB_REGS, ALTHERMA4_REGS, row);
}
inline constexpr const HomeHubReg* homehub_definition(uint8_t token) {
    return logic::modbus_definition(HOMEHUB_REGS, ALTHERMA4_REGS, token);
}
inline constexpr bool homehub_definition_is_altherma4(uint8_t token) {
    return token > HOMEHUB_REG_COUNT && homehub_definition(token) != nullptr;
}
inline constexpr bool homehub_has_quiet_activity(const HomeHubReg& row) {
    return row.offset != 9 || row.kind == HomeHubValueKind::Binary;
}
} // namespace daik::def
