#!/usr/bin/env bash
# Run any command in the SAME ESP-IDF Docker image CI uses — so local build/debug never drifts
# from CI. The version is read at runtime from the single source of truth,
# .github/workflows/build.yml (`esp_idf_version:`, kept current by Renovate). When that bumps,
# the next build here auto-pulls the matching image.
#
# There is no local ESP-IDF install — this wrapper is the only build path. Flashing still happens
# on the HOST with `esptool` (Docker Desktop on macOS has no USB passthrough).
#
# Usage:
#   scripts/idf-docker.sh idf.py build                 # target comes from sdkconfig.defaults
#   scripts/idf-docker.sh idf.py menuconfig            # interactive (-it auto)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read the pin through the shared reader — CI derives its ccache key from the SAME script, so the
# image this builds in and the cache that build is served cannot key on different versions.
idf_version="$("$repo_root/scripts/idf-version.sh")"
image="espressif/idf:${idf_version}"
echo "idf-docker: using ${image} (from .github/workflows/build.yml)" >&2

tty_flags=()
if [ -t 0 ] && [ -t 1 ]; then tty_flags=(-it); fi

exec docker run --rm ${tty_flags[@]+"${tty_flags[@]}"} \
  -v "$repo_root":/project -w /project \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$image" "$@"
