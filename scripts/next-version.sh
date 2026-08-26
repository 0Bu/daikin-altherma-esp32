#!/usr/bin/env bash
# Print the version CI should stamp into the firmware — for a RELEASE or for a DEV build.
#
#   scripts/next-version.sh [patch|minor|major]   the next RELEASE version   (default: patch)
#   scripts/next-version.sh --dev                 the next DEV build version
#   scripts/next-version.sh --exact X.Y.Z         validate/echo a release version (resume path)
#
# RELEASES ARE MANUAL. A merge to main no longer cuts one: the release path is a
# `workflow_dispatch` run of .github/workflows/build.yml with `release: true` (and the bump level
# below), which is the only thing that creates a v* tag. Every other push to main publishes a DEV
# build instead, so `main` moves without the version number moving with it.
#
# version.txt is the FLOOR: bump it to force a specific next version. Otherwise the level argument
# decides which segment moves above the highest strict-SemVer v* tag reachable from HEAD.
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
# Requires full history and tags to be fetched before calling in CI.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Command substitution removes the terminating newline but preserves every other byte. Internal or
# surrounding whitespace is therefore rejected by the strict SemVer expression instead of being
# silently deleted into a different version.
base="$(cat "$repo_root/version.txt")"

# Release tags and the floor are deliberately the stable SemVer subset. Accepting an arbitrary v*
# tag and feeding its tail into shell arithmetic lets a typo such as v1.2.latest choose or crash a
# production release. Leading zeroes are rejected too: there must be one canonical spelling.
semver_re='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
is_semver() { [[ "$1" =~ $semver_re ]]; }
is_semver "$base" || {
    echo "next-version: version.txt must contain strict X.Y.Z SemVer (got '$base')" >&2
    exit 1
}

dev=no
level=patch
level_set=no
exact=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dev)
            [ "$dev" = no ] || { echo "next-version: --dev specified more than once" >&2; exit 1; }
            dev=yes; shift ;;
        --exact)
            [ -z "$exact" ] || { echo "next-version: --exact specified more than once" >&2; exit 1; }
            [ "$#" -ge 2 ] || { echo "next-version: --exact requires X.Y.Z" >&2; exit 1; }
            exact="$2"; shift 2 ;;
        patch|minor|major)
            [ "$level_set" = no ] || { echo "next-version: bump level specified more than once" >&2; exit 1; }
            level="$1"; level_set=yes; shift ;;
        *) echo "next-version: unknown argument '$1' (expected --dev / --exact X.Y.Z / patch / minor / major)" >&2
           exit 1 ;;
    esac
done
[ -z "$exact" ] || { [ "$dev" = no ] && [ "$level_set" = no ]; } || {
    echo "next-version: --exact cannot be combined with --dev or a bump level" >&2
    exit 1
}
if [ -n "$exact" ]; then
    is_semver "$exact" || {
        echo "next-version: --exact requires strict X.Y.Z SemVer (got '$exact')" >&2
        exit 1
    }
    echo "$exact"
    exit 0
fi
[ "$dev" = yes ] && level=patch   # a dev build always leads to the next PATCH: it must sort below
                                  # whatever the next release turns out to be, and patch is lowest

latest=""
# A local checkout may retain tags from an abandoned or rewritten history. Such tags cannot name a
# release in HEAD's lineage and must not inflate the next version (or make it fail on a malformed
# orphan tag). Reachable malformed v* tags still fail closed because they are part of the history
# being versioned.
while IFS= read -r tag; do
    version_tag="${tag#v}"
    is_semver "$version_tag" || {
        echo "next-version: refusing malformed release tag '$tag' (expected vX.Y.Z)" >&2
        exit 1
    }
    if [ -z "$latest" ] || [ "$(printf '%s\n%s\n' "$latest" "$version_tag" | sort -V | tail -n1)" = "$version_tag" ]; then
        latest="$version_tag"
    fi
done < <(git -C "$repo_root" tag -l 'v*' --merged=HEAD)

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
