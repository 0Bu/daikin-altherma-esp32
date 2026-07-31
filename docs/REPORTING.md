# Reporting a bug

Everything goes into one public GitHub issue: what you saw, plus a report the device writes about
itself. **The device removes your network name, addresses, broker and server names before you ever
see that report**, so there is nothing left in it that needs hiding — see
[What is removed](#what-is-removed-and-what-deliberately-is-not).

---

## The short way

1. Open your device's web page → **Settings** (the gear) → scroll to the bottom → **Report a bug**,
   in the small grey line under the last card, after the version number.
2. Type what happens, then **Prepare the report**. The device collects its status, readings and log
   and shows you the result — read it over, it is about to be posted in public.
3. **Copy & open GitHub**. That copies the report *and* opens the issue form in a new tab with your
   description and firmware version already filled in. **It submits nothing** — you still answer the
   remaining questions and press the button yourself.
4. In the form, paste the report into the **Device report** field, answer the rest, submit.

GitHub deliberately opens at step 3 rather than step 2, so that you arrive at the form with the
clipboard already holding what it asks you to paste.

### The .md file, and what it is for

**Download .md** saves exactly the same report as a file, `daikin-report-<version>.md`. You never
need both — use whichever suits you:

- **Pasting** is the normal way: the report goes into the **Device report** field as text.
- **The file** is for when copying does not work (the device serves its page over plain http, where
  browsers restrict clipboard access), or when you would rather keep a copy for yourself. In the
  form, **drag the file into the Device report box** — GitHub attaches it, and that counts just as
  much as pasted text.

If the clipboard fails and you have not downloaded the file, the report is still on screen: select
it and copy it by hand.

---

## If your firmware has no "Report a bug" button

Older builds do not have it. Open these four addresses in a browser, one at a time, and paste the
results into the **Device report** field under the headings shown. Replace
`daikin-altherma-esp32.local` with your device's address if that name does not resolve.

```
http://daikin-altherma-esp32.local/status?redact=1
http://daikin-altherma-esp32.local/values
http://daikin-altherma-esp32.local/ota/status
http://daikin-altherma-esp32.local/diag?verbose=1&redact=1
```

````markdown
# daikin-altherma-esp32 bug report

## Device report (/status)
```json
…paste…
```

## Readings (/values)
```json
…paste…
```

## Update status (/ota/status)
```json
…paste…
```

## Device log (/diag)
```text
…paste…
```
````

**`?redact=1` is what removes your personal details.** A build old enough to lack the button may
also lack that flag, in which case it is silently ignored and nothing is removed — so check the list
below and edit them out by hand before you post.

---

## What is removed, and what deliberately is not

The device replaces these eight values with `<redacted>` and **keeps the field itself**:

| Field | Why it goes |
|---|---|
| `wifi.ssid` | names your home network |
| `wifi.ip` | your internal address |
| `wifi.bssid` | your router's radio address — locatable in public databases |
| `wifi.mac` | identifies this specific board |
| `mqtt.broker` | may contain a username and password if you typed them into the URL |
| `syslog.host` | an internal hostname |
| `ntp.server` | often an internal hostname too |
| `modbus.host` | your saved HomeHub address, whether typed manually or filled by the explicit Search button |

The `/diag` log is scrubbed line by line for the same things.

Everything else stays, on purpose: the firmware version, the build fingerprint, signal strength,
whether MQTT is connected, the error counters, the detected model, heap and uptime. Those describe
the *firmware*, not you, and without them there is nothing to diagnose. The error strings in
`mqtt`/`syslog` are fixed messages the firmware chooses from, never anything you typed. The field is
emptied rather than deleted, because a missing field is indistinguishable from an older firmware
that never had it — and "which build produced this?" is the first question anyone looking at your
report has to answer.

`/values` are your heat pump's readings at one moment, and `/ota/status` carries no personal data
at all.

### The one exception: crash dumps

A **core dump** is not part of the report and must not be attached to a public issue. It is a copy
of the device's task memory, and a password of 15 characters or fewer is stored *inside* its string
object rather than elsewhere — so it can end up in a stack frame that the dump captures. No
field-level redaction can reach into that.

You are not asked for one up front: the device report already contains the crash reason, the task,
the program counter and the backtrace, which is usually enough. If a dump turns out to be needed,
you will be asked to send it through the [private advisory
form](https://github.com/0Bu/daikin-altherma-esp32/security/advisories/new) instead.

---

## What to include for each kind of problem

| If you picked… | Also include |
|---|---|
| A wrong or impossible reading | What the number **should** be and how you know. Then press **Re-detect** (Settings → ESP32), wait ten seconds, and collect the report — `/diag` then contains the raw bytes the number is decoded from, which is the only way to tell a wrong formula from a wrong position in the message. |
| The wrong model was detected | The model names from the sticker on **both** units, and a report collected after a re-detect. |
| No readings at all | How the two wires are connected to X10A. |
| Home Assistant / MQTT | The affected entity ids and what Home Assistant shows for them (`unavailable`, `unknown`, a duplicate device). |
| Crashes or restarts | Whether the web page showed a crash banner — but not the dump itself (see above). Collect the report **before** you press *Delete report* on that banner: deleting it erases the dump and the crash record on the device, and nothing can bring either back. |
| Anything that comes and goes | Syslog. See below. |

### About syslog

The device keeps only a small log in RAM. A fault that repeats every fraction of a second overwrites
it within a minute, and a restart empties it. So **without syslog, there is no history** — "when did
this start", "how often does it restart" and "was it ever healthy" cannot be answered at all, no
matter how good the rest of the report is.

If your problem is a restart, a dropout, or something intermittent, it is worth switching syslog on
(**Settings → Connections → Syslog**), waiting for the problem to happen again, and reporting then.
Paste the lines from about five minutes either side under **Anything else**. Each line starts with
the device's own uptime, `[  1234.567]` — **an uptime that jumps backwards is a restart**, which is
the only way a restart is visible at all.

Those lines come from **your** server, not from the device's redacted output, so nothing has been
removed from them for you — check them for your network name and your server addresses first.

---

## Supporting the project

This firmware is free to use and maintained in spare time. The **Sponsor** button at the top of the
repository takes contributions towards the project as a whole.

There is deliberately **no way to pay for a particular issue**, and none is planned — reports are
worked on by what is wrong and how well it is evidenced, not by who contributed. Sponsoring is
entirely optional and changes nothing about how your report is handled.

---

## Security problems

Anything exploitable goes to the [private advisory
form](https://github.com/0Bu/daikin-altherma-esp32/security/advisories/new), never a public issue.
See [SECURITY.md](SECURITY.md).

---

## The day this repository goes public

*Maintainer checklist.*

1. **Delete the test issues from development first.** A private repository's issues become public
   *retroactively* when it is switched over — every comment with them. A test report collected from
   a real board is exactly what must not be published, and the redaction is what makes the ones you
   miss survivable rather than harmless.
2. Switch the repository to public.
3. Enable **private vulnerability reporting** (Settings → Security) — it exists only on public
   repositories, and until it is on, the security link in the issue-template chooser leads nowhere.
4. Set up whichever funding accounts you want and uncomment them in
   [`.github/FUNDING.yml`](../.github/FUNDING.yml); the Sponsor button renders on public
   repositories only.
5. Walk one real report all the way through: button → issue → `/bug-triage`.
