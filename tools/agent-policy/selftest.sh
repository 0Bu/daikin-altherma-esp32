#!/usr/bin/env bash
# CI-policy canaries: missing inputs and missing/stale review evidence must fail closed, while both
# canonical $name and transitional /name records remain accepted at the current PR head.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POLICY="$ROOT/scripts/run-agent-policy.sh"
EXTRACT_FILES="$ROOT/tools/agent-policy/extract_changed_files.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HEAD_SHA=abcdef1234567890abcdef1234567890abcdef12
pass=0

fail() { echo "agent-policy selftest: $1" >&2; exit 1; }

write_body() {
  local prefix="$1" stamp="$2"
  cat > "$WORK/body.md" <<EOF
- [x] \`${prefix}project-review\` clean — merge gate @ $stamp
- [x] \`${prefix}domain-review\` clean — merge gate @ $stamp
EOF
}

run_policy() {
  AGENT_PR_BODY_FILE="$WORK/body.md" AGENT_PR_HEAD_SHA="${CASE_HEAD_SHA:-$HEAD_SHA}" \
    AGENT_CHANGED_FILES_FILE="$WORK/files.txt" "$POLICY"
}

expect_pass() {
  local name="$1" output
  output="$(run_policy 2>&1)" || fail "$name: valid policy evidence was rejected: $output"
  printf '%s' "$output" | grep -qF "all applicable review records match" \
    || fail "$name: pass output did not identify the matched head"
  echo "  PASS  $name"
  pass=$((pass + 1))
}

expect_block() {
  local name="$1" needle="$2" output rc
  set +e
  output="$(run_policy 2>&1)"; rc=$?
  set -e
  [ "$rc" -eq 2 ] || fail "$name: expected exit 2, got $rc"
  printf '%s' "$output" | grep -qF "$needle" || fail "$name: output did not mention '$needle'"
  echo "  PASS  $name"
  pass=$((pass + 1))
}

echo "== accepted aliases =="
printf 'README.md\n' > "$WORK/files.txt"
write_body '$' "$HEAD_SHA"
expect_pass "canonical dollar-prefixed records"
write_body '/' "$HEAD_SHA"
expect_pass "legacy slash-prefixed records"

echo "== missing or malformed CI inputs =="
write_body '$' "$HEAD_SHA"
set +e
output="$(AGENT_POLICY_CI=1 "$ROOT/tools/agent-hooks/require-pr-gates.sh" --no-discovery 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "inputs absent" \
  || fail "missing all inputs did not fail closed"
echo "  PASS  missing all inputs"
pass=$((pass + 1))

mv "$WORK/files.txt" "$WORK/files.missing"
expect_block "missing changed-file list" "AGENT_CHANGED_FILES_FILE"
mv "$WORK/files.missing" "$WORK/files.txt"
CASE_HEAD_SHA=not-a-sha expect_block "malformed head SHA" "7..40 hexadecimal"
unset CASE_HEAD_SHA

echo "== missing and stale evidence =="
write_body '$' deadbee
expect_block "stale review stamps" "checked deadbee"

cat > "$WORK/body.md" <<EOF
- [x] \`\$project-review\` clean — merge gate @ $HEAD_SHA
EOF
expect_block "missing unconditional review" "domain-review"

cat > "$WORK/body.md" <<EOF
- [x] \`\$project-review\` clean — merge gate @ $HEAD_SHA
- [ ] \`\$domain-review\` clean — merge gate @ $HEAD_SHA
EOF
expect_block "unchecked review" "unchecked"

printf 'README.md\n' > "$WORK/files.txt"
cat > "$WORK/body.md" <<EOF
- [x] \`/not-project-review\` clean — merge gate @ $HEAD_SHA
- [x] \`/not-domain-review\` clean — merge gate @ $HEAD_SHA
EOF
expect_block "gate-name substring cannot satisfy evidence" "project-review"

echo "== conditional relevance =="
write_body '$' "$HEAD_SHA"
printf 'main/new_feature.cpp\n' > "$WORK/files.txt"
expect_block "missing feature-docs record" "feature-docs"

cat >> "$WORK/body.md" <<EOF
- [x] \`\$feature-docs\` synced — merge gate @ $HEAD_SHA
EOF
expect_pass "current conditional feature record"

write_body '$' "$HEAD_SHA"
printf 'docs/DESIGN.md\n' > "$WORK/files.txt"
set +e
output="$(run_policy 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] || fail "UI/schematic relevance did not block"
printf '%s' "$output" | grep -qF "schematic-review" || fail "schematic conditional record was not required"
printf '%s' "$output" | grep -qF "ui-use-case-review" || fail "UI conditional record was not required"
echo "  PASS  UI and schematic conditional relevance"
pass=$((pass + 1))

echo "== complete GitHub changed-file input =="
cat > "$WORK/file-pages.json" <<'EOF'
[[{"filename":"docs/one.md"},{"filename":"main/two.cpp"}]]
EOF
output="$(python3 "$EXTRACT_FILES" 2 "$WORK/file-pages.json" 2>&1)" \
  || fail "complete changed-file response was rejected: $output"
[ "$output" = $'docs/one.md\nmain/two.cpp' ] \
  || fail "complete changed-file response emitted the wrong filenames"
echo "  PASS  exact changed-file count"
pass=$((pass + 1))

cat > "$WORK/rename-pages.json" <<'EOF'
[[{"filename":"docs/dashboard.old","previous_filename":"main/www/js/dashboard.js","status":"renamed"}]]
EOF
python3 "$EXTRACT_FILES" 1 "$WORK/rename-pages.json" > "$WORK/files.txt" \
  || fail "renamed changed-file response was rejected"
[ "$(cat "$WORK/files.txt")" = $'docs/dashboard.old\nmain/www/js/dashboard.js' ] \
  || fail "renamed changed-file response omitted or reordered a path"
write_body '$' "$HEAD_SHA"
set +e
output="$(run_policy 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "ui-use-case-review" \
  || fail "renamed UI source path did not preserve conditional relevance"
echo "  PASS  renamed old path preserves conditional relevance"
pass=$((pass + 1))

set +e
output="$(python3 "$EXTRACT_FILES" 3 "$WORK/file-pages.json" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "count mismatch" \
  || fail "partial changed-file response did not fail closed"
echo "  PASS  partial changed-file response"
pass=$((pass + 1))

set +e
output="$(python3 "$EXTRACT_FILES" 3001 "$WORK/file-pages.json" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "at most 3000" \
  || fail "GitHub's 3000-file response limit did not fail closed"
echo "  PASS  GitHub changed-file API limit"
pass=$((pass + 1))

echo
echo "agent-policy selftest: all $pass canaries caught"
