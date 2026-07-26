---
name: schematic-review
description: Review the dashboard schematic — the inline SVG in main/www/index.html, its CSS and its bindings. Runs the mechanical audit (structure, geometry, editorial) and then judges what the audit cannot: does the drawing still tell the truth about the plant, is a new element in the right place, is the copy right in both languages. Use after any change to the schematic, its pills, its pipes or its inspector copy — and applies the fixes.
model: opus
---

# schematic-review

The dashboard schematic is the whole "what is the plant doing right now" answer (`docs/DESIGN.md`
§5.3). It is also the one artefact in this repo where **every gate can be green and the picture can
still be false**: the firmware builds, the host logic tests pass, the domain audit confirms the
value is physically right, the description audit confirms there is copy for it — and the drawing
puts that correct reading on the wrong pipe.

That is not hypothetical. This drawing has shipped a fan spinning around a point beside its own
axle, a leaving-water pill floating 40 px above the run it names, the return temperature drawn on
the heating-only section (claiming a branch no sensor there reads), and "HEIZUNG" struck through by
the heating riser so it rendered as "HEIZUNC". Each is the #35–#39 failure shape drawn in SVG:
well-formed, plausible, and attributing a real number to the wrong thing.

**This review unlike `/domain-review` is conditional** — it is for changes that reach the drawing:
`main/www/index.html`, `main/www/style.css`, the `INSPECT` / `I18N` / `liveData` / `paintSchematic`
half of `main/www/app.js`, or `docs/DESIGN.md` §5.3 / §7. A change that cannot reach the drawing
does not need it. **You apply the fixes**, you do not just report them.

## 1. Run the audit (the mechanical half)

```bash
scripts/run-schematic-audit.sh        # 0 = clean, 1 = findings, 2 = parse/vacuity error
scripts/run-schematic-audit.sh -v     # + every pill with the run it is tied to, and the rotors
```

It parses the **real** SVG and evaluates the **real** binding tables — there is no second copy of
the coordinates or the regexes to drift. **Exit 2 is not a pass**: it means the drawing could not be
read (a renamed class, a missing marker), so nothing was checked.

| Code | Means |
|---|---|
| `S001` | A hit target with no `INSPECT` entry — tapping it opens an empty panel. **Not adjudicable.** |
| `S002` | An `INSPECT` entry with no hit target — copy nobody can reach. |
| `S003` / `S010` | A `sample` that names no catalog register / matches no `DESCRIPTIONS` entry (a blank explainer). |
| `S004` / `S005` | An `id` the SVG declares and app.js never writes, or the reverse — a silent no-op either way. |
| `S006` | A `data-i18n` key missing from a language dict — the German page prints English, or the raw key. |
| `S007` / `S008` / `S009` | Duplicate id / dangling `<use>` / character data adrift in the SVG. |
| `S011` | A drawn pipe inside no hit target — unhoverable, and it fails by absence: nothing looks wrong. |
| `G001`–`G005` | Outside the viewBox, overlapping, struck through by a pipe, overflowing its pill, skewed. |
| `G006` | A pill too far from — or not over — the run it names. The defect class the gate exists for. |
| `G007` | A rotor whose bounding box is not centred on its hub; the CSS pivots on the **bbox**, so it orbits. |
| `G008` / `G009` | A run off the two-level grid, or a box whose margins no longer match it. |
| `G010` | An animated flow overlay tracing no drawn pipe — the two copies of one path have drifted. |
| `E001` | A pill whose unit repeats in the drawing and which carries no name. |
| `E002` | A reading drawn past a junction, on a branch its sensor does not read. **Not adjudicable.** |
| `E003` / `E004` | A flow overlay, or a hit target, spanning a junction — one animation (or one highlight) asserting two branches' states at once. |

A finding is a **question, not a verdict** — except `S001` and `E002`, which the ledger refuses
outright. A finding that is correct as it stands goes in `tools/schematic/audit_exceptions.txt` as an
`ADJUDICATION` (with the decision it cites) or a `KNOWN-DEFECT` (with what is wrong, deleted by its
fix). Never add an entry to quiet a **new** finding on something this change touched — that is the
gate working. If a finding is wrong because the **check** is wrong, fix
`tools/schematic/check_schematic.mjs` and re-run `tools/schematic/selftest.sh`.

## 2. Judge what the audit cannot (the half that needs a brain)

The audit knows where things are. It does not know what they **mean**. Everything below is blind to
it, and this is where the review earns its keep.

1. **Is the picture still true of the plant?** The component order is the manufacturer's, not a
   drawing convenience (installer reference §16.2: exchanger → R1T → backup heater → pump → R2T →
   outlet, then the field-supplied 3-way valve). The pump is on the **supply** side; drawing it in
   the return misplaced a real part. The tank and the heating circuit are two **loads the valve
   alternates between**, so they sit side by side on one level, not stacked. A pill sits at its
   physical measuring point. Check any moved or added part against the real hydraulic layout, not
   against what balances the frame.

2. **Is a new reading attributed to the right sensor?** The audit checks that a pill sits on *a*
   pipe; only you can check it is *the* pipe. R1T is at the exchanger's water outlet **before** the
   backup heater — which is why its sub-label says "pre-BUH" and why `logic/lwt_select.hpp` exists.
   The high-pressure pill draws `d.circP` (the compressor's transducer while running, the live
   refrigerant sensor at rest), so its headline must resolve **that** row and not the HP row on
   principle. A number under the wrong name is the failure this whole card is built to avoid.

3. **Does it blank when it must?** `logic/ou_stale.hpp`: the outdoor unit stops refreshing its own
   pages while it rests, so outdoor air, discharge and the INV-based electrical estimate **blank**
   rather than repeat the last run's values — and the inspector says why. ΔT blanks with the pump
   stopped. A new pill on page `0x20`/`0x21` needs the same treatment, and the gate cannot see that
   the value it draws is stale.

4. **Does the drawing still carry readings only?** No annotations, no captions, no "estimated" in
   the picture — that is the inspector's half (§5.3). A sub-label is only ever the measurement's
   **name**. The one exception is the "≈" on the two derived pills: without it a bare "4.6 kW" reads
   as measured.

5. **Copy, in both languages.** The audit checks a key EXISTS in both dicts; it cannot read German.
   Check the new string is right, is terse in the house register, fits its pill in the longer
   language, and — for an inspector entry — that `now` still distinguishes the cases it must (the
   `pel` entry's "held over from the last run" versus "this profile has no current row" is the
   worked example: suppressing one wrong claim must not stand a second one in front of it).

6. **Does it degrade honestly per model?** Every value maps over `/values` label patterns, so a
   model without the row must hide the branch or show "—", never a confident 0.0. A new element
   needs its `.no-*` class or its hidden state thought through.

7. **Accessibility and motion.** Every hit target is a `<g role="button" tabindex="0">` named by its
   `INSPECT` title; the SVG is a labelled `role="group"`, never `aria-hidden` (a hidden subtree must
   not hold focusable elements). Animations are pure CSS and stop under `prefers-reduced-motion`,
   with the active branch still distinguishable by colour. Shape and words carry state, never colour
   alone (§9).

## 3. Verify, don't assert

```bash
scripts/run-schematic-audit.sh     # must be clean (adjudications printed, not hidden)
tools/schematic/selftest.sh        # if you touched the audit: all cases still caught
scripts/run-description-audit.sh   # an INSPECT `sample` resolves through the SAME table
scripts/run-mock-tests.sh          # lwt_select / ou_stale — the browser rules CI gates in C++
```

If the change moved a rule the browser shares with the firmware (which row is *the* leaving water,
which pages freeze), the host test is the authority: `logic/lwt_select.hpp` and `logic/ou_stale.hpp`
exist precisely so a looser second copy in JS cannot quietly replace them. Every browser consumer
must resolve through the one `lwtRow()`.

## 4. Keep the contract in sync

`docs/DESIGN.md` §5.3 (the dashboard) and §7 (component vocabulary) are the drawing's specification,
not a description of it. A new component, a new pill, a changed rule about naming or blanking lands
in **both** the SVG and the spec — a drawing that has outgrown its contract is how the next change
gets made against a rule nobody still follows. `.claude/CLAUDE.md` and `CONTRIBUTING.md` list the
local gates; if the audit itself grew a rule, say so where the gate is described.

Report findings grouped by the sections above, then **apply the fixes**. Block the merge on: any
live audit finding, a reading attributed to a part that does not measure it, a new pill that cannot
blank when its page goes stale, or a ledger entry added to quiet a finding this change created.
