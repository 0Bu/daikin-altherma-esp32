# Plant diagnostics in plain language

<!-- user-docs-contract: 171ec0c6178d299811afc3b3deb5ec02b230f4725a0bafcb6203e346f8ee09f9 -->

Plant diagnostics **reads measurements and counts events; it does not control the heat pump**.
It is off by default (`Off`). Under **Settings → Firmware**, choose **X10A** or **Modbus** for
**Plant diagnostics** to start an evidence window: the firmware records X10A and HomeHub Modbus into
separate 24 h histories, while the setting selects which source the card displays (when only one
source is available, only that option and **Off** are shown). Switching between **X10A** and
**Modbus** keeps both histories; choosing **Off** pauses recording while keeping already collected
24 h diagnostic histories (which continue aging out normally after 24 hours), stops additional
room, forecast and circulation collection, and hides the Diagnostics name and card (Model becomes
the default card when available). Re-enabling resumes into the preserved 24 h window without
bridging the paused interval or carrying an unfinished run/candidate across pausing.
In **Modbus** mode, X10A-only checks (`defrost`, `pressure`, `retries`, `flow` on `Altherma4`,
`Probing`, or `Fallback` sweeps, and passive **Refrigerant (heating)**) are unavailable and omitted
from the card.

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
| **NO WINDOW** | The current tank-cooling window spans a full day without a completed hour. Recorded exclusions appear in the details when available. |
| **MEASURED** | A measurement or event population without enough evidence for a good/bad assessment. |
| **TENTATIVE** | An experimental counter comparison whose complete manufacturer semantics are unknown. |
| **N/A** | The active profile does not supply the required signals. |
| **No data** | The current diagnosis snapshot could not be read. |

A reassuring day-based result needs both the full 24-hour span and at least 90% usable coverage
of its own signals. Current fault state is separate. Missing or stale data on the active source
cannot establish a
current all-clear; retained observations can still explain an earlier finding. Firmware pauses and
timeouts reduce evidence without pretending that the profile no longer has the sensor.

Completed hours can return after a restart only from compatible dated flash records and current
source confirmation. A software restart, such as an update or a settings save that restarts the
board, also tries to save the open hour. It cannot when that hour shares its clock hour with the
previous saved hour. Other open and unsaved hours may be lost. Hourly evidence ages out even when
polling stops. See the [retention rules](ARCHITECTURE.md#history-and-diagnosis-persistence).
Changed source identity, an incompatible saved-hour format or a changed measurement definition
starts fresh hourly collection for that source, including
tank-cooling results. Changing the independent circulation witness clears only tank-cooling
evidence, while switching between X10A and Modbus keeps both histories intact. Trend history and the handoff for an unfinished tank-cooling window have their own
compatibility rules.
See [PLANT.md](PLANT.md#reboot-and-persistence).

These are passive ordinary-operation observations. Five-minute trends cannot reconstruct complete
compressor runs or quiet tank hours, and a day of observations is not a controlled commissioning test.
[DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md) separates external facts from project rules;
[REPORTING.md](REPORTING.md) describes available reports.

## What is checked?

<!-- user-docs: health_fault -->
### Unit-reported faults

**In plain language:** The board records supported heat-pump fault, warning and caution states at
second resolution across a rolling 24-hour timeline, together with each episode's fault code, unit
origin when reported, start time, stop status and duration. When no active or recent fault is
present, the collapsed row stays quiet; when an active or past fault is retained, the collapsed
row shows its code with active duration or time since clearing (`Unknown` when stale, falling back to status text without a code). Expanding the row shows
a hero summary of the latest episode, the 24-hour categorical pill bar (fault-free time in grey,
unmeasured intervals hatched, and distinct colors per fault code), filter chips and a newest-first
episode table revealed when you tap a chip or nearby bar segment.

**Meaning:** A current fault produces **WARNING**. Active warnings/cautions and earlier retained
episodes produce **NOTE**. If current fault rows are unreadable, the board cannot establish that an
earlier fault has cleared.

**Important limit:** Showing error and warning codes covers only what the heat pump exposes; short
descriptions are general Daikin hints, and a cleared code does not prove the underlying cause was
fixed. No generic normal target is shown for faults.

**Evidence and limits:** [Unit-reported faults](DIAGNOSTIC_EVIDENCE.md#diagnosis-fault)

<!-- user-docs: health_dhw_loss -->
### Domestic-hot-water tank cooling

**In plain language:** The expanded row shows the largest measured hourly drop at tank sensor
R5T in **°C per hour**, equivalent to the **K/h** shown in the row and chart. If an exact
measurement has the same rate, the card shows the most recent matching hour and its circumstances.
Internal pump activity and a rapid drop can occur in the same hour. The cause remains open.

Open **24-hour history** and tap an hour for its time range, rate, readable time, and circumstances.
Separate lanes mark internal pump activity and drops that resemble hot-water use. The optional
external circulation uses a separate witness. Hatching shows time without a completed timed
record. A measured zero has a short bar at the baseline.

Saved bars can return after a restart once the clock synchronizes and the board confirms the
same source and circulation configuration. Bar counts and diagnosis totals can differ because
they use separate stores and expiry rules. The chart uses relative times when a reliable clock
reading is unavailable. Historical bars do not establish that current inputs are fresh.
**Data details** explains the measurement basis and marker limits.

**Meaning:** **NOTE** needs at least one window at or above the project's **0.8 K/h** threshold
without either marker. Other completed windows are **MEASURED**, including marked high rates.
Without a completed window the board shows **CHECKING**, progress or settling time. After the
current tank-cooling observation window spans a full day without a completed hour, it says
**NO WINDOW**, even if no candidate could open. That describes missing measurements, not a tank
defect or complete signal coverage.

**Energy example:** When a maximum is available, **Calculation example** assumes uniformly cooling **200 l** of
water. At **1.2 K/h**, this means about **0.28 kWh of heat per hour**. Replacing it at an assumed COP
(heat delivered per unit of electricity) of **2.5–3** would need **0.09–0.11 kWh of electricity**.
The example follows the displayed maximum; it is not measured consumption or a daily sum.

**Important limit:** One sensor in a stratified tank cannot measure whole-tank loss. Water use can
remove useful heat; zero net cooling does not prove zero loss. Neither a missing draw marker nor
a valve command proves an undisturbed tank, and circulation overlap proves no cause. Charging,
settling, invalid temperatures and missing readings can exclude windows; blank chart time does not
identify which occurred. A compatible software restart can preserve the settling timer, but unseen
charging can still affect a later window.

**Evidence and limits:** [Tank cooling](DIAGNOSTIC_EVIDENCE.md#diagnosis-dhw-loss)

<!-- user-docs: health_cycling -->
### Compressor cycling

**In plain language:** The total counts observed starts. Separate rows show completed runs by
purpose, the average length for heating and hot water when available, and how many timed heating
runs lasted under 5 minutes. A change of purpose or missing readings can leave a run unclear.

There is no fixed normal number of starts. With enough data, the check considers completed heating
runs averaging at least 10 minutes long enough. The average uses heating runs only.
The card can still show starts while it waits for more readings or more identifiable heating runs.

Each step in the rolling 24-hour chart marks when the compressor was first seen running after it
was seen off. The diagnosis total uses hourly counts and can include starts with no known
time. When the total includes saved hourly counts from before a restart, the explanation shows
how many came from those hours.

The caption counts the starts with a recorded time across the chart. Each block shows the count
for its hour (highlighted when at least two timed heating runs under 10 minutes started there). The
`≥` sign means at least that many starts. A blank count marks an hour with unavailable data and no
timed start. Colors show Heating, Hot water and Unknown stacked proportionally from bottom to top by
active or missing duration in that hour. Gray covers unassigned runtime and missing readings. An hour
observed entirely at rest has no color. Breaks in the line mark missing readings.
A readable update from the same source can retain the open chart and mark time after its last
sample as Unknown.
An unreadable diagnosis shows **No data** and hides the chart. If the status request itself fails,
the chart can stay at the last successful update. The list then shows the stop and duration as
unknown for any run that was still open.

Tap an hourly block, Shift-click, or drag across blocks to select an hour or contiguous multi-hour
period. When per-run X10A context from the current boot is available, the latest short-cycling
episode (or the latest recorded hour with start/stop details when no episode is present)
auto-selects when opened and the list shows Start, Duration and why the run stopped alongside
a one-sentence period summary; tapping a row expands its observed start and stop temperatures, target
changes and flow rate. When per-run context is unavailable (for example before or right after a
restart or on Modbus), the list falls back to Start, Stop and Duration, and notes on X10A runs from
before the restart that start and stop details are recorded only from the last restart onward.
If a recent reading still shows the run in progress, the list gives the elapsed time through
that reading. A brief single-poll interruption within the same boot (up to 15 seconds) keeps the
run continuous, whereas a longer gap or restart interrupts it and leaves its stop and total duration
unknown.

The chart can restore saved readings and run times after a restart, including a firmware update.
The board adds new measurements as polling resumes and shows the downtime as a gap. When the
timed chart is unavailable, the entire chart can show hourly totals with proportional mode bars. Tap
a bar in that view to see its recorded time, runtime and coverage where available.
A just-opened hour has no fill until time has elapsed. An hourly-total bar with zero starts
has no count label.

**Evidence and limits:** [Compressor cycling](DIAGNOSTIC_EVIDENCE.md#diagnosis-cycling)

<!-- user-docs: health_defrost -->
### Defrost events

**In plain language:** The board counts observed defrost starts and the seconds spent defrosting
while the compressor ran and both signals were readable.
The detail can show the last start observed this boot, with the heating or hot-water route and
outdoor air temperature when they were readable and qualified. Missing details remain unknown.
This start detail expires after 24 hours; pausing diagnostics (`Off`) hides the card and does
not carry a start transition across the pause. When a factory reset starts forgetting history,
the board hides the detail for the rest of that boot, including if erasure fails.

**Meaning:** At least **three paired events** and more than **15%** defrost share produce **NOTE**.
Both are project heuristics. Fewer events or no paired compressor runtime remain **MEASURED**;
no readable defrost observation remains **CHECKING**.
A reassuring assessment additionally needs a full day and 90% paired signal coverage.

**Important limit:** Temperature, humidity and coil icing affect normal defrost needs. These signals
do not establish blocked airflow, refrigerant shortage or a sensor defect. Outdoor min/mean and the
separate live de-icer temperature provide context, without changing the rule; geothermal two-phase
sensors are not treated as an outdoor air coil, and coil temperature spread or post-defrost recovery
are not evaluated.
The route describes the mode and valve signal reported by the controller. Physical valve position,
water flow and tank charging require separate evidence.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Water pressure

**In plain language:** The card plots the 24-hour X10A water-pressure history using 5-minute
minimums, alongside the live pressure when fresh or the confirmed Low / Critical state.

**Meaning:** Readings above **1.0 bar** are shown as normal. At least **60 continuously observed
seconds** at or below **1.0 bar** (`0.6–1.0 bar`) produce **NOTE** (*Low*), and at least
**60 continuously observed seconds** at or below **0.5 bar** produce **WARNING** (*Critical*).
Single unconfirmed dips do not trigger a diagnosis verdict, and all-zero uninitialized hydronic
frames are withheld before caching, history, and diagnosis.

**Important limit:** The **1.0 bar** and **0.5 bar** bands and 60-second confirmation are project
diagnostic rules, not universal filling specifications; permitted pressure depends on the exact
Daikin manual and building height. A confirmed low or zero reading does not by itself identify water
loss, air, or a faulty sensor, and a later normal pressure does not erase an earlier confirmed drop
within the 24-hour window.

**Evidence and limits:** [Lowest water pressure](DIAGNOSTIC_EVIDENCE.md#diagnosis-pressure)

<!-- user-docs: health_flow -->
### Lowest water flow

**In plain language:** The board reports the lowest accepted flow after the internal pump has run
continuously for at least sixty seconds. Separately, readings taken after ten minutes of eligible
heating summarize water-temperature spread, flow and commanded pump effort.

**Meaning:** **MEASURED**. The two observations have separate coverage: minimum flow filters
pump-off and initial run-up values without retaining the operating mode, while the heating
statistics show when their readings were collected and how many qualified, remain visible during a
link interruption, and keep water ranges available when optional pump command is missing. With fresh
readings from a supported mixed heating circuit, the same row can show the average difference
between the heat-pump supply and the mixed supply, how long they were compared and how many
readings qualified. A negative difference means the measured mixed supply was warmer. The current
shipped X10A profiles leave this comparison empty because each lacks at least one required reading.
When operating solely over Modbus, `flow` stays unavailable on `Altherma4`, `Probing`, or `Fallback`
sweeps until `/100` HomeHub Input 49 scaling is affirmatively confirmed, and X10A hydronic
spread/flow/command ranges and secondary comparison remain unpopulated.

**Important limit:** Required flow differs by model, heating, cooling, DHW and defrost conditions.
The minimum does not identify the operating mode or tell you the design flow. The spread concerns
the heat exchanger's water circuit, the pump percentage reports the controller command, and these
readings do not measure room emitters, pump speed, or available head. The ten-minute filter does
not establish steady operation or diagnose a bypass or restriction, and the controller's target
spread is unavailable. The optional comparison leaves the reason for mixing open, and estimating
heat loss requires more measurements.

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

Enable **Plant diagnostics** (`X10A`) under **Settings → Firmware** and open **Diagnostics** to see
this expandable row (the row is X10A-only and hidden when the card displays **Modbus**). The
observation itself collects ordinary read-only X10A traffic independently of that setting and works
without a service mode. The row and its API object need a detected profile with evaluated signal
coverage in the current boot. The observation sits outside `/status.health` and leaves the eight-row
summary unchanged.

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

Each range shows how many readings contributed. A pressure input that was unreadable during part
of the window can have fewer readings than the total number of sweeps. These counts describe the
sample population. The range stays unavailable when zero readings qualified. The X10A input shown
in the API is the profile's selected source, which can be unreadable and needs independent
physical validation.

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

The **Outdoor temperature ranges** detail groups recorded room errors by the outdoor reading.
The two outdoor sensors have separate results. The count and range give context for the average.
A small average can include readings from times when the room was too cold or too warm. [Heating-curve
observations](PLANT.md#heating-curve-diagnosis) describes the window and when it resets.

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
