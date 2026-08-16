# Home Assistant integration

The device publishes every decoded value to MQTT and uses Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery) for X10A metrics
and diagnostics under one **Daikin Altherma** device with no YAML. HomeHub Modbus data remains on
MQTT but is not exposed as HA value entities. Topics, entities and derived (COP) sensors below.

## Enabling

Web UI → the **header gear → Connections → MQTT** → enter `IP:PORT`
(+ user/pass if needed) → save. With the HA MQTT integration enabled, the device and its sensors
appear on their own after X10A has returned a valid reply. Clear the broker to disable.

X10A owns the outbound installation identity. Until the first valid X10A reply after boot, the
firmware connects only as a subscriber without the installation last will: an unwired spare/debug
board can receive its configured reference inputs, but publishes no ordinary state, discovery,
heartbeat or auxiliary-source data and cannot arm the shared `<base>/status` last will. If an
already-active X10A link later drops for 15 seconds, the firmware publishes `offline` once and then
suspends every other publish until the bus responds again; a shorter whole-sweep dropout neither
changes availability nor publishes an empty retained X10A state. Recovery publishes `online` and a
fresh state seed. Local HTTP diagnostics remain available throughout.

## Topics

`<base>` defaults to `daikin-altherma-esp32`, `<prefix>` to `homeassistant`. The device's message
topics sit **directly under `<base>`** — one board per base topic, so there is no `<node>` segment in
the payload paths. The node id identifies the device to Home Assistant only inside each discovery
config's `uniq_id`/`dev.ids` and in the discovery topic path, and it is the **slugified base topic**
(`daikin-altherma-esp32` → `daikin_altherma_esp32`) — see [Device identity](#device-identity). Within
that, each entity is identified by its **register group and object id** (`hydronic_error_code`), not
by the object id alone — see below for why.

```
<base>/status                                      online | offline   (LWT, retained)
<base>/x10a                                        {<group>: {<object_id>: value, …}, …}  (retained JSON)
<base>/modbus                                      {<object_id>: value, …}  (retained JSON; enabled HomeHub only)
<base>/env3                                        {temperature_c, humidity_pct, pressure_hpa}  (retained
                                                   JSON; optional M5Stack ENV III sensor only)
<base>/weather/openmeteo/forecast                  outdoor/solar forecast evidence (retained JSON; only
                                                   while a location is saved. No HA entities — a
                                                   forecast is not a state of this device)
<base>/heartbeat                                   board/link diagnostics (flat JSON, 10 s cadence)
<base>/heating_curve                               grouped room-source + diagnosis evidence (10 s cadence)
<base>/crash                                       crash report, retained — ONLY while a fault/dump is pending
                                                   (an older retained report is deleted after a clean boot or
                                                   POST /crash/dismiss; a clean broker receives no empty publish)
<prefix>/<component>/<node>/<group>_<object_id>/config    discovery config per PUBLISHED value (retained)
```

`<component>` is `binary_sensor` for a bit-flag value (pump running, 3-way valve, thermostat
ON/OFF — converter family 300-307) and `sensor` for everything else.

Not every catalog row becomes an entity. A row flagged **detect-only** (`ValueDef::no_publish`) is
one the model's bus answers but never populates with a real reading — e.g. the `0x64` hybrid/boiler
page on a non-hybrid monobloc/hydrobox, whose "2nd Domestic hot water temperature" is a frozen
`-40.4 °C` from a probe that does not exist and whose "Hybrid Op. Mode" reports "Boiler only" on a
unit with no boiler. Those rows are polled by nobody and announced to nobody, and the firmware
**deletes** any discovery config a previous build published for them (zero-length retained), so they
leave no permanently-unavailable entity behind.

> **Upgrading:** on the non-hybrid 4-8 kW profiles (EBLA/EDLA monobloc, ERGA/EHB hydrobox) the eight
> `0x64` hybrid/boiler entities — *2nd Domestic hot water temperature, Hybrid Op. Mode, Boiler
> Operation Demand, Boiler DHW Demand, BE_COP, Hybrid/Boiler Heating Target Temp., Mixed water
> temp.* — disappear on the next connect. None carried a real measurement; the heating target they
> mirrored remains available as **LW setpoint (main)**.

X10A values ride in one retained JSON on `<base>/x10a`, grouped one level deep by X10A register
page (`{ "hydronic": { "dhw_setpoint": 48, … }, "outdoor_state": { … }, … }`, max nesting depth 1 —
group names come from `logic/mqtt_group.hpp`). Each X10A discovery config points at that
shared topic and pulls its value out with a `value_template`:

```yaml
"stat_t": "daikin-altherma-esp32/x10a"
"val_tpl": "{{ value_json['hydronic']['dhw_setpoint'] }}"
```

When the HomeHub stack is enabled, its available register values are published independently as a
flat retained object on `<base>/modbus`; a disconnected HomeHub produces `{}` and disabling the
source removes that data topic. This stream intentionally has **no Home
Assistant discovery configs**: HA exposes X10A values, board/link diagnostics and — where the
optional M5Stack ENV III sensor is fitted — its three readings. Builds up to
`v1.0.0-dev.257` did announce 27 Modbus entities; connect-time and five-minute retained tombstones
to those exact retired discovery topics remove them from existing HA installations
without affecting `<base>/modbus`. Named HomeHub selectors keep their raw numeric constants in that
MQTT state topic (`smart_grid_operation_mode: 2`); readable names remain a web-UI concern. The
redundant retained `<base>/modbus/status` emitted by those builds is probed and deleted when present;
current link state, receive count and failures are already carried by `<base>/heartbeat`.

After upgrading, the firmware briefly probes for legacy retained `<base>/state` and
`<base>/modbus/status` payloads and deletes each only when the broker actually returns one. Once they
are absent, reconnects do not publish even empty payloads on those topics. X10A consumers must
subscribe to `<base>/x10a`;
`<base>/state` is no longer a published topic.

The board/link diagnostics on `<base>/heartbeat` are a **flat** JSON object — each field carried under
its block name as a prefix (`wifi_connected`, `wifi_rssi`, `wifi_mac`, `wifi_bssid`, `mqtt_count`,
`bus_rx_received`, …) rather than nested `wifi`/`mqtt`/`bus` sub-objects. The device's own MAC and the
associated AP's BSSID ride the `wifi_` set, so a heartbeat can be pinned to a specific board and the AP
it roamed onto.

Three fields count the one-second publish/poll cycles that produced **nothing**, each its own
`total_increasing` diagnostic entity: `mqtt_skipped` (the publish cycle threw `std::bad_alloc` under
heap pressure and the reading was lost), `mqtt_quiesced` (the publisher stood aside deliberately
while an OTA or weather TLS operation owned the heap) and `poll_skipped` (the X10A sweep never ran,
so the value was
never read at all). They are worth an automation: `mqtt_skipped` rising outside an update window
means the board is losing data to something other than its own installer. Because a reboot ends every
such episode, `total_increasing` is what lets HA's long-term statistics read the reset as a reset.

Two more fields say why the board rebooted and how close its tasks are to their limits — the
questions the rest of the payload structurally cannot answer.

`heap_restarts` is how many consecutive heap-watchdog restarts preceded this boot. The watchdog
restarts with `esp_restart()`, so `reset_reason` reads the same `sw` a settings save produces and
`reset_fault` stays `0`: without this field a board cycling its restart ladder every few minutes is
a sawtooth in `uptime_s` and nothing else. It is the one heartbeat diagnostic here that is also a
Home Assistant entity — **Heap Watchdog Restarts** — because the owner of the board acts on it, and
it duplicates nothing (the *Reset Reason* sensor says `sw` for both cases, which is the ambiguity
this resolves). Its state class is `measurement`, not `total_increasing`: the value is the count
this *boot* inherited and returns to `0` on the next healthy boot, so a monotonic class would make
HA read every recovery as a counter reset. Anything above `0` is worth an automation.

`httpd_stack_min_free_bytes`, `poll_stack_min_free_bytes`, `mqtt_stack_min_free_bytes` and
`modbus_stack_min_free_bytes` are the **second memory budget**: the worst stack headroom each task
has had since boot, in **bytes** (ESP-IDF's `uxTaskGetStackHighWaterMark` answers in bytes, unlike
vanilla FreeRTOS, which is why the unit is in the field name). Every heap figure above is already reported
and charted; the stack was visible only in a core dump's task table, which exists only once the
board has already died — and this firmware has shipped three stack overflows. Watch these as a
trend across firmware versions rather than as an absolute: a steadily falling line means a growing
call frame, which is what nothing could see before. **`null` means never sampled, not zero
headroom** — `modbus_` stays null on a board with no HomeHub, and `httpd_` stays null until the
board serves its first HTTP request, since the deep frame only exists while one is being served.
They are payload-only, with no HA entity: four permanently-flat diagnostics are four more things to
rule out, and the audience for a headroom trend is whoever is upgrading the firmware.

Room-source and heating-curve evidence lives separately on `<base>/heating_curve` (not retained),
published on the same 10-second reporting cadence. Its schema-versioned JSON is grouped by meaning:
`room` contains the firmware-accepted live input, and `diagnosis` contains the derived, durable
sampler state. Inside `diagnosis`, `gates`, `room_evidence`, `last_sample`, and `counters` keep related
facts together. This topic creates no Home Assistant Discovery entities; it is intended for direct
MQTT, Telegraf and VictoriaMetrics consumers.

Schema **v2** added the optional ENV III outdoor axis: `diagnosis.outdoor_available` and, inside
`last_sample`, `outdoor_temperature_c` — the outdoor air temperature **as it stood at the recorded
event**, from an ENV III sensor where one is configured and fresh. It is what makes an archived
sample interpretable, since a room deviation alone cannot separate a heating curve that is too
*steep* from one shifted too *high*. It is `null` when no sensor contributed, never `0`. The change
is purely additive and `method_version` deliberately stayed `2`, so samples recorded before and
after remain directly comparable.

Schema **v3** additively adds the plant's own axis from HomeHub input 44:
`diagnosis.plant_outdoor_available`, `diagnosis.plant_outdoor_source{,_code}`, and inside
`last_sample`, `plant_outdoor_temperature_c` plus its source. The ENV III fields also gain explicit
source name/code. Input 44 is accepted only from the current Modbus cycle/session; ENV III remains a
separate placement-dependent accessory. Either can be null independently, neither changes sampling,
and `method_version` remains `2`.

Numeric leaves remain numeric and boolean facts remain `1`/`0`, so the existing metrics pipeline
does not drop them. The canonical live paths include `room.temperature_valid`,
`room.setpoint_valid`, `room.control_eligible`, nullable `room.temperature_c`, `room.setpoint_c`,
`room.error_k`, `room.source_unix_s`/`room.age_s`, fixed `room.calibration_k=0`,
`room.counters.*`, and `room.reason_code`. `room.source_id="living_room"` provides human provenance.
`room.error_k` is emitted only when current temperature, target, source freshness and every
configured eligibility gate pass.

`room.reason_code` is stable across firmware versions: `0` eligible; `1` not configured; `2` no
value; `3` invalid payload; `4` missing source time; `5` clock unsynced; `6` future timestamp; `7`
backward timestamp; `8` retained without timestamp; `9` stale; `10` invalid arrival clock; `11`
temperature out of range; `12` missing target mapping; `13` missing target; `14` target out of range;
`15` missing enabled state; `16` disabled; `17` missing HVAC mode; `18` non-heating mode. The textual
slug is available in `/status.reference_temperature.reason`; metric alerts should use the numeric
code.

Heating-curve diagnosis method version `2` appears below `diagnosis` on the new topic. It is armed by
the configured, timestamped MQTT room mapping plus an active HomeHub. The Open-Meteo forecast is optional comparison
evidence and does not require a location to be disclosed. State codes are `0` off, `1` recording,
`2` hold, `3` degraded and `4` blocked. Reason
codes are `0` disabled, `1` sample recorded, `2` sampling interval, `5` room unavailable, `6` X10A
unavailable, `7` HomeHub unavailable, `8` plant gate unknown, `9` plant inactive, `10` forecast
unavailable, `11` clock invalid, `12` heating/cooling mode unknown and `13` non-heating mode. Codes
`3` and `4` remain unused so the retired deadband/rate-limit meanings are never silently reused.

`diagnosis.room_evidence.current_error_k` is the current raw room deviation while a sample is eligible
(`target - actual`: positive means too cold, negative means too warm);
`diagnosis.last_sample.room_error_k` is the last recorded value. It is **not** a leaving-water
offset and must not be converted one-to-one into one. Register 53 proves normal space operation and
input register 38 independently proves Heating rather than Cooling. Every 30 minutes the firmware
stores the unchanged room error with `diagnosis.last_sample.unix_s` and increments
`diagnosis.last_sample.sequence`. Consumers detect an event by a sequence increase and use its
absolute timestamp; they must not count every repeated 10-second publication as a new sample. A
reboot is identified by uptime/sequence reset. Seasonal analysis groups these raw samples by outdoor
temperature and reads them together with actual LWT clipping, run time and thermostat duty. There
is no P term, deadband, rounding, clamp, slew limit, requested offset or plant write path.

Firmware upgrades do not publish a retained tombstone for the old heartbeat fields because the
heartbeat itself is not retained. Consumers must move the former flat `room_*` and
`heating_curve_*` selectors to the nested paths above; the fields are not duplicated across topics.

Each value's `object_id` is a lowercase, alnum-only slug of its label (e.g. *"DHW Tank Temp
(R5T)"* → `dhw_tank_temp_r5t`). The template uses bracket subscripts, so a slug that starts with a
digit (*"2way valve…"* → `2way_valve_…`) stays valid.

**The state key and the entity id are not the same string.** The `object_id` above is the **state
key** — what the payload nests inside its group object, and what VictoriaMetrics is keyed on. The
**entity id** (the `uniq_id` and the discovery topic's last segment) is `<group>_<object_id>`,
because a label is unique only within its register page while HA's `unique_id` namespace is flat.
The catalog carries *"Error Code"* on the outdoor page **and** on the hydronic one: as a state key
that is two distinct entries in two group objects, but as a bare entity id it was one id on one
retained topic — so HA created a single entity and a unit reporting both faults showed one of them
(legacy-221). Hence `outdoor_state_error_code` and `hydronic_error_code` as entities, while the payload
still reads `{"outdoor_state": {"error_code": …}, "hydronic": {"error_code": …}}`.

Units and `device_class` are derived from each
value's `dataType` field (the def's HA unit hint: 1 = °C/temperature, 2 = bar/pressure, 3 = A/current;
see `unit_for_datatype`/`device_class_for_datatype` in `logic/convert.hpp`), so temperatures render
as °C with history, currents as A, and so on. This grouped JSON
is also directly consumable by a Telegraf MQTT `json_v2` parser (→ VictoriaMetrics/Grafana).

### Device identity

X10A values, board diagnostics, the crash flag and the optional ENV III readings belong to one
**Daikin Altherma** Home Assistant
device, identified by the **slugified MQTT base topic** (`daikin-altherma-esp32` →
`daikin_altherma_esp32`) in `dev.ids` and as the prefix of every `uniq_id` (whose remainder is the
entity's `<group>_<object_id>`). The id therefore names
the **installation, not the board**: replace the ESP32 (or erase its flash and set it up again) and
the replacement publishes exactly the same unique ids, so HA keeps the same device, the same
entities, and their whole history and long-term statistics. Two boards on one broker therefore need
two base topics, keeping installations distinct.

**Set the base topic per device — Settings → MQTT → Base topic** (`POST /set_mqtt`, field `base`;
`CONFIG_DAIKIN_MQTT_BASE_TOPIC` is now only the DEFAULT, used when nothing is stored). This matters
because CI publishes one firmware image: every board flashed from the release or dev feed starts on
the same base, so a second board — a bench unit, a spare, a second heat pump — silently *joins* the
first installation rather than forming its own. What that looks like is not an error message:

- both boards write the same retained topics, so `<base>/heartbeat`, `<base>/x10a` and `<base>/crash`
  each hold whichever published last;
- a metrics consumer sees one series per field, because the labels are identical — two interleaved
  uptime counters read as a sawtooth, which is how one of this project's own reboot investigations
  came to count 16 272 restarts in a week that had roughly fifty;
- Home Assistant merges them into ONE device whose entities flip between two units.

Every individual value stays plausible throughout, which is why this is worth setting deliberately
rather than discovering later.

> **Changing the base topic renames the installation.** The device publishes under the new base after
> the reboot, and Home Assistant sees a *new* device: the old one remains, with every entity
> permanently unavailable, and history and statistics stay with it — they key on the old entity ids
> and nothing carries them across.
>
> **It also forks every metrics series**, which is the consequence that bites later and quietly. A
> collector like Telegraf carries the MQTT topic as a *label*, so the series before and after the
> change have the same metric name and different labels, with no overlap — a query pinned to either
> one reports the other half as *absent* rather than failing. This project has already paid for that
> once: the firmware's own `<base>/state` → `<base>/x10a` migration split the X10A history at
> 2026-07-31, and a long-window analysis read "no data before 01-08" on a plant that had been
> publishing continuously. After a base change, union both in any query spanning it:
> `{topic=~"<old-base>|<new-base>"}` (or the `/…` suffixes that apply). The old retained topics are **not** cleaned up by the firmware
> either — and the reason is stronger than "it no longer owns them". The whole point of this setting
> is that a base topic may be **shared by a second board**; a device that swept the old base on its way
> out would delete the retained state of the very installation it was colliding with. Retracting is
> therefore the user's call, not the firmware's. So set the base topic when **commissioning** a board,
> not on a running installation whose history you want to keep.
>
> To clear what the old base left behind — the data topics, then the discovery configs under the old
> slugified node id (`my-old-base` → `my_old_base`):
>
> ```bash
> mosquitto_sub -h <broker> -t '<old-base>/#' -v --retained-only -W 2 | awk '{print $1}' | xargs -r -I{} mosquitto_pub -h <broker> -r -n -t {}
> ```
>
> ```bash
> mosquitto_sub -h <broker> -t 'homeassistant/+/<old_node>/#' -v --retained-only -W 2 | awk '{print $1}' | xargs -r -I{} mosquitto_pub -h <broker> -r -n -t {}
> ```
>
> (`-r -n` publishes an empty retained message, which deletes the topic; for a discovery config that
> also removes the entity, and the device disappears with its last one.) Run the second one while HA
> is connected, for the reason the swap note below gives. Do **not** run either against a base a board
> is still publishing under — it will simply republish, and you will have deleted nothing.
The retired Modbus discovery topics keep their `_modbus` namespace only as cleanup targets. They are
deleted on every broker connection and never republished, while `<base>/modbus` remains available to
ordinary MQTT consumers.

The board's own id `daikin_<mac3>` (low three bytes of the WiFi STA MAC) still exists, but only
where the *hardware* is what's being identified: as the **MQTT client id** — which has to be unique
per connection, so two boards briefly online during a swap don't kick each other off the broker —
and as a **second `dev.ids` entry**. HA matches a device by any one of its identifiers and merges
the rest in, so an install created by an older, MAC-identified build keeps its existing device
(name, area, device-level settings) instead of gaining a second one.

> **Upgrading from a MAC-identified build:** every `uniq_id` changes, since its prefix is no longer
> the MAC. On its first connect the firmware **deletes** each retained discovery config it published
> under its old id, immediately before publishing the replacement: HA drops the old registry entry,
> which frees its `entity_id`, and the new entity — same device, same name — claims that `entity_id`
> back. Recorder history and long-term statistics are keyed by `entity_id`, so they continue;
> per-entity customisations (a renamed entity, a custom icon) are keyed by `unique_id` and do not
> carry over.
>
> Home Assistant should be **connected to the broker while this happens**. The deletions are
> zero-length retained messages: they remove the retained config from the broker, so a subscriber
> that was offline at that moment never sees them and would keep the old entities alongside the new
> ones (which then land as `…_2`). If that happens, delete the stale device in HA and rename the new
> entities to the old ids — HA migrates the statistics along with a rename.
>
> A board that has **already been swapped out** cannot clean up after itself: its retained configs
> sit in the broker and HA keeps showing its device. Clear them once — `<mac3>` is the node segment
> of the dead board, visible in the discovery topics:
>
> ```bash
> mosquitto_sub -h <broker> -t 'homeassistant/+/daikin_<mac3>/#' -v --retained-only -W 2 | awk '{print $1}' | xargs -r -I{} mosquitto_pub -h <broker> -r -n -t {}
> ```
>
> (`-r -n` publishes an empty retained message, which deletes the config and with it the entity; the
> device disappears once its last entity is gone.) Recent Home Assistant versions also offer
> **⋮ → Delete** on an MQTT device's page, which clears the same configs for you.

> **Upgrading from a build before the entity ids carried the register group (legacy-221):** every entity's
> `unique_id` and discovery topic gain a `<group>_` prefix. This is a **bug fix, not a rename for its
> own sake** — five labels that the catalog places on two different register pages were being
> announced under one id on one topic, so the second discovery config overwrote the first and one of
> the two sensors did not exist in HA at all. On the reference installation that meant **one "Error
> Code" entity on a unit that reports two**, with nothing to indicate which unit it came from.
>
> On its first connect after the upgrade the firmware **deletes every pre-legacy-221 retained config** —
> both the `sensor` and the `binary_sensor` shape, under the current node id *and* under the MAC-era
> one — in a single pass that completes **before** any replacement is published. Friendly names are
> unchanged except for the ten entities then covered by the collision ledger, so the other ~154 entities reclaim their
> own `entity_id`, and with it their recorder history and long-term statistics. Per-entity
> customisations, keyed on `unique_id`, do not carry over.
>
> Home Assistant should be **connected to the broker while this happens**, for the same reason as
> the migration above: the deletions are zero-length retained messages, and a subscriber that was
> offline never sees them, leaving the replacements to land as `…_2`.
>
> ⚠️ **Do not use the `homeassistant/+/<node>/#` retained-sweep from the previous section to clean
> this up.** That one works only because a swapped-out board's node segment is *different*; here the
> stale and the new configs share the same node id, so the sweep would delete the entities you just
> gained. Use HA's **⋮ → Delete** on the MQTT device instead and reboot the board, which republishes
> everything from scratch.
>
> The collision ledger now contains the six labels below. The first five pairs — ten entities —
> gained a group-qualified **name** during the legacy-221 migration (and therefore a new default
> `entity_id`); without that qualification they would be identically named and one would land as
> `…_2`:
>
> | Label | Entities after the upgrade |
> |---|---|
> | Error Code | Outdoor State Error Code · Hydronic Error Code |
> | Error type | Outdoor State Error Type · Hydronic Error Type |
> | Mixed water temp. | Hybrid Mixed Water Temp. · Mixing Mixed Water Temp. |
> | Pressure sensor(T) | Outdoor Sensors Pressure Sensor(T) · Hydronic State Pressure Sensor(T) |
> | Target Discharge Temp. | Outdoor State Target Discharge Temp. · Water Hx Target Discharge Temp. |
> | Thermostat ON/OFF | Outdoor State Thermostat ON/OFF · Hydronic Thermostat ON/OFF |
>
> Which of these a given install sees depends on its detected model — most profiles carry only some
> of the pairs. The name is qualified on **every** model regardless, so it cannot change under a
> re-detect. Historical worked example at the legacy-221 migration, measured on
> `altherma_ebla_edla_d_series_4_8kw_monobloc`: **100 value entities before, 102 after** (the two
> *Error Code* / *Error type* pairs), with six names qualified — the other four labels appeared only
> once on that profile, so they gained a qualified name but no sibling.
>
> The later profile-specific diagnostic overlay adds the second `Thermostat ON/OFF` row. The current
> reference profile publishes **129 X10A rows** and shows **eight group-qualified names**. Existing
> installations keep the already group-scoped hydronic entity's `unique_id` and discovery topic;
> only its friendly name becomes `Hydronic Thermostat ON/OFF`, while the outdoor entity is new.
> Because the ledger is global, profiles that carry only the hydronic row still receive that stable
> qualified friendly name after upgrading.
>
> The legacy-221 entity-id migration did not alter JSON keys or metric suffixes. The later source-topic
> split intentionally moves that same grouped X10A payload from `<base>/state` to `<base>/x10a`;
> keys inside it and therefore VictoriaMetrics series names remain unchanged.

### Three ENV III entities, when that sensor is fitted

A board carrying the optional M5Stack ENV III sensor publishes a retained flat JSON on
`<base>/env3` and announces three entities — **ENV III Temperature** (°C), **ENV III Humidity** (%)
and **ENV III Air Pressure** (hPa), with the matching `device_class` on each. They belong to the
same device as everything else.

Two properties are worth knowing before you build automations on them:

- Their discovery configs carry a **two-entry availability list** (`mode: "all"`): the device LWT
  *and* a template over the state topic itself. A stale or failed sensor therefore marks **only
  these three** entities unavailable while the rest of the device stays online — an I2C fault on an
  accessory must not make the heat pump look offline.
- An error **omits the three readings** rather than carrying the last plausible one forward. The
  reading is outdoor climate; a value that quietly stops updating while still looking current is
  exactly what the rest of this firmware refuses to do (see *Values the firmware refuses to
  publish*). What the document keeps in either shape is `samples` and `errors`, the sensor's own
  I2C counters: they describe the **link**, not the air, so they are facts about the sensor whether
  or not it produced a reading — and they are most informative exactly when it did not. Carried
  only on the healthy document, the error count would go dark at the instant it became the answer,
  leaving you unable to tell a failing SHT30 from a disabled accessory, a rebooted board or a lost
  broker. They earn no HA entity (link health is a metrics-stream question, and the availability
  template above keys on the READING keys, so the three entities still go unavailable).

They republish whenever the sample counter advances, even if the rounded text is identical, so a
time-series consumer sees the sensor's real 10 s cadence instead of a gap that reads like a dropout.

### Two diagnostic entities are retired

**Device Time** and **WiFi Quality** disappear on upgrade. Both were removed because they only
repeated something the same device already published, which is the rule that retired *Last Reset
Reason* before them — an entity that cannot say anything new is not a second reading, it is a second
thing to rule out when something looks wrong.

- **Device Time** carried the device's SNTP wall clock as a `timestamp` sensor. Because the heartbeat
  re-sends it every 10 s, HA rendered it as *"N seconds ago"* — the same thing HA's own *last
  updated* shows for every other entity on this device, without needing a clock at all — while
  writing a recorder row every 10 s forever. What it was *supposed* to catch, a device whose clock
  never synced or drifted, is on `/status.ntp` (`{server, synced, time}`, and `synced: false` is that
  failure stated outright) and on every syslog message's RFC 5424 timestamp.
- **WiFi Quality** (%) was `2 × (rssi + 100)`, computed from the *WiFi Signal* (dBm) sensor sitting
  next to it. If you prefer percent, a template sensor over the dBm entity reproduces it exactly:
  `{{ [[2 * (states('sensor.<…>_wifi_signal') | int + 100), 0] | max, 100] | min }}`.

The `time` and `wifi_quality_pct` fields are gone from the heartbeat JSON too, so a Telegraf/
VictoriaMetrics consumer loses the `…_wifi_quality_pct` series (`…_wifi_rssi` is unaffected and is
what it was derived from). Nothing has to be cleaned up by hand: the firmware **deletes** both
retained discovery configs on its next connect, so HA drops the entities on its own. Their long-term
statistics go with them — that is the cost of the removal, and it is why nothing else in the
diagnostic set was touched.

### Binary values are numbers, not "ON"/"OFF"

A bit-flag value (converter family 300-307 — *"Water pump operation"*, *"3way valve"*, *"Thermostat
ON/OFF"*, …) is published as the JSON **number `1` or `0`**, and its discovery config is a
`binary_sensor` declaring `"pl_on": "1"` / `"pl_off": "0"`. HA therefore shows a proper on/off entity
rather than a text sensor whose state happens to read `ON`.

The number, rather than the text or a JSON bool, is what makes these values usable outside HA: a
metrics pipeline (Telegraf → VictoriaMetrics) stores numbers and **discards both strings and
booleans**, so roughly 30 of an ERGA profile's ~99 values — every binary one — used to reach Home
Assistant but never a graph. The same reasoning applies to `wifi_connected` / `mqtt_connected` /
`bus_connected` on the heartbeat topic, which are `1`/`0` for the same reason.

`GET /values` reports the same numeric `1`/`0` values from the poll cache. The web UI translates only
at its visual boundary: ordinary flags become `ON`/`OFF`, the 3-way valve selector becomes its named
path, and the two Smart-Grid contacts additionally form one named four-state row. The 2-way-valve
output is marked too but deliberately stays `ON`/`OFF`: it is separate from the configured/current
operating mode, so its `OFF` neither proves Cooling nor contradicts a configured Heating mode.
The optional `/values.binary_semantic` metadata drives that presentation; it does not change the
MQTT or Home Assistant contract.

> **Upgrading:** these entities change domain (`sensor.…` → `binary_sensor.…`), so their recorder
> history does not carry over and any automation or template referencing one by entity id needs its
> name updated. The firmware deletes the stale retained `sensor` discovery config on its next
> connect, so no duplicate, permanently-unavailable entity is left behind.

Numeric values are emitted (unquoted) only when the heat pump reported them this cycle, so an
unimplemented register is absent from the JSON and shows as *unknown* in HA rather than a phantom
`0`. X10A enum/text values and alphanumeric error codes remain JSON strings; HomeHub Int16 enums
remain their numeric Modbus constants. The "Error Code"
value is the raw 2-char code (e.g. `U4`), enriched with an English description when
`logic/error_codes.hpp` covers it (`"U4: Indoor/outdoor unit communication problem"`); a code
outside that table's coverage still publishes as the bare code.

### A field's JSON type never changes

Whether a key is published as a JSON number or a JSON string is decided by the value's **converter**,
not by what happens to be in it right now. Every key is one type in every state, for the whole life
of the installation.

This is not theoretical. Before it was enforced, `actuators.fan_1_step` published the number `30`
while the fan ran and the string `"OFF"` when it stopped. Both payloads are perfectly well-formed;
the damage is downstream. Telegraf's numeric parser dropped the string, VictoriaMetrics never
received a zero, and the last running step stayed on the chart as though the fan were still turning
— and any schema inferred from the first payload was wrong from the second onwards. A fan that has
stopped now publishes `0`; render it as "OFF" in the presentation layer if you want the word.

### `error_active` / `warning_active` — a numeric fault state

The Daikin diagnostic fields stay textual, because that is what they are: `error_type` reads
`"Normal"`/`"Error"`/`"Warning"`/`"Caution"` and `error_code` reads `"00"`, `"U4"`, `"7H"`. A metrics
consumer can store neither. `"00"` may become a numeric `0` on the way in, but `"U4"` is simply
dropped — so the series sits at its last no-error value and an alert on `error_code != 0` never fires
for the alphanumeric faults it exists to catch.

Every group that carries an error class therefore also carries two permanently numeric companions,
derived from that class:

```json
{ "outdoor_state": { "error_type": "Error", "error_code": "U4", "error_active": 1, "warning_active": 0 } }
```

`error_active` is `1` for the *Error* class; `warning_active` is `1` for *Warning* or *Caution* (the
textual class is right beside them if you need the three-way distinction). Both clear back to `0`
when the fault does. An unreadable class publishes **neither** — reporting `0/0` would assert "no
fault" on a byte the firmware could not decode.

Each is its own `binary_sensor` (`device_class: problem`), named and id'd by its group — *Outdoor
State Error Active*, *Hydronic Error Active* — since a profile carries an error class on both the
outdoor and the hydronic page while HA entity ids share one flat namespace. The companions were the
first entities built this way; since legacy-221 it is the general rule, and the catalog rows follow it too
(see [Topics](#topics)).

### Values the firmware refuses to publish

Four things can make a catalog row absent from `<base>/x10a`, and all four state absence *by*
absence — the key is simply not in the payload and HA shows *unknown*, rather than a plausible number
nobody measured:

- **The row was decoded with the wrong converter.** `Target Evap. Temp.` matched the catalog
  faithfully and still yielded 145–200 °C while the compressor ran, so it was withheld entirely for
  one release. It is now decoded as the `÷128` register it actually is and reads 10.4–15.6 °C running
  / 17.2–19.0 °C at rest (legacy-194 /
  legacy-209). **Upgrading:** the *Target Evap.
  Temp.* entity — removed on the release that quarantined it — comes back on the next connect. Its
  history is not continuous: samples recorded before the quarantine are the old ×10 values, so a
  long-range graph shows a step from ~200 °C down to ~15 °C. The entity keeps its id on purpose
  (renaming it would fork the statistics); the pre-quarantine range is simply wrong data.
- **The field is not populated on this unit.** `Target Cond. Temp.` reads raw `0x0000` through an
  entire compressor cycle. The entity stays (the field *can* be populated) but an
  exact zero from that row is withheld. Three more joined it: the page-`0x21` *Fan1 Fin temp.*,
  *Fan2 Fin temp.* and *Compressor outlet temperature*, each measured at exactly `0.0 °C` across
  1140 consecutive **running** samples while the inverter heatsink beside them read up to 55.5 °C and
  ambient never fell below 17.5 °C. This is adjudicated per row, never globally: a real thermistor
  crosses 0 °C every winter and must keep saying so — and on a **geothermal** unit the same registers
  carry brine and evaporating-refrigerant temperatures, which live at 0 °C, so each rule names the
  air-source row it is about and leaves those alone. **Upgrading:** if these three showed a flat
  `0.0 °C` before, they go *unknown* on a unit that does not have the sensors.
- **The hardware behind a whole register page is not fitted.** Pages `0xA0` and `0xA1` describe a
  *second* outdoor unit. On an installation that does not have one, `0xA1` answers with 16 zero bytes
  and `0xA0` reports no O/U MPU id (`0xFFFF`) while asserting no output — so every row on that page
  is withheld together rather than published as four 0 °C thermistors and an expansion valve at 0
  pulses (legacy-224). The entities stay, and
  the signature is re-checked against the live reply every cycle: an installation that *does* have
  the second unit answers differently and sees all of them normally. **Upgrading:** if these entities
  showed numbers before, they go *unknown* — the numbers were never measurements. Their recorder
  history is left alone, so a long-range graph shows the old flat line ending.
- **The outdoor unit is resting.** The outdoor unit refreshes its own register pages (`0x20`
  sensors, `0x21` inverter) only while it runs; stopped, it keeps answering with the last run's
  numbers. Measured against a HomeHub reference: exact agreement at every point while the compressor
  ran, a mean 1.19 K (max 2.0 K) error across the points while it rested. Those readings are
  withheld while the compressor is stopped, and the heartbeat's `bus_ou_held_over` (`1`/`0`, entity
  *Outdoor Data Held Over*) says why — the link is fine, the device is publishing, the unit is just
  not measuring. Distinguishing this from a broken link is what a "time since last MQTT message"
  check cannot do, because the payload itself is fresh every second.

### Protection retries & drop control (new entities)

Every install gains **11 entities** from the outdoor unit's page-`0x10` protection words: five
counters (`sensor`) and six drop-control flags (`binary_sensor`).

| Entity | Kind | What it says |
|---|---|---|
| `Discharge Temp. Protection Retry Qty` | sensor | how often the unit backed off to protect discharge temperature |
| `Comp. INV Current Protection Retry Qty` | sensor | …to protect compressor inverter current |
| `HP Protection Retry Qty` / `LP Protection Retry Qty` | sensor | …on high / low refrigerant pressure |
| `Fin Temp. Protection Retry Qty` | sensor | …to protect the inverter heat-sink fin temperature |
| `… Drop` / `… Drop Control` | binary_sensor | that protection is limiting the unit **right now** |

These are the "silent protection retries" signal: a unit that is meeting demand while quietly
retrying is degrading in a way no temperature reading shows. Each counter is a **3-bit field, so the
published value is always 0–7** — treat it as a rate (deltas over time), not a lifetime total.
Whether the unit *clamps* at 7 or *wraps* to 0 is not documented and has not been observed on a live
unit; until it has been, a delta of exactly −7 should be read as "unknown", not as a reset.

**Verified live** — dated evidence, not a closed counter question. On 2026-07-26, a live 4-8 kW
monobloc detected as `altherma_ebla_edla_d_series_4_8kw_monobloc` and running firmware
`1.0.0-dev.188` published all 11 entities. All survived the Telegraf → VictoriaMetrics path as
numbers rather than being dropped as strings: 11 of 11 series were continuous over an 18-hour
window, with 28 390–28 394 samples each. Every counter and flag was `0`; the raw page dump on
`/diag` (`logic/hexdump.hpp`) showed page `0x10` offsets 10–12 as `00 00 00`, proving that the
published zeros were the unit's own bytes rather than a masking or byte-offset defect.

A second pass on 2026-08-02 added real limiting evidence. By 12:18 CEST, every one of the 11 fields
had the same 296 119 stored samples: 223 923 on the retired `<base>/state` topic plus 72 196 on its
`<base>/x10a` replacement. `Discharge Temp. Drop` asserted during two compressor runs, briefly on
2026-07-27 and for about ten minutes on 2026-07-30. During the longer event the compressor held
32 rps, discharge temperature reached 105.5 °C, refrigerant pressure was about 40–42 bar, and the
inverter fin reached 54.5 °C. That correlation verifies the flag as a live protection-limiting
signal and proves the shared offset-10 word is active on this model. The other five flags and all
five retry counters remained `0`; no defrost occurred in the stored window.

The remaining question is therefore narrower: observe the first strict increase of one retry
counter and verify that transition against the raw page bytes and its surrounding operating
context. A defrost or a counter reaching `7` is useful additional coverage, but neither is a proxy
for that direct evidence. Until a real decrease is observed, the clamp-vs-wrap handling above stays
fail-closed. Progress and the exact close gate are tracked in
legacy-180.

**The metric IDs are frozen.** Now that these rows are ingested, each one is carried in
VictoriaMetrics as `daikin_altherma_<group>_<object_id>` — so the group key (`outdoor_state`) and
every row's label-derived slug have stopped being presentation and become identifiers the store is
keyed on. A rename does not announce itself: the old series stops receiving samples and a new one
starts at zero, and *a counter resetting to zero is precisely the event these entities exist to
report*. All eleven IDs are therefore pinned byte-for-byte by a `CHECK` in `test/test_logic.cpp`,
transcribed from the live store rather than recomputed from the labels. This matters most at the
generator handover described below: when `gen_profiles.py` emits these rows and `def/overlay.hpp` is
deleted, the labels must come back byte-identical, and that is now a test failure rather than
something a reviewer has to notice.

They arrive from `def/overlay.hpp` rather than from a model profile, because the offline profile
generator does not emit these rows yet; see [ARCHITECTURE.md](ARCHITECTURE.md) *Value-definition
profiles*. Nothing about the entity contract depends on that — when the generator catches up, the
same rows arrive by the normal route and the entities are unchanged.

> **Upgrading:** these entities are new, not renamed — nothing pre-existing changes domain or
> entity id, so no history is affected. They appear on the next connect after the update.

> **Home Assistant/MQTT remain read-only — no command topics.** The firmware mirrors telemetry to HA;
> it exposes no writable entity or HA/MQTT command route.
>
> Neither link has a write command: X10A has none by protocol, and the HomeHub link has none by
> construction ([MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md)). Using the HomeHub as a source does not
> make HA a control path. Readings remain on `<base>/modbus` without per-value HA discovery.

## Derived power, energy & COP / SCOP / JAZ

The X10A bus (and this firmware) streams **instantaneous sensor values only** — there is no
accumulated-energy (kWh), electrical-power (W) or run-hour register anywhere in the protocol. The
firmware deliberately does **not** integrate energy on-device (heap is tight, and the integral
belongs where the electricity meter also lives). So you compute two things **downstream** — in Home
Assistant **or** Grafana — and take their ratio:

1. **Thermal energy produced** = ∫ (flow × ΔT) dt — buildable **only** because the device exposes
   the water **flow rate** *and* **both** leaving and return water temperatures. (Daikin's own
   Onecta cloud and the BRP069A LAN adapter expose neither, so they can't form a heat figure at all;
   Daikin's **EKRHH Modbus hub** *does* expose them — see
   [Why not the shortcuts](#why-not-the-obvious-shortcuts).)
2. **Electrical energy consumed** = from a **real electricity meter** on the heat-pump circuit — not
   from compressor current, not from Onecta's estimate.

Then **COP = P_thermal / P_electrical** (instantaneous) and **SCOP / JAZ = ΣkWh_thermal ⁄ ΣkWh_electrical**
over a period (month, heating season, year).

> Entity ids below follow the sample `altherma3_r_erga` profile (English labels — the firmware is
> English-only). For a different model, open `http://daikin-altherma-esp32.local/values` for the
> exact labels, then map
> them to your HA entity ids (HA slugs the discovery `name`). `sensor.heatpump_power` /
> `sensor.heatpump_energy` are **your external meter** (e.g. a Shelly EM/3EM or DIN-rail kWh meter),
> not this device.

### 1. Instantaneous thermal power (virtual heat meter)

`P_thermal [kW] = flow [l/min] × ΔT [K] × Cf`, where ΔT = leaving − return water temp and `Cf` is
the volumetric heat capacity of the loop fluid, `ρ·cp/60`:

| Loop fluid | `Cf` |
|---|---|
| Pure water | **0.070** |
| ~30 % propylene glycol | ~0.063 |
| ~30 % ethylene glycol | ~0.066 |

```yaml
template:
  - sensor:
      - name: "Altherma Thermal Power"
        unique_id: altherma_thermal_power
        device_class: power
        unit_of_measurement: "kW"
        state_class: measurement
        # A missing input must make this sensor UNAVAILABLE, never zero. See the two notes below.
        availability: >
          {{ states('sensor.daikin_altherma_flow_sensor_l_min') | is_number
             and states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | is_number
             and states('sensor.daikin_altherma_inlet_water_temp_r4t') | is_number }}
        state: >
          {% set flow  = states('sensor.daikin_altherma_flow_sensor_l_min') | float %}
          {% set t_out = states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | float %}
          {% set t_in  = states('sensor.daikin_altherma_inlet_water_temp_r4t') | float %}
          {% set cf    = 0.070 %}   {# 0.070 water · ~0.063 for 30% propylene glycol — set to your loop #}
          {{ (flow * cf * (t_out - t_in)) | round(3) }}
```

> **Check these three entity ids against your own unit before copying.** An entity id is derived from
> its **label**, and the catalog does not spell the same quantity the same way on every model — so an
> id that is right on most units is still wrong on some. The counts below are over the **39
> detectable** profiles:
>
> | Input | Entity id on most units | Carries it | Known alternatives |
> |---|---|---|---|
> | `flow` | `sensor.daikin_altherma_flow_sensor_l_min` | **39 / 39** | — |
> | `t_out` | `sensor.daikin_altherma_leaving_water_temp_after_buh_r2t` | 35 / 39 | `…_outlet_water_buh_temp_r2t` (hybrid, HPSU Ultra) · `…_hpsu_tvbh_inflow_temp_after_buffer_buh_r2t` (ECH2O) |
> | `t_in` | `sensor.daikin_altherma_inlet_water_temp_r4t` | 38 / 39 | `…_hpsu_tr_return_temp_r4t` (ECH2O 4-8 kW) |
>
> To find yours, open `http://daikin-altherma-esp32.local/values` and read the `label` fields, or look
> the entity up in Home Assistant under the *daikin-altherma-esp32* device. The id is the label
> lowercased with every run of non-alphanumeric characters collapsed to one `_`
> (`logic/ha_device.hpp` `ha_slug`), prefixed by the device name — so *"Inlet water temp.(R4T)"*
> becomes `sensor.daikin_altherma_inlet_water_temp_r4t`.
>
> ⚠️ **Do not pick `t_in` by searching for `R4T`.** The catalog reuses that sensor tag: on **13**
> profiles `O/U Heat Exch. Temp.(R4T)` is the *outdoor* heat exchanger, and there are also
> `2 phase thermistor (R4T)` and `R4T-Deicer temp.` rows. None of them is the water inlet, and
> substituting one produces a ΔT — and therefore a heat output and a COP — that is plausible and
> wrong. Match the whole label, not the tag.

**The value is SIGNED, and that is deliberate.** Earlier revisions of this recipe wrapped it in
`[…, 0] | max` to keep idle/defrost reverse-ΔT out of the figure. That clamp is wrong, and it is
wrong in the direction that flatters you: during a **defrost** the unit deliberately pulls heat back
*out* of the heating water — several kW, for minutes — and clamping records that as `0.0 kW` of
production instead of as the withdrawal it is. In a live gauge that is a misleading instant; in the
**integral** below it is a systematic error that never cancels, so produced heat and with it the JAZ
come out too high — worst in winter, when defrosts are frequent and the number matters most. The
firmware refuses the same clamp in its own dashboard for the same reason (`main/www/js/schematic.js`,
`d.pth`). The Riemann integrator handles negative stretches correctly; let the sign through.

**Do not default a missing input to `0`.** `| float(0)` turns an `unavailable` sensor — a reboot, a
quiet bus, a reading the firmware's `reading_plausible()` refused — into a real-looking 0 °C. With
`t_out = 0` that becomes a large negative ΔT, which the old clamp then flattened to zero, so the two
defects hid each other and production simply stopped being counted with nothing to show for it. The
`availability` template above makes the gap a gap, which is what the statistics engine needs in
order to not treat it as a measurement. Same refusal the firmware makes in `logic/timestamp.hpp`:
better empty than a plausible-looking wrong value.

### 2. Instantaneous COP (live gauge)

Prefer the **measured** electrical power from your meter (a Shelly EM reports live W):

```yaml
      - name: "Altherma COP (live)"
        unique_id: altherma_cop_live
        availability: >
          {{ states('sensor.altherma_thermal_power') | is_number
             and states('sensor.heatpump_power') | is_number }}
        state: >
          {% set p_th = states('sensor.altherma_thermal_power') | float %}
          {% set p_el = states('sensor.heatpump_power') | float %}   {# external meter, kW #}
          {{ (p_th / p_el) | round(2) if p_el > 0.05 else 'unknown' }}
```

#### Both sides must describe the same system

This is the one thing that makes a COP a COP rather than a ratio of two unrelated numbers, and it is
why step 1 reads the leaving water **after** the backup heater (R2T) rather than before it (R1T).

Your meter sits on the heat pump's supply and therefore counts **everything** behind it — outdoor
unit, indoor unit, backup heater, circulation pump. That is the right boundary: it is what you pay
for, and it is the boundary a seasonal figure has to be built on. But it obliges the numerator to
match. Take the heat **before** the backup heater and divide by electricity that **includes** it,
and every kilowatt the heater draws lands in the divisor while its heat never reaches the dividend
— the COP collapses whenever the heater fires, and reads as a failing heat pump while nothing is
wrong. R2T is downstream of the heater, so both sides count it and the pairing holds.

**If your profile has no R2T row**, the recipe is valid only while the backup heater is off. All 44
shipped profile tables carry one, under four different spellings — check
`http://daikin-altherma-esp32.local/values` for yours. The device's own dashboard applies exactly
this rule and blanks its COP pill rather than showing the collapsed quotient
(`main/logic/cop_scope.hpp`); it also names which COP it is showing, since the two are different
numbers and look identical on screen.

**With a Shelly Pro 3EM specifically:** use the device's *total* active power (the sum across all
three channels) as `sensor.heatpump_power` — correct whether the unit is three-phase or single-phase,
since unused channels simply read 0 — and its accumulated energy counter as `sensor.heatpump_energy`
for the JAZ denominator in step 3. The meter's ~1 % accuracy removes the electrical side as a source
of error; the **heat** side then dominates, so see the accuracy notes below before reading much into
any single instant.

### 3. Integrate to energy → SCOP / JAZ

**Home Assistant** — turn the thermal-power sensor into a thermal-**energy** counter with the
[`integration`](https://www.home-assistant.io/integrations/integration/) (Riemann-sum) platform,
bucket it per period with [`utility_meter`](https://www.home-assistant.io/integrations/utility_meter/),
and divide by the meter's electrical energy for the same period:

```yaml
sensor:
  - platform: integration
    source: sensor.altherma_thermal_power     # kW  -> kWh
    name: Altherma Thermal Energy
    unique_id: altherma_thermal_energy
    unit_prefix: k
    unit_time: h
    method: trapezoidal

utility_meter:
  altherma_thermal_energy_yearly:
    source: sensor.altherma_thermal_energy
    cycle: yearly
  heatpump_electrical_energy_yearly:
    source: sensor.heatpump_energy            # your external kWh meter counter
    cycle: yearly

template:
  - sensor:
      - name: "Altherma JAZ (yearly SCOP)"
        unique_id: altherma_jaz
        state: >
          {% set q = states('sensor.altherma_thermal_energy_yearly') | float(0) %}
          {% set e = states('sensor.heatpump_electrical_energy_yearly') | float(0) %}
          {{ (q / e) | round(2) if e > 0 else 'unknown' }}
```

**Grafana** (if you route the MQTT values into a Prometheus-compatible TSDB, e.g. Telegraf's MQTT
consumer → VictoriaMetrics) — compute the heat meter in the query and integrate over the dashboard
range. Metric names follow your Telegraf field naming:

```promql
# instantaneous thermal power [kW]  (reuse as $P below)
# NO clamp_min here — a defrost withdraws heat from the water and that has to be subtracted,
# not floored to zero, or the integral below overstates production. See step 1.
daikin_flow_rate_lmin
  * (daikin_leaving_water_temp_after_buh_r2t - daikin_return_water_temp_before_phe_r4t)
  * 0.070

# produced heat [kWh] over $__range  — MetricsQL integrate() returns value·seconds, so ÷3600
integrate($P[$__range]) / 3600

# consumed electricity [kWh] over $__range, from the meter's kWh counter
increase(heatpump_energy_kwh[$__range])

# JAZ over the range
integrate($P[$__range]) / 3600 / increase(heatpump_energy_kwh[$__range])
```

> `integrate()` is MetricsQL (VictoriaMetrics). On vanilla Prometheus use a recording rule for `$P`
> and `sum_over_time($P[$__range]) * <scrape_interval_s> / 3600`, or `increase()` on a counter.

### Accuracy — what matters (and what doesn't)

- **Not the poll interval.** Heat-pump thermal output is heavily low-passed (minutes-scale water
  loop); discrete integration at even 30 s costs ~0.01–0.1 % of the yearly total, and rising/falling
  edges largely cancel. This firmware polls every **1 s** (fixed, not configurable), so the integral
  is not sampling-bound.
- **What dominates instead:** (a) the loop-fluid constant — a glycol mix lowers `Cf` ~10 % vs water,
  a systematic error if you leave it at 0.070; (b) small-ΔT amplification — ±0.1 K on a 3 K heating
  ΔT is already ~3 %, and the leaving/return sensors are uncalibrated factory parts (~±0.5–1 K);
  (c) whether a genuine volumetric flow signal exists. Every model profile shipped here defines the
  flow sensor (`0x62/9`) plus both leaving (`0x61/2|4`) and return (`0x61/8`) water temps, so the
  heat meter is available across the whole catalog — but if a specific unit variant physically lacks
  the flow sensor its reading is no-data and `P_thermal` can't be formed.
- **A metered electrical side does not make the live COP accurate.** A 1 %-class meter (Shelly Pro
  3EM and the like) removes the divisor as a source of error, but the divided quantity still comes
  from two uncalibrated factory temperature sensors: ±0.5–1 K each across a heating ΔT of ~5 K puts
  the instantaneous figure within roughly ±15–25 %, and no meter improves that. What the meter *does*
  fix is the **seasonal** number, because its kWh counter is exact and the ΔT scatter largely averages
  out over months — the systematic part (a wrong `Cf` for a glycol loop) does not, so set that. Read
  the live gauge as a working indication and the JAZ as the result.
- A live COP that is wildly off usually means the **wrong model profile** (mismatched flow/temperature
  registers) — check the detected model on the dashboard **Model** card, or `POST /detect` to re-run
  auto-detection. A COP that looks fine but **collapses whenever the backup heater runs** is the
  boundary mismatch instead — see [step 2](#both-sides-must-describe-the-same-system).

### Why not the obvious shortcuts

- **Compressor current × 230 V for electricity.** The inverter's power factor is well below 1 and
  varies with load, the CT resolves only 0.5 A steps, and the current excludes the pump and — the big
  one — the **electric backup heater (BUH)**, which can dominate winter consumption. Errors run
  10–30 %+. Use a real meter whose measurement boundary **includes the BUH**.
- **Daikin Onecta cloud / BRP069A gateway.** They expose no flow rate and no return-water temp, so
  they cannot compute produced heat or COP at all; their only energy figure is Daikin's *estimated*
  electrical kWh — widely unreliable (documented cases of a >40× overestimate, and negative values in
  HA's Energy dashboard), in ~2-hour buckets, behind a ~200-calls/day cloud rate limit (~10-min-stale
  data). This device's local 1 s data is strictly better for metering.
- **Daikin EKRHH "HomeHub" / local Modbus — different from the cloud, a peer of this firmware.** In
  its Modbus mode (commissioned as use-case UC3, Modbus TCP `:502`) the HomeHub *does* expose the
  water **flow rate** (input reg 49), **return** (reg 42) and **leaving** water temps (reg 40 PHE /
  41 BUH), so you can build the **same virtual heat meter** — the community HA integrations
  (`gerione/daikin-ha-ekrhh-modbus`, `joklee/ha_daikin_altherma4_modbus`) compute
  `thermal_W = flow × |LWT−RWT| × ~70` exactly this way, and evcc reads it to modulate PV-surplus
  power. It adds one thing this firmware lacks — an instantaneous **power** figure (reg 51, kW) — but
  that is Daikin's internal *estimate*, not a metered watt, and there is still **no accumulated kWh,
  heat-kWh or COP register** (you integrate downstream in HA/evcc, exactly as above), so a
  trustworthy JAZ still wants an external CT/Shelly (plus a MID heat meter for a certified SCOP). On
  the *metering* ingredients EKRHH and this firmware are therefore **peers**, not a shortcut past
  them — EKRHH's real edge is **bidirectional control** (SG-Ready / §14a power modulation /
  setpoints, the evcc path). This firmware deliberately does not compete there: it holds no write
  capability at all and exposes no MQTT command, HA control entity, HTTP/MCP register route or
  generic proxy ([MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md)). The
  supported read path is **conditional**,
  not "every register unconditionally": the Modbus map needs Unified MMI2 ≥ 7.8.0 on the audited
  ERGA-EV/EHBH/X-E family, some registers are inoperative per model (e.g. holding regs 59 & 61 on
  Micon 20002203), and the link will be plaintext Modbus TCP `:502` by choice — the hub's TLS `:802`
  is available but out of scope for a trusted-LAN client. Practical differences: EKRHH
  is a separate **paid** Daikin accessory, must run in Modbus mode UC3 (its PV modes UC1/UC2 expose no
  bus at all), and taps the **P1/P2** room-controller bus — not the **X10A** service port this
  firmware reads.
- **The heat pump's own internal kWh counter** (MMI / P1P2, whole-kWh, ~hourly) is itself just a
  ΔT×flow integration on the same uncalibrated sensors — not a higher-grade measurement. It is only
  more accurate when an external pulse kWh meter is wired to the unit's metering input. For a
  trustworthy JAZ, meter the electricity externally regardless.
