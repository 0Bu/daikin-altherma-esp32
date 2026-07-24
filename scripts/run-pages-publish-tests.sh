#!/usr/bin/env bash
# Regression tests for scripts/publish-pages-branch.sh — specifically its CONCURRENCY behaviour.
#
# gh-pages has three independent publishers (main's root publish, each PR's preview, and
# pr-preview-cleanup's removal) writing one branch, and they overlap routinely. The failure mode
# they produce is nasty to catch by hand: the loser's push is rejected, its build job goes red,
# and a plain re-run goes green — so it reads as a flake and gets re-run rather than fixed. It
# shipped exactly that way once (PR #149's build).
#
# Everything here runs against a throwaway bare repo standing in for origin, so it needs no
# network, no GitHub and no credentials — just git. Seconds long and hardware-free, like the
# logic-test and domain-audit gates.
#
#   scripts/run-pages-publish-tests.sh [path-to-publish-pages-branch.sh]
#
# Pass a path to test a different copy — running it against the PRE-FIX script is how you check
# these tests still have teeth (it should fail scenarios 3-5 and 7).
# No `set -e`: a failing check must be counted and reported, not abort the suite mid-scenario.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SCRIPT="$(cd "$(dirname "${1:-scripts/publish-pages-branch.sh}")" && pwd)/$(basename "${1:-scripts/publish-pages-branch.sh}")"
[ -f "$SCRIPT" ] || { echo "no such script: $SCRIPT" >&2; exit 1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; fail=0

ok()   { echo "  PASS  $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail + 1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# --- a bare origin + two independent clones, each standing in for a CI runner ----------
git init -q --bare "$T/origin.git"
git init -q "$T/seed" && (
  cd "$T/seed" || exit 1
  git config user.email t@t; git config user.name t; git config commit.gpgsign false
  echo seed > README.md && git add -A && git commit -qm seed
  git branch -M main && git remote add origin "$T/origin.git" && git push -q origin main
)
# The bare repo's HEAD still names the init-time default (master) — a clone of it checks out
# nothing, and the script's first-publish path needs a real HEAD to detach from.
git -C "$T/origin.git" symbolic-ref HEAD refs/heads/main

clone() {   # clone <name>: a checkout with the script under test + room for a _site fixture
  git clone -q "$T/origin.git" "$T/$1"
  ( cd "$T/$1" || exit 1
    git config user.email t@t; git config user.name t; git config commit.gpgsign false
    mkdir -p scripts && cp "$SCRIPT" scripts/publish-pages-branch.sh
    chmod +x scripts/publish-pages-branch.sh )
}
site_root()  { mkdir -p "$T/$1/_site";       echo "root-$2"  > "$T/$1/_site/index.html"; }
site_pr()    { mkdir -p "$T/$1/_site/PR/$2"; echo "pr-$2-$3" > "$T/$1/_site/PR/$2/index.html"; }
run()        { local d="$1"; shift; ( cd "$T/$d" && ./scripts/publish-pages-branch.sh "$@" ) >"$T/out.log" 2>&1; }
remote_file(){ git -C "$T/origin.git" show "gh-pages:$1" 2>/dev/null; }
remote_has() { git -C "$T/origin.git" rev-parse --verify -q "gh-pages:$1" >/dev/null 2>&1 && echo yes || echo no; }

clone A; clone B

echo "== 1. first publish ever (orphan path, no gh-pages on the remote) =="
site_root A v1
run A; rc=$?
check "root publish succeeds"      "$rc" "0"
check "root landed"                "$(remote_file index.html)" "root-v1"

echo "== 2. two PR previews + the root coexist =="
site_pr A 1 a; run A --pr 1; rc1=$?
site_pr B 2 b; ( cd "$T/B" && git fetch -q origin ); run B --pr 2; rc2=$?
check "PR/1 publish succeeds"      "$rc1" "0"
check "PR/2 publish succeeds"      "$rc2" "0"
check "PR/1 present"               "$(remote_file PR/1/index.html)" "pr-1-a"
check "PR/2 present"               "$(remote_file PR/2/index.html)" "pr-2-b"
check "root survived both"         "$(remote_file index.html)" "root-v1"

echo "== 3. stale origin/gh-pages: another publisher landed since our checkout =="
# The CI shape exactly: the runner fetches gh-pages at job start (actions/checkout fetch-depth: 0),
# another PR publishes during the ~5-minute build, and only then do we push.
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' 2>/dev/null || true )
stale="$(git -C "$T/A" rev-parse refs/remotes/origin/gh-pages)"
site_pr B 2 b2; run B --pr 2
moved="$(git -C "$T/origin.git" rev-parse gh-pages)"
check "B moved the branch"         "$([ "$stale" != "$moved" ] && echo yes || echo no)" "yes"
site_pr A 3 a3; run A --pr 3; rc=$?
check "A's publish still succeeds" "$rc" "0"
check "A's own PR/3 landed"        "$(remote_file PR/3/index.html)" "pr-3-a3"
check "B's PR/2 preserved"         "$(remote_file PR/2/index.html)" "pr-2-b2"
check "PR/1 untouched"             "$(remote_file PR/1/index.html)" "pr-1-a"
check "root untouched"             "$(remote_file index.html)" "root-v1"

echo "== 4. a root publish races a PR publish (main vs PR, not only PR vs PR) =="
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_pr B 4 b4; run B --pr 4
site_root A v2; run A; rc=$?
check "root publish succeeds"      "$rc" "0"
check "root updated"               "$(remote_file index.html)" "root-v2"
check "PR/4 preserved by root"     "$(remote_file PR/4/index.html)" "pr-4-b4"
check "PR/3 preserved by root"     "$(remote_file PR/3/index.html)" "pr-3-a3"

echo "== 5. --rm races too (pr-preview-cleanup vs a live publish) =="
( cd "$T/B" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_pr A 5 a5; run A --pr 5
run B --rm 1; rc=$?
check "--rm succeeds"              "$rc" "0"
check "PR/1 removed"               "$(remote_has PR/1)" "no"
check "PR/5 (the racer) survived"  "$(remote_file PR/5/index.html)" "pr-5-a5"

echo "== 6. true interleaving: the branch moves BETWEEN our fetch and our push =="
# Scenarios 3-5 only prove the refresh half of the fix — the other publisher is already finished
# when we start, so our fresh fetch sees its commit and the FIRST push succeeds. The retry loop
# never runs. Force the real interleaving with a `git` shim on A's PATH that lets B publish from
# inside A's fetch, so A's push is a genuine non-fast-forward.
REALGIT="$(command -v git)"
mkdir -p "$T/shim"
cat > "$T/shim/git" <<SHIM
#!/usr/bin/env bash
"$REALGIT" "\$@"; rc=\$?
if [ ! -e "$T/raced" ] && [ "\$1" = "fetch" ] && printf '%s ' "\$@" | grep -q gh-pages; then
    touch "$T/raced"      # once only — B's own publish runs through this same shim
    ( cd "$T/B" && ./scripts/publish-pages-branch.sh --pr 8 ) > "$T/b-interleaved.log" 2>&1
fi
exit \$rc
SHIM
chmod +x "$T/shim/git"
site_pr B 8 b8; site_pr A 7 a7
( cd "$T/A" && PATH="$T/shim:$PATH" ./scripts/publish-pages-branch.sh --pr 7 ) >"$T/out.log" 2>&1; rc=$?
check "A survives a mid-run loss"  "$rc" "0"
check "the retry actually ran"     "$([ "$(grep -c 're-applying onto the new tip' "$T/out.log")" -ge 1 ] && echo yes || echo no)" "yes"
check "A's PR/7 landed"            "$(remote_file PR/7/index.html)" "pr-7-a7"
check "B's interleaved PR/8 kept"  "$(remote_file PR/8/index.html)" "pr-8-b8"
check "root still intact"          "$(remote_file index.html)" "root-v2"

echo "== 7. an UNRETRYABLE push failure is fatal immediately, not after 5 rounds =="
# Deliberately asserted on the retry COUNT and not on elapsed time: a wall-clock bound is the
# very kind of assertion that goes intermittently red on a loaded runner, which is the class of
# bug this file exists to prevent.
cat > "$T/origin.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "nope" >&2
exit 1
HOOK
chmod +x "$T/origin.git/hooks/pre-receive"
site_pr A 6 a6
run A --pr 6; rc=$?
check "declined push exits non-zero" "$([ "$rc" -ne 0 ] && echo yes || echo no)" "yes"
check "did not retry"                "$(grep -c 're-applying onto the new tip' "$T/out.log")" "0"
rm -f "$T/origin.git/hooks/pre-receive"

echo
if [ "$fail" -eq 0 ]; then
    echo "pages publish: all $pass checks passed"
else
    echo "pages publish: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
