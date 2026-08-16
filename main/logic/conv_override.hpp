#pragma once
// CONVERTER ADJUDICATION — which converter a generated row is DECODED with, when the id the
// generator emitted is demonstrably the wrong one.
//
// This is the sibling of logic/availability.hpp and it exists for the same structural reason: the
// per-model tables in def/ are machine output (AGENTS.md → Build and deterministic gates: never
// hand-edit one), the offline
// generator lives outside this repo, and a correction that lived in a generated table would be lost
// on the next generator run. So the verdict lives here, in logic/, IDF-free, keyed on the row's
// structural identity and carrying its evidence beside the rule — where the CI logic test can
// assert it against the real 45-profile catalog.
//
// The two headers answer different questions and must not be merged:
//
//   availability.hpp   is this decoded number a MEASUREMENT at all?  (verdict: withhold it)
//   conv_override.hpp  is the row being decoded with the right CONVERTER?  (verdict: decode it
//                      differently, and then it IS a measurement)
//
// An entry here is a stronger claim than an availability verdict — it does not merely suppress a
// value, it asserts a different one — so the evidentiary bar is correspondingly higher: a rule needs
// evidence that is STRUCTURAL (a property of the wire integers themselves), not merely a physical
// range that looks nicer. Fitting a scale to make a number plausible is exactly how #35-#39 shipped.
//
// ── The one entry: Target Evap. Temp. (0x10/6), conv 114 -> conv 109 ─────────────────────────────
//
// #194 opened this as "conv 114 x0.1 publishes 145.9-199.6 °C mid-run — physically impossible, but
// spec-conformant and audit-clean", ruled out every non-scale explanation (converter id vs
// docs/REGISTERS.md §5, catalog drift, byte offset, endianness, width — see the issue's table), and
// stopped at TWO surviving scale hypotheses it could not separate: x0.01 and /128. It called for
// run-time wire bytes as the decisive experiment, and #213 built logic/raw_capture.hpp to get them.
//
// The wire integers turned out to be recoverable WITHOUT that capture, which is why this can be
// settled now: conv 114 publishes `raw * 0.1` and display_decimals(114) == 1, so the published
// string carries the 16-bit register EXACTLY — `raw = published * 10`, no information lost. #194
// assumed otherwise ("back-derived from a value already rounded to one decimal"); that assumption is
// what kept the issue open. Every value this row has ever published is therefore a wire sample.
//
// Combining the stored VictoriaMetrics series (run-time, 46 distinct integers) with the boot-time
// page dumps replayed to syslog (at rest, 8 distinct integers) gives 54 distinct wire integers:
//
//   run   1331 1344 1369 1382 1395 1408 1420 1433 1446 1459 1472 1484 1510 1536 1548 1561 1574
//         1587 1600 1612 1625 1651 1664 1689 1702 1728 1740 1753 1766 1779 1792 1804 1817 1830
//         1856 1868 1881 1894 1907 1920 1932 1945 1958 1971 1984 1996
//   rest  2201 2214 2240 2304 2342 2393 2406 2432
//
// ALL 54 satisfy `raw == floor(128 * T)` for T on an exact 0.1 K grid. That is the decisive fact,
// and it is structural rather than physical: the set {floor(12.8k)} has density 1/12.8 among the
// integers, so a row whose scale is anything else hits it with probability ~0.078 per sample —
// 54/54 is p ~ 1.6e-60. x0.01 (#194's preferred candidate, chosen because 24.06 °C at rest "looked
// like ambient") has no such structure: it reads 22.01, 22.14, 22.40, 23.04 … — arbitrary
// two-decimal numbers with no underlying grid.
//
// The physical reading that falls out is a textbook evaporating temperature, and the run values form
// a near-continuous 0.1 K sweep, which is what a real temperature does and what x0.1's 1.3 K steps
// conspicuously are not:
//
//                       conv 114 (x0.1)        conv 109 (/128)
//   compressor running   133.1 - 199.6 °C       10.4 - 15.6 °C
//   at rest              220.1 - 243.2 °C       17.2 - 19.0 °C
//
// WHY conv 109 AND NOT A NEW CONVERTER — 109 already exists in logic/convert.hpp as
// `read_s16(LE) / 256.0 * 2.0`, i.e. exactly /128, and display_decimals() already gives it one
// decimal. Nothing in the decode path is invented here; this row was simply pointed at 114. The
// defect is therefore the #35-#39 shape exactly — a wrong converter ID on a right register — and
// not, as #194 feared it might be, a wrong converter IMPLEMENTATION whose correction would move
// every conv-114 row in the catalog. conv 114 keeps its x0.1 semantics untouched.
//
// WHAT THIS DELIBERATELY DOES NOT TOUCH — the three other conv-114 "Target …" rows
// (Target Cond. Temp. 0x10/8, Target Discharge Temp. 0xA1/5, Target port temperature 0xA1/7). It is
// plausible that the generator mis-assigned all four together, but all three read raw 0x0000 on the
// only unit anyone has measured, and 0 decodes to 0.0 under BOTH scales — so there is no evidence
// for or against them, and "probably the same bug" is precisely the guess this project refuses.
// 0x10/8 is separately adjudicated ZeroMeansAbsent in availability.hpp on its own evidence.
//
// SCOPE — keyed on (reg, offset, conv) and NOT on a profile id, following availability.hpp: the row
// sits at byte-identical coordinates in 44 of the 45 generated tables and a per-id list would claim
// a per-model fact nobody established. The residual risk of a catalog-wide correction from one
// unit's data is bounded by what the CURRENT decode produces: x0.1 puts this register at
// 133 - 243 °C wherever it is populated, which is impossible on every model, so no model can be
// reading it correctly today. (That bound is the argument, and it is why the same reasoning does not
// license touching the three rows above, where the current decode yields a perfectly ordinary 0.0.)
#include "value_def.hpp"
#include "label_override.hpp"   // the sibling ledger adjudicated() also composes (the row's LABEL)

#include <cstddef>

namespace daik::logic {

struct ConvOverride {
    uint8_t reg;
    uint8_t offset;
    int     from;       // the converter id the generated table carries
    int     to;         // the converter id the row is actually encoded with
    const char* why;    // evidence, in one line; the header block above carries the full argument
};

inline constexpr ConvOverride CONV_OVERRIDES[] = {
    {0x10, 6, 114, 109,
     "#194: 54/54 distinct wire integers satisfy raw==floor(128*T) on a 0.1 K grid (p~1.6e-60)"},
};

inline constexpr size_t CONV_OVERRIDE_COUNT = sizeof(CONV_OVERRIDES) / sizeof(CONV_OVERRIDES[0]);

// The converter this row is actually encoded with. Identity for every row the ledger is silent
// about, which is all but one of the catalog.
inline constexpr int effective_conv(uint8_t reg, uint8_t offset, int conv) {
    for (size_t i = 0; i < CONV_OVERRIDE_COUNT; i++) {
        const ConvOverride& o = CONV_OVERRIDES[i];
        if (o.reg == reg && o.offset == offset && o.from == conv) return o.to;
    }
    return conv;
}

// The row as every consumer must see it — it COMPOSES the two row-rewriting ledgers: the converter
// (this file) and the label (logic/label_override.hpp). Returned BY VALUE and applied at each point
// a row enters the pipeline (decode, cache, HA discovery) rather than inside convert(), so that the
// converter keeps its intrinsic per-converter semantics and the domain audit still sees the
// generated table and this adjudication as two separate, separately-reviewable things. (Both keys
// read the ORIGINAL d.conv, so the two verdicts compose independently and order-free.)
// availability.hpp stays separate: it WITHHOLDS a value, it does not rewrite the row.
inline constexpr ValueDef adjudicated(const ValueDef& d) {
    ValueDef out = d;
    out.conv  = effective_conv(d.reg, d.offset, d.conv);
    out.label = effective_label(d.reg, d.offset, d.conv, d.label);
    return out;
}

} // namespace daik::logic
