---
name: schematic-review
description: Review the dashboard schematic — the inline SVG in main/www/index.html, its CSS, and its bindings. Run the mechanical audit and judge whether the drawing tells the truth about the plant, places elements correctly, and has correct bilingual copy. Use after schematic, pill, pipe, binding, or inspector-copy changes. Report findings by default; apply fixes only when explicitly requested.
---

# schematic-review

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

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

**This review unlike `$domain-review` is conditional** — it is for changes that reach the drawing:
`main/www/index.html`, `main/www/style.css`, the `INSPECT` / `I18N` / `liveData` / `paintSchematic`
half of `main/www/js/schematic.js` plus `i18n.js`, or `docs/DESIGN.md` §5.3 / §7. A change that
cannot reach the drawing does not need it. Report findings; apply fixes only when the user explicitly
requests them.

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
| `S004` / `S005` | An `id` the SVG declares and the assembled UI never writes, or the reverse — a silent no-op either way. |
| `S006` | A `data-i18n` key missing from a language dict — the German page prints English, or the raw key. |
| `S007` / `S008` / `S009` | Duplicate id / dangling `<use>` / character data adrift in the SVG. |
| `S011` | A drawn pipe inside no hit target — unhoverable, and it fails by absence: nothing looks wrong. |
| `G001`–`G005` | Outside the viewBox, overlapping, struck through by a pipe, overflowing its pill, skewed. |
| `G006` | A pill too far from — or not over — the run it names. The defect class the gate exists for. |
| `G007` / `G012` | A rotor whose bounding box is not centred on its hub, or the pump rotating counter-clockwise instead of clockwise. |
| `G008` / `G009` | A run off the two-level grid, or a box whose margins no longer match it. |
| `G010` | An animated flow overlay tracing no drawn pipe — the two copies of one path have drifted. |
| `G011` | A run's *invisible* tap area reaching into a fitting drawn earlier. The hit lines are `stroke-linecap: round`, so each covers half a stroke past its declared endpoint; every trim had been computed as if the cap were flat, and the 3-way valve outlined itself on hover and then opened the DHW branch. Says nothing about two hit lines meeting — that place is genuinely shared, and `E004` decides whose it is. |
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
   pages while it rests, so held X10A values never repeat the last run as current. Discharge and the
   INV-based electrical estimate **blank**; outdoor air may instead show the live, structurally
   paired HomeHub measurement in petrol. Its inspector must then name that Modbus row rather than
   restore the stale X10A one or claim there is no current reading. Its trend may overlay the blue
   X10A gap with the independent petrol HomeHub ring, but must label both sources and align the same
   5-minute bucket — never splice them into one repaired line. ΔT blanks with the pump stopped.
   A new pill on page `0x20`/`0x21` needs the same held-over treatment, and the gate cannot see that
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
gets made against a rule nobody still follows. `AGENTS.md` and `CONTRIBUTING.md` list the
local gates; if the audit itself grew a rule, say so where the gate is described.

Report findings grouped by the sections above. If fixes were explicitly requested, apply them and
re-run the verification. Block the merge on: any
live audit finding, a reading attributed to a part that does not measure it, a new pill that cannot
blank when its page goes stale, or a ledger entry added to quiet a finding this change created.

## Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) refuses
supported PR merge paths until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head. It is **conditional**, like
`$feature-docs` and unlike `$project-review` and `$domain-review`: it fires when the PR reaches the
drawing, its contract, or the tools that judge it — **including this file**, so changing what the
review asks means putting the new questions to the current drawing before it lands. Its canonical
filter is defined by the runner-neutral gate. This page deliberately does not repeat the filter.

That filter is defensible here in a way it deliberately is **not** for `$domain-review`, and the
difference is the point: a value's meaning can change from almost anywhere — #35–#39 reached Home
Assistant through the ordinary discovery path — while the drawing is one inline SVG, one stylesheet
and one binding table. If that ever stops being true, the regex must grow with it, or it will quietly
opt exactly the risky PRs out.

When the review passes with **no blocking findings**, tick + stamp it with the reviewed commit:

```
- [x] `$schematic-review` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

Edit the PR body with
`scripts/gh-with-git-credentials.sh --repo github.com/0Bu/daikin-altherma-esp32 pr edit <pr> --body-file <file>`.
Any later commit re-stales the stamp, forcing a fresh review. Don't tick it if findings
block the merge — fix first. The gate fails **closed**: if GitHub can't be read, the merge is
blocked with guidance.
