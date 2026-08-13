---
name: diagnostic-evidence-review
description: Keep every daikin-altherma-esp32 plant diagnosis tied to durable primary sources, the exact production rule, project-only thresholds and explicit claim limits. Use whenever checkup evaluation, sampling, persistence, fault interpretation, retry registers, visible diagnosis rows, docs/REGISTERS.md evidence, docs/DIAGNOSTIC_EVIDENCE.md claims or cited sources change, and before merging any PR that can change what a diagnosis observes or concludes.
---

# Diagnostic Evidence Review

Treat the evidence ledger as part of the implementation. Do not approve a technically plausible
diagnosis until a reader can distinguish a sourced fact from this firmware's rule and from a project
heuristic.

## Review the change

1. Run the gate before editing the stamp:

   ```bash
   scripts/run-diagnostic-evidence-audit.sh
   ```

   Treat `E010` as a review request, not as permission to re-stamp immediately.
2. Read the production diff and trace each affected result through `main/logic/checkup.hpp`,
   persistence, sampling/coverage in `main/checkup.cpp` and `main/hp_poll.cpp`, fault interpretation,
   retry mappings, `/status.health`, `CHECKUP_ROW` and the published evidence fields. Derive behavior
   from current code, not from the issue or old prose.
3. Update [`docs/DIAGNOSTIC_EVIDENCE.md`](../../../docs/DIAGNOSTIC_EVIDENCE.md) for every affected
   diagnosis. State exactly once:

   - `External evidence`: what the source actually establishes and its scope;
   - `Firmware rule`: inputs, validity/coverage requirements, window, threshold and verdict;
   - `Project boundary` or `Experimental boundary`: anything chosen or inferred by this project;
   - `Not established`: causes or whole-system conclusions the result cannot establish.
4. Re-open every external source whose claim, model scope, threshold or citation changed. Prefer, in
   order: the exact official Daikin document for the named model; an official regulation; original
   peer-reviewed research. Do not use search snippets, forums, installer blogs, vendor marketing or
   another project's threshold as authority.
5. Record enough provenance to reproduce the check. For Daikin documents include title, covered
   models, document number, revision, used section and an official HTTPS URL. For regulations and
   research include issuer/authors, title, date or publication, precise article/section and stable
   official/DOI URL. Update the visible source-check date only after opening the affected sources.

## Preserve claim strength

- Call a value a `manufacturer limit` only when the exact model-family document states that limit under
  the relevant operating condition.
- Call a decoded X10A mapping `project evidence`, not a public Daikin protocol guarantee.
- Keep a project-selected threshold a `project heuristic`, even when research supports the general
  physical relationship.
- Keep undocumented counter semantics `experimental`. Missing public manufacturer semantics must
  remain an explicit gap, never be filled by confident prose.
- Keep missing, stale or insufficient evidence `NOT AVAILABLE` or `CHECKING`; never turn absence into
  an `OK` verdict.
- Do not infer one root cause from a pattern that has several plausible causes, and do not turn one
  row's `OK` into a healthy-plant claim.

## Close the review

Run the mechanical checks only after the claims and sources are correct:

```bash
scripts/run-diagnostic-evidence-audit.sh --update
scripts/run-diagnostic-evidence-audit.sh
tools/diagnostic_evidence/selftest.sh
scripts/run-user-docs-audit.sh
scripts/run-ui-use-case-tests.sh
```

Never edit the review fingerprint by hand and never weaken a check to clear a finding. `--update`
records that the current implementation, evidence prose and source catalog were reviewed together;
it does not prove source truth by itself.

In the handoff, name the changed diagnoses and sources, state which thresholds remain project-owned,
and separate code/CI evidence from manual, device or live-plant verification that was not performed.
