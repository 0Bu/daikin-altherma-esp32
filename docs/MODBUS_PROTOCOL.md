# Modbus TCP — the Daikin HomeHub link

> **Status: independent READ source.** This firmware speaks Modbus TCP to a **Daikin HomeHub
> (EKRHH)** beside the primary X10A service-port tap and reads the curated map through the
> socket-owning `hp_modbus` task.
>
> **There is no write path, and that is a property of the code.** No source file contains a write
> entry point, an FC06/FC16 request builder or an issued write function code, and
> `test/test_heating_curve_diagnosis_contract.mjs` walks every file under `main/` to keep it that way.
> A write capability existed briefly and was removed unused; re-adding one is a deliberate design
> decision that fails that test first. There is no MQTT/HA/HTTP/MCP/raw-Modbus control surface
> either. Other clients on the LAN (the Onecta app, the unit's MMI, evcc) do write the hub — segment
> `:502` accordingly.
>
> **X10A remains primary.** There is no selector between the sources: once a HomeHub address is
> configured, both stacks run independently. X10A leads wherever both provide the same quantity;
> Modbus stays visible as the labelled second reading and carries the fallback when X10A is offline.
> See [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) for the primary link.

## Why a second SOURCE at all

The X10A service port is read-only *by the protocol* — it has no write command, which is why this
firmware has always been a one-way telemetry bridge ([`ARCHITECTURE.md`](ARCHITECTURE.md)). The
**HomeHub** is a separate, paid Daikin accessory wired to the indoor unit's **P1/P2** bus (connector
X6A — *not* X10A) that exposes a Modbus server on the LAN. It is the officially supported writable
path, and it publishes a smaller but more curated telemetry map than the raw X10A pages.

The source path is read-only. This firmware never writes the hub.

## Wire facts

Source: *EKRHH Daikin HomeHub — Installer reference guide 4P744838-1E*, §2.5, §9, §13.

| | |
|---|---|
| Transport | Modbus **TCP/IP** over the LAN (no extra hardware — the ESP32's WiFi reaches it) |
| Port | **502**, plaintext. The hub also offers Modbus-over-TLS on `:802`; **out of scope** — this client uses `:502` by choice, the same trusted-LAN posture as the rest of the API |
| Unit id | 1–247, default **1** (set on the hub) |
| Framing | MBAP header `[txn(2), proto=0(2), len(2), unit(1)]` + PDU. **No CRC** — unlike Modbus RTU, integrity is the MBAP length + the TCP checksum |
| Byte order | Big-endian on the wire |
| Addressing | The HomeHub tables print **1-based** data-model offsets; the wire PDU address is **offset − 1** |
| Function codes | FC03 read-holding, FC04 read-input. Nothing else: the FC06/FC16 request builders were removed with the write path, so this firmware cannot frame a write |

**Data formats** (16-bit, one register each):

| Type | Decode |
|---|---|
| `Temp16` | signed ÷100 → °C |
| `Pow16` | signed ÷100 → kW |
| `Int16` | signed, as-is (the flow register carries L/min ×100, so the profile applies a further ÷100) |
| `Text16` | unsigned = 2 ASCII chars, hi/lo byte — e.g. `0x5538` → `"U8"` |

**Special return values** (§9.2.3) — these are *not data* and are never published as a reading:

| Value | Meaning |
|---|---|
| `32765` | "wait for value" — the hub is still syncing |
| `32766` | unavailable in this configuration |
| `32767` | unsupported by this device |

`mb_is_special()` catches all three before any scaling, so a sentinel can never leak out as a large
number — the `legacy-35–legacy-39` failure shape this project exists to avoid.

**Compatibility is not unconditional.** The Modbus register set requires Unified MMI2 firmware
≥ 7.8.0 on the audited ERGA-EV / EHBH / X-E family, and individual registers can be inoperative per
model (holding registers 59 and 61 are documented as not operational on Micon 20002203: a read
returns the `32766` sentinel and a write is rejected by the hub).

## Discovery — one automatic first search, then manual

§2.5, verbatim: *"Multicast DNS (mDNS) is needed for the discovery of the Daikin HomeHub, which
advertises on the `_http._tcp.local.` service."* Three consequences shape the implementation:

1. **The advert is the hub's HTTP server on port 80, not a Modbus SRV record.** mDNS yields the
   host/IP only; the client then connects Modbus on the well-known port **502**.
2. **`_http._tcp` is noisy — and this firmware is one of the responders** (`net_mdns_start()` in
   `main/net.cpp` registers
   its own `_http._tcp` advert). A browse is therefore filtered by the hub's stable hostname prefix
   `homehub-*` (`is_homehub_hostname()`, `logic/modbus.hpp`); without that filter the device could
   try to talk Modbus to itself or to an unrelated HTTP device.
3. **mDNS needs a single subnet and multicast/IGMP.** A manual host is therefore mandatory as a
   fallback, not a nicety.

**How it behaves:** a genuinely fresh device browses automatically once on its first boot with a LAN
lease, before HTTP and the background config writers start. It tries `_http._tcp` up to three times,
accepting up to 64 responders per browse, and atomically persists both the resulting IPv4 and a
`searched` latch. A miss is persisted too: boot never becomes a continuous multicast scan loop. If
the device is in the captive portal without a LAN lease, or in safe mode, the decision remains
pending for the next normal networked boot.

The HomeHub edit dialog retains a manual **Search** button with the same bounded browse. Its result
fills the ordinary editable address field and is not saved behind the dialog's Cancel/Save boundary.
The larger cap matters on real home LANs: a 20-result cap can exclude the HomeHub solely because mDNS
result order is unspecified.

Each attempt shares a five-second monotonic budget between the three-second browse and all
additional A-record lookups. Embedded IPv4 records are still inspected after that budget expires;
missing addresses cannot each add another two seconds. Three attempts and the two one-second retry
delays therefore have a 17-second SDK timeout budget, excluding scheduling and local processing.
This is a project responsiveness bound, not a manufacturer discovery guarantee.

The user may instead enter an IP, `.local` name or ordinary DNS name verbatim. Saving `mb_host` is an
explicit decision: non-empty starts polling that address; empty disables HomeHub completely and
persists the latch. Empty-after-searched therefore means no task, no socket, no HomeHub request, no
HomeHub-dependent heating-curve diagnosis and no future automatic search. If several `homehub-*`
responders answer, the first resolved IPv4 is used/offered and the count is logged to `/diag` rather
than silently guessed at.

Every active failure is exposed as complete English `error` text plus structured `error_code`,
`error_detail` and (for reads) `error_register` fields. The UI localises the structured cause as a
quiet red line below the address. The same transition is written through `diag_printf`, which means
it reaches both `/diag` and configured Syslog; repeated one-second retries do not spam the log, and a
clean poll records recovery. Transport failures stop the current register sweep immediately so the
first timeout/refusal/closed/invalid-response cause cannot be overwritten by later reads on a socket
that is already closed.

## The register map

`main/def/homehub.hpp` defines the EKRHH map; `main/def/altherma4.hpp` defines the native
Altherma 4 subset. Each row is
`{offset, space (FC04/FC03), MbType, scale, unit, label, value kind}`. The value kind is essential:
the guide encodes ordinary numbers, binary flags and multi-state selectors alike as `Int16`, so the
wire type alone cannot tell a UI whether `1` means one, ON, Heating, Fault or DHW.

Read today (UC3 Daikin Altherma):

* **Faults** (input): unit error active `21`, error code `22` (`Text16`), sub-code `23`
* **Temperatures** (input, `Temp16`): leaving water PHE `40` / BUH `41`, return `42`, DHW tank `43`,
  outdoor air `44`, liquid refrigerant `45`, room `50`
* **Flow + electrical input** (input): flow `49` (`Int16`, L/min ×100), whole-system electrical
  input `51` (`Pow16`, kW). Offset `51` is not dedicated booster-heater power.
* **Disinfection state** (input): current disinfection operation `33` (`Int16`, binary). The
  HomeHub map does not expose the configured weekday, start time or disinfection temperature.
* **Setpoints and modes** (holding, read back): LWT main heating `1` / cooling `2`,
  operation mode `3`, space heating ON/OFF `4`, room thermostat heating `6` / cooling `7`, quiet mode
  `9`, DHW reheat setpoint `10`, LWT heating offset `54`, Smart-Grid mode `56`, power limits `57`/`58`
  (`Pow16`). All of them are telemetry-only here; `54` is read back as the independent record of
  whatever the Onecta app or the MMI last set.

Reading a holding register is not a step toward writing it — the hub's own telemetry is split across
both spaces, and a setpoint the plant is currently running to is a reading like any other.

Dimensionless status registers are classified centrally. Their public values remain the numeric
Modbus constants; the names below are applied only by the visual UI and come from the manufacturer's
§9.2 register tables:

| Space / offset | Meaning | Published value / visual state |
|---|---|---|
| input `21` | Unit abnormality | `0` / `1` / `2` → No error / Fault / Warning |
| input `30` | Circulation pump running | binary `0`/`1`, displayed `OFF`/`ON` |
| input `31` | Compressor running | binary `0`/`1`, displayed `OFF`/`ON` |
| input `32` | Booster heater running (DHW tank immersion heater) | binary `0`/`1`, displayed `OFF`/`ON` |
| input `33` | Tank disinfection operation | binary `0`/`1`, displayed `OFF`/`ON` |
| input `37` | 3-way valve | `0` / `1` → Space heating / DHW |
| input `38` | Current operation mode (API label disambiguates the guide's second "Operation mode") | `1` / `2` → Heating / Cooling |
| input `52` / `53` | DHW / space operation | binary `0`/`1`, displayed `OFF`/`ON` |
| holding `3` | Operation mode | `0` / `1` / `2` → Auto / Heating / Cooling |
| holding `4` / `9` | Space heating/cooling / quiet mode | binary `0`/`1`, displayed `OFF`/`ON` |
| holding `56` | Smart Grid operation mode | `0` / `1` / `2` / `3` → Free running / Forced off / Recommended on / Forced on |

The named enums retain their raw integer in `homehub_format()`, `/values`, MCP and MQTT. `/values`
carries a separate structural `enum` id so the browser can localise a known
state; an undocumented number remains visible as `Unknown (N)` instead of being silently coerced.
The flat MQTT payload therefore contains, for example,
`"smart_grid_operation_mode":2`, never `"smart_grid_operation_mode":"Recommended on"`. The eight
true flags retain the same numeric `0`/`1` contract plus the structural `binary:true` marker, and
only the visual boundary prints `OFF`/`ON`.

> **Physical correctness requires a hardware comparison.** The host tests (`test_homehub()` in
> `test/test_logic.cpp`) verify the *decode mechanics* — scaling, the special-value guard, `Text16`,
> the offset→PDU mapping, and that a negative temperature keeps its sign. Whether a given offset means
> what the guide says it means on *your* unit is a hardware check, the same rule the X10A domain audit
> exists to enforce ("passing the tests is not the same as being RIGHT", [`AGENTS.md`](../AGENTS.md)).

## Two independent stacks

**The HomeHub is a second SOURCE, not an alternative transport, and there is no selector between
them.** X10A and Modbus run at the same time, as separate FreeRTOS tasks with separate caches and
separate link states. Neither notices the other failing.

That is a deliberate correction of an earlier design in which `transport` chose one *or* the other.
Modelling them as interchangeable was wrong about the hardware: a UART tap on the pump's service port
and a TCP client to a LAN accessory share no wire, no framing, no register model and — the part that
matters — **no failure mode**. X10A dies at the cable, a pin or the framing; Modbus dies at the LAN,
mDNS or the hub. Coupling them lets either failure mask the other.

What that buys, concretely:

* Pull the service cable and the HomeHub keeps reporting. Lose the LAN and X10A keeps polling.
* **A device with no configured HomeHub has no cost.** Empty configuration performs no discovery and
  creates no task, socket or traffic — which is also why `hp_poll` could give
  back the 4 KB an earlier revision had taken from it (its stack is 8192 again; the
  `getaddrinfo`/mDNS/socket call chain now lives on the task that actually makes those calls).
* Disabling it live retires the task: it checks the flag at the top of its cycle and deletes itself.

| | X10A | Modbus (HomeHub) |
|---|---|---|
| Task | `hp_poll` (8192) | `hp_modbus` (6144, only when an address is saved) |
| Cache | `hp_values_snapshot()` | `mb_values_snapshot()` |
| State | `/status.hp` | `/status.modbus` |
| Rows | ~100 | 32 |
| Fails on | cable · pin · framing | LAN · mDNS · hub |

## What one cycle asks for

The hub is **shared**. The Onecta app, the unit's MMI, evcc and any metrics collector on the LAN all
talk to the same `:502`, so how much this firmware asks for is a question about someone else's
device, not only about ours. It used to ask for one register per request, once per second: **32 MBAP
round-trips a second, ~2.8 million a day**, for a map whose fastest-moving member is a water
temperature.

[`main/logic/modbus_plan.hpp`](../main/logic/modbus_plan.hpp) is the answer, and it is pure so that
its two silent failure modes are asserted rather than discovered in the field — a run built one
register short stops refreshing the last row of every batch (the row still decodes and still
publishes; it is merely frozen), and a cadence that never fires a full cycle leaves the cache at
whatever the first cycle read.

* **Batching.** The 32 EKRHH offsets fall into **ten contiguous runs** across the two function
  spaces, so a full cycle is ten requests. The per-request cap is 16 registers, far below the
  protocol's 125: a batch is the unit of *loss* as much as of saving, and the longest run here is six.
* **Two cadences.** A **full** cycle every fifth poll tick; the four between it read three fast
  batches. Two carry the diagnosis gates — input register 53 (normal space operation) and 38
  (heating rather than cooling). The third carries input 44, optional plant outdoor context which
  legacy-441 requires from the same current cycle. It is explicitly **not** a gate. The extra 40–45 batch
  is one deliberate bundled request; borrowing the five-second cache would not establish event-time
  freshness. Neighbouring registers ride these batches because leaving them out saves no request.
* **Five poll ticks.** Chosen from the *dashboard*, not from how fast the values move: the
  browser polls `/values` every two seconds, and a HomeHub reading up to ten seconds old beside a
  one-second X10A reading of the same quantity invites exactly the "which of these is current?"
  question the two-array `/values` shape exists to make answerable. This is nominal cadence with
  short replies; bounded network waits add time and are included in the separate cache-age bound.
* **A fast cycle commits no value cache.** Its thirteen gate/context-batch registers are not a cache and its
  position on the raster is not a sample, so `/values` and the trend rings stay with the last full
  cycle rather than publishing thirteen rows and 18 apparent read failures. Network waits add to
  the intervening poll delays. `connected` reports this cycle's transport state; reply age detects
  stalled progress independently of the larger full-cache allowance.
* **An exception splits its batch.** A Modbus exception is a valid reply about **one** register, and
  a batched request cannot say which — so a batch that excepts is re-read register by register, and
  stays split for the session (the usual cause, a register this hub does not implement, does not go
  away). A reconnect forgets it: a different hub deserves the cheap plan again.
  Every read request, including each fallback single read and profile probe, feeds the task watchdog
  before transport begins; feeding once per batch does not bound a slow split batch.
* **Only a full cycle proves recovery.** `/status.modbus` carries one current error for the whole
  map. A clean fast cycle did not re-read a failing full-cycle row, so it cannot clear that error;
  otherwise `/status`, `/diag` and Syslog would oscillate between failure and recovery every five
  seconds without evidence that the row recovered.

Transport progress does not renew an earlier measurement. Gate53, heating-mode38 and outdoor44
each retain the successful response's monotonic observation time and expire individually after the
existing seven-second project bound. The full cache retains its separate 537-second bound, including
bounded slow fallback requests; `/status.modbus.values` stops counting it when it expires, even if
fast-cycle replies continue. These bounds are liveness filters, not proof of simultaneous measurements.
A target change immediately resets the public profile to Auto/Probing, before name resolution;
only work for that target generation can publish a new classification.

**32 → 4.4 requests/poll-second, ~380 000 a day.** The plan is resolved at compile time and lives in flash;
`hp_modbus.cpp` `static_assert`s that batching still collapses the map, so a future register added
into a gap re-prices the link visibly instead of quietly restoring the per-register sweep.

## Daikin Altherma 4 Modbus TCP support

In addition to the EKRHH 32-register map, the firmware implements a native **Daikin Altherma 4**
read-only subset. Its physical acceptance is pending; it has not been compared with an Altherma 4.

### Extended register catalog

The documentary source is [Daikin Configuration reference guide 4P773396-1C (2026.02)](https://www.daikin.gr/content/dam/document-library/configuration-reference-guide/heat/air-to-water-heat-pump-high-temperature/epbx10a9w/EPBX%28U%2907A.EPBX%28U%2910A4V.EPBX10A9W.EPBX14A4V.EPBX%28U%2914A9W.EPSX%28B%2907A.EPSX%28B%2910A.EPSX%28B%2914A.EPVX07%28U%29A.EPVX%2810.14%29%28U%29A4V.EPVX%2810.14%29A9W_Configuration%20reference%20guide_4PEN773396-1C_English.pdf),
MMI software v3.x.x, §7.2. Host tests check the documented codecs and enum constants; they do not
verify the values on a machine. The implemented subset has **42 registers**, including the 11
extended input registers below. Native holding 57 is unlisted and is absent from the native
read plan; Auto still polls the EKRHH baseline before a successful native probe.

| Register (FC04 Input) | Type | Unit | Meaning | Description / Pairing |
|---|---|---|---|---|
| `65` | `Int16` | | Demand response mode | Smart grid / demand response operating mode |
| `66` | `Int16` | `%` | Bypass valve position | Bypass 3-way/mixing valve position |
| `67` | `Int16` | `%` | Tank valve position | DHW tank valve position |
| `68` | `Int16` | `%` (assumed) | Circulation pump speed | Existing interpretation retained; guide prints a conflicting L/min unit |
| `74` | `Temp16` | `°C` | Water temperature pre-PHE outdoor | Before the outdoor plate heat exchanger |
| `75` | `Temp16` | `°C` | Leaving water temp tank valve | Leaving water temperature at tank valve |
| `76` | `Temp16` | `°C` | DHW temp upper | Dual-sensor DHW tank upper temperature |
| `77` | `Temp16` | `°C` | DHW temp lower | Dual-sensor DHW tank lower temperature |
| `79` | `Int16` (÷100, assumed) | `bar` (assumed) | Water pressure | Existing centibar interpretation and X10A pairing retained, physically unverified |
| `80` | `Temp16` | `°C` | Heating/cooling target, main zone | Main-zone water temperature target |
| `83` | `Int16` | | Unit operation mode | Current operational state |

### Profile-specific meaning

| Space / offset | Native Altherma 4 constants or meaning |
|---|---|
| input `38` | `0` None, `1` Heating, `2` Cooling; separate from EKRHH's current-mode enum |
| input `65` | `0` Free, `1` Forced off, `2` Forced on, `3` Recommended on, `4` Reduced |
| input `83` | `0` Stop, `1` Tank heat-up, `2` Space heating, `3` Space cooling, `4` Actuator |
| holding `9` | `0` Off, `1` Automatic, `2` Manual quiet selection; **not current quiet activity** |
| holding `54` | Weather-dependent heating offset for the main zone |
| holding `58` | Imposed electrical power limit; protective operation can exceed it |

The native quiet selection is not paired with X10A's quiet-active bit or recorded as a quiet-active
history. The guide defines current activity separately as discrete input 12; this client currently
issues only FC03/FC04. Automatic schedules and manually selected levels can be Off. Native
`quiet_state` is consequently absent from the offered Modbus histories and returns 404 if requested.

Every cached row carries the immutable definition that decoded it. API/MCP enum, binary and text
metadata, as well as MQTT keys, use that snapshot-owned definition, never a later global profile or
a base-first offset lookup. Native `/values` rows carry `profile: "altherma4"` for localized meaning.
Unknown enum constants remain numbers and display as unknown. Public offset-only selectors require
unique offsets within each shipped catalog; compile-time checks reject FC-space collisions.

### Batch compression

The native subset uses **15 contiguous batches** (6 holding, 9 input). Removing unlisted holding 57
splits 56 and 58 into separate requests; the native request count is pinned at compile time and in
the production-runtime contract. EKRHH batching is unchanged.

### Deferred physical acceptance

The existing input 49 `/100` flow conversion, input 68 percentage unit and input 79 `/100` pressure
conversion are retained pending real-device evidence. The native guide does not document the extra
flow scale, prints L/min for pump speed and gives an ambiguous 10–600 bar pressure range. These
outputs, pressure pairing and pressure-based profile selection must not be treated as confirmed
physical measurements or verified model identification. The native value explainers also state the
unverified flow/pump/pressure interpretations in every shipped language. The sentinel filter remains a conservative
project rule; the guide explicitly documents unavailable 32766 for input 23 but does not establish
the complete EKRHH sentinel vocabulary for every native row.

To complete HUB-02, record the matching model/MMI version and compare raw registers 49/68/79 with
simultaneous controller readings or independent references across more than one operating point.
Confirm profile selection and compare the corrected enum states, quiet selection versus discrete
input 12, and available native holding registers. No simulator, host test or ordinary
HomeHub bench run substitutes for that physical acceptance. HUB-02 remains open until this evidence
resolves the assumptions and any necessary follow-up fixes pass their own checks.

### Automatic profile detection and fail-closed fallback

Detection is **100% automatic** at runtime without requiring any UI configuration:

1. **Initial session state (`Auto`):** When connecting to a new target host, port, or unit ID (`status_socket_open`), the active profile begins in `Auto`.
2. **Safe baseline polling & probing:** In `Auto`, the firmware reads the safe 32-register base HomeHub map (`MB_PLAN`) and performs a single probe request on register 79 (water pressure, `MODBUS_PROBE_REGISTER`) at the end of each full cycle.
3. **Promotion to `Altherma4`:** If probe register 79 successfully returns valid data in the plausible hydronic range (0 < pressure <= 6.0 bar), `s_probe_tracker` selects `ModbusProfile::Altherma4` using the existing heuristic. The baseline rows are discarded, only the probe row is published for that cycle, and the next poll performs a complete 42-register native sweep. This avoids publishing native quiet/mode values through baseline semantics. The protocol answer is not physical model verification.
4. **Fallback behavior:**
   - **Affirmative `HomeHub` answer:** When connected to an Altherma 3 / EKRHH unit, register 79 returns `32767` (`MB_UNSUPPORTED`, verified on EKRHH hardware) or Modbus Exception 02 (*Illegal Data Address*). The firmware evaluates this affirmative response via `logic::evaluate_probe_result()`, definitively setting `ModbusProfile::HomeHub` without incrementing `rx_fail` or dropping the link. The UI and `/status` remain green and healthy, reporting the 32 valid base registers.
   - **Transport failure branch:** If a probe request encounters a transport error (timeout, connection closed), the connection is dropped (`link_ok = false`, socket closed) without incrementing `rx_fail`. The profile stays in `Auto` across reconnects until `MODBUS_PROBE_MAX_RETRIES` (3) consecutive probe failures are reached, after which it falls back to `ModbusProfile::HomeHub` (`profile_basis: fallback`). During probe-cycle transport drops, `/values` remains unrefreshed for that cycle (`connected = false`).
   - **Invalid value branch:** If probe register 79 returns an implausible value (`0` or `> 6.0 bar`), the connection remains open, but after 3 consecutive invalid readings it exhausts the probe retry budget and falls back to `ModbusProfile::HomeHub` (`profile_basis: fallback`).
   - **Unavailable (`MB_UNAVAILABLE`):** Unavailable is not capability evidence; it follows the non-affirmative retry/fallback path.
   - **Hub syncing (`MB_WAIT`):** While register 79 returns `32765` (`MB_WAIT`, hub syncing/booting), the probe continues to run on every full cycle, but does not consume the retry budget and leaves the profile in `Auto` without counting as a failure.
5. **Sticky profile across reconnects & periodic back-off:** While connected to the same target endpoint (`host:port:unit_id`), an affirmatively detected profile (`HomeHub` or `Altherma4`, `profile_basis: affirmative`) is remembered in RAM across TCP reconnects to avoid repetitive probe churn. Non-affirmative exhaustion fallback defaults to `HomeHub` for safety, then periodically re-probes with exponential backoff (starting at 10 minutes, doubling up to a 4-hour cap) to accommodate transient startup conditions such as circuit filling or temporary network drops. Changing the target host, port, or unit ID resets all tracker state immediately.

## How the two sources meet

In exactly one place: [`main/logic/homehub_map.hpp`](../main/logic/homehub_map.hpp), which says which
HomeHub register is the **same physical quantity** as which X10A row. Nothing else in the firmware
pairs them.

**The pairing may never be made on the label.** The catalog spells one quantity many ways across the
39 detection profiles (four spellings of leaving water, one with a double space) and *reuses* tags
across different quantities — `(R1T)` is both the outdoor air sensor on `0x20` and the indoor
leaving-water sensor. A label match would be incomplete and wrong, which is the mistake
`lwt_select.hpp` and `ou_stale.hpp` exist to prevent. A wrong pairing is worst in the fallback case
below, where the Modbus value stands alone under the X10A row's name with nothing beside it to look
implausible against.

The vocabulary is therefore **`logic/history.hpp`'s trend ids**, reused rather than reinvented: a
trend is already "one physical quantity, addressed structurally by (register page, byte offset,
unit, plus converter where a byte contains several bits)", and the catalog test already proves each
locator resolves to exactly one row per profile. A
`static_assert` pins every pairing to a real trend id, so a renamed trend is a build error rather than
a pairing that silently stops happening.

Eight measurements plus three state pairs, and — measured across the catalog — **all eleven resolve on all
39 detectable profiles**: pre- and post-BUH leaving water, return water, DHW tank, outdoor air,
liquid refrigerant, flow, room temperature,
booster-heater run (HomeHub input `32` ↔ X10A BSH converter `305`) and 3-way-valve position (input
`37` ↔ converter `306`), and EKRHH Quiet mode (holding `9` ↔ X10A `0x60/2`, converter `301`).
Native Altherma 4 holding 9 reports selection and is excluded from this activity pairing. The rest carry no pairing on
purpose, each for a stated reason: the real power measurement has
no X10A equivalent at all (X10A estimates it from CT clamps at an assumed 230 V, so pairing a
measurement with an estimate would hide which is which); other setpoints, modes and faults are not readings.
Disinfection input `33` is likewise deliberately unpaired: X10A `0x62/8` converter `303` is named
**Tank preheat**, a preparatory state rather than proof that disinfection is active. Both receive
their own event timeline, so their timing can be compared without merging their meaning.

## Where the readings go

`/values` carries the two sources as **two arrays** — `values` (X10A) and `modbus` — mirroring the two
stacks. They are not merged: the two have separate liveness, and merging would make "is this reading
current?" a per-row question no consumer could answer. Each row on both sides carries its `concept`
where one exists; a Modbus-only timeline additionally carries `history` without acquiring a false
X10A pairing.

The `modbus` array is emitted **only while the link is live at the moment the snapshot is taken** —
not merely while the stack is configured, and not merely while it was connected when the request
arrived. Its rows belong to that live session's latest **full** cycle, subject to the 537-second
full-cache and seven-second reply-age bounds described above; bounded network reads add to the
four intervening fast polls. At native promotion, the answered pressure probe alone is exposed
until the following full native sweep. Fast cycles update link, diagnosis-gate state and the sealed
input-44 event context without turning their thirteen rows into a partial cache. These are transport
limits, not proof that every row was observed simultaneously. Liveness and the cache sit behind two
different mutexes, so every successful TCP connect gets a generation and every cache commit records
the generation that produced it. `mb_values_snapshot()` reports live only when the post-copy link
state is connected **and** its generation matches the copied cache. That closes both directions of
the race: a disconnect after the copy, and a reconnect that becomes live after an old cache was
copied. When it is not live the **key is omitted entirely** rather than emitted empty: an absent
array and an empty one are different claims, and only absence says "no current reading". A device
without a HomeHub therefore sees exactly the payload it saw before this feature existed.

In the **web UI** (see [`DESIGN.md`](DESIGN.md)), X10A stays the prominent source everywhere and
Modbus readings are marked in their own colour — a petrol token (`--src-mb`) that is neither a state
colour (`--ok`/`--warn`/`--err`) nor a temperature one (`--flow-*`), because provenance is a third
thing. The Settings connection row is link state rather than reading provenance, so it uses the same
green/yellow/red state colours as WiFi, MQTT, Syslog and NTP:

* **Both up** — the row shows the X10A value, unmarked. Tapping it opens the explainer, and the
  gateway's reading appears at the **end** of the body, after the "Normal:" note: a full row carrying
  the *Modbus register's own label*, the badge and the value, then the **difference** between the two.
  It sits last, not first, because a reader opens an explainer to find out what the quantity *is* —
  the row's own value is already stated an inch above, in the header they just tapped. The label is
  the gateway's rather than the X10A row's on purpose: this line is what someone verifying a pairing
  on real hardware reads, and reusing the X10A label would show them their own assumption back.
  A wide gap is left to speak for itself rather than coloured as an error — the two sensors
  legitimately sit at different points in the circuit.
* **X10A down, HomeHub up** — a banner says so, and each row it can supply shows the **Modbus** value
  in petrol. A row it cannot shows `—`; a stale X10A number is never left standing. The schematic
  follows the same rule, which makes it visibly sparse — about a dozen registers against a hundred —
  and that is the honest shape of the state. **No comparison is shown here at all**: a *second*
  opinion presupposes a first one, and the only X10A number still in memory is one the bus stopped
  refreshing, so a "difference" against it would be a statement about two *instants* wearing the
  shape of a statement about two *instruments*.
  ΔT and heat output survive, because both sides of each come from the one source and nothing is
  mixed across boundaries. **The COP does not.** It looks like the same arithmetic and is not: the
  gateway measures the *whole unit's* electrical input, backup and immersion heater included, while
  the heat figure is across the plate exchanger alone — precisely the boundary mismatch
  [`cop_scope.hpp`](../main/logic/cop_scope.hpp) refuses, and one that collapses exactly when a
  heater fires, reading as a failing heat pump while nothing is wrong. The gateway now carries the
  compressor and tank-heater states, but not the BUH stage state and all source-boundary evidence the
  quotient needs, so the answer remains: publish nothing, and name the reason
  (`feature_gate.hpp` — disable, never degrade).
  The electrical input itself *is* better here, since the HomeHub measures what X10A only estimates
  from CT clamps at an assumed 230 V — read from input register **51** by its offset, never by its
  unit, because the map carries three `kW` rows and the other two are the power *limit* setpoints.
* **No HomeHub** — nothing Modbus appears anywhere: no row, no group, no comparison, no banner.

Registers with no X10A counterpart get their own group at the very end of the value list, after
everything X10A carries.

**MQTT preserves the two sources instead of merging them.** X10A is retained as grouped JSON on
`<base>/x10a`; an enabled HomeHub publishes its separate flat map on `<base>/modbus`. A disconnected
HomeHub sends `{}` and Off retracts that data topic. Publication follows the atomically installed
target intent, not the retiring worker's lagging status. A cleanup attempt suppresses Modbus state
for the rest of that MQTT cycle, so Off cannot tombstone and immediately recreate `{}`; an enabled
A-to-B cutover may publish B's empty pre-first-sample state from the following cycle. The Modbus
stream deliberately has no Home
Assistant discovery: publishing both sources as HA entities would create two sensors for every shared
quantity and hide which instrument is fresh. HomeHub link health rides the heartbeat
(`modbus_enabled`/`modbus_connected`/`modbus_rx`/`modbus_fails`, payload-only). On upgrade, bounded
exact-topic probes delete old retained `<base>/state` and `<base>/modbus/status` values only when the
broker returns a non-empty retained payload; later reconnects are silent on already-clean topics.

## Configuration

Everything is runtime — no reflash, and no reboot.

| Field | Meaning |
|---|---|
| `mb_host` | HomeHub IP or `.local`/DNS hostname; an explicitly saved empty value disables automatic discovery, task, requests and dependent diagnosis. Validated at most 512 chars — the atomic config blob rejects any longer string on read, which would discard the WHOLE saved configuration on the next boot, so an over-long address is a 400 |
| `mb_discovery_done` | Internal v18 latch. Fresh=false triggers the one initial networked search; every result and every explicit `mb_host` save sets true. Exposed read-only as `/status.modbus.searched` |
| `mb_port` | Modbus TCP port, default `502` (validated 1–65535) |
| `mb_unit_id` | Modbus unit id, default `1` (validated 1–247) |
| *(retired)* | The v9 `actuation_enabled` consent bit is no longer a config field. It is still present in the blob layout as a permanently-zero bit and is discarded on decode |

The host, port, unit and discovery latch are persisted in the atomic CRC-checked NVS config blob
(`main/logic/config_store.hpp`). Normal writes belong to httpd (`POST /set_hp`); the one automatic
write happens synchronously before httpd starts. Older blobs still decode without losing
credentials. A pre-v18 blob that already carries the HomeHub block migrates to searched=true because
its empty host may have been an explicit delete; only fresh/pre-HomeHub state auto-searches. The v9
actuation-consent bit is discarded on decode. HomeHub polling remains derived solely from a
non-empty `mb_host`.

> **Why v5 and not v4.** This block and the UI-language byte were developed in parallel and both
> claimed v4. main's language byte landed first and is already on published builds, so this took the
> later number. A second, different "v4" would have decoded that language byte as a HomeHub setting
> and switched a board onto a link it does not have, silently, on upgrade.

**Applied live.** `POST /set_hp` accepts `mb_host`, marks discovery complete and stages the target
fingerprint plus enabled bit before persistence. After the durable write it passes only that POD bit
to allocation-free `mb_reconfigure(bool enabled) noexcept`; a post-save Config copy therefore cannot
turn success into a false 503 or lose retained cleanup. A non-empty address starts/reconnects the
task; clearing it flips the atomic task intent, which is checked before TLS delays and Config
snapshots at the top of the next cycle, so even allocator pressure retires the sole socket owner.
`POST /discover_homehub` is
separate: it runs the bounded manual search and returns `{ok:true,host:"<IPv4>"}` without saving or
reconfiguring anything.

**Web UI:** the HomeHub appears as its own row in Settings → Connections — never folded into a
combined link state with X10A, since either can be down alone and one merged "connected" would hide
exactly the case worth seeing. Its value is the active `host:port`, and its colour follows the shared
connection-state vocabulary. Config and diagnostics only; there are no pump controls, by design.

**API:** `/status.modbus` carries the link/config fields (including `searched` and detected `profile`:
`auto` \| `homehub` \| `altherma4`), `task_stack_min_free_bytes` (this task's
worst stack headroom in bytes, from the one sampler all five watched stacks report through
— `main/stack_watch.hpp` — so this surface and the MQTT heartbeat's `modbus_stack_min_free_bytes`
cannot answer the same question with two numbers; `null`, not `0`, when the task has never run,
which on a board with no HomeHub is always) and the
plant-gate pair `plant_gate_known` / `plant_gate_active` (input register 53 — the one HomeHub fact the
shadow controller consumes). There is no actuator object: it was removed with the write path. `host`
is the configured value and is redacted in bug reports. See
[`../README.md`](../README.md).

## Security

The threat model is in [`SECURITY.md`](SECURITY.md); the parts specific to this link:

* **`:502` is unencrypted and has no Modbus-level credential.** There is no user, password or token —
  the SKI/QR trust mechanism in the guide is EEBUS-only, not Modbus. On a shared LAN *any* host can in
  principle write to the hub. That is a property of Modbus/TCP, not something this firmware can fix:
  **segment or firewall the HomeHub's `:502`** so only this device reaches it. TLS `:802` is the hub's
  only on-wire protection and is out of scope here.
* **The firmware cannot write the hub at all.** The unauthenticated
  `HA → MQTT/HTTP/MCP → raw Modbus → pump` chain does not exist, and not merely because no route is
  exposed: there is no write primitive to route to.
* **mDNS discovery trusts LAN multicast**, so both the one initial search and the manual Search
  action accept only responders whose hostname matches `homehub-*` rather than whatever answers
  first. A manually entered address is the user's trusted-LAN choice.

## Out of scope

Modbus **RTU / RS-485** (needs a transceiver + DE/RE, absent on the reference boards), Modbus **TLS
`:802`**, **UC4** air-to-air and **UC5** EEBUS. Actuation of any kind is out of scope.
