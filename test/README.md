# Tests and deterministic gates

This is the command and evidence reference for local verification. Run commands from the repository
root. Development and PR workflow are in [CONTRIBUTING.md](../CONTRIBUTING.md); maintainer review
and separately authorized hardware delivery are in [MAINTENANCE.md](../docs/MAINTENANCE.md).

The production rules under [main/logic/](../main/logic/) are IDF-free. Their host tests compile the
same headers used by the firmware. Source contracts inspect target orchestration that those tests
cannot link. UI tests execute the assembled production JavaScript, and browser tests add actual
layout and accessibility evidence. None of these contacts a heat pump or proves a hardware update.

## Run

For an ordinary PR, run this complete local gate set. During development, start with the affected
surface; the table below explains what each result means.

```bash
scripts/run-mock-tests.sh --coverage
scripts/run-sanitizer-fuzz-tests.sh
scripts/run-runtime-integration-tests.sh
CLANG_FORMAT=clang-format-18 scripts/run-format-check.sh
scripts/run-contract-tests.sh
scripts/run-esp-idf-matrix-audit.sh
tools/esp_idf_matrix/selftest.sh
scripts/run-domain-audit.sh
scripts/run-description-audit.sh
scripts/run-user-docs-audit.sh
scripts/run-diagnostic-evidence-audit.sh
scripts/run-schematic-audit.sh
scripts/run-ui-localization-audit.sh
scripts/run-ui-use-case-tests.sh
scripts/run-browser-render-tests.sh
scripts/run-redaction-audit.sh
scripts/run-pr-hygiene-audit.sh
tools/absence/selftest.sh
scripts/run-ui-gif-audit.sh
scripts/run-doc-entity-audit.sh
scripts/run-agent-instructions-budget.sh
scripts/run-skill-audit.sh
```

Requirements: a C++17 compiler (`g++`/`clang++`), Node ≥18 and Python ≥3.11; polling and accessory
production-unit fixtures additionally use C++20. The mock runner uses
CMake/CTest when available and otherwise directly compiles the test translation unit. Coverage needs
`gcov` for GCC or `llvm-cov gcov` for Clang, using `xcrun` on macOS. The browser runner additionally
needs Docker. It builds the digest-pinned Playwright image and exact locked API package under
`tools/browser/`, includes a source snapshot in the image, then runs headless Chromium and WebKit
offline with a read-only filesystem. The image includes GCC 13 for the vendored locale compressor.
It never
starts the installed macOS Chrome/Chromium app, even through `DAIKIN_BROWSER_BIN`. Full formatting needs exact clang-format 18.1.8 through
`CLANG_FORMAT`. Agent tools select Python through `scripts/agent-python.sh`; `AGENT_PYTHON` is a
checked installed-interpreter override.

A missing required tool is an unverified layer. The format runner may omit the pinned formatter
locally when no executable is selected; CI requires it. A missing Docker daemon or browser image is
a browser setup failure, not permission to start a native macOS browser. Report either limitation rather
than treating the skipped layer as tested.

CI keeps fast checks as steps of one `mechanical_gates` job in
[build.yml](../.github/workflows/build.yml). The required `build` check consumes that result before
conditionally compiling the firmware. The separate protected-base `pr-policy.yml` owns required
review evidence. CI may select mutation selftests by their inputs and run browser rendering only for
relevant changes; that optimization does not reduce the local contributor obligations above.

## Logic, coverage and hostile inputs

`scripts/run-mock-tests.sh` compiles [test_logic.cpp](test_logic.cpp) with
`-std=c++17 -Wall -Wextra -Werror`, runs its `CHECK` assertions and finishes with presenter parity.
Use the plain form for a quick iteration and `--coverage` for acceptance.

Coverage has two independent requirements:

- At least **95% aggregate executable-line coverage** in production `main/logic/` headers.
  Generated profiles, the test driver and system headers are excluded.
- Each branch-bearing header must meet its committed aggregate gcov **taken/total branch-edge
  count** ratchet for the selected execution profile in
  [branch_baseline.json](../tools/coverage/branch_baseline.json).

Local profiles bind compiler family and major: Apple Clang 17 on Darwin, GCC 13 on Ubuntu 24.04
and GCC 15 on Ubuntu 26. Authoritative GitHub profiles additionally bind the
hosted runner OS/image, because packaging can change instrumented outcome counts. Missing baselines,
unknown runner images and malformed/empty reports fail closed. Equal edge counts do not identify
which individual edges ran; the ratchet is count evidence, not branch-identity evidence. Raising
coverage does not establish that a physical measurement or requirement is correct.
The gate checks report inventory, the line floor and branch-count ratchets; it does not require
every production path to run. `tools/coverage/selftest.sh` rejects empty reports, low coverage,
missing baselines and regressed edge counts.

`scripts/check-presenter-parity.sh` can run independently. It compares the browser's production
leaving-water, post-BUH, COP-scope and held-outdoor rules with the C++ policy headers over the real
catalog, and checks non-exempt schematic patterns for at most one qualified row per profile, with
documented exceptions. Browser-only policies
cannot be proven by testing only their C++ reference. A binding made
unreachable fails instead of producing an empty comparison. Ordinary presenter and entity-ID
audits freshly compile the current C++ inputs. `--golden`/`--binary` reuse is limited to fresh
selftest mutations after the pristine fixture passes; `scripts/run-host-audit-reuse-tests.sh` proves
that changed/removed inputs, preserved timestamps and a changed compiler cannot reuse stale output.

`scripts/run-sanitizer-fuzz-tests.sh` runs deterministic malformed-frame, JSON, URL and numerical-
boundary properties from [logic_property_tests.cpp](../tools/fuzz/logic_property_tests.cpp). It probes
ASan+UBSan compilation and runtime. CI requires both probes and the instrumented corpus to pass;
locally it falls back to UBSan only when the ASan probe fails. The capability smoke check compiles
and starts an instrumented binary; it does not independently prove detection of an injected memory
fault. This is a bounded reproducible hostile-input corpus, with no claim of open-ended random fuzzing.

## Runtime scenarios and target boundaries

`scripts/run-runtime-integration-tests.sh` runs thirteen cases from [runtime/](runtime/):
ten adapter scenarios use selected production headers through simulated storage, clocks, transports
and brokers; three use real POSIX `socketpair`/`recv`. Exception catches, periodic tasks, X10A
transport, MQTT retain/LWT and the socket watchdog are modeled orchestration. Header/body trickles
must be aborted at their absolute deadline with `shutdown(SHUT_RDWR)` joined before descriptor reuse.
The production body-discard helper must settle a leftover body within its byte cap/budget or close
the connection.

Configuration cases assert RAM, durable entries and result together. X10A saves never write `cfg`.
The fake NVS models pinned IDF's write-through `nvs_set_blob`: a failed set preserves the old value,
and `nvs_commit` is a no-op. An allocation witness pauses fake bookkeeping and requires zero
calling-thread `operator new` allocations after the transaction's first durable write.
Six mutation flags change fake behavior or harness call sites: NVS atomicity, late allocation,
header/body watchdogs, discard deadline and Weather body completion. The Weather flag bypasses
`http_body_complete()` at its call site. Named failing assertions verify these modeled controls;
they do not prove that corresponding firmware `.cpp` regressions would be caught. This generic
harness does not compile production HTTP/MCP, X10A, MQTT or Weather glue; the separate complete-unit
fixtures below add production orchestration coverage within their stated adapter boundaries.

The same runner also executes complete production units through SDK/service adapters:

| Harness | Runtime evidence and limits |
|---|---|
| `node test/test_ota_runtime.mjs` | Complete `ota_update.cpp`: 86 cases covering feed transfers, dev-only direct upload, boot-time lwIP readiness, exact image identity, failure cleanup, async completion, static worker ownership and 90/600-second health transitions. Source mutations exercise these boundaries. SDK network, flash and cryptography remain adapters; target memory, reboot and rollback require separate acceptance. |
| `node test/test_network_runtime.mjs` | Complete WiFi/syslog units: 19 scenarios and 22 mutations cover leases, boot wakes, rollback, scan errors, queue loss, reentrant logging, static status-mutex ownership, independent OOM episodes and RFC 5424 framing; no real DHCP/radio/UDP delivery or collector retention. |
| `node test/test_src_runtime.mjs` | Complete ENV III/Weather units and source mutations cover probe identity/CRC, partial I2C allocation/cleanup, OOM, sensor freshness/recovery, forecast conversion/units, HTTP bounds/cleanup, rejected-response retention, A→B→A and zero Config-copy/request-buffer retention at network release and task waits. Default cJSON is an AST adapter; no real sensor, TLS, scheduler or JSON lexer runs. |
| `python3 test/poll_runtime/run.py` | Complete polling/converter units: OOM/RAII, detection corroboration and generation, saturation freshness, late probe ownership including ticket wrap, and successful raw-capture budget. Named compiling source mutations bind each invariant; UART, clocks and RTOS are adapters. [Limits](poll_runtime/README.md). |
| `python3 test/checkup_runtime/run.py` | Complete diagnosis adapter: independent heater clocks, fault completeness, source freshness, consent/source/circulation barriers and producerless expiry. Compiling consent mutants reject a lost or late epoch; clocks, SDK and service ports are modeled, not physical flash or scheduling. [Limits](checkup_runtime/README.md). |
| `python3 test/startup_runtime/run.py` | Complete LED/button units and the production stack sampler: startup/loop failures, null and byte semantics, independent owner slots, boot minima across recreation, the released-at-boot gate and factory-reset completion, seed and incomplete paths; GPIO/RMT and scheduling are adapters. |
| `python3 test/mqtt_retirement_store/run.py` | Complete retirement NVS adapter: fixed wire/CRC record, bounded reload, unchanged output on failure, checked saves and write-through commit failures, factory-reset forget and saves refused behind the reset latch. Synthetic NVS does not prove real reboot or power-loss restoration. |
| `node test/test_uart_runtime.mjs` | Complete `hp_comm.cpp`: 22 cases and 14 named mutations distinguish local SDK errors from device silence, retain partial bytes, detection/probe mappings and legacy results, and preserve I/S framing, deadlines and single-request behavior. SDK/clock adapters do not prove electrical behavior or explain historical NoReply events. |
| `node test/test_detect_runtime.mjs` | Complete detector with real profile registry and pin rules: reserved candidates, local failures, bounded retries, capacities and ambiguous membership. Synthetic frames do not establish physical Protocol S or electrical behavior. [Limits](detect_runtime/README.md). |
| `node test/test_http_server_runtime.mjs` | Complete common/startup/MCP units: registration, request policy, incoming receive budgets and framing, protocol/error dispatch and real socket fragments. Other service handlers and shared status/value serializers are adapters. [Limits](http_server_runtime/README.md). |
| `node test/test_http_deadline_runtime.mjs` | Complete outgoing deadline watchdog: priming/admission, expiry/shutdown acknowledgement and descriptor reuse. SDK scheduling and physical TLS interruption remain separate. [Limits](http_deadline_runtime/README.md). |
| `node test/test_http_stream_runtime.mjs` | Complete common/status/dwell units: independent JSON/UTF-8 oracles, all observed allocation/chunk failure points, next-request recovery and cache-bound dwell snapshots. SDK/source providers are adapters. [Limits](http_stream_runtime/README.md). |
| `node test/test_http_ota_runtime.mjs` | Actual HTTP OTA handlers: dev/SHA query checks, async refusal, copied binary ingress and completion responses. HTTP/OTA SDK boundaries are adapters; no target upload, signing, flash or reboot is exercised. |

After the pinned IDF build resolves `espressif/cjson` from `dependencies.lock`, run
`node test/test_src_runtime.mjs --real-cjson managed_components/espressif__cjson/cJSON` for the same
Weather unit/cases/mutations with the real lexer plus malformed, embedded-NUL and overflow documents.
This optional layer downloads nothing and prints the bound source hashes; HTTP/TLS remain adapted.
Weather lifetime checks use synthetic public topic/name fields and a fixed allocation table, excluding
SDK bookkeeping. Tagged host C++ counts prove scoped release, not ESP heap fragmentation or C/TLS allocations.

After resolving the pinned cJSON component, run `python3 test/json_ingress_runtime/run.py
--real-cjson managed_components/espressif__cjson/cJSON` and `python3 test/mqtt_runtime/run.py
--real-cjson managed_components/espressif__cjson/cJSON`. `ci-build-all.sh` runs both after the target
build. The first executes the real HTTP parser adapter's object/depth/size/trailing/OOM corpus and
its root-type mutation. The second executes complete MQTT source consumers and task recovery,
including accepted subscription cleanup ownership, rejected retirement, shared owners and SDK
callback sampling with semantic removal controls. HTTP routes, broker/TLS,
RTOS and physical inputs remain outside these host adapters. Each runner binds compile inputs and
uses its own temporary directory; polling/startup support `--sanitizer undefined`, MQTT `--ubsan`.

The same build also runs `python3 test/query_http_runtime/run.py` with resolved cJSON. It invokes
the actual `/hp/query` handler for strict numeric fields, defaults, status/frame/decode output and
bounded serialization, with named compiling mutations. HTTP transport and UART handoff are adapters;
the shared HTTP exception trampoline and real devices remain outside its [scope](query_http_runtime/README.md).

After dependency resolution, the target-build entry point also runs the complete
`python3 test/http_config_runtime/run.py` matrix with its default compiler and again with
`CC=clang-18 CXX=clang++-18` and `--sanitizer undefined`, using the resolved cJSON source in both runs.
This complete configuration/OTA HTTP fixture exercises every setter, exact field types, write
failure replies, missing values and query flags with real cJSON and CFG-03's transaction. It also
checks all request scratch limits, allocation-failure propagation and release on parse/read errors. SDK/NVS
effects remain recording adapters; [the matrix](http_config_runtime/README.md) explains the GCC
constexpr workaround, preserved assertions, sanitizer tripwire and evidence limits.
Locally, `node test/test_http_config_runtime.mjs` invokes the same runner after dependencies exist.

The contract runner executes additional compiled production consumers:

| Contract | Scope |
|---|---|
| `test_modbus_runtime_contract.mjs` | Complete `hp_modbus.cpp`, real POSIX transport and SDK/task adapters: 31 cases and 30 targeted controls for parsing, polling, expiry, target cutover, retirement, 32/42-row profile ownership, native enums and automatic native promotion. [Evidence limits](modbus_runtime/README.md) include modeled scheduler/config/history and no physical HomeHub/NVS proof. |
| `test_modbus_metadata_contract.mjs` | Current HTTP/MCP serializer and MQTT snapshot consumer: 16 cases and 10 controls for snapshot-owned row definitions, raw numeric enums/text, native keys/labels, quiet-selection exclusion from activity metadata and bounded exact flat-JSON reservation. Physical native Altherma 4 scaling/acceptance remains pending. |

`scripts/run-contract-tests.sh` discovers every `test/test_*_contract.mjs`, refusing an empty set,
then runs the public-readiness audit. Source assertions pin target ownership, sequencing and
forbidden paths; some contracts also execute the compiled units above. Keep those evidence types
distinct. The broad adapter harness does not execute complete HTTP/MQTT/MCP stacks or real NVS.
Target compilation uses `scripts/idf-docker.sh idf.py build`; hardware acceptance needs authorization.

Important target boundaries covered by source contracts include:

| Surface | Contract |
|---|---|
| Config/JSON ingress | Revision refusal before copying/writing, staged blobs, link-only X10A save, reconfigure only after saved results; actual body byte counts, depth-16 single-document cJSON/Weather preflight and bounded room-source body |
| Recovery/history | Early crash guard/static NVS lock, no automatic NVS erase, conditional WiFi-driver NVS; per-raster age guards, boot liveness/seals and adopted-tail journal safety |
| Checkup restart | Dated compatible journal records require clock/current-source confirmation and matching consumer schema/method; RAM hours retire, scoped DHW handoff and exact slot expiry remain separate |
| Deployment helpers | Production `{values:[...]}` envelope; malformed/held values, missing MQTT evidence, stale ages, invalid heap, non-200 and curl failures reject synthetic endpoints |
| Signed OTA | Stable 56/24 KiB INTERNAL handshake gates and separate 24/12 KiB gates for both verifier passes; TLS cleanup before validation, static task storage, deadline and quiescence orchestration |

OTA delivery tests use fixtures only. Bench pressure begins while rollback is pending, within
120 seconds of boot, for the unchanged 180-second window. Bounded confirmation then requires valid
state, rollback disarmed, the same version/ELF/MAC and monotonic uptime/counters. Production fixtures
retain exact artifact/generation binding, one un-retried write, release exercise, dev restore,
completed verification and read-only X10A/Weather/MQTT canaries. Weather uses the 48/20 KiB admission
floor; a retained exact headroom refusal permits only its bounded causal recovery path after workers
stop. Private atomic receipts preserve completed stages and ambiguous write attempts; public
projections exclude device identity/complete status. Their mutations must fail even when a candidate
subsequently boots. `scripts/trigger-ota-wait.sh` fixtures allow GET-only observation of an accepted
update and reject obsolete write options. None of these proves a device update, rollback or cold cycle.

## Catalog, documentation and privacy gates

| Runner | What it verifies and what still needs review |
|---|---|
| `run-domain-audit.sh` | Real converters over the real catalog: specification, unit, byte-layout, outlier and identifier checks with decode witnesses; physical meaning still needs source/device evidence |
| `run-esp-idf-matrix-audit.sh` | Explicit components, dependencies, active defaults, application IDF headers and reviewed native/manual boundaries against `ESP_IDF_MATRIX.md`; upstream alternatives remain curated |
| `run-description-audit.sh` | Every published base/native row resolves through the actual table or profile-qualified `descFor`/English path; D008 catches shadowed native semantics, D009 unreachable native help; meaning still needs human review |
| `run-user-docs-audit.sh` | English maintained Markdown, bounded diagnosis prose and source-current guide contract; wording and information structure still require reading |
| `run-diagnostic-evidence-audit.sh` | Visible diagnosis entries retain primary sources, exact rules, claim limits and current source fingerprint; relevance and interpretation need domain review |
| `run-doc-entity-audit.sh` | Copyable Home Assistant entity IDs resolve through the real slug rule against detectable profiles; documented model alternatives remain necessary |
| `run-redaction-audit.sh` | Wrapped status fields and identifying diagnostic lines remain covered; a newly identifying unwrapped field still needs privacy review |
| `run-pr-hygiene-audit.sh` | Exact commit range and available PR text are scanned for personal/credential shapes and high-confidence German; names, contextual addresses and other non-English prose need human review |
| `run-agent-instructions-budget.sh` | Canonical/generated registration budgets, inventory, reviewer safety, hook/credential dispatch and invariants; missing inputs and ignored `AGENTS.override.md` fail |
| `run-skill-audit.sh` | Canonical skills/reviewers against repository paths, partition/route/wiring facts; source correctness does not prove native runtime dispatch |
| `run-agentic-setup-audit.sh` | Fast pre-push source/configuration and skill check; no model, network, build or extra review record. Runtime registration and execution remain separate |

All names in the table are under `scripts/`. Audits fail on defects; the appropriate skill supplies
judgment where a mechanical match cannot. Review records must refer to the current PR head.

Adjudication ledgers store only justified exceptions. Domain exceptions distinguish evidence-backed
`ADJUDICATED` cases from temporary `KNOWN-DEFECT` entries. Description coverage refuses suppression
of D001 missing explainers or D009 unreachable native help. The redaction ledger must not contain
the private value it protects. PR-hygiene findings use a SHA-256 line fingerprint rather than printing the flagged text;
false-positive entries likewise store fingerprints and reasons.

Source stamps record a completed review, not an alternative to it. For a changed diagnosis guide,
review and correct the prose before using `scripts/run-user-docs-audit.sh --update`. The diagnostic
and localization workflows follow the same principle. Never clear a red result by changing a stamp
without the corresponding evidence.

## UI interaction, rendering and recording

`scripts/run-ui-use-case-tests.sh` executes every `test_ui_*.mjs` plus HomeHub discovery, the MCP
setup-page contract and the UI mutation selftest. Its deterministic DOM harness executes production
`wire()` and requires a case for every routed/transient modal. It covers navigation/reload/Back/
Forward, open/Cancel/backdrop/Escape, valid and invalid submissions, server rejection, board-gated
ENV III, bug-report steps and generation-bound OTA confirmation. The transient OTA modal must not
become a bookmarkable stale offer.

The source reader validates [app.sources](../main/www/app.sources): local, present, unique ordered
fragments that parse as one classic script. Firmware, audits, DOM tests, browser assembly and GIF
recording consume that same concatenation. Focused UI cases cover live language changes, connection
failure copy, source precedence, binary/enum meanings, board/pin selection, diagnosis limitations,
OTA reload adoption and stable narrow-row interaction.

| Runner | Scope |
|---|---|
| `run-ui-localization-audit.sh` | All shipped locale keys, types, function arities, specialist tables, language selection and asset budgets; canonical-copy changes invalidate stale translations |
| `run-schematic-audit.sh` | Real SVG IDs/targets/translations, geometry, pill attribution, rotors, text fit, branch/tap boundaries and source bindings |
| `run-browser-render-tests.sh` | Pinned headless Linux container: Chromium at 320/1200 px for static locale/accessibility/interaction and temporal checks; WebKit in both iPad orientations for full-history touch, polling and painted-motion checks |
| `run-ui-gif-audit.sh` | Recording fingerprint, frame/timing and GIF/stamp currency; stale or unverifiable footage blocks merge |

Localization binds the complete key catalog across thirteen languages, each locale's 32 KiB gzip cap and
the 283 KiB aggregate guard. Native Altherma 4 limits remain visible in standalone, paired and
replacement readings, including unchanged values with changed definition metadata. The browser
matrix performs 390 value disclosures and 104 schematic-inspector pointer clicks across locales and
both widths; unverified flow/pressure conversions cannot emit numeric agreement/difference.

`test_ui_history_sources.mjs` covers source epochs, pins/cache leases, disable/re-enable, A → B → A,
changed X10A identity, boot IDs with lower or higher uptime, and delayed raw/derived replies.
Settings regressions preserve absent timestamps, literal `$`, backslashes and mapping whitespace
through 641-character escaped fields and unchanged-save eligibility gates.

The browser gate uses a local fixture server, not device HTTP. Mechanical geometry cannot establish
that the pictured sensor belongs to the right component, and accessibility assertions do not replace
a real click-through. [DESIGN.md](../docs/DESIGN.md) owns the observable UI contract; the applicable
review skills cover visual truth and complete interaction.

The temporal matrix inventories every production inspector and the four disclosure families. It
uses full 288-sample source rings and three real two-second updates per case, checking unchanged
plot/prose nodes, continuous chart ancestry during scalar updates, CSS animations, collapsed-chart
work and native input delivery. The
fixed maximum frame gap and individual native key-event roundtrip are 250 ms; these fixture budgets catch recurring stalls,
not guarantee a frame rate on every device. Negative controls reintroduce hidden-chart work, plot or
animation replacement and a blocking poll. Static locale snapshots, reduced-motion cases and GIF
poses remain separate evidence.
Native open/pin actions, viewport positioning and one programmatic focus settle before the polling
baseline. Each disclosure toggle confirms its own state, mounted revision and finished expansion
before the next native target is measured. Each first opening renews its existing source caches
through real history requests and
waits for the matching mounted revision. A separate natural-poll case covers the regular 60-second
cache expiry, generation change and permitted plot replacement before checking unchanged continuity.
The plot must be visible; schematic witnesses share its vertical viewport whenever they
fit, with actual geometry recorded separately from animation clocks. Focus setup is also recorded
separately. No frame from the first or subsequent measured poll is discarded.

The WebKit phase reuses this complete temporal matrix at 834×1194 and 1194×834 CSS pixels with the
pinned iPad Pro 11 device descriptor, touch/mobile behavior and trusted native taps, including plot
pin/unpin and cached reopen. Its orientations run consecutively, each with a foreground browser;
Chromium retains parallel viewport workers with native focus emulation. Its normal full gate runs
infrastructure checks first, then holds both workers at an IPC barrier after their temporal matrices
finish and clean up. Only then do the locale/interaction cases overlap one serial browser-control
worker; no positive latency window competes with those controls. All three workers must succeed.
Focused and serial invocations keep their existing order. A tight flow-stroke screenshot sequence under real polling verifies
paint movement outside the latency sampling; a ninth canary freezes painted dash movement while
its CSS animation clock continues. All eight shared temporal canaries must also fail for their intended
assertions in WebKit. Linux headless WebKit is Safari-engine regression coverage; it does not prove
physical iPad Safari, iPadOS or GPU performance.

`DAIKIN_BROWSER_TIMEOUT_MS` bounds each engine phase separately (default 600000 ms, maximum 3600000 ms).
The original Chromium deadline is unchanged; WebKit runs as a separate phase in the same CI job.
Chromium launch shares one absolute deadline across endpoint headers/body, socket and initialization;
worker/browser process groups are joined before the temporary page is removed.
The container runs as fixed unprivileged UID/GID 1000, with no external network or host browser
profile; only its own temporary storage is writable. Its snapshot includes the allowlisted current
browser inputs and excludes ignored files, Git metadata, builds, symlinks and credential/artifact
filenames before reading them. Container-start
and runner selftests verify fail-closed setup, status propagation, interruption and refusal of native
macOS browser discovery. A random name and independent ownership label are reserved before launch;
cleanup verifies both before removing a container whose CID reply was lost. If removal cannot be
verified, including a possibly in-flight creation without a CID, the gate fails and retains its
ownership record and source snapshot.
The snapshot is sent through the image-build context; runtime needs no host-directory mounts,
including on Colima installations that do not share macOS temporary directories.
Docker's local image/build cache retains that allowlisted source snapshot until normal cache cleanup.

The source-absence matrix is part of the contract and UI globs. It independently removes the broker,
room source, circulation witness, HomeHub, ENV III, weather and X10A, and includes safe mode. A missing
input must remain absent/stale rather than becoming zero, current or a blocker attributed to another
source. `tools/absence/selftest.sh` seeds failures in both halves.

The dashboard GIF records the actual drawing with the device stubbed. Rerecord locally through
`scripts/record-dashboard-gif.sh` using Chrome and ffmpeg, inspect the result and run the GIF audit.
A source change cannot earn a new stamp with old GIF bytes; the explicit identical-GIF exception is
only for a real rerecord that reproduced identical encoding. Settings-only edits need no rerecord
when the fingerprinted drawing is unchanged. The audit proves currency, not a good capture: inspect
framing, every operating scene and transitions, and complete the current-head `$ui-gif` review when
the GIF/stamp changed.

## Checker changes and mutation selftests

A checker must reject its negative controls. Run the relevant selftest whenever its checker,
classification or inputs change; ordinary passing fixtures alone are insufficient.

| Surface | Selftest |
|---|---|
| Coverage, formatting, presenter parity | `tools/coverage/selftest.sh`, `tools/format/selftest.sh`, `tools/presenter/selftest.sh` |
| ESP-IDF matrix and catalog domain | `tools/esp_idf_matrix/selftest.sh`, `tools/domain/selftest.sh` |
| Descriptions, user docs and diagnosis evidence | `tools/descriptions/selftest.sh`, `tools/user_docs/selftest.sh`, `tools/diagnostic_evidence/selftest.sh` |
| Schematic, absence and localization | `tools/schematic/selftest.sh`, `tools/absence/selftest.sh`, `node tools/ui_localization/selftest.mjs` |
| UI interactions and real-browser gate | `tools/ui/selftest.sh`; `tools/browser/selftest.mjs` runs inside `scripts/run-browser-render-tests.sh` with its assembled page and detected browser |
| Redaction, doc entity IDs and PR hygiene | `tools/redact/selftest.sh`, `tools/docs/selftest.sh`, `tools/pr_hygiene/selftest.sh` |
| GIF recording | `tools/uigif/selftest.sh` |
| OTA source and delivery orchestration | `node tools/ota/selftest.mjs`, `node tools/production_ota/selftest.mjs` (separate scoped CI step) |
| Agent instructions, skills, hooks and review policy | `tools/agent-config/selftest.sh`, `tools/skill_audit/selftest.sh`, `tools/agent-hooks/selftest.sh`, `tools/agent-policy/selftest.sh` |

Policy canaries allow only the documented repository-bound expected-head squash-merge REST form;
they reject alternate CLI/API/MCP mutation forms and stale records. They exercise throwaway context,
not an actual merge. The credential-wrapper canaries separately bind authorized PR publication to
the fixed repository, already-pushed checked-out `agent/*` head and regular body file.

For publication/installer/version/CI-trust changes, also run:

```bash
scripts/run-pages-publish-tests.sh
scripts/run-web-installer-plan-tests.sh
scripts/run-publish-version-tests.sh
scripts/run-ci-release-contract-tests.sh
scripts/run-build-change-detection-tests.sh
```

These use temporary fixtures for concurrent Pages publishers, NVS-safe erase ranges, path validation,
version ordering and signing/publishing trust. A local bare feed proves equal-version publication
preserves the manifest, inventory, changelog and indexed images byte-for-byte: preflight source/version
agreement alone cannot admit a newly signed replacement. Main change-detection fixtures bind completed
publication/readback proof; missing, expired, incompatible or unavailable evidence requires a build.
CI event/cleanup fixtures execute production classifiers and privileged cleanup shell against offline
API replies, including an upload finishing after close, fork association and failed pagination.
Unknown association stops deletion.

For decoder changes run `scripts/run-decode-coredump-tests.sh` (outer archive/cleanup/subprocess
handoff) and `scripts/run-decode-coredump-integration-tests.sh` (actual pinned SDK loader/GDB with tiny
synthetic Xtensa ELF/core fixtures in container-local temporary storage). Matching symbols, missing/
empty/short/nonhex/duplicate or wrong identities, malformed descriptors, version/integrity errors and
failed/interrupted cleanup are controls. No board or real RAM dump is involved; this does not prove
flash capture, download, incident age or hardware unwinding. CI adds a scoped shared-job step and
main-push backstop. Changelog generation uses
`python3 scripts/generate-ota-changelog.py --self-test`; neither path needs a private signing key.

The format gate also verifies the reviewed `.clang-format` SHA-256 binding before changed-line
selection; its negative control rejects style-file-only attempts to disable formatting.

## Covered

Find exact cases in [test_logic.cpp](test_logic.cpp), source-boundary tests, the focused `test_ui_*`
files and each production header's comments. The main concerns are:

| Concern | Representative assertions |
|---|---|
| Wire decoding and detection | CRC/framing, signed/scaled values, bounded extraction, register layout, page fingerprints, order-independent ties and stable IDs |
| Configuration and hardware | Field-owned atomic commits, failed persistence, safe/reserved GPIOs, explicit presets, source deletion and consent generations |
| Source truth | Availability/held rules, separate instruments, stale/retained input, working-point eligibility and bounded diagnosis evidence |
| MQTT/Home Assistant | Typed payloads, injective identities, reconnect/availability, ACK-bound retained cleanup and private-data redaction |
| HTTP/MCP/OTA | Host/origin/media-type boundaries, bounded bodies/chunks, OOM stages, read-only tools, versions/URLs/leases and deadline/heap policies |
| History and recovery | Gaps versus held values, instant-bound pins, compatible restore, torn-write rejection, reset classification and bounded recovery |

A frozen identifier set catches renaming/reassignment; a detection tie test catches a different
representative choice; an end-to-end decode witness catches the wrong quantity. Use the control that
can detect the proposed failure rather than assuming any one of these covers the others.

## Adding a test

1. Put the production rule in an IDF-free `main/logic/*.hpp`. The target `.cpp` calls it; no second
   implementation exists just for tests.
2. Add a focused function in `test_logic.cpp`, call it from the driver and assert a known-good
   result. For converters use independently established wire bytes/output; for framing use the
   protocol or a captured frame. Include the relevant missing, malformed or boundary case.
3. Run the mock suite and coverage. Add a source contract when correct target sequencing/ownership
   is part of the requirement; add a UI case when the browser makes or presents the decision.
4. If changing a checker, seed a mutation that violates the requirement and prove that it fails.

For example, the X10A-I request bytes `03 40 60` have checksum `5c`. A direct golden assertion is:

```cpp
const uint8_t request_prefix[] = {0x03, 0x40, 0x60};
CHECK(crc(request_prefix, sizeof request_prefix) == 0x5c);
```

This expected byte is fixed independently of the checksum expression. A test that computes its
expected value by calling the same implementation cannot catch a defect in that implementation.
The [add-logic-test skill](../.agents/skills/add-logic-test/SKILL.md) describes the contributor pattern.
