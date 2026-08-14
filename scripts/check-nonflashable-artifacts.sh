#!/usr/bin/env bash
# Assert that an untrusted/unsigned CI build exposes diagnostics only. This is a second boundary
# around ci-build-all.sh --compile-only: even if that packager regresses, the upload step calls this
# checker before Actions can retain a flashable app, merged image, Web-Serial part or manifest.
set -euo pipefail

dir="${1:-}"
[ "$#" -eq 1 ] && [ -d "$dir" ] || {
    echo "usage: check-nonflashable-artifacts.sh <artifact-directory>" >&2
    exit 2
}

count=0
while IFS= read -r -d '' path; do
    name="${path##*/}"
    case "$name" in
        daikin-altherma-esp32*.elf.xz|\
        daikin-altherma-esp32*.elf.sha256|\
        daikin-altherma-esp32*-size.json|\
        daikin-altherma-esp32*-size.md)
            count=$((count + 1)) ;;
        *)
            echo "non-flashable artifact check: forbidden file '$path'" >&2
            exit 1 ;;
    esac
done < <(find "$dir" -type f -print0)

[ "$count" -gt 0 ] || {
    echo "non-flashable artifact check: '$dir' contains no diagnostics" >&2
    exit 1
}
echo "non-flashable artifact check: OK ($count diagnostic files)"
