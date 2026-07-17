# Home Assistant integration

The device publishes every decoded value to MQTT using Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so a **Daikin
Altherma** device with all sensors appears automatically — no YAML. Topics, entities and
derived (COP) sensors below.

## Enabling

Web UI → tap the **pencil on the dashboard MQTT card** → enter `IP:PORT` (+ user/pass if needed) →
save. With the HA MQTT integration enabled, the device and its sensors appear on their own. Clear the
broker to disable.

## Topics

Node id is `daikin_<mac3>` (from the WiFi STA MAC, stable across config changes). `<base>`
defaults to `daikin-altherma-esp32`, `<prefix>` to `homeassistant`.

```
<base>/<node>/status                               online | offline   (LWT, retained)
<base>/<node>/state                                {<group>: {<object_id>: value, …}, …}  (retained JSON)
<prefix>/sensor/<node>/<object_id>/config          discovery config per value (retained)
```

All values ride in **one** retained JSON on `<base>/<node>/state`, grouped one level deep by X10A
register page (`{ "hydronic": { "dhw_setpoint": 48, … }, "outdoor_state": { … }, … }`, max nesting
depth 1 — group names come from `logic/mqtt_group.hpp`). Each discovery config points every sensor
at that shared topic and pulls its value out with a `value_template`:

```yaml
"stat_t": "daikin-altherma-esp32/daikin_a1b2c3/state"
"val_tpl": "{{ value_json['hydronic']['dhw_setpoint'] }}"
```

Each value's `object_id` is a lowercase, alnum-only slug of its label (e.g. *"DHW Tank Temp
(R5T)"* → `dhw_tank_temp_r5t`). The template uses bracket subscripts, so a slug that starts with a
digit (*"2way valve…"* → `2way_valve_…`) stays valid. Units and `device_class` are derived from each
value's `dataType` field (the def's HA unit hint: 1 = °C/temperature, 2 = bar/pressure, 3 = A/current;
see `unit_for_datatype`/`device_class_for_datatype` in `logic/convert.hpp`), so temperatures render
as °C with history, currents as A, and so on. This grouped JSON
is also directly consumable by a Telegraf MQTT `json_v2` parser (→ VictoriaMetrics/Grafana).

Numeric values are emitted (unquoted) only when the heat pump reported them this cycle, so an
unimplemented register is absent from the JSON and shows as *unknown* in HA rather than a phantom
`0`; enum/text values (op-mode, ON/OFF, error codes) are emitted as JSON strings. The "Error Code"
value is the raw 2-char code (e.g. `U4`), enriched with an English description when
`logic/error_codes.hpp` covers it (`"U4: Indoor/outdoor unit communication problem"`); a code
outside that table's coverage still publishes as the bare code.

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
  firmware-exclusive Modbus client with full read/write of every HomeHub register is planned
  (issue #32, not yet wired in — see the transport core in `logic/modbus.hpp`), so this line
  describes today's shipped behaviour, not the intended end state. Practical differences: EKRHH
  is a separate **paid** Daikin accessory, must run in Modbus mode UC3 (its PV modes UC1/UC2 expose no
  bus at all), and taps the **P1/P2** room-controller bus — not the **X10A** service port this
  firmware reads.
- **The heat pump's own internal kWh counter** (MMI / P1P2, whole-kWh, ~hourly) is itself just a
  ΔT×flow integration on the same uncalibrated sensors — not a higher-grade measurement. It is only
  more accurate when an external pulse kWh meter is wired to the unit's metering input. For a
  trustworthy JAZ, meter the electricity externally regardless.
