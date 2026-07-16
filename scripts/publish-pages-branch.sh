#!/usr/bin/env bash
# Publish/maintain the gh-pages branch that hosts the browser installer. A gh-pages BRANCH (not
# the Actions Pages artifact) is required because the browser flasher fetches every part in-page
# and needs the bins same-origin, and per-PR subpaths (PR/<N>/) can't live in the atomic
# whole-site Actions deploy.
#
# Main owns the gh-pages ROOT; each PR owns PR/<N>/. A root publish preserves the existing PR/
# tree; a PR publish only touches its own PR/<N>/ subdir; --rm deletes one PR/<N>/. Usage:
#   scripts/publish-pages-branch.sh              # publish _site/ as the root (main)
#   scripts/publish-pages-branch.sh --pr <N>     # publish _site/PR/<N>/ only
#   scripts/publish-pages-branch.sh --rm <N>     # remove PR/<N>/ (pr-preview-cleanup)
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-root}"; num="${2:-}"
git config user.name  "github-actions[bot]" 2>/dev/null || true
git config user.email "github-actions[bot]@users.noreply.github.com" 2>/dev/null || true

work="$(mktemp -d)"

# "Not fetched" is not "does not exist". A checkout that never fetched gh-pages (actions/checkout
# defaults to fetch-depth 1, i.e. the one ref it checked out) has no origin/gh-pages, and taking
# the --orphan path there builds a history disjoint from the live branch — the push is then
# rejected and the caller fails every time. Ask the remote before deciding, and let an ls-remote
# failure be fatal rather than silently degrade into that orphan.
if ! git show-ref --quiet refs/remotes/origin/gh-pages; then
    remote_head="$(git ls-remote --heads origin gh-pages)"   # empty = truly no branch yet
    [ -z "$remote_head" ] || git fetch --no-tags origin gh-pages:refs/remotes/origin/gh-pages
fi

if git show-ref --quiet refs/remotes/origin/gh-pages; then
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
    ( cd "$work" && git checkout --quiet --orphan gh-pages && { git rm -rqf . >/dev/null 2>&1 || true; } )
fi

case "$mode" in
    --pr)
        [ -n "$num" ] || { echo "publish: --pr needs a number" >&2; exit 1; }
        rm -rf "$work/PR/$num"; mkdir -p "$work/PR/$num"
        cp -R _site/PR/"$num"/. "$work/PR/$num/"
        msg="pages: PR/$num preview" ;;
    --rm)
        [ -n "$num" ] || { echo "publish: --rm needs a number" >&2; exit 1; }
        rm -rf "$work/PR/$num"
        msg="pages: remove PR/$num" ;;
    root|*)
        find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name PR -exec rm -rf {} +
        cp -R _site/. "$work/"
        msg="pages: publish root" ;;
esac

( cd "$work" && git add -A && (git diff --cached --quiet || git commit -m "$msg" --quiet) && git push origin gh-pages )
git worktree remove --force "$work"
echo "gh-pages: $msg"
