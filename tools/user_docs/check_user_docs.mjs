// Plain-language contract for the plant-diagnostics card, docs/DIAGNOSTICS.md and the per-check
// evidence ledger in docs/DIAGNOSTIC_EVIDENCE.md.
//
// A description-coverage audit can prove that a row is tappable and still allow an explanation
// written only for an installer, with no supported next step. This gate asks the user-level question:
// can a non-specialist understand what was observed, the limit of the claim and what to do next?
//
// The prose itself still needs human judgement. The source fingerprint closes the maintenance gap:
// any change to the evaluator or the visible diagnosis contract makes the guide stale until the
// /user-docs-review skill has reviewed the change and deliberately refreshed the stamp.
//
// Usage: node tools/user_docs/check_user_docs.mjs [--root DIR] [--app FILE] [--doc FILE]
//        [--evidence FILE] [--update]
// Exit: 0 clean/updated, 1 findings, 2 usage/parse/vacuity error.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { readAppSource } from "../ui/read_app_source.mjs";
import { auditEvidenceContract } from "../diagnostic_evidence/evidence_contract.mjs";

let root = process.cwd();
let appArg = "main/www/app.sources";
let docArg = "docs/DIAGNOSTICS.md";
let evidenceArg = "docs/DIAGNOSTIC_EVIDENCE.md";
let update = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--root") root = process.argv[++i];
  else if (arg === "--app") appArg = process.argv[++i];
  else if (arg === "--doc") docArg = process.argv[++i];
  else if (arg === "--evidence") evidenceArg = process.argv[++i];
  else if (arg === "--update") update = true;
  else die(2, `unknown argument: ${arg}`);
  if (root === undefined || appArg === undefined || docArg === undefined || evidenceArg === undefined) {
    die(2, "missing option value");
  }
}
root = path.resolve(root);
const app = path.resolve(root, appArg);
const docFile = path.resolve(root, docArg);
const evidenceFile = path.resolve(root, evidenceArg);

function die(code, message) {
  console.error(`user-docs-audit: ${message}`);
  process.exit(code);
}

function read(file, label = file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { die(2, `cannot read ${label}: ${error.message}`); }
}

function loadObject(source, open, label) {
  const count = source.split(open).length - 1;
  if (count !== 1) die(2, `'${open}' must appear exactly once in ${appArg} (found ${count})`);
  const start = source.indexOf(open) + open.length - 1;
  // Both production tables deliberately end with a top-level `};` on its own line. This is the
  // same fail-closed boundary used by the description audit; trying to count braces would need a
  // second JavaScript parser to survive regex literals, templates and comments correctly.
  const close = source.indexOf("\n};", start);
  if (close < 0) die(2, `${label} has no top-level closing brace in ${appArg}`);
  try { return vm.runInNewContext(`(${source.slice(start, close + 2)})`, Object.create(null), { timeout: 5000 }); }
  catch (error) { die(2, `${label} does not evaluate: ${error.message}`); }
}

let source;
try { source = readAppSource(app); }
catch (error) { die(2, `cannot assemble ${appArg}: ${error.message}`); }
const model = loadObject(source, "const MODEL_DESCRIPTIONS = {", "MODEL_DESCRIPTIONS");
const rowMap = loadObject(source, "const CHECKUP_ROW = {", "CHECKUP_ROW");
if (!model || typeof model !== "object" || Array.isArray(model)) die(2, "MODEL_DESCRIPTIONS is not an object");
if (!rowMap || typeof rowMap !== "object" || Array.isArray(rowMap)) die(2, "CHECKUP_ROW is not an object");
const rowIds = Object.keys(rowMap);
if (rowIds.length === 0) die(2, "CHECKUP_ROW is empty — refusing to pass vacuously");
const requiredKeys = ["health_guide", ...rowIds.map((id) => `health_${id}`)];
const findings = [];
const add = (code, subject, message) => findings.push({ code, subject, message });

for (const key of requiredKeys) {
  if (!model[key]) { add("U001", key, "visible diagnosis row has no explainer"); continue; }
  const fields = key === "health_guide" ? ["what", "meaning", "action"] : ["what", "normal", "action"];
  for (const [language, copy] of [["en", model[key]], ["de", model[key].de]]) {
    if (!copy || typeof copy !== "object") {
      add("U002", `${key}.${language}`, "language block is missing");
      continue;
    }
    for (const field of fields) {
      if (typeof copy[field] !== "string" || copy[field].trim().length < 30) {
        add("U003", `${key}.${language}.${field}`, "needs a concrete plain-language paragraph");
      }
    }
    const contextLength = `${copy.what || ""} ${copy.normal || copy.meaning || ""}`.trim().length;
    if (contextLength > 520) add("U004", `${key}.${language}`, `explanation is too long (${contextLength} > 520 characters)`);
    if (typeof copy.action === "string" && copy.action.length > 280) {
      add("U004", `${key}.${language}.action`, `next step is too long (${copy.action.length} > 280 characters)`);
    }
  }
}
for (const key of Object.keys(model).filter((key) => key.startsWith("health_"))) {
  if (!requiredKeys.includes(key)) add("U005", key, "stale diagnosis explainer has no visible row");
}

const boundedCopy = JSON.stringify(Object.fromEntries(requiredKeys.filter((key) => model[key]).map((key) => [key, model[key]])));
for (const [label, pattern] of [
  ["whole-plant all-clear", /(?:plant|unit|system) (?:is )?(?:fine|healthy)|\bAll clear\b/i],
  ["German whole-plant all-clear", /\bAnlage (?:ist )?(?:gesund|in Ordnung)\b|Alles in Ordnung/i],
]) if (pattern.test(boundedCopy)) add("U006", label, "bounded diagnosis copy must not promise that the whole plant is healthy");

let doc = read(docFile, docArg);
const markerPattern = /<!-- user-docs: (health_[a-z0-9_]+) -->/g;
const markers = [...doc.matchAll(markerPattern)];
const markerCounts = new Map();
for (const marker of markers) markerCounts.set(marker[1], (markerCounts.get(marker[1]) || 0) + 1);
for (const key of requiredKeys) {
  const count = markerCounts.get(key) || 0;
  if (count !== 1) add("U007", key, `documentation marker must appear exactly once (found ${count})`);
}
for (const [key, count] of markerCounts) {
  if (!requiredKeys.includes(key)) add("U007", key, "stale documentation section has no visible diagnosis row");
  if (count > 1) add("U007", key, `documentation marker is duplicated (${count})`);
}

const ordered = markers.filter((marker) => requiredKeys.includes(marker[1]));
for (let i = 0; i < ordered.length; i++) {
  const marker = ordered[i];
  const block = doc.slice(marker.index, ordered[i + 1]?.index ?? doc.length);
  if (marker[1] === "health_guide") {
    for (const status of ["OK", "HINWEIS", "WARNUNG", "PRÜFT", "NUR MESSWERT", "EXPERIMENTELL", "NICHT VERFÜGBAR"]) {
      if (!block.includes(status)) add("U008", marker[1], `status '${status}' is not explained before the first diagnosis`);
    }
  } else {
    if (!block.includes("**Einfach gesagt:**")) add("U008", marker[1], "section needs an 'Einfach gesagt' explanation");
    if (!block.includes("**Was du tun kannst:**")) add("U008", marker[1], "section needs a concrete 'Was du tun kannst' next step");
  }
}
for (const term of ["Verdichter", "BUH", "BSH", "X10A"]) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`\\|\\s*${escaped}\\s*\\|`).test(doc)) {
    add("U008", term, "technical term needs an entry in the plain-language glossary");
  }
}

// The dedicated evidence gate owns this contract and its implementation fingerprint. Reuse its
// structural rules here so plain-language CI also catches unsupported prose without maintaining a
// second, subtly different definition of acceptable evidence.
const evidence = read(evidenceFile, evidenceArg);
for (const finding of auditEvidenceContract(evidence, rowIds, evidenceArg)) {
  const code = finding.code === "E001" ? "U011"
    : (finding.code === "E008" || finding.code === "E009" ? "U013" : "U012");
  add(code, finding.subject, finding.message);
}

const fingerprint = crypto.createHash("sha256");
for (const relative of ["main/logic/checkup.hpp", "main/checkup.cpp"]) {
  fingerprint.update(`${relative}\0`);
  fingerprint.update(read(path.join(root, relative), relative));
  fingerprint.update("\0");
}
fingerprint.update(`CHECKUP_ROW\0${JSON.stringify(rowMap)}\0`);
fingerprint.update(`HEALTH_COPY\0${boundedCopy}\0`);
const i18nContract = source.split(/\r?\n/)
  .filter((line) => /"(?:card\.checkup|check\.|meaning\.label|normal\.label|action\.label)"/.test(line))
  .join("\n");
if (!i18nContract) die(2, "no diagnosis i18n contract found — refusing to pass vacuously");
fingerprint.update(`I18N\0${i18nContract}\0`);
const expectedStamp = fingerprint.digest("hex");
const stampPattern = /<!-- user-docs-contract: ([a-f0-9]{64}|pending) -->/g;
const stamps = [...doc.matchAll(stampPattern)];
if (stamps.length !== 1) add("U009", docArg, `source stamp must appear exactly once (found ${stamps.length})`);

if (update) {
  if (findings.length) {
    for (const finding of findings) console.error(`${finding.code} ${finding.subject}: ${finding.message}`);
    die(1, `${findings.length} finding(s); refusing to update the source stamp`);
  }
  doc = doc.replace(stampPattern, `<!-- user-docs-contract: ${expectedStamp} -->`);
  fs.writeFileSync(docFile, doc);
  console.log(`user docs audit: updated source stamp ${expectedStamp.slice(0, 12)} after ${rowIds.length} diagnosis results`);
  process.exit(0);
}
if (stamps.length === 1 && stamps[0][1] !== expectedStamp) {
  add("U010", docArg, `guide is stale for diagnosis source ${expectedStamp.slice(0, 12)}; review it, then run with --update`);
}

if (findings.length) {
  for (const finding of findings) console.error(`${finding.code} ${finding.subject}: ${finding.message}`);
  die(1, `${findings.length} finding(s)`);
}
console.log(`user docs audit: clean (${rowIds.length} diagnosis results + evidence sections, 2 UI languages, source ${expectedStamp.slice(0, 12)})`);
