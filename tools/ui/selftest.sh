#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
hook_tmp=""
trap 'rm -rf "$tmp"; [ -z "${hook_tmp:-}" ] || rm -rf "$hook_tmp"' EXIT

# Assert the canonical skill and Codex wiring are present and route through the neutral gate core.
for required in \
  ".agents/skills/ui-use-case-review/SKILL.md" \
  ".agents/skills/ui-use-case-review/agents/openai.yaml" \
  ".codex/config.toml" \
  ".codex/hooks.json" \
  "tools/agent-hooks/require-pr-gates.sh"; do
  [ -f "$proj/$required" ] || { echo "ui selftest: missing agent UI-review surface $required" >&2; exit 1; }
done
grep -q '^name: ui-use-case-review$' "$proj/.agents/skills/ui-use-case-review/SKILL.md" \
  || { echo "ui selftest: canonical UI skill name drifted" >&2; exit 1; }
if grep -q '^model:' "$proj/.agents/skills/ui-use-case-review/SKILL.md"; then
  echo "ui selftest: canonical UI skill contains runner-specific model routing" >&2
  exit 1
fi
node - "$proj/.codex/hooks.json" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
let hooks;
try { hooks = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (error) { console.error(`ui selftest: ${file} is not valid JSON: ${error.message}`); process.exit(1); }
const wiring = JSON.stringify(hooks);
if (!wiring.includes("tools/agent-hooks/require-pr-gates.sh")) {
  console.error("ui selftest: Codex merge hooks do not route through the runner-neutral PR gate");
  process.exit(1);
}
NODE
echo "ui selftest: canonical .agents/.codex UI-review wiring exists"

mkdir -p "$tmp/main" "$tmp/test" "$tmp/tools"
cp -R "$proj/main/www" "$tmp/main/www"
cp "$proj/test/test_ui_use_cases.mjs" "$tmp/test/"
cp "$proj/test/test_ui_modal_scroll.mjs" "$tmp/test/"
cp -R "$proj/tools/ui" "$tmp/tools/ui"

# Re-seed the historical ENV III failure on its new owning Board Hardware dialog: Cancel and an
# accepted atomic Save route through an undefined close helper. The behavioral matrix must fail on
# the first real action, not merely parse the bundle.
sed 's/function closeBoard() { closePopup("boardModal"); }/function closeBoard() { missingClosePopup("boardModal"); }/' \
  "$tmp/main/www/js/settings.js" > "$tmp/main/www/js/settings.js.mutated"
mv "$tmp/main/www/js/settings.js.mutated" "$tmp/main/www/js/settings.js"

if (cd "$tmp" && node test/test_ui_use_cases.mjs >/dev/null 2>&1); then
  echo "ui selftest: historical undefined close handler escaped the use-case suite" >&2
  exit 1
fi

echo "ui selftest: historical ENV III modal-action failure is detected"

# Re-seed the iPhone failure: legacy 100vh includes Safari's browser chrome and lets a long dialog
# extend below the actually visible viewport. The focused layout contract must reject that rollback.
sed 's/height: 100vh; height: 100dvh;/height: 100vh;/' \
  "$tmp/main/www/style.css" > "$tmp/main/www/style.css.mutated"
mv "$tmp/main/www/style.css.mutated" "$tmp/main/www/style.css"

if (cd "$tmp" && node test/test_ui_modal_scroll.mjs >/dev/null 2>&1); then
  echo "ui selftest: iPhone 100vh modal regression escaped the layout contract" >&2
  exit 1
fi

echo "ui selftest: iPhone dynamic-viewport regression is detected"

# Prove the neutral local merge gate fails closed without copying a runner-specific implementation.
hook_tmp="$(mktemp -d)"
mkdir -p "$hook_tmp/bin" "$hook_tmp/scripts" "$hook_tmp/tools/absence"
cp "$proj/scripts/gh-with-git-credentials.sh" "$hook_tmp/scripts/"
git -C "$hook_tmp" init -q
git -C "$hook_tmp" remote add origin https://github.com/0Bu/daikin-altherma-esp32.git

# The hook failing closed is only half of it: the PR TEMPLATE has to teach a stamp the hook can
# actually read. It shipped the sha wrapped in backticks, which the `@[[:space:]]*[0-9a-f]{7,40}`
# matcher sees as no stamp at all, so a body filled in literally from the template was refused —
# three times (PR #99, #343, #381) before anyone fixed the template rather than remembering. Fill
# the real template's own line with a real sha and require the gate to accept it.
# THIS hook's own line, selected by name — not merely the first "merge gate @" in the file. The
# template teaches one stamp per gate and their order is nobody's contract: when a later change made
# $project-review the first of them, this check fed the aggregate gate a SIBLING gate's
# line, which is absent under its key, and the suite failed for a reason that had nothing to do with
# the defect it is here to catch.
tpl_line="$(grep -m1 -F -- '`$ui-use-case-review` clean — merge gate @' "$proj/.github/pull_request_template.md" || true)"
[ -n "$tpl_line" ] || { echo "ui selftest: no canonical UI merge-gate line in the PR template" >&2; exit 1; }
case "$tpl_line" in
  *"merge gate @"*) ;;
  *) echo "ui selftest: the UI template line teaches no 'merge gate @' stamp" >&2; exit 1 ;;
esac
tpl_body="$(printf '%s' "$tpl_line" | sed 's/\[ \]/[x]/; s/<short-sha>/abcdef123456/')"
ui_head=abcdef1234567890abcdef1234567890abcdef12

# This fixture changes main/www/js/settings.js, so all four conditional reviews apply beside the
# two unconditional ones. The UI line comes from the real template above.
cat > "$hook_tmp/body.md" <<EOF
- [x] \`\$project-review\` clean — merge gate @ abcdef123456
- [x] \`\$domain-review\` clean — merge gate @ abcdef123456
- [x] \`\$feature-docs\` synced — merge gate @ abcdef123456
- [x] \`\$schematic-review\` clean — merge gate @ abcdef123456
$tpl_body
- [x] \`\$absence-review\` clean — merge gate @ abcdef123456
EOF
printf 'main/www/js/settings.js\n' > "$hook_tmp/files.txt"

# A local UI-relevant merge deliberately reruns the UI and absence canaries. Point the neutral core
# at this fixture so that testing the merge hook does not recursively invoke this very selftest.
cat > "$hook_tmp/scripts/run-ui-use-case-tests.sh" <<'EOF'
#!/usr/bin/env bash
exit "${UI_GATE_SUITE_RC:-0}"
EOF
cat > "$hook_tmp/scripts/run-ui-gif-audit.sh" <<'EOF'
#!/usr/bin/env bash
exit "${UI_GIF_GATE_SUITE_RC:-0}"
EOF
cat > "$hook_tmp/tools/absence/selftest.sh" <<'EOF'
#!/usr/bin/env bash
exit "${ABSENCE_GATE_SUITE_RC:-0}"
EOF
chmod +x "$hook_tmp/scripts/run-ui-use-case-tests.sh" "$hook_tmp/scripts/run-ui-gif-audit.sh" \
  "$hook_tmp/tools/absence/selftest.sh"

# Local discovery is stubbed, but the production neutral gate and both merge payload shapes are
# real.
cat > "$hook_tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
[ "${GH_HOST:-}" = github.com ] || exit 95
[ "${GH_REPO:-}" = github.com/0Bu/daikin-altherma-esp32 ] || exit 96
case "$1 $2" in
  "repo view") printf '%s\n' '0Bu/daikin-altherma-esp32' ;;
  "pr view")
    python3 - "$UI_GATE_BODY_FILE" <<'PY'
import json, os, sys
with open(sys.argv[1], encoding="utf-8") as source, open(
    os.environ["UI_GATE_FILES_FILE"], encoding="utf-8"
) as changed:
    print(json.dumps({"number": 123, "body": source.read(),
                      "headRefOid": "abcdef1234567890abcdef1234567890abcdef12",
                      "changedFiles": len(changed.read().splitlines())}))
PY
    ;;
  "api --hostname")
    [ "${3:-}" = github.com ] || exit 97
    python3 - "$UI_GATE_FILES_FILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    print(json.dumps([[{"filename": line} for line in source.read().splitlines()]]))
PY
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$hook_tmp/bin/gh"
chmod +x "$hook_tmp/scripts/gh-with-git-credentials.sh"

merge_input="$(python3 - "$hook_tmp" "$ui_head" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "Bash", "tool_input": {"command": f"gh --repo github.com/0Bu/daikin-altherma-esp32 pr merge 123 --match-head-commit {sys.argv[2]} --squash"}}))
PY
)"
mcp_merge_input="$(python3 - "$hook_tmp" <<'PY'
import json, sys
print(json.dumps({"cwd": sys.argv[1], "tool_name": "mcp__codex_apps__github_merge_pull_request", "tool_input": {"pr_number": 123, "repository_full_name": "0Bu/daikin-altherma-esp32"}}))
PY
)"
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" GH_TOKEN=ui-hook-selftest-token AGENT_PROJECT_DIR="$hook_tmp" \
  UI_GATE_BODY_FILE="$hook_tmp/body.md" UI_GATE_FILES_FILE="$hook_tmp/files.txt" \
  "$proj/tools/agent-hooks/require-pr-gates.sh" >/dev/null \
  || { echo "ui selftest: neutral local CLI merge gate rejected current canonical UI proof" >&2; exit 1; }

set +e
mcp_out="$(printf '%s' "$mcp_merge_input" | env PATH="$hook_tmp/bin:$PATH" GH_TOKEN=ui-hook-selftest-token AGENT_PROJECT_DIR="$hook_tmp" \
  UI_GATE_BODY_FILE="$hook_tmp/body.md" UI_GATE_FILES_FILE="$hook_tmp/files.txt" \
  "$proj/tools/agent-hooks/require-pr-gates.sh" 2>&1)"; mcp_rc=$?
set -e
[ "$mcp_rc" -eq 2 ] \
  && printf '%s' "$mcp_out" | grep -qF 'MCP merge and auto-merge activation tools are unsupported' \
  || { echo "ui selftest: MCP merge bypassed the documented CLI-only path" >&2; exit 1; }

set +e
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" GH_TOKEN=ui-hook-selftest-token AGENT_PROJECT_DIR="$hook_tmp" \
  UI_GATE_BODY_FILE="$hook_tmp/body.md" UI_GATE_FILES_FILE="$hook_tmp/files.txt" \
  UI_GATE_SUITE_RC=1 "$proj/tools/agent-hooks/require-pr-gates.sh" >/dev/null 2>&1
suite_rc=$?
set -e
[ "$suite_rc" -eq 2 ] \
  || { echo "ui selftest: neutral local merge gate accepted a failing immediate UI suite" >&2; exit 1; }

sed 's/abcdef123456/deadbee/g' "$hook_tmp/body.md" > "$hook_tmp/stale.md"
set +e
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" GH_TOKEN=ui-hook-selftest-token AGENT_PROJECT_DIR="$hook_tmp" \
  UI_GATE_BODY_FILE="$hook_tmp/stale.md" UI_GATE_FILES_FILE="$hook_tmp/files.txt" \
  "$proj/tools/agent-hooks/require-pr-gates.sh" >/dev/null 2>&1
stale_rc=$?
set -e
[ "$stale_rc" -eq 2 ] \
  || { echo "ui selftest: neutral local merge gate accepted stale canonical UI proof" >&2; exit 1; }

# The end-to-end check above covers exactly ONE line, and the template teaches a stamp per merge
# gate. Name the complete expected set explicitly: selecting only lines which already contain
# "merge gate @" makes a regressed prose-only line disappear from both the input and the count, so
# the selftest used to announce "all 5 readable" after one of the six gates was deliberately broken.
# Put every expected key through the SHARED matcher, and reject missing or surprise gate entries.
# shellcheck source=/dev/null
. "$proj/tools/agent-hooks/pr-gate-lib.sh"
# The list is explicit BOTH ways — a missing key and a surprise key are each a failure — so adding
# a gate means adding it here in the
# same commit, which is the point: a gate whose template line nobody checks is a gate whose stamp
# nobody can be sure is readable.
expected_gate_keys=(project-review feature-docs domain-review schematic-review ui-use-case-review absence-review ui-gif)
tpl_content="$(cat "$proj/.github/pull_request_template.md")"
tpl_lines="$(printf '%s\n' "$tpl_content" | agent_gate_task_lines | grep -iE 'gate')"
tpl_n=0
for key in "${expected_gate_keys[@]}"; do
    line="$(printf '%s\n' "$tpl_lines" | grep -F -- '`$'"${key}"'`' || true)"
    [ -n "$line" ] || { echo "ui selftest: the PR template is missing the $key gate line" >&2; exit 1; }
    [ "$(printf '%s\n' "$line" | wc -l | tr -d ' ')" -eq 1 ] || {
        echo "ui selftest: the PR template has duplicate $key gate lines" >&2; exit 1; }
    case "$line" in
      *"merge gate @"*) ;;
      *) echo "ui selftest: the $key template line teaches no 'merge gate @' stamp" >&2; exit 1 ;;
    esac
    filled="$(printf '%s' "$line" | sed 's/\[ \]/[x]/; s/<short-sha>/abcdef123456/')"
    filled_file="$hook_tmp/template-$key.md"
    printf '%s\n' "$filled" >"$filled_file"
    [ "$(agent_gate_checkbox_status "$filled_file" "$key")" = "checked abcdef123456" ] || {
        echo "ui selftest: the template's $key line does not teach a stamp the merge gate can read" >&2
        exit 1
    }
    tpl_n=$((tpl_n + 1))
done
[ "$tpl_n" -eq "${#expected_gate_keys[@]}" ] || {
    echo "ui selftest: expected ${#expected_gate_keys[@]} gate lines, checked $tpl_n" >&2; exit 1; }
extra_keys="$(printf '%s\n' "$tpl_lines" \
    | sed -n 's#.*`\$\([a-z0-9-]\{1,\}\)`.*#\1#p' \
    | while IFS= read -r key; do
        found=false
        for expected in "${expected_gate_keys[@]}"; do [ "$key" = "$expected" ] && found=true; done
        [ "$found" = true ] || printf '%s\n' "$key"
      done)"
[ -z "$extra_keys" ] || { echo "ui selftest: unexpected gate key(s): $extra_keys" >&2; exit 1; }

# Before any of that: the filter has to RUN. agent_gate_task_lines is an awk program, and an awk
# that cannot compile its regex prints nothing and exits non-zero — which arrives at the status parser
# as an empty candidate set, i.e. "absent", i.e. every merge gate refusing every merge with "the PR
# body has no checkbox — it has not been recorded". That is a fail-closed direction with a message
# that blames the reviewer. It happened: mawk 1.3.4 panicked on a bounded interval followed by an
# alternation group, and mawk is the default awk on Debian and Ubuntu while the CI runners ship
# gawk — so the gates were dead on the machines people merge from and green here. Assert the EXIT
# STATUS, not just the output: an empty result is indistinguishable from "no task lines" downstream.
set +e
filter_out="$(printf '%s\n' '- [x] `$project-review` clean — merge gate @ abcdef123456' | agent_gate_task_lines 2>/dev/null)"
filter_rc=$?
set -e
[ "$filter_rc" -eq 0 ] || {
    echo "ui selftest: agent_gate_task_lines exited $filter_rc under this awk — every gate would report 'absent'" >&2
    exit 1; }
[ -n "$filter_out" ] || {
    echo "ui selftest: agent_gate_task_lines dropped a real task-list item" >&2; exit 1; }

# A PR body legitimately quotes checkbox examples. Inline, blockquoted and fenced examples are not
# checklist records and must neither shadow nor satisfy the one real gate line.
decoy_file="$hook_tmp/decoy-body.md"
printf '%s\n' \
    'Prose about the gate: `- [ ] `$project-review` run clean` is the form that fails.' \
    '> - [x] `$project-review` clean — merge gate @ deadbee' \
    '```markdown' \
    '- [x] `$project-review` clean — merge gate @ deadbee' \
    '```' \
    '' \
    '- [x] `$project-review` clean — merge gate @ abcdef123456' >"$decoy_file"
[ "$(agent_gate_checkbox_status "$decoy_file" project-review)" = "checked abcdef123456" ] || {
    echo "ui selftest: quoted/fenced checkboxes shadow or satisfy the real gate" >&2; exit 1; }
# Two actual task-list entries are malformed and must fail closed rather than preferring a ticked
# decoy. The honest single unticked box still reports unchecked.
duplicate_file="$hook_tmp/duplicate-body.md"
printf '%s\n' \
    '- [x] `$project-review` clean — merge gate @ deadbee' \
    '- [ ] `$project-review` clean — merge gate @ <short-sha>' >"$duplicate_file"
[ "$(agent_gate_checkbox_status "$duplicate_file" project-review)" = "ambiguous" ] || {
    echo "ui selftest: duplicate real gate boxes do not fail closed" >&2; exit 1; }
unchecked_file="$hook_tmp/unchecked-body.md"
printf '%s\n' '- [ ] `$project-review` clean — merge gate @ <short-sha>' >"$unchecked_file"
[ "$(agent_gate_checkbox_status "$unchecked_file" project-review)" = "unchecked" ] || {
    echo "ui selftest: an unticked gate box no longer reports unchecked" >&2; exit 1; }

echo "ui selftest: merge hook accepts current proof and blocks failing or stale proof"
echo "ui selftest: all $tpl_n PR-template stamp lines are readable by the merge gate"
echo "ui selftest: bound CLI merge accepts current UI proof; MCP merge stays CLI-only"

rm -rf "$hook_tmp"

# Re-seed the COP-block-reason scrape going self-referential. The four reasons used to be assigned
# as literals inside liveData(); when the cascade moved into copPlan() only `mb_scope` stayed a
# direct assignment, and the scrape's `copBlock\s*=` also matched the FIRST `=` of the INSPECT
# explainer's own `d.copBlock === "tank_heater"` comparisons. So it went on finding all four — by
# reading the explainer table against ITSELF — and a block reason with no bilingual sentence passed
# with exit 0. The COP pill would then show a bare "—" with nothing saying why, which is exactly
# what the pel explainer's two distinct sentences exist to prevent.
#
# Two mutations, because the two halves fail differently: a NEW reason the explainer does not cover,
# and the rule being renamed out of the scrape's reach (which must fail loudly rather than quietly
# check less). A fresh tree — the mutations above would confuse an unrelated contract.
matrix_tmp="$(mktemp -d)"
trap 'rm -rf "$tmp" "$matrix_tmp"; [ -z "${hook_tmp:-}" ] || rm -rf "$hook_tmp"' EXIT
mkdir -p "$matrix_tmp/main" "$matrix_tmp/test" "$matrix_tmp/tools"
cp -R "$proj/main/www" "$matrix_tmp/main/www"
cp -R "$proj/main/def" "$matrix_tmp/main/def"
cp -R "$proj/tools/ui" "$matrix_tmp/tools/ui"
cp -R "$proj/tools/uigif" "$matrix_tmp/tools/uigif"
cp "$proj/test/test_ui_source_matrix.mjs" "$matrix_tmp/test/"

# Sanity: the unmutated copy must PASS, or the two failures below prove nothing.
(cd "$matrix_tmp" && node test/test_ui_source_matrix.mjs >/dev/null 2>&1) || {
  echo "ui selftest: the source-matrix contract does not pass on an unmutated tree — the COP-reason cases below would be vacuous" >&2
  exit 1; }

cp "$matrix_tmp/main/www/js/schematic.js" "$matrix_tmp/schematic.orig"

# (a) a fifth reason the production cascade can return, explained nowhere.
sed 's|^\(  if (pelSrc == null)\)|  if (pelSrc === "XX")   return { scope: "plant",  block: "ghost_code",  postBuh: false };\n\1|' \
  "$matrix_tmp/schematic.orig" > "$matrix_tmp/main/www/js/schematic.js"
grep -q 'ghost_code' "$matrix_tmp/main/www/js/schematic.js" || {
  echo "ui selftest: could not seed the unexplained COP block reason — the copPlan cascade has moved" >&2; exit 1; }
if (cd "$matrix_tmp" && node test/test_ui_source_matrix.mjs >/dev/null 2>&1); then
  echo "ui selftest: a COP block reason with no bilingual explainer escaped the source-matrix contract" >&2
  exit 1
fi

# (b) the rule renamed, i.e. no longer addressable by the scrape.
sed 's|const copPlan =|const copPlanRenamed =|' \
  "$matrix_tmp/schematic.orig" > "$matrix_tmp/main/www/js/schematic.js"
if (cd "$matrix_tmp" && node test/test_ui_source_matrix.mjs >/dev/null 2>&1); then
  echo "ui selftest: the COP-reason scrape passed while it could no longer read the rule it claims to check" >&2
  exit 1
fi

rm -rf "$matrix_tmp"

echo "ui selftest: an unexplained COP block reason, and a scrape that stopped reading the rule, are both detected"
