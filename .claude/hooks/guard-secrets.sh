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

# Parse tool name + the path (file tools) or FULL command (Bash) we act on. NUL-delimited, not
# newline-delimited: a newline-split reader here previously exposed only a multi-line Bash
# command's FIRST physical line to every check below (line 2+ was silently dropped), so
# `echo hello` + `cat ota_signing_key.pem` on a second line sailed through completely unseen —
# a Bash tool command is routinely multi-line (heredocs, chained scripts), so this was a live
# bypass of every rule in this file, not a theoretical one.
tool=""
target=""
got_tool=0
while IFS= read -r -d '' field; do
    if [ "$got_tool" -eq 0 ]; then
        tool="$field"
        got_tool=1
    else
        target="$field"
    fi
done < <(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = d.get("tool_input", {}) or {}
sys.stdout.write(d.get("tool_name", "") + "\0")
sys.stdout.write((ti.get("file_path", "") or ti.get("command", "")) + "\0")
' 2>/dev/null)
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
                # Narrow carve-out: the flash-esp32 skill's documented signing step
                # (espsecure.py/espsecure sign_data|sign-data --keyfile ... ota_signing_key.pem ...)
                # legitimately names the key by path — that's the "pass it to espsecure.py by path
                # only" the deny message below describes. Judged in python over the WHOLE command as
                # ONE unit (never grep -q, which matches per PHYSICAL LINE): a command that is
                # anything but exactly that one invocation — an extra line, chaining (;/&/|/`` ),
                # substitution ($()), or redirection (</>) — is denied. grep -q would report a match
                # if ANY line satisfied the allow pattern, so `cat key.pem` + a legit-looking
                # espsecure line right after it would have been let straight through.
                verdict="$(printf '%s' "$target" | python3 -c '
import re, sys
cmd = sys.stdin.read()
allow_re = re.compile(
    r"^(python3?\s+-m\s+)?espsecure(\.py)?\s+sign[_-]data\s+.*--keyfile\s+\S*ota_signing_key\.pem\s+.*$"
)
if "\n" in cmd or re.search(r"[;&|`<>]|\$\(", cmd):
    print("chained")
elif allow_re.match(cmd.strip()):
    print("allowed")
else:
    print("denied")
' 2>/dev/null)"
                case "$verdict" in
                    allowed) : ;;
                    chained)
                        deny "Blocked: this command touches the offline OTA signing key and chains/redirects other commands (or spans multiple lines) — refusing (docs/SECURITY.md). Run the espsecure.py sign_data/sign-data --keyfile invocation on its own, with no chaining, piping, redirection, or extra lines." ;;
                    *)
                        deny "Blocked: this command touches the offline OTA signing key. It must never be read, copied, or staged (docs/SECURITY.md) — pass it to espsecure.py by path only (espsecure.py sign_data --keyfile <path> ..., unchained, on its own line)." ;;
                esac ;;
            *git\ add*.pem*|*git\ add*.key*)
                deny "Blocked: refusing to 'git add' private key material (*.pem/*.key). .gitignore excludes these; do not force-stage them (docs/SECURITY.md)." ;;
        esac ;;
esac

exit 0
