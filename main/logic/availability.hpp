#pragma once
// AVAILABILITY — is this row's decoded number a MEASUREMENT, or is the firmware merely able to
// decode something from those bytes? The two are not the same question, and every defect in issue
// #209 that is not a type problem is this one.
//
// The gates that already exist answer narrower questions and cannot answer this one:
//
//   • convert.hpp decodes bytes. Converters 114/119 already drop the catalog's own `0x8000`
//     no-data marker, which is the ONLY absence the wire format itself expresses.
//   • reading_plausible() drops a decoded value outside the physical envelope (±200 °C, a
//     refrigerant pressure at 0 bar). It is a value test, so it can only catch a number that is
//     impossible — never one that is ordinary and still not a reading.
//   • ValueDef::no_publish marks a row the GENERATOR knows is an absent-feature placeholder on this
//     model (the 0x64 hybrid page on a non-hybrid unit). It lives in the generated table, so it can
//     only carry what the generator knew.
//
// What is left over is exactly the residue #209 measured on a live ERGA/EHB unit against a
// manufacturer-documented HomeHub reference: a field that decodes to an ordinary-looking number
// which is not a measurement of anything. Two shapes, both adjudicated per ROW and both requiring
// evidence — never a global rule:
//
//   ZeroMeansAbsent   raw 0x0000 behaves as "this field is not populated on this unit". A GLOBAL
//                     "0 °C means unavailable" rule is unsafe (a real thermistor crosses zero every
//                     winter), so the decision has to be per row and on record.
//   Unproven          the decode is faithful to the catalog and the result is still physically
//                     false. The row is withheld from every publish surface until the wire evidence
//                     settles the scale; the raw page dump (logic/raw_capture.hpp) is what preserves
//                     the evidence in the meantime.
//
// WHY A LEDGER IN logic/ AND NOT A FLAG IN def/ — the generated per-model tables are machine output
// (.claude/CLAUDE.md: never hand-edit one), and these verdicts are OURS, derived from live captures
// rather than from Daikin's catalog. Keeping them here means (a) the generator can be re-run without
// losing an adjudication, (b) each entry carries its evidence in the same place as the rule, and
// (c) the whole thing is IDF-free, so the CI logic test asserts the verdicts against the real
// catalog instead of anyone asserting them in prose.
//
// A rule is keyed on (page, offset, converter) — the row's structural identity, never its label,
// for the reason lwt_select.hpp states at length: an alias or a re-spelling would silently move the
// verdict onto a different quantity. It is deliberately NOT scoped to a profile id: the two rules
// below sit at byte-identical (reg, offset, conv) coordinates in all 43 generated tables, and each
// was measured on two INDEPENDENT unit families. A profile-id list would claim a per-model fact
// nobody established, and would go stale the moment the generator emits a 44th table.
//
// ADDING A RULE IS AN ADJUDICATION, not a way to make an inconvenient number go away — the same
// contract tools/domain/audit_exceptions.txt states. It needs a live capture or a documented model
// fact, and it belongs in the same PR as the test that pins it.
#include <cstddef>
#include <cstdint>

#include "value_def.hpp"

namespace daik {

// What the firmware is willing to claim about a row.
enum class AvailabilityPolicy : uint8_t {
    Always,           // the default for every row in the catalog: publish whatever decoded
    ZeroMeansAbsent,  // an exact decoded zero is an unpopulated field on THIS row, not a reading
    Unproven,         // the decode itself is not trusted here — publish nothing, keep the evidence
};

struct AvailabilityRule {
    uint8_t            reg;
    uint8_t            offset;
    int                conv;
    AvailabilityPolicy policy;
    const char*        why;      // the evidence, on record beside the rule
};

inline constexpr AvailabilityRule AVAILABILITY_RULES[] = {
    // Target Evap. Temp. (0x10/6) USED TO BE HERE, as Unproven — "withheld until the run-time wire
    // bytes decide it". They have. The row was never unproven in the sense of measuring nothing: it
    // was pointed at the wrong CONVERTER. conv 114 (×0.1) is why it read 145.9-199.6 °C mid-run;
    // decoded with conv 109 (÷128, already in logic/convert.hpp) the same wire integers read
    // 10.4-15.6 °C running and 17.2-19.0 °C at rest, and all 54 distinct integers ever observed
    // satisfy raw == floor(128 × T) on an exact 0.1 K grid. The verdict therefore moved to
    // logic/conv_override.hpp, which carries the evidence — a quarantine and a mis-decode are
    // different findings and must not be recorded as the same one, or the fix looks like a
    // suppression that was quietly lifted. #194.
    //
    // Target Cond. Temp. — raw 0x0000 all day: exactly one distinct value across a full audit window
    // while the inverter reached 32 rps and the discharge pipe passed 100 °C (#209), and "reads 0.0
    // even mid-run", which is why logic/ou_stale.hpp already records it as a useless witness. A
    // condensing TARGET of exactly 0 °C during a heat-up is not a target; the field is unpopulated.
    // The 0x8000 sentinel cannot see this, and it is the one row where an exact zero is adjudicated
    // absent. NOTE the evidence is ONE unit: #209's audit and #194's both ran against the same
    // board, which detection has always resolved to altherma_ebla_edla_d_series_4_8kw_monobloc (the
    // syslog detect line says so at every boot on record) — #213's "two unit families" read the
    // hardware identification in #209's scope section as if it were the running profile. The verdict
    // stands on the raw 0x0000 through full cycles; the second family does not exist yet.
    {0x10, 8, 114, AvailabilityPolicy::ZeroMeansAbsent,
     "#209: raw 0x0000 through a full compressor cycle (one unit, two audits)"},
};

inline constexpr size_t AVAILABILITY_RULE_COUNT =
    sizeof(AVAILABILITY_RULES) / sizeof(AVAILABILITY_RULES[0]);

// The adjudicated policy for one row, or Always when the ledger says nothing about it.
inline constexpr AvailabilityPolicy availability_policy(const ValueDef& d) {
    for (size_t i = 0; i < AVAILABILITY_RULE_COUNT; i++) {
        const AvailabilityRule& r = AVAILABILITY_RULES[i];
        if (r.reg == d.reg && r.offset == d.offset && r.conv == d.conv) return r.policy;
    }
    return AvailabilityPolicy::Always;
}

// May this ROW reach a publish surface at all? Composes the generated detect-only flag with the
// ledger's Unproven verdict, so hp_poll (which decides what to decode and cache) and mqtt_ha (which
// decides what to ANNOUNCE, and retracts the retained config of anything it no longer publishes)
// read one predicate and cannot disagree. An Unproven row still counts toward the profile's
// detection signature for the same reason no_publish does — the page is really there.
inline constexpr bool row_publishable(const ValueDef& d) {
    return !d.no_publish && availability_policy(d) != AvailabilityPolicy::Unproven;
}

// Does this DECODED value count as a measurement? Applied at publish time (hp_convert.cpp), beside
// reading_plausible() and for the same reason it is not folded into convert(): the converters must
// keep their INTRINSIC semantics so the domain audit can still tell conv 105 from conv 114.
//
// `ok` is Reading::ok — a text/enum row (ok=false, text set) has no number to judge and passes
// through. The zero test is an EXACT compare on purpose: conv 114's raw 0x0000 decodes to exactly
// 0.0, and widening it to a tolerance would start eating the real sub-0.1 °C readings the rule is
// explicitly not allowed to touch.
inline constexpr bool value_available(const ValueDef& d, bool ok, double value) {
    const AvailabilityPolicy p = availability_policy(d);
    if (p == AvailabilityPolicy::Unproven) return false;
    if (p == AvailabilityPolicy::ZeroMeansAbsent && ok && value == 0.0) return false;
    return true;
}

} // namespace daik
