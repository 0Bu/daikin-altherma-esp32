# Architecture reference

Deep internal reference for daikin-altherma-esp32. This is the **on-demand** companion to
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md): CLAUDE.md carries the always-needed essentials
(build/flash, component map, NVS table, HTTP API, memory constraints); the full narrative lives
here so it isn't reloaded into every session. Read it when working on the poll engine, the value
model, the MQTT bridge, WiFi/LAN connectivity, or OTA. Keep both in sync — the `project-review`
skill checks for drift.

## Design split

Two concerns, cleanly separated. The **domain** — the X10A protocol (I and S), the register/CRC
framing, the value-definition tables (`def/*`) and the converter functions — is reverse-engineered
heat-pump knowledge, ported byte-for-byte so readings match a known-good implementation. The
**chassis** — the ESP-IDF/CMake esp32s3 build, the web installer, captive-portal
provisioning, the MQTT/HA discovery bridge, signed OTA, the `main/logic/` host-test split and the
CI / Claude-Code developer setup — is the delivery machinery. Anything about *talking to the heat
pump* is the domain; anything about *installing, configuring and shipping* is the chassis. IDF
idioms are used throughout (`esp_http_server`, `uart_driver`, `esp-mqtt`).

## Component map

```
main.cpp            → boot: NVS init, safe-mode guard, WiFi (STA or setup AP), start SNTP, start HTTP
                       server, start poll engine + MQTT bridge (both SKIPPED in safe mode), arm OTA
                       health gate
safe_mode.cpp/.hpp  → boot-loop safe mode (logic/boot_guard.hpp): crash-only boot counter in NVS
                       (boot_fails) → past a threshold, come up minimally (WiFi + web UI + OTA, no
                       poll/MQTT) to recover a bad config in-browser. See "Boot-loop safe mode" below
wifi.cpp/.hpp       → STA bring-up (all-channel scan → strongest AP by RSSI) + endless reconnect
                       (first-boot budget → setup portal; once online NO reason code ever reboots it)
                       + reason-aware one-shot credential rollback (new creds fail to get a lease →
                       restore NVS backup + reboot + mark /status.wifi.rolled_back; host-tested
                       policy in logic/wifi_rollback.hpp: a SUSTAINED auth-class refusal rolls back
                       after 2 checkpoints (~60 s), an absent SSID gets 180 s for a rebooting router) +
                       ICMP gateway watchdog (three-valued probe + host-tested policy in
                       logic/link_watch.hpp: 2 proven-silent periods, or 10 blind ones, re-associate)
                       + DHCP hostname + mDNS; wifi_info() also reports the AP's
                       BSSID + PHY standard + this STA's MAC
sntp_time.cpp/.hpp  → SNTP client (esp_netif_sntp, config().ntp_server — NVS "ntp_server" override of
                       CONFIG_DAIKIN_NTP_SERVER default "pool.ntp.org", runtime-editable via
                       POST /set_ntp exactly like syslog_host/POST /set_syslog). Started right after
                       WiFi(STA)|setup-AP in main.cpp, once config_load() has run; non-blocking,
                       idles/retries on its own task until a route exists, so it's harmless to start
                       in AP-only setup mode too. Gives the device a wall clock for the first time —
                       logic/timestamp.hpp renders it as RFC 3339 for syslog.cpp's TIMESTAMP field and
                       the top-level /status.ntp block; the diag ring's uptime prefix is unchanged
                       (see "Diagnostics & observability" in docs/FEATURES.md). The server string is
                       resolved once at startup into a file-scope std::string — lwip's SNTP module
                       stores the raw pointer it's given, not a copy — so a later /set_ntp edit
                       reboots into a fresh config_load() rather than mutating it live.
hp_comm.cpp/.hpp    → X10A UART transport: request framing for protocol I and S, 9600 8E1,
                       CRC, timeout handling
hp_detect.cpp/.hpp  → auto-detect glue: protocol sweep + page probe → bus fingerprint → candidate
                       models (logic/detect.hpp); register→value extraction is in logic/registers.hpp
hp_convert.cpp/.hpp → converter functions: raw bytes →
                       typed reading (temp, int, fixed-point, enum/label, on/off, pressure)
hp_poll.cpp/.hpp    → poll engine task: builds the active register set from the profile,
                       polls each interval, fills the thread-safe value cache, drives errors, and
                       pushes the /events WebSocket (values each cycle, status every 4th; each
                       stream admits only one async batch until its completion callbacks finish)
def/*.hpp           → embedded per-model value profiles (machine-generated in the ValueDef row
                       format); def/registry.hpp maps profile id→table, models_catalog.hpp = /models
config.cpp/.hpp     → runtime config (daik_cfg): WiFi/MQTT + the one-shot WiFi rollback backup + link
                      cache (pins/proto) persisted, model RAM-only; mutex-guarded snapshot via config().
                      Writers commit only the fields they own (config_save_link/config_set_model for
                      detection, config_save for the HTTP handlers). config_save writes the
                      credential/service fields as ONE CRC-checked atomic blob (logic/config_store.hpp,
                      host-tested) — a single nvs_set_blob, so that blob is all-or-nothing across a
                      write failure AND a power cut; on failure the old blob is intact, config_save
                      returns false and publishes nothing. The RX/TX/proto link cache stays as separate
                      self-healing keys. A cache-write failure after a successful blob is logged but
                      does not falsely fail an unrelated service save; /set_hp requires the cache and
                      leaves RAM untouched on failure. config_save_link applies its RAM patch (the link
                      is proven-good). config_load reads the blob first, falling back to the legacy
                      per-key keys when it is absent (fresh device / pre-blob OTA) or CRC-invalid
nvs_storage.cpp     → thin NVS helpers (namespaces, blobs, migration); setters return esp_err_t and
                       are [[nodiscard]] — a dropped write is silent (compare to ESP_OK, not bool)
http_server.cpp     → esp_http_server :80, wildcard dispatch; concerns register their own routes.
                      Picks the trust surface from the WiFi mode (esp_wifi_get_mode): the OPEN setup
                      AP registers ONLY the provisioning routes (GET / , /index.html, POST
                      /set_wifi + captive), withholding /scan, /coredump, /diag, config/OTA/MCP from
                      an unauthenticated radio client; the STA (trusted LAN) registers the full API.
                      Boundary = host-tested logic/http_surface.hpp (F01)
http_common.cpp     → shared HTTP helpers + the single OOM guard: http_register() stashes the real
                      handler in user_ctx and installs the handle_all trampoline, which calls it
                      inside try/catch — std::bad_alloc → 503, any other throw → 500, instead of
                      unwinding through esp_http_server's C frames to std::terminate → reboot.
                      /events is the deliberate exception (raw registration for the WebSocket; it
                      self-guards its own JSON build instead)
http_status.cpp     → GET / (web UI), /status, /values, /history, /models, /diag, /scan, /coredump, and the
                      /events WebSocket (live status/values push with shared-payload, bounded
                      in-flight backpressure via logic/ws_tx_gate.hpp)
http_config.cpp     → POST /set_wifi, /set_mqtt, /set_syslog, /set_ntp, /set_hp, /detect
http_ota.cpp        → /ota/check|update|status
mcp_server.cpp      → /mcp — read-only MCP tools (get_status, get_hp_values) for AI agents — PLANNED
                      (route exists; returns a JSON-RPC "not implemented" error for now)
provisioning.cpp    → captive setup portal (SoftAP daikin-altherma-esp32-setup) when no WiFi.
                      Runs AP-only: the portal takes the SSID as free text and never scans, so it
                      needs no station interface (esp_wifi_scan_start() would — an earlier version
                      ran APSTA with an idle STA purely to feed the page's since-removed dropdown).
                      The DHCP hand-off offers itself as DNS *and* advertises the RFC 8910
                      captive-portal URI (option 114); every step is checked and named on diag
captive_dns.cpp     → UDP:53 catch-all (every name → 192.168.4.1) so the setup portal auto-pops.
                      Copies the query's RD bit and sets RA (RFC 1035 §4.1.1) so a stub resolver
                      cannot discard the answer; AAAA gets a 0-answer NOERROR
logic/captive.hpp   → what the "/*" catch-all answers: a 302 to the portal in setup mode (the only
                      signal iOS/Android/Windows probe agents all act on), the SPA shell in STA mode
mqtt_ha.cpp/.hpp    → Home Assistant MQTT-Discovery bridge (streamed discovery), read-only
ota_update.cpp      → OTA: manifest check + esp_https_ota download + the two-point downgrade
                      gate + the rollback health gate. Both network ops run on ONE on-demand
                      task (never the httpd worker), one at a time; status behind a mutex
diag_log.cpp        → in-RAM console ring served by GET /diag (static .bss buffer); each line is
                      also handed to syslog_send() for optional off-device forwarding
syslog.cpp          → optional syslog UDP client (RFC 5424, off when syslog_host is empty). The
                      TIMESTAMP field is the SNTP wall clock (sntp_time.cpp) once synced, else the
                      "-" NILVALUE a collector conventionally substitutes its own receive time for.
                      A task DNS-resolves the host and forwards each diag line as one UDP datagram, gated on
                      DNS only; an ARP(local)/ICMP reachability probe is ADVISORY (feeds
                      /status.syslog.reachable, never gates delivery — syslog is best-effort UDP and a
                      collector may firewall ICMP). File-scope ping-control (like wifi.cpp s_wd) keeps
                      the async esp_ping callback from a use-after-free. Self-loop-guarded (drops
                      "syslog:" lines); syslog_status() feeds /status. On the FIRST resolve of a boot
                      it replays the boot records once (logic/bootlog.hpp): a build-identity line
                      (version/elf_sha256/reset/safe_mode) plus, after a crash, the reset reason +
                      crashed task/PC/backtrace — captured at the top of app_main, long before this
                      task or the network exists, so without the replay they reached only the in-RAM
                      ring and were overwritten there within a minute. A send failure is CLASSIFIED
                      (logic/syslog_policy.hpp): only a HARD errno (ENETUNREACH/EHOSTUNREACH/...)
                      clears the 10 s resolve throttle; a TRANSIENT one (ENOMEM — what a ghosted link
                      returns for every datagram) holds the destination, so a chatty diag stream can't
                      drive a getaddrinfo+ICMP storm. The errno is captured inside syslog_sendto
                      BEFORE close() (which may clobber it, and it now decides the throttle). Failures
                      log the TRANSITION (paused/recovered), not every dropped line
status_led.cpp/.hpp → onboard status-indicator task with TWO back-ends behind one host-tested
                      pattern table (logic/led_pattern.hpp): a level-driven GPIO LED and an
                      addressable WS2812 (RMT, espressif/led_strip). Pin + driver + polarity are
                      RUNTIME (led_gpio/led_type/led_inverted in NVS, POST /set_board); Kconfig
                      DAIKIN_STATUS_LED_* only seeds first boot. Runtime because CI publishes ONE
                      esp32s3 image while boards disagree about their onboard parts — XIAO
                      ESP32-S3: plain LED on GPIO21, active-low; M5Stack AtomS3 Lite: WS2812 on
                      GPIO35. Compiling one in would fork the artifact, the manifest and the OTA
                      feed per board. Each tick samples the WiFi mode + wifi/mqtt/hp state and
                      blinks: slow 1 s = setup portal (SoftAP), fast 100 ms = connecting, solid =
                      healthy (WiFi + MQTT + X10A), double-flash = X10A link down, medium 300 ms =
                      X10A up but MQTT down, off = no WiFi mode. X10A-down outranks MQTT-down — the
                      bus is the point of the device. Two further phases are asserted by the
                      recovery button through status_led_signal() (an atomic — no lock on the erase
                      path): red 60 ms strobe = factory reset ARMED, solid white = erasing. The
                      override beats every operating phase, because a board being deliberately reset
                      is usually perfectly healthy. Waits are sliced at 25 ms and re-check the
                      signal, so an override appears within a slice instead of up to a full pattern
                      later. Started AFTER config_load (it reads the config); on /status.board as
                      configuration, never as a value — the light itself is local-eyes-only.
                      The loop self-guards like mqtt_task/poll_task: the state getters copy
                      std::strings out, so a tick can throw under memory pressure, and a task entry
                      is a C frame boundary — an escape would reboot the board over a cosmetic LED
recovery_button.cpp/.hpp → physical factory-reset button (btn_gpio/btn_active_low, DISABLED by
                      default). Held 5 s (BUTTON_FIRE_MS) it erases the whole daik_cfg NVS namespace
                      and reboots into the setup portal — the only config reset that does not need
                      network access to the device, i.e. the cure for "it joined a network I can no
                      longer reach" (which the credential rollback cannot cover: that handles a
                      REJECTED password, not a wrong-but-accepted LAN). Classification is the pure
                      logic/button.hpp — an ARM checkpoint at 1.5 s lights the warning while there
                      is still time to let go, and a debounced release means one bounced sample
                      neither cancels a hold nor restarts its clock. Default -1 on purpose: an
                      unconfigured input floats, and a floating pin reading "pressed" for five
                      seconds would wipe a board nobody touched. A button already held at boot is
                      ignored until the pin reads released once. The erase itself is milliseconds,
                      so the indicator LEADS it by 250 ms and is held to 1.5 s total — a signal that
                      merely bracketed the flash write would be invisible. A FAILED erase does NOT
                      reboot (coming back up on the config it just claimed to delete is worse than
                      staying up and logging why). Started even in safe mode
www/                → web UI sources: index.html + style.css + app.js, spliced into ONE
                     self-contained page at build time (inline_assets.cmake) and served gzipped;
                     setup.html is the captive-portal page (gzipped separately)
logic/              → IDF-free, host-tested pure logic (see below)
```

## The host-tested logic core (`main/logic/`)

Everything that is pure computation lives in IDF-free headers under
`main/logic/`, so `scripts/run-mock-tests.sh` compiles + runs it with plain g++/clang++ (no
ESP-IDF, no board) and CI gates the firmware build on it (first step of the `gates` job). For this project the
host-testable core is unusually large and valuable, because the risky parts are all pure decoding:

- `logic/crc.hpp` — the X10A checksum for protocol I and S. Golden-vector tested against frames
  captured from a real unit.
- `logic/convert.hpp` — every converter (raw bytes → typed value). This is where a wrong sign,
  scale or endianness would silently corrupt a reading; unit-tested per converter id against
  known-good reference outputs. Also `reading_plausible()` — the **publish-time** filter that drops a
  °C reading (dataType 1) outside a physical envelope (an idle unit's 576 °C, a ±3276.x sentinel),
  **and** a refrigerant pressure at or below 0 bar; applied by `hp_format`, deliberately **not** folded
  into `convert()` so the domain audit still sees each converter's intrinsic semantics (conv 105 vs 114
  on the no-data sentinel). conv 405 separately drops a saturation temp derived from a 0-bar
  (absent/idle) pressure — the pressure rule makes the bar row agree with the °C row beside it, which
  was already being withheld.
  The pressure rule may need the **whole profile table**, because 0 bar is physically impossible for
  refrigerant (absolute pressure; a sealed circuit is never at vacuum) yet perfectly real for water (a
  drained system). `is_refrigerant_pressure()` decides which is which **structurally**, never from the
  label — an alias or a translation would flip it, the `lwt_select.hpp` lesson — on either of two
  signals:
  1. **The page.** `0x20`/`0x21`/`0xA0`/`0xA1` are the outdoor unit's own pages; there is no water
     circuit out there. Measured across all 45 shipped profiles: every `dataType 2` row on `0x20` and
     `0xA0` is a refrigerant pressure, and no water-pressure row appears on either. This signal needs
     no profile table at all.
  2. **A conv-405 saturation-temperature twin** at the same `(reg, offset)` — 405 only ever accompanies
     a refrigerant pressure. This is what reaches the refrigerant rows on the *mixed* hydronic page
     `0x62`, which carries both `Water pressure` (`0x62/11`) and `Refrigerant pressure sensor`
     (`0x62/15`). This signal is the one that needs the table.

  Together they cover 93 of the catalog's bar rows. **Known gap:** 16 `Refrigerant pressure sensor`
  rows and one `Pressure sensor` sit on `0x62` with no 405 twin and are still published at 0 bar;
  closing that would mean matching on the label, which is the one thing this must not do. They are no
  worse off than before the filter existed. `test_refrigerant_pressure_catalog()` pins the coverage
  and, more importantly, that **no** water-pressure row is ever classified refrigerant on any profile —
  a false positive there would withhold a genuine 0-bar reading from a drained system, which is worse
  than the reading being suppressed is good.
- `logic/registers.hpp` — register-buffer parsing (offset/size extraction, bounds).
- `logic/value_def.hpp` — the `ValueDef{reg, offset, conv, size, type, label}` row type the generated
  `def/*` profile tables are written in: the shared vocabulary between the offline generator's output
  and `convert.hpp`'s decode. IDF-free so the host tests can build the same tables the device runs.
- `logic/config_model.hpp` — validation of pins (no overlap, in range for the target), protocol
  enum, and the fixed `POLL_INTERVAL_S` constant. Range and distinctness are not the whole link rule:
  `validate()` also applies `board_pins.hpp`'s chip-reserved-pin test per pin, so a pad the UI would
  never offer is rejected by name (`"rx_pin is a reserved GPIO"`) rather than range-accepted, and
  `link_pins_safe()` bundles that test with the pair rule for the load path. `octal_spi` is supplied
  by the caller from Kconfig (`config.cpp`'s `hw_octal_spi()`), keeping the header `CONFIG_`-free;
  `reserved` is now a `ReservedPins` pair read from the live config (`config_reserved_pins()`),
  since both firmware-driven pins — the status indicator and the recovery button — are runtime
  settings rather than build options. `board_hw_valid()` is the mirror rule for `POST /set_board`:
  it checks those two pins against the wider **local-I/O** set and enforces the collision rules in
  both directions, so no GPIO can be claimed by the indicator, the button and the X10A link at once,
  whichever endpoint is called second.
- `logic/discovery.hpp` — the HA MQTT-Discovery payload builder (topic + config JSON per value),
  so the exact bytes HA receives are asserted on the host, not on the device.
- `logic/detect.hpp` — model auto-detection: maps a bus `Fingerprint` (answering pages + capacity)
  against per-profile signatures to a candidate set (see the Auto-detection section). Pure, so the
  narrowing rule is asserted on the host against the real derived signatures.
- `logic/board_pins.hpp` — the ESP32-S3 chip-safe GPIO set (excludes SPI flash, strapping, USB-JTAG
  and dedicated JTAG pins; an `octal_spi` flag additionally excludes GPIO33-37 on builds whose
  flash/PSRAM run Octal I/O, derived from Kconfig at the `http_status.cpp` call site). Deliberately
  NOT a claim about what any specific board breaks out to a header — firmware has no way to learn
  that (no board-ID EEPROM), so the list is a chip-level safety floor, not a board-specific one.
  Feeds `/status.pins_avail` and hence the dashboard RX/TX pin dropdown. Pure, so both list variants
  are asserted host-side (sorted, in range, and each excludes exactly its reserved pins).
  `board_pin_offerable()` is the membership test for that same set, and it is what makes the list a
  **rule** rather than a UI convenience: the dropdown filter can only constrain the dashboard, so
  before it existed a `curl POST /set_hp` could route the X10A UART onto the SPI-flash pins — flash
  traffic corrupts, the board crash-loops, and the toxic pair is already persisted, so every
  subsequent boot re-tries it. Both the request path (`validate()`) and the load path
  (`config_load()`) now apply it, so neither a POST nor a stale NVS link cache can hold a
  pair the UI would not have offered. They reach it differently on purpose: `validate()` calls
  `board_pin_offerable()` once per pin so it can name the offender (`"rx_pin is a reserved GPIO"`),
  while `config_load()` takes the combined `link_pins_safe()`, which folds the pair rule and both
  pin tests into one bool.
  A **second** set — `board_pin_local_io()` / `board_pins_local()`, surfaced as
  `/status.board.pins_local` — is what the status indicator and the recovery button may use. It adds
  back exactly the four dedicated-JTAG pads (GPIO39-42). Those are withheld from the X10A list as a
  *preference* ("don't spend a debug probe on a serial link when 20 other pins would do"), not
  because of a hardware conflict — and a preference cannot survive an onboard part soldered to one
  of them: the M5Stack AtomS3 Lite's only button is on GPIO41 (MTDI). Everything the chip hard-
  reserves (flash, octal flash/PSRAM, strapping, and GPIO19/20 which *are* the USB-Serial/JTAG
  console this firmware logs over) is still excluded from both sets.

  The **reservation runs in both directions**, and each list names its own. `board_pins_offerable()`
  takes `config_reserved_pins()` — the indicator + button, withheld from the X10A picker.
  `board_pins_local()` takes `config_link_pins()` — the live `rx`/`tx`, withheld from the LED and
  button pickers. It has to: `board_hw_valid()` rejects a local pin that equals either link pin, so
  a picker still listing GPIO44/43 was offering a choice whose only outcome is
  `400 "led_gpio is in use by the X10A link"`. `ReservedPins` is therefore deliberately anonymous
  about which pair it holds (`pin_a`/`pin_b`); the two factories in `logic/config_model.hpp` are
  where the direction is stated. The same second axis applies to `board_presets_offerable()`: a
  preset colliding with where the link currently sits is withheld, exactly as one colliding with an
  Octal build is.
- `logic/board_presets.hpp` — the same per-board facts made *applicable*. One published image serves
  every board, so the indicator and button are runtime settings seeded from Kconfig — and that seed
  is the XIAO's plain LED on GPIO21. On an AtomS3 Lite, whose only light is a WS2812 on GPIO35, the
  firmware then drives a pin with nothing on it: the board looks dead while being perfectly healthy.
  This table carries the five settings (`led_gpio`, `led_type`, `led_inverted`, `btn_gpio`,
  `btn_active_low`) for each **documented** board, served as `/status.board.presets`, so the Hardware
  modal fills them from one pick instead of asking the user to transcribe pin numbers out of
  [BOARDS.md](BOARDS.md). It lives in firmware rather than in `www/app.js` for the reason
  `lwt_select.hpp` exists: a browser-side copy would be a second statement of the same facts, free to
  drift, and a preset that fills pins the device then *rejects* is worse than no preset. Here, the CI
  logic test asserts every offered preset passes the very validator `POST /set_board` applies
  (`board_hw_valid`). `board_presets_offerable()` withholds a preset whose pins **this build**
  reserves — the AtomS3 Lite's GPIO35 is free on this project's Quad-flash build and is SPIIO4 on an
  Octal one — the same "a pick that cannot work is not a pick" rule the X10A dropdown follows. It
  asserts nothing about which board this *is* (still unknowable): picking a preset is the **user**
  telling the firmware what the hardware is.
- `logic/profile_view.hpp` — the active model's rows **as every consumer must see them**: the
  generated table plus the hand-written `def/overlay.hpp` supplement, as one indexable sequence. Four
  call sites read the row set and they are not independent — `hp_poll` decodes them, `mqtt_ha`
  announces one HA discovery config per row, and both `http_status` and `mqtt_ha` size their snapshot
  buffer from the row **count**. Grow the cache without growing the count and the extra values are
  silently truncated out of `/values` and MQTT: an absent-value bug with no error anywhere, the
  #35–#39 shape. Hence one view, not four merges. It carries the **overlay rule** (a supplement
  applies only if the base already references its page), which is what keeps a hand-written block from
  doing what hand-editing a generated table would do — move detection — or adding a per-cycle bus
  round-trip that, on a model which does not answer the page, reads on `/diag` exactly like a wiring
  fault.
- `logic/feature_gate.hpp` — which derived features may **honestly** run on the detected model, and
  the answer when they cannot: **disable, never degrade** (issue #69 step 0.2 / #110 Part C). It is
  the same rule the UI already applies twice — `lwt_select` blanks ΔT/heat/COP rather than
  substituting a setpoint (#121), `ou_stale` blanks a held-over pill rather than showing a dimmer
  register of half-valid numbers — because a reduced feature set is that already-rejected second
  vocabulary wearing a new name, and because a model fit on a feature vector does not degrade
  gracefully when columns disappear, it just becomes confident about a distribution it never saw.
  Coverage is read off the **rows**, not off `profile == "generic"`: `generic` is the extreme case
  (measured: no leaving-water measurement, only the setpoint `lwt_select` correctly rejects; no INV
  frequency, expansion valve or pressure row at all) — but sixteen of the 43 **detectable** profiles
  also lack page `0x30`, and with it the compressor run-state input. An id check would have let
  inference run without run-state on more than a third of the detected catalog. No firmware caller
  yet (#69 Phase 3 has not landed); pure and host-tested so the policy is asserted rather than
  re-litigated at the future call site.
- `logic/redact.hpp` — what a diagnostic snapshot must **not** carry when it leaves the device, for
  `GET /status?redact=1` and `GET /diag?redact=1`. A bug report is filed as a *public* GitHub issue
  carrying the device's own status, readings and log ([`REPORTING.md`](REPORTING.md)), which is only
  defensible because the board scrubs first — so this is the single implementation of that rule,
  shared by the web UI's "Report a bug" action and the manual `curl` fallback, rather than a copy in
  `www/app.js` that would drift. Two shapes, because the routes leak differently: `/status` leaks by
  **field** (seven named values, substituted where each is *written* — a post-processing pass over
  the finished JSON is what the httpd stack budget has no room for), `/diag` leaks by **line**,
  which is the non-trivial half the `CHECK`s cover. It **fails closed**: a rule whose end token is
  missing — a line the ring truncated mid-value, precisely when a value sits unterminated at the
  end — redacts to end of line rather than giving up, while the trailing newline survives so the
  ring's line structure does. The **value** is replaced and the **key** kept: a dropped field is
  indistinguishable from an older build, and forging that signal would mislead the very triage the
  report exists to feed. Its `/diag` half is an allowlist, so
  [`scripts/run-redaction-audit.sh`](../scripts/run-redaction-audit.sh) gates it — a new
  `diag_printf` interpolating a hostname is otherwise uncovered with no symptom but a correct-looking
  log line containing a real value.
- `logic/json.hpp` — the RFC 8259 string encoder every JSON payload goes through: `/status`,
  `/values` and `/scan` (`http_status.cpp`'s `jstr`), `/ota/status` (`json_quote`), as well as the
  MQTT state, heartbeat and crash topics. It escapes `"`, `\` and **every** control byte below 0x20 (`\b\f\n\r\t`, else `\u00XX`),
  while passing raw UTF-8 through untouched. Not a detail: the strings it encodes are not all ours —
  an SSID is arbitrary bytes chosen by any AP in radio range, and escaping only `"` and `\` (as this
  did before) let an AP named `Free<LF>WiFi` emit a raw newline inside a JSON string, so the whole
  response failed `JSON.parse`. That first broke the setup portal, which parsed `GET /scan` to fill
  an SSID dropdown; the portal now takes a **typed** SSID and fetches nothing, but the same bytes
  still arrive through `/status.wifi.ssid` (the associated AP names itself) and `/scan`, where one
  bad field takes down the entire response. This sits *beneath* the DOM escaping of a rendered SSID
  (issue #52, fixed in #65) and is orthogonal to it: that fix stops hostile SSID *markup* from being
  interpolated, while this one
  only guarantees the bytes **parse** — an SSID of `"><script>` is already valid JSON here, and a
  body that fails `JSON.parse` never reaches those DOM nodes at all. Pure, so each control char is
  asserted host-side, including the signed-`char` trap that would otherwise mangle a non-ASCII SSID.
- `logic/mqtt_group.hpp` — register page → friendly group name, plus the grouped state JSON for the
  one shared state topic (depth 1, groups/keys in first-seen order). Numeric-vs-string typing is
  asserted host-side, so a reading can't reach HA quoted and land as a string sensor. Text values are
  escaped through `logic/json.hpp`.
- `logic/mqtt_uri.hpp` — broker URI → host/port/TLS split behind `mqtt_ha`'s scheme policy: scheme
  defaults (`mqtt://` 1883, `mqtts://` 8883, `ws://` 80, `wss://` 443 — the WebSocket transports take
  the HTTP(S) ports **esp-mqtt itself** defaults to, so the save-time pre-flight probes the port the
  client will really dial), IPv6 literals, a **URL path** (`wss://host:8084/mqtt` — the normal shape
  of a WebSocket broker; the path is trimmed off the pre-flight's host/port, and esp-mqtt still gets
  the full URI), and the rejects (empty, scheme with no host, empty or non-digit port, and a port
  outside 1–65535 — caught at parse time because the probe's `htons()` would truncate `:65537` to
  `:1` and call a wrong port reachable).
- `logic/heartbeat.hpp` — the board/link diagnostics JSON (a flat object, each field prefixed by its
  block name: `wifi_rssi`, `wifi_mac`, `bus_rx_received`, …) + its 19 diagnostic HA discovery configs,
  with the dBm → signal-quality curve and uptime formatting pinned to known-good samples. Includes
  the SNTP wall clock (`sntp_time.cpp`) as a `device_class: "timestamp"` sensor — HA's native
  "last updated N ago" entity, rendering `null` (unsynced) as its normal "unknown" state rather than
  a fabricated epoch date.
- `logic/crashinfo.hpp` — reset-reason slug + fault classification, and the `last_crash` / MQTT crash
  payload + paste-friendly text bundle (incl. the backtrace clamp) built from a captured summary. The
  retained MQTT crash payload (`build_crash_mqtt_payload`) is **crash-only**: the JSON when the boot is
  *notable* (a real fault or a core-dump still in flash), else `""` — the bridge publishes that as a
  zero-length retained message to **clear** the topic, so no crash message lingers after a clean boot.
- `logic/reset_reason.hpp` — maps a raw `esp_reset_reason()` code to the stable slug used by
  `/status.sys.reset_reason` and the heartbeat, reusing `crashinfo`'s table so there is one
  vocabulary — a parity check asserts the two never drift apart.
- `logic/boot_guard.hpp` — the boot-loop safe-mode decision logic (crash-only reset classification,
  saturating crash counter, threshold rule) behind `safe_mode.cpp`; asserted host-side so the "enter
  on the Nth crash, never on a provisioning reboot" contract can't silently regress.
- `logic/bootlog.hpp` — the boot records `syslog.cpp` replays once per boot: a build-identity line
  (`build_boot_line`) and the crash rendered as **single-line, datagram-sized** records
  (`build_crash_log_lines`). Separate from `crashinfo.hpp`'s multi-line `build_crash_text()` on
  purpose: at worst case (16-deep backtrace + 64-char ELF hash) that block is ~340 bytes and would
  truncate through the backtrace and lose `elf_sha256` in diag's 256-byte line buffer. The host test
  asserts each record fits one datagram, and that a non-notable boot yields **zero** crash lines.
- `logic/link_watch.hpp` — the ICMP gateway-watchdog policy behind `wifi.cpp`: the three-valued probe
  result (reachable / proven-silent / unmeasurable) and the consecutive-observation counters that
  decide when to force a re-association. Keeping "could not measure" distinct from "reachable" is the
  whole point — folding them together made a permanently *blind* watchdog look identical to a healthy
  one. Pure, so the ghost-association rule (and its deliberately slower blind threshold) is asserted
  without staging a real missed deauth.
- `logic/wifi_rollback.hpp` — the credential-rollback policy behind `wifi.cpp`'s boot window: what a
  disconnect reason says about the **credentials** (`Auth` = the AP reached us and refused them —
  evidence; `ApAbsent`/`None`/`Other` = a router still rebooting, or DHCP still running — no evidence
  at all), and how long to wait on each before restoring the backup. A rollback destroys the new
  credentials, so absence of evidence must buy patience: only the AP's own "no" is allowed to be fast.
  Pure, so the rule is asserted without power-cycling a router for three minutes.
- `logic/syslog_policy.hpp` — classifies a `sendto()`/`socket()` errno as **hard** (destination or
  route is at fault → re-resolving now is worth it) vs **transient** (the stack momentarily could not
  take the datagram → keep the resolved destination). This is what stops the syslog send storm: on a
  ghosted link every send fails, and forcing a fresh DNS + blocking ICMP probe per failed line ran
  hardest exactly when the network could least carry it. Unknown errnos default to transient by
  design — the asymmetry is asserted host-side.
- `logic/timestamp.hpp` — `rfc3339_utc(unix_s, ms)`, the one UTC formatter the SNTP wall clock
  (`sntp_time.cpp`) renders through for `syslog.cpp`'s RFC 5424 TIMESTAMP field, the top-level
  `/status.ntp` block, and `mqtt_ha.cpp`'s heartbeat `"time"` field. A negative `unix_s` —
  `sntp_time.cpp`'s "never synced" sentinel — returns `""`
  rather than a plausible-looking `1970-01-01`, so a caller can tell "no wall clock yet" from a real
  epoch-adjacent instant and fall back to the RFC 5424 NILVALUE / JSON `null` instead. Pure, so the
  leap-year/year-boundary calendar math and the millisecond zero-padding are asserted against known
  instants on the host rather than only once a real NTP reply lands on a board.
- `logic/health_gate.hpp` — the OTA commit/wait/give-up verdict across the base window and the hard
  cap, including the setup-AP case where no credentials means connectivity isn't expected and the
  image is healthy anyway. Pure, so the rule that decides whether a new image sticks is testable
  without flashing one.
- `logic/version_cmp.hpp` — the OTA **downgrade gate**: numeric dotted-version ordering
  (`1.10.0 > 1.9.0`, which a `strcmp` gets backwards) and `ota_is_upgrade()`, which accepts only a
  strictly-newer candidate and **fails closed** on anything it cannot parse. A signature proves a
  build is authentic, not newer, so this is the only thing standing between the update feed and an
  authentically-signed downgrade — hence pure and host-tested rather than an inline comparison.
- `logic/ota_manifest.hpp` — bounded extraction of the top-level `"version"` from the OTA manifest.
  The one place a remote, attacker-influencable byte stream is parsed on this device, so it is pure
  and host-tested: it allocates nothing, never reads past the length it is given, only accepts the
  key at depth 1 (a nested `"version"` cannot shadow it), honours string escapes (so a crafted value
  cannot close its own string and inject a second key), and **refuses rather than truncates** an
  oversized value — a truncated `1.10.0` → `1.1` is a well-formed version that is ordered wrong.
- `logic/modbus.hpp` — Modbus TCP framing (MBAP, no CRC; FC03/04/06/16 build + response/exception
  parse) and the HomeHub `Temp16`/`Pow16`/`Int16`/`Text16` codecs + `homehub-*` mDNS filter. Host-
  tested core for the **planned** firmware-exclusive HomeHub link (issue #32) — not yet wired in.
- `logic/ws_policy.hpp` — what an `/events` frame means, split across the two moments the handler has
  to decide. `ws_frame_plan()` judges the **announced** length alone — the value `httpd_ws_recv_frame`
  reports from the header before a single payload byte is read, which RFC 6455 lets a client set to
  any 64-bit number. On a chip whose binding limit is the largest contiguous free block, that number
  may reach a decision but never an allocation, so a frame is measured against a fixed 16-byte command
  buffer and refused if it does not fit. Refusing has to mean *closing*: the IDF fails an oversized
  read with `ESP_ERR_INVALID_SIZE` and leaves the body in the socket, and offers no way to skip it, so
  the alternative is a stream in which the unread payload becomes the next frame's header. `ws_frame_action()`
  then classifies only bytes a successful read delivered. Pure, so the boundary that caused the
  original defect — one byte past the buffer, where the old handler `memcmp`'d stack the failed read
  had never written — is asserted without a hand-built WebSocket client.
- `logic/ws_tx_gate.hpp` — bounded backpressure for `/events` broadcasts. ESP-IDF's cross-task
  helper shallow-copies the frame into a queued work item, so the payload must remain alive until a
  completion callback. Each values/status stream admits one batch at a time; a busy gate drops a
  newer tick rather than retaining payloads without limit when the HTTP task cannot drain its work
  queue. The streams are independent so one slow values frame does not suppress every status update.
  The firmware shares one immutable payload across the batch and releases it only after the last
  callback; the pure gate transition is host-tested without ESP-IDF.
- `logic/http_body.hpp` — request-body reassembly for `http_read_body`. A POST body is a TCP stream:
  `httpd_req_recv` returns what has arrived, and the IDF's own docs note a large body "may" take
  several calls. Reading once and calling it the whole body truncated any body split across segments,
  so a valid POST came back 400 "bad json" — rare on a quiet LAN, reliable on a busy one, and looking
  for all the world like the user mistyped their broker. The loop is templated over a classified recv
  so segment-by-segment delivery, a mid-body close and a stalled peer are CI-gated CHECKs rather than
  a segmentation pattern nobody can ask a real client for; `http_common.cpp` keeps only the part that
  is genuinely IDF's — mapping `httpd_req_recv`'s return codes onto the three cases. A timeout is
  retried, but a **bounded** number of times: unbounded patience would let one client that announces a
  Content-Length and goes quiet park the single httpd task, taking the web UI and the OTA route out of
  a bad config with it.
- `logic/http_surface.hpp` — the HTTP trust-surface boundary (F01). `http_surface_serves(surface,
  path, is_post)` says which routes each surface exposes: on the trusted STA LAN, everything; on the
  OPEN setup AP, ONLY `GET /`, `/index.html` and `POST /set_wifi` — `/scan` included in what is
  withheld, since the portal takes a typed SSID and an open radio has no reason to be handed a
  survey of every AP in range. `http_start()` picks the
  surface from the WiFi mode and every concern registers through `http_register_on()`, so `/coredump`,
  `/diag` and the config/OTA/MCP routes never exist on the unauthenticated radio. Host-tested so the
  allow-list is asserted, not re-derived per file.
- `logic/query_flag.hpp` — `query_flag_on(value)`: a `?clear=1`-style flag fires only on exactly
  `"1"`. `httpd_query_key_value` succeeds on key PRESENCE, so acting on that alone let `?clear=0` wipe
  the diag log / coredump; the policy is now one host-tested predicate used by `/diag` and `/coredump`.
- `logic/config_store.hpp` — the atomic config blob (F02): `config_blob_serialize` / `deserialize`
  pack the credential + service fields (WiFi creds + rollback backup + flags, MQTT, syslog, NTP) into
  one length-checked, CRC32-protected byte blob written to a single NVS key. A single `nvs_set_blob`
  is entry-atomic, so the blob is all-or-nothing across BOTH a mid-write NVS failure AND a power cut
  — no per-key rollback, no write-ordering. The separate self-healing link-cache writes do not undo
  that commit: ordinary service routes succeed once their blob lands, while `/set_hp` explicitly
  requires the cache (`config_save_succeeded`, host-tested). `deserialize` returns false (leaving its
  out-param untouched) on any corruption, so a fresh device / a pre-blob OTA falls back to the legacy
  per-key load. Host-tested: CRC golden vector, round-trip, and every corruption path (bad
  CRC/magic/version, truncation, trailing garbage).
- `logic/mcp_jsonrpc.hpp` — the JSON-RPC 2.0 response policy for the planned `/mcp` route (F14):
  `mcp_jsonrpc_decide()` maps a request's shape (valid JSON? object? `"jsonrpc":"2.0"`? string
  `method`? id kind) to the interim response — `-32700` parse / `-32600` invalid-request / **no
  response** for a notification / `-32601` method-not-found — plus which id may be echoed (only a
  number/string/null, never an array/object/bool). Host-tested; `mcp_server.cpp` only extracts the
  shape with cJSON and renders the decision.

`hp_convert.cpp`, `hp_comm.cpp`, `config.cpp`, `mqtt_ha.cpp` are thin device wrappers that call
these headers. Add new decode/format logic to `main/logic/` and a `CHECK` in
`test/test_logic.cpp` — never bury it in a `.cpp` that only the device can run.

The wire-level protocol these headers implement — frame layout, checksum, register pages, the unit
detection handshake — is specified in [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md); the converter-id
formulas, enum tables and a full register map are in [`REGISTERS.md`](REGISTERS.md).

## Value-definition profiles (runtime-selectable models)

The single biggest UX change: **no editing a config header + a `def/*.h` by hand.**

- Each value is a `ValueDef{reg, offset, conv, size, type, label}` row; one model profile is an
  array of them, embedded as `const` in `main/def/<profile>.hpp`. The tables are machine-generated
  from the X10A value definitions (see [`REGISTERS.md`](REGISTERS.md)) — curated to the useful
  monitoring values — and `def/registry.hpp` maps a **profile id** to its table. The generator is
  **offline tooling maintained outside this repo** (there is no `tools/` directory on `main`): it
  decodes Daikin's proprietary value catalog (encrypted `.ldd` = zlib + NRBF) into these tables
  (`gen_profiles.py`) and the id→name table (`gen_names_generic.py`). Generated tables are never
  hand-edited — they are regenerated, and their rows verified against [`REGISTERS.md`](REGISTERS.md).
- **One hand-written supplement exists, and it is temporary: `def/overlay.hpp`.** Every generated
  profile carries six rows for page `0x10` where [`REGISTERS.md`](REGISTERS.md) §5 documents
  twenty-six — uniformly, all 43 tables agreeing row-for-row, so it is the generator's page-`0x10`
  input that is narrow, not a per-model absence. Among the missing rows are the **protection-retry
  counters** (offsets 10–12, converters 303/307/310/311), the input signal for the "silent protection
  retries" early warning (issue #69 UC5 / #110). Converter 310 has been implemented since PR #111 but
  had no row to decode, so it decoded nothing in the field. The supplement supplies those rows without
  touching a generated table, and `logic/profile_view.hpp` presents *generated + supplement* as one
  row sequence to every consumer. **The overlay rule — a supplement block applies only if the base
  profile already references its register page** — is what makes this safe where hand-editing a
  generated table would not be: it can never set a page bit that was not already set, so it cannot
  move detection (`def/signatures.hpp` builds its mask over the base tables and never sees a view
  anyway) and cannot add a bus round-trip. The rows are audited like generated ones —
  `tools/domain/catalog_audit.cpp` resolves the view, so they are cross-checked against
  [`REGISTERS.md`](REGISTERS.md) §5 per profile. **Delete this file and its plumbing when
  `gen_profiles.py` emits the rows**; a supplement that outlives its generator run is a second source
  of truth for the catalog.
- At runtime `config` holds the active `profile` id. The poll engine expands it to the concrete
  register set to request — every value of the profile except rows flagged `ValueDef::no_publish`
  ("detect-only"). There is no *user-facing* enable mask; the flag is a catalog property for
  absent-feature registers, and a page whose rows are **all** flagged is never even queried. Such a
  row is deliberately **kept** in the table rather than deleted, because a profile's detection
  signature is the set of pages its rows reference (`def/signatures.hpp`) and `detect_candidates`
  picks maximal page overlap — deleting it would cost the correct profile a page and hand the match
  to a feature-richer wrong one. Labels are English-only — there is no `lang` field.
- The `/models` endpoint serves the catalog (`def/models_catalog.hpp`): the profile list + pin
  hint. Detection is fully automatic (see the Auto-detection section) — the web UI shows the
  detected model read-only, so this is metadata only; there is no manual model dropdown.
- Flash cost is bounded by embedding **only the value tables** (a few hundred rows × families),
  not the whole source tree; labels are English-only. If size ever pressures the 4 MB layout,
  profiles can move to a data partition — the indirection through `def/registry.hpp` makes that a
  non-breaking change.

Porting fidelity is enforced on the host: `test/test_defs.cpp` checks a sampling of profile rows
against the source rows so a regenerate can't silently drift.

## The poll engine (`hp_poll.cpp`)

A single task owns the X10A UART (there is exactly one link). Each cycle:

0. Resolve the active profile to its **row view** (`def::resolved` — the generated table plus the
   page-`0x10` supplement above). Everything below iterates the view, and so do the HA-discovery
   announcer and the two `/values`/MQTT-state buffer sizings: the row **count** is the exact upper
   bound on cached values, so a consumer reading a shorter row set than the cache would silently
   **truncate** values out of `/values` and MQTT rather than error.
1. Build the ordered list of **registers** needed by the profile's values (dedup — one register
   read serves all its values).
2. For each register: send the protocol-`I`/`S` request, read the fixed-length reply with a
   `SER_TIMEOUT`, CRC-check it. On timeout/CRC error, stage it (`crc_err`/`timeout_err`,
   `last_error`) in locals and continue — one bad register never stalls the whole cycle.
3. Extract each value from its register buffer via `(offset,size)` and convert it via its
   `convId`. Write the results into the **thread-safe value cache** — and fold the staged stat
   deltas into `s_stats` — under the mutex, in **one** commit at the end of the cycle. The sweep
   itself never touches shared state: the readers (`hp_stats()`) copy `s_stats` under the same
   mutex, so an unlocked mid-sweep write to `last_error` would free a `std::string` buffer under a
   reader. See *Memory constraints* for why the commit must also stay non-allocating.
4. Feed the **24-hour trend rings** (`history_record()`, `history.cpp`) — *before* that commit and
   *outside* the cache mutex, while this cycle's values are still the task's own. `history.cpp` takes
   its own lock; holding both would create a two-mutex order this file has no other reason to have.
   Cheap by construction: it resolves the trended rows, folds one sample into each open 5-minute
   bucket, and only writes a ring when a bucket boundary is crossed. The fold is where the
   held-over rule earns its place — a sample taken while the compressor rests is stored as *held
   over*, not as the number the frozen outdoor page keeps returning (`logic/history.hpp`,
   composing `logic/ou_stale.hpp`).
5. Sleep `POLL_INTERVAL_S` (fixed 1 s — see `config.cpp`). The MQTT bridge and HTTP `/values` read
   the cache; they never touch the UART. The trends are **not** published to MQTT — they exist for
   the web UI, and Home Assistant already records its own history for every entity.

Config changes from the web UI (`/set_hp`) apply live: the task rereads `config` at the top of the
next cycle (pins/protocol changes re-init the UART). No reboot needed for model/pins — only
WiFi/MQTT changes reboot (they re-init network stacks).

**Task Watchdog.** The poll task is the one worker that does real, potentially-blocking I/O (the
X10A UART reads), so it subscribes itself to the ESP Task Watchdog Timer (`esp_task_wdt_add`) and
feeds it (`esp_task_wdt_reset`) **at the top of every cycle and once per register during the
sweep** — a slow-but-progressing 9600-baud sweep (worst case a silent bus, ~13 regs × 300 ms ≈ 4 s)
keeps feeding it, so only a genuinely *stuck* read trips the 20 s timeout. The idle-task watch
catches CPU starvation; this adds the blocked-but-still-scheduled case it can't see. On a trip,
`CONFIG_ESP_TASK_WDT_PANIC=y` turns the hang into a clean reboot whose `esp_reset_reason()` is
`ESP_RST_TASK_WDT` — classified as a fault by `logic/crashinfo.hpp` and surfaced on
`/status.last_crash` + the retained MQTT crash topic (see *Diagnostics*). The detection pass
(`poll_detect()`, ~7 s worst case) is bounded by the same per-cycle reset, so it needs no internal
feed. Config keys live in [`sdkconfig.defaults`](../sdkconfig.defaults).

## Auto-detection (protocol + model) — `hp_detect.cpp` + `logic/detect.hpp`

The goal is **zero manual model/protocol picking** where the bus allows it, on **every boot**. The
**model** is never persisted: `config_load` always seeds `Config::profile` with the sentinel
`"auto"`, so a fresh identification runs after every reset (a swapped unit is re-identified). The
**link** (RX/TX pins + protocol) *is* persisted as a boot-invariant cache — loaded first, tried
first, re-saved on change — with the compile-time defaults as fallback so a stale cache self-heals.
The loaded pins are re-checked with `link_pins_safe` — the **pair** rule plus the chip-reserved-pin
rule, the same ground the request path covers via `validate` — and dropped for those defaults if they
fail: both write paths — `config_save` and
`config_save_link` — commit `rx_pin` and `tx_pin` as two independent, **self-healing** NVS keys
(the link cache is deliberately NOT in the atomic credential/service blob — it has two owners and is
re-validated on load), so a **power cut** or a write failure between them can leave a pair on flash
(`rx == tx`, a pin outside this chip's range, or a reserved flash/strapping/JTAG pad) that no request
could have set. Naming the failing key on `/diag` reports that write; it does not undo the
one that landed, which is why the check belongs on the way back in. The sweep already skips an
`rx == tx` candidate on its own, so this is a guard rather than a repair; what it adds is the two
checks the sweep lacks — the upper GPIO bound and the chip-reserved-pin rule — and a `/status` pin
readout that never reports an unconfigurable link as fact.
While `profile == "auto"`, the poll task runs one detection pass (`poll_detect()`) instead of a
normal cycle. These passes are **not** run blindly every second: on a **silent bus** the sweep backs
off from the 1 s poll cadence toward a 60 s ceiling (`logic/detect_backoff.hpp`, host-tested),
applied by *skipping ticks* so the top-of-cycle watchdog reset still fires every second (the ceiling
is a detection-latency choice, not a watchdog constraint). The backoff resets to full cadence the
instant the bus answers, or on `POST /detect` / `POST /set_hp` (`hp_poll_reconfigure`), so a
just-wired unit is still identified promptly. A pass does:

1. **Pin + protocol sweep** — try the identity page `0x00` on candidate RX/TX pairs (the cached
   pins first, their **swap** — a reversed X10A wire is the commonest mistake — then the per-target
   default and its swap) × protocol (cached framing first, then the other); keep the pins **and**
   framing that return a valid CRC-checked reply instead of `15 EA`. Only X10A-designated pins are
   probed (no arbitrary GPIO). The UART driver is **installed once** and each candidate is a
   register-only pin remap (`uart_set_pin`), not a driver reinstall (`logic/uart_plan.hpp`,
   host-tested) — the old reinstall-per-candidate allocated a fresh RX ring + driver struct on every
   swap and, on a silent bus that alternates pins forever, fragmented the heap into an `abort()`. The
   winning pins/protocol are re-persisted only when they changed (a UI pin override survives reboot);
   an unchanged link is confirmed with no NVS write.
2. **Page probe** — query every page any profile can reference (`0x00,0x10,0x20,0x21,0x30,0x60–0x65,
   0xA0,0xA1`) plus `0x11`; set a bit in a **page mask** for each page that answers.
3. **Capacity + EEPROM** — read the O/U capacity from page `0x00` offset 12 (0.1 kW units) and the
   O/U EEPROM identification digits from page `0x11`. The `0x00` descriptor is **variable-length**: a
   smaller unit returns a short reply that omits offset 12 (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md)),
   leaving the O/U capacity unknown. When it is absent, the **I/U capacity code** (page `0x60` offset 6,
   same 0.1 kW units) is captured as a fallback so the model can still be classed.
   Both capacities are carried into the fingerprint (`fp_kw_tenths` / `fp_iu_kw_tenths`) and reported
   **separately** on `/status.detect` (`capacity_kw` / `capacity_kw_iu`). The I/U code was previously
   consumed inside the ranking and then dropped, which left the Model card with no capacity at all on
   every unit with a short descriptor. They are kept apart rather than merged because they measure
   different halves of the plant and are routinely different sizes — a 6 kW outdoor unit under an
   8 kW indoor unit is an ordinary pairing — so a merged field would report one unit's size under
   the other's name. The UI labels which one it shows.
4. **Raw dump** — the wire bytes of pages `0x00`, `0x10`, `0x20`, `0xA0` and `0xA1` go to `/diag`, one
   line each (`logic/hexdump.hpp`), only on a detect pass. Every other surface the device offers is
   *decoded*, so an impossible reading cannot be attributed to a wrong converter vs. a wrong byte
   offset vs. a per-unit layout difference without these bytes — and they otherwise never leave the
   board. `0x00` also makes the short-descriptor case above directly observable (`len=` vs. the
   expected ≥13). `0x10` and `0x20` are there for a sharper reason: a reading can be physically
   impossible and still sit *inside* `reading_plausible()`'s ±200 °C window, where nothing masks it —
   measured on a live unit, `Target Evap. Temp.` (`0x10` offset 6) reached **199.6 °C**, 0.4 °C under
   the ceiling, and the two outdoor pressures (`0x20` offsets 12/14) held **0.0 bar** through every
   sample taken while the compressor ran at 42 rps with 104.5 °C discharge, where an R32 high side
   runs 25–40 bar. Whether that is an absent sensor or a wrong offset is a question only the bytes
   can answer.

Those facts form a `Fingerprint`. The pure, host-tested `logic/detect.hpp` narrows the **Altherma-only**
profiles (`def/signatures.hpp::is_detection_model` excludes the non-Altherma mini-chillers so they
can't be false candidates): each profile's **signature** (its page mask + a capacity class parsed from
its id) is derived automatically from the embedded `ValueDef` tables — no hand-maintained table. A
profile is a candidate when its pages are a subset of the answering pages **and** the unit's capacity
falls in its class; among those, only the ones with **maximal page overlap** are kept (dropping
feature-poor profiles). `detect_best()` then picks one deterministic representative (maximal overlap →
kW class containing the known/derived capacity → tightest kW class → stable order) — never the old
blind `candidates.front()` registry order. The I/U-capacity fallback feeds only this **ranking**
(never candidate exclusion — indoor≈outdoor capacity is an approximation) and is a no-op when the O/U
capacity is known, so it only ever moves the pick for a unit that doesn't report O/U capacity — where
the candidate set spans kW classes and is therefore not register-identical.

The result is applied only when the bus actually answered (a not-yet-wired unit retries on the
backoff cadence instead of pinning `generic`); the model goes to the in-RAM config
(`config_set_model`), while a
changed link cache (pins/proto) is persisted (`config_save_link`). Both are **narrow, field-owned**
setters rather than a whole-`Config` save: detection reads its snapshot before a sweep that takes
seconds, so committing the whole struct would write that snapshot's stale credentials back over a
`POST /set_wifi` that landed meanwhile — reverting it silently, after the user was told `{"ok":true}`.
They patch only their own fields into the live config under its mutex (`apply_link` / `apply_model`
in `logic/config_model.hpp`, host-tested); whole-struct `config_save` remains for the HTTP handlers,
which own the credential fields and are serialized on the single httpd task.

- **exactly one candidate** → applied; the UI shows "Detected: <family> · ~kW".
- **several candidates** → the best-fit representative is read with — **every candidate is
  register-equivalent, so the decoded VALUES are identical regardless of which is named**. The 41
  Altherma models collapse to a few page-mask classes; within a class they differ only by untestable
  flag bits (e.g. an ERGA split vs an EBLA monobloc differ by one bit with identical labels), so the
  exact model **cannot** be determined from bus data. The UI reports this honestly — the distinct
  candidate **families** plus the O/U EEPROM digits to match the nameplate — rather than asserting a
  guessed name. Both are on the dashboard's Model card, beneath the brand heading
  ([`DESIGN.md`](DESIGN.md) §5.3 item 4), for a concrete reason: the brand alone reads as a *failed*
  detection, and was reported as one. The EEPROM is **not** decoded to a model name (no digit→name
  table; the one real path to exact ID would need an external EEPROM-code table).
- **none, bus answered** → the **generic Altherma profile** (`def/registry.hpp` `generic[]` = the ≥95%
  universal register core), so an unrecognized or S-protocol unit still reports every essential value.
- **no bus** → stays `auto` and retries; the UI reports the unit isn't responding (check X10A wiring).

The resolved `profile` and fingerprint (`fp_pages`/`fp_kw_tenths`/`fp_iu_kw_tenths`/`fp_eeprom`) live
only in the in-RAM config
— **the model is never persisted**, so it is re-identified on **every boot** (a unit moved to another
pump is always re-detected; no stale model survives a reset). The `proto`/`rx_pin`/`tx_pin` link cache
*is* persisted (see above). Within the session, `/status.detect` recomputes the candidates, their
distinct `families`, and the
`model{name,family,marketing}` display name from the in-RAM fingerprint cheaply (no re-probe; names
from `def/model_names.hpp`). `POST /detect` resets `profile` to `"auto"` and invalidates the
fingerprint to force a fresh pass immediately (no reboot needed). Detection is **fully automatic** —
there is no manual model selection or protocol control in the UI, and the UI shows model/protocol
only while the link is live (a cached fingerprint is never presented as a live reading).

## Push vs. poll (why the engine polls)

The X10A service port is a **strict request/response bus** — the ESP is always the master and the
unit only ever answers a query (see [`X10A_PROTOCOL.md`](X10A_PROTOCOL.md) §1). There is no
opcode, register or framing for the unit to send unsolicited/push frames, so **the firmware must
poll**; a "the pump pushes values to us" mode is not possible at the wire level. The pushes in the
system are all firmware → client: firmware → MQTT (the bridge publishes state on its own cadence)
and firmware → browser over the `/events` WebSocket (the poll task broadcasts values/status on
change). The WebSocket path applies one-in-flight backpressure independently to values and status:
if the HTTP task has not completed the previous batch, the next tick is dropped rather than queued
and retained on the ESP32 heap. Both transports are downstream of — and independent of — the polled
HP link.

## WiFi / LAN connectivity (reconnect + watchdog)

**Modem sleep is disabled** (`esp_wifi_set_ps(WIFI_PS_NONE)` right after `esp_wifi_start()`). The
IDF default `WIFI_PS_MIN_MODEM` parks the radio between DTIM beacons, adding ~100–300 ms (and, with
TCP retransmits, occasionally seconds) of non-deterministic latency to every inbound request — which
shows up as the web UI "sometimes taking very long to answer". This is a mains-powered bridge, so we
keep the radio awake for a consistently responsive HTTP UI and MQTT link.

**Strongest AP is selected, not the first one heard.** The STA config sets
`scan_method = WIFI_ALL_CHANNEL_SCAN` + `sort_method = WIFI_CONNECT_AP_BY_SIGNAL`. The IDF default
`WIFI_FAST_SCAN` stops at the first matching BSSID (channel-order/timing dependent), so on a
multi-AP network (mesh / several access points sharing one SSID) this stationary bridge would latch
onto whatever answered first — often a distant, weak AP — and never roam off it (the "weak WiFi
signal" symptom). The all-channel scan adds ~1–2 s per connect; the config persists, so every
reconnect re-selects the strongest AP. `failure_retry_cnt = 3` makes the STA **retry the ranked
(strongest) AP** a few times before falling back to the next one — without it the default (0) drops
to a weaker AP on the first association hiccup (observed live: a transient WPA3-SAE Hunt-and-Peck
auth failure on the −47 dBm AP handed the bridge a −74 dBm one). `sae_pwe_h2e = WPA3_SAE_PWE_BOTH`
advertises Hash-to-Element so the faster/robuster PWE is used when the AP supports it (H&P stays the
fallback). The `STA_DISCONNECTED` handler logs the disconnect `reason` (15/202/204 = transient
SAE/handshake, 201/211 = wrong creds) so a failed connect is diagnosable from `/diag`.

Three layers keep the WiFi station link up:

- **Event-driven reconnect** on every `WIFI_EVENT_STA_DISCONNECTED`. First-ever connect keeps a
  bounded budget then falls back to the **setup portal** (credentials presumed wrong); once the
  device has held an IP at least once, later drops reconnect **forever** (known-good creds — never
  strand the device on a transient AP/router outage).
- **Connectivity watchdog** (~30 s) ICMP-echoes the gateway to catch a missed-deauth "ghost"
  association (stack thinks it's up, forwards nothing). The probe reports what it **established**,
  three-valued — `Reachable` / `Unreachable` / `Unmeasurable` — and the policy is host-tested in
  [`logic/link_watch.hpp`](../main/logic/link_watch.hpp). After 2 consecutive *proven-silent* probes it
  forces one `esp_wifi_disconnect()` so the endless-retry handler reconnects. Guarded to act only on a
  believed-up link and only if the gateway has answered at least once; it **never reboots** (a
  reboot during an AP outage would drop into the setup portal and abandon good credentials).
  A probe that cannot be *taken* (`esp_ping_new_session` fails — the first allocation to go under
  memory pressure) is `Unmeasurable`: never counted as a failure, never trips the 2-period path. But
  folding that into "healthy", as this once did, made a permanently **blind** watchdog indistinguishable
  from a healthy link — and the pressure that blinds it is exactly what accompanies the wedge, so the
  failure mode disabled its own detector. A *sustained* inability to measure (10 periods, ~5 min — an
  order of magnitude slower, since acting on absence of evidence stays the last resort) therefore also
  re-associates; dropping the ghost makes the STA report itself down, which stops the traffic
  exhausting the buffers that blinded the probe. Decisions log via `diag_printf`, so they reach `/diag`
  + syslog → VictoriaLogs; the previous `ESP_LOGW` lines were serial-only, which is why a wedged board
  left no watchdog trace anywhere a post-mortem would look.
- **Credential-change recovery** for WiFi edited *from the dashboard* (see "Web UI config flow"):
  the one-shot `/set_wifi` backup lets a bad new SSID/password roll back to the last working network —
  distinct from the first-boot budget, which handles creds that were wrong from the start. What the
  device must **not** do is reboot on disconnect *reasons* once it has been online. An earlier revision
  did, after ≥5 consecutive AUTH_FAIL/handshake-timeout disconnects, on the theory that the router's
  password had been changed. But reasons 15/202/204 are also the transient WPA3-SAE failures this same
  file works around with `failure_retry_cnt`/`sae_pwe_h2e` — observed live on a *healthy* network — so
  a passing RF storm could reboot the bridge, spend the first-boot budget against an AP that was fine,
  and leave it in the open setup portal with good credentials in NVS and no way back short of a power
  cycle. That inverts the endless-reconnect invariant this layer exists to keep, and it bought little:
  a genuinely changed router password reaches the same portal on the user's next power cycle anyway.
  Once online, every reason is now just something to reconnect through.

## Home Assistant MQTT bridge (`mqtt_ha.cpp`)

The Home Assistant bridge:

- **Read-only** — no command topics. The firmware only mirrors X10A telemetry; it never actuates
  the heat pump (the X10A protocol has no write command), so there is nothing to subscribe to.
- **Node id = the installation, not the board.** The HA device id is the slugified MQTT base topic
  (`daikin-altherma-esp32` → `daikin_altherma_esp32`, `logic/ha_device.hpp`), so replacing the ESP32
  keeps ONE device with its entities, history and long-term statistics — where the old MAC-derived
  `daikin_<mac3>` produced a second device and restarted every statistic. The board's MAC id lives
  on as the **MQTT client id** (unique per connection) and a **second `dev.ids` entry** (HA matches a
  device by any identifier and merges, so a MAC-identified install is adopted rather than
  duplicated); the configs an older build published under it are retracted once per boot, right
  before each replacement is published, so the freed `entity_id` is reclaimed by the new entity.
- **Own publish task + esp-mqtt client.** The event handler only flips status flags; all publishing
  happens in the task, so the mqtt event loop is never blocked by string building.
- **Discovery is streamed.** A full Altherma value set can be 30–40+ entities; the bridge emits one
  entity's discovery config at a time (retained) on (re)connect, so it never needs one large
  contiguous heap block — the same memory discipline as the rest of the firmware. Layout-marker
  converters (docs/REGISTERS.md §3.6) get no sensor.
- **One shared grouped-JSON state topic** `<base>/state` (retained). The message topics sit directly
  under `<base>` — one board per base topic, so there is no `<node>` segment in the payload paths; the
  node id identifies the *device* only in each discovery config's `uniq_id`/`dev.ids`
  and its `<prefix>/<component>/<node>/…` discovery topic. Each cycle the task
  builds a single JSON object of every value, grouped one level deep by X10A register page
  (`logic/mqtt_group.hpp`, host-tested): `{ "<group>": { "<object_id>": value, … }, … }` (max
  nesting depth 1, e.g. `hydronic`, `outdoor_state`, `inverter`). Numbers are emitted unquoted,
  enum/text quoted. Every sensor's discovery config points at this one topic and subscripts its
  value out with a `value_template` (`value_json['<group>']['<object_id>']` — bracket notation, so a
  digit-leading slug like `2way_valve…` stays valid).
- **Units + device_class** are derived from each value's `dataType` field (the def's HA unit hint —
  1 = °C/temperature, 2 = bar/pressure, 3 = A/current; `unit_for_datatype`/`device_class_for_datatype`
  in `logic/convert.hpp`), so temperatures get `°C` + `temperature`, currents `A` + `current`, etc.,
  and HA renders them correctly with history.
- **Binary values are `binary_sensor`s carrying 1/0.** A bit-flag row (converter family 300-307 —
  `conv_is_binary` in `logic/convert.hpp`) decodes to the text `"ON"`/`"OFF"`, which is what
  `/values`, the web UI and the WebSocket show. On the wire it is re-encoded as the JSON **number**
  `1`/`0` (`binary_state_number`, `logic/mqtt_group.hpp`) and typed as an HA `binary_sensor`
  (`ha_component`, `logic/discovery.hpp`) whose config spells out `"pl_on":"1"` / `"pl_off":"0"` —
  HA's defaults are `"ON"`/`"OFF"`, and a mismatch leaves the entity silently at `unknown`. Both
  sites key on the one `conv_is_binary` predicate rather than on the decoded text, so the payload
  encoding and the entity type cannot drift apart. Every such row is `size 1`/`dataType -1`, so
  there is no unit or `device_class` to reconcile; a *meaningful* device class (`running`, `problem`,
  `heat`) is a per-label domain judgement and is deliberately **not** inferred.

  The number — not the text, and not a JSON bool — is the point: a metrics consumer stores numbers
  and drops both strings and bools, so all ~30 binary rows of a profile reached HA but never a graph.
  Measured on a live install before the change: of ~99 published values only the 58 numeric ones
  became VictoriaMetrics series. Builds before this published every row as a `sensor`; that stale
  retained discovery config is actively deleted for binary rows on each announce
  (`retired_sensor_discovery_topic`), so an upgraded install doesn't keep a duplicate,
  permanently-unavailable text entity. The entity domain changes, so HA history for these does not
  carry over.
- **Publish-on-change.** The heat pump is polled at a fixed 1 s interval for near-real-time readings,
  but the task republishes the state JSON **only when the payload actually changed** since the last
  publish (a plain string compare — a single JSON topic can't be updated per-value, so it is
  all-or-nothing). A full retained (re)seed goes out on (re)connect and when auto-detection resolves
  a new profile (which also re-streams discovery). So an idle pump does not flood the broker. The
  per-cycle build is wrapped in a try/catch: an OOM `std::string` build skips the cycle rather than
  throwing through the FreeRTOS task and rebooting.
- **Availability / LWT** on `<base>/status` (`online`/`offline`, retained) — the broker's
  last-will marks the device offline if it drops, and every sensor's `avty_t` points at it.
- **Heartbeat topic** `<base>/heartbeat` (not retained) carries board/link diagnostics, separate from
  heat-pump values, built by `logic/heartbeat.hpp` (host-tested). The payload is a **flat** JSON object
  — each field carried under its block name as a prefix rather than nested `wifi`/`mqtt`/`bus`
  sub-objects, so a Telegraf/InfluxDB line-protocol consumer and an HA `value_template` both read a
  plain snake_case key. The three connectivity flags (`wifi_connected`, `mqtt_connected`,
  `bus_connected`) are the numbers `1`/`0`, not JSON bools, for the same reason the state topic's
  bit-flag rows are — a metrics consumer drops a bool exactly as it drops a string, and these three
  were the only heartbeat fields that never became series. The `bus_status` `binary_sensor` declares
  the matching `"pl_on":"1"`/`"pl_off":"0"`; without it the entity inherits HA's `"ON"`/`"OFF"`
  defaults and sits at `unknown`. (The crash topic keeps `true`/`false` + a `| lower` template: it is
  an event payload, not a metrics stream, and its `binary_sensor` already reads correctly.)
  - **Board**: `version`, `platform`, `uptime_s` + a `"Ddd+HH:MM:SS.mmm"` `uptime` display string
    (`format_uptime`), `free_heap` / `min_free_heap` / `max_alloc` (largest free block — the
    binding OOM limit on this firmware), `reset_reason`, `time` (SNTP wall clock, null until synced).
  - **`wifi_*`**: `wifi_connected`, `wifi_rssi`, `wifi_quality_pct` (0-100%, `wifi_signal_quality_pct`
    — the standard dBm→% mapping, -50 dBm=100%/-100 dBm=0%), `wifi_reconnects` (cumulative RE-connects
    since boot, `wifi_reconnect_count()` in `wifi.cpp`, excludes the first-ever connect), `wifi_mac`
    (this STA's own MAC, always present) and `wifi_bssid` (the associated AP's MAC, null while offline)
    — the `/status.wifi.mac`/`.bssid` pair, now on the diagnostics stream too.
  - **`mqtt_*`**: `mqtt_connected`, `mqtt_count`/`mqtt_fails` (every `esp_mqtt_client_publish()` call
    funnels through one `mqtt_publish()` wrapper in `mqtt_ha.cpp` so these cover
    discovery+state+heartbeat+LWT, not just one topic), `mqtt_reconnects` (cumulative, excludes the
    first-ever connect).
  - **`bus_*`**: the X10A stats already tracked in `HpStats` — `bus_connected`, `bus_proto`,
    `bus_registers`, `bus_values`, `bus_last_ok_s`, `bus_rx_received` / `bus_rx_fails` (cumulative
    successful/failed register reads, `HpStats.rx_ok`/`rx_fail_total`), `bus_crc_err` /
    `bus_timeout_err` (breakdown), and `bus_tx_reads` (= `rx_received + rx_fails`, every register-read
    request sent) with `bus_tx_writes`/`bus_tx_fails` always `0` (reported for schema parity since the
    X10A bridge is read-only).

  Published on a fixed `HEARTBEAT_INTERVAL_S` (10 s) cadence — unlike the state topic, this is
  diagnostics rather than real-time telemetry, so it always sends the latest snapshot rather than
  only on change. 19 diagnostic HA entities (WiFi signal/quality/reconnects/MAC/BSSID, heap
  free/min-free/largest-block, uptime, last reset reason, the SNTP wall clock as a
  `device_class:"timestamp"` sensor, X10A bus status/CRC/timeout/rx errors/rx received, MQTT
  publish count/fails/reconnects — tagged `"ent_cat":"diagnostic"`) point at this topic via their own
  discovery configs, streamed once per
  connection independently of heat-pump profile detection — so they show up even while the model is
  still "auto". Cumulative since-boot counters get `"stat_cla":"total_increasing"` (not
  `"measurement"`) so HA's long-term statistics handle a reboot's reset to 0 correctly. Mirrors the
  "device diagnostics" pattern of other ESP32 HA bridges (e.g. EMS-ESP's `heartbeat` topic).
- **TLS default-on with credentials** (mqtts, CA-verified via the mbedTLS certificate bundle). If
  credentials are set but the URI is not `mqtts://`, the bridge **refuses to connect** and reports
  the reason in `/status.mqtt` rather than sending them in cleartext — no silent plaintext fallback.
  A credential-free plaintext broker on the trusted LAN is allowed (nothing secret to leak).
- **Task-Watchdog-subscribed.** The `mqtt_pub` publish task subscribes to the Task Watchdog and
  feeds it **unconditionally at the top of its 1 s loop** — deliberately *not* gated on `s_connected`
  or an actual publish, because the loop keeps spinning during a broker outage (it just doesn't
  publish), and a reset gated on publishing would false-trip. It **also** feeds once per publish
  inside `mqtt_publish()` (the funnel every message goes through), mirroring `poll_once`'s
  per-register reset: a single (re)connect cycle bursts ~30 publishes (discovery + crash + state +
  heartbeat) and each `esp_mqtt_client_publish()` can block up to the client network timeout, so
  without a per-publish feed a slow-but-alive link could push one burst past the 20 s budget. So only
  a publish that genuinely wedges reboots the device; see *The poll engine → Task Watchdog* for the
  shared mechanism.

## OTA, signing, partitions

Structure:

- **Target:** esp32s3 only (`scripts/ci-build-all.sh`). No BLE is used, so the target is just "WiFi ESP32-S3s with ≥4 MB flash". Uses native USB-Serial/JTAG console.
- **Dual-OTA `partitions.csv`** sized to fill 4 MB; app at `0x20000`; `nvs` at `0x9000` untouched
  by OTA so WiFi + model config survive upgrades. The Web Serial manifest likewise publishes
  sparse `flash_args` parts around NVS; its build-time sector-overlap check makes the no-Erase path
  preserve the same configuration.
- **Core Dump to Flash (Crash Archiving)**:
  - Enabled via `CONFIG_ESP_COREDUMP_ENABLE` and `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` in `sdkconfig.defaults`. The format is ELF — the only one IDF v6 emits, so no `CONFIG_*` selects it.
  - A dedicated `coredump` partition of size `0xc000` (48 KB) is placed at offset `0x12000` (in the unused gap between `phy_init` and `ota_0`), leaving the start offsets of `nvs`, `otadata`, `phy_init`, `ota_0`, and `ota_1` completely untouched for backward compatibility and OTA safety.
  - Exposed via a chunked HTTP GET endpoint `/coredump` (implemented in `http_status.cpp`) that streams the binary crash dump in 512-byte blocks to prevent OOM errors on the tight ESP32 heap.
  - Supports erasing the partition via `GET /coredump?clear=1` (invokes `esp_core_dump_image_erase()`).
  - **Boot-time capture + surfacing (so a crash isn't a silent blob in flash).** `diag_crash.cpp`
    runs once early in `app_main`: it reads `esp_reset_reason()` and, if a valid dump exists, parses
    its **summary** (`esp_core_dump_get_summary()` — crashed task, exception PC, backtrace PCs, and
    the crashed build's `app_elf_sha256`) into a cached `CrashInfo`. The pure formatting is
    `logic/crashinfo.hpp` (host-tested); the summary is parsed **once** and cached — never re-read
    from flash on a request path, since `build_status_json_string()` also runs in the poll task's
    WebSocket broadcaster (which only self-guards `std::bad_alloc` by dropping the frame). The
    `coredump` **presence flag** is the one exception: it IS re-checked from flash per request
    (`diag_crash_info_live()` — a 4-byte size-word read, not the summary reparse), because the image
    can be erased mid-session via `/coredump?clear=1` and a cached flag would then advertise a dump
    that flash no longer holds. A *fault* reset (panic / watchdog / brown-out / CPU lockup) or an
    orphan dump is "notable"; a clean power-on / software reboot is not.
  - **Always-on system health (no fault required).** `build_status_json_string()` also carries a
    compact `sys` block — `free_heap` / `min_free_heap` (since-boot low-water, the leak indicator) /
    `max_alloc` (largest contiguous block, the true OOM ceiling), the `reset_reason` slug (via
    `logic/reset_reason.hpp`, reusing the same vocabulary as `last_crash`) and a `safe_mode` flag
    (always `false` until the boot-loop safe-mode feature lands). These answer "why did it reboot?"
    and "is the heap leaking?" from the LAN / `/events` WebSocket **on every boot** and **without a
    broker** — the MQTT heartbeat carries the same heap figures, but only when MQTT is configured. The
    web UI reads only `safe_mode` (the recovery banner): the heap and reset figures were rows on the
    Settings ESP32 card through v1.0.14 and were removed — Settings states what the board is *set to*,
    and a diagnosis is made from `/status`, `/diag` and the heartbeat, not from four read-only numbers
    above the settings a user came to change (DESIGN.md §5.6).
  - **How a user hands a crash over.** `GET /status.last_crash` is `null` on a clean boot, else the
    boot-time cached reason/summary — with `coredump` re-read live from flash on every request
    (`diag_crash_info_live()`), so a dump cleared via `/coredump?clear=1` can't leave a stale banner or
    a dead download link. The running app's `app_elf_sha256` is also on `/status`. The web UI shows a
    crash **banner** (`renderCrashBanner()`) — titled on `fault`, so an orphan dump doesn't claim this
    boot crashed — with the reset reason + hex backtrace, a one-click `coredump.bin` download, and a
    "copy diagnostics" bundle (`/status` + `/diag` + summary) for a bug report. The MQTT bridge
    additionally **retains** the summary on `<base>/crash` as **one** diagnostic HA entity — a "dump
    waiting" flag (reason/backtrace only, never secrets or the raw dump), so Home Assistant (or
    Telegraf → VictoriaLogs) sees crashes over time. The reset reason is *not* a crash entity: it is
    the heartbeat's own "Reset Reason" sensor, so a crash entity for it would be a duplicate — the old
    "Last Reset Reason" crash entity was dropped and is now actively retired (its stale retained
    discovery config is deleted on upgrade via a zero-length retained publish). The topic is
    **crash-only**
    (`build_crash_mqtt_payload`): the summary is retained only when the boot is *notable* (a real fault
    or a dump still in flash); a normal boot (USB re-enumeration, config-save/OTA reboot, clean
    power-on) publishes a **zero-length retained** message that **clears** the topic, so no crash
    message lingers once the problem is resolved — the reset reason stays visible on the heartbeat's
    own "Reset Reason" sensor regardless. Published once per (re)connect **and** republished on the
    heartbeat cadence whenever the `coredump` flag changes, so a retained "Crash Dump Waiting" can't
    stay latched ON after the dump is pulled and cleared (and an orphan-dump-only boot is then
    re-decided not-notable and the topic cleared).
  - **Decoding (maintainer side).** A raw dump is useless without the *matching-version* unstripped
    `.elf` (the shipped `.bin` has no symbols), so CI archives `daikin-altherma-esp32.elf` + its
    sha256 per build (artifact + Release asset, `scripts/ci-build-all.sh`). `scripts/decode-coredump.sh
    coredump.bin [app.elf]` runs `esp-coredump info_corefile` inside the CI-pinned ESP-IDF Docker
    image and matches the dump to the ELF by `app_elf_sha256` (warns on mismatch). VictoriaTraces is
    *not* the sink for this — a crash is a log/event, not a span; VictoriaLogs (via the retained MQTT
    topic + Telegraf) is.
- **Two update channels** (`logic/ota_channel.hpp`, `POST /set_ota`, `/status.ota.channel`). A merge
  to `main` no longer cuts a release, so there are two published feeds and a device follows one:
  `release` (the gh-pages root, republished only by a **manual** workflow run that tags `v*`) and
  `dev` (`…/dev/`, republished by every firmware-relevant merge). The URLs are *derived*, not
  configured twice — the dev feed is by construction the `dev/` subdirectory of the configured
  firmware base URL, so the two cannot be pointed at different hosts. The channel is persisted in
  the config blob (v3) and applied **live**: nothing claims it at task start, `ota_update.cpp` reads
  it when it fetches, so a check right after the switch already reads the new feed. Dev builds are
  stamped `<next release>-dev.<n>` — a semver pre-release, so ordering does the work: a dev board
  upgrades to the next release on its own, and a release board never drifts onto a dev build.
  Switching *back* (dev → the last release) is a downgrade by version, which the gate below refuses
  unless the request explicitly carries `?downgrade=1`; the web UI sends it only after the user
  picks a channel and confirms. Without that the release channel would be a one-way door.
- **Signed OTA** (Secure Boot v2 RSA-3072 *without* hardware Secure Boot): the running app verifies
  the signature before installing. Fully implemented (`ota_update.cpp`) — manifest check,
  `esp_https_ota` download into the inactive slot, the **two-point downgrade gate** (manifest
  version *and* the image's own embedded `esp_app_desc_t` version, with exact artifact-version
  equality required, so a lying or stale manifest is refused), and the **connectivity health gate**
  (commit only after a base window AND getting
  online, else stay `PENDING_VERIFY` → a reboot rolls back). Both default feeds are live, and
  publishing runs on a private repo too (the Pages site is public either way — see
  [`README.md`](README.md)); a self-hosted URL with nothing served honestly reports "up to date".
  The web installer carves prepared sparse parts from the merged
  image so a no-Erase flash skips NVS; the single `manifest.json` lists those parts and also doubles
  as the OTA feed (esp-web-tools and the device load the same file).
- **Boot recovery / anti-brick** — an unsigned app aborts pre-`app_main`, so only the bootloader can
  recover, and only via a recorded previous OTA slot; a direct USB flash of an unsigned build both
  crash-loops and blanks the otadata rollback record. Contained by the pre-flash guard
  `scripts/require-signed.sh`. Full model,
  including the three failure modes and the health gate, in [SECURITY.md](SECURITY.md) → Boot recovery.
- **A PR publishes nothing** — it builds, signs and size-checks the image and keeps it as a build
  artifact. Every same-repo PR used to publish a signed preview installer at
  `…/PR/<N>/` on `gh-pages` as well, with a `pr-preview-cleanup` workflow removing it on close.
  That is retired: each preview was a `gh-pages` push, every `gh-pages` push starts GitHub's own three-job
  *pages build and deployment* run, and the **dev channel** already answers the same question —
  flash what is on `main` from a browser — for one publish per merge instead of one per PR commit.
  A `PR/<N>/` tree left on the branch by an old build is swept by the next release publish, which
  no longer spares that path.

## Boot-loop safe mode (config recovery)

The OTA rollback health gate recovers a bad *firmware image*. It does **not** help a bad *config* —
both OTA slots read the same `daik_cfg` NVS, so rolling the image back keeps the offending setting
(most plausibly wrong RX/TX pins, or anything that crashes a background task at start-up). Left
alone, that is a reboot loop whose only exit is `esptool erase_flash` over USB — which breaks the
"recover everything from the web UI" promise. Safe mode closes that gap:

- **Decision logic** is the pure, host-tested `logic/boot_guard.hpp`: `boot_reset_was_crash()`
  classifies a reset as a crash **only** for panic / interrupt-wdt / task-wdt / other-wdt / brownout
  (deliberately narrower than `crashinfo`'s fault set — a power-glitch or CPU-lockup a config change
  can't fix does not count); `boot_next_fail_count()` is a saturating increment that treats a
  corrupt/first-run read as 0; `boot_should_enter_safe_mode()` is the threshold rule
  (`BOOT_FAIL_THRESHOLD`, default 4).
- **Device glue** is `safe_mode.cpp`, called from `app_main` right after `config_load` and **before**
  any risky subsystem. On a crash reset it increments the `boot_fails` counter in `daik_cfg` and
  **commits it before** the poll engine / MQTT start (so the bump survives another crash), latching
  safe mode at the threshold. A clean or intentional reboot (power-on, a config-save restart, OTA)
  **resets the counter to 0** — this is the key correctness point, because provisioning is a rapid
  burst of config-save reboots that must never be mistaken for a crash-loop. A one-shot timer clears
  the counter after `BOOT_HEALTHY_S` (30 s) of continuous uptime, so a single old crash doesn't
  accumulate with a much later, unrelated one.
- **Every one of those NVS writes is checked, and the diag line reports what was *persisted*, not
  what was intended.** The counter is the whole mechanism: if the bump can't be written (full NVS,
  worn flash) each crash boot re-reads the same stale value and the threshold is never reached — the
  guard is silently out of action against a crash loop a wedged flash may itself be causing, so
  `safe_mode.cpp` says so explicitly (`err=` named via `esp_err_to_name`) rather than printing a
  count that only exists in RAM. A failed *clear* is the mirror case: the count accumulates across
  unrelated crash boots and can false-trip safe mode on a healthy device, pausing poll + MQTT. Note
  the write failing does **not** stop safe mode engaging *this* boot — `boot_should_enter_safe_mode`
  runs on the value just read — it only stops it accumulating across boots.
- **In safe mode** `main.cpp` starts only WiFi + the HTTP web UI + the OTA health gate and **skips**
  the X10A poll engine and the MQTT bridge (the two background subsystems a bad config could crash
  on). The full recovery surface (`/set_wifi`, `/set_mqtt`, `/set_hp`, and — once #9 lands — factory
  reset / import) stays available. `/status.sys.safe_mode` is `true` and the UI shows a warn-accented
  **Recovery mode** banner. The counter lives in `daik_cfg`, so a factory reset wipes it too.

This is distinct from the image anti-brick recovery above; both are covered in
[SECURITY.md](SECURITY.md) → Boot recovery.

## Web UI config flow

`www/` is split for edit locality (index.html markup + style.css + app.js) and spliced into ONE
self-contained, pre-gzipped page at build time (`inline_assets.cmake`). The UI is **two screens**:
the dashboard (the plant — schematic, model, values, no config at all) and **Settings** behind the
header gear (the Connections tile + the ESP32 board card, flat, no sub-screens). Settings drives the
config endpoints in place:

- **WiFi** → `/set_wifi`, provisioned first from the captive `setup.html` and thereafter **re-editable
  from a modal** off the Connections tile's WiFi row in Settings. Save validates SSID (1–32) +
  password (empty or 8–63) both in the UI and via the host-tested `wifi_credentials_valid()`
  (`logic/config_model.hpp`), then persists + reboots. The dashboard shows the live link (the PHY
  standard + signal bars/RSSI + SSID on the Connections tile's WiFi row, coloured `--ok`/`--err`, and
  the IP address under the product name in the header) from `/status.wifi`, populated by
  `wifi_info()`; MAC and BSSID are reported by the API but not shown in the UI. **One-shot rollback:** if new credentials were entered over the LAN and the STA can't
  get a lease after the reboot, `wifi_start_sta()` restores the previous credentials from an NVS backup
  and reboots again (cleared on a successful connect) — so a wrong SSID/password never strands the
  device in the setup AP. It reboots only once the restore has actually **persisted**: the restore lives
  in NVS alone, so rebooting on a failed write would re-read the same new credentials and roll back again
  on every boot. A failed restore opens the setup portal instead — reachable beats looping. The deadline is **reason-aware** (`logic/wifi_rollback.hpp`): only an AP that
  *keeps refusing* the credentials spends them, and it must sustain that across **two 30 s checkpoints**
  (~60 s) — one sample cannot tell a wrong password from a transient SAE failure that merely happened to
  be the last thing logged when we looked, which is the same "never act on a single observation" rule
  `link_watch.hpp` follows. `wifi.cpp` clears the reason on `STA_CONNECTED` for the same reason: an
  earlier refusal must not outlive the association that disproved it, or a slow first DHCP lease would
  roll back credentials that had just worked. An **absent SSID** is not evidence against them — it is
  what a router that is still rebooting looks like, and reconfiguring a router then re-pointing the
  device at it is the main reason anyone edits these credentials at all — so it gets 180 s first. A
  pending change also suspends the first-boot retry budget, which would otherwise give up after ten
  fast `NO_AP_FOUND` scans and roll back before the router ever answered. A rollback also **records its
  outcome**: it sets `/status.wifi.rolled_back` (sticky until the next `/set_wifi`), because the reboot
  it takes wipes the diag ring and the SSID on the Connections tile's WiFi row is simply the old one again — leaving a rollback
  indistinguishable from a save that never happened. The dashboard consumes it as a **rollback banner**
  (`renderRollbackBanner`, DESIGN.md §5.3 item 0). It has to be a banner off `/status` rather than a
  toast on the save flow: the verdict takes 60–180 s to reach, far past the save's ~21 s reconnect poll,
  so it almost always lands after the user has already reloaded the page. On the API the answer to "did
  my save stick?" stays `curl /status | jq .wifi.rolled_back`.
  `config_save()` writes the backup + flag **before** the credentials when arming and **after** them when
  clearing: each `nvs_set_*` commits separately, so this ordering is what keeps a power cut from arming
  untried credentials with no way back.
- **MQTT** → `/set_mqtt` (edited from a modal off the Connections tile's MQTT row). Unlike Syslog, Save
  **pre-flights the broker synchronously** (DNS → TCP port → a short-lived esp-mqtt connect/auth,
  heap-guarded) and only persists + reboots on success — a bad host/port/password is rejected inline.
  An empty username+password **keeps** the stored credentials (the modal never prefills them, so empty
  is what an unrelated broker edit sends). Clearing them therefore needs its own explicit signal:
  `clear_creds:true` (the modal's "remove stored credentials" checkbox, shown when
  `/status.mqtt.has_creds`) makes empty mean empty. A non-empty user/pass is an explicit set and wins
  over the flag. Without that signal an authenticated `mqtts://` broker could never migrate to an
  anonymous one — disabling MQTT and re-adding the broker both arrive with empty credentials, so both
  keep, and the kept credentials then reject every plaintext broker with "Credentials require
  mqtts://" (only a flash erase got out of it).
- **Syslog** → `/set_syslog` (edited from a modal off the Connections tile's Syslog row).
  Save only validates the port range (no request-path network block); an empty host disables
  forwarding. An **unchanged** host/port short-circuits to `{"ok":true,"reboot":false}` — no NVS
  write, no reboot — the same shape as `/set_mqtt` and `/set_ntp`, since persisting identical values
  and rebooting would drop the poll cycle, MQTT availability and every open WebSocket for nothing.
  (`/set_wifi` is deliberately *not* short-circuited: a re-save there re-arms the credential-rollback
  trial.) DNS resolution and the advisory reachability probe run in the syslog task and surface
  on that row via `/status.syslog` (`resolved`/`reachable`/`error`) — coloured `--ok`, `--warn`
  ("host not answering ping"), or `--err` (DNS lookup failed) — after the reboot.
- **NTP** → `/set_ntp` (edited from a modal off the Connections tile's NTP row), the same
  persist-then-reboot shape as Syslog: no request-path network probe (the SNTP client resolves +
  retries on its own task after reboot), and an **empty server is accepted** — `config_load()` reads it
  on the next boot as "reset to the `CONFIG_DAIKIN_NTP_SERVER` compile-time default" rather than a
  disabled state, since unlike Syslog/MQTT, SNTP has no "off" to preserve. The row shows the
  configured server, coloured `--ok` once synced and `--warn` while syncing; the device's own wall
  clock (`status.ntp.time`, previously rendered inline in the browser's timezone on the old per-link
  NTP card) is no longer shown on the row — it remains available via the MQTT heartbeat's
  `device_time` sensor and the raw API.
- **Heat pump** → `/set_hp`: fully automatic. The model is **auto-detected** (see Auto-detection) and
  shown read-only on the dashboard **Model** card. The dashboard **ESP32** card shows the X10A link +
  protocol and the **RX/TX pins**, which are also auto-detected: **read-only** while the bus answers,
  and a **dropdown** of the chip's safe GPIOs (`/status.pins_avail`) when it doesn't — picking a
  pin posts `{profile:"auto", rx, tx}` to re-run detection on that pair. That dropdown is a filter,
  not the rule — `validate()` rejects a **chip-reserved** GPIO server-side (`board_pin_offerable()`
  per pin, with the octal-SPI and status-LED facts from Kconfig), so a raw `curl POST` cannot route the UART onto a
  flash/strapping/JTAG pad, and `config_load()` re-applies the same test to the persisted cache. The
  RX/TX pins are **persisted** (a manual pick survives reboot); the model is session-only. Protocol is auto-detected
  (no UI control), the poll interval is fixed at 1 s (not sent), and labels are English-only (no
  `lang`). `/set_hp` accepts only `{profile, rx, tx}`.
- **Firmware / OTA** — tapping the version runs the real update flow. Both places the version is
  printed as a control are the same trigger (`checkFirmwareUpdate`): the header meta line beside the
  IP, and the **Version** row on the Settings ESP32 card. Neither one navigates — the readout has a
  slot in each (`#otaStat`, `#otaStatSet`) and `otaInline` paints both, so the flow reports on
  whichever screen started it (only one is ever visible; the other screen is `display:none`). The
  Settings slot is painted into the DOM rather than rebuilt from state, so `renderSettings` freezes
  the ESP32 card while `S.otaShown` — otherwise the once-a-second rebuild would blink the percentage
  out and restart the spinner animation every frame. The flow itself:
  `GET /ota/check`, poll `GET /ota/status` until the check finishes, confirm, `POST
  /ota/update`, then poll again rendering the download progress **inline next to that version**
  (a small ring + "n%", not a toast). On `done` it does **not** use the shared reboot-reconnect poll
  the config saves use — an OTA replaces the served UI itself, so `otaWaitReboot` waits for the board
  to come back (version changed / `uptime_s` went backwards / seen down→up) and **reloads the page**.
  A download already running on the device is adopted on page load (`resumeOta`), so a reload
  mid-update keeps showing the progress.

The board/platform is reported by `/status.platform` — read by `/status` consumers and the web UI's
paste-ready crash bundle, no longer a row on the Settings ESP32 card.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the
largest *contiguous* free block): keep every HTTP handler under the `handle_all` try/catch (503 on
OOM), stream `/diag` and the MQTT discovery instead of building one big `std::string`, and treat
any new large contiguous allocation (big JSON, OTA TLS) as a crash risk to size-check. A reboot
loop is bad here too — it stops the poll cycle and drops MQTT availability.

Two rules follow from that, and they apply to **every** FreeRTOS task loop that allocates, not just
to HTTP handlers:

1. **The task loop self-guards.** A task entry is a C frame boundary exactly like a handler is, so an
   escaping `std::bad_alloc` means `std::terminate()` → reboot. Wrap the loop *body* in
   `try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping
   the last good state, and continue after the normal delay. `mqtt_task` (`mqtt_ha.cpp`),
   `poll_task` (`hp_poll.cpp`) and `syslog_task` (`syslog.cpp` — its per-cycle `config()` snapshot
   copies ~10 `std::string`s) all do this; `ws_broadcast_values`/`ws_broadcast_status`
   (`http_status.cpp`) keep their own finer-grained guards inside it — they skip a frame rather than
   the whole cycle, and the task guard is only their backstop. Their async queue is also bounded to
   one values and one status batch, so a missing completion callback cannot turn skipped work into an
   unbounded payload leak.
2. **Nothing allocates while a mutex is held.** Rule 1 only makes an OOM survivable if the throw
   doesn't strand a lock: `xSemaphoreTake` is not released by stack unwinding, so a throw inside a
   critical section leaves the mutex taken forever, every reader blocks on `portMAX_DELAY`, and the
   device wedges into a watchdog reboot — the failure the guard was supposed to prevent, in a worse
   form. So either the critical section is non-allocating — `poll_once` stages its stat deltas and
   error text in locals and folds them in with `+=`/`swap` (noexcept), so the commit cannot throw —
   or the lock is taken through an RAII guard, like `hp_poll.cpp`'s `Lock`, which the readers
   (`hp_stats`, `hp_values_snapshot`) need because they copy `std::string`s out under the lock.
   The status mutexes in `syslog.cpp` and `mqtt_ha.cpp` take the first route: their `set_status()`
   stores the error text as a **string-literal pointer**, never a `std::string`, and the reader
   (`syslog_status()`/`mqtt_status()`) copies only that pointer under the lock and builds the
   `std::string` outside it. That matters most for `mqtt_ha`'s, which is written from `on_mqtt` on
   esp-mqtt's own event task — a task with no guard of its own, where rule 1 is unavailable and an
   allocating assignment would both `abort()` and, under a raw take/give, strand the mutex. Both
   files also moved their raw `xSemaphoreTake`/`Give` pairs to the RAII `Lock`.
