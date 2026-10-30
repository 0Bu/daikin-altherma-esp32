# Contributing

Useful contributions start with a reproducible problem: a wrong value, an unsupported board, a
protocol finding or a bug with device evidence. Read the [Code of Conduct](CODE_OF_CONDUCT.md) and
open an issue before a large change. For device reports, follow [REPORTING.md](docs/REPORTING.md);
it explains the redacted report and the separate handling of private crash dumps.

Historical identifiers such as `legacy-209` refer to the private predecessor tracker. Likewise,
`(#N)` in signed commits before public launch names predecessor pull requests; subsequent PR
numbers belong to this repository. Those discussions can contain installation data. Current source
and documentation are authoritative; open a new public issue when a present problem needs more context.

## Local workflow

1. Create an `agent/` branch from current `main`. Keep existing local changes; never overwrite another
   contributor's work. Rebase when `main` advances rather than merging it into the branch.
2. Make the smallest complete change. Add a focused test for new target-independent logic and
   update the document that owns the changed contract.
3. Run the affected checks while developing, then the complete
   [pre-PR gate set](test/README.md#run) before opening a pull request. Run the corresponding
   mutation selftests whenever a checker or its inputs change.
4. Review the diff for unintended edits, personal data and non-English prose. Maintained
   documentation and PR text are English; device UI copy remains complete in every shipped locale.
5. Fill in the [PR template](.github/pull_request_template.md). Describe the problem, resulting
   behavior and validation, including anything that needs target or hardware evidence.

The host loop needs a C++17 compiler and CMake when available, Node ≥18 and Python ≥3.11.
Coverage also needs the compiler's gcov-compatible tool. Browser rendering needs Chrome/Chromium;
full source formatting needs exact clang-format 18.1.8. Individual runner requirements, commands,
selftests and evidence limits are documented once in [test/README.md](test/README.md).

Agent tools use `scripts/agent-python.sh` to select installed Python ≥3.11 with `tomllib`.
`scripts/agent-python.sh --version` verifies the choice; `AGENT_PYTHON` selects a checked override.
The helper installs nothing and changes no shell configuration.

Host tests work without ESP-IDF, Docker or a board. They do not prove that the target tasks call a
rule correctly, that a physical value is true, or that a device survives an update. Source contracts,
domain audits, target compilation, rendered review and hardware acceptance cover different parts
of that evidence. Report each completed layer separately.

### Larger changes and handoffs

For work spanning sessions or components, keep a short note in the existing issue or task. It is
optional for small changes; update it when the scope or evidence changes rather than creating a
second tracker. A useful handoff contains:

- Goal and acceptance criteria.
- Comparison base, current head and owned paths; identify existing unrelated changes.
- Authorized actions and any shared resource reservation.
- Affected contracts, independent reviewers and relevant checks.
- Completed evidence, open findings and unverified layers.
- Next action and any decision needed from the user.

## Building the firmware

Build the ESP32-S3 image through the repository wrapper:

```bash
scripts/idf-docker.sh idf.py build
```

The wrapper resolves the ESP-IDF version pinned in
[build.yml](.github/workflows/build.yml); use it rather than a different local SDK.
`sdkconfig.defaults` selects `esp32s3`, so a clean build needs no separate `set-target`.
Docker is required. An environment without Docker can run host checks but cannot claim a firmware
build.

Managed-component ranges are in [main/idf_component.yml](main/idf_component.yml); the exact
resolved graph is committed in [dependencies.lock](dependencies.lock). For an intentional
update, edit the manifest, run `scripts/idf-docker.sh idf.py update-dependencies`, then review both
files. Do not hand-edit the lock.

A local build is useful but is not required to open a PR: CI compiles build-relevant changes and
retains diagnostic artifacts. State whether you built locally. PR artifacts contain compressed
ELF/checksum and size reports, with no flashable binary or browser-installer manifest.

**Flashing requires a signed application.** The firmware uses the Secure Boot v2 signature
scheme without hardware Secure Boot. An unsigned application can crash-loop before `app_main`.
Run `scripts/require-signed.sh` before every flash. The offline signing key is not in the repository;
never inspect, copy or expose it. Ask the maintainer for official hardware validation. A board you
build with your own key requires a separate trust setup: the pinned-key verifier and maintainer
delivery workflows reject that image, and your board rejects official OTA until USB-reflashed with
official firmware. See [SECURITY.md](docs/SECURITY.md) for the trust model and
[MAINTENANCE.md](docs/MAINTENANCE.md) for separately authorized delivery.

## Where code goes

| Change | Placement and constraint |
|---|---|
| Decode, formatting, validation, configuration, planning or discovery logic | IDF-free header in `main/logic/` and a focused `CHECK` in `test/test_logic.cpp`; device wrappers call that same rule |
| Model profiles | Generated `main/def/` tables are machine output; deliberate corrections use the supported adjudication/override layer |
| Hand-written definitions | `main/def/overlay.hpp`; curated Modbus sources `homehub.hpp`/`altherma4.hpp` and Protocol S `protocol_s.hpp` |
| UI behavior and assets | `main/www/`, following its `AGENTS.md`, [DESIGN.md](docs/DESIGN.md) and [JavaScript ownership map](main/www/js/README.md) |
| HTTP contract | [API.md](docs/API.md); component responsibilities and resource constraints belong in [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Owner instructions and diagnoses | The corresponding user guide; rules and source evidence belong in [DIAGNOSTIC_EVIDENCE.md](docs/DIAGNOSTIC_EVIDENCE.md) |

A profile's page set is also its detection signature. Preserve absent-feature rows as detect-only
`ValueDef::no_publish` where required; removing the last row for a page can change model detection.
Verify converter, layout, label and publication identity against [REGISTERS.md](docs/REGISTERS.md).

Resource-sensitive changes must preserve the rules in [AGENTS.md](AGENTS.md): the largest
contiguous internal heap block is the binding allocation limit; allocating HTTP handlers and task
loops need their exception boundary; allocations cannot strand a raw mutex. Configuration writers
commit only owned fields and check every persistence result. NVS offset/size changes require an
explicit migration decision.

Match [.clang-format](.clang-format) and surrounding code. Keep comments that explain a constraint
or decision. `main/CMakeLists.txt` makes return-type, format and unused-result warnings fatal;
do not weaken these flags to clear a failure. Compiler/helper contracts and named ELF paths protect
the 10 KiB HTTP stack with a 2 KiB reserve and the MQTT 2 KiB per-function frame ceiling. Remeasure
affected paths from the CI-pinned ELF and, when authorized, from task high-water evidence.
Idle heap figures do not measure stack safety.

## Value correctness

If a change alters a reading's meaning, include:

- The affected values, physical quantity, unit and intended result.
- A decode witness: exact wire bytes, expected output and actual output.
- Whether a real unit confirmed the interpretation, with explicit limits if it did not.

Use independent source evidence, not only expected values copied from the implementation. A passing
converter test cannot establish that the selected register or converter is physically correct.

Document genuine model-specific exceptions as evidence-backed `ADJUDICATED` entries in
`tools/domain/audit_exceptions.txt`. A temporary `KNOWN-DEFECT` entry names the unresolved problem
and is deleted by its fix. Never suppress a new finding introduced by the change merely to get a
passing gate.

## Pull requests

Install the local hooks once per clone:

```bash
git config --local core.hooksPath .githooks
```

Before PR creation or push, run `scripts/run-agentic-setup-audit.sh` and inspect its result. This
quick deterministic check reuses the skill and configuration audits; ordinary pushes start no model
process. Use `$agentic-setup` for a broader setup review or authorized modernization and `$skill-audit`
for repository fact drift; `--optimize` requires explicit edit authorization. The pre-push hook checks
every destination and sent commit. Updating an open PR retains current-commit `$skill-audit` and
`$pr-hygiene-review` stamps from a clean exact-commit checkout, without adding another gate record.
A successful lookup finding no open PR allows push after the local audit; a failed lookup blocks it.
This local hook does not change remote branch protection.
Agent setup, generated registration, trust review and runtime acceptance belong in
[AGENT_MIGRATION.md](docs/AGENT_MIGRATION.md).

All changes reach `main` through a PR, including documentation fixes. `main` requires linear history,
squash merges and passing `gates` and `build` checks, with no bypass actors. Sign your commits when
possible; incoming commit signing is requested rather than enforced. Do not force-push or rewrite
shared history without explicit authorization.

The squash commit subject is the PR title, and the public OTA changelog is built from those
subjects. Start every PR title with a Conventional Commits type, optionally with a scope and `!`,
for example `fix(ui): keep the legend visible`. A change an owner can notice uses a type the
changelog generator publishes (`PUBLIC_TYPES` in `scripts/generate-ota-changelog.py`, such as
`feat` or `fix`). Maintenance uses a type it omits, such as `docs`, `test` or `chore`. The PR-hygiene
audit enforces this in CI and lists every accepted type; a title without one gives that version only
a generic changelog line.

The template's review records are maintainer evidence. Outside contributors leave them unchecked
and provide script results and hardware limitations. Every required record must name the actual PR
head; any later commit invalidates it.

| Review | When required |
|---|---|
| `$project-review`, `$domain-review`, `$pr-hygiene-review` | Every ordinary merge, including all local/manual merges; hygiene also runs before PR opening |
| `$heap-safety-review` | HTTP, MQTT, OTA, TLS, JSON, X10A publishing, firmware polling or allocation paths; independent read-only `heap_safety_reviewer` supplies evidence |
| `$skill-audit` | Before PR creation or push; verifies canonical skills/reviewers against repository facts |
| `$feature-docs` | Technical feature surface changes |
| `$schematic-review` | Dashboard drawing, contract or audit changes |
| `$ui-use-case-review` | Visible UI behavior or its test/audit surface changes |
| `$absence-review` | Optional-source lifecycle or presentation changes |
| `$diagnostic-evidence-review` | Diagnosis observations, sampling, thresholds, rules or source claims change |
| `$user-docs-review` | User-facing meaning, instructions, documentation or diagnosis copy changes |
| `$ui-gif` | GIF or stamp changes; a stale/unverifiable recording is independently a hard merge block |

Use independent reviewers for high-risk changes; implementation authors cannot self-certify them.
Unresolved findings, required CI, requested hardware evidence and user decisions block merge.
The exact expected-head REST merge command and review-record syntax are in
[MAINTENANCE.md](docs/MAINTENANCE.md) and [AGENT_MIGRATION.md](docs/AGENT_MIGRATION.md).
A checked box supplies evidence; it does not authorize a merge.

The sole review exception is GitHub-native automerge of an authoritative-CI-attested,
same-repository, one-commit Renovate PR that changes only the fully pinned runner line in
`.github/workflows/renovate.yaml`. Protected-base policy verifies the immutable head and complete
patches. It never applies to local/manual merges, ESP-IDF, esptool-js or mixed changes.

CI runs PR-controlled code under ordinary `pull_request` in `build.yml`. Forks receive no
repository secrets and a reduced token; same-repository workflow authors are trusted CI actors.
The separate `pr-policy.yml` supplies `gates` from the protected base without loading PR code.
The required `build` propagates the shared mechanical result and conditionally compiles relevant
changes. Documentation-only PRs still run both required checks. Do not replace step conditions
with workflow path filters that leave required checks pending.

## Releases

A firmware-relevant merge publishes the development feed at `/dev/`; it creates no release tag or
GitHub Release. A `release: true` workflow dispatch performs one signed build, publishes the release
feed and creates the exact-source tag and GitHub Release. It skips the mechanical PR suite and
contacts no board. In the authorized delivery chain, confirmed cumulative dev-changelog capacity
exhaustion dispatches that workflow for the already validated main head; other failures do not.
Hardware acceptance, exact-source publication, equal-version byte identity and production promotion
are maintained in [MAINTENANCE.md](docs/MAINTENANCE.md).

Crash decoding requires the private raw dump and its exact matching unstripped ELF. The decoder
verifies the ELF bytes and embedded identity; matching a firmware version alone is insufficient,
and matching ELF identity cannot date a stored incident.

## License

Contributions use the [MIT License](LICENSE). Preserve attribution and license notices when adding
permitted third-party material, and describe its provenance in the PR. Existing project credits are
in the main README.
