# Contributing

Thanks for looking at this. It is a hobby project for a specific piece of hardware, so the most
valuable contributions are usually **evidence from a real heat pump** — a model whose values decode
wrongly, a register the catalog is missing, a board whose pins aren't in the safe list.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

The project was developed in a private predecessor repository before its public launch. References
such as `legacy-209` identify work items from that private tracker; the discussions themselves were
not copied because they can contain installation data. Likewise, `(#N)` suffixes in the immutable,
signed commit history refer to predecessor pull requests, not to issue numbers in this repository.
The current source and documentation are authoritative; open a new public issue when old context is
needed for a present problem.

## What is most useful

| | |
| :--- | :--- |
| **A wrong or missing value on your unit** | The highest-value report. Include your model, `GET /values`, and `GET /diag` (a detect pass dumps the raw page bytes). See "Value correctness" below. The device collects all of it for you — [`docs/REPORTING.md`](docs/REPORTING.md). |
| **A board that isn't already listed** | The RX/TX safe-pin table in [`docs/WIRING.md`](docs/WIRING.md) is filled in per board by hand — a verified new row is a real contribution. |
| **Protocol findings** | Anything that sharpens [`docs/X10A_PROTOCOL.md`](docs/X10A_PROTOCOL.md) or [`docs/REGISTERS.md`](docs/REGISTERS.md). |
| **Bugs with a reproduction** | Start from [`docs/REPORTING.md`](docs/REPORTING.md) — the web UI's **Report a bug** action assembles the whole evidence set. Crashes especially: `GET /coredump` + the version from `GET /status` lets it be symbolized (`scripts/decode-coredump.sh`). |

Please open an issue before a large change. Refactors that don't change behaviour are the one thing
likely to be declined — the comment density and the "why" notes in this codebase are load-bearing.

## The local loop — no board or ESP-IDF required

These run on a plain system toolchain (cmake + g++/clang++ for the first, node for the rest) in
seconds. **Run them all before opening a PR.** They are also the first steps of CI's `gates` job,
so a failure here fails the build anyway.

```bash
scripts/run-mock-tests.sh --coverage # host logic tests + 95% floor + presenter parity
scripts/run-contract-tests.sh      # do the firmware's SOURCE boundaries still hold?
scripts/run-esp-idf-matrix-audit.sh # does the ESP-IDF feature matrix match the linked surface?
tools/esp_idf_matrix/selftest.sh   # can the ESP-IDF matrix audit still go red?
scripts/run-domain-audit.sh        # is the value catalog physically RIGHT?
scripts/run-description-audit.sh   # can a user find out what each value IS?
scripts/run-user-docs-audit.sh     # are English docs clear, current, and actionable?
scripts/run-diagnostic-evidence-audit.sh # is each diagnosis still tied to its cited source?
scripts/run-schematic-audit.sh     # does the DRAWING still say what it means?
scripts/run-ui-localization-audit.sh # did every shipped locale follow changed canonical UI copy?
scripts/run-ui-use-case-tests.sh   # do all visible UI actions actually work?
scripts/run-redaction-audit.sh     # can a bug report still leak the USER's data?
tools/absence/selftest.sh          # can the source-absence matrix still go red?
scripts/run-ui-gif-audit.sh        # is the README's RECORDING still of this UI?
scripts/run-doc-entity-audit.sh    # do the docs' copy-paste ENTITY IDS exist?
scripts/run-agent-instructions-budget.sh # are canonical agent budgets and safety contracts intact?
```

`run-mock-tests.sh --coverage` compiles the IDF-free headers in [`main/logic/`](main/logic/) against
[`test/test_logic.cpp`](test/test_logic.cpp) — the CRC and framing, the value converters, register
extraction, the config model and the Home Assistant discovery payloads — and requires at least 95%
aggregate executable-line coverage in those production headers. The test driver and generated
profiles do not count toward the percentage. Details in [`test/README.md`](test/README.md). If you
touch the coverage tooling itself, run `tools/coverage/selftest.sh` — the same argument as every
other selftest here: a floor that has stopped failing turns a percentage into decoration.

It **ends with the presenter-parity gate**
([`scripts/check-presenter-parity.sh`](scripts/check-presenter-parity.sh), runnable on its own).
Three headers here — `lwt_select`, `cop_scope` and `ou_stale` — say in their own comments that they
have no firmware caller: they exist so CI can gate a rule the **browser** applies, and those three
are exactly what the gate covers. (`feature_gate` is caller-less too, but for the other reason — it
is a policy the browser cites rather than re-implements, so there is no second copy to diff.)
That gates the C++ copy and says nothing about the JavaScript one, which is the copy your users get,
and this project has already paid for the difference: a looser leaving-water pattern in
`main/www/js/schematic.js` matched the bizone kit's *mixed-zone* row, putting a correct number on the
wrong sensor in ΔT, heat output and COP at once. The gate compiles a host dumper against the real
headers and the real `def/` catalog, then has the **production** `schematic.js` re-decide the same
inputs in the DOM-free VM harness the UI suite already uses, and diffs. If you change either copy,
change both in the same commit; if you *restructure* the browser side, keep the rules addressable as
named bindings — a rule folded back into its caller makes the gate exit 2 as unreachable rather than
pass by comparing nothing. Run `tools/presenter/selftest.sh` if you touch the gate itself.

`run-contract-tests.sh` covers what the host suite structurally cannot. `test_logic.cpp` links the
IDF-free headers, so it proves what a rule *decides* — never that the firmware still calls it from
the right task, in the right order, or not at all. "No source file can issue a Modbus write" is a
claim about a whole component, and the only way to check it is to read the source text, which is
what each `test/test_*_contract.mjs` does. The glob is deliberate:
a new sibling joins the gate with no workflow edit, the same property `test_ui_*.mjs` already had.

`run-esp-idf-matrix-audit.sh` binds [`docs/ESP_IDF_MATRIX.md`](docs/ESP_IDF_MATRIX.md) to the
application's explicit CMake components, direct managed dependencies, active `sdkconfig.defaults`,
ESP-IDF-shaped includes and the few reviewed manual/native boundaries. It deliberately does not
scrape the upstream documentation in CI: the negative feature list is curated, while the actual
linked surface fails closed. Run `tools/esp_idf_matrix/selftest.sh` after changing the matrix,
checker or input classification; its throwaway mutations prove missing components, defaults,
headers, evidence and native-boundary changes are still rejected.

Both globs also carry the **source-absence matrix** — `test_source_absence_contract.mjs` and
`test_ui_absence_matrix.mjs` — which is why it has no runner of its own. It asks what the other
gates do not: every source this firmware reads except the board is optional (the MQTT broker, the
MQTT room source, the circulation witness, the HomeHub, ENV III, the weather location, the X10A bus
itself), safe mode removes all of them at once, and each can be absent independently. That cross
product is where defects have shipped with every other gate green — the board's own heap trends
stopped recording because the *X10A bus* did not answer, and a card told a reader to set up a room
source they had already configured. Run `tools/absence/selftest.sh` if you touch either test file:
both halves assert over text, so a check that has stopped matching the code it describes reports
success, and the selftest is what re-seeds the defects to prove otherwise.

`run-domain-audit.sh` is separate on purpose, and the distinction matters:

> **Passing the tests is not the same as being right.** The tests verify the logic they are handed;
> they cannot see a value that is well-formed, compiles, drifts no doc — and is physically false. A
> wrong converter id once published `-971.5 °C` as a water temperature across eight profiles, and a
> valve *position* reached Home Assistant as a 12800 °C temperature sensor. The audit runs the real
> converters over the real catalog and cross-checks [`docs/REGISTERS.md`](docs/REGISTERS.md).

If you touch the audit itself, also run `tools/domain/selftest.sh` — it re-introduces every defect
the audit was built for into a throwaway copy and asserts each is still caught (the four shipped
decode bugs, plus a fan **step** mislabelled as a **rate**: the label becomes the Home Assistant
entity id and the VictoriaMetrics series name, so a wrong unit word publishes a wrong quantity while
the decode itself is correct). A checker that has stopped checking turns "clean" from evidence into
a lie.

`run-description-audit.sh` asks the same kind of question one layer up. Every reading reaches the
web UI's value list as a row keyed by its catalog **label**, and tapping that row is meant to open a
plain-language explainer — decided at render time by a first-match-wins regex sweep over the
`DESCRIPTIONS` table in [`main/www/js/descriptions.js`](main/www/js/descriptions.js). A label nothing matches renders as a
plain, un-tappable row: no error, no log, just a missing chevron among a hundred rows.
The first 11 rows in [`main/def/overlay.hpp`](main/def/overlay.hpp) shipped exactly so — nine with no
explainer, and two that matched the *fin temp* heatsink-**temperature** entry, describing a
protection flag and a retry counter as a °C reading. Its later profile-specific diagnostic block is
subject to the same gate. Since the profiles are machine-generated, the gap re-opens whenever the
generator emits a label the copy has never seen, without anyone touching this repo's JS.

It evaluates the real table in a JS engine rather than re-implementing its regexes elsewhere (a
looser second copy of a rule is not a test of that rule), so it needs **node ≥ 18**, the same runtime
as the user-docs, schematic and UI gates. Findings: `D001` a visible reading with no copy, `D002` an entry matching nothing,
`D003/D004` a malformed entry or missing German, `D005` a stale ledger line. If a finding is correct
as it stands, record it in [`tools/descriptions/audit_exceptions.txt`](tools/descriptions/audit_exceptions.txt)
with a reason — except `D001`, which the ledger refuses outright: a published reading the user
cannot look up is the defect the gate exists for, and the fix is copy, not a suppression. Touching
the audit means also running `tools/descriptions/selftest.sh`, same argument as the domain one.

`run-user-docs-audit.sh` closes the next gap: a row can have a description and still leave a normal
owner unable to interpret it. Every visible plant-diagnostics row therefore needs localized English
and German UI copy that says what was observed and the limit of the claim, without recommending an
action the available evidence cannot support; [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md) needs the matching English
plain-language section. All maintained repository Markdown is English-only; localized prose belongs
in the UI translation tables, not in `docs/` or review skills. The guide's
source stamp covers the evaluator and visible diagnosis contract, so a changed threshold, result or
wording makes the gate fail even when no row was added. Run the
[`$user-docs-review` skill](.agents/skills/user-docs-review/SKILL.md), update the prose first, and only
then use `scripts/run-user-docs-audit.sh --update` to record that review. The stamp is not an
alternative to reviewing the diff. `tools/user_docs/selftest.sh` proves the gate still rejects a
missing localization/claim-boundary/section, non-English documentation, false whole-plant reassurance, and
an unstamped source change.

`run-schematic-audit.sh` asks it one layer up again, of the **dashboard schematic** — the inline SVG
in [`main/www/index.html`](main/www/index.html) with its CSS and its `INSPECT` / `I18N` bindings. All
three gates above can be green while the picture is false, and that is not hypothetical: this drawing
has shipped a fan spinning around a point beside its own axle, the leaving-water pill floating 40 px
off the run it names, the return temperature drawn on the heating-only section (claiming a branch
R4T does not read), and "HEIZUNG" struck through by the heating riser so it rendered "HEIZUNC". Each
one is a physically correct value attached to the wrong thing — the `legacy-35`–`legacy-39` shape, drawn.

It parses the real SVG (coordinates, transforms, path geometry, text metrics) and evaluates the real
binding tables, so no second copy of either can drift, and reports in three layers: **structure**
(`S…` — hit target ↔ inspector entry ↔ element id ↔ translation), **geometry** (`G…` — viewBox,
overlaps, labels struck through, axis-aligned runs, text fit across all thirteen locales (inside fixed
pills and between neighbouring captions), a pill's distance to its own pipe, rotor symmetry and
pump rotation direction, and a run's *invisible* tap area not reaching into the fitting it meets:
the hit lines are
`stroke-linecap: round`, so each one also covers half a stroke past its declared endpoint, and every
trim in the drawing had been computed as if the cap were flat — the 3-way valve outlined itself on
hover and then opened the DHW branch) and **domain** (`E…` — a repeated unit needs a name; a
return-run reading stays left of the junction). Findings that are correct as they stand go in
[`tools/schematic/audit_exceptions.txt`](tools/schematic/audit_exceptions.txt) as an `ADJUDICATION`
(citing the decision — `docs/DESIGN.md` §5.3, a measurement) or a `KNOWN-DEFECT` (naming what is
wrong, and deleted by its fix); `S001` (a tap target that opens nothing) and `E002` (a pill on a
branch its sensor does not read) are refused outright. Touching the audit means running
`tools/schematic/selftest.sh`, which re-seeds every one of those historical defects (one `run_case`
each, so `grep -c run_case` is the count) and asserts each is still caught. What it *cannot* decide
— is the drawing still true of the plant, is a new part in the right place, is the German copy right
— it stays quiet about; that half is the maintainer's `$schematic-review`, which is a **merge gate**
on any PR that reaches the drawing, its contract or the tools that judge it. The runner-neutral gate
under `tools/agent-hooks/` is the single definition.
As an outside contributor you never run it; assume any change under `main/www/` needs it.

`run-ui-use-case-tests.sh` exercises the production UI wiring rather than merely parsing it. Its
matrix must name every production modal and drives Settings/Back, open, Cancel, backdrop, Escape,
accepted and rejected Save paths, representative invalid input, board-dependent ENV III states and
the two-step bug-report dialog. It also runs every existing `test_ui_*.mjs` contract and a selftest
that re-introduces the historical ENV III failure where visible Cancel and Save buttons called an
undefined close function. CI runs the same command in the required `gates` job. For UI-relevant
changes, the maintainer's `$ui-use-case-review` adds real narrow/desktop click-through and records a
SHA-stamped result. The runner-neutral aggregate PR gate requires that current record and reruns the
deterministic suite immediately before a command-line merge.

`$absence-review` is the same shape for the states above: **conditional**, required when a PR
touches an optional source's lifecycle or a surface that reports one, with the neutral hook core as
the single definition of that set. Like the schematic
gate it exists because the mechanical half cannot judge whether a *new* source is in the matrix,
whether removing one source quietly removed another, or whether the copy names a blocker the reader
can actually act on.

`run-redaction-audit.sh` is the only gate here whose subject is the **user's data** rather than the
firmware's correctness, and it is the one an outside contributor is most likely to need without
expecting to. A bug report is filed as a *public* GitHub issue carrying the device's own `/status`,
`/values` and `/diag` ([`docs/REPORTING.md`](docs/REPORTING.md)) — defensible only because the device
scrubs it first ([`main/logic/redact.hpp`](main/logic/redact.hpp)). There is no private channel behind
it and nobody reviews a report before it is posted. Two halves, failing differently: `/status` leaks
by **field**, so the audit derives how many fields the builder actually wraps and compares that
against the header's declaration (they had drifted two apart, in silence, because nothing consumed
the number); `/diag` leaks by **line**, guarded by an allowlist of named log statements, and an
allowlist falls behind quietly — a new `diag_printf` interpolating a hostname or an SSID is simply
not covered, and the symptom is a correct-looking log line with a real value in it. On its first run
it found `mqtt: retired legacy HA device %s` printing the unique half of the MAC that `/status` was
redacting three sections above. Adjudications go in
[`tools/redact/audit_exceptions.txt`](tools/redact/audit_exceptions.txt); `tools/redact/selftest.sh`
re-seeds every defect it was built for. Neither half can see the direction that needs a human: a new
identifying field nobody wrapped at all never reaches the redactor, so it never reaches the count.

`run-ui-gif-audit.sh` guards the README's **recording** of that drawing,
[`docs/media/dashboard.gif`](docs/media/dashboard.gif) — the animated dashboard a new reader sees
before anything else. **It is a CI step and a merge condition**, like everything else on this page —
but it was not always, and the argument that kept it out is worth knowing before you touch it. Its
remedy is a local re-record (Chrome + ffmpeg, ~10 min) that no runner performs, and a gate whose fix
is unavailable where it fires gets the *stamp* rewritten rather than the recording re-made — a GIF
then carrying a stamp that asserts it is current, which is strictly worse than no gate at all. What
changed is not the remedy but the escape: the stamp writer now **refuses** a stamp whose fingerprint
moved while the GIF bytes did not, which is exactly what re-stamping an old recording looks like
from the outside (`--allow-identical-gif` overrides it for the one case that is real — you did
re-record and the encoder reproduced the file byte-for-byte). Red can therefore only be cleared by a
recording. The cost of the old arrangement was not hypothetical: with the recording's currency
nobody's merge condition, legacy-462 swapped the
schematic's circuits and the README went stale the same day, against a stamp written hours earlier.
If you are an outside contributor and cannot re-record, say so in the PR and leave it to the
maintainer's `$ui-gif` skill rather than touching the stamp.

**A UI change is not automatically a recording change**, and this gate is careful about the
difference. The CI step is a fingerprint comparison that takes a second and passes unless the
recording is genuinely stale, so an unrelated PR never pays for it. Editing the settings modal, the
charts or the value list touches the same three files as the schematic and still costs you nothing
here — what the gate reads is the `#schem` figure, the `.sc-*` rules and the six painting
functions, not the files containing them.

The maintainer's `$ui-gif` review is required when this PR **re-made** the recording, because a new
recording is the one thing no check can judge. A **stale** one is not a review question at all: the
merge hook refuses outright, and no ticked checkbox overrides it. A review record is evidence that
somebody looked at a recording, and that can never outrank the mechanical fact that the recording on
disk is not of these sources — the only way out is `scripts/record-dashboard-gif.sh`.

It is the one artefact here that rots *invisibly*: a recording renders
perfectly forever, whatever the UI has since become, so every gate above stays green while the
README shows a drawing that no longer exists. A screenshot cannot fail a test; it can only be out of
date, and it looks exactly as good either way. CI has no browser, so the check is a **stamp**, not a
re-render: it fingerprints the sources the recording was made from — the schematic markup, the CSS
that draws and animates it, the assembled UI functions that paint it, the
strings it prints, the scenes in [`tools/uigif/scenes.js`](tools/uigif/scenes.js) and the
recorder's own framing — and fails when they no longer match
[`tools/uigif/gif_stamp.txt`](tools/uigif/gif_stamp.txt). The frame is the schematic card **alone** —
the dashboard header above it is deliberately cropped out, because it prints the running version and
no recording can keep that current — so a header change needs no re-record, and does not fingerprint.
That crop is a hard-coded rectangle, which makes it the one framing number a UI change can invalidate
in silence: when the card's height moves, **re-measure `#schem` in the demo page** and follow it. A
crop left behind clips the drawing or catches a sliver of the next card, and no check can see it.
It also reads the GIF itself: a single
frame, or frames held over 200 ms, fails the thing a recording is *for*, which is showing the flow
moving. The fix is always to re-record — never to edit the stamp:

```bash
scripts/record-dashboard-gif.sh    # ~10 min; needs Chrome + ffmpeg, so LOCAL only
```

It films the real UI (`index.html` + `style.css` + the ordered
[`app.sources`](main/www/app.sources) fragments, spliced the way the firmware build splices them)
with only the *device* stubbed, so what the GIF shows is what `renderLive()` drew.
Look at the result before committing: the gate proves the recording is current, never that it is a
good picture — that half is the maintainer's `$ui-gif` skill, itself a merge gate.
`tools/uigif/selftest.sh` proves the gate still catches each way the recording can go stale, and
that the stamp still cannot be earned without one.

`run-doc-entity-audit.sh` asks whether the **copy-pasteable recipes in the docs still name entities
that exist**. [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md) hands a reader YAML naming ids like
`sensor.daikin_altherma_inlet_water_temp_r4t`; each is derived from a catalog **label**, so it is
only as stable as that label — and the catalog spells one quantity several ways across models. A
wrong id errors *nowhere*: Home Assistant builds the template sensor, its `availability` guard never
becomes true, the entity sits at `unavailable`, and the reader concludes their heat pump lacks the
feature. It resolves each id through the real `ha_slug` over the real catalog, and only against
**detectable** profiles — the heat-meter recipe had been naming a row that exists only in the
hand-written host-test fixture `altherma3_r_erga`, which detection can never assign, so a check that
looked at every table would have called it clean. It does **not** require an id to be right on every
profile: the catalog genuinely disagrees across models, and the docs should state a majority id and
name the alternatives beside it. `tools/docs/selftest.sh` re-seeds the defects it was built for.

`run-agent-instructions-budget.sh` is the canonical runner-neutral agent-integrity contract. It
keeps the always-loaded [`AGENTS.md`](AGENTS.md) below 24 KiB, validates canonical skill identity and
OpenAI metadata, focused-reviewer safety, hook dispatch, and the explicit project safety invariants.
Narrative belongs in `docs/`; do not trim a rule or raise the budget to clear a red gate. The
mutation canaries are:

| Canary | Expected evidence |
|---|---|
| Missing canonical instruction or configuration input | Exit 2; never a vacuous pass |
| `AGENTS.md` over 24 KiB | Exit 1 with the measured byte count |
| Missing, duplicate or wrongly named canonical skill | Non-zero identity failure |
| OpenAI metadata or focused-reviewer safety drift | Non-zero configuration failure |
| Hook dispatch drift | Non-zero hook failure |
| Required safety invariant absent | Non-zero failure naming the invariant |

Run `tools/agent-config/selftest.sh` after changing agent instructions, skills, subagent definitions,
hook mappings, or the checker itself.

The same `gates` job runs `tools/agent-policy/selftest.sh` and, on a pull request, invokes
`scripts/run-agent-policy.sh` with the current PR body, head SHA and complete changed-file list from
GitHub. Missing/partial inputs, an event SHA that is no longer the PR head, an unchecked or missing
required review, and a stamp for an older commit all exit 2. A current `$name` record passes;
other spellings are rejected. Editing the PR body does not start a workflow, so after the maintainer
records the reviews, re-run the existing `gates` job; it fetches the live body rather than the old
event snapshot. Any later commit invalidates every prior stamp.

This CI parser proves exact record syntax, applicability, completeness and head freshness; it cannot
prove who last edited a PR body. An outside contributor must still leave the section alone, and a
maintainer must inspect/record the reviews before using their GitHub merge permission. Repository
merge authorization and the branch ruleset are the actor trust boundary, not a checked Markdown box.

Four more fast gates guard the **published artifacts** rather than the firmware, so most PRs never
need them locally — run them if you touch
[`scripts/publish-pages-branch.sh`](scripts/publish-pages-branch.sh),
[`scripts/build-pages.sh`](scripts/build-pages.sh),
[`scripts/check-web-installer-plan.py`](scripts/check-web-installer-plan.py),
[`scripts/check-publish-version.sh`](scripts/check-publish-version.sh) or
[`scripts/next-version.sh`](scripts/next-version.sh), or when changing the CI trust/release split:

```bash
scripts/run-pages-publish-tests.sh         # needs only git, no toolchain
scripts/run-web-installer-plan-tests.sh    # needs only python3
scripts/run-publish-version-tests.sh       # git + python3 + a C++17 compiler
scripts/run-ci-release-contract-tests.sh   # shell + python3, no credentials
```

The first races two publishers against a throwaway bare repo, because `gh-pages` has two concurrent
writers (a manual release's root publish and every merge's dev-channel publish) and the loser used
to fail its entire build — a bug that read as a flake, since re-running always cleared it. It also
pins that a call which is not one of the two modes fails *before* the branch is touched: the
argument selects which slice gets overwritten, so a retired `--pr 12` treated as a root publish
would replace the release feed.

The second is the negative half of the **NVS-preservation** gate. `check-web-installer-plan.py`
already ran in CI on the real manifest, but only ever proved that today's good plan passes — these
tests prove it still *rejects* a part that erases `nvs`, a path outside the manifest directory, a
directory in place of an image and malformed JSON. A checker that only sees valid input is not
evidence.

The third covers [`check-publish-version.sh`](scripts/check-publish-version.sh), which the build job
runs right after it stamps the version: **would a device on the currently-published build accept the
one this run would publish?** The published version is read out of the `gh-pages` branch (per feed —
root for a release, `dev/` for a merge) and the comparison is the device's own `ota_is_upgrade()`
([`logic/version_cmp.hpp`](main/logic/version_cmp.hpp), via
[`tools/version/publish_gate.cpp`](tools/version/publish_gate.cpp)), so CI cannot publish something
no board would install. It exists because the version is *derived*: `next-version.sh` reads the `v*`
tag list and falls back to the `version.txt` floor when it is empty, so a deleted tag silently
resets the numbering — on 2026-07-24 that republished the dev feed as `1.0.0-dev.168` over the
`1.0.14-dev.2` it had served minutes earlier, with a green build. If this gate fires, fix the floor
(a tag, or `version.txt`) — not the gate.

The fourth pins the workflow's trust and delivery contract: untrusted PRs expose no signing key or
flashable artifact, a release resume must match the published manifest's exact source SHA, and the
license/notices, Pages feed and GitHub Release stay in their fail-closed order.

Every one of their test suites is a **step of one `gates` job**, not a job each (the production
version gate runs in `trusted_build`, where the stamped version exists). Actions bills every
job rounded up to the next whole minute, so a fleet of ~15-second jobs costs a billed minute each
for under a minute of work; a step boundary names the failure just as precisely. For the current
list, read the `gates` job in `.github/workflows/build.yml` rather than a count written here.

## Building the firmware

There is no local ESP-IDF install. Builds go through the Docker image pinned to the version CI uses
(read at runtime from `.github/workflows/build.yml`):

```bash
scripts/idf-docker.sh idf.py build
```

The `esp32s3` target is part of `sdkconfig.defaults`, so a first build needs no preceding
`set-target`. Managed-component ranges live in `main/idf_component.yml`, while their complete
resolved graph is committed in `dependencies.lock`. To update it intentionally, edit the manifest,
run `scripts/idf-docker.sh idf.py update-dependencies`, and review both files. Do not hand-edit the
lock. **You do not need to build to open a PR** — CI builds every PR and attaches its non-flashable
diagnostic artifacts. Say in the PR what you did and didn't verify.

> **Flashing needs a signed image.** This config uses the Secure Boot v2 *signature scheme* without
> hardware Secure Boot, so an **unsigned** app crash-loops before `app_main` (no eFuses are burned,
> so this is a crash-loop, not a brick — reflash to recover). `scripts/require-signed.sh` refuses to
> flash one. Signing needs an offline key that is not in this repo; see
> [`docs/SECURITY.md`](docs/SECURITY.md). For a contributor the practical path is: build to check it
> compiles, and let the maintainer test on hardware — or generate your own key for your own board.

Maintainer OTA writes use the direct, unchained `scripts/production-ota-gate.py`; never call
`/ota/update` directly. For an ordinary private-inventory `bench` update, use the exact signed
official dev artifact with `--confirm-bench bench --install-bench`. This mode requires a clean
matching source tree, host contracts, a generation-bound one-shot write, verifier/heap evidence,
rollback probation and fixed live pressure. It cannot contact `production`; ordinary bench delivery
is OTA-only, with signed NVS-preserving USB reserved for bootstrap or recovery.

Production promotion is the separate `--confirm-production production --execute` transaction. It
first exercises a complete signed release download under pressure on the MAC-bound bench, restores
the exact dev artifact, then permits one un-retried update of the distinct production role and a
read-only heap/X10A/MQTT canary. The bench need not have physical X10A; production must prove the
real retained X10A payload. Neither mode cuts a release. See
[`docs/SECURITY.md`](docs/SECURITY.md) for the complete commands and evidence boundaries.

## Where code goes

- **Any decode, config, discovery or policy logic belongs in [`main/logic/`](main/logic/)** as an
  IDF-free header, with a `CHECK` in `test/test_logic.cpp`. Never bury it in a `.cpp` only the device
  can run — that is logic no one can verify without hardware.
- **Never hand-edit generated per-model `main/def/*` profile tables.** They are machine-generated;
  `main/def/overlay.hpp` is the hand-written overlay and `main/def/homehub.hpp` is the curated
  HomeHub definition source. A generated profile's detection signature is the set of register pages
  referenced by its rows (`def/signatures.hpp` → maximal page overlap). Deleting a row changes that
  signature only when it is the last row referencing its page; only then is that page bit removed,
  which can make the correct model lose a page to a feature-richer wrong one. An absent-feature row
  gets the `ValueDef::no_publish` detect-only flag instead of deletion. Verify rows against
  [`docs/REGISTERS.md`](docs/REGISTERS.md) §5.
- **Heap is the binding constraint** (the largest *contiguous* free block, not total free). HTTP
  handlers must stay under the shared OOM try/catch; every allocating task loop must self-guard; never
  allocate while holding a mutex. The rules and the reasoning are in
  [`AGENTS.md`](AGENTS.md) → "Memory, concurrency, and HTTP safety".
- A PR touching HTTP, MQTT, OTA, TLS, JSON, X10A publishing, firmware polling or heap allocation also needs a
  current-head `$heap-safety-review` record from the independent read-only `heap_safety_reviewer`;
  the aggregate PR gate enforces applicability and freshness.
- C/C++ formatting is [`.clang-format`](.clang-format). Match the surrounding comment density —
  explaining *why*, not *what*, is the house style.
- **Warnings are part of the contract in `main/`.** [`main/CMakeLists.txt`](main/CMakeLists.txt) pins
  `-Werror=return-type`, `-Werror=format` and `-Werror=unused-result` on that component alone, so the
  `[[nodiscard]]` on the NVS setters and the `format(printf, …)` on `diag_printf` are build *errors*,
  not review catches — a dropped NVS write is silent, and one of them once left safe mode unable to
  latch its crash counter. They are pinned rather than inherited because ESP-IDF's own `-Werror`
  handling is version- and Kconfig-dependent, so it could change under a bump with nothing here to
  notice. The firmware build is the only compile of `main/*.cpp`, so these fire in CI, not in
  `run-mock-tests.sh`. Don't relax a flag to get green: each hit is the defect class it was pinned
  for.
- **So is the optimisation contract of the status serializer.** The release build now selects
  size optimisation globally, and `main/CMakeLists.txt` also pins `http_status.cpp` to `-Os` so this
  stack-critical translation unit remains protected if the global setting changes later. The older
  whole-body `http_append_status_json()` overflowed a task stack twice; historically its `-Og` frame
  was 11776 bytes and the deepest MCP path was 14512/16384, while the first per-file `-Os` change
  reduced them to 3744 and 6480. The current bounded, streamed serializer is larger in features but
  has no owning whole-status instantiation: the release ELF measures its frame at 4848 bytes and the
  conservative complete MCP path at 7552/16384, leaving about 8.8 KB before ISR and exception-unwind
  frames. Do not remove the explicit pin without an equivalent invariant. If you touch this path,
  re-measure it from the ELF's `entry a1,N`, never from an idle heap reading; the command is in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#memory-constraints).
- **There is deliberately no clang-tidy or cppcheck gate**, and that was measured rather than
  assumed. Over `main/logic/` + `main/def/`, a blanket config reports ~7000 findings — over half of
  them this project's own `CHECK` macro — and a curated bug-finding set reports ~50 with **zero** real
  defects; the three plausible ones flag deliberate, documented code (an explicit int16 clamp, a
  well-defined `&&` sequence, a bounds-guarded reference return). The bug classes a linter looks for
  are typed out here rather than linted out, and the defects this project ships fixes for are domain
  and resource-budget defects, which the audits above already cover. A gate whose findings are noise
  is one people learn to suppress without reading.

## Value correctness

If your change can alter what a published number **means**, that is the highest-risk change in this
codebase and needs more than a green build. State in the PR:

- which values changed, and what the new number should physically be;
- the decode witness — the wire bytes, what they should read, what they now read (`GET /diag` after a
  detect pass dumps the raw page bytes for exactly this);
- whether a real unit confirmed it, or why that wasn't possible.

Genuine per-model deviations get an on-record `ADJUDICATED` entry in
`tools/domain/audit_exceptions.txt` (with evidence — a live capture or a documented model fact); a
temporary defect gets a `KNOWN-DEFECT` entry that is **deleted by its fix**. Never add an entry to
silence a *new* finding on code your PR touches — that is the gate working.

## Pull requests

Fill in [the template](.github/pull_request_template.md). Seven checkboxes on it
(`$project-review`, `$feature-docs`, `$domain-review`, `$schematic-review`,
`$ui-use-case-review`, `$absence-review`, `$ui-gif`) are **maintainer-only** repository skills under
`.agents/skills/`. They are not something an outside contributor can run. Leave them unchecked; the
maintainer runs them before merge. Your equivalents are the scripts above plus an honest note about
hardware.

`main` is kept **strictly linear**, so PRs land as **squash merges** — enforced by a branch ruleset
on `main` (require a pull request, require linear history, and the `gates` / `build` checks green),
not left to convention. Nobody is exempt: the ruleset carries no bypass actors, so this
holds for the maintainer too — `main` takes no direct pushes at all. Practical consequences:

- Everything lands through a PR, including a one-line docs fix. There is no push-to-`main` path.
- Rebase onto `main` rather than merging `main` into your branch. Merge commits can't be accepted.
- Sign your commits (`git commit -S`, or let GitHub sign a web merge). Signing is **asked for, not
  enforced**: the ruleset used to carry *require signed commits*, and it was dropped because the
  self-hosted Renovate bot cannot satisfy it. Renovate authenticates with a **PAT**, and GitHub
  signs a bot's commits only when the bot is a **GitHub App** — neither of Renovate's two commit
  paths helps, since the `git` one is unsigned by construction and the API one is signed by GitHub
  for an App only. That was measured rather than inferred: a dispatch with the API path on
  (run `30169946598`) produced `verified: false, reason: unsigned`. So every dependency PR carried
  unsigned commits and the rule blocked them all — green checks, zero required approvals,
  `mergeable_state: blocked`. A squash merge performed by GitHub is still signed by its web-flow key
  either way; what is gone is the guarantee that each *incoming* commit was. Restoring the rule
  means first moving Renovate onto a GitHub App (or giving it a `gitPrivateKey`) — see
  [`.github/workflows/renovate.yaml`](.github/workflows/renovate.yaml).
- `main` moves under open PRs — expect to rebase before merge.
- A red CI job blocks the merge, including on a docs-only PR — the fast gates are cheap and
  hardware-free precisely so this is never a burden.
- A docs-only PR runs the `gates` job and **skips** the firmware build: prose cannot change the
  image, and a skipped job still reports its check, so the ruleset is satisfied. What counts as
  build-relevant is the path list in the *Detect build-relevant changes* step of
  [`build.yml`](.github/workflows/build.yml) — add to it if you introduce a file the image or the
  published site is made of.

Fork and same-repository PRs build and run all gates as untrusted source, but get no signing key:
they compile- and size-check only. Their seven-day Actions artifact contains the compressed ELF,
its checksum and size reports for diagnostics, but no flashable `.bin`, merged image, Web Serial
parts or installer manifest. That is deliberate, not a failure.

**A PR publishes no installer.** Per-PR previews at `…/PR/<N>/` are retired: each one was a
`gh-pages` push, and every `gh-pages` push starts a full GitHub Pages deployment on top of the
build. To flash a build in a browser, use the **dev channel** (`…/dev/`), republished by every
firmware-relevant merge. The PR run retains only the non-flashable diagnostic artifact described
above for seven days. Actions minutes are a metered monthly resource on this account — the same
reason the fast gates share one job and the firmware build is skipped when it cannot matter.

## Releases (a merge does not cut one)

Merging a PR publishes a **development build**, not a release. There are two feeds, and they move
at different rates:

| Feed | URL | Cut by |
|------|-----|--------|
| **Release** | [`…/manifest.json`](https://0bu.github.io/daikin-altherma-esp32/manifest.json) | a **manual** run: Actions → **build** → *Run workflow* → `release: true` (+ `bump`) |
| **Development** | `…/dev/manifest.json` | every firmware-relevant push to `main` |

A release run is the only thing that creates a `v*` tag and a GitHub Release; a merge creates
neither. Dev builds are versioned `<next release>-dev.<commits since the tag>` — a semver
pre-release, so they sort *above* the release they followed and *below* the release they lead to.
A device picks its feed in the web UI (gear → **ESP32** → *Update channel*); nothing about a PR
changes that, so a contributor never has to think about which feed their change lands in. It lands
in dev, and a maintainer decides when a release is cut from it.

## License

Contributions are under the [MIT License](LICENSE). The X10A protocol and value definitions derive
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT), credited in the README. Please keep
new code free of copied material from other projects unless its license permits it and you say so in
the PR.
