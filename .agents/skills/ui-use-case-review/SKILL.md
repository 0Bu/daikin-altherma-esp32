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

## 0. Step 0 — pin the baseline

Record `git rev-parse HEAD`, the intended comparison base, and `git status --short` before
auditing. For a PR, verify that the checkout matches the exact target PR head; refresh remote
refs with `git fetch origin` when needed and available. For an authorized local implementation,
include the intended tracked diff and untracked new files in the review and identify them in
the report; no commit, PR or equality with `origin/main` is required. Preserve unrelated user
changes. Stamp a merge pass only after the reviewed content matches the exact committed PR head.

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
scripts/run-ui-localization-audit.sh
scripts/run-browser-render-tests.sh
```

Require exit 0. The browser command runs headless Chromium and WebKit in the pinned Linux Docker
image on both macOS and CI. Never start the installed macOS Chrome/Chromium `.app`, even with
`--headless`: a failing native process still produces crash dialogs. Direct browser helpers also
refuse native macOS launches. Docker is required; do not substitute a host browser after a failure.
See [test/README.md](../../../test/README.md#ui-interaction-rendering-and-recording) for the engine
and evidence boundaries.

The UI use-case command executes all `test/test_ui_*.mjs` contracts plus HomeHub discovery, the
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
UI. Derive all shipped locales from `UI_LANGS` in `main/www/js/i18n.js`, including the external
catalogs in `main/www/locales/`. Exercise controls by clicking them; do not infer behavior from
markup. Check:

- no clipped text, overflowing actions or hidden focused controls;
- hidden controls are also disabled and release resources such as GPIO choices;
- focus starts on the dialog, labels and accessible names identify the action, and Escape closes;
- loading, success, rejection, unreachable and empty states remain distinguishable;
- every shipped locale in `UI_LANGS` fits; every changed translation preserves the source meaning
  and claim limits, including copy in `main/www/locales/`;
- browser console errors remain empty throughout the path.

Use deterministic fixtures for visual states. Do not write device configuration during a pre-merge
review unless the user explicitly requested a live-device test.

## 3b. Review continuity under live polling

For polling, rendering, history or animation changes, run the browser gate's temporal matrix as well
as its static locale matrix. Derive the entry inventory from production: every schematic inspector
must either exercise its history or have an explicit no-history classification. Include catalog,
Modbus-only, board-memory and circulation disclosures, derived/categorical graphs, ENV III and the
independent room source. Use full 288-sample rings, source-specific gaps and changing live values
through the real two-second polling/render loop at phone and desktop widths in Chromium and both
iPad orientations in headless WebKit. WebKit must use trusted native touch events and verify actual
painted flow movement as well as animation clocks; its frozen-paint control must fail for that reason.

Observe at least three real updates per case. Require unchanged plots and prose to retain their
nodes and stay connected through scalar updates, no chart construction in collapsed rows, persistent advancing flow/rotor `CSSAnimation`
objects, and the fixed frame/input responsiveness budgets in the browser test. Finite
`CSSTransition`s may finish normally; distinguish them from stopped continuous animations. Exercise
open/close and cached reopen, and require no console errors. Legitimate categorical/history changes
must update the chart and settle before checking continuity again.

Report temporal evidence separately from screenshots, reduced-motion states, GIF poses and device
measurements. A fixture-browser pass does not establish performance on a physical iPad or device
HTTP behavior. The test scope and budget are documented in [test/README.md](../../../test/README.md#ui-interaction-rendering-and-recording).

## 4. Review failure coverage

For every bug fixed in the PR, identify the exact test that fails when the bug is reintroduced. Add a
targeted selftest mutation when the main suite could otherwise pass vacuously. A source regex alone
is insufficient for an interaction defect; execute the handler and assert its outcome.
For continuity changes, prove that the temporal checks reject eager hidden-chart construction,
visible plot/animation replacement and a synchronous polling stall above the fixed budget. A missing
mutation insertion point must fail the control; do not accept an unrelated setup failure or increase
the budget to accommodate a regression.

Block the merge on any uncaught exception, missing handler, action without the promised state change,
unrepresented new use case, live UI assertion failure, or visual/accessibility regression.

## 4b. Self-analysis and review audit

Before ticking or stamping the gate:
1. **Interactive lifecycle check:** Did this review verify the actual action outcome (state transition, endpoint call, error recovery on rejection), rather than only that the button exists and is clickable?
2. **Viewport and accessibility check:** Verify that phone (320px) and desktop (1200px) layouts are clean in every shipped `UI_LANGS` locale, focus is trapped and released properly, and no console errors occurred. A complete mechanical locale matrix does not establish semantic correctness of a changed translation; report any unreviewed copy explicitly.
3. **Stamp integrity check:** Confirm the stamp uses the bare short SHA (`git rev-parse --short=12 HEAD`) without backticks.

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
