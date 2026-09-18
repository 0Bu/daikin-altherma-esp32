#pragma once
// Return-water MEASUREMENT selection — the row the web UI feeds into ΔT, the derived heat output
// ("pth = flow/60 * 4.186 * dt"), COP and the return-water trend.
//
// This header is the host-testable twin of www/js/schematic.js's rwtRow(): the SELECTION happens
// browser-side (there is no firmware caller), but the rule runs against the generated def/ profile
// LABELS, which are C++ — so mirroring it here lets CI gate it against the whole catalog (every
// detectable profile must select a real return/inlet water measurement, never an outdoor sensor,
// brine inlet, or second-outdoor-unit raw data from page 0xA1). Keep the two in lockstep: both use
// lowercase substring matching (no regex) so the token lists below are byte-for-byte comparable.
//
//   water(l)   := l⊇"inlet water" | "return water" | "return temp" | "water heat exchanger inlet"
//   reject(l)  := l⊇"raw data" | "o/u" | "deicer" | "phase" | "outdoor" | "brine"
//   Tier 1 (PHE inlet R4T): water(l) && !reject(l) && l⊇"r4t"
//   Tier 2 (fallback): water(l) && !reject(l)
//   select := first Tier-1 index, else first Tier-2 index, else -1
#include <cstddef>

namespace daik::logic {

// Case-insensitive substring test (ASCII-fold; labels are English ASCII). needle must be lowercase.
inline bool rwt_ci_contains(const char* hay, const char* needle) {
    if (!hay || !needle || !*needle) return false;
    for (const char* h = hay; *h; ++h) {
        const char* a = h;
        const char* b = needle;
        while (*a && *b) {
            char ca = *a;
            if (ca >= 'A' && ca <= 'Z') ca = static_cast<char>(ca - 'A' + 'a');
            if (ca != *b) break;
            ++a;
            ++b;
        }
        if (!*b) return true;
    }
    return false;
}

inline bool rwt_is_water(const char* l) {
    return rwt_ci_contains(l, "inlet water") || rwt_ci_contains(l, "return water") ||
           rwt_ci_contains(l, "return temp") || rwt_ci_contains(l, "water heat exchanger inlet");
}

inline bool rwt_is_reject(const char* l) {
    return rwt_ci_contains(l, "raw data") || rwt_ci_contains(l, "o/u") ||
           rwt_ci_contains(l, "deicer") || rwt_ci_contains(l, "phase") ||
           rwt_ci_contains(l, "outdoor") || rwt_ci_contains(l, "brine");
}

// Tier 1: the PHE return water inlet (R4T), under any of its catalog label forms
// ("Inlet water temp.(R4T)", "Return Water Temp before PHE (R4T)", "[HPSU] Tr return Temp (R4T)").
inline bool rwt_is_r4t(const char* l) {
    return rwt_is_water(l) && !rwt_is_reject(l) && rwt_ci_contains(l, "r4t");
}

// Tier 2 fallback: any return/inlet water measurement that is not raw data, outdoor, or brine.
inline bool rwt_is_measurement(const char* l) { return rwt_is_water(l) && !rwt_is_reject(l); }

// Index of the label to use as return-water, or -1 if none qualifies.
inline int rwt_select(const char* const* labels, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (labels[i] && rwt_is_r4t(labels[i])) return static_cast<int>(i);
    for (size_t i = 0; i < n; ++i)
        if (labels[i] && rwt_is_measurement(labels[i])) return static_cast<int>(i);
    return -1;
}

} // namespace daik::logic
