#!/bin/bash -p
# Run GitHub CLI with an already-provided CI token or a Git credential resolved for github.com.
# Credential material stays in this process environment: it is never printed, written, or placed in
# argv. Agents must use this wrapper instead of reading a credential store or invoking credential
# helpers directly.
set +x
case "$-" in
    *p*) ;;
    *)
        echo "gh-with-git-credentials: invoke this executable directly; an unprivileged shell bootstrap is not allowed" >&2
        exit 2
        ;;
esac
set -euo pipefail

fail() {
    echo "gh-with-git-credentials: $1" >&2
    exit 2
}

# Do not let shell bootstrap files, dynamic-loader hooks, or caller PATH affect a child process that
# receives the token. The wrapper itself is privileged before these variables are inspected.
unset BASH_ENV ENV LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
SAFE_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH="$SAFE_PATH"

# Ignore shell functions and caller-controlled PATH. These are the reviewed install locations on
# the supported macOS and Ubuntu hosts; selftests patch only their private copy of these literals.
GH_BINARY_CANDIDATES='/opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh'
GIT_BINARY_CANDIDATES='/usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git'
gh_bin=""
git_bin=""
for candidate in $GH_BINARY_CANDIDATES; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then gh_bin="$candidate"; break; fi
done
for candidate in $GIT_BINARY_CANDIDATES; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then git_bin="$candidate"; break; fi
done
[ -n "$gh_bin" ] || fail "GitHub CLI is unavailable in a reviewed install location"
[ -n "$git_bin" ] || fail "Git is unavailable in a reviewed install location"

validate_repo() {
    case "$1" in
        github.com/*/*)
            printf '%s' "$1" | /usr/bin/grep -Eq '^github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
                || fail "--repo must name github.com/OWNER/REPO"
            ;;
        */*)
            printf '%s' "$1" | /usr/bin/grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
                || fail "--repo must name github.com/OWNER/REPO"
            ;;
        *) fail "--repo must name github.com/OWNER/REPO" ;;
    esac
}

# Validate the complete invocation before resolving a credential. Unknown top-level commands may be
# aliases or extensions, which execute arbitrary code with the inherited environment. Host and API
# checks prevent a github.com token from being forwarded to another server.
args=("$@")
top_level=""
second_level=""
index=0
while [ "$index" -lt "${#args[@]}" ]; do
    argument="${args[$index]}"
    case "$argument" in
        --hostname)
            index=$((index + 1))
            [ "$index" -lt "${#args[@]}" ] || fail "--hostname has no value"
            [ "${args[$index]}" = github.com ] || fail "only github.com is allowed"
            ;;
        --hostname=*)
            [ "${argument#--hostname=}" = github.com ] || fail "only github.com is allowed"
            ;;
        --repo|-R)
            index=$((index + 1))
            [ "$index" -lt "${#args[@]}" ] || fail "--repo has no value"
            validate_repo "${args[$index]}"
            ;;
        --repo=*) validate_repo "${argument#--repo=}" ;;
        -R?*) validate_repo "${argument#-R}" ;;
        http://*|https://*) fail "absolute API URLs are not allowed" ;;
        --verbose) fail "verbose request output is not allowed" ;;
        --web|--editor) fail "browser and editor execution is not allowed" ;;
        -*) ;;
        *)
            if [ -z "$top_level" ]; then
                top_level="$argument"
            elif [ -z "$second_level" ]; then
                second_level="$argument"
            fi
            ;;
    esac
    index=$((index + 1))
done

case "$top_level" in
    api|issue|pr|release|repo|run|search|workflow) ;;
    auth) fail "authentication commands are not allowed; the wrapper never prints tokens" ;;
    alias|extension) fail "aliases and extensions are not allowed with credential forwarding" ;;
    "") fail "a reviewed built-in gh command is required" ;;
    *) fail "unsupported gh command: $top_level" ;;
esac

case "$top_level $second_level" in
    "issue develop"|"pr checkout"|"pr create"|"repo clone"|"repo create"|"repo fork"|"repo rename"|"repo sync")
        fail "Git-spawning PR and repository commands are not allowed with credential forwarding"
        ;;
esac

if [ -n "${GH_REPO:-}" ]; then validate_repo "$GH_REPO"; fi

# Both credential lookup and gh use this empty home. It prevents ambient Git/gh configuration from
# adding helpers, proxy/TLS routes, Unix sockets, pagers, editors, hooks, or aliases around a token.
umask 077
config_dir="$(/usr/bin/mktemp -d /tmp/daikin-gh-config.XXXXXX)" \
    || fail "cannot create an isolated GitHub CLI configuration"
cleanup_config() {
    /bin/rm -rf -- "$config_dir"
}
trap cleanup_config EXIT

token=""
if [ -n "${GH_TOKEN:-}" ]; then
    token="$GH_TOKEN"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
    token="$GITHUB_TOKEN"
else
    credential_user="$(/usr/bin/env -i PATH="$SAFE_PATH" /usr/bin/id -un 2>/dev/null)" \
        || fail "cannot resolve the current operating-system user"
    printf '%s' "$credential_user" | /usr/bin/grep -Eq '^[A-Za-z0-9_.-]+$' \
        || fail "the operating-system user name is not safe to resolve"
    credential_home=""
    if [ -x /usr/bin/dscl ]; then
        credential_home="$(/usr/bin/env -i PATH="$SAFE_PATH" /usr/bin/id -P "$credential_user" \
            2>/dev/null | /usr/bin/awk -F: 'NR == 1 { print $9 }')"
    elif [ -x /usr/bin/getent ]; then
        credential_home="$(/usr/bin/env -i PATH="$SAFE_PATH" /usr/bin/getent passwd "$credential_user" \
            | /usr/bin/awk -F: 'NR == 1 { print $6 }')"
    fi
    case "$credential_home" in
        /*) ;;
        *) fail "cannot resolve the current operating-system home directory" ;;
    esac
    credential_file="$credential_home/.git-credentials"
    [ -f "$credential_file" ] && [ -r "$credential_file" ] \
        || fail "no readable github.com Git credential store is configured"
    credential_output=""
    if ! credential_output="$(
        cd "$config_dir" || exit 1
        {
            printf 'protocol=https\nhost=github.com\n\n'
        } | /usr/bin/env -i HOME="$config_dir" XDG_CONFIG_HOME="$config_dir" PATH="$SAFE_PATH" \
            GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
            GIT_CEILING_DIRECTORIES="$config_dir" GIT_TERMINAL_PROMPT=0 \
            "$git_bin" credential-store --file "$credential_file" get 2>/dev/null
    )"; then
        fail "Git credential lookup failed"
    fi

    remaining="$credential_output"$'\n'
    while [[ "$remaining" == *$'\n'* ]]; do
        line="${remaining%%$'\n'*}"
        remaining="${remaining#*$'\n'}"
        case "$line" in
            password=*)
                [ -z "$token" ] || {
                    echo "gh-with-git-credentials: credential helper returned more than one password" >&2
                    exit 2
                }
                token="${line#password=}"
                ;;
        esac
    done
    unset credential_output remaining line
fi

[ -n "$token" ] || {
    echo "gh-with-git-credentials: no github.com credential is configured" >&2
    exit 2
}

gh_env=(
    "HOME=$config_dir"
    "XDG_CONFIG_HOME=$config_dir"
    "TMPDIR=$config_dir"
    "PATH=$SAFE_PATH"
    "GH_TOKEN=$token"
    "GH_HOST=github.com"
    "GH_CONFIG_DIR=$config_dir"
    "GH_PROMPT_DISABLED=1"
    "GH_PAGER=/bin/cat"
    "PAGER=/bin/cat"
    "GIT_PAGER=/bin/cat"
    "GH_BROWSER=/usr/bin/false"
    "BROWSER=/usr/bin/false"
    "GH_EDITOR=/usr/bin/false"
    "EDITOR=/usr/bin/false"
    "VISUAL=/usr/bin/false"
    "GIT_EDITOR=/usr/bin/false"
)
if [ -n "${GH_REPO:-}" ]; then gh_env+=("GH_REPO=$GH_REPO"); fi
# Private selftest copies replace this exact empty array; production forwards no extra variables.
extra_child_env=()
set +e
(
    cd "$config_dir" || exit 1
    if [ "${#extra_child_env[@]}" -gt 0 ]; then
        /usr/bin/env -i "${gh_env[@]}" "${extra_child_env[@]}" "$gh_bin" "$@"
    else
        /usr/bin/env -i "${gh_env[@]}" "$gh_bin" "$@"
    fi
)
status=$?
set -e
unset token
exit "$status"
