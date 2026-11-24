# Maintainer procedures

Use this guide for builds, publication, signed bootstrap/recovery and separately authorized device
updates. A request to edit or review the repository does not authorize commit, publication or hardware
writes. [CONTRIBUTING.md](../CONTRIBUTING.md) owns the contribution/review loop;
[SECURITY.md](SECURITY.md) owns trust, signing and rollback conditions.

## Build and inspect

The supported target is ESP32-S3 with at least 8 MiB flash. Build with the CI-pinned SDK resolved by
repository scripts, not an arbitrary local installation:

```bash
scripts/idf-docker.sh idf.py build
```

Local builds and untrusted PR builds are unsigned compilation evidence. They are not flashable.
CI PR artifacts contain compressed ELF/checksum and size diagnostics, never app/merged/browser
images or installer manifests. Changes to dependency ranges require a deliberate
`idf.py update-dependencies` through the same Docker wrapper and review of `dependencies.lock`.
Keep source/build SHA explicit when interpreting artifacts; a local version string alone is not
provenance. Stack and image-size gates run against the exact ELF/image.

## Publication feeds

| Feed | Installer and manifest | Published by |
|---|---|---|
| Release | Root Pages path and `manifest.json` | Manual build dispatch with `release:true`; exact-source version tag and GitHub Release |
| Development | `dev/` and `dev/manifest.json` | Firmware-relevant `main` pushes; no version tag/Release |

Dev versions use `<next-release>-dev.<n>`. A saved channel follows one feed; switching from dev to the
preceding stable release is an explicit downgrade confirmation, not an automatic cross-feed update.
Each feed also has public `artifacts.json` and bounded `changelog.json`. Artifact provenance binds
source, target, version, application SHA and signing identity. Notes select only squash subjects
whose Conventional Commits type the generator publishes (PR titles, see CONTRIBUTING.md); a version
without one gets a generic line. Notes do not authorize installation. No private detail belongs in
selected commit subjects.
Equal-version resume requires the original source and every original offered byte, including
signature, artifact index and changelog; a rebuild of the same source cannot substitute for them.
Recover the original handoff or use the next version. The authorized `$deploy-prod` chain handles
confirmed cumulative changelog capacity exhaustion through its release-baseline handoff.

The signing job has read-only repository permission. The publisher has write permission, no signing
key and revalidates the handoff. Manual release dispatch skips the mechanical PR suite and does one
signed build/publication. It has no board inventory, self-hosted hardware job or acceptance gate and
contacts no device. Review/CI, published binary/signature, device injection, probation, API and rendered
UI evidence remain distinct.

### CI checkout and publication cost

For ordinary merges, the signed dev build starts after the local check receipt matches the squash
tree and first parent. See the [Renovate runner-pin exception](#local-release-checks). The signing
job builds the exact main commit. CI/release contracts own the
provenance, signing, stack-budget, reproducibility, readback and OTA selftests; the build-contract step adds only its
distinct configuration-default and size-report tests. Actual ELF and signed-artifact checks still
run against each build. The publisher verifies signatures, then its candidate gate validates the
source-bound manifest, complete binary inventory, installer plan and changelog once before mutation.

All four source checkouts retain complete commit history and tags. Only `trusted_build` and
`publish` filter historical blobs with `blob:none`; the current source tree remains complete.
The local release suite hydrates the candidate and its first-parent tree, then uses
`prepare-ci-history.py` to load the historical HTTP config and deadline regression sources before
taking the offline snapshot. Missing source or a changed fixture read blocks the local checks.
PR and mechanical checkouts remain unfiltered and remove persisted credentials.
The publisher's `gh-pages` fetch filters blobs too. Version admission and changelog generation
establish path presence from the tree and block when a listed feed blob cannot be read. Exact tree
and public-byte verification still materialize every needed current file.

Both feed publishers maintain one empty regular `.nojekyll` at branch root to bypass Jekyll
regeneration. An unsafe root marker or a local `dev/.nojekyll` blocks the affected publish before
the API call. GitHub Pages has started branch deployments after the signed GraphQL commits from
this workflow. Dev readback requires the exact manifest before downloading all feed files and
checking their bytes and signature. Attempts, delays and timeouts are unchanged. Pages deployment
and CDN propagation overlap this wait; do not add Pages job durations to the main critical path.
Measure checkout, queue/startup, downloads, compilation, tests, signing, deployment and public
readback separately. Claim CI acceleration only after a comparable run of the published change.

### Local release checks

The native `pre-push` hook runs the repository's full mechanical suite and unsigned ESP32-S3
compile for maintainer pushes. It refreshes `origin/main` and checks the prospective merge tree
in private snapshots with main as the first parent. Native runtime tests, host audits and release
contracts, and the ESP32-S3 build with Docker host checks run in three parallel groups on separate
checkouts. The compiler and Docker host checks run in sequence within their group to limit
container contention. Coverage includes the native test and the Ubuntu GCC 15 x86-64 branch
profile. For UI-relevant changes, headless Linux Chromium and WebKit start after all three groups
finish so their work cannot affect the UI timing measurements.
Set `DAIKIN_RELEASE_BROWSER_DOCKER_CONTEXT` to a context on a separate, trusted Linux Docker
engine when other workloads share the default engine. Only the browser phase uses that engine.
See [host tooling and checks](../test/README.md).

To run the gate manually, use
`scripts/agent-python.sh tools/release/push_checks.py "$(git rev-parse HEAD)"` in a clean checkout.
Review fork code first and run it in a disposable environment without maintainer credentials.
The scripts run with the current user's permissions. Keep `origin` on the canonical repository
and fetch a fork head separately.
Post the emitted `daikin-local-release-checks` line as a new PR comment from the maintainer
account. It is a maintainer assertion of a completed local run. It has a 24-hour window through
merge. Keep the original comment because signed publication verifies it against the merge time.
Editing the PR description refreshes `gates`, which validates the comment author, head, current
main, merge tree and completed review records. The bootstrap PR runs the legacy build and PR
prose audit. Its local merge command and signed publication verify the receipt while the old
protected `gates` job still checks review records alone.

After cutover both required check names remain and use brief admission jobs. Refresh evidence
for existing open PRs before merging. Use the canonical synchronous merge command, which
rechecks the receipt immediately before merging. A green GitHub check can outlive the receipt
window. Signed publication, including manual stable publication, requires a receipt valid at
the actual merge time. The protected policy's existing
[Renovate runner-pin exception](AGENT_MIGRATION.md#operating-rules) does not need a local
receipt to merge. The pin is outside the firmware inputs. When publishing from such a main tip,
the signer re-attests each intervening pin-only change and verifies the preceding source receipt.

### First Pages publication

1. Bootstrap `gh-pages` as a reviewed signed orphan commit. The publisher refuses to invent a missing
   branch or create an unsigned initial commit.
2. Select **Settings → Pages → Deploy from a branch → gh-pages → /(root)**. The publisher updates
   that branch; selecting GitHub Actions as the source does not serve this branch-based workflow.
3. Trigger an authorized build dispatch. Leave release off for dev; setting `release:true` explicitly
   publishes the root feed, tag and Release.

Subsequent Pages commits use expected-head concurrency and must have a verified GitHub signature.
Release root and dev can be published independently. The Pages site is public even with private
repository source; tags/Releases retain repository visibility. Before making source public, inspect
existing private issues/comments, enable private vulnerability reporting and verify the report workflow.
Never include private inventory, logs, coredumps or signing material in published artifacts.

## Signed USB bootstrap or recovery

Ordinary private-inventory bench delivery uses OTA. Signed USB is also permitted for the explicitly
requested pre-merge test of an exact clean local head on the bench through `$deploy-test` or its
`$flash-esp32` rules. That test is separate from artifact delivery and does not publish a feed.
Production USB remains bootstrap/recovery only; older OTA handshakes and partition-table migration
need that separate authorization. macOS Docker does not pass USB through; detect the host port with host
`esptool`. Never infer board identity or pins from a successful build.

Before every flash:

1. Obtain the reviewed signed app/bundle for the intended source, version and ESP32-S3 target.
2. Verify the application with the repository guard:

   ```bash
   scripts/require-signed.sh build/daikin-altherma-esp32.bin
   ```

3. Use the exact bundle's reviewed flash plan. Ordinary `@flash_args` writes separate parts around
   NVS; from that bundle's `build/` directory, the host command is:

   ```bash
   esptool --chip esp32s3 -p <detected-port> write_flash "@flash_args"
   ```

A local compile requires separately authorized offline signing first. Agents may pass the key by
path only to the direct signing invocation; never inspect, copy or wrap it with unrelated work.
A full flash rewrites bootloader/table/otadata, so it has no previous-slot rollback promise even
when NVS is preserved. Confirm signature/build identity and recovery state after injection.

| Installation choice | Data effect |
|---|---|
| Published sparse Web Serial parts, **Flash** | Leaves NVS and flash history untouched |
| Ordinary separate `flash_args` | Leaves `nvs@0x9000` untouched; verify the exact plan before use |
| Browser **Clean flash** | Deliberate whole-chip factory reset |
| Published `-merged.bin` at `0x0` | Manual factory-reset image; gap padding overwrites NVS |
| Recovery button held 5 seconds | Starts a reset when History is ready; keeping the stated board hardware is best effort. See the [recovery button contract](BOARDS.md#recovery-button) for data and failure details. |

For an explicitly requested manual factory-reset flash of a verified official merged image:

```bash
esptool --chip esp32s3 -p <detected-port> write_flash 0x0 \
  daikin-altherma-esp32-<version>-merged.bin
```

NVS erasure, partition writes and factory reset require their own authorization and appropriate
backup. Do not move/resize NVS. The official 8 MiB table retains existing NVS/coredump/OTA addresses
and places history at `0x400000`; an older table needs one signed USB/Web Serial reflash because OTA
cannot deliver a table. An older firmware may refuse a newer config blob; that is not evidence that
stored configuration was erased.

## Local dev OTA tests

An explicitly requested local test sends a locally built, signed application directly via
`POST /ota/upload` to any requested board (`bench`, `production`, or an explicit board IP/hostname).
The target must already have its saved release channel set to `dev`; the upload never changes that
setting. Changing the channel requires a separate explicit request. MCP's read-only `get_ota_info`
describes the endpoint and its availability; discovering it does not authorize a write.

Build the intended checkout with the pinned ESP32-S3 Docker toolchain. Reuse `build/local-ota` for
incremental builds; use a fresh directory and its own `SDKCONFIG` path when testing changes to
`sdkconfig.defaults` or the toolchain. Sign to a unique `.bin` file using the host key-by-path
procedure in [`$deploy-test`](../.agents/skills/deploy-test/SKILL.md). Replace `attempt-id` with a
unique name and run these as separate commands:

```bash
scripts/idf-docker.sh idf.py -B build/local-ota -D IDF_TARGET=esp32s3 -D SDKCONFIG=/project/build/local-ota/sdkconfig build
espsecure sign-data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" --output build/local-ota/signed-attempt-id.bin build/local-ota/daikin-altherma-esp32.bin
shasum -a 256 build/local-ota/signed-attempt-id.bin
```

Run the uploader directly, passing `bench`, `production`, or the target board's IP/hostname (add
`--expected-mac '<AA:BB:CC:DD:EE:FF>'` when binding MAC explicitly or when targeting the shared
`daikin-altherma-esp32.local` mDNS name), the absolute signed image path and its printed SHA-256:

```bash
scripts/dev-ota-upload.py --target '<bench|production|ip-or-host>' --image /absolute/path/signed-attempt-id.bin --expected-app-sha256 '<64 lowercase hex>' --execute
```

No Codex CLI, source receipt, test suite, format or stack audit, review, commit or published build is
required for local OTA. Boards addressed by IP/hostname do not require a local `production-ota.json`
inventory file: preflight reads and pins the board's live MAC across reboot (while still applying
production health rules automatically if a local inventory identifies that host or MAC as
`production`). Non-production boards bootstrapped over USB may lack a rollback record before their
first OTA. Omit `--execute` for a read-only preflight.
An exclusive `.upload-attempt` marker is recorded beside the signed file and a private upload journal
is retained; one failed, timed-out or lost upload response is never permission to resend — inspect
`/ota/status` and device health read-only first. See [API.md](API.md#ota-operation-contract) for the
binary HTTP contract. Run the applicable repository checks before pushing; PR reviews and CI still
apply before merge.

After upload, verify the actual boot, rollback/safe-mode state, heap/stack, source connectivity and
requested behavior. An unwired bench or desk board does not provide X10A evidence. The observer must
see `pending_verify` followed by `valid` within one distinct boot; seeing only `valid` cannot exclude
a same-build rollback. A 200 response proves completed validation and boot selection, not probation
or plant behavior. Report this as a local test of the uploaded bytes. Official artifact delivery
retains the separate bench-first promotion chain below.

## Role-pinned OTA

Every official agent-run OTA promotion uses the **direct, unchained** `scripts/production-ota-gate.py`.
The explicitly authorized [local dev test](#local-dev-ota-tests) is a separate path. Promotion requires
a clean exact source tree, an official manifest, expected source/version/application SHA,
ESP32-S3 metadata, signature, range behavior and host contracts. Device targets come exclusively
from the local schema-versioned inventory, never a hostname argument:

```json
{
  "schema_version": 1,
  "bench": { "host": "<bench-host>", "mac": "<BENCH-MAC>" },
  "production": { "host": "<production-host>", "mac": "<PRODUCTION-MAC>" }
}
```

Its path is `$XDG_CONFIG_HOME/daikin-altherma-esp32/production-ota.json`, or below `~/.config`.
Roles must identify distinct devices. Inventory is private and untracked.

Default delivery targets `dev/manifest.json` and a `<next-release>-dev.<n>` version. An explicitly
requested stable Release delivery uses `https://0bu.github.io/daikin-altherma-esp32/manifest.json`
and `X.Y.Z` instead in the same command shapes below. Both require the target artifact's source to
match the clean runner `HEAD`; a gate change therefore needs a new publication from its reviewed,
merged source. A Release target also requires its exact source tag from the official GitHub remote.
Publication and device delivery remain separate authorizations.

The gate binds one check/update generation transiently to the chosen official feed and preserves
the device's saved dev or Release preference. Report the installed artifact feed separately from
that preference; installation does not change which feed future checks follow. Arbitrary URLs,
saved channel changes and production downgrade overrides are outside this path.

### Ordinary bench delivery

After the exact artifact is published, an explicitly authorized bench update uses:

```bash
scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha <40-lowercase-hex-main-sha> --expected-version <dev-version> --expected-app-sha256 <64-lowercase-hex-app-sha256> --expected-current-version <bench-current-version> --confirm-bench bench --install-bench
```

This mode returns before constructing a production target or excursion leg. Before its single update
POST it requires the inventory MAC/current-version lease, current ELF, connected non-rollback WiFi,
unchanged saved channel, MQTT, no safe mode/fault/allocation skips and safe internal heap.

Acceptance must return the immediate successor operation generation. Observe completed validation,
positive operation-local free/largest-block minima and at least 1 KiB OTA-stack reserve **before
reboot**. The returned target version/ELF/MAC and software-reset reason must match. Immediately before
pressure, the exact image must still show `pending_verify` with rollback armed. Start three-minute
status/values/diag plus real manifest-TLS pressure within 120 seconds of boot; require stable
counters, recovered heap and MQTT. Afterwards allow at most 150 seconds to confirm the same identity,
monotonic stressed uptime and `valid`/rollback-disarmed state. Confirmation permits at most three
expected unwired X10A timeouts. Physical X10A and Weather are not bench prerequisites.

Raw board probes wait for peer close within the original request deadline before completing.
The exact end sample is journaled before the final pressure, counter and heap checks, so a failed
heap check retains its measured values. Peer close does not prove TCP memory reclamation.
In every gate pressure window (bench delivery, promotion round trip, production and lab-HIL),
busy-503s during the gate's own Weather-refresh/manifest-TLS window are expected and required
(`tls_busy_503`). Outside it, a `/values` 503 counts as expected only when its body is exactly the
firmware's TLS-busy text ([API](API.md)) and a `/status` sample from one second before the request to
one second after its refusal shows the board's own Weather client fetching, at most
`MAX_WEATHER_REFUSALS_PER_EPISODE` per continuous fetch and `MAX_WEATHER_REFUSALS_PER_WINDOW` per
window; the receipt counts these as `firmware_weather_busy_503`. Every other refusal blocks. Each
blocking error names any response text, its time in the window and the last sampled uptime; a
rejected `/values` refusal also names why it was not accepted.

The sole old-writer exception is the gate's exact historical `1.0.2` version/ELF identity with an
absent OTA-stack field. Numeric below-limit stack, missing validation/heap evidence or another
writer is refused. The returned current target still passes full health/pressure gates. That
exception does not apply to lab-HIL. The 105-second dwell and next accepted OTA start remain
compatibility evidence only for older stable release staging, not current bench acceptance.

### Production promotion

After the same artifact is healthy on the bench, separately authorized production promotion uses:

```bash
scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha <40-lowercase-hex-main-sha> --expected-version <dev-version> --expected-app-sha256 <64-lowercase-hex-app-sha256> --expected-current-version <production-current-version> --confirm-production production --execute
```

The transaction has two distinct stages:

1. **Bench full-download round trip.** A dev target takes a pinned official stable excursion and
   returns to dev; a stable target takes a pinned official dev excursion and returns to Release.
   For stable promotion, that dev artifact must have the target's source and numeric version core:
   wait for the exact main dev build before publishing its stable Release, then freeze both feeds.
   Verify both signed binaries and their source/version/application SHA. Require the stable
   source/version tag, except the gate's exact signed historical stable excursion tuple. The
   historical restore writer needs the raw dev manifest's 1024-byte ASCII/no-escape frame;
   inventory belongs in sibling `artifacts.json`. Raw target manifests remain bounded to 1024 bytes.
   Rebind the raw target and excursion manifests before their corresponding writes. Preserve the
   saved channel and bind each check to its exact official feed. Download and validate the complete
   excursion under HTTP pressure, survive probation, restore the exact target, witness pending
   rollback, run three-minute pressure immediately and confirm the valid/disarmed image afterward.
   Wait past pending-image probation before each replacement. The legacy return offer must remain
   continuously idle for three seconds before its one restore write.
2. **Production canary.** Before the sole production POST, observe two consecutive MQTT-connected,
   Weather-idle samples within 15 seconds while old identity, uptime and live X10A remain stable.
   Heap-restart, MQTT-skip, poll-skip and CRC counters must not change; X10A timeout delta stays within
   three. Bind the completed target check generation/feed/version/SHA, require successor generation,
   capture validation/heap/stack evidence, then observe target identity, rollback/crash/safe mode,
   live values and retained X10A MQTT through a separate three-minute read-only canary (longer after
   a clock wait, below). Before success, require an explicit valid/disarmed image with stable
   identity, uptime and counters.

**Do not publish either participating feed during this transaction.** The old release cannot retain
transient feed headers; its return reads the mutable official dev path. Manifest drift, failed return,
pending image or bad bench pressure stops before production contact. Pressure readiness has a bounded
MQTT reconnect window and requires at least 24 KiB free heap and a 16 KiB largest block in that same
window. Pressure must still start within 120 seconds of boot with unchanged uptime/counter guards;
a paused or unsafe-heap baseline is not accepted as a healthy start.

The gate binds the production board's explicit Weather `configured` flag before writing and
checks it again after reboot and during the canary. The production canary always exercises manifest TLS,
HTTP, MQTT and X10A. Configured Weather additionally needs an exact non-zero
requested/started/completed/success token and a success-counter advance. OTA serialization may
defer the same outstanding attempt, but unrelated scheduled fetches cannot satisfy it. Only a
completed `waiting/heap_headroom` refusal may wait until all pressure workers stop, then passively
await two stable 48/20-KiB samples
for at most 420 seconds and issue one different token under a 120-second bound. That retry must
succeed with MQTT/X10A recovered and invariant uptime/counters/heap. A second refusal or another
failure blocks. Successful idle fetch afterward must not be described as Weather TLS success under
load. Cross-subsystem streamed snapshots require later owner evidence, never assumed simultaneity.

The firmware starts no Weather fetch before SNTP sets its clock. A pressure run that requires
Weather therefore first waits, with its probes running but before the gate's own
Weather-refresh/manifest-TLS window, while the board reports `ntp.synced: false` and until its
Weather client is idle, at most `CLOCK_SYNC_WAIT_MAX_S`. The three-minute pressure window is
extended by that wait, and the sample minima scale with it; absolute allowances such as the three
X10A timeouts do not. The stress receipt records the wait as `clock_wait_s`. Refusals and MQTT gaps
during the wait are judged as outside that window, and a reboot or allocation failure ends it at
once. A clock still unsynchronized at the bound blocks with its own message. Without the board's
report the gate does not wait for the clock. A clock wait can move the gate's TLS past the
firmware's probation commit (a healthy image commits after `kHealthBaseWindowS`,
`main/ota_update.cpp`); the production canary claims no probation coverage.

The gate observes transfer status at a bounded 2 Hz with fixed-size reads and a one-second request
budget. Only read-only GETs interrupted by reboot are sampled again; malformed complete replies
fail. Version/ELF identity does not prove cryptographic readback of all running flash bytes.

### Abort and evidence

Do not wrap, chain, shorten or retry the gate command or its update POST; the admitted command is
one line with no backslash continuations. No compensating write
follows failed acceptance. A staging command without `--execute` still writes the bench and is not
an admitted read-only preflight. Preserve failure evidence; a later healthy sample does not turn
that transaction into a pass.

Leave every board the gate contacts alone while it runs: no UI or API update check, settings save or
Weather refresh. The gate cannot tell such an operation from a fault. A manifest check pauses X10A
polling for its whole run, including heap waits of up to `kTransferHeadroomMaxAttempts` ×
`kHeadroomRetryDelay` each (`main/ota_update.cpp`). Once `last_ok_s` reaches
`MQTT_X10A_OFFLINE_GRACE_S` (`main/logic/mqtt_publish_gate.hpp`), `/status` reports X10A as lost
([API](API.md)) until the next answering sweep. Every X10A liveness or timeout-delta block names
`connected`, `values`, `last_ok_s` and the timeout delta against the gate's baseline. A silent bus
raises the delta. Paused polling leaves the delta unchanged and only ages `last_ok_s`.

Firmware predating production's busy/generation/artifact handshake fails before its POST. Its
one-time migration is separately authorized signed, NVS-preserving USB application bootstrap;
there is no timing-based legacy production fallback. This gate creates no release.
Report host/CI checks, signed artifact identity, each injection, pre-reboot verifier/heap/stack,
probation, API/source liveness, retained MQTT and rendered UI evidence separately.
The private atomic receipt journal checkpoints before the sole POST and preserves completed
artifact/bench/production stages and elapsed times. The official gate reuses host and contract
results from the pre-push run for 24 hours on the same machine and account, if the published
commit has the identical tree and first parent. The cache lives under
`~/.cache/daikin-altherma-esp32/release-checks/`. With missing or incompatible local evidence,
the gate reruns the two checks before contacting hardware. An ambiguous response leaves
execution unknown; journal failure
before a write blocks it. Public output includes only typed delivery evidence, excluding device
identifiers, complete status, topics, coordinates and raw errors. Failure handling neither queries
the device nor retries and exits with status 2.

## Standalone lab-HIL

The destructive lab harness is independently authorized test work, never part of release, PR or
ordinary dev publication and not an ordinary admitted agent command. Schema-3 root-owned policy
plus protected runner inventory pins a non-production board, distinct bootstrap identity/feed,
leased candidate HTTPS URLs and feed/power controllers; production identities are denied.
The harness has no signing key. Candidate and bootstrap bytes, hashes, signatures and Range
behavior are checked before contact. Controller URLs are canonical HTTPS without redirects,
credentials or ambiguous/query paths.

A controller-owned non-renewable 80-second watchdog surrounds rollback-armed installs. First prove
pending state and forced return to bootstrap with unchanged pins/profile/MQTT/channel. On the second
install, require exact candidate identity, completed validation, positive heap evidence and at least
1 KiB OTA-stack reserve by 45 seconds before releasing that watchdog; observe 105-second health,
explicit valid/non-pending state and a cold power cycle with retained configuration/history.
Before any feed lease or OTA write, require a synchronized clock and two informative, dated X10A
trend canaries with older completed non-null cells. Capture them again on the valid candidate before
the cold cycle; after restart, compare the same absolute five-minute buckets, units, values and
explicit gaps under stable boot/epoch, profile and link identities. Both acquisition and restore
wait at most 180 seconds. Empty, missing, changed or shifted history cannot pass merely because
`history.persist` reports `power_cycle`. Positive old-cell restoration proves those cells were
durable; the API does not expose a pre-write flash-commit counter.

The API rounds sample age differently from the journal at subsecond boundaries. An anchor within
six seconds (`HTTP_TIMEOUT_S + 1`) of either bucket edge is unavailable evidence; the controller
never shifts data to obtain a match. Between bootstrap, candidate and cold snapshots, device wall
time must follow elapsed host monotonic time within 12 seconds (twice that exclusion). A witnessed
clock discontinuity fails immediately; retries cannot replace its evidence. Persistent ambiguity
also fails, even if the restore was intact. Each canary needs variation or an existing gap. The
receipt records the clock tolerance, exclusion and counts for the two inspected trends, without raw
timestamps or measurements. It does not prove all trends, completed diagnostic hours or physical sensor
truth. Executed host fixtures prove controller behavior, not a physical cold cycle.

Then exercise the candidate's own writer through a verified bootstrap downgrade under another
watchdog; capture pre-reboot evidence, prove pending bootstrap, force rollback to the valid candidate,
and run combined HTTP/MQTT/X10A/Weather pressure with sampled stack limits and a fresh accepted offer.
Runner failure after explicit candidate approval still fails the test without promising automatic
rollback of an already approved image. One lab profile proves neither a production plant nor all
physical behavior.

## Crash evidence

Keep current redacted status/values/diagnostic evidence and the matching build id before any
explicitly authorized dump deletion. Obtain a raw dump only when needed and keep it private.
Decode with the matching unstripped ELF, not merely the same display version:

```bash
scripts/decode-coredump.sh coredump.bin app.elf.xz
```

The script uses the CI-pinned container, checks raw dump integrity and exactly one valid 72-byte
SDK ELF identity note before associating the matching artifact and starting GDB. Missing, short,
malformed, duplicate or mismatching identity invalidates interpretation; preserve private originals.
The operational status ELF prefix is nine characters, not full artifact verification. Matching ELF
cannot date the stored incident or prove it caused the current reset. Proven foreign dumps are
preserved at boot but suppressed from summary/download for that boot.
The xz wrapper does not alter the ELF bytes inside. RAM logs cannot establish prior
boots; an explicitly configured durable syslog collector can supply additional history.
