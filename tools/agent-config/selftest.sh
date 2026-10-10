#!/usr/bin/env bash
# Mutation canaries for the canonical-only agent configuration contract.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/run-agent-instructions-budget.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
pass=0

fail() { echo "agent-config selftest: $1" >&2; exit 1; }

TEMPLATE="$WORK/__template__"
mkdir -p "$TEMPLATE"
{
  printf '%s\n' \
    ".mcp.json" \
    ".agents/hooks.json" \
    "AGENTS.md" \
    "scripts/agent-python.sh" \
    "scripts/gh-with-git-credentials.sh" \
    "tools/agent-config/safety-invariants.json"
  git -c core.fsmonitor=false -C "$ROOT" ls-files -- '*/AGENTS.md'
  find "$ROOT/.codex" -type f -print | sed "s#^$ROOT/##"
  find "$ROOT/.agents/agents" "$ROOT/.agents/skills" -type f -print \
    | sed "s#^$ROOT/##"
} | sort -u > "$WORK/__template_files.txt"
while IFS= read -r relative; do
  [ -n "$relative" ] || continue
  mkdir -p "$TEMPLATE/$(dirname "$relative")"
  cp "$ROOT/$relative" "$TEMPLATE/$relative"
done < "$WORK/__template_files.txt"
rm "$WORK/__template_files.txt"
git -C "$TEMPLATE" init -q
git -C "$TEMPLATE" add .

make_fixture() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$TEMPLATE/." "$dest/"
}

run_gate() {
  AGENT_CONFIG_ROOT="$1" "$CHECK"
}

expect_pass() {
  local name="$1" fixture="$WORK/$1"
  make_fixture "$fixture"
  local output
  output="$(run_gate "$fixture" 2>&1)" || fail "$name: clean fixture failed: $output"
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
output="$(run_gate "$fixture" 2>&1)" || fail "default budget: clean fixture failed: $output"
printf '%s' "$output" | grep -Eq 'canonical budget [0-9]+/24576 bytes' \
  || fail "default budget: canonical default is not 24576 bytes"
echo "  PASS  canonical default budget is 24576 bytes"
pass=$((pass + 1))
printf '%s' "$output" | grep -Eq 'effective chain main/www [0-9]+/32768 bytes' \
  || fail "scoped budget: main/www effective chain was not reported"
echo "  PASS  effective scoped instruction chains are reported"
pass=$((pass + 1))

echo "== interpreter preflight =="
checked_python="$("$ROOT/scripts/agent-python.sh" --resolve)"
AGENT_PYTHON="$checked_python" "$ROOT/scripts/agent-python.sh" -c 'import sys, tomllib; assert sys.version_info >= (3, 11)' \
  || fail "supported explicit interpreter failed"
echo "  PASS  supported AGENT_PYTHON override"
pass=$((pass + 1))
mkdir -p "$WORK/interpreter-bin"
printf '#!/bin/sh\nexit 1\n' > "$WORK/interpreter-bin/python3"
chmod +x "$WORK/interpreter-bin/python3"
set +e
output="$(AGENT_PYTHON="$WORK/interpreter-bin/python3" "$ROOT/scripts/agent-python.sh" --resolve 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] || fail "unsupported explicit interpreter was not rejected"
printf '%s' "$output" | grep -qF 'Python >= 3.11 with tomllib' || fail "interpreter diagnostic omitted required version"
echo "  PASS  unsupported AGENT_PYTHON fails with a version diagnostic"
pass=$((pass + 1))
ln -s "$checked_python" "$WORK/interpreter-bin/python3.11"
selected_python="$(PATH="$WORK/interpreter-bin:$PATH" "$ROOT/scripts/agent-python.sh" --resolve)"
[ "$selected_python" != "$WORK/interpreter-bin/python3" ] || fail "automatic selection chose unsupported default python3"
echo "  PASS  automatic interpreter selection skips unsupported default python3"
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

fixture="$WORK/effective-budget"
make_fixture "$fixture"
node - "$fixture/main/www/AGENTS.md" <<'NODE'
const fs = require("node:fs");
fs.appendFileSync(process.argv[2], "x".repeat(32768));
NODE
expect_failure "oversized scoped instruction chain" "$fixture" "effective instruction chain main/www"

fixture="$WORK/missing-scoped-instructions"
make_fixture "$fixture"
rm "$fixture/main/www/AGENTS.md"
expect_failure "missing tracked scoped instructions" "$fixture" "scoped instructions is missing"

for override in AGENTS.override.md main/nested/AGENTS.override.md; do
  fixture="$WORK/override-${override//\//-}"
  make_fixture "$fixture"
  mkdir -p "$fixture/$(dirname "$override")"
  printf 'Untracked override must not displace canonical policy.\n' > "$fixture/$override"
  expect_failure "untracked $override rejected" "$fixture" "AGENTS.override.md is forbidden"
done
fixture="$WORK/ignored-override"
make_fixture "$fixture"
printf 'AGENTS.override.md\n' > "$fixture/.gitignore"
printf 'Ignored override must not displace canonical policy.\n' > "$fixture/AGENTS.override.md"
expect_failure "ignored root instruction override rejected" "$fixture" "AGENTS.override.md is forbidden"
fixture="$WORK/ignored-nested-override"
make_fixture "$fixture"
printf '/ignored-scope/\n' > "$fixture/.gitignore"
mkdir -p "$fixture/ignored-scope"
printf 'Ignored nested override.\n' > "$fixture/ignored-scope/AGENTS.override.md"
expect_failure "ignored nested instruction override rejected" "$fixture" "AGENTS.override.md is forbidden"

fixture="$WORK/untracked-scoped-instructions"
make_fixture "$fixture"
mkdir -p "$fixture/local-scope"
printf 'Untracked scoped instructions count toward the effective budget.\n' > "$fixture/local-scope/AGENTS.md"
output="$(run_gate "$fixture" 2>&1)" || fail "valid untracked scoped instructions failed: $output"
printf '%s' "$output" | grep -Eq 'effective chain local-scope [0-9]+/32768 bytes' \
  || fail "valid untracked scoped instructions were omitted from the budget"
echo "  PASS  untracked scoped instructions are measured"
pass=$((pass + 1))
node - "$fixture/local-scope/AGENTS.md" <<'NODE'
require("node:fs").appendFileSync(process.argv[2], "x".repeat(32768));
NODE
expect_failure "oversized untracked scoped instructions rejected" "$fixture" "effective instruction chain local-scope"

fixture="$WORK/ignored-scoped-instructions"
make_fixture "$fixture"
printf '/ignored-scope/\n' > "$fixture/.gitignore"
mkdir -p "$fixture/ignored-scope"
node - "$fixture/ignored-scope/AGENTS.md" <<'NODE'
require("node:fs").writeFileSync(process.argv[2], "x".repeat(32768));
NODE
expect_failure "oversized ignored scoped instructions rejected" "$fixture" "effective instruction chain ignored-scope"

for source in AGENTS.md main/www/AGENTS.md; do
  fixture="$WORK/symlink-instructions-${source//\//-}"
  make_fixture "$fixture"
  mv "$fixture/$source" "$fixture/instructions-copy.md"
  ln -s "$fixture/instructions-copy.md" "$fixture/$source"
  expect_failure "symlinked $source rejected" "$fixture" "is not a regular file (symlink path)"
done

echo "== generated native registration =="
for generated in config.toml hooks.json agents/doc-drift-checker.toml generated.json; do
  fixture="$WORK/generated-${generated//\//-}"
  make_fixture "$fixture"
  printf '\n' >> "$fixture/.codex/$generated"
  expect_failure "native $generated drift" "$fixture" "generated Codex registration drift"
done
fixture="$WORK/missing-generated-hooks"
make_fixture "$fixture"
rm "$fixture/.codex/hooks.json"
expect_failure "missing native hook registration" "$fixture" "generated Codex registration drift"
fixture="$WORK/extra-native-reviewer"
make_fixture "$fixture"
cp "$fixture/.codex/agents/doc-drift-checker.toml" "$fixture/.codex/agents/unreviewed.toml"
expect_failure "extra native reviewer" "$fixture" "unregistered native reviewer files"
fixture="$WORK/generated-local-modification"
make_fixture "$fixture"
printf '\n# local customisation\n' >> "$fixture/.codex/config.toml"
set +e
output="$(AGENT_CONFIG_ROOT="$fixture" "$ROOT/scripts/agent-python.sh" "$ROOT/tools/agent-config/export-subagents.py" --write 2>&1)"; rc=$?
set -e
[ "$rc" -ne 0 ] || fail "regeneration overwrote a local modification"
printf '%s' "$output" | grep -qF 'refusing to overwrite locally modified or unowned file' || fail "regeneration lacked ownership diagnostic"
echo "  PASS  regeneration preserves locally modified adapter files"
pass=$((pass + 1))
fixture="$WORK/regenerate-source-change"
make_fixture "$fixture"
printf '\n# Maintained-source change\n' >> "$fixture/.agents/agents/doc-drift-checker.toml"
expect_failure "canonical reviewer change requires regeneration" "$fixture" "generated Codex registration drift"
AGENT_CONFIG_ROOT="$fixture" "$ROOT/scripts/agent-python.sh" "$ROOT/tools/agent-config/export-subagents.py" --write >/dev/null
run_gate "$fixture" >/dev/null || fail "regeneration did not restore canonical parity"
echo "  PASS  deliberate source change regenerates native registrations"
pass=$((pass + 1))
fixture="$WORK/generated-symlink"
make_fixture "$fixture"
mv "$fixture/.codex/hooks.json" "$fixture/hooks-copy.json"
ln -s ../hooks-copy.json "$fixture/.codex/hooks.json"
expect_failure "symlinked native registration" "$fixture" "generated path must not be a symlink"
"$ROOT/scripts/agent-python.sh" "$ROOT/tools/agent-config/test_doctor.py" \
  || fail "doctor metadata fixture checks failed"
echo "  PASS  doctor metadata remains separate from dispatch and trust authorization"
pass=$((pass + 1))
"$ROOT/scripts/agent-python.sh" "$ROOT/tools/agent-config/test_review.py" \
  || fail "read-only reviewer launcher checks failed"
echo "  PASS  reviewer launcher requests isolated read-only permissions without trust or live tools"
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
expect_failure "direct credential-store read in wrapper" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-not-executable"
make_fixture "$fixture"
chmod -x "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "non-executable canonical GitHub credential wrapper" "$fixture" "credential wrapper is not executable"

fixture="$WORK/credential-wrapper-symlink"
make_fixture "$fixture"
mv "$fixture/scripts/gh-with-git-credentials.sh" "$fixture/gh-wrapper-copy.sh"
ln -s ../gh-wrapper-copy.sh "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "symlinked canonical GitHub credential wrapper" "$fixture" "credential wrapper is not a regular file"

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
sed -i.bak 's#/usr/bin/env -i "${child_env\[@\]}"#/usr/bin/env "${child_env[@]}"#' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper config isolation drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-token-argv"
make_fixture "$fixture"
perl -0pi -e 's#/bin/bash -p -c "\$token_child_script"#GH_TOKEN="\$token" /bin/bash -p -c "\$token_child_script"#g' \
  "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "credential wrapper token argv exposure" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-pre-environment-token"
make_fixture "$fixture"
perl -0pi -e 's#\nrepo_override="\$\{GH_REPO:-\}"#\n/usr/bin/env "GH_TOKEN=\$token" /usr/bin/true\n\nrepo_override="\${GH_REPO:-}"#' \
  "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "credential wrapper pre-environment token exposure" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-child-env-token"
make_fixture "$fixture"
perl -0pi -e 's#^extra_child_env=\(\)$#extra_child_env=()\nchild_env[0]="GH_TOKEN=\$token"#m' \
  "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "credential wrapper child environment reassignment" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-extra-env-token"
make_fixture "$fixture"
perl -0pi -e 's#^extra_child_env=\(\)$#extra_child_env=()\nleak="GH_TOKEN=\$token"\nextra_child_env[0]="\$leak"#m' \
  "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "credential wrapper indirect test seam token exposure" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-child-script-token"
make_fixture "$fixture"
perl -0pi -e 's#exec "\$@"\x27#exec /usr/bin/env GH_TOKEN="\$token" "\$@"\x27#' \
  "$fixture/scripts/gh-with-git-credentials.sh"
expect_failure "credential wrapper child script token exposure" "$fixture" "token never enters argv"

fixture="$WORK/credential-wrapper-cwd"
make_fixture "$fixture"
sed -i.bak 's/cd "$config_dir" || exit 1/:/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper cwd isolation drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-physical-root"
make_fixture "$fixture"
sed -i.bak 's/\[ ! -L "$wrapper_source" \]/[ -n "$wrapper_source" ]/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper physical-root binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-git-replacements"
make_fixture "$fixture"
sed -i.bak 's/refs\/replace/refs\/heads/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper replacement-ref guard drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-no-replace-env"
make_fixture "$fixture"
sed -i.bak 's/"GIT_NO_REPLACE_OBJECTS=1"/"GIT_NO_REPLACE_OBJECTS=0"/g' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper replacement-object environment drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-body-nofollow"
make_fixture "$fixture"
sed -i.bak 's/os\.O_RDONLY | os\.O_NOFOLLOW/os.O_RDONLY/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper body-file no-follow drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-body-secret-path"
make_fixture "$fixture"
sed -i.bak 's/".ssh", //' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper body-file secret-path drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-body-hardlink"
make_fixture "$fixture"
sed -i.bak 's/info\.st_nlink != 1/False/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper body-file hardlink drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-body-owner"
make_fixture "$fixture"
sed -i.bak 's/info\.st_uid != os\.getuid()/False/' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper body-file owner drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-body-mode"
make_fixture "$fixture"
sed -i.bak 's/info\.st_mode & (stat\.S_IWGRP | stat\.S_IWOTH)/False/g' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper body-file mode drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-live-pr-head"
make_fixture "$fixture"
sed -i.bak 's#git/ref/heads/\$AGENT_GH_PR_CREATE_BRANCH#git/ref/heads/main#' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper live PR-head binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-created-pr-head"
make_fixture "$fixture"
sed -i.bak 's/--json headRefOid --jq \.headRefOid/--json baseRefOid --jq .baseRefOid/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper created PR-head postcondition drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-pr-revert"
make_fixture "$fixture"
sed -i.bak 's/|"pr revert"//' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper PR-revert guard drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-issue-transfer"
make_fixture "$fixture"
sed -i.bak 's/|"issue transfer"//' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper issue-transfer guard drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-spawner"
make_fixture "$fixture"
sed -i.bak 's/|"repo rename"//' "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper Git-spawner drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-helper"
make_fixture "$fixture"
sed -i.bak 's/credential-store --file "$credential_file" get/credential fill/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper helper binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-binary"
make_fixture "$fixture"
sed -i.bak "s#GH_BINARY_CANDIDATES='/opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh'#GH_BINARY_CANDIDATES='/tmp/gh'#" \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper binary binding drift" "$fixture" "credential wrapper contract drifted"

fixture="$WORK/credential-wrapper-bootstrap"
make_fixture "$fixture"
sed -i.bak 's/unset BASH_ENV ENV LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH/unset BASH_ENV ENV/' \
  "$fixture/scripts/gh-with-git-credentials.sh"
rm "$fixture/scripts/gh-with-git-credentials.sh.bak"
expect_failure "credential wrapper bootstrap isolation drift" "$fixture" "credential wrapper contract drifted"

echo "== parsed canonical agent configuration =="
fixture="$WORK/invalid-agent-toml"
make_fixture "$fixture"
subagent="$(find "$fixture/.agents/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
printf '%s\n' '[broken' >> "$subagent"
expect_failure "invalid canonical subagent TOML" "$fixture" "not valid TOML"

fixture="$WORK/subagent-model-pin"
make_fixture "$fixture"
subagent="$(find "$fixture/.agents/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
printf '%s\n' 'model = "canary"' >> "$subagent"
expect_failure "canonical subagent model pin" "$fixture" "must not pin a model"

fixture="$WORK/subagent-identity"
make_fixture "$fixture"
subagent="$(find "$fixture/.agents/agents" -maxdepth 1 -name '*.toml' | sort | head -n1)"
node - "$subagent" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^name\s*=.*$/m, 'name = "wrong_canary"'));
NODE
expect_failure "canonical subagent identity drift" "$fixture" "name must be"

fixture="$WORK/subagent-set-missing"
make_fixture "$fixture"
mv "$fixture/.agents/agents/doc-drift-checker.toml" "$fixture/removed-reviewer.toml"
expect_failure "missing canonical reviewer" "$fixture" "exactly the three mapped project reviewers"

fixture="$WORK/subagent-set-extra"
make_fixture "$fixture"
cp "$fixture/.agents/agents/doc-drift-checker.toml" "$fixture/.agents/agents/extra-reviewer.toml"
expect_failure "extra canonical reviewer" "$fixture" "exactly the three mapped project reviewers"

fixture="$WORK/subagent-sandbox"
make_fixture "$fixture"
subagent="$fixture/.agents/agents/doc-drift-checker.toml"
node - "$subagent" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"'));
NODE
expect_failure "canonical reviewer write access" "$fixture" "sandbox_mode must be read-only"

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
expect_failure "compatible Context7 pin drift" "$fixture" "must stay pinned"

echo "== canonical hook dispatch =="
fixture="$WORK/guard-dispatch"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["safety-guards"].PreToolUse[0].matcher = "Read";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "guard dispatch drift" "$fixture" "hook matcher drifted"

fixture="$WORK/guard-command"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["safety-guards"].PreToolUse[0].hooks[0].command += " --extra";
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "guard command drift" "$fixture" "hook command drifted"

fixture="$WORK/guard-async"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["safety-guards"].PreToolUse[0].hooks[0].async = true;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "asynchronous guard" "$fixture" "must not be async"

fixture="$WORK/pr-timeout"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["safety-guards"].PreToolUse[1].hooks[0].timeout = 60;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "merge-hook timeout drift" "$fixture" "hook timeout drifted"

fixture="$WORK/lifecycle-dispatch"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
delete config["safety-guards"].Stop;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "hook lifecycle dispatch drift" "$fixture" "event set drifted"

fixture="$WORK/stop-timeout"
make_fixture "$fixture"
node - "$fixture/.agents/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config["safety-guards"].Stop[0].timeout = 540;
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
NODE
expect_failure "Stop-hook timeout drift" "$fixture" "hook timeout drifted"

echo "== canonical skills =="
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
expect_failure "safety invariant count drift" "$fixture" "exactly 15 invariants"

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
