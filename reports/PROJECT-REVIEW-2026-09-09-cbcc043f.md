# Comprehensive project review: daikin-altherma-esp32

**Completed:** 2026-09-09, Europe/Berlin. **Review window:** 2026-09-08 through 2026-09-09.

**Reviewed commit:** `cbcc043f0ea35c70b90c86958fa8000166077ed7`; its source tree is identical
to the public-main integration commit `d5fc344a191861ea3979635ad883fb0fc019a4c6`.
**Current-main disposition checked against:** `2e8cfc0a32ccc295ae0dd69bfde2ebc312cb3164`.
**Scope:** the complete local project at that commit, with focused review of X10A/HomeHub decoding,
HTTP/MCP, MQTT, OTA, heap and configuration safety, documentation, and test coverage.

## Executive result

All existing local tests and mechanical audits passed, and the firmware compiled successfully for
ESP32-S3 with the CI-pinned ESP-IDF v6.0.2 image. Manual review and focused failure-injection
reproductions nevertheless found **11 issues: 3 high, 6 medium, and 2 low priority** at the reviewed
baseline.

The highest-priority problems are a model-family change after lost X10A fingerprint replies, an
unsafe unsigned-image path in the build/flash documentation, and an HTTP/TLS resource leak on an
out-of-memory path. The review also found a persisted-versus-runtime configuration split, an X10A
request/reply binding gap, a permanent MQTT outage after one failed client promotion, two further
OOM cleanup failures, one unresolved Hybrid register-layout contradiction, and two documentation
drifts.

The reviewed firmware baseline should therefore not be represented as defect-free. Subsequent main
commits independently corrected F03, F04, F05, F08, and F10. At the disposition commit above,
**six findings remain open: 2 high, 3 medium, and 1 low priority**. This report change itself does
not modify firmware behavior; the open findings need separate corrections and their applicable
review gates before delivery.

Priority means:

- **P1 / high:** fix before the next firmware delivery.
- **P2 / medium:** a concrete failure path that needs a targeted fix and regression coverage.
- **P3 / low:** correct the documented contract.

The ranking reflects technical impact. Real-device occurrence rates were not measured.

| ID | Priority | Finding | Status at `2e8cfc0a` | Evidence |
|---|---|---|---|---|
| F01 | P1 | A missing fingerprint page can identify a monobloc as a ground-source unit | **Open** | Real profile tables and detection logic executed on the host |
| F02 | P1 | The source-build guide leads directly to flashing an unsigned application | **Open** | Fresh build plus the repository's signature guard |
| F03 | P1 | Weather download leaks the HTTP/TLS client when C++ allocation fails | **Resolved by #50** | Production function executed with simulated I/O and allocation failure |
| F04 | P2 | Configuration save can persist new flash data while reporting failure and retaining old RAM state | **Resolved by #50** | Production function and real blob codecs with simulated NVS |
| F05 | P2 | X10A accepts a CRC-valid reply for a different requested page | **Resolved by #14** | Production transport and formatter with simulated UART |
| F06 | P2 | One failed MQTT client promotion disables MQTT until reboot | **Open** | Complete source control flow |
| F07 | P2 | The OTA OOM catch handler can throw again across the FreeRTOS task boundary | **Open** | Production task/catch with simulated allocation failure |
| F08 | P2 | Raw cJSON roots leak when a later C++ operation throws | **Resolved by #94** | Concrete HTTP and weather-parser control flows |
| F09 | P2 | The Hybrid mode converter contradicts the project's own packed register layout | **Open** | Real converters with combined bit values; correct field boundary still unknown |
| F10 | P3 | MQTT base topic is incorrectly documented as compile-time-only | **Resolved by #49** | Documentation compared with HTTP/NVS/MQTT implementation |
| F11 | P3 | MCP documentation states a stricter Host requirement than the implementation | **Open** | Documentation compared with shared HTTP policy |

The closed status is based on direct current-source inspection: Weather now stages response
capacity before opening TLS and immediately installs a cleanup owner; configuration stages both
serialized blobs and a non-throwing RAM successor before NVS; Protocol I classifies a wrong opcode
or page echo as `UnexpectedReply`; HTTP and forecast JSON roots have RAII owners; and the feature
table now documents the MQTT base-topic NVS override. Those later changes were not used as oracles
for the original reproductions.

## Findings

### F01 — A lost fingerprint page can commit the wrong model family

**Current status:** open at `2e8cfc0a`.

**Relevant code:** [`main/hp_detect.cpp`](../main/hp_detect.cpp),
[`main/hp_poll.cpp`](../main/hp_poll.cpp), [`main/logic/detect.hpp`](../main/logic/detect.hpp), and
[`test/test_logic.cpp`](../test/test_logic.cpp).

The detection transport collapses timeout, NAK, and CRC failures into an absent fingerprint page.
If a page still does not answer after three attempts, its bit is absent. A second complete detection
sweep is required only when no profile matches. If the reduced page set matches a different
profile, that profile is committed immediately.

Running the real signatures and selection logic for an 8.0 kW fingerprint produces:

| Page mask | Selected profile |
|---|---|
| `0x1bff` | `altherma_ebla_edla_d_series_4_8kw_monobloc` |
| `0x13ff` — page `0xA0` missing | `altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3` |
| `0x0bff` — page `0xA1` missing | `altherma_egsah_x_ewsah_x_d_series_6_10kw_geo3` |

These are not register-equivalent labels. At page `0x20`, offset 8, the monobloc profile publishes
“Heat exchanger mid-temp.” while Geo3 publishes “Entering brine temp.(R5T)”. A plausible numeric
temperature is therefore assigned a different physical meaning, and the selected identity can also
change history scope.

**Trigger and limit:** all three attempts for a consequential page must fail during detection. The
selection was reproduced with the production tables; bus loss was not injected on real hardware.

**Recommended fix:** distinguish confirmed page rejection from transport corruption or timeout. A
transport-incomplete fingerprint must be confirmed before any model-family change, even when the
candidate set is non-empty. Add the exact monobloc-to-Geo3 cases above as regression tests. Existing
tests count profile changes after a lost page but enforce confirmation only for the no-match case.

### F02 — The local flash guide omits mandatory image signing

**Current status:** open at `2e8cfc0a`.

**Relevant sources:** [`docs/README.md`](../docs/README.md),
[`sdkconfig.defaults`](../sdkconfig.defaults), [`CONTRIBUTING.md`](../CONTRIBUTING.md), and
[`scripts/require-signed.sh`](../scripts/require-signed.sh).

The “Build from source” instructions go directly from `idf.py build` to an `esptool … @flash_args`
command. They do not sign the application or run the mandatory signature guard. The default config
builds an unsigned application but requires signed applications at boot. CONTRIBUTING explains this
correctly elsewhere, but a reader following the concrete build/flash sequence does not encounter
that protection.

The fresh review build reported `App built but not signed`. Running the repository's read-only
signature check against that application returned exit code 1 and refused it as unsigned. This is
the expected behavior of the guard, not a build failure.

**Impact:** following the documented sequence can place an application on the board that fails
before `app_main` and repeatedly reboots. No image was flashed during this review.

**Recommended fix:** split the documentation into compile verification and an explicitly signed
flash workflow. Require the signature check against the exact application referenced by
`flash_args`, and direct contributors without an appropriate key to the documented signed-artifact
path.

### F03 — Weather download leaks its HTTP/TLS client after OOM

**Current status:** resolved by #50 (`0dc07d4d`). The current path reserves the bounded response
before client creation and installs `HttpClientCleanup` immediately after initialization.

**Relevant code:** [`main/weather_forecast.cpp`](../main/weather_forecast.cpp), especially the client
creation, response `reserve`/`append`, regular cleanup, and outer task exception handler.

`download_json()` owns the ESP HTTP client as a raw handle. After the connection opens,
`out.reserve()` and `out.append()` may throw. Both close and cleanup calls are located only at the
regular end of the function, so stack unwinding skips them. The outer task catch records an error
but has no access to the leaked client. `NetworkActivity` clears the activity flag; it does not own
the TLS resources.

The production function was extracted unchanged and executed with simulated HTTP and an allocation
failure after a successful open:

```text
weather opened=1 closed=0 cleaned=0
```

**Impact:** transient memory pressure leaves HTTP/TLS/socket resources allocated and can amplify
the pressure on later retries. The number of leaked bytes and any resulting watchdog reset were not
measured on hardware. Only configurations with weather collection enabled reach this path.

**Recommended fix:** place the client in a non-throwing RAII owner immediately after initialization.
Move fallible response-buffer preparation before the TLS connection where practical, or keep the
processing bounded. Inject failures at both `reserve` and later `append` sites and assert cleanup.

### F04 — A failed save can leave flash and runtime configuration inconsistent

**Current status:** resolved by #50 (`0dc07d4d`). The current save path stages both blobs and the
complete RAM successor before its first NVS write, then publishes through nothrow move assignment.

**Relevant code:** [`main/config.cpp`](../main/config.cpp), [`main/http_common.cpp`](../main/http_common.cpp),
and the save contract in [`main/www/js/settings.js`](../main/www/js/settings.js).

`config_save()` commits the new service blob first. It then performs another fallible vector
allocation for the link blob, followed by a complete Config copy in `publish_locked()`. If either
allocation throws, the shared HTTP guard returns 503. The new service blob already exists in flash,
while the live RAM configuration still contains the previous values. The UI contract currently
states that a 503 means nothing was written.

The production save function, real serializer/deserializer, and a simulated NVS backend produced:

```text
fail-after=cfg:  cfg_writes=1 link_writes=0 threw=1 RAM=old FLASH=new
fail-after=link: cfg_writes=1 link_writes=1 threw=1 RAM=old FLASH=new
```

The string values were synthetic. The test proves operation ordering; it does not emulate physical
flash failure modes.

**Impact:** a change reported as failed can appear after a later reboot. Another save made from the
old runtime snapshot can overwrite it again. Single-entry NVS atomicity does not prevent this
cross-step inconsistency.

**Recommended fix:** complete every serialization and the future runtime snapshot before the first
NVS commit. After persistence succeeds, publish with non-throwing move/swap operations only. Test
both failure points and bind persistent state, live state, and HTTP result in one assertion.

### F05 — X10A does not bind a valid reply to the requested page

**Current status:** resolved by #14 (`10aca5dd`). `hp_reply_classify()` now rejects a Protocol I
reply whose opcode or echoed register does not match the request, with host regression coverage.

**Relevant code:** [`main/hp_comm.cpp`](../main/hp_comm.cpp), [`main/hp_poll.cpp`](../main/hp_poll.cpp),
and the reply contract in [`docs/X10A_PROTOCOL.md`](../docs/X10A_PROTOCOL.md).

Protocol I replies are documented as `40 <requested register> LEN … CRC`. `hp_query()` validates
dynamic length and CRC but does not validate the opcode or echoed register. The polling code then
decodes the payload as the page it requested.

In the host reproduction, the unchanged transport requests `0x61`. Only after flush and the new
request, the simulated UART delivers this complete delayed reply for page `0x20`:

```text
40 20 12 6D 00 4D 00 00 00 00 00 00 00 00 00 00 00 00 00 D3
```

The transport accepts all 20 bytes. The real monobloc leaving-water definition and linked production
`hp_format()` then publish **7.7 °C** successfully. Those bytes came from the outdoor-unit page and
are not evidence of a leaving-water temperature. Plausibility checks cannot detect the wrong source.

**Trigger and limit:** a complete previous reply must arrive only after the flush for the next
request. Flush cannot remove bytes that have not arrived yet. Real response timing was not measured.

**Recommended fix:** validate Protocol I opcode, echoed register, and complete header before exposing
the payload. Add transport tests for another register, a wrong opcode, a short header, and a delayed
reply. Keep the structurally different Protocol S validation separate.

### F06 — Failed MQTT publisher promotion is never retried

**Current status:** open at `2e8cfc0a`.

**Relevant code:** [`main/mqtt_ha.cpp`](../main/mqtt_ha.cpp), in the task-local promotion flag and
subscriber-to-publisher transition.

After the first proven X10A response, the code stops and destroys the subscriber-only MQTT client,
then creates a publisher client carrying the installation LWT. If client construction or startup
fails, `s_client` remains null and the task sets `publisher_promotion_failed=true`. That task-local
flag is never reset, so the transition is never attempted again after resources recover.

**Impact:** one transient allocation, task-creation, or client-start failure can remove both MQTT
subscription and publication for the rest of the boot. Automatic reconnect cannot help because no
active client remains. This finding follows the complete control flow; the failure was not injected
against a real broker.

**Recommended fix:** model stop/destroy and create/start as separate states. Once destruction has
completed, retry only creation/start with bounded backoff. Preserve the X10A publish gate and the
single-client heap constraint. Test one failed start followed by resource recovery.

### F07 — The OTA OOM catch handler can allocate and throw again

**Current status:** open at `2e8cfc0a`.

**Relevant code:** [`main/ota_update.cpp`](../main/ota_update.cpp) and
[`main/ota_update.hpp`](../main/ota_update.hpp).

The task catch stores `Out of memory — retry in a moment` in `s_status.message`. That string starts
empty and has no guaranteed reserved capacity. The 34-byte UTF-8 message can therefore require a
second heap allocation while the task is already handling allocation failure. If it also fails, the
second exception escapes the task entry point.

An isolated run of the original task and `set_state`, using a simulated scheduler and continuing
allocation failure, produced:

```text
ota exception_escaped_task=1 busy=1 task_deleted=0
```

**Impact and limit:** the escaped exception can cross the FreeRTOS C boundary into terminate/abort
and reset the device. This is conditional: retained string capacity or memory released during
unwinding will avoid it in many cases. No hardware reset was induced.

**Recommended fix:** make the catch path allocation-free, using a fixed error code, literal pointer,
or fixed buffer. Release the busy state with a non-throwing scope guard. Test failure while recording
the error, not only the original operation failure.

### F08 — Raw cJSON roots leak when later C++ work throws

**Current status:** resolved by #94 (`2e8cfc0a`). HTTP configuration handlers now install
`JsonGuard` immediately after parsing, and the forecast parser uses `JsonCleanup`.

**Relevant code:** [`main/http_config.cpp`](../main/http_config.cpp) and
[`main/weather_forecast.cpp`](../main/weather_forecast.cpp).

`/set_hp` creates a cJSON tree and then copies Config with multiple strings before reaching
`cJSON_Delete`. `/set_mqtt` has the same ownership pattern while copying JSON strings. The weather
parser performs multiple vector reservations between parse and delete. A C++ exception at any of
those sites skips the raw cleanup call.

The central HTTP guard can return 503 but cannot free a root owned by a local variable inside the
handler. This issue is separate from F03 because it affects different allocations and includes HTTP
configuration routes. The source control flow is conclusive; leaked cJSON byte counts were not
measured.

**Recommended fix:** own every root immediately after parse with a RAII pointer whose deleter calls
`cJSON_Delete`. Inject failure at the first later Config/string/vector allocation and assert balanced
allocation/free counts.

### F09 — Hybrid mode contradicts the packed register layout

**Current status:** open at `2e8cfc0a`.

**Relevant sources:** [`main/logic/convert.hpp`](../main/logic/convert.hpp),
[`main/def/altherma_hybrid.hpp`](../main/def/altherma_hybrid.hpp),
[`docs/REGISTERS.md`](../docs/REGISTERS.md), and [`test/test_logic.cpp`](../test/test_logic.cpp).

Converter 316 interprets the complete byte at page `0x64`, offset 2 as a mode index from 0 through 2.
The same byte contains independent Boiler Operation Demand and Boiler DHW Demand bits according to
both the profile and register documentation. The real converters produce:

| Raw byte | Hybrid Op. Mode | Boiler Operation Demand |
|---|---|---|
| `01` | `Hybrid` | `0` |
| `09` | `?` | `1` |

Any asserted demand bit raises the complete byte above the supported enum range, so mode becomes
unknown precisely while boiler demand is active. The existing semantic test covers only
`01 → Hybrid`.

**Claim limit:** the contradiction between converter and catalog is confirmed. The correct mode bit
field is not established by the repository evidence. This review does not propose an unverified
mask; a simple `& 3` is not justified because bit 1 is also documented as Bypass Valve Output. No
Hybrid installation was tested.

**Recommended fix:** resolve field boundaries from the original value catalog or suitable wire
captures. Then correct the supported converter/override layer and add combined mode/demand cases.
Do not hand-edit generated profile tables.

### F10 — MQTT base-topic runtime override is documented as unavailable

**Current status:** resolved by #49 (`e955c243`). The feature table now documents the runtime NVS
override and empty-value fallback to the compiled default.

**Relevant sources:** [`docs/FEATURES.md`](../docs/FEATURES.md),
[`main/http_config.cpp`](../main/http_config.cpp), and [`main/mqtt_ha.cpp`](../main/mqtt_ha.cpp).

The Kconfig table groups `DAIKIN_MQTT_DISCOVERY_PREFIX` and `_BASE_TOPIC` as compile-time-only. In
reality, `/set_mqtt` persists `base`, reboots, and MQTT startup resolves
`mqtt_base_effective(config().mqtt_base, …)`.

**Impact:** operators can plan an unnecessary custom build or miss the supported isolation control
for multiple installations.

**Recommended fix:** document discovery prefix and base topic separately. For the base topic, state
the NVS override, required reboot, and already-documented cleanup behavior for old retained topics.

### F11 — MCP Host requirement differs from shared HTTP policy

**Current status:** open at `2e8cfc0a`.

**Relevant sources:** [`docs/MCP.md`](../docs/MCP.md),
[`main/logic/http_request.hpp`](../main/logic/http_request.hpp), and
[`docs/SECURITY.md`](../docs/SECURITY.md).

MCP.md states that Host is required. The shared policy intentionally accepts a native HTTP/1.0
request without Host when Origin and Fetch Metadata are also absent. SECURITY.md describes this
exception correctly.

**Impact:** two documents describe different contracts for the same endpoint. This review does not
classify it as an additional browser-security flaw; browser-signaled requests remain constrained by
the shared policy.

**Recommended fix:** align MCP.md with SECURITY.md: a supplied Host must identify the device, while
the documented native-client exception remains available.

## Verification performed

All results below apply to the reviewed commit and are local runs from 2026-09-08 through
2026-09-09. They are not claims about the current status of a GitHub Actions run. The focused
reproduction source and its output are stored in the adjacent evidence directory.

| Check | Result and scope |
|---|---|
| `scripts/run-mock-tests.sh --coverage` | Passed; 97.24% executable logic lines, 5,628/5,788 across 79 production headers; presenter parity and 23 installer JavaScript tests also passed |
| `scripts/run-contract-tests.sh` | 12 source-contract suites passed, including OTA self-tests and public-readiness checks |
| `scripts/run-ui-use-case-tests.sh` | Passed; 10 modals, navigation, close paths, and accepted/rejected/invalid saves in the DOM/VM harness; no visual browser acceptance |
| `scripts/run-domain-audit.sh` | Passed; 45 profiles and 4,292 catalog rows compared with 220 specification rows |
| Description, user-docs, diagnostic-evidence, schematic, redaction, doc-entity, and UI-GIF audits | All passed; adjudicated exceptions remain visible in audit output |
| Coverage, presenter, absence, domain, description, user-docs, diagnostic-evidence, schematic, redaction, entity, and GIF self-tests | All passed and detected their seeded regressions |
| Pages publishing, Web Installer plan, publish-version, CI/release, and coredump-decoder tests | All passed in local test or mock environments |
| SDKCONFIG, firmware-size, and manifest-provenance self-tests | Passed |
| Agent configuration/budget and config, hook, and policy self-tests | Passed; hook suite reported 471 passed and 0 failed |
| ESP32-S3 Docker build | Passed with `espressif/idf:v6.0.2` in a separate build directory and SDKCONFIG |
| Local application signature check | Expected refusal: the local application is unsigned; exit code 1 |
| Focused review reproductions | Confirmed F01, F03, F04, F05, F07, and the F09 contradiction |

The firmware build used:

```text
scripts/idf-docker.sh idf.py -B build_review_20260908 \
  -D SDKCONFIG=build_review_20260908/sdkconfig -D IDF_TARGET=esp32s3 build
```

The unsigned application is `0x1c0000` bytes (1,835,008 bytes). The smallest application partition
is `0x1f0000` bytes (2,031,616 bytes), leaving `0x30000` bytes (196,608 bytes) according to the build.
This is flash occupancy, not runtime heap headroom or the size of a signed delivery artifact. The
container emitted a harmless warning that UID 501 had no username; no project compiler warning was
reported.

[`reproduce_review.py`](project-review-2026-09-09-cbcc043f/reproduce_review.py) exports the reviewed
public-main commit `d5fc344a` with `git archive`, extracts the affected production functions from
that immutable tree, and uses its real Config codecs, converters, signatures, and production
formatter. ESP-IDF I/O, NVS, and scheduling are simulated. Pinning the source keeps the original
evidence reproducible after later fixes land. The script writes its source archive, generated
harness, and executable only under `/tmp`; it performs no network or device I/O. Its captured result
is in [`reproductions.log`](project-review-2026-09-09-cbcc043f/reproductions.log).

## Existing gates and remaining coverage gaps

The existing gate suite is broad and valuable, but it primarily exercises IDF-free header logic,
source-text contracts, and simulated UI functions. A green gate can therefore coexist with the
remaining issues when, for example, an audit uses the same incorrect converter as its oracle, or a
text contract confirms that a catch exists without executing allocations inside the catch.

| Priority | Proposed coverage | Failure class | Cost | Hardware dependency |
|---|---|---|---|---|
| High | Inject allocation failure inside the OTA task's exception reporting and cleanup boundary | F07: a second allocation failure escapes the task | Medium; reusable allocator and task stubs | No for logic proof; later yes for reset evidence |
| High | Execute detection with targeted page timeout and CRC failures | F01: wrong model family with a non-empty candidate set | Medium | No initially; bus HIL for timing and recovery |
| Medium | Exercise MQTT lifecycle with one failed init/start followed by recovery | F06: missing retry after destructive transition | Medium | No initially; board and test broker later |
| Medium | Test combined, evidence-backed bit patterns instead of only isolated enum values | F09: overlapping fields and incorrect masking | Low after provenance is resolved | Original catalog or Hybrid capture required |
| Medium | Validate the documented source-build/flash sequence against the signature boundary | F02: hazardous incomplete command sequence | Low | No |
| Low | Assert MCP documentation against the shared native-client Host exception | F11: conflicting endpoint contract | Low | No |

These checks can remain steps in the existing consolidated gates job. Raising aggregate line
coverage does not replace them. The absence of a generic clang-tidy/cppcheck gate is not reported as
another defect because CONTRIBUTING records that decision and its measured tradeoff.

## Boundaries and repository state

No device, MQTT broker, heat pump, or cluster was contacted. The review did not perform OTA, USB
flash, signing, NVS/coredump deletion, or any live configuration change. GitHub CI, physical
heap/stack peaks, Wi-Fi/MQTT recovery, signed boot, rollback, power-loss recovery, and rendered
browser behavior were not verified live.

Independent read-only reviewers covered heap/HTTP/MQTT/OTA and X10A/HomeHub. The documentation
review stopped at a usage limit; its candidate findings were independently checked against the
reviewed sources and build before inclusion. Incomplete reviewer work is not counted as a passed
review. The later current-main disposition was checked directly against production code and
documentation; it was not inferred from pull-request titles.

The tracked and staged project diff was empty before this report was prepared. Pre-existing local
audit material and daily reports were preserved. The separate untracked firmware build directory is
not part of this report change. This report PR fixes no firmware defect; it records both the original
evidence and the later independent fixes already present on main.
