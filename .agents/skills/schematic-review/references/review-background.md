# Schematic review background

Read this when investigating sensor attribution or a prior defect class. Current mandatory
checks remain in [the skill](../SKILL.md).

The dashboard schematic is the whole "what is the plant doing right now" answer (`docs/DESIGN.md`
§5.3). It is also the one artefact in this repo where **every gate can be green and the picture can
still be false**: the firmware builds, the host logic tests pass, the domain audit reports no
findings, the description audit confirms there is copy for it — and the drawing
puts that correct reading on the wrong pipe.

That is not hypothetical. This drawing has shipped a fan spinning around a point beside its own
axle, a leaving-water pill floating 40 px above the run it names, the return temperature drawn on
the heating-only section (claiming a branch no sensor there reads), and "HEIZUNG" struck through by
the heating riser so it rendered as "HEIZUNC". Each is the legacy-35–legacy-39 failure shape drawn in SVG:
well-formed, plausible, and attributing a real number to the wrong thing.

