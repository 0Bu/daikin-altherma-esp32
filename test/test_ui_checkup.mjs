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
             "checkup readings and verdicts must wrap inside narrow cards");
assert.match(style, /\.vrow-val\.dim\s*\{[^}]*color:\s*var\(--muted\)/s,
             "CHECKING/observation-only rows need a distinct neutral visual state");
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
  descNoteHtml: (lead, text) => `<detail label="${lead}">${text}</detail>`,
  // Keep the renderer's semantic inputs visible in a compact deterministic string; no DOM is needed.
  modelDescRow: (id, label, value, opt = {}) =>
    `<row id="${id}" tone="${opt.cls || ""}" label="${label}"><value>${value}</value>${opt.bodyPrefix || ""}</row>`,
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
     metric: checkupMetricValue,
     status: checkupStatusText,
     detail: checkupDetailHtml,
     card: checkupCardHtml,
     text: (lang, key, ...args) => { __lang = lang; return __t(key, ...args); },
     setLang: (lang) => { __lang = lang; },
   };`,
  sandbox,
  { filename: "main/www/app.js" },
);
const ui = sandbox.__checkup;

// The title keeps the bounded 24-hour scope without consuming most of a narrow card's first line.
assert.equal(ui.text("en", "card.checkup"), "X10A check · 24 h");
assert.equal(ui.text("de", "card.checkup"), "X10A-Check · 24 h");
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
  ui.value({ id: "heater", verdict: "ok", buh_min: 7, bsh_min: null }),
  "7 min · OK",
  "a missing BSH channel must not be rendered as zero minutes",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }),
  "tank 9 min · OK",
  "a missing BUH channel must not suppress an observed BSH value",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_min: 0, bsh_min: 0 }),
  "0 min · tank 0 min · OK",
  "observed zeroes are facts and must not be mistaken for missing channels",
);
ui.setLang("de");
assert.equal(ui.value({ id: "heater", verdict: "ok", buh_min: null, bsh_min: 9 }), "Speicher 9 min · OK");
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_s: 1, bsh_s: 59 }),
  "<1 min · Speicher <1 min · OK",
  "positive sub-minute heater runtime must not collapse into a factual zero",
);
assert.equal(
  ui.value({ id: "heater", verdict: "ok", buh_s: 0, bsh_s: 60 }),
  "0 min · Speicher 1 min · OK",
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
  assert.equal(value, "CHECKING");
  assert.doesNotMatch(value, /\b0 (?:starts|cycles)\b/,
                      "unreadable supported data must not render as an observed zero");
}

// The collapsed row carries only its reading and verdict. Its own observed/required clocks move to
// the explainer, proving that card-level coverage is not borrowed and first-glance text stays short.
ui.setLang("en");
const cyclingCollecting = ui.value({
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 3600, required_s: 7200,
});
const pressureCollecting = ui.value({
  id: "pressure", verdict: "collecting", min_bar: 1.7,
  observed_s: 120, required_s: 3600,
});
assert.equal(cyclingCollecting, "2 starts · CHECKING");
assert.equal(pressureCollecting, "1.7 bar · CHECKING");
assert.match(ui.detail({ verdict: "collecting", observed_s: 3600, required_s: 7200 }),
             /CHECKING — 1 h of 2 h captured/);
assert.match(ui.detail({ verdict: "collecting", observed_s: 120, required_s: 3600 }),
             /CHECKING — 2 min of 1 h captured/);
assert.notEqual(cyclingCollecting, pressureCollecting);

ui.setLang("en");
assert.equal(
  ui.value({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 599 }),
  "12 starts · 9 min/start · NOTE",
  "a mean below the ten-minute heuristic must not round up to the boundary",
);
assert.equal(
  ui.value({ id: "cycling", verdict: "info", starts: 12, mean_run_s: 1 }),
  "12 starts · <1 min/start · NOTE",
  "positive runtime must not render as zero",
);

// Unsupported means no observation, even if a legacy payload happens to carry a plausible zero.
// Count-only defrost without RPS is a supported `ok` path and remains separately visible.
assert.equal(ui.value({ id: "defrost", verdict: "unavailable", count: 0 }), "NOT AVAILABLE");
assert.equal(ui.value({ id: "defrost", verdict: "ok", count: 0, share_pct: null,
                        evidence: "observation" }), "0 cycles · MEASURED ONLY");
assert.equal(
  ui.value({ id: "defrost", verdict: "ok", count: 3, paired_count: 2,
             defrost_s: 200, run_s: 1000, evidence: "heuristic" }),
  "3 cycles · 2 paired · 20 % · OK",
);

context.S.status = { health: {
  covered_s: 86400, status: "unavailable", available: 1, assessable: 0, evaluated: 0,
  checks: [{ id: "defrost", verdict: "ok", count: 3, paired_count: null,
             share_pct: null, defrost_s: null, run_s: null, evidence: "observation" }],
} };
ui.setLang("en");
let countOnlyCard = ui.card();
assert.match(countOnlyCard, /3 cycles · MEASURED ONLY/);
assert.doesNotMatch(countOnlyCard, /paired/);
assert.match(countOnlyCard, /badge="NOT AVAILABLE"/);
assert.doesNotMatch(countOnlyCard, /heuristic/);
assert.equal(
  ui.value({ id: "defrost", verdict: "ok", count: 1, defrost_s: 1, run_s: 1000 }),
  "1 cycle · <1 % · OK",
  "a positive sub-percent defrost share must not collapse into zero",
);
assert.equal(
  ui.value({ id: "defrost", verdict: "info", count: 3, defrost_s: 151, run_s: 1000 }),
  "3 cycles · 15.1 % · NOTE",
  "the raw ratio must remain visibly above the 15% heuristic boundary",
);
assert.equal(
  ui.value({ id: "defrost", verdict: "info", count: 3, defrost_s: 12959, run_s: 86393 }),
  "3 cycles · 15.00005 % · NOTE",
  "a small over-boundary ratio must remain visibly over its firmware-owned threshold",
);

// An unreadable current fault class is unknown, not a clear device state. Historical evidence also
// keeps that uncertainty visible rather than silently falling back to "None active".
assert.equal(
  ui.value({ id: "fault", verdict: "collecting", active: null }),
  "Current state unknown · CHECKING",
);
assert.equal(
  ui.value({ id: "fault", verdict: "info", active: null }),
  "Seen in window · current state unknown · NOTE",
);

// Observed evidence is rounded down. A one-second shortfall must not overstate the collected time;
// the longer target remains available in the payload without bloating the collapsed row.
const almostRequired = ui.value({
  id: "cycling", verdict: "collecting", starts: 2, mean_run_s: null,
  observed_s: 77759, required_s: 77760,
});
assert.equal(almostRequired, "2 starts · CHECKING");
const almostRequiredDetail = ui.detail({ verdict: "collecting", observed_s: 77759, required_s: 77760 });
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
assert.match(card, /X10A check · 24 h/);
assert.match(card, /badge="OK · 4\/4 assessed"/);
assert.doesNotMatch(card, /7 values|24 h of/);
assert.doesNotMatch(card, /\bAll clear\b|\bhealthy\b/i);
ui.setLang("de");
card = ui.card();
assert.match(card, /X10A-Check · 24 h/);
assert.match(card, /badge="OK · 4\/4 bewertet"/);
assert.doesNotMatch(card, /7 Werte|von 24 h/);
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
assert.match(card, /badge="CHECKING · 1\/3 assessed"/);
assert.match(card, /<value>1\.7 bar · CHECKING<\/value>/);
assert.match(card, /CHECKING — 2 min of 1 h captured/);
ui.setLang("de");
card = ui.card();
assert.match(card, /badge="PRÜFT · 1\/3 bewertet"/);
assert.match(card, /<value>1\.7 bar · PRÜFT<\/value>/);
assert.match(card, /PRÜFT — 2 min von 1 h erfasst/);

// Regression payload matching the narrow German card that prompted the status-first design.
// Collection clocks are present in the details but absent from every collapsed value.
context.S.status.health = {
  covered_s: 1200, status: "collecting", available: 7, assessable: 3, evaluated: 1,
  checks: [
    { id: "fault", verdict: "ok", active: 0, evidence: "device" },
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
for (const value of [
  "Aktuell keine · OK",
  "0 Starts · PRÜFT",
  "0 Vorgänge · PRÜFT",
  "1.7 bar · PRÜFT",
  "0 min · Speicher 0 min · PRÜFT",
  "PRÜFT · 1/3 bewertet",
]) assert.ok(card.includes(value), `missing concise German card status: ${value}`);
const collapsedValues = [...card.matchAll(/<value>(.*?)<\/value>/g)].map((m) => m[1]);
assert.ok(collapsedValues.length >= 7);
for (const value of collapsedValues) assert.doesNotMatch(value, /20 min|21 h|gesammelt|erfasst/);
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
assert.match(card, /badge="CHECKING · 0\/1 assessed"/);
assert.doesNotMatch(card, /23 h 30 min|1 values/);
assert.doesNotMatch(card, /manufacturer limit/);
ui.setLang("de");
card = ui.card();
assert.match(card, /badge="PRÜFT · 0\/1 bewertet"/);
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
assert.match(card, /<value>1\.7 bar · OK<\/value>/,
             "manufacturer-bounded pressure can report OK after its evidence gate");
assert.match(card, /<value>8\.4 l\/min · MEASURED ONLY<\/value>/,
             "flow has no universal threshold and must not report OK");
assert.match(card, /<value>No increase seen · EXPERIMENTAL<\/value>/,
             "stable retry counters must not report OK");

context.S.status.health = {
  covered_s: 3600, status: "collecting",
  checks: [{ id: "cycling", verdict: "collecting", starts: 1, mean_run_s: null }],
};
card = ui.card();
assert.match(card, /CHECKING · 0\/1 assessed/);
assert.match(card, /1 start · CHECKING/);
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
assert.match(card, /Seen in window · NOTE/);
assert.doesNotMatch(card, /future_check|must-not-render/);
context.S.status.health.checks = [{ id: "future_check", verdict: "warn" }];
assert.equal(ui.card(), "", "unknown-only payload must not render an empty or guessed card");

// The concise explainer must retain the production retry comparator's important edge cases.
const retryCopy = span("  health_retries: {", "  // The two board-memory rows");
assert.match(retryCopy, /while stopped or at a compressor-state boundary/);
assert.match(retryCopy, /im Stillstand oder an einer Verdichter-Zustandsgrenze/);
assert.match(retryCopy, /stable or decreasing values, gaps and resets do not/);
assert.match(retryCopy, /stabile oder abnehmende Werte, Lücken und Rücksetzungen nicht/);
assert.doesNotMatch(retryCopy, /with the compressor running|bei laufendem Verdichter/);

const pressureCopy = span("  health_pressure: {", "  health_flow: {");
assert.match(pressureCopy, /NOTE immediately and a WARNING after 60 continuous seconds/);
assert.match(pressureCopy, /sofort HINWEIS und nach 60 durchgehenden Sekunden WARNUNG/);

// The hint box should answer the question without becoming a manual. Keep both paragraphs concise
// while the source-level assertions above preserve the technically load-bearing caveats.
const descriptionContext = {};
vm.runInNewContext(
  `${span("const MODEL_DESCRIPTIONS = {", "// A Model-card row")} this.__descriptions = MODEL_DESCRIPTIONS;`,
  descriptionContext,
);
for (const id of ["fault", "cycling", "defrost", "pressure", "flow", "heater", "retries"]) {
  const d = descriptionContext.__descriptions[`health_${id}`];
  for (const [lang, copy] of [["en", d], ["de", d.de]]) {
    const length = `${copy.what} ${copy.normal || ""}`.length;
    assert.ok(length <= 520, `${id} ${lang} explainer is too long (${length} characters)`);
  }
}

// Technical binary states stay ON/OFF in German explainers instead of switching between translated
// prose forms. Ordinary grammatical uses of "ein"/"aus" are intentionally outside this contract.
const cyclingCopy = span("  health_cycling: {", "  health_defrost: {");
const defrostCopy = span("  health_defrost: {", "  health_pressure: {");
assert.match(cyclingCopy, /von OFF zu ON/);
assert.match(defrostCopy, /von OFF zu ON/);
const explanationCopy = [
  span("const DESCRIPTIONS = [", "// ── The two sources"),
  span("const MODEL_DESCRIPTIONS = {", "// A Model-card row"),
  span("const INSPECT = {", "// A row selector"),
].join("\n");
for (const [name, pattern] of [
  ["Aus-zu-Ein transition", /von Aus zu Ein/i],
  ["translated switched-off state", /\bausgeschaltet(?:e[rmns]?)?\b/i],
  ["translated switched-on state", /\beingeschaltet(?:e[rmns]?)?\b/i],
  ["translated Smart-Grid state", /\b(?:Erzwungen|Empfohlen) (?:aus|ein)\b/i],
  ["translated compressor state", /\bVerdichter ist aus\b/i],
  ["translated backup-heater state", /\bZusatzheizer (?:ist )?aus\b/i],
]) assert.doesNotMatch(explanationCopy, pattern, `${name} must use ON/OFF`);

console.log("X10A checkup UI contract: evidence-bounded rendering verified");
