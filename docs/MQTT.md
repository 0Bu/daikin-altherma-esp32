# MQTT contract

Owner setup and troubleshooting: [HOME_ASSISTANT.md](HOME_ASSISTANT.md). This page defines published
topics, discovery identity, input subscriptions and source freshness. There are **no heat-pump
command subscriptions or writable entities**.

## Topics

`<base>` defaults to `daikin-altherma-esp32`; `<prefix>` to `homeassistant`. Data topics sit directly
under the base with no node segment. `<node>` is the installation identity described below.

| Topic | Retained | Payload / cadence |
|---|---|---|
| `<base>/status` | Yes | `online` / `offline`, broker transport availability and last will. |
| `<base>/x10a/status` | Yes | `online` / `offline`, X10A source availability. |
| `<base>/x10a` | Yes | Grouped JSON from readable publishable X10A rows, updated by the publisher's nominal one-second loop. |
| `<base>/modbus` | Yes | Flat HomeHub register JSON while enabled; disconnected source yields `{}`. No HA value discovery. |
| `<base>/env3` | Yes | Flat optional accessory readings/counters; each fresh sample, normally every 10 s. |
| `<base>/heartbeat` | No | Flat board/link diagnostics and rolling cycling evidence, every 10 s while connected. |
| `<base>/crash` | Yes | Pending fault/dump summary; only while a notable record exists. |
| `<prefix>/<component>/<node>/<group>_<object_id>/config` | Yes | X10A discovery config; `binary_sensor` for converter 300–307 bit flags, `sensor` otherwise. |

The publisher's nominal cadence includes time spent polling and deliberate TLS pauses; it is not a
promise of one new physical measurement each second. Retained data can be replayed after its
source stops, so receipt time alone never establishes measurement freshness.

Heartbeat cycling fields mirror the additive `/status.health` evidence with a `cycling_` prefix:
`censored_transition_runs`, `censored_handover_runs`, `censored_unreadable_runs`,
`censored_restart_runs`, `censored_start_runs`, `classified_runtime_s`, `censored_runtime_s`,
and `runtime_saturated` (numeric 0/1). These are rolling completed-run observations, not per-boot
cumulative counters or plant-health verdicts. Unestablished/disabled evidence is null; no new HA
entities are created. [API.md](API.md#history-and-24-hour-checks) owns the field meanings and saturation boundary.

The heartbeat additionally publishes numeric `stop_context_*` fields, with five category prefixes
such as `stop_context_request_withdrawal_positive`. These share the HTTP
[`cycling.stop_context` contract](API.md#history-and-24-hour-checks) and independent population,
including its nullable counts and flags. Known flags use `0` or `1`; existing fields and HA entities
are unchanged. The HTTP-only `denominator` string is represented by the numeric field
`stop_context_witnessed_stops_recent_heating` on MQTT.
Eight parallel `modbus_cycling_*` flat integer fields (`modbus_cycling_censored_transition_runs`,
`modbus_cycling_censored_handover_runs`, `modbus_cycling_censored_unreadable_runs`,
`modbus_cycling_censored_restart_runs`, `modbus_cycling_censored_start_runs`,
`modbus_cycling_classified_runtime_s`, `modbus_cycling_censored_runtime_s`, and
`modbus_cycling_runtime_saturated`) track the independent HomeHub/Altherma 4 Modbus cycling store
with identical semantics, while `cycling_*` and `stop_context_*` remain X10A-only.

The heartbeat also carries the numeric `hydronic_*` fields from the independent
[`flow.hydronic` observation](API.md#qualified-water-circuit-observations). Flags use 0/1 and missing
values remain null. Range fields include `hydronic_spread_mean_k`, `hydronic_flow_min_l_min` and
`hydronic_pump_command_mean_pct`. MQTT uses the numeric qualification reason. No HA discovery
entities subscribe to these fields.

An initial transport-start rejection retains the initialized client and retries with bounded
backoff. Failed event registration prevents transport start and reports an explicit error.

## Outbound availability

One client starts with the retained transport LWT immediately, without waiting for X10A. Bridge
diagnostics, HomeHub, ENV III and the circulation witness keep their independent lifecycles.
X10A discovery uses `availability_mode: all`: both `<base>/status` and `<base>/x10a/status` must be
online. Board discovery uses transport availability; accessory discovery also requires its own
numeric reading, so missing accessory keys make that entity unavailable.

Each connection first withdraws old X10A availability. A current X10A payload accepted by esp-mqtt
then permits source `online`; rejected sends are retried. Before the first valid reply, and at
**15 seconds** since the last successful reply, source availability is offline and X10A state and
new discovery pause. A shorter empty sweep changes neither the retained payload nor availability.
Recovery seeds current state before source online. This clock comes from the poller, independently
of the allocating configuration snapshot. Offline and cleanup requests survive allocation failures.

For an OTA check/install, a connected client attempts retained transport `offline` before its clean
stop, without waiting for PUBACK. Refusal, delivery failure or an already reconnecting client can
leave the previous marker until reconnection refreshes transport and source markers. Retained
markers alone do not establish current source availability. Older single-marker discovery needs
the migration below before it can rely on this split.

## Identity and discovery

| Identifier | Construction |
|---|---|
| Node / primary `dev.ids` | Only the exact default and bench bases retain their underscore slug. Every custom base uses `daikin_altherma_esp32__` followed by the complete raw-base bytes in hex. |
| MQTT client id / secondary `dev.ids` | `daikin_altherma_esp32__board_<mac12>`, from the complete WiFi MAC. Invalid/unreadable MAC prevents MQTT startup. |
| X10A state key | `<group>.<object_id>`; object id is the same slug rule applied to the label. |
| X10A `uniq_id` | `<node><separator><group>_<object_id>`. |
| Diagnostic/accessory `uniq_id` | `<node><separator><object_id>`, using its surface's fixed diagnostic id. |

One base/node represents one installation; preserve it on board replacement. Distinct installations
must use distinct raw bases. `plant-one` and `plant_one` now have distinct HA nodes. The separator
is `_` for the default and `daikin-altherma-esp32-bench`, preserving their deployed entity IDs;
custom installations use `__` so a node suffix cannot masquerade as part of a sensor ID. The full
hardware identifier occupies a separate namespace. Historical three-byte aliases are not advertised
because two boards can share them; already merged HA registry entries require owner migration.

Base selection is runtime `POST /set_mqtt` field `base`: omitted keeps it; empty uses the compiled
default. A base is at most 64 bytes, cannot contain spaces, controls, `+`, `#`, empty path segments
or leading/trailing `/`, cannot begin `$`, and must contain a letter/digit after slugification.
Changing it creates a new HA identity and topic-labelled metrics series. Old-base retained topics
are left intact because another board may own them.

A discovery config references the shared X10A state topic with explicit missing-key handling:

```json
{"stat_t":"daikin-altherma-esp32/x10a","val_tpl":"{{ value_json.get('hydronic', {}).get('dhw_setpoint', 'None') }}"}
```

Missing keys or entire groups produce `None`, so numeric, binary and text entities become
**unknown** instead of keeping an older state. Quarantined/detect-only rows create no entity.

Units and device classes come from the catalog datatype/converter and bounded row metadata in
[`convert.hpp`](../main/logic/convert.hpp). The identified flow/current/rotational-speed rows carry
`L/min`, `A` and `rps` with `measurement` statistics. Flow uses `volume_flow_rate`, current uses
`current`, and rotational speed has no device class. The same metadata supplies `/values` units;
entity identities and numeric state values stay unchanged. Rows flagged detect-only or
without a publishable converter create no entity. Discovery is streamed incrementally instead of
allocating the entire catalog payload. Full builders:
[`mqtt_group.hpp`](../main/logic/mqtt_group.hpp), [`ha_device.hpp`](../main/logic/ha_device.hpp).

## X10A state and missing values

```json
{"hydronic":{"dhw_setpoint":48,"error_type":"Normal","error_active":0,"warning_active":0}}
```

Keys are grouped by register page. Converter-defined JSON types stay stable: bit flags are numeric
`1`/`0`, stopped numeric fans are `0`, and enums/error codes remain strings. Known fault codes can
include an English description. HomeHub integer enums retain their raw numeric constants.

Unreadable, unimplemented, implausible or adjudicated unpopulated readings are omitted; absence is
not `0`, false or “no fault”. An unreadable fault class emits neither numeric companion.
`error_active` is 1 for Error; `warning_active` is 1 for Warning/Caution.

Outdoor pages `0x20/0x21` can keep answering with the previous run's bytes while the compressor
rests. Those held readings are omitted from MQTT, with `bus_ou_held_over=1` on the heartbeat. HTTP
`/values` can instead retain them with `held:true`, so the two surfaces intentionally differ. The
firmware can recognize them only while it reads the compressor speed. If the speed goes missing after
it last read as stopped, the outdoor values stay omitted until it returns or the
[source age](#outbound-availability) passes. In every other case without a speed, as on a profile
without that row, the outdoor values are published even though they may be held.
Row/model-specific refusal rules and converter evidence belong in [REGISTERS.md](REGISTERS.md).

### Protection fields

Page `0x10` publishes five protection-retry counters and six drop-control flags where their overlay
is supported. Retry values are **0–7**. Clamp versus wrap is undocumented; a decrease, including −7,
is not established retry/reset evidence. Use strict comparable increases and retain the experimental
claim boundary. Metric/group/object identifiers are pinned; changing display labels must not
silently fork existing series. See [DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md#diagnosis-retries).

## Independent retained sources

### HomeHub

`<base>/modbus` is a flat object keyed by each register label slug. It is never merged into X10A
state. Disconnection produces `{}`; disabling retracts the retained topic. Saved target intent,
not a retiring task's lagging state, decides whether publication is allowed. Source reconfiguration
first retracts old evidence; an enabled replacement may publish an empty pre-first-sample document
on a later cycle. Read-only protocol/register rules: [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md).

Native Altherma 4 holding register 58 publishes `imposed_power_limit`; register 54 publishes
`weather_dependent_main_heating_offset`. Holding register 57 is unlisted and absent. The current
whole flat retained document replaces the former keys; this creates no HA entities. Their
[physical acceptance remains pending](MODBUS_PROTOCOL.md#deferred-physical-acceptance).

### ENV III

```json
{"temperature_c":20.25,"humidity_pct":45.50,"pressure_hpa":1008.75,"samples":4211,"errors":7}
```

A stale/unavailable sample omits the three reading keys but retains `samples`/`errors`, which measure
the I²C link. A fresh sample is published when its sample counter advances even if rounded values
are unchanged. Three HA measurement entities require both installation-online state **and their
reading key**, so only the accessory becomes unavailable on a sensor fault. Selecting **No sensor**
retracts this topic and retires its three discovery configs, subject to the
[ownership migration boundary](#migrations). Hardware gate: [BOARDS.md](BOARDS.md).

### Cleanup guarantees

Retractions use empty retained QoS-1 messages. One cleanup message is outstanding; only its matching
PUBACK confirms that deletion. Unproven discovery ownership instead skips the discovery step and
requires [operator migration](#migrations), without claiming a deletion or PUBACK. Raw state cleanup
continues. Pending sources stay suppressed, including the cycle that sends the
retraction, so stale state cannot immediately recreate it. Reconnect/replacement reconstructs or
preserves pending cleanup. Outbox expiry and a joined TLS transport stop permit retry; missing
PUBACK alone does not duplicate an item still owned by the outbox. The outbox is capped at 8 KiB.
Permanently retired discovery cleanup can run outside the X10A gate. Source implementation:
[`mqtt_cleanup.hpp`](../main/logic/mqtt_cleanup.hpp), [`mqtt_ha.cpp`](../main/mqtt_ha.cpp).

## Heartbeat

The payload is flat. Fields are numeric except the stated text fields; connectivity/held flags are
`1`/`0`. `bus_ou_held_over` is absent while the compressor state is unknown: the latest sweep has no
readable speed (always so on a profile without that row), or the X10A link is not live. Counters reset
with a boot unless stated otherwise.

| Category | Fields |
|---|---|
| Build / uptime | Text `version`, `platform`, `uptime`; numeric `uptime_s`. |
| Memory | `free_heap`, `min_free_heap`, `max_alloc`, `heap_restarts`. |
| Stack minima, bytes | `httpd_stack_min_free_bytes`, `poll_stack_min_free_bytes`, `mqtt_stack_min_free_bytes`, `modbus_stack_min_free_bytes`. |
| Reset | Text `reset_reason`; numeric `reset_reason_code`, `reset_fault`. |
| WiFi | `wifi_connected`, `wifi_rssi`, `wifi_reconnects`; text/null `wifi_mac`, `wifi_bssid`. |
| Transport | `net_link` (0 none, 1 WiFi, 2 Ethernet), `eth_present`, `eth_link`. |
| MQTT / skipped work | `mqtt_connected`, `mqtt_count`, `mqtt_fails`, `mqtt_reconnects`, `mqtt_skipped`, `mqtt_quiesced`, `poll_skipped`. |
| X10A | `bus_connected`, text `bus_proto`, `bus_registers`, `bus_values`, `bus_last_ok_s`, `bus_rx_received`, `bus_rx_fails`, `bus_crc_err`, `bus_timeout_err`, `bus_tx_reads`, `bus_ou_held_over`. |
| HomeHub | `modbus_enabled`, `modbus_connected`, `modbus_rx`, `modbus_fails`. |
| Plant diagnostics | `cycling_*`, `stop_context_*`, `modbus_cycling_*` (omitted while diagnostics is off). |

Stack minima are null until sampled; WiFi RSSI/BSSID are null when offline. `max_alloc` is contiguous
heap headroom. `heap_restarts` counts watchdog resets inherited by this boot, returns to zero on a
clean boot ([classification](ARCHITECTURE.md#boot-loop-safe-mode-config-recovery)) and uses HA
state class `measurement`. `mqtt_skipped` counts a publish
cycle interrupted by an allocation failure or the flat Modbus payload exceeding its **4 KiB**
bound; earlier topics in that cycle may already have published. `mqtt_quiesced` counts deliberate
OTA pauses; `poll_skipped` counts sweeps not performed. These use `total_increasing`.
Field/entity definitions: [`heartbeat.hpp`](../main/logic/heartbeat.hpp).

## Circulation witness input

The circulation observer reads actual active power in W and source time, not relay-command state.
Its configurable on/off thresholds, max age and confirmation period produce bounded pump evidence.
Saving requires a mapping-bound successful fresh test; it never switches the pump. Defaults are
`apower`, `aenergy.minute_ts`, 3/1 W, 120 s age and 60 s confirmation.

## Crash summary

A retained record exists only while a fault or dump is pending. It carries `reason`, `reason_code`,
boolean `fault`, `coredump`, and, when captured, `task`, `pc`, `backtrace`, `corrupted`, `elf_sha256`.
When neither a fault nor a dump remains, or after successful `POST /crash/dismiss`, an existing
retained record is deleted; a clean broker receives
no empty crash publish. This summary never contains the raw dump. Reset reason/code/fault describe
the **current boot**; dump availability is live, while optional task/PC/backtrace/ELF fields can
belong to an **older stored incident, even on the same build**. Its age and relationship to the
latest reset remain unknown. Preserve private memory evidence before dismissal; see [REPORTING.md](REPORTING.md).

## Migrations

| Former contract | Current behavior / consumer action |
|---|---|
| X10A bracket-subscript discovery templates | Current `.get(..., 'None')` templates make omitted keys/groups unknown. Expect gaps in numeric statistics and `numeric_state` conditions while inputs are unknown. Older numeric/binary templates could keep the last state; text could become empty or a missing group could log a template error. |
| `<base>/state` | Use `<base>/x10a`; grouped keys unchanged. Union old/new topic labels for historical queries. |
| `<base>/modbus/status` | Use heartbeat HomeHub link fields. |
| `<base>/weather/openmeteo/forecast`, `<base>/weather_forecast` and four weather discovery configs | Retired. The MQTT owner schedules retraction of the former forecast topic on boot and probes the historical alias for a retained payload. Discovery cleanup requires the ownership evidence below. |
| 27 historical HomeHub discovery configs under `<node>_modbus` | Retired; data topic `<base>/modbus` remains. Delete-only passes run on connect and every five minutes outside the X10A gate. |
| `<base>/heating_curve` and former flat room/diagnosis heartbeat fields | Retired. Remove subscriptions and dependent metrics rules. These messages were non-retained. |
| Single-marker X10A availability | `<base>/status` now means transport availability. Current discovery requires transport **and** `<base>/x10a/status`. Confirm current configs have both before trusting X10A availability. If X10A is absent during the first upgrade, old configs cannot be automatically replaced: pause consumers and migrate confirmed old configs explicitly. Raw consumers must check both markers and actual source freshness. |
| Custom-base unique IDs / lossy base slugs | Every custom base is encoded exactly; IDs separate node and entity with `__`. Export customizations, identify the exact former configs, remove only abandoned IDs and reconcile HA references/history. Default and bench entity IDs remain unchanged. |
| Three-byte MAC aliases / MAC-era discovery | Complete-MAC hardware IDs replace ambiguous aliases without advertising the old alias. Owner reconciliation is required for old discovery or already merged registry devices; do not delete a short-MAC namespace that another board may own. |
| Current-namespace ungrouped X10A discovery | Confirmed deletions precede replacements; keep HA connected. Unique-id customizations do not migrate automatically. |
| Relabelled X10A rows (`main/logic/label_override.hpp`) | The old current-namespace discovery configs are deleted before the replacements. Entity id, state key and metric series follow the new label; history does not carry over. Update consumers that use the old name. |
| Textual bit-flag sensors | Now `binary_sensor`; update domain references. Old-domain history does not migrate automatically. |
| Device Time, WiFi Quality, Last Reset Reason | Retired discovery removed; use `/status.ntp`, WiFi Signal and Reset Reason respectively. `time` / `wifi_quality_pct` heartbeat fields are gone. |
| Non-hybrid `0x64` boiler/hybrid entities | Detect-only rows retracted; use **LW setpoint (main)** for the legitimate heating target. |
| `0x65` offset-0 mixing entities | Withheld on the seven profiles whose tables place them at byte 0; their discovery is retracted and their state keys are no longer published, without replacement ([register 0x65](REGISTERS.md#register-0x65)). Old history stays unverified. |
| `bus_ou_held_over=0` without a compressor reading | The key is now absent and **Outdoor Data Held Over** reads unknown instead of off. Treat a missing key as unknown, never as current. |
| Last-run outdoor values after a lost speed reply at rest | No longer published within the source age; the rule is under [X10A state](#x10a-state-and-missing-values). |
| Old Target Evap. Temp. samples | Corrected converter keeps its id; pre-correction history remains wrong and must be excluded from comparisons. |

The preserved default/bench discovery nodes can also contain a historical custom base that once
slugged to the same identifier. Before discovery changes, firmware inspects both the node and its
retired `_modbus` namespace. Foreign or unproven ownership leaves discovery intact and requires
the targeted owner migration below; ordinary MQTT telemetry continues. Every custom base now uses
a separate raw-byte namespace, including bases that previously consisted only of lowercase words
and hyphens.

The namespace check uses a bounded retained subscription window after both subscription ACKs;
it cannot prove absolute absence or perform an atomic compare-and-delete. Commission exactly one
publisher for each discovery namespace, and reconcile historical aliases before sharing a broker.
Late conflicting evidence revokes discovery admission until a clean reconnect after migration.

Retired state-topic probes delete only an actually returned old retained payload. Permanent
HomeHub/weather discovery ledgers remain frozen independently of the current catalog. Cleanup
advances only after the matching client-epoch PUBACK, retries refused sends, and keeps at most one
cleanup message in flight across source and discovery jobs. Replacement discovery waits for those
deletions; current telemetry remains live. Discovery delegated to owner migration is explicitly
reported as skipped, without claiming a tombstone or PUBACK.

The dedicated NVS retirement record stores only the last possibly announced base, full board ID
and profile, never credentials or active configuration. A known predecessor is retired before its
replacement is saved, and the replacement is saved before discovery. Reload after a real reboot
therefore resumes known-profile cleanup. A missing first-upgrade record cannot recover an unknown
older profile; a corrupt/incompatible record blocks new X10A discovery rather than guessing.
A completed [recovery-button factory reset](BOARDS.md#recovery-button) erases this record.
A profile announced before that reset needs the owner migration below.
An abandoned broker/base or replacement board is an owner migration boundary: the new connection
does not authenticate to the old broker or blindly delete another installation's topics.

For a retired board or an intentionally abandoned base, first list and inspect the retained topics.
Delete **only confirmed old topics**, for example:

```bash
mosquitto_pub -h <broker> -r -n -t '<exact-old-topic>'
```

The relevant old namespaces are `<old-base>/#`, `homeassistant/+/<old_node>/#`, the legacy
`homeassistant/+/<old_node>_modbus/#`, or the retired board's `homeassistant/+/daikin_<mac3>/#`;
add your broker's authentication/TLS options. Do not delete a tree
still used by another board. For a group-id migration, old and new configs share the current node,
so a broad sweep would delete current entities. If HA missed those deletions and now has duplicates,
use its MQTT device **Delete** action and reboot the board to republish, then reconcile entity ids
and statistics. A stale swapped-out board cannot clean its own retained configs.
