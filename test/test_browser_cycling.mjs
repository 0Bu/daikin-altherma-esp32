import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeHistoryMotionFixture } from "./test_browser_history_fixture.mjs";
import { launchBrowser } from "../tools/browser/cdp_browser.mjs";
import { launchWebKit } from "../tools/browser/webkit_browser.mjs";

// Every owned resource is released even if setup, the assertion, or another cleanup fails.
export async function withCyclingCleanup(run, ...cleanups) {
  const errors = [];
  let result;
  try { result = await run(); } catch (error) { errors.push(error); }
  for (const cleanup of cleanups) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Cycling assertion and cleanup failures");
  return result;
}

// The supervisor owns the lock's parent directory and bounds both parallel workers. Keep the slot
// until the disposable browser has exited so a failed close cannot start another Chromium process.
export async function withChromiumAppearanceSlot(lock, run, closeBrowser) {
  if (lock) {
    for (;;) {
      try {
        fs.mkdirSync(lock);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
  return withCyclingCleanup(run, async () => {
    const closed = await closeBrowser();
    if (lock && closed) fs.rmdirSync(lock);
  });
}

// A live tick clears its timer while awaiting HTTP; no timer alone is not a stopped caller.
export function cyclingPollStopped(timer, busy) { return timer === null && !busy; }

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

async function point(page, selector, fraction = 0.5, height) {
  const hit = await evaluate(page, async ({ selector, fraction, height }) => {
    const node = document.querySelector(selector);
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = node?.getBoundingClientRect();
    if (!box?.width || !box.height) throw new Error("missing visible cycling target: " + selector);
    const vertical = height == null ? box : node.closest(".checkup-chart-graph").getBoundingClientRect();
    const x = box.left + box.width * fraction, y = vertical.top + vertical.height * (height ?? 0.5);
    const target = document.elementFromPoint(x, y);
    return { x, y, matched: !!target?.closest(selector), target: target?.outerHTML.slice(0, 160),
      viewport: [innerWidth, innerHeight], clippedHeight: node.closest(".vdesc-inner")?.clientHeight };
  }, { selector, fraction, height });
  assert.equal(hit.matched, true, "native cycling target must be hit-testable: " +
    selector + " " + JSON.stringify(hit));
  return { x: hit.x, y: hit.y };
}

async function tap(page, selector, fraction, height) {
  const { x, y } = await point(page, selector, fraction, height);
  await page.nativeClick(x, y);
}

async function key(page, name, code) {
  await page.nativeKey("rawKeyDown", name, name, code);
  await page.nativeKey("keyUp", name, name, code);
}

async function captureCyclingEvidence(page, context) {
  const directory = process.env.DAIKIN_BROWSER_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(path.isAbsolute(directory), "cycling evidence directory must be absolute");
  const clip = await page.evaluate(`(() => {
    const row = document.querySelector("${CHART}").closest(".vitem");
    row.scrollIntoView({block: "center", behavior: "instant"});
    const r = row.getBoundingClientRect();
    return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height};
  })()`);
  const image = page.screenshotClip ? await page.screenshotClip(clip) : Buffer.from((await page.send(
    "Page.captureScreenshot", {format: "png", captureBeyondViewport: true, clip: {...clip, scale: 1}})).data, "base64");
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, context.replaceAll("/", "-") + ".png"), image);
}

async function assertCyclingAppearance(parent, server, context) {
  const view = await parent.evaluate(`({width: innerWidth, height: innerHeight,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  let isolated;
  const touch = parent.inputMode === "touch";
  const lock = touch ? undefined : process.env.DAIKIN_BROWSER_CYCLING_LOCK;
  const sweep = async () => {
    // Language caches, media overrides and polling belong to this disposable browser, never to
    // the page that will subsequently measure live history motion.
    isolated = await (touch
      ? launchWebKit({viewport: {width: view.width, height: view.height}, allowedOrigin: new URL(server.url).origin})
      : launchBrowser());
    const page = isolated.page;
    if (!touch) {
      await page.viewport(view.width, view.height);
      await page.send("Emulation.setTimezoneOverride", {timezoneId: view.timeZone});
    }
    await page.navigate(server.url);
    await page.waitFor("typeof S !== 'undefined' && S.status && Array.isArray(S._values)");
    await page.focusEmulation(true);
    await page.evaluate("pollStop(); true");
    await page.waitFor("!_pollBusy");
    await page.evaluate(`pollStop(); S.descOpen = new Set(); S.dashboardCard = "diagnosis";
      showStage("dashboard"); renderApp(); true`);
    await tap(page, ROW);
    await page.waitFor(`document.querySelector("${CHART}") && !S.clickHold`);
    const locales = await page.evaluate("UI_LANGS");
    const theme = scheme => page.colorScheme ? page.colorScheme(scheme) : page.send(
      "Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: scheme}]});
    for (const scheme of ["light", "dark"]) {
      await theme(scheme);
      for (const locale of locales) {
        await evaluate(page, async locale => { await setLang(locale); renderApp(); }, locale);
        await page.waitFor(`(() => {
          const row = document.querySelector("${CHART}").closest(".vitem");
          return row.getAnimations({subtree:true}).every(a => !(a instanceof CSSTransition) || a.playState !== "running");
        })()`);
        const visual = await page.evaluate(`(() => {
          const chart = document.querySelector("${CHART}"), plot = chart.querySelector("svg");
          const cols = chart.querySelector(".checkup-chart-cols"), fill = chart.querySelector('[data-bucket="22"] s');
          const box = chart.getBoundingClientRect(), s = getComputedStyle(fill);
          const line = getComputedStyle(plot.querySelector("path"));
          return {lang: document.documentElement.lang, dark: matchMedia("(prefers-color-scheme: dark)").matches,
            fits: box.left >= 0 && box.right <= innerWidth && chart.scrollWidth <= chart.clientWidth + 1,
            legend: [...chart.querySelectorAll(".checkup-chart-key")].map(n => n.textContent),
            expected: [t("mode.heat"), t("mode.dhw"), t("check.fault_unknown")],
            fillHeight: fill.getBoundingClientRect().height, plotHeight: plot.getBoundingClientRect().height,
            fillOpacity: Number(s.opacity), gradient: s.backgroundImage, modes: fill.dataset.modes,
            lineAbove: Number(getComputedStyle(plot).zIndex) > Number(getComputedStyle(cols).zIndex),
            lineOpacity: Number(line.opacity), svgOpacity: Number(getComputedStyle(plot).opacity),
            lineWidth: line.strokeWidth, pointerEvents: getComputedStyle(plot).pointerEvents};
        })()`);
        const label = `${context}/${scheme}/${locale}`;
        assert.equal(visual.lang, locale, label + ": the real locale catalog must load");
        assert.equal(visual.dark, scheme === "dark", label + ": use the actual color-scheme media query");
        assert.equal(visual.fits, true, label + ": translated chart and legend must fit");
        assert.deepEqual(visual.legend, visual.expected, label + ": exactly three localized categories");
        assert.equal(visual.modes, "space dhw other", label + ": deduplicated category set");
        assert.ok(visual.fillHeight >= 90 && Math.abs(visual.fillHeight - visual.plotHeight) < 1,
          label + ": full plot-height plasma, not a miniature strip");
        assert.ok(visual.fillOpacity > 0 && visual.fillOpacity <= .25, label + ": highly transparent backgrounds");
        assert.ok(visual.gradient.includes("radial-gradient"), label + ": soft overlapping color fields");
        assert.equal(visual.lineAbove, true, label + ": the step line paints above all category backgrounds");
        assert.equal(visual.lineOpacity * visual.svgOpacity, 1, label + ": the step line stays opaque");
        assert.equal(visual.lineWidth, "2px", label + ": the established line weight is preserved");
        assert.equal(visual.pointerEvents, "none", label + ": the foreground line cannot steal hour selection");
        if (["en", "de"].includes(locale)) await captureCyclingEvidence(page, label);
      }
    }
    assert.deepEqual(page.diagnostics, [], context + ": isolated appearance must emit no browser errors");
  };
  const closeBrowser = async () => {
    // Failed startup may also have failed to stop Chromium. The supervisor ends both workers.
    if (!isolated) return false;
    await isolated.close();
    return true;
  };
  await withCyclingCleanup(() => withChromiumAppearanceSlot(lock, sweep, closeBrowser),
    () => parent.focusEmulation(true));
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
    const bar = cell.querySelector(".checkup-chart-fill");
    const box = bar.getBoundingClientRect(), style = getComputedStyle(bar);
    const text = document.createRange();
    text.selectNodeContents(count);
    const textVisible = getComputedStyle(count).visibility === "visible" &&
      Array.from(text.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
    const plot = cell.closest(".checkup-chart-graph")?.querySelector("svg");
    const expectedHeight = plot?.getBoundingClientRect().height || cell.getBoundingClientRect().height - 16;
    const modes = bar.dataset.modes.split(" ").filter(Boolean);
    const legendSwatch = modes.length === 1
      ? cell.closest(".checkup-cycling-chart").querySelector(".checkup-chart-key i." + modes[0]) : null;
    return { text: count.textContent.trim(), textVisible, modes, height: box.height, expectedHeight,
      opacity: Number(style.opacity), background: style.backgroundImage, color: style.backgroundColor,
      legendColor: legendSwatch ? getComputedStyle(legendSwatch).backgroundColor : null,
      countBelow: count.getBoundingClientRect().top >= box.bottom - 0.5,
      children: bar.children.length, animations: bar.getAnimations().length };
  }, hour(bucket));
  const assertFill = async (bucket, expected, what) => {
    const fill = await cells(bucket);
    assert.deepEqual(fill.modes, expected, context + ": " + what);
    assert.ok(fill.height >= 90 && Math.abs(fill.height - fill.expectedHeight) < 1,
      `${context}: full plot-height category fill, not a miniature strip: ${JSON.stringify(fill)}`);
    assert.ok(fill.opacity > 0 && fill.opacity <= 0.25, context + ": category fills stay highly transparent");
    assert.equal(fill.children, 0, context + ": no stacked duration or gap segments");
    assert.equal(fill.animations, 0, context + ": plasma is a static category mix, not time-varying evidence");
    if (expected.length > 1) {
      assert.ok(fill.background.includes("radial-gradient"), context + ": mixed categories use soft gradients");
    } else {
      assert.equal(fill.background, "none", context + ": a transparent or solid fill has no background image");
    }
    const transparent = "rgba(0, 0, 0, 0)";
    if (expected.length === 1) assert.notEqual(fill.color, transparent, context + ": a witnessed category has a solid color");
    assert.equal(fill.color, expected.length === 1 ? fill.legendColor : transparent,
      context + ": the solid fill matches its legend color, and an empty category set stays transparent");
    assert.ok(!fill.background.includes("repeating-"), context + ": Unknown has no separate gap hatching");
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
      [t("mode.heat"), t("mode.dhw"), t("check.fault_unknown")]
    ]`);
    assert.deepEqual(rendered.purposeRows, copy.slice(0, 2),
      context + ": completed runs and their means have separate heating and hot-water rows");
    assert.equal(rendered.assessment, copy[2], context + ": incomplete evidence gets a short assessment");
    assert.deepEqual(rendered.legend, copy[3], context + ": the chart labels exactly three visual categories");
    assert.equal(rendered.meanVisible, true, context + ": the completed-run mean has a visible text box");
    const edge = await cells(EDGE), last = await cells(LAST);
    assert.equal(edge.text, "1", context + ": a witnessed start remains visible without paired runtime");
    assert.equal(last.text, "3", context + ": the observed count is printed below the selected hour fill");
    assert.ok(edge.textVisible && last.textVisible && edge.countBelow && last.countBelow,
      context + ": printed counts remain legible in their own columns below the fills");
    await assertFill(ZERO, [], "observed off-time does not invent a running mode or missing data");
    await assertFill(MISSING, ["other"], "an unread retained slot uses the neutral Unknown fill");
    await assertFill(SHORT_GAP, ["space", "other"],
      "even a short sampling gap contributes Unknown without sizing a duration segment");
    assert.ok((await label(SHORT_GAP)).includes(await page.evaluate(
      "t('check.hour.coverage', t('check.min', '59:58'), dwellDuration(3600))")),
      context + ": the short-gap readout retains second-level precision");
    await assertFill(RESTORED, ["space"], "a short restored slot does not infer a sampling gap");
    assert.ok((await label(RESTORED)).includes(
      await page.evaluate("t('check.hour.coverage', dwellDuration(180), '')")),
    context + ": the restored slot retains readable time and reports unknown elapsed time");
    const saved = await label(RESTORED);
    assert.match(saved, /^Saved time .+ · /, context + ": dated restoration labels its saved timestamp");
    await tap(page, hour(RESTORED));
    assert.equal(await readout(), saved, context + ": the visible readout gives the same saved timestamp");
    await assertFill(PREVIOUS, ["other"], "unassigned runtime keeps the same neutral Unknown colour");
    await assertFill(LAST, ["space", "dhw", "other"],
      "unassigned runtime and sampling gaps share one Unknown contributor");
    await assertFill(OPEN, ["dhw"],
      "an open slot shows category presence without inventing future or missing duration");
    assert.doesNotMatch((await label(OPEN)).split(" · ")[0], /\d:\d{2}/,
      context + ": no absolute time is invented for the open hour");
    assert.ok((await label(ZERO)).includes(" · " + await page.evaluate("t('check.starts', 0)") + " · "),
      context + ": readout reports zero observed starts without a lower-bound prefix");
    assert.ok((await label(MISSING)).includes(await page.evaluate("t('sys.nodata')")),
      context + ": an unread interval has no established start count");
    assert.ok((await label(EDGE)).includes("≥" + await page.evaluate("t('check.starts', 1)")),
      context + ": readout reports a witnessed edge without runtime as a lower bound");
    await captureCyclingEvidence(page, context + "/hourly");

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
    await assertFill(OPEN, ["dhw", "other"],
      "new elapsed unread time adds Unknown to the existing hot-water fill");
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
      const beforeClose = await point(page, hour(LAST));
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1,
        clickCount: 1, ...beforeClose });
      try {
        await page.waitFor("S.scrub === 'checkup-cycling'");
        await evaluate(page, sel => document.querySelector(sel).click(), ROW);
        assert.equal(await page.evaluate("S.scrub"), null,
          context + ": collapsing the cycling disclosure releases its captured gesture");
      } finally {
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left",
          buttons: 0, clickCount: 1, ...beforeClose });
      }
      await tap(page, ROW);
      await page.waitFor(`document.querySelector('${CHART}') && !S.clickHold`);
      assert.deepEqual(await pinned(), [], context + ": the old release cannot pin a collapsed chart");
      await tap(page, hour(LAST));
      assert.deepEqual(await pinned(), [LAST], context + ": reopened chart accepts a new pin");
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
    await assertFill(OPEN + 1, [], "the new hour is unfilled at zero elapsed time");
    const expiredIndex = hours.findIndex(h => h.bucket === LAST);
    hours[expiredIndex] = { bucket: LAST, expired: true, starts: 0, run_s: 0, observed_s: 0 };
    hours[hours.length - 1].elapsed_s = 1;
    await poll("2026-10-25T02:20:01Z");
    assert.equal(await evaluate(page, ({ cols, index }) => {
      const slot = document.querySelector(cols)?.children[index];
      return !!slot?.matches("span.checkup-chart-col[inert][aria-hidden='true']:empty");
    }, { cols: COLS, index: expiredIndex }), true, context + ": an expired bucket leaves a blank inert position");
    assert.deepEqual(await pinned(), [], context + ": an expired bucket clears its pin");
    assert.equal(await focusBucket(), OPEN + 1, context + ": expiry moves focus to the current hour");
    await assertFill(OPEN + 1, ["other"], "elapsed time without readings adds the Unknown fill");
    await assertFill(OPEN, ["dhw", "other"], "a newer hour retains observed modes and Unknown presence");
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
    23, context + ": blank padding has no category fills or fabricated readings");
    assert.equal(await evaluate(page, chart => !!document.querySelector(chart + " .checkup-gap-key"), CHART),
      false, context + ": padding does not introduce a sampling-gap legend");
    await assertFill(1, [], "a boundary start retains its count without adding a missing interval");
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
    await assertFill(1, ["space", "other"], "reopening the diagnosis card catches up the still-expanded chart");
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
      run_edges: true,
      records: [[0, 1], [60, 5], [28800, 0], [36000, 1], [79260, 5], [79260, 3], [79560, 1], [79567, 6],
        [79620, 5], [79620, 3], [79980, 1], [79987, 6], [80280, 5], [80280, 4], [80600, 0],
        [80700, 4], [80800, 1], [80808, 6], [81000, 5], [81000, 3], [84660, 1], [84667, 6]]
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
        modes: chart.querySelector('[data-bucket="22"] s').dataset.modes.split(" "),
        counts: [22, 23].map(i => chart.querySelector('[data-bucket="' + i + '"] b').textContent),
        unknown: chart.querySelector('[data-bucket="8"] s').dataset.modes,
        legend: [...chart.querySelectorAll('.checkup-chart-key')].map(node => node.textContent),
        span: chart.querySelector('[data-bucket="22"]').dataset.span,
      };
    })()`);
    const jumps = [...timed.line.matchAll(/H ([\d.]+) V/g)].map(match => Number(match[1]));
    assert.deepEqual(jumps, [1.67, 2201.67, 2211.67, 2230, 2250], context + ": jumps use individual event seconds");
    assert.deepEqual(timed.modes, ["space", "dhw", "other"]);
    assert.deepEqual(timed.counts, ["4", "0"]);
    assert.equal(timed.unknown, "other");
    assert.deepEqual(timed.legend, copy[3], context + ": gap and unassigned modes share the Unknown legend");
    await assertFill(22, ["space", "dhw", "other"], "the timed chart uses the same full-height plasma fill");
    await assertFill(8, ["other"], "a complete timeline gap is neutral, not a separate hatch");
    assert.match(await label(22), /Sampling gap/, context + ": a partly observed hour exposes the gap");
    assert.doesNotMatch(await label(22), /No data/, context + ": an observed mode is available in that hour");
    assert.match(await label(8), /No data/, context + ": the fully unread hour exposes missing data");
    await assertFill(12, [], "readable off-time remains uncolored in the timed chart");
    // Prove that the geometry check rejects the old miniature-strip layout, rather than just
    // checking a class name. The control changes only real CSS and must fail for its height.
    await page.evaluate(`(() => {
      const style = document.createElement("style"); style.id = "cycling-strip-control";
      style.textContent = ".checkup-cycling-timeline .checkup-chart-fill {top:auto!important;height:10px!important}";
      document.head.append(style); return true;
    })()`);
    try {
      await assert.rejects(() => assertFill(22, ["space", "dhw", "other"], "old strip control"),
        /full plot-height category fill/, context + ": the former ten-pixel strip must fail");
    } finally {
      await page.evaluate('document.getElementById("cycling-strip-control").remove(); true');
    }
    const languageCache = await page.evaluate("localStorage.getItem('uiLang')");
    await withCyclingCleanup(async () => {
      // The fixture owns this real polling chain. A disposable appearance sweep must not restart
      // a stopped caller, fill an absent language cache, or replace its current chart.
      await page.evaluate("pollStop(); localStorage.removeItem('uiLang'); true");
      await page.waitFor("!_pollBusy");
      await page.evaluate(`pollStop(); window.__cyclingAppearanceParent = {lang: LANG,
        dark: matchMedia("(prefers-color-scheme: dark)").matches,
        chart: document.querySelector("${CHART}")}; true`);
      await assertCyclingAppearance(page, server, context);
      const isolation = await page.evaluate(`(() => {
        const before = window.__cyclingAppearanceParent;
        return {lang: LANG === before.lang,
          dark: matchMedia("(prefers-color-scheme: dark)").matches === before.dark,
          chart: document.querySelector("${CHART}") === before.chart,
          stopped: (${cyclingPollStopped})(_pollTimer, _pollBusy), languageCache: localStorage.getItem("uiLang")};
      })()`);
      assert.deepEqual(isolation, {lang: true, dark: true, chart: true, stopped: true, languageCache: null},
        context + ": appearance matrix must leave its parent page untouched");
    }, () => evaluate(page, cached => {
      try {
        if (cached === null) localStorage.removeItem("uiLang");
        else localStorage.setItem("uiLang", cached);
      } finally {
        delete window.__cyclingAppearanceParent;
        pollSchedule(POLL_VALUES_MS);
      }
    }, languageCache));
    const layout = () => page.evaluate(`(() => {
      const chart = document.querySelector(".checkup-cycling-timeline");
      const graph = chart.querySelector(".checkup-chart-graph");
      const axis = chart.querySelector(".checkup-chart-axis");
      const caption = chart.querySelector(".checkup-chart-total");
      const box = node => {
        const r = node.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      };
      const style = node => {
        const s = getComputedStyle(node);
        return [s.color, s.fontSize, s.fontWeight, s.lineHeight];
      };
      const overlay = getComputedStyle(graph, "::before");
      return { graph: box(graph), axis: box(axis), caption: box(caption),
        legend: box(chart.querySelector(".checkup-chart-legend")),
        tick: style(axis.querySelector(".checkup-chart-ticks span")),
        span: style(axis.querySelector(".checkup-chart-span")),
        overlay: [overlay.content, overlay.left, overlay.width, overlay.height] };
    })()`);
    const before = await layout();
    // Use the actual top of the plot, well above the former 29px button strip.
    await tap(page, hour(22), 0.5, 0.07);
    assert.deepEqual(await pinned(), [22], context + ": the upper plot selects the hour");
    const runDetails = () => page.evaluate(`(() => {
      const details = document.querySelector(".checkup-run-details");
      return { hidden: details.hidden, text: details.querySelector("table") ? "" : details.textContent.trim(),
        headers: [...details.querySelectorAll("th")].map(cell => cell.textContent),
        rows: [...details.querySelectorAll("tbody tr")].map(row => [...row.cells].map(cell =>
          cell.querySelector("time")?.dateTime || cell.innerText)), fits: details.scrollWidth <= details.clientWidth + 1 };
    })()`);
    const observedIso = sec => new Date((timeline.unix_s + sec - timeline.window_end_s) * 1000).toISOString();
    const expectedRuns = [
      [observedIso(79260), observedIso(79567), "5:07 min"],
      [observedIso(79620), observedIso(79987), "6:07 min"],
      [observedIso(80280), "Stop unknown", "—"],
      [observedIso(81000), observedIso(84667), "61:07 min"],
    ];
    assert.deepEqual(await runDetails(), { hidden: false, text: "", headers: ["Start", "Stop", "Duration"],
      rows: expectedRuns, fits: true },
    context + ": the run list uses its actual stop across the hour boundary and censors a later stop after a gap");
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
    assert.ok(selectedLayout.caption[1] + selectedLayout.caption[3] <= selectedLayout.graph[1],
      context + ": the selection starts below the recorded-starts caption");
    assert.deepEqual([selectedLayout.graph[3], selectedLayout.axis[3], selectedLayout.legend[1] - selectedLayout.graph[1]],
      [before.graph[3], before.axis[3], before.legend[1] - before.graph[1]],
      context + ": selection does not shift chart layout");
    await page.waitFor("!S.clickHold");
    await tap(page, hour(23), 0.5, 0.95);
    assert.equal((await runDetails()).text, "No recorded starts in this hour.",
      context + ": a run ending in this hour appears only under its start hour");
    await page.waitFor("!S.clickHold");
    await tap(page, hour(22), 0.5, 0.46);
    assert.deepEqual(await pinned(), [22], context + ": the middle of the plot can switch the pinned hour");
    await page.waitFor("!S.clickHold");
    Object.assign(timeline, { window_end_s: 86520, observed_end_s: 86520, unix_s: timeline.unix_s + 120 });
    timeline.records.push(85800 * 8 + 5, 85800 * 8 + 3);
    await poll("2026-11-13T15:13:00Z");
    const rolled = await page.evaluate(`(() => {
      const button = document.querySelector(".checkup-cycling-timeline [aria-pressed='true']");
      return { span: button.dataset.span, count: button.querySelector("b").textContent };
    })()`);
    assert.notEqual(rolled.span, timed.span, context + ": selected hour advances with the rolling axis");
    assert.deepEqual(await readAxis(), { label: rolled.span, normalHidden: true, extra: false });
    assert.equal(rolled.count, "3", context + ": a start moving into the previous hour leaves the selected count");
    assert.deepEqual((await runDetails()).rows, expectedRuns.slice(1),
      context + ": the selected list tracks its moving hour boundaries");
    const refreshed = await page.evaluate(`document.querySelector(".checkup-cycling-timeline path").getAttribute("d")`);
    assert.deepEqual([...refreshed.matchAll(/H ([\d.]+) V/g)].map(match => Number(match[1])),
      [2198.33, 2208.33, 2226.67, 2246.67, 2380], context + ": the selected chart shows new starts and drops expired starts");
    await tap(page, hour(23));
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Running", "12 min"]],
      context + ": the open run reports duration through the latest sample");
    await page.waitFor("!S.clickHold");
    await page.evaluate(`window.__cyclingHeldChart = document.querySelector("${CHART}");
      S.scrub = "checkup-cycling"; true`);
    const priorDiagnostics = page.diagnostics.length;
    let releaseValues;
    server.setTelemetry({ statusUnavailable: true, status, values, histories });
    try {
      await page.evaluate("pollNow(); true");
      await page.waitFor("!_pollBusy && S.transportUnavailable === 'status'");
      assert.deepEqual(await pinned(), [23], context + ": loss of status keeps the selected hour");
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
        context + ": loss of status withdraws the running claim");
      assert.ok(await page.evaluate(`window.__cyclingHeldChart === document.querySelector("${CHART}")`),
        context + ": loss of status updates run truth without replacing the held plot");
      await page.evaluate("S.scrub = null; true");
      await poll("2026-11-13T15:13:01Z");
      await page.evaluate("S.scrub = 'checkup-cycling'; true");
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Running", "12 min"]],
        context + ": a fresh rendered trace restores the running claim");
      status.health.checks[0].timeline = { ...timeline, records: [...timeline.records, 86510 * 8 + 1, 86520 * 8 + 6] };
      status.ntp.time = "2026-11-13T15:13:02Z";
      const valuesGate = new Promise(resolve => { releaseValues = resolve; });
      server.setTelemetry({ status, values, histories, valuesGate });
      await page.evaluate("pollNow(); true");
      await page.waitFor("S.status.ntp.time === '2026-11-13T15:13:02Z' && _pollBusy");
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
        context + ": a newly accepted status invalidates Running before delayed values return");
      releaseValues();
      await page.waitFor("!_pollBusy");
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
        context + ": a stopped trace does not revive the held plot's old running claim");
      assert.ok(await page.evaluate(`window.__cyclingHeldChart === document.querySelector("${CHART}")`),
        context + ": status recovery does not replace the held plot");
    } finally {
      releaseValues?.();
      await page.evaluate("S.scrub = null; delete window.__cyclingHeldChart; true");
      server.setTelemetry({ status, values, histories });
    }
    await poll("2026-11-13T15:13:03Z");
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), observedIso(86520), "12 min"]],
      context + ": the next chart render shows the stop and complete duration");
    status.health.checks[0].timeline = timeline;
    await poll("2026-11-13T15:13:04Z");
    // The browser reports the deliberately failed HTTP request as a resource error.
    const expectedFailure = page.diagnostics.findIndex((line, index) =>
      index >= priorDiagnostics && /Failed to load resource.*500/.test(line));
    if (expectedFailure >= 0) page.diagnostics.splice(expectedFailure, 1);
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Running", "12 min"]],
      context + ": a successful status refresh restores the observed ongoing run");
    status.ntp.time = "2026-11-13T15:13:05Z";
    delete status.health.checks[0].timeline;
    const valuesGate = new Promise(resolve => { releaseValues = resolve; });
    server.setTelemetry({ status, values, histories, valuesGate });
    try {
      await page.evaluate("pollNow(); true");
      await page.waitFor("S.status.ntp.time === '2026-11-13T15:13:05Z' && _pollBusy");
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
        context + ": an ordinary status refresh withdraws Running before delayed values return");
    } finally {
      releaseValues();
      await page.waitFor("!_pollBusy");
    }
    status.health.checks[0].timeline = timeline;
    await poll("2026-11-13T15:13:06Z");
    await page.evaluate(`cyclingStatusAt -= CYCLING_FRESH_MS; renderCards(); true`);
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
      context + ": a values repaint cannot reuse an expired compressor sample");
    status.health.checks[0].timeline = { ...timeline, window_end_s: timeline.window_end_s + 12,
      unix_s: timeline.unix_s + 12 };
    await poll("2026-11-13T15:13:06.25Z");
    try {
      await page.evaluate(`pollStop(); S.scrub = "checkup-cycling";
        window.__cyclingHeldChart = document.querySelector("${CHART}"); renderCards(); true`);
      assert.equal((await runDetails()).rows[0][1], "Running",
        context + ": a values-only repaint during a hold preserves the fresh run");
      await page.waitFor(`document.querySelector(".checkup-run-details tbody tr").cells[1].innerText === "Stop unknown"`,
        { timeoutMs: 2800 });
      assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
        context + ": the age limit withdraws the claim without polling or repainting");
      assert.ok(await page.evaluate(`window.__cyclingHeldChart === document.querySelector("${CHART}")`),
        context + ": expiry leaves the held plot in place");
    } finally {
      await page.evaluate("S.scrub = null; delete window.__cyclingHeldChart; true");
      status.health.checks[0].timeline = timeline;
    }
    await poll("2026-11-13T15:13:06.5Z");
    await page.evaluate("S.otaCached = true; renderApp(); true");
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
      context + ": an OTA snapshot never claims that the compressor is still running");
    await page.evaluate("S.otaCached = false; renderApp(); true");
    await evaluate(page, selector => document.querySelector(selector).focus(), hour(22));
    delete status.health.checks[0].timeline;
    status.health.checks[0].hours = [];
    status.uptime_s = timeline.window_end_s;
    await poll("2026-11-13T15:13:07Z");
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
      context + ": a successful poll omitting the trace cannot confirm an ongoing run even in the same second");
    status.uptime_s = 86580;
    await poll("2026-11-13T15:14:00Z");
    assert.deepEqual(await pinned(), [23], context + ": empty hourly evidence and temporary omission keep the rolling selection");
    assert.deepEqual((await runDetails()).rows, [[observedIso(85800), "Stop unknown", "—"]],
      context + ": a stale cached run does not claim the compressor is still running");
    assert.equal(await focusBucket(), 22, context + ": temporary omission keeps keyboard focus");
    assert.equal(await page.evaluate(`document.querySelector('.checkup-cycling-timeline [data-bucket="23"] s').dataset.modes.includes("other")`), true,
      context + ": time after the last retained sample is marked as missing");
    Object.assign(timeline, { window_end_s: 86580, observed_end_s: 86580, unix_s: timeline.unix_s + 60 });
    status.health.checks[0].timeline = timeline;
    await poll("2026-11-13T15:14:01Z");
    await tap(page, hour(22));
    await page.waitFor("!S.clickHold");
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
    assert.equal((await runDetails()).hidden, true, context + ": deselecting hides the run list");
    const dismissed = await layout();
    assert.equal(dismissed.axis[3], before.axis[3], context + ": deselection keeps axis height");
    await page.waitFor("!S.clickHold");
    const zero = { ...timeline, records: timeline.records.filter(record => (record & 7) < 5) };
    status.health.checks[0].timeline = zero;
    await poll("2026-11-13T15:14:03Z");
    assert.equal(await page.evaluate(`document.querySelector(".checkup-chart-total").textContent`),
      "0 starts with recorded times", context + ": a partial trace qualifies zero as a timed result");
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
    cycling.hours_epoch = 2;
    cycling.hours = [
      { ...hours.find(hour => hour.bucket === RESTORED), bucket: -1, starts: 22,
        end_unix_s: Date.parse("2026-11-13T15:14:00Z") / 1000 },
      { bucket: 0, starts: 0, run_s: 0, observed_s: 0, elapsed_s: 60 },
    ];
    status.health.persist = "flash";
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
    const archived = await evaluate(page, chart => {
      const saved = document.querySelector(chart + ' button[data-bucket="-1"]');
      return { count: saved?.querySelector("b").textContent, label: saved?.getAttribute("aria-label") };
    }, CHART);
    assert.equal(archived.count, "22", context + ": a readable snapshot restores the archived count");
    assert.match(archived.label, /^Saved time /, context + ": the browser identifies the restored interval");
    await tap(page, hour(-1));
    assert.equal((await runDetails()).text, "No individual run times available for this hour.",
      context + ": a saved hourly total cannot provide individual run times");
    await page.waitFor("!S.clickHold");

    const datedBase = Date.parse("2026-11-13T15:16:00Z") / 1000;
    const datedIso = offset => new Date((datedBase + offset) * 1000).toISOString();
    const datedPoll = async (offset, boot, live, observed, records) => {
      status.uptime_s = boot;
      cycling.timeline = { boot_s: boot, live, unix_s: datedBase + offset,
        window_end_s: 86400, observed_end_s: 86400 + observed - offset, run_edges: true,
        records: records.map(([at, kind]) => (86400 + at - offset) * 8 + kind) };
      await poll(datedIso(offset));
    };
    const firstBoot = [[-3700, 1], [-3630, 5], [-3630, 3], [-3545, 1], [-3540, 6], [-50, 5], [-50, 3]];
    const crossingRun = [datedIso(-3630), datedIso(-3540), "1:30 min"];
    const interruptedRun = [datedIso(-50), "Stop unknown", "—"];
    await datedPoll(0, 6000, true, 0, firstBoot);
    await tap(page, hour(22));
    assert.deepEqual((await runDetails()).rows, [crossingRun],
      context + ": the dated trace lists the observed cross-hour run before reboot");
    await page.waitFor("!S.clickHold");
    await tap(page, hour(23));
    assert.deepEqual((await runDetails()).rows, [[datedIso(-50), "Running", "50 s"]],
      context + ": a fresh live observation in the dated trace shows an ongoing run");
    await page.waitFor("!S.clickHold");

    status.boot_id = "cycling-browser-dated-reboot";
    const archivedTrace = [...firstBoot, [0, 0]];
    await datedPoll(8, 8, false, 0, archivedTrace);
    assert.deepEqual(await pinned(), [], context + ": a new boot clears the previous selection");
    await tap(page, hour(22));
    assert.deepEqual((await runDetails()).rows, [crossingRun],
      context + ": a reboot preserves both absolute times and the duration of a completed run");
    await page.waitFor("!S.clickHold");
    await tap(page, hour(23));
    assert.deepEqual((await runDetails()).rows, [interruptedRun],
      context + ": even a very recent restored sample cannot establish a running compressor");
    await page.waitFor("!S.clickHold");

    const secondBoot = [...archivedTrace, [4, 2], [5, 1], [6, 6], [20, 5], [20, 4]];
    await datedPoll(28, 28, true, 28, secondBoot);
    assert.deepEqual((await runDetails()).rows, [interruptedRun, [datedIso(20), "Running", "8 s"]],
      context + ": a new-boot stop cannot close an interrupted run across the reboot gap");
    await datedPoll(53, 53, true, 53, [...secondBoot, [49, 1], [50, 6]]);
    const finishedRuns = [interruptedRun, [datedIso(20), datedIso(50), "30 s"]];
    assert.deepEqual((await runDetails()).rows, finishedRuns,
      context + ": the new run retains its own stop and duration");

    const beforeOmission = (await readAxis()).label;
    delete cycling.timeline;
    status.uptime_s = 118;
    await poll(datedIso(118));
    assert.notEqual((await readAxis()).label, beforeOmission,
      context + ": a temporarily omitted dated trace advances its hour from boot uptime");
    assert.deepEqual((await runDetails()).rows, finishedRuns,
      context + ": the cached dated trace retains both boots without shifting any recorded clock time");
    assert.equal(await evaluate(page, selector => document.querySelector(selector + " s").dataset.modes.includes("other"), hour(23)), true,
      context + ": the dated trace cannot extend measured data into a temporarily omitted span");

    status.history.epoch++;
    cycling.hours = [];
    cycling.starts = null;
    status.uptime_s = 119;
    await poll(datedIso(119));
    assert.equal(await page.evaluate(`document.querySelector(".vitem.open [data-checkup-hours]")?.textContent.trim()`),
      "No history yet.", context + ": a committed history forget withdraws cached precise run times");
    assert.deepEqual(await pinned(), [], context + ": a committed history forget withdraws the cached hour selection");
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
