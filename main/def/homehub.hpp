#pragma once
// HomeHub (EKRHH) Modbus register map — UC3 Daikin Altherma. The value catalog for the SECOND,
// independent Modbus TCP source (hp_modbus.cpp), the counterpart of the X10A def/ profiles. Not an
// alternative transport: there is no selector, both stacks run and neither notices the other fail.
//
// READ-ONLY here (issue #32 P2): the poll engine reads the INPUT registers (FC04, read-only by the
// Modbus spec) and reads BACK a curated set of HOLDING registers (FC03) purely as telemetry. There is
// NO write path in this firmware yet — the actuation targets in the EKRHH tables are the subject of
// P3, gated by config.actuation_enabled, and nothing here writes a register.
//
// Decoded through logic/modbus.hpp's MbType codecs; a 32765/66/67 special value (mb_is_special) is
// "no value" and is published as unavailable, never as a large number. Offsets are the EKRHH data
// model's 1-based offsets (guide 4P744838-1E §9.2); the wire PDU address is offset-1 (mb_pdu_address).
//
// SEMANTICS follow the EKRHH Installer reference guide §9.2 UC3 tables. This repo cannot build or
// flash (see .claude/CLAUDE.md), so the physical correctness of each row is confirmed ON HARDWARE
// before it is trusted — the same "passing a test is not being RIGHT" rule the X10A domain audit
// exists for. The host test below verifies the DECODE MECHANICS (scaling, special values, offset ->
// PDU), which is what can be checked without a HomeHub on the bus.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include "../logic/modbus.hpp"

namespace daik::def {

// Synthetic X10A "register page" every HomeHub cache row is tagged with, so generic CachedValue
// consumers can identify the source (logic/mqtt_group.hpp maps this byte to "modbus"). It is
// deliberately NOT the EKRHH offset: those overlap real X10A page numbers (offset 16 == page 0x10),
// so tagging a row by its offset would file it under an unrelated X10A group. 0xEE is outside the
// X10A page catalog. test_homehub() pins that group_for_page(HOMEHUB_GROUP_REG) == "modbus".
inline constexpr uint8_t HOMEHUB_GROUP_REG = 0xEE;

// A dimensionless Int16 can still be a NUMBER, a two-state FLAG or a named ENUM. The wire type
// cannot distinguish them: the EKRHH guide uses Int16 for the fault sub-code, ON/OFF flags and every
// mode selector alike. Classify them from the guide here, at the common decode boundary, so /values,
// MCP and the browser cannot each invent a different meaning for the same register.
enum class HomeHubValueKind : uint8_t {
    Number,
    Binary,
    UnitAbnormality,   // 0 No error, 1 Fault, 2 Warning
    OperationMode,     // 0 Auto, 1 Heating, 2 Cooling
    ThreeWayValve,     // 0 Space heating, 1 DHW
    SmartGridMode,     // 0 Free running, 1 Forced off, 2 Recommended on, 3 Forced on
};

// One HomeHub register: the 1-based data-model offset, the Modbus space (FC04 input / FC03 holding),
// the decode codec, an extra divisor applied AFTER mb_decode (1 for the codecs that already scale;
// >1 only where the register is pre-scaled), the display unit string, the English label, and its
// value semantics from EKRHH 4P744838-1E §9.2.
struct HomeHubReg {
    uint16_t    offset;   // EKRHH 1-based offset; wire PDU addr = offset-1 (mb_pdu_address)
    MbFunc      space;    // ReadInput (FC04, read-only) or ReadHolding (FC03, read back read-only)
    MbType      type;     // logic/modbus.hpp decode codec
    int         scale;    // divisor applied to the decoded value (Int16 flow is L/min x100 -> /100)
    const char* unit;     // display unit ("" = none); the CachedValue.unit the poll branch sets
    const char* label;    // English label (the CachedValue.label)
    HomeHubValueKind kind = HomeHubValueKind::Number;
};

// UC3 Daikin Altherma. INPUT (FC04) telemetry first, then a read-only read-back of the HOLDING (FC03)
// setpoints/modes. Kept deliberately small and unambiguous — the HomeHub's own map is more curated
// than the raw X10A pages, and every row here decodes cleanly under one MbType.
inline constexpr HomeHubReg HOMEHUB_REGS[] = {
    // ── Faults (input) ──────────────────────────────────────────────────────────────────────────
    {21, MbFunc::ReadInput, MbType::Int16,  1, "",      "Unit abnormality", HomeHubValueKind::UnitAbnormality},
    {22, MbFunc::ReadInput, MbType::Text16, 1, "",      "Unit abnormality code"},
    {23, MbFunc::ReadInput, MbType::Int16,  1, "",      "Unit abnormality sub code"},
    // ── Plant STATE (input) ─────────────────────────────────────────────────────────────────────
    // Not readings but the two facts the DRAWING routes on. The 3-way valve is the reason they are
    // here: with X10A silent the schematic had no valve position and drew the heating branch anyway
    // — measured against the live X10A board during a DHW run, which showed the diverter on the tank
    // while this one showed water going round the radiators. An unknown position must blank; a KNOWN
    // one should come from whoever knows it, and the gateway does (EKRHH §9.2.2 offset 37, verified
    // against the live unit: both read "to DHW" in the same minute).
    {30, MbFunc::ReadInput, MbType::Int16,  1, "",      "Circulation pump running", HomeHubValueKind::Binary},
    {37, MbFunc::ReadInput, MbType::Int16,  1, "",      "3-way valve", HomeHubValueKind::ThreeWayValve},
    // What the plant is DOING, which the gateway knows and the X10A-less drawing had to call
    // "unknown". Two flags rather than the single "operation mode" register (offset 38 / holding 3):
    // that one says heating-vs-cooling, i.e. which SEASON the unit is configured for, and reads 1
    // (heat) throughout a DHW run — so a headline built from it would announce "heating" while the
    // diverter is on the tank. These two say whether each circuit is actually being served.
    {52, MbFunc::ReadInput, MbType::Int16,  1, "",      "DHW normal operation", HomeHubValueKind::Binary},
    {53, MbFunc::ReadInput, MbType::Int16,  1, "",      "Space heating/cooling normal operation", HomeHubValueKind::Binary},
    // ── Temperatures (input, Temp16 = signed /100 °C) ─────────────────────────────────────────────
    {40, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Leaving water temperature PHE"},
    {41, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Leaving water temperature BUH"},
    {42, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Return water temperature"},
    {43, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Domestic Hot Water temperature"},
    {44, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Outside air temperature"},
    {45, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Liquid refrigerant temperature"},
    {50, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Remote controller room temperature Main"},
    // ── Flow + power (input) ──────────────────────────────────────────────────────────────────────
    // Flow is a plain Int16 carrying L/min x100 (EKRHH §9.2), so decode as Int16 then /100 — the extra
    // divisor the `scale` field exists for. Power is a Pow16 (signed /100 kW), already scaled.
    {49, MbFunc::ReadInput, MbType::Int16,  100, "L/min", "Flow rate"},
    {51, MbFunc::ReadInput, MbType::Pow16,  1,   "kW",    "Heat pump power consumption"},
    // ── Setpoints + modes (holding, read back READ-ONLY; the write path is P3, not built here) ─────
    {1,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Leaving water Main Heating setpoint"},
    {2,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Leaving water Main Cooling setpoint"},
    {3,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Operation mode", HomeHubValueKind::OperationMode},
    {4,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Space heating/cooling ON/OFF", HomeHubValueKind::Binary},
    {6,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Room thermostat control Heating setpoint Main"},
    {7,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Room thermostat control Cooling setpoint Main"},
    {9,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Quiet mode operation", HomeHubValueKind::Binary},
    {10, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "DHW reheat setpoint"},
    {56, MbFunc::ReadHolding, MbType::Int16, 1, "",   "Smart Grid operation mode", HomeHubValueKind::SmartGridMode},
    {57, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "Power limit during Recommended on / buffering"},
    {58, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "General power limit"},
};
inline constexpr int HOMEHUB_REG_COUNT = sizeof(HOMEHUB_REGS) / sizeof(HOMEHUB_REGS[0]);

inline constexpr bool homehub_is_binary(const HomeHubReg& r) {
    return r.kind == HomeHubValueKind::Binary;
}

inline constexpr bool homehub_is_enum(HomeHubValueKind kind) {
    return kind == HomeHubValueKind::UnitAbnormality || kind == HomeHubValueKind::OperationMode ||
           kind == HomeHubValueKind::ThreeWayValve || kind == HomeHubValueKind::SmartGridMode;
}

// JSON/HA wire type is a property of the register definition, never of the formatted value. Text16
// and the named manufacturer enums are text in every state; ordinary and binary values are numeric.
inline constexpr bool homehub_is_text(const HomeHubReg& r) {
    return r.type == MbType::Text16 || homehub_is_enum(r.kind);
}

inline constexpr const HomeHubReg* homehub_find(uint16_t offset) {
    for (int i = 0; i < HOMEHUB_REG_COUNT; i++)
        if (HOMEHUB_REGS[i].offset == offset) return &HOMEHUB_REGS[i];
    return nullptr;
}

// Canonical English values are the manufacturer's own §9.2 names. The browser localises these at
// its visual boundary; protocol consumers get a stable, human-readable value instead of a number.
inline constexpr const char* homehub_enum_name(HomeHubValueKind kind, int value) {
    switch (kind) {
        case HomeHubValueKind::UnitAbnormality:
            switch (value) {
                case 0: return "No error";
                case 1: return "Fault";
                case 2: return "Warning";
                default: return nullptr;
            }
        case HomeHubValueKind::OperationMode:
            switch (value) {
                case 0: return "Auto";
                case 1: return "Heating";
                case 2: return "Cooling";
                default: return nullptr;
            }
        case HomeHubValueKind::ThreeWayValve:
            switch (value) {
                case 0: return "Space heating";
                case 1: return "DHW";
                default: return nullptr;
            }
        case HomeHubValueKind::SmartGridMode:
            switch (value) {
                case 0: return "Free running";
                case 1: return "Forced off";
                case 2: return "Recommended on";
                case 3: return "Forced on";
                default: return nullptr;
            }
        default: return nullptr;
    }
}

// Decode a raw register into `out` (the physical value / text), applying the row's extra divisor.
// Returns false when the register carries NO value — a 32765/66/67 special (mb_is_special) or an
// undecodable codec — so the caller publishes it as unavailable rather than as a number.
inline bool homehub_decode(const HomeHubReg& r, uint16_t raw, MbValue& out) {
    out = mb_decode(r.type, raw);
    if (out.special || !out.ok) return false;
    if (r.type != MbType::Text16 && r.scale > 1) out.value /= static_cast<double>(r.scale);
    return true;
}

// Format a decoded register into `buf` (no allocation, for the poll path). Returns false and leaves
// `buf` untouched when the register carries no value (special / undecodable). Text16 is copied
// verbatim; named enums use the manufacturer's status text; an undocumented enum value remains
// diagnosable as "Unknown (N)" rather than silently acquiring the nearest valid meaning. Binary
// flags stay numeric 1/0 for the firmware-wide wire contract and are rendered ON/OFF by the browser.
// Other Int16 values with no extra scale are integers; scaled numerics print one decimal.
inline bool homehub_format(const HomeHubReg& r, uint16_t raw, char* buf, int buflen) {
    if (buf == nullptr || buflen <= 0) return false;
    MbValue v;
    if (!homehub_decode(r, raw, v)) return false;
    if (r.type == MbType::Text16) {
        std::snprintf(buf, static_cast<size_t>(buflen), "%s", v.text);
    } else if (homehub_is_enum(r.kind)) {
        const int value = static_cast<int>(v.value);
        const char* name = homehub_enum_name(r.kind, value);
        if (name) std::snprintf(buf, static_cast<size_t>(buflen), "%s", name);
        else std::snprintf(buf, static_cast<size_t>(buflen), "Unknown (%d)", value);
    } else if (r.type == MbType::Int16 && r.scale == 1) {
        std::snprintf(buf, static_cast<size_t>(buflen), "%d", static_cast<int>(v.value));
    } else {
        std::snprintf(buf, static_cast<size_t>(buflen), "%.1f", v.value);
    }
    return true;
}

}  // namespace daik::def
