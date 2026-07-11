#pragma once
// Pure model/protocol auto-detection logic. IDF-free + host-tested (test/test_logic.cpp).
//
// Given a "fingerprint" of what the unit put on the X10A bus — which register pages answered, the
// O/U capacity, the O/U EEPROM digits — and the per-profile signatures (built in def/signatures.hpp
// from the embedded ValueDef tables), narrow the model profiles to the set consistent with the
// unit. The result is usually a SMALL SET, not a single model: many Altherma variants are
// electrically identical on X10A (e.g. EHV/EHB/EHVZ = same PCB, different packaging) and cannot be
// told apart from bus data. The device glue that gathers the fingerprint is hp_detect.cpp; the UI
// then auto-applies a lone candidate or offers the reduced set. See docs/ARCHITECTURE.md.
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace daik {

// A register page maps to one bit of a 32-bit page mask. Only pages that a value profile can
// reference participate — 0x11 (O/U EEPROM) is probed for its digits but deliberately NOT in the
// mask, since no profile decodes it and its presence would break exact page matching. Returns -1
// for a register we do not fingerprint on.
inline int page_bit(uint8_t reg) {
    switch (reg) {
        case 0x00: return 0;
        case 0x10: return 1;
        case 0x20: return 2;
        case 0x21: return 3;
        case 0x30: return 4;
        case 0x60: return 5;
        case 0x61: return 6;
        case 0x62: return 7;
        case 0x63: return 8;
        case 0x64: return 9;
        case 0x65: return 10;
        case 0xA0: return 11;
        case 0xA1: return 12;
        default:   return -1;
    }
}

inline uint32_t page_mask_bit(uint8_t reg) {
    const int b = page_bit(reg);
    return b < 0 ? 0u : (1u << b);
}

// The unit facts gathered from the bus (filled by hp_detect.cpp).
struct Fingerprint {
    uint32_t page_mask = 0;      // one bit per answering page (page_bit)
    int      kw_tenths = -1;     // O/U capacity in 0.1 kW; -1 = unknown / not reported
    uint8_t  eeprom[6] = {0};    // O/U EEPROM digits (page 0x11 offsets 0..5)
    bool     eeprom_ok = false;
};

// A profile's detection signature (built in def/signatures.hpp from its ValueDef table + id).
struct Signature {
    const char* id;
    uint32_t    page_mask;       // pages the profile references
    int         kw_min_tenths;   // capacity class parsed from the id; -1 = unknown (no kW filter)
    int         kw_max_tenths;
};

// Parse a capacity class out of a profile id ("..._04_08kw", "..._9_16kw", "..._3kw",
// "...ca_05_07kw", "..._8_12kw_ech2o"). Writes [lo,hi] in 0.1 kW units and returns true; on no
// match writes -1/-1 and returns false. Hand-rolled (no <regex>/<cctype>) so it is identical on
// host and device: find the trailing "kw" token, then read one or two underscore-separated integer
// groups immediately before it. Model codes like "12p30_50" never end in "kw" so they never match.
inline bool parse_kw_class(const char* id, int& lo_tenths, int& hi_tenths) {
    lo_tenths = hi_tenths = -1;
    if (!id) return false;
    const int len = static_cast<int>(std::strlen(id));

    // Locate the last "kw".
    int kw = -1;
    for (int i = len - 2; i >= 0; i--)
        if ((id[i] == 'k' || id[i] == 'K') && (id[i + 1] == 'w' || id[i + 1] == 'W')) { kw = i; break; }
    if (kw < 0) return false;

    auto is_digit = [](char ch) { return ch >= '0' && ch <= '9'; };
    int i = kw - 1;
    if (i >= 0 && id[i] == '_') i--;                       // optional '_' as in "04_08_kw"

    // High group: run of digits ending at i.
    const int hi_end = i;
    while (i >= 0 && is_digit(id[i])) i--;
    if (i == hi_end) return false;                         // no digit before "kw" -> not a capacity
    int hi = 0;
    for (int k = i + 1; k <= hi_end; k++) hi = hi * 10 + (id[k] - '0');

    // Optional low group: "_<digits>" immediately before the high group.
    int lo = hi;
    if (i >= 0 && id[i] == '_') {
        int j = i - 1;
        const int lo_end = j;
        while (j >= 0 && is_digit(id[j])) j--;
        if (j != lo_end) { lo = 0; for (int k = j + 1; k <= lo_end; k++) lo = lo * 10 + (id[k] - '0'); }
    }
    if (lo > hi) { const int t = lo; lo = hi; hi = t; }
    lo_tenths = lo * 10;
    hi_tenths = hi * 10;
    return true;
}

// Is the unit consistent with this profile signature? The profile's pages must be a subset of the
// pages the unit answered, and — when both are known — the unit's capacity must fall in the
// profile's kW class.
inline bool signature_consistent(const Signature& sig, const Fingerprint& fp) {
    if ((sig.page_mask & fp.page_mask) != sig.page_mask) return false;   // profile pages not all present
    if (sig.kw_min_tenths >= 0 && fp.kw_tenths >= 0)
        if (fp.kw_tenths < sig.kw_min_tenths || fp.kw_tenths > sig.kw_max_tenths) return false;
    return true;
}

// Narrow the profiles to the best-fitting candidates for a fingerprint. Consistent profiles are
// those whose pages are present and whose kW class contains the unit's capacity; among them we keep
// only the ones with MAXIMAL page overlap (largest page_mask), which drops feature-poor profiles
// that merely happen to be a subset of a feature-rich unit. Fills out[] with up to `max` candidate
// ids (in signature order) and returns the total candidate count (which may exceed `max`).
inline int detect_candidates(const Signature* sigs, int nsig, const Fingerprint& fp,
                             const char** out, int max) {
    int best_pop = -1;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        const int pop = __builtin_popcount(sigs[i].page_mask);
        if (pop > best_pop) best_pop = pop;
    }
    if (best_pop < 0) return 0;

    int n = 0;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        if (__builtin_popcount(sigs[i].page_mask) != best_pop) continue;
        if (n < max && out) out[n] = sigs[i].id;
        n++;
    }
    return n;
}

// Render the O/U EEPROM digit bytes to a printable string (space-separated hex pairs) for display
// only — there is no digits->model-name table in the repo (docs/REGISTERS.md), so these bytes help
// a human match a nameplate but are not decoded to a model name. Always NUL-terminates `out`.
inline void eeprom_render(const uint8_t* b, int n, char* out, int outsz) {
    static const char HEX[] = "0123456789ABCDEF";
    int o = 0;
    for (int i = 0; i < n && o + 3 < outsz; i++) {
        if (i) out[o++] = ' ';
        out[o++] = HEX[(b[i] >> 4) & 0xF];
        out[o++] = HEX[b[i] & 0xF];
    }
    if (outsz > 0) out[o < outsz ? o : outsz - 1] = '\0';
}

} // namespace daik
