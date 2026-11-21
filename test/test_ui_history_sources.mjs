// Paired schematic measurements and states have two independent 24-hour rings. Execute the production
// browser combiner and renderer so an X10A gap cannot erase a live Modbus sample, and so the second
// line remains visibly attributed instead of becoming an unlabeled near-overlap.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const historySource = fs.readFileSync(new URL("../main/www/js/history.js", import.meta.url), "utf8");
const appState = fs.readFileSync(new URL("../main/www/js/app_state.js", import.meta.url), "utf8");
const firmwareHistory = fs.readFileSync(new URL("../main/history.cpp", import.meta.url), "utf8");
const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
assert.match(style, /\.vhist-state-graph \.vhist-tip \{[^}]*white-space:\s*pre-wrap;/,
  "state tooltips must honor deliberate breaks");
assert.match(style,
  /\.vhist-graph\s*\{[^}]*grid-template-rows:\s*auto 12px auto 24px;/,
  "one readout row and one reserved time axis keep the curve stable");
assert.match(style, /\.vhist-tip\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*3;/,
  "the translucent tooltip must participate in the reserved readout layout");
assert.doesNotMatch(style, /--vhist-tip-space/,
  "tooltip height must never feed back into graph layout");
assert.doesNotMatch(style, /\.vhist-state-graph\s*\{[^}]*padding-top:/,
  "categorical timelines must not reintroduce a larger spacing override");
assert.doesNotMatch(appState, /syncGraphTipSpaces/,
  "a status rebuild must not re-measure a tooltip and shift its plot");
assert.doesNotMatch(historySource, /syncGraphTipSpace|HIST_TIP_GAP_PX/,
  "scrubbing must not contain a hidden tooltip-height-to-layout coupling");
assert.match(style,
  /\.vhist-state-current \{[^}]*border-left:\s*2px solid var\(--card\);/,
  "every categorical track must visibly separate its live observation from completed raster buckets");
// A source fill must never repaint a categorical state lane. That once erased all four Smart-Grid
// modes into a petrol bar that read as 24 h of Boost. Strip comments first so explanatory prose
// cannot accidentally satisfy the absence check.
const cssRules = style.replace(/\/\*[\s\S]*?\*\//g, "");
assert.doesNotMatch(cssRules, /\.vhist-state-on\.mb\b/,
  "no source colour may override a categorical state fill on the HomeHub lane");
const stateFill = (cls) => {
  const rule = cssRules.match(new RegExp(`\\.vhist-state-on\\.${cls}\\b[^{}]*\\{([^}]*)\\}`));
  assert.ok(rule, `${cls} must own a state fill`);
  const bg = rule[1].match(/background:\s*([^;]+);/);
  assert.ok(bg, `${cls} must declare a background`);
  return bg[1].trim();
};
const sgFills = ["sg-free", "sg-forced-off", "sg-recommended", "sg-forced-on"].map(stateFill);
assert.equal(new Set(sgFills).size, 4,
  "each of the four Smart-Grid modes must be distinguishable by its own fill");
assert.match(firmwareHistory,
  /if \(!s_have_bucket\)[\s\S]*?history_completed_samples\(bucket\)[\s\S]*?P\(\)\.ring\)[\s\S]*?reset_with_gaps\(completed\)/m,
  "X10A and board rings must seed the elapsed boot raster even when polling starts late");
assert.match(firmwareHistory,
  /if \(!s_mb_have_bucket\)[\s\S]*?history_completed_samples\(bucket\)[\s\S]*?P\(\)\.mb_ring\)[\s\S]*?reset_with_gaps\(completed\)/m,
  "HomeHub rings must use the same boot-aligned raster when enabled later");
assert.match(firmwareHistory, /void history_record\([^)]*\) \{\s*if \(!s_mtx\) return;\s*if \(!v\) n = 0;/m,
  "an empty X10A sweep must still advance board histories and the shared gap raster");
assert.match(firmwareHistory,
  /void history_record_circulation\(\)[\s\S]*advance_raster_locked\(now_us, bucket\);[\s\S]*fold_circulation_locked\(circulation\);/,
  "the MQTT witness must own a lightweight recorder that advances the common raster without X10A");
const referenceFramesAt = mqtt.indexOf("service_reference_frames(ref_config);");
const circulationHistoryAt = mqtt.indexOf("history_record_circulation();", referenceFramesAt);
const ordinaryPublishAt = mqtt.indexOf("if (gate.publish_cycle)", circulationHistoryAt);
assert.ok(referenceFramesAt >= 0 && circulationHistoryAt > referenceFramesAt &&
  ordinaryPublishAt > circulationHistoryAt,
"circulation history must tick on the independent subscriber path before X10A state publication");

const S = {
  status: { history: {
    rows: [
      { id: "dhw_tank", label: "DHW tank temp. (R5T)" },
      { id: "leaving_water", label: "Leaving water temp. before BUH (R1T)" },
      { id: "return_water", label: "Inlet water temp.(R4T)" },
      { id: "outdoor_air", label: "R1T-Outdoor air temp." },
      { id: "pump_signal", label: "Water pump signal (0:max-100:stop)" },
      { id: "defrost_state", label: "Defrost Operation" },
      { id: "quiet_state", label: "Silent Mode" },
      { id: "bsh_state", label: "BSH" },
      { id: "tank_preheat_state", label: "Tank preheat ON/OFF" },
      { id: "buh_step1", label: "BUH Step1" },
      { id: "buh_step2", label: "BUH Step2" },
      { id: "valve_dhw", label: "3way valve(On:DHW_Off:Space)" },
      { id: "valve_heat", label: "2way valve(On:Heat_Off:Cool)" },
      { id: "water_flow_switch", label: "Water flow switch" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
      { id: "circulation_state", label: "DHW circulation pump" },
    ],
    modbus_rows: [
      { id: "dhw_tank", label: "Domestic Hot Water temperature" },
      { id: "leaving_water", label: "Leaving water temperature" },
      { id: "outdoor_air", label: "Outside air temperature" },
      { id: "quiet_state", label: "Quiet mode operation" },
      { id: "bsh_state", label: "Booster heater run" },
      { id: "valve_dhw", label: "3-way valve" },
      { id: "smart_grid_mode", label: "Smart Grid operation mode" },
      { id: "disinfection_state", label: "Disinfection operation" },
    ],
    env3_rows: [{ id: "temperature", label: "Temperature" }],
  }, ntp: { synced: true } },
  hist: new Map(), histBusy: new Set(), histPin: new Map(), histHidden: new Map(), clickHold: false, scrub: null,
};
let fetched = "";
let fetchedUrls = [];
const defaultHistoryResponse = { dt: 300, unit: "°C", label: "Domestic Hot Water temperature",
  b0: 102, v: [457], held: [] };
let historyResponse = defaultHistoryResponse;
let historyFetchError = false;
function historyReply(url, body) {
  const q = new URL(url, "http://device").searchParams;
  const id = q.get("row");
  return Response.json({ id, source: q.get("source") || (id === "circulation_state" ? "mqtt" : "x10a"),
    epoch: S.status?.history?.epoch, boot_id: S.status?.boot_id, ...body });
}
const labels = {
  "hist.loading": "Verlauf wird geladen…", "hist.err": "Verlauf nicht verfügbar.",
  "hist.none": "Noch keine Messwerte aufgezeichnet.", "hist.title": "Letzte 24 Stunden",
  "hist.now": "jetzt", "hist.nm": "nicht gemessen", "hist.held": "Außeneinheit ruht",
  "hist.retained": "Letzter empfangener Messwert",
  "state.on": "An", "state.off": "Aus",
  "enum.none": "Keine", "enum.heating": "Heizen", "enum.cooling": "Kühlen", "enum.auto": "Auto",
  "enum.no_error": "Kein Fehler", "enum.warning": "Warnung", "enum.fault": "Fehler",
  "mode.stop": "Stopp", "mode.heat": "Heizen", "mode.cool": "Kühlen",
  "mode.dhw": "Warmwasser", "mode.heat_dhw": "Heizen + Warmwasser", "mode.cool_dhw": "Kühlen + Warmwasser",
};
const context = {
  S, LANG: "de", renderApp() {}, renderCards() {}, renderInspect() {}, renderSettings() {},
  esc: (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
  tx: (x) => x.de,
  t: (key, ...args) => {
    const [arg, arg2] = args;
    if (key === "hist.recorded") return `Aufzeichnung · ${arg} h`;
    if (key === "hist.ago") return `vor ${arg} h`;
    if (key === "hist.rel") return `vor ${arg} h`;
    if (key === "hist.gaps") return `${arg} Lücke`;
    if (key === "hist.heldnote") return `${arg} h Stillstand — nicht gemessen`;
    if (key === "hist.aria") return `${arg} — 24-Stunden-Verlauf`;
    if (key === "hist.aria_pinned") return `${arg} — angeheftet`;
    if (key === "hist.duration_min") return `${arg} min`;
    if (key === "hist.duration_h") return `${arg} h`;
    if (key === "hist.duration_hm") return `${arg} h ${arg2} min`;
    if (key === "hist.state_phase_run") return `${arg}\n${arg2} · ca. ${args[2]}`;
    if (key === "hist.state_active") return "Aktiv";
    if (key === "hist.state_off") return "Aus";
    if (key === "hist.modbus_plateau") return `Register unverändert ${arg} · ca. ${arg2} · Messalter unbekannt`;
    if (key === "hist.boost_total") return `Boost aktiv · ${arg}`;
    if (key === "hist.boost_none") return "Kein Boost im aufgezeichneten Zeitraum.";
    if (key === "hist.boost_ago_range") return `vor ${arg}–${arg2} h`;
    if (key === "hist.boost_active") return "Boost aktiv";
    if (key === "hist.boost_inactive") return "Boost aus";
    if (key === "hist.boost_aria") return `${arg} — Boost-Verlauf. ${arg2}`;
    if (key === "hist.defrost_total") return `Abtauen aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.defrost_none") return "Kein Abtauvorgang erfasst.";
    if (key === "hist.defrost_active") return "Abtauen aktiv";
    if (key === "hist.defrost_inactive") return "Abtauen aus";
    if (key === "hist.defrost_aria") return `${arg} — Abtauverlauf. ${arg2}`;
    if (key === "hist.quiet_total") return `Leise-Modus aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.quiet_none") return "Kein Leise-Modus erfasst.";
    if (key === "hist.quiet_active") return "Leise-Modus aktiv";
    if (key === "hist.quiet_inactive") return "Leise-Modus aus";
    if (key === "hist.quiet_aria") return `${arg} — Verlauf des Leise-Modus. ${arg2}`;
    if (key === "hist.heater_total") return `Heizstab aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.heater_none") return "Kein Heizstabeinsatz erfasst.";
    if (key === "hist.heater_active") return "Heizstab aktiv";
    if (key === "hist.heater_inactive") return "Heizstab aus";
    if (key === "hist.heater_aria") return `${arg} — Heizstab-Verlauf. ${arg2}`;
    if (key === "hist.preheat_total") return `Speichervorheizung aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.preheat_none") return "Keine Speichervorheizung erfasst.";
    if (key === "hist.preheat_active") return "Speichervorheizung aktiv";
    if (key === "hist.preheat_inactive") return "Speichervorheizung aus";
    if (key === "hist.preheat_aria") return `${arg} — X10A-Vorheizverlauf. ${arg2}`;
    if (key === "hist.disinfection_total") return `Desinfektion aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.disinfection_none") return "Keine Speicherdesinfektion erfasst.";
    if (key === "hist.disinfection_active") return "Desinfektion aktiv";
    if (key === "hist.disinfection_inactive") return "Desinfektion aus";
    if (key === "hist.disinfection_aria") return `${arg} — HomeHub-Desinfektionsverlauf. ${arg2}`;
    if (key === "hist.buh_total") return `Zusatzheizer aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.buh_none") return "Kein Zusatzheizereinsatz erfasst.";
    if (key === "hist.buh_active") return "Zusatzheizer aktiv";
    if (key === "hist.buh_inactive") return "Zusatzheizer aus";
    if (key === "hist.buh_step1") return "Stufe 1";
    if (key === "hist.buh_step2") return "Stufe 2";
    if (key === "hist.buh_aria") return `${arg} — Zusatzheizer-Verlauf. ${arg2}`;
    if (key === "hist.valve_dhw_total") return `Warmwasser · ${arg}`;
    if (key === "hist.valve_space_total") return `Raumkreis · ${arg}`;
    if (key === "hist.valve_none") return "Keine Warmwasserstellung erfasst.";
    if (key === "hist.valve_dhw") return "Warmwasser";
    if (key === "hist.valve_space") return "Raumkreis";
    if (key === "hist.valve_aria") return `${arg} — 3-Wege-Ventil-Verlauf. ${arg2}`;
    if (key === "hist.circ_total") return `Pumpe laufend erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.circ_none") return "Kein Pumpenlauf erfasst.";
    if (key === "hist.circ_on") return "Läuft";
    if (key === "hist.circ_off") return "Steht";
    if (key === "hist.circ_unavailable") return "Nicht verfügbar";
    if (key === "hist.circ_gaps") return `${arg} Phase · nicht verfügbar`;
    if (key === "hist.circ_aria") return `${arg} — Zirkulationsverlauf. ${arg2}`;
    if (key === "hist.valve2_on_total") return `2WV-Ausgang An · ${arg}`;
    if (key === "hist.valve2_off_total") return `2WV-Ausgang Aus · ${arg}`;
    if (key === "hist.valve2_none") return "Kein An-Zustand des 2WV-Ausgangs erfasst.";
    if (key === "hist.valve2_on") return "2WV-Ausgang An";
    if (key === "hist.valve2_off") return "2WV-Ausgang Aus";
    if (key === "hist.valve2_aria") return `${arg} — Verlauf des 2WV-Ausgangs. ${arg2}`;
    if (key.startsWith("sg.mode")) return ["Freier Betrieb", "Zwangsabschaltung", "Empfehlung ein", "Erzwungen ein"][+key.at(-1)];
    if (key === "hist.comp_total") return `Verdichter aktiv erfasst · ${arg} · ${arg2} Phasen im 5-Minuten-Raster`;
    if (key === "hist.comp_none") return "Kein Verdichterlauf erfasst.";
    if (key === "hist.comp_active") return "Verdichter aktiv";
    if (key === "hist.comp_inactive") return "Verdichter aus";
    if (key === "hist.comp_aria") return `${arg} — Verdichterverlauf. ${arg2}`;
    if (key === "hist.mb_defrost_total") return `Abtauen aktiv erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.mb_defrost_none") return "Kein Abtauvorgang erfasst.";
    if (key === "hist.mb_defrost_active") return "Abtauen aktiv";
    if (key === "hist.mb_defrost_inactive") return "Abtauen aus";
    if (key === "hist.mb_defrost_aria") return `${arg} — HomeHub-Abtauverlauf. ${arg2}`;
    if (key === "hist.pump_total") return `Umwälzpumpe laufend erfasst · ${arg} im 5-Minuten-Raster`;
    if (key === "hist.pump_none") return "Kein Pumpenlauf erfasst.";
    if (key === "hist.pump_active") return "Läuft";
    if (key === "hist.pump_inactive") return "Steht";
    if (key === "hist.pump_aria") return `${arg} — Umwälzpumpenverlauf. ${arg2}`;
    return labels[key] || key;
  },
  fetch: async (url) => {
    fetched = url;
    fetchedUrls.push(url);
    if (historyFetchError) throw new Error("temporary reboot window");
    return historyReply(url, historyResponse);
  },
  setTimeout, clearTimeout, Date, Map, Set, TextDecoder, console,
  POLL_TIMEOUT_MS: 6000,
};
vm.createContext(context);
const lifecycleSource = appState.slice(appState.indexOf("// ── History source lifecycle"),
  appState.indexOf("// ── Navigation (dashboard ⇄ Settings)"));
vm.runInContext(lifecycleSource + readAppFragments(["history.js"]) +
  "\nthis.__api = { t, hasHist, hasModbusHist, hasRoomHist, histCacheKey, historyView, histHtml, env3HistHtml, scrubText, histReadout, histVisibleSeries," +
  " histTipsHtml, scrubMove, scrubIndex, histPinToggle, histPinIndex, expireLiveHistoryPins, expiredHistSlots, readHistoryJson, histViewRevision, histSeriesToggle, ensureHist, ensureHistPair, ensureDerived, DERIVED, syncHistSources, invalidateHistSources };", context,
  { filename: "main/www/js/history.js" });
const h = context.__api;
{
  const stream = (chunks) => {
    const seen = { cancelled: false, released: false };
    return { seen, response: { body: { getReader: () => ({
      read: async () => chunks.length ? { value: chunks.shift(), done: false } : { done: true },
      cancel: async () => { seen.cancelled = true; },
      releaseLock: () => { seen.released = true; },
    }) } } };
  };
  const valid = stream([new TextEncoder().encode('{"v":[1]}')]);
  assert.equal((await h.readHistoryJson(valid.response)).v[0], 1);
  assert.equal(valid.seen.released, true);
  const oversized = stream([new Uint8Array(3000), new Uint8Array(2000)]);
  await assert.rejects(h.readHistoryJson(oversized.response), /wire budget/);
  assert.deepEqual(oversized.seen, { cancelled: true, released: true });
}

const x10a = { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
                held: [], v: [452, null, 454] };
const modbus = { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
                 held: [], v: [453, 455, 456] };
{
  const uptime = S.status.uptime_s;
  let clock = 0;
  context.historyClock = () => clock;
  const full = { ...x10a, v: Array(288).fill(457), receivedTick: clock };
  S.statusReceivedAt = clock;
  S.status.uptime_s = (full.b0 + 289) * full.dt - 1;
  assert.equal(h.expiredHistSlots(full), 0);
  clock += 1000;
  assert.equal(h.expiredHistSlots(full), 1);
  clock += 300000;
  assert.equal(h.expiredHistSlots(full), 2,
    "the last accepted status advances on the browser monotonic clock even without fresh replies");
  S.statusReceivedAt = clock;
  S.status.uptime_s = (full.b0 + 290) * full.dt - 1;
  assert.equal(h.expiredHistSlots(full), 2,
    "a delayed boot-clock reply cannot revive an expired bucket in the same ring");
  S.status.uptime_s = uptime;
  delete S.statusReceivedAt;
  delete context.historyClock;
}
S.hist.set("dhw_tank", x10a);
S.hist.set("modbus:dhw_tank", modbus);

{
  const dated = { t0: 1768720000 };
  S.hist.set("dhw_tank", { ...x10a, ...dated });
  S.hist.set("modbus:dhw_tank", { ...modbus, b0: null, t0: null });
  assert.equal(h.historyView("dhw_tank").separate, undefined,
    "paired sources always share one chart");
  assert.equal(h.historyView("dhw_tank").t0, null,
    "a relative overlay does not stamp one instrument's wall clock onto an unanchored peer");
  assert.equal(h.historyView("dhw_tank", "x10a").t0, dated.t0,
    "the dated instrument keeps its own clock in a source-scoped view");
  S.hist.set("dhw_tank", x10a);
  S.hist.set("modbus:dhw_tank", { ...modbus, b0: null, t0: dated.t0 + 3600 });
  assert.deepEqual(Array.from(h.historyView("dhw_tank").series, s => s.source), ["x10a", "modbus"],
    "boot-only and wall-only records still share one chart on a relative axis");
  assert.equal(h.historyView("dhw_tank").t0, null);
  const combined = h.histHtml("dhw_tank", "", "Tank");
  assert.equal((combined.match(/data-hist="dhw_tank"/g) || []).length, 1,
    "paired sources must render in one shared plot");
  assert.match(combined, /data-hist-series="x10a" aria-pressed="true"/);
  assert.match(combined, /data-hist-series="modbus" aria-pressed="true"/);
  assert.doesNotMatch(combined, /data-hist-series="(?:x10a|modbus)" aria-pressed="true" disabled/);
  assert.equal(h.historyView("dhw_tank", "modbus").t0, dated.t0 + 3600);
  S.hist.set("dhw_tank", { ...x10a, b0: null, ...dated });
  S.hist.set("modbus:dhw_tank", { ...modbus, b0: null, t0: dated.t0 + 300 });
  const wallAligned = h.historyView("dhw_tank");
  assert.equal(wallAligned.separate, undefined);
  assert.equal(wallAligned.t0, dated.t0);
  assert.deepEqual(Array.from(wallAligned.series[0].v), [452, null, 454, null]);
  assert.deepEqual(Array.from(wallAligned.series[1].v), [null, 453, 455, 456]);
  S.hist.set("dhw_tank", { ...x10a, b0: -2, ...dated, v: [...x10a.v] });
  S.hist.set("modbus:dhw_tank", { ...modbus, b0: -1, t0: dated.t0 + 307, v: [...modbus.v] });
  const prebootAligned = h.historyView("dhw_tank");
  assert.equal(prebootAligned.separate, undefined,
    "restored pre-boot series must remain together in one chart");
  assert.equal(prebootAligned.b0, -2);
  assert.deepEqual(Array.from(prebootAligned.series[0].v), [452, null, 454, null]);
  assert.deepEqual(Array.from(prebootAligned.series[1].v), [null, 453, 455, 456]);
  assert.deepEqual(Array.from(h.historyView("dhw_tank", "modbus").v), modbus.v);
  const savedUptime = S.status.uptime_s;
  S.status.uptime_s = 86400;
  const currentBoot = h.historyView("dhw_tank");
  assert.equal(currentBoot.b0, 0, "an expired preboot tail keeps the common current-boot axis");
  assert.deepEqual(Array.from(currentBoot.series[0].v), [454, null]);
  assert.deepEqual(Array.from(currentBoot.series[1].v), [455, 456]);
  const savedNtp = S.status.ntp;
  const now = 1768820000;
  S.status.ntp = { synced: true, time: new Date(now * 1000).toISOString() };
  assert.equal(h.historyView("dhw_tank").t0, null,
    "two retained clocks cannot label the aligned data after a correction");
  S.transportUnavailable = "status";
  assert.equal(h.historyView("dhw_tank").t0, null,
    "status transport loss cannot revive a wall label already contradicted by the accepted clock");
  delete S.transportUnavailable;
  S.hist.set("modbus:dhw_tank", { ...S.hist.get("modbus:dhw_tank"), t0: now - 86400 });
  assert.equal(h.historyView("dhw_tank").t0, now - 86400 + 300,
    "the refreshed HomeHub clock labels the common current-boot axis");
  S.status.ntp = savedNtp;
  S.status.uptime_s = savedUptime;
  S.hist.set("dhw_tank", { ...x10a, ...dated });
  S.hist.set("modbus:dhw_tank", { ...modbus, ...dated });
  h.histPinToggle("dhw_tank", 0, "x10a");
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "modbus")), -1,
    "a Modbus-only plot cannot substitute its reading for an X10A pin at the same bucket");
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 0,
    "rendering the unrelated plot cannot remove the X10A pin");
  S.histPin.delete("dhw_tank");

  h.histSeriesToggle("dhw_tank", "modbus");
  h.histPinToggle("dhw_tank", 0);
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 0,
    "the combined plot shares a pin when both plots show the pinned instrument");
  h.histSeriesToggle("dhw_tank", "modbus");
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), 0,
    "showing an additional instrument preserves the original evidence");
  h.histSeriesToggle("dhw_tank", "x10a");
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), -1,
    "hiding the pinned instrument cannot leave a pin on its peer's measurement");
  assert.equal(S.histPin.has("dhw_tank"), false);

  S.histHidden.delete("dhw_tank");
  S.hist.set("modbus:dhw_tank", { ...modbus, ...dated, v: [null, 455, 456] });
  h.histPinToggle("dhw_tank", 0);
  S.hist.set("modbus:dhw_tank", { ...modbus, ...dated });
  S.status.hp = { connected: false };
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), -1,
    "failover to HomeHub cannot render an X10A-only pin against different readings");
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 0,
    "the X10A inspector can still show the original recorded reading");
  delete S.status.hp;
  S.histPin.delete("dhw_tank");

  S.hist.set("modbus:dhw_tank", { ...modbus, ...dated, v: [null, 455, 456] });
  h.histPinToggle("dhw_tank", 0);
  S.hist.set("modbus:dhw_tank", { ...modbus, ...dated });
  S.hist.set("dhw_tank", { ...x10a, b0: x10a.b0 + 1, t0: dated.t0 + 300 });
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), -1,
    "a peer retaining the bucket cannot keep an original measurement that rolled out");
  assert.equal(S.histPin.has("dhw_tank"), false);

  S.hist.set("dhw_tank", x10a);
  S.hist.set("modbus:dhw_tank", modbus);
}

{
  const priorRows = S.status.history.env3_rows;
  const temp = "env3_temperature", humidity = "env3_humidity";
  S.status.history.env3_rows = [temp, humidity].map(id => ({ id }));
  S.hist.set("env3:" + temp, { ...x10a, b0: -3, t0: 1768720000 });
  S.hist.set("env3:" + humidity, { ...x10a, b0: null, t0: 1768720150, v: [630, 640, 650] });
  const html = h.env3HistHtml();
  assert.match(html, /data-hist="env3_combined"/,
    "ENV III series remain together in one combined plot");
  assert.match(html, /env-temperature/);
  assert.match(html, /env-humidity/);
  S.status.history.env3_rows = priorRows;
  S.hist.delete("env3:" + temp);
  S.hist.delete("env3:" + humidity);
}

{
  S.hist.set("dhw_tank", { ...x10a, at: 0, v: [] });
  S.hist.set("modbus:dhw_tank", { ...modbus, v: [] });
  assert.match(h.histHtml("dhw_tank", "", "Tank"), /Noch keine Messwerte aufgezeichnet/);
  historyFetchError = true;
  await h.ensureHist("dhw_tank");
  assert.match(h.histHtml("dhw_tank", "", "Tank"), /Verlauf nicht verfügbar/,
    "a successful empty peer cannot conceal a failed refresh of an earlier empty response");
  S.hist.set("modbus:dhw_tank", modbus);
  assert.match(h.histHtml("dhw_tank", "", "Tank"), /X10A · Verlauf nicht verfügbar/,
    "a failed source is identified while its independent peer plots");
  S.hist.set("dhw_tank", { ...x10a, at: 0, v: [452, null, null] });
  await h.ensureHist("dhw_tank");
  const retained = h.histHtml("dhw_tank", "", "Tank");
  assert.match(retained, /vhist-retained[^>]*aria-label="X10A · Letzter empfangener Messwert"[^>]*left:0\.000%/,
    "the last received marker points at the measurement before the trailing gaps");
  assert.doesNotMatch(retained.slice(retained.indexOf('vhist-legend'), retained.indexOf('vhist-graph')),
    /Letzter empfangener Messwert/,
    "source legend keeps short names and relies on the graphical retained ring marker");
  assert.doesNotMatch(h.histHtml("dhw_tank", "", "Tank", "x10a"), /vhist-legend/,
    "single-source retained X10A chart omits an unneeded legend");
  h.histSeriesToggle("dhw_tank", "modbus");
  const retainedOnly = h.histHtml("dhw_tank", "", "Tank");
  assert.match(retainedOnly, /<div class="vhist-axis"><span><\/span><span><\/span><\/div>/,
    "an undated retained chart does not repeat Aufzeichnung or claim jetzt on the axis");
  S.hist.set("dhw_tank", { ...S.hist.get("dhw_tank"), t0: 1768720000 });
  const retainedDated = h.histHtml("dhw_tank", "", "Tank", "x10a");
  assert.match(retainedDated, /<div class="vhist-axis"><span>\d{2}:\d{2}<\/span><span>\d{2}:\d{2}<\/span><\/div>/,
    "a dated multi-slot retained chart shows wall-clock bounds instead of repeating Aufzeichnung or claiming jetzt");
  S.hist.set("dhw_tank", { ...S.hist.get("dhw_tank"), t0: null });
  const retainedView = h.historyView("dhw_tank");
  assert.match(h.scrubText(retainedView, 0), /^Letzter empfangener Messwert · /,
    "an undated cursor uses the last sample of the visible retained curve");
  assert.doesNotMatch(h.scrubText(retainedView, 2), /jetzt/,
    "the last slot cannot borrow freshness from a hidden curve");
  assert.equal(h.histReadout(retainedView, 2), "",
    "an empty retained slot hides the tooltip bubble instead of showing missing prose");
  S.histHidden.delete("dhw_tank");
  const recentStatus = S.status.uptime_s;
  S.hist.set("dhw_tank", { ...S.hist.get("dhw_tank"), t0: 1768720000 });
  h.histPinToggle("dhw_tank", 0, "x10a");
  assert.match(h.histHtml("dhw_tank", "", "Tank", "x10a"), /vhist-cross vhist-pinned/);
  S.status.uptime_s = (x10a.b0 + 289) * 300;
  S.hist.set("dhw_tank", { ...S.hist.get("dhw_tank"), v: [452, 454, null] });
  assert.doesNotMatch(h.histHtml("dhw_tank", "", "Tank", "x10a"), /vhist-cross vhist-pinned/,
    "a dated pin cannot remain on an expired slot while newer compatible history stays visible");
  assert.equal(S.histPin.has("dhw_tank"), false, "a retired pin must not return after the next refresh");
  S.status.uptime_s = recentStatus;
  S.hist.set("dhw_tank", { ...x10a, t0: 1768720000 });
  h.histPinToggle("dhw_tank", 1, "x10a");
  S.hist.set("dhw_tank", { ...x10a, t0: 1768720310 });
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 1,
    "a corrected clock cannot move a pin away from the same boot-relative bucket");
  S.histPin.delete("dhw_tank");
  S.hist.set("dhw_tank", x10a);
  h.histPinToggle("dhw_tank", 2, "x10a");
  S.hist.set("dhw_tank", { ...x10a, b0: x10a.b0 + 1, t0: 1768720000,
    gen: x10a.gen + 1, v: [null, 454, 455] });
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 1,
    "a boot-relative pin survives the first clock sync and a one-slot roll");
  S.histPin.delete("dhw_tank");

  const restoredRing = { ...x10a, b0: null, t0: 1768720000, v: [452, 453, 454] };
  S.hist.set("dhw_tank", restoredRing);
  h.histPinToggle("dhw_tank", 1, "x10a");
  S.hist.set("dhw_tank", { ...restoredRing, refreshFailed: true });
  assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), 1,
    "a refused refresh can retain the unchanged dated sample and pin together");
  for (const shift of [300, 306]) {
    S.hist.set("dhw_tank", { ...restoredRing, t0: restoredRing.t0 + shift,
      gen: restoredRing.gen + 1, v: [453, 454, 455] });
    assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank", "x10a")), -1,
      "an unverified wall-clock shift cannot transfer a pin to a different measurement");
  }
  S.histPin.delete("dhw_tank");
  S.hist.set("dhw_tank", { ...x10a, t0: 1768720310 });

  S.status.uptime_s = (x10a.b0 + 290) * 300;
  S.hist.set("dhw_tank", { ...S.hist.get("dhw_tank"), refreshFailed: true, v: [452, null, null] });
  assert.match(h.histHtml("dhw_tank", "", "Tank", "x10a"), /Verlauf nicht verfügbar/,
    "the latest retry cannot keep an already old monotonic sample in view");
  S.status.uptime_s = recentStatus;
  const legacy = { ...x10a, v: [...x10a.v], b0: null, t0: null, refreshFailed: true,
    at: Date.now(), receivedAt: Date.now() - 25 * 3600000 };
  S.hist.set("dhw_tank", legacy);
  assert.match(h.histHtml("dhw_tank", "", "Tank", "x10a"), /Verlauf nicht verfügbar/,
    "legacy history ages from receipt even when there is no clock or bucket");
  S.hist.set("dhw_tank", { ...legacy, refreshFailed: false });
  assert.match(h.histHtml("dhw_tank", "", "Tank", "x10a"), /nicht gemessen/,
    "old successful replies still age out when automatic refresh stops before a fetch fails");
  historyFetchError = false;
  S.histHidden.delete("dhw_tank");
  S.hist.set("dhw_tank", x10a);
}

assert.equal(h.hasHist("dhw_tank"), true);
assert.equal(h.hasModbusHist("dhw_tank"), true);
assert.equal(h.histCacheKey("dhw_tank", "modbus"), "modbus:dhw_tank");
{
  const old = historyResponse;
  for (const invalid of [
    { source: "x10a", v: [457] }, { id: "outdoor_air", v: [457] },
    { id: null }, { source: null }, { dt: 86400 }, { b0: Number.MAX_SAFE_INTEGER },
    { label: "x".repeat(80) }, { unit: "x".repeat(8) },
    { v: ["457"] }, { v: [-32768] }, { v: Array(289).fill(457) },
    { dt: -3 }, { b0: -1 }, { t0: "now" }, { held: [null] }, { held: [[0, 1]] },
    { held: [[0, 1]], v: [null, 457] },
  ]) {
    S.hist.delete("modbus:dhw_tank");
    historyResponse = { ...defaultHistoryResponse, ...invalid };
    await h.ensureHist("dhw_tank", "modbus");
    assert.equal(S.hist.get("modbus:dhw_tank").err, true, "invalid history cannot enter a source-labelled view");
  }
  historyResponse = old;
  S.hist.set("modbus:dhw_tank", modbus);
  const uptime = S.status.uptime_s;
  S.status.uptime_s = 32000;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...defaultHistoryResponse, b0: 1000000000 };
  await h.ensureHist("dhw_tank", "modbus");
  assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), modbus.v,
    "an impossible boot-relative bucket must preserve the compatible ring");
  assert.equal(S.hist.get("modbus:dhw_tank").refreshFailed, true);
  S.status.uptime_s = 600;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...defaultHistoryResponse, b0: 2 };
  await h.ensureHist("dhw_tank", "modbus");
  assert.equal(S.hist.get("modbus:dhw_tank").refreshFailed, true,
    "the currently open bucket is unavailable as a completed measurement");
  S.status.uptime_s = 294;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...defaultHistoryResponse, b0: undefined, boot_b0: -1, v: [523, 524] };
  await h.ensureHist("dhw_tank", "modbus");
  assert.equal(S.hist.get("modbus:dhw_tank").refreshFailed, true,
    "the request timeout is not evidence that a partially elapsed bucket completed");
  context.historyClock = () => 5500;
  S.statusRequestedAt = 0;
  S.statusReceivedAt = 5500;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  await h.ensureHist("dhw_tank", "modbus");
  assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), [523, 524],
    "a delayed accepted status reply must allow the newly completed bucket");
  delete context.historyClock;
  delete S.statusRequestedAt;
  delete S.statusReceivedAt;
  S.status.uptime_s = 32000;
  const ntp = S.status.ntp;
  const time = 1768720600;
  S.status.ntp = { synced: true, time: new Date(time * 1000).toISOString() };
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...defaultHistoryResponse, b0: undefined, t0: 4102444800, v: [520] };
  await h.ensureHist("dhw_tank", "modbus");
  assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), modbus.v,
    "a future wall-clock-only reply must preserve the compatible ring");
  assert.equal(S.hist.get("modbus:dhw_tank").refreshFailed, true);
  for (const t0 of [4102444800, time - 3600]) {
    S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
    historyResponse = { ...historyResponse, b0: 102, t0 };
    await h.ensureHist("dhw_tank", "modbus");
    assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), [520],
      "an observed boot bucket can preserve the sample after a wall-clock step");
    assert.equal(S.hist.get("modbus:dhw_tank").t0, null,
      "a discrepant wall clock cannot label the sample, even within the accepted day");
  }
  const matchingWallTime = time - 32000 + 103 * 300;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...historyResponse, t0: matchingWallTime };
  await h.ensureHist("dhw_tank", "modbus");
  assert.equal(S.hist.get("modbus:dhw_tank").t0, matchingWallTime,
    "the timestamp is displayed when it agrees with the status clock and completed bucket");
  S.hist.delete("modbus:dhw_tank");
  historyResponse = { ...historyResponse, b0: undefined, t0: time - 300 };
  await h.ensureHist("dhw_tank", "modbus");
  assert.equal(S.hist.get("modbus:dhw_tank").t0, time - 300,
    "a time-only reply within the device window can restore history predating boot");
  const pastDay = time - 288 * 300 - 60;
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  historyResponse = { ...historyResponse, t0: pastDay, v: [520] };
  await h.ensureHist("dhw_tank", "modbus");
  assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), modbus.v,
    "a wall-only sample just beyond the rolling day cannot replace an accepted ring");
  assert.equal(S.hist.get("modbus:dhw_tank").refreshFailed, true);
  assert.equal(h.expiredHistSlots({ ...x10a, b0: null, t0: pastDay, v: [450] }), 1,
    "cached restored samples expire by their own anchor even off the UTC raster boundary");
  const oldReceivedAt = S.statusReceivedAt;
  let tick = 0;
  context.historyClock = () => tick;
  S.statusReceivedAt = tick;
  S.hist.delete("modbus:dhw_tank");
  historyResponse = { ...historyResponse, t0: time + 6 - 287 * 300, v: Array(288).fill(520) };
  await h.ensureHist("dhw_tank", "modbus");
  const almostDay = S.hist.get("modbus:dhw_tank");
  assert.equal(almostDay.t0, historyResponse.t0, "the newest sample is within the poll tolerance");
  S.status.ntp = { synced: false, time: null };
  tick = 300000;
  assert.equal(h.expiredHistSlots(almostDay), 0,
    "receipt plus five minutes cannot drop a sample still inside the wall-clock day");
  tick += 6000;
  assert.equal(h.expiredHistSlots(almostDay), 0, "the 24-hour wall boundary is inclusive");
  tick += 1000;
  assert.equal(h.expiredHistSlots(almostDay), 1, "the accepted device clock advances without new status");
  delete context.historyClock;
  S.statusReceivedAt = oldReceivedAt;
  S.status.ntp = { synced: true, time: new Date(time * 1000).toISOString() };
  historyResponse = { ...historyResponse, t0: time - 300 };
  S.hist.set("modbus:dhw_tank", { ...modbus, at: 0 });
  S.status.ntp = { synced: false, time: null };
  await h.ensureHist("dhw_tank", "modbus");
  assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), modbus.v,
    "an unverified wall anchor cannot displace the last compatible ring");
  S.status.ntp = { synced: true, time: new Date(time * 1000).toISOString() };
  const ageing = { ...x10a, b0: null, t0: time - 289 * 300, v: [450, 451, 452] };
  assert.ok(h.expiredHistSlots(ageing) > 0);
  S.transportUnavailable = "status";
  assert.ok(h.expiredHistSlots(ageing) > 0,
    "a transient status refusal cannot put expired wall-clock samples back on screen");
  assert.ok(h.expiredHistSlots({ ...ageing, v: [453] }) > 0,
    "an elapsed wall-clock ring is also refused on its first use during a status refusal");
  delete S.transportUnavailable;
  S.status.ntp = { synced: true, time: new Date((time - 1200) * 1000).toISOString() };
  assert.ok(h.expiredHistSlots({ ...ageing, refreshFailed: true }) > 0,
    "a backward clock correction cannot revive expired readings in the same cached ring");
  S.status.ntp = { synced: true, time: new Date(time * 1000).toISOString() };
  S.hist.set("dhw_tank", { ...x10a, t0: time - 600 });
  h.histPinToggle("dhw_tank", 0, "x10a");
  S.hist.set("modbus:dhw_tank", { ...ageing, b0: null, v: [515], refreshFailed: true });
  const mixed = h.historyView("dhw_tank");
  assert.equal(mixed.b0, x10a.b0,
    "a fully expired wall-only peer cannot replace a surviving boot-clock axis");
  assert.equal(h.histPinIndex("dhw_tank", mixed), 0,
    "an expired peer cannot hide a valid boot-bucket pin");
  assert.deepEqual(Array.from(mixed.unavailable, s => s.source), ["modbus"]);
  S.histPin.delete("dhw_tank");
  S.hist.set("dhw_tank", x10a);
  S.status.ntp = ntp;
  S.status.uptime_s = uptime;
  historyResponse = old;
  S.hist.set("modbus:dhw_tank", modbus);
}
let view = h.historyView("dhw_tank");
const mountedTank = {
  dataset: { hist: "dhw_tank", n: String(view.v.length), rev: h.histViewRevision(view) },
  getBoundingClientRect: () => ({ left: 0, width: 100 }),
};
assert.equal(h.scrubIndex(mountedTank, 0), 0, "the mounted ring can resolve its own first sample");
S.hist.set("dhw_tank", { ...x10a, b0: x10a.b0 + 1, gen: x10a.gen + 1 });
assert.equal(h.scrubIndex(mountedTank, 0), -1, "a delayed refresh cannot pin a replacement bucket on the frozen plot");
S.hist.set("dhw_tank", x10a);
const previousHp = S.status.hp;
S.status.hp = { ...previousHp, connected: false };
assert.equal(h.scrubIndex(mountedTank, 0), -1,
  "link loss with unchanged rings retires the mounted X10A selection before Modbus is shown");
S.status.hp = previousHp;
assert.equal(view.series.length, 2);
assert.deepEqual(Array.from(view.series[0].v), [452, null, 454]);
assert.deepEqual(Array.from(view.series[1].v), [453, 455, 456]);

for (const dated of [false, true]) {
  // A long-lived tab can keep a compatible instrument's last response for several days.
  const day = 288;
  const a = dated ? { b0: null, t0: 1768720000 } : { b0: 100, t0: null };
  const far = dated ? { b0: null, t0: a.t0 + 1000 * 300 } : { b0: a.b0 + 1000, t0: null };
  S.hist.set("dhw_tank", { ...x10a, ...a, refreshFailed: true });
  S.hist.set("modbus:dhw_tank", { ...modbus, ...far, v: Array(day).fill(470) });
  const bounded = h.historyView("dhw_tank");
  assert.equal(bounded.v.length, day);
  assert.equal(dated ? bounded.t0 : bounded.b0, dated ? far.t0 : far.b0);
  assert.ok(bounded.series[0].v.every(v => v === null), "out-of-window data cannot be shifted into the newest day");
  assert.equal(bounded.series[1].v[0], 470);
}
S.hist.set("dhw_tank", x10a);
S.hist.set("modbus:dhw_tank", modbus);

// Both X10A and Modbus are initially active; both curves render and missing values are omitted from tooltips
assert.equal(h.histVisibleSeries(view).length, 2);
assert.deepEqual(Array.from(h.histVisibleSeries(view), s => s.source), ["x10a", "modbus"]);
assert.equal(h.scrubText(view, 0, false), "X10A 45,2 °C\nModbus 45,3 °C",
  "both visible instruments render one row each when both measured at the selected instant");
assert.equal(h.scrubText(view, 1, false), "Modbus 45,5 °C",
  "a gap in X10A omits X10A from the tooltip instead of printing missing prose");
assert.match(h.histReadout(view, 1), /class="vhist-tip-rows"/,
  "multiple visible series render tabular grid rows in tooltip");
assert.doesNotMatch(h.histReadout(view, 1), /<span class="vhist-tip-label">X10A<\/span>/,
  "unmeasured X10A row is omitted from tabular tooltip");
assert.match(h.histReadout(view, 1), /<span class="vhist-tip-label mb">Modbus<\/span><span class="vhist-tip-val">45,5 °C<\/span>/);

const initialHtml = h.histHtml("dhw_tank", "°C", "Tank");
assert.match(initialHtml, /class="vhist-line mb"/,
  "Modbus curve is initially shown alongside X10A");
assert.match(initialHtml, /data-hist-series="modbus" aria-pressed="true"/,
  "Modbus legend button is initially active");
assert.match(initialHtml, /data-hist-series="x10a" aria-pressed="true"/,
  "X10A legend button is initially active");
assert.doesNotMatch(initialHtml, /data-hist-series="(?:x10a|modbus)" aria-pressed="true" disabled/,
  "when both sources are active neither legend toggle is disabled");

// Tapping Modbus hides it: only X10A remains, label is omitted, and a lone gap leaves no tooltip bubble
{
  h.histSeriesToggle("dhw_tank", "modbus");
  {
    h.histPinToggle("dhw_tank", 0);
    S.hist.set("modbus:dhw_tank", { ...modbus, gen: 2, v: [461, 462, 463] });
    assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), 0,
      "a hidden peer refreshing the same grid cannot retire a plotted sample's pin");
    S.hist.set("modbus:dhw_tank", { ...modbus, gen: 3, b0: modbus.b0 - 1 });
    assert.equal(h.histPinIndex("dhw_tank", h.historyView("dhw_tank")), 1,
      "a boot-relative pin stays with its sample when the aligned view starts earlier");
    S.histPin.delete("dhw_tank");
    S.hist.set("modbus:dhw_tank", modbus);
  }
  const hidden = h.histHtml("dhw_tank", "°C", "Tank");
  assert.doesNotMatch(hidden, /class="vhist-line mb"/);
  assert.match(hidden, /data-hist-series="modbus" aria-pressed="false"/);
  assert.match(hidden, /data-hist-series="x10a" aria-pressed="true" disabled/,
    "the last visible source cannot be disabled");
  assert.equal(h.scrubText(view, 0, false), "45,2 °C",
    "a single visible curve omits its source label in tooltip readout");
  assert.equal(h.scrubText(view, 1, false), "",
    "an unmeasured sample on the sole visible curve produces no tooltip text");
  assert.equal(h.histReadout(view, 1), "",
    "an unmeasured sample on the sole visible curve leaves the tooltip empty");
  assert.doesNotMatch(h.scrubText(view, 1, false), /Modbus|nicht gemessen/);
  h.histSeriesToggle("dhw_tank", "x10a");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-pt"/,
    "a stale or programmatic click cannot hide the last visible curve");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank", "modbus"), /class="vhist-line mb"/,
    "a source-filtered view must keep its own sole curve visible");
  const measured = x10a.v;
  x10a.v = [null, null, null];
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-line mb"/,
    "an all-gap remaining source must reveal an available curve instead of leaving an empty chart");
  x10a.v = measured;
  h.histSeriesToggle("dhw_tank", "modbus");
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /class="vhist-line mb"/);
  assert.equal(S.hist.get("modbus:dhw_tank"), modbus,
    "legend choices never discard the recorded source history");
  S.histHidden.delete("dhw_tank");
}

const html = h.histHtml("dhw_tank", "°C", "Warmwasserspeichertemperatur");
assert.match(html, /Aufzeichnung · 1 h/,
  "a partial ring reports its recorded span without claiming that the board restarted");
assert.doesNotMatch(html, /Neustart/);
assert.match(html, /vhist-source[^>]*><i><\/i>X10A/);
assert.match(html, /vhist-source mb[^>]*><i><\/i>Modbus/);
assert.match(html, /vhist-line mb/);
assert.match(html, /45,2 – 45,6 °C/,
  "both sources share one vertical scale, including the Modbus-only maximum");

{
  // When X10A is down (not connected), Modbus is displayed by default and X10A is deactivated
  S.histHidden.delete("dhw_tank");
  S.status.hp = { connected: false };
  const downView = h.historyView("dhw_tank");
  assert.equal(h.histVisibleSeries(downView).length, 1);
  assert.equal(h.histVisibleSeries(downView)[0].source, "modbus");
  assert.equal(h.scrubText(downView, 1, false), "45,5 °C",
    "when X10A is down, Modbus is shown and omits its label");
  const downHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(downHtml, /class="vhist-line mb"/,
    "Modbus curve is displayed when X10A is down");
  assert.match(downHtml, /data-hist-series="modbus" aria-pressed="true" disabled/,
    "Modbus is active and cannot be disabled when X10A is down");
  assert.match(downHtml, /data-hist-series="x10a" aria-pressed="false"/,
    "X10A is inactive when down");

  // When X10A has no data points (all null), Modbus is also displayed by default
  delete S.status.hp;
  const origV = x10a.v;
  x10a.v = [null, null, null];
  const noDataView = h.historyView("dhw_tank");
  assert.equal(h.histVisibleSeries(noDataView).length, 1);
  assert.equal(h.histVisibleSeries(noDataView)[0].source, "modbus");
  assert.equal(h.scrubText(noDataView, 1, false), "45,5 °C",
    "when X10A has no data, Modbus is shown and omits its label");
  const noDataHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(noDataHtml, /class="vhist-line mb"/,
    "Modbus curve is displayed when X10A has no data");
  assert.match(noDataHtml, /data-hist-series="modbus" aria-pressed="true" disabled/);
  assert.match(noDataHtml, /data-hist-series="x10a" aria-pressed="false"/);

  // Restore
  x10a.v = origV;
  S.histHidden.delete("dhw_tank");
}

// Every numeric chart uses the same light-area/dark-upper-edge grammar. A single series keeps the
// reference opacity; paired instruments retain both areas and both lines under a transparent wrapper.
S.hist.set("pump_signal", { at: 1, gen: 1, dt: 300, unit: "%", t0: null, b0: 100,
  held: [], v: [700, 650, 600] });
const singleAreaHtml = h.histHtml("pump_signal", "%", "Pumpensignal");
assert.match(singleAreaHtml, /^<div class="vhist">[\s\S]*vhist-area[\s\S]*vhist-line/,
  "a single numeric trend must draw a light area before its darker upper-edge line");
assert.doesNotMatch(singleAreaHtml, /vhist-multi/,
  "a single trend must keep the reference opacity");
S.hist.set("leaving_water", { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [400, 410, 420] });
S.hist.set("modbus:leaving_water", { at: 1, gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [401, 411, 421] });
const pairedAreaHtml = h.histHtml("leaving_water", "°C", "Vorlauftemperatur");
assert.match(pairedAreaHtml, /^<div class="vhist vhist-multi">/,
  "overlaid numeric trends must opt into the reduced-opacity paint contract");
assert.match(pairedAreaHtml,
  /vhist-area"[\s\S]*vhist-area mb[\s\S]*vhist-line"[\s\S]*vhist-line mb/,
  "both instruments must retain a filled area and a darker line on its upper edge");
assert.match(style, /\.vhist-area\s*\{[^}]*opacity:\s*\.14/,
  "the reference single-series area must remain light");
assert.match(style, /\.vhist-multi \.vhist-area\s*\{[^}]*opacity:\s*\.09/,
  "overlaid areas must be more transparent than a single series");
assert.match(style, /\.vhist-multi \.vhist-line\s*\{[^}]*opacity:\s*\.82/,
  "overlaid upper-edge lines must remain distinct without becoming opaque");
assert.match(style,
  /\.vhist-source i\s*\{[^}]*border-top:\s*2px solid var\(--vhist-colour\)[^}]*color-mix\(/,
  "numeric legend samples must repeat the light-area/dark-upper-edge grammar");

// The configured MQTT room instrument contributes its own observations, not an X10A replacement.
// All three independent rasters share axes; an MQTT gap cannot borrow a device value at that time.
const beforeRoomHistory = new Map(S.hist);
const beforeRoomSource = S.status.reference_temperature;
const beforeRoomRows = S.status.history.room_rows;
S.status.reference_temperature = { configured: true, name: "Meross <img src=x onerror=alert(1)>",
  topic: "fixture/room-a", temperature_path: "temperature", fresh: true, temperature_valid: true,
  control_eligible: false, reason: "disabled" };
S.status.history.room_rows = [{ id: "room_temp", label: S.status.reference_temperature.name }];
S.status.history.rows.push({ id: "room_temp", label: "Indoor ambient temp. (R1T)" });
S.status.history.modbus_rows.push({ id: "room_temp", label: "Room temperature" });
S.hist.set("room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [200, 200, 200] });
S.hist.set("modbus:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [205, 205, 205] });
S.hist.set("room:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [235, null, 236] });
const roomView = h.historyView("room_temp");
assert.equal(roomView.series.length, 3);
assert.equal(roomView.series[2].source, "room");
assert.deepEqual(Array.from(roomView.series[2].v), [235, null, 236]);
assert.match(h.scrubText(roomView, 0), /Meross .* · MQTT 23,5 °C/);
assert.equal(h.scrubText(roomView, 1, false), "X10A 20,0 °C\nModbus 20,5 °C",
  "a missing MQTT sample is omitted from the tooltip rather than printing missing prose");
const roomHtml = h.histHtml("room_temp", "°C", "Raumtemperatur");
assert.match(roomHtml, /20,0 – 23,6 °C/);
assert.match(roomHtml, /vhist-source room/);
assert.match(roomHtml, /Meross &lt;img src=x onerror=alert\(1\)&gt; · MQTT/);
assert.doesNotMatch(roomHtml, /<img/);
assert.match(roomHtml, /vhist-pt room/);
assert.match(roomHtml, /vhist-now room/);
assert.match(roomHtml, /vhist-mark vhist-live room/);
assert.doesNotMatch(roomHtml, /Lücke|vhist-gap|vhist-idle/,
  "the lower time axis must not display gap or resting explanations");
{
  const x = S.hist.get("room_temp"), mb = S.hist.get("modbus:room_temp");
  const mqtt = S.hist.get("room:room_temp");
  S.hist.set("modbus:room_temp", { ...mb, b0: null, t0: 1768720150 });
  S.hist.set("room:room_temp", { err: true, v: [] });
  const splitRoom = h.histHtml("room_temp", "°C", "Raumtemperatur");
  assert.match(splitRoom, /data-source="x10a"/);
  assert.match(splitRoom, /data-source="modbus"/);
  assert.match(splitRoom, /MQTT · Verlauf nicht verfügbar/,
    "a third failed instrument is still named below the independent charts");
  S.hist.set("room_temp", x);
  S.hist.set("modbus:room_temp", mb);
  S.hist.set("room:room_temp", mqtt);
}
for (const cls of ["line", "area", "pt", "mark"])
  assert.match(style, new RegExp(`\\.vhist-${cls}\\.room`), `${cls} must use the independent room colour`);
S.status.history.rows = S.status.history.rows.filter((r) => r.id !== "room_temp");
S.status.history.modbus_rows = S.status.history.modbus_rows.filter((r) => r.id !== "room_temp");
assert.equal(S.hist.has("room_temp"), true);
assert.equal(S.hist.has("modbus:room_temp"), true);
assert.deepEqual(Array.from(h.historyView("room_temp").series, (s) => s.source), ["room"],
  "withdrawn source rows cannot revive cached X10A or HomeHub curves beside the independent room source");
const roomOnlyHtml = h.histHtml("room_temp", "°C", "Raumtemperatur");
assert.match(roomOnlyHtml, /data-source="room"/);
assert.match(roomOnlyHtml, /vhist-source room/,
  "an MQTT-only history must still name its physical source");
assert.match(h.scrubText(h.historyView("room_temp"), 2), /23,6 °C$/);
assert.doesNotMatch(h.scrubText(h.historyView("room_temp"), 2), /Meross/);
h.histPinToggle("room_temp", 2);
assert.match(h.histHtml("room_temp", "°C", "Raumtemperatur"), /vhist-mark vhist-pinned room/);
S.histPin.delete("room_temp");
S.hist.delete("room:room_temp");
fetchedUrls = [];
await h.ensureHistPair("room_temp");
assert.deepEqual(fetchedUrls, ["/history?row=room_temp&source=room"],
  "the independent source must fetch without an X10A or HomeHub room series");
S.status.history.room_rows = [];
assert.equal(h.histHtml("room_temp", "°C", "Raumtemperatur"), "",
  "an unoffered room source cannot keep displaying its cached history");
S.status.history.room_rows = beforeRoomRows;
S.status.reference_temperature = beforeRoomSource;
h.syncHistSources();
S.hist = beforeRoomHistory;

// A derived curve keeps the UNION of its input rasters. Before this contract, taking the shortest
// input collapsed an 11-hour chart to 1 or 8 hours after one register appeared/reset later.
S.hist.set("leaving_water", { at: Date.now(), gen: 1, dt: 300, unit: "°C", t0: null, b0: 100,
  held: [], v: [400, 410, 420] });
S.hist.set("return_water", { at: Date.now(), gen: 1, dt: 300, unit: "°C", t0: null, b0: 101,
  held: [], v: [350, 360] });
await h.ensureDerived("dt");
assert.equal(S.hist.get("dt").b0, 100);
assert.deepEqual(Array.from(S.hist.get("dt").v), [null, 60, 60],
  "the earlier bucket remains a gap instead of being cut off with the shorter input");
const bucketReturnWater = S.hist.get("return_water");
const bucketLeavingWater = S.hist.get("leaving_water");
S.hist.set("return_water", { ...bucketReturnWater, gen: 2, b0: null, t0: 1768720000 });
await h.ensureDerived("dt");
assert.deepEqual(Array.from(S.hist.get("dt").v), [],
  "boot-relative supply and date-only return cannot be paired by ring length");
S.hist.set("leaving_water", { ...bucketLeavingWater, gen: 2, b0: null, t0: 1768720000 });
S.hist.set("return_water", { ...bucketReturnWater, gen: 3, b0: null, t0: 1768720150 });
await h.ensureDerived("dt");
assert.deepEqual(Array.from(S.hist.get("dt").v), [],
  "off-raster wall-only operands cannot fabricate a temperature spread");
S.hist.set("return_water", { ...bucketReturnWater, gen: 4, b0: null, t0: 1768720300 });
await h.ensureDerived("dt");
assert.deepEqual(Array.from(S.hist.get("dt").v), [],
  "a whole-bucket wall correction is indistinguishable from alignment without boot evidence");
S.hist.set("leaving_water", { ...bucketLeavingWater, gen: 3, b0: -2, t0: 1768720000 });
S.hist.set("return_water", { ...bucketReturnWater, gen: 5, b0: -1, t0: 1768720307 });
await h.ensureDerived("dt");
assert.deepEqual(Array.from(S.hist.get("dt").v), [null, 60, 60],
  "boot-aligned restored operands keep the sampled spread across wall projections");
{
  const uptime = S.status.uptime_s;
  const from = { ...bucketLeavingWater, gen: 20, b0: 0, v: [400, 410] };
  const to = { ...bucketReturnWater, gen: 20, b0: 0, v: [350, 360] };
  S.status.uptime_s = 289 * 300;
  assert.equal(h.expiredHistSlots(from), 1);
  assert.equal(h.expiredHistSlots(to), 1);
  S.status.uptime_s = 288 * 300;
  S.hist.set("leaving_water", from);
  S.hist.set("return_water", to);
  await h.ensureDerived("dt");
  assert.deepEqual(Array.from(S.hist.get("dt").v), [null, 50],
    "opening derived history cannot republish source buckets that had already expired");
  S.status.uptime_s = uptime;
}
S.hist.set("leaving_water", bucketLeavingWater);
S.hist.set("return_water", bucketReturnWater);
await h.ensureDerived("dt");

// A 5 A INV reading from a sweep without a speed witness and 18 rps from a later sweep can
// occupy the same bucket. That raw current must stay visible without creating an estimate.
{
  const originalRows = S.status.history.rows;
  const originalHistory = S.hist;
  const originalResponse = historyResponse;
  const originalUrls = fetchedUrls;
  const rows = ["inv_current", "comp_rps", "flow", "leaving_water", "return_water"].map(id => ({ id }));
  S.status.history.rows = rows;
  const base = { at: Date.now(), gen: 1, dt: 300, b0: 100 };
  S.hist = new Map([
    ["inv_current", { ...base, unit: "A", v: [null, 50, 0, 50], held: [[0, 1]] }],
    ["comp_rps", { ...base, v: [0, 180, 180, 0], held: [] }],
  ]);
  fetchedUrls = [];
  assert.equal(h.hasHist("inv_current"), true, "raw inverter current remains available");
  assert.deepEqual(Array.from(h.historyView("inv_current").v), [null, 50, 0, 50]);
  assert.equal(!!h.hasHist("pel"), false, "raw inverter and speed rings alone cannot offer electrical history");
  assert.equal(!!h.hasHist("cop"), false, "independent rings cannot offer a historical COP");
  await h.ensureHistPair("pel");
  await h.ensureHistPair("cop");
  assert.deepEqual(fetchedUrls, []);
  assert.equal(h.histHtml("pel", "", "Electrical input"), "");
  assert.equal(h.histHtml("cop", "", "COP"), "");

  // A later partial CT sweep can update L1/L2 and leave the preceding sweep's L3 in the same
  // bucket. Preserve the raw readings and refuse the resulting apparent 11.5 kW.
  S.status.history.rows = [...rows, { id: "ct_l1" }, { id: "ct_l2" }, { id: "ct_l3" }];
  for (const [id, value] of [["ct_l1", 200], ["ct_l2", 200], ["ct_l3", 100]]) {
    S.hist.set(id, { ...base, unit: "A", v: [100, value], held: [] });
    assert.deepEqual(Array.from(h.historyView(id).v), [100, value]);
  }
  assert.equal(h.hasHist("pel"), false, "same-bucket CT readings cannot qualify a historical power estimate");
  await h.ensureHistPair("pel");
  assert.deepEqual(fetchedUrls, []);
  assert.equal(h.histHtml("pel", "", "Electrical input"), "");
  assert.equal(h.histHtml("cop", "", "COP"), "");
  S.status.history.rows = originalRows;
  S.hist = originalHistory;
  historyFetchError = false;
  historyResponse = originalResponse;
  fetchedUrls = originalUrls;
}

// Thermal output has the same compressor boundary as the live pill. Preserve a no-flow bucket as
// zero, retain signed active/defrost transfer, and refuse pump-overrun redistribution.
assert.equal(h.DERIVED.pth.ready({
  flow: true, leaving_water: true, return_water: true, comp_rps: false,
}), false, "thermal output is unavailable when the profile has no compressor witness");
assert.equal(h.DERIVED.pth.fn({
  flow: 0, leaving_water: 35, return_water: 30, comp_rps: 0,
}), 0, "a stopped circuit with measured zero flow is zero transfer");
assert.equal(h.DERIVED.pth.fn({
  flow: 0, leaving_water: null, return_water: null, comp_rps: null,
}), 0, "measured no flow proves zero transfer without temperature or compressor samples");
assert.equal(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 35, return_water: 30, comp_rps: 0,
}), null, "pump overrun must not be drawn as heat-pump output");
assert.ok(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 35, return_water: 30, comp_rps: 45,
}) > 0, "a running compressor keeps the signed water-side transfer");
assert.ok(h.DERIVED.pth.fn({
  flow: 20, leaving_water: 30, return_water: 35, comp_rps: 45,
}) < 0, "defrost and cooling retain the signed reverse transfer");

// A successful HomeHub poll proves transport freshness, not when the controller last refreshed its
// outdoor-temperature register. Keep that qualification in the graph popup: the chart must remain
// compact, while hovering any petrol plateau names its observed interval and unknown measurement age.
S.hist.set("outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [[1, 3]], v: [205, null, null, null] });
S.hist.set("modbus:outdoor_air", { at: 1, gen: 1, dt: 300, unit: "°C", t0: 1768720000, b0: 200,
  held: [], v: [205, 205, 205, 295] });
const outdoorView = h.historyView("outdoor_air");
const outdoorHtml = h.histHtml("outdoor_air", "°C", "Außentemperatur");
assert.doesNotMatch(outdoorHtml.slice(outdoorHtml.indexOf('<div class="vhist-axis">')), /Messalter unbekannt|Stillstand|nicht gemessen|vhist-idle|vhist-gap/,
  "neither freshness qualification nor resting/gap explanations belong on the time axis");
assert.doesNotMatch(h.scrubText(outdoorView, 1, false), /X10A|Außeneinheit ruht/,
  "a held X10A pause must be omitted from the tooltip alongside an active Modbus reading");
assert.match(h.scrubText(outdoorView, 1),
  /Modbus 20,5 °C · Register unverändert .* ca\. 15 min · Messalter unbekannt/,
  "the popup distinguishes a repeated register value from a proven fresh measurement");

// Readouts belong above the selected instant, with position-independent widths at both edges.
assert.match(style, /\.vhist-tip \{[^}]*width:\s*max-content;/,
  "the readout's width must not depend on its position, or the last sample wraps it to one word per line");
assert.match(style, /\.vhist-tip \{[^}]*translateX\(calc\(var\(--tip-p\) \* -1%\)\)/,
  "the anchor must keep the readout inside the card at either end of the time axis");
h.histPinToggle("outdoor_air", 3); // the newest sample: p = 100
assert.match(h.histHtml("outdoor_air", "°C", "Außentemperatur"),
  /<div class="vhist-tip vhist-pinned mono num" style="--tip-p:100\.000">/,
  "the pinned readout uses the same anchor as the selected instant");
S.histPin.delete("outdoor_air");

// The LIVE half is the handler, not a stylesheet, so execute it rather than grep it: scrubMove must
// place the bubble from the sample's position. Overlapping readouts use paint order rather than
// geometry measurements, changing the bubble's width or adding another vertical row.
{
  const styleSpy = () => {
    const props = new Map(), written = [];
    return { props, written,
      setProperty: (k, v) => { props.set(k, v); written.push(k); },
      set left(v) { written.push("left=" + v); }, get left() { return ""; } };
  };
  let offsetWidthReads = 0;
  const node = (cls) => {
    const classes = new Set(cls.split(" "));
    let html = "";
    return { get className() { return [...classes].join(" "); },
      set className(value) {
        classes.clear();
        for (const name of value.split(/\s+/)) if (name) classes.add(name);
      },
      get innerHTML() { return html; }, set innerHTML(value) { html = String(value); },
      get textContent() {
        const entities = { "&amp;":"&", "&lt;":"<", "&gt;":">", "&quot;":'"' };
        return html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot);/g, entity => entities[entity])
          .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(+code));
      },
      set textContent(value) { html = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
      hidden: true, dataset: {}, style: styleSpy(),
      classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name) },
      get offsetWidth() { offsetWidthReads++; return 0; } };
  };
  const tipNode = node("vhist-tip vhist-live");
  const timeNode = node("vhist-time vhist-live");
  const crossNode = node("vhist-cross vhist-live");
  const markNode = node("vhist-mark vhist-live");     // never spread: that reads the offsetWidth spy
  const pinned = { getBoundingClientRect() { throw Error("Readout overlap must not measure geometry"); } };
  markNode.dataset.source = "modbus";
  const plot = {
    clientWidth: 600, dataset: { hist: "outdoor_air", source: "modbus", n: "4" },
    querySelector: () => crossNode,
    querySelectorAll: () => [markNode],
    parentElement: { querySelector: (selector) => selector === ".vhist-time.vhist-live" ? timeNode
      : selector === ".vhist-tip.vhist-pinned" ? pinned : tipNode },
  };
  h.scrubMove(plot, 3);                                    // the newest sample of the 4-sample ring
  assert.equal(tipNode.style.props.get("--tip-p"), "100.000",
    "the live readout is placed from the sample's position, like the pinned one");
  assert.deepEqual(tipNode.style.written, ["--tip-p"],
    "scrubMove must write only --tip-p on the bubble — a px `left` reintroduces the edge squeeze");
  assert.equal(offsetWidthReads, 0,
    "the bubble's placement must not depend on measuring it: the squeezed width measured as fitting");
  assert.equal(tipNode.hidden, false, "the readout is still revealed by a scrub");
  assert.equal(timeNode.hidden, false, "scrubbing reveals the separate time-axis label");
  assert.match(timeNode.textContent, /^\d{2}:\d{2}$/);
  assert.doesNotMatch(tipNode.textContent, /\d{2}:\d{2} · Modbus/,
    "the selected time belongs on the axis rather than in the measurement bubble");
  assert.equal(timeNode.style.props.get("--tip-p"), "100.000");
  h.scrubMove(plot, 0);
  assert.equal(tipNode.style.props.get("--tip-p"), "0.000");
  assert.equal(tipNode.classList.contains("vhist-stacked"),false,
    "moving readouts must remain in the same compact row");
}

// Smart-Grid mode is a complete categorical state timeline, not a misleading numeric 0..3 line.
// X10A and paired HomeHub/Modbus start active when available and can be toggled via the source legend.
// Exact phase ranges appear in the compact tooltip, with time on the lower scale.
S.hist.set("smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 20, 30, null, 20, 0] });
S.hist.set("modbus:smart_grid_mode", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 20, 30, null, 20, 0] });
const boostView = h.historyView("smart_grid_mode");
const boostHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung");
assert.equal(boostView.series.length, 2);
assert.match(boostHtml, /vhist-state-track/);
assert.doesNotMatch(boostHtml, /vhist-line/,
  "a categorical Smart-Grid mode must not be drawn as a numeric line");
assert.match(boostHtml, /Boost aktiv · 10 min/,
  "only the two mode-2 buckets contribute to the Boost total");
for (const cls of ["sg-free", "sg-forced-off", "sg-recommended", "sg-forced-on"])
  assert.match(boostHtml, new RegExp(`vhist-state-on ${cls}`),
    `each source lane visibly distinguishes ${cls}`);
assert.match(boostHtml, /vhist-state-gap/);
assert.match(boostHtml, /Freier Betrieb/);
assert.match(boostHtml, /Zwangsabschaltung/);
assert.match(boostHtml, /Empfehlung ein/);
assert.match(boostHtml, /Erzwungen ein/);
assert.doesNotMatch(boostHtml, /vhist-state-runs|· Phasen|vhist-state-lane-label/,
  "phase details belong to the compact tooltip and source selection belongs to the legend");
assert.equal((boostHtml.match(/vhist-state-track/g) || []).length, 2,
  "both X10A and Modbus tracks are rendered together initially");
assert.ok(boostHtml.indexOf("vhist-state-track x10a") <
          boostHtml.indexOf("vhist-state-track modbus"),
  "the X10A track precedes the Modbus track");
assert.match(boostHtml, /data-hist-series="x10a" aria-pressed="true" disabled/,
  "X10A remains active and locked even while Modbus is also shown");
assert.match(boostHtml, /data-hist-series="modbus" aria-pressed="true"/,
  "Modbus legend button is initially active alongside X10A");
assert.match(boostHtml, />nicht gemessen</,
  "gaps in a visible source remain explained in the legend");
h.histSeriesToggle("smart_grid_mode", "x10a");
assert.equal(h.histVisibleSeries(h.historyView("smart_grid_mode")).length, 2,
  "X10A cannot be deactivated on a state chart while X10A is available");
assert.match(h.scrubText(boostView, 2),
  /^X10A \d{2}:\d{2}–\d{2}:\d{2} · Empfehlung ein\nModbus \d{2}:\d{2}–\d{2}:\d{2} · Empfehlung ein$/);
assert.match(h.histReadout(boostView, 2),
  /<span class="vhist-tip-rows"><span class="vhist-tip-label">X10A<\/span><span class="vhist-tip-val">\d{2}:\d{2}–\d{2}:\d{2} · Empfehlung ein<\/span><span class="vhist-tip-label mb">Modbus<\/span>/);
h.histSeriesToggle("smart_grid_mode", "modbus");
const boostSingleHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung");
assert.equal((boostSingleHtml.match(/vhist-state-track/g) || []).length, 1,
  "toggling Modbus off leaves only the X10A track");
assert.match(boostSingleHtml, /data-hist-series="modbus" aria-pressed="false"/);
for (const [i, label] of [[0, "Freier Betrieb"], [1, "Zwangsabschaltung"],
                           [2, "Empfehlung ein"], [3, "Erzwungen ein"]])
  assert.match(h.scrubText(boostView, i), new RegExp(`^\\d{2}:\\d{2}–\\d{2}:\\d{2} · ${label}$`),
    `single visible track shows compact phase range and ${label}`);
S.histHidden.delete("smart_grid_mode");

// A caller can still request a deliberately Modbus-only Smart-Grid history. That filtered view
// loses the X10A lane and tooltip block, while the schematic inspector above remains dual-source.
const boostModbusView = h.historyView("smart_grid_mode", "modbus");
const boostModbusHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
assert.equal(boostModbusView.series.length, 1);
assert.equal(boostModbusView.series[0].source, "modbus");
assert.doesNotMatch(boostModbusHtml, />X10A</);
assert.match(boostModbusHtml, /vhist-source mb[^>]*><i><\/i>Modbus/);
assert.match(boostModbusHtml, /data-source="modbus"/,
  "scrubbing and pinning must resolve the same Modbus-only view that the chart renders");
assert.match(h.scrubText(boostModbusView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Empfehlung ein$/);
assert.doesNotMatch(h.scrubText(boostModbusView, 2), /X10A|Modbus|Boost|ca\.|min/);

// Regression: /history ends at the newest COMPLETED bucket while /values already carries the live
// state. The chart must not paint that old bucket through the edge labelled "jetzt". Append the
// current observation as its own cap, keep it scrub-readable, and exclude it from sampled totals.
S._modbus = [{ off: 56, value: 2, enum: "smart_grid_mode" }];
const liveBoostView = h.historyView("smart_grid_mode", "modbus");
const liveBoostHtml = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
assert.equal(liveBoostView.recordedN, 7);
assert.equal(liveBoostView.liveIndex, 7);
assert.deepEqual(Array.from(liveBoostView.series[0].v), [0, 10, 20, 30, null, 20, 0, 20]);
assert.match(liveBoostHtml,
  /vhist-state-on sg-recommended" style="left:87\.500%;width:12\.500%/,
  "the live Recommended-on state must own the right edge instead of extending Free running to now");
assert.match(liveBoostHtml, /vhist-state-current" style="left:87\.500%;width:12\.500%/,
  "the display distinguishes the live observation from completed raster buckets");
assert.match(liveBoostHtml, /Boost aktiv · 10 min/,
  "one live observation must not be counted as an invented five minutes of Boost runtime");
assert.equal(h.scrubText(liveBoostView, 7), "jetzt · Empfehlung ein",
  "the state shown at the right edge and its tooltip must agree");
{
  const recorded = S.hist.get("modbus:smart_grid_mode");
  S.hist.set("modbus:smart_grid_mode", { ...recorded, b0: null });
  h.histPinToggle("smart_grid_mode", 2, "modbus");
  S._modbus[0].value = 3;
  assert.equal(h.histPinIndex("smart_grid_mode", h.historyView("smart_grid_mode", "modbus")), 2,
    "a change in the live state cannot hide a pin on a completed wall-clock sample");
  S.histPin.delete("smart_grid_mode");
  S.hist.set("modbus:smart_grid_mode", recorded);
  S._modbus[0].value = 2;
}
h.histPinToggle("smart_grid_mode", 7, "modbus");
assert.equal(h.histPinIndex("smart_grid_mode", liveBoostView), 7);
S._modbus[0].value = 3;
h.expireLiveHistoryPins();
S._modbus[0].value = 2;
assert.equal(h.histPinIndex("smart_grid_mode", h.historyView("smart_grid_mode", "modbus")), -1,
  "a live A-B-A transition retires the pin even while its view does not render");
assert.equal(S.histPin.has("smart_grid_mode"), false, "a changed live observation retires its pin");
S._modbus[0].value = 2;
h.histPinToggle("smart_grid_mode", 7, "modbus");
const priorModbus = S.status.modbus;
S.status.modbus = { ...priorModbus, connected: false };
const droppedBoost = h.historyView("smart_grid_mode", "modbus");
assert.equal(droppedBoost.v[droppedBoost.liveIndex], null,
  "an explicit HomeHub disconnect makes the current cap unmeasured");
assert.deepEqual(Array.from(droppedBoost.series[0].v.slice(0, droppedBoost.recordedN)),
  [0, 10, 20, 30, null, 20, 0], "the HomeHub disconnect preserves recorded history");
h.expireLiveHistoryPins();
S.status.modbus = priorModbus;
assert.equal(S.histPin.has("smart_grid_mode"), false,
  "a HomeHub reconnect cannot restore the revoked live observation's pin");
S.otaCached = true;
assert.equal(h.historyView("smart_grid_mode", "modbus").liveIndex, undefined,
  "a retained OTA snapshot cannot create a live cap");
delete S.otaCached;
{
  const track = { dataset: { hist: "smart_grid_mode", source: "modbus", n: "8" },
    getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  assert.equal(h.scrubIndex(track, 88), 7, "tap inside the live cap selects the live state");
  assert.equal(h.scrubIndex(track, 87), 6, "tap inside the last completed cell selects its own state");
  assert.equal(h.scrubIndex(track, 12), 0, "taps follow painted cell edges instead of line-chart geometry");
}
{
  const key = "modbus:smart_grid_mode";
  const old = S.hist.get(key);
  S.hist.set(key, { ...old, refreshFailed: true });
  const retained = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
  assert.match(retained, /vhist-retained[^>]*left:81\.250%/,
    "the retained marker sits inside the last recorded bucket instead of the separate live cap");
  assert.match(retained, /<span>jetzt<\/span><\/div><span class="vhist-time vhist-live mono num" hidden><\/span><\/div><\/div>$/,
    "the separately measured live observation retains its current-time label on the shared lower scale");
  S.hist.set(key, old);
  S.hist.set(key, { ...old, v: [], err: true });
  const liveOnly = h.histHtml("smart_grid_mode", "", "Smart-Grid-Anforderung", "modbus");
  assert.match(liveOnly, /vhist-state-on sg-recommended/);
  assert.match(liveOnly, /Modbus · Verlauf nicht verfügbar/,
    "a current HomeHub observation does not hide a refusal of its recorded history");
  assert.doesNotMatch(liveOnly, /Boost aktiv · 0/);
  S.hist.set("smart_grid_mode", { ...old, gen: 7, v: [0, 20] });
  const currentPair = h.historyView("smart_grid_mode");
  assert.equal(currentPair.series.find(s => s.source === "modbus").v.at(-1), 20,
    "a healthy peer's history cannot suppress independently available current evidence");
  assert.doesNotMatch(h.histHtml("smart_grid_mode", "", "Smart Grid"), /Boost aktiv · 0/,
    "a current-only primary source cannot present a zero recorded duration");
  S.histHidden.delete("smart_grid_mode");
  S.hist.delete("smart_grid_mode");
  S.hist.set(key, old);
}
delete S._modbus;

// The external circulation witness is a three-outcome history: confirmed running, confirmed
// stopped, or unavailable evidence. The configured name lives in the Settings row; the chart legend
// names its transport and must keep absent MQTT evidence visible instead of colouring it stopped.
S.hist.set("circulation_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [null, 0, 0, 10, 10, null] });
const circulationView = h.historyView("circulation_state");
const circulationHtml = h.histHtml("circulation_state", "", "Warmwasser-Zirkulationspumpe");
assert.equal(circulationView.series[0].name, "MQTT");
assert.match(circulationHtml, /class="vhist-source"><i><\/i>MQTT<\/span>/);
assert.match(circulationHtml, /vhist-state-on state-off/);
assert.match(circulationHtml, /vhist-state-on circulation-on/);
assert.match(circulationHtml, /vhist-state-gap/);
for (const label of ["Läuft", "Steht", "Nicht verfügbar"])
  assert.match(circulationHtml, new RegExp(`>${label}<`), `${label} must be an explicit timeline state`);
assert.doesNotMatch(circulationHtml, /nicht verfügbar|Lücke|vhist-gap|vhist-idle/,
  "lower time axis omits unavailable-interval counters");
assert.equal(h.scrubText(circulationView, 0), "",
  "an absent pump sample omits unavailable text from tooltip");
assert.equal(h.histReadout(circulationView, 0), "",
  "an absent pump sample leaves the tooltip bubble empty");
assert.match(h.scrubText(circulationView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · Steht$/);
assert.match(h.scrubText(circulationView, 3), /^\d{2}:\d{2}–\d{2}:\d{2} · Läuft$/);

// BSH is also categorical. X10A and Modbus start active and Modbus toggles off/on inside the same chart.
S.hist.set("bsh_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
S.hist.set("modbus:bsh_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
const bshView = h.historyView("bsh_state");
const bshHtml = h.histHtml("bsh_state", "", "Heizstab");
assert.match(bshHtml, /vhist-state-track/);
assert.doesNotMatch(bshHtml, /vhist-line/);
assert.match(bshHtml, /Heizstab aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.match(bshHtml, /vhist-state-on state-off/);
assert.match(bshHtml, /vhist-state-on heater-on/);
assert.doesNotMatch(bshHtml, /vhist-state-runs|· Phasen|vhist-state-lane-label/);
assert.equal((bshHtml.match(/vhist-state-track/g) || []).length, 2);
assert.match(bshHtml, /data-hist-series="x10a" aria-pressed="true" disabled/);
assert.match(bshHtml, /data-hist-series="modbus" aria-pressed="true"/);
assert.match(h.scrubText(bshView, 0), /^X10A \d{2}:\d{2}–\d{2}:\d{2} · Aus\nModbus \d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(bshView, 1), /^X10A \d{2}:\d{2}–\d{2}:\d{2} · An\nModbus \d{2}:\d{2}–\d{2}:\d{2} · An$/);
h.histSeriesToggle("bsh_state", "modbus");
assert.equal((h.histHtml("bsh_state", "", "Heizstab").match(/vhist-state-track/g) || []).length, 1);
assert.match(h.scrubText(h.historyView("bsh_state"), 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(h.historyView("bsh_state"), 1), /^\d{2}:\d{2}–\d{2}:\d{2} · An$/);
S.histHidden.delete("bsh_state");

// The Heizstab schematic inspector keeps the categorical history but narrows it to the authoritative
// X10A BSH state. The generic value-row chart above remains dual-source for diagnostics.
const bshX10aView = h.historyView("bsh_state", "x10a");
const bshX10aHtml = h.histHtml("bsh_state", "", "Heizstab", "x10a");
assert.equal(bshX10aView.series.length, 1);
assert.equal(bshX10aView.series[0].source, "x10a");
assert.doesNotMatch(bshX10aHtml, /data-hist-series="modbus"/);
assert.match(bshX10aHtml, /data-source="x10a"/);
assert.match(h.scrubText(bshX10aView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · An$/);
assert.doesNotMatch(h.scrubText(bshX10aView, 1), /X10A|Modbus|Heizstab|ca\.|min/);
{
  const old = S.hist.get("bsh_state");
  const peer = S.hist.get("modbus:bsh_state");
  S.hist.set("bsh_state", { ...old, t0: null, v: [10], refreshFailed: true });
  S.hist.set("modbus:bsh_state", { ...peer, t0: null });
  const retained = h.historyView("bsh_state", "x10a");
  assert.equal(h.scrubText(retained, 0), "Letzter empfangener Messwert · An",
    "one undated retained slot shows its last reading once");
  assert.match(h.scrubText(h.historyView("bsh_state"), 0),
    /^X10A Letzter empfangener Messwert · An\nModbus /,
    "a fresh partner cannot change the retained lane's phase time");
  S.histHidden.delete("bsh_state");
  S.hist.set("bsh_state", old);
  S.hist.set("modbus:bsh_state", peer);
}
{
  const prevValues = S._values, prevModbus = S._modbus;
  S._values = [{ concept: "bsh_state", value: "1", binary: true }];
  S._modbus = [{ concept: "bsh_state", value: "0", binary: true }];
  const view = h.historyView("bsh_state", "x10a");
  assert.equal(view.v[view.liveIndex], 10);
  h.histPinToggle("bsh_state", view.liveIndex, "x10a");
  assert.equal(h.histPinIndex("bsh_state", h.historyView("bsh_state")), -1,
    "the paired chart does not render a pin tied to a filtered observation");
  assert.equal(h.histPinIndex("bsh_state", h.historyView("bsh_state", "x10a")), view.liveIndex,
    "rendering the paired chart must leave the source-filtered pin intact");
  const old = S.hist.get("bsh_state");
  S.hist.set("bsh_state", { ...old, gen: old.gen + 1, v: [...old.v, 0] });
  const updated = h.historyView("bsh_state", "x10a");
  assert.equal(h.histPinIndex("bsh_state", updated), updated.liveIndex,
    "updating the recorded buckets cannot retire an unchanged live observation");
  S.hist.set("bsh_state", old);
  S.histPin.delete("bsh_state");
  S._values = prevValues;
  S._modbus = prevModbus;
}

// Related does not mean equivalent: X10A tank preheat and HomeHub disinfection retain separate ids,
// source tracks and state wording. Neither one may be overlaid as the other's second witness.
S.hist.set("tank_preheat_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 10, 0, 0] });
S.hist.set("modbus:disinfection_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 0, 10, 0] });
assert.equal(h.hasHist("tank_preheat_state"), true);
assert.equal(h.hasModbusHist("tank_preheat_state"), false);
assert.equal(h.hasHist("disinfection_state"), false);
assert.equal(h.hasModbusHist("disinfection_state"), true);
const preheatHtml = h.histHtml("tank_preheat_state", "", "Speichervorheizung");
const disinfectionHtml = h.histHtml("disinfection_state", "", "Speicherdesinfektion");
assert.match(preheatHtml, /vhist-state-track x10a/);
assert.match(preheatHtml, /vhist-state-on preheat-on/);
assert.doesNotMatch(preheatHtml, /Modbus|Desinfektion aktiv/);
assert.match(disinfectionHtml, /vhist-state-track modbus/);
assert.match(disinfectionHtml, /vhist-source mb[^>]*><i><\/i>Modbus/);
assert.match(disinfectionHtml, /vhist-state-on disinfection-on/);
assert.doesNotMatch(disinfectionHtml, />X10A<|Speichervorheizung aktiv/);

// Both outdoor pills open categorical timelines. Defrost is event-folded; Quiet toggles its
// second HomeHub track on demand so gaps and disagreements remain directly inspectable.
S.hist.set("defrost_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 0, 10] });
const defrostView = h.historyView("defrost_state");
const defrostHtml = h.histHtml("defrost_state", "", "Abtauen");
assert.match(defrostHtml, /vhist-state-track/);
assert.doesNotMatch(defrostHtml, /vhist-line/);
assert.match(defrostHtml, /Abtauen aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.match(defrostHtml, /vhist-state-on state-off/);
assert.match(defrostHtml, /vhist-state-on defrost-on/);
assert.doesNotMatch(defrostHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(defrostView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · An$/);

S.hist.set("quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, 10, 0, 0] });
S.hist.set("modbus:quiet_state", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [10, null, 0, 10] });
const quietView = h.historyView("quiet_state");
const quietHtml = h.histHtml("quiet_state", "", "Leise-Modus");
assert.equal(quietView.series.length, 2);
assert.match(quietHtml, /vhist-state-track/);
assert.doesNotMatch(quietHtml, /vhist-line/);
assert.match(quietHtml, /Leise-Modus aktiv erfasst · 10 min im 5-Minuten-Raster/);
assert.equal((quietHtml.match(/vhist-state-track/g) || []).length, 2);
assert.match(quietHtml, /vhist-state-on state-off/);
assert.match(quietHtml, /vhist-state-on quiet-on/);
assert.match(quietHtml, /vhist-state-gap/,
  "a missing Modbus sample stays hatched in the visible Modbus lane by default");
assert.doesNotMatch(quietHtml, /vhist-state-runs|· Phasen/);
assert.match(h.scrubText(quietView, 0), /^X10A .* · An\nModbus .* · An$/);
assert.match(h.scrubText(quietView, 1), /^X10A .* · An$/,
  "a missing Modbus state sample is omitted from the dual-source tooltip");
assert.doesNotMatch(h.scrubText(quietView, 1), /Modbus|nicht gemessen/);
assert.match(h.scrubText(quietView, 3), /^X10A .* · Aus\nModbus .* · An$/);
h.histSeriesToggle("quiet_state", "modbus");
const quietSingleHtml = h.histHtml("quiet_state", "", "Leise-Modus");
assert.equal((quietSingleHtml.match(/vhist-state-track/g) || []).length, 1);
assert.doesNotMatch(quietSingleHtml, /vhist-state-gap/,
  "toggling Modbus off hides the hatched Modbus lane");
S.histHidden.delete("quiet_state");

// BUH is one component with two event-folded stage bits. The browser combines both aligned rings
// into an off/step-1/step-2 timeline; it must not graph either raw bit as a numeric 0/1 curve.
const now = Date.now();
S.hist.set("buh_step1", { at: now, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 10, 10, 0, 0, null] });
S.hist.set("buh_step2", { at: now, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 0] });
assert.equal(h.hasHist("buh_state"), true);
await h.ensureDerived("buh_state");
assert.deepEqual(Array.from(S.hist.get("buh_state").v), [0, 10, 20, 20, 0, null]);
const buhView = h.historyView("buh_state");
const buhHtml = h.histHtml("buh_state", "", "Zusatzheizer · BUH");
assert.match(buhHtml, /vhist-state-track/);
assert.doesNotMatch(buhHtml, /vhist-line/);
assert.match(buhHtml, /Zusatzheizer aktiv erfasst · 15 min im 5-Minuten-Raster/);
assert.match(buhHtml, /vhist-state-on step1/);
assert.match(buhHtml, /vhist-state-on step2/);
assert.match(buhHtml, /vhist-state-on state-off/);
assert.doesNotMatch(buhHtml, /vhist-state-runs|· Phasen|Lücke|vhist-gap|vhist-idle/);
assert.match(h.scrubText(buhView, 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(buhView, 1), /^\d{2}:\d{2}–\d{2}:\d{2} · Stufe 1$/);
assert.match(h.scrubText(buhView, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Stufe 2$/);
assert.equal(h.scrubText(buhView, 5), "",
  "a BUH gap omits missing text from tooltip");
assert.equal(h.histReadout(buhView, 5), "",
  "a BUH gap hides the tooltip bubble");
for (const i of [0, 1, 2, 5])
  assert.doesNotMatch(h.scrubText(buhView, i), /X10A|Modbus|Zusatzheizer|ca\.|min/);

// The schematic shows intuitive pump speed, while the X10A row is inverted (0=max, 100=stop).
// Its inspector curve must transform the source ring instead of making a stopped pump look maximal.
S.hist.set("pump_signal", { at: Date.now(), gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [1000, 700, 0] });
await h.ensureDerived("pump_speed");
assert.deepEqual(Array.from(S.hist.get("pump_speed").v), [0, 300, 1000]);
assert.match(h.histHtml("pump_speed", "", "Drehzahl der Umwälzpumpe"), /0,0 – 100,0 %/);
assert.equal(h.DERIVED.pump_speed.fn({ pump_signal: 25.5 }), 74.5);
for (const invalid of [-1, 101, 255, Infinity, -Infinity]) {
  assert.equal(h.DERIVED.pump_speed.fn({ pump_signal: invalid }), null,
    `out-of-range pump_signal ${String(invalid)} stays a gap`);
}

// The diverter is categorical too. X10A and Modbus start active and Modbus toggles off/on inside the same chart.
S.hist.set("valve_dhw", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
S.hist.set("modbus:valve_dhw", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
const valveView = h.historyView("valve_dhw");
const valveHtml = h.histHtml("valve_dhw", "", "3-Wege-Ventil");
assert.match(valveHtml, /vhist-state-track/);
assert.doesNotMatch(valveHtml, /vhist-line/);
assert.match(valveHtml, /Warmwasser · 15 min · Raumkreis · 15 min/);
assert.match(valveHtml, /vhist-state-on valve-space/);
assert.match(valveHtml, /vhist-state-on valve-dhw/);
assert.equal((valveHtml.match(/vhist-state-track/g) || []).length, 2);
assert.match(h.scrubText(valveView, 0), /^X10A .* · Raumkreis\nModbus .* · Raumkreis$/);
assert.match(h.scrubText(valveView, 2), /^X10A .* · Warmwasser\nModbus .* · Warmwasser$/);
h.histSeriesToggle("valve_dhw", "modbus");
assert.equal((h.histHtml("valve_dhw", "", "3-Wege-Ventil").match(/vhist-state-track/g) || []).length, 1);
assert.match(h.scrubText(h.historyView("valve_dhw"), 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Raumkreis$/);
assert.match(h.scrubText(h.historyView("valve_dhw"), 2), /^\d{2}:\d{2}–\d{2}:\d{2} · Warmwasser$/);
S.histHidden.delete("valve_dhw");

// The legacy history id `valve_heat` stores the optional 2-way/heating-cooling OUTPUT. It is not the
// configured/current operating mode, so the timeline must retain ON/OFF and never turn idle periods
// into a Cooling position (or ON into proof of Heating).
S.hist.set("valve_heat", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000, b0: 200,
  held: [], v: [0, 0, 10, 10, 0, 10] });
const valve2View = h.historyView("valve_heat");
const valve2Html = h.histHtml("valve_heat", "", "Ausgang 2-Wege-/Absperrventil");
assert.equal(valve2View.series.length, 1);
assert.match(valve2Html, /2WV-Ausgang An · 15 min · 2WV-Ausgang Aus · 15 min/);
assert.match(valve2Html, /vhist-state-on state-off/);
assert.match(valve2Html, /vhist-state-on valve2-on/);
assert.doesNotMatch(valve2Html, /Kühlstellung|Heizstellung|>Kühlen<|>Heizen</);
assert.match(h.scrubText(valve2View, 0), /^\d{2}:\d{2}–\d{2}:\d{2} · Aus$/);
assert.match(h.scrubText(valve2View, 2), /^\d{2}:\d{2}–\d{2}:\d{2} · An$/);

// Every categorical timeline uses the same live-cap contract, including derived BUH and the MQTT
// circulation witness. Structural concepts are mandatory; no label matching or cross-source
// borrowing may turn an unavailable current state into a plausible one.
S.status.hp = { connected: true };
S.status.circulation_source = {
  configured: true, has_value: true, fresh: true, state: "on",
};
S._values = [
  { concept: "defrost_state", binary: true, value: 1 },
  { concept: "quiet_state", binary: true, value: 1 },
  { concept: "bsh_state", binary: true, value: 1 },
  { concept: "tank_preheat_state", binary: true, value: 1 },
  { concept: "buh_step1", binary: true, value: 0 },
  { concept: "buh_step2", binary: true, value: 1 },
  { concept: "valve_dhw", binary: true, value: 1 },
  { concept: "valve_heat", binary: true, value: 1 },
  { concept: "water_flow_switch", binary: true, value: 1 },
  { binary_semantic: "smart_grid_contact_1", binary: true, value: 1 },
  { binary_semantic: "smart_grid_contact_2", binary: true, value: 0 },
];
S._modbus = [
  { concept: "quiet_state", binary: true, value: 1 },
  { concept: "bsh_state", binary: true, value: 1 },
  { concept: "valve_dhw", binary: true, value: 1 },
  { off: 56, value: 2, enum: "smart_grid_mode" },
  { off: 33, history: "disinfection_state", binary: true, value: 1 },
];
S.hist.set("water_flow_switch", { at: 1, gen: 1, dt: 300, unit: "", t0: 1768720000,
  b0: 200, held: [], v: [0, 0, 10, 0] });
const liveStateCases = [
  ["defrost_state", "x10a", 10],
  ["quiet_state", "x10a", 10],
  ["smart_grid_mode", "modbus", 20],
  ["bsh_state", "x10a", 10],
  ["tank_preheat_state", "x10a", 10],
  ["disinfection_state", "modbus", 10],
  ["buh_state", "x10a", 20],
  ["valve_dhw", "x10a", 10],
  ["circulation_state", "x10a", 10],
  ["valve_heat", "x10a", 10],
  ["water_flow_switch", "x10a", 10],
];
for (const [id, primarySource, expected] of liveStateCases) {
  const stateView = h.historyView(id);
  const primary = stateView.series.find((s) => s.source === primarySource);
  assert.equal(primary.v.at(-1), expected, `${id} must append its current structural state`);
  assert.equal(stateView.liveIndex, stateView.recordedN, `${id} must identify the live boundary`);
  const stateHtml = h.histHtml(id, "", id);
  assert.match(stateHtml, /vhist-state-current/, `${id} must visibly delimit the live cap`);
  assert.match(h.scrubText(stateView, stateView.liveIndex), /jetzt/,
    `${id} must expose the current state at the right edge tooltip`);
}
assert.match(h.histHtml("bsh_state", "", "Heizstab"),
  /Heizstab aktiv erfasst · 10 min im 5-Minuten-Raster/,
  "the live BSH observation must not add a fabricated five-minute bucket to its total");
delete S._values;
delete S._modbus;
delete S.status.hp;
delete S.status.circulation_source;

// Bucket alignment, not array index: Modbus starts one raster later and must leave the first slot
// empty rather than sliding its first sample under the older X10A point.
S.hist.set("modbus:dhw_tank", { ...modbus, b0: 101, v: [455, 456] });
view = h.historyView("dhw_tank");
assert.deepEqual(Array.from(view.series.find((s) => s.source === "modbus").v), [null, 455, 456]);

// A model/X10A outage can leave only the HomeHub ring. It still renders, and the visible legend
// names its source rather than making a petrol line depend on colour recognition.
S.status.history.rows = [];
S.hist.delete("dhw_tank");
view = h.historyView("dhw_tank");
assert.equal(view.series.length, 1);
assert.equal(view.series[0].source, "modbus");
assert.match(h.histHtml("dhw_tank", "°C", "Warmwasserspeichertemperatur"), /vhist-source mb[^>]*><i><\/i>Modbus/);

// The second ring is a distinct wire request and cache key; without the source query it would fetch
// X10A twice and draw two differently coloured copies of the same instrument.
S.hist.delete("modbus:dhw_tank");
await h.ensureHist("dhw_tank", "modbus");
assert.equal(fetched, "/history?row=dhw_tank&source=modbus");
assert.deepEqual(Array.from(S.hist.get("modbus:dhw_tank").v), [457]);

// DHW tank (R5T) single integrated chart: Smart-Grid Boost and Heizstab (BSH) phases
// are drawn directly into the temperature chart and displayed in the tooltip and legend.
S.status.history.rows = [
  { id: "dhw_tank", label: "Domestic Hot Water temperature" },
  { id: "smart_grid_mode", label: "Smart Grid operation mode" },
];
S.status.history.modbus_rows = [
  { id: "dhw_tank", label: "Domestic Hot Water temperature" },
  { id: "smart_grid_mode", label: "Smart Grid operation mode" },
  { id: "bsh_state", label: "Booster heater run" },
];
S.hist.delete("modbus:dhw_tank");
S.hist.set("dhw_tank", { dt: 300, unit: "°C", b0: 100, v: [450, 460, 470, 480], held: [] });
S.hist.set("modbus:smart_grid_mode", { dt: 300, b0: 100, v: [0, 20, 20, 0] }); // Mode 2 = Boost (2 buckets = 10 min)
S.hist.set("modbus:bsh_state", { dt: 300, b0: 100, v: [0, 0, 10, 0] });        // BSH active (1 bucket = 5 min)

view = h.historyView("dhw_tank");
const dhwHtml = h.histHtml("dhw_tank", "°C", "Warmwasserspeicher");
assert.match(dhwHtml, /class="vhist-phase vhist-phase-boost"/, "DHW chart must render Boost phase bands");
assert.match(dhwHtml, /class="vhist-phase vhist-phase-bsh"/, "DHW chart must render BSH phase bands");
assert.doesNotMatch(dhwHtml, /class="vhist-phase-bar/, "DHW chart must not render top phase bar");
assert.match(dhwHtml, /vhist-legend-boost/, "DHW legend must display Boost indicator");
assert.match(dhwHtml, /vhist-legend-bsh/, "DHW legend must display BSH indicator");
assert.match(dhwHtml, /10 min/, "DHW legend must include Boost duration");
assert.match(dhwHtml, /5 min/, "DHW legend must include BSH duration");
{
  const sgKey = "modbus:smart_grid_mode";
  const bshKey = "modbus:bsh_state";
  const sgRing = S.hist.get(sgKey);
  const bshRing = S.hist.get(bshKey);
  S.hist.set(sgKey, { dt: 300, b0: 100, v: [0, 0, 0, 0], refreshFailed: true });
  S.hist.set(bshKey, { dt: 300, b0: 100, v: [0, 0, 0, 0], refreshFailed: true });
  const inactiveRetained = h.histHtml("dhw_tank", "°C", "Tank");
  assert.doesNotMatch(inactiveRetained, /Empfehlung ein|Heizstab aktiv|Letzter empfangener Messwert|Verlauf nicht verfügbar/,
    "inactive retained auxiliary rings must not add prose or legend items");
  S.hist.set(sgKey, { err: true, v: [] });
  S.hist.set(bshKey, { err: true, v: [] });
  const erroredAux = h.histHtml("dhw_tank", "°C", "Tank");
  assert.doesNotMatch(erroredAux, /Empfehlung ein|Heizstab aktiv|Letzter empfangener Messwert|Verlauf nicht verfügbar/,
    "errored auxiliary rings must not pollute the DHW tank legend");
  S.hist.set(sgKey, { ...sgRing, refreshFailed: true });
  S.hist.set(bshKey, bshRing);
  const activeRetained = h.histHtml("dhw_tank", "°C", "Tank");
  const activeRetainedLegend = activeRetained.slice(
    activeRetained.indexOf("vhist-legend"),
    activeRetained.indexOf("vhist-graph"),
  );
  assert.equal((activeRetainedLegend.match(/Empfehlung ein · Modbus/g) || []).length, 1,
    "active retained auxiliary phase appears once with its colour swatch and duration");
  assert.doesNotMatch(activeRetained, /Letzter empfangener Messwert/,
    "active retained auxiliary phase does not repeat retained status prose");
  S.hist.set(sgKey, sgRing);
}

// Verify tooltips include active phases
assert.doesNotMatch(h.scrubText(view, 0), /Boost|Heizstab/, "Sample 0 without active phases");
assert.match(h.scrubText(view, 1), /(?:· |\n)Empfehlung ein · Modbus$/, "Sample 1 with active Boost");
assert.match(h.scrubText(view, 2), /(?:· |\n)Empfehlung ein · Modbus \+ Heizstab aktiv · Modbus$/,
  "sample 2 identifies the source of both active phases");
assert.equal(h.histReadout(view, 1), "46,0 °C · Empfehlung ein · Modbus",
  "a single visible curve appends active phase to value readout");
{
  S.hist.set("modbus:dhw_tank", { dt: 300, unit: "°C", b0: 100, v: [450, 460, 470, 480], held: [] });
  const pairedView = h.historyView("dhw_tank");
  assert.match(h.histReadout(pairedView, 1), /<span class="vhist-tip-note">Empfehlung ein · Modbus<\/span>/,
    "active auxiliary phase renders as note row below tabular values when multiple series are shown");
  S.hist.delete("modbus:dhw_tank");
  S.histHidden.delete("dhw_tank");
}
assert.doesNotMatch(h.scrubText(view, 3), /Boost|Heizstab/, "Sample 3 without active phases");
{
  const tank = S.hist.get("dhw_tank");
  const boost = S.hist.get("modbus:smart_grid_mode");
  S.hist.set("dhw_tank", { ...tank, b0: null, t0: 1768720000 });
  S.hist.set("modbus:smart_grid_mode", { ...boost, b0: null, t0: 1768720000 });
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /vhist-phase-boost/,
    "wall-aligned auxiliary phases remain overlaid on the shared tank chart");
  S.hist.set("dhw_tank", { ...tank, b0: -4, t0: 1768720000 });
  S.hist.set("modbus:smart_grid_mode", { ...boost, b0: -4, t0: 1768720007 });
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /Empfehlung ein · Modbus/,
    "restored pre-boot HomeHub auxiliary phases remain visible on the shared tank chart");
  S.hist.set("smart_grid_mode", { ...boost, b0: -4 });
  assert.match(h.histHtml("dhw_tank", "°C", "Tank"), /Empfehlung ein · X10A/,
    "the X10A restored boot raster also preserves its auxiliary phase");
  S.hist.delete("smart_grid_mode");
  S.hist.set("dhw_tank", tank);
  S.hist.set("modbus:smart_grid_mode", boost);
}
{
  S.hist.set("smart_grid_mode", { dt: 300, b0: 100, v: [20, 20, 0, 0] });
  S.hist.set("bsh_state", { dt: 300, b0: 100, v: [0, 10, 0, 0] });
  const independent = h.historyView("dhw_tank");
  const html = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(html, /vhist-phase-boost vhist-phase-outline/);
  assert.match(html, /Empfehlung ein · X10A <small[^>]+>\(10 min\)/);
  assert.match(html, /Empfehlung ein · Modbus <small[^>]+>\(10 min\)/);
  assert.match(h.scrubText(independent, 0), /Empfehlung ein · X10A$/,
    "an active X10A bucket remains visible alongside an inactive HomeHub bucket");
  assert.match(h.scrubText(independent, 1), /Empfehlung ein · X10A \+ Empfehlung ein · Modbus \+ Heizstab aktiv · X10A$/);
  assert.match(h.scrubText(independent, 2), /Empfehlung ein · Modbus \+ Heizstab aktiv · Modbus$/,
    "an inactive X10A bucket cannot conceal an active HomeHub heater sample");

  // When both X10A and Modbus tank temperature curves exist, toggling Modbus off hides its phase
  // bands, legend swatches, and readout notes while keeping X10A phases visible.
  S.hist.set("modbus:dhw_tank", { dt: 300, unit: "°C", b0: 100, v: [450, 460, 470, 480], held: [] });
  h.histSeriesToggle("dhw_tank", "modbus");
  const modbusHiddenHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(modbusHiddenHtml, /Empfehlung ein · X10A <small[^>]+>\(10 min\)/);
  assert.match(modbusHiddenHtml, /Heizstab aktiv · X10A <small[^>]+>\(5 min\)/);
  assert.doesNotMatch(modbusHiddenHtml, /Empfehlung ein · Modbus|Heizstab aktiv · Modbus/,
    "hiding Modbus in the tank legend hides Modbus phase bands and swatches");
  assert.doesNotMatch(modbusHiddenHtml, /vhist-phase-outline/,
    "unpaired visible Boost phase drops the concurrent-lane outline");
  const modbusHiddenView = h.historyView("dhw_tank");
  assert.doesNotMatch(h.scrubText(modbusHiddenView, 1), /Modbus/);
  assert.match(h.scrubText(modbusHiddenView, 1), /Empfehlung ein · X10A \+ Heizstab aktiv · X10A$/);
  assert.equal(h.histReadout(modbusHiddenView, 2), "47,0 °C",
    "hiding Modbus omits Modbus phase notes at slot 2");
  h.histSeriesToggle("dhw_tank", "modbus");
  const restoredHtml = h.histHtml("dhw_tank", "°C", "Tank");
  assert.match(restoredHtml, /Empfehlung ein · Modbus <small[^>]+>\(10 min\)/);
  assert.match(restoredHtml, /Heizstab aktiv · Modbus <small[^>]+>\(5 min\)/);

  S.histHidden.delete("dhw_tank");
  S.hist.delete("modbus:dhw_tank");
  S.hist.delete("smart_grid_mode");
  S.hist.delete("bsh_state");
}

// ensureHistPair("dhw_tank") fetches auxiliary series
fetchedUrls = [];
S.hist.delete("dhw_tank");
S.hist.delete("modbus:dhw_tank");
S.hist.delete("smart_grid_mode");
S.hist.delete("modbus:smart_grid_mode");
S.hist.delete("bsh_state");
S.hist.delete("modbus:bsh_state");
await h.ensureHistPair("dhw_tank");
assert.ok(fetchedUrls.includes("/history?row=smart_grid_mode"),
  "ensureHistPair(dhw_tank) must request x10a smart_grid_mode");
assert.ok(fetchedUrls.includes("/history?row=smart_grid_mode&source=modbus"),
  "ensureHistPair(dhw_tank) must request smart_grid_mode");
assert.ok(fetchedUrls.includes("/history?row=bsh_state&source=modbus"),
  "ensureHistPair(dhw_tank) must request modbus:bsh_state");

// Lifecycle regression: changing away and back retires the cache even inside its one-minute TTL.
// Every transition runs the same production synchronisation used when /status lands.
S.status.profile = { id: "fixture-a" };
S.status.hp = { proto: "I", rx: 1, tx: 2 };
S.status.modbus = { host: "192.0.2.10", port: 502, unit_id: 1, enabled: true };
S.status.uptime_s = 100;
h.syncHistSources();
fetchedUrls = [];
historyResponse = { ...defaultHistoryResponse, b0: undefined, boot_b0: -1, v: [501] };
await h.ensureHist("dhw_tank", "modbus");
const homehubKey = h.histCacheKey("dhw_tank", "modbus");
await h.ensureHist("dhw_tank", "modbus");
assert.equal(fetchedUrls.length, 1, "unchanged source must retain the one-minute fetch limit");
S.histPin.set("dhw_tank", { i: 0, gen: 1 });
S.status.modbus.host = "192.0.2.11";
h.syncHistSources();
assert.equal(S.hist.size, 0);
assert.equal(S.histPin.size, 0, "source changes must retire pins with the old measurement");
S.status.modbus.host = "192.0.2.10";
h.syncHistSources();
historyResponse = { ...defaultHistoryResponse, b0: undefined, boot_b0: -1, v: [502] };
await h.ensureHist("dhw_tank", "modbus");
assert.deepEqual(Array.from(S.hist.get(homehubKey).v), [502],
  "A → B → A must refetch instead of reusing the earlier A lifetime");
for (const enabled of [false, true]) {
  S.status.modbus.enabled = enabled;
  h.syncHistSources();
}
assert.equal(S.hist.has(homehubKey), false, "disabled → A must retire the old A cache");

// Row ids stay stable when the X10A instrument or circulation witness changes. Identity comes from
// their actual status/configuration, never from a different label invented by the browser.
S.hist.set("dhw_tank", x10a);
S.status.hp.rx = 44;
h.syncHistSources();
assert.equal(S.hist.has("dhw_tank"), false, "repointing X10A pins must retire the old ring");
S.hist.set("dhw_tank", x10a);
S.status.profile.id = "fixture-b";
h.syncHistSources();
assert.equal(S.hist.has("dhw_tank"), false, "a new X10A profile must retire the old ring");
S.status.circulation_source = { configured: true, topic: "fixture/pump-a", power_path: "power" };
h.syncHistSources();
S.hist.set("circulation_state", x10a);
S.status.circulation_source.topic = "fixture/pump-b";
h.syncHistSources();
assert.equal(S.hist.has("circulation_state"), false,
  "changing a circulation witness must retire history even though its row id is unchanged");
S.hist.set("free_heap", x10a);
S.histPin.set("free_heap", { i: 0, gen: 1 });
S.status.uptime_s = 2;
h.syncHistSources();
assert.equal(S.hist.size, 0, "a reboot must retire all cached series before their monotonic epoch changes");
assert.equal(S.histPin.size, 0);

// Uptime alone cannot detect a reboot that returns after exceeding its last observed uptime.
S.status.boot_id = "0000000000000001";
h.syncHistSources();
S.hist.set("free_heap", x10a);
S.histPin.set("free_heap", { i: 0, gen: 1 });
S.status.boot_id = "0000000000000002";
S.status.uptime_s = 3;
h.syncHistSources();
assert.equal(S.hist.size, 0, "a new boot identity must retire history even with higher uptime");
assert.equal(S.histPin.size, 0);

// Another client can change A → B → A entirely between status polls. The firmware lifetime
// token changes even if the final configuration and boot identity match the previous sample.
S.status.history = { ...S.status.history, epoch: 7 };
h.syncHistSources();
S.hist.set(homehubKey, x10a);
S.histPin.set("dhw_tank", { i: 0, gen: 1 });
S.status.history.epoch = 9;
h.syncHistSources();
assert.equal(S.hist.size, 0, "an unobserved source ABA must retire the old firmware lifetime");
assert.equal(S.histPin.size, 0);

for (const identity of [{ boot_id: "0000000000000001" }, { epoch: 8 }]) {
  S.histAwait?.clear();
  historyResponse = { ...defaultHistoryResponse, b0: undefined, boot_b0: -1, v: [519], ...identity };
  await h.ensureHist("dhw_tank", "modbus");
  assert.equal(S.hist.has(homehubKey), false, "a mismatched wire lifetime cannot replace the cache");
  assert.ok(S.histAwait.has(homehubKey), "the request waits for an accepted status frame");
}
S.histAwait.clear();

// Hold the transport while the source leaves and returns. Both success and failure of the retired
// request must leave its successor's cache/lease alone, even though both use the same endpoint key.
const pendingHistory = [];
context.fetch = (url) => new Promise((resolve, reject) => pendingHistory.push({ url, resolve, reject }));
const finishHistory = (pending, values) =>
  pending.resolve(historyReply(pending.url, { ...defaultHistoryResponse, b0: undefined,
    boot_b0: -values.length, v: values }));
for (const failOld of [false, true]) {
  h.invalidateHistSources();
  const old = h.ensureHist("dhw_tank", "modbus");
  const oldTransport = pendingHistory.shift();
  S.status.modbus.host = "192.0.2.11"; h.syncHistSources();
  S.status.modbus.host = "192.0.2.10"; h.syncHistSources();
  const current = h.ensureHist("dhw_tank", "modbus");
  if (failOld) oldTransport.reject(new Error("retired source error"));
  else finishHistory(oldTransport, [601]);
  await old;
  assert.equal(S.hist.has(homehubKey), false, "late success/error must not reinsert the retired series");
  assert.equal(S.histBusy.has(homehubKey), true,
    "an old finally must not release the new request for the same cache key");
  finishHistory(pendingHistory.shift(), [602]);
  await current;
  assert.deepEqual(Array.from(S.hist.get(homehubKey).v), [602]);
  assert.equal(S.histBusy.has(homehubKey), false);
}

// A derived chart owns a lease too: awaiting its independent input fetches cannot revive an old
// instrument lifetime after the source changed while those requests were outstanding.
S.status.history.rows = [
  { id: "leaving_water", label: "Leaving water temperature" },
  { id: "return_water", label: "Return water temperature" },
];
h.invalidateHistSources();
const oldDerived = h.ensureDerived("dt");
const retiredInputs = pendingHistory.splice(0);
assert.equal(retiredInputs.length, 1);
S.status.profile.id = "fixture-c";
h.syncHistSources();
for (const input of retiredInputs) finishHistory(input, [400]);
await oldDerived;
assert.equal(S.hist.has("dt"), false, "late derived assembly must not revive a retired source");
assert.equal(S.hist.size, 0, "late derived inputs must also stay retired");
const currentDerived = h.ensureDerived("dt");
for (const value of [410, 390]) {
  assert.equal(pendingHistory.length, 1);
  finishHistory(pendingHistory.shift(), [value]);
  await new Promise(resolve => setImmediate(resolve));
}
await currentDerived;
assert.deepEqual(Array.from(S.hist.get("dt").v), [20], "the successor must derive only its own inputs");

// MQTT room mapping and broker identity own the lifetime independently of X10A and HomeHub.
S.status.history.room_rows = [{ id: "room_temp", label: "Example room" }];
S.status.reference_temperature = { configured: true, name: "Example room", topic: "fixture/room-a",
  temperature_path: "temperature", timestamp_topic: "fixture/time", timestamp_path: "time" };
S.status.mqtt = { configured: true, broker: "mqtt://broker-a.invalid" };
h.syncHistSources();
S.hist.set("room:room_temp", { gen: 1, dt: 300, unit: "°C", b0: 100, v: [236] });
S.histPin.set("room_temp", { i: 0, gen: 1 });
S.status.reference_temperature.fresh = false;
h.syncHistSources();
assert.equal(S.hist.has("room:room_temp"), true,
  "a transient stale sample cannot erase already measured history");
S.status.reference_temperature.name = "Renamed room";
S.status.history.room_rows[0].label = "Renamed room";
h.syncHistSources();
assert.equal(S.hist.has("room:room_temp"), true, "renaming does not change the measuring instrument");
assert.match(h.histHtml("room_temp", "°C", "Raumtemperatur"), /Renamed room · MQTT/);
S.status.reference_temperature.topic = "fixture/room-b";
h.syncHistSources();
assert.equal(S.hist.size, 0);
assert.equal(S.histPin.size, 0, "a replaced MQTT instrument retires its old cursor");
S.status.reference_temperature.topic = "fixture/room-a";
h.syncHistSources();
const oldRoom = h.ensureHist("room_temp", "room");
const retiredRoom = pendingHistory.shift();
S.status.mqtt.broker = "mqtt://broker-b.invalid"; h.syncHistSources();
S.status.mqtt.broker = "mqtt://broker-a.invalid"; h.syncHistSources();
const newRoom = h.ensureHist("room_temp", "room");
finishHistory(retiredRoom, [200]);
await oldRoom;
assert.equal(S.hist.has("room:room_temp"), false, "late MQTT history cannot revive its old broker");
assert.equal(S.histBusy.has("room:room_temp"), true, "old completion cannot release the new MQTT lease");
finishHistory(pendingHistory.shift(), [237]);
await newRoom;
assert.deepEqual(Array.from(S.hist.get("room:room_temp").v), [237]);
S.status.history.room_rows = [];
S.status.reference_temperature.configured = false;
h.syncHistSources();
assert.equal(S.hist.size, 0, "deleting a room mapping retires its cached readings");
assert.equal(h.histHtml("room_temp", "°C", "Raumtemperatur"), "");

// Reserving tooltip shapes must scan the auxiliary day once, not once per sample. A later render
// reads changed auxiliary data from the next view. A mounted view keeps its own phase evidence.
S.status.history = { rows: ["dhw_tank", "smart_grid_mode", "bsh_state"].map(id => ({id, label:id})),
  modbus_rows: [] };
S.hist.clear();
const fullRing = value => ({gen:1,dt:300,b0:100,unit:"°C",v:Array(288).fill(value)});
S.hist.set("dhw_tank", fullRing(450));
S.hist.set("smart_grid_mode", fullRing(20));
S.hist.set("bsh_state", fullRing(10));
vm.runInContext("this.originalAuxScan = dhwAuxPhases; this.auxScans = 0; " +
  "dhwAuxPhases = (...args) => { auxScans++; return originalAuxScan(...args); };", context);
try {
  const view = h.historyView("dhw_tank");
  const first = h.histTipsHtml(view, -1, 0);
  assert.equal(context.auxScans, 1, "288 tooltip readouts must share one auxiliary scan");
  assert.match(first, /Empfehlung ein/);
  assert.match(first, /Heizstab aktiv/);
  S.hist.set("smart_grid_mode", { ...fullRing(0), gen: 2 });
  const refreshed = h.historyView("dhw_tank");
  assert.notEqual(h.histViewRevision(view), h.histViewRevision(refreshed));
  assert.equal(h.scrubIndex({ dataset: { hist: "dhw_tank", rev: h.histViewRevision(view) } }, 4), -1);
  const second = h.histTipsHtml(refreshed, -1, 0);
  assert.equal(context.auxScans, 2, "the next rendered view must refresh its auxiliary snapshot");
  assert.doesNotMatch(second, /Empfehlung ein/);
  assert.match(second, /Heizstab aktiv/);
  // Re-seed the previous per-readout work: the same measured operation budget must reject it.
  vm.runInContext("this.originalReadout = histReadout; auxScans = 0; " +
    "histReadout = (view, index) => originalReadout(view, index, dhwAuxPhases(view));", context);
  h.histTipsHtml(refreshed, -1, 0);
  assert.ok(context.auxScans >= 289, "the old per-sample scan must exceed the one-scan budget");
} finally {
  vm.runInContext("dhwAuxPhases = originalAuxScan; " +
    "if (this.originalReadout) histReadout = originalReadout;", context);
}

// Paket 1 Modbus state timelines + phase count and strictly source-isolated Modbus dt / pth derived trends.
{
  const prevStatus = JSON.parse(JSON.stringify(S.status));
  const prevHist = new Map(S.hist);
  const prevModbus = S._modbus;
  S.status.hp = { connected: false };
  S.status.modbus = { enabled: true, connected: true, host: "hub-1", profile: "homehub", profile_basis: "affirmative" };
  S.status.history = {
    rows: [],
    modbus_rows: ["leaving_water", "return_water", "flow", "compressor_state", "modbus_power",
                  "modbus_defrost_state", "pump_state"].map((id) => ({ id, label: id })),
  };
  h.syncHistSources();
  S.hist.set("leaving_water", { at: Date.now(), gen: 99, dt: 300, unit: "°C", b0: 10, held: [], v: [900, 900] });
  S.hist.set(h.histCacheKey("leaving_water", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "°C", b0: 10, held: [], v: [350, 350, 360] });
  S.hist.set(h.histCacheKey("return_water", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "°C", b0: 10, held: [], v: [300, 300, 310] });
  S.hist.set(h.histCacheKey("flow", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "L/min", b0: 10, held: [], v: [120, 120, 0] });
  S.hist.set(h.histCacheKey("compressor_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 0, 10, 10, 0, 10] });
  S.hist.set(h.histCacheKey("modbus_defrost_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
  S.hist.set(h.histCacheKey("pump_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 10, 0] });
  S.hist.set(h.histCacheKey("modbus_power", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "kW", b0: 10, held: [], v: [14, 15, 0] });
  assert.equal(h.hasModbusHist("dt"), true);
  assert.equal(h.hasModbusHist("pth"), true);
  await h.ensureDerived("dt", "modbus");
  await h.ensureDerived("pth", "modbus");
  assert.deepEqual(Array.from(S.hist.get(h.histCacheKey("dt", "modbus")).v), [50, 50, 50],
    "modbus:dt must use only Modbus temperatures without X10A mixing");
  assert.deepEqual(Array.from(S.hist.get(h.histCacheKey("pth", "modbus")).v.slice(0, 3)), [42, null, 0],
    "modbus:pth computes power only when compressor_state is active and keeps stopped flow at zero");
  const pthKey = h.histCacheKey("pth", "modbus");
  const verifiedHist = new Map(S.hist);
  const verifiedPth = S.hist.get(pthKey);
  const verifiedModbus = { ...S.status.modbus };
  const verifiedRows = S._modbus;
  for (const [label, mbStatus, mbRows] of [
    ["altherma4 fallback", { enabled: true, connected: true, host: "hub-1", profile: "altherma4", profile_basis: "fallback" },
      [{ off: 49, profile: "altherma4", flow_scale_unverified: true }]],
    ["auto probing", { enabled: true, connected: true, host: "hub-1", profile: "auto", profile_basis: "probing" }, []],
    ["homehub fallback", { enabled: true, connected: true, host: "hub-1", profile: "homehub", profile_basis: "fallback" }, []],
    ["sweep-bound unverified row49", { enabled: true, connected: true, host: "hub-1", profile: "homehub", profile_basis: "affirmative" },
      [{ off: 49, profile: "homehub", flow_scale_unverified: true }]],
  ]) {
    S.status.modbus = mbStatus;
    h.syncHistSources();
    S._modbus = mbRows;
    S.hist.clear();
    for (const [k, v] of verifiedHist) S.hist.set(k, v);
    S.hist.set(pthKey, verifiedPth);
    assert.equal(h.hasModbusHist("pth"), false, `${label}: modbus:pth must be withheld`);
    assert.equal(h.hasModbusHist("flow"), true, `${label}: modbus:flow remains offered`);
    assert.match(h.histHtml("flow", "L/min", "Flow rate", "modbus"), /vhist-note/,
      `${label}: modbus:flow renders unverified scaling caveat`);
    const pthView = h.historyView("pth");
    assert.equal(pthView?.series?.some((s) => s.source === "modbus") ?? false, false,
      `${label}: historyView("pth") excludes modbus even with stale cache`);
    S.hist.delete(pthKey);
    await h.ensureDerived("pth", "modbus");
    assert.equal(S.hist.has(pthKey), false,
      `${label}: ensureDerived("pth", "modbus") refuses to repopulate S.hist`);
  }
  S.status.modbus = verifiedModbus;
  h.syncHistSources();
  S._modbus = verifiedRows;
  S.hist.clear();
  for (const [k, v] of verifiedHist) S.hist.set(k, v);
  assert.match(h.histHtml("compressor_state", "", "Verdichter"), /3 Phasen/,
    "compressor_state summary renders observed active phase count");
  assert.match(h.histHtml("modbus_defrost_state", "", "Abtauen"), /vhist-state-track modbus/);
  assert.match(h.histHtml("pump_state", "", "Pumpe"), /vhist-state-track modbus/);
  assert.match(h.histHtml("modbus_power", "kW", "Leistungsaufnahme"), /data-source="modbus"/);
  // When single-sweep X10A pel and cop trends are offered alongside HomeHub modbus_power,
  // pel pairs both series onto one shared chart (preserving compressor-idle held-over pauses on
  // X10A) while cop stays strictly X10A-only.
  S.status.hp = { connected: true };
  S.status.history.rows = [
    { id: "pel", label: "Electrical input (estimated)" },
    { id: "cop", label: "COP (estimated)" },
  ];
  h.syncHistSources();
  S.hist.set("pel", { at: Date.now(), gen: 1, dt: 300, unit: "kW", b0: 10, held: [[0, 1]], v: [null, 17, 19] });
  S.hist.set("cop", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [[0, 1]], v: [null, 31, 34] });
  assert.equal(h.hasHist("pel"), true);
  assert.equal(h.hasModbusHist("pel"), true);
  assert.equal(h.hasHist("cop"), true);
  assert.equal(h.hasModbusHist("cop"), false);
  const pelView = h.historyView("pel");
  assert.deepEqual(Array.from(pelView.series, s => s.source), ["x10a", "modbus"],
    "pel overlays single-sweep X10A estimate and HomeHub modbus_power on one shared chart");
  assert.deepEqual(Array.from(pelView.series[0].held, r => Array.from(r)), [[0, 1]],
    "X10A pel preserves compressor-idle held-over pauses");
  const pelHtml = h.histHtml("pel", "kW", "Stromaufnahme");
  assert.equal((pelHtml.match(/data-hist="pel"/g) || []).length, 1);
  assert.match(pelHtml, /data-hist-series="modbus" aria-pressed="true"/);
  assert.match(pelHtml, /class="vhist-line mb"/);
  assert.doesNotMatch(pelHtml, /Stillstand|nicht gemessen|vhist-idle|vhist-gap/);
  assert.equal(h.scrubText(pelView, 0, false), "Modbus 1,4 kW",
    "held X10A compressor-idle slot is omitted while active Modbus power remains in the tooltip");
  const copView = h.historyView("cop");
  assert.deepEqual(Array.from(copView.series, s => s.source), ["x10a"]);
  assert.deepEqual(Array.from(copView.series[0].held, r => Array.from(r)), [[0, 1]],
    "X10A cop preserves compressor-idle held-over pauses");
  const copHtml = h.histHtml("cop", "", "COP");
  assert.equal((copHtml.match(/data-hist="cop"/g) || []).length, 1);

  // Added Modbus numeric setpoints/offsets/power limits and categorical active-state timelines.
  S.status.history.modbus_rows = [
    ...S.status.history.modbus_rows,
    ...["modbus_lwt_heat_setpoint", "modbus_lwt_heat_offset", "modbus_general_power_limit",
      "modbus_dhw_state", "modbus_space_state", "modbus_hot_start_state", "modbus_dhw_booster_state"]
      .map((id) => ({ id, label: id })),
  ];
  h.syncHistSources();
  S.hist.set(h.histCacheKey("modbus_lwt_heat_setpoint", "modbus"),
    { at: Date.now(), gen: 1, dt: 300, unit: "°C", b0: 10, held: [], v: [350, 360, 350] });
  S.hist.set(h.histCacheKey("modbus_lwt_heat_offset", "modbus"),
    { at: Date.now(), gen: 1, dt: 300, unit: "K", b0: 10, held: [], v: [-20, 0, 20] });
  S.hist.set(h.histCacheKey("modbus_general_power_limit", "modbus"),
    { at: Date.now(), gen: 1, dt: 300, unit: "kW", b0: 10, held: [], v: [60, 45, 60] });
  for (const id of ["modbus_dhw_state", "modbus_space_state", "modbus_hot_start_state", "modbus_dhw_booster_state"]) {
    S.hist.set(h.histCacheKey(id, "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
  }
  S._modbus = [
    { off: 52, history: "modbus_dhw_state", binary: true, value: 1 },
    { off: 53, history: "modbus_space_state", binary: true, value: 0 },
    { off: 36, history: "modbus_hot_start_state", binary: true, value: 1 },
    { off: 13, history: "modbus_dhw_booster_state", binary: true, value: 0 },
  ];
  const spHtml = h.histHtml("modbus_lwt_heat_setpoint", "°C", "Heiz-Vorlaufsollwert der Hauptzone");
  assert.match(spHtml, /data-source="modbus"/);
  assert.match(spHtml, /35,0 – 36,0 °C/);
  const offHtml = h.histHtml("modbus_lwt_heat_offset", "K", "Vorlaufkorrektur der Haupt-Heizzone");
  assert.match(offHtml, /data-source="modbus"/);
  assert.match(offHtml, /-2,0 – 2,0 K/);
  assert.match(h.histHtml("modbus_general_power_limit", "kW", "Allgemeine Leistungsgrenze"),
    /data-source="modbus"/);
  for (const [id, title, cls, liveOn] of [
    ["modbus_dhw_state", "Warmwasserbetrieb", "valve-dhw", true],
    ["modbus_space_state", "Raumheiz- oder Kühlbetrieb", "comp-on", false],
    ["modbus_hot_start_state", "Warmstart", "heater-on", true],
    ["modbus_dhw_booster_state", "Warmwasser-Booster-Modus", "heater-on", false],
  ]) {
    const stateHtml = h.histHtml(id, "", title);
    assert.match(stateHtml, /vhist-state-track modbus/, `${id} renders Modbus track`);
    assert.match(stateHtml, new RegExp(`class="vhist-state-on ${cls}"`), `${id} uses ${cls}`);
    assert.match(stateHtml, /vhist-state-current/, `${id} appends live cap from S._modbus`);
    assert.match(stateHtml, new RegExp(`${h.t("state.on")} · 5 min`), `${id} formats default ON duration`);
    assert.match(stateHtml, new RegExp(`aria-label="${title} \\(${h.t("state.on")} · 5 min\\) — 24-Stunden-Verlauf"`),
      `${id} formats localized aria-label`);
    const v = h.historyView(id);
    assert.equal(v.series[0].v.at(-1), liveOn ? 10 : 0, `${id} live cap reflects S._modbus`);
  }

  // Round-2: 3-way valve enum live-cap fix + Modbus mode/binary/abnormality timelines + paired X10A timelines.
  {
    const prevRows = S.status.history.rows;
    const prevMbRows = S.status.history.modbus_rows;
    const prevValues = S._values;
    const prevHp = S.status.hp;
    const prevMb = { ...S.status.modbus };

    // 1. Enum-backed three_way_valve live cap on valve_dhw must read raw value 0/1 as 0/10, not gap.
    S.status.hp = { connected: false };
    S.status.history.rows = [];
    S.status.history.modbus_rows = [
      ...prevMbRows,
      { id: "valve_dhw", label: "3-way valve" },
      { id: "modbus_current_op_mode", label: "Current operation mode" },
      { id: "modbus_op_mode", label: "Operation mode" },
      { id: "modbus_space_enable_state", label: "Space heating/cooling ON/OFF" },
      { id: "modbus_dhw_reheat_state", label: "DHW reheat ON/OFF" },
      { id: "modbus_abnormality_state", label: "Unit abnormality" },
    ];
    h.syncHistSources();
    S.hist.set(h.histCacheKey("valve_dhw", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
    S._modbus = [{ off: 37, concept: "valve_dhw", enum: "three_way_valve", value: 1 }];
    const enumValveView = h.historyView("valve_dhw");
    assert.equal(enumValveView.series[0].v.at(-1), 10,
      "three_way_valve enum=1 resolves to live cap 10 instead of a hatched missing tail");
    S._modbus = [{ off: 37, concept: "valve_dhw", enum: "three_way_valve", value: 0 }];
    assert.equal(h.historyView("valve_dhw").series[0].v.at(-1), 0,
      "three_way_valve enum=0 resolves to live cap 0");

    // 2. Added Modbus categorical state/enum timelines.
    S.hist.set(h.histCacheKey("modbus_current_op_mode", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 20, 10] });
    S.hist.set(h.histCacheKey("modbus_op_mode", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 20] });
    S.hist.set(h.histCacheKey("modbus_space_enable_state", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
    S.hist.set(h.histCacheKey("modbus_dhw_reheat_state", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 0, 10] });
    S.hist.set(h.histCacheKey("modbus_abnormality_state", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 20, 10] });
    S._modbus = [
      { off: 38, history: "modbus_current_op_mode", enum: "current_operation_mode", value: 2 },
      { off: 3, history: "modbus_op_mode", enum: "operation_mode", value: 0 },
      { off: 4, history: "modbus_space_enable_state", binary: true, value: 1 },
      { off: 12, history: "modbus_dhw_reheat_state", binary: true, value: 0 },
      { off: 21, history: "modbus_abnormality_state", enum: "unit_abnormality", value: 2 },
    ];
    S.status.modbus.profile = "homehub";
    const ekCurHtml = h.histHtml("modbus_current_op_mode", "", "Aktueller Heiz- oder Kühlmodus");
    assert.match(ekCurHtml, /Heizen · 10 min · Kühlen · 5 min/);
    assert.doesNotMatch(ekCurHtml, />Keine</, "EKRHH hides optional None legend item");
    assert.equal(h.historyView("modbus_current_op_mode").series[0].v.at(-1), 20);
    S._modbus[0] = { off: 38, history: "modbus_current_op_mode", enum: "altherma4_current_operation_mode", profile: "altherma4", value: 0 };
    S.status.modbus.profile = "altherma4";
    const a4CurHtml = h.histHtml("modbus_current_op_mode", "", "Aktueller Heiz- oder Kühlmodus");
    assert.match(a4CurHtml, />Keine</, "Altherma 4 shows optional None legend item");
    assert.equal(h.historyView("modbus_current_op_mode").series[0].v.at(-1), 0);
    S.status.modbus.profile = "homehub";
    assert.match(h.histHtml("modbus_op_mode", "", "Betriebsart"), /Auto · 5 min · Heizen · 5 min · Kühlen · 5 min/);
    assert.equal(h.historyView("modbus_op_mode").series[0].v.at(-1), 0);
    assert.match(h.histHtml("modbus_space_enable_state", "", "Raumheizung/-kühlung"), new RegExp(`${h.t("state.on")} · 5 min`));
    assert.equal(h.historyView("modbus_space_enable_state").series[0].v.at(-1), 10);
    assert.match(h.histHtml("modbus_dhw_reheat_state", "", "Speicher-Nachheizung"), new RegExp(`${h.t("state.on")} · 10 min`));
    assert.equal(h.historyView("modbus_dhw_reheat_state").series[0].v.at(-1), 0);
    const abnHtml = h.histHtml("modbus_abnormality_state", "", "Störungszustand");
    assert.match(abnHtml, /Kein Fehler · 5 min · Warnung · 5 min · Fehler · 5 min/);
    assert.equal(h.historyView("modbus_abnormality_state").series[0].v.at(-1), 20);

    // 3. Added X10A mode/binary timelines & paired X10A+Modbus pump/space-op lanes (paired Modbus lanes active by default).
    S.status.hp = { connected: true };
    S.status.history.rows = [
      "ou_op_mode", "iu_op_mode", "thermostat_state", "x10a_pump_state",
      "x10a_space_state", "dhw_reheat_state", "dhw_powerful_state",
    ].map((id) => ({ id, label: id }));
    S.status.history.modbus_rows = [
      ...S.status.history.modbus_rows,
      { id: "modbus_space_state", label: "Space heating/cooling normal operation" },
    ];
    h.syncHistSources();
    S.hist.set("ou_op_mode", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 70] });
    S.hist.set("iu_op_mode", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 40, 50] });
    S.hist.set("thermostat_state", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 10] });
    S.hist.set("x10a_pump_state", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 0, 10] });
    S.hist.set(h.histCacheKey("pump_state", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 10, 0] });
    S.hist.set("x10a_space_state", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
    S.hist.set(h.histCacheKey("modbus_space_state", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [10, 10, 0] });
    S.hist.set("dhw_reheat_state", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 10, 0] });
    S.hist.set("dhw_powerful_state", { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 10, held: [], v: [0, 0, 10] });
    S._values = [
      { concept: "ou_op_mode", value: "Cooling", reg: 0x10 },
      { concept: "iu_op_mode", value: "DHW", reg: 0x60 },
      { concept: "thermostat_state", binary: true, value: 1, reg: 0x60 },
      { concept: "pump_running", binary: true, value: 0, reg: 0x60 },
      { concept: "space_op", binary: true, value: 1, reg: 0x62 },
      { concept: "dhw_reheat_state", binary: true, value: 1, reg: 0x62 },
      { concept: "dhw_powerful_state", binary: true, value: 0, reg: 0x62 },
    ];
    S._modbus = [
      { off: 30, concept: "pump_running", history: "pump_state", binary: true, value: 1 },
      { off: 53, concept: "space_op", history: "modbus_space_state", binary: true, value: 0 },
    ];
    const ouHtml = h.histHtml("ou_op_mode", "", "Betriebsart Außeneinheit");
    assert.match(ouHtml, />Dry</, "optional extra OU mode legend appears when present in ring");
    assert.equal(h.historyView("ou_op_mode").series[0].v.at(-1), 20);
    const iuHtml = h.histHtml("iu_op_mode", "", "I/U-Betriebsart");
    assert.match(iuHtml, /Heizen \+ Warmwasser · 5 min/, "optional I/U combined mode appears when present");
    assert.equal(h.historyView("iu_op_mode").series[0].v.at(-1), 40);
    assert.equal(h.historyView("thermostat_state").series[0].v.at(-1), 10);
    assert.equal(h.historyView("dhw_reheat_state").series[0].v.at(-1), 10);
    assert.equal(h.historyView("dhw_powerful_state").series[0].v.at(-1), 0);

    const pairedPumpView = h.historyView("x10a_pump_state");
    assert.deepEqual(Array.from(pairedPumpView.series, (s) => s.source), ["x10a", "modbus"]);
    assert.equal(pairedPumpView.series[0].v.at(-1), 0);
    assert.equal(pairedPumpView.series[1].v.at(-1), 10);
    const pairedPumpHtml = h.histHtml("x10a_pump_state", "", "Umwälzpumpe");
    assert.equal((pairedPumpHtml.match(/vhist-state-track/g) || []).length, 2,
      "paired x10a_pump_state shows both X10A and Modbus lanes active by default");
    assert.match(pairedPumpHtml, /data-hist-series="modbus" aria-pressed="true"/);

    const pairedSpaceView = h.historyView("x10a_space_state");
    assert.deepEqual(Array.from(pairedSpaceView.series, (s) => s.source), ["x10a", "modbus"]);
    assert.equal(pairedSpaceView.series[0].v.at(-1), 10);
    assert.equal(pairedSpaceView.series[1].v.at(-1), 0);

    // 4. Unified flow 24h chart carries the unverified Modbus caveat only when Input 49 is unverified.
    S.status.history.rows = [];
    S.status.history.modbus_rows = [{ id: "flow", label: "Flow rate" }];
    S.status.modbus = { enabled: true, connected: true, profile: "homehub", profile_basis: "fallback" };
    S._modbus = [{ off: 49, concept: "flow", history: "flow", value: "12.3", unit: "L/min",
      flow_scale_unverified: true }];
    h.syncHistSources();
    S.hist.set(h.histCacheKey("flow", "modbus"),
      { at: Date.now(), gen: 1, dt: 300, unit: "L/min", b0: 10, held: [], v: [120, 123] });
    const unverifiedFlowHtml = h.histHtml("flow", "L/min", "Volumenstrom", "modbus");
    assert.ok(unverifiedFlowHtml.includes(h.t("hist.modbus_flow_unverified")),
      "unverified Modbus flow 24h chart includes explicit scaling caveat");

    S.status.modbus = { enabled: true, connected: true, profile: "homehub", profile_basis: "affirmative" };
    S._modbus = [{ off: 49, concept: "flow", history: "flow", value: "12.3", unit: "L/min" }];
    const verifiedFlowHtml = h.histHtml("flow", "L/min", "Volumenstrom", "modbus");
    assert.ok(!verifiedFlowHtml.includes(h.t("hist.modbus_flow_unverified")),
      "verified EKRHH Modbus flow 24h chart omits unverified scaling caveat");

    S.status.history.rows = prevRows;
    S.status.history.modbus_rows = prevMbRows;
    S._values = prevValues;
    S.status.hp = prevHp;
    S.status.modbus = prevMb;
  }

  S.status = prevStatus;
  h.syncHistSources();
  S.hist = prevHist;
  S._modbus = prevModbus;
}

console.log("UI history sources: X10A, Modbus and MQTT room rings align, gap, render and fetch independently");
