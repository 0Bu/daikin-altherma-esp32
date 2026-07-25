#!/usr/bin/env bash
# Tests for scripts/check-publish-version.sh — the guard that refuses to publish a feed backwards.
#
# The ORDERING rule it applies is already host-tested (ota_is_upgrade, test/test_logic.cpp); what is
# untested until here is the plumbing around it: which manifest each mode reads, what "nothing
# published yet" means, and whether a malformed reference fails closed. Those are exactly the paths
# that only ever run in CI, on the one day something is wrong.
#
# Runs against a throwaway bare repo standing in for origin — no network, no credentials, just git,
# python3 and a C++17 compiler.
#
#   scripts/run-publish-version-tests.sh
# No `set -e`: a failing check must be counted and reported, not abort the suite.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
REPO="$PWD"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# --- a checkout with the script under test + a bare origin that may or may not have gh-pages ------
git init -q --bare "$T/origin.git"
git init -q "$T/work"
(
  cd "$T/work" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  mkdir -p scripts tools/version main/logic
  cp "$REPO/scripts/check-publish-version.sh" scripts/
  cp "$REPO/tools/version/publish_gate.cpp"   tools/version/
  cp "$REPO/main/logic/version_cmp.hpp"       main/logic/
  chmod +x scripts/check-publish-version.sh
  echo seed > README.md && git add -A && git commit -qm seed
  git branch -M main && git remote add origin "$T/origin.git" && git push -q origin main
)

# publish <root-version> <dev-version>: (re)create gh-pages on the bare origin with those manifests.
publish() {
  rm -rf "$T/pages"; git init -q "$T/pages"
  (
    cd "$T/pages" || exit 1
    git config user.email t@t; git config user.name t; git config commit.gpgsign false
    mkdir -p dev
    printf '{"name":"x","version":"%s"}\n' "$1" > manifest.json
    [ -n "${2:-}" ] && printf '{"name":"x","version":"%s"}\n' "$2" > dev/manifest.json
    git add -A && git commit -qm pages
    git branch -M gh-pages && git remote add origin "$T/origin.git" && git push -qf origin gh-pages
  )
}
run() { ( cd "$T/work" && ./scripts/check-publish-version.sh "$@" ) >"$T/out.log" 2>&1; }

echo "== 1. no gh-pages at all: the first publish ever is not blocked =="
run release 1.0.0; check "release passes" "$?" "0"
run dev 1.0.0-dev.1; check "dev passes"   "$?" "0"

echo "== 2. each mode reads its OWN feed's manifest =="
publish 1.0.13 1.0.14-dev.2
run release 1.0.14;      check "release: newer than the root manifest"     "$?" "0"
run release 1.0.14-dev.3; check "release: a dev build is not a release"    "$?" "1"
run dev 1.0.14-dev.3;    check "dev: newer than the dev manifest"          "$?" "0"
run dev 1.0.13;          check "dev: older than the dev manifest"          "$?" "1"

echo "== 3. THE REGRESSION THIS EXISTS FOR: a lost tag resets the numbering =="
# Deleting the v* tags made next-version.sh fall back to the version.txt floor, so the dev feed went
# 1.0.14-dev.2 -> 1.0.0-dev.168 and CI stayed green. It must not stay green.
run dev 1.0.0-dev.168; check "backwards dev publish is refused" "$?" "1"
check "and it says which feed" "$(grep -c 'dev feed currently serves 1.0.14-dev.2' "$T/out.log")" "1"
check "and names the cause"    "$(grep -c 'v\* TAG list' "$T/out.log")" "1"
# The same reset on the release side: version.txt's 1.0.0 floor under a published 1.0.13.
run release 1.0.0;     check "backwards release publish is refused" "$?" "1"

echo "== 4. republishing the SAME version is refused too =="
# Not pedantry: an identical version is what a device sees forever as "an update it already has",
# and it is what a re-run of a release dispatch produces.
run release 1.0.13;    check "equal release version refused" "$?" "1"
run dev 1.0.14-dev.2;  check "equal dev version refused"     "$?" "1"

echo "== 5. modes that publish nothing are skipped, unknown modes are not =="
run pr 1.0.14-PR-7;    check "pr is skipped"      "$?" "0"
run none 1.0.14;       check "none is skipped"    "$?" "0"
run publish 1.0.14;    check "unknown mode fails" "$?" "2"
run release "";        check "missing version"    "$?" "2"

echo "== 6. an unreadable reference fails CLOSED, it does not read as 'nothing published' =="
publish 1.0.13 ""                      # dev/manifest.json absent -> first publish of that feed
run dev 1.0.0-dev.1; check "absent dev manifest passes" "$?" "0"
rm -rf "$T/pages"; git init -q "$T/pages"
(
  cd "$T/pages" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  echo '{ this is not json' > manifest.json
  git add -A && git commit -qm pages
  git branch -M gh-pages && git remote add origin "$T/origin.git" && git push -qf origin gh-pages
)
run release 9.9.9; check "malformed manifest refuses" "$?" "2"

echo
if [ "$fail" -eq 0 ]; then
    echo "publish version gate: all $pass checks passed"
else
    echo "publish version gate: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
