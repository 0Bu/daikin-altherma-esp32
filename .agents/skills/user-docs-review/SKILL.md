---
name: user-docs-review
description: Keep daikin-altherma-esp32 user-facing help English-only, understandable, evidence-bounded and current while preserving complete localized UI copy. Use after changing repository documentation, a visible diagnosis, status, user action, UI explainer, plant-health payload or docs/DIAGNOSTICS.md, and before a PR that changes what a non-specialist sees or must do with a result. Use diagnostic-evidence-review alongside it when implementation rules or sources change.
---

# User Docs Review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

Treat user documentation as part of the feature. A technically correct result is incomplete when a
non-specialist cannot tell what it means, what it does not prove, or what to do next.

## Review the change

1. Read the diff and the production evaluator. Identify every changed visible result, threshold,
   status, evidence requirement, limitation and supported user action. Do not infer behavior from a
   ticket or commit message.
2. Trace the result through `/status.health`, `CHECKUP_ROW`, its translated value/detail strings and
   `MODEL_DESCRIPTIONS.health_*`. Keep repository documentation in English. Verify localized UI copy
   carries the same claim strength without copying localized prose into the documentation.
3. Update the inline explainer, [`docs/DIAGNOSTICS.md`](../../../docs/DIAGNOSTICS.md) and
   [`docs/DIAGNOSTIC_EVIDENCE.md`](../../../docs/DIAGNOSTIC_EVIDENCE.md) together. Preserve the
   `<!-- user-docs: health_* -->` marker and the evidence heading's stable wire id belonging to each
   visible row.
4. Invoke `$diagnostic-evidence-review` when an external claim, evaluator, threshold, source signal
   or evidence boundary changed. Keep this review focused on whether the resulting explanation is
   understandable and actionable for the owner.

## Write for the owner, not the installer

For every result, answer these four questions in this order:

1. What did the board observe or count?
2. What does this status mean for this one check?
3. What can the result not establish?
4. What can the owner safely check, observe or record next, and when is an installer appropriate?

Introduce a plain word before an abbreviation: “electric backup heater (BUH)”, not “BUH”. Keep
manufacturer terms only where the user must match a manual, error code or display. State project
heuristics as heuristics and model-specific limits as model-specific. Never turn one `OK` result into
“the plant is healthy”, and never turn `CHECKING` or missing evidence into reassurance.

Make the next step specific. “Contact service” alone is not useful; say what to note first, such as
the code, time, operating mode, weather, repeated pattern or exact manual limit. Do not recommend
changing safety-critical or installer settings from one day of data.

## Add or change a diagnosis

Keep these surfaces aligned:

- `main/logic/checkup.hpp` and `main/checkup.cpp`: evaluator and published evidence;
- `main/www/js/dashboard.js`: visible row and bounded status/detail;
- `main/www/js/history.js`: English and German `what`, `normal`/`meaning` and `action`;
- `main/www/js/i18n.js`: labels and status wording;
- `docs/DIAGNOSTICS.md`: one marked English section with **In plain language** and
  **What you can do**, plus glossary/status updates when needed;
- `docs/DIAGNOSTIC_EVIDENCE.md`: one English section keyed by the stable diagnosis id with
  **External evidence**, **Firmware rule**, **Not established**, and for a
  filtered/heuristic/experimental check an explicit **Project boundary** or
  **Experimental boundary**;
- `test/test_ui_checkup.mjs`: behavior and load-bearing wording.

## Self-analysis and prose self-optimization

Before updating the audit fingerprint:
1. **Four-question structure check:** Confirm that each visible diagnosis section answers the four questions in sequence: (1) what was counted/observed, (2) what it means, (3) what cannot be established, and (4) safe owner next steps.
2. **Owner perspective & jargon audit:** Verify that acronyms are introduced before abbreviations, language is accessible to a homeowner (not just an HVAC technician), and no single check implies whole-plant wellness.
3. **English-only documentation check:** Confirm that all text in `docs/` and review files is strictly English, leaving German localized strings exclusively in `main/www/`.
4. **Actionable wording review:** Report vague advice such as "call service" without supporting
   context. Revise wording only when fixes are explicitly authorized; review-only work leaves prose
   and audit fingerprints unchanged.

## Run the gate

0. **Step 0 — pin the baseline.**
   Record `git rev-parse HEAD`, the intended comparison base, and `git status --short` before
   auditing. For a PR, verify that the checkout matches the exact target PR head; refresh remote
   refs with `git fetch origin` when needed and available. For an authorized local implementation,
   include the intended tracked diff and untracked new files in the review and identify them in
   the report; no commit, PR or equality with `origin/main` is required. Preserve unrelated user
   changes. Stamp a merge pass only after the reviewed content matches the exact committed PR head.

Run the normal check first:

```bash
scripts/run-user-docs-audit.sh
```

If it reports `U010`, inspect the source change and update all affected prose before refreshing the
fingerprint. The fingerprint is a record of review, never a substitute for it:

```bash
scripts/run-user-docs-audit.sh --update
scripts/run-user-docs-audit.sh
tools/user_docs/selftest.sh
scripts/run-diagnostic-evidence-audit.sh
scripts/run-ui-use-case-tests.sh
```

Do not weaken length, localization, English-only documentation, section, action, source-coverage or
bounded-claim checks to clear a finding. Fix the missing explanation or evidence. In the handoff,
name the user-visible wording that changed and distinguish code/CI verification from anything not
checked on a physical heat pump.

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) refuses
supported PR merge paths until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head. It fires when user-facing documentation,
diagnostics explainers, visible copy, or doc audits change.

When the review passes with **no blocking findings**, tick + stamp it with the reviewed commit:

```text
- [x] `$user-docs-review` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

Edit the PR body with
`scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr edit <pr> --body-file <absolute-physical-temp-path>/review-body.md`.
Any later commit re-stales the stamp, forcing a fresh review before the next merge.
Don't tick it if findings block the merge — fix first.
