# Plant diagnostics in plain language

<!-- user-docs-contract: dae27bf526e261cb3848b0f3b857c741a9bcf7d849707ab82e2f75bd2cd2b1cb -->

Plant diagnostics **reads measurements and counts events; it does not control the heat pump**.
It is off by default. Enable **Plant diagnostics** under **Settings → Firmware** to start an evidence
window. Disabling clears this evidence and stops additional room, forecast and circulation collection.
It also hides the Diagnostics name and card; Model becomes the default card when available.
Re-enabling starts fresh; an unfinished diagnosis update is not carried across the change.

Select **Diagnostics** below the schematic to show the **Plant diagnostics · 24 h** card.
Open a row to see what was measured and what the result means. The observation window describes
the readings and can include gaps.
The summary shows the highest finding severity and the number of affected rows. Without a finding,
it distinguishes ongoing collection, measurements and completed assessments. It is not a score for
the installation's health.

## What the statuses mean

| Status | Meaning for this check |
|---|---|
| **OK** | The supported assessment found no notable pattern with the required evidence. It does not certify the installation. |
| **NOTE** | A notable accepted observation or unit-reported warning; it does not identify a defect or cause. |
| **WARNING** | A current unit-reported fault, or pressure confirmed continuously at or below the project's boundary during the window. |
| **CHECKING** | A required day, signal coverage or eligible observation is missing. |
| **NO WINDOW** | A full day of tank-cooling evidence produced no completed hour; the detail names the exclusions. |
| **MEASURED** | A measurement or event population without enough evidence for a good/bad assessment. |
| **TENTATIVE** | An experimental counter comparison whose complete manufacturer semantics are unknown. |
| **N/A** | The active profile does not supply the required signals. |

A reassuring day-based result needs both the full 24-hour span and at least 90% usable coverage
of its own signals. Current fault state is separate. Missing or stale X10A data cannot establish a
current all-clear; retained observations can still explain an earlier finding. Firmware pauses and
timeouts reduce evidence without pretending that the profile no longer has the sensor.

Completed hours can return after a restart only from compatible dated flash records and current
source confirmation. A software restart, such as an update or a settings save that restarts the
board, also tries to save the open hour. It cannot when that hour shares its clock hour with the
previous saved hour. Other open and unsaved hours may be lost. Hourly evidence ages out even when
polling stops. See the [retention rules](ARCHITECTURE.md#history-and-diagnosis-persistence).
Changed X10A identity, an incompatible saved-hour format or a changed measurement definition
starts fresh hourly collection, including
tank-cooling results. Changing the independent circulation witness clears only tank-cooling
evidence. Trend history and the handoff for an unfinished tank-cooling window have their own
compatibility rules.
See [PLANT.md](PLANT.md#reboot-and-persistence).

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

**In plain language:** The board shows the largest net temperature drop at tank sensor R5T during
completed one-hour windows, in **K/h** (one kelvin of cooling equals one degree Celsius). It also
shows how many windows reached **0.8 K/h** and how many contained internal water-pump activity or
a draw-like drop. Those counts cover all windows and may overlap; they do not describe the maximum
window individually. Rapid continuous cooling remains visible even when it resembles water use;
endpoint confirmation rejects isolated jumps larger than 0.2 K. Smaller excursions can still
affect the rate and the project's note threshold. If the closing reading cannot be confirmed
within 30 seconds after the hour, that candidate is discarded instead of becoming a longer average.

**Meaning:** **NOTE** needs at least one window at or above the project's 0.8 K/h threshold without
either marker. Other completed windows are **MEASURED**, including marked high rates. Without a
completed window the board shows **CHECKING**, progress or settling time. After a full day of DHW
scope without a completed hour it says **NO WINDOW**, including when no candidate could open.
That describes missing measurements, not a tank defect or complete signal coverage.

**Energy example:** For an assumed uniformly cooling **200 l** tank, **1.2 K/h** corresponds to
about **0.28 kWh of heat per hour**. Replacing that heat at an assumed COP (heat delivered per
unit of electricity) of **2.5–3** would require **0.09–0.11 kWh of electricity**. The UI recalculates
this example from the displayed maximum; it is neither your measured consumption nor a daily sum.

**Important limit:** One sensor in a stratified tank cannot measure whole-tank loss. Water use can
remove useful heat; zero net cooling does not prove zero loss. Neither a missing draw marker nor
a valve command proves an undisturbed tank, and optional external circulation overlap proves no
cause. Charging, its 45-minute settle, a fresh filter's 45-minute hold, invalid temperatures and
excessive missing readings exclude time; unread charge witnesses extend the wait. A compatible
software restart preserves the remaining settling time, but unseen charging can still affect a window.

**Evidence and limits:** [Tank cooling](DIAGNOSTIC_EVIDENCE.md#diagnosis-dhw-loss)

<!-- user-docs: health_cycling -->
### Compressor cycling

**In plain language:** The total counts observed starts. Separate rows show completed runs by
purpose and the average length for heating and hot water when available. A change of purpose or
missing readings can leave a run unclear.

The assessment says whether completed heating runs were short or long enough on average in the
recorded window. It can wait for more readings or more heating runs. If the system cannot identify
heating runs, the card can show starts without a heating assessment. A start count needs compressor
readings.

In the 24-hour chart, the number above each bar shows the starts counted for that hour. The colored
segments show heating, hot water and other runtime. Hatching marks known gaps in the readings.
Select an hour for its time and durations. The `≥` sign means at least that many starts.

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

**In plain language:** The board reports the lowest accepted X10A flow after at least 60 seconds
covered by consecutive X10A pump-ON reports.

**Meaning:** The result is **MEASURED**. It filters pump-off and initial run-up values; it does
not establish part load or retain the operating mode of the minimum.

**Important limit:** The ON reports do not independently verify physical pump rotation. Required
flow differs by model and operating mode. The minimum is not a design-flow measurement or a
diagnosis of restricted flow.

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
## Refrigerant (heating)

This expandable row is technical context, **not a ninth health diagnosis**. It watches existing
read-only X10A traffic automatically without Plant diagnostics opt-in or a service mode. Until this
boot detects a profile and evaluates its signal coverage—including safe mode—the row/status object
is absent. It does not affect `/status.health` or the eight-row summary.

A window admits only fresh same-sweep values with a running space-heating compressor, non-DHW valve,
no defrost, readable normal fault rows, no active profile-provided startup/restart/oil-return/pressure-
equalising phase, and required discharge-temperature, EEV-command and structurally identified
refrigerant-pressure readings. Cooling is excluded because the available pressure-side evidence is
heating-specific. Optional missing comparison data remains an explicit limitation.

| Row status | Meaning |
|---|---|
| **N/A** | The detected profile lacks a required signal. A profile whose only structurally identified refrigerant-pressure reading has no established pressure side counts as lacking one. |
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

## Heating-curve evaluation freshness

**In plain language:** **Not evaluated recently** means the heating-curve check has not evaluated
its inputs recently enough to describe their current state. The last recorded event remains dated
evidence; the independent room source may still be fresh. This status identifies no broker, sensor
or plant fault. [PLANT.md](PLANT.md#heating-curve-diagnosis) owns its age and event rules;
[the evidence boundary](DIAGNOSTIC_EVIDENCE.md#heating-curve-evaluation-freshness) separates this
project rule from plant conclusions.

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
