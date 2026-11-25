// Bridge from real C++ http_stream_runtime WIRE JSON payloads into the assembled UI bundle.
// Renders every captured /status, /values, and /history wire frame through app.sources under a
// strict HTML-parsed DOM (tools/ui/strict_dom.mjs) and fails on any thrown error, console.error,
// or missing dashboard/checkup DOM output.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppSource } from "./read_app_source.mjs";
import { createStrictDocument } from "./strict_dom.mjs";

function decodeWires(wires) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const byName = new Map();
  for (const w of wires) {
    if (w.doc !== undefined) {
      byName.set(w.name, w.doc);
    } else if (w.type === "json") {
      byName.set(w.name, JSON.parse(decoder.decode(Buffer.from(w.hex, "hex"))));
    }
  }
  return byName;
}

export function renderWireSnapshots(wires) {
  const wireMap = wires instanceof Map ? wires : decodeWires(wires);
  const consoleErrors = [];
  const doc = createStrictDocument("main/www/index.html");

  const windowObj = {
    scrollTo() {},
    open() {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    innerWidth: 1024,
    innerHeight: 800,
  };
  const context = vm.createContext({
    document: doc,
    window: windowObj,
    history: { state: null, pushState() {}, replaceState() {}, back() {}, forward() {} },
    location: { pathname: "/", search: "", hash: "", hostname: "daikin-wire.local", reload() {} },
    navigator: { language: "en-US" },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }),
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Blob,
    AbortController,
    Intl,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    console: {
      log: () => {},
      warn: () => {},
      error: (...args) => { consoleErrors.push(args.map(String).join(" ")); },
    },
  });

  const appSource = readAppSource().replace(/\nboot\(\);\s*$/, "\n");
  vm.runInContext(
    `${appSource}
    this.__bridge = {
      S, t, wire, applyStaticI18n, labelSchematicHits, syncHistSources, checkupSourceReadyFor,
      renderApp, renderCards, checkupCardHtml, renderInspect, histHtml, histCacheKey,
    };`,
    context,
    { filename: "main/www/app.sources" },
  );
  const ui = context.__bridge;
  ui.applyStaticI18n();
  ui.labelSchematicHits();
  ui.wire();

  const baseStatus = wireMap.get("/status");
  const baseValues = wireMap.get("/values");
  const modbusValues = wireMap.get("modbus-values");
  const lwtHistory = wireMap.get("/history?row=leaving_water");
  const env3History = wireMap.get("retained-env3-history");
  const hhRoomHistory = wireMap.get("retained-homehub-room-history");

  assert.ok(baseStatus && baseValues && modbusValues && lwtHistory,
    "WIRE bridge requires /status, /values, modbus-values, and /history?row=leaving_water");

  const scenarios = [
    { name: "baseline", status: baseStatus, values: baseValues, insp: "lwt", expand: [] },
    {
      name: "status-x10a-defrost-outdoor",
      status: wireMap.get("status-x10a-defrost-outdoor"),
      values: baseValues,
      insp: "defrost",
      expand: [],
    },
    {
      name: "status-modbus-diagnostics",
      status: wireMap.get("status-modbus-diagnostics"),
      values: modbusValues,
      insp: "flow",
      expand: ["model:health_cycling", "model:health_dhw_loss"],
    },
    {
      name: "checkup-persist-unknown",
      status: wireMap.get("checkup-persist-unknown"),
      values: baseValues,
      insp: null,
      expand: ["model:health_cycling"],
    },
    {
      name: "stop-populated",
      status: wireMap.get("stop-populated"),
      values: baseValues,
      insp: null,
      expand: ["model:health_cycling"],
    },
    {
      name: "dhw-x10a",
      status: wireMap.get("dhw-x10a"),
      values: baseValues,
      insp: null,
      expand: ["model:health_dhw_loss"],
    },
    {
      name: "refrigerant-populated",
      status: wireMap.get("refrigerant-populated"),
      values: baseValues,
      insp: null,
      expand: ["service:refrigerant"],
    },
    {
      name: "status-cycling-run-contexts",
      status: wireMap.get("status-cycling-run-contexts"),
      values: baseValues,
      insp: null,
      expand: ["model:health_cycling"],
    },
    {
      name: "secondary-current",
      status: wireMap.get("secondary-current"),
      values: baseValues,
      insp: "flow",
      expand: [],
    },
    {
      name: "retired-status-plain",
      status: wireMap.get("retired-status-plain"),
      values: baseValues,
      insp: "env3",
      expand: [],
    },
    {
      name: "config-unreadable-plain",
      status: wireMap.get("config-unreadable-plain"),
      values: baseValues,
      insp: null,
      expand: [],
    },
    {
      name: "framed-status-redacted",
      status: wireMap.get("framed-status-redacted")?.result,
      values: wireMap.get("framed-values")?.result,
      insp: null,
      expand: [],
    },
  ];

  let renderedBrowserCount = 0;
  for (const sc of scenarios) {
    assert.ok(sc.status, `missing WIRE status for scenario ${sc.name}`);
    assert.ok(sc.values, `missing WIRE values for scenario ${sc.name}`);

    ui.S.status = JSON.parse(JSON.stringify(sc.status));
    ui.S._values = JSON.parse(JSON.stringify(sc.values.values || []));
    ui.S._modbus = JSON.parse(JSON.stringify(sc.values.modbus || []));
    ui.S.descOpen.clear();
    for (const key of sc.expand) ui.S.descOpen.add(key);
    ui.S.insp = sc.insp;
    ui.S.inspSig = null;
    ui.S.inspHistSig = null;
    ui.S.hist.clear();
    ui.syncHistSources();
    ui.S.hist.set(ui.histCacheKey("leaving_water", "x10a"), JSON.parse(JSON.stringify(lwtHistory)));
    if (env3History) ui.S.hist.set(ui.histCacheKey("env3_temperature", "env3"), JSON.parse(JSON.stringify(env3History)));
    if (hhRoomHistory) ui.S.hist.set(ui.histCacheKey("room_temp", "modbus"), JSON.parse(JSON.stringify(hhRoomHistory)));

    ui.renderApp();
    ui.renderCards(false);
    ui.renderInspect();
    const checkupHtml = ui.checkupCardHtml(true);
    const lwtHistHtml = ui.histHtml("leaving_water", "°C", "Leaving water");
    assert.ok(lwtHistHtml.includes("vhist"), `${sc.name}: histHtml must render leaving_water wire trend`);

    const expectsBrowser =
      (sc.status.diagnostics?.enabled === true && ui.checkupSourceReadyFor() && checkupHtml.length > 0) ||
      (ui.S._values.length > 0 && sc.status.hp?.connected === true) ||
      (ui.S._modbus.length > 0 && sc.status.modbus?.enabled === true && sc.status.modbus?.connected === true);
    if (expectsBrowser) {
      renderedBrowserCount++;
      assert.equal(doc.getElementById("cardBrowser").hidden, false,
        `${sc.name}: #cardBrowser must be visible when /values or diagnostics are active`);
      assert.ok(doc.getElementById("valueGroups").innerHTML.length > 0,
        `${sc.name}: #valueGroups must be populated when /values or diagnostics are active`);
    }

    if (sc.name === "status-x10a-defrost-outdoor") {
      const html = doc.getElementById("inspRows").innerHTML;
      const rows = Array.from(html.matchAll(/<div class="inspect-row"><span>([^<]+)<\/span><span>([^<]+)<\/span><\/div>/g),
        ([, name, reading]) => [name, reading]);
      assert.deepEqual(rows, [
        [ui.t("check.defrost.starts_label"), "3"],
        [ui.t("check.defrost.share"), "15.1 %"],
      ], `${sc.name}: the defrost inspector must render only the observed starts and exact runtime share`);
      assert.match(checkupHtml, /data-defrost-inspect/, `${sc.name}: real X10A NOTE must link to the inspector`);
      assert.doesNotMatch(checkupHtml, /model:health_defrost/, `${sc.name}: no duplicate diagnosis disclosure`);
      ui.S.status.health.source_fresh = false;
      ui.renderInspect();
      assert.equal(doc.getElementById("inspRows").innerHTML, "",
        `${sc.name}: a retained X10A report must not render current defrost values`);
      assert.doesNotMatch(ui.checkupCardHtml(true), /data-defrost-inspect/,
        `${sc.name}: a retained X10A report must not link from an active note`);
    }
    if (sc.name === "checkup-persist-unknown") {
      assert.ok(checkupHtml.includes(ui.t("sys.nodata")),
        `${sc.name}: persist=unknown checkupCardHtml must show sys.nodata`);
    }
    if (sc.name === "status-modbus-diagnostics") {
      assert.ok(checkupHtml.includes("Modbus"),
        `${sc.name}: Modbus checkupCardHtml must name Modbus source`);
    }
  }

  assert.ok(renderedBrowserCount >= 2, `expected >= 2 WIRE scenarios to render populated cards, saw ${renderedBrowserCount}`);
  assert.deepEqual(consoleErrors, [], `WIRE snapshot render emitted console.error: ${consoleErrors.join("; ")}`);
  return scenarios.length;
}
