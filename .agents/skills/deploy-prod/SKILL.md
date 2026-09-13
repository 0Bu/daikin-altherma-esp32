---
name: deploy-prod
description: Execute quality gates, merge PR to main, wait for CI dev build, run canonical bench delivery gate, then run canonical production promotion gate, with automated fix-and-retry on findings. Use when deploy-test is green and ready for production deployment.
---

# deploy-prod

## Authorization boundary

Treat requests to inspect or review as read-only. A request to deploy to production (such as
"merge, run gates, if green OTA test bench and test, if green OTA production and test, on findings fix and retry
from start" or equivalent) explicitly authorizes:
- Running deterministic quality gates and stamping required PR review checkboxes
- Merging the current pull request to `main` via the repository CAS merge wrapper
- Monitoring the GitHub Actions CI run on `main` until the dev feed is published
- Running the canonical role-bound bench delivery gate on the test bench device (`bench` role)
- If the bench device is healthy, running the canonical role-bound promotion gate on the production heat pump (`production` role)
- When both devices are verified healthy: cleaning up the merged remote branch and temporary deployment artifacts

It does **NOT** authorize:
- Touching unrelated production devices or altering live heat pump parameters
- Direct Git push to `main` bypassing PR checks and branch protection
- Skipping required PR review gates or failing tests

## Device roles

- **Test Device (Bench)**: Private inventory role `bench` (`~/.config/daikin-altherma-esp32/production-ota.json`). First OTA target. X10A heat pump connection is optional.
- **Production Device (Production)**: Private inventory role `production` (`~/.config/daikin-altherma-esp32/production-ota.json`). Live Daikin Altherma installation. Second OTA target. Requires `hp.connected == true` and valid `/values`.

## Steps

### 1. Deterministic gates & PR review stamp

Run the applicable local gates for the change set before merge:
```bash
scripts/run-mock-tests.sh --coverage
scripts/run-contract-tests.sh
scripts/run-domain-audit.sh
scripts/run-description-audit.sh
scripts/run-user-docs-audit.sh
scripts/run-schematic-audit.sh
scripts/run-ui-use-case-tests.sh
scripts/run-redaction-audit.sh
scripts/run-ui-gif-audit.sh
scripts/run-doc-entity-audit.sh
```

Ensure `$project-review`, `$domain-review` and any conditional review skills (e.g. `$schematic-review`,
`$ui-use-case-review`) are completed and their checkboxes in the PR body are checked with the current
full head SHA.

### 2. Merge PR to main

Execute the supported CAS squash-merge via the credentials wrapper:
```bash
head_sha="$(git rev-parse HEAD)"
scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT \
  repos/0Bu/daikin-altherma-esp32/pulls/<pr-number>/merge \
  -f sha="$head_sha" -f merge_method=squash
```

### 3. Watch CI dev build on main

When merged, CI workflow `build.yml` compiles the firmware, signs it with the production release key,
and publishes the dev channel feed to `https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json`.

Find and watch the CI run:
```bash
run_id="$(scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 run list --branch main -L 1 --json databaseId --jq '.[0].databaseId')"
scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 run watch "$run_id" --exit-status
```

### 4. Canonical bench delivery gate on test bench

Execute the canonical role-bound bench update transaction:
```bash
scripts/production-ota-gate.py \
  --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json \
  --expected-source-sha <commit-sha> \
  --expected-version <target-version> \
  --expected-app-sha256 <app-elf-sha256> \
  --expected-current-version <current-bench-version> \
  --confirm-bench bench \
  --install-bench
```

This single command binds the exact signed artifact, performs at most one POST to the bench role, verifies rollback probation, and executes the sustained pressure gate.

If bench gate fails or any finding occurs, proceed directly to **Step 8 (Failure recovery loop)**. Do NOT proceed to production.

### 5. Canonical production promotion gate & canary

Once the bench gate has passed cleanly, execute the distinct production promotion transaction:
```bash
scripts/production-ota-gate.py \
  --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json \
  --expected-source-sha <commit-sha> \
  --expected-version <target-version> \
  --expected-app-sha256 <app-elf-sha256> \
  --expected-current-version <current-production-version> \
  --confirm-production production \
  --execute
```

This transaction proves the candidate on the bench under HTTP pressure, restores bench target, runs sustained stress, performs at most one POST to the production role, and verifies the read-only canary.

Strict production requirements verified by the promotion gate:
- HTTP `/status` answers with the new version
- `hp.connected == true` (active X10A communication with heat pump)
- `/values` delivers non-empty metric array
- MQTT broker is connected
- `last_crash.fault == false` (no unhandled panic/watchdog)
- Largest contiguous heap block is healthy

If any check fails or any finding occurs, proceed immediately to **Step 8**.

### 6. Report success

When both devices are verified healthy:
- Report new version string and ELF SHA
- Summarize device metrics (uptime, heap, MQTT status, X10A status)
- Confirm successful rollout to both test bench and production heat pump

### 7. Cleanup after successful rollout

After the successful deployment and verification:
1. **Remote branch deletion:** Delete the merged feature branch from GitHub:
   ```bash
   git push origin --delete <branch>
   ```
2. **Local branch & worktree cleanup:**
   Prune remote tracking refs and remove the local merged branch:
   ```bash
   git fetch --prune origin
   git branch -d <branch>
   ```
3. **Temporary files:**
   Clean up temporary PR body files or test logs:
   ```bash
   rm -f /private/tmp/pr-body.md /private/tmp/changed-files.txt /tmp/dt_status.json
   ```

### 8. Failure recovery loop ("on findings/errors, fix, run deploy-test until green, then repeat deploy-prod from start")

If an error or finding occurs at any point during this workflow:

#### Case A: Failure during gates, CI, or on test bench
1. **Diagnose:** Pull snapshot from test bench device or CI logs:
   ```bash
   curl -sS "http://<bench-host>/status" | jq .
   curl -sS "http://<bench-host>/diag?verbose=1"
   ```
2. **Fix in code:** Create a fix branch (`agent/fix-...`), implement the correction, and add unit/contract tests.
3. **Execute `$deploy-test`:**
   Run `$deploy-test` (build locally, flash/update bench, verify bench).
4. **Repeat `$deploy-test`** until bench is completely green without any error.
5. **Restart `$deploy-prod`:**
   Once `$deploy-test` is fully green, push the fix branch, open/update the PR, and restart `deploy-prod` from **Step 1**.

#### Case B: Failure on production board
1. **Immediate recovery on production:**
   Restore production plant operation by installing the verified previous known-good release image using the canonical promotion gate, binding exact known-good version, commit SHA, and ELF SHA:
   ```bash
   scripts/production-ota-gate.py \
     --manifest-url https://0bu.github.io/daikin-altherma-esp32/dev/manifest.json \
     --expected-source-sha <known-good-source-sha> \
     --expected-version <known-good-version> \
     --expected-app-sha256 <known-good-app-sha256> \
     --expected-current-version <installed-version> \
     --confirm-production production \
     --execute
   ```
2. **Diagnose:** Capture snapshot and logs from production:
   ```bash
   curl -sS "http://<production-host>/status" | jq .
   curl -sS "http://<production-host>/diag?verbose=1"
   ```
   If a crash occurred, symbolize the core dump via `$device-triage`.
3. **Fix in code:** Implement correction on a fix branch and add regression tests.
4. **Execute `$deploy-test`:**
   Run `$deploy-test` (build locally, flash/update bench, verify bench).
5. **Repeat `$deploy-test`** until bench is completely green without any error.
6. **Restart `$deploy-prod`:**
   Once `$deploy-test` is fully green, push the fix branch, open/update the PR, and restart `deploy-prod` from **Step 1**.
