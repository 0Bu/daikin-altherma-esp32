#!/usr/bin/env bash
# Shared, runner-neutral functions for require-pr-gates.sh.

agent_gate_run_bounded() {
    local seconds="$1" lib_root
    shift
    lib_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$lib_root/run_with_timeout.py" "$seconds" "$@"
}

# Filter stdin to real column-zero Markdown task-list records. Inline examples, blockquotes, nested
# lists, indented code, and fenced code are prose and must neither satisfy nor shadow a PR gate.
# CommonMark fences remember their opener character and length: only the same character with at
# least that many markers and trailing whitespace only closes the fence.
agent_gate_task_lines() {
    python3 -c '
import re
import sys

fence_char = None
fence_length = 0
html_comment = False
raw_mode = None

fence_re = re.compile(r"^( {0,3})(`{3,}|~{3,})(.*)$")
task_re = re.compile(r"^[-*]\s+\[[ xX]\]\s+")
type_one_re = re.compile(r"^<(pre|script|style|textarea)(?=[\s>]|$)", re.I)
tag_start_re = re.compile(r"^</?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)")
block_tags = {
    "address", "article", "aside", "base", "basefont", "blockquote", "body",
    "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir",
    "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
    "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head",
    "header", "hr", "html", "iframe", "legend", "li", "link", "main", "menu",
    "menuitem", "nav", "noframes", "ol", "optgroup", "option", "p", "param",
    "search", "section", "summary", "table", "tbody", "td", "tfoot", "th",
    "thead", "title", "tr", "track", "ul",
}

def fence_parts(line):
    match = fence_re.match(line)
    if not match:
        return None
    token, rest = match.group(2), match.group(3)
    if token[0] == "`" and "`" in rest:
        return None
    return token[0], len(token), rest

def raw_opener(text, inline=False):
    indent = len(text) - len(text.lstrip(" "))
    if not inline and indent > 3:
        return None
    candidate = text.lstrip() if inline else text[indent:]
    if candidate.startswith("<!--"):
        return ("delim", "-->")
    if candidate.startswith("<?"):
        return ("delim", "?>")
    if candidate.startswith("<![CDATA["):
        return ("delim", "]]>")
    if re.match(r"^<![A-Z]", candidate):
        return ("delim", ">")
    match = type_one_re.match(candidate)
    if match:
        return ("tag", match.group(1).lower())
    match = tag_start_re.match(candidate)
    if match and match.group(1).lower() in block_tags:
        return ("blank", "type6")
    if match and ">" in candidate:
        # Treat every complete opening or closing tag as type 7. This is deliberately conservative
        # when paragraph context is ambiguous.
        return ("blank", "type7")
    return None

def advance_delimited(line, mode):
    position = 0
    current = mode
    while current and current[0] in {"delim", "tag"}:
        if current[0] == "tag":
            close = re.search(rf"</{re.escape(current[1])}\s*>", line[position:], re.I)
            if not close:
                return current
            position += close.end()
        else:
            end = line.find(current[1], position)
            if end < 0:
                return current
            position = end + len(current[1])
        current = raw_opener(line[position:], inline=True)
    return current

def consume_comments(line):
    global html_comment
    position = 0
    saw = html_comment
    last_close = 0
    while position <= len(line):
        if html_comment:
            end = line.find("-->", position)
            if end < 0:
                return True, ""
            position = end + 3
            last_close = position
            html_comment = False
            saw = True
        else:
            start = line.find("<!--", position)
            if start < 0:
                return saw, line[last_close:] if saw else line
            position = start + 4
            html_comment = True
            saw = True
    return saw, ""

for line in sys.stdin.read().splitlines():
    parts = fence_parts(line)
    if fence_char is not None:
        if parts and parts[0] == fence_char and parts[1] >= fence_length \
                and re.fullmatch(r"[ \t]*", parts[2]):
            fence_char = None
            fence_length = 0
        continue
    if html_comment:
        saw_comment, tail = consume_comments(line)
        if not html_comment and tail:
            raw_mode = raw_opener(tail, inline=True) or raw_mode
            if raw_mode and raw_mode[0] in {"delim", "tag"}:
                raw_mode = advance_delimited(tail, raw_mode)
        continue
    if raw_mode:
        if raw_mode[0] == "blank":
            if not line.strip():
                raw_mode = None
        else:
            raw_mode = advance_delimited(line, raw_mode)
        continue
    if parts:
        fence_char, fence_length, _ = parts
        continue
    saw_comment, tail = consume_comments(line)
    if saw_comment:
        if not html_comment and tail:
            raw_mode = raw_opener(tail, inline=True)
            if raw_mode and raw_mode[0] in {"delim", "tag"}:
                raw_mode = advance_delimited(tail, raw_mode)
        continue
    raw_mode = raw_opener(line)
    if raw_mode:
        if raw_mode[0] in {"delim", "tag"}:
            raw_mode = advance_delimited(line, raw_mode)
        continue
    if task_re.match(line):
        print(line)
'
}

agent_gate_checkbox_status() {
    local body_file="$1" key="$2" task_lines line sha
    [ -f "$body_file" ] && [ -r "$body_file" ] || return 2
    task_lines="$(agent_gate_task_lines <"$body_file")" || return 2
    line="$(printf '%s\n' "$task_lines" | python3 -c '
import re, sys
key = re.escape(sys.argv[1])
pattern = re.compile(
    rf"^[-*]\s+\[[ xX]\]\s+`?[$/]{key}`?(?=\s|$).*\bmerge\s+gate\b",
    re.IGNORECASE,
)
matches = [candidate for candidate in sys.stdin.read().splitlines() if pattern.search(candidate)]
if not matches:
    print("absent")
elif len(matches) != 1:
    print("ambiguous")
else:
    print(matches[0])
' "$key")" || return 2
    case "$line" in
        absent|ambiguous) printf '%s\n' "$line"; return 0 ;;
    esac
    if printf '%s' "$line" | grep -qE '\[[xX]\]'; then
        sha="$(printf '%s' "$line" | python3 -c '
import re, sys
record = sys.stdin.read()
direct = re.findall(
    r"\bmerge\s+gate\s+@\s*([0-9a-f]{7,40})(?![0-9A-Za-z])",
    record,
    re.IGNORECASE,
)
all_at = re.findall(r"@\s*[0-9A-Za-z]+", record)
if len(direct) == len(all_at) == 1:
    print(direct[0])
')"
        [ -n "$sha" ] && printf 'checked %s\n' "$sha" || printf 'checked\n'
    else
        printf 'unchecked\n'
    fi
}

agent_gate_sha_matches() {
    local left right
    left="$(printf '%s' "$1" | tr 'A-F' 'a-f')"
    right="$(printf '%s' "$2" | tr 'A-F' 'a-f')"
    [ "${#left}" -ge 7 ] && [ "${#right}" -ge 7 ] || return 1
    case "$left" in "$right"*) return 0 ;; esac
    case "$right" in "$left"*) return 0 ;; esac
    return 1
}

agent_gate_project_root() {
    local requested="${1:-}" root
    [ -n "$requested" ] || requested="${AGENT_PROJECT_DIR:-${PROJECT_DIR:-$PWD}}"
    root="$(git -C "$requested" rev-parse --show-toplevel 2>/dev/null)" || root=""
    [ -n "$root" ] && printf '%s\n' "$root" || printf '%s\n' "$requested"
}

# Print NUL-delimited: action, PR selector, payload cwd, target repo, target host, parse error.
# Empty action means this is not a merge.
agent_gate_parse_payload() {
    local lib_root
    lib_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$lib_root/merge_payload.py" 2>/dev/null
}

agent_gate_origin_identity() {
    local root="$1" url
    url="$(git -C "$root" remote get-url origin 2>/dev/null)" || return 2
    python3 - "$url" <<'PY'
import re, sys
from urllib.parse import urlparse

value = sys.argv[1].strip()
if value.endswith(".git"):
    value = value[:-4]
if "://" in value:
    parsed = urlparse(value)
    host = parsed.hostname or ""
    path = parsed.path
else:
    match = re.fullmatch(r"(?:[^@/:]+@)?([^/:]+):(.+)", value)
    if not match:
        raise SystemExit(1)
    host, path = match.groups()
parts = [part for part in path.strip("/").split("/") if part]
if len(parts) != 2 or not host or any(
    re.fullmatch(r"[A-Za-z0-9_.-]+", part) is None for part in parts
):
    raise SystemExit(1)
print(host.lower(), f"{parts[0]}/{parts[1]}")
PY
}

agent_gate_repo_slug() {
    local root="$1" identity host slug
    identity="$(agent_gate_origin_identity "$root")" || { printf ''; return; }
    read -r host slug <<<"$identity"
    [ "$host" = github.com ] || { printf ''; return; }
    printf '%s' "$slug"
}

agent_gate_target_matches() {
    local root="$1" target_repo="${2:-}" target_host="${3:-}" current identity origin_host
    identity="$(agent_gate_origin_identity "$root")" || return 2
    read -r origin_host current <<<"$identity"
    [ "$origin_host" = github.com ] || return 1
    python3 -c '
import re, sys
current, target, host = (value.strip().removesuffix(".git") for value in sys.argv[1:4])
if re.search(r"[\s$`{};&|<>]", target + host):
    sys.exit(1)
parts = [part for part in target.split("/") if part]
if len(parts) == 3:
    embedded_host, owner, repo = parts
    if host and host.lower() != embedded_host.lower():
        sys.exit(1)
    host = embedded_host
    target = owner + "/" + repo
elif target and len(parts) != 2:
    sys.exit(1)
if host and host.lower() != "github.com":
    sys.exit(1)
if target and target.lower() != current.lower():
    sys.exit(1)
' "$current" "$target_repo" "$target_host"
}

agent_gate_workdir_matches() {
    local root="$1" requested="${2:-}" root_real requested_real root_git requested_git
    [ -n "$requested" ] || return 0
    root_real="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
    requested_real="$(cd "$requested" 2>/dev/null && pwd -P)" || return 1
    root_git="$(git -C "$root_real" rev-parse --show-toplevel 2>/dev/null)" || root_git=""
    requested_git="$(git -C "$requested_real" rev-parse --show-toplevel 2>/dev/null)" || requested_git=""
    if [ -n "$root_git" ]; then
        [ -n "$requested_git" ] && [ "$root_git" = "$requested_git" ]
        return
    fi
    case "$requested_real" in
        "$root_real"|"$root_real"/*) return 0 ;;
        *) return 1 ;;
    esac
}

# Discover a PR into caller-owned files. Sets AGENT_DISCOVERED_HEAD and returns 0 on success.
agent_gate_discover_pr() {
    local selector="$1" root="$2" body_file="$3" files_file="$4"
    local json number branch slug token owner list count page page_json page_count
    local changed_count pages_file policy_extractor retrieved_count separator
    AGENT_DISCOVERED_HEAD=""
    slug="$(agent_gate_repo_slug "$root")"; [ -n "$slug" ] || return 2
    policy_extractor="$(cd "$(dirname "${BASH_SOURCE[0]}")/../agent-policy" && pwd)/extract_changed_files.py" \
        || return 2
    if command -v gh >/dev/null 2>&1; then
        if [ -n "$selector" ]; then
            json="$(agent_gate_run_bounded 30 env GH_HOST=github.com GH_REPO="github.com/$slug" gh pr view "$selector" --json number,body,headRefOid,changedFiles 2>/dev/null)" || return 2
        else
            branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || return 2
            [ -n "$branch" ] && [ "$branch" != "HEAD" ] || return 2
            list="$(agent_gate_run_bounded 30 env GH_HOST=github.com GH_REPO="github.com/$slug" gh pr list --head "$branch" --state open --json number,body,headRefOid,changedFiles 2>/dev/null)" || return 2
            count="$(printf '%s' "$list" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)" || return 2
            [ "$count" != "0" ] || return 1
            json="$(printf '%s' "$list" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)[0]))')" || return 2
        fi
        AGENT_DISCOVERED_HEAD="$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("headRefOid") or "")')" || return 2
        printf '%s' "$json" | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("body") or "")' >"$body_file" || return 2
        number="$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("number") or "")')" || return 2
        [ -n "$number" ] || return 2
        changed_count="$(printf '%s' "$json" | python3 -c '
import json, sys
value = json.load(sys.stdin).get("changedFiles")
if not isinstance(value, int) or isinstance(value, bool) or value < 0:
    raise SystemExit(1)
print(value)
' 2>/dev/null)" || return 2
        [ "$changed_count" -le 3000 ] || return 2
        pages_file="${files_file}.pages.json"
        if ! agent_gate_run_bounded 60 env GH_HOST=github.com GH_REPO="github.com/$slug" \
            gh api --hostname github.com --paginate --slurp \
            "repos/$slug/pulls/$number/files?per_page=100" >"$pages_file" 2>/dev/null; then
            rm -f "$pages_file"
            return 2
        fi
        if ! python3 "$policy_extractor" "$changed_count" "$pages_file" >"$files_file"; then
            rm -f "$pages_file"
            return 2
        fi
        rm -f "$pages_file"
        return 0
    fi

    token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    [ -n "$token" ] && command -v curl >/dev/null 2>&1 || return 2
    printf '%s' "$token" | grep -Eq '^[A-Za-z0-9_.=-]+$' || return 2
    if printf '%s' "$selector" | grep -qE '^[0-9]+$'; then
        number="$selector"
    elif printf '%s' "$selector" | grep -qE '^https?://[^/]+/[^/]+/[^/]+/(pull|pulls)/[0-9]+/?$'; then
        number="$(printf '%s' "$selector" | sed -E 's#^.*/(pull|pulls)/([0-9]+)/?$#\2#')"
    else
        number=""
    fi
    if [ -n "$number" ]; then
        json="$(printf 'Authorization: Bearer %s\n' "$token" | curl -fsSL --connect-timeout 5 --max-time 10 -H @- -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$slug/pulls/$number" 2>/dev/null)" || return 2
    else
        branch="$selector"
        if [ -z "$branch" ]; then
            branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || return 2
        fi
        [ -n "$branch" ] && [ "$branch" != "HEAD" ] || return 2
        owner="${slug%%/*}"
        list="$(printf 'Authorization: Bearer %s\n' "$token" | curl -fsSL --connect-timeout 5 --max-time 10 -H @- -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$slug/pulls?head=$owner:$branch&state=open" 2>/dev/null)" || return 2
        count="$(printf '%s' "$list" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)" || return 2
        [ "$count" != "0" ] || return 1
        json="$(printf '%s' "$list" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)[0]))')" || return 2
        number="$(printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("number") or "")')" || return 2
    fi
    AGENT_DISCOVERED_HEAD="$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("head") or {}).get("sha") or d.get("headRefOid") or "")')" || return 2
    printf '%s' "$json" | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("body") or "")' >"$body_file" || return 2
    changed_count="$(printf '%s' "$json" | python3 -c '
import json, sys
value = json.load(sys.stdin).get("changed_files")
if not isinstance(value, int) or isinstance(value, bool) or value < 0:
    raise SystemExit(1)
print(value)
' 2>/dev/null)" || return 2
    [ "$changed_count" -le 3000 ] || return 2
    pages_file="${files_file}.pages.json"
    printf '[' >"$pages_file" || return 2
    separator=""
    retrieved_count=0
    page=1
    while :; do
        page_json="$(printf 'Authorization: Bearer %s\n' "$token" | curl -fsSL --connect-timeout 5 --max-time 10 -H @- -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$slug/pulls/$number/files?per_page=100&page=$page" 2>/dev/null)" \
            || { rm -f "$pages_file"; return 2; }
        page_count="$(printf '%s' "$page_json" | python3 -c '
import json, sys
value = json.load(sys.stdin)
if not isinstance(value, list) or len(value) > 100:
    raise SystemExit(1)
print(len(value))
' 2>/dev/null)" || { rm -f "$pages_file"; return 2; }
        printf '%s%s' "$separator" "$page_json" >>"$pages_file" \
            || { rm -f "$pages_file"; return 2; }
        separator=,
        retrieved_count=$((retrieved_count + page_count))
        [ "$retrieved_count" -le "$changed_count" ] \
            || { rm -f "$pages_file"; return 2; }
        [ "$retrieved_count" -eq "$changed_count" ] && break
        [ "$page_count" -eq 100 ] || break
        page=$((page + 1))
        [ "$page" -le 30 ] || { rm -f "$pages_file"; return 2; }
    done
    printf ']' >>"$pages_file" || { rm -f "$pages_file"; return 2; }
    if ! python3 "$policy_extractor" "$changed_count" "$pages_file" >"$files_file"; then
        rm -f "$pages_file"
        return 2
    fi
    rm -f "$pages_file"
    return 0
}

agent_gate_relevant() {
    local files_file="$1" pattern="$2"
    [ -n "$pattern" ] || return 0
    [ -r "$files_file" ] || return 2
    grep -Eq "$pattern" "$files_file" 2>/dev/null
}
