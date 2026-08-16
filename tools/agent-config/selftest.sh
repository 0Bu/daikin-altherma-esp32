#!/usr/bin/env bash
# Mutation canaries for the canonical-only agent configuration contract.
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
  {
    printf '%s\n' \
      ".mcp.json" \
      ".codex/config.toml" \
      ".codex/hooks.json" \
      "AGENTS.md" \
      "scripts/gh-with-git-credentials.sh" \
      "tools/agent-config/safety-invariants.json"
    find "$ROOT/.codex/agents" "$ROOT/.agents/skills" -type f -print \
      | sed "s#^$ROOT/##"
  } | sort -u > "$list"
  while IFS= read -r relative; do
    [ -n "$relative" ] || continue
    mkdir -p "$dest/$(dirname "$relative")"
    cp "$ROOT/$relative" "$dest/$relative"
  done < "$list"
  rm "$list"
  git -C "$dest" init -q
  git -C "$dest" add .
}

run_gate() {
  AGENT_CONFIG_ROOT="$1" "$CHECK"
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

echo "== clean canonical contract =="
expect_pass "current canonical configuration passes"
fixture="$WORK/default-budget"
make_fixture "$fixture"
output="$(run_gate "$fixture" 2>&1)" || fail "default budget: clean fixture failed"
printf '%s' "$output" | grep -Eq 'canonical budget [0-9]+/24576 bytes' \
  || fail "default budget: canonical default is not 24576 bytes"
echo "  PASS  canonical default budget is 24576 bytes"
pass=$((pass + 1))

echo "== instruction budget and cutover boundary =="
fixture="$WORK/over-budget"
make_fixture "$fixture"
set +e
output="$(AGENT_CONFIG_ROOT="$fixture" AGENT_INSTRUCTIONS_BUDGET_BYTES=1 "$CHECK" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 1 ] || fail "over budget: expected exit 1, got $rc"
printf '%s' "$output" | grep -qF "over the 1-byte budget" || fail "over budget: no actionable error"
echo "  PASS  over-budget canonical instructions"
pass=$((pass + 1))

fixture="$WORK/tracked-claude"
make_fixture "$fixture"
mkdir -p "$fixture/.claude"
printf 'reintroduced\n' > "$fixture/.claude/canary.md"
git -C "$fixture" add .claude/canary.md
expect_failure "tracked .claude reintroduction" "$fixture" "tracked .claude content is forbidden"

fixture="$WORK/filesystem-claude"
make_fixture "$fixture"
mkdir -p "$fixture/.claude"
expect_failure "filesystem .claude reintroduction" "$fixture" "filesystem .claude content is forbidden"

fixture="$WORK/credential-wrapper-missing"
make_fixture "$fixture"
rm "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "missing canonical GitHub credential wrapper" "$fixture" "credential wrapper is missing"

fixture="$WORK/credential-wrapper-direct-read"
make_fixture "$fixture"
printf '%s\n' 'head -n1 ~/.git-credentials' >> "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "direct credential-store read in wrapper" "$fixture" "must not read a credential-store file directly"

fixture="$WORK/credential-wrapper-not-executable"
make_fixture "$fixture"
chmod -x "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "non-executable canonical GitHub credential wrapper" "$fixture" "credential wrapper is not executable"

fixture="$WORK/credential-wrapper-xtrace"
make_fixture "$fixture"
sed -i.bak 's/set +x/set -x/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper xtrace hardening drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-host"
make_fixture "$fixture"
sed -i.bak 's/only github.com is allowed/any host allowed/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper host binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-config"
make_fixture "$fixture"
sed -i.bak 's/GH_CONFIG_DIR="$config_dir" "$gh_bin"/GH_CONFIG_DIR="${GH_CONFIG_DIR:-}" "$gh_bin"/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper config isolation drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-binary"
make_fixture "$fixture"
sed -i.bak "s#GH_BINARY_CANDIDATES='/opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh'#GH_BINARY_CANDIDATES='/tmp/gh'#" \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper binary binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-bootstrap"
make_fixture "$fixture"
sed -i.bak 's/unset BASH_ENV ENV LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH/unset BASH_ENV ENV/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper bootstrap isolation drift" "$fixture" "credential wrapper contract drifted"

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

fixture="$WORK/subagent-identity"
make_fixture "$fixture"
subagent="$(find "$fixture/.codex/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
node - "$subagent" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^name\s*=.*$/m, 'name = "wrong_canary"'));
NODE
expect_failure "canonical subagent identity drift" "$fixture" "name must be"

fixture="$WORK/subagent-set-missing"
make_fixture "$fixture"
mv "$fixture/.codex/agents/doc-drift-checker.toml" "$fixture/removed-reviewer.toml"
expect_failure "missing canonical reviewer" "$fixture" "exactly the three mapped project reviewers"

fixture="$WORK/subagent-set-extra"
make_fixture "$fixture"
cp "$fixture/.codex/agents/doc-drift-checker.toml" "$fixture/.codex/agents/extra-reviewer.toml"
expect_failure "extra canonical reviewer" "$fixture" "exactly the three mapped project reviewers"

fixture="$WORK/subagent-sandbox"
make_fixture "$fixture"
subagent="$fixture/.codex/agents/doc-drift-checker.toml"
node - "$subagent" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"'));
NODE
expect_failure "canonical reviewer write access" "$fixture" "sandbox_mode must be read-only"

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

echo "== canonical hook dispatch =="
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

fixture="$WORK/codex-guard-command"
make_fixture "$fixture"
node - "$fixture/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.hooks.PreToolUse[0].hooks[0].command += " --runner codex";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Codex guard command drift" "$fixture" "hook command drifted"

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

echo "== canonical skills and metadata =="
fixture="$WORK/skill-set-missing"
make_fixture "$fixture"
mv "$fixture/.agents/skills/absence-review" "$fixture/removed-skill"
expect_failure "missing canonical skill" "$fixture" "canonical skill set must contain exactly"

fixture="$WORK/skill-set-extra"
make_fixture "$fixture"
mkdir -p "$fixture/.agents/skills/unreviewed-canary"
expect_failure "extra canonical skill" "$fixture" "canonical skill set must contain exactly"

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

fixture="$WORK/skill-empty-body"
make_fixture "$fixture"
skill="$fixture/.agents/skills/absence-review/SKILL.md"
node - "$skill" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const source = fs.readFileSync(file, "utf8");
const end = source.indexOf("\n---", 4);
fs.writeFileSync(file, source.slice(0, end + 4) + "\n");
NODE
expect_failure "canonical skill empty body" "$fixture" "empty instruction body"

fixture="$WORK/openai-metadata-missing"
make_fixture "$fixture"
mv "$fixture/.agents/skills/diagnostic-evidence-review/agents/openai.yaml" "$fixture/removed-openai.yaml"
expect_failure "missing OpenAI metadata" "$fixture" "exactly the three reviewed openai.yaml files"

fixture="$WORK/openai-metadata-extra"
make_fixture "$fixture"
mkdir -p "$fixture/.agents/skills/absence-review/agents"
cp "$fixture/.agents/skills/ui-use-case-review/agents/openai.yaml" \
  "$fixture/.agents/skills/absence-review/agents/openai.yaml"
expect_failure "extra OpenAI metadata" "$fixture" "exactly the three reviewed openai.yaml files"

fixture="$WORK/openai-metadata-contract"
make_fixture "$fixture"
metadata="$fixture/.agents/skills/ui-use-case-review/agents/openai.yaml"
node - "$metadata" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^  short_description:.*\n/m, ""));
NODE
expect_failure "invalid OpenAI metadata contract" "$fixture" "interface keys must be exactly"

fixture="$WORK/openai-metadata-prompt"
make_fixture "$fixture"
metadata="$fixture/.agents/skills/ui-use-case-review/agents/openai.yaml"
node - "$metadata" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("$ui-use-case-review", "$wrong-canary"));
NODE
expect_failure "OpenAI metadata skill invocation drift" "$fixture" "default_prompt must invoke"

echo "== AGENTS.md safety invariants =="
fixture="$WORK/safety-count"
make_fixture "$fixture"
node - "$fixture/tools/agent-config/safety-invariants.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const contract = JSON.parse(fs.readFileSync(file, "utf8"));
contract.invariants.pop();
fs.writeFileSync(file, JSON.stringify(contract, null, 2) + "\n");
NODE
expect_failure "safety invariant count drift" "$fixture" "exactly 13 invariants"

fixture="$WORK/safety-invariant"
make_fixture "$fixture"
node - "$fixture/tools/agent-config/safety-invariants.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const contract = JSON.parse(fs.readFileSync(file, "utf8"));
contract.invariants[0].pattern = "SELFTEST_INVARIANT_THAT_MUST_NOT_EXIST";
fs.writeFileSync(file, JSON.stringify(contract, null, 2) + "\n");
NODE
expect_failure "missing AGENTS.md safety invariant" "$fixture" "is missing from AGENTS.md"

echo
echo "agent-config selftest: all $pass canaries caught"
