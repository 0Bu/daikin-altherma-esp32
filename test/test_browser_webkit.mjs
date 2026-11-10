import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchWebKit } from "../tools/browser/webkit_browser.mjs";
import { startFixtureServer } from "../tools/browser/fixture_server.mjs";
import { assertHistoryMotion, HISTORY_MOTION_MUTATIONS } from "./test_browser_history_motion.mjs";
import { assertWebKitFlowPaint } from "./test_browser_webkit_paint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageFile = process.env.DAIKIN_BROWSER_PAGE;
if (!pageFile || !fs.statSync(pageFile, { throwIfNoEntry: false })?.isFile())
  throw new Error("DAIKIN_BROWSER_PAGE must name the production-marker-assembled dashboard page");
const mutation = process.env.DAIKIN_BROWSER_MUTATION || "";
if (mutation && ![...HISTORY_MOTION_MUTATIONS, "history-paint-freeze"].includes(mutation))
  throw new Error("unknown WebKit selftest mutation: " + mutation);
const viewports = { "ipad-portrait": { width: 834, height: 1194 },
  "ipad-landscape": { width: 1194, height: 834 } };
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
  try {
    const { page } = browser;
    page.historyMotionEvidence = [];
    await page.navigate(server.url);
    await page.waitFor("typeof S !== 'undefined' && S.status && Array.isArray(S._values) && document.querySelector('#settingsCards .vgroup')");
    await page.evaluate("pollStop(); window.__browserPollSchedule=pollSchedule; pollSchedule=()=>{}; true");
    if (process.argv.includes("--diagnosis-only")) {
      const { assertCyclingChart } = await import("./test_browser_cycling.mjs");
      await assertCyclingChart(page, server, "webkit/" + name + "/diagnosis/cycling");
      assert.deepEqual(page.diagnostics, [], "WebKit cycling diagnosis must emit no browser errors");
      continue;
    }
    if (!mutation || mutation === "history-paint-freeze")
      page.assertFlowPaint = context => assertWebKitFlowPaint(page, context);
    await assertHistoryMotion(page, server, "webkit/" + name + "/history-motion");
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
  } finally {
    if (process.env.DAIKIN_WEBKIT_DIAGNOSTICS === "1")
      console.log("WebKit history diagnostics: " + JSON.stringify({ viewport: name,
        observations: browser.page.historyMotionEvidence, touchDurationsMs: browser.page.touchTimings() }));
    try { await browser.close(); } finally { await server.close(); }
  }
}
