#!/usr/bin/env bash
set -euo pipefail

proj="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
hook_tmp=""
trap 'rm -rf "$tmp"; [ -z "${hook_tmp:-}" ] || rm -rf "$hook_tmp"' EXIT

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

# Prove the merge hook itself fails closed. A checked current review reaches the suite; a suite
# failure and a stale SHA stamp must both block with exit 2.
hook_tmp="$(mktemp -d)"
mkdir -p "$hook_tmp/.claude/hooks" "$hook_tmp/scripts" "$hook_tmp/bin"
cp "$proj/.claude/hooks/pr-gate-lib.sh" "$hook_tmp/.claude/hooks/"
cp "$proj/.claude/hooks/require-ui-use-case-review.sh" "$hook_tmp/.claude/hooks/"

cat > "$hook_tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view")
    stamp="${UI_GATE_STAMP:-abcdef123456}"
    printf '{"body":"- [x] /ui-use-case-review clean - merge gate @ %s","headRefOid":"abcdef1234567890"}\n' "$stamp"
    ;;
  "pr diff") printf 'main/www/js/settings.js\n' ;;
  *) exit 1 ;;
esac
EOF
cat > "$hook_tmp/scripts/run-ui-use-case-tests.sh" <<'EOF'
#!/usr/bin/env bash
exit "${UI_GATE_SUITE_RC:-0}"
EOF
chmod +x "$hook_tmp/bin/gh" "$hook_tmp/scripts/run-ui-use-case-tests.sh"

merge_input='{"tool_name":"Bash","tool_input":{"command":"gh pr merge 123 --squash"}}'
mcp_merge_input='{"tool_name":"mcp__codex_apps__github_merge_pull_request","tool_input":{"pull_number":123}}'
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$hook_tmp" \
  bash "$hook_tmp/.claude/hooks/require-ui-use-case-review.sh"
printf '%s' "$mcp_merge_input" | env PATH="$hook_tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$hook_tmp" \
  bash "$hook_tmp/.claude/hooks/require-ui-use-case-review.sh"

set +e
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$hook_tmp" \
  UI_GATE_SUITE_RC=1 bash "$hook_tmp/.claude/hooks/require-ui-use-case-review.sh" >/dev/null 2>&1
suite_rc=$?
printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$hook_tmp" \
  UI_GATE_STAMP=deadbee bash "$hook_tmp/.claude/hooks/require-ui-use-case-review.sh" >/dev/null 2>&1
stamp_rc=$?
set -e

[ "$suite_rc" -eq 2 ] || { echo "ui selftest: failing suite did not block merge" >&2; exit 1; }
[ "$stamp_rc" -eq 2 ] || { echo "ui selftest: stale review stamp did not block merge" >&2; exit 1; }

# The hook failing closed is only half of it: the PR TEMPLATE has to teach a stamp the hook can
# actually read. It shipped the sha wrapped in backticks, which the `@[[:space:]]*[0-9a-f]{7,40}`
# matcher sees as no stamp at all, so a body filled in literally from the template was refused —
# three times (PR #99, #343, #381) before anyone fixed the template rather than remembering. Fill
# the real template's own line with a real sha and require the gate to accept it.
# THIS hook's own line, selected by name — not merely the first "merge gate @" in the file. The
# template teaches one stamp per gate and their order is nobody's contract: when a later change made
# /project-review the first of them, this check fed require-ui-use-case-review.sh a SIBLING gate's
# line, which is absent under its key, and the suite failed for a reason that had nothing to do with
# the defect it is here to catch.
tpl_line="$(grep -m1 -F -- '`/ui-use-case-review`' "$proj/.github/pull_request_template.md" || true)"
[ -n "$tpl_line" ] || { echo "ui selftest: no /ui-use-case-review line in the PR template" >&2; exit 1; }
case "$tpl_line" in
  *"merge gate @"*) ;;
  *) echo "ui selftest: the /ui-use-case-review template line teaches no 'merge gate @' stamp" >&2; exit 1 ;;
esac
tpl_body="$(printf '%s' "$tpl_line" | sed 's/\[ \]/[x]/; s/<short-sha>/abcdef123456/')"

cat > "$hook_tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view") printf '{"body":"%s","headRefOid":"abcdef1234567890"}\n' "$UI_GATE_BODY" ;;
  "pr diff") printf 'main/www/js/settings.js\n' ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$hook_tmp/bin/gh"

printf '%s' "$merge_input" | env PATH="$hook_tmp/bin:$PATH" CLAUDE_PROJECT_DIR="$hook_tmp" \
  UI_GATE_BODY="$tpl_body" bash "$hook_tmp/.claude/hooks/require-ui-use-case-review.sh" \
  || { echo "ui selftest: the PR template's stamp line is NOT accepted by the merge gate — a body filled in from the template would be refused" >&2; exit 1; }

rm -rf "$hook_tmp"

# The end-to-end check above covers exactly ONE line, and the template teaches a stamp per merge
# gate. Name the complete expected set explicitly: selecting only lines which already contain
# "merge gate @" makes a regressed prose-only line disappear from both the input and the count, so
# the selftest used to announce "all 5 readable" after one of the six gates was deliberately broken.
# Put every expected key through the SHARED matcher, and reject missing or surprise gate entries.
# shellcheck source=/dev/null
. "$proj/.claude/hooks/pr-gate-lib.sh"
expected_gate_keys=(project-review feature-docs domain-review schematic-review ui-use-case-review absence-review)
tpl_content="$(cat "$proj/.github/pull_request_template.md")"
tpl_lines="$(printf '%s\n' "$tpl_content" | gate_task_lines | grep -iE 'gate')"
tpl_n=0
for key in "${expected_gate_keys[@]}"; do
    line="$(printf '%s\n' "$tpl_lines" | grep -F -- "\`/$key\`" || true)"
    [ -n "$line" ] || { echo "ui selftest: the PR template is missing the /$key gate line" >&2; exit 1; }
    [ "$(printf '%s\n' "$line" | wc -l | tr -d ' ')" -eq 1 ] || {
        echo "ui selftest: the PR template has duplicate /$key gate lines" >&2; exit 1; }
    case "$line" in
      *"merge gate @"*) ;;
      *) echo "ui selftest: the /$key template line teaches no 'merge gate @' stamp" >&2; exit 1 ;;
    esac
    filled="$(printf '%s' "$line" | sed 's/\[ \]/[x]/; s/<short-sha>/abcdef123456/')"
    [ "$(gate_checkbox_status "$filled" "$key")" = "checked abcdef123456" ] || {
        echo "ui selftest: the template's /$key line does not teach a stamp the merge gate can read" >&2
        exit 1
    }
    tpl_n=$((tpl_n + 1))
done
[ "$tpl_n" -eq "${#expected_gate_keys[@]}" ] || {
    echo "ui selftest: expected ${#expected_gate_keys[@]} gate lines, checked $tpl_n" >&2; exit 1; }
extra_keys="$(printf '%s\n' "$tpl_lines" \
    | sed -n 's/.*`\/\([a-z0-9-]\{1,\}\)`.*/\1/p' \
    | while IFS= read -r key; do
        found=false
        for expected in "${expected_gate_keys[@]}"; do [ "$key" = "$expected" ] && found=true; done
        [ "$found" = true ] || printf '%s\n' "$key"
      done)"
[ -z "$extra_keys" ] || { echo "ui selftest: unexpected gate key(s): $extra_keys" >&2; exit 1; }

# Before any of that: the filter has to RUN. gate_task_lines is an awk program, and an awk that
# cannot compile its regex prints nothing and exits non-zero — which arrives at gate_checkbox_status
# as an empty candidate set, i.e. "absent", i.e. every merge gate refusing every merge with "the PR
# body has no checkbox — it has not been recorded". That is a fail-closed direction with a message
# that blames the reviewer. It happened: mawk 1.3.4 panicked on a bounded interval followed by an
# alternation group, and mawk is the default awk on Debian and Ubuntu while the CI runners ship
# gawk — so the gates were dead on the machines people merge from and green here. Assert the EXIT
# STATUS, not just the output: an empty result is indistinguishable from "no task lines" downstream.
set +e
filter_out="$(printf '%s\n' '- [x] `/project-review` clean — merge gate @ abcdef123456' | gate_task_lines 2>/dev/null)"
filter_rc=$?
set -e
[ "$filter_rc" -eq 0 ] || {
    echo "ui selftest: gate_task_lines exited $filter_rc under this awk — every gate would report 'absent'" >&2
    exit 1; }
[ -n "$filter_out" ] || {
    echo "ui selftest: gate_task_lines dropped a real task-list item" >&2; exit 1; }

# A PR body legitimately quotes checkbox examples. Inline, blockquoted and fenced examples are not
# checklist records and must neither shadow nor satisfy the one real gate line.
decoy_body="$(printf '%s\n' \
    'Prose about the gate: `- [ ] `/project-review` run clean` is the form that fails.' \
    '> - [x] `/project-review` clean — merge gate @ deadbee' \
    '```markdown' \
    '- [x] `/project-review` clean — merge gate @ deadbee' \
    '```' \
    '' \
    '- [x] `/project-review` clean — merge gate @ abcdef123456')"
[ "$(gate_checkbox_status "$decoy_body" project-review)" = "checked abcdef123456" ] || {
    echo "ui selftest: quoted/fenced checkboxes shadow or satisfy the real gate" >&2; exit 1; }
# Two actual task-list entries are malformed and must fail closed rather than preferring a ticked
# decoy. The honest single unticked box still reports unchecked.
duplicate_body="$(printf '%s\n' \
    '- [x] `/project-review` clean — merge gate @ deadbee' \
    '- [ ] `/project-review` clean — merge gate @ <short-sha>')"
[ "$(gate_checkbox_status "$duplicate_body" project-review)" = "ambiguous" ] || {
    echo "ui selftest: duplicate real gate boxes do not fail closed" >&2; exit 1; }
[ "$(gate_checkbox_status '- [ ] `/project-review` clean — merge gate @ <short-sha>' project-review)" = "unchecked" ] || {
    echo "ui selftest: an unticked gate box no longer reports unchecked" >&2; exit 1; }

echo "ui selftest: merge hook accepts current proof and blocks failing or stale proof"
echo "ui selftest: all $tpl_n PR-template stamp lines are readable by the merge gate"

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
