---
name: feature-docs
description: Keep docs/FEATURES.md and docs/ESP_IDF_MATRIX.md in sync when a new platform feature lands — a new ESP-IDF component, an sdkconfig capability, an HTTP/OTA/security/network/diagnostic mechanism, a new logic/ header, or a stub becoming real. Use after implementing or changing a technical feature, before opening the PR.
---

# feature-docs

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

[`docs/FEATURES.md`](../../../docs/FEATURES.md) is the cross-cutting catalog of **what this firmware
does** at the platform level (Secure Boot v2 signing, OTA + health gate, the polled live UI, the ESP-IDF
component inventory, diagnostics, WiFi resilience). It is a project-specific record — not a how-to for
other projects. It rots silently: a new component gets linked, a `CONFIG_*` gets flipped, a `🔭` stub
becomes real — and the catalog still describes the old world. This skill closes that gap. It is the
feature-level companion to [`project-review`](../project-review/SKILL.md) (broad pre-merge drift) and
[`doc_drift_checker`](../../agents/doc-drift-checker.toml) (AGENTS.md ↔ deep-dive docs).

[`docs/ESP_IDF_MATRIX.md`](../../../docs/ESP_IDF_MATRIX.md) is the detailed source-linked ESP-IDF
inventory. Its mechanical gate covers explicit components, managed dependencies, active defaults,
application IDF headers and reviewed native/manual boundaries. FEATURES stays the short project
catalog; the matrix owns provider/component detail and official Espressif documentation links.

**FEATURES.md must never overstate the firmware.** Every `✅`/`🧪` claim points at code that backs
it; anything not fully wired is `🟡`/`🔭` with the TODO named. When in doubt, downgrade the label.

## When to run

Review the catalog after changes to components or managed dependencies, active `CONFIG_*` defaults,
HTTP routes, OTA/security/network/diagnostic mechanisms, MQTT/HA entities, pure logic or partition
layout. Read the actual diff and production path. If none of these facts changed, leave the catalog
alone and report that it already matches the source.

## Steps

0. **Step 0 — pin the baseline.**
   Record `git rev-parse HEAD`, the intended comparison base, and `git status --short` before
   auditing. For a PR, verify that the checkout matches the exact target PR head; refresh remote
   refs with `git fetch origin` when needed and available. For an authorized local implementation,
   include the intended tracked diff and untracked new files in the review and identify them in
   the report; no commit, PR or equality with `origin/main` is required. Preserve unrelated user
   changes. Stamp a merge pass only after the reviewed content matches the exact committed PR head.
1. **Diff the surface.** Use the recorded base in
   `git diff <base>...HEAD -- main/ sdkconfig.defaults partitions.csv scripts/ .github/`. For a local
   implementation, also inspect `git diff HEAD -- main/ sdkconfig.defaults partitions.csv scripts/ .github/`
   and the intended untracked new files. Scan for the signals above and read the actual new code;
   do not infer a feature from a commit message.
2. **Locate the record.** Update the matching stable feature row in FEATURES.md.
   Add an ID only for a distinct capability; never renumber or reuse IDs.
   If ESP-IDF surface changed, also update the
   stable row, evidence, official link and active-config appendix in ESP_IDF_MATRIX.md.
3. **Write the entry code-verified — and SHORT.** State what the feature does in **one short row** in the
   matrix, point at the file with a repo-relative
   markdown link (targets are relative to `docs/`, e.g. `../main/wifi.cpp`), and label the status
   honestly (`✅` shipping / `🧪` host-tested logic / `🟡` partial / `🔭` planned). Copy exact numbers
   from the source — sensor counts, `CHECK` count, partition sizes, `CONFIG_*` names — never round or
   guess, and prefer omitting a volatile count to restating one that will drift.

   **What does NOT go in the entry** — this is the failure mode this file actually has, not a
   hypothetical one: appending a full rationale to each table cell makes the catalog unreadable. Keep out the bug
   that motivated the feature (→ the issue), the measurement that settled it (→ the issue or
   `ARCHITECTURE.md`), the field-by-field API listing (→ `docs/API.md`), and the
   per-header reasoning (→ the header's own comment). A reader comes here to learn *that* a mechanism
   exists and *where* it lives; every line past that belongs somewhere it can be found on purpose.
   If an entry needs more room, the deep-dive doc is the room.
4. **Promote, don't just append, when a stub goes real.** If `ota_update.cpp`'s download or
   `mcp_server.cpp` graduates from TODO, change the label in the FEATURES row, promote
   the corresponding ESP_IDF_MATRIX.md row where applicable, and delete the "planned" wording.
5. **Keep topic owners authoritative.** Use [docs/README.md](../../../docs/README.md) to locate the
   reference for architecture, API, security, maintenance or MQTT. Update the affected reference
   and link it; do not copy its complete contract into FEATURES or add a per-feature section there.
   Apply [project-review's consistency and concision checklist](../project-review/SKILL.md#documentation-consistency-and-concision)
   across related documents and current code. Contradictions, unsupported claims and avoidable
   duplication block a clean review. Retain necessary rules and limits; remove defect chronology
   and redundant rationale. Include new and moved prose when judging growth.
6. **Verify.**
   - Links resolve — every `](../…)` target exists (they're relative to `docs/`).
   - `scripts/run-esp-idf-matrix-audit.sh` passes; if its checker changed, also run
     `tools/esp_idf_matrix/selftest.sh`.
   - `scripts/run-mock-tests.sh` still passes if a `logic/` count changed.
   - No `✅`/`🧪` claim is unbacked; no shipped feature left as `🔭`.
7. **Keep the framing hooks current.** FEATURES.md opens with a status legend and closes with a
   pointer back to this skill — leave both intact.

## Self-analysis and prose self-optimization

Before recording the pass:
   - **Conciseness budget audit:** Audit all changed prose, including moved or new files: one concise
     feature row, with detailed contracts linked from their owner. Reject tutorials and issue backstory.
   - **Prose review:** Identify obsolete remarks or redundant explanations near the changed entry.
     Revise them only within an explicitly authorized documentation change.
   - **Link and count validation:** Re-check that repository links resolve relative to `docs/`,
     official external references remain valid, and cited sensor or `CHECK` numbers match source.

## Guardrails

- **Verified, not aspirational.** The catalog's value is that a reader can trust it. A `✅` you can't
  point at is worse than an omitted feature.
- **A catalog, not a tutorial.** It records what *this* firmware does and where — it is not a
  copy/paste guide for reusing a feature in another project. Keep entries descriptive, not how-to.
- **A catalog, not an archive.** An index earns its keep by being readable end to end; a feature
  stated in one line is worth more than the same feature stated in twenty. When editing an existing
  entry, leave it **no longer than you found it** — the growth here has always been incremental, one
  defensible paragraph at a time. Prune while you are in there.
- **Ids are stable keys.** Never renumber or reuse a matrix id; a gap means a retired feature.
- **Don't rename the file or restructure sections** without reason — other docs, the README and
  [`AGENTS.md`](../../../AGENTS.md) may link to `docs/FEATURES.md` and its anchors.
- **The project convention holds:** always write the full name `daikin-altherma-esp32`, and don't name
  other projects in the catalog (the README credit is the sole exception).
- A shipping label proves implementation, not behavior on a particular heat pump.

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) gates the
documented synchronous, repository-, PR- and head-bound REST CAS merge path; CI independently
enforces the same current-head evidence. Its feature-docs check, the sibling of the `$project-review` gate, is
**conditional**:
derive applicability from its canonical technical-feature path filter, including firmware, tests,
build/policy workflows and selected build, signing, stack, runtime, browser and OTA scripts/tools.
Script-only changes can require this review; a PR label or category does not override the filter.
The authoritative-CI-attested Renovate runner-pin-only class lives in `renovate.yaml`, outside this
skill's technical-feature relevance set. Its protected-base, immutable-head attestation therefore
does not suppress a `$feature-docs` record that would otherwise apply.

When it applies, record the pass — after running this skill and confirming `docs/FEATURES.md` and
`docs/ESP_IDF_MATRIX.md` match the code — by TICKING and SHA-STAMPING the PR's `$feature-docs` box
with the reviewed commit:

```
- [x] `$feature-docs` synced — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

The gate allows the merge only while that box is checked AND its stamp still matches the PR head, so
any later commit re-stales it and forces a fresh run. Edit the PR body with
`scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr edit <pr> --body-file <absolute-physical-temp-path>/review-body.md`.
If the skill
concludes no catalog change was needed (see *When to run*), the docs are already in sync —
still tick + stamp the box to record that you checked. Don't tick it if FEATURES.md is out of date —
fix it first. The gate fails **closed**: if GitHub can't be read, the merge is blocked with guidance.
