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
constexpr bool sig_str_eq(const char* a, const char* b) {
    size_t i = 0;
    while (a[i] != '\0' && a[i] == b[i]) ++i;
    return a[i] == b[i];
}

constexpr bool sig_starts_with(const char* s, const char* prefix) {
    for (size_t i = 0; prefix[i] != '\0'; ++i) {
        if (s[i] != prefix[i]) return false;
    }
    return true;
}

inline constexpr bool is_detection_model(const char* id) {
    if (sig_str_eq(id, "generic") || sig_str_eq(id, "altherma3_r_erga")) return false;
    return sig_starts_with(id, "altherma"); // Altherma-only; drops minichiller_*
}

// Fill out[] (capacity `max`) with one Signature per Altherma detection model; returns the count.
inline constexpr int build_signatures(Signature* out, int max) {
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

struct SignatureTable {
    static constexpr size_t kCap = sizeof(profiles) / sizeof(profiles[0]);
    Signature               entries[kCap]{};
    int                     count = 0;
};

constexpr SignatureTable make_signature_table() {
    SignatureTable t{};
    t.count = build_signatures(t.entries, static_cast<int>(SignatureTable::kCap));
    return t;
}

inline constexpr SignatureTable kSignatureTable = make_signature_table();

// Compile-time signature table in .rodata (no .bss copy or static-init guard).
inline const Signature* signatures(int& count) {
    count = kSignatureTable.count;
    return kSignatureTable.entries;
}

} // namespace daik::def
