---
name: device-triage
description: Triage a live daikin-altherma-esp32 over the network — pull /status, /values and /diag, summarize WiFi/MQTT/X10A health, and if a crash is flagged, download /coredump and symbolize it against the matching-version .elf. Use to investigate a misbehaving board, a crash banner, or "why is it offline".
model: sonnet
disable-model-invocation: true
---

# device-triage

Read a running device's health over HTTP and, if it crashed, pull and symbolize the dump. This is
the live-device counterpart to `flash-esp32`. Read-only on the device except `/coredump?clear=1`
(never clear without asking). No auth/TLS by design — trusted LAN only.

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
   - **WiFi** — connected? RSSI, `wifi.reconnects` (climbing = flaky link / ghost-assoc).
   - **MQTT** — connected? `mqtt.count` / `mqtt.fails` / reconnects (fails climbing = broker/TLS/creds).
   - **X10A** — `hp.connected`, `hp.last_ok_s`, `hp.registers`/`hp.values`, `hp.crc_err`,
     `hp.timeout_err` (timeouts = wrong RX/TX pins or a silent bus; crc_err = noise/wrong proto).
   - **Model** — `detect.model` + `profile.id`; note if `detect.ambiguous`.
   - **Heap/uptime** — low heap or an uptime that keeps resetting hints at a reboot loop.
   - **Build** — `version` + `app_elf_sha256` (needed to fetch the matching .elf in step 4).

3. **Crash?** If `/status.last_crash` is non-null, it already carries a partial picture from the
   boot-time cache — report it first, no download needed:
   ```bash
   jq '.last_crash | {reason,fault,task,pc,backtrace,corrupted,elf_sha256}' /tmp/dt_status.json
   ```
   `fault:true` = a real fault (panic/watchdog), not a clean power-cycle. If `coredump:true` a full
   dump is waiting in flash — continue to step 4. If there's no dump, the reason + backtrace above
   is all there is.

4. **Symbolize the dump** (needs Docker for `decode-coredump.sh`; a cloud/no-Docker session can
   download the dump but not decode it — hand it off or note that). Paths must be **inside the
   repo** (the decoder mounts the repo into the container):
   ```bash
   curl -sS --max-time 20 "http://$H/coredump" -o coredump.bin   # repo root; 404 if none
   ```
   The dump is useless without the **matching-version** unstripped `.elf` — CI archives one per
   build (`dist/*.elf`, keyed by `app_elf_sha256` from step 2). Fetch that build's ELF into `build/`
   (e.g. `gh run download <run-id> -n <artifact>` for the run that built this `version`), then:
   ```bash
   scripts/decode-coredump.sh coredump.bin build/daikin-altherma-esp32.elf
   ```
   `esp-coredump` warns on an ELF/dump `app_elf_sha256` mismatch — if it does, you grabbed the wrong
   build; refetch the one matching step 2. Summarize the crashed task + symbolized backtrace and
   point at the likely frame.

5. **Report.** Lead with the verdict (healthy / which subsystem is unhealthy / the crash cause),
   then the supporting numbers. Suggest the next action (e.g. re-run detection via `POST /detect`,
   check broker creds, re-seat the X10A wiring) — do **not** take side-effecting actions or clear
   the coredump without asking.

## Notes
- The device pushes live over the `/events` WebSocket; this skill takes a one-shot HTTP snapshot,
  which is the right tool for triage. For a live watch, open the web UI.
- `/coredump?clear=1` erases the dump partition — only after the user has the decoded backtrace and
  explicitly asks to clear it.
- Nothing here needs the signing key or Docker **except** step 4's symbolization.
