# Plant diagnostics in plain language

<!-- user-docs-contract: 103d9ea4da700d26a32e16f077a0db71bf601424660db1e1520206f69e57e2a1 -->
<!-- user-docs: health_guide -->

This guide is for owners who want to understand their heat pump without being heating specialists.
The diagnosis runs automatically on the ESP32. It **reads** measurements and counts events; it does
not change settings or control the heat pump.

Every check also has an [evidence and limits entry](DIAGNOSTIC_EVIDENCE.md). That ledger identifies
which claims come from Daikin documentation or primary research, which thresholds are project
heuristics, and what the measurement cannot establish.

The web UI shows the **Plant diagnostics · 24 h** card immediately below the plant schematic. Open a
row to see the reading, assessment, normal context, and a suggested next step.

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
update can be normal.

Open **How to read this card** first. Its **Data window** line explains whether earlier diagnosis data
was retained or discarded for this boot. An ordinary reset while power remains available normally
retains the window. A power interruption starts it again because the 24-hour diagnosis window is
currently held in power-retained RAM, not in a flash archive. A firmware update also discards an old
window when the meaning or layout of the counters changed.

The saved five-minute trends are separate. Each interval retains only its final measurement or an
aggregated event state. Those trends cannot reliably reconstruct second-by-second compressor starts,
the operating mode of a complete run, or an uninterrupted domestic-hot-water hour, so the firmware
does not reuse them as diagnosis evidence.

## What is checked?

<!-- user-docs: health_fault -->
### Unit-reported faults

**In plain language:** The diagnosis remembers whether the heat pump itself reported a fault,
warning, or caution. A report that has since cleared can remain visible for up to 24 hours.

**What you can do:** For a **WARNING**, open the exact code under **Operation** and write it down.
Use the operating manual or the matching Daikin service information. For a single cleared note,
observe first; if it returns, record the time, operating mode, and code for an installer or service
technician.

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

**What you can do:** If a **NOTE** repeats, first check the schedule and runtime of the domestic-hot-
water circulation pump. Observe whether it remains when no hot water is drawn and the circulation
pump is certainly off. If it does, give several days of readings to an installer.

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

**When does a note appear?** The project heuristic requires at least twelve confirmed space-heating
runs averaging under ten minutes. This is not a Daikin limit and does not by itself prove a defect.

**What you can do:** Observe several days and note outside temperature and operating mode. Check
whether many room thermostats or heating circuits close and whether schedules frequently interrupt
space heating. Do not change settings because of one day. If the pattern persists, ask an installer
to check the heat curve, water flow, and hydraulic balance.

**Evidence and limits:** [Compressor cycling](DIAGNOSTIC_EVIDENCE.md#diagnosis-cycling)

<!-- user-docs: health_defrost -->
### Defrost events

In cold, humid weather the outdoor heat exchanger can ice up. The heat pump then defrosts it briefly;
this is normal in suitable conditions.

**In plain language:** The diagnosis counts defrost events and calculates their share of compressor
runtime for which both signals were readable. A higher share is only a note because X10A provides
neither outdoor humidity nor the heat exchanger's surface temperature.

**When does a note appear?** The project heuristic requires at least three assessable defrost events
and more than 15% defrost time within the paired compressor runtime. This is not a Daikin limit.

**What you can do:** Consider the weather and inspect the outdoor unit. Snow, leaves, or objects must
not block the airflow or water drain. Frequent defrosting can be normal in wet, cold weather. Ask an
installer if it also happens in mild, dry weather or visible icing remains continuously.

**Evidence and limits:** [Defrost events](DIAGNOSTIC_EVIDENCE.md#diagnosis-defrost)

<!-- user-docs: health_pressure -->
### Lowest water pressure

**In plain language:** This is the lowest valid water pressure in the observed window. A **NOTE**
appears at or below 1.0 bar; it becomes a **WARNING** after pressure remains that low for 60 seconds.

**What you can do:** Check the permitted range in the manual for the exact unit. Do not refill
blindly: repeatedly falling pressure can indicate air, an expansion-vessel problem, or water loss and
should be checked by an installer. Follow the unit manual if the heat pump reports an active fault.

**Evidence and limits:** [Lowest water pressure](DIAGNOSTIC_EVIDENCE.md#diagnosis-pressure)

<!-- user-docs: health_flow -->
### Lowest water flow

**In plain language:** The diagnosis reports the lowest water flow after the internal pump had run
continuously for at least 60 seconds. It deliberately excludes pump start-up and readings while the
pump is stopped.

**Why is it measured only?** Required flow depends on the exact unit and operating mode. Heating,
cooling, domestic hot water, and defrost do not necessarily require the same value. This is an
observed **part-load minimum** from a modulating pump, not the nominal or design flow stated for a
different operating point in a manual.

**What you can do:** Do not compare it directly with nominal flow. Use a minimum from the exact
installation manual only when it applies to the same operating mode and conditions. One low reading
without a unit fault proves little. Repeatedly falling below that matching minimum, or a water-flow
fault, should prompt an installer to check filters, valves, pump settings, and hydraulics.

**Evidence and limits:** [Lowest water flow](DIAGNOSTIC_EVIDENCE.md#diagnosis-flow)

<!-- user-docs: health_heater -->
### Electric backup and booster heaters

**In plain language:** The diagnosis separately counts how long the electric backup heater for the
water circuit (**BUH**) and the electric booster heater in the hot-water tank (**BSH**) were active.

**What you can do:** Compare runtime with weather, hot-water schedules, defrosting, emergency mode,
and any PV-surplus control. Short use can be intentional. Unexpectedly frequent or long runtime is a
reason to have settings and plant output checked, but runtime alone does not prove a defect.

**Evidence and limits:** [Electric heaters](DIAGNOSTIC_EVIDENCE.md#diagnosis-heater)

<!-- user-docs: health_retries -->
### Protection-limit counter changes

**In plain language:** The diagnosis observes five internal counters that may indicate protective
limiting. Only a clearly observed increase counts. The full manufacturer semantics are not publicly
documented, so this row is **EXPERIMENTAL**.

**What you can do:** One increase normally requires no action. If increases repeat together with low
output, unusual noises, or fault codes, record the time and operating state and show the pattern to
an installer or service technician.

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
