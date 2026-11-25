import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchWebKit } from "../tools/browser/webkit_browser.mjs";
import { startFixtureServer } from "../tools/browser/fixture_server.mjs";
import { assertHistoryMotion, HISTORY_MOTION_MUTATIONS } from "./test_browser_history_motion.mjs";
import { assertWebKitFlowPaint } from "./test_browser_webkit_paint.mjs";
import { assertDhwTimeline } from "./test_browser_dhw.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageFile = process.env.DAIKIN_BROWSER_PAGE;
if (!pageFile || !fs.statSync(pageFile, { throwIfNoEntry: false })?.isFile())
  throw new Error("DAIKIN_BROWSER_PAGE must name the production-marker-assembled dashboard page");
const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
if (mutation && ![...HISTORY_MOTION_MUTATIONS, "history-paint-freeze"].includes(mutation))
  throw new Error("unknown WebKit selftest mutation: " + mutation);
const viewports = { "ipad-portrait": { width: 834, height: 1194 },
  "ipad-landscape": { width: 1194, height: 834 } };

async function assertWebKitDashboardDiagnosis(page, server, context) {
  await page.evaluate(`window.__webkitDiagSaved = {
    status: JSON.parse(JSON.stringify(S.status)),
    values: JSON.parse(JSON.stringify(S._values || [])),
    modbus: JSON.parse(JSON.stringify(S._modbus || [])),
    card: S.dashboardCard,
    open: [...S.descOpen],
    insp: S.insp,
    inspFromDefrostNotice: S.inspFromDefrostNotice,
    hist: new Map(S.hist), pins: new Map(S.histPin), hidden: new Map(S.histHidden),
    histIdentity: S.histIdentity, histUptime: S.histUptime, histEpoch: S.histEpoch,
  }; true`);
  try {
    const base = server.defaultStatus();
    const defrostLabel = "Defrost Operation";
    const bootId = "webkit-defrost-diagnosis", epoch = 1;
    const diagStatus = {
      ...base,
      boot_id: bootId, uptime_s: 86400,
      history: { epoch, rows: [{ id: "defrost_state", label: defrostLabel }] },
      diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
      health: {
        status: "info", source: "x10a", source_fresh: true, full_span: true,
        span_s: 86400, covered_s: 86400, persist: "fresh",
        checks: [
          { id: "cycling", verdict: "ok", evidence: "measured", starts: 2, observed_s: 86400, required_s: 86400 },
          {
            id: "defrost", verdict: "info", evidence: "measured", count: 3, paired_count: 3, share_pct: 15,
            defrost_s: 151, run_s: 1000, observed_s: 86400, required_s: 86400,
            outdoor_source: "x10a", outdoor_min_c: -4.5, outdoor_mean_c: -2.0, outdoor_samples: 10,
            last_observed_start: { unix_s: 2000000000, route: "space_heating", outdoor_c: -2.5 },
          },
          { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 86400 },
        ],
      },
      refrigerant_service: { state: "limited", continuous_s: 3600, samples: 120, blocker: "compressor_not_running" },
    };
    const values = server.defaultValues();
    values.values = [...values.values.filter(row => row.label !== defrostLabel),
      { label: defrostLabel, concept: "defrost_state", value: "0", binary: true, group: "Operation" }];
    const histories = { "x10a:defrost_state": {
      id: "defrost_state", source: "x10a", boot_id: bootId, epoch, dt: 300, b0: 284, v: [0, 10, 10, 0],
    } };
    server.setTelemetry({ status: diagStatus, values, histories });
    await page.evaluate(`(() => {
      pollSchedule = window.__browserPollSchedule;
      S.descOpen.clear();
      S.descOpen.add("service:refrigerant");
      S.dashboardCard = "diagnosis";
      pollNow();
      return true;
    })()`);
    await page.waitFor("S.status?.diagnostics?.enabled === true && S.status?.refrigerant_service?.state === 'limited' && !_pollBusy");
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.frame();
    const observed = await page.evaluate(`(() => ({
      browserHidden: document.getElementById("cardBrowser").hidden,
      navCount: document.querySelectorAll("#cardNav [data-card]").length,
      valueRows: document.querySelectorAll("#valueGroups .vrow, #valueGroups .vdesc").length,
      note: !!document.querySelector('button[data-defrost-inspect]'),
      duplicate: !!document.querySelector('[data-desc="model:health_defrost"]'),
      alert: document.getElementById("gDefrostState").classList.contains("sc-defrost-alert"),
      service: document.querySelector('[data-desc="service:refrigerant"]')?.closest(".vitem")?.textContent || "",
    }))()`);
    assert.equal(observed.browserHidden, false, `${context}: #cardBrowser must be visible`);
    assert.ok(observed.navCount >= 2, `${context}: #cardNav must be populated`);
    assert.ok(observed.valueRows > 0, `${context}: #valueGroups must render diagnosis and value rows`);
    assert.ok(observed.note && observed.alert && !observed.duplicate,
      `${context}: WebKit presents the fresh defrost note without the old disclosure`);
    assert.ok(observed.service.includes(await page.evaluate("t('service.help.limited')")),
      `${context}: the refrigerant service disclosure still renders its reported state`);

    const tap = async (selector, fraction = 0.5) => {
      const point = await page.evaluate(`(async () => {
        const node = document.querySelector(${JSON.stringify(selector)});
        node.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = node.getBoundingClientRect();
        const x = box.left + box.width * ${fraction}, y = box.top + box.height / 2;
        return { x, y, reachable: node.contains(document.elementFromPoint(x, y)) };
      })()`);
      assert.equal(point.reachable, true, `${context}: native tap can reach ${selector}`);
      await page.nativeClick(point.x, point.y);
      await page.frame();
    };
    await tap("button[data-defrost-inspect]");
    await page.waitFor(`S.insp === 'defrost' && S.hist.has('defrost_state') && !S.histBusy.has('defrost_state') &&
      !!document.querySelector("#inspHist [data-hist='defrost_state'] .defrost-on") && !S.clickHold`);
    const { state, expectedState, rows, expectedRows } = await page.evaluate(`(() => ({
      state: document.getElementById("inspNow").innerText,
      expectedState: t("state.off"),
      rows: Array.from(document.querySelectorAll("#inspRows .inspect-row"), row => row.lastElementChild.innerText),
      expectedRows: [(3).toLocaleString(LANG), (15.1).toLocaleString(LANG) + " %"],
    }))()`);
    assert.equal(state, expectedState, `${context}: the shortcut opens the current OFF state`);
    assert.deepEqual(rows, expectedRows, `${context}: the inspector shows the two X10A measurements`);
    const plot = "#inspHist [data-hist='defrost_state']";
    await tap(plot, 0.4);
    await page.waitFor("S.histPin.has('defrost_state') && !S.scrub");
    assert.ok(await page.evaluate(`(() => {
      const graph = document.querySelector(${JSON.stringify(plot)}).parentElement;
      const tip = graph.querySelector(".vhist-tip.vhist-pinned");
      const time = graph.querySelector(".vhist-time.vhist-pinned");
      const axis = graph.querySelector(".vhist-axis");
      const readout = tip?.textContent.split(" · ");
      return readout?.length === 2 && !!readout[0].trim() && readout[1] === t("hist.defrost_active") &&
        getComputedStyle(time).display === "none" && tip.getBoundingClientRect().height > 0 &&
        tip.getBoundingClientRect().top >= axis.getBoundingClientRect().bottom - 1;
    })()`), `${context}: native touch pins the active defrost readout below the scale`);
    await tap("#inspClose");
    await page.waitFor("!S.insp && !S.clickHold");
    assert.deepEqual(page.diagnostics, [], `${context}: WebKit full dashboard diagnosis must emit no errors`);
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy");
    server.setTelemetry();
    await page.evaluate(`(() => {
      const saved = window.__webkitDiagSaved;
      if (saved) {
        S.status = saved.status;
        S._values = saved.values;
        S._modbus = saved.modbus;
        S.dashboardCard = saved.card;
        S.descOpen = new Set(saved.open);
        S.insp = saved.insp;
        S.inspFromDefrostNotice = saved.inspFromDefrostNotice;
        S.hist = saved.hist;
        S.histPin = saved.pins;
        S.histHidden = saved.hidden;
        S.histIdentity = saved.histIdentity;
        S.histUptime = saved.histUptime;
        S.histEpoch = saved.histEpoch;
        S.inspSig = S.inspHistSig = null;
        delete window.__webkitDiagSaved;
        renderApp();
      }
      return true;
    })()`);
  }
}
const index = process.argv.indexOf("--viewport");
const selected = index < 0 ? Object.keys(viewports) : [process.argv[index + 1]];
assert.ok(selected.every(name => viewports[name]), "unknown WebKit iPad viewport: " + selected.join(","));
for (const name of selected) {
  let browser, server;
  try {
    server = await startFixtureServer({ pageFile, projectRoot: ROOT });
    browser = await launchWebKit({ viewport: viewports[name], allowedOrigin: new URL(server.url).origin });
  } catch (error) {
    await server?.close();
    console.error("WebKit render setup: " + error.message);
    process.exit(2);
  }
  let bodyError = null;
  try {
    const { page } = browser;
    page.historyMotionEvidence = [];
    await page.navigate(server.url);
    await page.waitFor("typeof S !== 'undefined' && S.status && Array.isArray(S._values) && document.querySelector('#settingsCards .vgroup')");
    await page.evaluate("pollStop(); window.__browserPollSchedule=pollSchedule; pollSchedule=()=>{}; true");
    if (process.argv.includes("--dhw-only")) {
      await assertDhwTimeline(page, server, "webkit/" + name + "/dhw");
      assert.deepEqual(page.diagnostics, [], "WebKit DHW timeline must emit no browser errors");
      continue;
    }
    if (process.argv.includes("--diagnosis-only")) {
      const { assertCyclingChart } = await import("./test_browser_cycling.mjs");
      await assertCyclingChart(page, server, "webkit/" + name + "/diagnosis/cycling");
      await assertDhwTimeline(page, server, "webkit/" + name + "/diagnosis/dhw");
      await assertWebKitDashboardDiagnosis(page, server, "webkit/" + name + "/diagnosis/dashboard");
      assert.deepEqual(page.diagnostics, [], "WebKit cycling diagnosis must emit no browser errors");
      continue;
    }
    if (!mutation || mutation === "history-paint-freeze")
      page.assertFlowPaint = context => assertWebKitFlowPaint(page, context);
    await assertHistoryMotion(page, server, "webkit/" + name + "/history-motion");
    if (!mutation) {
      await assertDhwTimeline(page, server, "webkit/" + name + "/dhw");
      if (!process.env.WEBKIT_SCOPE_RECORD)
        await assertWebKitDashboardDiagnosis(page, server, "webkit/" + name + "/dashboard");
    }
    const touch = await page.touchWitness();
    assert.ok(touch.touchstart >= 2 && touch.touchend === touch.touchstart &&
      touch.pointerdown === touch.touchstart && touch.pointerup === touch.touchstart,
    "WebKit must execute balanced trusted native touch/pointer interactions");
    assert.deepEqual(page.diagnostics, [], "WebKit history lifecycle must emit no browser errors");
    const touchDurations = page.touchTimings();
    assert.equal(touchDurations.length, touch.touchstart, "every trusted tap must have its native roundtrip measured");
    const maxTouch = Math.max(...touchDurations);
    assert.ok(maxTouch < 250, "WebKit native touch responsiveness budget exceeded: " + Math.round(maxTouch) + " ms");
    console.log("WebKit iPad history gate passed: " + browser.product + "; " + name +
      "; " + viewports[name].width + "x" + viewports[name].height + "; " + touch.touchstart +
      " trusted native taps; max touch " + Math.round(maxTouch) + " ms; real 2-second polling; unchanged 250 ms budgets");
    console.log("WebKit history evidence: " + JSON.stringify({ engine: browser.product,
      device: browser.descriptor, viewport: { name, ...viewports[name] },
      observations: page.historyMotionEvidence.length,
      maxFrameMs: Math.max(...page.historyMotionEvidence.map(row => row.maxFrameGap)),
      maxNativeKeyMs: Math.max(...page.historyMotionEvidence.map(row => row.maxNativeInputMs)),
      maxFocusSetupMs: Math.max(...page.historyMotionEvidence.map(row => row.focusSetupMs)),
      focusAlreadySetCases: page.historyMotionEvidence.filter(row => row.focusWasAlready).length,
      maxNativeTouchMs: maxTouch, trustedTouch: touch, budgetMs: 250 }));
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    if (process.env.DAIKIN_WEBKIT_DIAGNOSTICS === "1")
      console.log("WebKit history diagnostics: " + JSON.stringify({ viewport: name,
        observations: browser.page.historyMotionEvidence, touchDurationsMs: browser.page.touchTimings() }));
    try { await browser.close({ checkDiagnostics: !bodyError }); } finally { await server.close(); }
  }
}
