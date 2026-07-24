#!/usr/bin/env bash
# Regression tests for scripts/publish-pages-branch.sh — specifically its CONCURRENCY behaviour.
#
# gh-pages has two independent publishers (the manual release's root publish and every merge's
# dev-channel publish) writing one branch, and they overlap routinely. The failure mode
# they produce is nasty to catch by hand: the loser's push is rejected, its build job goes red,
# and a plain re-run goes green — so it reads as a flake and gets re-run rather than fixed. It
# shipped exactly that way once (PR #149's build).
#
# There used to be four publishers: each PR's preview and pr-preview-cleanup's removal are gone
# with the per-PR preview feature, so the `--pr` / `--rm` modes these tests exercised no longer
# exist. Two publishers still race — a release run and a merge are minutes apart, not serialized —
# so every scenario below is the same one, re-cast onto root vs. dev.
#
# Everything here runs against a throwaway bare repo standing in for origin, so it needs no
# network, no GitHub and no credentials — just git. Seconds long and hardware-free, like the
# logic and domain-audit gates it shares a job with.
#
#   scripts/run-pages-publish-tests.sh [path-to-publish-pages-branch.sh]
#
# Pass a path to test a different copy — running it against the PRE-FIX script is how you check
# these tests still have teeth (it should fail scenarios 3-5).
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
site_dev()   { mkdir -p "$T/$1/_site/dev";   echo "dev-$2"   > "$T/$1/_site/dev/index.html"; }
run()        { local d="$1"; shift; ( cd "$T/$d" && ./scripts/publish-pages-branch.sh "$@" ) >"$T/out.log" 2>&1; }
remote_file(){ git -C "$T/origin.git" show "gh-pages:$1" 2>/dev/null; }
remote_has() { git -C "$T/origin.git" rev-parse --verify -q "gh-pages:$1" >/dev/null 2>&1 && echo yes || echo no; }

clone A; clone B

echo "== 1. first publish ever (orphan path, no gh-pages on the remote) =="
site_root A v1
run A; rc=$?
check "root publish succeeds"      "$rc" "0"
check "root landed"                "$(remote_file index.html)" "root-v1"

echo "== 2. root and dev coexist, each owning only its own slice =="
( cd "$T/B" && git fetch -q origin ); site_dev B d1; run B --dev; rc=$?
check "dev publish succeeds"       "$rc" "0"
check "dev landed"                 "$(remote_file dev/index.html)" "dev-d1"
check "root survived the dev push" "$(remote_file index.html)" "root-v1"

echo "== 3. stale origin/gh-pages: the other publisher landed since our checkout =="
# The CI shape exactly: the runner fetches gh-pages at job start (actions/checkout fetch-depth: 0),
# the other feed publishes during the ~5-minute build, and only then do we push.
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' 2>/dev/null || true )
stale="$(git -C "$T/A" rev-parse refs/remotes/origin/gh-pages)"
site_dev B d2; run B --dev
moved="$(git -C "$T/origin.git" rev-parse gh-pages)"
check "B moved the branch"         "$([ "$stale" != "$moved" ] && echo yes || echo no)" "yes"
site_root A v2; run A; rc=$?
check "A's publish still succeeds" "$rc" "0"
check "A's own root landed"        "$(remote_file index.html)" "root-v2"
check "B's dev preserved"          "$(remote_file dev/index.html)" "dev-d2"

echo "== 4. the same race the other way round (a merge publishes over a fresh release) =="
( cd "$T/B" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_root A v3; run A
site_dev B d3; run B --dev; rc=$?
check "dev publish succeeds"       "$rc" "0"
check "dev updated"                "$(remote_file dev/index.html)" "dev-d3"
check "the new root is preserved"  "$(remote_file index.html)" "root-v3"

echo "== 5. true interleaving: the branch moves BETWEEN our fetch and our push =="
# Scenarios 3-4 only prove the refresh half of the fix — the other publisher is already finished
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
    ( cd "$T/B" && ./scripts/publish-pages-branch.sh --dev ) > "$T/b-interleaved.log" 2>&1
fi
exit \$rc
SHIM
chmod +x "$T/shim/git"
site_dev B d4; site_root A v4
( cd "$T/A" && PATH="$T/shim:$PATH" ./scripts/publish-pages-branch.sh ) >"$T/out.log" 2>&1; rc=$?
check "A survives a mid-run loss"  "$rc" "0"
check "the retry actually ran"     "$([ "$(grep -c 're-applying onto the new tip' "$T/out.log")" -ge 1 ] && echo yes || echo no)" "yes"
check "A's root landed"            "$(remote_file index.html)" "root-v4"
check "B's interleaved dev kept"   "$(remote_file dev/index.html)" "dev-d4"

echo "== 6. each slice is replaced WHOLESALE, so nothing stale can linger =="
# Declarative, not incremental — which is also what makes the retry above sound: re-applying onto
# the winner's commit yields the tree winning would have.
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_dev A d5; echo stale > "$T/A/_site/dev/old.bin"; run A --dev
check "dev stale file present first" "$(remote_has dev/old.bin)" "yes"
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
rm -f "$T/A/_site/dev/old.bin"; site_dev A d6; run A --dev
check "dev replaced wholesale"     "$(remote_file dev/index.html)" "dev-d6"
check "stale dev file gone"        "$(remote_has dev/old.bin)" "no"
check "root still intact"          "$(remote_file index.html)" "root-v4"

echo "== 7. the root sweep takes everything it owns — including a retired PR/ preview =="
# The per-PR preview publisher is gone, so PR/<N>/ trees left on the branch by the old builds have
# no owner and no cleanup workflow. The root sweep used to spare PR/ by name; it must not any
# more, or those previews would stay on the public site forever. dev/ is still spared.
( cd "$T/B" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
git -C "$T/B" worktree add -qf -B gh-pages "$T/ghp" origin/gh-pages
mkdir -p "$T/ghp/PR/42"; echo leftover > "$T/ghp/PR/42/index.html"
git -C "$T/ghp" add -A && git -C "$T/ghp" commit -qm "an old PR preview" && git -C "$T/ghp" push -q origin gh-pages
git -C "$T/B" worktree remove --force "$T/ghp"
check "leftover preview is there"  "$(remote_has PR/42)" "yes"
( cd "$T/B" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_root B v5; run B; rc=$?
check "root publish succeeds"      "$rc" "0"
check "leftover preview swept"     "$(remote_has PR/42)" "no"
check "dev untouched by the sweep" "$(remote_file dev/index.html)" "dev-d6"

echo "== 8. an unknown mode is refused, never treated as a root publish =="
# `--pr <N>` was a real mode until the preview feature was removed. A stale caller must fail
# loudly: silently falling through to `root` would overwrite the RELEASE feed.
run A --pr 7; rc=$?
check "unknown mode exits non-zero" "$([ "$rc" -ne 0 ] && echo yes || echo no)" "yes"
check "release feed untouched"      "$(remote_file index.html)" "root-v5"

echo "== 9. an UNRETRYABLE push failure is fatal immediately, not after 5 rounds =="
# Deliberately asserted on the retry COUNT and not on elapsed time: a wall-clock bound is the
# very kind of assertion that goes intermittently red on a loaded runner, which is the class of
# bug this file exists to prevent.
cat > "$T/origin.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "nope" >&2
exit 1
HOOK
chmod +x "$T/origin.git/hooks/pre-receive"
( cd "$T/A" && git fetch -q origin 'gh-pages:refs/remotes/origin/gh-pages' )
site_dev A d7
run A --dev; rc=$?
check "declined push exits non-zero" "$([ "$rc" -ne 0 ] && echo yes || echo no)" "yes"
check "did not retry"                "$(grep -c 're-applying onto the new tip' "$T/out.log")" "0"
rm -f "$T/origin.git/hooks/pre-receive"

echo "== 10. the RETIRED and malformed argument shapes fail before the branch is touched =="
# Scenario 8 covers a typo'd mode. These are the shapes that were once VALID: `--pr N` / `--rm N`
# published and removed a per-PR preview, so CI history, a stale workflow or a human still types
# them — and a second word silently dropped is what makes a retired call read as a live one
# (a `--pr 12` treated as "root" would republish the RELEASE feed from whatever dist/ holds).
before="$(git -C "$T/origin.git" rev-parse gh-pages)"
run A --pr 12;        rc_pr=$?
run A --rm 12;        rc_rm=$?
run A --pr ../escape; rc_traversal=$?
run A --dev extra;    rc_extra=$?
after="$(git -C "$T/origin.git" rev-parse gh-pages)"
check "retired --pr is rejected"    "$([ "$rc_pr" -ne 0 ] && echo yes || echo no)" "yes"
check "retired --rm is rejected"    "$([ "$rc_rm" -ne 0 ] && echo yes || echo no)" "yes"
check "path-like value is rejected" "$([ "$rc_traversal" -ne 0 ] && echo yes || echo no)" "yes"
check "stray --dev value rejected"  "$([ "$rc_extra" -ne 0 ] && echo yes || echo no)" "yes"
check "invalid calls changed none"  "$after" "$before"

# build-pages.sh has the same boundary on the local side: it `rm -rf`s OUT before rebuilding it,
# and OUT used to be derived from the argument. Exercise a standalone copy with an otherwise-valid
# dist/, so it is argument validation — not a missing artifact — that rejects each call.
mkdir -p "$T/pagebuild/scripts" "$T/pagebuild/dist"
cp scripts/build-pages.sh "$T/pagebuild/scripts/build-pages.sh"
chmod +x "$T/pagebuild/scripts/build-pages.sh"
build_pages() { ( cd "$T/pagebuild" && ./scripts/build-pages.sh "$@" ) >"$T/build-pages.log" 2>&1; }
build_pages ../escape; rc_build_traversal=$?
build_pages 12;        rc_build_pr=$?
build_pages --dev x;   rc_build_extra=$?
check "build rejects a path"        "$([ "$rc_build_traversal" -ne 0 ] && echo yes || echo no)" "yes"
check "build rejects a PR number"   "$([ "$rc_build_pr" -ne 0 ] && echo yes || echo no)" "yes"
check "build rejects a stray value" "$([ "$rc_build_extra" -ne 0 ] && echo yes || echo no)" "yes"
check "invalid build created no site" "$([ ! -e "$T/pagebuild/_site" ] && echo yes || echo no)" "yes"

echo
if [ "$fail" -eq 0 ]; then
    echo "pages publish: all $pass checks passed"
else
    echo "pages publish: $fail of $((pass + fail)) checks FAILED" >&2
fi
[ "$fail" -eq 0 ]
