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
#   scripts/check-publish-version.sh [--preflight | --candidate-dir <dist>]
#       [--source-sha <40-hex>] <mode> <candidate-version> [remote]
#
#     mode        release  -> checked against gh-pages manifest.json      (the release feed)
#                 release-resume -> same, but equality is a retry only when the published
#                                   source and every offered artifact are identical
#                 dev      -> checked against gh-pages dev/manifest.json  (the dev feed)
#                 dev-resume -> same, but equality is a retry only when the published
#                               source and every offered artifact are identical
#                 pr|none  -> nothing is published; the check is skipped
#     candidate   the version this run would publish (the stamped version.txt)
#     remote      git remote holding gh-pages (default: origin)
#     preflight   provisional version/source check before an application exists; never publication
#     candidate-dir  materialized handoff, required for publication through either resume mode
#
# Exit: 0 = requested check passed (a preflight remains provisional), or nothing to publish
#       1 = the candidate would move the feed sideways or backwards
#       2 = usage or a malformed published manifest
set -euo pipefail
cd "$(dirname "$0")/.."

source_sha=""
candidate_dir=""
preflight=no
while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-sha|--candidate-dir)
            [ "$#" -ge 2 ] && [ -n "$2" ] || {
                echo "publish gate: $1 requires a value" >&2
                exit 2
            }
            if [ "$1" = --source-sha ]; then
                [ -z "$source_sha" ] || { echo "publish gate: repeated --source-sha" >&2; exit 2; }
                source_sha="$2"
            else
                [ -z "$candidate_dir" ] || { echo "publish gate: repeated --candidate-dir" >&2; exit 2; }
                candidate_dir="$2"
            fi
            shift 2 ;;
        --preflight)
            [ "$preflight" = no ] || { echo "publish gate: repeated --preflight" >&2; exit 2; }
            preflight=yes; shift ;;
        *) break ;;
    esac
done

mode="${1:-}"
candidate="${2:-}"
remote="${3:-origin}"
[ -n "$mode" ] && [ -n "$candidate" ] && [ "$#" -le 3 ] || {
    echo "usage: check-publish-version.sh [--preflight | --candidate-dir <dist>] [--source-sha <40-hex>] <release|release-resume|dev|dev-resume|pr|none> <candidate-version> [remote]" >&2
    exit 2
}
if [ -n "$source_sha" ] && [[ ! "$source_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "publish gate: --source-sha must be a lowercase 40-character Git SHA" >&2
    exit 2
fi
[ "$preflight" = no ] || [ -z "$candidate_dir" ] || {
    echo "publish gate: --preflight cannot validate a publication handoff" >&2
    exit 2
}

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
        }
        [ "$preflight" = yes ] || [ -n "$candidate_dir" ] || {
            echo "publish gate: $mode publication requires --candidate-dir; source-only admission needs explicit --preflight" >&2
            exit 2
        } ;;
esac

# A preflight can allow an equal source to reach the build, but it cannot know which probabilistically
# signed application that build will produce. Validate the actual handoff before comparing feeds.
# The signature verifier remains the preceding publisher step; this binds its checked bytes to the
# manifest, complete binary inventory, flash plan and version-bound changelog.
if [ -n "$candidate_dir" ]; then
    [ -n "$source_sha" ] || { echo "publish gate: candidate handoff requires --source-sha" >&2; exit 2; }
    case "$mode" in
        release|release-resume) version_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ;;
        dev|dev-resume) version_pattern='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-dev\.(0|[1-9][0-9]*)$' ;;
    esac
    [[ "$candidate" =~ $version_pattern ]] || {
        echo "publish gate: candidate version does not match the $mode channel" >&2
        exit 2
    }
    if ! python3 - "$candidate_dir" "$candidate" <<'PY'
import json, sys
from pathlib import Path
def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate metadata key: {key!r}")
        result[key] = value
    return result
try:
    for name in ("manifest.json", "artifacts.json", "changelog.json"):
        path = Path(sys.argv[1]) / name
        if path.is_symlink() or not path.is_file():
            sys.exit(f"candidate metadata is missing or not regular: {name}")
        document = json.loads(path.read_bytes(), object_pairs_hook=unique_object)
        if not isinstance(document, dict):
            sys.exit(f"candidate metadata is not an object: {name}")
        if name != "artifacts.json" and document.get("version") != sys.argv[2]:
            sys.exit(f"candidate {name} version differs from the offered version")
except (OSError, ValueError, RecursionError) as exc:
    sys.exit(f"cannot read candidate manifest: {exc}")
PY
    then
        echo "publish gate: malformed candidate version identity" >&2
        exit 2
    fi
    if ! ./scripts/check-manifest-provenance.py "$candidate_dir/manifest.json" \
        "$candidate_dir/daikin-altherma-esp32.bin" "$source_sha" \
        "$(./scripts/idf-version.sh)" dependencies.lock || \
       ! ./scripts/check-web-installer-plan.py "$candidate_dir/manifest.json" partitions.csv || \
       ! ./scripts/generate-ota-changelog.py --validate "$candidate_dir/changelog.json" --version "$candidate"; then
        echo "publish gate: candidate handoff is not complete and internally bound" >&2
        exit 2
    fi
fi

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
    prefix="${manifest%manifest.json}"
    for name in artifacts.json changelog.json daikin-altherma-esp32.bin; do
        if git cat-file -e "FETCH_HEAD:$prefix$name" 2>/dev/null; then
            echo "publish gate: gh-pages has $prefix$name but no $manifest — incomplete feed" >&2
            exit 2
        fi
    done
    echo "publish gate: gh-pages has no $manifest yet — first publish of this feed, nothing to compare"
    exit 0
fi

# Read the one field, and fail rather than guess: an unreadable manifest means the reference is
# unknown, and publishing against an unknown reference is the state this guard exists to prevent.
published="$(printf '%s' "$published_json" | python3 -c '
import json, sys
def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate metadata key: {key!r}")
        result[key] = value
    return result
try:
    doc = json.load(sys.stdin, object_pairs_hook=unique_object)
except (ValueError, UnicodeError, RecursionError) as exc:
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
# Equality is safe only for the original artifact, not a rebuild from the same Git object. Ordinary
# dev/release checks remain strictly forward-only. A provisional preflight checks source and shape;
# publication must also retain every manifest, changelog, inventory and binary byte.
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
    if [ "$preflight" = yes ]; then
        echo "publish gate: provisional source/version preflight for $candidate — artifact identity still required before publication"
        exit 0
    fi
    if python3 - "$candidate_dir" "$manifest" "$source_sha" "$candidate" <<'PY'
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

candidate_dir, manifest, source, version = sys.argv[1:]
prefix = manifest.removesuffix("manifest.json")
metadata = ["manifest.json", "artifacts.json", "changelog.json"]
try:
    paths = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", "FETCH_HEAD"], text=True,
    ).splitlines()
    binaries = sorted(path.removeprefix(prefix) for path in paths
                      if path.startswith(prefix) and "/" not in path.removeprefix(prefix)
                      and path.endswith(".bin"))
    if not binaries or any(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.bin", name) is None
                           for name in binaries):
        raise ValueError("published feed has no safe complete binary inventory")
    with tempfile.TemporaryDirectory(prefix="publish-resume-") as raw:
        old = Path(raw)
        for name in [*metadata, *binaries]:
            tree_entry = subprocess.check_output(
                ["git", "ls-tree", "FETCH_HEAD", "--", prefix + name], text=True,
            ).split()
            if len(tree_entry) != 4 or tree_entry[0] not in ("100644", "100755") or tree_entry[1] != "blob":
                raise ValueError(f"published feed file is missing or not regular: {name}")
            (old / name).write_bytes(subprocess.check_output(["git", "show", "FETCH_HEAD:" + prefix + name]))
        idf = subprocess.check_output(["./scripts/idf-version.sh"], text=True).strip()
        checks = [
            ["./scripts/check-manifest-provenance.py", str(old / "manifest.json"),
             str(old / "daikin-altherma-esp32.bin"), source, idf, "dependencies.lock"],
            ["./scripts/check-web-installer-plan.py", str(old / "manifest.json"), "partitions.csv"],
            ["./scripts/generate-ota-changelog.py", "--validate", str(old / "changelog.json"), "--version", version],
        ]
        for check in checks:
            subprocess.run(check, check=True)
        index = json.loads((old / "artifacts.json").read_bytes())
        names = metadata + [entry["path"] for entry in index["artifacts"]]
        for name in names:
            if (old / name).read_bytes() != (Path(candidate_dir) / name).read_bytes():
                print(f"publish gate: refusing equal-version replacement of {name}; reuse the original handoff or advance the version", file=sys.stderr)
                sys.exit(1)
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
    print(f"publish gate: cannot prove the original complete handoff: {exc}", file=sys.stderr)
    sys.exit(2)
PY
    then
        :
    else
        exit "$?"
    fi
    echo "publish gate: ${mode%-resume} feed already serves $candidate from $source_sha with identical offered bytes — idempotent resume permitted"
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
