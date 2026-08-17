#!/bin/bash -p
# Run GitHub CLI with an already-provided CI token or a Git credential resolved for github.com.
# Credential material stays in process memory or an unlinked kernel FIFO: it is never printed,
# persisted, written to a regular file, or placed in argv. Agents must use this wrapper instead of
# reading a credential store or invoking credential helpers directly.
set +x
case "$-" in
    *p*) ;;
    *)
        echo "gh-with-git-credentials: invoke this executable directly; an unprivileged shell bootstrap is not allowed" >&2
        exit 2
        ;;
esac
set -euo pipefail

# Capture an already-provided token with shell builtins, then remove every exported token name
# before the first external child process. The scratch variable was explicitly unset first so an
# ambient exported variable named `token` cannot make the captured credential inheritable.
unset token credential_output remaining line credential_user credential_home credential_file \
    body_path body_content body_dir body_base body_logical_dir body_physical_dir \
    wrapper_source wrapper_logical_dir wrapper_physical_dir wrapper_identity
token=""
if [ -n "${GH_TOKEN:-}" ]; then
    token="$GH_TOKEN"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
    token="$GITHUB_TOKEN"
fi
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN

fail() {
    echo "gh-with-git-credentials: $1" >&2
    exit 2
}

wrapper_source="${BASH_SOURCE[0]}"
case "$wrapper_source" in
    /*) ;;
    *) wrapper_source="$PWD/$wrapper_source" ;;
esac
[ ! -L "$wrapper_source" ] || fail "the canonical wrapper must not be invoked through a symlink"
wrapper_logical_dir="$(cd -- "${wrapper_source%/*}" 2>/dev/null && pwd -L)" \
    || fail "cannot resolve the wrapper directory"
wrapper_physical_dir="$(cd -P -- "${wrapper_source%/*}" 2>/dev/null && pwd -P)" \
    || fail "cannot resolve the physical wrapper directory"
[ "$wrapper_logical_dir" = "$wrapper_physical_dir" ] \
    || fail "the canonical wrapper path must not traverse a symlink"
[ "${wrapper_source##*/}" = gh-with-git-credentials.sh ] \
    || fail "the canonical wrapper must keep its reviewed file name"
PROJECT_ROOT="$(cd -P -- "$wrapper_physical_dir/.." 2>/dev/null && pwd -P)" \
    || fail "cannot resolve the repository root"
wrapper_identity="$PROJECT_ROOT/scripts/gh-with-git-credentials.sh"
[ "$wrapper_physical_dir/${wrapper_source##*/}" = "$wrapper_identity" ] \
    || fail "the canonical wrapper must run from this checkout's scripts directory"

# Do not let shell bootstrap files, dynamic-loader hooks, or caller PATH affect a child process that
# receives the token. The wrapper itself is privileged before these variables are inspected.
unset BASH_ENV ENV LD_AUDIT LD_PRELOAD LD_LIBRARY_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
SAFE_PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export PATH="$SAFE_PATH"

# Ignore shell functions and caller-controlled PATH. These are the reviewed install locations on
# the supported macOS and Ubuntu hosts; selftests patch only their private copy of these literals.
GH_BINARY_CANDIDATES='/opt/homebrew/bin/gh /usr/local/bin/gh /usr/bin/gh'
GIT_BINARY_CANDIDATES='/usr/bin/git /opt/homebrew/bin/git /usr/local/bin/git'
PYTHON_BINARY_CANDIDATES='/usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3'
gh_bin=""
git_bin=""
python_bin=""
for candidate in $GH_BINARY_CANDIDATES; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then gh_bin="$candidate"; break; fi
done
for candidate in $GIT_BINARY_CANDIDATES; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then git_bin="$candidate"; break; fi
done
for candidate in $PYTHON_BINARY_CANDIDATES; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then python_bin="$candidate"; break; fi
done
[ -n "$gh_bin" ] || fail "GitHub CLI is unavailable in a reviewed install location"
[ -n "$git_bin" ] || fail "Git is unavailable in a reviewed install location"
[ -n "$python_bin" ] || fail "Python 3 is unavailable in a reviewed install location"

# Bind runtime policy to the physical worktree containing this exact tracked wrapper. Replacement
# refs are forbidden even though every object-sensitive command also disables their interpretation.
binding_git_env=(
    "PATH=$SAFE_PATH"
    "GIT_CONFIG_NOSYSTEM=1"
    "GIT_CONFIG_GLOBAL=/dev/null"
    "GIT_CONFIG_SYSTEM=/dev/null"
    "GIT_NO_REPLACE_OBJECTS=1"
)
resolved_project_root="$(/usr/bin/env -i "${binding_git_env[@]}" \
    "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" rev-parse --show-toplevel 2>/dev/null)" \
    || fail "the canonical wrapper is not inside a Git worktree"
[ "$resolved_project_root" = "$PROJECT_ROOT" ] \
    || fail "the canonical wrapper is not bound to this physical checkout root"
tracked_wrapper="$(/usr/bin/env -i "${binding_git_env[@]}" \
    "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" \
    ls-files --error-unmatch -- scripts/gh-with-git-credentials.sh 2>/dev/null)" \
    || fail "the canonical wrapper is not tracked by this checkout"
[ "$tracked_wrapper" = scripts/gh-with-git-credentials.sh ] \
    || fail "the canonical wrapper path is ambiguous"
replacement_refs="$(/usr/bin/env -i "${binding_git_env[@]}" \
    "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" \
    for-each-ref --format='%(refname)' refs/replace 2>/dev/null)" \
    || fail "cannot verify replacement-ref absence"
[ -z "$replacement_refs" ] || fail "Git replacement refs are forbidden for GitHub actions"
unset resolved_project_root tracked_wrapper replacement_refs

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

read_body_file() {
    case "$1" in
        ""|-) fail "--body-file must name a regular local file" ;;
        /*) ;;
        *) fail "--body-file must use a physical absolute path" ;;
    esac
    case "$1" in
        proc|proc/*|*/proc|*/proc/*)
            fail "process pseudo-files are not allowed with credential forwarding"
            ;;
    esac
    /usr/bin/env -i PATH="$SAFE_PATH" HOME=/tmp TMPDIR=/tmp "$python_bin" - "$1" <<'PY'
import os
import stat
import sys

requested = sys.argv[1]
if not os.path.isabs(requested):
    requested = os.path.join(os.getcwd(), requested)
parts = requested.split("/")
if parts and parts[0] == "":
    parts = parts[1:]
if not parts or parts[0] == "proc" or any(part == ".." for part in parts):
    raise SystemExit(2)

lower_parts = [part.lower() for part in parts if part not in {"", "."}]
secret_components = {".git", ".ssh", ".gnupg", ".aws", ".kube", "secrets", ".secrets"}
secret_leafs = {
    ".env", ".git" + "-credentials", ".npmrc", ".pypirc", "credentials", "credentials.json",
    "credentials.yml", "credentials.yaml", "id_dsa", "id_ecdsa", "id_ed25519",
    "id_ed25519_sk", "id_rsa", "keychain", "netrc", ".netrc", "ota_signing_key.pem",
    "private_key", "secrets.env", "sdkconfig.local", "service-account.json",
}
secret_suffixes = (".jks", ".kdbx", ".key", ".keystore", ".p12", ".pem", ".pfx")
leaf = lower_parts[-1] if lower_parts else ""
joined_path = "/".join(lower_parts)
sensitive_path_suffixes = (
    ".aws/credentials", ".config/gh/hosts.yml", ".docker/config.json", ".gem/credentials",
    ".kube/config",
)
if (set(lower_parts) & secret_components or
        leaf in secret_leafs or
        (leaf.startswith("id_") and not leaf.endswith(".pub")) or
        (leaf.startswith(".env.") and leaf not in {".env.example", ".env.sample", ".env.template"}) or
        leaf.endswith(secret_suffixes) or
        any(joined_path.endswith(suffix) for suffix in sensitive_path_suffixes) or
        any(lower_parts[index:index + 2] in ([".config", "gh"], [".config", "hub"])
            for index in range(len(lower_parts) - 1))):
    raise SystemExit(2)

def check_directory(directory_fd):
    info = os.fstat(directory_fd)
    if not stat.S_ISDIR(info.st_mode):
        raise OSError("body path ancestor is not a directory")
    writable_by_others = info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    safe_sticky_root = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
    if writable_by_others and not safe_sticky_root:
        raise OSError("body path ancestor has an unsafe mode")

directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
file_flags = os.O_RDONLY | os.O_NOFOLLOW
fd = os.open("/", directory_flags)
try:
    check_directory(fd)
    for component in parts[:-1]:
        if component in {"", "."}:
            continue
        next_fd = os.open(component, directory_flags, dir_fd=fd)
        os.close(fd)
        fd = next_fd
        check_directory(fd)
    leaf = parts[-1]
    if leaf in {"", "."}:
        raise OSError("missing body-file leaf")
    body_fd = os.open(leaf, file_flags, dir_fd=fd)
    try:
        info = os.fstat(body_fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                info.st_uid != os.getuid() or
                info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or
                info.st_size > 262144):
            raise OSError("body file is not a bounded regular file")
        chunks = []
        total = 0
        while True:
            chunk = os.read(body_fd, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > 262144:
                raise OSError("body file exceeds 256 KiB")
            chunks.append(chunk)
        body = b"".join(chunks)
        if b"\0" in body:
            raise OSError("body file contains NUL")
        sys.stdout.write(body.decode("utf-8"))
    finally:
        os.close(body_fd)
finally:
    os.close(fd)
PY
}

# Validate the complete invocation before resolving a credential. Unknown top-level commands may be
# aliases or extensions, which execute arbitrary code with the inherited environment. Host and API
# checks prevent a github.com token from being forwarded to another server.
input_args=("$@")
args=()
body_file_converted=0
top_level=""
second_level=""
index=0
while [ "$index" -lt "${#input_args[@]}" ]; do
    argument="${input_args[$index]}"
    case "$argument" in
        --body-file)
            index=$((index + 1))
            [ "$index" -lt "${#input_args[@]}" ] || fail "--body-file has no value"
            body_content="$(read_body_file "${input_args[$index]}")" \
                || fail "cannot read the requested PR body file safely"
            args+=(--body "$body_content")
            body_file_converted=1
            index=$((index + 1))
            continue
            ;;
        --body-file=*)
            body_content="$(read_body_file "${argument#--body-file=}")" \
                || fail "cannot read the requested PR body file safely"
            args+=(--body "$body_content")
            body_file_converted=1
            index=$((index + 1))
            continue
            ;;
        --input|--input=*|--notes-file|--notes-file=*|-F|*=@*)
            fail "local file input is not allowed with credential forwarding"
            ;;
        --jq|--jq=*|-q|-q?*|--template|--template=*|-t|-t?*)
            fail "jq and template formatting are not allowed with credential forwarding"
            ;;
        -[!-]?*)
            fail "combined short options are not allowed with credential forwarding"
            ;;
        proc|proc/*|*/proc|*/proc/*)
            fail "process pseudo-files are not allowed with credential forwarding"
            ;;
        --hostname)
            args+=("$argument")
            index=$((index + 1))
            [ "$index" -lt "${#input_args[@]}" ] || fail "--hostname has no value"
            args+=("${input_args[$index]}")
            [ "${input_args[$index]}" = github.com ] || fail "only github.com is allowed"
            index=$((index + 1))
            continue
            ;;
        --hostname=*)
            [ "${argument#--hostname=}" = github.com ] || fail "only github.com is allowed"
            ;;
        --repo|-R)
            args+=("$argument")
            index=$((index + 1))
            [ "$index" -lt "${#input_args[@]}" ] || fail "--repo has no value"
            args+=("${input_args[$index]}")
            validate_repo "${input_args[$index]}"
            index=$((index + 1))
            continue
            ;;
        --repo=*) validate_repo "${argument#--repo=}" ;;
        -R?*) validate_repo "${argument#-R}" ;;
        *://*) fail "absolute API URLs are not allowed" ;;
        *:*/*) fail "SSH-style repository targets are not allowed with credential forwarding" ;;
        --verbose|--verbose=*) fail "verbose request output is not allowed" ;;
        --allow-escape-sequences|--allow-escape-sequences=*)
            fail "raw terminal escape output is not allowed"
            ;;
        --web|--web=*|--editor|--editor=*|-w|-e)
            fail "browser and editor execution is not allowed"
            ;;
        -*) ;;
        *)
            if [ -z "$top_level" ]; then
                top_level="$argument"
            elif [ -z "$second_level" ]; then
                second_level="$argument"
            elif [ "$top_level" = repo ]; then
                case "$argument" in
                    */*/*) validate_repo "$argument" ;;
                esac
            fi
            ;;
    esac
    args+=("$argument")
    index=$((index + 1))
done

case "$top_level" in
    api|issue|pr|release|repo|run|search|workflow) ;;
    auth) fail "authentication commands are not allowed; the wrapper never prints tokens" ;;
    alias|extension) fail "aliases and extensions are not allowed with credential forwarding" ;;
    "") fail "a reviewed built-in gh command is required" ;;
    *) fail "unsupported gh command: $top_level" ;;
esac

if [ "$top_level $second_level" = "pr create" ]; then
    # PR publication is the only creation form exposed by this repository wrapper. Keep the exact
    # noninteractive argv shape small enough to review: explicit canonical repo, already-pushed
    # head branch, main base, and literal title/body. `--body-file` was converted above before any
    # credential lookup. Any fill/template/editor/web/draft/project/reviewer variant fails here.
    [ "${#args[@]}" -eq 12 ] \
        && [ "${args[0]}" = --repo ] \
        && [ "${args[1]}" = github.com/0Bu/daikin-altherma-esp32 ] \
        && [ "${args[2]}" = pr ] \
        && [ "${args[3]}" = create ] \
        && [ "${args[4]}" = --head ] \
        && [ "${args[6]}" = --base ] \
        && [ "${args[7]}" = main ] \
        && [ "${args[8]}" = --title ] \
        && [ -n "${args[9]}" ] \
        && [ "${args[10]}" = --body ] \
        && [ -n "${args[11]}" ] \
        && [ "$body_file_converted" -eq 1 ] \
        || fail "PR creation must use the exact reviewed noninteractive repository form"
    printf '%s' "${args[5]}" | /usr/bin/grep -Eq '^agent/[A-Za-z0-9][A-Za-z0-9._/-]*$' \
        || fail "PR head must be an explicit already-pushed agent branch"
    case "${args[5]}" in
        *..*|*//*|*/.|*/..) fail "PR head must be an explicit already-pushed agent branch" ;;
    esac
    case "${args[9]}" in
        *$'\n'*|*$'\r'*) fail "PR title must be one nonempty line" ;;
    esac
    [ -z "${GH_REPO:-}" ] || fail "PR creation does not accept an ambient GH_REPO override"
    current_branch="$(/usr/bin/env -i "${binding_git_env[@]}" \
        "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" \
        symbolic-ref --quiet --short HEAD 2>/dev/null)" \
        || fail "PR creation requires a checked-out branch"
    [ "$current_branch" = "${args[5]}" ] \
        || fail "PR head must equal the checked-out branch"
    current_head="$(/usr/bin/env -i "${binding_git_env[@]}" \
        "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" \
        rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" \
        || fail "PR creation cannot resolve the checked-out head"
    worktree_status="$(/usr/bin/env -i "${binding_git_env[@]}" \
        "$git_bin" -c core.fsmonitor=false -C "$PROJECT_ROOT" \
        status --porcelain=v1 --untracked-files=normal 2>/dev/null)" \
        || fail "PR creation cannot verify the worktree state"
    [ -z "$worktree_status" ] || fail "PR creation requires a clean worktree"
    pr_create_branch="${args[5]}"
    pr_create_expected_head="$current_head"
fi

case "$top_level $second_level" in
    "issue develop"|"issue transfer"|"pr checkout"|"pr co"|"pr new"|"pr revert"|"repo clone"|"repo create"|"repo new"|"repo fork"|"repo rename"|"repo set-default"|"repo sync")
        fail "Git-spawning PR and repository commands are not allowed with credential forwarding"
        ;;
    "release create"|"release new"|"release download"|"release upload"|"release verify-asset"|"repo deploy-key"|"repo read-file"|"run download")
        fail "local-file, upload, download, and interactive commands are not allowed with credential forwarding"
        ;;
esac
if [ "$top_level $second_level" = "pr close" ]; then
    for argument in "${args[@]}"; do
        case "$argument" in
            -d|--delete-branch|--delete-branch=*)
                fail "Git-spawning PR and repository commands are not allowed with credential forwarding"
                ;;
        esac
    done
fi

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

# PreToolUse is defense in depth, not the runtime trust boundary: an opaque helper can invoke this
# wrapper after the outer command has already been inspected.  Reclassify every API call and every
# queue-capable `pr merge` here, before credential lookup.  Read-only API calls exit the aggregate
# gate immediately; the one canonical CAS merge reruns current-head discovery, review evidence, and
# last-mile suites.  A clean environment prevents caller-supplied AGENT_* inputs from bypassing it.
if [ "$top_level" = api ] || [ "$top_level $second_level" = "pr merge" ]; then
    merge_gate="$PROJECT_ROOT/tools/agent-hooks/require-pr-gates.sh"
    gate_payload="$config_dir/merge-payload.json"
    [ -x "$merge_gate" ] || fail "the canonical aggregate merge gate is unavailable"
    if ! /usr/bin/env -i PATH="$SAFE_PATH" "$python_bin" - "$PWD" "$wrapper_identity" \
        "${args[@]}" >"$gate_payload" <<'PY'
import json
import shlex
import sys

cwd, wrapper, *arguments = sys.argv[1:]
print(json.dumps({
    "cwd": cwd,
    "tool_name": "exec_command",
    "tool_input": {"cmd": shlex.join([wrapper, *arguments])},
}))
PY
    then
        fail "cannot construct the aggregate merge-gate payload"
    fi
    if ! /usr/bin/env -i PATH="$SAFE_PATH" AGENT_PROJECT_DIR="$PROJECT_ROOT" \
        GIT_NO_REPLACE_OBJECTS=1 \
        "$merge_gate" --payload-file "$gate_payload" >/dev/null; then
        fail "the aggregate GitHub action gate rejected this request"
    fi
    /bin/rm -f -- "$gate_payload"
fi

# GitHub CLI uses `git` for repository discovery and a few built-ins. Keep those descendants useful
# while ensuring they never inherit the token that belongs only in the gh process.
shim_dir="$config_dir/bin"
/bin/mkdir -m 700 "$shim_dir" || fail "cannot create the isolated Git shim directory"
git_shim="$shim_dir/git"
{
    printf '%s\n' '#!/bin/bash -p' 'set +x' \
        'unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN' \
        'export GIT_NO_REPLACE_OBJECTS=1'
    printf 'exec %q "$@"\n' "$git_bin"
} >"$git_shim" || fail "cannot create the isolated Git shim"
/bin/chmod 700 "$git_shim" || fail "cannot secure the isolated Git shim"

if [ -z "$token" ]; then
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
            GIT_CEILING_DIRECTORIES="$config_dir" GIT_TERMINAL_PROMPT=0 GIT_NO_REPLACE_OBJECTS=1 \
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

repo_override="${GH_REPO:-}"
child_env=(
    "HOME=$config_dir"
    "XDG_CONFIG_HOME=$config_dir"
    "TMPDIR=$config_dir"
    "PATH=$shim_dir:$SAFE_PATH"
    "GH_HOST=github.com"
    "GH_CONFIG_DIR=$config_dir"
    "GH_PROMPT_DISABLED=1"
    "GH_TELEMETRY=0"
    "GH_NO_UPDATE_NOTIFIER=1"
    "GH_NO_EXTENSION_UPDATE_NOTIFIER=1"
    "GH_PAGER=cat"
    "PAGER=cat"
    "GIT_PAGER=cat"
    "GIT_NO_REPLACE_OBJECTS=1"
    "GH_BROWSER=/usr/bin/false"
    "BROWSER=/usr/bin/false"
    "GH_EDITOR=/usr/bin/false"
    "EDITOR=/usr/bin/false"
    "VISUAL=/usr/bin/false"
    "GIT_EDITOR=/usr/bin/false"
)
if [ -n "$repo_override" ]; then child_env+=("GH_REPO=$repo_override"); fi
if [ "$top_level $second_level" = "pr create" ]; then
    child_env+=("AGENT_GH_PR_CREATE_BRANCH=$pr_create_branch")
    child_env+=("AGENT_GH_PR_CREATE_EXPECTED_HEAD=$pr_create_expected_head")
fi
# Private selftest copies replace this exact empty array; production forwards no extra variables.
extra_child_env=()
token_child_script='set +x
IFS= read -r token <&9 || exit 2
exec 9>&-
[ -n "$token" ] || exit 2
export GH_TOKEN="$token"
unset token
cd "$HOME" || exit 2
if [ -n "${AGENT_GH_PR_CREATE_EXPECTED_HEAD:-}" ]; then
    remote_head="$("$1" api --hostname github.com --method GET \
        "repos/0Bu/daikin-altherma-esp32/git/ref/heads/$AGENT_GH_PR_CREATE_BRANCH" \
        --jq .object.sha)" || exit 2
    [[ "$remote_head" =~ ^[0-9a-fA-F]{40}$ ]] || exit 2
    [ "$remote_head" = "$AGENT_GH_PR_CREATE_EXPECTED_HEAD" ] || exit 2
    # Publish as a draft first.  A branch race can therefore never expose a ready PR before the
    # server-side head postcondition has been checked.
    created_output="$("$@" --draft)" || exit 2
    [[ "$created_output" =~ https://github[.]com/0Bu/daikin-altherma-esp32/pull/([1-9][0-9]*) ]] \
        || {
            printf "%s\n" "$created_output" >&2
            printf "%s\n" "PR creation returned no parseable URL; inspect GitHub and clean up manually" >&2
            exit 2
        }
    created_number="${BASH_REMATCH[1]}"
    gh_command="$1"
    cleanup_created_pr() {
        cleanup_reason="$1"
        printf "%s\n" "$created_output" >&2
        if "$gh_command" pr close "$created_number" \
            --repo github.com/0Bu/daikin-altherma-esp32 >/dev/null 2>&1; then
            printf "%s\n" "$cleanup_reason; the PR above was closed" >&2
        else
            printf "%s\n" "$cleanup_reason; the PR above needs manual cleanup" >&2
        fi
        exit 2
    }
    created_head="$("$gh_command" pr view "$created_number" \
        --repo github.com/0Bu/daikin-altherma-esp32 \
        --json headRefOid --jq .headRefOid)" \
        || cleanup_created_pr "created PR head lookup failed"
    [[ "$created_head" =~ ^[0-9a-fA-F]{40}$ ]] \
        || cleanup_created_pr "created PR returned an invalid head"
    if [ "$created_head" != "$AGENT_GH_PR_CREATE_EXPECTED_HEAD" ]; then
        cleanup_created_pr "PR head changed during creation"
    fi
    if ! "$gh_command" pr ready "$created_number" \
        --repo github.com/0Bu/daikin-altherma-esp32 >/dev/null; then
        cleanup_created_pr "PR head matched, but marking the draft ready failed"
    fi
    published_head="$("$gh_command" pr view "$created_number" \
        --repo github.com/0Bu/daikin-altherma-esp32 \
        --json headRefOid --jq .headRefOid)" \
        || cleanup_created_pr "published PR head lookup failed"
    [[ "$published_head" =~ ^[0-9a-fA-F]{40}$ ]] \
        || cleanup_created_pr "published PR returned an invalid head"
    if [ "$published_head" != "$AGENT_GH_PR_CREATE_EXPECTED_HEAD" ]; then
        cleanup_created_pr "PR head changed while becoming ready"
    fi
    printf "%s\n" "$created_output"
    unset remote_head created_output created_number created_head published_head gh_command \
        AGENT_GH_PR_CREATE_BRANCH AGENT_GH_PR_CREATE_EXPECTED_HEAD
    exit 0
fi
exec "$@"'
token_fifo="$config_dir/token.fifo"
/usr/bin/mkfifo -m 600 "$token_fifo" || fail "cannot create the private credential channel"
exec 9<> "$token_fifo"
/bin/rm -f -- "$token_fifo"
printf '%s\n' "$token" >&9 || fail "cannot write the private credential channel"
unset token
set +e
if [ "${#extra_child_env[@]}" -gt 0 ]; then
    /usr/bin/env -i "${child_env[@]}" "${extra_child_env[@]}" \
        /bin/bash -p -c "$token_child_script" _ "$gh_bin" "${args[@]}"
else
    /usr/bin/env -i "${child_env[@]}" \
        /bin/bash -p -c "$token_child_script" _ "$gh_bin" "${args[@]}"
fi
status=$?
exec 9>&-
set -e
exit "$status"
