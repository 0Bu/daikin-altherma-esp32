# Project review — 13 September 2026

> **Status:** Actionable findings P1, P2, P3, and P5 are implemented:
> - **P1 (resolved):** Local profiles now bind platform/packaging slugs (`tools/coverage/profile.sh`, `scripts/run-mock-tests.sh`, `tools/coverage/branch_baseline.json`). Stock Ubuntu 24.04 GCC 13.3.0 resolves to `gcc-13-linux-ubuntu24` with its verified 80/100 outcome count; Darwin resolves to `clang-17-darwin` or `gcc-13-darwin`; unreviewed distributions fail closed.
> - **P2 (resolved):** Added a status block to [`docs/reviews/2026-09-12-code-audit.md`][prior-review] clarifying that all findings R1–R8 were resolved in commit `c764905` (PR #99).
> - **P3 (resolved):** `scripts/run-sanitizer-fuzz-tests.sh` now retries alternative compilers (e.g. `g++`) before degrading to UBSan or failing.
> - **P5 (resolved):** Legacy per-key NVS names (`wifi_ssid`, `wifi_pass`, `wifi_ssid_back`, `wifi_pass_back`, `wifi_rollback`, `wifi_rolledbk`, `mqtt_uri`, `mqtt_user`, `mqtt_pass`, `syslog_host`, `syslog_port`, `ntp_server`, `board_set`, `rx_pin`, `tx_pin`, `proto`) are documented in [`docs/ARCHITECTURE.md`][arch-doc].
> - **P4, P6:** Preserved as standing architectural observations.

A whole-project `$project-review` pass over source revision
[`57337de57de0`][source] (`main`). This is not a diff review: the reviewed branch is
byte-identical to `origin/main`, so the subject is the project as it currently stands —
architecture, memory and concurrency discipline, the gate suite, security posture,
documentation consistency, CI/CD and dependency handling.

The review is read-only with respect to firmware, tooling and workflows. It records findings
and proposed corrections; it implements none of them. The only file this review adds is this
document and its index entry.

## Summary

The firmware itself is in good shape. Every finding below is in the **verification and
documentation apparatus**, not in the code that runs on the board: a coverage-gate profile that
fails for contributors on Linux, a sanitizer gate with no compiler fallback, a review document
that contradicts the commit it shipped in, and an undocumented set of legacy NVS key names.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| P1 | P1 | The coverage gate fails on stock Linux GCC 13 for a profile reason, not a coverage reason | Two local runs, profile comparison |
| P2 | P2 | The 12 September review document states findings are open that the same commit fixed | Commit contents and source trace |
| P3 | P2 | The sanitizer gate has no compiler fallback and fails where a working toolchain exists | Two local runs |
| P4 | P2 | Line-coverage headroom above the hard floor is down to 0.26 percentage points | Coverage runs at two revisions |
| P5 | P3 | Legacy per-key NVS names are not enumerated in any document | Source trace and document search |
| P6 | P3 | Verification and governance code outweighs firmware code by roughly 1.7 to 1 | Line counts |

Priorities express corrective urgency, not measured incident frequency. P1 blocks a documented
developer workflow; P2 degrades correctness of the record or of a gate; P3 is a maintenance
observation.

## Gate results at the reviewed revision

Twenty-six repository gate entry points were run. Twenty-four passed.

| Result | Gates |
| --- | --- |
| Passed (24) | mock tests, runtime integration, format, contract, domain, description, user-docs, schematic, UI localization, UI use-case, redaction, PR hygiene, UI GIF, doc-entity, ESP-IDF matrix, public readiness, agent-instruction budget, diagnostic evidence, web-installer plan, publish-version, CI/release contract, pages-publish, decode-coredump, presenter parity |
| Failed for an environment reason (1) | `run-sanitizer-fuzz-tests.sh` — see P3; passes with `CXX=g++` |
| Not runnable standalone (1) | `run-agent-policy.sh` — requires CI-supplied PR inputs and fails closed by design, which is correct behaviour, not a defect |

Representative outputs: 45 catalog profiles and 4,292 rows clean; 16 source-boundary contract
suites plus the public-readiness audit passed; `/status` redacts 27 fields and `redact.hpp`
declares and names exactly 27; 13 UI catalogs × 867 keys with lazy assets bounded and routed;
40 hit targets / 21 pills / 46 pipe segments / 46 labels in the schematic against 40 INSPECT
entries and 194 catalog labels; ESP-IDF matrix 23 used / 25 evaluated / 24 explicit components /
5 managed dependencies / 49 sdkconfig assignments / 50 IDF headers; agent-instruction budget
19,930 of 24,576 bytes.

The host suite carries 4,573 `CHECK` assertions in `test/test_logic.cpp`. Property tests run
48,863 invariant checks under ASan+UBSan once a working sanitizer runtime is selected.

---

## P1 — The coverage gate fails on stock Linux GCC 13 for a profile reason

**Where:** [`tools/coverage/profile.sh`][profile], [`tools/coverage/branch_baseline.json`][baseline],
[`scripts/run-mock-tests.sh`][mock].

`scripts/run-mock-tests.sh --coverage` is listed in
[`AGENTS.md`](../../AGENTS.md) as a canonical build-and-gate entry point. On Ubuntu 24.04 with
the distribution GCC 13.3.0, outside GitHub Actions, it fails:

```
logic line coverage: 95.26% (6867/7209 across 90 files; minimum 95.00%)
logic branch coverage: per-file outcome ratchet regressed:
  main/logic/ha_device.hpp: 80/100 (80.00%), expected 82/100 (82.00%)
```

This is not a coverage regression. `coverage_branch_profile()` keys a local profile on compiler
family and major only (`gcc-13`), while an authoritative CI profile additionally binds runner OS
and image (`gcc-13-github-linux-ubuntu24`). The baseline holds both, and they differ in exactly
one file:

| Profile | `main/logic/ha_device.hpp` |
| --- | --- |
| `gcc-13` | `{"outcomes": 100, "taken": 82}` |
| `gcc-13-github-linux-ubuntu24` | `{"outcomes": 100, "taken": 80}` |
| `clang-17` | `{"outcomes": 88, "taken": 71}` |

The baseline's own `method` field records that its numbers were measured "with Apple Clang 17.0.0
and GCC 13.3.0" — that GCC 13.3.0 is a different packaging from the Ubuntu one, and it
instruments this header with two more taken outcomes. A Linux contributor running the documented
command lands on the `gcc-13` profile and measures the value the *GitHub* profile expects.

**Reproduction:** two runs of the same tree in the same container.

| Selected profile | Result |
| --- | --- |
| `gcc-13` (default locally) | Fails: `ha_device.hpp: 80/100, expected 82/100` |
| `gcc-13-github-linux-ubuntu24` (`GITHUB_ACTIONS=true RUNNER_OS=Linux ImageOS=ubuntu24`) | Passes: `89 files exactly match the versioned compiler profile` |

**Impact.** A canonical gate reports a hard failure that names a specific header, so the first
reading is "I broke coverage". Worse, the `gcc-13` profile is unreachable from CI by
construction — CI always selects the `-github-` variant — so nothing in the pipeline can ever
notice that this profile's numbers have gone stale. The one profile that governs every local
contributor is the one profile no automated run verifies.

**Correction.** Preferred: give local profiles the same fail-closed binding the GitHub profiles
already have (append an OS/libc slug), so an unreviewed local toolchain selects a missing profile
and says so, instead of silently borrowing a superficially compatible baseline — which is the
stated intent in `profile.sh`'s own header comment. Alternative: record the stock GCC 13.3.0
value under `gcc-13` and give the maintainer's toolchain its own key. A third option — downgrade
a local profile mismatch to a warning and enforce the ratchet only in CI — weakens the gate and
is not recommended.

**Regression proof:** a run under an unreviewed local toolchain must name the missing profile and
fail closed, never compare against another packaging's inventory. A run under a reviewed profile
must still reject a genuine decrease.

## P2 — The 12 September review document contradicts the commit it shipped in

**Where:** [`docs/reviews/2026-09-12-code-audit.md`][prior-review].

The document states, in its opening paragraph, "This document records findings and proposed
corrections; it does not implement them", and closes the findings table with "All findings remain
open in the reviewed source". Both statements are true of the reviewed revision `446be181`. They
are not true of the revision the document lives in.

Commit `c764905` (PR #99), which added the document, has the commit body:

```
* docs: record firmware and deployment review findings
* fix: resolve review findings R1–R8 from code audit
```

and changes `main/config.cpp`, `main/diag_log.cpp`, `main/http_config.cpp`, `main/json_guard.hpp`,
`main/logic/config_model.hpp`, `main/logic/diag_tail.hpp`, `main/mqtt_ha.cpp`,
`scripts/trigger-ota-wait.sh`, `scripts/verify-device-health.sh` and both deployment skills —
the exact surface R1–R8 name.

Spot-checked at the reviewed revision:

| Finding | State at `57337de5` |
| --- | --- |
| R2 (downgrade permitted without the option) | Corrected — `trigger-ota-wait.sh` rejects a downgrade offer unless `--allow-downgrade` was supplied, with an explicit `R2:` comment |
| R7 (MQTT reference parser leaks its JSON tree) | Corrected — both MQTT parse sites hold the tree in `JsonGuard` |
| R8 (reduced OTA dump omits the newest messages) | Corrected — `logic/diag_tail.hpp` exists, is line-aligned and bounded, and is covered by the host suite |

**Impact.** A reader at `main` concludes that eight P1/P2 defects are open, four of them in the
deployment acceptance chain. That is the most consequential shape of documentation drift this
repository has: the record of what is broken is itself wrong, in the safety-critical direction
of overstating risk. It is precisely what `$project-review` checklist item 1 exists to catch,
and the mechanical doc gates cannot see it — none of them compare a prose status claim against
the commit that made it.

**Correction.** Add a status block at the head of the document: the findings were corrected in
`c764905`, and the body remains the finding record for `446be181`. Keep the revision-bound
wording in the body — it is accurate and valuable — but do not let the top of the file read as a
statement about `main`. If the reviewed-versus-fixed distinction is expected to recur, a
`docs/reviews/` convention (a required `Status:` line, or a `resolved/` subtree) is cheaper than
re-deciding it each time.

**Regression proof:** a review document whose findings have been corrected must not read as open
at the revision it is served from.

## P3 — The sanitizer gate has no compiler fallback

**Where:** [`scripts/run-sanitizer-fuzz-tests.sh`][sanitizer].

The script selects `clang++` when present and `g++` otherwise, then probes the ASan runtime. The
probe correctly tests the runtime rather than the OS or compiler name. What it does not do is
reconsider the *compiler* when that probe fails.

On a machine carrying clang 18 without `compiler-rt`, the ASan compile fails, the script degrades
to UBSan-only, and the UBSan compile fails for the same missing-runtime reason — so the gate exits
non-zero even though a fully working `g++` with both sanitizers is installed alongside:

```
/usr/bin/ld: cannot find .../libclang_rt.asan-x86_64.a: No such file or directory
sanitizer-fuzz: ASan runtime unavailable; running UBSan locally (CI requires ASan+UBSan)
/usr/bin/ld: cannot find .../libclang_rt.ubsan_standalone-x86_64.a: No such file or directory
```

**Reproduction:** default invocation fails; `CXX=g++ scripts/run-sanitizer-fuzz-tests.sh` passes
with `sanitizer-fuzz: ASan+UBSan runtime capability confirmed` and
`sanitizer/property tests passed: 48863 invariant checks`.

**Impact.** The stronger check (ASan+UBSan) is available and is skipped; the weaker fallback is
attempted and also fails; the contributor sees a red gate with a linker error and no indication
that another installed compiler would work. The failure mode is the opposite of the one the
existing runtime probe was written to avoid.

**Correction.** On a failed ASan probe, retry the probe with the other available compiler before
degrading, and only fall back to UBSan-only when no toolchain on the machine has a working
sanitizer runtime. Keep the CI branch unchanged: CI must still require ASan+UBSan.

**Regression proof:** with a broken clang runtime and a working GCC one present, the gate must run
the full ASan+UBSan suite rather than fail or degrade.

## P4 — Line-coverage headroom is down to 0.26 percentage points

**Where:** [`scripts/run-mock-tests.sh`][mock] (`--minimum 95`).

Measured in one environment across two revisions, so the numbers are comparable:

| Revision | Line coverage | Files |
| --- | --- | --- |
| `446be181` | 95.22% (6,816 / 7,158) | 89 |
| `57337de5` (reviewed) | 95.26% (6,867 / 7,209) | 90 |

This is not a regression — coverage rose marginally and one header was added. It is a standing
margin observation: 0.26 percentage points above a hard floor of 95.00% is roughly nineteen lines.
The next logic header that lands with partial coverage trips the floor, and it will do so in a
commit that has nothing to do with the header that actually eroded the margin.

Note that the 12 September document reports 96.65% at `446be181`. That figure was measured on a
different compiler and gcov packaging and is not comparable to these two; the table above is.

**Correction.** A deliberate decision rather than a fix: either close the gap and raise the floor
so the ratchet keeps its meaning, or record explicitly that 95% is a floor the project intends to
sit near. The branch ratchet already provides per-file protection, so the aggregate floor is the
weaker of the two mechanisms and the one currently under pressure.

## P5 — Legacy per-key NVS names are not enumerated in any document

**Where:** [`main/config.cpp`][config] (legacy fallback path),
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/README.md`](../README.md).

`config_load()` falls back to a legacy per-key NVS layout when the atomic blob is absent or fails
CRC. The keys read on that path are `wifi_ssid`, `wifi_pass`, `wifi_ssid_back`, `wifi_pass_back`,
`mqtt_uri`, `mqtt_user`, `mqtt_pass`, `ntp_server`, `syslog_host` and `proto`.

`ARCHITECTURE.md` describes the mechanism ("falling back to each domain's legacy per-key values
when its blob is absent or invalid") but names none of the key strings. `mqtt_user` and
`mqtt_pass` appear in neither `ARCHITECTURE.md` nor `README.md`; the `wifi_*` names appear only in
`README.md`.

**Impact.** Low today, but `AGENTS.md` names NVS keys as a doc-drift surface for exactly this
reason, and `partitions.csv` warns that moving or resizing NVS "can silently wipe deployed
configuration". A future migration reasoning about what an old image left in the `daik_cfg`
namespace has no documented list to check against — only the fallback branch in `config.cpp`.

**Correction.** Enumerate the legacy key names in the `config.cpp` entry of the
`ARCHITECTURE.md` component map, next to the blob description that already lives there. This is
reference material, which is where `AGENTS.md` says it belongs.

## P6 — Verification and governance code outweighs firmware code

Line counts at the reviewed revision:

| Area | Lines | Files |
| --- | --- | --- |
| `main/` firmware C++ (excluding `def/`, `www/`) | 41,827 | 161 |
| — of which `main/logic/` (IDF-free, host-tested) | 18,423 | 91 |
| `main/def/` (generated profiles) | 4,940 | 50 |
| `main/www/` (web UI) | 28,517 | 26 |
| `test/` | 34,563 | 55 |
| `tools/` | 24,274 | 68 |
| `scripts/` | 14,072 | 53 |
| `docs/` | 14,006 | 20 |
| `.agents/` + `.codex/` | 2,293 | 26 |
| `.github/` | 1,874 | 10 |

Verification and tooling (`test/` + `tools/` + `scripts/`) total 72,909 lines against 41,827 lines
of firmware — a ratio of about 1.7 to 1, before counting 14,006 lines of documentation and the
11,677 comment lines inside the firmware itself (27% of `main/`). There are 26 gate entry points,
17 canonical skills and 91 pure-logic headers.

This is stated as an observation, not a defect. The discipline is why the firmware review below
found nothing: the invariants that matter are enforced mechanically. But it is also where this
review's entire finding list comes from — P1 and P3 are gate-infrastructure bugs, and P2 is a
record-keeping bug. The apparatus is now the larger of the two systems and has no apparatus of
its own. The self-tests ("still has teeth" mutation checks) partially cover this, and P1 is a
concrete example of what they do not: a baseline profile CI structurally cannot reach.

No correction is proposed. The question worth an explicit answer is whether the gate count has a
ceiling, and what evidence would justify retiring one.

---

## What the review found in good order

- **No `TODO`, `FIXME`, `HACK`, `XXX` or `WORKAROUND` markers** anywhere in `main/`, `tools/`,
  `scripts/` or `test/`.
- **Memory and concurrency discipline holds.** One shared unwind-safe RAII mutex guard
  (`main/rtos_guard.hpp`); the remaining raw `xSemaphoreTake` sites are binary-semaphore signalling
  or the deliberately paired `config_lock`/`config_unlock`, not unguarded mutex sections. The three
  task loops without a `try`/`catch` (`captive_dns`, `wifi_wd`, `env3`) were checked individually
  and are non-allocating in the loop body — fixed stack buffers, critical sections and string
  literals — which is what `AGENTS.md` actually requires.
- **The HTTP OOM boundary is central and complete.** Every route registers through
  `http_register()`, which installs the `handle_all` trampoline; `std::bad_alloc` becomes 503 and
  any other exception becomes 500, so nothing unwinds through `esp_http_server`'s C frames.
  `cfg.max_uri_handlers = 39` matches the live registration count exactly (verified with the
  formula in the file's own comment), and a failed registration is now reported rather than
  discarded.
- **`ota_busy()` cannot wedge the POST surface.** `s_busy` is cleared outside the `try`, on every
  path including both catch branches, so a failed update cannot leave the device permanently
  refusing configuration POSTs.
- **Supply chain and CI trust boundaries are sound.** Every `uses:` in every workflow is pinned to
  a 40-character SHA; workflow and job permissions are least-privilege; `pr-policy.yml` is the only
  `pull_request_target` workflow and checks out the base SHA into a separate path with
  `persist-credentials: false`, never the PR tree. The `OTA_SIGNING_KEY` secret is materialized only
  inside the read-only-token trusted-main job, the `contents: write` publisher never receives it,
  and the artifact upload paths are explicitly enumerated so the transient `.pem` cannot ride along.
  Renovate automerges exactly one dependency (its own runner Action) and firmware dependencies stay
  manual by rule.
- **The web UI escaping discipline is consistent.** A single `esc()` helper; no `eval`,
  `new Function` or `document.write`; no single-quoted attribute interpolation anywhere (which is
  what makes `esc()` not escaping `'` safe); the attribute interpolations that skip `esc()` carry
  internal class names and integer-filtered values, not device strings.
- **The code survives aggressive optional warnings.** Compiling the host suite with
  `-Wconversion -Wsign-conversion -Wshadow -Wnull-dereference -Wduplicated-cond
  -Wduplicated-branches -Wlogical-op -Wold-style-cast` produces 39 diagnostics, all traced and all
  deliberate: `for (const unsigned char c : string_view)` (the correct pattern, not the unsafe one),
  and the QMP6988 calibration arithmetic, which was checked by hand against the 16-bit input range
  and cannot overflow `int32_t` on the 32-bit target. One `strcpy` exists, into a 33-byte SSID
  field from a 27-character literal.
- **Repository state is clean.** No open pull requests; one open issue, the Renovate dependency
  dashboard.

## Verification boundaries

Stated explicitly, because green gates do not prove these:

- **No firmware build was performed.** The Docker daemon is unavailable in this environment
  (`/var/run/docker.sock` absent), so `scripts/idf-docker.sh idf.py build` could not run. This
  review therefore carries **no** compile, image-size, stack-budget, signing or flash-acceptance
  evidence. The image-size headroom noted in the 12 September document (`0x1e0000` against an
  `0x1f0000` slot, 64 KiB) is that document's measurement, not this one's, and remains worth
  tracking.
- **No hardware was contacted.** No board, heat pump, MQTT broker, HomeHub, syslog collector or
  weather provider. No OTA, no flash, no coredump clear, no live configuration change.
- **No GitHub state was mutated** beyond reading pull request and issue lists.
- Host gates prove decode, configuration, discovery, publishing and script control flow. They do
  not prove physical X10A behaviour, browser flashing, WiFi/MQTT behaviour under load, OTA
  probation, persistence across power loss, or rendered UI truth. Per-model profile correctness
  under `main/def/` is mechanically consistent with `docs/REGISTERS.md`; that is catalog
  consistency, not a measurement on an unowned model.
- `run-agent-policy.sh` was invoked without the CI-supplied PR inputs it requires and refused, as
  designed. Its behaviour under real inputs was not exercised here.

## Suggested order of follow-up

1. Fix the coverage profile binding (P1). It blocks a documented command for every Linux
   contributor and is invisible to CI.
2. Correct the status of the 12 September document (P2). It is a one-paragraph change and it stops
   the project's own record from overstating open risk.
3. Give the sanitizer gate a compiler fallback (P3).
4. Decide the coverage-floor question (P4) and document the legacy NVS keys (P5) whenever the
   surrounding files are next touched.
5. Answer the apparatus question (P6) deliberately rather than incrementally.

[source]: https://github.com/0Bu/daikin-altherma-esp32/tree/57337de57de0
[profile]: https://github.com/0Bu/daikin-altherma-esp32/blob/57337de57de0/tools/coverage/profile.sh
[baseline]: https://github.com/0Bu/daikin-altherma-esp32/blob/57337de57de0/tools/coverage/branch_baseline.json
[mock]: https://github.com/0Bu/daikin-altherma-esp32/blob/57337de57de0/scripts/run-mock-tests.sh
[sanitizer]: https://github.com/0Bu/daikin-altherma-esp32/blob/57337de57de0/scripts/run-sanitizer-fuzz-tests.sh
[prior-review]: 2026-09-12-code-audit.md
[config]: https://github.com/0Bu/daikin-altherma-esp32/blob/57337de57de0/main/config.cpp
[arch-doc]: ../ARCHITECTURE.md
