---
name: domain-review
description: Pre-merge domain-correctness review — are the published values physically right, sensible and authentic? Runs the catalog audit (converters, spec conformance, HA semantics, byte layout) and judges what the audit cannot. Required before EVERY PR merge; a PR that cannot change what a value means clears in seconds, but a person has to say so.
---

# domain-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

The other gates ask engineering questions. `$project-review` asks whether the project is still
consistent; `$feature-docs` asks whether the feature catalog is still accurate. Both pass happily on
a value that is **physically false**.

That is this project's characteristic failure. A wrong converter id compiles, passes every host
test, drifts no doc, and publishes `-971.5 °C` to Home Assistant as a mixed-water temperature. It
shipped on eight profiles at once. A bizone valve *position* shipped as a 12800 °C temperature
sensor; a "no data" sentinel shipped as a real `-3276.8 °C` reading (issues #35–#39). Every one was
found by a slow manual review — none by a gate, because no gate was asking "**is this true?**".

This review asks that. Nothing here is about style or structure.

**It runs before EVERY merge** — there is no "this PR doesn't need it". That is deliberate. Deciding
in advance which files can change a value's meaning is a guess, and it is the same guess that let
#35–#39 ship: a valve position reached Home Assistant as a 12800 °C temperature sensor through the
ordinary discovery path, not through anything that announced itself as risky. So "nothing here can
change what a value means" is a **finding you state**, not an assumption made for you.

Most PRs clear in under a minute — see §0. The cost is small; the thing it prevents is a wrong
number in someone's house, forever, silently.

## 0. If the PR has no value surface

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
| `LABEL-UNIT` | One wire field, two different physical units in its label across the catalog — the label is the HA entity id and the VictoriaMetrics series suffix, so a false unit word publishes a false quantity (#230). Judged on the **published** (adjudicated) label, so a `logic/label_override.hpp` correction clears it — #230 A's fan step is fixed there and no longer fires. Compared on the UNIT alone: per-family *naming* differences are expected and never reported. |
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

The audit is blind in five specific places. This is where the review earns its keep.

1. **Authenticity — the audit is silent on rows the spec never names.** It can only compare against
   what is documented; a *new* row at an undocumented offset matches nothing and passes clean. So a
   plausible, well-formed, entirely **invented** value sails straight through. For every added or
   changed row, ask where it came from: a decode of the real value catalog by the offline generator
   (`gen_profiles.py`, maintained outside this repo), or a live capture? Generated `def/*` must come
   from the generator, not a hand-edit. "It looks right" is not provenance — a fabricated register
   offset looks exactly as right as a real one.

2. **The oracle itself.** The audit *uses* `convert()` as ground truth, so it **cannot audit its own
   converters**. A PR touching `main/logic/convert.hpp` moves the ground truth under the audit's
   feet: the catalog will still "agree" with a converter that is now wrong. Check any converter
   change directly against `docs/REGISTERS.md` §3 (width, signedness, scale, endianness, sentinel),
   and require a byte-level `CHECK` in `test/test_logic.cpp` pinning input bytes → expected value.

3. **The spec is editable.** `docs/REGISTERS.md` is the audit's authority, so editing it *changes
   what the gate believes*. A finding can be "resolved" by rewriting the spec to match the bug —
   passing the gate while making the firmware more wrong. If the PR touches §5 rows or §3
   converters, that edit is the primary thing under review: what evidence backs the new spec?

4. **Meaning, not just magnitude.** The audit checks that a °C row is typed °C. It cannot tell you
   the label is wrong, the enum ordering is off (`OP_MODE`/`IU_MODE`/`ERR_TYPE` — an off-by-one maps
   "Cooling" onto "Heating" with no numeric tell), the unit is right but the *quantity* is another
   sensor's, or that a model profile claims a sensor the unit does not physically have.

5. **Detection.** `logic/detect.hpp` / `def/signatures.hpp` pick which profile a unit gets. A
   mis-identified model applies a whole wrong table — every value plausible, all of them another
   model's. Detection re-runs every boot and is never persisted, so a regression re-breaks forever.

## 3. Sanity, physically

For any value the diff adds or changes, ask what a **real heat pump** does: a water temperature that
can only read 0.0–25.5 °C and never negative (a size-1 conv-105 field) is not a temperature sensor,
it is a bug that happens to look plausible. Pressure, flow, valve steps and capacity codes have
ranges too. The audit's envelopes catch the impossible; you catch the *implausible*.

## 4. Verify, don't assert

`scripts/run-mock-tests.sh` must pass, and new decode/format logic needs a `CHECK` in
`test/test_logic.cpp` — catalog-wide guards where a whole class can regress (the pattern issue #39
established, e.g. the water-pressure loop at `test/test_logic.cpp:209-220`). If the audit itself
changed, `tools/domain/selftest.sh` must still catch all four historical bugs.

Report findings grouped by section above. **Block the merge** on: any live audit finding, an
invented/unsourced value, a converter or spec change without evidence, or a new exceptions entry
that lacks one.

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) refuses
supported PR merge paths until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head. When the review passes with **no
blocking findings**, tick + stamp it with the reviewed commit:

```
- [x] `$domain-review` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

Edit the PR body with `gh pr edit <pr> --body-file <file>` (or the GitHub MCP update tool in
web/remote). Any later commit re-stales the stamp, forcing a fresh review before the next merge.
Don't tick it if findings block the merge — fix first.
