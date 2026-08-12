---
name: user-docs-review
description: Keep daikin-altherma-esp32 user-facing help understandable, evidence-bounded and current. Use after changing a visible diagnosis, status, user action, UI explainer, plant-health payload or docs/DIAGNOSTICS.md, and before a PR that changes what a non-specialist sees or must do with a result. Use diagnostic-evidence-review alongside it when implementation rules or sources change.
---

# User Docs Review

Treat user documentation as part of the feature. A technically correct result is incomplete when a
non-specialist cannot tell what it means, what it does not prove, or what to do next.

## Review the change

1. Read the diff and the production evaluator. Identify every changed visible result, threshold,
   status, evidence requirement, limitation and supported user action. Do not infer behavior from a
   ticket or commit message.
2. Trace the result through `/status.health`, `CHECKUP_ROW`, its translated value/detail strings and
   `MODEL_DESCRIPTIONS.health_*`. Verify German and English carry the same claim strength.
3. Update the inline explainer, [`docs/DIAGNOSTICS.md`](../../../docs/DIAGNOSTICS.md) and
   [`docs/DIAGNOSTIC_EVIDENCE.md`](../../../docs/DIAGNOSTIC_EVIDENCE.md) together. Preserve the
   `<!-- user-docs: health_* -->` marker and the evidence heading's stable wire id belonging to each
   visible row.
4. Invoke `/diagnostic-evidence-review` when an external claim, evaluator, threshold, source signal
   or evidence boundary changed. Keep this review focused on whether the resulting explanation is
   understandable and actionable for the owner.

## Write for the owner, not the installer

For every result, answer these four questions in this order:

1. What did the board observe or count?
2. What does this status mean for this one check?
3. What can the result not establish?
4. What can the owner safely check, observe or record next, and when is a Fachbetrieb appropriate?

Introduce a plain word before an abbreviation: “elektrischer Zusatzheizer (BUH)”, not “BUH”. Keep
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
- `docs/DIAGNOSTICS.md`: one marked German section with **Einfach gesagt** and
  **Was du tun kannst**, plus glossary/status updates when needed;
- `docs/DIAGNOSTIC_EVIDENCE.md`: one section keyed by the stable diagnosis id with **Extern
  belegt**, **Firmware-Regel**, **Nicht bewiesen**, and for a filtered/heuristic/experimental check
  an explicit **Projektanteil** or **Experimentelle Grenze**;
- `test/test_ui_checkup.mjs`: behavior and load-bearing wording.

## Run the gate

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

Do not weaken length, bilingual, section, action, source-coverage or bounded-claim checks to clear a
finding. Fix the missing explanation or evidence. In the handoff, name the user-visible wording that
changed and distinguish code/CI verification from anything not checked on a physical heat pump.
