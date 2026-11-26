// Contract test for the rolling plant-diagnostics card. Executes the production checkup renderer
// from the assembled production UI in a DOM-free VM so wording and null/evidence handling cannot drift into a
// whole-plant health claim while the C++ report remains technically conservative.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";
import { cyclingPollStopped, withChromiumAppearanceSlot, withCyclingCleanup } from "./test_browser_cycling.mjs";

const i18nBase = readAppFragments(["i18n.js"]);
const shippedLocales = JSON.parse(i18nBase.match(/const UI_LANGS = Object.freeze\((\[[^\n]+\])\)/)[1]);
const i18nSource = i18nBase + shippedLocales.filter(l => l !== "en").map(readUiLocale).join("\n");
const dashboardSource = readAppFragments(["dashboard.js"]);
const explanationSource = readAppFragments(["descriptions.js", "history.js", "schematic.js"]);
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const statusSource = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const checkupSource = fs.readFileSync(new URL("../main/checkup.cpp", import.meta.url), "utf8");
const pollSource = fs.readFileSync(new URL("../main/hp_poll.cpp", import.meta.url), "utf8");
const modbusPollSource = fs.readFileSync(new URL("../main/hp_modbus.cpp", import.meta.url), "utf8");
const configSource = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const hydronicSource = fs.readFileSync(new URL("../main/logic/hydronic_payload.hpp", import.meta.url), "utf8");

// The executable card navigation test covers diagnosis opt-in and its order before Model.
// GROUP_ORDER, independent of match precedence, determines the order of the live-value groups.
assert.match(dashboardSource, /const GROUP_ORDER = \["Operation"/s,
             "Operation must remain the first live-value group");
assert.doesNotMatch(dashboardSource, /checkup \+ service \+|refrigerantServiceCardHtml/,
                    "refrigerant service must not return as a separate dashboard card");
assert.match(dashboardSource,
             /return hp\.connected \? vcard\(t\("card\.model"\), model, "model"\) : "";/,
             "the Model card must follow plant diagnostics and precede Operation without reviving the removed outdoor card");
// Pin the existing /status.health surface plus its additive evidence fields at the actual serializer.
// The UI payloads below are synthetic by design; without this half, a C++ key drift could leave every
// renderer test green while the board sends a different contract.
const normalizedStatusSource = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "health", "covered_s", "checks",
  "span_s", "source_age_s", "source_fresh", "reason",
  "persist",
  "full_span", "available", "assessable", "evaluated", "evidence", "observed_s", "required_s",
  "starts", "mean_run_s", "count", "paired_count", "share_pct", "defrost_s", "run_s",
  "space_runs", "space_mean_run_s", "dhw_runs", "dhw_mean_run_s", "cooling_runs",
  "censored_runs", "censored_transition_runs", "censored_handover_runs",
  "censored_unreadable_runs", "censored_restart_runs", "censored_start_runs",
  "classified_runtime_s", "censored_runtime_s", "runtime_saturated", "split", "hours",
  "hours_epoch", "bucket", "end_unix_s", "elapsed_s", "space_s", "dhw_s",
  "outdoor_source", "outdoor_min_c", "outdoor_mean_c", "outdoor_samples",
  "min_bar", "current_bar", "min_unix_s", "confirmed_low", "confirmed_critical", "min_l_min",
  "buh_min", "bsh_min", "buh_s", "bsh_s", "buh_observed_s", "bsh_observed_s", "active", "seen", "counters",
  "latest", "base_code", "subcode", "ongoing", "stop_unknown", "start_unix_s", "secondary_code",
  "secondary_state", "timeline", "unix_s", "window_end_s", "observed_end_s", "boot_s", "live",
  "run_contexts", "flow_reference_fixed", "flow_typical_l_min",
  "segments",
  "max_k_h", "windows", "high_windows", "high_with_pump", "high_pump_off",
  "draw_windows", "pump_windows", "quiet_high_windows",
  "circulation_on_s", "circulation_known_s", "candidate_s", "settle_remaining_s",
  "aborts", "best_aborted_s", "blocked", "abort_reasons",
  "heating_minimum", "minimum_windows", "hour_masks", "locations_missing", "secondary_supply", "delta_k", "zone_context",
]) {
  assert.match(normalizedStatusSource, new RegExp(`"${key}"`),
               `missing /status.health key ${key}`);
}
assert.doesNotMatch(normalizedStatusSource, /"status":/,
                    "removed /status.health.status must not be serialized");
assert.match(statusSource,
             /case logic::CheckupCheck::Flow:\s*tenths\("min_l_min", ck\.a\);\s*append_hydronic_status\(j, diag_effective, c\.diagnostics_enabled, redact\);/,
             "flow check serializer must retain min_l_min and delegate hydronic details");
assert.match(normalizedStatusSource,
             /"heating_minimum":.*?;\s*if \(!enabled\)\s*\{\s*j \+= "null";/,
             "the selected heating minimum respects diagnostics consent");
assert.match(statusSource,
             /append_heating_windows\(j, use_modbus \? modbus\.windows : obs\.minimum_windows,\s*redact \|\| !observed\);/,
             "the selected minimum only locates recorded evidence from its own source in unredacted status");
assert.match(statusSource,
             /append_heating_windows\(j, windows,\s*redact \|\| !observation\.confirmed \|\| !observation\.dated \|\|\s*!observation\.totals\.samples\);/,
             "legacy flow windows require confirmed and dated measurements in unredacted status");
assert.match(statusSource,
             /if\s*\(diag_effective == DiagnosticsSource::Modbus\)\s*\{\s*report\s*=\s*\{\};\s*report\.observation\.partial\s*=\s*false;\s*report\.observation\.restore_pending\s*=\s*false;[\s\S]*?report\.reason\s*=\s*logic::HydronicReason::None;\s*\}/,
             "Modbus diagnostics mode keeps the legacy hydronic observation empty with reason_code 0");
for (const key of [
  "confirmed", "current", "dated", "coverage_partial", "restore_pending", "persistence_pending",
  "dropped", "observed_hours", "method", "window_s", "settling_s", "max_gap_s", "reason_code",
  "reason", "scope", "weighting", "settling_remaining_s", "source_generation", "schema_fp",
  "current_limitations_mask", "population_limitations_mask", "population_saturated",
  "observed_s", "candidate_s", "qualified_s", "samples", "command_samples",
  "first_evidence_unix_s", "last_evidence_unix_s", "first_accepted_unix_s", "last_accepted_unix_s",
  "target_delta_k", "target_supported",
  "stable_window_s", "max_drift_k", "min_flow_l_min", "r1_r4", "r2_r1", "supported", "windows", "delta_k",
]) {
  assert.match(hydronicSource,
               new RegExp(`(?:w\\.(?:flag|u64|sec|ts|key)|pw\\.(?:flag|u64|sec|range)|emit_pair|\\{)\\s*\\(?\\s*"${key}"`),
               `missing hydronic serializer key ${key}`);
}
assert.match(hydronicSource,
             /const bool\s+known\s*=\s*confirmed\s*&&\s*observation\.dated\s*&&\s*totals\.first_evidence_unix_us\s*>=\s*0;/,
             "hydronic JSON ranges and dates must stay gated on confirmed dated history");
assert.match(hydronicSource,
             /w\.range\("spread_k",\s*"spread",\s*"k",\s*totals\.spread,\s*totals\.samples,\s*known\)/);
assert.match(hydronicSource,
             /w\.range\("flow_l_min",\s*"flow",\s*"l_min",\s*totals\.flow,\s*totals\.samples,\s*known\)/);
assert.match(hydronicSource,
             /w\.range\("pump_command_pct",\s*"pump_command",\s*"pct",\s*totals\.command,\s*totals\.command_samples,\s*known\)/);
assert.match(statusSource, /if\s*\(v\s*<\s*0\)\s*\{\s*j\s*\+=\s*"null";\s*return;\s*\}/,
             "unestablished check numbers must serialize as null");
assert.match(style, /\.vrow-val\s*\{[^}]*color:\s*var\(--muted\)/s,
             "neutral value rows across all cards must use muted ink");
assert.match(style, /\.vrow-val\.dim\s*\{[^}]*color:\s*var\(--muted\)/s,
             "CHECKING/observation-only rows need a distinct neutral visual state");
assert.match(style, /\.vrow-val\.ok\s*\{[^}]*color:\s*var\(--ok\)/s,
             "ok value rows must keep semantic green ink");
assert.match(style, /\.vrow-val\.warn\s*\{[^}]*color:\s*var\(--warn\)/s,
             "warn value rows must keep semantic amber ink");
assert.match(style, /\.vrow-val\.err\s*\{[^}]*color:\s*var\(--err\)/s,
             "error value rows must keep semantic red ink");
assert.match(style, /\.vrow-val\.src-val-mb,\s*\.src-val-mb\s*\{[^}]*color:\s*var\(--src-mb\)/s,
             "Modbus value rows must keep petrol provenance ink");
assert.match(style, /\.conn-val\s*\{[^}]*color:\s*var\(--muted\)/s,
             "neutral connection rows must use muted ink");
assert.match(style, /\.conn-val\.dim\s*\{[^}]*color:\s*var\(--muted\)/s,
             "dimmed connection rows must use muted ink");
assert.match(style, /\.conn-val\.ok\s*\{[^}]*color:\s*var\(--ok\)/s,
             "ok connection rows must keep semantic green ink");
assert.match(style, /\.conn-val\.warn\s*\{[^}]*color:\s*var\(--warn\)/s,
             "warn connection rows must keep semantic amber ink");
assert.match(style, /\.conn-val\.err\s*\{[^}]*color:\s*var\(--err\)/s,
             "error connection rows must keep semantic red ink");
assert.match(style, /\.settings-split-action\s*\{[^}]*color:\s*var\(--muted\)/s,
             "neutral split Settings action values must use muted ink");
assert.match(style, /\.inspect-row span:last-child\s*\{[^}]*color:\s*var\(--muted\)/s,
             "neutral schematic inspector row values must use muted ink");
assert.match(style, /\.inspect-row\.mb-row span\s*\{[^}]*color:\s*var\(--src-mb\)/s,
             "Modbus inspector rows must keep petrol provenance ink");
assert.match(style, /\.inspect-diagnosis-result\s*\{[^}]*color:\s*var\(--muted\)/s,
             "neutral diagnosis inspector result rows must use muted ink");
assert.match(style, /\.wf-fact-v\s*\{[^}]*color:\s*var\(--muted\)/s,
             "expanded working-figure fact values must use muted ink");
assert.match(style, /\.vname\s*\{[^}]*color:\s*var\(--fg\)/s,
             "model heading must remain foreground ink");
assert.match(style, /\.inspect-now\s*\{[^}]*color:\s*var\(--fg\)/s,
             "schematic inspector headline reading must remain foreground ink");
assert.match(style, /\.wf-kpi-val\s*\{[^}]*color:\s*var\(--fg\)/s,
             "working-figure KPI values must remain foreground ink");
assert.match(style, /\.mb-tag\s*\{[^}]*opacity:\s*\.5;/s,
             "Modbus source badge must stay visually subordinate to the reading");
assert.match(checkupSource, /if \(apply_reset_locked\(s_x10a\)\) return;/,
             "X10A record must discard the sample that consumes an identity reset");
assert.match(checkupSource, /if \(apply_reset_locked\(s_modbus\)\) return;/,
             "Modbus record must discard the sample that consumes an identity reset");
assert.match(checkupSource, /if \(slot\.reset_requested\.load\(\)\) return logic::CheckupReport\{\};/,
             "report must stay empty without consuming a pending identity reset");
assert.ok(pollSource.indexOf("checkup_reset_on_detect(") < pollSource.indexOf("config_commit_detected_model("),
          "automatic detection must request reset before publishing the resolved profile");
assert.ok(pollSource.indexOf("history_reset_on_detect(") < pollSource.indexOf("config_commit_detected_model("),
          "automatic detection must reset trend identity before publishing the resolved profile");
assert.match(pollSource,
             /Lock lk\(s_mtx\);[\s\S]*?s_target_generation\.load[\s\S]*?config_commit_detected_link\([\s\S]*?checkup_reset_on_detect\([\s\S]*?dwell_reset_on_detect\([\s\S]*?history_reset_on_detect\([\s\S]*?config_commit_detected_model\(/m,
             "detection config and observer resets must share the reconfigure generation barrier");
// THREE X10A-backed observations now share one identity: the checkup's 24-hour window, the trend
// rings and the per-row state ages (logic/state_dwell.hpp). All three are addressed by coordinates
// whose MEANING depends on the resolved unit, so a link or profile change must retire all of them
// together — one left behind would go on describing the previous physical identity under the new
// one's name.
assert.match(configSource,
             /set_hp_apply_x10a\(c, x10a, reset_checkup\)[\s\S]*?if \(reset_checkup\) \{\s*hp_poll_reconfigure\(\);\s*checkup_reset\(\);\s*dwell_reset\(\);\s*history_reset\(\);/m,
             "/set_hp must route the pure identity predicate into all three X10A reset requests");
assert.match(configSource,
             /static esp_err_t do_detect[\s\S]*?hp_poll_reconfigure\(\);\s*checkup_reset\(\);\s*dwell_reset\(\);\s*history_reset\(\);/m,
             "explicit /detect must invalidate old cycles before arming all three X10A resets");
assert.match(configSource,
             /homehub_history_identity_changed\([\s\S]*?const uint32_t modbus_target_fp[\s\S]*?const bool modbus_enabled[\s\S]*?config_save\([\s\S]*?if \(reset_mb_history\) \{\s*checkup_modbus_reset\(\);\s*history_modbus_reset\(modbus_target_fp\);[\s\S]*?mb_reconfigure\(modbus_enabled\);[\s\S]*?mqtt_request_modbus_cleanup\(\);\s*\}/m,
             "/set_hp must reset HomeHub history/checkup and reconfigure only when host, port or unit identity changes");
assert.match(modbusPollSource,
             /if \(s_have_req && \(target != s_req_host \|\| c\.mb_port != s_req_port \|\| c\.mb_unit_id != s_unit\)\) \{\s*history_modbus_reset\(logic::history_homehub_target_fingerprint\([\s\S]*?\);\s*checkup_modbus_reset\(\);\s*\}/m,
             "the Modbus task must close the race where an old cycle consumes the HTTP reset");

const context = {
  S: { status: null, descOpen: new Set(), faultCodes: new Set(), faultSnapKeys: null, faultHoverIdx: null },
  document: { getElementById: () => null },
  fetch: () => { throw new Error("unexpected fetch in checkup test"); },
  modbusFlowScaleUnverified: () => false,
  localStorage: { getItem: () => "en", setItem: () => {} },
  navigator: { language: "en" },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${i18nSource}${dashboardSource}${explanationSource}
   this.__checkup = {
     value: checkupValue,
     metric: checkupMetricValue,
     status: checkupStatusText,
     detail: checkupDetailHtml,
     heaterReport: checkupHeaterReport,
     heaterBrief: checkupHeaterBriefHtml,
     flowReport: checkupFlowReport,
     flowBrief: checkupFlowBriefHtml,
     defrostInspector: (c, health = {}, statusStale = false) => checkupDefrostInspectorRows({
       diagnostics: { enabled: true },
       health: { source: "x10a", span_s: 86400, full_span: true, source_fresh: true, ...health, checks: [c] },
     }, statusStale),
     dhwReport: checkupDhwReport,
     dhwBrief: checkupDhwBriefHtml,
     dhwExplain: checkupDhwCoolingExplanation,
     chart: checkupCyclingChartHtml,
     timeline: checkupCyclingTimelineHtml,
     periodDetails: (trace, checkObj, from, to, source = "x10a") => {
       checkupCyclingTimelineHtml(trace, "test-scope", checkObj, source);
       return cyclingPeriodDetailsHtml(_cyclingModels.get("test-scope"), from, to);
     },
     shortRuns: checkupCyclingShortRunCount,
     chartPeriodDetails: (c, from, to) => {
       checkupCyclingChartHtml(c);
       const model = _cyclingModels.values().next().value;
       return model ? cyclingPeriodDetailsHtml(model, from, to) : "";
     },
     setStatus: (st) => { S.status = st; },
     setExpandedRun: (key) => { S.cyclingExpandedRun = key; },
     card: checkupCardHtml,
     ready: checkupSourceReadyFor,
     copy: I18N,
     duration: (lang, seconds) => { LANG = lang; return checkupDuration(seconds); },
     text: (lang, key, ...args) => { LANG = lang; return t(key, ...args); },
     setLang: (lang) => { LANG = lang; },
   };`,
  sandbox,
  { filename: "main/www/app.sources" },
);
const ui = sandbox.__checkup;
const locales = Object.keys(ui.copy);
ui.setLang("en");
assert.equal(ui.text("en", "card.checkup"), "Plant diagnostics · 24 h");
assert.equal(ui.text("de", "card.checkup"), "Anlagendiagnose · 24 h");
ui.setLang("en");

for (const c of [
  { id: "cycling", starts: null }, { id: "defrost", count: null },
]) assert.equal(ui.metric({ verdict: "collecting", ...c }), "");

// Collecting cycling fixture reused across the diagnosis cases.
const collecting = {
  id: "cycling", verdict: "collecting", evidence: "heuristic", reason: "input_coverage",
  starts: 2, observed_s: 77759, required_s: 77760,
};
let detail;

// A first-hour flow observation needs eligible pump operation, not the rest of a calendar day.
// Exercise localized details to keep instant and eligible-window observations scoped.
const partialReport = { span_s: 900, source_age_s: 1, source_fresh: true };
const collectingFlow = {
  id: "flow", verdict: "collecting", evidence: "observation", reason: "input_coverage",
  observed_s: 0, required_s: 0, min_l_min: null,
};
for (const lang of locales) {
  const horizon = ui.duration(lang, 85500);
  const period = `${ui.text(lang, "check.detail.period_label")} 15 min`;
  const ageLabel = ui.text(lang, "check.detail.age_label");
  const flowDetail = ui.detail(collectingFlow, false, partialReport);
  assert.ok(!flowDetail.includes(horizon), `${lang} flow must not require a full day`);
  assert.ok(flowDetail.includes(period), `${lang} flow must retain its observed period`);
  assert.ok(!flowDetail.includes(ageLabel), `${lang} fresh flow need not repeat source age`);
  assert.ok(flowDetail.includes(ui.text(lang, "check.detail.collecting_unknown")),
    `${lang} flow must retain its actual collection state`);
  for (const id of ["fault", "dhw_loss", "retries"]) {
    assert.ok(!ui.detail({ ...collectingFlow, id, windows: 0 }, false, partialReport).includes(horizon),
      `${lang}/${id} observations must not inherit a daily prerequisite`);
  }
  const staleDetail = ui.detail({ ...collectingFlow, reason: "source_stale" }, false,
    { ...partialReport, source_fresh: false, source_age_s: 120 });
  assert.ok(staleDetail.includes(ui.text(lang, "check.detail.source_stale")),
    `${lang} flow must retain the stale-source explanation`);
  assert.ok(staleDetail.includes(ageLabel), `${lang} stale flow must retain source age`);
  assert.ok(!staleDetail.includes(horizon), `${lang} a stale source is not a missing day`);
}
ui.setLang("en");

// DHW tank cooling moved into the Tank inspector: /status.health still carries the dhw_loss
// observation, while the browser derives only the inspector brief and 4-cause explanation from it.
const dhw = {
  id: "dhw_loss", verdict: "ok", evidence: "observation", reason: "observation_only",
  max_k_h: 1.2, windows: 6, high_windows: 2, high_with_pump: 2, high_pump_off: 0,
  draw_windows: 1, pump_windows: 2, quiet_high_windows: 1, blocked: false,
};
const withDhwStatus = (checkPatch, healthPatch = {}, diagPatch = {}, statePatch = {}) => {
  const prevStatus = context.S.status;
  const prevOta = context.S.otaCached;
  const prevTransport = context.S.transportUnavailable;
  try {
    context.S.otaCached = false;
    context.S.transportUnavailable = null;
    Object.assign(context.S, statePatch);
    context.S.status = {
      diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", ...diagPatch },
      health: {
        source: "x10a", source_fresh: true, persist: "fresh",
        checks: [{ ...dhw, ...checkPatch }],
        ...healthPatch,
      },
    };
    return ui.dhwReport();
  } finally {
    context.S.status = prevStatus;
    context.S.otaCached = prevOta;
    context.S.transportUnavailable = prevTransport;
  }
};
assert.equal(withDhwStatus({}, {}, { enabled: false }), null, "disabled diagnostics hides tank cooling");
assert.equal(withDhwStatus({}, {}, {}, { otaCached: true }), null, "OTA cache hides tank cooling");
assert.equal(withDhwStatus({}, {}, {}, { transportUnavailable: "status" }), null, "unavailable status hides tank cooling");
assert.equal(withDhwStatus({}, { persist: "unknown" }), null, "unknown persist hides tank cooling");
assert.equal(withDhwStatus({}, { checks: [] }), null, "missing dhw_loss hides tank cooling");
assert.equal(withDhwStatus({}, { source: "env3" }, { effective_source: "env3" }), null, "non-tank source returns null");

const zeroDhwReport = withDhwStatus({ max_k_h: 0, windows: 1 });
assert.equal(zeroDhwReport.maxRate, 0, "zero cooling rate with completed window stays distinct from null");
assert.match(ui.dhwBrief(zeroDhwReport, false), /0 °C\/h/);
assert.ok(!ui.dhwBrief(zeroDhwReport, false).includes(ui.text("en", "check.dhw.locations_missing")),
  "< 0.8 K/h must not claim missing cooling-band locations");

for (const invalid of [null, undefined, NaN, Infinity, -1, "1.2"]) {
  assert.equal(withDhwStatus({ max_k_h: invalid }).maxRate, null, `invalid max_k_h (${String(invalid)}) must not fabricate a rate`);
}
assert.equal(withDhwStatus({ windows: 0 }).maxRate, null, "zero windows cannot establish a maximum rate");
assert.equal(withDhwStatus({ verdict: "unavailable" }).maxRate, null);
assert.equal(withDhwStatus({ blocked: true }).maxRate, null);

const activeDhw = withDhwStatus({ max_k_h: 1.2, windows: 6 });
assert.match(ui.dhwBrief(activeDhw, true), /Strongest tank cooling · X10A.*1\.2 °C\/h/);
assert.ok(!ui.dhwBrief(activeDhw, true).includes(ui.text("en", "check.dhw.locations_missing")));
assert.ok(!ui.dhwBrief(activeDhw, true).includes(ui.text("en", "check.dhw.stale")));
assert.ok(ui.dhwBrief(activeDhw, false).includes(ui.text("en", "check.dhw.locations_missing")),
  "maxRate >= 0.8 without visible bands explains missing locations");
assert.ok(ui.dhwBrief(withDhwStatus({}, { source_fresh: false }), true).includes(ui.text("en", "check.dhw.stale")));
assert.ok(ui.dhwBrief(withDhwStatus({ reason: "source_stale" }), true).includes(ui.text("en", "check.dhw.stale")));
assert.ok(ui.dhwBrief(withDhwStatus({
  timeline: { epoch: 1, window_end_s: 10000, since_s: 0, observed_end_s: 9000, live: false, windows: [] },
}), true).includes(ui.text("en", "check.dhw.stale")));

assert.equal(ui.dhwBrief(withDhwStatus({ verdict: "unavailable", blocked: true, max_k_h: null, windows: 0 }), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">—</strong></div><p>${ui.text("en", "check.dhw.no_window")}</p>`);
assert.equal(ui.dhwBrief(withDhwStatus({ verdict: "unavailable", blocked: false, max_k_h: null, windows: 0 }), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">${ui.text("en", "check.status.unavailable")}</strong></div>`);
assert.equal(ui.dhwBrief(withDhwStatus({ verdict: "collecting", blocked: false, max_k_h: null, windows: 0 }), false),
  `<div class="inspect-diagnosis-result"><span>DHW tank cooling · X10A</span><strong class="num">${ui.text("en", "check.status.collecting")}</strong></div><p>${ui.text("en", "check.dhw.waiting")}</p>`);
assert.equal(ui.dhwBrief(null, false), "");

for (const lang of locales) {
  ui.setLang(lang);
  const causes = [];
  for (const pump_marker of [true, false]) {
    for (const draw_marker of [true, false]) {
      for (const circulation of ["unknown", "on", "off", "off_settled"]) {
        const text = ui.dhwExplain({ pump_marker, draw_marker, circulation });
        causes.push(text);
        assert.ok(text.trim(), `${lang}: DHW cause explanation must be non-empty`);
        const sentences = text.split(/[.!?。！？]+/).filter(s => s.trim());
        const expected = (circulation === "on" || circulation === "off_settled") ? 3 : 2;
        assert.equal(sentences.length, expected,
          `${lang}: DHW cause explanation (${circulation}) must be ${expected} sentences (saw ${sentences.length})`);
      }
    }
  }
  assert.equal(new Set(causes).size, 12, `${lang}: distinct combinations without settled-off collapse to 12`);
}
ui.setLang("en");

// Starts and completed runs have separate populations. Each mean belongs only to its own purpose.
const cycling = {
  id: "cycling", verdict: "info", evidence: "heuristic", starts: 18, mean_run_s: 830,
  split: true, space_runs: 12, space_mean_run_s: 300,
  dhw_runs: 2, dhw_mean_run_s: 900, cooling_runs: 0, censored_runs: 4,
};
const escapeText = text => String(text).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const runRow = (lang, label, count, mean) => {
  const value = ui.text(lang, "check.cycling.runs", count) +
    (mean == null ? "" : " · " + ui.text(lang, "check.cycling.mean", mean));
  return "<span>" + escapeText(ui.text(lang, label)) + "</span><span>" + escapeText(value) + "</span>";
};
const hasAssessment = (html, lang, key) => {
  const message = escapeText(ui.text(lang, "check.cycling." + key));
  const assessment = html.match(/<[^>]*class="[^"]*\bcheckup-cycling-assessment\b[^"]*"[^>]*>.*?<\/div>/s);
  assert.ok(assessment?.[0].includes(message), lang + "/" + key + ": expected a short assessment");
};

assert.equal(ui.metric(cycling), "≥18 starts");
detail = ui.detail(cycling);
assert.match(detail, /≥18 starts/);
for (const [label, count, mean] of [
  ["mode.heat", 12, "5 min"], ["mode.dhw", 2, "15 min"], ["check.cycling.unclear", 4, null],
]) assert.ok(detail.includes(runRow("en", label, count, mean)), label);
assert.ok(detail.includes(escapeText(ui.text("en", "check.cycling.unclear_hint"))));
assert.doesNotMatch(detail, /0 runs|830|project hint|90%|&lt;10 min/i);
assert.ok(detail.indexOf("≥18 starts") < detail.indexOf("checkup-cycling-assessment"));
assert.ok(detail.indexOf("checkup-cycling-assessment") < detail.indexOf("checkup-cycling-grid"));
assert.ok(detail.indexOf("checkup-cycling-grid") < detail.indexOf("data-checkup-hours"));
assert.match(detail, /Heating runs are short on average\./);
assert.match(detail, /Gaps in the readings can leave some starts uncounted\./);
assert.doesNotMatch(detail, /Normal:<\/span>/);

const timedShortDetail = ui.detail({
  ...cycling,
  timeline: {
    unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400, run_edges: true,
    records: [
      1 * 8 + 1, 82810 * 8 + 5, 82810 * 8 + 3, 82990 * 8 + 1, 82995 * 8 + 6,
      83200 * 8 + 5, 83200 * 8 + 3, 83400 * 8 + 1, 83405 * 8 + 6,
    ],
  },
});
assert.match(timedShortDetail, /12 runs · avg\. 5 min · 2 &lt; 5 min/);

const evictedRunHtml = ui.periodDetails(
  {
    unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400, run_edges: true,
    records: [
      1 * 8 + 1, 82810 * 8 + 5, 82810 * 8 + 3, 83000 * 8 + 1, 83000 * 8 + 6,
      83600 * 8 + 5, 83600 * 8 + 3, 83900 * 8 + 1, 83900 * 8 + 6,
    ],
  },
  { run_contexts: [{ at: 83600, stop: 83900, mode: "space", start_kind: "request_on", stop_kind: "normal" }] },
  23,
  23,
);
assert.match(evictedRunHtml, /No cause details/);
assert.match(evictedRunHtml, /Normal stop/);
assert.doesNotMatch(evictedRunHtml.split("83600")[0], /Normal stop/);

// Pre-reboot / gap-bridging run details contracts
{
  const preBootTrace = {
    unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400, boot_s: 2000, live: true, run_edges: true,
    records: [
      1 * 8 + 1, 79500 * 8 + 5, 79500 * 8 + 3, 79800 * 8 + 1, 79800 * 8 + 6,
      80100 * 8 + 5, 80100 * 8 + 3, 80160 * 8 + 0,
      86000 * 8 + 5, 86000 * 8 + 3, 86010 * 8 + 0, 86015 * 8 + 3, 86120 * 8 + 1, 86120 * 8 + 6,
      86150 * 8 + 5, 86150 * 8 + 3, 86160 * 8 + 0, 86180 * 8 + 3, 86220 * 8 + 1, 86220 * 8 + 6,
    ],
  };
  const x10aPreBootNoCtx = ui.periodDetails(preBootTrace, {}, 22, 22, "x10a");
  assert.match(x10aPreBootNoCtx, /No saved start or stop details are available for these older runs\./);
  assert.doesNotMatch(ui.periodDetails(preBootTrace, {}, 22, 22, "modbus"), /saved start or stop details/);
  const withCtxPreBoot22 = ui.periodDetails(preBootTrace, {
    run_contexts: [{ at: 86000, stop: 86120, mode: "space", start_kind: "request_on", stop_kind: "normal" }],
  }, 22, 22, "x10a");
  assert.match(withCtxPreBoot22, /No saved start or stop details are available for these older runs\./);
  assert.match(withCtxPreBoot22, /No cause details/);
  assert.match(withCtxPreBoot22, /Stop unknown/);
  assert.doesNotMatch(withCtxPreBoot22, /data-run-row/);
  const withCtxPostBoot23 = ui.periodDetails(preBootTrace, {
    run_contexts: [{ at: 86000, stop: 86120, mode: "space", start_kind: "request_on", stop_kind: "normal" }],
  }, 23, 23, "x10a");
  assert.match(withCtxPostBoot23, /2 min.*Normal stop/);
  assert.match(withCtxPostBoot23, /Stop unknown/);
  assert.equal(ui.shortRuns({
    timeline: preBootTrace,
  }), 1, "<=15s intra-boot gap bridges short run while >15s gap stays censored");
}

// Restored explanations must match both edges and keep the comparison recorded for each run.
{
  const timeline = {
    unix_s: 1794582660, window_end_s: 86400, observed_end_s: 86400,
    boot_s: 2000, live: true, run_edges: true,
    records: [
      [1, 1],
      [79500, 5], [79500, 3], [79680, 1], [79680, 6],
      [79800, 5], [79800, 3], [79980, 1], [79980, 6],
      [80000, 5], [80000, 3], [80180, 1], [80180, 6],
      [81000, 5], [81000, 3], [81060, 0], [84400, 1],
    ].map(([at, kind]) => at * 8 + kind),
  };
  const ctx = {
    restored: true, flow_reference_fixed: true, mode: "space",
    start_kind: "request_on", stop_kind: "low_rps_above_target", min_rps: 18,
  };
  const hasReference = { ...ctx, at: 79500, stop: 79680, flow_l_min: 10, flow_typical_l_min: 20 };
  const lacksReference = { ...ctx, at: 79800, stop: 79980, flow_l_min: 1 };
  const mismatch = { ...ctx, at: 80000, stop: 80190, stop_kind: "request_withdrawal" };
  const missingStop = { ...ctx, at: 81000, stop: 81180, stop_kind: "request_withdrawal" };
  const html = ui.periodDetails(timeline, {
    flow_typical_l_min: 30, run_contexts: [hasReference, lacksReference, mismatch, missingStop],
  }, 22, 22, "x10a");
  assert.match(html, /Short runs, low flow:<\/span>.*10\.0 L\/min.*typ\. ~20\.0 L\/min/);
  assert.match(html, /Flow temp above target · low flow/);
  assert.match(html, /Flow temp above target · low speed/);
  assert.match(html, /No cause details/);
  assert.match(html, /Stop unknown/);
  assert.equal([...html.matchAll(/data-run-row=/g)].length, 2, "only matching restored runs are expandable");
  assert.doesNotMatch(html, /30\.0 L\/min/);
  const withoutFixedReference = ui.periodDetails(timeline, {
    flow_typical_l_min: 30,
    run_contexts: [{ ...hasReference, flow_typical_l_min: undefined }, lacksReference],
  }, 22, 22, "x10a");
  assert.match(withoutFixedReference, /Short runs, low speed/);
  assert.doesNotMatch(withoutFixedReference, /Short runs, low flow|typ\. ~30\.0 L\/min/);
  const zeroAtStop = ui.periodDetails(timeline, {
    flow_typical_l_min: 30,
    run_contexts: [{ ...hasReference, flow_l_min: 0 }, lacksReference],
  }, 22, 22, "x10a");
  assert.match(zeroAtStop, /Short runs, low speed/);
  assert.doesNotMatch(zeroAtStop, /Short runs, low flow|Flow temp above target · low flow/);
}

const makeRollingCheck = (shift) => ({
  hours_epoch: 1,
  timeline: {
    boot_s: 6000 + shift,
    live: true,
    unix_s: 1794582660 + shift,
    window_end_s: 86400,
    observed_end_s: 86400,
    run_edges: true,
    records: [
      [1, 1],
      [79260 - shift, 5], [79260 - shift, 3], [79440 - shift, 1], [79440 - shift, 6],
      [83600 - shift, 5], [83600 - shift, 3], [83900 - shift, 1], [83900 - shift, 6],
    ].map(([at, kind]) => at * 8 + kind),
  },
  run_contexts: [
    { at: 79260 - shift, stop: 79440 - shift, mode: "space", start_kind: "request_on", stop_kind: "normal" },
    { at: 83600 - shift, stop: 83900 - shift, mode: "space", start_kind: "request_on", stop_kind: "normal" },
  ],
});
try {
  const initialCheck = makeRollingCheck(0);
  const shiftedCheck = makeRollingCheck(8);
  const assertRowOpen = (html, rowKey, label) => {
    assert.match(html, new RegExp(`data-run-row="${rowKey}"[^>]*aria-expanded="true"`), `${label}: row ${rowKey} expanded`);
    assert.match(html, new RegExp(`data-run-sub="${rowKey}"><td`), `${label}: subrow ${rowKey} visible`);
  };
  ui.setExpandedRun("b:3200");
  assertRowOpen(ui.periodDetails(initialCheck.timeline, initialCheck, 22, 23), "b:3200", "initial boot run");
  assertRowOpen(ui.periodDetails(shiftedCheck.timeline, shiftedCheck, 22, 23), "b:3200", "shifted boot run");

  const restoredKey = `u:${1794582660 + 79260 - 86400}`;
  ui.setExpandedRun(restoredKey);
  assertRowOpen(ui.periodDetails(initialCheck.timeline, initialCheck, 22, 23), restoredKey, "initial restored run");
  assertRowOpen(ui.periodDetails(shiftedCheck.timeline, shiftedCheck, 22, 23), restoredKey, "shifted restored run");

  ui.setExpandedRun("b:3200");
  ui.setStatus({ boot_id: "rolling-omit-test", uptime_s: 6008, health: { source: "x10a" }, history: { epoch: 1 } });
  assertRowOpen(ui.chartPeriodDetails(shiftedCheck, 22, 23), "b:3200", "live chart before omission");
  ui.setStatus({ boot_id: "rolling-omit-test", uptime_s: 6016, health: { source: "x10a" }, history: { epoch: 1 } });
  assertRowOpen(ui.chartPeriodDetails({ hours_epoch: 1 }, 22, 23), "b:3200", "extrapolated chart during omission");
} finally {
  ui.setStatus(null);
  ui.setExpandedRun(null);
}

const fluentCheck = {
  hours_epoch: 1,
  flow_typical_l_min: 17.6,
  timeline: {
    unix_s: 1794582660,
    window_end_s: 86400,
    observed_end_s: 86400,
    run_edges: true,
    records: [
      [1, 1],
      [79260, 5], [79260, 3], [79428, 1], [79428, 6],
      [79600, 5], [79600, 3], [79750, 1], [79750, 6],
      [79900, 5], [79900, 3], [80080, 1], [80080, 6],
      [80200, 5], [80200, 3], [80380, 1], [80380, 6],
      [80500, 5], [80500, 3], [80680, 1], [80680, 6],
      [80800, 5], [80800, 2], [80920, 1], [80920, 6],
      [81100, 5], [81100, 3], [81280, 1], [81280, 6],
      [82900, 5], [82900, 3], [83100, 1], [83100, 6],
      [83300, 5], [83300, 4],
    ].map(([at, kind]) => at * 8 + kind),
  },
  run_contexts: [
    { at: 79260, stop: 79428, mode: "space", start_kind: "cooldown_restart", stop_kind: "request_withdrawal",
      start_lwt_c: 39.1, start_target_c: 41.1, lwt_c: 45.1, rwt_c: 41.9, target_c: 41.1, flow_l_min: 15.0 },
    { at: 79600, stop: 79750, mode: "space", start_kind: "target_raised", stop_kind: "target_changed",
      start_lwt_c: 38.6, start_target_c: 40.0, start_target_prev_c: 39.5, lwt_c: 43.7, rwt_c: 41.0, target_c: 39.5, target_prev_c: 40.0, flow_l_min: 15.4 },
    { at: 79900, stop: 80080, mode: "space", start_kind: "request_on", stop_kind: "low_rps_above_target",
      start_lwt_c: 29.0, start_target_c: 32.0, lwt_c: 35.1, rwt_c: 33.6, target_c: 32.0, flow_l_min: 8.2, min_rps: 18.0 },
    { at: 80200, stop: 80380, mode: "space", start_kind: "after_defrost", stop_kind: "low_rps_above_target",
      start_lwt_c: 30.0, start_target_c: 33.0, lwt_c: 36.2, rwt_c: 34.4, target_c: 33.0, flow_l_min: 17.2, min_rps: 19.0 },
    { at: 80500, stop: 80680, mode: "space", start_kind: "after_dhw", stop_kind: "normal",
      start_lwt_c: 31.0, start_target_c: 34.0, lwt_c: 34.2, rwt_c: 31.5, target_c: 34.0, flow_l_min: 16.8 },
    { at: 80800, stop: 80920, mode: "other", start_kind: "defrost_start", stop_kind: "defrost",
      lwt_c: 24.0, rwt_c: 23.0, flow_l_min: 18.0 },
    { at: 81100, stop: 81280, mode: "space", start_kind: "request_on", stop_kind: "defrost",
      start_lwt_c: 31.0, start_target_c: 34.0, lwt_c: 33.0, rwt_c: 30.5, target_c: 34.0, flow_l_min: 17.0 },
    { at: 82900, stop: 83100, mode: "space", start_kind: "unknown", stop_kind: "dhw_transition",
      start_lwt_c: 32.0, start_target_c: 35.0, lwt_c: 35.0, rwt_c: 32.1, target_c: 35.0, flow_l_min: 16.2 },
    { at: 83300, mode: "dhw", start_kind: "dhw_start", start_lwt_c: 41.0 },
  ],
};
const extractRunExplains = html => [...html.matchAll(/<p class="checkup-run-explain">([\s\S]*?)<\/p>/g)]
  .map(([, inner]) => inner.replace(/<[^>]+>/g, ""));
try {
  for (const lang of locales) {
    ui.setLang(lang);
    const explains = extractRunExplains(ui.periodDetails(fluentCheck.timeline, fluentCheck, 22, 23));
    assert.equal(explains.length, fluentCheck.run_contexts.length, `${lang} renders every run explanation`);
    for (const explain of explains) {
      assert.doesNotMatch(explain, /[()（）]/, `${lang} run explanation avoids parentheses: ${explain}`);
    }
  }
  ui.setLang("de");
  const deExplains = extractRunExplains(ui.periodDetails(fluentCheck.timeline, fluentCheck, 22, 23));
  assert.match(deExplains[0], /^Start \d{2}:\d{2}:\d{2}: Vorlauf 39,1 °C, Ziel 41,1 °C, Anforderung an\. Stopp \d{2}:\d{2}:\d{2}: Anforderung aus · Vorlauf 45,1 °C, Ziel 41,1 °C, Rücklauf 41,9 °C, 15,0 L\/min\.$/);
  assert.match(deExplains[1], /^Start \d{2}:\d{2}:\d{2} nach 2:52 min Pause: Ziel von 39,5 °C auf 40,0 °C erhöht · Vorlauf 38,6 °C\. Stopp \d{2}:\d{2}:\d{2}: Ziel von 40,0 °C auf 39,5 °C gesenkt · Vorlauf 43,7 °C, Rücklauf 41,0 °C, 15,4 L\/min\.$/);
  for (const text of deExplains) {
    assert.doesNotMatch(text, /; Stopp\.|Anford\.|[()（）]/, `de concise wording avoids abbreviations/parentheses: ${text}`);
  }
  ui.setLang("en");
  const enExplains = extractRunExplains(ui.periodDetails(fluentCheck.timeline, fluentCheck, 22, 23));
  assert.match(enExplains[0], /^Started \d{2}:\d{2}:\d{2}: flow 39\.1 °C, target 41\.1 °C, request on\. Stopped \d{2}:\d{2}:\d{2}: request off · flow 45\.1 °C, target 41\.1 °C, return 41\.9 °C, 15\.0 L\/min\.$/);
  assert.match(enExplains[1], /^Started \d{2}:\d{2}:\d{2} after 2:52 min pause: target raised from 39\.5 °C to 40\.0 °C · flow 38\.6 °C\. Stopped \d{2}:\d{2}:\d{2}: target lowered from 40\.0 °C to 39\.5 °C · flow 43\.7 °C, return 41\.0 °C, 15\.4 L\/min\.$/);
  for (const text of enExplains) {
    assert.doesNotMatch(text, /; stopped\.|\breq\.|[()（）]/, `en concise wording avoids abbreviations/parentheses: ${text}`);
  }
} finally {
  ui.setLang("en");
}

const restoredCycling = { ...cycling, starts: 27, hours: [
  { starts: 22, restored: true }, { starts: 5 }, { starts: 9, restored: true, expired: true },
] };
assert.match(ui.detail(restoredCycling), /Of these, 22 starts come from hourly totals saved before the restart/);
assert.doesNotMatch(ui.detail({ ...restoredCycling, starts: 18 }), /saved before the restart/,
  "a saved subtotal must be supported by the displayed total");

const noRunCounts = { ...cycling, space_runs: null, space_mean_run_s: 600,
  dhw_runs: null, dhw_mean_run_s: 900, cooling_runs: null, censored_runs: null };
assert.doesNotMatch(ui.detail(noRunCounts), /checkup-cycling-grid|0 runs|avg\.|15 min/,
  "missing run counts establish neither a zero nor an average");
assert.ok(ui.detail({ ...cycling, dhw_runs: 0, dhw_mean_run_s: null })
  .includes(runRow("en", "mode.dhw", 0, null)), "an observed zero count stays distinct from missing data");
assert.ok(ui.detail({ ...cycling, cooling_runs: 2 })
  .includes(runRow("en", "mode.cool", 2, null)), "observed cooling stays distinct from heating");
assert.ok(ui.detail({ ...cycling, space_mean_run_s: 59 })
  .includes(runRow("en", "mode.heat", 12, "<1 min")), "short positive means stay distinguishable from zero");

const normalCycling = { ...cycling, verdict: "ok", space_mean_run_s: 960 };
const measuredCycling = { ...cycling, verdict: "ok", evidence: "observation",
  reason: "class_population_incomplete" };
const noModeCycling = { id: "cycling", verdict: "ok", evidence: "observation",
  reason: "class_unavailable", starts: 18, split: false,
  space_runs: null, dhw_runs: null, cooling_runs: null, censored_runs: null };
const partialModeCycling = { ...noModeCycling, reason: "class_coverage" };
const fewHeatingRuns = { ...measuredCycling, space_runs: 3, reason: "heating_runs_insufficient" };
const staleReport = { span_s: 3600, source_age_s: 900, source_fresh: false };
assert.match(ui.detail(normalCycling), /Heating runs are long enough on average\./);
assert.doesNotMatch(ui.detail(measuredCycling), /Heating runs are (?:short|long enough) on average/);
hasAssessment(ui.detail(measuredCycling), "en", "waiting");
hasAssessment(ui.detail(partialModeCycling), "en", "waiting");
const noModeDetail = ui.detail(noModeCycling);
assert.equal(ui.value(noModeCycling), "≥18");
assert.match(noModeDetail, /≥18 starts/);
assert.match(noModeDetail, /This system provides too little information to assess heating runs\./);
assert.doesNotMatch(noModeDetail, /checkup-cycling-grid/, "missing operating modes do not create run counts");
assert.ok(!noModeDetail.includes(escapeText(ui.text("en", "check.cycling.waiting"))),
  "a system without mode data cannot promise a later assessment");
const staleNoModeDetail = ui.detail(noModeCycling, true, staleReport);
hasAssessment(staleNoModeDetail, "en", "class_unavailable");
assert.match(staleNoModeDetail, /≥18 starts/);
hasAssessment(ui.detail(fewHeatingRuns), "en", "few");
hasAssessment(ui.detail(collecting, false, partialReport), "en", "waiting");
hasAssessment(ui.detail(normalCycling, true, staleReport), "en", "stale");
hasAssessment(ui.detail(cycling, true, staleReport), "en", "short");
hasAssessment(ui.detail({ ...normalCycling, reason: "source_stale" }), "en", "stale");
assert.match(ui.detail(normalCycling, true, staleReport), /≥18 starts/,
  "stale inputs leave previous observations visible");
assert.doesNotMatch(ui.detail(normalCycling, true, staleReport), /Heating runs are long enough/);
assert.equal(ui.value(measuredCycling), "≥18");
assert.equal(ui.value({ ...measuredCycling, starts: null }), "MEASURED");

// The firmware can provide overlapping stop observations without any cycling counts.
// The owner-facing row shows only its own result and never folds stop data into a verdict.
const stopContext = {
  confirmed: true, readable_s: 3600, observed_hours: 2,
  dated: false, coverage_partial: true, restore_pending: true, persistence_pending: true,
  pending: true, dropped: 1, witnessed_stops_recent_heating: 4,
  categories: { low_rps_above_main_target: { supported: true, positive: 3, evaluable: 4, complete: 2 } },
};
const stopOnlyCycling = { ...noRunCounts, verdict: "unavailable", starts: null, stop_context: stopContext };
assert.equal(ui.value(stopOnlyCycling), "N/A");
assert.equal(ui.metric(stopOnlyCycling), "");
detail = ui.detail(stopOnlyCycling);
hasAssessment(detail, "en", "unavailable");
assert.doesNotMatch(detail, /0 starts|0 runs|witnessed stops|Stop context|3 \/ 4 \/ 2/);
assert.equal(detail, ui.detail({ ...stopOnlyCycling, stop_context: undefined }),
  "technical stop evidence does not add a fourth block or replace unavailable cycling data");

const cyclingWithHours = { ...cycling, starts: 0, verdict: "ok", evidence: "observation",
  reason: "class_population_incomplete", classified_runtime_s: 5400, censored_runtime_s: 600,
  stop_context: stopContext, hours_epoch: 1, hours: [
    { bucket: -1, starts: 0, run_s: 1800, observed_s: 3600, space_s: 600, dhw_s: 600 },
    { bucket: 0, starts: 0, run_s: 0, observed_s: 3600 },
    { bucket: 1, starts: 0, run_s: 600, observed_s: 1200, elapsed_s: 1800, space_s: 0, dhw_s: 0 },
  ] };
assert.doesNotMatch(ui.detail(cyclingWithHours), /\bcheckup-cycling-chart\b/,
  "closed diagnosis must not build the chart");
context.S.descOpen.add("model:health_cycling");
assert.match(ui.detail(cyclingWithHours), /data-checkup-hours><\/div>/,
  "the open diagnosis template leaves the chart to its dedicated slot renderer");
context.S.descOpen.delete("model:health_cycling");
assert.match(ui.chart(stopOnlyCycling), /No history yet\./);
detail = ui.chart(cyclingWithHours);
assert.match(detail, /\bcheckup-cycling-chart\b/);
assert.match(ui.detail(cyclingWithHours), /\bcheckup-cycling-grid\b/);
assert.match(detail, /\bcheckup-chart-cols\b/);
assert.equal((detail.match(/class="checkup-chart-col\b/g) || []).length, 24);
assert.doesNotMatch(detail, /type="range"/, "hour buttons own selection");
assert.match(detail, /data-bucket="-1"/, "restored logical bucket identifiers may be negative");
const hourMarkup = (html, bucket) => html.match(
  new RegExp(`<button[^>]*data-bucket="${bucket}"[^>]*>.*?</button>`))?.[0] || "";
const fillMarkup = hour => hour.match(/<s\b[^>]*><\/s>/)?.[0] || "";
const fillModes = hour => (hour.match(/data-modes="([^"]*)"/)?.[1] || "").split(" ").filter(Boolean);
assert.deepEqual(fillModes(hourMarkup(detail, -1)), ["space", "dhw", "other"],
  "a mixed hour keeps each positively observed mode and its unassigned remainder");
assert.deepEqual(fillModes(hourMarkup(detail, 0)), [],
  "an observed zero does not invent running or missing data");
const openHour = hourMarkup(detail, 1);
assert.deepEqual(fillModes(openHour), ["other"], "missing and unassigned time share one Unknown fill");
assert.doesNotMatch(openHour, /height:|<i\b/, "time lengths never size or stack the category colours");
assert.match(openHour, /20 min of 30 min observed/, "the exact coverage remains accessible");
hasAssessment(ui.detail(cyclingWithHours), "en", "waiting");
assert.doesNotMatch(detail, /Incomplete classification|90% covered/);
const qualifiedHours = ui.chart({ ...cyclingWithHours, starts: 5, hours: [
  { bucket: 0, starts: 3, run_s: 1800, observed_s: 3600, space_s: 0, dhw_s: 0 },
  { bucket: 1, starts: 1, run_s: 600, observed_s: 3600, space_s: 0, dhw_s: 600 },
  { bucket: 2, starts: 1, run_s: 600, observed_s: 3600, space_s: 600, dhw_s: 0 },
  { bucket: 3, starts: 0, run_s: 1200, observed_s: 1200, elapsed_s: 1200, space_s: null, dhw_s: 1200 },
] });
const unassigned = hourMarkup(qualifiedHours, 0);
assert.match(unassigned, /≥3 starts · 30 min/);
assert.match(qualifiedHours, /data-tip="≥5 starts · 1 h 10 min"/,
  "the chart readout reports the sum of witnessed starts as a lower bound");
assert.match(unassigned, /<b class="warn">3<\/b>/);
assert.doesNotMatch(unassigned, /Ø/, "hourly runtime and starts do not establish an average");
assert.deepEqual(fillModes(unassigned), ["other"]);
assert.deepEqual(fillModes(hourMarkup(qualifiedHours, 1)), ["dhw"]);
assert.deepEqual(fillModes(hourMarkup(qualifiedHours, 2)), ["space"]);
assert.deepEqual(fillModes(hourMarkup(qualifiedHours, 3)), ["other"],
  "a malformed mode pair leaves observed runtime unassigned");
for (const html of [detail, qualifiedHours])
  assert.doesNotMatch(html, /checkup-stop-box|witnessed stops|Stop context/,
    "stop telemetry does not expand the cycling card");
const legacyOpen = hourMarkup(ui.chart({ ...cyclingWithHours, hours_epoch: undefined,
  hours: [{ starts: 2, run_s: 600, observed_s: 1200, space_s: 600, end_unix_s: 1792887600 }] }), 23);
assert.deepEqual(fillModes(legacyOpen), ["other"],
  "legacy mode fields cannot establish witnessed heating; observed runtime stays Unknown");
assert.match(legacyOpen, /20 min observed · elapsed time unknown/,
  "legacy open hour cannot establish elapsed unread time");
const legacyHours = ui.chart({ ...cyclingWithHours, hours_epoch: undefined, hours: [
  { starts: 1, run_s: 120, observed_s: 120 },
  { starts: 0, run_s: 0, observed_s: 0 },
] });
const legacyClosed = hourMarkup(legacyHours, 22);
assert.match(legacyClosed, /2 min observed · elapsed time unknown/);
assert.deepEqual(fillModes(legacyClosed), ["other"],
  "a legacy closed record shows its witnessed runtime without an inferred gap");
assert.doesNotMatch(legacyHours, /checkup-gap-key/);
const startup = ui.chart({ ...cyclingWithHours, hours_epoch: 2,
  hours: [{ bucket: 0, starts: 0, run_s: 0, observed_s: 0, elapsed_s: 0 }] });
assert.equal((startup.match(/<button[^>]*data-bucket=/g) || []).length, 1,
  "an incomplete ring leaves older positions unavailable to keyboard selection");
const startupHour = hourMarkup(startup, 0);
assert.match(startupHour, /No data/, "zero elapsed time and no start witness establish no count");
assert.deepEqual(fillModes(startupHour), [], "a just-opened hour has no elapsed time to mark Unknown");
assert.match(startupHour, /0 s of 0 s observed/, "the new hour has no fabricated elapsed time");
assert.match(startup, /data-tip="No data"/, "no readable time or start witness establishes no chart total");
assert.equal((startup.match(/<span class="checkup-chart-col" aria-hidden="true" inert><\/span>/g) || []).length,
  23, "positions outside the retained ring are blank and inert without tracks");
assert.equal((startup.match(/data-modes=/g) || []).length, 1,
  "padding never creates an Unknown fill or implies elapsed time");
const unreadOpenHour = ui.chart({ ...cyclingWithHours, hours_epoch: 2,
  hours: [{ bucket: 0, starts: 0, run_s: 0, observed_s: 0, elapsed_s: 1 }] });
assert.deepEqual(fillModes(hourMarkup(unreadOpenHour, 0)), ["other"],
  "a positive elapsed interval without readings is Unknown");
const expiredHour = ui.chart({ ...cyclingWithHours, hours: [
  { bucket: 0, expired: true, starts: 9, run_s: 1200, observed_s: 1800, space_s: 1200, dhw_s: 0 },
  { bucket: 1, starts: 1, run_s: 120, observed_s: 300, elapsed_s: 300, space_s: 120, dhw_s: 0 },
] });
assert.equal(hourMarkup(expiredHour, 0), "", "expired slots cannot be selected");
assert.equal((expiredHour.match(/<span class="checkup-chart-col" aria-hidden="true" inert><\/span>/g) || []).length,
  23, "expired evidence leaves its chart position blank like unused positions");
assert.match(hourMarkup(expiredHour, 1), /tabindex="0"/, "the open hour remains the keyboard entry");
assert.match(expiredHour, /data-tip="≥1 start · 2 min"/, "only unexpired evidence contributes to the chart total");
assert.equal((expiredHour.match(/data-modes=/g) || []).length, 1,
  "expired evidence does not create an Unknown fill");
assert.deepEqual(fillModes(hourMarkup(expiredHour, 1)), ["space"], "the current fully observed slot has no invented gap");
const edgeOnly = { id: "cycling", verdict: "collecting", starts: 1, observed_s: 0, hours_epoch: 2,
  hours: [{ bucket: 0, starts: 1, run_s: 0, observed_s: 0, elapsed_s: 0 }] };
assert.match(ui.chart(edgeOnly), /data-tip="≥1 start"/,
  "the chart reports its witnessed starts as a lower bound and omits unobserved runtime");
assert.deepEqual(fillModes(hourMarkup(ui.chart(edgeOnly), 0)), [],
  "a start at the hour boundary does not imply a missing interval");
assert.equal(ui.value(edgeOnly), "≥1");
assert.match(ui.detail(edgeOnly), /≥1 start/);
assert.equal(ui.value({ ...edgeOnly, observed_s: 60 }), "≥1");
assert.equal(ui.metric({ ...edgeOnly, observed_s: 60 }), "≥1 start");
assert.equal(ui.metric({ ...edgeOnly, observed_s: undefined }), "≥1 start");
assert.equal(ui.value({ ...edgeOnly, starts: 0 }), "0");
assert.equal(ui.metric({ ...edgeOnly, starts: 0 }), "0 starts");
const observedZero = ui.chart({ ...cyclingWithHours,
  hours: [{ bucket: 0, starts: 0, run_s: 0, observed_s: 60, elapsed_s: 60 }] });
assert.match(observedZero, /data-tip="0 starts · 0 min"/,
  "readable time without a running sample establishes zero observed runtime");
const restored = ui.chart({ ...cyclingWithHours, hours: [
  { bucket: -1, starts: 0, run_s: 180, observed_s: 180, space_s: 180, dhw_s: 0,
    restored: true, end_unix_s: 1792887600 },
  { bucket: 0, starts: 0, run_s: 0, observed_s: 0, elapsed_s: 0 },
] });
const restoredHour = hourMarkup(restored, -1);
assert.match(restoredHour, /Saved time.*3 min observed · elapsed time unknown/,
  "a dated restore gives the saved time and readable duration but no elapsed duration");
assert.doesNotMatch(restoredHour, /Interval end/);
assert.deepEqual(fillModes(restoredHour), ["space"], "restoration retains positively attributed runtime");
assert.equal(fillModes(restoredHour).includes("other"), false,
  "a short restored record does not imply missing time before its end");

// Chronological proportional segments: each active band fills bottom-to-top by duration share.
const hourlyMix = (space, dhw, other = 0, observed = 3600) => hourMarkup(ui.chart({
  ...cyclingWithHours, hours: [{ bucket: 0, starts: 1, run_s: space + dhw + other,
    observed_s: observed, elapsed_s: 3600, space_s: space, dhw_s: dhw }],
}), 0);
const mostlyWater = hourlyMix(1, 3599), mostlyHeating = hourlyMix(3599, 1);
assert.deepEqual(fillModes(mostlyWater), ["space", "dhw"]);
assert.notEqual(fillMarkup(mostlyWater), fillMarkup(mostlyHeating),
  "swapping one-second and 3599-second modes produces distinct proportional fills");
assert.match(fillMarkup(mostlyWater),
  /linear-gradient\(to top, var\(--flow-hot\) 0\.00%, var\(--flow-hot\) 0\.03%, var\(--brand\) 0\.03%, var\(--brand\) 100\.00%\)/);
assert.match(fillMarkup(mostlyHeating),
  /linear-gradient\(to top, var\(--flow-hot\) 0\.00%, var\(--flow-hot\) 99\.97%, var\(--brand\) 99\.97%, var\(--brand\) 100\.00%\)/);
assert.notEqual(mostlyWater.match(/aria-label="([^"]*)"/)[1], mostlyHeating.match(/aria-label="([^"]*)"/)[1],
  "actual mode durations remain distinct in accessible readouts");
assert.deepEqual(fillModes(hourlyMix(60, 60, 60, 180)), ["space", "dhw", "other"],
  "unassigned runtime plus a sampling gap contributes gray only once");
assert.notEqual(fillMarkup(hourlyMix(60, 60, 60, 180)), fillMarkup(hourlyMix(1200, 1200, 1200)),
  "gap and runtime lengths proportionally determine the category shares");
assert.deepEqual(fillModes(hourMarkup(observedZero, 0)), [], "observed off-time stays uncolored");

const timedChart = records => ui.timeline({ unix_s: 1794582660,
  window_end_s: 86400, observed_end_s: 86400, run_edges: true,
  records: records.map(([at, kind]) => at * 8 + kind),
}, "presence-test");
const heatThenWater = timedChart([[0, 1], [82800, 3], [82801, 4]]);
const waterThenHeat = timedChart([[0, 1], [82800, 4], [86399, 3]]);
assert.notEqual(fillMarkup(hourMarkup(heatThenWater, 23)), fillMarkup(hourMarkup(waterThenHeat, 23)),
  "timed mode order and durations remain distinct in chronological proportional segments");
const sandwichTimed = hourMarkup(timedChart([[0, 1], [82800, 3], [83520, 4], [84600, 3]]), 23);
assert.match(fillMarkup(sandwichTimed),
  /linear-gradient\(to top, var\(--flow-hot\) 0\.00%, var\(--flow-hot\) 20\.00%, var\(--brand\) 20\.00%, var\(--brand\) 50\.00%, var\(--flow-hot\) 50\.00%, var\(--flow-hot\) 100\.00%\)/,
  "alternating 20% space -> 30% DHW -> 50% space fills chronologically in bottom-to-top order");
const mixedTrace = timedChart([[0, 1], [82800, 3], [83400, 2], [84000, 0], [84600, 4]]);
const mixedTimedHour = hourMarkup(mixedTrace, 23);
assert.deepEqual(fillModes(mixedTimedHour), ["space", "dhw", "other"],
  "the timed trace deduplicates Other and Gap before blending");
assert.match(mixedTimedHour, /Unclear purpose.*Sampling gap/,
  "the accessible name distinguishes observed unassigned runtime from missing samples");
assert.doesNotMatch(mixedTimedHour, /No data/, "the hour has readable samples");
const idleTimed = hourMarkup(heatThenWater, 0);
assert.deepEqual(fillModes(idleTimed), []);
assert.match(idleTimed, /0 starts/, "readable off-time retains its observed zero");
assert.doesNotMatch(idleTimed, /No data/, "readable off-time is never turned into missing evidence");
const missingTimed = hourMarkup(timedChart([[82800, 3]]), 0);
assert.deepEqual(fillModes(missingTimed), ["other"]);
assert.match(missingTimed, /No data/, "a gray unread bin retains its missing-evidence name");
assert.match(missingTimed, /<b><\/b>/, "an unread bin cannot fabricate a zero count");
for (const lang of locales) {
  ui.setLang(lang);
  const chart = ui.chart(cyclingWithHours);
  const legend = [...chart.matchAll(/<span class="checkup-chart-key"><i[^>]*><\/i>([^<]+)<\/span>/g)]
    .map(match => match[1]);
  assert.deepEqual(legend, ["mode.heat", "mode.dhw", "check.fault_unknown"].map(key =>
    escapeText(ui.text(lang, key))), `${lang}: exactly Heating, Hot water and Unknown, with no gap key`);
}
ui.setLang("en");

// Low-level evidence remains readable by API consumers. The card shows only the completed
// run count, one explanation for unclear purpose, and a brief assessment.
const cyclingCensored = { ...measuredCycling, censored_runs: 15,
  censored_transition_runs: 1, censored_handover_runs: 2, censored_unreadable_runs: 3,
  censored_restart_runs: 4, censored_start_runs: 5,
  classified_runtime_s: 5400, censored_runtime_s: 600, runtime_saturated: true };
assert.equal(ui.metric(cyclingCensored), "≥18 starts");
detail = ui.detail(cyclingCensored);
assert.ok(detail.includes(runRow("en", "check.cycling.unclear", 15, null)));
assert.ok(detail.includes(escapeText(ui.text("en", "check.cycling.unclear_hint"))));
hasAssessment(detail, "en", "waiting");
assert.doesNotMatch(detail, /transition 1|restart\/journal|start not witnessed|90% covered|≥10 min/);
assert.equal(ui.metric({ id: "flow", verdict: "ok", min_l_min: 6.5 }), "6.5 l/min");
assert.equal(ui.metric({ id: "flow", verdict: "ok", min_l_min: NaN }), "");

// Core H1 hydronic spread/flow/command observation tests (X10A flow check): independent dated population,
// strict gating, sub-second duration preservation, locale translation completeness, and target-delta absence.
const hydronicFlow = {
  id: "flow", verdict: "ok", evidence: "observation", min_l_min: 8.4,
  hydronic: {
    confirmed: true, current: true, dated: true, coverage_partial: false,
    restore_pending: false, persistence_pending: false, dropped: 0, observed_hours: 1,
    method: 2, window_s: 86400, settling_s: 600, max_gap_s: 15,
    reason_code: 0, reason: "none", scope: "unit_water_heat_exchanger", weighting: "sample",
    settling_remaining_s: null, source_generation: 3, schema_fp: 0x12345678,
    current_limitations_mask: 0, population_limitations_mask: 0, population_saturated: false,
    observed_s: 20, candidate_s: 20, qualified_s: 20, samples: 4, command_samples: 3,
    first_evidence_unix_s: 1791880000, last_evidence_unix_s: 1791880020,
    first_accepted_unix_s: 1791880005, last_accepted_unix_s: 1791880020,
    spread_k: { min: -0.5, mean: 1.2, max: 3.4 },
    flow_l_min: { min: 7.5, mean: 8.2, max: 9.1 },
    pump_command_pct: { min: 40, mean: 55, max: 70 },
    target_delta_k: null, target_supported: false,
  },
};
const waterAgreement = {
  method: 2, settling_s: 600, stable_window_s: 300, max_drift_k: 0.5, min_flow_l_min: 5,
  max_gap_s: 15, reason_code: 0, reason: "qualified", settling_remaining_s: null,
  current_limitations_mask: 2, population_limitations_mask: 3,
  r1_r4: {
    supported: true, qualified_s: 35.000001, windows: 1, samples: 4,
    delta_k: { min: -0.3, mean: -0.25, max: -0.1 },
  },
  r2_r1: {
    supported: true, qualified_s: 15, windows: 2, samples: 3,
    delta_k: { min: 0.2, mean: 0.3, max: 0.4 },
  },
};
const savedFlowStatus = context.S.status;
const agreeBrief = (agreePatch = {}, hydroPatch = {}, statusPatch = {}) => {
  const hydro = { ...hydronicFlow.hydronic, ...hydroPatch };
  const source = statusPatch.health?.source || statusPatch.diagnostics?.effective_source || "x10a";
  context.S.status = {
    diagnostics: { enabled: true, source, effective_source: source, available_sources: [source] },
    ...statusPatch,
    health: {
      source, status: "ok", persist: "flash",
      checks: [{
        ...hydronicFlow,
        hydronic: hydro,
        water_agreement: agreePatch === null ? null : { ...waterAgreement, ...agreePatch },
      }],
      ...(statusPatch.health || {}),
    },
  };
  return ui.flowBrief(ui.flowReport());
};
const agreeHtml = agreeBrief();
assert.match(agreeHtml, /Pump-only R1T−R4T:<\/span> <span class="num">min -0\.3 · mean -0\.25 · max -0\.1 K · 35\.000001 s · 1 windows · 4 readings<\/span>/);
assert.match(agreeHtml, /Pump-only R2T−R1T:<\/span> <span class="num">min 0\.2 · mean 0\.3 · max 0\.4 K · 15 s · 2 windows · 3 readings<\/span>/);
assert.match(agreeHtml, /Agreement status:<\/span> <span class="num">OK · DHW route included<\/span>/);
assert.match(agreeHtml, /Agreement limits:<\/span> <span class="num">R2T unavailable · DHW route included<\/span>/);
assert.match(agreeHtml, /Passive agreement only; not calibration; external heat not excluded\./);
assert.doesNotMatch(agreeHtml, /<details|<strong>min -0\.3/);
assert.match(agreeBrief({ r2_r1: { supported: false, qualified_s: 0, windows: 0, samples: 0, delta_k: { min: null, mean: null, max: null } } }),
  /Pump-only R1T−R4T:<\/span> <span class="num">min -0\.3 .*Pump-only R2T−R1T:<\/span> <span class="num">No data<\/span>/s);
assert.match(agreeBrief({ population_limitations_mask: 4 }, { population_saturated: false }),
  /Pump-only R1T−R4T:<\/span> <span class="num">min -0\.3 · mean -0\.25 · max -0\.1 K · ≥35\.000001 s · ≥1 windows · ≥4 readings<\/span>/);
assert.doesNotMatch(agreeBrief({ population_limitations_mask: 4 }, { population_saturated: false }),
  /Agreement limits:/);
assert.match(agreeBrief({ population_limitations_mask: 0 }, { population_saturated: true }),
  /Pump-only R1T−R4T:<\/span> <span class="num">min -0\.3 · mean -0\.25 · max -0\.1 K · ≥35\.000001 s · ≥1 windows · ≥4 readings<\/span>/);
assert.match(agreeBrief({ reason_code: 12, settling_remaining_s: 120 }),
  /Agreement status:<\/span> <span class="num">WAITING 120 s · DHW route included<\/span>/);
assert.doesNotMatch(agreeBrief({ reason_code: 12, settling_remaining_s: 120 }, { current: false }),
  /WAITING|120 s/);
assert.match(agreeBrief({ reason_code: 12, settling_remaining_s: 120, current_limitations_mask: null }, { current: false }),
  /Agreement status:<\/span> <span class="num">No data<\/span>/);
assert.match(agreeBrief({ reason_code: 14, current_limitations_mask: null }, { current: false }),
  /Agreement status:<\/span> <span class="num">The X10A connection was interrupted or intentionally paused\.<\/span>/);
assert.match(agreeBrief({ reason_code: 13 }), /Temperatures not stationary/);
assert.match(agreeBrief({ reason_code: 11 }), /3-way valve changed/);
assert.match(agreeBrief({ reason_code: 9 }), /Heater active or ambiguous/);
assert.match(agreeBrief({ reason_code: 8 }), /Compressor running/);
assert.match(agreeBrief({ reason_code: 7 }), /Flow below 5\.0 l\/min/);
assert.doesNotMatch(agreeBrief({ method: 1 }), /Pump-only R1T−R4T/);
assert.doesNotMatch(agreeBrief(null), /Pump-only R1T−R4T/);
assert.equal(agreeBrief({}, {}, { diagnostics: { enabled: true, source: "modbus", effective_source: "modbus" }, health: { source: "modbus" } }),
  `<p>${ui.text("en", "check.flow.unavailable")}</p>`);
assert.equal(ui.flowReport().agreement, null, "Modbus flow report must omit X10A water agreement");
assert.match(agreeBrief({}, { dated: false }), /Pump-only R1T−R4T:<\/span> <span class="num">No data<\/span>/);
assert.doesNotMatch(agreeBrief({
  current_limitations_mask: NaN, population_limitations_mask: NaN,
  r1_r4: { supported: true, qualified_s: -1, windows: NaN, samples: Infinity, delta_k: { min: NaN, mean: 0, max: 0 } },
}), /undefined|NaN|Infinity|-1\b/);
for (const lang of locales) {
  ui.setLang(lang);
  for (let code = 0; code <= 20; code++) {
    const agreeBody = agreeBrief({ reason_code: code, reason: "raw_reason_must_not_leak", settling_remaining_s: 45 });
    assert.ok(agreeBody.includes(escapeText(ui.text(lang, "check.hydronic.agree_labels").split("|")[0])),
      `${lang}/agree/${code}: localized agreement label rendered`);
    assert.doesNotMatch(agreeBody, /check\.hydronic|service\.reason|raw_reason_must_not_leak|undefined|NaN|Infinity/,
      `${lang}/agree/${code}: raw key or non-finite leak`);
  }
}
context.S.status = savedFlowStatus;
ui.setLang("en");
// Pressure has one display in the inspector, with X10A diagnosis separate from the live source.
const pressure = {
  id: "pressure", verdict: "info", evidence: "heuristic", min_bar: 0.8,
  current_bar: 1.5, min_unix_s: 1791887970, confirmed_low: true, confirmed_critical: false,
};
const pressureRing = { at: Date.now(), gen: 1, dt: 300, unit: "bar", b0: 380,
  t0: 1791886800, held: [], v: [15, 12, 9, 4, 8, 15] };
context.S.live = { wp: 1.5 };
context.S.hist = new Map([["water_pressure", pressureRing]]);
context.S.histPin = new Map();
context.S.histHidden = new Map();
context.S.histBusy = new Set();
context.S.histRequests = new Map();
context.S.histEpoch = 1;
context.S.status = {
  hp: { connected: true },
  diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
  history: { rows: [{ id: "water_pressure", label: "Water Pressure" }] },
  health: { status: "info", span_s: 86400, full_span: true, source_fresh: true, source_age_s: 1, checks: [pressure] },
};
const pressureState = () => context.pressureDiagnosis();
const pressureText = () => context.pressureFindingHtml(pressureState());
const pressureExplanation = () => context.pressureExplanationHtml(pressureState());
const pressurePlot = () => context.histHtml("water_pressure", "bar", "Water pressure", "", true, null,
  { pressureDiagnosis: true, finding: pressureState()?.finding, findingExplanation: pressureExplanation() });
const pressureInspector = pressurePlot();
assert.doesNotMatch(pressureInspector, /vhist-pressure-explanation/);
assert.doesNotMatch(pressureInspector, /vhist-head|vhist-range/);
assert.match(context.histHtml("water_pressure", "bar", "Water pressure"), /vhist-head/);
assert.match(pressureInspector, /vhist-pressure-finding warn[^>]*left:80\.00%/);
assert.match(pressureInspector, /vhist-thresh low/);
assert.match(pressureInspector, /vhist-thresh crit/);
assert.match(pressureInspector, /vhist-line warn/);
assert.match(pressureInspector, /vhist-line err/);
const lowResult = /<div class="inspect-diagnosis-result"><span>Confirmed finding · X10A<\/span><strong class="num">0\.8\u00a0bar<\/strong><\/div>/;
assert.match(pressureText(), lowResult);
const lowFindingTime = new Date(pressure.min_unix_s * 1000).toLocaleString("en", { dateStyle: "short", timeStyle: "short" });
assert.ok(pressureText().endsWith("<p>Low · " + escapeText(lowFindingTime) + "</p>"));
assert.doesNotMatch(pressureText(), /60 consecutive seconds/);
assert.match(pressureExplanation(), /^<div class="vdesc-n">X10A · How is pressure assessed\?<\/div><p>At or below 1\.0\u00a0bar for at least 60 consecutive seconds\.<\/p>$/);
assert.doesNotMatch(ui.card(true), /model:health_pressure|1 note/);
// A chart minimum elsewhere, a boundary, an unfinished bucket and an undated finding cannot get
// a marker. The qualified finding stays visible below the related readings.
for (const time of [1791887670, 1791888000, 1791888301, 1791886499, null]) {
  context.S.status.health.checks = [{ ...pressure, min_unix_s: time }];
  assert.match(pressureText(), lowResult);
  if (time === null) assert.ok(pressureText().endsWith("<p>Low</p>"));
  assert.doesNotMatch(pressurePlot(), /vhist-pressure-finding/);
}
context.S.status.health.checks = [pressure];
for (const ring of [{ ...pressureRing, t0: null }, { ...pressureRing, held: [[4, 1]] },
  { ...pressureRing, v: [15, 12, 9, 4, null, 15] }]) {
  context.S.hist.set("water_pressure", ring);
  assert.doesNotMatch(pressurePlot(), /vhist-pressure-finding/);
}
context.S.hist.set("water_pressure", pressureRing);
const criticalPressure = { ...pressure, verdict: "warn", min_bar: 0.4, min_unix_s: 1791887670, confirmed_critical: true };
context.S.status.health.checks = [criticalPressure];
assert.equal(pressureState().finding.critical, true);
assert.match(pressureText(), /<strong class="num">0\.4\u00a0bar<\/strong><\/div><p>Critical · /);
assert.match(pressurePlot(), /vhist-pressure-finding err[^>]*left:60\.00%/);
assert.match(pressureExplanation(), /At or below 0\.5\u00a0bar for at least 60 consecutive seconds/);
context.S.status.history.modbus_rows = [{ id: "water_pressure" }];
context.S.hist.set(vm.runInContext('histCacheKey("water_pressure", "modbus")', context), pressureRing);
context.S.histPin.set("water_pressure", { bucket: 383, lanes: ["x10a", "modbus"], witnessed: true,
  source: "", pressureInspector: true });
assert.match(pressurePlot(), /vhist-pressure-explanation/);
context.S.histHidden.set("water_pressure", new Set(["x10a"]));
assert.doesNotMatch(pressurePlot(), /vhist-pressure-finding|vhist-pressure-explanation|data-pressure-assessment/);
context.S.histPin.delete("water_pressure");
context.S.histHidden.clear();
context.S.hist.set("water_pressure", { ...pressureRing, t0: null });
assert.doesNotMatch(pressurePlot(), /vhist-pressure-finding/);
context.S.status.health.source_fresh = false;
assert.equal(pressureState().current, null);
assert.equal(pressureState().finding.critical, true);
context.S.status.health.source_fresh = true;
const unconfirmedPressure = { ...pressure, verdict: "collecting", confirmed_low: false, current_bar: 0.4 };
context.S.status.health.checks = [unconfirmedPressure];
context.S.live.wp = 0.4;
assert.equal(pressureState().pending, true);
assert.match(pressureText(), /Duration is still unknown/);
context.S.live.mbFields = new Set(["wp"]);
assert.equal(pressureState().current, null);
assert.equal(pressureState().pending, false);
assert.match(pressureText(), /No current assessment/);
context.S.status.diagnostics.effective_source = "modbus";
assert.equal(pressureState(), null);
assert.match(pressureText(), /X10A pressure diagnosis unavailable/);
context.S.status.diagnostics.effective_source = "x10a";
context.S.status.health.checks = [criticalPressure];
context.S.transportUnavailable = "status";
assert.equal(pressureState(), null);
context.S.transportUnavailable = null;
context.S.status.diagnostics.enabled = false;
assert.equal(pressureState(), null);
context.S.status = null;
context.S.live = null;
context.S.hist.clear();
context.S.histPin.clear();

// Cleared and unreadable-current fault states must not promise automatic resolution or no action.
detail = ui.detail({ id: "fault", verdict: "info", active: 0 });
assert.match(detail, /No message is active now/);
assert.match(detail, /neither cause nor resolution/);
assert.doesNotMatch(detail, /cleared on its own|Nothing needs to be done|resolved itself/);
detail = ui.detail({ id: "fault", verdict: "info", active: null, reason: "source_stale" });
assert.match(detail, /current fault state is unreadable/);
assert.match(detail, /No fresh X10A sample/);
assert.doesNotMatch(detail, /right now.*error|No message is active now/);

// The inspector shows two plain readings. Missing input stays unknown and cannot produce zero.
const defrost = { id: "defrost", verdict: "info", evidence: "heuristic", count: 3,
  paired_count: 3, defrost_s: 200, run_s: 1000 };
const defrostRow = (label, value) =>
  `<div class="inspect-row"><span>${label}</span><span>${value}</span></div>`;
assert.equal(ui.defrostInspector(defrost),
  defrostRow("Observed defrost starts", "3") + defrostRow("Defrost share", "20 %"));
assert.match(ui.defrostInspector({ ...defrost, defrost_s: 1 }), /&lt;1 %/);
assert.match(ui.defrostInspector({ ...defrost, defrost_s: 3, run_s: 20 }), /15 %/);
assert.match(ui.defrostInspector({ ...defrost, defrost_s: 12959, run_s: 86393 }), /15\.00005 %/);
assert.equal(ui.defrostInspector({ ...defrost, count: 0, defrost_s: 0 }),
  defrostRow("Observed defrost starts", "0") + defrostRow("Defrost share", "0 %"));
assert.equal(ui.defrostInspector({ ...defrost, defrost_s: null }),
  defrostRow("Observed defrost starts", "3") + defrostRow("Defrost share", "—"));
assert.equal(ui.defrostInspector({ ...defrost, count: null }),
  defrostRow("Observed defrost starts", "—") + defrostRow("Defrost share", "20 %"));
assert.equal(ui.defrostInspector({ id: "defrost", verdict: "collecting" }), "");
assert.equal(ui.defrostInspector({ ...defrost, verdict: "unavailable" }), "");
assert.equal(ui.defrostInspector({ ...defrost, reason: "source_stale" }), "");
assert.equal(ui.defrostInspector(defrost, { source_fresh: false }), "");
assert.equal(ui.defrostInspector(defrost, {}, true), "");
assert.equal(ui.defrostInspector(defrost, { source: "modbus" }), "");
assert.equal(ui.defrostInspector(defrost, { persist: "unknown" }), "");
ui.setLang("de");
assert.equal(ui.defrostInspector({ ...defrost, count: 6, defrost_s: 20, run_s: 980 }),
  defrostRow("Erfasste Abtaustarts", "6") + defrostRow("Abtauanteil", "2,04 %"));
ui.setLang("en");
assert.equal(ui.value({ id: "retries", verdict: "ok", evidence: "experimental", seen: 0 }), "No increase");
assert.equal(ui.value({ id: "retries", verdict: "info", evidence: "experimental", seen: 1 }), "Increase");
assert.equal(ui.value({ id: "retries", verdict: "ok", evidence: "experimental" }), "TENTATIVE");
assert.equal(ui.value({ id: "fault", verdict: "ok", active: 0 }), "");
assert.equal(ui.value({ id: "fault", verdict: "warn", active: 1, latest: { code: "7H-01", duration_s: 120, age_s: 0 } }),
  "7H-01 · for 2 min");
assert.equal(ui.value({ id: "fault", verdict: "info", active: 0, latest: { code: "U4", duration_s: 90, age_s: 10800 } }),
  "U4 · 3 h ago");
assert.equal(ui.value({ id: "fault", verdict: "info", active: null, latest: { code: "U4", duration_s: 90 } }),
  "U4 · Unknown");
assert.equal(ui.value({ id: "flow", verdict: "ok", evidence: "observation" }), "MEASURED");

// The card renders no header summary badge; per-row verdicts carry the state, and unrelated
// metadata cannot turn it into a health score. Pure observations never get a fake assessment denominator.
context.S.status = { health: {
  assessable: 4, evaluated: 2, available: 8,
  span_s: 3600, source_age_s: 5, source_fresh: true, full_span: false,
  checks: [{ ...dhw, verdict: "info" }, pressure, cycling, { id: "fault", verdict: "info", active: 0 }],
} };
let card = ui.card();
assert.doesNotMatch(card, /section-badge/);
assert.doesNotMatch(card, /model:health_pressure|model:health_dhw_loss/);
assert.doesNotMatch(card, /2\/4 checks|checks assessed/);
assert.match(card, /class="vrow-val checkup-val warn"/);
assert.doesNotMatch(card, /All clear|healthy|8 values|health score/);
context.S.status.health = { assessable: 0, evaluated: 0,
  checks: [{ id: "flow", verdict: "ok", evidence: "observation", min_l_min: 8.4 }] };
card = ui.card();
assert.equal(card, "", "a flow-only report belongs in the inspector and cannot create a second card");
context.S.status.health = { assessable: 0, evaluated: 0,
  checks: [{ id: "dhw_loss", verdict: "ok", evidence: "observation", max_k_h: 2.1, windows: 2 }] };
assert.equal(ui.card(), "", "a dhw_loss-only report belongs in the tank inspector and cannot create a Diagnosis card");
context.S.status.health = { persist: "unknown",
  checks: [{ id: "cycling", verdict: "unavailable" }] };
for (const lang of locales) {
  const message = ui.text(lang, "sys.nodata");
  card = ui.card();
  assert.ok(card.includes(message), `${lang}: unreadable snapshot shows the localized empty state`);
  assert.doesNotMatch(card, /health_cycling|N\/A|NaN/);
}
ui.setLang("en");
context.S.status.health = { checks: [cycling, { ...dhw, verdict: "warn" }, { ...pressure, verdict: "warn" }] };
assert.doesNotMatch(ui.card(), /section-badge/);
context.S.status.health = { checks: [{ id: "fault", verdict: "ok", active: 0 }] };
assert.doesNotMatch(ui.card(), /section-badge/);
context.S.status.health = { checks: [collecting] };
assert.doesNotMatch(ui.card(), /section-badge/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn", opaque: "<must-not-render>" }];
assert.equal(ui.card(), "");

// The qualified heating population owns the value and its exact areas.
const exactWindows = {
  t0: Math.floor(1791880000 / 3600) * 3600 - 23 * 3600, slot_s: 300,
  hour_masks: Array.from({ length: 24 }, (_, i) => i === 23 ? 0b101 : 0), locations_missing: false,
};
const heatingFlowCheck = { ...hydronicFlow, verdict: "unavailable", min_l_min: 0,
  hydronic: { ...hydronicFlow.hydronic, current: false }, minimum_windows: exactWindows };
context.S.status = {
  hp: { connected: false },
  diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
  health: { source: "x10a", status: "unavailable", source_fresh: false, persist: "flash", checks: [heatingFlowCheck] },
};
assert.equal(ui.card(false), "", "a heating observation cannot create a separate flow card");
assert.equal(ui.flowReport().source, "x10a");
assert.equal(ui.flowReport().minimum, 7.5, "retained heating minimum is independent of the pump-run value");
assert.equal(ui.flowReport().windows, exactWindows);
for (const lang of locales) {
  ui.setLang(lang);
  const brief = ui.flowBrief(ui.flowReport());
  for (const key of ["check.flow.lowest", "check.flow.runup"])
    assert.ok(brief.includes(escapeText(ui.text(lang, key))), lang + "/" + key + " is visible");
  assert.ok(brief.includes("X10A"));
  assert.doesNotMatch(brief, /check\.flow\.|NaN|Infinity|undefined|Water spread/);
}
ui.setLang("en");
for (const patch of [{ method: 1 }, { method: 3 }, { confirmed: false }, { dated: false }, { samples: 0 },
  { first_evidence_unix_s: null }, ...[null, "5.9", 0, -1, NaN, Infinity].map(min => ({ flow_l_min: { min } }))]) {
  context.S.status.health.checks = [{ ...heatingFlowCheck, hydronic: { ...heatingFlowCheck.hydronic, ...patch } }];
  assert.equal(ui.flowReport().minimum, null, "unadmitted heating evidence has no minimum");
  assert.equal(ui.flowReport().windows, null);
  assert.ok(ui.flowBrief(ui.flowReport()).includes(ui.text("en", "check.flow.waiting")));
}
for (const windows of [null, { ...exactWindows, t0: exactWindows.t0 + 1 },
  { ...exactWindows, slot_s: 60 }, { ...exactWindows, hour_masks: exactWindows.hour_masks.map(() => 4096) }]) {
  context.S.status.health.checks = [{ ...heatingFlowCheck, minimum_windows: windows }];
  assert.equal(ui.flowReport().minimum, 7.5, "old numeric observations remain available");
  assert.equal(ui.flowReport().windows, null, "old or malformed times cannot mark a chart");
  assert.ok(ui.flowBrief(ui.flowReport()).includes(ui.text("en", "check.flow.locations_missing")));
}
context.S.status.health.checks = [heatingFlowCheck];
context.S.status.diagnostics.enabled = false;
assert.equal(ui.flowReport(), null, "disabled diagnostics hide the flow report");
context.S.status.diagnostics.enabled = true;
context.S.status.health.persist = "unknown";
assert.equal(ui.flowReport(), null, "unreadable persistence hides the flow report");
context.S.status.health = { source: "modbus", status: "ok", checks: [heatingFlowCheck] };
assert.equal(ui.flowReport().source, "modbus");
assert.equal(ui.flowReport().minimum, null, "Modbus has no qualified X10A heating minimum");
assert.equal(ui.flowReport().windows, null);
assert.ok(ui.flowBrief(ui.flowReport()).includes(ui.text("en", "check.flow.unavailable")));
const modbusMinimum = { source: "modbus", reason: "observed", min_l_min: 8.2, minimum_windows: exactWindows };
context.S.status.health.source = "x10a";
const setHeatingMinimum = heating_minimum => {
  context.S.status.health.checks = [{ ...heatingFlowCheck, heating_minimum }];
};
setHeatingMinimum(modbusMinimum);
assert.equal(ui.flowReport().source, "modbus", "the heating minimum gets its source independently of other diagnoses");
assert.equal(ui.flowReport().minimum, 8.2, "the selected Modbus result replaces the legacy X10A fields");
assert.equal(ui.flowReport().windows, exactWindows, "windows belong to the selected result");
for (const lang of locales) {
  ui.setLang(lang);
  assert.ok(ui.flowBrief(ui.flowReport()).includes(" · Modbus"), `${lang} identifies the fallback source`);
  setHeatingMinimum({ ...modbusMinimum, reason: "unsupported" });
  assert.equal(ui.flowReport().minimum, null, "unsupported input cannot expose an old minimum");
  assert.equal(ui.flowReport().windows, null);
  assert.ok(ui.flowBrief(ui.flowReport()).includes(escapeText(ui.text(lang, "check.flow.unavailable"))));
  setHeatingMinimum(modbusMinimum);
}
ui.setLang("en");
context.S.status.health.source = "modbus";
setHeatingMinimum({ ...modbusMinimum, source: "x10a", min_l_min: 7.5 });
assert.equal(ui.flowReport().source, "x10a", "an admitted X10A minimum survives a Modbus diagnosis preference");
assert.equal(ui.flowReport().minimum, 7.5);
setHeatingMinimum({ ...modbusMinimum, reason: "collecting" });
assert.equal(ui.flowReport().minimum, null);
assert.ok(ui.flowBrief(ui.flowReport()).includes(ui.text("en", "check.flow.waiting")));
setHeatingMinimum({ ...modbusMinimum, minimum_windows: null });
assert.equal(ui.flowReport().windows, null, "Modbus records cannot borrow X10A locations");
assert.equal(ui.flowReport().locationsMissing, true);
for (const selected of [null, { ...modbusMinimum, source: "sensor" }, { ...modbusMinimum, reason: "unknown" }]) {
  setHeatingMinimum(selected);
  assert.equal(ui.flowReport(), null, "absent or unrecognized selection cannot reuse a legacy result");
}
setHeatingMinimum(modbusMinimum);
context.S.otaCached = true;
assert.equal(ui.flowReport(), null, "cached OTA status cannot publish a flow diagnostic");
context.S.otaCached = false;
context.S.transportUnavailable = "status";
assert.equal(ui.flowReport(), null, "a failed status poll hides obsolete diagnostic evidence");
context.S.transportUnavailable = null;
context.S.status.health = { status: "ok", persist: "fresh", checks: [] };
assert.equal(ui.flowReport(), null, "a firmware frame without a flow report omits the diagnosis");

// Every shipped language must have dynamic copies for the changed states, not English fallback keys.
for (const lang of locales) {
  ui.setLang(lang);
  for (const [payload, key, report] of [
    [cycling, "short"], [normalCycling, "normal"], [fewHeatingRuns, "few"],
    [cyclingCensored, "waiting"], [partialModeCycling, "waiting"],
    [noModeCycling, "class_unavailable"], [stopOnlyCycling, "unavailable"],
    [normalCycling, "stale", staleReport],
  ]) {
    assert.ok(Object.hasOwn(ui.copy[lang], "check.cycling." + key),
      "missing " + lang + "/" + key + " assessment translation");
    hasAssessment(ui.detail(payload, true, report), lang, key);
  }
  const purpose = ui.detail(cyclingCensored);
  for (const [label, count, mean] of [
    ["mode.heat", 12, "5 min"], ["mode.dhw", 2, "15 min"], ["check.cycling.unclear", 15, null],
  ]) assert.ok(purpose.includes(runRow(lang, label, count, mean)), lang + "/" + label + " purpose row");
  assert.ok(purpose.includes(escapeText(ui.text(lang, "check.cycling.unclear_hint"))));
  assert.doesNotMatch(purpose, /check\.cycling\.|checkup-stop-box|undefined|NaN|Infinity/);
  const briefHtml = ui.dhwBrief({
    source: "x10a", maxRate: 1.2, timeline: null, blocked: false, unsupported: false, stale: true,
  }, false);
  for (const key of ["check.dhw.maximum", "check.dhw.locations_missing", "check.dhw.stale"]) {
    assert.ok(briefHtml.includes(escapeText(ui.text(lang, key))), `${lang}: DHW brief missing ${key}`);
  }
  assert.doesNotMatch(briefHtml, /check\.dhw\.|undefined|NaN|Infinity/);
  const localizedDefrost = ui.defrostInspector(defrost, partialReport);
  assert.doesNotMatch(localizedDefrost,
    /check\.defrost\.|undefined|NaN|Infinity/, `missing or misleading ${lang} defrost copy`);
  for (const c of [pressure, cycling, defrost, partialModeCycling,
      { id: "fault", verdict: "info", active: 0 },
      { id: "fault", verdict: "info", active: null, reason: "source_stale" }]) {
    assert.doesNotMatch(ui.detail(c, false, { span_s: 3600, source_age_s: 900, source_fresh: false }),
                       /check\.detail\.|undefined|NaN|Infinity/, `missing or misleading ${lang} copy`);
  }
}
ui.setLang("de");
assert.match(ui.detail(cycling), /≥18 Starts/);
assert.match(ui.detail(cycling), /Die Heizläufe sind im Schnitt kurz\./);
assert.match(ui.detail(normalCycling), /Die Heizläufe dauern im Schnitt lang genug\./);
assert.ok(ui.detail(normalCycling).includes(runRow("de", "mode.heat", 12, "16 min")));
assert.ok(ui.detail(normalCycling).includes(runRow("de", "mode.dhw", 2, "15 min")));
assert.doesNotMatch(ui.detail(cycling), /Kontext beim Stopp|90 %|im Mittel unter 10 min/);
assert.match(ui.dhwBrief({
  source: "x10a", maxRate: 1.2, timeline: null, blocked: false, unsupported: false, stale: false,
}, true), /Stärkste Speicherauskühlung · X10A.*1,2 °C\/h/);
assert.match(ui.detail({ id: "fault", verdict: "info", active: 0 }), /weder Ursache noch Behebung/);
assert.equal(ui.metric({ id: "flow", verdict: "ok", min_l_min: 6.5 }), "6,5 l/min");
assert.equal(ui.value({ id: "fault", verdict: "ok", active: 0 }), "");
assert.equal(ui.value({ id: "fault", verdict: "warn", active: 1, latest: { code: "7H-01", duration_s: 120, age_s: 0 } }),
  "7H-01 · seit 2 min");
assert.equal(ui.value({ id: "fault", verdict: "info", active: 0, latest: { code: "U4", duration_s: 90, age_s: 10800 } }),
  "U4 · vor 3 h");
assert.equal(ui.value({ ...cycling, starts: 19 }), "≥19");

const descriptionContext = {};
vm.runInNewContext(`${i18nSource}${explanationSource}; this.model = MODEL_DESCRIPTIONS;
  this.modelDe = MODEL_DESCRIPTION_I18N.de;`, Object.assign(descriptionContext, context));
const allCheckupCopy = [
  ...Object.values(ui.copy).flatMap(c => Object.entries(c).filter(([k]) => k.startsWith("check.")).map(([,v]) => String(v))),
  ...Object.entries(descriptionContext.model).filter(([k]) => k.startsWith("health_")).map(([,v]) => JSON.stringify(v)),
  ...Object.entries(descriptionContext.modelDe).filter(([k]) => k.startsWith("health_")).map(([,v]) => JSON.stringify(v)),
].join("\n");
for (const pattern of [/Alles in Ordnung/i, /\bAll clear\b/i, /\bhealthy\b|\bhealth status\b/i,
  /\bAnlage (?:ist )?(?:gesund|in Ordnung)\b/i, /cleared on its own|von selbst.*verschwunden/i])
  assert.doesNotMatch(allCheckupCopy, pattern, "diagnosis copy must remain bounded");
assert.doesNotMatch(allCheckupCopy, /each window=maximum|jedes Fenster=Maximum/);
assert.doesNotMatch(explanationSource, /action\.label|b\.action/);
for (const id of ["fault", "dhw_loss", "cycling", "defrost", "pressure", "flow", "heater", "retries"]) {
  const d = descriptionContext.model[`health_${id}`];
  const translated = descriptionContext.modelDe[`health_${id}`];
  for (const [lang,c] of [["en",d],["de",{ what: translated[0], normal: translated[1] }]]) {
    assert.ok(`${c.what} ${c.normal || ""}`.length <= 520, `${id} ${lang} explainer length`);
    assert.ok(!("action" in c), `${id} ${lang} must not invent an action`);
  }
}
const model = descriptionContext.model;
assert.match(model.health_dhw_loss.what, /tank inspector/);
assert.match(model.health_dhw_loss.normal, /Windows ≥0\.8 K\/h are highlighted on the tank chart/);
assert.match(model.health_dhw_loss.normal, /one point in a stratified tank, not measured tank energy/);
assert.match(model.health_dhw_loss.normal, /suggest possible causes without proving one or ruling out other losses/);
for (const copy of [model.health_cycling.what, model.health_cycling.normal,
  ...descriptionContext.modelDe.health_cycling]) {
  assert.ok(copy.length <= 265, "cycling help must fit in a short paragraph");
  assert.doesNotMatch(copy, /≥|90 ?%|Daikin|\bOFF\b|\bON\b/);
}
assert.match(model.health_defrost.what, /removes frost from the outdoor unit/);
assert.match(descriptionContext.modelDe.health_defrost[0], /entfernt die Anlage Reif von der Außeneinheit/);
assert.match(JSON.stringify(model.health_pressure), /Chart guide:.*>1\.0 bar.*≤1\.0 bar.*≤0\.5 bar.*60 continuous seconds/);
assert.match(JSON.stringify(model.health_flow), /Not nominal flow or proof of part load/);
assert.ok(!("normal" in model.health_retries), "health_retries must not carry a generic Normal block");
assert.match(JSON.stringify(model.health_retries), /when stopped or at compressor-state boundaries/);
assert.match(JSON.stringify(model.health_retries), /gaps and resets are ignored/);
assert.match(JSON.stringify(model.health_retries), /Stable counters cannot rule out limiting/);
assert.doesNotMatch(JSON.stringify(model.health_retries), /with the compressor running|bei laufendem Verdichter/);

// Execute the real card/body builders. Generic diagnoses retain three ordered blocks in each
// locale. Cycling adds completed runs and its lazy 24-hour chart around the same explanation.
const renderedContext = vm.createContext({
  S: { descOpen: new Set(), faultCodes: new Set(), faultSnapKeys: null, faultHoverIdx: null }, document: { getElementById: () => null },
  localStorage: { getItem: () => "en", setItem: () => {} }, navigator: { language: "en" },
});
vm.runInContext(`${i18nSource}${dashboardSource}${explanationSource}
  this.rendered = {
    model: modelDescRow,
    detail: checkupDetailHtml,
    value: () => descBodyHtml(DESCRIPTIONS.find(d => d.normal)),
    lang: (value) => { LANG = value; },
  };`, renderedContext);
for (const lang of locales) {
  renderedContext.rendered.lang(lang);
  for (const id of Object.keys(model).filter(id => id.startsWith("health_") && id !== "health_defrost")) {
    for (const verdict of ["ok", "info", "warn", "collecting", "unavailable"]) {
      const c = { ...pressure, id: id.slice(7), verdict };
      const body = renderedContext.rendered.detail(c, false, partialReport);
      const diagnosis = renderedContext.rendered.model(id, "Diagnosis", "NOTE", { bodyHtml: body });
      if (id === "health_fault") {
        assert.ok(body.startsWith('<div class="checkup-fault-panel" data-checkup-fault><div class="checkup-fault-hero">'),
          `${lang}/${id}: panel wraps hero first`);
        assert.ok(!body.includes(ui.text(lang, "normal.label")),
          `${lang}/${id}: must not render a generic Normal block`);
        assert.doesNotMatch(body, /check\.fault_/);
      } else if (id === "health_retries") {
        assert.ok(body.startsWith('<div class="checkup-retries-panel" data-checkup-retries><div class="checkup-retries-hero">'),
          `${lang}/${id}: panel wraps hero first`);
        assert.ok(!body.includes(ui.text(lang, "normal.label")),
          `${lang}/${id}: must not render a generic Normal block`);
        assert.doesNotMatch(body, /check\.retry_/);
        const chipCount = (body.match(/data-retry-counter="/g) || []).length;
        assert.equal(chipCount, verdict === "unavailable" ? 0 : 5,
          `${lang}/${id}/${verdict}: expected monitored counter chips`);
      } else if (id === "health_cycling") {
        assert.match(diagnosis, /checkup-cycling-assessment/);
        assert.match(diagnosis, /data-checkup-hours/);
        const normal = `<span class="vdesc-n">${ui.text(lang, "normal.label")}</span>`;
        assert.ok(!body.includes(normal), `${lang}/${id}: cycling omits redundant Normal block`);
        assert.ok(body.startsWith('<div class="vdesc-p checkup-cycling-total"><span class="vdesc-n">'));
        assert.ok(body.indexOf("checkup-cycling-assessment") < body.indexOf("data-checkup-hours"));
        assert.doesNotMatch(diagnosis, /checkup-stop-box|checkup-cycling-chart/);
      } else {
        assert.equal((diagnosis.match(/class="vdesc-p"/g) || []).length, 3, `${lang}/${id}/${verdict}`);
        assert.ok(body.startsWith('<div class="vdesc-p"><span class="vdesc-n">'), `${lang}/${id}: value first`);
        assert.ok(body.includes(`<span class="vdesc-n">${ui.text(lang, "normal.label")}</span>`),
                  `${lang}/${id}: Normal block`);
      }
      assert.doesNotMatch(body, /undefined|NaN|check\.detail\.|check\.fault_/);
    }
  }
  if (["en", "de"].includes(lang)) {
    assert.match(renderedContext.rendered.model("max_alloc", "Memory", "20 kB"),
                 /<span class="vdesc-n">Normal:<\/span>/);
    assert.match(renderedContext.rendered.value(), /<span class="vdesc-n">Normal:<\/span>/);
  }
}

ui.setLang("en");
const modbusChecks = [
  { id: "fault", verdict: "ok", observed_s: 3600 },
  { id: "pressure", verdict: "unavailable", observed_s: 0 },
  { id: "defrost", verdict: "unavailable", observed_s: 0 },
  { id: "retries", verdict: "unavailable", observed_s: 0 },
  { id: "flow", verdict: "ok", observed_s: 3600 },
  { id: "heater", verdict: "ok", observed_s: 3600 },
  { id: "cycling", verdict: "ok", observed_s: 3600 },
  { id: "dhw_loss", verdict: "ok", observed_s: 3600 },
];
context.S.status = {
  diagnostics: { enabled: true, source: "modbus", effective_source: "modbus", available_sources: ["modbus"] },
  health: { source: "modbus", status: "ok", persist: "no_record", source_fresh: true, checks: modbusChecks },
  refrigerant_service: { state: "observing", continuous_s: 60, samples: 6 },
};
let cardHtml = ui.card(true);
assert.match(cardHtml, /Plant diagnostics · 24 h · Modbus</);
for (const shown of ["health_fault", "health_cycling"])
  assert.ok(cardHtml.includes(shown), `Modbus card must render ${shown}`);
for (const hidden of ["health_defrost", "health_flow", "health_dhw_loss", "health_pressure", "health_heater", "Electric heaters", "health_retries", "refrigerant_service"])
  assert.ok(!cardHtml.includes(hidden), `Modbus card must hide ${hidden}`);

// Diagnosis card badge must ignore dhw_loss and flow verdicts and treat h.status === "info" as ok
// when no visible check has info or warn.
context.S.status = {
  diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
  health: {
    source: "x10a", status: "info", persist: "fresh", source_fresh: true,
    checks: [
      { id: "fault", verdict: "ok", active: 0, observed_s: 3600 },
      { id: "dhw_loss", verdict: "warn", max_k_h: 4.5, windows: 4, observed_s: 14400 },
      { id: "cycling", verdict: "ok", starts: 2, observed_s: 3600 },
      { id: "defrost", verdict: "ok", count: 0, observed_s: 3600 },
      { id: "pressure", verdict: "ok", current_bar: 1.5, observed_s: 3600 },
      { id: "flow", verdict: "info", min_l_min: 10.2, observed_s: 60 },
      { id: "heater", verdict: "ok", buh_s: 0, bsh_s: 0, observed_s: 3600 },
      { id: "retries", verdict: "ok", seen: false, observed_s: 3600 },
    ],
  },
};
cardHtml = ui.card(true);
assert.ok(!cardHtml.includes("health_dhw_loss") && !cardHtml.includes("DHW tank cooling"),
  "X10A Diagnosis card must omit dhw_loss");
assert.ok(!cardHtml.includes("health_heater") && !cardHtml.includes("Electric heaters"),
  "X10A Diagnosis card must omit heater");
assert.doesNotMatch(cardHtml, /section-badge/,
  "Diagnosis card renders no header summary badge");

context.S.status.health.checks[2].verdict = "info";
cardHtml = ui.card(true);
assert.doesNotMatch(cardHtml, /section-badge/);
assert.match(cardHtml, /class="vrow-val checkup-val warn">/,
  "visible cycling info carries its own row verdict without a card badge");

for (const idx of [0, 2, 3, 6]) context.S.status.health.checks[idx].verdict = "collecting";
cardHtml = ui.card(true);
assert.doesNotMatch(cardHtml, /section-badge/);
assert.match(cardHtml, /class="vrow-val checkup-val dim">CHECKING</,
  "collecting checks carry their own dimmed row state without a card badge");

context.S.status.health.checks = modbusChecks.map((c) =>
  c.id === "flow" ? { id: "flow", verdict: "unavailable", observed_s: 0, hydronic: hydronicFlow.hydronic } : c);
cardHtml = ui.card(true);
assert.ok(!cardHtml.includes("health_flow"), "Altherma 4 Modbus mode must hide unavailable flow row");
assert.doesNotMatch(ui.detail({ ...hydronicFlow, secondary_supply: { delta_k: -2.5, duration_s: 15, samples: 4, zone_context: "unknown" } }, false,
                               { source: "modbus", source_fresh: true }),
                    /Water spread:|Pump command:|Evidence dates:|Hourly buckets:|Supply temperature difference/);
context.S.status.health.checks = modbusChecks.map((c) =>
  c.id === "flow" ? { id: "flow", verdict: "unavailable", observed_s: 0, hydronic: hydronicFlow.hydronic } : c);
assert.ok(!ui.card(false).includes("health_flow"),
          "offline Modbus card with unavailable flow must not become visible via X10A hydronic history");

context.S.status.diagnostics = { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a", "modbus"] };
context.S.status.health = { source: "x10a", status: "ok", persist: "no_record", source_fresh: true, checks: modbusChecks };
assert.match(ui.card(true), /Plant diagnostics · 24 h · X10A</);

context.S.status.diagnostics.available_sources = ["x10a"];
assert.match(ui.card(true), /Plant diagnostics · 24 h</);

const mbBrief = ui.dhwBrief({
  source: "modbus", maxRate: 1.5, timeline: null, blocked: false, unsupported: false, stale: true,
}, false);
assert.ok(mbBrief.includes("Modbus"));
assert.ok(mbBrief.includes(ui.text("en", "check.dhw.stale")));
assert.ok(mbBrief.includes(ui.text("en", "check.dhw.locations_missing")));
assert.doesNotMatch(mbBrief, /X10A|HomeHub/);
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "x10a" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "x10a", covered_s: 3600, available: 7, persist: "fresh" },
}), true, "retained X10A history must stay visible when X10A disconnects");
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "modbus" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "modbus", covered_s: 3600, available: 5, persist: "fresh" },
}), true, "retained Modbus history must stay visible when Modbus disconnects");
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "modbus" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "modbus", covered_s: 0, available: 5, persist: "fresh" },
}), true, "confirmed Modbus capabilities must stay visible across transient disconnects");
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "x10a" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "x10a", covered_s: 0, available: 0, persist: "fresh" },
}), false, "disconnected X10A with no retained window stays hidden");
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "modbus" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "modbus", covered_s: 0, available: 0, persist: "fresh" },
}), false, "disconnected Modbus with no retained window stays hidden");
assert.equal(ui.ready({
  diagnostics: { enabled: true, effective_source: "modbus" },
  hp: { connected: false }, modbus: { connected: false },
  health: { source: "modbus", covered_s: 0, available: 0, persist: "unknown" },
}), true, "unreadable restore must remain visible instead of hiding the card");

// Redesigned Unit fault row: healthy stays quiet (empty value + ariaValue), active/past surface
// code + duration (without duplicating -XX subcodes), expanded view places hero -> chart ->
// hidden-by-default newest-first table -> what explainer, and omits any generic Normal target.
{
  ui.setLang("en");
  renderedContext.rendered.lang("en");
  const unixEnd = 1791900000;
  const faultCheck = {
    id: "fault", verdict: "warn", evidence: "manufacturer", active: 1, observed_s: 3600,
    latest: {
      code: "7H-01", base_code: "7H", subcode: 1, state: "fault", unit: "outdoor",
      ongoing: true, stop_unknown: false, age_s: 0, duration_s: 120,
      start_unix_s: unixEnd - 120, secondary_code: "U4", secondary_state: "warning",
    },
    timeline: {
      unix_s: unixEnd, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true,
      segments: [
        { t: 0, k: "gap" },
        { t: 80000, k: "ok" },
        { t: 81000, k: "warn", c: "U4", b: "U4", u: "outdoor" },
        { t: 81600, k: "ok" },
        { t: 86280, k: "err", c: "7H-01", b: "7H", sub: 1, u: "outdoor", sc: "U4", sk: "warn" },
      ],
    },
  };
  context.S.status = {
    health: { source: "x10a", status: "warn", persist: "fresh", source_fresh: true, checks: [faultCheck] },
  };
  const cardActive = ui.card();
  assert.match(cardActive, /7H-01 · for 2 min/);
  assert.doesNotMatch(cardActive, /7H-01-01/);
  const detailEn = renderedContext.rendered.detail(faultCheck, true, { source: "x10a", source_fresh: true });
  assert.doesNotMatch(detailEn, /Normal:|7H-01-01|check\.fault_/);
  assert.ok(detailEn.indexOf("checkup-fault-hero") < detailEn.indexOf("checkup-fault-chart"));
  assert.ok(detailEn.indexOf("checkup-fault-chart") < detailEn.indexOf("checkup-fault-table-wrap\" hidden"));
  assert.ok(detailEn.indexOf("checkup-fault-table-wrap") < detailEn.indexOf("Shows error and warning codes"));
  const tableSlice = detailEn.slice(detailEn.indexOf("<table"));
  assert.ok(tableSlice.indexOf('data-fault-code="7H-01"') < tableSlice.indexOf('data-fault-code="U4"'),
    "fault table rows must render newest-first");
  assert.equal((detailEn.match(/checkup-fault-table-wrap" hidden/g) || []).length, 1,
    "fault table must remain hidden until filtered or bar-tapped");

  context.S.status.health = {
    source: "x10a", status: "ok", persist: "fresh", source_fresh: true,
    checks: [{ id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 3600 }],
  };
  const cardOk = ui.card();
  assert.match(cardOk, /data-desc="model:health_fault"[^>]*aria-label="[^"]*None active"/);
  assert.match(cardOk, /<span class="vrow-val checkup-val ok"><\/span>/);

  for (const lang of locales) {
    renderedContext.rendered.lang(lang);
    ui.setLang(lang);
    const localizedDetail = renderedContext.rendered.detail(faultCheck, true, { source: "x10a", source_fresh: true });
    assert.ok(!localizedDetail.includes(ui.text(lang, "normal.label")),
      `${lang} expanded fault view must omit Normal:`);
    assert.doesNotMatch(localizedDetail, /undefined|NaN|check\.fault_|7H-01-01/);
  }
  ui.setLang("en");
  renderedContext.rendered.lang("en");
}

// Exercise the real browser fixture's cleanup scope without launching any browser on the host.
{
  assert.equal(cyclingPollStopped(null, false), true);
  assert.equal(cyclingPollStopped(null, true), false, "an in-flight request with no timer is not stopped");
  assert.equal(cyclingPollStopped(17, false), false);
  assert.equal(cyclingPollStopped(17, true), false);
  const supervisor = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-cycling-slot-"));
  const lock = path.join(supervisor, "cycling-appearance.lock");
  try {
    let finishClose;
    let firstClosed = false;
    const closing = new Promise(resolve => { finishClose = resolve; });
    const first = withChromiumAppearanceSlot(lock, () => {}, async () => {
      await closing;
      firstClosed = true;
      return true;
    });
    const second = withChromiumAppearanceSlot(lock, () => {
      assert.equal(firstClosed, true, "the next Chromium launch waits for the previous browser to exit");
    }, () => true);
    finishClose();
    await Promise.all([first, second]);
    assert.equal(fs.existsSync(lock), false, "successful close releases the slot");
    const launchError = new Error("no browser handle after a failed start");
    await assert.rejects(withChromiumAppearanceSlot(lock, () => { throw launchError; }, () => false),
      error => error === launchError);
    assert.ok(fs.existsSync(lock), "failed startup must keep the slot when cleanup is unconfirmed");
    fs.rmdirSync(lock);
    const closeError = new Error("browser still owns resources");
    await assert.rejects(withChromiumAppearanceSlot(lock, () => {}, () => { throw closeError; }),
      error => error === closeError);
    assert.ok(fs.existsSync(lock), "failed close must keep the slot until supervisor cancellation");
  } finally {
    fs.rmSync(supervisor, { recursive: true, force: true });
  }
  const order = [];
  assert.equal(await withCyclingCleanup(async () => 26,
    async () => order.push("browser"), async () => order.push("parent-focus")), 26);
  assert.deepEqual(order, ["browser", "parent-focus"]);
  for (const phase of ["matrix assertion", "pause wait"]) {
    const primary = new Error(phase), cleanup = new Error("browser close");
    const attempted = [];
    await assert.rejects(withCyclingCleanup(async () => { throw primary; },
      async () => { attempted.push("browser"); throw cleanup; },
      async () => attempted.push("parent-focus")), error => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [primary, cleanup]);
        return true;
      });
    assert.deepEqual(attempted, ["browser", "parent-focus"]);
    await assert.rejects(withCyclingCleanup(async () => { throw primary; }, async () => {}),
      error => error === primary, "a lone original error must retain its identity");
  }
  const cleanupOnly = new Error("parent focus");
  await assert.rejects(withCyclingCleanup(async () => {}, async () => { throw cleanupOnly; }),
    error => error === cleanupOnly, "a lone cleanup failure must not be hidden");
}

{
  ui.setLang("en");
  const timelineHtml = ui.chart({
    id: "cycling",
    starts: 5,
    timeline: {
      unix_s: 1791900000, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true,
      records: [
        [0, 1], [3600, 5], [3900, 6], [7200, 5], [7500, 6],
        [10800, 5], [11100, 6], [14400, 5], [14700, 6], [18000, 5], [18300, 6],
      ].map(([at, kind]) => at * 8 + kind),
    },
  });
  assert.match(timelineHtml, /<line class="vhist-grid"/,
    "cycling timeline with starts must render dotted integer Y gridlines");
  assert.match(timelineHtml, /<div class="checkup-chart-body vhist-has-y"><div class="vhist-y checkup-chart-y" aria-hidden="true">/,
    "cycling timeline with starts must place Y-axis labels in .vhist-y.checkup-chart-y to the left of the graph");
  assert.match(timelineHtml, /<span class="vhist-y-label num"[^>]*>\d+<\/span>/,
    "cycling timeline with starts must render integer Y-scale labels");
  const zeroHtml = ui.chart({
    id: "cycling",
    starts: 0,
    timeline: {
      unix_s: 1791900000, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true,
      records: [0 * 8 + 1],
    },
  });
  assert.doesNotMatch(zeroHtml, /vhist-has-y|vhist-y|vhist-grid|vhist-y-label/,
    "cycling timeline with zero starts must omit Y gridlines and left Y-axis column");
}

// Checkup enum matrix: exercise all verdict/edge combinations across cycling (including cooling mode
// label + dotMode separation), defrost (all outdoor sources, equality vs range, routes), fault,
// dhw_loss (blocked, candidate/settling, rate, stale), heater, retries, and flow.
{
  ui.setLang("en");
  // cycling: cooling mode must show localized Cooling label while keeping 3-color mode-dot parity.
  const coolTimeline = {
    unix_s: 1791900000, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true, run_edges: true,
    records: [
      [1, 1],
      [79260, 5], [79260, 2], [79560, 1], [79560, 6],
      [79800, 5], [79800, 4], [80100, 1], [80100, 6],
      [82900, 5], [82900, 3], [83200, 1], [83200, 6],
    ].map(([at, kind]) => at * 8 + kind),
  };
  const coolCheck = {
    id: "cycling", verdict: "ok", evidence: "measured", starts: 3, observed_s: 86400, required_s: 86400,
    timeline: coolTimeline,
    run_contexts: [
      { at: 79260, mode: "cooling", start_kind: "normal", stop: 79560, stop_kind: "normal", start_lwt_c: 18.0 },
      { at: 79800, mode: "dhw", start_kind: "dhw_start", stop: 80100, stop_kind: "normal" },
      { at: 82900, mode: "space", start_kind: "normal", stop: 83200, stop_kind: "normal" },
    ],
  };
  const coolDetails = ui.periodDetails(coolTimeline, coolCheck, 22, 23);
  assert.match(coolDetails, /mode-dot other"[^>]*title="Cooling"/,
    "cooling run must label tooltip as Cooling while preserving mode-dot other legend class");
  assert.match(coolDetails, /mode-dot dhw"[^>]*title="Hot water"/);
  assert.match(coolDetails, /mode-dot space"[^>]*title="Heating"/);
  assert.equal(ui.value({ id: "cycling", verdict: "unavailable", starts: 2 }), "N/A");
  assert.equal(ui.value({ id: "cycling", verdict: "collecting", starts: null }), "CHECKING");
  assert.equal(ui.value({ id: "cycling", verdict: "ok", starts: 0 }), "0");
  assert.equal(ui.value({ id: "cycling", verdict: "warn", starts: 14 }), "≥14");

  // fault: every verdict + active combination with and without latest fault code.
  assert.equal(ui.value({ id: "fault", verdict: "unavailable" }), "N/A");
  assert.equal(ui.value({ id: "fault", verdict: "collecting", active: 1 }), "CHECKING");
  assert.equal(ui.value({ id: "fault", verdict: "ok", active: 0 }), "");
  assert.equal(ui.value({ id: "fault", verdict: "ok", active: null }), "Unknown");
  assert.equal(ui.value({ id: "fault", verdict: "info", active: 1 }), "Warning active");
  assert.equal(ui.value({ id: "fault", verdict: "info", active: 0 }), "Previously active");
  assert.equal(ui.value({ id: "fault", verdict: "info", active: null }), "Past · unknown");
  assert.equal(ui.value({ id: "fault", verdict: "warn", active: 1 }), "Fault active");
  assert.ok(ui.value({ id: "fault", verdict: "warn", active: 1, latest: { code: "E5", duration_s: 60 } }).includes("E5"));
  assert.ok(ui.value({ id: "fault", verdict: "info", active: 0, latest: { code: "U4", age_s: 120 } }).includes("U4"));
  assert.ok(ui.value({ id: "fault", verdict: "info", active: null, latest: { code: "H9" } }).includes("H9"));

  // dhw_loss brief matrix: blocked, waiting, unavailable, low rate (< 0.8), high rate + stale + Modbus header.
  const blockedModbus = ui.dhwBrief({ source: "modbus", maxRate: null, blocked: true, unsupported: false, stale: false }, false);
  assert.ok(blockedModbus.includes("DHW tank cooling · Modbus") && blockedModbus.includes(ui.text("en", "check.dhw.no_window")));
  const waitModbus = ui.dhwBrief({ source: "modbus", maxRate: null, blocked: false, unsupported: false, stale: false }, false);
  assert.ok(waitModbus.includes("DHW tank cooling · Modbus") && waitModbus.includes(ui.text("en", "check.dhw.waiting")));
  const unavailX10a = ui.dhwBrief({ source: "x10a", maxRate: null, blocked: false, unsupported: true, stale: false }, false);
  assert.ok(unavailX10a.includes("DHW tank cooling · X10A") && unavailX10a.includes(ui.text("en", "check.status.unavailable")));
  const lowBrief = ui.dhwBrief({ source: "x10a", maxRate: 0.4, blocked: false, unsupported: false, stale: false }, false);
  assert.ok(lowBrief.includes("0.4 °C/h") && !lowBrief.includes(ui.text("en", "check.dhw.locations_missing")));
  const staleHighBrief = ui.dhwBrief({ source: "modbus", maxRate: 2.5, blocked: false, unsupported: false, stale: true }, true);
  assert.ok(staleHighBrief.includes("2.5 °C/h") && staleHighBrief.includes("Modbus") &&
    staleHighBrief.includes(ui.text("en", "check.dhw.stale")) &&
    !staleHighBrief.includes(ui.text("en", "check.dhw.locations_missing")));

  // retries and flow edge inputs.
  assert.equal(ui.value({ id: "retries", verdict: "info", seen: true }), "Increase");
  assert.equal(ui.value({ id: "retries", verdict: "ok", seen: false }), "No increase");
  assert.equal(ui.value({ id: "retries", verdict: "collecting", seen: null }), "CHECKING");
  {
    const okDetail = ui.detail({ id: "retries", verdict: "ok", evidence: "experimental", seen: 0, observed_s: 21600, counters: [] }, false, { source: "x10a", source_fresh: true });
    assert.ok(okDetail.includes("6 h"));
    assert.equal((okDetail.match(/data-retry-counter="/g) || []).length, 5);
    assert.equal((okDetail.match(/retry-chip is-seen/g) || []).length, 0);

    const seenDetail = ui.detail({ id: "retries", verdict: "info", evidence: "experimental", seen: 1, observed_s: 7200, counters: ["high_pressure", "discharge_temp", "unknown_future"] }, false, { source: "x10a", source_fresh: true });
    assert.ok(seenDetail.includes("2 h"));
    assert.equal((seenDetail.match(/retry-chip is-seen/g) || []).length, 2);
    assert.match(seenDetail, /class="retry-chip is-seen" data-retry-counter="discharge_temp"[^>]*>[^<]*<i class="retry-dot"[^>]*><\/i>Discharge temp\. ↑<\/span>/);
    assert.match(seenDetail, /class="retry-chip is-seen" data-retry-counter="high_pressure"[^>]*>[^<]*<i class="retry-dot"[^>]*><\/i>High pressure ↑<\/span>/);
    assert.doesNotMatch(seenDetail, /unknown_future/);
    assert.ok(!seenDetail.includes(ui.text("en", "check.retry_counters_legacy")));

    for (const legacy of [
      { id: "retries", verdict: "info", evidence: "experimental", seen: 1, observed_s: 7200 },
      { id: "retries", verdict: "info", evidence: "experimental", seen: 1, observed_s: 7200, counters: [] },
    ]) {
      const legacyDetail = ui.detail(legacy, false, { source: "x10a", source_fresh: true });
      assert.ok(legacyDetail.includes(ui.text("en", "check.retry_counters_legacy")));
      assert.equal((legacyDetail.match(/retry-chip is-seen/g) || []).length, 0);
    }

    const collectDetail = ui.detail({ id: "retries", verdict: "collecting", evidence: "experimental", observed_s: 0 }, false, { source: "x10a", source_fresh: true });
    assert.ok(collectDetail.includes(ui.text("en", "check.retry_hero_collecting")));
    assert.equal((collectDetail.match(/data-retry-counter="/g) || []).length, 5);

    const unavailDetail = ui.detail({ id: "retries", verdict: "unavailable", evidence: "experimental", observed_s: 0 }, false, { source: "x10a", source_fresh: true });
    assert.ok(unavailDetail.includes(ui.text("en", "check.detail.unavailable")));
    assert.equal((unavailDetail.match(/data-retry-counter="/g) || []).length, 0);

    const staleDetail = ui.detail({ id: "retries", verdict: "ok", evidence: "experimental", seen: 0, observed_s: 3600, reason: "source_stale", counters: [] }, false, { source: "x10a", source_fresh: false, source_age_s: 45 });
    assert.ok(staleDetail.includes(ui.text("en", "check.detail.source_stale")));
    assert.ok(staleDetail.includes("45 s"));
  }
  assert.equal(ui.value({ id: "flow", verdict: "ok", min_l_min: 13.4 }), "13.4 l/min");
  assert.equal(ui.value({ id: "flow", verdict: "collecting", min_l_min: null }), "CHECKING");
}

// BUH & BSH heater diagnostics moved into the BUH and BSH inspectors: /status.health still
// carries the heater observation + X10A context, while checkupCardHtml() omits health_heater and
// the browser derives per-channel inspector briefs. Bind category IDs to the shared C++ serializer.
{
  const heaterPayloadSource = fs.readFileSync(
    new URL("../main/logic/heater_context_payload.hpp", import.meta.url), "utf8");
  const heaterCategories = ["emergency", "error", "defrost_recovery", "dhw_route", "silent",
    "cold_outdoor", "mild_outdoor", "compressor_off", "quiet_mild_heating"];
  for (const id of heaterCategories) assert.ok(heaterPayloadSource.includes(`"${id}"`), id);
  assert.equal(ui.text("en", "check.heater_context.categories").split("|").length, heaterCategories.length);

  const heaterChannel = (patch = {}) => ({
    supported: true, on_s: 0, union_s: 0, overlap_s: 0,
    unknown_context_s: 0, unclassified_s: 0, readable_s: 3600, saturated: false,
    quiet_mild_notice: false,
    categories: Object.fromEntries(heaterCategories.map(id =>
      [id, { supported: true, positive_s: 0, evaluable_on_s: 0, positive_samples: 0 }])),
    ...patch,
  });
  const makeHeaterContext = (patch = {}) => ({
    confirmed: true, dated: true, coverage_partial: true,
    restore_pending: false, persistence_pending: false, archive_incomplete: false,
    clock_uncertain: false, storage_loss: false, dropped: 0,
    buh: heaterChannel(), bsh: heaterChannel(),
    ...patch,
  });
  const setHeaterStatus = (checkPatch = {}, healthPatch = {}, diagPatch = {}, extra = {}) => {
    const check = {
      id: "heater", verdict: "ok", evidence: "observation",
      buh_s: 0, bsh_s: 0, buh_observed_s: 3600, bsh_observed_s: 3600,
      ...checkPatch,
    };
    context.S.status = {
      diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"], ...diagPatch },
      health: { source: "x10a", status: "ok", persist: "fresh", source_fresh: true, ...healthPatch, checks: [check] },
      ...extra,
    };
  };
  const savedState = {
    status: context.S.status,
    otaCached: context.S.otaCached,
    transportUnavailable: context.S.transportUnavailable,
  };
  try {
    ui.setLang("en");
    assert.equal(ui.heaterBrief(null), "");
    assert.equal(ui.heaterReport("other"), null);
    assert.equal(ui.heaterReport(null), null);

    // Gating: disabled diagnostics, OTA cache, transport unavailable, persist unknown, missing check, invalid source -> null.
    setHeaterStatus();
    context.S.status.diagnostics.enabled = false;
    assert.equal(ui.heaterReport("buh"), null, "disabled diagnostics must hide heater report");
    setHeaterStatus();
    context.S.otaCached = true;
    assert.equal(ui.heaterReport("buh"), null, "otaCached must hide heater report");
    context.S.otaCached = false;
    context.S.transportUnavailable = "status";
    assert.equal(ui.heaterReport("buh"), null, "transportUnavailable=status must hide heater report");
    context.S.transportUnavailable = null;
    setHeaterStatus({}, { persist: "unknown" });
    assert.equal(ui.heaterReport("buh"), null, "persist=unknown must hide heater report");
    context.S.status.health.checks = [{ id: "fault", verdict: "ok" }];
    assert.equal(ui.heaterReport("buh"), null, "missing heater check must return null");
    setHeaterStatus({}, { source: "env3" }, { effective_source: "env3" });
    assert.equal(ui.heaterReport("buh"), null, "unsupported source must return null");

    // Card omission in both X10A and Modbus modes.
    for (const src of ["x10a", "modbus"]) {
      setHeaterStatus({ buh_s: 120, bsh_s: 60 }, { source: src }, { source: src, effective_source: src });
      const cHtml = ui.card(true);
      assert.equal(cHtml, "", `${src}: heater-only report must not create a Diagnostics card`);
      assert.ok(!cHtml.includes("health_heater") && !cHtml.includes("Electric heaters"));
    }

    // Waiting state (null runtime, no context) + archive_incomplete & source_stale notes.
    setHeaterStatus({
      verdict: "collecting", buh_s: null, bsh_s: null, buh_observed_s: null,
      context: makeHeaterContext({ archive_incomplete: true }),
    }, { source_fresh: false });
    const waitingRep = ui.heaterReport("buh");
    assert.equal(waitingRep.runtimeText, null);
    assert.equal(waitingRep.archiveIncomplete, true);
    assert.equal(waitingRep.stale, true);
    const waitingBrief = ui.heaterBrief(waitingRep);
    assert.ok(waitingBrief.includes(ui.text("en", "check.heater_insp.waiting")));
    assert.ok(waitingBrief.includes(ui.text("en", "check.heater_insp.archive_incomplete")));
    assert.ok(waitingBrief.includes(ui.text("en", "check.heater_insp.stale")));
    assert.doesNotMatch(waitingBrief, /inspect-diagnosis-result/);

    // Zero runtime with observed_s coverage, dropped > 0, and reason=source_stale.
    setHeaterStatus({
      buh_s: 0, buh_observed_s: 7200, reason: "source_stale",
      context: makeHeaterContext({ dropped: 3 }),
    });
    const zeroRep = ui.heaterReport("buh");
    assert.equal(zeroRep.isZero, true);
    assert.equal(zeroRep.observedS, 7200);
    assert.equal(zeroRep.archiveIncomplete, true);
    assert.equal(zeroRep.stale, true);
    const zeroBrief = ui.heaterBrief(zeroRep);
    assert.match(zeroBrief, /Reported ON time \(24 h\) · X10A<\/span><strong class="num">0 min<\/strong>/);
    assert.ok(zeroBrief.includes(ui.text("en", "check.heater_insp.zero_cov", "2 h")));
    assert.ok(zeroBrief.includes(ui.text("en", "check.heater_insp.archive_incomplete")));
    assert.ok(zeroBrief.includes(ui.text("en", "check.heater_insp.stale")));
    assert.ok(zeroBrief.includes(ui.text("en", "check.heater_insp.limit")));

    // Active runtime with overlapping categories: high-signal priority, positive_s desc, top-3 cap, <1 s, saturated, quiet_mild_notice.
    const ctxOverlapping = makeHeaterContext();
    ctxOverlapping.buh = heaterChannel({
      on_s: 600, quiet_mild_notice: true,
      categories: {
        emergency: { supported: true, positive_s: 0, evaluable_on_s: 600, positive_samples: 1 }, // <1 s, high-signal first
        error: { supported: true, positive_s: 15, evaluable_on_s: 600, positive_samples: 2 }, // high-signal second
        quiet_mild_heating: { supported: true, positive_s: 90, evaluable_on_s: 600, positive_samples: 3 }, // high-signal third
        silent: { supported: true, positive_s: 500, evaluable_on_s: 600, positive_samples: 10 }, // larger duration, capped out by 3 high-signal
        defrost_recovery: { supported: true, positive_s: 300, evaluable_on_s: 600, positive_samples: 5 },
      },
    });
    setHeaterStatus({ buh_s: 600, context: ctxOverlapping });
    const overlapRep = ui.heaterReport("buh");
    assert.deepEqual(Array.from(overlapRep.activeContexts.map(c => c.id)),
      ["emergency", "error", "quiet_mild_heating"]);
    assert.equal(overlapRep.activeContexts[0].subSecond, true);
    const overlapBrief = ui.heaterBrief(overlapRep);
    assert.match(overlapBrief, /Reported ON time \(24 h\) · X10A<\/span><strong class="num">10 min<\/strong>/);
    assert.ok(overlapBrief.includes("Co-occurred with: emergency flag (&lt;1 s), error status (&lt;1 min), Silent Mode + mild heating (1 min)."));
    assert.ok(overlapBrief.includes(escapeText(ui.text("en", "check.heater_context.notice"))));
    assert.ok(!overlapBrief.includes("Silent Mode flag"));
    assert.doesNotMatch(overlapBrief, /OK|WARNING|kWh/);

    // Non-high-signal sorting by positive_s desc + tie-break + top-3 cap + saturated lower bounds.
    const ctxSaturated = makeHeaterContext();
    ctxSaturated.bsh = heaterChannel({
      on_s: 900, saturated: true,
      categories: {
        mild_outdoor: { supported: true, positive_s: 120, positive_samples: 4 },
        dhw_route: { supported: true, positive_s: 120, positive_samples: 4 }, // beats mild_outdoor on tie-break
        compressor_off: { supported: true, positive_s: 300, positive_samples: 6 },
        silent: { supported: true, positive_s: 200, positive_samples: 5 },
        cold_outdoor: { supported: true, positive_s: 0, positive_samples: 1 }, // positive_s:0 with saturated=true is NOT subSecond
      },
    });
    setHeaterStatus({ bsh_s: 900, context: ctxSaturated });
    const satRep = ui.heaterReport("bsh");
    assert.deepEqual(Array.from(satRep.activeContexts.map(c => c.id)),
      ["compressor_off", "silent", "dhw_route"]);
    const satBrief = ui.heaterBrief(satRep);
    assert.ok(satBrief.includes("Co-occurred with: compressor reported stopped (≥5 min), Silent Mode flag (≥3 min), hot-water route (≥2 min)."));

    // Unclassified / unknown context (hasOnNoCategory: on_s > 0 or on_samples > 0 without active categories).
    setHeaterStatus({
      buh_s: 120, buh_observed_s: 3600,
      context: makeHeaterContext({ buh: heaterChannel({ on_s: 120 }) }),
    });
    const unclassRep = ui.heaterReport("buh");
    assert.equal(unclassRep.hasOnNoCategory, true);
    assert.ok(ui.heaterBrief(unclassRep).includes(ui.text("en", "check.heater_insp.active_unclassified_cov", "1 h")));
    setHeaterStatus({
      buh_s: null, buh_observed_s: null,
      context: makeHeaterContext({ buh: heaterChannel({ on_samples: 2 }) }),
    });
    const unclassNoCovRep = ui.heaterReport("buh");
    assert.equal(unclassNoCovRep.hasOnNoCategory, true);
    assert.ok(ui.heaterBrief(unclassNoCovRep).includes(ui.text("en", "check.heater_insp.active_unclassified")));

    // Legacy-null runtime with active independent context (buh_s: null, bsh_s: null) + confirmed=false isolation.
    const ctxLegacyNull = makeHeaterContext();
    ctxLegacyNull.bsh.categories.emergency = { supported: true, positive_s: 5, evaluable_on_s: 10, positive_samples: 2 };
    setHeaterStatus({ verdict: "collecting", buh_s: null, bsh_s: null, context: ctxLegacyNull });
    const legNullRep = ui.heaterReport("bsh");
    assert.equal(legNullRep.runtimeText, null);
    assert.equal(legNullRep.activeContexts.length, 1);
    const legNullBrief = ui.heaterBrief(legNullRep);
    assert.doesNotMatch(legNullBrief, /inspect-diagnosis-result/);
    assert.ok(legNullBrief.includes("Co-occurred with: emergency flag (&lt;1 min)."));
    setHeaterStatus({
      verdict: "collecting", buh_s: null, bsh_s: null,
      context: { ...ctxLegacyNull, confirmed: false, archive_incomplete: true },
    });
    const unconfRep = ui.heaterReport("bsh");
    assert.deepEqual(Array.from(unconfRep.activeContexts), []);
    assert.equal(unconfRep.archiveIncomplete, false);
    assert.ok(ui.heaterBrief(unconfRep).includes(ui.text("en", "check.heater_insp.waiting")));

    // Modbus mode: BSH shows Modbus runtime without X10A context; BUH shows unavailable.
    setHeaterStatus({
      buh_s: 120, bsh_s: 180, buh_observed_s: 3600, bsh_observed_s: 3600,
      context: makeHeaterContext({
        archive_incomplete: true,
        buh: heaterChannel({ on_s: 120, quiet_mild_notice: true, categories: { emergency: { supported: true, positive_s: 60, positive_samples: 2 } } }),
        bsh: heaterChannel({ on_s: 180, quiet_mild_notice: true, categories: { emergency: { supported: true, positive_s: 60, positive_samples: 2 } } }),
      }),
    }, { source: "modbus" }, { source: "modbus", effective_source: "modbus", available_sources: ["modbus"] });
    const mbBuh = ui.heaterReport("buh");
    assert.equal(mbBuh.unsupported, true);
    assert.equal(ui.heaterBrief(mbBuh), `<p>${ui.text("en", "check.heater_insp.unavailable")}</p>`);
    const mbBsh = ui.heaterReport("bsh");
    assert.equal(mbBsh.unsupported, false);
    assert.equal(mbBsh.runtimeText, "3 min");
    assert.deepEqual(Array.from(mbBsh.activeContexts), []);
    assert.equal(mbBsh.archiveIncomplete, false);
    assert.equal(mbBsh.quietMildNotice, false);
    const mbBshBrief = ui.heaterBrief(mbBsh);
    assert.match(mbBshBrief, /Reported ON time \(24 h\) · Modbus<\/span><strong class="num">3 min<\/strong>/);
    assert.ok(mbBshBrief.includes(ui.text("en", "check.heater_insp.active_cov", "1 h")));
    assert.ok(!mbBshBrief.includes("emergency flag"));
    assert.ok(!mbBshBrief.includes(ui.text("en", "check.heater_context.notice")));

    // Legacy buh_min / bsh_min support and negative / NaN runtime rejection.
    setHeaterStatus({ buh_s: null, buh_min: 7, bsh_s: null, bsh_min: 0 });
    assert.equal(ui.heaterReport("buh").runtimeText, "7 min");
    assert.equal(ui.heaterReport("bsh").runtimeText, "0 min");
    assert.equal(ui.heaterReport("bsh").isZero, true);
    for (const [buh_s, buh_min] of [[-5, null], [NaN, null], [Infinity, null], [null, -1], [null, NaN]]) {
      setHeaterStatus({ buh_s, buh_min });
      const badRep = ui.heaterReport("buh");
      assert.equal(badRep.runtimeText, null);
      assert.equal(badRep.isZero, false);
    }

    // All 13 locales render without undefined, NaN, unexpanded keys, or forbidden causal/verdict strings.
    setHeaterStatus({
      buh_s: 600, buh_observed_s: 3600,
      context: makeHeaterContext({ archive_incomplete: true, buh: ctxOverlapping.buh }),
    }, { source_fresh: false });
    for (const lang of locales) {
      ui.setLang(lang);
      const brief = ui.heaterBrief(ui.heaterReport("buh"));
      assert.match(brief, /inspect-diagnosis-result/);
      assert.doesNotMatch(brief, /check\.heater_insp\.|check\.heater_context\.|undefined|NaN|Infinity|\bOK\b|\bWARNING\b|kWh/);
    }
    ui.setLang("en");
  } finally {
    context.S.status = savedState.status;
    context.S.otaCached = savedState.otaCached;
    context.S.transportUnavailable = savedState.transportUnavailable;
    ui.setLang("en");
  }
}

console.log("plant-diagnostics UI contract: evidence, lifecycle, localized claims and counterexamples verified");
