---
name: ui-gif
description: Keep the README's dashboard recording (docs/media/dashboard.gif) current with the web UI. Runs the mechanical gate (is the GIF still of THIS UI?), re-records it, and judges what the gate cannot — are the four scenes still the right ones, does the picture still show honestly what the firmware does. Use after any change that reaches the dashboard drawing, its pills, its animations or its copy.
model: opus
---

# ui-gif

`docs/media/dashboard.gif` is the first thing a new user sees in the README, and it is the one
artefact in this repo that **rots invisibly**. It is a recording: it keeps rendering perfectly long
after the thing it recorded has changed. Every other gate stays green while it goes wrong — the
schematic audit checks the live drawing, the description audit checks the copy, the domain audit
checks the values, and none of them can see that the picture in the README shows last month's
pipes, a pill that has since moved, or a component that no longer exists. A screenshot cannot fail
a test. It can only be out of date, and it looks exactly as good either way.

That is why the gate is a **stamp**, not a re-render: CI has no browser. And it is why the gate can
only ever prove the recording is *current* — never that it is *right*. The second half is this
skill's.

**Conditional, like `/schematic-review`** — it is for changes that reach the drawing:
`main/www/index.html`'s schematic figure, the `sc-*` half of
`main/www/style.css`, the painting functions in `main/www/js/schematic.js` (`renderLive`, `liveData`,
`clearSchematic`, `plantState`, `sysSet`, `vLwt`), the scene definitions in
`tools/uigif/scenes.js`, or the recorder's framing in `scripts/record-dashboard-gif.sh`. Those are
exactly the sources the gate fingerprints, so **the gate tells you whether it applies** — run it
first. **You re-record and apply the fixes**, you do not just report them.

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

**Exit 2 is not a pass.** It means the checker could no longer find what it fingerprints (a renamed
painting function, `.sc-flow` gone from the CSS), so *nothing* was checked. Fix the extractor in
`tools/uigif/check_ui_gif.mjs` — or the rename — and re-run `tools/uigif/selftest.sh`.

**There is no exceptions ledger, on purpose.** The other audits have one because their findings are
questions about intent; this one has a single answer — re-record. A "this change cannot alter a
frame" entry would be a guess about pixels, and the machine that can settle it is on your desk.

## 2. Re-record

```bash
scripts/record-dashboard-gif.sh        # ~5 min: 112 frames, then stamps
scripts/record-dashboard-gif.sh --keep-frames   # leaves the PNGs for inspection
```

Local only — needs Chrome and ffmpeg. What it films is the **real UI**: `index.html` + `style.css`
+ the ordered `app.sources` fragments spliced exactly as the firmware build splices them
(`tools/uigif/build_demo.py`), with
only the *device* stubbed (`tools/uigif/scenes.js`). Nothing about the drawing is re-implemented,
so what the GIF shows is what `renderLive()` drew.

Three things about it that are easy to break and hard to notice:

- **One page load per frame.** Wall-clock time cannot survive that, so each frame is *posed*:
  `window.__pose(t, T)` pauses every CSS animation and sets its `currentTime`. Delete that and the
  GIF silently becomes 112 copies of one instant — still valid, still green on `U004`'s frame
  count, and motionless.
- **Each animation gets a whole number of cycles across the total length**, which is what closes
  the loop without a jump. The real periods (dashes 1.1 s, pump 1.6 s, fan 2.6 s) share no
  practical common multiple, so a single shared clock tears two of the three at the seam.
- **Chrome writes the PNG and then lingers** instead of exiting, and parallel headless instances
  wedge. The recorder waits on the *artefact* (file present, size settled) and runs sequentially.
  Both are load-bearing; "obvious" simplifications here cost 15 s per frame or hang the run.
- **It checks that the page being served is the page it just built**, not merely that something
  answers on the port. Its port is also the UI prototype's, so a server left running from an
  earlier session keeps the bind, our `http.server` exits `Address already in use`, and every frame
  is filmed off *that* page — while the stamp is written from the current sources, i.e. a green
  gate over a recording of the old UI. Observed 2026-07-29: a five-hour-old page filmed into a
  byte-for-byte copy of the GIF being replaced. Do not reduce that back to a plain reachability
  check. And whatever the script says: after a re-record, confirm the GIF **changed** (`git status`)
  and pull out a frame your edit should have moved — the audit only proves the stamp matches.

## 3. Judge what the gate cannot (the half that needs a brain)

Look at the finished GIF. Then ask:

1. **Are these still the right four scenes?** Standby → DHW → Heating → Heating + DHW, because they
   are what the *machine* does and they are the four `IU_MODE` states a user recognises
   (`logic/convert.hpp`). If the firmware grew a state worth showing (defrost is the obvious
   candidate — the reversed loop and a genuinely negative ΔT), the scene list is the place, not a
   second GIF.
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
   matching the electrical estimate. A COP of 8 in the README is the #35–#39 failure shape with a
   marketing budget.
4. **Do the labels come from the real catalog?** `tools/uigif/scenes.js` uses the exact rows of a
   real profile (`main/def/altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw.hpp`). A label invented
   to make a pill appear would show a value the firmware never publishes.
5. **Is it in English?** The harness forces `navigator.language` to English because the README is;
   the UI otherwise follows the browser (`docs/DESIGN.md` §2). A German GIF in an English README is
   the usual accident on a German machine.
6. **Is the crop still right?** It is the schematic card alone — deliberately not the dashboard
   header above it, which prints the running version, and a version frozen into a recording is
   wrong from the next release onwards with nothing able to see it. A UI change that alters the
   card's height leaves it clipped, or leaves a sliver of the header or the next card in frame —
   adjust `CROP` in the recorder rather than living with it. Measure, don't guess: the recorder's
   comment carries the CSS box the current numbers came from.
7. **Is it still a reasonable size?** ~750 kB for 112 frames. GitHub serves it on every README
   view; if a change pushes it past a couple of megabytes, drop `WIDTH` or `PER_SCENE_MS` before
   dropping the frame rate — motion is the thing being paid for.

## 4. Verify, don't assert

```bash
scripts/run-ui-gif-audit.sh    # must be clean, and the stamp must be the one you just recorded
tools/uigif/selftest.sh        # if you touched the checker: every case still caught
scripts/run-schematic-audit.sh # the drawing the GIF is OF must itself be sound
node test/test_ui_bundle.mjs   # parses the exact ordered script the harness receives
```

Then **look at the GIF**. The gate proves it is current; only you can see that it is a good picture
of the firmware.

## 5. Keep the contract in sync

`README.md` § Web UI is the copy that surrounds the recording — if a scene changes, the sentence
describing what the dashboard states changes with it. `.claude/CLAUDE.md` and `CONTRIBUTING.md`
list the local gates; a new check here belongs in both. If the schematic itself changed, this skill
is the *second* half of that work — `/schematic-review` decides whether the drawing is true, and
this one makes sure the README stops showing the old one.
