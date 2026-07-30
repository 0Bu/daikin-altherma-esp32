#pragma once
// LABEL ADJUDICATION — the identity WORD a generated row is published under, when the label the
// generator emitted is demonstrably the wrong one.
//
// The sibling of logic/conv_override.hpp, and it exists for the same structural reason: the
// per-model tables in def/ are machine output (.claude/CLAUDE.md: never hand-edit one), the offline
// generator lives outside this repo, and a correction that lived in a generated table would be lost
// on the next generator run. So the verdict lives here, in logic/, IDF-free, keyed on the row's
// structural identity and carrying its evidence beside the rule — where the CI logic test can
// assert it against the real 45-profile catalog.
//
// It is separate from conv_override.hpp on purpose — the two answer different questions and apply to
// different fields of the same row:
//
//   conv_override.hpp   is the row being DECODED with the right converter?  (verdict: decode it
//                       differently, and then it IS the right value)
//   label_override.hpp  is the row published under the right IDENTITY word?  (verdict: publish it
//                       under a different label)
//
// A label is not cosmetic. ha_slug() turns it into the HA entity id AND the VictoriaMetrics series
// suffix (logic/discovery.hpp row_object_id/object_id), so the word inside it is a PUBLISHED CLAIM
// about the quantity — test_metric_identity() (#217) and test_tie_break_identity() (#230 B) both
// gate on it. That is also why a rename is a MIGRATION, not a free edit: it retires the old series
// and starts the new one at zero (mqtt_ha.cpp's retract_relabeled_values deletes the stale HA entity
// on upgrade; a VictoriaMetrics series cannot be carried across a rename by any firmware action).
//
// EVIDENTIARY BAR — the oracle here is docs/REGISTERS.md, exactly as it is for the domain audit's
// LABEL-UNIT check. A rule needs the spec (or an on-record catalog fact), never a spelling that
// merely reads nicer. This is a weaker claim than a conv_override — it changes the field's NAME, not
// its decoded value — but it is still a claim about the wire, so it is keyed the same way.
//
// ── The one entry: Fan 1 step (0x30/1, conv 211), "Fan 1 (10 rpm)" -> "Fan 1 (step)" ─────────────
//
// #230 A: page 0x30 offset 1 (conv 211) reads "Fan 1 (10 rpm)" on four profiles
// (altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw, altherma_hpsu6_ultra,
// altherma_lt_11_16kw_hydrosplit_hydro_unit, altherma_lt_da_pair_bml) and "Fan 1 (step)" on the
// other 22 — same converter, same width, same type code. docs/REGISTERS.md §5 (page 0x30) names it
// "Fan 1 (step)" and §3.3 defines conv 211 as a raw numeric byte (0 = stopped), i.e. a STEP INDEX,
// not a rate. Three of the four contradict themselves inside their own table, calling the
// neighbouring byte "Fan 2 (step)". So "(10 rpm)" asserts a rate for a field the spec defines as a
// step, and actuators_fan_1_10_rpm invites a reader to take a 30 for 300 rpm rather than step 30 —
// the #35-#39 shape (well-formed, spec-conformant byte layout, audit-clean under everything except
// the label) carried by an identifier. The fix belongs in gen_profiles.py; until it lands there,
// this override makes every unit publish the spec-correct actuators_fan_1_step.
//
// WHY NOT A NEW LABEL — "Fan 1 (step)" is not invented here; it is the spec's own name and the one
// the other 22 profiles already carry, so the four simply join them. The defect is the #35-#39
// shape exactly: a wrong identifier word on a right row.
//
// SCOPE — keyed on (reg, offset, conv) AND the wrong `from` label (like conv_override keys on the
// `from` converter), so it corrects EXACTLY the four wrong rows and is a no-op on the 22 that are
// already right. It is deliberately NOT keyed on a profile id: the row sits at byte-identical
// coordinates on every profile that carries it, and a per-id list would claim a per-model fact
// nobody established. The moment gen_profiles.py emits "Fan 1 (step)" the `from` label matches
// nothing, this becomes dead code, and test_label_override()'s raw-count pin (== 4 today) trips to
// force its deletion — the self-retiring guarantee conv_override.hpp's own count pin gives.
#include "value_def.hpp"

#include <cstddef>

namespace daik::logic {

// A constexpr C-string equality — the labels are string literals, so this is a compile-time compare.
inline constexpr bool label_str_eq(const char* a, const char* b) {
    while (*a && *a == *b) { ++a; ++b; }
    return *a == *b;
}

struct LabelOverride {
    uint8_t     reg;
    uint8_t     offset;
    int         conv;
    const char* from;   // the label the generated table carries
    const char* to;     // the label the row must be published under
    const char* why;    // evidence, in one line; the header block above carries the full argument
};

inline constexpr LabelOverride LABEL_OVERRIDES[] = {
    {0x30, 1, 211, "Fan 1 (10 rpm)", "Fan 1 (step)",
     "#230A: conv 211 is a step index (REGISTERS.md §3.3, 0=stopped); 22 profiles say (step), 4 a rate"},
};

inline constexpr size_t LABEL_OVERRIDE_COUNT = sizeof(LABEL_OVERRIDES) / sizeof(LABEL_OVERRIDES[0]);

// The label this row must be published under. Identity for every row the ledger is silent about,
// which is all but four rows of the catalog.
inline constexpr const char* effective_label(uint8_t reg, uint8_t offset, int conv, const char* label) {
    for (size_t i = 0; i < LABEL_OVERRIDE_COUNT; i++) {
        const LabelOverride& o = LABEL_OVERRIDES[i];
        if (o.reg == reg && o.offset == offset && o.conv == conv && label_str_eq(label, o.from))
            return o.to;
    }
    return label;
}

} // namespace daik::logic
