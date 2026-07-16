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
CI runs the same thing as the `logic-test` job, gating the per-target firmware builds — a logic
regression fails in seconds instead of after four ESP-IDF builds.

## Covered

One entry per `test_*()` in [`test_logic.cpp`](test_logic.cpp), in the order `main()` runs them.

- `logic/crc.hpp` — checksum, request framing (protocol I/S), reply-length, error reply.
- `logic/registers.hpp` — little-endian signed/unsigned value reads, bounds.
- `logic/convert.hpp` — numeric converters + the refrigerant pressure→temperature curve + the
  HA unit/device_class hints.
- `logic/config_model.hpp` — pin/interval/protocol validation, RX/TX collision.
- `logic/board_pins.hpp` — per-target usable X10A GPIO lists (sorted, in range; the XIAO ESP32-S3
  reference set excludes not-broken-out pins).
- `logic/discovery.hpp` — object-id slugging + the discovery config JSON.
- `def/registry.hpp` — profile lookup + generic fallback.
- `logic/detect.hpp` — capacity class parsed out of a profile id, page-mask fingerprint → candidate
  narrowing + the deterministic `detect_best` pick (Altherma-only), EEPROM hex render.
- `logic/mqtt_group.hpp` — register page → group name, number-vs-string JSON typing, the grouped
  state JSON (depth 1, first-seen order).
- `logic/mqtt_uri.hpp` — broker URI → host/port/TLS split: scheme defaults, IPv6 literals, rejects.
- `logic/modbus.hpp` — Modbus TCP framing (MBAP + FC03/04/06/16 request build, response/exception
  parse, per-request register maxima) + the HomeHub Temp16/Pow16/Int16/Text16 codecs (special-value
  guard, encode round-trip + range/sentinel rejects) and the `homehub-*` mDNS filter.
- `logic/heartbeat.hpp` — dBm → signal quality %, uptime formatting, the heartbeat JSON (rssi null
  while offline) + the 16 diagnostic HA discovery configs.
- `logic/crashinfo.hpp` — reset-reason slug/fault classification, the last_crash / MQTT crash JSON +
  text bundle (incl. backtrace clamp), and the crash diagnostic HA discovery configs.
- `logic/bootlog.hpp` — the once-per-boot syslog records: the build-identity line (absent fields
  degrade to `?`, safe mode visible) and the crash as single-line records — a clean boot yields
  none, `bt_depth` is clamped to the 16-entry buffer, a short caller array truncates instead of
  overrunning, and every record fits one datagram where `crashinfo`'s multi-line text would not.
- `logic/syslog_policy.hpp` — send-errno classification: hard (route/destination implicated →
  re-resolve now) vs transient. `ENOMEM`/`ENOBUFS` — what a ghosted link returns for every send, and
  the storm this guards against — stay transient, as does an unknown errno.
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

`logic/value_def.hpp` has no `test_*()` of its own — it is the profile row type, exercised through
`def/registry.hpp` and the converter tests.

## Adding a test

1. Put the logic in the right `main/logic/*.hpp` (IDF-free — no `esp_*`, no FreeRTOS). The device
   `.cpp` must be a thin wrapper that calls it, never a second copy.
2. Add a `CHECK(...)` in `test_logic.cpp` asserting against a known-good reference (for converters,
   a known-good reference output for the same raw bytes; for CRC, a real captured frame).
3. `scripts/run-mock-tests.sh` — must pass (the Stop hook and CI enforce it).

See the `add-logic-test` skill (`.claude/skills/add-logic-test/`).
