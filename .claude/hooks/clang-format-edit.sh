#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook: auto-format a just-edited first-party C/C++ file with
# clang-format (spec in .clang-format). No-op if clang-format isn't installed, or if the file
# isn't under main/ or test/ (never touches generated def/ profiles or vendored code). Reads the
# tool payload as JSON on stdin. Advisory — always exits 0.
set -u

payload="$(cat)"
file="$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[ -n "$file" ] || exit 0
command -v clang-format >/dev/null 2>&1 || exit 0

case "$file" in
    */main/*.cpp|*/main/*.hpp|*/main/logic/*.hpp|*/test/*.cpp|*/test/*.hpp)
        # Skip generated value-definition profiles.
        case "$file" in */main/def/*) exit 0;; esac
        [ -f "$file" ] && clang-format -i "$file" 2>/dev/null
        ;;
esac
exit 0
