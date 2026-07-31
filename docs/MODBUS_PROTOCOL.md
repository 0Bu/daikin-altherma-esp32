# Modbus TCP — the Daikin HomeHub link

> **Status: READ-ONLY, and that is a design stance, not a phase.** This firmware speaks Modbus TCP to
> a **Daikin HomeHub (EKRHH)** as a second, independent source beside the X10A service-port tap. It
> **reads**; it does not write. There is no write function in `main/hp_modbus.cpp`, no command topic,
> no writable HA entity and no HTTP endpoint that can set a pump register — verifiable by `grep`.
> An in-firmware actuation path is planned separately (issue #32 P3) and is gated by the persisted
> `actuation_enabled` flag, which today gates nothing because nothing writes.
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

This phase builds the **second source and its read path** only: discovery, connection, register decode,
telemetry into the same cache every other surface reads, and link diagnostics.

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
| Function codes | FC03 read-holding, FC04 read-input (both used). FC06/FC16 write are implemented in the pure framing header but **called by nothing** |

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
number — the `#35–#39` failure shape this project exists to avoid.

**Compatibility is not unconditional.** The Modbus register set requires Unified MMI2 firmware
≥ 7.8.0 on the audited ERGA-EV / EHBH / X-E family, and individual registers can be inoperative per
model (holding registers 59 and 61 are documented as not operational on Micon 20002203: a read
returns the `32766` sentinel and a write is rejected by the hub).

## Discovery — mDNS, with a manual fallback

§2.5, verbatim: *"Multicast DNS (mDNS) is needed for the discovery of the Daikin HomeHub, which
advertises on the `_http._tcp.local.` service."* Three consequences shape the implementation:

1. **The advert is the hub's HTTP server on port 80, not a Modbus SRV record.** mDNS yields the
   host/IP only; the client then connects Modbus on the well-known port **502**.
2. **`_http._tcp` is noisy — and this firmware is one of the responders** (`main/wifi.cpp` registers
   its own `_http._tcp` advert). A browse is therefore filtered by the hub's stable hostname prefix
   `homehub-*` (`is_homehub_hostname()`, `logic/modbus.hpp`); without that filter the device could
   try to talk Modbus to itself or to an unrelated HTTP device.
3. **mDNS needs a single subnet and multicast/IGMP.** A manual host is therefore mandatory as a
   fallback, not a nicety.

**How it behaves:** HomeHub configuration has three explicit modes. **Auto** is the default on a new
or upgraded board. Each boot browses `_http._tcp` up to three times, accepting up to 64 responders per
browse, then stops for that boot if none has a `homehub-*` hostname. The larger cap matters on real
home LANs: a 20-result cap can exclude the HomeHub solely because mDNS result order is unspecified.
A successful search puts the responder's IPv4 A record in `/status.modbus.host` for that session and
starts polling. Neither the address nor a negative search result is persisted; the next boot searches
again, so a missed multicast response or DHCP lease never becomes durable configuration. Selecting
Auto in the UI again re-arms the bounded search immediately.

**Manual** uses the entered IP, `.local` name or ordinary DNS name verbatim and performs no discovery.
**Off** is only an explicit user choice (clearing/removing the address in the legacy API maps to Off)
and is the only state that suppresses future boot searches. If several `homehub-*` responders answer,
the first resolved IPv4 is used and the count is logged to `/diag` rather than silently guessed at.

Every active failure is exposed as complete English `error` text plus structured `error_code`,
`error_detail` and (for reads) `error_register` fields. The UI localises the structured cause as a
quiet red line below the address. The same transition is written through `diag_printf`, which means
it reaches both `/diag` and configured Syslog; repeated one-second retries do not spam the log, and a
clean poll records recovery. Transport failures stop the current register sweep immediately so the
first timeout/refusal/closed/invalid-response cause cannot be overwritten by later reads on a socket
that is already closed.

## The register map

`main/def/homehub.hpp` — the Modbus counterpart of the X10A `def/` profiles, and the only place a
HomeHub register's meaning is written down in this repo. Each row is
`{offset, space (FC04/FC03), MbType, scale, unit, label, value kind}`. The value kind is essential:
the guide encodes ordinary numbers, binary flags and multi-state selectors alike as `Int16`, so the
wire type alone cannot tell a UI whether `1` means one, ON, Heating, Fault or DHW.

Read today (UC3 Daikin Altherma):

* **Faults** (input): unit error active `21`, error code `22` (`Text16`), sub-code `23`
* **Temperatures** (input, `Temp16`): leaving water PHE `40` / BUH `41`, return `42`, DHW tank `43`,
  outdoor air `44`, liquid refrigerant `45`, room `50`
* **Flow + power** (input): flow `49` (`Int16`, L/min ×100), power `51` (`Pow16`, kW)
* **Setpoints and modes** (holding, read back **read-only**): LWT main heating `1` / cooling `2`,
  operation mode `3`, space heating ON/OFF `4`, room thermostat heating `6` / cooling `7`, quiet mode
  `9`, DHW reheat setpoint `10`, Smart-Grid mode `56`, power limits `57`/`58` (`Pow16`)

Reading a holding register is not a step toward writing it — the hub's own telemetry is split across
both spaces, and a setpoint the plant is currently running to is a reading like any other.

Dimensionless status registers are classified centrally. Their public values remain the numeric
Modbus constants; the names below are applied only by the visual UI and come from the manufacturer's
§9.2 register tables:

| Space / offset | Meaning | Published value / visual state |
|---|---|---|
| input `21` | Unit abnormality | `0` / `1` / `2` → No error / Fault / Warning |
| input `30` | Circulation pump running | binary `0`/`1`, displayed `OFF`/`ON` |
| input `37` | 3-way valve | `0` / `1` → Space heating / DHW |
| input `52` / `53` | DHW / space operation | binary `0`/`1`, displayed `OFF`/`ON` |
| holding `3` | Operation mode | `0` / `1` / `2` → Auto / Heating / Cooling |
| holding `4` / `9` | Space heating/cooling / quiet mode | binary `0`/`1`, displayed `OFF`/`ON` |
| holding `56` | Smart Grid operation mode | `0` / `1` / `2` / `3` → Free running / Forced off / Recommended on / Forced on |

The four enums retain their raw integer in `homehub_format()`, `/values`, MCP, MQTT and Home
Assistant. `/values` carries a separate structural `enum` id so the browser can localise a known
state; an undocumented number remains visible as `Unknown (N)` instead of being silently coerced.
The flat MQTT payload therefore contains, for example,
`"smart_grid_operation_mode":2`, never `"smart_grid_operation_mode":"Recommended on"`. The five
true flags retain the same numeric `0`/`1` contract plus the structural `binary:true` marker, and
only the visual boundary prints `OFF`/`ON`.

> **Physical correctness is confirmed on hardware.** The host tests (`test_homehub()` in
> `test/test_logic.cpp`) verify the *decode mechanics* — scaling, the special-value guard, `Text16`,
> the offset→PDU mapping, and that a negative temperature keeps its sign. Whether a given offset means
> what the guide says it means on *your* unit is a hardware check, the same rule the X10A domain audit
> exists to enforce ("passing the tests is not the same as being RIGHT", `.claude/CLAUDE.md`).

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
* **A device with no HomeHub has no steady-state cost.** Auto uses one bounded discovery window per
  boot, then retires the task; Off skips even that. Afterwards there is no task, socket or traffic —
  which is also why `hp_poll` could give
  back the 4 KB an earlier revision had taken from it (its stack is 8192 again; the
  `getaddrinfo`/mDNS/socket call chain now lives on the task that actually makes those calls).
* Disabling it live retires the task: it checks the flag at the top of its cycle and deletes itself.

| | X10A | Modbus (HomeHub) |
|---|---|---|
| Task | `hp_poll` (8192) | `hp_modbus` (6144, only when an address is known or discovery is pending) |
| Cache | `hp_values_snapshot()` | `mb_values_snapshot()` |
| State | `/status.hp` | `/status.modbus` |
| Rows | ~100 | ~23 |
| Fails on | cable · pin · framing | LAN · mDNS · hub |

## How the two sources meet

In exactly one place: [`main/logic/homehub_map.hpp`](../main/logic/homehub_map.hpp), which says which
HomeHub register is the **same physical quantity** as which X10A row. Nothing else in the firmware
pairs them.

**The pairing may never be made on the label.** The catalog spells one quantity many ways across the
43 detectable profiles (four spellings of leaving water, one with a double space) and *reuses* tags
across different quantities — `(R1T)` is both the outdoor air sensor on `0x20` and the indoor
leaving-water sensor. A label match would be incomplete and wrong, which is the mistake
`lwt_select.hpp` and `ou_stale.hpp` exist to prevent. A wrong pairing is worst in the fallback case
below, where the Modbus value stands alone under the X10A row's name with nothing beside it to look
implausible against.

The vocabulary is therefore **`logic/history.hpp`'s trend ids**, reused rather than reinvented: a
trend is already "one physical quantity, addressed structurally by (register page, byte offset,
unit)", and the catalog test already proves each locator resolves to exactly one row per profile. A
`static_assert` pins every pairing to a real trend id, so a renamed trend is a build error rather than
a pairing that silently stops happening.

Six registers pair, and — measured across the catalog — **all six resolve on all 39 detectable
profiles**: leaving water, return water, DHW tank, outdoor air, flow, room temperature. The rest carry
no pairing on purpose, each for a stated reason: the post-BUH outlet is a *different measurement
point* (pairing it would be the substitution `lwt_select.hpp` refuses); the real power measurement has
no X10A equivalent at all (X10A estimates it from CT clamps at an assumed 230 V, so pairing a
measurement with an estimate would hide which is which); setpoints, modes and faults are not readings.

## Where the readings go

`/values` carries the two sources as **two arrays** — `values` (X10A) and `modbus` — mirroring the two
stacks. They are not merged: the two have separate liveness, and merging would make "is this reading
current?" a per-row question no consumer could answer. Each row on both sides carries its `concept`
where one exists.

The `modbus` array is emitted **only while the link is live at the moment the snapshot is taken** —
not merely while the stack is configured, and not merely while it was connected when the request
arrived. That is a payload invariant worth stating, because it is the whole difference between a
reading and a memory: **if the array is present, every row in it was read this cycle.** A consumer
cannot tell a stale row from a fresh one by looking at it, so the guarantee has to live in the
payload rather than in a check each client remembers to make. Liveness and the cache sit behind two
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
  heater fires, reading as a failing heat pump while nothing is wrong. The gateway map carries
  neither the compressor state nor the heater states, so there is nothing to decide it *with*, and
  the answer is the one this firmware gives everywhere else: publish nothing, and name the reason
  (`feature_gate.hpp` — disable, never degrade).
  The electrical input itself *is* better here, since the HomeHub measures what X10A only estimates
  from CT clamps at an assumed 230 V — read from input register **51** by its offset, never by its
  unit, because the map carries three `kW` rows and the other two are the power *limit* setpoints.
* **No HomeHub** — nothing Modbus appears anywhere: no row, no group, no comparison, no banner.

Registers with no X10A counterpart get their own group at the very end of the value list, after
everything X10A carries.

**MQTT publishes the X10A cache only.** Publishing both would put a second HA entity on every quantity
they share — two "DHW tank temp" sensors that disagree slightly — which is a worse answer than one.
The HomeHub's *link health* still rides the heartbeat (`modbus_enabled`/`modbus_connected`/`modbus_rx`/
`modbus_fails`, payload-only: no HA entity, since a stack most devices never run would be an always-off
diagnostic to rule out).

## Configuration

Everything is runtime — no reflash, and no reboot.

| Field | Meaning |
|---|---|
| `homehub_enabled` + `mb_host` | Persistent user intent: enabled + empty = Auto, enabled + address = Manual, disabled = Off |
| `mb_dhost`/`mb_searched` | Runtime-only Auto outcome: IPv4 found this session and whether this boot's bounded search completed |
| `mb_host` | Manual HomeHub IP or `.local`/DNS hostname; empty in Auto and Off |
| `mb_port` | Modbus TCP port, default `502` (validated 1–65535) |
| `mb_unit_id` | Modbus unit id, default `1` (validated 1–247) |
| `actuation_enabled` | P3 safety flag, default **false**. Persisted; gates nothing today |

The user-intent bit, manual host, port, unit and safety flag are persisted in the atomic CRC-checked
NVS config blob (**v6**, `main/logic/config_store.hpp`) and written by exactly one task (httpd,
`POST /set_hp`). Older blobs still decode without losing credentials. v1–v4 and v5 both migrate to
enabled/Auto-or-Manual; only v6 can prove that the user deliberately selected Off. Discovery outcome
is RAM-only and therefore cannot silently create that persistent choice.

> **Why v5 and not v4.** This block and the UI-language byte were developed in parallel and both
> claimed v4. main's language byte landed first and is already on published builds, so this took the
> later number. A second, different "v4" would have decoded that language byte as a HomeHub setting
> and switched a board onto a link it does not have, silently, on upgrade.

**Applied live.** `POST /set_hp` accepts `mb_mode:"auto"|"manual"|"off"`, persists the user choice and
calls `mb_reconfigure()`. Auto starts/re-arms discovery, Manual reconnects to its address, and Off is
handled by the task at the top of its next cycle, so the socket keeps exactly one owner. For legacy
clients, a non-empty host means Manual and an empty host means Off.

**Web UI:** the HomeHub appears as its own row in Settings → Connections — never folded into a
combined link state with X10A, since either can be down alone and one merged "connected" would hide
exactly the case worth seeing. Its value is the active `host:port`, and its colour follows the shared
connection-state vocabulary. Config and diagnostics only; there are no pump controls, by design.

**API:** `/status` carries a `modbus{mode,enabled,connected,discovering,searched,host,port,unit_id,rx,fails,values,
actuation_enabled,error,error_code,error_detail,error_register}` block (the error fields are omitted
when healthy). `host` is the configured value or the IPv4 selected by discovery, so the UI shows what
was found rather than the empty string it was asked with. It is redacted in a bug report because it is
a LAN address. See [`../README.md`](../README.md)
and `.claude/CLAUDE.md` for the full HTTP surface.

## Security

The threat model is in [`SECURITY.md`](SECURITY.md); the parts specific to this link:

* **`:502` is unencrypted and has no Modbus-level credential.** There is no user, password or token —
  the SKI/QR trust mechanism in the guide is EEBUS-only, not Modbus. On a shared LAN *any* host can in
  principle write to the hub. That is a property of Modbus/TCP, not something this firmware can fix:
  **segment or firewall the HomeHub's `:502`** so only this device reaches it. TLS `:802` is the hub's
  only on-wire protection and is out of scope here.
* **This firmware is not part of that attack surface**, because it never writes. The unauthenticated
  `HA → MQTT → firmware → Modbus → pump` chain a generic Modbus-control bridge would create does not
  exist: no MQTT subscribe, no command topic, no writable entity, no HTTP write route.
* **mDNS discovery trusts LAN multicast**, so the target is confirmed by its `homehub-*` hostname
  before a connection is made rather than connecting to whatever answers first.

## Out of scope

Modbus **RTU / RS-485** (needs a transceiver + DE/RE, absent on the reference boards), Modbus **TLS
`:802`**, **UC4** air-to-air, **UC5** EEBUS, and the in-firmware actuation path (issue #32 P3) with
the on-device `esp-dl` decision engine that would drive it.
