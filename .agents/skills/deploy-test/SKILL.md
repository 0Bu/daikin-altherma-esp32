---
name: deploy-test
description: Pre-merge bench test of an exact local head — build via Docker, sign on the host, USB-flash the private-inventory bench preserving NVS, verify health and the changed behavior, and fix and repeat on findings. Use when asked to test a change on the test bench before merge; deploy-prod also runs it for its PR head and every fix head.
---

# deploy-test

## Authorization boundary

Treat review and audit requests as read-only. An explicit request to run `deploy-test`, or
`$deploy-prod` running it for its PR head (Step 0) or a fix head (Step 8), authorizes for the
**bench role only**:
- a local Docker firmware build of the exact, clean head (`scripts/idf-docker.sh idf.py build`);
- one unchained host signing command per image that passes the offline OTA key **by path**;
- a USB write of the unchanged repository flash plan (`build/flash_args`: bootloader, the unchanged
  partition table, `otadata`, `ota_0`; `nvs` and `coredump` untouched) to the identified bench;
- read-only HTTP checks against the bench, plus non-persistent bench requests the changed behavior
  needs for its test (for example `GET /ota/check` to exercise an OTA/TLS path);
- on findings: diagnosis (`$device-triage`), a scoped code fix with a regression test, and a repeat
  of this workflow once its exact, clean fix head is authorized and available.

It does **not** authorize:
- contacting the production role, or an OTA write (`/ota/update`) of any kind;
- a request that writes configuration or NVS on the bench (that needs the user's explicit request),
  `erase_flash`, NVS erasure, a partition table that differs from the one the bench runs, or
  coredump clearing;
- pushing, opening or editing PRs, or merging. When `$deploy-prod` runs this skill, `$deploy-prod`
  owns those steps.

A standalone `deploy-test` request does not authorize repository commits. Commit a fix only when
the user separately authorized commits or this run inherits the `$deploy-prod` failure chain.
Otherwise prepare the scoped fix and host verification, report the pending commit and bench retry,
and retain the last tested SHA. Never call an uncommitted fix an exact, clean tested head. Do not
request a routine reconfirmation for a commit already authorized by the current chain.

This is the only ordinary path for unmerged code to reach the inventory bench; `$flash-esp32`
naming the bench follows the same rules, and `$flash-esp32` covers boards outside the inventory.
It is a test, not a delivery: an official dev artifact reaches the bench through `$deploy-prod`'s
OTA gate (`--confirm-bench bench --install-bench`), never through this skill.

## Target identity

- The bench is the `bench` role of the private inventory
  (`~/.config/daikin-altherma-esp32/production-ota.json`: host and MAC). Never flash any other board.
- The board on USB can be running another project's firmware. Establish what runs **before**
  touching USB: `/status` from the inventory host must report the inventory MAC (compare
  case-insensitively). If it answers as another project, or not at all, stop and ask the user.
  Exception: if the board stopped answering after this run's own write (same port, MAC matched
  before that write, board not unplugged since), the step-6 MAC check suffices, so the fix loop
  can recover an image of its own that fails at boot.
- Every esptool connection resets the chip it probes. Probe only the port that can be the bench; if
  two ESP32 ports are present and neither can be excluded, stop and ask.
- `hp.connected` may be `false`: the bench need not be wired to a heat pump. All-timeout X10A on an
  unwired bench is expected and is not X10A evidence.

## Steps

1. **Pin the head.** The worktree must be clean. Record `git rev-parse HEAD` and the changed files
   against `origin/main`. Every build, signature and device record below refers to this commit; a
   new commit restarts from step 2.

2. **Check the version floor.** A local build reports the committed `version.txt` version, and the
   next official dev OTA replaces it only if that dev version compares higher
   (`main/logic/version_cmp.hpp`; a release outranks its own pre-releases). After
   `git fetch --tags origin`, compare `scripts/next-version.sh --dev` with `version.txt`. If their
   numeric cores are equal, for example right after a `version.txt` floor bump, stop and ask instead
   of flashing.

3. **Run the host gates** for the affected surface (the list and their scripts are in `AGENTS.md`),
   then build:
   ```bash
   scripts/idf-docker.sh idf.py build
   ```
   Record the ELF hash: `shasum -a 256 build/daikin-altherma-esp32.elf`.

4. **Sign on the host.** Pass this one command on one line, with no pipe, chain, substitution or
   backslash continuation; the hook rejects a signing command that contains a newline:
   ```bash
   espsecure sign-data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
   ```
   `--keyfile` must be the literal `"$OTA_SIGNING_KEY_FILE"` or a path whose file name is
   `ota_signing_key.pem` or `daikin_ota_signing_key.pem`; the hook admits no other key file name or
   position. Then, as separate commands, copy the signed image over the application path that
   `build/flash_args` references and guard it:
   ```bash
   cp build/daikin-signed.bin build/daikin-altherma-esp32.bin
   scripts/require-signed.sh build/daikin-altherma-esp32.bin
   ```
   No key available: report the USB test as unavailable. Never flash an unsigned image.

5. **Check the flash plan.** Read `build/flash_args` and confirm that no part, rounded up to the 4 KiB
   erase sector, overlaps the `nvs` or `coredump` partitions of `partitions.csv`. Confirm that
   `partitions.csv` is unchanged against the source the bench runs:
   - For a release `X.Y.Z`, that is tag `vX.Y.Z`.
   - For an official `X.Y.Z-dev.N`, it is the commit on the linear `origin/main` that is `N` commits
     after the highest `v*` tag (`scripts/next-version.sh`), or simply the manifest `source_sha`
     while the feed still carries that version.
   - For a local image left by an earlier `deploy-test`, it is the pinned SHA that test reported.

   If the source is unknown, or the table differs, stop: a partition change needs separate explicit
   authorization.

6. **Identify the board, then write.** Run `esptool --port <port> chip-id` on the candidate port and
   require exactly one port whose MAC matches the inventory bench MAC (case-insensitively). Repeat
   that check immediately before the write, then:
   ```bash
   (cd build && esptool --chip esp32s3 -p <port> write-flash "@flash_args")
   ```
   If the port is silent, the board may be wedged; a physical USB replug is the fix. Do not switch to
   a different port without identifying it again.

7. **Verify by identity, not by name.** The board must be running *this* image: compare
   `/status.app_elf_sha256` from the inventory host with the first nine hex characters of the
   full ELF hash from step 3. The pinned ESP-IDF configuration uses
   `CONFIG_APP_RETRIEVE_LEN_ELF_SHA=9`, so the API and serial boot line expose a shortened build
   identity. Retain the full artifact hash and signature evidence separately; this prefix comparison
   is not a cryptographic readback of the installed image. If HTTP is unavailable, compare the
   serial boot line `ELF file SHA256` and report that verification limit. Never verify through
   `daikin-altherma-esp32.local`, which can resolve to another board. Then:
   ```bash
   scripts/verify-device-health.sh --ip <bench-host> --expected-version <version> --expected-elf-sha <elf-sha-prefix> --timeout 90
   ```
   Record the reported version: the next `$deploy-prod` bench gate needs it as
   `--expected-current-version`. A USB-flashed image has no rollback record (`image_state`
   unknown); that is expected for this path.

8. **Exercise the changed behavior** on the bench. Start read-only, then drive the path the change
   touches through the non-persistent bench requests that trigger it, and repeat timing-sensitive
   checks several times. A generic boot smoke test does not replace this. `GET /ota/check` only
   queues a check and returns its `generation`. When the test drives it, read `/ota/status` once
   that generation has finished (`busy: false`, no error `state`). At that point
   `ota_stack_min_free_bytes` must be non-null and at least 1 KiB, and `heap_min_free_bytes` and
   `heap_min_largest_block_bytes` must be positive. Follow with a bounded soak: at least two
   minutes, longer for networking, OTA or reconnect behavior, and for memory-related changes
   clearly longer than `HEAP_CRITICAL_HOLD_MS` (`main/logic/heap_watchdog.hpp`) after the
   exercise ends. Across the soak, `uptime_s` must keep rising. At the end of the run,
   `.sys.mqtt_skipped` and `.sys.poll_skipped` (both start at 0 on every boot) must be 0, and so must
   `.sys.heap_restarts`. The latter counts consecutive heap-watchdog restarts across reboots in
   NVS, so a non-zero value already present right after the write points at the previous image:
   record it and investigate before attributing it to the new one. If a hardware negative control
   exists (the same check failing on the previous image), record it. A USB soak is not pressure or stress evidence; the bench gate provides that
   after the merge.

9. **Report** the pinned SHA, ELF hash, signature check, flashed version, health result,
   change-specific result, soak duration and every unverified boundary. The USB identity (MAC and
   port) stays in local notes and out of GitHub. Report host, build, device, API and visual evidence
   separately. When `$deploy-prod` runs this skill, it records the pinned SHA and the result in the
   PR body.

10. **On findings: fix and repeat.**
    - Snapshot `/status` and `/diag?verbose=1` from the bench host. If `last_crash.fault` is true,
      use `$device-triage` with any available private dump and its verified matching ELF. Missing
      or undecodable dump evidence does not clear the current fault.
    - Fix the root cause with a regression test (logic under `main/logic/` with a `CHECK` in
      `test/test_logic.cpp`, or a contract test) and run the affected host checks. If commits are
      separately authorized or inherited from `$deploy-prod`, commit and restart from step 1.
      Otherwise report the prepared fix and the bench retry pending an authorized clean fix head;
      the failed head's hardware result cannot certify the uncommitted fix.
    - Ask the user only when the cause is hardware, the requirement is ambiguous, or the behavior is
      not reproducible.

## Self-analysis and cleanup

- Confirm all of the following:
  - `.last_crash.fault` is false or absent;
  - `.sys.safe_mode` is false;
  - `.sys.reset_reason` is not a fault: `usb`, `ext`, `poweron` and `sw` are normal after a USB
    write;
  - `.sys.heap_restarts` is 0, because a heap-watchdog restart also reads `sw` and is otherwise
    invisible;
  - `.sys.max_alloc` stays above the health script's floor with margin;
  - every non-null entry of `.sys.stack_min_free_bytes` keeps at least 1 KiB free. A null entry
    means the task was never sampled, for example `modbus` on a bench without HomeHub. The slot of
    every task the test exercised must be non-null; read `/status` again if needed.
- Check `/diag?verbose=1` for retry floods, queue overflows or reconnect loops.
- Remove only the temporary signed duplicate this workflow created (`build/daikin-signed.bin`).
  Keep the requested evidence and pre-existing user artifacts.
- The bench keeps running the tested local image until the next `$deploy-prod` bench gate replaces
  it with the official dev artifact.
