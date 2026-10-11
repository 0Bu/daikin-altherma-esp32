# Heat output, energy and COP recipes

These examples estimate heat from water flow and temperatures, then compare it with **metered
heat-pump electricity**. They do not make the plant's uncalibrated sensors into a certified heat
meter. Review input identity, units, gaps and system boundary before interpreting the result.

## Choose the inputs

| Input | Required measurement |
|---|---|
| Flow | Genuine water flow in litres/minute. A catalog row alone does not prove a sensor is fitted. |
| Leaving temperature | Water **after the electric backup heater**, usually R2T. |
| Return temperature | Water entering the circuit, matched by its full label. |
| Electrical power/energy | A real meter covering the same equipment whose heat is counted. |

Look up your actual entities in Home Assistant and their full labels in `/values`. Model labels
vary: leaving water may be **Leaving water temp. after BUH (R2T)**, **Outlet water BUH temp. (R2T)**
or the ECH2O **HPSU TVBH inflow temp. after buffer/BUH (R2T)**. Return water can be **Inlet water
temp. (R4T)** or **HPSU TR return temp. (R4T)**. **Do not select by “R4T” alone**: that tag also
labels outdoor heat-exchanger/de-icer and refrigerant sensors on other profiles.

Protocol **S lacks the required water flow and leaving/return measurements**. On Protocol I, use
this recipe only when those rows are readable and their physical sensors are fitted.

Use measured total active power and accumulated kWh, including the indoor/outdoor unit and backup
heater if their heat is included in the numerator. A compressor-current estimate omits equipment
and depends on voltage/power factor. HomeHub's internal power figure is an estimate too.
A temperature measured before the backup heater, or a profile without R2T, is usable for this ratio
only while **BUH is known off** and the other required water readings are available; otherwise its
electricity is counted without its heat.

The tank booster **BSH lies outside both water-temperature measurement points**. If its electricity
is included, a whole-installation live COP requires BSH to be **known off**; unknown means an
unproven boundary. The firmware suppresses that COP in both cases. The example below therefore
requires a readable BSH binary sensor reporting `off`. Replace its example id with your own.

## 1. Instantaneous thermal power

```text
P_thermal [kW] = flow [l/min] × (leaving − return) [K] × Cf
```

Near **35 °C**, use `Cf = 0.0692` for pure water, approximately `0.0660` for **30% propylene glycol
by mass**, or `0.0647` for **30% ethylene glycol by mass**. Density and heat capacity depend on
temperature; volume concentration is not mass concentration. Use the supplier's table for the actual
fluid. Keeping the water constant for a glycol mixture creates a systematic error.

The firmware dashboard uses `4.186 kJ/(l·K)` (`Cf = 0.06977`), about **0.8% higher** than this
35 °C water example before sensor and installation uncertainty.

Replace **all three example entity ids** below with your own. Keep the result signed: during defrost
heat is withdrawn from the water. Clamping negative output to zero overstates net production and
period efficiency. Missing inputs must make the sensor unavailable, not zero.

```yaml
template:
  - sensor:
      - name: "Altherma Thermal Power"
        unique_id: altherma_thermal_power
        device_class: power
        unit_of_measurement: "kW"
        state_class: measurement
        availability: >
          {{ states('sensor.daikin_altherma_flow_sensor_l_min') | is_number
             and states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | is_number
             and states('sensor.daikin_altherma_inlet_water_temp_r4t') | is_number }}
        state: >
          {% set flow = states('sensor.daikin_altherma_flow_sensor_l_min') | float %}
          {% set leaving = states('sensor.daikin_altherma_leaving_water_temp_after_buh_r2t') | float %}
          {% set returning = states('sensor.daikin_altherma_inlet_water_temp_r4t') | float %}
          {{ (flow * 0.0692 * (leaving - returning)) | round(3) }}
```

## 2. Live heat/electricity ratio

Add this sensor to the same `template` sensor list. Here **`sensor.heatpump_power_w` is your external
meter in W**; the template checks that unit and explicitly converts it to kW. A 50 W denominator
guard avoids ratios at near-zero power. It is an illustrative guard, not a heat-pump operating
threshold. `binary_sensor.daikin_altherma_bsh` must be your actual booster-heater state entity.

```yaml
      - name: "Altherma COP (live)"
        unique_id: altherma_cop_live
        availability: >
          {{ states('sensor.altherma_thermal_power') | is_number
             and states('sensor.heatpump_power_w') | is_number
             and state_attr('sensor.heatpump_power_w', 'unit_of_measurement') == 'W'
             and is_state('binary_sensor.daikin_altherma_bsh', 'off')
             and states('sensor.heatpump_power_w') | float > 50 }}
        state: >
          {% set heat_kw = states('sensor.altherma_thermal_power') | float %}
          {% set electric_kw = states('sensor.heatpump_power_w') | float / 1000 %}
          {{ (heat_kw / electric_kw) | round(2) }}
```

Negative defrost heat remains negative here; do not read that instant as a heating-only efficiency
rating. Meter and heat-input timestamps also need sufficient alignment to make an instantaneous
ratio useful. A precise electrical meter cannot correct flow error or temperature-sensor bias.

## 3. Integrate and compare the same period

Merge these sections into your Home Assistant configuration; do not create duplicate top-level
`sensor`, `template` or `utility_meter` keys. The thermal source already uses **kW**, so the
integration below produces **kWh without an extra `unit_prefix`**. If your source instead reports W,
use `unit_prefix: k` to obtain kWh. Choose one unit convention throughout.

```yaml
sensor:
  - platform: integration
    source: sensor.altherma_thermal_power
    name: Altherma Thermal Energy
    unique_id: altherma_thermal_energy
    unit_time: h
    method: trapezoidal

utility_meter:
  altherma_thermal_energy_yearly:
    source: sensor.altherma_thermal_energy
    cycle: yearly
    net_consumption: true
    periodically_resetting: false
  heatpump_electrical_energy_yearly:
    source: sensor.heatpump_energy_kwh
    cycle: yearly
```

`net_consumption: true` allows negative defrost contributions; `periodically_resetting: false`
identifies the persistent signed integral rather than treating a decrease as a source reset.
`heatpump_energy_kwh` is the real meter's accumulated kWh, not an integral of a current estimate.
Use meters commissioned at the same period start; gaps and mismatched reset dates invalidate a
simple quotient.

Add this to the same template sensor list:

```yaml
      - name: "Altherma water-circuit energy ratio (yearly)"
        unique_id: altherma_period_efficiency_yearly
        availability: >
          {{ states('sensor.altherma_thermal_energy_yearly') | is_number
             and states('sensor.heatpump_electrical_energy_yearly') | is_number
             and states('sensor.heatpump_electrical_energy_yearly') | float > 0 }}
        state: >
          {% set heat = states('sensor.altherma_thermal_energy_yearly') | float %}
          {% set electricity = states('sensor.heatpump_electrical_energy_yearly') | float %}
          {{ (heat / electricity) | round(2) }}
```

The period ratio is `net thermal kWh / electrical kWh`. This water-circuit numerator misses BSH
heat and other unmeasured tank contributions even if their electricity is metered. Label it a
**water-circuit energy ratio**. Whole-installation SCOP/JAZ requires both totals to cover the
complete system; this recipe does not establish that boundary or a standardized manufacturer rating.

### VictoriaMetrics / Grafana equivalent

Map these placeholder metric names to your own collector. First record signed thermal power as
`heatpump_thermal_power_kw`:

```promql
heatpump_flow_l_min
  * (heatpump_leaving_after_buh_c - heatpump_return_c)
  * 0.0692
```

Then use a matching query range:

```promql
# Net thermal kWh: MetricsQL integrate() returns value × seconds.
integrate(heatpump_thermal_power_kw[$__range]) / 3600

# Electrical kWh from the real counter.
increase(heatpump_energy_kwh[$__range])

# Period ratio; require positive electricity and adequate source coverage.
integrate(heatpump_thermal_power_kw[$__range]) / 3600
  / increase(heatpump_energy_kwh[$__range])
```

`integrate()` is MetricsQL. In Prometheus, a recording rule plus
`sum_over_time(heatpump_thermal_power_kw[$__range]) * <sample_interval_s> / 3600` is only an
approximation for regular, gap-free sampling. Neither query proves that absent measurements were
zero or that a data gap can be safely bridged.

## Accuracy and scope

The dominant limits are the fluid constant, actual flow measurement, correct sensor locations and
error in a small temperature difference. Two uncalibrated temperature sensors can produce a large
relative error when leaving and return water differ by only a few kelvin. Bias does not necessarily
average away over a season. Faster polling cannot fix it.

A plausible ratio is insufficient validation: the wrong water sensor can still yield a plausible
ΔT. Check full labels and detected model, compare independent measurements, keep negative heat and
account for gaps. If the ratio collapses specifically when the backup heater runs, check the
measurement boundary before diagnosing the plant.

The read-only HomeHub source can supply its own flow and leaving/return temperatures, but keep its
cadence, units and provenance separate from X10A. Its available map depends on model, MMI firmware
and Modbus commissioning; see [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md). This project does not
integrate energy on the device or substitute cloud estimates for a physical electricity meter.
