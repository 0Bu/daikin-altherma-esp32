#!/usr/bin/env bash
# Publish/maintain the gh-pages branch that hosts the browser installer. A gh-pages BRANCH (not
# the Actions Pages artifact) is required because the browser flasher fetches every part in-page
# and needs the bins same-origin, and the two feeds (the release root and dev/) are published
# independently — minutes or weeks apart — which the atomic whole-site Actions deploy cannot do.
#
# The branch is sliced by OWNER, and every mode states only its own slice: a manual RELEASE run
# owns the ROOT, every merge to main owns dev/. A root publish preserves the existing dev/ tree; a
# dev publish touches only dev/. Usage:
#   scripts/publish-pages-branch.sh              # publish _site/ as the root (a release)
#   scripts/publish-pages-branch.sh --dev        # publish _site/dev/ only (a merge to main)
#
# There was a third slice, PR/<N>/ — a per-PR preview installer, published by every PR build and
# removed by a pr-preview-cleanup workflow. It is gone: the dev channel now serves the same need
# (try what is on main, in a browser) for one publish per merge instead of one per PR commit, and
# each publish here also costs a full GitHub "pages build and deployment" run. The root sweep
# below therefore no longer spares PR/, which is what finally clears the previews left on the
# branch by the old builds.
#
# The root's "delete everything I do not own" sweep is why dev/ has to be named there explicitly:
# a release would otherwise take the dev feed offline until the next merge republished
# it, and every device on the dev channel would report its check as a failed fetch in the meantime.
#
# CONCURRENCY: gh-pages is ONE branch with two independent publishers — the release root
# publish and every merge's dev publish —
# and they overlap routinely. Actions
# cannot serialize them for us: a `concurrency:` group is per job, and this publish is the last
# step of a ~5-minute firmware build, so grouping the job would serialize that whole build to
# protect a 2-second push. The script therefore has to SURVIVE losing the race rather
# than avoid it: publish onto the tip the remote has right now, and if someone lands first,
# re-apply onto their result and push again (see apply_mutation + the push loop below).
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-root}"
PUSH_ATTEMPTS=5

# Validate + name the commit before touching the network: a malformed call should not first spend
# a clone and a fetch to find out. An UNKNOWN argument is rejected rather than treated as a root
# publish — `--pr 12` used to be a real mode, and silently publishing the root instead would
# overwrite the release feed with whatever dist/ happened to hold.
# The arity is checked as strictly as the mode name: neither mode takes a value, so `--dev 12` or
# `--pr 12` (the retired mode, whose second word used to be the PR number) must fail rather than
# have its extra word silently dropped — which is how a retired call reads as a valid one.
case "$mode" in
    --dev) [ "$#" -eq 1 ] || { echo "publish: --dev takes no value" >&2; exit 1; }
           msg="pages: publish dev channel" ;;
    root)  [ "$#" -le 1 ] || { echo "publish: root takes no value" >&2; exit 1; }
           msg="pages: publish root" ;;
    *)     echo "publish: unknown mode '$mode' (expected no argument, or --dev)" >&2; exit 1 ;;
esac

git config user.name  "github-actions[bot]" 2>/dev/null || true
git config user.email "github-actions[bot]@users.noreply.github.com" 2>/dev/null || true

work="$(mktemp -d)"
# A publish can now exit non-zero (contested branch, unretryable push), so clean up on every path
# instead of only the happy one — a leaked worktree would make the NEXT run's `worktree add` fight
# a stale registration.
trap 'git worktree remove --force "$work" >/dev/null 2>&1 || rm -rf "$work"' EXIT

# "Not fetched" is not "does not exist" — and, the half this used to miss, "fetched" is not "up to
# date". A checkout that never fetched gh-pages (actions/checkout defaults to fetch-depth 1, i.e.
# the one ref it checked out) has no origin/gh-pages, and taking the --orphan path there builds a
# history disjoint from the live branch — the push is then rejected and the caller fails every
# time. But the real caller DOES fetch it (build.yml checks out with
# fetch-depth: 0), which froze origin/gh-pages at job start: by push time it is minutes old, and
# publishing from that snapshot is precisely how a concurrent publisher's commit gets rejected.
# So ask the REMOTE whether the branch exists, and whenever it does, refresh the tracking ref
# rather than trusting the checkout's copy. An ls-remote failure stays fatal (set -e) instead of
# silently degrading into the orphan path.
remote_tip_fetched() {
    local head
    head="$(git ls-remote --heads origin gh-pages)"   # empty = truly no branch yet
    [ -n "$head" ] || return 1
    git fetch --quiet --no-tags --force origin gh-pages:refs/remotes/origin/gh-pages
}

if remote_tip_fetched; then
    # Branch from the REMOTE ref explicitly. `worktree add <path> gh-pages` resolves only a LOCAL
    # branch, and in any CI checkout gh-pages exists solely as a remote-tracking ref -> "invalid
    # reference" (worktree's DWIM to <remote>/<branch> is opt-in via --guess-remote). -B also
    # re-points a stale local gh-pages at the remote, so we always publish onto the live tree.
    git worktree add -f -B gh-pages "$work" origin/gh-pages
elif git show-ref --quiet refs/heads/gh-pages; then
    git worktree add -f "$work" gh-pages          # local-only branch: never pushed yet
else
    # First publish ever: start gh-pages as an unborn branch with an empty tree. Done with
    # `checkout --orphan` inside a detached worktree rather than `worktree add --orphan`, whose
    # signature moved between git releases (it takes no branch argument here, so the obvious
    # `--orphan gh-pages "$work"` reads "$work" as a commit-ish and dies) — this idiom is stable
    # across versions, and this path gets exactly one chance: it is the site going live.
    # Only the `git rm` may fail (it errors on an already-empty tree) — keep the `|| true` scoped to
    # it, so a failing --orphan checkout still aborts here instead of surfacing as a baffling
    # "src refspec gh-pages does not match any" from the push at the end.
    git worktree add -f --detach "$work" HEAD
    git -C "$work" checkout --quiet --orphan gh-pages
    git -C "$work" rm -rqf . >/dev/null 2>&1 || true
fi

# Each mode is DECLARATIVE, not incremental — it states what its own slice of the tree must end up
# being, and reads nothing out of the tree it is editing. That is what makes the retry below sound:
# re-running any of these on top of somebody else's newer commit produces the same tree it would
# have produced had we won the race, so a lost race costs a round trip and never a wrong site.
# Keep it that way: an "append to what's there" mode could not be retried this cheaply.
apply_mutation() {
    case "$mode" in
        --dev)
            rm -rf "$work/dev"; mkdir -p "$work/dev"
            cp -R _site/dev/. "$work/dev/" ;;
        root)
            # Everything at the top level that the root does NOT own is named here — which is
            # dev/, and only dev/: it belongs to the other publisher, and sweeping it away would
            # take the dev feed offline until the next merge happened to republish it. Anything
            # else at the top level IS the root's, including the PR/ tree the retired preview
            # publisher left behind, which this sweep removes on the next release.
            find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name dev -exec rm -rf {} +
            # ...and the root's own copy must not drag dev/ back in either: _site/ still holds the
            # dev/ subtree when one job builds both (a release run assembles only the root, but a
            # future caller reusing _site/ would). Copy the root files only.
            find _site -mindepth 1 -maxdepth 1 ! -name dev -exec cp -R {} "$work/" \; ;;
    esac
}

# Discard the attempt that lost and re-point the worktree at whatever is on the remote NOW. Also
# the path that rescues a first-publish orphan whose branch was created underneath it: the reset
# lands the unborn branch on the real history instead of leaving it disjoint forever.
reset_to_remote_tip() {
    remote_tip_fetched || { echo "publish: gh-pages disappeared from the remote mid-publish" >&2; return 1; }
    git -C "$work" reset --quiet --hard origin/gh-pages
    git -C "$work" clean -qfdx        # drop anything the lost attempt left untracked
}

attempt=1
while :; do
    apply_mutation
    git -C "$work" add -A
    git -C "$work" diff --cached --quiet || git -C "$work" commit -m "$msg" --quiet

    # LC_ALL=C: the retry decision reads git's own words for WHY the push failed, so it must not
    # depend on the runner's (or a maintainer's) locale translating them.
    if out="$(LC_ALL=C git -C "$work" push origin gh-pages 2>&1)"; then
        [ -z "$out" ] || printf '%s\n' "$out"
        break
    fi
    printf '%s\n' "$out" >&2

    # ONLY a lost race is retryable. An auth, permission or pre-receive-hook failure is not going
    # to resolve itself, and retrying it would bury its actual message under four more copies of
    # itself and cost 10s of sleeps before failing anyway. These two strings are what git prints
    # for a non-fast-forward, and nothing else: a hook rejection says "[remote rejected] …
    # (pre-receive hook declined)" and correctly falls through to the fatal branch.
    case "$out" in
        *"fetch first"*|*non-fast-forward*) ;;
        *) echo "publish: push failed for a reason retrying cannot fix" >&2; exit 1 ;;
    esac

    if [ "$attempt" -ge "$PUSH_ATTEMPTS" ]; then
        echo "publish: gh-pages still contested after $PUSH_ATTEMPTS attempts — giving up" >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    echo "publish: gh-pages moved under us — re-applying onto the new tip (attempt $attempt/$PUSH_ATTEMPTS)" >&2
    sleep "$((attempt - 1))"          # 1s, 2s, 3s, 4s: enough for the winner's push to settle
    reset_to_remote_tip
done

echo "gh-pages: $msg"
