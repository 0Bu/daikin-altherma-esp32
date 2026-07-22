#pragma once
// Value converters — raw register bytes -> typed reading. This is the single riskiest piece of the
// port (a wrong sign/scale/endianness silently corrupts a reading), so it is IDF-free and unit-
// tested per converter id in test/test_logic.cpp.
//
// Semantics (cross-checked against two independent X10A implementations): convs 101-111 read a
// SIGNED 16-bit field, 151-165 an UNSIGNED one; within a group the id's parity selects endianness
// (flag 0 = little-endian, flag 1 = big-endian). A 1-byte field is read from data[0]. The large set
// of enum/label converters (operating-mode, on/off, fan-step, error codes) is generated alongside
// the def profiles by the offline generator (gen_profiles.py, maintained outside this repo);
// convert() returns Reading{unimpl=true} for a conv id not yet ported, so the value is simply
// skipped rather than reported wrong.
#include <cmath>
#include <cstdint>
#include "value_def.hpp"
#include "registers.hpp"

namespace daik {

struct Reading {
    bool   ok      = false;   // a numeric value is present
    bool   unimpl  = false;   // converter not implemented for this id
    double value   = 0.0;
    // For enum/string converters, text[] holds the decoded label (else empty).
    char   text[24] = {0};
};

// ── Refrigerant pressure -> saturation temperature (°C). RType: 801=R410A, 802=R32, 803=R22 ──
inline double press2temp_r410a(double d) {
    return -8.4448460086362E-07*d*d*d*d*d*d + 0.000112833751855216*d*d*d*d*d
           - 0.00584955138495273*d*d*d*d + 0.149130933664499*d*d*d
           - 1.99373679674187*d*d + 16.0504901396224*d - 53.2854030662239;
}
inline double press2temp_r22(double d) {
    return -5.0232146925414E-06*d*d*d*d*d*d + 0.000475561916201275*d*d*d*d*d
           - 0.0175087997648461*d*d*d*d + 0.318620413943417*d*d*d
           - 3.0844373741869*d*d + 19.0217687284902*d - 42.3282361912494;
}
inline double press2temp(double d, int rtype = 802) {
    if (rtype == 801) return press2temp_r410a(d);
    if (rtype == 803) return press2temp_r22(d);
    return -2.6989493795556E-07*d*d*d*d*d*d + 4.26383417104661E-05*d*d*d*d*d
           - 0.00262978346547749*d*d*d*d + 0.0805858127503585*d*d*d
           - 1.31924457284073*d*d + 13.4157368435437*d - 51.1813342993155;
}

// ── Enum / flag label tables (recovered from the X10A value definitions) ──────────────────────
inline constexpr const char* OP_MODE[] = {                          // conv 217 (data[0])
    "Fan Only", "Heating", "Cooling", "Auto", "Ventilation", "Auto Cool", "Auto Heat", "Dry",
    "Aux.", "Cooling Storage", "Heating Storage", "UseStrdThrm(cl)1", "UseStrdThrm(cl)2",
    "UseStrdThrm(cl)3", "UseStrdThrm(cl)4", "UseStrdThrm(ht)1", "UseStrdThrm(ht)2",
    "UseStrdThrm(ht)3", "UseStrdThrm(ht)4", "Aux."};
inline constexpr const char* IU_MODE[]  = {                         // conv 315 (high nibble)
    "Stop", "Heating", "Cooling", "", "DHW", "Heating + DHW", "Cooling + DHW"};
inline constexpr const char* ERR_TYPE[] = {"Normal", "Error", "Warning", "Caution"};  // conv 203
inline constexpr const char* HYBRID[]   = {"H/P only", "Hybrid", "Boiler only"};      // conv 316
// Daikin error code: two chars, indexed by the byte's high / low nibble (conv 204).
inline constexpr char ERR_C1[16] = {' ','A','C','E','H','F','J','L','P','U','9','8','7','6','5','4'};
inline constexpr char ERR_C2[16] = {'0','1','2','3','4','5','6','7','8','9','A','H','C','J','E','F'};

// Copy a decoded label into the reading (bounded), marking it present.
inline void set_text(Reading& r, const char* s) {
    int i = 0;
    for (; s[i] && i < static_cast<int>(sizeof(r.text)) - 1; i++) r.text[i] = s[i];
    r.text[i] = '\0';
    r.ok = true;
}

// Convert one value. `data` points at the value's bytes inside the reply payload.
inline Reading convert(const ValueDef& def, const uint8_t* data, int rtype = 802) {
    Reading r;
    const int n = def.size;
    switch (def.conv) {
        // Signed 16-bit; even id = little-endian, odd = big-endian; then a fixed-point scale.
        case 101: r.value = read_s16(data, n, false);              r.ok = true; break;
        case 102: r.value = read_s16(data, n, true);               r.ok = true; break;
        case 103: r.value = read_s16(data, n, false) / 256.0;      r.ok = true; break;
        case 104: r.value = read_s16(data, n, true) / 256.0;       r.ok = true; break;
        case 105: r.value = read_s16(data, n, false) * 0.1;        r.ok = true; break;   // temperature (LE)
        case 106: r.value = read_s16(data, n, true) * 0.1;         r.ok = true; break;
        case 107: r.value = read_s16(data, n, false) * 0.1;        r.ok = (r.value != -3276.8); break;
        case 108: r.value = read_s16(data, n, true) * 0.1;         r.ok = (r.value != -3276.8); break;
        case 109: r.value = read_s16(data, n, false) / 256.0 * 2.0; r.ok = true; break;
        case 110: r.value = read_s16(data, n, true) / 256.0 * 2.0;  r.ok = true; break;
        case 111: r.value = read_s16(data, n, true) * 0.5;         r.ok = true; break;
        // Unsigned 16-bit (counts / steps / CT current).
        case 151: r.value = read_u16(data, n, false);             r.ok = true; break;
        case 152: r.value = read_u16(data, n, true);              r.ok = true; break;
        case 161: r.value = read_u16(data, n, true) * 0.5;        r.ok = true; break;    // CT current (0.5 A)
        // Target/ECH2O temps: signed LE ×0.1, with 0x8000 (-3276.8) meaning "no data".
        case 114:
        case 119: r.value = read_s16(data, n, false) * 0.1;       r.ok = (r.value != -3276.8); break;
        // Signed big-endian ×0.01 (mixed-water temp).
        case 118: r.value = read_s16(data, n, true) * 0.01;       r.ok = true; break;
        // Refrigerant pressure raw (signed LE ×0.1) -> saturation temperature (°C). A 0/negative
        // pressure is an absent/idle sensor (an OU with the compressor off publishes 0 bar), not a
        // reading — its saturation temperature (press2temp(0) ≈ -51 °C) is a placeholder, so drop it
        // rather than publish an impossible sat-temp. A running circuit's low-side pressure is well
        // above 0, so this never hides a real reading.
        case 405: {
            const double bar = read_s16(data, n, false) * 0.1;
            if (bar <= 0.0) break;                                 // absent sensor -> r.ok stays false
            r.value = press2temp(bar, rtype);                     r.ok = true;
            break;
        }

        // ── Bit flags: conv 300+b -> bit b (0=LSB) of data[0] -> ON/OFF ──
        case 300: case 301: case 302: case 303:
        case 304: case 305: case 306: case 307:
            set_text(r, (data[0] & (1 << (def.conv - 300))) ? "ON" : "OFF"); break;

        // ── Enum labels ──
        case 217: { int v = data[0];                                          // operation mode
                    set_text(r, v < 20 ? OP_MODE[v] : "?"); break; }
        case 315: { int v = (data[0] >> 4) & 0x0F;                            // indoor mode (hi nibble)
                    set_text(r, (v < 7 && IU_MODE[v][0]) ? IU_MODE[v] : "?"); break; }
        case 203: { int v = data[0];                                          // error class
                    set_text(r, v < 4 ? ERR_TYPE[v] : "?"); break; }
        case 316: { int v = data[0];                                          // hybrid mode
                    set_text(r, v < 3 ? HYBRID[v] : "?"); break; }
        case 211: if (data[0] == 0) set_text(r, "OFF");                       // fan step
                  else { r.value = data[0]; r.ok = true; } break;
        case 204: { char t[3] = {ERR_C1[(data[0] >> 4) & 0xF], ERR_C2[data[0] & 0xF], 0};
                    set_text(r, t[0] == ' ' ? t + 1 : t); break; }            // error code (2 chars)
        case 219: r.value = data[0]; r.ok = true; break;                      // I/U capacity code
        // 3-bit protection-retry counter, bits 4-6 (docs/REGISTERS.md §3.3). Page 0x10 packs FOUR
        // fields into each of bytes 10-12 — a drop-control flag at bit 7 (conv 307), this retry
        // counter at bits 4-6, a second drop flag at bit 3 (conv 303) and a second retry counter at
        // bits 0-2 (conv 311 below) — so the window must be masked out, never the whole byte: 0x95
        // is 1 retry (alongside Drop-Control set and 5 in the low counter), not 149.
        case 310: r.value = (data[0] & 0x70) >> 4; r.ok = true; break;        // protection retry qty

        // 3-bit counter / BUH output-capacity step, bits 0-2 (docs/REGISTERS.md §3.3). The byte's
        // upper bits belong to OTHER fields, so they must be masked off, not published: reading the
        // whole byte reported 133 for a step of 5 whenever any high bit was set.
        case 311: r.value = data[0] & 0x07; r.ok = true; break;               // BUH output capacity

        // ── EEPROM model-identification digits (page 0x11 / 0x63): raw byte. conv 215 packs a
        //    digit pair, conv 214 a single digit. There is no digits->model-name table in the repo
        //    (docs/REGISTERS.md), so these are exposed raw; hp_detect renders page 0x11 for display
        //    via logic/detect.hpp eeprom_render(). ──
        case 214:
        case 215: r.value = data[0]; r.ok = true; break;

        // ── Refrigerant type: encoded by the converter id itself; reads no bytes ──
        case 801: set_text(r, "R410A"); break;
        case 802: set_text(r, "R32");   break;
        case 803: set_text(r, "R22");   break;
        case 804: set_text(r, "R407C"); break;
        case 805: set_text(r, "R134a"); break;

        // --- Reference Converter IDs documented in REGISTERS.md but not implemented/used by profiles ---
        // Stubs for future extensions or unimplemented catalog converters.
        case 112: case 113: case 115: case 116: case 117:
        case 153: case 154: case 155: case 156: case 157: case 158: case 159: case 160:
        case 162: case 163:
        case 401: case 402: case 403: case 404: case 406: case 407: case 408: case 409:
        case 410: case 411: case 412: case 413: case 414: case 415: case 416: case 417: case 418:
        case 451: case 452: case 453: case 454: case 455: case 456: case 457: case 458: case 459:
        case 460: case 461: case 462: case 463: case 464: case 465:
        case 881: case 882: case 883: case 884: case 885:
            r.unimpl = true;
            break;

        default:
            // Converter id not yet ported -> value simply skipped (never reported wrong).
            r.unimpl = true;
            break;
    }
    return r;
}

// Physical envelope for a °C reading (dataType 1). A decoded temperature outside this range is a
// no-data / absent-sensor placeholder — an idle outdoor unit reporting 576 °C or a 231 °C target, a
// floating sensor, or a ±3276.x sentinel — never a real Altherma reading. The widest LEGITIMATE span
// is roughly the outdoor coil in hard frost (about -30 °C) to compressor discharge under load (about
// 130 °C), so these bounds clip nothing real while dropping the impossible values.
inline constexpr double TEMP_MIN_C = -60.0;
inline constexpr double TEMP_MAX_C = 200.0;

// Publish-time plausibility filter: is this decoded Reading fit to publish? Drops a °C temperature
// (dataType 1) outside the physical envelope. Keyed on the °C dataType, NOT the converter id, because
// the temperature converters (105/114/118/119/405) are also used for non-°C rows (conv 105 carries
// O/U capacity kW and BE_COP at dataType -1) that must pass through unchanged.
//
// Deliberately SEPARATE from convert() and applied by hp_format at publish time, not folded into the
// converter: convert() must keep its INTRINSIC per-converter semantics so the catalog audit's
// converters_equivalent() can still tell conv 105 (no sentinel guard) from conv 114 (drops raw 0x8000
// as "no data") — the exact distinction behind the #38 no-data-sentinel bug. Folding the envelope
// into convert() makes 105 and 114 decode identically on °C rows, which silently blinds that gate
// (tools/domain/selftest.sh #38). This is a backstop, never a licence to use the wrong converter.
inline bool reading_plausible(const ValueDef& def, const Reading& r) {
    if (!r.ok) return true;                       // no numeric value to bound (text, or already dropped)
    if (def.type == 1 && (r.value < TEMP_MIN_C || r.value > TEMP_MAX_C)) return false;
    return true;
}

// The active profile declares its refrigerant once via a size-0 row whose conv id is 801-805
// (801=R410A, 802=R32, 803=R22, 804=R407C, 805=R134a). That id selects the press2temp curve used by
// conv-405 saturation-temperature rows; without it every unit would decode on the R32 curve (the
// press2temp default), off by several °C on an R410A/R22 unit. Returns the declared id, or 802 (R32)
// when the profile carries no refrigerant row. 804/805 have no dedicated curve and fall back to R32.
inline int profile_refrigerant(const ValueDef* v, size_t count) {
    for (size_t i = 0; i < count; i++)
        if (v[i].conv >= 801 && v[i].conv <= 805) return v[i].conv;
    return 802;
}

// Decimal places for a numeric converter's display/publish string. conv 118 is a signed ×0.01 value
// (two decimals); the ×0.1 / ÷256 / ×0.5 scaled families (103-119, 161, 405) keep one; everything
// else is an integer. Kept here (not in the device .cpp) so the precision policy is host-tested.
inline int display_decimals(int conv) {
    if (conv == 118) return 2;
    if ((conv >= 103 && conv <= 119) || conv == 161 || conv == 405) return 1;
    return 0;
}

// Home Assistant hints from the value's dataType field — the classic Altherma unit code
// (1 = °C temperature, 2 = bar pressure, 3 = A current, -1/other = generic; current is often
// carried in the label as "(A)" and left generic). Cross-checked against a second X10A
// implementation.
inline const char* unit_for_datatype(int dataType) {
    switch (dataType) {
        case 1:  return "°C";
        case 2:  return "bar";
        case 3:  return "A";
        default: return "";
    }
}
inline const char* device_class_for_datatype(int dataType) {
    switch (dataType) {
        case 1:  return "temperature";
        case 2:  return "pressure";
        case 3:  return "current";
        default: return "";
    }
}

} // namespace daik
