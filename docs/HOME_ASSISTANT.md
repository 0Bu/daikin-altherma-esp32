# Home Assistant integration

The device publishes every decoded value to MQTT using Home Assistant
[MQTT Discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery), so a **Daikin
Altherma** device with all sensors appears automatically — no YAML. Topics, entities and
derived (COP) sensors below.

## Enabling

Web UI → **Setup → MQTT** → enter `IP:PORT` (+ user/pass if needed) → save. With the HA MQTT
integration enabled, the device and its sensors appear on their own. Clear the broker to disable.

## Topics

Node id is `daikin_<mac3>` (from the WiFi STA MAC, stable across config changes). `<base>`
defaults to `daikin-altherma-esp32`, `<prefix>` to `homeassistant`.

```
<base>/<node>/availability                         online | offline   (LWT, retained)
<base>/<node>/state                                {<object_id>: value, …}   (retained JSON)
<prefix>/sensor/<node>/<object_id>/config          discovery config per value (retained)
```

Each value's `object_id` is a lowercase, alnum-only slug of its label (e.g. *"DHW Tank Temp
(R5T)"* → `dhw_tank_temp_r5t`). Units and `device_class` are derived from the converter id, so
temperatures render as °C with history, currents as A, and so on.

Numeric values are emitted only when the heat pump reported them this cycle, so an unimplemented
register shows as *unknown* in HA rather than a phantom `0`.

> **Read-only bridge — no command topics.** The firmware only mirrors X10A telemetry; it never
> actuates the heat pump. To *control* the unit (e.g. SG-Ready boost on PV surplus), drive the
> heat pump's own SG-Ready / thermostat contacts or a Modbus/EKRHH interface from your energy
> manager — that is out of scope for this firmware.

## Derived sensors (COP)

With flow, water-temperature and current values enabled, compute COP in `configuration.yaml` (adapt the attribute names to your selected labels — check
`GET /values`):

```yaml
template:
  - sensor:
      - name: "Altherma COP"
        unique_id: "altherma_cop"
        unit_of_measurement: "COP"
        state: >
          {% set flow   = state_attr('sensor.daikin_altherma_flow_rate_lmin','value') | float(0) %}
          {% set t_out  = states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | float(0) %}
          {% set t_in   = states('sensor.daikin_altherma_return_water_temp_before_phe_r4t') | float(0) %}
          {% set amps   = states('sensor.daikin_altherma_inv_primary_current_a') | float(0) %}
          {% set volts  = 230 %}
          {% set p_th   = flow * 0.06 * 1.16 * (t_out - t_in) %}
          {% set p_el   = amps * volts / 1000 %}
          {{ (p_th / p_el) | round(2) if p_el > 0 else 0 }}
```

> The names above follow the sample `altherma3_r_erga` profile (English labels). If you picked a
> different model or language, open `http://daikin-altherma-esp32.local/values` to see the exact labels,
> then map them to the HA entity ids (HA slugs the discovery `name`).

A COP that is wildly off usually means the wrong model profile (mismatched flow/temperature
registers) — re-check **Setup → Heat pump**.
