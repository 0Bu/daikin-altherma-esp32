#!/usr/bin/env bash
# Decode a core dump (from GET /coredump) into a symbolized backtrace using esp-coredump inside the
# CI-pinned ESP-IDF Docker image — so decoding never drifts from the toolchain that built the image.
#
# The dump is USELESS without the matching unstripped ELF: the shipped .bin has no symbols. Use the
# .elf from the SAME firmware version that produced the dump — CI archives it per version/PR as a
# build artifact (dist/*.elf, retained ~90 days) and, for public releases, as a Release asset.
# esp-coredump matches the two by the app_elf_sha256 the dump embeds and WARNS on a mismatch, so a
# wrong ELF is caught, not silently mis-decoded. (The device also reports app_elf_sha256 on /status
# and in the crash banner, so you know which build to fetch.)
#
# Paths must be INSIDE this repo (the Docker image mounts the repo at /project as its workdir). Drop
# coredump.bin in the repo root and the .elf in build/ (or pass explicit paths under the repo).
#
# Usage:
#   scripts/decode-coredump.sh coredump.bin [build/daikin-altherma-esp32.elf]
#   scripts/decode-coredump.sh coredump.bin --gdb     # interactive gdb session (dbg_corefile)
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

CORE="${1:-}"
[ -n "$CORE" ] || { echo "usage: scripts/decode-coredump.sh <coredump.bin> [app.elf] [--gdb]" >&2; exit 1; }
shift

mode="info_corefile"
ELF="build/daikin-altherma-esp32.elf"
for a in "$@"; do
  case "$a" in
    --gdb) mode="dbg_corefile" ;;
    -*)    echo "decode-coredump: unknown option '$a'" >&2; exit 1 ;;
    *)     ELF="$a" ;;
  esac
done

# Map a path to repo-relative (the container mounts the repo at /project as its workdir); reject
# anything outside it. Purely textual — the file need not exist yet (its existence is checked below).
rel() {
  local p="$1" abs
  case "$p" in
    *..*) return 1 ;;                    # keep it simple: no parent-dir traversal
    /*)   abs="$p" ;;
    *)    abs="$PWD/$p" ;;
  esac
  case "$abs" in "$repo_root"/*) printf '%s\n' "${abs#"$repo_root"/}" ;; *) return 1 ;; esac
}

core_rel="$(rel "$CORE")" || { echo "decode-coredump: '$CORE' must be inside the repo, no '..' ($repo_root)" >&2; exit 1; }
[ -f "$repo_root/$core_rel" ] || { echo "decode-coredump: core dump not found: $CORE" >&2; exit 1; }
elf_rel="$(rel "$ELF")"   || { echo "decode-coredump: '$ELF' must be inside the repo, no '..' ($repo_root)" >&2; exit 1; }
[ -f "$repo_root/$elf_rel" ] || { echo "decode-coredump: ELF not found: $ELF — download the matching version's .elf (CI artifact / Release asset)" >&2; exit 1; }

echo "decode-coredump: $mode  core=$core_rel  elf=$elf_rel" >&2
exec "$repo_root/scripts/idf-docker.sh" esp-coredump "$mode" --core "$core_rel" --core-format raw "$elf_rel"
