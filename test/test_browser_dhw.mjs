import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Exercise the firmware's assembled/minified page in the Tank inspector (#schem [data-insp="tank"]).
// Fixtures enter through real /status, /values, and /history requests; no chart HTML is injected.
const TANK_HIT = '#schem [data-insp="tank"]';
const DIAG_BRIEF = "#inspFlowDiagnosis";
const HIST_HOST = "#inspHist";
const PLOT = `${HIST_HOST} [data-hist=dhw_tank]`;
const BANDS = `${HIST_HOST} .vhist-dhw-band`;
const LEGEND_SHOW = `${HIST_HOST} button[data-dhw-cool-show]`;
const READOUT = `${HIST_HOST} .vhist-dhw-readout`;
const NOW = 172800; // 576 * 300s
const SAMPLES = 288;
const RING_B0 = NOW / 300 - SAMPLES; // 288 -> 0 expired slots
const CHART_START_S = NOW - (SAMPLES - 1) * 300; // 86700
const UNIX = Date.parse("2026-11-18T12:00:00Z") / 1000;
const evaluate = (page, fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg)})`);

async function settle(page) {
  await page.waitFor(`!S.clickHold && !_pollBusy && !S.histBusy.size &&
    document.getElementById("inspect").getAnimations({subtree: true})
      .every(a => !(a instanceof CSSTransition) || a.playState !== "running")`);
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}

async function tap(page, selector, { yFraction = 0.5, isPlotBand = false } = {}) {
  await settle(page);
  await page.bringToFront();
  const point = await evaluate(page, async ({ selector, yFraction, isPlotBand }) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error("missing DHW target: " + selector);
    node.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) throw new Error("hidden DHW target: " + selector);
    const x = box.left + box.width / 2;
    const y = box.top + box.height * yFraction;
    const hit = document.elementFromPoint(x, y);
    const container = isPlotBand ? node.closest(".vhist-plot") : node;
    return {
      x, y,
      disabled: !!node.disabled,
      reachable: !!container && (hit === container || container.contains(hit)),
      hit: hit?.outerHTML.slice(0, 180),
    };
  }, { selector, yFraction, isPlotBand });
  assert.equal(point.disabled, false, "DHW action must be enabled: " + selector);
  assert.equal(point.reachable, true, "DHW target must survive native hit testing: " +
    selector + " " + JSON.stringify(point));
  await page.nativeClick(point.x, point.y);
  await page.frame();
}

async function key(page, name, code, keyCode) {
  await page.key(page.inputMode === "touch" && name === " " ? "Space" : name, { code, keyCode });
  await page.frame();
}

function makeTimeline() {
  const windowAt = (ago, duration, rate, pump_marker, draw_marker) => ({
    start_s: NOW - ago, end_s: NOW - ago + duration, rate_k_h: rate,
    observed_s: duration, pump_marker, draw_marker,
  });
  return {
    epoch: 1, window_end_s: NOW, since_s: NOW - 80000, observed_end_s: NOW,
    unix_s: UNIX, live: true,
    windows: [
      windowAt(78000, 3600, 1.8, false, false), // quiet
      windowAt(64000, 3600, 0.4, false, false), // < 0.8 -> must remain unshaded
      windowAt(46000, 3600, 1.2, false, true),  // draw
      windowAt(24000, 3600, 2.7, true, true),   // peak: pump + draw
      windowAt(10000, 3600, 1.4, true, false),  // pump
    ],
  };
}

function makeHistories(bootId, epoch, t0, offset = 0) {
  const v = Array.from({ length: SAMPLES }, (_, i) => (i >= 110 && i <= 116 ? null : 500 - Math.round(i / 4) + offset));
  return {
    "x10a:dhw_tank": { ok: true, id: "dhw_tank", source: "x10a", epoch, boot_id: bootId, dt: 300, unit: "°C", b0: RING_B0, t0, v },
    "modbus:dhw_tank": { ok: true, id: "dhw_tank", source: "modbus", epoch, boot_id: bootId, dt: 300, unit: "°C", b0: RING_B0, t0, v: v.map(n => (n == null ? null : n + 12)) },
  };
}

async function assertLayout(page, context) {
  const result = await evaluate(page, () => {
    const card = document.getElementById("inspCard"), outside = [], clipped = [], unnamed = [];
    const shown = node => {
      if (node.closest("[hidden]")) return false;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility === "visible";
    };
    for (const node of [card, ...card.querySelectorAll("*")]) {
      if (!shown(node)) continue;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      const label = node.tagName + "." + (typeof node.className === "string" ? node.className : "");
      if (r.left < -1 || r.right > innerWidth + 1) outside.push(label);
      if ((["hidden", "clip"].includes(s.overflowX) && node.scrollWidth > node.clientWidth + 1) ||
          (["hidden", "clip"].includes(s.overflowY) && node.scrollHeight > node.clientHeight + 1)) clipped.push(label);
      if (node.matches("button")) {
        const name = node.getAttribute("aria-label") || node.textContent.trim();
        if (!name) unnamed.push(label);
      }
    }
    return {
      outside, clipped, unnamed,
      lang: document.documentElement.lang,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      fits: card.scrollWidth <= card.clientWidth + 1,
      text: card.textContent,
    };
  });
  assert.ok(result.overflow <= 1 && result.fits, `${context}: tank inspector must fit without horizontal overflow`);
  assert.deepEqual(result.outside, [], `${context}: no offscreen controls or copy`);
  assert.deepEqual(result.clipped, [], `${context}: no clipped controls or copy`);
  assert.deepEqual(result.unnamed, [], `${context}: controls must have accessible names`);
  assert.doesNotMatch(result.text, /check\.(?:dhw|status)\.|NaN|Infinity|undefined/,
    `${context}: no missing translation keys or fabricated numeric evidence`);
  return result;
}

async function capture(page, context) {
  const directory = process.env.DAIKIN_BROWSER_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(path.isAbsolute(directory), "DHW evidence directory must be absolute");
  const original = await evaluate(page, () => ({
    width: innerWidth, height: innerHeight,
    cardHeight: document.getElementById("inspCard").getBoundingClientRect().height,
  }));
  const expanded = typeof page.viewport === "function" && original.cardHeight + 240 > original.height;
  try {
    if (expanded) await page.viewport(original.width, Math.ceil(original.cardHeight + 240));
    const { clip, scroll } = await evaluate(page, async () => {
      const node = document.getElementById("inspCard");
      node.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = node.getBoundingClientRect();
      return { clip: { x: r.left, y: r.top, width: r.width, height: r.height }, scroll: { x: scrollX, y: scrollY } };
    });
    const image = page.screenshotClip ? await page.screenshotClip(clip) : Buffer.from((await page.send(
      "Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
        clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 1 } })).data, "base64");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, context.replaceAll("/", "-") + ".png"), image);
  } finally {
    if (expanded) { await page.viewport(original.width, original.height); await settle(page); }
  }
}

export async function assertDhwTimeline(page, server, context, { locales = false } = {}) {
  await page.focusEmulation(true);
  await page.evaluate("pollStop(); pollSchedule = () => {}; true");
  await page.waitFor("!_pollBusy && !S.histBusy.size");
  const originalStatus = await page.evaluate(`(() => {
    window.__dhwBrowserOriginal = {
      state: Object.fromEntries(Object.entries(S).map(([k, v]) =>
        [k, v instanceof Map ? new Map(v) : v instanceof Set ? new Set(v) : v])),
      lang: LANG,
    };
    return S.status;
  })()`);

  const status = structuredClone(originalStatus);
  const timeline = makeTimeline();
  const check = {
    id: "dhw_loss", verdict: "ok", evidence: "observation", reason: "observation_only",
    observed_s: 28800, required_s: 0, max_k_h: 2.7, windows: 5, blocked: false, timeline,
  };
  Object.assign(status, {
    boot_id: "dhw-browser-fixture",
    uptime_s: NOW,
    ui: { ...status.ui, lang: "en" },
    hp: { ...status.hp, connected: true },
    diagnostics: { ...status.diagnostics, enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a", "modbus"] },
    modbus: { ...status.modbus, host: "192.0.2.20", enabled: true, connected: true, profile: "homehub" },
    history: {
      epoch: 1,
      rows: [{ id: "dhw_tank", label: "DHW tank temp. (R5T)" }],
      modbus_rows: [{ id: "dhw_tank", label: "Tank temperature" }],
    },
    ntp: { ...status.ntp, synced: true, time: new Date(UNIX * 1000).toISOString() },
    health: {
      status: "ok", source: "x10a", source_fresh: true, source_age_s: 0,
      persist: "flash", full_span: true, span_s: 86400,
      checks: [
        { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 3600 },
        check,
      ],
    },
  });

  let tick = 0, revision = 0, histT0 = UNIX - (SAMPLES - 1) * 300;
  const values = () => ({
    values: [
      { concept: "dhw_tank", label: "DHW tank temp. (R5T)", value: (44 + ++tick / 10).toFixed(1), unit: "°C", reg: 0x61, group: "Domestic hot water" },
      { label: "DHW setpoint", value: "48", unit: "°C", reg: 0x60, group: "Domestic hot water" },
    ],
    modbus: [
      { off: 14, label: "Tank temperature", value: 47.2, unit: "°C", history: "dhw_tank", concept: "dhw_tank" },
    ],
  });

  const publish = async () => {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy && !S.clickHold && !S.scrub");
    status.uptime_s = NOW + ++revision;
    status.ntp.time = status.ntp.synced ? new Date((UNIX + revision) * 1000).toISOString() : null;
    if (check.timeline) {
      check.timeline.window_end_s = status.uptime_s;
      if (check.timeline.observed_end_s != null && check.timeline.live) check.timeline.observed_end_s = status.uptime_s;
      if (Object.hasOwn(check.timeline, "unix_s")) check.timeline.unix_s = UNIX + revision;
    }
    const histories = makeHistories(status.boot_id, status.history.epoch, histT0, revision % 3);
    server.setTelemetry({ status, values, histories });
    const reqBefore = server.valuesRequests;
    await page.evaluate("pollSchedule = window.__browserPollSchedule; pollNow(); true");
    await page.waitFor(`S.status?.boot_id === ${JSON.stringify(status.boot_id)} &&
      S.status.uptime_s === ${status.uptime_s} && !_pollBusy`, { timeoutMs: 12000 });
    assert.ok(server.valuesRequests > reqBefore, `${context}: poll must fetch real values`);
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await settle(page);
  };

  try {
    await page.evaluate(`(() => {
      S.hist = new Map(); S.histPin = new Map(); S.histHidden = new Map();
      S.histBusy = new Set(); S.histRequests = new Map(); S.histAwait = new Map();
      S.histIdentity = null; S.histUptime = null; S.descOpen = new Set();
      S.scrub = null; S.clickHold = false; S.insp = null; S.dhwCoolSelection = null;
      S.dashboardCard = "diagnosis";
      showStage("dashboard");
      return true;
    })()`);
    await publish();

    // 1. Verify model:health_dhw_loss is NOT rendered in the Diagnosis card (#valueGroups).
    assert.equal(await page.evaluate('Boolean(document.querySelector(\'#valueGroups button[data-desc="model:health_dhw_loss"]\'))'), false,
      `${context}: Diagnosis card must not render button[data-desc="model:health_dhw_loss"]`);

    // 2. Open the DHW tank / thermal store schematic target.
    await tap(page, TANK_HIT);
    await page.waitFor(`S.insp === "tank" && Boolean(document.querySelector(${JSON.stringify(PLOT)}))`);
    await settle(page);
    await assertLayout(page, `${context}/initial`);
    await capture(page, `${context}/initial`);

    // 3. Verify shaded bands under #dhwCoolingClip: only >= 0.8 windows shaded, peak marked, gaps unshaded, --dhw-cooling colour.
    const expectedShaded = timeline.windows.filter(w => w.rate_k_h >= 0.8); // 4 windows: quiet, draw, peak(both), pump
    const rendered = await evaluate(page, ({ plotSel, bandsSel, legendSel, gapAtS, chartStartUnix }) => {
      const plot = document.querySelector(plotSel);
      const bands = [...document.querySelectorAll(bandsSel)];
      const legend = document.querySelector(legendSel);
      const clip = plot.querySelector("#dhwCoolingClip");
      const clipPaths = [...clip.querySelectorAll("path")];
      const drawnX10a = [...plot.querySelectorAll("svg > .vhist-area:not(.mb)")];
      const filled = (x, y) => clipPaths.some(p => p.isPointInFill(new DOMPoint(x, y)));
      const style = getComputedStyle(bands[0]);
      const colour = document.createElement("canvas").getContext("2d");
      colour.fillStyle = style.fill;
      colour.fillRect(0, 0, 1, 1);
      const [r, g, b] = colour.getImageData(0, 0, 1, 1).data;
      const gapX = ((gapAtS - chartStartUnix) / ((288 - 1) * 300)) * HIST_W;
      return {
        sourceAttr: plot.dataset.dhwSource,
        bands: bands.map(el => ({
          end: Number(el.dataset.dhwBand),
          rate: Number(el.dataset.dhwRate),
          peak: el.classList.contains("is-peak"),
          clipParent: el.parentElement.getAttribute("clip-path"),
        })),
        clipMatchesX10a: clipPaths.length > 0 && clipPaths.map(p => p.getAttribute("d")).join() === drawnX10a.map(p => p.getAttribute("d")).join(),
        gapUnfilled: !filled(gapX, HIST_H - 1),
        aboveUnfilled: !filled(HIST_W / 2, 1),
        belowFilled: filled(HIST_W * 0.9, HIST_H - 1),
        pinkTone: r > g && b > g && Number(style.fillOpacity) > 0 && Number(style.fillOpacity) < 1 && getComputedStyle(legend).color === style.fill,
        legendText: legend.textContent,
        briefText: document.getElementById("inspFlowDiagnosis").innerText,
      };
    }, { plotSel: PLOT, bandsSel: BANDS, legendSel: LEGEND_SHOW, gapAtS: UNIX - (NOW - (CHART_START_S + 113 * 300)), chartStartUnix: histT0 });

    assert.equal(rendered.sourceAttr, "x10a", `${context}: plot binds to X10A source`);
    assert.deepEqual(rendered.bands.map(b => b.end), expectedShaded.map(w => w.end_s),
      `${context}: only rate_k_h >= 0.8 windows render .vhist-dhw-band (0.4 is excluded)`);
    assert.deepEqual(rendered.bands.map(b => b.peak), [false, false, true, false],
      `${context}: .is-peak marks only the strongest 2.7 °C/h window`);
    assert.ok(rendered.bands.every(b => b.clipParent === "url(#dhwCoolingClip)"),
      `${context}: all bands clip to #dhwCoolingClip`);
    assert.deepEqual([rendered.clipMatchesX10a, rendered.gapUnfilled, rendered.aboveUnfilled, rendered.belowFilled, rendered.pinkTone],
      [true, true, true, true, true], `${context}: cooling bands clip strictly to the X10A curve and leave gaps unshaded`);
    assert.equal(rendered.legendText, await page.evaluate('t("check.dhw.show")'));
    assert.ok(rendered.briefText.includes("X10A") && rendered.briefText.includes("2.7 °C/h"),
      `${context}: #inspTankDiagnosis shows strongest cooling rate`);

    // 4. Click [data-dhw-cool-show]: selects peak first, reveals .vhist-dhw-readout, then cycles through shaded windows.
    const assertSelected = async (win, ctx) => {
      const state = await evaluate(page, ({ bandsSel, readoutSel, endS }) => {
        const bands = [...document.querySelectorAll(bandsSel)];
        const selected = bands.filter(b => b.classList.contains("selected"));
        const readout = document.querySelector(readoutSel);
        const strong = readout?.querySelector("strong")?.textContent || "";
        const span = readout?.querySelector("span")?.textContent || "";
        return {
          selectedEnds: selected.map(b => Number(b.dataset.dhwBand)),
          hidden: readout?.hidden,
          strong, span,
          sentences: span.split(/[.!?。！？]+/).filter(s => s.trim()).length,
          belowChart: document.querySelector("#inspHist .vhist-plot").getBoundingClientRect().bottom <= readout.getBoundingClientRect().top,
          pinned: S.histPin.has("dhw_tank"),
        };
      }, { bandsSel: BANDS, readoutSel: READOUT, endS: win.end_s });
      assert.deepEqual(state.selectedEnds, [win.end_s], `${ctx}: selected band must match ${win.end_s}`);
      assert.equal(state.hidden, false, `${ctx}: .vhist-dhw-readout must be visible`);
      assert.equal(state.belowChart, true, `${ctx}: readout must appear below the chart`);
      assert.equal(state.pinned, false, `${ctx}: selecting a cooling band must not pin the curve`);
      assert.ok(state.strong.includes(`${win.rate_k_h} °C/h`), `${ctx}: readout header shows rate`);
      assert.ok(state.sentences >= 1 && state.sentences <= 3, `${ctx}: readout explanation <= 3 sentences`);
      const expectedKey = win.pump_marker && win.draw_marker ? "check.dhw.cause_both"
        : win.pump_marker ? "check.dhw.cause_pump"
        : win.draw_marker ? "check.dhw.cause_draw" : "check.dhw.cause_quiet";
      assert.equal(state.span, await page.evaluate(`t(${JSON.stringify(expectedKey)})`),
        `${ctx}: readout explanation matches ${expectedKey}`);
    };

    const [wQuiet, wLow, wDraw, wPeak, wPump] = timeline.windows;
    await tap(page, LEGEND_SHOW);
    await assertSelected(wPeak, `${context}/legend-first-picks-peak`);
    await capture(page, `${context}/peak-selected`);

    // Click again -> wraps to wPump, then wQuiet, then wDraw, then back to wPeak.
    await tap(page, LEGEND_SHOW);
    await assertSelected(wPump, `${context}/legend-cycle-pump`);
    await evaluate(page, sel => document.querySelector(sel).focus(), LEGEND_SHOW);
    await key(page, "Enter", "Enter", 13);
    await assertSelected(wQuiet, `${context}/legend-enter-quiet`);

    // 5. Native tap on shaded bands for all 4 marker combinations + negative taps above curve & on unshaded < 0.8 region.
    await tap(page, `${BANDS}[data-dhw-band="${wDraw.end_s}"]`, { yFraction: 0.05, isPlotBand: true });
    await page.evaluate('S.histPin.delete("dhw_tank"); renderInspect(); true');
    await assertSelected(wQuiet, `${context}/tap-above-curve-keeps-prior`);

    // Tap inside the curve at the unshaded < 0.8 window (wLow): must NOT select a cooling band.
    const lowPoint = await evaluate(page, ({ plotSel, lowStartS, lowEndS, chartStartUnix, nowS, unixNow }) => {
      const plot = document.querySelector(plotSel);
      const r = plot.getBoundingClientRect();
      const midUnix = unixNow - (nowS - (lowStartS + lowEndS) / 2);
      const frac = (midUnix - chartStartUnix) / ((288 - 1) * 300);
      return { x: r.left + frac * r.width, y: r.top + r.height * 0.85 };
    }, { plotSel: PLOT, lowStartS: wLow.start_s, lowEndS: wLow.end_s, chartStartUnix: histT0, nowS: status.uptime_s, unixNow: UNIX + revision });
    await page.bringToFront();
    await page.nativeClick(lowPoint.x, lowPoint.y);
    await page.frame();
    await page.evaluate('S.histPin.delete("dhw_tank"); renderInspect(); true');
    await assertSelected(wQuiet, `${context}/tap-unshaded-low-rate-keeps-prior`);

    for (const [label, win] of [["draw", wDraw], ["pump-draw", wPeak], ["pump", wPump], ["quiet", wQuiet]]) {
      await tap(page, `${BANDS}[data-dhw-band="${win.end_s}"]`, { yFraction: 0.85, isPlotBand: true });
      await assertSelected(win, `${context}/tap-${label}`);
    }

    // Keyboard scrub on the plot still reads the numeric curve.
    await evaluate(page, sel => document.querySelector(sel).focus(), PLOT);
    await key(page, "End", "End", 35);
    assert.equal(await evaluate(page, sel => !document.querySelector(sel).querySelector(".vhist-mark.vhist-live[data-source=x10a]").hidden, PLOT), true,
      `${context}: keyboard scrub still updates live marker on numeric curve`);

    // 6. Toggle X10A series visibility: hiding removes bands while keeping #inspTankDiagnosis; showing restores them.
    await tap(page, `${HIST_HOST} [data-hist-series="x10a"]`);
    assert.equal(await evaluate(page, sel => document.querySelectorAll(sel).length, BANDS), 0,
      `${context}: hiding X10A series removes its cooling bands`);
    assert.ok((await page.evaluate(`document.getElementById("inspFlowDiagnosis").innerText`)).includes("2.7 °C/h"),
      `${context}: hiding series preserves #inspFlowDiagnosis`);
    await tap(page, `${HIST_HOST} [data-hist-series="x10a"]`);
    assert.equal(await evaluate(page, sel => document.querySelectorAll(sel).length, BANDS), 4,
      `${context}: restoring X10A series restores cooling bands`);

    // 7. Modbus source switching: bands move onto Modbus curve and #inspFlowDiagnosis labels Modbus.
    status.health.source = status.diagnostics.source = status.diagnostics.effective_source = "modbus";
    await publish();
    assert.deepEqual(await evaluate(page, ({ plotSel, bandsSel }) => {
      const plot = document.querySelector(plotSel);
      const clip = [...plot.querySelectorAll("#dhwCoolingClip path")].map(p => p.getAttribute("d")).join();
      const mb = [...plot.querySelectorAll("svg > .vhist-area.mb")].map(p => p.getAttribute("d")).join();
      return {
        source: plot.dataset.dhwSource,
        bands: document.querySelectorAll(bandsSel).length,
        clipMatchesModbus: clip.length > 0 && clip === mb,
        brief: document.getElementById("inspFlowDiagnosis").innerText.includes("Modbus"),
      };
    }, { plotSel: PLOT, bandsSel: BANDS }), { source: "modbus", bands: 4, clipMatchesModbus: true, brief: true },
    `${context}: Modbus diagnosis binds cooling bands strictly to the Modbus curve`);
    status.health.source = status.diagnostics.source = status.diagnostics.effective_source = "x10a";

    // 8. Relative (unsynced) timeline + undated trend: bands still align without wall dates.
    const savedUnix = timeline.unix_s;
    const savedT0 = histT0;
    delete timeline.unix_s;
    status.ntp.synced = false;
    status.history.epoch += 1;
    histT0 = null;
    await publish();
    assert.equal(await evaluate(page, sel => document.querySelectorAll(sel).length, BANDS), 4,
      `${context}: live unsynced timeline aligns on relative trend`);
    await tap(page, LEGEND_SHOW);
    const relHeader = await page.evaluate(`document.querySelector(${JSON.stringify(READOUT)} + " strong").textContent`);
    assert.doesNotMatch(relHeader, /2026|GMT|UTC/, `${context}: relative mode must not fabricate wall dates`);
    timeline.unix_s = savedUnix;
    status.ntp.synced = true;
    status.history.epoch += 1;
    histT0 = savedT0;

    // 9. #inspFlowDiagnosis states: locations_missing, stale, blocked (no_window), waiting, unavailable, disabled.
    const diagText = () => page.evaluate('document.getElementById("inspFlowDiagnosis").innerText');

    // locations_missing when max_k_h >= 0.8 and no visible bands
    timeline.windows = [wLow]; // only 0.4 < 0.8 -> 0 visible bands while max_k_h is 2.7
    await publish();
    assert.equal(await evaluate(page, sel => document.querySelectorAll(sel).length, BANDS), 0);
    assert.ok((await diagText()).includes(await page.evaluate('t("check.dhw.locations_missing")')),
      `${context}: missing visible bands for >= 0.8 rate shows locations_missing`);

    // stale when source_fresh === false (and when !timeline.live)
    timeline.windows = makeTimeline().windows;
    status.health.source_fresh = false;
    await publish();
    assert.ok((await diagText()).includes(await page.evaluate('t("check.dhw.stale")')),
      `${context}: source_fresh=false shows stale caveat`);
    status.health.source_fresh = true;
    timeline.live = false;
    await publish();
    assert.ok((await diagText()).includes(await page.evaluate('t("check.dhw.stale")')),
      `${context}: !timeline.live shows stale caveat`);
    timeline.live = true;

    // blocked -> no_window
    Object.assign(check, { verdict: "unavailable", blocked: true, max_k_h: null, windows: 0, timeline: { ...timeline, windows: [] } });
    await publish();
    assert.equal(await evaluate(page, sel => document.querySelectorAll(sel).length, BANDS), 0);
    assert.ok((await diagText()).includes(await page.evaluate('t("check.dhw.no_window")')),
      `${context}: blocked shows no_window`);

    // collecting -> waiting
    Object.assign(check, { verdict: "collecting", blocked: false, max_k_h: null, windows: 0 });
    await publish();
    assert.ok((await diagText()).includes(await page.evaluate('t("check.dhw.waiting")')),
      `${context}: collecting shows waiting`);

    // unavailable -> N/A
    Object.assign(check, { verdict: "unavailable", blocked: false, max_k_h: null, windows: 0 });
    await publish();
    assert.ok((await diagText()).includes(await page.evaluate('t("check.status.unavailable")')),
      `${context}: unavailable shows N/A`);

    // diagnostics.enabled = false -> #inspTankDiagnosis hidden, bands = 0, ordinary dhw_tank graph remains
    Object.assign(check, { verdict: "ok", blocked: false, max_k_h: 2.7, windows: 5, timeline });
    status.diagnostics.enabled = false;
    await publish();
    assert.deepEqual(await evaluate(page, ({ briefSel, bandsSel, plotSel }) => ({
      briefHidden: document.querySelector(briefSel).hidden,
      bands: document.querySelectorAll(bandsSel).length,
      plotPresent: Boolean(document.querySelector(plotSel + " .vhist-line")),
      rowsVisible: document.getElementById("inspRows").getBoundingClientRect().height > 0,
    }), { briefSel: DIAG_BRIEF, bandsSel: BANDS, plotSel: PLOT }),
    { briefHidden: true, bands: 0, plotPresent: true, rowsVisible: true },
    `${context}: disabling diagnostics hides tank cooling diagnosis while keeping the tank trend`);

    // 10. Optional full-locale matrix check on narrow viewport.
    status.diagnostics.enabled = true;
    await publish();
    const languages = locales ? await page.evaluate("Array.from(UI_LANGS)") : ["en"];
    for (const language of languages) {
      await evaluate(page, async l => { await setLang(l); renderApp(); }, language);
      await settle(page);
      const layout = await assertLayout(page, `${context}/locale/${language}`);
      assert.equal(layout.lang, language);
      await tap(page, LEGEND_SHOW);
      const exp = await page.evaluate(`document.querySelector(${JSON.stringify(READOUT)} + " span")?.textContent || ""`);
      const sentences = exp.split(/[.!?。！？]+/).filter(s => s.trim());
      assert.ok(sentences.length >= 1 && sentences.length <= 3,
        `${context}/locale/${language}: readout explanation must be <= 3 sentences`);
    }

    assert.deepEqual(page.diagnostics, [], `${context}: DHW tank cooling tests emitted browser errors`);
    console.log(`DHW cooling inspector checked: ${context}; 5 windows (>= 0.8 shaded, < 0.8 unshaded), 4 causes, X10A/Modbus, ${languages.length} locale(s)`);
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy");
    server.setTelemetry();
    await page.evaluate(`(async () => {
      const original = window.__dhwBrowserOriginal;
      if (original) {
        for (const key of Object.keys(S)) if (!Object.hasOwn(original.state, key)) delete S[key];
        Object.assign(S, original.state);
        S.clickHold = false;
        S.inspSig = null;
        S.inspHistSig = null;
        delete _html.valueGroups;
        await setLang(original.lang);
        renderApp();
        window.scrollTo(0, 0);
      }
      delete window.__dhwBrowserOriginal;
      return true;
    })()`);
    await page.frame();
    await settle(page);
    await page.focusEmulation(false);
  }
}
