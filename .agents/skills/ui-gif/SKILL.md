---
name: ui-gif
description: Keep the README's dashboard recording (docs/media/dashboard.gif) current and visibly error-free. Runs the mechanical gate, re-records every normal operating state with smooth transitions, inspects every resulting frame for capture failures, and judges whether the picture honestly shows what the firmware does. Use after any change that reaches the dashboard drawing, its pills, its animations or its copy.
---

# ui-gif

## Authorization boundary

Treat review and audit work as read-only unless the user explicitly asks for a change. Do not edit
files, update GitHub state, merge, flash, deploy, clear evidence, or mutate a live system merely
because this skill activated. When a mutation is explicitly requested, keep it within that scope and
report analysis, changes, and verification separately.

The GIF audit checks freshness in CI; CI also runs Chrome/Chromium rendering checks. Re-recording
and the complete decoded-frame review remain local. A matching stamp proves freshness, never
capture quality or visual truth. Never hand-edit `tools/uigif/gif_stamp.txt`; never use
`--allow-identical-gif` unless a real re-record reproduced identical bytes.

**Conditional — and keyed on the audit, not on paths.** It is for changes that reach the drawing:
`main/www/index.html`'s schematic figure, the `sc-*` half of
`main/www/style.css`, the painting functions in `main/www/js/schematic.js` (`renderLive`, `liveData`,
`clearSchematic`, `plantState`, `sysSet`, `vLwt`), the scene definitions in
`tools/uigif/scenes.js`, or the recorder's framing in `scripts/record-dashboard-gif.sh`. Those are
exactly the sources the gate fingerprints — and they share their files with the settings modal, the
charts and the value list, which is why the merge hook asks the audit rather than a path regex: an
edit that cannot move a pixel must not cost anybody a 10-minute re-record. So **the gate tells you
whether it applies** — run it first. When the user asked to make or finalize relevant changes,
re-record and apply the fixes; for review-only work, report the findings without mutating files.

## 0. Step 0 — pin the baseline

Record `git rev-parse HEAD`, the intended comparison base, and `git status --short` before
auditing. For a PR, verify that the checkout matches the exact target PR head; refresh remote
refs with `git fetch origin` when needed and available. For an authorized local implementation,
include the intended tracked diff and untracked new files in the review and identify them in
the report; no commit, PR or equality with `origin/main` is required. Preserve unrelated user
changes. Stamp a merge pass only after the reviewed content matches the exact committed PR head.

## 1. Run the gate (the mechanical half)

```bash
scripts/run-ui-gif-audit.sh        # 0 = current, 1 = findings, 2 = the fingerprint could not be taken
scripts/run-ui-gif-audit.sh -v     # + the per-source hashes and the GIF's real frame count/delays
```

| Code | Means |
|---|---|
| `U001` | The UI moved and the recording did not. Names which source changed (markup / css / painting code / strings / scenes / framing). |
| `U002` | The GIF on disk is not the file that was stamped — hand-edited, re-compressed, or swapped in. |
| `U003` | The GIF is missing, or the README no longer embeds it (a recording maintained for a page that stopped showing it). |
| `U004` | Not an animation any more: a single frame, or frames held over 200 ms. The flow, the fan and the pump have to be **seen** moving — that is what the recording is for. |
| `U005` | No stamp — nothing says which UI this GIF is of. |

**Exit 2 is not a pass.** In check mode it means the checker could no longer find what it
fingerprints (a renamed painting function, `.sc-flow` gone from the CSS), so *nothing* was checked.
Fix the extractor in `tools/uigif/check_ui_gif.mjs` — or the rename — and re-run
`tools/uigif/selftest.sh`. It is also the exit for a **refused stamp** (`--write-stamp` with sources
that moved over an unchanged GIF): that one is not a bug to fix, it is the gate telling you the
recorder did not actually produce a new recording — check the recorder's output before re-running.

**There is no exceptions ledger, on purpose.** The other audits have one because their findings are
questions about intent; this one has a single answer — re-record. A "this change cannot alter a
frame" entry would be a guess about pixels, and the machine that can settle it is on your desk.

## 2. Re-record

```bash
scripts/record-dashboard-gif.sh        # ~10 min: 135 frames, then stamps
scripts/record-dashboard-gif.sh --keep-frames   # leaves the PNGs for inspection
```

Local only — needs Chrome and ffmpeg. What it films is the **real UI**: `index.html` + `style.css`
+ the ordered `app.sources` fragments spliced exactly as the firmware build splices them
(`tools/uigif/build_demo.py`), with
only the *device* stubbed (`tools/uigif/scenes.js`). Nothing about the drawing is re-implemented,
so what the GIF shows is what `renderLive()` drew.

Preserve posed animation time (`window.__pose(t, T)`), whole-cycle loop timing, sequential
Chrome capture with settled PNGs, and the served-page identity check. After re-recording, confirm
the GIF changed and inspect a frame the edit should have changed. For recorder/framing changes or
capture failures, read [recording notes](references/recording-notes.md).

## 3. Prove the resulting GIF is free of capture errors

**Mandatory after every re-record:** inspect the newly encoded GIF itself. A successful recorder
exit, a fresh stamp and a green audit are not completion evidence; all three can describe a GIF that
contains a browser error page, a blank frame, an incomplete render or one broken transition.

- Record with `--keep-frames` whenever practical, but judge the decoded
  `docs/media/dashboard.gif`, not only the source PNGs. Encoding and frame disposal can introduce a
  defect after the screenshots were taken.
- Cover **all 135 encoded frames** in the visual inspection. Contact sheets are acceptable if they
  remain large enough to expose browser/network error pages, blank or partly painted frames,
  unexpected browser chrome, clipping and discontinuities. Looking at one frame per scene is not
  enough: a single failed transition frame still makes the recording defective.
- Inspect the first frame, the final frame and the complete final-to-first transition separately at
  readable size. This seam is a required check, not a representative sample. Also inspect at least
  one short consecutive sequence from an active scene to confirm that fan, pump and flow motion are
  continuous rather than duplicated stills.
- Reject the artefact if **any** frame contains `ERR_CONNECTION_REFUSED`, another Chrome error page,
  an empty/white capture, a partially loaded dashboard, an unintended page section, a broken crop or
  a transition that does not land cleanly on the next scene. Fix the recording cause and re-record;
  never hide, delete or replace only the bad frame.

Do not report the GIF as updated until this inspection passes. In the result, state explicitly that
all frames were covered and that the first frame, last frame and loop seam were checked. If the
environment cannot render or inspect the finished GIF, the workflow is blocked rather than passed.

## 4. Judge what the gate cannot (the half that needs a brain)

Look at the finished GIF. Then ask:

1. **Are all nine operating scenes still true?** Standby → Heating → Defrost → Circulation →
   DHW + BSH → Heating + DHW → Cooling + DHW → Cooling → Cooling residual circulation. Together
   they cover every normal `plantState()` result and every published `IU_MODE` state
   (`logic/convert.hpp`). Fault, warning and link-loss presentations are diagnostics, not operating
   scenes. A new normal state belongs in this sequence, not in a second GIF.
2. **Does it still show the honest behaviour?** The standby scene is the point of the whole
   recording: held X10A values never appear as current. Discharge and the INV-based electrical
   estimate read `—` because the outdoor unit stops refreshing those pages while it rests
   (`logic/ou_stale.hpp`); outdoor air is the live HomeHub measurement and is petrol, because that
   independent sensor keeps measuring. ΔT blanks with no flow. That is the firmware's central claim
   about itself — a recording that quietly shows the retained X10A outdoor value advertises the
   opposite of what this project does. A scene with nothing moving is correct, not a broken frame.
3. **Are the numbers physically coherent?** They are invented, but they are read as real: leaving
   water above the tank temperature during a charge, ΔT and flow consistent with the stated kW
   (`flow/60 × 4.186 × ΔT`), a DHW COP near 2.5–3 and a 38 °C heating COP near 4–5, the CT current
   matching the electrical estimate. A COP of 8 in the README is the legacy-35–legacy-39 failure shape with a
   marketing budget.
4. **Do the labels come from the real catalog?** `tools/uigif/scenes.js` uses the exact rows of a
   real profile (`main/def/altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw.hpp`). A label invented
   to make a pill appear would show a value the firmware never publishes.
5. **Is it in English?** The harness forces `navigator.language` to English because the README is;
   the UI otherwise follows the browser (`docs/DESIGN.md` §2). A German GIF in an English README is
   the usual accident on a German machine.
6. **Is the crop still right?** Capture the schematic card without the version header or adjacent
   cards. Measure `document.querySelector("#schem").getBoundingClientRect()` on the real demo at the recorder's
   `VIEWPORT` and `SCALE`; do not trust the old crop or its comment. Build the demo with
   `python3 tools/uigif/build_demo.py "$PWD" /tmp/m/demo.html`, serve it and use Chrome at
   `--window-size=1000,760 --force-device-scale-factor=2 --hide-scrollbars`. `CROP` is
   `width:height:x:y` in device pixels (CSS × `SCALE`); allow 12 px at the sides, 8 px above and
   about 5 px below. Update the measured recorder comment and re-record when framing changes.
7. **Is it still a reasonable size?** ~2 MB for 135 frames. GitHub serves it on every README
   view; if a change pushes it past a couple of megabytes, drop `WIDTH`, `DWELL_FRAMES` or
   `TRANSITION_FRAMES` before dropping the frame rate — motion is the thing being paid for.

## 5. Verify, don't assert

```bash
scripts/run-ui-gif-audit.sh    # must be clean, and the stamp must be the one you just recorded
tools/uigif/selftest.sh        # if you touched the checker: every case still caught
scripts/run-schematic-audit.sh # the drawing the GIF is OF must itself be sound
node test/test_ui_bundle.mjs   # parses the exact ordered script the harness receives
```

Then perform the mandatory all-frame and seam inspection in §3. The gate proves the GIF is current;
only the decoded-frame review can prove that the recording contains no capture failure, and only the
semantic review in §4 can establish that it is a good picture of the firmware.

## 5b. Self-analysis and asset self-optimization

Before concluding or stamping:
1. **Asset budget analysis:** Inspect `docs/media/dashboard.gif` size and dimensions:
   - File size must remain reasonable (~2.0–2.5 MB). If exceeded, optimize palette or adjust `DWELL_FRAMES` before considering frame rate reductions.
   - Frame count must match `SCENES × (DWELL_FRAMES + TRANSITION_FRAMES)` in the recorder
     (currently 135), and frame timing must match `STEP_MS` (currently 100 ms).
2. **Loop continuity & visual truth:**
   - Confirm that the final frame blends seamlessly back into frame 1 with no visible restart jump.
   - Verify that no browser error banner, scrollbar, or unwanted element from adjacent cards appears in the cropped viewport.
3. **Review outcome:** Report visual or size defects. When fixes or a new recording are explicitly
   authorized, refine recorder parameters, re-record and re-verify with `scripts/run-ui-gif-audit.sh`.
   Review-only work leaves the recording and stamp unchanged.

## 6. Keep the contract in sync

`README.md` § Web UI is the copy that surrounds the recording — if a scene changes, the sentence
describing what the dashboard states changes with it. `AGENTS.md` and `CONTRIBUTING.md`
list the local gates; a new check here belongs in both. Since this became a merge gate, the PR
template carries its checkbox and `tools/agent-hooks/require-pr-gates.sh` carries the runner-neutral
enforcement. The audit itself is the only definition of when it applies, so widening what the gate
covers means widening what `check_ui_gif.mjs` fingerprints, never a list in prose that points at it.
If the schematic itself changed, this skill is the *second* half of that work —
`$schematic-review` decides whether the drawing is true, and this one makes sure the README stops
showing the old one.

## 7. Recording the pass (merge gate — no file marker)

The runner-neutral [`require-pr-gates.sh`](../../../tools/agent-hooks/require-pr-gates.sh) refuses
supported PR merge paths until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head:

```text
- [x] `$ui-gif` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```
