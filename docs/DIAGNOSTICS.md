# Plant diagnostics in plain language

<!-- user-docs-contract: a9597ef0ee6218516dc3d583e43b7fd23f6bba47c8b6254b81d02524a8549ed8 -->

Plant diagnostics **reads measurements and counts events; it does not control the heat pump**.
It is off by default (`Off`). Under **Settings → Firmware**, choose **X10A** or **Modbus** for
**Plant diagnostics** to start an evidence window. The firmware records X10A and HomeHub Modbus
into separate 24 h histories. The selector shows the active source. A configured Modbus gateway
can stay active even while it is offline. With a gateway configured, X10A can be selected while it
is connected, has answered within 30 seconds, or still has recorded diagnostic data. If both sources
can be selected, the card uses your saved choice. With no gateway configured, it uses X10A.
Switching between **X10A** and **Modbus** keeps both histories. Choosing **Off** pauses diagnostics
and circulation recording and hides the Diagnostics card. The Model card becomes the default when
available. Existing data ages out as usual. Re-enabling resumes the same 24 h history and starts
any new run or candidate after the pause.
In **Modbus** mode, X10A-only checks (`defrost`, `pressure`, `retries`, and passive
**Refrigerant (heating)**) are unavailable and omitted from the card, while **Performance factor**
switches to the independent affirmatively confirmed HomeHub (`EKRHH`) Modbus window (or shows
**Not supported** on `Altherma4`, `Probing`, or `Fallback` sweeps).

Select **Diagnostics** below the schematic to show the **Plant diagnostics · 24 h** card.
Open a row to see what was measured and what the result means. The lowest water flow appears
in the schematic's **Flow rate** inspector. Observation windows can include gaps.
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
period. When per-run X10A details are available, the latest short-cycling
episode (or the latest recorded hour with start/stop details when no episode is present)
auto-selects when opened. The list shows **Start**, **Duration** and **Why it stopped**, with a short
summary of the period. The stop column describes observed clues. Tap a row with details to see
the recorded temperatures, target changes and flow rate. The board can
recover saved details for completed runs after a restart. When those details are missing, the
chart can still show times and durations. Older time records can lack details, and a sudden power
loss can leave recent runs unsaved.
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

**In plain language:** Open **Defrost** on the outdoor unit to see its current state and trend. Tap
the trend to read the selected interval and state below the chart. The chart shows observed
activity in five-minute blocks. With current X10A diagnostics, the two rows below it show observed
starts and the percentage of compressor running time spent defrosting while both states were
readable. **Normal** explains the percentage in the card. A dash marks a missing value when the
other is available. A current **NOTE** adds an amber warning triangle after the **Defrost** label.
Its entry in Plant diagnostics opens the same card.

The API can report the last start observed this boot,
including the heating or hot-water route and outdoor air temperature when qualified. This detail
expires after 24 hours. Pausing diagnostics (`Off`) clears the start transition across the pause.
When a factory reset starts forgetting history, the board hides the detail for the rest of that
boot, including if erasure fails.

**Meaning:** The displayed count includes all observed starts. A start qualifies for the assessment
when the compressor state is readable immediately before and at the start. The project rule
produces **NOTE** at **three or more qualifying starts** and more than **15%** defrost share.
With a readable defrost-state interval, fewer qualifying starts or no eligible runtime gives
**MEASURED**. Supported profiles start in **CHECKING** while a readable interval is missing.
A reassuring assessment requires a full day and 90% paired signal coverage. The inspector shows
measurements as they become available. Profiles without an X10A defrost signal have no assessment.

**Important limit:** Temperature, humidity and coil icing affect normal defrost needs. This assessment
cannot establish blocked airflow, refrigerant shortage or a sensor defect. The API's outdoor
minimum and mean and the separate live de-icer reading provide context. The assessment also leaves
coil temperature spread and post-defrost recovery open. Geothermal two-phase sensors are distinct
from outdoor air coils.
The route describes the mode and valve signal reported by the controller. Physical valve position,
water flow and tank charging require separate evidence.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Water pressure

**In plain language:** Open Water pressure on the schematic to see the current reading and the
24-hour chart of 5-minute minimums. The X10A finding follows any second-source pressure reading.
A confirmed Low or Critical finding includes its lowest reading and the observation time, when known.
A marker highlights the matching X10A sample when it can be identified in the chart. When the X10A
history and assessment are available, select a position in the chart to show the assessment criteria
directly below it. A red warning triangle after the Water pressure label signals a confirmed Critical
finding in the 24-hour window. An amber dot signals a current critical reading with the duration
still open.

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

**In plain language:** Open **Flow rate** in the schematic for its current reading and 24-hour
trend. The card can also show the lowest reading recorded after at least ten minutes of continuous
space heating. It uses X10A when an eligible minimum is available and otherwise uses a supported
HomeHub Modbus result. The label names the source of the reported minimum.

**Meaning:** Shading under the matching source's curve marks covered parts of recorded five-minute
windows containing the minimum. Select a shaded area or the legend to see the window below the chart.
Select the legend again to close the explanation. Reopening it shows the next window. The legend also
reaches windows inside gaps when the source has a visible reading elsewhere on the chart.
The summary at the bottom of the card can show the minimum even
if older X10A records lack a time. Modbus observations accumulate again after a restart.

With X10A active for Plant diagnostics, the inspector also shows water-temperature agreement
during settled pump-only circulation. It reports 24-hour ranges, qualified duration, episode
windows and reading counts for the difference between leaving water before the backup heater and
return water (`R1T−R4T`), and between water after and before the heater (`R2T−R1T`) when both
sensors are readable.
The pump must run at `>= 5.0 l/min` for at least `600 s` with the compressor, defrost and heaters
off and the 3-way valve unchanged. The readings of both sensors in a pair must drift by no more
than `0.5 K` over `300 s`.

**Important limit:** The required flow depends on the model and operating mode. Shading gives the
time window of a reading, with no claim about how long the flow stayed there. The `600 s`
settling, `300 s` / `0.5 K` drift, `5.0 l/min` flow, and `15 s` gap rules are project filters, not
published Daikin tolerances; passive agreement does not calibrate sensors, exclude external heat
sources or valve leakage, establish steady operation, or diagnose a bypass, restriction, or low
flow.

**Evidence and limits:** [Lowest water flow](DIAGNOSTIC_EVIDENCE.md#diagnosis-flow)

<!-- user-docs: health_heater -->
### Electric backup and booster heaters

**In plain language:** The board separately counts observed active seconds for the water-circuit
electric backup heater (**BUH**) and tank electric booster heater (**BSH**).

**Meaning:** **MEASURED** appears as soon as there is readable runtime evidence; it does not
wait for a full day. A reported zero applies only to the observed intervals. A missing heater signal
remains absent, rather than being counted as off.

When the card displays **X10A**, the expanded row also shows **reported heater flag context**
separately for each heater (hidden in **Modbus** mode). The table gives positive time, evaluable ON
time and positive samples for overlapping operating contexts. Unknown input stays unknown. A
context with zero positive samples is limited to its evaluated population; it is not an absence
finding for the whole day. The provisional Silent Mode + mild heating notice needs 15 minutes
(900 s) of qualified accumulated flag-time, not necessarily one continuous run.

**Important limit:** Runtime does not establish electricity consumed, necessity or a defect.
Controller settings, weather and operating schedules can make this activity intentional.
The contexts report co-occurrence, not a controller's reason, calibration, or bivalence. Samples can
miss intermediate changes. If stored records cannot be read or validated, totals are marked
incomplete. Previously validated totals may remain visible during the same boot; new live
observations remain separate. Reset, clock and incomplete-record safeguards are described in the
evidence.

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

<a id="working-figure-observation"></a>
## Performance factor

This expandable row is a rolling 24-hour energy observation inside the active diagnostics card,
**not a ninth verdict in `/status.health`**; it never changes the eight-row summary badge. It
requires Plant diagnostics opt-in and runs independently on either **X10A** or **HomeHub (EKRHH)
Modbus** (keeping separate 24-hour windows per bus without mixing them).

The firmware integrates useful **Heating + DHW** heat using pure water's specific heat capacity
(`4.186 kJ/(L·K)`) while excluding **Cooling** and passive pump-only standby circulation.
Water–glycol loops have roughly 6–8% lower heat capacity, so pure water slightly overstates heat
output on glycol systems. Signed temperature differences during active operation remain signed so
defrost heat withdrawal and valve transitions stay in the net balance. When tariffs are configured,
the observed working figure ($\text{AZ} = Q_{\text{th}} / E_{\text{el}}$) is compared against a
reference gas boiler's break-even ratio:

$$\text{AZ}_{\text{Break-Even}} = \frac{p_{\text{elec}}}{p_{\text{gas}}} \cdot \eta_{\text{Gas}}$$

Efficiency $\eta_{\text{Gas}}$ is fixed at `88%` on the gross calorific value ($H_s$) basis of a
modern condensing gas boiler (matching residential gas bills) alongside fixed pure water
(`4.186 kJ/(L·K)`), and only **variable per-kWh energy prices** enter the comparison (fixed annual
chimney sweep, meter rental and base standing charges are excluded). Updating tariffs or currency
recalculates costs and status across existing 24-hour buckets immediately without discarding
collected history.

| Row status | Meaning |
|---|---|
| **Collecting** | Fewer than 2 hours (`7200 s`) of valid paired observations have been collected on the active bus. The collapsed row stays blank while the expanded panel shows elapsed progress toward 2 hours. |
| **Standby** | At least 2 hours observed, but net heat is below `1.0 kWh` or electricity is below `0.2 kWh`. |
| **Partial** (*prov.*) | Energy thresholds met, while span is under 24 hours or usable coverage is below 90% (`77760 s`). |
| **Limited** (*lim.*) | Full 24-hour window reached, with tank booster (`BSH`) intervals excluded, mismatched backup-heater (`BUH`) electricity/heat boundaries on X10A, or a `> 1.5 K` post-BUH rise (`41 − 40`) during active flow on HomeHub Modbus. |
| **Measured** | Full unlimited 24-hour window without configured tariffs; shows heat, electricity and ratio without a cost verdict. |
| **Cheaper than gas** / **Like gas** / **Costlier than gas** | Full unlimited 24-hour window evaluated against break-even ratio with a uniform `±20%` neutral band across onboard X10A and HomeHub Modbus estimates. |
| **Not supported** | Active X10A profile lacks required flow, water-temperature, valve/mode or electrical-power signals (or CT clamps were detected unwired with no inverter-current fallback), or Modbus runs native `Altherma4`, `Probing`, or `Fallback` sweeps (whose Input `49` flow scaling is unverified). |

On **X10A**, electrical input comes either from X10A CT current sensors (`0x63/14–16`, `0.5 A` steps
assuming `~230 V`, whole-unit scope) or, when unavailable or latched unwired, X10A inverter primary
current (`0x21/0`, assuming `~230 V`, compressor-only scope gated by fresh compressor speed).
On **HomeHub (`EKRHH`) Modbus**, the firmware pairs plate-heat-exchanger leaving/return
temperatures (`LWT PHE 40 − RWT 42`) and water flow (`49` `/100`) with Input `51` electrical power
(whose measurement boundary and heater inclusion are left unspecified in Daikin's EKRHH guide),
compressor running (`31`), mode (`38`), 3-way valve (`37`), defrost (`35`), and outdoor air (`44`);
tank booster `BSH` (`32`) intervals are excluded, and a `> 1.5 K` post-BUH rise (`41 − 40`) flags the
window **Limited**.

**Important limit:** This observation uses uncalibrated flow, temperature and onboard electrical
estimates, does not account for glycol heat capacity, fixed utility charges or inverter power
factor, and is neither a seasonal JAZ/SCOP rating nor a billing meter.

**Evidence and limits:** [Performance factor observation](DIAGNOSTIC_EVIDENCE.md#working-figure-observation)

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
