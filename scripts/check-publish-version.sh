#!/usr/bin/env bash
# Refuse to publish a feed a device cannot move onto — the guard that makes a version regression
# LOUD instead of silent.
#
# Each feed's own currently-published manifest is the reference, read out of the gh-pages branch
# (not over HTTPS: the branch is what CI is about to overwrite, while the Pages site lags behind it
# by a deployment, and a network hiccup must not read as "nothing published yet"). The comparison
# itself is the device's own rule — tools/version/publish_gate.cpp calls the same ota_is_upgrade()
# that main/ota_update.cpp gates an install with — so "CI published it" and "a board will take it"
# cannot mean two different things.
#
# Why this exists: on 2026-07-24 the repository's v* tags were deleted. next-version.sh fell back to
# the version.txt floor and the next merge republished dev/ as 1.0.0-dev.168, below the 1.0.14-dev.2
# it had served minutes before. CI stayed green — the feed had simply stopped being able to move any
# device forward. This step turns exactly that into a failed run.
#
#   scripts/check-publish-version.sh [--source-sha <40-hex>] <mode> <candidate-version> [remote]
#
#     mode        release  -> checked against gh-pages manifest.json      (the release feed)
#                 release-resume -> same, but equality is a retry only when the published
#                                   provenance.source_sha equals --source-sha exactly
#                 dev      -> checked against gh-pages dev/manifest.json  (the dev feed)
#                 dev-resume -> same, but equality is a retry only when the published
#                               provenance.source_sha equals --source-sha exactly
#                 pr|none  -> nothing is published; the check is skipped
#     candidate   the version this run would publish (the stamped version.txt)
#     remote      git remote holding gh-pages (default: origin)
#
# Exit: 0 = safe to publish (or nothing to publish / nothing published yet)
#       1 = the candidate would move the feed sideways or backwards
#       2 = usage or a malformed published manifest
set -euo pipefail
cd "$(dirname "$0")/.."

source_sha=""
if [ "${1:-}" = "--source-sha" ]; then
    [ "$#" -ge 2 ] || {
        echo "publish gate: --source-sha requires a lowercase 40-character Git SHA" >&2
        exit 2
    }
    source_sha="$2"
    shift 2
fi

mode="${1:-}"
candidate="${2:-}"
remote="${3:-origin}"
[ -n "$mode" ] && [ -n "$candidate" ] && [ "$#" -le 3 ] || {
    echo "usage: check-publish-version.sh [--source-sha <40-hex>] <release|release-resume|dev|dev-resume|pr|none> <candidate-version> [remote]" >&2
    exit 2
}
if [ -n "$source_sha" ] && [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "publish gate: --source-sha must be a lowercase 40-character Git SHA" >&2
    exit 2
fi

case "$mode" in
    release|release-resume) manifest="manifest.json" ;;
    dev|dev-resume) manifest="dev/manifest.json" ;;
    pr|none) echo "publish gate: mode '$mode' publishes nothing — skipped"; exit 0 ;;
    *)       echo "publish gate: unknown mode '$mode'" >&2; exit 2 ;;
esac
case "$mode" in
    release-resume|dev-resume)
        [ -n "$source_sha" ] || {
            echo "publish gate: $mode requires --source-sha <40-hex>" >&2
            exit 2
        } ;;
esac

# ASK WHETHER THE BRANCH EXISTS BEFORE FETCHING IT, because those are two different answers and only
# one of them is safe to pass on. `git fetch` fails identically for "no such branch" and for a DNS
# blip, an expired token or a GitHub outage — so treating a fetch failure as "first publish, nothing
# to compare" is precisely the fail-OPEN this file's own header rules out ("a network hiccup must not
# read as 'nothing published yet'"). ls-remote separates them: --exit-code returns 2 when the ref is
# absent, and anything else is a transport failure that leaves the reference unknown.
set +e
git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null 2>&1
lsr=$?
set -e
if [ "$lsr" -eq 2 ]; then
    echo "publish gate: no gh-pages branch on '$remote' yet — first publish, nothing to compare"
    exit 0
elif [ "$lsr" -ne 0 ]; then
    echo "publish gate: cannot reach '$remote' to read the published manifest (git ls-remote exit $lsr)" >&2
    echo "publish gate: the reference is UNKNOWN — refusing rather than assuming nothing is published" >&2
    exit 2
fi

# A shallow fetch of the one branch: this runs before the ~5-minute build, and the guard has no use
# for gh-pages history. The branch is known to exist now, so a failure here is a transport failure.
if ! git fetch --no-tags --depth=1 "$remote" gh-pages >/dev/null 2>&1; then
    echo "publish gate: gh-pages exists on '$remote' but could not be fetched" >&2
    exit 2
fi

if ! published_json="$(git show "FETCH_HEAD:$manifest" 2>/dev/null)"; then
    echo "publish gate: gh-pages has no $manifest yet — first publish of this feed, nothing to compare"
    exit 0
fi

# Read the one field, and fail rather than guess: an unreadable manifest means the reference is
# unknown, and publishing against an unknown reference is the state this guard exists to prevent.
published="$(printf '%s' "$published_json" | python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeError) as exc:
    sys.exit(f"published manifest is not valid JSON: {exc}")
if not isinstance(doc, dict) or not isinstance(doc.get("version"), str) or not doc["version"]:
    sys.exit("published manifest has no string \"version\" field")
print(doc["version"])
')" || {
    echo "publish gate: cannot read the published version from gh-pages:$manifest" >&2
    exit 2
}

# Publishing a Pages feed happens before the development-channel public readback and, for a release,
# before the GitHub Release/tag. If a later step failed, a rerun sees exactly the candidate already
# in the manifest.
# Equality is a safe sideways move only when the existing manifest says it came from this exact Git
# object. Without that binding, an exact-version retry could replace the served binary while every
# device still sees the same version. Ordinary dev/release checks remain strictly forward-only;
# resume modes admit equality only for the feed shape they own and the exact published source.
if { [ "$mode" = release-resume ] || [ "$mode" = dev-resume ]; } && \
   [ "$published" = "$candidate" ]; then
    case "$mode" in
        release-resume)
            if [[ ! "$candidate" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
                echo "publish gate: release resume requires strict X.Y.Z SemVer (got '$candidate')" >&2
                exit 2
            fi ;;
        dev-resume)
            if [[ ! "$candidate" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-dev\.(0|[1-9][0-9]*)$ ]]; then
                echo "publish gate: dev resume requires strict X.Y.Z-dev.N SemVer (got '$candidate')" >&2
                exit 2
            fi ;;
    esac
    published_source="$(printf '%s' "$published_json" | python3 -c '
import json, re, sys
doc = json.load(sys.stdin)
provenance = doc.get("provenance")
if not isinstance(provenance, dict):
    sys.exit("published manifest has no provenance object")
source = provenance.get("source_sha")
if not isinstance(source, str) or re.fullmatch(r"[0-9a-f]{40}", source) is None:
    sys.exit("published manifest has no valid provenance.source_sha")
print(source)
')" || {
        echo "publish gate: cannot prove which source produced gh-pages:$manifest" >&2
        exit 2
    }
    if [ "$published_source" != "$source_sha" ]; then
        echo "publish gate: refusing $candidate resume — published source $published_source differs from candidate $source_sha" >&2
        exit 1
    fi
    echo "publish gate: ${mode%-resume} feed already serves $candidate from $source_sha — idempotent resume permitted"
    exit 0
fi

BUILD_DIR=build_mock   # matches .gitignore (/build_mock/), like run-domain-audit.sh
mkdir -p "$BUILD_DIR"
CXX="${CXX:-}"
if [ -z "$CXX" ]; then
    if command -v g++ >/dev/null 2>&1; then CXX=g++
    elif command -v clang++ >/dev/null 2>&1; then CXX=clang++
    else echo "publish gate: need a C++17 compiler (g++/clang++)" >&2; exit 2
    fi
fi
"$CXX" -std=c++17 -Wall -Wextra -Werror -Imain -o "$BUILD_DIR/publish_gate" \
    tools/version/publish_gate.cpp

echo "publish gate: $mode feed currently serves $published"
gate_args=("$published" "$candidate")
case "$mode" in
    release|release-resume) gate_args+=(--release) ;; # root feed refuses a pre-release SHAPE
esac
if "$BUILD_DIR/publish_gate" "${gate_args[@]}"; then
    exit 0
fi

cat >&2 <<EOF

The $mode feed would stop moving devices forward. Every board on $published applies this same
rule (logic/version_cmp.hpp) and would refuse the update, so publishing $candidate strands the
feed rather than advancing it.

Usual cause: the version this run derived is not what you think. scripts/next-version.sh reads the
v* TAG list and falls back to the version.txt floor when it is empty — so a missing or deleted tag
silently resets the numbering. Check:

    git ls-remote --tags $remote 'v*'    # empty => next-version.sh returns the version.txt floor
    cat version.txt

Fix the floor (a tag, or version.txt) rather than this gate.
EOF
exit 1
