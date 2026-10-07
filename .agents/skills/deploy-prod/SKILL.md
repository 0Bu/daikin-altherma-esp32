---
name: deploy-prod
description: Execute quality gates, merge the PR to main, wait for the CI dev build, run the canonical bench delivery gate, then the canonical production promotion gate, with an automated fix-and-retry loop on findings. Use when the change is ready for production delivery.
---

# deploy-prod

## Authorization boundary

Treat requests to inspect or review as read-only. A request to deploy to production (such as
"merge, run gates, if green OTA test bench and test, if green OTA production and test, on findings fix and retry
from start" or equivalent) explicitly authorizes the whole chain below:
- the `$deploy-test` pre-merge bench test (host signing and USB write) of the PR head in Step 0;
- running the deterministic gates and the review skills, and stamping their PR records;
- merging the PR to `main` through the repository CAS merge path, after its required checks passed;
- watching the CI run on `main` until the dev feed is published;
- the canonical bench delivery gate on the `bench` role, then the canonical promotion gate on the
  `production` role;
- the failure loop in Step 8: fixes on the PR branch, fix or revert branches, commits, pushes, PR
  creation, reviews and merges of those PRs, the `$deploy-test` test of every fix head, and the
  roll-forward delivery;
- cleanup of artifacts this deployment created.

It does **not** authorize:
- touching unrelated devices, or changing heat pump parameters or live device configuration;
- direct `/ota/update` writes, a release (`workflow_dispatch` with `release: true`), force pushes, or
  bypassing branch protection;
- `erase_flash`, NVS erasure, or a partition table change on any board;
- skipping a required gate, review record or failing check.

## Device roles

- **Bench**: private inventory role `bench` (`~/.config/daikin-altherma-esp32/production-ota.json`).
  First target. An X10A connection is optional.
- **Production**: private inventory role `production`. The live installation. The promotion gate
  requires live X10A and valid `/values`.

## Command form

Run every `scripts/production-ota-gate.py` and signing command directly, unchained, **on one line**:
the hook rejects such a command when it contains a newline, including a backslash continuation.
Credential-wrapper commands take literal values only (no shell variables, `$(...)` or `--jq`). The
hook binds the gate and the wrapper to the session worktree, so run them there and never through a
`cd … &&` chain. Keep every branch this workflow needs in that session worktree.

## Steps

### 0. Precondition: the exact head passed `$deploy-test`

A PR is firmware-relevant when a changed file matches the `relevant=` pattern of the `changes` step
in `.github/workflows/build.yml`, because CI republishes the dev artifact for exactly those files.
For such a PR, `$deploy-test` must have passed at the exact PR head, and its pinned SHA and result
must be recorded in the PR body. If not, run `$deploy-test` now; the same applies to every fix head
from Step 8. A PR without firmware-relevant files skips this step.

### 1. Deterministic gates and PR records

Run the deterministic gates for the affected surface (the entry points are listed in `AGENTS.md`).
For a firmware change, include `scripts/idf-docker.sh idf.py build`.

Derive the required PR records from `tools/agent-hooks/require-pr-gates.sh`; never copy a list.
`$project-review`, `$domain-review` and `$pr-hygiene-review` apply to every ordinary merge. The
`$heap-safety-review` record comes from the independent read-only `heap_safety_reviewer`, not from a
skill. Stamp each record for the exact PR head (`git rev-parse --short=12 HEAD`). Then validate the
body locally against the head and the changed files:

```bash
AGENT_PR_BODY_FILE=<absolute-body-file> AGENT_PR_HEAD_SHA=<40-hex-head> AGENT_CHANGED_FILES_FILE=<changed-files-list> ./scripts/run-agent-policy.sh
```

### 2. Merge the PR

Read the PR head and its checks. The required `gates` and `build` checks must be green for that
exact head:

```bash
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr view <pr-number> --json headRefOid,state,mergeStateStatus
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr checks <pr-number>
```

Wait for pending checks with the bounded watcher from `AGENTS.md`, not with sleeps. Then merge with
the literal 40-hex `headRefOid`:

```bash
scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT repos/0Bu/daikin-altherma-esp32/pulls/<pr-number>/merge -f sha=<full-40-hex-pr-head-sha> -f merge_method=squash
```

Record the merge commit SHA from the response.

### 3. Watch the CI dev build on main

Find the `build.yml` run for the merge commit and watch it:

```bash
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 run list --workflow build.yml --branch main --commit <merge-sha>
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 run watch <run-id> --exit-status
```

Then read `https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json`. GitHub Pages can lag, so
retry for a bounded time. Continue only if the manifest's `source_sha` equals the merge commit, and
note its version and application SHA-256. A PR without firmware-relevant files publishes no dev
artifact, so the manifest keeps the previous source: report the merge and stop. If a
firmware-relevant PR's manifest keeps the previous source after a green run and the bounded wait,
treat it as **Case A**.

### 4. Bench delivery gate

The gate requires a clean checkout whose `HEAD` is the merge commit. The hook admits only the
session worktree's own `scripts/production-ota-gate.py`. So run Steps 4 and 5 from the session
worktree, clean and detached at the merge commit (`git fetch origin`, then
`git switch --detach <merge-sha>`).

Read the bench's current version from `/status` on the inventory host. After a `$deploy-test` run,
that is the tested local image's version. Then run, on one line:

```bash
scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha <full-40-hex-merge-sha> --expected-version <target-version-dev.N> --expected-app-sha256 <full-64-hex-app-sha256> --expected-current-version <current-bench-version> --confirm-bench bench --install-bench
```

This single command binds the exact signed artifact, performs at most one POST to the bench role,
verifies rollback probation, and runs the sustained pressure gate.

If the bench gate fails or reports a finding, go to **Step 8, Case A**. Do not proceed to production.

### 5. Production promotion gate and canary

After a clean bench gate, read production's current version from its `/status` and run, on one line:

```bash
scripts/production-ota-gate.py --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json --expected-source-sha <full-40-hex-merge-sha> --expected-version <target-version-dev.N> --expected-app-sha256 <full-64-hex-app-sha256> --expected-current-version <current-production-version> --confirm-production production --execute
```

This transaction does four things:
1. proves the candidate on the bench under HTTP pressure;
2. restores the bench target and runs sustained stress;
3. performs at most one POST to the production role;
4. verifies the read-only canary.

The promotion gate itself checks:
- HTTP `/status` answers with the new version;
- `hp.connected == true` (active X10A communication with the heat pump);
- `/values` delivers a non-empty metric array;
- the MQTT broker is connected;
- `last_crash.fault == false` (no unhandled panic or watchdog);
- the largest contiguous heap block is healthy.

If the gate fails after its production write, or the canary reports a finding, go to **Step 8,
Case B**. A failure before the production write, during bench staging, is **Case A**.

### 6. Report success

When both devices are verified healthy:
- report the new version string and ELF SHA;
- summarize device metrics (uptime, heap, MQTT status, X10A status);
- confirm the rollout to both the bench and the production heat pump, and list every additional PR
  the failure loop merged.

### 7. Cleanup after a successful rollout

1. **Branches:** GitHub deletes a merged PR's head branch. Confirm with
   `git ls-remote --heads origin <branch>`, and delete it only if it still exists. Then run
   `git fetch --prune origin` and `git branch -d <branch>` for local branches this deployment created.
2. **Worktrees:** remove only worktrees this deployment created, each by its exact path.
3. **Files:** remove only temporary files this deployment created, such as its own PR body files or
   its signed image duplicate. Keep rollout, signing and diagnostic evidence, and never delete files
   by a shared fixed path that another session may own.

### 7b. Self-analysis and rollout self-optimization

Before concluding the deployment task:
1. **Telemetry and baseline self-analysis:**
   - Compare the post-rollout `/status` and `/values` on production against the pre-rollout baseline.
   - Assert contiguous heap headroom (`.sys.max_alloc >= 10000`), no crash record (`.last_crash == null`
     or `.last_crash.fault == false`), and that the published metric count has not dropped.
   - Confirm active MQTT heartbeats and an uninterrupted X10A query cadence.
2. **Process reflection:**
   - If Step 8 ran, analyze why the first candidate failed and verify that regression tests were
     added. Confirm that no temporary debugging code, unneeded comments or relaxed timeouts remain.

### 8. Failure recovery loop

On any error or finding: fix, prove the fix on the bench, and restart from Step 0. Each pass of the
loop is part of the authorized chain.

#### Case A: failure in Step 0, the gates, PR CI, the main CI run, or on the bench

1. **Diagnose:** read the CI log, or snapshot the bench:
   ```bash
   curl -sS "http://<bench-host>/status"
   curl -sS "http://<bench-host>/diag?verbose=1"
   ```
   If `last_crash.fault` is true, symbolize the core dump via `$device-triage`.
2. **Fix in code** with a regression test, plus a negative control that fails without the fix, and
   commit:
   - Before the merge (Steps 0–2), commit the fix on the PR's own branch.
   - After the merge (Steps 3–4), create the fix branch in the session worktree from the current main:
     `git fetch origin`, then `git switch -c agent/fix-<topic> origin/main`.
3. **Run `$deploy-test`** at the fix head: the identity-verified USB write of the signed local build,
   health, and the behavior that failed. Repeat steps 2–3 until the bench is green.
4. **Publish the fix:**
   - Run `$skill-audit` and `$pr-hygiene-review` for the fix head. When the fix goes onto an open PR,
     put both stamps for the new head into its PR body **before** the push; the pre-push gate checks
     them.
   - Push, and open the PR in the wrapper's exact `pr create` shape (`docs/AGENT_MIGRATION.md`), or
     update the existing PR.
   - Run the remaining reviews. Use an independent reviewer for high-risk heap, decode, persistence,
     security or UI changes.
   - Stamp every record for the exact head.
   - Restart from **Step 0** for that PR. The bench now runs the fix's local image, so Step 4 uses
     its version as `--expected-current-version`.

#### Case B: failure on the production board after its write

An agent cannot roll production back by OTA. Direct `/ota/update` writes, including the trusted-LAN
`downgrade=1` channel switch (`main/logic/version_cmp.hpp`), are blocked. The gate binds only the
current official dev manifest. If the image failed its rollback probation, the bootloader has
already returned production to the previous image; otherwise production keeps the faulty build until
a roll-forward lands. In both cases, read production's version from `/status` before the next
Step 5. The heat pump itself keeps running: this firmware only observes it, and the HomeHub link is
read-only.

1. **Diagnose** read-only: snapshot production's `/status` and `/diag?verbose=1`. If
   `last_crash.fault` is true, symbolize the core dump via `$device-triage`.
2. **Choose the roll-forward:** a fix when the cause is understood and contained, otherwise a revert
   of the faulty squash commit (`git revert <merge-sha>` on a fresh `agent/` branch from
   `origin/main`).
3. **Deliver it** through Case A steps 3–4: the `$deploy-test` bench test, the PR and its reviews,
   then Steps 0–5 again. The new dev build is newer than the faulty one, so the promotion gate can
   install it.
4. If production cannot accept an OTA at all, stop and report. That covers an unreachable board, a
   boot loop, or any state in which the promotion gate cannot complete its write. Recovery then
   needs physical USB access to the production board, which only the user can provide.
