# Code and workflow review — 12 September 2026

This review identifies eight open findings in source revision
[`446be181c6bd9042784dcfc212296569d7961012`][source]. Four concern deployment
selection or acceptance, one concerns the separate health helper, and three concern
firmware configuration, memory ownership and diagnostic evidence. This document
records findings and proposed corrections; it does not implement them.

The review began at `9ca8a073` and was reconciled against `446be181` before this
report was written. Findings already fixed between those revisions are separated
below. References and results are tied to the reviewed revision, rather than a
claim about every future `main` revision.

The final remote comparison found `31d75d63` on `main`. Its only difference from
the reviewed revision is the Renovate runner pin; all finding-related source and
documentation remain unchanged.

## Scope and evidence

The review covered configuration ownership and persistence, X10A decoding and
catalog consistency, HTTP/MQTT allocation boundaries, OTA acceptance, source
lifecycle contracts, documentation, deployment helpers and their calling skills.
Independent read-only reviews covered heap safety and documentation consistency.

The additional reproductions used the unmodified production `config.cpp` and
`diag_log.cpp` with host NVS/FreeRTOS adapters, and the unmodified deployment
scripts with synthetic `curl` responses and a no-op `sleep`. Every mock URL was
restricted to `fixture.invalid`; the mock did not create a socket. These results
prove the selected control flow, not a physical update or real NVS durability.

No board, heat pump, MQTT broker or observability installation was contacted.
No image was signed or flashed. No live configuration, partition or plant setting
was changed. Build artifacts are compilation evidence only.

Priorities below express corrective urgency, not a measured incident frequency:
P1 concerns an unintended firmware selection or premature deployment acceptance;
P2 concerns degraded correctness, recovery or observability. All findings remain
open in the reviewed source.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| R1 | P1 | Deployment recipes bypass the required acceptance chain | Production call path and policy comparison |
| R2 | P1 | A downgrade is permitted without the explicit option | Offline script reproduction |
| R3 | P1 | An unexpected version is written before the requested version is checked | Offline script reproduction |
| R4 | P1 | OTA reports success without the new image or completed probation | Three offline script cases |
| R5 | P2 | The health helper accepts absent crash, safe-mode and heap evidence | Offline script reproduction and source trace |
| R6 | P2 | A concurrent settings save loses detected-model validity | Production C++ reproduction with host adapters |
| R7 | P2 | The MQTT reference parser leaks its JSON tree on allocation failure | Production ownership and exception-path review |
| R8 | P2 | The reduced OTA diagnostic dump omits the newest messages | Production C++ reproduction with host adapters |

## R1 — Deployment recipes bypass the required acceptance chain

**Where:** [AGENTS.md, lines 156–164][ota-policy];
[`deploy-prod`, lines 73–107 and 152–169][deploy-prod];
[`deploy-test`, lines 58–74][deploy-test];
[`trigger-ota-wait.sh`, line 151][ota-helper].

The canonical contract requires every agent OTA write to go through the direct
`production-ota-gate.py` transaction. It distinguishes bench installation from
production promotion and requires an exact signed artifact, one write, probation,
stress and the production canary. The newly listed production skill instead calls
`trigger-ota-wait.sh` for both roles; that helper directly posts to `/ota/update`.
The normal test skill also prescribes USB flashing even though the canonical rule
reserves it for bootstrap or recovery and requires OTA for ordinary bench updates.

This is an executable workflow contradiction. Following the new recipes selects a
different acceptance path with the weaknesses demonstrated in R2–R5. The repository
hook may reject a direct write; that rejection is not evidence that the recipe
implements the required transaction. Neither delivery path was executed here.

The production failure section also promises an immediate rollback, but its
command only supplies `--allow-downgrade`. The helper still defaults to the dev
feed and selects the currently offered artifact. It never selects a recorded
previous known-good image; if the offered version equals the installed one,
lines 123–125 return success without updating. Therefore this command cannot
establish that rollback occurred.

**Correction:** Make the recipes use the canonical role-bound transaction and
its evidence requirements. Define recovery in terms of an explicit, verified
known-good artifact and the applicable authorization. Move installation-specific
LAN/Mac instructions to the user-global workflow, as required by AGENTS.md; do not
copy those details into more repository documentation.

**Regression proof:** A workflow audit should reject ordinary bench USB,
noncanonical OTA writers, or a claimed rollback without artifact selection. A
successful normal health snapshot must not replace probation or stress evidence.

## R2 — A downgrade is permitted without the explicit option

**Where:** [`trigger-ota-wait.sh`, lines 119–145][ota-helper].

The script documents `--allow-downgrade` as an opt-in, but adds `downgrade=1` when
either that option is supplied **or the device reports that the offer is older**.
The ordinary invocation consequently authorizes a downgrade on the user's behalf.

**Reproduction:** With installed version `1.0.1`, offered version `1.0.0`,
`update_available=false`, `downgrade=true`, and no downgrade option, the original
script issued one mock POST containing `version=1.0.0&...&downgrade=1` and exited
zero after the mock returned a valid image. No real request was sent.

**Impact:** A stale or deliberately older feed can be installed by a caller that
requested an ordinary update. This is a caller-policy defect; the device receives
an explicit downgrade permission and therefore cannot infer that it was omitted
by the person invoking the helper.

**Correction:** Reject an older offer unless the option was explicitly supplied.
Retain the firmware's generation, channel, version and digest checks.

**Regression proof:** Without the option, an older offer must cause a nonzero exit
and zero update requests. The explicitly permitted case must still bind the exact
offered artifact.

## R3 — Expected-version validation happens after the write

**Where:** [`trigger-ota-wait.sh`, lines 114–151 and 234–236][ota-helper].

The available version is checked against `--expected-version` before the write
only inside the branch where neither an update nor a downgrade is available.
When `update_available=true`, the helper proceeds with the offered version and
checks the requested version after the update.

**Reproduction:** Installed `1.0.1`, offered `1.0.2`, and
`--expected-version 1.0.3` caused one mock POST selecting `1.0.2`. The script later
exited one because the returned version was not `1.0.3`.

**Impact:** A final failure correctly reports the mismatch but does not prevent
the unintended write. The firmware's request binding protects the offered
artifact, not the user's different expected version.

**Correction:** Validate the requested version against the checked offer before
the first write. For an acceptance workflow, also bind source/build identity and
digest rather than relying on a display version alone.

**Regression proof:** An offered/requested mismatch must produce zero update
requests, including when the device reports an available upgrade or downgrade.

## R4 — OTA can report success without the new image or completed probation

**Where:** [`trigger-ota-wait.sh`, lines 157–158, 201–253][ota-helper];
[`deploy-prod`, lines 77–96][deploy-prod].

The helper reads the accepted operation generation but never uses it to bind the
subsequent progress observations. A `state=done` observation is treated as a reboot
boundary, and the next reachable `/status` is accepted without comparing uptime
or a boot identifier. Unless the caller supplied `--expected-version`, the
returned version is not compared with the selected offer.

The final check reads `rollback_pending` but never rejects `true`. It rejects
only image states `aborted` and `invalid`; an empty or `pending_verify` image state
can pass. A failed final fetch falls back to an empty JSON object. The five-second
delay is not proof that the image completed its health gate.

**Reproduction:** After accepting an update from `1.0.1` to `1.0.2`, the mock
reported `done`, then returned the old `1.0.1` with unchanged uptime. All three
final observations produced exit zero and a success message:

- an empty final OTA status object;
- `image_state=pending_verify` and `rollback_pending=true`;
- a valid-image response for the still-running old version.

The third case is especially relevant to rollback: a valid old image does not
prove the candidate survived. The first two cases were executed directly; the
third was also executed with the same script and a valid old-image fixture.

**Impact:** Automation can advance from bench to production after a false
successful acceptance. The production recipe does not provide an expected version
to either update invocation.

**Correction:** Bind progress to the accepted generation, require actual boot
transition evidence, require the selected candidate identity after reboot, and
require an explicit valid image with no rollback pending. Missing or malformed
final evidence must fail. Use the canonical gate's full probation/stress chain.

**Regression proof:** Old-version recovery, no reboot, foreign generations,
pending verification and missing final status must all fail acceptance.

## R5 — The health helper turns missing evidence into a green result

**Where:** [`verify-device-health.sh`, lines 135–166 and 199–205][health-helper];
[`deploy-test`, lines 68–74][deploy-test].

Absent `last_crash.fault` and `sys.safe_mode` become `false`. Absent heap fields
become zero. The largest-block check only warns for a positive value below 10,000
bytes and never increments the failure count. A missing or zero largest block
therefore receives less attention than a small positive one. The calling skill
nevertheless says sufficient contiguous headroom is asserted.

An explicit `last_crash: null` is valid on a clean boot; validation must distinguish
that documented state from an omitted field or malformed crash object.

**Reproduction:** The only status response was:

```json
{"version":"1.0.1","wifi":{"connected":true},"mqtt":{"connected":true}}
```

The original helper exited zero and printed `HEALTHY (GREEN)`, despite receiving
no crash record, safe-mode state, heap measurement, uptime or ELF identity.
The default bench mode was used, so absence of a physical X10A connection was
intentionally not a failure in this fixture.

**Impact:** Incomplete or incompatible API output is accepted as positive health
evidence. Even a supplied critically small largest block only generates a warning.
The production recipe additionally omits the optional expected-version and
expected-ELF arguments, so its success cannot establish those identities.

**Correction:** Require correctly typed mandatory fields, distinguish intentional
source absence from missing status evidence, and make the applicable headroom
threshold a real acceptance condition. Keep bench and production requirements
explicit. Use the canonical gate for deployment acceptance.

**Regression proof:** Omitted/null/wrongly typed mandatory health fields, zero
headroom and headroom below the applicable minimum must not return green.

## R6 — A concurrent settings save loses detected-model validity

**Where:** [`config.cpp`, lines 405–420][config];
[`http_config.cpp`, lines 1222–1226][http-config];
[`hp_poll.cpp`, line 818][poll];
[`http_status.cpp`, lines 1437 and 1684–1694][status].

When an HTTP settings snapshot has an older runtime revision, `config_save`
carries forward the newly detected profile, pins, protocol, identity and
fingerprint fields. It omits `fp_valid`. A snapshot taken while that flag was
false can therefore overwrite the true flag from a successful detection commit.

**Reproduction using the actual production functions:**

1. Load a synthetic initial configuration with `profile=auto` and `fp_valid=false`.
2. Take the HTTP snapshot and change its OTA channel.
3. Commit the detected link, then the detected model; verify `fp_valid=true`.
4. Save the earlier HTTP snapshot with both NVS adapters returning success.
5. Observe `profile=altherma3_r_erga`, capacity `60` tenths and the new channel,
   but `fp_valid=0`.

The no-reboot language route provides a concrete production trigger for the same
snapshot/save ordering. The sequential harness controls that ordering; it does
not claim to measure its likelihood under real scheduling.

**Impact:** Detection metadata and refrigerant-service evidence disappear from
`/status` even though polling retains a concrete detected profile. Ordinary
polling does not repair the flag because detection starts only for `profile=auto`.
An explicitly requested re-detection or reboot can recover it.

The comment in [`config_model.hpp`, lines 240–244][config-model] also still calls
the opposite-direction overwrite intentionally open and self-correcting. That
description disagrees with the revision reconciliation now implemented and with
this unrepaired state.

**Correction:** Preserve the complete detection-owned state, including validity,
under the existing revision/ownership rule. Update the stale ownership comment.

**Regression proof:** Execute both save-before-detection and detection-before-save
orders with the production reconciliation, including the fingerprint validity
flag. The existing runtime adapter scenario passes but does not establish this
missing field's behavior in `config.cpp`.

## R7 — MQTT reference decoding leaks JSON on an allocation failure

**Where:** [`mqtt_ha.cpp`, lines 1554, 1614–1625 and 2696–2714][mqtt];
[`reference_temperature.hpp`, lines 357–359][reference-temperature].

`decode_reference_frame` owns its parsed tree through a raw `cJSON*`. It assigns
the optional HVAC text into `out.hvac_mode` before deleting the tree. If that
string allocation throws, the MQTT task's exception handler skips the cycle but
has no ownership through which to release the tree.

**Concrete triggering input:** On the configured temperature topic, use a valid
temperature mapping, a fixed setpoint, no timestamp mapping, and a mapped
16-character HVAC field, for example
`{"temperature":21,"hvac":"abcdefghijklmnop"}`. The decoder permits strings up
to 16 characters; the later semantic check that the mode is `heat` has not yet
run. A 16-character string exceeds the ESP32 libstdc++ small-string capacity of
15, so allocation failure after a successful parse reaches the leak.

**Impact:** The cycle is skipped and the parsed tree remains allocated. Repetition
can aggravate heap pressure. The catch prevents a direct uncaught-exception
reboot; a later watchdog reaction is a possible consequence, not an observed
incident from this review.

**Evidence boundary:** The production allocation/cleanup/catch path was independently
reviewed. No MQTT fault injection or hardware reproduction was performed. A host
test using a different standard library must not assume the same small-string
capacity.

**Correction:** Acquire RAII ownership immediately after parsing, as the HTTP
configuration paths already do with `JsonGuard`.

**Regression proof:** Inject failure at the HVAC string allocation after a
successful parse and verify all cJSON allocations are released, the last accepted
sample is retained, and the task continues at its normal cadence.

## R8 — The reduced OTA diagnostic dump omits the latest messages

**Where:** [`http_status.cpp`, lines 2259–2275][status];
[`diag_log.cpp`, lines 77–86][diag].

During an active OTA network operation, `/diag` requests at most 512 bytes from a 6,144-byte
ring. `diag_dump` returns the oldest bytes first. Once the ring contains more than
512 bytes, the newest messages are excluded from this response. Before the first
wrap, repeated requests can show the same old prefix while new events arrive.

**Reproduction:** The actual `diag_log.cpp` wrote 30 older synthetic records and
a final `LATEST_OTA_ERROR_MARKER`. A 512-byte dump omitted the marker; the full
ring contained it. This proves truncation direction with production code, not
behavior under real TCP or TLS load.

**Impact:** The diagnostic endpoint intentionally kept available during OTA hides
the current update/heap evidence that makes it useful. The full ring may still be
retrievable later, and independent syslog may still contain the event; neither
changes what the active-OTA endpoint returns.

**Correction:** Preserve the small response budget but return the newest bounded
tail, preferably starting at a complete line, and make truncation explicit.

**Regression proof:** Exercise both wrapped and unwrapped rings larger than the
response budget and assert that the latest complete record remains visible.

## Already corrected between the reviewed revisions

The initial `9ca8a073` inspection found raw cJSON ownership across allocating HTTP
configuration paths. Commit `2e8cfc0a` introduced `JsonGuard`; the current parser
paths use it. This earlier HTTP leak is **not** an open finding in this report.
R7 is the separate MQTT parser that did not receive the same ownership change.

Other earlier candidates were not carried forward without a current production
path. Large static asset transfers during OTA remain a useful hardware stress
case, but no additional confirmed defect is claimed for them here.

## Verification at the reviewed revision

The following results are local and apply to `446be181`. No result is a claim
about production deployment or CI on a future report commit.

| Check | Result and coverage boundary |
| --- | --- |
| `scripts/run-mock-tests.sh --coverage` | Passed; 7,036/7,280 executable lines across 89 production headers, 96.65%; 88 branch-bearing headers matched the local compiler profile. Presenter parity and 26 installer/serial tests also passed. |
| `scripts/run-sanitizer-fuzz-tests.sh` | Passed 48,863 invariant checks under UBSan. The local ASan runtime probe failed; ASan was not established by this run. |
| `scripts/run-runtime-integration-tests.sh` | Ten scenarios passed; four mutation checks were detected. These use host adapters, not ESP-IDF runtime glue. |
| `scripts/run-contract-tests.sh` | Fifteen source-boundary suites and the public-readiness audit passed. |
| `scripts/run-domain-audit.sh` | Clean: 45 profiles, 4,292 rows against 20 enum and 220 register specification rows. Does not establish unmeasured model-specific physical behavior. |
| `scripts/run-ui-use-case-tests.sh` | Passed, including its mutation selftest. |
| `scripts/run-browser-render-tests.sh` | Passed in Chrome 152.0.7977.83, all 13 locales at phone and desktop widths; includes layout, native accessibility, keyboard, history, reduced-motion and negative checks. Uses synthetic device responses. |
| `tools/absence/selftest.sh` | All seeded source-absence defects were detected. |
| Description, user-docs, diagnostic-evidence, schematic, localization, redaction, GIF, doc-entity, ESP-IDF matrix and agent-instruction audits | All normal audit entry points passed. These results coexist with the semantic discrepancies above. |
| `scripts/run-format-check.sh` | Portable whole-tree checks passed. Exact clang-format 18 was unavailable locally, so that layer was skipped by the runner. |
| `scripts/idf-docker.sh idf.py build` | ESP32-S3 compilation passed with repository-pinned ESP-IDF 6.1. The application was not signed. |
| `scripts/idf-docker.sh python scripts/check-stack-budget.py --elf build/daikin-altherma-esp32.elf` | Reviewed static symbol/path budgets passed against that ELF. This does not measure a running task's stack high-water mark. |

The build reports an application image size of `0x1e0000` against a smallest
application partition of `0x1f0000`, leaving `0x10000` bytes (64 KiB; reported as
3%). This is build-growth headroom, not a current overflow and not a runtime heap
measurement. Do not infer signing or flash acceptance from this unsigned build.

The source, adapter and browser gates are valuable but do not exercise every
production interleaving, every allocation-failure path or the newly added helper
scripts' acceptance decisions. The coexistence of green gates and the reproduced
findings identifies those specific coverage gaps; it does not invalidate the
behavior the existing gates actually exercise.

## Suggested order of follow-up

1. Reconcile the deployment recipes with the canonical transaction; close R2–R5
   before treating the alternate helpers as deployment acceptance tools.
2. Correct the configuration ownership omission and MQTT JSON ownership, with
   focused scheduling and allocation-failure tests.
3. Preserve recent diagnostic evidence under the existing OTA response budget.
4. Validate the changed acceptance paths on explicitly authorized bench hardware,
   then follow the separately authorized production chain.

[source]: https://github.com/0Bu/daikin-altherma-esp32/tree/446be181c6bd9042784dcfc212296569d7961012
[ota-policy]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/AGENTS.md#L156-L164
[deploy-prod]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/.agents/skills/deploy-prod/SKILL.md
[deploy-test]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/.agents/skills/deploy-test/SKILL.md
[ota-helper]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/scripts/trigger-ota-wait.sh
[health-helper]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/scripts/verify-device-health.sh
[config]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/config.cpp#L405-L420
[http-config]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/http_config.cpp#L1212-L1228
[poll]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/hp_poll.cpp#L818
[status]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/http_status.cpp
[config-model]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/logic/config_model.hpp#L240-L244
[mqtt]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/mqtt_ha.cpp#L1540-L1628
[reference-temperature]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/logic/reference_temperature.hpp#L357-L359
[diag]: https://github.com/0Bu/daikin-altherma-esp32/blob/446be181c6bd9042784dcfc212296569d7961012/main/diag_log.cpp#L77-L86
