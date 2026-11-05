import assert from "node:assert/strict";
import { INSPECTOR_TRENDS, NO_HISTORY_INSPECTORS, makeHistoryMotionFixture,
  MODBUS_HISTORY_ROWS } from "./test_browser_history_fixture.mjs";

const BUDGET_MS = 250;
export const HISTORY_MOTION_MUTATIONS = Object.freeze([
  "history-eager", "history-stall", "history-replace", "history-restart", "history-unknown",
  "history-disclosure-replace",
]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (page, fn, args = {}) =>
  page.evaluate("(" + fn.toString() + ")(" + JSON.stringify(args) + ")");

// Native input goes through hit testing and the delegated production handler. A synthetic .click()
// would miss overlapping SVG targets and would not witness input dispatch on a blocked main thread.
async function click(page, selector, inspector = "") {
  const point = await evaluate(page, ({ selector, inspector }) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error("history motion target missing: " + selector);
    node.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = node.getBoundingClientRect(), candidates = [];
    const paths = [...node.querySelectorAll(".sc-hitline, .sc-hitarea")];
    if (typeof node.getPointAtLength === "function") paths.unshift(node);
    for (const path of paths) {
      if (typeof path.getTotalLength !== "function") continue;
      for (const fraction of [0.5, 0.25, 0.75, 0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]) {
        const p = path.getPointAtLength(path.getTotalLength() * fraction);
        const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
        candidates.push({ x: screen.x, y: screen.y });
      }
    }
    for (const x of [0.5, 0.25, 0.75]) for (const y of [0.5, 0.25, 0.75])
      candidates.push({ x: rect.left + rect.width * x, y: rect.top + rect.height * y });
    const point = candidates.find(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return inspector ? hit?.closest("[data-insp]")?.dataset.insp === inspector
        : hit && (hit === node || node.contains(hit));
    });
    if (!point) throw new Error("history motion target is not reachable: " + selector +
      "; node=" + node.outerHTML.slice(0, 700) + "; hits=" + JSON.stringify(candidates.map(point =>
        ({ ...point, hit: document.elementFromPoint(point.x, point.y)?.closest("[data-insp]")?.dataset.insp }))));
    return point;
  }, { selector, inspector });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left",
    clickCount: 1, ...point });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left",
    clickCount: 1, ...point });
}

async function installHooks(page, mutation) {
  await evaluate(page, ({ mutation }) => {
    window.__motionHooks = { renderApp, histHtml, env3HistHtml, descAccordion,
      circulationSettingsCardHtml, refreshValues, refreshStatus, replaceHistoryHtml };
    const original = window.__motionHooks;
    window.__motionAllPolls = 0;
    let eager;
    if (mutation === "history-eager") {
      const code = original.descAccordion.toString();
      if (!code.includes("open && trendId")) throw new Error("history mutation target missing");
      eager = window.eval("(" + code.replace("open && trendId", "trendId") + ")");
    }
    descAccordion = (...args) => {
      const previous = window.__motionClosed;
      window.__motionClosed = !S.descOpen.has(args[0]);
      try { return (eager && window.__motionObserve ? eager : original.descAccordion)(...args); }
      finally { window.__motionClosed = previous; }
    };
    circulationSettingsCardHtml = (...args) => {
      const previous = window.__motionClosed;
      window.__motionClosed = !S.descOpen.has("diagnostics:circulation");
      try { return original.circulationSettingsCardHtml(...args); }
      finally { window.__motionClosed = previous; }
    };
    histHtml = (...args) => {
      if (window.__motionObserve) {
        window.__motionBuilds++;
        if (window.__motionClosed) window.__motionClosedBuilds++;
      }
      return original.histHtml(...args);
    };
    env3HistHtml = (...args) => {
      if (window.__motionObserve) window.__motionBuilds++;
      return original.env3HistHtml(...args);
    };
    refreshValues = async (...args) => {
      const ok = await original.refreshValues(...args);
      if (ok) window.__motionAllPolls++;
      if (ok && window.__motionObserve) window.__motionPolls++;
      return ok;
    };
    refreshStatus = async (...args) => {
      const ok = await original.refreshStatus(...args);
      if (ok && window.__motionObserve) window.__motionStatusPolls++;
      return ok;
    };
    renderApp = (...args) => {
      if (window.__motionObserve && (S.scrub || S.clickHold)) window.__motionHolds++;
      const result = original.renderApp(...args);
      if (!window.__motionObserve) return result;
      if (window.__motionInactive?.some(({ node }) =>
        node.getAnimations().some(animation => animation instanceof CSSAnimation)))
        window.__motionUnexpectedMotion++;
      if (mutation === "history-stall") {
        const end = performance.now() + 400;
        while (performance.now() < end) { /* Deliberate main-thread stall, above the fixed budget. */ }
      } else if (mutation === "history-replace") {
        const plot = document.querySelector("#inspHist .vhist-plot");
        if (!plot) throw new Error("history replace mutation target missing");
        plot.outerHTML = plot.outerHTML;
      } else if (mutation === "history-restart") {
        const flow = document.getElementById("fSup1");
        if (!flow?.getAnimations().some(animation => animation instanceof CSSAnimation))
          throw new Error("history restart mutation target missing");
        flow.style.animation = "none";
        flow.getBoundingClientRect();
        flow.style.animation = "";
      }
      return result;
    };
    replaceHistoryHtml = (host, html) => {
      if (mutation === "history-disclosure-replace" && window.__motionObserve) host.innerHTML = html;
      else return original.replaceHistoryHtml(host, html);
    };
    window.__motionKey = event => {
      if (window.__motionObserve && event.code === "ShiftLeft") window.__motionInputs++;
    };
    window.__motionMarkup = plot => {
      const copy = plot.closest(".vhist").cloneNode(true);
      for (const node of copy.querySelectorAll("[data-rev]")) node.removeAttribute("data-rev");
      return copy.outerHTML;
    };
    document.addEventListener("keydown", window.__motionKey, true);
    document.addEventListener("keyup", window.__motionKey, true);
    if (mutation === "history-unknown") INSPECT.__motionUnclassified = { t: { en: "Unclassified" } };
    return true;
  }, { mutation });
}

async function mountFixture(page, server, fixture) {
  await page.evaluate("window.__motionObserve = false; pollStop(); pollSchedule = () => {}; true");
  await page.waitFor("!_pollBusy && !S.histBusy.size");
  let tick = 0;
  server.setTelemetry({ status: fixture.status, histories: fixture.histories,
    values: () => fixture.values(++tick) });
  await evaluate(page, () => {
    S.hist = new Map(); S.histPin = new Map(); S.histHidden = new Map();
    S.histBusy = new Set(); S.histRequests = new Map(); S.histAwait = new Map();
    S.histIdentity = null; S.histUptime = null; S.descOpen = new Set();
    S.scrub = null; S.clickHold = false; S.insp = null;
    S.inspSig = null; S.inspHistSig = null; showStage("dashboard");
    window.__motionMountPoll = window.__motionAllPolls;
    pollSchedule = window.__browserPollSchedule; pollNow(); return true;
  });
  await page.waitFor("!_pollBusy && window.__motionAllPolls > window.__motionMountPoll && S.status?.boot_id === 'history-motion-fixture' && S.live?.rps > 5");
}

async function openInspector(page, key, id, context) {
  await page.evaluate("showStage('dashboard'); true");
  await click(page, '#schem [data-insp="' + key + '"]', key);
  await page.waitFor("S.insp === " + JSON.stringify(key) + " && !S.histBusy.size");
  const chart = await evaluate(page, () => {
    const plot = document.querySelector("#inspHist [data-hist]");
    const view = plot && historyView(plot.dataset.hist, plot.dataset.source || "");
    return { id: plot?.dataset.hist || "", samples: view?.v.length || 0,
      sources: view?.series.map(series => series.source) || [],
      forecast: !!document.querySelector("#inspHist .env-forecast-temperature") };
  });
  assert.equal(chart.id, id, context + ": inspector must show its own history");
  assert.ok(chart.samples >= 288, context + ": full day must reach the real renderer");
  return chart;
}

async function observe(page, server, context, selectors, { inspector = false, status = false,
  fixture = null, animationIds = ["fSup1", "rfHot", "scFan", "scPump"],
  inactiveAnimationIds = [] } = {}) {
  await page.send("Page.bringToFront");
  await page.waitFor("document.visibilityState === 'visible' && !document.hidden");
  // Opening/disclosure transitions may legitimately finish. Persistent flow CSSAnimation objects
  // are the continuity witness; finite CSSTransition completion is not a stopped pipe animation.
  await page.waitFor("!S.clickHold && !S.histBusy.size && !_pollBusy");
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  const requests = server.valuesRequests;
  if (status) fixture.status.sys.free_heap -= 1024;
  await evaluate(page, ({ selectors, animationIds, inactiveAnimationIds }) => {
    window.__motionPlots = selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) throw new Error("history observation plot missing: " + selector);
      return { selector, node };
    });
    window.__motionPlots[0].node.focus({ preventScroll: true });
    window.__motionFocused = document.activeElement;
    const body = document.getElementById("inspBody");
    window.__motionBody = { node: body.firstChild, html: body.innerHTML };
    window.__motionLive = { flow: S.live?.flow, pump: S.live?.pump, rps: S.live?.rps,
      mbFields: [...(S.live?.mbFields || [])] };
    // Settings hides the entire schematic; its nonessential CSS animations legitimately stop.
    // Require all four moving witnesses on Dashboard, while Settings still gets frame/input and
    // plot-continuity checks under the same live poll loop.
    window.__motionExpectedAnimations = S.stage === "dashboard" ? animationIds.length : 0;
    window.__motionAnimations = (S.stage === "dashboard" ? animationIds : []).map(id => {
      const node = document.getElementById(id);
      const animation = node.getAnimations().find(item => item instanceof CSSAnimation);
      return { id, node, animation, time: animation?.currentTime,
        initial: { name: getComputedStyle(node).animationName, state: animation?.playState || "absent" } };
    });
    window.__motionInactive = (S.stage === "dashboard" ? inactiveAnimationIds : []).map(id =>
      ({ id, node: document.getElementById(id) }));
    window.__motionUnexpectedMotion = 0;
    window.__motionPolls = 0; window.__motionStatusPolls = 0;
    window.__motionHolds = 0;
    window.__motionBuilds = 0; window.__motionClosedBuilds = 0; window.__motionInputs = 0;
    window.__motionFrames = { started: performance.now(), last: performance.now(), count: 0, maxGap: 0 };
    const sample = now => {
      const state = window.__motionFrames;
      state.maxGap = Math.max(state.maxGap, now - state.last); state.last = now; state.count++;
      state.request = requestAnimationFrame(sample);
    };
    window.__motionFrames.request = requestAnimationFrame(sample);
    window.__motionObserve = true;
    // Use the real visibility-resume path: one immediate HTTP update followed by the unchanged
    // two-second timer. Three complete updates therefore span at least two full polling intervals.
    pollNow();
    return true;
  }, { selectors, animationIds, inactiveAnimationIds });
  let done = false, inputProbes = 0, inputMax = 0, pollError;
  const polling = page.waitFor("!_pollBusy && window.__motionPolls >= 3", { timeoutMs: 12000 })
    .catch(error => { pollError = error; })
    .finally(() => { done = true; });
  while (!done) {
    // Measure each native event's dispatch/ack independently. page.key also forces a separate
    // Page.getLayoutMetrics flush; adding two events and that diagnostic layout is not input latency.
    for (const type of ["rawKeyDown", "keyUp"]) {
      const started = performance.now();
      await page.send("Input.dispatchKeyEvent", { type, key: "Shift", code: "ShiftLeft",
        windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
      inputMax = Math.max(inputMax, performance.now() - started);
    }
    inputProbes++;
    await delay(100);
  }
  await polling;
  if (pollError) {
    const state = await page.evaluate("({polls:window.__motionPolls,statusPolls:window.__motionStatusPolls,busy:_pollBusy,fails:_pollFails,hidden:document.hidden,probe:S.hpProbeBusy,transport:S.transportUnavailable,desc:[...S.descOpen]})");
    throw new Error(context + ": " + pollError.message + "; state=" + JSON.stringify(state) +
      "; diagnostics=" + page.diagnostics.join(" | "));
  }
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  const motion = await evaluate(page, () => {
    window.__motionObserve = false;
    cancelAnimationFrame(window.__motionFrames.request);
    const body = document.getElementById("inspBody");
    return {
      polls: window.__motionPolls, statusPolls: window.__motionStatusPolls,
      holds: window.__motionHolds,
      builds: window.__motionBuilds, closedBuilds: window.__motionClosedBuilds,
      hiddenCharts: document.querySelectorAll("#valueGroups .vitem:not(.open) .vhist, #settingsCards .vitem:not(.open) .vhist").length,
      plots: window.__motionPlots.map(({ selector, node }) =>
        ({ selector, same: document.querySelector(selector) === node })),
      bodyUnchanged: body.innerHTML === window.__motionBody.html,
      sameBody: body.firstChild === window.__motionBody.node,
      animations: window.__motionAnimations.map(({ id, node, animation, time, initial }) => ({
        id, same: node.getAnimations().includes(animation), running: animation?.playState === "running",
        elapsed: animation?.currentTime - time, initial,
      })),
      initialLive: window.__motionLive,
      finalLive: { flow: S.live?.flow, pump: S.live?.pump, rps: S.live?.rps,
        mbFields: [...(S.live?.mbFields || [])] },
      inactiveAnimations: window.__motionInactive.map(({ id, node }) =>
        ({ id, absent: !node.getAnimations().some(animation => animation instanceof CSSAnimation) })),
      unexpectedMotion: window.__motionUnexpectedMotion,
      expectedAnimations: window.__motionExpectedAnimations,
      sameFocus: document.activeElement === window.__motionFocused,
      inputs: window.__motionInputs, frames: window.__motionFrames.count,
      duration: performance.now() - window.__motionFrames.started, maxFrameGap: window.__motionFrames.maxGap,
    };
  });
  assert.ok(server.valuesRequests >= requests + 3 && motion.polls >= 3,
    context + ": at least three real values polls");
  assert.ok(motion.duration >= 4000, context + ": three real updates must span two full polling intervals");
  assert.equal(motion.holds, 0, context + ": polling must not be hidden behind interaction holds");
  assert.equal(motion.closedBuilds, 0, context + ": polls must not rebuild cached charts in closed rows");
  assert.equal(motion.hiddenCharts, 0, context + ": closed rows must not retain duplicate history SVGs");
  if (inspector) assert.equal(motion.builds, 0, context + ": unchanged inspector must not rebuild history");
  for (const plot of motion.plots)
    assert.equal(plot.same, true, context + ": unchanged plot must remain mounted: " + plot.selector);
  assert.equal(motion.sameFocus, true, context + ": focused history control must survive polling");
  if (inspector && motion.bodyUnchanged)
    assert.equal(motion.sameBody, true, context + ": unchanged inspector prose must remain mounted");
  assert.equal(motion.animations.length, motion.expectedAnimations,
    context + ": cover all visible schematic animation witnesses");
  for (const animation of motion.animations) {
    assert.equal(animation.same && animation.running, true,
      context + "/" + animation.id + ": preserve running CSSAnimation instance; " +
      JSON.stringify({ animation, initialLive: motion.initialLive, finalLive: motion.finalLive }));
    assert.ok(animation.elapsed >= motion.duration - BUDGET_MS,
      context + "/" + animation.id + ": animation must advance with real time");
  }
  assert.equal(motion.unexpectedMotion, 0, context + ": unavailable motion must remain absent during polls");
  for (const animation of motion.inactiveAnimations)
    assert.equal(animation.absent, true, context + "/" + animation.id + ": unavailable motion must stay stopped");
  assert.ok(motion.frames >= Math.floor(motion.duration / BUDGET_MS),
    context + ": enough real frames throughout polling");
  assert.ok(motion.maxFrameGap < BUDGET_MS,
    context + ": history frame responsiveness budget exceeded: " + Math.round(motion.maxFrameGap) + " ms");
  assert.ok(inputProbes >= 3 && motion.inputs === inputProbes * 2,
    context + ": native keyboard events must reach the document throughout polling");
  assert.ok(inputMax < BUDGET_MS,
    context + ": history input responsiveness budget exceeded: " + Math.round(inputMax) + " ms");
  if (status) {
    assert.ok(motion.statusPolls >= 1, context + ": real status refresh must land during observation");
    assert.equal(await page.evaluate("S.status.sys.free_heap"), fixture.status.sys.free_heap,
      context + ": changed board telemetry must reach the UI");
  }
  assert.deepEqual(page.diagnostics, [], context + ": live history path must emit no browser errors");
  console.log("history motion checked: " + context + "; 3 live polls; max frame " +
    Math.round(motion.maxFrameGap) + " ms; max input " + Math.round(inputMax) + " ms");
}

async function closeInspector(page) {
  await page.frame();
  await page.waitFor("document.getElementById('inspect').getAnimations({subtree:true}).every(animation => !Number.isFinite(animation.effect?.getTiming().iterations) || animation.playState !== 'running')");
  await click(page, "#inspClose");
  await page.waitFor("S.insp === null");
}

async function assertSgTransition(page, server, fixture, context) {
  await evaluate(page, () => {
    const plot = document.querySelector("#inspHist .vhist-plot");
    plot.focus({ preventScroll: true });
    window.__motionSg = { plot, gen: historyView("smart_grid_mode").gen };
    return true;
  });
  const previousValues = fixture.values, requests = server.historyRequests.length;
  fixture.values = tick => {
    const frame = previousValues(tick);
    frame.modbus = frame.modbus.map(row => row.off === 56 ? { ...row, value: 3 } : row);
    return frame;
  };
  // Only change the fixture's API frame. The next natural production poll owns the live-cap and
  // revision change; no direct render, history-cache edit or shorter timer can manufacture it.
  await page.waitFor("!_pollBusy && S._modbus.some(row => row.off === 56 && row.value === 3)");
  const changed = await evaluate(page, () => {
    const plot = document.querySelector("#inspHist .vhist-plot");
    const source = historyView("smart_grid_mode").series.find(series => series.source === "modbus");
    return { replaced: plot !== window.__motionSg.plot,
      revision: historyView("smart_grid_mode").gen !== window.__motionSg.gen,
      cap: source.v.at(-1), focused: document.activeElement === plot };
  });
  assert.equal(changed.cap, 30, context + ": actual Modbus live-cap must change from 2 to 3");
  assert.equal(changed.revision && changed.replaced, true,
    context + ": changed categorical live-cap must replace its revision and plot");
  assert.equal(changed.focused, true, context + ": categorical repaint must restore keyboard focus on the new plot");
  assert.equal(server.historyRequests.length, requests,
    context + ": live-cap update must not refetch unchanged historical rings");
  return previousValues;
}

async function assertNewGeneration(page, server, fixture, context, hosts) {
  // Two genuine replies with identical flat samples must still replace the first chart when the
  // client generation changes. Otherwise equal SVG bytes can preserve stale sample/pin identity.
  fixture.histories["x10a:free_heap"].v = Array(288).fill(1800);
  await evaluate(page, async () => {
    S.hist.get("free_heap").at = 0;
    await ensureHist("free_heap");
    return true;
  });
  await evaluate(page, ({ hosts }) => {
    const plot = document.querySelector(hosts[0]), neighbor = document.querySelector(hosts[1]);
    neighbor.focus({ preventScroll: true });
    window.__motionFlat = { plot, neighbor, html: window.__motionMarkup(plot),
      gen: S.hist.get("free_heap").gen };
    return true;
  }, { hosts });
  const before = server.historyRequests.length;
  await evaluate(page, async () => {
    S.hist.get("free_heap").at = 0;
    await ensureHist("free_heap");
    return true;
  });
  const changed = await evaluate(page, ({ hosts }) => {
    const previous = window.__motionFlat, plot = document.querySelector(hosts[0]);
    return { sameMarkup: previous.html === window.__motionMarkup(plot),
      replaced: previous.plot !== plot, neighbor: previous.neighbor === document.querySelector(hosts[1]),
      focused: document.activeElement === previous.neighbor,
      generation: S.hist.get("free_heap").gen === previous.gen + 1 };
  }, { hosts });
  assert.equal(server.historyRequests.length, before + 1, context + ": one real new-generation history reply");
  assert.equal(changed.sameMarkup, true,
    context + ": flat-curve generation control must keep rendered bytes identical apart from revision metadata");
  assert.equal(changed.generation, true, context + ": accepted history reply must advance its generation");
  assert.equal(changed.replaced, true,
    context + ": new generation must replace identical flat-curve markup");
  assert.equal(changed.neighbor && changed.focused, true,
    context + ": changing one history must preserve its unchanged focused neighbor");
}

async function disclosure(page, server, fixture, context, selectors, ids, settings = false, animation = {}) {
  await page.evaluate(settings ? "showStage('settings'); true" : "showStage('dashboard'); true");
  if (!settings) {
    const card = await evaluate(page, ({ selector }) =>
      document.querySelector(selector)?.closest("[data-dashboard-card]")?.dataset.dashboardCard,
    { selector: selectors[0] });
    assert.ok(card, context + ": disclosure card must exist");
    await click(page, '#cardNav [data-card="' + card + '"]');
  }
  for (const selector of selectors) await click(page, selector);
  await page.waitFor("!S.histBusy.size");
  await page.waitFor(JSON.stringify(selectors) +
    ".every(selector => !!document.querySelector(selector)?.closest('.vitem')?.querySelector('[data-hist]'))");
  // A cached curve may be visible while an expired ring's real GET finishes under clickHold.
  // Observe the fresh revision once the next normal paint applies it, rather than treating that
  // legitimate new generation as an unchanged-chart regression.
  await page.waitFor(JSON.stringify(selectors) + ".every(selector => {" +
    "const plot=document.querySelector(selector)?.closest('.vitem')?.querySelector('[data-hist]');" +
    "if(!plot)return false;const view=historyView(plot.dataset.hist,plot.dataset.source||'');" +
    "return plot.dataset.rev===[S.histEpoch,view?.gen,view?.t0].join('/');})");
  const hosts = await evaluate(page, ({ selectors, ids }) => selectors.map((selector, index) => {
    const item = document.querySelector(selector)?.closest(".vitem");
    const plot = item?.querySelector("[data-hist]");
    if (!plot || plot.dataset.hist !== ids[index])
      throw new Error("disclosure history missing: " + selector);
    const view = historyView(plot.dataset.hist, plot.dataset.source || "");
    if (view.v.length < 288) throw new Error("disclosure lacks full history: " + selector);
    const container = item.closest("#settingsCards") ? "#settingsCards" : "#valueGroups";
    return container + " .vitem:has([data-desc=" +
      CSS.escape(document.querySelector(selector).dataset.desc) + "]) .vhist-plot";
  }), { selectors, ids });
  await observe(page, server, context, hosts, { status: settings, fixture, ...animation });
  if (ids.includes("free_heap")) await assertNewGeneration(page, server, fixture, context, hosts);
  const before = server.historyRequests.length;
  for (const selector of selectors) await click(page, selector);
  for (const selector of selectors) await click(page, selector);
  await page.waitFor("!S.histBusy.size");
  assert.equal(server.historyRequests.length, before, context + ": cached reopen must not refetch history");
  for (const selector of selectors) await click(page, selector);
  await page.waitFor("!document.querySelector('#valueGroups .vitem:not(.open) .vhist, #settingsCards .vitem:not(.open) .vhist')",
    { timeoutMs: 4000 });
}

export async function assertHistoryMotion(page, server, context) {
  const started = performance.now();
  const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
  const index = process.argv.indexOf("--history-motion-case");
  const only = index >= 0 ? process.argv[index + 1] : "";
  const originalStatus = await page.evaluate("JSON.parse(JSON.stringify(S.status))");
  const lang = await page.evaluate("LANG");
  const fixture = makeHistoryMotionFixture(originalStatus, lang);
  // Separate owned Chrome workers may lose OS focus on macOS. Native focus emulation keeps each
  // foreground-user fixture visible; it does not mock document.hidden, polling or animation time.
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.evaluate("window.__motionOriginal = { ...S }; true");
  await installHooks(page, mutation);
  try {
    const inventory = await page.evaluate("Object.keys(INSPECT).sort()");
    assert.deepEqual(inventory, [...Object.keys(INSPECTOR_TRENDS), ...NO_HISTORY_INSPECTORS].sort(),
      context + ": history inspector inventory must classify every production entry");
    assert.deepEqual(await evaluate(page, ({ keys }) =>
      keys.filter(key => INSPECT[key].env3 || Object.prototype.hasOwnProperty.call(INSPECT[key], "trend")),
    { keys: NO_HISTORY_INSPECTORS }), [],
    context + ": no-history classification must reject newly declared trend metadata");
    if (only && ![...Object.keys(INSPECTOR_TRENDS), "board", "circulation", "x10a-row",
      "modbus-numeric", "modbus-state", "env3-no-forecast", "room-mqtt-only", "room-stale"].includes(only))
      throw new Error("unknown history motion case: " + only);
    await mountFixture(page, server, fixture);
    if (!only && !mutation) for (const key of NO_HISTORY_INSPECTORS) {
      await click(page, '#schem [data-insp="' + key + '"]', key);
      await page.waitFor("S.insp === " + JSON.stringify(key));
      assert.equal(await page.evaluate("document.getElementById('inspHist').hidden"), true,
        context + "/" + key + ": intentionally untrended inspector must not invent a chart");
      await closeInspector(page);
    }
    const cases = mutation ? mutation === "history-disclosure-replace" ? [] : ["tank"]
      : only ? Object.keys(INSPECTOR_TRENDS).filter(key => key === only)
      : ["tank", ...Object.keys(INSPECTOR_TRENDS).filter(key => key !== "tank")];
    for (const key of cases) {
      const id = INSPECTOR_TRENDS[key], label = context + "/" + key;
      const chart = await openInspector(page, key, id, label);
      const expected = key === "env3" ? ["env3_temperature", "env3_humidity", "env3_pressure"]
        : [ "x10a", ...(key !== "bsh" && MODBUS_HISTORY_ROWS.some(row => row.id === id) ? ["modbus"] : []),
          ...(key === "room" ? ["room"] : []) ];
      assert.deepEqual(chart.sources, expected, label + ": preserve independent history sources");
      if (key === "env3") assert.equal(chart.forecast, true, label + ": forecast must accompany real ENV III history");
      await observe(page, server, label, ["#inspHist .vhist-plot"], { inspector: true });
      let restoreValues;
      if (key === "sgrequest") {
        restoreValues = await assertSgTransition(page, server, fixture, label);
        await observe(page, server, label + "/changed-cap-stable",
          ["#inspHist .vhist-plot"], { inspector: true });
      }
      const requests = server.historyRequests.length;
      await closeInspector(page);
      await openInspector(page, key, id, label + "/cached");
      assert.equal(server.historyRequests.length, requests, label + ": cached reopen must not refetch history");
      await closeInspector(page);
      if (restoreValues) fixture.values = restoreValues;
    }
    if (mutation && mutation !== "history-disclosure-replace") return;

    if ((!only || only === "x10a-row") && mutation !== "history-disclosure-replace")
      await disclosure(page, server, fixture, context + "/x10a-row",
        ['#valueGroups [data-trend="dhw_tank"]'], ["dhw_tank"]);
    if (!only || only === "board" || mutation === "history-disclosure-replace")
      await disclosure(page, server, fixture, context + "/board",
        ['#settingsCards [data-desc="board:free_heap"]', '#settingsCards [data-desc="board:max_alloc"]'],
        ["free_heap", "max_alloc"], true);
    if (mutation === "history-disclosure-replace") return;
    if (!only || only === "circulation")
      await disclosure(page, server, fixture, context + "/circulation",
        ['#settingsCards [data-desc="diagnostics:circulation"]'], ["circulation_state"], true);
    if (!only || only === "modbus-state")
      await disclosure(page, server, fixture, context + "/modbus-state",
        ['#valueGroups [data-dashboard-card="modbus"] [data-trend="disinfection_state"]'], ["disinfection_state"]);

    for (const variant of ["modbus-numeric", "env3-no-forecast", "room-mqtt-only", "room-stale"]) {
      if (only && only !== variant) continue;
      const frame = makeHistoryMotionFixture(originalStatus, lang), originalValues = frame.values;
      if (variant === "modbus-numeric") {
        frame.status.history.rows = frame.status.history.rows.filter(row => row.id !== "flow");
        frame.values = tick => {
          const values = originalValues(tick);
          values.values = values.values.filter(row => row.concept !== "flow");
          return values;
        };
      } else if (variant === "env3-no-forecast") {
        frame.status.weather_forecast = { configured: false, available: false, fresh: false, hourly: [] };
      } else {
        frame.status.history.rows = frame.status.history.rows.filter(row => row.id !== "room_temp");
        frame.status.history.modbus_rows = frame.status.history.modbus_rows.filter(row => row.id !== "room_temp");
        frame.values = tick => {
          const values = originalValues(tick);
          values.values = values.values.filter(row => row.concept !== "room_temp");
          values.modbus = values.modbus.filter(row => row.concept !== "room_temp");
          return values;
        };
        if (variant === "room-stale") Object.assign(frame.status.reference_temperature,
          { fresh: false, temperature_valid: false, reason: "stale", freshness_reason: "stale", age_s: 600 });
      }
      await mountFixture(page, server, frame);
      const label = context + "/" + variant;
      if (variant === "modbus-numeric") {
        await disclosure(page, server, frame, label,
          ['#valueGroups [data-dashboard-card="modbus"] [data-trend="flow"]'], ["flow"], false,
          { animationIds: ["rfHot", "scFan"], inactiveAnimationIds: ["fSup1", "scPump"] });
      } else {
        const key = variant === "env3-no-forecast" ? "env3" : "room";
        const chart = await openInspector(page, key, INSPECTOR_TRENDS[key], label);
        if (key === "env3") assert.equal(chart.forecast, false, label + ": no forecast may be invented");
        else assert.deepEqual(chart.sources, ["room"], label + ": MQTT-only history stays independent");
        if (variant === "room-stale")
          assert.match(await page.evaluate("document.getElementById('inspNow').textContent"), /—/,
            label + ": stale current value is absent while retained history remains");
        await observe(page, server, label, ["#inspHist .vhist-plot"], { inspector: true });
        await closeInspector(page);
      }
    }
    console.log("history motion matrix passed: " + context + "; " +
      (only ? "focused " + only : "28 history inspectors; 12 no-history routes; 5 disclosure paths; 3 conditional source variants") +
      "; " + Math.round((performance.now() - started) / 1000) + " s");
  } finally {
    await page.evaluate("window.__motionObserve = false; pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy && !S.histBusy.size");
    server.setTelemetry();
    await evaluate(page, () => {
      if (window.__motionFrames) cancelAnimationFrame(window.__motionFrames.request);
      document.removeEventListener("keydown", window.__motionKey, true);
      document.removeEventListener("keyup", window.__motionKey, true);
      const original = window.__motionHooks;
      renderApp = original.renderApp; histHtml = original.histHtml; env3HistHtml = original.env3HistHtml;
      descAccordion = original.descAccordion; circulationSettingsCardHtml = original.circulationSettingsCardHtml;
      refreshValues = original.refreshValues; refreshStatus = original.refreshStatus;
      replaceHistoryHtml = original.replaceHistoryHtml;
      delete INSPECT.__motionUnclassified;
      Object.assign(S, window.__motionOriginal);
      S.inspSig = null; S.inspHistSig = null; renderApp();
      for (const name of Object.keys(window)) if (name.startsWith("__motion")) delete window[name];
      return true;
    });
    try {
      await page.waitFor("document.getElementById('inspect').getAnimations({subtree:true}).every(animation => !Number.isFinite(animation.effect?.getTiming().iterations) || animation.playState !== 'running')");
    } finally { await page.send("Emulation.setFocusEmulationEnabled", { enabled: false }); }
  }
}
