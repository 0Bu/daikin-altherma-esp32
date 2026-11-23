import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Exercise the firmware's assembled/minified page, not the standalone design preview. Fixtures
// enter through the same /status and /values requests as live telemetry; no chart HTML is injected.
const ROW = 'button[data-desc="model:health_dhw_loss"]';
const DETAIL = ".checkup-dhw-detail";
const CHART = `${DETAIL} .checkup-dhw-chart`;
const WINDOWS = `${CHART} button[data-dhw-window]`;
const BASIS = `${DETAIL} details[data-dhw-disclosure="basis"]`;
const ENERGY = `${DETAIL} details[data-dhw-disclosure="energy"]`;
const NOW = 172800;
const UNIX = Date.parse("2026-11-18T12:00:00Z") / 1000;
const windowButton = end => `${WINDOWS}[data-dhw-window="${end}"]`;
const evaluate = (page, fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg)})`);

async function tap(page, selector) {
  await page.waitFor("!S.clickHold");
  const point = await evaluate(page, async selector => {
    const node = document.querySelector(selector);
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = node?.getBoundingClientRect();
    if (!box?.width || !box.height) throw new Error("missing visible DHW target: " + selector);
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: hit === node || node.contains(hit), disabled: !!node.disabled,
      hit: hit?.outerHTML.slice(0, 180) };
  }, selector);
  assert.equal(point.disabled, false, "DHW action must be enabled: " + selector);
  assert.equal(point.reachable, true, "DHW action must survive native hit testing: " +
    selector + " " + JSON.stringify(point));
  await page.nativeClick(point.x, point.y);
  await page.frame();
}

async function key(page, name, code, keyCode) {
  // Both adapters use native input: CDP on Chromium and Playwright's keyboard on Linux WebKit.
  await page.key(page.inputMode === "touch" && name === " " ? "Space" : name, { code, keyCode });
  await page.frame();
}

async function settle(page) {
  await page.waitFor(`!S.clickHold && !_pollBusy && (() => {
    const item = document.querySelector(${JSON.stringify(ROW)})?.closest('.vitem');
    return !item || item.getAnimations({subtree:true}).every(a =>
      !(a instanceof CSSTransition) || a.playState !== 'running');
  })()`);
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
}

async function heroValue(page) {
  return evaluate(page, selector => [...document.querySelector(selector).childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim(),
  DETAIL + " .checkup-dhw-value");
}

async function selected(page) {
  return evaluate(page, selector => [...document.querySelectorAll(selector)]
    .filter(node => node.getAttribute("aria-pressed") === "true")
    .map(node => Number(node.dataset.dhwWindow)), WINDOWS);
}

async function assertSelection(page, end, context, focused = false) {
  assert.deepEqual(await selected(page), [end], context + ": exactly the chosen real window is selected");
  const expected = makeTimeline().windows.find(window => window.end_s === end);
  assert.ok(expected, context + ": expected window must belong to the independent fixture");
  const state = await evaluate(page, selector => {
    const button = document.querySelector(selector);
    const details = button.closest(".checkup-dhw-chart").querySelector(".checkup-dhw-window-details");
    return { focus: document.activeElement === button,
      rate: details?.querySelector('[data-dhw-readout="rate"]')?.textContent.trim(),
      time: details?.querySelector('[data-dhw-readout="time"]')?.textContent.trim(),
      coverage: details?.querySelector('[data-dhw-readout="coverage"]')?.textContent.trim(),
      markers: details?.querySelector('[data-dhw-readout="markers"]')?.textContent.trim(),
      labels: { pump:t('check.dhw.pump'), draw:t('check.dhw.draw'),
        yes:t('check.dhw.marker_yes'), no:t('check.dhw.marker_no') } };
  }, windowButton(end));
  if (focused) assert.equal(state.focus, true, context + ": roving keyboard focus follows selection");
  assert.ok(state.time && state.coverage && state.markers, context + ": selection exposes time, coverage and marker meaning");
  assert.ok(state.rate?.includes("K/h"), context + ": selected rate keeps its unit");
  assert.equal(Number.parseFloat(state.rate), expected.rate_k_h, context + ": readout uses the selected record, not the aggregate maximum");
  assert.equal(state.markers, `${state.labels.pump}: ${expected.pump_marker ? state.labels.yes : state.labels.no} · ` +
    `${state.labels.draw}: ${expected.draw_marker ? state.labels.yes : state.labels.no}`,
  context + ": the readout attributes both independent presence flags to this window only");
}

function makeTimeline() {
  const record = (ago, duration, rate, pump_marker, draw_marker) => ({
    start_s: NOW - ago, end_s: NOW - ago + duration, rate_k_h: rate,
    observed_s: duration, pump_marker, draw_marker,
  });
  return { epoch: 1, window_end_s: NOW, since_s: NOW - 80000, observed_end_s: NOW,
    unix_s: UNIX, live: true, windows: [
      record(78017, 3600, 1.8, true, false),
      record(60011, 3600, 0, false, false),
      record(30007, 3615, 1.2, false, true),
      record(11003, 3600, 2.7, true, true),
      record(4001, 3600, 0.6, false, false),
    ] };
}

async function assertGeometry(page, timeline, context) {
  const visual = await evaluate(page, ({ chart, plot, windows }) => {
    const root = document.querySelector(chart), graph = root.querySelector(plot);
    const rect = node => { const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height, bottom: r.bottom }; };
    return { plot: rect(graph), clock: root.dataset.dhwClock,
      rows: [...root.querySelectorAll(windows)].map(button => ({
        start: Number(button.dataset.startS), end: Number(button.dataset.endS),
        rate: Number(button.dataset.rate), label: button.getAttribute("aria-label"),
        tab: button.tabIndex, zero: button.classList.contains("is-zero"),
        button: rect(button), bar: rect(button.querySelector(".checkup-dhw-bar")),
      })), lanes: ["pump", "draw"].map(kind => {
        const lane = root.querySelector('[data-dhw-lane="' + kind + '"]');
        return { kind, box: rect(lane), markers: [...lane.querySelectorAll("[data-dhw-marker]")]
          .map(node => ({ end: Number(node.dataset.dhwMarker), ...rect(node) })) };
      }), sliders: root.querySelectorAll('input[type="range"]').length };
  }, { chart: CHART, plot: ".checkup-dhw-plot", windows: "button[data-dhw-window]" });
  assert.equal(visual.rows.length, timeline.windows.length, context + ": only genuine completed windows become bars; empty time is not zero");
  assert.equal(visual.clock, "wall", context + ": use only the timeline's trusted wall anchor");
  assert.equal(visual.sliders, 0, context + ": real windows, not a separate artificial slider, are the controls");
  assert.ok(visual.plot.height >= 80, context + ": the production variant01 plot is not a miniature strip");
  assert.equal(visual.rows.filter(row => row.tab === 0).length, 1, context + ": one keyboard entry into the real window sequence");
  const left = timeline.window_end_s - 86400;
  for (const [index, window] of timeline.windows.entries()) {
    const row = visual.rows[index];
    assert.deepEqual([row.start, row.end, row.rate], [window.start_s, window.end_s, window.rate_k_h],
      context + ": buttons retain actual per-window evidence");
    assert.ok(row.label?.includes("K/h"), context + ": every selectable window has an accessible rate");
    const expectedLeft = visual.plot.left + (window.start_s - left) / 86400 * visual.plot.width;
    const expectedWidth = (window.end_s - window.start_s) / 86400 * visual.plot.width;
    assert.ok(Math.abs(row.button.left - expectedLeft) <= 1.1 && Math.abs(row.button.width - expectedWidth) <= 1.1,
      context + ": bars follow actual start/end seconds on 24 h, not aligned hourly bins: " + JSON.stringify(row));
    assert.equal(row.zero, window.rate_k_h === 0, context + ": a true zero has its own visible representation");
    assert.ok(row.bar.width > 0 && row.bar.height >= 1.5, context + ": even a measured zero paints visibly");
    if (window.rate_k_h === 0) assert.ok(row.bar.height <= 3, context + ": zero is a baseline mark, not positive cooling");
  }
  const positive = visual.rows.filter(row => row.rate > 0);
  const scale = positive.at(-1).bar.height / positive.at(-1).rate;
  assert.ok(positive.every(row => Math.abs(row.bar.height - scale * row.rate) <= 1.5),
    context + ": bar heights encode the observed rates, not aggregate counts");
  for (const lane of visual.lanes) {
    const expected = timeline.windows.filter(row => row[lane.kind + "_marker"]).map(row => row.end_s);
    assert.deepEqual(lane.markers.map(marker => marker.end), expected, context + ": independent " + lane.kind + " presence, never inferred from totals");
    for (const marker of lane.markers) {
      const row = visual.rows.find(row => row.end === marker.end);
      assert.ok(marker.width > 0 && marker.height > 0 && marker.height <= 10,
        context + ": presence markers paint as bounded symbols");
      assert.ok(Math.abs(marker.left + marker.width / 2 - row.button.left - row.button.width / 2) <= 1.1,
        context + ": marker lane aligns to the actual window, without implying a duration or cause");
    }
  }
}

async function assertLayout(page, context) {
  const result = await evaluate(page, detail => {
    const root = document.querySelector(detail), outside = [], clipped = [], unnamed = [];
    const shown = node => {
      if (node.closest("[hidden]")) return false;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility === "visible";
    };
    for (const node of [root, ...root.querySelectorAll("*")]) {
      if (!shown(node)) continue;
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      const label = node.tagName + "." + (typeof node.className === "string" ? node.className : "");
      if (r.left < -1 || r.right > innerWidth + 1) outside.push(label);
      if ((["hidden", "clip"].includes(s.overflowX) && node.scrollWidth > node.clientWidth + 1) ||
          (["hidden", "clip"].includes(s.overflowY) && node.scrollHeight > node.clientHeight + 1)) clipped.push(label);
      if (node.matches("button, summary, [role=group]")) {
        const name = node.getAttribute("aria-label") || node.textContent.trim();
        if (!name) unnamed.push(label);
      }
    }
    const value = root.querySelector(".checkup-dhw-value"), unit = root.querySelector(".checkup-dhw-unit");
    return { outside, clipped, unnamed, lang: document.documentElement.lang, width: innerWidth,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      valueSize: parseFloat(getComputedStyle(value).fontSize), unitSize: parseFloat(getComputedStyle(unit).fontSize),
      text: root.textContent, fits: root.scrollWidth <= root.clientWidth + 1 };
  }, DETAIL);
  assert.ok(result.overflow <= 1 && result.fits, context + ": DHW detail must fit without horizontal scrolling");
  assert.deepEqual(result.outside, [], context + ": no offscreen translated controls or copy");
  assert.deepEqual(result.clipped, [], context + ": no clipped full readings or disclosures");
  assert.deepEqual(result.unnamed, [], context + ": chart and disclosure controls have accessible names");
  assert.ok(result.valueSize >= 24 && result.unitSize < result.valueSize, context + ": a real hero retains separate value/unit hierarchy");
  assert.doesNotMatch(result.text, /check\.(?:dhw|detail\.)|NaN|Infinity|undefined/,
    context + ": no missing translation keys or fabricated numeric evidence");
  return result;
}

async function capture(page, context) {
  const directory = process.env.DAIKIN_BROWSER_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(path.isAbsolute(directory), "DHW evidence directory must be absolute");
  const original = await evaluate(page, selector => ({ width: innerWidth, height: innerHeight,
    cardHeight: document.querySelector(selector).closest(".vitem").getBoundingClientRect().height }), DETAIL);
  // Capture one real paint at the tested width, not a stitched viewport with a repeated fixed header.
  // Taller evidence framing is temporary; every interaction/layout assertion keeps its real viewport.
  const expanded = typeof page.viewport === "function" && original.cardHeight + 240 > original.height;
  try {
    if (expanded) await page.viewport(original.width, Math.ceil(original.cardHeight + 240));
    const { clip, scroll } = await evaluate(page, async selector => {
      const node = document.querySelector(selector).closest(".vitem");
      node.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = node.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight + 1) throw new Error("DHW evidence card must fit one paint");
      return { clip: { x: r.left, y: r.top, width: r.width, height: r.height },
        scroll: { x: scrollX, y: scrollY } };
    }, DETAIL);
    // Playwright clips the visible viewport. CDP's beyond-viewport clip uses page coordinates.
    const image = page.screenshotClip ? await page.screenshotClip(clip) : Buffer.from((await page.send(
      "Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
        clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 1 } })).data, "base64");
    assert.ok(Math.abs(image.readUInt32BE(16) - clip.width) <= 1 &&
      Math.abs(image.readUInt32BE(20) - clip.height) <= 1, "DHW evidence must include the full card");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, context.replaceAll("/", "-") + ".png"), image);
  } finally {
    if (expanded) { await page.viewport(original.width, original.height); await settle(page); }
  }
}

async function beginContinuity(page, visible) {
  await evaluate(page, ({ visible, detail, chart, windows, row }) => {
    const hooks = window.__dhwBrowserHooks;
    hooks.polls = []; hooks.builds = 0;
    const root = document.querySelector(visible ? detail : row);
    const elements = visible ? [root, ...root.querySelectorAll("*")] : [root];
    const tracked = new Set(elements), ancestors = [];
    for (let node = root; node; node = node.parentNode) { tracked.add(node); ancestors.push(node); }
    const removed = [];
    const record = records => {
      for (const item of records) for (const node of item.removedNodes)
        if (tracked.has(node)) removed.push(node.nodeName);
    };
    const observer = new MutationObserver(record);
    observer.observe(document, { childList: true, subtree: true });
    hooks.witness = { root, elements, ancestors, removed, record, observer,
      focused: document.activeElement,
      selected: [...document.querySelectorAll(windows + '[aria-pressed="true"]')].map(node => node.dataset.dhwWindow),
      basis: document.querySelector('[data-dhw-disclosure="basis"]')?.open,
      energy: document.querySelector('[data-dhw-disclosure="energy"]')?.open };
    hooks.observe = true;
    pollSchedule = window.__browserPollSchedule;
    // One real visibility-resume update, then the unmodified recursive two-second poll timer.
    pollNow();
    return true;
  }, { visible, detail: DETAIL, chart: CHART, windows: WINDOWS, row: ROW });
}

async function finishContinuity(page, server, requests, visible, context) {
  try {
    await page.waitFor("window.__dhwBrowserHooks.polls.length >= 3 && !_pollBusy", { timeoutMs: 12000 });
  } catch (error) {
    const state = await page.evaluate(`({polls:window.__dhwBrowserHooks.polls, busy:_pollBusy,
      hidden:document.hidden, transport:S.transportUnavailable, failures:_pollFails})`);
    throw new Error(context + ": recurring DHW poll observation failed: " + error.message +
      "; state=" + JSON.stringify(state) + "; diagnostics=" + page.diagnostics.join(" | "));
  }
  await page.evaluate("pollStop(); pollSchedule = () => {}; true");
  const result = await evaluate(page, ({ visible, detail, chart, windows, row }) => {
    const hooks = window.__dhwBrowserHooks, w = hooks.witness;
    hooks.observe = false; w.record(w.observer.takeRecords()); w.observer.disconnect();
    return { polls: hooks.polls, builds: hooks.builds, removed: w.removed,
      retained: w.elements.every(node => node.isConnected && w.root.contains(node)),
      ancestry: w.ancestors.every(node => node.isConnected),
      rootSame: w.root === document.querySelector(visible ? detail : row),
      focus: document.activeElement === w.focused,
      selection: JSON.stringify(w.selected) === JSON.stringify([...document.querySelectorAll(windows + '[aria-pressed="true"]')]
        .map(node => node.dataset.dhwWindow)),
      disclosures: w.basis === document.querySelector('[data-dhw-disclosure="basis"]')?.open &&
        w.energy === document.querySelector('[data-dhw-disclosure="energy"]')?.open,
      chart: !!document.querySelector(chart),
      tank: S.live?.tank, paintedTank: document.getElementById("svTank").textContent };
  }, { visible, detail: DETAIL, chart: CHART, windows: WINDOWS, row: ROW });
  assert.ok(server.valuesRequests >= requests + 3 && result.polls.length >= 3,
    context + ": observe at least three actual /values responses");
  assert.ok(result.polls[2].at - result.polls[0].at >= 3900,
    context + ": recurring updates must use the real two-second cadence");
  assert.ok(new Set(result.polls.map(poll => poll.tank)).size >= 3,
    context + ": live scalar inputs change on every response, not a frozen fixture");
  assert.equal(result.tank, Number(result.polls.at(-1).tank), context + ": latest generated tank value reaches liveData");
  assert.ok(result.paintedTank.includes(Number(result.polls.at(-1).tank).toFixed(1)),
    context + ": real scalar DOM advances while completed-window evidence stays stable");
  assert.equal(result.rootSame && result.retained && result.ancestry, true,
    context + ": unchanged plot, bars, prose and controls retain their connected DOM nodes");
  assert.deepEqual(result.removed, [], context + ": even a detach-and-reattach of chart ancestry is forbidden");
  assert.equal(result.focus && result.selection && result.disclosures, true,
    context + ": live polling preserves selection, focus and native disclosure state");
  assert.equal(result.builds, 0, context + ": scalar polling performs no repeated or hidden chart construction");
  assert.equal(result.chart, visible, context + ": a collapsed diagnosis does not mount a hidden plot");
}

export async function assertDhwTimeline(page, server, context, { locales = false } = {}) {
  await page.focusEmulation(true);
  await page.evaluate("pollStop(); pollSchedule = () => {}; true");
  await page.waitFor("!_pollBusy && !S.histBusy.size");
  const originalStatus = await page.evaluate(`(() => {
    window.__dhwBrowserOriginal = { state: Object.fromEntries(Object.entries(S).map(([key, value]) =>
      [key, value instanceof Map ? new Map(value) : value instanceof Set ? new Set(value) : value])), lang: LANG,
      selection: typeof dhwSelection === 'object' ? {...dhwSelection} : null };
    return S.status;
  })()`);
  const status = structuredClone(originalStatus);
  const timeline = makeTimeline();
  const check = { id: "dhw_loss", verdict: "ok", evidence: "observation", reason: "observation_only",
    observed_s: 28800, required_s: 0, max_k_h: 4.5, windows: 8, high_windows: 7,
    quiet_high_windows: 0, pump_windows: 7, draw_windows: 6, high_with_pump: 7, high_pump_off: 0,
    circulation_on_s: 0, circulation_known_s: 0, candidate_s: 120, settle_remaining_s: 0,
    blocked: false, aborts: 3, abort_reasons: ["charge", "blind"], best_aborted_s: 3300, timeline };
  Object.assign(status, { boot_id: "dhw-browser-fixture", uptime_s: NOW,
    ui: { ...status.ui, lang: "en" }, hp: { ...status.hp, connected: true },
    diagnostics: { ...status.diagnostics, enabled: true, source: "x10a", effective_source: "x10a",
      available_sources: ["x10a", "modbus"] },
    modbus: { ...status.modbus, host: "192.0.2.20", enabled: true, connected: true, profile: "homehub" },
    history: { epoch: 1, rows: [] },
    ntp: { ...status.ntp, synced: true, time: new Date(UNIX * 1000).toISOString() },
    health: { status: "ok", source: "x10a", source_fresh: true, source_age_s: 0,
      persist: "flash", full_span: true, span_s: 86400, checks: [check] } });
  let tick = 0, revision = 0;
  const values = () => ({ values: [
    { concept: "dhw_tank", label: "DHW tank temp. (R5T)", value: (44 + ++tick / 10).toFixed(1),
      unit: "°C", reg: 0x61, group: "Domestic hot water" },
    { label: "DHW setpoint", value: "48", unit: "°C", reg: 0x60, group: "Domestic hot water" },
  ] });
  const publish = async (beforeValues, { valuesUnavailable = false } = {}) => {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    // A normal native release defers guarded rendering until the next permitted poll; its hold
    // timer does not paint. Let that hold/gesture finish before this scenario's single poll.
    await page.waitFor("!_pollBusy && !S.clickHold && !S.scrub");
    status.uptime_s = NOW + ++revision;
    status.ntp.time = new Date((UNIX + revision) * 1000).toISOString();
    const trace = check.timeline;
    if (trace) {
      trace.window_end_s = status.uptime_s;
      if (trace.observed_end_s != null && trace.live) trace.observed_end_s = status.uptime_s;
      if (Object.hasOwn(trace, "unix_s")) trace.unix_s = UNIX + revision;
    }
    const requests = server.valuesRequests;
    let releaseValues;
    const valuesGate = beforeValues ? new Promise(resolve => { releaseValues = resolve; }) : undefined;
    // An empty network response fails the real JSON read in refreshValues.
    server.setTelemetry({ status, values: valuesUnavailable ? () => undefined : values, histories: {}, valuesGate });
    try {
      await page.evaluate("pollSchedule = window.__browserPollSchedule; pollNow(); true");
      if (beforeValues) {
        await page.waitFor(`S.status.ntp.time === ${JSON.stringify(status.ntp.time)} && _pollBusy`);
        await beforeValues();
      }
    } finally {
      releaseValues?.();
    }
    await page.waitFor(`S.status?.boot_id === ${JSON.stringify(status.boot_id)} &&
      S.status.ntp.time === ${JSON.stringify(status.ntp.time)} && !_pollBusy`, { timeoutMs: 12000 });
    assert.ok(server.valuesRequests > requests, context + ": a status scenario must also render real values");
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await settle(page);
  };
  const empty = async label => {
    assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(WINDOWS)}).length`), 0,
      context + "/" + label + ": prior timed windows must be withdrawn");
    assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(DETAIL + " .checkup-dhw-empty")})?.textContent.trim()`), true,
      context + "/" + label + ": missing/empty evidence has explicit copy, not zero-filled bars");
  };
  const [first, zero, draw, both, last] = timeline.windows;
  const latest = last.end_s;
  try {
    await page.evaluate(`(() => {
      if (typeof checkupDhwChartHtml !== 'function') throw new Error('production DHW timeline builder is unavailable');
      window.__dhwBrowserHooks = { chart: checkupDhwChartHtml, values: refreshValues,
        observe: false, builds: 0, polls: [], trusted: {click:0,pointerdown:0,keydown:0} };
      const hooks = window.__dhwBrowserHooks;
      checkupDhwChartHtml = (...args) => { if (hooks.observe) hooks.builds++; return hooks.chart(...args); };
      refreshValues = async (...args) => {
        const ok = await hooks.values(...args);
        if (ok && hooks.observe) hooks.polls.push({at:performance.now(),
          tank:S._values.find(row => row.concept === 'dhw_tank')?.value});
        return ok;
      };
      hooks.input = event => {
        if (event.isTrusted && event.target.closest?.(${JSON.stringify(DETAIL + ", " + ROW)})) hooks.trusted[event.type]++;
      };
      for (const name of Object.keys(hooks.trusted)) document.addEventListener(name, hooks.input, true);
      S.hist = new Map(); S.histPin = new Map(); S.histHidden = new Map();
      S.histBusy = new Set(); S.histRequests = new Map(); S.histAwait = new Map();
      S.histIdentity = null; S.histUptime = null; S.descOpen = new Set();
      S.scrub = null; S.clickHold = false; S.insp = null; S.dashboardCard = 'diagnosis';
      showStage('dashboard'); return true;
    })()`);
    await publish();
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(ROW)}).getAttribute('aria-expanded')`), "false");
    await evaluate(page, row => document.querySelector(row).focus(), ROW);
    let requests = server.valuesRequests;
    await beginContinuity(page, false);
    await finishContinuity(page, server, requests, false, context + "/collapsed");

    await tap(page, ROW);
    await page.waitFor(`!!document.querySelector(${JSON.stringify(CHART)}) && !S.clickHold`);
    await settle(page);
    const hero = await page.evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(DETAIL)});
      return { unit: root.querySelector('.checkup-dhw-unit').textContent.trim(), text:root.innerText,
        basis:root.querySelector('[data-dhw-disclosure="basis"]').open,
        energy:root.querySelector('[data-dhw-disclosure="energy"]').open };
    })()`);
    assert.equal(await heroValue(page), "4.5", context + ": hero retains the aggregate maximum, distinct from the timed chart's 2.7");
    assert.equal(hero.unit, "K/h", context + ": hero shows net sensor cooling, not kWh or a loss share");
    assert.equal(hero.basis || hero.energy, false, context + ": supporting details and energy start collapsed");
    assert.match(hero.text, /R5T/, context + ": the single-sensor limitation remains visible");
    assert.doesNotMatch(hero.text, /synthetic|illustrative timeline|example windows/i,
      context + ": the production timeline must not use the concept preview's fabricated series");
    await assertGeometry(page, timeline, context);
    await assertLayout(page, context + "/en");
    await capture(page, context + "/en");

    await tap(page, windowButton(first.end_s));
    await assertSelection(page, first.end_s, context + "/pointer");
    const gap = await evaluate(page, ({ chart, at, windowEnd }) => {
      const plot = document.querySelector(chart + ' .checkup-dhw-plot');
      const r = plot.getBoundingClientRect();
      const x = r.left + (at - windowEnd + 86400) * r.width / 86400, y = r.top + r.height / 2;
      return {x,y,blank:!document.elementFromPoint(x,y)?.closest('[data-dhw-window]')};
    }, { chart: CHART, at: (first.end_s + zero.start_s) / 2, windowEnd: timeline.window_end_s });
    assert.equal(gap.blank, true, context + ": a real unobserved gap has no fabricated selectable zero");
    await page.nativeClick(gap.x, gap.y);
    await assertSelection(page, first.end_s, context + "/blank-does-not-select");
    await tap(page, windowButton(zero.end_s));
    await assertSelection(page, zero.end_s, context + "/zero");
    await tap(page, `${CHART} button[data-dhw-action="previous"]`);
    await assertSelection(page, first.end_s, context + "/previous");
    await tap(page, `${CHART} button[data-dhw-action="next"]`);
    await assertSelection(page, zero.end_s, context + "/next");
    // Explicit focus is setup only; every state-changing keyboard action below is trusted input.
    await evaluate(page, selector => document.querySelector(selector).focus(), windowButton(zero.end_s));
    await key(page, "End", "End", 35);
    await assertSelection(page, latest, context + "/End", true);
    await key(page, "ArrowLeft", "ArrowLeft", 37);
    await assertSelection(page, both.end_s, context + "/ArrowLeft", true);
    await key(page, "Home", "Home", 36);
    await assertSelection(page, first.end_s, context + "/Home", true);
    await key(page, "ArrowRight", "ArrowRight", 39);
    await assertSelection(page, zero.end_s, context + "/ArrowRight", true);
    await key(page, "Enter", "Enter", 13);
    await assertSelection(page, zero.end_s, context + "/Enter", true);
    await key(page, " ", "Space", 32);
    await assertSelection(page, zero.end_s, context + "/Space", true);
    await key(page, "Escape", "Escape", 27);
    await assertSelection(page, latest, context + "/Escape", true);

    await tap(page, `${BASIS} > summary`);
    await tap(page, `${ENERGY} > summary`);
    const disclosures = await page.evaluate(`(() => {
      const basis = document.querySelector(${JSON.stringify(BASIS)}), energy = document.querySelector(${JSON.stringify(ENERGY)});
      return {basis:basis.open,energy:energy.open,basisText:basis.innerText,energyText:energy.innerText};
    })()`);
    assert.equal(disclosures.basis && disclosures.energy, true, context + ": native summaries reveal their real content");
    assert.match(disclosures.basisText, /8/, context + ": basis retains aggregate window totals, not only timed records");
    assert.match(disclosures.basisText, /3/, context + ": discarded-candidate evidence is still available");
    for (const phrase of [/200\s*l/i, /COP/, /1\.05\s*kWh/, /0\.35[–−-]0\.42\s*kWh/, /not measured energy/i])
      assert.match(disclosures.energyText, phrase, context + ": one-hour energy illustration preserves explicit assumptions");
    assert.doesNotMatch(disclosures.energyText, /per day|kWh\/day|25\.12/,
      context + ": maximum cooling is never extrapolated into a daily meter reading");
    await tap(page, windowButton(draw.end_s));
    await assertSelection(page, draw.end_s, context + "/3615-second-window");
    const stamps = await evaluate(page, ({ chart, trace, window }) => {
      const formatter = new Intl.DateTimeFormat('en', {month:'short',day:'numeric',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'});
      const bootUnix = trace.unix_s - trace.window_end_s;
      return { expected:[window.start_s,window.end_s].map(s => formatter.format(new Date((bootUnix+s)*1000))),
        actual:document.querySelector(chart + ' [data-dhw-readout="time"]').textContent,
        coverage:document.querySelector(chart + ' [data-dhw-readout="coverage"]').textContent };
    }, { chart: CHART, trace: timeline, window: draw });
    for (const stamp of stamps.expected) assert.ok(stamps.actual.includes(stamp),
      context + ": selected wall times map exact uptime seconds through the supplied anchor");
    assert.match(stamps.coverage, /60:15/, context + ": coverage preserves a real 3615-second completion, not a fabricated clock-hour bucket");
    await evaluate(page, selector => document.querySelector(selector).focus({preventScroll:true}), windowButton(draw.end_s));
    await settle(page);
    requests = server.valuesRequests;
    await beginContinuity(page, true);
    await finishContinuity(page, server, requests, true, context + "/open-selected");

    // Expiry of an older saved bucket can change aggregate evidence without changing any timed
    // current-boot window. Its scalar reading must update without discarding the selected plot.
    await page.evaluate(`window.__dhwBrowserHooks.aggregate = {
      chart:document.querySelector(${JSON.stringify(CHART)}), focused:document.activeElement }; true`);
    Object.assign(check, { max_k_h: 4.4, windows: 7, observed_s: 25200,
      high_windows: 6, pump_windows: 6, draw_windows: 5, high_with_pump: 6 });
    await publish();
    assert.equal(await heroValue(page), "4.4",
      context + ": a later aggregate scalar updates the hero instead of freezing the accepted frame");
    assert.equal(await page.evaluate(`window.__dhwBrowserHooks.aggregate.chart === document.querySelector(${JSON.stringify(CHART)}) &&
      window.__dhwBrowserHooks.aggregate.focused === document.activeElement`), true,
      context + ": changed scalar text retains the chart and its keyboard focus");
    await assertSelection(page, draw.end_s, context + "/new-aggregate");

    // A quantized aggregate bucket can expire before an exact completion near the 24h left edge.
    // Hero/disclosure structure may change, but that unchanged trace and its ancestry must not move.
    const aggregateBeforeEdge = { ...check };
    const edgeEnd = NOW - 86400 + 600;
    check.timeline = { ...timeline, epoch: timeline.epoch + 100, since_s: edgeEnd - 3600, windows: [{
      start_s: edgeEnd - 3600, end_s: edgeEnd, rate_k_h: 4.4, observed_s: 3590,
      pump_marker: true, draw_marker: false,
    }] };
    Object.assign(check, { windows: 1, observed_s: 3600, high_windows: 1,
      pump_windows: 1, draw_windows: 0, high_with_pump: 1 });
    await publish();
    await evaluate(page, selector => document.querySelector(selector).focus({ preventScroll: true }), windowButton(edgeEnd));
    await evaluate(page, ({ chart, basis }) => {
      const hooks = window.__dhwBrowserHooks, root = document.querySelector(chart);
      const nodes = [root, ...root.querySelectorAll("*")], ancestors = [];
      for (let node = root.parentNode; node; node = node.parentNode) ancestors.push(node);
      const tracked = new Set([...nodes, ...ancestors]), removed = [];
      const record = records => {
        for (const item of records) for (const node of item.removedNodes)
          if (tracked.has(node)) removed.push(node.nodeName);
      };
      const observer = new MutationObserver(record);
      observer.observe(document, { childList: true, subtree: true });
      hooks.aggregateEdge = { root, nodes, ancestors, removed, record, observer,
        focus: document.activeElement, basis: document.querySelector(basis).open };
      hooks.observe = true; hooks.builds = 0;
    }, { chart: CHART, basis: BASIS });
    try {
      for (const available of [false, true]) {
        Object.assign(check, { verdict: available ? "ok" : "collecting",
          reason: available ? "observation_only" : "day_incomplete",
          max_k_h: available ? 4.4 : null, windows: available ? 1 : 0,
          observed_s: available ? 3600 : 0, high_windows: available ? 1 : 0,
          pump_windows: available ? 1 : 0, high_with_pump: available ? 1 : 0 });
        await publish();
        const edge = await evaluate(page, ({ chart, basis, energy }) => {
          const hooks = window.__dhwBrowserHooks, w = hooks.aggregateEdge;
          w.record(w.observer.takeRecords());
          const disclosure = document.querySelector(energy);
          return { retained: w.root === document.querySelector(chart) &&
              w.nodes.every(node => node.isConnected && w.root.contains(node)) &&
              w.ancestors.every(node => node.isConnected), removed: w.removed,
            focus: document.activeElement === w.focus,
            basis: document.querySelector(basis)?.open === w.basis,
            energyVisible: !!disclosure?.getClientRects().length, builds: hooks.builds };
        }, { chart: CHART, basis: BASIS, energy: ENERGY });
        const label = context + "/aggregate-" + (available ? "returns" : "expires");
        assert.equal(edge.retained && edge.focus && edge.basis, true,
          label + ": scalar availability changes retain the connected plot, focus and basis state");
        assert.deepEqual(edge.removed, [], label + ": no temporary detach of the plot or its ancestors");
        assert.equal(edge.builds, 0, label + ": unchanged timed records never rebuild the chart");
        assert.equal(edge.energyVisible, available, label + ": no energy illustration without an aggregate rate");
        assert.deepEqual(await selected(page), [edgeEnd], label + ": retained evidence stays selected independently of aggregate counts");
      }
    } finally {
      await page.evaluate(`window.__dhwBrowserHooks.aggregateEdge.observer.disconnect();
        window.__dhwBrowserHooks.observe=false; true`);
      Object.assign(check, aggregateBeforeEdge);
      await publish();
    }
    // Inactive cards may retain a cached plot, but cannot build or expose an interactive hidden one.
    await tap(page, '#cardNav [data-card="group:Domestic hot water"]');
    await page.evaluate("window.__dhwBrowserHooks.observe=true; window.__dhwBrowserHooks.builds=0; true");
    await publish();
    assert.equal(await page.evaluate(`(() => {
      const chart = document.querySelector(${JSON.stringify(CHART)});
      return !chart || chart.getClientRects().length === 0;
    })()`), true, context + ": changing dashboard cards hides the cached plot and its controls");
    assert.equal(await page.evaluate("window.__dhwBrowserHooks.builds"), 0, context + ": an unselected card does no hidden chart work");
    await page.evaluate("window.__dhwBrowserHooks.observe=false; true");
    await tap(page, '#cardNav [data-card="diagnosis"]');
    await page.waitFor(`!!document.querySelector(${JSON.stringify(CHART)})`);

    for (const reset of ["timeline", "history", "source-modbus", "source-x10a", "boot"]) {
      await tap(page, windowButton(first.end_s));
      await assertSelection(page, first.end_s, context + "/before-" + reset);
      if (reset === "timeline") timeline.epoch++;
      if (reset === "history") status.history.epoch++;
      if (reset.startsWith("source-")) {
        status.health.source = status.diagnostics.source = status.diagnostics.effective_source = reset.slice(7);
      }
      if (reset === "boot") status.boot_id = "dhw-browser-other-boot";
      await publish();
      await assertSelection(page, latest, context + "/reset-" + reset);
    }

    const plotState = () => evaluate(page, chart => ({
      stale: document.getElementById("valueGroups").dataset.dhwStale,
      top: document.querySelector(chart + " .checkup-dhw-plot").getBoundingClientRect().top,
    }), CHART);
    const beforePoll = await plotState();
    assert.equal(beforePoll.stale, "false");
    await publish(async () => {
      assert.deepEqual(await plotState(), beforePoll,
        context + ": a fresh status leaves the plot stable while values are pending");
    });

    const staleNoteVisible = () => page.evaluate(`(() => {
      const note = document.querySelector(${JSON.stringify(DETAIL + " .checkup-dhw-stale")});
      return !!note?.innerText.trim() && note.getClientRects().length > 0 && getComputedStyle(note).display !== 'none';
    })()`);
    await tap(page, windowButton(first.end_s));
    await page.waitFor("!S.clickHold");
    const priorDiagnostics = page.diagnostics.length;
    server.setTelemetry({ status, statusUnavailable: true, values, histories: {} });
    await page.evaluate("pollSchedule = window.__browserPollSchedule; pollNow(); true");
    await page.waitFor("S.transportUnavailable === 'status' && !_pollBusy");
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    assert.equal(await staleNoteVisible(), true, context + ": a real status failure labels the retained snapshot");
    await publish(async () => {
      assert.equal(await page.evaluate("S.transportUnavailable"), "values");
      assert.equal(await staleNoteVisible(), false,
        context + ": accepted status clears stale DHW even while recovering values are held");
    }, { valuesUnavailable: true });
    assert.equal(await page.evaluate("S.transportUnavailable"), "values",
      context + ": the browser must actually reject the values response");
    assert.equal(await staleNoteVisible(), false, context + ": failed values do not mark fresh DHW stale");
    await assertSelection(page, first.end_s, context + "/values-failure-retains-selection");
    await publish();
    const expectedFailure = page.diagnostics.findIndex((line, index) =>
      index >= priorDiagnostics && /Failed to load resource.*500/.test(line));
    if (expectedFailure >= 0) page.diagnostics.splice(expectedFailure, 1);

    // An omitted or redacted timeline withdraws exact windows before the next value frame.
    // The status still carries fresh aggregate readings.
    await evaluate(page, selector => document.querySelector(selector).focus({ preventScroll: true }),
      windowButton(latest));
    delete check.timeline;
    await publish(async () => {
      assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(WINDOWS)}).length`), 0,
        context + ": adopting an omitted/redacted timeline withdraws old precise data before delayed values finish");
      assert.equal(await evaluate(page, selector => document.activeElement.matches(selector), ROW), true,
        context + ": withdrawing the focused chart returns focus to the diagnosis row");
      assert.equal(await staleNoteVisible(), false,
        context + ": an omitted timeline is not stale readings while values are pending");
    });
    await empty("omitted-redacted");
    assert.equal(await staleNoteVisible(), false,
      context + ": a fresh aggregate-only frame displays only the timed-evidence availability message");
    assert.equal(await heroValue(page), "4.4");
    check.timeline = { ...timeline, epoch: 0, live: false };
    await publish();
    await empty("malformed");
    assert.equal(await staleNoteVisible(), false, context + ": malformed detail cannot assert stale readings");
    check.timeline = { ...timeline, windows: [] };
    await publish();
    await empty("no-timed-completions");
    check.timeline = timeline;
    await publish();
    await assertSelection(page, latest, context + "/after-omission");

    delete timeline.unix_s;
    await publish();
    const relative = await page.evaluate(`(() => {
      const chart = document.querySelector(${JSON.stringify(CHART)});
      return { clock:chart.dataset.dhwClock, axis:chart.querySelector('.checkup-dhw-axis').textContent,
        time:chart.querySelector('[data-dhw-readout="time"]').textContent };
    })()`);
    assert.equal(relative.clock, "relative", context + ": status NTP alone cannot invent a timeline wall anchor");
    assert.match(relative.axis, /24\s*h/);
    assert.equal((relative.time.match(/before snapshot/g) || []).length, 2,
      context + ": both range endpoints explicitly mean relative durations before this snapshot");
    assert.doesNotMatch(relative.time, /2026|\bGMT|\bUTC/, context + ": missing unix_s never fabricates dated clock readings");
    status.ntp.synced = false;
    await publish();
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(CHART)}).dataset.dhwClock`), "relative");

    status.health.source_fresh = false;
    status.health.source_age_s = 900;
    check.reason = "source_stale";
    timeline.live = false;
    await publish();
    assert.equal(await page.evaluate("document.getElementById('valueGroups').dataset.dhwStale"), "true",
      context + ": a stale source is explicitly stale, not a current zero");
    assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(WINDOWS)}).length`), timeline.windows.length,
      context + ": staleness does not erase valid completed historical windows");
    assert.equal(await staleNoteVisible(), true, context + ": the visible reader can recognize a historical snapshot");

    const completed = { ...check };
    Object.assign(check, { verdict: "collecting", reason: "no_eligible_windows", windows: 0, max_k_h: null,
      candidate_s: 3300, observed_s: 3300, aborts: 0, abort_reasons: [], best_aborted_s: 0,
      timeline: { ...timeline, windows: [], observed_end_s: timeline.window_end_s - 2, live: true } });
    status.health.source_fresh = true; status.health.source_age_s = 0;
    await publish();
    await empty("collecting");
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(ROW + " .vrow-val")}).innerText`),
      await page.evaluate("t('check.status.collecting')"), context + ": a candidate is not a measured zero");
    assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(ENERGY)})`), false,
      context + ": no rate means no numeric energy illustration");
    Object.assign(check, { verdict: "unavailable", blocked: true, aborts: 14,
      abort_reasons: ["blind"], best_aborted_s: 3300 });
    await publish();
    await empty("blocked");
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(ROW + " .vrow-val")}).innerText`),
      await page.evaluate("t('check.status.no_window')"), context + ": a blocked day does not keep promising collection");
    assert.doesNotMatch(await page.evaluate(`document.querySelector(${JSON.stringify(DETAIL)}).innerText`), /\b0\s*K\/h|\bkWh\b/,
      context + ": blocked or missing evidence never masquerades as zero cooling/energy");

    Object.assign(check, completed, { timeline, reason: "observation_only" });
    timeline.live = true; timeline.unix_s = UNIX;
    status.ntp.synced = true; status.health.source_fresh = true; status.health.source_age_s = 0;
    await publish();
    for (const disclosure of [BASIS, ENERGY]) {
      if (!await page.evaluate(`document.querySelector(${JSON.stringify(disclosure)}).open`))
        await tap(page, disclosure + " > summary");
    }
    const languages = locales ? await page.evaluate("Array.from(UI_LANGS)") : ["en"];
    if (locales) assert.equal(await page.evaluate("innerWidth"), 320, context + ": the full locale matrix uses the narrow 320px phone");
    for (const language of languages) {
      await evaluate(page, async language => { await setLang(language); renderApp(); }, language);
      await settle(page);
      const layout = await assertLayout(page, context + "/locale/" + language);
      assert.equal(layout.lang, language, context + ": use the actual shipped locale catalog");
      assert.match(await page.evaluate(`document.querySelector(${JSON.stringify(ENERGY)}).textContent`), /200.*COP/s,
        context + "/" + language + ": localized energy copy retains its water-volume and COP assumptions");
      if (["en", "de"].includes(language)) await capture(page, context + "/locale/" + language);
      if (language === "de" && process.env.DAIKIN_BROWSER_EVIDENCE_DIR) {
        // Also retain the compact German card, using real summary actions rather than posed DOM.
        for (const disclosure of [BASIS, ENERGY]) await tap(page, disclosure + " > summary");
        assert.equal(await evaluate(page, selectors => selectors.every(selector =>
          !document.querySelector(selector).open), [BASIS, ENERGY]), true);
        await assertLayout(page, context + "/locale/de-compact");
        await capture(page, context + "/locale/de-compact");
        for (const disclosure of [BASIS, ENERGY]) await tap(page, disclosure + " > summary");
        assert.equal(await evaluate(page, selectors => selectors.every(selector =>
          document.querySelector(selector).open), [BASIS, ENERGY]), true);
      }
    }
    const trusted = await page.evaluate("window.__dhwBrowserHooks.trusted");
    assert.ok(trusted.click >= 8 && trusted.pointerdown >= 8 && trusted.keydown >= 7,
      context + ": actions must execute through trusted native pointer/touch and keyboard events");
    assert.deepEqual(page.diagnostics, [], context + ": real DHW lifecycles emit no browser exceptions or console errors");
    console.log("DHW timeline checked: " + context + "; 5 real timed windows, independent aggregate totals; " +
      languages.length + " locales; native " + (page.inputMode === "touch" ? "iPad touch" : "pointer/keyboard") +
      "; collapsed/open 3-response recurring polling continuity");
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy");
    server.setTelemetry();
    await page.evaluate(`(async () => {
      const hooks = window.__dhwBrowserHooks, original = window.__dhwBrowserOriginal;
      if (hooks) {
        hooks.observe = false; hooks.witness?.observer.disconnect();
        checkupDhwChartHtml = hooks.chart; refreshValues = hooks.values;
        for (const name of Object.keys(hooks.trusted)) document.removeEventListener(name, hooks.input, true);
      }
      if (original) {
        for (const key of Object.keys(S)) if (!Object.hasOwn(original.state,key)) delete S[key];
        Object.assign(S, original.state); S.clickHold = false;
        if (original.selection) dhwSelection = original.selection;
        await setLang(original.lang); renderApp();
      }
      delete window.__dhwBrowserHooks; delete window.__dhwBrowserOriginal;
      return true;
    })()`);
    await page.focusEmulation(false);
  }
}
