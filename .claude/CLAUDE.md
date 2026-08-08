# daikin-altherma-esp32

ESP-IDF 6.x firmware for the ESP32-S3 chip (CI pins **v6.0.2**; `main/idf_component.yml` keeps a
`>=5.5` floor on purpose — the managed components still resolve on 5.x). Reads a **Daikin Altherma**
heat pump over its **X10A** service port and bridges every value to **Home Assistant over MQTT**
(auto-discovery). WiFi (captive portal), MQTT, syslog and the RX/TX pins are configured at runtime
from a **web UI**; the unit **model** and its register set are **auto-detected** from the bus every
boot — there is no manual picker. Firmware is installed from a **browser** (Web Serial) and updated
**OTA** from one of two published feeds — a **release** (cut by hand, via a manual CI workflow run)
or the **dev** channel (every firmware-relevant merge to `main`), picked per device in the UI.
Builds for the **esp32s3** target only.

> **Deep reference:** this file holds the always-needed essentials. Full narrative for the poll
> engine, value profiles, MQTT bridge, WiFi reconnect and OTA lives in
> [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — read it on demand. The X10A wire protocol
> (framing, checksum, register pages, detection) is in
> [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md), and the converter-id/enum tables plus a full
> register map in [`docs/REGISTERS.md`](../docs/REGISTERS.md). The OPTIONAL second SOURCE — the
> Modbus TCP link to a Daikin HomeHub (EKRHH), its explicit mDNS discovery action and its register map — is
> [`docs/MODBUS_PROTOCOL.md`](../docs/MODBUS_PROTOCOL.md) — the link is READ-ONLY and cannot frame a
> write at all. It is a SECOND SOURCE, not an alternative
> transport: both stacks run at once, independently, and a device without a HomeHub runs no Modbus
> task at all. A cross-cutting catalog of the
> platform features this firmware implements (Secure Boot v2 signing, OTA + health gate,
> ESP-IDF component inventory, diagnostics) is [`docs/FEATURES.md`](../docs/FEATURES.md) — keep it
> current with the `feature-docs` skill when a technical feature lands or changes. Its SIBLING is
> [`docs/PLANT.md`](../docs/PLANT.md), which carries the features whose subject is the PLANT rather
> than the board — the 24-hour checkup, the Open-Meteo forecast, the optional ENV III climate input
> and heating-curve diagnosis. The split is the scope rule each file states: FEATURES.md keeps the
> platform half of those features (the I2C driver, the evidence-before-save rule), PLANT.md what
> they measure and infer. Same skill maintains both. The MQTT/HA entity
> contract as seen from Home Assistant is [`docs/HOME_ASSISTANT.md`](../docs/HOME_ASSISTANT.md), and
> the implemented read-only MCP surface is [`docs/MCP.md`](../docs/MCP.md). User-facing docs:
> [`README.md`](../README.md), [`docs/README.md`](../docs/README.md),
> [`docs/SECURITY.md`](../docs/SECURITY.md), [`docs/DESIGN.md`](../docs/DESIGN.md) (web-UI design
> contract), [`docs/WIRING.md`](../docs/WIRING.md) (X10A wiring + picking RX/TX on other boards),
> [`docs/BOARDS.md`](../docs/BOARDS.md) (per-board hardware inventory + which parts the firmware
> uses — the place a newly-supported board's LED/button/pin facts belong) and
> [`docs/REPORTING.md`](../docs/REPORTING.md) (how an end user files a bug: ONE public issue
> carrying both the story and the device's own report, because the DEVICE redacts the identifying
> values first — `logic/redact.hpp` — so a second private channel would buy nothing and cost the
> step where half-finished reports die. The single exception is a CORE DUMP: raw stack memory, where
> a password of <=15 chars sits inline in its std::string by SSO, so it is never in the report and
> is requested through the private advisory form only when the `last_crash` backtrace is not enough.
> Plus the redaction table and the go-public checklist. The web UI's Settings-FOOTER "Report a bug"
> action produces the report (the muted mono line under the cards, beside the version — it was the
> ESP32 card's last ROW through v1.0.0-dev.199, where a rare escape hatch carried a live reading's
> weight); `.claude/skills/bug-triage` consumes it).
> Contributor-facing: [`CONTRIBUTING.md`](../CONTRIBUTING.md) (what the local gates
> are, where logic goes, how PRs land on a strictly-linear `main`) and
> [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — CONTRIBUTING states the outside-contributor half of
> the rules this file states for us, so a change to the gates, the `main/logic/` + test rule or the
> merge model belongs in **both**. Keep them in sync (the `project-review` skill checks for drift).

**Conventions:** always write the full name `daikin-altherma-esp32` (hostname, SoftAP, MQTT base
topic, docs) — never shorten it to `daikin-altherma`. Do not reference other projects by name in
the code or docs; the heat-pump-protocol credit belongs only in the README "Scope & credits"
section at the bottom.

## Environment note (Claude Code on the web / remote sandbox)

A cloud session **cannot build** (no Docker daemon for `scripts/idf-docker.sh`) and **cannot
USB-flash** (no USB passthrough) — it is for editing, review and CI-driven builds. The
`report-capabilities.sh` SessionStart hook prints what the current environment supports.

**But there IS a real local verification loop** — the host mock build runs the project's pure
logic with the plain system toolchain (no ESP-IDF/Docker/board), so decoding/config/discovery
changes can be *verified*, not just reasoned about, even in a cloud session:

```bash
scripts/run-mock-tests.sh --coverage  # host logic tests + 95% coverage floor + presenter parity
tools/coverage/selftest.sh   # prove the coverage gate rejects an under-covered production line
scripts/run-contract-tests.sh     # do the firmware's SOURCE boundaries still hold? (node-only)
scripts/run-domain-audit.sh  # is the value catalog physically RIGHT? (the domain-correctness gate)
scripts/run-description-audit.sh  # can the user find out what each value IS? (node-only)
scripts/run-schematic-audit.sh    # does the DRAWING still say what it means? (node-only)
scripts/run-ui-use-case-tests.sh  # do all visible UI actions actually work? (node-only)
scripts/run-redaction-audit.sh    # can a bug report still leak the USER's data? (python-only)
scripts/run-ui-gif-audit.sh       # is the README's RECORDING still of this UI? (node-only)
scripts/run-doc-entity-audit.sh   # do the docs' copy-paste ENTITY IDS exist? (c++ host compiler)
```

The description audit asks the same question one layer up from the domain audit: the domain audit
asks whether a published value is physically true, the description audit whether the web UI has
anything to SAY about it. A catalog label the `DESCRIPTIONS` table in
`main/www/js/descriptions.js` doesn't match renders as
a plain, un-tappable row — no error, no log, just a missing chevron among a hundred rows — and the
catalog is machine-generated, so the gap re-opens without anyone touching this repo's JS.
`def/overlay.hpp` shipped 11 rows that way (9 with no explainer, 2 matching the "fin temp"
HEATSINK-TEMPERATURE entry, so a protection flag and a retry counter were described as a °C
reading). It evaluates the REAL table in a JS engine rather than re-implementing 70-odd regexes in
python, for the reason `logic/lwt_select.hpp` and `logic/ou_stale.hpp` both state: a looser second
copy of a rule is not a test of the rule. `tools/descriptions/audit_exceptions.txt` is its
adjudication ledger (same contract as the domain one; a D001 "no copy for a visible reading" is
refused as a ledger entry outright), and `tools/descriptions/selftest.sh` proves it still catches
the defects it was built for.

The FOURTH asks the same question one layer up again, of the DASHBOARD SCHEMATIC — the inline SVG in
`main/www/index.html` plus its CSS and its `INSPECT`/`I18N` bindings. The domain audit asks whether a
published value is true, the description audit whether there is anything to say about it, this one
whether the PICTURE says it correctly: every defect the drawing has shipped passed all three of the
gates above and still put a correct reading on the wrong pipe. A fan spun about a point beside its
own axle (the CSS pivots on `transform-box: fill-box`, i.e. the BOUNDING BOX, so a rotor that is not
rotationally symmetric orbits); the leaving-water pill floated 40 px off the run it names; the return
temperature sat on the heating-only section, claiming a branch R4T does not read; the heating riser
struck "HEIZUNG" through so it rendered "HEIZUNC". The #35-#39 shape drawn in SVG — well-formed,
plausible, attributing a real number to the wrong thing. It PARSES the real SVG (coordinates,
transforms, path geometry, text metrics) and EVALUATES the real binding tables, so there is no second
copy of either to drift, and reports in three layers: structure (hit target ↔ inspector entry ↔ id ↔
translation), geometry (viewBox, overlaps, struck-through labels, axis-aligned runs, a pill's tie to
its own pipe, rotor symmetry and pump rotation direction, a run's INVISIBLE tap area not reaching into the fitting it meets —
`stroke-linecap: round` adds half a stroke past every endpoint and each trim in the drawing had been
computed as if the cap were flat, so the 3-way valve outlined itself on hover and then opened the DHW
branch) and domain (a repeated unit needs a name; a return-run reading stays
left of the junction it derives from the drawing). `tools/schematic/audit_exceptions.txt` is its
ledger — the two refrigerant pressures carrying no name is an ADJUDICATION citing DESIGN.md §5.3,
while `S001` (a hit target that opens nothing) and `E002` (a pill on a branch its sensor does not
read) are refused outright — and `tools/schematic/selftest.sh` re-seeds every historical defect (one
`run_case` each, counted with the ANCHORED `grep -c '^run_case ' tools/schematic/selftest.sh` —
the bare word also matches the helper's own definition and the comments about it, which is how a
"the count is N" claim comes to overstate by three) into a throwaway copy to prove it still catches
them. The judgement half is the `/schematic-review`
skill: whether the drawing is still TRUE of the plant, whether a new part is in the right place and
whether the copy is right in both languages is not mechanically decidable, and the audit stays quiet
about it rather than guessing. That half is now a **PR-merge gate** too — CONDITIONAL like
`/feature-docs`, firing on a diff that reaches the drawing, its contract, or the tools that judge it
(including the review's own checklist, so the gate is self-gating). The regex in
`.claude/hooks/require-schematic-review.sh` is the ONLY definition of that set; read it there rather
than trusting a list here, and grow it there if a schematic fragment ever moves. The filter is safe
here for the reason it is NOT safe on `/domain-review`: a value's meaning can change from almost
anywhere, but the drawing is one inline SVG, one stylesheet and one binding table.

The UI interaction contract is separate from the schematic's physical truth. Run
`scripts/run-ui-use-case-tests.sh` for every UI-facing change: it executes the production wiring,
requires every production modal to have a lifecycle case, and drives navigation, open, Cancel,
backdrop, Escape, accepted/rejected Save, invalid-input, conditional ENV III and bug-report paths.
It then runs the remaining semantic UI contracts and `tools/ui/selftest.sh`, which re-seeds the
historical undefined ENV III close handler. CI runs this command in the required `gates` job. The
maintainer's `/ui-use-case-review` adds real narrow/desktop click-through; for relevant diffs,
`.claude/hooks/require-ui-use-case-review.sh` requires its current head-SHA stamp and reruns the
deterministic suite immediately before merge.

The FIFTH is the only gate here whose subject is the USER's data rather than the firmware's
correctness. A bug report is filed as a PUBLIC GitHub issue carrying the device's own `/status`,
`/values` and `/diag` (`docs/REPORTING.md`), which is defensible only because the device redacts
first (`logic/redact.hpp`) — there is no private channel behind it and nobody reviews a report
before it is posted. The `/diag` half of that redaction is an ALLOWLIST of named log statements, and
an allowlist falls behind in silence: a new `diag_printf` interpolating a hostname or an SSID is
simply not covered, and the symptom is a correct-looking log line with a real value in it. Nothing
else here can see that — the firmware builds, every value is true, the drawing is right, and the
report leaks. It flags a diag line whose ARGUMENTS carry a config or board-identity value with no
matching rule (a heuristic on identifier names, not a proof — it catches the log line someone adds
while debugging, not a value laundered through an unrelated local first), and on its first run it
found `mqtt: retired legacy HA device %s` printing the unique half of the MAC that `/status` was
redacting three sections above it. `tools/redact/audit_exceptions.txt` is its ledger and
`tools/redact/selftest.sh` re-seeds every defect it was built for — one `expect_red` each, so
`grep -c '^expect_red ' tools/redact/selftest.sh` is the count — across BOTH halves: a deleted
/diag rule, an unruled leaking line, the discovered-identity shape the name heuristic could only see
because SENSITIVE lists bland words, a line printing the ROOM SOURCE's topic, a /status field that
stopped being wrapped, and a `REDACTED_STATUS_FIELDS` declaration that drifted while the builder was
right. That fourth case pins a gap this project had open rather than a defect it once shipped: the
room source's name and topic and the weather coordinates were redacted on /status while NOTHING in
the diag heuristic matched them, so the two halves disagreed about the same four values and only the
JSON half was scrubbing them. SENSITIVE must stay a SUPERSET of the /status field set for that
reason, and widening it cost nothing — measured, it adds no finding on the current firmware, so what
it closed was latent.

The SIXTH guards the README's RECORDING of that drawing — `docs/media/dashboard.gif`, the animated
dashboard a new user sees before anything else. It is the ONLY one of these that is NOT a CI step
and NOT a merge condition, and the reason is a property of its remedy rather than of its subject:
the only fix it can ever ask for is a LOCAL re-record (Chrome + ffmpeg, ~10 min), which no runner and
no cloud session can perform. A gate whose fix is unavailable where it fires does not get the
recording re-made — it gets the STAMP re-written to clear the red, which is strictly worse than not
checking at all, because the GIF then carries a stamp asserting it is current. So it is run ON
DEMAND by the `/ui-gif` skill, which audits, re-records and re-stamps in one place on a machine that
can do all three. Everything below describes what the check still DOES when that skill runs it. It
is the one artefact here that rots INVISIBLY: a
recording renders perfectly forever, whatever the UI has since become, so all four gates above stay
green while the README shows last month's pipes or a component that no longer exists. A screenshot
cannot fail a test; it can only be out of date, and it looks exactly as good either way. CI has no
browser, so this cannot re-render and diff pixels — it FINGERPRINTS the sources the recording was
made from (the schematic markup, the CSS that draws and animates it, the
assembled UI functions that paint it — `renderLive`/`liveData`/`clearSchematic`/… , each REQUIRED to
exist or the check exits 2 rather than fingerprint nothing — the strings the drawing prints, the
scenes, and the recorder's own framing) and fails when they no longer match the stamp beside the
GIF (`tools/uigif/gif_stamp.txt`, per-source hashes so a failure NAMES what moved). It also parses
the GIF: a single frame, or frames held over 200 ms, fails the one thing a recording is for —
showing the flow, the fan and the pump MOVING. Deliberately narrower than "all of `main/www`": a
settings-modal edit cannot change a frame, and a gate that fires on changes it knows are irrelevant
is one people learn to re-stamp without looking. The CROP is the schematic card ALONE, and the
dashboard header it used to include is the worked example of that rule pointing the other way: the
header prints the running VERSION, which a recording cannot keep current (nothing re-renders a GIF
when `version.txt` moves, and the fix "stamp the current version in" is only current on the day it
is recorded), so the header left the frame — and its markup, its CSS and `renderHeaderMeta` left
the fingerprint with it, since a source that cannot change a pixel must not be able to fail this. There is NO exceptions ledger, unlike the other
audits — their findings are questions about intent, this one has a single answer (re-record), and a
"this cannot alter a frame" entry would be a guess about pixels when the machine that settles it is
on the desk. Re-recording is `scripts/record-dashboard-gif.sh` (Chrome + ffmpeg, LOCAL only; one
headless page load per steady frame and two per crossfade frame, each source POSED at the same
deterministic animation instant by `window.__pose` in `tools/uigif/scenes.js`, since wall-clock time
cannot survive a fresh page load — and each
animation given a whole number of cycles across the total so the loop closes: the real periods
1.1/1.6/2.6 s share no practical common multiple). `tools/uigif/selftest.sh` proves the gate still
catches each way the recording can go stale. The judgement half is the `/ui-gif` skill: whether all
nine normal operating scenes are still the right ones, whether the invented numbers are physically coherent,
and whether the standby scene still shows the honest blanking that is the point of showing it at
all.

The SEVENTH asks whether the DOCS' copy-pasteable recipes still name entities that EXIST. The docs
hand a reader YAML naming ids like `sensor.daikin_altherma_inlet_water_temp_r4t`; each is derived
from a catalog LABEL (`ha_slug`), so it is only as stable as that label — and the catalog spells one
quantity several ways across models, which no reader of the doc can see. A wrong id errors NOWHERE:
HA builds the template sensor, its `availability` guard never becomes true, the entity sits at
`unavailable`, and that reads as "my heat pump doesn't support this" rather than as a typo in the
documentation. Every other gate here is green while it happens — the firmware is right, the values
are true, the drawing is right, and the recipe cannot work. It resolves each quoted id through the
REAL `ha_slug` over the REAL catalog (no second copy of the id rule) and — the load-bearing part —
only against **detectable** profiles: `is_detection_model()` refuses `generic` and the hand-written
fixture `altherma3_r_erga`, and the heat-meter recipe had been naming a row that exists ONLY in that
fixture since #206, so a check resolving against the whole registry would have called it clean. It
is deliberately NOT a demand that an id be right on EVERY profile — the catalog genuinely disagrees
across models, and the docs should state a majority id and name the alternatives beside it; the
question here is the decidable one, does this id exist anywhere a real device could produce it.
There is NO exceptions ledger: an id either resolves or it does not. `tools/docs/selftest.sh`
re-seeds the two defects it was built for plus an ordinary typo.

`run-contract-tests.sh` is not one of that layered sequence — it asks a question none of them can,
because they all run against `main/logic/`. The host suite LINKS the IDF-free headers, so it proves
what a rule DECIDES and can never prove that the firmware still calls it from the right task, in the
right order, or from the only file entitled to: "no source can frame a Modbus write" is a claim
about a whole component, and the only instrument that can settle it is source TEXT. So each
`test/test_*_contract.mjs` reads the relevant firmware tree and asserts a boundary —
the X10A-gated MQTT lifecycle, the single X10A-free tombstone exception, the explicit-action-only
mDNS browse, the embedded-UI delivery budget (#371) and the heating-curve CONSENT/DIAGNOSIS
boundary. Count them with the glob rather than from this sentence; a fifth landed here without
moving it. The last recursively scans all C++
sources and asserts that no write entry point, actuator type, FC06/FC16 function vocabulary, echo
parser or value encoder survives. It pins the current consent shape: saving the room source starts
that subscription; saving coordinates independently starts optional forecast traffic; deleting each
stops only its own collection; the pre-save room Test remains reachable; arming is derived from the
room mapping only; and gate order is HomeHub, plant-active, heating-mode, room, X10A. Those are
properties of a whole component and so exactly what a source-text check is for. It is the newest entry point and exists
because these were three bare `node test/…` steps in build.yml and nothing else: CI ran them, no
local command did, and a fourth sibling added the same way would have been invisible to every entry
point at once. The GLOB is the fix, not the wrapper — `test_ui_*.mjs` already had that property, and
these did not. A glob matching nothing exits 2 rather than reporting success, since "no tests found"
must never look like "all tests passed" in the very script written to stop a check from disappearing.

Both globs also carry the SOURCE-ABSENCE MATRIX, which is why it needed no runner of its own:
`test/test_source_absence_contract.mjs` rides the contract glob and `test/test_ui_absence_matrix.mjs`
the UI one. It asks the question every other gate answers about a device where everything is
configured and answering — what happens when it is NOT. Every source here except the board is
optional (broker, room source, circulation witness, HomeHub, ENV III, weather location, X10A bus)
and safe mode removes all of them at once, so absence is a CROSS PRODUCT rather than a state. That
product is where this project has repeatedly shipped defects with every other gate green: the
board's own heap trends stopped recording because the X10A bus did not answer; the heating-curve
card told a reader to set up the room source they had configured; the circulation row answered a
cleared broker with "waiting", forever, with no cause; an unconfigured witness was offered an empty
24-hour chart; and `?redact=1` invented identifiers for sources the device did not have. The
firmware half asserts over SOURCE TEXT (who owns a ring, which gate a trend list is behind, whether
`configured` is read from the config or from a task that may never have started), the browser half
executes the real card renderers over the real removal shapes. `tools/absence/selftest.sh` is the
load-bearing part and a CI `gates` step of its own: BOTH halves assert over text, so a check that
has stopped matching the code it describes reports SUCCESS — it re-seeds each shipped defect and has
already caught one of its own assertions written so that it could never fire. The judgement half is
the `/absence-review` skill, a CONDITIONAL PR-merge gate; the regex in
`.claude/hooks/require-absence-review.sh` is the ONLY definition of that set. Conditional is
defensible here for the schematic's reason and not domain-review's: a source's lifecycle is created
in one route, torn down in one place, reported in one builder and rendered in one card family.

(Three more fast gates guard the PUBLISHED ARTIFACTS rather than the firmware —
`scripts/run-pages-publish-tests.sh`, git-only, relevant when `scripts/publish-pages-branch.sh` or
`scripts/build-pages.sh` changes; `scripts/run-web-installer-plan-tests.sh`, python-only, the
NEGATIVE half of the NVS-preservation gate (CI already ran `check-web-installer-plan.py` on the
real manifest, which only ever proved a good plan passes); and
`scripts/run-publish-version-tests.sh`, which covers `scripts/check-publish-version.sh` — the
build job's answer to "would a device on the PUBLISHED build accept the one we are about to
publish?", asked with the device's own `ota_is_upgrade()` against the gh-pages manifest of the feed
being written. That one exists because the version is DERIVED: `next-version.sh` reads the `v*` tag
list and falls back to the `version.txt` floor when it is empty, so a deleted tag silently resets
the numbering — on 2026-07-24 it republished dev/ as 1.0.0-dev.168 over 1.0.14-dev.2, green. See
CONTRIBUTING.md.)

None of the gates above is a STATIC ANALYSER, and that is measured rather than assumed — read this
before proposing one. clang-tidy over `main/logic/` + `main/def/` reports ~7000 findings on a blanket
config, 3622 of them this project's OWN `CHECK` macro (1802 `cppcoreguidelines-avoid-do-while` +
1820 `pro-type-vararg`). Curated to bug-finding checks only it reports ~50 with ZERO real defects:
the three plausible ones flag `logic/history.hpp`'s deliberate int16 CLAMP (whose six-line comment
explains why it clamps rather than wraps), `logic/mqtt_group.hpp`'s `if (s[i] == '-' && ++i ==
s.size())` (well-defined — `&&` sequences), and a `logic/profile_view.hpp` reference return reachable
only by violating the documented `count()` bound. `clang-analyzer-*`: 2 findings, both false.
`performance-unnecessary-value-param`: zero. `-Wconversion`: 3 hits, all `logic/config_store.hpp`
byte-packing that already masks with `& 0xFF`. `-Wshadow`: 3 hits, all in the test file. The reason
the yield is this low is structural and visible in the code — the bug classes are TYPED out rather
than linted out (wire bytes are `uint8_t*` everywhere, so char-signedness cannot occur; every enum
subscript is bounds-checked; structs carry NSDMIs) — and the defects this project actually ships
fixes for are domain and resource-budget defects, which are not in a linter's language. So there is
deliberately no `.clang-tidy` file either: an inert config reads like a guarantee while doing nothing.
What that survey DID find was the opposite gap. `main/logic/` was never the exposed half — it has
`-Wall -Wextra -Werror`, 6300+ lines of host tests and seven audits. `main/*.cpp` was: 28 files where
every shipped crash happened, carrying no warning policy of its own while THREE comments in it
(`nvs_storage.hpp`'s `[[nodiscard]]`, `hp_comm.cpp`'s unreachable return, `logic/timestamp.hpp`'s
`%d` cast) were written as though a warning class were fatal. What that half lacked was not an
analyser but a PINNED contract, so `main/CMakeLists.txt` now sets `-Werror=return-type`,
`-Werror=format` and `-Werror=unused-result` on that component alone. It is not a `gates` step and
costs no CI minute: the firmware `build` job is the only compile of `main/*.cpp`, which is also why
`scripts/run-mock-tests.sh` cannot see the format case (`int32_t` is `long int` on xtensa, plain
`int` on the host).

Every one of them EXCEPT the recording check is a STEP of CI's single `gates` job, which the firmware
`build` job `needs` — not
a job each (the version gate itself runs inside `build`, where the stamped version exists; only its
tests are a `gates` step). The recording is the stated exception: `run-ui-gif-audit.sh` and
`tools/uigif/selftest.sh` are NOT steps, because their only remedy is a local re-record CI cannot
perform, so enforcing them would buy re-stamping rather than re-recording. Count them with
`sed -n '/^  gates:/,/^  build:/p' .github/workflows/build.yml | grep -c 'run: \./\(scripts\|tools\)/'`
rather than trusting a number written here, which drifts the moment one is added — and scope the
count to the JOB, since the same pattern run over the whole file also picks up the `build` job's own
script steps (22 workflow-wide vs 17 gates today), i.e. answers a different question than the one
being asked. Actions bills every JOB rounded up to a whole
minute, so N ~15 s jobs cost N billed minutes for well under one minute of work. The same budget rule shapes the rest of
`.github/workflows/build.yml`, and it is worth knowing before editing it: the ~5-minute firmware
build is SKIPPED (not failed — a skipped job still reports its check, which is why the gate is a
per-job `if:` and never a workflow-level `paths-ignore:`) when the diff touches nothing the image
or the published site is made of, on pull requests as much as on pushes; ccache is carried across
runs, KEYED ON THE TOOLCHAIN + `sdkconfig.defaults` (via `scripts/idf-version.sh`, the one shell
reader of the `esp_idf_version:` pin — `idf-docker.sh` uses it too) and deliberately NOT on a hash
of `build.yml`, so editing this file no longer discards a cache nothing in it invalidated;
a PR publishes NOTHING (the per-PR preview installer at gh-pages `PR/<N>/` is retired —
each preview was a `gh-pages` push and every `gh-pages` push starts GitHub's own three-job "pages
build and deployment" run, while the dev channel answers the same question per merge); Renovate
runs daily + on demand, not once per merge. A new always-on job, an
ungated build or a per-commit publish is a real monthly cost, not a rounding error.

It covers the X10A **CRC** and framing (`logic/crc.hpp`), the **value converters**
(`logic/convert.hpp` — the riskiest part of the port), register extraction
(`logic/registers.hpp`), the **config model / validation** (`logic/config_model.hpp`) and the
**HA-discovery payloads** (`logic/discovery.hpp`). CI gates the firmware build on it
(the `gates` job's host-logic step). Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` only the device can run. Full detail:
[`test/README.md`](../test/README.md).

**Passing the tests is not the same as being RIGHT.** The tests verify the logic they are handed;
they cannot see a value that is well-formed, compiles, drifts no doc — and is physically false. A
wrong converter id published `-971.5 °C` as a mixed-water temperature on eight profiles, a valve
*position* reached Home Assistant as a 12800 °C temperature sensor, and a "no data" sentinel was
published as a real `-3276.8 °C` reading (issues #35–#39) — all found by slow manual review. So the
value catalog has its own gate, separate from the technical ones:

```bash
scripts/run-domain-audit.sh   # real converters x real catalog, cross-checked vs docs/REGISTERS.md §5
tools/domain/selftest.sh      # does the audit still catch the defects it was built for?
```

It reports wrong converters, spec/layout drift, cross-profile outliers, non-temperatures typed °C,
straddling byte windows, and — since #230 — ONE WIRE FIELD DESCRIBED BY TWO DIFFERENT PHYSICAL UNITS
(`LABEL-UNIT`), each with a decode witness (wire bytes → what it should read → what it does). That
last one is the only check whose subject is the LABEL, and it is there because a label is an
identifier: `ha_slug()` turns it into the HA entity id and the VictoriaMetrics series suffix, so the
unit word inside it is a published claim about the quantity. Page 0x30/1 (conv 211) is "Fan 1 (step)"
on 22 profiles and "Fan 1 (10 rpm)" on four, at the same offset with the same converter and width —
so a reader of `actuators_fan_1_10_rpm` takes a 30 for 300 rpm rather than step 30, and every other
check is satisfied (SPEC-CONV matches BY label and misses it, SPEC-LAYOUT sees a conforming layout,
CONSENSUS groups BY label so the spellings never meet, and #217's frozen identifier set already
contains both). It compares the UNIT ALONE, never the rest of the label: the catalog legitimately
spells one quantity several ways per family, so a text check would demand prose the source data does
not have. CI gates the build on it (a `gates` step); the judgement half is the `/domain-review`
skill, a **PR-merge gate** required on **every** merge — like `/project-review`, and unlike the
conditional `/feature-docs`. Unconditional because deciding up front which files can change a
value's meaning is a guess, and it is the guess that let #35–#39 ship; a PR that cannot reach a
value clears in seconds, but a person states that rather than a regex assuming it. Adjudicated
deviations live in `tools/domain/audit_exceptions.txt`; it distinguishes an on-record ADJUDICATION
(a real per-model difference) from a temporary KNOWN-DEFECT (tracked + deleted by its fix). The four
*pre-existing* defects the audit opened with (#35–#39) are fixed (PR #82) and their entries removed —
a KNOWN-DEFECT that outlives its fix would silence the guard against the fix regressing — and each is
now pinned by a catalog `CHECK` instead. The FOUR `LABEL-UNIT` rows of #230 A are likewise fixed and
their ledger entries removed: `logic/label_override.hpp` republishes page 0x30/1 as the spec-correct
"Fan 1 (step)" on every profile — the sibling of `conv_override.hpp`, since the generated tables are
still wrong and the offline generator is out-of-repo — so the audit now resolves the PUBLISHED
(adjudicated) label at row collection and `LABEL-UNIT` no longer fires. The rename is a #221
MIGRATION (`mqtt_ha.cpp`'s `retract_relabeled_values` deletes the stale `actuators_fan_1_10_rpm` HA
entity on upgrade; the VictoriaMetrics series forks — unavoidable — only for a unit on one of the
four profiles, the reference install already publishing the majority `_step`). The still-wrong
source is guarded by `test_label_override()`'s raw-count pin (== 4): the day the generator emits
"Fan 1 (step)" it trips, forcing the override's deletion. So `audit_exceptions.txt` currently carries
**no** live entries.

## Build & Flash

No local ESP-IDF — builds run via `scripts/idf-docker.sh`, which uses the `espressif/idf` Docker
image **pinned to the version CI builds with** (read at runtime from
`.github/workflows/build.yml`). Flash from the host with `esptool` (`brew install esptool`),
since Docker on macOS has no USB passthrough. The `flash-esp32` skill wraps both.
When waiting on CI, block on `gh run watch <run-id> --exit-status` — never sleep-poll.

```bash
# Build (first run: set-target; afterwards plain `build` stays incremental). CI builds esp32s3.
scripts/idf-docker.sh idf.py set-target esp32s3 build

# Optional compile-time defaults (all also settable at runtime in the web UI)
scripts/idf-docker.sh idf.py menuconfig                 # -> Daikin Altherma Configuration

# Sign the app first — REQUIRED. This config uses the Secure Boot v2 signature scheme
# (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT); an UNSIGNED image crash-loops at boot
# (esp_secure_boot_init_checks abort, before app_main). Needs the offline ota_signing_key.pem
# (never committed; see docs/SECURITY.md). No eFuses burned -> unsigned is a crash-loop, not a brick.
espsecure.py sign_data --version 2 --keyfile "$OTA_SIGNING_KEY_FILE" \
  --output build/daikin-signed.bin build/daikin-altherma-esp32.bin
cp build/daikin-signed.bin build/daikin-altherma-esp32.bin   # @flash_args flashes this path

# Guard: refuse to flash an UNSIGNED image (would crash-loop before app_main + wipe the fallback).
# Exits non-zero with the signing command if unsigned. The flash-esp32 skill runs this for you.
scripts/require-signed.sh build/daikin-altherma-esp32.bin

# Flash from the host (preserves nvs — @flash_args skips nvs@0x9000)
cd build && esptool --chip esp32s3 -p <port> write_flash "@flash_args"
```

Two boards are documented, and they are the reference for *different* things. The compile-time X10A
pin defaults are the **Seeed XIAO ESP32-S3**'s — **RX=44 (D7) / TX=43 (D6)** — so that board finds
the bus unconfigured; GPIO16/17 are not broken out on it. The **M5Stack AtomS3 Lite** is what the
user-facing wiring (README table, `docs/WIRING.md` diagram) is written for, because its Grove
HY2.0-4P port carries GND/5 V/G2/G1 and reaches X10A with no soldering — but **RX=1 / TX=2 must be
picked once** in the UI, since detection probes only the cached pair, the Kconfig pair and each of
them swapped. Both flash over native USB-Serial/JTAG without a BOOT-button dance.

## Architecture (component map)

```
main.cpp        boot: NVS, config, safe-mode guard, WiFi(STA)|setup-AP, SNTP, mDNS, HTTP, MQTT, poll, OTA gate.
                The sequence runs inside an EXCEPTION BOUNDARY (boot_sequence/boot_failed): app_main is
                a C frame boundary like every handler and task loop here, and boot allocates, so an
                escape used to reach std::terminate anonymously. It abort()s with the phase named —
                abort and NOT esp_restart, because boot_reset_was_crash classifies a "sw" reset as
                INTENTIONAL and clears the crash counter on it, so a boot that always threw would
                restart forever without ever accumulating one crash boot. A panic COUNTS, writes a
                dump, and reaches safe mode after four
safe_mode.cpp   boot-loop safe mode (logic/boot_guard.hpp): counts crash-only boots in NVS "daik_cfg"
                (boot_fails); past BOOT_FAIL_THRESHOLD it latches -> main.cpp skips the poll engine + MQTT
                bridge (WiFi + web UI + OTA stay up) so a bad config (e.g. wrong RX/TX pins) is fixable
                in-browser, not over USB; a clean/intentional reboot resets the count, and a
                BOOT_HEALTHY_S-uptime timer clears it. That timer is NOT armed while safe mode is
                latched (boot_healthy_timer_arms), and that one condition is what makes this a LATCH
                rather than a CYCLE: safe mode runs with the poll engine and MQTT down — precisely
                where a config crash-loop lives — so surviving 30 s there is evidence about the
                RECOVERY SURFACE, not about the fault. Armed, it cleared the counter 30 s into every
                recovery boot, so the next crash reset started from zero and brought the full stack
                back up on the configuration already proven to crash four times; the device then
                spent BOOT_FAIL_THRESHOLD boots crash-looping for each one it was fixable in.
                Nothing is stranded by refusing: ANY non-crash reset zeroes the counter and every
                intentional exit is one (a /set_* save, an OTA install, a power cycle, the recovery
                button), so safe mode ends when somebody acts on it and only then.
                Drives /status.sys.safe_mode + the UI recovery banner
heap_guard.cpp  THE HEAP WATCHDOG's device glue (logic/heap_watchdog.hpp) — the escalation every other
                OOM guard here deliberately lacks. handle_all answers 503, each allocating task loop
                catches std::bad_alloc and skips the cycle keeping its last good state, a publish is
                dropped: all correct for a TRANSIENT shortage, and none of them asks what happens
                when it never recovers. Composed, they describe a device that is powered, associated,
                answering 503 to everything and republishing nothing, indefinitely, reporting no
                fault — a HANG, which is worse than a crash (a crash reboots in seconds and leaves a
                reset reason, a core dump and a syslog record; a wedge looks like a powered-off
                device and heals never). So a largest CONTIGUOUS INTERNAL block under
                HEAP_CRITICAL_BYTES for HEAP_CRITICAL_HOLD_MS unbroken becomes a deliberate
                esp_restart, capped at HEAP_MAX_CONSECUTIVE_RESTARTS by the NVS "heap_rst"
                breadcrumb (an i32, not a formatted string: the whole restart path stays
                allocation-free on a heap that is by definition failing). An in-flight OTA CLEARS the
                run rather than pausing it — a paused run could resume its clock and fire mid-install.
                Also the home of heap_largest_internal_block(), THE ONE largest-block sampler: every
                reporting site (history's max_alloc trend, the MQTT heartbeat, /status.sys.max_alloc,
                /set_mqtt's pre-flight) used MALLOC_CAP_DEFAULT, which answers from PSRAM on a board
                that has it (sdkconfig.defaults offers CONFIG_SPIRAM), so all four would have
                reported megabytes of headroom while internal DRAM sat at a few hundred bytes.
                Sampled by hp_poll at the top of every cycle beside history_record_board(), the one
                path in that task no branch can skip — so NOT in safe mode, which does not start the
                poll task; that is stated rather than hidden, and is defensible because safe mode has
                already shut down the five largest allocators and is itself the reachable minimal
                state a restart would be trying to reach
config.cpp      runtime Config (logic/config_model.hpp): WiFi/MQTT + one-shot WiFi rollback backup +
                link cache (pins/proto) in NVS "daik_cfg"; model (profile/fingerprint) RAM-only
                (config_set_model); mutex-guarded. Writers commit only the fields they OWN: the two
                writing tasks (httpd /set_*, poll detection) would otherwise revert each other from a
                stale snapshot — detection uses config_save_link/config_set_model, HTTP keeps
                whole-struct config_save. A failed NVS write names the key on /diag. A failed atomic
                blob means config_save returns false and publishes nothing; a later failure in the
                separate self-healing link cache is logged but does not falsely fail an already-saved
                service change. /set_hp explicitly requires the cache and leaves RAM untouched if it
                fails. config_save_link still patches RAM (its link is proven-good); every call site
                checks its own durability contract. The credential/service half of config_save is
                ATOMIC: those fields go into ONE CRC-checked blob (logic/config_store.hpp) written with
                a single nvs_set_blob, so a save is all-or-nothing across BOTH a write failure AND a
                power cut — no per-key rollback and no WiFi creds-vs-backup write-ordering to get right
                (both are now inside the one atomic blob). The blob is written by the httpd task alone,
                so the poll task can never revert a credential change. The RX/TX/proto LINK cache stays
                as separate self-healing keys (two owners; re-validated on load). config_load reads the
                blob first and falls back to the legacy per-key layout when it is absent (fresh device /
                pre-blob OTA) or fails its CRC. See "NVS namespaces".
                config_load re-checks the persisted RX/TX with link_pins_safe (the PAIR rule plus the
                chip-reserved-pin rule of logic/board_pins.hpp) and falls back
                to the Kconfig defaults + a diag line if they fail: rx_pin/tx_pin are two independent
                commits on BOTH write paths (config_save_link as much as config_save), so flash can
                still hold a pair (rx == tx, a pin off this chip, or a reserved flash/strapping/JTAG
                pad) the request path would have
                rejected — a failure named on /diag is not a pair fixed on flash
nvs_storage.cpp thin NVS helpers (IDF nvs_* called with :: to avoid the daik::nvs_* collision);
                the setters return esp_err_t so config.cpp can name the failing key + error on /diag,
                and are [[nodiscard]] (main/CMakeLists.txt pins -Werror=unused-result on the
                component, so an ignored result is a build error rather than a review catch —
                before that it depended on IDF's own defaults) — safe_mode.cpp silently dropped its
                crash-counter write, which left safe mode unable to latch on the wedged flash that is
                itself a plausible crash-loop cause. Compare to ESP_OK, never coerce to bool
wifi.cpp        STA bring-up (all-channel scan -> strongest AP by RSSI) + endless reconnect
                (first-boot budget -> setup portal; once online it NEVER reboots — no reason code
                ends the retry, since 15/202/204 are also the transient WPA3-SAE failures this file
                works around, and a runtime auth-fail reboot let an RF storm strand a healthy board
                in the open portal) + REASON-AWARE one-shot credential rollback (new creds fail to
                get a lease -> restore the NVS backup + reboot, marking wifi_rolledbk so /status can
                say so; policy host-tested in logic/wifi_rollback.hpp — only an AP that KEEPS refusing
                the creds takes the fast path, and must sustain it across 2 checkpoints (~60 s), since
                one sample can't tell a wrong password from a transient SAE fail; an ABSENT SSID (a
                router still rebooting, 1-3 min) gets a 180 s grace instead, since the blind deadline
                destroyed valid new creds; a pending change also suspends the first-boot retry budget)
                + ICMP gateway watchdog (ghost-assoc recovery; the probe is
                three-valued and the policy is host-tested in logic/link_watch.hpp — proven silence
                re-associates after 2 periods, a SUSTAINED inability to probe at all after 10, since
                "couldn't measure" previously read as "healthy" and left a wedged board undetected
                AND unlogged; decisions go to diag_printf so they reach /diag + syslog, not just the
                serial console) + scan + DHCP
                hostname (option 12) + mDNS; wifi_info() also reports the associated AP's BSSID + PHY
                standard + this STA's MAC; wifi_reconnect_count() — cumulative RE-connects since boot,
                for the MQTT heartbeat
sntp_time.cpp   SNTP client (esp_netif_sntp, config().ntp_server — NVS "ntp_server" override of
                CONFIG_DAIKIN_NTP_SERVER default "pool.ntp.org", runtime-editable via POST /set_ntp
                exactly like syslog_host/POST /set_syslog) — started right after WiFi(STA)|setup-AP
                in main.cpp, once config_load() has run (the process-wide esp_netif_init() runs
                exactly once in app_main, before either STA or the setup portal creates its own
                interface); non-blocking, idles/retries on its own task until a route to the
                server exists, so it is harmless to start in AP-only setup mode too. Before this the
                device had no wall clock at all: diag_printf's "[uptime]" prefix and syslog's RFC 5424
                TIMESTAMP were the only timestamps anywhere, both relative to an unknown boot instant.
                time_synced()/time_now()/time_status() expose the sync flag + current UTC instant
                (read straight from newlib's clock, which the sync callback drives via
                settimeofday() — no separate offset-tracking to drift out of sync with it);
                logic/timestamp.hpp renders it as RFC 3339 for syslog.cpp's TIMESTAMP field and the
                top-level /status.ntp block. The uptime prefix stays as-is everywhere it already was
                (device-triage's boot-reconstruction technique keys on it jumping backwards on a
                reboot, and it is available before the very first sync of a boot, when the wall clock
                is still unset) — SNTP adds a second, absolute clock rather than replacing the first.
                The server string is resolved ONCE at startup into a file-scope std::string (lwip's
                SNTP module stores the raw pointer it's given, not a copy, so it must outlive the
                client) — a later /set_ntp edit reboots into a fresh config_load() rather than
                mutating it live.
provisioning.cpp setup SoftAP (daikin-altherma-esp32-setup) + DHCP DNS-offer; HTTP is the shared :80
                server. AP-ONLY: the portal takes the SSID as TYPED TEXT (setup.html has no dropdown
                and fetches nothing), so the idle STA interface an earlier APSTA version brought up
                purely to make esp_wifi_scan_start() work is gone with the scan — and a hidden network
                is entered like any other. /scan stays a trusted-LAN-only route (logic/http_surface.hpp:
                an open radio has no reason to be handed every AP in range). h_index still treats
                APSTA like AP (serve setup.html) — the STA path is WIFI_MODE_STA, so any mode with a
                live SoftAP means setup. The DHCP hand-off also advertises the RFC 8910 captive-portal
                URI (option 114, ESP_NETIF_CAPTIVEPORTAL_URI) alongside the DNS offer — recent
                iOS/Android prefer it over probing at all, and a client that ignores it still finds
                the portal via the probe redirect (logic/captive.hpp). The URI is a STATIC buffer:
                IDF stores the POINTER it is handed, not a copy, so it must outlive the DHCP server —
                the same lifetime trap as sntp_time.cpp's server string. All four steps are CHECKED
                and a failure is named on diag (serial only in AP mode — /diag is withheld from the
                open setup-AP surface); discarding those return codes is what made "the portal
                doesn't pop" a report with no evidence behind it
captive_dns.cpp UDP:53 catch-all (every name -> 192.168.4.1) so the setup portal auto-pops (setup mode
                only). The response copies the query's RD bit and sets RA (RFC 1035 4.1.1) — a stub
                resolver that sees Recursion-Desired come back cleared may discard the answer, and a
                discarded answer means the OS probe never reaches us. Non-A queries (AAAA) get a
                0-answer NOERROR, so a phone can't prefer an IPv6 route off-device
hp_comm.cpp     X10A UART (9600 8E1) + register query. hp_uart_init installs the driver ONCE, then a
                pin change is a register-only uart_set_pin remap (logic/uart_plan.hpp) — NOT a
                uart_driver_delete+install. The old reinstall-per-swap allocated a fresh RX ring +
                driver struct every call; the detect sweep alternates the pins ~2x/s on a silent bus,
                so that churn fragmented the heap until an unrelated alloc (hp_poll's vector) hit an
                unwind-starved bad_alloc -> std::terminate -> abort (confirmed by a symbolized coredump)
hp_convert.cpp  device value formatting over logic/convert.hpp; applies its reading_plausible() at
                PUBLISH time — an impossible °C reading (idle-unit 576 °C, a ±3276.x sentinel), a
                0-bar saturation temp, or a 0-bar REFRIGERANT pressure reaches HA as unavailable, not
                a false value. Then value_available() (logic/availability.hpp), which catches the
                case the envelope structurally cannot: a value that is wrong because it is entirely
                ORDINARY — a condensing target of exactly 0 °C on a row this unit does not populate. The pressure rule needs the whole profile table (passed down from
                hp_poll), because 0 bar is impossible for refrigerant — these are ABSOLUTE pressures
                and a sealed circuit is never at vacuum — but ordinary for WATER (a drained system).
                is_refrigerant_pressure() takes that split STRUCTURALLY, never from the label (an
                alias or a translation would flip it), on either of two signals: the PAGE (0x20/0x21/
                0xA0/0xA1 are the outdoor unit's own — no water circuit out there; measured across all
                45 profiles, every bar row on 0x20/0xA0 is refrigerant and no water row appears on
                either), or a conv-405 saturation-temperature twin at the same (reg, offset), which is
                what reaches the refrigerant rows on the MIXED hydronic page 0x62 (0x62/15 refrigerant
                vs 0x62/11 water). Covers 93 of the catalog's bar rows; the KNOWN GAP is 16
                "Refrigerant pressure sensor" + 1 "Pressure sensor" on 0x62 with no twin, left rather
                than closed by label-matching. test_refrigerant_pressure_catalog() pins both the
                coverage and the direction that matters — no water row is EVER flagged, since a false
                positive would withhold a real 0-bar reading from a drained system. Measured on a
                live 4-8 kW unit, High/Low Pressure read exactly 0.0 bar at rest AND at 42 rps while
                the 0x62/15 sensor read a correct 15.3 bar. Kept out of
                convert() so the domain audit still sees each converter's intrinsic semantics
hp_detect.cpp   auto-detect glue: protocol sweep + page probe -> fingerprint -> candidate models. The
                O/U capacity is read from a VARIABLE-LENGTH page 0x00 (a smaller unit's short reply
                omits offset 12); when absent, the I/U capacity code (0x60/6, same kW×10 units) is a
                fallback that only RANKS detect_best (never excludes a candidate; no-op when the O/U
                capacity is known). The detect diag line prints iu_kw= and retries= (retries that RECOVERED a
                page, so 0 is the healthy reading — attempts on a page the unit simply lacks, e.g.
                0x65, are not counted; a baseline of 3 trained the reader to ignore the number).
                The page probe RETRIES each page (DETECT_PAGE_TRIES=3, read_page_retry) because it
                gathers the unit's IDENTITY, not its values: signature_consistent matches on page
                SUBSET, so one dropped frame clears one page bit and can make EVERY profile
                inconsistent at once. Measured over the shipped signatures on the live 0x1bff
                fingerprint, all 12 single-page losses change the answer and 8 of them leave NO
                candidate — the caller then reads with `generic` (53 rows vs ~99, no leaving-water
                measurement, no compressor speed, no pressures), so there is no page it is safe to
                drop. The retry is paid only on failure; a page that answers costs one query as
                before, and the protocol/pins are already proven by the time step 2 runs (#214)
hp_modbus.cpp   THE HOMEHUB MODBUS STACK — a SECOND, INDEPENDENT source of readings beside the X10A
                one (issue #32): its OWN task, cache and link state, sharing nothing with hp_poll.cpp
                but the heat pump it describes. There is no "which transport" selector and never was
                one that survived review: the two links fail for unrelated reasons (X10A at the cable,
                the pin or the framing; Modbus at the LAN, mDNS or the hub), so coupling them lets
                either failure mask the other. Pull the service cable and the HomeHub keeps reporting;
                lose the LAN and X10A keeps polling.
                Gated on one persistent address: non-empty mb_host dials exactly that target; empty
                disables the stack completely. The runtime gate is literal: while the address is
                empty there is no task, socket, mDNS traffic or stack — which is what let hp_poll give
                back the 4 KB an earlier revision took from it (the getaddrinfo/socket call chain now
                lives on the task that makes those calls; syslog.cpp measured that same chain at 6144,
                which is this task's size). Disabling it live retires the task: it checks the address
                at the top of its cycle and deletes itself, so the socket keeps exactly one owner.
                A lwIP socket around the pure logic/modbus.hpp framing: MBAP send/recv, request-BOUND
                parse (txn/unit/qty), a whole-reply deadline (a per-call SO_RCVTIMEO does not bound a
                peer trickling one byte per timeout, and this task is watchdog-subscribed) and a socket
                DROPPED on any framing/desync error so the next cycle reconnects. mDNS discovery is
                ONLY the explicit POST /discover_homehub dialog action: browse _http._tcp (what the
                hub advertises, EKRHH §2.5), filter is_homehub_hostname — MANDATORY, since this
                firmware answers that same browse — and return the resolved IPv4 without saving it.
                The user may edit it and Save or Cancel. A failed connection to a saved target BACKS
                OFF through the X10A sweep's own host-tested logic/detect_backoff.hpp; the poll task
                never browses mDNS or silently changes the configured address.
                READ-ONLY as a property of the CODE, not of a guard around a dormant capability:
                no write entry point, no FC06/FC16 request builder, no issued write function code
                anywhere under main/ — test/test_heating_curve_diagnosis_contract.mjs walks every file to
                keep it so, and re-adding one fails there first. The hub's other clients (Onecta, the
                MMI, evcc on EKRHH 56/57) do write it; this firmware only reads their result. One
                HomeHub fact reaches the controller: the PLANT GATE, an ordinary FC04 read of input
                register 53 ("Space heating/cooling normal operation"), which separates a real
                space-heating window from a DHW cycle (register 52) or a standstill. On /status.modbus
                as plant_gate_known/plant_gate_active — known=false means the register did not answer
                and must NEVER read as an inactive plant.
hp_poll.cpp     poll engine task: X10A ONLY. Calls heap_guard_sample() at the top of every cycle,
                beside history_record_board() and for the same reason (the one path in this task no
                branch can skip; test_source_absence_contract.mjs pins both). The HomeHub is a
                separate stack in hp_modbus.cpp with
                its own task and cache, so nothing here branches on a transport and this task's 8192
                stack is the one it ran on for months. (auto-detect if profile=="auto") profile
                registers -> query -> decode -> thread-safe cache. It PUBLISHES to no client — the
                /events WebSocket broadcaster that used to end each cycle here is GONE, and with it
                the /status builder it ran on this task (#241; docs/ARCHITECTURE.md "Push vs. poll").
                The browser polls /status + /values instead. Subscribed to the
                Task Watchdog (esp_task_wdt_add): reset per cycle + once per register in the sweep, so
                a wedged X10A read reboots cleanly (reset reason task_wdt) instead of hanging silently.
                On a SILENT bus the auto-detect sweep BACKS OFF (logic/detect_backoff.hpp): full 1s
                cadence at first, then stretched toward a 60s ceiling by SKIPPING sweep ticks (the 1s
                top-of-loop wdt reset still fires, so any ceiling is wdt-safe; the ceiling is a
                detection-latency choice, not a wdt constraint). Reset to fast cadence on a bus answer
                or via hp_poll_reconfigure() (POST /detect, POST /set_hp — atomic httpd->poll one-shot).
                poll_once reserves the value vector up front (one sized alloc, not log2(n) regrows).
                It skips a row row_publishable() refuses (logic/availability.hpp composed with
                no_publish — so an Unproven row costs no decode and, where a whole page is
                unpublishable, no bus round-trip), MARKS each cached row the outdoor unit is no
                longer refreshing (logic::ou_is_rps_witness -> ou_reading_held_over: CachedValue.held,
                /values "held":true, and the MQTT bridge WITHHOLDS it — #209 defect 5. The value is
                marked, NOT dropped: history.cpp needs it to tell HELD_OVER from NO_READING), and
                DUMPS the raw 0x10/0x20 payloads to /diag while the compressor RUNS
                (logic/raw_capture.hpp — #194's decisive experiment, which the detect-pass dump
                structurally cannot take, since a detect pass is always a unit at rest).
                It also CAPTURES the cross-page SATURATION WITNESS (logic/availability.hpp) as the
                hydronic page goes by and carries it to the NEXT cycle, poll-task-owned and
                mutex-free. Carried rather than used in-cycle because the sweep reads pages in table
                order and the witness page (0x62) comes AFTER the page it judges (0x20): the
                alternatives were a second bus round-trip per cycle, or a read-all-then-decode
                restructure that would move every row's verdict out of value_available() into a
                post-pass — the one thing row_publishable() exists to prevent. Staleness is bounded
                at one poll interval (1 s) against a condensing temperature with 20 K of bound
                headroom, and it EXPIRES unconditionally each cycle, so a witness page that goes
                silent falls open rather than authorizing a withholding forever
env3.cpp        OPTIONAL local climate sensor — the M5Stack ENV III Grove unit (SHT30 temperature +
                humidity at 0x44, QMP6988 pressure at 0x70 on one I2C bus). A THIRD reading source
                beside X10A and the HomeHub, sharing nothing with either: its own task (4096, prio 4),
                its own 10s sample cadence and its own 30s freshness window. Like hp_modbus.cpp the
                runtime gate is literal — disabled, or a board whose preset is not M5Stack, and there
                is no task, no bus and no pullups; env3_start() re-checks that itself rather than
                trusting the caller, so a hand-edited Config cannot start an accessory this board has
                no connector for. Support is decided by the board's VENDOR (env3_board_supported ->
                BoardVendor::M5Stack), not its model: what makes the sensor plausible is the Grove
                HY2.0-4P port carrying the pins the one preset names (SDA=2/SCL=1 on the AtomS3 Lite),
                and a vendor is the coarsest fact that implies it. The pin reservation runs in ALL
                directions (logic/config_model.hpp's config_env3_reserved_pins vs the X10A link, the
                status LED and the recovery button, each rejecting the others' pins with a named
                reason) — the same both-ways rule board_pins.hpp already applies, one axis wider. That is the VALIDATOR; the OFFER deliberately is not, since #339: /status.env3's pins_avail and presets are filtered by the live X10A pair ALONE and are sent even while the persisted board is Seeed or Custom, because ONE form now selects the board and its sensor in a single save and a server-side filter computed from the PERSISTED board would withhold exactly the pins the user is about to need. The browser filters its own PENDING LED/button picks, and the request path validates the whole proposed snapshot — the only place all four subsystems are known at once.
                A SAVE is HARDWARE-PROVEN, not merely validated (logic/env3.hpp's Env3SaveCheck):
                enabling on new pins runs env3_probe (a short-lived bus torn down again, retrying the
                QMP6988 chip id and then a full CRC-valid SHT30 measurement — SHT30 has NO chip-id
                register, so a decoded measurement is the only identity proof an ACK cannot give),
                changing pins while running demands DisableFirst (two masters briefly driving one
                shared wire is a bus fault, not a config change), and DISABLING checks nothing at all
                — it is the recovery path and must never depend on hardware that may be the problem.
                Each refusal carries a machine code (env3_not_reachable / env3_sht30_not_found /
                env3_qmp6988_not_found / env3_probe_busy / env3_disable_first) beside the English
                text, so the bilingual UI translates without the API losing its one wording. Applies
                by REBOOT unlike /set_hp: the I2C driver owns the bus for the task's life. Published
                as a retained flat JSON on <base>/env3 plus three HA entities (ENV3_HA_SENSORS) whose
                discovery config carries a TWO-entry availability list with mode "all" — the device
                LWT and a template on the state topic itself — so a stale or failed sensor marks only
                these three entities unavailable while the rest of the device stays online, and an
                error publishes {} rather than carrying the last plausible outdoor value forward.
                It republishes when the SAMPLE COUNTER advanced even if the rounded text is identical,
                so a time-series subscriber sees the sensor's real 10s cadence instead of a gap that
                reads like a dropout. The QMP6988's own temperature is decoded and DISCARDED — one
                quantity, one sensor, so nothing has to explain which of two temperatures a reading
                is. Deliberately NOT in /values or the checkup: those describe the heat pump, and an
                accessory on the board is not a plant reading. Its ONE firmware consumer is the
                HEATING-CURVE DIAGNOSIS (mqtt_ha.cpp), which records the temperature as the optional
                OUTDOOR AXIS of each sample — gated on the same fresh-AND-plausible pair as the MQTT
                document, so a reading this firmware will not publish cannot reach a sample instead;
                and CONTEXT, never a gate, so a board without the sensor samples identically. What
                the firmware CANNOT know is WHERE the sensor hangs: beside the indoor unit it is
                room air, over a long I2C run to a sheltered outdoor position it is genuine outdoor
                air, and only the latter makes that axis mean anything. The device states the
                READING, not its MEANING — placement is the owner's fact, so anything downstream
                that depends on it has to record it. It DOES carry its own 24-hour rings
                (ENV3_HISTORIES in logic/env3.hpp, served as the separate GET /history?source=env3
                rather than mixed into the X10A trend set) and one schematic pill. NOT
                watchdog-subscribed either — every transaction is bounded by a 100ms I2C timeout, so
                the loop cannot wedge the way a silent UART can
weather_forecast.cpp  the Open-Meteo forecast client (provider + model pinned in code:
                icon_seamless), optional comparison evidence for heating-curve diagnosis. Own task,
                and its 12288 stack is the largest of the tasks this firmware creates itself (only
                the httpd worker's 16384 is bigger) for the reason CLAUDE.md's stack section states —
                TLS + HTTP + JSON on one frame — with the loop body under a try/catch —
                though only the `catch (const std::exception&)` half: unlike mqtt_task, poll_task,
                mb_task and syslog_task it carries no `catch (...)`, so a non-std throw still unwinds
                past the task boundary into std::terminate and reboots the board. Cadence 45 min on success, 5 min on
                failure, and POST /set_weather only NOTIFIES it, so the request path does no DNS, TLS
                or JSON work. Skipped in safe mode. THE SAVED LOCATION IS THE WHOLE GATE (#357): the
                loop checks cfg.weather_enabled and idles on a 60 s notify-wait BEFORE the URL is
                built, so no socket opens at all — one condition, checked in one place. #341's second
                gate (the retired dynamic-LWT mode, with a set_feature_inactive() state that kept
                configured=true while blanking every runtime value) is GONE with the switch that set
                it: saving coordinates IS the consent to send them, and to send this installation's
                public source IP with them, so a stored location deliberately not being fetched no
                longer exists as a state. Clearing the location is set_disabled(), which drops the
                coordinates and reasons "not_configured". POST /set_weather notifies this task, so
                the boundary moves at the request rather than up to a sleep interval later. The response is bounded before it is read
                (Content-Length checked against an 8 KiB cap, then 1 KiB chunks against a running
                total) and never stored: nothing about a forecast survives a reboot. forecast_hours=6
                is deliberately larger than the four bins needed, so a request that crosses an hour
                boundary during the TLS handshake still has two COMPLETE future bins to average.
                logic/open_meteo.hpp derives the two figures the controller sees — outdoor_mean_2h_c
                and solar_energy_2h_wh_m2 — from the two bins after the decision instant; the
                Wh/m² sum is exact rather than approximate because Open-Meteo's hourly
                shortwave_radiation IS the mean W/m² over the preceding hour, so two adjacent means
                sum numerically to an energy. Everything else here is refusal, and it is the point:
                issued_at stays null rather than being backfilled from the fetch time (the endpoint
                does not expose the model-run instant, and a synthesized one would be a fabricated
                provenance — the same refusal logic/timestamp.hpp makes for an unsynced clock); the
                units are re-verified against the units the query asked for, so a provider changing
                them fails closed instead of publishing a °F number as °C; a provider timestamp that
                moves BACKWARD is rejected; and a location edit invalidates the stored value outright,
                since an old city's forecast must never be reported under a new one. The three
                liveness facts fail closed TOGETHER — available = configured AND the task's own
                availability AND fresh, computed the same way in /status, in the MQTT document and in
                the controller's input — while a failed refresh KEEPS the last numbers visible
                (has_value stays true) purely for diagnosis. PRIVACY is structural, not a review
                point: the coordinates are redacted in /status?redact=1 (logic/redact.hpp) and the
                MQTT evidence document on <base>/weather/openmeteo/forecast carries NO coordinates at
                all, which a host test pins by asserting the substrings are absent — a broker archive
                is a place an installation's location would otherwise sit forever. The document is
                published while the location is saved (publish_weather_state(weather_enabled));
                clearing it turns that into a CleanupRetained and /set_weather requests the one empty
                RETAINED publish (mqtt_request_weather_cleanup) — a retained forecast nobody deletes
                goes on reading like a live input long after collection was withdrawn. Exactly ONE
                route can retract it, which the cleanup contract asserts: a second retraction path in
                a route nothing posts to would never run. No HA discovery
                entities (four are RETIRED and actively retracted): this is a metrics stream, and a
                forecast is not a state of this device
history.cpp     the 24-hour trend rings: one fixed-cadence buffer per logic/history.hpp TREND, fed by
                the X10A poll task (history_record), plus twelve HomeHub rings fed by the independent
                Modbus task (history_record_modbus) and three ENV III rings fed by the sensor task
                (#366). Both calls happen BEFORE their cache commit and
                OUTSIDE the cache mutex; this file has its own lock, created before either task starts.
                GET /history defaults to X10A, identifies the circulation witness as MQTT, and takes
                source=modbus for the second instrument and source=env3 for the third — THREE
                independent instruments, never merged into one series, for the reason /values keeps
                two arrays: they have separate liveness, so "is this reading current?" must stay
                answerable per source. STATIC
                (.data), never heap: the binding limit on this board is the largest CONTIGUOUS block,
                and a static array does not compete for it — thirty-one X10A/board/state trends cost
                17856 B, the twelve label-free HomeHub rings another 6912 B and the three ENV III
                rings 1728 B, for 26496 B of ring
                total, plus ~78 B of labels/units/counters each (the ceiling assert is 17856 with that
                arithmetic; the rule that keeps it this low is that a trend follows the SCHEMATIC's
                schematic's numeric pills plus the explicit component state timelines, not
                the ~66 numeric rows
                a profile publishes, which would be ~38 KB). NOT IN NVS, still on purpose: a 576 B blob
                rewritten every 5 minutes is ~100k writes a year in the partition holding the WiFi
                credentials. What changed in #391 is that "not in NVS" stopped meaning "gone on every
                reboot" (logic/history_persist.hpp). TWO media, each covering what the other
                structurally cannot: the ring arrays now live in .noinit DRAM, so any reset that KEPT
                POWER (a /set_* save, an OTA install, a panic, the task watchdog) keeps the readings
                at zero cost — the same memory, no shadow copy, and the flash image SHRANK by ~26.5 KB
                because .data no longer carries an initialiser for them; and a COARSE 30-minute
                snapshot is written to the optional 8 KB `hist` partition from an esp_restart
                shutdown handler, which is what survives an OTA (the .noinit region cannot: the new
                image's sections move). LOSING POWER stays unrecovered ON PURPOSE — only a medium
                off this board could survive it, and taking the plant history off the device is a
                different feature with a different owner (the broker already stores every published
                value). The coarse path is SPLICED IN BEHIND the
                live samples by ABSOLUTE wall-clock bucket and is skipped entirely while the clock
                is unsynced — an unanchored curve has no honest position on the axis, and there is no
                defensible default. A source that has not closed its first bucket yet is WAITED FOR
                rather than skipped (bounded at six buckets): the cursor only moves forward, so a
                HomeHub that powers up with the house would otherwise lose all twelve of its rings
                for the whole boot. The block's write-side padding is TRIMMED before the splice, or a
                ring holding one reading claims a 24 h span it never recorded — history.js reads the
                span off the array length. BinaryEvent rows are OR-FOLDED rather than decimated:
                defrost/BSH/BUH pulses are shorter than a bucket, and keeping one bucket in six
                would erase them from a restored day.
                The RAM path needs no clock at all, and that is a property of the
                medium rather than an assumption: if the bytes survived, power was never lost, so the
                downtime is bounded to about a second and the rings are adopted in place. Its one
                seam is the bucket that was open when the device went down — dropped, so the restore
                can be up to one HISTORY_DT_S adrift. Every path is guarded by a CATALOG FINGERPRINT
                over every trend id/kind/locator plus the geometry, because a ring is addressed by its
                INDEX: insert or reorder a trend and slot 12 stops meaning what it meant when the
                bytes were written, which would hand the expansion valve's day to the DHW tank — the
                #35-#39 substitution arriving through a firmware update. The seal EXCLUDES the open
                bucket's `pending`, and that is load-bearing: covering it would make the CRC stale
                for all but microseconds of every five minutes, so a crash — the case this exists for
                most — would discard a day of intact readings essentially always. The `hist` partition
                is OPTIONAL BY CONSTRUCTION: esp_https_ota writes the app slot and never the table at
                0x8000, so a device updated over the air has no such partition and the feature is
                simply absent there (feature_gate.hpp's rule), reachable only by a re-flash. A factory
                reset erases it and suppresses the shutdown-handler write that same reboot would
                otherwise make — the configuration being erased is the user's, and so is the day of
                readings beside it. /status.history.persist NAMES how this boot's rings came to be
                ("accept", "power_cycle", "wrong_catalog", "bad_crc", …) so a chart that emptied
                itself has a stated cause instead of looking like a defect. The UI still draws the
                span it actually has rather than padding a 24 h axis with absence. The mechanics (bucket folding, wrap-around,
                skipped-bucket filling) live in logic/history.hpp where they are host-tested; this
                file is storage + mutex + the parse of the cache's FORMATTED value back to tenths
                (the converters stay the one source of what a value means, so the domain audit still
                sees them unchanged). The rows are found by (reg, off, unit) straight off the poll
                cache — CachedValue carries `off` for exactly this, and for nothing else — so no
                label matching happens on the poll path at all. FOUR trends are not catalog rows:
                Smart-Grid mode combines two contact bits, the external circulation witness is a
                confirmed MQTT power state, while the BOARD's own free heap and
                largest contiguous block are sampled here (before the lock — heap_caps takes its
                own) in tenths of a KiB. They ride the same ring, route and browser as the catalog
                trends; the board pair answers the one question a single /status number never could
                — whether the heap is DRIFTING (a leak is a slope, fragmentation is the two lines
                separating). That is why they are back on the ESP32 card after #186 dropped the spot
                figures. Two absences are distinguished, because conflating them
                misattributes one to the other: NO_READING (register timed out / reading_plausible
                refused) vs HELD_OVER (the outdoor unit was asleep — ou_stale.hpp). A model change
                (POST /detect) DISCARDS a ring: the same trend on a different profile is a different
                sensor, and continuing the line would splice two units' data into one curve. Both
                routes return the monotonic bucket of sample zero (`b0`), which aligns the two
                instruments exactly before SNTP as well as after it
checkup.cpp     the 24-hour PLANT CHECKUP behind /status.health and the dashboard's Checkup card
                (#208): counted EVENTS and window MINIMA — compressor starts + mean run length,
                defrost count + share of runtime, the lowest water pressure and flow, backup-heater
                minutes (BUH and the DHW booster kept apart), the unit's own fault class, and the
                protection-retry counters. Storage + mutex only; every rule is the host-tested
                logic/checkup.hpp. Fed by the poll task at 1 Hz beside history_record, with the
                compressor state HANDED OVER rather than re-derived (one answer to "is it running",
                so the checkup and the held-over marking cannot disagree). 24 one-hour buckets in
                .bss, RAM-only for history.cpp's reason — the difference is that here the
                consequence is STATED rather than absorbed: covered_s reports how much of the day was
                actually observed and every check answers `collecting` until it has enough, so a
                board that rebooted an hour ago cannot show a green verdict it has no evidence for.
                NOT derived from the trend rings, which is the one thing that looks obvious and is
                wrong: TrendRing::fold keeps the LAST reading of each 5-minute bucket, so a
                compressor cycle shorter than five minutes leaves no trace in it — the short cycling
                the checkup exists to find is exactly what that raster cannot see
http_server.cpp esp_http_server :80; concerns register their own routes (http_handlers.hpp).
                cfg.max_uri_handlers is sized EXACTLY to the trusted-LAN route count — raise it in
                the SAME commit that adds a route: an overflow is silent and lands on the WRONG
                route, since the casualty is whatever registers LAST (the captive/SPA catch-all), so
                the symptom is deep links breaking rather than the new route 404ing. http_register()
                logs a failed registration rather than discarding the return. Picks
                the trust surface from the WiFi mode (esp_wifi_get_mode): the OPEN setup AP registers
                ONLY the provisioning routes (GET / /index.html /favicon.ico, POST /set_wifi +
                captive) and
                withholds /scan /coredump /diag + the config/OTA/MCP surface from an unauthenticated
                radio client; STA (trusted LAN) registers the full API. Boundary = host-tested
                logic/http_surface.hpp, applied via http_register_on (http_common.cpp)
http_common.cpp shared HTTP helpers + the ONE OOM guard every route runs under: http_register()
                stashes the real handler in user_ctx and installs a handle_all trampoline that calls
                it inside try/catch — std::bad_alloc -> 503, any other throw -> 500, instead of
                unwinding through esp_http_server's C frames to std::terminate -> reboot. EVERY route
                is under it now — the one exception (/events, raw-registered because is_websocket
                bypasses the trampoline, so it had to self-guard) no longer exists
http_status.cpp GET / (setup.html in AP mode, else gzip UI) /favicon.ico /heat-pump-icon.png /status
                /values /history /models /diag /scan /coredump + POST /crash/dismiss + captive
                catch-all. http_append_status_json() runs
                on the httpd task ALONE — it used to run on the poll task too, which is what
                overflowed that task's stack (#241)
http_config.cpp POST /set_wifi /set_mqtt /test_ref_temp /set_ref_temp /test_circulation
                /set_circulation /set_syslog /set_ntp
                /set_weather /set_hp /discover_homehub /set_board /set_env3
                /set_ota /set_lang /detect — ALL SIXTEEN write routes, and the count is the point:
                http_server.cpp's cfg.max_uri_handlers is sized exactly to the trusted-LAN route
                total (34), so a route added here without raising it there overflows onto the SPA
                catch-all — and one RETIRED here without lowering it there leaves a comment that has
                stopped describing the code depending on it (#357 retired /set_dynamic_lwt: 33 -> 32;
                #361 added the circulation test/persist pair: 32 -> 34).
                FOUR of the sixteen are not config writers: /test_ref_temp and /test_circulation
                write nothing at all (each earns the proof its /set_ sibling then demands),
                /discover_homehub only
                resolves an address for the dialog to fill in, and /detect resets profile +
                fingerprint in RAM alone, since detection is re-run every boot anyway
http_ota.cpp    /ota/check|update|status
mcp_server.cpp  /mcp device glue (stateless read-only MCP: initialize/tools/list/tools/call;
                get_status + get_hp_values reuse the exact HTTP snapshot builders; GET serves an
                embedded dependency-free static information + setup page, never SSE)
mqtt_ha.cpp     HA MQTT-Discovery bridge: esp-mqtt client + publish task; X10A publishes one retained
                grouped-JSON document on <base>/x10a (logic/mqtt_group.hpp), and an enabled HomeHub
                publishes its separate flat retained map on <base>/modbus. Both republish on change;
                HomeHub values deliberately have no HA discovery entities, a disconnected link sends
                {}, and Off retracts its data topic. Bounded exact-topic probes delete the retired
                <base>/state and <base>/modbus/status values only when the broker proves they remain,
                so a clean broker receives no repeating empty topics. LWT availability, mqtts+CA on
                creds. A field's JSON TYPE comes from its CONVERTER
                (PublishedKind, logic/convert.hpp) and is carried on GroupedValue — never re-inferred
                from the formatted string, which is how ONE key came to alternate between the number
                30 and the string "OFF" as a fan stopped, so Telegraf dropped the string, VM never got
                a zero, and the last running step stayed on the chart as if the fan were turning
                (#209 defect 3; the converter itself is numeric since #210 — the kind is what makes
                the property structural, and a catalog test walks every implemented converter over
                every input byte to prove no other one can do it). A Number handed a non-numeric
                string publishes null, never a quoted string: fail closed rather than flip the type.
                A conv-203 row also publishes error_active/warning_active in its own group
                (logic/fault_state.hpp) with their own binary_sensor configs — a metrics store cannot
                hold "U4" at all, so an alert on error_code != 0 never fired for exactly the faults it
                exists to catch. current_x10a_values() WITHHOLDS a held-over row (CachedValue.held —
                the outdoor unit resting, #209 defect 5) and publish_discovery() retracts rather than
                skips a row row_publishable() refuses, since a QUARANTINED row's retained config
                would otherwise keep the last false value HA was ever sent as that entity's state. Message topics sit DIRECTLY under <base> (no node
                segment — one board per base topic); the node id identifies the
                DEVICE only in each discovery config's uniq_id/dev.ids + the
                <prefix>/<component>/<node>/<group>_<object_id> discovery topic, and is the
                SLUGIFIED BASE TOPIC (logic/ha_device.hpp), NOT the
                board's MAC: the HA device is the INSTALLATION, so swapping the ESP32 keeps one
                device with its entities, history and statistics instead of creating a second one and
                restarting every statistic. The MAC-derived daikin_<mac3> lives on as (a) the MQTT
                CLIENT id — unique per connection, so two boards briefly online during a swap don't
                kick each other off — and (b) a SECOND dev.ids entry: HA matches a device by any
                identifier and merges the rest in, so an install created by a MAC-identified build is
                adopted, not duplicated. The ENTITY id inside that node is <group>_<object_id>
                (row_object_id), never the label slug alone: uniq_id and the discovery TOPIC are both
                FLAT namespaces while a label is unique only within its register page, so "Error Code"
                on the outdoor page and on the hydronic one were announced under ONE id on ONE topic —
                the broker kept one payload, HA created one entity, and a unit reporting two faults
                showed one, with no error anywhere (#221; 44 of 45 profiles, five label slugs).
                The STATE key stays un-grouped (mqtt_group.hpp nests by group and VictoriaMetrics is
                keyed on the pair), which is why the defect was invisible outside HA and why fixing it
                must not touch object_id (#217). Structural — every row, not just today's collisions:
                a rule scoped to the colliding ids would make an entity's identity depend on which
                OTHER rows the detected profile carries, so a re-detect could rename a live entity.
                The five reused labels are also NAMED by their group (AMBIGUOUS_LABEL_SLUGS, a
                hand-maintained ledger asserted against the catalog), because HA derives the default
                entity_id from the NAME and two identically-named entities land as `…_2`; the other
                ~154 names are untouched so those entities reclaim their entity_id and their recorder
                history. The retained configs an older build published under a superseded identity —
                the MAC node id, the un-grouped entity ids (each in both the `sensor` and
                `binary_sensor` shape), AND (#230 A) the OLD id of a row whose label
                logic/label_override.hpp moved — are RETRACTED in ONE pass (retract_stale_values ->
                retract_ungrouped_values + retract_relabeled_values, plus retract_legacy_fixed for
                the diagnostics) that completes BEFORE any replacement config goes out: HA drops the
                old registry entry,
                freeing its entity_id, and the new entity takes it back; history/statistics key on
                entity_id and carry over, per-entity UI customisations key on unique_id and do not.
                The legacy shapes come from ungrouped_discovery_topic, a FROZEN literal — a delete
                built from discovery_topic() would target today's topic and remove nothing. Only THIS
                board's own legacy topics can be retracted (a swapped-out board is gone —
                docs/HOME_ASSISTANT.md "Device identity" has the broker-side cleanup; its
                retained-sweep one-liner is NOT valid for the #221 migration, where the stale and new
                configs share a node segment). A BIT-FLAG row (conv 300-307, conv_is_binary) is published as the JSON
                NUMBER 1/0 (binary_state_number) and typed as an HA binary_sensor (ha_component) with an
                explicit pl_on:"1"/pl_off:"0" — HA's defaults are "ON"/"OFF" and a mismatch parks the
                entity at `unknown`. The NUMBER is the point: a metrics consumer (Telegraf →
                VictoriaMetrics) drops strings AND bools, so ~30 of a profile's ~99 values reached HA but
                never a graph (measured: 58 of ~99 became series). Since #210 the NUMBER is the
                firmware-wide boundary, /values included: a bit-flag row carries the
                value "1"/"0" plus a structural `"binary":true` marker, and the BROWSER renders ON/OFF
                from that marker (www/js/schematic.js's vOn tests the value === "1", never the text — a consumer
                still expecting "ON" reads every flag as false, silently). Both call sites
                key on conv_is_binary, never on the text, so the encoding and the entity type can't drift
                apart. Builds before the split published these as `sensor`; that stale retained config is
                DELETED per binary row on the first announce per profile (ungrouped_discovery_topic,
                the same pass that retracts the un-grouped ids) so no duplicate
                unavailable entity survives an upgrade — the entity DOMAIN changes, so HA history for
                these does not carry over. Board/link diagnostics on <base>/heartbeat (logic/heartbeat.hpp),
                published on a fixed 10s cadence (HEARTBEAT_INTERVAL_S) — a FLAT JSON (each field
                prefixed by its block name: wifi_connected, wifi_rssi, wifi_mac, wifi_bssid, mqtt_count,
                bus_rx_received, reset_reason_code, reset_fault, … — no nested wifi/mqtt/bus objects; the reset
                reason rides as BOTH the readable slug and a NUMBER, because a metrics consumer keeps
                numeric fields and drops strings, so the slug alone was invisible in VictoriaMetrics
                exactly when 55 reboots a week needed attributing (#215); the three connectivity flags are
                1/0 NUMBERS, not bools, for the same metrics-consumer reason as the bit-flag rows, and
                bus_status carries the matching pl_on/pl_off — the crash topic keeps true/false + `| lower`
                since it is an event payload, not a metrics stream) of
                heap(free/min-free/largest-block)/uptime/reset_reason/wifi(rssi+reconnects+MAC+BSSID,
                mac always present, bssid null offline)/mqtt(pub count+fails+reconnects)/X10A bus
                (rx_received/rx_fails/bus_ou_held_over) stats, 18 diagnostic HA entities streamed
                independently of profile detection. TWO are RETIRED (RETIRED_HEARTBEAT_SENSORS), under
                the rule that already retired the crash topic's "Last Reset Reason": an entity
                repeating what another entity on the same device says is not a second reading, it is a
                second thing to rule out. "Device Time" published the SNTP wall clock as a
                device_class "timestamp" sensor — re-sent every 10 s, so HA rendered it as "N seconds
                ago", which is what HA's own last_updated on any other entity here already says
                without a clock, at one recorder row every 10 s forever; the drifted/never-synced
                clock it was meant to catch is reported by /status.ntp {server,synced,time} and every
                syslog TIMESTAMP. "WiFi Quality" published 2*(rssi+100) beside the WiFi Signal sensor
                carrying that rssi — a deterministic function of another entity cannot disagree with
                it, fail independently of it, or show anything it does not. The "time" and
                "wifi_quality_pct" PAYLOAD FIELDS went with them: each fed only its entity, and a
                field whose one consumer is gone leaves the duplicate in every heartbeat while hiding
                it from the place it was visible. Both retained configs are actively DELETED per
                (re)connect under the current AND the legacy MAC node id, and their uniq_ids are
                BURNED (test_entity_identity refuses a live entity claiming one back — it would
                inherit the corpse instead of a fresh registry entry). RetiredHaSensor itself lives in
                ha_device.hpp, shared with crashinfo.hpp: both diagnostic surfaces retire under one
                rule and one failure mode. bus_ou_held_over is SOURCE freshness, a different
                fact from bus_connected: the link is up and the device is publishing while the
                outdoor unit is simply not measuring, and a consumer that only had bus health would
                read the withheld outdoor keys as a broken link. Deliberately NOT device_class
                problem/connectivity — a resting outdoor unit is the normal state of a heat pump for
                most of the day. Also RETAINS the boot-time crash summary
                on <base>/crash (logic/crashinfo.hpp) once per (re)connect — but ONLY when the boot is
                NOTABLE (a real fault or a core-dump still in flash, crash_is_notable). A normal boot
                (USB re-enumeration, config-save/OTA reboot, clean power-on) PROBES the topic with a
                bounded retained read and sends the zero-length RETAINED payload that clears it only
                when the broker actually still holds an older crash — so no
                crash message lingers once the problem is resolved, while a CLEAN broker receives no
                empty publish at all (an unconditional one made every fresh install invent a
                payload-less /crash node, the same repeating-empty-topic shape the retired
                <base>/state and <base>/modbus/status probes exist to avoid); the reset reason is not lost — the
                heartbeat carries it as its own "Reset Reason" sensor. PLUS a republish on the
                heartbeat cadence whenever the "dump waiting" flag changes (diag_crash_info_live();
                a retained true would otherwise latch ON in HA until the next reconnect once the dump
                is pulled + cleared — and an orphan-dump-only boot is then re-decided not-notable and
                the topic cleared). When a crash IS reported it drives ONE diagnostic HA entity — a
                "dump waiting" flag (reason/backtrace only, never secrets or the raw dump); the reset
                reason is NOT a crash entity (it duplicated the heartbeat's own "Reset Reason" sensor,
                so the old "Last Reset Reason" crash entity was dropped + is actively retired — its
                stale retained discovery config is deleted on upgrade, RETIRED_CRASH_SENSORS). Every publish funnels through one mqtt_publish() wrapper so mqtt_count/mqtt_fails
                cover every topic, not just state. The mqtt_pub task is Task-Watchdog-subscribed
                (esp_task_wdt_add) and resets UNCONDITIONALLY at the top of each 1s cycle (not gated on
                connect/publish, so a long broker outage can't false-trip) PLUS once per publish inside
                mqtt_publish() (so a ~30-publish reconnect burst on a slow link can't exceed the 20s
                budget) — a wedged publish reboots, a slow-but-progressing one never does.
                THREE things that are not publishing also live on this task (the third being the
                external CIRCULATION witness of #361 — its probe behind POST /test_circulation and
                its live subscription decode, which are the room source's two halves one source
                over), all because they are
                driven by INBOUND frames on this same authenticated client. (1) The REFERENCE-SOURCE
                PROBE behind POST /test_ref_temp: a candidate room mapping is subscribed on the
                EXISTING client (never a second connection, never a Config write), decoded by the
                same JSON/freshness/eligibility path the live source uses, and on a passing frame it
                issues a generation number as a PROOF. mqtt_reference_test_proof_valid() then binds
                that proof to all seven behavioural fields, so testing topic A cannot license saving
                topic B, and an edited path or max_age invalidates it. RAM-only and single-use — a
                save consumes it, a reboot forgets it — which is exactly right for evidence about a
                broker that may have changed since. (2) The HEATING-CURVE DIAGNOSIS SAMPLER
                (logic/heating_curve_diagnosis.hpp), evaluated once per 1s cycle but COUNTED only while
                armed. `/status.heating_curve.evaluations` and the `<base>/heating_curve` document's
                `diagnosis.counters.evaluations` measure
                armed cycles rather than seconds of uptime, so an unconfigured board reads 0 instead
                of a number that looks like activity. It lives here rather
                than in a file of its own because its one input arrives as an MQTT frame, it can
                only be armed WITH a configured MQTT room source, and the evaluation has to ride the
                task CYCLE rather than publish_heartbeat(): on the publish cadence the last state
                would lag exactly the broker/X10A outage that must block it. It runs BEFORE the
                publish gate for that reason. It records raw room error only; it has no P/deadband/
                quantization/clamp/slew/offset vocabulary and cannot name an actuator. The saved
                room mapping is ALSO the consent boundary for COLLECTION, and that half
                lives in this file: service_reference_subscription computes capture_enabled =
                configured — the SAVE of a topic is the consent to subscribe to it, and #357 removed
                the second gate that used to stand in front (a switch that could not be reached: it
                answered 409 until the very sources whose only editors lived on the card it revealed
                were configured). Deleting the topic swallows the pending reconfigure, UNSUBSCRIBES
                the live room topic, drops the captured runtime values and reports subscribed:false.
                A flip of that flag counts as a BINDING change and retires the captured value with
                it: a reading taken under a consent since withdrawn must not outlive it.
                service_reference_frames still runs service_reference_probe_frame() FIRST and only
                then decodes the SAVED source, which is what keeps POST /test_ref_temp able to PROVE
                a candidate BEFORE it is saved — otherwise the only way to test a mapping would be to
                save the one being tested.
                test/test_heating_curve_diagnosis_contract.mjs pins that whole boundary recursively across
                every C++ source: subscription/delete/probe, derived room-only arming, optional
                forecast and absence of every Modbus write vocabulary. The GATE ORDER is load-bearing:
                HomeHub connectivity, register 53 normal-space operation and register 38 Heating
                are established BEFORE room/X10A/clock evidence. An idle summer plant is HOLD even
                when its thermostat is off; Cooling is a separate non-heating HOLD and never enters
                the data set. Unknown evidence is BLOCKED. Every 30 minutes of eligible heating the
                exact raw room error is stored with an absolute Unix timestamp and sequence. A
                transient HOLD/BLOCK retains cadence and the last event so recovery cannot fabricate
                a new sample; deleting the room source disarms and clears sample memory. Forecast is
                optional comparison evidence (Recording vs Degraded), never a control term.
                The outside contract is `/status.heating_curve` plus the RETAINED
                `<base>/heating_curve` document (logic/heating_curve_mqtt.hpp), which is NESTED and
                carries its own `schema_version` — room{}, diagnosis{gates, room_evidence,
                last_sample, counters{}}. It left the heartbeat in #373: the heartbeat is a fixed-
                cadence board/link vital-signs stream, while this is evidence about the PLANT with a
                versioned shape and its own publish decision, and a growing block of `heating_curve_*`
                keys in the middle of the vitals made both harder to read and coupled their cadences.
                Booleans still ride as 1/0 NUMBERS (the metrics-consumer rule, unchanged); what the
                nesting buys is that the leaf keys no longer repeat the prefix.
                Consumers detect events by a sequence increase, use `last_sample_unix_s`, and
                treat a sequence/uptime reset as reboot. No HA entities: this is analysis evidence,
                not a plant command. ARMING is derived by `heating_curve_diagnosis_armed()` from the
                MQTT room mapping only; there is no mode enum, live blob byte or route
ota_update.cpp  pull-based signed OTA: manifest check -> TWO-POINT downgrade gate -> esp_https_ota
                into the inactive slot -> signature verify on install -> reboot, plus the rollback
                health gate. Reads the CHANNEL (config ota_channel, logic/ota_channel.hpp) fresh on
                every check/update, so a switch applies live: `release` = the gh-pages ROOT manifest
                (republished only by a MANUAL workflow run that tags v*), `dev` = <base>/dev/
                (republished by every firmware-relevant merge to main). A merge no longer cuts a
                release. Dev builds are stamped <next release>-dev.<n> — a semver PRE-RELEASE, so
                ordering alone gets both directions right: a dev board upgrades itself to the next
                release, a release board never drifts onto a dev build. Switching BACK (dev -> the
                last release) is an older version, refused unless the request carries ?downgrade=1
                (ota_install_allowed) — which relaxes the ORDER only: never the signature, never an
                equal version, never on the manifest's say-so, never persisted. Without it the
                release channel would be a one-way door; with it a hostile manifest host still
                cannot walk a fleet backwards. Both network ops run on ONE on-demand task (never the httpd worker —
                /set_mqtt's pre-flight is deliberately the only request-path network block) and only
                one at a time (two TLS sessions would fight over the largest contiguous block).
                s_status is mutex-guarded behind an RAII Lock, since readers copy std::strings out.
                The gate is checked against the MANIFEST version (cheap pre-check) AND against the
                image's OWN esp_app_desc_t version via esp_https_ota_get_img_desc(), then requires
                the two artifact-version strings to match exactly — the manifest and the image are
                separately-controlled artifacts, so both a signed old image and two different
                independently-newer versions are refused
status_led.cpp  onboard status-indicator task. TWO back-ends behind one host-tested pattern table
                (logic/led_pattern.hpp): a level-driven GPIO LED and an addressable WS2812 (RMT, via
                the espressif/led_strip managed component). Pin + driver + polarity are RUNTIME
                (config led_gpio/led_type/led_inverted, NVS, POST /set_board) — Kconfig
                DAIKIN_STATUS_LED_* only seeds first boot — because CI publishes ONE esp32s3 image
                and the boards disagree about their onboard parts (XIAO: plain LED GPIO21 active-low;
                M5Stack AtomS3 Lite: WS2812 GPIO35). Compiling either in would fork the artifact +
                manifest + OTA feed per board. Six operating patterns, timings unchanged: slow 1s =
                setup portal (SoftAP), fast 100ms = connecting, solid = healthy (WiFi + MQTT + X10A),
                double-flash = X10A link down, medium 300ms = X10A up but MQTT down, off = no WiFi
                mode. X10A-down outranks MQTT-down (the bus is the point of the device). Plus two
                the recovery button asserts via status_led_signal() (an atomic, so no lock is taken
                on the erase path): red 60ms strobe = factory reset ARMED, solid white = erasing.
                The override pre-empts every operating phase — a board being deliberately reset is
                usually perfectly healthy, so gating the warning on a fault would hide it exactly
                when it matters. Waits are SLICED (25ms) and re-check the signal, so the override
                shows within a slice instead of up to a full 1s pattern later. Started AFTER
                config_load (it reads the config). Exposed on /status.board (pin/driver/polarity),
                never as a value — the light itself is local-eyes-only. ANNOUNCES the resolved
                pin+driver+polarity on /diag at task start ("led: WS2812 indicator on GPIO35"), like
                recovery_button.cpp does: the failure users actually hit does NOT fail — pointed at a
                valid-but-wrong pin (the shipped XIAO default of GPIO21 on an AtomS3 Lite, whose only
                light is a WS2812 on GPIO35) init succeeds and the firmware drives a pin with nothing
                on it, so the board looks dead while being perfectly healthy and the only evidence was
                the ABSENCE of an error line — indistinguishable from a working indicator. The five
                settings that fix that are one pick in the UI (logic/board_presets.hpp). The task loop self-guards
                like mqtt_task/poll_task: wifi_info()/mqtt_status()/hp_stats() each copy std::strings
                out, so a tick can throw under memory pressure — an escape would reboot the board
                over a cosmetic LED. A dropped tick costs nothing (recomputed from scratch each time)
recovery_button.cpp  physical factory-reset button (config btn_gpio/btn_active_low, DISABLED by
                default): held BUTTON_FIRE_MS (5s) it erases the WHOLE daik_cfg NVS namespace
                (nvs_erase_all) and reboots into the setup portal. The only config reset that does
                not require reaching the device over the network — the cure for "it joined a network
                I can't reach", which wifi.cpp's credential rollback cannot cover (that handles a
                REJECTED password, not a wrong-but-accepted LAN). Press classification is the pure
                logic/button.hpp: an ARM checkpoint at 1.5s lights the warning while there is still
                time to let go, a debounced release (3 samples @20ms) means one bounced sample can
                neither cancel a hold nor silently restart its clock. Default -1 ON PURPOSE — an
                unconfigured input FLOATS, and a floating pin reading "pressed" for five seconds
                would wipe a board nobody touched. A button already held at boot is ignored until
                the pin reads released once (a stuck switch must not fire 5s into every boot). The
                erase is milliseconds, so the indicator LEADS it (250ms) and is held to 1.5s total —
                a signal that merely bracketed the write would be invisible. A FAILED erase does NOT
                reboot: coming back up on the config it just said it deleted is worse than staying up
                and logging why. Started even in safe mode (a boot-looping board is exactly when a
                physical reset is the only way in)
diag_log.cpp    in-RAM diag ring served by GET /diag; each line is also forwarded to syslog_send()
syslog.cpp      optional syslog UDP client (RFC 5424): a task DNS-resolves the configured host, then
                forwards every diag_printf() line as one UDP datagram; disabled when syslog_host is
                empty. The RFC 5424 TIMESTAMP field is the SNTP wall clock (sntp_time.cpp,
                logic/timestamp.hpp) once synced, else the "-" NILVALUE a collector conventionally
                substitutes its own receive time for — so a boot's first few lines (sent before the
                client's first sync lands) just carry a slightly-later effective timestamp, never a
                fabricated pre-epoch one. Delivery is gated on DNS ONLY — an ARP(local)/ICMP reachability probe is
                ADVISORY (feeds /status.syslog.reachable, never gates sends: syslog is best-effort UDP
                and a healthy collector may firewall ICMP). File-scope ping-control (like wifi.cpp's
                s_wd) so the async esp_ping callback can't use-after-free. syslog_status() feeds
                /status. Self-loop-guarded (drops "syslog:" lines). On the FIRST resolve of a boot it
                replays the boot records ONCE (logic/bootlog.hpp) straight down the socket — a
                build-identity line (version/elf_sha256/reset/safe_mode) + the crash records if the
                last boot was a fault. diag_crash_capture() runs before WiFi/this task exist, so
                without the replay the crash reached only the in-RAM ring (overwritten within a
                minute by a chatty failure mode) — never syslog. NOT via diag_printf: the queue is
                full of the boot backlog by then and the enqueue is non-blocking (it would drop
                exactly these lines). A send failure is CLASSIFIED (logic/syslog_policy.hpp): only a
                HARD errno (ENETUNREACH/EHOSTUNREACH/...) clears the resolve throttle; a TRANSIENT one
                (ENOMEM — what a ghosted link returns for every datagram) holds the destination and
                waits for the 10s cadence, so a chatty diag stream can't drive a getaddrinfo+ICMP
                storm. The errno is captured INSIDE syslog_sendto before close() (close may clobber
                it, and it now decides the throttle). Failures log the TRANSITION (one line paused,
                one recovered), not every dropped line.
diag_crash.cpp  one-shot boot capture of the reset reason (esp_reset_reason) + core-dump SUMMARY
                (esp_core_dump_get_summary: crashed task/PC/backtrace/app-elf-sha) into a cached
                CrashInfo (logic/crashinfo.hpp); read by /status.last_crash + the MQTT crash topic —
                the summary is NEVER re-parsed on a request path (build_status_json is a request-path
                builder; until the WebSocket push was removed it also ran on the poll task). An ORPHAN
                dump — one whose parsed app-elf-sha does not match the RUNNING build
                (logic::coredump_is_foreign, host-tested) — is erased at capture and its summary
                cleared: the coredump partition survives an OTA, and a panic that cannot write its own
                dump leaves the previous build's in place, a valid image of another binary that passes
                esp_core_dump_image_check() so `coredump` reads true and /status offers a download
                espcoredump rejects on a SHA-256 mismatch (#215). Erasing it makes `coredump` mean "a
                dump for THIS firmware is downloadable" and clears the slot for the next real panic;
                the erase is conservative — foreign is declared only on PROOF (two present shas, a
                meaningful common prefix, a mismatch), since erasing a dump that IS ours destroys the
                one artifact a panic left. A proven foreign image stays suppressed for the whole boot
                even if its best-effort flash erase fails, and GET /coredump applies the same policy;
                raw foreign residue can therefore never reappear as an undecodable download. EXCEPTION:
                the `coredump` flag is re-read from flash per request (diag_crash_info_live()
                — a 4-byte size-word read, NOT the summary parse), because /coredump?clear=1 can erase
                the image mid-session; a cached flag would strand an uncleanable crash banner + a
                download that 404s. mqtt_ha republishes the retained crash topic when the flag changes
                — or when NOTABILITY does, which is the other write to this cache:
                diag_crash_dismiss() (POST /crash/dismiss) erases the dump and then sets
                CrashInfo::dismissed, the user DELETING the report rather than hiding it in one
                browser. Erase first, mark second for current-firmware evidence (a dismissal surviving
                a failed erase would say "no crash" with a downloadable dump still in flash). The one
                exception is already-suppressed foreign residue: its failed erase cannot pin a separate
                current fault banner. The `dismissed` byte is the one field
                written after boot, a single monotonic false->true store no reader needs a lock for.
                A dump-only republish test would have left HA's retained crash record standing after
                a dismissal on a fault boot that never wrote a dump — which is most of them
rtos_guard.hpp  THE ONE unwind-safe RAII mutex guard (daik::SemGuard), aliased as `Lock` in each of
                the nine files that used to define its own. Two shapes had already diverged about
                whether a failed take is noticed, and a per-file struct is invisible to its
                neighbour. Adds a BOUNDED/zero-wait acquire for the callback contexts that must not
                block (esp-mqtt's event task), which neither old shape could express
task_config.hpp THE task PRIORITY table (TASK_PRIO_*). Relative priority is a property of the SYSTEM
                — only meaningful beside the other eleven — so it is declared once instead of as
                twelve bare literals docs/ARCHITECTURE.md's task inventory had nothing to drift
                against. STACK SIZES deliberately stay at their call sites: each is justified by that
                task's own measured deepest frame, and a shared table of them would invite exactly
                the copy-the-neighbour sizing the memory section warns about
logic/          IDF-free, host-tested pure headers (crc, convert, error_codes, registers, value_def,
                config_model,
                config_store, discovery, ha_device, detect, history, json, mqtt_base, mqtt_group, mqtt_uri, homehub_map, heartbeat, crashinfo,
                bootlog, reset_reason, boot_guard, board_pins, board_presets, modbus, syslog_policy, link_watch, heap_watchdog,
                wifi_rollback, health_gate, version_cmp, ota_manifest, ota_channel, ui_lang,
                http_body, http_surface, query_flag, redact, mcp, timestamp, uart_plan, detect_backoff,
                hexdump, led_pattern, button, captive,
                lwt_select, ou_stale, cop_scope, profile_view, feature_gate, availability,
                fault_state,
                raw_capture, conv_override, label_override, checkup,
                binary_semantics, circulation_source, env3, heating_curve_diagnosis,
                heating_curve_mqtt, hp_query_log, http_cache, modbus_snapshot, mqtt_publish_gate,
                open_meteo, reference_temperature, weather_forecast, weather_mqtt,
                history_persist).
                The list is the DIRECTORY, not a curated subset: a header missing from it reads as
                "there is no pure rule for that", which is the one thing this inventory must never
                say about a rule that exists — ten of them had accumulated unlisted.
                checkup.hpp = the 24-HOUR PLANT CHECKUP (#208) — the third question the dashboard
                asks, after "what is it doing now" (the schematic) and "what did this reading do
                today" (history.hpp): IS ANYTHING WORTH REPORTING. Counted events and window minima,
                which is why it cannot be a view over the trend rings — TrendRing::fold keeps the
                LAST reading of a 5-minute bucket, so a compressor cycle shorter than that leaves no
                trace, and the short cycling this exists to find is precisely what the raster cannot
                see. Events are therefore counted where they happen, on the 1 Hz poll path.
                A row is addressed by (reg, offset, CONVERTER), one key wider than history.hpp's
                locator, and the extra field is load-bearing rather than defensive: `3way valve`,
                `2way valve`, `BSH`, `BUH Step1`, `BUH Step2` and `Water pump operation` all live in
                ONE dimensionless byte (0x60/12) and differ only in which bit their converter masks,
                so a (reg, offset, unit) locator would resolve "backup-heater minutes" onto the
                3-way valve's position — the #35-#39 shape with a day's statistics in front of it.
                The catalog test asserts uniqueness AND identity (the resolved row's LABEL) per
                locator across every shipped profile. Two inputs are matched by CONVERTER ALONE
                (conv 203, and the 310/311 retry counters): a profile carries a fault class on the
                outdoor page AND the hydronic one, and a locator would pick one unit and miss the
                other's fault. The compressor witness is ou_is_rps_witness(), called not restated.
                FIVE verdicts, and the two that are not judgements are the design: Unavailable (this
                profile cannot supply the inputs — feature_gate.hpp's DISABLE-NEVER-DEGRADE, and it
                really bites, since only 27 of 44 profiles carry the compressor witness) and
                Collecting (the inputs exist, the 24 h window does not hold enough of them yet).
                Collecting outranks Ok in the aggregation and Unavailable does not, which is the
                whole honesty property: a board that has been up ten minutes has not established
                that the plant is fine, while a check the model cannot run says nothing either way.
                TWO of #208's six checks are deliberately NOT built, each because the bus cannot
                support the claim: an absolute minimum-flow threshold (per
                model over a 3-18 kW catalog, and the unit raises 7H itself, so the flow minimum is
                REPORTED with no verdict attached); and a flat daily start count (24 starts is one an
                hour in January and a control problem in April — the MEAN RUN LENGTH is what knows
                the load, so cycling warns only on >=12 starts AND a mean under 10 min).
                The THIRD was refused on the same grounds and then BUILT (#361), which is worth
                reading as a pattern rather than a reversal. DHW-tank leakage was rejected because
                the measured rate does not separate the two causes — a healthy plant loses 0.30 K/h
                without DHW circulation and 1.20 K/h with it, so a verdict on the rate alone fires
                daily on a normal install. What changed is not the threshold but the EVIDENCE: an
                independent external witness (POST /set_circulation — a power meter on the
                circulation pump) says which of the two a given hour was, so `dhw_loss` correlates
                high-loss windows against a KNOWN pump state and reports circulation_known_s beside
                them. The objection was never "this is unmeasurable", it was "this reading cannot
                carry that claim alone" — so the way past it is a second source, not a looser rule.
                It still refuses what it cannot see: a window whose pump state is unknown buys no
                observed seconds, so the check answers `collecting` rather than attributing a loss.
                availability.hpp = the ADJUDICATED per-row answer to "is this decoded number a
                MEASUREMENT, or merely something the firmware could decode?" (#209). Every other gate
                answers something narrower: convert() handles the wire format's own 0x8000 no-data
                marker, reading_plausible() catches a number that is IMPOSSIBLE, ValueDef::no_publish
                carries what the GENERATOR knew. What is left is a field that decodes to an entirely
                ordinary number which measures nothing, and only per-row evidence can name it. FOUR
                ROW verdicts exist; THREE are currently in force. ZeroMeansAbsent withholds only an exact
                zero from an adjudicated row, and FOUR rows carry it: Target Cond. Temp. 0x10/8 (raw
                0x0000 through a full compressor cycle, which is also why ou_stale.hpp already calls it
                a useless witness) plus #224's page-0x21 Fan1/Fan2 Fin temp. and Compressor outlet
                temperature. Those three are MEASURED, not argued: 0x21 stops being refreshed at rest
                (ou_stale), so every stored sample is a RUNNING sample — 1140 over 7 days, in each of
                which INV fin temp. at 0x21/4 (same page, same converter) read 16.5-55.5 °C, the
                discharge pipe 28.5-101 °C and ambient never fell below 17.5 °C, while all three read
                exactly 0.0. THE LABEL IS PART OF THE KEY for them, and it is load-bearing rather than
                defensive: the catalog puts Brine inlet/outlet temp. and Refrig. temp. evap. In/Out at
                those SAME (reg, offset, conv) coordinates on the geothermal profiles, and brine and
                evaporating refrigerant sit AT 0 °C in normal operation — a coordinate-only rule would
                delete those units' most load-bearing reading exactly where it matters. That is NOT the
                label MATCHING lwt_select.hpp warns against (a pattern hunting for a quantity); it is an
                exact discriminator among the spellings the catalog demonstrably carries, the same key
                label_override.hpp uses, pinned in BOTH directions by the catalog test (19/19/21
                adjudicated rows, 10 shared geothermal rows that reach the ledger and are told nothing).
                A FIFTH verdict, ZeroAbsentAboveSaturation, is the CONDITIONAL zero — the answer to
                the three page-0x20 rows #224 lists (outdoor coil, suction pipe, liquid line), where
                a FLAT ZeroMeansAbsent is unusable because 0 °C is where those sensors LIVE for much
                of a heating season, so an unconditional rule would withhold a real reading far more
                often than it removes a false one. The way past that is not a better threshold but a
                SECOND SOURCE: a quantity measured at the same instant that makes the zero
                impossible rather than merely unlikely. It withholds an exact zero only while a
                CROSS-PAGE saturation witness refutes it, and FAILS OPEN in every other case.
                WHICH SIDE OF THE CIRCUIT a row sits on decides whether the witness can speak for
                it, and this is the whole adjudication. The only witness the catalog carries is
                (0x62, 15, conv 405), the refrigerant pressure sensor's saturation temperature on
                the HYDRONIC page — measured, it is the HIGH side: over 1419 running samples it
                tracks LEAVING WATER across a 55 K span (3.2-64.1 °C vs LWT 9.5-64.8 °C, paired mean
                difference -0.9 K) while outdoor air stayed inside a 7 K band. So only the LIQUID
                LINE (0x20/10, downstream of the condenser, therefore high side) is adjudicated:
                liquid temperature = condensing temperature - subcooling, and an exact 0.00 against
                a condensing 49 °C claims ~49 K of subcooling. The outdoor coil (0x20/2, the
                EVAPORATOR in heating) and the suction pipe (0x20/6) are LOW side and stay
                PUBLISHED — a high-side witness cannot refute them, since a coil at 0 °C while the
                refrigerant condenses at 49 °C is an ordinary January afternoon, and keying them to
                it would withhold a real reading in exactly the season it matters. A future
                low-side witness would settle those two; this one says nothing about them. The bound
                is LIQUID_LINE_SAT_CEILING = 30 °C, impossible rather than tight (real subcooling is
                3-10 K; measured, the reference unit is above it in 1231 of 1352 running samples),
                and it carries the MODE safety property for free: in COOLING the same sensor becomes
                the LOW side, which never reaches 30 °C, so the rule switches itself off rather than
                anyone having to detect the mode. The ON-PAGE witness that would have needed no
                cross-page state at all (0x20/12, 0x20/14, conv 405) is unusable — those transducers
                read exactly 0.0 bar in 56433/56433 samples over 120 days and conv 405 drops
                bar <= 0, so neither (T) row has ever published one sample. Two gates keep the
                witness honest: the capture is GATED on the profile DECLARING the row
                (profile_has_saturation_witness — on a model without it those bytes are whatever
                that model puts there, and a witness read off them would be INVENTED, which is the
                one direction that must be impossible since a witness can only take a reading away),
                and it EXPIRES every cycle. Reach is deliberately narrow and pinned: 39 rows carry
                the rule but only EIGHT profiles carry the witness, so on the other 31 it is armed
                and permanently silent. The LABEL is part of the key — Leaving brine temp.(R6T) sits
                at the identical coordinate on four geothermal profiles and really does read 0 °C.
                A FOURTH verdict is not
                about a row at all: PAGE_ABSENCE_RULES is keyed on the register PAGE and reaches every
                row on it, because "the hardware behind this reply is not fitted" is a fact about the
                page. Both entries are the ABSENT SECOND OUTDOOR UNIT of #224 — 0xA1 answers with 16
                zero bytes including its unit-family flags at byte 9 (AllBytesZero), while 0xA0 is NOT
                all-zero and is the reason the key had to move off the row: its reply reads
                00 00 80 0c 00 00 00 00 00 00 ff ff 00 00 00 00, and both non-zero fields are
                themselves absence markers (the O/U MPU id at 10-11 reads 0xFFFF, i.e. no MPU answers;
                the operation words at 12-13 have never had a bit set), so UnidentifiedUnit requires
                BOTH and anything ambiguous publishes. Behind that signature three rows published
                exactly 0.0 °C for 316771 consecutive samples over 60 days and 0xA0/2 published
                89.6-192.0 °C in exact multiples of 12.8 °C — its raw low byte never leaves 0x00/0x80,
                which is not a thermistor read at 0.1 °C, and 192 is INSIDE reading_plausible()'s
                ±200 °C envelope. The signature is re-evaluated against the LIVE reply every cycle,
                which is what makes a page rule safe across all 45 profiles where a static per-model
                claim would not be: a fitted second unit answers with something that does not match
                and every row publishes untouched — including 0xA0/8, which KEEPS its own conv-151
                pulse ceiling. That composition is the point: a row already carrying a value rule
                cannot carry a second one, and a row a future generator run adds to either page would
                otherwise be covered by nothing. AboveRangeIsAbsent is
                the EXPANSION VALVE pulse rows (conv 151, all five coordinates): 30 d of published
                samples run 0-474 pulses and then carry six samples of exactly 0xFFF8, with NOTHING
                in between — a discrete out-of-band integer, not a distribution's tail. The obvious
                diagnosis, "conv 151 should be signed", is refuted rather than merely unproven: a
                valve nudged past its zero would report a SPREAD of small negatives reached from
                positions near 0, while every occurrence is the identical integer sitting between
                neighbouring samples of ~450, and no valve travels 450 -> -8 -> 450 in 30 s. Since
                65528 and -8 are both impossible positions, WITHHOLDING is the answer both readings
                agree on, and the u16 decode REGISTERS.md §3.1 documents stays untouched. It is a
                value test that cannot live in reading_plausible(), whose envelopes are keyed on
                dataType and so cannot reach a dataType -1 row at all; the only other handle is the
                "(pls)" in the label, which is the one thing this project does not key on. The
                ceiling (2000) is deliberately ~4x the widest observed opening — an impossibility
                filter, never a threshold fitted to make a number look nicer. All five coordinates
                carry it from a capture on ONE, because conv 151 has exactly one use in the whole
                catalog (113 rows, every one an EEV pulse position), so the bound is a fact about the
                ACTUATOR; the catalog test pins that set in BOTH directions. Unproven — withhold the
                ROW from every publish surface and retract its retained HA config — is implemented
                and has NO live entry: it held Target Evap. Temp. (0x10/6) while the scale was
                unknown, and #194 then showed that row was not unmeasurable but mis-decoded, so the
                verdict moved to logic/conv_override.hpp. A quarantine and a mis-decode are
                different findings; recording them as one makes the fix look like a suppression
                quietly lifted. Keyed on (page, offset, converter) — the
                row's STRUCTURAL identity — plus, where that coordinate is demonstrably NOT one
                quantity, the exact generated label as a fourth component (the three 0x21 zero rows
                above, and nothing else; the lwt_select lesson forbids a label PATTERN hunting for a
                quantity, not an exact discriminator between spellings the catalog carries). Never a
                profile id, since both rows sit at byte-identical coordinates in
                every generated table and a per-id list would claim a per-model fact nobody
                established. The catalog test is the load-bearing half: it proves each rule selects
                the adjudicated quantity across all 45 profiles — INCLUDING altherma_lt_d7_e_bml,
                which spells the re-decoded register "Target Discharge Temp." while the other 43 and
                REGISTERS.md §5 call it "Target Evap. Temp." (same page, offset, conv, width and
                type: one family's source catalog simply names it differently, and a discharge target
                of 145-200 C is no more real than an evaporating one) — that no 0x60-0x62 hydronic
                row is ever touched, and that page 0x10 is still QUERIED after the quarantine. In
                logic/ and not in def/ because the generated tables are machine output while these
                verdicts are OURS: a generator re-run must not lose one. Adding a rule is an
                ADJUDICATION with the same evidentiary bar as tools/domain/audit_exceptions.txt.
                row_publishable() composes it with no_publish so hp_poll (what to decode) and
                mqtt_ha (what to ANNOUNCE) cannot see different row sets; value_available() is
                applied by hp_format beside reading_plausible, for the same reason — convert() keeps
                its intrinsic per-converter semantics so the domain audit still sees them
                conv_override.hpp = which CONVERTER a generated row is actually encoded with, when
                the id the generator emitted is the wrong one. Sibling of availability.hpp and
                separate on purpose: that one asks "is this a measurement?" and answers by
                WITHHOLDING, this one asks "is it being decoded right?" and answers by asserting a
                DIFFERENT value — a stronger claim, so the bar is higher. A rule needs STRUCTURAL
                evidence (a property of the wire integers), never a range that merely looks nicer;
                fitting a scale to make a number plausible is how #35-#39 shipped. ONE entry:
                Target Evap. Temp. (0x10/6) conv 114 -> 109. #194 called x0.1's 145.9-199.6 C mid-run
                impossible, ruled out offset/endianness/width/drift, and stalled on two surviving
                scales (x0.01, /128) awaiting run-time wire bytes. Those bytes were already in hand:
                conv 114 publishes raw x 0.1 at ONE decimal, so raw = published x 10 EXACTLY — the
                "already rounded to one decimal" assumption is what kept the issue open. All 54
                distinct integers ever observed (46 run-time from the stored series, 8 at rest from
                the boot-time page dumps) satisfy raw == floor(128 x T) on an exact 0.1 K grid;
                {floor(12.8k)} has density 1/12.8, so p ~ 1.6e-60 against any other scale. x0.01 has
                no such grid, and the ambient cross-check that favoured it compared against the X10A
                outdoor reading — which ou_stale.hpp says is HELD OVER at rest. Reads 10.4-15.6 C
                running / 17.2-19.0 C at rest. conv 109 already existed (/256*2 = /128), so nothing
                in the decode path is invented: this is the #35-#39 shape, a wrong converter ID on a
                right register, NOT a wrong converter — 114 keeps its x0.1 semantics and its three
                other rows. Those three (0x10/8, 0xA1/5, 0xA1/7) are deliberately NOT touched: they
                read raw 0 on the only unit measured and 0 decodes to 0.0 under both scales, so there
                is no evidence either way and "probably the same bug" is the guess this project
                refuses. Keyed on (reg, offset, conv) like availability.hpp, applied where a row
                ENTERS the pipeline (hp_poll decode + cache, mqtt_ha discovery) so published_kind,
                conv_is_binary and display_decimals cannot disagree about one row. The catalog test
                pins that exactly 44 profiles still carry (0x10, 6, 114) — the day the generator
                emits 109 the override becomes a no-op (it is keyed from:114) and that count trips,
                forcing a re-read instead of leaving silent dead code
                label_override.hpp = which LABEL a generated row is published under, when the id the
                generator emitted is the wrong one. The sibling of conv_override.hpp, separate for the
                same reason conv is separate from availability: that one re-DECODES a value, this one
                corrects the row's IDENTITY WORD — the label is the HA entity id AND the
                VictoriaMetrics series suffix (ha_slug), so it is a published CLAIM, and changing it is
                a MIGRATION (mqtt_ha's retract_relabeled_values deletes the stale HA entity on
                upgrade; a VM series cannot be carried across a rename by any firmware action). ONE
                entry: page 0x30/1 conv 211 "Fan 1 (10 rpm)" -> "Fan 1 (step)" (#230 A) — conv 211 is
                a step index (REGISTERS.md §3.3, 0=stopped) and 22 profiles already spell it "(step)"
                while four spell a rate, so actuators_fan_1_10_rpm invited a reader to take a 30 for
                300 rpm (the #35-#39 shape in a label). The oracle is the spec, never a nicer-looking
                word. Composed by adjudicated() beside the converter verdict, so every consumer sees
                the corrected label (hp_poll decode + cache, mqtt_ha discovery, AND the domain audit's
                LABEL-UNIT, whose subject is the PUBLISHED label — conv stays raw there). Keyed on
                (reg, offset, conv, from-label) so it fixes exactly the four wrong rows and is a no-op
                on the 22 right ones; the catalog test pins that exactly 4 profiles still carry the raw
                "Fan 1 (10 rpm)", so the day the generator emits "Fan 1 (step)" the override is dead
                code, that count trips, and it is deleted (entry + pin + retract_relabeled_values)
                fault_state.hpp = the NUMERIC fault flags that ride beside the TEXTUAL Daikin code
                (#209 defect 4). Convs 203/204 stay text — "Normal"/"U4"/"7H" is what a human and HA
                want, and inventing a numeric enum over Daikin's alphanumeric code space would be a
                guess with no authority — but the grouped state topic is ALSO consumed as metrics
                JSON, where "00" may land as a numeric 0 while "U4" is simply DROPPED: the series
                sits at its last no-error value and an alert on error_code != 0 never fires for the
                faults it exists to catch. So every conv-203 row also publishes error_active /
                warning_active in its own group, always 1/0, each with its own binary_sensor config
                (object id <group>_<key>, since HA entity ids share one flat namespace while the JSON
                keys are already group-scoped). Derived through the INVERSE of conv 203's own
                ERR_TYPE lookup rather than a second opinion about what the labels mean. Warning and
                Caution fold into one flag on purpose (the textual class is right beside them); an
                UNKNOWN class publishes NEITHER, because reporting 0/0 would assert "no fault" on a
                byte nobody could decode — the one direction a fault flag must never fail in
                raw_capture.hpp = WHEN the poll path may put raw page bytes on /diag — the missing
                half of hexdump.hpp, which names its own limitation and is why #194 stayed open: the
                detect-pass dump fires at boot or on POST /detect, which is always a unit AT REST, the
                state in which Target Evap. Temp. is NOT wrong (240.6 C there, already caught by the
                envelope). Edge-triggered on stopped->running, then one per RAW_CAPTURE_PERIOD_S
                (5 min) during the run, at most RAW_CAPTURE_MAX (8) per BOOT and never refilled: a
                SERIES rather than a point, because two candidate scales that both fit one sample may
                not fit a curve, and budgeted because one line per second would evict the rest of the
                boot's evidence from the 6 KB diag ring within a minute — exactly how the crash
                records used to be lost. Pure because it is a three-input state machine whose failure
                modes (a silently exhausted budget, a dump repeating every cycle) are invisible on a
                board until the log is already ruined
                error_codes.hpp = the optional code -> short-English-description lookup layered on
                conv 204's raw fault code (hp_convert.cpp), e.g. "U4: Indoor/outdoor unit
                communication problem". Presentation only: it never changes what conv 204 DECODES,
                so the domain audit still sees the converter's intrinsic semantics, and an unknown
                code falls through to the bare code rather than inventing a description
                (docs/REGISTERS.md §"error codes", docs/HOME_ASSISTANT.md).
                circulation_source.hpp = the read-only MQTT power witness for the potable-water
                circulation pump: exact-topic/path validation, the ON/OFF hysteresis and the
                pulse-train confirmation tracker. Its absence is a first-class state — the checkup's
                DHW-loss attribution treats the witness as OPTIONAL evidence and never fabricates a
                verdict without it.
                redact.hpp = what a diagnostic snapshot must NOT carry when it leaves the device,
                for GET /status?redact=1 + GET /diag?redact=1 (the web UI's "Report a bug" action,
                docs/REPORTING.md). In the DEVICE rather than in www/js/app_state.js because the browser
                button, the curl fallback in the guide and anything later all need one answer, and
                the copy that silently stops covering a newly-added field is the one that leaks it.
                Two shapes, because the routes leak differently: /status leaks by FIELD (named values
                substituted where each is WRITTEN — a post-processing pass over the finished
                JSON is what the httpd stack budget has no room for), /diag leaks by LINE, which is
                the non-trivial half the CHECKs are about. The field COUNT is now DERIVED from those
                call sites by tools/redact/check_diag_coverage.py rather than restated: the header
                said ten, the audit tool said eight and the builder wrapped twelve, and nothing
                compared them because nothing consumed the constant — an inert number reading like a
                guarantee, the shape this file rejects a `.clang-tidy` for. What that count still
                cannot see is a new identifying field nobody wrapped AT ALL: it never reaches the
                redactor, so it never reaches the number either, and that half stays a review point.
                It FAILS CLOSED: a rule whose end token is
                missing (a line the ring truncated mid-value — exactly when a value sits
                unterminated at the end) redacts to the end of the line rather than giving up,
                while the trailing newline is preserved so the ring's line structure survives. The
                VALUE is replaced and the KEY kept, since a dropped field forges an "older build"
                signal that bug-triage reads as evidence
                captive.hpp = the captive-portal reply policy for the ONE catch-all route ("/*"):
                in SETUP mode an unmatched GET is a 302 to CAPTIVE_PORTAL_URI, in STA mode it is the
                dashboard's SPA shell. The portal only auto-pops if the joining OS's connectivity
                probe (captive.apple.com/hotspot-detect.html, /generate_204, /connecttest.txt) gets
                the answer that OS keys on, and a 302+Location is the only one all three agents
                understand; serving the PAGE with 200 (what this did through v1.0.7) is a heuristic
                Android may leave undecided, and dragged http_send_gzip's Content-Encoding onto a
                path walked by minimal HTTP clients, not browsers — a redirect's body is empty, so
                gzip leaves the probe path while the real browser that follows it still gets the
                compressed page. Also the ONE place the portal address is written (CAPTIVE_PORTAL_IP
                /_URI), so the DNS answer, the RFC 8910 DHCP option and the Location header cannot
                drift apart. Pure because the STA carve-out is the regression nobody would notice:
                a portal that stops popping gets reported, a dashboard deep link that starts
                redirecting does not
                led_pattern.hpp = the status indicator's state -> pattern rule + the button
                override's PRIORITY, shared by both back-ends (GPIO LED / WS2812) so they cannot
                drift apart, and so "which signal wins" is asserted rather than buried in a blink
                loop. Shape, not colour, carries the state — a monochrome LED sees no colour, so
                every phase is distinguishable by timing alone (the tests pin that exactly two
                phases are solid, and why that pair is safe).
                button.hpp = the recovery button's press classifier (arm / fire / abort +
                debounce). The interesting half is the ABORT path: the action it gates erases the
                user's whole configuration, so "held 4.9s then let go" must destroy nothing, and a
                single bounced sample must not read as a release. Pure, so that is tested rather
                than discovered by holding a button on a desk.
                lwt_select.hpp = the leaving-water MEASUREMENT picker (host-testable twin of
                www/js/schematic.js's lwtRow/vLwt): the row that feeds the UI's ΔT / heat-output / COP must be the
                pre-BUH heat-exchanger outlet (R1T) and NEVER a setpoint / mixed-zone / post-BUH (R2T)
                row — a setpoint substituted for a measurement makes all three plausibly wrong (#121,
                the #35-#39 failure shape). Keyed on the (R1T) tag so the alias label forms ("Outlet
                Water Heat Exch", "Tv inflow", "after PHE") resolve too, not just "leaving water before
                BUH". Not a firmware caller — it exists so the CI logic-test gates the browser rule
                against the whole def/ catalog (every detectable profile selects a real measurement).
                EVERY browser consumer resolves through the one lwtRow() — the schematic pill, the
                derived figures AND the inspector's leaving-water rows. A looser second copy of the
                pattern is the failure mode to watch for: it re-opens exactly the substitution this
                header exists to prevent (it matched the bizone kit's MIXED leaving-water row), and
                being a copy, the CI gate on this rule no longer covers it. THAT GAP IS NOW CLOSED
                mechanically — scripts/check-presenter-parity.sh diffs the browser's copies of this
                rule, cop_scope's two and ou_stale's page set against these headers over every
                distinct (label, register) pair the catalog produces. The rule to keep is that both
                copies stay ADDRESSABLE: the gate calls named functions (lwtIsPreBuh,
                lwtIsMeasurement, isPostBuhRow, copPlan, OU_HELD_PAGES), and a rule folded back into
                its caller exits 2 as unreachable rather than passing by comparing nothing — which
                is also why copPlan takes the two heater TRI-STATES and collapses them itself, since
                a step performed in the caller is a step no comparison can reach.
                history.hpp = the 24-hour trends: WHICH rows get one, WHEN a stored sample is a
                measurement rather than a repeat of one, the ring mechanics, and WHICH SAMPLE a
                PINNED readout still refers to (history_pin_index — a tap in the web UI pins the
                crosshair so the value stays readable without holding a finger down). That pin is
                anchored to the sample's wall-clock INSTANT, never its index: the ring shifts a slot
                every HISTORY_DT_S, so an index anchor would keep the bubble on slot 42 while slot 42
                became a different measurement — the #35-#39 substitution shape with a timestamp in
                front of it making it look verified. Out of the window it returns -1 and the caller
                DROPS the pin rather than clamping to the nearest edge, which would keep a readout on
                screen while silently changing which moment it describes. Adding a trend is
                ONE row in TRENDS — the ring, the route and the browser are already generic over it
                (the id is the CONCEPT, the label is the profile's spelling). A trend ADDRESSES its
                row by (register page, byte OFFSET, unit) and never by its label, because the catalog
                neither names one quantity consistently nor names different quantities differently:
                "(R1T)" is BOTH the outdoor unit's air inlet on 0x20 and the indoor leaving-water
                sensor lwt_select.hpp keys on by that very tag; leaving water comes in four spellings
                (one with a DOUBLE space); the suction pressure is called just "Pressure" on 13
                profiles, a name page 0xA0 reuses for another quantity; and 0x20/12 carries a bar
                reading AND its saturation-°C twin in the same byte window, which is why the unit is
                half the locator. Any of those resolved wrongly is the #35-#39 shape drawn as a
                24-hour chart. Measured over the 39 detection profiles the locator resolves to
                EXACTLY ONE row on every one, and the catalog test asserts that (plus coverage, one
                type code and one width per trend) rather than assuming it. Two rules are now
                CONSEQUENCES of addressing a row this way rather than conditions on it, asserted over
                the catalog instead of re-checked per sample: a trend cannot reach a SETPOINT (a
                target sits at its own offset), and the held-over page class IS the locator's reg, so
                no second page field can drift from it. TWENTY-SEVEN of the thirty-one are catalog rows
                (nineteen numeric plus eight converter-qualified component-state rows), and WHICH rows is a rule
                rather than a taste: every supported numeric value the SCHEMATIC draws gets a curve, because
                those are the readings someone is actually looking at — pre-/post-BUH leaving water,
                return water, DHW tank, water pressure, flow, pump signal, refrigerant pressure
                (0x62/15, the one that
                stays LIVE — the 0x20 transducers read 0.0 bar even at 42 rps on the measured unit,
                and 30 days of the reference install's published series show a flat 0.0 from BOTH,
                so a ring on them would be a permanently empty chart, which is why the drawing's
                LOW-pressure pill is the one numeric pill with no trend), compressor rps, expansion
                valve, outdoor air, outdoor-coil, discharge and liquid-refrigerant temperatures,
                room temp — plus the ELECTRICAL inputs
                (inv_current, ct_l1..3), which are inputs first and rows second: the drawing's
                computed pills (pump speed, ΔT, heat output, electrical input, COP) have no register
                matching the displayed figure to buffer,
                so www/js/history.js's DERIVED assembles their curve from these rings with the same
                expressions liveData() uses for the live number — one definition per figure instead
                of a firmware copy and a browser copy free to drift. The other FOUR are not rows at
                all — a TrendKind tag splits "addressed by (reg, off, unit)" from "sampled from the board", and the
                combined Smart-Grid mode, the confirmed external circulation witness, plus the board
                pair (free_heap/max_alloc, KiB) carry their
                own fixed labels because no profile
                has one to give; trend_row_matches refuses them against a row even when the row is
                crafted to look like their (0,0) locator. The BOARD pair has its own producer,
                history_record_board(), which the poll task calls at the top of EVERY cycle before it
                decides whether to detect or to sweep — never history_record(), which is reached only
                through poll_once() and therefore only once a profile is RESOLVED. Folded there they
                vanished on a board whose X10A never answers (the profile stays "auto" forever), so
                the two heap curves that answer "is the heap drifting" were absent from
                /status.history.rows on exactly the board being debugged: an unrelated feature dying
                because a different subsystem was unreachable. One owner, no branch that can skip it.
                The CIRCULATION ring is gated the other way: with no source configured its label is
                CLEARED, so /status stops offering the trend entirely rather than offering one the
                device can never fill (the modbus_rows/env3_rows rule, applied to the third source —
                an absent feature is stated by absence, never by an empty chart). Two absences are
                distinguished (NO_READING vs HELD_OVER) and history_store COMPOSES
                ou_reading_held_over rather than restating it, so a change to which pages freeze
                reaches the trends automatically. That is the load-bearing half for outdoor air:
                page 0x20 keeps ANSWERING with the last run's numbers while the compressor rests, so
                an ungated ring fills a mild day with a staircase that reads exactly like weather.
                The RING is here rather than in history.cpp because bucket folding, wrap-around and
                skipped-bucket filling are exactly the off-by-one that surfaces as a subtly wrong
                chart weeks later — a rule in a .cpp can only be verified on the device. Skipped
                buckets are FILLED, never compressed: compressing them slides every earlier sample
                forward in time and mislabels the whole curve. HISTORY_BYTES_PER_TREND carries a
                static_assert so a future trend addition meets the memory budget where it is stated
                history_persist.hpp = WHEN a persisted ring may be believed, and where its samples
                belong on the axis once it is. The sibling of history.hpp and a different shape of
                question: recording judges one reading, a restore adopts ~28 KB of prior state in one
                act, and every field in it is a claim about a moment that has already passed. Get it
                wrong and the chart is not empty but CONFIDENTLY WRONG, which is strictly worse than
                the blank axis this firmware shipped with. Four rules, all pure so they are asserted
                rather than discovered on a board: (1) which reset reasons leave DRAM intact, as an
                ALLOW list with everything unrecognised refused — POWERON is the obvious no, while
                BROWNOUT and PWR_GLITCH are the interesting ones (the supply dipped, so the contents
                are not proven, and they are refused rather than left to the CRC); (2) the CATALOG
                FINGERPRINT over every trend id/kind/locator and the ring geometry, derived rather
                than a hand-maintained version byte precisely so nobody can forget to bump it; (3)
                the ABSOLUTE wall-clock bucket grid, which is the same on every device and every
                boot, so two snapshots taken years apart still line up sample-for-sample; (4) the
                SPLICE, which places an older snapshot BEHIND what this boot recorded, at the bucket
                each sample was actually taken in — a snapshot that is merely appended slides a
                day-old curve onto today. Two refusals are the interesting part of the splice: one
                claiming to be NEWER than the live ring is refused outright rather than clamped (the
                anchors disagree about the present, and every position for it would be a guess), and
                THE LIVE SAMPLE ALWAYS WINS in an overlap, including when it is an absence — this
                boot observed that bucket itself, and a retained payload from a previous life of the
                same five minutes must not overwrite the observation. The coarse form is PURE
                DECIMATION, never a fold of each group down to "the last reading in it": that would
                look like more data and would be a lie about WHEN, drawing a reading from 25 minutes
                earlier at the group's own instant. The verdict is a named enum rather than a bool
                because each outcome is a different thing to say on /diag and a different thing to do
                about it — "wrong_catalog" after an OTA is expected and uninteresting, "bad_crc" on a
                board that was never power-cycled is a memory fault worth knowing about.
                ou_stale.hpp = which readings stop being CURRENT while the compressor is off. The
                outdoor unit refreshes its OWN pages (0x20 sensors, 0x21 inverter) only while it
                RUNS; stopped, it answers with the LAST RUN's values. Measured on a live unit:
                outdoor air read exactly 19.0 °C for five hours, stepped 19.0→23→24→25.5 at the
                instant the compressor started, then sat at 25.5 for two hours, while the HYDRONIC
                pages moved continuously the whole time (leaving water 53.4→49.2 °C over one hour) —
                so it is the unit going quiet, not the poll engine stalling. reading_plausible()
                cannot see this and neither can the domain audit: 19.0 °C IS a plausible outdoor
                temperature, the #35-#39 shape with no numeric tell. Only the PAGE plus the
                compressor state can tell, so DESIGN.md's dead-bus rule ("an idle plant with no
                readings, not a stale one") is applied to one sleeping UNIT instead of one silent
                BUS: www/js/schematic.js's `d.ouHeldOver` refuses the outdoor unit's retained rows.
                Discharge therefore blanks to "—"; outdoor air also blanks without a second source,
                but a live HomeHub outdoor-air measurement may stand in because that independent
                sensor keeps measuring. `mbFields` records the substitution, renderLive paints the
                pill petrol, and the inspector resolves headline + source to the Modbus row rather
                than putting the stale X10A number back. v1.0.13 showed held X10A values greyed with a
                `#heldNote` legend instead; that remains reverted — a value the unit is no longer
                measuring is never reported. The only visible number is a current measurement from
                the other stack, not a dimmer register of half-valid values.
                The inspector BLANKS what the pill blanks, or it undoes the pill: it read every row
                straight off /values, so tapping a blanked pill printed the held-over number back as
                a 19px headline (25.0 °C outdoor on a stopped unit), plus in the member-reading list
                and in any sentence quoting it — a value the drawing had just refused to state,
                restated one line below it and looking like the correction. Its gate is the ROW's
                register page (/values now carries `reg`), never its label: the catalog spells these
                rows ~50 ways across 43 profiles, so a pattern list in JS would be a second copy of
                ou_page_holds_over() that silently stops covering rows. A held headline replaces the
                entry's `now` sentence with the REASON it is blank, and a pill drawn from a FALLBACK
                source (the high side falls back from the frozen HP transducer to the live
                refrigerant sensor) resolves headline + source line through the same picked ROW —
                naming High Pressure while showing the other sensor's bar is its own small lie.
                ΔT blanks too — with no flow it is not a stale working point but none at all
                (`d.dtStale`, decided in liveData beside `d.ouHeldOver` so the drawing and the
                explainer cannot disagree about it either).
                Deliberately NOT
                page 0x10 — it carries Defrost Operation, which FEEDS the run-state decision, and no
                measurement could prove whether it freezes (its Target Cond. Temp. reads 0.0 even
                mid-run, a useless witness); blanking a reading costs information, suppressing a
                state input would corrupt the state machine. UNKNOWN rps (no such row in the
                profile) reads as CURRENT, never held-over — absence of evidence. Like lwt_select
                there is no firmware caller: it exists so the CI logic-test gates the browser rule
                against the whole catalog, and the load-bearing half is the SECOND assertion — every
                profile keeps "INV frequency (rps)" on a LIVE page (0x30 in all 27 that have it), which
                is what makes "Standby — not running" trustworthy while the pills around it are not.
                The rule reaches the DERIVED figures too, not just the raw pills, and the electrical
                estimate is where it bites hardest: d.pel prefers the CT clamps (page 0x63, LIVE — a
                non-zero reading at rest is real standby draw) and falls back to "INV primary
                current", which is a 0x21 row and freezes with that page. Every catalog profile has
                the INV row, only about half have CT clamps, and an idle plant reads ct == 0 — so the
                ungated fallback drew LAST RUN's amps as a live kW figure on most installs, most of
                the time, beside the "not running" headline it contradicted. The fallback is now
                gated on ouHeldOver (the test pins which page each of the two sources sits on). It
                BLANKS like every other held reading, and it is the one where blanking is not merely
                the house style but the only defensible answer: a stopped compressor is not drawing
                1.4 kW, it is drawing ~0, so the held figure is not a stale value of the quantity but
                a wrong one. The CT path is unaffected: those clamps are on a live page, so a non-zero
                reading at rest is genuine standby draw and is still shown. The held pill carries no
                caption — no pill does any more (DESIGN.md §5.3 item 3: the drawing states readings,
                the INSPECTOR states everything about them) — but the DISTINCTION still has to be
                drawn where it is stated: the pel explainer answers "held over from the last run"
                and "this profile has no current row" with two different sentences, since suppressing
                one wrong claim must not substitute another (the profile HAS a current row; it is
                the reading that is not current)
                cop_scope.hpp = WHICH COP the dashboard's quotient describes, and when it is none.
                The COP pill divides a heat figure by an electrical one, and the two picks need not
                describe the same SYSTEM — a quotient of two correct numbers across two boundaries is
                not a worse COP, it is a different quantity under the same name. The CT clamps (0x63)
                see the WHOLE unit including the backup heater; "INV primary current" (0x21) sees the
                compressor alone; the heat side is lwt_select's PRE-BUH outlet, i.e. heat-pump heat
                with the resistive heater deliberately uncredited. So INV pairs correctly (the heater
                is outside BOTH sides and cannot unbalance them — a HEAT-PUMP COP, valid with the
                heater firing), while CT does NOT: the heater's kilowatts land in the divisor while
                its heat never reaches the dividend, and the quotient COLLAPSES exactly when the
                heater runs — a number that reads as a failing heat pump while nothing is wrong. The
                fix is to move the NUMERATOR, not the denominator: a whole-unit divisor takes the
                POST-BUH (R2T) outlet, which is what docs/HOME_ASSISTANT.md's heat-meter recipe
                already does for an external meter. d.pth itself is untouched — its own pill states
                the heat pump's output and must keep saying so. Where no honest pairing exists (CT +
                heater firing + no R2T row) the answer is feature_gate.hpp's rule: publish NOTHING.
                There are TWO resistive heaters and they are NOT the same problem — hence two block
                codes. The BUH sits in the space-heating flow BETWEEN R1T and R2T, so its heat does
                cross the water circuit and moving the numerator downstream re-pairs the boundaries.
                The BSH is the immersion heater INSIDE the DHW tank: it heats tank water directly,
                downstream of the flow sensor and of BOTH leaving-water sensors, so its kilowatts
                enter a whole-unit divisor while its heat crosses neither R1T nor R2T and NO row in
                the profile would re-pair them. Unfixable, not merely unfixed — so CT + BSH is a
                block whatever the R2T row says, and the UI names it as the different fact it is
                (the profile is not lacking a reading; the bus has none that would). It bites exactly
                where the rule is aimed: all 21 CT-clamp profiles carry a BSH row, the heater can run
                with compressor, pump and flow at zero, and the test asserts that CT implies BSH so
                the block can never depend on an input a profile cannot supply.
                UNKNOWN heater state is NOT off — off is the PERMISSIVE branch here, so guessing it
                is precisely what would ship the collapsed quotient (the mirror of ou_stale's
                "unknown rps is not stopped"); measured, this costs nothing, since 43 of the 44
                profile tables carry BUH Step1/2, all 44 carry a post-BUH row, and the BUH rows sit
                on page 0x60, which stays LIVE while the outdoor unit sleeps — the one input that
                could have been stale is not. The post-BUH picker takes the row's PAGE, not its label
                alone, because the catalog REUSES the tag: "(R2T)" names the leaving-water outlet on
                0x61/4 AND "Discharge pipe temp.(R2T)" on 0x20/4 — same offset, same converter 105,
                14 profiles. The water-token test happens to separate those two today, but that is
                how one row was spelled, not a property of the data (the accident history.hpp refuses
                to rely on for "(R1T)"); the page carries the guarantee the tokens cannot — a row on
                a page the outdoor unit stops refreshing is a HELD-OVER reading whatever it is
                called, and a held-over temperature must never reach a heat figure presented as
                current. Like lwt_select and ou_stale there is no firmware caller: it exists so the
                CI logic-test gates the rule against the whole catalog (exactly one post-BUH row per
                profile, always on a live page, never the same row lwt_select picked). The UI half is
                a LIVE inspector title — "COP of the plant" vs "COP of the heat pump", since the two
                are different numbers and look identical on the pill — plus a distinct sentence per
                block reason, the same "suppressing one wrong claim must not substitute another" rule
                the pel explainer already follows
                profile_view.hpp = the active model's rows AS EVERY CONSUMER MUST SEE THEM: the
                generated table plus the def/overlay.hpp supplement, as ONE indexable sequence (two
                spans, no allocation — the poll path reads it every second). One view rather than four
                merges because the four consumers are NOT independent: hp_poll decodes the rows,
                mqtt_ha announces one HA discovery config per row, and BOTH http_status (/values)
                and mqtt_ha (the grouped state topic) size their snapshot buffer from the
                row COUNT, which is the exact upper bound on cached values. Grow the cache without
                growing the count and the extra values are silently TRUNCATED out of /values and MQTT —
                an absent-value bug with no error anywhere, the #35-#39 shape. Carries the OVERLAY
                RULE: a supplement block applies ONLY IF the base profile already references the
                block's page. That one condition is what makes a hand-written supplement safe next to
                generated tables — it can never set a page bit that was not already set, so (a)
                detection cannot move (a profile's signature IS its page set, and detect_candidates
                picks maximal overlap) and (b) no bus round-trip is added, which on a model that does
                not answer the page would be one TIMEOUT per cycle, reading on /diag exactly like a
                wiring fault. Belt AND braces: signatures.hpp builds its mask over def::profiles (the
                BASE tables) and never sees a view at all — the test asserts the braces, since the belt
                is what a refactor would remove
                feature_gate.hpp = which derived features may HONESTLY run on the detected model, and
                the answer when they cannot: DISABLE, NEVER DEGRADE (#69 step 0.2 / #110 Part C). The
                same rule the UI already applies three times — lwt_select blanks ΔT/heat/COP rather
                than substituting a setpoint (#121), ou_stale blanks a held-over pill rather than
                showing a dimmer register of half-valid numbers, cop_scope blanks the quotient rather
                than pairing two boundaries that do not match — so a "reduced feature set" is that
                already-rejected second vocabulary under a new name; and a rule (or model) fit on a
                feature vector does not degrade gracefully when columns vanish, it just gets confident
                about a distribution it never saw, which is the "pretend full features" outcome #69
                rules out by name. Coverage is read off the ROWS, never off `profile == "generic"`:
                generic IS the extreme case (measured — no leaving-water MEASUREMENT, only the
                "LW setpoint (main)" that lwt_select correctly rejects; no INV frequency, no expansion
                valve, no pressure row) but NOT the only one — SIXTEEN of the 43 DETECTABLE profiles
                also lack page 0x30 and with it the compressor run-state input, so an id check would
                have let inference run without run-state on more than a third of the detected catalog.
                Takes the VIEW, not the base table: the retry counters live in the supplement, so
                coverage read off the generated rows alone would answer correctly for the wrong reason
                today and wrongly the moment the generator emits them. No firmware caller yet (#69
                Phase 3 has not landed) — pure so the policy is ASSERTED rather than re-litigated at
                the future call site, like lwt_select and ou_stale
                value_def.hpp = the ValueDef row type the generated def/ profile tables are written
                in ({reg, offset, conv, size, type, label} — registry id, byte offset in the reply
                payload, converter id for convert.hpp, byte count, HA unit code, English label): the
                shared vocabulary between the offline generator's output and the decode path. Plus an
                optional 7th field `no_publish` (defaults false, so every existing generated row is
                unchanged) = a DETECT-ONLY row: the page exists on this model and must keep counting
                toward the detection signature, but the value is an absent-feature placeholder that
                hp_poll never caches and publish_discovery never announces. Kept-not-deleted ON
                PURPOSE: a profile's signature IS the set of pages its rows reference
                (def/signatures.hpp) and detect_candidates picks MAXIMAL page overlap, so deleting the
                row makes the correct profile lose a page to a feature-richer WRONG profile that kept
                it — the model mis-detects and the same garbage returns through that table. Used for
                the 0x64 hybrid/boiler page on the non-hybrid 4-8 kW monobloc/hydrobox profiles
                (test_no_publish pins both halves)
                ha_device.hpp = the ONE Home Assistant DEVICE identity all three discovery surfaces
                share (discovery.hpp values, heartbeat.hpp diagnostics, crashinfo.hpp crash): the
                slug rules (ha_slug, which object_id now delegates to), device_node_id(base) =
                the node id derived from the MQTT BASE TOPIC — an INSTALLATION id, so a board swap
                keeps the device — and device_json(node, board_id) = the dev block, stable id first
                and this board's MAC id second (dropped when empty or equal; a duplicated identifier
                is malformed for HA). A dev block that drifted between the three builders would split
                the board across two HA devices again, so the test asserts all three carry the same one.
                Also RetiredHaSensor, the {component, object_id} of an entity this firmware ONCE
                published: shared by crashinfo.hpp and heartbeat.hpp because both retire under one
                rule and one failure mode — a retained discovery config nobody deletes is replayed to
                HA forever, so the entity lingers as a permanently-unavailable duplicate
                json.hpp = the ONE RFC 8259 string encoder every JSON payload goes through (/status,
                /values, /scan via http_status.cpp's jstr; the MQTT state/heartbeat/crash topics).
                Escapes " and \ AND every control byte < 0x20 (\b\f\n\r\t, else \u00XX) — the strings
                are NOT all ours: an SSID is arbitrary bytes from any AP in range, and escaping only
                the first two let "Free<LF>WiFi" put a raw newline in a JSON string, so the WHOLE
                response failed JSON.parse — first seen as the setup portal's network dropdown
                collapsing to a free-text box, and still reachable via /status.wifi.ssid (the
                associated AP names itself) + /scan now that the portal takes a TYPED SSID and parses
                nothing. BENEATH the DOM-node escaping of a RENDERED SSID
                (#52, fixed in #65): orthogonal, neither subsumes the other — #65 stops hostile SSID
                MARKUP, this makes the bytes PARSE at all (a decoded SSID of `"><script>` is valid
                JSON, and #65's DOM nodes still never see it if the parse fails first).
                Bytes >= 0x20 pass through
                verbatim (raw UTF-8, 0x7F) — the cast to unsigned char is load-bearing, since `char`
                is signed and a naive c < 0x20 would mangle every non-ASCII SSID.
                ws_policy.hpp and ws_tx_gate.hpp are DELETED, and the deletion is the entry: they
                were the /events WebSocket's frame policy and its one-in-flight broadcast
                backpressure, and the push they served is GONE (docs/ARCHITECTURE.md "Push vs. poll").
                Neither defect was unlucky, both were structural — httpd_queue_work() is ONE UDP
                datagram to a control socket whose mailbox holds 6 (LWIP_UDP_RECVMBOX_SIZE) and an
                overflow drops it SILENTLY while answering ESP_OK, so the gate's release never ran and
                the stream was dead until reboot with NOTHING logged (#238); and the broadcaster put
                the ~3.5 KB /status builder on the task that owns the X10A UART, which overflowed its
                stack (#241). The browser polls /status + /values instead, which 4376 concurrent
                requests never troubled. Do not reintroduce a push transport without answering both:
                a push fails silently and globally, a request fails loudly and locally under a 503
                the handle_all guard already returns.
                http_body.hpp = the request-body recv loop
                (http_body_read), templated over a classified recv so segment-by-segment
                reassembly, a mid-body close and a stalled peer are host-tested; the IDF return-code
                mapping stays in http_common.cpp. A timeout is retried at most BODY_MAX_IDLE times —
                unbounded retries would park the single httpd task on one silent client.
                mqtt_base.hpp = WHICH BASE TOPIC this installation publishes under — the runtime half
                of what was a compile-time-only fact. Every message topic sits directly under it and
                device_node_id(base) slugifies it into the HA discovery node id, so it IS the
                installation identity. Kconfig's help had always stated the consequence ("two boards
                on one broker need two base topics") while the value was compile-time ONLY and CI
                publishes exactly ONE esp32s3 image — so the requirement was unsatisfiable for anyone
                running the published build, and every board flashed from a feed shared one base BY
                CONSTRUCTION. What that costs is not noise but IDENTITY: both boards write the same
                retained topics (each holds whoever published last), a metrics consumer sees ONE
                series per field because the labels are identical (two interleaved uptime counters
                read as a sawtooth — measured, that inflated resets(uptime[7d]) from ~50 real reboots
                to 16272 and doubled the daily sample count, #215), and HA merges them into one device
                whose entities flip between two units. None of it announces itself; every individual
                value stays plausible. Same rule board_presets.hpp applies to the LED and the button:
                a PER-INSTALLATION fact cannot live in Kconfig when CI ships one binary. EMPTY means
                the compile-time default, which is what makes the upgrade a no-op with no migration —
                absent and default are the same state here, unlike the board block, where the caller
                must seed Kconfig. Refusals carry a machine code per RULE (the ENV III pattern, so the
                bilingual UI translates without the API losing its one wording), and the load-bearing
                rule is the last one: a base that slugifies to NOTHING is refused, because
                device_node_id() would fall back to the constant "daikin" and put two boards back on
                one HA device — the exact collision the setting exists to end, re-created by a value
                that passed every other check. The browser keeps NO second copy of any of it (the
                lwt_select lesson); it sends the string and renders the device's coded refusal
                mqtt_uri.hpp = the broker-URI split (host/port/TLS) behind the /set_mqtt pre-flight.
                Its scheme defaults track esp-mqtt's OWN (mqtt 1883, mqtts 8883, ws 80, wss 443) —
                the probe must dial the port the client will: 1883/8883 for ws(s) probed a port
                nothing listens on. A port outside 1-65535 is rejected at PARSE time, since the
                probe's htons() truncates (:65537 -> :1) and would call a wrong port reachable; the
                port must be ALL digits (stoi alone skips whitespace, takes a sign and stops at the
                first non-digit -> "1883x" read as 1883, which esp-mqtt's own parser would reject).
                A URL path is trimmed BEFORE the port split: `/mqtt` is the de-facto standard path
                for MQTT-over-WebSocket, so wss://host:8084/mqtt is the NORMAL shape of a ws(s)
                broker — untrimmed it lands in the port field (or, portless, in the host, where it
                surfaced as a misleading "DNS lookup failed"). Only host/port are taken here; the
                caller hands esp-mqtt the full URI, path included.
                ota_channel.hpp = which published FEED this device follows, and the URLs for it.
                Two feeds exist because a merge to main no longer cuts a release: `release` (the
                gh-pages root, cut by a manual workflow run) and `dev` (<base>/dev/, every
                firmware-relevant merge). The dev URL is DERIVED from the configured firmware base,
                never a second Kconfig string — a separately-configurable dev URL is a second thing
                that can silently point elsewhere, and the dev feed is a subdirectory of the release
                feed by construction (scripts/build-pages.sh --dev writes it, publish-pages-branch.sh
                --dev owns exactly that subtree). Pure so the join rules are asserted: a base with or
                without its trailing slash yields the same URL, and an EMPTY base yields "" (the
                caller says "no update URL configured") rather than a relative path that would be
                fetched against nothing and reported as an unreachable server
                ui_lang.hpp = which language the web UI renders in, when the browser default is
                OVERRIDDEN. The UI is bilingual (de/en) and picks its language client-side from
                navigator.language by default (main/www/js/i18n.js, DESIGN.md §1); this is the persistent
                MANUAL override on top of that — enum {Auto,De,En}, one writer (POST /set_lang), in
                the config blob (v4) beside ota_channel for the same one-owner reason. Auto is a
                first-class value, NOT the absence of one: a fresh or pre-v4 device reports "auto" and
                the browser keeps auto-detecting; only De/En states a language, which then wins over
                every client's guess. Pure so the enum<->string/int maps are asserted host-side, and
                decoded DEFENSIVELY (an unknown stored byte reads as Auto — a garbled byte must fall
                back to the browser default, never force a language the user never chose). Same
                five-function shape as ota_channel.hpp (name/valid/parse/to_int/from_int), minus the
                OTA-specific URL joins
                bootlog.hpp = the records syslog.cpp replays once per boot: build_boot_line (version/
                elf_sha256/reset/safe_mode — the only way to tell WHICH firmware produced a log
                stream) + build_crash_log_lines (the crash as single-line, datagram-sized records;
                returns 0 for a non-notable boot, so the "don't spam the collector" rule is
                host-tested). Deliberately NOT crashinfo's multi-line build_crash_text(), which at
                worst case (~340 B) truncates past diag's 256-byte line buffer and loses elf_sha256.
                syslog_policy.hpp classifies a send errno HARD (route/destination implicated ->
                re-resolve now) vs TRANSIENT (ENOMEM/ENOBUFS: hold the destination, keep the 10s
                throttle) — treating every failure as hard turned each failed diag line into a
                getaddrinfo + 3x1s ICMP probe, a storm on a ghosted link. link_watch.hpp = the
                connectivity-watchdog policy: a gateway probe is three-valued (Reachable /
                Unreachable / Unmeasurable), so "couldn't measure" stops masquerading as healthy;
                proven silence re-associates after 2 periods, sustained blindness after 10.
                wifi_rollback.hpp = the credential-rollback policy: classifies a disconnect reason by
                what it says about the CREDENTIALS (Auth = the AP refused them -> evidence; ApAbsent/
                None/Other = a router still rebooting or a slow DHCP -> no evidence) and gates the
                boot-window decision on it. A rollback is destructive (the new creds are gone), so
                absence of evidence buys the 180 s grace and only the AP's own "no" is fast.
                reset_reason.hpp maps a reset code to the /status.sys.reset_reason slug (reusing
                crashinfo's crash_reason_slug — one vocabulary). boot_guard.hpp = the safe-mode decision
                logic (crash-only counting, saturating increment, threshold) driving safe_mode.cpp.
                detect.hpp narrows the
                Altherma-only model profiles from a bus fingerprint (page mask + capacity, O/U or the
                I/U-code fallback) to a candidate set + a best-fit representative (detect_best; ranks by
                maximal page overlap -> kW class containing the capacity -> tightest class -> the
                LOWEST PROFILE ID). That last criterion was "first in signature order" until #230 B,
                i.e. the order the tables happen to sit in def/registry.hpp — an incidental fact about
                a FILE deciding which identifiers a device publishes, since a label is the HA entity id
                and the VictoriaMetrics series suffix. Measured: permuting the registry moved the
                published identity on 11275 of 200x336 trials over 64 distinct identifiers; the id is
                intrinsic to the profile, so the same tie now resolves the same way in any order, and
                test_tie_break_order_independence() asserts that by permuting the registry. Adopting it
                moved NOTHING (0 of 336 fingerprints re-label, the live unit included), so it needed no
                #221 migration — and it is deliberately not a better GUESS: preferring the majority
                spelling would assert a model the bus cannot evidence, fewest-identifiers moves 13 ids
                on 8 fingerprints for no gain, and exact-page-mask changes nothing at all (an inert
                rule reading like a guarantee). A tie is ALSO not the "register-identical, so it cannot
                matter" this file used to claim: the tie is on the page COUNT and the class SPAN, both
                coarser than the row tables, so 98 of 152 measured ties are between profiles whose
                (reg, offset, conv, size, type) multisets differ — by up to 8 rows — and on 108 the
                pick decides a published identifier. The set is
                register-equivalent only when the capacity is KNOWN; when it is absent the I/U-capacity
                fallback that ranks the representative also affects values, so detect_candidates NARROWS
                by it too (#225) — through the same detect_capacity/signature_kw_contains helpers, since
                a set constrained by one rule and a pick ranked by another is how /status came to report
                8 candidates across 4 families while the ranking was already down to the 4-8 kW class
                (and how #213 recorded one unit as two). Two asymmetries carry the correctness: a
                candidate is dropped only when its class CONTRADICTS the capacity, never for stating no
                class (that would let RANKING decide MEMBERSHIP — written the other way round it
                silently dropped class-less altherma_gshp2 from a set it belongs in, which an existing
                CHECK caught), and the fallback is applied only when some surviving class CORROBORATES
                it (an I/U code fitting no class would otherwise exclude every classed candidate at
                once — unfiltered is the safe failure, since a broad set reads as uncertain and a set
                narrowed onto the wrong models does not). Narrowing is not RESOLVING: `ambiguous` stays
                true and the UI still refuses to name one model.
                It also carries detect_commit_no_match, the rule for the OTHER outcome: a sweep that
                answered on the bus and matched NOTHING is not committed as `generic` until a second,
                separate sweep agrees (DETECT_NO_MATCH_CONFIRMATIONS=2). An unknown unit and a
                fingerprint with a lost page bit are indistinguishable in one sweep and cost wildly
                different amounts, so the cheap answer waits for corroboration; a transient cannot
                survive two independent passes, and the model is RAM-only either way so waiting
                persists nothing. A COUNT rather than a timer, because the sweep cadence itself backs
                off (detect_backoff.hpp) — "two passes" stays two pieces of evidence at any cadence;
                mqtt_group.hpp maps a register page to a friendly group name, builds the grouped
                state JSON, and encodes a BINARY reading for the wire (binary_state_number: "ON"->1,
                "OFF"->0, anything else -> nullptr so the caller publishes the text rather than
                inventing a 0); discovery.hpp's ha_component types the same rows as binary_sensor,
                row_object_id builds the group-scoped ENTITY id (distinct from the un-grouped STATE
                key object_id — #221) and ungrouped_discovery_topic yields a frozen pre-#221 topic to
                delete;
                heartbeat.hpp builds the board/link diagnostics JSON (FLAT — each field
                prefixed by its block name, e.g. wifi_rssi/wifi_mac/bus_rx_received, not nested) + its
                diagnostic HA discovery configs; crashinfo.hpp turns a captured CrashInfo (reset reason + core-dump
                summary) into the last_crash JSON / MQTT crash payload + a paste-friendly text bundle,
                classifies which reset reasons are faults, and carries coredump_is_foreign() — the rule
                diag_crash.cpp uses to spot a dump left behind by another build (its app-elf-sha does
                not match the running one) and erase it, so `coredump` never advertises a download
                espcoredump rejects on a version mismatch (#215; declared foreign only on PROOF, since
                the erase is destructive); board_pins.hpp = the ESP32-S3 CHIP-safe
                X10A GPIOs (the RX/TX pin-picker dropdown when detection hasn't locked the pins) —
                minus flash/strapping/USB-JTAG/JTAG always, minus GPIO33-37 when the build runs Octal
                flash/PSRAM, and minus the pins the firmware itself drives (ReservedPins: the status
                indicator AND the recovery button): chip-safe is not free, and offering a pin
                status_led.cpp holds as a push-pull output — or that button.cpp holds as a pulled
                input — is a pick that cannot work. A SECOND, wider set,
                board_pin_local_io()/board_pins_local(), is what the indicator + button themselves may
                use: it adds back exactly the dedicated-JTAG pads 39-42, which the X10A list withholds
                as a PREFERENCE (keep a debug probe usable) rather than a hardware conflict — a
                preference that cannot survive an onboard part soldered there, e.g. the AtomS3 Lite's
                button on GPIO41. The reservation runs in BOTH directions and the two accessors say
                which is which: board_pins_offerable takes config_reserved_pins (indicator + button,
                withheld from the X10A picker), board_pins_local takes config_link_pins (the live
                rx/tx, withheld from the LED/button pickers). ReservedPins itself is deliberately
                anonymous about the pair (pin_a/pin_b) — naming the fields after one direction made
                the other read as a lie. Leaving pins_local unfiltered was the one place the rule ran
                one-way: the picker listed GPIO44/43, board_hw_valid then refused them, and the user
                learned of the conflict from a 400. `octal_spi` still comes from Kconfig at the call
                site (config.cpp hw_octal_spi()); both `reserved` inputs come from the live CONFIG,
                since all four pins are runtime. board_pins_offerable() fills a CALLER-owned buffer — a
                filtered static would race, as build_status_json runs on httpd AND the poll task's WS
                broadcaster. It says nothing about which pins a given BOARD breaks out to a header
                (no board-ID EEPROM exists); README.md carries that per-board table for humans;
                board_presets.hpp = the SAME per-board facts made applicable: the five board-local
                settings (led_gpio/led_type/led_inverted/btn_gpio/btn_active_low) for each documented
                board, served as /status.board.presets and filled into the Hardware modal by one
                pick. In firmware, not in www/js/settings.js, so a preset can be host-tested against the very
                validator POST /set_board applies (board_hw_valid) and cannot drift from
                docs/BOARDS.md into pins the device would reject; board_presets_offerable() withholds
                a preset this BUILD reserves (the AtomS3 Lite's GPIO35 LED is SPIIO4 on an Octal
                build) AND one this CONFIG reserves (a link moved onto that preset's LED or button
                pin), because a pick that cannot work is not a pick — the same rule, on the same two
                axes, that the two pin dropdowns now apply. Says nothing about which board
                this IS (unknowable); picking one is the USER stating the hardware;
                modbus.hpp = Modbus TCP framing (MBAP, no CRC) + HomeHub register codecs
                (Temp16/Pow16/Int16/Text16 decode+encode) + the homehub-* mDNS filter — the
                host-tested core of the firmware-exclusive HomeHub Modbus link (issue #32);
                hp_modbus.cpp is the socket around it and def/homehub.hpp the register map. It builds
                READS ONLY — there is no FC06/FC16 request builder, so this firmware cannot frame a
                Modbus write (the encode half of the codecs stays because decode/encode are one
                round-trip-tested pair).
                homehub_map.hpp = WHICH X10A ROW A HOMEHUB REGISTER IS THE SAME QUANTITY AS — the
                ENTIRETY of the sharing between the two otherwise-independent stacks, and the reason
                the web UI can print a Modbus reading beside its X10A twin and let it stand in when
                the X10A bus is silent or that particular X10A row is held over at rest. The pairing
                may NEVER be made on the LABEL: the catalog spells
                one quantity many ways across the 43 profiles (four spellings of leaving water, one
                with a DOUBLE space) and REUSES tags across different quantities ("(R1T)" is both the
                outdoor air sensor on 0x20 and the indoor leaving-water sensor), so a label match is
                both incomplete and wrong — the lwt_select/ou_stale mistake. It is worst in the
                FALLBACK case, where the Modbus value stands alone under the X10A row's name with
                nothing beside it to look implausible against. The vocabulary is logic/history.hpp's
                TREND IDS, reused rather than reinvented: a trend is already "one physical quantity
                addressed structurally by (reg, offset, unit)", and its catalog test already proves
                each locator resolves to exactly one row per profile. A static_assert pins every
                pairing to a real trend id, so a renamed trend is a BUILD ERROR rather than a pairing
                that silently stops happening. ELEVEN registers pair — eight measurements plus three
                component STATES (bsh_state, valve_dhw, quiet_state), each an exact same-point pair.
                The post-BUH outlet (offset 41) is among them and is the worked example of what the
                rule actually forbids: it was unpaired while X10A had no post-BUH trend of its own,
                because the only available partner was the PRE-BUH row and pairing those two would
                have been the substitution lwt_select refuses — a different measurement point under
                one name. It pairs now that X10A carries `leaving_water_post_buh`, i.e. once there is
                a partner describing the SAME point. The rule was never "few pairings", it is
                "same quantity, same point, or nothing".
                The rest stay unpaired, each with a stated
                reason: the real power measurement has no X10A equivalent at
                all (X10A ESTIMATES it from CT clamps at an assumed 230 V, so pairing a measurement
                with an estimate would hide which is which); setpoints, other modes and faults are not
                readings and no trend addresses them. Offset 56 (Smart-Grid) is the one deliberate
                exception in the other direction: it carries a state TIMELINE with no X10A concept
                to pair against
                timestamp.hpp = rfc3339_utc(unix_s, ms) — the ONE UTC formatter the SNTP wall clock
                (sntp_time.cpp) renders through, for syslog.cpp's RFC 5424 TIMESTAMP field,
                /status.ntp.time, and mqtt_ha.cpp's heartbeat "time" field. A negative unix_s
                (sntp_time.cpp's "never synced" sentinel) returns
                "" rather than a plausible-looking 1970-01-01 — callers key on the empty string to
                fall back to the RFC 5424 NILVALUE / JSON null instead of asserting a wrong instant.
                hexdump.hpp = hex_render() for the RAW X10A page payloads hp_detect.cpp puts on
                /diag (pages 0x00, 0x10, 0x20, 0xA0, 0xA1, one line each, only on a detect pass —
                0x10/0x20 carry readings measured IMPOSSIBLE on a live unit yet inside
                reading_plausible()'s ±200 °C window, so nothing masks them: Target Evap. Temp.
                (0x10/6) hit 199.6 °C, and the outdoor pressures (0x20/12+14) read 0.0 bar with the
                compressor at 42 rps). The Target Evap. case is DIAGNOSED in #194: a scale mismatch,
                not an offset — the row tracks the compressor cycle (240.6 °C at rest, dipping to
                145.9 °C running). #194 is now RESOLVED — the scale is /128 and the row is decoded
                with conv 109 (logic/conv_override.hpp); it was settled from the wire integers the
                published series already carried losslessly, not from this dump. The dump's own
                LIMITATION is why it could not settle it: it fires only on a detect pass, which never
                coincides with a compressor run, so the bytes behind the wrong value were never
                captured at the instant it was wrong (raw_capture.hpp closes that half). HTTP exposes
                only DECODED values, so a physically impossible reading cannot be attributed to a
                wrong converter vs. a wrong byte offset vs. a per-unit layout difference without the
                wire bytes — and they otherwise never leave the device. Truncation is by WHOLE bytes:
                a trailing nibble would read as a different value, and a hex dump exists to be read
                literally. A 32-byte payload renders to 95 chars, well inside diag's 256-byte line.
def/homehub.hpp the HomeHub (EKRHH) Modbus register map — the counterpart of the X10A profiles below,
                for Transport::ModbusTcp. Rows are {1-based EKRHH offset, FC04 input / FC03 holding,
                MbType, extra scale, unit, label}, decoded through logic/modbus.hpp's codecs with the
                32765/66/67 sentinels refused before any scaling. HOLDING registers are read BACK
                read-only (the hub splits its telemetry across both spaces); nothing writes. The host
                test covers the DECODE MECHANICS (scaling, sentinels, Text16, offset->PDU, a negative
                temperature keeping its sign) — physical correctness per row is an on-hardware check,
                the same "passing the tests is not being RIGHT" rule the domain audit exists for
def/            embedded per-model value profiles + registry (incl. the generic Altherma fallback =
                universal register core) + models_catalog.hpp (GET /models) + model_names.hpp
                (id→display/family/marketing name for /status) + signatures.hpp (Altherma-only
                detection signatures derived from the tables). Profiles are machine-generated in the
                ValueDef row format by the offline value-catalog *profile generator* (gen_profiles.py),
                which is maintained OUTSIDE this repo — do not confuse it with the in-repo
                `tools/domain/` audit tooling, which is a different toolset entirely. Never
                hand-edit a generated table: regenerate it, and verify rows against docs/REGISTERS.md
                (the in-repo source of truth, and the check any contributor can actually run).
                ONE hand-written supplement exists and is TEMPORARY: overlay.hpp, the page-0x10
                protection words (offsets 10-12, convs 303/307/310/311 — UC5's retry counters, #110
                Part B). Every generated profile carries SIX rows for page 0x10 where REGISTERS.md §5
                documents TWENTY-SIX, uniformly across all 43 tables — the generator's page-0x10 input
                is narrow, it is not a per-model absence — so conv 310 (implemented in PR #111) had no
                row to decode and decoded nothing in the field. The supplement adds the rows WITHOUT
                touching a generated table; logic/profile_view.hpp presents generated+supplement as one
                row sequence and carries the OVERLAY RULE (a block applies only if the base already
                references its page), which is why this cannot do what hand-editing would: it can
                never set a page bit that was not already set, so detection cannot move and no bus
                round-trip is added. The rows ARE audited — tools/domain/catalog_audit.cpp resolves the
                view, so they are cross-checked against REGISTERS.md §5 per profile like any generated
                row, and the page-0x10 catalog guard in test_logic.cpp (armed vacuous in #111) is live
                on them. DELETE overlay.hpp + its plumbing when gen_profiles.py emits the rows: a
                supplement that outlives its generator run is a second source of truth for the catalog.
                WHEN YOU DO, the 11 labels must come back BYTE-IDENTICAL. VictoriaMetrics has
                ingested these rows since 2026-07-26 as daikin_altherma_<group>_<object_id>, so the
                label-derived slugs are identifiers the store is keyed on, not presentation. A rename
                forks the series silently — the old one stops receiving samples and the new one
                starts at zero, and a retry counter resetting to zero is the exact event these rows
                exist to report, so it reads as the plant going quiet rather than as a rename (#180).
                test_logic.cpp pins all 11 plus the 0x10 group key against the live store, so this is
                a test failure rather than something the deleter has to remember. Since #217 the
                OTHER ~150 are pinned too: test_metric_identity() freezes the whole set of distinct
                <group>_<object_id> identifiers the published catalog produces (163 of them, resolved
                through adjudicated() so a label override moves the frozen id with the series), so any
                rename, dropped row or change to ha_slug() fails the suite and prints which
                identifier moved. That gate was built because the hazard is not hypothetical —
                f1a5e69 (#139) renamed "Expansion valve 3 (pls)" to "… [OU-II]" across 19 profiles
                and the store shows the old series simply stopping. Regenerating the frozen list is
                the DECISION, not the fix: an addition is routine, a removal or a change strands a
                history and belongs in the commit message with its reason. Since #221 the same block
                also TIES the two surfaces: every published row's HA entity id must be in that frozen
                list, so a label edit moves the entity and the series together or neither — and it
                pins AMBIGUOUS_LABEL_SLUGS as exactly the set of labels the catalog reuses across
                pages, so a sixth cannot appear unnoticed. The uniq_id INJECTIVITY itself is
                test_entity_identity(), which reads the id out of the real discovery config (never
                re-deriving it) across all four entity families — catalog rows, fault companions,
                heartbeat, crash — since HA's unique_id namespace is flat across them too.
                What NEITHER of those can see is the question a device OWNER has (#230 B): does THIS
                unit still publish the identifiers it published yesterday? Detection picks ONE
                representative, so where the ranking TIES the pick decides the LABELS — hence the
                entity ids and the series. #217's gate cannot fail on that BY CONSTRUCTION: both
                spellings are already in its frozen set, so a flip adds no identifier. THREE tests
                bound this, and none subsumes another (measured, not assumed):
                test_tie_break_identity() asks the CATALOG question — which identifiers do
                REGISTER-EQUIVALENT profiles (byte-identical (reg, offset, conv, size, type) rows)
                disagree about? Over the detectable catalog TWELVE equivalence classes exist and —
                since #230 A's fan step was closed by logic/label_override.hpp — FIVE still disagree,
                so it freezes exactly 34 identifiers (the fan class is now identifier-equivalent, so
                neither fan id is among them). They are not all defects — three classes are one sensor
                named by two product FAMILIES ("[HPSU] Tv inflow Temp  (R1T)" vs "Leaving water temp.
                before BUH (R1T)"), which REGISTERS.md:196-200 says to expect — and the sharpest is not
                a rename at all: the non-hybrid altherma_erga_d_ehv_ehb_ehvz_da_series_04_08kw marks
                the page-0x64 boiler rows `no_publish` while its two register-equivalent neighbours
                publish them, so a tie-break decides whether EIGHT hybrid_* entities exist on that
                unit. That is why `no_publish` is deliberately NOT in the equivalence key: it is not a
                wire fact, and folding it in would split that class and hide the strongest case.
                test_tie_break_reach() asks the OPERATIONAL one — which identifiers can the tie-break
                decide on a fingerprint a real unit can present (every catalog page mask x capacity x
                both capacity sources, 336)? That is 64, and the two sets are genuinely different: the
                tie is on the page COUNT and the class SPAN, both coarser than register-equivalence, so
                32 reachable ids are outside the equivalence set — while 2
                (outdoor_sensors_low_pressure{,_t}) diverge between equivalent profiles yet are
                unreachable, a tighter kW class always winning on criterion (3) first.
                test_tie_break_order_independence() asserts the PROPERTY that removes the trigger the
                issue named: permuting the registry cannot change the pick, now that criterion (4) is
                the lowest profile id rather than file order (see detect.hpp above).
www/            web UI sources (index.html + style.css + app.sources fragments -> one gzipped page)
                + setup.html. WRITE THE COMMENTS: the sources are documentation and the artefact
                carries none of them — tools/web_asset/minify_and_gzip.py strips HTML, CSS and JS
                comments alike under the 153600-byte delivery budget (main/CMakeLists.txt's
                UI_GZIP_MAX_BYTES, pinned by test/test_ui_delivery_contract.mjs). Markup was the
                one language it did NOT cover until the budget was measured per fragment: index.html
                is spliced in RAW, so 39 KB of drawing/layout commentary shipped in the image at 14 KB
                gzipped — 9.5% of the budget — with every gate green, because a page that is 14 KB
                too big renders exactly as well as one that is not. The budget is a BUILD-BREAKING
                limit, so the cost arrives as an unrelated feature's CI failure, months later. Only
                comments are stripped from markup; HTML indentation stays (whitespace between inline
                elements is significant, and ~1.1 KB is not worth a layout defect that renders
                correctly on the machine that made it).
                The dashboard SCHEMATIC (the inline SVG in index.html, its sc-* CSS and its
                INSPECT/I18N bindings) has its own gate — scripts/run-schematic-audit.sh + the
                /schematic-review skill: a pill can name a physically correct value and still be
                drawn on the wrong pipe, which nothing else here can see. A change here also ages
                the README's RECORDING of the dashboard (docs/media/dashboard.gif) — a second gate,
                scripts/run-ui-gif-audit.sh + the /ui-gif skill, since a recording renders perfectly
                forever whatever the UI became; re-record with scripts/record-dashboard-gif.sh
                (tools/uigif/ holds the scenes + the checker)
```

## NVS namespaces

| Namespace | Content |
|-----------|---------|
| `daik_cfg` | `cfg` — the **atomic credential/service blob** (`logic/config_store.hpp`): WiFi credentials and rollback state; MQTT (broker, credentials AND this installation's base topic, v16); syslog and SNTP; board-local hardware; OTA channel/language; HomeHub; the MQTT reference-room mapping/freshness/readiness fields; optional Open-Meteo location; ENV III; the v15 external circulation-power witness (name/topic/paths/max_age/on+off thresholds/confirm window — the independent evidence the `dhw_loss` checkup correlates against); and board-preset identity. The v9 actuation bit and v14 dynamic-LWT mode byte are layout-compatible retired bytes: both serialize as zero and are ignored on read. Heating-curve diagnosis derives arming from the timestamped MQTT room mapping only; forecast is optional and has its own location-consent boundary. Blob versions v1–v16 remain exact-length/CRC checked, so a truncated newer blob is never accepted as an older one. Non-empty `mb_host` enables read-only polling; no setting enables writing. Legacy per-key credentials remain read-only fallback; `boot_fails` is the boot-loop crash counter, and `heap_rst` the heap watchdog's consecutive-restart breadcrumb (i32, cleared on any ordinary boot, capped so a restart LOOP is bounded). |

**Flash partitions beyond NVS.** `hist` (0x1e000, 8 KB) fills the gap that already existed between
`coredump` and `ota_0`'s 64 KB boundary, and holds the COARSE 24-hour trend snapshot `history.cpp`
writes from an `esp_restart` shutdown handler. It is deliberately NOT in `nvs`: 24 KB shared with the
WiFi credentials cannot hold it, and it would put the credentials' partition under write traffic for
a nice-to-have. It is OPTIONAL AT RUNTIME and has to be — `esp_https_ota` writes the inactive APP slot
and never the partition table at 0x8000, so every device updated over the air keeps the table it was
flashed with and simply has no such partition. A missing lookup is an ABSENT FEATURE, never an error
and never a retry; the only way a deployed board gains it is a re-flash over USB or the web installer.
Keep the `nvs` offset/size stable as always.

**The link is persisted; the model is not.** The RX/TX pins + protocol are the physical, boot-invariant
X10A link — cached in NVS, tried FIRST by the detection sweep (defaults as fallback, so a stale cache
self-heals), and re-persisted only when they change. The **model** (`profile` + fingerprint `fp_*`) is
re-detected on **every boot**: `config_load` seeds `profile="auto"`, and `poll_detect` applies the
model in RAM only (`config_set_model`) — so a swapped unit is re-identified, and `profile`/`fp_*` are
**not** in NVS. `poll_detect` calls `config_save_link` (persist) only when pins/proto change.

**Writers commit only the fields they own.** Two tasks write the config — httpd (`/set_*`) and poll
(detection) — so a writer that saves a whole `Config` saves whatever it snapshotted, including fields
someone else has since changed. Detection snapshots, then probes the bus for a whole sweep before
committing, so it must never write back a whole struct: that would revert a `/set_wifi` that landed
during the sweep, *after* the user got `{"ok":true}`. It therefore uses the narrow setters
`config_save_link` (rx/tx/proto, persisted) and `config_set_model` (profile/`fp_*`, RAM), which patch
the live config in place under the mutex via `apply_link`/`apply_model` (`logic/config_model.hpp`,
host-tested). Whole-struct `config_save` stays for the HTTP handlers: they own the credential fields
and are serialized on the single httpd task. The rule is deliberately **asymmetric** — it closes
poll→httpd, not httpd→poll (a `/set_*` save can still revert a link commit from its own tiny
snapshot→save window); that direction self-corrects on the next detect, the credentials it protects
do not.

**`config_save` can fail — every caller checks it.** The credential/service fields are written as one
CRC-checked blob with a single **atomic** `nvs_set_blob` (`logic/config_store.hpp`): it fails
all-or-nothing, so on error the PREVIOUS blob is intact and `config_save` returns `false` without
publishing to RAM — never a partial credential state, across both a write failure and a power cut.
The self-healing RX/TX/proto link keys are written after the blob; a hiccup there is logged,
self-heals on the next detect, and is re-validated by `config_load`'s `link_pins_safe`. It does not
turn an already-committed service request into a false 500; `/set_hp`, which owns the link, opts into
requiring those keys and leaves RAM untouched on failure. The decision is host-tested in
`config_save_succeeded()`.
The `/set_*` handlers answer `500 {"ok":false,"error":"config write failed"}` and skip the reboot;
the WiFi rollback-restore falls through to the setup portal rather than rebooting into a loop it
cannot persist its way out of (the restore lives in NVS alone, so an unpersisted one is re-decided
identically on every boot); `config_save` itself logs the failing key + `esp_err_t` to `/diag` +
syslog.

`nvs` at `0x9000` is untouched by OTA (partitions.csv) so config survives upgrades. Keep its
offset/size stable across versions.

## HTTP API

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /favicon.ico inert embedded setup/dashboard icon; also available on the open setup AP
GET  /heat-pump-icon.png embedded dashboard app icon; trusted-LAN only
GET  /status      version, platform, uptime_s, app_elf_sha256 (build identity — matches a core dump
                  to its .elf), pins_avail[] (the chip-safe X10A GPIOs for the RX/TX picker, minus the
                  pins the firmware itself drives — the status indicator and the recovery button —
                  logic/board_pins.hpp),
                  board{led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,user_set,preset_id,
                  preset_name,vendor,pins_local[],presets[]}
                  (the runtime board-hardware config written by POST /set_board; user_set = the user
                  has STATED this hardware, as opposed to it being the build's defaults — the NVS
                  `board_set` key above, and the Hardware modal's licence to NAME the board in its
                  preset dropdown rather than opening on "Custom"; pins_local[] is the
                  LED/button-eligible set — WIDER than pins_avail by the dedicated-JTAG pads,
                  NARROWER by the X10A link's own rx/tx (board_hw_valid refuses a local pin that
                  equals either, so offering them was offering a guaranteed 400) — it
                  drives the two pin pickers in the ESP32 card's Hardware modal; presets[] =
                  {id,name,vendor,led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,i2c_pins[]}
                  per DOCUMENTED board
                  (logic/board_presets.hpp), the modal's "Board" dropdown, which only FILLS the five
                  fields — nothing is saved until the user submits. Carried in this payload rather
                  than a route of its own because the modal already reads pins_local from it: one
                  source, no second fetch to fail, and a preset cannot arrive disagreeing with the
                  pin lists it must fit inside. Empty only when NO board is selected and this build
                  (or the current link position) withholds every preset — the UI then hides the row;
                  a SELECTED board is re-added even when its factory LED/button fields would now be
                  refused (#339), since a selector missing the identity the same payload reports would
                  read as the board having been forgotten),
                  env3{type,supported,enabled,sda,scl,connected,fresh,age_s,temperature_c,
                  humidity_pct,pressure_hpa,error,samples,errors,pins_avail[],presets[]} — the
                  optional M5Stack ENV III sensor (env3.cpp). `supported` is the BOARD's answer
                  (an M5Stack preset is selected) and `enabled` is already ANDed with it, so a stale
                  enabled flag on a Seeed board reads as off rather than as a sensor that ought to be
                  working. The three readings are null unless the sample is fresh — never a last-known
                  value, the same rule the held-over X10A rows follow — and `error` then carries WHY
                  ("unsupported_board"|"disabled"|"collecting"|"sensor_not_found"|"sht30_crc"|…),
                  since "no number" and "no number BECAUSE the CRC failed" are different findings.
                  pins_avail[]/presets[] are this bus's own I2C candidates and are NOT gated on
                  `supported`: since #339 the Board Hardware form saves board identity and ENV III in
                  ONE atomic POST /set_board, so selecting AtomS3 Lite and attaching its Grove sensor
                  in a single submit needs the pins offered while the PERSISTED board is still
                  Custom/Seeed. They reserve the LIVE X10A pair alone (config_link_pins) — the pending
                  LED/button pins are filtered by the browser, and the complete proposed snapshot is
                  re-validated authoritatively on the request path (env3_config_valid over
                  config_env3_reserved_pins), so the wider offer can never persist a colliding pair,
                  wifi{ssid,ip,rssi,connected,bssid,mac,std,rolled_back}
                  (bssid/std are the associated AP's BSSID + PHY standard name e.g. "Wi-Fi 4", null
                  while offline; mac is this STA's own MAC, always present; rolled_back = the last
                  /set_wifi was UNDONE by the credential rollback — sticky until the next /set_wifi,
                  and the only trace of it, since the rollback reboots and the SSID shown is just the
                  old one again),
                  mqtt{configured,connected,tls,has_creds,broker,base,base_custom,error} (has_creds =
                  whether creds are
                  stored, never their value; read from the CONFIG not the client — creds outlive a
                  disabled broker, which is exactly the state the UI must offer to clear via
                  /set_mqtt's clear_creds. `base` is always the EFFECTIVE base topic — the
                  compile-time default when nothing is stored — since reporting "" would make a
                  default device look unconfigured to the modal that prefills it; `base_custom` is
                  the separate fact of whether the user has STATED one, which is what the UI needs
                  before offering to reset it. The string is redacted, the bool is not: "is this the
                  default?" is diagnostic, the word the user chose is not),
                  reference_temperature{configured,name,topic,temperature_path,setpoint_path,
                  timestamp_path,enabled_path,hvac_mode_path,max_age_s,subscribed,has_value,
                  source_id,calibration_k,temperature_min_c,temperature_max_c,temperature_c,
                  has_setpoint,setpoint_c,enabled,hvac_mode,received_at,received_ago_s,source_at,
                  source_unix_s,timestamp_source,age_s,fresh,freshness_reason,
                  temperature_valid,setpoint_valid,control_eligible,room_error_k,reason,reason_code,
                  retained,messages,errors,rejections[,error][,eligibility_error]} — the decoded and
                  canonical MQTT living-room input. The `<base>/heating_curve` document's `room`
                  object archives its numeric accepted
                  view. It is the required heating-curve-diagnosis input; `room_error_k` is recorded
                  raw and is not an LWT correction. It feeds no heat-pump write.
                  SAVING the topic is the whole consent to subscribe to it (#357 removed the second
                  gate #341 had added): while one is stored it is subscribed and decoded, and
                  deleting it drops the subscription and CLEARS every captured field. `reason` is the
                  load-bearing one for a UI — "disabled" (the thermostat reports itself off),
                  "non_heating_mode", "stale" — because a reading can be present, fresh and still
                  unusable, and the diagnosis card must say WHICH rather than call the input missing.
                  POST /test_ref_temp stays outside all of it, so a candidate can be proved before it
                  is saved,
                  circulation_source{configured,name,topic,power_path,timestamp_path,max_age_s,
                  on_threshold_w,off_threshold_w,confirm_s,subscribed,has_value,power_w,state,
                  source_at,source_unix_s,timestamp_source,age_s,fresh,freshness_reason,retained,
                  messages,errors,rejections[,error]} — the EXTERNAL CIRCULATION WITNESS (#361): an
                  independent MQTT power meter on the DHW circulation pump, decoded on the mqtt task
                  beside the room source and following the same consent boundary (the saved topic IS
                  the subscription; deleting it clears every captured field). `state` is the
                  CONFIRMED class from logic/circulation_source.hpp — on/off/unknown — never the raw
                  sample: the witness is a PULSED load, so a lone spike must not flip the state and a
                  hysteresis-band reading must not read as off. It exists because the `dhw_loss`
                  checkup cannot otherwise tell a leaking 3-way valve from ordinary circulation
                  losses, and `name`/`topic` are redacted like the room source's for the same reason
                  (a typed name, a topic embedding a device id),
                  weather_forecast{configured,provider,model,fetch_interval_s,max_age_s,fetching,
                  available,has_value,latitude,longitude,state,outdoor_mean_2h_c,
                  solar_energy_2h_wh_m2,issued_at,fetched_at,valid_for_decision_at,last_attempt_at,
                  age_s,fresh,freshness_reason,successes,errors[,reason][,error]} — the Open-Meteo
                  ICON forecast (weather_forecast.cpp). `available` is the three-way AND of
                  configured, the task's own availability and freshness, so a consumer never has to
                  combine them itself; a FAILED refresh keeps has_value plus the last two numbers for
                  diagnosis while available/fresh go false, which is the distinction between "no data"
                  and "data that must not be acted on". FETCHING is gated on the SAVED LOCATION and
                  nothing else (#357 removed #341's second gate along with its
                  "dynamic_lwt_disabled" state): saving coordinates is the consent to send them, so
                  a stored-but-deliberately-unfetched location is no longer a state that exists.
                  `issued_at` is ALWAYS null — the endpoint does
                  not expose the model-run instant and fetch time is not a substitute for it.
                  latitude/longitude are null when unconfigured and "<redacted>" under ?redact=1,
                  heating_curve{method_version,armed,state,state_code,reason,reason_code,
                  sample_eligible,current_room_error_k,last_sample_room_error_k,
                  last_sample_unix_s,outdoor_temperature_c,last_sample_outdoor_temperature_c,
                  forecast_available,plant_gate_known,plant_gate_active,
                  heating_mode_known,heating_mode_active,room_source_unix_s,room_age_s,sequence,
                  evaluations,samples,holds,blocks} — versioned raw heating-curve diagnosis
                  (mqtt_ha.cpp, logic/heating_curve_diagnosis.hpp). `armed` is derived from the
                  timestamped MQTT room mapping only; forecast is optional. State/reason are the last
                  1s evaluation (`off|recording|hold|degraded|blocked` and `disabled|sample_recorded|
                  sampling_interval|room_unavailable|x10a_unavailable|homehub_unavailable|
                  plant_gate_unknown|plant_inactive|forecast_unavailable|clock_invalid|
                  heating_mode_unknown|non_heating_mode|sampler_inactive`), mirrored as stable
                  numeric codes. Codes 3/4 remain unused after removal of deadband/rate-limit
                  semantics. `sampler_inactive` (14) is the one reason /status can report that the
                  evaluator never emits: the sampler lives on the MQTT publish task, which SAFE MODE
                  never creates, so its snapshot stays default-constructed at Off/Disabled while
                  `armed` is derived from the saved room mapping at request time. Published raw that
                  was a payload contradicting itself, and "disabled" is the evaluator's word for "no
                  room source is mapped" — so the card told the reader to set up the source sitting
                  configured one row below it. logic/heating_curve_diagnosis.hpp's
                  heating_curve_reported_reason substitutes it (host-tested, and narrow: every state
                  a RUNNING evaluator produces passes through untouched). Clearing the BROKER is a
                  different state and stays `disabled`, because arming requires mqtt_uri — so that
                  one genuinely is disarmed. Nullable raw
                  errors are facts only while eligible/recorded; sequence + absolute timestamp form
                  the durable event contract. Room error is not an LWT offset. There is no actuator
                  result in this block and cannot be one.
                  The OUTDOOR pair is the optional local axis from ENV III (env3.cpp), gated on the
                  same fresh-AND-plausible pair the ENV III MQTT document uses, so a reading this
                  firmware refuses to publish cannot reach a sample. `outdoor_temperature_c` is LIVE;
                  `last_sample_outdoor_temperature_c` is the value AS IT STOOD at the recorded event,
                  which is the one an archive needs — a room error alone cannot separate a heating
                  curve that is too STEEP from one shifted too HIGH (+0.5 K at -5 C and at +12 C ask
                  for opposite corrections and record identically without it). It is CONTEXT, NEVER a
                  gate: no branch of the evaluation reads it, an absent sensor changes no state,
                  reason or counter, and the contract test refuses a `blocked`/`hold` on it — a gate
                  here would silently stop sampling on every board without the accessory, which
                  looks exactly like the feature merely being idle. Absent or non-finite records as
                  null, never 0 (which would read as a freezing day), a sample taken without the
                  sensor CLEARS the previous event's reading rather than inheriting it, and
                  disarming drops it with the rest of sample memory. Adding it did NOT move
                  `method_version` — the room error is derived exactly as before, so archived events
                  stay comparable; the MQTT payload's own `schema_version` went 1 -> 2 instead,
                  since payload SHAPE is what changed,
                  syslog{configured,resolved,reachable,host,port,error},
                  ota{channel} — "release"|"dev", the FEED the next OTA check reads (POST /set_ota).
                  On /status and not only /ota/status because the Settings Firmware card renders its
                  selector from /status like every other setting; a device can be SET to a channel it
                  is not yet running a build from, so it is reported rather than inferred from the
                  running version's "-dev.N" suffix,
                  ui{lang} — "auto"|"de"|"en", the web UI's MANUAL language override (POST /set_lang,
                  logic/ui_lang.hpp). "auto" (the default) = browser-detected; "de"/"en" force a
                  language on every client. Reported here so the Firmware card's Sprache selector
                  renders from /status like the channel, and the browser applies it over its own
                  navigator.language guess,
                  ntp{server,synced,time} — server is the CONFIGURED address (config().ntp_server:
                  NVS "ntp_server" override of CONFIG_DAIKIN_NTP_SERVER, runtime-editable via
                  POST /set_ntp exactly like syslog_host/POST /set_syslog), not necessarily who
                  answered; synced/time are false/null until the first SNTP reply of this boot lands,
                  else RFC 3339 UTC (logic/timestamp.hpp) — mirrors syslog{} rather than sys{} below,
                  since it is a runtime-configurable network service too, not a static board fact,
                  hp{proto,rx,tx,connected,
                  last_ok_s,registers,values,crc_err,timeout_err}, profile{id},
                  plus
                  modbus{enabled,connected,discovering,host,port,unit_id,rx,fails,
                  values,task_stack_min_free_words,plant_gate_known,plant_gate_active
                  [,error,error_code,error_detail,error_register]}
                  — the HomeHub link diagnostics. READ-ONLY: there is no actuator object and no
                  actuation flag — the link is read-only. The PLANT GATE pair is input register 53,
                  the one HomeHub fact the shadow controller consumes — `known` false means the
                  register did not answer and must never read as an inactive plant. `host` is the configured persistent
                  target (redacted like the other reporter-identifying values); empty means disabled.
                  Explicit discovery is request-local and therefore not a status mode; `discovering`
                  remains false for wire compatibility. The plant-gate pair also reaches MQTT through
                  the `<base>/heating_curve` document's diagnosis.gates block — as EVIDENCE for the
                  diagnosis, never as a writable entity: there is no actuator here to mirror,
                  sys{free_heap,min_free_heap,max_alloc,heap_restarts,reset_reason,safe_mode} — heap
                  headroom (free / since-boot low-water / largest-contiguous INTERNAL, via
                  heap_guard.hpp's one sampler) + how many consecutive heap-watchdog restarts preceded
                  this boot (0 on an ordinary one; the restart is an esp_restart, so reset_reason
                  reads the same "sw" a config save produces and without this field a board
                  restarting itself every five minutes is indistinguishable from one somebody kept
                  saving settings on) + why the device last booted, ALWAYS present (unlike last_crash, and unlike the MQTT heartbeat needs no
                  broker); reset_reason via logic/reset_reason.hpp, safe_mode = the latched boot-loop
                  recovery flag (safe_mode.cpp; true once too many crash boots accumulated -> poll +
                  MQTT skipped),
                  last_crash (null unless this boot was a FAULT or a dump is still in flash — and
                  null again once POST /crash/dismiss DELETES the report, else
                  {reason,reason_code,fault,coredump,task,pc,backtrace[],corrupted,elf_sha256} — the
                  reason/summary from the boot-time cache, `coredump` re-read from flash per request
                  so a cleared dump can't strand the banner; drives the crash banner, whose title keys
                  on `fault` — an orphan dump alone is NOT "restarted after a crash"),
                  history{dt,persist,rows[{id,label}],modbus_rows[{id,label}],env3_rows[{id,label}]}
                  — `persist` is how THIS boot's rings came to be: "accept" (adopted from .noinit
                  DRAM across a reset that kept power) or the named reason they started empty
                  ("power_cycle", "wrong_catalog" after an update moved the trend set, "bad_crc",
                  "wrong_version", "no_record"). Reported because a chart that emptied itself
                  otherwise reads as a defect, and only the device knows which of those happened —
                  plus which
                  X10A/board rows,
                  which structurally paired HomeHub schematic measurements and which ENV III
                  accessory readings carry a 24-hour trend,
                  and at what
                  cadence. The ID is the CONCEPT (logic/history.hpp's TRENDS — what GET /history
                  takes, so a request is model-independent); the LABEL is how the DETECTED profile
                  spells that row, which is what lets the UI attach a trend to the value row it is
                  already rendering. Rows this profile does not carry are omitted entirely,
                  health{covered_s,full_span,available,assessable,evaluated,status,
                  checks[{id,verdict,evidence,observed_s,required_s,…}]} — the 24-hour plant CHECKUP
                  (logic/checkup.hpp, checkup.cpp), judged on the DEVICE: `status` is the worst
                  verdict across the checks and `covered_s` how much of the day was actually
                  OBSERVED (seconds, not whole hours — the first hour after a reboot must read as the
                  small number it is rather than rounding to "0 h"). covered_s is CARD-level context;
                  each check carries its OWN evidence clock (observed_s/required_s), because a
                  mostly-readable pressure row cannot lend 24 hours to an RPS row seen for two
                  seconds. EIGHT checks in READING order,
                  fault first, each `unavailable` | `collecting` | `ok` | `info` | `warn` plus its
                  own named numbers: fault{active},
                  dhw_loss{max_k_h,windows,high_windows,high_with_pump,high_pump_off,
                  circulation_on_s,circulation_known_s}, cycling{starts,mean_run_s},
                  defrost{count,share_pct,paired_count,defrost_s,run_s}, pressure{min_bar},
                  flow{min_l_min},
                  heater{buh_min,bsh_min,buh_s,bsh_s}, retries{seen}. Named per check rather than a generic pair,
                  so the browser needs no table saying what field N means for which id — that table
                  would be a second definition of the check, free to drift. A number the check did
                  not establish is `null`, never an omitted key (redact.hpp's rule: an absent field
                  is indistinguishable from an older build that never had it). Not `diag` — GET /diag
                  is the log ring the bug-report button pulls, and two unrelated things under one word
                  is how a reader ends up looking in the wrong place,
                  detect{proto,valid,capacity_kw,capacity_kw_iu,ou_eeprom,candidates[],families[],
                  ambiguous,
                  model{name,family,marketing}} — drives the dashboard's Model card. TWO capacities,
                  separate fields, never merged:
                  capacity_kw is the OUTDOOR unit's own report (page 0x00/12) and is null whenever the
                  variable-length descriptor is too short to carry offset 12; capacity_kw_iu is the
                  INDOOR unit's rated code (0x60/6, same units), which detection reads as its ranking
                  fallback AND (since #225) as the filter that narrows candidates[] when the O/U
                  figure is absent, and which is carried through the fingerprint
                  (config fp_iu_kw_tenths) so the card can show a capacity for the many units that
                  never report the O/U one. They are NOT interchangeable — a 6 kW outdoor unit under
                  an 8 kW indoor unit is an ordinary pairing — so the UI labels which unit it is
                  showing rather than substituting one figure for the other. All three unit facts
                  (both capacities + ou_eeprom) are gated on fp_valid, like candidates[]: POST /detect
                  clears the fingerprint, and reporting the PREVIOUS unit's figures through that
                  window is the stale-fingerprint-as-live-reading case DESIGN.md rules out.
                  RX/TX are auto-detected: read-only on the card while the bus answers, a pins_avail
                  dropdown (re-runs detection) when it doesn't.
GET  /values      decoded readings [{label,value,unit,reg}], plus "binary":true / "held":true where
                  they apply (emitted only when true — the many live rows cost no bytes). `reg` is the
                  X10A register PAGE the row came from, and it is what lets the BROWSER apply
                  logic/ou_stale.hpp's page rule (0x20/0x21 stop being refreshed while the compressor
                  rests) to any row it shows — structurally, instead of by a label list that would be
                  a second, drifting copy of a rule CI gates in C++ (the catalog spells those rows
                  ~50 ways across 43 profiles). `held` is the DEVICE's own answer to the same
                  question, now that the poll engine applies the rule too (#209 defect 5): the
                  browser still derives it, but a non-browser consumer gets it without
                  reimplementing the rule, and the marker travels WITH the row rather than being
                  recomputed from a snapshot taken elsewhere.
                  X10A rows also carry `concept` where logic/homehub_map.hpp pairs them with a
                  HomeHub register — the browser matches on that string and does NO matching of its
                  own, since a label match here is the substitution lwt_select/ou_stale exist to
                  prevent. The HomeHub's own readings ride a SECOND array, `modbus`
                  [{label,value,unit,off[,binary][,enum][,concept]}] — two arrays, never merged, mirroring
                  the two stacks: the sources have separate liveness, and merging would make "is this
                  reading current?" a per-row question no consumer could answer. `off` is the EKRHH
                  data-model offset (def/homehub.hpp), which is what the pairing keys on.
                  THE ARRAY IS EMITTED ONLY WHILE THE LINK IS LIVE AT THE MOMENT THE SNAPSHOT IS
                  TAKEN — so if it is present, every row in it was read this cycle. That guarantee
                  belongs in the payload because a consumer cannot tell a stale row from a fresh one
                  by looking at it, and the browser is not the only consumer. Liveness and the cache
                  sit behind two DIFFERENT mutexes, so mb_values_snapshot() reports the link state
                  AFTER copying the cache (the only place the two can be tied into one answer);
                  checking mb_status() and then copying left a window in which one response carried
                  the previous session's rows under that guarantee. Not live -> the KEY IS OMITTED,
                  never emitted empty: an absent array and an empty one are different claims, and
                  only absence says "no current reading"
GET  /history?row=<trend id>[&source=x10a|modbus|env3]   one source's 24-hour series, oldest sample
                  first;
                  X10A is the backwards-compatible default, Modbus is accepted only for the eleven
                  paired concepts (logic/homehub_map.hpp) plus the unpaired Smart-Grid timeline, and
                  env3 only for the three accessory rings. Payload:
                  {id,source,label,dt,unit,t0,b0,v[],held[[from,count],…]}. `unit` is the ROW's own unit, read
                  from the cached value — never a hardcoded "°C": the thirty-one X10A trends mix °C,
                  bar, KiB
                  and unitless rows, and the browser prints this string into the range readout and the
                  crosshair, so a bar row labelled °C would be the #35-#39 shape. A catalog test pins
                  that each trend resolves to EXACTLY ONE row per profile, of one type code and one
                  width (which is what makes the tenths exact), across all profiles. Ids — the
                  authoritative list is logic/history.hpp's TRENDS, which is what a request takes:
                  numeric rows dhw_tank, leaving_water, leaving_water_post_buh, return_water,
                  refrigerant_liquid, water_pressure, flow, pump_signal,
                  circuit_pressure, comp_rps, eev, outdoor_air, outdoor_heat_exchanger, discharge,
                  room_temp, inv_current,
                  ct_l1, ct_l2, ct_l3; component-STATE timelines defrost_state, quiet_state,
                  bsh_state, buh_step1, buh_step2, valve_dhw, valve_heat, water_flow_switch; and the
                  four that are not catalog rows at all — smart_grid_mode (two contact bits),
                  circulation_state (the confirmed external MQTT witness) and the two BOARD trends
                  free_heap and
                  max_alloc (the ESP32's own memory in KiB — no register, fixed English labels, and
                  they resolve no catalog row by construction). The ENV III ids are
                  env3_temperature, env3_humidity and env3_pressure, offered on /status.history
                  .env3_rows only while the sensor is enabled — a disabled accessory is absent rather
                  than three permanently empty charts. `v` is TENTHS of that unit (the
                  resolution the converters produce, so a sample is exact rather than rounded on the
                  way in — the browser scales by 10) or null. `held` run-length-marks WHICH nulls
                  were the outdoor unit RESTING rather than a failure to measure: `v` stays a plain
                  number-or-null array any consumer can read, and the reason rides alongside instead
                  of inside it (Modbus has no held-over state, so its array is empty). `b0` is the
                  monotonic 5-minute bucket of sample zero and aligns the two instruments exactly;
                  `t0` is the wall-clock instant of sample 0, derived at SERVE time
                  from the current clock and the sample count (the ring advances on the MONOTONIC
                  clock, so it survives SNTP setting the time mid-boot) and OMITTED when the clock
                  has never synced — the UI then reads out an age rather than a fabricated time,
                  the same refusal logic/timestamp.hpp makes. An unknown id is 404, never a
                  defaulted trend. Sent in CHUNKS (~1.1 kB body): smaller than /values' ~6 kB, but
                  still a new allocation on a heap whose largest contiguous block is the real
                  ceiling. Which rows HAVE a trend is /status.history — a row the profile does not
                  carry is omitted, an absent feature stated by absence rather than an empty chart
(no /events)      There is NO live-push route. The web UI POLLS: GET /values every 2 s and
                  GET /status every 8 s, one chain, backing off to 30 s while the device is
                  unreachable and suspended entirely while the browser tab is hidden. The /events
                  WebSocket that used to be the only live transport was removed — a dropped IDF queue
                  message froze one stream until reboot with nothing logged (#238) and its broadcaster
                  ran the /status builder on the task owning the X10A UART (#241); docs/ARCHITECTURE.md
                  "Push vs. poll" carries the measurements. Consequences worth knowing: EVERY route is
                  now under the http_register OOM guard (the raw-registered WS handler was the one
                  exception), CONFIG_HTTPD_WS_SUPPORT=n, and /status is built on ONE task
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker. NO shipped client reads this — the
                  web UI never fetches it, and the RX/TX dropdown takes its GPIOs from
                  /status.pins_avail (logic/board_pins.hpp), NOT from this pin_hint. Legacy metadata
                  behind a read-only inspection endpoint for humans/scripts
GET  /diag[?verbose=0|1][?clear=1][?redact=1]   in-memory diag log. ?redact=1 scrubs the handful of
                  lines that interpolate a host/IP/SSID (logic/redact.hpp) and switches the response
                  to CHUNKED: a replacement is longer than most values it replaces, so the redacted
                  text can GROW past the static dump buffer, and the alternatives are a second ~8 KB
                  .bss buffer or a ~6 KB contiguous heap allocation
GET  /status?redact=1   the bug-report form of /status: every reporter-identifying value
                  (wifi.ssid/ip/bssid/mac, mqtt.broker, mqtt.base,
                  reference_temperature.name/topic, circulation_source.name/topic,
                  weather_forecast.latitude/longitude, syslog.host, ntp.server, modbus.host — the
                  last is the saved HomeHub LAN address or `.local` hostname) reads "<redacted>".
                  Read the set off logic/redact.hpp rather than this list, which is a convenience
                  copy. SOME entries are in it for a reason the network addresses are not: the
                  coordinates are the reporter's HOUSE to six decimals,
                  reference_temperature.name is a word the user typed — usually a room, sometimes a
                  person, the circulation witness adds the same pair one source over (its topic
                  normally embedding a smart-plug device id), and mqtt.base is one they typed that
                  also becomes the installation's HA
                  device id. The count is DERIVED from the call sites by the redaction audit, so this
                  list and logic/redact.hpp's cannot silently disagree with the builder again.
                  An UNSET field is left EMPTY rather than substituted (redact_identifier, not the
                  raw redact_or primitive): "<redacted>" over an empty value manufactures an
                  identifier that does not exist, and the first question triage asks of a frozen
                  report is which optional sources the installation is even running. mqtt.broker is
                  the sharpest case — empty IS the disabled state, so every broker-less device used
                  to report a hidden broker. The empty string is kept rather than a null so the
                  field's TYPE does not change with the flag; weather_forecast.latitude/longitude
                  reach the same answer from the other side by emitting null when unconfigured.
                  The KEY is always emitted — an omitted field is indistinguishable from an older
                  build that never had it, and "which build produced this?" is the first question a
                  frozen report must answer. Substituted where each value is WRITTEN, never as a
                  pass over the finished string (the httpd stack budget that v1.0.12 overflowed).
                  The UNREDACTED /status is what the dashboard polls — it legitimately shows the
                  SSID and the broker, so redaction is opt-in per request, never the default
GET  /scan        WiFi scan {"networks":[{ssid,rssi}]} — TRUSTED-LAN ONLY and read by NO shipped
                  client: the setup portal takes a TYPED SSID (no dropdown, no fetch), so this is a
                  humans/scripts diagnostic like /models, not part of the provisioning surface
GET  /coredump[?clear=1]   stream the current-firmware core-dump image (chunked octet-stream; 404 if
                  none or if the only raw image is a proven foreign-build orphan);
                  ?clear=1 erases the coredump partition. Decode offline against the matching-version
                  .elf: scripts/decode-coredump.sh coredump.bin (CI archives the .elf per build). The
                  UI surfaces a crash banner + one-click download when /status.last_crash is set.
POST /crash/dismiss   ACKNOWLEDGE + DELETE this boot's crash report: erase the core-dump image and
                  mark the cached CrashInfo dismissed (diag_crash_dismiss), so crash_is_notable() is
                  false everywhere at once — /status.last_crash goes null, the retained MQTT crash
                  topic clears on the next heartbeat tick, and the web UI's banner is gone across
                  reloads and browsers. That is the point: the banner's "dismiss" was page state
                  alone, so a reload brought the same crash back. Separate from /coredump?clear=1
                  because they answer different questions — clearing frees the flash slot for the
                  NEXT dump and deliberately leaves the fault reset on record, while this says the
                  crash has been dealt with; and a fault reset commonly carries no dump at all (a
                  stack overflow overruns it), where ?clear=1 changes nothing the banner keys on.
                  ERASE FIRST, mark second: a failed erase of current-firmware evidence answers 500
                  {ok:false,error} and marks NOTHING, since a dismissal surviving it would report
                  "no crash" while the dump was still downloadable. Proven-foreign residue is the
                  exception: it is already suppressed from /status and GET /coredump, so an erase
                  failure cannot pin a separate current-fault banner. RAM-only and needs no NVS — after any reboot the reset reason
                  is no longer a fault and the dump is gone, while a NEW crash must show. POST, not
                  a GET beside /coredump: it destroys the one artifact a bug report needs, so it must
                  not be reachable by a link or a prefetch. The reset REASON survives untouched
                  (/status.sys.reset_reason + the heartbeat's own "Reset Reason" sensor) — what was
                  deleted is the crash report, not the fact that the board rebooted the way it did
POST /set_wifi    {ssid,pass} -> validate (ssid 1-32 chars; pass empty[open] or 8-63) -> persist +
                  reboot. A rejection is 400 {ok:false,error} like every other write endpoint (the
                  shared send_err) — it used to be bare text, which the setup portal couldn't tell
                  apart from success. If WiFi was already configured, the OLD ssid/pass are stashed as a one-shot
                  NVS backup (wifi_rollback flag) and wifi_rolledbk is cleared (a new attempt retires
                  the old verdict): after reboot, if the new creds fail to get a DHCP lease,
                  wifi_start_sta restores the backup + reboots (setting wifi_rolledbk ->
                  /status.wifi.rolled_back); a successful connect clears the backup. So a bad
                  SSID/password entered over the LAN self-heals to the last working network instead of
                  stranding the device in the setup AP. The deadline is REASON-aware
                  (logic/wifi_rollback.hpp): rolling back is destructive, so only an AP that SUSTAINS
                  its refusal (auth class at 2 consecutive 30 s checkpoints, ~60 s) spends them — an
                  absent SSID or a slow DHCP is no evidence against them and gets 180 s, long enough
                  for a rebooting router. wifi.cpp clears the reason on STA_CONNECTED, so an earlier
                  refusal can't outlive the association that disproved it.
POST /set_mqtt    {broker,user,pass,clear_creds,base} -> pre-flight the broker synchronously (DNS -> TCP
                  probe -> short-lived esp-mqtt CONNECT/auth, mirroring mqtt_ha's creds-require-mqtts://
                  policy) -> on success persist + reboot; on failure 400 {ok:false,error} and nothing is
                  saved. Unchanged settings short-circuit to {ok:true,reboot:false} (no probe, no reboot).
                  "" (empty broker) disables MQTT and skips the probe. Blocks up to ~8 s — the one
                  request-path network block (syslog/wifi don't); safe under the handle_all 503 guard.
                  CREDENTIALS: the modal never prefills them, so an empty user+pass means KEEP the
                  stored ones (else an unrelated broker edit would wipe a working login). Empty can
                  therefore not also mean "clear" — clear_creds:true (the UI's "remove stored
                  credentials" checkbox, shown when /status.mqtt.has_creds) is the explicit signal; a
                  non-empty user/pass is an explicit SET and wins over the flag. Without it an
                  authenticated mqtts:// broker can never migrate to an anonymous mqtt:// one: disable
                  + re-add both send empty creds -> both keep -> the kept creds then 400 every
                  plaintext broker ("Credentials require mqtts://"). Only a flash erase escaped that.
                  BASE TOPIC: `base` is this INSTALLATION's MQTT base topic (logic/mqtt_base.hpp),
                  runtime because CI publishes ONE esp32s3 image while the base is a per-installation
                  fact — CONFIG_DAIKIN_MQTT_BASE_TOPIC is now only the DEFAULT, and an empty stored
                  value MEANS that default, so the upgrade is a no-op for every deployed device and
                  needs no migration. OPTIONAL and absent means KEEP, never "reset to the default":
                  the dashboard always sends it, but this is a documented ROUTE — a script, or a
                  browser still holding a cached pre-v16 bundle, posts broker+creds alone, and
                  defaulting on absence would move a deliberately-renamed installation back onto the
                  shared base. Rules
                  are checked BEFORE the broker pre-flight (free and local, versus a DNS lookup + up
                  to ~8 s of the httpd task) and each refusal carries its own machine code beside the
                  English text — the ENV III pattern, so the bilingual UI translates without the API
                  losing its one wording. The browser deliberately keeps NO second copy of the rules:
                  the load-bearing one is that the base must still slugify to something, since
                  device_node_id() falls back to the constant "daikin" and would put two boards back
                  on ONE HA device — the exact collision this setting exists to end. Changing it
                  RENAMES the installation (new HA device, history stays with the old one), FORKS
                  every metrics series (a collector carries the topic as a LABEL, so the two halves
                  never overlap and a query pinned to one reads the other as absent — the firmware's
                  own state->x10a migration cost exactly that), and strands
                  the previous base's retained topics, which the firmware deliberately does NOT
                  retract — and the reason is the setting's own purpose: a base may be SHARED by a
                  second board, so a device sweeping it on the way out would delete the retained state
                  of the installation it was colliding with. That is the user's call
                  (docs/HOME_ASSISTANT.md carries the sweep).
POST /set_syslog  {host,port} -> validate port range -> persist + reboot. Empty host disables syslog.
                  Unchanged settings short-circuit to {ok:true,reboot:false}, same as /set_mqtt and
                  /set_ntp — a re-save of identical values would otherwise reboot for nothing.
                  DNS/reachability are NOT checked here (no request-path network block); they resolve
                  in the syslog task and surface via /status.syslog {resolved,reachable,error}.
POST /set_ntp     {server} -> persist + reboot. No request-path network probe (the SNTP client
                  resolves + retries on its own task after reboot, same as syslog); an empty server
                  is accepted and read by config_load() on the next boot as "reset to the
                  CONFIG_DAIKIN_NTP_SERVER compile-time default" (SNTP has no disabled state, unlike
                  syslog_host's empty-means-off). Unchanged settings short-circuit to
                  {ok:true,reboot:false}, same as /set_mqtt.
POST /test_ref_temp  {name,topic,temperature_path,setpoint_path,timestamp_path,enabled_path,
                  hvac_mode_path,max_age_s} -> subscribe the CANDIDATE mapping on the existing
                  authenticated MQTT client, wait up to 12 s for a frame, decode it through the very
                  path the live source uses, and answer {ok,test_proof,temperature_c,setpoint_c,
                  control_eligible,room_error_k,reason,reason_code,retained} — or 422 with the reason
                  it did not (no fresh value, invalid JSON path, timestamp moved backward, broker not
                  connected, another test running). It WRITES NOTHING: no Config, no NVS, no change
                  to the live subscription. An empty topic is 400 here, because "test nothing" is not
                  a question. The whole point is the `test_proof` it returns — see the next route.
                  Uses the SAME parser as /set_ref_temp, so the mapping that earned the proof is
                  byte-for-byte the mapping that can then be persisted. This probe is the ONE part of
                  the reference stack outside the saved-source subscription: the frame reaches the
                  probe before live-source decoding, because the required order is test -> save ->
                  arm, and a gate that blocked the test would make the first step depend on the last
POST /set_ref_temp   {name,topic,temperature_path,setpoint_path,timestamp_path,enabled_path,
                  hvac_mode_path,max_age_s,test_proof} -> validate, persist and
                  apply live on the existing MQTT client without reboot. Empty topic is the explicit
                  disabled state; otherwise the topic is exact (no wildcards), paths are bounded
                  dot-separated JSON selectors, and max_age_s is an integer in 10..3600. An unchanged
                  mapping still reconfigures the subscription so the Settings action can retry it.
                  A non-empty mapping REQUIRES a valid `test_proof` from /test_ref_temp or answers
                  409 "Test this MQTT mapping successfully before saving" — the one route here that
                  demands evidence rather than merely well-formed input, because this mapping is the
                  required heating-curve diagnosis input and a typo does not fail loudly: it
                  produces a plausible-looking room error, or a permanent BLOCK that reads like a
                  broken feature. The proof is bound to all seven BEHAVIOURAL fields (not the name,
                  which is cosmetic and needs no retest), so testing one topic cannot license saving
                  another, and editing a path or the max age invalidates it. It is RAM-only and
                  single-use: a save consumes it, a newer test supersedes it, a reboot forgets it —
                  which is right for evidence about a broker that may have changed since. Deleting a
                  source (empty topic) needs no proof: removal must never depend on the thing being
                  removed still working
POST /test_circulation  {name,topic,power_path,time_path,max_age_s,on_tenths_w,off_tenths_w,
                  confirm_s} -> subscribe the CANDIDATE mapping on the existing authenticated MQTT
                  client, wait up to 12 s for a frame, decode it through the path the live witness
                  uses, and answer {ok,test_proof,power_w,state,retained} — or 422 with the reason it
                  did not. Writes NOTHING (the /test_ref_temp shape, for the same reason): an empty
                  topic is 400, since "test nothing" is not a question
POST /set_circulation   {name,topic,power_path,time_path,max_age_s,on_tenths_w,off_tenths_w,
                  confirm_s,test_proof} -> validate, persist and apply live (no reboot). The
                  EXTERNAL CIRCULATION WITNESS: an independent power meter (in practice a smart plug
                  on the DHW circulation pump) whose confirmed on/off state is what lets the checkup
                  tell a real 3-way-valve leak from ordinary circulation losses. Empty topic is the
                  explicit disabled state; a non-empty one REQUIRES a valid `test_proof` from
                  /test_circulation or answers 409, exactly like the room source — a mistyped witness
                  does not fail loudly, it silently re-attributes a tank's cooling rate. The proof
                  binds the seven BEHAVIOURAL fields (not the cosmetic name). An unchanged mapping
                  short-circuits to {ok:true,saved:false,reboot:false}; only a change to those seven
                  reconfigures the subscription, so renaming the source does not retire its evidence
POST /set_weather {latitude,longitude} -> validate + persist + notify the weather task (no reboot,
                  and no DNS/TLS/JSON on the request path). SAVING THE LOCATION IS THE CONSENT to
                  hand these coordinates — and this device's public source IP — to a third party, so
                  the task fetches while one is stored and stops when it is cleared. There is no
                  second switch: #341 put one in front of this and #357 removed it, because the
                  request is the act being consented to and the save is the only place a user states
                  it. Both are
                  STRINGS parsed strictly (optional sign, digits, `.` or the German `,`, at most six
                  decimals — an exponent, whitespace or a `+` is rejected rather than coerced, since
                  a coordinate that silently becomes a different one is a request the user cannot
                  see failing). BOTH EMPTY is the explicit disabled state; exactly one empty is 400
                  "latitude and longitude are both required" — half a location is never a location.
                  Disabling also requests the retained MQTT topic's cleanup, so a stopped forecast
                  leaves no last-known values on the broker
(no /set_dynamic_lwt)  RETIRED in #357. There is no controller mode to POST: the heating-curve
                  diagnosis arms itself while the timestamped MQTT room mapping is configured
                  (`heating_curve_diagnosis_armed`). Forecast/location is optional comparison evidence;
                  `/set_weather` applies its own collection/privacy boundary live. What the route bought was a
                  second statement of a fact the configuration already made — and it could not be
                  reached: it answered 409 until those sources existed, while the only editors for
                  them lived inside the Settings card that was hidden until the mode was on. An
                  ACTIVE controller stays unrepresentable for the stronger reason than a rejected
                  word: no enum, no Config field, no live blob byte and no route exist to carry one.
POST /set_env3    {enabled,sda,scl} -> validate + PROVE + persist + REBOOT. A standalone
                  COMPATIBILITY endpoint since #339 folded ENV III into the Board Hardware form — no
                  shipped client posts here (the UI sends env3_* to /set_board), and both routes run
                  the one env3_save_preflight so the two can never disagree about what counts as
                  evidence. Every key is optional
                  and an omitted one keeps its stored value. Refused unless the selected board preset
                  is an M5Stack one (the Grove port is what makes the sensor plausible), the two pins
                  differ, and both survive the same reservation rules the X10A link, the status LED
                  and the recovery button apply to each other. Beyond validation it demands EVIDENCE
                  from the hardware, graded by what is changing (logic/env3.hpp's Env3SaveCheck):
                  enabling on new pins runs a real bus probe (422 env3_sht30_not_found /
                  env3_qmp6988_not_found, 503 env3_probe_busy), enabling on the pins already running
                  requires a fresh sample (422 env3_not_reachable), moving pins while running is 409
                  env3_disable_first (two masters must never briefly drive one shared wire), and
                  DISABLING checks nothing at all — it is the recovery path and must not depend on
                  the hardware that may be the problem. Each refusal carries a machine `code` beside
                  the English `error` so the bilingual UI can translate without the API losing its
                  one wording. Reboots on a real change, unlike /set_hp's live apply: the I2C driver
                  owns the bus for the task's life
POST /set_hp      {profile,rx,tx,mb_host,mb_port,mb_unit_id}
                  -> validate + apply live (no reboot). Every key is OPTIONAL and an omitted one keeps
                  its stored value, which is what lets the pin picker POST {profile,rx,tx} without
                  flipping anyone onto Modbus — and lets the HomeHub modal POST only its three fields.
                  `mb_host` is the complete HomeHub intent: non-empty polls exactly that address;
                  empty suppresses tasks, searches and sockets. This SECOND stack never stops X10A.
                  mb_port 1..65535, mb_unit_id 1..247 and mb_host's LENGTH (at most
                  CONFIG_BLOB_MAX_STR = 512 chars) are checked by validate() — the length bound is
                  not cosmetic: the atomic blob's decoder rejects the WHOLE blob on a longer string,
                  so a saved over-long address discarded the entire configuration on the next boot.
                  A refusal is 400 "mb_host is too long"; config_save refuses independently. The three
                  HomeHub fields (host, port, unit) persist in the atomic blob and apply live: the
                  httpd route calls mb_reconfigure(), while the Modbus task remains the sole socket
                  owner and retires/restarts itself as needed. `actuation_enabled` is NOT accepted —
                  the Modbus link is read-only, and an accepted-but-inert field would read like a
                  capability that still exists. rx/tx
                  PERSIST (the physical
                  pin cache — a manual override survives reboot); profile is session-only. The UI
                  always sends profile="auto" (fully automatic — no manual model pick); a concrete id
                  is still accepted (pins the model for this session) but never offered in the UI.
                  proto is NOT accepted (auto-detected); poll_s fixed at 1 s and lang is NOT accepted
                  here — the UI language is its own setting now (POST /set_lang), no longer a /set_hp
                  field. RX/TX are auto-detected; when the bus is silent the Protocol card's pin dropdown
                  posts {profile:"auto",rx,tx} to re-run detection.
POST /discover_homehub   {} -> run the bounded, explicit `_http._tcp` mDNS browse and return
                  {ok:true,host:"<resolved IPv4>"}. Trusted-LAN only, no configuration write and no
                  Modbus-task reconfigure: the dialog fills its ordinary address field, and only its
                  later Save persists the result. A miss returns 404 so manual entry remains available.
POST /set_board   {preset_id,led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,
                  env3_enabled,env3_sda,env3_scl} -> validate + PROVE + persist + optional REBOOT.
                  ONE atomic form owns the board identity, its onboard parts and the optional M5Stack
                  ENV III accessory, so choosing AtomS3 Lite and attaching its Grove sensor cannot
                  half-save. It therefore also answers ENV III's graded evidence refusals (the same
                  422/503/409 codes /set_env3 returns, via the shared env3_save_preflight), and a
                  board switch away from M5Stack retires env3_enabled in that same save rather than
                  leaving an I2C task running for hardware the form no longer shows. preset_id is the
                  stable key: a non-string is 400 "preset_id must be a string", an unknown one 400
                  "board preset is unknown", and an omitted one recovers the legacy exact-match choice
                  once for a pre-v12 cached UI.
                  REBOOT. The board's own onboard parts: which pin the status indicator is on, whether
                  it is a plain LED (led_type 0) or a WS2812 (1), and which pin (if any) carries the
                  factory-reset button. -1 = absent for either pin. Runtime rather than Kconfig because
                  CI publishes ONE esp32s3 image and boards disagree about their onboard hardware.
                  Reboots (unlike /set_hp's live apply): both are claimed once at task start — the
                  WS2812 opens an RMT channel, the button installs a pull — and hot-swapping a running
                  driver from another task buys nothing for a once-per-board setting. TWO facts move
                  here, and one comparison for both is what made a save vanish (#257): the five
                  VALUES decide the reboot, while the SUBMIT ITSELF states that the user has said
                  what this board is (the `board_set` key / user_set above). Picking the preset your
                  device already carries moves no value but is still that statement, so it is a SAVE
                  with NO reboot — {ok:true,reboot:false,saved:true}, where `saved` is what stops the
                  UI reporting an NVS write as "no changes". Decided by board_env_save_needed /
                  board_env_reboot_needed (logic/env3.hpp, host-tested), never re-derived here —
                  they OR the board answer with an ENV III change, so a sensor edit always reboots
                  even when no board value moved: its I2C controller is owned for the sensor task's
                  whole life.
                  A submit that moves neither still short-circuits to {ok:true,reboot:false} like
                  /set_mqtt//set_syslog//set_ntp.
                  Validation (board_hw_valid) checks the chip-safe LOCAL-I/O set — wider than the X10A
                  set by exactly the dedicated-JTAG pads 39-42, since a board's button legitimately
                  sits there (AtomS3 Lite: GPIO41) — plus the collision rules, in BOTH directions: no
                  pin may be claimed by the indicator, the button and the X10A link at once, whichever
                  endpoint is called second
   (every /set_*) a failed route-owned NVS write answers 500
                  {ok:false,error:"config write failed"} and does NOT reboot/apply; unrelated
                  self-healing link-cache maintenance failures are logged without rejecting a
                  committed service blob, while /set_hp requires those keys (the failing key is on /diag)
POST /set_ota     {channel:"release"|"dev"} -> validate + persist, applied LIVE (no reboot, unlike
                  /set_board: nothing claims the channel at task start — ota_update.cpp reads it when
                  it fetches, so the very next check uses the new feed). An unknown name is REJECTED,
                  not defaulted — answering ok to a typo would look like a saved setting. Unchanged
                  -> {"ok":true,"reboot":false} like the other /set_* routes
POST /set_lang    {lang:"auto"|"de"|"en"} -> validate + persist, applied LIVE (no reboot, like
                  /set_ota: nothing claims the language at task start — the UI reads /status.ui.lang,
                  so the next poll applies it). The web UI's MANUAL language override on top of the
                  browser default (logic/ui_lang.hpp): "auto" hands the choice back to the browser
                  (navigator.language), "de"/"en" force one on every client that opens the dashboard.
                  An unknown name is REJECTED, not defaulted (a typo would look saved). Unchanged
                  -> {"ok":true,"reboot":false} like the other /set_* routes
POST /detect      re-run auto-detection now (no reboot): reset profile to "auto" + invalidate the
                  fingerprint (RAM only) -> the next poll cycle sweeps protocol + re-fingerprints
GET  /ota/check   start an async manifest check (?ms= is parsed but gates nothing — TLS date
                  validation is compiled out, so OTA needs no wall clock even though SNTP now exists)
POST /ota/update[?downgrade=1]  start the async download of the SELECTED channel's build.
                  Re-fetches the manifest and re-runs the downgrade gate
                  itself rather than trusting what /ota/check left behind: this route is reachable on
                  its own, so gating only in /ota/check would mean no gate at all for a direct caller.
                  ?downgrade=1 (query_flag_on — fires on "1" and nothing else) is the CHANNEL SWITCH:
                  the only way to install a build older than the running one (dev -> the last
                  release). Per-request, never stored
GET  /ota/status  {state:idle|checking|updating|done|error, progress, message, update_available,
                  downgrade, channel, available, current} — the UI polls this; all strings go through
                  json_quote. `downgrade` = the offered build is installable but OLDER (the
                  dev -> release direction); the UI needs BOTH flags, since update_available alone
                  makes a release-channel check on a dev board read "up to date" forever
GET  /mcp         embedded/gzipped static MCP information + setup page; no external assets or
                  network requests, CSP connect-src 'none', never SSE
POST /mcp         stateless read-only MCP: initialize / tools/list / tools/call; get_status +
                  get_hp_values mirror /status + /values. Notifications → 202; no SSE/session
```

No HTTP auth / TLS by design — trusted LAN only. See docs/SECURITY.md.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the largest *contiguous* free
block). Keep HTTP handlers under a try/catch that returns 503 on OOM (an uncaught throw unwinds
through C frames → `std::terminate` → reboot). Stream `/diag` and the MQTT discovery instead of
one big `std::string`. Treat any new large contiguous allocation as a crash risk. A reboot loop
also stops the poll cycle and drops MQTT availability.

**The STACK is a second, separate budget — and it fails silently.** Everything above is about the
heap; the crash that took v1.0.12 down was a *stack* overflow, and none of the heap rules could see
it. `http_append_status_json()` runs on the httpd task, which had 8 KB; the core dump's task table
read `httpd 7728/460` — 460 bytes off its floor — so it wrote past `pxStack` into its own TCB,
clobbering `pvThreadLocalStoragePointers[0]` with `0x4`, and died ~44 s later inside lwip's
`pthread_getspecific` with a backtrace pointing at an innocent WebSocket send (a transport this
firmware no longer has). Two rules follow:
- **Build long JSON with successive `+=`, never one `a + b + c + …` chain.** A chain materialises
  every intermediate `std::string` at once, all live in the same frame; `+=` holds one at a time and
  takes a bare literal with no wrapper (so it also drops the allocations). http_status.cpp's board /
  presets blocks are the worked example.
- **Read the task table in any core dump you open** (`USED/FREE` per task). It is the only place this
  is visible: nothing on `/status` reports stack headroom, and a task can sit one frame from death
  while every heap number looks perfect. Anything under ~1 KB free wants raising —
  `cfg.stack_size` in http_server.cpp, `xTaskCreate` for the rest.
`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` (sdkconfig.defaults) now makes the *first* write past a
limit panic at the offending instruction. IDF's default canary is only compared at a context switch
and a sparsely-writing frame can skip over it — which is exactly what happened here (TLS[1], the
neighbour it would have had to cross, was left intact).

**It happened AGAIN, on the other task, and that is the lesson (#241).** `http_append_status_json()`
ran on TWO tasks — the httpd task *and* `hp_poll`'s WebSocket broadcaster — so raising one stack
fixed half the problem and left the other half to be re-discovered. v1.0.12 raised httpd 8192 ->
12288; `hp_poll` stayed at 8192 until #229 (`health`) and #231 (`history`) grew /status from ~2.2 KB
to ~3.5 KB, and it died with `hp_poll 7664/520` — this time caught *at* the offending instruction by
the watchpoint above (`exccause 0x41 DebugException`), inside a `malloc()` under `Config::Config`,
because `config()` returns a whole `Config` **by value** (~10 `std::string` copies) on the stack of
whoever builds /status. **A builder shared by two tasks is only as safe as its smallest stack** —
check every runner, not the one that crashed.

The SECOND runner is now gone: removing the WebSocket push left /status built on the httpd task
alone, and `hp_poll` went back to 8192, since the builder is precisely what it could not fit.

**And then it happened a THIRD time, on the surviving runner (#318).** ENV III extended the same
builder, and the two signed CI ELFs show exactly what that cost: the httpd handler's FIXED FRAME
grew from 0x2630 (9776) bytes in dev.295 to 0x2950 (10576) in dev.296, leaving 1712 bytes of a
12288 stack for `config()`'s nested `Config`/`std::string` copy, httpd itself and interrupts. The
dev.296 OTA double-faulted inside `config()` with the running task's TCB overwritten, and rolled
back. It is now **16384**, chosen to leave 5808 bytes above the measured frame. Two lessons beyond
the number, both about method: a stack budget is read off the ELF's frame size and a decoded dump,
never off an idle heap reading (an idle board looks fine at every one of these sizes), and the
crash arrived through OTA — the one path where a too-small stack takes down a fleet rather than a
desk. So the rule to carry forward is the general
one, not the numbers: **anything that grows /status grows every stack that builds it**, and a
change that hands a task a large new builder raises that task's stack in the same commit. Nothing on
`/status` reports stack headroom — the task table in a core dump is the only place it is visible.

**Re-measured 2026-08-07 on `main` (f686dff), and the headline margin was the wrong number.** The
builder's fixed frame is now **0x2e00 = 11776** bytes (dev.295 9776 → dev.296 10576 → f686dff 11616
→ 11776 on `main` @ 7524b4c), so 1200 bytes were consumed since #318 with no single change
announcing it — and 160 of them arrived in the two commits merged *during* this measurement. Reproduce it — this is the
prescribed method, off the ELF, never off an idle heap reading:

```bash
scripts/idf-docker.sh bash -c 'A=$(xtensa-esp32s3-elf-nm build/daikin-altherma-esp32.elf | grep " T _ZN4daik23http_append_status_json" | cut -d" " -f1); xtensa-esp32s3-elf-objdump -d --start-address=0x$A --stop-address=$((0x$A+8)) build/daikin-altherma-esp32.elf | grep entry'
```

Two corrections came out of it, and both matter more than the frame number:

**(1) The httpd ceiling is not `h_status`, it is `mcp_post`.** 16384 − 11776 = 4608 reads like the
margin and is not: the frame is one node of a call chain. Walking every `entry a1,N` over the whole
disassembly, the deepest httpd path is `httpd_thread`(32) → `httpd_server`(80) →
`httpd_process_session`(32) → `httpd_uri`(64) → `handle_all`(32) → **`mcp_post`(1456)** →
`http_append_status_json`(11776) → `circulation_source_status`(800) → `config`(48) →
`Config`copy(112) → `_M_construct`(48) → `_M_create`(32) = **14512 bytes**, leaving **~1872** of
16384 — before ISR frames (Xtensa nests them on the current task stack) and before the ~700-byte
`_Unwind_RaiseException` path a `std::bad_alloc` costs *below* the throwing frame. MCP `get_status`
reuses the exact HTTP snapshot builder (mcp_server.cpp), so it pays the builder's frame *plus* its
own — the `/status` route was measured for years while the deeper caller was not. **Measure the
worst PATH, not the biggest FRAME.** The builder is a 3.5× outlier over the next-largest frame in
the firmware (`history_record`, 3296, on the poll task) and nothing else is close.

**(2) Most of that frame is a `-Og` artifact, not live data.** The named locals sum to ~2.2 KB
(`Config` 656 — `const Config& c = config()` lifetime-extends a by-value temporary across the whole
function — `CheckupReport` 332, `WeatherForecastStatus` 208, `ReferenceTemperatureStatus` 168,
`CrashInfo` 164, …). The other ~9 KB is one distinct stack slot per `jstr()`/`std::to_string()`
temporary, because this project builds at IDF's default **`CONFIG_COMPILER_OPTIMIZATION_DEBUG`
(`-Og`)**, which barely coalesces slots across a 760-line function full of EH cleanup regions.
Compiling *only this translation unit* at `-Os` takes the frame **11776 → 3744** and the whole
`mcp_post` path **14512 → 6480** (~9904 free of 16384), with no source change. **This is APPLIED** —
`set_source_files_properties(http_status.cpp PROPERTIES COMPILE_OPTIONS "-Os")` in
`main/CMakeLists.txt`, which carries the full rationale beside the warning contract, and is
per-source-file rather than a `CONFIG_COMPILER_*` key for that contract's own two reasons (a Kconfig
key is global and would re-optimise IDF and the managed components; `sdkconfig.defaults` is hashed
into CI's ccache key). The builder is no longer an outlier at all — 3744 against `history_record`'s
3296. The COST is real and accepted: `-Og`'s precise backtraces are what diagnosed both overflows,
and this is the file whose dumps mattered, so a dump from here is now less exact. A frame two thirds
smaller prevents more dumps than it obscures.

**Verified ON HARDWARE, not just on the ELF.** Both images were built from ONE source base
(`main` @ 7524b4c), signed and USB-flashed to the XIAO bench board in turn — distinct ELF shas
(`de3c4d995` at `-Og`, `14f7fe37f` at `-Os`), each confirmed stable across its own capture.
`/status`, `/status?redact=1`, `/values` and `POST /mcp` `get_status` were captured on both and
compared by JSON PATH: **403 paths on each status surface and 151 on /values, structurally
identical**, with every value difference live-varying state (ENV III drift, the MQTT circulation
witness, heap, RSSI, counters). An `-O` level cannot change semantics for well-defined code, so what
this rules out is LATENT UB that `-Og` happened to mask — the one real risk of the change. Two traps
worth knowing, each of which produced a convincing false alarm first:
- **The bench board OTA'd itself mid-test.** It follows the `dev` channel, and a locally-flashed
  image stamps `1.0.0`, which every `dev.N` outranks — so the board silently replaced the build
  under measurement with the CI one, rebooted (`esp_restart()` after install → reset reason **`sw`**,
  `last_crash: null`) and made a clean stress run read as a crash. Guard every on-hardware
  comparison by reading `app_elf_sha256` BEFORE and AFTER, and treat a changed sha as a void run.
- **Flashing an older build onto an OTA'd board opens the setup portal.** The dev build had already
  rewritten NVS in a NEWER config-blob version, and the older image correctly REFUSED it (the
  exact-length/CRC rule) instead of misreading it — no credentials, so `provisioning.cpp` opened the
  AP. That is the blob contract working, not a fault: rebuilding from the matching base restored the
  board from its own intact NVS with no password re-entry. Only serial shows this (an AP-mode board
  withholds `/diag`), and `cat /dev/cu.*` drops the log often enough to read as a dead board — use
  pyserial.

**Splitting the builder into helpers is the weaker lever, and the measurement says so.** Extracting
the already-braced `health` block dropped the frame 11616 → 11184 (−432; measured on the f686dff
base, before the two commits that took the frame to 11776) but the standalone helper
costs 736, so the *peak* got 304 bytes WORSE; adding `history` gave 10816 + max(736, 496) = 11552,
i.e. 64 bytes better than where it started. The frame is a SUM of block contributions while the peak
is `builder + max(helper)`, so extraction only pays once ~10 blocks are out (~4 KB, extrapolated) —
a large mechanical edit to the most stack-critical function in the firmware, for half of what one
build line buys. **`cfg.stack_size` stays 16384 and was deliberately NOT raised**: 4 KB of permanent
RAM on a board whose binding limit is the largest CONTIGUOUS free block, spent on a compiler
artefact, while `-Os` buys twice as much for one line. Should the `-Os` scoping ever be reverted,
the stack must go to 20480 in the same commit — ~1872 bytes free is under this file's own "anything
under ~1 KB free wants raising" line once ISRs and the unwind path are counted.

**Every allocating FreeRTOS task loop must self-guard.** A task is a C frame boundary like a
handler is: an escaping `std::bad_alloc` → `std::terminate` → reboot. Wrap the loop *body* in
`try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping the
last good state, and continue after the normal delay — see `mqtt_task` (mqtt_ha.cpp), `poll_task`
(hp_poll.cpp), `syslog_task` (syslog.cpp — its per-cycle `config()` snapshot copies ~10 strings) and
`status_led_task` (status_led.cpp — its tick copies strings out of wifi_info()/mqtt_status()/
hp_stats(), and an escape would reboot the board over a cosmetic LED).

**Never allocate while holding a mutex.** The guard above makes an OOM survivable only if the throw
doesn't strand a lock: a mutex taken with a raw `xSemaphoreTake` is *not* released when the stack
unwinds, so every reader then blocks `portMAX_DELAY` and the device wedges into a watchdog reboot —
worse than the crash the guard prevents. Either keep the critical section non-allocating (stage the
work in locals, `swap`/move it in — `poll_once`'s commit) or take the lock through an RAII guard
(`main/rtos_guard.hpp`'s `daik::SemGuard`, aliased as `Lock` in every file that takes one — for
readers that must copy strings out under the lock). That guard is SHARED, and it did not use to be:
nine files carried their own copy, in two shapes that had already diverged about whether a failed
take was noticed. A per-file struct is invisible to the file beside it, so nothing could choose
between them — and only one of the shapes can express the BOUNDED/try-lock acquire that a callback
context needs (esp-mqtt's own event task, where the guard-the-allocation route is unavailable).
`diag_log.cpp` deliberately keeps its bare takes: its critical sections are pure `memcpy`, i.e. the
first route above, and converting them would be style rather than safety. The status mutexes
in syslog.cpp and mqtt_ha.cpp take the first route: `set_status` stores the error as a string-LITERAL
pointer, never a `std::string`, so the writer cannot allocate at all — load-bearing for mqtt_ha's,
which runs on esp-mqtt's own unguarded event task where the rule above is unavailable.

## Typical debugging

```bash
scripts/run-mock-tests.sh --coverage                   # host logic tests + 95% coverage floor
tools/coverage/selftest.sh                             # prove the floor fails closed
scripts/run-domain-audit.sh                            # are the catalog's values physically right?
scripts/run-schematic-audit.sh                         # does the dashboard drawing still say what it means?
scripts/run-ui-use-case-tests.sh                       # do all visible UI actions actually work?
scripts/run-contract-tests.sh                          # do the firmware's source boundaries hold?
screen /dev/cu.usbmodemXXXX 115200                     # serial monitor (native USB on s3)
curl http://daikin-altherma-esp32.local/status | jq          # device status (incl. last_crash)
curl http://daikin-altherma-esp32.local/values | jq          # decoded values
curl http://daikin-altherma-esp32.local/coredump -o coredump.bin   # pull a crash dump (if any)
scripts/decode-coredump.sh coredump.bin                # symbolize it against the matching .elf
esptool --chip esp32s3 -p <port> erase_flash           # wipe NVS (reset config)
```
