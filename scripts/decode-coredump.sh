#!/usr/bin/env bash
# Decode a core dump (from GET /coredump) into a symbolized backtrace using esp-coredump inside the
# CI-pinned ESP-IDF Docker image — so decoding never drifts from the toolchain that built the image.
#
# The dump is USELESS without the matching unstripped ELF: the shipped .bin has no symbols. Use the
# .elf from the SAME firmware version that produced the dump — CI archives it per version/PR as a
# build artifact (dist/*.elf.xz, retained 3 days for a dev build; for a PR, until merge or 7 days)
# and, for releases, as a Release ASSET, which has no expiry at all. esp-coredump matches the two by the
# app_elf_sha256 the dump embeds and WARNS on a mismatch, so a wrong ELF is caught, not silently
# mis-decoded. (The device also reports app_elf_sha256 on /status and in the crash banner, so you
# know which build to fetch.)
#
# CI stores that ELF xz-wrapped; this script unwraps it for you, so either name works. The container
# is deliberately an OUTER wrapper — the ELF inside is byte-identical to the linker's output, which
# is exactly why the app_elf_sha256 check above still means something (see ci-build-all.sh).
#
# Paths must be INSIDE this repo (the Docker image mounts the repo at /project as its workdir). Drop
# coredump.bin in the repo root and the .elf (or .elf.xz) in build/ — or pass explicit paths under
# the repo.
#
# Usage:
#   scripts/decode-coredump.sh coredump.bin [build/daikin-altherma-esp32.elf[.xz]]
#   scripts/decode-coredump.sh coredump.bin --gdb     # interactive gdb session (dbg_corefile)
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

CORE="${1:-}"
[ -n "$CORE" ] || { echo "usage: scripts/decode-coredump.sh <coredump.bin> [app.elf] [--gdb]" >&2; exit 1; }
shift

mode="info_corefile"
# The archived form is the default. Fall back to a local plain ELF when no archive exists; an
# explicitly supplied plain ELF is still honored even when an archive sits beside it.
ELF="build/daikin-altherma-esp32.elf.xz"
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

# Accept either form when only its counterpart exists. Because the default names the CI archive, a
# newly downloaded .xz wins over any plain ELF left by decoding an older build. Supplying an
# explicit .elf remains the way to select a local build intentionally.
case "$elf_rel" in
  *.xz)
    [ -f "$repo_root/$elf_rel" ] \
      || [ ! -f "$repo_root/${elf_rel%.xz}" ] \
      || elf_rel="${elf_rel%.xz}"
    ;;
  *)
    [ -f "$repo_root/$elf_rel" ] \
      || [ ! -f "$repo_root/$elf_rel.xz" ] \
      || elf_rel="$elf_rel.xz"
    ;;
esac
[ -f "$repo_root/$elf_rel" ] || { echo "decode-coredump: ELF not found: $ELF — download the matching version's .elf.xz (CI artifact / Release asset)" >&2; exit 1; }

# esp-coredump reads an ELF, not an xz stream. Always unwrap the selected container to a private
# scratch path: artifact downloads reuse the same generic filename, so a plain ELF left by a
# previous decode may belong to another build. A per-process output also keeps two investigations
# from replacing the ELF underneath each other.
case "$elf_rel" in
  *.xz)
    plain="${elf_rel%.xz}.decoded.$$"
    tmp="$repo_root/$plain.part"
    echo "decode-coredump: unpacking $elf_rel -> $plain" >&2
    cleanup_tmp() { rm -f "$tmp" "$repo_root/$plain"; }
    trap cleanup_tmp EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if command -v xz >/dev/null 2>&1; then
      xz -dc "$repo_root/$elf_rel" > "$tmp" \
        || { echo "decode-coredump: could not unpack $elf_rel" >&2; exit 1; }
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c 'import lzma, shutil, sys
with lzma.open(sys.argv[1], "rb") as f, open(sys.argv[2], "wb") as g:
    shutil.copyfileobj(f, g)' "$repo_root/$elf_rel" "$tmp" \
        || { echo "decode-coredump: could not unpack $elf_rel" >&2; exit 1; }
    else
      echo "decode-coredump: need xz or python3 to unpack $elf_rel" >&2
      exit 1
    fi
    mv "$tmp" "$repo_root/$plain"
    elf_rel="$plain"
    ;;
esac

echo "decode-coredump: $mode  core=$core_rel  elf=$elf_rel" >&2
"$repo_root/scripts/idf-docker.sh" esp-coredump "$mode" --core "$core_rel" --core-format raw "$elf_rel"
