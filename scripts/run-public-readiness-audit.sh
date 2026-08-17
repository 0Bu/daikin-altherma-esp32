#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node <<'JS'
const fs = require("node:fs");
const { createHash } = require("node:crypto");

const mcp = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
const args = mcp?.mcpServers?.context7?.args;
if (!Array.isArray(args) || !args.some((arg) => /^@upstash\/context7-mcp@\d+\.\d+\.\d+$/.test(arg))) {
  throw new Error("context7 must be pinned to one exact npm version");
}
if (args.some((arg) => /@latest\b/.test(arg))) {
  throw new Error("floating @latest dependency in .mcp.json");
}

const codexConfig = fs.readFileSync(".codex/config.toml", "utf8");
function tomlSection(name) {
  const lines = [];
  let active = false;
  for (const line of codexConfig.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      active = header[1] === name;
      continue;
    }
    if (active && line.trim() && !line.trimStart().startsWith("#")) lines.push(line.trim());
  }
  return lines.sort();
}
const agentConfig = tomlSection("agents");
if (JSON.stringify(agentConfig) !== JSON.stringify([
  "enabled = true",
  "max_concurrent_threads_per_session = 3",
])) {
  throw new Error(`canonical multi-agent settings drifted: ${JSON.stringify(agentConfig)}`);
}
const context7Config = tomlSection("mcp_servers.context7");
if (JSON.stringify(context7Config) !== JSON.stringify([
  'args = ["-y", "@upstash/context7-mcp@4.0.2"]',
  'command = "npx"',
])) {
  throw new Error(`canonical Context7 settings drifted: ${JSON.stringify(context7Config)}`);
}

// Project hooks are executable by design, but their configuration-side surface is an exact list:
// no inline shell, arbitrary script path, duplicate policy evaluation or newly-added hook becomes
// trusted without changing this audit. Secret/partition guards and all PR-review gates remain
// consolidated behind canonical dispatches. This does not authenticate hook source after project
// trust. It keeps the tracked configuration narrow, deterministic and reviewable.
const expectedHookDispatches = {
  PreToolUse: [
    ["^(?:Read|Edit|Write|Bash|apply_patch|exec_command|shell|shell_command)$", 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" pre-tool-guards', "Checking secrets and partition safety", 10],
    ["^(?:Bash|exec_command|shell|shell_command|mcp__.+(?:merge_pull_request|enable_auto_merge|enable_pull_request_auto_merge|enqueue_pull_request))$", 'bash "$(git rev-parse --show-toplevel)/tools/agent-hooks/require-pr-gates.sh"', "Checking current PR review evidence", 600],
  ],
  SessionStart: [["^(?:startup|resume|clear|compact)$", 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" capabilities', "Detecting repository capabilities", 15]],
  SubagentStart: [[undefined, 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" subagent-context', "Loading repository subagent boundaries", 10]],
  UserPromptSubmit: [[undefined, 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" prompt-context', "Checking whether crash-triage context applies", 10]],
  Stop: [[undefined, 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" stop-logic-tests', "Running changed host logic tests", 600]],
  PostToolUse: [["^(?:Edit|Write|apply_patch)$", 'python3 "$(git rev-parse --show-toplevel)/tools/agent-hooks/agent_hook.py" format', "Formatting edited C and C++ files", 30]],
};
const hooksFile = JSON.parse(fs.readFileSync(".codex/hooks.json", "utf8"));
const hooks = hooksFile?.hooks;
if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
  throw new Error("canonical Codex hook configuration must define hook dispatches");
}
const actualEvents = Object.keys(hooks).sort();
const expectedEvents = Object.keys(expectedHookDispatches).sort();
if (JSON.stringify(actualEvents) !== JSON.stringify(expectedEvents)) {
  throw new Error(`canonical Codex hook event set drifted: ${JSON.stringify(actualEvents)}`);
}
for (const [event, expectedGroups] of Object.entries(expectedHookDispatches)) {
  const groups = hooks[event];
  if (!Array.isArray(groups) || groups.length !== expectedGroups.length) {
    throw new Error(`${event} Codex hook dispatch count drifted`);
  }
  for (let index = 0; index < expectedGroups.length; index += 1) {
    const group = groups[index];
    const [expectedMatcher, expectedCommand, expectedStatus, expectedTimeout] = expectedGroups[index];
    if ((group?.matcher ?? undefined) !== expectedMatcher) {
      throw new Error(`${event}[${index}] Codex hook matcher drifted`);
    }
    if (!Array.isArray(group?.hooks) || group.hooks.length !== 1) {
      throw new Error(`${event}[${index}] must contain exactly one canonical Codex hook`);
    }
    const hook = group.hooks[0];
    if (hook?.type !== "command" || hook?.command !== expectedCommand ||
        hook?.statusMessage !== expectedStatus || hook?.timeout !== expectedTimeout) {
      throw new Error(`${event}[${index}] unapproved canonical Codex hook definition`);
    }
  }
}

const routeDocs = ["docs/ARCHITECTURE.md", ".agents/skills/device-triage/SKILL.md"];
for (const file of routeDocs) {
  const text = fs.readFileSync(file, "utf8");
  if (/\/(?:diag|coredump)\?clear(?:=1)?/.test(text)) {
    throw new Error(`${file} still documents evidence deletion as a GET query side effect`);
  }
  for (const route of ["POST /diag/clear", "POST /coredump/clear"]) {
    if (!text.includes(route)) throw new Error(`${file} does not document ${route}`);
  }
}
if (!fs.readFileSync("docs/ARCHITECTURE.md", "utf8").includes("trusted-LAN route count of 36")) {
  throw new Error("docs/ARCHITECTURE.md no longer documents the exact trusted-LAN route budget");
}
const credentialWrapperPath = "scripts/gh-with-git-credentials.sh";
const credentialWrapperStat = fs.lstatSync(credentialWrapperPath);
if (!credentialWrapperStat.isFile() || (credentialWrapperStat.mode & 0o111) === 0) {
  throw new Error("canonical GitHub credential wrapper is missing or not executable");
}
const credentialWrapper = fs.readFileSync(credentialWrapperPath, "utf8");
const credentialWrapperMarkers = [
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
];
const reviewedCredentialWrapperSha256 =
  "dfc430f5848ca8788e72fc4f696ea069984abea20bba08c62987d26425323e8b";
const credentialWrapperSha256 = createHash("sha256").update(credentialWrapper).digest("hex");
const isolatedCwdMentions = credentialWrapper.match(/cd "\$config_dir" \|\| exit 1/g) ?? [];
const credentialStoreMentions = credentialWrapper.match(/[.]git-credentials/g) ?? [];
if (!credentialWrapperMarkers.every((marker) => credentialWrapper.includes(marker)) ||
    isolatedCwdMentions.length !== 1 ||
    credentialStoreMentions.length !== 1 ||
    credentialWrapperSha256 !== reviewedCredentialWrapperSha256) {
  throw new Error("canonical GitHub credential wrapper no longer keeps credentials transient");
}
const httpServer = fs.readFileSync("main/http_server.cpp", "utf8");
if (!/current exact total to 36[\s\S]{0,80}cfg\.max_uri_handlers\s*=\s*36;/.test(httpServer)) {
  throw new Error("http_server.cpp has drifted from the documented 36-handler trusted-LAN surface");
}

const funding = fs.readFileSync(".github/FUNDING.yml", "utf8");
const activeFunding = /^\s*(?:github|patreon|open_collective|ko_fi|tidelift|community_bridge|liberapay|issuehunt|lfx_crowdfunding|polar|buy_me_a_coffee|thanks_dev|custom)\s*:/m.test(funding);
const fundingMarker = "No funding account is currently configured";
for (const file of ["docs/REPORTING.md", ".github/ISSUE_TEMPLATE/bug_report.yml"]) {
  const normalized = fs.readFileSync(file, "utf8").replaceAll("**", "").replace(/\s+/g, " ");
  if (!activeFunding && !normalized.includes(fundingMarker)) {
    throw new Error(`${file} claims or implies a Sponsor button while FUNDING.yml is disabled`);
  }
  if (activeFunding && normalized.includes(fundingMarker)) {
    throw new Error(`${file} still says funding is disabled although FUNDING.yml has an active key`);
  }
}

// Public documentation must not send readers to numbered work items in the private predecessor
// repository, nor let bare `#N` prose silently auto-link to unrelated issues in this fresh public
// tracker. Section anchors are deliberately exempt: their `#` is immediately preceded by `](` or
// by a word character in `file.md#anchor`.
const publicMarkdown = [
  "README.md",
  "CONTRIBUTING.md",
  "test/README.md",
  ...fs.readdirSync("docs").filter((file) => file.endsWith(".md")).map((file) => `docs/${file}`),
];
for (const file of publicMarkdown) {
  const text = fs.readFileSync(file, "utf8");
  if (/https:\/\/github\.com\/0Bu\/daikin-altherma-esp32\/(?:issues|pull)\/\d+/.test(text)) {
    throw new Error(`${file} links to a numbered private-predecessor work item`);
  }
  if (/(?<!\]\()(?<!\w)#\d{1,3}\b/.test(text)) {
    throw new Error(`${file} contains a bare predecessor #N reference that GitHub would mis-link`);
  }
}
if (!fs.readFileSync("CONTRIBUTING.md", "utf8").includes("legacy-209")) {
  throw new Error("CONTRIBUTING.md does not explain the legacy-N provenance notation");
}

const security = fs.readFileSync("docs/SECURITY.md", "utf8");
if (/\bshreds?\b/i.test(security)) {
  throw new Error("docs/SECURITY.md overclaims secure erasure of the transient signing-key file");
}
if (!security.includes("rm -f ota_signing_key.pem")) {
  throw new Error("docs/SECURITY.md does not name the actual signing-key workspace cleanup");
}
const buildWorkflow = fs.readFileSync(".github/workflows/build.yml", "utf8");
if (!/if: always\(\)[\s\S]{0,160}run: rm -f ota_signing_key\.pem/.test(buildWorkflow)) {
  throw new Error("build workflow no longer removes the transient signing-key file on every exit");
}
JS

# Keep this audit on the runner's declared Node + Git baseline. In particular, do not add an
# undeclared ripgrep dependency: ubuntu-24.04 does not preinstall `rg`, and treating exit 127 like
# "pattern absent" produces a misleading documentation failure instead of auditing the tree.
node <<'JS'
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function read(file) {
  return fs.readFileSync(file, "utf8");
}
function requireText(file, needle, message) {
  if (!read(file).includes(needle)) throw new Error(message);
}

for (const file of ["docs/README.md", "docs/ARCHITECTURE.md", "docs/DESIGN.md"]) {
  requireText(
    file,
    "update X10A and HomeHub in separate requests",
    `${file} does not document the mixed /set_hp durability-domain rejection`,
  );
}
for (const file of ["docs/README.md", "docs/ARCHITECTURE.md"]) {
  if (!/(?:atomic.*`link`|`link`.*atomic)/i.test(read(file))) {
    throw new Error(`${file} does not describe the atomic X10A link blob`);
  }
}

for (const file of ["docs/SECURITY.md", "main/ota_update.cpp"]) {
  const text = read(file);
  if (/STA online, or the setup portal (?:if|when).*credentials/.test(text)) {
    throw new Error("OTA health wording still derives a recovery surface from stored credentials");
  }
  if (!/portal[\s\S]{0,100}actually[\s\S]{0,20}running/.test(text)) {
    throw new Error(`${file} does not bind OTA health to an actually-running provisioning portal`);
  }
}

const fixtureFiles = execFileSync("git", ["ls-files", "-z", "--", "test", "tools"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const fixtures = [];
for (const file of fixtureFiles) {
  if (!fs.existsSync(file)) continue; // Deletions are absent from the working tree before commit.
  const raw = fs.readFileSync(file);
  if (raw.includes(0)) continue; // Match ripgrep's default binary-file behavior.
  fixtures.push({ file, text: raw.toString("utf8") });
}

function matches(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const out = [];
  for (const { file, text } of fixtures) {
    const re = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(re)) {
      const line = text.slice(0, match.index).split("\n").length;
      out.push(`${file}:${line}: ${match[0]}`);
    }
  }
  return out;
}
function rejectFixture(pattern, message) {
  const found = matches(pattern);
  if (found.length === 0) return;
  console.error(message);
  for (const line of found) console.error(line);
  process.exit(1);
}

// Never put a private denylist in this tracked public audit: that would publish the very
// installation values it is meant to catch. Instead, pin fixture *shapes* and a small explicit set
// of reviewable synthetic literals. A maintainer's exact private-value scan stays outside Git.
function rejectUnexpectedLiteral(pattern, allowed, message) {
  const found = [];
  for (const { file, text } of fixtures) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(re)) {
      if (allowed.has(match[1])) continue;
      const line = text.slice(0, match.index).split("\n").length;
      found.push(`${file}:${line}: unapproved fixture literal`);
    }
  }
  if (found.length === 0) return;
  console.error(message);
  for (const line of found) console.error(line);
  process.exit(1);
}

rejectUnexpectedLiteral(
  /(?:\b(?:wifi_)?ssid\b|["'](?:wifi_)?ssid["'])\s*(?:=|:)\s*["'`]([^"'`]*)["'`]/i,
  new Set(["", "ExampleNet", "fallback", "home", "test-wifi", "net", "new-net", " my wifi ", "sentinel"]),
  "WiFi fixture SSIDs must use one of the reviewed synthetic literals",
);
rejectUnexpectedLiteral(
  /\b(?:ref_temp_name|circulation_name)\b\s*=\s*["']([^"']*)["']/i,
  new Set(["", "Living room", "DHW circulation", "DHW circulation pump", "Example sensor"]),
  "source-name fixtures must use reviewed generic labels",
);
rejectUnexpectedLiteral(
  /(?:\b(?:reference_temperature|circulation_source)\b|["'](?:reference_temperature|circulation_source)["'])\s*:\s*\{[^{}]{0,320}?(?:\bname\b|["']name["'])\s*:\s*["']([^"']*)["']/i,
  new Set(["", "Example room", "Example circulation pump", "Living room", "DHW circulation", "DHW circulation pump", "stale name"]),
  "UI source-name fixtures must use reviewed generic labels",
);
rejectUnexpectedLiteral(
  /(?:\b(?:weather_)?(?:latitude|longitude)(?:_e6)?\b|["'](?:latitude|longitude)["'])\s*(?:=|:|==)\s*["']?([+-]?\d+(?:\.\d+)?)/i,
  new Set(["0", "12.345678", "23.456789", "12345678", "23456789"]),
  "coordinate fixtures must use the canonical synthetic pair or a disabled zero",
);
rejectFixture(
  /(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)/,
  "RFC1918 address found in a fixture; use an IANA documentation address",
);
rejectFixture(
  /shelly[a-z0-9-]*-[0-9a-f]{6,}|homehub-524288-[0-9]/i,
  "serial-like device identifier found in a fixture; use a named synthetic fixture",
);
rejectFixture(
  /(?:\b(?:device_?id|serial|mac|bssid)\b|["'](?:device_?id|serial|mac|bssid)["'])\s*(?:=|:)\s*["'`]?[0-9a-f]{12}\b/i,
  "compact hardware identifier found in a fixture; use a named synthetic fixture",
);

const invalidMacs = [];
for (const { file, text } of fixtures) {
  for (const match of text.matchAll(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi)) {
    const first = Number.parseInt(match[0].slice(0, 2), 16);
    if ((first & 0x03) === 0x02) continue; // locally administered + unicast
    const line = text.slice(0, match.index).split("\n").length;
    invalidMacs.push(`${file}:${line}: non-synthetic MAC fixture ${match[0]}`);
  }
}
if (invalidMacs.length > 0) {
  for (const line of invalidMacs) console.error(line);
  process.exit(1);
}

for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "tools/web_asset/vendor/LICENSE"]) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`${file} is missing or empty`);
  }
}
requireText("THIRD_PARTY_NOTICES.md", "Copyright (c) 2020 Raomin", "Raomin notice is missing");
requireText("THIRD_PARTY_NOTICES.md", "Apache-2.0.txt", "distributed Apache license is missing from notices");
requireText("README.md", "THIRD_PARTY_NOTICES.md", "README does not link the third-party notices");
JS

if git grep -nE -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -- . >/dev/null; then
  echo "private key material is tracked" >&2
  exit 1
fi

echo "Public-readiness audit passed: exact MCP version, canonical Codex configuration and hooks, public contracts, synthetic fixtures, notices, no tracked private key"
