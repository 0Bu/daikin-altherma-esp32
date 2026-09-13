#!/usr/bin/env bash
# Select the exact branch-outcome inventory for the compiler execution environment.  Local profiles
# bind compiler family/major and the platform/packaging slug; authoritative GitHub hosted runners
# additionally bind runner OS and image.  An unreviewed local or hosted environment deliberately selects
# a missing profile and fails closed instead of silently borrowing another packaging's baseline.

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
    elif [ -n "$runner_os" ]; then
        runner_slug="$(printf '%s' "$runner_os" | tr '[:upper:]' '[:lower:]' |
            sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
        [ -n "$runner_slug" ] || return 2
        if [ -n "$image_os" ]; then
            image_slug="$(printf '%s' "$image_os" | tr '[:upper:]' '[:lower:]' |
                sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')"
            [ -n "$image_slug" ] || return 2
            profile="${profile}-${runner_slug}-${image_slug}"
        else
            profile="${profile}-${runner_slug}"
        fi
    fi
    printf '%s\n' "$profile"
}
