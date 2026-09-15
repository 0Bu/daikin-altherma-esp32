# Domain review — 14 September 2026

This review examines the physical and numerical correctness of revision
[`6c2c923529f5`][source] and records the corrections implemented by PR 102. It covers the X10A
converter layer, refrigerant saturation correlations, water-side heat calculations, derived browser
history and the documentation that gives those values meaning.

The original review correctly found several real defects, but it mixed those defects with claims
that were either overstated or not reproducible from the recorded evidence. This revision separates
confirmed behavior, reviewer calculations and remaining evidence limits. It also replaces proposed
fixes with the behavior actually implemented and host-tested on the PR head.

## Method and evidence limits

The production paths were traced from profile metadata through `logic/convert.hpp`, `hp_convert.cpp`,
history assembly and presenter parity. Every changed property has a deterministic test: monotonic
correlation intervals, unsupported-refrigerant rejection, profile metadata completeness, publication
unit conversion, derived-history availability and the three-valued backup-heater state.

External references establish the following boundaries:

- the recovered [X10A protocol reference][x10a-protocol] identifies type-2 pressure as kg/cm²; it
  does not independently state whether the pressure reference is gauge or absolute;
- the three shipped polynomials themselves strongly support gauge pressure because their value near
  zero corresponds to each refrigerant's normal boiling region;
- the [CoolProp incompressible-mixture documentation][coolprop-incomp] defines `MPG` and `MEG` by
  **mass fraction**, while `APG` and `AEG` use volume fraction;
- the [CoolProp MPG fit report][mpg-report] identifies the Melinder source and its mass-fraction
  range;
- NIST documents the pseudo-pure equations of state for [R410A and R407C][nist-blends]. R407C has
  temperature glide, so one context-free saturation curve cannot silently stand in for both bubble
  and dew temperatures.

The first report did not record the CoolProp version, backend, quality coordinate, pressure
reference, sample grid or executable calculation. Its residual and point tables are therefore
reviewer calculations, not reproducible project evidence. The corrections below do not depend on
those unpublished tables: their fail-closed limits come from deterministic analysis of the shipped
polynomial coefficients and their derivatives.

Baseline at the original revision was `scripts/run-domain-audit.sh` clean (45 profiles, 4,292 rows).
That proves catalog/spec agreement; it does not independently validate refrigerant thermodynamics.

## Findings and disposition

| ID | Priority | Corrected finding | Disposition |
| --- | --- | --- | --- |
| D1 | P2 | The correlation input is kgf/cm² and is most consistently interpreted as gauge pressure, but the code called it absolute and cited its own derived row as evidence | Corrected the unit/reference explanation and retained the evidence limit |
| D2 | P1 | All sixth-order correlations eventually turn over and can return plausible values on a falling branch | Added conservative monotonic ceilings and rejection above them |
| D3 | P2 | R407C, R134a and missing profile metadata silently selected the R32 curve | Removed every implicit substitution; unsupported or missing metadata now yields no saturation value |
| D4 | P2 | Type-2 values were decoded in kgf/cm² but labelled and published as bar | Added `0.980665` conversion at the publication boundary |
| D5 | P2 | The Home Assistant glycol table had the PG/EG ordering and concentration basis wrong | Replaced it with 35 °C, 30 mass-% values and named the basis |
| D6 | P2 | The converter-endianness comment stated the parity rule backwards | Corrected the comment; production decode was already right |
| D7 | P3 | `4.186` is a documented reference-fluid approximation, not a temperature-independent property claim | Kept the code and clarified the accuracy boundary; no defect established |
| D8 | P3 | Historical heat output could label pump-overrun heat transport as heat-pump output | Added compressor frequency as a required profile/input witness whenever measured flow is present |
| D9 | — | A mixed heating/cooling sample was described as a physically impossible condenser pinch | Rejected that conclusion and corrected the PHE-side, mode-dependent description |
| D10 | P3 | The browser treated one known-off backup-heater stage plus one unknown stage as proof that both were off | Restored the asymmetric three-valued rule and presenter parity |

P1 means shipped input can produce a plausible but physically wrong published value. P2 means a
unit, substitution or maintained technical statement was wrong. P3 is a bounded consistency or
accuracy issue.

## D1 — pressure coordinate and evidence

Converter 405 receives a signed little-endian value scaled by 0.1. The X10A protocol and project
register map call the underlying unit kg/cm². The saturation correlations operate directly on that
number.

The original comment called it absolute bar and tried to prove that statement with a `15.3` pressure
and `22.1 °C` saturation pair. The temperature was produced by the same correlation under review, so
the argument was circular. The stronger internal clue is the intercept: evaluating each correlation
near zero reaches the corresponding normal-boiling region. That supports a gauge-pressure
coordinate, but it is still an inference until compared with an independent service gauge and the
same timestamped X10A row.

The decode remains kgf/cm²G for the correlation. No atmosphere is added and no bar conversion is
applied before the polynomial. Zero and negative pressure continue to mean that no useful saturation
temperature can be published.

## D2 — bounded correlation intervals

Differentiating the shipped coefficients gives the first positive derivative roots:

| Refrigerant id | Correlation | First derivative root | Accepted ceiling |
| --- | --- | ---: | ---: |
| 801 | R410A | 40.3164076 kgf/cm²G | 40.0 kgf/cm²G |
| 802 | R32 | 47.3694862 kgf/cm²G | 47.0 kgf/cm²G |
| 803 | R22 | 28.7412410 kgf/cm²G | 28.0 kgf/cm²G |

Those ceilings are monotonicity guards for recovered correlations. They are not declarations of an
equipment operating envelope or proof that the correlations meet an equation of state throughout
the retained interval. Values above the ceiling are omitted rather than allowed onto a plausible
falling branch.

The first report's statement that 41.5 kgf/cm² equals 4.15 MPa was arithmetically wrong:
41.5 kgf/cm² is about 4.070 MPa, while 4.15 MPa is about 42.32 kgf/cm². It also cited no model-specific
Altherma protection setting. That switch-setting claim has been removed; the polynomial turnover is
sufficient to justify the guard.

## D3 — no refrigerant substitution

R407C (804) and R134a (805) previously selected the R32 correlation. A missing refrigerant metadata
row also defaulted to R32. Both paths could produce an ordinary-looking temperature with no physical
basis.

`profile_refrigerant()` now returns unknown when metadata is absent. `press2temp()` accepts only 801,
802 and 803 and returns no value for every other id. Every registered profile that contains a
converter-405 row is host-tested to contain exactly one supported refrigerant declaration. The
hand-written `altherma3_r_erga` profile now declares R32 explicitly; generated tables were not edited
by hand.

## D4 — intrinsic and publication pressure units

Intrinsic type-2 decode remains kgf/cm² because converter 405 and the X10A contract depend on that
coordinate. Numeric type-2 values are multiplied by `0.980665` only when `hp_format()` publishes
them as bar. Saturation-temperature rows have temperature type and are unaffected.

The original review also claimed that the old 1.0 threshold left a 0.98–1.00 bar warning gap. The
source values advance in 0.1 kgf/cm² steps, are formatted to one decimal place, and the diagnostic
comparison is inclusive. That narrow interval was not representable on the published path, so no
separate diagnostic threshold change is justified by this unit correction.

## D5 and D7 — water-side heat constants

The Home Assistant example uses `P = flow × ΔT × Cf`. At 35 °C, the documented reference values are
now:

| Loop fluid | Basis | `Cf` (kW / ((l/min)·K)) |
| --- | --- | ---: |
| Water | temperature-specific volumetric value | 0.0692 |
| Propylene glycol | 30 mass-% (`MPG`) | 0.0660 |
| Ethylene glycol | 30 mass-% (`MEG`) | 0.0647 |

The former PG value was low and the former EG value was high; the assertion that both were too low
was incorrect. Volume-percent mixtures require the `APG`/`AEG` basis and different values.

The live dashboard and browser-assembled history retain the explicit reference-fluid factor
`4.186 kJ/(l·K)`. It is a
simple water approximation whose error varies with temperature; replacing it with a different fixed
number would merely move the reference point. The Home Assistant recipe instead uses a 35 °C
volumetric value, about 0.8% lower at that reference point. Fluid composition and temperature remain
stated accuracy limits, so D7 does not establish a code defect. The water reference follows
[IAPWS liquid-water properties near 0.1 MPa][iapws-water]. At 35 °C and 30 mass-%, the Melinder
coefficients in CoolProp's [MPG][mpg-json] and [MEG][meg-json] definitions give respectively
`1016.2265 × 3.8971844 / 60000 = 0.0660070` and
`1031.3165 × 3.7614019 / 60000 = 0.0646533`, with density in kg/m³ and specific heat in kJ/(kg·K).

## D8 — historical heat-output boundary

The live thermal pill already refuses pump-only circulation. The old five-minute derived history did
not: any non-null flow and temperature difference became signed heat output. The corrected history
requires `comp_rps` as a structural input. A bucket with flow at or below 0.5 l/min records zero
transfer. With greater flow, compressor frequency must exceed 5 rps; otherwise the bucket is a gap.

This deliberately reduces availability. A profile without compressor frequency does not offer the
derived heat-output curve, and pump-overrun intervals become gaps. The remaining signed values keep
the existing defrost/cooling information and the reference-fluid approximation. The live pill also
uses mode and useful-direction gates; history preserves the signed primitive balance rather than
renaming a full day's samples from one instantaneous mode.

## D9 — mode-dependent PHE-side temperature

The cited field sample combined heating and cooling operation. The same refrigerant sensor is
expected to be high relative to leaving water during heating/condensing and low during
cooling/evaporating. Its aggregate signed difference can therefore be negative without proving a
physically impossible condenser pinch. The source comment now describes the measurement as PHE-side,
mode-dependent context and does not turn a mixed-mode aggregate into a fault claim.

## D10 — asymmetric backup-heater knowledge

The relevant state has three values: on, off and unknown. Either stage observed on is enough to prove
that backup heat is active. Proving backup heat off requires both stage readings to be known and
neither to be on. The C++ presenter oracle and browser now implement that same asymmetric collapse;
the exhaustive presenter vectors and mutation selftest protect the unknown-stage case.

## Verified areas that were not changed

The review found no contrary evidence in the signed water-side heat balance, COP scope rule,
outdoor-unit hold-over handling, checkup evidence persistence, heating-curve interpolation, SHT30
CRC/temperature/humidity conversion, QMP6988 calibration algebra, or current/energy scaling. These
are source-level findings. Hardware behavior, independent pressure-reference confirmation and
mixture-specific heat-meter calibration still require measurements from the relevant installation.

[source]: https://github.com/0Bu/daikin-altherma-esp32/tree/6c2c923529f5
[x10a-protocol]: https://github.com/raomin/ESPAltherma/blob/main/doc/Daikin%20I%20protocol.md
[coolprop-incomp]: https://coolprop.org/fluid_properties/Incompressibles.html
[mpg-report]: https://coolprop.org/_downloads/15da2eff4264ab41969c2288a2fd7a14/MPG_fitreport.pdf
[nist-blends]: https://www.nist.gov/publications/pseudo-pure-fluid-equations-state-refrigerant-blends-r-410a-r-404a-r-507a-and-r-407c
[iapws-water]: https://www.iapws.org/relguide/LiquidWater.html
[mpg-json]: https://github.com/CoolProp/CoolProp/blob/master/dev/incompressible_liquids/json/MPG.json
[meg-json]: https://github.com/CoolProp/CoolProp/blob/master/dev/incompressible_liquids/json/MEG.json
