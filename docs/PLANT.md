# Plant-level features

What the firmware **measures, records and infers about the heat-pump installation** — as opposed to
[`FEATURES.md`](FEATURES.md), which catalogs what it does as an ESP32 *platform* (signing, OTA, the
web server, diagnostics, the build). A feature belongs here when its subject is the plant, the
building or the weather around them; there when its subject is the board.

Three of the four below are **analysis**, not control, and one is an optional accessory. None of them
writes to the heat pump: this firmware has no actuator, no Modbus write path and no MQTT command
subscription, and that is a property of the code rather than a guard around a dormant capability
(see [`FEATURES.md`](FEATURES.md) #61 and #68, and [`MODBUS_PROTOCOL.md`](MODBUS_PROTOCOL.md)).

| Feature | Status | Anchored in |
|---------|:------:|-------------|
| [Rolling plant checkup (up to 24 h)](#rolling-plant-checkup-up-to-24-h) | ✅ 🧪 | [`logic/checkup.hpp`](../main/logic/checkup.hpp), [`checkup.cpp`](../main/checkup.cpp) |
| [Open-Meteo forecast on the device](#open-meteo-forecast-on-the-device) | ✅ 🧪 | [`weather_forecast.cpp`](../main/weather_forecast.cpp), [`logic/open_meteo.hpp`](../main/logic/open_meteo.hpp) |
| [Optional ENV III climate input](#optional-env-iii-climate-input) | ✅ 🧪 | [`env3.cpp`](../main/env3.cpp), [`logic/env3.hpp`](../main/logic/env3.hpp) |
| [Heating-curve diagnosis](#heating-curve-diagnosis) | ✅ 🧪 | [`logic/heating_curve_diagnosis.hpp`](../main/logic/heating_curve_diagnosis.hpp) |

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
almost-25-hour "24 h"; `full_span` is computed from real first/latest monotonic timestamps. A reboot,
an explicit re-detection, or a profile or RX/TX identity change resets the window rather than mixing
an in-flight old-link sample into it; HomeHub-only edits do not.

**Claim strength is explicit per check**, because these are not equally strong statements: the
current unit fault is direct `device` state; cycling and the defrost ratio are `heuristic` and raise
`info` only, lacking load, humidity and coil-temperature context; flow after pump run-up and the
separately counted BUH/BSH seconds are `observation` only; protection retries are `experimental`,
raised only by a strict increase of one exact counter between comparable samples and never by an
absolute non-zero value. Any check concluding the *absence* of a pattern needs a complete lifecycle
and at least 90 % valid evidence for its own signal — a stable counter does not prove absence.

**Deliberately not built**, each because the bus cannot support the claim: an absolute minimum-flow
threshold (model-specific over a 3–18 kW catalog, and the unit raises its own error anyway — so the
flow minimum is *reported* with no verdict attached), a flat daily start count (24 starts is one an
hour in January and a control problem in April, so the mean run length is what knows the load),
inferred 3-way-valve leakage (the sensors sit upstream of the diverter, and a measured healthy plant
would trip it daily), and any overall "healthy" verdict.

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
and an error publishes `{}` rather than carrying the last plausible value forward.

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
water kelvin.

---

*Platform-level features are in [`FEATURES.md`](FEATURES.md); keep both current with the
[`feature-docs`](../.claude/skills/feature-docs/SKILL.md) skill.*
