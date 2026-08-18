// ── 24-hour trend (a historied value row's explainer carries a sparkline under the text) ──────
// WHICH rows have a trend is the FIRMWARE's answer. /status.history.rows names X10A rings;
// modbus_rows names the paired HomeHub measurements/states plus Smart-Grid and the standalone
// disinfection timeline; env3_rows names temperature, humidity and pressure from the independent outdoor
// sensor.
// The device keeps every source at one fixed cadence and reports the labels each source owns. The
// browser never pattern-matches its own candidates: offering a trend the device isn't buffering
// would be an empty chart by design.
// Each entry is {id, label}: the ID is the stable history key GET /history takes. Paired sources
// deliberately reuse logic/history.hpp's TRENDS ids ("dhw_tank", "outdoor_air", …); an honest
// single-source timeline such as Modbus disinfection has its own id. The LABEL is how this profile
// spells the row. Requesting by id keeps the route model-independent; matching by label is how a
// rendered X10A value row finds its own trend; HomeHub rows carry their explicit `history` id.
//
// Everything below is keyed by the ID, never by the label; the second instrument uses the explicit
// `modbus:<id>` or `env3:<id>` namespace. A label is per-profile, so a cache keyed by it would be re-keyed by a
// model change mid-session — and not every trended thing IS a catalog row. The board's own memory
// (free_heap, max_alloc) is drawn on the Settings ESP32 card, whose row labels are TRANSLATED, so
// there is no label to match on at all; it attaches by id like the firmware always intended.
function histSpec() { const h = S.status && S.status.history; return h && Array.isArray(h.rows) ? h : null; }
function modbusHistRows() {
  const h = histSpec();
  return h && Array.isArray(h.modbus_rows) ? h.modbus_rows : [];
}
function env3HistRows() {
  const h = histSpec();
  return h && Array.isArray(h.env3_rows) ? h.env3_rows : [];
}
function histFor(label) {
  const h = histSpec();
  return h ? h.rows.find((r) => r && r.label === label) || null : null;
}
// The trend id for a rendered value-row label, or "" when the device buffers no series for it.
function histIdFor(label) { const r = histFor(label); return r ? r.id : ""; }
// Is the device keeping this series? Asked by ID — a board row has no catalog label to look up, and
// a firmware that predates a trend simply reports fewer rows, so its card draws no chart at all
// rather than an empty one.
function hasDeviceHist(id) { return !!id && !!histSpec() && histSpec().rows.some((r) => r && r.id === id); }
function hasModbusHist(id) { return !!id && modbusHistRows().some((r) => r && r.id === id); }
function hasEnv3Hist(id) { return !!id && env3HistRows().some((r) => r && r.id === id); }
function hasHist(id) {
  const D = DERIVED[id];
  return D ? D.ready(Object.fromEntries(D.ins.map((k) => [k, hasDeviceHist(k)]))) : hasDeviceHist(id);
}

// Sum CT current only when every phase ring declared by this firmware snapshot has a value in the
// bucket. A null is not zero: CT-L3 is deliberately withheld while its shared byte carries the
// HP-Forced flag, and adding the surviving phases would understate input. Returning null lets both
// derived consumers use their INV fallback, exactly like liveData(); a real complete 0 A set still
// returns zero and therefore also falls back for the compressor-only estimate.
function completeCtCurrent(s, has) {
  const keys = ["ct_l1", "ct_l2", "ct_l3"].filter((k) => has && has[k]);
  return !keys.length || keys.some((k) => s[k] == null)
    ? null : keys.reduce((a, k) => a + s[k], 0);
}

// ── Derived trends: computed pills and combined component states ───────────────────────────────
// Pump speed, ΔT, heat output, electrical input and COP have no directly matching register value, so
// the device has nothing to buffer for the displayed figure itself. BUH likewise has two physical
// stage bits but one component-level inspector. Their 24-hour curves/timeline are assembled
// HERE, out of the rings of what each is computed FROM,
// by the same expressions liveData() uses for the live number — one definition of each figure
// rather than a firmware copy and a browser copy free to drift apart. `inv_current` and `ct_l1..3`
// are in logic/history.hpp's TRENDS for exactly this; they are inputs first and rows second.
//
// Every input arrives on ONE raster: history.cpp commits every ring on the same bucket boundary, so
// sample i is the same five minutes in all of them, and a row the profile lacks is simply not
// offered (/status.history omits it) instead of silently shifting the axis under a curve.
//
// A sample is null wherever a required input is null, and the gap is drawn as a gap. That also
// carries the held-over rule through for free: a reading the outdoor unit was not taking is null in
// its own ring, so the figure derived from it is null too — never last run's amps drawn as a live
// kilowatt, which is the exact failure the live pill's gate exists to prevent (logic/ou_stale.hpp).
//
// `ins` = every series to fetch. `ready(has)` = may this figure be offered at all on this profile
// (feature_gate.hpp's DISABLE-NEVER-DEGRADE: no honest inputs, no curve — never a substitute one).
// `fn(s)` = one sample from one bucket's values, null for a gap.
const DERIVED = {
  // Both BUH stages are event-folded by the firmware before they get here: an ON observed anywhere
  // in the open five-minute bucket survives a later OFF. Combine those aligned, structurally
  // converter-qualified rings into the same three states the live BUH inspector uses. Step 2 wins
  // because it denotes the higher output stage; a missing input leaves a gap rather than proving OFF.
  buh_state: {
    unit: "", ins: ["buh_step1", "buh_step2"],
    ready: (h) => h.buh_step1 && h.buh_step2,
    fn: (s) => s.buh_step1 == null || s.buh_step2 == null ? null
      : s.buh_step2 > 0 ? 2 : s.buh_step1 > 0 ? 1 : 0,
  },
  // The X10A row is an inverted control signal: 0 = maximum and 100 = stop. The schematic instead
  // shows the intuitive speed percentage, so its chart must transform every sample by the exact same
  // clamped expression as liveData(). Drawing the raw row would make an idle pump look maximal.
  pump_speed: {
    unit: "%", ins: ["pump_signal"],
    ready: (h) => h.pump_signal,
    fn: (s) => s.pump_signal == null ? null
      : Math.min(100, Math.max(0, 100 - s.pump_signal)),
  },
  dt: {
    unit: "K", ins: ["leaving_water", "return_water"],
    ready: (h) => h.leaving_water && h.return_water,
    fn: (s) => (s.leaving_water == null || s.return_water == null ? null
                                                                  : s.leaving_water - s.return_water),
  },
  // Water ≈ 4.186 kJ/kg·K, flow in l/min — d.pth's formula, and SIGNED for its reason: during a
  // defrost the unit pulls heat back out of the water and the curve must show that, not a floor.
  pth: {
    unit: "kW", ins: ["flow", "leaving_water", "return_water"],
    ready: (h) => h.flow && h.leaving_water && h.return_water,
    fn: (s) => (s.flow == null || s.leaving_water == null || s.return_water == null
                  ? null : (s.flow / 60) * 4.186 * (s.leaving_water - s.return_water)),
  },
  // Amps × an assumed 230 V, a complete declared CT set preferred over inverter current —
  // liveData()'s rule, one sample at a time. The live version needs `d.ouHeldOver` to gate the INV
  // fallback because /values still carries last run's number; here the ring has already withheld
  // it, so a null is simply a null. An idle plant reads 0 A on fitted clamps, and the fallback is
  // what makes that a compressor figure rather than a flat zero.
  pel: {
    unit: "kW", ins: ["ct_l1", "ct_l2", "ct_l3", "inv_current"],
    ready: (h) => h.inv_current || h.ct_l1 || h.ct_l2 || h.ct_l3,
    fn: (s, has) => {
      const ct = completeCtCurrent(s, has);
      if (ct != null && ct > 0) return (ct * 230) / 1000;
      return s.inv_current == null ? null : (s.inv_current * 230) / 1000;
    },
  },
  // The quotient, and it is deliberately drawn on FEWER samples than its two inputs. Two gates:
  //   running — the live pill's own (rps > 5, ΔT > 0.5); a COP of a stopped plant is not a small
  //             COP, it is not one at all.
  //   scope   — cop_scope.hpp: the CT clamps see the whole unit INCLUDING both resistive heaters
  //             while this historical quotient deliberately retains the pre-BUH boundary. R2T now
  //             has its own curve, but tank-heater heat crosses neither water sensor and the five-
  //             minute rings keep last readings/events rather than one synchronised plant sample.
  //             A CT-sourced sample therefore still draws NOTHING instead of splicing together a
  //             plausible whole-plant quotient. An INV-sourced sample has the heaters outside both
  //             sides and needs no such evidence, which is why it survives.
  cop: {
    unit: "", ins: ["flow", "leaving_water", "return_water", "comp_rps", "inv_current",
                    "ct_l1", "ct_l2", "ct_l3"],
    none: {
      en: "No COP curve while the electrical figure comes from the CT clamps. Which loads those clamps include depends on their wiring, while the buffered heat side ends before the backup heater and cannot include heat added directly by the tank heater; a matching boundary is therefore not guaranteed.",
      de: "Kein COP-Verlauf, solange der Stromwert von den Stromwandlern kommt. Welche Lasten sie erfassen, hängt von ihrer Verdrahtung ab; die gepufferte Wärmeseite endet zugleich vor dem Zusatzheizer und kann direkt eingebrachte Wärme des Speicherheizstabs nicht erfassen. Eine passende Bilanzgrenze ist daher nicht gesichert.",
    },
    ready: (h) => h.flow && h.leaving_water && h.return_water && h.comp_rps && h.inv_current,
    fn: (s, has) => {
      const ct = completeCtCurrent(s, has);
      if (ct != null && ct > 0) return null;           // whole-unit divisor — see the note above
      if (s.inv_current == null || s.flow == null) return null;
      if (s.leaving_water == null || s.return_water == null || s.comp_rps == null) return null;
      const dt = s.leaving_water - s.return_water;
      const pel = (s.inv_current * 230) / 1000;
      if (!(s.comp_rps > 5) || !(dt > 0.5) || !(pel > 0.2)) return null;
      return ((s.flow / 60) * 4.186 * dt) / pel;
    },
  },
};

// Was sample `i` absent because the outdoor unit was ASLEEP rather than because something failed to
// measure? The firmware decides it (logic/history.hpp — pages 0x20/0x21 keep answering with the last
// run's numbers while the compressor rests) and sends the run-length ranges; the browser only reads
// them. Deriving it here from the row's register would be a second copy of a rule CI already gates.
function histHeld(h, i) {
  const runs = h && h.held;
  if (!Array.isArray(runs)) return false;
  for (const r of runs) if (i >= r[0] && i < r[0] + r[1]) return true;
  return false;
}

// Fetch a row's series at most once a minute. The buffer moves one sample per `dt` (300 s), so a
// per-poll refetch would send ~300 identical responses per new data point — and each response is a
// ~1 KB contiguous string on the single httpd task (AGENTS.md → Memory, concurrency, and HTTP
// safety).
const histCacheKey = (id, source) => source === "modbus" ? `modbus:${id}`
  : source === "env3" ? `env3:${id}` : id;
async function ensureHist(id, source = "x10a", paint = true, signal = null) {
  const key = histCacheKey(id, source);
  const offered = source === "modbus" ? hasModbusHist(id)
    : source === "env3" ? hasEnv3Hist(id) : hasHist(id);
  if (!offered || S.histBusy.has(key)) return;
  const c = S.hist.get(key);
  if (c && Date.now() - c.at < 60000) return;
  if (source === "x10a" && DERIVED[id]) { await ensureDerived(id); return; }
  const previous = S.hist.get(key);
  S.histBusy.add(key);
  try {
    const suffix = source === "modbus" ? "&source=modbus"
      : source === "env3" ? "&source=env3" : "";
    const r = await fetch("/history?row=" + encodeURIComponent(id) + suffix,
                          signal ? { signal } : undefined);
    const j = await r.json();
    // t0 = the unix instant of sample 0, present only when the device's SNTP clock is synced. Null
    // means the scrub readout falls back to an AGE ("vor 6.3 h") — never a fabricated wall-clock
    // time, the same rule logic/timestamp.hpp applies to an unsynced clock on the firmware side.
    // `gen` counts fetches. It is what makes an index-anchored pin (no wall clock on the device)
    // honest: such a pin is only valid for the exact series it was made on, and a refetch may have
    // rolled the ring — so it is dropped rather than re-pointed at a different sample.
    const gen = ((previous || {}).gen || 0) + 1;
    // A few legacy X10A rows carry their unit only in the catalog label. Normalise that at the
    // visual boundary too, otherwise the live row can say "22.8 L/min" while its own trend and
    // crosshair still say just "22.8". The API remains byte-for-byte compatible.
    const device = { at: Date.now(), gen, source, dt: +j.dt || 300, unit: displayUnit(j),
                     label: typeof j.label === "string" ? j.label : "",
                     t0: typeof j.t0 === "number" ? j.t0 : null,
                     b0: Number.isInteger(j.b0) ? j.b0 : null,
                     held: Array.isArray(j.held) ? j.held : [],
                     v: Array.isArray(j.v) ? j.v : [] };
    S.hist.set(key, device);
  } catch (e) {
    S.hist.set(key, { at: Date.now(), source, err: true, v: [] });
  } finally {
    S.histBusy.delete(key);
    if (paint) renderApp();
  }
}

// Direct schematic measurements may have two independent rings. Fetch both together only for a
// chart the user actually opened; derived figures continue to fetch their X10A inputs alone.
async function ensureHistPair(id) {
  await Promise.all([
    hasHist(id) ? ensureHist(id) : null,
    hasModbusHist(id) ? ensureHist(id, "modbus") : null,
    hasEnv3Hist(id) ? ensureHist(id, "env3") : null,
  ]);
}

// A derived series: fetch every input (each through ensureHist above, so each is cached and
// throttled exactly once however many figures read it — ΔT, heat output and COP all want the same
// three rings), then run the figure's own expression down the samples.
//
// The result is written into S.hist under the derived id in the SAME shape a fetched series has, so
// the renderer, the crosshair, the pin and the range readout need to know nothing about where a
// series came from. `gen` still counts assemblies, which keeps an index-anchored pin as honest here
// as it is there.
//
// Inputs share the firmware's monotonic bucket ids. Build their UNION raster and leave null wherever
// one input has no sample: taking only the shortest input used to collapse an otherwise 24-hour
// derived curve to 1 h or 8 h after one row appeared/reset later. `b0` makes padding exact rather
// than a guess; wall time is the next choice, and newest-tail alignment remains only for legacy
// responses without either anchor.
async function ensureDerived(id) {
  const D = DERIVED[id];
  if (S.histBusy.has(id)) return;
  S.histBusy.add(id);
  try {
    const has = Object.fromEntries(D.ins.map((k) => [k, hasDeviceHist(k)]));
    const use = D.ins.filter((k) => has[k]);
    await Promise.all(use.map((k) => ensureHist(k)));
    const src = use.map((k) => [k, S.hist.get(k)]).filter(([, h]) => h && !h.err && h.v.length);
    if (!src.length) { S.hist.set(id, { at: Date.now(), err: true, v: [] }); return; }
    const dt = src[0][1].dt || 300;
    let start = 0, end = 0, mode = "tail";
    if (src.every(([, h]) => Number.isInteger(h.b0))) {
      mode = "bucket";
      start = Math.min(...src.map(([, h]) => h.b0));
      end = Math.max(...src.map(([, h]) => h.b0 + h.v.length - 1));
    } else if (src.every(([, h]) => typeof h.t0 === "number" && h.dt === dt)) {
      mode = "time";
      start = Math.min(...src.map(([, h]) => h.t0));
      end = Math.max(...src.map(([, h]) => h.t0 + (h.v.length - 1) * dt));
    } else {
      end = Math.max(...src.map(([, h]) => h.v.length)) - 1;
    }
    const n = mode === "tail" ? end + 1
      : Math.round((end - start) / (mode === "time" ? dt : 1)) + 1;
    const sourceIndex = (h, i) => mode === "bucket" ? start + i - h.b0
      : mode === "time" ? Math.round((start + i * dt - h.t0) / dt)
      : h.v.length - n + i;
    const v = [], heldRuns = [];
    for (let i = 0; i < n; i++) {
      const s = {}; let missing = 0, heldMissing = 0;
      for (const [k, h] of src) {
        const j = sourceIndex(h, i);
        const raw = j >= 0 && j < h.v.length ? h.v[j] : null;
        s[k] = raw == null ? null : raw / 10;             // tenths on the wire, units in the formula
        if (raw == null) { missing++; if (j >= 0 && j < h.v.length && histHeld(h, j)) heldMissing++; }
      }
      const out = D.fn(s, has);
      v.push(out == null || !Number.isFinite(out) ? null : Math.round(out * 10));
      // A gap inherits its REASON, and only when EVERY missing input carries it: "the outdoor unit
      // was resting" is a statement that nothing failed, so one input that genuinely failed to
      // measure has to outrank it. Blaming an idle compressor for a real dropout is the same class
      // of wrong here as it is on the pill — and the chart's axis prints the two differently.
      if (out == null && missing > 0 && heldMissing === missing) {
        const last = heldRuns[heldRuns.length - 1];
        if (last && last[0] + last[1] === i) last[1]++; else heldRuns.push([i, 1]);
      }
    }
    const gen = ((S.hist.get(id) || {}).gen || 0) + 1;
    const wall = src.find(([, h]) => typeof h.t0 === "number");
    const bucket = src.find(([, h]) => Number.isInteger(h.b0));
    const t0 = mode === "time" ? start
      : mode === "bucket" && wall ? wall[1].t0 - (wall[1].b0 - start) * dt
      : wall ? wall[1].t0 - (n - wall[1].v.length) * dt : null;
    const b0 = mode === "bucket" ? start
      : mode === "time" && bucket && typeof bucket[1].t0 === "number"
        ? bucket[1].b0 - Math.round((bucket[1].t0 - start) / dt)
      : bucket ? bucket[1].b0 - (n - bucket[1].v.length) : null;
    S.hist.set(id, { at: Date.now(), gen, dt, unit: D.unit,
                     t0: typeof t0 === "number" ? t0 : null,
                     b0: Number.isInteger(b0) ? b0 : null,
                     held: heldRuns, v });
  } catch (e) {
    S.hist.set(id, { at: Date.now(), err: true, v: [] });
  } finally {
    S.histBusy.delete(id); renderApp();
  }
}

// The plot's own coordinate system. The SVG stretches to the panel width (preserveAspectRatio
// "none"), so the path is drawn in these units and the stroke is kept honest with
// vector-effect="non-scaling-stroke" — otherwise a wide panel would smear the line horizontally.
// No internal padding: the geometry uses the full box and the container lets the stroke overflow,
// which keeps the "now" marker's percentage mapping (below) exactly the plot's own scale.
const HIST_W = 320, HIST_H = 72;

// The plot's vertical scale, derived once and shared by the renderer AND the cursor. It used to be
// computed in both places, which is a two-copy invariant of the worst kind: a change to the padding
// in one would leave the crosshair marker sitting off the line it is pointing at, and the drawing
// would still look perfectly plausible. Returns the mapping, not the numbers, so no caller can
// re-derive it slightly differently.
function histScale(pts, sampleCount) {
  const real = pts.filter((x) => x != null);
  const lo = Math.min(...real), hi = Math.max(...real);
  const pad = (hi - lo) < 1 ? 1 : (hi - lo) * 0.12;   // a flat series gets a band, not a divide-by-zero
  const y0 = lo - pad, y1 = hi + pad;
  const n = sampleCount || pts.length;
  return {
    lo, hi,
    X: (i) => (n === 1 ? HIST_W : (i * HIST_W) / (n - 1)),
    Y: (v) => HIST_H - ((v - y0) / (y1 - y0)) * HIST_H,
  };
}

const ENV3_COMBINED_ID = "env3_combined";
const ENV3_COMBINED_SERIES = Object.freeze([
  { id: "env3_temperature", label: "env.temperature" },
  { id: "env3_humidity", label: "env.humidity" },
  { id: "env3_pressure", label: "env.pressure" },
]);
const WEATHER_FORECAST_SERIES = Object.freeze([
  { key: "temperature", api: "temperature_c", env: "temperature_c", measured: "env3_temperature",
    source: "weather_forecast_temperature", cls: "env-forecast-temperature",
    label: "env.temperature", unit: "°C" },
  { key: "humidity", api: "humidity_pct", env: "humidity_pct", measured: "env3_humidity",
    source: "weather_forecast_humidity", cls: "env-forecast-humidity",
    label: "env.humidity", unit: "%" },
  { key: "pressure", api: "pressure_hpa", env: "pressure_hpa", measured: "env3_pressure",
    source: "weather_forecast_pressure", cls: "env-forecast-pressure",
    label: "env.pressure", unit: "hPa" },
]);

// A forecast is FUTURE data, not another sampled sensor. Provider timestamps place each point to
// the right of "now"; stale, incomplete or malformed responses disappear instead of being drawn as
// plausible measurements. Device NTP time, not the browser clock, is the shared axis anchor.
function weatherForecastView() {
  const w = S.status?.weather_forecast;
  const nowMs = Date.parse(S.status?.ntp?.time || "");
  if (!w?.configured || !w.available || !w.fresh || !Array.isArray(w.hourly) ||
      !Number.isFinite(nowMs)) return null;
  const now = nowMs / 1000;
  const points = [];
  for (const raw of w.hourly) {
    const number = (key) => typeof raw?.[key] === "number" ? raw[key] : Number.NaN;
    const time = number("time_unix_s");
    const temperature = number("temperature_c");
    const humidity = number("humidity_pct");
    const pressure = number("pressure_hpa");
    if (!Number.isFinite(time) || !Number.isFinite(temperature) || temperature < -90 || temperature > 70 ||
        !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
        !Number.isFinite(pressure) || pressure < 200 || pressure > 1200 ||
        time < now - 60 || time > now + 24 * 3600) continue;
    if (points.length && time <= points[points.length - 1].time) return null;
    points.push({ time, temperature, humidity, pressure });
  }
  return points.length >= 2 ? { now, points } : null;
}

// One timeline carrying one or more independent instruments. `b0` is the firmware's monotonic
// 5-minute bucket and therefore the authoritative alignment even before SNTP; wall time is the next
// choice, and tail alignment is the backwards-compatible fallback for an older response. A missing
// sample stays null in its own series — the other instrument may still draw at that instant.
function alignedHistoryView(id, raw) {
  raw = raw.filter((s) => s.h && !s.h.err && Array.isArray(s.h.v) && s.h.v.length);
  if (!raw.length) return null;

  const dt = raw[0].h.dt || 300;
  let start = 0, end = 0, mode = "tail";
  if (raw.every((s) => Number.isInteger(s.h.b0))) {
    mode = "bucket";
    start = Math.min(...raw.map((s) => s.h.b0));
    end = Math.max(...raw.map((s) => s.h.b0 + s.h.v.length - 1));
  } else if (raw.every((s) => typeof s.h.t0 === "number" && s.h.dt === dt)) {
    mode = "time";
    start = Math.min(...raw.map((s) => s.h.t0));
    end = Math.max(...raw.map((s) => s.h.t0 + (s.h.v.length - 1) * dt));
  } else {
    end = Math.max(...raw.map((s) => s.h.v.length)) - 1;
  }
  const n = mode === "tail" ? end + 1 : Math.round((end - start) / (mode === "time" ? dt : 1)) + 1;
  const toRuns = (flags) => {
    const out = [];
    for (let i = 0; i < flags.length; i++) {
      if (!flags[i]) continue;
      const from = i;
      while (i + 1 < flags.length && flags[i + 1]) i++;
      out.push([from, i - from + 1]);
    }
    return out;
  };
  const series = raw.map((s) => {
    const off = mode === "bucket" ? s.h.b0 - start
              : mode === "time" ? Math.round((s.h.t0 - start) / dt)
              : n - s.h.v.length;
    const v = Array(n).fill(null), heldFlags = Array(n).fill(false);
    for (let i = 0; i < s.h.v.length; i++) {
      v[off + i] = s.h.v[i];
      heldFlags[off + i] = histHeld(s.h, i);
    }
    return { source: s.source, name: s.name, unit: s.h.unit || "", v,
             held: toRuns(heldFlags), raw: s.h };
  });
  const primary = series.find((s) => s.source === "x10a") ||
                  series.find((s) => s.source === "env3") || series[0];
  const wall = raw.find((s) => typeof s.h.t0 === "number");
  const t0 = mode === "time" ? start
           : mode === "bucket" && wall ? wall.h.t0 - (wall.h.b0 - start) * dt
           : primary.raw.t0;
  const union = Array.from({ length: n }, (_, i) => {
    const found = series.find((s) => s.v[i] != null);
    return found ? found.v[i] : null;
  });
  // Some X10A rows spell their unit inside the label (notably flow) while HomeHub carries it as a
  // field. Prefer the primary source's unit, but do not throw away the paired source's honest unit
  // merely because X10A's field is empty.
  const sharedUnit = primary.unit || series.find((s) => s.unit)?.unit || "";
  return { id, dt, unit: sharedUnit, t0: typeof t0 === "number" ? t0 : null,
           b0: mode === "bucket" ? start : null,
           gen: series.map((s) => `${s.source}:${s.raw.gen || 0}`).join("/"),
           v: union, series };
}

function historyView(id, source = "") {
  if (id === ENV3_COMBINED_ID) {
    return alignedHistoryView(id, ENV3_COMBINED_SERIES.map((s) => ({
      source: s.id, name: t(s.label), h: S.hist.get(histCacheKey(s.id, "env3")),
    })));
  }
  const x10aName = id === "circulation_state" ? "MQTT" : "X10A";
  const view = alignedHistoryView(id, [
    { source: "x10a", name: x10aName, h: S.hist.get(id) },
    { source: "modbus", name: "HomeHub · Modbus", h: S.hist.get(histCacheKey(id, "modbus")) },
    { source: "env3", name: "ENV III", h: S.hist.get(histCacheKey(id, "env3")) },
  ].filter((s) => !source || s.source === source));
  return STATE_HIST[id] ? stateHistoryLiveView(view) : view;
}

// Categorical states need timelines, not numeric curves. Every valid state gets an explicit level,
// legend entry and coloured span; hatching is reserved for no answer. Exact phase intervals belong
// in the chart's hover/touch/keyboard tooltip instead of a second textual list below the same graph.
// Paired states
// draw one outlined lane per source, so colour means STATE while the outline/label means SOURCE.
// Durations are explicitly sampled RASTER time. Event-folded BSH, BUH and defrost buckets keep an ON
// observed during a five-minute bucket; they are not presented as second-accurate runtime.
const STATE_HIST = Object.freeze({
  tank_preheat_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.preheat_total", run: "hist.state_phase_run",
    none: "hist.preheat_none", active: "hist.preheat_active", inactive: "hist.preheat_inactive",
    aria: "hist.preheat_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.preheat_inactive" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "preheat-on", label: "hist.preheat_active" },
    ],
  },
  disinfection_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "modbus", total: "hist.disinfection_total", run: "hist.state_phase_run",
    none: "hist.disinfection_none", active: "hist.disinfection_active",
    inactive: "hist.disinfection_inactive", aria: "hist.disinfection_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.disinfection_inactive" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "disinfection-on", label: "hist.disinfection_active" },
    ],
  },
  defrost_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.defrost_total", run: "hist.state_phase_run",
    none: "hist.defrost_none", active: "hist.defrost_active", inactive: "hist.defrost_inactive",
    aria: "hist.defrost_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.defrost_inactive" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "defrost-on", label: "hist.defrost_active" },
    ],
  },
  quiet_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.quiet_total", run: "hist.state_phase_run",
    none: "hist.quiet_none", active: "hist.quiet_active", inactive: "hist.quiet_inactive",
    aria: "hist.quiet_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.quiet_inactive" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "quiet-on", label: "hist.quiet_active" },
    ],
  },
  smart_grid_mode: {
    classify: (v) => [0, 10, 20, 30].includes(v) ? v === 20 : null,
    primary: "modbus", total: "hist.boost_total", run: "hist.state_phase_run",
    compactTooltip: true,
    compactValueLabel: (v) => {
      const mode = v / 10;
      return Number.isInteger(mode) && mode >= 0 && mode <= 3 ? `sg.mode${mode}` : "";
    },
    none: "hist.boost_none", active: "hist.boost_active", inactive: "hist.boost_inactive",
    aria: "hist.boost_aria",
    // BOOST itself is mode 2, but a Boost inspector that paints modes 0, 1 and 3 as one identical
    // "off" bar hides whether the controller was free, inhibited or forced on. Paint the complete
    // four-state Smart-Grid enum and list every HomeHub phase; the Boost total above remains the
    // sampled amount of mode 2 so the permanent BOOST pill and its history keep the same contract.
    levels: [
      { match: (v) => [0, 10, 20, 30].includes(v) ? v === 0 : null,
        cls: "sg-free", label: "sg.mode0" },
      { match: (v) => [0, 10, 20, 30].includes(v) ? v === 10 : null,
        cls: "sg-forced-off", label: "sg.mode1" },
      { match: (v) => [0, 10, 20, 30].includes(v) ? v === 20 : null,
        cls: "sg-recommended", label: "sg.mode2" },
      { match: (v) => [0, 10, 20, 30].includes(v) ? v === 30 : null,
        cls: "sg-forced-on", label: "sg.mode3" },
    ],
  },
  bsh_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.heater_total", run: "hist.state_phase_run",
    compactTooltip: true,
    none: "hist.heater_none", active: "hist.heater_active", inactive: "hist.heater_inactive",
    aria: "hist.heater_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.heater_inactive" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "heater-on", label: "hist.heater_active" },
    ],
  },
  buh_state: {
    classify: (v) => [0, 10, 20].includes(v) ? v > 0 : null,
    primary: "x10a", total: "hist.buh_total", run: "hist.state_phase_run",
    compactTooltip: true,
    none: "hist.buh_none", active: "hist.buh_active", inactive: "hist.buh_inactive",
    aria: "hist.buh_aria",
    valueLabel: (v) => v === 0 ? "hist.buh_inactive"
      : v === 10 ? "hist.buh_step1" : v === 20 ? "hist.buh_step2" : "",
    compactValueLabel: (v) => v === 0 ? "hist.state_off"
      : v === 10 ? "hist.buh_step1" : v === 20 ? "hist.buh_step2" : "",
    levels: [
      { match: (v) => [0, 10, 20].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.buh_inactive" },
      { match: (v) => [0, 10, 20].includes(v) ? v === 10 : null,
        cls: "step1", label: "hist.buh_step1" },
      { match: (v) => [0, 10, 20].includes(v) ? v === 20 : null,
        cls: "step2", label: "hist.buh_step2" },
    ],
  },
  valve_dhw: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.valve_dhw_total", inactiveTotal: "hist.valve_space_total",
    run: "hist.state_phase_run", none: "hist.valve_none",
    active: "hist.valve_dhw", inactive: "hist.valve_space", aria: "hist.valve_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "valve-space", label: "hist.valve_space" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "valve-dhw", label: "hist.valve_dhw" },
    ],
  },
  circulation_state: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.circ_total", run: "hist.state_phase_run",
    none: "hist.circ_none", active: "hist.circ_on", inactive: "hist.circ_off",
    missing: "hist.circ_unavailable", gaps: "hist.circ_gaps", aria: "hist.circ_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.circ_off" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "circulation-on", label: "hist.circ_on" },
    ],
  },
  valve_heat: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.valve2_on_total", inactiveTotal: "hist.valve2_off_total",
    run: "hist.state_phase_run", none: "hist.valve2_none",
    active: "hist.valve2_on", inactive: "hist.valve2_off", aria: "hist.valve2_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.valve2_off" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "valve2-on", label: "hist.valve2_on" },
    ],
  },
  water_flow_switch: {
    classify: (v) => [0, 10].includes(v) ? v === 10 : null,
    primary: "x10a", total: "hist.flow_switch_total", run: "hist.state_phase_run",
    none: "hist.flow_switch_none", active: "hist.flow_switch_on", inactive: "hist.flow_switch_off",
    aria: "hist.flow_switch_aria",
    levels: [
      { match: (v) => [0, 10].includes(v) ? v === 0 : null,
        cls: "state-off", label: "hist.flow_switch_off" },
      { match: (v) => [0, 10].includes(v) ? v === 10 : null,
        cls: "flow-switch-on", label: "hist.flow_switch_on" },
    ],
  },
});

// The rings contain COMPLETED five-minute buckets. Their right edge used to be labelled "now"
// anyway, so a live state change could update the inspector headline immediately while the timeline
// kept painting the preceding bucket all the way to that same edge. Smart Grid made the contradiction
// especially obvious: "Recommended on" above a grey Free-running tail.
//
// Append one DISPLAY-ONLY current sample to every categorical lane. It is deliberately kept outside
// `recordedN`: totals remain sampled raster time and never gain an invented full five minutes merely
// because one live observation exists. The current cap uses the same structural concepts/semantics as
// /values; an absent or disconnected source becomes a hatched current cap, never a borrowed state.
const currentBinaryTenths = (row) => {
  if (!row || row.value == null || row.binary !== true) return null;
  const raw = String(row.value).trim();
  return raw === "1" ? 10 : raw === "0" ? 0 : null;
};

function stateHistoryCurrent(id, source) {
  if (source === "modbus") {
    if (!Array.isArray(S._modbus)) return { present: false, value: null };
    if (id === "smart_grid_mode") {
      const row = S._modbus.find((r) => r && r.off === 56 && r.enum === "smart_grid_mode");
      if (!row || row.value == null) return { present: true, value: null };
      const raw = String(row.value).trim();
      const mode = /^\d$/.test(raw) ? Number(raw) : -1;
      return { present: true, value: mode >= 0 && mode <= 3 ? mode * 10 : null };
    }
    const row = S._modbus.find((r) => r && (r.history === id || r.concept === id));
    return { present: true, value: currentBinaryTenths(row) };
  }

  if (source !== "x10a") return { present: false, value: null };
  if (id === "circulation_state") {
    const c = S.status?.circulation_source;
    if (!c) return { present: false, value: null };
    const value = c.configured && c.has_value && c.fresh
      ? c.state === "on" ? 10 : c.state === "off" ? 0 : null : null;
    return { present: true, value };
  }
  if (!Array.isArray(S._values)) return { present: false, value: null };
  if (S.status?.hp?.connected === false) return { present: true, value: null };
  if (id === "smart_grid_mode") {
    const contact = (semantic) => currentBinaryTenths(
      S._values.find((r) => r && r.binary_semantic === semantic));
    const c1 = contact("smart_grid_contact_1"), c2 = contact("smart_grid_contact_2");
    const value = c1 == null || c2 == null ? null
      : c1 === 10 ? (c2 === 10 ? 30 : 20) : (c2 === 10 ? 10 : 0);
    return { present: true, value };
  }
  if (id === "buh_state") {
    const step = (concept) => currentBinaryTenths(
      S._values.find((r) => r && r.concept === concept));
    const step1 = step("buh_step1"), step2 = step("buh_step2");
    const value = step1 == null || step2 == null ? null : step2 === 10 ? 20 : step1;
    return { present: true, value };
  }
  const row = S._values.find((r) => r && r.concept === id);
  return { present: true, value: currentBinaryTenths(row) };
}

function stateHistoryLiveView(view) {
  if (!view) return view;
  const current = view.series.map((s) => stateHistoryCurrent(view.id, s.source));
  if (!current.some((sample) => sample.present)) return view;
  const recordedN = view.v.length;
  const series = view.series.map((s, i) => ({
    ...s, v: [...s.v, current[i].present ? current[i].value : null],
  }));
  const v = series.map((s) => s.v[recordedN]).find((value) => value != null) ?? null;
  const liveSig = current.map((sample, i) =>
    `${view.series[i].source}:${sample.present ? sample.value ?? "gap" : "absent"}`).join("/");
  return { ...view, recordedN, liveIndex: recordedN, v: [...view.v, v], series,
           gen: `${view.gen}/live:${liveSig}` };
}

function stateRuns(series, wanted, classify) {
  const out = [];
  for (let i = 0; i < series.v.length; i++) {
    if (classify(series.v[i]) !== wanted) continue;
    const from = i;
    while (i + 1 < series.v.length && classify(series.v[i + 1]) === wanted) i++;
    out.push([from, i - from + 1]);
  }
  return out;
}

// `bound` renders a LOWER BOUND rather than a measurement, and the difference is not cosmetic.
// Rounding to nearest is right for a phase duration off the chart — that is a measured span and the
// nearest minute is the closest true statement about it. It is WRONG for a bound: a run measured at
// 1710 s rounds to 29 min, and "at least 29 min" asserts 1740 s, i.e. thirty seconds the board never
// observed. Every value in the upper half of a minute does that. A bound floors, so the printed
// number is the tightest whole unit that is still TRUE.
function histDuration(seconds, bound = false) {
  const exact = Math.max(0, seconds / 60);
  const min = bound ? Math.floor(exact) : Math.round(exact);
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? t("hist.duration_hm", h, m)
       : h ? t("hist.duration_h", h) : t("hist.duration_min", m);
}

// The same formatter with a SECONDS tier under a minute. The trend charts never need one — their
// raster is five minutes — but a state age does: a flag that switched twenty seconds ago is the
// case a reader is most likely to be looking at, and "0 min" is the one answer that makes a live
// number look broken.
function dwellDuration(seconds, bound = false) {
  const s = Math.max(0, bound ? Math.floor(seconds) : Math.round(seconds));
  return s < 60 ? t("hist.duration_sec", s) : histDuration(s, bound);
}

// HOW LONG THIS ROW HAS READ WHAT IT READS — the first line of a switched row's explainer.
//
// The device decides both the number and what may be claimed about it (logic/state_dwell.hpp); this
// only renders. Three fields arrive and all three matter:
//   dwell_s        seconds the current state has stood, as far as the board could tell
//   dwell_min      the transition was never witnessed, so the true age is at LEAST that. Rendered
//                  as "at least", never dropped: a run this board joined in progress is a weaker
//                  claim than one it watched arrive, and printing them identically is the #35-#39
//                  shape — a true number carrying more authority than its evidence.
//   dwell_blind_s  how much of the run the bus did not answer for. A flag can pulse and return
//                  inside a gap, so a run spanning one is not a run that was watched.
// An ABSENT dwell_s is the device saying it has nothing to claim (silent bus, a row seen too long
// ago), and absence renders as nothing at all — never as "0 s", which would read as "just changed".
//
// The blind caveat is shown whenever there is ANY, and it took two wrong justifications to get here.
// The first claimed sub-minute blind time is "the reboot allowance or one missed sweep" — false,
// since blind_s accumulates over the whole run and a long one reaches a minute a second at a time.
// The second claimed dwellDuration would render it as "0 min" — also false: that formatter has a
// seconds tier precisely so small numbers read correctly, so the suppression was silently dropping
// up to 59 s of unobserved time out of a sentence otherwise presented as exact. Two failed defences
// of one threshold is the answer: there is no defensible number, so there is no threshold. A run
// carrying five unobserved seconds says so.
function dwellNoteHtml(v, stateText) {
  // No value, no age. The firmware already withholds the age for a row it could not read, but the
  // browser blanks a row for reasons of its OWN too (a dead bus, a held-over page), and an age has
  // to be withheld by whichever side decided the reading is not stateable — otherwise the panel
  // prints "— for 3 h 20 min", an age for a reading the row above just refused.
  if (!v || v.dwell_s == null || v.value == null || !stateText || stateText === "—") return "";
  // The STATE WORD is the subject and carries the panel's emphasis token; everything after it — the
  // age and the condition on it — is plain body text. That split is the sentence's own structure:
  // "OFF" is what the row reads, the rest is when and how well that was seen, and it has to stay
  // one uninterrupted qualifier so the eye cannot take the number and skip what bounds it.
  //
  // `.vdesc-n` rather than a new class or a bare <b>: it is already the panel's lead-in-in-stronger-
  // ink token (the "Normal:" note uses it), so this needs no CSS at all and cannot drift from it.
  //
  // The state is composed OUTSIDE t(), which is why the keys carry only the predicate ("seit ${d}",
  // "≥ ${d}"). Markup inside a translated string is the thing descNoteHtml avoids, and it would
  // force every future language to keep the subject first; here the caller owns the subject and the
  // dictionary owns the sentence about it.
  const tail = v.dwell_min
    ? t("val.since_min", dwellDuration(v.dwell_s, true))
    : t("val.since", dwellDuration(v.dwell_s));
  const blind = Number(v.dwell_blind_s) || 0;
  // The separator stays a middle dot rather than a comma or a dash — it joins two clauses without
  // implying either subordination or a range, and a dash beside a "≥" would read as one.
  return descParaHtml(`<span class="vdesc-n">${esc(stateText)}</span> ` + esc(tail) +
    (blind > 0 ? esc(" · " + t("val.since_gap", dwellDuration(blind))) : ""));
}
function stateRunWhen(view, from, count) {
  if (view.t0 != null) {
    const clock = (i) => new Date((view.t0 + i * view.dt) * 1000)
      .toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
    return `${clock(from)}–${clock(from + count)}`;
  }
  const n = view.recordedN ?? view.v.length;
  const old = ((n - from) * view.dt) / 3600;
  const recent = ((n - from - count) * view.dt) / 3600;
  return t("hist.boost_ago_range", old.toFixed(1), Math.max(0, recent).toFixed(1));
}
// The complete contiguous phase containing sample `i`. The same helper serves categorical states
// and the HomeHub outdoor-register plateau note: both are answers about an INTERVAL, not just the
// one bucket under the cursor. `key` decides what counts as the same phase.
function sampleRunAt(values, i, key = (v) => v) {
  const wanted = key(values[i]);
  let from = i, to = i;
  while (from > 0 && key(values[from - 1]) === wanted) from--;
  while (to + 1 < values.length && key(values[to + 1]) === wanted) to++;
  return [from, to - from + 1];
}
function stateHistHtml(id, name, view, wrap, cfg) {
  const n = view.v.length;
  const recordedN = view.recordedN ?? n;
  const spanH = Math.max(1, Math.round((recordedN * view.dt) / 3600));
  const full = recordedN * view.dt >= 23.5 * 3600;
  // Totals retain the concept's authoritative source. The independent lanes remain diagnostic
  // witnesses and must not silently pool their durations into one apparently exact number.
  const primary = view.series.find((s) => s.source === cfg.primary) || view.series[0];
  const recordedPrimary = { ...primary, v: primary.v.slice(0, recordedN) };
  const active = stateRuns(recordedPrimary, true, cfg.classify);
  const total = active.reduce((sum, r) => sum + r[1] * view.dt, 0);
  const inactive = stateRuns(recordedPrimary, false, cfg.classify);
  const inactiveSeconds = inactive.reduce((sum, r) => sum + r[1] * view.dt, 0);
  const pct = (i) => ((i / n) * 100).toFixed(3);
  const current = view.liveIndex == null ? ""
    : `<span class="vhist-state-current" style="left:${pct(view.liveIndex)}%;width:${pct(1)}%"></span>`;
  // historyView() orders X10A before Modbus. Render that order directly so neither source can
  // repaint, fill in or conceal the other's status. Missing intervals stay hatched in their own
  // lane, and disagreements are visible as different colours at the same point in time.
  const tracks = view.series.map((s) => {
    const levels = cfg.levels || [{ match: cfg.classify, cls: "" }];
    const on = levels.flatMap((level) => stateRuns(s, true, level.match).map(([from, count]) =>
      `<span class="vhist-state-on${level.cls ? " " + level.cls : ""}" ` +
      `style="left:${pct(from)}%;width:${pct(count)}%"></span>`
    )).join("");
    const missing = stateRuns(s, null, cfg.classify).map(([from, count]) =>
      `<span class="vhist-state-gap" style="left:${pct(from)}%;width:${pct(count)}%"></span>`).join("");
    const sourceLabel = s.source === "modbus" ? "Modbus" : s.name;
    return `<div class="vhist-state-lane">` +
      `<span class="vhist-state-lane-label${s.source === "modbus" ? " mb" : ""}">${sourceLabel}</span>` +
      `<div class="vhist-state-track ${s.source}" aria-hidden="true">${on}${missing}${current}</div>` +
    `</div>`;
  }).join("");
  const gaps = stateRuns(recordedPrimary, null, cfg.classify).length;
  const hasMissing = view.series.some((s) => stateRuns(s, null, cfg.classify).length > 0);
  const levelLegend = cfg.levels
    ? `<div class="vhist-legend vhist-level-legend">${cfg.levels.map((level) =>
        `<span class="vhist-level ${level.cls}"><i></i>${esc(t(level.label))}</span>`).join("")}` +
        (hasMissing
          ? `<span class="vhist-level state-unavailable"><i></i>${esc(t(cfg.missing || "hist.nm"))}</span>` : "") +
      `</div>`
    : "";

  const pi = histPinIndex(id, view);
  const sourceAttr = view.series.length === 1 ? ` data-source="${esc(view.series[0].source)}"` : "";
  let pinTip = "", pinCross = "";
  if (pi >= 0) {
    const frac = scrubFrac(pi, n);
    const px = (frac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    pinTip = `<div class="vhist-tip vhist-pinned ${tipSideClass(frac)} mono num" ` +
      `style="--tip-p:${px}">${esc(scrubText(view, pi))}</div>`;
  }
  const totalText = t(cfg.total, histDuration(total)) + (cfg.inactiveTotal
    ? ` · ${t(cfg.inactiveTotal, histDuration(inactiveSeconds))}` : "");
  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
      `<span class="vhist-range mono num">${esc(totalText)}</span></div>` + levelLegend +
    `<div class="vhist-graph vhist-state-graph">` +
      `<div class="vhist-tip vhist-live vhist-tip-right mono num" hidden></div>` + pinTip +
      `<div class="vhist-plot vhist-state-plot" data-hist="${esc(id)}"${sourceAttr} data-n="${n}" tabindex="0" role="img"` +
        ` aria-label="${esc(t(cfg.aria, name || id, totalText))}">` + tracks + pinCross +
        `<span class="vhist-cross vhist-live" hidden></span>` +
      `</div>` +
    `</div>` +
    `<div class="vhist-axis"><span>${esc(t("hist.ago", spanH))}</span>` +
      (gaps ? `<span class="vhist-gap">${esc(t(cfg.gaps || "hist.gaps", gaps))}</span>` : "") +
      `<span>${esc(t("hist.now"))}</span></div>`
  , "vhist-state");
}

// One historied row's trend, as the markup appended under its explainer text. Every state is a
// SENTENCE rather than an empty box: not fetched, no readings yet, fetch failed. `null` samples are
// GAPS (a timed-out register, or a reading reading_plausible() refused) and must break the line —
// interpolating across them would draw a measurement that was never taken, which is exactly the
// failure the blanked pills elsewhere in this UI exist to prevent.
function histHtml(id, unit, name, source = "") {
  const offeredX = (!source || source === "x10a") && hasHist(id);
  const offeredM = (!source || source === "modbus") && hasModbusHist(id);
  const offeredE = (!source || source === "env3") && hasEnv3Hist(id);
  if (!offeredX && !offeredM && !offeredE) return "";
  const hx = offeredX ? S.hist.get(id) : null;
  const hm = offeredM ? S.hist.get(histCacheKey(id, "modbus")) : null;
  const he = offeredE ? S.hist.get(histCacheKey(id, "env3")) : null;
  const wrap = (body, cls) => `<div class="vhist${cls ? " " + cls : ""}">${body}</div>`;
  const view = historyView(id, source);
  if (!view && ((offeredX && !hx) || (offeredM && !hm) || (offeredE && !he)))
    return wrap(`<div class="vhist-note">${esc(t("hist.loading"))}</div>`, "vhist-flat");
  if (!view && [hx, hm, he].filter(Boolean).every((h) => h.err))
    return wrap(`<div class="vhist-note">${esc(t("hist.err"))}</div>`, "vhist-flat");
  if (!view) {
    const D = DERIVED[id];
    return wrap(`<div class="vhist-note">${esc(D && D.none ? tx(D.none) : t("hist.none"))}</div>`, "vhist-flat");
  }

  const allPts = view.series.flatMap((s) => s.v.map((x) => x == null ? null : x / 10));
  const real = allPts.filter((x) => x != null);
  // "No readings yet" is the RIGHT sentence for a ring the device has not filled, and the WRONG one
  // for a derived figure that is being withheld on purpose — the COP on a CT-clamp install has a
  // full set of inputs and still draws nothing, so the generic note would call a deliberate refusal
  // an empty buffer, one line under a pill that is showing the very number. A derived series may
  // therefore name its own empty case.
  if (!real.length) {
    const D = DERIVED[id];
    return wrap(`<div class="vhist-note">${esc(D && D.none ? tx(D.none) : t("hist.none"))}</div>`, "vhist-flat");
  }

  if (STATE_HIST[id]) return stateHistHtml(id, name, view, wrap, STATE_HIST[id]);

  const n = view.v.length;
  const spanH = Math.max(1, Math.round((n * view.dt) / 3600));
  // The axis states the common boot-aligned span the device actually holds. Before 24 h uptime it
  // grows with the board; after that every source remains a rolling day. A source that started or
  // changed later contributes explicit null gaps, never a shorter axis or fabricated flat data.
  const full  = n * view.dt >= 23.5 * 3600;
  const { lo, hi, X, Y } = histScale(allPts, n);

  // Contiguous runs only: each becomes one light area with its darker upper-edge line, so every
  // numeric trend uses the same visual grammar while a gap remains a real gap. Multiple sources use
  // the same geometry and are made more transparent by the wrapper class below. A run of ONE sample
  // still gets a dot because there is no interval whose area or upper edge could honestly be drawn.
  let line = "", area = "", dots = "", gaps = 0, held = 0;
  for (const s of view.series) {
    const pts = s.v.map((x) => x == null ? null : x / 10);
    const sourceCls = s.source === "modbus" ? " mb" : "";
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) {
        dots += `<circle class="vhist-pt${sourceCls}" cx="${X(run[0]).toFixed(1)}" cy="${Y(pts[run[0]]).toFixed(1)}" r="1.6"/>`;
      } else {
        const d = run.map((i, k) => `${k ? "L" : "M"}${X(i).toFixed(1)} ${Y(pts[i]).toFixed(1)}`).join("");
        line += `<path class="vhist-line${sourceCls}" d="${d}" vector-effect="non-scaling-stroke"/>`;
        area += `<path class="vhist-area${sourceCls}" d="${d}L${X(run[run.length - 1]).toFixed(1)} ${HIST_H}L${X(run[0]).toFixed(1)} ${HIST_H}Z"/>`;
      }
      run = [];
    };
    let prevGap = false;
    for (let i = 0; i < n; i++) {
      if (pts[i] == null) {
        // The compact axis summary remains about X10A: held-over is an X10A fact. Modbus dropouts
        // are visible as breaks in its petrol line without borrowing X10A's reason vocabulary.
        if (s.source === "x10a" || s.source === "env3") {
          if (histHeld(s, i)) { held++; prevGap = false; }
          else { if (!prevGap) gaps++; prevGap = true; }
        }
        flush();
      } else { prevGap = false; run.push(i); }
    }
    flush();
  }
  // Absence is counted in TWO buckets, because they mean different things and the axis says which:
  // a HELD sample is the outdoor unit resting (nothing failed — see histHeld), a GAP is a register
  // that didn't answer or a value reading_plausible() refused. Blaming an idle compressor on the bus
  // is the same class of wrong as drawing its last-run value as live.
  // `gaps` counts contiguous RUNS (one dropout is one gap, however many samples it spans); `held`
  // counts SAMPLES, because what matters there is how much of the day the unit spent asleep, not
  // how many naps it took. prevGap tracks run boundaries so a held stretch between two dropouts
  // doesn't merge them into one.
  // The "now" marker is an HTML element, not an SVG circle: the SVG is stretched non-uniformly, so
  // a circle in it would render as an ellipse. Percentage positioning maps onto the same 0..HIST_H
  // scale exactly, and stays right whatever width the panel ends up at.
  const nowDots = view.series.map((s) => {
    const last = s.v[n - 1];
    return last == null ? "" : `<span class="vhist-now${s.source === "modbus" ? " mb" : ""}"` +
      ` style="top:${((Y(last / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
  }).join("");
  const shownUnit = view.unit || unit;
  const u = shownUnit ? ` ${shownUnit}` : "";
  const rng = `${lo.toFixed(1)} – ${hi.toFixed(1)}${u}`;

  // The scrub layer: a translucent tooltip OVER the plot (ApexCharts-style), plus the crosshair and
  // marker dot inside it. The bubble follows the cursor horizontally but never changes the plot's
  // vertical position. All three start hidden and are moved by scrubMove() writing styles directly
  // — never by re-rendering this HTML, which would fight the pointer.
  // `data-hist` is what the delegated pointer handlers match on, and it carries the sample count so
  // the geometry the handler needs comes from the same render that drew the path.
  // A PINNED readout is emitted as part of the markup, not written onto the DOM afterwards — that is
  // the whole reason it survives the ~1×/s rebuild that made the old hold-to-read behaviour necessary.
  // Its instant is re-resolved here on every render, so the pin follows its measurement as the ring
  // rolls and disappears once that measurement has left the day.
  const pi = histPinIndex(id, view);
  const sourceAttr = view.series.length === 1 ? ` data-source="${esc(view.series[0].source)}"` : "";
  let pinTip = "", pinCross = "", pinMarks = "";
  if (pi >= 0) {
    const frac = scrubFrac(pi, n);
    const px = (frac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    pinMarks = view.series.map((s) => s.v[pi] == null ? ""
      : `<span class="vhist-mark vhist-pinned${s.source === "modbus" ? " mb" : ""}"` +
        ` style="left:${px}%;top:${((Y(s.v[pi] / 10) / HIST_H) * 100).toFixed(2)}%"></span>`).join("");
    // Position and SIDE are derived from the sample alone, so a pinned bubble can be placed before
    // layout: left half opens to the right, right half opens to the left. The selected crosshair is
    // therefore never hidden behind its own readout.
    pinTip = `<div class="vhist-tip vhist-pinned ${tipSideClass(frac)} mono num" ` +
      `style="--tip-p:${px}">${esc(scrubText(view, pi))}</div>`;
  }
  const legend = view.series.length > 1 || view.series[0].source === "modbus"
    ? `<div class="vhist-legend">${view.series.map((s) =>
        `<span class="vhist-source${s.source === "modbus" ? " mb" : ""}"><i></i>${esc(s.name)}</span>`).join("")}</div>`
    : "";
  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
    `<span class="vhist-range mono num">${esc(rng)}</span></div>` + legend +
    `<div class="vhist-graph">` +
      `<div class="vhist-tip vhist-live vhist-tip-right mono num" hidden></div>` + pinTip +
      `<div class="vhist-plot" data-hist="${esc(id)}"${sourceAttr} data-n="${n}" tabindex="0" role="img"` +
        ` aria-label="${esc(t(pi >= 0 ? "hist.aria_pinned" : "hist.aria", name || id, pi >= 0 ? scrubText(view, pi) : ""))}">` +
        `<svg viewBox="0 0 ${HIST_W} ${HIST_H}" preserveAspectRatio="none" aria-hidden="true">${area}${line}${dots}</svg>` +
        nowDots + pinCross + pinMarks +
        `<span class="vhist-cross vhist-live" hidden></span>` +
        view.series.map((s) => `<span class="vhist-mark vhist-live${s.source === "modbus" ? " mb" : ""}" data-source="${s.source}" hidden></span>`).join("") +
      `</div>` +
    `</div>` +
    `<div class="vhist-axis"><span>${esc(t("hist.ago", spanH))}</span>` +
      // Idle time is reported ahead of dropouts: on an outdoor-air trend it is normally the larger
      // share of the day and the one that explains the shape of the chart.
      (held ? `<span class="vhist-idle">${esc(t("hist.heldnote", ((held * view.dt) / 3600).toFixed(1)))}</span>` : "") +
      (gaps ? `<span class="vhist-gap">${esc(t("hist.gaps", gaps))}</span>` : "") +
      `<span>${esc(t("hist.now"))}</span></div>`,
    view.series.length > 1 ? "vhist-multi" : ""
  );
}

function env3SeriesClass(source) {
  return source === "env3_temperature" ? "env-temperature"
       : source === "env3_humidity" ? "env-humidity" : "env-pressure";
}

// ENV III has three different units, so putting the raw values on one Y axis would flatten
// temperature and humidity underneath pressure. One full-width chart therefore gives every line
// its own honest local range while sharing the exact same time raster. The legend explicitly says
// so, and the cursor always reports the three raw measurements together at the selected instant.
function env3HistHtml() {
  const offered = ENV3_COMBINED_SERIES.filter((s) => hasEnv3Hist(s.id));
  if (!offered.length) return "";
  const cached = offered.map((s) => S.hist.get(histCacheKey(s.id, "env3")));
  const wrap = (body, cls = "") => `<div class="vhist vhist-env3${cls ? " " + cls : ""}">${body}</div>`;
  const view = historyView(ENV3_COMBINED_ID);
  if (!view && cached.some((h) => !h))
    return wrap(`<div class="vhist-note">${esc(t("hist.loading"))}</div>`, "vhist-flat");
  if (!view && cached.filter(Boolean).every((h) => h.err))
    return wrap(`<div class="vhist-note">${esc(t("hist.err"))}</div>`, "vhist-flat");
  if (!view) return wrap(`<div class="vhist-note">${esc(t("hist.none"))}</div>`, "vhist-flat");

  const plotted = view.series.filter((s) => s.v.some((v) => v != null));
  if (!plotted.length)
    return wrap(`<div class="vhist-note">${esc(t("hist.none"))}</div>`, "vhist-flat");

  const n = view.v.length;
  const spanH = Math.max(1, Math.round((n * view.dt) / 3600));
  const full = n * view.dt >= 23.5 * 3600;
  const forecast = weatherForecastView();
  const futureEnd = forecast?.points.at(-1)?.time;
  const measuredStart = Number.isFinite(view.t0) ? view.t0 : null;
  const measuredEnd = measuredStart == null ? null : measuredStart + (n - 1) * view.dt;
  const timedForecast = forecast && measuredStart != null && forecast.now >= measuredStart &&
    Number.isFinite(futureEnd) && futureEnd > forecast.now;
  const domainEnd = timedForecast ? futureEnd : measuredEnd;
  const domainSpan = timedForecast ? domainEnd - measuredStart : 0;
  const timeX = (unix) => ((unix - measuredStart) / domainSpan) * HIST_W;
  const sampleX = (i) => timedForecast ? timeX(measuredStart + i * view.dt)
                                        : histScale(view.v, n).X(i);
  const measuredEndFrac = timedForecast
    ? Math.max(0, Math.min(1, timeX(measuredEnd) / HIST_W)) : 1;
  const nowFrac = timedForecast
    ? Math.max(0, Math.min(1, timeX(forecast.now) / HIST_W)) : 1;
  const forecastSpecForMeasured = (source) =>
    WEATHER_FORECAST_SERIES.find((spec) => spec.measured === source);
  const scalePoints = (s) => {
    const measured = s.v.map((v) => v == null ? null : v / 10);
    const spec = timedForecast ? forecastSpecForMeasured(s.source) : null;
    return spec ? [...measured, ...forecast.points.map((p) => p[spec.key])] : measured;
  };
  let areas = "", lines = "", dots = "", nowDots = "";
  for (const s of plotted) {
    const pts = s.v.map((v) => v == null ? null : v / 10);
    const { Y } = histScale(scalePoints(s), n);
    const X = sampleX;
    const cls = env3SeriesClass(s.source);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      if (run.length === 1) {
        dots += `<circle class="vhist-pt ${cls}" cx="${X(run[0]).toFixed(1)}" ` +
          `cy="${Y(pts[run[0]]).toFixed(1)}" r="1.8"/>`;
      } else {
        const d = run.map((i, k) => `${k ? "L" : "M"}${X(i).toFixed(1)} ${Y(pts[i]).toFixed(1)}`).join("");
        const first = run[0], last = run.at(-1);
        areas += `<path class="vhist-area ${cls}" d="${d}L${X(last).toFixed(1)} ${HIST_H}` +
          `L${X(first).toFixed(1)} ${HIST_H}Z"/>`;
        lines += `<path class="vhist-line ${cls}" d="${d}" vector-effect="non-scaling-stroke"/>`;
      }
      run = [];
    };
    for (let i = 0; i < n; i++) {
      if (pts[i] == null) flush(); else run.push(i);
    }
    flush();
    const last = s.v[n - 1];
    if (last != null) {
      nowDots += `<span class="vhist-now ${cls}${timedForecast ? " timed" : ""}" ` +
        `style="${timedForecast ? `left:${(measuredEndFrac * 100).toFixed(3)}%;right:auto;` : ""}` +
        `top:${((Y(last / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
    }
  }

  // Forecasts use the same three climate hues and scales as ENV III, but lower opacity. The
  // future itself has no coloured background: only the quiet forecast areas and "now" divider
  // identify it. Hourly point markers duplicated the tooltip's job and made the compact plot noisy.
  let forecastAreas = "", forecastLines = "";
  let futureH = 0;
  if (timedForecast) {
    for (const spec of WEATHER_FORECAST_SERIES) {
      const measured = plotted.find((s) => s.source === spec.measured);
      const rawCurrent = S.status?.env3?.[spec.env];
      const current = typeof rawCurrent === "number" ? rawCurrent : Number.NaN;
      const points = [];
      if (S.status?.env3?.fresh && Number.isFinite(current))
        points.push({ time: forecast.now, value: current, anchor: true });
      for (const p of forecast.points) {
        if (p.time > forecast.now) points.push({ time: p.time, value: p[spec.key], anchor: false });
      }
      if (points.length < 2) continue;
      const past = measured ? measured.v.map((v) => v == null ? null : v / 10) : [];
      const { Y } = histScale([...past, ...points.map((p) => p.value)], n);
      const d = points.map((p, i) =>
        `${i ? "L" : "M"}${timeX(p.time).toFixed(1)} ${Y(p.value).toFixed(1)}`).join("");
      forecastAreas += `<path class="vhist-area ${spec.cls}" ` +
        `d="${d}L${timeX(points.at(-1).time).toFixed(1)} ${HIST_H}` +
        `L${timeX(points[0].time).toFixed(1)} ${HIST_H}Z"/>`;
      forecastLines += `<path class="vhist-line ${spec.cls}" d="${d}" ` +
        `vector-effect="non-scaling-stroke"/>`;
    }
    if (forecastAreas) futureH = Math.max(1, Math.round((futureEnd - forecast.now) / 3600));
  }

  let gaps = 0, inGap = false;
  for (const v of view.v) {
    if (v == null) { if (!inGap) gaps++; inGap = true; } else inGap = false;
  }
  // Units belong to readings, not series names. They stay in every measured/forecast tooltip, so
  // repeating them in this always-visible legend adds ink without adding meaning.
  const legend = `<div class="vhist-legend">${plotted.map((s) =>
    `<span class="vhist-source ${env3SeriesClass(s.source)}"><i></i>${esc(s.name)}</span>`
  ).join("")}</div>`;

  const pi = histPinIndex(ENV3_COMBINED_ID, view);
  let pinTip = "", pinCross = "", pinMarks = "";
  if (pi >= 0) {
    const forecastPin = pi >= n ? forecastScrubView(view) : null;
    const point = forecastPin?.points[pi - n];
    const frac = point ? forecastPin.xFrac(point.time) : scrubFrac(pi, n) * measuredEndFrac;
    const px = (frac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    pinMarks = point
      ? WEATHER_FORECAST_SERIES.map((spec) =>
          `<span class="vhist-mark vhist-pinned ${spec.cls}" ` +
          `style="left:${px}%;top:${((forecastPin.Y(spec.key, point[spec.key]) / HIST_H) * 100).toFixed(2)}%"></span>`
        ).join("")
      : plotted.map((s) => {
          if (s.v[pi] == null) return "";
          const { Y } = histScale(scalePoints(s), n);
          return `<span class="vhist-mark vhist-pinned ${env3SeriesClass(s.source)}" ` +
            `style="left:${px}%;top:${((Y(s.v[pi] / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
        }).join("");
    pinTip = `<div class="vhist-tip vhist-pinned ${tipSideClass(frac)} mono num" style="--tip-p:${px}">` +
      `${env3ScrubHtml(view, pi)}</div>`;
  }

  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
      `<span class="vhist-range">${esc(t("env.history_scales"))}</span></div>` + legend +
    `<div class="vhist-graph">` +
      `<div class="vhist-tip vhist-live vhist-tip-right mono num" hidden></div>` + pinTip +
      `<div class="vhist-plot" data-hist="${ENV3_COMBINED_ID}" data-n="${n}" ` +
        `data-measured-p="${(measuredEndFrac * 100).toFixed(3)}" tabindex="0" role="img" ` +
        `aria-label="${esc(t(pi >= 0 ? "hist.aria_pinned" : "hist.aria", t("env.history_title"),
          pi >= 0 ? scrubText(view, pi) : ""))}">` +
        `<svg viewBox="0 0 ${HIST_W} ${HIST_H}" preserveAspectRatio="none" aria-hidden="true">` +
          `${areas}${forecastAreas}${lines}${forecastLines}${dots}` +
          (forecastAreas ? `<line class="vhist-forecast-divider" x1="${timeX(forecast.now).toFixed(1)}" y1="0" ` +
            `x2="${timeX(forecast.now).toFixed(1)}" y2="${HIST_H}" vector-effect="non-scaling-stroke"/>` : "") +
          `</svg>${nowDots}${pinCross}${pinMarks}` +
        `<span class="vhist-cross vhist-live" hidden></span>` +
        plotted.map((s) => `<span class="vhist-mark vhist-live ${env3SeriesClass(s.source)}" ` +
          `data-source="${s.source}" hidden></span>`).join("") +
        (forecastAreas ? WEATHER_FORECAST_SERIES.map((spec) =>
          `<span class="vhist-mark vhist-live ${spec.cls}" data-source="${spec.source}" hidden></span>`
        ).join("") : "") +
      `</div>` +
    `</div>` +
    (forecastAreas
      ? `<div class="vhist-axis vhist-axis-future" style="--now-p:${(nowFrac * 100).toFixed(3)}">` +
          `<span>${esc(t("hist.ago", spanH))}</span>` +
          `<span class="vhist-axis-now">${esc(t("hist.now"))}</span>` +
          `<span>${esc(t("hist.in_hours", futureH))}</span></div>`
      : `<div class="vhist-axis"><span>${esc(t("hist.ago", spanH))}</span>` +
          (gaps ? `<span class="vhist-gap">${esc(t("hist.gaps", gaps))}</span>` : "") +
          `<span>${esc(t("hist.now"))}</span></div>`),
    "vhist-multi"
  );
}

// ── Scrubbing a trend (hover with a mouse, drag with a finger — one code path) ─────────────────
// Pointer Events rather than mouse+touch pairs: one set of handlers covers mouse, touch and pen,
// and pointer capture keeps a drag tracking after it leaves the plot. The plot is `touch-action:
// pan-y` (CSS), which is the load-bearing half on a phone — it hands VERTICAL gestures back to the
// page so the user can still scroll past the chart, while horizontal movement becomes a scrub.
// Claiming both axes would trap the page scroll inside a 72 px box.

// Where a sample sits, as a fraction 0..1 of the plot width. Mirrors X() in histHtml — a lone
// sample is drawn at the right edge, which is also where "now" is.
function scrubFrac(i, n) { return n <= 1 ? 1 : i / (n - 1); }

// The outdoor-climate plot has two rasters on one time axis: five-minute measurements up to now,
// then provider-timestamped Open-Meteo hours. One geometry helper keeps pointer, touch, keyboard and
// pinned tooltips on the same forecast point the SVG drew.
function forecastScrubView(h) {
  if (!h || h.id !== ENV3_COMBINED_ID || !h.v.length || !Number.isFinite(h.t0)) return null;
  const forecast = weatherForecastView();
  const futureEnd = forecast?.points.at(-1)?.time;
  if (!forecast || !Number.isFinite(futureEnd) || futureEnd <= forecast.now ||
      forecast.now < h.t0) return null;
  const points = forecast.points.filter((p) => p.time > forecast.now);
  if (!points.length) return null;
  const domainSpan = futureEnd - h.t0;
  if (!(domainSpan > 0)) return null;
  const measuredEnd = h.t0 + (h.v.length - 1) * h.dt;
  const xFrac = (time) => Math.max(0, Math.min(1, (time - h.t0) / domainSpan));
  const scales = {};
  for (const spec of WEATHER_FORECAST_SERIES) {
    const measured = h.series.find((s) => s.source === spec.measured);
    const scaleValues = measured ? measured.v.map((v) => v == null ? null : v / 10) : [];
    const rawCurrent = S.status?.env3?.[spec.env];
    const current = typeof rawCurrent === "number" ? rawCurrent : Number.NaN;
    if (S.status?.env3?.fresh && Number.isFinite(current)) scaleValues.push(current);
    scaleValues.push(...points.map((p) => p[spec.key]));
    scales[spec.key] = histScale(scaleValues, h.v.length).Y;
  }
  return {
    points,
    measuredFrac: xFrac(measuredEnd),
    nowFrac: xFrac(forecast.now),
    xFrac,
    Y: (key, value) => scales[key](value),
  };
}

function scrubCount(plot) {
  const h = historyView(plot.dataset.hist, plot.dataset.source || "");
  const forecast = forecastScrubView(h);
  return (h?.v.length || 0) + (forecast?.points.length || 0);
}

// ── Pinning ─────────────────────────────────────────────────────────────────────────────────────
// A tap PINS the readout so the value stays legible after the finger lifts; holding is no longer
// required. Hover remains transient and simply previews over the pin without disturbing it.
//
// The pin is stored as the sample's INSTANT and re-resolved on every render — the host-tested
// history_pin_index() rule (logic/history.hpp). A pin whose instant has rolled off the back of the
// day resolves to -1 and is dropped, rather than clamped to the oldest sample: clamping would leave
// a readout on screen while silently changing which moment it describes.
function histPinIndex(id, h) {
  const p = S.histPin.get(id);
  if (!p || !h || !h.v.length) return -1;
  if (p.forecast) {
    const forecast = forecastScrubView(h);
    const i = forecast?.points.findIndex((point) => point.time === p.t) ?? -1;
    return i < 0 ? -1 : h.v.length + i;
  }
  if (p.t != null) {
    if (h.t0 == null) return -1;                 // pinned with a clock, re-resolving without one
    const rel = p.t - h.t0, half = h.dt / 2;
    const i = Math.trunc((rel >= 0 ? rel + half : rel - half) / h.dt);
    return (i < 0 || i >= h.v.length) ? -1 : i;
  }
  return p.gen === h.gen ? p.i : -1;             // index pin: valid only for the series it was made on
}
// Pin sample `i` of `label`, or UNPIN when that same sample is already pinned — tapping the readout
// you just made is the obvious way to dismiss it, and needs no extra affordance on a 72 px plot.
function histPinToggle(id, i, source = "") {
  const h = historyView(id, source);
  if (!h || !h.v.length) return;
  const forecast = forecastScrubView(h);
  const total = h.v.length + (forecast?.points.length || 0);
  i = Math.max(0, Math.min(total - 1, i));
  if (histPinIndex(id, h) === i) S.histPin.delete(id);
  else if (i >= h.v.length) S.histPin.set(id, { t: forecast.points[i - h.v.length].time, forecast: true });
  else if (h.t0 != null) S.histPin.set(id, { t: h.t0 + i * h.dt });
  else S.histPin.set(id, { i, gen: h.gen });
  // Render PAST the click guard. That guard exists to stop a POLL from replacing the DOM in the
  // middle of a click; it must not delay the very update the click just asked for — a pin that
  // appeared 600 ms after the finger lifted would read as the same "it didn't take" the pin was
  // added to fix. The scrub guard is left alone: a drag still in progress owns the DOM.
  if (S.scrub) return;
  S.clickHold = false;
  renderTrendHosts();
}

// The label under the cursor: the sample's wall-clock time when the device had a synced clock
// (history carries t0, the unix instant of sample 0), else its age. A gap says so rather than
// showing the neighbouring reading, which would attribute a measurement to a minute that has none.
function scrubText(h, i) {
  if (h.id === ENV3_COMBINED_ID && i >= h.v.length) {
    const forecast = forecastScrubView(h);
    const point = forecast?.points[i - h.v.length];
    if (!point) return "";
    const locale = LANG;
    const when = new Date(point.time * 1000)
      .toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
    const value = (raw) => raw.toLocaleString(locale, {
      minimumFractionDigits: 1, maximumFractionDigits: 1,
    });
    return `${when}\n${t("hist.forecast")}` + WEATHER_FORECAST_SERIES.map((spec) =>
      `\n${t(spec.label)}  ${value(point[spec.key])} ${spec.unit}`).join("");
  }
  const pointWhen = () => {
    if (h.liveIndex === i) return t("hist.now");
    if (h.t0 != null) {
      return new Date((h.t0 + i * h.dt) * 1000)
        .toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
    }
    const ageH = (((h.recordedN ?? h.v.length) - 1 - i) * h.dt) / 3600;
    return ageH < 0.05 ? t("hist.now") : t("hist.rel", ageH.toFixed(1));
  };
  const valueText = (s) => {
    const v = s.v[i];
    const cfg = STATE_HIST[h.id];
    if (cfg && v != null) {
      const state = cfg.classify(v);
      if (state == null) return t("hist.nm");
      if (cfg.valueLabel) {
        const key = cfg.valueLabel(v);
        return key ? t(key) : t("hist.nm");
      }
      const label = t(state ? cfg.active : cfg.inactive);
      if (h.id !== "smart_grid_mode") return label;
      const mode = v / 10;
      return Number.isInteger(mode) && mode >= 0 && mode <= 3
        ? `${t(`sg.mode${mode}`)}${mode === 2 ? ` · ${label}` : ""}` : t("hist.nm");
    }
    return v != null ? (v / 10).toFixed(1) + (s.unit ? " " + s.unit : "")
         : histHeld(s, i) ? t("hist.held") : cfg?.missing ? t(cfg.missing) : t("hist.nm");
  };
  if (h.id === ENV3_COMBINED_ID) {
    const locale = LANG;
    const rows = h.series.map((s) => {
      const v = s.v[i];
      const shown = v == null ? t("hist.nm")
        : (v / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) +
          (s.unit ? " " + s.unit : "");
      return `${s.name}  ${shown}`;
    });
    return [pointWhen(), ...rows].join("\n");
  }
  const cfg = STATE_HIST[h.id];
  if (cfg) {
    // A deliberately source-filtered BOOST/BSH/BUH view stays terse. A paired view names BOTH
    // witnesses instead, matching the two labelled lanes and keeping their exact phase details
    // available without guessing from colours alone.
    if (cfg.compactTooltip && h.series.length === 1) {
      const primary = h.series.find((s) => s.source === cfg.primary) || h.series[0];
      const v = primary.v[i];
      let status = t("hist.nm");
      if (v != null) {
        const key = cfg.compactValueLabel ? cfg.compactValueLabel(v) : "";
        if (key) status = t(key);
        else {
          const state = cfg.classify(v);
          if (state != null) status = t(state ? "hist.state_active" : "hist.state_off");
        }
      }
      if (h.liveIndex === i) return `${t("hist.now")} · ${status}`;
      const [from, count] = sampleRunAt(
        h.liveIndex == null ? primary.v : primary.v.slice(0, h.recordedN), i);
      return `${stateRunWhen(h, from, count)} · ${status}`;
    }
    // A state chart is already a sequence of PHASES. Hovering any point therefore names the whole
    // containing phase — source, state, start/end and sampled duration — while the chart itself
    // stays compact. Source, state and timing form deliberate vertical rows; timing and duration
    // share one row because they describe the same interval. Paired instruments always retain one
    // block each, even when they agree, matching their independent source-labelled lanes.
    const blocks = h.series.map((s) => {
      if (h.liveIndex === i) return {
        source: s.source === "modbus" ? "Modbus" : s.name,
        detail: `${t("hist.now")} · ${valueText(s)}`,
      };
      const [from, count] = sampleRunAt(
        h.liveIndex == null ? s.v : s.v.slice(0, h.recordedN), i);
      return {
        source: s.source === "modbus" ? "Modbus" : s.name,
        detail: t(cfg.run, valueText(s), stateRunWhen(h, from, count), histDuration(count * h.dt)),
      };
    });
    return blocks.map((b) => `${b.source}\n${b.detail}`).join("\n\n");
  }
  // With two lines the readout names both instruments at the SAME instant. A gap in either remains
  // visible as words rather than borrowing its neighbour's value. The HomeHub outdoor register has
  // no source timestamp, so its popup also states the complete observed plateau and the unknown
  // measurement age — a fresh TCP read must not be mislabeled as a fresh sensor observation.
  const sourceText = (s) => {
    let out = `${s.source === "modbus" ? "Modbus" : s.name} ${valueText(s)}`;
    if (h.id === "outdoor_air" && s.source === "modbus" && s.v[i] != null) {
      const [from, count] = sampleRunAt(s.v, i);
      out += ` · ${t("hist.modbus_plateau", stateRunWhen(h, from, count), histDuration(count * h.dt))}`;
    }
    return out;
  };
  const val = h.series && (h.series.length > 1 || h.series[0].source === "modbus")
    ? h.series.map(sourceText).join(h.id === "outdoor_air" ? "\n" : " · ")
    : valueText(h.series ? h.series[0] : h);
  return pointWhen() + " · " + val;
}

// The combined ENV III tooltip is the one place where three independently scaled instruments are
// read together. Colour the complete measurement row (name AND value) with the same token as its
// area/legend; keep time and forecast provenance neutral. `scrubText()` remains the authoritative
// content formatter for accessibility and tests. Every line is escaped before this helper returns
// markup, so switching the live bubble from textContent to innerHTML below does not create an HTML
// injection path through translations, units or device data.
function env3ScrubHtml(h, i) {
  const lines = scrubText(h, i).split("\n");
  const firstMeasurement = i >= h.v.length ? 2 : 1;
  const classes = ["env-temperature", "env-humidity", "env-pressure"];
  // Time and forecast provenance share one neutral header. On a wide card the three coloured
  // readings then fit on one row, which lets the chart sit much closer to its legend. CSS stacks
  // the same escaped spans again on a phone; the plain-text accessibility formatter stays intact.
  const meta = lines.slice(0, firstMeasurement).join(" · ");
  return `<span class="vhist-tip-line vhist-tip-meta">${esc(meta)}</span>` +
    lines.slice(firstMeasurement).map((line, index) =>
      `<span class="vhist-tip-line ${classes[index]}">${esc(line)}</span>`
    ).join("");
}

// Keep the selected instant visible: samples in the left half open their bubble to the right and
// samples in the right half open it to the left. The small CSS leader bridges the deliberate gap
// back to the crosshair. This is position-only; tooltip dimensions never feed into graph layout.
function tipSideClass(frac) {
  return frac > 0.5 ? "vhist-tip-left" : "vhist-tip-right";
}

function placeScrubTip(tip, frac) {
  const left = frac > 0.5;
  tip.classList.toggle("vhist-tip-left", left);
  tip.classList.toggle("vhist-tip-right", !left);
  tip.style.setProperty("--tip-p", (frac * 100).toFixed(3));
}

// Paint the crosshair for sample `i` on the existing nodes. A drag never rebuilds the plot; only
// the ENV III bubble replaces its tiny, fully escaped set of coloured line spans.
function scrubMove(plot, i) {
  const h = historyView(plot.dataset.hist, plot.dataset.source || "");
  const n = +plot.dataset.n;
  if (!h || !n) return;
  const forecast = forecastScrubView(h);
  const total = n + (forecast?.points.length || 0);
  i = Math.max(0, Math.min(total - 1, i));
  const graph = plot.parentElement;
  // .vhist-live, never the bare class: a PINNED crosshair carries the same visual classes and sits
  // EARLIER in the DOM, so a bare querySelector returned the pin — the hover then wrote into it and
  // scrubEnd hid it, silently deleting the readout the user had just pinned.
  const tip = graph.querySelector(".vhist-tip.vhist-live");
  const cross = plot.querySelector(".vhist-cross.vhist-live");
  const marks = [...plot.querySelectorAll(".vhist-mark.vhist-live")];
  const w = plot.clientWidth;
  if (i >= n && forecast) {
    const point = forecast.points[i - n];
    const frac = forecast.xFrac(point.time);
    const x = frac * w;
    cross.hidden = false;
    cross.style.left = x.toFixed(1) + "px";
    for (const mark of marks) {
      const spec = WEATHER_FORECAST_SERIES.find((item) => item.source === mark.dataset.source);
      mark.hidden = !spec;
      if (!spec) continue;
      mark.style.left = x.toFixed(1) + "px";
      mark.style.top = ((forecast.Y(spec.key, point[spec.key]) / HIST_H) * 100).toFixed(2) + "%";
    }
    tip.hidden = false;
    if (h.id === ENV3_COMBINED_ID) tip.innerHTML = env3ScrubHtml(h, i);
    else tip.textContent = scrubText(h, i);
    placeScrubTip(tip, frac);
    return;
  }
  const measuredFrac = Number.isFinite(+plot.dataset.measuredP)
    ? Math.max(0.01, Math.min(1, +plot.dataset.measuredP / 100)) : 1;
  const frac = scrubFrac(i, n) * measuredFrac;
  const x = frac * w;

  cross.hidden = false;
  cross.style.left = x.toFixed(1) + "px";
  // One marker per instrument. Both share the crosshair and scale; a gap hides only that source's
  // marker, never the other one.
  const separateScales = h.id === ENV3_COMBINED_ID;
  const allPts = h.series.flatMap((s) => s.v.map((z) => z == null ? null : z / 10));
  const sharedY = separateScales ? null : histScale(allPts, n).Y;
  for (const mark of marks) {
    const s = h.series.find((q) => q.source === mark.dataset.source);
    const v = s ? s.v[i] : null;
    if (v == null) { mark.hidden = true; continue; }
    const scaleValues = s.v.map((z) => z == null ? null : z / 10);
    const spec = forecast && WEATHER_FORECAST_SERIES.find((item) => item.measured === s.source);
    if (spec) scaleValues.push(...weatherForecastView().points.map((point) => point[spec.key]));
    const Y = separateScales ? histScale(scaleValues, n).Y : sharedY;
    mark.hidden = false;
    mark.style.left = x.toFixed(1) + "px";
    mark.style.top = ((Y(v / 10) / HIST_H) * 100).toFixed(2) + "%";
  }
  tip.hidden = false;
  if (h.id === ENV3_COMBINED_ID) tip.innerHTML = env3ScrubHtml(h, i);
  else tip.textContent = scrubText(h, i);
  // The side changes at the midpoint, but the crosshair does not: the bubble leaves a fixed clear
  // gap beside the chosen sample rather than hanging over the value it describes.
  placeScrubTip(tip, frac);
}

function scrubIndex(plot, clientX) {
  const r = plot.getBoundingClientRect();
  const n = +plot.dataset.n;
  const h = historyView(plot.dataset.hist, plot.dataset.source || "");
  const forecast = forecastScrubView(h);
  const rawFrac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
  if (forecast && rawFrac > forecast.nowFrac) {
    let nearest = 0, distance = Infinity;
    forecast.points.forEach((point, i) => {
      const d = Math.abs(forecast.xFrac(point.time) - rawFrac);
      if (d < distance) { nearest = i; distance = d; }
    });
    return n + nearest;
  }
  const measuredFrac = Number.isFinite(+plot.dataset.measuredP)
    ? Math.max(0.01, Math.min(1, +plot.dataset.measuredP / 100)) : 1;
  return Math.max(0, Math.min(n - 1, Math.round((rawFrac / measuredFrac) * (n - 1))));
}

// A scrub freezes the whole value grid, so it MUST be impossible to leave one hanging: a pointerdown
// whose pointerup never arrives (the browser steals the gesture, the tab is backgrounded mid-drag, a
// capture call that silently failed) would otherwise latch S.scrub forever and stop every row from
// updating — a dashboard that looks like a dead device, with no error anywhere. lostpointercapture
// covers the normal exits including DOM removal; this watchdog covers the rest. Generous, because it
// only ever fires on a gesture that has already gone wrong: a real drag re-arms it on every move.
const SCRUB_MAX_MS = 20000;
let scrubWatchdog = 0;
function scrubArm(plot) {
  clearTimeout(scrubWatchdog);
  scrubWatchdog = setTimeout(() => scrubEnd(plot), SCRUB_MAX_MS);
}

function scrubEnd(plot) {
  clearTimeout(scrubWatchdog);
  if (plot) {
    plot.querySelector(".vhist-cross.vhist-live").hidden = true;
    plot.querySelectorAll(".vhist-mark.vhist-live").forEach((m) => { m.hidden = true; });
    plot.parentElement.querySelector(".vhist-tip.vhist-live").hidden = true;
  }
  if (S.scrub) { S.scrub = null; renderTrendHosts(); }   // resume the frozen per-poll rebuild
}

// The three places a trend is drawn — the value row's explainer, the schematic inspector and the
// ESP32 card's memory rows — resume together. They are frozen by the same S.scrub and two of them
// can hold the SAME series at once, so a resume that refreshed only one would leave another showing
// a pin the user has since moved.
function renderTrendHosts() {
  renderCards(); renderInspect(); renderSettings();
}

const chevIcon = `<svg class="vrow-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

const ENUM_VALUE_I18N = Object.freeze({
  "Auto": "enum.auto", "Heating": "enum.heating", "Cooling": "enum.cooling",
  "No error": "enum.no_error", "Fault": "enum.fault", "Warning": "enum.warning",
  "Space heating": "enum.space_heating", "DHW": "enum.dhw",
  "Free running": "enum.free_running", "Forced off": "enum.forced_off",
  "Recommended on": "enum.recommended_on", "Forced on": "enum.forced_on",
});

// HomeHub enum values stay numeric in /values and MQTT; Home Assistant publishes no HomeHub value
// entities. /values carries this
// separate semantic id so only the visual browser boundary turns e.g. smart_grid_mode=2 into the
// manufacturer's readable state. Unknown numbers remain visible as Unknown (N), never coerced.
const HOMEHUB_ENUM_VALUE_I18N = Object.freeze({
  unit_abnormality: Object.freeze(["enum.no_error", "enum.fault", "enum.warning"]),
  operation_mode: Object.freeze(["enum.auto", "enum.heating", "enum.cooling"]),
  current_operation_mode: Object.freeze([null, "enum.heating", "enum.cooling"]),
  three_way_valve: Object.freeze(["enum.space_heating", "enum.dhw"]),
  smart_grid_mode: Object.freeze([
    "enum.free_running", "enum.forced_off", "enum.recommended_on", "enum.forced_on",
  ]),
});

// Most converter-300..307 rows are genuine flags and remain ON/OFF. The 3-way valve is the one
// structural selector whose bit chooses a named path. `valve_heat` is a legacy stable semantic id
// for the 2-way/heating-cooling OUTPUT, so it deliberately remains ON/OFF: this output is separate
// from the configured/current mode and must never be promoted to Cooling. The public value itself
// remains 0/1.
const BINARY_VALUE_I18N = Object.freeze({
  valve_dhw: Object.freeze({ "0": "enum.space_heating", "1": "enum.dhw" }),
  valve_heat: Object.freeze({ "0": "state.off", "1": "state.on" }),
});

// /values keeps the firmware-wide numeric 0/1 contract and marks true flags with binary:true.
// Render ordinary flags as ON/OFF and structurally identified selectors as their named states at
// the last, visual boundary: a plain numeric 0 or 1 can also be a real count/stage. Named HomeHub
// enums arrive as raw numeric constants plus a semantic id and are named here; an undocumented
// value remains visible with its raw number.
function displayValue(v) {
  if (!v || v.value == null) return "—";
  const raw = String(v.value);
  if (v.binary === true) {
    const state = raw.trim();
    const named = BINARY_VALUE_I18N[v.binary_semantic]?.[state];
    if (named) return t(named);
    if (state === "1") return t("state.on");
    if (state === "0") return t("state.off");
  }
  const state = raw.trim();
  if (v.enum && /^-?\d+$/.test(state)) {
    const n = Number(state);
    const key = Number.isSafeInteger(n) ? HOMEHUB_ENUM_VALUE_I18N[v.enum]?.[n] : null;
    return key ? t(key) : t("enum.unknown", state);
  }
  const enumKey = ENUM_VALUE_I18N[state];
  if (enumKey) return t(enumKey);
  const unknown = /^Unknown \((-?\d+)\)$/.exec(state);
  if (unknown) return t("enum.unknown", unknown[1]);
  return raw;
}

// Most rows carry a dedicated unit field. Several legacy X10A measurements instead put an exact unit
// suffix in their generated label (for example "Flow sensor (l/min)" or "INV primary current
// (A)") and leave `unit` empty. Keep that transport/catalog identity unchanged, but present every
// measurement by the same UI rule: a clean name on the left and the unit beside the value.
//
// This is deliberately an allow-list rather than "anything in parentheses": suffixes such as
// (R1T), (DLWA2), (L1) and the valve's (On:DHW_Off:Space) are names/legends, not units. Explicit
// metadata always wins. L/min is canonicalised across X10A's historical `l/min` spelling and the
// HomeHub's `L/min` spelling so paired readings are visually identical.
const LABEL_UNIT_SUFFIX = /\s*\((kW|A|rps|pls|step|l\/min)\)\s*$/i;
const CANONICAL_UNITS = Object.freeze({
  "kw": "kW", "a": "A", "rps": "rps", "pls": "pls", "step": "step", "l/min": "L/min",
});
function displayUnit(v) {
  const explicit = String(v?.unit ?? "").trim();
  if (explicit) return CANONICAL_UNITS[explicit.toLowerCase()] || explicit;
  const match = LABEL_UNIT_SUFFIX.exec(String(v?.label ?? "").trim());
  return match ? CANONICAL_UNITS[match[1].toLowerCase()] : "";
}

// The generated X10A catalog sometimes appends the register's value legend to its technical name
// ("Reheat ON/OFF", "3way valve(On:DHW_Off:Space)") and sometimes does not ("Defrost Operation").
// It also carries the legacy unit suffixes handled above. The value column already shows the state
// or unit, so carrying either in the row name is redundant and inconsistent. Clean it only at the
// visual boundary: matching descriptions, history identities, selectors and every API/MQTT payload
// continue to use the exact catalog label.
function displayReadingLabel(label, row = null) {
  const raw = String(label ?? "").trim();
  const cleaned = raw
    .replace(LABEL_UNIT_SUFFIX, "")
    .replace(/\s*\([^)]*On\s*:[^)]*Off\s*:[^)]*\)\s*$/i, "")
    .replace(/[\s.]+ON\/OFF\s*$/i, "")
    .trim();
  const shown = cleaned || raw;
  // /values marks the six catalog labels that occur on more than one X10A page with the SAME
  // structural group used by MQTT/HA. Those rows are separate measurements, not duplicates — an
  // outdoor error and a hydronic error can occur independently — so dropping one would hide plant
  // state. Qualifying only that audited set removes duplicate visible names without renaming every
  // technical reading. Mechanical title-casing deliberately matches group_display_name() in
  // logic/mqtt_group.hpp ("outdoor_state" -> "Outdoor State") and needs no second page-name table.
  const scope = String(row?.x10a_group ?? "").trim().replace(/(^|_)([a-z])/g,
    (_match, separator, letter) => `${separator ? " " : ""}${letter.toUpperCase()}`);
  return scope ? `${scope} ${shown}` : shown;
}

// HomeHub API labels remain the manufacturer's stable English register names. The German UI names
// the same rows at the visual boundary, keyed by the documented offset rather than by prose, so a
// label edit cannot silently attach the wrong translation to another register.
const HOMEHUB_LABEL_DE = Object.freeze({
  21: "Diagnosezustand der Anlage",
  22: "Fehlercode der Anlage",
  23: "Fehlersubcode der Anlage",
  30: "Umwälzpumpe aktiv",
  31: "Verdichter aktiv",
  32: "Heizstab aktiv",
  33: "Speicherdesinfektion aktiv",
  37: "Position des 3-Wege-Ventils",
  38: "Aktueller Heiz- oder Kühlmodus",
  52: "Warmwasserbetrieb",
  53: "Raumheiz- oder Kühlbetrieb",
  40: "Vorlauftemperatur am Plattenwärmetauscher",
  41: "Vorlauftemperatur nach dem Zusatzheizer",
  42: "Rücklauftemperatur",
  43: "Warmwasserspeichertemperatur",
  44: "Außentemperatur",
  45: "Kältemitteltemperatur der Flüssigkeitsleitung",
  49: "Volumenstrom",
  50: "Raumtemperatur der Hauptzone",
  51: "Elektrische Leistungsaufnahme",
  1: "Heiz-Vorlaufsollwert der Hauptzone",
  2: "Kühl-Vorlaufsollwert der Hauptzone",
  3: "Heiz- oder Kühlmodus",
  4: "Raumheizung oder -kühlung freigegeben",
  6: "Heiz-Solltemperatur der Hauptzone",
  7: "Kühl-Solltemperatur der Hauptzone",
  9: "Leisebetrieb",
  10: "Sollwert für Warmwasser-Nachheizung",
  54: "Vorlaufkorrektur der Haupt-Heizzone",
  56: "Smart-Grid-Betriebsart",
  57: "Leistungsgrenze für Pufferung",
  58: "Allgemeine Leistungsgrenze",
});
function displayHomeHubLabel(row) {
  const fallback = displayReadingLabel(row && row.label, row);
  if (LANG !== "de" || !row || row.off == null) return fallback;
  return HOMEHUB_LABEL_DE[row.off] || fallback;
}

// The expandable row itself — a <button> header plus the collapsible panel beneath it. Shared by
// the value list (vDescRow) and the Model card (modelDescRow) so the two cannot drift into two
// slightly different accordions; `key` is what S.descOpen remembers across the per-poll rebuild, and
// `valHtml` is pre-built markup (it carries the unit <span>), so it is NOT escaped here.
// `trendId` is the series the panel carries, if any: the toggle fetches and un-pins by it, so the
// id is derived ONCE (here, where the body was built) instead of again from the key — which for a
// board row is not a catalog label and could not be looked up at all.
function descAccordion(key, label, valHtml, cls, bodyHtml, trendId) {
  const open = S.descOpen.has(key);
  return `<div class="vitem${open ? " open" : ""}">` +
    `<button class="vrow vrow-desc" type="button" data-desc="${esc(key)}"` +
    (trendId ? ` data-trend="${esc(trendId)}"` : "") + ` aria-expanded="${open ? "true" : "false"}">` +
    `<span class="vrow-label">${esc(label)}</span>` +
    `<span class="vrow-end"><span class="vrow-val ${cls}">${valHtml}</span>${chevIcon}</span>` +
    `</button>` +
    `<div class="vdesc"><div class="vdesc-inner"><div class="vdesc-body">${bodyHtml}</div></div></div>` +
    `</div>`;
}

// One value row. If a description matches the label, render the accordion; otherwise a plain,
// unchanged row. Most catalog labels are unique within a render; the reused set carries its X10A
// group from the server below. A derived row supplies its own key and visual label while keeping its
// canonical label for description matching.
function vDescRow(v) {
  const label = v.label || "";
  const shownLabel = v.displayLabel || displayReadingLabel(label, v);
  // Ambiguous rows used to share one label-based key, so expanding either Error Code opened both
  // panels on the next render. The server supplies x10a_group only for that audited collision set;
  // prefixing those keys preserves every existing key while making the colliding rows independent.
  const key = v.key || (v.x10a_group ? `${v.x10a_group}:${label}` : label);
  let cls = v.state || v.class || "";
  const d = descFor(label, v);
  const hid = histIdFor(label);          // this profile's spelling -> the concept the device buffers
  // The SECOND source for this row, if the HomeHub carries the same quantity (paired on the concept
  // the firmware resolved — see mbByConcept). Two distinct uses, and they must not be confused:
  //   `mb`  — the comparison shown inside the explainer while BOTH sources are up.
  //   `fb`  — the stand-in shown IN PLACE of the X10A value while the X10A bus is down.
  const mb = mbByConcept(v.concept);
  const fb = mbStandInFor(v);
  // A row stops being a reading for two reasons — the X10A bus is silent, or the outdoor unit is no
  // longer refreshing this page — and both get the same treatment: the HomeHub reading stands in
  // where it carries the same quantity, marked as such, and where it does not the row shows nothing
  // at all. Blanking is the right answer, not a stale X10A number: this table is the "exact-value
  // reference", so it is the LAST place a value the unit is not measuring may appear as an ordinary
  // current row while the pill above it, the inspector, the chart and MQTT all refuse it.
  const notCurrent = x10aDown() || rowNotMeasuring(v);
  const src = fb || v;
  if (fb) cls = (cls ? cls + " " : "") + "src-val-mb";
  const unit = displayUnit(src);
  const val = (notCurrent && !fb)
    ? "—"
    : esc(displayValue(src)) + (unit ? `<span class="vrow-unit">${esc(unit)}</span>` : "");
  // With the gateway's value already standing IN for the row, the explainer must not also print it
  // as a second opinion with a difference against the X10A number — that difference is measured
  // against a reading this row has just refused to state.
  const cmp = fb ? null : mb;
  // The state age describes THIS row's own X10A reading, so it is withheld exactly when that reading
  // is: a blanked row states no value, and a row a HomeHub is standing in for is showing the other
  // instrument — putting "OFF for 3 h" under either would restate a number the row above just
  // refused, which is the failure ou_stale.hpp's inspector rule already had to fix once.
  const dwell = notCurrent ? "" : dwellNoteHtml(v, displayValue(src));
  if (!d && !hid && !cmp && !dwell) {
    return `<div class="vrow"><span class="vrow-label">${esc(shownLabel)}</span>` +
      `<span class="vrow-val ${cls}">${val}</span></div>`;
  }
  // Body = how long it has read this, then the explainer, then the second source's reading, then the
  // trend. Any part may be absent, which is why the builder takes finished markup rather than a
  // description. The age goes FIRST because it is the only LIVE fact in the panel — the explainer
  // below it is the same sentence on every device and at every hour.
  return descAccordion(key, shownLabel, val, cls,
                       dwell + (d ? descBodyHtml(d, src.value) : "") + mbNoteHtml(v, cmp) +
                       histHtml(hid, displayUnit(v), shownLabel), hid);
}

// A Model-card row: the same accordion as a value row when copy exists for it, else the plain row
// vrow() would have produced. The key is prefixed so it can never collide with a catalog label in
// S.descOpen — "Capacity" is both a card row and a plausible label.
// ── Explainers for rows that are NOT catalog readings ────────────────────────────────────────────
// The Model card's rows and the ESP32 card's two memory rows. Keeps the MODEL_DESCRIPTIONS name the
// description gate parses (tools/descriptions/check_descriptions.mjs) — what it enforces here is the
// German copy, and that applies to every entry regardless of which card shows it.
//
// The Model card's rows are the ones that most need explaining and were the last with no explainer:
// they answer questions the reader did not ask ("possible models" — why more than one? "outdoor unit
// ID" — for what?) in vocabulary taken from the bus. #184 added the two rows precisely so an
// ambiguous detection reads as a detection that succeeded as far as the wire permits — but the card
// states the FACT and never the reason, so it still reads as a failure to anyone who does not
// already know why a heat pump cannot name itself.
//
// A SEPARATE table from DESCRIPTIONS, keyed by a stable row id rather than by the label, for two
// reasons: these labels are TRANSLATED (`t("card.capacity_iu")` is "Nennleistung der Inneneinheit" on a
// German page), so a regex over English label text would silently stop matching; and they are not
// catalog labels, so entries here would read as dead to the coverage gate's D002 check
// (tools/descriptions/check_descriptions.mjs), which is exactly right — it audits the catalog, and
// these rows have no catalog to audit against.
const MODEL_DESCRIPTIONS = {
  // ── The Checkup card's explainers ──────────────────────────────────────────────────────────
  // These rows need their explainer more than any other on the dashboard, and for a different
  // reason than the Model card's: a value row states a measurement the reader can look up, while
  // "31 starts, mean 6 min" states a JUDGEMENT, while flow/heater rows deliberately state only a
  // measurement. Without the copy a reader cannot tell which is which, what the firmware actually
  // established. So each entry answers what was counted and the limit of the claim, without
  // recommending a follow-up that the available evidence may not support.
  //
  // They also have to say what the row does NOT claim. Two of these checks are deliberately weaker
  // than they look — the flow minimum carries no verdict at all because the manufacturer's minimum
  // is per model, and a high defrost share is only a heuristic because humidity and coil temperature
  // are not on this bus — and a reader who assumes the firmware is asserting more than it is will draw
  // the wrong conclusion from a correct number.
  health_fault: {
    what: "Reports the heat pump's own error or warning state. An active error gives WARNING; a warning/caution or a message that appeared and cleared within 24 hours gives NOTE. This is the unit speaking, not a project guess.",
    normal: "No current or remembered message after every supported fault row was readable. A cleared message can remain visible for up to 24 hours; an active code is shown under Operation.",
    de: { what: "Meldet den Fehler- oder Warnzustand der Wärmepumpe selbst. Ein aktiver Fehler ergibt WARNUNG; eine Warnung/Vorsicht oder eine in 24 Stunden erschienene und wieder verschwundene Meldung ergibt HINWEIS. Das ist keine Projekt-Vermutung.",
          normal: "Keine aktuelle oder gemerkte Meldung, nachdem alle unterstützten Störungszeilen lesbar waren. Eine verschwundene Meldung kann bis zu 24 Stunden sichtbar bleiben; ein aktiver Code steht unter „Betrieb“." } },
  health_dhw_loss: {
    what: "Measures tank cooling in quiet one-hour windows. Charging, draw-like drops and internal heating are excluded; an optional power meter reports circulation-pump operation.",
    normal: "NOTE starts at 0.8 K/h, a project heuristic for one reference installation. Tank volume and the tank-to-room temperature difference change the rate. Clean-hour loss is detectable only up to about 1.85 K/h; faster continuous loss can trip the draw filter. OK means none was observed in that band, not that insulation or valves are proven sound.",
    de: { what: "Misst die Abkühlung in ruhigen Speicherstunden. Ladung, zapfungsähnliche Abfälle und interne Heizaktivität werden ausgeschlossen; ein Stromzähler kann die Zirkulationspumpe zeigen.",
          normal: "HINWEIS ab 0,8 K/h – Heuristik der Referenzanlage. Speichervolumen und Abstand zur Raumtemperatur ändern den Wert. Bereinigte Stunden zeigen nur bis etwa 1,85 K/h; schneller Dauerverlust kann wie Zapfung ausgefiltert werden. OK heißt nur: Kein Verlust im erkennbaren Band gefunden; das beweist weder gute Dämmung noch Ventile." } },
  health_cycling: {
    what: "Counts each compressor change from OFF to ON and how long a complete run lasted. Where the signals permit, runs are separated into space heating, hot water and cooling. Mixed or unread runs are shown as unclassified.",
    normal: "Confirmed heating runs average at least 10 min. With 12 or more averaging under 10 min, NOTE appears. Hot water and cooling are excluded. If too many runs are unclassified, all runs are assessed together. This is not a Daikin limit.",
    de: { what: "Zählt jeden Verdichterwechsel von OFF zu ON und die Dauer eines vollständigen Laufs. Wenn die Signale reichen, werden Raumheizung, Warmwasser und Kühlen getrennt. Gemischte oder ungelesene Läufe erscheinen als „ohne Zuordnung“.",
          normal: "Bestätigte Heizläufe dauern im Mittel mindestens 10 min. Bei mindestens 12 Läufen unter 10 min erscheint HINWEIS. Warmwasser und Kühlen zählen nicht mit. Sind zu viele Läufe ungeklärt, werden alle gemeinsam bewertet. Kein Daikin-Grenzwert." } },
  health_defrost: {
    what: "Counts each defrost change from OFF to ON and the share of observed compressor time spent defrosting. Defrost removes ice from the outdoor heat exchanger and is normal in cold, damp weather.",
    normal: "Up to 15% of paired compressor time. Above it with at least three observed defrosts gives NOTE only. This is not a Daikin limit: humidity and heat-exchanger surface temperature are unavailable.",
    de: { what: "Zählt jeden Wechsel der Abtauung von OFF zu ON und ihren Anteil an der beobachteten Verdichterlaufzeit. Abtauen entfernt Eis am Außengerät und ist bei kaltem, feuchtem Wetter normal.",
          normal: "Bis 15 % der gepaarten Verdichterlaufzeit. Darüber erscheint bei mindestens drei beobachteten Abtauungen nur HINWEIS. Kein Daikin-Grenzwert: Luftfeuchte und Oberflächentemperatur des Wärmetauschers fehlen." } },
  health_pressure: {
    what: "Shows the lowest valid water pressure measured in the heating circuit during the rolling window.",
    normal: "Above 1.0 bar. At or below 1.0 bar gives a NOTE immediately and a WARNING after 60 continuous seconds. The permitted range can vary by model, so compare it with the exact unit manual.",
    de: { what: "Zeigt den niedrigsten gültigen Wasserdruck, der im Heizkreis während des rollierenden Fensters gemessen wurde.",
          normal: "Über 1,0 bar. Bei höchstens 1,0 bar erscheint sofort HINWEIS und nach 60 durchgehenden Sekunden WARNUNG. Der erlaubte Bereich kann je Modell abweichen; mit der genauen Geräteanleitung vergleichen." } },
  health_flow: {
    what: "Shows the lowest water flow after the internal pump had run continuously for 60 seconds. Pump startup, stopped-pump readings and communication gaps are excluded.",
    normal: "MEASURED ONLY: this is an observed part-load minimum after pump run-up, not the nominal or design flow. There is no universal limit; a manual minimum applies only to the same model, mode and conditions. One low value without a unit fault proves little.",
    de: { what: "Zeigt den niedrigsten Wasserdurchfluss, nachdem die interne Pumpe 60 Sekunden durchgehend lief. Pumpenanlauf, Werte bei stehender Pumpe und Kommunikationslücken werden ausgeschlossen.",
          normal: "NUR MESSWERT: Das ist ein beobachtetes Teillast-Minimum nach Pumpenanlauf, nicht der Nenn- oder Auslegungsdurchfluss. Eine allgemeine Grenze gibt es nicht; ein Anleitungs-Minimum gilt nur für dasselbe Modell, dieselbe Betriebsart und dieselben Bedingungen. Ein Einzelwert ohne Anlagenstörung beweist wenig." } },
  health_heater: {
    what: "Shows separately how long the electric heater for space heating (BUH) and the heater in the hot-water tank (BSH) were observed running.",
    normal: "MEASURED ONLY. Cold weather, emergency mode, defrost support, hot-water schedules or surplus-energy control can all make electric-heater runtime intentional. There is no universal OK/WARNING limit.",
    de: { what: "Zeigt getrennt, wie lange der elektrische Zusatzheizer für den Heizkreis (BUH) und der Heizstab im Warmwasserspeicher (BSH) beobachtet wurden.",
          normal: "NUR MESSWERT. Kälte, Notbetrieb, Abtauhilfe, Warmwasser-Zeitplan oder Überschusssteuerung können elektrische Laufzeit erklären. Es gibt keine allgemeine Grenze für OK/WARNUNG." } },
  health_retries: {
    what: "Experimental watch of five internal protection counters. Only a clear increase between comparable readings counts, including one first visible while stopped or at a compressor-state boundary. Baseline, stable or decreasing values, gaps and resets do not.",
    normal: "No observed increase. An increase gives NOTE, not a fault diagnosis; no increase cannot prove that the unit never limited itself because the counters are not fully documented.",
    de: { what: "Experimentelle Beobachtung von fünf internen Schutzzählern. Nur ein klarer Anstieg zwischen vergleichbaren Messungen zählt, auch wenn er erst im Stillstand oder an einer Verdichter-Zustandsgrenze sichtbar wird. Basiswert, stabile oder abnehmende Werte, Lücken und Rücksetzungen zählen nicht.",
          normal: "Kein beobachteter Anstieg. Ein Anstieg ergibt HINWEIS, keine Störungsdiagnose; kein Anstieg beweist wegen unvollständig dokumentierter Zähler nicht, dass die Anlage nie begrenzt hat." } },
  // The two board-memory rows on the ESP32 card. The copy has one job beyond naming the number: to
  // say what the SHAPE of the curve means, because that is the whole reason these rows exist rather
  // than living on /status alone.
  free_heap: {
    what: "RAM that is currently unused by the firmware. Short changes are normal because WiFi, MQTT and web requests allocate temporary memory; the 24-hour trend is more useful than one reading.",
    normal: "a broadly stable line with temporary dips that recover. A persistent downward trend can indicate retained allocations and should be investigated. A restart that kept power carries the trend over in RAM; a normal reboot, firmware update or sudden power loss restores completed five-minute buckets from device flash. Only the bucket open at the interruption may be missing.",
    de: { what: "Arbeitsspeicher, den die Firmware gerade nicht verwendet. Kurze Schwankungen sind normal, weil WLAN, MQTT und Web-Anfragen vorübergehend Speicher belegen; der 24-Stunden-Verlauf ist aussagekräftiger als ein Einzelwert.",
          normal: "eine insgesamt stabile Linie mit vorübergehenden Einbrüchen, die sich erholen. Ein dauerhaft fallender Verlauf kann auf nicht freigegebenen Speicher hinweisen und sollte untersucht werden. Ein Neustart mit erhaltener Spannung übernimmt den Verlauf im RAM; ein normaler Neustart, Firmware-Update oder plötzlicher Spannungsverlust stellt abgeschlossene Fünf-Minuten-Buckets aus dem Geräte-Flash wieder her. Nur der beim Abbruch offene Bucket kann fehlen." } },
  max_alloc: {
    what: "The largest contiguous block of free RAM. Some operations, including TLS setup and OTA work, need one sufficiently large block even when the total free RAM is higher.",
    normal: "it is always at or below total free RAM. If total free RAM stays stable while this value keeps falling, the heap is becoming fragmented; that can make a large allocation fail before all RAM is used.",
    de: { what: "Der größte zusammenhängende freie RAM-Block. Manche Vorgänge, darunter TLS-Aufbau und OTA-Arbeiten, benötigen einen ausreichend großen Block, auch wenn insgesamt noch mehr RAM frei ist.",
          normal: "der Wert liegt nie über dem gesamten freien RAM. Bleibt der freie RAM stabil, während dieser Wert dauerhaft sinkt, wird der Speicher fragmentiert; dann kann eine große Reservierung scheitern, obwohl noch RAM frei ist." } },
  capacity: {
    what: "The outdoor unit's rated capacity, read from its own identification page. It is a size class of the hardware — what the unit is built for, not what it is producing right now.",
    de: { what: "Die Nennleistung der Außeneinheit, aus ihrer eigenen Kennungsseite gelesen. Eine Größenklasse der Hardware — wofür das Gerät gebaut ist, nicht was es gerade liefert." } },
  capacity_iu: {
    what: "The INDOOR unit's rated capacity. It is shown because the outdoor unit's identification page contains no separate capacity. The label states exactly which unit supplied the value.",
    normal: "indoor and outdoor units can have different capacity classes. Do not read this as the outdoor unit's or the complete system's rated capacity.",
    de: { what: "Die Nennleistung der INNENEINHEIT. Sie wird angezeigt, weil die Kennungsseite dieser Außeneinheit keine eigene Leistung enthält. Die Firmware benennt damit ausdrücklich die Einheit, aus der der Wert stammt.",
          normal: "Innen- und Außeneinheit können unterschiedliche Leistungsklassen haben. Deshalb darf dieser Wert nicht als Nennleistung der Außeneinheit oder des Gesamtsystems gelesen werden." } },
  // TWO variants, and which one is true depends on whether the outdoor unit reported its capacity.
  // logic/detect.hpp is explicit: candidates that share a page mask AND a kW class are
  // register-identical, so the pick cannot change a reading — but when the O/U capacity is unknown
  // "the candidate set spans DIFFERENT kW classes, so it is NOT register-identical and the
  // representative choice does affect the values". Asserting the reassuring version in both states
  // would put a false claim on screen in exactly the state that produces this row most often (a
  // short 0x00 descriptor), which is the #35-#39 shape in copy rather than in a converter.
  candidates: {
    what: "Several Daikin model families expose the same registers and values on the service interface, so the exact marketing name cannot be distinguished there. The heading deliberately stays \"Daikin Altherma\" instead of guessing a model.",
    normal: "the readings are unaffected: the outdoor unit reported its rated capacity, and all remaining candidates use the same capacity class and register layout. To identify the exact model, compare the outdoor-unit ID below with the nameplate.",
    de: { what: "Mehrere Daikin-Modellfamilien liefern auf der Serviceschnittstelle dieselben Register und Werte. Deshalb lässt sich der genaue Handelsname dort nicht unterscheiden. Die Überschrift bleibt bewusst „Daikin Altherma“, statt ein Modell zu raten.",
          normal: "die Messwerte sind davon nicht betroffen: Die Außeneinheit hat ihre Nennleistung gemeldet, und alle verbliebenen Kandidaten verwenden dieselbe Leistungsklasse und Registerauslegung. Für den genauen Modellnamen vergleiche die Außengeräte-Kennung unten mit dem Typenschild." } },
  candidates_nocap: {
    what: "Several Daikin model families expose the same registers on the service interface, so the exact marketing name cannot be distinguished there. The heading deliberately stays \"Daikin Altherma\" instead of guessing a model.",
    normal: "this outdoor unit does not report its own rated capacity, so the candidates can belong to different capacity classes. The firmware decodes the values with the variant that best matches the indoor unit, but not with full certainty. Compare the outdoor-unit ID below with the nameplate.",
    de: { what: "Mehrere Daikin-Modellfamilien liefern auf der Serviceschnittstelle dieselben Register. Deshalb lässt sich der genaue Handelsname dort nicht unterscheiden. Die Überschrift bleibt bewusst „Daikin Altherma“, statt ein Modell zu raten.",
          normal: "diese Außeneinheit meldet ihre eigene Nennleistung nicht; die Kandidaten können deshalb verschiedenen Leistungsklassen angehören. Die Firmware dekodiert die Werte mit der anhand der Inneneinheit am besten passenden Variante, aber nicht mit voller Gewissheit. Vergleiche die Außengeräte-Kennung unten mit dem Typenschild." } },
  oueeprom: {
    what: "The outdoor unit's identification bytes, shown unchanged from the service interface. No public mapping to marketing names is known, so the firmware displays the ID instead of guessing a model.",
    normal: "for an ambiguous detection, compare it character by character with the outdoor unit's nameplate.",
    de: { what: "Die Kennungsbytes der Außeneinheit, unverändert von der Serviceschnittstelle angezeigt. Da keine öffentliche Zuordnung zu Handelsnamen bekannt ist, zeigt die Firmware die Kennung, statt daraus einen Modellnamen zu raten.",
          normal: "bei einer mehrdeutigen Erkennung Zeichen für Zeichen mit dem Typenschild der Außeneinheit vergleichen." } },
};

// A Model-card row: the same accordion as a value row when copy exists for it, else the plain row
// vrow() would have produced. The key is prefixed so it can never collide with a catalog label in
// S.descOpen — "Capacity" is both a card row and a plausible label.
function modelDescRow(id, label, value, opt = {}) {
  const d = MODEL_DESCRIPTIONS[id];
  if (!d) return vrow(label, value, opt);
  const val = esc(value) + (opt.unit ? `<span class="vrow-unit">${esc(opt.unit)}</span>` : "");
  // No trend half here: the firmware keeps series for catalog readings, and these rows are model
  // identity — a nameplate fact, not something that moves.
  return descAccordion(`model:${id}`, label, val, opt.cls || "",
                       (opt.bodyPrefix || "") + descBodyHtml(d));
}

// Toggle a value row's description accordion. Only the LIVE element is flipped here (so the CSS
// height transition actually runs); S.descOpen carries the state into the next per-poll rebuild,
// which re-emits the row already-open (no re-animation). A <button> header means Enter/Space work
// for free — no extra key handling needed.
function toggleDesc(btn) {
  const item = btn.closest(".vitem");
  if (!item) return;
  const key = btn.dataset.desc || "";
  const trend = btn.dataset.trend || "";
  const trends = (btn.dataset.trends || "").split(",").filter(Boolean);
  if (trend) trends.unshift(trend);
  const open = !item.classList.contains("open");
  item.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) S.descOpen.add(key);
  else { S.descOpen.delete(key); for (const id of trends) S.histPin.delete(id); }
  // Fetch the trend only once the panel is actually opened — a device that buffers eleven series
  // would otherwise answer a request per row on every page load, for panels nobody looked at.
  if (open) for (const id of trends) ensureHistPair(id);
}

// Heat-pump value groups (grouped by domain, §6) as card markup. Hidden entirely while the
// heat-pump link is down — there's nothing to poll, so "Waiting for the first poll…" would be
// misleading (implies data is imminent) rather than "not connected".
function valueGroupsHtml(vals, connected) {
  // The list also renders while X10A is down IF the HomeHub is still delivering — that is the whole
  // point of two independent stacks. Each row then shows the Modbus reading (marked) or blanks
  // (vDescRow); hiding the list wholesale would throw away readings that ARE being measured.
  if (!connected && !mbLive()) return "";
  const rows = vals.slice();
  const smartGrid = x10aSmartGridRow();
  if (smartGrid) rows.push(smartGrid);
  if (!rows.length) {
    // X10A has nothing to show yet. If the HomeHub is delivering, ITS readings are all there is —
    // show them rather than "waiting for the heat pump" over live data. This was the gap: the guard
    // above already let the Modbus case through, and then this line sent it straight back, so the
    // whole list collapsed to the waiting card. Every PAIRED row (leaving water, return, flow, tank,
    // outdoor) normally rides inside its X10A row, so with no X10A rows they had nowhere to be drawn
    // at all and only the handful of unpaired ones would have survived, in the card below.
    if (mbLive() && (S._modbus || []).some((m) => m && m.value != null)) return modbusOnlyGroupHtml(true);
    return `<div class="vgroup"><div class="card"><span class="empty">${esc(t("values.waiting"))}</span></div></div>`;
  }
  // Reading order is GROUP_ORDER (DESIGN.md §6), NOT the GROUPS array — that one is match
  // precedence, and the two stopped agreeing the moment a key had to be made more specific.
  const order = [...GROUP_ORDER, "Other values"];
  const buckets = new Map();
  for (const v of rows) { const g = groupOf(v); (buckets.get(g) || buckets.set(g, []).get(g)).push(v); }
  const grouped = buckets.size > 1;
  const rowsOf = (rows) => rows.map((v) => vDescRow(v)).join("");
  // Group headings are translated; a firmware-supplied custom group (not in the dictionary) keeps its
  // own name. Bucket KEYS stay the English group name (groupOf) — only the display label is localised.
  const groupLabel = (name) => (I18N.en["group." + name] != null ? t("group." + name) : name);
  let html = ""; const done = new Set();
  // A Protection row reading 1 is the unit backing off RIGHT NOW (the "Drop"/"Drop Control" flags);
  // the "Retry Qty" counters beside them are cumulative and are deliberately NOT highlighted — 3
  // retries is history, not a working point, and marking both alike would merge "it is happening"
  // into "it has happened", which is the one distinction these eleven rows exist to draw.
  //
  // Scoped to THIS group on purpose. Plenty of rows elsewhere read 1 in normal operation ("Water
  // pump operation", "Thermostat ON/OFF", and the default_on freeze-protection flags the group keys
  // deliberately exclude); highlighting 1 globally would tint a healthy plant amber. Keyed on the
  // numeric state rather than a label pattern, so it needs no second copy of the row list — inside
  // this group the binary rows ARE the drop flags.
  const isLimiting = (v) => String(v.value ?? "").trim() === "1";
  const emit = (name, rows) => {
    const prot   = name === "Protection";
    const shown  = prot ? rows.map((v) => (isLimiting(v) ? { ...v, state: "warn" } : v)) : rows;
    const badge  = prot && rows.some(isLimiting) ? t("protect.limiting") : "";
    html += vcard(grouped ? groupLabel(name) : t("group.Values"), rowsOf(shown), badge);
  };
  for (const name of order) if (buckets.has(name)) { emit(name, buckets.get(name)); done.add(name); }
  for (const [name, rows] of buckets) if (!done.has(name)) emit(name, rows); // firmware-supplied custom groups
  html += modbusOnlyGroupHtml();
  return html;
}

// The HomeHub registers with NO X10A counterpart — the real power measurement, the Smart-Grid mode,
// the setpoint limits. They have no row to sit inside, so they get a group of their own, LAST: visible
// (the power reading in particular is worth having — X10A has no equivalent and the dashboard has to
// estimate it from CT clamps at an assumed 230 V) but after everything X10A carries, because X10A
// stays the prominent source. Empty and therefore absent on a device with no HomeHub.
function modbusOnlyGroupHtml(all) {
  // `all` = X10A carried no rows at all, so the paired ones have no row to sit inside and belong here
  // too — otherwise they are simply not on screen while being actively measured.
  //
  // "Paired" is decided at RUNTIME, against the rows this device is actually showing — not from the
  // row merely CARRYING a concept. The map deliberately allows a profile to lack a concept (a
  // monobloc has no room sensor), and a `concept` on the gateway row only says the firmware KNOWS
  // an X10A equivalent exists somewhere in the catalog. Filtering on the tag alone dropped those
  // readings twice over: no X10A row to ride inside, and excluded from this card for having a twin
  // that does not exist here.
  const twinShown = (m) => !!m.concept &&
    (S._values || []).some((v) => v && v.concept === m.concept && v.value != null);
  const rows = (S._modbus || []).filter((m) => m && (all || !twinShown(m)) && m.value != null);
  if (!rows.length) return "";
  // Through the SAME accordion the X10A rows use, not a bare row of its own. A reading with no
  // explainer is a naked value, and these were 25 of them: a valve destination without context tells
  // a reader nothing about what it controls or what is normal. The description audit guards the
  // X10A catalog against exactly this and never saw these labels, so it stayed green while the card shipped.
  // Copy comes from the one DESCRIPTIONS table (descFor), where 11 of the 27 gateway labels are
  // already answered by the entries written for their X10A twins — the same words for the same
  // quantity, which is the point of one table.
  //
  // A paired schematic measurement keeps its OWN Modbus ring even when this profile has no X10A row
  // to host it. Unpaired rows still have no chart. Where copy is missing the row degrades to the same
  // plain line it was before, rather than an empty panel that opens onto nothing.
  const html = rows.map((m) => {
    const label = m.label || "", shown = displayHomeHubLabel(m);
    const unit = displayUnit(m);
    const val = esc(displayValue(m)) +
      (unit ? `<span class="vrow-unit">${esc(unit)}</span>` : "");
    const d = descFor(label, m);
    const historyId = m.history || m.concept || "";
    const hid = hasModbusHist(historyId) ? historyId : "";
    if (!d && !hid) {
      return `<div class="vrow"><span class="vrow-label">${esc(shown)}</span>` +
        `<span class="vrow-val src-val-mb">${val}</span></div>`;
    }
    return descAccordion(label, shown, val, "src-val-mb",
                         (d ? descBodyHtml(d, m.value) : "") + histHtml(hid, unit, shown), hid);
  }).join("");
  // The heading has to match what is IN the card: "Modbus only" is true of the unpaired handful and
  // false the moment `all` folds the paired rows in beside them.
  // Always just "Modbus" — the card is named after its SOURCE, not after how much of the
  // catalog happens to be in it this cycle. "Modbus only" tried to say the second thing and
  // was wrong half the time: with X10A down the paired rows fold in here too, so the card was
  // titled "only" over readings that are anything but.
  return vcard(t("group.Modbus"), html);
}
