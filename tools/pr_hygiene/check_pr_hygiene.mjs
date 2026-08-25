#!/usr/bin/env node
// Contributor-authored-text privacy and language gate.
//
// Checks two surfaces a mechanical file-content scan never sees: the commit messages this PR/push
// carries, and — when running under a GitHub `pull_request` event — the PR title and description.
// Firmware, test and doc DIFF content is deliberately out of scope; tools/pr_hygiene/personal_info.mjs
// explains why a value-shaped heuristic cannot safely run over this codebase's diffs. Repository
// documentation's own English-only coverage already lives in tools/user_docs/english_docs.mjs; this
// reuses its isLikelyGerman predicate rather than keeping a second copy that could quietly diverge.
//
// Usage: node tools/pr_hygiene/check_pr_hygiene.mjs [--repo-root DIR] [--base REF --head REF]
//        [--event-file FILE] [--exceptions-file FILE]
//   --repo-root         defaults to the current directory
//   --base / --head     default to origin/main..HEAD for a local dry run; CI passes the event's
//                        exact, already merge-tree-bound base/head SHAs explicitly. If origin/main
//                        is unavailable locally, the commit-range check is skipped.
//   --event-file        defaults to $GITHUB_EVENT_PATH; without it, the PR title/description check
//                        is skipped — there is no PR yet on a local pre-push dry run
//   --exceptions-file    defaults to tools/pr_hygiene/audit_exceptions.txt next to this script
// Exit: 0 = clean or nothing to check, 1 = findings, 2 = usage/runtime error.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPersonalInfo } from "./personal_info.mjs";
import { isLikelyGerman } from "../user_docs/english_docs.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function die(code, message) {
  console.error(`pr-hygiene: ${message}`);
  process.exit(code);
}

let repoRoot = process.cwd();
let base = "";
let head = "";
let eventFile = process.env.GITHUB_EVENT_PATH || "";
let exceptionsFile = path.join(moduleDir, "audit_exceptions.txt");
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--repo-root") repoRoot = process.argv[++i];
  else if (arg === "--base") base = process.argv[++i];
  else if (arg === "--head") head = process.argv[++i];
  else if (arg === "--event-file") eventFile = process.argv[++i];
  else if (arg === "--exceptions-file") exceptionsFile = process.argv[++i];
  else die(2, `unknown argument: ${arg}`);
  if ([repoRoot, base, head, eventFile, exceptionsFile].some((value) => value === undefined)) {
    die(2, "missing option value");
  }
}
if ((base && !head) || (head && !base)) die(2, "--base and --head must be given together");
repoRoot = path.resolve(repoRoot);

function git(args) {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

if (git(["rev-parse", "--show-toplevel"]) === null) {
  die(2, `not a git repository: ${repoRoot}`);
}

function resolveSha(ref) {
  const out = git(["rev-parse", "--verify", "-q", ref]);
  return out ? out.trim() : null;
}

const notes = [];
if (!(base && head)) {
  const originMain = resolveSha("origin/main");
  const headSha = resolveSha("HEAD");
  if (originMain && headSha) {
    base = originMain;
    head = headSha;
  }
  if (!(base && head)) {
    notes.push("no comparison base resolved (origin/main is unavailable); skipping the commit-range check");
  }
}

function loadExceptions(file) {
  if (!fs.existsSync(file)) return new Set();
  const set = new Set();
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const entry = rawLine.split("#", 1)[0].trim().toLowerCase();
    if (entry) set.add(entry);
  }
  return set;
}
const exceptions = loadExceptions(exceptionsFile);

function fingerprint(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Attribution email addresses are expected Git metadata, but the prefix alone must not become an
// escape hatch for arbitrary prose. Only a complete `Token: Name <email>` line gets the exception;
// its name is still checked for shaped personal information, while its natural-language signature
// is not (a contributor's proper name is not English prose). Any suffix or malformed trailer is
// checked as an ordinary line.
const ATTRIBUTION_TRAILER = /^(Co-authored-by|Signed-off-by|Reviewed-by|Reported-by|Helped-by|Acked-by|Tested-by):\s*(.*?)\s*<[^<>\s@]+@[^<>\s@]+>\s*$/iu;
const TRAILER_LINE = /^[A-Za-z0-9-]+:\s+\S.*$/u;

const findings = [];
function terminalAttributionTrailers(lines) {
  const indices = new Set();
  let started = false;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line) {
      if (started) break;
      continue;
    }
    if (!TRAILER_LINE.test(line)) break;
    started = true;
    if (ATTRIBUTION_TRAILER.test(line)) indices.add(index);
  }
  return indices;
}

function checkText(subjectLabel, text, { allowTerminalTrailers = false } = {}) {
  if (!text) return;
  const lines = text.split(/\r?\n/);
  const trailerIndices = allowTerminalTrailers ? terminalAttributionTrailers(lines) : new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const location = lines.length === 1 ? subjectLabel : `${subjectLabel}:${index + 1}`;
    const print = fingerprint(line);
    if (exceptions.has(print)) continue;
    const trailer = trailerIndices.has(index) ? line.match(ATTRIBUTION_TRAILER) : null;
    const personalInfoText = trailer ? `${trailer[1]}: ${trailer[2]}` : line;
    for (const { code, message } of findPersonalInfo(personalInfoText)) {
      findings.push({ code, subject: location, message, fingerprint: print });
    }
    if (!trailer && isLikelyGerman(line)) {
      findings.push({ code: "L001", subject: location, message: "must be written in English", fingerprint: print });
    }
  }
}

let commitCount = 0;
if (base && head) {
  const log = git(["log", "--format=%H%x1f%s%x1f%b%x1e", `${base}..${head}`]);
  if (log === null) {
    die(2, `could not read commit range ${base}..${head}`);
  } else {
    for (const record of log.split("\x1e\n")) {
      if (record.trim() === "") continue;
      const [hash, subject = "", body = ""] = record.split("\x1f");
      if (!hash) continue;
      commitCount++;
      const shortSha = hash.trim().slice(0, 12);
      checkText(`commit ${shortSha} (subject)`, subject);
      checkText(`commit ${shortSha} (body)`, body, { allowTerminalTrailers: true });
    }
  }
}

let prTitleChecked = false;
let prBodyChecked = false;
if (eventFile && fs.existsSync(eventFile)) {
  let event;
  try {
    event = JSON.parse(fs.readFileSync(eventFile, "utf8"));
  } catch (error) {
    die(2, `event file is not valid JSON: ${eventFile}: ${error.message}`);
  }
  if (event && typeof event === "object" && event.pull_request && typeof event.pull_request === "object") {
    const { title, body } = event.pull_request;
    checkText("PR title", typeof title === "string" ? title : "");
    prTitleChecked = true;
    checkText("PR description", typeof body === "string" ? body : "");
    prBodyChecked = true;
  } else {
    die(2, "event payload has no pull_request object");
  }
} else if (eventFile) {
  die(2, `event file not found: ${eventFile}`);
} else {
  notes.push("no --event-file and GITHUB_EVENT_PATH is unset; skipping the PR title/description check");
}

for (const note of notes) console.error(`pr-hygiene: note: ${note}`);

if (findings.length) {
  for (const finding of findings) {
    console.error(`${finding.code} ${finding.subject}: ${finding.message}`);
    console.error(`    fingerprint: ${finding.fingerprint}`);
  }
  console.error("");
  console.error("fix: remove or rewrite the flagged text before this PR merges. A finding already");
  console.error("     pushed lives in the commit object itself — editing the PR description does not");
  console.error("     remove it from history; see the $pr-hygiene-review skill for the rewrite path.");
  console.error("     If this is a false positive, add its fingerprint (never the flagged text) to");
  const exceptionsDisplay = path.relative(process.cwd(), exceptionsFile);
  console.error(`     ${exceptionsDisplay.startsWith("..") ? exceptionsFile : exceptionsDisplay} with a reason.`);
  die(1, `${findings.length} finding(s)`);
}

console.log(
  `pr hygiene audit: clean (${commitCount} commit(s), ` +
  `title ${prTitleChecked ? "checked" : "skipped"}, description ${prBodyChecked ? "checked" : "skipped"})`,
);
