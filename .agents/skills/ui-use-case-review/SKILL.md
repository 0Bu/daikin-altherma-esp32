---
name: ui-use-case-review
description: Exercise the complete daikin-altherma-esp32 device UI before merge, including navigation, every modal lifecycle, valid and invalid submissions, server rejection, conditional board/sensor states, language and rendering contracts. Use after any change under main/www, UI tests, UI audit tooling, or UI-facing HTTP configuration behavior, and before merging a PR that can affect what users see or click.
---

# UI use-case review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

Treat a rendered control as working only after its action changes the expected state. A present,
enabled button is not evidence; the ENV III dialog shipped with both buttons visible while their
shared close callback called an undefined function.

## 1. Establish the affected paths

Read the PR diff and list each user path it can reach: dashboard/settings navigation, dynamic cards,
dialogs, status variants, validation, persistence, restart/reconnect behavior, language, responsive
layout and accessibility. Include indirect changes to HTTP payloads consumed by the UI.

If a new dialog, action or state is not represented in `test/test_ui_use_cases.mjs`, add its case
before declaring the review complete. That file must enumerate every id in the production `MODALS`
list; adding a modal without a lifecycle case must fail.

## 2. Run the complete mechanical suite

```bash
scripts/run-ui-use-case-tests.sh
```

Require exit 0. The command executes all `test/test_ui_*.mjs` contracts plus HomeHub discovery, the
MCP page and `tools/ui/selftest.sh`. The behavioral matrix executes the production one-time wiring
and verifies:

- dashboard to Settings and Back;
- every modal through open, Cancel, backdrop and Escape;
- accepted Save closes and calls the correct endpoint;
- HTTP rejection releases busy state and keeps the dialog editable;
- representative invalid input never reaches firmware;
- ENV III on an unsupported board, with no sensor, and with distinct SDA/SCL pins;
- the bug-report dialog's input and review steps;
- all existing language, rendering, source-selection, board, history and semantic UI contracts.

Do not weaken an assertion to make a failure disappear. Fix production behavior, or update the case
only when the intended contract has explicitly changed. Keep the selftest able to re-seed and catch
the historical undefined ENV III close handler.

## 3. Inspect the changed visual states

Render each affected state at a narrow phone viewport and a desktop viewport using the real inlined
UI. Exercise controls by clicking them; do not infer behavior from markup. Check:

- no clipped text, overflowing actions or hidden focused controls;
- hidden controls are also disabled and release resources such as GPIO choices;
- focus starts on the dialog, labels and accessible names identify the action, and Escape closes;
- loading, success, rejection, unreachable and empty states remain distinguishable;
- German and English copy both fit and mean the same thing;
- browser console errors remain empty throughout the path.

Use deterministic fixtures for visual states. Do not write device configuration during a pre-merge
review unless the user explicitly requested a live-device test.

## 4. Review failure coverage

For every bug fixed in the PR, identify the exact test that fails when the bug is reintroduced. Add a
targeted selftest mutation when the main suite could otherwise pass vacuously. A source regex alone
is insufficient for an interaction defect; execute the handler and assert its outcome.

Block the merge on any uncaught exception, missing handler, action without the promised state change,
unrepresented new use case, live UI assertion failure, or visual/accessibility regression.

## 5. Record the pass

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) hook
reruns the complete suite at merge time and requires a current PR record for UI-relevant changes.
The record-free Renovate runner-pin class changes only `renovate.yaml`, so it never suppresses an
otherwise applicable UI review.
After every blocking finding is fixed, stamp the reviewed head in the PR body:

```text
- [x] `$ui-use-case-review` clean — merge gate @ <short-sha>
```

Use `git rev-parse --short=12 HEAD` for the stamp. Any later commit makes the record stale and
requires the review again. Never tick the box while a finding remains.
