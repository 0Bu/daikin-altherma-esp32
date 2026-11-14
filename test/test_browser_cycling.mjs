import assert from "node:assert/strict";
import { makeHistoryMotionFixture } from "./test_browser_history_fixture.mjs";

const ROW = "button[data-desc='model:health_cycling']";
const DIAGNOSIS = '[data-dashboard-card="diagnosis"]';
const CHART = ".checkup-cycling-chart";
const COLS = `${CHART} .checkup-chart-cols`;
const OPEN = 23;
const LAST = 22;
const PREVIOUS = 21;
const ZERO = 20;
const MISSING = 19;
const EDGE = 18;
const RESTORED = 17;
const SHORT_GAP = 16;
const hour = bucket => `${COLS} button[data-bucket="${bucket}"]`;
const SIBLING_CARD = '[data-dashboard-card="group:Domestic hot water"]';
const SIBLING_ROW = `${SIBLING_CARD} [data-trend="dhw_tank"]`;
const SIBLING_PLOT = `${SIBLING_CARD} .vhist-plot[data-hist="dhw_tank"]`;
const evaluate = (page, fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg)})`);

async function point(page, selector, fraction = 0.5) {
  const hit = await evaluate(page, async ({ selector, fraction }) => {
    const node = document.querySelector(selector);
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = node?.getBoundingClientRect();
    if (!box?.width || !box.height) throw new Error("missing visible cycling target: " + selector);
    const x = box.left + box.width * fraction, y = box.top + box.height / 2;
    const target = document.elementFromPoint(x, y);
    return { x, y, matched: !!target?.closest(selector), target: target?.outerHTML.slice(0, 160),
      viewport: [innerWidth, innerHeight], clippedHeight: node.closest(".vdesc-inner")?.clientHeight };
  }, { selector, fraction });
  assert.equal(hit.matched, true, "native cycling target must be hit-testable: " +
    selector + " " + JSON.stringify(hit));
  return { x: hit.x, y: hit.y };
}

async function tap(page, selector, fraction) {
  const { x, y } = await point(page, selector, fraction);
  await page.nativeClick(x, y);
}

async function key(page, name, code) {
  await page.nativeKey("rawKeyDown", name, name, code);
  await page.nativeKey("keyUp", name, name, code);
}

export async function assertCyclingChart(page, server, context) {
  const original = await page.evaluate(`(() => {
    window.__cyclingOriginal = { ...S };
    return S.status;
  })()`);
  const boundary = Date.parse("2026-10-25T01:20:00Z") / 1000;
  const fixture = makeHistoryMotionFixture(original);
  const tank = fixture.values().values.find(row => row.concept === "dhw_tank");
  const histories = { "x10a:dhw_tank": { ...fixture.histories["x10a:dhw_tank"],
    boot_id: "cycling-browser-fixture", t0: boundary - 287 * 300 } };
  const values = { values: [tank] };
  const hours = Array.from({ length: 24 }, (_, bucket) => ({
    bucket, starts: 0, run_s: 0, observed_s: 3600,
    ...(bucket === OPEN ? {} : { end_unix_s: boundary - (LAST - bucket) * 3600 }),
  }));
  Object.assign(hours[SHORT_GAP], { observed_s: 3598, run_s: 3598, space_s: 3598, dhw_s: 0 });
  Object.assign(hours[RESTORED], { restored: true, observed_s: 180, run_s: 180, space_s: 180, dhw_s: 0 });
  Object.assign(hours[EDGE], { starts: 1, observed_s: 0 });
  Object.assign(hours[MISSING], { observed_s: 0 });
  Object.assign(hours[PREVIOUS], { starts: 1, run_s: 600, space_s: 0, dhw_s: 0 });
  Object.assign(hours[LAST], { starts: 3, run_s: 1800, observed_s: 3300, space_s: 600, dhw_s: 300 });
  Object.assign(hours[OPEN], { elapsed_s: 239, observed_s: 239, run_s: 120, space_s: 0, dhw_s: 120 });
  const status = { ...original, boot_id: "cycling-browser-fixture",
    ui: { ...original.ui, lang: "en" },
    hp: { ...original.hp, connected: true },
    history: { epoch: fixture.status.history.epoch, rows: [{ id: "dhw_tank", label: tank.label }] },
    diagnostics: { ...original.diagnostics, enabled: true },
    health: { status: "info", full_span: true, span_s: 86400, source_fresh: true, source_age_s: 0,
      checks: [
        { id: "cycling", verdict: "ok", evidence: "observation", reason: "class_coverage",
          starts: 5, space_runs: 3, space_mean_run_s: 480, dhw_runs: 2, dhw_mean_run_s: 900,
          hours_epoch: 1, hours },
        { id: "pressure", verdict: "ok", evidence: "heuristic",
          min_bar: 1.4, current_bar: 1.5, observed_s: 86400, required_s: 77760 },
      ],
    },
  };
  let updates = 0;
  const poll = async (time, { force = true } = {}) => {
    status.ntp = { ...status.ntp, synced: true, time };
    const requests = server.valuesRequests;
    server.setTelemetry({ status, values, histories });
    if (force) await page.evaluate("pollNow(); true");
    await page.waitFor(`S.status?.boot_id === ${JSON.stringify(status.boot_id)} &&
      S.status.ntp.time === ${JSON.stringify(time)} && !_pollBusy`, { timeoutMs: 18000 });
    assert.ok(server.valuesRequests > requests, context + ": real status poll must fetch values");
    updates++;
  };
  const pinned = () => evaluate(page, cols => Array.from(
    document.querySelectorAll(cols + ' [aria-pressed="true"]'), cell => {
      if (!cell.classList.contains("active")) throw new Error("pinned hour must also be marked visually");
      return Number(cell.dataset.bucket);
    }), COLS);
  const readout = () => evaluate(page, chart =>
    document.querySelector(chart + " .vhist-range").textContent.trim(), CHART);
  const focusBucket = () => page.evaluate("Number(document.activeElement.dataset.bucket)");
  const label = bucket => evaluate(page, selector =>
    document.querySelector(selector).getAttribute("aria-label"), hour(bucket));
  const cells = bucket => evaluate(page, selector => {
    const cell = document.querySelector(selector);
    const count = cell.querySelector("b");
    const bar = cell.querySelector("s");
    const box = bar.getBoundingClientRect();
    const segments = Object.fromEntries(Array.from(bar.querySelectorAll("i"), part => {
      const bounds = part.getBoundingClientRect();
      const hatched = [getComputedStyle(part), getComputedStyle(part, "::before")].some(style =>
        /gradient\(/.test(style.backgroundImage));
      return [part.className, { share: bounds.height / box.height, top: bounds.top, bottom: bounds.bottom,
        hatched }];
    }));
    const ordered = Object.values(segments).sort((a, b) => a.top - b.top);
    const disjoint = ordered.every((part, i) => !i || part.top >= ordered[i - 1].bottom - 0.5);
    const text = document.createRange();
    text.selectNodeContents(count);
    const textVisible = getComputedStyle(count).visibility === "visible" &&
      Array.from(text.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
    return { text: count.textContent.trim(), textVisible, segments, disjoint,
      countAbove: count.getBoundingClientRect().bottom <= box.top + 0.5 };
  }, hour(bucket));
  const assertSegments = async (bucket, expected, what) => {
    const { segments, disjoint } = await cells(bucket);
    assert.deepEqual(Object.keys(segments).sort(), Object.keys(expected).sort(), context + ": " + what);
    assert.equal(disjoint, true, `${context}: ${what}, runtime and coverage segments cannot overlap`);
    for (const [part, seconds] of Object.entries(expected))
      assert.ok(segments[part].share > 0 && Math.abs(segments[part].share - seconds / 3600) < 0.02,
        `${context}: ${what}, ${part} share was ${segments[part].share}`);
    if (expected.gap) assert.equal(segments.gap.hatched, true, context + ": elapsed gap is visually hatched");
  };
  const live = () => page.evaluate(`window.__cyclingChart.isConnected &&
    window.__cyclingChart === document.querySelector('${CHART}') &&
    window.__cyclingFocused.isConnected && document.activeElement === window.__cyclingFocused`);
  const mouse = page.inputMode !== "touch";
  try {
    await page.focusEmulation(true);
    if (mouse) await page.send("Emulation.setTimezoneOverride", { timezoneId: "Europe/Berlin" });
    await page.evaluate(`S.descOpen = new Set(); S.clickHold = false;
      S.dashboardCard = "diagnosis"; showStage("dashboard");
      pollSchedule = window.__browserPollSchedule; true`);
    await poll("2026-10-25T01:23:59Z");
    await evaluate(page, ({ chart, row }) => {
      if (document.querySelector(chart)) throw new Error("closed diagnosis must not mount a cycling chart");
      window.__cyclingFocused = document.querySelector(row);
      window.__cyclingFocused.focus();
    }, { chart: CHART, row: ROW });
    Object.assign(hours[OPEN], { elapsed_s: 240, observed_s: 240 });
    await poll("2026-10-25T01:24:00Z", { force: false });
    assert.equal(await page.evaluate("window.__cyclingFocused.isConnected && document.activeElement === window.__cyclingFocused"),
      true, context + ": minute rollover must retain focus in a closed diagnosis");

    await tap(page, ROW);
    await page.waitFor(`document.querySelector('${CHART}') && !S.clickHold`);
    const rendered = await evaluate(page, ({ chart, cols }) => {
      const node = document.querySelector(chart);
      const bounds = node.getBoundingClientRect();
      const detail = node.closest(".vitem").querySelector(".vdesc-body");
      const mean = detail.querySelector(".checkup-cycling-grid .inspect-row span:last-child");
      const text = document.createRange();
      if (mean) text.selectNodeContents(mean);
      const meanVisible = mean && getComputedStyle(mean).visibility === "visible" &&
        Array.from(text.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
      return { columns: document.querySelectorAll(cols + " > .checkup-chart-col").length,
        tabStops: document.querySelectorAll(cols + ' > button[tabindex="0"]').length,
        slider: !!node.querySelector('input[type="range"]'),
        fits: bounds.left >= -1 && bounds.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1,
        total: detail.querySelector(".checkup-cycling-total")?.textContent,
        purposeRows: Array.from(detail.querySelectorAll(".checkup-cycling-grid .inspect-row"),
          row => Array.from(row.children, cell => cell.textContent)),
        assessment: detail.querySelector(".checkup-cycling-assessment")?.textContent,
        legend: Array.from(node.querySelectorAll(".checkup-chart-legend .checkup-chart-key"),
          key => key.textContent),
        meanVisible };
    }, { chart: CHART, cols: COLS });
    assert.equal(rendered.columns, 24, context + ": one column per hour of the rolling window");
    assert.equal(rendered.tabStops, 1, context + ": native hour buttons share one keyboard entry");
    assert.equal(rendered.slider, false, context + ": the chart itself is the hour selector");
    assert.equal(rendered.fits, true, context + ": the complete chart fits inside the viewport");
    assert.equal(rendered.total, "≥5 starts", context + ": the start total has its own line");
    const copy = await page.evaluate(`[
      [t("mode.heat"), t("check.cycling.runs", 3) + " · " + t("check.cycling.mean", "8 min")],
      [t("mode.dhw"), t("check.cycling.runs", 2) + " · " + t("check.cycling.mean", "15 min")],
      t("check.cycling.waiting") + " " + MODEL_DESCRIPTIONS.health_cycling.what,
      [t("mode.heat"), t("mode.dhw"), t("check.hour.other")]
    ]`);
    assert.deepEqual(rendered.purposeRows, copy.slice(0, 2),
      context + ": completed runs and their means have separate heating and hot-water rows");
    assert.equal(rendered.assessment, copy[2], context + ": incomplete evidence gets a short assessment");
    assert.deepEqual(rendered.legend, copy[3], context + ": the chart labels its colored segments");
    assert.equal(rendered.meanVisible, true, context + ": the completed-run mean has a visible text box");
    const edge = await cells(EDGE), last = await cells(LAST);
    assert.equal(edge.text, "1", context + ": a witnessed start remains visible without paired runtime");
    assert.equal(last.text, "3", context + ": the observed count is printed above the selected hour bar");
    assert.ok(edge.textVisible && last.textVisible && edge.countAbove && last.countAbove,
      context + ": printed counts appear in their own columns above the bars");
    await assertSegments(ZERO, {}, "observed zero runtime has no missing or running segment");
    await assertSegments(MISSING, { gap: 3600 }, "an unread closed slot is entirely hatched");
    await assertSegments(SHORT_GAP, { space: 3598, gap: 2 },
      "a two-second sampling gap does not cover witnessed runtime");
    const { segments: short } = await cells(SHORT_GAP);
    assert.ok(short.gap.bottom - short.space.top <= 0.05,
      context + ": a subpixel sampling gap stays within its own interval");
    assert.ok((await label(SHORT_GAP)).includes(await page.evaluate(
      "t('check.hour.coverage', t('check.min', '59:58'), dwellDuration(3600))")),
      context + ": the short-gap readout retains second-level precision");
    await assertSegments(RESTORED, { space: 180 }, "a short restored slot does not infer a sampling gap");
    assert.ok((await label(RESTORED)).includes(
      await page.evaluate("t('check.hour.coverage', dwellDuration(180), '')")),
    context + ": the restored slot retains readable time and reports unknown elapsed time");
    const saved = await label(RESTORED);
    assert.match(saved, /^Saved time .+ · /, context + ": dated restoration labels its saved timestamp");
    await tap(page, hour(RESTORED));
    assert.equal(await readout(), saved, context + ": the visible readout gives the same saved timestamp");
    await assertSegments(PREVIOUS, { other: 600 }, "unassigned runtime keeps a neutral colour");
    await assertSegments(LAST, { space: 600, dhw: 300, other: 900, gap: 300 },
      "only evidenced mode durations colour a partly observed slot");
    await assertSegments(OPEN, { dhw: 120 },
      "a fully observed open slot leaves the future portion empty");
    assert.doesNotMatch((await label(OPEN)).split(" · ")[0], /\d:\d{2}/,
      context + ": no absolute time is invented for the open hour");
    assert.ok((await label(ZERO)).includes(" · " + await page.evaluate("t('check.starts', 0)") + " · "),
      context + ": readout reports zero observed starts without a lower-bound prefix");
    assert.ok((await label(MISSING)).includes(await page.evaluate("t('sys.nodata')")),
      context + ": an unread interval has no established start count");
    assert.ok((await label(EDGE)).includes("≥" + await page.evaluate("t('check.starts', 1)")),
      context + ": readout reports a witnessed edge without runtime as a lower bound");

    await tap(page, hour(PREVIOUS));
    assert.deepEqual(await pinned(), [PREVIOUS], context + ": native tap pins the hour column");
    await evaluate(page, sel => document.querySelector(sel).focus(), hour(PREVIOUS));
    await key(page, "ArrowRight", 39);
    assert.equal(await focusBucket(), LAST, context + ": arrow moves to the adjacent hour");
    assert.deepEqual(await pinned(), [PREVIOUS], context + ": keyboard preview preserves the earlier pin");
    await key(page, "Enter", 13);
    assert.deepEqual(await pinned(), [LAST], context + ": Enter pins only the focused hour");
    if (mouse) await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
    const chosen = await label(LAST);
    assert.ok(chosen.includes("≥" + await page.evaluate("t('check.starts', 3)")),
      context + ": the selected hour makes the observed lower bound accessible");
    assert.match(chosen, /\b30 min\b/, context + ": selected runtime is accessible");
    assert.match(chosen, /\b55 min\b/, context + ": selected coverage is accessible");
    for (const duration of [5, 10, 15])
      assert.match(chosen, new RegExp(`\\b${duration} min\\b`),
        context + ": selected runtime identifies each evidenced or unassigned duration");
    assert.ok(!chosen.includes(await page.evaluate('t("check.cycling.mean", "8 min")')),
      context + ": hourly label excludes the completed-run mean");
    const previous = await label(PREVIOUS);
    if (mouse) {
      assert.match(previous, /2:20/);
      assert.match(chosen, /2:20/);
      assert.notEqual(previous.split(" · ")[0], chosen.split(" · ")[0],
        context + ": repeated wall times must be disambiguated by the hour label itself");
    }
    await page.waitFor("!S.clickHold");
    await evaluate(page, chart => {
      window.__cyclingChart = document.querySelector(chart);
      window.__cyclingFocused = document.activeElement;
    }, CHART);
    const pinnedTip = await readout();
    assert.ok(pinnedTip, context + ": the selected hour has a visible readout");
    status.health.checks[1].current_bar = 1.6;
    await poll("2026-10-25T01:25:00Z");
    assert.equal(await live(), true, context + ": a scalar poll retains chart identity and focus");
    assert.deepEqual(await pinned(), [LAST], context + ": a minute change keeps the selected bucket");
    assert.equal(await readout(), pinnedTip, context + ": pinned readout stays stable across scalar polls");

    hours[OPEN].elapsed_s = 360;
    await poll("2026-10-25T01:26:00Z");
    await assertSegments(OPEN, { dhw: 120, gap: 120 },
      "only elapsed unread time is hatched in the open slot");
    assert.equal(await focusBucket(), LAST, context + ": changing gap geometry preserves focused bucket");
    assert.deepEqual(await pinned(), [LAST], context + ": changing gap geometry preserves the selected bucket");
    assert.equal(await label(LAST), chosen, context + ": a dated hour retains its measurement label");
    assert.match(await label(OPEN), /\b4 min\b/, context + ": the open-hour label reports observed time");

    if (mouse) {
      await evaluate(page, chart => { window.__cyclingChart = document.querySelector(chart); }, CHART);
      const start = await point(page, hour(LAST));
      const end = await point(page, hour(PREVIOUS));
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1,
        clickCount: 1, ...start });
      try {
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...end });
        const preview = await readout();
        assert.notEqual(preview, pinnedTip, context + ": dragging previews a different hour");
        await page.waitFor("!S.clickHold");
        hours[OPEN].elapsed_s = 420;
        await poll("2026-10-25T01:27:00Z");
        assert.equal(await page.evaluate("window.__cyclingChart.isConnected"), true,
          context + ": polling cannot detach the pointer-capturing chart");
        assert.equal(await readout(), preview, context + ": polling cannot erase the in-flight preview");
      } finally {
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left",
          buttons: 0, clickCount: 1, ...end });
      }
      assert.deepEqual(await pinned(), [LAST], context + ": releasing a drag preserves the existing pin");
    }
    await evaluate(page, sel => document.querySelector(sel).focus(), hour(LAST));
    await page.waitFor("!S.clickHold");
    hours[OPEN].end_unix_s = boundary + 3600;
    delete hours[OPEN].elapsed_s;
    hours.shift();
    hours.push({ bucket: OPEN + 1, starts: 0, run_s: 0, observed_s: 0, elapsed_s: 0 });
    await poll("2026-10-25T02:20:00Z");
    assert.deepEqual(await pinned(), [LAST],
      context + ": selected interval follows its bucket ID when the window advances");
    assert.equal(await focusBucket(), LAST, context + ": hour rollover retains focus by bucket");
    await assertSegments(OPEN + 1, {}, "an hour with zero elapsed time has no hatch");
    const expiredIndex = hours.findIndex(h => h.bucket === LAST);
    hours[expiredIndex] = { bucket: LAST, expired: true, starts: 0, run_s: 0, observed_s: 0 };
    await poll("2026-10-25T02:20:01Z");
    assert.equal(await evaluate(page, ({ cols, index }) => {
      const slot = document.querySelector(cols)?.children[index];
      return !!slot?.matches("span.checkup-chart-col[inert][aria-hidden='true']:empty");
    }, { cols: COLS, index: expiredIndex }), true, context + ": an expired bucket leaves a blank inert position");
    assert.deepEqual(await pinned(), [], context + ": an expired bucket clears its pin");
    assert.equal(await focusBucket(), OPEN + 1, context + ": expiry moves focus to the current hour");
    await assertSegments(OPEN, { dhw: 120, gap: 3360 }, "a newer hour retains observed runtime and its real gap");
    await key(page, "Home", 36);
    assert.equal(await focusBucket(), 1, context + ": Home focuses the earliest remaining hour");
    await key(page, "End", 35);
    assert.equal(await focusBucket(), OPEN + 1, context + ": End focuses the newest hour");
    await key(page, "Escape", 27);
    assert.deepEqual(await pinned(), [], context + ": Escape clears the current pin");
    await key(page, "Enter", 13);
    assert.deepEqual(await pinned(), [OPEN + 1], context + ": the newest hour can be pinned again");
    status.health.checks[0].hours_epoch++;
    await poll("2026-10-25T02:21:00Z");
    assert.deepEqual(await pinned(), [], context + ": a source reset does not retarget an existing pin");
    status.health.checks[0].hours_epoch++;
    const edgeOnlyHour = { bucket: 1, starts: 1, run_s: 0, observed_s: 0, elapsed_s: 0 };
    Object.assign(status.health.checks[0], { verdict: "collecting", starts: 1, observed_s: 0,
      space_runs: null, space_mean_run_s: null, dhw_runs: null, dhw_mean_run_s: null, hours: [edgeOnlyHour] });
    await poll("2026-10-25T02:22:00Z");
    assert.deepEqual(await evaluate(page, cols => Array.from(document.querySelectorAll(cols + " > button"),
      node => Number(node.dataset.bucket)), COLS), [1],
    context + ": padding in a new observation is not keyboard-selectable");
    assert.equal(await evaluate(page, cols =>
      document.querySelectorAll(cols + " > span[inert][aria-hidden='true']:empty").length, COLS),
    23, context + ": blank padding has no tracks, runtime or hatch segments");
    assert.equal(await evaluate(page, chart => !!document.querySelector(chart + " .checkup-gap-key"), CHART),
      false, context + ": padding does not introduce a sampling-gap legend");
    await assertSegments(1, {}, "the new observation does not hatch its unelapsed hour");
    assert.equal(await readout(), "≥" + await page.evaluate("t('check.starts', 1)"),
      context + ": the default readout reports a lower bound without invented runtime");
    const totals = () => evaluate(page, row => {
      const button = document.querySelector(row);
      return [button.querySelector(".vrow-val").textContent,
        button.closest(".vitem").querySelector(".checkup-cycling-total")?.textContent || null];
    }, ROW);
    assert.deepEqual(await totals(), ["≥1", "≥1 start"], context + ": both totals mark a positive count with no paired time");
    status.health.checks[0].starts = null;
    edgeOnlyHour.starts = 0;
    await poll("2026-10-25T02:22:01Z");
    const [compactStatus, detailStatus] = await totals();
    assert.equal(detailStatus, compactStatus, context + ": an empty report leads with status instead of a count");

    // The diagnosis remains expanded when the user switches cards. Even an ancestor that is
    // reattached before the poll finishes can briefly interrupt the visible plot's painting.
    await tap(page, '#cardNav [data-card="group:Domestic hot water"]');
    await tap(page, SIBLING_ROW);
    await page.waitFor(`document.querySelector(${JSON.stringify(SIBLING_PLOT)}) && !S.clickHold`);
    const priorLabel = await label(1);
    await evaluate(page, ({ plot, chart }) => {
      const node = document.querySelector(plot);
      if (historyView(node.dataset.hist, node.dataset.source || "").v.length !== 288)
        throw new Error("the visible sibling plot needs the full history ring");
      node.focus({ preventScroll: true });
      const ancestors = new Set();
      for (let ancestor = node; ancestor; ancestor = ancestor.parentNode) ancestors.add(ancestor);
      const watch = { node, chart: document.querySelector(chart), removals: 0 };
      watch.observer = new MutationObserver(records => {
        for (const record of records) for (const removed of record.removedNodes)
          if (ancestors.has(removed)) watch.removals++;
      });
      watch.observer.observe(document, { childList: true, subtree: true });
      window.__cyclingSibling = watch;
    }, { plot: SIBLING_PLOT, chart: CHART });
    for (const minutes of [23, 24, 25]) {
      edgeOnlyHour.elapsed_s += 60;
      if (minutes === 23) status.health.checks[0].starts = edgeOnlyHour.starts = 1;
      if (minutes === 24) {
        Object.assign(edgeOnlyHour, { observed_s: 60, run_s: 60, space_s: 60, dhw_s: 0 });
        Object.assign(status.health.checks[0], { verdict: "ok", reason: "heating_runs_insufficient",
          observed_s: 60, space_runs: 1, space_mean_run_s: 60, dhw_runs: 0 });
      }
      await poll(`2026-10-25T02:${minutes}:00Z`, { force: minutes !== 23 });
      const sibling = await evaluate(page, ({ plot, chart }) => {
        const watch = window.__cyclingSibling;
        return {
          removals: watch.removals,
          retained: watch.node.isConnected && watch.node === document.querySelector(plot),
          visible: !!watch.node.getBoundingClientRect().width && !watch.node.closest("[hidden]"),
          focused: document.activeElement === watch.node,
          hiddenDiagnosis: watch.chart === document.querySelector(chart) &&
            !!watch.chart.closest("[hidden]") && !!watch.chart.closest(".vitem.open"),
        };
      }, { plot: SIBLING_PLOT, chart: CHART });
      assert.deepEqual(sibling, { removals: 0, retained: true, visible: true, focused: true,
        hiddenDiagnosis: true }, context + ": changing hidden cycling hours and rows cannot detach the visible sibling plot");
      assert.equal(await label(1), priorLabel, context + ": hidden cycling readout waits until shown");
      assert.deepEqual(await totals(), ["≥1", "≥1 start"],
        context + ": the first start stays a lower bound when paired time begins");
    }
    await tap(page, '#cardNav [data-card="diagnosis"]');
    await assertSegments(1, { space: 60, gap: 120 }, "reopening the diagnosis card catches up the still-expanded chart");
    assert.deepEqual(await evaluate(page, row => Array.from(document.querySelector(row).closest(".vitem")
      .querySelectorAll(".checkup-cycling-grid .inspect-row"), item => Array.from(item.children, cell => cell.textContent)), ROW),
    await page.evaluate(`[[t("mode.heat"), t("check.cycling.runs", 1) + " · " + t("check.cycling.mean", "1 min")],
      [t("mode.dhw"), t("check.cycling.runs", 0)]]`),
    context + ": reopening the diagnosis shows completed-run rows that arrived while hidden");
    assert.notEqual(await label(1), priorLabel, context + ": the resumed chart reads the newest elapsed time");
    assert.equal(await page.evaluate("window.__cyclingSibling.removals"), 0,
      context + ": updating the visible cycling chart leaves the sibling plot mounted");
    const timeline = {
      unix_s: Date.parse("2026-11-13T15:11:00Z") / 1000, window_end_s: 86400, observed_end_s: 86400,
      records: [[0, 1], [60, 5], [28800, 0], [36000, 1], [79260, 5], [79620, 3], [79620, 5],
        [79980, 1], [80280, 4], [80280, 5], [80600, 0], [80700, 1], [81000, 3], [81000, 5], [84660, 1]]
        .map(([at, kind]) => at * 8 + kind),
    };
    Object.assign(status.health.checks[0], {
      starts: 27, hours: [{ starts: 22, restored: true }, { starts: 5 }],
    });
    status.health.checks[0].timeline = timeline;
    await poll("2026-11-13T15:11:00Z");
    await page.waitFor(`document.querySelector(".checkup-cycling-timeline") !== null`);
    assert.equal((await totals())[1], "≥27 starts");
    assert.match(await page.evaluate(`document.querySelector(".checkup-cycling-assessment").textContent`),
      /Of these, 22 starts come from hourly totals saved before the restart/);
    const timed = await page.evaluate(`(() => {
      const chart = document.querySelector(".checkup-cycling-timeline");
      return {
        line: chart.querySelector("path").getAttribute("d"),
        modes: [...chart.querySelectorAll('[data-bucket="22"] i:not(.gap)')].map(node => node.className),
        counts: [22, 23].map(i => chart.querySelector('[data-bucket="' + i + '"] b').textContent),
        gap: !!chart.querySelector('[data-bucket="8"] i.gap'),
        mixedGapHeight: chart.querySelector('[data-bucket="22"] .mixed-gap i.gap').getBoundingClientRect().height,
        span: chart.querySelector('[data-bucket="22"]').dataset.span,
      };
    })()`);
    const jumps = [...timed.line.matchAll(/H ([\d.]+) V/g)].map(match => Number(match[1]));
    assert.deepEqual(jumps, [1.67, 2201.67, 2211.67, 2230, 2250], context + ": jumps use individual event seconds");
    assert.deepEqual(timed.modes.sort(), ["dhw", "space"]);
    assert.deepEqual(timed.counts, ["4", "0"]);
    assert.equal(timed.gap, true);
    assert.ok(timed.mixedGapHeight > 0 && timed.mixedGapHeight < 10, context + ": hatching has its own visible band");
    const layout = () => page.evaluate(`(() => {
      const chart = document.querySelector(".checkup-cycling-timeline");
      const graph = chart.querySelector(".checkup-chart-graph");
      const axis = chart.querySelector(".checkup-chart-axis");
      const box = node => {
        const r = node.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      };
      const style = node => {
        const s = getComputedStyle(node);
        return [s.color, s.fontSize, s.fontWeight, s.lineHeight];
      };
      const overlay = getComputedStyle(graph, "::before");
      return { graph: box(graph), axis: box(axis),
        legend: box(chart.querySelector(".checkup-chart-legend")),
        tick: style(axis.querySelector(".checkup-chart-ticks span")),
        span: style(axis.querySelector(".checkup-chart-span")),
        overlay: [overlay.content, overlay.left, overlay.width, overlay.height] };
    })()`);
    const before = await layout();
    await tap(page, hour(22));
    const readAxis = () => page.evaluate(`(() => {
      const chart = document.querySelector(".checkup-cycling-timeline");
      const axis = chart.querySelector(".checkup-chart-axis");
      return { label: axis.querySelector(".checkup-chart-span").textContent,
        normalHidden: getComputedStyle(axis.querySelector(".checkup-chart-ticks")).visibility === "hidden",
        extra: !!chart.querySelector(".vhist-range") };
    })()`);
    assert.deepEqual(await readAxis(), { label: timed.span, normalHidden: true, extra: false });
    const selectedLayout = await layout();
    assert.deepEqual(selectedLayout.tick, selectedLayout.span, context + ": selected label uses axis typography");
    assert.equal(selectedLayout.overlay[0], '""', context + ": the hour has a dedicated highlight");
    assert.ok(Math.abs(parseFloat(selectedLayout.overlay[1]) - selectedLayout.graph[2] * 22 / 24) < 1);
    assert.ok(Math.abs(parseFloat(selectedLayout.overlay[2]) - selectedLayout.graph[2] / 24) < 1);
    assert.ok(Math.abs(parseFloat(selectedLayout.overlay[3]) - selectedLayout.graph[3]) < 1,
      context + ": the highlight spans both plot and hours");
    assert.deepEqual([selectedLayout.graph[3], selectedLayout.axis[3], selectedLayout.legend[1] - selectedLayout.graph[1]],
      [before.graph[3], before.axis[3], before.legend[1] - before.graph[1]],
      context + ": selection does not shift chart layout");
    await page.waitFor("!S.clickHold");
    Object.assign(timeline, { window_end_s: 86520, observed_end_s: 86520, unix_s: timeline.unix_s + 120 });
    timeline.records.push(85800 * 8 + 5);
    await poll("2026-11-13T15:13:00Z");
    const rolled = await page.evaluate(`(() => {
      const button = document.querySelector(".checkup-cycling-timeline [aria-pressed='true']");
      return { span: button.dataset.span, count: button.querySelector("b").textContent };
    })()`);
    assert.notEqual(rolled.span, timed.span, context + ": selected hour advances with the rolling axis");
    assert.deepEqual(await readAxis(), { label: rolled.span, normalHidden: true, extra: false });
    assert.equal(rolled.count, "3", context + ": a start moving into the previous hour leaves the selected count");
    const refreshed = await page.evaluate(`document.querySelector(".checkup-cycling-timeline path").getAttribute("d")`);
    assert.deepEqual([...refreshed.matchAll(/H ([\d.]+) V/g)].map(match => Number(match[1])),
      [2198.33, 2208.33, 2226.67, 2246.67, 2380], context + ": the selected chart shows new starts and drops expired starts");
    await evaluate(page, selector => document.querySelector(selector).focus(), hour(22));
    delete status.health.checks[0].timeline;
    status.health.checks[0].hours = [];
    status.uptime_s = 86580;
    await poll("2026-11-13T15:14:00Z");
    assert.deepEqual(await pinned(), [22], context + ": empty hourly evidence and temporary omission keep the rolling selection");
    assert.equal(await focusBucket(), 22, context + ": temporary omission keeps keyboard focus");
    assert.equal(await page.evaluate(`!!document.querySelector('.checkup-cycling-timeline [data-bucket="23"] i.gap')`), true,
      context + ": time after the last retained sample is marked as missing");
    Object.assign(timeline, { window_end_s: 86580, observed_end_s: 86580, unix_s: timeline.unix_s + 60 });
    status.health.checks[0].timeline = timeline;
    await poll("2026-11-13T15:14:01Z");
    const resumed = await page.evaluate(`document.querySelector('.checkup-cycling-timeline [aria-pressed="true"]').dataset.span`);
    assert.equal((await readAxis()).label, resumed, context + ": a resumed trace keeps the selected readout");
    if (mouse) {
      const start = await point(page, hour(22)), end = await point(page, hour(21));
      const preview = await page.evaluate(`document.querySelector('.checkup-cycling-timeline [data-bucket="21"]').dataset.span`);
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...start });
      try {
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, ...end });
        assert.equal((await readAxis()).label, preview, context + ": dragging previews the rolling hour");
        await poll("2026-11-13T15:14:02Z");
        assert.equal((await readAxis()).label, preview, context + ": polling retains the drag preview");
      } finally {
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...end });
      }
      assert.equal((await readAxis()).label, resumed, context + ": release restores the selected hour");
    }
    await tap(page, hour(22));
    assert.deepEqual(await readAxis(), { label: "", normalHidden: false, extra: false });
    const dismissed = await layout();
    assert.equal(dismissed.axis[3], before.axis[3], context + ": deselection keeps axis height");
    await page.waitFor("!S.clickHold");
    const zero = { ...timeline, records: timeline.records.filter(record => (record & 7) !== 5) };
    status.health.checks[0].timeline = zero;
    await poll("2026-11-13T15:14:03Z");
    assert.equal(await page.evaluate(`document.querySelector(".checkup-chart-total").textContent`),
      "Timed: 0 starts", context + ": a partial trace qualifies zero as a timed result");
    if (mouse) {
      zero.unix_s = Date.parse("2026-10-25T01:30:00Z") / 1000;
      await poll("2026-10-25T01:30:00Z");
      await tap(page, hour(23));
      assert.match((await readAxis()).label, /02:30 GMT\+2–02:30 GMT\+1/,
        context + ": the repeated wall-clock hour has distinct offsets");
    } else {
      await tap(page, hour(23));
    }
    await page.waitFor("!S.clickHold");
    assert.deepEqual(await pinned(), [23], context + ": the hour is selected before reboot");
    status.boot_id = "cycling-browser-reboot";
    status.uptime_s = 60;
    const cycling = status.health.checks[0];
    delete cycling.timeline;
    cycling.starts = 22;
    cycling.hours = [{ ...hours[RESTORED], starts: 22 }];
    await poll("2026-11-13T15:15:00Z");
    assert.deepEqual(await page.evaluate(`(() => {
      const chart = document.querySelector(".checkup-cycling-chart");
      return {
        timeline: chart?.classList.contains("checkup-cycling-timeline"),
        counts: [...(chart?.querySelectorAll("button b") ?? [])].map(n => n.textContent).filter(Boolean),
        selected: !!chart?.querySelector('[aria-pressed="true"]'),
      };
    })()`), { timeline: false, counts: ["22"], selected: false },
    context + ": a reboot discards the previous trace and selection and shows saved hourly starts");
    const restoredHealth = { ...status.health, persist: "flash" };
    status.health = { status: "unavailable", persist: "unknown",
      checks: [{ id: "cycling", verdict: "unavailable" }] };
    for (const time of ["2026-11-13T15:15:01Z", "2026-11-13T15:15:02Z"]) {
      await poll(time);
      const diagnosis = await evaluate(page, ({ card, row, chart }) => {
        const host = document.querySelector(card);
        const empty = host.querySelector(".empty");
        return { empty: empty?.textContent, visible: !!empty?.getClientRects().length,
          cycling: !!host.querySelector(row), chart: !!host.querySelector(chart) };
      }, { card: DIAGNOSIS, row: ROW, chart: CHART });
      assert.deepEqual(diagnosis, { empty: "No data", visible: true, cycling: false, chart: false },
        context + ": an unreadable snapshot removes the previously visible evidence");
    }
    status.health = restoredHealth;
    await poll("2026-11-13T15:15:03Z");
    const cyclingRow = await evaluate(page, row => {
      const button = document.querySelector(row);
      return { visible: !!button?.getClientRects().length, open: button?.getAttribute("aria-expanded") === "true" };
    }, ROW);
    assert.equal(cyclingRow.visible, true, context + ": Cycling returns when the snapshot becomes readable");
    if (!cyclingRow.open) await tap(page, ROW);
    await page.waitFor("!S.clickHold");
    await poll("2026-11-13T15:15:04Z");
    const archived = await evaluate(page, chart => [...document.querySelectorAll(chart + " button b")]
      .map(cell => cell.textContent).filter(Boolean), CHART);
    assert.deepEqual(archived, ["22"], context + ": a readable snapshot restores the archived count");
    assert.ok(updates >= 3, context + ": verify continuity across repeated production polling");
    console.log("cycling chart checked: " + context + "; " + updates + " live status polls");
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy");
    server.setTelemetry();
    await page.evaluate(`Object.assign(S, window.__cyclingOriginal);
      window.__cyclingSibling?.observer.disconnect(); delete window.__cyclingSibling;
      delete window.__cyclingOriginal; delete window.__cyclingChart; delete window.__cyclingFocused;
      renderApp(); true`);
    if (mouse) await page.send("Emulation.setTimezoneOverride", { timezoneId: "" });
    await page.focusEmulation(false);
  }
}
