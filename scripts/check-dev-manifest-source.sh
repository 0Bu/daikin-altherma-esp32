#!/usr/bin/env bash
# Resolve the last valid, successfully published dev source, including public readback evidence.
# Usage: scripts/check-dev-manifest-source.sh [remote] [target-commit]
# Exit 0: proven ancestor SHA on stdout; 1: proven identical source; 2: unproven, build conservatively.
set -euo pipefail
cd "$(dirname "$0")/.."
remote="${1:-origin}"
target="${2:-HEAD}"
if ! git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null 2>&1; then
    echo 'dev publication unproven: gh-pages missing or remote unavailable' >&2
    exit 2
fi
if ! git fetch --no-tags --depth=1 "$remote" gh-pages >/dev/null 2>&1; then
    echo 'dev publication unproven: gh-pages fetch failed' >&2
    exit 2
fi
# Only the private resolver status 3 means proven equality. Python import/runtime failures often
# exit 1; propagating that would incorrectly certify same_source to the workflow.
set +e
python3 tools/release/dev_publication.py resolve FETCH_HEAD "$target"
rc=$?
set -e
case "$rc" in
    0) exit 0 ;;
    3) exit 1 ;;
    *) exit 2 ;;
esac
