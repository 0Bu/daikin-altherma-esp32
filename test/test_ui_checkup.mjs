// Contract test for the rolling plant-diagnostics card. Executes the production checkup renderer
// from the assembled production UI in a DOM-free VM so wording and null/evidence handling cannot drift into a
// whole-plant health claim while the C++ report remains technically conservative.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

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

// The checkup is the dashboard's first card after the live diagram, before the Model and live
// "Operation" cards. Its bounded 24-hour verdict is therefore visible before the reader scans
// current operating state, and a future card reshuffle cannot silently bury it below that group.
// Asserted against GROUP_ORDER, which is what the page is laid out by. It used to be asserted
// against the first entry of GROUPS — true only while that one array carried both the reading order
// and the match precedence, and quietly wrong the moment precedence had to put an exactly-bounded
// group first. A display claim has to be checked against the display order.
assert.match(dashboardSource, /const GROUP_ORDER = \["Operation"/s,
             "Operation must remain the first live-value group");
assert.match(dashboardSource,
             /const checkup = checkupCardHtml\(\s*S\.status\?\.diagnostics\?\.enabled === true && S\.status\?\.hp\?\.connected\);\s*setHtml\("valueGroups",\s*checkup\s*\+\s*statusCardsHtml\(\)\s*\+/s,
             "plant diagnostics must render first in the post-diagram card stream");
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
  "censored_runs", "split",
  "outdoor_source", "outdoor_min_c", "outdoor_mean_c", "outdoor_samples",
  "min_bar", "current_bar", "min_unix_s", "confirmed_low", "min_l_min",
  "buh_min", "bsh_min", "buh_s", "bsh_s", "buh_observed_s", "bsh_observed_s", "active", "seen",
  "max_k_h", "windows", "high_windows", "high_with_pump", "high_pump_off",
  "draw_windows", "pump_windows", "quiet_high_windows",
  "circulation_on_s", "circulation_known_s", "candidate_s", "settle_remaining_s",
  "aborts", "best_aborted_s", "blocked", "abort_reasons",
]) {
  assert.match(normalizedStatusSource, new RegExp(`"${key}"`),
               `missing /status.health key ${key}`);
}
assert.match(statusSource, /if\s*\(v\s*<\s*0\)\s*\{\s*j\s*\+=\s*"null";\s*return;\s*\}/,
             "unestablished check numbers must serialize as null");
assert.match(style, /\.vrow-val\.checkup-val\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*right;/s,
             "checkup statuses must wrap inside narrow cards");
assert.match(style, /\.vrow-val\.dim\s*\{[^}]*color:\s*var\(--muted\)/s,
             "CHECKING/observation-only rows need a distinct neutral visual state");
assert.match(style, /\.mb-tag\s*\{[^}]*opacity:\s*\.5;/s,
             "Modbus source badge must stay visually subordinate to the reading");
assert.match(checkupSource, /if \(apply_reset_locked\(\)\) return;/,
             "record must discard the sample that consumes an identity reset");
assert.match(checkupSource, /if \(s_reset_requested\.load\(\)\) return logic::CheckupReport\{\};/,
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
             /homehub_history_identity_changed\([\s\S]*?const uint32_t modbus_target_fp[\s\S]*?const bool modbus_enabled[\s\S]*?config_save\([\s\S]*?if \(reset_mb_history\) \{\s*history_modbus_reset\(modbus_target_fp\);[\s\S]*?mb_reconfigure\(modbus_enabled\);[\s\S]*?mqtt_request_modbus_cleanup\(\);\s*\}/m,
             "/set_hp must reset HomeHub history and reconfigure only when host, port or unit identity changes");
assert.match(modbusPollSource,
             /if \(s_have_req && \(target != s_req_host \|\| c\.mb_port != s_req_port \|\| c\.mb_unit_id != s_unit\)\)\s*history_modbus_reset\(logic::history_homehub_target_fingerprint\(/m,
             "the Modbus task must close the race where an old cycle consumes the HTTP reset");

const context = {
  S: { status: null, descOpen: new Set() },
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
     card: checkupCardHtml,
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
assert.equal(ui.metric({ id: "pressure", verdict: "collecting", min_bar: 0 }), "0 bar");
assert.equal(ui.metric({ id: "pressure", verdict: "ok", min_bar: NaN }), "");

// An almost-complete input clock and a partial calendar horizon have different explanations.
const collecting = {
  id: "cycling", verdict: "collecting", evidence: "heuristic", reason: "input_coverage",
  starts: 2, observed_s: 77759, required_s: 77760,
};
let detail = ui.detail(collecting, true, { span_s: 86400, source_age_s: 5, source_fresh: true });
assert.match(detail, /Readable signals: 21 h 35 min of 21 h 36 min required/);
assert.match(detail, /Missing readable time: 1 s/);
assert.match(detail, /Data window: 24 h/);
assert.doesNotMatch(detail, /full 24-hour window is still missing/);
detail = ui.detail({ ...collecting, observed_s: 77760, reason: "day_incomplete" }, false,
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
  for (const id of ["pressure", "cycling", "defrost"]) {
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
assert.equal(ui.value({ ...dhw, verdict: "ok", evidence: "observation" }), "MEASURED");
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
assert.equal(ui.value(markedDhw), "MEASURED");
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
assert.match(detail, /BUH: 2 h readable · BSH: 1 h readable/);

// Only completed, fully classified heating-run means are presented. A pooled long DHW run can
// neither inflate this mean nor restore an assessment after classification becomes insufficient.
const cycling = {
  id: "cycling", verdict: "info", evidence: "heuristic", starts: 13, mean_run_s: 830,
  split: true, space_runs: 12, space_mean_run_s: 300,
  dhw_runs: 1, dhw_mean_run_s: 7200, cooling_runs: 0, censored_runs: 0,
};
assert.equal(ui.metric(cycling), "13 starts · heating 12 · mean 5 min · hot water 1 · mean 2 h");
assert.match(ui.detail(cycling), /≥12 completed heating runs average &lt;10 min/);
assert.match(ui.detail(cycling), /Excludes hot water, cooling and unclassified runs/);
assert.doesNotMatch(ui.metric(cycling), /830|13 min|\/start/);
assert.equal(ui.metric({ ...cycling, space_mean_run_s: 599 }),
             "13 starts · heating 12 · mean 9 min · hot water 1 · mean 2 h");
assert.equal(ui.metric({ ...cycling, space_runs: 0, space_mean_run_s: null,
                        dhw_runs: null, dhw_mean_run_s: null, censored_runs: 9 }),
             "13 starts · heating 0 · 9 unclassified");
assert.equal(ui.metric({ ...cycling, space_runs: null, mean_run_s: 9999 }), "13 starts");
detail = ui.detail({ ...cycling, verdict: "ok", evidence: "observation", split: false,
                     reason: "class_population_incomplete" });
assert.match(detail, /Incomplete classification/);
assert.doesNotMatch(detail, /Assessed on all runs together|all runs are assessed together/);
assert.equal(ui.value({ ...cycling, verdict: "ok", evidence: "observation" }), "MEASURED");
assert.match(ui.detail({ ...cycling, verdict: "ok", evidence: "observation",
                        reason: "heating_runs_insufficient" }), /Fewer than 12 eligible completed heating runs/);

// Minimum, timestamp and current pressure are independent facts. A recovered historical low
// pressure warning remains a historical warning when the present sample is stale.
const pressure = {
  id: "pressure", verdict: "info", evidence: "heuristic", min_bar: 0,
  current_bar: 1.5, min_unix_s: 1791888000, confirmed_low: false,
};
detail = ui.detail(pressure);
assert.match(detail, /Retained minimum ≤1.0 bar/);
assert.match(detail, /continuous 60 s unconfirmed/);
assert.match(detail, /Current water pressure: 1.5 bar/);
assert.match(detail, /Minimum recorded at: [^<]+/);
detail = ui.detail({ ...pressure, verdict: "warn", current_bar: null, min_unix_s: null,
                     confirmed_low: true }, true,
                   { span_s: 86400, source_age_s: 900, source_fresh: false });
assert.match(detail, /Recorded continuous ≥60 s at ≤1.0 bar/);
assert.match(detail, /not a current-pressure statement/);
assert.match(detail, /No fresh X10A sample/);
assert.match(detail, /Current water pressure: No data/);
assert.match(detail, /Minimum recorded at: No data/);

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
assert.equal(ui.value({ id: "retries", verdict: "ok", evidence: "experimental", seen: 0 }), "TENTATIVE");
assert.equal(ui.value({ id: "flow", verdict: "ok", evidence: "observation" }), "MEASURED");
assert.equal(ui.value({ id: "heater", verdict: "ok", evidence: "observation" }), "MEASURED");

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
context.S.status.health = { status: "warn", checks: [dhw, { ...pressure, verdict: "warn" }] };
assert.match(ui.card(), />1 warning<\/span>/);
assert.doesNotMatch(ui.card(), />1 note<\/span>/);
context.S.status.health = { status: "ok", checks: [{ id: "fault", verdict: "ok", active: 0 }] };
assert.match(ui.card(), />No hint in assessed data<\/span>/);
context.S.status.health = { status: "collecting", checks: [collecting] };
assert.match(ui.card(), />Collecting data<\/span>/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn", opaque: "<must-not-render>" }];
assert.equal(ui.card(), "");

// Every shipped language must have dynamic copies for the changed states, not English fallback keys.
for (const lang of locales) {
  ui.setLang(lang);
  const classification = ui.text(lang, "check.detail.cycling_split").trim();
  assert.ok(ui.detail(cycling).includes(classification),
    `${lang} classified heating runs retain their continuous-classification limit`);
  assert.ok(!ui.detail({ ...cycling, space_runs: null }).includes(classification),
    `${lang} missing classification must not imply classified heating runs`);
  for (const c of [dhw, pressure, cycling, defrost, waiting,
      { ...cycling, verdict: "ok", evidence: "observation", reason: "class_coverage" },
      { id: "fault", verdict: "info", active: 0 },
      { id: "fault", verdict: "info", active: null, reason: "source_stale" }]) {
    assert.doesNotMatch(ui.detail(c, false, { span_s: 3600, source_age_s: 900, source_fresh: false }),
                       /check\.detail\.|undefined|NaN|Infinity/, `missing or misleading ${lang} copy`);
  }
}
ui.setLang("de");
assert.match(ui.detail(cycling), /im Mittel unter 10 min/);
assert.doesNotMatch(ui.detail(cycling), /mindestens 12 Läufen unter 10 min/);
assert.match(ui.detail(dhw), /Beobachteter Hinweis; seine Grenze steht unten/);
assert.match(ui.detail(dhw), /Beispiel für eine Stunde: 200 l Wasser/);
assert.match(ui.detail(dhw), /0,28 kWh Wärme/);
assert.match(ui.detail(dhw), /0,09–0,11 kWh Strom/);
assert.match(ui.detail({ id: "fault", verdict: "info", active: 0 }), /weder Ursache noch Behebung/);
assert.equal(ui.metric(pressure), "0 bar");
assert.match(ui.detail(pressure), /Aktueller Wasserdruck: 1,5 bar/);

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
vm.runInNewContext(`${explanationSource}; this.model = MODEL_DESCRIPTIONS;`, descriptionContext);
const allCheckupCopy = [
  ...Object.values(ui.copy).flatMap(c => Object.entries(c).filter(([k]) => k.startsWith("check.")).map(([,v]) => String(v))),
  ...Object.entries(descriptionContext.model).filter(([k]) => k.startsWith("health_")).map(([,v]) => JSON.stringify(v)),
].join("\n");
for (const pattern of [/Alles in Ordnung/i, /\bAll clear\b/i, /\bhealthy\b|\bhealth status\b/i,
  /\bAnlage (?:ist )?(?:gesund|in Ordnung)\b/i, /cleared on its own|von selbst.*verschwunden/i])
  assert.doesNotMatch(allCheckupCopy, pattern, "diagnosis copy must remain bounded");
assert.doesNotMatch(allCheckupCopy, /each window=maximum|jedes Fenster=Maximum/);
assert.doesNotMatch(explanationSource, /action\.label|b\.action/);
for (const id of ["fault", "dhw_loss", "cycling", "defrost", "pressure", "flow", "heater", "retries"]) {
  const d = descriptionContext.model[`health_${id}`];
  for (const [lang,c] of [["en",d],["de",d.de]]) {
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
assert.match(JSON.stringify(model.health_cycling), /≥12 heating runs averaging <10 min/);
assert.match(model.health_cycling.normal, /≥90% of all completed runs classified/);
assert.match(model.health_cycling.de.normal, /≥90 % aller abgeschlossenen Läufe zugeordnet/);
assert.doesNotMatch(JSON.stringify(model.health_cycling), /all runs are assessed together|alle gemeinsam bewertet/);
assert.match(model.health_defrost.what, /compressor runtime with readable compressor and defrost states/);
assert.match(model.health_defrost.de.what, /Verdichterlaufzeit bei lesbarem Verdichter- und Abtaustatus/);
assert.match(JSON.stringify(model.health_pressure), /Project rule:.*60 continuously observed seconds/);
assert.match(JSON.stringify(model.health_flow), /Not nominal flow or proof of part load/);
assert.match(JSON.stringify(model.health_retries), /while stopped or at a compressor-state boundary/);
assert.match(JSON.stringify(model.health_retries), /Gaps, resets and non-rises do not count/);
assert.match(JSON.stringify(model.health_retries), /Stable counters cannot rule out limiting/);
assert.doesNotMatch(JSON.stringify(model.health_retries), /with the compressor running|bei laufendem Verdichter/);
assert.match(JSON.stringify(model.health_cycling), /von OFF zu ON/);

// Execute the real card/body builders. All diagnoses have three ordered blocks in every locale,
// including absent readings and incomplete evidence, without altering ordinary value explainers.
const renderedContext = vm.createContext({
  S: { descOpen: new Set() }, document: { getElementById: () => null },
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
      assert.equal((diagnosis.match(/class="vdesc-p"/g) || []).length, 3, `${lang}/${id}/${verdict}`);
      assert.ok(body.startsWith('<div class="vdesc-p"><span class="vdesc-n">'), `${lang}/${id}: value first`);
      assert.ok(body.includes(`<span class="vdesc-n">${ui.text(lang, "normal.label")}</span>`),
                `${lang}/${id}: Normal block`);
      assert.doesNotMatch(body, /undefined|NaN|check\.detail\./);
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
console.log("plant-diagnostics UI contract: evidence, lifecycle, localized claims and counterexamples verified");
