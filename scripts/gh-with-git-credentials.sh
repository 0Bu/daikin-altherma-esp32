#!/usr/bin/env bash
# Run GitHub CLI with an already-provided CI token or a Git credential resolved for github.com.
# Credential material stays in this process environment: it is never printed, written, or placed in
# argv. Agents must use this wrapper instead of reading a credential store or invoking credential
# helpers directly.
set -euo pipefail
set +x

command -v gh >/dev/null 2>&1 || {
    echo "gh-with-git-credentials: GitHub CLI is unavailable" >&2
    exit 2
}

fail() {
    echo "gh-with-git-credentials: $1" >&2
    exit 2
}

validate_repo() {
    case "$1" in
        github.com/*/*)
            printf '%s' "$1" | grep -Eq '^github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
                || fail "--repo must name github.com/OWNER/REPO"
            ;;
        */*)
            printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
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
    "pr checkout"|"repo clone"|"repo sync")
        fail "Git-spawning checkout and clone commands are not allowed with credential forwarding"
        ;;
esac

if [ -n "${GH_REPO:-}" ]; then
    validate_repo "$GH_REPO"
fi
unset GH_DEBUG DEBUG GIT_EXTERNAL_DIFF GIT_SSH GIT_SSH_COMMAND GIT_ASKPASS SSH_ASKPASS
export GH_PROMPT_DISABLED=1
export GH_PAGER=/bin/cat PAGER=/bin/cat GIT_PAGER=/bin/cat
export GH_BROWSER=/usr/bin/false BROWSER=/usr/bin/false
export GH_EDITOR=/usr/bin/false EDITOR=/usr/bin/false VISUAL=/usr/bin/false GIT_EDITOR=/usr/bin/false

token=""
if [ -n "${GH_TOKEN:-}" ]; then
    token="$GH_TOKEN"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
    token="$GITHUB_TOKEN"
else
    credential_output=""
    if ! credential_output="$({
        printf 'protocol=https\nhost=github.com\n\n'
    } | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null)"; then
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

# Ignore ambient gh/XDG configuration, including http_unix_socket routing. A clean, private config
# directory keeps the github.com binding meaningful even on a previously configured workstation.
umask 077
config_dir="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/daikin-gh-config.XXXXXX")" \
    || fail "cannot create an isolated GitHub CLI configuration"
cleanup_config() {
    /bin/rm -rf -- "$config_dir"
}
trap cleanup_config EXIT

unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_CONFIG_DIR XDG_CONFIG_HOME
set +e
GH_TOKEN="$token" GH_HOST=github.com GH_CONFIG_DIR="$config_dir" gh "$@"
status=$?
set -e
unset token
exit "$status"
