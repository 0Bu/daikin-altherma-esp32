#!/usr/bin/env bash
# PreToolUse guard: never read, edit, write, or force-stage private key material — above all the
# offline OTA signing key. .gitignore already ignores *.pem, but that only stops a plain `git add`;
# it does NOT stop the key being READ into the model context (the real leak vector) nor a
# `git add -f`. This closes both. Denies the tool call with a reason. Reads the tool payload as JSON
# on stdin (matcher: Read|Edit|Write|Bash).
#
# Scope is deliberately the tool TARGET — the file_path for a file tool, the command for Bash — and
# NEVER the file content. So editing docs/SECURITY.md, this hook, or CLAUDE.md (all of which name
# the key) stays allowed; only touching the key/pem FILE itself, or a shell command that reads it,
# is blocked. Fails open on a parse error (python3 is always present here) — a guard must never
# wedge the session.
set -u

payload="$(cat)"

# Parse tool name + the path (file tools) or command (Bash) we act on.
parsed="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = d.get("tool_input", {}) or {}
print(d.get("tool_name", ""))
print(ti.get("file_path", "") or ti.get("command", ""))
' 2>/dev/null)"
tool="$(printf '%s\n' "$parsed" | sed -n '1p')"
target="$(printf '%s\n' "$parsed" | sed -n '2p')"
[ -n "$target" ] || exit 0

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
        "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"blocked: private key material"')"
    exit 0
}

case "$tool" in
    Read|Edit|Write)
        # Every *.pem / *.key in this repo is a secret (.gitignore ignores them). Opening one reads
        # it into context; writing one plants key material in the tree. Block by extension.
        case "$target" in
            *.pem|*.key)
                deny "Blocked: $target is private key material — all *.pem/*.key are secrets in this repo (.gitignore ignores them; the OTA signing key must never be read into context or committed, docs/SECURITY.md). Do not open or write it." ;;
        esac ;;
    Bash)
        case "$target" in
            *ota_signing_key.pem*)
                deny "Blocked: this command touches the offline OTA signing key. It must never be read, copied, or staged (docs/SECURITY.md) — pass it to espsecure.py by path only." ;;
            *git\ add*.pem*|*git\ add*.key*)
                deny "Blocked: refusing to 'git add' private key material (*.pem/*.key). .gitignore excludes these; do not force-stage them (docs/SECURITY.md)." ;;
        esac ;;
esac

exit 0
