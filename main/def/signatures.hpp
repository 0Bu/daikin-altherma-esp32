#pragma once
// Per-profile detection signatures, DERIVED from the embedded value profiles (registry.hpp) — no
// hand-maintained table, no generator change. Each signature is the set of register pages the
// profile references (its page_mask) plus the capacity class parsed from its id. hp_detect.cpp
// feeds these to daik::detect_candidates() together with the bus fingerprint. See logic/detect.hpp
// and docs/ARCHITECTURE.md ("Auto-detection").
#include "../logic/detect.hpp"
#include "registry.hpp"

namespace daik::def {

// Is this profile id a real Daikin Altherma model (a legitimate auto-detection candidate)? Detection
// is Altherma-only by product scope, so non-Altherma profiles (the `minichiller_*` commercial
// chillers) are excluded from the candidate pool — otherwise a 4-8 kW chiller, being register-similar
// on X10A, shows up as a false candidate for a 4-8 kW Altherma split. `generic` (the fallback) and
// `altherma3_r_erga` (the hand-written host-test fixture, a duplicate of the real ERGA-E profile) are
// likewise not detection candidates.
inline bool is_detection_model(const char* id) {
    if (std::strcmp(id, "generic") == 0 || std::strcmp(id, "altherma3_r_erga") == 0) return false;
    return std::strncmp(id, "altherma", 8) == 0;   // Altherma-only; drops minichiller_*
}

// Fill out[] (capacity `max`) with one Signature per Altherma detection model; returns the count.
inline int build_signatures(Signature* out, int max) {
    int n = 0;
    for (const auto& p : profiles) {
        if (!is_detection_model(p.id)) continue;
        if (n >= max) break;
        uint32_t mask = 0;
        for (size_t i = 0; i < p.count; i++) mask |= page_mask_bit(p.values[i].reg);
        int lo = -1, hi = -1;
        parse_kw_class(p.id, lo, hi);
        out[n] = Signature{p.id, mask, lo, hi};
        n++;
    }
    return n;
}

// Lazily-built shared signature array for device use (built once on first call).
inline const Signature* signatures(int& count) {
    static Signature s[sizeof(profiles) / sizeof(profiles[0])];
    static const int n = build_signatures(s, static_cast<int>(sizeof(s) / sizeof(s[0])));
    count = n;
    return s;
}

} // namespace daik::def
