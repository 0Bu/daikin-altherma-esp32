#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node <<'JS'
const fs = require("node:fs");

const mcp = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
const args = mcp?.mcpServers?.context7?.args;
if (!Array.isArray(args) || !args.some((arg) => /^@upstash\/context7-mcp@\d+\.\d+\.\d+$/.test(arg))) {
  throw new Error("context7 must be pinned to one exact npm version");
}
if (args.some((arg) => /@latest\b/.test(arg))) {
  throw new Error("floating @latest dependency in .mcp.json");
}

const settings = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
const grants = settings?.permissions?.allow ?? [];
if (!Array.isArray(grants) || grants.length !== 0) {
  throw new Error(
    `tracked Claude settings must auto-grant no shell commands; found: ${JSON.stringify(grants)}`,
  );
}

// Project hooks are executable by design, but their settings-side surface is an exact local list:
// no inline shell, arbitrary script path or newly-added hook becomes trusted without changing this
// audit. This does not claim to authenticate a hook's source after project trust; it makes the
// tracked settings contract narrow and reviewable.
const allowedHookCommands = new Set([
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard-secrets.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/guard-partitions.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-project-review.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-feature-docs.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-domain-review.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-schematic-review.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-ui-use-case-review.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-absence-review.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/require-ui-gif.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/report-capabilities.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/clang-format-edit.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/run-logic-tests.sh"',
  'bash "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/crash-triage-context.sh"',
]);
const seenHookCommands = new Set();
for (const groups of Object.values(settings?.hooks ?? {})) {
  if (!Array.isArray(groups)) throw new Error("Claude hook groups must be arrays");
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) throw new Error("Claude hook entry is missing its hooks array");
    for (const hook of group.hooks) {
      if (hook?.type !== "command" || !allowedHookCommands.has(hook?.command)) {
        throw new Error(`unapproved tracked Claude hook command: ${JSON.stringify(hook?.command)}`);
      }
      seenHookCommands.add(hook.command);
    }
  }
}
for (const command of allowedHookCommands) {
  if (!seenHookCommands.has(command)) throw new Error(`required Claude hook is missing: ${command}`);
}

const routeDocs = [".claude/CLAUDE.md", ".claude/skills/device-triage/SKILL.md"];
for (const file of routeDocs) {
  const text = fs.readFileSync(file, "utf8");
  if (/\/(?:diag|coredump)\?clear(?:=1)?/.test(text)) {
    throw new Error(`${file} still documents evidence deletion as a GET query side effect`);
  }
  for (const route of ["POST /diag/clear", "POST /coredump/clear"]) {
    if (!text.includes(route)) throw new Error(`${file} does not document ${route}`);
  }
}
if (!fs.readFileSync(".claude/CLAUDE.md", "utf8").includes("trusted-LAN route count (36)")) {
  throw new Error(".claude/CLAUDE.md has drifted from the 36-handler trusted-LAN surface");
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

echo "Public-readiness audit passed: exact MCP version, zero tracked shell auto-grants, exact local hook list, public contracts, synthetic fixtures, notices, no tracked private key"
