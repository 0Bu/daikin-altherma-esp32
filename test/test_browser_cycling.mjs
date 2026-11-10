import assert from "node:assert/strict";

const ROW = "button[data-desc='model:health_cycling']";
const CHART = ".checkup-cycling-chart";
const COLS = `${CHART} .checkup-chart-cols`;
const OPEN = 23;
const LAST = 22;
const PREVIOUS = 21;
const ZERO = 20;
const MISSING = 19;
const EDGE = 18;
const RESTORED = 17;
const hour = bucket => `${COLS} button[data-bucket="${bucket}"]`;
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
    return { status: S.status, values: { values: S._values, modbus: S._modbus } };
  })()`);
  const boundary = Date.parse("2026-10-25T01:20:00Z") / 1000;
  const hours = Array.from({ length: 24 }, (_, bucket) => ({
    bucket, starts: 0, run_s: 0, observed_s: 3600,
    ...(bucket === OPEN ? {} : { end_unix_s: boundary - (LAST - bucket) * 3600 }),
  }));
  Object.assign(hours[RESTORED], { restored: true, observed_s: 180, run_s: 180, space_s: 180, dhw_s: 0 });
  Object.assign(hours[EDGE], { starts: 1, observed_s: 0 });
  Object.assign(hours[MISSING], { observed_s: 0 });
  Object.assign(hours[PREVIOUS], { starts: 1, run_s: 600, space_s: 0, dhw_s: 0 });
  Object.assign(hours[LAST], { starts: 3, run_s: 1800, observed_s: 3300, space_s: 600, dhw_s: 300 });
  Object.assign(hours[OPEN], { elapsed_s: 239, observed_s: 239, run_s: 120, space_s: 0, dhw_s: 120 });
  const status = { ...original.status, boot_id: "cycling-browser-fixture",
    diagnostics: { ...original.status.diagnostics, enabled: true },
    health: { status: "info", full_span: true, span_s: 86400, source_fresh: true, source_age_s: 0,
      checks: [
        { id: "cycling", verdict: "ok", evidence: "observation", reason: "class_coverage",
          starts: 5, space_runs: 3, space_mean_run_s: 480, hours_epoch: 1, hours },
        { id: "pressure", verdict: "ok", evidence: "heuristic",
          min_bar: 1.4, current_bar: 1.5, observed_s: 86400, required_s: 77760 },
      ],
    },
  };
  let updates = 0;
  const poll = async (time, { force = true } = {}) => {
    status.ntp = { ...status.ntp, synced: true, time };
    const requests = server.valuesRequests;
    server.setTelemetry({ status, values: original.values, histories: {} });
    if (force) await page.evaluate("pollNow(); true");
    await page.waitFor(`S.status?.boot_id === 'cycling-browser-fixture' &&
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
      const mean = node.closest(".vitem").querySelector(".checkup-cycling-grid .inspect-row span:last-child");
      const text = document.createRange();
      if (mean) text.selectNodeContents(mean);
      const meanVisible = mean && getComputedStyle(mean).visibility === "visible" &&
        Array.from(text.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
      return { columns: document.querySelectorAll(cols + " > .checkup-chart-col").length,
        tabStops: document.querySelectorAll(cols + ' > button[tabindex="0"]').length,
        slider: !!node.querySelector('input[type="range"]'),
        fits: bounds.left >= -1 && bounds.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1,
        mean: mean?.textContent, meanVisible };
    }, { chart: CHART, cols: COLS });
    assert.equal(rendered.columns, 24, context + ": one column per hour of the rolling window");
    assert.equal(rendered.tabStops, 1, context + ": native hour buttons share one keyboard entry");
    assert.equal(rendered.slider, false, context + ": the chart itself is the hour selector");
    assert.equal(rendered.fits, true, context + ": the complete chart fits inside the viewport");
    assert.match(rendered.mean, /8:00 min/, context + ": completed-run mean is separate from hourly runtime");
    assert.equal(rendered.meanVisible, true, context + ": the completed-run mean has a visible text box");
    const edge = await cells(EDGE), last = await cells(LAST);
    assert.equal(edge.text, "1", context + ": a witnessed start remains visible without paired runtime");
    assert.equal(last.text, "3", context + ": the observed count is printed above the selected hour bar");
    assert.ok(edge.textVisible && last.textVisible && edge.countAbove && last.countAbove,
      context + ": printed counts appear in their own columns above the bars");
    await assertSegments(ZERO, {}, "observed zero runtime has no missing or running segment");
    await assertSegments(MISSING, { gap: 3600 }, "an unread closed slot is entirely hatched");
    await assertSegments(RESTORED, { space: 180 }, "a short restored slot does not infer a sampling gap");
    assert.ok((await label(RESTORED)).includes(
      await page.evaluate("t('check.hour.coverage', dwellDuration(180), '')")),
    context + ": the restored slot retains readable time and reports unknown elapsed time");
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
    assert.doesNotMatch(chosen, /Ø|8:00 min/, context + ": hourly label excludes a completed-run mean");
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
    Object.assign(status.health.checks[0], { starts: 0, space_runs: null, space_mean_run_s: null, hours: [
      { bucket: 1, starts: 1, run_s: 0, observed_s: 0, elapsed_s: 0 },
    ] });
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
    assert.ok(updates >= 3, context + ": verify continuity across repeated production polling");
    console.log("cycling chart checked: " + context + "; " + updates + " live status polls");
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy");
    server.setTelemetry();
    await page.evaluate(`Object.assign(S, window.__cyclingOriginal);
      delete window.__cyclingOriginal; delete window.__cyclingChart; delete window.__cyclingFocused;
      renderApp(); true`);
    if (mouse) await page.send("Emulation.setTimezoneOverride", { timezoneId: "" });
    await page.focusEmulation(false);
  }
}
