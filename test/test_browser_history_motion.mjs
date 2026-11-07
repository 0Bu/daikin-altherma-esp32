import assert from "node:assert/strict";
import { INSPECTOR_TRENDS, NO_HISTORY_INSPECTORS, makeHistoryMotionFixture,
  MODBUS_HISTORY_ROWS } from "./test_browser_history_fixture.mjs";

const BUDGET_MS = 250;
export const HISTORY_MOTION_MUTATIONS = Object.freeze([
  "history-eager", "history-stall", "history-replace", "history-restart", "history-unknown",
  "history-disclosure-replace", "history-detach", "history-text-stale",
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
  await page.nativeClick(point.x, point.y);
  return point;
}

async function assertTouchReadout(page, selector, context) {
  if (page.inputMode !== "touch") return;
  const scroll = await page.evaluate("({x:scrollX,y:scrollY})");
  const id = await evaluate(page, ({ selector }) => document.querySelector(selector)?.dataset.hist,
    { selector });
  assert.ok(id, context + ": touch history must exist");
  await click(page, selector);
  await page.waitFor("S.histPin.has(" + JSON.stringify(id) + ") && !S.scrub");
  const selected = await evaluate(page, ({ selector }) => {
    const graph = document.querySelector(selector)?.closest(".vhist");
    const visible = node => {
      if (!node || node.closest("[hidden]") || !node.textContent.trim()) return false;
      const rect = node.getBoundingClientRect();
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) ||
            Number(style.opacity) === 0) return false;
      }
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth;
    };
    return { tip: visible(graph?.querySelector(".vhist-tip.vhist-pinned")),
      time: visible(graph?.querySelector(".vhist-time.vhist-pinned")) };
  }, { selector });
  assert.ok(selected.tip && selected.time, context + ": trusted touch must pin a visible value and time readout");
  await click(page, selector);
  await page.waitFor("!S.histPin.has(" + JSON.stringify(id) + ") && !S.scrub && !S.clickHold");
  await evaluate(page, ({ scroll }) => { window.scrollTo(scroll.x, scroll.y); return true; }, { scroll });
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  const restored = await page.evaluate("({x:scrollX,y:scrollY})");
  assert.deepEqual(restored, scroll, context + ": touch readout must restore the pre-touch observation viewport");
}

async function installHooks(page, mutation) {
  await evaluate(page, ({ mutation }) => {
    window.__motionHooks = { renderApp, histHtml, env3HistHtml, descAccordion,
      circulationSettingsCardHtml, refreshValues, refreshStatus, replaceHistoryHtml };
    const original = window.__motionHooks;
    window.__motionAllPolls = 0;
    let eager, detach, staleText;
    if (mutation === "history-eager") {
      const code = original.descAccordion.toString();
      if (!code.includes("open && trendId")) throw new Error("history mutation target missing");
      eager = window.eval("(" + code.replace("open && trendId", "trendId") + ")");
    }
    if (mutation === "history-detach") {
      const code = original.replaceHistoryHtml.toString();
      if (!code.includes("if (textOnly) {")) throw new Error("history detach mutation target missing");
      detach = window.eval("(" + code.replace("if (textOnly) {", "if (false && textOnly) {") + ")");
    }
    if (mutation === "history-text-stale") {
      const code = original.replaceHistoryHtml.toString();
      if (!code.includes("node.nodeValue = value;")) throw new Error("history text mutation target missing");
      staleText = window.eval("(" + code.replace("node.nodeValue = value;", "void value;") + ")");
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
      const started = performance.now();
      const ok = await original.refreshValues(...args);
      if (ok) window.__motionAllPolls++;
      if (ok && window.__motionObserve) {
        window.__motionPolls++;
        window.__motionRefreshes.push({ type: "values", started, duration: performance.now() - started });
      }
      return ok;
    };
    refreshStatus = async (...args) => {
      const started = performance.now();
      const ok = await original.refreshStatus(...args);
      if (ok && window.__motionObserve) {
        window.__motionStatusPolls++;
        window.__motionRefreshes.push({ type: "status", started, duration: performance.now() - started });
      }
      return ok;
    };
    renderApp = (...args) => {
      const started = performance.now();
      if (window.__motionObserve && (S.scrub || S.clickHold)) window.__motionHolds++;
      const result = original.renderApp(...args);
      if (!window.__motionObserve) return result;
      window.__motionRenders.push({ started, duration: performance.now() - started });
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
      else return (window.__motionObserve ? detach || staleText || original.replaceHistoryHtml
        : original.replaceHistoryHtml)(host, html);
    };
    window.__motionKey = event => {
      if (window.__motionObserve && event.code === "ShiftLeft") {
        window.__motionInputs++;
        window.__motionInputTimes.push({ type: event.type, at: performance.now(), trusted: event.isTrusted });
      }
    };
    window.__motionMarkup = plot => {
      const copy = plot.closest(".vhist").cloneNode(true);
      for (const node of copy.querySelectorAll("[data-rev]")) node.removeAttribute("data-rev");
      return copy.outerHTML;
    };
    window.__motionRevision = plot => {
      const id = plot?.dataset.hist, source = plot?.dataset.source || "";
      const view = id && historyView(id, source);
      return { id, source, dom: plot?.dataset.rev,
        model: [S.histEpoch, view?.gen, view?.t0].join("/") };
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

async function expireOpeningHistory(page, id, inspector = "") {
  // Only prepare this opening's dependencies. Earlier cards can have populated them nearly a
  // minute ago; let the native open fetch fresh rings before measuring an unchanged generation.
  await evaluate(page, ({ id, inspector }) => {
    if (window.__motionObserve) throw new Error("history cache setup must finish before observation");
    const entry = inspector && INSPECT[inspector], keys = new Set();
    const add = (id, source) => {
      const offered = source === "x10a" ? hasHist(id) : source === "modbus" ? hasModbusHist(id)
        : source === "env3" ? hasEnv3Hist(id) : hasRoomHist(id);
      if (!offered) return;
      const key = histCacheKey(id, source);
      if (keys.has(key)) return;
      keys.add(key);
      if (source === "x10a" && DERIVED[id])
        for (const input of DERIVED[id].ins) add(input, "x10a");
    };
    if (entry?.env3 || id === ENV3_COMBINED_ID)
      for (const series of ENV3_COMBINED_SERIES) add(series.id, "env3");
    else {
      const source = (typeof entry?.trendSource === "function"
        ? entry.trendSource(S.live) : entry?.trendSource) || "";
      for (const instrument of source ? [source] : ["x10a", "modbus", "env3", "room"])
        add(id, instrument);
      // Tank overlays are fetched by ensureHistPair/renderInspectHist independently of the curve.
      if (id === "dhw_tank") for (const auxiliary of ["smart_grid_mode", "bsh_state"])
        for (const instrument of ["x10a", "modbus"]) add(auxiliary, instrument);
    }
    const expiredAt = Date.now() - 60001;
    for (const key of keys) {
      const cached = S.hist.get(key);
      if (cached) cached.at = expiredAt;
    }
    return true;
  }, { id, inspector });
}

async function settleHistoryRevision(page, selectors) {
  // A cached curve can remain visible while the opening's real GET completes under clickHold.
  // Wait for the actual DOM revision after input/focus setup, never suppress a measured refetch.
  await page.waitFor("(" + (selectors => !S.histBusy.size && !S.clickHold && !_pollBusy &&
    selectors.every(selector => {
      const target = document.querySelector(selector);
      const plot = target?.matches("[data-hist]") ? target
        : target?.closest(".vitem")?.querySelector("[data-hist]");
      if (!plot) return false;
      const view = historyView(plot.dataset.hist, plot.dataset.source || "");
      return !!view && plot.dataset.rev === [S.histEpoch, view.gen, view.t0].join("/");
    })).toString() + ")(" + JSON.stringify(selectors) + ")");
}

async function openInspector(page, key, id, context, { freshOpening = true } = {}) {
  await page.evaluate("showStage('dashboard'); true");
  if (freshOpening) await expireOpeningHistory(page, id, key);
  await click(page, '#schem [data-insp="' + key + '"]', key);
  await page.waitFor("S.insp === " + JSON.stringify(key) + " && !S.histBusy.size");
  await settleHistoryRevision(page, ["#inspHist .vhist-plot"]);
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

async function boardHeapReading(page) {
  return evaluate(page, () => {
    const node = document.querySelector('#settingsCards [data-desc="board:free_heap"] .vrow-val');
    return { text: node?.innerText.trim(), expected: fmtKiB(S.status.sys.free_heap),
      visible: !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden" };
  });
}

async function settleHistoryOpening(page, selectors) {
  await page.waitFor("(" + ((selectors) => selectors.every(selector => {
    const plot = document.querySelector(selector);
    if (!plot) return false;
    const host = plot.closest(".inspect, .vdesc") || plot;
    return host.getAnimations({ subtree: true }).every(animation =>
      !Number.isFinite(animation.effect?.getTiming().iterations) ||
      (animation.playState !== "running" && !animation.pending));
  })).toString() + ")(" + JSON.stringify(selectors) + ")");
}

async function toggleDisclosure(page, selector, id, open, context) {
  await evaluate(page, () => {
    window.__motionDisclosureHit = null;
    window.__motionDisclosureClick = event => {
      const target = event.target.closest?.("[data-desc]");
      window.__motionDisclosureHit = { trusted: event.isTrusted, desc: target?.dataset.desc,
        node: event.target.nodeName, x: event.clientX, y: event.clientY };
    };
    document.addEventListener("click", window.__motionDisclosureClick, true);
    return true;
  });
  let point;
  try {
    // Each native toggle finishes before measuring the next row's point. A cold history reply or
    // a finite grid expansion can otherwise move that row between measurement and dispatch.
    point = await click(page, selector);
    await page.waitFor("(" + (({ disclosureToggle: { selector, id, open } }) => {
      const button = document.querySelector(selector), item = button?.closest(".vitem");
      if (!item || S.descOpen.has(button.dataset.desc) !== open ||
          button.getAttribute("aria-expanded") !== String(open) ||
          item.classList.contains("open") !== open || S.histBusy.size || S.clickHold || _pollBusy)
        return false;
      const plots = [...item.querySelectorAll("[data-hist]")];
      if (open) {
        if (plots.length !== 1 || plots[0].dataset.hist !== id) return false;
        const plot = plots[0], view = historyView(id, plot.dataset.source || "");
        if (!view || plot.dataset.rev !== [S.histEpoch, view.gen, view.t0].join("/")) return false;
      } else if (plots.length) return false;
      return item.getAnimations({ subtree: true }).every(animation =>
        !Number.isFinite(animation.effect?.getTiming().iterations) ||
        (animation.playState !== "running" && !animation.pending));
    }).toString() + ")(" + JSON.stringify({ disclosureToggle: { selector, id, open } }) + ")");
  } catch (error) {
    const state = await evaluate(page, ({ selector, point }) => {
      const button = document.querySelector(selector), item = button?.closest(".vitem");
      const rect = button?.getBoundingClientRect();
      const hit = point && document.elementFromPoint(point.x, point.y);
      return { desc: button?.dataset.desc, rememberedOpen: S.descOpen.has(button?.dataset.desc),
        expanded: button?.getAttribute("aria-expanded"), open: item?.classList.contains("open"),
        plots: [...(item?.querySelectorAll("[data-hist]") || [])].map(window.__motionRevision),
        busy: [...S.histBusy], clickHold: S.clickHold, pollBusy: _pollBusy,
        animations: (item?.getAnimations({ subtree: true }) || []).filter(animation =>
          Number.isFinite(animation.effect?.getTiming().iterations)).map(animation =>
          ({ state: animation.playState, pending: animation.pending })),
        rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        point, actualClick: window.__motionDisclosureHit,
        currentHit: hit && { node: hit.nodeName, desc: hit.closest("[data-desc]")?.dataset.desc } };
    }, { selector, point });
    throw new Error(context + ": native disclosure toggle did not settle; selector=" + selector +
      "; expectedOpen=" + open + "; expectedHistory=" + id + "; " + error.message +
      "; state=" + JSON.stringify(state), { cause: error });
  } finally {
    await page.evaluate("document.removeEventListener('click', window.__motionDisclosureClick, true);" +
      "delete window.__motionDisclosureClick; delete window.__motionDisclosureHit; true");
  }
}

async function prepareObservationViewport(page, selector, animationIds) {
  await settleHistoryOpening(page, [selector]);
  const unionFits = await evaluate(page, ({ selector, animationIds }) => {
    const plot = document.querySelector(selector), rect = plot.getBoundingClientRect();
    const header = document.getElementById(S.stage === "dashboard" ? "hdrDash" : "hdrBack");
    const inset = Math.max(0, header.getBoundingClientRect().bottom);
    if (!(rect.width > 0 && rect.height > 0 && rect.height + 8 <= innerHeight - inset))
      throw new Error("history observation requires a viewport-sized visible plot: " + selector);
    const top = rect.top + scrollY, bottom = rect.bottom + scrollY;
    let lower = Math.max(0, bottom + 4 - innerHeight), upper = top - inset - 4;
    // Keep the graph and moving schematic in view together whenever they fit. Restoring the
    // pre-touch scroll can leave the focused graph offscreen, which is not a visible-history test.
    const witnesses = S.stage === "dashboard" ? animationIds.map(id =>
      document.getElementById(id).getBoundingClientRect()) : [];
    const unionTop = Math.min(top, ...witnesses.map(box => box.top + scrollY));
    const unionBottom = Math.max(bottom, ...witnesses.map(box => box.bottom + scrollY));
    const unionLower = Math.max(0, unionBottom + 4 - innerHeight), unionUpper = unionTop - inset - 4;
    if (unionLower <= unionUpper) { lower = unionLower; upper = unionUpper; }
    window.scrollTo({ left: scrollX, top: Math.max(lower, Math.min(scrollY, upper)), behavior: "instant" });
    return unionLower <= unionUpper;
  }, { selector, animationIds });
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  const viewport = await evaluate(page, ({ selector, animationIds }) => {
    const plot = document.querySelector(selector), box = plot.getBoundingClientRect();
    const header = document.getElementById(S.stage === "dashboard" ? "hdrDash" : "hdrBack");
    const inset = Math.max(0, header.getBoundingClientRect().bottom);
    let visible = true;
    for (let node = plot; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) ||
          Number(style.opacity) === 0) visible = false;
    }
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { headerInset: inset, plotVisible: visible && box.top >= inset && box.bottom <= innerHeight &&
      box.left >= 0 && box.right <= innerWidth && (hit === plot || plot.contains(hit)),
    witnesses: (S.stage === "dashboard" ? animationIds : []).map(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { id, verticallyInside: rect.top >= inset && rect.bottom <= innerHeight,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }) };
  }, { selector, animationIds });
  assert.equal(viewport.plotVisible, true, "history plot must be visible inside the observation viewport: " + selector);
  if (unionFits) assert.ok(viewport.witnesses.every(row => row.verticallyInside),
    "schematic witnesses must share the planned vertical observation viewport");
  return { ...viewport, unionFits };
}

async function observe(page, server, context, selectors, { inspector = false, status = false,
  fixture = null, animationIds = ["fSup1", "rfHot", "scFan", "scPump"],
  inactiveAnimationIds = [] } = {}) {
  await page.bringToFront();
  await page.waitFor("document.visibilityState === 'visible' && !document.hidden");
  // Opening/disclosure transitions may legitimately finish. Persistent flow CSSAnimation objects
  // are the continuity witness; finite CSSTransition completion is not a stopped pipe animation.
  await page.waitFor("!S.clickHold && !S.histBusy.size && !_pollBusy");
  await settleHistoryOpening(page, selectors);
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  await assertTouchReadout(page, selectors[0], context);
  const observationViewport = await prepareObservationViewport(page, selectors[0], animationIds);
  const focusStarted = performance.now();
  const focusWasAlready = await evaluate(page, ({ selector }) => {
    const node = document.querySelector(selector), already = document.activeElement === node;
    node.focus({ preventScroll: true }); return already;
  }, { selector: selectors[0] });
  // Programmatic focus belongs to setup. Wait for its real paint before the first measured poll;
  // every subsequent frame, including that poll's first frame, remains under the fixed budget.
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  await settleHistoryRevision(page, selectors);
  const focusSetupMs = performance.now() - focusStarted;
  const requests = server.valuesRequests;
  let boardBefore;
  if (status) {
    boardBefore = await boardHeapReading(page);
    assert.equal(boardBefore.visible, true, context + ": initial board reading must be rendered");
    assert.equal(boardBefore.text, boardBefore.expected, context + ": initial board reading must match actual status");
    fixture.status.sys.free_heap -= 1024;
  }
  await evaluate(page, ({ selectors, animationIds, inactiveAnimationIds }) => {
    window.__motionPlots = selectors.map(selector => {
      const node = document.querySelector(selector);
      if (!node) throw new Error("history observation plot missing: " + selector);
      return { selector, node, revision: window.__motionRevision(node) };
    });
    if (document.activeElement !== window.__motionPlots[0].node || document.hidden)
      throw new Error("history focus and visibility must settle before polling observation");
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
    window.__motionRenders = []; window.__motionRefreshes = []; window.__motionInputTimes = [];
    const geometry = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    };
    window.__motionViewport = { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight,
      visible: document.visibilityState, focused: document.hasFocus(),
      flow: geometry("#fSup1"), plot: geometry(selectors[0]) };
    const grid = document.getElementById("valueGroups");
    window.__motionScalarGrid = S.stage === "dashboard" && grid.firstElementChild &&
      !grid.querySelector(".vhist") ? { root: grid, children: [...grid.childNodes], removed: 0,
        cards: [...grid.querySelectorAll(".vgroup[data-dashboard-card]")].map(node => ({ node, hidden: node.hidden })) } : null;
    const ancestors = new Map(), detached = [];
    for (const { selector, node: plot } of window.__motionPlots)
      for (let node = plot; node; node = node.parentNode) {
        if (!node.isConnected) throw new Error("history observation ancestor is initially detached: " + selector);
        if (!ancestors.has(node)) ancestors.set(node, new Set());
        ancestors.get(node).add(selector);
      }
    // Mutation records preserve removal identity even after the same subtree is reattached before
    // delivery. Checking isConnected or final plot identity alone misses that rendering disruption.
    const recordDetachments = records => {
      for (const record of records) for (const node of record.removedNodes) {
        const scalar = window.__motionScalarGrid;
        if (scalar && record.target === scalar.root && scalar.children.includes(node)) scalar.removed++;
        if (ancestors.has(node)) detached.push({ selectors: [...ancestors.get(node)],
          node: node.nodeName + (node.id ? "#" + node.id : ""),
          connectedAtDelivery: node.isConnected, at: performance.now() });
      }
    };
    window.__motionDetachedAncestors = detached;
    window.__motionRecordDetachments = recordDetachments;
    window.__motionDetachObserver = new MutationObserver(recordDetachments);
    window.__motionDetachObserver.observe(document, { childList: true, subtree: true });
    window.__motionFrames = { started: performance.now(), last: performance.now(), count: 0, maxGap: 0, gaps: [] };
    const sample = now => {
      const state = window.__motionFrames;
      const gap = now - state.last;
      state.maxGap = Math.max(state.maxGap, gap); state.gaps.push({ at: now, gap });
      state.last = now; state.count++;
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
      await page.nativeKey(type, "Shift", "ShiftLeft", 16);
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
    window.__motionRecordDetachments(window.__motionDetachObserver.takeRecords());
    window.__motionDetachObserver.disconnect();
    const body = document.getElementById("inspBody");
    const snapshot = {
      polls: window.__motionPolls, statusPolls: window.__motionStatusPolls,
      holds: window.__motionHolds,
      builds: window.__motionBuilds, closedBuilds: window.__motionClosedBuilds,
      hiddenCharts: document.querySelectorAll("#valueGroups .vitem:not(.open) .vhist, #settingsCards .vitem:not(.open) .vhist").length,
      plots: window.__motionPlots.map(({ selector, node }) =>
        ({ selector, same: document.querySelector(selector) === node })),
      revisions: window.__motionPlots.map(({ selector, revision }) => ({ selector,
        before: revision, after: window.__motionRevision(document.querySelector(selector)) })),
      detachedAncestors: window.__motionDetachedAncestors,
      scalarGrid: window.__motionScalarGrid ? {
        retained: window.__motionScalarGrid.children.every(node => node.isConnected &&
          node.parentNode === window.__motionScalarGrid.root),
        removed: window.__motionScalarGrid.removed,
        visibilityStable: window.__motionScalarGrid.cards.every(({ node, hidden }) => node.hidden === hidden),
      } : null,
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
      frameStarted: window.__motionFrames.started, frameGaps: window.__motionFrames.gaps,
      renders: window.__motionRenders, refreshes: window.__motionRefreshes,
      inputTimes: window.__motionInputTimes, viewportBefore: window.__motionViewport,
      viewportAfter: { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight,
        visible: document.visibilityState, focused: document.hasFocus() },
    };
    // Keep only the plain-data snapshot between cases. Test witnesses must not retain a closed
    // graph or its observer closure until the following case's measured polling window.
    for (const name of ["__motionPlots", "__motionBody", "__motionFocused", "__motionAnimations",
      "__motionInactive", "__motionDetachObserver", "__motionRecordDetachments", "__motionScalarGrid"])
      delete window[name];
    return snapshot;
  });
  page.historyMotionEvidence?.push({ context, ...motion, maxNativeInputMs: inputMax, focusSetupMs,
    focusWasAlready, observationViewport });
  assert.ok(server.valuesRequests >= requests + 3 && motion.polls >= 3,
    context + ": at least three real values polls");
  assert.ok(motion.duration >= 4000, context + ": three real updates must span two full polling intervals");
  assert.equal(motion.holds, 0, context + ": polling must not be hidden behind interaction holds");
  assert.equal(motion.closedBuilds, 0, context + ": polls must not rebuild cached charts in closed rows");
  assert.equal(motion.hiddenCharts, 0, context + ": closed rows must not retain duplicate history SVGs");
  if (inspector) assert.equal(motion.builds, 0, context +
    ": unchanged inspector must not rebuild history; revisions=" + JSON.stringify(motion.revisions));
  const retainedPlots = new Set(motion.plots.filter(plot => plot.same).map(plot => plot.selector));
  const detachedRetained = motion.detachedAncestors.filter(row =>
    row.selectors.some(selector => retainedPlots.has(selector)));
  assert.deepEqual(detachedRetained, [], context + ": unchanged history ancestors must remain connected");
  for (const plot of motion.plots)
    assert.equal(plot.same, true, context + ": unchanged plot must remain mounted: " + plot.selector);
  assert.equal(motion.sameFocus, true, context + ": focused history control must survive polling");
  if (motion.scalarGrid) {
    assert.equal(motion.scalarGrid.retained && motion.scalarGrid.visibilityStable, true,
      context + ": scalar polls must retain closed value rows and card visibility");
    assert.equal(motion.scalarGrid.removed, 0, context + ": scalar value-grid children must remain connected");
  }
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
    context + ": history frame responsiveness budget exceeded: " + Math.round(motion.maxFrameGap) +
      " ms; native input " + Math.round(inputMax) + " ms; frames " + motion.frames +
      "; duration " + Math.round(motion.duration) + " ms; polls " + motion.polls);
  assert.ok(inputProbes >= 3 && motion.inputs === inputProbes * 2,
    context + ": native keyboard events must reach the document throughout polling");
  assert.ok(inputMax < BUDGET_MS,
    context + ": history input responsiveness budget exceeded: " + Math.round(inputMax) + " ms");
  if (status) {
    assert.ok(motion.statusPolls >= 1, context + ": real status refresh must land during observation");
    assert.equal(await page.evaluate("S.status.sys.free_heap"), fixture.status.sys.free_heap,
      context + ": changed board telemetry must reach browser state");
    const boardAfter = await boardHeapReading(page);
    assert.equal(boardAfter.visible, true,
      context + ": changed board telemetry must update the visible reading");
    assert.notEqual(boardAfter.text, boardBefore.text,
      context + ": changed board telemetry must update the visible reading");
    assert.equal(boardAfter.text, boardAfter.expected,
      context + ": changed board telemetry must update the visible reading");
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

async function prepareInheritedFlow(page) {
  await page.waitFor("!S.histBusy.size && !_pollBusy");
  return evaluate(page, async () => {
    // Derived pth/cop cards normally preload this ring; a focused flow run must exercise the same
    // inherited-cache path. Populate it through the real GET if those cards have not run.
    if (!S.hist.get("flow")) await ensureHist("flow");
    const cached = S.hist.get("flow");
    if (!cached?.gen || cached.v.length < 288) throw new Error("flow inherited cache requires a real full ring");
    cached.at = Date.now() - 55000;
    return cached.gen;
  });
}

async function assertFlowTtlTransition(page, server, context) {
  const selector = "#inspHist .vhist-plot";
  await page.bringToFront();
  await page.waitFor("document.visibilityState === 'visible' && !document.hidden");
  await settleHistoryOpening(page, [selector]);
  await prepareObservationViewport(page, selector, ["fSup1", "rfHot", "scFan", "scPump"]);
  await evaluate(page, ({ selector }) => {
    document.querySelector(selector).focus({ preventScroll: true }); return true;
  }, { selector });
  await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  await settleHistoryRevision(page, [selector]);
  const requests = server.historyRequests.length;
  const before = await evaluate(page, ({ selector }) => {
    const plot = document.querySelector(selector), flow = S.hist.get("flow");
    const modbus = S.hist.get(histCacheKey("flow", "modbus"));
    if (!flow?.gen || !modbus?.gen || document.activeElement !== plot)
      throw new Error("flow TTL transition requires fresh independent rings and focused plot");
    const revision = window.__motionRevision(plot), now = performance.now();
    const grid = document.getElementById("valueGroups");
    const state = window.__motionTtl = { plot, gen: flow.gen, modbusGen: modbus.gen,
      grid, gridFirst: grid.firstElementChild,
      revision, started: now, last: now, frames: 0, maxGap: 0,
      animations: ["fSup1", "rfHot", "scFan", "scPump"].map(id => {
        const node = document.getElementById(id);
        const animation = node.getAnimations().find(item => item instanceof CSSAnimation);
        return { id, node, animation, time: animation?.currentTime,
          initialRunning: animation?.playState === "running" };
      }) };
    const sample = now => {
      state.maxGap = Math.max(state.maxGap, now - state.last);
      state.last = now; state.frames++; state.request = requestAnimationFrame(sample);
    };
    state.request = requestAnimationFrame(sample);
    // Cross the real one-minute boundary on the unchanged two-second production poll loop.
    // Keep Modbus fresh and do not call ensureHist, renderApp or pollNow for this transition.
    flow.at = Date.now() - 59000;
    return { gen: state.gen, modbusGen: state.modbusGen, revision };
  }, { selector });
  let changed;
  try {
    await page.waitFor("!S.histBusy.size && !_pollBusy && S.hist.get('flow')?.gen > window.__motionTtl.gen",
      { timeoutMs: 12000 });
    await settleHistoryRevision(page, [selector]);
    await page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
    changed = await evaluate(page, ({ selector }) => {
      const state = window.__motionTtl, plot = document.querySelector(selector);
      return { gen: S.hist.get("flow")?.gen,
        modbusGen: S.hist.get(histCacheKey("flow", "modbus"))?.gen,
        replaced: plot !== state.plot, focused: document.activeElement === plot,
        scalarGridRetained: !!state.gridFirst && state.gridFirst.isConnected &&
          state.grid.firstElementChild === state.gridFirst,
        revision: window.__motionRevision(plot), duration: performance.now() - state.started,
        frames: state.frames, maxGap: state.maxGap,
        animations: state.animations.map(({ id, node, animation, time, initialRunning }) => ({ id,
          same: node.getAnimations().includes(animation), initialRunning,
          running: animation?.playState === "running", elapsed: animation?.currentTime - time })) };
    }, { selector });
  } finally {
    await page.evaluate("if(window.__motionTtl)cancelAnimationFrame(window.__motionTtl.request); delete window.__motionTtl; true");
  }
  console.log("history TTL transition evidence: " + JSON.stringify({ context, before, ...changed }));
  assert.deepEqual(server.historyRequests.slice(requests), ["x10a:flow"],
    context + ": natural TTL transition must make exactly one real X10A flow GET");
  assert.equal(changed.gen, before.gen + 1, context + ": TTL reply must advance X10A flow by exactly one generation");
  assert.equal(changed.modbusGen, before.modbusGen, context + ": independent fresh Modbus generation must stay stable");
  assert.equal(changed.replaced && changed.focused, true,
    context + ": TTL generation must replace its plot and retain keyboard focus");
  assert.notEqual(changed.revision.model, before.revision.model, context + ": TTL model revision must advance");
  assert.equal(changed.revision.dom, changed.revision.model,
    context + ": TTL plot must carry the accepted model revision; " + JSON.stringify({ before, changed }));
  assert.equal(changed.scalarGridRetained, true,
    context + ": TTL refresh must retain the closed scalar value grid");
  for (const animation of changed.animations) {
    assert.equal(animation.initialRunning && animation.same && animation.running, true,
      context + "/" + animation.id + ": TTL refresh must preserve the running CSSAnimation instance");
    assert.ok(animation.elapsed >= changed.duration - BUDGET_MS,
      context + "/" + animation.id + ": animation must advance throughout TTL refresh");
  }
  assert.ok(changed.frames >= Math.floor(changed.duration / BUDGET_MS) && changed.maxGap < BUDGET_MS,
    context + ": TTL frame responsiveness budget exceeded: " + Math.round(changed.maxGap) + " ms");
  console.log("history TTL transition checked: " + context + "; one real flow GET; max frame " +
    Math.round(changed.maxGap) + " ms");
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
  await page.evaluate("delete window.__motionSg; true");
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
  await page.evaluate("delete window.__motionFlat; true");
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
  for (const id of ids) await expireOpeningHistory(page, id);
  for (const [index, selector] of selectors.entries())
    await toggleDisclosure(page, selector, ids[index], true, context + "/open");
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
  for (const [index, selector] of selectors.entries())
    await toggleDisclosure(page, selector, ids[index], false, context + "/close");
  for (const [index, selector] of selectors.entries())
    await toggleDisclosure(page, selector, ids[index], true, context + "/cached-reopen");
  assert.equal(server.historyRequests.length, before, context + ": cached reopen must not refetch history");
  for (const [index, selector] of selectors.entries())
    await toggleDisclosure(page, selector, ids[index], false, context + "/cleanup");
  await page.waitFor("!document.querySelector('#valueGroups .vitem:not(.open) .vhist, #settingsCards .vitem:not(.open) .vhist')",
    { timeoutMs: 4000 });
}

export async function assertHistoryMotion(page, server, context) {
  const started = performance.now();
  const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
  const disclosureMutation = ["history-disclosure-replace", "history-detach", "history-text-stale"].includes(mutation);
  const index = process.argv.indexOf("--history-motion-case");
  const only = index >= 0 ? process.argv[index + 1] : "";
  const originalStatus = await page.evaluate("JSON.parse(JSON.stringify(S.status))");
  const lang = await page.evaluate("LANG");
  const fixture = makeHistoryMotionFixture(originalStatus, lang);
  // Parallel headless workers keep a real visible foreground page; neither adapter mocks
  // document.hidden, polling or animation time.
  await page.focusEmulation(true);
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
    const cases = mutation ? disclosureMutation ? [] : ["tank"]
      : only ? Object.keys(INSPECTOR_TRENDS).filter(key => key === only)
      : ["tank", ...Object.keys(INSPECTOR_TRENDS).filter(key => key !== "tank")];
    for (const key of cases) {
      const id = INSPECTOR_TRENDS[key], label = context + "/" + key;
      const inheritedFlow = key === "flow" ? await prepareInheritedFlow(page) : null;
      const flowRequests = server.historyRequests.filter(key => key === "x10a:flow").length;
      const chart = await openInspector(page, key, id, label);
      if (key === "flow") {
        assert.equal(await page.evaluate("S.hist.get('flow')?.gen"), inheritedFlow + 1,
          label + ": first native open must refresh the inherited flow cache generation");
        assert.equal(server.historyRequests.filter(key => key === "x10a:flow").length, flowRequests + 1,
          label + ": first native open must make one real GET for its inherited flow cache");
      }
      if (key === "tank" && page.assertFlowPaint) await page.assertFlowPaint(label);
      const expected = key === "env3" ? ["env3_temperature", "env3_humidity", "env3_pressure"]
        : [ "x10a", ...(key !== "bsh" && MODBUS_HISTORY_ROWS.some(row => row.id === id) ? ["modbus"] : []),
          ...(key === "room" ? ["room"] : []) ];
      assert.deepEqual(chart.sources, expected, label + ": preserve independent history sources");
      if (key === "env3") assert.equal(chart.forecast, true, label + ": forecast must accompany real ENV III history");
      if (key === "flow") await assertFlowTtlTransition(page, server, label);
      await observe(page, server, label, ["#inspHist .vhist-plot"], { inspector: true });
      let restoreValues;
      if (key === "sgrequest") {
        restoreValues = await assertSgTransition(page, server, fixture, label);
        await observe(page, server, label + "/changed-cap-stable",
          ["#inspHist .vhist-plot"], { inspector: true });
      }
      const requests = server.historyRequests.length;
      await closeInspector(page);
      await openInspector(page, key, id, label + "/cached", { freshOpening: false });
      assert.equal(server.historyRequests.length, requests, label + ": cached reopen must not refetch history");
      await closeInspector(page);
      if (restoreValues) fixture.values = restoreValues;
    }
    if (mutation && !disclosureMutation) return;

    if ((!only || only === "x10a-row") && !disclosureMutation)
      await disclosure(page, server, fixture, context + "/x10a-row",
        ['#valueGroups [data-trend="dhw_tank"]'], ["dhw_tank"]);
    if (!only || only === "board" || disclosureMutation)
      await disclosure(page, server, fixture, context + "/board",
        ['#settingsCards [data-desc="board:free_heap"]', '#settingsCards [data-desc="board:max_alloc"]'],
        ["free_heap", "max_alloc"], true);
    if (disclosureMutation) return;
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
    await evaluate(page, () => {
      window.__motionObserve = false;
      if (window.__motionDetachObserver) {
        window.__motionRecordDetachments(window.__motionDetachObserver.takeRecords());
        window.__motionDetachObserver.disconnect();
      }
      pollStop(); pollSchedule = () => {}; return true;
    });
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
    } finally { await page.focusEmulation(false); }
  }
}
