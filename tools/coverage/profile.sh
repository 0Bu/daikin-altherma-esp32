#!/usr/bin/env bash
# Select the exact branch-outcome inventory for the compiler execution environment.  Compiler
# family/major is sufficient for ordinary local runs, but GitHub's hosted runner toolchain can
# instrument a translation unit differently from a container carrying the same upstream GCC
# release.  Give every hosted runner image its own fail-closed profile: a new/renamed image has no
# baseline until its complete outcome inventory has been reviewed and committed.

coverage_branch_profile() {
    local family="$1" major="$2" github_actions="$3" runner_os="$4" image_os="$5"
    local runner_slug image_slug profile

    case "$family" in gcc|clang) ;; *) return 2 ;; esac
    printf '%s' "$major" | grep -Eq '^[0-9]+$' || return 2

    profile="${family}-${major}"
    if [ "$github_actions" = true ]; then
        runner_slug="$(printf '%s' "$runner_os" | tr '[:upper:]' '[:lower:]' |
            sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
        image_slug="$(printf '%s' "$image_os" | tr '[:upper:]' '[:lower:]' |
            sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
        [ -n "$runner_slug" ] && [ -n "$image_slug" ] || return 2
        profile="${profile}-github-${runner_slug}-${image_slug}"
    fi
    printf '%s\n' "$profile"
}
