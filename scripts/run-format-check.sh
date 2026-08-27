#!/usr/bin/env bash
# Read-only source-format gate for first-party main/, test/ and tools/ C/C++. Portable source
# hygiene always covers the whole tree. CI additionally requires the pinned formatter for changed
# files, ratcheting the existing hand-formatted tree without a repository-wide rewrite.
set -euo pipefail
cd "$(dirname "$0")/.."

PINNED_CLANG_FORMAT_VERSION=18.1.3
python3 tools/format/check_style_config.py "$PWD/.clang-format"
python3 tools/format/check_format.py --root "$PWD" "$@"

if [ -z "${CLANG_FORMAT:-}" ]; then
    if [ -n "${CI:-}" ]; then
        echo "format check: CI requires CLANG_FORMAT=clang-format-18" >&2
        exit 2
    fi
    echo "format check: clang-format skipped locally (set CLANG_FORMAT=clang-format-18)"
    exit 0
fi

if [ "$#" -gt 0 ]; then
    # Explicit local scopes are checked as complete files.
    python3 tools/format/check_format.py --root "$PWD" \
        --clang-format "$CLANG_FORMAT" \
        --clang-format-version "$PINNED_CLANG_FORMAT_VERSION" \
        "$@"
    exit
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "format check: cannot determine changed-line scope outside Git" >&2
    exit 2
fi
if ! git diff --quiet -- . || ! git diff --cached --quiet -- . || \
   [ -n "$(git ls-files --others --exclude-standard)" ]; then
    FORMAT_REFERENCE=HEAD
elif git rev-parse --verify HEAD^1 >/dev/null 2>&1; then
    # GitHub's tested merge checkout has the protected base as its first parent.
    FORMAT_REFERENCE=HEAD^1
else
    # A clean initial revision has no base, so its complete first-party tree is new.
    python3 tools/format/check_format.py --root "$PWD" \
        --clang-format "$CLANG_FORMAT" \
        --clang-format-version "$PINNED_CLANG_FORMAT_VERSION"
    exit
fi

python3 tools/format/check_format.py --root "$PWD" \
    --clang-format "$CLANG_FORMAT" \
    --clang-format-version "$PINNED_CLANG_FORMAT_VERSION" \
    --changed-since "$FORMAT_REFERENCE"
