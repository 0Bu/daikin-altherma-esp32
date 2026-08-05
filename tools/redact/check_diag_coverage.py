#!/usr/bin/env python3
"""Does the bug report still scrub everything it claims to?

TWO checks, one per half of the redaction surface, because the two halves fail differently.

(A) `/status` leaks by FIELD, and the header states how many it scrubs. That number is a CLAIM about
another file, so it drifts the moment a field is added — silently, since nothing consumed it: it was
`10` while the builder passed TWELVE fields through the redactor, the header's own comment listed a
set missing `reference_temperature.name`/`.topic`, and this file's comment said `eight`. Three
numbers, three places, no reader able to tell which was true. So the count is now DERIVED from the
call sites and compared against the declaration; a new redacted field moves the number or fails.
What it deliberately does NOT check is the direction that needs a human: whether a field that
SHOULD be redacted is missing entirely. A field nobody wrapped is a field this count never sees.

(B) `/diag` leaks by LINE, and the guard there is an allowlist:

WHY (B) EXISTS. `GET /diag?redact=1` is the ONLY thing standing between a user's log and a public
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
STATUS = ROOT / "main" / "http_status.cpp"
LEDGER = Path(__file__).with_name("audit_exceptions.txt")

# Identifiers whose VALUE originates with the user or identifies this specific installation. This
# has to be kept a SUPERSET of the /status fields check (A) counts: a field redacted in the JSON and
# printed in the log two sections below it is the exact incoherence a redaction rule exists to
# prevent, and it is check (B), not (A), that would have to see it. It had fallen behind by four —
# the room source's name and topic and the weather coordinates were redacted in /status with nothing
# here matching them — so a diag line naming the reporter's living room or house location was
# invisible. Widen this list in the same commit that redacts a new field.
#
# What it still cannot see, stated rather than implied: a value reaching diag_printf under a name
# that says nothing about what it holds. `found` and `\w*backup\w*` below are two such shapes that
# already bit; http_config.cpp's `in.topic` is a third, uncaught today because it only chooses
# between two fixed strings and adding a token for it would buy one adjudicated false positive
# rather than coverage. `board_id`/`s_board` are kept though #340 deleted the one line they matched:
# board identity is still a leakable value and the next line to print it should not have to
# rediscover that.
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
    # into a local, but a value DISCOVERED at runtime that becomes one. hp_modbus.cpp's bounded mDNS
    # search writes the HomeHub's resolved IPv4 into a local called `found` and logs it
    # with no rule, while /status was redacting the very same string as modbus.host three sections
    # above. The heuristic could not see it because the name says nothing about what it holds — which
    # is the whole reason this list exists rather than a scan for the /status field names alone. Any
    # local that RECEIVES a discovered identity belongs here under whatever bland word it was given.
    r"found|discovered|hostname|"
    # The four /status fields this list was missing: the room source the user named and pointed at a
    # topic through their own broker, and the coordinates of their house. Written as the CONFIG field
    # names because that is how a log line would reach them (c.ref_temp_topic.c_str()); measured, they
    # add no finding today, so the gap they closed was latent rather than live.
    r"ref_temp_\w+|weather_latitude\w*|weather_longitude\w*"
    r")\b"
)

# A diag_printf call, format string plus arguments, across line breaks and adjacent string literals.
CALL = re.compile(r"diag_printf\s*\(\s*((?:\"(?:[^\"\\]|\\.)*\"\s*)+)((?:,[^;]*?)?)\)\s*;", re.S)


def markers():
    """The literal prefixes DIAG_REDACTIONS anchors on."""
    text = HEADER.read_text()
    block = text.split("DIAG_REDACTIONS[]", 1)[1].split("};", 1)[0]
    return [m.group(1) for m in re.finditer(r'\{\s*"((?:[^"\\]|\\.)*)"\s*,', block)]


def declared_status_fields():
    """The count redact.hpp CLAIMS it scrubs out of /status."""
    m = re.search(r"REDACTED_STATUS_FIELDS\s*=\s*(\d+)", HEADER.read_text())
    if not m:
        print("redaction: REDACTED_STATUS_FIELDS is gone from redact.hpp — refusing to check")
        sys.exit(2)
    return int(m.group(1))


def status_redaction_sites():
    """Every /status value actually passed through the redactor, counted where it is WRITTEN.

    Counting call sites rather than trusting the constant is the whole point: the substitution
    happens field by field as the JSON is built (a pass over the finished string is what the httpd
    stack budget has no room for), so the call sites ARE the set. Both spellings count — jstr_r()
    is today's wrapper, redact_or() the primitive underneath it — so a field wrapped directly is
    still seen. The helper's own definition is not a field.
    """
    out = []
    for n, line in enumerate(STATUS.read_text().splitlines(), 1):
        if re.search(r"std::string\s+jstr_r\s*\(", line):
            continue
        out += [n for _ in re.finditer(r"\b(?:jstr_r|redact_or)\s*\(", line)]
    return out


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

    # (A) /status — the declared field count against the call sites that produce it.
    declared, sites = declared_status_fields(), status_redaction_sites()
    print(f"redaction: /status redacts {len(sites)} field(s), redact.hpp declares {declared}")
    if len(sites) != declared:
        where = ", ".join(f"{STATUS.relative_to(ROOT)}:{n}" for n in sites)
        print("\nMISCOUNTED — redact.hpp's REDACTED_STATUS_FIELDS no longer describes the builder:\n")
        print(f"  declared {declared}, found {len(sites)} at {where}")
        print("    fix: set REDACTED_STATUS_FIELDS in main/logic/redact.hpp to the real count AND")
        print("         name the new field in the comment beside it. If a field was ADDED to")
        print("         /status without being wrapped, wrap it instead — this check counts what")
        print("         is redacted, and cannot see a value nobody passed through redact_or().\n")
        return 1

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
