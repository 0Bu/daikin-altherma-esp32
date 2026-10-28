# Reporting a bug

Report ordinary problems through a GitHub issue with what you observed and a device-generated
report. For exploitable security problems use the
[private advisory form](https://github.com/0Bu/daikin-altherma-esp32/security/advisories/new).

## The short way

1. Open the device's **Settings** and select **Report a bug** in the footer below the cards.
2. Describe the problem and select **Prepare the report**. Review the collected status, readings
   and log before sharing them publicly.
3. Select **Copy & open GitHub**, paste into **Device report**, answer the remaining questions and
   submit. Opening the form submits nothing automatically.

**Download .md** saves the same report as `daikin-report-<version>.md`. Use it if clipboard access is
blocked on the plain-HTTP page, or keep a private copy. You can drag that file into the issue's
Device report field instead of pasting; you do not need both. The on-screen report can also be
selected and copied manually.

## If your firmware has no “Report a bug” button

Open these four URLs and include their responses under the corresponding headings. Replace the
hostname with the device's current IP if needed.

| Report heading | URL |
|---|---|
| Device report (`/status`) | `http://daikin-altherma-esp32.local/status?redact=1` |
| Readings (`/values`) | `http://daikin-altherma-esp32.local/values` |
| Update status (`/ota/status`) | `http://daikin-altherma-esp32.local/ota/status?redact=1` |
| Device log (`/diag`) | `http://daikin-altherma-esp32.local/diag?verbose=1&redact=1` |

Very old firmware can silently ignore `redact=1`. Inspect its output and remove identifiers manually
using the [redaction list](SECURITY.md#report-redaction-contract) before posting.

<a id="what-is-removed-and-what-deliberately-is-not"></a>
## Privacy and crash evidence

The report protects known network/location identifiers and user-entered service/source names, topics
and paths. The complete **status redaction contract** has one home in
[SECURITY.md](SECURITY.md#report-redaction-contract). Unset fields remain unset/empty rather than
inventing a configured service. Room-source HVAC mode keeps only the fixed public vocabulary
`off`, `heat`, `cool`, `heat_cool`, `auto`, `dry`, `fan_only`; other source text is redacted.

`/ota/status?redact=1` additionally hides set `effective_manifest_url` and
`effective_firmware_base_url`; empty URLs stay empty. Operational `/ota/status` keeps them and can
reveal a private feed origin/path, including a temporary test override. Use the redacted form for
public reports. Oversized redaction queries/flags are refused instead of returning operational data.

`/diag` scrubs identifiers line by line. WiFi, clock-server, log-server and OTA-download identifiers
are escaped when logged so quotes, line breaks or non-ASCII bytes cannot escape redaction spans.
Incomplete oldest records after wrap/short reads are dropped; **`[... truncated ...]`** marks missing
or clipped records. Intact raw X10A records and error details remain. The crash banner's
**Copy diagnostics** uses the redacted log. **Could not be read from the device** means missing
evidence, not an empty log or proof that nothing happened.

Version/build fingerprint, model, readings, uptime, memory and error counters remain so the issue
can be diagnosed. Automatic redaction does not sanitize your description, screenshots or logs
copied from an external server; review those separately.

<a id="the-one-exception-crash-dumps"></a>
A **coredump contains raw task memory and can include credentials**. It is excluded from the report
and must never be attached to a public issue. The report provides current reset/fault information
and, when available, stored task, program counter and backtrace. The task is quoted on one line so
damaged text cannot insert a report record. If raw memory is needed, arrange private handling
through the advisory channel and retain the **exact matching unstripped ELF** for decoding.

Reset reason describes the latest boot. A stored dump's task/backtrace can describe an **older
incident, even on the same build**; downloadability does not establish its age or incident identity.
Missing or undecodable evidence proves no absence of fault. Keep a private original until its
meaning is understood; do not delete it just because decoding failed.

Collect the report before selecting **Delete report** in a crash banner. That action erases the dump
and dismisses the crash record permanently. Current uptime and the RAM log cannot establish that
no earlier restart occurred.

## What to include for each kind of problem

| Problem | Add this evidence |
|---|---|
| Wrong/impossible reading | Collect while visible: full label/value, expected value, time/operating state and the independent reference. A maintainer may request a fresh detection trace if available frames do not cover that register. |
| Wrong/ambiguous model | Indoor and outdoor model labels, plus the detected model/candidates in the report. |
| No readings | Board, actual RX/TX GPIOs, X10A pin connections and common-ground arrangement. |
| Home Assistant/MQTT | Affected entity ids, base topic identity and whether HA shows unknown, unavailable or duplicates; redact private identifiers as needed. |
| Crash/restart | Approximate time, banner/reset reason, pending fault status and report collected before dismissal. |
| Intermittent fault | Durable external logs spanning the event, if available. |

Model identity is established at boot. A deliberate API re-detection starts a new X10A diagnosis
window, so preserve current evidence first. If raw register evidence is needed, **Settings →
Protocol → Protocol diagnostics** offers queries while X10A is connected. Their unfiltered decodes
are not confirmed measurements; see [API.md](API.md).

### About syslog

The small RAM log wraps and is cleared by a restart. For recurring dropouts/restarts, configure an
accessible collector under **Settings → Connections → Syslog**, let the event recur and include
roughly five minutes on either side. Current status/boot records explain the latest boot; longer
timelines depend on **UDP delivery and collector retention**. Ordinary lines have an uptime prefix;
a backward jump supports a restart after checking board identity. Separate boot replay records carry
build/reset facts without that prefix. Missing records do not prove that no restart occurred.

External syslog is not automatically redacted by the report workflow. Remove network/service
identifiers before publication. Saved trends and diagnosis records can supply separate historical
observations; they do not replace boot/event logs.
