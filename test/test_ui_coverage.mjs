// V8 block and function coverage gate for critical dashboard, header, and MCP copy logic.
// Uses node:inspector/promises Profiler precise coverage (zero external dependencies) across the
// assembled main/www/app.sources bundle and main/www/mcp_dashboard.js under strict DOM shims.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Session } from "node:inspector/promises";
import { fileURLToPath } from "node:url";
import { readAppSource } from "../tools/ui/read_app_source.mjs";
import { parseJavaScript, SourceMapper } from "../tools/ui/js_ast.mjs";
import { createStrictDocument } from "../tools/ui/strict_dom.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = "daikin-cov://main/www/app.sources";
const MCP_URL = "daikin-cov://main/www/mcp_dashboard.js";

function collectTopFunctionStarts(src, virtualFile) {
  const mapper = SourceMapper.fromTextMap([{ file: virtualFile, content: src, baseLine: 1 }]);
  const ast = parseJavaScript(src, mapper);
  const starts = [];
  for (const stmt of ast.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id?.name) {
      starts.push({ name: stmt.id.name, start: stmt.start });
    }
  }
  starts.sort((a, b) => a.start - b.start);
  const byName = new Map();
  for (let i = 0; i < starts.length; i++) {
    byName.set(starts[i].name, {
      name: starts[i].name,
      start: starts[i].start,
      limit: i + 1 < starts.length ? starts[i + 1].start : src.length,
    });
  }
  return byName;
}

function measureFunctionCoverage(scriptCov, astByName, fnName, sourceText) {
  const spec = astByName.get(fnName);
  assert.ok(spec, `missing AST declaration for ${fnName}`);
  const outer = scriptCov.functions.find((fn) =>
    fn.functionName === fnName &&
    fn.ranges[0]?.startOffset >= spec.start &&
    fn.ranges[0]?.endOffset <= spec.limit
  );
  assert.ok(outer && outer.ranges.length > 0, `V8 coverage missing ${fnName}`);
  const outerStart = outer.ranges[0].startOffset;
  const outerEnd = outer.ranges[0].endOffset;
  assert.ok(outer.ranges[0].count > 0, `${fnName} was never executed`);

  const nested = scriptCov.functions.filter((fn) =>
    fn.ranges[0] &&
    fn.ranges[0].startOffset >= outerStart &&
    fn.ranges[0].endOffset <= outerEnd
  );
  const uncovered = [];
  let totalBytes = 0;
  let uncoveredBytes = 0;
  totalBytes += outerEnd - outerStart;
  for (const fn of nested) {
    for (const r of fn.ranges) {
      if (r.count === 0) {
        uncoveredBytes += r.endOffset - r.startOffset;
        uncovered.push({
          fn: fn.functionName || "(arrow)",
          start: r.startOffset,
          end: r.endOffset,
          snippet: sourceText.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 80)).replace(/\s+/g, " "),
        });
      }
    }
  }
  return { outerStart, outerEnd, totalBytes, uncoveredBytes, uncovered };
}

function summarizeCheckupFloor(scriptCov, astByName, dashboardFnNames) {
  let fnCount = 0;
  let coveredFns = 0;
  let totalBytes = 0;
  let uncoveredBytes = 0;
  for (const name of dashboardFnNames) {
    const spec = astByName.get(name);
    if (!spec) continue;
    const outer = scriptCov.functions.find((fn) =>
      fn.functionName === name &&
      fn.ranges[0]?.startOffset >= spec.start &&
      fn.ranges[0]?.endOffset <= spec.limit
    );
    if (!outer?.ranges?.[0]) continue;
    fnCount++;
    const oStart = outer.ranges[0].startOffset;
    const oEnd = outer.ranges[0].endOffset;
    const len = oEnd - oStart;
    totalBytes += len;
    if (outer.ranges[0].count === 0) {
      uncoveredBytes += len;
      continue;
    }
    coveredFns++;
    const covered = new Uint8Array(len);
    for (const fn of scriptCov.functions) {
      const r0 = fn.ranges[0];
      if (!r0 || r0.startOffset < oStart || r0.endOffset > oEnd) continue;
      for (const r of fn.ranges) {
        const s = Math.max(0, r.startOffset - oStart);
        const e = Math.min(len, r.endOffset - oStart);
        covered.fill(r.count > 0 ? 1 : 0, s, e);
      }
    }
    for (let i = 0; i < len; i++) {
      if (covered[i] === 0) uncoveredBytes++;
    }
  }
  return {
    fnCount,
    coveredFns,
    totalBytes,
    coveredBytes: totalBytes - uncoveredBytes,
    blockRatio: totalBytes ? (totalBytes - uncoveredBytes) / totalBytes : 0,
  };
}

const session = new Session();
session.connect();
let coverageScripts = [];

try {
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

  // 1. Assemble and execute main/www/app.sources across the comprehensive checkup/card/header matrix.
  const rawAppSource = readAppSource().replace(/\nboot\(\);\s*$/, "\n");
  const appAst = collectTopFunctionStarts(rawAppSource, "main/www/app.sources");
  const appErrors = [];
  const appDoc = createStrictDocument("main/www/index.html", {
    dynamicIds: ["e32Chan", "e32Lang", "e32Proto", "e32Rx", "e32Tx"],
  });
  const appCtx = vm.createContext({
    document: appDoc,
    window: {
      scrollTo() {}, open() {}, addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
      innerWidth: 1024, innerHeight: 800,
    },
    history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
    location: { pathname: "/", search: "", hash: "", hostname: "daikin-cov.local", reload() {} },
    navigator: { language: "en-US" },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob, AbortController, Intl,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    console: {
      log() {}, warn() {},
      error: (...args) => { appErrors.push(args.map(String).join(" ")); },
    },
  });

  vm.runInContext(
    `${rawAppSource}
    this.__cov = {
      S, setStatus: (s) => { S.status = s; },
      setLang: (l) => { LANG = l; },
      getCheckupHook: () => checkupCardHtml,
      setCheckupHook: (fn) => { checkupCardHtml = fn; },
      applyStaticI18n, labelSchematicHits, wire,
      renderApp, renderCards, renderHeaderMeta,
      checkupDefrostCheck, checkupFreshDefrostCheck, checkupDefrostInspectorRows,
      checkupMetricValue, checkupValue,
      checkupCardHtml, refrigerantServiceRowHtml, checkupDetailHtml,
      cyclingPeriodDetailsHtml: (scope, from, to) => cyclingPeriodDetailsHtml(_cyclingModels.get(scope), from, to),
      checkupCyclingTimelineHtml,
    };`,
    appCtx,
    { filename: APP_URL },
  );
  const ui = appCtx.__cov;
  ui.applyStaticI18n();
  ui.labelSchematicHits();
  ui.wire();

  // Defrost is selected from the X10A report, with measurements and notes limited to fresh input.
  const observedDefrost = { id: "defrost", verdict: "info", count: 3, defrost_s: 151, run_s: 1000 };
  const defrostStatus = (c = observedDefrost, health = {}, diagnostics = {}) => ({
    diagnostics: { enabled: true, ...diagnostics },
    health: { source: "x10a", source_fresh: true, checks: [{ id: "flow" }, c], ...health },
  });
  for (const status of [
    undefined,
    {},
    { diagnostics: { enabled: true } },
    defrostStatus(observedDefrost, {}, { enabled: false }),
    defrostStatus(observedDefrost, { source: "modbus" }),
    defrostStatus(observedDefrost, { source: undefined }, { effective_source: "modbus" }),
    defrostStatus(observedDefrost, { persist: "unknown" }),
    defrostStatus(observedDefrost, { checks: null }),
    defrostStatus(observedDefrost, { checks: [{ id: "flow" }] }),
  ]) {
    assert.ok(!ui.checkupDefrostCheck(status));
    assert.equal(ui.checkupFreshDefrostCheck(status), null);
    assert.equal(ui.checkupDefrostInspectorRows(status), "");
  }
  for (const status of [
    defrostStatus(),
    defrostStatus(observedDefrost, { source: undefined }),
    defrostStatus(observedDefrost, { source: undefined }, { effective_source: "x10a" }),
  ]) {
    assert.equal(ui.checkupDefrostCheck(status), observedDefrost);
    assert.equal(ui.checkupFreshDefrostCheck(status), observedDefrost);
  }
  for (const [status, statusStale] of [
    [defrostStatus(), true],
    [defrostStatus(observedDefrost, { source_fresh: false }), false],
    [defrostStatus({ ...observedDefrost, reason: "source_stale" }), false],
  ]) {
    assert.ok(ui.checkupDefrostCheck(status), "stale X10A can still identify its historical source");
    assert.equal(ui.checkupFreshDefrostCheck(status, statusStale), null);
    assert.equal(ui.checkupDefrostInspectorRows(status, statusStale), "");
  }
  const valueRow = (label, value) => `<div class="inspect-row"><span>${label}</span><span>${value}</span></div>`;
  for (const [fields, expectedCount, expectedShare] of [
    [{}, "3", "15.1 %"],
    [{ count: 0, defrost_s: 0 }, "0", "0 %"],
    [{ defrost_s: 1 }, "3", "&lt;1 %"],
    [{ defrost_s: 3, run_s: 20 }, "3", "15 %"],
    [{ defrost_s: 12959, run_s: 86393 }, "3", "15.00005 %"],
    [{ count: null }, "—", "15.1 %"],
    [{ count: -1 }, "—", "15.1 %"],
    [{ defrost_s: null }, "3", "—"],
    [{ defrost_s: -1 }, "3", "—"],
    [{ run_s: NaN }, "3", "—"],
    [{ run_s: 0 }, "3", "—"],
    [{ run_s: 1, share_pct: 15 }, "3", "15 %"],
  ]) {
    const html = ui.checkupDefrostInspectorRows(defrostStatus({ ...observedDefrost, ...fields }));
    assert.equal(html, valueRow("Observed defrost starts", expectedCount) + valueRow("Defrost share", expectedShare));
  }
  assert.equal(ui.checkupDefrostInspectorRows(defrostStatus({ id: "defrost", verdict: "collecting" })), "");
  assert.equal(ui.checkupDefrostInspectorRows(defrostStatus({ ...observedDefrost, verdict: "unavailable" })), "");

  // Exercise checkupMetricValue & checkupValue across every switch branch and fallback.
  ui.checkupValue(null);
  for (const c of [
    { id: "cycling", verdict: "unavailable", starts: 1 },
    { id: "cycling", verdict: "collecting", starts: null },
    { id: "cycling", verdict: "ok", starts: 0 },
    { id: "cycling", verdict: "warn", starts: 12 },
    { id: "cycling", verdict: "ok", starts: -1 },
    { id: "dhw_loss", verdict: "collecting", blocked: true, aborts: 1, abort_reasons: ["blind"], best_aborted_s: 300, required_s: 3600 },
    { id: "dhw_loss", verdict: "collecting", blocked: false, windows: 0, required_s: 3600 },
    { id: "dhw_loss", verdict: "collecting", blocked: false, windows: 2, required_s: 3600 },
    { id: "dhw_loss", verdict: "ok", max_k_h: 0.4, windows: 4, high_windows: null },
    { id: "dhw_loss", verdict: "info", max_k_h: 1.1, windows: 4, high_windows: 2 },
    { id: "dhw_loss", verdict: "info", max_k_h: 1.1, windows: 0, high_windows: 1 },
    { id: "pressure", verdict: "warn", min_bar: 0.5 },
    { id: "pressure", verdict: "info", min_bar: 0.8 },
    { id: "pressure", verdict: "ok", current_bar: 1.6, min_bar: 1.5 },
    { id: "pressure", verdict: "ok", current_bar: null, min_bar: 1.4 },
    { id: "pressure", verdict: "ok", current_bar: null, min_bar: NaN },
    { id: "flow", verdict: "ok", min_l_min: 14.5 },
    { id: "flow", verdict: "collecting", min_l_min: null },
    { id: "heater", verdict: "ok", buh_s: 30, bsh_s: 120 },
    { id: "heater", verdict: "ok", buh_s: 0, bsh_s: null },
    { id: "heater", verdict: "ok", buh_s: null, bsh_s: 90 },
    { id: "heater", verdict: "ok", buh_s: null, bsh_s: null },
    { id: "retries", verdict: "info", seen: true },
    { id: "retries", verdict: "ok", seen: false },
    { id: "retries", verdict: "collecting", seen: null },
    { id: "fault", verdict: "unavailable" },
    { id: "fault", verdict: "collecting", active: 1 },
    { id: "fault", verdict: "warn", active: 1 },
    { id: "fault", verdict: "warn", active: 1, latest: { code: "E5", duration_s: 60 } },
    { id: "fault", verdict: "info", active: 1 },
    { id: "fault", verdict: "info", active: 0 },
    { id: "fault", verdict: "info", active: 0, latest: { code: "U4", age_s: 120 } },
    { id: "fault", verdict: "info", active: null },
    { id: "fault", verdict: "ok", active: null },
    { id: "fault", verdict: "ok", active: 0 },
    { id: "unknown_future_id", verdict: "ok" },
  ]) {
    ui.checkupMetricValue(c);
    ui.checkupValue(c);
  }

  // Exercise refrigerantServiceRowHtml across every state, blocker, metric_meta, and limitation branch.
  ui.S.transportUnavailable = "status";
  ui.refrigerantServiceRowHtml();
  ui.S.transportUnavailable = null;
  ui.setStatus(null);
  ui.refrigerantServiceRowHtml();
  for (const bad of [null, "bad", []]) {
    ui.setStatus({ refrigerant_service: bad });
    ui.refrigerantServiceRowHtml();
  }
  for (const srv of [
    { state: "waiting", continuous_s: null, samples: null, blocker: "compressor_not_running" },
    { state: "unsupported", continuous_s: 0, samples: 0, blocker: "unsupported_profile" },
    { state: "future_unknown_state", continuous_s: 0, samples: 0, blocker: "unmapped_blocker_slug" },
    {
      state: "observing", continuous_s: 60, samples: 12, mode: "heating", blocker: null,
      special_phases_known: true, limitations: [],
      metrics: {
        compressor_rps: { min: 20, mean: 30, max: 40 },
        discharge_c: null,
      },
      metric_meta: {
        discharge_c: { samples: 0, source: null },
        eev_command_pls: { samples: 12, source: "selected" },
      },
    },
    {
      state: "limited", continuous_s: 120, samples: 0, mode: "heating",
      special_phases_known: false, limitations: "not-an-array",
      metrics: { discharge_c: { min: 50, mean: 55, max: 60 } },
      metric_meta: { compressor_rps: { samples: 0, source: null } },
    },
    {
      state: "limited", continuous_s: 120, samples: 20, mode: "heating",
      special_phases_known: false,
      limitations: ["special_phases_unavailable", "outdoor_context_incomplete"],
    },
    {
      state: "interrupted", continuous_s: 45, samples: 5, blocker: "poll_gap",
      special_phases_known: false, limitations: ["pressure_sides_incomplete"],
    },
  ]) {
    ui.setStatus({ refrigerant_service: srv, diagnostics: { enabled: true }, hp: { connected: true } });
    ui.refrigerantServiceRowHtml();
  }

  // Exercise renderHeaderMeta across every nullish and IP/version/otaAvail branch.
  ui.S.otaAvail = "";
  ui.S.otaInstalling = false;
  ui.S.imageLease = null;
  ui.setStatus(null);
  ui.renderHeaderMeta();
  ui.S.otaInstalling = true;
  ui.S.imageLease = { version: "9.9.9-lease" };
  ui.S.otaAvail = "9.9.10";
  ui.setStatus({ wifi: {}, net: {} });
  ui.renderHeaderMeta();
  ui.S.otaInstalling = false;
  ui.S.imageLease = null;
  ui.S.otaAvail = "";
  ui.setStatus({ wifi: { ip: "192.0.2.10" }, net: {} });
  ui.renderHeaderMeta();
  ui.setStatus({ wifi: { ip: "192.0.2.10" }, net: { ip: "192.0.2.99" }, version: "1.2.3" });
  ui.renderHeaderMeta();

  // Exercise renderCards across scrub/clickHold, transportUnavailable focus preservation, diagnostics,
  // checkup failure catch isolation, and dashboardCard fallback re-render.
  ui.S.scrub = "pin";
  ui.renderCards(true);
  ui.S.scrub = null;
  ui.S.clickHold = true;
  ui.renderCards(true);
  ui.S.clickHold = false;

  ui.S.dashboardCard = "diagnosis";
  ui.setStatus({
    version: "1.0.0",
    hp: { connected: true, rx: 44, tx: 43, proto: "I" },
    detect: { valid: true, model: "ERGA08EA" },
    diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
    refrigerant_service: { state: "limited", continuous_s: 60, samples: 5, blocker: null },
    health: {
      status: "info", source: "x10a", source_fresh: true, full_span: true, span_s: 86400, covered_s: 86400,
      persist: "fresh",
      checks: [
        { id: "cycling", verdict: "ok", evidence: "measured", starts: 2, observed_s: 86400, required_s: 86400 },
        { id: "defrost", verdict: "info", evidence: "measured", count: 3, paired_count: 3, share_pct: 15,
          outdoor_source: "x10a", outdoor_min_c: -4.5, outdoor_mean_c: -2.0, outdoor_samples: 10 },
        { id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 86400 },
      ],
    },
  });
  ui.S._values = [{ label: "Leaving water temperature before BUH", value: "35.0", unit: "°C" }];
  ui.renderApp();
  const freshDiagnosis = ui.checkupCardHtml();
  assert.match(freshDiagnosis, /data-defrost-inspect/);
  assert.match(freshDiagnosis, />1 note</);
  assert.doesNotMatch(freshDiagnosis, /model:health_defrost/);
  ui.S.status.health.source_fresh = false;
  assert.doesNotMatch(ui.checkupCardHtml(), /data-defrost-inspect|>1 note</,
    "a retained X10A report does not expose or count a current defrost note");
  ui.S.status.health.source_fresh = true;
  // Focus inside refrigerant item while live, then mark transportUnavailable so focus hops to active tab.
  const refBtn = appDoc.getElementById("valueGroups").querySelector('[data-desc="service:refrigerant"]');
  assert.ok(refBtn, "diagnostic render must mount service:refrigerant item");
  refBtn.focus();
  ui.S.transportUnavailable = "status";
  ui.S.clickHold = true;
  ui.renderCards(true); // hides item + moves focus when focused inside item
  ui.renderCards(true); // hits !item.hidden === false branch
  ui.S.clickHold = false;
  ui.S.transportUnavailable = null;
  // Also cover unfocused refrigerant hide path (focused === false).
  appDoc.getElementById("cardBrowser").focus();
  ui.S.status.diagnostics = { enabled: true };
  ui.renderCards(false);
  ui.S.transportUnavailable = "status";
  ui.S.clickHold = true;
  ui.renderCards(true);
  ui.S.clickHold = false;
  ui.S.transportUnavailable = null;

  // Checkup exception isolation + fallback re-render (S.dashboardCard !== card).
  ui.S.dashboardCard = "diagnosis";
  const origCheckup = ui.getCheckupHook();
  ui.setCheckupHook(() => { throw new Error("coverage checkup error"); });
  ui.S.status.diagnostics = { enabled: true };
  ui.renderCards(false);
  ui.setCheckupHook(origCheckup);
  assert.ok(appErrors.some((e) => e.includes("Checkup card render failed")));

  // Diagnostics disabled path + empty dashboard fallback (selected === undefined) + null _values.
  ui.S.status.diagnostics = { enabled: false };
  ui.renderCards(false);
  ui.S.status.hp = { connected: false };
  ui.S.status.detect = { valid: false };
  ui.S._values = null;
  ui.S._modbus = null;
  ui.renderCards(false);

  // Trigger slot.inert = false on renderCards() equal-card branch via inert chart attribute on selected card.
  ui.S.status.hp = { connected: true, rx: 44, tx: 43, proto: "I" };
  ui.S.status.diagnostics = { enabled: true };
  ui.S._values = [{ label: "Leaving water temperature before BUH", value: "35.0", unit: "°C" }];
  ui.S.dashboardCard = "diagnosis";
  ui.renderCards(false);
  const diagCard = appDoc.getElementById("valueGroups").querySelector('[data-dashboard-card="diagnosis"]');
  if (diagCard) {
    const inertSlot = appDoc.createElement("div");
    inertSlot.setAttribute("data-chart", "1");
    inertSlot.setAttribute("inert", "");
    diagCard.appendChild(inertSlot);
    ui.renderCards(false);
  }

  // Additional checkup helpers for regression floor measurement (cycling timeline/details & checkup details).
  ui.setLang("en");
  const timeline = {
    unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400, run_edges: true,
    records: [
      [1, 1],
      [79260, 5], [79260, 2], [79560, 1], [79560, 6],
      [82900, 5], [82900, 3], [83200, 1], [83200, 6],
    ].map(([at, kind]) => at * 8 + kind),
  };
  const cyclingCheck = {
    id: "cycling", verdict: "ok", evidence: "measured", starts: 2, observed_s: 86400, required_s: 86400,
    timeline,
    run_contexts: [
      { at: 79260, mode: "cooling", start_kind: "normal", stop: 79560, stop_kind: "normal", start_lwt_c: 18.0 },
      { at: 82900, mode: "space", start_kind: "normal", stop: 83200, stop_kind: "normal", start_lwt_c: 32.0 },
    ],
  };
  ui.checkupCyclingTimelineHtml(timeline, "cov-scope", cyclingCheck, "x10a");
  ui.cyclingPeriodDetailsHtml("cov-scope", 22, 23);
  ui.checkupDetailHtml(cyclingCheck, true, ui.S.status.health);
  for (const ck of [
    { id: "fault", verdict: "warn", evidence: "manufacturer", active: 1, observed_s: 3600,
      latest: { code: "E5", base_code: "E5", subcode: "", ongoing: true, duration_s: 60 },
      timeline: { unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true,
        episodes: [{ code: "E5", unit: "outdoor", start_s: 3600, end_s: 7200, ongoing: false }],
        segments: [[0, 3600, 1], [3600, 7200, 2]] } },
    { id: "dhw_loss", verdict: "ok", evidence: "measured", max_k_h: 0.7, windows: 4, high_windows: 0,
      observed_s: 86400, required_s: 14400,
      timeline: { unix_s: 1794582660, source: "x10a", windows: [{ end_s: 82800, rate_k_h: 0.7, pump: true, draw: false }] } },
    { id: "pressure", verdict: "info", min_bar: 0.8, current_bar: 1.2, observed_s: 3600, required_s: 3600 },
    { id: "flow", verdict: "ok", min_l_min: 14.0, observed_s: 3600, required_s: 3600,
      hydronic: { confirmed: true, current: true, dated: true, samples: 5, spread_k: { min: 1.5, mean: 2.0, max: 3.0 } } },
    { id: "heater", verdict: "ok", buh_s: 60, bsh_s: 120, buh_observed_s: 3600, bsh_observed_s: 3600, observed_s: 3600,
      context: { confirmed: true, dated: true, coverage_partial: true, restore_pending: false, persistence_pending: true,
        archive_incomplete: false, clock_uncertain: false, storage_loss: false, dropped: 0,
        buh: { supported: true, on_s: 60, union_s: 30, overlap_s: 10, unknown_context_s: 30, unclassified_s: 30,
          readable_s: 3600, saturated: false, quiet_mild_notice: true,
          categories: { emergency: { supported: true, positive_s: 0, evaluable_on_s: 60, positive_samples: 1 },
            error: { supported: false }, silent: { supported: true, positive_s: null, evaluable_on_s: null, positive_samples: null },
            dhw_route: { supported: true, positive_s: 30, evaluable_on_s: 60, positive_samples: 2 } } },
        bsh: { supported: false } } },
    { id: "heater", verdict: "collecting", buh_s: null, bsh_s: null, observed_s: 0,
      context: { confirmed: false, dated: false, coverage_partial: false, restore_pending: true, persistence_pending: false,
        archive_incomplete: true, clock_uncertain: true, storage_loss: true, dropped: 3,
        buh: { supported: true, saturated: true }, bsh: { supported: true, saturated: true } } },
    { id: "retries", verdict: "info", seen: true, observed_s: 3600, required_s: 3600 },
  ]) ui.checkupDetailHtml(ck, true, { source: "x10a", span_s: 86400, source_fresh: true });

  // 2. Execute main/www/mcp_dashboard.js across secure + insecure legacyCopy(true/false) paths.
  const mcpJs = fs.readFileSync(path.join(ROOT, "main/www/mcp_dashboard.js"), "utf8");
  const mcpAst = collectTopFunctionStarts(mcpJs, "main/www/mcp_dashboard.js");
  for (const execResult of [true, false]) {
    const mcpDoc = createStrictDocument("main/www/mcp_dashboard.html");
    const timers = [];
    mcpDoc.execCommand = () => execResult;
    const mcpCtx = vm.createContext({
      document: mcpDoc,
      location: { origin: "http://daikin-cov.local", pathname: "/mcp" },
      navigator: {},
      isSecureContext: false,
      setTimeout: (fn) => { timers.push(fn); return timers.length; },
      clearTimeout() {},
    });
    mcpCtx.window = mcpCtx;
    vm.runInContext(`${mcpJs}\nthis.__legacyCopy = legacyCopy;`, mcpCtx, { filename: MCP_URL });
    const btn = mcpDoc.querySelector('[data-copy="endpoint-url"]');
    await btn.fire("click");
    for (const fn of timers.splice(0)) fn();
    if (execResult) {
      assert.doesNotThrow(() => mcpCtx.__legacyCopy("ok"));
    } else {
      assert.throws(() => mcpCtx.__legacyCopy("fail"), /Copy command was rejected/);
    }
  }

  const taken = await session.post("Profiler.takePreciseCoverage");
  coverageScripts = taken.result || [];
  await session.post("Profiler.stopPreciseCoverage");

  const appCov = coverageScripts.find((s) => s.url === APP_URL);
  const mcpCov = coverageScripts.find((s) => s.url === MCP_URL);
  assert.ok(appCov, "missing V8 ScriptCoverage for app.sources");
  assert.ok(mcpCov, "missing V8 ScriptCoverage for mcp_dashboard.js");

  const targets = [
    ["checkupDefrostShare", appCov, appAst, rawAppSource],
    ["checkupDefrostCheck", appCov, appAst, rawAppSource],
    ["checkupFreshDefrostCheck", appCov, appAst, rawAppSource],
    ["checkupDefrostInspectorRows", appCov, appAst, rawAppSource],
    ["checkupMetricValue", appCov, appAst, rawAppSource],
    ["checkupValue", appCov, appAst, rawAppSource],
    ["refrigerantServiceRowHtml", appCov, appAst, rawAppSource],
    ["renderCards", appCov, appAst, rawAppSource],
    ["renderHeaderMeta", appCov, appAst, rawAppSource],
    ["legacyCopy", mcpCov, mcpAst, mcpJs],
  ];

  const failures = [];
  for (const [name, cov, ast, src] of targets) {
    const res = measureFunctionCoverage(cov, ast, name, src);
    if (res.uncovered.length > 0) failures.push({ name, uncovered: res.uncovered });
  }
  assert.deepEqual(failures, [],
    `expected 100% V8 block/function coverage across all targets: ${JSON.stringify(failures, null, 2)}`);

  const checkupHelpers = [...appAst.keys()].filter((name) =>
    name.startsWith("checkup") || name === "cyclingPeriodDetailsHtml" || name === "refrigerantServiceRowHtml");
  const floor = summarizeCheckupFloor(appCov, appAst, checkupHelpers);
  assert.ok(floor.coveredFns >= 34, `expected >= 34 checkup helpers executed, got ${floor.coveredFns}/${floor.fnCount}`);
  assert.ok(floor.blockRatio >= 0.55,
    `checkup helper V8 block coverage regression: ${(floor.blockRatio * 100).toFixed(1)}% < 55.0%`);

  console.log(`UI V8 coverage passed: ${targets.length}/${targets.length} critical functions 100% block/function covered; ` +
    `checkup floor ${floor.coveredFns}/${floor.fnCount} fns (${(floor.blockRatio * 100).toFixed(1)}% bytes)`);
} finally {
  session.disconnect();
}
