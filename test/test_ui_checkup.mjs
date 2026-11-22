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
             /return hp\.connected \? vcard\(t\("card\.model"\), model, "", "", "model"\) : "";/,
             "the Model card must follow plant diagnostics and precede Operation without reviving the removed outdoor card");
// Pin the existing /status.health surface plus its additive evidence fields at the actual serializer.
// The UI payloads below are synthetic by design; without this half, a C++ key drift could leave every
// renderer test green while the board sends a different contract.
const normalizedStatusSource = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "health", "covered_s", "status", "checks",
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
  "buh_min", "bsh_min", "buh_s", "bsh_s", "buh_observed_s", "bsh_observed_s", "active", "seen",
  "latest", "base_code", "subcode", "ongoing", "stop_unknown", "start_unix_s", "secondary_code",
  "secondary_state", "timeline", "unix_s", "window_end_s", "observed_end_s", "boot_s", "live",
  "segments",
  "max_k_h", "windows", "high_windows", "high_with_pump", "high_pump_off",
  "draw_windows", "pump_windows", "quiet_high_windows",
  "circulation_on_s", "circulation_known_s", "candidate_s", "settle_remaining_s",
  "aborts", "best_aborted_s", "blocked", "abort_reasons",
]) {
  assert.match(normalizedStatusSource, new RegExp(`"${key}"`),
               `missing /status.health key ${key}`);
}
assert.match(statusSource,
             /case logic::CheckupCheck::Flow:\s*tenths\("min_l_min", ck\.a\);\s*append_hydronic_status\(j, diag_effective\);/,
             "flow check serializer must retain min_l_min and delegate hydronic details");
assert.match(statusSource,
             /if\s*\(diag_effective == DiagnosticsSource::Modbus\)\s*\{[\s\S]*?report\.observation\.partial\s*=\s*false;[\s\S]*?report\.observation\.restore_pending\s*=\s*false;[\s\S]*?report\.reason\s*=\s*logic::HydronicReason::None;[\s\S]*?\}\s*else\s*\{\s*report\s*=\s*checkup_hydronic_report\(\);\s*\}/,
             "Modbus diagnostics mode must serialize an empty hydronic observation with reason_code 0 instead of leaking X10A data");
for (const key of [
  "confirmed", "current", "dated", "coverage_partial", "restore_pending", "persistence_pending",
  "dropped", "observed_hours", "method", "window_s", "settling_s", "max_gap_s", "reason_code",
  "reason", "scope", "weighting", "settling_remaining_s", "source_generation", "schema_fp",
  "current_limitations_mask", "population_limitations_mask", "population_saturated",
  "observed_s", "candidate_s", "qualified_s", "samples", "command_samples",
  "first_evidence_unix_s", "last_evidence_unix_s", "first_accepted_unix_s", "last_accepted_unix_s",
  "target_delta_k", "target_supported",
]) {
  assert.ok(hydronicSource.includes(`key("${key}")`), `missing hydronic serializer key ${key}`);
}
assert.match(hydronicSource,
             /const bool\s+known\s*=\s*confirmed\s*&&\s*observation\.dated\s*&&\s*totals\.first_evidence_unix_us\s*>=\s*0;/,
             "hydronic JSON ranges and dates must stay gated on confirmed dated history");
assert.match(hydronicSource,
             /range\("spread_k",\s*"spread",\s*"k",\s*totals\.spread,\s*totals\.samples\)/);
assert.match(hydronicSource,
             /range\("flow_l_min",\s*"flow",\s*"l_min",\s*totals\.flow,\s*totals\.samples\)/);
assert.match(hydronicSource,
             /range\("pump_command_pct",\s*"pump_command",\s*"pct",\s*totals\.command,\s*totals\.command_samples\)/);
assert.match(statusSource, /if\s*\(v\s*<\s*0\)\s*\{\s*j\s*\+=\s*"null";\s*return;\s*\}/,
             "unestablished check numbers must serialize as null");
assert.match(style, /\.vrow-val\.dim\s*\{[^}]*color:\s*var\(--muted\)/s,
             "CHECKING/observation-only rows need a distinct neutral visual state");
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
     chart: checkupCyclingChartHtml,
     timeline: checkupCyclingTimelineHtml,
     periodDetails: (trace, checkObj, from, to) => { checkupCyclingTimelineHtml(trace, "test-scope", checkObj); return cyclingPeriodDetailsHtml(_cyclingModels.get("test-scope"), from, to); },
     card: checkupCardHtml,
     ready: checkupSourceReadyFor,
     copy: I18N,
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

// Missing channels stay absent; observed zero and a positive sub-minute runtime stay distinct.
for (const [payload, expected] of [
  [{ buh_min: 7, bsh_min: null }, "backup 7 min"],
  [{ buh_min: null, bsh_min: 9 }, "tank 9 min"],
  [{ buh_s: 0, bsh_s: 0 }, "backup 0 min · tank 0 min"],
  [{ buh_s: 1, bsh_s: 59 }, "backup <1 min · tank <1 min"],
]) assert.equal(ui.metric({ id: "heater", verdict: "ok", ...payload }), expected);
for (const c of [
  { id: "cycling", starts: null }, { id: "defrost", count: null },
  { id: "heater", buh_s: null, bsh_s: null },
]) assert.equal(ui.metric({ verdict: "collecting", ...c }), "");
assert.equal(ui.metric({ id: "pressure", verdict: "unavailable", min_bar: 0 }), "");
assert.equal(ui.metric({ id: "pressure", verdict: "collecting", min_bar: 0, current_bar: 1.5 }), "1.5 bar");
assert.equal(ui.metric({ id: "pressure", verdict: "collecting", min_bar: 0 }), "0 bar");
assert.equal(ui.metric({ id: "pressure", verdict: "info", min_bar: 0.8, confirmed_low: true }), "Low · 0.8 bar");
assert.equal(ui.metric({ id: "pressure", verdict: "warn", min_bar: 0.4, confirmed_critical: true }), "Critical · 0.4 bar");
assert.equal(ui.metric({ id: "pressure", verdict: "ok", min_bar: NaN }), "");

// An almost-complete input clock and a partial calendar horizon have different explanations.
const collecting = {
  id: "cycling", verdict: "collecting", evidence: "heuristic", reason: "input_coverage",
  starts: 2, observed_s: 77759, required_s: 77760,
};
const collectingPressure = { ...collecting, id: "pressure" };
let detail = ui.detail(collectingPressure, true, { span_s: 86400, source_age_s: 5, source_fresh: true });
assert.match(detail, /Readable signals: 21 h 35 min of 21 h 36 min required/);
assert.match(detail, /Missing readable time: 1 s/);
assert.match(detail, /Data window: 24 h/);
assert.doesNotMatch(detail, /full 24-hour window is still missing/);
detail = ui.detail({ ...collectingPressure, observed_s: 77760, reason: "day_incomplete" }, false,
                   { span_s: 84600, source_age_s: 5, source_fresh: true });
assert.match(detail, /full 24-hour window is still missing: 30 min remaining/);
assert.doesNotMatch(detail, /insufficient coverage|Missing readable time/);

// A first-hour flow observation needs eligible pump operation, not the rest of a calendar day.
// Exercise actual localized details: daily assessments must keep their waiting explanation,
// while instant/eligible-window observations must preserve scope without inheriting that delay.
const partialReport = { span_s: 900, source_age_s: 1, source_fresh: true };
const collectingFlow = {
  id: "flow", verdict: "collecting", evidence: "observation", reason: "input_coverage",
  observed_s: 0, required_s: 0, min_l_min: null,
};
for (const lang of locales) {
  const horizon = ui.text(lang, "check.detail.horizon_wait", "23 h 45 min");
  const completeHorizon = ui.text(lang, "check.detail.horizon_wait", "0 min");
  const period = `${ui.text(lang, "check.detail.period_label")} 15 min`;
  const ageLabel = ui.text(lang, "check.detail.age_label");
  const flowDetail = ui.detail(collectingFlow, false, partialReport);
  assert.ok(!flowDetail.includes(horizon), `${lang} flow must not require a full day`);
  assert.ok(flowDetail.includes(period), `${lang} flow must retain its observed period`);
  assert.ok(!flowDetail.includes(ageLabel), `${lang} fresh flow need not repeat source age`);
  assert.ok(flowDetail.includes(ui.text(lang, "check.detail.collecting_unknown")),
    `${lang} flow must retain its actual collection state`);
  for (const id of ["pressure", "defrost"]) {
    for (const reason of ["day_incomplete", "input_coverage"]) {
      const daily = { ...collecting, id, reason, observed_s: 900 };
      assert.ok(ui.detail(daily, false, partialReport).includes(horizon),
        `${lang}/${id}/${reason} must explain its missing day`);
      assert.ok(!ui.detail(daily, true, { ...partialReport, span_s: 86400 }).includes(completeHorizon),
        `${lang}/${id} must not add a day once the horizon is complete`);
    }
  }
  for (const id of ["fault", "dhw_loss", "heater", "retries"]) {
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

// Current acquisition must not negate completed DHW hours. Energy is an explicit,
// one-hour illustration from the observed rate, never a meter reading or daily total.
const dhw = {
  id: "dhw_loss", verdict: "info", evidence: "heuristic", reason: "observation_only",
  max_k_h: 1.2, windows: 6, high_windows: 2, high_with_pump: 2, high_pump_off: 0,
  draw_windows: 1, pump_windows: 2, quiet_high_windows: 1,
};
assert.equal(ui.metric(dhw), "maximum 1.2 K/h · 2/6 windows: threshold reached");
assert.equal(ui.metric({ ...dhw, max_k_h: 0.8, windows: 1, high_windows: 1,
                        high_with_pump: 0, high_pump_off: 0 }),
             "maximum 0.8 K/h · 1/1 windows: threshold reached");
const mixedCirculation = { ...dhw, max_k_h: 6, high_pump_off: 1, high_with_pump: 1 };
assert.equal(ui.metric(mixedCirculation), "maximum 6 K/h · 2/6 windows: threshold reached");
assert.doesNotMatch(ui.metric(mixedCirculation), /pump|circulation|off|during/,
  "an off-pump hour among several windows does not identify the maximum hour's context");
assert.match(ui.detail(dhw), /An observed hint; its limit is explained below/);
assert.match(ui.detail(dhw), /internal pump 2; draw-like drop 1; unmarked ≥0.8 K\/h 1/);
assert.match(ui.detail(dhw), /Overlap possible/);
assert.match(ui.detail(dhw), /Example for one hour: 200 l water cooling uniformly at 1.2 K\/h/);
assert.match(ui.detail(dhw), /0.28 kWh heat/);
assert.match(ui.detail(dhw), /0.09–0.11 kWh electricity to replace it at assumed COP 2.5–3 \(heat ÷ electricity\)/);
assert.match(ui.detail(dhw), /Not measured energy/);
assert.doesNotMatch(ui.detail(dhw), /24 h:|per day|1.68|6.70/);
assert.match(ui.detail({ ...dhw, windows: 24 }), /0.28 kWh heat/,
  "energy illustration must not multiply the maximum by a window count");
assert.equal(ui.value({ ...dhw, verdict: "ok", evidence: "observation" }), "1.2 K/h");
assert.equal(ui.value({ ...dhw, verdict: "ok", evidence: "observation", max_k_h: null }), "MEASURED");
assert.match(ui.detail({ ...dhw, verdict: "ok", evidence: "observation" }), /Observation only; no universal OK\/WARNING limit/);
// Zero remains a real observation; missing, non-finite and unsupported evidence cannot
// manufacture a cooling rate or energy. A high marked rate remains visible as MEASURED.
const zeroDhw = { ...dhw, verdict: "ok", evidence: "observation", max_k_h: 0,
  high_windows: 0, high_with_pump: 0, high_pump_off: 0, quiet_high_windows: 0 };
assert.match(ui.metric(zeroDhw), /^maximum 0 K\/h/);
assert.match(ui.detail(zeroDhw), /0.00 kWh heat/);
for (const invalid of [null, undefined, NaN, Infinity, -1, "1.2"]) {
  assert.equal(ui.metric({ ...dhw, max_k_h: invalid }), "6 windows");
  assert.doesNotMatch(ui.detail({ ...dhw, max_k_h: invalid }), /200 l|kWh|NaN|Infinity/);
}
for (const invalid of [0, null, undefined, NaN, Infinity])
  assert.doesNotMatch(ui.detail({ ...dhw, windows: invalid }), /200 l|kWh|NaN|Infinity/);
assert.doesNotMatch(ui.detail({ ...dhw, verdict: "unavailable" }), /200 l|kWh/);
const markedDhw = { ...dhw, verdict: "ok", evidence: "observation", max_k_h: 2.4,
  quiet_high_windows: 0 };
assert.equal(ui.value(markedDhw), "2.4 K/h");
assert.match(ui.detail(markedDhw), /maximum 2.4 K\/h/);
assert.match(ui.detail(markedDhw), /Observation only; no universal OK\/WARNING limit/);
const waiting = {
  id: "dhw_loss", verdict: "collecting", reason: "no_eligible_windows",
  observed_s: 7200, required_s: 21600, windows: 2,
  candidate_s: 0, settle_remaining_s: 0, max_k_h: null,
};
detail = ui.detail(waiting);
assert.match(detail, /Accepted hourly windows: 2; waiting for the next eligible hour/);
assert.doesNotMatch(detail, /no complete.*window yet/);
assert.match(ui.detail({ ...waiting, observed_s: 0, candidate_s: 3300, required_s: 0 }), /current candidate: 55 min of 1 h/);
assert.match(ui.detail({ ...waiting, candidate_s: 0, settle_remaining_s: 1200, required_s: 0 }), /Settling time remaining: 20 min/);
const blocked = {
  ...waiting, verdict: "unavailable", windows: 0, blocked: true, aborts: 14,
  best_aborted_s: 3000, abort_reasons: ["charge", "blind", "unknown_future_reason"],
};
detail = ui.detail(blocked);
assert.match(detail, /Discarded windows: 14 \(tank charging, readings missing: X10A silent or polling paused\)/);
assert.match(detail, /No completed hour in 24 h/);
assert.doesNotMatch(detail, /unknown_future_reason|cause dominated|check the X10A wiring|duty cycle/);
detail = ui.detail({ ...blocked, abort_reasons: ["blind"] });
assert.match(detail, /required readings were unread too long/);
assert.match(detail, /Missing replies or board-side polling pauses/);
assert.match(detail, /establishes nothing about the tank/);
assert.doesNotMatch(detail, /tank temperature went unread|because the X10A link|resolved|call service/);
assert.equal(ui.value(blocked), "NO WINDOW");
assert.equal(ui.value({ ...blocked, verdict: "collecting" }), "NO WINDOW",
  "legacy collecting+blocked must not promise indefinite waiting");
assert.doesNotMatch(ui.detail(blocked), /CHECKING|200 l|kWh/);
assert.equal(ui.value({ ...blocked, verdict: "unavailable", blocked: false }), "N/A");
assert.match(ui.detail({ ...blocked, verdict: "collecting" }), /No completed hour in 24 h/);
const noAttempt = { ...blocked, aborts: 0, best_aborted_s: 0, abort_reasons: [] };
assert.equal(ui.value(noAttempt), "NO WINDOW");
assert.match(ui.detail(noAttempt), /<div class="vdesc-p">No completed hour in 24 h\.<\/div>/);
assert.doesNotMatch(ui.detail(noAttempt), /discarded|interrupted|longest|\(\)|CHECKING|kWh/i);
assert.match(ui.detail({ ...blocked, aborts: 1, abort_reasons: ["reading"] }),
  /Discarded windows: 1 \(R5T unconfirmed\)/);
assert.doesNotMatch(ui.detail({ ...blocked, aborts: 1, abort_reasons: ["reading"] }),
  /implausible|implausibility/i,
  "valid but not confirmed endpoint jitter must not be described as an implausible temperature");
for (const lang of locales) {
  const energy = ui.text(lang, "check.detail.dhw_energy", "1.2", "0.28", "0.09", "0.11");
  assert.ok(energy.includes("200") && energy.includes("COP"), `${lang} retains explicit example assumptions`);
  for (const value of ["1.2", "0.28", "0.09", "0.11"])
    assert.ok(energy.includes(value), `${lang} retains example quantity ${value}`);
  assert.ok(ui.detail(dhw).includes("kWh"), `${lang} renders the energy illustration`);
  assert.ok(!ui.detail({ ...dhw, max_k_h: null }).includes("kWh"), `${lang} hides energy without a rate`);
  assert.equal(ui.value(blocked), ui.text(lang, "check.status.no_window"), `${lang} labels the blocked day`);
  assert.notEqual(ui.value(blocked), ui.text(lang, "check.status.collecting"), `${lang} does not keep waiting`);
  assert.notEqual(ui.value(blocked), ui.text(lang, "check.status.unavailable"), `${lang} distinguishes unsupported profiles`);
  const emptyWindow = ui.text(lang, "check.detail.dhw_blocked", 0, "", "0 min");
  assert.ok(emptyWindow.includes("24"), `${lang} zero-attempt result retains its day scope`);
  assert.doesNotMatch(emptyWindow, /0 min|\(\)|（）|\b0\b/,
    `${lang} zero attempts must not invent discarded candidates or a longest attempt`);
  for (const reasons of [[], ["blind"]]) {
    const noAttemptDetail = ui.detail({ ...noAttempt, abort_reasons: reasons });
    assert.ok(noAttemptDetail.includes(emptyWindow), `${lang} zero attempts render the bounded result`);
    assert.ok(!noAttemptDetail.includes(ui.text(lang, "check.detail.dhw_blocked_link", 0, "0 min")),
      `${lang} zero attempts do not invent interruptions from a legacy blind flag`);
    assert.doesNotMatch(noAttemptDetail, /\(\)|（）|kWh/);
  }
}
ui.setLang("de");
assert.match(ui.detail(noAttempt), /Kein vollständiges Stundenfenster in 24 h\./);
assert.doesNotMatch(ui.detail(noAttempt), /Verworfen|längster|\(\)/);
assert.match(ui.detail({ ...blocked, aborts: 1, abort_reasons: ["reading"] }),
  /R5T unbestätigt/);
assert.doesNotMatch(ui.detail({ ...blocked, aborts: 1, abort_reasons: ["reading"] }),
  /unplausibel|unplausible/i);
ui.setLang("en");

detail = ui.detail({ id: "heater", verdict: "ok", evidence: "observation", buh_s: 0,
  bsh_s: 60, buh_observed_s: 7200, bsh_observed_s: 3600 });
assert.match(detail, /BUH: 2 h covered · BSH: 1 h covered/);

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
assert.match(evictedRunHtml, /Stop unknown/);
assert.match(evictedRunHtml, /Normal stop/);
assert.doesNotMatch(evictedRunHtml.split("83600")[0], /Normal stop/);

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
    method: 1, window_s: 86400, settling_s: 600, max_gap_s: 15,
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
const hydroDetail = (patch = {}, extra = {}) =>
  ui.detail({ ...hydronicFlow, ...extra, hydronic: { ...hydronicFlow.hydronic, ...patch } });
detail = hydroDetail();
assert.match(detail, /Water spread: min -0\.5 · mean 1\.2 · max 3\.4 K/);
assert.match(detail, /flow: min 7\.5 · mean 8\.2 · max 9\.1 l\/min/);
assert.match(detail, /Pump command: min 40 · mean 55 · max 70 %/);
assert.match(detail, /Water readings 4 · command readings 3/);
assert.match(detail, /Observed \/ eligible \/ qualified: 20 s \/ 20 s \/ 20 s/);
assert.match(detail, /Evidence dates: .* – .* UTC/);
assert.match(detail, /Qualified dates: .* – .* UTC/);
assert.match(detail, /Hourly buckets: 1/);
assert.match(detail, /Current: Qualified by project filter/);
assert.match(detail, /Population: Dated/);
assert.match(detail, /Target water temperature difference: No data/);
assert.doesNotMatch(detail, /Supply temperature difference|No assessable signal in this profile/);
assert.match(hydroDetail({ target_supported: true }), /Target water temperature difference: No data/);

const saturatedDetail = hydroDetail({
  coverage_partial: true, restore_pending: true, persistence_pending: true,
  population_saturated: true, dropped: 2,
  current_limitations_mask: 3, population_limitations_mask: 7,
});
assert.match(saturatedDetail, /Water spread: min -0\.5 · mean 1\.2 · max 3\.4 K/);
assert.match(saturatedDetail, /Water readings ≥4 · command readings ≥3/);
assert.match(saturatedDetail, /Observed \/ eligible \/ qualified: ≥20 s \/ ≥20 s \/ ≥20 s/);
assert.match(saturatedDetail, /Hourly buckets: ≥1/);
assert.match(saturatedDetail, /Controller phases unobservable · Pump command unavailable · Saturated: lower bounds/);
assert.match(saturatedDetail, /Dated · Partial 24 h · Restoration pending · Storage pending · Controller phases unobservable · Pump command unavailable · Saturated: lower bounds/);
const saturatedPop = saturatedDetail.match(/Population: [^<]*/)?.[0] || "";
assert.equal((saturatedPop.match(/Saturated: lower bounds/g) || []).length, 1,
             "Population row must print Saturated: lower bounds once when both population_saturated and mask bit 4 are set");
const saturatedOnlyPop = hydroDetail({ population_saturated: true, population_limitations_mask: 3 }).match(/Population: [^<]*/)?.[0] || "";
assert.equal((saturatedOnlyPop.match(/Saturated: lower bounds/g) || []).length, 1,
             "Population row must keep Saturated: lower bounds when mask bit 4 is unset");
assert.match(saturatedDetail, /Storage loss notices ≥2/);

assert.match(hydroDetail({ reason_code: 13, current: true, settling_remaining_s: 45 }), /Run-up remaining 45 s/);
assert.match(hydroDetail({ reason_code: 13, current: false, settling_remaining_s: 45 }), /Current: Qualification unknown · No data/);
assert.doesNotMatch(hydroDetail({ reason_code: 13, current: false, settling_remaining_s: 45 }), /Run-up remaining/);
assert.ok(hydroDetail({ reason_code: 14, current: false }).includes(ui.text("en", "service.reason.poll_gap")),
          "poll-gap code must keep its explanation even when current is false");

const epoch0Date = new Date(0).toLocaleString("en", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) + " UTC";
assert.ok(hydroDetail({ first_evidence_unix_s: 0, last_evidence_unix_s: 60 }).includes(epoch0Date),
          "Unix epoch 0 is a valid dated timestamp and must not turn into No data");
assert.match(hydroDetail({ qualified_s: 0.000001 }), /0\.000001 s/,
             "microsecond qualified duration must not round down to 0 s");
assert.match(hydroDetail({ method: 2 }), /Current: Qualification unknown/);
assert.doesNotMatch(hydroDetail({ method: 2 }), /Water spread:/);
for (const bad of [null, undefined, NaN, Infinity, -1, "0"]) {
  const badHtml = hydroDetail({
    samples: bad, command_samples: bad, observed_hours: bad,
    observed_s: bad, candidate_s: bad, qualified_s: bad,
    spread_k: { min: bad, mean: bad, max: bad },
  });
  assert.doesNotMatch(badHtml, /undefined|NaN|Infinity|-1\b/);
  assert.match(badHtml, /Water spread: No data/);
}
for (const lang of locales) {
  ui.setLang(lang);
  for (let code = 0; code <= 20; code++) {
    const body = hydroDetail({ reason_code: code, reason: "raw_reason_must_not_leak" });
    assert.equal((body.match(/class="vdesc-p"/g) || []).length, 3, `${lang}/H1/${code}`);
    assert.doesNotMatch(body, /check\.hydronic|service\.reason|raw_reason_must_not_leak|undefined|NaN|Infinity/,
                        `${lang}/H1/${code}: raw key or non-finite leak`);
  }
}
ui.setLang("en");

// Water pressure uses 24-hour curve-first diagnosis when X10A history is available, and falls back
// cleanly to concise threshold state labels when no history buffer is advertised.
const pressure = {
  id: "pressure", verdict: "info", evidence: "heuristic", min_bar: 0.8,
  current_bar: 1.5, min_unix_s: 1791888000, confirmed_low: true, confirmed_critical: false,
};
detail = ui.detail(pressure);
assert.match(detail, /24-hour water-pressure curve/);
assert.match(detail, /Low/);
assert.doesNotMatch(detail, /NOTE|WARNING|Minimum recorded at/);
detail = ui.detail({ ...pressure, verdict: "warn", min_bar: 0.4, current_bar: null, min_unix_s: null,
                     confirmed_low: true, confirmed_critical: true }, true,
                   { span_s: 86400, source_age_s: 900, source_fresh: false });
assert.match(detail, /Critical/);
assert.match(detail, /No fresh X10A sample/);
assert.doesNotMatch(detail, /NOTE|WARNING|Minimum recorded at/);

// With water_pressure trend advertised and expanded, checkupCardHtml renders the graph first and
// only the Normal: reference below — zero prose or label clutter above the curve.
context.S.stage = "dashboard";
context.S.dashboardCard = "diagnosis";
context.S.hist = new Map([["water_pressure", { at: Date.now(), gen: 1, dt: 300, unit: "bar", b0: 380, held: [], v: [15, 12, 9, 4, 8, 15] }]]);
context.S.histPin = new Map();
context.S.histHidden = new Map();
context.S.histBusy = new Set();
context.S.histRequests = new Map();
context.S.histEpoch = 1;
context.S.descOpen = new Set(["model:health_pressure"]);
context.S.status = {
  diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
  history: { rows: [{ id: "water_pressure", label: "Water Pressure" }] },
  health: { status: "info", span_s: 86400, full_span: true, source_fresh: true, source_age_s: 1, checks: [pressure] },
};
detail = ui.detail(pressure);
assert.match(detail, /^<div class="vdesc-p"><span class="vdesc-n">Normal:<\/span>/);
assert.doesNotMatch(detail, /24-hour water-pressure curve|NOTE|WARNING|Low|Critical/);
const pressureCard = ui.card(true);
assert.ok(pressureCard.indexOf("data-chart") < pressureCard.indexOf("Normal:"),
          "water_pressure chart must appear before Normal note in expanded diagnosis card");
assert.match(pressureCard, /vhist-thresh low/);
assert.match(pressureCard, /vhist-thresh crit/);
assert.match(pressureCard, /vhist-line warn/);
assert.match(pressureCard, /vhist-line err/);
assert.match(pressureCard, /vhist-legend-low/);
assert.match(pressureCard, /vhist-legend-crit/);
assert.match(pressureCard, /Low · 0\.8 bar/);
context.S.status = null;
context.S.descOpen = new Set();
context.S.hist.clear();
context.S.histPin.clear();
delete context.S.dashboardCard;

// Cleared and unreadable-current fault states must not promise automatic resolution or no action.
detail = ui.detail({ id: "fault", verdict: "info", active: 0 });
assert.match(detail, /No message is active now/);
assert.match(detail, /neither cause nor resolution/);
assert.doesNotMatch(detail, /cleared on its own|Nothing needs to be done|resolved itself/);
detail = ui.detail({ id: "fault", verdict: "info", active: null, reason: "source_stale" });
assert.match(detail, /current fault state is unreadable/);
assert.match(detail, /No fresh X10A sample/);
assert.doesNotMatch(detail, /right now.*error|No message is active now/);

// Runtime denominator is truthful even close to thresholds; event-only evidence stays neutral.
const defrost = { id: "defrost", verdict: "info", evidence: "heuristic", count: 3,
  paired_count: 3, defrost_s: 200, run_s: 1000 };
assert.equal(ui.metric(defrost), "3 cycles · 3 paired · 20 %");
assert.equal(ui.metric({ ...defrost, defrost_s: 1 }), "3 cycles · 3 paired · <1 %");
assert.match(ui.detail({ ...defrost, verdict: "ok", evidence: "observation",
                        count: 2, paired_count: 2,
                        reason: "defrost_events_insufficient" }), /Fewer than three paired defrosts/);
assert.match(ui.detail({ id: "defrost", verdict: "ok", evidence: "observation",
                         reason: "no_paired_runtime", count: 3 }), /event count only/);
assert.match(ui.detail({ ...defrost, last_observed_start: {
  unix_s: null, route: "dhw_route", outdoor_c: 0,
} }), /Last observed defrost start.*Hot-water tank.*0 °C/);
assert.match(ui.detail({ ...defrost, last_observed_start: {
  unix_s: null, route: null, outdoor_c: null,
} }), /Last observed defrost start.*Outdoor air No data/);
assert.doesNotMatch(ui.detail({ ...defrost, last_observed_start: null }), /Last observed defrost start/);
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
assert.equal(ui.value({ id: "defrost", verdict: "ok", evidence: "observation", count: 3, defrost_s: 200, run_s: 1000 }), "20 %");
assert.equal(ui.value({ id: "flow", verdict: "ok", evidence: "observation" }), "MEASURED");
assert.equal(ui.value({ id: "heater", verdict: "ok", evidence: "observation" }), "MEASURED");
assert.equal(ui.value({ id: "heater", verdict: "ok", buh_s: 0, bsh_s: 59 }),
  ui.text("en", "check.min", `${ui.text("en", "check.buh_short")} 0 · ${ui.text("en", "check.tank_short")} <1`));
assert.equal(ui.value({ id: "heater", verdict: "ok", buh_s: null, bsh_s: 0 }),
  ui.text("en", "check.min", `${ui.text("en", "check.tank_short")} 0`));

// The badge counts the highest-severity serialized findings; unrelated metadata cannot turn it
// into a health score. Pure observations never get a fake assessment denominator.
context.S.status = { health: {
  status: "info", assessable: 4, evaluated: 2, available: 8,
  span_s: 3600, source_age_s: 5, source_fresh: true, full_span: false,
  checks: [dhw, pressure, cycling],
} };
let card = ui.card();
assert.match(card, />3 notes<\/span>/);
assert.doesNotMatch(card, /2\/4 checks|checks assessed/);
assert.match(card, /class="vrow-val checkup-val warn"/);
assert.doesNotMatch(card, /All clear|healthy|8 values|health score/);
context.S.status.health = { status: "unavailable", assessable: 0, evaluated: 0,
  checks: [{ id: "flow", verdict: "ok", evidence: "observation", min_l_min: 8.4 }] };
card = ui.card();
assert.match(card, />Observations<\/span>/);
assert.doesNotMatch(card, /0\/0|N\/A<\/span>|>OK</);
context.S.status.health = { status: "unavailable", persist: "unknown",
  checks: [{ id: "cycling", verdict: "unavailable" }] };
for (const lang of locales) {
  const message = ui.text(lang, "sys.nodata");
  card = ui.card();
  assert.ok(card.includes(message), `${lang}: unreadable snapshot shows the localized empty state`);
  assert.doesNotMatch(card, /health_cycling|N\/A|NaN/);
}
ui.setLang("en");
context.S.status.health = { status: "warn", checks: [dhw, { ...pressure, verdict: "warn" }] };
assert.match(ui.card(), />1 warning<\/span>/);
assert.doesNotMatch(ui.card(), />1 note<\/span>/);
context.S.status.health = { status: "ok", checks: [{ id: "fault", verdict: "ok", active: 0 }] };
assert.match(ui.card(), />No hint in assessed data<\/span>/);
context.S.status.health = { status: "collecting", checks: [collecting] };
assert.match(ui.card(), />Collecting data<\/span>/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn", opaque: "<must-not-render>" }];
assert.equal(ui.card(), "");

// Retained dated H1 population keeps the offline X10A flow row visible without overriding badge status
// or spilling onto unconfirmed / undated / method!=1 records.
context.S.status = {
  hp: { connected: false },
  diagnostics: { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a"] },
  health: {
    status: "unavailable",
    checks: [
      { id: "fault", verdict: "unavailable", active: null },
      { ...hydronicFlow, verdict: "unavailable", min_l_min: null,
        hydronic: { ...hydronicFlow.hydronic, current: false, reason_code: 14 } },
    ],
  },
};
const offlineHydroCard = ui.card(false);
assert.ok(offlineHydroCard.includes("health_flow"),
          "offline X10A card must retain confirmed dated H1 flow row");
assert.ok(!offlineHydroCard.includes("health_fault"),
          "H1 retention must not fabricate visibility for unrelated unavailable checks");
assert.match(offlineHydroCard, /class="vrow-val checkup-val dim">N\/A<\/span>/);
assert.doesNotMatch(offlineHydroCard, /badge|No hint|0\/0|>OK</);
for (const unconfirmed of [
  { method: 2 },
  { confirmed: false },
  { dated: false },
  { first_evidence_unix_s: null },
]) {
  context.S.status.health.checks = [{
    ...hydronicFlow, verdict: "unavailable", min_l_min: null,
    hydronic: { ...hydronicFlow.hydronic, ...unconfirmed },
  }];
  assert.equal(ui.card(false), "", "offline X10A card must omit unconfirmed/undated H1 records");
}
context.S.status.health = { status: "ok", persist: "fresh", checks: [] };

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
  const interrupted = { ...dhw, aborts: 3, abort_reasons: ["blind"], best_aborted_s: 2400 };
  const discarded = ui.text(lang, "check.detail.dhw_aborted", 3,
    ui.text(lang, "check.detail.dhw_reason.blind"), "40 min").trim();
  for (const verdict of ["info", "ok"]) {
    const result = { ...interrupted, verdict,
      evidence: verdict === "ok" ? "observation" : "heuristic" };
    assert.ok(ui.detail(result).includes(discarded),
      `${lang}/${verdict} completed windows retain discarded reading-gap evidence`);
    assert.ok(!ui.detail({ ...result, aborts: 0 }).includes(discarded),
      `${lang}/${verdict} must not invent discarded reading-gap evidence`);
  }
  for (const c of [dhw, pressure, cycling, defrost, waiting, partialModeCycling,
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
assert.match(ui.detail(dhw), /Beobachteter Hinweis; seine Grenze steht unten/);
assert.match(ui.detail(dhw), /Beispiel für eine Stunde: 200 l Wasser/);
assert.match(ui.detail(dhw), /0,28 kWh Wärme/);
assert.match(ui.detail(dhw), /0,09–0,11 kWh Strom/);
assert.match(ui.detail({ id: "fault", verdict: "info", active: 0 }), /weder Ursache noch Behebung/);
assert.equal(ui.metric(pressure), "Niedrig · 0,8 bar");
assert.match(ui.detail(pressure), /24-Stunden-Wasserdruckverlauf/);
assert.equal(ui.metric({ id: "flow", verdict: "ok", min_l_min: 6.5 }), "6,5 l/min");
assert.equal(ui.value({ id: "fault", verdict: "ok", active: 0 }), "");
assert.equal(ui.value({ id: "fault", verdict: "warn", active: 1, latest: { code: "7H-01", duration_s: 120, age_s: 0 } }),
  "7H-01 · seit 2 min");
assert.equal(ui.value({ id: "fault", verdict: "info", active: 0, latest: { code: "U4", duration_s: 90, age_s: 10800 } }),
  "U4 · vor 3 h");
assert.equal(ui.value({ ...dhw, max_k_h: 4.8 }), "4,8 K/h");
assert.equal(ui.value({ ...cycling, starts: 19 }), "≥19");

// Copy regression pins for corrected diagnosis claims (U3). The DHW loss peak is a highest
// observed rate, not a bound: no shipped locale may lead it with an "at most" adverb.
assert.match(ui.text("de", "check.loss_max", "0,8"), /^Höchstwert 0,8 K\/h$/,
             "de check.loss_max must read as the observed Höchstwert");
for (const lang of locales) {
  assert.doesNotMatch(ui.text(lang, "check.loss_max", "0,8"),
                      /^(?:maximal|enintään|högst|maksimalt|maksymalnie)(?=\s)/u,
                      `${lang} check.loss_max must name the observed peak, not an upper bound`);
}
// The heating-curve room source does not need its own timestamp; the inactive state does not
// know why the sampler is stopped; a non-heating HomeHub mode is not necessarily cooling.
for (const [lang, stamped, cause, notHeating, label, coolingLabel] of [
  ["en", /timestamped/i, /safe mode|crash/i, /\bnot heating\b/, /^Not heating ·/, /^Cooling ·/],
  ["de", /zeitgestempelt/i, /Sicherheitsmodus|abgesichert|Absturz/i, /\bkein Heiz/, /^Kein Heizbetrieb ·/,
    /^Kühlbetrieb ·/],
]) {
  assert.doesNotMatch(ui.text(lang, "dyn.state_help_setup"), stamped, `${lang} setup help`);
  assert.doesNotMatch(ui.text(lang, "dyn.state_help_inactive"), cause, `${lang} inactive help`);
  assert.match(ui.text(lang, "dyn.state_cooling"), label, `${lang} non-heating state label`);
  assert.doesNotMatch(ui.text(lang, "dyn.state_cooling"), coolingLabel, `${lang} non-heating state label`);
  assert.match(ui.text(lang, "dyn.state_help_cooling"), notHeating, `${lang} non-heating state help`);
}
ui.setLang("de");

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
assert.match(JSON.stringify(model.health_dhw_loss), /one point in a stratified tank/);
assert.match(model.health_dhw_loss.normal, /Project hint ≥0.8 K\/h without pump\/draw-like markers/);
assert.match(model.health_dhw_loss.normal, /Missing markers do not prove no draw/);
assert.match(model.health_dhw_loss.normal, /zero net cooling does not exclude heat loss/);
assert.match(JSON.stringify(model.health_dhw_loss), /correlation, not cause/);
for (const copy of [model.health_cycling.what, model.health_cycling.normal,
  ...descriptionContext.modelDe.health_cycling]) {
  assert.ok(copy.length <= 265, "cycling help must fit in a short paragraph");
  assert.doesNotMatch(copy, /≥|90 ?%|Daikin|\bOFF\b|\bON\b/);
}
assert.match(model.health_defrost.what, /compressor runtime with readable compressor and defrost states/);
assert.match(descriptionContext.modelDe.health_defrost[0], /Verdichterlaufzeit bei lesbarem Verdichter- und Abtaustatus/);
assert.match(JSON.stringify(model.health_pressure), /Chart guide:.*>1\.0 bar.*≤1\.0 bar.*≤0\.5 bar.*60 continuous seconds/);
assert.match(JSON.stringify(model.health_flow), /Not nominal flow or proof of part load/);
assert.match(JSON.stringify(model.health_retries), /while stopped or at a compressor-state boundary/);
assert.match(JSON.stringify(model.health_retries), /Gaps, resets and non-rises do not count/);
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
  for (const id of Object.keys(model).filter(id => id.startsWith("health_"))) {
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
// Exercise the full production accordion, including the model interpretation that owns
// the DHW rule and its limits. The compact measurement prefix must not duplicate it.
for (const lang of locales) {
  renderedContext.rendered.lang(lang);
  ui.setLang(lang);
  const diagnosis = renderedContext.rendered.model("health_dhw_loss", "DHW", ui.value(dhw),
    { bodyHtml: ui.detail(dhw) });
  assert.equal((diagnosis.match(/class="vdesc-p"/g) || []).length, 3,
               `${lang} energy illustration stays inside the three-block explanation`);
  assert.match(diagnosis, /0[,.]8/, `${lang} expanded diagnosis retains its project threshold`);
  assert.match(diagnosis, /200/, `${lang} expanded diagnosis retains the example volume`);
  assert.match(diagnosis, /COP/, `${lang} expanded diagnosis retains its electricity assumption`);
  assert.match(diagnosis, /kWh/, `${lang} expanded diagnosis includes the measured-rate energy illustration`);
  assert.doesNotMatch(diagnosis, /check\.detail\.|undefined|NaN/);
  if (lang === "en") {
    assert.match(diagnosis, /Missing markers do not prove no draw/);
    assert.match(diagnosis, /zero net cooling does not exclude heat loss/);
    assert.match(diagnosis, /correlation, not cause/);
    assert.match(diagnosis, /not measured tank energy/);
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
for (const shown of ["health_fault", "health_flow", "health_heater", "health_cycling", "health_dhw_loss"])
  assert.ok(cardHtml.includes(shown), `Modbus card must render ${shown}`);
for (const hidden of ["health_defrost", "health_pressure", "health_retries", "refrigerant_service"])
  assert.ok(!cardHtml.includes(hidden), `Modbus card must hide ${hidden}`);

context.S.status.health.checks = modbusChecks.map((c) =>
  c.id === "flow" ? { id: "flow", verdict: "unavailable", observed_s: 0, hydronic: hydronicFlow.hydronic } : c);
cardHtml = ui.card(true);
assert.ok(!cardHtml.includes("health_flow"), "Altherma 4 Modbus mode must hide unavailable flow row");
assert.doesNotMatch(ui.detail(hydronicFlow, false, { source: "modbus", source_fresh: true }),
                    /Water spread:|Pump command:|Evidence dates:|Hourly buckets:/);
context.S.status.health.checks = modbusChecks.map((c) =>
  c.id === "flow" ? { id: "flow", verdict: "unavailable", observed_s: 0, hydronic: hydronicFlow.hydronic } : c);
assert.ok(!ui.card(false).includes("health_flow"),
          "offline Modbus card with unavailable flow must not become visible via X10A hydronic history");

context.S.status.diagnostics = { enabled: true, source: "x10a", effective_source: "x10a", available_sources: ["x10a", "modbus"] };
context.S.status.health = { source: "x10a", status: "ok", persist: "no_record", source_fresh: true, checks: modbusChecks };
assert.match(ui.card(true), /Plant diagnostics · 24 h · X10A</);

context.S.status.diagnostics.available_sources = ["x10a"];
assert.match(ui.card(true), /Plant diagnostics · 24 h</);

const mbDetail = ui.detail(
  { id: "dhw_loss", verdict: "info", blocked: true, abort_reasons: ["blind", "draw"], aborts: 1, windows: 0, observed_s: 300, required_s: 0 },
  false, { source: "modbus", source_fresh: false });
assert.ok(mbDetail.includes(ui.text("en", "check.detail.dhw_reason.blind_modbus")));
assert.ok(mbDetail.includes(ui.text("en", "check.detail.source_stale_modbus")));
assert.doesNotMatch(mbDetail, /X10A|HomeHub/);
const mbOutdoorMetric = ui.metric({
  id: "defrost", verdict: "ok", count: 3, paired_count: 3, share_pct: 5,
  outdoor_source: "homehub", outdoor_min_c: 2.0, outdoor_mean_c: 3.0, outdoor_samples: 10,
});
assert.match(mbOutdoorMetric, /Modbus/);
assert.doesNotMatch(mbOutdoorMetric, /HomeHub/);
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

console.log("plant-diagnostics UI contract: evidence, lifecycle, localized claims and counterexamples verified");
