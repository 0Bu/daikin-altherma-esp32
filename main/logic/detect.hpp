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
    int      iu_kw_tenths = -1;  // I/U capacity code (reg 0x60 off 6, same kW×10 units); -1 = unknown.
                                 // FALLBACK capacity when the O/U 0x00 descriptor is too short to
                                 // carry offset 12 (a smaller unit) -> kw_tenths stays -1. Used only
                                 // to RANK the representative (detect_best), never to exclude a
                                 // candidate, since indoor≈outdoor capacity is an approximation.
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

// The capacity the detect_* rules narrow and rank by: the O/U figure when the unit reported it,
// else the I/U capacity code as an approximate fallback. ONE accessor because detect_candidates
// (which set) and detect_best (which representative) must answer from the same number — they did
// not, and that is #225: the fallback ranked the pick while the SET ignored it, so /status reported
// 8 candidates across 4 families — including 14-16 kW models — on an 8 kW unit whose representative
// had long since been constrained to the 4-8 kW class. Narrowed, that live set is 5 across 3.
inline int detect_capacity(const Fingerprint& fp) {
    return (fp.kw_tenths >= 0) ? fp.kw_tenths : fp.iu_kw_tenths;
}

// Does this profile's kW class contain that capacity? False when either side is unknown, which is
// NOT the same as excluded: a class-less profile is never "matched" (detect_best ranks it below one
// that is), but neither does it contradict anything, so detect_candidates always keeps it.
inline bool signature_kw_contains(const Signature& sig, int cap) {
    return cap >= 0 && sig.kw_min_tenths >= 0 &&
           cap >= sig.kw_min_tenths && cap <= sig.kw_max_tenths;
}

// Narrow the profiles to the best-fitting candidates for a fingerprint. Consistent profiles are
// those whose pages are present and whose kW class contains the unit's capacity; among them we keep
// only the ones with MAXIMAL page overlap (largest page_mask), which drops feature-poor profiles
// that merely happen to be a subset of a feature-rich unit. Fills out[] with up to `max` candidate
// ids (in signature order) and returns the total candidate count (which may exceed `max`).
//
// Then a THIRD filter, for the case this function used to answer too broadly (#225): when the O/U
// capacity is unknown, signature_consistent applies no kW filter at all, so the set spans kW
// classes — and the header's own contract ("register-equivalent only when the capacity is known")
// is voided exactly there. The I/U capacity code is available in that state and detect_best already
// RANKS by it; here it EXCLUDES, under exactly the rule signature_consistent applies to the O/U
// figure: drop a candidate whose kW class exists and does NOT contain the capacity.
//
// The asymmetry is deliberate and is the whole correctness argument. A profile whose id carries no
// kW class at all is NOT dropped — nothing about it contradicts the capacity, and "some better-
// evidenced alternative exists" is a RANKING criterion, which has no business deciding membership.
// (Written the other way round — keep only candidates that positively match — this silently dropped
// `altherma_gshp2`, which has no class in its id, from a set where it belongs.) So the set answers
// "consistent with the unit" and detect_best alone answers "best fit".
//
// It cannot move the representative: detect_best prefers a capacity match above everything except
// page overlap, which this filter holds fixed, so every candidate it removes is one detect_best had
// already ranked below the survivors. Asserted catalog-wide in test_logic.cpp rather than left as
// an argument.
//
// The corroboration guard runs first, and matters in the other direction: the fallback is applied
// only when SOME surviving candidate's class contains it. An I/U code contained in no class at all
// (an unusual indoor/outdoor pairing, a misread byte) is not evidence about this unit, and acting on
// it would drop every classed candidate at once and leave only the class-less ones — a set that is
// not merely broad but wrong. Unfiltered is the safe failure here: an over-broad set displays
// honestly as uncertain, while a set narrowed onto the wrong models does not.
inline int detect_candidates(const Signature* sigs, int nsig, const Fingerprint& fp,
                             const char** out, int max) {
    int best_pop = -1;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        const int pop = __builtin_popcount(sigs[i].page_mask);
        if (pop > best_pop) best_pop = pop;
    }
    if (best_pop < 0) return 0;

    // Only ever narrows when the O/U capacity was ABSENT: with it known, signature_consistent has
    // already excluded every contradicting class, so this pass can find nothing left to remove.
    const int cap = detect_capacity(fp);
    bool corroborated = false;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        if (__builtin_popcount(sigs[i].page_mask) != best_pop) continue;
        if (signature_kw_contains(sigs[i], cap)) { corroborated = true; break; }
    }

    int n = 0;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        if (__builtin_popcount(sigs[i].page_mask) != best_pop) continue;
        // Excluded only by a class that CONTRADICTS; a class-less profile always survives.
        if (corroborated && sigs[i].kw_min_tenths >= 0 && !signature_kw_contains(sigs[i], cap))
            continue;
        if (n < max && out) out[n] = sigs[i].id;
        n++;
    }
    return n;
}

// Pick the single best-fit candidate id for READING, or nullptr if none is consistent. Ranking,
// best first: (1) most pages in common with the unit (maximal page_mask overlap — drops feature-poor
// profiles, so this never returns a profile outside detect_candidates()' set); (2) tightest kW class
// that still contains the capacity (a narrow rated class beats a broad one, and a classed profile
// beats a class-less one); (3) first in signature order, a stable deterministic tie-break — NOT
// registry order chosen blindly, which was the old candidates.front() bug that applied an EBLA
// monobloc to an ERGA split.
//
// NOTE: models that share a page_mask AND kW class are register-identical on X10A (they differ only
// by untestable flag bits / labels), so among them the tie-break is arbitrary — every such candidate
// reads the SAME values, so any is an equally-correct working profile. The exact marketing variant
// is not knowable from bus data; the caller surfaces the candidate set (and the O/U EEPROM code) for
// display instead of asserting one. See docs/ARCHITECTURE.md ("Auto-detection").
//
// When the O/U capacity is UNKNOWN (a short 0x00 descriptor -> kw_tenths<0) the candidate set spans
// DIFFERENT kW classes, so it is NOT register-identical and the representative choice does affect the
// values. Criterion (2) breaks that with the I/U capacity fallback: prefer a candidate whose kW class
// contains the derived capacity. This is scoped — when the O/U capacity IS known, signature_consistent
// has already filtered to matching classes, so every survivor scores match=1 and criterion (2) is a
// no-op; the fallback only ever moves the pick for units that don't report O/U capacity.
//
// detect_candidates now applies that SAME fallback as a filter (#225), through the same two helpers
// rather than a second copy of the arithmetic — so the reported set and this pick are constrained by
// one rule, and this function's answer is unchanged by that filter (see its comment).
inline const char* detect_best(const Signature* sigs, int nsig, const Fingerprint& fp) {
    const int cap = detect_capacity(fp);
    const char* best = nullptr;
    int best_pop = -1, best_match = -1, best_span = 0;
    for (int i = 0; i < nsig; i++) {
        if (!signature_consistent(sigs[i], fp)) continue;
        const int pop   = __builtin_popcount(sigs[i].page_mask);
        const int match = signature_kw_contains(sigs[i], cap) ? 1 : 0;
        const int span  = (sigs[i].kw_min_tenths >= 0)
                              ? (sigs[i].kw_max_tenths - sigs[i].kw_min_tenths) : 1000;
        // Rank, best first: (1) maximal page overlap, (2) kW class contains the known/derived
        // capacity, (3) tightest kW class, (4) signature order (stable deterministic tie-break).
        if (best == nullptr || pop > best_pop ||
            (pop == best_pop && match > best_match) ||
            (pop == best_pop && match == best_match && span < best_span)) {
            best = sigs[i].id; best_pop = pop; best_match = match; best_span = span;
        }
    }
    return best;
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

// ── Committing a fingerprint: when is "no candidate matched" real, and when is it a lost reply? ──
//
// signature_consistent() requires a profile's pages to be a SUBSET of the pages that answered, so a
// single page bit missing from the fingerprint can make EVERY profile inconsistent — and the caller
// then reads with `generic`, which carries 53 rows instead of ~99 and has no leaving-water
// measurement, no compressor speed and no pressures at all. Measured against the shipped signatures,
// that is the outcome for 8 of the 12 fingerprint pages (#214).
//
// The page probe already retries, so a page that is genuinely there almost never goes missing. What
// this rule adds is the second line: an empty candidate set is not acted on until a SEPARATE sweep
// says the same thing. A transient cannot survive two independent passes; a genuinely unrecognised
// unit says it twice and is then read with `generic`, which is the honest answer for it.
//
// Deliberately a COUNT and not a timer: the caller's sweep cadence backs off on a silent bus
// (logic/detect_backoff.hpp), so "two passes" stays two pieces of evidence at any cadence, while a
// wall-clock window would silently become one.
//
// Nothing here is persisted — the model stays RAM-only and re-derived every boot.
inline constexpr int DETECT_NO_MATCH_CONFIRMATIONS = 2;

// Should a sweep that matched no profile be committed as `generic`? `consecutive_no_match` counts
// sweeps that answered on the bus and matched nothing, INCLUDING the one being decided.
inline constexpr bool detect_commit_no_match(int consecutive_no_match) {
    return consecutive_no_match >= DETECT_NO_MATCH_CONFIRMATIONS;
}

} // namespace daik
