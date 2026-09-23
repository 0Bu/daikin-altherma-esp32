#pragma once
// WHICH DERIVED FEATURES MAY HONESTLY RUN on the detected model — the policy half of issue #69
// step 0.2 (spun off as #110 Part C): what UC5 ("silent protection retries" early warning) and, later,
// on-device inference do when the active profile does not carry the signals they are defined on.
//
// ── THE DECISION: DISABLE, NEVER DEGRADE ─────────────────────────────────────────────────────────
// A profile missing a required signal turns the feature OFF. It does not run on a reduced feature
// set, and it does not substitute a related row. Three reasons, in ascending order of how expensive
// getting it wrong is:
//
//  1. IT IS THE HOUSE RULE, ALREADY PAID FOR TWICE. When lwt_select() finds no leaving-water
//     MEASUREMENT the UI blanks ΔT / heat output / COP rather than falling back to the setpoint
//     (#121); when the outdoor unit stops refreshing its own pages the pills blank rather than
//     showing a dimmer register of half-valid numbers (logic/ou_stale.hpp, and v1.0.13's greyed
//     variant was reverted for exactly this). The drawing has ONE vocabulary for "no reading right
//     now". A reduced feature set is that rejected second register, wearing a new name.
//
//  2. A REDUCED MODEL IS A DIFFERENT MODEL. UC5's thresholds — and anything trained in #69 Phase 2 —
//     are fit on a feature vector. Dropping columns at decision time does not degrade gracefully; it
//     produces confident output from a distribution nothing was ever fit on. That is "pretending full
//     features" with extra steps, which is the one outcome #69 rules out by name.
//
//  3. THE MISSING SIGNAL IS USUALLY THE RUN-STATE ONE, which is what makes every other reading
//     interpretable. Retry counters without a compressor run-state cannot separate "retries while
//     running" from a counter frozen with its page.
//
// ── WHY THIS IS DECIDED FROM ROWS, NOT FROM `profile == "generic"` ───────────────────────────────
// #69 frames this as a `generic`-fallback problem, and `generic` IS the extreme case: measured on
// this catalog it carries no leaving-water measurement (only "LW setpoint (main)", which
// lwt_select() correctly rejects), no INV frequency, no expansion valve and no pressure row at all.
// But it is not the only case. Measured across the 43 generated profiles, SIXTEEN lack register page
// 0x30 and with it both "INV frequency (rps)" and the expansion-valve positions. An id check on
// "generic" would therefore have let inference run without a run-state input on more than a third of
// the DETECTED catalog — the same defect the check was written to prevent, on a profile nobody
// thought to look at. Coverage is a property of the row set, so it is read off the row set.
//
// Pure and host-tested for the usual reason: there is no firmware caller yet (#69 Phase 3 has not
// landed), and a policy that is only prose gets re-litigated at the call site. The test pins the
// measurements above against the whole catalog, so a generator run that adds or removes a page
// changes a CHECK rather than changing behaviour silently.
#include <cstddef>

#include "convert.hpp"
#include "lwt_select.hpp"
#include "profile_view.hpp"
#include "value_def.hpp"

namespace daik::logic {

// "INV frequency (rps)" — the compressor run-state input. Matcher kept byte-for-byte identical to
// www/js/schematic.js's `vNum(/inv frequency/i)` (see logic/ou_stale.hpp for why this row in particular has to
// stay trustworthy: it is what makes "Standby — not running" believable while the pills around it are
// held over). One rule, two languages, same tokens.
inline bool fg_is_run_state(const char* l) { return lwt_ci_contains(l, "inv frequency"); }

// "Expansion valve N (pls)" — the EEV positions (#69's UC1/UC2 feature list). Present only on the
// profiles that carry page 0x30.
inline bool fg_is_expansion_valve(const char* l) { return lwt_ci_contains(l, "expansion valve"); }

// Structural refrigerant-pressure identity, over the resolved VIEW.  A plain dataType-2 check is
// wrong because every detected hydronic profile also carries Water pressure in bar.  The converter's
// shared structural predicate owns the physical rule; this adapter supplies the same-register
// conv-405 saturation twin across all view spans without flattening them into a heap allocation.
inline bool fg_is_refrigerant_pressure(const ProfileView& v, size_t row) {
    if (row >= v.count()) return false;
    const ValueDef& d = v[row];
    bool has_saturation_twin = false;
    for (size_t i = 0; i < v.count(); i++) {
        const ValueDef& twin = v[i];
        if (!twin.no_publish && twin.conv == 405 && twin.reg == d.reg && twin.offset == d.offset) {
            has_saturation_twin = true;
            break;
        }
    }
    return is_refrigerant_pressure_structure(d, has_saturation_twin);
}

// What the active profile can actually supply. Each flag is evidence from the ROWS, never a guess
// from the model id.
struct FeatureCoverage {
    bool leaving_water        = false;  // an lwt_select-resolvable MEASUREMENT (never a setpoint)
    bool run_state            = false;  // "INV frequency (rps)"
    bool retry_counters       = false;  // conv 310 — UC5's core signal (def/overlay.hpp)
    bool expansion_valve      = false;  // "Expansion valve N (pls)"
    bool refrigerant_pressure = false;  // structurally identified refrigerant pressure, never water
};

// Takes the VIEW, not the raw profile: the retry counters live in the page-0x10 supplement
// (def/overlay.hpp), so coverage read off the generated table alone would report `retry_counters`
// false on every model — the gate would answer correctly for the wrong reason today and wrongly the
// moment the generator emits the rows.
inline FeatureCoverage feature_coverage(const ProfileView& v) {
    FeatureCoverage c;
    for (size_t i = 0; i < v.count(); i++) {
        const ValueDef& d = v[i];
        if (d.no_publish) continue;          // an absent-feature placeholder is not coverage
        // Tier-2 of the lwt_select rule, called rather than restated. A looser second copy of this
        // pattern is the documented way #121 re-opens; there must not be one.
        if (lwt_is_measurement(d.label))  c.leaving_water        = true;
        if (fg_is_run_state(d.label))     c.run_state            = true;
        if (fg_is_expansion_valve(d.label)) c.expansion_valve    = true;
        if (d.conv == 310)                c.retry_counters       = true;
        if (fg_is_refrigerant_pressure(v, i)) c.refrigerant_pressure = true;
    }
    return c;
}

// UC5 — "silent protection retries" early warning (#69's walking skeleton). Needs the counters and a
// compressor run-state to interpret them against; nothing else.
inline bool uc5_supported(const FeatureCoverage& c) {
    return c.retry_counters && c.run_state;
}

// The later inference use cases (UC1 leak/anomaly, UC2 heating curve) add the hydronic working point
// and the refrigerant-circuit signals. Strictly stronger than uc5_supported() — a build that can run
// a trained model can always run the rule.
inline bool inference_supported(const FeatureCoverage& c) {
    return uc5_supported(c) && c.leaving_water && c.expansion_valve && c.refrigerant_pressure;
}

} // namespace daik::logic
