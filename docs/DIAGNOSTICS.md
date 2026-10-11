# Plant diagnostics in plain language

<!-- user-docs-contract: a82282eb86cf82dde2f08478375478ed3944b93e895163e38cbc3d22893ddee7 -->

Plant diagnostics **reads measurements and counts events; it does not control the heat pump**.
It is off by default. Enable **Plant diagnostics** under **Settings → Firmware** to start a new
evidence window. Disabling clears the diagnosis and stops its additional room, forecast and
circulation collection; ordinary X10A/HomeHub and device telemetry stay independent.

The **Plant diagnostics · 24 h** card appears below the schematic. Open a row for its reading,
assessment and limitations. Its evidence does not necessarily identify a cause, so the card
prescribes no plant action. Its bounded steps are to note recurring cleared unit messages, check
X10A when fault rows are unreadable, compare pressure with the exact manual, and check wiring if
the hot-water check loses needed readings day after day. Every check links to
[DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md), which
separates manufacturer/research evidence from project heuristics and exact firmware rules.

## What the statuses mean

| Status | Meaning for this check |
|---|---|
| **OK** | Enough usable evidence, with nothing notable found. It does not certify the whole installation. |
| **NOTE** | A notable observation; it is not proof of a defect. |
| **WARNING** | A unit-reported fault or a sustained documented boundary violation. |
| **CHECKING** | More hours or usable measurements are needed; missing evidence is not reassurance. |
| **MEASURED ONLY** | A useful observation without a responsible universal good/bad limit. |
| **EXPERIMENTAL** | Signal semantics are not fully documented; treat the result as a lead. |
| **NOT AVAILABLE** | Required signals are unsupported or this operating sequence cannot supply reliable evidence. |

Most reassuring results require a full 24-hour lifecycle and at least 90% readable coverage of that
check's signals. Re-detection, changed X10A identity/pins or changed diagnosis-counter meaning starts
a new window. Every boot retires completed RAM diagnosis hours. Only compatible, dated journal
hours restore after clock synchronization and current-boot source confirmation; current readings
take precedence. Open hours and unsaved completed hours are missing. Without eligible records,
observation starts fresh. Restored evidence expires exactly 24 hours after its stored endpoint,
including between hourly updates. An explicit profile/link reset cancels pending restore for that
boot, even if the same profile is selected again.

An intentional restart can preserve the DHW quiet-hour candidate and settling timer through a
checked one-shot handoff. Power loss, crash, changed source or incompatible format cannot. Restart
plus startup through source confirmation counts as blind time: exceeding either two minutes of
continuous blindness or 10% of the hour including earlier gaps starts the candidate over. That restart
discard does not increment the discarded-hour count; later unread-data discards do. See
[PLANT.md](PLANT.md#reboot-and-persistence) for the exact handoff and restoration limits.

Five-minute trends are separate: they cannot reconstruct complete compressor runs or quiet tank
hours. This is passive ordinary-operation evidence, not a commissioning test or controlled
full-load refrigerant examination.

Browser trends/pinned points clear on source changes or deletion; older replies cannot restore
them. A reboot starts a new browser lifetime even if the device restores saved trends. Per-row
state ages are separate: normal poll cadence is observed, known update/forecast/memory pauses,
the resumed tail and adopted restart/startup time are blind. More than two minutes of blindness
through the returning sample starts a new age. The v4 format rejects older records, so an update
can restart ages without proving a plant-state change. The weather companion's two-hour window
is fixed at the last successful fetch until the next success.

## What is checked?

<!-- user-docs: health_fault -->
### Unit-reported faults

**In plain language:** The board remembers faults, warnings and cautions reported by the heat pump.
A cleared report can remain visible for up to 24 hours.

**Meaning:** This is the unit's own report, rather than a project inference from a temperature.

**Important limit:** A clear report does not establish that every component is fault-free.

**Evidence and limits:** [Unit-reported faults](DIAGNOSTIC_EVIDENCE.md#diagnosis-fault)

<!-- user-docs: health_dhw_loss -->
### Domestic-hot-water tank heat loss

**In plain language:** The board measures tank-sensor R5T cooling over complete quiet hours, excluding
charging and evident hot-water draws. The displayed K/h is the **greatest completed-hour drop**, not
an average. An optional circulation-power witness labels whether that pump was electrically operating
during a notable window; correlation does not prove that it caused the whole drop.

**Meaning:** A **NOTE** starts at **0.8 K/h**, a project heuristic from one installation, not a Daikin
limit. Tank volume and tank-to-room temperature difference affect the rate. A reassuring result needs
six clean hours in a full 24-hour lifecycle. The method can recognize notable clean-hour losses only
up to about **1.85 K/h**; faster continuous cooling can resemble a draw and discard the hour.

**Important limit:** **OK** excludes no faster loss outside that detection band. **NOT AVAILABLE**
after repeated discarded candidates cannot identify their dominant cause: charging, pump activity,
draws, unreadable data and continuous loss resembling a draw cannot be separated from the retained
totals. R5T measures one point in a stratified tank; rapid cooling proves neither a leaking three-way
valve nor poor insulation.

An unobserved charge, update or unexpected restart can lose the settling filter, making the next
hour look like fast loss; its first **NOTE is weaker evidence than a repeating NOTE**. Missing tank,
valve, heater or pump readings can come from bus timeouts or firmware pauses for OTA, weather,
network work, detection or restart. They do not by themselves prove faulty wiring.
Changing circulation topic, paths, maximum age, thresholds or confirmation time resets this check;
renaming it does not. **CHECKING** afterwards says nothing about the tank.

**The kWh illustration:** The expanded row assumes **200 litres of water cooling uniformly**:
`200 kg × 1.16 Wh/(kg·K) × displayed K = Wh`. At 1.6 K in one hour this is about **0.37 kWh of
thermal energy**. It is a size example, not a measured whole-tank loss; tank volume is not configured.

After the report actually spans 24 hours, the second line deliberately assigns the maximum rate to
**every clean window**. With 18 windows at an assumed 1.6 K/h maximum:
`18 h × 1.6 K/h × 200 kg × 1.16 Wh/(kg·K) = 6.68 kWh` thermal. Assuming DHW COP **2.5–3.0** gives
about **2.23–2.67 kWh** replacement electricity, or 6.68 kWh with direct electric heating at COP 1.
The actual per-window rates are not retained, R5T is not whole-tank calorimetry, and the other six
hours are outside the example. It establishes **neither actual daily loss nor daily consumption**.
The full-day illustration is withheld for an early partial report.

**Evidence and limits:** [Tank heat loss](DIAGNOSTIC_EVIDENCE.md#diagnosis-dhw-loss)

<!-- user-docs: health_cycling -->
### Compressor cycling

**In plain language:** The compressor moves heat to a useful temperature level. The board counts
starts and complete runs, separating space heating, DHW and cooling where continuous valve/mode
signals permit it. Only confirmed space-heating runs decide the classified short-run assessment.

**Meaning:** `17 starts · space 16 × 5 min · hot water 1 × 2 h` means sixteen complete heating runs
averaging five minutes plus one two-hour DHW run. “Cooling … excluded” is identified cooling outside
the heating assessment; “unclassified” means a mode change or gap prevented safe assignment.
A **NOTE** requires at least twelve assessed runs averaging under ten minutes and sufficient
complete-day evidence. A classified assessment needs at least **90% readable classification time**,
**12 classified complete runs** and **90% of complete runs classified**. Only heating runs then
decide the result. Otherwise all runs are pooled. These are project heuristics, not Daikin limits.

**Important limit:** Very short runs alone do not identify oversizing, hydraulic imbalance or another
cause. Where classified evidence is insufficient the documented pooled fallback can mask short heating
runs with DHW/cooling; the status states which population carried the verdict. Optional fresh
`X10A min … °C · mean … °C` describes accepted heating-run outdoor context only. It changes neither
the ten-minute rule nor the result, and an absent suffix never means 0 °C.

**Evidence and limits:** [Compressor cycling](DIAGNOSTIC_EVIDENCE.md#diagnosis-cycling)

<!-- user-docs: health_defrost -->
### Defrost events

**In plain language:** In suitable cold, humid conditions the outdoor heat exchanger ices up and the
heat pump briefly defrosts it. The board counts events and their share of compressor runtime during
which both signals were readable.

**Meaning:** At least three assessable events and more than **15%** paired defrost runtime produces a
**NOTE**. Both numbers are project heuristics, not Daikin limits.

**Important limit:** X10A does not supply outdoor humidity or the whole coil's surface/ice state.
Frequent defrost can be normal; this row establishes neither low refrigerant nor blocked airflow.
Optional fresh X10A outdoor min/mean is context only. Live **R4T de-icer** temperature is also context,
with model-specific placement; it does not enter this 24-hour population or verdict.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Lowest water pressure

**In plain language:** The row reports the lowest valid water pressure in the observed window.

**Meaning:** At or below **1.0 bar** gives a **NOTE**; sixty uninterrupted seconds at that level gives a
**WARNING**. The transient confirmation is a project filter.

**Important limit:** The exact permitted pressure range is model-specific. A low reading does not
identify water loss, air or an expansion-vessel problem; this one common boundary is not a complete
filling specification.

**Evidence and limits:** [Lowest water pressure](DIAGNOSTIC_EVIDENCE.md#diagnosis-pressure)

<!-- user-docs: health_flow -->
### Lowest water flow

**In plain language:** The board reports the lowest valid flow after the internal pump has run
continuously for at least sixty seconds, excluding start-up and pump-off readings.

**Meaning:** **MEASURED ONLY** is deliberate. Required flow varies by exact model and heating, cooling,
DHW or defrost operating state.

**Important limit:** This is an observed **part-load minimum**, not a manual's nominal/design flow.
Compare a manual minimum only for the same model, operating mode and conditions. One low reading
without a unit fault proves little.

**Evidence and limits:** [Lowest water flow](DIAGNOSTIC_EVIDENCE.md#diagnosis-flow)

<!-- user-docs: health_heater -->
### Electric backup and booster heaters

**In plain language:** The board separately counts active time for the water-circuit electric backup
heater (**BUH**) and tank electric booster heater (**BSH**).

**Meaning:** These are runtime observations. Weather, DHW schedules, defrost, emergency mode and
PV-surplus control can make that activity intentional.

**Important limit:** Runtime alone establishes neither energy consumed nor a defect; it does not
identify why the controller used a heater.

**Evidence and limits:** [Electric heaters](DIAGNOSTIC_EVIDENCE.md#diagnosis-heater)

<!-- user-docs: health_retries -->
### Protection-limit counter changes

**In plain language:** The board observes five internal counters that may indicate protective limiting.
Only a clearly observed comparable increase counts.

**Meaning:** The row is **EXPERIMENTAL** because full manufacturer semantics are not public.

**Important limit:** An increase is not a fault diagnosis. No increase does not prove that the unit
never limited itself; a decrease has no established wrap/reset interpretation.

**Evidence and limits:** [Protection-limit changes](DIAGNOSTIC_EVIDENCE.md#diagnosis-retries)

<a id="refrigerant-service-observation"></a>
## Refrigerant circuit during heating

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
| **NOT AVAILABLE** | The detected profile lacks a required signal. |
| **WAITING FOR HEATING RUN** | No suitable ordinary run now; recording starts automatically when conditions fit. |
| **RECORDING** | Continuous fresh observation with the complete optional context. |
| **RECORDING · SOME DATA MISSING** | Recording, with optional temperature/pressure-side/outdoor/controller-phase context missing at least once. |
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
