#!/usr/bin/env bash
# CI-policy canaries: missing inputs and missing/stale review evidence must fail closed, while
# canonical $name records remain accepted at the current PR head.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POLICY="$ROOT/scripts/run-agent-policy.sh"
EXTRACT_FILES="$ROOT/tools/agent-policy/extract_changed_files.py"
RENOVATE_TEST="$ROOT/tools/agent-policy/test_renovate_action_pr.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HEAD_SHA=abcdef1234567890abcdef1234567890abcdef12
pass=0

fail() { echo "agent-policy selftest: $1" >&2; exit 1; }

write_body() {
  local stamp="$1"
  cat > "$WORK/body.md" <<EOF
- [x] \`\$project-review\` clean — merge gate @ $stamp
- [x] \`\$domain-review\` clean — merge gate @ $stamp
EOF
}

run_policy() {
  if [ "${CASE_RENOVATE_CONTEXT:-0}" = "1" ]; then
    AGENT_PR_BODY_FILE="$WORK/body.md" AGENT_PR_HEAD_SHA="${CASE_HEAD_SHA:-$HEAD_SHA}" \
      AGENT_CHANGED_FILES_FILE="$WORK/files.txt" \
      AGENT_PR_METADATA_FILE="$WORK/pr.json" \
      AGENT_PR_HEAD_COMMIT_FILE="$WORK/head-commit.json" \
      AGENT_PR_HEAD_COMMIT_PAGES_FILE="$WORK/renovate-head-commit-pages.json" \
      "$POLICY"
  else
    AGENT_PR_BODY_FILE="$WORK/body.md" AGENT_PR_HEAD_SHA="${CASE_HEAD_SHA:-$HEAD_SHA}" \
      AGENT_CHANGED_FILES_FILE="$WORK/files.txt" "$POLICY"
  fi
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

expect_renovate_pass() {
  local name="$1" output
  output="$(run_policy 2>&1)" || fail "$name: verified Renovate action PR was rejected: $output"
  printf '%s' "$output" | grep -qF "verified Renovate Action-pin-line-only PR" \
    || fail "$name: pass output did not identify the narrow exception"
  echo "  PASS  $name"
  pass=$((pass + 1))
}

echo "== Renovate action classifier =="
output="$(python3 "$RENOVATE_TEST" 2>&1)" \
  || fail "Renovate classifier unit tests failed: $output"
echo "  PASS  adversarial classifier cases"
pass=$((pass + 1))

output="$(python3 - "$ROOT/.github/renovate.json" "$ROOT/.github/workflows/renovate.yaml" \
  "$ROOT/.github/workflows/build.yml" "$ROOT/.github/workflows/pr-policy.yml" <<'PY'
import json
from pathlib import Path
import re
import sys

config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if config.get("automerge") is True:
    raise SystemExit("top-level automerge must not bypass manager-scoped package rules")
rules = config.get("packageRules")
if not isinstance(rules, list):
    raise SystemExit("packageRules is not a list")
positive = [rule for rule in rules if isinstance(rule, dict) and rule.get("automerge") is True]
if (len(positive) != 1
        or positive[0].get("matchManagers") != ["github-actions"]
        or positive[0].get("matchDepNames") != ["renovatebot/github-action"]):
    raise SystemExit("automerge must have exactly one Renovate-runner Action positive rule")
manual_deps = {"espressif/esp-idf", "esptool-js"}
negative = [
    rule for rule in rules
    if isinstance(rule, dict)
    and rule.get("automerge") is False
    and set(rule.get("matchDepNames", [])) == manual_deps
]
if len(negative) != 1:
    raise SystemExit("firmware dependencies must retain one exact automerge:false rule")
workflow = Path(sys.argv[2]).read_text(encoding="utf-8")
if re.search(r"^[ \t]*RENOVATE_AUTOMERGE[ \t]*:", workflow, re.MULTILINE):
    raise SystemExit("RENOVATE_AUTOMERGE must not globally enable automerge")
build = Path(sys.argv[3]).read_text(encoding="utf-8")
policy = Path(sys.argv[4]).read_text(encoding="utf-8")
if "  pull_request:\n" not in build or "  pull_request_target:\n" in build:
    raise SystemExit("mechanical/build workflow must use only the ordinary pull_request event")
if "  pull_request_target:\n" not in policy or re.search(r"^  pull_request:\s*$", policy, re.MULTILINE):
    raise SystemExit("trusted policy workflow must use only pull_request_target")
mechanical_start = build.find("\n  mechanical_gates:\n")
build_start = build.find("\n  build:\n", mechanical_start + 1)
trusted_start = build.find("\n  trusted_build:\n", build_start + 1)
if min(mechanical_start, build_start, trusted_start) < 0 or not mechanical_start < build_start < trusted_start:
    raise SystemExit("mechanical, untrusted build, and trusted build jobs must remain separate and ordered")
mechanical_job = build[mechanical_start:build_start]
untrusted_build = build[build_start:trusted_start]
if "persist-credentials: false" not in mechanical_job or "allow-unsafe-pr-checkout" in mechanical_job:
    raise SystemExit("ordinary pull_request mechanical checkout must not use unsafe target opt-ins")
if "needs: [mechanical_gates]" not in untrusted_build or "if: always() && github.event_name == 'pull_request'" not in untrusted_build:
    raise SystemExit("required build job must always consume the mechanical result on pull_request")
if '"$MECHANICAL_RESULT" = success' not in untrusted_build:
    raise SystemExit("required build job does not fail when mechanical gates fail")
if "allow-unsafe-pr-checkout" in untrusted_build:
    raise SystemExit("ordinary pull_request build must not use unsafe target opt-ins")
for untrusted_job in (mechanical_job, untrusted_build):
    if "secrets." in untrusted_job or "github.token" in untrusted_job:
        raise SystemExit("untrusted PR-code job gained a secret or token expression")
if "\n  gates:\n" not in policy or "working-directory: .trusted-policy" not in policy:
    raise SystemExit("separate required gates job must run trusted base policy")
trusted_checkout = policy.find("- name: Check out trusted base policy")
trusted_enforce = policy.find("- name: Enforce current PR review evidence from trusted base")
if trusted_checkout < 0 or trusted_enforce < trusted_checkout:
    raise SystemExit("trusted policy workflow ordering is incomplete")
if "refs/pull/" in policy or "allow-unsafe-pr-checkout" in policy or "secrets." in policy:
    raise SystemExit("trusted policy workflow must never load PR code or secrets")
for binding in ('git rev-parse HEAD^1', 'git rev-parse HEAD^2'):
    if binding not in build:
        raise SystemExit("PR mechanical/build evidence must bind both base and head SHAs")
if 'current_base="$(jq -r' not in policy:
    raise SystemExit("trusted policy evidence must bind the live base SHA")
if not re.search(r"^permissions:\n  contents: read\n  pull-requests: read\n", build, re.MULTILINE):
    raise SystemExit("pull_request workflow permissions must remain read-only")
if not re.search(r"^permissions:\n  contents: read\n  pull-requests: read\n", policy, re.MULTILINE):
    raise SystemExit("pull_request_target policy permissions must remain read-only")
print("Renovate automerge activation contract is narrow")
PY
)" || fail "Renovate automerge activation contract failed: $output"
echo "  PASS  Renovate automerge activation is runner-pin-scoped"
pass=$((pass + 1))

echo "== canonical records =="
printf 'README.md\n' > "$WORK/files.txt"
write_body "$HEAD_SHA"
expect_pass "canonical dollar-prefixed records"

cat > "$WORK/body.md" <<EOF
- [x] /project-review clean — merge gate @ $HEAD_SHA
- [x] /domain-review clean — merge gate @ $HEAD_SHA
EOF
expect_block "retired slash-prefixed records" "project-review"

echo "== missing or malformed CI inputs =="
write_body "$HEAD_SHA"
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
write_body deadbee
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
- [x] \`\$not-project-review\` clean — merge gate @ $HEAD_SHA
- [x] \`\$not-domain-review\` clean — merge gate @ $HEAD_SHA
EOF
expect_block "gate-name substring cannot satisfy evidence" "project-review"

echo "== authoritative Renovate action exception =="
old_digest=cccccccccccccccccccccccccccccccccccccccc
new_digest=dddddddddddddddddddddddddddddddddddddddd
parent_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
printf '%s\n' '.github/workflows/renovate.yaml' > "$WORK/files.txt"
: > "$WORK/body.md"
cat > "$WORK/pr.json" <<EOF
{"state":"open","draft":false,"commits":1,"changed_files":1,
 "user":{"login":"0Bu"},
 "body":"This PR has been generated by [Mend Renovate CLI]\\n<!--renovate-debug:fixture-->",
 "head":{"sha":"$HEAD_SHA","ref":"renovate/action-pin","repo":{"full_name":"0Bu/daikin-altherma-esp32"}},
 "base":{"ref":"main","repo":{"full_name":"0Bu/daikin-altherma-esp32"}}}
EOF
cat > "$WORK/head-commit.json" <<EOF
{"sha":"$HEAD_SHA","author":{"login":"renovate-bot"},"committer":{"login":"renovate-bot"},
 "commit":{"author":{"name":"Renovate Bot","email":"renovate@whitesourcesoftware.com"},
 "committer":{"name":"Renovate Bot","email":"renovate@whitesourcesoftware.com"}},
 "parents":[{"sha":"$parent_sha"}]}
EOF
cat > "$WORK/renovate-head-commit-pages.json" <<EOF
[{"sha":"$HEAD_SHA","files":[{"filename":".github/workflows/renovate.yaml","status":"modified",
   "additions":1,"deletions":1,"changes":2,
   "patch":"@@ -58 +58 @@\\n-      - uses: renovatebot/github-action@$old_digest  # v46.2.2\\n+      - uses: renovatebot/github-action@$new_digest  # v46.2.4"}]}]
EOF
CASE_RENOVATE_CONTEXT=1 expect_renovate_pass "immutable head-bound pin-line PR needs no human records"

cat > "$WORK/merge-payload.json" <<EOF
{"hook_event_name":"PreToolUse","cwd":"$ROOT","tool_name":"exec_command",
 "tool_input":{"cmd":"$ROOT/scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/45/merge -f sha=$HEAD_SHA -f merge_method=squash","workdir":"$ROOT"}}
EOF
set +e
output="$(AGENT_POLICY_CI=1 AGENT_PROJECT_DIR="$ROOT" \
  AGENT_PR_BODY_FILE="$WORK/body.md" AGENT_PR_HEAD_SHA="$HEAD_SHA" \
  AGENT_CHANGED_FILES_FILE="$WORK/files.txt" AGENT_PR_METADATA_FILE="$WORK/pr.json" \
  AGENT_PR_HEAD_COMMIT_FILE="$WORK/head-commit.json" \
  AGENT_PR_HEAD_COMMIT_PAGES_FILE="$WORK/renovate-head-commit-pages.json" \
  "$ROOT/tools/agent-hooks/require-pr-gates.sh" --no-discovery \
  --payload-file "$WORK/merge-payload.json" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "project-review" \
  || fail "manual merge action used the CI-only Renovate exception"
echo "  PASS  manual merge action cannot use the CI-only exception"
pass=$((pass + 1))

cat > "$WORK/renovate-head-commit-pages.json" <<EOF
[{"sha":"$HEAD_SHA","files":[{"filename":".github/workflows/renovate.yaml","status":"modified",
   "additions":1,"deletions":1,"changes":2,
   "patch":"@@ -1 +1 @@\\n-timeout-minutes: 20\\n+timeout-minutes: 30"}]}]
EOF
CASE_RENOVATE_CONTEXT=1 expect_block \
  "Renovate-shaped PR with a non-action edit keeps human gates" "project-review"

set +e
output="$(AGENT_PR_BODY_FILE="$WORK/body.md" AGENT_PR_HEAD_SHA="$HEAD_SHA" \
  AGENT_CHANGED_FILES_FILE="$WORK/files.txt" AGENT_PR_METADATA_FILE="$WORK/pr.json" \
  "$POLICY" 2>&1)"; rc=$?
set -e
[ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qF "all three authoritative Renovate context files" \
  || fail "partial Renovate context did not fail closed"
echo "  PASS  partial Renovate context fails closed"
pass=$((pass + 1))

echo "== conditional relevance =="
write_body "$HEAD_SHA"
printf 'main/new_feature.cpp\n' > "$WORK/files.txt"
expect_block "missing feature-docs record" "feature-docs"

cat >> "$WORK/body.md" <<EOF
- [x] \`\$feature-docs\` synced — merge gate @ $HEAD_SHA
EOF
expect_pass "current conditional feature record"

write_body "$HEAD_SHA"
printf '.github/workflows/pr-policy.yml\n' > "$WORK/files.txt"
expect_block "policy-workflow change requires feature-docs" "feature-docs"

write_body "$HEAD_SHA"
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
write_body "$HEAD_SHA"
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
