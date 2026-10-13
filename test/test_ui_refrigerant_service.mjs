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
const statusSource = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const pollSource = fs.readFileSync(new URL("../main/hp_poll.cpp", import.meta.url), "utf8");
const logicSource = fs.readFileSync(
  new URL("../main/logic/refrigerant_service.hpp", import.meta.url), "utf8");

const normalizedStatus = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "refrigerant_service", "kind", "state", "continuous_s", "samples", "mode", "blocker",
  "special_phases_known", "load_proven", "eev_feedback", "limitations", "metrics",
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
  S: { status: null },
  document: { getElementById: () => null },
  fetch: () => { throw new Error("unexpected fetch in service observation test"); },
  localStorage: { getItem: () => "en", setItem: () => {} },
  navigator: { language: "en" },
  descNoteHtml: (lead, text) => `<detail label="${lead}">${text}</detail>`,
  descAccordion: (key, label, value, cls, body) =>
    `<div class="vitem"><button class="vrow vrow-desc" data-desc="${key}">` +
    `<span class="vrow-label">${label}</span><span class="vrow-val ${cls}">${value}</span>` +
    `</button><div class="vdesc"><div class="vdesc-body">${body}</div></div></div>`,
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${i18nSource}${dashboardSource}
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
assert.match(html, /Refrigerant circuit during heating/);
assert.match(html, />RECORDING</);
assert.match(html, /1 min · 4 readings/);
assert.match(html, /One space-heating run, separate from 24-hour checks/);
assert.match(html, /No refrigerant-charge or normal-range diagnosis/);
assert.match(html, /command, not measured position/);
assert.match(html, /label="Compressor">min 0 · mean 27.5 · max 40 rps/);
assert.match(html, /label="Discharge temperature">min 46.5 · mean 60.5 · max 81.4 °C/);
assert.match(html, /label="Expansion-valve command">min 200 · mean 230.5 · max 250 pls/);
assert.match(html, /label="High pressure">min 18 · mean 20 · max 22 bar/);
assert.match(html, /label="Low pressure">min 4 · mean 5 · max 6 bar/);
assert.match(html, /class="vrow vrow-desc"[^>]*data-desc="service:refrigerant"/);
assert.equal((html.match(/<div class="card">/g) || []).length, 1);
assert.doesNotMatch(html, /data-action=|<form|<input|>OK</);

// Unknown/null/incomplete metric data cannot become a zero or partially plausible range.
ui.set({ ...observed, metrics: {
  compressor_rps: null, discharge_c: { min: 0, mean: null, max: 81 },
  high_pressure_bar: { min: 18, mean: "20", max: 22 },
  low_pressure_bar: { min: NaN, mean: 5, max: 6 },
} });
html = ui.card();
assert.doesNotMatch(html, /label="Compressor"|label="Discharge temperature"|label="High pressure"|label="Low pressure"/);
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
  assert.match(waiting, />WAITING FOR HEATING RUN</);
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
}
ui.lang("de");
ui.set({ ...observed, state: "limited", special_phases_known: false,
  limitations: ["pressure_sides_incomplete"] });
html = ui.card();
assert.match(html, /MISST · ZUSATZWERTE FEHLEN/);
assert.match(html, /label="Verdichter">min. 0 · Mittel 27,5 · max. 40 rps/);
assert.match(html, /Druckseite\(n\)/);
assert.match(html, /unabhängig von der 24-h-Diagnose/);
assert.match(html, /Ventil: Befehl, keine gemessene Stellung/);
ui.set({ state: "unsupported", continuous_s: 0, samples: 0,
  blocker: "unsupported_profile", special_phases_known: false });
html = ui.card();
assert.match(html, />NICHT VERFÜGBAR</);
assert.match(html, /Dieses Modell stellt nicht alle benötigten Messwerte bereit/);
console.log("refrigerant observation UI contract: actual ranges, named limits and single-run scope verified");
