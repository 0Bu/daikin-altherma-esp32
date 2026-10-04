#!/usr/bin/env bash
# Tests for build change detection and browser filter scoping.
#
# Covers the acceptance matrix for CI change detection:
# 1. Dev manifest source resolution on gh-pages (check-dev-manifest-source.sh)
# 2. Missing references, unreachable remotes, malformed manifests, non-ancestors
# 3. Same source repetition
# 4. Failed publish / "Firmware-Push B, danach Dokumentations-Push C"
# 5. Long changed file lists without pipefail SIGPIPE issues
# 6. Multiple push commits
# 7. Browser filter with tools/ui_localization/ and unresolvable diffs
# 8. Main serialization and waiting release contract
set -uo pipefail
umask 0022
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# Initialize bare origin and local working repository
git init -q --bare "$T/origin.git"
git init -q "$T/work"
(
  cd "$T/work" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  mkdir -p scripts tools/version main/logic main/www docs
  cp "$REPO/scripts/check-dev-manifest-source.sh" scripts/
  cp "$REPO/scripts/run-browser-render-tests.sh"   scripts/
  chmod +x scripts/*.sh
  echo "seed" > README.md
  git add -A && git commit -qm "feat: initial commit"
  git branch -M main && git remote add origin "$T/origin.git" && git push -q origin main
)

publish_dev_manifest() {
  local dev_source="$1"
  local malformed="${2:-false}"
  rm -rf "$T/pages"; git init -q "$T/pages"
  (
    cd "$T/pages" || exit 1
    git config user.email t@t; git config user.name t; git config commit.gpgsign false
    mkdir -p dev
    if [ "$malformed" = "bad_json" ]; then
      echo "{ corrupt json" > dev/manifest.json
    elif [ "$malformed" = "no_provenance" ]; then
      printf '{"name":"x","version":"1.0.0-dev.1"}\n' > dev/manifest.json
    elif [ "$malformed" = "bad_sha" ]; then
      printf '{"name":"x","version":"1.0.0-dev.1","provenance":{"source_sha":"short"}}\n' > dev/manifest.json
    else
      printf '{"name":"x","version":"1.0.0-dev.1","provenance":{"source_sha":"%s"}}\n' "$dev_source" > dev/manifest.json
    fi
    git add -A && git commit -qm pages
    git branch -M gh-pages && git remote add origin "$T/origin.git" && git push -qf origin gh-pages
  )
}

echo "== 1. check-dev-manifest-source: missing branches and unresolvable references =="
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "no gh-pages branch fails closed (rc=2)" "$?" "2"

# Push gh-pages with NO dev/manifest.json
rm -rf "$T/pages"; git init -q "$T/pages"
(
  cd "$T/pages" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  touch root_only.txt && git add -A && git commit -qm pages
  git branch -M gh-pages && git remote add origin "$T/origin.git" && git push -qf origin gh-pages
)
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "gh-pages without dev/manifest.json fails closed (rc=2)" "$?" "2"

echo "== 2. check-dev-manifest-source: unreachable remote =="
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh nonexistent >"$T/out.log" 2>&1
)
check "unreachable remote fails closed (rc=2)" "$?" "2"

echo "== 3. check-dev-manifest-source: corrupt / malformed manifests =="
publish_dev_manifest "dummy" "bad_json"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "corrupt JSON manifest fails closed (rc=2)" "$?" "2"

publish_dev_manifest "dummy" "no_provenance"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "manifest without provenance fails closed (rc=2)" "$?" "2"

publish_dev_manifest "dummy" "bad_sha"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "manifest with malformed sha fails closed (rc=2)" "$?" "2"

echo "== 4. check-dev-manifest-source: unknown and divergent commits =="
publish_dev_manifest "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "unknown source_sha not in repo fails closed (rc=2)" "$?" "2"

# Create a divergent commit on an orphan branch
divergent_sha="$(
  cd "$T/work" || exit 1
  git checkout -q --orphan divergent_branch
  echo "divergent" > divergent.txt
  git add -A && git commit -qm "divergent"
  git rev-parse HEAD
)"
( cd "$T/work" && git checkout -q main )
publish_dev_manifest "$divergent_sha"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "divergent source_sha not ancestor of target fails closed (rc=2)" "$?" "2"

echo "== 5. check-dev-manifest-source: valid ancestor and same-source repetition =="
commit_A="$(cd "$T/work" && git rev-parse HEAD)"
publish_dev_manifest "$commit_A"
(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin >"$T/out.log" 2>&1
)
check "same source as HEAD returns 1 (same_source)" "$?" "1"

# Add commit B to main
(
  cd "$T/work" || exit 1
  echo "firmware edit" >> main/hp_poll.cpp
  git add main/hp_poll.cpp && git commit -qm "feat: firmware change"
)
commit_B="$(cd "$T/work" && git rev-parse HEAD)"
res_sha="$(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin
)"
check "valid ancestor resolves to published source A" "$res_sha" "$commit_A"

echo "== 6. scenario: Firmware-Push B, danach Dokumentations-Push C =="
# Add commit C (docs only)
(
  cd "$T/work" || exit 1
  echo "docs edit" >> README.md
  git add README.md && git commit -qm "docs: update readme"
)
commit_C="$(cd "$T/work" && git rev-parse HEAD)"
# Because publish for B never happened, published dev manifest still points to A!
res_sha_C="$(
  cd "$T/work" || exit 1
  ./scripts/check-dev-manifest-source.sh origin
)"
check "dev manifest source for push C still resolves to A" "$res_sha_C" "$commit_A"

# Verify that git diff A..C catches the firmware change from B
relevant_pattern='^(LICENSE$|THIRD_PARTY_NOTICES[.]md$|main/|CMakeLists[.]txt$|sdkconfig[.]defaults$|dependencies[.]lock$|partitions[.]csv$|version[.]txt$|docs/(index[.]html|serial-port-release[.]mjs|web-installer[.]mjs)$|[.]github/workflows/build[.]yml$|scripts/(ci-build-all|build-pages|next-version|publish-pages-branch|require-signed|check-publish-version|idf-version|check-nonflashable-artifacts|check-dev-manifest-source)[.]sh$|scripts/pages-commit-payload[.]mjs$|scripts/(generate-ota-changelog|check-sdkconfig-defaults|report-firmware-size|check-web-installer-plan|check-manifest-provenance|check-signing-key-continuity|check-stack-budget|check-reproducible-build|verify-published-artifacts|production-ota-gate)[.]py$|tools/(version|web_asset|release|stack)/)'

diff_files="$(cd "$T/work" && git diff --name-only "$res_sha_C" "$commit_C")"
if printf '%s\n' "$diff_files" | grep -qE "$relevant_pattern"; then
  ok "firmware change in B is visible in A..C diff"
else
  bad "firmware change in B was missed in A..C diff"
fi

# Now publish C
publish_dev_manifest "$commit_C"
# Now push D (docs only)
(
  cd "$T/work" || exit 1
  echo "more docs" >> docs/ARCHITECTURE.md
  git add docs/ARCHITECTURE.md && git commit -qm "docs: arch update"
)
commit_D="$(cd "$T/work" && git rev-parse HEAD)"
res_sha_D="$(cd "$T/work" && ./scripts/check-dev-manifest-source.sh origin)"
check "dev manifest source for push D resolves to C" "$res_sha_D" "$commit_C"

diff_files_D="$(cd "$T/work" && git diff --name-only "$res_sha_D" "$commit_D")"
if printf '%s\n' "$diff_files_D" | grep -qE "$relevant_pattern"; then
  bad "docs-only push D unexpectedly matched firmware pattern"
else
  ok "docs-only push D correctly skipped firmware build"
fi

echo "== 7. long file lists without pipefail SIGPIPE =="
(
  cd "$T/work" || exit 1
  mkdir -p many_files
  for i in $(seq 1 300); do
    echo "$i" > "many_files/file_$i.txt"
  done
  echo "firmware edit" >> main/hp_poll.cpp
  git add -A && git commit -qm "test: 300 files"
)
long_commit="$(cd "$T/work" && git rev-parse HEAD)"
# Test diff with pipefail
set -e
diff_out="$(cd "$T/work" && git diff --name-only HEAD^1 HEAD)"
matched_relevant="no"
if printf '%s\n' "$diff_out" | grep -qE "$relevant_pattern"; then
  matched_relevant="yes"
fi
check "long file list parsed safely without pipefail failure" "$matched_relevant" "yes"

echo "== 8. browser filter: --if-ui-changed scoping =="
# Test docs-only commit skips browser render tests
(
  cd "$T/work" || exit 1
  echo "doc" >> docs/REPORTING.md
  git add docs/REPORTING.md && git commit -qm "docs: test reporting"
)
out="$(cd "$T/work" && ./scripts/run-browser-render-tests.sh --if-ui-changed 2>&1)" || true
check "docs-only commit skips browser render tests" \
      "$(echo "$out" | grep -c "no UI/browser-relevant changes in diff; skipped")" "1"

# Test tools/ui_localization/ modification triggers browser render test (does not skip)
(
  cd "$T/work" || exit 1
  mkdir -p tools/ui_localization
  echo "i18n update" >> tools/ui_localization/test.txt
  git add tools/ui_localization && git commit -qm "i18n update"
)
out_ui="$(cd "$T/work" && ./scripts/run-browser-render-tests.sh --if-ui-changed 2>&1)" || true
check "tools/ui_localization/ change is NOT skipped" \
      "$(echo "$out_ui" | grep -c "no UI/browser-relevant changes in diff; skipped")" "0"

echo "== 9. workflow concurrency and release serialization contract =="
python3 - "$REPO/.github/workflows/build.yml" <<'PY'
import re, sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8")
concurrency_match = re.search(r"(?m)^concurrency:\s*\n\s*group:\s*([^\n]+)\n\s*cancel-in-progress:\s*([^\n]+)", text)
if not concurrency_match:
    sys.exit("missing concurrency configuration in build.yml")

group_expr = concurrency_match.group(1).strip()
cancel_expr = concurrency_match.group(2).strip()

# Check that group serializes on PR number or ref
if "${{ github.event.pull_request.number || github.ref }}" not in group_expr:
    sys.exit(f"concurrency group does not serialize on ref/PR: {group_expr}")

# Check that cancel-in-progress is FALSE for refs/heads/main
if "github.ref != 'refs/heads/main'" not in cancel_expr:
    sys.exit(f"concurrency cancel-in-progress does not preserve main: {cancel_expr}")

print("concurrency contract verified: main serializes without cancel-in-progress")
PY
check "workflow concurrency protects main serialization" "$?" "0"

echo
if [ "$fail" -eq 0 ]; then
    echo "build change detection tests: all $pass checks passed"
else
    echo "build change detection tests: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
