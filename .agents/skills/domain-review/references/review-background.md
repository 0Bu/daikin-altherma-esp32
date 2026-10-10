# Domain review background and audit limits

Read this when investigating a historical defect or the converter/spec oracle. Current mandatory
checks remain in [the skill](../SKILL.md). Prior examples explain the gate, not current defects.

The other gates ask engineering questions. `$project-review` asks whether the project is still
consistent; `$feature-docs` asks whether the feature catalog is still accurate. Both pass happily on
a value that is **physically false**.

That is this project's characteristic failure. A wrong converter id compiles, passes every host
test, drifts no doc, and publishes `-971.5 °C` to Home Assistant as a mixed-water temperature. It
shipped on eight profiles at once. A bizone valve *position* shipped as a 12800 °C temperature
sensor; a "no data" sentinel shipped as a real `-3276.8 °C` reading (issues legacy-35–legacy-39). Every one was
found by a slow manual review — none by a gate, because no gate was asking "**is this true?**".

This review asks that. Nothing here is about style or structure.

**It runs before every ordinary merge** — there is no "this PR doesn't need it". That is deliberate. Deciding
in advance which files can change a value's meaning is a guess, and it is the same guess that let
legacy-35–legacy-39 ship: a valve position reached Home Assistant as a 12800 °C temperature sensor through the
ordinary discovery path, not through anything that announced itself as risky. So "nothing here can
change what a value means" is a **finding you state**, not an assumption made for you.

The skill's value-neutral path keeps an unaffected change bounded while retaining the catalog
audit and complete-diff inspection required before an ordinary merge.

## Why the audit needs a separate source review

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

