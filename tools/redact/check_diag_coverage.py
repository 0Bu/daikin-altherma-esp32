#!/usr/bin/env python3
"""Does every diag line that prints an identifying value have a redaction rule?

WHY THIS EXISTS. `GET /diag?redact=1` is the ONLY thing standing between a user's log and a public
bug report (docs/REPORTING.md — the whole report is posted to a public issue precisely because the
device scrubs it first). That scrubbing is an ALLOWLIST: `logic/redact.hpp` names specific log
statements. A new `diag_printf` that interpolates a hostname or an SSID is simply not covered, and
the only symptom is a correct-looking log line with a real value in it — nobody sees a leak that
takes the form of a working feature. This check is the guard against the list silently falling
behind the code it describes.

WHAT IT ACTUALLY CHECKS, and what it does not. It is not "every %s must be redacted" — 57 of those
substitute `esp_err_to_name()` or a fixed string, and a ledger with 50 adjudicated entries is a
ledger nobody reads. It flags the narrower, real shape: a diag line whose ARGUMENTS mention a value
that came from the config or from the board's identity. That is a heuristic on identifier names, so
it catches the failure that has actually occurred rather than proving a negative — an obfuscated
leak (a config value copied into a blandly-named local first) walks past it. Say so out loud rather
than letting the green tick imply more than it means.

Found on its first run: `mqtt: retired legacy HA device %s`, printing `daikin_<low 3 MAC bytes>`
while /status was redacting `wifi.mac` two sections above it.

Usage: tools/redact/check_diag_coverage.py [--list]
Exit 0 = every flagged line is covered by a rule or adjudicated; 1 = something needs a decision.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HEADER = ROOT / "main" / "logic" / "redact.hpp"
LEDGER = Path(__file__).with_name("audit_exceptions.txt")

# Identifiers whose VALUE originates with the user or identifies this specific installation. Keep in
# step with the eight /status fields redact.hpp lists; anything here reaching a log line needs a rule.
SENSITIVE = re.compile(
    r"\b("
    r"wifi_ssid|wifi_pass|ssid|"
    r"syslog_host|mqtt_uri|mqtt_user|mqtt_pass|broker|"
    r"ntp_server|s_server|last_host|"
    r"ip_str|board_id|s_board|"
    r"mb_host|mb_dhost|s_host|"
    # A config value copied into a blandly-named local still leaks. `stale_backup` (wifi.cpp) is the
    # worked example and the reason this list is not just the /status field names.
    r"\w*backup\w*|"
    # …and `found` is the second worked example, from the other direction: not a config value copied
    # into a local, but a value DISCOVERED at runtime that becomes one. hp_modbus.cpp's one-shot mDNS
    # search writes the HomeHub's serial-derived hostname into a local called `found` and logged it
    # with no rule, while /status was redacting the very same string as modbus.host three sections
    # above. The heuristic could not see it because the name says nothing about what it holds — which
    # is the whole reason this list exists rather than a scan for the /status field names alone. Any
    # local that RECEIVES a discovered identity belongs here under whatever bland word it was given.
    r"found|discovered|hostname"
    r")\b"
)

# A diag_printf call, format string plus arguments, across line breaks and adjacent string literals.
CALL = re.compile(r"diag_printf\s*\(\s*((?:\"(?:[^\"\\]|\\.)*\"\s*)+)((?:,[^;]*?)?)\)\s*;", re.S)


def markers():
    """The literal prefixes DIAG_REDACTIONS anchors on."""
    text = HEADER.read_text()
    block = text.split("DIAG_REDACTIONS[]", 1)[1].split("};", 1)[0]
    return [m.group(1) for m in re.finditer(r'\{\s*"((?:[^"\\]|\\.)*)"\s*,', block)]


def adjudicated():
    if not LEDGER.exists():
        return set()
    out = set()
    for line in LEDGER.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.add(line)
    return out


def main():
    rules = markers()
    skip = adjudicated()
    findings, checked = [], 0

    for src in sorted((ROOT / "main").glob("*.cpp")):
        text = src.read_text()
        for m in CALL.finditer(text):
            fmt_literals, args = m.group(1), m.group(2)
            if not SENSITIVE.search(args):
                continue
            checked += 1
            # Rebuild the format string from its adjacent literals, then unescape enough to compare.
            fmt = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', fmt_literals))
            fmt = fmt.replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
            line_no = text.count("\n", 0, m.start()) + 1
            ident = f"{src.relative_to(ROOT)}:{fmt.splitlines()[0].strip()}"
            if any(r and r in fmt for r in rules):
                continue
            if ident in skip:
                continue
            findings.append((f"{src.relative_to(ROOT)}:{line_no}", fmt.strip(), ident))

    if "--list" in sys.argv:
        print(f"{len(rules)} redaction rules in {HEADER.relative_to(ROOT)}:")
        for r in rules:
            print(f"  {r!r}")

    print(f"redaction: {checked} diag line(s) print a config/identity value, "
          f"{len(rules)} rule(s), {len(skip)} adjudicated")
    if not findings:
        print("redaction: clean — every such line is covered by a rule or adjudicated.")
        return 0

    print("\nUNCOVERED — these print an identifying value into /diag with no redaction rule:\n")
    for where, fmt, ident in findings:
        print(f"  {where}\n    {fmt.splitlines()[0]}")
        print("    fix: add a {marker, end} pair to DIAG_REDACTIONS in main/logic/redact.hpp,")
        print("         with a CHECK in test/test_logic.cpp — or, if the value is genuinely not")
        print("         identifying, add this line to tools/redact/audit_exceptions.txt:")
        print(f"         {ident}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
