#!/usr/bin/env bash
# Mutation canaries for the runner-neutral instruction/mapping/parity contract.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/run-agent-instructions-budget.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0

fail() { echo "agent-config selftest: $1" >&2; exit 1; }

make_fixture() {
  local dest="$1" list="$1/files.txt" relative
  rm -rf "$dest"
  mkdir -p "$dest"
  node - "$ROOT/.codex/migration-manifest.json" > "$list" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const files = new Set([
  ".mcp.json",
  ".codex/migration-manifest.json",
  "tools/agent-config/safety-invariants.json",
  manifest.canonical_instructions,
]);
for (const entry of manifest.entries) {
  files.add(entry.source);
  for (const target of entry.targets) files.add(target);
}
process.stdout.write([...files].sort().join("\n") + "\n");
NODE
  while IFS= read -r relative; do
    [ -n "$relative" ] || continue
    mkdir -p "$dest/$(dirname "$relative")"
    cp "$ROOT/$relative" "$dest/$relative"
  done < "$list"
  git -C "$ROOT" ls-files -- .claude > "$dest/tracked.txt" 2>/dev/null \
    || fail "could not enumerate tracked .claude files"
}

run_gate() {
  AGENT_CONFIG_ROOT="$1" AGENT_CONFIG_TRACKED_FILES_FILE="$1/tracked.txt" "$CHECK"
}

expect_pass() {
  local name="$1" fixture="$WORK/$1"
  make_fixture "$fixture"
  run_gate "$fixture" >/dev/null 2>&1 || fail "$name: clean fixture failed"
  echo "  PASS  $name"
  pass=$((pass + 1))
}

expect_failure() {
  local name="$1" fixture="$2" needle="$3" output rc
  set +e
  output="$(run_gate "$fixture" 2>&1)"; rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "$name: mutated fixture passed"
  printf '%s' "$output" | grep -qF "$needle" || fail "$name: failure did not mention '$needle'"
  echo "  PASS  $name"
  pass=$((pass + 1))
}

echo "== clean contract =="
expect_pass "current mapping passes"
fixture="$WORK/default-budget"
make_fixture "$fixture"
output="$(run_gate "$fixture" 2>&1)" || fail "default budget: clean fixture failed"
printf '%s' "$output" | grep -Eq 'canonical budget [0-9]+/24576 bytes' \
  || fail "default budget: canonical default is not 24576 bytes"
echo "  PASS  canonical default budget is 24576 bytes"
pass=$((pass + 1))

echo "== instruction budget =="
fixture="$WORK/over-budget"
make_fixture "$fixture"
set +e
output="$(AGENT_CONFIG_ROOT="$fixture" AGENT_CONFIG_TRACKED_FILES_FILE="$fixture/tracked.txt" \
  AGENT_INSTRUCTIONS_BUDGET_BYTES=1 "$CHECK" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 1 ] || fail "over budget: expected exit 1, got $rc"
printf '%s' "$output" | grep -qF "over the 1-byte budget" || fail "over budget: no actionable error"
echo "  PASS  over-budget canonical instructions"
pass=$((pass + 1))

echo "== fail-closed mapping =="
fixture="$WORK/missing-target"
make_fixture "$fixture"
target="$(node - "$fixture/.codex/migration-manifest.json" <<'NODE'
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(m.entries.find((entry) => entry.status !== "deprecated").targets[0]);
NODE
)"
mv "$fixture/$target" "$fixture/$target.missing"
expect_failure "missing declared target" "$fixture" "target for"

fixture="$WORK/unmapped-legacy"
make_fixture "$fixture"
printf '.claude/unmapped-canary.sh\n' >> "$fixture/tracked.txt"
expect_failure "unmapped tracked legacy file" "$fixture" "absent from migration manifest"

fixture="$WORK/duplicate-source"
make_fixture "$fixture"
node - "$fixture/.codex/migration-manifest.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.entries.push(structuredClone(manifest.entries[0]));
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
NODE
expect_failure "duplicate legacy mapping" "$fixture" "more than once"

fixture="$WORK/legacy-source-fingerprint"
make_fixture "$fixture"
printf '\n# legacy source drift canary\n' >> "$fixture/.claude/skills/device-triage/SKILL.md"
expect_failure "unreviewed legacy source drift" "$fixture" "reviewed legacy source tree fingerprint drifted"

echo "== parsed Codex configuration =="
fixture="$WORK/invalid-config-toml"
make_fixture "$fixture"
printf '%s\n' '[broken' >> "$fixture/.codex/config.toml"
expect_failure "invalid canonical config TOML" "$fixture" "not valid TOML"

fixture="$WORK/invalid-agent-toml"
make_fixture "$fixture"
subagent="$(find "$fixture/.codex/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
printf '%s\n' '[broken' >> "$subagent"
expect_failure "invalid canonical subagent TOML" "$fixture" "not valid TOML"

fixture="$WORK/subagent-model-pin"
make_fixture "$fixture"
subagent="$(find "$fixture/.codex/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
printf '%s\n' 'model = "canary"' >> "$subagent"
expect_failure "canonical subagent model pin" "$fixture" "must not pin a model"

fixture="$WORK/context7-pin"
make_fixture "$fixture"
node - "$fixture/.codex/config.toml" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("@upstash/context7-mcp@4.0.2", "@upstash/context7-mcp@latest"));
NODE
expect_failure "unpinned Context7 MCP" "$fixture" "must stay pinned"

fixture="$WORK/invalid-compatible-mcp"
make_fixture "$fixture"
printf '%s\n' '{' > "$fixture/.mcp.json"
expect_failure "invalid compatible MCP JSON" "$fixture" ".mcp.json is not valid JSON"

fixture="$WORK/compatible-context7-pin"
make_fixture "$fixture"
node - "$fixture/.mcp.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.mcpServers.context7.args[1] = "@upstash/context7-mcp@latest";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "compatible Context7 pin drift" "$fixture" "must exactly match"

fixture="$WORK/hooks-disabled"
make_fixture "$fixture"
printf '%s\n' '[features]' 'hooks = false' >> "$fixture/.codex/config.toml"
expect_failure "disabled Codex hooks" "$fixture" "hooks must not be disabled"

echo "== hook dispatch and compatibility adapters =="
fixture="$WORK/codex-guard-dispatch"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[0].matcher = "Read";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Codex guard dispatch drift" "$fixture" "hook matcher drifted"

fixture="$WORK/codex-guard-async"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[0].hooks[0].async = true;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "asynchronous Codex guard" "$fixture" "must not be async"

fixture="$WORK/codex-pr-timeout"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[1].hooks[0].timeout = 60;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Codex merge-hook timeout drift" "$fixture" "hook timeout drifted"

fixture="$WORK/codex-pr-matcher-unanchored"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[1].matcher = config.hooks.PreToolUse[1].matcher.replace(/\$$/, "");
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "unanchored Codex aggregate matcher" "$fixture" "hook matcher drifted"

fixture="$WORK/codex-lifecycle-dispatch"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
delete config.hooks.Stop;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Codex lifecycle dispatch drift" "$fixture" "event set drifted"

fixture="$WORK/codex-stop-timeout"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.Stop[0].hooks[0].timeout = 540;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Codex Stop-hook timeout drift" "$fixture" "hook timeout drifted"

fixture="$WORK/claude-pr-dispatch"
make_fixture "$fixture"
node - "$fixture/.claude/settings.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[1].matcher = "Bash";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Claude aggregate dispatch drift" "$fixture" "hook matcher drifted"

fixture="$WORK/claude-pr-matcher-unanchored"
make_fixture "$fixture"
node - "$fixture/.claude/settings.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[1].matcher = config.hooks.PreToolUse[1].matcher.replace(/\$$/, "");
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "unanchored Claude aggregate matcher" "$fixture" "hook matcher drifted"

fixture="$WORK/claude-guard-adapter"
make_fixture "$fixture"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$fixture/.claude/hooks/guard-secrets.sh"
chmod +x "$fixture/.claude/hooks/guard-secrets.sh"
expect_failure "Claude guard adapter drift" "$fixture" "thin compatibility adapter drifted"

fixture="$WORK/claude-prompt-adapter"
make_fixture "$fixture"
printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$fixture/.claude/hooks/crash-triage-context.sh"
chmod +x "$fixture/.claude/hooks/crash-triage-context.sh"
expect_failure "Claude prompt lifecycle adapter drift" "$fixture" "thin compatibility adapter drifted"

fixture="$WORK/claude-stop-adapter-shebang"
make_fixture "$fixture"
sed '1d' "$fixture/.claude/hooks/run-logic-tests.sh" > "$fixture/.claude/hooks/run-logic-tests.sh.tmp"
mv "$fixture/.claude/hooks/run-logic-tests.sh.tmp" "$fixture/.claude/hooks/run-logic-tests.sh"
chmod +x "$fixture/.claude/hooks/run-logic-tests.sh"
expect_failure "Claude Stop lifecycle adapter shebang" "$fixture" "executable bash shebang"

echo "== skill and safety parity =="
fixture="$WORK/skill-name"
make_fixture "$fixture"
skill="$(find "$fixture/.agents/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | sort | head -n1)"
node - "$skill" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^name: .+$/m, "name: wrong-canary"));
NODE
expect_failure "canonical skill name drift" "$fixture" "frontmatter name mismatch"

fixture="$WORK/skill-frontmatter"
make_fixture "$fixture"
skill="$(find "$fixture/.agents/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | sort | head -n1)"
node - "$skill" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^description:/m, "model: canary\ndescription:"));
NODE
expect_failure "canonical skill runner-only frontmatter" "$fixture" "frontmatter keys must be exactly name and description"

fixture="$WORK/skill-invalid-yaml"
make_fixture "$fixture"
skill="$(find "$fixture/.agents/skills" -mindepth 2 -maxdepth 2 -name SKILL.md | sort | head -n1)"
node - "$skill" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^description:/m, ": bad\ndescription:"));
NODE
expect_failure "canonical skill invalid YAML" "$fixture" "invalid restricted YAML frontmatter"

fixture="$WORK/openai-metadata"
make_fixture "$fixture"
metadata="$(find "$fixture/.agents/skills" -path '*/agents/openai.yaml' | sort | head -n1)"
printf '\n# parity canary\n' >> "$metadata"
expect_failure "OpenAI metadata drift" "$fixture" "OpenAI metadata drifted"

fixture="$WORK/subagent-identity"
make_fixture "$fixture"
subagent="$(find "$fixture/.codex/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
node - "$subagent" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^name\s*=.*$/m, 'name = "wrong_canary"'));
NODE
expect_failure "canonical subagent identity drift" "$fixture" "name must be"

fixture="$WORK/safety-invariant"
make_fixture "$fixture"
node - "$fixture/tools/agent-config/safety-invariants.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const contract = JSON.parse(fs.readFileSync(file, "utf8"));
contract.invariants.push({ id: "selftest-missing", pattern: "SELFTEST_INVARIANT_THAT_MUST_NOT_EXIST" });
fs.writeFileSync(file, JSON.stringify(contract, null, 2) + "\n");
NODE
expect_failure "missing cross-runner safety invariant" "$fixture" "selftest-missing"

echo
echo "agent-config selftest: all $pass canaries caught"
