#pragma once
// ── Demo mode (fabricated readings) ─────────────────────────────────────────────────────────────
// When demo mode is enabled (Config::demo), the poll engine skips the X10A UART entirely and asks
// this header to FABRICATE the register bytes for every value in the active profile. Those bytes
// then flow through the exact same convert()/hp_format() decode path as real data, so the web UI,
// GET /values and (once wired) the MQTT bridge all see realistic, self-consistent readings — as if
// a unit were physically connected. No hardware, no UART, no protocol traffic.
//
// IDF-free and host-tested (test/test_logic.cpp). Deliberately isolated in ONE header so demo mode
// is trivial to:
//   • EXTEND — add/adjust a case in demo_encode() (a new converter, a nicer target range), or a
//     keyword in the target pickers below; nothing else changes.
//   • REMOVE — delete this file, the `demo` field in logic/config_model.hpp, its NVS load/save in
//     config.cpp, the `/set_hp` + `/status` plumbing, the poll-engine branch, and the UI toggle.
//     Nothing in the real decode path depends on this header.
#include <cmath>
#include <cstdint>
#include "value_def.hpp"
#include "registers.hpp"

namespace daik {

// Deterministic, board-free "liveliness": a smooth-ish wobble in roughly [-1, 1) as a pure function
// of (seed, tick). Different values pass different seeds so sensors drift independently. No RNG —
// a replay is bit-identical, and this path never needs Math.random.
inline double demo_wobble(uint32_t seed, uint32_t tick) {
    uint32_t x = seed * 2654435761u + tick * 40503u;
    x ^= x >> 13; x *= 1274126177u; x ^= x >> 16;
    return static_cast<int32_t>(x % 2000 - 1000) / 1000.0;   // [-1.000, +0.999]
}

// case-insensitive "label contains needle" (needle must be lowercase ASCII).
inline bool demo_label_has(const ValueDef& def, const char* needle) {
    for (const char* h = def.label; *h; ++h) {
        const char* a = h; const char* b = needle;
        while (*a && *b) {
            char ca = *a; if (ca >= 'A' && ca <= 'Z') ca = static_cast<char>(ca + 32);
            if (ca != *b) break;
            ++a; ++b;
        }
        if (!*b) return true;
    }
    return false;
}

// Plausible temperature (°C) for a value, from label semantics: outdoor cold, leaving water warm,
// DHW tank hot, discharge pipe hottest. Wobble drifts it ±0.5 °C between polls so the dashboard
// looks alive.
inline double demo_temp_target(const ValueDef& def, uint32_t tick) {
    double base = 25.0;
    if      (demo_label_has(def, "outdoor"))                                          base = 6.0;
    else if (demo_label_has(def, "dhw") || demo_label_has(def, "tank") ||
             demo_label_has(def, "hot water"))                                        base = 48.0;
    else if (demo_label_has(def, "discharge"))                                        base = 72.0;
    else if (demo_label_has(def, "suction"))                                          base = 4.0;
    else if (demo_label_has(def, "brine"))                                            base = 8.0;
    else if (demo_label_has(def, "leaving") || demo_label_has(def, "lw setpoint") ||
             demo_label_has(def, "cond"))                                             base = 35.0;
    else if (demo_label_has(def, "inlet") || demo_label_has(def, "return"))           base = 30.0;
    else if (demo_label_has(def, "evap"))                                             base = 1.0;
    else if (demo_label_has(def, "heat sink") || demo_label_has(def, "fin"))          base = 42.0;
    else if (demo_label_has(def, "heat exch"))                                        base = 3.0;
    else if (demo_label_has(def, "mixed"))                                            base = 33.0;
    else if (demo_label_has(def, "ambient") || demo_label_has(def, "room") ||
             demo_label_has(def, "rt setpoint"))                                      base = 21.5;
    else if (demo_label_has(def, "liquid"))                                           base = 12.0;
    return base + demo_wobble(def.conv * 131u + def.offset, tick) * 0.5;
}

// Plausible value in the value's own unit, dispatched by HA unit hint (type) then label.
inline double demo_numeric_target(const ValueDef& def, uint32_t tick) {
    if (def.type == 2) {                                                    // bar
        if (demo_label_has(def, "water")) return 1.8 + demo_wobble(def.offset + 7u, tick) * 0.05;
        return 24.0 + demo_wobble(def.offset + 9u, tick) * 0.6;            // refrigerant pressure
    }
    if (def.type == 3 || demo_label_has(def, "(a)") || demo_label_has(def, "current"))
        return 3.4 + demo_wobble(def.conv + def.offset, tick) * 0.4;        // amperes
    if (demo_label_has(def, "flow"))                                        // l/min
        return 18.0 + demo_wobble(def.offset + 3u, tick) * 1.5;
    if (demo_label_has(def, "capacity") || demo_label_has(def, "kw"))       // kW
        return 6.0 + demo_wobble(def.offset, tick) * 0.5;
    if (demo_label_has(def, "signal")) return 40.0;                         // pump signal 0..100
    return demo_temp_target(def, tick);                                     // default: °C
}

// Should a boolean flag read ON? Chosen so the dashboard looks like a unit actively heating
// (thermostat + pumps + flow on) with protection/valve/alarm flags idle.
inline bool demo_flag_on(const ValueDef& def) {
    return demo_label_has(def, "thermostat")
        || demo_label_has(def, "water pump") || demo_label_has(def, "pump operation")
        || demo_label_has(def, "space heating operation") || demo_label_has(def, "space h operation")
        || demo_label_has(def, "water flow switch");
}

// Write `raw` into out[] honouring the field width and byte order; returns the byte count written.
// A 1-byte field is clamped to 0..255 (matches how real 1-byte fields never set the sign bit).
inline int demo_put(uint8_t out[2], long raw, bool big_endian, int size) {
    if (size <= 1) { long v = raw < 0 ? 0 : (raw > 255 ? 255 : raw); out[0] = static_cast<uint8_t>(v); return 1; }
    uint16_t u = static_cast<uint16_t>(raw);
    if (big_endian) { out[0] = static_cast<uint8_t>(u >> 8); out[1] = static_cast<uint8_t>(u & 0xFF); }
    else            { out[0] = static_cast<uint8_t>(u & 0xFF); out[1] = static_cast<uint8_t>(u >> 8); }
    return 2;
}

// Fabricate the raw register bytes for `def` into out[0..1] so that convert(def, out) decodes back
// to a plausible reading. Returns the number of bytes written (0, 1 or 2). Converter ids not
// handled here return 0, and convert() then skips the value (never reports it wrong) — exactly as
// for a real unit that doesn't populate it.
inline int demo_encode(const ValueDef& def, uint32_t tick, uint8_t out[2]) {
    out[0] = 0; out[1] = 0;
    auto num = [&](double scale, bool be) {
        return demo_put(out, std::lround(demo_numeric_target(def, tick) * scale), be, def.size);
    };
    switch (def.conv) {
        // ── signed / unsigned numeric, fixed-point (see logic/convert.hpp) ──
        case 101: return num(1.0,   false);
        case 102: return num(1.0,   true);
        case 103: return num(256.0, false);
        case 104: return num(256.0, true);
        case 105: case 107: case 114: case 119: return num(10.0,  false);   // ×0.1 LE
        case 106: case 108:                     return num(10.0,  true);    // ×0.1 BE
        case 109: return num(128.0, false);
        case 110: return num(128.0, true);
        case 111: return num(2.0,   true);
        case 118: return num(100.0, true);                                   // ×0.01 BE
        case 151: return num(1.0,   false);
        case 152: return num(1.0,   true);
        case 161: return num(2.0,   true);                                   // CT current ×0.5
        // Refrigerant pressure -> saturation temperature: feed a plausible raw pressure (~28 bar).
        case 405: return demo_put(out, 280 + std::lround(demo_wobble(def.offset, tick) * 20), false, def.size);

        // ── enums / flags ──
        case 217: out[0] = 1;    return 1;   // operation mode = Heating
        case 315: out[0] = 0x10; return 1;   // indoor mode (hi nibble) = Heating
        case 203: out[0] = 0;    return 1;   // error class = Normal
        case 204: out[0] = 0;    return 1;   // error code -> "0" (none)
        case 316: out[0] = 0;    return 1;   // hybrid mode = H/P only
        case 211: out[0] = 3;    return 1;   // fan step
        case 219: out[0] = 8;    return 1;   // I/U capacity code
        case 300: case 301: case 302: case 303:
        case 304: case 305: case 306: case 307:
            out[0] = demo_flag_on(def) ? static_cast<uint8_t>(1 << (def.conv - 300)) : 0;
            return 1;

        // Refrigerant-type converters read no bytes (label encoded by the id).
        case 801: case 802: case 803: case 804: case 805: return 0;

        default: return 0;   // not fabricated -> skipped, same as an unavailable register
    }
}

} // namespace daik
