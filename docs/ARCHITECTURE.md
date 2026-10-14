# Architecture

This reference describes the firmware's data flow, ownership, persistence and resource limits.
For setup use [SETUP.md](SETUP.md); for fields and requests use [API.md](API.md).
[FEATURES.md](FEATURES.md) indexes capabilities, [SECURITY.md](SECURITY.md) owns security boundaries,
and [MAINTENANCE.md](MAINTENANCE.md) owns build and delivery procedures.

## Design split

The ESP32-S3 reads a heat pump over X10A and optionally reads a HomeHub over Modbus TCP. It exposes
observations through HTTP, MQTT and a read-only MCP endpoint. It never controls the heat pump.

```text
X10A UART → detection/profile → poll cache ─┬→ HTTP /values → device UI
                                         ├→ MQTT state + HA discovery
                                         ├→ five-minute history
                                         └→ one-second diagnosis evidence
HomeHub TCP → independent register cache ──┬→ separate HTTP/MQTT observations
                                         └→ independent history and plant context
ENV III I²C → accessory cache ──────────────┬→ status/MQTT/history
MQTT room + circulation → bounded inputs ──┴→ read-only plant diagnosis
Open-Meteo HTTPS → optional forecast ─────────→ status/MQTT comparison evidence
```

X10A, HomeHub and ENV III have separate identity, cache, liveness and history. A HomeHub reading
never replaces X10A. Network transport (WiFi or Ethernet) carries these sources without changing
what they mean. Presence, freshness, held-over state and validity are separate facts; absent input
must not become zero, false or a fabricated source time.

## Component map

Production paths below are relative to `main/`; pure contracts are relative to `main/logic/`.
IDF-free headers own decoding, validation, planning and formatting; ESP-IDF adapters own hardware,
tasks and transport.

| Responsibility | Production owner | Pure contracts |
|---|---|---|
| Boot, network and task lifecycle | `main.cpp`, `net.cpp`, `wifi.cpp`, `task_config.hpp` | `net_link.hpp`, `link_watch.hpp`, `wifi_rollback.hpp` |
| Configuration and atomic persistence | `config.cpp`, `http_config.cpp` | `config_model.hpp`, `config_store.hpp`, `board_pins.hpp`, `board_presets.hpp` |
| X10A framing and detection | `hp_comm.cpp`, `hp_detect.cpp` | `crc.hpp`, `detect.hpp`, `detect_backoff.hpp`, `registers.hpp`, `uart_plan.hpp` |
| Conversion and polling | `hp_convert.cpp`, `hp_poll.cpp` | converters, `ou_stale.hpp`, `state_dwell.hpp`, `raw_capture.hpp` |
| HomeHub observations | `hp_modbus.cpp` | `modbus.hpp`, `modbus_plan.hpp`, `homehub_map.hpp` |
| Local accessory | `env3.cpp` | `env3.hpp` |
| MQTT publishing and external inputs | `mqtt_ha.cpp` | `ha_device.hpp`, `discovery.hpp`, `x10a_snapshot.hpp`, `mqtt_group.hpp`, `reference_temperature.hpp`, `circulation_source.hpp` |
| Forecast and diagnosis | `weather_forecast.cpp`, `checkup.cpp`, MQTT sampler | `weather_forecast.hpp`, `checkup.hpp`, `heating_curve_diagnosis.hpp` |
| History and duration evidence | `history.cpp`, `state_dwell.cpp` | `history.hpp`, `history_persist.hpp`, `state_dwell.hpp` |
| HTTP and MCP | `http_common.cpp`, `http_status.cpp`, `http_config.cpp`, `http_ota.cpp`, `mcp_server.cpp` | `http_surface.hpp`, `http_request.hpp`, `mcp.hpp`, `redact.hpp` |
| OTA and absolute download deadlines | `ota_update.cpp`, `http_deadline.cpp`, `http_client_diag.cpp` | `ota_manifest.hpp`, `ota_headroom.hpp`, `ota_quiesce.hpp`, `ota_transport.hpp`, `health_gate.hpp` |
| Crash, heap, stack and recovery | `diag_crash.cpp`, `heap_guard.cpp`, `safe_mode.cpp`, `stack_watch.hpp`, `recovery_button.cpp` | `crashinfo.hpp`, `heap_watchdog.hpp`, `reset_reason.hpp` |
| Logs, time and indicator | [diag_log.cpp](../main/diag_log.cpp), `syslog.cpp`, `sntp_time.cpp`, `status_led.cpp` | `timestamp.hpp`, `bootlog.hpp` |

The source-linked ESP-IDF component and configuration inventory is [ESP_IDF_MATRIX.md](ESP_IDF_MATRIX.md).
For host test organization and new logic coverage use [test/README.md](../test/README.md).

<a id="the-host-tested-logic-core-mainlogic"></a>
## Logic and value definitions

A `ValueDef` locates bytes by page, offset and width and names the converter, label and unit.
`def::resolved` combines a generated per-model table with supported supplements. Detection, the
poller, discovery, HTTP and MQTT must all iterate that same resolved view; a shorter sizing or
publishing table silently truncates observations.

Generated tables under `main/def/` come from the offline catalog pipeline. Deliberate corrections
belong in its override/adjudication layer. `overlay.hpp` is hand-written; `homehub.hpp`,
`altherma4.hpp` and `protocol_s.hpp` are curated source definitions. Converter meanings, enums,
byte layout and evidence
are maintained in [REGISTERS.md](REGISTERS.md), framing in [X10A_PROTOCOL.md](X10A_PROTOCOL.md).

New pure logic needs a focused host `CHECK`. Do not bury a converter, config validation or discovery
rule in a hardware-only adapter. Test the real catalog and published semantics, including invalid,
missing, sentinel and boundary inputs.

<a id="value-definition-profiles-runtime-selectable-models"></a>
<a id="auto-detection-protocol--model--hp_detectcpp--logicdetecthpp"></a>
## Detection

Every boot starts with model `auto`; model identity is RAM-only. The physical link is a persisted,
CRC-protected atomic `link` blob (RX, TX, protocol and observation identity). Its loaded pins are
validated against chip reservations and current board claims; an unusable pair falls back to the
build default, and an indicator, button or ENV III mapping on that final pair is disabled for the
boot (RAM only). Detection uses narrow,
revision-checked setters, never a whole configuration snapshot that could revert a concurrent save.

The poll task performs detection while the profile is `auto`:

1. Try the cached RX/TX pair and its reverse, then the build defaults and their reverse. Try cached
   framing first, then the other supported I/S framing. Filter every pair through current chip,
   board, sensor and detected Ethernet pin claims. Install the UART driver once and remap only
   permitted candidates; local bring-up/driver failures retain their cause rather than implying
   incorrect physical wiring.
2. Probe identity and profile pages with bounded retries; record page coverage and unit facts.
   Missing/rejected identity pages are expected; corrupt/partial frames and a silent link remain
   diagnosable. A protocol or page mask alone is not an exact model identification.
3. Rank compatible profiles using the actual fingerprint. Keep outdoor and indoor rated capacities
   separate; one is not a substitute for the other. Report candidates and ambiguity explicitly.
   `detect.model` contains only the name/family/marketing fields shared by all viable candidates;
   disagreement leaves unestablished fields null. With at most one candidate, the read profile
   supplies the fields; an explicitly API-selected profile remains a user statement.
   The selected decoder profile is not exact unit identity.
4. Commit a changed link only after detection proves it. An unchanged link needs no NVS write. Failed
   persistence leaves the prior complete blob intact and is reported in the diagnostic log.

On a silent bus, detection backs off from the normal one-second cadence toward 60 seconds by
skipping detection ticks. The watchdog still gets its per-second feed. A response, `/detect` or
link reconfiguration resets that backoff. Pin defaults and board capabilities are in
[BOARDS.md](BOARDS.md); wiring is in [WIRING.md](WIRING.md).

The receiver removes transmitted echoes and resynchronizes Protocol I preambles. Protocol S probes
page `0x50`, selects curated `protocol_s` and bypasses Protocol I signature/capacity ranking. When
frame corruption makes a detection sweep incomplete, two consecutive agreeing sweeps are required
before committing its profile. Ordinary timeout/NAK probes do not count as frame corruption.
A failed attempted sweep clears incomplete/no-match corroboration; skipped backoff ticks do not.
Protocol S and native Altherma 4 remain unverified without a matching physical capture in this repo.
Overlay eligibility follows row-identical generated tables, not the selected profile name.

<a id="the-poll-engine-hp_pollcpp"></a>
## Polling and source truth

One task owns the X10A UART. Each sweep builds the deduplicated page set from the resolved profile,
reads and CRC-checks each reply, converts in-range values and stages errors locally. A failed page
does not stall the remaining pages. The task commits the complete cache, revision and statistics
under one mutex, using non-allocating moves/swaps. Readers snapshot under the same RAII lock.

History, duration evidence and plant diagnosis consume the task-owned sweep before the cache
commit and outside its mutex. Avoid nested history/cache locks. The poll task is subscribed to the
20-second task watchdog and feeds it at the top of each cycle and once per page; progressing UART
I/O must not be mistaken for a stuck worker.
X10A liveness additionally requires a real reply less than 15 seconds old; cached connection state
alone is insufficient.
The cross-page saturation witness uses the preceding completed sweep's pressure observation time.
Unread cycles retire it, and it expires at the same 15-second source-age boundary. Without a fresh
witness, the conditional liquid-line zero filter leaves the reading available.

Outdoor pages can keep returning a previous run's values while the compressor rests.
`logic/ou_stale.hpp` classifies them from the page and a live compressor witness. HTTP keeps the
reading with `held:true`, history records a held gap, and MQTT withholds that row. A new payload
timestamp cannot make a frozen measurement fresh. Binary selectors and raw overlay bits keep their
specific semantics; a selected valve path or heater stage is not automatically an ON/OFF state.

`state_dwell.cpp` measures eligible switched/fault states. Its v4 record publishes observed elapsed
seconds, whether that duration is only a lower bound, and unread time. It books skipped polls and
restart blind intervals explicitly rather than extending a state through unobserved time.
A long blind interval removes duration
instead of reporting zero or uninterrupted certainty. Changes in source identity retire prior
state evidence. Bounded running-edge/periodic raw page capture supplements detection logs; it is
limited per boot so the log ring remains useful. Only nonempty captured page bytes spend its budget;
missing pages leave the edge or periodic capture pending.

HomeHub and native Altherma 4 Modbus use separate read-only profiles selected from current metadata.
`profile_basis` states the selection evidence; an unknown profile stays bounded rather than borrowing
the HomeHub map. Source/profile identity scopes values, freshness and history.
The Modbus task keeps a separate cache and session identity. Configuration changes stage a
replacement before durable commit, then perform a non-throwing task handoff. A deleted target
stops polling and future automatic discovery without interrupting X10A. Its register, pairing and
lifecycle contract is [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md).

## History and diagnosis persistence

Five-minute trend buckets and one-second diagnosis evidence answer different questions. Trend
buckets retain the last sample; they cannot reconstruct short cycling, transient faults or observed
heater runtime. `checkup_record()` accumulates those events, signal-specific coverage and minima
directly. [DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md) owns the actual rules and claim limits.
State-time integration requires readable interval endpoints; resumed readings do not fill blind
time. Read-time lifecycle span and source age remain separate from measured signal coverage.
Temporary TLS/allocation gaps preserve profile capabilities and age the evidence without renewing
source freshness. Historical readings expire even if polling stops.

History has two independent persistence paths:

| Medium | Restores | Acceptance and limits |
|---|---|---|
| `.noinit` DRAM | Compatible power-preserving resets without extra flash writes | Allowlisted reset reason, format, catalog fingerprint, CRC and matching X10A/HomeHub physical target scope; reject brownout/power glitch, unknown reset reasons and future anchors. The open bucket is discarded. OTA may move RAM and invalidate it. |
| `history` flash journal | Compatible records across power loss and OTA | Successful scan, compatible semantic catalog, matching X10A target or HomeHub host/port/unit scope, and synchronized wall time; restore by original absolute bucket, leaving downtime gaps. Live observations win overlap, including live absence. |

The journal occupies the upper 4 MiB of the official 8 MiB layout. Dense source records have a CRC
and a commit word programmed last; a torn slot is skipped without erasing older committed neighbors.
Erase sectors rotate over the partition. Record geometry grows by powers of two with a compile-time
minimum retention of 72 hours for all active sources. Old physical records remain wear reserve
until rotation reaches them.

Per-source semantic manifests name trend identity, locator, kind, converter and unit, excluding
labels. They allow unchanged curves to survive added or reordered rows. Duplicate ids, damaged
manifests or unknown pre-manifest catalogs fail closed. Bounded manifest-generation caches and
four-ring restore batches avoid a second full history matrix. The supported older catalog has an
explicit adapter; a genuinely new or reinterpreted series has no fabricated predecessor.
Re-detecting a different X10A target clears the prior target's indexed restore.

Only committed records restore after clock sync and a successful scan. Power loss can discard the
open bucket and queued records, so loss may exceed one interval. Adoption near a cursor can skip
up to two five-minute readings rather than file shifted samples. Before the first commit there is
no flash restoration guarantee. A bounded shutdown drain narrows the restart race. `/status.history.persist`
reports only this boot's `.noinit` verdict; it does not describe the independent flash scan.

RAM trend adoption additionally checks source-specific age, decode identity and witness identity.
Liveness gaps remain missing buckets. `history.epoch` plus the random per-boot `boot_id` identifies
the browser's current source generation. `/history` verifies that generation before emission;
stale snapshots return 503 and browser admission rejects superseded responses.
Measured producer pauses become explicit gaps; unmeasurable liveness fails closed. Quantization
remainder bounds rounding drift, but restart allowances and fault-to-reset time remain uncertain.
Circulation restore binds its exact mapping, gates and diagnostics generation; Modbus restore
binds space/codec/divisor/unit. A converter change under an unchanged X10A series identity can
retain old-scale samples for up to 24 hours. ENV III cannot identify a physical swap or relocation.
Disabled/frozen ENV III RAM is not adopted or journaled unless the producer ran then and runs now.

Future journal cursors are reported and never rewound; affected work waits for acceptable time.
Writes permit one slot retry and two abandoned sectors per failure episode, then retry at 60 seconds.

X10A, HomeHub and ENV III keep three separate source rasters; board memory and the circulation
witness share the X10A raster but keep RAM trends independent of heat-pump identity.
X10A journal append requires a resolved identity and no pending source reset; a pending reset also
skips that source's restoration. `b0`
aligns monotonic buckets even before SNTP; `t0` is omitted until wall time is known. Missing samples
stay gaps. Browser storage holds only a transient render frame during OTA, not measurement history.

Completed diagnosis hours restore only from the dated flash journal after SNTP and current source
confirmation; retained `.noinit` hours are never adopted. Records require a compatible fingerprint,
configuration, source identity and diagnostics generation. Circulation broker/mapping/interpretation
identity gates only DHW buckets; changed circulation must not retire independent X10A evidence.
A narrowly scoped one-shot DHW handoff may preserve an unfinished candidate; it cannot lend coverage
to completed checks. Disabling diagnostics clears runtime evidence; re-enabling starts a new
generation. Same-boot journal creation is not proof of reboot restoration. `DIAGNOSTICS.md` explains
results; `PLANT.md` owns lifecycle.
Current source confirmation requires this boot's full profile/link evidence, not cached startup
identity. Whole live and restored hours expire when their beginning leaves the rolling day,
independently of producer progress; abandoned open evidence expires too. The current 80-byte
diagnosis bucket changes its journal fingerprint and starts fresh after a format update; ordinary
trend records are unaffected.
The intentional-restart DHW handoff is consumed once; downtime/startup remains blind and can
invalidate it without incrementing ordinary abort counters.

The former small history partition is unsupported. OTA cannot install a partition table: an
old-layout device needs an explicitly authorized signed USB/Web Serial update to the official
8 MiB table. Existing NVS, coredump and OTA addresses remain fixed.

<a id="push-vs-poll-why-the-engine-polls"></a>
<a id="the-browser-polls-too-and-that-is-a-decision-not-an-omission"></a>
## HTTP and browser transport

The UI polls `/values` every two seconds and `/status` every eight seconds in one request chain,
backs off to 30 seconds while unreachable, and suspends ordinary polling while hidden. There is no
`/events` route or WebSocket broadcaster; building HTTP state never runs on the UART owner.
[DESIGN.md](DESIGN.md) owns user-visible states and modal behavior.

Registration goes through the common exception boundary. The open setup AP exposes provisioning;
the configured LAN exposes the full API. The surface follows whether that AP is running, not the
radio's STA mode. The exact trusted-LAN route count of 39 is checked against registration; fields,
route aliases, body limits and error behavior belong in [API.md](API.md).

The common HTTP admission guard rejects every non-OTA route during active OTA, including assets
and both diagnostic-log forms. It also refuses non-OTA work below a 6,144-byte contiguous internal
block. The loaded UI observes progress through compact `/ota/status`; reloading assets is unavailable.

Large status, value, history, log and MCP responses stream bounded chunks. Before first emission,
allocation failure becomes HTTP 503. After emission starts, close an incomplete stream rather than
trying to send a second response or unwinding through C dispatch. Status and MCP have explicit
incomplete-stream handling; values pre-stage and serialize without allocation. The outer guard
cannot safely replace an already-emitted `/diag` or `/history` response (the tracked HTTP-03 limit).
A snapshot remains internally
consistent even when another source updates during serialization; separately sampled sources do
not become one simultaneous physical observation.

<a id="home-assistant-mqtt-bridge-mqtt_hacpp"></a>
## MQTT ownership

The publisher owns HA discovery, retained state and its MQTT input subscriptions. The full topic,
identity, availability and timestamp contracts are in [MQTT.md](MQTT.md).
Its dedicated `mqtt_retire` NVS namespace stores only retirement provenance. This task-owned
record never restores configuration or detected identity; confirmed predecessor retirement and
fallible record save precede replacement discovery.

For X10A state, an allocation-free pass over the committed cache calculates exact payload size and
digest. Unchanged state stops there. Changed state reserves one exact local string outside the
mutex, then checks profile, observation identity and revision before encoding without growth.
Revision drift defers the cycle. Missing/held rows are skipped without constructing another vector.
The 12 KiB payload limit is a refusal ceiling, not a permanent reservation. Release the local payload
after synchronous QoS0 submission; commit the digest only after publish acceptance so `-1` is retried.

Room and circulation inputs decode on the owning MQTT client. Configuration/source epochs reject
queued frames from an earlier binding. A configured room timestamp mapping is the sole age authority;
missing source time stays unavailable rather than falling back to arrival time.
Their mappings may remain saved while
diagnostics are off, but subscriptions and captured state are dormant/cleared. A room mapping saves
directly; the circulation witness requires a current proof bound to behavioral fields. Retained
MQTT without a valid source timestamp is not fresh evidence. Forecast and heating-curve documents
carry explicit source and availability evidence and cannot issue a heat-pump write.

<a id="network-transport-wifi-or-the-optional-wire"></a>
<a id="wifi--lan-connectivity-reconnect--watchdog"></a>
## Network lifecycle

At boot, probe an optional W5500 only when its SPI pads are not already claimed by X10A, ENV III,
the indicator or the recovery button. A missing controller releases its bus/driver resources.
Cable negotiation has a short deadline; DHCP has a separate lease budget. If Ethernet has a lease,
do not start WiFi or an open setup AP. Otherwise try configured WiFi, then the setup portal.

DHCP hostname/vendor class and mDNS publish static product identity, root path and firmware version,
not private board/network identifiers. Ethernet's route priority exceeds WiFi for off-link traffic;
when both interfaces share a subnet, lwIP's first matching on-link route can still select either.
A wired boot that loses its cable restarts after about 30 seconds only when configured WiFi provides
a fallback, and defers that restart during installation. With no WiFi configured it waits for cable
recovery instead of entering a reboot loop.

WiFi lost-IP events withdraw the lease immediately; a stale address cannot prove connectivity.
WiFi disables modem sleep, selects the strongest AP through an all-channel scan and reconnects
without treating a normal disconnect reason as a reboot request. A credential change stores a
one-shot old-network backup. Sustained auth refusal at two 30-second checkpoints triggers rollback;
absent SSID/slow DHCP gets 180 seconds. A successful lease retires the backup. The sticky
`wifi.rolled_back` flag lasts until the next credential save. The gateway watchdog separates proven
silence from a blind probe: two silent periods or ten blind periods cause re-association.

SNTP starts after configuration load and provides wall time asynchronously. The configured server
string stays stable for lwIP's retained pointer; changing it reboots. Syslog is optional cleartext
UDP, with boot/crash replay and bounded diagnostic lines. Recovery decisions precede syslog
startup, so the boot record appends `cause`, `crash_boots`, `heap_restarts` and `nvs` to version,
ELF, reset reason and `safe_mode`; fields are only ever appended. `queue_dropped` counts queue
refusal, not confirmed collector loss; internal syslog diagnostics are filtered and delivery is
best effort.
Neither uptime nor the RAM log proves
that earlier boots did not occur.

<a id="ota-signing-partitions"></a>
## OTA and shared heap coordination

A boot-resident OTA worker owns manifest check, optional changelog and image download. The 11,776-byte
stack and control block are static and created before network services. Requests notify it; they do
not allocate a new delivery task beside a fragmented TLS heap. Artifact identity is one completed
check generation plus channel, version and application SHA. Acceptance atomically captures that
lease; the worker rechecks the manifest and complete downloaded digest before signed-image
validation and boot selection. [SECURITY.md](SECURITY.md) owns trust and rollback conditions.

OTA and Weather announce network ownership before TLS. MQTT stops its complete transport and
acknowledges; X10A, HomeHub and Syslog stand aside before allocation-rich work. An in-flight Weather
request gets a bounded unwind window; OTA wins future admission. A 1.1-second lead lets an existing
publisher cycle finish. Stale quiesce flags have a bounded ten-minute cap, longer than valid OTA
transfer and host observation budgets. MQTT restarts after stable headroom with exponential backoff
on client-start failure. No model-sized HTTP/MQTT buffer remains allocated for the boot.

OTA TLS requires four stable internal-heap samples of 56 KiB free and a 24 KiB largest block.
Validation after transport/buffer cleanup requires two 24/12 KiB samples. Weather reserves its fixed
8 KiB response, URL and error capacity before its final 48/20 KiB admission sample. A refused Weather
fetch keeps the previous evidence unavailable for decisions and retries after five minutes.
Weather reads only an allocation-free consent/location snapshot; request temporaries are destroyed
before network ownership returns to MQTT and before the worker sleeps.

`http_deadline.cpp` owns a boot-static absolute socket watchdog. After successful open, a timer
covers headers and body within the original monotonic deadline; expiry wakes a preallocated worker
that performs socket shutdown. The HTTP owner joins it before close, redirect or Range reuse.
Pre-socket DNS/TCP/TLS/request setup remains limited by the client's timeout and a post-open budget
check. Boot priming requires two identical nonnull thread-semaphore lookups, so failed SDK
thread-local registration cannot masquerade as readiness. Timer/task/prime failure disables OTA and
Weather downloads for that boot. Later saves
cannot relabel a missing worker as waiting.

Only allocator-shaped TLS setup failure gets one cleaned-up setup retry. A validated known-length
firmware prefix may resume at most twice, inside the same generation and five-minute budget,
requiring HTTP 206, one exact Content-Range and matching remaining length. Every resumed stream
must advance the existing OTA handle and hash; other transport/payload failures fail closed.

<a id="boot-loop-safe-mode-config-recovery"></a>
<a id="the-heap-watchdog-heap_guardcpp"></a>
## Recovery and observability

Crash capture separates the current reset/fault from any stored dump's task, ELF and backtrace.
The stored incident's age and relationship to this reset remain unknown, including a matching ELF.
Dump presence is checked live; a verified foreign-build dump is preserved and suppressed for this boot.
Boot capture never erases it automatically. Raw memory stays behind the manual download, while
HTTP/MQTT/syslog expose the bounded summary. Dismissal erases current evidence
before marking it dismissed; a failed erase cannot falsely report success. The distinct destructive
routes are `POST /diag/clear`, `POST /coredump/clear` and `POST /crash/dismiss`.

The boot guard runs after NVS initialization and its static lock, before config, network and OTA
startup. It classifies each boot once: a crash, a heap-watchdog restart (a software reset the
watchdog marked in `.noinit` RAM just before restarting) or a clean boot. A crash counts toward
crash-loop safe mode and carries the heap-restart count; a watchdog restart carries the crash
count; only a clean boot (any other non-crash reset: power cycle, any software restart such as a
rebooting save, OTA install, Ethernet fallback or factory reset) clears both.
Four crash boots latch crash-loop safe mode: retain network/HTTP recovery if mandatory startup
succeeds and skip optional plant workers. Ten minutes of uptime clear the crash count; that timer
is never armed while safe mode is latched, because suppressed workers prove nothing. NVS init
errors never trigger an automatic partition erase; failed initialization disables WiFi-driver NVS
before driver startup. Heap recovery watches the largest internal block with separate
arming/recovery thresholds and a continuous hold before restart; one sample at or above the
recovery threshold ends the hold. NVS breadcrumbs bound repeated heap restarts and eventually latch
heap safe mode until the next clean boot; the watchdog holds its restart while a factory reset
erases, and an OTA in flight excuses a critical heap. Safe mode is best-effort recovery, not
proof that a leak elsewhere is resolved;
`safe_mode_cause` distinguishes heap from crash loop.

Heap statistics, source liveness and task stack minima are visible without a broker through
`/status`. Unstarted tasks report a null stack sample. Board memory trends run independently of a
successful X10A sweep; their sampling/persistence must not borrow plant availability. Recovery
button factory reset is destructive to configuration and history and requires explicit authorization.
While it holds the NVS write latch, every other restart (rebooting saves, Ethernet fallback, OTA
install and health gate, heap watchdog, WiFi rollback) refuses and logs once, and no OTA operation
starts; an OTA image already selected boots on the next reboot (no further OTA runs in that boot),
and the health gate keeps retrying its rollback restart. A held save reboot is not retried if the
reset fails. The refusal is checked immediately before each restart, not under the latch's lock.

<a id="web-ui-config-flow"></a>
## Configuration ownership

HTTP writers own the serialized service configuration; detection owns narrow link/model updates.
`config_save_link()` writes only the link blob and checks its revision, never the service blob.
Configuration is staged, validated and durably committed before live apply or reboot. On a
route-owned persistence failure, retain the previous valid state and return an explicit error.
X10A and HomeHub are separate durability domains: update X10A and HomeHub in separate requests.
No allocating live handoff may begin after durable commit unless it was staged beforehand.
A stored service blob this build cannot use (newer layout, damage, read error) is kept: automatic
writers skip their write and only an explicit save replaces it. A service save whose reconciled
detected link collides with its requested local pins is refused as stale before any write.

NVS layout, request validation, omission/deletion behavior and endpoint reboot effects are in
[API.md](API.md#configuration-and-persistence). Board reservations apply in both directions, whoever
claims a pin second. ENV III enablement additionally proves hardware; disabling a failed optional
source must never require it to work.

## Concurrency: tasks and priorities

Application priorities come from `main/task_config.hpp`; stack sizes stay at each creation site.
HTTP and MQTT transport priorities remain SDK-controlled; their stack allocations are explicit
at service creation sites.

| Priority | Tasks | Ownership/lifecycle |
|---|---|---|
| 6 | `http_abs_dl` | Boot-static absolute socket deadline worker |
| 5 | `hp_poll`, `captive_dns` | X10A owner; setup-only DNS |
| 4 | `mqtt_pub`, `hp_modbus`, `env3`, `wifi_wd`, `eth_fb`, `ota`, `ota_health` | Sources/network; OTA delivery boot-resident, health worker pending-image only |
| 3 | `syslog_task`, `weather`, `recovery_btn` | Optional forwarding/button; Weather idle worker on ordinary non-safe boots |
| 2 | `status_led` | Cosmetic status |

Unconfigured HomeHub/ENV III creates no source task. Weather keeps an idle worker until both consent
and location activate it. These are different absence lifecycles, covered by the source-absence
matrix. Task loops catch `std::exception` and all other throws around the body, log once, preserve
last good state and continue with the normal delay. Event/timer callbacks must not throw or allocate.

## Memory constraints

The binding heap budget is the largest contiguous **internal** block, not aggregate heap or PSRAM.
`heap_largest_internal_block()` is the common sampler. Stream large HTTP/MCP/discovery bodies;
size-check bounded JSON and TLS claims. Every allocating handler keeps the common exception boundary.

Never allocate while holding a raw semaphore. Stage outside the critical section and move/swap, or
use `daik::SemGuard` for unwind-safe ownership. MQTT/Syslog event-side errors use stable literal
pointers; materialize strings outside their status lock. A task catch cannot rescue a stranded mutex.

Diagnosis bucket storage is 1,920 bytes for 23 completed hours and one pending hour. Completed-run
totals and outdoor sample counts use 32 bits; pressure minima add an observed-at timestamp. The
23-record static restoration scratch occupies 2,944 bytes, avoiding a poll-task stack array.
The history owner reuses its existing 4 KiB sector scratch. These geometry figures do not replace
the ESP32-S3 ELF's full static-memory and call-path budgets.

<a id="the-stack-the-second-budget-and-how-it-was-measured"></a>
### Stack verification

Stack is a separate budget. `scripts/check-stack-budget.py` reads the exact ESP32-S3 ELF's fixed
frames and conservative call paths, failing when required symbols disappear, dynamic stack
adjustments change or source-bound task reserves are exceeded. `tools/stack/budgets.json` owns
limits and reviewed HTTP/TLS/exception allowances; raising a budget is a review decision.
Parser budgets count all accepted recursion frames. Startup persistence, payload construction,
network writes and smaller application tasks have separate paths. WiFi initialization returns
before credential persistence; heartbeat, Weather and heating-curve builders return before
synchronous network writes.

The HTTP task has 10,240 bytes with a reviewed 2,048-byte margin; its status serializer uses the
reviewed `-Os` compilation scope.
Reverting that scope requires addressing the measured stack demand, not assuming a helper split
reduces peak use. Every exercised task additionally requires at least 1 KiB runtime reserve in
requested hardware acceptance. Owner-only samples preserve boot minima across task recreation;
unstarted tasks stay null. MQTT transport sampling uses SDK-owned callbacks because synchronous
error callbacks may run on the application caller. These are checkpoint high-water samples,
not continuous traces.
ELF gates do not prove ISR nesting, external call paths beyond the allowances or real scheduling.
A matching-build decoded coredump remains the primary evidence after a fault.
