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
// which is not a measurement of anything. Three shapes are adjudicated per ROW, and all of them
// require evidence — never a global rule:
//
//   ZeroMeansAbsent   raw 0x0000 behaves as "this field is not populated on this unit". A GLOBAL
//                     "0 °C means unavailable" rule is unsafe (a real thermistor crosses zero every
//                     winter), so the decision has to be per row and on record.
//   Unproven          the decode is faithful to the catalog and the result is still physically
//                     false. The row is withheld from every publish surface until the wire evidence
//                     settles the scale; the raw page dump (logic/raw_capture.hpp) is what preserves
//                     the evidence in the meantime.
//   AboveRangeIsAbsent  the row is a real measurement almost always, and occasionally carries a
//                     single fixed out-of-band integer that no position/count could be. Unlike the
//                     two above this is a VALUE test — but it cannot live in reading_plausible(),
//                     whose envelopes are keyed on the dataType (1 = °C, 2 = bar) and so cannot see
//                     a dataType -1 row at all. The only thing that identifies such a row is its
//                     (page, offset, converter) coordinate, which is exactly this ledger's key.
//
// A FOURTH verdict is not about a row at all — PAGE_ABSENCE_RULES below. When the reply to a whole
// REGISTER PAGE carries the signature of hardware that is not fitted, the finding is about the page,
// so it is keyed on the page and reaches every row on it. #297 first shipped this as one row-level
// entry per coordinate (the four 0xA1 rows), which restates one fact four times and leaves two gaps
// the 0xA0 page then walked into: a row that already carries a VALUE rule cannot also carry the page
// fact, and a row a future generator run adds to the page is covered by nothing at all.
//
// WHY A LEDGER IN logic/ AND NOT A FLAG IN def/ — the generated per-model tables are machine output
// (.claude/CLAUDE.md: never hand-edit one), and these verdicts are OURS, derived from live captures
// rather than from Daikin's catalog. Keeping them here means (a) the generator can be re-run without
// losing an adjudication, (b) each entry carries its evidence in the same place as the rule, and
// (c) the whole thing is IDF-free, so the CI logic test asserts the verdicts against the real
// catalog instead of anyone asserting them in prose.
//
// A rule is keyed on (page, offset, converter) — the row's structural identity. It is deliberately
// NOT scoped to a profile id: each verdict is about the wire structure at that coordinate —
// sometimes a single value, sometimes a whole-page presence signature — and the catalog test pins
// its complete cross-profile reach. A profile-id list would claim a per-model fact nobody
// established, and would go stale on the next generator run.
//
// That key is necessary but, for a ZERO verdict, not always SUFFICIENT — measured, not assumed. The
// catalog puts DIFFERENT PHYSICAL QUANTITIES at the same coordinate: 0x21/6 conv 105 is
// "Fan1 Fin temp." on 19 profiles and "Brine inlet temp." on two geothermal ones, 0x21/8 is a fan
// heatsink on 19 and "Brine outlet temp."/"Refrig. temp. evap. In" on four, 0x21/10 is the
// compressor outlet on 21 and "Refrig. temp. evap.Out" on two. Brine and evaporating refrigerant sit
// AT 0 °C in normal operation, so a coordinate-only zero rule would withhold those units' most
// load-bearing reading precisely when it matters. Hence the optional `label` component below. This
// is NOT the label matching lwt_select.hpp warns against — that is a PATTERN hunting for a quantity,
// which breaks on the next re-spelling; this is an exact discriminator among the spellings the
// catalog demonstrably carries, pinned in both directions by the catalog test, exactly as
// logic/label_override.hpp keys its `from`.
//
// ADDING A RULE IS AN ADJUDICATION, not a way to make an inconvenient number go away — the same
// contract tools/domain/audit_exceptions.txt states. It needs a live capture or a documented model
// fact, and it belongs in the same PR as the test that pins it.
#include <cstddef>
#include <cstdint>

#include "label_override.hpp"   // label_str_eq — the ledger's optional fourth key component
#include "value_def.hpp"

namespace daik {

// What the firmware is willing to claim about a row.
enum class AvailabilityPolicy : uint8_t {
    Always,             // the default for every row in the catalog: publish whatever decoded
    ZeroMeansAbsent,    // an exact decoded zero is an unpopulated field on THIS row, not a reading
    Unproven,           // the decode itself is not trusted here — publish nothing, keep the evidence
    AboveRangeIsAbsent, // a decoded value above this row's physical ceiling is not a reading
};

struct AvailabilityRule {
    uint8_t            reg;
    uint8_t            offset;
    int                conv;
    // OPTIONAL fourth key component: the generated label this rule is about, or nullptr for "every
    // spelling at this coordinate". It exists because (reg, offset, conv) is NOT always one
    // quantity — see the #224 block below, where 0x21/6 conv 105 is a fan-inverter heatsink on 19
    // profiles and a GEOTHERMAL BRINE INLET on two. This is not the label MATCHING lwt_select.hpp
    // warns about (a pattern hunting for a quantity, which goes wrong the moment the catalog
    // re-spells it); it is an exact discriminator among the spellings the catalog actually carries,
    // pinned in both directions by the catalog test — the same key logic/label_override.hpp uses,
    // for the same reason. It is compared against the RAW generated label, not the adjudicated one:
    // the verdict is about the row on the wire, so a future label override must not move it.
    const char*        label;
    AvailabilityPolicy policy;
    double             ceiling;  // AboveRangeIsAbsent only; ignored (and 0) for every other policy
    const char*        why;      // the evidence, on record beside the rule
};

// ── PAGE-LEVEL ABSENCE ────────────────────────────────────────────────────────────────────────────
// What a whole page reply looks like when the hardware behind it is not fitted. Keyed on the page,
// so it reaches every row on it — including one that already carries a value rule of its own, and
// one the generator has not emitted yet.
//
// Each signature is evaluated against the LIVE reply on every cycle, which is what makes a
// page-keyed rule safe across all 45 profiles where a static per-model claim would not be: an
// installation that HAS the hardware answers with something that does not match the signature, and
// every row on the page publishes untouched. The rules therefore fail OPEN — an ambiguous or short
// reply is not an absence — and each demands a reply long enough to reach its last witness byte.
enum class PageAbsence : uint8_t {
    AllBytesZero,     // not one byte of the reply is set, witness fields included
    UnidentifiedUnit, // the unit on this page does not report an MPU id, and asserts no output
};

struct PageAbsenceRule {
    uint8_t     reg;
    PageAbsence signature;
    size_t      min_len;  // a reply shorter than this proves nothing either way
    const char* why;      // the evidence, on record beside the rule
};

// Page 0xA1's last defined presence witness is the unit-family flag byte at offset 9. A shorter
// reply is incomplete evidence, never an absent-page signature.
inline constexpr size_t A1_PRESENCE_BYTES = 10;
// Page 0xA0 carries the O/U MPU id at offsets 10-11 and the two operation/flag words at 12-13, so a
// reply has to reach byte 13 before it can be read as an absence.
inline constexpr size_t A0_PRESENCE_BYTES = 14;
inline constexpr size_t A0_MPU_ID_OFFSET  = 10;  // two bytes
inline constexpr size_t A0_FLAGS_OFFSET   = 12;  // two bytes

inline constexpr PageAbsenceRule PAGE_ABSENCE_RULES[] = {
    // 0xA1 — the second-outdoor-unit water-HX page, not four independent primary-unit thermistors.
    // On the #209 reference installation the complete reply is 16 zero bytes, including the
    // unit-family setting flags at byte 9, through a real DHW compressor cycle. That complete-page
    // signature means no second outdoor unit is populated; publishing four 0 °C measurements from it
    // invents hardware. Deliberately NOT a per-row zero rule: an inlet, outlet or target may
    // legitimately cross 0 °C on a populated page, and every row here publishes again as soon as ANY
    // byte in the same reply proves the page live. #224 / #297.
    {0xA1, PageAbsence::AllBytesZero, A1_PRESENCE_BYTES,
     "#224: whole 0xA1 reply is zero, including the unit-family flags (second O/U absent)"},

    // 0xA0 — the same absent second outdoor unit, one page earlier, and it needed a different
    // witness because this reply is NOT all-zero: on the reference installation it reads
    //   [00 00 80 0c 00 00 00 00 00 00 ff ff 00 00 00 00]
    // and both non-zero fields are themselves absence markers. Bytes 10-11 are the O/U MPU id, and
    // 0xFFFF is what a bus position reads when no MPU answers from it; bytes 12-13 are the operation
    // words (52C output, 4-way valve, crank-case heater, the three solenoids, HPS/safeguard) and not
    // one bit of them has ever been set. Everything else is zero.
    //
    // The three analog rows behind that signature published exactly 0.0 °C for 316771 consecutive
    // samples over 60 days (suction, liquid pipe, compressor port), and the fourth is worse than a
    // zero: 0xA0/2 published 89.6-192.0 °C, seven distinct values in seven days and every one of
    // them an exact multiple of 12.8 °C — its raw low byte never leaves 0x00/0x80, which is not how a
    // thermistor read at 0.1 °C resolution behaves. reading_plausible() cannot refuse those: 192 °C
    // is inside its ±200 °C envelope. That is the #35-#39 shape, and it is what makes this page a
    // defect rather than a tidiness question.
    //
    // BOTH conditions are required, and the redundancy is the point: the id alone is the argument,
    // the silent flag words are the corroboration, and demanding both means anything ambiguous
    // publishes. The absence is read off THIS page's own bytes on every cycle — no claim is made
    // about which models fit a second outdoor unit, which is the claim #224 says nobody may make
    // from one installation.
    {0xA0, PageAbsence::UnidentifiedUnit, A0_PRESENCE_BYTES,
     "#224: 0xA0 reports no O/U MPU id (0xFFFF) and asserts no output — second O/U absent"},
};

inline constexpr size_t PAGE_ABSENCE_RULE_COUNT =
    sizeof(PAGE_ABSENCE_RULES) / sizeof(PAGE_ABSENCE_RULES[0]);

// The page-absence entry for a register page, or nullptr when none exists.
inline constexpr const PageAbsenceRule* page_absence_rule(uint8_t reg) {
    for (size_t i = 0; i < PAGE_ABSENCE_RULE_COUNT; i++) {
        if (PAGE_ABSENCE_RULES[i].reg == reg) return &PAGE_ABSENCE_RULES[i];
    }
    return nullptr;
}

// Does THIS reply carry the absence signature for its page? False whenever there is no rule, no
// payload, or a payload too short to reach the witness bytes — a caller without the current wire
// reply must never invent an absence verdict.
inline constexpr bool page_absent(uint8_t reg, const uint8_t* page, size_t page_len) {
    const PageAbsenceRule* r = page_absence_rule(reg);
    if (!r || !page || page_len < r->min_len) return false;
    switch (r->signature) {
        case PageAbsence::AllBytesZero:
            for (size_t i = 0; i < page_len; i++) {
                if (page[i] != 0) return false;
            }
            return true;
        case PageAbsence::UnidentifiedUnit:
            return page[A0_MPU_ID_OFFSET] == 0xFF && page[A0_MPU_ID_OFFSET + 1] == 0xFF &&
                   page[A0_FLAGS_OFFSET] == 0x00 && page[A0_FLAGS_OFFSET + 1] == 0x00;
    }
    return false;
}

// The ceiling for an electronic-expansion-valve PULSE POSITION (conv 151, see the rules below).
// Chosen to be impossible rather than tight: the widest position ever observed on the reference
// unit is 474 pulses over 30 days, so 2000 is roughly four times the full-open travel of the
// actuator and cannot clip a real position on a larger model — while the value it exists to refuse
// sits 33x above it. Fitting a bound to the observed maximum would be the mistake
// logic/conv_override.hpp names: a threshold picked to make a number look nicer is not evidence.
inline constexpr double EEV_PULSE_CEILING = 2000.0;
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
    {0x10, 8, 114, nullptr, AvailabilityPolicy::ZeroMeansAbsent, 0.0,
     "#209: raw 0x0000 through a full compressor cycle (one unit, two audits)"},

    // ── Page 0x21 inverter rows that are not populated on this unit (#224) ───────────────────────
    // MEASURED over 60 days of the reference unit's published series, and the measurement is
    // stronger than "it reads zero" because of WHICH samples it is made of. Page 0x21 stops being
    // refreshed while the outdoor unit rests (logic/ou_stale.hpp), so those rows are already
    // withheld at rest — every sample in the store is therefore a RUNNING sample. Over the last 7
    // days that is 1140 of them, and in each one:
    //
    //     INV fin temp.        (0x21/4, same page, same converter)   16.5 - 55.5 °C
    //     Discharge pipe temp. (0x20/4)                              28.5 - 101.0 °C
    //     R1T-Outdoor air temp.(0x20/0)                              17.5 - 25.0 °C
    //     Fan1 Fin temp. / Fan2 Fin temp. / Compressor outlet        EXACTLY 0.0 °C, all 1140
    //
    // That is the Target Cond. Temp. bar reached without a second installation: not "zero on one
    // unit", but zero SIMULTANEOUSLY with a proven-live page whose neighbouring heatsink is at
    // 55.5 °C and whose ambient never drops below 17.5 °C. A heatsink cannot be at exactly 0.00 °C
    // while the air around it is at 25 °C, and a compressor OUTLET cannot be at 0.00 °C while the
    // discharge pipe it feeds reads 101 °C. The fields are not populated.
    //
    // THE LABEL IS PART OF THE KEY HERE, and it is load-bearing rather than defensive: at all three
    // coordinates the catalog carries a geothermal row instead, whose real value sits AT the zero
    // this rule refuses (brine circulates near 0 °C; so does evaporating refrigerant). A
    // coordinate-only rule would take those units' most important reading away, permanently, at the
    // operating point that matters most. The catalog test pins both directions — every rule matches
    // its air-source label and no rule is ever reachable from a brine/evaporator one.
    //
    // RESIDUAL COST, stated rather than glossed: on an air-source model that DOES populate one of
    // these, a genuine reading of exactly 0.0 °C is withheld for as long as it holds. That is the
    // same trade Target Cond. Temp. already makes, and it is acceptable here for the same reason —
    // a heatsink or compressor-outlet temperature at exactly zero is a rare transit, not the
    // quantity's normal operating point. It is NOT acceptable for the 0x20 rows this issue also
    // lists (outdoor coil, suction pipe, liquid line), where 0 °C is where those sensors LIVE for
    // much of a heating season; those stay published and still need their own evidence.
    {0x21, 6, 105, "Fan1 Fin temp.", AvailabilityPolicy::ZeroMeansAbsent, 0.0,
     "#224: exactly 0.0 in 1140/1140 running samples while INV fin read 16.5-55.5 and ambient >=17.5"},
    {0x21, 8, 105, "Fan2 Fin temp.", AvailabilityPolicy::ZeroMeansAbsent, 0.0,
     "#224: same, and a 4-8 kW monobloc has one fan — there is no second fan inverter to measure"},
    {0x21, 10, 105, "Compressor outlet temperature", AvailabilityPolicy::ZeroMeansAbsent, 0.0,
     "#224: exactly 0.0 in 1140/1140 running samples while the discharge pipe it feeds read 101 °C"},

    // The four 0xA1 rows USED TO BE HERE, one ZeroPageMeansAbsent entry each. The verdict has not
    // changed — it moved to PAGE_ABSENCE_RULES above, where a fact about a page is stated once and
    // reaches every row on it. See the note at the top of this file for why the row-level shape did
    // not survive contact with 0xA0.

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
    {0x30, 3, 151, nullptr, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "30 d of published samples: range 0-474, then 6x exactly 0xFFF8 and nothing between"},
    {0x30, 5, 151, nullptr, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0x30, 7, 151, nullptr, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0x30, 9, 151, nullptr, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
    {0xA0, 8, 151, nullptr, AvailabilityPolicy::AboveRangeIsAbsent, EEV_PULSE_CEILING,
     "same actuator, same converter — conv 151 is EEV pulses and nothing else"},
};

inline constexpr size_t AVAILABILITY_RULE_COUNT =
    sizeof(AVAILABILITY_RULES) / sizeof(AVAILABILITY_RULES[0]);

// The ledger entry for one row, or nullptr when it says nothing about it.
inline constexpr const AvailabilityRule* availability_rule(const ValueDef& d) {
    for (size_t i = 0; i < AVAILABILITY_RULE_COUNT; i++) {
        const AvailabilityRule& r = AVAILABILITY_RULES[i];
        if (r.reg != d.reg || r.offset != d.offset || r.conv != d.conv) continue;
        // A rule with no label covers every spelling at the coordinate; one WITH a label covers
        // exactly that generated row, so a different quantity sharing the coordinate is untouched.
        if (r.label && !logic::label_str_eq(d.label, r.label)) continue;
        return &r;
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
// absence; a page rule requires a complete payload through its last witness byte.
//
// PAGE absence is decided FIRST, before the ledger is consulted at all: it is a verdict on the
// hardware behind the reply, so it holds whatever this particular row decoded to, whether that
// decoded to a number or to text, and whether or not the row also carries a rule of its own. The
// 0xA0 expansion valve is the row that needs that order — it carries the conv-151 pulse ceiling, and
// a lookup that stopped at the first matching rule would publish its 0 pulses as the position of a
// valve on a unit that is not fitted.
//
// Unproven is decided BEFORE the `ok` check — it is a verdict on the row, not on the number, so a
// quarantined row publishes nothing whatever it decoded to.
inline constexpr bool value_available(const ValueDef& d, bool ok, double value,
                                      const uint8_t* page = nullptr, size_t page_len = 0) {
    if (page_absent(d.reg, page, page_len)) return false;
    const AvailabilityRule* r = availability_rule(d);
    if (!r) return true;
    if (r->policy == AvailabilityPolicy::Unproven) return false;
    if (!ok) return true;
    if (r->policy == AvailabilityPolicy::ZeroMeansAbsent && value == 0.0) return false;
    if (r->policy == AvailabilityPolicy::AboveRangeIsAbsent && value > r->ceiling) return false;
    return true;
}

} // namespace daik
