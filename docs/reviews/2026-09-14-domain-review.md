# Domain review — 14 September 2026

A `$domain-review` pass over source revision [`6c2c923529f5`][source] (`main`; the reviewed branch is
byte-identical to `origin/main`). The subject is **physical correctness**, not code structure: are
the derivations, conversion constants, thresholds and stated units right, and do the firmware, the
browser and the documentation say the same thing about them?

The review is read-only with respect to firmware, tooling and workflows. It records findings and
proposed corrections; it implements none of them. The only files this review adds are this document
and its index entry.

## Method

Two things distinguish this pass from the existing mechanical gate. `tools/domain/catalog_audit.cpp`
compares the shipped catalog against `docs/REGISTERS.md` — it proves rows are decoded the way the
spec says. It cannot see whether the *spec's own* physics is right, and it never evaluates a derived
figure (saturation temperature, thermal power, COP). Those were checked here against external
reference data instead:

* Refrigerant saturation curves: every `press2temp` polynomial was evaluated against the
  Tillner-Roth/Yokozeki (R32), Lemmon (R410A) and Kamei (R22) equations of state through CoolProp
  6.x, over the full published operating range and under all four plausible input-unit conventions.
* Water and glycol properties: ASHRAE-based incompressible mixture data (CoolProp `INCOMP::MPG` /
  `INCOMP::MEG`) at heating-circuit temperatures.
* Sensor decoders: line-by-line against the SHT30 and QMP6988 datasheets.
* Everything else: firmware ↔ browser ↔ documentation cross-reading.

Baseline at the reviewed revision: `scripts/run-domain-audit.sh` clean (45 profiles, 4,292 rows),
`scripts/run-diagnostic-evidence-audit.sh` clean (8 diagnoses), `scripts/run-mock-tests.sh` green
(`logic_tests` passed, 26/26 Node subtests).

## Summary

The plant-facing *reasoning* is the strongest part of this project and nothing below contradicts it:
the COP boundary rule, the outdoor-unit hold-over rule, the checkup's evidence gates, the refrigerant
service observer and the heating-curve sampler are all physically sound and honestly bounded. The
findings are concentrated in the **numeric layer underneath** them — the unit convention of the
refrigerant pressure input, the valid range of two of the three saturation polynomials, and three
constants in the heat-meter documentation.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| D1 | P1 | `press2temp()` is fitted in **kgf/cm² gauge**, while `convert.hpp` asserts the input is absolute pressure; the measurement cited as proof is circular | Residual analysis of all three curves vs. EOS data, four unit hypotheses |
| D2 | P1 | The R410A polynomial turns over at 40.3 kgf/cm²G — *below* the usual high-pressure switch setting — and the falling branch publishes plausible wrong saturation temperatures | Polynomial evaluation vs. EOS; plausibility-envelope trace; 15 shipped profiles |
| D3 | P2 | Converter ids 804/805 (R407C/R134a) fall back to the R32 curve, a 13–36 K silent error, contradicting `feature_gate.hpp`'s "disable, never degrade" | `convert.hpp` `profile_refrigerant`; EOS comparison |
| D4 | P2 | The raw pressure is kgf/cm² gauge but is published as `bar`; `REGISTERS.md` names the 0.981 factor and no code applies it | `convert.hpp` `unit_for_datatype`, `REGISTERS.md` §3.1, `checkup.hpp` pressure bound |
| D5 | P2 | `HOME_ASSISTANT.md`'s `Cf` table has the two glycols the wrong way round and both values too low | ASHRAE mixture data at 30–40 °C |
| D6 | P2 | `convert.hpp:99` states the converter-id endianness parity rule backwards, contradicting both the code below it and `REGISTERS.md` | Source comparison |
| D7 | P3 | The heat-meter constant assumes ρ = 1.000 kg/l and cp = 4.186 kJ/kg·K, a systematic +0.8 % on every `pth` and COP | Water properties at 30–40 °C |
| D8 | P3 | The history chart's `pth` series has no compressor/flow gate, while the live pill refuses exactly that case | `history.js` vs. `schematic.js` |
| D9 | P3 | The saturation witness is documented as running 0.9 K *below* leaving water, which a condenser cannot do | `availability.hpp` measurement note |
| D10 | P3 | `cop_plan`'s backup-heater "known" collapse is an OR where the domain rule wants an AND | `cop_scope.hpp`, `presenter_golden_dump.cpp` |

Priorities express corrective urgency. P1 means a published value can be physically wrong on shipped
hardware; P2 means a stated fact is wrong or a value carries a wrong unit; P3 is an accuracy or
consistency observation.

---

## D1 — `press2temp()` takes gauge pressure in kgf/cm², not absolute bar

[`main/logic/convert.hpp:308`][convert] justifies dropping a non-positive refrigerant pressure like
this:

> These are ABSOLUTE pressures (measured: 15.3 bar at a 22.1 °C saturation temperature, matching
> R32's saturation curve), and a sealed refrigerant circuit is never at absolute vacuum

Both halves of that sentence are wrong, and the second one is the reason the first survived.

**The curves are gauge fits.** All three polynomials return the refrigerant's normal boiling point
at an input of zero — R32 `−51.18` (true `−51.65`), R410A `−53.29` (true `−51.40`), R22 `−42.33`
(true `−40.81`). A correlation fitted on absolute pressure cannot behave that way at zero; one
fitted on gauge pressure must.

Testing all four conventions over each refrigerant's normal operating band settles which gauge unit
it is. Residual against the equation of state, in kelvin:

| Curve | Input band | bar absolute | bar gauge | kgf/cm² absolute | **kgf/cm² gauge** |
| --- | --- | --- | --- | --- | --- |
| R32 | 3–40 | 2.45 RMS / +1.62 bias | 1.04 / −0.72 | 2.94 / +2.37 | **0.70 / −0.01** |
| R410A | 3–38 | 2.61 / +1.68 | 1.25 / −0.75 | 3.09 / +2.43 | **0.97 / −0.04** |
| R22 | 2–26 | 3.71 / +2.82 | 1.05 / −0.73 | 4.25 / +3.58 | **0.70 / −0.02** |

A residual mean of −0.01, −0.04 and −0.02 K across three independently fitted curves is the
signature of a least-squares fit meeting its own input unit. Every other column carries a systematic
bias. This also agrees with the wire documentation the project already has:
[`docs/REGISTERS.md` §3.1][registers] states "pressures are **kgf/cm²** at the wire" and Daikin
service data is published in kgf/cm²**G**.

**The cited measurement is circular.** The `22.1 °C` in that comment is a conv-405 row, i.e. it *is*
`press2temp(15.3)` — the firmware's own output, not an independent instrument. It cannot confirm the
polynomial's input convention. Evaluated against real R32 data the pair discriminates nothing:

| Reading of the raw `15.3` | True R32 saturation | `press2temp(15.3)` = 22.06 °C |
| --- | --- | --- |
| 15.3 kgf/cm² gauge → 16.02 bar abs | 23.02 °C | −0.96 K |
| 15.3 bar absolute | 21.34 °C | +0.72 K |

**What is and is not affected.** The decode itself is *correct as it stands* — the raw value is
gauge kgf/cm² and the polynomial expects gauge kgf/cm², so published saturation temperatures are
within about 1 K across the operating range. Nothing needs recomputing. What needs fixing is the
recorded reason, because the wrong reason is what will mislead the next change: a future maintainer
reading "these are absolute pressures" has every incentive to "correct" the polynomial input by
adding an atmosphere, which would introduce the 5–7 K low-side error the table above shows.

The `bar <= 0` guard itself stands either way: 0 bar gauge inside a sealed circuit means 1 atm and
a −51 °C saturation temperature, which is no more possible than absolute vacuum. Only its stated
justification changes.

**Proposed correction.** Replace the absolute-pressure claim with the gauge/kgf statement and the
non-circular evidence (`f(0)` = normal boiling point), and note the input unit in the `press2temp`
header comment so the convention travels with the function.

## D2 — The R410A curve turns over below the high-pressure switch

Each polynomial is a sixth-order fit valid only inside the band it was fitted over. Outside it the
leading term dominates and the function falls:

| Curve | Monotonic to | Peak | First raw value whose output leaves the ±plausibility envelope |
| --- | --- | --- | --- |
| R32 | 47.38 kgf/cm²G | 68.98 °C | — (safe across the whole operating range) |
| **R410A** | **40.33 kgf/cm²G** | 63.50 °C | 49.36 |
| R22 | 28.75 kgf/cm²G | 68.94 °C | 35.72 |

The R410A number is the problem: Daikin's high-pressure protection on R410A machines sits at about
**41.5 kgf/cm²G (4.15 MPa)**, i.e. the entire approach-to-trip band is already on the falling branch.
`reading_plausible()` keys the °C envelope on `[-60, 200]`, so a 9.0-wide band of raw values decodes
to a wrong temperature that is *inside* the envelope and publishes normally:

| raw (kgf/cm²G) | published | true R410A saturation | error |
| --- | --- | --- | --- |
| 41.5 | 62.64 °C | 63.81 °C | −1.2 K |
| 43.0 | 58.19 °C | 65.42 °C | −7.2 K |
| 45.0 | 43.01 °C | 67.49 °C | −24.5 K |
| 48.0 | −13.65 °C | 70.45 °C | −84.1 K |

This is precisely the #35–#39 shape the project describes elsewhere: well-formed, plausible-looking
and physically false — and it appears at the one moment a reader is most likely to be looking, a
high-pressure event. **15 of the 45 shipped profiles declare conv 801 (R410A) and carry conv-405
rows**, so the path is live, not theoretical. R22 has the same defect from 28.75 upward but no
shipped profile declares conv 803, so it is latent.

**Proposed correction.** Give each curve an explicit validity ceiling (the measured turnover, minus
margin) and return `r.ok = false` above it, the same way `case 405` already refuses `bar <= 0`. That
keeps the existing "drop rather than publish a placeholder" contract instead of adding a second,
weaker one. A monotonicity assertion over each curve's declared band belongs in
`test/test_logic.cpp` so the property is structural rather than a fact about today's coefficients.

## D3 — R407C and R134a silently decode on the R32 curve

`profile_refrigerant()` returns the declared id, and `press2temp()` maps 804/805 onto the R32 branch.
The header states this plainly ("804/805 have no dedicated curve and fall back to R32") but not what
it costs:

| raw (kgf/cm²G) | R32 curve (published) | true R134a | true R407C (dew) |
| --- | --- | --- | --- |
| 5 | −8.53 °C | 21.11 °C | 4.31 °C |
| 10 | 9.33 °C | 42.34 °C | 24.28 °C |
| 20 | 32.53 °C | 68.85 °C | 49.21 °C |

A 26–36 K error for R134a and 13–16 K for R407C, published as an ordinary temperature. No shipped
profile declares 804 or 805 today, so this is latent — but the fallback is exactly the behaviour
[`logic/feature_gate.hpp`][gate] forbids ("DISABLE, NEVER DEGRADE"), and it is the branch a future
catalog regeneration would silently activate.

**Proposed correction.** Make 804/805 a no-value outcome for conv 405 (drop the row) rather than a
substitution, and add the catalog assertion that no profile declares a refrigerant without a curve
while carrying a 405 row.

## D4 — kgf/cm² is published as bar

`unit_for_datatype(2)` returns `"bar"` and `device_class_for_datatype(2)` returns `"pressure"`, while
the decoded number is `raw × 0.1` in **kgf/cm²** — `REGISTERS.md` §3.1 says so, and names the factor
("0.981 → bar"), but no code path applies it. Every published pressure is therefore about **2.0 %
high**, and its reference (gauge) is stated nowhere on the published surface.

The one place this reaches a threshold is the water-pressure check: `CHECKUP_BAR_WARN_TENTHS = 10`
is documented against the installer guide's ">1 bar" requirement, but compares against 1.0 kgf/cm²
= **0.98 bar**, so a plant sitting between 0.98 and 1.00 bar is below the manual's limit and not
flagged. The magnitude is small; the mismatch between the documented boundary and the compared one
is the part worth closing.

**Proposed correction.** Either apply 0.980665 at the converter and keep the `bar` label, or keep
the raw scale and publish `kgf/cm²` as the unit. The first is preferable — Home Assistant users
compare these against manifold gauges in bar — and it makes the checkup bound mean what
`DIAGNOSTIC_EVIDENCE.md` says it means. Whichever is chosen, `REGISTERS.md`'s
"`raw × 0.1` (kgf/cm² ≈ bar)" should stop hiding the difference behind `≈`.

## D5 — The glycol constants in the heat-meter recipe are swapped

[`docs/HOME_ASSISTANT.md`][ha] §1 gives `Cf = ρ·cp/60`:

| Loop fluid | Documented | Measured (ASHRAE mixture data, 35 °C) | Error |
| --- | --- | --- | --- |
| Pure water | 0.070 | 0.0692 | +1.2 % |
| ~30 % propylene glycol | **0.063** | **0.0660** | −4.5 % |
| ~30 % ethylene glycol | **0.066** | **0.0647** | +2.0 % |

The ordering is inverted. Propylene glycol has the *higher* volumetric heat capacity of the two at
equal concentration — its greater mass specific heat more than offsets ethylene glycol's greater
density — so the table asks a PG user to under-report heat by 4.5 % and an EG user to over-report by
2 %, in each case in the opposite direction to the truth. The values are stable across 30–40 °C, so
this is not a temperature-reference disagreement.

The same section's accuracy note ("a glycol mix lowers `Cf` ~10 % vs water") also overstates: at 30 %
the real reduction is 4.6 % (PG) and 6.5 % (EG); 10 % corresponds to roughly a 45–50 % mix.

**Proposed correction.** `0.066` for propylene glycol, `0.065` for ethylene glycol, `0.069` for
water, and restate the accuracy note as "roughly 5–7 % at 30 %, more in stronger mixes". This is a
documentation-only change with no firmware effect.

## D6 — The endianness comment is inverted

[`main/logic/convert.hpp:99`][convert] reads:

> Signed 16-bit; even id = little-endian, odd = big-endian; then a fixed-point scale.

The code immediately below it does the opposite — 101, 103, 105, 107, 109 and 151 all pass
`big_endian = false`; 102, 104, 106, 108, 110 and 152 pass `true` — and `REGISTERS.md` §3.1 agrees
with the code ("101 / 102 | s16 LE / BE", "105 = LE, the common one"). The file's own top-of-file
note is neutral ("the id's parity selects endianness"), so this one line is the only wrong
statement. It is exactly the line a maintainer would consult when porting one of the sixteen
unimplemented converter ids, where the consequence is a byte-swapped reading.

**Proposed correction.** "odd id = little-endian, even = big-endian".

## D7 — The heat-meter constant is 0.8 % high

`schematic.js`, `history.js` and `checkup`-adjacent copy all use `flow / 60 × 4.186 × ΔT`, i.e.
ρ = 1.000 kg/l and cp = 4.186 kJ/kg·K. At heating-circuit temperatures water is ρ = 0.994 kg/l and
cp = 4.179 kJ/kg·K, so ρ·cp = 4,154 against the assumed 4,186 — every `pth`, every COP and every EER
runs **+0.8 %**. Well inside the ±15–25 % the docs already attribute to sensor tolerance, and the UI
marks the figure "est.", so this is an accuracy note rather than a defect; it is recorded because it
is systematic (it never averages out of a seasonal integral) and costs one constant to remove.
`4.154 / 60` — or simply the `0.0692` the corrected D5 table would carry — makes firmware and
documentation agree on one number.

## D8 — The history `pth` series lacks the live pill's gate

`schematic.js`'s `thermalValue()` refuses to call pump-only circulation an output, with an explicit
argument: "A running pump alone can redistribute stored heat and produce a small, arithmetically
real difference; it is NOT heat-pump output." The history chart's `pth` series
([`main/www/js/history.js:109`][history]) applies no such gate — it derives from `flow`,
`leaving_water` and `return_water` alone, so a pump-overrun or circulation-only bucket is drawn as
thermal output on the same axis and under the same name. The sibling `cop` series *does* carry the
gate (`comp_rps > 5`, `dt > 0.5`, `pel > 0.2`), which is what makes the omission look unintended
rather than a deliberate choice of a different quantity.

**Proposed correction.** Either add the compressor witness to the `pth` series (the ring already
carries `comp_rps`) or rename it to state that it is a water-side balance rather than heat-pump
output. The signed behaviour across defrost should be kept in either case — that part is right, and
`HOME_ASSISTANT.md` argues it well.

## D9 — A condensing temperature below the water it heats

[`main/logic/availability.hpp`][avail] establishes the saturation witness as the high side with a
measurement: "over 1419 running samples its value tracks the LEAVING WATER across a 55 K span
(3.2–64.1 °C against LWT 9.5–64.8 °C; paired mean difference −0.9 K)".

The correlation argument is sound and the conclusion (it is the PHE side, hence the high side in
heating) is right. The **sign** is not physically possible as stated: a condenser transfers heat to
the water, so its saturation temperature must sit *above* the leaving water — typically 2–5 K above,
less a fraction of a kelvin for condenser pressure drop. A paired mean of −0.9 K implies roughly 3 K
of unexplained offset. Three candidates, in decreasing likelihood: the comparison set mixes in
non-heating or BUH-assisted samples (post-BUH water legitimately exceeds condensing temperature);
the transducer's own offset (±0.2 MPa is an ordinary spec, worth several kelvin); or a residual in
the decode. D1's residual table rules the polynomial out as the cause — it is within ±1.2 K over the
whole condensing range.

This changes no verdict: `LIQUID_LINE_SAT_CEILING = 30.0` is deliberately far above any real
subcooling, so a 3 K offset cannot flip it. It is recorded because the note reads as a validated
physical fact and is not one, and because "condensing temperature exceeds leaving water while
heating" is a cheap, high-value consistency check the firmware could assert on its own readings.

## D10 — The backup-heater "known" collapse is an OR

`cop_scope.hpp`'s `cop_plan()` takes `(buh_known, buh_on)`, and both callers that collapse the two
raw step tri-states into it — `schematic.js`'s `copPlan` and `test/presenter_golden_dump.cpp` — use
`known = (step1 known) || (step2 known)`. The two agree, so the parity gate is satisfied, but the
domain rule the header states is "UNKNOWN is not OFF", and OR breaks it: step 1 unknown beside a
step 2 reading zero yields `known = true, on = false`, i.e. "the backup heater is provably off" from
step 2 alone. Backup-heater steps are cumulative — step 2 off says nothing about step 1.

In practice this is unreachable: both bits live in the same byte (`0x60/12`, conv 304 and 303), and
all 45 shipped profiles carry both or neither, so one can never be known while the other is not. It
is recorded as a latent inconsistency between a stated rule and its implementation, not as a live
defect. `known = (step1 known) && (step2 known)` costs nothing and makes the code say what the
header says.

---

## Checked and found correct

Recorded so a later pass does not re-derive them.

* **ENV III decoders.** SHT30 `−45 + 175·raw/65535` and `100·raw/65535` match the datasheet exactly.
  The QMP6988 path — 20-bit sign extension of `a0`/`b00`, all ten coefficient conversions, both
  fixed-point compensation routines, and `/256` °C and `/1600` hPa — matches the reference
  implementation term for term, including every shift.
* **X10A framing and checksum.** `sum of all bytes including the checksum == 0xFF` and both worked
  examples verify. The `LEN` arithmetic is self-consistent (`payload_len = LEN − 2`, wire length
  `LEN + 2`).
* **`read_u16` / `read_s16`.** Endianness flag, two's-complement handling, and the size-1 case
  (`0..255`, never sign-extended) are correct and correctly documented — the water-pressure row is
  a size-1 field and decodes to `0.0–25.5`.
* **COP boundary logic.** `cop_scope.hpp` and its browser twin are thermodynamically correct: the
  pre-BUH numerator pairs with inverter current, the post-BUH numerator with whole-unit current, and
  the tank heater is correctly identified as unpairable at any numerator. The EER naming for cooling
  and the defrost sign convention are both right.
* **Thermal-power dimensioning.** `flow[l/min] / 60 × 4.186 × ΔT` yields kW; `Cf = 0.070` in the
  docs is the same number. Only the constant's value is at issue (D7), not the derivation.
* **Checkup.** Window geometry (23 completed hours plus the open one), the paired-observation
  denominators for the defrost share, the class-split population gates, the 90 % evidence bar and
  the DHW blind-time budget are all statistically sound, and the known blind band above ~1.85 K/h is
  documented rather than hidden. The pressure bound traces to a named manufacturer section.
* **Refrigerant service observer.** Correctly refuses to reduce combined DHW modes to their
  heating half, correctly treats a lost special-phase witness as an interruption rather than
  permission, and correctly declines to reuse the heating pressure-side witness for cooling.
* **Heating-curve diagnosis.** Contains no controller and proposes no setpoint; the room error is
  recorded as an observation with outdoor context, which is the right claim boundary given that a
  single room error cannot separate slope from offset.
* **Open-Meteo features.** `r1 + r2` in W/m² is dimensionally correct Wh/m² *because* the code
  verifies 3600 s spacing first; `surface_pressure` (not `pressure_msl`) is the right choice for
  comparison against a local barometer. One convention is unstated: Open-Meteo's radiation values
  are preceding-hour averages while its temperatures are instantaneous, so the two features are
  indexed identically but describe slightly different windows. No decision reads them, so the
  impact is presentational.
* **HomeHub codecs.** `Temp16` / `Pow16` `/100`, the `32765/66/67` sentinels, the 1-based offset →
  PDU address mapping and the flow register's extra `/100` are all internally consistent. The
  concept pairings are physically right. The one asymmetry worth a hardware re-check is that
  measured temperatures are `/100` while holding setpoints are plain integers — unusual within one
  map, though the map documents that every row is confirmed on hardware.
* **Home Assistant integration guidance.** The signed-value argument, the refusal to default a
  missing input to zero, the R4T tag-reuse warning and the boundary discussion are all correct, and
  the note that compressor current × 230 V carries 10–30 % error is an honest statement of the
  firmware's own `pel` estimate.

## What this review could not establish

* Whether the raw refrigerant pressure is gauge is inferred from the polynomials' own fit residuals,
  not from a manifold gauge on a live circuit. The inference is strong (three independent curves,
  near-zero bias, and `f(0)` = normal boiling point) but a single measured comparison against a
  service gauge would close it outright — and is the measurement D1 actually wants.
* The R410A turnover (D2) is established from the polynomial and the EOS. It has not been observed
  on hardware, because doing so requires driving a machine to its high-pressure trip.
* Whether each profile's declared refrigerant matches its physical charge. That data comes from the
  offline generator and no primary source in this repository can adjudicate it; a mismatch would
  select the wrong curve without any of the gates noticing.
* The −0.9 K in D9 is re-read from the recorded note, not re-measured.

[source]: https://github.com/0bu/daikin-altherma-esp32/commit/6c2c923529f542d38e4c617748214723a874de11
[convert]: ../../main/logic/convert.hpp
[registers]: ../REGISTERS.md
[gate]: ../../main/logic/feature_gate.hpp
[ha]: ../HOME_ASSISTANT.md
[history]: ../../main/www/js/history.js
[avail]: ../../main/logic/availability.hpp
