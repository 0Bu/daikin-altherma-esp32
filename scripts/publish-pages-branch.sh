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
if git show-ref --quiet refs/remotes/origin/gh-pages || git show-ref --quiet refs/heads/gh-pages; then
    git worktree add -f "$work" gh-pages
else
    git worktree add -f --orphan gh-pages "$work"
    ( cd "$work" && git rm -rf . >/dev/null 2>&1 || true )
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
