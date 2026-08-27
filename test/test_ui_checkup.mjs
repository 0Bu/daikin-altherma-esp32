// Contract test for the rolling plant-diagnostics card. Executes the production checkup renderer
// from the assembled production UI in a DOM-free VM so wording and null/evidence handling cannot drift into a
// whole-plant health claim while the C++ report remains technically conservative.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const i18nSource = readAppFragments(["i18n.js"]) + readUiLocale("de");
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
             /return hp\.connected \? vcard\(t\("card\.model"\), model\) : "";/,
             "the Model card must follow plant diagnostics and precede Operation without reviving the removed outdoor card");

// Pin the existing /status.health surface plus its additive evidence fields at the actual serializer.
// The UI payloads below are synthetic by design; without this half, a C++ key drift could leave every
// renderer test green while the board sends a different contract.
const normalizedStatusSource = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "health", "covered_s", "status", "checks",
  "persist",
  "full_span", "available", "assessable", "evaluated", "evidence", "observed_s", "required_s",
  "starts", "mean_run_s", "count", "paired_count", "share_pct", "defrost_s", "run_s",
  "space_runs", "space_mean_run_s", "dhw_runs", "dhw_mean_run_s", "cooling_runs",
  "censored_runs", "split",
  "outdoor_source", "outdoor_min_c", "outdoor_mean_c", "outdoor_samples",
  "min_bar", "min_l_min", "buh_min", "bsh_min", "buh_s", "bsh_s", "active", "seen",
  "max_k_h", "windows", "high_windows", "high_with_pump", "high_pump_off",
  "circulation_on_s", "circulation_known_s", "candidate_s", "settle_remaining_s",
  "aborts", "best_aborted_s", "blocked", "abort_reasons",
]) {
  assert.match(normalizedStatusSource, new RegExp(`"${key}"`),
               `missing /status.health key ${key}`);
}
assert.match(statusSource, /if \(v < 0\) \{ j \+= "null"; return; \}/,
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
             /set_hp_resets_checkup\([^;]+;\s*[\s\S]*?if \(reset_checkup\) \{\s*hp_poll_reconfigure\(\);\s*checkup_reset\(\);\s*dwell_reset\(\);\s*history_reset\(\);/m,
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
  S: { status: null },
  document: { getElementById: () => null },
  fetch: () => { throw new Error("unexpected fetch in checkup test"); },
  localStorage: { getItem: () => "en", setItem: () => {} },
  navigator: { language: "en" },
  descNoteHtml: (lead, text) => `<detail label="${lead}">${text}</detail>`,
  descAccordion: (key, label, value, cls, body) =>
    `<row id="${key}" tone="${cls}" label="${label}"><value>${value}</value>${body}</row>`,
  // Keep the renderer's semantic inputs visible in a compact deterministic string; no DOM is needed.
  modelDescRow: (id, label, value, opt = {}) =>
    `<row id="${id}" tone="${opt.cls || ""}" label="${label}"><value>${value}</value>${opt.bodyPrefix || ""}</row>`,
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${i18nSource}${dashboardSource}
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

// The title keeps the bounded 24-hour scope without consuming most of a narrow card's first line.
assert.equal(ui.text("en", "card.checkup"), "Plant diagnostics · 24 h");
assert.equal(ui.text("de", "card.checkup"), "Anlagendiagnose · 24 h");
for (const copy of Object.values(ui.copy)) {
  assert.ok(!("check.guide" in copy), "the removed guide row must have no translation");
  assert.ok(!("check.guide.value" in copy), "the removed guide value must have no translation");
  assert.ok(!("action.label" in copy), "diagnostic explainers must not advertise recommendations");
}
for (const [key, en, de] of [
  ["ok", "OK", "OK"],
  ["info", "NOTE", "HINWEIS"],
  ["warn", "WARNING", "WARNUNG"],
  ["collecting", "CHECKING", "PRÜFT"],
  ["observation", "MEASURED ONLY", "NUR MESSWERT"],
  ["experimental", "EXPERIMENTAL", "EXPERIMENTELL"],
  ["unavailable", "NOT AVAILABLE", "NICHT VERFÜGBAR"],
]) {
  assert.equal(ui.text("en", `check.status.${key}`), en);
  assert.equal(ui.text("de", `check.status.${key}`), de);
}

// BUH and BSH are independent channels. An unsupported/unreadable side is null, not a plausible zero,
// while a real observed zero remains visible.
ui.setLang("en");
assert.equal(
  ui.metric({ id: "heater", verdict: "ok", buh_min: 7, bsh_min: null }),
  "7 min",
  "a missing BSH channel must not be rendered as zero minutes",
);
assert.equal(
  ui.metric({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }),
  "tank 9 min",
  "a missing BUH channel must not suppress an observed BSH value",
);
assert.equal(
  ui.metric({ id: "heater", verdict: "ok", buh_min: 0, bsh_min: 0 }),
  "0 min · tank 0 min",
  "observed zeroes are facts and must not be mistaken for missing channels",
);
ui.setLang("de");
assert.equal(ui.metric({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }), "Speicher 9 min");
assert.equal(
  ui.metric({ id: "heater", verdict: "ok", buh_s: 1, bsh_s: 59 }),
  "<1 min · Speicher <1 min",
  "positive sub-minute heater runtime must not collapse into a factual zero",
);
assert.equal(
  ui.metric({ id: "heater", verdict: "ok", buh_s: 0, bsh_s: 60 }),
  "0 min · Speicher 1 min",
  "an exact observed zero remains distinct from a positive runtime",
);

// Capability without one readable interval serializes as null. The renderer must say it is still
// collecting instead of turning those unknowns into plausible zero starts/cycles/minutes.
ui.setLang("en");
for (const payload of [
  { id: "cycling", verdict: "collecting", starts: null },
  { id: "defrost", verdict: "collecting", count: null, paired_count: null },
  { id: "heater", verdict: "collecting", buh_s: null, bsh_s: null },
]) {
  const check = { observed_s: 0, required_s: 3600, ...payload };
  assert.equal(ui.value(check), "CHECKING");
  assert.doesNotMatch(ui.metric(check), /\b0 (?:starts|cycles)\b/,
                      "unreadable supported data must not render as an observed zero");
}

// The collapsed row carries only its status. Its reading, assessment and own observed/required
// clocks move to the explainer, proving that card-level coverage is not borrowed.
ui.setLang("en");
const cyclingCollecting = {
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 3600, required_s: 7200,
};
const pressureCollecting = {
  id: "pressure", verdict: "collecting", min_bar: 1.7,
  observed_s: 120, required_s: 3600,
};
assert.equal(ui.value(cyclingCollecting), "CHECKING");
assert.equal(ui.value(pressureCollecting), "CHECKING");
assert.match(ui.detail(cyclingCollecting), /label="Value:">2 starts<\/detail>/);
assert.match(ui.detail(cyclingCollecting), /label="Assessment:">CHECKING — 1 h of 2 h captured/);
assert.match(ui.detail(pressureCollecting), /label="Value:">1\.7 bar<\/detail>/);
assert.match(ui.detail(pressureCollecting), /label="Assessment:">CHECKING — 2 min of 1 h captured/);

// DHW has an all-or-nothing one-hour eligibility window.  Expose the in-flight progress separately
// so a successful OTA handoff cannot look identical to a reset merely because observed_s still
// counts completed windows only.
const dhwCandidate = {
  id: "dhw_loss", verdict: "collecting", observed_s: 0, required_s: 21600,
  candidate_s: 3300, settle_remaining_s: 0, windows: 0, max_k_h: null,
};
assert.match(ui.detail(dhwCandidate),
  /CHECKING — 0 min of 6 h completed in clean one-hour windows; current clean window: 55 min of 1 h/);
ui.setLang("de");
assert.match(ui.detail(dhwCandidate),
  /PRÜFT — 0 min von 6 h als vollständige bereinigte Stundenfenster erfasst; laufendes bereinigtes Fenster: 55 min von 1 h/);
const dhwSettling = { ...dhwCandidate, candidate_s: 0, settle_remaining_s: 1200 };
assert.match(ui.detail(dhwSettling),
  /PRÜFT — 0 min von 6 h als vollständige bereinigte Stundenfenster erfasst; Speicherladung oder BSH erkannt, noch 20 min Beruhigungszeit/);

// WHAT THE WINDOW DISCARDED rides every collecting sentence. "0 min" alone reads exactly like a
// board that booted a minute ago; "0 min, and nine candidates were thrown away by tank charging"
// is the half that says where to look — and whether waiting will ever help.
const dhwAborted = { ...dhwSettling, aborts: 9, best_aborted_s: 2400,
                     abort_reasons: ["charge", "pump"] };
assert.match(ui.detail(dhwAborted),
  /noch 20 min Beruhigungszeit\. 9 Kandidaten wurden verworfen \(Speicherladung, interne Pumpe\); längster erreichte 40 min von 60 min\./);
ui.setLang("en");
assert.match(ui.detail(dhwAborted),
  /9 candidate windows discarded \(tank charging, internal pump\); longest reached 40 min of 60 min\./);
assert.match(ui.detail({ ...dhwAborted, aborts: 1, abort_reasons: ["pump"] }),
             /1 candidate window discarded \(internal pump\)/);
// Older firmware sends none of these keys: the sentence must simply not appear.
assert.doesNotMatch(ui.detail(dhwSettling), /discarded/);
// A slug this build does not know is dropped rather than rendered as a raw key that would read
// like a cause. The firmware sends names, so the browser never decodes a bitmask.
assert.match(ui.detail({ ...dhwAborted, abort_reasons: ["charge", "from_the_future"] }),
             /discarded \(tank charging\)/);

// THE VERDICT THAT SAYS WAITING WILL NOT HELP. Unavailable like a profile that cannot supply the
// rows — it says nothing either way — but `blocked` gets its own sentence instead of the generic
// "the active profile provides no assessable data". The plant-side sentence must remain NON-CAUSAL:
// the payload has an abort total plus an OR-ed reason set, not per-reason counts or circulation
// evidence for aborted candidates.
const dhwBlocked = { id: "dhw_loss", verdict: "unavailable", observed_s: 0, required_s: 21600,
                     windows: 0, max_k_h: null, blocked: true, aborts: 14, best_aborted_s: 3000,
                     abort_reasons: ["charge"] };
assert.match(ui.detail(dhwBlocked),
  /NOT AVAILABLE — Not assessable with this method: over a full 24 hours not one clean one-hour window completed, and 14 candidate windows were discarded \(tank charging\); the longest reached 50 min of 60 min\./);
assert.match(ui.detail(dhwBlocked), /continuous heat loss fast enough to look like a draw/);
assert.match(ui.detail(dhwBlocked), /stored totals do not show which cause dominated/);
assert.match(ui.detail(dhwBlocked), /fast continuous heat loss cannot be excluded/);
assert.doesNotMatch(ui.detail(dhwBlocked), /plant's own duty cycle/);
ui.setLang("de");
assert.match(ui.detail(dhwBlocked),
  /NICHT VERFÜGBAR — Mit diesem Verfahren nicht bewertbar: über volle 24 Stunden wurde kein einziges bereinigtes Stundenfenster fertig, 14 Kandidaten wurden verworfen \(Speicherladung\)/);
assert.match(ui.detail(dhwBlocked), /schneller Dauerverlust, der wie eine Zapfung aussieht/);
assert.match(ui.detail(dhwBlocked), /gespeicherten Summen zeigen nicht, welcher Grund überwog/);
assert.match(ui.detail(dhwBlocked), /schneller kontinuierlicher Wärmeverlust ist daher nicht ausgeschlossen/);
assert.doesNotMatch(ui.detail(dhwBlocked), /Takt dieser Anlage/);
// The SAME verdict is reachable from a flapping X10A link — a candidate opens, the bus goes quiet
// mid-window, repeatedly — and that needs the opposite action from a plant that never stands still.
// Blaming the duty cycle there sends the reader to the heat pump for a wiring fault.
const dhwBlockedByLink = { ...dhwBlocked, abort_reasons: ["blind"] };
assert.match(ui.detail(dhwBlockedByLink),
             /weil die X10A-Verbindung mitten im Fenster aufhörte zu antworten/);
assert.match(ui.detail(dhwBlockedByLink), /prüfe die X10A-Verkabelung und die RX\/TX-Pins/);
assert.doesNotMatch(ui.detail(dhwBlockedByLink), /Takt dieser Anlage/);
ui.setLang("en");
assert.match(ui.detail(dhwBlockedByLink), /This is the link, not the plant/);
// A mix names what was seen but cannot rank its causes.
assert.match(ui.detail({ ...dhwBlocked, abort_reasons: ["charge", "blind"] }),
             /stored totals do not show which cause dominated/);
assert.doesNotMatch(ui.detail({ ...dhwBlocked, abort_reasons: ["charge", "blind"] }),
                    /plant's own duty cycle/);
ui.setLang("de");

// The OTHER unavailable — a profile without the rows — keeps the generic sentence.
assert.match(ui.detail({ id: "dhw_loss", verdict: "unavailable", observed_s: 0, required_s: 21600 }),
             /Das aktive Profil liefert für diese Prüfung keine auswertbaren Daten/);
ui.setLang("de");

ui.setLang("en");
assert.equal(
  ui.metric({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 599 }),
  "12 starts · 9 min/start",
  "a mean below the ten-minute heuristic must not round up to the boundary",
);
assert.equal(
  ui.metric({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 1 }),
  "12 starts · <1 min/start",
  "positive runtime must not render as zero",
);

// ── the operating-class split ────────────────────────────────────────────────────────────────────
// The class figures count COMPLETED RUNS. When the split DECIDED (`split:true`) the pooled mean is
// the misleading half — a long tank charge inflates it — so the classes replace it on the line.
const cyclingSplit = {
  id: "cycling", verdict: "info", starts: 13, mean_run_s: 830, split: true,
  space_runs: 12, space_mean_run_s: 300, dhw_runs: 1, dhw_mean_run_s: 7200,
  cooling_runs: 0, censored_runs: 0,
};
assert.equal(ui.metric(cyclingSplit), "13 starts · space 12 × 5 min · hot water 1 × 2 h");
assert.match(ui.detail(cyclingSplit), /Only confirmed space heating is assessed here/);
assert.match(ui.detail(cyclingSplit), /I\/U operating mode must stay readable and unchanged/,
             "the complete run-level class contract must be visible to the reader");
ui.setLang("de");
assert.equal(ui.metric(cyclingSplit), "13 Starts · Raum 12 × 5 min · Warmwasser 1 × 2 h");
assert.match(ui.detail(cyclingSplit), /Bewertet wird nur bestätigte Raumheizung/);
assert.match(ui.detail(cyclingSplit), /sicher erkannte Kühlung ist ausgeschlossen/);
ui.setLang("en");

const cyclingWeather = { ...cyclingSplit, outdoor_source: "x10a", outdoor_min_c: -5.0,
                         outdoor_mean_c: -1.5, outdoor_samples: 120 };
assert.equal(ui.metric(cyclingWeather),
  "13 starts · space 12 × 5 min · hot water 1 × 2 h · X10A min -5.0 °C · mean -1.5 °C");
assert.match(ui.detail(cyclingWeather), /only fresh samples from completed, consistently classified/);
assert.match(ui.detail(cyclingWeather), /do not change the cycling threshold or verdict/);
ui.setLang("de");
assert.match(ui.metric(cyclingWeather), /X10A min\. -5,0 °C · Mittel -1,5 °C/);
assert.match(ui.detail(cyclingWeather), /ändern weder Taktgrenze noch Bewertung/);
ui.setLang("en");
// Missing context is absent, never a plausible 0 °C. One real constant-temperature context remains
// visible without inventing a range.
assert.doesNotMatch(ui.metric(cyclingSplit), /X10A|0\.0 °C/);
assert.match(ui.metric({ ...cyclingSplit, outdoor_source: "x10a", outdoor_min_c: 0,
                         outdoor_mean_c: 0, outdoor_samples: 2 }), /X10A 0\.0 °C/);

assert.equal(
  ui.metric({ ...cyclingSplit, cooling_runs: 4 }),
  "13 starts · space 12 × 5 min · hot water 1 × 2 h · cooling 4 excluded",
  "positively identified cooling must be visible but never relabelled as heating",
);
ui.setLang("de");
assert.equal(
  ui.metric({ ...cyclingSplit, cooling_runs: 4 }),
  "13 Starts · Raum 12 × 5 min · Warmwasser 1 × 2 h · Kühlen 4 ausgeschlossen",
);
ui.setLang("en");

// Runs that happened but could not be classified are shown, so `space 0` can never be read as "no
// space heating ran" when in truth nothing could be judged.
assert.equal(
  ui.metric({ ...cyclingSplit, space_runs: 0, space_mean_run_s: null,
              dhw_runs: 0, dhw_mean_run_s: null, censored_runs: 9 }),
  "13 starts · space 0 · hot water 0 · 9 unclassified",
);

// THE FALLBACK (#443 live review): the valve row exists in the catalog but was too sparse to judge
// with. The pooled mean is what decided, so it stays on the line, the class figures ride along as
// observation, and the copy says which one carried the verdict.
const cyclingPooled = {
  id: "cycling", verdict: "ok", starts: 16, mean_run_s: 3600, split: false,
  space_runs: 2, space_mean_run_s: 1800, dhw_runs: 1, dhw_mean_run_s: 900,
  cooling_runs: 0, censored_runs: 3,
};
assert.equal(ui.metric(cyclingPooled),
             "16 starts · 1 h/start · space 2 × 30 min · hot water 1 × 15 min · 3 unclassified");
assert.match(ui.detail(cyclingPooled), /Assessed on all runs together/);
assert.doesNotMatch(ui.detail(cyclingPooled), /Only confirmed space heating is assessed here/);

// Nothing witnessed at all: the firmware sends null, and the line falls back to the pooled pair
// unchanged. Rendering `space 0` here would claim a day of space heating nobody watched.
assert.equal(
  ui.metric({ id: "cycling", verdict: "ok", starts: 8, mean_run_s: 3600, split: false,
              space_runs: null, space_mean_run_s: null,
              dhw_runs: null, dhw_mean_run_s: null, cooling_runs: null, censored_runs: null }),
  "8 starts · 1 h/start",
);
assert.doesNotMatch(
  ui.detail({ id: "cycling", verdict: "ok", starts: 8, mean_run_s: 3600 }),
  /Only confirmed space heating is assessed here|Assessed on all runs together/,
  "neither sentence may appear where no class evidence was measured",
);

// Collecting, with class counts already real but no mean established yet.
assert.equal(
  ui.metric({ id: "cycling", verdict: "collecting", starts: 3, mean_run_s: null, split: false,
              space_runs: 2, space_mean_run_s: null, dhw_runs: 1, dhw_mean_run_s: null,
              censored_runs: 0, observed_s: 3600, required_s: 7200 }),
  "3 starts · space 2 · hot water 1",
);

const lossWithPump = { id: "dhw_loss", verdict: "info", max_k_h: 1.2, windows: 6,
                       high_windows: 2, high_with_pump: 2, high_pump_off: 0 };
assert.equal(ui.value(lossWithPump), "NOTE");
assert.equal(
  ui.metric(lossWithPump),
  "1.2 K/h · 6 windows · during circulation-pump operation",
  "high tank loss must expose its independent pump attribution",
);
assert.match(ui.detail(lossWithPump),
             /label="Value:">1\.2 K\/h · 6 windows · during circulation-pump operation<\/detail>/);
assert.match(ui.detail(lossWithPump), /label="Assessment:">NOTE —/);
ui.setLang("de");
const lossWhileOff = { id: "dhw_loss", verdict: "info", max_k_h: 1.0, windows: 4,
                       high_windows: 2, high_with_pump: 0, high_pump_off: 1 };
assert.equal(ui.value(lossWhileOff), "HINWEIS");
assert.equal(
  ui.metric(lossWhileOff),
  "1 K/h · 4 Fenster · auch bei ausgeschalteter Zirkulationspumpe",
  "off-pump evidence must not be mislabeled as a circulation-pump cause",
);
assert.match(ui.detail(lossWhileOff),
             /label="Messwert:">1 K\/h · 4 Fenster · auch bei ausgeschalteter Zirkulationspumpe<\/detail>/);
assert.match(ui.detail(lossWhileOff), /label="Bewertung:">HINWEIS —/);
ui.setLang("en");

// Unsupported means no observation, even if a legacy payload happens to carry a plausible zero.
// Count-only defrost without RPS is a supported `ok` path and remains separately visible.
assert.equal(ui.value({ id: "defrost", verdict: "unavailable", count: 0 }), "NOT AVAILABLE");
assert.equal(ui.value({ id: "defrost", verdict: "ok", count: 0, share_pct: null,
                        evidence: "observation" }), "MEASURED ONLY");
assert.equal(
  ui.metric({ id: "defrost", verdict: "ok", count: 3, paired_count: 2,
              defrost_s: 200, run_s: 1000, evidence: "heuristic" }),
  "3 cycles · 2 paired · 20 %",
);
const defrostWeather = { id: "defrost", verdict: "ok", count: 3, paired_count: 2,
  defrost_s: 200, run_s: 1000, evidence: "heuristic", outdoor_source: "x10a",
  outdoor_min_c: -7.0, outdoor_mean_c: -2.0, outdoor_samples: 300 };
assert.equal(ui.metric(defrostWeather),
  "3 cycles · 2 paired · 20 % · X10A min -7.0 °C · mean -2.0 °C");
assert.match(ui.detail(defrostWeather), /both defrost and compressor state were readable/);
assert.match(ui.detail(defrostWeather), /do not change the defrost threshold or verdict/);

context.S.status = { health: {
  covered_s: 86400, status: "unavailable", available: 1, assessable: 0, evaluated: 0,
  checks: [{ id: "defrost", verdict: "ok", count: 3, paired_count: null,
             share_pct: null, defrost_s: null, run_s: null, evidence: "observation" }],
} };
ui.setLang("en");
let countOnlyCard = ui.card();
assert.match(countOnlyCard, /<value>MEASURED ONLY<\/value>/);
assert.match(countOnlyCard, /label="Value:">3 cycles<\/detail>/);
assert.doesNotMatch(countOnlyCard, /paired/);
assert.match(countOnlyCard, />NOT AVAILABLE<\/span>/);
assert.doesNotMatch(countOnlyCard, /heuristic/);
assert.equal(
  ui.metric({ id: "defrost", verdict: "ok", count: 1, defrost_s: 1, run_s: 1000 }),
  "1 cycle · <1 %",
  "a positive sub-percent defrost share must not collapse into zero",
);
assert.equal(
  ui.metric({ id: "defrost", verdict: "info", count: 3, defrost_s: 151, run_s: 1000 }),
  "3 cycles · 15.1 %",
  "the raw ratio must remain visibly above the 15% heuristic boundary",
);
assert.equal(
  ui.metric({ id: "defrost", verdict: "info", count: 3, defrost_s: 12959, run_s: 86393 }),
  "3 cycles · 15.00005 %",
  "a small over-boundary ratio must remain visibly over its firmware-owned threshold",
);

// An unreadable current fault class is unknown, not a clear device state. Historical evidence also
// keeps that uncertainty visible rather than silently falling back to "None active".
assert.equal(
  ui.metric({ id: "fault", verdict: "collecting", active: null }),
  "Current state unknown",
);
assert.equal(
  ui.metric({ id: "fault", verdict: "info", active: null }),
  "Occurred in the last 24 h · current state unknown",
);

// NOTE on the fault row covers three different device states, and the assessment sentence is the
// only place that distinction is stated. A generic per-verdict sentence there ("a notable value or
// pattern") reads as a heuristic finding about a measurement, which this row never reports.
const faultWarningNow = ui.detail({ id: "fault", verdict: "info", active: 1 });
assert.match(faultWarningNow, /label="Value:">Warning active<\/detail>/);
assert.match(faultWarningNow, /NOTE — The unit is reporting a warning or caution right now, not an error/);
assert.match(faultWarningNow, /“Operation” card/, "an active class must point at the code");
const faultCleared = ui.detail({ id: "fault", verdict: "info", active: 0 });
assert.match(faultCleared, /NOTE — Nothing is being reported right now\./);
assert.match(faultCleared, /cleared on its own, which is why this row is not OK/);
assert.doesNotMatch(faultCleared, /“Operation” card/,
                    "a cleared message has no current code to look up");
assert.match(ui.detail({ id: "fault", verdict: "info", active: null }),
             /NOTE — A message appeared during the last 24 hours\./);
assert.match(ui.detail({ id: "fault", verdict: "warn", active: 1 }),
             /WARNING — The unit is reporting an error right now\./);
// Every other check keeps the shared per-verdict copy — this override is the fault row's alone.
assert.match(ui.detail({ id: "pressure", verdict: "info", min_bar: 0.9 }),
             /NOTE — Worth knowing about, but not proof of a defect\./);
for (const lang of ["en", "de"]) {
  ui.setLang(lang);
  for (const c of [{ id: "fault", verdict: "warn", active: 1 },
                   { id: "fault", verdict: "info", active: 1 },
                   { id: "fault", verdict: "info", active: 0 },
                   { id: "fault", verdict: "info", active: null }]) {
    assert.doesNotMatch(ui.detail(c), /check\.detail\./,
                        `fault copy must exist in ${lang}`);
  }
}
ui.setLang("en");

// Observed evidence is rounded down. A one-second shortfall must not overstate the collected time;
// the longer target remains available in the payload without bloating the collapsed row.
const almostRequired = {
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 77759, required_s: 77760,
};
assert.equal(ui.value(almostRequired), "CHECKING");
const almostRequiredDetail = ui.detail(almostRequired);
assert.match(almostRequiredDetail, /label="Value:">2 starts<\/detail>/);
assert.match(almostRequiredDetail, /21 h 35 min of 21 h 36 min captured/);

// Aggregate badges stay judgement-oriented: card status plus evaluated/assessable checks, without
// presenting reportable-value count or collection duration as a health score.
context.S.status = {
  health: {
    covered_s: 86400, status: "ok", available: 7, assessable: 4, evaluated: 4,
    checks: [{ id: "fault", verdict: "ok", active: 0, observed_s: 0, required_s: 0 }],
  },
};
ui.setLang("en");
let card = ui.card();
assert.match(card, /tone="checkup-val ok"/,
             "OK rows must carry both the wrapping class and visible OK tone");
assert.match(card, /Plant diagnostics · 24 h/);
assert.match(card, />OK · 4\/4 assessed<\/span>/);
assert.doesNotMatch(card, /7 values|24 h of/);
assert.doesNotMatch(card, /\bAll clear\b|\bhealthy\b/i);
ui.setLang("de");
card = ui.card();
assert.match(card, /Anlagendiagnose · 24 h/);
assert.match(card, />OK · 4\/4 bewertet<\/span>/);
assert.doesNotMatch(card, /7 Werte|von 24 h/);
assert.doesNotMatch(card, /Alles in Ordnung|\bgesund/i);

context.S.status.health = {
  covered_s: 7200, persist: "wrong_layout", status: "collecting", available: 5, assessable: 3, evaluated: 1,
  checks: [{
    id: "pressure", verdict: "collecting", min_bar: 1.7,
    observed_s: 120, required_s: 3600,
  }],
};
ui.setLang("en");
card = ui.card();
assert.match(card, />CHECKING · 1\/3 assessed<\/span>/);
assert.match(card, /<value>CHECKING<\/value>/);
assert.match(card, /label="Value:">1\.7 bar<\/detail>/);
assert.match(card, /label="Assessment:">CHECKING — 2 min of 1 h captured/);
ui.setLang("de");
card = ui.card();
assert.match(card, />PRÜFT · 1\/3 bewertet<\/span>/);
assert.match(card, /<value>PRÜFT<\/value>/);
assert.match(card, /label="Messwert:">1\.7 bar<\/detail>/);
assert.match(card, /label="Bewertung:">PRÜFT — 2 min von 1 h erfasst/);
assert.doesNotMatch(card, /So liest du diese Karte|Einfach erklärt|Datenfenster:/,
                    "the diagnostic card must not render the removed guide row");

// Regression payload matching the narrow German card that prompted the status-only design.
// Readings, assessment copy and collection clocks are present in details but absent from every
// collapsed value.
context.S.status.health = {
  covered_s: 1200, status: "info", available: 8, assessable: 5, evaluated: 2,
  checks: [
    { id: "fault", verdict: "ok", active: 0, evidence: "device" },
    { id: "dhw_loss", verdict: "info", max_k_h: 1.2, windows: 3,
      high_windows: 2, high_with_pump: 2, high_pump_off: 0, evidence: "heuristic" },
    { id: "cycling", verdict: "collecting", starts: 0, observed_s: 1200, required_s: 77760, evidence: "heuristic" },
    { id: "defrost", verdict: "collecting", count: 0, observed_s: 1200, required_s: 77760, evidence: "observation" },
    { id: "pressure", verdict: "collecting", min_bar: 1.7, observed_s: 1200, required_s: 77760, evidence: "manufacturer" },
    { id: "flow", verdict: "collecting", min_l_min: null, observed_s: 0, required_s: 60, evidence: "observation" },
    { id: "heater", verdict: "collecting", buh_s: 0, bsh_s: 0, observed_s: 1200, required_s: 77760, evidence: "observation" },
    { id: "retries", verdict: "collecting", seen: null, observed_s: 1200, required_s: 77760, evidence: "experimental" },
  ],
};
ui.setLang("de");
card = ui.card();
const collapsedValues = [...card.matchAll(/<value>(.*?)<\/value>/g)].map((m) => m[1]);
assert.deepEqual(collapsedValues,
                 ["OK", "HINWEIS", "PRÜFT", "PRÜFT", "PRÜFT", "PRÜFT", "PRÜFT", "PRÜFT"]);
for (const value of collapsedValues) {
  assert.doesNotMatch(value, /Aktuell|Start|Vorgang|bar|min|Speicher|gesammelt|erfasst/);
}
for (const reading of ["Aktuell keine", "1,2 K/h · 3 Fenster · während Zirkulationspumpenbetrieb",
                       "0 Starts", "0 Vorgänge", "1.7 bar", "0 min · Speicher 0 min"]) {
  assert.match(card, new RegExp(`label="Messwert:">${reading.replace(".", "\\.")}<\\/detail>`),
               `reading must move into the German hint box: ${reading}`);
}
assert.match(card, /HINWEIS · 2\/5 bewertet/);
assert.match(card, /20 min von 21 h 36 min erfasst/,
             "the removed collection clock must remain available in the explainer");

context.S.status.health = {
  covered_s: 23.5 * 3600, status: "collecting", available: 1, assessable: 1, evaluated: 0,
  checks: [{
    id: "pressure", verdict: "collecting", min_bar: 1.7,
    observed_s: 120, required_s: 3600, evidence: "manufacturer",
  }],
};
ui.setLang("en");
card = ui.card();
assert.match(card, />CHECKING · 0\/1 assessed<\/span>/);
assert.doesNotMatch(card, /23 h 30 min|1 values/);
assert.doesNotMatch(card, /manufacturer limit/);
ui.setLang("de");
card = ui.card();
assert.match(card, />PRÜFT · 0\/1 bewertet<\/span>/);
assert.doesNotMatch(card, /23 h 30 min|1 Werte/);
assert.doesNotMatch(card, /Herstellergrenze/);

// Evidence class refines OK: observation-only and experimental facts must not claim a completed
// judgement. Missing additive fields remain backwards-compatible and use the firmware verdict.
const evidenceChecks = [
  { id: "fault", verdict: "ok", active: 0, evidence: "device" },
  { id: "pressure", verdict: "ok", min_bar: 1.7, evidence: "manufacturer" },
  { id: "cycling", verdict: "ok", starts: 1, mean_run_s: 3600, evidence: "heuristic" },
  { id: "flow", verdict: "ok", min_l_min: 8.4, evidence: "observation" },
  { id: "retries", verdict: "ok", seen: 0, evidence: "experimental" },
];
context.S.status.health = { covered_s: 86400, status: "ok", checks: evidenceChecks };
ui.setLang("en");
card = ui.card();
for (const status of ["OK", "MEASURED ONLY", "EXPERIMENTAL"])
  assert.match(card, new RegExp(status));
assert.match(card, /<value>OK<\/value>.*label="Value:">1\.7 bar<\/detail>/,
             "manufacturer-bounded pressure can report OK after its evidence gate");
assert.match(card, /<value>MEASURED ONLY<\/value>.*label="Value:">8\.4 l\/min<\/detail>/,
             "flow has no universal threshold and must not report OK");
assert.match(card, /<value>EXPERIMENTAL<\/value>.*label="Value:">No increase seen<\/detail>/,
             "stable retry counters must not report OK");

context.S.status.health = {
  covered_s: 3600, status: "collecting",
  checks: [{ id: "cycling", verdict: "collecting", starts: 1, mean_run_s: null }],
};
card = ui.card();
assert.match(card, /CHECKING · 0\/1 assessed/);
assert.match(card, /<value>CHECKING<\/value>/);
assert.match(card, /label="Value:">1 start<\/detail>/);
assert.doesNotMatch(card, /undefined|check\.basis/);

// A future firmware may append checks this UI does not know. They are skipped without guessing a
// label/value, and a payload containing only unknown checks yields no empty card.
context.S.status.health = {
  covered_s: 60, status: "info", available: 2, evaluated: 1,
  checks: [
    { id: "future_check", verdict: "warn", opaque: "<must-not-render>" },
    { id: "fault", verdict: "info", active: 0, observed_s: 0, required_s: 0 },
  ],
};
ui.setLang("en");
card = ui.card();
assert.match(card, /<value>NOTE<\/value>/);
assert.match(card, /label="Value:">Occurred in the last 24 h · not active now<\/detail>/);
assert.doesNotMatch(card, /future_check|must-not-render/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn" }];
assert.equal(ui.card(), "", "unknown-only payload must not render an empty or guessed card");

// Load the complete production explainer fragments and expose their data tables. These are real
// module boundaries now; moving an unrelated comment can no longer change what this test executes.
const descriptionContext = {};
vm.runInNewContext(
  `${explanationSource}
   this.__copy = { descriptions: DESCRIPTIONS, model: MODEL_DESCRIPTIONS, inspect: INSPECT };`,
  descriptionContext,
  { filename: "main/www/app.sources" },
);

// Limit this wording check to Checkup keys and Checkup explainers. Other value explainers may
// legitimately use words such as "healthy"; this surface must not turn a bounded observation into
// a whole-plant claim.
const checkupI18n = Object.values(ui.copy).flatMap((language) =>
  Object.entries(language)
    .filter(([key]) => key === "card.checkup" || key.startsWith("check."))
    .map(([, value]) => String(value)));
const checkupDescriptions = Object.entries(descriptionContext.__copy.model)
  .filter(([key]) => key.startsWith("health_"))
  .map(([, value]) => JSON.stringify(value));
const checkupCopy = [...checkupI18n, ...checkupDescriptions].join("\n");
for (const [name, pattern] of [
  ["German all-clear claim", /Alles in Ordnung/i],
  ["English all-clear claim", /\bAll clear\b/i],
  ["German health claim", /\bgesund(?:e[rsnm]?|heit|heitszustand)?\b/i],
  ["English health claim", /\bhealthy\b|\bhealth status\b/i],
  ["English whole-plant claim", /\b(?:plant|unit|system) (?:is )?(?:fine|healthy)\b/i],
  ["German whole-plant claim", /\bAnlage (?:ist )?(?:gesund|in Ordnung)\b/i],
]) assert.doesNotMatch(checkupCopy, pattern, `checkup copy must not contain a ${name}`);

assert.ok(!("health_guide" in descriptionContext.__copy.model),
          "the removed guide row must have no explainer copy");
assert.doesNotMatch(explanationSource, /action\.label|b\.action/,
                    "the shared explainer must not render recommendation copy");

// The concise explainer must retain the production retry comparator's important edge cases.
const retryCopy = JSON.stringify(descriptionContext.__copy.model.health_retries);
assert.match(retryCopy, /while stopped or at a compressor-state boundary/);
assert.match(retryCopy, /im Stillstand oder an einer Verdichter-Zustandsgrenze/);
assert.match(retryCopy, /stable or decreasing values, gaps and resets do not/);
assert.match(retryCopy, /stabile oder abnehmende Werte, Lücken und Rücksetzungen zählen nicht/);
assert.doesNotMatch(retryCopy, /with the compressor running|bei laufendem Verdichter/);

const pressureCopy = JSON.stringify(descriptionContext.__copy.model.health_pressure);
assert.match(pressureCopy, /NOTE immediately and a WARNING after 60 continuous seconds/);
assert.match(pressureCopy, /sofort HINWEIS und nach 60 durchgehenden Sekunden WARNUNG/);

const dhwCopy = JSON.stringify(descriptionContext.__copy.model.health_dhw_loss);
assert.match(dhwCopy, /0\.8 K\/h, a project heuristic for one reference installation/);
assert.match(dhwCopy, /Tank volume and the tank-to-room temperature difference change the rate/);
assert.match(dhwCopy, /0,8 K\/h – Heuristik der Referenzanlage/);
assert.match(dhwCopy, /Speichervolumen und Abstand zur Raumtemperatur ändern den Wert/);
assert.match(dhwCopy, /only up to about 1\.85 K\/h/);
assert.match(dhwCopy, /nur bis etwa 1,85 K\/h/);
assert.match(dhwCopy, /OK means none was observed in that band/);
assert.match(dhwCopy, /OK heißt nur: Kein Verlust im erkennbaren Band/);

const flowCopy = JSON.stringify(descriptionContext.__copy.model.health_flow);
assert.match(flowCopy, /observed part-load minimum.*not the nominal or design flow/);
assert.match(flowCopy, /beobachtetes Teillast-Minimum.*nicht der Nenn- oder Auslegungsdurchfluss/);
assert.match(flowCopy, /same model, mode and conditions/);
assert.match(flowCopy, /dasselbe Modell, dieselbe Betriebsart und dieselben Bedingungen/);

// The hint box should explain the observation without becoming a manual or recommending an action.
// Keep both paragraphs concise while the source-level assertions preserve the load-bearing caveats.
for (const id of ["fault", "dhw_loss", "cycling", "defrost", "pressure", "flow", "heater", "retries"]) {
  const d = descriptionContext.__copy.model[`health_${id}`];
  for (const [lang, copy] of [["en", d], ["de", d.de]]) {
    const length = `${copy.what} ${copy.normal || ""}`.length;
    assert.ok(length <= 520, `${id} ${lang} explainer is too long (${length} characters)`);
    assert.ok(!("action" in copy), `${id} ${lang} must not recommend a next step`);
  }
}

// Technical binary states stay ON/OFF in German explainers instead of switching between translated
// prose forms. The defrost copy may name the same rising edge as an "Abtaustart" without spelling
// out the states. Named manufacturer enums such as Smart Grid "Empfehlung ein" remain outside this
// binary-state contract.
const cyclingCopy = JSON.stringify(descriptionContext.__copy.model.health_cycling);
const defrostCopy = JSON.stringify(descriptionContext.__copy.model.health_defrost);
assert.match(cyclingCopy, /von OFF zu ON/);
assert.match(defrostCopy, /Abtaustarts/);
const explanationCopy = JSON.stringify(descriptionContext.__copy);
for (const [name, pattern] of [
  ["Aus-zu-Ein transition", /von Aus zu Ein/i],
  ["translated switched-off state", /\bausgeschaltet(?:e[rmns]?)?\b/i],
  ["translated switched-on state", /\beingeschaltet(?:e[rmns]?)?\b/i],
  ["translated compressor state", /\bVerdichter ist aus\b/i],
  ["translated backup-heater state", /\bZusatzheizer (?:ist )?aus\b/i],
]) assert.doesNotMatch(explanationCopy, pattern, `${name} must use ON/OFF`);

console.log("plant-diagnostics UI contract: evidence-bounded rendering verified");
