// Contract test for the neutral refrigerant-service observation.  It executes the production
// renderer without a browser and pins both boundaries: one expandable row inside the Plant
// diagnostics card, but no ninth verdict or contribution to plant-health counts.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const i18nBase = readAppFragments(["i18n.js"]);
const localeNames = JSON.parse(i18nBase.match(/const UI_LANGS = Object.freeze\((\[[^\n]+\])\)/)[1]);
const i18nSource = i18nBase + localeNames.filter(l => l !== "en").map(readUiLocale).join("\n");
const dashboardSource = readAppFragments(["dashboard.js"]);
const explanationSource = readAppFragments(["descriptions.js", "history.js"]);
const statusSource = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const pollSource = fs.readFileSync(new URL("../main/hp_poll.cpp", import.meta.url), "utf8");
const logicSource = fs.readFileSync(
  new URL("../main/logic/refrigerant_service.hpp", import.meta.url), "utf8");

const normalizedStatus = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "refrigerant_service", "kind", "state", "continuous_s", "samples", "mode", "blocker",
  "special_phases_known", "load_proven", "eev_feedback", "limitations", "metrics",
  "source_generation", "metric_meta", "source", "reg", "offset", "conv",
  "compressor_rps", "discharge_c", "eev_command_pls", "high_pressure_bar", "low_pressure_bar",
]) assert.match(normalizedStatus, new RegExp(`"${key}"`), `missing service status key ${key}`);
assert.match(normalizedStatus, /"load_proven":false,"eev_feedback":false/,
             "the payload must state both unavailable proof boundaries explicitly");
assert.match(statusSource, /OUTSIDE health\{\}/,
             "the observation must remain independent of the eight health checks");
assert.match(statusSource,
             /if \(c\.fp_valid && refrigerant_service\.coverage_evaluated\) \{\s*j \+= "\\\"refrigerant_service\\\"/s,
             "the payload must omit service state until detection and coverage evaluation finish");
assert.doesNotMatch(logicSource, /RefrigerantServiceState::Complete|REFRIGERANT_SERVICE[^\n]*1200/,
                    "the tracker must not invent a completion threshold or diagnosis");
assert.match(logicSource, /confirm mechanical EEV movement/,
             "the pure-logic boundary must preserve EEV command semantics");
assert.match(pollSource, /v && !v->held && logic::history_parse_tenths/,
             "held-over readings must not enter a fresh service window");
assert.match(pollSource, /service_register_count\) \* HP_QUERY_TIMEOUT_US/,
             "the gap allowance must scale with the active profile sweep");
assert.match(pollSource,
             /config_commit_detected_model\([\s\S]{0,500}?if \(committed\) \{[\s\S]{0,500}?s_refrigerant_service\s*=\s*logic::RefrigerantServiceTracker\{\};[\s\S]{0,200}?generation\s*=\s*cycle_generation;/,
             "detection must retire unidentified coverage before publishing the new fingerprint");
assert.match(pollSource,
             /s_refrigerant_service_coverage = service_coverage;[\s\S]{0,250}?refrigerant_service_record\(/,
             "the resolved profile must publish service state only with committed coverage");

const context = {
  S: { status: null, descOpen: new Set() },
  document: { getElementById: () => null },
  fetch: () => { throw new Error("unexpected fetch in service observation test"); },
  localStorage: { getItem: () => "en", setItem: () => {} },
  navigator: { language: "en" },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${i18nSource}${dashboardSource}${explanationSource}
   this.__service = {
     row: refrigerantServiceRowHtml,
     card: () => checkupCardHtml(false),
     set: (value) => { S.status = value == null ? null : { refrigerant_service: value }; },
     lang: (value) => { LANG = value; },
   };`,
  sandbox,
  { filename: "main/www/app.sources" },
);
const ui = sandbox.__service;

ui.set(null);
assert.equal(ui.row(), "");
assert.equal(ui.card(), "");
ui.set({ state: "waiting", continuous_s: null, samples: null });
assert.doesNotMatch(ui.row(), /0 min|0 readings/, "missing time must not become a measured zero");
const observed = {
  kind: "observation", state: "observing", continuous_s: 75, samples: 4,
  mode: "heating", blocker: null, special_phases_known: true,
  load_proven: false, eev_feedback: false, limitations: [],
  metrics: {
    compressor_rps: { min: 0, mean: 27.5, max: 40 },
    discharge_c: { min: 46.5, mean: 60.5, max: 81.4 },
    eev_command_pls: { min: 200, mean: 230.5, max: 250 },
    high_pressure_bar: { min: 18, mean: 20, max: 22 },
    low_pressure_bar: { min: 4, mean: 5, max: 6 },
  },
};
ui.set(observed);
let html = ui.card();
assert.match(html, /Plant diagnostics · 24 h/);
assert.match(html, /Refrigerant \(heating\)/);
assert.match(html, />RECORDING</);
assert.match(html, /1 min · 4 readings/);
assert.match(html, /One space-heating run, separate from 24-hour checks/);
assert.match(html, /No refrigerant-charge or normal-range diagnosis/);
assert.match(html, /command, not measured position/);
assert.match(html, /Compressor: min 0 · mean 27.5 · max 40 rps/);
assert.match(html, /Discharge temperature: min 46.5 · mean 60.5 · max 81.4 °C/);
assert.match(html, /Expansion-valve command: min 200 · mean 230.5 · max 250 pls/);
assert.match(html, /High pressure: min 18 · mean 20 · max 22 bar/);
assert.match(html, /Low pressure: min 4 · mean 5 · max 6 bar/);
assert.match(html, /class="vrow vrow-desc"[^>]*data-desc="service:refrigerant"/);
assert.equal((html.match(/<div class="card">/g) || []).length, 1);
assert.doesNotMatch(html, /data-action=|<form|<input|>OK</);

// New metadata is separate from legacy ranges. Counts belong to each actual accepted population,
// and an identified input does not turn a missing reading into a zero-valued measurement.
const counted = {
  ...observed, source_generation: 777,
  metrics: { ...observed.metrics, low_pressure_bar: null },
  metric_meta: {
    compressor_rps: { samples: 4, source: { kind: "x10a", reg: 0x30, offset: 0, conv: 152 } },
    discharge_c: { samples: 4, source: { kind: "x10a", reg: 0x20, offset: 4, conv: 105 } },
    eev_command_pls: { samples: 4, source: { kind: "x10a", reg: 0x30, offset: 3, conv: 151 } },
    high_pressure_bar: { samples: 3, source: { kind: "x10a", reg: 0x62, offset: 15, conv: 105 } },
    low_pressure_bar: { samples: 0, source: null },
  },
};
ui.set(counted);
html = ui.card();
assert.match(html, /High pressure: min 18 · mean 20 · max 22 bar · 3 accepted readings/);
assert.match(html, /Low pressure: No data · 0 accepted readings · No selected input/);
assert.equal((html.match(/Profile-selected X10A input/g) || []).length, 4);
assert.match(html, /not time coverage/);
assert.match(html, /does not prove a current reading/);
assert.doesNotMatch(html, /777|0x62|converter|Low pressure: min 0/,
                    "wire-level identity belongs in the API, not the owner-facing row");
ui.set({ ...counted, metric_meta: { low_pressure_bar: { samples: 0,
  source: { kind: "x10a", reg: 0x20, offset: 14, conv: 105 } } } });
html = ui.card();
assert.match(html, /Low pressure: No data · 0 accepted readings · Profile-selected X10A input/);
assert.doesNotMatch(html, /Low pressure: min 0/);
ui.set({ ...counted, state: "waiting", samples: 0, continuous_s: 0,
  blocker: "compressor_not_running", metrics: {},
  metric_meta: Object.fromEntries(Object.entries(counted.metric_meta)
    .map(([key, meta]) => [key, { ...meta, samples: 0 }])) });
html = ui.card();
assert.match(html, /The compressor is not running/);
assert.doesNotMatch(html, /accepted readings|Profile-selected X10A input|No selected input|not time coverage/,
                    "an empty waiting window needs its blocker, not five empty metric lines");

// Absent/malformed metadata is not an accepted zero count or a selected input. Old firmware's
// legitimate measured zero and its original five ranges continue to render without metadata.
ui.set({ ...observed, metric_meta: {
  compressor_rps: { samples: null, source: null },
  high_pressure_bar: { samples: -1, source: null },
  low_pressure_bar: { samples: "0", source: null },
} });
html = ui.card();
assert.match(html, /Compressor: min 0 · mean 27.5 · max 40 rps/);
assert.doesNotMatch(html, /accepted readings|selected input|not time coverage/);

// Unknown/null/incomplete metric data cannot become a zero or partially plausible range.
ui.set({ ...observed, metrics: {
  compressor_rps: null, discharge_c: { min: 0, mean: null, max: 81 },
  high_pressure_bar: { min: 18, mean: "20", max: 22 },
  low_pressure_bar: { min: NaN, mean: 5, max: 6 },
} });
html = ui.card();
assert.doesNotMatch(html, /Compressor:|Discharge temperature:|High pressure:|Low pressure:/);
assert.doesNotMatch(html, /min 0|NaN|undefined/);

ui.set({ ...observed, state: "limited", special_phases_known: false,
  limitations: ["special_phases_unavailable", "temperature_context_incomplete",
                "pressure_sides_incomplete", "outdoor_context_incomplete", "future_constraint"] });
html = ui.card();
for (const text of ["Controller phases", "Temperature context",
                   "Pressure side(s)", "Outdoor context"])
  assert.ok(html.includes(text), `missing named constraint ${text}`);
assert.doesNotMatch(html, /future_constraint|service\.limit\./);
assert.equal((html.match(/Controller phases/g) || []).length, 1);

ui.set({ kind: "observation", state: "interrupted", continuous_s: 0, samples: 0,
  mode: "heating", blocker: "poll_gap", special_phases_known: false });
html = ui.card();
assert.match(html, /vrow-val checkup-val dim[^>]*>PAUSED</);
assert.doesNotMatch(html, /vrow-val checkup-val err[^>]*>PAUSED</);
assert.match(html, /X10A connection was interrupted or intentionally paused/);
assert.match(html, /Restarts with the next eligible heating run/);
for (const [blocker, reason] of [
  ["compressor_not_running", "The compressor is not running."],
  ["unsupported_or_unknown_mode", "Ordinary space heating is not confirmed."],
  ["dhw_path", "The heat pump is heating domestic hot water."],
  ["special_controller_phase", "A short startup or special controller phase is active."],
]) {
  ui.set({ state: "waiting", continuous_s: 0, samples: 0, blocker });
  const waiting = ui.card();
  assert.match(waiting, />WAITING</);
  assert.ok(waiting.includes(reason));
}

// Metric labels, units, named constraints and single-run scope must exist in all shipped locales.
for (const locale of localeNames) {
  ui.lang(locale);
  ui.set({ ...observed, state: "limited", special_phases_known: false,
    limitations: ["temperature_context_incomplete", "pressure_sides_incomplete", "outdoor_context_incomplete"] });
  html = ui.card();
  assert.doesNotMatch(html, /service\.(?:metric|limit|common)|undefined|NaN/, locale);
  for (const unit of ["rps", "°C", "pls", "bar"]) assert.ok(html.includes(unit), `${locale} ${unit}`);
  assert.doesNotMatch(html, />OK</);
  assert.equal((html.match(/class="vdesc-p"/g) || []).length, 3, `${locale}: exactly three blocks`);

  ui.set(counted);
  const metadata = ui.card();
  assert.doesNotMatch(metadata, /service\.(?:metric|limit|common)|undefined|NaN|0x62|777/, locale);
  if (locale !== "en") {
    assert.doesNotMatch(metadata, /accepted readings|Profile-selected X10A input|No selected input|not time coverage/,
                       `${locale}: metadata and its limit must be localized`);
  }
}
ui.lang("de");
ui.set({ ...observed, state: "limited", special_phases_known: false,
  limitations: ["pressure_sides_incomplete"] });
html = ui.card();
assert.match(html, />LÜCKENHAFT</);
assert.match(html, /Verdichter: min. 0 · Mittel 27,5 · max. 40 rps/);
assert.match(html, /Druckseite\(n\)/);
assert.match(html, /unabhängig von der 24-h-Diagnose/);
assert.match(html, /Ventil: Befehl, keine gemessene Stellung/);
ui.set({ state: "unsupported", continuous_s: 0, samples: 0,
  blocker: "unsupported_profile", special_phases_known: false });
html = ui.card();
assert.match(html, />ENTFÄLLT</);
assert.match(html, /Dieses Modell stellt nicht alle benötigten Messwerte bereit/);
// Copy regression pin (U3): the unit_fault reason must name a reported warning, not only a fault.
for (const [locale, warning] of [["en", /\bwarning\b/], ["de", /\bWarnung\b/]]) {
  ui.lang(locale);
  ui.set({ state: "waiting", continuous_s: 0, samples: 0, blocker: "unit_fault" });
  html = ui.card();
  assert.match(html, />(?:WAITING|WARTET)</, `${locale} unit_fault waiting state`);
  assert.match(html, warning, `${locale} unit_fault reason must mention the warning case`);
}
console.log("refrigerant observation UI contract: actual ranges, named limits and single-run scope verified");
