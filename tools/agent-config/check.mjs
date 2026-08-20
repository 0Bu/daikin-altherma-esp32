#!/usr/bin/env node
// Canonical Codex agent-configuration contract.
//
// The Phase 7 cutover is intentionally fail-closed: AGENTS.md, .agents/, and .codex/ are the only
// supported agent surfaces. Any tracked or filesystem .claude path is a configuration regression.
// Missing inputs are configuration errors (exit 2); budget or contract drift exits 1.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
if (argv.length !== 0) die(2, `unknown argument: ${argv[0]}`);

function die(code, message) {
  console.error(`agent-instructions: ${message}`);
  process.exit(code);
}

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(String(value))) die(2, `${label} must be a positive integer`);
  return Number(value);
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.AGENT_CONFIG_ROOT || path.join(moduleDirectory, "../.."));
const canonicalInstructions = "AGENTS.md";
const invariantFile = "tools/agent-config/safety-invariants.json";
const canonicalBudget = positiveInteger(
  process.env.AGENT_INSTRUCTIONS_BUDGET_BYTES || "24576",
  "canonical instruction budget",
);

function repoPath(relative) {
  return path.join(root, ...relative.split("/"));
}

function regularFile(relative, label) {
  let stat;
  try { stat = fs.statSync(repoPath(relative)); }
  catch { die(1, `${label} is missing: ${relative}`); }
  if (!stat.isFile()) die(1, `${label} is not a regular file: ${relative}`);
}

function executableFile(relative, label) {
  let stat;
  try { stat = fs.lstatSync(repoPath(relative)); }
  catch { die(1, `${label} is missing: ${relative}`); }
  if (!stat.isFile()) die(1, `${label} is not a regular file: ${relative}`);
  if ((stat.mode & 0o111) === 0) die(1, `${label} is not executable: ${relative}`);
}

function readText(relative, label) {
  try { return fs.readFileSync(repoPath(relative), "utf8"); }
  catch { die(1, `${label} is unreadable: ${relative}`); }
}

function readJson(relative, label) {
  const source = readText(relative, label);
  try { return JSON.parse(source); }
  catch (error) { die(2, `${label} ${relative} is not valid JSON: ${error.message}`); }
}

function checkBudget(relative, budget, label) {
  let stat;
  try { stat = fs.statSync(repoPath(relative)); }
  catch { die(2, `${label} file ${relative} does not exist — refusing to report success`); }
  if (!stat.isFile()) die(2, `${label} path ${relative} is not a regular file`);
  if (stat.size > budget) {
    die(1, `${label} file ${relative} is ${stat.size} bytes, over the ${budget}-byte budget; move narrative to docs/ rather than raising the budget`);
  }
  return stat.size;
}

function trackedClaudeFiles() {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z", "--", ".claude"], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    die(2, "git ls-files could not verify that .claude is absent");
  }
  return result.stdout.split("\0").filter(Boolean).sort();
}

const trackedClaude = trackedClaudeFiles();
if (trackedClaude.length !== 0) {
  die(1, `tracked .claude content is forbidden after the canonical cutover: ${trackedClaude.join(", ")}`);
}
let claudePathExists = false;
try { fs.lstatSync(repoPath(".claude")); claudePathExists = true; }
catch (error) {
  if (error?.code !== "ENOENT") die(2, `cannot verify filesystem .claude absence: ${error.message}`);
}
if (claudePathExists) die(1, "filesystem .claude content is forbidden after the canonical cutover");

function frontmatter(relative, label) {
  const text = readText(relative, label);
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") die(1, `${label} has no YAML frontmatter: ${relative}`);
  const end = lines.indexOf("---", 1);
  if (end < 0) die(1, `${label} has unterminated YAML frontmatter: ${relative}`);
  const values = new Map();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) die(1, `${label} has invalid restricted YAML frontmatter: ${relative}`);
    if (values.has(match[1])) die(1, `${label} duplicates frontmatter key ${match[1]}: ${relative}`);
    values.set(match[1], match[2].trim());
  }
  return { values, body: lines.slice(end + 1).join("\n").trim() };
}

function directoryNames(relativeRoot) {
  try {
    return fs.readdirSync(repoPath(relativeRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch { die(1, `agent root is missing: ${relativeRoot}`); }
}

const expectedSkills = [
  "absence-review",
  "add-logic-test",
  "bug-triage",
  "device-triage",
  "diagnostic-evidence-review",
  "domain-review",
  "feature-docs",
  "flash-esp32",
  "metrics-audit",
  "project-review",
  "renovate-review",
  "schematic-review",
  "ui-gif",
  "ui-use-case-review",
  "user-docs-review",
  "value-plausibility",
].sort();
const canonicalSkills = directoryNames(".agents/skills");
if (canonicalSkills.join("\0") !== expectedSkills.join("\0")) {
  die(1, `canonical skill set must contain exactly the 16 reviewed skills (expected ${expectedSkills.join(", ")}; got ${canonicalSkills.join(", ")})`);
}

for (const name of expectedSkills) {
  const relative = `.agents/skills/${name}/SKILL.md`;
  regularFile(relative, `canonical skill ${name}`);
  const skill = frontmatter(relative, "canonical skill");
  const keys = [...skill.values.keys()].sort();
  if (keys.join("\0") !== "description\0name") {
    die(1, `canonical skill ${name} frontmatter keys must be exactly name and description (got ${keys.join(", ")})`);
  }
  if (skill.values.get("name") !== name) {
    die(1, `canonical skill ${name} has a frontmatter name mismatch`);
  }
  if (!skill.values.get("description")) die(1, `canonical skill ${name} needs a non-empty description`);
  if (!skill.body) die(1, `canonical skill ${name} has an empty instruction body`);
}

function metadataFiles(relativeRoot) {
  const found = [];
  function walk(relative) {
    let entries;
    try { entries = fs.readdirSync(repoPath(relative), { withFileTypes: true }); }
    catch { die(1, `cannot enumerate canonical skill metadata under ${relative}`); }
    for (const entry of entries) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && entry.name === "openai.yaml") found.push(child);
    }
  }
  walk(relativeRoot);
  return found.sort();
}

function openAiMetadata(relative, skillName) {
  const lines = readText(relative, "OpenAI skill metadata").split(/\r?\n/);
  while (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "interface:") {
    die(1, `OpenAI metadata needs one interface mapping: ${relative}`);
  }
  const values = new Map();
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const match = line.match(/^  ([a-z_]+):\s*(.+)$/);
    if (!match) die(1, `OpenAI metadata has invalid restricted YAML: ${relative}`);
    if (values.has(match[1])) die(1, `OpenAI metadata duplicates ${match[1]}: ${relative}`);
    let value;
    try { value = JSON.parse(match[2]); }
    catch { die(1, `OpenAI metadata ${match[1]} must be a quoted YAML string: ${relative}`); }
    if (typeof value !== "string" || !value.trim()) {
      die(1, `OpenAI metadata ${match[1]} must be a non-empty string: ${relative}`);
    }
    values.set(match[1], value);
  }
  const expectedKeys = ["default_prompt", "display_name", "short_description"];
  const keys = [...values.keys()].sort();
  if (keys.join("\0") !== expectedKeys.join("\0")) {
    die(1, `OpenAI metadata interface keys must be exactly ${expectedKeys.join(", ")}: ${relative}`);
  }
  if (!values.get("default_prompt").includes(`$${skillName}`)) {
    die(1, `OpenAI metadata default_prompt must invoke $${skillName}: ${relative}`);
  }
}

const expectedMetadata = [
  ".agents/skills/diagnostic-evidence-review/agents/openai.yaml",
  ".agents/skills/ui-use-case-review/agents/openai.yaml",
  ".agents/skills/user-docs-review/agents/openai.yaml",
].sort();
const canonicalMetadata = metadataFiles(".agents/skills");
if (canonicalMetadata.join("\0") !== expectedMetadata.join("\0")) {
  die(1, `canonical skills must contain exactly the three reviewed openai.yaml files (expected ${expectedMetadata.join(", ")}; got ${canonicalMetadata.join(", ")})`);
}
for (const relative of expectedMetadata) {
  const skillName = relative.split("/")[2];
  openAiMetadata(relative, skillName);
}

executableFile("scripts/gh-with-git-credentials.sh", "canonical GitHub credential wrapper");
const credentialWrapper = readText(
  "scripts/gh-with-git-credentials.sh",
  "canonical GitHub credential wrapper",
);
for (const required of [
  "#!/bin/bash -p",
  "set +x",
  "GH_BINARY_CANDIDATES='/opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh'",
  "GIT_BINARY_CANDIDATES='/usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git'",
  "unset BASH_ENV ENV LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH",
  "SAFE_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  '[ ! -L "$wrapper_source" ]',
  '[ "$wrapper_logical_dir" = "$wrapper_physical_dir" ]',
  '[ "$wrapper_physical_dir/${wrapper_source##*/}" = "$wrapper_identity" ]',
  'binding_git_env=(',
  '"GIT_NO_REPLACE_OBJECTS=1"',
  "rev-parse --show-toplevel",
  "ls-files --error-unmatch -- scripts/gh-with-git-credentials.sh",
  "for-each-ref --format='%(refname)' refs/replace",
  '[ -z "$replacement_refs" ]',
  '/usr/bin/id -P "$credential_user"',
  '/usr/bin/getent passwd "$credential_user"',
  'credential_file="$credential_home/.git-credentials"',
  'cd "$config_dir" || exit 1',
  '/usr/bin/env -i HOME="$config_dir" XDG_CONFIG_HOME="$config_dir" PATH="$SAFE_PATH"',
  "GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null",
  'GIT_CEILING_DIRECTORIES="$config_dir" GIT_TERMINAL_PROMPT=0',
  '"$git_bin" credential-store --file "$credential_file" get',
  'wrapper_identity="$PROJECT_ROOT/scripts/gh-with-git-credentials.sh"',
  '"$merge_gate" --payload-file "$gate_payload" >/dev/null',
  '/usr/bin/env -i PATH="$SAFE_PATH" AGENT_PROJECT_DIR="$PROJECT_ROOT"',
  'GIT_NO_REPLACE_OBJECTS=1 \\\n        "$merge_gate"',
  "only github.com is allowed",
  "aliases and extensions are not allowed",
  '[ "${#args[@]}" -eq 12 ]',
  '[ "${args[1]}" = github.com/0Bu/daikin-altherma-esp32 ]',
  '[ "${args[7]}" = main ]',
  '[ "$body_file_converted" -eq 1 ]',
  "symbolic-ref --quiet --short HEAD",
  "status --porcelain=v1 --untracked-files=normal",
  "os.O_RDONLY | os.O_NOFOLLOW",
  "os.fstat(body_fd)",
  'secret_components = {".git", ".ssh", ".gnupg", ".aws", ".kube", "secrets", ".secrets"}',
  '".git" + "-credentials"',
  "check_directory(fd)",
  "info.st_nlink != 1",
  "info.st_uid != os.getuid()",
  "info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)",
  'child_env+=("AGENT_GH_PR_CREATE_EXPECTED_HEAD=$pr_create_expected_head")',
  'repos/0Bu/daikin-altherma-esp32/git/ref/heads/$AGENT_GH_PR_CREATE_BRANCH',
  "--jq .object.sha",
  'created_output="$("$@" --draft)"',
  "--json headRefOid --jq .headRefOid",
  '[ "$created_head" != "$AGENT_GH_PR_CREATE_EXPECTED_HEAD" ]',
  'pr close "$created_number"',
  'pr ready "$created_number"',
  'cleanup_created_pr "created PR head lookup failed"',
  'cleanup_created_pr "published PR head lookup failed"',
  '[ "$published_head" != "$AGENT_GH_PR_CREATE_EXPECTED_HEAD" ]',
  "PR creation must use the exact reviewed noninteractive repository form",
  '"issue develop"|"issue transfer"|"pr checkout"|"pr co"|"pr new"|"pr revert"|"repo clone"|"repo create"|"repo new"|"repo fork"|"repo rename"|"repo set-default"|"repo sync"',
  '"release create"|"release new"|"release download"|"release upload"|"release verify-asset"|"repo deploy-key"|"repo read-file"|"run download"',
  '"GH_PROMPT_DISABLED=1"',
  '"GH_TELEMETRY=0"',
  '"GH_NO_UPDATE_NOTIFIER=1"',
  '"GH_NO_EXTENSION_UPDATE_NOTIFIER=1"',
  '"GH_PAGER=cat"',
  '"GH_CONFIG_DIR=$config_dir"',
  'child_env=(',
  "extra_child_env=()",
  'unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN',
  "token_child_script='set +x",
  'IFS= read -r token <&9 || exit 2',
  'export GH_TOKEN="$token"',
  'cd "$HOME" || exit 2',
  '/usr/bin/mkfifo -m 600 "$token_fifo"',
  'exec 9<> "$token_fifo"',
  '/bin/rm -f -- "$token_fifo"',
  'printf \'%s\\n\' "$token" >&9',
  'unset token',
  'if [ "${#extra_child_env[@]}" -gt 0 ]; then',
  '/usr/bin/env -i "${child_env[@]}" "${extra_child_env[@]}"',
  '/usr/bin/env -i "${child_env[@]}"',
  '/bin/bash -p -c "$token_child_script" _ "$gh_bin" "${args[@]}"',
]) {
  if (!credentialWrapper.includes(required)) {
    die(1, `canonical GitHub credential wrapper contract drifted: missing ${required}`);
  }
}
const reviewedCredentialWrapperSha256 =
  "dfc430f5848ca8788e72fc4f696ea069984abea20bba08c62987d26425323e8b";
const credentialWrapperSha256 = createHash("sha256").update(credentialWrapper).digest("hex");
if (credentialWrapperSha256 !== reviewedCredentialWrapperSha256) {
  die(1, "canonical GitHub credential wrapper must invoke gh directly so the token never enters argv");
}
const isolatedCwdMentions = credentialWrapper.match(/cd "\$config_dir" \|\| exit 1/g) ?? [];
if (isolatedCwdMentions.length !== 1) {
  die(1, "canonical GitHub credential wrapper must isolate both credential-store and gh cwd");
}
const credentialStoreMentions = credentialWrapper.match(/[.]git-credentials/g) ?? [];
if (credentialStoreMentions.length !== 1 ||
    !credentialWrapper.includes('credential_file="$credential_home/.git-credentials"')) {
  die(1, "canonical GitHub credential wrapper must bind exactly one reviewed credential-store path");
}

regularFile(canonicalInstructions, "canonical instructions");
const canonicalSize = checkBudget(canonicalInstructions, canonicalBudget, "canonical instructions");
const safety = readJson(invariantFile, "safety invariant contract");
if (safety?.schema_version !== 1 || !Array.isArray(safety?.invariants)) {
  die(2, "safety invariant contract needs schema_version 1 and an invariants array");
}
if (safety.invariants.length !== 15) {
  die(1, `safety invariant contract must contain exactly 15 invariants (got ${safety.invariants.length})`);
}
const instructions = readText(canonicalInstructions, "canonical instructions");
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
  if (!pattern.test(instructions)) {
    die(1, `safety invariant ${invariant.id} is missing from ${canonicalInstructions}`);
  }
}

console.log(`agent-instructions: ${expectedSkills.length} canonical skills, ${expectedMetadata.length} OpenAI metadata files, one credential-safe gh wrapper and ${safety.invariants.length} AGENTS.md safety invariants clean`);
console.log(`agent-instructions: canonical budget ${canonicalSize}/${canonicalBudget} bytes`);
