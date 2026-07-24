# Contributing

Thanks for looking at this. It is a hobby project for a specific piece of hardware, so the most
valuable contributions are usually **evidence from a real heat pump** — a model whose values decode
wrongly, a register the catalog is missing, a board whose pins aren't in the safe list.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## What is most useful

| | |
| :--- | :--- |
| **A wrong or missing value on your unit** | The highest-value report. Include your model, `GET /values`, and `GET /diag` (a detect pass dumps the raw page bytes). See "Value correctness" below. |
| **A board that isn't the XIAO ESP32-S3** | The RX/TX safe-pin table in [`docs/WIRING.md`](docs/WIRING.md) is filled in per board by hand — a verified new row is a real contribution. |
| **Protocol findings** | Anything that sharpens [`docs/X10A_PROTOCOL.md`](docs/X10A_PROTOCOL.md) or [`docs/REGISTERS.md`](docs/REGISTERS.md). |
| **Bugs with a reproduction** | Crashes especially: `GET /coredump` + the version from `GET /status` lets it be symbolized (`scripts/decode-coredump.sh`). |

Please open an issue before a large change. Refactors that don't change behaviour are the one thing
likely to be declined — the comment density and the "why" notes in this codebase are load-bearing.

## The local loop — no board or ESP-IDF required

Two scripts run on a plain system toolchain (cmake + g++/clang++) in seconds. **Run both before
opening a PR.** They are also the first two CI jobs, so a failure here fails the build anyway.

```bash
scripts/run-mock-tests.sh     # CI job `logic-test`   — host-side pure-logic tests
scripts/run-domain-audit.sh   # CI job `domain-audit` — is the value catalog physically RIGHT?
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

A third fast job, `pages-publish-test`, guards the **GitHub Pages publish** rather than the
firmware, so most PRs never need it locally — run it only if you touch
[`scripts/publish-pages-branch.sh`](scripts/publish-pages-branch.sh):

```bash
scripts/run-pages-publish-tests.sh   # CI job `pages-publish-test` — needs only git, no toolchain
```

It races two publishers against a throwaway bare repo, because `gh-pages` has three concurrent
writers (main's root publish, each PR's preview, and the preview cleanup) and the loser used to
fail its entire build — a bug that read as a flake, since re-running always cleared it. Like the
other two, it gates `build`.

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

Fill in [the template](.github/pull_request_template.md). Three checkboxes on it
(`/project-review`, `/feature-docs`, `/domain-review`) are **maintainer-only** — they invoke Claude
Code skills in this repo's `.claude/` directory and are not something an outside contributor can run.
Leave them unchecked; the maintainer runs them before merge. Your equivalents are the two scripts
above plus an honest note about hardware.

`main` is kept **strictly linear** and every commit **signed**, so PRs land as **squash merges** —
enforced by a branch ruleset on `main` (require a pull request, require linear history, require
signed commits, and the `logic-test` / `domain-audit` / `pages-publish-test` / `build` checks
green), not left to convention. Nobody is exempt: the ruleset carries no bypass actors, so this
holds for the maintainer too — `main` takes no direct pushes at all. Practical consequences:

- Everything lands through a PR, including a one-line docs fix. There is no push-to-`main` path.
- Rebase onto `main` rather than merging `main` into your branch. Merge commits can't be accepted.
- Sign your commits (`git commit -S`, or let GitHub sign a web merge).
- `main` moves under open PRs — expect to rebase before merge.
- A red CI job blocks the merge, including on a docs-only PR — the fast gates are cheap and
  hardware-free precisely so this is never a burden.

Fork PRs build and run all gates, but get no signing key: they compile-check only and publish no
preview installer. That is deliberate, not a failure.

## License

Contributions are under the [MIT License](LICENSE). The X10A protocol and value definitions derive
from [ESPAltherma](https://github.com/raomin/ESPAltherma) (MIT), credited in the README. Please keep
new code free of copied material from other projects unless its license permits it and you say so in
the PR.
