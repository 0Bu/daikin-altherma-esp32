// Fail-closed evidence contract for all visible plant diagnoses.
//
// Structural checks keep every diagnosis traceable to an external source and distinguish that
// source from the firmware rule and project heuristic. The fingerprint binds the reviewed ledger
// to production semantics. Any implementation or ledger change is stale until a human follows the
// $diagnostic-evidence-review workflow and deliberately runs --update.
//
// Usage: node tools/diagnostic_evidence/check_diagnostic_evidence.mjs
//        [--root DIR] [--app FILE] [--evidence FILE] [--update]
// Exit: 0 clean/updated, 1 findings, 2 usage/parse/vacuity error.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { readAppSource } from "../ui/read_app_source.mjs";
import { auditEvidenceContract } from "./evidence_contract.mjs";

let root = process.cwd();
let appArg = "main/www/app.sources";
let evidenceArg = "docs/DIAGNOSTIC_EVIDENCE.md";
let update = false;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--root") root = process.argv[++i];
  else if (arg === "--app") appArg = process.argv[++i];
  else if (arg === "--evidence") evidenceArg = process.argv[++i];
  else if (arg === "--update") update = true;
  else die(2, `unknown argument: ${arg}`);
  if (root === undefined || appArg === undefined || evidenceArg === undefined) {
    die(2, "missing option value");
  }
}
root = path.resolve(root);
const app = path.resolve(root, appArg);
const evidenceFile = path.resolve(root, evidenceArg);

function die(code, message) {
  console.error(`diagnostic-evidence-audit: ${message}`);
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
  const close = source.indexOf("\n};", start);
  if (close < 0) die(2, `${label} has no top-level closing brace in ${appArg}`);
  try {
    return vm.runInNewContext(`(${source.slice(start, close + 2)})`, Object.create(null), { timeout: 5000 });
  } catch (error) {
    die(2, `${label} does not evaluate: ${error.message}`);
  }
}

let source;
try { source = readAppSource(app); }
catch (error) { die(2, `cannot assemble ${appArg}: ${error.message}`); }
const rowMap = loadObject(source, "const CHECKUP_ROW = {", "CHECKUP_ROW");
if (!rowMap || typeof rowMap !== "object" || Array.isArray(rowMap)) die(2, "CHECKUP_ROW is not an object");
const rowIds = Object.keys(rowMap);
if (rowIds.length === 0) die(2, "CHECKUP_ROW is empty — refusing to pass vacuously");

let evidence = read(evidenceFile, evidenceArg);
const findings = auditEvidenceContract(evidence, rowIds, evidenceArg);
const add = (code, subject, message) => findings.push({ code, subject, message });

const fingerprint = crypto.createHash("sha256");
function fingerprintText(label, value) {
  fingerprint.update(`${label}\0`);
  fingerprint.update(value);
  fingerprint.update("\0");
}
for (const relative of [
  "main/checkup.hpp",
  "main/logic/checkup.hpp",
  "main/logic/checkup_persist.hpp",
  "main/checkup.cpp",
  "main/logic/fault_state.hpp",
]) {
  fingerprintText(relative, read(path.join(root, relative), relative));
}

const poll = read(path.join(root, "main/hp_poll.cpp"), "main/hp_poll.cpp");
const pollContract = poll.split(/\r?\n/)
  .filter((line) => /CheckupCoverage|checkup_coverage|checkup_cover_row|checkup_record/.test(line))
  .join("\n");
if (pollContract.split("\n").filter(Boolean).length < 5) {
  die(2, "incomplete checkup polling/coverage contract — refusing to pass vacuously");
}
fingerprintText("main/hp_poll.cpp:checkup-contract", pollContract);

const httpStatus = read(path.join(root, "main/http_status.cpp"), "main/http_status.cpp");
const healthJsonStart = httpStatus.indexOf("// ── The rolling on-board plant diagnosis");
const healthJsonEnd = httpStatus.indexOf("// System health:", healthJsonStart);
if (healthJsonStart < 0 || healthJsonEnd < 0) {
  die(2, "cannot isolate the /status.health JSON contract — refusing to pass vacuously");
}
fingerprintText("main/http_status.cpp:health-json", httpStatus.slice(healthJsonStart, healthJsonEnd));

const overlay = read(path.join(root, "main/def/overlay.hpp"), "main/def/overlay.hpp");
const retryRows = overlay.split(/\r?\n/).filter((line) => /Protection Retry Qty/.test(line)).join("\n");
if (retryRows.split("\n").filter(Boolean).length !== 5) {
  die(2, "expected exactly five protection-retry catalog rows — refusing to fingerprint a partial contract");
}
fingerprintText("main/def/overlay.hpp:protection-retry-rows", retryRows);

const registers = read(path.join(root, "docs/REGISTERS.md"), "docs/REGISTERS.md");
const retryRegisterEvidence = registers.split(/\r?\n/)
  .filter((line) => /Protection Retry Qty|Register 0x10/.test(line))
  .join("\n");
if (!retryRegisterEvidence) die(2, "no protection-retry register evidence found — refusing to pass vacuously");
fingerprintText("docs/REGISTERS.md:protection-retry-evidence", retryRegisterEvidence);
fingerprintText("CHECKUP_ROW", JSON.stringify(rowMap));

const stampPattern = /<!-- diagnostic-evidence-contract: ([a-f0-9]{64}|pending) -->/g;
const stamps = [...evidence.matchAll(stampPattern)];
if (stamps.length !== 1) {
  add("E010", evidenceArg, `review fingerprint must appear exactly once (found ${stamps.length})`);
}
// Bind the claims and catalog too, but exclude the stamp itself so --update converges.
fingerprintText("DIAGNOSTIC_EVIDENCE", evidence.replace(stampPattern, "<!-- diagnostic-evidence-contract -->"));
const expectedStamp = fingerprint.digest("hex");

if (update) {
  if (findings.length) {
    for (const finding of findings) console.error(`${finding.code} ${finding.subject}: ${finding.message}`);
    die(1, `${findings.length} finding(s); refusing to update the review fingerprint`);
  }
  evidence = evidence.replace(stampPattern, `<!-- diagnostic-evidence-contract: ${expectedStamp} -->`);
  fs.writeFileSync(evidenceFile, evidence);
  console.log(`diagnostic evidence audit: updated review fingerprint ${expectedStamp.slice(0, 12)} after ${rowIds.length} diagnoses`);
  process.exit(0);
}
if (stamps.length === 1 && stamps[0][1] !== expectedStamp) {
  add("E010", evidenceArg,
    `evidence is stale for implementation/source contract ${expectedStamp.slice(0, 12)}; review it, then run with --update`);
}

if (findings.length) {
  for (const finding of findings) console.error(`${finding.code} ${finding.subject}: ${finding.message}`);
  die(1, `${findings.length} finding(s)`);
}
console.log(`diagnostic evidence audit: clean (${rowIds.length} diagnoses, reviewed contract ${expectedStamp.slice(0, 12)})`);
