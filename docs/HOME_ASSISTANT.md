# Home Assistant integration

The device publishes every decoded value to MQTT using Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so a **Daikin
Altherma** device with all sensors appears automatically — no YAML. Topics, entities and
derived (COP) sensors below.

## Enabling

Web UI → the **header gear → Connections → MQTT** → enter `IP:PORT`
(+ user/pass if needed) → save. With the HA MQTT integration enabled, the device and its sensors
appear on their own. Clear the broker to disable.

## Topics

`<base>` defaults to `daikin-altherma-esp32`, `<prefix>` to `homeassistant`. The device's message
topics sit **directly under `<base>`** — one board per base topic, so there is no `<node>` segment in
the payload paths. The node id identifies the device to Home Assistant only inside each discovery
config's `uniq_id`/`dev.ids` and in the discovery topic path, and it is the **slugified base topic**
(`daikin-altherma-esp32` → `daikin_altherma_esp32`) — see [Device identity](#device-identity).

```
<base>/status                                      online | offline   (LWT, retained)
<base>/state                                       {<group>: {<object_id>: value, …}, …}  (retained JSON)
<base>/heartbeat                                   board/link diagnostics (flat JSON, 10 s cadence)
<base>/crash                                       crash report, retained — ONLY on a fault/dump boot; cleared otherwise
<prefix>/<component>/<node>/<object_id>/config    discovery config per PUBLISHED value (retained)
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

All values ride in **one** retained JSON on `<base>/state`, grouped one level deep by X10A register
page (`{ "hydronic": { "dhw_setpoint": 48, … }, "outdoor_state": { … }, … }`, max nesting depth 1 —
group names come from `logic/mqtt_group.hpp`). Each discovery config points every sensor at that
shared topic and pulls its value out with a `value_template`:

```yaml
"stat_t": "daikin-altherma-esp32/state"
"val_tpl": "{{ value_json['hydronic']['dhw_setpoint'] }}"
```

The board/link diagnostics on `<base>/heartbeat` are a **flat** JSON object — each field carried under
its block name as a prefix (`wifi_connected`, `wifi_rssi`, `wifi_mac`, `wifi_bssid`, `mqtt_count`,
`bus_rx_received`, …) rather than nested `wifi`/`mqtt`/`bus` sub-objects. The device's own MAC and the
associated AP's BSSID ride the `wifi_` set, so a heartbeat can be pinned to a specific board and the AP
it roamed onto.

Each value's `object_id` is a lowercase, alnum-only slug of its label (e.g. *"DHW Tank Temp
(R5T)"* → `dhw_tank_temp_r5t`). The template uses bracket subscripts, so a slug that starts with a
digit (*"2way valve…"* → `2way_valve_…`) stays valid. Units and `device_class` are derived from each
value's `dataType` field (the def's HA unit hint: 1 = °C/temperature, 2 = bar/pressure, 3 = A/current;
see `unit_for_datatype`/`device_class_for_datatype` in `logic/convert.hpp`), so temperatures render
as °C with history, currents as A, and so on. This grouped JSON
is also directly consumable by a Telegraf MQTT `json_v2` parser (→ VictoriaMetrics/Grafana).

### Device identity

Every entity — heat-pump values, board diagnostics, the crash flag — belongs to **one** Home
Assistant device, identified by the **slugified MQTT base topic** (`daikin-altherma-esp32` →
`daikin_altherma_esp32`) in `dev.ids` and as the prefix of every `uniq_id`. The id therefore names
the **installation, not the board**: replace the ESP32 (or erase its flash and set it up again) and
the replacement publishes exactly the same unique ids, so HA keeps the same device, the same
entities, and their whole history and long-term statistics. Two boards on one broker means two base
topics (`CONFIG_DAIKIN_MQTT_BASE_TOPIC`, compile-time) and then, deliberately, two devices.

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

The device's own web UI, `GET /values` and the `/events` WebSocket are unaffected — they read the
poll cache directly and still show `ON`/`OFF`.

> **Upgrading:** these entities change domain (`sensor.…` → `binary_sensor.…`), so their recorder
> history does not carry over and any automation or template referencing one by entity id needs its
> name updated. The firmware deletes the stale retained `sensor` discovery config on its next
> connect, so no duplicate, permanently-unavailable entity is left behind.

Numeric values are emitted (unquoted) only when the heat pump reported them this cycle, so an
unimplemented register is absent from the JSON and shows as *unknown* in HA rather than a phantom
`0`; enum/text values (op-mode, error codes) are emitted as JSON strings. The "Error Code"
value is the raw 2-char code (e.g. `U4`), enriched with an English description when
`logic/error_codes.hpp` covers it (`"U4: Indoor/outdoor unit communication problem"`); a code
outside that table's coverage still publishes as the bare code.

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

**Verified so far** — a dated baseline, not a closed question (2026-07-26, live 4-8 kW monobloc
detected as `altherma_ebla_edla_d_series_4_8kw_monobloc`, firmware `1.0.0-dev.188`). All 11 entities
reach Home Assistant *and* survive the Telegraf → VictoriaMetrics path as numbers rather than being
dropped as strings: 11 of 11 series present and continuous over an 18-hour window, 28 390–28 394
samples each. Every counter sample was `0` and every flag `0` — and the raw page dump on `/diag`
(`logic/hexdump.hpp`) shows page `0x10` offsets 10–12 reading `00 00 00` on the wire, so those zeros
are the unit's own bytes, not a bit-masking or byte-offset defect.

What that window could **not** settle is the one thing that matters most: whether a zero counter
means a healthy plant or a byte this model never writes. It covered only a handful of brief DHW
compressor cycles in July — no defrost, no cold-weather stress — so the counters never left `0`, and
the clamp-vs-wrap question above is still unobserved. Deferred deliberately in
[#180](https://github.com/0Bu/daikin-altherma-esp32/issues/180) until a loaded season has
accumulated; the numbers above are the known-good baseline to compare that verification against, and
in particular to compare the labels against once the generator handover below happens.

They arrive from `def/overlay.hpp` rather than from a model profile, because the offline profile
generator does not emit these rows yet; see [ARCHITECTURE.md](ARCHITECTURE.md) *Value-definition
profiles*. Nothing about the entity contract depends on that — when the generator catches up, the
same rows arrive by the normal route and the entities are unchanged.

> **Upgrading:** these entities are new, not renamed — nothing pre-existing changes domain or
> entity id, so no history is affected. They appear on the next connect after the update.

> **Read-only bridge — no command topics.** The firmware only mirrors X10A telemetry; it never
> actuates the heat pump. To *control* the unit (e.g. SG-Ready boost on PV surplus), drive the
> heat pump's own SG-Ready / thermostat contacts or a Modbus/EKRHH interface from your energy
> manager — that is out of scope for this firmware.

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
        state: >
          {% set flow  = states('sensor.daikin_altherma_flow_rate_lmin') | float(0) %}
          {% set t_out = states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | float(0) %}
          {% set t_in  = states('sensor.daikin_altherma_return_water_temp_before_phe_r4t') | float(0) %}
          {% set cf    = 0.070 %}   {# 0.070 water · ~0.063 for 30% propylene glycol — set to your loop #}
          {{ [flow * cf * (t_out - t_in), 0] | max | round(3) }}
```

The `max(…, 0)` clamp stops idle/defrost reverse-ΔT from registering as negative "production".

### 2. Instantaneous COP (live gauge)

Prefer the **measured** electrical power from your meter (a Shelly EM reports live W):

```yaml
      - name: "Altherma COP (live)"
        unique_id: altherma_cop_live
        state: >
          {% set p_th = states('sensor.altherma_thermal_power') | float(0) %}
          {% set p_el = states('sensor.heatpump_power') | float(0) %}   {# external meter, kW #}
          {{ (p_th / p_el) | round(2) if p_el > 0.05 else 'unknown' }}
```

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
clamp_min(daikin_flow_rate_lmin
  * (daikin_leaving_water_temp_after_buh_r2t - daikin_return_water_temp_before_phe_r4t)
  * 0.070, 0)

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
- A live COP that is wildly off usually means the **wrong model profile** (mismatched flow/temperature
  registers) — check the detected model on the dashboard **Model** card, or `POST /detect` to re-run
  auto-detection.

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
  setpoints, the evcc path), where this firmware is (for now) read-only telemetry: a
  firmware-exclusive Modbus client that reads and writes the HomeHub register set is planned
  (issue #32, not yet wired in — see the transport core in `logic/modbus.hpp`), so this line
  describes today's shipped behaviour, not the intended end state. That end state is **conditional**,
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
