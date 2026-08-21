// Contract test for the neutral refrigerant-service observation.  It executes the production
// renderer without a browser and pins the firmware/UI boundary that keeps this out of plant health.
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
assert.match(statusSource, /if \(c\.fp_valid\) \{\s*j \+= "\\\"refrigerant_service\\\"/s,
             "the payload must omit service state until this boot has detected a profile");
assert.doesNotMatch(logicSource, /RefrigerantServiceState::Complete|REFRIGERANT_SERVICE[^\n]*1200/,
                    "the tracker must not invent a completion threshold or diagnosis");
assert.match(logicSource, /confirm mechanical EEV movement/,
             "the pure-logic boundary must preserve EEV command semantics");
assert.match(pollSource, /v && !v->held && logic::history_parse_tenths/,
             "held-over readings must not enter a fresh service window");
assert.match(pollSource, /service_register_count\) \* HP_QUERY_TIMEOUT_US/,
             "the gap allowance must scale with the active profile sweep");

const context = {
  S: { status: null },
  document: { getElementById: () => null },
  fetch: () => { throw new Error("unexpected fetch in service observation test"); },
  localStorage: { getItem: () => "en", setItem: () => {} },
  navigator: { language: "en" },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${i18nSource}${dashboardSource}
   this.__service = {
     card: refrigerantServiceCardHtml,
     set: (value) => { S.status = value == null ? null : { refrigerant_service: value }; },
     lang: (value) => { LANG = value; },
   };`,
  sandbox,
  { filename: "main/www/app.sources" },
);
const ui = sandbox.__service;

ui.set(null);
assert.equal(ui.card(), "", "older firmware must not get an empty placeholder card");

ui.set({
  kind: "observation", state: "observing", continuous_s: 75, samples: 4,
  mode: "heating", blocker: null, special_phases_known: true,
  load_proven: false, eev_feedback: false, limitations: [],
});
let html = ui.card();
assert.match(html, /Refrigerant service observation/);
assert.match(html, />OBSERVING</);
assert.match(html, /1 min · 4 fresh samples/);
assert.match(html, /EEV pulses are the controller command, not mechanical valve feedback/);
assert.doesNotMatch(html, /data-action=|<form|<input|>OK</,
                    "the card must remain passive and must not imply a verdict");

ui.set({
  kind: "observation", state: "interrupted", continuous_s: 0, samples: 0,
  mode: "heating", blocker: "poll_gap", special_phases_known: false,
});
html = ui.card();
assert.match(html, />INTERRUPTED</);
assert.match(html, /X10A poll gap or intentional pause\./);
assert.match(html, /A later eligible sweep starts a new window from zero/);

for (const [blocker, reason] of [
  ["compressor_not_running", "Compressor stopped."],
  ["unsupported_or_unknown_mode", "Not space heating, or mode unknown."],
  ["special_controller_phase", "Startup, restart, oil return or pressure equalisation active."],
]) {
  ui.set({ kind: "observation", state: "waiting", continuous_s: 0, samples: 0,
           mode: "unknown", blocker, special_phases_known: true });
  assert.ok(ui.card().includes(reason), `${blocker} must keep its exact reason`);
}

ui.lang("de");
ui.set({
  kind: "observation", state: "limited", continuous_s: 125, samples: 3,
  mode: "heating", blocker: null, special_phases_known: false,
});
html = ui.card();
assert.match(html, /Kältekreis-Servicebeobachtung/);
assert.match(html, />EINGESCHRÄNKT</);
assert.match(html, /2 min · 3 frische Stichproben/);
assert.match(html, /EEV-Pulse sind Befehle, keine Ventilrückmeldung/);

console.log("refrigerant service observation UI contract passed");
