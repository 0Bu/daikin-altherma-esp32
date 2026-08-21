# Plant diagnostics in plain language

<!-- user-docs-contract: f6dbaade8ec23a930984260caa81571de8904e99b214c00aa45267ad526996f9 -->

This guide is for owners who want to understand their heat pump without being heating specialists.
Plant diagnostics are **off by default**. They run only after **Plant diagnostics** is explicitly
enabled in Settings under the Firmware card. Enabling starts a new evidence generation; disabling
stops the checkup and its additional room-temperature, weather-forecast, and circulation-power
collection and clears the accumulated diagnosis. The ordinary X10A/HomeHub bridge and technical
device telemetry remain independent. When enabled, the diagnosis **reads** measurements and counts
events; it does not change settings or control the heat pump.

Every check also has an [evidence and limits entry](DIAGNOSTIC_EVIDENCE.md). That ledger identifies
which claims come from Daikin documentation or primary research, which thresholds are project
heuristics, and what the measurement cannot establish.

While enabled, the web UI shows the **Plant diagnostics · 24 h** card immediately below the plant
schematic. Open a row to see the reading, assessment, and normal context. The card deliberately does
not recommend a next step because its bounded evidence may not establish the cause.

## What the statuses mean

| Status | What it means for you |
|--------|-----------------------|
| **OK** | This one check had enough usable evidence and found nothing notable in it. It is not a health certificate for the whole installation. |
| **NOTE** | Something is notable or worth knowing. Observe it and read the explanation; it is not proof of a defect. |
| **WARNING** | The heat pump reports a fault, or a documented boundary remained violated. Check it promptly. |
| **CHECKING** | The check still needs more hours or more usable measurements. Waiting is the correct response. |
| **MEASURED ONLY** | The value is useful, but there is no responsible universal good/bad limit without the exact model and operating state. |
| **EXPERIMENTAL** | Manufacturer documentation does not fully establish the signal semantics. Treat it as a lead, not a verdict. |
| **NOT AVAILABLE** | The detected plant profile does not provide the required data, or this operating sequence cannot supply enough reliable evidence. |

Most reassuring results require a complete 24-hour window and at least 90% readable coverage for the
signals used by the check. A diagnosis-format change starts a new window, so **CHECKING** after an
update can be normal. Changing the X10A wiring or detected profile also starts a new window; a bus
read that was already in flight for the previous link is discarded rather than counted under the
replacement plant identity.

An ordinary reset while power remains available normally retains the diagnosis window directly from
RAM. Completed diagnosis hours are also stored in the device's append-only history journal, so a
power interruption or firmware update restores them once the clock and detected model match. Only
the hour that was still open can be missing. An update still discards older records when the meaning
or layout of their counters changed.

The saved five-minute trends remain separate. Each interval retains only its final measurement or an
aggregated event state. Those trends cannot reliably reconstruct second-by-second compressor starts,
the operating mode of a complete run, or an uninterrupted domestic-hot-water hour, so the firmware
does not reuse them as diagnosis evidence.

## What is checked?

<!-- user-docs: health_fault -->
### Unit-reported faults

**In plain language:** The diagnosis remembers whether the heat pump itself reported a fault,
warning, or caution. A report that has since cleared can remain visible for up to 24 hours.

**Evidence and limits:** [Unit-reported faults](DIAGNOSTIC_EVIDENCE.md#diagnosis-fault)

<!-- user-docs: health_dhw_loss -->
### Domestic-hot-water tank heat loss

**In plain language:** The diagnosis looks for quiet hours in which the tank was neither charged nor
obviously affected by a hot-water draw. It then measures how quickly the tank temperature falls. An
optional circulation-pump power measurement can help show whether that pump transported heat out of
the tank.

**What range can it assess?** A **NOTE** starts at **0.8 K/h**. This is a project heuristic from one
reference installation, not a Daikin limit. Tank volume and the temperature difference between the
tank and its room both affect the cooling rate. The method can recognise notable clean hours only up
to about **1.85 K/h**. A faster continuous loss can look like a draw and cause the hour to be
discarded.

**What do OK and NOT AVAILABLE mean here?** **OK** only says that the usable quiet hours contained no
loss in the detectable range from 0.8 K/h upward. It does not exclude faster continuous loss. **NOT
AVAILABLE** after many discarded windows also does not identify the reason: charging, pump activity,
a draw, unreadable data, and continuous loss that resembles a draw cannot be separated from the
stored totals alone.

**What this result does not establish:** A rapid temperature drop alone proves neither a leaking
three-way valve nor poor insulation. The sensor measures one location in a stratified tank; hot-water
draws and natural circulation can look similar.

**Evidence and limits:** [Domestic-hot-water tank heat loss](DIAGNOSTIC_EVIDENCE.md#diagnosis-dhw-loss)

<!-- user-docs: health_cycling -->
### Compressor cycling

The **compressor** moves heat to a useful temperature level. A run starts when it switches on and
ends when it switches off.

**In plain language:** Many very short space-heating runs can mean that the heat pump cannot deliver
heat to the building for long enough. Where the signals permit it, the diagnosis separates complete
runs into **space heating**, **domestic hot water**, and **cooling**. Only confirmed space-heating
runs decide the short-run note, so a long hot-water run cannot hide short heating runs.

Example:

```text
17 starts · space 16 × 5 min · hot water 1 × 2 h
```

This means 17 total compressor starts, with 16 complete space-heating runs averaging five minutes
and one two-hour hot-water run. “Cooling … excluded” means that cooling runs were identified but did
not enter the heating assessment. “... unclassified” means a mode change or measurement gap made a
safe assignment impossible.

If `X10A min … °C · mean … °C` follows the run figures, it is the heat pump's fresh outdoor-air
context from those completed space-heating runs. It helps compare a cold-day pattern with a mild-day
one, but it does not change the ten-minute rule or the result. No X10A suffix means no suitably
paired current sample was established; it never means 0 °C.

**When does a note appear?** The project heuristic requires at least twelve confirmed space-heating
runs averaging under ten minutes. This is not a Daikin limit and does not by itself prove a defect.

**Evidence and limits:** [Compressor cycling](DIAGNOSTIC_EVIDENCE.md#diagnosis-cycling)

<!-- user-docs: health_defrost -->
### Defrost events

In cold, humid weather the outdoor heat exchanger can ice up. The heat pump then defrosts it briefly;
this is normal in suitable conditions.

**In plain language:** The diagnosis counts defrost events and calculates their share of compressor
runtime for which both signals were readable. A higher share is only a note because X10A provides
neither outdoor humidity nor the heat exchanger's surface temperature.

The optional `X10A min … °C · mean … °C` suffix describes fresh outdoor readings from the same
readable, running-compressor population. It is context only; it neither supplies humidity nor changes
the defrost share or result.

**When does a note appear?** The project heuristic requires at least three assessable defrost events
and more than 15% defrost time within the paired compressor runtime. This is not a Daikin limit.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Lowest water pressure

**In plain language:** This is the lowest valid water pressure in the observed window. A **NOTE**
appears at or below 1.0 bar; it becomes a **WARNING** after pressure remains that low for 60 seconds.

**Evidence and limits:** [Lowest water pressure](DIAGNOSTIC_EVIDENCE.md#diagnosis-pressure)

<!-- user-docs: health_flow -->
### Lowest water flow

**In plain language:** The diagnosis reports the lowest water flow after the internal pump had run
continuously for at least 60 seconds. It deliberately excludes pump start-up and readings while the
pump is stopped.

**Why is it measured only?** Required flow depends on the exact unit and operating mode. Heating,
cooling, domestic hot water, and defrost do not necessarily require the same value. This is an
observed **part-load minimum** from a modulating pump, not the nominal or design flow stated for a
different operating point in a manual. A manual minimum is comparable only for the same model,
operating mode, and conditions; one low reading without a unit fault proves little.

**Evidence and limits:** [Lowest water flow](DIAGNOSTIC_EVIDENCE.md#diagnosis-flow)

<!-- user-docs: health_heater -->
### Electric backup and booster heaters

**In plain language:** The diagnosis separately counts how long the electric backup heater for the
water circuit (**BUH**) and the electric booster heater in the hot-water tank (**BSH**) were active.
Weather, hot-water schedules, defrosting, emergency mode, and PV-surplus control can all make this
runtime intentional; runtime alone does not prove a defect.

**Evidence and limits:** [Electric heaters](DIAGNOSTIC_EVIDENCE.md#diagnosis-heater)

<!-- user-docs: health_retries -->
### Protection-limit counter changes

**In plain language:** The diagnosis observes five internal counters that may indicate protective
limiting. Only a clearly observed increase counts. The full manufacturer semantics are not publicly
documented, so this row is **EXPERIMENTAL**. An increase is not a fault diagnosis, and no increase
cannot prove that the unit never limited itself.

**Evidence and limits:** [Protection-limit counter changes](DIAGNOSTIC_EVIDENCE.md#diagnosis-retries)

## What the diagnosis cannot do

The card cannot reliably determine:

- a refrigerant shortage, dirty filters, or mechanical wear;
- correct hydraulic balancing;
- the cause of every high-energy-use period;
- seasonal efficiency;
- the condition of every sensor or valve.

**OK therefore always means:** This one check found nothing notable in the evidence it could assess.
It never means that the complete heat-pump installation is guaranteed to be fault-free.

## Plain-language glossary

| Term | Meaning |
|------|---------|
| Compressor | The main heat-pump component that raises refrigerant pressure and moves heat to a useful temperature level. |
| Space heating | Heat delivered to radiators or underfloor heating. |
| Domestic hot water (DHW) | Tap and shower water stored in the hot-water tank. |
| Defrost | A short operating reversal that removes ice from the outdoor unit. |
| Three-way valve | Directs heating water either to the building or to the hot-water tank. |
| BUH | Electric backup heater for the water circuit. |
| BSH | Electric booster heater in the domestic-hot-water tank. |
| X10A | Service interface from which the ESP32 reads the heat pump without controlling it. |
