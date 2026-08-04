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
rm -rf "$hook_tmp"

echo "ui selftest: merge hook accepts current proof and blocks failing or stale proof"
