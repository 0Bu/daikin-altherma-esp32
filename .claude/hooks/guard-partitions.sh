#!/usr/bin/env bash
# PreToolUse guard: ask for confirmation before editing partitions.csv. The nvs partition at
# 0x9000 must keep a STABLE offset and size across versions (CLAUDE.md, "NVS namespaces") — OTA
# leaves nvs untouched only as long as its offset/size don't move. Shift them and the next OTA
# silently wipes every user's config (WiFi/MQTT creds + the X10A pin/proto link cache). This is
# NOT a hard block; it routes the edit to the user's confirmation prompt so the change is a
# deliberate one. Reads the tool payload as JSON on stdin (matcher: Edit|Write). Fails open.
set -u

payload="$(cat)"
file="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
print((d.get("tool_input", {}) or {}).get("file_path", ""))
' 2>/dev/null)"
[ -n "$file" ] || exit 0

case "$file" in
    */partitions.csv|partitions.csv)
        reason="partitions.csv edit: keep the nvs partition (0x9000) offset AND size STABLE across versions or the next OTA silently wipes every device's config — WiFi/MQTT creds and the X10A link cache (CLAUDE.md). Confirm this change leaves nvs@0x9000 unchanged."
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":%s}}\n' \
            "$(printf '%s' "$reason" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"partitions.csv: keep nvs@0x9000 offset/size stable across versions"')"
        ;;
esac

exit 0
