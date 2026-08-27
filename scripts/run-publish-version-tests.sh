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
SOURCE_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SOURCE_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

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

# publish <root-version> <dev-version> [root-source] [dev-source]: (re)create gh-pages.
# `no-provenance` deliberately models a manifest written by the pre-provenance workflow.
publish() {
  local root_source="${3:-$SOURCE_A}"
  local dev_source="${4:-$SOURCE_A}"
  rm -rf "$T/pages"; git init -q "$T/pages"
  (
    cd "$T/pages" || exit 1
    git config user.email t@t; git config user.name t; git config commit.gpgsign false
    mkdir -p dev
    if [ "$root_source" = no-provenance ]; then
      printf '{"name":"x","version":"%s"}\n' "$1" > manifest.json
    else
      printf '{"name":"x","version":"%s","provenance":{"source_sha":"%s"}}\n' \
        "$1" "$root_source" > manifest.json
    fi
    if [ -n "${2:-}" ]; then
      if [ "$dev_source" = no-provenance ]; then
        printf '{"name":"x","version":"%s"}\n' "$2" > dev/manifest.json
      else
        printf '{"name":"x","version":"%s","provenance":{"source_sha":"%s"}}\n' \
          "$2" "$dev_source" > dev/manifest.json
      fi
    fi
    git add -A && git commit -qm pages
    git branch -M gh-pages && git remote add origin "$T/origin.git" && git push -qf origin gh-pages
  )
}
run() { ( cd "$T/work" && ./scripts/check-publish-version.sh "$@" ) >"$T/out.log" 2>&1; }

echo "== 1. no gh-pages at all: the first publish ever is not blocked =="
run release 1.0.0; check "release passes" "$?" "0"
run dev 1.0.0-dev.1; check "dev passes"   "$?" "0"
run --source-sha "$SOURCE_A" release-resume 1.0.0
check "first release-resume passes with an explicit source" "$?" "0"
run --source-sha "$SOURCE_A" dev-resume 1.0.0-dev.1
check "first dev-resume passes with an explicit source" "$?" "0"

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

echo "== 5. a RELEASE resume may repeat exactly one stable version =="
run release-resume 1.0.13
check "resume without source identity is refused" "$?" "2"
run --source-sha "$SOURCE_A" release-resume 1.0.13
check "equal release and identical source pass" "$?" "0"
run --source-sha "$SOURCE_B" release-resume 1.0.13
check "equal release from different source is refused" "$?" "1"
check "source mismatch names both identities" \
      "$(grep -c "$SOURCE_A.*$SOURCE_B" "$T/out.log")" "1"
run --source-sha "$SOURCE_A" release-resume 1.0.14
check "new stable release still passes" "$?" "0"
run --source-sha "$SOURCE_A" release-resume 1.0.13-rc.1
check "pre-release resume is refused" "$?" "1"
run --source-sha "$SOURCE_A" release-resume 1.0.12
check "older release resume is refused" "$?" "1"

publish 1.0.13 1.0.14-dev.2 no-provenance
run --source-sha "$SOURCE_A" release-resume 1.0.13
check "equal legacy manifest without provenance fails closed" "$?" "2"
publish 1.0.13 1.0.14-dev.2 short-source
run --source-sha "$SOURCE_A" release-resume 1.0.13
check "equal manifest with malformed source fails closed" "$?" "2"
publish 1.0.13 1.0.14-dev.2

echo "== 5b. a DEV resume may repeat only the exact source-bound dev version =="
run dev-resume 1.0.14-dev.2
check "dev resume without source identity is refused" "$?" "2"
run --source-sha "$SOURCE_A" dev-resume 1.0.14-dev.2
check "equal dev version and identical source pass" "$?" "0"
run --source-sha "$SOURCE_B" dev-resume 1.0.14-dev.2
check "equal dev version from different source is refused" "$?" "1"
run --source-sha "$SOURCE_A" dev-resume 1.0.14-dev.3
check "newer dev version still passes through resume mode" "$?" "0"
publish 1.0.13 1.0.14-dev.2 "$SOURCE_A" no-provenance
run --source-sha "$SOURCE_A" dev-resume 1.0.14-dev.2
check "equal legacy dev manifest without provenance fails closed" "$?" "2"
publish 1.0.13 1.0.14-dev.2 "$SOURCE_A" short-source
run --source-sha "$SOURCE_A" dev-resume 1.0.14-dev.2
check "equal dev manifest with malformed source fails closed" "$?" "2"
publish 1.0.13 1.0.14
run --source-sha "$SOURCE_A" dev-resume 1.0.14
check "equal stable version is not accepted as a dev resume" "$?" "2"
publish 1.0.13 1.0.14-dev.2

echo "== 6. modes that publish nothing are skipped, unknown modes are not =="
run pr 1.0.14-PR-7;    check "pr is skipped"      "$?" "0"
run none 1.0.14;       check "none is skipped"    "$?" "0"
run publish 1.0.14;    check "unknown mode fails" "$?" "2"
run release "";        check "missing version"    "$?" "2"

echo "== 7. an unreadable reference fails CLOSED, it does not read as 'nothing published' =="
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

# An UNREACHABLE remote is not an empty one. Both make `git fetch` fail, and reading that failure as
# "nothing published yet" made the guard pass on every network blip, expired token and GitHub outage
# — fail-open in the one script written to fail loud. Point the checkout at a remote that does not
# exist: the reference is unknown, so the answer must be 2 (refuse), never 0.
(
  cd "$T/work" || exit 1
  git remote set-url origin "$T/does-not-exist.git"
) >/dev/null 2>&1
run release 9.9.9; check "an unreachable remote refuses (fail closed)" "$?" "2"
check "and it says the reference is unknown" \
      "$(grep -c 'reference is UNKNOWN' "$T/out.log")" "1"
( cd "$T/work" && git remote set-url origin "$T/origin.git" ) >/dev/null 2>&1

echo
if [ "$fail" -eq 0 ]; then
    echo "publish version gate: all $pass checks passed"
else
    echo "publish version gate: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
