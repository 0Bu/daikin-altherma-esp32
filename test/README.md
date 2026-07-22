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
```

Uses `cmake` + `ctest` when present, else a direct `g++`/`clang++` compile of the single
translation unit ([`test_logic.cpp`](test_logic.cpp)) with `-std=c++17 -Wall -Wextra -Werror`.
CI runs the same thing as the `logic-test` job, gating the esp32s3 firmware build — a logic
regression fails in seconds instead of after a full ESP-IDF build.

## Covered

One entry per `test_*()` in [`test_logic.cpp`](test_logic.cpp), in the order `main()` runs them.

- `logic/crc.hpp` — checksum, request framing (protocol I/S), reply-length, error reply.
- `logic/registers.hpp` — little-endian signed/unsigned value reads, bounds.
- `logic/convert.hpp` — numeric converters + the refrigerant pressure→temperature curve + the
  HA unit/device_class hints.
- `logic/config_model.hpp` — pin/interval/protocol validation, RX/TX collision, WiFi credential
  rules, the `/set_hp` fingerprint rule, and the field-owned detection patches (`apply_link` /
  `apply_model` touch only the link / model — a link commit must not revert a concurrent
  `/set_wifi`).
- `logic/lwt_select.hpp` — the web UI's leaving-water MEASUREMENT picker (twin of `www/app.js`
  `vLwt`): the pre-BUH heat-exchanger outlet (R1T) is chosen over a setpoint, a mixed-zone R1T, or
  the post-BUH (R2T) twin, across the four alias label forms — and, catalog-wide, every detectable
  profile resolves a real measurement and never a setpoint (issue #121, the #35–#39 failure shape).
- `logic/board_pins.hpp` — the ESP32-S3 chip-safe GPIO list (sorted, in range; excludes SPI
  flash/strapping/USB-JTAG/JTAG, plus GPIO33-37 on Octal-flash/PSRAM builds).
- `logic/discovery.hpp` — object-id slugging + the discovery config JSON.
- `def/registry.hpp` — profile lookup + generic fallback.
- `logic/detect.hpp` — capacity class parsed out of a profile id, page-mask fingerprint → candidate
  narrowing + the deterministic `detect_best` pick (Altherma-only), EEPROM hex render.
- `logic/json.hpp` — RFC 8259 string escaping: the `"`/`\` pair, the five shorthand control escapes,
  every remaining byte under 0x20 as `\u00XX` (exhaustively — no control byte may reach the output
  raw), and the reachable case, an SSID like `Free<LF>WiFi` that made `GET /scan` unparseable. Also
  asserts what must *not* change: raw UTF-8 and 0x7F survive verbatim, since `char` is signed and a
  naive `c < 0x20` would mangle every non-ASCII SSID.
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
- `logic/heartbeat.hpp` — dBm → signal quality %, uptime formatting, the flat heartbeat JSON (each
  field prefixed by its block name — `wifi_rssi`/`wifi_mac`/`bus_rx_received` — with rssi/bssid null
  while offline and the SNTP wall-clock `time` field null until synced) + the 19 diagnostic HA
  discovery configs (incl. the `device_class:"timestamp"` device-time sensor and the WiFi MAC/BSSID).
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
  a 400-digit version saturates instead of overflowing; and an unparseable version on either side
  **fails closed** rather than being assumed newer.
- `logic/ota_manifest.hpp` — bounded extraction of the manifest's top-level `"version"`, driven with
  hostile input: a `"version"` nested in `builds[]` must not shadow the real one, a crafted value
  must not close its own string and inject a second key, an oversized value is **refused rather than
  truncated** (a truncated `1.10.0` → `1.1` is well-formed and ordered wrong), and the parser must
  respect the caller's length on a response cut short mid-value.
- `logic/ws_policy.hpp` — the `/events` frame decision: that a frame one byte past the command
  buffer is *rejected* rather than clamped-and-read (the boundary where the handler used to `memcmp`
  stack a failed read never wrote), that an announced length up to `SIZE_MAX` reaches a decision and
  never an allocation, and that only a **text** frame opening with `sub` subscribes — a prefix still
  does, so clients that work today keep working.
- `logic/ws_tx_gate.hpp` — `/events` async-send backpressure: a stream accepts one outstanding
  broadcast, rejects another while its completion is pending, becomes available again on completion,
  and the independent values/status gates do not block each other. This pins the bound that prevents
  a congested ESP-IDF HTTP work queue from retaining a new payload every poll tick until OOM.
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

`logic/value_def.hpp` has no `test_*()` of its own — it is the profile row type, exercised through
`def/registry.hpp` and the converter tests.

## Adding a test

1. Put the logic in the right `main/logic/*.hpp` (IDF-free — no `esp_*`, no FreeRTOS). The device
   `.cpp` must be a thin wrapper that calls it, never a second copy.
2. Add a `CHECK(...)` in `test_logic.cpp` asserting against a known-good reference (for converters,
   a known-good reference output for the same raw bytes; for CRC, a real captured frame).
3. `scripts/run-mock-tests.sh` — must pass (the Stop hook and CI enforce it).

See the `add-logic-test` skill (`.claude/skills/add-logic-test/`).
