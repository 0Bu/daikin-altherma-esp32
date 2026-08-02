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
//   ZeroPageMeansAbsent every byte in the returned page is zero, including fields that are not the
//                     row being decoded. This is a page-level absent-feature signature; an
//                     individual zero still publishes when any other byte proves the page live.
//   AboveRangeIsAbsent  the row is a real measurement almost always, and occasionally carries a
//                     single fixed out-of-band integer that no position/count could be. Unlike the
//                     two above this is a VALUE test — but it cannot live in reading_plausible(),
//                     whose envelopes are keyed on the dataType (1 = °C, 2 = bar) and so cannot see
//                     a dataType -1 row at all. The only thing that identifies such a row is its
//                     (page, offset, converter) coordinate, which is exactly this ledger's key.
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
// verdict onto a different quantity. It is deliberately NOT scoped to a profile id: each verdict is
// about the wire structure at that coordinate — sometimes a single value, sometimes a whole-page
// presence signature — and the catalog test pins its complete cross-profile reach. A profile-id list
// would claim a per-model fact nobody established, and would go stale on the next generator run.
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
    Always,             // the default for every row in the catalog: publish whatever decoded
    ZeroMeansAbsent,    // an exact decoded zero is an unpopulated field on THIS row, not a reading
    ZeroPageMeansAbsent,// the entire page payload is the absent-feature signature, not measurements
    Unproven,           // the decode itself is not trusted here — publish nothing, keep the evidence
    AboveRangeIsAbsent, // a decoded value above this row's physical ceiling is not a reading
};

struct AvailabilityRule {
    uint8_t            reg;
    uint8_t            offset;
    int                conv;
    AvailabilityPolicy policy;
    double             ceiling;  // AboveRangeIsAbsent only; ignored (and 0) for every other policy
    const char*        why;      // the evidence, on record beside the rule
};

// The ceiling for an electronic-expansion-valve PULSE POSITION (conv 151, see the rules below).
// Chosen to be impossible rather than tight: the widest position ever observed on the reference
// unit is 474 pulses over 30 days, so 2000 is roughly four times the full-open travel of the
// actuator and cannot clip a real position on a larger model — while the value it exists to refuse
// sits 33x above it. Fitting a bound to the observed maximum would be the mistake
// logic/conv_override.hpp names: a threshold picked to make a number look nicer is not evidence.
inline constexpr double EEV_PULSE_CEILING = 2000.0;
// Page 0xA1's last defined presence witness is the unit-family flag byte at offset 9. A shorter
// reply is incomplete evidence, never an absent-page signature.
inline constexpr size_t A1_PRESENCE_BYTES = 10;

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
    {0x10, 8, 114, AvailabilityPolicy::ZeroMeansAbsent, 0.0,
     "#209: raw 0x0000 through a full compressor cycle (one unit, two audits)"},

    // Page 0xA1 is the second-outdoor-unit water-HX page, not four independent primary-unit
    // thermistors. On the #209 reference installation its reply is 16 zero bytes, including the
    // unit-family setting flags at byte 9, through a real DHW compressor cycle. That complete-page
    // signature means no second outdoor unit is populated; publishing four 0 °C measurements from
    // it invents hardware. This is deliberately NOT ZeroMeansAbsent: an inlet, outlet or target may
    // legitimately cross 0 °C on a populated page, and it remains publishable as soon as ANY byte
    // in that same reply proves the page live. #224 (the tractable page-level subset of defect 6).
    {0xA1, 0, 119, AvailabilityPolicy::ZeroPageMeansAbsent, 0.0,
     "#224: whole 0xA1 reply is zero, including unit-family flags (second O/U absent)"},
    {0xA1, 2, 119, AvailabilityPolicy::ZeroPageMeansAbsent, 0.0,
     "#224: whole 0xA1 reply is zero, including unit-family flags (second O/U absent)"},
    {0xA1, 5, 114, AvailabilityPolicy::ZeroPageMeansAbsent, 0.0,
     "#224: whole 0xA1 reply is zero, including unit-family flags (second O/U absent)"},
    {0xA1, 7, 114, AvailabilityPolicy::ZeroPageMeansAbsent, 0.0,
     "#224: whole 0xA1 reply is zero, including unit-family flags (second O/U absent)"},

    // ── Expansion valve pulse positions (conv 151) — raw 0xFFF8 is not a position ─────────────────
    // MEASURED on the reference unit's published series (VictoriaMetrics, 30 days, 30 s samples of
    // "Expansion valve 1 (pls)" = 0x30/3): the working range is 0-474 pulses, and then SIX samples
    // of exactly 65528. Nothing whatever lies in between — not one sample in (500, 60000) in the
    // whole window — so this is a discrete out-of-band integer, not the tail of a distribution.
    //
    // 65528 is 0xFFF8: 65528 read unsigned, -8 read signed. THE SIGNED READING IS REFUTED, which
    // matters because "conv 151 should have been signed" is the obvious first diagnosis and it is
    // wrong twice over. (a) A valve driven briefly past its mechanical zero would report a SPREAD of
    // small negatives (0xFFFF, 0xFFFE, …) and would be reached from positions near 0; all six
    // occurrences are the identical integer and each sits between neighbouring samples of ~450, and
    // no valve travels 450 -> -8 -> 450 inside 30 s. (b) conv 151 is documented as u16 (REGISTERS.md
    // §3.1) and the firmware implements it that way, so re-reading it signed would change every one
    // of the catalog's 113 conv-151 rows on the strength of a number that is not a position under
    // EITHER reading. Withholding the value is the one answer both readings agree on.
    //
    // WHY NOT IN convert(): folding an envelope into a converter blinds the domain audit's
    // converters_equivalent(), the exact gate that catches a wrong converter id (tools/domain,
    // and the note in reading_plausible() spells this out). WHY NOT IN reading_plausible(): these
    // rows are dataType -1, so neither of its envelopes (°C, bar) can reach them, and the only other
    // handle is the "(pls)" in the label — the one thing this project does not key on.
    //
    // ALL FIVE COORDINATES, not just the one with the capture. conv 151 has exactly one use in the
    // whole catalog — 113 rows, every one an expansion-valve pulse position, at these five (page,
    // offset) pairs — so the ceiling is a fact about the ACTUATOR, not about the row that happened
    // to be observed. Covering only 0x30/3 would let the identical wire value publish as a real
    // position on valve 2 of the same unit. The catalog test pins that reach.
    {0x30, 3, 151, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "30 d of published samples: range 0-474, then 6x exactly 0xFFF8 and nothing between"},
    {0x30, 5, 151, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0x30, 7, 151, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0x30, 9, 151, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0xA0, 8, 151, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
};

inline constexpr size_t AVAILABILITY_RULE_COUNT =
    sizeof(AVAILABILITY_RULES) / sizeof(AVAILABILITY_RULES[0]);

// The ledger entry for one row, or nullptr when it says nothing about it.
inline constexpr const AvailabilityRule* availability_rule(const ValueDef& d) {
    for (size_t i = 0; i < AVAILABILITY_RULE_COUNT; i++) {
        const AvailabilityRule& r = AVAILABILITY_RULES[i];
        if (r.reg == d.reg && r.offset == d.offset && r.conv == d.conv) return &r;
    }
    return nullptr;
}

// The adjudicated policy for one row, or Always when the ledger says nothing about it.
inline constexpr AvailabilityPolicy availability_policy(const ValueDef& d) {
    const AvailabilityRule* r = availability_rule(d);
    return r ? r->policy : AvailabilityPolicy::Always;
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
// explicitly not allowed to touch. The ceiling test is one-sided for the same reason it is generous:
// it refuses an impossible integer, it does not police the quantity's working range.
// `page`/`page_len` are optional so callers without the current wire reply never invent a page-level
// absence. ZeroPageMeansAbsent requires a complete payload through its last presence witness.
//
// Unproven is decided BEFORE the `ok` check — it is a verdict on the row, not on the number, so a
// quarantined row publishes nothing whatever it decoded to.
inline constexpr bool value_available(const ValueDef& d, bool ok, double value,
                                      const uint8_t* page = nullptr, size_t page_len = 0) {
    const AvailabilityRule* r = availability_rule(d);
    if (!r) return true;
    if (r->policy == AvailabilityPolicy::Unproven) return false;
    if (!ok) return true;
    if (r->policy == AvailabilityPolicy::ZeroMeansAbsent && value == 0.0) return false;
    if (r->policy == AvailabilityPolicy::ZeroPageMeansAbsent && page &&
        page_len >= A1_PRESENCE_BYTES) {
        bool all_zero = true;
        for (size_t i = 0; i < page_len; i++) {
            if (page[i] != 0) {
                all_zero = false;
                break;
            }
        }
        if (all_zero) return false;
    }
    if (r->policy == AvailabilityPolicy::AboveRangeIsAbsent && value > r->ceiling) return false;
    return true;
}

} // namespace daik
