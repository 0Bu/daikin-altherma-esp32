---
name: bug-triage
description: Triage a bug report filed by an external user — read the GitHub issue and the device report pasted into it, verify which firmware build it came from, route by symptom, name the missing evidence in one comment, and reproduce a wrong value against the real converters on the host. Use when handling an incoming issue number; for a board you can actually reach over the network, use device-triage instead.
model: sonnet
---

# bug-triage

Triage `<issue number>` — a report from someone whose device you cannot reach.

**This is not device-triage with a different input.** That skill's central technique — reconstructing
restart history from the syslog stream in VictoriaLogs, because the uptime prefix jumps backwards —
does not exist here: an external user's device forwards syslog to *their* collector, if any. Its
`/coredump` 200-vs-404 consistency check does not exist either. Every "verify rather than relay" step
it makes assumes a live board. Here the report is **frozen**, and the substitutes are provenance
(step 2) and host reproduction (step 6).

The whole report is in the issue (`docs/REPORTING.md`): the story in the form's fields, and
`/status`, `/values`, `/ota/status` and `/diag` pasted into its **Device report** field. The device
redacts the identifying values before the user ever sees them, which is why none of it needed a
private channel. **A core dump is the one thing that never appears there** — it is raw stack memory
and can hold a short password inline in a `std::string` — so it is requested privately, and only
when the backtrace in `last_crash` is genuinely not enough (step 5).

## Steps

1. **Read the issue.**
   ```bash
   gh issue view "$N" --json number,title,body,labels,createdAt
   ```
   Pull the `Device report` section out of the body with the extraction below. If it is absent, or
   the user answered that the device was unreachable, **say so and stop before diagnosing**. A report
   without device data is a description, and working from one produces a guess wearing the clothes
   of a diagnosis — say what is missing and why it is needed instead.

2. **Provenance before anything else.** Take `version` and `app_elf_sha256` from `/status` and
   establish *which build this is*: does `git tag` / `version.txt` still contain it, is it a
   `-dev.N` build, how far behind `main`? Then read everything downstream **against the code of that
   build, not against `main`** — you cannot re-read the device to resolve an ambiguity, so a claim
   about code the reporter is not running is simply wrong.

   Check for **missing top-level blocks** (`sys`, `ntp`, `board`, `history`, `ota`) — their absence
   means an older build, not a device that had nothing to say.

3. **Route by symptom, and name every gap in ONE comment.** The `What kind of problem is it?`
   dropdown decides what the report needed:

   | Symptom | Needs |
   |---|---|
   | Wrong / impossible / missing reading | `/values`, the nameplate model, and the `/diag` hex lines from a detect pass (`logic/hexdump.hpp`) |
   | Wrong model detected | `detect.*` (`candidates`, `families`, `ambiguous`, both capacities), the nameplate, `/diag` after a re-detect |
   | No readings at all | `hp.rx`/`tx`/`timeout_err`/`crc_err`, the board, `/diag` |
   | Home Assistant / MQTT | entity ids, `mqtt.*`, the retained `state` / `heartbeat` payloads |
   | WiFi / portal | `wifi.*` including `rolled_back`, `/diag` |
   | OTA | `ota.channel`, `/ota/status`, both versions |
   | Crash / restart | `last_crash.*`, `sys.reset_reason`, `sys.safe_mode`, and whether syslog exists |

   Ask for what is missing **once**, in a single comment — a round trip per gap is how a report dies.

4. **Read `last_crash.fault` before you use the word "crash."** `fault:true` is a real fault.
   `fault:false` means *this boot did not crash* — `reason:"usb"` is a cable being plugged in,
   `poweron`/`sw` are normal. `last_crash` is also populated on a non-fault boot when an orphan dump
   from an earlier crash is still in flash, so its presence never proves this boot crashed.

5. **Ask for the dump only when the summary is not enough, and only privately.** The report omits it
   on purpose — it is raw task-stack memory that can carry a short password (`docs/SECURITY.md`), and
   `last_crash` already gives reason, task, PC, backtrace and `elf_sha256`. When the backtrace is
   genuinely insufficient, ask the reporter to send `/coredump` through the **private advisory form**,
   **zipped** (GitHub rejects `.bin` as an attachment outright). Never ask for it in the public issue
   and never accept it there. Then symbolize offline: `gh run download` the build matching
   `app_elf_sha256`, and `scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf.xz`
   (CI archives the ELF xz-wrapped; the decoder unwraps it). A mismatch warning from `esp-coredump`
   means you fetched the wrong build. A dev-build artifact older than 3 days is gone; a PR artifact
   is gone as soon as the PR merges or after at most 7 days — report that the dump cannot be decoded
   instead of using a nearby build.

6. **Reproduce on the host — this is what replaces live access.** For a wrong-value report, take the
   hex witness out of the private report and run it through the *real* converters rather than
   reasoning about them:
   ```bash
   scripts/run-mock-tests.sh
   scripts/run-domain-audit.sh          # real converters x real catalog vs docs/REGISTERS.md §5
   ```
   Produce the **decode witness** `CONTRIBUTING.md` § "Value correctness" demands of a PR: the wire
   bytes, what they should read, what they do read. That converts a user's screenshot into evidence,
   and it is the highest-value thing this skill does.

7. **Label and comment.** Apply the class label with `gh issue edit` (not a workflow — a labeler
   Action is an always-on job, and `.claude/CLAUDE.md` explains why every Actions job is billed
   rounded up to a whole minute):

   `value-correctness` · `detection` · `x10a` · `home-assistant` · `mqtt` · `wifi` · `ota` ·
   `reliability` · `web-ui`. Plus `regression` when *Did it ever work?* says a firmware update broke
   it (then diff the two versions), and `unreproducible-locally` when the class's required evidence
   is absent — that label is the honest measure of whether the form is doing its job. Remove
   `needs-triage` when you are done.

   In the comment, separate **what the reporter states** from **what you reproduced locally**.

## Refuse

- **No restart history without syslog.** If `Do you forward the device's log…` says "not configured",
  say that the restart history is unknowable from this report rather than inferring it from
  `uptime_s`, which is a single number and cannot show a reboot.
- **Nothing side-effecting on someone else's device** — no `POST /detect`, no `?clear=1`, no
  suggestion to erase anything, unless the reporter asks and understands the cost.
- **Never a core dump in the public issue**, in either direction: don't ask for one there, and if a
  reporter attaches one anyway, say so and ask them to delete it.
- **Check the report was actually redacted before quoting from it.** A user on an older build may
  have collected it by hand without `?redact=1`. If `wifi.ssid` is a real name rather than
  `<redacted>`, point that out in the comment and ask them to edit the issue — do not repeat the
  value while doing so.

## Parsing contract

GitHub renders each issue-form answer under `### <label>`; the field `id` never reaches the body, so
**the label text is the key**. Inside the `Device report` answer the sections are `## ` headings.

```bash
gh issue view "$N" --json body -q .body > /tmp/issue.md
sec() { awk -v h="### $1" '$0==h{f=1;next} /^### /{f=0} f' /tmp/issue.md; }
sec "What kind of problem is it?"
sec "Device report" > /tmp/report.md
awk -v h="## Device report (/status)" '$0==h{f=1;next} /^## /{f=0} f' /tmp/report.md \
  | sed -n '/^```/,/^```/p' | sed '1d;$d' | jq .
```

1. Renaming a form label is a breaking change — bump `form-vN` in the template's `labels:`. That
   label is the only place a schema version can live (`type: markdown` blocks never appear in the
   body).
2. `_No response_` means the field was left empty.
3. `/status`: take the first fenced block in the section, else the whole section, then `jq -e .`.
4. **If `/status` does not parse, stop** and ask for a clean re-paste. Reasoning from half a JSON
   blob is the failure this whole flow was built to prevent.
5. **Three states, never conflated:** `"<redacted>"` = the device scrubbed it (`logic/redact.hpp`) ·
   `null` = the device reported nothing (e.g. `bssid` while offline) · **key absent** = an older
   build. Only the third one says anything about the firmware.
6. `Firmware version` is an index; `/status.version` is the authority. If they disagree, report the
   disagreement — it usually means a stale copy-paste, which makes everything else suspect too.
7. Tolerate a leading shell-echo line and a UTF-8 BOM before the JSON.
