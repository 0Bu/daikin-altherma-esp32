#!/usr/bin/env bash
# UserPromptSubmit hook: when the user reports a device crash / reboot / offline board, inject the
# triage entry point as CONTEXT — deterministically, from the harness, not from the model's judgement.
#
# Why a hook and not just the device-triage skill: a skill fires only if the model reads its
# description and decides it matches. That judgement demonstrably fails — a real "the host had a
# crash" report was hand-triaged from /status + /diag while 78k lines of the device's own syslog sat
# unread in VictoriaLogs, because /diag's RAM ring had already been overwritten by X10A timeout spam.
# The evidence that mattered (six boots in three minutes) was only visible in the log history. This
# hook removes the judgement step for the one fact that is easy to forget and expensive to miss.
#
# It is ADVISORY: it only adds context, never blocks (UserPromptSubmit exit 0 + stdout -> context).
# It fails OPEN on any parse error — a hook must never wedge the session.
#
# Scope: the prompt text only. Deliberately narrow keywords (a crash/offline/reboot report), so a
# normal coding prompt doesn't drag this in. Bilingual: the user reports in German, the repo is English.
set -u

payload="$(cat 2>/dev/null)"
[ -n "$payload" ] || exit 0

prompt="$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
sys.stdout.write((d.get("prompt") or "").lower())
' 2>/dev/null)"
[ -n "$prompt" ] || exit 0

# A device-trouble report. Keep this list tight: false positives cost context on every prompt.
# (German + English; "absturz/abgestürzt", "hängt", "nicht erreichbar" are how the reports actually read.)
printf '%s' "$prompt" | grep -qiE \
  'crash|absturz|abgestürzt|abgestuerzt|core ?dump|coredump|panic|watchdog|brownout|brown-out|boot ?loop|bootloop|reboot ?loop|neustart|rebootet|reset ?reason|kein netz|nicht erreichbar|unreachable|offline|hängt|haengt|wedge|ghost.?assoc' \
  || exit 0

cat <<'CTX'
<crash-triage-reminder>
The prompt looks like a report of a crashed / rebooting / unreachable daikin-altherma-esp32.
Before concluding anything, note these — each has already caused a wrong conclusion once:

1. Run the `device-triage` skill rather than hand-rolling curl calls. It encodes the rest of this.

2. READ THE LOG HISTORY, not just the device snapshot. `/status` and `/diag` describe only *now*:
   uptime is a single number (a reboot is invisible in it) and the `/diag` RAM ring is overwritten
   within a minute by a chatty failure mode. The device forwards every diag_printf() line to syslog,
   so the history is in VictoriaLogs — query it with the `victoria-logs` MCP
   (mcp__victoria-logs__query / streams / hits). Check /status.syslog first.

   Select by STREAM LABEL, not by word — a bare word search returns ~0 hits and reads as "no logs":
       daikin                               # WRONG: searches _msg text
       {hostname="daikin-altherma-esp32"}   # RIGHT: the device's syslog stream
       {hostname="esp32-daikin"}            # legacy hostname on older boards

   Reconstruct boots from the uptime prefix: every _msg starts with the device's own [ 1234.567 ]
   uptime, which resets on boot — an uptime that jumps BACKWARDS is a reboot, and that is the only
   way to see reboot history at all. `"mqtt: connected"` is one line per boot (~8 s uptime).
   Timestamps are UTC.

   Do NOT expect a `crash:` line: diag_crash_capture() runs before WiFi/syslog exist, so it never
   leaves the device. Its absence is NOT evidence of no crash.

3. Read `fault` before saying the word "crash". reason=usb + fault=false is a normal ESP32-S3 USB
   re-enumeration reset (someone plugged the cable in), not a crash. An orphan core dump left in
   flash also raises the banner on a boot that never crashed.

4. Verify claims instead of relaying them: if /status says coredump:true, fetch GET /coredump and
   check it isn't a 404. If /status lacks fields current firmware exposes (sys block, wifi.bssid),
   the board runs an OLDER build than main — the code you are reading is not the code that ran.
</crash-triage-reminder>
CTX
exit 0
