#!/usr/bin/env bash
# Hardware-free contract tests for scripts/decode-coredump.sh. The real Docker handoff is replaced
# by /bin/echo; these tests own archive selection, atomic unpacking and failure cleanup only.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
command -v xz >/dev/null 2>&1 || {
  echo "run-decode-coredump-tests: need xz" >&2
  exit 1
}

scratch="$(mktemp -d "${TMPDIR:-/tmp}/decode-coredump-tests.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
fake="$scratch/repo"
mkdir -p "$fake/scripts" "$fake/build"
cp "$repo_root/scripts/decode-coredump.sh" "$fake/scripts/"
printf '%s\n' '#!/bin/sh' 'for last do :; done' 'cmp "$EXPECTED_ELF" "$last"' > "$fake/scripts/idf-docker.sh"
chmod +x "$fake/scripts/idf-docker.sh"
printf 'synthetic core\n' > "$fake/coredump.bin"

plain="$fake/build/daikin-altherma-esp32.elf"
archive="$plain.xz"
payload="$scratch/expected.elf"

assert_no_parts() {
  if find "$fake/build" \( -name '*.part' -o -name '*.decoded.*' \) -print -quit | grep -q .; then
    echo "decode-coredump test left a scratch ELF behind" >&2
    exit 1
  fi
}

# The standard no-argument path must prefer the freshly downloaded CI archive over a plain ELF left
# by decoding an older artifact with the same generic name.
printf 'old build\n' > "$plain"
printf 'new build\n' > "$payload"
xz -c "$payload" > "$archive"
( cd "$fake" && EXPECTED_ELF="$payload" scripts/decode-coredump.sh coredump.bin >/dev/null )
grep -qx 'old build' "$plain"
assert_no_parts

# An explicitly selected archive has the same overwrite guarantee.
printf 'another stale build\n' > "$plain"
printf 'explicit archive build\n' > "$payload"
xz -c "$payload" > "$archive"
( cd "$fake" && EXPECTED_ELF="$payload" scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf.xz >/dev/null )
grep -qx 'another stale build' "$plain"
assert_no_parts

# A corrupt new archive must fail before Docker, preserve the last complete ELF and clean its
# scratch output. It must never fall through to the stale-but-readable plain file.
cp "$plain" "$scratch/last-good.elf"
printf 'not an xz stream\n' > "$archive"
if ( cd "$fake" && EXPECTED_ELF="$payload" scripts/decode-coredump.sh coredump.bin >/dev/null 2>&1 ); then
  echo "decode-coredump accepted a corrupt archive" >&2
  exit 1
fi
cmp "$scratch/last-good.elf" "$plain"
assert_no_parts

# Backward compatibility: an explicit plain ELF and the default fallback without an archive both
# still reach esp-coredump unchanged.
rm -f "$archive"
printf 'legacy plain build\n' > "$plain"
( cd "$fake" && EXPECTED_ELF="$plain" scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf >/dev/null )
( cd "$fake" && EXPECTED_ELF="$plain" scripts/decode-coredump.sh coredump.bin >/dev/null )
grep -qx 'legacy plain build' "$plain"

echo "decode-coredump archive tests passed"
