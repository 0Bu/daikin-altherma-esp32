---
name: device-triage
description: Triage a live daikin-altherma-esp32 over the network — pull /status, /values and /diag, reconstruct the boot/reboot history from the device's syslog in VictoriaLogs (the MCP), summarize WiFi/MQTT/X10A health, and if a crash is flagged, download /coredump and symbolize it against the matching-version .elf. Use to investigate a misbehaving board, a crash banner, a reboot loop, or "why is it offline".
model: sonnet
---

# device-triage

Read a running device's health over HTTP and, if it crashed, pull and symbolize the dump. This is
the live-device counterpart to `flash-esp32`. The workflow is read-only unless the user explicitly
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
   If `/status` times out, the box is unreachable (WiFi drop, wrong host, reboot loop) — say so and
   stop here; there's nothing more to read.

2. **Summarize, don't dump.** From `/status` report, in a few lines:
   - **WiFi** — connected? RSSI, `wifi_reconnects` (heartbeat; climbing = flaky link / ghost-assoc).
   - **MQTT** — connected? `mqtt_count` / `mqtt_fails` / reconnects (heartbeat; fails climbing = broker/TLS/creds).
   - **X10A** — `hp.connected`, `hp.last_ok_s`, `hp.registers`/`hp.values`, `hp.crc_err`,
     `hp.timeout_err` (timeouts = wrong RX/TX pins or a silent bus; crc_err = noise/wrong proto).
   - **Model** — `detect.model` + `profile.id`; note if `detect.ambiguous`.
   - **Heap/uptime** — low heap or an uptime that keeps resetting hints at a reboot loop.
   - **Build** — `version` + `app_elf_sha256` (needed to fetch the matching .elf in step 4).

3. **History — always, before concluding anything.** `/status` and `/diag` only show **now**: uptime
   is a single number (you cannot see a reboot from it) and the `/diag` ring is a few hundred lines of
   RAM that a chatty failure mode (e.g. `HP timeout` every ~0.3 s) overwrites within a minute. The
   device forwards **every** `diag_printf()` line to syslog (`syslog.cpp`), so the real history lives
   in **VictoriaLogs** — use the `victoria-logs` MCP (`mcp__victoria-logs__query` / `streams` / `hits`).
   Check `/status.syslog` first: `{configured:true, resolved:true}` means the device is shipping logs.

   **Select by stream label, not by word.** The device name is a *stream label*; a bare word query
   searches `_msg` and silently returns almost nothing — this is the easy mistake:
   ```
   daikin                                  # ✗ ~0 hits — searches the message text
   {hostname="daikin-altherma-esp32"}      # ✓ the device's syslog stream
   {hostname="esp32-daikin"}               # legacy hostname — older boards/firmware
   ```
   Confirm the stream exists and its volume with `mcp__victoria-logs__streams` (query `*`) before
   concluding "no logs". Timestamps (`_time`) are **UTC**; the user's wall clock may not be.

   **Reconstruct boots from the uptime stamp — the key technique.** Every `_msg` is prefixed with the
   device's own uptime, `[  1234.567]`. It resets to ~0 on every boot, so *an uptime that jumps
   backwards is a reboot* — the only way to see reboot history at all. `mqtt: connected` is the
   cleanest per-boot marker (one per boot, at ~8–9 s uptime):
   ```
   {hostname="daikin-altherma-esp32"} "mqtt: connected"          # 1 line per boot
   {hostname="daikin-altherma-esp32"} NOT "HP timeout" NOT "detect:"   # drop the poll spam
   ```
   Several `mqtt: connected` at ~8 s uptime, tens of seconds apart = a **reboot burst / boot loop**.
   Cross-check `uptime_s` from step 2: `_time − uptime_s` = the boot instant; if that lands far after
   the last burst, the device recovered and has been stable since. Correlate broker-side with
   `{kubernetes.container_name="mosquitto"}`.

   **Known gap — do not expect the crash line here.** `diag_crash_capture()` runs at `main.cpp:45`,
   before WiFi and the syslog task exist, so its `crash: reset=… coredump=…` line reaches the RAM ring
   **only** and is never forwarded. Absence of a `crash:` line in VictoriaLogs is therefore **not**
   evidence of no crash — take the reason from `/status.last_crash` (step 4), and the boot history
   from the uptime resets above.

4. **Crash?** If `/status.last_crash` is non-null, it already carries a partial picture from the
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
   `build/` (e.g. `gh run download <run-id> -n <artifact>` for the run that built this `version`),
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
- **Live board → this skill. A GitHub issue → `bug-triage`.** An external user's report is a frozen
  snapshot from a device you cannot reach, so steps 3 and 4 above (the VictoriaLogs boot
  reconstruction, the `/coredump` 200-vs-404 check) have no counterpart there and must not be
  imitated from the numbers a report happens to contain.
- The device has no live push; the web UI polls `/status` + `/values`, and this skill takes the same one-shot HTTP snapshot,
  which is the right tool for triage. For a live watch, open the web UI.
- `POST /diag/clear` clears the in-memory diagnostic ring. This triage flow does not need it; use it
  only after the user explicitly asks to discard those logs.
- `POST /coredump/clear` erases only the dump partition — only after the user has the decoded
  backtrace and explicitly asks to clear it. `POST /crash/dismiss` is different: it also dismisses
  the crash record.
- Nothing here needs the signing key or Docker **except** step 5's symbolization.
- **The device snapshot and the log history answer different questions.** `/status` + `/diag` say what
  is true *now*; VictoriaLogs (step 3) is the only source for *what happened* — reboots, when a
  failure mode started, whether the box was ever healthy. Skipping step 3 on a "it crashed" report
  means reasoning from a RAM ring that has already overwritten the evidence.
