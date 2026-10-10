# daikin-altherma-esp32 agent instructions

This repository contains ESP-IDF 6.x firmware for ESP32-S3 boards. It reads a Daikin Altherma heat
pump over the X10A service port and publishes observations to Home Assistant through MQTT. An
optional Daikin HomeHub connection is read-only Modbus TCP and remains an independent source.

These instructions are the always-loaded safety and collaboration contract. Keep narrative,
measurements, incident history, and field-by-field reference material in the linked documents.

## Authorization boundary

- Treat requests to inspect, analyze, diagnose, review, or report as read-only. Do not edit files,
  change GitHub state, merge, publish, flash, deploy, clear a coredump, or mutate a live device unless
  the user explicitly requested that action.
- A request to implement or fix authorizes scoped repository edits and proportionate verification,
  but does not automatically authorize a commit, push, PR, merge, release, OTA, USB flash, or live
  configuration change.
- A request to merge, deploy, OTA, or flash authorizes only that named delivery chain. Report CI/host
  evidence, binary/signature evidence, device injection, reboot health, API behavior, and rendered UI
  evidence separately; one does not prove another.
- A `$deploy-prod` request's chain includes the `$deploy-test` pre-merge bench test of its PR head
  and its failure loop: fix or revert branches, commits, pushes and PRs, their reviews and merges,
  the `$deploy-test` test of every fix head, and the roll-forward delivery to bench and production.
- An explicit `$deploy-test` or `$flash-esp32` request, and a `$deploy-test` run inside a
  `$deploy-prod` chain, authorizes the unchained key-by-path signing command and the unchanged
  repository flash plan described below.
- A standalone `$deploy-test` authorizes scoped fixes and host checks, but commits require separate
  explicit authorization. Repeat hardware testing only after an authorized clean fix head exists;
  the inherited `$deploy-prod` chain already authorizes its fix commits.
- Never contact or modify an unrelated device, repository, cluster, or production system. Preserve
  user-owned dirty worktree changes and secrets.

## Multi-agent operating model

- Use subagents for concrete independent work that benefits from parallelism: code exploration,
  focused review, test-log analysis, documentation comparison, and other read-heavy tasks.
- The root agent owns requirements, task decomposition, write ownership, integration, final
  verification, and the user-facing result. Wait for every required subagent and reconcile conflicts
  before concluding.
- Give each subagent a bounded deliverable and explicit path ownership. Do not let two agents edit
  overlapping files concurrently. Prefer one writer for a change set; reviewers stay read-only.
- Before and after delegated work, inspect `git status` and the relevant diff. Existing changes belong
  to the user unless provenance proves otherwise. Never reset, discard, overwrite, or reformat
  unrelated work.
- Subagents must not commit, push, open or edit PRs/issues, merge, release, flash, deploy, or change a
  live device unless the user explicitly requested that action and the root agent delegated that
  exact step.
- Keep concurrent subagent work within the project limit of three concurrent subagents. Parallelize
  independent reads; serialize hardware access, GitHub mutations, shared build trees, and writes.
- Available focused project reviewers are `doc_drift_checker`, `heap_safety_reviewer`, and
  `x10a_decode_reviewer` under `.agents/agents/`. They are read-only evidence gatherers, not fixers.
- Verify their effective permissions. Native roles can inherit a writable parent's sandbox despite
  their profile declaration; use `scripts/run-codex-review.sh` for an isolated read-only review.
  A writable reviewer context is incomplete review, not a sandbox pass.
- Give reviewers the base SHA, head SHA, path scope and intended local changes. They must verify
  the head and report committed, staged, unstaged and untracked evidence separately. A missing PR
  base means incomplete review, never an unaffected change.

## Canonical skills

Repository skills live under `.agents/skills/` and are invoked as `$skill-name`. Skill activation
does not broaden the authorization boundary above. In particular, an implicitly selected review or
triage skill stays read-only unless the user asked for changes.

Only version-sensitive project workflows belong in that directory. Skills tied to a maintainer's
plant, LAN, observability stack, private inventory, or Mac tooling are user-global skills and must not
be copied into the repository; the exact repository inventory gate rejects additions.

Use the narrowest relevant skill. The checkbox-driven maintainer gates below have matching skills in
that directory except `$heap-safety-review`, which is a gate record only — no such skill exists, and
its evidence comes from the independent read-only `heap_safety_reviewer`. Other entries below are
conditional workflows and are not necessarily PR checkbox gates.

| Skill or review record | Required scope |
|---|---|
| `$project-review`, `$domain-review` | Every local/manual merge and ordinary PR merge; the sole CI-attested Renovate exception is defined in [the runbook](docs/AGENT_MIGRATION.md#operating-rules). |
| `$skill-audit` | Before PR creation or push; verify skills/reviewers against repository facts. |
| `$heap-safety-review` | Before merge of HTTP, MQTT, OTA, TLS, JSON, X10A publishing, polling or allocation changes. |
| `$feature-docs` | Technical feature surface changes. |
| `$schematic-review` | Schematic, contract or schematic-audit changes. |
| `$ui-use-case-review` | User-visible UI behavior or its test/audit surface changes. |
| `$absence-review` | Optional-source lifecycle or presentation changes. |
| `$diagnostic-evidence-review`, `$user-docs-review` | Diagnoses, thresholds, evidence, visible meaning or owner actions change. |
| `$ui-gif` | Mechanical freshness is a hard merge block; GIF/stamp changes also require current-head visual review. Re-record only locally. |
| `$pr-hygiene-review` | Before PR creation and ordinary merge; inspect commit range and PR prose for privacy and non-English text. |
| `$flash-esp32` | Explicitly requested signed build-and-flash. |
| `$deploy-test` | Explicit exact-head pre-merge bench test, signed NVS-preserving USB, health and changed behavior. |
| `$deploy-prod` | Authorized gates, PR merge, CI artifact, bench and production promotion; every fix head re-enters `$deploy-test`. |

The maintained sources are `AGENTS.md`, `.agents/skills/`, `.agents/agents/`, `.agents/hooks.json`,
`tools/agent-hooks/`, and `.mcp.json`. Codex registration under `.codex/` is generated from these
sources; never edit generated adapters or maintain a second policy, skill, reviewer or gate.
Do not add `AGENTS.override.md`; the source gate rejects hidden instruction replacements.
Follow `docs/AGENT_MIGRATION.md` for setup, regeneration, trust review and runtime evidence.
Use `agent/` for project branches: the repository PR wrapper requires this prefix.

## Sources of truth

Read only the references relevant to the task:

- System architecture, component responsibilities, memory measurements, and full HTTP fields:
  `docs/ARCHITECTURE.md`
- X10A protocol: `docs/X10A_PROTOCOL.md`
- Converter IDs, value evidence, and register map: `docs/REGISTERS.md`
- HomeHub Modbus contract: `docs/MODBUS_PROTOCOL.md`
- Platform features, ESP-IDF usage and plant features: `docs/FEATURES.md`,
  `docs/ESP_IDF_MATRIX.md` and `docs/PLANT.md`
- Home Assistant and MQTT identity: `docs/HOME_ASSISTANT.md`
- Read-only firmware MCP surface: `docs/MCP.md`
- Diagnosis meaning and evidence: `docs/DIAGNOSTICS.md` and `docs/DIAGNOSTIC_EVIDENCE.md`
- UI/schematic design contract: `docs/DESIGN.md`
- Security, signing, redaction, and reporting: `docs/SECURITY.md` and `docs/REPORTING.md`
- Boards and wiring: `docs/BOARDS.md` and `docs/WIRING.md`
- Contributor loop, review gates, and merge discipline: `CONTRIBUTING.md`
- Agent setup, delivery details and runtime acceptance: `docs/AGENT_MIGRATION.md`
- Host-test organization: `test/README.md`

If code and prose disagree, trace the production path and report the mismatch. Do not silently make
one source agree with another without establishing which behavior is intended.

Use the full project name `daikin-altherma-esp32` in hostnames, SoftAP names, MQTT base topics,
code, and documentation; do not shorten it to `daikin-altherma`. Other project names belong only in
the README "Scope & credits" attribution when required, not in product code or ordinary project
documentation.

## Environment and verification boundaries

- The firmware target is `esp32s3`. Resolve ESP-IDF through the repository scripts, workflow and
  committed lock; do not substitute an arbitrary local SDK.
- Firmware builds run through `scripts/idf-docker.sh`. A cloud sandbox without Docker cannot prove a
  firmware build. Host logic, Node, and Python gates may still be available.
- Docker on macOS does not provide USB passthrough. Use host `esptool` for an explicitly authorized
  flash. Detect the actual port; never assume a stale `/dev/cu.*` path. Identify the target by its
  MAC (`esptool chip-id`, compared case-insensitively) and require exactly one port whose MAC
  matches. Every esptool connection resets the probed chip, so probe only ports that can be the
  target, and repeat the check immediately before the write.
- The documented boards have different X10A defaults: Seeed XIAO ESP32-S3 uses RX=44/TX=43; M5Stack
  AtomS3 Lite wiring uses RX=1/TX=2 selected in the UI. Do not infer the connected board from build
  success or flash a board selected only by guesswork.
- Green CI proves compilation and deterministic gates, not physical X10A behavior, browser flashing,
  WiFi/MQTT behavior, OTA probation, persistence across power loss, or rendered UI truth. State each
  unverified boundary explicitly.

## Secrets, signing, and destructive hardware actions

- Never read, print, copy, stage, upload, or place in model context any `*.pem`, `*.key`, private
  pairing material, credential dump, or the offline OTA signing key. `.gitignore` is not a security
  boundary.
- For local GitHub CLI access, use `scripts/gh-with-git-credentials.sh`. It resolves the configured
  `github.com` Git credential inside the child process and passes it to `gh` only through a transient
  environment variable. Never read the credential store, run `git credential fill`, or print an
  authentication token directly. CI may provide its own transient `GH_TOKEN` to the same wrapper.
- The only permitted use of the OTA key is an explicitly authorized, unchained `espsecure.py
  sign_data`/`sign-data` invocation that passes the key by path. Do not pipe, redirect, concatenate,
  inspect, or wrap that invocation with unrelated commands.
- This firmware requires a Secure Boot v2-compatible signed application image. An unsigned image
  fails before `app_main` and can crash-loop. Run `scripts/require-signed.sh` before every flash.
- Preserve NVS on ordinary flashes. The repository flash plan (`build/flash_args`) rewrites the
  bootloader, the unchanged partition table, `otadata` and `ota_0`, and skips `nvs` at 0x9000 and
  `coredump`. `erase_flash`, NVS erasure, a partition table that differs from the one the target
  runs, coredump clearing, and destructive recovery require explicit user authorization and a
  backup where applicable.
- Do not change the NVS offset or size in `partitions.csv`. NVS at 0x9000 contains WiFi/MQTT config
  and the X10A link cache; moving or resizing it can silently wipe deployed configuration on the next
  non-OTA reflash. Resolve the exact table and migration impact before any partition edit.
- Never claim flash, OTA, persistence, or rollback success from a build artifact alone. After an
  authorized device update, verify version/signature, reboot reason, rollback/safe-mode state, heap
  and stack health, X10A/Modbus link state, connectivity, and the requested user-visible behavior.
- Every agent-run OTA write must use direct, unchained `scripts/production-ota-gate.py`.
  Ordinary official dev delivery to `bench` uses `--confirm-bench bench --install-bench` and cannot
  contact production. Production promotion uses the distinct `--confirm-production production
  --execute` transaction. Each mode binds the signed artifact and source, permits one un-retried
  target POST, and requires probation and stress; follow the complete runbook.
- Signed, NVS-preserving USB writes to the inventory roles are limited to bootstrap, recovery, and
  the explicitly requested pre-merge test of an exact local head on the bench (`$deploy-test`, or
  `$flash-esp32` naming the bench under the same rules). Production takes USB only for bootstrap and
  recovery. `$flash-esp32` may write a local head to a board outside the inventory that the user
  names. None of these is a delivery of the artifact.
- Direct `/ota/update` writes, including `downgrade=1`, and release creation are outside both modes.
  A faulty production image that passed probation requires a reviewed fix or revert and the same
  bench-first roll-forward chain; failed probation is handled by bootloader rollback.
- Completed validation, positive heap minima, `ota_stack_min_free_bytes`, target probation and
  stress remain mandatory. Production requires bench staging first, a read-only canary and retained
  X10A proof. A failed gate is a stop, never permission to retry or substitute a write.
- Manual `workflow_dispatch` with `release: true` authorizes publication only: one signed build,
  release feed, exact-source tag and GitHub Release, without the mechanical PR suite or board
  contact. Hardware acceptance is a separate authorized chain; see the runbook.

## Build and deterministic gates

Use the repository entry points rather than ad hoc substitutes:

```bash
scripts/run-mock-tests.sh --coverage
scripts/run-sanitizer-fuzz-tests.sh
scripts/run-runtime-integration-tests.sh
scripts/run-format-check.sh
scripts/run-contract-tests.sh
scripts/run-domain-audit.sh
scripts/run-description-audit.sh
scripts/run-user-docs-audit.sh
scripts/run-schematic-audit.sh
scripts/run-ui-localization-audit.sh
scripts/run-ui-use-case-tests.sh
scripts/run-browser-render-tests.sh
scripts/run-redaction-audit.sh
scripts/run-pr-hygiene-audit.sh
scripts/run-skill-audit.sh
scripts/run-ui-gif-audit.sh
scripts/run-doc-entity-audit.sh
scripts/idf-docker.sh idf.py build
```

- Choose checks from the affected surface, then run the complete required gate set before merge.
- A passing test is not proof that a well-formed value is physically true. Pair deterministic gates
  with the applicable human review skill and real-device evidence when requested.
- New decode, formatting, validation, planning, or discovery logic belongs in an IDF-free header
  under `main/logic/` with a focused `CHECK` in `test/test_logic.cpp`.
- Generated per-model profile tables under `main/def/` are machine output from the offline catalog
  pipeline. Do not hand-edit those generated tables; put deliberate corrections in the supported
  override/adjudication layer and test stable identifiers and labels. `overlay.hpp` is the explicit
  hand-written overlay, while `homehub.hpp` and `altherma4.hpp` are curated Modbus definition sources,
  and `protocol_s.hpp` is the curated Protocol S table.
- Do not add separate always-on CI jobs casually. Fast deterministic checks are steps of the shared
  `mechanical_gates` job in `build.yml`; the required `gates` job lives in the deliberately separate
  protected-base `pr-policy.yml` workflow. GitHub Actions bills per job. Preserve required-check
  behavior when changing path filters.
- When waiting for GitHub Actions, use a bounded watcher such as
  `scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 run watch
  <run-id> --exit-status`; do not sleep-poll.

## Data-source and persistence invariants

- X10A, HomeHub Modbus, and ENV III are separate instruments with separate lifecycle, liveness,
  cache, history, and provenance. Never merge them into one synthetic source or use HomeHub as an
  alternative transport for X10A.
- HomeHub Modbus is read-only. No setting or implementation path may enable writes.
- Availability, freshness, held-over state, source identity, and measurement validity are different
  facts. Do not turn missing or stale input into zero, false, a fabricated timestamp, or a plausible
  value. Retained MQTT without source time is not fresh evidence.
- The physical X10A link pins/protocol may persist; detected model identity is re-established each
  boot. Do not persist a model in a way that prevents a swapped unit from being detected.
- Configuration writers commit only fields they own. HTTP handlers own the serialized service blob;
  detection uses narrow link/model setters. A whole-struct write from detection can revert a
  successful concurrent HTTP configuration save.
- Configuration writes are atomic and fallible. Check every result; on failure retain the previous
  valid state, return an explicit error, and do not reboot as if persistence succeeded.
- Diagnosis persistence is proven only after a real reboot or power cycle restores a compatible
  record. Same-boot journal creation or a `collecting` state is not restoration evidence.

## Memory, concurrency, and HTTP safety

- The binding heap limit is the largest contiguous internal block, not aggregate free heap or PSRAM.
  Stream large responses and discovery payloads; avoid building one large temporary `std::string`.
- Every non-trivial HTTP handler that can allocate must keep the established exception boundary and
  return 503 on OOM. An exception unwinding through C frames terminates the process.
- Every allocating FreeRTOS task loop must catch failures around the loop body, log once, keep the
  last good state, delay normally, and continue. Do not turn transient OOM into a reboot loop.
- Never allocate while holding a raw mutex. Stage data outside the critical section, use move/swap,
  or use the repository RAII lock. A thrown allocation with a raw semaphore held wedges all readers.
- Stack is a separate budget. Check every task that calls a shared builder, measure the deepest path
  from the ELF or coredump, and treat less than roughly 1 KiB free as requiring action. Anything that
  grows `/status` also grows every task that builds it.
- The HTTP service is trusted-LAN only by design. The open setup AP exposes provisioning routes only.
  Preserve route-count and surface contracts when adding or removing handlers.

## Diagnostics, privacy, and user truth

- Diagnose from the real persistence, log, device, config, and source path. A UI explanation alone
  is not a root cause.
- For crashes or unreachable devices, use `$device-triage`: snapshot `/status`, `/values`, and
  `/diag`, then use an explicitly available external syslog collector when configured and accessible.
  Do not assume a backend or deployment; current uptime and the RAM ring cannot prove no reboot.
- Read `last_crash.fault` and reset reason before calling an event a crash. Verify a claimed coredump
  by fetching it; never clear it before the requested evidence has been preserved and decoded.
- Device reports must redact at the source using `main/logic/redact.hpp`. Unset fields stay absent or
  empty according to contract; redaction must not invent a configured source. Treat core dumps as
  private raw memory.
- Every visible plant diagnosis needs bounded evidence, explicit limitations, complete UI copy in
  every shipped language, English user documentation, and a safe next step only where the available
  evidence supports one. Distinguish manufacturer facts, project rules, and heuristics.
- Visual truth requires rendered inspection. Mechanical SVG/UI checks do not prove that a sensor is
  drawn on the correct component or that every shipped locale means the same thing.

## PR and merge discipline

- Review the actual diff and current head SHA. A checked box from an older commit is stale.
- Before every local/manual merge, run `$project-review` and `$domain-review`; run conditional skills
  according to the affected paths and behavior. Record only completed reviews against the exact head
  commit. The sole GitHub-native automerge exception is the mechanically attested Renovate
  Action-pin-line-only class defined in [the runbook](docs/AGENT_MIGRATION.md#operating-rules);
  it never applies to firmware dependencies or mixed diffs.
- A PR checkbox is evidence, not authorization. Use only the repository-bound, expected-head REST
  merge path documented in `docs/AGENT_MIGRATION.md`. `gh pr merge`, every other REST merge or
  mutation shape, GraphQL mutations, and all MCP merge, auto-merge, or queue-activation forms are
  intentionally blocked. Static read-only REST GET/HEAD requests and read-only GraphQL queries
  remain allowed.
- Do not let a subagent self-certify its own implementation. Use an independent read-only reviewer
  for high-risk decode, heap, documentation, security, persistence, or UI changes.
- Do not merge while required CI, review findings, requested hardware evidence, or user decisions are
  unresolved. Green CI never overrides a real blocking finding.
- Keep history linear as described in `CONTRIBUTING.md`. Never force-push, rewrite shared history, or
  bypass branch protection unless the user explicitly requested and understood that exact action.
- Report separately what was verified locally, in CI, on hardware, through the API, and visually.
