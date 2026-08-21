# Host logic tests

The riskiest parts of this firmware are pure computations — the X10A **CRC**, the value
**converters** (a wrong sign/scale/endianness silently corrupts a reading), register extraction,
the **config model / validation**, and the **HA-discovery payloads**. They all live in IDF-free
headers under [`main/logic/`](../main/logic), so they can be compiled and run on the host with
the plain system toolchain — no ESP-IDF, no Docker, no board.

This is the **real local verification loop**: an agent sandbox without Docker or USB access cannot
build firmware or flash a board, but it *can* run these in seconds and verify a decode/config change.

## Run

```bash
scripts/run-mock-tests.sh
scripts/run-mock-tests.sh --coverage
```

Uses `cmake` + `ctest` when present, else a direct `g++`/`clang++` compile of the single
translation unit ([`test_logic.cpp`](test_logic.cpp)) with `-std=c++17 -Wall -Wextra -Werror`.
`--coverage` uses the compiler's gcov instrumentation and enforces at least 95% aggregate executable
line coverage across `main/logic/`. It intentionally excludes this test driver, generated profiles
and system headers: none of those can prove that another production branch ran. GCC uses `gcov`;
Clang uses `llvm-cov gcov` (via `xcrun` on macOS).

CI runs the coverage form as the first step of the `gates` job, gating the esp32s3 firmware build — a
logic regression or an untested production path fails in seconds instead of after a full ESP-IDF
build. `tools/coverage/selftest.sh` separately proves that an empty report and coverage below the
floor fail closed.

`node --test test/serial_port_release.test.mjs` rides the same command and exercises the Pages
installer's serial-permission lifecycle: no control or chooser without an existing grant, direct
release of one closed port, chooser disambiguation for multiple grants, refusal while a flash still
owns the port, and visibility refresh after connection, focus and release changes.

`node test/test_ui_bundle.mjs` first validates `main/www/app.sources`: every entry is local, unique
and present, and their exact ordered concatenation parses as one classic script. All semantic UI
tests and audits use the same reader, so they cannot silently exercise a different source order than
the firmware build.

`scripts/run-ui-use-case-tests.sh` is the complete hardware-free UI gate. In addition to every
`test_ui_*.mjs` contract, HomeHub discovery and the MCP page, it runs
`test/test_ui_use_cases.mjs`: a small deterministic DOM harness executes the production `wire()`
function and requires every id in the production `MODALS` list to have a case. The matrix drives
Settings/Back, stable popup URLs, reload restoration, browser Back/Forward, open, Cancel, backdrop,
Escape, accepted and rejected Save paths, representative invalid input, board-gated ENV III states,
and both bug-report steps. `tools/ui/selftest.sh`
re-introduces the historical undefined ENV III close handler and proves the matrix fails on the
actual click path. The runner-neutral policy canaries simulate exactly
`scripts/gh-with-git-credentials.sh api --hostname github.com --method PUT
repos/0Bu/daikin-altherma-esp32/pulls/<numeric-pr>/merge -f sha=<full-40-hex-head-sha> -f
    merge_method=squash`. The gate accepts only that repository wrapper, static repository/PR route, `PUT`, one full
expected-head SHA, `merge_method=squash`, and current review stamps. `gh pr merge`, every other REST
mutation or merge shape, GraphQL mutations, MCP, auto-merge, and merge-queue activation stay negative
canaries. Every
real local merge also runs the UI-GIF audit as a mechanical hard block; changing the GIF or stamp
adds the current-head `$ui-gif` review requirement. A failed suite or stale stamp returns exit 2. CI
calls the same top-level policy rather than maintaining a second gate list.
The credential-wrapper selftest separately allows PR publication only with the fixed repository,
the checked-out and already-pushed `agent/*` head, base `main`, one literal title, and one regular
body file; direct `gh`, prompt/fill/editor/web forms, stale heads, and extra arguments stay negative.

`node test/test_ui_fan_icon.mjs` pins the header to the supplied static three-blade PNG mark at 48 px.
It separately keeps the live `#scFan` rotation in the system schematic and rejects a second header
telemetry/animation branch.

`node test/test_ui_ota_refresh.mjs` executes the production OTA resume and Settings render paths for
a refresh during a running download. It pins the version- and age-bound same-tab snapshot restore,
complete Dashboard/Settings preservation, explicit cached-state label and write lock, plus the
compact OTA-only fallback for a second tab. It also covers retained progress, one-time hydration by
a later full status response, and the rule that a successful `/ota/status` must not be overwritten
by a generic red unreachable state when the larger `/status` allocation is temporarily refused
under OTA TLS heap pressure.

`node test/test_ui_ota_handshake.mjs` executes the normal check/update browser handshake. It proves
that the UI waits through the pre-state-change busy lead, rejects a replaced generation, labels an
answered 503 as device-busy rather than unreachable, and carries the checked channel, version,
application SHA and generation into the sole update POST before following its immediate successor.

The same `gates` job runs `node test/test_ui_live_i18n.mjs` separately. That browser-free regression
test executes the production banner/inspector render functions from the assembled UI source and verifies
that their DOM-write signatures invalidate when the persisted UI language changes while device state
stays identical.

`node test/test_ui_modbus_status.mjs` executes the production Connections-row helpers and pins the
HomeHub contract: the row names the configured peer rather than its Modbus protocol, the configured
IPv4 and configured port remain the main value, link health uses the same state colours as the other
connection rows, a structured Modbus failure is rendered as localised
subtle text underneath it and in the accessible name, and unknown future codes fall back to escaped
human-readable API prose. It also pins the user-intent boundary: an empty address is disabled, while
a non-empty address whose task/link is down is visibly offline. Discovery does not create a boot mode.

`node test/test_ui_settings_connection_alert.mjs` executes the production Settings-button alert
aggregate. It keeps disabled optional links neutral, ignores ENV III's transient first collection,
and requires failed or stale configured ENV III, X10A and HomeHub links to contribute independently
to the red marker and its localised accessible connection count.

`node test/test_ui_mqtt_status.mjs` executes the production MQTT Connections row together with its
real German/English dictionary. A disconnected configured broker keeps its endpoint as the primary
value and shows the bounded runtime cause as subtle error text underneath and in the accessible name.
Known connection causes are actionable and localised; the former first-X10A wait string remains
translated for older cached firmware/UI combinations, while unknown future firmware text stays
visible and escaped. Connecting has no error line, and a connected broker cannot display a stale
one. The error is a full-row, inset, bottom-rounded tinted tongue with the same clip, spacing,
typography and downward slide as a value explainer; it is no longer constrained to the endpoint's
right-hand value column. The global reduced-motion contract removes that non-essential animation.

`scripts/run-ui-localization-audit.sh` is the named CI gate for complete device-local copy. Its core,
`node test/test_ui_locale_catalogs.mjs`, evaluates the separately shipped de/es/fr/it/pl/cs/uk/zh/ja/nb/sv/fi
modules against the embedded English fallback. All 840 keys, value types and parameter-function
arities must match; browser detection and the Firmware selector must name the same thirteen languages;
all 125 value and 15 model-description rows must have native copy with no English prose fallback
(compact locales may fold the normal context into their first field); concurrent loads coalesce onto
`/locale.js`; every deterministic gzip asset stays within its 32 KiB response budget; and all locale
assets together stay within a 272 KiB aggregate-growth guard. The separate firmware-size gate binds
the actual signed application image and its slot headroom. A fingerprint over the canonical
English/domain copy makes every locale stale when a source sentence changes without its translation;
`node tools/ui_localization/selftest.mjs` proves that stale source copy, missing specialist/domain
tables and reordered positional fault copy all fail.

`node test/test_homehub_discovery_contract.mjs` pins the IDF-facing lifecycle that the pure C++ host
suite cannot link: fresh firmware runs one persisted search before HTTP, the Modbus poll task never
browses mDNS, and an explicitly empty address creates no task or future boot search. The dialog's
manual endpoint returns a found address to the form but cannot persist it behind Save/Cancel.

`node test/test_transport_contract.mjs` also pins the device's static LAN identity on both
transports: DHCP options 12 and 60 come from the hostname installed before the client starts, with
no live DHCP stop/start mutation, while the `_http._tcp` mDNS record exposes only the fixed product,
root path and running firmware version. Per-device MAC/serial/configuration TXT fields stay absent.

`node test/test_mqtt_x10a_gate_contract.mjs` pins the other IDF-facing ownership boundary: the X10A
poll task starts before MQTT; `mqtt_ha_start()` builds a no-LWT client; `mqtt_task()` starts it for
the pre-enable Test subscription and, only in SHADOW, the saved reference subscription even without
X10A; and the first bus proof cleanly replaces it
with the LWT-bearing publisher. All ordinary publications remain behind the X10A gate.

`node test/test_mqtt_source_cleanup_contract.mjs` pins the deliberately narrow exception: clearing
an enabled Weather or HomeHub configuration first persists the disabled state, then requests one
QoS-1 retained empty tombstone for its source topic. That explicit deletion is serviced on the
subscriber-only broker connection even without X10A, while no discovery/state/heartbeat publisher
is reachable from the cleanup boundary. Re-enabling before broker delivery cancels the request.

`node test/test_ota_heap_contract.mjs` pins the signed-OTA memory boundary that cannot be linked on
the host: firmware bytes stream through the low-level HTTP/OTA APIs, HTTP/TLS is fully released
before `esp_ota_end()` performs RSA validation, dynamic TLS records remain enabled, every manifest
and image handshake receives a stable 56/24-KiB INTERNAL-heap gate, and both IDF verifier passes
(`esp_ota_end()` and boot selection) receive their own 24/12-KiB gate. It also requires
allocation-rich X10A, MQTT, HomeHub and Syslog cycles to claim, recheck, acknowledge and stand aside
for OTA/Weather, distinguishes
intentional holds from OOM skips, and pins `/status` plus the shared `/values`/MCP sender's fast
busy-503 during OTA, MCP's pre-parse fast-503, and the values sender's fail-closed four-second wait behind shorter Weather TLS
before its model-sized snapshot. The same contract requires check/update HTTP success to carry the
mutex-assigned operation generation, busy/task-unavailable starts to return 503, `/ota/status` to
expose the mutex-consistent `busy` plus generation/channel/version/application-SHA handshake used by
production promotion, and the accepted update task to hash every downloaded byte against that SHA
before signed validation and boot selection.
IDF's umbrella image-validation error stays generic rather than falsely
claiming a bad signature. Initial feed URLs and every redirect stay on forced HTTPS, and an oversized
response remains a size-policy refusal rather than masquerading as an interrupted connection.
`tools/ota/selftest.mjs` removes each IDF-facing orchestration safeguard independently (including
the fixed task lease, generation rollback and whole-stream SHA comparison) and proves the
source contract turns red; all eighty-four seeded regressions are required. The allocation-free
`FixedText`/`FixedBuffer` bounds and overflow refusal are exercised by `test/test_logic.cpp`.

`node test/test_production_ota_gate_contract.mjs` pins the exact-artifact bench-to-production
workflow: full signed release-binary pressure, the short completed-verifier state, 105-second
rollback probation, exact dev restore, and the sole production write. Its paired
`tools/production_ota/selftest.mjs` requires all thirty-two stage-removal mutations to turn that same
contract red.

`node test/test_ui_homehub_enums.mjs` executes the production value renderer against every named
HomeHub status in the EKRHH register map and the schematic renderer against every X10A operation
mode. It pins the manufacturer terms, readable diagram headlines and consistent German model-card
labels, unknown-value visibility, and the boundary between raw numeric HomeHub enums, ordinary
binary ON/OFF flags, structurally named valve selectors and ordinary numeric `0`/`1` values.

`node test/test_ui_source_matrix.mjs` additionally pins the complete two-contact X10A Smart-Grid
truth table, its derived named row, and fail-closed handling of missing, malformed or stale contacts.

`node test/test_ui_homehub_copy.mjs` audits all 32 curated HomeHub rows as one semantic contract:
the register guide's English name, all localized visual labels and explanations, and the visible
status vocabulary. German labels must use fluent qualifiers instead of parenthetical
fragments. The test also pins exact matches where a broad catalog regex would be misleading,
notably room-temperature setpoints versus the unrelated `Thermo ON` demand flag.

`node test/test_ui_error_codes.mjs` keeps the Error code row concise and source-aligned. It compares
the internal 63-code lookup with `main/logic/error_codes.hpp`, requires a short meaning in all thirteen
UI languages and executes the production renderer in each one. Only the currently reported code and
its meaning may appear; unavailable and unknown values have explicit, non-invented fallbacks.

`node test/test_ui_board_preset.mjs` executes the production Board Hardware modal functions. It
pins the first-boot case where the build defaults equal the Seeed XIAO values but the board selector
must still open on **Custom**, then verifies that an explicitly chosen AtomS3 Lite remains selected
when LED/reset are disabled. It also covers the integrated ENV III section: hidden and disabled for
Custom/Seeed, visible for M5Stack, with safe distinct SDA/SCL defaults, the board-physical AtomS3
Lite I2C set (explicitly excluding GPIO39 and unexposed chip pads), automatic proof of the selected or
reversed order before persistence, an explicit disable payload, and three live/history charts in the
expanded Hardware infobox. The Settings renderer additionally proves that concrete Atom/XIAO X10A
selectors contain only board-exposed, currently unreserved pins, while Custom retains its generic
chip-safe compatibility behavior.

`node test/test_ui_board_hardware_details.mjs` binds the permanent Hardware infobox to the firmware's
eight-phase LED table for both RGB and GPIO indicators. Besides bilingual wording and saved pin/backend
facts, it pins static, first-line-aligned colour points beside the complete slow, fast, medium, strobe
and double-flash descriptions; the points deliberately do not animate.

`node test/test_ui_checkup.mjs` executes the production plant-diagnostics card renderer without a
browser. It pins status-only collapsed rows, values and assessments in the row explainers, the
concise evidence-bounded English/German status words, evidence progress and limits, conservative
duration rounding, raw defrost-ratio and sub-minute BUH/BSH fields, independent fault/defrost null
handling, `available`/`assessable`/`evaluated`, the actual `/status.health` serializer keys, mobile
evidence wrapping, old-payload fallbacks, per-row observation clocks, the two-stage pressure copy,
safe handling of future unknown checks and the source-level reset contract (a pending identity reset hides
the report and drops the in-flight sample).

`node test/test_mcp_dashboard.mjs` verifies the embedded GET `/mcp` asset contract: the page explains
the endpoint and its security boundary, provides client and curl examples for the URL that served it,
documents both tools, loads no external asset, makes no network request, and is served pre-gzipped
with `connect-src 'none'`.

## Covered

One entry per `test_*()` in [`test_logic.cpp`](test_logic.cpp), in the order `main()` runs them.

- `logic/crc.hpp` — checksum, request framing (protocol I/S), reply-length, error reply.
- `logic/registers.hpp` — little-endian signed/unsigned value reads, bounds.
- `logic/convert.hpp` — numeric converters + the refrigerant pressure→temperature curve + the
  HA unit/device_class hints.
- `logic/config_model.hpp` — pin/interval/protocol validation, RX/TX collision, WiFi credential
  rules, the `/set_hp` fingerprint and X10A-observation reset scopes (profile/RX/TX reset it;
  HomeHub-only changes do not), and the field-owned detection patches (`apply_link` /
  `apply_model` touch only the link / model — a link commit must not revert a concurrent
  `/set_wifi`).
- `logic/lwt_select.hpp` — the web UI's leaving-water MEASUREMENT picker (twin of `www/js/schematic.js`
  `vLwt`): the pre-BUH heat-exchanger outlet (R1T) is chosen over a setpoint, a mixed-zone R1T, or
  the post-BUH (R2T) twin, across the four alias label forms — and, catalog-wide, every detectable
  profile resolves a real measurement and never a setpoint (issue legacy-121, the legacy-35–39 failure shape).
- `logic/mqtt_publish_gate.hpp` — an unwired board may connect/subscribe without an installation
  LWT but cannot publish; the first X10A proof promotes it, a one-cycle dropout is absorbed using the
  monotonic last-good age, and an active board publishes one offline transition only after 15 seconds
  of X10A loss before ordinary publication stays silent until recovery.
- `logic/profile_view.hpp` + `def/overlay.hpp` — the generated table plus the temporary page-`0x10`
  supplement as one row sequence, and the **overlay rule** (a block applies only if the base already
  references its page). Asserted: the block is withheld when the page is absent, base rows keep their
  order and indices, the resolved page mask equals the base page mask on every profile (so detection
  cannot move), the 11 rows decode end-to-end through the real converter (`0x95` → 1 discharge retry
  and 5 INV-current retries, with the drop flag ON and its neighbour OFF), and no row's `object_id`
  collides with one the profile already has. The page-`0x10` catalog guard armed vacuous in PR legacy-111 —
  size 1, conv ∈ {303,307,310,311}, never °C — is now live over the resolved view.
- `logic/feature_gate.hpp` — *disable, never degrade*: which derived features may honestly run on the
  detected model, decided from the rows. Asserted against the whole catalog: `generic` has no
  leaving-water measurement, run-state, valve or pressure row and opens neither gate; every detectable
  profile has a leaving-water measurement and the retry counters; the sixteen without page `0x30` lack
  run-state **and** expansion valve together and are gated off rather than reduced; a `no_publish`
  placeholder never counts as coverage.
- `logic/board_pins.hpp` — the ESP32-S3 chip-safe GPIO list (sorted, in range; excludes SPI
  flash/strapping/USB-JTAG/JTAG, plus GPIO33-37 on Octal-flash/PSRAM builds).
- `logic/discovery.hpp` — object-id slugging + the discovery config JSON.
- `def/registry.hpp` — profile lookup + generic fallback.
- `logic/detect.hpp` — capacity class parsed out of a profile id, page-mask fingerprint → candidate
  narrowing + the deterministic `detect_best` pick (Altherma-only), EEPROM hex render. Deterministic
  now means **order-independent** (legacy-230 B): the last tie-break is the lowest profile id rather than
  registry order, so `test_tie_break_order_independence()` permutes the signature array and requires
  the same pick — a label is an entity id and a series name, so a reordered table must not be able to
  move one. `test_tie_break_reach()` freezes the identifiers a tie-break can still decide on a
  fingerprint a real unit can present, beside `test_tie_break_identity()`'s register-equivalent
  divergences; the three ask different questions and none subsumes another.
- `logic/json.hpp` — RFC 8259 string escaping: the `"`/`\` pair, the five shorthand control escapes,
  every remaining byte under 0x20 as `\u00XX` (exhaustively — no control byte may reach the output
  raw), and the reachable case, an SSID like `Free<LF>WiFi` that made `GET /scan` unparseable. Also
  asserts what must *not* change: raw UTF-8 and 0x7F survive verbatim, since `char` is signed and a
  naive `c < 0x20` would mangle every non-ASCII SSID.
- `logic/mcp.hpp` — the actual bounded MCP/JSON-RPC request scanner and read-only dispatcher:
  malformed vs. structurally-invalid requests, string/number/null id echo and invalid-id rejection,
  notifications, revision negotiation, `initialize` / `tools/list` / `tools/call`, empty-argument
  enforcement, unknown-method/tool and invalid-params errors,
  the exact two-tool catalog, and the `structuredContent` result envelopes. This is the same parser
  the device uses, not a test-only re-derivation of cJSON output.
- `logic/chunk_sink.hpp` — the production bounded response sink used by `/values` and MCP
  `get_hp_values`: a single oversized append is split before the buffer can exceed 1 KiB, emitted
  chunks concatenate byte-for-byte to the input, exactly one successful terminator is produced,
  and injected OOM is rethrown before the first emission but converted to a failed stream after
  either a successful or failed first transport attempt.
- `logic/http_request.hpp` — the global trusted-LAN browser boundary: exact mDNS/WiFi/Ethernet Host
  authorities, independent Origin validation, Fetch-Metadata rejection, native-client omissions and
  the `application/json` media-type gate for body-bearing POSTs.
- `logic/mqtt_group.hpp` — register page → group name, number-vs-string JSON typing, the grouped
  state JSON (depth 1, first-seen order), and that a text value routes through the shared
  `logic/json.hpp` encoder.
- `logic/mqtt_uri.hpp` — broker URI → host/port/TLS split: scheme defaults (incl. `ws://` 80 /
  `wss://` 443, matching esp-mqtt so the pre-flight probes the port the client dials), IPv6 literals,
  a URL path (`wss://host:8084/mqtt`) kept out of both the port and the host, the 1–65535 port range,
  and the rejects (empty, no host, empty/non-digit/signed/whitespace/trailing-garbage port).
- `logic/modbus.hpp` — Modbus TCP framing (MBAP + FC03/04/06/16 request build, response/exception
  parse, per-request register maxima) + the HomeHub Temp16/Pow16/Int16/Text16 codecs (special-value
  guard, encode round-trip + range/sentinel rejects) and the `homehub-*` mDNS filter.
- `logic/heartbeat.hpp` — uptime formatting, the flat heartbeat JSON (each
  field prefixed by its block name — `wifi_rssi`/`wifi_mac`/`bus_rx_received` — with rssi/bssid null
  while offline, and the four `*_stack_min_free_bytes` rendered `null` until their task has been
  sampled, since `0` would read as a task one word from death rather than as one that never ran)
  + the 22 diagnostic HA discovery configs (incl. the WiFi MAC/BSSID and `heap_restarts`, whose
  `measurement` state class is pinned — it is a per-boot constant, not a counter), and the two
  RETIRED ones — "Device Time" and "WiFi Quality" — pinned absent from the payload AND from the live
  table, since a duplicate that survives in the JSON is the same duplicate with nobody watching it.
- `logic/heating_curve_mqtt.hpp` — the separate `<base>/heating_curve` topic and its exact
  schema-versioned, grouped `room`/`diagnosis` JSON, including null absence semantics and numeric
  boolean leaves; room/heating-curve fields are pinned absent from the heartbeat.
- `logic/crashinfo.hpp` — reset-reason slug/fault classification, the last_crash / MQTT crash JSON +
  text bundle (incl. backtrace clamp), and the crash diagnostic HA discovery configs.
- `logic/bootlog.hpp` — the once-per-boot syslog records: the build-identity line (absent fields
  degrade to `?`, safe mode visible) and the crash as single-line records — a clean boot yields
  none, `bt_depth` is clamped to the 16-entry buffer, a short caller array truncates instead of
  overrunning, and every record fits one datagram where `crashinfo`'s multi-line text would not.
- `logic/syslog_policy.hpp` — send-errno classification: hard (route/destination implicated →
  re-resolve now) vs transient. `ENOMEM`/`ENOBUFS` — what a ghosted link returns for every send, and
  the storm this guards against — stay transient, as does an unknown errno.
- `logic/timestamp.hpp` — RFC 3339 UTC formatting for the SNTP wall clock (`main/sntp_time.cpp`):
  the epoch, a leap-year/year-boundary date, millisecond zero-padding, and that a negative (never
  synced) input renders as `""` rather than a plausible-looking `1970-01-01` — the sentinel
  `syslog.cpp`'s RFC 5424 TIMESTAMP field checks to fall back to the `-` NILVALUE.
- `logic/hexdump.hpp` — hex rendering for the raw X10A page payloads on `/diag`: lowercase,
  space-separated, leading zeros preserved (a page is read positionally, so `0f` must not print as
  `f` or every offset after it shifts). Truncation stops after the last **complete** byte — a
  trailing nibble would read as a different value — and degenerate inputs (null pointer, zero/
  negative length, 1-byte buffer) still terminate the buffer, since the caller hands it straight to
  a `diag_printf` `%s`. Also pins that a full 32-byte payload renders to 95 chars, i.e. the
  on-device dump is never truncated.
- `logic/link_watch.hpp` — the gateway-watchdog step: re-associate on the second *proven*-silent
  probe, never on a gateway that has never answered ICMP, never on a link that knows it is down. An
  unmeasurable probe never counts as silence (nor launders silence already observed), but a
  sustained blind spell is its own fault — on a threshold kept an order of magnitude slower.
- `logic/wifi_rollback.hpp` — the credential-rollback step: which disconnect reasons are evidence the
  credentials are wrong (auth class) versus evidence about the router only (`NO_AP_FOUND`), that
  nothing rolls back before the 30 s window is even up, and that an absent SSID keeps waiting past the
  two minutes a rebooting router needs — the case where the old blind deadline destroyed valid new
  credentials — while still falling back eventually so a typo'd SSID can't strand the device.
- `logic/reset_reason.hpp` — reset code → `/status.sys.reset_reason` slug, unknown codes included,
  plus a parity guard that it stays ONE vocabulary with `crashinfo`.
- `logic/boot_guard.hpp` — crash-only boot counting (saturating, corrupt reads), the safe-mode
  threshold (no off-by-one), and which reset reasons count as a crash.
- `logic/health_gate.hpp` — the OTA commit/wait/give-up verdict across the base window + hard cap,
  incl. an unconfigured (setup-AP) device.
- `logic/ota_headroom.hpp` — phase-specific TLS-transfer and signed-image-validation internal-heap
  floors, exact-threshold success, a plausible aggregate with a fragmented block, sufficient
  contiguous space with insufficient total working memory, and reset/saturation of the required
  consecutive healthy-sample streak.
- `logic/ota_transport.hpp` — fail-closed OTA URL policy: initial feeds require absolute HTTPS;
  redirects admit HTTPS or ordinary relative paths only, with HTTP/other schemes, protocol-relative
  authorities, malformed origins, whitespace/control bytes and backslash parser ambiguities refused.
- `logic/version_cmp.hpp` — the OTA downgrade gate: numeric (not lexical) dotted-version ordering, so
  `1.10.0 > 1.9.0`; equal and older refused; a `v` prefix and a semver pre-release suffix handled;
  pre-release identifiers compare numerically too (`-dev.12 > -dev.9`), which is what keeps the dev
  channel moving forward; a dev build sorts above the release it followed and below the one it leads
  to; the explicit channel-switch downgrade (`ota_install_allowed`) relaxes the ordering and nothing
  else (an equal version and an unparseable one are still refused); a 400-digit version saturates
  instead of overflowing; and an unparseable version on either side **fails closed** rather than
  being assumed newer.
- `logic/ota_channel.hpp` — which published feed a device follows: the two accepted channel names
  (a typo is refused, not defaulted), the on-flash byte (an unknown value decodes to `release`, so a
  garbled NVS byte cannot move a board onto the fast feed), and the URL joins — a base URL with or
  without its trailing slash must produce the same dev URL, and an **empty** base must produce an
  empty string rather than a relative path fetched against nothing.
- `logic/ota_manifest.hpp` — bounded extraction of the manifest's top-level `"version"`, driven with
  hostile input: a `"version"` nested in `builds[]` must not shadow the real one, a crafted value
  must not close its own string and inject a second key, an oversized value is **refused rather than
  truncated** (a truncated `1.10.0` → `1.1` is well-formed and ordered wrong), and the parser must
  respect the caller's length on a response cut short mid-value.
- `logic/http_body.hpp` — request-body reassembly: a body delivered one byte per `recv` arrives
  whole (the fragmented POST that used to 400 as "bad json"), a timeout is retried while progress
  resets the idle count, a peer that stalls forever is dropped after a **bounded** wait rather than
  parking the httpd task, a mid-body close fails instead of handing over half a document, and the
  size cap still leaves room for the terminator.
- `logic/uart_plan.hpp` — the X10A UART (re)init decision: probing the SAME pins is a `Noop` (no
  reinstall, no heap), the detect sweep's `{44,43}↔{43,44}` alternation is a register-only `Remap`
  (**not** an `Install`) — the exact turn that used to reinstall the driver ~2×/s and fragment the
  heap into the `hp_poll` abort — and a one-sided pin change never reads as a false `Noop`.
- `logic/hp_query_log.hpp` — detection suppresses expected no-reply/rejected results while probing
  the union of every model's pages, but still reports partial/corrupt frames; normal profile polling
  keeps every transport failure visible.
- `logic/detect_backoff.hpp` — the silent-bus detect cadence: full 1 s cadence through the grace
  window (so a bus that answers early is never delayed), then geometric growth **clamped** to the
  60 s ceiling, monotonic and overflow-safe under saturation, with a bus answer resetting to the
  floor at once (a swapped-in unit is swept the next cycle, not up to a minute later).
- `logic/checkup.hpp` — the rolling plant diagnostics' structural locators, completed-sweep edges,
  sub-second telescoping evidence clocks, gap/bucket/window boundaries, real monotonic `full_span`,
  raw pressure minimum plus independently confirmed low-pressure fact, flow run-up, BUH/BSH observed
  seconds, raw/paired defrost edge counts, exact retry-counter deltas, clean one-hour R5T loss windows,
  draw/charge/settling exclusion, circulation-power attribution, intentional-reboot checkpoint/adoption
  of the in-flight DHW candidate (with blind downtime), and the evidence-bounded aggregate. Pure observations,
  count-only/zero-denominator defrost and stable experimental counters are reportable but cannot
  support aggregate `ok`; catalog-wide uniqueness pins every locator to the intended row.

`logic/value_def.hpp` has no `test_*()` of its own — it is the profile row type, exercised through
`def/registry.hpp` and the converter tests.

## Adding a test

1. Put the logic in the right `main/logic/*.hpp` (IDF-free — no `esp_*`, no FreeRTOS). The device
   `.cpp` must be a thin wrapper that calls it, never a second copy.
2. Add a `CHECK(...)` in `test_logic.cpp` asserting against a known-good reference (for converters,
   a known-good reference output for the same raw bytes; for CRC, a real captured frame).
3. `scripts/run-mock-tests.sh` — must pass; run it explicitly before handoff, and CI enforces it.
   The Codex Stop lifecycle hook repeats it through the same runner-neutral core.

See the `$add-logic-test` skill (`.agents/skills/add-logic-test/`).
