#pragma once
// Leaving-water MEASUREMENT selection — the row the web UI feeds into ΔT, the derived heat output
// ("pth = flow/60 * 4.186 * dt"), COP and the --flow-hot trend. Getting the wrong row here is not a
// cosmetic display bug: a setpoint or the post-BUH (R2T) sensor substituted for the pre-BUH (R1T)
// measurement makes all four derived numbers *plausibly* wrong (issue #121, the failure shape of
// #35-#39 — no numeric tell, just wrong).
//
// This header is the host-testable twin of www/js/schematic.js's pickLwtRow(): the SELECTION happens
// browser-side (there is no firmware caller), but the rule runs against the generated def/ profile
// LABELS, which are C++ — so mirroring it here lets the CI logic-test gate it against the whole
// catalog (every detectable profile must select a real pre-BUH measurement, never a setpoint /
// mixed-zone / post-BUH row). Keep the two in lockstep: both use lowercase substring matching (no
// regex) so the token lists below are byte-for-byte comparable across the languages.
//
//   water(l)   := l⊇"leaving water" | "outlet water" | "inflow"
//   reject(l)  := l⊇"setpoint" | "mixed" | "r2t" | "after buh" | "after buffer"
//   Tier 1 (pre-BUH R1T outlet): water(l) && !reject(l) && l⊇"r1t"
//   Tier 2 (any leaving-water measurement, #121 fallback): water(l) && !reject(l)
//   select := first Tier-1 index, else first Tier-2 index, else -1 (blank — better than wrong)
//
// Why Tier 1 keys on the "(r1t)" tag rather than a keyword: the pre-BUH sensor wears four unrelated
// label forms across the catalog — "...before BUH (R1T)", "...after PHE (R1T)" (fixture), "Outlet
// Water Heat Exch. Temp. (R1T)" (HPSU/hybrid) and "[HPSU] Tv inflow Temp (R1T)" (ECH2O) — but all
// four carry (R1T), while the R2T twin ("after BUH", "BUH Temp.", "after Buffer/BUH") and the
// setpoint never do. A bare "heat exch" keyword is unusable: it also matches the outdoor/refrigerant
// rows ("O/U Heat Exch. Temp.(R4T)", "Outdoor heat exchanger temp.") and the DLWB2 hydro-split
// outlet — none of which is the leaving-water measurement. "mixed" is rejected so the EKMIK bizone
// mixed-zone R1T never wins over the main circuit's before-BUH R1T.
#include <cstddef>

namespace daik::logic {

// Case-insensitive substring test (ASCII-fold; labels are English ASCII). needle must be lowercase.
inline bool lwt_ci_contains(const char* hay, const char* needle) {
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

inline bool lwt_is_water(const char* l) {
    return lwt_ci_contains(l, "leaving water") ||
           lwt_ci_contains(l, "outlet water") ||
           lwt_ci_contains(l, "inflow");
}

inline bool lwt_is_reject(const char* l) {
    return lwt_ci_contains(l, "setpoint") ||
           lwt_ci_contains(l, "mixed") ||
           lwt_ci_contains(l, "r2t") ||
           lwt_ci_contains(l, "after buh") ||
           lwt_ci_contains(l, "after buffer");
}

// Tier 1: the pre-BUH heat-exchanger outlet (R1T), under any of its label forms.
inline bool lwt_is_pre_buh(const char* l) {
    return lwt_is_water(l) && !lwt_is_reject(l) && lwt_ci_contains(l, "r1t");
}

// Tier 2 (#121 fallback): any leaving-water measurement that is not a setpoint / mixed / post-BUH.
inline bool lwt_is_measurement(const char* l) {
    return lwt_is_water(l) && !lwt_is_reject(l);
}

// Index of the label to use as leaving-water, or -1 if none qualifies (UI then shows "—" for
// ΔT/heat/COP — the safe outcome; a setpoint would be worse than a blank).
inline int lwt_select(const char* const* labels, size_t n) {
    for (size_t i = 0; i < n; ++i)
        if (labels[i] && lwt_is_pre_buh(labels[i])) return static_cast<int>(i);
    for (size_t i = 0; i < n; ++i)
        if (labels[i] && lwt_is_measurement(labels[i])) return static_cast<int>(i);
    return -1;
}

} // namespace daik::logic
