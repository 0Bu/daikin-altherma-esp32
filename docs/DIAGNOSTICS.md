# Plant diagnostics in plain language

<!-- user-docs-contract: a23dcc265a7bcf148b25124dea6b4adb8eda048d56f8c20c0a37717b05e1affb -->

Plant diagnostics **reads measurements and counts events; it does not control the heat pump**.
It is off by default. Enable **Plant diagnostics** under **Settings → Firmware** to start an evidence
window. Disabling clears this evidence and stops additional room, forecast and circulation collection.

The **Plant diagnostics · 24 h** card appears below the schematic. Open a row for its observation,
meaning and limits. A rolling day does not imply that every signal was readable throughout it.
The summary shows the highest finding severity and the number of affected rows. Without a finding,
it distinguishes ongoing collection, measurements and completed assessments. It is not a score for
the installation's health.

## What the statuses mean

| Status | Meaning for this check |
|---|---|
| **OK** | The supported assessment found no notable pattern with the required evidence. It does not certify the installation. |
| **NOTE** | A notable accepted observation or unit-reported warning; it does not identify a defect or cause. |
| **WARNING** | A current unit-reported fault, or pressure confirmed continuously at or below the project's boundary during the window. |
| **CHECKING** | A required day, signal coverage or eligible observation is missing. The detail names what is missing. |
| **MEASURED** | A measurement or event population without enough evidence for a good/bad assessment. |
| **TENTATIVE** | An experimental counter comparison whose complete manufacturer semantics are unknown. |
| **N/A** | The active profile does not supply the required signals. |

A reassuring day-based result needs both the full 24-hour span and at least 90% usable coverage
of its own signals. Current fault state is separate. Missing or stale X10A data cannot establish a
current all-clear; retained observations can still explain an earlier finding. Firmware pauses and
timeouts reduce evidence without pretending that the profile no longer has the sensor.

Completed hours can return after a restart only from compatible dated flash records and current
source confirmation. Open and unsaved hours may be lost. Whole hourly records expire when their
beginning leaves the rolling day, even if polling stops. Changed X10A identity or incompatible
diagnosis format starts fresh collection; changing the independent circulation witness clears only
tank-cooling evidence.
The current format cannot reuse older diagnosis intervals or restart handoffs; trend history has
a separate compatibility contract. See [PLANT.md](PLANT.md#reboot-and-persistence).

These are passive ordinary-operation observations. Five-minute trends cannot reconstruct complete
compressor runs or quiet tank hours, and a day of observations is not a controlled commissioning test.
[DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md) separates external facts from project rules;
[REPORTING.md](REPORTING.md) describes available reports.

## What is checked?

<!-- user-docs: health_fault -->
### Unit-reported faults

**In plain language:** The board reads the heat pump's supported fault, warning and caution classes.
An earlier reported event remains visible for up to 24 hours.

**Meaning:** A current fault produces **WARNING**. A past event remains a **NOTE**. If the current
rows are unreadable, the board cannot establish that an earlier fault has cleared.

**Important limit:** No supported fault class reported is not proof that every component is healthy.
The observation establishes neither a cause nor why a message stopped appearing.

**Evidence and limits:** [Unit-reported faults](DIAGNOSTIC_EVIDENCE.md#diagnosis-fault)

<!-- user-docs: health_dhw_loss -->
### Domestic-hot-water tank cooling

**In plain language:** The board measures the temperature drop at tank sensor R5T during eligible
one-hour windows. It displays the largest completed-window cooling rate (rounded down to 0.1 K/h),
the completed window count and how many reached the project's **0.8 K/h** note threshold.

**Meaning:** At least one such window produces **NOTE**. Other completed windows are **MEASURED**;
no eligible window means **CHECKING**; "no eligible window in 24 h" needs a full day of tank-cooling
evidence since collection started or the circulation witness changed. There is no green tank-loss result. An optional
circulation-power witness shows how many notable windows overlapped electrical pump operation or
had a sufficiently observed pump-off state.

**Important limit:** Charging, pump activity, apparent draws and missing readings exclude time. Fast
continuous cooling above about **1.85 K/h** can resemble a draw and be excluded too. One sensor
in a stratified tank does not measure whole-tank heat or electricity loss, and pump overlap does not
prove a cause. After a charge seen for at least two minutes, or a fresh start (power-up, reset,
consent or circulation change), the check waits 45 minutes before a window; unread valve or heater
readings extend that wait. A charge no reading saw can still affect a window.

**Evidence and limits:** [Tank cooling](DIAGNOSTIC_EVIDENCE.md#diagnosis-dhw-loss)

<!-- user-docs: health_cycling -->
### Compressor cycling

**In plain language:** The board counts starts and completed compressor runs. Continuous valve and
mode readings separate space heating, domestic hot water (DHW) and cooling; uncertain or mixed runs
remain unclassified.

**Meaning:** At least **12 completed space-heating runs**, with at least **90% of all completed runs
classified**, can carry the assessment. An average below **10 minutes** produces **NOTE** as soon as
this population exists. **OK** additionally needs a full day and 90% readable classification time.
Smaller or insufficiently classified populations are **MEASURED**, with the reason shown;
no usable compressor observation remains **CHECKING**.

**Important limit:** There is no pooled all-mode assessment, and an unfinished long run cannot dilute
completed short runs. Twelve runs and ten minutes are project heuristics, not Daikin limits. These
figures do not identify oversizing or hydraulic imbalance. Optional outdoor min/mean is context for
accepted heating runs only. A sweep that read nothing for up to 15 seconds inside a run (an update
check, a weather download or a silent bus) keeps its class; a start hidden by an unreadable reading counts as an unclassified run.
After a restart, restored hours can lack the completion of a run that crossed an hour boundary, so
the result stays **MEASURED** until those hours leave the window. If the compressor stops during a
defrost, one heating run counts as several; whether it does has not been checked yet.

**Evidence and limits:** [Compressor cycling](DIAGNOSTIC_EVIDENCE.md#diagnosis-cycling)

<!-- user-docs: health_defrost -->
### Defrost events

**In plain language:** The board counts observed defrost starts and the seconds spent defrosting
while the compressor ran and both signals were readable.

**Meaning:** At least **three paired events** and more than **15%** defrost share produce **NOTE**.
Both are project heuristics. Fewer events or no paired compressor runtime remain **MEASURED**;
no readable defrost observation remains **CHECKING**.
A reassuring assessment additionally needs a full day and 90% paired signal coverage.

**Important limit:** Temperature, humidity and coil icing affect normal defrost needs. These signals
do not establish blocked airflow, refrigerant shortage or a sensor defect. Outdoor min/mean and the
separate live de-icer temperature provide context, without changing the rule.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Lowest water pressure

**In plain language:** The board reports the lowest accepted pressure, its time when the clock was
synchronized, and the current pressure if the latest observation supplied it.

**Meaning:** An accepted minimum at or below **1.0 bar** produces **NOTE**. At least **60 continuously
observed seconds** at or below that boundary produce **WARNING**. This is a common project boundary and filter,
not the complete permitted range for every Daikin model.

**Important limit:** A stored zero remains an accepted reading requiring interpretation; it is not
converted into missing data or proof of water loss. The stored timestamp does not retain the raw
frame or establish sensor accuracy. Current pressure is absent when unreadable or stale; a current
normal value does not erase an earlier low reading.

**Evidence and limits:** [Lowest water pressure](DIAGNOSTIC_EVIDENCE.md#diagnosis-pressure)

<!-- user-docs: health_flow -->
### Lowest water flow

**In plain language:** The board reports the lowest accepted flow after the internal pump has run
continuously for at least sixty seconds.

**Meaning:** The result is **MEASURED**. It filters pump-off and initial run-up values; it does
not establish part load or retain the operating mode of the minimum.

**Important limit:** Required flow differs by model, heating, cooling, DHW and defrost conditions.
The minimum is not a design-flow measurement or a diagnosis of restricted flow.

**Evidence and limits:** [Lowest water flow](DIAGNOSTIC_EVIDENCE.md#diagnosis-flow)

<!-- user-docs: health_heater -->
### Electric backup and booster heaters

**In plain language:** The board separately counts observed active seconds for the water-circuit
electric backup heater (**BUH**) and tank electric booster heater (**BSH**).

**Meaning:** **MEASURED** appears as soon as there is readable runtime evidence; it does not
wait for a full day. A reported zero applies only to the observed intervals. A missing heater signal
remains absent, rather than being counted as off.

**Important limit:** Runtime does not establish electricity consumed, necessity or a defect.
Controller settings, weather and operating schedules can make this activity intentional.

**Evidence and limits:** [Electric heaters](DIAGNOSTIC_EVIDENCE.md#diagnosis-heater)

<!-- user-docs: health_retries -->
### Protection-limit counter changes

**In plain language:** The board compares five internal counters at consecutive readable endpoints,
with a known compressor state. Only a comparable increase counts as an observed event.

**Meaning:** A usable comparison without an increase shows **TENTATIVE**; a comparable increase
shows **NOTE**. Both retain experimental evidence and appear without a full-day wait. A non-zero
startup value is a baseline, and a decrease has no established reset or wrap interpretation.

**Important limit:** An increase does not identify a fault; no observed increase does not prove that
protection limiting never occurred. The retained event flag cannot reconstruct individual counter
changes or their cause.

**Evidence and limits:** [Protection-limit changes](DIAGNOSTIC_EVIDENCE.md#diagnosis-retries)

<a id="refrigerant-service-observation"></a>
## Refrigerant when heating

This expandable row is technical context, **not a ninth health diagnosis**. It watches existing
read-only X10A traffic automatically without Plant diagnostics opt-in or a service mode. Until this
boot detects a profile and evaluates its signal coverage—including safe mode—the row/status object
is absent. It does not affect `/status.health` or the eight-row summary.

A window admits only fresh same-sweep values with a running space-heating compressor, non-DHW valve,
no defrost, readable normal fault rows, no active profile-provided startup/restart/oil-return/pressure-
equalising phase, and required discharge-temperature, EEV-command and structurally identified
refrigerant-pressure readings. Cooling is excluded because the pressure-side roles here are
established for heating. Optional missing comparison data remains an explicit limitation.

| Row status | Meaning |
|---|---|
| **N/A** | The detected profile lacks a required signal. |
| **WAITING** | No suitable ordinary heating run now; recording starts automatically when conditions fit. |
| **RECORDING** | Continuous fresh observation with the complete optional context. |
| **PARTIAL** | Recording, with optional temperature/pressure-side/outdoor/controller-phase context missing at least once. |
| **PAUSED** | A required reading/condition, expected sequence or profile-declared phase witness ended continuity. The next suitable run begins at zero. |

Duration and min/mean/max describe **one uninterrupted window**. The permitted poll gap depends on
profile pages and transport timeout; there is no universal three-second/twenty-minute service rule.
Source-generation changes also reset continuity.

**Important limit:** It assigns no normal range, refrigerant-charge verdict, full-load state or
settling claim. EEV pulses are a controller command, not proof of mechanical valve movement.
A controlled refrigerant test still requires the exact model's service procedure and suitable
instruments.

**Evidence and limits:** [Refrigerant circuit observation](DIAGNOSTIC_EVIDENCE.md#refrigerant-service-observation)

## What the diagnosis cannot do

The card cannot establish refrigerant charge, hydraulic balancing, mechanical wear, the cause of
every consumption period, seasonal efficiency or every sensor/valve's condition. A passive day of
history cannot become a stationary full-load service test. **OK always refers to one bounded check,
never to a guaranteed fault-free installation.**

## Plain-language glossary

| Term | Meaning |
|---|---|
| Compressor | Raises refrigerant pressure and moves heat to a useful temperature level. |
| Space heating | Heat delivered to radiators or underfloor heating. |
| Domestic hot water (DHW) | Tap/shower water stored in the tank. |
| Defrost | A short operating reversal removing outdoor-unit ice. |
| Three-way valve | Directs heating water to the building or DHW tank. |
| BUH | Electric backup heater for the water circuit. |
| BSH | Electric booster heater in the DHW tank. |
| X10A | The service interface read by the ESP32 without controlling the heat pump. |
