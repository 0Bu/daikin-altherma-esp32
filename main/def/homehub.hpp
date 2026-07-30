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

// Synthetic X10A "register page" every HomeHub cache row is tagged with, so the MQTT bridge groups
// them all under ONE key (logic/mqtt_group.hpp group_for_page maps this byte to "homehub"). It is
// deliberately NOT the EKRHH offset: those overlap real X10A page numbers (offset 16 == page 0x10),
// so tagging a row by its offset would file it under an unrelated X10A group. 0xEE is outside the
// X10A page catalog. test_homehub() pins that group_for_page(HOMEHUB_GROUP_REG) == "homehub".
inline constexpr uint8_t HOMEHUB_GROUP_REG = 0xEE;

// One HomeHub register: the 1-based data-model offset, the Modbus space (FC04 input / FC03 holding),
// the decode codec, an extra divisor applied AFTER mb_decode (1 for the codecs that already scale;
// >1 only where the register is pre-scaled), the display unit string, and the English label.
struct HomeHubReg {
    uint16_t    offset;   // EKRHH 1-based offset; wire PDU addr = offset-1 (mb_pdu_address)
    MbFunc      space;    // ReadInput (FC04, read-only) or ReadHolding (FC03, read back read-only)
    MbType      type;     // logic/modbus.hpp decode codec
    int         scale;    // divisor applied to the decoded value (Int16 flow is L/min x100 -> /100)
    const char* unit;     // display unit ("" = none); the CachedValue.unit the poll branch sets
    const char* label;    // English label (the CachedValue.label)
    // Is this register a two-state FLAG rather than a number? It cannot be inferred: an EKRHH flag
    // is an Int16 like the enums and the counts beside it, so without this every one of them
    // reached the browser as a bare 0/1 while its X10A twin read ON/OFF — the same fact, printed two
    // ways in one panel. It is NOT the X10A converter trick either: those rows carry a bit-masking
    // converter id that says so, and a HomeHub row has no converter at all. Marked per row from the
    // EKRHH semantics, and only where the register really has two states — an operation MODE or a
    // Smart-Grid selector is an enum, and calling it binary would print "ON" for a 3.
    bool        bin = false;
};

// UC3 Daikin Altherma. INPUT (FC04) telemetry first, then a read-only read-back of the HOLDING (FC03)
// setpoints/modes. Kept deliberately small and unambiguous — the HomeHub's own map is more curated
// than the raw X10A pages, and every row here decodes cleanly under one MbType.
inline constexpr HomeHubReg HOMEHUB_REGS[] = {
    // ── Faults (input) ──────────────────────────────────────────────────────────────────────────
    {21, MbFunc::ReadInput, MbType::Int16,  1, "",      "Unit error active", true},
    {22, MbFunc::ReadInput, MbType::Text16, 1, "",      "Error code"},
    {23, MbFunc::ReadInput, MbType::Int16,  1, "",      "Error sub code"},
    // ── Plant STATE (input) ─────────────────────────────────────────────────────────────────────
    // Not readings but the two facts the DRAWING routes on. The 3-way valve is the reason they are
    // here: with X10A silent the schematic had no valve position and drew the heating branch anyway
    // — measured against the live X10A board during a DHW run, which showed the diverter on the tank
    // while this one showed water going round the radiators. An unknown position must blank; a KNOWN
    // one should come from whoever knows it, and the gateway does (EKRHH §9.2.2 offset 37, verified
    // against the live unit: both read "to DHW" in the same minute).
    {30, MbFunc::ReadInput, MbType::Int16,  1, "",      "Circulation pump running", true},
    {37, MbFunc::ReadInput, MbType::Int16,  1, "",      "3-way valve to DHW", true},
    // What the plant is DOING, which the gateway knows and the X10A-less drawing had to call
    // "unknown". Two flags rather than the single "operation mode" register (offset 38 / holding 3):
    // that one says heating-vs-cooling, i.e. which SEASON the unit is configured for, and reads 1
    // (heat) throughout a DHW run — so a headline built from it would announce "heating" while the
    // diverter is on the tank. These two say whether each circuit is actually being served.
    {52, MbFunc::ReadInput, MbType::Int16,  1, "",      "DHW operation", true},
    {53, MbFunc::ReadInput, MbType::Int16,  1, "",      "Space operation", true},
    // ── Temperatures (input, Temp16 = signed /100 °C) ─────────────────────────────────────────────
    {40, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Leaving water temp. (PHE)"},
    {41, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Leaving water temp. (BUH)"},
    {42, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Return water temp."},
    {43, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "DHW tank temp."},
    {44, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Outdoor air temp."},
    {45, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Liquid refrigerant temp."},
    {50, MbFunc::ReadInput, MbType::Temp16, 1, "°C",    "Room temp."},
    // ── Flow + power (input) ──────────────────────────────────────────────────────────────────────
    // Flow is a plain Int16 carrying L/min x100 (EKRHH §9.2), so decode as Int16 then /100 — the extra
    // divisor the `scale` field exists for. Power is a Pow16 (signed /100 kW), already scaled.
    {49, MbFunc::ReadInput, MbType::Int16,  100, "L/min", "Flow rate"},
    {51, MbFunc::ReadInput, MbType::Pow16,  1,   "kW",    "Power consumption"},
    // ── Setpoints + modes (holding, read back READ-ONLY; the write path is P3, not built here) ─────
    {1,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "LWT Main Heating setpoint"},
    {2,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "LWT Main Cooling setpoint"},
    {3,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Operation mode"},
    {4,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Space heating/cooling ON/OFF", true},
    {6,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Room thermostat Heating setpoint"},
    {7,  MbFunc::ReadHolding, MbType::Int16, 1, "°C", "Room thermostat Cooling setpoint"},
    {9,  MbFunc::ReadHolding, MbType::Int16, 1, "",   "Quiet mode", true},
    {10, MbFunc::ReadHolding, MbType::Int16, 1, "°C", "DHW reheat setpoint"},
    {56, MbFunc::ReadHolding, MbType::Int16, 1, "",   "Smart-Grid operation mode"},
    {57, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "Power limit (buffering)"},
    {58, MbFunc::ReadHolding, MbType::Pow16, 1, "kW", "Power limit (general)"},
};
inline constexpr int HOMEHUB_REG_COUNT = sizeof(HOMEHUB_REGS) / sizeof(HOMEHUB_REGS[0]);

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
// verbatim; Int16 with no extra scale is an integer (states, modes, whole-degree setpoints); every
// other numeric row prints one decimal (the resolution the /100 codecs and the flow /100 produce).
inline bool homehub_format(const HomeHubReg& r, uint16_t raw, char* buf, int buflen) {
    if (buf == nullptr || buflen <= 0) return false;
    MbValue v;
    if (!homehub_decode(r, raw, v)) return false;
    if (r.type == MbType::Text16) {
        std::snprintf(buf, static_cast<size_t>(buflen), "%s", v.text);
    } else if (r.type == MbType::Int16 && r.scale == 1) {
        std::snprintf(buf, static_cast<size_t>(buflen), "%d", static_cast<int>(v.value));
    } else {
        std::snprintf(buf, static_cast<size_t>(buflen), "%.1f", v.value);
    }
    return true;
}

}  // namespace daik::def
