# HTTP and configuration reference

Base URL: `http://daikin-altherma-esp32.local` or the device's current IP. This is an unauthenticated,
unencrypted **trusted-LAN** API. [SECURITY.md](SECURITY.md) defines Host/Origin restrictions and
privacy; [ARCHITECTURE.md](ARCHITECTURE.md) describes ownership. HTTP implementation lives in
`main/http_*.cpp`; JSON field emission is in `main/http_status.cpp`.

## Surface and errors

The trusted-LAN route count of 39 includes assets, aliases and the catch-all. The open setup AP
serves only provisioning (`/`, `/index.html`, `/favicon.ico`, `/set_wifi` and captive GET fallback).
A withheld GET serves the setup page; a withheld POST is 404. `/scan`, live data, configuration other
than WiFi, OTA and MCP are not available on that AP.

Body-bearing POSTs require `Content-Type: application/json`. Bodies are reassembled to the route's
fixed capacity with room for a terminator; empty, oversized, truncated or stalled bodies are rejected.
Configuration JSON requires one object and at most 16 container levels; scalars, arrays, raw or
decoded NUL and trailing non-whitespace fail before any setting is applied.
Body acceptance checks a 30-second absolute budget before and after each receive. Unread-body
cleanup admits receives for two seconds and checks an 8 KiB cap after each 128-byte receive
(up to 8 KiB + 128 bytes); an active receive can add its socket timeout. Larger/slower cleanup
closes the connection.
Validation errors generally return `400 {"ok":false,"error":"…"}`; selected routes also include a
stable `code`. A conflict/proof requirement is 409, failed hardware evidence 422, route-owned
persistence failure 500, and OOM/busy/unavailable service 503. Success and a saved setting are
separate facts: inspect `ok`, `saved` and `reboot` where the route returns them.

Status, values, history, diagnostic text and MCP results stream bounded chunks. Chunk boundaries
have no JSON/domain meaning. An allocation failure before emission returns 503; a later failure
closes status/MCP streams; values serialize a pre-staged snapshot without allocation. `/diag` and
`/history` retain the outer-guard limitation after emission: a new error response cannot replace
already-sent data. Clients must reject truncated JSON.

During active OTA, every non-OTA route fails fast with a small busy-503, including assets, both
`/models` and `/diag` forms and MCP. Only OTA routes remain reachable. The common admission guard
also refuses non-OTA work below a 6,144-byte contiguous internal block. During Weather TLS, `/values` waits in
250-ms steps for at most four seconds, then returns busy-503.

## Assets

| GET route | Result |
|---|---|
| `/`, `/index.html` | Embedded gzip device UI; setup page on the provisioning surface |
| `/favicon.ico` | Embedded setup/dashboard icon |
| `/heat-pump-icon.png` | Dashboard app icon; LAN only |
| `/locale.js?lang=<code>` | Device-local compressed locale with app-image ETag; LAN only |
| `/mcp` | Embedded dependency-free MCP setup page, no outbound requests; see [MCP.md](MCP.md) |

The UI locale codes are `en`, `de`, `es`, `fr`, `it`, `pl`, `cs`, `uk`, `zh`, `ja`, `nb`, `sv`, `fi`.
Catalog value labels and API error prose remain English. The browser UI polls; there is no `/events`
or live WebSocket route.

## GET /status

A snapshot of device configuration and source evidence. Optional measurements are null when unknown;
unset identifying strings remain empty. Independent source snapshots do not imply simultaneous
physical measurement. `?redact=1` applies the [report redaction contract](SECURITY.md#report-redaction-contract).

### Device, links and configuration

| Object | Fields | Meaning |
|---|---|---|
| Root | `version`, `platform`, `uptime_s`, `boot_id`, `app_elf_sha256`, `pins_avail` | Running build, uptime, 16-hex-digit random per-boot token and X10A-eligible GPIOs. The configured nine-character ELF hash prefix helps correlate symbols; it is not full artifact/flash verification. |
| `board` | `led_gpio`, `led_type`, `led_inverted`, `btn_gpio`, `btn_active_low`, `user_set`, `preset_id`, `preset_name`, `vendor`, `pins_local`, `presets` | Persisted hardware identity and local-I/O candidates, excluding current X10A claims. A preset fills fields; submission saves them. |
| `board.presets[]` | `id`, `name`, `vendor`, `led_gpio`, `led_type`, `led_inverted`, `btn_gpio`, `btn_active_low`, `i2c_pins` | Supported hardware presets. A selected identity remains listed even if its original factory pins are now unavailable. |
| `wifi` | `ssid`, `ip`, `rssi`, `connected`, `bssid`, `mac`, `std`, `rolled_back` | BSSID/PHY standard are null offline. `rolled_back` is sticky until the next WiFi save. |
| `net` | `kind`, `ip`, `eth` | Active transport (`none`, `wifi`, `eth`) and its address, independent of X10A/HomeHub. |
| `net.eth` | `supported`, `present`, `link`, `lease`, `ip`, `mac`, `speed_mbps`, `full_duplex`, `pins{ sclk,cs,miso,mosi }` | Build support, detected controller, cable and DHCP are distinct. Speed/duplex are null without link. |
| `mqtt` | `configured`, `connected`, `tls`, `has_creds`, `broker`, `base`, `base_custom`, `error` | Effective base vs explicit custom choice. `has_creds` reports stored presence, never credentials, even if the broker is disabled. |
| `syslog` | `configured`, `resolved`, `reachable`, `queue_dropped`, `host`, `port`, `error` | Saved target and DNS/advisory reachability. Queue refusal cannot prove UDP delivery or collector retention. |
| `ntp` | `server`, `synced`, `time` | Configured server; false/null until sync, then RFC 3339 UTC (empty if calendar conversion is invalid). |
| `ota` | `channel` | Saved `release`/`dev` feed choice, independent of the currently running version. |
| `ui` | `lang` | `auto` or a supported locale; manual override applies to all clients. |
| `diagnostics` | `enabled` | Default-off persisted plant-diagnostics consent. Missing in an older response means off. |
| `hp` | `proto`, `rx`, `tx`, `connected`, `last_ok_s`, `registers`, `values`, `crc_err`, `timeout_err` | X10A transport and poll counters. |
| `profile` | `id` | This boot's selected profile; never a durable model lock. |
| `detect` | `proto`, `rx`, `tx`, `valid`, `capacity_kw`, `capacity_kw_iu`, `ou_eeprom`, `candidates`, `families`, `ambiguous`, `model{ name,family,marketing }` or null | Fingerprint and candidates. Ambiguity leaves unestablished model fields null; decoder `profile.id` is separate. Outdoor and indoor capacities are separate and null without evidence. |
| `modbus` | `enabled`, `connected`, `discovering`, `searched`, `profile`, `profile_basis`, `host`, `port`, `unit_id`, `rx`, `fails`, `values`, `task_stack_min_free_bytes`, `plant_gate_known`, `plant_gate_active`, `heating_mode_known`, `heating_mode_active`, optional `error`, `error_code`, `error_detail`, `error_register` | Independent read-only Modbus. Profile/basis identify HomeHub or native Altherma 4 semantics. Empty host disables it. Manual discovery is request-local; `discovering` stays false. Gate and mode need individually fresh valid replies. |
| `sys` | `free_heap`, `min_free_heap`, `max_alloc`, `heap_restarts`, `mqtt_skipped`, `mqtt_quiesced`, `poll_skipped`, `reset_reason`, `safe_mode`, `safe_mode_cause`, `stack_min_free_bytes` | Heap bytes, largest internal block, allocation/quiesce counters, reset and recovery state. |
| `sys.stack_min_free_bytes` | `httpd`, `poll`, `mqtt`, `modbus`, `weather`, `ota`, `syslog`, `env3`, `led`, `button`, `wifi_watchdog`, `eth_fallback`, `captive_dns`, `ota_health`, `http_deadline`, `main`, `sdk_mqtt` | Boot-local sampled minimum free stack bytes; null until that task was sampled. Samples survive task recreation. `sdk_mqtt` uses transport-task callbacks; synchronous caller error events do not sample it. |
| `last_crash` | null or `{reason,reason_code,fault,coredump[,task,pc,backtrace,corrupted,elf_sha256]}` | Current boot reset/fault plus any stored dump summary. Stored incident age/reset relationship remain unknown even for matching ELF. Proven foreign dumps are preserved but suppressed. Dump presence is live; dismissal preserves `sys.reset_reason`. |

### Optional inputs

`env3` fields: `type`, `supported`, `enabled`, `sda`, `scl`, `connected`, `fresh`, `age_s`,
`temperature_c`, `humidity_pct`, `pressure_hpa`, `error`, `samples`, `errors`, `pins_avail`, `presets`.
Support requires an M5Stack board preset. Readings are null unless fresh. I²C candidates reserve
live X10A pins and are offered before a board change; `/set_board` validates the whole proposed
snapshot, including its LED/button claims.

`reference_temperature` fields:

```text
configured, name, topic, temperature_path, setpoint_topic, setpoint_path, fixed_setpoint_c,
timestamp_topic, timestamp_path, enabled_path, hvac_mode_path, max_age_s,
subscribed, has_value, source_id, calibration_k, temperature_min_c, temperature_max_c,
temperature_c, has_setpoint, setpoint_c, enabled, hvac_mode,
received_at, received_ago_s, source_at, source_unix_s, timestamp_source,
age_s, fresh, freshness_reason, temperature_valid, setpoint_valid, control_eligible,
room_error_k, reason, reason_code, retained, messages, errors, rejections,
optional error, eligibility_error
```

Presence, timestamp freshness, physical validity and heating eligibility are separate. `reason`
distinguishes disabled thermostat, non-heating mode, stale data and decoding failures. A retained
message without usable source time is not fresh. A configured timestamp mapping is the sole age
authority: absent source time reports `missing_source_time`, never arrival-time freshness.
Source epochs discard queued frames from a previous binding. Saved mappings subscribe/decode only while the
master consent is on; disabling it clears captured state without deleting the mapping.

`circulation_source` fields:

```text
configured, name, topic, power_path, timestamp_path, max_age_s,
on_threshold_w, off_threshold_w, confirm_s, subscribed, has_value, power_w, state,
source_at, source_unix_s, timestamp_source, age_s, fresh, freshness_reason,
retained, messages, errors, rejections, optional error
```

`state` is confirmed `on`, `off` or `unknown`, using hysteresis and the confirmation window. A single
power spike or a reading in the hysteresis band is not proof of off/on. This independently measured
DHW circulation witness follows the same consent/deletion lifecycle as the room input.

`weather_forecast` fields:

```text
configured, provider, model, fetch_interval_s, max_age_s, fetching, available, has_value,
latitude, longitude, state, outdoor_mean_2h_c, solar_energy_2h_wh_m2,
hourly[{time_unix_s,temperature_c,humidity_pct,pressure_hpa}],
issued_at, fetched_at, valid_for_decision_at, last_attempt_at, age_s, fresh,
freshness_reason, successes, errors, refresh_requested_token, refresh_started_token,
refresh_completed_token, refresh_success_token, task_stack_min_free_bytes,
optional reason, error
```

`available` requires active consent/location, an operating task and fresh valid evidence. A failed
refresh may retain `has_value` and previous forecast data while `available`/`fresh` are false.
`hourly` is empty without a value; units are Unix seconds, °C, %, hPa. `issued_at` stays null because
the provider exposes no model-run instant. Coordinates are null when unset and redacted on request.
A boot-latched task/deadline startup failure remains an error across saves.

Refresh tokens are uint64 causal witnesses; zero means no event. Requested, started and completed
track that explicit trigger; success advances only when its exact result commits. A cancellation
is final and cannot be overwritten by a late superseded fetch. OTA may release and later reclaim
the same outstanding token. An unrelated scheduled success cannot satisfy a requested refresh.

### Heating-curve diagnosis

`heating_curve` fields:

```text
method_version, armed, state, state_code, reason, reason_code, sample_eligible,
current_room_error_k, last_sample_room_error_k, last_sample_unix_s,
outdoor_temperature_c, outdoor_source, last_sample_outdoor_temperature_c,
last_sample_outdoor_source, plant_outdoor_temperature_c, plant_outdoor_source,
last_sample_plant_outdoor_temperature_c, last_sample_plant_outdoor_source,
forecast_available, plant_gate_known, plant_gate_active, heating_mode_known,
heating_mode_active, room_source_unix_s, room_age_s, sequence, evaluations, samples, holds, blocks
```

States: `off`, `recording`, `hold`, `degraded`, `blocked`. Reasons: `disabled`, `sample_recorded`,
`sampling_interval`, `room_unavailable`, `x10a_unavailable`, `homehub_unavailable`, `plant_gate_unknown`,
`plant_inactive`, `forecast_unavailable`, `clock_invalid`, `heating_mode_unknown`, `non_heating_mode`,
`sampler_inactive`. Numeric codes are stable; retired 3/4 are unused. Safe mode reports
`sampler_inactive` (14) when configuration is armed but its MQTT sampler never started.

Arming requires diagnostics consent, configured MQTT room/target paths and active HomeHub; forecast
is optional. Recording requires fresh room-time evidence. Error values are null unless established.
Sequence plus absolute time identifies a
recorded event. Room error is not an LWT offset or actuator result.

The legacy outdoor pair is fresh/plausible ENV III; `plant_*` is HomeHub input 44 from the current
session. Current and recorded-event values remain separate and name their source. Both are optional
context, never sampling gates. An absent sample clears the corresponding prior event value.

### History and 24-hour checks

`history` fields: `epoch`, `dt`, `persist`, `dwell_persist`, `rows[{id,label}]`, `modbus_rows[{id,label}]`,
`env3_rows[{id,label}]`. Trend ids name concepts; labels follow the detected profile. Unsupported rows
are omitted. RAM adoption verdicts include `accept`, `power_cycle`, `wrong_catalog`, `bad_crc`,
`wrong_version`, `no_record`, `safe_mode`, `not_committed`, `stale_commit`; they do not report flash
restoration. `stale_commit` means unmeasurable age, not an ordinary stalled raster (booked as gaps).
Individual Modbus/ENV III rings may be retired beside an X10A `accept`. Dwell v4 books restart
blind time itself, so its verdict can be `accept` beside trend age refusals.

`health` fields: `covered_s`, `persist`, `full_span`, `available`, `assessable`, `evaluated`, `status`,
`checks`. Disabled diagnostics keeps the object but no accumulated checks. Card coverage is seconds;
each check has its own `observed_s`/`required_s`. One check cannot lend evidence to another.
`health.persist:"flash_pending"` means recovery has not completed and proves no stored hours;
`fresh` means none were selected; `flash` means admissible dated hourly reconstruction with live
precedence. Completed RAM hours are never adopted. Other values describe startup-integrity refusal.

Each check has `id`, `verdict`, `evidence` and its applicable numbers. Verdicts are `unavailable`,
`collecting`, `ok`, `info`, `warn`. The reading order and main evidence are:

| Id | Evidence fields |
|---|---|
| `fault` | `active` |
| `dhw_loss` | `max_k_h`, `windows`, `high_windows`, `high_with_pump`, `high_pump_off`, `circulation_on_s`, `circulation_known_s`, `candidate_s`, `settle_remaining_s`, `aborts`, `abort_reasons`, `best_aborted_s`, `blocked` |
| `cycling` | `starts`, `mean_run_s`, `space_runs`, `space_mean_run_s`, `dhw_runs`, `dhw_mean_run_s`, `cooling_runs`, `censored_runs`, `split`, `outdoor_source`, `outdoor_min_c`, `outdoor_mean_c`, `outdoor_samples` |
| `defrost` | `count`, `share_pct`, `paired_count`, `defrost_s`, `run_s`, `outdoor_source`, `outdoor_min_c`, `outdoor_mean_c`, `outdoor_samples` |
| `pressure` | `min_bar` |
| `flow` | `min_l_min` |
| `heater` | `buh_min`, `bsh_min`, `buh_s`, `bsh_s` |
| `retries` | `seen` |

Unestablished numeric evidence is null. Cycling class counts describe completed runs; censored runs
lack a fully witnessed boundary. `split` states whether class-specific evidence decided the verdict.
Positive defrost shares below 1% make the whole-percent `share_pct` null; positive heater runtimes
below one minute make `buh_min`/`bsh_min` null. Use the seconds fields for these small values.
Complete rules, coverage and experimental boundaries are in
[DIAGNOSTIC_EVIDENCE.md](DIAGNOSTIC_EVIDENCE.md); owner wording is in [DIAGNOSTICS.md](DIAGNOSTICS.md).

### Refrigerant observation

`refrigerant_service` is omitted until this boot detects a profile and evaluates its signal coverage.
It contains `kind:"observation"`, `state`, `continuous_s`, `samples`, `mode`, `blocker`,
`special_phases_known`, `load_proven:false`, `eev_feedback:false`, `limitations` and `metrics`.
States: `unsupported`, `waiting`, `observing`, `limited`, `interrupted`; modes: `unknown`, `heating`,
`cooling`, `other`. Blockers include `unsupported_profile`, `compressor_not_running`,
`unsupported_or_unknown_mode`, `dhw_path`, `defrost`, `unit_fault`, `special_controller_phase`,
`missing_fresh_signal`, `poll_gap`, or null. Limitation ids are `special_phases_unavailable`,
`temperature_context_incomplete`, `pressure_sides_incomplete`, `outdoor_context_incomplete`.
Metrics `compressor_rps`, `discharge_c`, `eev_command_pls`, `high_pressure_bar`, `low_pressure_bar`
are null or `{min,mean,max}` in their named units. This is neither a controlled service test nor
proof of refrigerant charge or valve position.

## GET /values

The response object has a `values` (X10A) array and a separate `modbus` array only while the staged
HomeHub snapshot is live. An omitted `modbus` is different from an empty array. Do not merge sources.
X10A rows contain `label`, `value`, `unit`, `reg`, plus applicable `binary`, `binary_semantic`,
`held`, `x10a_group`, `concept`, `dwell_s`, `dwell_min`, `dwell_blind_s`.
Their `value` is a string or null.

`reg` is the page, not a per-value address. `x10a_group` disambiguates labels reused across pages;
`concept` is structural HomeHub pairing. Selector semantics prevent valve/heater paths being shown
as generic switches. `held:true` means the outdoor page has stopped refreshing. An absent duration
is unknown, zero is a newly observed transition, and `dwell_min:true` makes duration a lower bound.

Modbus rows contain `label`, `value`, `unit`, `off`, with applicable `binary`, `enum`, `profile`, `concept`,
`history`. Numeric, flag and enum `value` fields are JSON numbers or null; text values are strings or
null. `off` belongs to the selected catalog; native rows include `profile:"altherma4"` and do not
borrow HomeHub enum meanings. Native quiet-policy selection proves no active quiet state/history.
The full-cache limit is 537 seconds and individual reply-age limit seven seconds; these transport
bounds cannot prove simultaneity. Native promotion first exposes only its pressure probe until a
full sweep. History additionally requires matching space/offset/codec/scale/unit provenance.
Source caches are staged before the first chunk;
MCP `get_hp_values` uses the same serializer. There is no retained model-sized response buffer.

## GET /history

Query: `row=<trend-id>` and optional `source=x10a|modbus|env3`; absent source means `x10a`.
Unknown ids return 404. Available rows are listed in `/status.history`. The payload is:

```text
{id,source,label,epoch,boot_id,dt,unit[,t0][,b0],v:[number|null,…],held:[[from,count],…]}
```

`v` is tenths of the row's actual unit; divide by ten. `dt` is the raster cadence. `b0` anchors
monotonic five-minute buckets, `t0` is sample-zero wall time derived from the captured newest-sample
age and omitted before clock sync. `epoch` is captured with the samples; `boot_id` matches `/status`.
Unavailable age metadata or an epoch changed before emission returns 503. Clients must reject
responses superseded by a newer status/source generation.
`held` marks eligible X10A outdoor nulls as held-over; all other source rasters leave it empty.
The circulation-state trend is selected through `source=x10a` but reports its physical source as
`"mqtt"` in the response.
Catalog ids and source eligibility are in `main/logic/history.hpp` and `homehub_map.hpp`.

## Catalog, probes and evidence

| Route | Input/result and side effects |
|---|---|
| `GET /models` | Static catalog metadata and legacy pin hint. No model picker; RX/TX candidates come from `/status.pins_avail`. |
| `GET /models?active=1` | `{profile,definition,fallback,values}` with exact queryable labels and reg/offset/size/conv tuples. Dynamic no-store; `auto`/unknown uses generic with `fallback:true`. |
| `POST /hp/query` | `{reg,offset,size[,conv]}` schedules a bounded read through the UART owner; persists nothing. See below. |
| `GET /scan` | `{networks:[{ssid,rssi}]}`; trusted-LAN diagnostic, not used by the typed-SSID setup portal. |
| `GET /diag?verbose=0|1[&redact=1]` | RAM diagnostic text; redaction at source. It cannot establish earlier boots. |
| `POST /diag/clear` | Erases the RAM diagnostic ring. |
| `GET /coredump` | Raw octet-stream current-build dump; 404 if absent or only proven-foreign residue. Private memory; decode against matching ELF. |
| `POST /coredump/clear` | Erases only the dump; keeps the reset/crash record. |
| `POST /crash/dismiss` | Erases dump and dismisses this boot's cached crash report; MQTT summary clears on the next heartbeat. A current-dump erase failure is 500 and does not dismiss. |
| `POST /detect` | Invalidates RAM fingerprint/profile and re-runs detection on the next poll cycle; no reboot. |
| `POST /discover_homehub` | Bounded `_http._tcp` browse; `{ok:true,host}` or 404. No persistence/task reconfiguration until a separate Save. |

For `/hp/query`, `reg` is required in 0–255; `offset` is 0–31 (default 0), `size` is 1 or 2
(default 1), and `conv` is 0–999 or -1 for a sweep (also the default when absent). Present fields
must be finite numeric integers; fractions and wrong types return 400 before UART handoff. Defaults
apply only to absent fields. Invalid bounds/shape return 400, another probe in flight 409, and no
link, local UART failure or an unserved
request 503. A rejected, missing or short register reply returns HTTP 200 with `ok:false` and its
stable `status`.

An HTTP 200 probe result contains `reg` as a hex string, `proto`, `rx_pin`, `tx_pin`, `offset`,
`size`, `status`, `ok`. `frame` preserves any received bytes, including bad/partial frames.
A valid page adds `payload` and `payload_len`; a requested slice beyond that payload produces
`status:"out_of_bounds",ok:false`. A fitting slice adds `slice` and `decodes`. Decode entries contain
`conv`, applicable `aliases`, and `value` or `text`; sentinel refusal is `refused:true`, an unknown
implementation is `unimplemented:true`.

Raw probes bypass the normal plausibility filters; a successful decode is not a confirmed
measurement. `main/logic/hp_probe.hpp` owns bounds and statuses. No Modbus write/proxy route exists.

## Configuration and persistence

All service settings are serialized into one CRC/length-checked atomic `cfg` NVS blob in namespace
`daik_cfg`. Supported older versions migrate. An absent, malformed or unsupported blob is rejected;
loading then falls back to legacy individual keys and, where absent, Kconfig defaults.
HTTP owns ordinary writes; initial HomeHub discovery may write before HTTP starts. The physical
X10A link has its separate atomic `link` blob and revision-checked detection writer. A whole-struct
detection write must not overwrite a concurrent service save. `config_save_link()` writes only
the link blob; it does not migrate or write the service blob.

| NVS item | Purpose |
|---|---|
| `cfg` | Credentials and WiFi backup/rollback flags; MQTT/base, syslog, NTP, board identity, OTA channel, language, HomeHub/discovery latch, room/circulation mappings, weather, ENV III, diagnostics consent/generation |
| `link` | Complete RX/TX/protocol/observation-identity cache; failed write preserves the previous complete entry |
| Legacy per-key credentials/services, `rx_pin`, `tx_pin`, `proto`, `board_set` | Migration inputs, superseded by successful blob saves |
| `boot_fails`, `heap_rst` | Crash-loop and bounded heap-restart breadcrumbs |

The current service layout is v19. Retired v9 actuation and v14 controller-mode bytes keep their
positions, are written zero and ignored. Pre-v18 HomeHub configurations migrate as already searched
so an old empty target stays opted out; fresh state searches once on its first networked boot and
persists the result or miss. Pre-v19 diagnostics migrate off. See `logic/config_store.hpp` for exact
byte/version layouts.

A failed route-owned save returns `500 {ok:false,error:"config write failed"}` with no reboot/live
apply. Unrelated link-cache maintenance failure is logged without rejecting an already committed
service blob; an X10A save requires its atomic link write. Never move/resize `nvs@0x9000`.
Recovery-button factory reset also clears driver credentials, RAM history/dwell, the flash journal
and raw dump. Any erase failure reports an incomplete reset rather than pretending success.

### Network settings

| POST route | JSON | Effect |
|---|---|---|
| `/set_wifi` | `{ssid,pass}` | SSID 1–32 bytes; password empty for open or 8–63 bytes. Persist and reboot, including rollback backup for a changed configured network. Re-save deliberately re-arms the trial. |
| `/set_mqtt` | `{broker,user,pass,clear_creds[,base]}` | Validate base and TLS policy; DNS/TCP/MQTT CONNECT/auth preflight up to about 8 s, then save/reboot. Empty broker disables without probe; unchanged settings do not probe/reboot. |
| `/set_syslog` | `{host,port}` | Validate port, save/reboot; empty host disables. No request-path DNS/ping. Unchanged returns `reboot:false`. |
| `/set_ntp` | `{server}` | Save/reboot; empty resets to compile-time default, not disabled. No request-path DNS. Unchanged returns `reboot:false`. |
| `/set_ota` | `{channel:"release"|"dev"}` | Persist, next check uses new channel; no reboot. Unknown choice rejected. |
| `/set_lang` | `{lang:"auto"|<locale-code>}` | Persist and apply through next UI poll; no reboot. Unknown choice rejected. |

Empty MQTT username+password keeps stored credentials; `clear_creds:true` explicitly clears them,
and non-empty credentials win over that flag. Credentials require verified `mqtts://` or `wss://`; insufficient
preflight heap is retryable 503 without a save. Omitted base keeps it; empty resets to the default.
Base validation has stable machine errors and runs before network work. Renaming creates a new HA
identity/metrics lineage; the old base's retained topics are not automatically erased because
another device may share them. See [MQTT.md](MQTT.md).

WiFi rollback requires sustained auth refusal (~60 s) or the 180-second missing-SSID/DHCP window.
Successful lease clears the backup; failed rollback persistence opens recovery rather than looping.

### X10A, HomeHub and board hardware

`POST /set_hp` accepts optional `profile`, `rx`, `tx`, `mb_host`, `mb_port`, `mb_unit_id`. Omitted keys
keep their value. Mixing an X10A key with a HomeHub key is 400 before any side effect:
**update X10A and HomeHub in separate requests**. RX/TX persist; a concrete profile is session-only;
the UI sends `auto`. Protocol is detected, cadence fixed at one second; `proto`, `poll_s`, `lang`
and `actuation_enabled` are not accepted here.
The X10A writer revalidates a parsed patch against the current revision. Three failed race attempts
return 409 without saving; revalidation can return 400. A service save reconciles newer detection-owned
fields so it cannot roll them back.

HomeHub port is 1–65535, unit 1–247, host at most 512 bytes. Empty host durably disables
polling, automatic discovery, sockets and dependent diagnosis. Replacement state is staged before
commit; live socket ownership remains with its task. X10A remains independent.

`POST /set_board` accepts `preset_id`, `led_gpio`, `led_type`, `led_inverted`, `btn_gpio`,
`btn_active_low`, `env3_enabled`, `env3_sda`, `env3_scl`. A stable known preset id is required when
provided; old clients can use exact-match migration. LED type is 0 (plain) or 1 (WS2812), -1 GPIO
means absent. Pin claims must not collide with X10A, the other onboard part or ENV III.
A board identity statement can save with no reboot; changing task-owned pins/accessory reboots.
Switching away from M5Stack retires ENV III in the same atomic save.

`POST /set_env3` is the compatibility route (`enabled`, `sda`, `scl`, all optional). Both board routes
share the same preflight: enabling new pins probes SHT30/QMP6988 (422 if absent, 503 if busy), enabling
running pins needs fresh evidence (422 if unreachable), moving an active bus is 409 `env3_disable_first`.
Disabling needs no hardware proof. Responses include machine codes; only successful real changes reboot.

### Plant diagnostics and sources

`/set_ref_temp`, `/set_circulation` and `/set_weather` replace their complete source configuration;
they are not patches. An omitted topic or both omitted coordinate strings disables that source.

`POST /set_diagnostics {enabled:boolean}` persists consent and applies live. Every transition
advances a durable generation; off clears old diagnosis and additional room/forecast/circulation
state, on begins new evidence. X10A, HomeHub, history, ENV III and heartbeat remain active.

`POST /set_ref_temp` fields:

```text
name, topic, temperature_path, setpoint_topic, setpoint_path, fixed_setpoint_c,
timestamp_topic, timestamp_path, enabled_path, hvac_mode_path, max_age_s
```

Exact topics (no wildcards), bounded dotted JSON paths, integer max age 10–3600 s, and a target
mapping or fixed target 5.0–35.0 °C at 0.1 °C precision are required for a non-empty source.
`fixed_setpoint_c:0` selects an MQTT target rather than a usable fixed temperature.
Old clients' setpoint/timestamp
paths fall back to their single topic. Save/rebind is live with no proof step. An unchanged mapping
still reevaluates binding and returns `saved:false,reboot:false`. Empty topic clears all mapping
fields and captured state even if the old source is broken.
An empty temperature path can decode a numeric scalar, but does not arm heating-curve diagnosis.
Arming needs a non-empty temperature path and a non-empty target path unless the target is fixed.
Recording additionally requires fresh source-time evidence.

`POST /test_circulation` fields: `name`, `topic`, `power_path`, `timestamp_path`, `max_age_s`,
`on_threshold_w`, `off_threshold_w`, `confirm_s`. Diagnostics off is 409, empty topic 400. Probe the
candidate mapping through the already connected MQTT client for up to 12 seconds;
`{ok,test_proof,power_w,state,retained}` or 422. No config is written.

`POST /set_circulation` adds `test_proof` to that mapping. A non-empty topic needs a current proof
bound to the seven behavioral fields and the original observation's `max_age_s` lifetime;
clock rollback cannot extend it. Absent, expired or invalid proof is 409. Empty topic disables without
proof. Save applies live; cosmetic renaming does not retire evidence. Unchanged mapping returns
`saved:false,reboot:false`. Numeric bounds/decoder policy are in `logic/circulation_source.hpp`.

`POST /set_weather {latitude,longitude[,refresh:true]}` saves/notifies without reboot or request-path
DNS/TLS. Coordinates are strict decimal strings with optional minus, dot/comma, at most six decimals;
no plus, exponent or whitespace. Both empty disables; one empty is 400. Saving location is consent
to disclose coordinates and source IP; fetching also needs diagnostics consent.
A source change must acquire bounded admission, commit config and synchronously clear the old
snapshot/generation. Admission failure after four seconds is 503 with no change; failed persistence
keeps the authoritative source. Source replacement/removal cleans retained forecast evidence.

`refresh:true` is only a non-persistent trigger for the unchanged, enabled location with diagnostics
on. Otherwise it is 409; unavailable task/safe mode is 503. Success returns
`{ok:true,reboot:false,saved:false,refresh_requested:true,refresh_token:N}`. It proves a requested
trigger, not a successful fetch; observe the exact four causal tokens and success-counter increment.

## OTA operation contract

Agent-run writes use [MAINTENANCE.md](MAINTENANCE.md#role-pinned-ota); the routes below document the
firmware/client contract, not permission to bypass its delivery gate.

| Route | Contract |
|---|---|
| `GET /ota/check` | Claims an async check; returns `{ok:true,generation}`. Busy/unavailable is 503. Optional `ms` provides no install/date authority. |
| `GET /ota/status[?redact=1]` | Allocation-free compact progress snapshot; fields below. Redaction hides effective feed URLs while keeping unset strings empty. |
| `GET /ota/changelog?after=<generation>` | One-shot UTF-8 text for a completed offer; 204 no usable notes, 409 consumed/expired/replaced offer, 400 invalid generation. Notes are presentation only. |
| `POST /ota/update?after=<generation>&channel=<release|dev>&version=<version>&sha256=<64-lowercase-hex>[&downgrade=1]` | Accepts only the exact completed offer under its mutex; returns immediate successor generation. Missing query keys, query overflow or invalid `after` are 400; invalid artifact identity, busy/replaced/unavailable offer are 503. |

Update captures identity in fixed storage, re-fetches the captured feed, checks manifest version/SHA,
hashes the complete stream and validates its signature before boot selection. `downgrade=1` relaxes
ordering for that request only; equal versions remain refused and signature/digest checks stay active.

The LAN-only bounded HTTPS header pair `X-Daikin-HIL-Manifest-URL` and
`X-Daikin-HIL-Firmware-Base-URL` overrides only one check generation. Both required, each at most
255 bytes; malformed/unpaired input is 400. It is transient, absent from NVS and cannot relax image
verification. It is an outbound-HTTPS capability behind the LAN boundary.

`/ota/status` fields:

```text
state (idle|checking|updating|done|error), progress, message, update_available, downgrade,
channel, busy, generation, available, available_sha256, available_channel, current,
heap_min_free_bytes, heap_min_largest_block_bytes, ota_stack_min_free_bytes,
effective_manifest_url, effective_firmware_base_url, image_state, rollback_pending
```

Busy/generation/feed are one mutex snapshot. Heap minima are operation-local checkpoint samples;
stack minimum is boot-local and null until sampled. Capture transfer evidence before reboot.
`image_state` is boot-latched ESP-IDF evidence; `rollback_pending` is null when that state is unknown.
Unknown is not proof that rollback is absent. Fixed text/buffer overflow fails closed.
Oversized status/redaction query or flag values return 414 before reading private snapshots;
this also applies to `/status` and `/diag`.

## MCP POST

`POST /mcp` implements stateless `initialize`, `tools/list`, `tools/call` with exactly `get_status`
and `get_hp_values`. Results use the status/values serializers with bounded JSON-RPC framing.
Notifications return 202; no SSE, session or write tool. Protocol and client setup: [MCP.md](MCP.md).
