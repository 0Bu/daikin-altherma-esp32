---
name: metrics-audit
description: Validate the daikin-altherma-esp32 data that actually landed in VictoriaMetrics — the current snapshot AND the long-term series. Sweeps every published value for stuck/placeholder constants, out-of-envelope readings, intermittent publishing and signedness wraps, then cross-checks the physics gated on operating state, and separately checks whether the store itself is trustworthy (corrupt blocks, label churn, retention). Use to answer "are the numbers in Grafana/VM right?", after a decode or profile change, or when a dashboard looks wrong.
model: opus
---

# metrics-audit

The domain gates (`/domain-review`, `scripts/run-domain-audit.sh`) judge the catalog *offline*, against
docs. This skill judges what the device **actually published over hours of real operation** — the only
place where an idle-vs-load difference, a register that never comes alive, or a scaling error that is
only wrong *in context* becomes visible.

> **Relationship to [`value-plausibility`](../value-plausibility/SKILL.md).** That skill asks *is this
> published value physically true?* across three surfaces (device `/values`, MQTT, VictoriaMetrics) and
> ends in a fix + PR. This one asks *can the store be believed at all, and what do the whole-window
> statistics say?* — and is strictly read-only.
>
> **Layer 1 below is a precondition for that skill's core rule.** `value-plausibility` splits
> idle-vs-absent with `max_over_time(...[30d])`; in this store that query returned **HTTP 422** for
> weeks because of a single corrupt block, and a collector restart silently forks every series so a
> 30-day window can span several disjoint ones. Run layer 1 first, or that rule reads a window you did
> not mean to query. Use `value-plausibility` when the question is a wrong *value*; use this when the
> question is a wrong *dataset* — or before trusting a long window.

Three layers, in order. **Do not skip layer 1**: if the store is broken or the series are fragmented,
every number in layers 2–3 is drawn from a window you didn't mean to query.

- **Layer 1 — is the store trustworthy?** corrupt blocks, label churn, the real data window.
- **Layer 2 — statistics over the whole window.** stuck constants, envelopes, intermittency.
- **Layer 3 — physics.** cross-series consistency, **gated on operating state**.

Tools: the `victoria-metrics` MCP (`mcp__victoria-metrics__query`, `query_range`, `series`,
`metrics`, `label_values`, `tsdb_status`). Read-only — never call anything that deletes.

Metric families: `daikin_altherma_*` (heat-pump values, from MQTT `<base>/state`) and
`daikin_heartbeat_*` (board/link diagnostics, from `<base>/heartbeat`, fixed 10 s cadence).

## MetricsQL traps — hit these once each, then stop

| Symptom | Cause | Fix |
|---|---|---|
| `duplicate output timeseries` | rollup functions **drop `__name__`**, so every series collapses to the same label set | append **`keep_metric_names`**: `count_over_time({__name__=~"daikin_altherma_.*"}[13h]) keep_metric_names` |
| A multi-metric `a or b or c` returns **one** series with values that make no sense | `or` de-duplicates on the label set and the daikin series differ **only** by `__name__` — so it silently interleaves different metrics | never chain `or` here; select with one regex: `{__name__=~"metric_a\|metric_b"}` |
| HTTP **422** with a hex `src=…` dump | a **corrupt data block** in the TSDB, not a query problem | see layer 1 |

Sanity-check any window before trusting it: `count_over_time(<metric>[<window>]) keep_metric_names`
against the expected cadence (state ≈ 1 sample / 2 s, heartbeat = 1 / 10 s). A count far below that
means the series is **intermittent**, which is itself a finding — not a reason to widen the window.

## Layer 1 — is the store trustworthy?

1. **Find the real data window.** Never assume the window you asked for is the window you got.
   ```
   query_range: count(daikin_heartbeat_uptime_s)   start=now-30d step=6h
   ```
   The first point is where the data actually begins. If it is far more recent than expected, find out
   why *before* interpreting anything — a collector restart and a device reinstall look identical here.

2. **Corrupt blocks.** A `422` + `cannot unmarshal … nearest delta2 …` is a storage defect. It is
   reproducible and returns an **identical** byte dump every time — that is how you tell it from a
   too-big query. Bisect it by halving the time range until you have the narrowest failing window, and
   report that window: every dashboard panel spanning it errors out instead of drawing.

3. **Label churn.** The collector's `host` label is the **telegraf pod name** unless pinned. Each
   restart therefore starts a brand-new set of series and orphans the old ones:
   ```
   query_range: count by (host) ({topic=~"daikin.*"})   start=now-7d step=2h
   ```
   More than one `host` in the window ⇒ series breaks, inflated cardinality, and `rate()`/`increase()`
   wrong across the seam. (Fix lives in the cluster repo's `telegraf/values.yaml`, not here.)

4. **What never arrives at all.** Compare `daikin_heartbeat_bus_values` (what the device decoded) with
   the number of `daikin_altherma_*` series that exist. The telegraf `json` parser keeps **numeric
   fields only** — enum/text/boolean values (operating mode, defrost, compressor on/off) are dropped by
   design. State that gap explicitly whenever a conclusion in layer 3 would have needed one of them.

## Layer 2 — statistics over the whole window

Run these three over the full window and read them together. `W` = the window from layer 1.

```
# 1. stuck constants — fraction of samples exactly equal to 0
sort_desc(round(share_eq_over_time({__name__=~"daikin_altherma_.*"}[W], 0) keep_metric_names, 0.01))

# 2. envelopes
sort_desc(max_over_time({__name__=~"daikin_altherma_.*"}[W]) keep_metric_names)
sort(min_over_time({__name__=~"daikin_altherma_.*"}[W]) keep_metric_names)

# 3. intermittency — expect ≈ W/2s per series
sort_desc(count_over_time({__name__=~"daikin_altherma_.*"}[W]) keep_metric_names)
```

What each one catches:

- **`share_eq… == 1`** — the value never moved off exactly `0` for the entire window. For an *error
  code* or an absent sensor that is correct. For a **temperature or pressure while the compressor was
  running** it is not a reading at all: it is an unmapped/mis-offset register publishing zero. Always
  check the run windows (layer 3 step 1) before calling a zero legitimate.
- **`max`/`min`** — the classic decode failures:
  - a **signedness wrap**: `65528` = `0xFFF8` = int16 `−8` read as uint16. Any max near 65535 or 32768+ on a value that should be small is this.
  - a **scaling error**: a value that becomes physically perfect after ÷10 or ÷100. Test it — and check the divided value against a *related* series from the same period (e.g. an outdoor-coil temp against outdoor air temp), not against your intuition.
  - a value sitting **just inside** `reading_plausible`'s `[-60, 200]` °C envelope. `199.6 °C` passes the firmware gate and is still impossible *for a target evaporating temperature*. The global envelope cannot see context; you can.
- **`count` far below cadence** — published only sometimes. Correlate *when*: a value that appears only
  during compressor runs and reads garbage there is a layout mismatch, not idle noise.

## Layer 3 — physics, gated on operating state

**This is the step that produces false alarms if you rush it.** Two series that look contradictory are
often both correct for the state the machine was in.

1. **Find the operating windows first.** The heat pump is mostly idle; comparing sensors across an
   idle stretch proves nothing. Locate the runs before comparing anything:
   ```
   query_range: {__name__=~"daikin_altherma_hydronic_state_flow_sensor_l_min|daikin_altherma_hydronic_state_water_pump_signal_0_max_100_stop|daikin_altherma_actuators_inv_frequency_rps"}
   ```
   Pump signal is **inverted**: `100` = stop, low values = near max. Flow > 0 and pump signal well
   below 100 = the loop is actually circulating.

2. **Compare only inside a run.** Worked example — the leaving-water pair, at 4 min resolution:

   ```
   Pumpe    Fluss   R4T ein   R1T vor BUH   R2T nach BUH
   100=stop   0      29,6        33,6          28,0      ← stagnant: 5,6 K spread
     4       24,0    46,3        49,1          48,9      ← flowing: 0,2 K
     4       23,4    58,2        61,4          61,2      ← flowing: 0,2 K
   100=stop   0      57,9        62,9          60,6      ← divergence resumes at pump stop
   ```

   **With flow, R1T and R2T agree to 0,2 K and ΔT against the inlet is +2,8…3,2 K — correct.** The
   10–20 K spread at zero flow is stagnant-loop stratification (one end sits at the plate HX, the other
   at a cold BUH body), *not* a decode bug. Reporting it as one is a false alarm this skill exists to
   prevent.

   The real finding in that data is the derived-value warning below.

3. **Derived values need a flow gate.** ΔT, heat output and COP are meaningless at zero flow, and flow
   is zero in the large majority of samples in a summer window. Ungated, the standstill spread produces
   a fake ΔT of up to 20 K. Whenever you report a ΔT/COP figure, say what fraction of samples it was
   computed over.

4. **Cross-checks worth running** (each is a *question*, not a threshold — answer it with the run
   windows in hand):
   - Does every sensor that must come alive under load actually do so? A partly-alive block (discharge pipe and inverter current move, but pressures and coil temps stay at 0) is the signature of an **offset/layout mismatch in the active profile**, not a dead register page.
   - Is the refrigerant saturation temperature consistent with the measured pressure?
   - Does the outdoor coil temperature sit in a sane band relative to outdoor air?
   - Does the DHW tank temperature rise during, and only during, a charge?

5. **Board health** (`daikin_heartbeat_*`) — cheap, do it every run: `bus_rx_fails` / `bus_rx_received`
   (error rate), `bus_crc_err`, `mqtt_fails`, `mqtt_reconnects`, `wifi_reconnects`, `wifi_rssi`,
   `free_heap` / `min_free_heap` / `max_alloc`, and `uptime_s` as a range query — a **sawtooth is a
   reboot history** that a single current value cannot show.

## Known-accepted — do NOT re-report these as new findings

Check the project memory before writing the report; these were adjudicated deliberately and re-raising
them costs the user time:

- The **`0.0` cluster** (OU-II rows, hybrid fields on a non-hybrid unit) and the **`−40,4 °C` 2nd-DHW**
  placeholder are left as-is on purpose (PR #137): they are inside the plausibility envelope, and
  hard-hiding them fleet-wide would risk suppressing real cold/zero data. The fix belongs in
  **detection**, not a value filter.
- `hp.error_code` / `outdoor_state_error_code` at `0` means **no error** — a legitimate constant.
- An absent optional sensor (e.g. `ext_indoor_ambient_sensor_r6t` with no sensor fitted) reading `0`
  is legitimate.

## Report

Lead with a verdict per layer, then the evidence. Rules that keep the report worth reading:

- **Separate store problems from device problems.** They have different owners (cluster repo vs.
  firmware) and different urgency.
- **State which claims are verified and which are hypotheses.** A scaling hypothesis that lands in the
  right band is *evidence*, not proof — say what would settle it (usually the raw wire bytes, which
  HTTP does not expose; that needs a diag line in `hp_detect` + an OTA).
- **Say what you ruled out and why.** A dismissed suspicion is a real result, and it stops the next
  session from re-opening it.
- **Give every number its window and its sample count.** "199,6 °C" alone is an anecdote; "199,6 °C,
  published only inside the two compressor runs, 139 of 23 370 samples" is a finding.
- Suggest next actions, ordered by blast radius. Take none of them — this skill is read-only.
