# Plant-level features

What the firmware **measures, records and infers about the heat-pump installation** — as opposed to
[`FEATURES.md`](FEATURES.md), which catalogs what it does as an ESP32 *platform* (signing, OTA, the
web server, diagnostics, the build). A feature belongs here when its subject is the plant, the
building or the weather around them; there when its subject is the board.

Four of the five below are **analysis**, not control, and one is an optional accessory. None of them
writes to the heat pump: this firmware has no actuator, no Modbus write path and no MQTT command
subscription, and that is a property of the code rather than a guard around a dormant capability
(see [`FEATURES.md`](FEATURES.md) #61 and #68, and [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md)).

| Feature | Status | Anchored in |
|---------|:------:|-------------|
| [Rolling plant checkup (up to 24 h)](#rolling-plant-checkup-up-to-24-h) | ✅ 🧪 | [`logic/checkup.hpp`](../main/logic/checkup.hpp), [`checkup.cpp`](../main/checkup.cpp) |
| [Open-Meteo forecast on the device](#open-meteo-forecast-on-the-device) | ✅ 🧪 | [`weather_forecast.cpp`](../main/weather_forecast.cpp), [`logic/open_meteo.hpp`](../main/logic/open_meteo.hpp) |
| [Optional ENV III climate input](#optional-env-iii-climate-input) | ✅ 🧪 | [`env3.cpp`](../main/env3.cpp), [`logic/env3.hpp`](../main/logic/env3.hpp) |
| [Heating-curve diagnosis](#heating-curve-diagnosis) | ✅ 🧪 | [`logic/heating_curve_diagnosis.hpp`](../main/logic/heating_curve_diagnosis.hpp) |
| [How long a switched row has read that](#how-long-a-switched-row-has-read-that) | ✅ 🧪 | [`logic/state_dwell.hpp`](../main/logic/state_dwell.hpp), [`state_dwell.cpp`](../main/state_dwell.cpp) |

---

## Rolling plant checkup (up to 24 h)

The third question the dashboard asks, after *what is it doing now* (the schematic) and *what did
this reading do today* ([the trend rings](FEATURES.md)): **is anything worth reporting**. Counted
events and window minima — compressor starts and mean run length, defrost count and share of
runtime, the lowest water pressure and flow, backup-heater minutes (the BUH and the DHW booster kept
apart), the unit's own fault class, and the protection-retry counters.

**Why it is not a view over the trend rings.** A ring folds each 5-minute bucket to its *last*
reading, so a compressor cycle shorter than five minutes leaves no trace in it — and short cycling is
precisely what the checkup exists to find. Events are therefore counted where they happen, once per
completed poll sweep. A pulse falling entirely between two sweeps can still be missed, and the doc
says so rather than implying continuous coverage.

**It reports what the inputs established, never a certificate of health.** Five verdicts, and the two
that are not judgements carry the honesty:

- `unavailable` — this profile cannot supply the inputs. It really bites: only some of the shipped
  profiles carry the compressor witness at all.
- `collecting` — the inputs exist, the window does not hold enough of them yet. It outranks `ok` in
  the aggregation while `unavailable` does not, so a board that has been up ten minutes cannot show
  a green verdict it has no evidence for.

Storage is 23 completed one-hour buckets plus the pending hour, so the represented span is never an
almost-25-hour "24 h"; `full_span` is computed from real first/latest monotonic timestamps. An
explicit re-detection, or a profile or RX/TX identity change, resets the window rather than mixing an
in-flight old-link sample into it; HomeHub-only edits do not.

**A reboot no longer does.** This is the measurement that tolerates one worst: the window is 24 h and
the requirements are hours, so losing it loses the *verdict*, not a few samples — and a device on the
`dev` channel that keeps up to date may never reach 24 h at all. The rings therefore live in
`.noinit` DRAM, so any reset that kept power carries them across at no cost in RAM, flash or a
partition. A power cut still does not, and `/status.health.persist` names which happened rather than
letting a card that emptied itself read as a defect.

Two things guard the adoption, because ~1.2 KB of prior state is claimed in one act. A **layout
fingerprint** over the geometry, every row locator and every counting threshold invalidates the
record whenever a firmware update changes what a stored counter means — a bucket is a pile of
anonymous counters, so a valid checksum over silently re-meaning bytes is exactly what a checksum
cannot catch. And the **model** is checked at detection rather than at boot, because that is when
the answer exists: the window is kept only if the resolved profile is the one it was recorded under.
The in-flight **edge** state is deliberately not restored — a reboot is a discontinuity, and
restoring it would book a compressor start that may never have happened. The DHW-loss candidate is
not an edge: an intentional `esp_restart()` checkpoints its relative ages and any completed clean
window still waiting in the open bucket. The next boot adds five seconds of explicit blind time,
never observed evidence, then continues the candidate. `/status.health.checks[dhw_loss]` exposes
`candidate_s` or `settle_remaining_s`, so a carried 59-minute candidate no longer looks like zero
progress merely because only complete one-hour windows count toward the six-hour verdict gate.

**A check that cannot complete here says so, instead of collecting forever.** Only completed clean
hours count, and each tank charge costs 105 undisturbed minutes (45 settling plus a 60-minute
window), so a plant whose own duty cycle is shorter than that produces `0 min of 6 h` for the life
of the installation — the same reading a board that booted a minute ago gives. Two changes separate
them. The window now records what it **discarded**: how many candidate hours (`aborts`), why
(`abort_reasons[]` — charge, pump, draw, reading, blind) and how far the best one got
(`best_aborted_s`), all decaying with the same 24-hour ring. And a full lifecycle with no completed
window and at least six discarded ones becomes `blocked`: reported as `Unavailable`, the verdict
that already means "this check cannot adjudicate here" — it says nothing either way, does not
outrank `Ok`, and stops one permanently unreachable check from holding the whole card at
`collecting`. What separates it from a dead bus is `aborts`: a bus that measured nothing discarded
nothing — a candidate cannot even open without readable rows — so `collecting` stays the honest
answer there. A finding always outranks it: a high window is evidence, and evidence is never
withheld because the plant is also busy.

The verdict has **two causes and needs two sentences**, because they call for opposite action. A
plant whose duty cycle is shorter than 105 minutes is one; an X10A link that keeps going quiet
*mid-window* is the other — a flapping bus opens a candidate, loses it to the blind budget, and can
reach the same bar. When `blind` is the only reason recorded, the card names the link and points at
the wiring and the RX/TX pins instead of blaming the heat pump's cycling for what is a connection
fault.

The **settling** guard is charged only for a charge witness that stood at least two minutes. It is
owed to heat entering the tank, and a one-cycle valve blip put none in; before this bound a blip
cost the identical 105 minutes as a 40-minute charge, and one blip every 90 minutes took a
measured, otherwise perfect 24 h from 23 completed windows to zero. A short witness still discards
the candidate hour — the hydronics moved, so the tank was not standing — it just no longer asserts
that heat went in. Two rules keep the bound from failing in the direction that reports a leak where
there is none. A witness seen across an interval nobody watched counts as **proven** rather than
short. And an **unreadable** row is not proof the charge ended: both witnesses ride page 0x60, so
one silent page inside a real 40-minute charge would otherwise restart the two-minute clock, and a
charge finishing soon after that timeout would arm no settle at all and have its own tail measured
as standing loss. At the reference installation's timeout rate that is not a corner case. Staying
armed across a blind stretch only ever spends more settling time, never less.

Two refusals exist because persistence can make evidence **outlive its source**, which is the one
thing the window must never do. Safe mode never adopts: it does not run the poll loop, so nothing
would age the window and a frozen pre-reboot day would read as a live assessment for as long as the
latch holds. And while the bus is still unidentified the poll loop feeds an empty sample every
second — booking no observed time, only advancing the clock — so a board whose X10A stops answering
across a reboot ages the adopted evidence out within the day rather than freezing it.

**Claim strength is explicit per check**, because these are not equally strong statements: the
current unit fault is direct `device` state; cycling and the defrost ratio are `heuristic` and raise
`info` only, lacking load, humidity and coil-temperature context; flow after pump run-up and the
separately counted BUH/BSH seconds are `observation` only; protection retries are `experimental`,
raised only by a strict increase of one exact counter between comparable samples and never by an
absolute non-zero value. Any check concluding the *absence* of a pattern needs a complete lifecycle
and at least 90 % valid evidence for its own signal — a stable counter does not prove absence.

**DHW standing loss needed a second source before it could be a check at all** (#361). The cooling
rate alone does not separate the two causes — a healthy tank loses ~0.3 K/h without DHW circulation
and ~1.2 K/h with it — so an external power meter on the circulation pump (`POST /set_circulation`)
says which a given hour was. The witness is optional, and a window whose pump state is unknown buys
no observed seconds rather than an attributed loss.

**Missing evidence is not a plant state.** All its inputs ride the X10A sweep, where one page that
does not answer removes all of that page's rows from the cycle. Treating that unread second as
*ineligible* discarded the whole accumulated hour, which on the reference installation happened
about once an hour against a window needing sixty clean minutes. Replayed over that installation's
real 24 h, the old rule kept about half the achievable windows — so it roughly doubled the time to a
verdict, and in the first hours of a boot, when only one or two windows are possible at all, it read
"0 min of 6 h" with every row it needed present and correct. A sample the firmware could not read is
therefore **blind time**, bounded so no unobserved stretch can hide a tank charge and subtracted
from the seconds the window claims to have observed. A state the sweep *can* see still ends the
window, and a draw hidden inside a blind stretch is still caught against the temperature anchor
standing when vision was lost.

**Deliberately not built**, each because the bus cannot support the claim: an absolute minimum-flow
threshold (model-specific over a 3–18 kW catalog, and the unit raises its own error anyway — so the
flow minimum is *reported* with no verdict attached), a flat daily start count (24 starts is one an
hour in January and a control problem in April, so the mean run length is what knows the load), and
any overall "healthy" verdict.

---

## Open-Meteo forecast on the device

An optional weather forecast fetched **directly by the ESP32** — no MQTT, no evcc, no cluster in the
path. It exists as comparison evidence for heating-curve diagnosis, and is optional there.

Its own task waits for WiFi and a synchronized clock, then fetches a bounded six-hour JSON response
over CA-verified HTTPS every 45 minutes, retrying after 5 on failure. The request path does none of
that work: `POST /set_weather` only saves and wakes the task, so no DNS, TLS or JSON ever runs on the
httpd worker. The response is bounded *before* it is read (a `Content-Length` cap, then fixed chunks
against a running total) and never stored — nothing about a forecast survives a reboot.

**Saving a location IS the consent.** Handing these coordinates and this installation's public source
IP to a third party is the act being consented to, and the save is the only place a user states it,
so there is no second switch in front of it. Clearing the location wakes the task, stops it, drops the
runtime values and retracts the retained MQTT evidence document — a retained forecast nobody deletes
goes on reading like a live input long after collection was withdrawn.

**Almost everything else here is a refusal**, and that is the design:

- `issued_at` stays `null` rather than being backfilled from the fetch time. The endpoint does not
  expose the model-run instant, and a synthesized one would be fabricated provenance.
- The units are re-verified against the units the query asked for, so a provider changing them fails
  closed instead of publishing a °F number as °C.
- A provider timestamp that moves **backward** is rejected.
- A location edit invalidates the stored value outright — an old city's forecast must never be
  reported under a new one.
- A failed refresh keeps the last numbers visible **for diagnosis only**, while `available` and
  `fresh` fail closed together with the configured and task-availability flags.

**Privacy is structural, not a review point.** The coordinates are redacted in diagnostic snapshots
([`REPORTING.md`](REPORTING.md)), and the MQTT evidence document carries **no coordinates at all** — a
host test pins their absence, because a broker archive is a place an installation's location would
otherwise sit forever. There are no HA discovery entities: this is a metrics stream, and a forecast is
not a state of this device.

The public endpoint is intended for non-commercial use and carries no uptime guarantee; the modal
discloses the location/IP transfer and attributes Open-Meteo/DWD ICON.

---

## Optional ENV III climate input

A **third reading source** beside X10A and the HomeHub, sharing nothing with either: its own task,
its own 10 s sample cadence and its own freshness window. One runtime-configured I²C bus reads SHT30
temperature and humidity (CRC-checked) and QMP6988 pressure as one atomic sample.

This is specifically an **ENV III** driver — ENV, ENV II and ENV IV use different sensor ICs and are
not claimed as compatible. Support is decided by the board's **vendor**, not its model: what makes the
sensor plausible is the Grove port carrying the pins the preset names.

The runtime gate is literal. Disabled, or a board whose preset is not an M5Stack one, and there is no
task, no bus and no pullups — and the start path re-checks that itself rather than trusting its
caller, so a hand-edited config cannot start an accessory this board has no connector for. Pin
reservation runs in **all** directions against the X10A link, the status LED and the recovery button,
each rejecting the others' pins with a named reason.

**A save is hardware-proven, not merely validated**, and graded by what is changing:

| Change | What it must prove |
|--------|--------------------|
| Enabling on new pins | a real bus probe — the QMP6988 chip id **and** a full CRC-valid SHT30 measurement, since the SHT30 has no chip-id register and a decoded measurement is the only identity an ACK cannot give |
| Enabling on the pins already running | a fresh runtime sample |
| Moving pins while running | refused — disable first, because two masters briefly driving one shared wire is a bus fault, not a config change |
| Disabling | **nothing at all** — it is the recovery path and must never depend on hardware that may be the problem |

Each refusal carries a machine code beside the English text, so the bilingual UI translates without
the API losing its one wording. Board identity, LED/button and the sensor are submitted as **one**
atomic proposed snapshot, so choosing a board and attaching its sensor cannot half-save.

Published as a retained flat JSON document plus three HA sensors whose discovery config carries a
two-entry availability list — the device LWT and a template on the state topic itself — so a stale or
failed sensor marks only those three entities unavailable while the rest of the device stays online,
and an error omits the three readings rather than carrying the last plausible value forward. The
`samples`/`errors` I2C counters ride both shapes: they describe the link rather than the air, so a
sensor going dark keeps reporting why instead of falling silent about it.

**Where it deliberately does not appear:** `/values` and the plant checkup. Those describe the heat
pump, and an accessory measuring the board's surroundings is not a plant reading. Its one firmware
consumer is the [heating-curve diagnosis](#heating-curve-diagnosis) below, which records the
temperature as optional context with each event — never as a condition for one.

**The firmware cannot know where the sensor hangs.** Beside the indoor unit this is room air; over a
long I²C run to a sheltered outdoor position it is genuine outdoor air, and only the latter makes the
diagnosis axis mean anything. The device states the reading, not its meaning — placement is the
owner's fact, and anything downstream that depends on it has to record it. It does carry its
own 24-hour rings (served as a separate `/history` source, not mixed into the X10A set) and one
schematic pill, and it does not pretend to replace the Daikin outdoor sensor.

---

## Heating-curve diagnosis

A **raw, heating-only, write-free** sampler that records how far the living room deviates from its
target during genuine space-heating windows — the evidence a heating curve is set too high or too low.
It is a diagnosis instrument and terminates there: dynamic leaving-water actuation is retired, and the
read-only Modbus core contains neither write function codes nor value encoders.

It records the canonical room deviation **unchanged**, at most once per 30 minutes, and only after the
gates below agree. There is no P gain, deadband, rounding, clamp, slew limit, requested LWT offset,
mode switch or active controller anywhere in it — and none can be added quietly, because
[`FEATURES.md`](FEATURES.md) #68's contract test walks every C++ source under `main/` and fails on the
vocabulary.

**The gate order is load-bearing**, not incidental: HomeHub connectivity, then the plant gate
(register 53, normal space operation), then heating mode (register 38, Heating rather than Cooling),
and only then room, X10A and clock evidence. Establishing the plant *before* the room is what stops an
idle summer plant with its thermostat off from reading as a fault — a healthy installation produced
thousands of failsafes when the order was the other way round.

- **HOLD** (neutral): an idle plant, or Cooling — a separate non-heating hold that never enters the
  data set.
- **BLOCK**: missing or stale room data, an invalid clock, a disconnected X10A or HomeHub, or an
  unknown mode or gate. Unknown evidence blocks; it is never assumed benign.
- A transient hold or block **preserves** the cadence and the last durable event, so recovery cannot
  fabricate a new sample.

**An optional outdoor axis rides with each event.** Where the [ENV III](#optional-env-iii-climate-input)
accessory is configured and fresh, the outdoor air temperature *at the moment of the event* is recorded
beside the room deviation — without it the record is underdetermined, since a room error alone cannot
separate a curve that is too **steep** from one shifted too **high** (+0.5 K at −5 °C and at +12 °C call
for opposite corrections and record identically). It is **context, never a gate**: nothing branches on
it, an absent sensor moves no state, reason or counter, and a source-boundary test refuses a hold or
block on it. Absence is null, not 0 °C; a sample taken without the sensor clears the previous event's
reading rather than inheriting it. The sampling *method* is unchanged, so archived events stay
comparable.

**Arming is derived, not switched.** It follows from the timestamped MQTT room mapping alone
([`FEATURES.md`](FEATURES.md) #62 — the source is test-before-persist, since a typo here does not fail
loudly but produces a plausible-looking deviation). The forecast above is *optional* comparison
evidence, distinguishing a Recording state from a Degraded one, so clearing a location stops forecast
traffic without stopping local samples. Deleting the room source disarms and clears sample memory: a
reading taken under a consent since withdrawn must not outlive it.

The outside contract is `/status.heating_curve` plus the schema-versioned `<base>/heating_curve`
payload, which expose raw current and last deviation, the heating gates, the source time, an absolute
event timestamp with a sequence, and counters. Consumers detect an event by a **sequence increase**
and treat a sequence or uptime reset as a reboot. Those domain fields are deliberately absent from
`<base>/heartbeat`, which stays technical board and link health. There are no HA entities: this is
analysis evidence, not a plant command.

The card in the UI always renders, stating recording, optional-forecast degradation, a summer wait,
excluded cooling or the exact missing input — and it says out loud that room kelvin is not calibrated
water kelvin. It also carries the optional outdoor axis as its own row, whose number comes from the
diagnosis rather than from the sensor read a second time, so a live sensor cannot show green there
while the state row reports that nothing is being recorded. That row NAMES the sensor (`ENV III`) and
is **passive**, like every other reported row on the card: the readings live inside its explanation,
and the sensor's one editor stays the Board Hardware modal on the ESP32 card, which saves it in a
single atomic `POST /set_board` beside the board identity that decides whether the Grove port exists
at all. A second door into that modal from a card that reports EVIDENCE offered hardware
configuration on a row whose own copy says the value changes nothing about what gets recorded.

---

*Platform-level features are in [`FEATURES.md`](FEATURES.md); keep both current with the
[`feature-docs`](../.claude/skills/feature-docs/SKILL.md) skill.*

---

## How long a switched row has read that

The value list states what a flag **is**; for a flag that is half the question. `Powerful DHW
Operation: OFF` describes a plant that finished a charge four seconds ago and one that has not
charged since Tuesday equally well, and until now nothing on the device could tell them apart —
nine switched rows have a [24-hour timeline](FEATURES.md) whose tooltip names phase and duration,
and the other twenty-one had no answer anywhere.

Every bit flag and the fault class now carry the age of their current state, shown as the first line
of the row's explainer. It is an **observation**, not a statistic: nothing is inferred from it, no
verdict is raised on it and no threshold is attached to it. What the plant does with a long-standing
flag is the reader's judgement — the device only says how long it has stood, and how much of that it
actually saw.

**What it refuses to claim** is the whole design, because a duration is a statement about a stretch
of time and every way of overstating one looks identical on screen:

- A run the board only found **already standing** is a lower bound — *"OFF ≥ 3 h"*, floored, because
  rounding a bound up asserts time nobody watched. Only a
  transition it witnessed licenses the plain form, and *witnessed* means seen in the immediately
  preceding cycle: a change discovered after even a short gap happened somewhere inside that gap.
- A run the bus did not answer for throughout says so beside itself. A flag can pulse and return
  inside a gap, and the X10A sweep really does miss pages (47 timeouts in 8.2 h on the reference
  installation).
- Past two minutes unread a row reports **nothing at all**, so a silent bus lets its ages expire
  rather than freezing them and presenting them as current.
- A reboot is not a change: the ages ride `.noinit` across a reset that kept power, with the
  unwatched reboot window booked as unobserved rather than as a duration nobody measured.
- A row the bus could not read this cycle shows **no age at all**, because it is showing no reading
  either — an age under a "—" describes nothing.

The mechanism, the storage and the persistence rules are the platform half and live in
[`FEATURES.md`](FEATURES.md) #80.
