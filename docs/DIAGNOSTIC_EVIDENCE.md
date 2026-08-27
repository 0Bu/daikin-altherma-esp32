# Evidence and limits of the plant diagnostics

<!-- diagnostic-evidence-contract: 9950624b4643927f2909ea2758c2d0d39f2920eef18417aa9becafb50ffb0558 -->

For every row in the **Plant diagnostics · 24 h** card, this page answers four questions:

1. Which fact is supported by external evidence?
2. What does the firmware actually evaluate?
3. Which threshold or filter belongs only to this project?
4. What must not be concluded from the result?

The whole feature is an explicit opt-in under Settings › Firmware and is off by default. Turning it
on begins a fresh evidence generation; turning it off stops and clears the diagnosis and its
additional room, forecast, and circulation sources. None of the results below is a recommendation.

The card observes ordinary operation; it does not command service mode, full load, or a stationary
refrigerant test. No manufacturer settling duration can therefore be inferred from a complete
24-hour window, and none of the eight results is a passed commissioning test.

X10A observations are also scoped to the configured target generation. A link, wiring, or detected
unit change invalidates an in-flight cycle before it can enter this evidence window; the old target's
last sample is discarded rather than becoming the first sample attributed to the new target. This is
an identity and freshness boundary, not evidence that an unreadable replacement unit is healthy.

A manufacturer statement is not automatically a limit for every Daikin model. The installation
manual for the exact indoor and outdoor units remains authoritative. The primary sources linked here
were last reviewed on **12 August 2026**.

## How strong is each kind of claim?

| Label | Meaning |
|-------|---------|
| **Device report** | The heat pump reports the state itself. The firmware transports and retains it but does not invent a cause. |
| **Manufacturer limit** | A specific Daikin manual states the limit. It applies only to the listed models and conditions. |
| **Observation** | The firmware counts or measures an available X10A signal without declaring it good or bad. |
| **Project heuristic** | The project cautiously marks a pattern as notable. The threshold is not a Daikin service limit. |
| **Experimental** | The signal name and a change are observable, but public documentation does not establish the complete manufacturer semantics. |

The signal addresses come from the [X10A register map](REGISTERS.md), which was validated through
protocol analysis and live captures. That is strong project evidence for the **decoding**, but it is
not an official Daikin guarantee that X10A is a public or cross-generation stable diagnostic
interface.

<a id="refrigerant-service-observation"></a>
### Separate refrigerant service observation

The UI names this row **Refrigerant circuit during heating** so an owner does not mistake it for a
controller service mode. This object is deliberately outside the eight-diagnosis evidence matrix
and `/status.health`. It is an **observation**, not a manufacturer limit, project heuristic, health
verdict, or completion test. It starts automatically from ordinary read-only X10A polling during a
suitable normal heating run and does not require the default-off Plant diagnostics consent because
it activates no additional source or controller action and changes no heat-pump setting.

**Evidence boundary:** No model-specific Altherma primary source in this repository establishes a
universal hot-gas, pressure, EEV-pulse, or twenty-minute settling range for this feature. The
implementation therefore transfers no numeric threshold, superheat formula, defrost-end rule,
refrigerant-shortage pattern, or claim that a valve fault cannot produce an error code.

**Firmware rule:** `/status` omits the complete object until this boot has detected an X10A profile
and the current source generation has evaluated that resolved profile's structural signal coverage.
The detection commit resets the coverage witness under the service mutex before `/status` can pair
it with the new fingerprint; the first committed profile sweep (or the resolved-profile UART-failure
path after structural coverage is known) establishes it. This prevents an unevaluated or absent
source from being reported as an `unsupported_profile`; only evaluated coverage may make that claim.
[`refrigerant_service.hpp`](../main/logic/refrigerant_service.hpp) then accepts only fresh same-sweep
values during confirmed space heating, with running compressor, non-DHW valve,
defrost off, all declared fault rows current and normal, and every profile-provided special-phase
witness current and inactive. A profile which lacks one or more of those optional phase witnesses
may still produce a `limited` window; a witness declared by the profile but unreadable in one sweep
is required current evidence and ends an active window. Discharge temperature, EEV command, and at least one structurally
identified refrigerant-pressure side are mandatory. Cooling is excluded because the available
pressure-side evidence is heating-specific. Missing required data, a mode/valve/fault/phase change,
non-monotonic time, or a gap beyond the profile-sized poll allowance ends the window. A source
generation change resets continuity and may accept the current qualifying sample as the first sample
of a new zero-duration window. Optional suction/liquid temperature, both pressure sides, or outdoor
context missing once latches the window to `limited`; lacking the profile-level full special-phase
set makes every otherwise qualifying window `limited`.

**Project boundary:** The poll allowance is a transport bound: two fixed poll intervals plus
one 300 ms UART timeout per publishable register page in the active profile. It is not a physical
settling time. The firmware publishes continuous seconds, sample count, limitations, and min/mean/max
figures; it has no `complete`, `OK`, `ready`, charge, or full-load state. `/status` explicitly reports
`load_proven:false` and `eev_feedback:false`.

**Not established:** Hot-gas temperature, pressure, targets, and EEV commands vary with exact model,
mode, compressor speed, load, and outdoor conditions. A stable-looking window does not establish
full load, thermodynamic equilibrium, correct refrigerant charge, sensor calibration, mechanical EEV
movement, or the cause of a difference from a controller target. Official model-specific procedures
and suitable service instruments remain necessary.

## Evidence matrix for all eight diagnoses

<a id="diagnosis-fault"></a>
### 1. Unit-reported fault (`fault`)

**External evidence:** Daikin's Altherma 3 R W installer reference states that the user interface
shows a short and long description when a malfunction occurs. Its error-code table includes
refrigerant-circuit, electronics, and 7H water-flow faults ([D1], section 12.4, printed pages 89–90).

**Firmware rule:** The diagnosis reads the fault class supplied by the unit. It reports a currently
active fault immediately and retains a warning observed in the rolling window as a past event after
it clears. This is implemented by the `Fault` branch of
[`checkup_evaluate()`](../main/logic/checkup.hpp); [`fault_state.hpp`](../main/logic/fault_state.hpp)
decodes the fault class.

**Not established:** This row does not determine a root cause and does not replace the code-specific
Daikin service procedure. An unreadable signal is not equivalent to “no fault”.

<a id="diagnosis-dhw-loss"></a>
### 2. Domestic-hot-water tank heat loss (`dhw_loss`)

**External evidence:** The EU defines a hot-water storage tank's standing loss as the heat power in
watts emitted at specified water and ambient temperatures. Storage volume and standing loss are
separate declared technical parameters ([E1], Article 2(17) and Annex III, section 7). This supports
that tank heat loss is real and measurable, while also showing that test conditions and tank size
matter. A NIST liquid-water reference correlation gives an isobaric heat capacity of
`4181.446 J/(kg·K)` at 298.15 K and 0.1 MPa ([R3], table 8), equivalent to about
`1.16 Wh/(kg·K)`. This supports the UI's rounded water heat-content example, not whole-tank
calorimetry from one sensor.

**Firmware rule:** The firmware evaluates complete, quiet one-hour windows of tank sensor R5T. Tank
charging, internal pump movement, a detected draw, implausible readings, and excessive gaps discard
the window. A genuine charge starts a 45-minute settling period. A **NOTE** begins at `0.8 K/h`; a
reassuring result requires six clean hours in a complete 24-hour lifecycle. The rules are the
`DHW_LOSS_*` constants and the `DhwLoss` branch in
[`checkup.hpp`](../main/logic/checkup.hpp). The retained aggregate publishes only the greatest
completed-hour R5T rate plus window counts and circulation correlation; it does not retain a mean,
sum, or every window's individual rate.

**Project boundary:** `0.8 K/h`, the 45-minute settling period, six clean hours, and the detectable
upper range of about `1.85 K/h` are **project heuristics**, not Daikin limits or an implementation of
the EU test method. A temperature drop in K/h is not directly comparable to a product-sheet loss in
watts. The UI's kWh figure assumes `200 l ≈ 200 kg` of water, uniform whole-volume cooling, and the
rounded `1.16 Wh/(kg·K)` heat capacity. It is an explanatory size example based on the greatest
single R5T drop, not an additional measurement or a configured tank volume. Its 24-hour orientation
then assigns that maximum to every clean window and assumes a domestic-hot-water COP of `2.5–3.0`.
Both are explicit project assumptions chosen to show scale, not a measured efficiency or a
manufacturer performance range. Rejected and missing hours are outside that illustration.
The 24-hour line is suppressed until the report's `full_span` boundary is true; an early notable
window can show only its one-hour thermal size example.

**Not established:** A notable drop proves neither a leaking three-way valve nor poor insulation.
Draws, stratification, thermosiphoning, a check valve, and external circulation can produce similar
traces. A circulation label shows temporal correlation, not exclusive cause. `OK` also does not
exclude faster continuous loss outside the detectable band. Because one point in a stratified tank
does not establish uniform cooling and the individual window rates are not retained, the result
establishes neither whole-tank/daily thermal kWh nor electrical kWh. The UI's multiplication is
therefore labelled as the counterfactual case where every clean window equals the maximum; reading
it as the actual 24-hour total would fabricate a measurement.

<a id="diagnosis-cycling"></a>
### 3. Compressor cycling (`cycling`)

**External evidence:** A test report commissioned by the UK Department of Energy and Climate Change
studied one air-source and one ground-source heat pump with fixed compressor speeds. Runs shorter
than about six minutes reduced efficiency in the tested systems, while heat emission, water volume,
control, and outside temperature also affected the result ([R1], summary and sections 1–2). This
supports the relevance of very short runs but does not provide a universal Daikin limit.

**Firmware rule:** The firmware counts complete compressor runs. When the three-way valve and
operating mode remain readable throughout, it separates space heating, domestic hot water, and
cooling; only confirmed space-heating runs decide the result. A **NOTE** requires at least twelve
assessable runs averaging under ten minutes plus sufficient complete 24-hour evidence. Mixed runs
and runs interrupted by measurement gaps are censored. The constants are
`CHECKUP_CYCLING_MIN_STARTS`, `CHECKUP_CYCLING_SHORT_RUN_S`, and
`CHECKUP_CYCLING_CLASSIFIED_PCT` in [`checkup.hpp`](../main/logic/checkup.hpp).
Fresh X10A outdoor minimum/mean is attached only to completed, consistently classified
space-heating runs. It is explanatory context and changes no threshold or verdict.

**Project boundary:** Twelve runs and ten minutes are deliberately cautious **project heuristics**.
They are neither copied from [R1] nor specified by Daikin. [R1] studied different, non-modulating
units and supports only the general claim that short runs and system hydraulics can affect
efficiency. The X10A page-`0x20` mapping and the positive-RPS freshness pairing are project
evidence, not a published Daikin protocol guarantee.

**Not established:** The note proves neither oversizing nor incorrect hydraulic balancing. Building
load, weather, setpoints, and delivered heat are required to investigate a cause. The optional
minimum/mean describes only accepted samples inside eligible runs, not continuous weather coverage.

<a id="diagnosis-defrost"></a>
### 4. Defrost events (`defrost`)

**External evidence:** Daikin lists defrost as an operating mode and a manually activatable function;
commissioning must maintain minimum water flow during defrost and backup-heater operation ([D1],
sections 8.4.8, 8.4.9, and 9.3–9.4). Experimental research shows that icing and defrost behaviour
depend strongly on outside-air temperature, relative humidity, and heat-exchanger state ([R2]).

**Firmware rule:** The diagnosis counts rising edges of `Defrost Operation`. It calculates a share
only for periods in which both the defrost signal and compressor state were readable. A **NOTE**
appears after at least three paired defrost events and when defrost exceeds **15%** of paired
compressor runtime. `CHECKUP_DEFROST_MIN_COUNT` and `CHECKUP_DEFROST_SHARE_PCT` implement the rule in
[`checkup.hpp`](../main/logic/checkup.hpp).
Fresh X10A outdoor minimum/mean is collected over that same readable, running-compressor population;
it is explanatory context and changes neither the ratio nor its verdict.
The separately published live R4T de-icer temperature is not paired into the checkup population or
verdict. Its sensor position and the unit's defrost start/end logic are model-specific, and one local
reading cannot establish the whole coil's surface or ice state.

**Project boundary:** The 15% share and three-event requirement are broad **project heuristics**, not
Daikin limits. The firmware knows neither outdoor humidity nor the outdoor heat exchanger's surface
or fin temperature. The X10A page-`0x20` mapping and the positive-RPS freshness pairing are project
evidence, not a published Daikin protocol guarantee.

**Not established:** Frequent defrosting is not automatically abnormal in wet, cold weather. The row
proves neither blocked airflow, low refrigerant charge, nor a sensor defect. The optional
minimum/mean describes only accepted samples inside the paired runtime, not continuous weather
coverage.

<a id="diagnosis-pressure"></a>
### 5. Lowest water pressure (`pressure`)

**External evidence:** For the Altherma 3 R W models listed in [D1], Daikin's troubleshooting
procedure requires pump inlet pressure **above 1 bar** and names the pressure sensor, expansion
vessel, valve, and pre-pressure as checks ([D1], section 12.3.4, printed page 87). Other Altherma
manuals also state at least or above 1 bar, but the permitted filling and operating range remains
model-specific ([D2], section 8.1.3).

**Firmware rule:** The row reports the lowest valid value in the rolling window. At `<= 1.0 bar` it
shows a **NOTE** immediately; only 60 seconds of uninterrupted low pressure promotes it to a
**WARNING**. Confirmation does not alter the raw reading. See `CHECKUP_BAR_WARN_TENTHS` and
`CHECKUP_PRESSURE_CONFIRM_S` in [`checkup.hpp`](../main/logic/checkup.hpp).

**Project boundary:** The one-minute confirmation is this project's transient filter and is not in
the Daikin manual. The firmware uses 1.0 bar as a conservative common diagnostic boundary, not as
the complete permitted range for every model.

**Not established:** Low pressure does not identify its cause. Refilling without investigation can
hide an expansion-vessel problem, air, or water loss.

<a id="diagnosis-flow"></a>
### 6. Lowest water flow (`flow`)

**External evidence:** Minimum water flow is model-specific. [D1] states `12 l/min` and fault 7H for
the listed Altherma 3 R W units (sections 6.4.3, 9.4.1, and 12.4). An Altherma 3 H HT F manual states
`25 l/min` or `22 l/min`, depending on the variant ([D2], section 8.1.3). One firmware-wide good/bad
limit would therefore be incorrect.

**Firmware rule:** The diagnosis reports only the lowest valid flow after the internal pump ran
continuously for at least 60 seconds. It does not assign a good/bad verdict. See
`CHECKUP_FLOW_RUNUP_S` and the `Flow` branch in [`checkup.hpp`](../main/logic/checkup.hpp).

**Project boundary:** The 60-second period filters pump start-up, valve movement, and air purging; it
is not a manufacturer limit.

**Not established:** The observed part-load minimum is not automatically the design flow required
during a commissioning test. A comparison is valid only against the manual for the exact model
combination and the same operating condition.

<a id="diagnosis-heater"></a>
### 7. Electric backup and booster heaters (`heater`)

**External evidence:** Daikin documents several legitimate reasons for heater operation. Depending
on configuration, the booster heater can support domestic-hot-water preparation, disinfection, or
operation outside the heat pump's operating range. Backup and/or booster heaters can carry load in
emergency operation after a heat-pump failure ([D1], sections 8.4.6 and 8.4.9, printed pages 66 and
71–72). The manual also requires sufficient water flow during backup-heater and defrost operation
([D1], section 9.3).

**Firmware rule:** The diagnosis separately totals active seconds for BUH steps 1/2 in the water
circuit and BSH in the domestic-hot-water tank. The result remains **MEASURED ONLY** because weather,
configuration, setpoints, and the operating reason are needed before runtime can be judged. See the
`Heater` branch in [`checkup.hpp`](../main/logic/checkup.hpp).

**Not established:** Runtime alone proves neither a defect nor unnecessary electricity use. An
energy conclusion additionally needs electrical power and the heat delivered by the heater.

<a id="diagnosis-retries"></a>
### 8. Protection-limit counter changes (`retries`)

**External evidence:** The project register map contains five separate X10A counters for discharge
temperature, compressor inverter current, high pressure, low pressure, and inverter-fin temperature
([register 0x10](REGISTERS.md#register-0x10)). Daikin documents related fault and protection classes,
including high pressure, compressor overheating, and inverter overcurrent, in its error-code table
([D1], section 12.4).

**Firmware rule:** An event is reported only when the same exact counter **increases** between two
comparable observed values. A non-zero counter present at startup is insufficient. All five counters
and a readable compressor state are required. See `checkup_retry_index()`, `CHECKUP_RETRY_COUNT`, and
the `Retries` branch in [`checkup.hpp`](../main/logic/checkup.hpp).

**Experimental boundary:** Public Daikin documentation does not establish complete semantics for
these five internal X10A counters, including reset behaviour, guaranteed counting rules, or causal
assignment. The documentation therefore provides no manufacturer threshold, and the UI marks the
row **EXPERIMENTAL**.

**Not established:** An increase is not a specific fault, and a stable counter does not prove that
no protection limiting occurred. A cause requires the time, operating state, and official fault code
together.

## Sources

### Manufacturer documentation

<a id="source-d1"></a>

- **[D1]** Daikin, *Daikin Altherma 3 R W – Installer reference guide*, models
  ERGA04–08DAV3(A) + EHBH/X04+08DA, document **4P496758-1B**, revision 2019-10:
  [official PDF][D1-pdf]. Sections used: 6.4.3 water volume/flow; 8.4.6 tank; 8.4.8 information;
  8.4.9 installer settings; 9.3–9.4 commissioning; 12.3.4 pump noise; 12.4 error codes.

<a id="source-d2"></a>

- **[D2]** Daikin, *Daikin Altherma 3 H HT F – Installer reference guide*, models
  EPRA14–18D + ETVH16SU18+23E, document **4P644738-1D**, revision 2023-10:
  [official PDF][D2-pdf]. Section used: 8.1.3 water piping; minimum pressure 1 bar and
  model-dependent minimum flow of 25 or 22 l/min.

### Regulation and research

<a id="source-e1"></a>

- **[E1]** European Commission, Regulation (EU) No 814/2013 on ecodesign requirements for water
  heaters and hot-water storage tanks: [official EUR-Lex text][E1-web]. Sections used: Article 2(17),
  Annex II section 2, and Annex III section 7.

<a id="source-r1"></a>

- **[R1]** Robert Green / EA Technology for DECC, *The Effects of Cycling on Heat Pump Performance*,
  project 46640, November 2012: [official publication page][R1-web] and [test report][R1-pdf]. The
  results apply to the tested units and do **not** establish this project's ten-minute threshold.

<a id="source-r2"></a>

- **[R2]** Y.-G. Chen and X.-M. Guo, *Dynamic defrosting characteristics of air source heat pump and
  effects of outdoor air parameters on defrost cycle performance*, Applied Thermal Engineering 29
  (2009), 2701–2707, DOI 10.1016/j.applthermaleng.2009.01.003:
  [publisher page and abstract][R2-doi]. The study supports dependence on outdoor conditions, not
  this project's 15% heuristic.

<a id="source-r3"></a>

- **[R3]** J. Pátek, J. Hrubý, J. Klomfar, M. Součková, and A. H. Harvey,
  *Reference Correlations for Thermophysical Properties of Liquid Water at 0.1 MPa*, Journal of
  Physical and Chemical Reference Data 38(1), 2009, 21–29, DOI 10.1063/1.3043575:
  [NIST publication page][R3-web] and [paper][R3-pdf]. Section used: table 8, liquid-water density
  and isobaric heat capacity at 298.15 K. Reviewed **27 August 2026**.

## Maintenance rule

A diagnosis change is not documentation-complete until this page still names the observation,
external basis, project boundary, and claim limit for every affected row. A new threshold may be
called a **manufacturer limit** only when a primary source for the matching model family is cited
with document number, revision, and section. Otherwise it remains clearly labelled as an
observation, project heuristic, or experimental rule.

The CI gate `scripts/run-diagnostic-evidence-audit.sh` binds these claims to the current diagnosis
implementation, visible diagnosis IDs, five protection counters, and the related project evidence
in `docs/REGISTERS.md`. It also checks the complete evidence matrix, source references, HTTPS
resolution, and each Daikin source's models, document number, revision, and used section. A change to
any of those inputs or this page raises `E010`. Refresh the fingerprint only after a content review
with `$diagnostic-evidence-review`:

```bash
scripts/run-diagnostic-evidence-audit.sh --update
scripts/run-diagnostic-evidence-audit.sh
tools/diagnostic_evidence/selftest.sh
```

The fingerprint records that code, claims, and catalog were reviewed together. It does not by itself
prove that a source is technically applicable; that remains the human part of the gate.

[D1]: #source-d1
[D2]: #source-d2
[E1]: #source-e1
[R1]: #source-r1
[R2]: #source-r2
[R3]: #source-r3
[D1-pdf]: https://my.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EHBH-D6V%2C%20EHBH-D9W%2C%20EHBX-D6V%2C%20EHBX-D9W%2C%20ERGA04-08DV%2C%20ERGA04-08DVA_4PEN496758-1B_2019_10_Installer%20reference%20guide_English.pdf
[D2-pdf]: https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-high-temperature/epra14-18dw7/EPRA014-018D%28V.W%29.EPRA14-18D%28V.W%297.ETVH16UE6V%287%29_Installer%20reference%20guide_4PEN644738-1D_English.pdf
[E1-web]: https://eur-lex.europa.eu/eli/reg/2013/814/oj/eng
[R1-web]: https://www.gov.uk/government/publications/heat-pump-performance-effects-of-cycling
[R1-pdf]: https://assets.publishing.service.gov.uk/media/5a78e0d9e5274a2acd18a7c6/7389-effects-cycling-heat-pump-performance.pdf
[R2-doi]: https://doi.org/10.1016/j.applthermaleng.2009.01.003
[R3-web]: https://www.nist.gov/publications/reference-correlations-thermophysical-properties-liquid-water-01-mpa
[R3-pdf]: https://srd.nist.gov/jpcrdreprint/1.3043575.pdf
