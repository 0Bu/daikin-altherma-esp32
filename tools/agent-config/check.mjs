#!/usr/bin/env node
// Runner-neutral agent configuration contract.
//
// .codex/migration-manifest.json is the one mapping ledger. This checker does not pretend that
// Claude Markdown and Codex TOML, or their skill prose, can be byte-identical. Instead it verifies
// the parity that is both meaningful and deterministic:
//   * every tracked .claude file is mapped exactly once and every declared target exists;
//   * a reviewed SHA-256 over every tracked legacy path and byte catches compatibility-source drift;
//   * legacy and canonical skill sets/names match, both descriptions are non-empty, and existing
//     OpenAI skill metadata is carried over byte-for-byte;
//   * explicit safety invariants occur in both always-loaded instruction files;
//   * both always-loaded files stay inside their byte budgets.
// Missing inputs are configuration errors (exit 2); budget, mapping, or parity drift exits 1.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const legacyOnly = argv.includes("--legacy-claude-budget-only");
if (argv.some((arg) => arg !== "--legacy-claude-budget-only")) {
  die(2, `unknown argument: ${argv.find((arg) => arg !== "--legacy-claude-budget-only")}`);
}

function die(code, message) {
  console.error(`agent-instructions: ${message}`);
  process.exit(code);
}

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value))) die(2, `${label} must be a positive integer`);
  return Number(value);
}

function checkBudget(file, budget, label) {
  let stat;
  try { stat = fs.statSync(file); }
  catch { die(2, `${label} file ${file} does not exist — refusing to report success`); }
  if (!stat.isFile()) die(2, `${label} path ${file} is not a regular file`);
  if (stat.size > budget) {
    die(1, `${label} file ${file} is ${stat.size} bytes, over the ${budget}-byte budget; move narrative to docs/ rather than raising the budget`);
  }
  return stat.size;
}

if (legacyOnly) {
  const file = path.resolve(process.env.AGENT_LEGACY_INSTRUCTIONS_FILE || ".claude/CLAUDE.md");
  const budget = positiveInteger(process.env.AGENT_LEGACY_INSTRUCTIONS_BUDGET_BYTES || "65536", "legacy instruction budget");
  const size = checkBudget(file, budget, "Claude compatibility instructions");
  console.log(`agent-instructions: Claude compatibility budget ${size} of ${budget} bytes (${Math.floor(100 * size / budget)}%)`);
  process.exit(0);
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.AGENT_CONFIG_ROOT || path.join(moduleDirectory, "../.."));
const manifestFile = path.resolve(root, process.env.AGENT_MIGRATION_MANIFEST || ".codex/migration-manifest.json");
const invariantFile = path.resolve(root, process.env.AGENT_SAFETY_INVARIANTS || "tools/agent-config/safety-invariants.json");
const canonicalBudget = positiveInteger(process.env.AGENT_INSTRUCTIONS_BUDGET_BYTES || "24576", "canonical instruction budget");
const legacyBudget = positiveInteger(process.env.AGENT_LEGACY_INSTRUCTIONS_BUDGET_BYTES || "65536", "legacy instruction budget");
const legacyTreeFormat = "sha256(path-utf8 + NUL + raw-bytes + NUL for each tracked .claude file in bytewise path order)";

function readJson(file, label) {
  let source;
  try { source = fs.readFileSync(file, "utf8"); }
  catch { die(2, `cannot read ${label} ${file}`); }
  try { return JSON.parse(source); }
  catch (error) { die(2, `${label} ${file} is not valid JSON: ${error.message}`); }
}

function safeRelative(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    die(2, `${label} must be a non-empty repository-relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").includes("..") || normalized.startsWith("./") || normalized.includes("//")) {
    die(2, `${label} is not a normalized repository-relative path: ${value}`);
  }
  return normalized;
}

function repoPath(relative) {
  return path.join(root, ...relative.split("/"));
}

function regularFile(relative, label) {
  let stat;
  try { stat = fs.statSync(repoPath(relative)); }
  catch { die(1, `${label} is missing: ${relative}`); }
  if (!stat.isFile()) die(1, `${label} is not a regular file: ${relative}`);
}

function trackedLegacyFiles() {
  const override = process.env.AGENT_CONFIG_TRACKED_FILES_FILE;
  if (override) {
    let text;
    try { text = fs.readFileSync(override, "utf8"); }
    catch { die(2, `cannot read tracked-file fixture ${override}`); }
    return text.split(/\r?\n/).filter(Boolean).sort();
  }
  const result = spawnSync("git", ["-C", root, "ls-files", "-z", "--", ".claude"], { encoding: "utf8" });
  if (result.status !== 0) die(2, "git ls-files could not enumerate tracked .claude files");
  return result.stdout.split("\0").filter(Boolean).sort();
}

function frontmatter(file, label) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch { die(1, `${label} is unreadable: ${path.relative(root, file)}`); }
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") die(1, `${label} has no YAML frontmatter: ${path.relative(root, file)}`);
  const end = lines.indexOf("---", 1);
  if (end < 0) die(1, `${label} has unterminated YAML frontmatter: ${path.relative(root, file)}`);
  const values = new Map();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      die(1, `${label} has invalid restricted YAML frontmatter: ${path.relative(root, file)}`);
    }
    if (values.has(match[1])) die(1, `${label} duplicates frontmatter key ${match[1]}: ${path.relative(root, file)}`);
    values.set(match[1], match[2].trim());
  }
  return { text, values, body: lines.slice(end + 1).join("\n").trim() };
}

const manifest = readJson(manifestFile, "migration manifest");
if (manifest?.schema_version !== 1) die(2, "migration manifest schema_version must be 1");
if (manifest?.legacy_root !== ".claude") die(2, "migration manifest legacy_root must be .claude");
if (manifest?.legacy_tree_sha256_format !== legacyTreeFormat) {
  die(2, `migration manifest legacy_tree_sha256_format must be ${legacyTreeFormat}`);
}
if (typeof manifest?.legacy_tree_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.legacy_tree_sha256)) {
  die(2, "migration manifest legacy_tree_sha256 must be a lowercase 64-character SHA-256");
}
const canonicalInstructions = safeRelative(manifest?.canonical_instructions, "canonical_instructions");
if (canonicalInstructions !== "AGENTS.md") die(2, "canonical_instructions must be AGENTS.md");
if (!Array.isArray(manifest?.entries) || manifest.entries.length === 0) {
  die(2, "migration manifest entries must be a non-empty array");
}

const allowedStatuses = new Set(["canonical", "adapter", "deprecated"]);
const entries = [];
const sources = new Set();
for (let index = 0; index < manifest.entries.length; index++) {
  const entry = manifest.entries[index];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) die(2, `entries[${index}] must be an object`);
  const source = safeRelative(entry.source, `entries[${index}].source`);
  if (!source.startsWith(".claude/")) die(2, `manifest source is outside .claude: ${source}`);
  if (sources.has(source)) die(1, `migration manifest maps ${source} more than once`);
  sources.add(source);
  if (!allowedStatuses.has(entry.status)) die(2, `invalid status for ${source}: ${entry.status}`);
  if (!Array.isArray(entry.targets)) die(2, `targets for ${source} must be an array`);
  if (entry.status !== "deprecated" && entry.targets.length === 0) {
    die(1, `${entry.status} entry ${source} has no target`);
  }
  const targetSet = new Set();
  const targets = entry.targets.map((target, targetIndex) => {
    const normalized = safeRelative(target, `targets[${targetIndex}] for ${source}`);
    if (targetSet.has(normalized)) die(1, `${source} lists target ${normalized} more than once`);
    targetSet.add(normalized);
    return normalized;
  });
  regularFile(source, "manifest source");
  for (const target of targets) regularFile(target, `target for ${source}`);
  entries.push({ source, status: entry.status, targets });
}

const tracked = trackedLegacyFiles();
if (new Set(tracked).size !== tracked.length) die(2, "tracked .claude file enumeration contains duplicates");
for (const source of tracked) if (!sources.has(source)) die(1, `tracked legacy file is absent from migration manifest: ${source}`);
for (const source of sources) if (!tracked.includes(source)) die(1, `migration manifest source is not a tracked legacy file: ${source}`);

const fingerprint = createHash("sha256");
const bytewiseTracked = [...tracked].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
for (const source of bytewiseTracked) {
  fingerprint.update(Buffer.from(source, "utf8"));
  fingerprint.update(Buffer.from([0]));
  fingerprint.update(fs.readFileSync(repoPath(source)));
  fingerprint.update(Buffer.from([0]));
}
const actualLegacyTreeSha256 = fingerprint.digest("hex");
if (actualLegacyTreeSha256 !== manifest.legacy_tree_sha256) {
  die(1, `reviewed legacy source tree fingerprint drifted (expected ${manifest.legacy_tree_sha256}, got ${actualLegacyTreeSha256}); review the .claude changes before updating the manifest`);
}

const instructionMapping = entries.find((entry) => entry.source === ".claude/CLAUDE.md");
if (instructionMapping?.status !== "adapter" || !instructionMapping.targets.includes(canonicalInstructions)) {
  die(1, `.claude/CLAUDE.md must map as an adapter to ${canonicalInstructions}`);
}

regularFile(canonicalInstructions, "canonical instructions");
regularFile(".claude/CLAUDE.md", "Claude compatibility instructions");
const canonicalSize = checkBudget(repoPath(canonicalInstructions), canonicalBudget, "canonical instructions");
const legacySize = checkBudget(repoPath(".claude/CLAUDE.md"), legacyBudget, "Claude compatibility instructions");

const skillMappings = new Map();
for (const entry of entries) {
  const match = entry.source.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
  if (!match) continue;
  const name = match[1];
  const expected = `.agents/skills/${name}/SKILL.md`;
  if (entry.status !== "canonical" || !entry.targets.includes(expected)) {
    die(1, `skill ${name} must canonically map ${entry.source} to ${expected}`);
  }
  skillMappings.set(name, { legacy: entry.source, canonical: expected });
}

const subagentMappings = new Map();
for (const entry of entries) {
  const match = entry.source.match(/^\.claude\/agents\/([^/]+)\.md$/);
  if (!match) continue;
  const name = match[1];
  const expected = `.codex/agents/${name}.toml`;
  if (entry.status !== "canonical" || !entry.targets.includes(expected)) {
    die(1, `subagent ${name} must canonically map ${entry.source} to ${expected}`);
  }
  subagentMappings.set(name, { legacy: entry.source, canonical: expected });
}

function namedFiles(relativeRoot, extension) {
  let names;
  try {
    names = fs.readdirSync(repoPath(relativeRoot), { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name) === extension)
      .map((entry) => path.basename(entry.name, extension)).sort();
  } catch { die(1, `agent root is missing: ${relativeRoot}`); }
  return names;
}

const mappedSubagents = [...subagentMappings.keys()].sort();
for (const [label, actual] of [
  ["legacy", namedFiles(".claude/agents", ".md")],
  ["canonical", namedFiles(".codex/agents", ".toml")],
]) {
  if (actual.join("\0") !== mappedSubagents.join("\0")) {
    die(1, `${label} subagent set does not match the migration manifest (expected ${mappedSubagents.join(", ")}; got ${actual.join(", ")})`);
  }
}

for (const [name, mapping] of subagentMappings) {
  const legacy = frontmatter(repoPath(mapping.legacy), "legacy subagent");
  if (legacy.values.get("name") !== name || !legacy.values.get("description") || !legacy.body) {
    die(1, `legacy subagent ${name} needs matching name, description and instructions`);
  }
  const canonicalText = fs.readFileSync(repoPath(mapping.canonical), "utf8");
  const tomlName = canonicalText.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const tomlDescription = canonicalText.match(/^description\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const sandbox = canonicalText.match(/^sandbox_mode\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const instructions = canonicalText.match(/^developer_instructions\s*=\s*"""([\s\S]+)"""\s*$/m)?.[1]?.trim();
  const canonicalName = name.replaceAll("-", "_");
  if (tomlName !== canonicalName || !tomlDescription || sandbox !== "read-only" || !instructions) {
    die(1, `canonical subagent ${name} needs mapped name ${canonicalName}, description, read-only sandbox and developer instructions`);
  }
}

function skillDirectories(relativeRoot) {
  let names;
  try {
    names = fs.readdirSync(repoPath(relativeRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch { die(1, `skill root is missing: ${relativeRoot}`); }
  return names;
}

const legacySkills = skillDirectories(".claude/skills");
const canonicalSkills = skillDirectories(".agents/skills");
const mappedSkills = [...skillMappings.keys()].sort();
for (const [label, actual] of [["legacy", legacySkills], ["canonical", canonicalSkills]]) {
  if (actual.join("\0") !== mappedSkills.join("\0")) {
    die(1, `${label} skill set does not match the migration manifest (expected ${mappedSkills.join(", ")}; got ${actual.join(", ")})`);
  }
}

for (const [name, mapping] of skillMappings) {
  const legacy = frontmatter(repoPath(mapping.legacy), "legacy skill");
  const canonical = frontmatter(repoPath(mapping.canonical), "canonical skill");
  if (legacy.values.get("name") !== name || canonical.values.get("name") !== name) {
    die(1, `skill ${name} has a frontmatter name mismatch`);
  }
  if (!legacy.values.get("description") || !canonical.values.get("description")) {
    die(1, `skill ${name} needs a non-empty description in both runners`);
  }
  if (!legacy.body || !canonical.body) die(1, `skill ${name} has an empty instruction body`);
  const canonicalKeys = [...canonical.values.keys()].sort();
  if (canonicalKeys.join("\0") !== "description\0name") {
    die(1, `canonical skill ${name} frontmatter keys must be exactly name and description (got ${canonicalKeys.join(", ")})`);
  }
}

for (const entry of entries) {
  const match = entry.source.match(/^\.claude\/skills\/([^/]+)\/agents\/openai\.yaml$/);
  if (!match) continue;
  const expected = `.agents/skills/${match[1]}/agents/openai.yaml`;
  if (entry.status !== "canonical" || !entry.targets.includes(expected)) {
    die(1, `OpenAI metadata for ${match[1]} must map to ${expected}`);
  }
  const sourceBytes = fs.readFileSync(repoPath(entry.source));
  const targetBytes = fs.readFileSync(repoPath(expected));
  if (!sourceBytes.equals(targetBytes)) die(1, `OpenAI metadata drifted for skill ${match[1]}`);
}

const safety = readJson(invariantFile, "safety invariant contract");
if (safety?.schema_version !== 1 || !Array.isArray(safety?.invariants) || safety.invariants.length === 0) {
  die(2, "safety invariant contract needs schema_version 1 and a non-empty invariants array");
}
const instructionTexts = new Map([
  [canonicalInstructions, fs.readFileSync(repoPath(canonicalInstructions), "utf8")],
  [".claude/CLAUDE.md", fs.readFileSync(repoPath(".claude/CLAUDE.md"), "utf8")],
]);
const invariantIds = new Set();
for (let index = 0; index < safety.invariants.length; index++) {
  const invariant = safety.invariants[index];
  if (!invariant || typeof invariant.id !== "string" || !invariant.id) die(2, `safety invariant ${index} has no id`);
  if (invariantIds.has(invariant.id)) die(2, `duplicate safety invariant id: ${invariant.id}`);
  invariantIds.add(invariant.id);
  if (typeof invariant.pattern !== "string" || !invariant.pattern) die(2, `safety invariant ${invariant.id} has no pattern`);
  let pattern;
  try { pattern = new RegExp(invariant.pattern, "imu"); }
  catch (error) { die(2, `invalid pattern for safety invariant ${invariant.id}: ${error.message}`); }
  for (const [file, text] of instructionTexts) {
    if (!pattern.test(text)) die(1, `safety invariant ${invariant.id} is missing from ${file}`);
  }
}

console.log(`agent-instructions: ${manifest.entries.length} reviewed legacy mappings, ${skillMappings.size} skill pairs, ${subagentMappings.size} subagent pairs and ${safety.invariants.length} safety invariants clean`);
console.log(`agent-instructions: canonical budget ${canonicalSize}/${canonicalBudget} bytes; Claude compatibility budget ${legacySize}/${legacyBudget} bytes`);
