---
name: device-triage
description: Triage a live daikin-altherma-esp32 over the network — pull /status, /values and /diag, use an explicitly available durable syslog collector when configured, summarize WiFi/MQTT/X10A health, and if a crash is flagged, download /coredump and symbolize it against the matching-version .elf. Use for a misbehaving board, crash banner, reboot loop, or "why is it offline".
---

# device-triage

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

Read a running device's health over HTTP and, if it crashed, pull and symbolize the dump. This is
the live-device counterpart to `$flash-esp32`. The workflow is read-only unless the user explicitly
asks for `POST /diag/clear` or `POST /coredump/clear`; never clear either evidence source without
asking. No auth/TLS by design — trusted LAN only.

**Host:** default `daikin-altherma-esp32.local` (mDNS). If mDNS doesn't resolve, ask the user for
the IP and use it verbatim. Put the host in `H` for the commands below: `H=daikin-altherma-esp32.local`.

## Steps

1. **Snapshot health.** Pull the three read endpoints and keep the JSON:
   ```bash
   curl -sS --max-time 5 "http://$H/status" | tee /tmp/dt_status.json | jq .
   curl -sS --max-time 5 "http://$H/values" | jq '.[] | {label,value,unit}'
   curl -sS --max-time 5 "http://$H/diag?verbose=1"
   ```
   If `/status` times out, record that the live HTTP snapshot and coredump checks are unavailable,
   skip steps 2 and 4–5, but still continue to step 3. An accessible durable collector may contain
   the only evidence from before the device went offline.

2. **Summarize, don't dump.** From `/status` report, in a few lines:
   - **WiFi** — connected? RSSI, `wifi_reconnects` (heartbeat; climbing = flaky link / ghost-assoc).
   - **MQTT** — connected? `mqtt_count` / `mqtt_fails` / reconnects (heartbeat; fails climbing = broker/TLS/creds).
   - **X10A** — `hp.connected`, `hp.last_ok_s`, `hp.registers`/`hp.values`, `hp.crc_err`,
     `hp.timeout_err` (timeouts = wrong RX/TX pins or a silent bus; crc_err = noise/wrong proto).
   - **Model** — `detect.model` + `profile.id`; note if `detect.ambiguous`.
   - **Heap/uptime** — low heap or an uptime that keeps resetting hints at a reboot loop.
   - **Build** — `version` + `app_elf_sha256` (needed to fetch the matching .elf in step 4).

3. **History — use it when a durable collector is explicitly available.** `/status` and `/diag` only
   show **now**: uptime is one number and the bounded RAM ring can be overwritten within minutes by a
   chatty failure. The device offers each non-syslog `diag_printf()` line to a bounded, best-effort
   syslog queue (`syslog.cpp`). When the live snapshot succeeded, check `/status.syslog` first:
   `{configured:true, resolved:true}` means delivery is configured and currently resolved, not that
   every line arrived. A timed-out device cannot prove whether its last delivery attempt succeeded.

   Do not assume a particular log backend, MCP tool, stream-label schema, broker deployment or
   Kubernetes environment. If the current environment provides an explicitly configured and
   accessible external syslog collector, discover the device identity and query that collector using
   its own supported interface. If none is accessible, state that events preceding the current RAM
   ring cannot be reconstructed; do not turn missing history into evidence that no reboot occurred.

   **Reconstruct boots from replay plus uptime.** Query the intended one-per-boot `boot:` replay and
   ordinary diagnostic lines carrying the device uptime prefix `[  1234.567]`. A backwards jump
   starts a new boot epoch. `_time − [embedded uptime]` estimates that epoch's boot instant; compare
   it with the snapshot time minus `/status.uptime_s` for the current boot. Deduplicate replay with
   uptime epochs: a partial replay can be resent after resolver recovery, while MQTT connection lines
   are reconnect-capable supporting evidence rather than one-per-boot markers. A cluster of
   low-uptime epochs is a reboot burst; a later stable epoch means the device recovered.

   **Keep absence bounded.** `diag_crash_capture()` runs before WiFi and the syslog task exist, so the
   live line first reaches only RAM. Once collector DNS resolves, `syslog.cpp` sends one `boot:` record
   and up to three `crash:` records directly. Replayed crash records have no uptime prefix and their
   timestamp dates replay, not the previous crash. Allocation, send and DNS failures can skip them,
   so an absent replay never proves that no crash happened; cross-check `/status.last_crash` and the
   reconstructed uptime epochs.

4. **Crash?** If the live snapshot succeeded and `/status.last_crash` is non-null, it already carries a partial picture from the
   boot-time cache — report it first, no download needed:
   ```bash
   jq '.last_crash | {reason,fault,task,pc,backtrace,corrupted,elf_sha256}' /tmp/dt_status.json
   ```
   **Read `fault` before you say the word "crash".** `fault:true` = a real fault (panic/watchdog).
   `fault:false` means **this boot did not crash** — `reason:"usb"` is just an ESP32-S3 USB
   re-enumeration reset (plugging the cable in), `poweron`/`sw` are normal too. `last_crash` is also
   populated for a *non-fault* boot when an orphan dump from an **earlier** crash is still in flash,
   so a banner alone never proves this boot crashed.

   **Consistency check.** `coredump:true` claims a dump is downloadable — verify rather than relay it:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "http://$H/coredump"   # 200 = real, 404 = no dump
   ```
   A `coredump:true` + `404` disagreement means the flag is stale (fixed on current main by re-reading
   it live; older firmware can cache it at boot and fail to invalidate it after the image is erased).
   Report the disagreement — don't trust either side alone.

   If `coredump:true` **and** the 404 check says 200, a full dump is waiting — continue to step 5. If
   there's no dump, the reason + backtrace above is all there is.

5. **Symbolize the dump** (needs Docker for `decode-coredump.sh`; a cloud/no-Docker session can
   download the dump but not decode it — hand it off or note that). Paths must be **inside the
   repo** (the decoder mounts the repo into the container):
   ```bash
   curl -sS --max-time 20 "http://$H/coredump" -o coredump.bin   # repo root; 404 if none
   ```
   The dump is useless without the **matching-version** unstripped `.elf` — CI archives one per
   build (`dist/*.elf.xz`, keyed by `app_elf_sha256` from step 2). Fetch that build's ELF into
   `build/` through an explicitly authorized maintainer handoff (the credential wrapper refuses
   local artifact downloads),
   then — the decoder unwraps the `.xz` itself, so either name works:
   ```bash
   scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf.xz
   ```
   If the download 404s, check the age/state: a dev build's artifact is kept 3 days; a PR's is
   deleted when it merges or after at most 7 days (a release's ELF is a Release asset and never
   expires). Past that the dump is not decodable —
   say so plainly rather than symbolizing against a near-miss build, which `esp-coredump` would
   warn about and which yields confidently wrong frames.
   `esp-coredump` warns on an ELF/dump `app_elf_sha256` mismatch — if it does, you grabbed the wrong
   build; refetch the one matching step 2. Summarize the crashed task + symbolized backtrace and
   point at the likely frame.

6. **Report.** Lead with the verdict, and make it answer *did it actually crash?* — a fault, a clean
   boot with a stale/orphan dump, a reboot burst (step 3), or healthy. Then the supporting numbers.
   Say plainly which claims are device-reported vs. verified, and flag any `/status` ↔ `/coredump`
   disagreement. Suggest the next action (e.g. re-run detection via `POST /detect`, check broker
   creds, re-seat the X10A wiring) — do **not** take side-effecting actions or clear the coredump
   without asking.

   Also sanity-check the device's build against the tree: `/status.version` + `app_elf_sha256`, and
   whether fields the current firmware should expose are missing (e.g. no `sys` block, no
   `wifi.bssid`) — that means the board is on an **older** build than `main`, so code you are reading
   may not be the code that ran. Say so rather than reasoning from the wrong source.

## Notes
- **Live board → this skill. A GitHub issue → `$bug-triage`.** An external user's report is a frozen
  snapshot from a device you cannot reach, so step 3's external-history reconstruction and step 4's
  `/coredump` 200-vs-404 check have no counterpart there and must not be imitated from report values.
- The device has no live push; the web UI polls `/status` + `/values`, and this skill takes the same one-shot HTTP snapshot,
  which is the right tool for triage. For a live watch, open the web UI.
- `POST /diag/clear` clears the in-memory diagnostic ring. This triage flow does not need it; use it
  only after the user explicitly asks to discard those logs.
- `POST /coredump/clear` erases only the dump partition — only after the user has the decoded
  backtrace and explicitly asks to clear it. `POST /crash/dismiss` is different: it also dismisses
  the crash record.
- Nothing here needs the signing key or Docker **except** step 5's symbolization.
- **The device snapshot and durable log history answer different questions.** `/status` + `/diag`
  describe *now*; an available external collector may show earlier reboots and failure onset. If no
  collector is accessible, report that boundary instead of reasoning beyond the RAM ring.
