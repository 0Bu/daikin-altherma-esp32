# Host logic tests

The riskiest parts of this firmware are pure computations — the X10A **CRC**, the value
**converters** (a wrong sign/scale/endianness silently corrupts a reading), register extraction,
the **config model / validation**, and the **HA-discovery payloads**. They all live in IDF-free
headers under [`main/logic/`](../main/logic), so they can be compiled and run on the host with
the plain system toolchain — no ESP-IDF, no Docker, no board.

This is the **real local verification loop**: a cloud Claude Code session can't build firmware or
USB-flash, but it *can* run these in seconds and know a decode/config change is correct.

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

The same `gates` job runs `node test/test_ui_live_i18n.mjs` separately. That browser-free regression
test executes the production banner/inspector render functions from `main/www/app.js` and verifies
that their DOM-write signatures invalidate when the persisted UI language changes while device state
stays identical.

`node test/test_ui_board_preset.mjs` executes the production Board Hardware modal functions. It
pins the first-boot case where the build defaults equal the Seeed XIAO values but the board selector
must still open on **Custom**, then verifies that choosing and editing presets within the open modal
continues to keep the selector in sync with the five hardware fields.

`node test/test_ui_checkup.mjs` executes the production X10A observation-card renderer without a
browser. It pins the evidence-bounded English/German wording, visible evidence classes, conservative
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
- `logic/lwt_select.hpp` — the web UI's leaving-water MEASUREMENT picker (twin of `www/app.js`
  `vLwt`): the pre-BUH heat-exchanger outlet (R1T) is chosen over a setpoint, a mixed-zone R1T, or
  the post-BUH (R2T) twin, across the four alias label forms — and, catalog-wide, every detectable
  profile resolves a real measurement and never a setpoint (issue #121, the #35–#39 failure shape).
- `logic/profile_view.hpp` + `def/overlay.hpp` — the generated table plus the temporary page-`0x10`
  supplement as one row sequence, and the **overlay rule** (a block applies only if the base already
  references its page). Asserted: the block is withheld when the page is absent, base rows keep their
  order and indices, the resolved page mask equals the base page mask on every profile (so detection
  cannot move), the 11 rows decode end-to-end through the real converter (`0x95` → 1 discharge retry
  and 5 INV-current retries, with the drop flag ON and its neighbour OFF), and no row's `object_id`
  collides with one the profile already has. The page-`0x10` catalog guard armed vacuous in PR #111 —
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
  now means **order-independent** (#230 B): the last tie-break is the lowest profile id rather than
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
  enforcement, browser-Origin/DNS-rebinding policy, unknown-method/tool and invalid-params errors,
  the exact two-tool catalog, and the `structuredContent` result envelopes. This is the same parser
  the device uses, not a test-only re-derivation of cJSON output.
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
  while offline) + the 18 diagnostic HA discovery configs (incl. the WiFi MAC/BSSID), and the two
  RETIRED ones — "Device Time" and "WiFi Quality" — pinned absent from the payload AND from the live
  table, since a duplicate that survives in the JSON is the same duplicate with nobody watching it.
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
- `logic/detect_backoff.hpp` — the silent-bus detect cadence: full 1 s cadence through the grace
  window (so a bus that answers early is never delayed), then geometric growth **clamped** to the
  60 s ceiling, monotonic and overflow-safe under saturation, with a bus answer resetting to the
  floor at once (a swapped-in unit is swept the next cycle, not up to a minute later).
- `logic/checkup.hpp` — the rolling X10A observation's structural locators, completed-sweep edges,
  sub-second telescoping evidence clocks, gap/bucket/window boundaries, real monotonic `full_span`,
  raw pressure minimum plus independently confirmed low-pressure fact, flow run-up, BUH/BSH observed
  seconds, raw/paired defrost edge counts, exact retry-counter deltas and the evidence-bounded aggregate. Pure observations,
  count-only/zero-denominator defrost and stable experimental counters are reportable but cannot
  support aggregate `ok`; catalog-wide uniqueness pins every locator to the intended row.

`logic/value_def.hpp` has no `test_*()` of its own — it is the profile row type, exercised through
`def/registry.hpp` and the converter tests.

## Adding a test

1. Put the logic in the right `main/logic/*.hpp` (IDF-free — no `esp_*`, no FreeRTOS). The device
   `.cpp` must be a thin wrapper that calls it, never a second copy.
2. Add a `CHECK(...)` in `test_logic.cpp` asserting against a known-good reference (for converters,
   a known-good reference output for the same raw bytes; for CRC, a real captured frame).
3. `scripts/run-mock-tests.sh` — must pass (the Stop hook and CI enforce it).

See the `add-logic-test` skill (`.claude/skills/add-logic-test/`).
