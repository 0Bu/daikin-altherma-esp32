# Recording background and failure examples

Read this reference for recorder/framing changes or a capture failure. The required workflow
and acceptance checks remain in [the skill](../SKILL.md).

## Why freshness and capture review are separate

`docs/media/dashboard.gif` is the first thing a new user sees in the README, and it is the one
artefact in this repo that **rots invisibly**. It is a recording: it keeps rendering perfectly long
after the thing it recorded has changed. Every other gate stays green while it goes wrong — the
schematic audit checks the live drawing, the description audit checks the copy, the domain audit
checks the values, and none of them can see that the picture in the README shows last month's
pipes, a pill that has since moved, or a component that no longer exists. A screenshot cannot fail
a test. It can only be out of date, and it looks exactly as good either way.

The GIF gate compares fingerprints. CI also runs Chrome/Chromium rendering checks, but the
recording workflow and decoded-frame review remain local. Fingerprints prove the recording is
current; they cannot prove the capture or its meaning is correct.

**This is a merge gate** (`tools/agent-hooks/require-pr-gates.sh`) and the audit is a CI `mechanical_gates`
step. Neither was true before: the audit was kept out of CI because a gate whose remedy is
unavailable where it fires gets the *stamp* rewritten rather than the recording re-made. That
escape is closed — `check_ui_gif.mjs` refuses to write a stamp whose `ui` moved while `gif` stayed
byte-identical, which is precisely what re-stamping an old recording looks like.
`--allow-identical-gif` overrides it for the one honest case (you re-recorded and the encoder
reproduced the file exactly, which a comment-only edit to the recorder can do). **Never** hand-edit
`tools/uigif/gif_stamp.txt`.

## Recorder mechanics and prior capture failures

Four things about it that are easy to break and hard to notice:

- **One page load per source image.** A steady frame needs one screenshot; each crossfade frame
  needs the outgoing and incoming states at the same instant and lets ffmpeg blend them. Wall-clock
  time cannot survive those fresh loads, so each source is *posed*: `window.__pose(t, T)` pauses
  every CSS animation and sets its `currentTime`. Delete that and the GIF silently becomes copies
  of one instant — still valid, still green on `U004`'s frame count, and motionless.
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

## Crop measurement and prior framing failure

6. **Is the crop still right?** It is the schematic card alone — deliberately not the dashboard
   header above it, which prints the running version, and a version frozen into a recording is
   wrong from the next release onwards with nothing able to see it. A UI change that alters the
   card's height leaves it clipped, or leaves a sliver of the header or the next card in frame —
   adjust `CROP` in the recorder rather than living with it. This is the checklist item that has
   actually fired: legacy-462 raised `#schem` by 6 px and shortened it by 6, and the crop it left behind
   sat 17 px under the card, catching the top edge of the next one in every frame. Nothing
   mechanical can see that — the stamp only proves the recording is of these sources, and a GIF
   with a stray sliver renders exactly as well as one without. **Measure, don't guess**, and don't
   trust the recorder's comment either — it records the last measurement, not the current layout.
   Take a fresh one: build the demo page, serve it, and read the box off the real page at the
   recorder's own `VIEWPORT` and `SCALE`.

   ```bash
   python3 tools/uigif/build_demo.py "$PWD" /tmp/m/demo.html   # then serve /tmp/m and load it in
   # Chrome at --window-size=1000,760 --force-device-scale-factor=2 --hide-scrollbars, and read
   # document.querySelector("#schem").getBoundingClientRect()
   ```

   `CROP` is `width:height:x:y` in DEVICE pixels (CSS × `SCALE`), and the documented intent is the
   card plus a 12 px side margin, 8 px above and ~5 px below. Update the recorder's comment with the
   numbers you measured in the same commit, then re-record — `CROP` is fingerprinted, so the stamp
   forces that anyway.
