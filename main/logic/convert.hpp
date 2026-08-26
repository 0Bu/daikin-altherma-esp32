#pragma once
// Value converters — raw register bytes -> typed reading. This is the single riskiest piece of the
// port (a wrong sign/scale/endianness silently corrupts a reading), so it is IDF-free and unit-
// tested per converter id in test/test_logic.cpp.
//
// Semantics (cross-checked against two independent X10A implementations): convs 101-111 read a
// SIGNED 16-bit field, 151-165 an UNSIGNED one; within a group the id's parity selects endianness
// (flag 0 = little-endian, flag 1 = big-endian). A 1-byte field is read from data[0]. The large set
// of enum/label converters (operating-mode, fan-step, error codes) is generated alongside
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
// OP_MODE index 0 is "Stop", not the split-air-conditioner vocabulary's "Fan Only" (#216). A
// hydronic Altherma has no fan-only mode, and index 0 is the value an idle outdoor unit reports —
// so the one entry every user sees most of the day was the one that was false. MEASURED on a live
// Altherma 3 R W (1.0.0-dev.211) via logic/raw_capture.hpp, which dumps page 0x10 across the
// stopped->running edge that a detect-pass dump structurally cannot reach:
//     at rest   raw 0x10 [00 04 ...]   -> byte 0 = 0x00
//     running   raw 0x10 [01 00 ...], [01 20 ...] x2 (three captures, one run)
// Byte 0 steps 0x00 -> 0x01 exactly at the transition and index 1 already decoded correctly as
// "Heating", which is what makes this a relabel of ONE entry rather than a shifted table: the
// evidence bounds indices 0 and 1 and says nothing about the rest. Indices 2..19 are reference-
// derived and unmeasured: 5/6 retain their independently adjudicated order, while 19 retains the
// catalog-only second "Aux.". Several ("Ventilation", "Dry", the storage modes) cannot occur on a
// hydronic unit either, but "probably also wrong" is the guess this project refuses. The table in
// docs/REGISTERS.md §4.1 moves with this one; the domain audit makes disagreement a hard error.
inline constexpr const char* OP_MODE[] = {                          // conv 217 (data[0])
    "Stop", "Heating", "Cooling", "Auto", "Ventilation", "Auto Cool", "Auto Heat", "Dry",
    "Aux.", "Cooling Storage", "Heating Storage", "UseStrdThrm(cl)1", "UseStrdThrm(cl)2",
    "UseStrdThrm(cl)3", "UseStrdThrm(cl)4", "UseStrdThrm(ht)1", "UseStrdThrm(ht)2",
    "UseStrdThrm(ht)3", "UseStrdThrm(ht)4", "Aux."};
inline constexpr int OP_MODE_COUNT = static_cast<int>(sizeof(OP_MODE) / sizeof(OP_MODE[0]));
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

// Publication boundary guard: no value may leave the firmware as the exact text ON/OFF. Current
// bit/fan converters are numeric below, but keeping this normalizer beside the converter prevents a
// future enum from silently reintroducing the old wire values through hp_format().
inline const char* on_off_number(const char* text) {
    if (!text) return nullptr;
    if (text[0] == 'O' && text[1] == 'N' && text[2] == '\0') return "1";
    if (text[0] == 'O' && text[1] == 'F' && text[2] == 'F' && text[3] == '\0') return "0";
    return nullptr;
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

        // ── Bit flags: conv 300+b -> bit b (0=LSB) of data[0] -> numeric 1/0 ──
        // Numeric at the source so every consumer — /values, WebSocket, history and MQTT — observes
        // the same contract. Text ON/OFF must never enter the publish cache.
        case 300: case 301: case 302: case 303:
        case 304: case 305: case 306: case 307:
            r.value = (data[0] & (1 << (def.conv - 300))) ? 1.0 : 0.0;
            r.ok = true;
            break;

        // ── Enum labels ──
        case 217: { int v = data[0];                                          // operation mode
                    set_text(r, v < OP_MODE_COUNT ? OP_MODE[v] : "?"); break; }
        case 315: { int v = (data[0] >> 4) & 0x0F;                            // indoor mode (hi nibble)
                    set_text(r, (v < 7 && IU_MODE[v][0]) ? IU_MODE[v] : "?"); break; }
        case 203: { int v = data[0];                                          // error class
                    set_text(r, v < 4 ? ERR_TYPE[v] : "?"); break; }
        case 316: { int v = data[0];                                          // hybrid mode
                    set_text(r, v < 3 ? HYBRID[v] : "?"); break; }
        case 211: r.value = data[0]; r.ok = true; break;                     // fan step (0 = stopped)
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

// ── The published TYPE of a row, decided by its DEFINITION ───────────────────────────────────────
// A field's JSON type must come from the converter, never from sniffing the value that happens to
// be in it this second. Issue #209 measured what the second one costs: conv 211 (fan step) used to
// emit the number 30 while the fan ran and the string "OFF" when it stopped, so the same MQTT key
// changed JSON type during normal operation — Telegraf's numeric parser dropped the string, no zero
// ever reached VictoriaMetrics, and the last running step stayed on the chart as if the fan were
// still turning. (That converter is numeric since #210; this predicate is what makes the property
// structural instead of a fact about the current implementation.)
//
// Two kinds only. Number covers every scaled/unsigned/counter/bit-flag converter — the bit flags
// are 1/0 NUMBERS at the source (see the 300-307 case above), so "binary" is not a third wire type.
// Text is the closed set of enum/label converters, each of which calls set_text() unconditionally:
// there is deliberately no converter that returns text for one state and a number for another, and
// the catalog-wide test asserts that over every implemented id rather than trusting this list.
enum class PublishedKind : uint8_t { Number, Text };

inline constexpr PublishedKind published_kind(int conv) {
    switch (conv) {
        case 203:                       // error class ("Normal"/"Error"/"Warning"/"Caution")
        case 204:                       // Daikin error code ("00", "U4", "7H")
        case 217:                       // operation mode
        case 315:                       // indoor operation mode
        case 316:                       // hybrid mode
        case 801: case 802: case 803:   // refrigerant type — encoded by the converter id itself
        case 804: case 805:
            return PublishedKind::Text;
        default:
            return PublishedKind::Number;
    }
}

// Is this converter's reading a BOOLEAN — one bit of data[0], decoded to numeric 1/0 above? The
// bit-flag family 300-307 is the whole set; every row using it is size 1 / dataType -1 (no unit, no
// device class), which is why a binary row needs no unit handling anywhere downstream.
//
// Discovery keys on this predicate rather than the numeric value: zero is also a legitimate reading
// for non-binary converters, so value sniffing would type unrelated sensors as binary_sensors.
inline bool conv_is_binary(int conv) { return conv >= 300 && conv <= 307; }

// Physical envelope for a °C reading (dataType 1). A decoded temperature outside this range is a
// no-data / absent-sensor placeholder — an idle outdoor unit reporting 576 °C or a 231 °C target, a
// floating sensor, or a ±3276.x sentinel — never a real Altherma reading. The widest LEGITIMATE span
// is roughly the outdoor coil in hard frost (about -30 °C) to compressor discharge under load (about
// 130 °C), so these bounds clip nothing real while dropping the impossible values.
inline constexpr double TEMP_MIN_C = -60.0;
inline constexpr double TEMP_MAX_C = 200.0;

// Is this bar row (dataType 2) a REFRIGERANT-circuit pressure rather than a WATER one? The
// distinction matters because 0 bar is impossible for one and ordinary for the other, so a single
// "0 bar is bogus" rule would be wrong half the time.
//
// STRUCTURAL, never label-based: an alias or a translation must not be able to flip it (the
// lwt_select.hpp lesson), and a hand-written (reg, offset) list would rot the next time the profiles
// are regenerated. Two independent structural signals, either of which is sufficient:
//
//  1. The PAGE. 0x20/0x21 (outdoor sensors + inverter) and 0xA0/0xA1 (the second outdoor unit) are
//     the outdoor unit's own pages — there is no water circuit out there. Measured across all 45
//     shipped profiles: every dataType-2 row on 0x20 and 0xA0 is a refrigerant pressure (High/Low
//     Pressure, "Pressure", "Pressure sensor") and NOT ONE water-pressure row appears on either.
//     0x21/0xA1 carry no bar row today and are included because the same physical argument covers
//     them, not because anything was measured there.
//  2. A conv-405 SATURATION-TEMPERATURE twin at the same (reg, offset). 405 converts a pressure to
//     its refrigerant saturation temperature, so the generator only ever pairs one with a
//     refrigerant pressure. This is what reaches the refrigerant rows on the HYDRONIC page 0x62,
//     where signal 1 cannot help: 0x62 genuinely carries both kinds — "Water pressure" (0x62/11) and
//     "Refrigerant pressure sensor" (0x62/15) sit on the same page.
//
// KNOWN GAP, deliberately left rather than papered over: 16 of the 24 "Refrigerant pressure sensor"
// rows (and one "Pressure sensor") sit on 0x62 with NO 405 twin, so neither signal reaches them and
// they still publish a 0.0 bar. Closing that would mean keying on the label, which is the one thing
// this must not do. Those rows are no worse off than before this filter existed, and the catalog-wide
// test pins both the coverage and — the direction that actually matters — that no water-pressure row
// is ever caught by either signal.
// The structural half is shared with feature_gate.hpp.  Keeping the page/twin decision here avoids
// the future inference gate growing a second, label-based definition of "refrigerant pressure" and
// accidentally accepting the hydronic Water pressure row merely because both use dataType 2 (bar).
inline bool is_refrigerant_pressure_structure(const ValueDef& def, bool has_saturation_twin) {
    if (def.type != 2) return false;
    if (def.reg == 0x20 || def.reg == 0x21 || def.reg == 0xA0 || def.reg == 0xA1) return true;
    return has_saturation_twin;
}

inline bool is_refrigerant_pressure(const ValueDef& def, const ValueDef* profile, size_t count) {
    bool has_saturation_twin = false;
    if (!profile) return is_refrigerant_pressure_structure(def, false);
    for (size_t i = 0; i < count; i++)
        if (profile[i].conv == 405 && profile[i].reg == def.reg && profile[i].offset == def.offset) {
            has_saturation_twin = true;
            break;
        }
    return is_refrigerant_pressure_structure(def, has_saturation_twin);
}

// Publish-time plausibility filter: is this decoded Reading fit to publish? Drops a °C temperature
// (dataType 1) outside the physical envelope. Keyed on the °C dataType, NOT the converter id, because
// the temperature converters (105/114/118/119/405) are also used for non-°C rows (conv 105 carries
// O/U capacity kW and BE_COP at dataType -1) that must pass through unchanged.
//
// ALSO drops a refrigerant pressure at or below 0 bar. These are ABSOLUTE pressures (measured: 15.3
// bar at a 22.1 °C saturation temperature, matching R32's saturation curve), and a sealed refrigerant
// circuit is never at absolute vacuum — so 0.0 bar is an absent/unreported transducer, not a reading.
// Observed on a live 4-8 kW unit: "High Pressure" and "Low Pressure" (0x20/12+14) read exactly 0.0
// bar both at rest AND with the compressor at 42 rps, while the always-live 0x62/15 refrigerant
// sensor read a correct 15.3 bar. Publishing that 0.0 as a measurement is the #35-#39 shape — a
// well-formed, plausible-looking, physically false value — and it reached Home Assistant as a real
// pressure. Their conv-405 saturation-temperature companions were already dropped by the °C envelope
// above (press2temp of 0 bar falls off the curve), so this only makes the pressure agree with the
// temperature the same row already declines to publish. Water pressure is deliberately NOT covered:
// a drained or depressurised system genuinely reads 0 bar and must keep saying so.
//
// Deliberately SEPARATE from convert() and applied by hp_format at publish time, not folded into the
// converter: convert() must keep its INTRINSIC per-converter semantics so the catalog audit's
// converters_equivalent() can still tell conv 105 (no sentinel guard) from conv 114 (drops raw 0x8000
// as "no data") — the exact distinction behind the #38 no-data-sentinel bug. Folding the envelope
// into convert() makes 105 and 114 decode identically on °C rows, which silently blinds that gate
// (tools/domain/selftest.sh #38). This is a backstop, never a licence to use the wrong converter.
//
// `profile`/`count` are the active model's whole ValueDef table, needed only for the refrigerant test
// above; they default to none, so a caller that has no table in hand keeps exactly the old °C-only
// behaviour rather than silently losing the pressure rule to a wrong answer.
inline bool reading_plausible(const ValueDef& def, const Reading& r,
                              const ValueDef* profile = nullptr, size_t count = 0) {
    if (!r.ok) return true;                       // no numeric value to bound (text, or already dropped)
    if (def.type == 1 && (r.value < TEMP_MIN_C || r.value > TEMP_MAX_C)) return false;
    if (r.value <= 0.0 && is_refrigerant_pressure(def, profile, count)) return false;
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
