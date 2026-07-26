#!/usr/bin/env bash
# Print the pinned ESP-IDF version (e.g. "v6.0.2") — the ONE shell reader of that pin.
#
# The version lives in exactly one place, .github/workflows/build.yml (`esp_idf_version:`, kept
# current by Renovate's custom manager in .github/renovate.json). Two shell callers need it and
# must never disagree about it:
#
#   scripts/idf-docker.sh   picks the espressif/idf image the LOCAL build runs in
#   .github/workflows/build.yml  derives the ccache key from it (a toolchain bump must not be
#                                served objects the previous toolchain compiled)
#
# Each used to carry its own copy of the grep. Two copies of an extraction is how one of them
# quietly stops matching after the field moves or gets renamed — and the failure would be silent
# in the worst direction: CI keying on a version it no longer reads means a toolchain bump reuses
# the old cache. So there is one reader, and it FAILS LOUDLY rather than printing an empty string
# a caller would then embed in an image tag or a cache key.
#
# Usage: scripts/idf-version.sh   ->  v6.0.2 on stdout, or exit 1 with a message on stderr.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ci_yml="$repo_root/.github/workflows/build.yml"
[ -f "$ci_yml" ] || { echo "idf-version: $ci_yml not found" >&2; exit 1; }

# The `# v6.0.2`-style trailing comments elsewhere in the file are not matched: the pattern is
# anchored on the `esp_idf_version:` KEY, and the value must be a vN.N[.N] tag.
idf_version="$(grep -oE 'esp_idf_version:[[:space:]]*v[0-9]+\.[0-9]+(\.[0-9]+)?' "$ci_yml" \
  | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1)"
[ -n "${idf_version:-}" ] || {
  echo "idf-version: could not read esp_idf_version from $ci_yml" >&2; exit 1; }

printf '%s\n' "$idf_version"
