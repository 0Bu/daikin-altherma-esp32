// ── 24-hour trend (a historied value row's explainer carries a sparkline under the text) ──────
// WHICH rows have a trend is the FIRMWARE's answer. /status.history.rows names X10A rings;
// modbus_rows names the thirty-five HomeHub rings (paired measurements/states, Smart-Grid, plus the
// standalone active-state, mode, abnormality, enable, setpoint, offset, power-limit, and telemetry
// timelines); env3_rows names temperature, humidity and pressure from the independent outdoor sensor.
// The device keeps every source at one fixed cadence and reports the labels each source owns. The
// browser never pattern-matches its own candidates: offering a trend the device isn't buffering
// would be an empty chart by design.
let histFormatLanguage, histNumberFormat;
function histFmt1(n) {
  if (histFormatLanguage !== LANG) {
    histNumberFormat = new Intl.NumberFormat(LANG, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    histFormatLanguage = LANG;
  }
  return histNumberFormat.format(Number(n));
}
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
const histRowsOf = (k) => { const a = histSpec()?.[k]; return Array.isArray(a) ? a : []; };
const modbusHistRows = () => histRowsOf("modbus_rows");
const env3HistRows = () => histRowsOf("env3_rows");
function histFor(label) {
  const h = histSpec();
  return h ? h.rows.find((r) => r && r.label === label) || null : null;
}
// The trend id for a rendered value-row label, or "" when the device buffers no series for it.
function histIdFor(label) { const r = histFor(label); return r ? r.id : ""; }
// Is the device keeping this series? Asked by ID — a board row has no catalog label to look up, and
// a firmware that predates a trend simply reports fewer rows, so its card draws no chart at all
// rather than an empty one.
const MB_HIST_WIRE_ID = Object.freeze({
  pel: "modbus_power",
  x10a_pump_state: "pump_state",
  x10a_space_state: "modbus_space_state",
});
const modbusHistRowId = (id) => MB_HIST_WIRE_ID[id] || id;
function hasDeviceHist(id) { return !!id && !!histSpec() && histSpec().rows.some((r) => r && r.id === id); }
function hasDeviceModbusHist(id) {
  const mid = modbusHistRowId(id);
  return !!mid && modbusHistRows().some((r) => r && r.id === mid);
}
function hasModbusHist(id) {
  const D = DERIVED[id];
  return D ? (D.mbIns ? D.mbReady(Object.fromEntries(D.mbIns.map((k) => [k, hasDeviceModbusHist(k)]))) : false)
           : hasDeviceModbusHist(id);
}
function hasEnv3Hist(id) { return !!id && env3HistRows().some((r) => r && r.id === id); }
function hasHist(id) {
  const D = DERIVED[id];
  return D ? D.ready(Object.fromEntries(D.ins.map((k) => [k, hasDeviceHist(k)]))) : hasDeviceHist(id);
}

// Derived trends combine measurements on the same five-minute raster. Single-sweep X10A electrical
// input (`pel`) and heating/DHW COP (`cop`) are evaluated per sweep in the firmware (`logic/history.hpp`)
// so partial CT phases, page timeouts or mid-bucket heater pulses never cross-mix different sweeps.
// Raw phase currents and inverter current retain their own rings.
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
// X10A "Water pump signal" is an inverted percentage command on [0, 100]: 0 = max command,
// 100 = stop command. Out-of-range or non-finite values are rejected instead of clamped to 0 % or
// 100 %, and fractional precision is preserved for callers.
function pumpCommandPercent(signal) {
  return typeof signal === "number" && Number.isFinite(signal) && signal >= 0 && signal <= 100
    ? 100 - signal : null;
}

function modbusFlowScaleUnverified() {
  const row49 = (S._modbus || []).find((m) => m && m.off === 49);
  if (row49) return row49.flow_scale_unverified === true || row49.profile === "altherma4";
  const mb = S.status?.modbus || {};
  return mb.profile === "altherma4" || mb.profile === "auto" ||
    mb.profile_basis === "probing" || mb.profile_basis === "fallback";
}

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
  // shows the intuitive command percentage, so its chart transforms every valid sample via the
  // same helper as liveData(). Out-of-range values remain gaps rather than being clamped.
  pump_speed: {
    unit: "%", ins: ["pump_signal"],
    ready: (h) => h.pump_signal,
    fn: (s) => pumpCommandPercent(s.pump_signal),
  },
  dt: {
    unit: "K", ins: ["leaving_water", "return_water"],
    ready: (h) => h.leaving_water && h.return_water,
    fn: (s) => (s.leaving_water == null || s.return_water == null ? null
                                                                  : s.leaving_water - s.return_water),
    mbIns: ["leaving_water", "return_water"],
    mbReady: (h) => h.leaving_water && h.return_water,
    mbFn: (s) => (s.leaving_water == null || s.return_water == null ? null
                                                                    : s.leaving_water - s.return_water),
  },
  // Water ρ·cp ≈ 4.186 kJ/l·K, flow in l/min — d.pth's formula, and SIGNED for its reason: during a
  // defrost the unit pulls heat back out of the water and the curve must show that, not a floor.
  // A stopped circuit with measured zero flow is zero transfer. With water still moving, however,
  // the compressor witness is mandatory: pump overrun can redistribute stored heat and a non-zero
  // arithmetic balance in that bucket is not heat-pump output (the same rule as thermalValue()).
  pth: {
    unit: "kW", ins: ["flow", "leaving_water", "return_water", "comp_rps"],
    ready: (h) => h.flow && h.leaving_water && h.return_water && h.comp_rps,
    fn: (s) => pthCalc(s, s.comp_rps != null && s.comp_rps > 5),
    mbIns: ["flow", "leaving_water", "return_water", "compressor_state"],
    mbReady: (h) => h.flow && h.leaving_water && h.return_water && h.compressor_state && !modbusFlowScaleUnverified(),
    mbFn: (s) => pthCalc(s, s.compressor_state != null && s.compressor_state > 0),
  },
};
const pthCalc = (s, run) => s.flow == null ? null : !(s.flow > 0.5) ? 0
  : s.leaving_water == null || s.return_water == null || !run ? null
  : (s.flow / 60) * 4.186 * (s.leaving_water - s.return_water);

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
const modbusEndpointId = () => {
  const mb = S.status?.modbus || {};
  return mb.host ? `${mb.host}:${mb.port || 502}:${mb.unit_id || 1}` : "";
};
const histCacheKey = (id, source) => {
  if (source === "modbus") {
    const mid = modbusHistRowId(id);
    const ep = modbusEndpointId();
    return ep ? `modbus:${ep}:${mid}` : `modbus:${mid}`;
  }
  return source === "env3" ? `env3:${id}` : id;
};
const histSourceClass = (source) => source === "modbus" ? " mb" : "";

function histX10aAvailable(h) {
  if (histX10aDown()) return false;
  const x10a = h.series?.find((s) => s.source === "x10a");
  return !!x10a && x10a.v.some((v) => v != null);
}

const histX10aDown = () => typeof x10aDown === "function" ? x10aDown() : S.status?.hp?.connected === false;

// Declarative state-block overlays painted behind numeric X10A curves when a paired binary state
// witness (such as Modbus compressor/pump running) is available alongside an active numeric ring.
const NUMERIC_STATE_OVERLAYS = Object.freeze({
  comp_rps: Object.freeze([
    { id: "compressor_state", source: "modbus", active: 10, cls: "mb" },
  ]),
  pump_speed: Object.freeze([
    { id: "pump_state", source: "modbus", active: 10, cls: "mb" },
  ]),
});
const numericStateOverlaySpecs = (id, scope = "") =>
  (NUMERIC_STATE_OVERLAYS[id] || []).filter((ov) => !scope || ov.source === scope);
const numericStateOverlayOffered = (ov) => ov.source === "modbus" ? hasModbusHist(ov.id)
  : ov.source === "env3" ? hasEnv3Hist(ov.id) : hasHist(ov.id);
const numericStateOverlayKey = (ov) => `overlay:${ov.source}:${ov.id}`;
const numericStateOverlaySourceName = (source) =>
  source === "modbus" ? "Modbus" : source === "env3" ? "ENV III" : "X10A";
const numericStateOverlayHidden = (id, ov) =>
  !!S.histHidden?.get(id)?.has(numericStateOverlayKey(ov));
const numericStateOverlayStateText = (ov, value) =>
  value === ov.active ? t("state.on") : value === 0 ? t("state.off") : "";
function numericStateOverlayRevision(id, scope = "") {
  const specs = numericStateOverlaySpecs(id, scope);
  if (!specs.length) return "";
  return specs.map((ov) => {
    const offered = numericStateOverlayOffered(ov);
    const ring = offered ? S.hist.get(histCacheKey(ov.id, ov.source)) : null;
    const live = typeof stateHistoryCurrent === "function" ? stateHistoryCurrent(ov.id, ov.source) : null;
    return [
      ov.source, ov.id, offered ? 1 : 0,
      historyRingRevision(ring),
      live?.present ? (live.value ?? "gap") : "absent",
      numericStateOverlayHidden(id, ov) ? "hidden" : "shown",
    ].join(":");
  }).join(",");
}
function numericStateOverlaysForView(view, scope = "") {
  const specs = numericStateOverlaySpecs(view.id, scope);
  if (!specs.length) return [];
  const out = [];
  for (const spec of specs) {
    const offered = numericStateOverlayOffered(spec);
    const raw = offered ? expireHistSamples(S.hist.get(histCacheKey(spec.id, spec.source))) : null;
    const live = typeof stateHistoryCurrent === "function"
      ? stateHistoryCurrent(spec.id, spec.source) : { present: false, value: null };
    const hasRecorded = !!raw && !raw.err && Array.isArray(raw.v) && raw.v.some((v) => v != null);
    const hasLive = !!(live.present && live.value != null);
    if (!(offered && (hasRecorded || hasLive)) && !hasLive) continue;
    const samples = view.v.map((_, j) => hasRecorded ? alignAuxSample(view, raw, j) : null);
    out.push({
      spec,
      id: spec.id,
      source: spec.source,
      cls: spec.cls ? " " + spec.cls : histSourceClass(spec.source),
      key: numericStateOverlayKey(spec),
      name: numericStateOverlaySourceName(spec.source),
      raw,
      samples,
      activeFlags: samples.map((v) => v === spec.active),
      live,
      hidden: numericStateOverlayHidden(view.id, spec),
    });
  }
  return out;
}

function histHiddenSet(h) {
  if (S.histHidden?.has(h.id)) {
    const saved = S.histHidden.get(h.id);
    if (!STATE_HIST[h.id] || !histX10aAvailable(h) || !saved.has("x10a")) return saved;
    const copy = new Set(saved);
    copy.delete("x10a");
    return copy;
  }
  if (!h.series || h.series.length <= 1 || !h.series.some((s) => s.source === "modbus")) {
    return new Set();
  }
  return h.series.some((s) => s.source === "x10a") && !histX10aAvailable(h)
    ? new Set(["x10a"]) : new Set();
}

function histVisibleSeries(h) {
  if (h.series.length === 1) return h.series;
  const hidden = histHiddenSet(h);
  const visible = h.series.filter((s) => !hidden.has(s.source));
  if (visible.some((s) => s.v.some((v) => v != null))) return visible;
  // A source can disappear or roll into an all-gap ring after a legend choice. Keep an available
  // curve visible without discarding either source's history or the user's saved browser choice.
  const fallback = h.series.find((s) => s.v.some((v) => v != null));
  return fallback ? h.series.filter((s) => visible.includes(s) || s === fallback)
    : visible.length ? visible : h.series;
}

// Include the lifetime and time anchor even when a new flat ring draws identical SVG geometry.
const histViewRevision = view =>
  [S.histEpoch, view.gen, view.t0, view.refreshFailed || view.aged, tankAuxRevision(view.tankAux),
    numericStateOverlayRevision(view.id, view.scope),
    histVisibleSeries(view).map(series => `${series.source}:${histRetained(series.raw) ? "retained" : "fresh"}`).join(",")].join("/");
function histRevision(view) {
  return ` data-rev="${esc(histViewRevision(view))}"`;
}

function histLegendHtml(h, s, cls) {
  const visible = histVisibleSeries(h);
  const shown = visible.includes(s);
  const last = shown && histLegendLast(h, visible, s);
  return `<button type="button" class="vhist-source${cls}" data-hist-id="${esc(h.id)}" ` +
    `data-hist-series="${esc(s.source)}" aria-pressed="${shown}"${last ? " disabled" : ""}>` +
    `<i></i>${esc(histSeriesLabel(s))}</button>`;
}

function histLegendLast(h, visible, s) {
  if (STATE_HIST[h.id] && s.source === "x10a" && histX10aAvailable(h)) return true;
  const withSamples = visible.filter(q => q.v.some(v => v != null));
  if (withSamples.length === 0) return visible.length <= 1;
  return withSamples.length === 1 && withSamples[0] === s;
}

function histSeriesLabel(series) {
  return series.name;
}

function lastSample(values, end = values.length) {
  while (end > 0) {
    if (values[--end] != null) return end;
  }
  return -1;
}

function histRetainedMarker(series, fraction, cls = "", top = 50) {
  const label = esc(`${series.name} · ${t("hist.retained")}`);
  return `<span class="vhist-mark vhist-retained${cls}" role="img" aria-label="${label}" ` +
    `style="left:${(fraction * 100).toFixed(3)}%;top:${top.toFixed(2)}%"></span>`;
}

function histSeriesToggle(id, source) {
  const h = historyView(id);
  const overlay = h?.stateOverlays?.find((ov) => ov.key === source);
  if (overlay) {
    const hidden = new Set(histHiddenSet(h));
    if (overlay.hidden) hidden.delete(source); else hidden.add(source);
    cancelHistoryGesture();
    S.histHidden.set(id, hidden);
    S.clickHold = false;
    S.inspHistSig = null;
    renderTrendHosts();
    return;
  }
  const s = h?.series?.find((q) => q.source === source);
  if (!s) return;
  const visible = histVisibleSeries(h);
  const shown = visible.includes(s);
  if (shown && histLegendLast(h, visible, s)) return;
  const hidden = new Set(histHiddenSet(h));
  if (shown) hidden.add(source); else hidden.delete(source);
  cancelHistoryGesture();
  S.histHidden.set(id, hidden);
  const pin = S.histPin.get(id);
  if (pin && !pin.source && histPinIndex(id, h) < 0) S.histPin.delete(id);
  S.clickHold = false;
  S.inspHistSig = null;
  renderTrendHosts();
}
// A reply refused for its source identity (a newer history epoch or boot than the last /status, or
// the firmware's own "history changed" 503) waits for the next /status lifetime or one status
// period, whichever comes first. renderApp re-enters ensureHist, so retrying at once only repeated
// the refusal as a back-to-back /history loop on the single httpd task. One status period mirrors
// bootstrap.js POLL_STATUS_MS without depending on that later bundle fragment.
const HIST_IDENTITY_WAIT_MS = 8000;
const histAwaiting = (key, epoch) => {
  const waiting = S.histAwait?.get(key);
  return !!waiting && waiting.epoch === epoch && Date.now() - waiting.at < HIST_IDENTITY_WAIT_MS;
};
function ensureHist(id, source = "x10a", mode = "open") {
  const epoch = syncHistSources();
  const key = histCacheKey(id, source);
  const derived = (source === "x10a" && !!DERIVED[id]) || (source === "modbus" && !!DERIVED[id]?.mbIns);
  const offered = source === "modbus" ? hasModbusHist(id)
    : source === "env3" ? hasEnv3Hist(id) : hasHist(id);
  if (!offered) return;
  if (S.histBusy.has(key)) return S.histRequests.get(key)?.done;
  if (histAwaiting(key, epoch)) return;
  const c = S.hist.get(key);
  const cooldown = c?.refreshFailed && derived ? 8000 : 60000;
  if (c && Date.now() - c.at < cooldown) return;
  if (derived) {
    if (mode === "refresh") {
      // Advance one raw input per poll. Assemble only when no input needs a transport.
      const ins = source === "modbus" ? DERIVED[id].mbIns : DERIVED[id].ins;
      const hasInput = source === "modbus" ? hasDeviceModbusHist : hasDeviceHist;
      for (const input of ins) {
        if (!hasInput(input)) continue;
        const started = ensureHist(input, source);
        if (started) return started;
      }
    }
    return ensureDerived(id, source);
  }
  return fetchHistory(id, source, key, epoch, c);
}

let historyTransport = null;
const HIST_MAX_SAMPLES = 288;  // Firmware HISTORY_SAMPLES at its five-minute cadence

function fetchHistory(id, source, key, epoch, previous) {
  const request = { run: () => readHistory(id, source, key, epoch, previous, request) };
  request.done = new Promise(resolve => { request.finish = resolve; });
  (S.histRequests ||= new Map()).set(key, request);
  S.histBusy.add(key);
  pumpHistoryQueue();
  return request.done;
}

function pumpHistoryQueue() {
  if (historyTransport || (typeof _pollBusy !== "undefined" && _pollBusy)) return;
  for (const request of S.histRequests?.values() || []) {
    if (!request.run) continue;
    historyTransport = request;
    request.active = request.run();
    break;
  }
}

function yieldHistoryToPoll() {
  if (!historyTransport?.controller) return;
  const { controller, active, retried } = historyTransport;
  // The first poll takes precedence. The retried read gets its own bounded timeout so a
  // response slower than one poll interval can still complete without concurrent requests.
  if (retried) return active;
  historyTransport.yielded = true;
  controller.abort();
  return active;
}

function validHistoryHeld(ranges, samples) {
  if (!Array.isArray(ranges) || ranges.length > Math.ceil(samples.length / 2)) return false;
  let end = 0;
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [from, count] = range;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(count) || from < end ||
        count <= 0 || from + count > samples.length) return false;
    end = from + count;
    for (let i = from; i < end; i++) if (samples[i] !== null) return false;
  }
  return true;
}

const X10A_HELD_HISTORY = new Set(["outdoor_air", "outdoor_heat_exchanger", "discharge",
  "circuit_pressure", "inv_current", "pel", "cop"]);

// A 288-sample response plus the maximally fragmented held map and escaped labels fits below 4 KiB.
// Bound decoded bytes before parsing, including when the firmware uses chunked transfer.
async function readHistoryJson(response) {
  if (!response.body) throw new Error("History response has no body");
  const limit = 4096;
  const bytes = new Uint8Array(limit);
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        void reader.cancel().catch(() => {});
        throw new Error("History response exceeds its wire budget");
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
}

function validHistoryBucket(start, count) {
  if (start == null) return true;
  if (!Number.isSafeInteger(start) || start < -HIST_MAX_SAMPLES ||
      start > Number.MAX_SAFE_INTEGER - HIST_MAX_SAMPLES || !count || start + count < 0)
    return false;
  const uptime = S.status?.uptime_s;
  if (!Number.isFinite(uptime) || S.otaCached) return true;
  const now = historyBrowserTime();
  const seconds = Math.max(0, now - (S.statusRequestedAt ?? S.statusReceivedAt ?? now)) / 1000;
  // The device cannot have sampled uptime before the status request began. Use that earliest
  // instant for the upper bound and allow one second for integer uptime.
  return start + count <= Math.floor((uptime + seconds + 1) / 300);
}

function validHistoryTime(start, bootBucket, count, deviceTime = historyDeviceTime()) {
  if (start == null || !count) return true;
  // A restored ring without a monotonic anchor needs an accepted device clock for alignment.
  if (!Number.isFinite(deviceTime)) return false;
  const last = start + (count - 1) * 300;
  const uptime = S.status?.uptime_s;
  if (Number.isInteger(bootBucket) && Number.isFinite(uptime)) {
    const expected = deviceTime - (uptime + historyStatusElapsed()) + (bootBucket + count) * 300;
    if (Math.abs(last - expected) > 2 + POLL_TIMEOUT_MS / 1000) return false;
  }
  return last <= deviceTime + 1 + POLL_TIMEOUT_MS / 1000 &&
    last >= deviceTime - HIST_MAX_SAMPLES * 300;
}

async function readHistory(id, source, key, epoch, previous, request) {
  const sourceId = source === "modbus" ? (modbusEndpointId() || "modbus") : source;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), POLL_TIMEOUT_MS) : null;
  request.controller = controller;
  request.run = null;
  const failed = () => ({
    ...(previous && !previous.err && previous.v.some(v => v != null)
      ? previous : { gen: previous?.gen || 0, source, sourceId, err: true, v: [] }),
    at: Date.now(), refreshFailed: true,
  });
  try {
    const wireId = source === "modbus" ? modbusHistRowId(id) : id;
    const suffix = source === "modbus" ? "&source=modbus"
      : source === "env3" ? "&source=env3" : "";
    const r = await fetch("/history?row=" + encodeURIComponent(wireId) + suffix,
                          controller ? { signal: controller.signal } : undefined);
    const j = await readHistoryJson(r);
    if (syncHistSources() !== epoch || S.histRequests.get(key) !== request) return;
    // A JSON refusal that is not a history change (no snapshot identity, an unknown row) is an
    // error for this cache period, not a reason to re-ask every status period; only "history
    // changed" waits for the next status lifetime below.
    const changed = j?.ok === false && j.error === "history changed; retry";
    const expectedSource = id === "circulation_state" && source === "x10a" ? "mqtt" : source;
    const expectedEpoch = S.status?.history?.epoch;
    const expectedBoot = S.status?.boot_id;
    const legacy = !Number.isInteger(expectedEpoch) && j?.id === undefined && j?.source === undefined;
    const bucket = j?.b0 ?? j?.boot_b0;
    const time = j?.t0;
    const wallTimeShape = time == null ||
      (Number.isSafeInteger(time) && Math.abs(time) <= 8.64e12 - HIST_MAX_SAMPLES * 300);
    const wallTimeValid = wallTimeShape && validHistoryTime(time, bucket, Array.isArray(j?.v) ? j.v.length : 0);
    if (!changed && (r.ok === false || j?.ok === false || !Array.isArray(j?.v) ||
        j.v.length > HIST_MAX_SAMPLES || j.v.some(v => v !== null &&
          (!Number.isInteger(v) || v < -32766 || v > 32767)) ||
        (!legacy && (j.id !== wireId || j.source !== expectedSource || j.dt !== 300)) ||
        (j.label != null && (typeof j.label !== "string" || j.label.length > 79)) ||
        (j.unit != null && (typeof j.unit !== "string" || j.unit.length > 7)) ||
        (j.dt != null && j.dt !== 300) ||
        (j.b0 != null && (j.b0 < 0 || j.boot_b0 != null)) ||
        (j.boot_b0 != null && !(j.boot_b0 < 0)) ||
        !validHistoryBucket(bucket, j.v.length) ||
        !wallTimeShape ||
        (!wallTimeValid && bucket == null) ||
        (j.held != null && (!validHistoryHeld(j.held, j.v) ||
          (j.held.length > 0 && (expectedSource !== "x10a" || !X10A_HELD_HISTORY.has(id))))))) {
      S.hist.set(key, failed());
      return;
    }
    // /status owns the source lease. A reply composed after an unseen reset or reboot must wait
    // for that status lifetime before becoming a chart; a recent fetch alone proves no identity.
    if (changed || (Number.isInteger(expectedEpoch) && j.epoch !== expectedEpoch) ||
        (typeof expectedBoot === "string" && j.boot_id !== expectedBoot)) {
      (S.histAwait ||= new Map()).set(key, { epoch, at: Date.now() });
      return;
    }
    S.histAwait?.delete(key);
    // t0 = the unix instant of sample 0, present only when the device's SNTP clock is synced. Null
    // means the scrub readout falls back to an AGE ("vor 6.3 h") — never a fabricated wall-clock
    // time, the same rule logic/timestamp.hpp applies to an unsynced clock on the firmware side.
    // `gen` counts fetches. An index pin without a boot-relative bucket is only valid for the
    // exact series it was made on, and a refetch may have
    // rolled the ring — so it is dropped rather than re-pointed at a different sample.
    const gen = ((previous || {}).gen || 0) + 1;
    // A few legacy X10A rows carry their unit only in the catalog label. Normalise that at the
    // visual boundary too, otherwise the live row can say "22.8 L/min" while its own trend and
    // crosshair still say just "22.8". The API remains byte-for-byte compatible.
    const receivedAt = Date.now();
    const receivedDeviceTime = historyDeviceTime();
    const device = { at: receivedAt, receivedAt, receivedTick: historyBrowserTime(), receivedDeviceTime,
                     gen, source, sourceId,
                     dt: 300,
                     unit: displayUnit(j),
                     label: typeof j.label === "string" ? j.label : "",
                     t0: wallTimeValid ? time ?? null : null,
                     b0: Number.isSafeInteger(bucket) ? bucket : null,
                     held: Array.isArray(j.held) ? j.held : [],
                     v: j.v };
    S.hist.set(key, device);
  } catch (e) {
    if (syncHistSources() === epoch && S.histRequests.get(key) === request) {
      if (request.yielded && !request.retried) {
        request.yielded = false;
        request.retried = true;
        request.controller = null;
        request.run = () => readHistory(id, source, key, epoch, previous, request);
      } else S.hist.set(key, failed());
    }
  } finally {
    if (timer != null) clearTimeout(timer);
    historyTransport = null;
    // An obsolete request must not release a successor using the same cache key.
    if (!request.run) {
      request.finish();
      if (S.histRequests.get(key) === request) {
        S.histRequests.delete(key);
        S.histBusy.delete(key);
        renderApp();
      }
    }
    pumpHistoryQueue();
  }
}

// Explicit disclosure may queue independent rings together. The shared transport reads them in
// order. A background refresh can enqueue only one request. Derived charts use X10A inputs.
function ensureHistPair(id, mode = "open") {
  // A repaint needs no result from a request that is already running. Derived charts can still
  // await their own inputs directly through ensureHist.
  if (mode !== "open" && S.histBusy.size) return;
  const requests = [];
  const request = (row, source, offered) => {
    const key = histCacheKey(row, source);
    if (!offered || S.histBusy.has(key) || (mode !== "open" && requests.length)) return;
    const started = ensureHist(row, source, mode);
    if (started) requests.push(started);
  };
  request(id, "x10a", hasHist(id));
  request(id, "modbus", hasModbusHist(id));
  request(id, "env3", hasEnv3Hist(id));
  if (id === "dhw_tank") {
    for (const row of ["smart_grid_mode", "bsh_state"]) {
      request(row, "x10a", hasHist(row));
      request(row, "modbus", hasModbusHist(row));
    }
  }
  for (const ov of numericStateOverlaySpecs(id)) {
    request(ov.id, ov.source, numericStateOverlayOffered(ov));
  }
  if (requests.length) return Promise.all(requests);
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
async function ensureDerived(id, source = "x10a") {
  const epoch = syncHistSources();
  const D = DERIVED[id];
  const isMb = source === "modbus";
  if (isMb && !hasModbusHist(id)) return;
  const key = histCacheKey(id, source);
  if (S.histBusy.has(key)) return S.histRequests.get(key)?.done;
  if (histAwaiting(key, epoch)) return;
  const previous = S.hist.get(key);
  const previousGen = previous?.gen || 0;
  const failed = () => previous && !previous.err && previous.v.some(v => v != null)
    ? { ...previous, at: Date.now(), refreshFailed: true }
    : { at: Date.now(), gen: previousGen, err: true, v: [] };
  let finish;
  const request = { epoch, done: new Promise((resolve) => { finish = resolve; }) };
  (S.histRequests ||= new Map()).set(key, request);
  S.histBusy.add(key);
  try {
    const ins = isMb ? D.mbIns : D.ins;
    const hasInput = isMb ? hasDeviceModbusHist : hasDeviceHist;
    const fn = isMb ? D.mbFn : D.fn;
    const use = ins.filter(hasInput);
    await Promise.all(use.map((k) => ensureHist(k, source)));
    if (syncHistSources() !== epoch || S.histRequests.get(key) !== request) return;
    // An input refused for its source identity is pending, not failed: wait with it rather than
    // caching "Trend unavailable." for up to one status period. Marking the derived id as awaiting
    // too keeps the finally-block render from re-entering this function at once.
    if (use.some(k => histAwaiting(histCacheKey(k, source), epoch))) {
      (S.histAwait ||= new Map()).set(key, { epoch, at: Date.now() });
      return;
    }
    // Keep transport failures separate from gaps in a successfully fetched ring.
    const rings = use.map(k => [k, S.hist.get(histCacheKey(k, source))]);
    if (rings.some(([, h]) => !h || h.err || h.refreshFailed)) {
      S.hist.set(key, failed());
      return;
    }
    const src = rings.filter(([, h]) => h.v.length).map(([k, h]) => [k, expireHistSamples(h)]);
    const inputs = JSON.stringify([use, src.map(([k, h]) => [k, h.gen, h.expired || 0])]);
    if (previous && previous.inputs === inputs) {
      S.hist.set(key, { ...previous, at: Date.now(), refreshFailed: false });
      return;
    }
    if (!src.length) {
      S.hist.set(key, { at: Date.now(), gen: previousGen + 1, inputs, v: [] });
      return;
    }
    const dt = src[0][1].dt || 300;
    let start = 0, end = 0, mode = "tail";
    if (src.every(([, h]) => Number.isInteger(h.b0))) {
      mode = "bucket";
      start = Math.min(...src.map(([, h]) => h.b0));
      end = Math.max(...src.map(([, h]) => h.b0 + h.v.length - 1));
    } else if (src.length === 1 && Number.isSafeInteger(src[0][1].t0)) {
      mode = "time";
      start = Math.min(...src.map(([, h]) => h.t0));
      end = Math.max(...src.map(([, h]) => h.t0 + (h.v.length - 1) * dt));
    } else if (src.some(([, h]) => h.b0 != null || h.t0 != null)) {
      // A wall-clock correction between requests can shift timestamps by a full bucket.
      S.hist.set(key, { at: Date.now(), gen: previousGen + 1, inputs, v: [] });
      return;
    } else {
      end = Math.max(...src.map(([, h]) => h.v.length)) - 1;
    }
    const step = mode === "time" ? dt : 1;
    const span = (end - start) / step + 1;
    const n = Math.min(span, HIST_MAX_SAMPLES);
    start += (span - n) * step;
    const sourceIndex = (h, i) => mode === "bucket" ? start + i - h.b0
      : mode === "time" ? (start + i * dt - h.t0) / dt
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
      const out = fn(s);
      v.push(out == null || !Number.isFinite(out) ? null : Math.round(out * 10));
      // A gap inherits its REASON, and only when EVERY missing input carries it: "the outdoor unit
      // was resting" is a statement that nothing failed, so one input that genuinely failed to
      // measure has to outrank it. Blaming an idle compressor for a real dropout is the same class
      // of wrong here as it is on the pill — and internal slot metadata retains the distinction for
      // witnessed pin preservation.
      if (out == null && missing > 0 && heldMissing === missing) {
        const last = heldRuns[heldRuns.length - 1];
        if (last && last[0] + last[1] === i) last[1]++; else heldRuns.push([i, 1]);
      }
    }
    const gen = previousGen + 1;
    const wall = src.find(([, h]) => typeof h.t0 === "number");
    const t0 = mode === "time" ? start
      : mode === "bucket" && wall ? wall[1].t0 - (wall[1].b0 - start) * dt : null;
    const b0 = mode === "bucket" ? start : null;
    const receivedAt = Date.now();
    S.hist.set(key, { at: receivedAt, receivedAt, receivedTick: historyBrowserTime(),
                     receivedDeviceTime: historyDeviceTime(), gen, inputs, dt, unit: D.unit,
                     t0: typeof t0 === "number" ? t0 : null,
                     b0: Number.isInteger(b0) ? b0 : null,
                     held: heldRuns, v });
  } catch (e) {
    if (syncHistSources() === epoch && S.histRequests.get(key) === request)
      S.hist.set(key, failed());
  } finally {
    finish();
    if (S.histRequests.get(key) === request) {
      S.histRequests.delete(key);
      S.histBusy.delete(key);
      renderApp();
    }
  }
}

// The plot's own coordinate system. The SVG stretches to the panel width (preserveAspectRatio
// "none"), so the path is drawn in these units and the stroke is kept honest with
// vector-effect="non-scaling-stroke" — otherwise a wide panel would smear the line horizontally.
// No internal padding: the geometry uses the full box and the container lets the stroke overflow,
// which keeps the "now" marker's percentage mapping (below) exactly the plot's own scale.
const HIST_W = 320, HIST_H = 88;

// The plot's vertical scale, derived once and shared by the renderer AND the cursor. It used to be
// computed in both places, which is a two-copy invariant of the worst kind: a change to the padding
// in one would leave the crosshair marker sitting off the line it is pointing at, and the drawing
// would still look perfectly plausible. Returns the mapping, not the numbers, so no caller can
// re-derive it slightly differently.
function histScale(pts, sampleCount, id = "") {
  const real = pts.filter((x) => x != null);
  const lo = Math.min(...real), hi = Math.max(...real);
  const isPressure = id === "water_pressure";
  const span = hi - lo;
  const pad = span < 1 ? 1 : span * 0.12;           // a flat series gets a band, not a divide-by-zero
  const y0 = isPressure ? Math.min(0, lo - pad) : lo - pad;
  const y1 = isPressure ? Math.max(2.2, hi + Math.max(0.25, hi * 0.12)) : hi + pad;
  const n = sampleCount || pts.length;
  return {
    lo, hi, y0, y1,
    X: (i) => (n === 1 ? HIST_W : (i * HIST_W) / (n - 1)),
    Y: (v) => HIST_H - ((v - y0) / (y1 - y0)) * HIST_H,
  };
}

const histTickFormatters = new Map();
function histTickFormat(v, step) {
  const num = Math.abs(v) < 1e-9 ? 0 : v;
  let minFrac = 0, maxFrac = 0;
  if (step < 1) {
    if (Math.abs(step * 10 - Math.round(step * 10)) < 1e-6) {
      minFrac = 1; maxFrac = 1;
    } else {
      maxFrac = 2;
    }
  } else if (Math.abs(step - Math.round(step)) >= 1e-6) {
    maxFrac = 1;
  }
  const key = `${LANG}:${minFrac}:${maxFrac}`;
  let fmt = histTickFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LANG, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
    histTickFormatters.set(key, fmt);
  }
  return fmt.format(num);
}

function histNiceTicks(y0, y1, Y, height = HIST_H, { integer = false, avoidY = [] } = {}) {
  const span = y1 - y0;
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, ticks: [] };
  const minY = 7, maxY = height - 7, minGapPx = 16;
  const bases = integer ? [1, 2, 5] : [1, 2, 2.5, 5];
  const mag = 10 ** Math.floor(Math.log10(span / 4));
  const steps = [...new Set([0.1, 1, 10].flatMap((e) =>
    bases.map((b) => Number((b * mag * e).toPrecision(12)))
  ))].filter((s) => s > 0 && (!integer || (s >= 1 && Math.abs(s - Math.round(s)) < 1e-6)))
    .sort((a, b) => a - b);
  let best = null;
  for (const step of steps) {
    const start = Math.ceil((y0 - 1e-9) / step) * step;
    const ticks = [];
    let spaced = true;
    for (let k = 0; k < 64; k++) {
      const raw = start + k * step;
      if (raw > y1 + 1e-9) break;
      const v = Math.abs(raw) < step * 1e-6 ? 0 : Number(raw.toPrecision(12)) || 0;
      const y = Y(v);
      if (y < minY || y > maxY) continue;
      if (avoidY.some((ay) => Math.abs(y - ay) < 12)) continue;
      if (ticks.length && Math.abs(ticks[ticks.length - 1].y - y) < minGapPx) {
        spaced = false;
        break;
      }
      ticks.push({ v, y });
    }
    if (!spaced || !ticks.length) continue;
    if (ticks.length >= 3 && ticks.length <= 4) return { step, ticks };
    if (!best || (ticks.length === 2 && best.ticks.length !== 2) ||
        (best.ticks.length === 1 && ticks.length > 1)) {
      best = { step, ticks };
    }
  }
  return best || { step: 1, ticks: [] };
}

function histYGridHtml(scale, unit, { avoidY = [], labelCls = "", height = HIST_H, width = HIST_W } = {}) {
  const { step, ticks } = histNiceTicks(scale.y0, scale.y1, scale.Y, height, { avoidY });
  let svg = "", labels = "";
  for (const tick of ticks) {
    const text = histTickFormat(tick.v, step) + (unit ? " " + unit : "");
    svg += `<line class="vhist-grid" x1="0" y1="${tick.y.toFixed(1)}" x2="${width}" y2="${tick.y.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
    labels += `<span class="vhist-y-label${labelCls ? " " + labelCls : ""} num" style="top:${tick.y.toFixed(1)}px">${esc(text)}</span>`;
  }
  return { svg, yAxis: labels ? `<div class="vhist-y" aria-hidden="true">${labels}</div>` : "" };
}

const PRESSURE_LOW_BAR = 1.0;
const PRESSURE_CRIT_BAR = 0.5;
function pressureZoneClass(v) {
  return v <= PRESSURE_CRIT_BAR ? " err" : v <= PRESSURE_LOW_BAR ? " warn" : "";
}
function pressureSplitRun(run, pts, X, Y) {
  const out = [];
  const pushSeg = (zone, x0, y0, x1, y1) => {
    const prev = out[out.length - 1];
    if (prev && prev.zone === zone) prev.pts.push([x1, y1]);
    else out.push({ zone, pts: [[x0, y0], [x1, y1]] });
  };
  for (let k = 0; k < run.length - 1; k++) {
    const i0 = run[k], i1 = run[k + 1];
    const x0 = X(i0), v0 = pts[i0], x1 = X(i1), v1 = pts[i1];
    const cuts = [];
    for (const thr of [PRESSURE_LOW_BAR, PRESSURE_CRIT_BAR]) {
      if ((v0 > thr && v1 < thr) || (v0 < thr && v1 > thr)) {
        const frac = (thr - v0) / (v1 - v0);
        cuts.push([frac, x0 + frac * (x1 - x0), thr]);
      }
    }
    cuts.sort((a, b) => a[0] - b[0]);
    let px = x0, pv = v0;
    for (const [, cx, cv] of cuts) {
      pushSeg(pressureZoneClass((pv + cv) / 2), px, Y(pv), cx, Y(cv));
      px = cx; pv = cv;
    }
    pushSeg(pressureZoneClass((pv + v1) / 2), px, Y(pv), x1, Y(v1));
  }
  return out;
}

const ENV3_COMBINED_ID = "env3_combined";
const env3ChartId = id => id === ENV3_COMBINED_ID;
const ENV3_COMBINED_SERIES = Object.freeze(
  ["temperature", "humidity", "pressure"].map((k) => ({ id: "env3_" + k, label: "env." + k }))
);
// The boot raster is authoritative even before SNTP. A wall-only ring has its own axis.
// Legacy rings without either anchor retain the relative tail view.
function alignedHistoryView(id, raw) {
  const supplied = raw;
  // An expired ring can still describe a refused refresh, but it cannot anchor its peers.
  raw = raw.map(s => ({ ...s, h: expireHistSamples(s.h) }))
    .filter((s) => s.h && !s.h.err && Array.isArray(s.h.v) &&
      s.h.v.length > (s.h.expired || 0));
  if (!raw.length) return null;

  const dt = raw[0].h.dt || 300;
  let start = 0, end = 0, mode = "tail";
  if (raw.every((s) => Number.isInteger(s.h.b0))) {
    mode = "bucket";
    start = Math.min(...raw.map((s) => s.h.b0 + (s.h.expired || 0)));
    end = Math.max(...raw.map((s) => s.h.b0 + s.h.v.length - 1));
  } else if (raw.every((s) => Number.isSafeInteger(s.h.t0) && (s.h.dt || 300) === dt)) {
    mode = "time";
    start = Math.min(...raw.map((s) => s.h.t0 + (s.h.expired || 0) * dt));
    end = Math.max(...raw.map((s) => s.h.t0 + (s.h.v.length - 1) * dt));
  } else {
    end = Math.max(...raw.map((s) => s.h.v.length - (s.h.expired || 0))) - 1;
  }
  const step = mode === "time" ? dt : 1;
  const span = mode === "tail" ? end + 1 : Math.round((end - start) / step) + 1;
  const n = Math.min(span, HIST_MAX_SAMPLES);
  start = mode === "time" ? end - (n - 1) * dt : start + (span - n) * step;
  const series = raw.map((s) => {
    const off = mode === "bucket" ? s.h.b0 - start
              : mode === "time" ? Math.round((s.h.t0 - start) / dt)
              : n - s.h.v.length;
    const v = Array(n).fill(null), heldFlags = Array(n).fill(false);
    for (let i = Math.max(0, -off); i < Math.min(s.h.v.length, n - off); i++) {
      v[off + i] = s.h.v[i];
      heldFlags[off + i] = histHeld(s.h, i);
    }
    return { source: s.source, name: s.name, unit: s.h.unit || "", v, offset: off,
             held: boolRuns(heldFlags), raw: s.h };
  });
  const primary = series.find((s) => s.source === "x10a") ||
                  series.find((s) => s.source === "env3") || series[0];
  const wall = raw.find((s) => historyWallLabelAllowed(s.h));
  // A relative overlay must never assign one instrument's wall clock to another.
  const t0 = mode === "time" ? (wall ? start : null)
           : mode === "bucket" && wall ? wall.h.t0 - (wall.h.b0 - start) * dt : null;
  const union = Array.from({ length: n }, (_, i) => {
    const found = series.find((s) => s.v[i] != null);
    return found ? found.v[i] : null;
  });
  // Some X10A rows spell their unit inside the label (notably flow) while HomeHub carries it as a
  // field. Prefer the primary source's unit, but do not throw away the paired source's honest unit
  // merely because X10A's field is empty.
  const sharedUnit = primary.unit || series.find((s) => s.unit)?.unit || "";
  const withSamples = series.filter(s => s.v.some(v => v != null));
  const unavailable = supplied.filter(s => s.h?.err ||
    (s.h?.refreshFailed && !withSamples.some(available => available.source === s.source)));
  const displayed = withSamples.length ? withSamples : series;
  return { id, dt, unit: sharedUnit, t0: typeof t0 === "number" ? t0 : null,
           b0: mode === "bucket" ? start : null,
           refreshFailed: withSamples.length > 0 && withSamples.every(s => s.raw.refreshFailed),
           aged: displayed.every(s => histRetained(s.raw)),
           unavailable,
           gen: series.map((s) => `${s.source}:${s.raw.gen || 0}${s.raw.expired ? "/" + s.raw.expired : ""}`).join("/"),
           v: union, series };
}

const historyBrowserTime = () => typeof historyClock === "function" ? historyClock() : Date.now();
const historyElapsed = h => Math.max(0, h.receivedTick == null
  ? Date.now() - (h.receivedAt ?? Date.now()) : historyBrowserTime() - h.receivedTick);
const historyStatusElapsed = (now = historyBrowserTime()) =>
  Math.max(0, now - (S.statusReceivedAt ?? now)) / 1000;

function historyDeviceTime(retained = false) {
  if (S.otaCached || !S.status?.ntp?.synced ||
      (!retained && S.transportUnavailable === "status"))
    return Number.NaN;
  return Date.parse(S.status.ntp.time || "") / 1000 + historyStatusElapsed();
}

const historyExpiry = new WeakMap();
function expiredHistSlots(h) {
  if (!h?.v.length) return 0;
  const elapsed = historyElapsed(h) / 1000;
  const statusElapsed = S.otaCached ? 0 : historyStatusElapsed();
  const dt = h.dt || 300;
  let current = Math.floor(elapsed / dt) + h.v.length;
  let start = 0;
  if (Number.isInteger(h.b0)) {
    start = h.b0;
    const uptime = S.status?.uptime_s;
    current = Math.max(current + start, Number.isFinite(uptime) ? Math.floor((uptime + statusElapsed) / dt) : start);
  } else if (h.t0 != null) {
    const clock = historyDeviceTime(true);
    const receivedClock = h.receivedDeviceTime + elapsed;
    const deviceTime = Math.max(Number.isFinite(clock) ? clock : -Infinity,
      Number.isFinite(receivedClock) ? receivedClock : -Infinity);
    // Receipt can precede the newest dated sample within the poll tolerance.
    current = Math.ceil((deviceTime - h.t0) / dt);
  }
  // A corrected clock or a delayed status reply cannot bring back expired cached samples.
  const expired = Math.max(historyExpiry.get(h.v) || 0,
    Math.min(h.v.length, current - HIST_MAX_SAMPLES - start));
  if (expired) historyExpiry.set(h.v, expired);
  return expired;
}

const historyRingAged = (h, expired) => expired > 0 ||
  (h.v.length > 0 && historyElapsed(h) >= (h.dt || 300) * 1000);

function expireHistSamples(h) {
  if (!h?.v.length) return h;
  const expired = expiredHistSlots(h);
  const aged = historyRingAged(h, expired);
  if (!expired) return aged ? { ...h, aged } : h;
  // Preserve the existing time and index identity while dropping readings outside the window.
  const held = h.held?.flatMap(([from, count]) =>
    from + count > expired ? [[Math.max(expired, from), from + count - Math.max(expired, from)]] : []);
  return { ...h, aged, expired, held, v: h.v.map((v, i) => i < expired ? null : v) };
}

const histRetained = h => h.refreshFailed || h.aged;
function historyWallLabelAllowed(h) {
  if (!Number.isFinite(h.t0)) return false;
  const clock = historyDeviceTime(true);
  if (!Number.isInteger(h.b0) || !Number.isFinite(clock)) return true;
  return validHistoryTime(h.t0, h.b0, h.v.length, clock);
}

function historyRingRevision(h) {
  if (!h || h.err || !Array.isArray(h.v)) return h ? "error" : "";
  const expired = expiredHistSlots(h);
  return `${h.gen}:${h.refreshFailed ? "failed" : ""}:${historyRingAged(h, expired) ? "aged" : ""}:${expired}:${historyWallLabelAllowed(h)}`;
}

function historyView(id, source = "") {
  if (env3ChartId(id)) {
    const offered = ENV3_COMBINED_SERIES.filter(s => hasEnv3Hist(s.id)).map((s) => ({
      source: s.id, name: t(s.label), h: S.hist.get(histCacheKey(s.id, "env3")),
    }));
    return alignedHistoryView(id, offered);
  }
  const x10aName = id === "circulation_state" ? "MQTT" : "X10A";
  const offered = [
    { source: "x10a", name: x10aName, h: hasHist(id) ? S.hist.get(id) : null },
    { source: "modbus", name: "Modbus", h: hasModbusHist(id) ? S.hist.get(histCacheKey(id, "modbus")) : null },
    { source: "env3", name: "ENV III", h: hasEnv3Hist(id) ? S.hist.get(histCacheKey(id, "env3")) : null },
  ].filter((s) => !source || s.source === source);
  let view = alignedHistoryView(id, offered);
  if (view) view.scope = source;
  if (view && id === "dhw_tank") view.tankAux = tankAuxHistories();
  if (!STATE_HIST[id]) {
    if (view) view.stateOverlays = numericStateOverlaysForView(view, source);
    return view;
  }
  if (!view?.v.some(v => v != null)) {
    const live = offered.filter(s => (s.source === "x10a" ? hasHist(id) : hasModbusHist(id)) &&
      stateHistoryCurrent(id, s.source).value != null);
    if (!live.length) return null;
    view = { id, scope: source, dt: 300, t0: null, gen: "live", v: [], series: live.map(s => ({
      source: s.source, name: s.name, v: [], raw: {},
    })), unavailable: offered.filter(s => s.h?.err || s.h?.refreshFailed) };
  } else {
    for (const s of offered) {
      const supported = s.source === "x10a" ? hasHist(id) : s.source === "modbus" && hasModbusHist(id);
      if (supported && !view.series.some(series => series.source === s.source) &&
          stateHistoryCurrent(id, s.source).value != null)
        view.series.push({ source: s.source, name: s.name, v: Array(view.v.length).fill(null), raw: {} });
    }
  }
  return stateHistoryLiveView(view);
}

// Categorical states need timelines, not numeric curves. Every valid state gets an explicit level,
// legend entry and coloured span; hatching is reserved for no answer. Exact phase intervals belong
// in the chart's hover/touch/keyboard tooltip instead of a second textual list below the same graph.
// Paired states
// draw one outlined lane per source, so colour means STATE while the outline/label means SOURCE.
// Durations are explicitly sampled RASTER time. Event-folded BSH, BUH and defrost buckets keep an ON
// observed during a five-minute bucket; they are not presented as second-accurate runtime.
const isBinTenths = (v) => v === 0 || v === 10;
const binStateHist = (primary, cls, extra = {}) => {
  const active = extra.active || "state.on", inactive = extra.inactive || "state.off";
  return {
    classify: (v) => isBinTenths(v) ? v === 10 : null,
    primary, run: "hist.state_phase_run", active, inactive,
    levels: [
      { match: (v) => isBinTenths(v) ? v === 0 : null, cls: extra.offCls || "state-off", label: inactive },
      { match: (v) => isBinTenths(v) ? v === 10 : null, cls, label: active },
    ],
    ...extra,
  };
};
const namedBinHist = (primary, cls, p, onOff = false, extra = {}) => binStateHist(primary, cls, {
  total: `hist.${p}_total`, aria: `hist.${p}_aria`,
  active: `hist.${p}_${onOff ? "on" : "active"}`,
  inactive: `hist.${p}_${onOff ? "off" : "inactive"}`,
  ...(onOff === "compact" ? { compactValueLabel: (v) => v === 0 ? `hist.${p}_off` : v === 10 ? `hist.${p}_on` : "" } : {}),
  ...extra,
});
const enumStateHist = (primary, levels, extra = {}) => {
  const byVal = new Map(levels.map((l) => [l.val, l]));
  const wire = new Map(levels.filter((l) => l.wire || l.raw).map((l) => [l.wire || l.raw, l.val]));
  return {
    classify: (v) => byVal.has(v) ? !byVal.get(v).idle : null,
    primary, run: "hist.state_phase_run", summaryLevels: true, wire,
    compactValueLabel: (v) => byVal.get(v)?.label || "",
    rawLabel: (v) => byVal.get(v)?.raw || "",
    levels: levels.map((l) => ({ ...l, match: (v) => byVal.has(v) ? v === l.val : null })),
    ...extra,
  };
};
const OU_EXTRA_OP_MODES = Object.freeze([
  ..."Ventilation|Auto Cool|Auto Heat|Dry|Aux.|Cooling Storage|Heating Storage".split("|"),
  ...["cl", "ht"].flatMap((k) => [1, 2, 3, 4].map((n) => `UseStrdThrm(${k})${n}`)),
].map((raw, i) => ({ val: (i + 4) * 10, cls: "quiet-on", raw, optional: true })));

const STATE_HIST = Object.freeze({
  tank_preheat_state: namedBinHist("x10a", "preheat-on", "preheat"),
  disinfection_state: namedBinHist("modbus", "disinfection-on", "disinfection"),
  defrost_state: namedBinHist("x10a", "defrost-on", "defrost", false, {
    totalBlocks: true, readoutMissing: true,
    compactValueLabel: (v) => v === 10 ? "hist.defrost_active" : v === 0 ? "hist.defrost_inactive" : "",
  }),
  quiet_state: namedBinHist("x10a", "quiet-on", "quiet"),
  // BOOST itself is mode 2, but a Boost inspector that paints modes 0, 1 and 3 as one identical
  // "off" bar hides whether the controller was free, inhibited or forced on. Paint the complete
  // four-state Smart-Grid enum and list every HomeHub phase; the Boost total above remains the
  // sampled amount of mode 2 so the permanent BOOST pill and its history keep the same contract.
  smart_grid_mode: enumStateHist("modbus",
    ["sg-free", "sg-forced-off", "sg-recommended", "sg-forced-on"].map((cls, i) => ({ val: i * 10, cls, label: `sg.mode${i}` })),
    { classify: (v) => [0, 10, 20, 30].includes(v) ? v === 20 : null, summaryLevels: false,
      total: "hist.boost_total", active: "hist.boost_active", inactive: "hist.boost_inactive", aria: "hist.boost_aria" }),
  bsh_state: namedBinHist("x10a", "heater-on", "heater"),
  buh_state: enumStateHist("x10a", [
    { val: 0, idle: true, cls: "state-off", label: "hist.buh_inactive" },
    { val: 10, cls: "step1", label: "hist.buh_step1" },
    { val: 20, cls: "step2", label: "hist.buh_step2" },
  ], { summaryLevels: false, total: "hist.buh_total", active: "hist.buh_active", inactive: "hist.buh_inactive",
       aria: "hist.buh_aria", compactValueLabel: (v) => v === 0 ? "state.off" : v === 10 ? "hist.buh_step1" : v === 20 ? "hist.buh_step2" : "" }),
  valve_dhw: binStateHist("x10a", "valve-dhw", { offCls: "valve-space", total: "hist.valve_dhw_total",
    inactiveTotal: "hist.valve_space_total", active: "hist.valve_dhw", inactive: "hist.valve_space",
    aria: "hist.valve_aria", compactValueLabel: (v) => v === 0 ? "hist.valve_space" : v === 10 ? "hist.valve_dhw" : "" }),
  circulation_state: namedBinHist("x10a", "circulation-on", "circ", "compact", { missing: "hist.circ_unavailable" }),
  valve_heat: binStateHist("x10a", "valve2-on", { total: "hist.valve2_on_total", inactiveTotal: "hist.valve2_off_total",
    active: "hist.valve2_on", inactive: "hist.valve2_off", aria: "hist.valve2_aria" }),
  water_flow_switch: namedBinHist("x10a", "flow-switch-on", "flow_switch", true),
  compressor_state: namedBinHist("modbus", "comp-on", "comp", false, { showRuns: true }),
  modbus_defrost_state: namedBinHist("modbus", "defrost-on", "mb_defrost", false, {
    readoutMissing: true,
    compactValueLabel: (v) => v === 10 ? "hist.mb_defrost_active" : v === 0 ? "hist.mb_defrost_inactive" : "",
  }),
  pump_state: namedBinHist("modbus", "circulation-on", "pump"),
  ...Object.fromEntries([
    ["modbus", "heater-on", ["modbus_hot_start_state", "modbus_dhw_booster_state"]],
    ["modbus", "valve-dhw", ["modbus_dhw_state", "modbus_dhw_reheat_state"]],
    ["modbus", "comp-on", ["modbus_space_state", "modbus_space_enable_state"]],
    ["x10a", "comp-on", ["thermostat_state", "x10a_space_state"]],
    ["x10a", "circulation-on", ["x10a_pump_state"]],
    ["x10a", "valve-dhw", ["dhw_reheat_state"]],
    ["x10a", "heater-on", ["dhw_powerful_state"]],
  ].flatMap(([p, c, ids]) => ids.map((id) => [id, binStateHist(p, c)]))),
  modbus_current_op_mode: enumStateHist("modbus", [
    { val: 0, idle: true, cls: "state-off", label: "enum.none", optional: true,
      show: () => S.status?.modbus?.profile === "altherma4" },
    { val: 10, cls: "heater-on", label: "enum.heating" },
    { val: 20, cls: "defrost-on", label: "enum.cooling" },
  ]),
  modbus_op_mode: enumStateHist("modbus", [
    { val: 0, idle: true, cls: "sg-recommended", label: "enum.auto" },
    { val: 10, cls: "heater-on", label: "enum.heating" },
    { val: 20, cls: "defrost-on", label: "enum.cooling" },
  ]),
  modbus_abnormality_state: enumStateHist("modbus", [
    { val: 0, idle: true, cls: "circulation-on", label: "enum.no_error" },
    { val: 20, cls: "heater-on", label: "enum.warning" },
    { val: 10, cls: "sg-forced-off", label: "enum.fault" },
  ]),
  ou_op_mode: enumStateHist("x10a", [
    { val: 0, idle: true, cls: "state-off", label: "mode.stop", wire: "Stop" },
    { val: 10, cls: "heater-on", label: "enum.heating", wire: "Heating" },
    { val: 20, cls: "defrost-on", label: "enum.cooling", wire: "Cooling" },
    { val: 30, cls: "sg-recommended", label: "enum.auto", wire: "Auto" },
    ...OU_EXTRA_OP_MODES,
  ]),
  iu_op_mode: enumStateHist("x10a", [
    { val: 0, idle: true, cls: "state-off", label: "mode.stop", wire: "Stop" },
    { val: 10, cls: "heater-on", label: "mode.heat", wire: "Heating" },
    { val: 20, cls: "defrost-on", label: "mode.cool", wire: "Cooling" },
    { val: 40, cls: "valve-dhw", label: "mode.dhw", wire: "DHW" },
    { val: 50, cls: "comp-on", label: "mode.heat_dhw", wire: "Heating + DHW", optional: true },
    { val: 60, cls: "quiet-on", label: "mode.cool_dhw", wire: "Cooling + DHW", optional: true },
  ]),
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

const MB_ENUM_RANGE = Object.freeze({
  three_way_valve: [0, 1],
  smart_grid_mode: [0, 3],
  operation_mode: [0, 2],
  current_operation_mode: [1, 2],
  altherma4_current_operation_mode: [0, 2],
  unit_abnormality: [0, 2],
});

function stateHistoryCurrent(id, source) {
  if (S.otaCached) return { present: false, value: null };
  if (source === "modbus") {
    if (S.status?.modbus?.connected === false) return { present: true, value: null };
    if (!Array.isArray(S._modbus)) return { present: false, value: null };
    const wireId = modbusHistRowId(id);
    const row = S._modbus.find((r) => r && (r.history === wireId || r.concept === wireId ||
      (wireId === "smart_grid_mode" && r.off === 56 && r.enum === "smart_grid_mode")));
    const range = row?.enum ? MB_ENUM_RANGE[row.enum] : null;
    if (range && row.value != null) {
      const raw = String(row.value).trim();
      const mode = /^\d+$/.test(raw) ? Number(raw) : -1;
      return { present: true, value: mode >= range[0] && mode <= range[1] ? mode * 10 : null };
    }
    return { present: true, value: currentBinaryTenths(row) };
  }

  if (source !== "x10a") return { present: false, value: null };
  if (id === "circulation_state") {
    if (S.transportUnavailable === "status") return { present: true, value: null };
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
  const cid = id === "x10a_pump_state" ? "pump_running"
            : id === "x10a_space_state" ? "space_op" : id;
  const row = S._values.find((r) => r && r.concept === cid);
  const wire = STATE_HIST[id]?.wire;
  if (wire?.size) {
    const raw = row?.value == null ? "" : String(row.value).trim();
    return { present: true, value: wire.has(raw) ? wire.get(raw) : null };
  }
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
const boolRuns = (flags) => stateRuns({ v: flags }, true, Boolean);
const fmtUnixHm = (sec) =>
  new Date(sec * 1000).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });

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
//                  claim than one it watched arrive, and printing them identically is the legacy-35–legacy-39
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
function stateRunWhen(view, from, count, series) {
  if (view.t0 != null) {
    return `${fmtUnixHm(view.t0 + from * view.dt)}–${fmtUnixHm(view.t0 + (from + count) * view.dt)}`;
  }
  const n = view.recordedN ?? view.v.length;
  if (histRetained(series.raw)) {
    // Without a clock, show the phase's last recorded slot. The caller reports its duration.
    return retainedSampleTime(from + count - 1, lastSample(series.v, n), view.dt);
  }
  const old = ((n - from) * view.dt) / 3600;
  const recent = ((n - from - count) * view.dt) / 3600;
  return t("hist.boost_ago_range", histFmt1(old), histFmt1(Math.max(0, recent)));
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
  const visible = histVisibleSeries(view);
  // Totals retain the concept's authoritative visible source. Independent lanes remain diagnostic
  // witnesses and must not silently pool their durations into one apparently exact number.
  const primary = visible.find((s) => s.source === cfg.primary) || visible[0];
  const recordedPrimary = { ...primary, v: primary.v.slice(0, recordedN) };
  const primaryMeasured = recordedPrimary.v.some(v => cfg.classify(v) != null);
  const active = stateRuns(recordedPrimary, true, cfg.classify);
  const total = active.reduce((sum, r) => sum + r[1] * view.dt, 0);
  const inactive = stateRuns(recordedPrimary, false, cfg.classify);
  const inactiveSeconds = inactive.reduce((sum, r) => sum + r[1] * view.dt, 0);
  const pct = (i) => ((i / n) * 100).toFixed(3);
  const current = view.liveIndex == null ? ""
    : `<span class="vhist-state-current" style="left:${pct(view.liveIndex)}%;width:${pct(1)}%"></span>`;
  // X10A and paired HomeHub/Modbus start active when available and can be toggled via the source legend.
  const tracks = visible.map((s) => {
    const levels = cfg.levels || [{ match: cfg.classify, cls: "" }];
    const on = levels.flatMap((level) => stateRuns(s, true, level.match).map(([from, count]) =>
      `<span class="vhist-state-on${level.cls ? " " + level.cls : ""}" ` +
      `style="left:${pct(from)}%;width:${pct(count)}%"></span>`
    )).join("");
    const missing = stateRuns(s, null, cfg.classify).map(([from, count]) =>
      `<span class="vhist-state-gap" style="left:${pct(from)}%;width:${pct(count)}%"></span>`).join("");
    const last = histRetained(s.raw) ? lastSample(s.v, recordedN) : -1;
    return `<div class="vhist-state-track ${s.source}" aria-hidden="true">${on}${missing}${current}` +
      (last >= 0 ? histRetainedMarker(s, (last + 0.5) / n) : "") + `</div>`;
  }).join("");
  const hasMissing = visible.some((s) => stateRuns(s, null, cfg.classify).length > 0);
  const sourceItems = view.series.length > 1
    ? view.series.map((s) => histLegendHtml(view, s, histSourceClass(s.source)))
    : (view.series[0]?.source === "modbus" || id === "circulation_state")
      ? view.series.map((s) => `<span class="vhist-source${histSourceClass(s.source)}"><i></i>${esc(histSeriesLabel(s))}</span>`)
      : [];
  const levelText = (level) => level.raw || t(level.label);
  const shownLevels = cfg.levels?.filter((level) =>
    !level.optional || level.show?.() || visible.some((s) => s.v.some((v) => level.match(v) === true)));
  const levelItems = shownLevels
    ? [
        ...shownLevels.map((level) => `<span class="vhist-level ${level.cls}"><i></i>${esc(levelText(level))}</span>`),
        ...(hasMissing ? [`<span class="vhist-level state-unavailable"><i></i>${esc(t(cfg.missing || "hist.nm"))}</span>`] : []),
      ]
    : [];
  const levelLegend = (sourceItems.length || levelItems.length)
    ? `<div class="vhist-legend vhist-level-legend">${[...sourceItems, ...levelItems].join("")}</div>`
    : "";

  const pi = histPinIndex(id, view);
  const sourceAttr = view.scope ? ` data-source="${esc(view.scope)}"` : "";
  let pinCross = "";
  if (pi >= 0) {
    const frac = stateSampleFraction(pi, n);
    const px = (frac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
  }
  const totalText = primaryMeasured
    ? cfg.summaryLevels
      ? cfg.levels.map((level) => {
          const sec = stateRuns(recordedPrimary, true, level.match)
            .reduce((sum, r) => sum + r[1] * view.dt, 0);
          return sec ? `${levelText(level)} · ${histDuration(sec)}` : "";
        }).filter(Boolean).join(" · ")
      : (cfg.showRuns ? t(cfg.total, histDuration(total), active.length)
                      : cfg.total ? t(cfg.total, cfg.totalBlocks ? (total / view.dt).toLocaleString(LANG) : histDuration(total))
                                  : `${t(cfg.active)} · ${histDuration(total)}`) +
        (cfg.inactiveTotal ? ` · ${t(cfg.inactiveTotal, histDuration(inactiveSeconds))}` : "")
    : "";
  const aria = cfg.aria ? t(cfg.aria, name || id, totalText)
    : t("hist.aria", totalText ? `${name || id} (${totalText})` : (name || id));
  const axis = `<div class="vhist-axis"><span>${recordedN ? esc(histAxisStart(view, spanH)) : ""}</span>` +
    `<span>${esc(view.liveIndex == null ? histAxisEnd(view) : t("hist.now"))}</span></div>`;
  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(!recordedN ? t("hist.now") : full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
      `<span class="vhist-range mono num">${esc(totalText)}</span></div>` + levelLegend +
    `<div class="vhist-graph vhist-state-graph">` +
      histTipsHtml(view, pi, pi >= 0 ? stateSampleFraction(pi, n) : 0) +
      `<div class="vhist-plot vhist-state-plot" data-hist="${esc(id)}"${sourceAttr}${histRevision(view)} data-n="${n}" tabindex="0" role="img"` +
        ` aria-label="${esc(aria)}">` + tracks + pinCross +
        `<span class="vhist-cross vhist-live" hidden></span>` +
      `</div>` + axis + histTimesHtml(view, pi, pi >= 0 ? stateSampleFraction(pi, n) : 0) +
    `</div>` +
    histUnavailableHtml(view)
  , "vhist-state");
}

function alignAuxSample(view, h, i) {
  if (!h || !Array.isArray(h.v) || !h.v.length) return null;
  const dt = h.dt || 300;
  if (dt !== view.dt) return null;
  let idx = -1;
  if (Number.isInteger(view.b0) && Number.isInteger(h.b0)) {
    idx = (view.b0 + i) - h.b0;
  } else if (typeof view.t0 === "number" && typeof h.t0 === "number") {
    idx = Math.round(((view.t0 + i * view.dt) - h.t0) / dt);
  } else if (view.b0 == null && h.b0 == null && view.t0 == null && h.t0 == null) {
    idx = h.v.length - view.v.length + i;
  }
  return (idx >= 0 && idx < h.v.length) ? h.v[idx] : null;
}

const DHW_PHASE_SERIES = [
  { id: "smart_grid_mode", source: "x10a", kind: "boost", label: "sg.mode2", active: 20 },
  { id: "smart_grid_mode", source: "modbus", kind: "boost", label: "sg.mode2", active: 20 },
  { id: "bsh_state", source: "x10a", kind: "bsh", label: "hist.heater_active", active: 10 },
  { id: "bsh_state", source: "modbus", kind: "bsh", label: "hist.heater_active", active: 10 },
];

function tankAuxHistories() {
  return DHW_PHASE_SERIES.map(({ id, source }) => expireHistSamples(S.hist.get(histCacheKey(id, source))));
}

const tankAuxRevision = histories => histories?.map(h =>
  h ? `${h.gen || 0}:${h.expired || 0}` : "").join(",");

const dhwPhaseLabel = (phase) => `${t(phase.label)} · ${phase.source === "modbus" ? "Modbus" : "X10A"}`;

function dhwPhaseVisible(view, source) {
  if (view?.scope) return view.scope === source;
  if (!view?.series?.some((s) => s.source === source)) return true;
  return histVisibleSeries(view).some((s) => s.source === source);
}

function dhwAuxPhases(view) {
  return (view?.tankAux || []).flatMap((h, i) => {
    const phase = DHW_PHASE_SERIES[i];
    if (!h || !dhwPhaseVisible(view, phase.source)) return [];
    const flags = view.v.map((_, j) => alignAuxSample(view, h, j, phase.source) === phase.active);
    return [{ ...phase, flags, count: flags.filter(Boolean).length }];
  });
}

function histEmptyHtml(cached, wrap) {
  const status = cached.some(h => h?.err || h?.refreshFailed) ? "hist.err"
    : cached.some(h => !h) ? "hist.loading"
    : cached.some(h => expiredHistSlots(h) > 0) ? "hist.nm" : "hist.none";
  return wrap(`<div class="vhist-note">${esc(t(status))}</div>`, "vhist-flat");
}

function histUnavailableHtml(view) {
  return view.unavailable.length
    ? `<div class="vhist-note">${esc(view.unavailable.map(s => s.name).join(", "))} · ${esc(t("hist.err"))}</div>`
    : "";
}

function modbusFlowUnverified(view) {
  return !!view && view.id === "flow" &&
    histVisibleSeries(view).some((s) => s.source === "modbus") &&
    modbusFlowScaleUnverified();
}

// Draw each registered source on its own raster. Null samples break the line instead of inventing
// a measurement across a timeout or a reading the source refused.
function histRuns(pts, n, X, Y, cls, r, splitZones = false) {
  let line = "", area = "", dots = "", run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) {
      const z = splitZones ? pressureZoneClass(pts[run[0]]) : "";
      dots += `<circle class="vhist-pt${cls}${z}" cx="${X(run[0]).toFixed(1)}" cy="${Y(pts[run[0]]).toFixed(1)}" r="${r}"/>`;
    } else if (splitZones) {
      for (const seg of pressureSplitRun(run, pts, X, Y)) {
        const d = seg.pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
        line += `<path class="vhist-line${cls}${seg.zone}" d="${d}" vector-effect="non-scaling-stroke"/>`;
        area += `<path class="vhist-area${cls}${seg.zone}" d="${d}L${seg.pts.at(-1)[0].toFixed(1)} ${HIST_H}L${seg.pts[0][0].toFixed(1)} ${HIST_H}Z"/>`;
      }
    } else {
      const d = run.map((i, k) => `${k ? "L" : "M"}${X(i).toFixed(1)} ${Y(pts[i]).toFixed(1)}`).join("");
      line += `<path class="vhist-line${cls}" d="${d}" vector-effect="non-scaling-stroke"/>`;
      area += `<path class="vhist-area${cls}" d="${d}L${X(run.at(-1)).toFixed(1)} ${HIST_H}L${X(run[0]).toFixed(1)} ${HIST_H}Z"/>`;
    }
    run = [];
  };
  for (let i = 0; i < n; i++) if (pts[i] == null) flush(); else run.push(i);
  flush();
  return [line, area, dots];
}

function flowMinimumBands(view, flow) {
  const w = flow?.windows;
  const span = (view.v.length - 1) * view.dt;
  if (!w || !Number.isFinite(view.t0) || span <= 0 ||
      (flow.source === "modbus" && modbusFlowScaleUnverified()) ||
      !histVisibleSeries(view).some(s => s.source === flow.source && s.v.some(v => v != null))) return [];
  const bands = [];
  for (let h = 0; h < w.hour_masks.length; h++) {
    for (let slot = 0; slot < 12; slot++) {
      if (!(w.hour_masks[h] & (1 << slot))) continue;
      const from = w.t0 + h * 3600 + slot * w.slot_s, to = from + w.slot_s;
      if (to <= view.t0 || from >= view.t0 + span) continue;
      const previous = bands.at(-1);
      if (previous?.to === from) previous.to = to;
      else bands.push({ from, to });
    }
  }
  const x = (time) => Math.min(1, Math.max(0, (time - view.t0) / span)) * HIST_W;
  return bands.map(b => ({ ...b, x: x(b.from), width: x(b.to) - x(b.from) }));
}

function flowMinimumTime(time, from, to) {
  const a = new Date(from * 1000), b = new Date(to * 1000);
  return time.formatRange ? time.formatRange(a, b) : `${time.format(a)} – ${time.format(b)}`;
}

function selectFlowMinimum(plot, clientX, clientY, tolerance = 0) {
  const bands = [...plot.querySelectorAll("[data-flow-band]")];
  if (!bands.length) return false;
  const host = plot.closest(".vhist");
  const legend = host.querySelector("[data-flow-min-show]");
  const readout = host.querySelector(".vhist-flow-readout");
  const source = plot.dataset.flowMinSource, minimum = Number(plot.dataset.flowMinimum);
  let picked;
  if (clientX == null) {
    if (readout.hidden) {
      // Keep the last window as a cursor so reopening can reach even a window in a curve gap.
      const previous = S.flowMinSelection;
      const index = previous?.source === source && previous.minimum === minimum
        ? bands.findIndex(b => Number(b.dataset.flowBand) === previous.from) : -1;
      picked = bands[(index + 1) % bands.length];
    }
  } else {
    const svg = plot.querySelector("svg");
    const bounds = svg.getBoundingClientRect();
    const curve = [...svg.querySelectorAll("#flowObservationClip path")];
    if (!bounds.width || !bounds.height) return false;
    let best = tolerance;
    for (const b of bands) {
      const r = b.getBoundingClientRect();
      const distance = Math.max(0, r.left - clientX, clientX - r.right);
      if (!r.width || distance > best || (picked && distance === best)) continue;
      const x = Math.min(r.right, Math.max(r.left, clientX));
      const point = new DOMPoint((x - bounds.left) / bounds.width * HIST_W,
        (clientY - bounds.top) / bounds.height * HIST_H);
      if (!curve.some(area => area.isPointInFill(point))) continue;
      picked = b;
      best = distance;
    }
    if (!picked) return false;
  }
  if (picked) S.flowMinSelection = { from: Number(picked.dataset.flowBand), minimum, source, expanded: true };
  else if (S.flowMinSelection) S.flowMinSelection.expanded = false;
  for (const b of bands) b.classList.toggle("selected", b === picked);
  readout.hidden = !picked;
  readout.querySelector("strong").textContent = picked?.dataset.flowTime ?? "";
  readout.querySelector("span").textContent = picked?.dataset.flowReadout ?? "";
  legend.setAttribute("aria-expanded", String(!!picked));
  return true;
}

function pressureFindingIndex(view, finding) {
  if (finding?.at == null) return -1;
  const series = histVisibleSeries(view).find(s => s.source === "x10a");
  if (!series || !historyWallLabelAllowed(series.raw)) return -1;
  const sample = (finding.at - series.raw.t0) / view.dt;
  // The time axis labels the end of each bucket. A timestamp on a boundary in whole seconds
  // cannot reliably identify which bucket owns the original observation.
  if (Number.isInteger(sample)) return -1;
  const index = Math.ceil(sample) + series.offset;
  return index >= 0 && series.v[index] === Math.round(finding.bar * 10) && !histHeld(series, index) ? index : -1;
}

function dhwCoolingBands(view, dhw) {
  const windows = dhw?.timeline?.windows;
  const span = view ? (view.v.length - 1) * view.dt : 0;
  if (!windows?.length || span <= 0 ||
      !histVisibleSeries(view).some(s => s.source === dhw.source &&
        s.v.some((v, i) => v != null && s.v[i + 1] != null))) return [];
  const wall = Number.isFinite(view.t0) && Number.isFinite(dhw.timeline.unix_s);
  const rel = view.t0 == null && !dhw.timeline.unix_s && dhw.timeline.live &&
    !view.aged && !view.refreshFailed;
  if (!wall && !rel) return [];
  const bands = [];
  for (const w of windows) {
    if (!(w.rate_k_h >= 0.8)) continue;
    let from, to, unixFrom = null, unixTo = null;
    if (wall) {
      unixFrom = dhw.timeline.unix_s - (dhw.timeline.window_end_s - w.start_s);
      unixTo = dhw.timeline.unix_s - (dhw.timeline.window_end_s - w.end_s);
      if (unixTo <= view.t0 || unixFrom >= view.t0 + span) continue;
      from = Math.max(view.t0, unixFrom) - view.t0;
      to = Math.min(view.t0 + span, unixTo) - view.t0;
    } else {
      const fromRel = span - (dhw.timeline.window_end_s - w.start_s);
      const toRel = span - (dhw.timeline.window_end_s - w.end_s);
      if (toRel <= 0 || fromRel >= span) continue;
      from = Math.max(0, fromRel);
      to = Math.min(span, toRel);
    }
    const x = (from / span) * HIST_W;
    const width = ((to - from) / span) * HIST_W;
    if (width <= 0) continue;
    bands.push({ ...w, unixFrom, unixTo, windowEndS: dhw.timeline.window_end_s, x, width });
  }
  if (!bands.length) return [];
  const peakRate = Math.max(...bands.map(b => b.rate_k_h));
  return bands.map(b => ({ ...b, isPeak: b.rate_k_h === peakRate }));
}

function dhwCoolingTime(time, b) {
  if (b.unixFrom != null && b.unixTo != null) return flowMinimumTime(time, b.unixFrom, b.unixTo);
  const rel = s => {
    const ageH = Math.max(0, b.windowEndS - s) / 3600;
    return ageH < 0.05 ? t("hist.now") : t("hist.rel", histFmt1(ageH));
  };
  return `${rel(b.start_s)} – ${rel(b.end_s)}`;
}

function selectDhwCooling(plot, clientX, clientY, tolerance = 0) {
  const bands = [...plot.querySelectorAll("[data-dhw-band]")];
  if (!bands.length) return false;
  let picked;
  if (clientX == null) {
    const cur = bands.findIndex(b => b.classList.contains("selected"));
    if (cur < 0) {
      const peaks = bands.filter(b => b.classList.contains("is-peak"));
      picked = peaks.at(-1) || bands.at(-1);
    } else {
      picked = bands[(cur + 1) % bands.length];
    }
  } else {
    const svg = plot.querySelector("svg");
    const bounds = svg.getBoundingClientRect();
    const curve = [...svg.querySelectorAll("#dhwCoolingClip path")];
    if (!bounds.width || !bounds.height) return false;
    let best = tolerance;
    for (const b of bands) {
      const r = b.getBoundingClientRect();
      const distance = Math.max(0, r.left - clientX, clientX - r.right);
      if (!r.width || distance > best || (picked && distance === best)) continue;
      const x = Math.min(r.right, Math.max(r.left, clientX));
      const point = new DOMPoint((x - bounds.left) / bounds.width * HIST_W,
        (clientY - bounds.top) / bounds.height * HIST_H);
      if (!curve.some(area => area.isPointInFill(point))) continue;
      picked = b;
      best = distance;
    }
  }
  if (!picked) return false;
  S.dhwCoolSelection = {
    end_s: Number(picked.dataset.dhwBand),
    source: plot.dataset.dhwSource || "",
    epoch: Number(plot.dataset.dhwEpoch || 0),
  };
  for (const b of bands) b.classList.toggle("selected", b === picked);
  const readout = plot.closest(".vhist").querySelector(".vhist-dhw-readout");
  readout.hidden = false;
  readout.querySelector("strong").textContent = picked.dataset.dhwHeader;
  readout.querySelector("span").textContent = picked.dataset.dhwReadout;
  return true;
}

function histHtml(id, unit, name, source = "", identifySource = false, flow = null,
                  { pressureDiagnosis = false, finding, findingExplanation = "", dhw = null } = {}) {
  const offeredX = (!source || source === "x10a") && hasHist(id);
  const offeredM = (!source || source === "modbus") && hasModbusHist(id);
  const offeredE = (!source || source === "env3") && hasEnv3Hist(id);
  if (!offeredX && !offeredM && !offeredE) return "";
  const offered = [offeredX && id, offeredM && histCacheKey(id, "modbus"),
    offeredE && histCacheKey(id, "env3")].filter(Boolean);
  const wrap = (body, cls) => `<div class="vhist${pressureDiagnosis ? " vhist-pressure-diagnosis" : ""}${cls ? " " + cls : ""}">${body}</div>`;
  const view = historyView(id, source);
  if (!view?.v.some(v => v != null)) return histEmptyHtml(offered.map(key => S.hist.get(key)), wrap);
  const visible = histVisibleSeries(view);
  const chartName = identifySource ? `${name || id} · ${visible.map(s => s.name).join(" / ")}` : name;

  const allPts = view.series.flatMap((s) => s.v.map((x) => x == null ? null : x / 10));

  if (STATE_HIST[id]) return stateHistHtml(id, chartName, view, wrap, STATE_HIST[id]) +
    (view.recordedN === 0 && !view.unavailable.length
      ? histEmptyHtml(offered.map(key => S.hist.get(key)), wrap) : "");

  const n = view.v.length;
  const spanH = Math.max(1, Math.round((n * view.dt) / 3600));
  // The axis states the common boot-aligned span the device actually holds. Before 24 h uptime it
  // grows with the board; after that every source remains a rolling day. A source that started or
  // changed later contributes explicit null gaps, never a shorter axis or fabricated flat data.
  const full  = n * view.dt >= 23.5 * 3600;
  const flowBands = id === "flow" ? flowMinimumBands(view, flow) : [];
  const dhwBands = id === "dhw_tank" ? dhwCoolingBands(view, dhw) : [];
  const scale = histScale(allPts, n, id);
  const { lo, hi, X, Y } = scale;
  const isPressure = id === "water_pressure";
  const findingIndex = pressureDiagnosis ? pressureFindingIndex(view, finding) : -1;
  const findingMark = findingIndex < 0 ? "" :
    `<span class="vhist-pressure-finding${pressureZoneClass(finding.bar)}" aria-hidden="true"` +
    ` style="left:${(X(findingIndex) / HIST_W * 100).toFixed(2)}%;top:${(Y(finding.bar) / HIST_H * 100).toFixed(2)}%"></span>`;

  // Contiguous runs only: each becomes one light area with its darker upper-edge line, so every
  // numeric trend uses the same visual grammar while a gap remains a real gap. Multiple sources use
  // the same geometry and are made more transparent by the wrapper class below. A run of ONE sample
  // still gets a dot because there is no interval whose area or upper edge could honestly be drawn.
  let line = "", area = "", dots = "", flowCurveArea = "", dhwCurveArea = "";
  for (const s of visible) {
    const pts = s.v.map((x) => x == null ? null : x / 10);
    const [l, a, d] = histRuns(pts, n, X, Y, histSourceClass(s.source), 1.6, isPressure && s.source === "x10a");
    line += l; area += a; dots += d;
    if (flowBands.length && s.source === flow.source) flowCurveArea = a;
    if (dhwBands.length && s.source === dhw.source) dhwCurveArea = a;
  }
  // The "now" marker is an HTML element, not an SVG circle: the SVG is stretched non-uniformly, so
  // a circle in it would render as an ellipse. Percentage positioning maps onto the same 0..HIST_H
  // scale exactly, and stays right whatever width the panel ends up at.
  const nowDots = view.series.map((s) => {
    if (!visible.includes(s)) return "";
    const splitZones = isPressure && s.source === "x10a";
    if (s.raw.refreshFailed || s.raw.aged) {
      const last = lastSample(s.v);
      const zoneCls = splitZones && last >= 0 ? pressureZoneClass(s.v[last] / 10) : "";
      return last < 0 ? "" : histRetainedMarker(s, X(last) / HIST_W, histSourceClass(s.source) + zoneCls,
        (Y(s.v[last] / 10) / HIST_H) * 100);
    }
    const last = s.v[n - 1];
    const zoneCls = splitZones && last != null ? pressureZoneClass(last / 10) : "";
    return last == null ? "" : `<span class="vhist-now${histSourceClass(s.source)}${zoneCls}"` +
      ` style="top:${((Y(last / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
  }).join("");
  const shownUnit = view.unit || unit;
  const u = shownUnit ? ` ${shownUnit}` : "";
  const rng = `${histFmt1(lo)} – ${histFmt1(hi)}${u}`;

  // The scrub layer: a translucent tooltip OVER the plot (ApexCharts-style), plus the crosshair and
  // marker dot inside it. The bubble follows the cursor horizontally but never changes the plot's
  // vertical position. All three start hidden and are moved by scrubMove() writing styles directly
  // — never by re-rendering this HTML, which would fight the pointer.
  // `data-hist` is what the delegated pointer handlers match on, and it carries the sample count so
  // the geometry the handler needs comes from the same render that drew the path.
  // Emit a pinned readout in the markup so structural replacements can restore it.
  // Its instant is re-resolved here on every render, so the pin follows its measurement as the ring
  // rolls and disappears once that measurement has left the day.
  const pi = histPinIndex(id, view);
  // The synopsis is already escaped by the inspector. It describes its 24-hour finding,
  // independently of the reading in the ordinary pinned sample tooltip.
  const hasExplanation = pressureDiagnosis && findingExplanation && visible.some(s => s.source === "x10a");
  const showExplanation = hasExplanation && pi >= 0 && S.histPin.get(id)?.pressureInspector;
  const pressureAttr = hasExplanation ? " data-pressure-assessment" : "";
  const overlays = view.stateOverlays || [];
  const shownOverlays = overlays.filter((ov) => !ov.hidden);
  const sourceAttr = view.series.length === 1 && !overlays.length ? ` data-source="${esc(view.series[0].source)}"` : "";
  let pinCross = "", pinMarks = "";
  if (pi >= 0) {
    const frac = scrubFrac(pi, n);
    const px = (frac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    pinMarks = visible.map((s) => {
      if (s.v[pi] == null) return "";
      const zoneCls = isPressure && s.source === "x10a" ? pressureZoneClass(s.v[pi] / 10) : "";
      return `<span class="vhist-mark vhist-pinned${histSourceClass(s.source)}${zoneCls}"` +
        ` style="left:${px}%;top:${((Y(s.v[pi] / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
    }).join("");
  }
  const aux = id === "dhw_tank" ? dhwAuxPhases(view) : [];
  let phaseBands = "", threshBands = "", threshLines = "", threshHtml = "";
  const avoidY = [];
  if (isPressure) {
    const yLow = Y(PRESSURE_LOW_BAR), yCrit = Y(PRESSURE_CRIT_BAR);
    avoidY.push(yLow, yCrit);
    threshBands =
      `<rect class="vhist-band vhist-band-low" x="0" y="${yLow.toFixed(1)}" width="${HIST_W}" height="${Math.max(0, yCrit - yLow).toFixed(1)}"/>` +
      `<rect class="vhist-band vhist-band-crit" x="0" y="${yCrit.toFixed(1)}" width="${HIST_W}" height="${Math.max(0, HIST_H - yCrit).toFixed(1)}"/>`;
    threshLines =
      `<line class="vhist-thresh low" x1="0" y1="${yLow.toFixed(1)}" x2="${HIST_W}" y2="${yLow.toFixed(1)}" vector-effect="non-scaling-stroke"/>` +
      `<line class="vhist-thresh crit" x1="0" y1="${yCrit.toFixed(1)}" x2="${HIST_W}" y2="${yCrit.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
    threshHtml =
      `<span class="vhist-thresh-label low mono num" style="top:${((yLow / HIST_H) * 100).toFixed(2)}%" aria-hidden="true">${esc(histFmt1(PRESSURE_LOW_BAR))} bar</span>` +
      `<span class="vhist-thresh-label crit mono num" style="top:${((yCrit / HIST_H) * 100).toFixed(2)}%" aria-hidden="true">${esc(histFmt1(PRESSURE_CRIT_BAR))} bar</span>`;
  }
  const grid = histYGridHtml(scale, shownUnit, { avoidY });
  const legendItems = (identifySource || view.series.length > 1 ||
    view.series[0].source === "modbus" || overlays.length > 0)
    ? view.series.map((s) => histLegendHtml(view, s, histSourceClass(s.source)))
    : [];
  let overlayBands = "";
  if (shownOverlays.length) {
    const step = n > 1 ? HIST_W / (n - 1) : HIST_W;
    for (const ov of shownOverlays) {
      for (const [from, count] of boolRuns(ov.activeFlags)) {
        const x0 = n > 1 ? Math.max(0, X(from) - step / 2) : 0;
        const x1 = n > 1 ? Math.min(HIST_W, X(from + count - 1) + step / 2) : HIST_W;
        const x = Math.round(x0 * 10);
        const w = (Math.round(x1 * 10) - x) / 10;
        overlayBands += `<rect class="vhist-phase vhist-phase-state${ov.cls}" x="${(x / 10).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${HIST_H}"/>`;
      }
      if (ov.live?.value === ov.spec.active && !ov.activeFlags[n - 1]) {
        const lw = Math.max(3, Math.min(step / 2, 6));
        overlayBands += `<rect class="vhist-phase vhist-phase-state vhist-phase-live${ov.cls}" x="${(HIST_W - lw).toFixed(1)}" y="0" width="${lw.toFixed(1)}" height="${HIST_H}"/>`;
      }
    }
  }
  for (const ov of overlays) {
    const liveState = numericStateOverlayStateText(ov.spec, ov.live?.value);
    const label = liveState ? `${ov.name} · ${liveState}` : ov.name;
    legendItems.push(
      `<button type="button" class="vhist-source vhist-overlay-source${ov.cls}" ` +
      `data-hist-id="${esc(view.id)}" data-hist-series="${esc(ov.key)}" aria-pressed="${!ov.hidden}">` +
      `<i></i>${esc(label)}</button>`
    );
  }
  let flowSvg = "", flowAttr = "", flowReadout = "";
  if (flowBands.length) {
    const minimum = flow.minimum;
    const time = new Intl.DateTimeFormat(LANG, { dateStyle: "short", timeStyle: "short" });
    const explanation = t("check.flow.readout", histFmt1(minimum) + (u || " l/min"));
    const selected = S.flowMinSelection?.expanded && S.flowMinSelection.source === flow.source &&
      S.flowMinSelection.minimum === minimum
      ? flowBands.find(b => b.from === S.flowMinSelection.from) : null;
    const windows = flowBands.map(b => `<rect class="vhist-flow-band${b === selected ? " selected" : ""}"` +
      ` x="${b.x.toFixed(3)}" y="0" width="${b.width.toFixed(3)}" height="${HIST_H}" data-flow-band="${b.from}"` +
      ` data-flow-time="${esc(flowMinimumTime(time, b.from, b.to))}" data-flow-readout="${esc(explanation)}"/>`).join("");
    // Clip the tint to the reporting source's curve and leave its gaps clear.
    flowSvg = `<defs><clipPath id="flowObservationClip">${flowCurveArea}</clipPath></defs>` +
      `<g clip-path="url(#flowObservationClip)">${windows}</g>`;
    flowAttr = ` data-flow-minimum="${minimum}" data-flow-min-source="${esc(flow.source)}"`;
    legendItems.push(`<button type="button" data-flow-min-show class="vhist-source vhist-legend-flow-min"` +
      ` aria-expanded="${!!selected}" aria-controls="flowMinimumReadout">` +
      `<i aria-hidden="true"></i>${esc(t("check.flow.show"))}</button>`);
    flowReadout = `<div id="flowMinimumReadout" class="vhist-flow-readout" role="status"${selected ? "" : " hidden"}>` +
      `<strong>${selected ? esc(flowMinimumTime(time, selected.from, selected.to)) : ""}</strong>` +
      `<span>${selected ? esc(explanation) : ""}</span></div>`;
  }
  let dhwSvg = "", dhwAttr = "", dhwReadout = "";
  if (dhwBands.length && dhwCurveArea) {
    const time = new Intl.DateTimeFormat(LANG, { dateStyle: "short", timeStyle: "short" });
    const selectedDhw = S.dhwCoolSelection?.source === dhw.source &&
      S.dhwCoolSelection?.epoch === dhw.timeline.epoch
      ? dhwBands.find(b => b.end_s === S.dhwCoolSelection.end_s) : null;
    const dhwWindows = dhwBands.map(b => {
      const header = `${dhwCoolingTime(time, b)} · ${checkupFmt1(b.rate_k_h)} °C/h`;
      const explanation = checkupDhwCoolingExplanation(b);
      return `<rect class="vhist-dhw-band${b.isPeak ? " is-peak" : ""}${b === selectedDhw ? " selected" : ""}"` +
        ` x="${b.x.toFixed(3)}" y="0" width="${b.width.toFixed(3)}" height="${HIST_H}"` +
        ` data-dhw-band="${b.end_s}" data-dhw-rate="${b.rate_k_h}"` +
        ` data-dhw-header="${esc(header)}" data-dhw-readout="${esc(explanation)}"/>`;
    }).join("");
    dhwSvg = `<defs><clipPath id="dhwCoolingClip">${dhwCurveArea}</clipPath></defs>` +
      `<g clip-path="url(#dhwCoolingClip)">${dhwWindows}</g>`;
    dhwAttr = ` data-dhw-source="${esc(dhw.source)}" data-dhw-epoch="${esc(String(dhw.timeline.epoch))}"`;
    legendItems.push(`<button type="button" data-dhw-cool-show class="vhist-source vhist-legend-dhw-cool">` +
      `<i aria-hidden="true"></i>${esc(t("check.dhw.show"))}</button>`);
    dhwReadout = `<div class="vhist-flow-readout vhist-dhw-readout" role="status"${selectedDhw ? "" : " hidden"}>` +
      `<strong>${selectedDhw ? esc(`${dhwCoolingTime(time, selectedDhw)} · ${checkupFmt1(selectedDhw.rate_k_h)} °C/h`) : ""}</strong>` +
      `<span>${selectedDhw ? esc(checkupDhwCoolingExplanation(selectedDhw)) : ""}</span></div>`;
  }
  if (isPressure) {
    legendItems.push(
      `<span class="vhist-source vhist-legend-low"><i></i>${esc(t("check.detail.current_label"))}</span>`,
      `<span class="vhist-source vhist-legend-crit"><i></i>${esc(t("check.detail.minimum_time_label"))}</span>`,
    );
  }
  if (aux.length) {
    const step = n > 1 ? HIST_W / (n - 1) : HIST_W;
    const renderRuns = (runs, cls, y, height) => {
      let s = "";
      for (const [from, count] of runs) {
        const x0 = n > 1 ? Math.max(0, X(from) - step / 2) : 0;
        const x1 = n > 1 ? Math.min(HIST_W, X(from + count - 1) + step / 2) : HIST_W;
        const x = Math.round(x0 * 10);
        const w = (Math.round(x1 * 10) - x) / 10;
        s += `<rect class="vhist-phase ${cls}" x="${(x / 10).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${height}"/>`;
      }
      return s;
    };
    for (const phase of aux) {
      if (phase.count) {
        // Give concurrent source lanes a fixed order within each phase band.
        const paired = aux.some(peer => peer.kind === phase.kind && peer !== phase && peer.count > 0);
        const height = HIST_H / (paired ? 4 : 2);
        const y = (phase.kind === "boost" ? 0 : HIST_H / 2) +
          (paired && phase.source === "modbus" ? height : 0);
        const outline = paired && phase.source === "x10a" ? " vhist-phase-outline" : "";
        phaseBands += renderRuns(boolRuns(phase.flags), `vhist-phase-${phase.kind}${outline}`, y, height);
        legendItems.push(
          `<span class="vhist-source vhist-legend-${phase.kind}${outline}"><i></i>${esc(dhwPhaseLabel(phase))}` +
          ` <small class="mono num">(${histDuration(phase.count * view.dt)})</small></span>`
        );
      }
    }
  }
  const legend = legendItems.length
    ? `<div class="vhist-legend">${legendItems.join("")}</div>`
    : "";
  const axis = `<div class="vhist-axis"><span>${esc(histAxisStart(view, spanH))}</span>` +
    `<span>${esc(histAxisEnd(view))}</span></div>`;
  const heading = pressureDiagnosis ? "" :
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
    `<span class="vhist-range mono num">${esc(rng)}</span></div>`;
  return wrap(heading + legend +
    `<div class="vhist-graph${grid.yAxis ? " vhist-has-y" : ""}">` + grid.yAxis +
      histTipsHtml(view, pi, pi >= 0 ? scrubFrac(pi, n) : 0, aux) +
      `<div class="vhist-plot" data-hist="${esc(id)}"${sourceAttr}${pressureAttr}${histRevision(view)}${flowAttr}${dhwAttr} data-n="${n}" tabindex="0" role="img"` +
        ` aria-label="${esc(t(pi >= 0 ? "hist.aria_pinned" : "hist.aria", chartName || id, pi >= 0 ? scrubText(view, pi, true, aux) : ""))}"` +
        `${showExplanation ? ' aria-describedby="inspPressureExplanation"' : ""}>` +
        `<svg viewBox="0 0 ${HIST_W} ${HIST_H}" preserveAspectRatio="none" aria-hidden="true">${threshBands}${grid.svg}${threshLines}${overlayBands}${phaseBands}${area}${flowSvg}${dhwSvg}${line}${dots}</svg>` +
        threshHtml + nowDots + findingMark + pinCross + pinMarks +
        `<span class="vhist-cross vhist-live" hidden></span>` +
        view.series.map((s) => `<span class="vhist-mark vhist-live${histSourceClass(s.source)}" data-source="${s.source}" hidden></span>`).join("") +
      `</div>` + axis + histTimesHtml(view, pi, pi >= 0 ? scrubFrac(pi, n) : 0) +
    `</div>` + flowReadout + dhwReadout +
    (showExplanation ? `<div class="vhist-note vhist-pressure-explanation" id="inspPressureExplanation">${findingExplanation}</div>` : "") +
    histUnavailableHtml(view) +
    (modbusFlowUnverified(view) ? `<div class="vhist-note">${esc(t("hist.modbus_flow_unverified"))}</div>` : ""),
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
// so, and the cursor reports each visible raw measurement at the selected instant.
function env3HistHtml(view = historyView(ENV3_COMBINED_ID)) {
  const offered = ENV3_COMBINED_SERIES.filter((s) => hasEnv3Hist(s.id));
  if (!offered.length) return "";
  const cached = offered.map((s) => S.hist.get(histCacheKey(s.id, "env3")));
  const wrap = (body, cls = "") => `<div class="vhist vhist-env3${cls ? " " + cls : ""}">${body}</div>`;
  if (!view) return histEmptyHtml(cached, wrap);
  const plotted = view.series.filter((s) => s.v.some((v) => v != null));
  if (!plotted.length) return histEmptyHtml(cached, wrap);

  const n = view.v.length;
  const spanH = Math.max(1, Math.round((n * view.dt) / 3600));
  const full = n * view.dt >= 23.5 * 3600;
  let areas = "", lines = "", dots = "", nowDots = "";
  for (const s of plotted) {
    if (!histVisibleSeries(view).includes(s)) continue;
    const pts = s.v.map((v) => v == null ? null : v / 10);
    const { X, Y } = histScale(pts, n);
    const cls = env3SeriesClass(s.source);
    const [l, a, d] = histRuns(pts, n, X, Y, " " + cls, 1.8);
    lines += l; areas += a; dots += d;
    if (histRetained(s.raw)) {
      const last = lastSample(s.v);
      nowDots += histRetainedMarker(s, X(last) / HIST_W, " " + cls, (Y(pts[last]) / HIST_H) * 100);
    }
    const last = s.v[n - 1];
    if (last != null && !histRetained(s.raw)) {
      nowDots += `<span class="vhist-now ${cls}" ` +
        `style="top:${((Y(last / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
    }
  }

  const legend = `<div class="vhist-legend">${plotted.map((s) =>
    histLegendHtml(view, s, " " + env3SeriesClass(s.source))
  ).join("")}</div>`;

  const pi = histPinIndex(view.id, view);
  let pinFrac = 0;
  let pinCross = "", pinMarks = "";
  if (pi >= 0) {
    pinFrac = scrubFrac(pi, n);
    const px = (pinFrac * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    pinMarks = plotted.filter((s) => histVisibleSeries(view).includes(s)).map((s) => {
      if (s.v[pi] == null) return "";
      const Y = histScale(s.v.map(v => v == null ? null : v / 10), n).Y;
      return `<span class="vhist-mark vhist-pinned ${env3SeriesClass(s.source)}" ` +
        `style="left:${px}%;top:${((Y(s.v[pi] / 10) / HIST_H) * 100).toFixed(2)}%"></span>`;
    }).join("");
  }

  const axisSeries = histVisibleSeries(view).find(s => plotted.includes(s));
  const grid = axisSeries
    ? histYGridHtml(histScale(axisSeries.v.map(v => v == null ? null : v / 10), n), axisSeries.unit,
      { labelCls: env3SeriesClass(axisSeries.source) })
    : { svg: "", yAxis: "" };
  const axis = `<div class="vhist-axis"><span>${esc(histAxisStart(view, spanH))}</span>` +
    `<span>${esc(histAxisEnd(view))}</span></div>`;
  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.recorded", spanH))}</span>` +
      `<span class="vhist-range">${esc(t("env.history_scales"))}</span></div>` + legend +
    `<div class="vhist-graph${grid.yAxis ? " vhist-has-y" : ""}">` + grid.yAxis +
      histTipsHtml(view, pi, pinFrac) +
      `<div class="vhist-plot" data-hist="${view.id}"${histRevision(view)} data-n="${n}" ` +
        `tabindex="0" role="img" ` +
        `aria-label="${esc(t(pi >= 0 ? "hist.aria_pinned" : "hist.aria", t("env.history_title"),
          pi >= 0 ? scrubText(view, pi) : ""))}">` +
        `<svg viewBox="0 0 ${HIST_W} ${HIST_H}" preserveAspectRatio="none" aria-hidden="true">` +
          `${grid.svg}${areas}${lines}${dots}` +
          `</svg>${nowDots}${pinCross}${pinMarks}` +
        `<span class="vhist-cross vhist-live" hidden></span>` +
        plotted.map((s) => `<span class="vhist-mark vhist-live ${env3SeriesClass(s.source)}" ` +
          `data-source="${s.source}" hidden></span>`).join("") +
      `</div>` + axis + histTimesHtml(view, pi, pinFrac) +
    `</div>` + histUnavailableHtml(view),
    "vhist-multi"
  );
}

// ── Scrubbing a trend (hover with a mouse, drag with a finger — one code path) ─────────────────
// Pointer Events rather than mouse+touch pairs: one set of handlers covers mouse, touch and pen,
// and pointer capture keeps a drag tracking after it leaves the plot. The plot is `touch-action:
// pan-y` (CSS), which is the load-bearing half on a phone — it hands VERTICAL gestures back to the
// page so the user can still scroll past the chart, while horizontal movement becomes a scrub.
// Claiming both axes would trap the page scroll inside an 88 px box.

// Where a sample sits, as a fraction 0..1 of the plot width. Mirrors X() in histHtml — a lone
// sample is drawn at the right edge, which is also where "now" is.
function scrubFrac(i, n) { return n <= 1 ? 1 : i / (n - 1); }
function stateSampleFraction(i, n) { return (i + 0.5) / n; }

function scrubCount(plot) { return scrubView(plot)?.v.length || 0; }

// ── Pinning ─────────────────────────────────────────────────────────────────────────────────────
// A tap PINS the readout so the value stays legible after the finger lifts; holding is no longer
// required. Hover remains transient and paints its preview in front of the pin without changing it.
//
// A boot-relative bucket survives a wall-clock correction. For a wall-only ring, replacement
// cannot distinguish an advanced ring from a corrected clock, so the pin belongs to its revision.
function histPinIndex(id, h) {
  const p = S.histPin.get(id);
  if (!p || !h) return -1;
  if (p.live) {
    if (h.liveIndex != null && p.source === (h.scope ?? "") && p.sources === histPinSources(h) &&
        p.sample === liveHistoryPinSample(id, p.source, h)) return h.liveIndex;
    if (p.source === (h.scope ?? "")) S.histPin.delete(id);
    return -1;
  }
  if (!h.v.length) return -1;
  if (p.bucket != null) {
    if (!Number.isInteger(h.b0)) return -1;
    return recordedPinIndex(id, h, p, p.bucket - h.b0);
  }
  return p.i < h.v.length && p.gen === histPlottedPinRevision(h) &&
    p.sources === histPinSources(h) ? p.i : -1;
}

function recordedPinIndex(id, h, point, i) {
  if (i >= (h.recordedN ?? h.v.length)) return -1;
  const sources = histPinSeries(h).filter(s => point.lanes.includes(s.source));
  if (!sources.length) return -1;
  if (i < 0) {
    if ((point.source ?? "") === (h.scope ?? "") &&
        sources.some(s => i >= s.offset && i < s.offset + (s.raw.expired || 0))) S.histPin.delete(id);
    return -1;
  }
  const kept = sources.some(s => point.witnessed
    ? s.v[i] != null || histHeld(s, i)
    : i >= s.offset + (s.raw.expired || 0) && i < s.offset + (s.raw.v?.length ?? 0));
  if (!kept) {
    if ((point.source ?? "") === (h.scope ?? "")) S.histPin.delete(id);
    return -1;
  }
  return i;
}

function histPinSeries(h) {
  return histVisibleSeries(h);
}

// Numeric and categorical charts can toggle visible instruments without replacing either ring,
// so the selected visible sources are part of an undated or live sample identity.
function histPinSources(h) {
  return histPinSeries(h).map(s => s.source).join(",");
}

// The recorded pin depends on the rings and their alignment, independent of the live cap.
function histPlottedPinRevision(h) {
  const rings = histPinSeries(h).map(s => [s.source, s.raw?.gen, s.raw?.expired, s.raw?.t0, s.offset].join(":"));
  return [h.t0, ...rings].join("/");
}

function liveHistoryPinSample(id, source, h = historyView(id, source)) {
  const sources = source ? [source] : (h ? histVisibleSeries(h).map(s => s.source) : ["x10a", "modbus"]);
  return JSON.stringify(sources.map(kind => stateHistoryCurrent(id, kind).value));
}

function expireLiveHistoryPins() {
  for (const [id, pin] of S.histPin) {
    if (pin.live && pin.sample !== liveHistoryPinSample(id, pin.source)) S.histPin.delete(id);
  }
}

function expireFallbackHistoryPins() {
  for (const [id, pin] of S.histPin) {
    if (pin.source || !hasModbusHist(id)) continue;
    const view = historyView(id);
    if (!view || histPinIndex(id, view) < 0) S.histPin.delete(id);
  }
}
// Pin sample `i` of `label`, or UNPIN when that same sample is already pinned — tapping the readout
// you just made is the obvious way to dismiss it, and needs no extra affordance on an 88 px plot.
function histPinToggle(id, i, source = "", captured, pressureInspector = false) {
  const h = captured || historyView(id, source);
  const total = h?.v.length || 0;
  if (!total) return;
  i = Math.max(0, Math.min(total - 1, i));
  // A pin arriving from the value list still shows the reading, but touching the inspector's
  // plot must select it here before it can be tapped again to dismiss its explanation.
  if (histPinIndex(id, h) === i && (!pressureInspector || S.histPin.get(id)?.pressureInspector)) S.histPin.delete(id);
  else if (i === h.liveIndex) S.histPin.set(id, { sources: histPinSources(h), source,
    live: true, sample: liveHistoryPinSample(id, source, h) });
  else if (Number.isInteger(h.b0)) {
    const visible = histPinSeries(h);
    const witnessed = visible.filter(s => s.v[i] != null || histHeld(s, i));
    S.histPin.set(id, { source, bucket: h.b0 + i,
      witnessed: witnessed.length > 0,
      lanes: (witnessed.length ? witnessed : visible).map(s => s.source) });
  } else S.histPin.set(id, { i, gen: histPlottedPinRevision(h), sources: histPinSources(h), source });
  if (pressureInspector && S.histPin.has(id)) S.histPin.get(id).pressureInspector = true;
  // Render PAST the click guard. That guard exists to stop a POLL from replacing the DOM in the
  // middle of a click; it must not delay the very update the click just asked for — a pin that
  // appeared 600 ms after the finger lifted would read as the same "it didn't take" the pin was
  // added to fix. The scrub guard is left alone: a drag still in progress owns the DOM.
  if (S.scrub) return;
  S.clickHold = false;
  renderTrendHosts();
}

// Selected time belongs on the axis, including relative ages when the source has no wall clock.
function histAxisClock(h, index) { return fmtUnixHm(h.t0 + index * h.dt); }

function histAxisStart(h, spanH) {
  if (!histAxisRetained(h)) return t("hist.ago", spanH);
  const end = h.recordedN ?? h.v.length;
  return h.t0 != null && end > 0 ? histAxisClock(h, 0) : "";
}

function histAxisEnd(h) {
  if (!histAxisRetained(h)) return t("hist.now");
  const end = h.recordedN ?? h.v.length;
  return h.t0 != null && end > 1 ? histAxisClock(h, end - 1) : "";
}

function histAxisRetained(h) {
  const visible = histPinSeries(h).filter(s => s.v.some(value => value != null));
  return visible.length ? visible.every(s => histRetained(s.raw)) : histRetained(h);
}

function retainedSampleTime(i, last, dt) {
  if (i > last) return "";
  return i === last ? t("hist.retained")
    : t("hist.before_retained", histFmt1(((last - i) * dt) / 3600));
}

function scrubTime(h, i) {
  if (h.liveIndex === i) return t("hist.now");
  const stamp = h.t0 != null ? h.t0 + i * h.dt : null;
  if (stamp != null) return fmtUnixHm(stamp);
  const end = h.recordedN ?? h.v.length;
  if (histAxisRetained(h)) {
    const last = Math.max(-1, ...histPinSeries(h).map(s => lastSample(s.v, end)));
    return retainedSampleTime(i, last, h.dt);
  }
  const ageH = ((end - 1 - i) * h.dt) / 3600;
  return ageH < 0.05 ? t("hist.now") : t("hist.rel", histFmt1(ageH));
}

// Floating readout bubbles above the plot share one container without reserving empty space when
// closed; the live bubble paints over the pinned bubble when both are visible.
function histTipsHtml(h, pi, frac, aux = dhwAuxPhases(h)) {
  const pinned = pi >= 0 ? histReadout(h, pi, aux) : "";
  return `<div class="vhist-tips"><div class="vhist-tip vhist-live mono num" hidden></div>` + (pinned
    ? `<div class="vhist-tip vhist-pinned mono num" style="--tip-p:${(frac * 100).toFixed(3)}">${pinned}</div>`
    : "") + `</div>`;
}

function histTimesHtml(h, pi, frac) {
  return (pi >= 0
    ? `<span class="vhist-time vhist-pinned mono num" style="--tip-p:${(frac * 100).toFixed(3)}">${esc(scrubTime(h, pi))}</span>`
    : "") + `<span class="vhist-time vhist-live mono num" hidden></span>`;
}

function env3TipData(h, i, allSeries = false) {
  const series = allSeries ? h.series : histVisibleSeries(h);
  return series.filter((s) => s.v[i] != null).map((s) => ({
    cls: env3SeriesClass(s.source),
    label: s.name,
    val: histFmt1(s.v[i] / 10) + (s.unit ? " " + s.unit : ""),
  }));
}

function stateTipEntries(h, i, cfg) {
  const stateStatus = (v) => {
    if (v == null) return null;
    const raw = cfg.rawLabel ? cfg.rawLabel(v) : "";
    if (raw) return raw;
    const key = cfg.compactValueLabel ? cfg.compactValueLabel(v) : "";
    if (key) return t(key);
    const state = cfg.classify(v);
    return state == null ? null : t(state ? "state.on" : "state.off");
  };
  const phaseText = (s, status) => {
    if (h.liveIndex === i) return `${t("hist.now")} · ${status}`;
    const [from, count] = sampleRunAt(
      h.liveIndex == null ? s.v : s.v.slice(0, h.recordedN), i);
    const when = stateRunWhen(h, from, count, s);
    return when ? `${when} · ${status}` : status;
  };
  const visible = histVisibleSeries(h);
  const rows = [];
  for (const s of visible) {
    const status = stateStatus(s.v[i]);
    if (status != null) rows.push({
      source: s.source,
      label: s.source === "modbus" ? "Modbus" : s.name,
      text: phaseText(s, status),
    });
  }
  if (!rows.length && visible.length && cfg.readoutMissing) {
    const when = scrubTime(h, i);
    return { multi: false, rows: [{ text: [when, t("hist.nm")].filter(Boolean).join(" · ") }] };
  }
  return { multi: visible.length > 1, rows };
}

function numericTipEntries(h, i, aux) {
  const visible = histVisibleSeries(h);
  const rows = [];
  for (const s of visible) {
    const v = s.v?.[i];
    if (v == null) continue;
    let text = histFmt1(v / 10) + (s.unit ? " " + s.unit : "");
    // The HomeHub outdoor register has no source timestamp, so its popup also states the complete
    // observed plateau and the unknown measurement age.
    if (h.id === "outdoor_air" && s.source === "modbus") {
      const [from, count] = sampleRunAt(s.v, i);
      text += ` · ${t("hist.modbus_plateau", stateRunWhen(h, from, count, s), histDuration(count * h.dt))}`;
    }
    rows.push({ source: s.source, label: s.source === "modbus" ? "Modbus" : s.name, text });
  }
  const shownOverlays = (h.stateOverlays || []).filter((ov) => !ov.hidden);
  for (const ov of shownOverlays) {
    const stateText = numericStateOverlayStateText(ov.spec, ov.samples[i]);
    if (stateText) rows.push({ source: ov.source, label: ov.name, text: stateText });
  }
  const active = h.tankAux
    ? (aux ? aux.filter((phase) => phase.flags[i]) : DHW_PHASE_SERIES.filter((phase, j) =>
        dhwPhaseVisible(h, phase.source) &&
        alignAuxSample(h, h.tankAux[j], i, phase.source) === phase.active)).map(dhwPhaseLabel)
    : [];
  let pressureNote = "";
  if (h.id === "water_pressure") {
    const x10a = visible.find((s) => s.source === "x10a");
    const pv = x10a?.v?.[i];
    if (pv != null) {
      if (pv <= PRESSURE_CRIT_BAR * 10) pressureNote = t("check.detail.pressure.warn");
      else if (pv <= PRESSURE_LOW_BAR * 10) pressureNote = t("check.detail.pressure.info");
    }
  }
  return { multi: visible.length > 1 || shownOverlays.length > 0, rows, note: pressureNote || active.join(" + ") };
}

// Accessibility keeps time and readings together. Visible numeric bubbles omit the selected time;
// state phase intervals remain evidence about the whole phase, distinct from the selected instant.
// Missing values are omitted rather than printed in the tooltip; if no visible source has a
// sample at the selected instant, the bubble stays hidden while the axis still shows the time.
function scrubText(h, i, includeTime = true, aux) {
  if (env3ChartId(h.id)) {
    const lines = env3TipData(h, i, includeTime).map((r) => `${r.label}  ${r.val}`);
    if (includeTime) lines.unshift(scrubTime(h, i));
    return lines.join("\n");
  }
  const cfg = STATE_HIST[h.id];
  if (cfg) {
    const { multi, rows } = stateTipEntries(h, i, cfg);
    if (!rows.length) return "";
    return multi ? rows.map((r) => `${r.label} ${r.text}`).join("\n") : rows[0].text;
  }
  const { multi, rows, note } = numericTipEntries(h, i, aux);
  let val = rows.map((r) => (multi ? `${r.label} ` : "") + r.text).join("\n");
  if (note) val += (val ? (multi ? "\n" : " · ") : "") + note;
  return !includeTime ? val : val ? `${scrubTime(h, i)} · ${val}` : scrubTime(h, i);
}

// The combined ENV III tooltip is the one place where three independently scaled instruments are
// read together. Colour the complete measurement row (name AND value) with the same token as its
// area and legend. `scrubText()` remains the authoritative
// content formatter for accessibility and tests. Every line is escaped before this helper returns
// markup, so switching the live bubble from textContent to innerHTML below does not create an HTML
// injection path through translations, units or device data.
function histReadout(h, i, aux) {
  if (env3ChartId(h.id)) {
    const rows = env3TipData(h, i);
    if (!rows.length) return "";
    return `<span class="vhist-tip-rows">` + rows.map((r) =>
        `<span class="${r.cls}">${esc(r.label)}</span><span class="${r.cls}">${esc(r.val)}</span>`
      ).join("") + `</span>`;
  }
  const tipRows = (rows, tail = "") => `<span class="vhist-tip-rows">${rows.map((r) =>
    `<span class="vhist-tip-label${histSourceClass(r.source)}">${esc(r.label)}</span><span class="vhist-tip-val">${esc(r.text)}</span>`
  ).join("")}${tail}</span>`;
  const cfg = STATE_HIST[h.id];
  if (cfg) {
    const { multi, rows } = stateTipEntries(h, i, cfg);
    if (!rows.length) return "";
    return multi ? tipRows(rows) : esc(rows[0].text);
  }
  const { multi, rows, note } = numericTipEntries(h, i, aux);
  if (!rows.length && !note) return "";
  if (!multi) {
    const single = rows[0]?.text || "";
    return esc(note ? (single ? `${single} · ${note}` : note) : single);
  }
  return tipRows(rows, note ? `<span class="vhist-tip-note">${esc(note)}</span>` : "");
}

function placeScrubReadout(graph, h, i, frac) {
  const tip = graph.querySelector(".vhist-tip.vhist-live");
  const time = graph.querySelector(".vhist-time.vhist-live");
  const html = histReadout(h, i);
  const pct = (frac * 100).toFixed(3);
  tip.innerHTML = html;
  tip.style.setProperty("--tip-p", pct);
  tip.hidden = !html;
  time.textContent = scrubTime(h, i);
  time.style.setProperty("--tip-p", pct);
  time.hidden = false;
}

// Paint the crosshair for sample `i` on the existing nodes. A drag never rebuilds the plot;
// only the small escaped readout changes.
function scrubMove(plot, i) {
  const h = scrubView(plot);
  const n = +plot.dataset.n;
  if (!h || !n) return;
  i = Math.max(0, Math.min(n - 1, i));
  const graph = plot.parentElement;
  // .vhist-live, never the bare class: a PINNED crosshair carries the same visual classes and sits
  // EARLIER in the DOM, so a bare querySelector returned the pin — the hover then wrote into it and
  // scrubEnd hid it, silently deleting the readout the user had just pinned.
  const cross = plot.querySelector(".vhist-cross.vhist-live");
  const marks = [...plot.querySelectorAll(".vhist-mark.vhist-live")];
  const w = plot.clientWidth;
  const frac = STATE_HIST[h.id] ? stateSampleFraction(i, n) : scrubFrac(i, n);
  const x = frac * w;

  cross.hidden = false;
  cross.style.left = x.toFixed(1) + "px";
  // One marker per instrument. Both share the crosshair and scale; a gap hides only that source's
  // marker, never the other one.
  const separateScales = env3ChartId(h.id);
  const allPts = h.series.flatMap((s) => s.v.map((z) => z == null ? null : z / 10));
  const sharedY = separateScales ? null : histScale(allPts, n, h.id).Y;
  for (const mark of marks) {
    const s = h.series.find((q) => q.source === mark.dataset.source);
    const v = s ? s.v[i] : null;
    if (v == null || !histVisibleSeries(h).includes(s)) { mark.hidden = true; continue; }
    const Y = separateScales
      ? histScale(s.v.map(z => z == null ? null : z / 10), n).Y : sharedY;
    const zone = h.id === "water_pressure" && s.source === "x10a" ? pressureZoneClass(v / 10) : "";
    mark.classList.toggle("warn", zone === " warn");
    mark.classList.toggle("err", zone === " err");
    mark.hidden = false;
    mark.style.left = x.toFixed(1) + "px";
    mark.style.top = ((Y(v / 10) / HIST_H) * 100).toFixed(2) + "%";
  }
  placeScrubReadout(graph, h, i, frac);
}

function scrubView(plot) {
  const view = historyView(plot.dataset.hist, plot.dataset.source || "");
  return view && (!plot.dataset.rev || plot.dataset.rev === histViewRevision(view)) ? view : null;
}

function scrubIndex(plot, clientX, h = scrubView(plot)) {
  if (!h) return -1;
  const r = plot.getBoundingClientRect();
  const n = +plot.dataset.n;
  const rawFrac = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
  if (STATE_HIST[h.id]) return Math.min(n - 1, Math.floor(rawFrac * n));
  return Math.max(0, Math.min(n - 1, Math.round(rawFrac * (n - 1))));
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
  if (S.scrub === "checkup-cycling") return;
  const pointer = S.trendPointer;
  if (pointer && pointer.plot !== plot) return;
  if (pointer) {
    S.trendPointer = null;
    try { plot.releasePointerCapture(pointer.id); } catch {}
  }
  clearTimeout(scrubWatchdog);
  if (plot) {
    plot.querySelector(".vhist-cross.vhist-live").hidden = true;
    plot.querySelectorAll(".vhist-mark.vhist-live").forEach((m) => { m.hidden = true; });
    const tip = plot.parentElement?.querySelector(".vhist-tip.vhist-live");
    const time = plot.parentElement?.querySelector(".vhist-time.vhist-live");
    if (tip) tip.hidden = true;
    if (time) time.hidden = true;
  }
  if (S.scrub) { S.scrub = null; renderTrendHosts(); }   // resume the frozen trend hosts
}

function historyRowOwner(node, host) {
  return (node?.closest?.(".vitem") || host?.closest?.(".vitem"))
    ?.querySelector("[data-desc]")?.dataset.desc;
}

// Structural poll updates may replace card containers or an inspector's history. Preserve the
// active control in either path so keyboard users can continue exploring the same series.
function replaceHistoryHtml(host, html) {
  const active = globalThis.document?.activeElement;
  const { histId, histSeries, hist, source = "" } = active?.dataset || {};
  const owner = node => historyRowOwner(node, host);
  // The cycling chart may be mounted inside its own slot before the surrounding row is rendered.
  const signature = node => JSON.stringify([node.hasAttribute("data-cycling")
    ? "model:health_cycling" : owner(node), node.outerHTML]);
  const focusedOwner = owner(active);
  const cycling = active?.closest?.("[data-cycling]");
  const focused = host.contains?.(active);
  const diagnosisCard = host.getAttribute?.("data-dashboard-card") === "diagnosis";
  // Also reconcile plain read-only rows. Other hosts without charts keep full writes:
  // a control's live value is not represented by its attributes.
  if (!html.includes('class="vhist') && host.id !== "valueGroups" && host.id !== "inspRows" && !diagnosisCard)
    host.innerHTML = html;
  else {
    const roots = root => [...root.querySelectorAll(".vhist")]
      .filter(node => !node.parentElement?.closest(".vhist"));
    const template = document.createElement("template");
    template.innerHTML = html;
    // Retaining a chart's identity is insufficient in WebKit: moving it through a detached
    // template still invalidates its painting ancestors. Scalar polls can update text in place.
    // Preflight the complete tree before applying anything; structural changes keep the fallback.
    const text = [], scopedUpdates = [];
    // Card navigation owns group visibility after rendering; it is not source markup drift.
    const attrs = node => [...node.attributes].filter(attr =>
      attr.name !== "hidden" || !node.matches(".vgroup[data-dashboard-card]"));
    const same = (a, b) => {
      if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
      if (a.nodeType === 3) {
        if (a.nodeValue !== b.nodeValue) text.push([a, b.nodeValue]);
        return true;
      }
      if (a.nodeType !== 1) return a.isEqualNode(b);
      if (a.classList.contains("vhist"))
        return a._histMarkup === signature(b);
      // Inactive dashboard cards keep their last chart mounted without generating its markup.
      // On selection, catch up inside the slot without replacing another card's plot.
      const chart = b.getAttribute("data-chart");
      if (chart !== null && a.dataset.epoch !== b.dataset.epoch) return false;
      if (chart) return true;
      const nextAttrs = attrs(b);
      if (chart === null && (attrs(a).length !== nextAttrs.length ||
          nextAttrs.some(attr => a.getAttribute(attr.name) !== attr.value))) return false;
      // The live cycling chart owns its slot and updates independently of value rows.
      if (a.getAttribute("data-checkup-hours") !== null) return true;
      const before = text.length;
      if (a.childNodes.length === b.childNodes.length &&
          [...a.childNodes].every((node, index) => same(node, b.childNodes[index]))) return true;
      // A diagnosis may gain a badge or completed-run rows while another card is visible.
      // Refresh its contents alone if the surrounding value grid is otherwise compatible.
      if (chart === null && (host.id !== "valueGroups" ||
          a.parentNode !== host || a.getAttribute("data-dashboard-card") !== "diagnosis")) return false;
      text.length = before;
      scopedUpdates.push([a, b]);
      return true;
    };
    const textOnly = host.childNodes && template.content.childNodes &&
      host.childNodes.length === template.content.childNodes.length &&
      [...host.childNodes].every((node, index) => same(node, template.content.childNodes[index]));
    if (textOnly) {
      for (const [node, value] of text) node.nodeValue = value;
      for (const [a, b] of scopedUpdates) replaceHistoryHtml(a, b.innerHTML);
      return;
    }
    const prior = roots(host);
    const rebuilding = S.trendRebuilding;
    S.trendRebuilding = true;
    try {
      for (const node of roots(template.content)) {
        if (!node.hasAttribute("data-cycling") && !node.querySelector("[data-hist]")) continue;
        const sig = signature(node);
        const index = prior.findIndex(old => old._histMarkup === sig);
        if (index < 0) node._histMarkup = sig;
        else node.replaceWith(prior.splice(index, 1)[0]);
      }
      const slot = (host.id === "valueGroups" || diagnosisCard) && host.querySelector("[data-checkup-hours]");
      if (slot) template.content.querySelector("[data-checkup-hours]")?.replaceWith(slot);
      if (host.id === "valueGroups" || host.id === "settingsCards") {
        // A paused slot has no generated markup. Keep its previous chart only for the same
        // disclosure and series in the same card.
        const key = node => JSON.stringify([node.closest("[data-dashboard-card]")?.dataset.dashboardCard,
          owner(node), node.closest(".vitem")?.querySelector("[data-trend]")?.dataset.trend,
          node.dataset.epoch]);
        const slots = new Map([...host.querySelectorAll("[data-chart]")].map(node => [key(node), node]));
        for (const next of template.content.querySelectorAll('[data-chart="1"]')) {
          const id = key(next);
          const old = slots.get(id);
          if (!old) continue;
          slots.delete(id);
          next.replaceWith(old);
        }
      }
      host.replaceChildren(template.content);
    } finally { S.trendRebuilding = rebuilding; }
  }
  if (host.hasAttribute?.("data-checkup-hours") && typeof paintCyclingChart === "function") {
    const chart = host.querySelector("[data-cycling]");
    if (chart) paintCyclingChart(chart);
  }
  if (focused && active.isConnected) active.focus({ preventScroll: true });
  else if (focused && active?.hasAttribute?.("data-flow-min-show"))
    host.querySelector("[data-flow-min-show]")?.focus({ preventScroll: true });
  else if (focused && active?.hasAttribute?.("data-dhw-cool-show"))
    host.querySelector("[data-dhw-cool-show]")?.focus({ preventScroll: true });
  else if (focused && (hist || histSeries))
    [...host.querySelectorAll(hist ? "[data-hist]" : "[data-hist-series]")].find(node =>
      owner(node) === focusedOwner && (hist
        ? node.dataset.hist === hist && (node.dataset.source || "") === source
        : node.dataset.histId === histId && node.dataset.histSeries === histSeries))
      ?.focus({ preventScroll: true });
  else if (focused && (cycling || active?.dataset?.desc)) {
    const chart = cycling && host.querySelector("[data-cycling]");
    const sameScope = chart && chart.dataset.cycling === cycling.dataset.cycling;
    const next = sameScope && (
      (active.dataset.runRow && chart.querySelector(`tr[data-run-row="${active.dataset.runRow}"]`)) ||
      (active.dataset.bucket != null && chart.querySelector(`[data-bucket="${active.dataset.bucket}"]`)) ||
      chart.querySelector("[tabindex='0']")
    );
    (next || [...host.querySelectorAll("[data-desc]")].find(button => button.dataset.desc === focusedOwner) ||
      host.closest?.(".vitem")?.querySelector("[data-desc]"))
      ?.focus({ preventScroll: true });
  }
}

// The three places a trend is drawn — the value row's explainer, the schematic inspector and the
// ESP32 card's memory rows — resume together. They are frozen by the same S.scrub and two of them
// can hold the SAME series at once, so a resume that refreshed only one would leave another showing
// a pin the user has since moved.
function renderTrendHosts() {
  const active = typeof document === "undefined" ? null : document.activeElement;
  const host = active?.closest?.("#valueGroups, #inspHist, #settingsCards");
  const id = active?.dataset?.hist, source = active?.dataset?.source || "", cursor = active?.dataset?.cur;
  const activeOwner = historyRowOwner(active);
  S.trendRebuilding = true;
  try { renderCards(); renderInspect(); renderSettings(); }
  finally { S.trendRebuilding = false; }
  if (!host || !id) return;
  const next = Array.from(host.querySelectorAll("[data-hist]")).find((plot) =>
    plot.dataset.hist === id && (plot.dataset.source || "") === source && historyRowOwner(plot) === activeOwner);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (cursor != null && next.dataset.rev === active.dataset.rev) {
    next.dataset.cur = cursor;
    scrubMove(next, +cursor);
  }
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
  altherma4_current_operation_mode: Object.freeze(["enum.none", "enum.heating", "enum.cooling"]),
  altherma4_demand_response: Object.freeze([
    "enum.free_running", "enum.forced_off", "enum.forced_on", "enum.recommended_on", "enum.reduced",
  ]),
  altherma4_unit_operation_mode: Object.freeze([
    "mode.stop", "enum.tank_heat_up", "enum.space_heating", "enum.space_cooling", "enum.actuator",
  ]),
  altherma4_quiet_selection: Object.freeze(["state.off", "enum.automatic", "enum.manual"]),
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
  35: "Abtauen oder Wiederanlauf",
  36: "Warmstart",
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
  12: "Warmwasser-Nachheizung freigegeben",
  13: "Warmwasser-Booster-Modus",
  54: "Vorlaufkorrektur der Haupt-Heizzone",
  55: "Kühl-Vorlaufkorrektur der Hauptzone",
  56: "Smart-Grid-Betriebsart",
  57: "Leistungsgrenze für Pufferung",
  58: "Allgemeine Leistungsgrenze",
});
function displayHomeHubLabel(row) {
  const fallback = displayReadingLabel(row && row.label, row);
  if (!row || row.off == null) return fallback;
  if (row.profile === "altherma4") {
    const key = ({9: "a4.quiet_selection", 54: "a4.heating_offset", 55: "a4.cooling_offset",
      58: "a4.imposed_power_limit", 65: "a4.demand_response", 74: "a4.pre_phe_outdoor",
      80: "a4.main_target", 81: "a4.add_target", 82: "a4.abnormality_counter",
      83: "a4.unit_operation"})[row.off];
    if (key) return t(key);
  }
  if (LANG === "de") return HOMEHUB_LABEL_DE[row.off] || fallback;
  return HOMEHUB_LABEL_I18N[LANG]?.[row.off] || fallback;
}

// The expandable row itself — a <button> header plus the collapsible panel beneath it. Shared by
// the value list (vDescRow) and the Model card (modelDescRow) so the two cannot drift into two
// slightly different accordions; `key` is what S.descOpen remembers across renders, and
// `valHtml` is pre-built markup (it carries the unit <span>), so it is NOT escaped here.
// `trendId` is the series the panel carries, if any: the toggle fetches and un-pins by it, so the
// id is derived ONCE (here, where the body was built) instead of again from the key — which for a
// board row is not a catalog label and could not be looked up at all.
function descAccordion(key, label, valHtml, cls, bodyHtml, trendId, unit = "", paused,
                       renderHistory = histHtml, chartFirst = false, ariaValue = "") {
  const open = S.descOpen.has(key);
  const visible = !paused && !(paused === false && S.stage === "settings");
  const chart = open && trendId && visible ? renderHistory(trendId, unit, label) : "";
  const chartHtml = trendId
    ? `<div data-chart="${open && !visible ? 1 : ""}" data-epoch="${S.histEpoch || 0}">${chart}</div>`
    : "";
  const innerBody = chartFirst ? (chartHtml + bodyHtml) : (bodyHtml + chartHtml);
  const diagnosisLabel = key.startsWith("model:health_") || key === "service:refrigerant" || key === "observation:working_figure";
  const aria = ariaValue ? ` aria-label="${esc(`${label}: ${ariaValue}`)}"` : "";
  return `<div class="vitem${open ? " open" : ""}">` +
    `<button class="vrow vrow-desc" type="button" data-desc="${esc(key)}"` +
    (trendId ? ` data-trend="${esc(trendId)}" data-unit="${esc(unit)}"` : "") +
    `${aria} aria-expanded="${open ? "true" : "false"}">` +
    `<span class="vrow-label"${diagnosisLabel ? ` title="${esc(label)}"` : ""}>${esc(label)}</span>` +
    `<span class="vrow-end"><span class="vrow-val ${cls}">${valHtml}</span>${chevIcon}</span>` +
    `</button>` +
    `<div class="vdesc"><div class="vdesc-inner"><div class="vdesc-body">${innerBody}</div></div></div>` +
    `</div>`;
}

const numericHistoryMarkup = new WeakMap();
function cachedHistoryHtml(ring, id, unit, label, source = "", identifySource = false) {
  if (ring?.err || !ring?.v?.length) return histHtml(id, unit, label, source, identifySource);
  const signature = JSON.stringify([id, unit, label, source, identifySource, S.histEpoch, LANG,
    historyRingRevision(ring), id === "flow" && modbusFlowScaleUnverified()]);
  const pin = S.histPin.get(id);
  const cached = numericHistoryMarkup.get(ring);
  if (cached?.signature === signature && cached.pin === pin) return cached.html;
  const html = histHtml(id, unit, label, source, identifySource);
  numericHistoryMarkup.set(ring, { signature, pin, html });
  return html;
}

function modbusHistoryHtml(id, unit, label) {
  // Other series need live inputs, paired rings or the tank's auxiliary histories.
  if (STATE_HIST[id] || id === "dhw_tank" || hasHist(id) || hasEnv3Hist(id))
    return histHtml(id, unit, label);
  return cachedHistoryHtml(S.hist.get(histCacheKey(id, "modbus")), id, unit, label);
}

// One value row. If a description matches the label, render the accordion; otherwise a plain,
// unchanged row. Most catalog labels are unique within a render; the reused set carries its X10A
// group from the server below. A derived row supplies its own key and visual label while keeping its
// canonical label for description matching.
const CONCEPT_MB_HIST = Object.freeze({ pump_running: "pump_state", space_op: "modbus_space_state" });

function vDescRow(v, paused) {
  const label = v.label || "";
  const shownLabel = v.displayLabel || displayReadingLabel(label, v);
  // Ambiguous rows used to share one label-based key, so expanding either Error Code opened both
  // panels on the next render. The server supplies x10a_group only for that audited collision set;
  // prefixing those keys preserves every existing key while making the colliding rows independent.
  const key = v.key || (v.x10a_group ? `${v.x10a_group}:${label}` : label);
  let cls = v.state || v.class || "";
  // The SECOND source for this row, if the HomeHub carries the same quantity (paired on the concept
  // the firmware resolved — see mbByConcept). Two distinct uses, and they must not be confused:
  //   `mb`  — the comparison shown inside the explainer while BOTH sources are up.
  //   `fb`  — the stand-in shown IN PLACE of the X10A value while the X10A bus is down.
  const mb = mbByConcept(v.concept);
  const fb = mbStandInFor(v);
  const mbHist = (fb || mb)?.history || CONCEPT_MB_HIST[v.concept] || "";
  let rawHid = (v.concept && hasHist(v.concept)) ? v.concept : histIdFor(label);
  if (rawHid === "thermostat_state" &&
      ((v.x10a_group && v.x10a_group !== "hydronic") || (v.reg != null && v.reg !== 0x60))) {
    rawHid = "";
  }
  const hid = rawHid || (hasModbusHist(mbHist) ? mbHist : ""); // X10A trend or paired Modbus timeline
  // A row stops being a reading for two reasons — the X10A bus is silent, or the outdoor unit is no
  // longer refreshing this page — and both get the same treatment: the HomeHub reading stands in
  // where it carries the same quantity, marked as such, and where it does not the row shows nothing
  // at all. Blanking is the right answer, not a stale X10A number: this table is the "exact-value
  // reference", so it is the LAST place a value the unit is not measuring may appear as an ordinary
  // current row while the pill above it, the inspector, the chart and MQTT all refuse it.
  const notCurrent = x10aDown() || rowNotMeasuring(v);
  const src = fb || v;
  // An unverified stand-in (Altherma 4 or probing/fallback flow) needs its own scaling
  // caveat rather than the unavailable X10A instrument's explanation. Baseline EKRHH retains
  // its established path.
  const sourceFallback = fb?.profile === "altherma4" || (fb?.off === 49 && fb?.flow_scale_unverified === true);
  const d = descFor(sourceFallback ? fb.label : label, sourceFallback ? fb : v);
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
  // This table states the number as the exact reference, so it has to carry the doubt about its age.
  const unknownAge = v.held_unknown === true && S.live?.ouUnknown && v.value != null && !fb && !notCurrent
    ? heldUnknownNoteHtml() : "";
  if (!d && !hid && !cmp && !dwell && !unknownAge) {
    return `<div class="vrow"><span class="vrow-label">${esc(shownLabel)}</span>` +
      `<span class="vrow-val ${cls}">${val}</span></div>`;
  }
  // Body = how long it has read this, then the explainer, then the second source's reading, then the
  // trend. Any part may be absent, which is why the builder takes finished markup rather than a
  // description. The age goes FIRST because it is the only LIVE fact in the panel — the explainer
  // below it is the same sentence on every device and at every hour.
  return descAccordion(key, shownLabel, val, cls,
                       dwell + unknownAge + (d ? descBodyHtml(d, src.value, descriptionCopy(d)) : "") +
                       mbNoteHtml(v, cmp), hid, displayUnit(v), paused);
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
// ID" — for what?) in vocabulary taken from the bus. legacy-184 added the two rows precisely so an
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
    what: "Shows error and warning codes reported by the heat pump; short descriptions are general Daikin hints, and a cleared code does not prove the cause was fixed." },
  health_dhw_loss: {
    what: "Largest accepted hourly temperature drop at tank sensor R5T in the tank inspector.",
    normal: "Windows ≥0.8 K/h are highlighted on the tank chart. R5T is one point in a stratified tank, not measured tank energy. Internal pump and draw-like markers suggest possible causes without proving one or ruling out other losses." },
  health_cycling: {
    what: "Gaps in the readings can leave some starts uncounted.",
    normal: "There is no fixed normal number of starts. With enough data, this check considers completed heating runs averaging at least 10 minutes long enough." },
  health_defrost: {
    what: "Defrosting removes frost from the outdoor unit.",
    normal: "The project flags a share above 15% if the compressor state was readable at three or more starts." },
  health_pressure: {
    what: "24-hour water-pressure curve in the sealed hydronic circuit (X10A, 5-minute minimums).",
    normal: "Chart guide: >1.0 bar normal, ≤1.0 bar low, ≤0.5 bar critical (diagnosis flags ≥60 continuous seconds). Permitted filling and operating pressure depends on the exact unit manual and system height; the reading alone does not identify leaks, air or vessel faults." },
  health_flow: {
    what: "Lowest flow after 60 seconds of continuous internal pump operation. Separate water spread, flow and pump command statistics use samples after the 600-second heating run-up.",
    normal: "Not nominal flow or proof of part load. These readings cover the unit’s common water-side heat exchanger. Pump command does not measure speed or available head. The project filter allows gaps of up to 15 seconds. Its results establish neither steady operation nor a hydraulic cause." },
  health_heater: {
    what: "Observed ON time of the circuit heater (BUH) and tank heater (BSH).",
    normal: "There is no fixed normal runtime; it depends on heating and hot-water demand. Runtime is not energy consumption and cannot establish unnecessary heating." },
  health_retries: {
    what: "Comparable rises in five experimental counters, including while stopped or at a compressor-state boundary.",
    normal: "No verified normal range for these experimental counters. Gaps, resets and non-rises do not count. Stable counters cannot rule out limiting or identify a cause." },
  // The two board-memory rows on the ESP32 card. The copy has one job beyond naming the number: to
  // say what the SHAPE of the curve means, because that is the whole reason these rows exist rather
  // than living on /status alone.
  free_heap: {
    what: "RAM that is currently unused by the firmware. Short changes are normal because WiFi, MQTT and web requests allocate temporary memory; the 24-hour trend is more useful than one reading.",
    normal: "a stable line with dips that recover; a lasting decline may mean memory is not being released. A compatible restart with power retained can preserve the RAM trend. When RAM cannot be reused, only compatible dated five-minute buckets saved in the flash journal can return after clock sync. The five-minute grid can hide short interruptions; longer ones can leave gaps. The open bucket and recent unsaved buckets may be missing; without the journal, flash recovery is unavailable." },
  max_alloc: {
    what: "The largest contiguous block of free RAM. Some operations, including TLS setup and OTA work, need one sufficiently large block even when the total free RAM is higher.",
    normal: "it is always at or below total free RAM. If total free RAM stays stable while this value keeps falling, the heap is becoming fragmented; that can make a large allocation fail before all RAM is used." },
  capacity: {
    what: "The outdoor unit's rated capacity, read from its own identification page. It is a size class of the hardware — what the unit is built for, not what it is producing right now." },
  capacity_iu: {
    what: "The INDOOR unit's rated capacity. It is shown because the outdoor unit's identification page contains no separate capacity. The label states exactly which unit supplied the value.",
    normal: "indoor and outdoor units can have different capacity classes. Do not read this as the outdoor unit's or the complete system's rated capacity." },
  // TWO variants, and which one is true depends on whether the outdoor unit reported its capacity.
  // logic/detect.hpp is explicit: candidates that share a page mask AND a kW class are
  // register-identical, so the pick cannot change a reading — but when the O/U capacity is unknown
  // "the candidate set spans DIFFERENT kW classes, so it is NOT register-identical and the
  // representative choice does affect the values". Asserting the reassuring version in both states
  // would put a false claim on screen in exactly the state that produces this row most often (a
  // short 0x00 descriptor), which is the legacy-35–legacy-39 shape in copy rather than in a converter.
  candidates: {
    what: "Several Daikin model families expose the same registers and values on the service interface, so the exact marketing name cannot be distinguished there. The heading deliberately stays \"Daikin Altherma\" instead of guessing a model.",
    normal: "the readings are unaffected: the outdoor unit reported its rated capacity, and all remaining candidates use the same capacity class and register layout. To identify the exact model, compare the outdoor-unit ID below with the nameplate." },
  candidates_nocap: {
    what: "Several Daikin model families expose the same registers on the service interface, so the exact marketing name cannot be distinguished there. The heading deliberately stays \"Daikin Altherma\" instead of guessing a model.",
    normal: "this outdoor unit does not report its own rated capacity, so the candidates can belong to different capacity classes. The firmware decodes the values with the variant that best matches the indoor unit, but not with full certainty. Compare the outdoor-unit ID below with the nameplate." },
  oueeprom: {
    what: "The outdoor unit's identification bytes, shown unchanged from the service interface. No public mapping to marketing names is known, so the firmware displays the ID instead of guessing a model.",
    normal: "for an ambiguous detection, compare it character by character with the outdoor unit's nameplate." },
};

// A Model-card row: the same accordion as a value row when copy exists for it, else the plain row
// vrow() would have produced. The key is prefixed so it can never collide with a catalog label in
// S.descOpen — "Capacity" is both a card row and a plausible label.
function modelDescRow(id, label, value, opt = {}) {
  const d = MODEL_DESCRIPTIONS[id];
  if (!d) return vrow(label, value, opt);
  const val = esc(value) + (opt.unit ? `<span class="vrow-unit">${esc(opt.unit)}</span>` : "");
  return descAccordion(`model:${id}`, label, val, opt.cls || "",
                       opt.bodyHtml ?? descBodyHtml(d, undefined, modelDescriptionCopy(id)),
                       opt.trendId || "", opt.histUnit || "", opt.paused, opt.renderHistory,
                       Boolean(opt.chartFirst), opt.ariaValue || "");
}

// Toggle a value row's description accordion. Only the LIVE element is flipped here (so the CSS
// height transition actually runs); S.descOpen keeps subsequent markup consistent with that choice.
// A <button> header means Enter/Space work
// for free — no extra key handling needed.
function toggleDesc(btn) {
  const item = btn.closest(".vitem");
  if (!item) return;
  const key = btn.dataset.desc || "";
  const trend = btn.dataset.trend || "";
  const open = !item.classList.contains("open");
  if (!open && ((S.trendPointer && item.contains(S.trendPointer.plot)) ||
      (key === "model:health_cycling" && S.scrub === "checkup-cycling"))) cancelHistoryGesture();
  item.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) S.descOpen.add(key);
  else {
    S.descOpen.delete(key);
    S.histPin.delete(trend);
    if (key === "model:health_fault") {
      S.faultCodes.clear();
      S.faultSnapKeys = null;
      S.faultHoverIdx = null;
    }
  }
  // This native toggle changes DOM outside setHtml. A cached open/close between polls must not
  // let the saved closed markup suppress the next render and retain its hidden history SVG.
  const owner = btn.closest("#valueGroups, #settingsCards");
  if (owner) delete _html[owner.id];
  if (key === "model:health_cycling") {
    const slot = item.querySelector("[data-checkup-hours]");
    if (slot && (!open || (S.stage === "dashboard" && !item.closest("[hidden]"))))
      renderCheckupCyclingChart(slot, open);
  }
  // Opening a schematic history also fills the cache used by value rows. Do not build and parse
  // another SVG in every collapsed row on every two-second poll. Mount it only on disclosure,
  // including a cache hit (ensureHistPair then returns without triggering a repaint).
  if (open && trend && !item.querySelector(".vhist")) {
    const body = item.querySelector("[data-chart]") || item.querySelector(".vdesc-body");
    const chart = histHtml(trend, btn.dataset.unit || "", btn.querySelector(".vrow-label").textContent);
    replaceHistoryHtml(body, body.innerHTML + chart);
  }
  // Fetch the trend only once the panel is actually opened — a device that buffers eleven series
  // would otherwise answer a request per row on every page load, for panels nobody looked at.
  if (open && trend) ensureHistPair(trend);
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
    return vcard(t("group.Values"), `<span class="empty">${esc(t("values.waiting"))}</span>`,
                 "values");
  }
  // Reading order is GROUP_ORDER (DESIGN.md §6), NOT the GROUPS array — that one is match
  // precedence, and the two stopped agreeing the moment a key had to be made more specific.
  const order = [...GROUP_ORDER, "Other values"];
  const buckets = new Map();
  for (const v of rows) { const g = groupOf(v); (buckets.get(g) || buckets.set(g, []).get(g)).push(v); }
  const grouped = buckets.size > 1;
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
    const label = grouped ? groupLabel(name) : t("group.Values");
    const navLabel = grouped && name === "Refrigerant / outdoor" ? t("nav.outdoor") : label;
    const key = `group:${name}`;
    html += vcard(label, shown.map(v => vDescRow(v, key !== S.dashboardCard)).join(""), key, navLabel);
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
  // The production descFor(label, row) first selects native profile/offset explanations, then
  // uses the shared DESCRIPTIONS label table. Source-specific meaning survives even where
  // two register catalogs use the same label for different states or measurements.
  //
  // A paired schematic measurement keeps its OWN Modbus ring even when this profile has no X10A row
  // to host it. Historied Modbus setpoints, offsets, power limits, modes, abnormality and ON/OFF
  // states get their own 24-hour charts too; non-trended fault code rows still have no chart. Where
  // copy is missing the row degrades to the same plain line it was before, rather than an empty
  // panel that opens onto nothing.
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
                         d ? descBodyHtml(d, m.value, descriptionCopy(d)) : "", hid, unit,
                         S.dashboardCard !== "modbus", modbusHistoryHtml);
  }).join("");
  // The heading has to match what is IN the card: "Modbus only" is true of the unpaired handful and
  // false the moment `all` folds the paired rows in beside them.
  // Always just "Modbus" — the card is named after its SOURCE, not after how much of the
  // catalog happens to be in it this cycle. "Modbus only" tried to say the second thing and
  // was wrong half the time: with X10A down the paired rows fold in here too, so the card was
  // titled "only" over readings that are anything but.
  return vcard(t("group.Modbus"), html, "modbus");
}
