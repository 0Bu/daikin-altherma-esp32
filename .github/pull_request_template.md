<!--
Fill in each section. Delete checklist lines that don't apply. This template is used by human
authors and by multiple coding agents — keep it honest: say what was actually verified, and note
anything that couldn't be (a remote session may have no Docker daemon or USB — see AGENTS.md).

FIRST-TIME CONTRIBUTOR? Read CONTRIBUTING.md. Run the complete gate set linked under
"Verification", say honestly what you could not test, and leave the "Maintainer gates" section
alone — those are repository-maintainer reviews and gate records, and are not yours to run.
-->

## Summary

<!-- What changed and why, in 1-3 sentences. -->

## Changes

-

## Verification

Run the complete [pre-PR gate set](https://github.com/0Bu/daikin-altherma-esp32/blob/main/test/README.md#run); use affected checks while developing.
Report results for the reviewed source and distinguish missing evidence from a passing check.

- Local checks and limitations:
- Firmware source/build (head SHA, local or CI result, or limitation):
- Hardware, API and rendered UI evidence (where relevant; identify unverified layers):

Follow [AGENTS.md](https://github.com/0Bu/daikin-altherma-esp32/blob/main/AGENTS.md) for mandatory safety and authorization rules and
[CONTRIBUTING.md](https://github.com/0Bu/daikin-altherma-esp32/blob/main/CONTRIBUTING.md#where-code-goes) for code and documentation ownership.

## Maintainer gates

<!-- Not runnable by outside contributors — leave unchecked, the maintainer fills these in.
     CI validates exact `$name` syntax and current-head freshness, not the identity of the body editor;
     maintainer review plus GitHub merge authorization is the actor trust boundary. The only PRs
     without these records are authoritative-CI-attested Renovate updates whose immutable,
     head-bound commit patches contain solely the fully pinned Renovate runner replacement in
     `.github/workflows/renovate.yaml`; the data-only trusted-base `pr-policy.yml` workflow never
     loads PR code. -->

- [ ] `$skill-audit` clean — push gate @ <short-sha> (required before pushing an update to an open PR: canonical skills and reviewers checked against the commit being sent)
- [ ] `$project-review` clean — merge gate @ <short-sha> (required on every ordinary or local/manual merge: doc drift, memory safety, tests and target/build implications)
- [ ] `$pr-hygiene-review` clean — merge gate @ <short-sha> (required on every ordinary merge: commit range, current PR text and diff checked for personal information and non-English prose)
- [ ] `$heap-safety-review` clean — merge gate @ <short-sha> (required for HTTP, MQTT, OTA, TLS, JSON, X10A-publisher, firmware-polling or heap-allocation changes; an independent read-only `heap_safety_reviewer` must find no blocker)
- [ ] `$feature-docs` synced — merge gate @ <short-sha> (required if a technical feature changed: `docs/FEATURES.md` and `docs/ESP_IDF_MATRIX.md` match the code)
- [ ] `$domain-review` clean — merge gate @ <short-sha> (required on every ordinary or local/manual merge: values verified physically right, sensible and authentic; a PR that cannot reach a value clears quickly, but say what you checked)
- [ ] `$schematic-review` clean — merge gate @ <short-sha> (required if the dashboard schematic changed: the drawing still tells the truth about the plant, and every reading is on the part that measures it)
- [ ] `$ui-use-case-review` clean — merge gate @ <short-sha> (required if UI behavior changed)
- [ ] `$absence-review` clean — merge gate @ <short-sha> (required if an OPTIONAL SOURCE changed: the broker, the room source, the circulation witness, the HomeHub, ENV III, the weather location, the X10A bus, safe mode, or anything that reports one)
- [ ] `$diagnostic-evidence-review` clean — merge gate @ <short-sha> (required when diagnostic inputs, persistence, thresholds, conclusions or cited evidence change)
- [ ] `$user-docs-review` clean — merge gate @ <short-sha> (required when an owner-visible status, diagnosis, action or help surface changes)
- [ ] `$ui-gif` clean — merge gate @ <short-sha> (required when this PR re-made `docs/media/dashboard.gif` or its stamp; a red `scripts/run-ui-gif-audit.sh` is a hard block that only a real re-record can clear)
<!-- The stamp must be a BARE sha after the `@` — the gate matches `@[[:space:]]*[0-9a-f]{7,40}`
     (`tools/agent-hooks/pr-gate-lib.sh`), so wrapping it in backticks parses as no stamp at all and the
     merge is refused with "ticked but carries no @ <sha> stamp". Get it with
     `git rev-parse --short=12 HEAD`. -->

<!-- `$ui-gif` needs Chrome + ffmpeg, so it is the one gate an outside contributor cannot clear. If
     that is you: leave it unchecked and say so — the maintainer re-records. What nobody may do is
     rewrite `tools/uigif/gif_stamp.txt` to make CI green; the stamp writer refuses that shape, and
     it is the one move that turns this gate into a lie. -->
