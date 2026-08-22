// Contract test for the neutral refrigerant-service observation.  It executes the production
// renderer without a browser and pins both boundaries: one expandable row inside the Plant
// diagnostics card, but no ninth verdict or contribution to plant-health counts.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const i18nSource = readAppFragments(["i18n.js"]) + readUiLocale("de");
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
             /config_commit_detected_model\([\s\S]{0,500}?if \(committed\) \{[\s\S]{0,500}?s_refrigerant_service = logic::RefrigerantServiceTracker\{\};[\s\S]{0,200}?generation = cycle_generation;/,
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
assert.equal(ui.row(), "", "older firmware must not get an empty placeholder row");
assert.equal(ui.card(), "", "older firmware must not get an empty Plant diagnostics card");

ui.set({
  kind: "observation", state: "observing", continuous_s: 75, samples: 4,
  mode: "heating", blocker: null, special_phases_known: true,
  load_proven: false, eev_feedback: false, limitations: [],
});
let html = ui.card();
assert.match(html, /Plant diagnostics · 24 h/);
assert.match(html, /Refrigerant circuit during heating/);
assert.match(html, />RECORDING</);
assert.match(html, /1 min · 4 current readings/);
assert.match(html, /On supported models it starts automatically in ordinary heating/);
assert.match(html, /no service mode or setting change/);
assert.match(html, /Does not assess refrigerant charge or normal ranges/);
assert.match(html, /Valve value: command, not measured position/);
assert.doesNotMatch(html, /service[- /]full-load test|service or full-load test/i,
                    "owner copy must not imply that a service-mode test is a prerequisite");
assert.match(html, /class="vrow vrow-desc"[^>]*data-desc="service:refrigerant"/,
             "status and explanation must use the shared expandable infobox row");
assert.equal((html.match(/<div class="card">/g) || []).length, 1,
             "refrigerant service must live inside one Plant diagnostics card");
assert.doesNotMatch(html, /data-action=|<form|<input|>OK</,
                    "the row must remain passive and must not imply a verdict");

ui.set({
  kind: "observation", state: "interrupted", continuous_s: 0, samples: 0,
  mode: "heating", blocker: "poll_gap", special_phases_known: false,
});
html = ui.card();
assert.match(html, />PAUSED</);
assert.match(html, /vrow-val checkup-val dim[^>]*>PAUSED</,
             "a normal paused observation must stay neutral rather than look like a fault");
assert.doesNotMatch(html, /vrow-val checkup-val err[^>]*>PAUSED</);
assert.match(html, /X10A connection was interrupted or intentionally paused\./);
assert.match(html, /Recording ended and restarts automatically during the next suitable heating run/);

for (const [blocker, reason] of [
  ["compressor_not_running", "The compressor is not running."],
  ["unsupported_or_unknown_mode", "The heat pump is not in ordinary space heating, or its mode is unavailable."],
  ["special_controller_phase", "A short startup or special controller phase is active."],
]) {
  ui.set({ kind: "observation", state: "waiting", continuous_s: 0, samples: 0,
           mode: "unknown", blocker, special_phases_known: true });
  const waiting = ui.card();
  assert.match(waiting, />WAITING FOR HEATING RUN</);
  assert.ok(waiting.includes(reason), `${blocker} must keep its exact reason`);
}

ui.lang("de");
ui.set({
  kind: "observation", state: "limited", continuous_s: 125, samples: 3,
  mode: "heating", blocker: null, special_phases_known: false,
});
html = ui.card();
assert.match(html, /Kältekreis im Heizbetrieb/);
assert.match(html, />MISST · ZUSATZWERTE FEHLEN</);
assert.match(html, /2 min · 3 aktuelle Messungen/);
assert.match(html, /Bei unterstützten Modellen startet sie automatisch im normalen Heizlauf/);
assert.match(html, /kein Service-Modus und keine Einstellungsänderung/);
assert.match(html, /Ventilwert: Steuerbefehl, keine gemessene Stellung/);

ui.set({
  kind: "observation", state: "unsupported", continuous_s: 0, samples: 0,
  mode: "unknown", blocker: "unsupported_profile", special_phases_known: false,
});
html = ui.card();
assert.match(html, />NICHT VERFÜGBAR</);
assert.match(html, /Dieses Modell stellt nicht alle benötigten Messwerte bereit/);

console.log("refrigerant service observation UI contract passed");
