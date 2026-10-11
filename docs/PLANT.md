# Plant features

These features observe the heat-pump installation, building or surroundings. The firmware has no
heat-pump actuator, Modbus write implementation or MQTT command route. [FEATURES.md](FEATURES.md)
catalogs board/platform capabilities; [DIAGNOSTICS.md](DIAGNOSTICS.md) explains visible results.

## Collection and prerequisites

**Plant diagnostics is off by default**, including migrated configurations. Enable it under
**Settings → Firmware**. Enabling starts a new evidence generation; disabling clears the accumulated
checkup/curve sample state and stops additional room, forecast and circulation collection. Saved
source mappings remain dormant, ready for a later opt-in. Evidence never crosses an opt-out boundary.

| Feature | Requires diagnostics opt-in | Inputs / boundary |
|---|---|---|
| Rolling checkup | Yes | Supported fresh X10A rows; optional external circulation-power witness. |
| Heating-curve diagnosis | Yes | X10A, active HomeHub, eligible MQTT room source and synchronized clock; forecast optional. |
| Open-Meteo forecast | Yes | Explicit saved location, network and synchronized clock. |
| Refrigerant heating observation | No | Existing X10A sweep; suitable ordinary heating run. |
| ENV III | No | Supported M5Stack board, enabled/proven I²C mapping. |
| Per-row state age and trends | No | Readable supported source rows; compatible retained history. |

X10A, HomeHub Modbus, ENV III, room MQTT, circulation MQTT and forecast keep their own lifecycle,
identity and freshness. One available source does not make another available, and absent context is
null rather than a fabricated zero. Outbound MQTT has its own X10A gate: local source activity does
not imply that an auxiliary topic is currently being published.

## Rolling plant checkup (up to 24 h)

The checkup counts faults, tank quiet-hour cooling, compressor runs, defrost events, water-pressure
minima, water flow after pump run-up, electric-heater activity and protection-counter changes.
[DIAGNOSTICS.md](DIAGNOSTICS.md) is the owner guide; [DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md)
is authoritative for sources, exact thresholds and claim limits.

Events are evaluated once per completed X10A sweep. A pulse entirely between sweeps can be missed.
Five-minute trends retain a final value/aggregated state and cannot reconstruct complete compressor
runs or clean tank hours, so they are not reused as diagnosis evidence.

Supported inputs with insufficient evidence remain `collecting`; unsupported checks are
`unavailable`. Most absence-of-pattern conclusions require a complete lifecycle and at least 90%
valid evidence for that check's signals. The card's overall `ok` means only that the bounded
assessable checks found nothing notable. It is not an overall plant-health certificate. Direct
fault state, observation-only flow/heater runtime and experimental retry changes have different
claim strengths and must be read separately.

### Evidence population

Compressor cycling separates **complete runs** into heating, DHW and cooling when valve/mode
signals stay readable and unchanged throughout. Mixed/gapped runs are censored; a run already
active at boot or still active now is not complete. Only heating enters the classified short-run
judgement. Classification requires at least **90% readable classification time**, **12 classified
complete runs** and **90% of completed runs classified**. Otherwise the assessment pools all runs,
which can mask short heating runs with DHW/cooling. `/status` identifies the assessed population;
class counts remain observations. Complete-run facts age with their start, not stop edge.

Cycling/defrost outdoor minimum and mean use fresh X10A outdoor samples paired with their own
accepted running-compressor population. Unknown compressor speed is not permission to call a
page-0x20 response fresh. These temperatures are context and never change a verdict.

Tank-loss evidence requires complete quiet hours after the documented settling period. Observed
charging, pump movement, draws and implausible readings interrupt a candidate; bounded unreadable
time is tracked as blind time and excluded from observed seconds. Excessive gaps discard it.
The result retains the greatest completed-hour R5T cooling rate, window count and bounded circulation
correlation, not each hour's rate or a measured energy integral.

Charging witnessed for at least two minutes arms a 45-minute settling period. Charging partly or
wholly hidden by unreadable data may not arm it; restarting without a compatible handoff loses it.
The first quiet-hour **NOTE after an update, unobserved charge or unexpected restart is therefore
weaker evidence than a repeating NOTE**: tank settling can resemble rapid loss. Unreadable tank,
valve, heater or pump inputs can result from the bus or from firmware pauses for OTA, weather,
network work, detection, memory pressure or restart. Blind time does not establish a wiring defect.

A full lifecycle with no clean hour and at least six discarded candidates becomes `blocked`
(visible as **NOT AVAILABLE**). `aborts`, the set of `abort_reasons` and `best_aborted_s` explain
that limit but cannot establish which cause dominated or reconstruct individual rejected hours.
Even `blind` as the sole recorded reason proves only that no plant-side cause was recorded for a
live candidate; a longer gap can hide charging or draws after that candidate ends. Settling normally
counts down through unread samples, but a sample gap past `CHECKUP_MAX_GAP_S` holds it. Charge
witnesses seen across such a gap are treated as proven; a short or unseen charge remains a limit.
Changing circulation topic, value paths, maximum age, on/off thresholds or confirmation time starts
this DHW check over; changing its display name alone does not. **CHECKING** after that edit says
nothing about the tank. The [tank-loss guide](DIAGNOSTICS.md#domestic-hot-water-tank-heat-loss) explains the method's limited
cooling-rate band and why its kWh example is not actual tank/day consumption.

### Reboot and persistence

The window holds 23 completed one-hour buckets plus the pending hour, at most 24 hours.
**Every boot retires completed `.noinit` diagnosis hours and undated open counters.** Completed hours
can restore only from compatible, dated history-journal records after clock synchronization and
**current-boot confirmation of the full X10A source**. Records bind endpoint, full profile/link scope,
diagnostics-consent generation, layout/threshold fingerprint and CRC. Old unscoped formats are
rejected; a cached model guess cannot admit records. The open hour and completed hours not yet saved
are missing.

Current observations take precedence. Compatible hours must fit the window and expire **exactly
24 hours after their stored endpoint**, even between hourly updates. `/status.health.persist` names
`flash_pending` while confirmation is awaited (not proof that saved hours exist), `flash` after
reconstruction, or `fresh` when no stored intervals were selected, including precedence/capacity
exclusions. Startup refusal reasons remain explicit. An explicit profile/link reset retires pending
restore for this boot, even if the same profile is selected again. HomeHub-only edits do not reset
the X10A lifecycle. Safe mode and disabled diagnostics admit no old hours; unidentified-source
empty samples advance time without booking observations.

An intentional restart can carry only the ongoing tank-loss filter through a separately sealed
**one-shot handoff**, adopted after the same full source is confirmed with diagnostics enabled and
no reset requested. It preserves the quiet-hour candidate/settling timer, never undated completed
counters or transient compressor edges. Power loss, crash, changed source or incompatible/absent
format starts a fresh filter.

Adoption books **five seconds plus all new-boot uptime through source confirmation as blind time**.
Together with earlier gaps, exceeding either two minutes of continuous blindness or 10% of the
candidate hour discards the carried candidate. This restart discard is not counted in `aborts`, so their
count can under-report restarts; later unread samples use ordinary blind/discard accounting.
`candidate_s` and `settle_remaining_s` expose carried progress. Neither blind nor settling time is
observed evidence. Same-boot journal creation does not prove restoration after power loss.

Browser trends and pinned points have a separate source/boot identity. Changing or deleting a
source clears them, and older replies cannot restore them. A reboot starts a new browser lifetime
even when the device later restores compatible saved trends.

<a id="refrigerant-service-observation"></a>
## Refrigerant circuit during heating

A separate passive row records one continuous ordinary space-heating run. It is not a ninth health
check and starts without a service mode or plant-diagnostics opt-in. Until this boot detects a
profile and evaluates its coverage—including safe mode—the row/status object is absent.

A window needs fresh values in the same sweep: running compressor, space-heating mode, non-DHW
valve, no defrost, readable normal fault rows, no active profile-provided special phase, discharge
temperature, EEV command and at least one structurally identified refrigerant-pressure side.
Optional missing comparison signals are reported separately. A required reading/phase witness or
sequence gap ends the window; the next suitable run begins at zero.

`/status.refrigerant_service` reports duration, sample count, limits and min/mean/max values.
It assigns no health verdict, normal range, settling/full-load condition, completion threshold or
refrigerant-charge conclusion. The EEV reading is a controller command, not mechanical feedback.
See [the row guide](DIAGNOSTICS.md#refrigerant-service-observation) and
[its evidence boundary](DIAGNOSTIC_EVIDENCE.md#refrigerant-service-observation).

## Open-Meteo forecast on the device

Configure **Open-Meteo weather forecast** in the Settings heating-curve section after enabling
plant diagnostics. Saving latitude/longitude explicitly consents to sending that location and the
installation's public source IP to Open-Meteo. Clearing both fields stops traffic and removes retained
forecast evidence. A saved location stays dormant while diagnostics is off.

The ESP32 fetches directly over verified HTTPS, without MQTT as a prerequisite. Its task waits for
network/clock readiness, fetches a bounded six-hour response every **45 minutes**, and retries after
**5 minutes** on failure. Ordinary saving wakes the task; it does no TLS work in the HTTP handler.
Values are runtime-only and do not survive reboot. The service is intended for non-commercial use
and has no uptime guarantee; the dialog attributes Open-Meteo/DWD ICON.

Units, time order and input ranges are checked. Changing location invalidates old values. A failed
refresh can keep the last numbers as historical evidence but fails current availability/freshness;
fetch age expires after 90 minutes. Provider issue time remains unknown rather than being filled
with fetch time. Diagnostic reports redact coordinates and the MQTT evidence topic omits them.
The schema is in [MQTT.md](MQTT.md#weather); no weather HA entities are created.

Forecast is **optional comparison evidence** for heating-curve sampling. Losing it degrades that
comparison but does not stop otherwise eligible local samples. The separate HIL refresh-token API
belongs in [API.md](API.md), not the owner setup flow.

The diagnostic weather companion uses the **two-hour window selected at the last successful fetch**.
That window stays fixed until another successful fetch; it does not slide forward between requests.

## Optional ENV III climate input

ENV III is an independent accessory with a 10-second cadence and a 30-second fresh-sample bound.
Temperature/humidity (CRC-checked SHT30) and pressure (QMP6988) form one atomic sample. Disabled or
unsupported board selections start no sensor bus/task. Its supported hardware, installation limits
and test-before-persist save sequence are in [BOARDS.md](BOARDS.md#m5stack-env-iii-outdoor-temperature-humidity-and-pressure).

The UI shows an independent outdoor-climate reading/pill, with separate 24-hour history.
It does not replace Daikin's outside-air sensor, enter `/values`, or become a checkup input.
The temperature can accompany a heating-curve event as optional context. The board cannot discover
sensor placement: a reading near the indoor unit is indoor air, irrespective of its label.

A stale/failed sample carries no plausible old MQTT reading; link counters remain. Disabling retracts
its state and three HA configs. Source-specific publication/availability is in [MQTT.md](MQTT.md#env-iii).

## Heating-curve diagnosis

This read-only sampler records **target room temperature − actual room temperature**, unchanged,
at most once per 30 minutes during genuine heating windows. Positive means too cold, negative too
warm. Room kelvin is not a calibrated leaving-water correction; the firmware does not calculate or
apply a heat-pump command.

Enable plant diagnostics, configure the broker/room source and keep the HomeHub source active.
Under **Room-temperature source**, enter the exact temperature `topic$path`, a fixed target or
target `topic$path`, and an optional timestamp `topic$path`. For example, use a structured payload's
`room/status$temperature_c` plus a fixed target `20`. Configure maximum age to match the publisher.
Saved mappings are not proof that their next payload is readable.

The current sampler requires a **non-empty temperature JSON path** and, for an MQTT target, a
non-empty target path. Although the room decoder can read a plain numeric topic with no path, that
mapping does not arm this diagnosis. A fixed target avoids needing a target MQTT path. This is an
implementation boundary, not evidence that a scalar sensor is defective.

With no timestamp mapping, only live non-retained arrival time is accepted; a retained reading needs
trusted source time. Actual/target range is 5–35 °C and optional enabled/HVAC mappings must pass.
[MQTT.md](MQTT.md#room-input-and-heating-curve-evidence) defines freshness, reason codes and payloads.

Gate order establishes HomeHub connectivity, normal space operation (register 53), then Heating
rather than Cooling (register 38), before room/X10A/clock evidence. An inactive plant or confirmed
Cooling yields neutral **HOLD**; unknown/stale prerequisites yield **BLOCK**. A transient hold/block
preserves the sample cadence and last event. Deleting the room source/HomeHub or disabling
plant diagnostics disarms and clears sample memory.

Each event can store two distinct optional outdoor axes: HomeHub input 44 from the current
cycle/session, and fresh/plausible ENV III from its actual placement. Missing context is null and
never gates an event. Without outdoor context, room error cannot distinguish a steep curve from an
overall high/low shift. A room thermostat/zone valve can clip the error at its target, so near-zero
samples do not prove the curve is correct. Interpret them with actual leaving-water clipping and
zone-demand duty where independent evidence exists.

The Settings card names the recording/degraded/hold/block state and missing input. The emitted
`heating_curve` evidence preserves current room values separately from the last recorded event.
Use **sequence increases and absolute event time** to count samples, not repeated publications.
ENV III configuration stays in Board Hardware; its passive context row is not a second sensor editor.

## How long a switched row has read that

Eligible flags and fault classes show the age of their current state in the row explainer. A state
already present when first observed has a floored lower bound, such as **OFF ≥ 3 h**; only a
transition witnessed across consecutive readable cycles gets an exact-start duration.

Normal polling cadence counts as observed; known OTA, weather or memory-pressure pauses and a
continuing run's resumed tail count as **blind time**. An unreadable current row shows no age.
Compatible warm resets can carry state ages, with restart and new-boot time through the first poll
also blind. More than two minutes of blindness, including time until the returning sample, starts
a new age. The **v4 format rejects older records**, so an update can restart ages without a plant
state change. State ages have no flash restore after power loss.
P2 overlay ages describe neutral raw ON/OFF bits, not undocumented polarity or trigger meaning.
No threshold or plant-health verdict is inferred from an age.

Implementation entry points: [`checkup.cpp`](../main/checkup.cpp),
[`refrigerant_service.hpp`](../main/logic/refrigerant_service.hpp),
[`weather_forecast.cpp`](../main/weather_forecast.cpp), [`env3.cpp`](../main/env3.cpp),
[`heating_curve_diagnosis.hpp`](../main/logic/heating_curve_diagnosis.hpp),
[`state_dwell.hpp`](../main/logic/state_dwell.hpp). Keep feature docs synchronized with the
[feature-docs skill](../.agents/skills/feature-docs/SKILL.md).
