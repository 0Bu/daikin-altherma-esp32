// ── 24-hour trend (a historied value row's explainer carries a sparkline under the text) ──────
// WHICH rows have a trend is the FIRMWARE's answer, read from /status.history.rows: the device keeps
// a fixed-cadence ring buffer for a small, structurally-picked set of rows (by register page/offset,
// not by label — the catalog spells the same concept ~50 ways across 43 profiles) and reports the
// labels it resolved. The browser never pattern-matches its own candidates: offering a trend for a
// row the device isn't buffering would be a chart that can only ever be empty.
// Each entry is {id, label}: the ID is the concept (logic/history.hpp's TRENDS — "dhw_tank",
// "outdoor_air", "free_heap", …) and is what GET /history takes, while the LABEL is how this profile
// spells the row. Requesting by id keeps the route model-independent; matching by label is how a
// rendered VALUE row finds its own trend. Adding a trend is a row in TRENDS — nothing here changes.
//
// Everything below is keyed by the ID, never by the label. Two reasons, and the second is why this
// was changed: a label is per-profile, so a cache keyed by it would be re-keyed by a model change
// mid-session — and not every trended thing IS a catalog row. The board's own memory (free_heap,
// max_alloc) is drawn on the Settings ESP32 card, whose row labels are TRANSLATED, so there is no
// label to match on at all; it attaches by id like the firmware always intended.
function histSpec() { const h = S.status && S.status.history; return h && Array.isArray(h.rows) ? h : null; }
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
function hasHist(id) {
  const D = DERIVED[id];
  return D ? D.ready(Object.fromEntries(D.ins.map((k) => [k, hasDeviceHist(k)]))) : hasDeviceHist(id);
}

// ── Derived trends: the schematic pills that are COMPUTED, not read ────────────────────────────
// ΔT, heat output, electrical input and COP have no register, so the device has nothing to buffer
// for them. Their 24-hour curve is assembled HERE, out of the rings of what each is computed FROM,
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
  // Amps × an assumed 230 V, CT clamps preferred over the inverter current — liveData()'s rule, one
  // sample at a time. The live version needs `d.ouHeldOver` to gate the INV fallback because
  // /values still carries last run's number; here the ring has already withheld it, so a null is
  // simply a null. `ctLive` keeps the "sum > 0" test: an idle plant reads 0 A on clamps that are
  // fitted, and the fallback is what makes that a compressor figure rather than a flat zero.
  pel: {
    unit: "kW", ins: ["ct_l1", "ct_l2", "ct_l3", "inv_current"],
    ready: (h) => h.inv_current || h.ct_l1 || h.ct_l2 || h.ct_l3,
    fn: (s) => {
      const parts = [s.ct_l1, s.ct_l2, s.ct_l3].filter((x) => x != null);
      const ct = parts.reduce((a, x) => a + x, 0);
      if (parts.length && ct > 0) return (ct * 230) / 1000;
      return s.inv_current == null ? null : (s.inv_current * 230) / 1000;
    },
  },
  // The quotient, and it is deliberately drawn on FEWER samples than its two inputs. Two gates:
  //   running — the live pill's own (rps > 5, ΔT > 0.5); a COP of a stopped plant is not a small
  //             COP, it is not one at all.
  //   scope   — cop_scope.hpp: the CT clamps see the whole unit INCLUDING both resistive heaters
  //             while the heat side is the pre-BUH outlet, so a CT-sourced quotient is only honest
  //             once the heaters are known quiet — and their history is not buffered (three more
  //             rings, for a gate rather than a curve). So a CT-sourced sample draws NOTHING here.
  //             That is the same refusal the live pill makes when it cannot pair the boundaries,
  //             not a rounding of it: an INV-sourced sample has the heaters outside both sides and
  //             needs no such evidence, which is why it is the branch that survives.
  cop: {
    unit: "", ins: ["flow", "leaving_water", "return_water", "comp_rps", "inv_current",
                    "ct_l1", "ct_l2", "ct_l3"],
    none: {
      en: "No curve while the electrical figure comes from the CT clamps — pairing it with the heat side across a whole day would need the backup heaters' own history, which is not buffered.",
      de: "Kein Verlauf, solange der Stromwert von den Stromwandlern kommt — ihn über einen ganzen Tag mit der Wärmeseite zu paaren, bräuchte die Historie der Zusatzheizer, die nicht gepuffert wird.",
    },
    ready: (h) => h.flow && h.leaving_water && h.return_water && h.comp_rps && h.inv_current,
    fn: (s) => {
      const ct = [s.ct_l1, s.ct_l2, s.ct_l3].filter((x) => x != null).reduce((a, x) => a + x, 0);
      if (ct > 0) return null;                         // whole-unit divisor — see the note above
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
// ~1 KB contiguous string on the single httpd task (CLAUDE.md → Memory constraints).
async function ensureHist(id) {
  if (!hasHist(id) || S.histBusy.has(id)) return;
  const c = S.hist.get(id);
  if (c && Date.now() - c.at < 60000) return;
  if (DERIVED[id]) { await ensureDerived(id); return; }
  S.histBusy.add(id);
  try {
    const r = await fetch("/history?row=" + encodeURIComponent(id));
    const j = await r.json();
    // t0 = the unix instant of sample 0, present only when the device's SNTP clock is synced. Null
    // means the scrub readout falls back to an AGE ("vor 6.3 h") — never a fabricated wall-clock
    // time, the same rule logic/timestamp.hpp applies to an unsynced clock on the firmware side.
    // `gen` counts fetches. It is what makes an index-anchored pin (no wall clock on the device)
    // honest: such a pin is only valid for the exact series it was made on, and a refetch may have
    // rolled the ring — so it is dropped rather than re-pointed at a different sample.
    const gen = ((S.hist.get(id) || {}).gen || 0) + 1;
    S.hist.set(id, { at: Date.now(), gen, dt: +j.dt || 300, unit: j.unit || "",
                        t0: typeof j.t0 === "number" ? j.t0 : null,
                        held: Array.isArray(j.held) ? j.held : [],
                        v: Array.isArray(j.v) ? j.v : [] });
  } catch (e) {
    S.hist.set(id, { at: Date.now(), err: true, v: [] });
  } finally {
    S.histBusy.delete(id); renderApp();
  }
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
// Samples are aligned by INDEX, which the firmware makes exact: history.cpp commits every ring on
// the one bucket boundary, so equal lengths mean equal instants. Unequal lengths can still happen —
// an input fetched a bucket earlier than another, or a ring reset by a model change — and the
// answer is to align on the NEWEST sample (both series end at "now") and take the overlap. Padding
// the short one instead would slide a whole curve along the axis, which is the mislabelling
// history.hpp refuses when it fills skipped buckets rather than compressing them.
async function ensureDerived(id) {
  const D = DERIVED[id];
  if (S.histBusy.has(id)) return;
  S.histBusy.add(id);
  try {
    const use = D.ins.filter((k) => hasDeviceHist(k));
    await Promise.all(use.map((k) => ensureHist(k)));
    const src = use.map((k) => [k, S.hist.get(k)]).filter(([, h]) => h && !h.err && h.v.length);
    if (!src.length) { S.hist.set(id, { at: Date.now(), err: true, v: [] }); return; }
    const n = Math.min(...src.map(([, h]) => h.v.length));
    const base = src[0][1];
    const v = [], heldRuns = [];
    for (let i = 0; i < n; i++) {
      const s = {}; let missing = 0, heldMissing = 0;
      for (const [k, h] of src) {
        const j = h.v.length - n + i;                     // tail-aligned: both series end at "now"
        const raw = h.v[j];
        s[k] = raw == null ? null : raw / 10;             // tenths on the wire, units in the formula
        if (raw == null) { missing++; if (histHeld(h, j)) heldMissing++; }
      }
      const out = D.fn(s);
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
    S.hist.set(id, { at: Date.now(), gen, dt: base.dt, unit: D.unit,
                     t0: typeof base.t0 === "number" ? base.t0 + (base.v.length - n) * base.dt : null,
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
function histScale(pts) {
  const real = pts.filter((x) => x != null);
  const lo = Math.min(...real), hi = Math.max(...real);
  const pad = (hi - lo) < 1 ? 1 : (hi - lo) * 0.12;   // a flat series gets a band, not a divide-by-zero
  const y0 = lo - pad, y1 = hi + pad;
  const n = pts.length;
  return {
    lo, hi,
    X: (i) => (n === 1 ? HIST_W : (i * HIST_W) / (n - 1)),
    Y: (v) => HIST_H - ((v - y0) / (y1 - y0)) * HIST_H,
  };
}

// One historied row's trend, as the markup appended under its explainer text. Every state is a
// SENTENCE rather than an empty box: not fetched, no readings yet, fetch failed. `null` samples are
// GAPS (a timed-out register, or a reading reading_plausible() refused) and must break the line —
// interpolating across them would draw a measurement that was never taken, which is exactly the
// failure the blanked pills elsewhere in this UI exist to prevent.
function histHtml(id, unit, name) {
  if (!hasHist(id)) return "";
  const h = S.hist.get(id);
  const wrap = (body, cls) => `<div class="vhist${cls ? " " + cls : ""}">${body}</div>`;
  if (!h) return wrap(`<div class="vhist-note">${esc(t("hist.loading"))}</div>`, "vhist-flat");
  if (h.err) return wrap(`<div class="vhist-note">${esc(t("hist.err"))}</div>`, "vhist-flat");

  const raw = h.v;
  const pts = raw.map((x) => (x == null ? null : x / 10));   // deci-°C on the wire, one decimal here
  const real = pts.filter((x) => x != null);
  // "No readings yet" is the RIGHT sentence for a ring the device has not filled, and the WRONG one
  // for a derived figure that is being withheld on purpose — the COP on a CT-clamp install has a
  // full set of inputs and still draws nothing, so the generic note would call a deliberate refusal
  // an empty buffer, one line under a pill that is showing the very number. A derived series may
  // therefore name its own empty case.
  if (!real.length) {
    const D = DERIVED[id];
    return wrap(`<div class="vhist-note">${esc(D && D.none ? tx(D.none) : t("hist.none"))}</div>`, "vhist-flat");
  }

  const n = pts.length;
  const spanH = Math.max(1, Math.round((n * h.dt) / 3600));
  // The axis states the span the device ACTUALLY holds, never a padded 24 h: the buffer lives in RAM
  // and every /set_* and OTA reboots the board, so a fresh device has minutes of history, not a day.
  // Stretching the axis to 24 h would draw that absence as if it were flat measured data.
  const full  = n * h.dt >= 23.5 * 3600;
  const { lo, hi, X, Y } = histScale(pts);

  // Contiguous runs only: each becomes its own line path (and its own area under it), so a gap is
  // drawn as a gap. A run of ONE sample gets a dot — a lone reading between two gaps is still a
  // measurement and dropping it would understate what the device saw.
  // The area under the curve is dropped once the series is mostly absent. A filled area reads as
  // "this quantity was at this level throughout", and for a sparse trend — the outdoor-air one on a
  // mild day is measured for ~3 of 24 h — the isolated runs render as columns that look like bars of
  // a different chart entirely. The line alone makes no continuity claim it cannot support.
  const dense = real.length >= pts.length * 0.6;
  let line = "", area = "", dots = "", gaps = 0, held = 0, run = [];
  const flush = () => {
    if (!run.length) { return; }
    if (run.length === 1) {
      dots += `<circle class="vhist-pt" cx="${X(run[0]).toFixed(1)}" cy="${Y(pts[run[0]]).toFixed(1)}" r="1.6"/>`;
    } else {
      const d = run.map((i, k) => `${k ? "L" : "M"}${X(i).toFixed(1)} ${Y(pts[i]).toFixed(1)}`).join("");
      line += `<path class="vhist-line" d="${d}" vector-effect="non-scaling-stroke"/>`;
      if (dense) area += `<path class="vhist-area" d="${d}L${X(run[run.length - 1]).toFixed(1)} ${HIST_H}L${X(run[0]).toFixed(1)} ${HIST_H}Z"/>`;
    }
    run = [];
  };
  // Absence is counted in TWO buckets, because they mean different things and the axis says which:
  // a HELD sample is the outdoor unit resting (nothing failed — see histHeld), a GAP is a register
  // that didn't answer or a value reading_plausible() refused. Blaming an idle compressor on the bus
  // is the same class of wrong as drawing its last-run value as live.
  // `gaps` counts contiguous RUNS (one dropout is one gap, however many samples it spans); `held`
  // counts SAMPLES, because what matters there is how much of the day the unit spent asleep, not
  // how many naps it took. prevGap tracks run boundaries so a held stretch between two dropouts
  // doesn't merge them into one.
  let prevGap = false;
  for (let i = 0; i < n; i++) {
    if (pts[i] == null) {
      if (histHeld(h, i)) { held++; prevGap = false; }
      else { if (!prevGap) gaps++; prevGap = true; }
      flush();
    } else { prevGap = false; run.push(i); }
  }
  flush();

  // The "now" marker is an HTML element, not an SVG circle: the SVG is stretched non-uniformly, so
  // a circle in it would render as an ellipse. Percentage positioning maps onto the same 0..HIST_H
  // scale exactly, and stays right whatever width the panel ends up at.
  const last = pts[n - 1];
  const dot = last == null ? ""
    : `<span class="vhist-now" style="top:${((Y(last) / HIST_H) * 100).toFixed(2)}%"></span>`;
  const u = unit ? ` ${unit}` : "";
  const rng = `${lo.toFixed(1)} – ${hi.toFixed(1)}${u}`;

  // The scrub layer: a tooltip band ABOVE the plot (its own reserved strip, so the bubble follows
  // the cursor Grafana-style without ever covering the curve it is reading — on a phone the finger
  // already hides part of the plot, and a bubble under it would hide the rest), plus the crosshair
  // and the marker dot inside the plot. All three start hidden and are moved by scrubMove() writing
  // styles directly — never by re-rendering this HTML, which would fight the pointer.
  // `data-hist` is what the delegated pointer handlers match on, and it carries the sample count so
  // the geometry the handler needs comes from the same render that drew the path.
  // A PINNED readout is emitted as part of the markup, not written onto the DOM afterwards — that is
  // the whole reason it survives the ~1×/s rebuild that made the old hold-to-read behaviour necessary.
  // Its instant is re-resolved here on every render, so the pin follows its measurement as the ring
  // rolls and disappears once that measurement has left the day.
  const pi = histPinIndex(id, h);
  let pinTip = "", pinCross = "", pinMark = "";
  if (pi >= 0) {
    const px = (scrubFrac(pi, n) * 100).toFixed(3);
    pinCross = `<span class="vhist-cross vhist-pinned" style="left:${px}%"></span>`;
    if (pts[pi] != null) pinMark = `<span class="vhist-mark vhist-pinned" style="left:${px}%;top:${((Y(pts[pi]) / HIST_H) * 100).toFixed(2)}%"></span>`;
    // The bubble is clamped by CSS translate + margins rather than measured pixels: this runs at
    // render time, before layout, so offsetWidth is not available the way it is during a scrub.
    pinTip = `<div class="vhist-tip vhist-pinned mono num" style="left:${px}%">${esc(scrubText(h, pi))}</div>`;
  }
  return wrap(
    `<div class="vhist-head"><span class="vhist-t">${esc(full ? t("hist.title") : t("hist.since", spanH))}</span>` +
    `<span class="vhist-range mono num">${esc(rng)}</span></div>` +
    `<div class="vhist-graph${pi >= 0 ? " has-pin" : ""}">` +
      `<div class="vhist-tip vhist-live mono num" hidden></div>` + pinTip +
      `<div class="vhist-plot" data-hist="${esc(id)}" data-n="${n}" tabindex="0" role="img"` +
        ` aria-label="${esc(t(pi >= 0 ? "hist.aria_pinned" : "hist.aria", name || id, pi >= 0 ? scrubText(h, pi) : ""))}">` +
        `<svg viewBox="0 0 ${HIST_W} ${HIST_H}" preserveAspectRatio="none" aria-hidden="true">${area}${line}${dots}</svg>` +
        dot + pinCross + pinMark +
        `<span class="vhist-cross vhist-live" hidden></span><span class="vhist-mark vhist-live" hidden></span>` +
      `</div>` +
    `</div>` +
    `<div class="vhist-axis"><span>${esc(t("hist.ago", spanH))}</span>` +
      // Idle time is reported ahead of dropouts: on an outdoor-air trend it is normally the larger
      // share of the day and the one that explains the shape of the chart.
      (held ? `<span class="vhist-idle">${esc(t("hist.heldnote", ((held * h.dt) / 3600).toFixed(1)))}</span>` : "") +
      (gaps ? `<span class="vhist-gap">${esc(t("hist.gaps", gaps))}</span>` : "") +
      `<span>${esc(t("hist.now"))}</span></div>`
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
function histPinToggle(id, i) {
  const h = S.hist.get(id);
  if (!h || !h.v.length) return;
  i = Math.max(0, Math.min(h.v.length - 1, i));
  if (histPinIndex(id, h) === i) S.histPin.delete(id);
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
  const v = h.v[i];
  // A held sample says the UNIT was resting, not that the reading failed — the same distinction the
  // schematic's blanked outdoor pills make, carried into the trend readout.
  const val = v != null ? (v / 10).toFixed(1) + (h.unit ? " " + h.unit : "")
            : histHeld(h, i) ? t("hist.held") : t("hist.nm");
  let when;
  if (h.t0) {
    when = new Date((h.t0 + i * h.dt) * 1000)
      .toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
  } else {
    const ageH = ((h.v.length - 1 - i) * h.dt) / 3600;
    when = ageH < 0.05 ? t("hist.now") : t("hist.rel", ageH.toFixed(1));
  }
  return when + " · " + val;
}

// Paint the crosshair for sample `i`. Pure DOM writes on the existing nodes — no innerHTML, so a
// drag never rebuilds what it is holding on to.
function scrubMove(plot, i) {
  const h = S.hist.get(plot.dataset.hist);
  const n = +plot.dataset.n;
  if (!h || !n) return;
  i = Math.max(0, Math.min(n - 1, i));
  const graph = plot.parentElement;
  // .vhist-live, never the bare class: a PINNED crosshair carries the same visual classes and sits
  // EARLIER in the DOM, so a bare querySelector returned the pin — the hover then wrote into it and
  // scrubEnd hid it, silently deleting the readout the user had just pinned.
  const tip = graph.querySelector(".vhist-tip.vhist-live");
  const cross = plot.querySelector(".vhist-cross.vhist-live");
  const mark = plot.querySelector(".vhist-mark.vhist-live");
  const w = plot.clientWidth;
  const x = scrubFrac(i, n) * w;

  cross.hidden = false;
  cross.style.left = x.toFixed(1) + "px";
  // The marker only exists where a reading does; on a gap the crosshair stands alone, which is the
  // same "no value here" vocabulary the broken line already speaks.
  const v = h.v[i];
  if (v == null) { mark.hidden = true; } else {
    // Same scale the path was drawn with (histScale) — never a second copy of the padding rule.
    const { Y } = histScale(h.v.map((z) => (z == null ? null : z / 10)));
    mark.hidden = false;
    mark.style.left = x.toFixed(1) + "px";
    mark.style.top = ((Y(v / 10) / HIST_H) * 100).toFixed(2) + "%";
  }
  tip.hidden = false;
  tip.textContent = scrubText(h, i);
  // Clamp inside the plot so the bubble never hangs off the card edge; measured after the text is
  // written, since its width depends on it.
  const half = tip.offsetWidth / 2;
  tip.style.left = Math.max(half, Math.min(w - half, x)).toFixed(1) + "px";
}

function scrubIndex(plot, clientX) {
  const r = plot.getBoundingClientRect();
  const n = +plot.dataset.n;
  return Math.round(((clientX - r.left) / (r.width || 1)) * (n - 1));
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
    plot.querySelector(".vhist-mark.vhist-live").hidden = true;
    plot.parentElement.querySelector(".vhist-tip.vhist-live").hidden = true;
  }
  if (S.scrub) { S.scrub = null; renderTrendHosts(); }   // resume the frozen per-poll rebuild
}

// The three places a trend is drawn — the value row's explainer, the schematic inspector and the
// ESP32 card's memory rows — resume together. They are frozen by the same S.scrub and two of them
// can hold the SAME series at once, so a resume that refreshed only one would leave another showing
// a pin the user has since moved.
function renderTrendHosts() { renderCards(); renderInspect(); renderSettings(); }

const chevIcon = `<svg class="vrow-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

const ENUM_VALUE_I18N = Object.freeze({
  "Auto": "enum.auto", "Heating": "enum.heating", "Cooling": "enum.cooling",
  "No error": "enum.no_error", "Fault": "enum.fault", "Warning": "enum.warning",
  "Space heating": "enum.space_heating", "DHW": "enum.dhw",
  "Free running": "enum.free_running", "Forced off": "enum.forced_off",
  "Recommended on": "enum.recommended_on", "Forced on": "enum.forced_on",
});

// HomeHub enum values stay numeric in /values, MQTT and Home Assistant. /values carries this
// separate semantic id so only the visual browser boundary turns e.g. smart_grid_mode=2 into the
// manufacturer's readable state. Unknown numbers remain visible as Unknown (N), never coerced.
const HOMEHUB_ENUM_VALUE_I18N = Object.freeze({
  unit_abnormality: Object.freeze(["enum.no_error", "enum.fault", "enum.warning"]),
  operation_mode: Object.freeze(["enum.auto", "enum.heating", "enum.cooling"]),
  three_way_valve: Object.freeze(["enum.space_heating", "enum.dhw"]),
  smart_grid_mode: Object.freeze([
    "enum.free_running", "enum.forced_off", "enum.recommended_on", "enum.forced_on",
  ]),
});

// Most converter-300..307 rows are genuine flags and remain ON/OFF. These two structural ids are
// selectors: their bit chooses a path/mode, so name that selected state instead of displaying the
// electrical bit. The public value itself remains 0/1.
const BINARY_VALUE_I18N = Object.freeze({
  valve_dhw: Object.freeze({ "0": "enum.space_heating", "1": "enum.dhw" }),
  valve_heat: Object.freeze({ "0": "enum.cooling", "1": "enum.heating" }),
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

// The generated X10A catalog sometimes appends the register's value legend to its technical name
// ("Reheat ON/OFF", "3way valve(On:DHW_Off:Space)") and sometimes does not ("Defrost Operation").
// The value column already shows ON/OFF, so carrying the legend in the row name is redundant and
// inconsistent. Clean it only at the visual boundary: matching descriptions, history identities,
// selectors and every API/MQTT payload continue to use the exact catalog label.
function displayReadingLabel(label) {
  const raw = String(label ?? "").trim();
  const cleaned = raw
    .replace(/\s*\([^)]*On\s*:[^)]*Off\s*:[^)]*\)\s*$/i, "")
    .replace(/[\s.]+ON\/OFF\s*$/i, "")
    .trim();
  return cleaned || raw;
}

// HomeHub API labels remain the manufacturer's stable English register names. The German UI names
// the same rows at the visual boundary, keyed by the documented offset rather than by prose, so a
// label edit cannot silently attach the wrong translation to another register.
const HOMEHUB_LABEL_DE = Object.freeze({
  21: "Diagnosezustand der Anlage",
  22: "Fehlercode der Anlage",
  23: "Fehlersubcode der Anlage",
  30: "Umwälzpumpe aktiv",
  37: "Position des 3-Wege-Ventils",
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
  56: "Smart-Grid-Betriebsart",
  57: "Leistungsgrenze für Pufferung",
  58: "Allgemeine Leistungsgrenze",
});
function displayHomeHubLabel(row) {
  const fallback = displayReadingLabel(row && row.label);
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
// unchanged row. Catalog labels are unique within a render; a derived row supplies its own key and
// visual label while keeping its canonical label for description matching.
function vDescRow(v) {
  const label = v.label || "";
  const shownLabel = v.displayLabel || displayReadingLabel(label);
  const key = v.key || label;
  let cls = v.state || v.class || "";
  const d = descFor(label);
  const hid = histIdFor(label);          // this profile's spelling -> the concept the device buffers
  // The SECOND source for this row, if the HomeHub carries the same quantity (paired on the concept
  // the firmware resolved — see mbByConcept). Two distinct uses, and they must not be confused:
  //   `mb`  — the comparison shown inside the explainer while BOTH sources are up.
  //   `fb`  — the stand-in shown IN PLACE of the X10A value while the X10A bus is down.
  const mb = mbByConcept(v.concept);
  const fb = mbFallbackFor(v.concept);
  // While X10A is down: a row the HomeHub can supply shows the Modbus reading, marked as such; a row
  // it cannot shows nothing at all. Blanking is the right answer there, not a stale X10A number —
  // the same refusal the held-over outdoor pills already make (logic/ou_stale.hpp).
  const src = fb || v;
  if (fb) cls = (cls ? cls + " " : "") + "src-val-mb";
  const val = (x10aDown() && !fb)
    ? "—"
    : esc(displayValue(src)) + (v.unit ? `<span class="vrow-unit">${esc(v.unit)}</span>` : "");
  if (!d && !hid && !mb) {
    return `<div class="vrow"><span class="vrow-label">${esc(shownLabel)}</span>` +
      `<span class="vrow-val ${cls}">${val}</span></div>`;
  }
  // Body = the explainer, then the second source's reading, then the trend. Any part may be absent,
  // which is why the builder takes finished markup rather than a description.
  return descAccordion(key, shownLabel, val, cls,
                       (d ? descBodyHtml(d, src.value) : "") + mbNoteHtml(v, mb) +
                       histHtml(hid, v.unit, shownLabel), hid);
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
  // established, or what they would do about it. So each entry answers what was counted, the limit
  // of the claim, and what follow-up is supported.
  //
  // They also have to say what the row does NOT claim. Two of these checks are deliberately weaker
  // than they look — the flow minimum carries no verdict at all because the manufacturer's minimum
  // is per model, and a high defrost share is only a heuristic because humidity and coil temperature
  // are not on this bus — and a reader who assumes the firmware is asserting more than it is will draw
  // the wrong conclusion from a correct number.
  health_fault: {
    what: "The unit's own fault class. Error is a direct device finding; Warning and Caution produce a note. OK requires every supported fault-class row to be readable.",
    normal: "A fault seen in this RAM window remains listed after it clears. Rebooting or changing the X10A identity starts a new window. The exact code remains under Operation.",
    de: { what: "Die geräteeigene Störungsklasse. Fehler ist ein direkter Gerätebefund; Warnung und Vorsicht ergeben einen Hinweis. Für OK müssen alle unterstützten Klassenzeilen lesbar sein.",
          normal: "Eine in diesem RAM-Fenster erkannte Störung bleibt nach dem Verschwinden vermerkt. Neustart oder Änderung der X10A-Identität beginnen ein neues Fenster. Der genaue Code steht unter „Betrieb“." } },
  health_cycling: {
    what: "Counts compressor OFF-to-ON transitions and divides observed runtime by starts. Runs at the window edges may be incomplete.",
    normal: "Below 10 minutes per start with at least 12 starts produces a NOTE, not a defect diagnosis. X10A does not separate heating, cooling and hot-water cycles; OK needs a full window and 90% readable compressor state.",
    de: { what: "Gezählt werden Wechsel des Verdichters von OFF zu ON; die beobachtete Laufzeit wird durch die Starts geteilt. Läufe an den Fensterrändern können unvollständig sein.",
          normal: "Unter 10 Minuten je Start bei mindestens 12 Starts ergibt HINWEIS, keinen Defektnachweis. X10A trennt Heizen, Kühlen und Warmwasser nicht; OK erfordert ein volles Fenster und 90 % lesbaren Verdichterzustand." } },
  health_defrost: {
    what: "Counts defrost OFF-to-ON transitions and their share of paired compressor runtime. Without readable compressor runtime, no share is assessed.",
    normal: "Above 15% with at least three paired cycles produces a NOTE only. X10A lacks humidity and coil-surface temperature, so it cannot diagnose icing or a fan fault.",
    de: { what: "Gezählt werden Wechsel der Abtauung von OFF zu ON und ihr Anteil an der gemeinsam lesbaren Verdichterlaufzeit. Ohne lesbare Verdichterlaufzeit wird kein Anteil bewertet.",
          normal: "Über 15 % bei mindestens drei gepaarten Vorgängen ergibt nur HINWEIS. X10A kennt weder Luftfeuchte noch Wärmetauscher-Oberflächentemperatur und diagnostiziert deshalb keine Vereisung oder Lüfterstörung." } },
  health_pressure: {
    what: "The lowest valid circuit-pressure reading in the rolling window. Its evidence time is tracked independently from the card.",
    normal: "Daikin requires more than 1 bar. At or below 1.0 bar gives a NOTE immediately and a WARNING after 60 continuous seconds. OK needs a full window and 90% readable pressure data.",
    de: { what: "Der niedrigste gültige Wasserdruck im rollierenden Fenster. Seine Evidenzzeit wird unabhängig von der Karte erfasst.",
          normal: "Daikin fordert mehr als 1 bar. Bei höchstens 1,0 bar erscheint sofort HINWEIS und nach 60 durchgehenden Sekunden WARNUNG. OK erfordert ein volles Fenster und 90 % lesbare Druckdaten." } },
  health_flow: {
    what: "The lowest flow after the circulation pump was continuously ON for 60 seconds. Pump start, stopped-pump values and communication gaps are excluded.",
    normal: "Observation only: the required flow is model- and operating-condition-specific, so there is no generic OK/WARNING threshold. A device-raised flow fault appears in the fault row.",
    de: { what: "Der niedrigste Durchfluss, nachdem die Umwälzpumpe 60 Sekunden durchgehend ON war. Pumpenanlauf, Werte bei stehender Pumpe und Kommunikationslücken sind ausgeschlossen.",
          normal: "Nur Beobachtung: Der erforderliche Durchfluss hängt von Modell und Betriebsbedingung ab; deshalb gibt es hier keinen allgemeinen Grenzwert für OK oder WARNUNG. Eine Gerätestörung erscheint in der Störungszeile." } },
  health_heater: {
    what: "Observed runtime of the space-heating backup heater (BUH) and tank heater (BSH). Very short pulses between polls can be missed; unreadable channels remain unknown, not zero.",
    normal: "Observation only. Weather, emergency mode, defrost support, schedules and surplus control can justify runtime. There is no universal OK/WARNING threshold or efficiency diagnosis.",
    de: { what: "Beobachtete Laufzeit des Zusatzheizers BUH und des Speicherheizstabs BSH. Sehr kurze Impulse zwischen Abfragen können fehlen; unlesbare Kanäle bleiben unbekannt und werden nicht zu null.",
          normal: "Nur Beobachtung. Wetter, Notbetrieb, Abtauhilfe, Zeitpläne und Überschusssteuerung können Laufzeit erklären. Es gibt keinen allgemeinen Grenzwert für OK oder WARNUNG und keine Effizienzdiagnose." } },
  health_retries: {
    what: "Experimental check of five protection counters. Only a strict increase between continuous comparable samples counts, including one first visible while stopped or at a compressor-state boundary. Baseline, stable or decreasing values, gaps and resets do not.",
    normal: "An increase gives a NOTE, not a fault diagnosis. No increase does not prove that no limiting occurred because reset and wrap semantics are undocumented.",
    de: { what: "Experimentelle Prüfung von fünf Schutzzählern. Nur ein strenger Anstieg zwischen lückenlosen vergleichbaren Messungen zählt, auch wenn er erst im Stillstand oder an einer Verdichter-Zustandsgrenze sichtbar wird. Basiswert, stabile oder abnehmende Werte, Lücken und Rücksetzungen nicht.",
          normal: "Ein Anstieg ergibt HINWEIS, keine Störungsdiagnose. Kein Anstieg beweist nicht, dass keine Begrenzung stattfand, weil Rücksetz- und Überlaufverhalten undokumentiert sind." } },
  // The two board-memory rows on the ESP32 card. The copy has one job beyond naming the number: to
  // say what the SHAPE of the curve means, because that is the whole reason these rows exist rather
  // than living on /status alone.
  free_heap: {
    what: "How much RAM the firmware still has free right now. It moves constantly — every WiFi packet, MQTT publish and web request borrows some — so the number itself matters far less than the 24-hour line under it.",
    normal: "a flat or gently breathing line. A steady downward slope over hours is a leak; a sudden drop that never recovers happened at whatever the device was doing at that moment. A reboot resets the line, because the buffer lives in RAM too.",
    de: { what: "Wie viel RAM der Firmware gerade noch frei ist. Der Wert schwankt ständig — jedes WLAN-Paket, jede MQTT-Veröffentlichung und jeder Web-Aufruf leiht sich etwas —, deshalb zählt die 24-Stunden-Linie darunter weit mehr als die Zahl selbst.",
          normal: "eine flache oder leicht atmende Linie. Ein stetiges Absinken über Stunden ist ein Leck; ein plötzlicher Absturz, der sich nicht erholt, geschah bei dem, was das Gerät in diesem Moment gerade tat. Ein Neustart setzt die Linie zurück, denn auch dieser Speicher liegt im RAM." } },
  max_alloc: {
    what: "The largest single block that is still free in one piece. This — not the total — is what actually limits this board: a TLS handshake or an OTA download needs one contiguous block, and a heap that is half free but finely shredded will refuse it.",
    normal: "it tracks below free heap and should keep a comfortable distance above zero. The telling shape is the two lines SEPARATING over hours: free memory holding while this one sinks is fragmentation, and it ends in a failed update or a dropped broker connection long before the device runs out of RAM.",
    de: { what: "Der größte noch am Stück freie Block. Er — nicht die Summe — ist die eigentliche Grenze dieses Boards: Ein TLS-Handshake oder ein OTA-Download braucht einen zusammenhängenden Block, und ein zur Hälfte freier, aber fein zerstückelter Speicher verweigert ihn.",
          normal: "er verläuft unterhalb des freien Speichers und sollte deutlichen Abstand zu null halten. Aussagekräftig ist, wenn sich die beiden Linien über Stunden AUSEINANDER bewegen: bleibt der freie Speicher stehen, während dieser sinkt, ist das Fragmentierung — sie endet in einem fehlgeschlagenen Update oder einer abgebrochenen Broker-Verbindung, lange bevor der Speicher wirklich ausgeht." } },
  capacity: {
    what: "The outdoor unit's rated capacity, read from its own identification page. It is a size class of the hardware — what the unit is built for, not what it is producing right now.",
    de: { what: "Die Nennleistung der Außeneinheit, aus ihrer eigenen Kennungsseite gelesen. Eine Größenklasse der Hardware — wofür das Gerät gebaut ist, nicht was es gerade liefert." } },
  capacity_iu: {
    what: "The INDOOR unit's rated capacity. It is shown instead of the outdoor unit's because this outdoor unit's identification page is too short to carry one — the firmware labels the half of the plant it actually read rather than presenting it as the system's size.",
    normal: "the two halves are routinely different sizes: an 8 kW indoor unit over a 6 kW outdoor unit is an ordinary pairing, so this figure is not necessarily the outdoor unit's.",
    de: { what: "Die Nennleistung der Inneneinheit. Sie steht hier anstelle der Außeneinheit, weil deren Kennungsseite zu kurz ist, um eine zu enthalten — die Firmware benennt die Hälfte der Anlage, die sie tatsächlich gelesen hat, statt sie als Größe des Gesamtsystems auszugeben.",
          normal: "beide Hälften sind regelmäßig unterschiedlich groß: eine 8-kW-Inneneinheit über einer 6-kW-Außeneinheit ist eine ganz normale Paarung — diese Zahl ist also nicht zwangsläufig die der Außeneinheit." } },
  // TWO variants, and which one is true depends on whether the outdoor unit reported its capacity.
  // logic/detect.hpp is explicit: candidates that share a page mask AND a kW class are
  // register-identical, so the pick cannot change a reading — but when the O/U capacity is unknown
  // "the candidate set spans DIFFERENT kW classes, so it is NOT register-identical and the
  // representative choice does affect the values". Asserting the reassuring version in both states
  // would put a false claim on screen in exactly the state that produces this row most often (a
  // short 0x00 descriptor), which is the #35-#39 shape in copy rather than in a converter.
  candidates: {
    what: "Several Daikin model families answer this bus identically — same registers, same layout, same values — so the exact marketing name cannot be read off the wire. These are the families that still fit; the heading stays \"Daikin Altherma\" rather than picking one of them and being wrong.",
    normal: "this does not affect any reading: the outdoor unit reported its capacity, so the remaining candidates all share one rated class and decode identically — which is why they cannot be told apart in the first place. To pin the exact model, compare the outdoor unit ID below against the nameplate.",
    de: { what: "Mehrere Daikin-Modellfamilien antworten auf diesem Bus identisch — gleiche Register, gleiches Layout, gleiche Werte —, deshalb lässt sich der genaue Handelsname nicht von der Leitung ablesen. Dies sind die Familien, die noch passen; die Überschrift bleibt „Daikin Altherma“, statt eine davon zu raten.",
          normal: "das beeinflusst keinen Messwert: Die Außeneinheit hat ihre Leistung gemeldet, deshalb teilen sich alle verbliebenen Kandidaten eine Leistungsklasse und dekodieren identisch — genau deshalb sind sie nicht unterscheidbar. Um das genaue Modell festzulegen, die Kennung der Außeneinheit unten mit dem Typenschild vergleichen." } },
  candidates_nocap: {
    what: "Several Daikin model families answer this bus with the same registers, so the exact marketing name cannot be read off the wire. These are the families that still fit; the heading stays \"Daikin Altherma\" rather than picking one of them and being wrong.",
    normal: "this outdoor unit does not report its own rated capacity, so the candidates can differ in size class. The readings are decoded with the closest fit the firmware could pick — using the indoor unit's rated capacity — rather than with a certainty. The outdoor unit ID below is what settles it against the nameplate.",
    de: { what: "Mehrere Daikin-Modellfamilien antworten auf diesem Bus mit denselben Registern, deshalb lässt sich der genaue Handelsname nicht von der Leitung ablesen. Dies sind die Familien, die noch passen; die Überschrift bleibt „Daikin Altherma“, statt eine davon zu raten.",
          normal: "diese Außeneinheit meldet ihre eigene Nennleistung nicht, deshalb können sich die Kandidaten in der Leistungsklasse unterscheiden. Die Werte werden mit der nächstliegenden Übereinstimmung dekodiert, die die Firmware wählen konnte — anhand der Nennleistung der Inneneinheit —, nicht mit einer Gewissheit. Die Kennung der Außeneinheit unten entscheidet es gegen das Typenschild." } },
  oueeprom: {
    what: "The outdoor unit's identification bytes, shown exactly as they arrive from the bus. No public table maps them to a model name, so the firmware shows the digits rather than guessing a name from them.",
    normal: "the one identifier that can settle an ambiguous detection — compare it character by character with the sticker on the outdoor unit.",
    de: { what: "Die Kennungsbytes der Außeneinheit, exakt so angezeigt, wie sie vom Bus kommen. Es gibt keine öffentliche Tabelle, die sie einem Modellnamen zuordnet, deshalb zeigt die Firmware die Ziffern, statt einen Namen daraus zu raten.",
          normal: "die einzige Kennung, die eine mehrdeutige Erkennung entscheiden kann — Zeichen für Zeichen mit dem Aufkleber auf der Außeneinheit vergleichen." } },
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
  const open = !item.classList.contains("open");
  item.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) S.descOpen.add(key);
  else { S.descOpen.delete(key); if (trend) S.histPin.delete(trend); }
  // Fetch the trend only once the panel is actually opened — a device that buffers eleven series
  // would otherwise answer a request per row on every page load, for panels nobody looked at.
  if (open && trend) ensureHist(trend);
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
  const order = [...GROUPS.map((g) => g[0]), "Other values"];
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
  // No trend and no source comparison here: a trend is keyed on an X10A (reg, offset, unit) locator
  // and these rows have none, and the comparison exists to put two sources side by side, which is
  // meaningless on a row only one source carries. Where copy is missing the row degrades to the same
  // plain line it was before, rather than an empty panel that opens onto nothing.
  const html = rows.map((m) => {
    const label = m.label || "", shown = displayHomeHubLabel(m);
    const val = esc(displayValue(m)) +
      (m.unit ? `<span class="vrow-unit">${esc(m.unit)}</span>` : "");
    const d = descFor(label);
    if (!d) {
      return `<div class="vrow"><span class="vrow-label">${esc(shown)}</span>` +
        `<span class="vrow-val src-val-mb">${val}</span></div>`;
    }
    return descAccordion(label, shown, val, "src-val-mb", descBodyHtml(d, m.value), null);
  }).join("");
  // The heading has to match what is IN the card: "Modbus only" is true of the unpaired handful and
  // false the moment `all` folds the paired rows in beside them.
  // Always just "Modbus" — the card is named after its SOURCE, not after how much of the
  // catalog happens to be in it this cycle. "Modbus only" tried to say the second thing and
  // was wrong half the time: with X10A down the paired rows fold in here too, so the card was
  // titled "only" over readings that are anything but.
  return vcard(t("group.Modbus"), html);
}
