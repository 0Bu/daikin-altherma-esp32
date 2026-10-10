---
name: domain-review
description: Pre-merge domain-correctness review — are the published values physically right, sensible and authentic? Runs the catalog audit (converters, spec conformance, HA semantics, byte layout) and judges what the audit cannot. Required before every ordinary PR merge; the sole exception is CI-attested Renovate Action-pin-line-only platform automerge.
---

# domain-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

Review every ordinary merge for published-value truth. Run the real catalog audit and inspect
the complete diff before deciding a change is value-neutral; labels, discovery and detection can
change physical meaning without changing a converter. Read
[domain review background](references/review-background.md) when assessing a historical defect or
the limits of the audit oracle.

The sole exception is not a path guess made by an agent: authoritative CI may waive human records
only after protected-base policy proves immutable patches for the exact same-repository, one-commit
Renovate head contain nothing but the fully pinned Renovate runner replacement in `renovate.yaml`.
The exception is unavailable to local/manual merge paths and fails closed for missing metadata or
any mixed edit.

## 0. Step 0 — pin the baseline

Record `git rev-parse HEAD`, the intended comparison base, and `git status --short` before
auditing. For a PR, verify that the checkout matches the exact target PR head; refresh remote
refs with `git fetch origin` when needed and available. For an authorized local implementation,
include the intended tracked diff and untracked new files in the review and identify them in
the report; no commit, PR or equality with `origin/main` is required. Preserve unrelated user
changes. Stamp a merge pass only after the reviewed content matches the exact committed PR head.

## 0b. If the PR has no value surface

Run the audit anyway (§1 — it takes seconds), then look at the diff and confirm it cannot reach a
published value. Ask specifically: does it touch `main/def/`, the converter/register/discovery/
detect logic, the poll/decode glue, `docs/REGISTERS.md`, the profile generators, or a decode `CHECK`?
Does it change a label, a unit, a `type` code, an offset, a converter id, or an enum table? Could it
change *which* profile a unit gets? If the honest answer to all of that is no and the audit is
clean, record that — say what you checked, not just "N/A":

```
- [x] `$domain-review` clean — merge gate @ <sha>   (audit clean; diff touches only <X>, cannot reach a value)
```

If any answer is yes, or you are unsure, do the full review below. Being unsure is not a reason to
skip it; it is the reason the gate is unconditional.

## 1. Run the audit (the mechanical half)

```bash
scripts/run-domain-audit.sh     # 0 = clean, 1 = findings, 2 = parse error
```

It runs the **real** converters (`main/logic/convert.hpp`) over the **real** catalog
(`main/def/`) and cross-checks both against the spec tables in `docs/REGISTERS.md` §5 — so there is
no second implementation to drift. Each finding carries a **decode witness**: concrete wire bytes,
what the value *should* read, and what this row makes of it.

| Finding | Means |
|---|---|
| `SPEC-CONV` | The spec names this value; this row decodes it differently. |
| `SPEC-LAYOUT` | On a shared outdoor page, the spec says a different field lives at this offset. |
| `CONSENSUS` | The rest of the catalog decodes this same value differently. |
| `LABEL-UNIT` | One wire field, two different physical units in its label across the catalog — the label is the HA entity id and the VictoriaMetrics series suffix, so a false unit word publishes a false quantity (legacy-230). Judged on the **published** (adjudicated) label, so a `logic/label_override.hpp` correction clears it — legacy-230 A's fan step is fixed there and no longer fires. Compared on the UNIT alone: per-family *naming* differences are expected and never reported. |
| `SEMANTICS` | A non-temperature (valve position, step, pulse count) is typed °C — HA gets a phantom temperature entity. |
| `OVERLAP` | Two rows straddle each other's bytes: one value is fabricated, the other lost. |

**Exit 2 is not a pass.** It means the spec could not be parsed — the audit checked nothing.

A finding is a **question, not a verdict**: `docs/REGISTERS.md:196-200` is explicit that the §5
table is one representative model and that families differ. Resolve each against the spec and, where
it matters, a real unit. Genuinely-correct deviations go in `tools/domain/audit_exceptions.txt` with
evidence and stay visible in the "suppressed" list. What must never happen is adding an entry to
make a *new* finding quiet — that is how `-971.5 °C` shipped. If a finding is wrong because the
**check** is wrong, fix `tools/domain/catalog_audit.cpp` and re-run `tools/domain/selftest.sh`.

## 2. Judge what the audit cannot (the half that needs a brain)

Check each of these five boundaries:

1. **Authenticity.** Every added/changed row needs provenance from the offline value-catalog
   generator (`gen_profiles.py`, maintained outside this repo) or a real capture. Generated
   `main/def/` rows must not be hand-edited; plausible bytes and labels do not establish a source.
2. **Converter oracle.** The catalog audit uses `convert()`, so compare converter changes against
   `docs/REGISTERS.md` §3 and require a byte-level `CHECK` in `test/test_logic.cpp` pinning width,
   signedness, scale, endianness and sentinels. A catalog agreeing with changed math is insufficient.
3. **Editable spec.** Review evidence behind every changed §3/§5 spec claim. Updating the spec to
   match an implementation does not prove either is correct.
4. **Meaning.** Verify quantity, labels, units, enum ordering (`OP_MODE`/`IU_MODE`/`ERR_TYPE`) and
   physically present model sensors; a correct numeric range alone cannot establish them.
5. **Detection.** Trace `main/logic/detect.hpp` and `main/def/signatures.hpp` candidate selection.
   A wrong profile can produce plausible readings from another model. Detection must rerun each
   boot and must not persist a model identity.

## 3. Sanity, physically

For any value the diff adds or changes, ask what a **real heat pump** does: a water temperature that
can only read 0.0–25.5 °C and never negative (a size-1 conv-105 field) is not a temperature sensor,
it is a bug that happens to look plausible. Pressure, flow, valve steps and capacity codes have
ranges too. The audit's envelopes catch the impossible; you catch the *implausible*.

## 4. Verify, don't assert

`scripts/run-mock-tests.sh` must pass, and new decode/format logic needs a `CHECK` in
`test/test_logic.cpp` — catalog-wide guards where a whole class can regress (the pattern issue legacy-39
established, e.g. the water-pressure loop at `test/test_logic.cpp:209-220`). If the audit itself
changed, `tools/domain/selftest.sh` must still catch all four historical bugs.

Report findings grouped by section above. **Block the merge** on: any live audit finding, an
invented/unsourced value, a converter or spec change without evidence, or a new exceptions entry
that lacks one.

## 4b. Self-analysis and review audit

Before ticking or stamping the gate:
1. **Physical reality meta-check:** Did this review verify that numbers make sense on a real machine (temperatures within physical operating envelope, sensible units, valid converter IDs) rather than only verifying that scripts exited zero?
2. **Audit exceptions validation:** If `tools/domain/audit_exceptions.txt` was modified, confirm that the addition is a genuine hardware variance backed by evidence, not a suppression of an uninvestigated discrepancy.
3. **Stamp integrity check:** Confirm the stamp uses the bare short SHA (`git rev-parse --short=12 HEAD`) without backticks or extra formatting.

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) refuses
ordinary supported PR merge paths until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head. When the review passes with **no
blocking findings**, tick + stamp it with the reviewed commit:

```
- [x] `$domain-review` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

Edit the PR body with
`scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr edit <pr> --body-file <absolute-physical-temp-path>/review-body.md`.
Any later commit re-stales the stamp, forcing a fresh review before the next merge.
Don't tick it if findings block the merge — fix first.
