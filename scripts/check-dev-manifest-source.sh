#!/usr/bin/env bash
# Resolve the source commit SHA of the currently published dev manifest on gh-pages.
#
# Used by CI on main pushes to determine the comparison range for build-relevant changes:
# comparing against the last published dev manifest ensures that if a run was skipped or failed
# (e.g. firmware change B was pushed, followed by docs-only change C), the firmware change B
# remains visible until it is actually built and published to the dev feed.
#
# Usage: scripts/check-dev-manifest-source.sh [remote] [target-commit]
#   remote: git remote to check (default: origin)
#   target-commit: commit to verify ancestry against (default: HEAD)
#
# Exit codes:
#   0: Success. Emits the 40-character source SHA to stdout.
#   1: Same source. The published dev manifest already matches target-commit.
#   2: Unresolvable / error. Missing branch, missing manifest, malformed JSON, unreachable remote,
#      or non-ancestor provenance. Fails closed so caller defaults to building.
set -euo pipefail
cd "$(dirname "$0")/.."

remote="${1:-origin}"
target="${2:-HEAD}"

# 1. Ask whether the gh-pages branch exists on remote before fetching
set +e
git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null 2>&1
lsr=$?
set -e
if [ "$lsr" -eq 2 ]; then
    echo "check-dev-manifest-source: no gh-pages branch on '$remote' yet (missing initial publish)" >&2
    exit 2
elif [ "$lsr" -ne 0 ]; then
    echo "check-dev-manifest-source: cannot reach '$remote' (git ls-remote exit $lsr)" >&2
    exit 2
fi

# 2. Fetch the gh-pages branch (shallow fetch is enough)
if ! git fetch --no-tags --depth=1 "$remote" gh-pages >/dev/null 2>&1; then
    echo "check-dev-manifest-source: failed to fetch gh-pages from '$remote'" >&2
    exit 2
fi

# 3. Read dev/manifest.json from gh-pages
if ! published_json="$(git show "FETCH_HEAD:dev/manifest.json" 2>/dev/null)"; then
    echo "check-dev-manifest-source: dev/manifest.json absent on gh-pages (missing initial publish of dev feed)" >&2
    exit 2
fi

# 4. Extract provenance.source_sha from published_json
source_sha="$(printf '%s' "$published_json" | python3 -c '
import json, re, sys
try:
    doc = json.load(sys.stdin)
except Exception as e:
    sys.exit(f"invalid JSON: {e}")
if not isinstance(doc, dict):
    sys.exit("not a JSON object")
provenance = doc.get("provenance")
if not isinstance(provenance, dict):
    sys.exit("no provenance object")
sha = provenance.get("source_sha")
if not isinstance(sha, str) or re.fullmatch(r"[0-9a-f]{40}", sha) is None:
    sys.exit(f"invalid provenance.source_sha: {sha}")
print(sha)
')" || {
    echo "check-dev-manifest-source: malformed dev/manifest.json provenance" >&2
    exit 2
}

# 5. Check if source_sha is a valid commit in the repository
if ! git cat-file -e "${source_sha}^{commit}" 2>/dev/null; then
    echo "check-dev-manifest-source: published source_sha $source_sha is unknown in this repository" >&2
    exit 2
fi

# Resolve target SHA
target_sha="$(git rev-parse "$target" 2>/dev/null)" || {
    echo "check-dev-manifest-source: cannot resolve target $target" >&2
    exit 2
}

# 6. Check if published source is identical to target (repetition of same source)
if [ "$source_sha" = "$target_sha" ]; then
    echo "check-dev-manifest-source: published dev manifest already matches target $target_sha" >&2
    exit 1
fi

# 7. Check ancestry: source_sha must be an ancestor of target_sha
if ! git merge-base --is-ancestor "$source_sha" "$target_sha" 2>/dev/null; then
    echo "check-dev-manifest-source: published source_sha $source_sha is not an ancestor of $target_sha" >&2
    exit 2
fi

echo "$source_sha"
