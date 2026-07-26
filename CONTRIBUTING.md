# Contributing

Thanks for looking at this. It is a hobby project for a specific piece of hardware, so the most
valuable contributions are usually **evidence from a real heat pump** — a model whose values decode
wrongly, a register the catalog is missing, a board whose pins aren't in the safe list.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## What is most useful

| | |
| :--- | :--- |
| **A wrong or missing value on your unit** | The highest-value report. Include your model, `GET /values`, and `GET /diag` (a detect pass dumps the raw page bytes). See "Value correctness" below. |
| **A board that isn't already listed** | The RX/TX safe-pin table in [`docs/WIRING.md`](docs/WIRING.md) is filled in per board by hand — a verified new row is a real contribution. |
| **Protocol findings** | Anything that sharpens [`docs/X10A_PROTOCOL.md`](docs/X10A_PROTOCOL.md) or [`docs/REGISTERS.md`](docs/REGISTERS.md). |
| **Bugs with a reproduction** | Crashes especially: `GET /coredump` + the version from `GET /status` lets it be symbolized (`scripts/decode-coredump.sh`). |

Please open an issue before a large change. Refactors that don't change behaviour are the one thing
likely to be declined — the comment density and the "why" notes in this codebase are load-bearing.

## The local loop — no board or ESP-IDF required

Four scripts run on a plain system toolchain (cmake + g++/clang++, plus node for the last two) in
seconds. **Run all four before opening a PR.** They are also the first steps of CI's `gates` job,
so a failure here fails the build anyway.

```bash
scripts/run-mock-tests.sh          # CI gates step 1 — host-side pure-logic tests
scripts/run-domain-audit.sh        # CI gates step 2 — is the value catalog physically RIGHT?
scripts/run-description-audit.sh   # CI gates step 3 — can a user find out what each value IS?
scripts/run-schematic-audit.sh     # CI gates step 4 — does the DRAWING still say what it means?
```

`run-mock-tests.sh` compiles the IDF-free headers in [`main/logic/`](main/logic/) against
[`test/test_logic.cpp`](test/test_logic.cpp) — the CRC and framing, the value converters, register
extraction, the config model and the Home Assistant discovery payloads. Details in
[`test/README.md`](test/README.md).

`run-domain-audit.sh` is separate on purpose, and the distinction matters:

> **Passing the tests is not the same as being right.** The tests verify the logic they are handed;
> they cannot see a value that is well-formed, compiles, drifts no doc — and is physically false. A
> wrong converter id once published `-971.5 °C` as a water temperature across eight profiles, and a
> valve *position* reached Home Assistant as a 12800 °C temperature sensor. The audit runs the real
> converters over the real catalog and cross-checks [`docs/REGISTERS.md`](docs/REGISTERS.md).

If you touch the audit itself, also run `tools/domain/selftest.sh` — it re-introduces the four bugs
the audit was built for into a throwaway copy and asserts all four are still caught. A checker that
has stopped checking turns "clean" from evidence into a lie.

`run-description-audit.sh` asks the same kind of question one layer up. Every reading reaches the
web UI's value list as a row keyed by its catalog **label**, and tapping that row is meant to open a
plain-language explainer — decided at render time by a first-match-wins regex sweep over the
`DESCRIPTIONS` table in [`main/www/app.js`](main/www/app.js). A label nothing matches renders as a
plain, un-tappable row: no error, no log, just a missing chevron among a hundred rows.
[`main/def/overlay.hpp`](main/def/overlay.hpp) shipped 11 rows exactly so — nine with no explainer,
and two that matched the *fin temp* heatsink-**temperature** entry, describing a protection flag and
a retry counter as a °C reading. Since the profiles are machine-generated, the gap re-opens whenever
the generator emits a label the copy has never seen, without anyone touching this repo's JS.

It evaluates the real table in a JS engine rather than re-implementing its regexes elsewhere (a
looser second copy of a rule is not a test of that rule), so it needs **node ≥ 18** — the only gate
that does. Findings: `D001` a visible reading with no copy, `D002` an entry matching nothing,
`D003/D004` a malformed entry or missing German, `D005` a stale ledger line. If a finding is correct
as it stands, record it in [`tools/descriptions/audit_exceptions.txt`](tools/descriptions/audit_exceptions.txt)
with a reason — except `D001`, which the ledger refuses outright: a published reading the user
cannot look up is the defect the gate exists for, and the fix is copy, not a suppression. Touching
the audit means also running `tools/descriptions/selftest.sh`, same argument as the domain one.

`run-schematic-audit.sh` asks it one layer up again, of the **dashboard schematic** — the inline SVG
in [`main/www/index.html`](main/www/index.html) with its CSS and its `INSPECT` / `I18N` bindings. All
three gates above can be green while the picture is false, and that is not hypothetical: this drawing
has shipped a fan spinning around a point beside its own axle, the leaving-water pill floating 40 px
off the run it names, the return temperature drawn on the heating-only section (claiming a branch
R4T does not read), and "HEIZUNG" struck through by the heating riser so it rendered "HEIZUNC". Each
one is a physically correct value attached to the wrong thing — the `#35`–`#39` shape, drawn.

It parses the real SVG (coordinates, transforms, path geometry, text metrics) and evaluates the real
binding tables, so no second copy of either can drift, and reports in three layers: **structure**
(`S…` — hit target ↔ inspector entry ↔ element id ↔ translation), **geometry** (`G…` — viewBox,
overlaps, labels struck through, axis-aligned runs, a pill's distance to its own pipe, rotor
symmetry) and **domain** (`E…` — a repeated unit needs a name; a return-run reading stays left of
the junction). Findings that are correct as they stand go in
[`tools/schematic/audit_exceptions.txt`](tools/schematic/audit_exceptions.txt) as an `ADJUDICATION`
(citing the decision — `docs/DESIGN.md` §5.3, a measurement) or a `KNOWN-DEFECT` (naming what is
wrong, and deleted by its fix); `S001` (a tap target that opens nothing) and `E002` (a pill on a
branch its sensor does not read) are refused outright. Touching the audit means running
`tools/schematic/selftest.sh`, which re-seeds all six of those historical defects and asserts each is
still caught. What it *cannot* decide — is the drawing still true of the plant, is a new part in the
right place, is the German copy right — it stays quiet about; that half is the maintainer's
`/schematic-review`.

Three more fast gates guard the **published artifacts** rather than the firmware, so most PRs never
need them locally — run them if you touch
[`scripts/publish-pages-branch.sh`](scripts/publish-pages-branch.sh),
[`scripts/build-pages.sh`](scripts/build-pages.sh),
[`scripts/check-web-installer-plan.py`](scripts/check-web-installer-plan.py),
[`scripts/check-publish-version.sh`](scripts/check-publish-version.sh) or
[`scripts/next-version.sh`](scripts/next-version.sh):

```bash
scripts/run-pages-publish-tests.sh         # CI gates step 5 — needs only git, no toolchain
scripts/run-web-installer-plan-tests.sh    # CI gates step 6 — needs only python3
scripts/run-publish-version-tests.sh       # CI gates step 7 — git + python3 + a C++17 compiler
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

All seven are **steps of one `gates` job**, not a job each (the version gate above runs in `build`,
where the stamped version exists; only its tests are a `gates` step). Actions bills every job
rounded up to the next whole minute, so seven ~15-second jobs cost seven minutes for under a minute
of work; a step boundary names the failure just as precisely.

## Building the firmware

There is no local ESP-IDF install. Builds go through the Docker image pinned to the version CI uses
(read at runtime from `.github/workflows/build.yml`):

```bash
scripts/idf-docker.sh idf.py set-target esp32s3 build
```

Only `esp32s3` is supported. **You do not need to build to open a PR** — CI builds every PR and
attaches the artifacts. Say in the PR what you did and didn't verify.

> **Flashing needs a signed image.** This config uses the Secure Boot v2 *signature scheme* without
> hardware Secure Boot, so an **unsigned** app crash-loops before `app_main` (no eFuses are burned,
> so this is a crash-loop, not a brick — reflash to recover). `scripts/require-signed.sh` refuses to
> flash one. Signing needs an offline key that is not in this repo; see
> [`docs/SECURITY.md`](docs/SECURITY.md). For a contributor the practical path is: build to check it
> compiles, and let the maintainer test on hardware — or generate your own key for your own board.

## Where code goes

- **Any decode, config, discovery or policy logic belongs in [`main/logic/`](main/logic/)** as an
  IDF-free header, with a `CHECK` in `test/test_logic.cpp`. Never bury it in a `.cpp` only the device
  can run — that is logic no one can verify without hardware.
- **Never hand-edit `main/def/*` profile tables.** They are machine-generated. A profile's row set
  *is* its detection signature (`def/signatures.hpp` → maximal page overlap), so deleting a row makes
  the correct model lose a page to a feature-richer wrong one. An absent-feature row gets the
  `ValueDef::no_publish` detect-only flag instead of deletion. Verify rows against
  [`docs/REGISTERS.md`](docs/REGISTERS.md) §5.
- **Heap is the binding constraint** (the largest *contiguous* free block, not total free). HTTP
  handlers must stay under the shared OOM try/catch; every allocating task loop must self-guard; never
  allocate while holding a mutex. The rules and the reasoning are in
  [`.claude/CLAUDE.md`](.claude/CLAUDE.md) → "Memory constraints".
- C/C++ formatting is [`.clang-format`](.clang-format). Match the surrounding comment density —
  explaining *why*, not *what*, is the house style.

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

Fill in [the template](.github/pull_request_template.md). Four checkboxes on it
(`/project-review`, `/feature-docs`, `/domain-review`, `/schematic-review`) are **maintainer-only** —
they invoke Claude Code skills in this repo's `.claude/` directory and are not something an outside
contributor can run. Leave them unchecked; the maintainer runs them before merge. Your equivalents
are the four scripts above plus an honest note about hardware.

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

Fork PRs build and run all gates, but get no signing key: they compile-check only. That is
deliberate, not a failure.

**A PR publishes no installer.** Per-PR previews at `…/PR/<N>/` are retired: each one was a
`gh-pages` push, and every `gh-pages` push starts a full GitHub Pages deployment on top of the
build. To flash a build in a browser, use the **dev channel** (`…/dev/`), republished by every
firmware-relevant merge. The PR's own image is still there as a build **artifact** on the run, for
7 days. Actions minutes are a metered monthly resource on this account — the same reason the fast
gates share one job and the firmware build is skipped when it cannot matter.

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
