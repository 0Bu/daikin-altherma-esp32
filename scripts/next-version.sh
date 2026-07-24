#!/usr/bin/env bash
# Print the version CI should stamp into the firmware — for a RELEASE or for a DEV build.
#
#   scripts/next-version.sh [patch|minor|major]   the next RELEASE version   (default: patch)
#   scripts/next-version.sh --dev                 the next DEV build version
#
# RELEASES ARE MANUAL. A merge to main no longer cuts one: the release path is a
# `workflow_dispatch` run of .github/workflows/build.yml with `release: true` (and the bump level
# below), which is the only thing that creates a v* tag. Every other push to main publishes a DEV
# build instead, so `main` moves without the version number moving with it.
#
# version.txt is the FLOOR: bump it to force a specific next version. Otherwise the level argument
# decides which segment moves above the most recent v* tag.
#
#   no tags yet                 -> version.txt verbatim              (e.g. 1.0.0)
#   latest tag v1.0.3, patch    -> max(version.txt, 1.0.4)
#   latest tag v1.0.3, minor    -> max(version.txt, 1.1.0)
#   latest tag v1.0.3, major    -> max(version.txt, 2.0.0)
#   version.txt 1.1.0 > bumped  -> 1.1.0                             (honor the manual floor)
#
# DEV builds are named "<next patch release>-dev.<commits since the last tag>", e.g. 1.0.4-dev.7.
# That shape is load-bearing in three places, not cosmetic:
#   • it is a semver PRE-RELEASE of the next release, so it sorts ABOVE the release it followed and
#     BELOW the release it leads to — a dev board upgrades to the next release on its own, and a
#     release board never drifts onto a dev build (logic/version_cmp.hpp).
#   • the counter compares NUMERICALLY (semver §11.4, implemented in prerelease_compare), so
#     dev.12 > dev.9 and no zero-padding is needed to keep the feed moving forward.
#   • the "-dev." identifier is what the device and the installer page label a dev build by
#     (logic/ota_channel.hpp → ota_version_is_dev).
#
# Requires tags to be fetched (git fetch --tags) before calling in CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base="$(tr -d '[:space:]' < "$repo_root/version.txt")"
latest="$(git -C "$repo_root" tag -l 'v*' --sort=-v:refname | head -n1 | sed 's/^v//')"

dev=no
level=patch
for arg in "$@"; do
    case "$arg" in
        --dev)                dev=yes ;;
        patch|minor|major)    level="$arg" ;;
        *) echo "next-version: unknown argument '$arg' (expected --dev / patch / minor / major)" >&2
           exit 1 ;;
    esac
done
[ "$dev" = yes ] && level=patch   # a dev build always leads to the next PATCH: it must sort below
                                  # whatever the next release turns out to be, and patch is lowest

# The release version: the bumped tag, floored by version.txt.
if [[ -z "$latest" ]]; then
    version="$base"
else
    major="${latest%%.*}"; rest="${latest#*.}"; minor="${rest%%.*}"; patch="${rest##*.}"
    case "$level" in
        patch) bumped="${major}.${minor}.$((patch + 1))" ;;
        minor) bumped="${major}.$((minor + 1)).0" ;;
        major) bumped="$((major + 1)).0.0" ;;
    esac
    version="$(printf '%s\n%s\n' "$base" "$bumped" | sort -V | tail -n1)"
fi

if [ "$dev" = no ]; then
    echo "$version"
    exit 0
fi

# Dev counter: commits on this branch since the tag the version was derived from. Monotonic within
# a release cycle (which is all the comparison needs) and it resets when a release is cut — the core
# has moved by then, so the reset cannot make a later build look older.
if [[ -z "$latest" ]]; then
    count="$(git -C "$repo_root" rev-list --count HEAD)"
else
    count="$(git -C "$repo_root" rev-list --count "v${latest}..HEAD")"
fi
echo "${version}-dev.${count}"
