# Plant features

These features observe the heat-pump installation, building or surroundings. The firmware has no
heat-pump actuator, Modbus write implementation or MQTT command route. [FEATURES.md](FEATURES.md)
catalogs board/platform capabilities; [DIAGNOSTICS.md](DIAGNOSTICS.md) explains visible results.

## Collection and prerequisites

**Plant diagnostics is off by default**, including migrated configurations. Enable or pause it
under **Settings → Firmware** (`Off`, `X10A`, or `Modbus`). First opt-in draws an active evidence
generation. Setting `Off` pauses new checks and circulation collection. Already collected X10A and
Modbus checkup/DHW/cycling/stop-context records and circulation history continue aging out after
24 hours. Re-enabling resumes inside the same generation without bridging the paused interval.
`X10A`/`Modbus` chooses which independent store the dashboard card displays while both record.
The saved circulation mapping remains available when collection resumes.
Only a factory reset or source/endpoint/mapping change clears the affected store. The passive
refrigerant observation uses existing X10A sweeps independently of the setting.

| Feature | Requires diagnostics opt-in | Inputs / boundary |
|---|---|---|
| Rolling checkup | Yes | Separate X10A and HomeHub/Altherma 4 Modbus rolling windows; optional external circulation-power witness. |
| Refrigerant heating observation | No | Existing X10A sweep; suitable ordinary heating run. |
| ENV III | No | Supported M5Stack board, enabled/proven I²C mapping. |
| Per-row state age and trends | No | Readable supported source rows; compatible retained history. |

X10A, HomeHub Modbus, ENV III and the MQTT circulation witness have independent identities,
lifecycles and freshness. An unavailable source leaves gaps in history. Only X10A state and discovery
require recent X10A readings. MQTT publication requires a broker connection.

## After upgrading to status schema 2

The upgrade removes the heating-curve diagnosis, its standalone MQTT room-temperature input and
the Open-Meteo forecast. X10A and HomeHub still provide their own room readings where supported.
ENV III continues to measure outdoor temperature, humidity and pressure. The optional DHW circulation
measurement still uses MQTT. See [API client migration](API.md#migrating-api-clients-to-status-schema-2)
and [MQTT migrations](MQTT.md#migrations) for affected integrations.

## Rolling plant checkup (up to 24 h)

The checkup observes unit fault classes, tank cooling, compressor runs, defrost, pressure, flow,
heater activity and experimental counter changes. [DIAGNOSTICS.md](DIAGNOSTICS.md) explains the
results; [DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md) owns thresholds and claim boundaries.

Each completed X10A sweep and eligible full HomeHub/Altherma 4 Modbus poll contributes only the rows it
read to its own store. Integrated state time requires readable endpoints and bounded gaps; a pulse
entirely between polls can still be missed. Five-minute trends cannot reconstruct completed runs or
hourly tank cooling and are not reused as diagnosis evidence. Temporary allocation/TLS pauses preserve
profile capabilities while adding no observed time.

Read-time source age, elapsed lifecycle span and per-signal coverage are separate facts. A stopped
producer cannot retain a current all-clear. Historical findings remain age-bounded; observation-only rows
do not become reassuring health results. The overall verdict uses eligible bounded assessments;
tank-cooling notes and experimental events can independently raise its severity. The badge counts
warning or note rows, as explained in [DIAGNOSTICS.md](DIAGNOSTICS.md).

### Evidence population

Cycling uses completed continuously classified heating runs; DHW, cooling, mixed and unfinished
runs cannot dilute that mean. An insufficient heating/classification population remains a neutral
observation with an explicit reason. Defrost uses its own paired compressor/defrost population.
Optional outdoor min/mean belongs only to each accepted population and changes no verdict.

Tank cooling retains completed/high-rate window counts and the greatest one-hour net R5T drop.
Pump-active and draw-like windows remain measured with separate context counts; only unmarked high
rates raise a project note. Exclusions explain missing evidence, not a defect. The UI's assumed-tank
heat/electricity example is not calorimetry or a green loss assessment; [DIAGNOSTICS.md](DIAGNOSTICS.md)
explains it. A fresh filter waits 45 minutes; software restarts carry the remaining settle. Unseen
charging can still affect a later window.

### Optional circulation measurement

Connect an MQTT broker, synchronize the device clock and enable plant diagnostics. In **Settings →
Plant diagnostics → DHW circulation pump**, enter the meter's exact MQTT topic and the JSON paths
for active power in W and its source timestamp. Use a JSON number for whole Unix seconds or a
JSON string for RFC 3339 with a time zone.
**Save** first tests the mapping and requires a fresh usable reading.
See the [MQTT input contract](MQTT.md#circulation-witness-input) for defaults.

The independent circulation witness's broker, topic, value/time paths, maximum age, thresholds and
confirmation time bind the DHW evidence identity. Editing them clears only that check and its
ongoing filter; renaming it does not. Its empty post-edit window says nothing about the tank.

### Reboot and persistence

The window holds 23 completed one-hour buckets plus the pending hour, at most 24 hours.
**Every boot retires completed `.noinit` diagnosis hours and undated open counters.** Completed hours
can restore only from compatible, dated history-journal records after clock synchronization and
**current-boot confirmation of the matching source (X10A profile/link or Modbus profile/host/port/unit)**. Records bind endpoint, full source/profile scope,
diagnostics-consent generation, consumer-schema/method fingerprint and CRC
([identity contract](ARCHITECTURE.md#history-and-diagnosis-persistence)). DHW additionally binds the
circulation configuration; a mismatch empties only its bucket, preserving independent bus evidence.
Old unscoped formats are rejected. A cached model guess cannot admit records. Core journal layout 3
requires independent heating and hot-water runtime. It rejects earlier core records in full,
including their completed tank-cooling results. Raw trends, the independent Stop journal and the
one-shot handoff of an unfinished tank-cooling window keep their own compatibility rules.

A late restore can add only hours whose saved labels precede this boot's completed hours. If the
wall clock cannot date those live hours within the window, recovery keeps the live history and
skips the saved hours.

**A software restart (any `esp_restart()`) tries to save each confirmed source's open hour.**
Software restarts include:
- an OTA installation or rollback;
- a settings save that restarts the board;
- a WiFi credential rollback or an Ethernet-to-WiFi fallback;
- a heap-watchdog restart.

Saving a source's open hour needs all of the following:
- a synchronized clock;
- a confirmed matching source (X10A and/or HomeHub/Altherma 4 Modbus);
- a started diagnostics generation (enabled, or paused with an open pre-pause hour);
- no queued reset for that source (a circulation-only reset empties just the hour's tank-cooling
  part);
- a writable history journal;
- at least one observed second in the open hour.

The open hour becomes a dated short record, labelled with the wall-clock hour of its newest sample.
The bounded shutdown drain appends it after every completed hour. It is skipped when that label is
not newer than the newest completed or already journaled hour, because a second record could only
replace that hour. A drain that reaches its record budget or cannot take its locks loses it as well.

The diagnosis total retains a counted start when its hour restores from a compatible record.
For a run crossing an hour boundary, that is the earlier hour, separate from the open hour the
restart tries to save. If the compressor is already running when observations resume, the new boot
counts no start for that run. When it stops, the observed remainder is a censored run.

The chart saves timed compressor observations separately from the hourly diagnosis records.
A software restart, including an OTA installation, can make an additional save. Power loss,
crashes and watchdog panics lose the unsealed diagnosis hour. Once time and the current source
are confirmed, the timed chart can recover an eligible committed checkpoint.
See the [journal rules](ARCHITECTURE.md#history-and-diagnosis-persistence) for restore and reset limits.

Current observations take precedence for hourly totals. The
[retention rules](ARCHITECTURE.md#history-and-diagnosis-persistence) distinguish live and restored
hours. A completed tank-cooling window can use an initial temperature
from the preceding bucket. Later clock corrections do not renew an assigned monotonic deadline;
read-time span cannot fabricate observation coverage. See
[`/status.health.persist`](API.md#history-and-24-hour-checks)
for restoration outcomes. An explicit profile/link reset retires pending X10A
restore for this boot, even if the same profile is selected again. HomeHub-only edits do not reset
the X10A lifecycle, and switching the Plant diagnostics display source (`x10a`/`modbus`) leaves
both histories untouched. Safe mode and pre-opt-in states (`diagnostics_generation == 0`) admit no
old hours, while booting while paused retains the active generation's compatible flash records for
resumption; unidentified-source empty samples advance time without booking observations.

Exact completed tank-cooling windows persist independently of hourly diagnosis totals. The
timed journal restores compatible saved records within the last 24 hours after clock and source
confirmation. It requires the matching circulation identity and diagnostics generation. A
power loss can lose windows that had not yet been committed. Restored bars report historical
observations. Freshness still requires complete inputs from the current boot.

Once a restore or the first checkpoint preparation sets the clock anchor, a confirmed clock step
withdraws restored windows and queues a barrier. Current windows can then be saved with corrected
time. If power fails or the barrier write fails before commit, the prior checkpoint can still qualify for
restoration under the usual identity and age checks. If the flash scan finds damaged barriers,
only checkpoints written after finding the same set of damaged barriers qualify for restore.
Changes in the damage set can withhold replay until a matching checkpoint is saved.

A software restart can also carry each source's ongoing tank-loss filter through a separately sealed
**one-shot handoff**. Adoption requires confirmation of that source and circulation scope, enabled
diagnostics and no pending reset. The handoff preserves the hourly cooling candidate and settling
timer. Power loss, crash, changed source or an incompatible or absent handoff starts a fresh
filter. Handoff v3 rejects v2.

Adoption books **five seconds plus all new-boot uptime through source confirmation as blind time**.
Together with earlier gaps, exceeding either two minutes of continuous blindness or 10% of the
candidate hour discards the carried candidate. This restart discard is not counted in `aborts`, so their
count can under-report restarts; later unread samples use ordinary blind/discard accounting.
`candidate_s` and `settle_remaining_s` expose carried progress; the 45-minute start hold is not
reported in `settle_remaining_s`. Neither blind nor settling time is observed evidence. Same-boot journal creation does not prove restoration after power loss.

Browser trends and pinned points have a separate source/boot identity. Changing or deleting a
source clears them, and older replies cannot restore them. A reboot starts a new browser lifetime
even when the device later restores compatible saved trends.

<a id="refrigerant-service-observation"></a>
## Refrigerant (heating)

The passive refrigerant observation collects independently of the Plant diagnostics setting.
Enable **Plant diagnostics** (`X10A`) to see the row in the Diagnostics card (hidden when displaying
`Modbus`). The [row guide](DIAGNOSTICS.md#refrigerant-service-observation) explains when a window
qualifies, what its readings mean and what remains unknown.

## Optional ENV III climate input

ENV III is an independent accessory with a 10-second cadence and a 30-second fresh-sample bound.
Temperature/humidity (CRC-checked SHT30) and pressure (QMP6988) form one atomic sample. Disabled or
unsupported board selections start no sensor bus/task. Its supported hardware, installation limits
and test-before-persist save sequence are in [BOARDS.md](BOARDS.md#m5stack-env-iii-outdoor-temperature-humidity-and-pressure).

The UI shows an independent outdoor-climate reading/pill, with separate 24-hour history.
It does not replace Daikin's outside-air sensor, enter `/values`, or become a checkup input.
The board cannot discover sensor placement. A sensor near the indoor unit measures indoor air.

A stale/failed sample carries no plausible old MQTT reading; link counters remain. Disabling retracts
its state; HA discovery cleanup follows the [ownership migration rule](MQTT.md#migrations).
Source-specific publication/availability is in [MQTT.md](MQTT.md#env-iii).

## How long a switched row has read that

Eligible flags and fault classes show the age of their current state in the row explainer. A state
already present when first observed has a floored lower bound, such as **OFF ≥ 3 h**; only a
transition witnessed across consecutive readable cycles gets an exact-start duration.

Normal polling cadence counts as observed; known OTA or memory-pressure pauses and a
continuing run's resumed tail count as **blind time**. An unreadable current row shows no age.
Compatible warm resets can carry state ages, with restart and new-boot time through the first poll
also blind. More than two minutes of blindness, including time until the returning sample, starts
a new age. The **v4 format rejects older records**, so an update can restart ages without a plant
state change. State ages have no flash restore after power loss.
P2 overlay ages describe neutral raw ON/OFF bits, not undocumented polarity or trigger meaning.
No threshold or plant-health verdict is inferred from an age.

Implementation entry points: [`checkup.cpp`](../main/checkup.cpp),
[`refrigerant_service.hpp`](../main/logic/refrigerant_service.hpp),
[`env3.cpp`](../main/env3.cpp), [`state_dwell.hpp`](../main/logic/state_dwell.hpp).
Keep feature docs synchronized with the
[feature-docs skill](../.agents/skills/feature-docs/SKILL.md).
