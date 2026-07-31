// Contract test for the X10A operating-observation card. Executes the production checkup renderer
// from main/www/app.js in a DOM-free VM so wording and null/evidence handling cannot drift into a
// whole-plant health claim while the C++ report remains technically conservative.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app = fs.readFileSync(new URL("../main/www/app.js", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const statusSource = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");
const checkupSource = fs.readFileSync(new URL("../main/checkup.cpp", import.meta.url), "utf8");
const pollSource = fs.readFileSync(new URL("../main/hp_poll.cpp", import.meta.url), "utf8");
const configSource = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");

function span(start, end) {
  const from = app.indexOf(start);
  assert.notEqual(from, -1, `missing production source marker: ${start}`);
  const to = app.indexOf(end, from);
  assert.notEqual(to, -1, `missing production source marker: ${end}`);
  return app.slice(from, to);
}

// Limit the language assertion to this card. Other, unrelated value explainers may legitimately use
// words such as "healthy"; this surface must not turn a bounded X10A observation into that claim.
const checkupCopy = [
  span("const I18N = {", "function t("),
  span("  health_fault: {", "  // The two board-memory rows"),
].join("\n");
for (const [name, pattern] of [
  ["German all-clear claim", /Alles in Ordnung/i],
  ["English all-clear claim", /\bAll clear\b/i],
  ["German health claim", /\bgesund(?:e[rsnm]?|heit|heitszustand)?\b/i],
  ["English health claim", /\bhealthy\b|\bhealth status\b/i],
  ["English whole-plant claim", /\b(?:plant|unit|system) (?:is )?(?:fine|healthy)\b/i],
  ["German whole-plant claim", /\bAnlage (?:ist )?(?:gesund|in Ordnung)\b/i],
]) {
  assert.doesNotMatch(checkupCopy, pattern, `checkup copy must not contain a ${name}`);
}

// Pin the existing /status.health surface plus its additive evidence fields at the actual serializer.
// The UI payloads below are synthetic by design; without this half, a C++ key drift could leave every
// renderer test green while the board sends a different contract.
const normalizedStatusSource = statusSource.replaceAll("\\\"", "\"");
for (const key of [
  "health", "covered_s", "status", "checks",
  "full_span", "available", "assessable", "evaluated", "evidence", "observed_s", "required_s",
  "starts", "mean_run_s", "count", "paired_count", "share_pct", "defrost_s", "run_s",
  "min_bar", "min_l_min", "buh_min", "bsh_min", "buh_s", "bsh_s", "active", "seen",
]) {
  assert.match(normalizedStatusSource, new RegExp(`"${key}"`),
               `missing /status.health key ${key}`);
}
assert.match(statusSource, /if \(v < 0\) \{ j \+= "null"; return; \}/,
             "unestablished check numbers must serialize as null");
assert.match(style, /\.vrow-val\.checkup-val\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*right;/s,
             "long checkup evidence must wrap inside narrow cards");
assert.match(checkupSource, /if \(apply_reset_locked\(\)\) return;/,
             "record must discard the sample that consumes an identity reset");
assert.match(checkupSource, /if \(s_reset_requested\.load\(\)\) return logic::CheckupReport\{\};/,
             "report must stay empty without consuming a pending identity reset");
assert.ok(pollSource.indexOf("checkup_reset();") < pollSource.indexOf("config_set_model("),
          "automatic detection must request reset before publishing the resolved profile");
assert.match(configSource, /set_hp_resets_checkup\([^;]+;\s*[\s\S]*?if \(reset_checkup\) \{\s*checkup_reset\(\);/m,
             "/set_hp must route the pure identity predicate into the reset request");
assert.match(configSource, /static esp_err_t do_detect[\s\S]*?checkup_reset\(\);\s*hp_poll_reconfigure\(\);/m,
             "explicit /detect must reset the observation before reconfiguring the poll task");

const context = {
  S: { status: null },
  // Keep the renderer's semantic inputs visible in a compact deterministic string; no DOM is needed.
  modelDescRow: (id, label, value, opt = {}) =>
    `<row id="${id}" tone="${opt.cls || ""}" label="${label}">${value}</row>`,
  vcard: (title, rows, badge, cls = "") =>
    `<card title="${title}" tone="${cls}" badge="${badge}">${rows}</card>`,
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${span("const I18N = {", "function t(")}
   let __lang = "en";
   function __t(k, ...a) {
     const v = (I18N[__lang] && I18N[__lang][k] != null) ? I18N[__lang][k] : I18N.en[k];
     if (v == null) return k;
     return typeof v === "function" ? v(...a) : v;
   }
   const t = __t;
   ${span("const CHECKUP_ROW = {", "// ── Connections tile")}
   this.__checkup = {
     value: checkupValue,
     card: checkupCardHtml,
     text: (lang, key, ...args) => { __lang = lang; return __t(key, ...args); },
     setLang: (lang) => { __lang = lang; },
   };`,
  sandbox,
  { filename: "main/www/app.js" },
);
const ui = sandbox.__checkup;

// The headline and every possible aggregate badge name the evidence boundary in both languages.
assert.match(ui.text("en", "card.checkup"), /X10A.*observ/i);
assert.match(ui.text("de", "card.checkup"), /X10A.*Betriebsbeobachtung/i);
assert.equal(ui.text("en", "check.all_ok"), "No finding in observed X10A data");
assert.equal(ui.text("de", "check.all_ok"), "Keine Auffälligkeit in beobachteten X10A-Daten");
assert.equal(ui.text("en", "check.attention"), "Fault / documented limit");
assert.equal(ui.text("de", "check.attention"), "Störung / dokumentierte Grenze");
assert.equal(ui.text("en", "check.notice"), "Operating note");
assert.equal(ui.text("de", "check.notice"), "Betriebshinweis");

// BUH and BSH are independent channels. An unsupported/unreadable side is null, not a plausible zero,
// while a real observed zero remains visible.
ui.setLang("en");
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_min: 7, bsh_min: null }),
  "7 min",
  "a missing BSH channel must not be rendered as zero minutes",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }),
  "tank 9 min",
  "a missing BUH channel must not suppress an observed BSH value",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_min: 0, bsh_min: 0 }),
  "0 min · tank 0 min",
  "observed zeroes are facts and must not be mistaken for missing channels",
);
ui.setLang("de");
assert.equal(ui.value({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }), "Speicher 9 min");
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_s: 1, bsh_s: 59 }),
  "<1 min · Speicher <1 min",
  "positive sub-minute heater runtime must not collapse into a factual zero",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_s: 0, bsh_s: 60 }),
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
  const value = ui.value({ observed_s: 0, required_s: 3600, ...payload });
  const primaryValue = value.split(" · ", 1)[0];
  assert.match(primaryValue, /collecting…/);
  assert.doesNotMatch(primaryValue, /\b0 (?:starts|cycles|min)\b/,
                      "unreadable supported data must not render as an observed zero");
}

// Collecting copy uses the row's own observed/required clocks. Two rows with the same card-level
// coverage deliberately render different evidence, proving global covered_s is not borrowed.
ui.setLang("en");
const cyclingCollecting = ui.value({
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 3600, required_s: 7200,
});
const pressureCollecting = ui.value({
  id: "pressure", verdict: "collecting", min_bar: 1.7,
  observed_s: 120, required_s: 3600,
});
assert.match(cyclingCollecting, /2 starts/);
assert.match(cyclingCollecting, /1 h \/ 2 h observed/);
assert.match(pressureCollecting, /1\.7 bar/);
assert.match(pressureCollecting, /2 min \/ 1 h observed/);
assert.notEqual(cyclingCollecting, pressureCollecting);

ui.setLang("en");
assert.equal(
  ui.value({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 599 }),
  "12 starts · 9 min runtime/start",
  "a mean below the ten-minute heuristic must not round up to the boundary",
);
assert.equal(
  ui.value({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 1 }),
  "12 starts · <1 min runtime/start",
  "positive runtime must not render as zero",
);

// Unsupported means no observation, even if a legacy payload happens to carry a plausible zero.
// Count-only defrost without RPS is a supported `ok` path and remains separately visible.
assert.equal(ui.value({ id: "defrost", verdict: "unavailable", count: 0 }), "—");
assert.equal(ui.value({ id: "defrost", verdict: "ok", count: 0, share_pct: null,
                        evidence: "observation" }), "0 cycles");
assert.equal(
  ui.value({ id: "defrost", verdict: "ok", count: 3, paired_count: 2,
             defrost_s: 200, run_s: 1000, evidence: "heuristic" }),
  "3 cycles · 2 with compressor evidence · 20 %",
);

context.S.status = { health: {
  covered_s: 86400, status: "unavailable", available: 1, assessable: 0, evaluated: 0,
  checks: [{ id: "defrost", verdict: "ok", count: 3, paired_count: null,
             share_pct: null, defrost_s: null, run_s: null, evidence: "observation" }],
} };
ui.setLang("en");
let countOnlyCard = ui.card();
assert.match(countOnlyCard, /3 cycles · observation/);
assert.doesNotMatch(countOnlyCard, /with compressor evidence/);
assert.match(countOnlyCard, /No assessable check available · 0\/0 assessed · 1 supported/);
assert.doesNotMatch(countOnlyCard, /heuristic/);
assert.equal(
  ui.value({ id: "defrost", verdict: "ok", count: 1, defrost_s: 1, run_s: 1000 }),
  "1 cycle · <1 %",
  "a positive sub-percent defrost share must not collapse into zero",
);
assert.equal(
  ui.value({ id: "defrost", verdict: "info", count: 3, defrost_s: 151, run_s: 1000 }),
  "3 cycles · 15.1 %",
  "the raw ratio must remain visibly above the 15% heuristic boundary",
);
assert.equal(
  ui.value({ id: "defrost", verdict: "info", count: 3, defrost_s: 12959, run_s: 86393 }),
  "3 cycles · 15.00005 %",
  "a small over-boundary ratio must remain visibly over its firmware-owned threshold",
);

// An unreadable current fault class is unknown, not a clear device state. Historical evidence also
// keeps that uncertainty visible rather than silently falling back to "None active".
assert.equal(
  ui.value({ id: "fault", verdict: "collecting", active: null }),
  "Current state unknown",
);
assert.equal(
  ui.value({ id: "fault", verdict: "info", active: null }),
  "Seen in window · current state unknown",
);

// Observed evidence is rounded down and required evidence up. A one-second shortfall must never
// render as equality, and a 23.5-hour RAM window must never say "24 h of 24 h".
const almostRequired = ui.value({
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 77759, required_s: 77760,
});
assert.match(almostRequired, /21 h 35 min \/ 21 h 36 min observed/);

// Aggregate badges remain bounded by observed data and state evaluated/assessable/supported counts
// plus the real window. Findings do not hide incomplete rows; both languages carry the same contract.
context.S.status = {
  health: {
    covered_s: 86400, status: "ok", available: 7, assessable: 4, evaluated: 4,
    checks: [{ id: "fault", verdict: "ok", active: 0, observed_s: 0, required_s: 0 }],
  },
};
ui.setLang("en");
let card = ui.card();
assert.match(card, /tone="checkup-val"/,
             "checkup rows must carry the narrow-card wrapping class");
assert.match(card, /X10A observation · up to 24 h/);
assert.match(card, /No finding in observed X10A data · 4\/4 assessed · 7 supported · 24 h of 24 h/);
assert.doesNotMatch(card, /\bAll clear\b|\bhealthy\b/i);
ui.setLang("de");
card = ui.card();
assert.match(card, /X10A-Betriebsbeobachtung · bis 24 h/);
assert.match(card, /Keine Auffälligkeit in beobachteten X10A-Daten · 4\/4 bewertet · 7 unterstützt · 24 h von 24 h/);
assert.doesNotMatch(card, /Alles in Ordnung|\bgesund/i);

context.S.status.health = {
  covered_s: 7200, status: "collecting", available: 5, assessable: 3, evaluated: 1,
  checks: [{
    id: "pressure", verdict: "collecting", min_bar: 1.7,
    observed_s: 120, required_s: 3600,
  }],
};
ui.setLang("en");
card = ui.card();
assert.match(card, /Collecting · 1\/3 assessed · 5 supported · 2 h of 24 h/);
assert.match(card, /2 min \/ 1 h observed/);
ui.setLang("de");
card = ui.card();
assert.match(card, /Sammelt · 1\/3 bewertet · 5 unterstützt · 2 h von 24 h/);
assert.match(card, /2 min \/ 1 h beobachtet/);

context.S.status.health = {
  covered_s: 23.5 * 3600, status: "collecting", available: 1, assessable: 1, evaluated: 0,
  checks: [{
    id: "pressure", verdict: "collecting", min_bar: 1.7,
    observed_s: 120, required_s: 3600, evidence: "manufacturer",
  }],
};
ui.setLang("en");
card = ui.card();
assert.match(card, /23 h 30 min of 24 h/);
assert.doesNotMatch(card, /24 h of 24 h/);
assert.match(card, /manufacturer limit/);
ui.setLang("de");
card = ui.card();
assert.match(card, /23 h 30 min von 24 h/);
assert.match(card, /Herstellergrenze/);

// Every API evidence class is visibly distinguished. Missing/unknown additive fields remain
// backwards-compatible: older payloads render without guessing a class or dropping the card.
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
for (const basis of ["device state", "manufacturer limit", "heuristic", "observation", "experimental"])
  assert.match(card, new RegExp(basis));

context.S.status.health = {
  covered_s: 3600, status: "collecting",
  checks: [{ id: "cycling", verdict: "collecting", starts: 1, mean_run_s: null }],
};
card = ui.card();
assert.match(card, /0\/1 assessed · 1 supported/);
assert.match(card, /1 start/);
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
assert.match(card, /Seen in window/);
assert.doesNotMatch(card, /future_check|must-not-render/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn" }];
assert.equal(ui.card(), "", "unknown-only payload must not render an empty or guessed card");

// The explainer must match the production retry comparator: a counter update may first become
// visible while stopped or at a compressor-state boundary; decreases/resets prove neither side.
const retryCopy = span("  health_retries: {", "  // The two board-memory rows");
assert.match(retryCopy, /while stopped or at a compressor-state boundary/);
assert.match(retryCopy, /neither events nor no-event evidence/);
assert.match(retryCopy, /im Stillstand oder an einer Verdichter-Zustandsgrenze/);
assert.match(retryCopy, /weder Ereignisse noch Gegenbelege/);
assert.doesNotMatch(retryCopy, /with the compressor running|bei laufendem Verdichter/);

const pressureCopy = span("  health_pressure: {", "  health_flow: {");
assert.match(pressureCopy, /shown immediately as an operating note/);
assert.match(pressureCopy, /warning only after 60 continuous seconds/);
assert.match(pressureCopy, /sofort als Betriebshinweis/);
assert.match(pressureCopy, /erst nach 60 ununterbrochenen Sekunden zur Warnung/);

console.log("X10A checkup UI contract: evidence-bounded rendering verified");
