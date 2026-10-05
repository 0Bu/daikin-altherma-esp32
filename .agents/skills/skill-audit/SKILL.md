---
name: skill-audit
description: Read-only drift audit and self-optimizing validator of every canonical skill under .agents/skills and read-only reviewer in .codex/agents against daikin-altherma-esp32 facts, partitions, endpoints, and hardware. Supports automatic inventory synchronization and self-optimization via scripts/run-skill-audit.sh --optimize.
---

> **Canonical runner-neutral skill.** Read [`AGENTS.md`](../../../AGENTS.md) before acting.
> Project skills are canonical under [`.agents/skills/`](../), and lifecycle/PR policy is
> enforced by the runner-neutral core under [`tools/agent-hooks/`](../../../tools/agent-hooks/).
> This skill does not grant permissions beyond the user's explicit request.
> Invoke this workflow canonically as `$skill-audit`.

# skill-audit — keep skills and reviewer prompts honest against the project

The `.agents/skills/*/SKILL.md` files and read-only reviewers under `.codex/agents/` are
documents that **drift**. A wrong partition offset, stale command count, removed endpoint, renamed
script, or superseded pin assignment silently mis-teaches a future session. `$skill-audit` catches and
reports that drift, dynamically reacting to repository evolution. In audit mode it is strictly
read-only; when repository facts, skills, reviewers, or partitions evolve, it provides self-optimization
via `scripts/run-skill-audit.sh --optimize` to synchronize checklists and partition facts automatically.

It is the skills/agents subset of `$project-review`. A clean `$project-review` can establish
readiness for merge, but neither audit mutates the PR body without explicit instruction. Use `$skill-audit`
before PR creation or push, and `$project-review` for whole-firmware coherence before merge.

## What counts as drift (and what does not)

Drift is measured against the **project**, never against a skill's own wording. A finding
(`SKILL-DRIFT`) exists only where a skill or reviewer **contradicts** a ground-truth fact in the
code / config / script / doc:

- a **wrong number** — partition offset (`nvs@0x9000`, `otadata@0xf000`, `phy_init@0x11000`, `coredump@0x12000`, `ota_0@0x20000`, `ota_1@0x210000`, `history@0x400000`), flash size (8 MB), slot size (`0x1f0000`), heap headroom floor
  (`sys.max_alloc >= 10000`), pin assignments (Seeed XIAO ESP32-S3 RX=44/TX=43, M5Stack AtomS3 Lite RX=1/TX=2);
- a **removed or renamed** thing — an endpoint (`/status`, `/values`, `/diag`, `/coredump`, `/crash/dismiss`,
  `/ota/update`, `/detect`), MCP tool, NVS key, Kconfig option, file path, script name, function;
- a **stale set** — the target architecture (`esp32s3`), supported board wiring models;
- a **broken pointer** — a skill that documents a script/hook whose behavior no longer matches
  the file that actually runs, or a link that 404s.

**Not drift:** prose style, wording preferences, ordering, or "could be clearer". Every reported
finding must name the project fact it contradicts; otherwise omit it.

## How to run the audit

Work in this order — it is a **single read-only pass**: pin baseline → enumerate → check → report → stop.

0. **Step 0 — pin the baseline.**
   Ensure the local repository is synchronized before auditing. Run `git fetch origin` and verify
   `HEAD` matches `origin/main` (or the target PR head commit). Fail-fast on divergence or untracked
   local drift — never audit an unpinned or stale baseline. State reviewed SHA in report.
1. **Enumerate — discover, do not hardcode.** Read every `.agents/skills/*/SKILL.md` and every
   reviewer in `.codex/agents/*.toml`. Inventory `AGENTS.md`, `.agents/hooks.json`, `.codex/hooks.json`,
   `tools/agent-hooks/`, `scripts/`, `main/`, `partitions.csv`, `main/idf_component.yml`, and `version.txt`.
2. **Extract concrete claims.** List numbers, paths, counts, flags, target pins, script names,
   authorization boundaries, and described hook behavior.
3. **Verify claims against the tree.** Run the deterministic check:
   ```bash
   scripts/run-skill-audit.sh
   ```
   To synchronize checklists, update partition offsets, and self-optimize against live repository facts:
   ```bash
   scripts/run-skill-audit.sh --optimize
   ```
   Cross-check claims using runner-neutral file reads/search (`rg` preferred). Never contact a live
   device or perform an unauthorized mutation to prove an audit claim.
4. **Report, do not correct.** Every canonical skill and reviewer gets a ✓ or a
   `SKILL-DRIFT` finding with the exact proposed change. An audit request never authorizes applying
   that proposal.
5. **Report gate readiness without editing the PR.** If no contradiction remains, provide the exact
   record a separately authorized PR-body update would need; otherwise withhold readiness.

### Termination — one report-only pass

A `$skill-audit` invocation reads, checks, reports, and stops. It does not invoke itself, edit a
finding, or re-audit an edit. A separately authorized implementation may address accepted findings;
an independent later audit verifies the result.

## Per-target checklist (what each skill/agent must stay true to)

Discover the list at runtime (step 1); this is the authoritative map of what each current
skill/reviewer asserts:

**Skills** (`.agents/skills/`):

- **`$absence-review`** — verifies graceful degradation when optional sources (MQTT, HomeHub Modbus,
  ENV III, Open-Meteo, X10A bus, safe mode) are absent or unconfigured. Verify against `main/logic/history.hpp`,
  `main/logic/redact.hpp`, `tools/absence/selftest.sh`, `scripts/run-contract-tests.sh`, and
  `scripts/run-ui-use-case-tests.sh`. Must preserve the principle that absence renders as `—` or is omitted,
  never fabricating zero or substitute data.
- **`$add-logic-test`** — adding pure host-testable logic under `main/logic/` with `CHECK` in
  `test/test_logic.cpp`. Verify that referenced headers (`crc.hpp`, `convert.hpp`, `registers.hpp`,
  `config_model.hpp`, `discovery.hpp`) exist and remain strictly IDF-free, and that `scripts/run-mock-tests.sh`
  and `scripts/run-sanitizer-fuzz-tests.sh` are current.
- **`$bug-triage`** — frozen external issue triage. Verify against `scripts/gh-with-git-credentials.sh`,
  `main/logic/hexdump.hpp`, `main/logic/redact.hpp`, `docs/REPORTING.md`, and `docs/SECURITY.md`. Verify that
  it never asks for core dumps in public issues, checks `last_crash.fault` before declaring a crash, and
  reproduces values via `scripts/run-mock-tests.sh` and `scripts/run-domain-audit.sh`.
- **`$deploy-prod`** — canonical production delivery lifecycle. Verify against `scripts/production-ota-gate.py`,
  bench staging with `--confirm-bench bench --install-bench`, and production promotion with
  `--confirm-production production --execute`. Verify required deterministic pre-merge gates, exact 40-hex
  commit SHAs, 64-hex ELF SHAs, and rollback/probation checks.
- **`$deploy-test`** — test-bench update and hardware validation loop. Verify against `scripts/idf-docker.sh`,
  Secure Boot v2 signing with `$OTA_SIGNING_KEY_FILE`, `scripts/require-signed.sh`, flash args skipping
  `nvs@0x9000`, `scripts/verify-device-health.sh`, and automated diagnostic loop via `$device-triage`.
- **`$device-triage`** — live device network triage. Verify endpoints `/status`, `/values`, `/diag`,
  `/coredump`, `/crash/dismiss`. Verify that `last_crash.fault` is read before diagnosing a crash, that
  orphan dumps from earlier boots are distinguished, and that `scripts/decode-coredump.sh` is used with the
  exact-version matching ELF.
- **`$diagnostic-evidence-review`** — ties plant diagnoses to primary sources and firmware rules. Verify
  against `scripts/run-diagnostic-evidence-audit.sh`, `main/logic/checkup.hpp`, `docs/REGISTERS.md`, and
  `docs/DIAGNOSTIC_EVIDENCE.md`. Verify claim strength rules (manufacturer limit vs. project heuristic vs.
  experimental counter).
- **`$domain-review`** — domain correctness review of published values. Verify against `scripts/run-domain-audit.sh`,
  `main/logic/convert.hpp`, `main/def/`, `docs/REGISTERS.md` §3 and §5, and `tools/domain/selftest.sh`.
- **`$feature-docs`** — keeps `docs/FEATURES.md` and `docs/ESP_IDF_MATRIX.md` aligned with platform changes.
  Verify against `main/CMakeLists.txt`, `sdkconfig.defaults`, `partitions.csv`, `main/logic/*.hpp`, and
  `scripts/run-esp-idf-matrix-audit.sh`.
- **`$flash-esp32`** — host USB flash preserving NVS. Verify target `esp32s3`, `scripts/idf-docker.sh`,
  `scripts/require-signed.sh`, and `partitions.csv` (`nvs@0x9000` preserved).
- **`$pr-hygiene-review`** — screens commit messages and PR text for personal information and non-English
  prose. Verify against `scripts/run-pr-hygiene-audit.sh` and `tools/pr_hygiene/audit_exceptions.txt`.
- **`$project-review`** — whole-firmware coherence review. Verify doc drift checks (`AGENTS.md`, `docs/README.md`,
  `docs/ARCHITECTURE.md`), memory safety on HTTP handlers (503 on OOM, no giant strings), host tests,
  and esp32s3 target specifics.
- **`$renovate-review`** — dependency updates review. Distinguishes CI-attested automerge for Renovate runner
  pin-line updates from firmware dependencies (`esptool-js`, `espressif/esp-idf`), which require real hardware
  verification.
- **`$schematic-review`** — dashboard SVG review. Verify against `scripts/run-schematic-audit.sh`,
  `main/www/index.html`, `main/www/style.css`, `main/www/js/schematic.js`, and `docs/DESIGN.md`.
- **`$skill-audit`** — this skill: keeps all skills and reviewer prompts honest against repository facts.
- **`$ui-gif`** — dashboard recording audit. Verify against `scripts/run-ui-gif-audit.sh`,
  `scripts/record-dashboard-gif.sh`, and `docs/media/dashboard.gif` (135 frames, 100 ms dwell).
- **`$ui-use-case-review`** — complete device UI interaction review. Verify against
  `scripts/run-ui-use-case-tests.sh`, `scripts/run-ui-localization-audit.sh`, and `scripts/run-browser-render-tests.sh`.
- **`$user-docs-review`** — English-only user documentation review. Verify against
  `scripts/run-user-docs-audit.sh` and `docs/DIAGNOSTICS.md`.

**Reviewers** (`.codex/agents/`):

- **`doc_drift_checker`** (`.codex/agents/doc-drift-checker.toml`) — checks documentation consistency
  between `AGENTS.md` and detailed markdown references under `docs/`.
- **`heap_safety_reviewer`** (`.codex/agents/heap-safety-reviewer.toml`) — checks contiguous heap limits,
  streaming responses, RAII locking, stack budgets, and 503 on OOM.
- **`x10a_decode_reviewer`** (`.codex/agents/x10a-decode-reviewer.toml`) — checks X10A protocol decode,
  converter IDs, sign/scale, and byte layout against `docs/REGISTERS.md`.

## Self-analysis and audit self-optimization

Before ticking or stamping the gate:
1. **Self-audit first against repository ground truth:** `$skill-audit` verifies its own checklist, rules, and partition offsets against discovered canonical skills (`.agents/skills/`), reviewers (`.codex/agents/`), partition offsets (`partitions.csv`), HTTP endpoints (`main/`), and hardware pin definitions.
2. **Reactivity to repository evolution:** When new skills or reviewers are introduced, partitions are adjusted, or endpoints are added/retired, `$skill-audit` dynamically detects the drift.
3. **Execute self-optimization:** When changes in the repository require synchronization, run:
   ```bash
   scripts/run-skill-audit.sh --optimize
   ```
   This automatically synchronizes `$skill-audit`'s internal checklists, updates partition offsets, and eliminates manual drift.
4. **Fact vs assertion verification:** Confirm that every referenced file path, partition offset, board pin, endpoint, and command in each audited skill was verified against current repository files.
5. **Stamp integrity check:** Confirm the stamp uses the bare short SHA (`git rev-parse --short=12 HEAD`) without backticks.

## Recording the pass (PR create/push gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) hook
refuses PR creation and `git push` to an open PR until this review is recorded in the PR body as a
ticked, SHA-stamped checkbox whose stamp matches the push HEAD.

When the audit passes with **no blocking findings**, tick + stamp the PR's `$skill-audit` box:

```text
- [x] `$skill-audit` clean — PR create/push gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```
