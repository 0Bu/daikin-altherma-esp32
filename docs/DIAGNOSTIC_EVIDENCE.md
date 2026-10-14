# Evidence and limits of the plant diagnostics

<!-- diagnostic-evidence-contract: 86c0cf4d02732d91c20c23b322c24dcb1c612f618c536d7654b2472fc4c2becc -->

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

X10A evidence is scoped to the configured target generation. Changed wiring, profile or detected
source discards an in-flight old-source sample and retires pending restoration for that boot.
A manual profile selection establishes a decoding contract, not a physical reply.

At read time the diagnosis publishes elapsed span separately from usable signal coverage and the
age of the last nonempty X10A sample. A source older than the 15-second project bound cannot support
a current fault all-clear or reassuring assessment. Temporary TLS/allocation pauses contribute no
measurement coverage and do not withdraw profile capabilities. Historical findings remain within
their admissible age; live, restored and open evidence expires even if the producer stops.
DHW circulation identity is independent and binds broker, topic, value/time paths and interpretation
parameters. A mismatch retires only tank-cooling evidence. [PLANT.md](PLANT.md#reboot-and-persistence)
owns restoration and restart limits; HomeHub/ENV III remain separate instruments.

A manufacturer statement is not automatically a limit for every Daikin model. The installation
manual for the exact indoor and outdoor units remains authoritative. The primary sources linked here
were last reviewed on **11 October 2026**. The research paper [R2] was checked through its
publisher abstract; its full text was not accessible during that review.

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

The UI names this row **Refrigerant (heating)** so an owner does not mistake it for a
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
is required current evidence and ends an active window. Discharge temperature, EEV command, and at
least one structurally identified refrigerant-pressure side are mandatory. The high side has one sensor
per profile, fixed by coverage: the hydronic transducer (0x62/15) when it is a structural refrigerant
pressure, otherwise the outdoor high-pressure row (0x20/12); a sweep that lost that page leaves the side
missing instead of substituting the other transducer. Whether real units of the profiles that rely on
0x20/12 alone populate it while running is unverified; one that does not shows a missing side, not a
value. Cooling is excluded because the available
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

**Firmware rule:** A currently readable error class produces **WARNING** immediately; warnings and
cautions produce **NOTE**. An earlier observed error/warning flag remains a **NOTE** in the rolling
window. Normal requires every fault-class row supplied by the profile to be readable and normal.
Missing current rows cannot establish that a retained fault has cleared. See the Fault branch of
[checkup_evaluate()](../main/logic/checkup.hpp) and [fault_state.hpp](../main/logic/fault_state.hpp).

**Not established:** The supported classes are not a comprehensive plant-health test. No root
cause, spontaneous recovery, absence of intervention or code-specific service conclusion is inferred.

<a id="diagnosis-dhw-loss"></a>
### 2. Domestic-hot-water tank cooling (`dhw_loss`)

**External evidence:** The EU defines a hot-water storage tank's standing loss as the heat power in
watts emitted at specified water and ambient temperatures. Storage volume and standing loss are
separate declared technical parameters ([E1], Article 2(17) and Annex III, section 7). This supports
that tank heat loss is real and measurable, while also showing that test conditions and tank size
matter.

**Firmware rule:** Complete eligible one-hour windows measure the drop at tank sensor R5T.
Charging, internal-pump activity, an apparent draw, implausible temperature or excessive blindness
discards a candidate. A charge witness sustained for two minutes, or seen after an unmeasured gap,
arms a 45-minute settling filter; unread time directly before a witness, or an unread tail after a
short one, counts toward the two minutes. Every DHW evaluation that starts without a compatible
handoff (power loss, crash, consent, identity, circulation or long-gap reset) first holds the same
45 minutes. Settling and that hold count down only on samples that read both witnesses. A completed
window at
or above 0.8 K/h produces **NOTE** immediately. Other completed windows remain observations; no
eligible window remains **CHECKING**; the "no eligible window in 24 h" statement needs 24 hours of DHW
scope, which restarts when collection starts, at a DHW reset and at a restore that dropped DHW hours.
There is no reassuring tank-loss verdict or six-hour acceptance test. The result retains the maximum
rate (floored to 0.1 K/h), completed/notable window counts and circulation correlation, not
individual rates, an average or an energy integral.

Changing the circulation broker, mapping or interpretation retires DHW records and the ongoing
filter, without discarding independent X10A checks. Display-name edits do not change evidence identity.
A dated journal interval or one-shot restart candidate must match both scopes. See DHW_LOSS_* and
the DhwLoss branch in [checkup.hpp](../main/logic/checkup.hpp); [PLANT.md](PLANT.md#reboot-and-persistence)
owns the compatible-restart blind-time allowance and admission rules.

**Project boundary:** The 0.8 K/h threshold, 45-minute settling period, apparent-draw filter and
roughly 1.85 K/h upper detection band are project heuristics, not Daikin limits or the EU test method.
Candidates tolerate at most 120 seconds of one blind stretch and 10% blind time in total; blind
seconds are excluded from observation coverage. Pump overlap needs at least 90% known circulation
state and five minutes on; a pump-off label additionally requires two hours of known-off settling.
These bounds describe this filter, not an identified physical cause.

**Not established:** A single point in a stratified tank cannot measure whole-tank thermal loss,
daily consumption or replacement electricity. Fast continuous cooling can be excluded as an apparent
draw, so quiet accepted windows cannot rule out loss elsewhere. Draws, stratification, circulation,
thermosiphoning and valve behaviour can produce similar traces; pump overlap is correlation.

A charge that no sample witnessed can still admit its settling tail as apparent cooling, and a short
witness followed by a gap longer than the normal poll gap can arm no settling. An intentional restart
during the start hold loses its remainder; power loss, panic, identity changes and incompatible
handoffs start a new hold. Discard totals retain
only an OR-ed reason set, not per-hour provenance or dominant cause. Blindness may reflect bus
timeouts or firmware pauses and establishes no wiring defect.

<a id="diagnosis-cycling"></a>
### 3. Compressor cycling (`cycling`)

**External evidence:** A test report commissioned by the UK Department of Energy and Climate Change
studied one air-source and one ground-source heat pump with fixed compressor speeds. Runs shorter
than about six minutes reduced efficiency in the tested systems, while heat emission, water volume,
control, and outside temperature also affected the result ([R1], summary and sections 1–2). This
supports the relevance of very short runs but does not provide a universal Daikin limit.

**Firmware rule:** Starts and continuously witnessed completed runs are retained separately.
Readable unchanged valve/mode inputs classify completed runs as space heating, DHW or cooling;
mixed or gapped runs are censored. A sweep that read no X10A row at all (a firmware pause or a
wholly silent bus sweep) inside a run is bounded blind time and censors only beyond 15 seconds; a
start hidden by an unreadable sample opens a censored run. The classified share uses the larger of
completed runs and starts minus one, so completions a restart lost keep the result an observation.
Only at least 12 completed space-heating runs and at least 90% of all completed runs classified can
support the heating assessment. A mean below ten minutes then
produces **NOTE** immediately. An absence-of-short-run assessment additionally requires a full
24-hour span and at least CHECKUP_REQUIRED_S of paired classification time.

Missing classification, fewer than 12 heating runs or an inadequate classified population remains
an observation with an explicit reason; absent compressor evidence remains CHECKING.
There is no pooled starts/runtime fallback, and unfinished
runs never enter the completed mean. Completed-run evidence ages with its start edge. See
CHECKUP_CYCLING_MIN_STARTS, CHECKUP_CYCLING_SHORT_RUN_S and CHECKUP_CYCLING_CLASSIFIED_PCT in
[checkup.hpp](../main/logic/checkup.hpp). Fresh X10A outdoor minimum/mean accompanies only accepted
completed heating runs, from samples whose predecessor was also running, and changes no threshold.

**Project boundary:** Twelve heating runs, ten minutes and the 90% evidence requirements are
project heuristics, not limits copied from R1 or specified by Daikin. R1 studied different,
non-modulating units and supports only the general relevance of short runs and system hydraulics.
The page-0x20 mapping and positive-compressor freshness pairing are project protocol evidence.
The 15-second all-blind tolerance and the larger-of-completed-runs-and-starts-minus-one population
are project rules.

**Not established:** The note identifies neither oversizing nor incorrect hydraulic balancing.
The observed run population and its outdoor context do not establish building load, delivered heat
or continuous weather coverage. Defrost behaviour has not yet been observed by this project; if the
compressor stops at defrost entry or exit, one heating run counts as several.

<a id="diagnosis-defrost"></a>
### 4. Defrost events (`defrost`)

**External evidence:** Daikin lists defrost as an operating mode and a manually activatable function;
commissioning must maintain minimum water flow during defrost and backup-heater operation ([D1],
sections 8.4.8, 8.4.9, and 9.3–9.4). Experimental research shows that icing and defrost behaviour
depend strongly on outside-air temperature, relative humidity, and heat-exchanger state ([R2]).

**Firmware rule:** Rising edges count defrost starts. Defrost share uses only intervals with
readable compressor and defrost states at both endpoints. At least three paired events and more
than 15% of paired compressor runtime produce **NOTE** immediately. A reassuring assessment
additionally requires a complete 24-hour span and 90% paired coverage. Fewer events or no paired
runtime remain observations with a reason; no readable defrost observation remains CHECKING.
Missing readings remain missing, not zero. See
CHECKUP_DEFROST_MIN_COUNT and CHECKUP_DEFROST_SHARE_PCT in [checkup.hpp](../main/logic/checkup.hpp).

Fresh X10A outdoor minimum/mean belongs to the same accepted running-compressor population and
does not alter the rule. Separate live R4T de-icer temperature does not enter the population;
its placement and the controller's defrost logic are model-specific.

**Project boundary:** The three-event requirement and 15% share are project heuristics, not Daikin
limits. The page-0x20 mapping and positive-compressor freshness pairing are project evidence, not a
published Daikin protocol guarantee. X10A supplies neither humidity nor whole-coil surface/ice state.

**Not established:** Frequent defrost can be normal in cold, wet weather. Neither the share nor
the optional outdoor context establishes blocked airflow, refrigerant shortage, sensor failure or
continuous weather coverage.

<a id="diagnosis-pressure"></a>
### 5. Lowest water pressure (`pressure`)

**External evidence:** For the Altherma 3 R W models listed in [D1], Daikin's troubleshooting
procedure requires pump inlet pressure **above 1 bar** and names the pressure sensor, expansion
vessel, valve, and pre-pressure as checks ([D1], section 12.3.4, printed page 87). Other Altherma
manuals also state at least or above 1 bar, but the permitted filling and operating range remains
model-specific ([D2], section 8.1.3).

**Firmware rule:** The accepted rolling minimum is retained unchanged, including zero. At or
below 1.0 bar produces **NOTE**; at least 60 continuously observed seconds at that level produces
**WARNING**. Confirmation requires readable endpoints and does not rewrite the minimum. The API
publishes the observed-at timestamp only with synchronized wall time, current pressure only when
the last fresh sample supplied it, and a separate confirmed-low flag. A reassuring result requires
a full day and 90% readable pressure time. See CHECKUP_BAR_WARN_TENTHS and
CHECKUP_PRESSURE_CONFIRM_S in [checkup.hpp](../main/logic/checkup.hpp).

**Project boundary:** The one-minute confirmation is a project filter. The firmware's common
1.0-bar threshold is a project diagnostic boundary, not every model's filling specification.

**Not established:** A stored low or zero value does not identify water loss, air or an expansion-
vessel problem. Its timestamp retains neither the raw frame nor the then-current validity context,
and decoding acceptance does not establish sensor accuracy. A current normal reading cannot erase
an earlier low observation or explain its cause.

<a id="diagnosis-flow"></a>
### 6. Lowest water flow (`flow`)

**External evidence:** Minimum water flow is model-specific. [D1] states `12 l/min` and fault 7H for
the listed Altherma 3 R W units (sections 6.4.3, 9.4.1, and 12.4). An Altherma 3 H HT F manual states
`25 l/min` or `22 l/min`, depending on the variant ([D2], section 8.1.3). One firmware-wide good/bad
limit would therefore be incorrect.

**Firmware rule:** The row reports the lowest accepted flow after the internal pump ran
continuously for at least 60 seconds. It assigns no good/bad assessment. See CHECKUP_FLOW_RUNUP_S
and the Flow branch in [checkup.hpp](../main/logic/checkup.hpp).

**Project boundary:** Sixty seconds is a pump run-up filter, not a manufacturer limit. The filter
does not establish part load or exclude later valve movements.

**Not established:** The minimum has no retained operating-mode context and is not a design-flow
measurement. It cannot be compared generally with a model manual's commissioning minimum or
identify a hydraulic restriction.

<a id="diagnosis-heater"></a>
### 7. Electric backup and booster heaters (`heater`)

**External evidence:** Daikin documents several legitimate reasons for heater operation. Depending
on configuration, the booster heater can support domestic-hot-water preparation, disinfection, or
operation outside the heat pump's operating range. Backup and/or booster heaters can carry load in
emergency operation after a heat-pump failure ([D1], sections 8.4.6 and 8.4.9, printed pages 66 and
71–72). The manual also requires sufficient water flow during backup-heater and defrost operation
([D1], section 9.3).

**Firmware rule:** The diagnosis separately totals observed active seconds for electric backup
heater (BUH) steps in the water circuit and the tank booster heater (BSH). Usable runtime evidence
is published immediately as **MEASURED**, without waiting for 24 hours. A zero applies only to
readable observed intervals; unsupported or unreadable inputs remain null. Proving BUH off requires
every profile-provided step to be readable; either readable active step proves on. See the Heater
branch in [checkup.hpp](../main/logic/checkup.hpp).

**Not established:** Runtime alone establishes neither energy consumed, unnecessary use nor a
defect. Electrical power, delivered heat and the controller's operating reason are not supplied by
this counter.

<a id="diagnosis-retries"></a>
### 8. Protection-limit counter changes (`retries`)

**External evidence:** The project register map contains five separate X10A counters for discharge
temperature, compressor inverter current, high pressure, low pressure, and inverter-fin temperature
([register 0x10](REGISTERS.md#register-0x10)). Daikin documents related fault and protection classes,
including high pressure, compressor overheating, and inverter overcurrent, in its error-code table
([D1], section 12.4).

**Firmware rule:** The same exact counter must increase between comparable readable endpoints.
All profile-declared counters and the compressor state must be readable at both endpoints. A
non-zero startup value is a baseline; a decrease invalidates the comparison. A usable comparison
without an increase displays **TENTATIVE**; a comparable increase displays **NOTE**. Both retain
experimental evidence and appear without a day-long wait. The retained event flag does not identify
which counter increased or when. See checkup_retry_index(),
CHECKUP_RETRY_COUNT and the Retries branch in [checkup.hpp](../main/logic/checkup.hpp).

**Experimental boundary:** Public Daikin documentation does not establish complete semantics for
the five X10A counters: reset/wrap behaviour, guaranteed event counting and causal assignment are
unknown. No manufacturer threshold or health verdict is derived from their values.

**Not established:** An increase is not a specific fault, and no observed increase does not prove
that protection limiting never occurred. Individual events, operating causes and limiting intensity
cannot be reconstructed from the retained flag.

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
  [official PDF][D2-pdf]. Sections used: 8.1.1 water-circuit requirements and 8.1.3 volume/flow;
  minimum pressure 1 bar and
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
[D1-pdf]: https://my.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EHBH-D6V%2C%20EHBH-D9W%2C%20EHBX-D6V%2C%20EHBX-D9W%2C%20ERGA04-08DV%2C%20ERGA04-08DVA_4PEN496758-1B_2019_10_Installer%20reference%20guide_English.pdf
[D2-pdf]: https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-high-temperature/epra14-18dw7/EPRA014-018D%28V.W%29.EPRA14-18D%28V.W%297.ETVH16UE6V%287%29_Installer%20reference%20guide_4PEN644738-1D_English.pdf
[E1-web]: https://eur-lex.europa.eu/eli/reg/2013/814/oj/eng
[R1-web]: https://www.gov.uk/government/publications/heat-pump-performance-effects-of-cycling
[R1-pdf]: https://assets.publishing.service.gov.uk/media/5a78e0d9e5274a2acd18a7c6/7389-effects-cycling-heat-pump-performance.pdf
[R2-doi]: https://doi.org/10.1016/j.applthermaleng.2009.01.003
