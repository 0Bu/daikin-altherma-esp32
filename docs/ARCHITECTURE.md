# Architecture reference

Deep internal reference for daikin-altherma-esp32. This is the **on-demand** companion to
[`AGENTS.md`](../AGENTS.md), the canonical always-loaded project policy: `AGENTS.md` carries the
cross-runner rules and source-of-truth pointers; the full narrative lives here so it isn't reloaded
into every session. Read it when working on the poll engine, the value model, the MQTT bridge,
WiFi/LAN connectivity, or OTA. Keep both in sync — the `$project-review` skill checks for drift.

## Design split

Two concerns, cleanly separated. The **domain** — the X10A protocol (I and S), the register/CRC
framing, the value-definition tables (`def/*`) and the converter functions — is reverse-engineered
heat-pump knowledge, ported byte-for-byte so readings match a known-good implementation. The
**chassis** — the ESP-IDF/CMake esp32s3 build, the web installer, captive-portal
provisioning, the MQTT/HA discovery bridge, signed OTA, the `main/logic/` host-test split and the
CI and agent-runner developer setup — is the delivery machinery. Anything about *talking to the heat
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
heap_guard.cpp/.hpp → THE HEAP WATCHDOG's device glue (logic/heap_watchdog.hpp) — the escalation the
                      other OOM guards lack: answering 503 to everything forever is a HANG, worse
                      than a crash. A contiguous INTERNAL block under the critical floor for an
                      unbroken hold becomes a deliberate esp_restart, capped by an NVS breadcrumb;
                      arming and recovery ask DIFFERENT thresholds, or a heap hovering at the line
                      resets the clock forever. The ladder ENDS IN SAFE MODE. Also the ONE
                      largest-block sampler every reporting site uses. See "The heap watchdog" below
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
net.cpp/.hpp        → the OPTIONAL WIRED TRANSPORT: a W5500 on SPI, in practice an AtomS3 Lite on a
                      PoE base. A second TRANSPORT, not a second source — MQTT/syslog/SNTP/OTA/HTTP
                      run over it unchanged, so nothing above branches on which one carries the
                      device. Runtime-DETECTED (VERSIONR), never a board variant: a board without one
                      frees the SPI bus again and is byte-for-byte what it was. mDNS moved here from
                      wifi.cpp. See "Network transport (WiFi, or the optional wire)" below
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
                       polls each interval, fills the thread-safe value cache, drives errors. It
                       PUBLISHES nothing to the browser — that was the /events broadcaster, and
                       removing it took the /status builder off this task with it (legacy-241)
env3.cpp/.hpp       → OPTIONAL local climate sensor (the M5Stack ENV III: SHT30 + QMP6988 on one I2C
                      bus) — a THIRD reading source with its own task, cadence and freshness window,
                      sharing nothing with X10A or the HomeHub. Disabled, or a non-M5Stack board, and
                      there is no task and no bus at all. A save is HARDWARE-PROVEN rather than
                      merely validated (logic/env3.hpp) and applies by REBOOT — the I2C driver owns
                      the bus for the task's life. Deliberately NOT in /values or the checkup: those
                      describe the heat pump, and an accessory on the board is not a plant reading
weather_forecast.cpp/.hpp
                    → optional direct Open-Meteo client. A configured latitude/longitude starts one
                      task that waits for WiFi + synchronized time and requests six hourly DWD ICON
                      Seamless values over CA-verified HTTPS every 45 minutes (5-minute retry). The
                      bounded JSON response supplies temperature_2m and shortwave_radiation; the
                      next two complete hours become a mean °C value and summed Wh/m². /status keeps
                      fetch/decision provenance and freshness explicit; the provider does not expose
                      model-run issue time, so it remains null. If MQTT is configured, the single
                      publisher task mirrors an atomic retained evidence snapshot (without precise
                      coordinates) to <base>/weather/openmeteo/forecast. No heat-pump control is
                      written and no weather HA entities are created. Everything else is refusal:
                      Content-Length is checked against an 8 KiB cap and the body read in 1 KiB
                      chunks against a running total, never stored across reboots; the units are
                      re-verified against the units the query asked for, so a provider changing
                      them fails closed instead of publishing °F as °C; a provider timestamp that
                      moves BACKWARD is rejected; a location edit invalidates the stored value
                      outright (an old city's forecast must never be reported under a new one);
                      issued_at stays null rather than backfilled from fetch time (the endpoint
                      does not expose the model-run instant, and a synthesized one is fabricated
                      provenance — logic/timestamp.hpp's refusal). forecast_hours=6 is larger than
                      the four bins needed, so a request crossing an hour boundary mid-handshake
                      still has two COMPLETE future bins. The task's 12288 stack is the largest
                      this firmware creates itself (TLS + HTTP + JSON on one frame), with the loop
                      body under BOTH catch halves — `catch (...)` is the one this task shipped
                      without, and a non-std throw unwound into std::terminate
history.cpp/.hpp    → the 24-hour trend rings: one fixed-cadence buffer per logic/history.hpp TREND,
                      fed by four producers (the poll task's X10A rows + the board's own heap, the
                      Modbus task, the ENV III task, the MQTT circulation witness) and served behind
                      GET /history as THREE independent INSTRUMENTS (x10a / modbus / env3), never
                      merged — they have separate liveness. Storage + mutex; the mechanics are the
                      host-tested logic/history.hpp. In .noinit DRAM rather than heap, so a reset
                      that KEPT POWER keeps the readings, and the five-minute append journal in
                      upper-flash `history` covers OTA and power loss. `.noinit` is sealed by the
                      whole catalog fingerprint; flash also stores bounded semantic-id manifests,
                      so unchanged series survive catalog insertion and reordering
checkup.cpp/.hpp    → the 24-hour PLANT CHECKUP behind /status.health: counted EVENTS and window
                      MINIMA (compressor starts + mean run length, defrost share, pressure and flow
                      minima, backup-heater minutes, fault class, retry counters). Storage + mutex
                      only; every rule is the host-tested logic/checkup.hpp. Completed hours share
                      history's append journal, so power loss does not reset evidence. NOT a view over the
                      trend rings — TrendRing::fold keeps the LAST reading of a 5-minute bucket, so
                      the short cycling this exists to find leaves no trace in that raster
state_dwell.cpp/.hpp → HOW LONG EACH ELIGIBLE SWITCHED ROW HAS READ WHAT IT READS — the value list's other
                      half, since "OFF" describes a plant that finished a charge four seconds ago and
                      one that has not charged since Tuesday equally well. Bit flags + the fault
                      class, including neutral observation-only P2 flags, in 72 scalar slots (a
                      24-hour ring would cost 576 B per row). Storage + mutex; the rules are
                      logic/state_dwell.hpp. THREE facts on /values, not one
                      number: dwell_s, dwell_min (the transition was never witnessed, so the age is a
                      lower bound) and dwell_blind_s (how much of the run the bus did not answer for)
def/{altherma*,minichiller*}.hpp → offline-generated per-model ValueDef profiles, except the
                       hand-written altherma3_r_erga.hpp host-test fixture
def/registry.hpp     → hand-written registry/lookup over generated profiles plus generic/test fixtures
def/models_catalog.hpp → generator-assembled legacy metadata for the read-only /models endpoint
def/signatures.hpp   → detection signatures lazily derived once at runtime from registry profiles
def/overlay.hpp     → hand-written X10A page-0x10 supplement layered onto generated profiles
def/homehub.hpp     → curated read-only HomeHub Modbus value catalog
config.cpp/.hpp     → runtime config (daik_cfg): WiFi/MQTT + the one-shot WiFi rollback backup + link
                      cache (pins/proto/identity) persisted, model RAM-only; mutex-guarded snapshot
                      via config().
                      Writers commit only the fields they own
                      (config_commit_detected_link/config_commit_detected_model for revision-checked
                      detection, config_save for the HTTP handlers). config_save writes the
                      credential/service fields as ONE CRC-checked atomic blob (logic/config_store.hpp,
                      host-tested) — a single nvs_set_blob, so that blob is all-or-nothing across a
                      write failure AND a power cut; on failure the old blob is intact, config_save
                      returns false and publishes nothing. The separately-owned RX/TX/proto/identity
                      cache is also ONE CRC-checked atomic `link` blob, so a failed pin swap leaves the
                      previous complete link intact. A link-blob failure after a successful service
                      blob is logged but does not falsely fail an unrelated service save; /set_hp
                      requires its link write and leaves RAM untouched on failure.
                      config_commit_detected_link still applies a revision-current proven link to
                      RAM if only its cache write fails, so detection need merely run again after
                      reboot. config_load reads `cfg` and `link`
                      first, falling back to each domain's legacy per-key values when its blob is
                      absent (fresh device / pre-blob OTA) or invalid
nvs_storage.cpp     → thin NVS helpers (namespaces, blobs, migration); setters return esp_err_t and
                       are [[nodiscard]] — a dropped write is silent (compare to ESP_OK, not bool)
http_server.cpp     → esp_http_server :80, wildcard dispatch; concerns register their own routes.
                      Picks the trust surface from the observed provisioning-AP state: the OPEN
                      setup AP registers ONLY the provisioning routes (GET / , /index.html, POST
                      /set_wifi + captive), withholding /scan, /coredump, /diag, config/OTA/MCP from
                      an unauthenticated radio client; with no setup AP, the configured WiFi or
                      Ethernet LAN registers the full API.
                      Boundary = host-tested logic/http_surface.hpp (F01). `cfg.max_uri_handlers` is
                      sized EXACTLY to the trusted-LAN route count of 36, so adding a route means raising
                      it in the same commit: overflowing is silent and hits the WRONG route (the
                      casualty is whatever registers last, deliberately the captive/SPA catch-all, so
                      the symptom would be deep links breaking rather than the new route 404ing).
                      http_register() now logs a failed registration instead of discarding it
http_common.cpp     → shared HTTP helpers + the single OOM guard: http_register() stashes the real
                      handler in user_ctx and installs the handle_all trampoline, which calls it
                      inside try/catch — std::bad_alloc → 503, any other throw → 500, instead of
                      unwinding through esp_http_server's C frames to std::terminate → reboot.
                      No route is exempt any more: the one that was (/events, raw-registered
                      because is_websocket bypasses the trampoline) no longer exists
http_status.cpp     → GET / (web UI), /status, /values, /history, /models, /diag, /scan, /coredump,
                      POST /crash/dismiss. http_append_status_json() runs on the httpd task ALONE —
                      see "Push vs. poll" below for why that sentence is load-bearing
http_config.cpp     → POST /set_wifi, /set_mqtt, /set_diagnostics, /set_ref_temp, /set_weather,
                      /test_circulation, /set_circulation,
                      /set_syslog,
                      /set_ntp, /set_hp, /discover_homehub, /set_board, /set_env3, /set_ota, /set_lang,
                      /detect — all SIXTEEN, which http_server.cpp's cfg.max_uri_handlers is sized
                      exactly to (and which must be LOWERED in the same commit that retires a route,
                      as retiring /set_dynamic_lwt did: a count left above the real one is a comment
                      that has stopped describing the code depending on it). /set_ref_temp persists
                      immediately, but subscribes/decodes only while the v19 diagnostics master is
                      enabled; payload/path/freshness failures are runtime status and diagnostic
                      evidence, never a reason to refuse the operator's mapping.
                      /test_circulation and /set_circulation retain their proof boundary for a
                      read-only active-power mapping; neither route can switch the configured plug.
                      /set_weather strictly validates the latitude/longitude pair, persists it and
                      only wakes the weather task; no DNS/TLS request runs on the httpd worker.
                      /set_diagnostics is the default-off device-wide consent boundary. It starts a
                      fresh generation when toggled and stops/clears the checkup plus room, weather,
                      and circulation collection when disabled. Each source save still owns its
                      mapping or coordinate disclosure, but a saved source is dormant while the
                      master is off. There is no /set_dynamic_lwt controller mode — the read-only
                      heating-curve sampler additionally requires its room source and HomeHub.
                      /set_board atomically owns board identity/peripherals plus the integrated ENV
                      III fields. Its shared preflight proof-gates an enable before the one NVS
                      write: a short-lived bus requires one CRC-valid SHT30 sample and the QMP6988
                      chip id on the proposed pins. Disable remains probe-free; an already running
                      unchanged mapping instead requires a fresh driver sample, and moving that
                      owned bus is disable-first. /set_env3 retains the same gate for older clients.
                      /set_hp also carries the HomeHub Modbus params (mb_host/mb_port/mb_unit_id),
                      applied live; sending mb_host marks the one-shot discovery decision complete.
                      X10A and HomeHub are separate durability domains: naming fields from both in
                      one request returns 400 before either domain is changed.
                      /discover_homehub is a bounded manual dialog action that returns an IPv4
                      without saving it
hp_modbus.cpp/.hpp  → THE HOMEHUB MODBUS STACK — a SECOND, INDEPENDENT source beside X10A, not an
                      alternative to it: its own task, cache and link state. A non-empty saved
                      address starts polling. Fresh firmware performs one bounded search on its
                      first boot with a LAN lease and persists even a miss; an explicitly empty
                      address then means no task, socket, future automatic discovery or requests.
                      Manual Search remains available in the dialog. Both searches filter
                      homehub-* from up to 64 _http._tcp responders per bounded attempt. The lwIP
                      client wraps logic/modbus.hpp framing; the response borrows a caller-owned ADU
                      so its payload cannot outlive the received bytes. logic/modbus_plan.hpp turns
                      32 rows into ten contiguous batches: full map every 5 s, the two diagnosis-gate
                      batches (input 53 + 38) at 1 Hz. Gate-only success cannot clear a map-wide error;
                      only a clean full cycle proves recovery. READ-ONLY: no write function code is
                      issued anywhere, and no source file can build one (docs/MODBUS_PROTOCOL.md)
def/homehub.hpp     → the HomeHub register map (input + holding), the Modbus counterpart of the X10A
                      def/ profiles; decoded via logic/modbus.hpp's Temp16/Pow16/Int16/Text16 codecs
http_ota.cpp        → /ota/check|update|status
mcp_server.cpp      → /mcp — POST is the stateless Streamable-HTTP MCP device glue. It dispatches
                      only read-only get_status/get_hp_values and reuses http_status.cpp's exact
                      JSON builders; the model-sized values result streams through the same bounded
                      sink as GET /values rather than one JSON-RPC-sized string. GET serves one
                      embedded/gzipped, static setup and information page (no network activity/SSE/
                      session/external assets). Parsing/catalog/envelopes live in host-tested
                      logic/mcp.hpp
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
ota_update.cpp      → OTA: manifest check + fixed-buffer esp_http_client → esp_ota stream + the
                      two-point downgrade gate + RSA validation + rollback health gate. HTTP/TLS
                      is released before esp_ota_end; both network ops run on ONE on-demand task
                      (never the httpd worker), one at a time; status behind a mutex
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
diag_crash.cpp/.hpp → one-shot boot capture of the reset reason + the core-dump SUMMARY (crashed
                      task/PC/backtrace/app-elf-sha) into a cached CrashInfo (logic/crashinfo.hpp),
                      read by /status.last_crash and the MQTT crash topic — the summary is NEVER
                      re-parsed on a request path. An ORPHAN dump (its app-elf-sha does not match the
                      RUNNING build, since the coredump partition survives an OTA) is erased at
                      capture, so `coredump` means "a dump for THIS firmware is downloadable" rather
                      than a download espcoredump rejects on a SHA mismatch
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
stack_watch.cpp     → the SECOND memory budget, made reportable. Four tasks (httpd, hp_poll,
                     mqtt_pub, the HomeHub link) record their own FreeRTOS stack high-water mark
                     from their own loop; the MQTT heartbeat publishes all four as
                     `*_stack_min_free_bytes`, null until sampled. The heap has `/status.sys`, two
                     trend rings and a watchdog — the stack had a core dump's task table, which
                     exists only once the board has died
www/                → web UI sources: index.html + style.css + app.sources + js/*.js. The manifest
                     orders the classic-script fragments; inline_assets.cmake splices them into ONE
                     self-contained page at build time and serves it gzipped. setup.html is the
                     captive-portal page (gzipped separately)
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

  The **reservation runs in every direction**, and each list names its own. `board_pins_offerable()`
  takes `config_reserved_pins()` — indicator + button + enabled ENV III, withheld from the X10A picker.
  `board_pins_local()` takes `config_board_reserved_pins()` — live X10A plus enabled ENV III,
  withheld from the LED and button pickers. ENV III uses `config_env3_reserved_pins()` to withhold
  X10A, LED and button pins. It has to: `board_hw_valid()` rejects a local pin that equals a claimed pin, so
  a picker still listing GPIO44/43 was offering a choice whose only outcome is
  `400 "led_gpio is in use by the X10A link"`. `ReservedPins` is therefore deliberately anonymous
  about which subsystem it holds (`pin_a`…`pin_d`); the named factories in `logic/config_model.hpp`
  state the direction. The same second axis applies to `board_presets_offerable()`: a
  preset colliding with where the link currently sits is withheld, exactly as one colliding with an
  Octal build is.
- `logic/board_presets.hpp` — the same per-board facts made *applicable*. One published image serves
  every board, so the indicator and button are runtime settings seeded from Kconfig — and that seed
  is the XIAO's plain LED on GPIO21. On an AtomS3 Lite, whose only light is a WS2812 on GPIO35, the
  firmware then drives a pin with nothing on it: the board looks dead while being perfectly healthy.
  This table carries the five settings (`led_gpio`, `led_type`, `led_inverted`, `btn_gpio`,
  `btn_active_low`) for each **documented** board, served as `/status.board.presets`, so the Hardware
  modal fills them from one pick instead of asking the user to transcribe pin numbers out of
  [BOARDS.md](BOARDS.md). It lives in firmware rather than in `www/js/settings.js` for the reason
  `lwt_select.hpp` exists: a browser-side copy would be a second statement of the same facts, free to
  drift, and a preset that fills pins the device then *rejects* is worse than no preset. Here, the CI
  logic test asserts every offered preset passes the very validator `POST /set_board` applies
  (`board_hw_valid`). `board_presets_offerable()` withholds a preset whose pins **this build**
  reserves — the AtomS3 Lite's GPIO35 is free on this project's Quad-flash build and is SPIIO4 on an
  Octal one — the same "a pick that cannot work is not a pick" rule the X10A dropdown follows. It
  asserts nothing about which board this *is* (still unknowable): picking a preset is the **user**
  telling the firmware what the hardware is. Blob v12 records that statement as the stable
  `Config::board_preset_id` together with `board_user_set` and all five hardware fields in one atomic
  CRC-protected write. `/status.board.preset_id` and `.preset_name` expose it directly. A device that
  never saved hardware carries the Kconfig defaults, which happen to **equal** the XIAO preset, but
  carries no selected id and remains unidentified. Conversely, an Atom selection remains Atom across
  refresh and reboot without re-deriving its name from GPIO35/41 — including when its LED or reset
  button is disabled or moved. The request rejects an unknown id, while `board_hw_valid()` separately
  validates the customized peripheral GPIOs; only explicitly choosing `custom` changes identity.
  Each preset also carries a non-display `BoardVendor` and its physically exposed external-I2C pins;
  vendor-bound accessories such as ENV III use this validated explicit identity and connector
  inventory, not a model-name or chip-wide pin heuristic. Thus AtomS3 Lite offers exactly
  `1/2/5/6/7/8/38`; exposed GPIO39 is deliberately withheld after failed ENV III hardware tests,
  while Seeed, unstated and Custom boards fail closed. A future M5Stack preset must declare its own
  pin inventory.
  Hardware values decide the **reboot** (a driver's pin moved); identity-only changes require a
  **save** but no reboot (`board_save_needed()` / `board_reboot_needed()`). Pre-v12 `board_set=true`
  is a read-only migration hint: an exact historical field match recovers the same name the old UI
  displayed, while untouched defaults never acquire an identity.
- `logic/profile_view.hpp` — the active model's rows **as every consumer must see them**: the
  generated table plus the applicable hand-written `def/overlay.hpp` blocks, as one indexable sequence. Four
  call sites read the row set and they are not independent — `hp_poll` decodes them, `mqtt_ha`
  announces one HA discovery config per row, and both `http_status` and `mqtt_ha` size their snapshot
  buffer from the row **count**. Grow the cache without growing the count and the extra values are
  silently truncated out of `/values` and MQTT: an absent-value bug with no error anywhere, the
  legacy-35–39 shape. Hence one view, not four merges. It carries the **overlay rule** (every page a
  supplement block uses must already exist in the generated base), which keeps a hand-written block from
  doing what hand-editing a generated table would do — move detection — or adding a per-cycle bus
  round-trip that, on a model which does not answer the page, reads on `/diag` exactly like a wiring
  fault.
- `logic/cop_scope.hpp` — **which** COP the dashboard's quotient describes, and when it is none. The
  pill divides a heat figure by an electrical one, and the two picks need not describe the same
  *system*: a quotient of two correct numbers taken across two boundaries is not a worse COP, it is a
  different quantity under the same name. The CT clamps (`0x63`) see the whole unit including both
  resistive heaters; `INV primary current` (`0x21`) sees the compressor alone; the heat side is
  `lwt_select`'s pre-BUH outlet, heat-pump heat with the heaters deliberately uncredited. INV
  therefore pairs correctly — the heaters sit outside *both* sides and cannot unbalance them — while
  CT does not, and the fix moves the **numerator** rather than the denominator: a whole-unit divisor
  takes the post-BUH (R2T) outlet, the pairing [HOME_ASSISTANT.md](HOME_ASSISTANT.md) already
  prescribes for an external meter. The two heaters are **not** the same problem, hence two block
  codes: the BUH sits *in* the space-heating flow between R1T and R2T, so a downstream numerator
  re-pairs it, while the BSH — the immersion heater inside the DHW tank — heats tank water directly,
  downstream of the flow sensor and of both leaving-water sensors, so its kilowatts enter the divisor
  while its heat crosses neither and *no* row would re-pair them. Unfixable rather than unfixed, so
  it blocks whatever the R2T row says. Unknown heater state is not *off* — off is the permissive
  branch here, the mirror of `ou_stale`'s "unknown rps is not stopped". The post-BUH picker takes the
  row's **page**, never its label alone: `(R2T)` names the leaving-water outlet on `0x61/4` *and*
  `Discharge pipe temp.(R2T)` on `0x20/4`, same offset and converter. Like `lwt_select` and
  `ou_stale` there is no firmware caller — it exists so CI gates the rule against the whole catalog.
- `logic/availability.hpp` — the **availability ledger** (legacy-209): is a row's decoded number a
  *measurement*, or is the firmware merely able to decode something from those bytes? Everything
  else answers a narrower question — `convert()` handles the wire format's own `0x8000` no-data
  marker, `reading_plausible()` catches a number that is *impossible*, `ValueDef::no_publish` carries
  what the generator knew. What is left is a field that decodes to an entirely ordinary number which
  is not a measurement of anything, and only per-row evidence can identify it. Five non-default row
  policies exist and four are in force. `ZeroMeansAbsent` withholds only an exact zero from an adjudicated row,
  because a global "0 °C is unavailable" rule would destroy every thermistor reading that crosses
  zero. Four rows carry it: `Target Cond. Temp.` (raw `0x0000` flat through a full compressor cycle)
  and, since legacy-224, the page-`0x21`
  *Fan1/Fan2 Fin temp.* and *Compressor outlet temperature*. Those three are measured rather than
  argued: page `0x21` stops being refreshed while the outdoor unit rests, so **every** stored sample
  is a running sample — 1140 of them over 7 days, in each of which the neighbouring `INV fin temp.`
  (same page, same converter) read 16.5–55.5 °C, the discharge pipe 28.5–101 °C and ambient never
  fell below 17.5 °C, while all three read *exactly* 0.0. A heatsink is not at 0.00 °C in 25 °C air
  and a compressor outlet is not at 0.00 °C while the pipe it feeds is at 101 °C. **The label is part
  of the key for these three**, and that is load-bearing rather than defensive: the catalog puts
  *Brine inlet/outlet temp.* and *Refrig. temp. evap. In/Out* at the same `(page, offset, converter)`
  on the geothermal profiles, and brine and evaporating refrigerant sit **at** 0 °C in normal
  operation — a coordinate-only rule would delete those units' most load-bearing reading exactly
  where it matters. The catalog test pins both directions (19/19/21 adjudicated rows, 10 shared
  geothermal rows that must reach the ledger and be told nothing). This is not the label *matching*
  `lwt_select.hpp` warns against — that is a pattern hunting for a quantity; this is an exact
  discriminator among spellings the catalog demonstrably carries, the same key
  `logic/label_override.hpp` uses. The three `0x20` rows legacy-224 also lists (outdoor coil, suction pipe,
  liquid line) cannot take a **flat** `ZeroMeansAbsent`: 0 °C is where those sensors live for much of
  a heating season, so an unconditional rule would withhold a real reading far more often than it
  removes a false one. `ZeroAbsentAboveSaturation` is the conditional answer — it withholds an exact
  zero only while a **cross-page saturation witness** refutes it, and fails open otherwise. The way
  past the winter objection is not a better threshold but a **second source**: a quantity measured at
  the same instant that makes the zero impossible rather than merely unlikely.

  **Which side of the circuit a row sits on decides whether the witness can speak for it**, and that
  is the whole adjudication. The only witness the catalog carries is `(0x62, 15, conv 405)` — the
  refrigerant pressure sensor's saturation temperature on the hydronic page — and it is measurably
  the **high side**: over 1419 running samples it tracks *leaving water* across a 55 K span
  (3.2–64.1 °C against LWT 9.5–64.8 °C, paired mean difference −0.9 K) while outdoor air stayed
  inside a 7 K band. So exactly one of the three rows is adjudicated:

  | row | side | outcome |
  |---|---|---|
  | `0x20/2` outdoor coil (the *evaporator* in heating) | low | **published** — a high-side witness cannot refute it |
  | `0x20/6` suction pipe (low side + superheat) | low | **published** — same |
  | `0x20/10` liquid line (downstream of the condenser) | high | **adjudicated** — `liquid = condensing − subcooling` |

  A coil or suction pipe at 0 °C while the refrigerant condenses at 49 °C is not a contradiction, it
  is an ordinary January afternoon; keying either to this witness would withhold a real reading in
  exactly the season it matters. A future *low-side* witness would settle them, and this one says
  nothing about them. The liquid line is different: 0.00 °C against a condensing 49 °C claims ~49 K
  of subcooling, which is impossible rather than unlikely — the `Target Cond. Temp.` bar reached
  against a *simultaneously measured* quantity instead of against a second installation, which is
  what legacy-224 asked for and one unit could
  not otherwise supply.

  The bound (`LIQUID_LINE_SAT_CEILING`, 30 °C) is impossible rather than tight — real subcooling is
  3–10 K, and the reference unit sits above it in 1231 of 1352 running samples — and it carries the
  **mode** safety property for free: in cooling the circuit reverses and this same sensor becomes the
  low side, which never reaches 30 °C, so the rule switches *itself* off rather than anyone having to
  detect the mode. The on-page witness that would have needed no cross-page state at all (`0x20/12`,
  `0x20/14`, conv 405) is unusable: those transducers read exactly 0.0 bar in 56433/56433 samples over
  120 days, and conv 405 drops `bar <= 0`, so neither `(T)` row has ever published one sample.

  Two gates keep the witness honest. The capture is **gated on the profile declaring the row** — on a
  model without it, bytes 15–16 of the hydronic page are whatever that model puts there, and a
  pressure read off them would be an *invented* witness, the one direction that must be impossible
  since a witness can only ever take a reading away. And it **expires every cycle**, so a witness page
  that goes silent falls open within one poll interval rather than authorizing a withholding forever.
  Reach is deliberately narrow and pinned: 39 rows carry the rule, but only **8 profiles carry the
  witness**, so on the other 31 it is armed and permanently silent. The **label is part of the key**,
  as for the `0x21` rows and with a sharper case — *Leaving brine temp.(R6T)* sits at the identical
  coordinate on four geothermal profiles and really does read 0 °C. `AboveRangeIsAbsent`
  is the **expansion
  valve** pulse rows (conv 151): 30 days of published samples run 0-474 pulses and then carry six
  samples of exactly `0xFFF8`, with **nothing in between** — a discrete out-of-band integer rather
  than a distribution's tail. The obvious diagnosis, "conv 151 should have been signed", is *refuted*
  and not merely unproven: a valve nudged past its mechanical zero would report a spread of small
  negatives reached from positions near 0, while every occurrence is the identical integer sitting
  between neighbouring samples of ~450 — and no valve travels 450 → −8 → 450 inside 30 s. Since
  65528 and −8 are both impossible positions, withholding the value is the one answer both readings
  agree on, and the `u16` decode [`REGISTERS.md` §3.1](REGISTERS.md#31-numeric-converters) documents
  stays untouched. It is a *value* test that still cannot live in `reading_plausible()`, whose
  envelopes are keyed on the dataType and so cannot reach a dataType `-1` row at all; the only other
  handle is the `(pls)` in the label, which is exactly what this project does not key on. The ceiling
  (2000) is deliberately about four times the widest observed opening — an impossibility filter, not
  a threshold fitted to the data. All five coordinates carry the rule from a capture on **one** of
  them, because conv 151 has exactly one use in the whole catalog (113 rows, every one an EEV pulse
  position), so the bound is a fact about the actuator rather than about the row that happened to be
  observed; the catalog test pins that set in both directions. `Unproven` — withhold the row from every
  publish surface and retract its retained HA config — is implemented with **no live entry**: it held
  `Target Evap. Temp.` while that row's scale was unknown, and legacy-194 then showed the row was
  mis-*decoded* rather than unmeasurable, so the verdict moved to `logic/conv_override.hpp`. A
  quarantine and a mis-decode are different findings; recording them as one would make the fix read
  as a suppression quietly lifted. `Bit7MeansAbsent` covers CT-L3 at `0x63/16`: the register map
  places `HP Forced FG` on bit 7 of that same one-byte field, while intrinsic conv 161 decodes the
  complete byte ×0.5 A. The live page is therefore the witness — when bit 7 is set, CT-L3 is
  withheld instead of becoming a fictitious +64 A; a caller without the optional page fails open,
  and `convert()` remains row-agnostic. The browser accepts CT as an electrical-input source only
  when every CT phase row declared in the snapshot is numeric, so a withheld L3 cannot turn the
  safe failure into an L1+L2 partial sum and inflated COP. Rules are keyed on `(page, offset, converter)` — the row's
  structural identity — plus, where that coordinate is demonstrably **not** one quantity, the exact
  generated label as a fourth component (the three `0x21` zero rows above, and nothing else). Never
  a profile id: the catalog test proves each rule selects the adjudicated quantity across all 45
  profiles. Adding a rule is an adjudication
  with the same evidentiary bar as `tools/domain/audit_exceptions.txt`, not a way to make an
  inconvenient number disappear. Five non-default row policies exist; four have live entries,
  while `Unproven` deliberately has none after the converter adjudication above.
  A separate verdict is not about a row at all. `PAGE_ABSENCE_RULES` is keyed on the register
  **page** and reaches every row on it, because "the hardware behind this reply is not fitted" is a
  fact about the page rather than about any one field. Two are in force, both the **absent second
  outdoor unit** of legacy-224. `0xA1` (Water-HX)
  answers with 16 zero bytes including its unit-family setting flags at byte 9, so the signature is
  `AllBytesZero`. `0xA0` needed a different witness, and it is the reason the rule is page-keyed at
  all: that reply is **not** all-zero — it reads `00 00 80 0c 00 00 00 00 00 00 ff ff 00 00 00 00`,
  and both non-zero fields are themselves absence markers (the O/U MPU id at bytes 10-11 reads
  `0xFFFF`, i.e. no MPU answers, while the operation words at 12-13 have never had a bit set). So the
  `UnidentifiedUnit` signature requires both, and anything ambiguous publishes. Behind that signature
  three rows published exactly `0.0 °C` for 316 771 consecutive samples over 60 days, and `0xA0/2`
  published something worse than a zero: `89.6-192.0 °C`, seven distinct values in seven days and
  every one an exact multiple of `12.8 °C` — its raw low byte never leaves `0x00`/`0x80`, which is
  not how a thermistor read at 0.1 °C resolution behaves, and `reading_plausible()` cannot refuse it
  because 192 °C is inside the ±200 °C envelope. Each signature is re-evaluated against the **live**
  reply every cycle, which is what makes a page rule safe across all 45 profiles where a static
  per-model claim would not be: an installation that *has* the second unit answers with something the
  signature does not match, and every row on the page publishes untouched — including `0xA0/8`, which
  keeps its own `AboveRangeIsAbsent` ceiling. That composition is why the page fact could not stay a
  row entry: a row already carrying a value rule cannot carry a second one, and a row a future
  generator run adds to the page would be covered by nothing.
- `logic/conv_override.hpp` — the **converter adjudication** (legacy-194): which converter a generated row
  is actually *encoded* with, when the id the offline generator emitted is demonstrably the wrong
  one. Sibling of the availability ledger, separate on purpose — that one asks "is this a
  measurement?" and answers by withholding, this one asks "is it decoded right?" and answers by
  asserting a **different** value. That is the stronger claim, so the bar is higher: a rule needs
  evidence that is *structural* (a property of the wire integers themselves), never a range that
  merely looks more plausible, because fitting a scale to make a number look right is how legacy-35–39
  shipped. One entry: `Target Evap. Temp.` (`0x10/6`) conv `114` → `109` (`÷128`). All 54 distinct
  integers the row has been observed to carry satisfy `raw == floor(128 × T)` on an exact 0.1 K grid
  — p ≈ 1.6e-60 against any other scale — and the reading becomes 10.4–15.6 °C running / 17.2–19.0 °C
  at rest. conv `109` already existed, so this is a wrong converter **id** on a right register, not a
  wrong converter: `114` keeps its `×0.1` semantics and its three other rows, which are left alone
  because they read raw `0` on the only unit measured and `0` decodes identically under both scales.
  Applied where a row *enters* the pipeline (decode, cache, HA discovery), so the decoded value, the
  cached converter id, the published JSON type and the HA component cannot disagree about one row.
- `logic/label_override.hpp` — the **label adjudication** (legacy-230 A): which
  *label* a generated row is published under, when the generator's is wrong. Sibling of the converter
  adjudication, composed by the same `adjudicated()`, but for the row's **identity word** rather than
  its decoded value — the label is the HA entity id and the VictoriaMetrics series suffix, so this is
  a published claim and a change to it is a legacy-221 migration. One entry: `0x30/1` conv 211
  *"Fan 1 (10 rpm)"* → *"Fan 1 (step)"* — conv 211 is a step index (`REGISTERS.md` §3.3), so the four
  profiles spelling a rate published `actuators_fan_1_10_rpm`, inviting a reader to take a `30` for
  300 rpm. Keyed on `(reg, offset, conv, from-label)`, so it corrects exactly those four and is a
  no-op the moment the generator emits *"Fan 1 (step)"*; `mqtt_ha.cpp`'s `retract_relabeled_values`
  deletes the superseded HA entity on upgrade. The oracle is the spec, never a nicer word.
- `logic/fault_state.hpp` — the **numeric** fault flags that ride beside the **textual** Daikin
  diagnostic code (legacy-209 defect 4). `error_active`/`warning_active` are derived from the conv-203
  error class through the inverse of that converter's own `ERR_TYPE` lookup, so there is no second
  opinion about what the labels mean; an unreadable class publishes neither rather than asserting
  "no fault". Warning and Caution fold into one flag on purpose — the textual class is right beside
  them for anyone who needs the distinction.
- `logic/raw_capture.hpp` — **when** the poll path may put raw page bytes on `/diag`, the missing half
  of `logic/hexdump.hpp`. Edge-triggered on stopped→running, then one per 5 min during the run, at
  most 8 per boot and never refilled: a *series* rather than a point, bounded so it cannot evict the
  rest of the boot's evidence from the 6 KB diag ring. Built for legacy-194, which was in the end settled
  from the wire integers the published series already carried losslessly — the capture remains the
  general answer for the next row whose bytes are only wrong while the unit runs. Pure because it is a three-input state machine whose failure modes — a silently
  exhausted budget, or a dump that repeats every cycle — are invisible on a board until the log is
  already ruined.
- `logic/feature_gate.hpp` — which derived features may **honestly** run on the detected model, and
  the answer when they cannot: **disable, never degrade** (issue legacy-69 step 0.2 / legacy-110 Part C). It is
  the same rule the UI already applies three times — `lwt_select` blanks ΔT/heat/COP rather than
  substituting a setpoint (legacy-121), `ou_stale` blanks a held-over pill rather than showing a dimmer
  register of half-valid numbers, `cop_scope` blanks the quotient rather than pairing two boundaries
  that do not match — because a reduced feature set is that already-rejected second
  vocabulary wearing a new name, and because a model fit on a feature vector does not degrade
  gracefully when columns disappear, it just becomes confident about a distribution it never saw.
  Coverage is read off the **rows**, not off `profile == "generic"`: `generic` is the extreme case
  (measured: no leaving-water measurement, only the setpoint `lwt_select` correctly rejects; no INV
  frequency, expansion valve or pressure row at all) — but sixteen of the 43 **detectable** profiles
  also lack page `0x30`, and with it the compressor run-state input. An id check would have let
  inference run without run-state on more than a third of the detected catalog. No firmware caller
  yet (legacy-69 Phase 3 has not landed); pure and host-tested so the policy is asserted rather than
  re-litigated at the future call site.
- `logic/checkup.hpp` — the **rolling on-board plant diagnostics** (legacy-208, legacy-349):
  the third question the dashboard answers, after *what is it doing now* (the schematic) and *what did
  this one reading do today* (the trends). It reports counted events, durations and window minima —
  compressor starts and observed runtime per detected start, defrost count and (where compressor
  state exists) share of paired runtime, source-named outdoor min/mean context paired separately to
  completed space-heating runs and defrost/compressor runtime, water pressure and steady-flow minima, observed BUH/BSH
  seconds, clean one-hour R5T tank-cooling windows with circulation-pump attribution, the
  unit's fault class and protection-retry counter changes — through `/status.health`. It does **not**
  issue a plant-health certificate: X10A does not establish refrigerant charge, sensor calibration,
  hydraulic cleanliness, air path, mechanical condition or seasonal efficiency. `checkup.cpp` owns
  the ring and mutex; the browser renders the firmware's evidence classification without inventing
  another threshold.

  Four properties are worth stating, because each is a defect avoided rather than a feature added:

  1. **It is not a view over the trend rings.** `TrendRing::fold` keeps the *last* reading of each
     5-minute bucket, so a compressor cycle shorter than five minutes leaves no trace — and short
     cycling is what the check exists to find. Events are therefore counted once per completed poll
     sweep. The sweep plus the fixed one-second delay is not a true 1 Hz sampler; a pulse that begins
     and ends between sweeps can still be missed, and neither firmware nor UI claims otherwise.
  2. **A row is addressed by (page, offset, converter)** — one key wider than a trend's locator, and
     the extra field is load-bearing. `3way valve`, `2way valve`, `BSH`, `BUH Step1`, `BUH Step2` and
     `Water pump operation` all sit in **one** dimensionless byte (`0x60/12`) and differ only in which
     bit their converter masks, so a (page, offset, unit) locator would resolve "backup-heater
     minutes" onto the 3-way valve's position — the legacy-35–39 shape with a day's statistics in front of
     it. The catalog test asserts uniqueness **and** identity (the resolved row's label) per locator
     across every shipped profile. Fault classes are matched by converter 203 so both the outdoor and
     hydronic rows participate. Retry counters are **not** matched by converter alone: converter 311
     also names BUH output capacity on page `0x63`. The five counters therefore have exact identities
     on page `0x10`, offsets 10–12 and converters 310/311. The compressor witness composes
     `ou_is_rps_witness()` rather than naming a locator of its own.
  3. **Capability, elapsed span and evidence are separate.** Capability is derived from the active,
     converter-adjudicated profile before the bus sweep; a timed-out page reduces evidence rather than
     pretending the feature disappeared, and a profile change cannot leave an “ever seen” capability
     latched. A reboot, explicit detection run, selected-profile change or RX/TX-pin change starts a
     new X10A observation identity; a HomeHub-only edit does not. The reset request is consumed by the
     recorder under its mutex, and that in-flight sample is discarded so an old-link sweep cannot seed
     the new identity. The ring retains 23 completed one-hour buckets plus the pending hour, so its
     represented span is never more than 24 hours. `full_span` is anchored to the first and latest
     monotonic samples, not to phase-shifted bucket boundaries, and records that a real 24-hour
     lifecycle has elapsed — plus whatever an earlier boot carried in, since those anchors restart at
     zero and the restored lifecycle therefore rides as a duration rather than as a timestamp pair
     (`logic/checkup_persist.hpp`). Signal clocks derive whole seconds from the difference of absolute
     timestamps, so the serial sweep's sub-second fractions telescope instead of being lost on every
     interval; the 15-second continuity cutoff still compares exact microseconds. A check that
     concludes absence of a pattern additionally needs at least 90% valid evidence from its own
     signal. Direct current state and observation-only flow use their stated shorter eligibility
     targets instead of pretending to be 24-hour absence claims. Each result therefore carries
     `observed_s` and `required_s`; the report also carries `available`, `assessable` and `evaluated`.
     Outdoor context is not another evidence clock or threshold. X10A 0x20 contributes only when it
     answered this sweep and the non-held RPS witness positively says Running; unknown RPS is
     absence. Two independent eight-byte aggregates keep exact tenths sums rather than
     order-dependent rounded means. Their 384 B payload plus 48 B alignment moves the guarded
     bucket layout from 46/1104 B to 64/1536 B and therefore changes the persistence fingerprint.
     The DHW row additionally carries `candidate_s` and `settle_remaining_s`: the first is usable
     progress inside the current all-or-nothing clean hour, not yet credited to `observed_s`; the
     second explains why no candidate is running after a tank charge or BSH pulse. It also carries
     what the window **discarded** — `aborts`, `abort_reasons[]` and `best_aborted_s` — because
     `0 min of 6 h` reads identically on a board that booted a minute ago and on a plant that will
     never grant a clean hour, and only the discarded candidates separate them.
     `available` counts supported/reportable rows, including pure observations. `assessable` is the
     narrower denominator of checks with a bounded judgement, and `evaluated` counts those that have
     enough evidence. `Unavailable` means the check cannot adjudicate here, whereas `Collecting`
     means it supports the check but has not established enough evidence. `Unavailable` has TWO
     causes and the DHW row's `blocked` flag distinguishes them, because they need opposite advice:
     the profile lacks the required row (nothing an owner can act on), or a full lifecycle produced
     no completed window and at least six discarded ones — a plant whose own duty cycle is shorter
     than the 105 minutes the method needs. Reported as `Unavailable` rather than left `Collecting`
     so it says nothing either way instead of holding the whole card at "checking" permanently.
  4. **The evidence class limits the claim.** The unit's current fault class is direct `device`
     evidence. Water pressure is `manufacturer` evidence: representative official manuals for
     [Altherma 3 M 04–08](https://www.daikin.ie/content/dam/document-library/user%20reference%20guide/heat/Air%20to%20water%20heat%20pump%20low%20temperature/EBLA04-08EV3.EBLA04-08E3V3.EDLA04-08EV3.EDLA04-08E3V3_User%20reference%20guide_4PEN685231-1A_English.pdf),
     [Altherma 3 R W](https://my.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EHBH-D6V%2C%20EHBH-D9W%2C%20EHBX-D6V%2C%20EHBX-D9W%2C%20ERGA04-08DV%2C%20ERGA04-08DVA_4PEN496758-1B_2019_10_Installer%20reference%20guide_English.pdf),
     [Altherma 3 H](https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-low-temperature/EPGA011-016DV7_EAVH-UD6V7_Installer%20reference%20guide_4PEN606487-1A_English.pdf),
     [older low-temperature split](https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/air-to-water-heat-pump-low-temperature/erhq-bw17/ERHQ-BAW17_4PEN384974-1B_Installer%20Reference%20Guide_English.pdf),
     [geothermal](https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EGSQH-A9W_4PEN351748-1F_2018_02_Installer%20Reference%20Guide_English.pdf)
     and [hybrid](https://www.daikin.eu/content/dam/document-library/Installer-reference-guide/heat/EVLQ05-08CAV3%2BEHYHB%2CX-AAV3%2CAAV2_4PEN355634-1C_2018_04_Installer%20reference%20guide_English.pdf)
     all state circuit/pump-inlet pressure **above 1 bar**. The raw minimum always remains the lowest
     valid sample. A value at or below 1.0 bar surfaces immediately as `Info`; only 60 continuous
     seconds promote it to `Warn`, so debounce controls claim strength without rewriting the
     statistic. Cycling
     and defrost are `heuristic` and can raise `Info`, never a manufacturer/fault `Warn`: the runtime
     divided by detected starts is not a mean of completed same-mode cycles, and X10A lacks humidity
     and evaporator-surface temperature. Defrost count remains available without a compressor-speed
     row; only its runtime share becomes unknown. The raw `count` stays visible, while `paired_count`
     counts only transitions with compressor witnesses at both endpoints and is the three-cycle guard
     for the ratio; unpaired edges cannot lend a partial ratio a larger sample basis. A defrost count
     without a positive paired compressor-runtime denominator remains an `observation` (not
     `heuristic`) and cannot support the aggregate no-finding badge.
     Flow and BUH/BSH runtime are `observation` only.
     Flow excludes the first 60 seconds of continuous pump operation, and no generic flow limit is
     imposed across the 3–18 kW catalog. BUH and BSH keep separate capability/evidence clocks, so a
     missing heater row cannot become zero minutes; observed seconds are carried to the API so a
     1–59-second activation cannot collapse into `0 min`. Protection retries are `experimental`: only a
     strict increase of one individually tracked 3-bit counter between continuous, fully comparable
     samples is an event, including an update visible at a compressor-state boundary. Absolute
     non-zero values are baselines; decreases and possible wrap/reset transitions are unknown and do
     not count as no-event evidence. Pure observations and stable experimental counters do not enter
     `evaluated` or support an overall `Ok`; an actual retry increase can still raise aggregate `Info`.

  **DHW heat loss adds one independent witness without overstating causality.** A candidate window
  requires the 3-way valve outside DHW, the internal water pump and BSH off, plausible R5T, and 45
  minutes of settling after tank charging. The settle is owed to HEAT PUT INTO THE TANK, so it is
  charged only for a witness that stood at least two minutes: a one-cycle valve blip used to cost
  the identical 105 minutes (45 settling plus a fresh 60-minute window) as a 40-minute charge, and
  measured over an otherwise perfect 24 h with a standing tank, one such blip every 90 minutes took
  the day from 23 completed windows to zero. A short witness still discards the candidate — the
  hydronics moved — it just no longer asserts that heat went in. The bound is not a new guess: the
  blind-run budget already asserts that no tank charge starts, runs and finishes inside 120 s. Each
  input is judged on a row the sweep could actually READ. A row
  that did not answer this cycle is *blind time*, not a disqualifying state: since every input rides
  the X10A sweep, where one silent page removes all of its rows from that sample, treating an unread
  second as ineligible discarded the whole accumulated hour. Replayed over the reference
  installation's real 24 h at its observed timeout rate, that cost about half the achievable windows
  — roughly doubling the time to a verdict, and showing as a flat "0 min of 6 h" for the first hours
  of a boot, when only one or two windows are possible at all. Blind time is bounded twice — no single unobserved run long
  enough to hide a tank charge, and a per-window total inside the same 90% evidence rule — and is
  subtracted from the seconds the window reports as observed. A drop of at least 0.4 K inside ten
  minutes is treated as draw-like contamination and discards that segment; a drop that accumulated
  while unobserved is judged against the anchor standing when vision was lost, before that anchor is
  re-armed. The remaining non-overlapping one-hour windows
  report their maximum R5T drop; at least 0.8 K/h is an `Info` project heuristic, while `Ok` requires
  a complete 24-hour lifecycle and six clean hours. When configured, the board subscribes to the
  Shelly's exact MQTT status topic and uses mapped active power with hysteresis, freshness and
  pulse-train-aware confirmation. Repeated motor-power pulses with no gap longer than the configured
  confirmation window are one activity train; OFF still needs an uninterrupted confirmation window.
  A high window is labelled “with pump” only with at least five minutes of confirmed
  run time, and “pump off” only after at least two hours of confirmed off time plus 90% source
  coverage — measured against the window's observed seconds, since the witness is only decoded on
  cycles the segment could see and must not be charged for an unrelated bus going quiet. R5T is a point sensor in a stratified tank: even high loss with the external pump off is
  not proof of a leaking diverter/check valve, a gravity loop, insulation loss or a draw.

  The card also deliberately omits claims the available inputs cannot support: 3-way-valve leakage
  inferred from DHW cooling, even after independent circulation-pump correlation,
  a universal minimum-flow threshold, a flat daily-start alarm, and any overall “healthy” verdict.

  **Persistence** (`logic/checkup_persist.hpp`): the 24-hour window rides `.noinit` DRAM for a
  zero-write reset that keeps power. Completed `CheckupBucket` + `DhwLossBucket` pairs are also the
  fourth source in history's 256-byte append journal, with an exact interval end, model identity,
  layout fingerprint and CRC. This restores counted evidence after OTA section movement and power
  loss without trying to reconstruct short events from the lossy five-minute trends; only the open
  hour can be lost. The RAM seal covers the completed buckets
  and EXCLUDES `pending` (it changes once a second, so a seal over it would be stale whenever a
  panic actually landed) and the monotonic `first/latest_sample_us` anchors, which are meaningless
  in the next boot's clock — the observed lifecycle rides as `CheckupRing::carried_span_us`
  instead; a flash restore derives it from the retained interval ends. The in-flight
  `CheckupState`/`DhwLossState` are NOT restored: a reboot is exactly the
  discontinuity both step functions handle, and restoring them would book a compressor start that
  may never have happened. The MODEL identity is checked at DETECTION rather than at boot
  (`checkup_reset_on_detect()` keeps the window only if the resolved profile matches the one it
  was recorded under) — detection resolves every boot, so treating it as "the identity changed"
  would adopt the window and throw it away four seconds later, on exactly the boards that have a
  heat pump attached (the trap `history.cpp` shipped and documented). TWO refusals are about the
  window OUTLIVING ITS SOURCE, both states persistence created: SAFE MODE never adopts, because it
  does not start the poll task and nothing would age the ring — a frozen pre-reboot day would be
  presented as a live 24-hour assessment for as long as the latch holds; and the poll task feeds
  an EMPTY sample every cycle while the profile is still `"auto"`, so a board whose X10A stops
  answering across a reboot ages the adopted evidence out within the day instead of freezing it
  (the empty sample books no observed seconds — it only advances the clock).
  `/status.health.persist` names the outcome.
- `logic/state_dwell.hpp` — **how long each switched row has read what it reads**, and how much of
  that the board actually watched. The value list answers *what is it now*; for a bit flag that is
  half the question, since `Powerful DHW Operation: OFF` describes a plant that finished a charge
  four seconds ago and one that has not charged since Tuesday equally well. Tracked rows are the bit
  flags (converters 300–307) plus the fault class (203), selected structurally — never by label —
  and addressed by **(page, offset, converter)** for `checkup.hpp`'s reason two bullets up: six flags
  share the byte `0x60/12`. The eight P2 overlay flags participate too: their age describes only the
  unchanged raw neutral ON/OFF bit and does not promote their proprietary polarity or meaning from
  observation to fact.

  It is a **scalar, not a ring**, and that is the whole sizing argument. Nine of these rows already
  have the better answer — a 24-hour categorical timeline whose tooltip names phase start, end and
  sampled duration — and it cannot be extended to the rest: a ring costs 576 B, the trend budget is
  exactly full (`TREND_COUNT × 576 == 18432`, its own ceiling), the remaining rows are not on the
  schematic and so are excluded by `history.hpp`'s selection rule, and each would need a hand-written
  bilingual legend. The whole table is 72 × 16 B = **1152 B** in `.noinit`; the current worst
  profile uses 63 slots, leaving nine spare. It is adopted across a
  power-preserving reset under the same seal, verdict vocabulary and union-storage rule as the trends
  and the checkup.

  Three properties carry the honesty, and all three are published separately on `/values` rather than
  folded into one number — a consumer that prints the number and drops the rest states something
  stronger than the device knows:

  1. **A run joined in progress is a lower bound.** A board up ten minutes whose row read OFF
     throughout has established "OFF ≥ ten minutes". `dwell_min` says so, the UI renders it with the
     relation symbol and **floors** it — rounding a bound to the nearest minute asserts up to 59
     seconds the board never observed — and the UI
     renders a different sentence for it. *Witnessed* is the strict condition — the previous state
     seen in the **immediately preceding** cycle — because a change discovered after even a short
     gap happened somewhere inside it, and publishing an exact "for 0 s" about an instant nobody
     observed is the precision this feature exists to refuse.
  2. **Blind time is not unchanged time.** `poll_once` replaces the whole cache each cycle, so a page
     that did not answer removes its rows outright — 47 timeouts in 8.2 h on the reference
     installation. A flag can pulse and return inside such a gap, so the seconds are booked as
     `dwell_blind_s` and travel with the run. Past `DWELL_MAX_GAP_S` (120 s, `CHECKUP_MAX_GAP_S`'s
     number rather than a third opinion about how long the bus may be quiet) the slot reports
     **nothing at all**, so a silent bus expires its ages instead of freezing them.
  3. **A reboot is not a change.** Adoption books `DWELL_REBOOT_BLIND_S` against every live run
     rather than pretending the downtime was watched; the device cannot time its own outage, and a
     fabricated duration is what `logic/timestamp.hpp` already refuses for an unsynced clock. It
     *accumulates* into any gap already in flight rather than restarting it, or a slot that was
     mid-gap when the board went down would be vouched for across nearly twice the bound above.
  4. **No value, no age.** A row the sweep could not read is published as `"value":null` — the slot
     survives and books the seconds as blind, but the age is withheld, because an age beside a value
     that is not there describes nothing and renders as the literal "— for 3 h 20 min". Both sides
     refuse it: the firmware for the row it published as null, the browser for the rows it blanks on
     its own account (a dead bus, a held-over page).

  Whole seconds are derived by quantising **absolute** monotonic instants, never by flooring each
  interval — `checkup_step()`'s rule, and this file shipped the defect that comment warns about. The
  poll loop sleeps a whole second *after* a serial sweep, so the real cadence is ~1.2–1.3 s; flooring
  each interval discards that fraction every cycle and never recovers it (measured: 23% slow forever,
  so a three-hour state would publish as "2 h 19 min"). Quantising the instants telescopes the
  remainder into the next cycle and bounds the whole run's error under one second. That rule travels
  with its **other half**: `checkup_step()` gates the whole computation on the elapsed time and
  discards the previous state past `CHECKUP_MAX_GAP_S`, and taking only the quantisation would leave
  the bound enforced solely for rows that went *missing*. A row present at both ends of a stall — the
  poll task starved through an OTA install, a cycle dropped by `poll_task`'s `bad_alloc` guard — was
  equally unwatched in between, so the bound applies to the **clock**, not only to the rows.

  It publishes **no Home Assistant entities**: HA carries `last_changed` per entity for free, and
  thirty-four seconds-since-change sensors would be thirty-four permanently-writing recorder rows —
  the rule that already retired the heartbeat's `device_time`.
- `logic/circulation_source.hpp` — the read-only MQTT power witness for the potable-water
  circulation pump (legacy-361): exact-topic/path validation, the ON/OFF hysteresis and the pulse-train
  confirmation tracker (`state` is the CONFIRMED class — on/off/unknown — never the raw sample: the
  witness is a pulsed load, so a lone spike must not flip the state). Its absence is a first-class
  state — the checkup's DHW-loss attribution treats the witness as OPTIONAL evidence and never
  fabricates a verdict without it.
- `logic/redact.hpp` — what a diagnostic snapshot must **not** carry when it leaves the device, for
  `GET /status?redact=1` and `GET /diag?redact=1`. A bug report is filed as a *public* GitHub issue
  carrying the device's own status, readings and log ([`REPORTING.md`](REPORTING.md)), which is only
  defensible because the board scrubs first — so this is the single implementation of that rule,
  shared by the web UI's "Report a bug" action and the manual `curl` fallback, rather than a copy in
  `www/js/app_state.js` that would drift. Two shapes, because the routes leak differently: `/status` leaks by
  **field** (named values, substituted where each is *written* — a post-processing pass over
  the finished JSON is what the httpd stack budget has no room for), `/diag` leaks by **line**,
  which is the non-trivial half the `CHECK`s cover. The 27-field list in `logic/redact.hpp` is
  machine-readable; the audit compares its length with the call sites and its names with
  `REPORTING.md`, then rejects a raw Config string written through plain `jstr()` so a never-wrapped
  identifier cannot hide behind an unchanged wrapper count. Seven entries are user-typed JSON paths:
  paths can contain room/person/device names just as topics do, so they are not structural exceptions.
  An UNSET identifier is left empty rather than substituted (`redact_identifier`, not the
  `redact_or` primitive): `<redacted>` over an empty value manufactures a source the
  installation does not have, and "which optional sources is this device even running" is the
  first question a frozen report has to answer — `mqtt.broker` sharpest of all, where empty
  *is* the disabled state.
  It **fails closed**: a rule whose end token is
  missing — a line the ring truncated mid-value, precisely when a value sits unterminated at the
  end — redacts to end of line rather than giving up, while the trailing newline survives so the
  ring's line structure does. A **set** value is replaced and the **key** kept: a dropped field is
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
  (issue legacy-52, fixed in legacy-65) and is orthogonal to it: that fix stops hostile SSID *markup* from being
  interpolated, while this one
  only guarantees the bytes **parse** — an SSID of `"><script>` is already valid JSON here, and a
  body that fails `JSON.parse` never reaches those DOM nodes at all. Pure, so each control char is
  asserted host-side, including the signed-`char` trap that would otherwise mangle a non-ASCII SSID.
- `logic/mqtt_group.hpp` — register page → friendly group name, the grouped X10A JSON (depth 1,
  groups/keys in first-seen order), and the flat Modbus JSON. Each value carries its
  `PublishedKind` (from its converter), so the JSON type is a property of the **field** and cannot
  change between states — the legacy-209 fan-step failure, where one key alternated between a number and a
  string and the metrics consumer silently kept the stale number. A `Number` whose formatted value is
  not a number publishes `null`, never a quoted string. Text values are escaped through
  `logic/json.hpp`.
- `logic/mqtt_uri.hpp` — broker URI → host/port/TLS split behind `mqtt_ha`'s scheme policy: scheme
  defaults (`mqtt://` 1883, `mqtts://` 8883, `ws://` 80, `wss://` 443 — the WebSocket transports take
  the HTTP(S) ports **esp-mqtt itself** defaults to, so the save-time pre-flight probes the port the
  client will really dial), IPv6 literals, a **URL path** (`wss://host:8084/mqtt` — the normal shape
  of a WebSocket broker; the path is trimmed off the pre-flight's host/port, and esp-mqtt still gets
  the full URI), and the rejects (empty, scheme with no host, empty or non-digit port, and a port
  outside 1–65535 — caught at parse time because the probe's `htons()` would truncate `:65537` to
  `:1` and call a wrong port reachable).
- `logic/heartbeat.hpp` — the board/link diagnostics JSON (a flat object, each field prefixed by its
  block name: `wifi_rssi`, `wifi_mac`, `bus_rx_received`, …) + its 22 diagnostic HA discovery configs
  and the two RETIRED ones whose retained configs must still be deleted, with uptime formatting
  pinned to known-good samples. Carries
  `bus_ou_held_over` — **source** freshness, which is a different fact from `bus_connected`: the link
  is up and the device is publishing while the outdoor unit simply is not measuring, and a consumer
  that only had bus health would read the vanished outdoor keys as a broken link. Deliberately not
  typed as a fault: a resting outdoor unit is the normal state of a heat pump for most of the day.
- `logic/heating_curve_mqtt.hpp` — the IDF-free, schema-versioned `<base>/heating_curve` payload.
  It keeps the accepted `room` source separate from derived `diagnosis` state and groups diagnosis
  gates, room evidence, the durable last-sample event and counters rather than adding domain fields
  to the technical heartbeat. Numeric boolean leaves remain `1`/`0` for the deployed metrics parser.
- `logic/heating_curve_diagnosis.hpp` — the deterministic, allocation- and I/O-free heating-curve
  diagnosis sampler, method version 2. It
  records the **raw** reference-room deviation at most once per 30 minutes during confirmed normal
  space **heating**. It does not contain the retired P gain, deadband, quantization, ±2 K envelope,
  slew limit or requested-offset vocabulary: room kelvin is not calibrated leaving-water kelvin.
  ARMING IS DERIVED from the stored master consent and source configuration:
  `heating_curve_diagnosis_armed()` (`config_model.hpp`) requires diagnostics enabled, the
  timestamped MQTT room mapping and an active HomeHub. Forecast is optional
  comparison evidence; deleting it must not stop local sampling or make location disclosure a
  prerequisite. There is no mode enum, live blob field or route; v14's retired byte is written zero
  and ignored.
  THE TWO OUTDOOR AXES are optional context: plant-side HomeHub input 44 plus ENV III when configured
  and fresh **and** plausible. Input 44 is selected as an explicit fast Modbus context batch and is
  accepted only from the current TCP session; ENV III uses the same pair that gates its MQTT
  document. Each is recorded **with the event**, separately and with provenance, because a room error alone cannot
  separate a curve that is too STEEP from one shifted too HIGH: `+0.5 K` at −5 °C and at +12 °C ask
  for opposite corrections and record identically without it. Like the forecast it is CONTEXT and
  never a gate, but the bar is stricter — the forecast at least splits Recording from Degraded,
  while nothing at all branches on either axis. No state, reason or counter moves with or without a
  source, and `test_heating_curve_diagnosis_contract.mjs` refuses a `blocked`/`hold` on them: a gate
  here would silently stop sampling on a board lacking the context, indistinguishable from the
  feature being idle. Absent or non-finite records as null rather than `0` (a freezing day), a
  sample taken without one source CLEARS that source's previous event reading instead of inheriting
  it under a fresh timestamp, and disarming drops both with the rest of sample memory. Adding them did not move
  `method_version`: the room error is derived exactly as before, so archived events stay comparable.
  THE GATE ORDER inside `evaluate()` is load-bearing. HomeHub connectivity and input register 53
  first prove normal space operation; input register 38 then distinguishes Heating from Cooling;
  only after those gates may room/X10A/clock evidence form a sample. An idle summer plant is a neutral
  HOLD even when its thermostat is off, while cooling is a distinct non-heating HOLD and never enters
  the heating data set. Unknown or stale evidence blocks rather than guesses. Temporary holds/blocks
  retain the last absolute sample timestamp and sequence so recovery cannot manufacture a new event;
  deleting the room source disarms and clears sample memory. No actuator or Modbus write vocabulary
  exists anywhere in the firmware.
- `logic/crashinfo.hpp` — reset-reason slug + fault classification, and the `last_crash` / MQTT crash
  payload + paste-friendly text bundle (incl. the backtrace clamp) built from a captured summary. The
  retained MQTT crash payload (`build_crash_mqtt_payload`) is **crash-only**: the JSON when the boot is
  *notable* (a real fault or a core-dump still in flash), else `""` — the bridge then probes for and
  deletes an older retained crash, but publishes nothing when the broker is already clean.
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
- `logic/modbus.hpp` — read-only Modbus TCP framing (MBAP, no CRC; FC03/04 request build plus
  response/exception parse) and the HomeHub `Temp16`/`Pow16`/`Int16`/`Text16` codecs + exact
  `homehub-*` mDNS filter. Host-tested wire core used by the independent HomeHub task in
  `hp_modbus.cpp`; there is no FC06/FC16 request builder.
- `logic/modbus_plan.hpp` — compile-time HomeHub request batching and two-cadence policy. It proves
  every row is covered once, both diagnosis gates and the named outdoor context remain on the 1 Hz path, and a clean fast-only
  cycle cannot falsely clear an error belonging to a row it did not sample.
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
  path, is_post)` says which routes each surface exposes: on the trusted configured LAN (WiFi or
  Ethernet), everything; on the
  OPEN setup AP, ONLY `GET /`, `/index.html` and `POST /set_wifi` — `/scan` included in what is
  withheld, since the portal takes a typed SSID and an open radio has no reason to be handed a
  survey of every AP in range. `http_start()` picks the surface from the observed provisioning-AP
  state and every concern registers through `http_register_on()`, so `/coredump`, `/diag` and the
  config/OTA/MCP routes never exist on the unauthenticated radio, while an Ethernet-only board still
  gets the trusted-LAN surface. Host-tested so the allow-list is asserted, not re-derived per file.
- `logic/http_request.hpp` — the browser boundary on the configured LAN, applied by
  `http_common.cpp`'s one `handle_all` trampoline before **every** registered route. `Host` must be
  the fixed mDNS name or a current WiFi/Ethernet IPv4; a present `Origin` is checked independently
  against the same device identities, and cross-site/unknown Fetch Metadata fails closed. Native
  clients without browser headers remain valid. Every POST carrying a body must declare
  `application/json`, excluding CORS-safelisted form/text requests. The captive portal skips only
  the Host/browser check because OS probes intentionally arrive under unrelated hostnames.
- `logic/query_flag.hpp` — `query_flag_on(value)`: a `?verbose=1`-style flag fires only on exactly
  `"1"`. `httpd_query_key_value` succeeds on key PRESENCE, so acting on that alone formerly let
  `?clear=0` wipe the diag log / coredump. Clearing is no longer a query flag: only the explicit
  POST `/diag/clear` and `/coredump/clear` routes mutate evidence.
- `logic/config_store.hpp` — the atomic config blobs (F02): `config_blob_serialize` / `deserialize`
  pack the credential + service fields (WiFi creds + rollback backup + flags, MQTT, syslog, NTP) into
  one length-checked, CRC32-protected byte blob written to a single NVS key. A single `nvs_set_blob`
  is entry-atomic, so the blob is all-or-nothing across BOTH a mid-write NVS failure AND a power cut
  — no per-key rollback, no write-ordering. `link_blob_serialize` / `deserialize` give the separately
  owned RX/TX/protocol/identity cache the same one-entry CRC boundary. Ordinary service routes succeed
  once their `cfg` blob lands even if best-effort link maintenance fails; an X10A `/set_hp` explicitly
  requires its `link` write (`config_save_succeeded`, host-tested). Each decoder returns false without
  publishing a partial value, so a fresh device / pre-blob OTA falls back to that domain's legacy
  per-key load. Host-tested: CRC golden vector, round-trips, and corruption/truncation paths.
- `logic/mcp.hpp` — the complete IDF-free core for `/mcp` (F14): a bounded, depth-aware JSON scanner;
  JSON-RPC structure/id validation and exact id echo; `initialize`, `tools/list`, and `tools/call`
  dispatch; MCP revision negotiation; the fixed two-tool no-argument catalog; and result/error
  envelope builders. It maps malformed/invalid/missing-method-or-tool/invalid-params requests to
  `-32700/-32600/-32601/-32602` and identifies notifications for the transport's empty HTTP 202.
  `mcp_server.cpp` supplies only the app version and the existing `/status`/`values` snapshots.
  Its GET handler is method-selected documentation rather than another transport: an embedded,
  dependency-free page explains MCP and provides client configuration, wire examples, and the
  fixed tool catalog. It makes no network requests and ships with `connect-src 'none'`.

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
  monitoring values — and `def/registry.hpp` maps a **profile id** to its table. The maintainer's
  profile generator and its proprietary Daikin catalog input are intentionally not distributed in
  this repository; only their generated C++ output is shipped. Generated tables are never
  hand-edited — maintainers regenerate them offline, and the checked-in rows are verified against
  [`REGISTERS.md`](REGISTERS.md). Contributors can propose catalog corrections without possessing
  the generator input; the maintainer performs regeneration and includes the resulting diff.
- **One hand-written supplement file exists, and it is temporary: `def/overlay.hpp`.** Every generated
  profile carries six rows for page `0x10` where [`REGISTERS.md`](REGISTERS.md) §5 documents
  twenty-six — uniformly, all 43 tables agreeing row-for-row, so it is the generator's page-`0x10`
  input that is narrow, not a per-model absence. Among the missing rows are the **protection-retry
  counters** (offsets 10–12, converters 303/307/310/311), the input signal for the "silent protection
  retries" early warning (issue legacy-69 UC5 / legacy-110). Converter 310 has been implemented since PR legacy-111 but
  had no row to decode, so it decoded nothing in the field. The first supplement block supplies
  those 11 rows without touching a generated table. A second block adds 27 control, safety and
  actuator rows only to the reference 4–8 kW monobloc profile; 19 are P1 diagnostic inputs and eight
  retain neutral P2 observation semantics. `HP Forced FG` is withheld because its bit aliases the
  complete one-byte CT-L3 field; the availability ledger withholds CT-L3 while that bit is asserted,
  and neither the flag nor a simultaneous current is claimed until a mask is evidenced.
  `logic/profile_view.hpp` presents *generated + applicable blocks* as one row sequence to every
  consumer. **The overlay rule — every register page a block uses must already occur in the base
  profile** — is what makes this safe where hand-editing a
  generated table would not be: it can never set a page bit that was not already set, so it cannot
  move detection (`def/signatures.hpp` builds its mask over the base tables and never sees a view
  anyway) and cannot add a bus round-trip. The mixed-page block is all-or-nothing: one absent base
  page withholds the complete block rather than publishing a partial contract. The rows are audited
  like generated ones —
  `tools/domain/catalog_audit.cpp` resolves the view, so they are cross-checked against
  [`REGISTERS.md`](REGISTERS.md) §5 per profile. **Delete each block when `gen_profiles.py` emits its
  rows byte-identically, and delete the file/plumbing when none remain**; a supplement that outlives
  its generator run is a second source of truth for the catalog.
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
  not the whole source tree; labels are English-only. If size ever pressures the OTA slots,
  profiles can move to a data partition — the indirection through `def/registry.hpp` makes that a
  non-breaking change.

Porting fidelity is enforced on the host: the domain audit (`tools/domain/catalog_audit.cpp`, run by
`scripts/run-domain-audit.sh`) resolves every profile's rows and cross-checks them against
[`REGISTERS.md`](REGISTERS.md) §5, and `test/test_logic.cpp` pins the frozen identifier set, so a
regenerate can't silently drift.

## The poll engine (`hp_poll.cpp`)

A single task owns the X10A UART (there is exactly one link). Each cycle:

0. Resolve the active profile to its **row view** (`def::resolved` — the generated table plus every
   applicable supplement block above). Everything below iterates the view, and so do the HA-discovery
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
   Cheap by construction: it resolves the trended rows — three scalar comparisons per row, since a
   trend addresses its row by (page, offset, unit) rather than by matching its label — folds one
   sample into each open 5-minute bucket, and only writes a ring when a bucket boundary is crossed.
   The resolve is `TREND_COUNT` × the profile's row count of those comparisons, once per second, so
   it stays cheap as trends are added — but it is the one cost here that scales with the table, and
   the reason the table follows the dashboard's pills rather than every numeric row (`history.hpp`). The fold is where the
   held-over rule earns its place — a sample taken while the compressor rests is stored as *held
   over*, not as the number the frozen outdoor page keeps returning (`logic/history.hpp`,
   composing `logic/ou_stale.hpp`).

   **The rings survive a reboot** (`logic/history_persist.hpp`). They are still not in NVS — a
   576-byte blob rewritten every five minutes would be ~100k writes a year in the partition holding
   the WiFi credentials — but "not in NVS" no longer means "gone on every restart". Two media,
   each covering exactly what the other structurally cannot:

   * **`.noinit` DRAM.** The ring arrays are simply no longer zeroed at startup, so any reset that
     kept power (a `/set_*` save, an OTA install, a panic, the task watchdog, the recovery button)
     keeps the readings. It costs no flash write and no extra RAM — it is the *same* memory the
     route serves, not a shadow copy — and the flash image shrank by ~26.5 KB, because `.data` no
     longer carries an initialiser for rings that are about to be overwritten anyway. It needs no
     clock, and that is a property of the medium rather than an assumption: if the bytes survived,
     power was never lost, so the downtime is bounded to about a second. The one seam is the bucket
     that was open when the device went down — it is dropped, so the restored series can be up to
     one `HISTORY_DT_S` adrift on the axis. It cannot survive an OTA: the new image's sections move.
   * **The upper-4-MiB `history` partition.** Each trend source appends one dense record when it
     closes a five-minute bucket: currently 32 X10A/board, 13 HomeHub or 3 ENV III `int16` values in
     one 256-byte slot. The plant checkup uses the same journal for one exact hourly diagnostic
     record; it is not reconstructed from lossy trend samples. Sixteen slots share a 4 KiB erase
     sector and all 1024 sectors rotate before one is reused. The body is CRC-protected and a
     separate commit word is programmed last; a power cut can invalidate only the open write, never
     its predecessors. A torn mid-sector slot is skipped because erasing it would also erase older
     committed slots. Slot width grows by powers of two with the largest source catalog, and a
     compile-time guard requires at least 72 hours with all four sources active. Today 16,384 slots
     make one physical rotation about 52.3 days with X10A plus diagnosis or 18.4 days with all trend
     sources plus diagnosis — roughly 7.0 or 19.8 erases per sector/year.
     Older physical records are wear reserve rather than being erased at the
     72-hour display boundary. The former 8 KB partition is removed entirely. Because OTA does not
     deliver the partition table, an old-layout board needs one USB/Web-Serial re-flash to install
     the official 8 MB table without moving NVS, coredump or either OTA slot.

   **A sudden power loss loses at most the open bucket and a just-closed record still waiting for
   the next poll tick.** Normal persistence runs continuously; the `esp_restart` shutdown handler is
   only a bounded final drain for the OTA/reconfiguration race. `/status.history.persist`
   independently reports what happened to RAM.

   The flash path is **spliced in behind** the live samples at the absolute wall-clock bucket each
   sample was taken in, never appended — appending would slide a day-old curve onto today. It waits
   only for SNTP and can seed an empty live ring immediately; elapsed buckets after the stored anchor
   become explicit gaps. The boot scan indexes only the final 24-hour source windows; restore reads
   each indexed record once per four-ring batch, so no second 26 KB matrix or one unbounded
   flash/UART stall is introduced. The oldest and newest indexed record buckets define the restored
   span; sample values do not. That distinction preserves an all-`NO_READING` register's raster
   instead of mistaking its recorded absences for unwritten leading scratch.
   Measurement history is no longer copied through browser `sessionStorage`; that storage keeps only
   the transient status/value render frame while an OTA is in flight. There is no sparse/coarse
   fallback record. The `.noinit` path remains gated on a **catalog fingerprint** over every trend
   id, kind, locator and the ring geometry, because its live rings are addressed only by index. Its
   seal deliberately excludes the open bucket's `pending`: covering
   it would leave the CRC stale for all but microseconds of every five minutes, so a crash — the case
   this exists for most — would discard a day of intact readings essentially always.

   Flash keeps the same compact index-addressed five-minute records but makes each catalog generation
   self-describing with a separate **semantic-id manifest** per source. The id covers the public trend
   id plus every field that changes a stored sample's meaning: source, locator, kind, converter and
   unit for X10A; register and event-folding policy for HomeHub; id and unit for ENV III. Display
   labels are deliberately excluded. Restore maps the current id to the stored index, so adding or
   reordering a row preserves every unchanged curve while a genuinely new or reinterpreted series
   alone starts empty. Duplicate ids, an unknown pre-manifest generation or a damaged manifest fail
   closed. A manifest is written before a generation's next data record and refreshed once per
   24-hour ring, keeping a recent copy in the circular journal without repeating ids in every bucket.
   Four generations per source are cached in bounded static memory. The exact 31/12/3 catalog before
   the disinfection histories has an explicit legacy adapter; the two then-new disinfection series
   correctly have no predecessor. Existing 32/13/3 records from the current generation match its
   layout directly.
   Diagnostic checkup records carry their own fingerprint and remain independent of trend counts.

   `/status.history.persist` names how this boot's rings came to be, so a chart that emptied itself
   has a stated cause instead of looking like a defect. It describes the `.noinit` adoption decision;
   a refused RAM image can still be extended from a compatible flash generation after SNTP. Three
   more `logic/history_persist.hpp`
   rules, all pure so they are asserted rather than discovered on a board: **which reset reasons
   leave DRAM intact is an ALLOW list** with everything unrecognised refused — BROWNOUT and
   PWR_GLITCH are refused rather than left to the CRC, since a dipped supply proves nothing about
   the contents; a snapshot claiming to be **newer than the live ring is refused outright** rather
   than clamped (the anchors disagree about the present, so every position for it would be a
   guess), and **the live sample always wins** an overlap, including when it is an absence — this
   boot observed that bucket itself, and a retained payload from a previous life of the same five
   minutes must not overwrite the observation; and the verdict is a **named enum**, never a bool —
   `wrong_catalog` after an OTA is expected and uninteresting, `bad_crc` on a board that was never
   power-cycled is a memory fault worth knowing about.
   The independent HomeHub task feeds thirteen additional rings through `history_record_modbus()` — eight
   measurement concepts plus BSH, 3-way-valve, Quiet, Smart-Grid and the standalone disinfection
   state explicitly named in `logic/homehub_map.hpp`. Both recorders use the same monotonic 5-minute bucket id, returned as `b0`
   by `/history`, so the browser can overlay them exactly even before SNTP. An X10A absence stays a
   gap in the blue line while a HomeHub sample at that bucket remains a petrol point; the sources are
   never merged into one synthetic series.
4a. **Mark source freshness.** Before step 4, the cycle locates the compressor witness
   (`logic::ou_is_rps_witness` — "INV frequency (rps)", which must sit on a page that stays live) and
   marks every cached reading whose page the outdoor unit is no longer refreshing
   (`ou_reading_held_over`). The value is *kept* — the trend ring needs it to tell **held over** from
   **no reading** — but `CachedValue::held` travels with it, `/values` emits `"held":true`, and the
   MQTT bridge withholds the row entirely. Before this the browser applied the rule and the firmware
   did not, so the state topic kept republishing the last run's outdoor air in a freshly-timestamped
   payload; measured against a HomeHub reference in
   legacy-209, that was exact agreement at every
   point while the compressor ran and a mean 1.19 K (max 2.0 K) error across the 195 points while it
   rested. The heartbeat's `bus_ou_held_over` says *why* the keys went away, so a consumer reads a
   resting unit rather than a broken link.
4b. **Raw page capture while the unit RUNS** (`logic/raw_capture.hpp`). The detect-pass dump in
   *Auto-detection* below captures pages `0x10`/`0x20` at rest, which is the state in which the rows
   under investigation are *not* wrong — the limitation that left
   legacy-194 undiagnosable. This one fires on
   the stopped→running edge, then every `RAW_CAPTURE_PERIOD_S` (5 min) during the run, at most
   `RAW_CAPTURE_MAX` (8) times **per boot, never refilled** — a series rather than a point, because
   two candidate scales that both fit one sample may not fit a curve, and a budget because one line
   per second would evict the rest of the boot's evidence from the 6 KB diag ring within a minute.
4c. **Fold the cycle into the rolling plant diagnostics** (`checkup_record()`, `checkup.cpp`), beside the trend
   rings and on the same terms — before the commit, outside the cache mutex, with this cycle's values
   still the task's own. It counts **events**, signal-specific observed seconds and **window minima**:
   compressor start edges and observed runtime, defrost transitions, separate observed BUH/BSH
   seconds, raw water-pressure minima plus a separately confirmed low-pressure fact, steady flow
   after a 60-second pump run-up, the unit's fault class and
   strict per-counter protection-retry increases. That is why it is here and not derived from the
   trend rings afterwards: `TrendRing::fold` keeps only the **last** reading of each 5-minute bucket,
   so a compressor cycle shorter than five minutes leaves no trace in the ring at all — the short
   runs this observation exists to preserve are exactly what that raster cannot see. Events are folded
   once per completed sweep; pulses entirely between sweeps remain unobservable. The compressor state
   from step 4a is **handed over** rather
   than re-derived, so the checkup and the held-over marking cannot disagree about whether the unit
   was running. The active profile supplies capability independently of this cycle's successful reads,
   so page loss becomes missing evidence rather than either “unsupported” or zero. Every rule — row
   identity, edge handling, evidence clocks and verdict/evidence class — lives in the host-tested
   `logic/checkup.hpp`; storage is 23 completed one-hour buckets plus the pending hour in static
   `.noinit` RAM, never 24 completed buckets plus an accidental 25th open hour. A reset that keeps
   power adopts that RAM in place; the completed hour pairs also append to history's flash journal
   for OTA and power-loss recovery. Intentional `esp_restart()` additionally
   writes a separately sealed, one-shot DHW handoff under the same mutex: relative candidate ages,
   the settling guard and completed DHW windows still in the open generic hour. The next boot books
   five blind seconds and consumes that handoff once; a panic never replays an older checkpoint.
   See *The host-tested logic core* for why a
   row is addressed by (page, offset, **converter**) here and by (page, offset, unit) in the trends.
5. Sleep `POLL_INTERVAL_S` (fixed 1 s — see `config.cpp`). The MQTT bridge and HTTP `/values` read
   the cache; they never touch the UART. X10A, HomeHub and ENV III trends are not published to MQTT — they exist for
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
**link** (RX/TX pins + protocol + observation identity) *is* persisted as a boot-invariant cache —
loaded first, tried first, re-saved on change — with the compile-time defaults as fallback so a stale
cache self-heals.
The loaded pins are re-checked with `link_pins_safe` — the **pair** rule plus the chip-reserved-pin
rule, the same ground the request path covers via `validate` — and dropped for those defaults if they
fail. Both write paths — HTTP's `config_save` and detection's revision-checked
`config_commit_detected_link` — serialize the complete link into one
CRC-protected `link` NVS blob. It remains separate from the atomic credential/service blob because it
has two owners, not because its fields are separate: a **power cut** or failed write leaves the
previous complete link intact instead of durably pairing one new pin with one old pin. Load still
validates the decoded pair because a legacy per-key migration, corruption, a copied NVS image or a
future format mistake is untrusted; the sweep already skips `rx == tx`, while this guard additionally
covers the upper GPIO bound and chip-reserved flash/strapping/JTAG pads. A failed `link` write is named
on `/diag`, and `/status` never reports an unconfigurable persisted link as fact.
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
   0xA0,0xA1`) plus `0x11`; set a bit in a **page mask** for each page that answers. Each page is
   **retried up to `DETECT_PAGE_TRIES` (3) times** before its bit is cleared. This probe gathers the
   unit's *identity*, not its values, so expected missing/rejected pages stay quiet at transport
   level (`logic/hp_query_log.hpp`); partial/corrupt frames remain visible, and a completely silent
   link still produces one actionable detection result. `signature_consistent` matches on page
   **subset** — so one
   dropped frame clears one bit and can make *every* profile inconsistent at once. Measured against
   the shipped signatures on a live `0x1bff` fingerprint, all 12 single-page losses change the
   answer and **8 of them leave no candidate at all**, which lands the unit on `generic` (53 rows
   against ~99, with no leaving-water measurement, no compressor speed and no pressures). There is
   no page it is safe to drop, so the probe does not drop one lightly. The retry costs nothing on a
   page that answers, and by this step the pins and framing are already proven (legacy-214). The sweep
   reports on the `/diag` detect line how many retries **recovered** a page, as `retries=` — so a bus
   working harder to hold its fingerprint together is visible before it changes the answer. Only
   recovered retries count: every sweep probes pages no single model carries (`0x65` answers on none
   of the measured units), and counting those made a healthy boot read `retries=3`, which trains the
   reader to ignore the number. `0` is healthy; any non-zero is a reply that was actually dropped.

   A page that answers with an **all-zero payload still sets its bit**, deliberately. Zeros mean the
   *feature* is absent, not the *page* — and the subset rule needs page presence. Suppressing such a
   page was tried and is wrong in exactly the expensive direction: on the measured unit page `0xA1`
   answers with 16 zero bytes, and dropping its bit moves the pick from a register-identical
   Altherma to a **ground-source** profile. Absent features are the availability layer's problem
   (`logic/availability.hpp`), not detection's.
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
   the ceiling — since resolved as a `÷128` register mis-assigned to conv `114`
   (`logic/conv_override.hpp`) — and the two outdoor pressures (`0x20` offsets 12/14) held **0.0 bar** through every
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
backoff cadence instead of pinning `generic`). When the bus *did* answer but **nothing matched**,
that is still not committed on the strength of one sweep: `detect_commit_no_match` requires
`DETECT_NO_MATCH_CONFIRMATIONS` (2) consecutive bus-answering sweeps to agree before the unit is
read with `generic`. A catalog this does not know and a fingerprint with a lost page bit look
identical in a single pass and cost very different amounts, so the expensive interpretation waits
for corroboration — a transient cannot survive two independent passes, while a genuinely
unrecognised unit says it twice and is then read with `generic`, which is the honest answer for it.
It is a **count**, not a timer, because the sweep cadence itself backs off: two passes stay two
pieces of evidence at any cadence, where a wall-clock window would quietly become one. Waiting
persists nothing — the model is RAM-only either way — and `POST /detect` clears the tally so a
forced re-detect cannot inherit a confirmation it never earned. The model goes to the in-RAM config
(`config_commit_detected_model`), while a changed link cache (pins/proto/identity) is persisted by
`config_commit_detected_link`. Detection captured a config revision before its seconds-long sweep;
under the poll-generation barrier, the link helper compares that revision while holding the config
mutex and returns a fresh revision token. The model helper accepts the session-only profile only if
that token is still current. Thus an HTTP save or `/set_hp` generation bump wins atomically and the
stale sweep is discarded — it cannot write old credentials or a previous link back after the user
received `{"ok":true}`. These helpers patch only detection-owned fields (`apply_link` / `apply_model`
in `logic/config_model.hpp`, host-tested); whole-struct `config_save` remains for the HTTP handlers,
which own the credential/service fields and are serialized on the single httpd task.

- **exactly one candidate** → applied; the UI shows "Detected: <family> · ~kW".
- **several candidates** → the best-fit representative is read with. The 41 Altherma models collapse
  to a few page-mask classes, and within a class they often differ only by untestable flag bits (e.g.
  an ERGA split vs an EBLA monobloc differ by one bit with identical labels), so the exact model
  **cannot** be determined from bus data. The UI reports this honestly — the distinct candidate
  **families** plus the O/U EEPROM digits to match the nameplate — rather than asserting a guessed
  name.

  What this used to claim, and what is measurably true, differ (legacy-230 B). The claim was that a
  representative choice is free because "every candidate is register-equivalent, so the decoded VALUES
  are identical". It is not: the tie `detect_best` resolves is on the page **count** and the kW-class
  **span**, both coarser than the row tables, so tied candidates need not be register-equivalent at
  all. Measured over every fingerprint a real unit can present (each catalog page mask × capacity ×
  both capacity sources, 336 in all): **152** reach the final tie-break, **98** of those are between
  profiles whose `(reg, offset, conv, size, type)` multisets differ — by up to **8** rows — and on
  **108** the choice decides at least one published identifier. So the pick can change which values are
  decoded, not merely how they are spelled, and a label is an identifier
  ([`ha_slug`](../main/logic/ha_device.hpp) → the HA entity id **and** the VictoriaMetrics series
  suffix).
  That is why criterion (4) is the **lowest profile id** rather than "first in signature order":
  registry order is an incidental property of a *file*, so adding, removing or merely **reordering** a
  profile silently reassigned identifiers — measured at **11275** moved publications over 200
  registry permutations × 336 fingerprints, across **90** distinct identifiers. Keying the tie on the
  id makes the (still arbitrary) choice **stable**, and `test_tie_break_order_independence()` asserts
  it by permuting the registry and requiring the same pick. Adopting it moved **nothing**: 0 of the
  336 fingerprints re-label anything, the live reference unit included, so no installed device needed
  a legacy-221-style migration. It is deliberately **not** a better guess — preferring the majority spelling
  would assert a model the bus cannot evidence, and two alternatives were measured and rejected
  (fewest-identifiers moves 13 ids on 8 fingerprints for no evidentiary gain; exact-page-mask changes
  nothing at all, an inert rule that would read like a guarantee). What remains is bounded rather than
  solved: `test_tie_break_reach()` freezes the **90** identifiers a tie-break can still decide, beside
  `test_tie_break_identity()`'s **34** register-equivalent divergences — neither set contains the
  other (2 ids are equivalence-only, 32 reachable-only).

  When the O/U capacity is **absent**, the candidates additionally span different kW classes — so they
  are not even close to interchangeable — and the set is narrowed by the I/U capacity code instead
  (legacy-225): a candidate is dropped when its kW class **contradicts** the
  derived capacity, never merely for stating no class — the latter would let ranking decide
  membership, and a profile with no class in its id contradicts nothing. The narrowing is applied
  only when at least one surviving candidate's class **corroborates** the fallback; an I/U code that
  fits no class at all is not evidence about this unit, and acting on it would exclude every classed
  candidate at once. Before this, the set ignored a fallback the *ranking* already used, so the live
  8 kW unit reported 8 candidates across 4 marketing families — including 14–16 kW models — while
  the representative had long been constrained to the 4–8 kW class. That over-broad report is not
  inert: it put one unit into the record as two independent families (legacy-213, corrected in legacy-219).
  Narrowing is **not** resolving — the survivors stay genuinely indistinguishable on the bus, and
  `ambiguous` stays true. Both are on the dashboard's Model card, beneath the brand heading
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
system are all firmware → client, and there is now exactly **one** of them: firmware → MQTT, where
the bridge publishes state on its own cadence. It is downstream of — and independent of — the polled
HP link.

### The browser polls too, and that is a decision, not an omission

The web UI used to be pushed over an `/events` WebSocket (the poll task broadcast values every cycle
and status every fourth). It was **removed**. The dashboard now polls `GET /values` every 2 s and
`GET /status` every 8 s on one chain, backing off to 30 s when the device stops answering and
suspending entirely while the tab is hidden.

The case is empirical. Measured on the live board while investigating legacy-238:

| test | result |
|---|---|
| **4376 concurrent `GET /status`** (the poll path) | **no crash**, heap steady |
| 1 `/events` subscriber, 200 s (33 status + 132 values broadcasts) | no crash, heap flat ~159 KB |
| **3 `/events` subscribers** | **crash in < 20 s** (`wdt`) |
| **3 `/events` subscribers**, again | **crash in seconds** (`panic`) |
| 3 subscribers, 240 s | no crash, but `ws_status` **frozen at 3** while `ws_values` reached 471 |

Two defects came out of it, and neither was bad luck — both are properties of pushing from this
firmware:

* **The stream could die silently and stay dead** (legacy-238/legacy-239). `httpd_queue_work()` is one UDP
  datagram to the server's control socket, whose mailbox holds `LWIP_UDP_RECVMBOX_SIZE` (6)
  messages. An overflow is dropped **silently** — `sendto()` succeeds, IDF answers `ESP_OK` — so the
  completion callback never ran, the backpressure gate was never released, and `try_begin()` said no
  forever. The common symptom was not the crash: values kept flowing while model, health, heap and
  uptime froze on screen, with **nothing** logged.
* **The push put the `/status` builder on the wrong task** (legacy-241/legacy-242). `http_append_status_json()`
  ran on the httpd task *and* on the poll task, because the broadcaster lived there. That is a
  ~3.5 KB JSON build (including `config()` **by value**, ~10 `std::string` copies) on the task that
  owns the X10A UART: `hp_poll 7664/520` — 520 bytes of 8192 left, killed by the stack watchpoint.

The generalisation is the reason not to try again with a better socket. A **push** fails silently and
globally: one lost message strands every client until reboot, and the delivery machinery runs on
whichever task happens to own it. A **poll** fails loudly and locally: one request, one `503` or one
timeout, on the client's side of the wire, retried on the next tick — and every route already runs
under the `handle_all` OOM guard that returns that `503`. It is also cheaper to reason about than to
keep: `/status` and `/values` exist anyway, so removing the push deleted a transport, a broadcast
registry, two backpressure gates, a frame policy, an sdkconfig backstop and a route, and added a
`setTimeout` chain.

What it costs is stated plainly: the screen is up to one cadence behind (~1 s on average for
values), and each tick is an HTTP request rather than a frame. On a dashboard for a heat pump whose
poll engine reads the bus at 1 Hz and whose motion is CSS, neither is perceptible.

## Network transport (WiFi, or the optional wire)

Two transports can carry this device, and exactly one thing above them knows it: `main.cpp`'s boot
fork. The HTTP server, MQTT, syslog, SNTP, OTA and mDNS all run unchanged over either — an Ethernet
board is not a variant of the firmware, it is the same firmware with a different cable.

**The wire is optional and DETECTED, not configured.** CI publishes one `esp32s3` image, so the
W5500 controller (`net.cpp`) cannot be a compile-time board choice. At boot the firmware reads the
chip's `VERSIONR` identity register over SPI; a board without one **frees the SPI bus again** and is
byte-for-byte the device it was before — no netif, no driver, no task, no event handler. `GPIO5–8`
stay ordinary offerable pads, which matters because they are exactly what a XIAO breaks out and what
[BOARDS.md](BOARDS.md) offers for X10A on an AtomS3 Lite header.

**The probe refuses to run over a pad the firmware already drives.** It clocks SCLK and asserts CS;
if X10A, an enabled ENV III, the indicator or the button owns one of the four, there is simply no
Ethernet this boot (`logic/net_link.hpp` → `net_eth_probe_allowed`). The alternative is edges on the
heat pump's service bus, whose symptom — a bus that answers erratically at boot — is the hardest
thing in this project to attribute to its cause.

**The boot fork, in order, and each step is a host-tested rule:**

| Step | Rule | Why it is a rule and not an `if` |
|---|---|---|
| 1. Ask the wire | `net_eth_start()` | Two questions, two deadlines: "is a cable connected" is answered by the PHY in ~4 s, "will DHCP answer" gets 3 × `CONFIG_DAIKIN_ETH_WAIT_S`. One timer for both made a credential-less board sit dark for a whole lease window before its setup AP appeared. |
| 2. Maybe the radio | `net_wifi_start_needed(eth_up, configured)` | A wired board does not spend ~50 KB of heap and a second netif on a radio nothing will route over. |
| 3. Maybe the portal | `net_portal_needed(eth_up, wifi_up)` | **The load-bearing one.** A wired board with no stored SSID would otherwise open an OPEN SoftAP nobody is coming to configure — and that AP restricts the HTTP surface, withholding the entire API from the LAN the device is reachable on. |

**The trust surface follows the AP, not the radio.** `logic/http_surface.hpp`'s
`http_surface_for(setup_ap_running)` replaced a test on `esp_wifi_get_mode() == WIFI_MODE_STA`. That
test was wrong in both directions once a wire existed: a wired board has no station (so the API
would be withheld from the cable), while "a wire is up, therefore trust" re-opens F01, because the
setup AP can be radiating at the same time and `esp_http_server` registers routes per **server**, not
per interface. Only the AP's own existence is the correct input. `test/test_transport_contract.mjs`
pins that over source text, along with the two gates above and the probe guard.

**Both transports may hold a lease at once** — a board that fell back to WiFi and later had a cable
plugged in. The wire wins: the Ethernet netif is created with `route_prio` 128, above
`WIFI_STA_DEF`'s 100 (ESP-IDF ships `ETH_DEF` at 50). Be precise about what that buys. **Off-link**
destinations — the broker, syslog, SNTP, the OTA feed, Open-Meteo — follow `netif_default` and so
follow this priority. **On-link** destinations do not consult it at all: lwIP's `ip4_route()` walks
`netif_list` and takes the first matching subnet. With both interfaces on one /24 that is whichever
registered first. The asymmetry is accepted rather than fought — forcing per-packet source selection
across two netifs on one subnet means overriding the stack's routing, and the case it would improve
is the runtime hot-plug, where WiFi is already running anyway. The benefit this transport exists for
lives in the boot-with-cable path, where there IS no second netif.

**Pulling the cable from a board that came up wired is answered by a reboot.** Such a board has no
station running, and growing one at runtime would put the boot fork in a second place where it can
drift — with a blocking boot window, a duplicate mDNS/watchdog setup and a possible fall into the
setup portal, all from an event handler on a live device. So `net_eth_fallback_step()` counts ~30 s
of proven silence and restarts, which re-runs the real fork (no cable → WiFi → portal). It costs ~5 s
of an outage that has already started, the trend rings survive it (`.noinit`, see
[history persistence](#the-24-hour-trend-rings-historycpp)), and it is deferred while an OTA is
installing. A board with **no** configured WiFi never counts at all: there is nothing to fall back
to, so rebooting would only replace a device waiting for its cable with the same device minus its
uptime and its diag ring. The wire is reclaimed silently if it returns.

**What the wire costs, honestly:** ~64 KB of flash in the one published image that every board pays
for, and — on the AtomS3 Lite specifically — the ENV III sensor, because the PoE base covers the
whole side header and only the Grove port (which X10A needs) is left. That is a per-installation
trade, stated in [BOARDS.md](BOARDS.md) rather than discovered.

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

- **Read-only** — no command topics. This bridge mirrors telemetry and never actuates the heat
  pump or Shelly plug. A logical reference-temperature input may assemble temperature, target and
  source time from three independent exact MQTT topics (or use a fixed target); another optional
  exact-topic subscription captures the circulation pump's active-power witness,
  but no averaging or control path reads it. A configured payload timestamp (RFC3339 or Unix
  seconds) supplies age across retained delivery and restarts; without one, only a non-retained live
  delivery may age from monotonic MQTT arrival. `POST /set_ref_temp` records the mapping immediately,
  including an empty or unverified JSON path, and rebinds the existing authenticated client only
  while the device-wide v19 diagnostics master is enabled. With that master off, the mapping remains
  saved but dormant: there is no subscription or decoding. Once enabled, the next real MQTT frame
  either builds a complete fresh aggregate or records its decoder error in
  `/status.reference_temperature.error` and the rate-limited diagnostic log; analysis remains
  fail-closed meanwhile. An empty topic remains the explicit disable operation. The circulation
  mapping independently requires `POST /test_circulation` proof before
  `POST /set_circulation`; its threshold state is derived from mapped watts, never relay `output`.
  Neither link can write: X10A has no write command by protocol, and no source file can
  build or issue a Modbus frame for the HomeHub (see [MODBUS_PROTOCOL.md](MODBUS_PROTOCOL.md)).
- **One HA installation device.** Its id is the slugified MQTT base topic
  (`daikin-altherma-esp32` → `daikin_altherma_esp32`, `logic/ha_device.hpp`), which is a **runtime**
  setting (`POST /set_mqtt` field `base`, `logic/mqtt_base.hpp`) precisely because it names the
  installation: CI publishes one image, so two boards left on the shared default become one device.
  A base that slugifies to nothing is refused rather than absorbed by `device_node_id()`'s `"daikin"`
  fallback, which would re-create that collision. Replacing the ESP32
  keeps the device with its entities, history and long-term statistics — where the old MAC-derived
  `daikin_<mac3>` produced a second device and restarted every statistic. The board's MAC id lives
  on as the **MQTT client id** (unique per connection) and a **second `dev.ids` entry** (HA matches a
  device by any identifier and merges, so a MAC-identified install is adopted rather than
  duplicated); the configs an older build published under a superseded identity — that MAC node id,
  and the pre-legacy-221 un-grouped entity ids — are retracted in **one bulk pass that completes before any
  replacement is published** (the diagnostics once per boot, the value entities once per detected
  profile), so the freed `entity_id` is reclaimed by the new entity and its recorder history and
  long-term statistics carry over. The device contains X10A values plus board/link diagnostics;
  HomeHub register values remain MQTT-only.
- **Own publish task + esp-mqtt client.** The event handler flips status flags and copies saved room
  or saved/temporarily-tested circulation payloads into one bounded queue. JSON parsing, string work,
  room-source runtime diagnostics, circulation test subscription changes and all publishing happen in the task, so the mqtt
  event loop is never blocked by either.
- **X10A-gated installation ownership, not MQTT input.** MQTT configuration is not authority to
  speak for the installation. Before the first valid X10A reply, the client connects without the
  shared `<base>/status` last will and services only configured reference-temperature and
  circulation-power subscriptions/tests. All ordinary discovery, state, heartbeat, crash, weather and Modbus publication
  remains blocked. The only outbound exception is explicit Settings cleanup: clearing an enabled
  Weather or HomeHub configuration queues that source's retained empty tombstone after the disabled
  config was persisted. When `HpStats` first records a valid bus reply, the task cleanly stops and
  destroys that no-LWT session, then creates one ordinary client whose CONNECT carries the shared
  installation LWT; the two MQTT/TLS sessions never coexist. Once activated, an X10A loss sustained
  for 15 seconds publishes one retained `offline` transition and pauses every other publish while
  inbound subscriptions stay live; a shorter whole-sweep dropout keeps availability online without
  retaining an empty X10A document. Recovery on the same broker session restores `online` plus a
  fresh X10A/heartbeat seed, while a broker reconnect follows the normal full announce path. HTTP
  diagnostics and the X10A retry loop remain independent of the gate.
- **Discovery is streamed.** A full Altherma value set can be 30–40+ entities; the bridge emits one
  entity's discovery config at a time (retained) on (re)connect, so it never needs one large
  contiguous heap block — the same memory discipline as the rest of the firmware. Layout-marker
  converters (docs/REGISTERS.md §3.6) get no sensor.
- **Independent source topics.** `<base>/x10a` is a retained grouped JSON document. The message topics sit directly
  under `<base>` — one board per base topic, so there is no `<node>` segment in the payload paths; the
  node id identifies the *device* only in each discovery config's `uniq_id`/`dev.ids`
  and its `<prefix>/<component>/<node>/<group>_<object_id>/…` discovery topic (the entity id carries
  the register group because `uniq_id` and the topic are flat namespaces while a label is unique only
  within its page — legacy-221). Each cycle the task
  builds a single JSON object of every value, grouped one level deep by X10A register page
  (`logic/mqtt_group.hpp`, host-tested): `{ "<group>": { "<object_id>": value, … }, … }` (max
  nesting depth 1, e.g. `hydronic`, `outdoor_state`, `inverter`). Every sensor's discovery config
  points at the X10A topic and subscripts its value out with a `value_template`
  (`value_json['<group>']['<object_id>']` — bracket notation, so a digit-leading slug like
  `2way_valve…` stays valid). `<base>/env3` is a separate flat retained numeric observation payload:
  `{"temperature_c":20.25,"humidity_pct":45.50,"pressure_hpa":1008.75}`. Every new fresh 10 s
  sample is published, including an unchanged reading; error or staleness changes the retained
  payload to `{}` — except the pair of I2C bus-health counters, `samples` and `errors`, which BOTH
  shapes keep: they describe the LINK rather than the air, and are most informative exactly when no
  reading came, so carried only on the healthy document they would go dark at the instant they
  became the answer (a consumer could not tell a failing SHT30 from a disabled accessory, a
  rebooted board or a lost broker). Two COUNTERS and never a pre-divided rate — a store holding
  numerator and denominator can compute any window's ratio, a firmware that divides has thrown the
  numerator away — and no HA entity, since link health is a metrics-stream question. The error
  shape stays `{"samples":N,"errors":M}` rather than `{}`, which changes nothing for HA: the
  availability template asks whether each READING key `is number`, so the three entities still go
  unavailable and no retained value survives. Three retained HA discovery configs expose ENV III temperature, humidity and air
  pressure as measurement sensors. Their availability is `all`: both the device LWT must be online
  and the corresponding JSON key must exist, so `{}` makes only the ENV III entities unavailable.
  Disabling the sensor retracts both the state topic and all three discovery configs. ENV III is
  never folded into X10A or HomeHub state. Its ONE consumer inside the firmware is the heating-curve
  diagnosis above, which records the temperature as optional context with each event — never as a
  condition for one. Note the firmware cannot know WHERE the sensor is mounted: beside the indoor
  unit this is room air, while over a long I²C run to a sheltered outdoor position it is genuine
  outdoor air, and only the latter makes the diagnosis axis meaningful. The device states the
  reading, not its meaning; anything downstream that depends on the placement has to record it. The ENV task independently folds valid samples into three
  static 5-minute/24-hour rings; `/history?...&source=env3` serves them to the Board Hardware infobox,
  so X10A loss cannot stop the outdoor-climate history. `<base>/modbus` is a separate flat retained JSON object, published only
  for an enabled HomeHub stack and intentionally not referenced by HA discovery. Int16 enum values
  retain the raw numeric Modbus constant; `/values` carries separate semantic metadata so the browser
  can name them without putting prose on MQTT. A disconnected HomeHub publishes `{}` rather than
  preserving a previous TCP session's values; clearing the HomeHub address queues one QoS-1 retained
  empty tombstone after the disabled config was persisted, retracting the Modbus data topic even if
  X10A is unavailable.
  The former retained `<base>/modbus/status` duplicate is retired because link state, receive count
  and failures already live in `<base>/heartbeat`. The
  27 discovery configs emitted by builds through `v1.0.0-dev.257` are permanent cleanup targets:
  connect-time and five-minute retirement passes tombstone them and no replacement config exists. On
  upgrade, bounded exact-topic subscriptions probe for obsolete retained `<base>/state` and
  `<base>/modbus/status` values; only a non-empty retained response triggers each tombstone, so later
  reconnects do not publish either empty retired topic.
- **Forecast evidence topic.** `<base>/weather/openmeteo/forecast` is an independent retained JSON snapshot,
  published on change only while Open-Meteo is configured. A disabled source publishes no synthetic
  state document; clearing both location fields directly sends one QoS-1 retained empty tombstone,
  so the broker definitively removes an older payload even if X10A is unavailable.
  Values and their Open-Meteo/ICON provenance,
  fetch time, forecast horizon start, validity limit, runtime error and numeric `available`/`fresh`
  flags travel atomically. A failed refresh may retain the last figures for forensic comparison, but
  `available: 0` prevents them from looking decision-ready; `fetched_unix_s` and
  `valid_until_unix_s` let a historian independently verify age even after the board is offline.
  Exact latitude/longitude is intentionally omitted. Weather intentionally has no HA Discovery:
  MQTT archives firmware evidence but is not a dependency of forecast acquisition or future
  on-device decisions. Builds through `v1.0.0-dev.295` briefly published four weather discovery
  configs; they are permanent cleanup targets. Upgrade retirement passes delete those configs, and
  an exact-topic probe removes the former retained `<base>/weather_forecast` document only when it
  still exists.
- **A field's JSON type comes from its DEFINITION, never from its current value.** `GroupedValue`
  carries a `PublishedKind` (`logic/convert.hpp` `published_kind`, keyed on the converter id):
  `Number` is emitted unquoted, `Text` quoted — in **every** state of that field. The publisher used
  to sniff the formatted string instead, and
  legacy-209 measured the cost: fan step
  published the number `30` while the fan ran and the string `"OFF"` when it stopped, so one MQTT key
  changed JSON type during normal operation, Telegraf's numeric parser dropped the string, no zero
  ever reached VictoriaMetrics, and the last running step stayed on the chart as if the fan were
  still turning. The converter itself is numeric since legacy-210; the *kind* is what makes the guarantee
  structural — a catalog-wide test walks every implemented converter over every input byte and fails
  if any one of them produces text in one state and a number in another. A `Number` handed a
  non-numeric string publishes `null`, never a quoted string: fail closed rather than flip the type.
- **A textual fault code also publishes permanently-numeric flags.** Converters 203/204 stay text
  (`"Normal"`, `"U4"`, `"7H"`) — that is what a human and HA want, and inventing a numeric enum for
  Daikin's alphanumeric code space would be a guess with no authority. But a metrics consumer cannot
  store `"U4"` at all, so an alert on `error_code != 0` never fires for exactly the faults it exists
  to catch. Every conv-203 error-class row therefore publishes two **derived companions** in its own
  group: `error_active` and `warning_active`, always `1`/`0` (`logic/fault_state.hpp`), each with its
  own `binary_sensor` discovery config (`<group>_<key>`, since HA entity ids share one flat namespace
  while the JSON keys are already group-scoped). An unreadable class publishes *neither* — reporting
  `0/0` would assert "no fault" on a byte nobody could decode.
- **Availability is separate from value.** A row the availability ledger (`logic/availability.hpp`)
  quarantines is not announced at all and its retained config is retracted (no row is quarantined
  today); a value it adjudicates
  absent (`Target Cond. Temp.`'s raw `0x0000`) is simply missing from the payload; and a **held-over**
  reading — the outdoor unit resting and answering with its last run's numbers — is withheld with the
  heartbeat's `bus_ou_held_over` explaining why. In all three cases absence is stated by absence,
  which is what `/values` and the plausibility envelope already did for a value that failed to read.
- **Units + device_class** are derived from each value's `dataType` field (the def's HA unit hint —
  1 = °C/temperature, 2 = bar/pressure, 3 = A/current; `unit_for_datatype`/`device_class_for_datatype`
  in `logic/convert.hpp`), so temperatures get `°C` + `temperature`, currents `A` + `current`, etc.,
  and HA renders them correctly with history.
- **Binary values are `binary_sensor`s carrying 1/0.** A bit-flag row (converter family 300-307 —
  `conv_is_binary` in `logic/convert.hpp`) decodes directly to numeric `1`/`0`. The poll cache,
  `/values`, web UI, history and MQTT therefore all share that representation; no value
  surface emits the text `"ON"`/`"OFF"`. MQTT serializes it as a JSON **number** and discovery types
  the row as an HA `binary_sensor`
  (`ha_component`, `logic/discovery.hpp`) whose config spells out `"pl_on":"1"` / `"pl_off":"0"` —
  HA's defaults are `"ON"`/`"OFF"`, and a mismatch leaves the entity silently at `unknown`.
  Discovery keys on `conv_is_binary`, not the numeric value (many ordinary sensors can also read
  zero). Every such row is `size 1`/`dataType -1`, so
  there is no unit or `device_class` to reconcile; a *meaningful* device class (`running`, `problem`,
  `heat`) is a per-label domain judgement and is deliberately **not** inferred.

  The number — not the text, and not a JSON bool — is the point: a metrics consumer stores numbers
  and drops both strings and bools, so all ~30 binary rows of a profile reached HA but never a graph.
  Measured on a live install before the change: of ~99 published values only the 58 numeric ones
  became VictoriaMetrics series. Builds before this published every row as a `sensor`; that stale
  retained discovery config is actively deleted for binary rows on the first announce per profile
  (`ungrouped_discovery_topic`), so an upgraded install doesn't keep a duplicate,
  permanently-unavailable text entity. The entity domain changes, so HA history for these does not
  carry over.
- **Publish-on-change.** The heat pump is polled at a fixed 1 s interval for near-real-time readings,
  but the task republishes the state JSON **only when its 64-bit FNV-1a payload digest changed**
  since the last write accepted by `esp_mqtt_client_publish()` (a single JSON topic can't be updated per-value, so it is
  all-or-nothing). This removes the second retained payload copy. The tradeoff is explicit: the
  theoretical 2^-64 collision suppresses a changed retained document until the next forced reseed;
  it does not cause a harmless duplicate. A full retained (re)seed goes out on (re)connect and when auto-detection resolves
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
  `bus_connected`) are the numbers `1`/`0`, not JSON bools, for the same reason the X10A topic's
  bit-flag rows are — a metrics consumer drops a bool exactly as it drops a string, and these three
  were the only heartbeat fields that never became series. The `bus_status` `binary_sensor` declares
  the matching `"pl_on":"1"`/`"pl_off":"0"`; without it the entity inherits HA's `"ON"`/`"OFF"`
  defaults and sits at `unknown`. (The crash topic keeps `true`/`false` + a `| lower` template: it is
  an event payload, not a metrics stream, and its `binary_sensor` already reads correctly.)
  Room-source and heating-curve fields are deliberately absent; those belong to the domain topic
  below.
  - **Board**: `version`, `platform`, `uptime_s` + a `"Ddd+HH:MM:SS.mmm"` `uptime` display string
    (`format_uptime`), `free_heap` / `min_free_heap` / `max_alloc` (largest free block — the
    binding OOM limit on this firmware), and `reset_reason`.
    `reset_reason` is joined by **`reset_reason_code`** (the raw `CrashReason` value — the same number
    `/status.last_crash` publishes as `reason_code`, so there is one vocabulary) and **`reset_fault`**
    (`crash_reason_is_fault` as `1`/`0`). Both exist because a metrics pipeline keeps numeric fields
    and drops strings: the slug alone never became a series, which left a board restarting 55 times in
    7 days — 5 of them panics — unattributable in the store, reconstructible only from syslog (legacy-215).
    Neither is a new HA entity; the existing "Reset Reason" text sensor already answers a human, and a
    numeric twin beside it is the duplicate that got the crash topic's "Last Reset Reason" retired.
    Beside them **`heap_restarts`** — how many consecutive heap-watchdog restarts preceded this boot
    (`heap_guard_restarts()`, also on `/status.sys`). It is here because nothing else in the payload
    can attribute that reboot: `heap_guard.cpp` restarts with `esp_restart()`, so `reset_reason`
    reads the same `sw` a `/set_*` save produces and `reset_fault` stays `0`, and a board cycling
    its restart ladder every few minutes shows up as a sawtooth in `uptime_s` and nothing else.
    Unlike the two fields above it **is** an HA entity ("Heap Watchdog Restarts"): the owner of the
    board acts on it, and it duplicates nothing — "Reset Reason" says `sw` for both cases, which is
    exactly the ambiguity this resolves. `measurement`, not `total_increasing`: the value is the
    count this *boot* inherited and returns to `0` on the next healthy boot, so a monotonic state
    class would make HA read every recovery as a counter reset.
  - **`*_stack_min_free_bytes`**: the **second memory budget** — `httpd_`, `poll_`, `mqtt_` and
    `modbus_`, in **bytes** — the unit ESP-IDF's `uxTaskGetStackHighWaterMark` answers in, so the
    number compares directly against a core dump's task table and against the size passed to
    `xTaskCreate`. Vanilla FreeRTOS returns *words* here and ESP-IDF deliberately does not, which is
    why the unit is spelled out in the field name: it becomes a VictoriaMetrics series suffix, where
    a wrong unit word publishes a quantity four times too large in the one metric whose whole
    purpose is warning about running out. Everything
    above reports the heap; the stack had a core dump's task table and nothing else, i.e. evidence
    that exists only once the board has already died. Three overflows shipped that way (v1.0.12 on
    httpd, legacy-241 on `hp_poll`, legacy-318 on httpd through OTA) and legacy-318's 1200 bytes of frame growth
    accumulated across releases with no single change announcing it — an idle board looks identical
    at every stack size. Each task records its own mark from its own loop (`main/stack_watch.hpp`);
    the mark is retrospective, so the top of a loop is enough and no branch can skip it.
    **`0` means never sampled and is published as `null`** — a task that has not run is not a task
    with no stack left, and the Modbus slot stays unsampled forever on a board with no HomeHub,
    where `0` would read as one word from death (a metrics consumer drops a null field and records
    no sample, which is the honest outcome). **Payload-only — deliberately no HA entity:** the value
    is a trend a maintainer reads across firmware versions, and four permanently-flat diagnostic
    entities are four more things a device owner has to rule out. The minimum is tracked inside
    `stack_watch` rather than left to FreeRTOS for exactly one task's sake: the HomeHub task
    retires and is recreated when the address is cleared and re-saved, and a fresh task starts
    with a fresh mark — without it one slot would mean "since the last reconfigure" while three
    meant "since boot". The httpd slot samples per REQUEST and stays null on a board nobody has
    browsed this boot — the right answer, not a gap: the deep frame exists only while a request is
    served, so an idle httpd task would report its select loop's headroom, a large uninteresting
    number reading as enormous margin on the one path that has never been exercised.
  - **`wifi_*`**: `wifi_connected`, `wifi_rssi`, `wifi_reconnects` (cumulative RE-connects
    since boot, `wifi_reconnect_count()` in `wifi.cpp`, excludes the first-ever connect), `wifi_mac`
    (this STA's own MAC, always present) and `wifi_bssid` (the associated AP's MAC, null while offline)
    — the `/status.wifi.mac`/`.bssid` pair, now on the diagnostics stream too.
  - **`mqtt_*`**: `mqtt_connected`, `mqtt_count`/`mqtt_fails` (every `esp_mqtt_client_publish()` call
    funnels through one `mqtt_publish()` wrapper in `mqtt_ha.cpp` so these cover
    discovery+state+heartbeat+heating-curve evidence+LWT, not just one topic), `mqtt_reconnects` (cumulative, excludes the
    first-ever connect).
    Beside them, the two counters for cycles that produced **nothing** (legacy-380). `mqtt_fails` counts a
    failed publish *call*; neither of these ever reached one, so before they existed the loss was
    invisible outside a `/diag` ring the next chatty boot overwrites — 337 dropped publishes in 30
    days on the wired board, 125 of them in the last 24 hours, every one immediately before an OTA
    reboot. **`mqtt_skipped`** is a cycle that threw (`std::bad_alloc`, caught by the task guard) and
    lost the reading; **`mqtt_quiesced`** is a cycle the publisher stood aside for **on purpose**
    because an OTA or weather TLS operation owned the heap (`logic/ota_quiesce.hpp`, see OTA below). Two counters
    rather than one "cycles lost", so the fix is legible in the store: the intended shape is
    `quiesced` stepping once per install while `skipped` stops rising at all, which a combined
    counter could not tell apart from no change whatsoever.
  - **`poll_skipped`**: the same question asked of the X10A poll task, and the worse half of it — a
    skipped publish drops a value that was read, a skipped sweep means the read never happened, so
    `history.cpp` records a `NO_READING` indistinguishable from a bus fault and every `bus_*` counter
    below stays silent because nothing was attempted. 32 in the same 30 days. Sourced from
    `hp_skipped_cycles()` and deliberately **not** from `HpStats`: every counter in there is
    committed by `poll_once()` for a cycle that *ran*.
  - **`bus_*`**: the X10A stats already tracked in `HpStats` — `bus_connected`, `bus_proto`,
    `bus_registers`, `bus_values`, `bus_last_ok_s`, `bus_rx_received` / `bus_rx_fails` (cumulative
    successful/failed register reads, `HpStats.rx_ok`/`rx_fail_total`), `bus_crc_err` /
    `bus_timeout_err` (breakdown), and `bus_tx_reads` (= `rx_received + rx_fails`, every register-read
    request sent). There is no `bus_tx_writes`/`bus_tx_fails` companion: the X10A bridge is read-only,
    so both were hardcoded `0` and could never vary. They were dropped in legacy-215 — a metric that cannot
    change is a dashboard line that always reads zero. Neither was ever an HA entity.
  - **`modbus_*`**: link state and read counters. There are
    no write counters — the link issues no Modbus write at all. (The HomeHub task's stack high-water
    evidence moved to the shared `modbus_stack_min_free_bytes` above when all four watched stacks
    were given one sampler; `/status.modbus.task_stack_min_free_bytes` reads from the same place, so
    the two surfaces cannot answer one question with two numbers.)
    **Payload-only — deliberately no HA entity.**

  Published on a fixed `HEARTBEAT_INTERVAL_S` (10 s) cadence — unlike the source value topics, this is
  diagnostics rather than real-time telemetry, so it always sends the latest snapshot rather than
  only on change. 22 diagnostic HA entities (WiFi signal/reconnects/MAC/BSSID, heap
  free/min-free/largest-block, heap-watchdog restarts, uptime, last reset reason, X10A bus
  status/held-over/CRC/timeout/rx
  errors/rx received, MQTT
  publish count/fails/reconnects, and the three legacy-380 loss counters —
  `mqtt_skipped`/`mqtt_quiesced`/`poll_skipped`, `total_increasing` so HA's long-term statistics read
  the reboot that ends every such episode as a counter reset rather than a cliff; entities and not
  payload-only like `modbus_*`, because a loss nobody can put on a dashboard is exactly how this
  stayed invisible for 337 dropped publishes — tagged `"ent_cat":"diagnostic"`) point at this topic via their own
  discovery configs, streamed once per
  connection independently of heat-pump profile detection — so they show up even while the model is
  still "auto". Cumulative since-boot counters get `"stat_cla":"total_increasing"` (not
  `"measurement"`) so HA's long-term statistics handle a reboot's reset to 0 correctly. Mirrors the
  "device diagnostics" pattern of other ESP32 HA bridges and their own `heartbeat` topic.

  **Two are retired** (`RETIRED_HEARTBEAT_SENSORS`), under the rule that already retired the crash
  topic's "Last Reset Reason": an entity repeating what another entity on the same device says is
  not a second reading, it is a second thing to rule out. **"Device Time"** published the SNTP wall
  clock as a `device_class:"timestamp"` sensor — re-sent every 10 s, so HA rendered it as "N seconds
  ago", which is what HA's own `last_updated` on any other entity here already says without a clock,
  at the cost of one recorder row every 10 s forever. The failure it was meant to catch (a drifted or
  never-synced clock) is reported by `/status.ntp` `{server,synced,time}` and by every syslog RFC 5424
  TIMESTAMP. **"WiFi Quality"** published `2*(rssi+100)` beside the "WiFi Signal" sensor carrying that
  rssi: a deterministic function of another entity cannot disagree with it, fail independently of it,
  or show anything it doesn't — a reader who wants percent templates it in HA. The `time` and
  `wifi_quality_pct` **payload fields went with them**; each existed only to feed its entity, and
  keeping a field whose only consumer is gone leaves the duplicate in every heartbeat while hiding it
  from the one place it was visible. Both retained discovery configs are **actively deleted** on
  every (re)connect (a zero-length retained publish), under the current node id *and* the legacy
  MAC-derived one — otherwise the broker replays them to HA forever and the entities linger as
  permanently-`unavailable` duplicates. Their uniq_ids are **burned**: `test_entity_identity()`
  refuses to let a live entity claim one back, since it would inherit the corpse rather than get a
  fresh registry entry.
- **Heating-curve topic** `<base>/heating_curve` (not retained) carries domain evidence separately
  from board/link health, built by `logic/heating_curve_mqtt.hpp` (host-tested). Top-level
  `schema_version` is `3` (v2 added the ENV III outdoor value; v3 adds the distinct plant outdoor
  value and string+numeric provenance for both current/event axes, purely additively; `method_version` stayed `2`,
  since the sampling method is unchanged and payload SHAPE is what the schema version describes);
  `room` contains the accepted live room mapping, while `diagnosis` contains
  method/state/reason plus nested `gates`, `room_evidence`, `last_sample` and `counters`. Nullable
  values state absence explicitly, and boolean facts use numeric `1`/`0` so Telegraf/VictoriaMetrics
  retain them. It is published immediately after heartbeat on the same 10-second, X10A-gated
  cadence, but has no Home Assistant Discovery entities. The former flat heartbeat `room_*` and
  `heating_curve_*` keys are removed rather than duplicated; because heartbeat is not retained, no
  broker tombstone is needed. Direct consumers must move to the grouped paths.
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
  heartbeat + heating-curve evidence) and each `esp_mqtt_client_publish()` can block up to the client network timeout, so
  without a per-publish feed a slow-but-alive link could push one burst past the 20 s budget. So only
  a publish that genuinely wedges reboots the device; see *The poll engine → Task Watchdog* for the
  shared mechanism.

## OTA, signing, partitions

Structure:

- **Target:** esp32s3 only (`scripts/ci-build-all.sh`). No BLE is used; the official baseline is a WiFi ESP32-S3 with ≥8 MB flash. Uses native USB-Serial/JTAG console.
- **8 MB dual-OTA `partitions.csv`:** app at `0x20000`; `nvs` at `0x9000` untouched
  by OTA so WiFi/service settings and the X10A link cache survive upgrades. Detected model identity
  remains RAM-only and is re-established after boot. The Web Serial manifest likewise publishes
  sparse `flash_args` parts around NVS; its build-time sector-overlap check makes the no-Erase path
  preserve the same configuration. Existing addresses through `ota_1` still end at `0x400000`;
  `history` uses the remaining 4 MiB through `0x7fffff`. Its append journal rotates 256-byte records
  through every 4 KiB sector; three five-minute trend sources and the hourly plant-diagnosis source
  share it, and checked slot growth preserves at least 72 hours with all sources active.
- **Browser serial-permission release:** the installer uses `Serial.getPorts()` to show its
  **Release serial port** action only while this Pages origin already has a granted port. A single
  closed port is forgotten directly; multiple grants use the native chooser to disambiguate. An
  open installer port is never interrupted, and connect/disconnect plus page focus refresh the
  control instead of preserving stale permission state.
- **Core Dump to Flash (Crash Archiving)**:
  - Enabled via `CONFIG_ESP_COREDUMP_ENABLE` and `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH` in `sdkconfig.defaults`. The format is ELF — the only one IDF v6 emits, so no `CONFIG_*` selects it.
  - A dedicated `coredump` partition of size `0xc000` (48 KB) is placed at offset `0x12000` (in the unused gap between `phy_init` and `ota_0`), leaving the start offsets of `nvs`, `otadata`, `phy_init`, `ota_0`, and `ota_1` completely untouched for backward compatibility and OTA safety.
  - Exposed via a chunked HTTP GET endpoint `/coredump` (implemented in `http_status.cpp`) that streams the binary crash dump in 512-byte blocks to prevent OOM errors on the tight ESP32 heap.
  - Supports erasing the partition via `POST /coredump/clear` (invokes `esp_core_dump_image_erase()`).
  - `POST /crash/dismiss` is the other side of that: it erases the image **and** marks the cached
    `CrashInfo` dismissed (`diag_crash_dismiss()`), i.e. the user *deleting the crash report* rather
    than freeing the flash slot. See "How a user hands a crash over" below.
  - **Boot-time capture + surfacing (so a crash isn't a silent blob in flash).** `diag_crash.cpp`
    runs once early in `app_main`: it reads `esp_reset_reason()` and, if a valid dump exists, parses
    its **summary** (`esp_core_dump_get_summary()` — crashed task, exception PC, backtrace PCs, and
    the crashed build's `app_elf_sha256`) into a cached `CrashInfo`. The pure formatting is
    `logic/crashinfo.hpp` (host-tested); the summary is parsed **once** and cached — never re-read
    from flash on a request path, which is where `http_append_status_json()` runs (and, until the
    WebSocket push was removed, also on the poll task — see "Push vs. poll"). A dump whose parsed
    `app_elf_sha256` does **not** match the running build (`coredump_is_foreign()`, host-tested) is an
    **orphan** — it survived an OTA, or a panic that could not write its own dump left the previous
    build's dump in place — and is erased at capture, with the reason logged to `/diag`. If that
    best-effort erase fails, its proven foreign identity remains latched for this boot: both
    `diag_crash_info_live()` and `GET /coredump` suppress the residue, so it cannot reappear as a
    download `espcoredump` rejects. Without
    this an orphan passes `esp_core_dump_image_check()` (it is a valid image, just of another binary),
    so `coredump` reads true and `/status` offers a download that `espcoredump` then rejects on a
    SHA-256 mismatch (legacy-215). Successful erasure also clears the partition for the next real panic. The
    `coredump` **presence flag** is the one exception: it IS re-checked from flash per request
    (`diag_crash_info_live()` — a 4-byte size-word read, not the summary reparse), because the image
    can be erased mid-session via `POST /coredump/clear` and a cached flag would then advertise a dump
    that flash no longer holds. A *fault* reset (panic / watchdog / brown-out / CPU lockup) or an
    orphan dump is "notable"; a clean power-on / software reboot is not — and neither is a report the
    user has **deleted** (`CrashInfo::dismissed`, below), which is the one other field written after
    boot: a single monotonic `false → true` store, so the readers that copy the struct concurrently
    (HTTP, MQTT) need no lock for it.
  - **Always-on system health (no fault required).** `http_append_status_json()` also carries a
    compact `sys` block — `free_heap` / `min_free_heap` (since-boot low-water, the leak indicator) /
    `max_alloc` (largest contiguous block, the true OOM ceiling), what that headroom already **cost**
    (`mqtt_skipped` / `mqtt_quiesced` / `poll_skipped` — the legacy-380 counters described under the
    heartbeat above; reported here as well as on the heartbeat because the heartbeat needs a broker,
    and an installation whose MQTT is misconfigured is exactly where someone is asking why values
    keep disappearing), the `reset_reason` slug (via
    `logic/reset_reason.hpp`, reusing the same vocabulary as `last_crash`) and a `safe_mode` flag
    (always `false` until the boot-loop safe-mode feature lands). These answer "why did it reboot?"
    and "is the heap leaking?" from the LAN **on every boot** and **without a
    broker** — the MQTT heartbeat carries the same heap figures, but only when MQTT is configured. The
    web UI reads `safe_mode` (the recovery banner) plus `free_heap` and `max_alloc`, the two trended
    rows at the foot of the Settings ESP32 card — removed as spot figures in v1.0.14 and back only
    once each carried a 24-hour curve, the form in which they answer whether the heap is *drifting*.
    `min_free_heap` and `reset_reason` stayed out: the day's minimum is already on the chart, and a
    reboot's cause is diagnosed from `/status`, `/diag` and the heartbeat rather than read at a
    glance. Above them the card states the top-level `uptime_s` — not a `sys` field, and the only
    thing on that screen that says the board restarted at all, since the crash banner renders solely
    on a `fault` (DESIGN.md §5.6).
  - **How a user hands a crash over.** `GET /status.last_crash` is `null` on a clean boot, else the
    boot-time cached reason/summary — with `coredump` re-read live from flash on every request
    (`diag_crash_info_live()`), so a dump cleared via `POST /coredump/clear` can't leave a stale banner or
    a dead download link. The running app's `app_elf_sha256` is also on `/status`. The web UI shows a
    crash **banner** (`renderCrashBanner()`) — titled on `fault`, so an orphan dump doesn't claim this
    boot crashed — with the reset reason + hex backtrace, a one-click `coredump.bin` download, and a
    "copy diagnostics" bundle (`/status` + `/diag` + summary) for a bug report.
  - **Deleting the report (`POST /crash/dismiss`).** The banner's third action. It is a *device*
    action, not a per-page hide: `diag_crash_dismiss()` erases the dump image and then sets
    `CrashInfo::dismissed`, so `crash_is_notable()` is false everywhere at once — `/status.last_crash`
    goes `null`, the retained MQTT crash topic is cleared on the next heartbeat tick, and the banner
    is gone across reloads, browsers and Home Assistant. Hiding it in page state alone (what this
    replaced) survived exactly until the next reload. **Erase first, mark second** for a dump from the
    running firmware: a failed erase answers `500 {"ok":false,…}` and marks nothing, because a
    dismissal that outlived it would report "no crash" with evidence still downloadable. A proven
    foreign residue is the sole exception — it is already suppressed from `/status` and
    `GET /coredump`, so its failed erase cannot pin a separate current-fault banner. The flag is
    **RAM-only on purpose** and needs no NVS: after any reboot the reset reason is no
    longer a fault and the dump is gone, while a *new* crash captures a fresh `CrashInfo` and must
    show — which persisting a dismissal could suppress. The reset **reason** survives untouched
    (`/status.sys.reset_reason` and the heartbeat's own "Reset Reason" sensor): what was deleted is
    the crash report, not the fact that the board rebooted the way it did. `POST`, unlike the `GET`
    it sits beside, because it destroys the one artifact a bug report needs
    ([REPORTING.md](REPORTING.md)) and must not be reachable by a link or a prefetch; trusted-LAN
    only like every other write (`logic/http_surface.hpp`). The MQTT bridge
    additionally **retains** the summary on `<base>/crash` as **one** diagnostic HA entity — a "dump
    waiting" flag (reason/backtrace only, never secrets or the raw dump), so Home Assistant (or
    Telegraf → VictoriaLogs) sees crashes over time. The reset reason is *not* a crash entity: it is
    the heartbeat's own "Reset Reason" sensor, so a crash entity for it would be a duplicate — the old
    "Last Reset Reason" crash entity was dropped and is now actively retired (its stale retained
    discovery config is deleted on upgrade via a zero-length retained publish). The topic is
    **crash-only**
    (`build_crash_mqtt_payload`): the summary is retained only when the boot is *notable* (a real fault
    or a dump still in flash); a normal boot is silent on a clean broker. The bridge briefly probes
    the exact retained topic and publishes a deletion only when an older crash is actually present,
    so live clients do not recreate a payload-less `/crash` node on every connection while stale
    reports still disappear once resolved — the reset reason stays visible on the heartbeat's
    own "Reset Reason" sensor regardless. Published once per (re)connect **and** republished on the
    heartbeat cadence whenever the `coredump` flag **or the notability** changes, so a retained "Crash
    Dump Waiting" can't stay latched ON after the dump is pulled and cleared (and an orphan-dump-only
    boot is then re-decided not-notable and the topic cleared). Notability is checked beside the dump
    flag rather than derived from it: dismissing a crash on a fault boot that left **no** dump — a
    stack overflow overruns its own dump, which is what the crashes here look like — changes no flash
    byte, so a dump-only test would leave the retained crash record standing in Home Assistant after
    the user deleted it on the device.
  - **Decoding (maintainer side).** A raw dump is useless without the *matching-version* unstripped
    `.elf` (the shipped `.bin` has no symbols), so CI archives `daikin-altherma-esp32.elf.xz` + the
    sha256 of the ELF *inside* it per build (artifact + Release asset, `scripts/ci-build-all.sh`).
    `scripts/decode-coredump.sh coredump.bin [app.elf[.xz]]` unwraps the container, then runs
    `esp-coredump info_corefile` inside the CI-pinned ESP-IDF Docker image and matches the dump to
    the ELF by `app_elf_sha256` (warns on mismatch). The xz wrapper is deliberately OUTER — the ELF
    bytes inside are the linker's own, which is what keeps that match meaningful, and is why
    `objcopy --compress-debug-sections` is not used despite being the simpler-looking option.
    **How long an archived ELF lives depends on the build.** A release keeps its copy indefinitely
    as a Release asset; a dev build's lives 3 days and an open PR build's at most 7. The PR copies
    are deleted immediately on merge, when the successor is built from `main`, because artifact
    storage is metered and the previous 90/7-day pair overran the allowance (the arithmetic is in
    `build.yml` at the upload step). So a dev-channel dump older than three days may no longer be
    decodable —
    the device reports `app_elf_sha256`, so you can at least tell *which* build you can no longer
    symbolize. VictoriaTraces is
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
- **Heap-bounded TLS and validation.** Lock-free flags cover the complete OTA and Open-Meteo
  network operations, beginning before either handshake. Each producer holds its flag for 1.1
  seconds before opening TLS so the once-per-second MQTT publisher can finish its current cycle and
  stand aside; OTA also waits for an in-flight X10A sweep to acknowledge the same request and for an
  already-open weather client to unwind. New X10A snapshot work and new weather requests then stay
  out until OTA ends. The shared `logic/ota_quiesce.hpp` budget prevents a stalled flag from
  silencing MQTT or X10A indefinitely. The poll cache compounds this by owning only its formatted value:
  immutable labels and units are borrowed from firmware-lifetime catalog tables, shrinking the one
  contiguous allocation every sweep requires and eliminating two per-row string allocations.
  `http_client_diag.cpp` returns the TLS evidence it logs, so an init OOM or
  `ESP_ERR_MBEDTLS_SSL_SETUP_FAILED` is cleaned up and retried exactly once. DNS, TCP, certificate,
  HTTP and payload failures remain single-attempt failures with their original diagnostic class.
- **Signed OTA** (Secure Boot v2 RSA-3072 *without* hardware Secure Boot): fully implemented in
  `ota_update.cpp` — manifest check, an HTTPS-only `esp_http_client` → `esp_ota` stream into the
  inactive slot, the **two-point downgrade gate** (manifest
  version *and* the image's own embedded `esp_app_desc_t` version, with exact artifact-version
  equality required, so a lying or stale manifest is refused), signed-image validation and the
  **connectivity health gate**
  (commit only after a base window AND getting
  online, else stay `PENDING_VERIFY` → a reboot rolls back). Both default feeds are live, and
  publishing runs on a private repo too (the Pages site is public either way — see
  [`README.md`](README.md)); a self-hosted URL with nothing served honestly reports "up to date".
  The web installer carves prepared sparse parts from the merged
  image so a no-Erase flash skips NVS; the single `manifest.json` lists those parts and also doubles
  as the OTA feed (the `esptool-js` installer and the device load the same file).
- **Validation gets the transport's heap back first.** The firmware downloads through a fixed
  2 KiB INTERNAL buffer and closes/frees both that buffer and the complete HTTP/TLS client before
  calling `esp_ota_end()`. That call remains IDF's mandatory RSA-3072/PSA verifier; only its success
  permits the separate `esp_ota_set_boot_partition()` call. Before opening the image stream and
  again immediately before validation, a bounded five-second gate requires both 24 KiB total free
  INTERNAL 8-bit heap and a 12 KiB largest contiguous INTERNAL block. Refusal is retryable and
  fail-closed. Because `ESP_ERR_OTA_VALIDATE_FAILED` intentionally combines image-structure,
  digest/signature and verifier-allocation failures, the user-facing error is the exact generic
  “Update rejected: image validation failed”; `/diag` records before/after heap evidence instead of
  claiming a signature-specific root cause it cannot prove.
- **Allocation-heavy peers stand aside during known TLS operations** (`logic/ota_quiesce.hpp`, legacy-380). An
  OTA install or weather fetch is a known, bounded, self-inflicted memory event: the TLS session plus
  the operation buffer claim the
  largest contiguous block on a heap whose binding limit *is* that block. The MQTT publish task used
  to meet it by throwing `std::bad_alloc` on its next cycle — guard catches it, cycle skipped, reading
  gone, once per second until the install finished (125 in one day, with `min_free_heap` bottoming out
  at **812 B**). It now checks `ota_download_active() || weather_fetch_active()` above the first
  allocation of the cycle and
  skips deliberately: the same missing second, spending none of the block the download needs, and
  counted as `mqtt_quiesced` instead of vanishing into a log ring. Lock-free
  `std::atomic<bool>` flags are armed by RAII guards across each network interval — **not**
  `ota_status().state`, which copies three `std::string`s out under the mutex the OTA task holds, so
  asking "is the heap under pressure?" would itself allocate, once a second, on the task the pressure
  is aimed at. The OTA window has seven exits, which is why its flag is cleared by a destructor
  rather than by hand at each. The hold-off is **bounded** (`OTA_QUIESCE_MAX_CYCLES`, 300 cycles ≈ 5
  min at the 1 s cadence): a TLS operation stalled behind a dead connection must not silence the bridge for
  the rest of the boot, so past the cap the publisher resumes and takes its chances with the OOM guard
  — the behaviour that shipped before, i.e. the worst case of this fix is the status quo. The
  watchdog is fed above the check, and esp-mqtt runs keepalive on its own task, so a quiesced minute
  is a gap in HA rather than an `offline`. X10A applies the same check before its first Config/cache
  allocation for **both OTA and weather** and exposes a lock-free acknowledgement after any in-flight
  sweep has finished. The MQTT task exposes the equivalent acknowledgement around its complete
  allocation-capable publish cycle. Its independent esp-mqtt task also claims the gate from the
  synchronous `MQTT_EVENT_BEFORE_CONNECT` callback through `CONNECTED`/`DISCONNECTED`; a two-phase
  active-flag recheck prevents a handshake or reconnect from starting behind an already-advertised
  Weather/OTA owner. If the firmware publish/startup claim won first, `BEFORE_CONNECT` never waits
  under esp-mqtt's API lock (the publisher may need that lock for `client_stop`); it claims transport
  immediately and the later network owner waits. Weather waits up to 15 seconds for both acknowledgements before its second OTA
  check; OTA waits for them before its own network operation. This closes the race in both directions:
  either the existing network request unwinds first or the new one reaches TLS only while X10A, the
  firmware MQTT publish cycle and an esp-mqtt handshake/reconnect are quiescent. Like the publisher
  hold, connect/startup deferral is capped at five minutes rather than trusting a stuck activity bit
  forever. MQTT startup claims the same acknowledgement before its first Config/topic/client
  allocation and waits if an OTA request won the interval after HTTP startup.
- **The weather fetch gates on headroom immediately before opening TLS** (`logic/weather_forecast.hpp` →
  `weather_fetch_headroom_ok`, live-10). An Open-Meteo fetch transiently claims ~16 KiB mbedTLS
  in-buffer + 4 KiB out-buffer, HTTP/TCP buffers, the response string and the cJSON tree, and it
  runs on a fixed 45-minute grid. Live evidence showed one fetch landing on a fragmentation trough push `min_free_heap` to
  **800 B**; it survived only because the claim is brief. The weather task now reads the
  allocation-free `HttpClientProbe` after the 1.1 s scheduling lead, both publisher
  acknowledgements, fixed 8 KiB response and 32-byte error reservation, and URL construction, at
  the last point before `esp_http_client`
  creates TLS state. HTTP and cJSON owners are unwind-safe, so a later parser allocation failure
  releases the C resources before retry. Below **56 KiB total free / 24 KiB largest
  contiguous internal block** it logs the sample, sets `state=waiting, reason=heap_headroom` and
  retries after five minutes — the previous valid forecast stays available. The 24 KiB contiguous
  floor rejects the measured 15.9 KiB trough while admitting the same board's healthy 31.7 KiB
  ceiling; a provisional 40 KiB largest-block floor would disable weather permanently there. The
  56 KiB aggregate floor leaves about 16 KiB outside the measured ~40 KiB transient claim.
- **The X10A publish cycle is allocation-bounded end to end** (live-10; the last unbounded
  full-string builder after the MCP streaming fix). The old per-second chain built a fresh ~6 KB
  cache, a fresh ~13 KB grouped snapshot, the JSON string with its doubling realloc ladder and a
  second retained copy of the payload — 25–30 KB in 4–5 separate contiguous allocations per cycle,
  of which one failed as soon as a status build or a TLS teardown tail split the largest block
  (`mqtt: publish skipped at x10a (std::bad_alloc)`, 1–3×/day on the live plant). Now the stable
  snapshot, stable grouped layout, **fixed 12 KiB payload buffer** and the 8-byte FNV-1a dedup digest
  are task-owned and reused. `prepare_x10a_buffers` resolves every publishable profile row and fault companion
  once per actual profile change; the cache commit carries its static profile id and X10A identity
  fingerprint, so a config-change window cannot publish an old subset under a new discovery layout.
  The host-tested aligned accessor validates that source identity transactionally, then copies into
  pre-reserved row slots without calling `config()`, resizing, or allocating under its mutex. Missing and held-over rows
  toggle a presence bit instead of compacting the vector and destroying tail strings. The grouped
  encoder skips those slots, counts the exact bytes through the same template that writes them, and
  refuses a document over 12 KiB instead of growing the block. Thus the firmware-owned steady-state
  X10A build has no heap growth and its MQTT bytes are unchanged (host-pinned). The digest is committed
  only after `esp_mqtt_client_publish()` accepted the retained write, so a transient `-1` is retried
  rather than deduplicated away. The publish-skip catch logs the throw second's
  allocation-free heap snapshot (`free=`/`largest=`) on the same line, narrowing the next collision
  to the allocations active at that second instead of relying only on 10-s samples.
- **Boot recovery / anti-brick** — an unsigned app aborts pre-`app_main`, so only the bootloader can
  recover, and only via a recorded previous OTA slot; a direct USB flash of an unsigned build both
  crash-loops and blanks the otadata rollback record. Contained by the pre-flash guard
  `scripts/require-signed.sh`. Full model,
  including the three failure modes and the health gate, in [SECURITY.md](SECURITY.md) → Boot recovery.
- **A PR publishes nothing** — untrusted PR source is compile- and size-checked without access to
  signing material. Its Actions artifact contains only non-flashable diagnostics: the compressed
  ELF, its checksum and the size reports. No app/merged/Web-Serial `.bin` or installer manifest is
  produced or uploaded. Every same-repo PR used to publish a signed preview installer at
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
- **Safe mode has a second entry route.** Besides the crash counter, `heap_guard.cpp` latches it when
  the heap watchdog's restart ladder is exhausted (legacy-407) — the boot inheriting the full count comes up
  minimal instead of staying up wedged, and `/status.sys.safe_mode_cause` reports `"heap"` rather than
  `"crash_loop"` so the recovery banner does not send that reader to check their RX/TX pins. It does
  not touch `boot_fails`: that boot is not a crash boot.
- **That timer is not armed while safe mode is latched** (`boot_healthy_timer_arms()`), and this one
  condition is the difference between a **latch** and a **cycle**. Safe mode comes up with the poll
  engine and the MQTT bridge down — precisely the subsystems a config crash-loop lives behind — so
  surviving 30 s in it is evidence about the *recovery surface*, not about the fault still sitting in
  the config. Armed there, it cleared the counter 30 s into every recovery boot, so the next crash
  reset started from zero and brought the full stack back up on the configuration already proven to
  crash four times: the device spent `BOOT_FAIL_THRESHOLD` boots crash-looping for every one boot it
  was fixable in, and the owner's browser window into it was one boot in five. Refusing to arm
  strands nothing, because *any* non-crash reset already zeroes the counter and every intentional way
  out of safe mode is one — a `/set_*` save, an OTA install, a power cycle, the recovery button — so
  safe mode ends the moment somebody acts on it, and only then. The refusal is said out loud on
  `/diag` rather than skipped silently: a counter that deliberately does not age out looks like a bug
  to the next person reading the log, and the line names the way out.
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
  on). The full recovery surface (`/set_wifi`, `/set_mqtt`, `/set_hp`, and — once legacy-9 lands — factory
  reset / import) stays available. `/status.sys.safe_mode` is `true` and the UI shows a warn-accented
  **Recovery mode** banner. The counter lives in `daik_cfg`, so a factory reset wipes it too.

- **An exception escaping the boot sequence is routed into this same machinery.** `app_main` wraps
  `boot_sequence()` in a `try/catch` (`main.cpp`) because it is a C frame boundary like every handler
  and task loop this firmware already guards, and boot allocates — `config_load()`, `http_start()`
  and the service starts below them all can throw `std::bad_alloc`. It `abort()`s with the phase
  named. `abort()` rather than `esp_restart()` is the load-bearing choice: a "sw" reset is exactly
  what `boot_reset_was_crash()` classifies as *intentional* and uses to **clear** the counter, so a
  boot sequence that threw every time would restart forever without ever accumulating a single crash
  boot — the failure mode safe mode exists to end, made permanent by the mechanism meant to end it. A
  panic counts, writes a core dump, and reaches safe mode after four.

This is distinct from the image anti-brick recovery above; both are covered in
[SECURITY.md](SECURITY.md) → Boot recovery.

## The heap watchdog (`heap_guard.cpp`)

The escalation every other OOM guard here deliberately lacks. `handle_all` answers 503, each
allocating task loop catches `std::bad_alloc` and skips the cycle keeping its last good state, a
publish is dropped: all correct for a TRANSIENT shortage, and none of them asks what happens when
it never recovers. Composed, they describe a device that is powered, associated, answering 503 to
everything and republishing nothing, indefinitely, reporting no fault — a HANG, which is worse than
a crash (a crash reboots in seconds and leaves a reset reason, a core dump and a syslog record; a
wedge looks like a powered-off device and heals never). So a largest CONTIGUOUS INTERNAL block
under `HEAP_CRITICAL_BYTES` for `HEAP_CRITICAL_HOLD_MS` unbroken becomes a deliberate
`esp_restart`, capped at `HEAP_MAX_CONSECUTIVE_RESTARTS` by the NVS `heap_rst` breadcrumb (an i32,
not a formatted string: the whole restart path stays allocation-free on a heap that is by
definition failing).

**Arming and recovering ask DIFFERENT thresholds**, and the asymmetry is load-bearing rather than
tidy: a run opens below `HEAP_CRITICAL_BYTES` but closes only above `HEAP_RECOVERY_BYTES` (2× it).
Answering both with one number is legacy-399 — measured on the bench board, a heap hovering AT the
threshold ended its run every second or two on ordinary ~512 B allocator churn, reset the 300 s
clock and NEVER restarted, while `/status` and `/values` were already answering 503, i.e. while the
device sat in the exact wedge this exists to escape. The band is deliberately modest rather than
the 12 KB `/set_mqtt`'s pre-flight wants: it only has to reject flicker, and demanding more would
restart a board whose recovery was real.

**The ladder ends in safe mode, not in "stay up degraded"** (legacy-407): the boot that inherits the full
count latches safe mode in `heap_guard_begin` — BEFORE `main.cpp`'s gate, so the poll engine and
the MQTT bridge are never started rather than started and then found to be eating the heap. That
also BOUNDS the ladder by construction: safe mode creates no poll task, and `heap_guard_sample` is
only called from it. The old answer — stay up degraded past the cap — was measured and did not do
what it claimed: at the heap level that produces the cap, HTTP decayed within ~7 minutes past even
the 503 the `handle_all` trampoline returns, so the device sat permanently in the wedge with the
escape hatch the cap existed to keep open shut. It is BEST EFFORT and says so: safe mode frees what
those two subsystems held, so it rescues a shortage they caused and does nothing for a leak
elsewhere. `/status.sys.safe_mode_cause` distinguishes `"heap"` from `"crash_loop"` because the two
need OPPOSITE advice — the crash-loop banner sends the reader to the RX/TX pins, which after a heap
give-up is sending them to fix something already correct.

The Armed/Recovered NARRATION is throttled like the Watching line for the same 6 KB-diag-ring
reason (one measured run put 78 Armed lines against 4 Watching, leaving `/diag` 89% heap: text with
the boot line already evicted); suppressed transitions are counted and reported, so a throttled log
still says the heap was flapping. An in-flight OTA CLEARS the run rather than pausing it — a paused
run could resume its clock and fire mid-install.

Also the home of `heap_largest_internal_block()`, THE ONE largest-block sampler: every reporting
site (history's `max_alloc` trend, the MQTT heartbeat, `/status.sys.max_alloc`, `/set_mqtt`'s
pre-flight) used `MALLOC_CAP_DEFAULT`, which answers from PSRAM on a board that has it
(`sdkconfig.defaults` offers `CONFIG_SPIRAM`), so all four would have reported megabytes of
headroom while internal DRAM sat at a few hundred bytes. Sampled by `hp_poll` at the top of every
cycle beside `history_record_board()`, the one path in that task no branch can skip — so NOT in
safe mode, which does not start the poll task; that is stated rather than hidden, and is defensible
because safe mode has already shut down the five largest allocators and is itself the reachable
minimal state a restart would be trying to reach.

## Web UI config flow

`www/` is split for edit locality: `index.html`, `style.css` and the JavaScript fragments listed in
`app.sources`. Firmware, tests and audits all consume that one ordered manifest; the fragments share
one classic-script scope and are spliced into ONE self-contained, pre-gzipped page at build time
(`inline_assets.cmake`). **Write the comments — and know they ship nowhere:**
`tools/web_asset/minify_and_gzip.py` strips HTML, CSS and JS comments alike under the 153600-byte
delivery budget (`UI_GZIP_MAX_BYTES` in `main/CMakeLists.txt`, pinned by
`test/test_ui_delivery_contract.mjs`). Markup was the one language it did NOT cover until the
budget was measured per fragment: `index.html` is spliced in raw, so 39 KB of drawing/layout
commentary shipped in the image at 14 KB gzipped — 9.5% of the budget — with every gate green,
because a page that is 14 KB too big renders exactly as well as one that is not; the budget is
build-breaking, so the cost arrives as an unrelated feature's CI failure months later. Only
comments are stripped from markup; HTML indentation stays (whitespace between inline elements is
significant, and ~1.1 KB is not worth a layout defect that renders correctly on the machine that
made it). The UI is **two screens**:
the dashboard (the plant — schematic, model, values, no config at all) and **Settings** behind the
header gear (the Connections tile + three ESP32 board cards — ESP32 board health, Protokoll
[X10A link + pins] and Firmware [version/OTA/language + default-off plant-diagnostics consent] —
plus conditional Anlagendiagnose and heating-curve source cards while enabled; flat, no sub-screens,
all built by one `esp32CardHtml()` and rebuilt together on every poll).
Settings drives the config endpoints in
place:

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
  If contiguous heap is insufficient for the temporary client, the request returns a retryable 503
  without writing; DNS plus an open TCP port never count as a successful MQTT verification.
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
  and rebooting would drop the poll cycle and MQTT availability for nothing.
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
  NTP card) is no longer shown on the row — it remains available from the raw API, and from every
  syslog TIMESTAMP. It is deliberately **not** an HA entity (see the retired "Device Time" under
  *The MQTT bridge*).
- **Heat pump** → `/set_hp`: fully automatic. The model is **auto-detected** (see Auto-detection) and
  shown read-only on the dashboard **Model** card. The Settings **Protokoll** card shows the X10A link +
  protocol and the **RX/TX pins**, which are also auto-detected: **read-only** while the bus answers,
  and a **dropdown** of the chip's safe GPIOs (`/status.pins_avail`) when it doesn't — picking a
  pin posts `{profile:"auto", rx, tx}` to re-run detection on that pair. That dropdown is a filter,
  not the rule — `validate()` rejects a **chip-reserved** GPIO server-side (`board_pin_offerable()`
  per pin, with the octal-SPI and status-LED facts from Kconfig), so a raw `curl POST` cannot route the UART onto a
  flash/strapping/JTAG pad, and `config_load()` re-applies the same test to the persisted cache. The
  RX/TX pins are **persisted atomically in `link`** (a manual pick survives reboot); the model is
  session-only. Protocol is auto-detected (no UI control), the poll interval is fixed at 1 s (not
  sent). `/set_hp` accepts the X10A domain `{profile, rx, tx}` and the independent HomeHub domain
  `{mb_host, mb_port, mb_unit_id}`, but not both in one request: a mixed patch returns 400
  `"update X10A and HomeHub in separate requests"` before changing either. The UI language is its own
  setting now (see the **Language** bullet below), never a `/set_hp` field.
- **Plant diagnostics** → `/set_diagnostics` (Settings **Firmware** card). The persisted boolean is
  false on a fresh device and on every pre-v19 config migration. A real toggle advances a persisted
  generation, saves it first, and then applies live without reboot. Off wipes the rolling checkup,
  unsubscribes/clears the room and circulation witnesses, stops forecast requests, retracts retained
  diagnosis publications and hides both dependent Settings cards plus the dashboard checkup. Saved
  source mappings remain so a later explicit enable can reuse them, but no old-generation evidence
  can cross that boundary. X10A/HomeHub polling, trends, ENV III, and the technical heartbeat remain
  independent.
- **DHW circulation-pump witness** → `/test_circulation` then `/set_circulation` (conditional Settings
  **Anlagendiagnose** card). The fields are the exact MQTT topic, active-power and source-time JSON
  paths, maximum age, ON/OFF hysteresis and confirmation time. Save accepts only a fresh value
  and binds the proof to that exact tuple before writing blob v15; Delete posts the empty mapping.
  The defaults match the observed Shelly Plug S contract (`apower`, `aenergy.minute_ts`, 3.0 W ON,
  1.0 W OFF, 120 s age, 60 s confirmation), but remain editable. The board subscribes to the same
  Shelly MQTT message that an external VictoriaMetrics pipeline may store; it does not query
  VictoriaMetrics and does not publish a Shelly command.
- **Language** → `/set_lang` (Settings **Firmware** card). The UI is bilingual (de/en) and picks its
  language client-side from `navigator.language` by default — a browser fact, not device state — but
  the card's picker (**Browser** / English / Deutsch) can force one, which then **persists** in the
  config blob (v4, `logic/ui_lang.hpp`) and wins over every client's own browser guess. `auto`
  (labelled "Browser" — it *is* the browser's own guess, not a separate mode) is the struct default,
  so a fresh device or one OTA-upgraded from a pre-v4 blob keeps auto-detecting exactly as before.
  Applied **live**, like the update channel: nothing claims the language at task start, the browser
  re-reads `/status.ui.lang` on its next poll and re-localises (`setLang()` re-runs
  `applyStaticI18n()` + `labelSchematicHits()`), no reload. The heat-pump **value labels** are
  untouched by any of this — they arrive over `/values` as English X10A register names and stay
  verbatim in both languages (see DESIGN.md §1).
- **Firmware / OTA** — tapping the version runs the real update flow. Both places the version is
  printed as a control are the same trigger (`checkFirmwareUpdate`): the header meta line beside the
  IP, and the **Version** row on the Settings **Firmware** card. Neither one navigates — the readout
  has a slot in each (`#otaStat`, `#otaStatSet`) and `otaInline` paints both, so the flow reports on
  whichever screen started it (only one is ever visible; the other screen is `display:none`). The
  Settings slot is painted into the DOM rather than rebuilt from state, so `renderSettings` freezes
  **all permanent Settings cards** together while `S.otaShown` (they are built and painted as one
  string, `esp32CardHtml()`) — otherwise the once-a-second rebuild would blink the percentage out and
  restart the spinner animation every frame. The flow itself:
  `GET /ota/check`, poll `GET /ota/status` until the check finishes, confirm, `POST
  /ota/update`, then poll again rendering the download progress **inline next to that version**
  (a small ring + "n%", not a toast). On `done` it does **not** use the shared reboot-reconnect poll
  the config saves use — an OTA replaces the served UI itself, so `otaWaitReboot` waits for the board
  to come back (version changed / `uptime_s` went backwards / seen down→up) and **reloads the page**.
  A download already running on the device is adopted on page load (`resumeOta`), so a reload
  mid-update keeps showing the progress. Because the OTA status payload is much smaller than the
  full `/status` builder, it also owns the refresh fallback: while TLS heap pressure prevents the
  latter from landing, the dashboard reports the known installation state and Settings shows a
  version/channel-only Firmware card. A later successful `/status` replaces that shell with the
  complete Settings cards once without wiping the OTA progress slot.

The board/platform is reported by `/status.platform` — read by `/status` consumers and the web UI's
paste-ready crash bundle, no longer a row on any Settings card.

## HTTP API reference

The complete field-by-field contract of every route. The canonical always-loaded instructions in
[`AGENTS.md`](../AGENTS.md) point editors here for the system architecture and full HTTP fields.

```
GET  /            embedded web UI (gzipped into the app binary)
GET  /favicon.ico inert embedded setup/dashboard icon; also available on the open setup AP
GET  /heat-pump-icon.png embedded dashboard app icon; trusted-LAN only
GET  /status      version, platform, uptime_s, app_elf_sha256 (build identity — matches a core dump
                  to its .elf), pins_avail[] (the chip-safe X10A GPIOs for the RX/TX picker, minus the
                  pins the firmware itself drives — the status indicator and the recovery button —
                  logic/board_pins.hpp),
                  board{led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,user_set,preset_id,
                  preset_name,vendor,pins_local[],presets[]}
                  (the runtime board-hardware config written by POST /set_board; user_set = the user
                  has STATED this hardware, as opposed to it being the build's defaults — the NVS
                  `board_set` key above, and the Hardware modal's licence to NAME the board in its
                  preset dropdown rather than opening on "Custom"; pins_local[] is the
                  LED/button-eligible set — WIDER than pins_avail by the dedicated-JTAG pads,
                  NARROWER by the X10A link's own rx/tx (board_hw_valid refuses a local pin that
                  equals either, so offering them was offering a guaranteed 400) — it
                  drives the two pin pickers in the ESP32 card's Hardware modal; presets[] =
                  {id,name,vendor,led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,i2c_pins[]}
                  per DOCUMENTED board
                  (logic/board_presets.hpp), the modal's "Board" dropdown, which only FILLS the five
                  fields — nothing is saved until the user submits. Carried in this payload rather
                  than a route of its own because the modal already reads pins_local from it: one
                  source, no second fetch to fail, and a preset cannot arrive disagreeing with the
                  pin lists it must fit inside. Empty only when NO board is selected and this build
                  (or the current link position) withholds every preset — the UI then hides the row;
                  a SELECTED board is re-added even when its factory LED/button fields would now be
                  refused (legacy-339), since a selector missing the identity the same payload reports would
                  read as the board having been forgotten),
                  env3{type,supported,enabled,sda,scl,connected,fresh,age_s,temperature_c,
                  humidity_pct,pressure_hpa,error,samples,errors,pins_avail[],presets[]} — the
                  optional M5Stack ENV III sensor (env3.cpp). `supported` is the BOARD's answer
                  (an M5Stack preset is selected) and `enabled` is already ANDed with it, so a stale
                  enabled flag on a Seeed board reads as off rather than as a sensor that ought to be
                  working. The three readings are null unless the sample is fresh — never a last-known
                  value, the same rule the held-over X10A rows follow — and `error` then carries WHY
                  ("unsupported_board"|"disabled"|"collecting"|"sensor_not_found"|"sht30_crc"|…),
                  diagnostics{enabled} — the persisted, default-off master opt-in reported separately
                  from board/link health. The Settings Firmware selector owns it; missing this object
                  in an older response is treated as off by the UI,
                  since "no number" and "no number BECAUSE the CRC failed" are different findings.
                  pins_avail[]/presets[] are this bus's own I2C candidates and are NOT gated on
                  `supported`: since legacy-339 the Board Hardware form saves board identity and ENV III in
                  ONE atomic POST /set_board, so selecting AtomS3 Lite and attaching its Grove sensor
                  in a single submit needs the pins offered while the PERSISTED board is still
                  Custom/Seeed. They reserve the LIVE X10A pair alone (config_link_pins) — the pending
                  LED/button pins are filtered by the browser, and the complete proposed snapshot is
                  re-validated authoritatively on the request path (env3_config_valid over
                  config_env3_reserved_pins), so the wider offer can never persist a colliding pair,
                  wifi{ssid,ip,rssi,connected,bssid,mac,std,rolled_back}
                  (bssid/std are the associated AP's BSSID + PHY standard name e.g. "Wi-Fi 4", null
                  while offline; mac is this STA's own MAC, always present; rolled_back = the last
                  /set_wifi was UNDONE by the credential rollback — sticky until the next /set_wifi,
                  and the only trace of it, since the rollback reboots and the SSID shown is just the
                  old one again),
                  mqtt{configured,connected,tls,has_creds,broker,base,base_custom,error} (has_creds =
                  whether creds are
                  stored, never their value; read from the CONFIG not the client — creds outlive a
                  disabled broker, which is exactly the state the UI must offer to clear via
                  /set_mqtt's clear_creds. `base` is always the EFFECTIVE base topic — the
                  compile-time default when nothing is stored — since reporting "" would make a
                  default device look unconfigured to the modal that prefills it; `base_custom` is
                  the separate fact of whether the user has STATED one, which is what the UI needs
                  before offering to reset it. The string is redacted, the bool is not: "is this the
                  default?" is diagnostic, the word the user chose is not),
                  reference_temperature{configured,name,topic,temperature_path,setpoint_path,
                  timestamp_path,enabled_path,hvac_mode_path,max_age_s,subscribed,has_value,
                  source_id,calibration_k,temperature_min_c,temperature_max_c,temperature_c,
                  has_setpoint,setpoint_c,enabled,hvac_mode,received_at,received_ago_s,source_at,
                  source_unix_s,timestamp_source,age_s,fresh,freshness_reason,
                  temperature_valid,setpoint_valid,control_eligible,room_error_k,reason,reason_code,
                  retained,messages,errors,rejections[,error][,eligibility_error]} — the decoded and
                  canonical MQTT living-room input. The `<base>/heating_curve` document's `room`
                  object archives its numeric accepted
                  view. It is the required heating-curve-diagnosis input; `room_error_k` is recorded
                  raw and is not an LWT correction. It feeds no heat-pump write.
                  SAVING the topic records the mapping, but the device-wide diagnostics opt-in is
                  additionally required before it is subscribed and decoded. Turning the master off
                  drops the subscription and clears every captured field without deleting the saved
                  mapping; deleting the mapping does both permanently. `reason` is the
                  load-bearing one for a UI — "disabled" (the thermostat reports itself off),
                  "non_heating_mode", "stale" — because a reading can be present, fresh and still
                  unusable, and the diagnosis card must say WHICH rather than call the input missing.
                  circulation_source{configured,name,topic,power_path,timestamp_path,max_age_s,
                  on_threshold_w,off_threshold_w,confirm_s,subscribed,has_value,power_w,state,
                  source_at,source_unix_s,timestamp_source,age_s,fresh,freshness_reason,retained,
                  messages,errors,rejections[,error]} — the EXTERNAL CIRCULATION WITNESS (legacy-361): an
                  independent MQTT power meter on the DHW circulation pump, decoded on the mqtt task
                  beside the room source and following the same two-part boundary (saved mapping plus
                  diagnostics master; deleting it clears every captured field). `state` is the
                  CONFIRMED class from logic/circulation_source.hpp — on/off/unknown — never the raw
                  sample: the witness is a PULSED load, so a lone spike must not flip the state and a
                  hysteresis-band reading must not read as off. It exists because the `dhw_loss`
                  checkup cannot otherwise tell a leaking 3-way valve from ordinary circulation
                  losses, and `name`/`topic` are redacted like the room source's for the same reason
                  (a typed name, a topic embedding a device id),
                  weather_forecast{configured,provider,model,fetch_interval_s,max_age_s,fetching,
                  available,has_value,latitude,longitude,state,outdoor_mean_2h_c,
                  solar_energy_2h_wh_m2,issued_at,fetched_at,valid_for_decision_at,last_attempt_at,
                  age_s,fresh,freshness_reason,successes,errors[,reason][,error]} — the Open-Meteo
                  ICON forecast (weather_forecast.cpp). `available` is the three-way AND of
                  configured, the task's own availability and freshness, so a consumer never has to
                  combine them itself; a FAILED refresh keeps has_value plus the last two numbers for
                  diagnosis while available/fresh go false, which is the distinction between "no data"
                  and "data that must not be acted on". FETCHING requires both the SAVED LOCATION and
                  the device-wide diagnostics opt-in. Saving coordinates is still the specific consent
                  to disclose them, but the stored location remains deliberately dormant while the
                  master is off.
                  `issued_at` is ALWAYS null — the endpoint does
                  not expose the model-run instant and fetch time is not a substitute for it.
                  latitude/longitude are null when unconfigured and "<redacted>" under ?redact=1,
                  heating_curve{method_version,armed,state,state_code,reason,reason_code,
                  sample_eligible,current_room_error_k,last_sample_room_error_k,
                  last_sample_unix_s,outdoor_temperature_c,outdoor_source,
                  last_sample_outdoor_temperature_c,last_sample_outdoor_source,
                  plant_outdoor_temperature_c,plant_outdoor_source,
                  last_sample_plant_outdoor_temperature_c,last_sample_plant_outdoor_source,
                  forecast_available,plant_gate_known,plant_gate_active,
                  heating_mode_known,heating_mode_active,room_source_unix_s,room_age_s,sequence,
                  evaluations,samples,holds,blocks} — versioned raw heating-curve diagnosis
                  (mqtt_ha.cpp, logic/heating_curve_diagnosis.hpp). `armed` is derived from the
                  diagnostics opt-in, timestamped MQTT room mapping and active HomeHub; forecast is optional. State/reason are the last
                  1s evaluation (`off|recording|hold|degraded|blocked` and `disabled|sample_recorded|
                  sampling_interval|room_unavailable|x10a_unavailable|homehub_unavailable|
                  plant_gate_unknown|plant_inactive|forecast_unavailable|clock_invalid|
                  heating_mode_unknown|non_heating_mode|sampler_inactive`), mirrored as stable
                  numeric codes. Codes 3/4 remain unused after removal of deadband/rate-limit
                  semantics. `sampler_inactive` (14) is the one reason /status can report that the
                  evaluator never emits: the sampler lives on the MQTT publish task, which SAFE MODE
                  never creates, so its snapshot stays default-constructed at Off/Disabled while
                  `armed` is derived from the saved room mapping at request time. Published raw that
                  was a payload contradicting itself, and "disabled" is the evaluator's word for "no
                  room source is mapped" — so the card told the reader to set up the source sitting
                  configured one row below it. logic/heating_curve_diagnosis.hpp's
                  heating_curve_reported_reason substitutes it (host-tested, and narrow: every state
                  a RUNNING evaluator produces passes through untouched). Clearing the BROKER is a
                  different state and stays `disabled`, because arming requires mqtt_uri — so that
                  one genuinely is disarmed. Nullable raw
                  errors are facts only while eligible/recorded; sequence + absolute timestamp form
                  the durable event contract. Room error is not an LWT offset. There is no actuator
                  result in this block and cannot be one.
                  The OUTDOOR fields are two independent optional axes. The legacy pair is ENV III
                  (env3.cpp), gated on the same fresh-AND-plausible pair its MQTT document uses.
                  The `plant_*` pair is HomeHub input 44, answered in an explicit fast batch and
                  sealed to the current Modbus session. Both current/event values name their source.
                  `outdoor_temperature_c` is LIVE;
                  `last_sample_outdoor_temperature_c` is the value AS IT STOOD at the recorded event,
                  which is the one an archive needs — a room error alone cannot separate a heating
                  curve that is too STEEP from one shifted too HIGH (+0.5 K at -5 C and at +12 C ask
                  for opposite corrections and record identically without it). It is CONTEXT, NEVER a
                  gate: no branch of the evaluation reads either, an absent source changes no state,
                  reason or counter, and the contract test refuses a `blocked`/`hold` on them — a gate
                  here would silently stop sampling on every board without the accessory, which
                  looks exactly like the feature merely being idle. Absent or non-finite records as
                  null, never 0 (which would read as a freezing day), a sample taken without the
                  source CLEARS that source's previous event reading rather than inheriting it, and
                  disarming drops both with the rest of sample memory. Adding them did NOT move
                  `method_version` — the room error is derived exactly as before, so archived events
                  stay comparable; the MQTT payload's own `schema_version` went 1 -> 2 -> 3 instead,
                  since payload SHAPE is what changed,
                  net{kind,ip,eth{supported,present,link,lease,ip,mac,speed_mbps,full_duplex,
                pins{sclk,cs,miso,mosi}}} — WHICH TRANSPORT carries the device ("none"|"wifi"|"eth")
                and what the optional wire is doing (net.cpp). A separate block from wifi{} rather
                than a widening of it: on a wired board the wifi block is entirely honest — not
                connected, no RSSI, no BSSID — and would be indistinguishable from a broken install
                without this. `ip` is the ACTIVE transport's address so a client reads one field
                instead of re-deriving a rule; `supported` says whether this BUILD carries the
                driver, which is what lets the UI hide the row rather than render a permanently
                absent feature. `link` (a cable is negotiated) is deliberately separate from `lease`
                (DHCP answered): "no cable" and "cable in, no address" call for opposite actions.
                speed/duplex are null without a link rather than a plausible-looking 10/half; ip and
                mac are redacted like their wifi twins, while every BOOLEAN and the four pin numbers
                stay in the clear — they identify nobody and are the first thing a triage reader
                needs from a wired board's report,
                syslog{configured,resolved,reachable,host,port,error},
                  ota{channel} — "release"|"dev", the FEED the next OTA check reads (POST /set_ota).
                  On /status and not only /ota/status because the Settings Firmware card renders its
                  selector from /status like every other setting; a device can be SET to a channel it
                  is not yet running a build from, so it is reported rather than inferred from the
                  running version's "-dev.N" suffix,
                  ui{lang} — "auto"|"de"|"en", the web UI's MANUAL language override (POST /set_lang,
                  logic/ui_lang.hpp). "auto" (the default) = browser-detected; "de"/"en" force a
                  language on every client. Reported here so the Firmware card's Sprache selector
                  renders from /status like the channel, and the browser applies it over its own
                  navigator.language guess,
                  ntp{server,synced,time} — server is the CONFIGURED address (config().ntp_server:
                  NVS "ntp_server" override of CONFIG_DAIKIN_NTP_SERVER, runtime-editable via
                  POST /set_ntp exactly like syslog_host/POST /set_syslog), not necessarily who
                  answered; synced/time are false/null until the first SNTP reply of this boot lands,
                  else RFC 3339 UTC (logic/timestamp.hpp) — mirrors syslog{} rather than sys{} below,
                  since it is a runtime-configurable network service too, not a static board fact,
                  hp{proto,rx,tx,connected,
                  last_ok_s,registers,values,crc_err,timeout_err}, profile{id},
                  plus
                  modbus{enabled,connected,discovering,host,port,unit_id,rx,fails,
                  values,task_stack_min_free_bytes,plant_gate_known,plant_gate_active
                  [,error,error_code,error_detail,error_register]}
                  — the HomeHub link diagnostics. READ-ONLY: there is no actuator object and no
                  actuation flag — the link is read-only. task_stack_min_free_bytes comes from the
                  one sampler all four watched stacks report through (main/stack_watch.hpp), not
                  from ModbusStatus, so this surface and the MQTT heartbeat cannot answer the same
                  question with two numbers; it is NULL rather than 0 when the task has never run,
                  which on a board with no HomeHub is always. The PLANT GATE pair is input register 53,
                  the one HomeHub fact the shadow controller consumes — `known` false means the
                  register did not answer and must never read as an inactive plant. `host` is the configured persistent
                  target (redacted like the other reporter-identifying values); empty means disabled.
                  Explicit discovery is request-local and therefore not a status mode; `discovering`
                  remains false for wire compatibility. The plant-gate pair also reaches MQTT through
                  the `<base>/heating_curve` document's diagnosis.gates block — as EVIDENCE for the
                  diagnosis, never as a writable entity: there is no actuator here to mirror,
                  sys{free_heap,min_free_heap,max_alloc,heap_restarts,mqtt_skipped,mqtt_quiesced,
                  poll_skipped,reset_reason,safe_mode,safe_mode_cause,
                  stack_min_free_bytes{httpd,poll,mqtt,modbus}} — heap
                  headroom (free / since-boot low-water / largest-contiguous INTERNAL, via
                  heap_guard.hpp's one sampler) + how many consecutive heap-watchdog restarts preceded
                  this boot (0 on an ordinary one; the restart is an esp_restart, so reset_reason
                  reads the same "sw" a config save produces and without this field a board
                  restarting itself every five minutes is indistinguishable from one somebody kept
                  saving settings on) + the SECOND memory budget, per watched task in BYTES and null
                  until that task has been sampled (main/stack_watch.hpp). Those four are here as
                  well as on the heartbeat for the reason this whole block exists: every ordinary
                  MQTT publish sits behind the X10A publish gate, and safe mode never starts the
                  publish task at all, so a board with a silent bus or a latched safe mode — exactly
                  the boards whose stack headroom someone wants — would report them nowhere. That is
                  the shape that once folded the board's own heap trends inside the heat pump's poll
                  cycle. + why the device last booted, ALWAYS present (unlike last_crash, and unlike the MQTT heartbeat needs no
                  broker); reset_reason via logic/reset_reason.hpp, safe_mode = the latched boot-loop
                  recovery flag (safe_mode.cpp; true once too many crash boots accumulated -> poll +
                  MQTT skipped),
                  last_crash (null unless this boot was a FAULT or a dump is still in flash — and
                  null again once POST /crash/dismiss DELETES the report, else
                  {reason,reason_code,fault,coredump,task,pc,backtrace[],corrupted,elf_sha256} — the
                  reason/summary from the boot-time cache, `coredump` re-read from flash per request
                  so a cleared dump can't strand the banner; drives the crash banner, whose title keys
                  on `fault` — an orphan dump alone is NOT "restarted after a crash"),
                  history{dt,persist,dwell_persist,rows[{id,label}],modbus_rows[{id,label}],
                  env3_rows[{id,label}]}
                  — `persist` is how THIS boot's rings came to be: "accept" (adopted from .noinit
                  DRAM across a reset that kept power) or the named reason they started empty
                  ("power_cycle", "wrong_catalog" after an update moved the trend set, "bad_crc",
                  "wrong_version", "no_record"). `dwell_persist` answers the same question in the
                  same vocabulary for the per-row STATE AGES (state_dwell.cpp), which ride the same
                  .noinit medium under the same rules and therefore reset for the same reasons; it
                  rides this block rather than one of its own because every byte added to /status is
                  paid for on the httpd task's stack. Reported because a chart — or a set of
                  durations — that emptied itself
                  otherwise reads as a defect, and only the device knows which of those happened —
                  plus which
                  X10A/board rows,
                  which structurally paired HomeHub schematic measurements and which ENV III
                  accessory readings carry a 24-hour trend,
                  and at what
                  cadence. The ID is the CONCEPT (logic/history.hpp's TRENDS — what GET /history
                  takes, so a request is model-independent); the LABEL is how the DETECTED profile
                  spells that row, which is what lets the UI attach a trend to the value row it is
                  already rendering. Rows this profile does not carry are omitted entirely,
                  health{covered_s,persist,full_span,available,assessable,evaluated,status,
                  checks[{id,verdict,evidence,observed_s,required_s,…}]} — the 24-hour plant CHECKUP
                  (logic/checkup.hpp, checkup.cpp), judged on the DEVICE only while diagnostics are
                  enabled. While off the object remains structurally present but carries no accumulated
                  checks, and the dashboard card is hidden. `status` is the worst
                  verdict across the checks and `covered_s` how much of the day was actually
                  OBSERVED (seconds, not whole hours — the first hour after a reboot must read as the
                  small number it is rather than rounding to "0 h"). covered_s is CARD-level context;
                  each check carries its OWN evidence clock (observed_s/required_s), because a
                  mostly-readable pressure row cannot lend 24 hours to an RPS row seen for two
                  seconds. EIGHT checks in READING order,
                  fault first, each `unavailable` | `collecting` | `ok` | `info` | `warn` plus its
                  own named numbers: fault{active},
                  dhw_loss{max_k_h,windows,high_windows,high_with_pump,high_pump_off,
                  circulation_on_s,circulation_known_s,candidate_s,settle_remaining_s,
                  aborts,abort_reasons[],best_aborted_s,blocked},
                  cycling{starts,mean_run_s,...,outdoor_source,outdoor_min_c,outdoor_mean_c,outdoor_samples},
                  defrost{count,share_pct,paired_count,defrost_s,run_s,outdoor_source,outdoor_min_c,
                  outdoor_mean_c,outdoor_samples}, pressure{min_bar},
                  flow{min_l_min},
                  heater{buh_min,bsh_min,buh_s,bsh_s}, retries{seen}. Named per check rather than a generic pair,
                  so the browser needs no table saying what field N means for which id — that table
                  would be a second definition of the check, free to drift. A number the check did
                  not establish is `null`, never an omitted key (redact.hpp's rule: an absent field
                  is indistinguishable from an older build that never had it). Not `diag` — GET /diag
                  is the log ring the bug-report button pulls, and two unrelated things under one word
                  is how a reader ends up looking in the wrong place,
                  detect{proto,valid,capacity_kw,capacity_kw_iu,ou_eeprom,candidates[],families[],
                  ambiguous,
                  model{name,family,marketing}} — drives the dashboard's Model card. TWO capacities,
                  separate fields, never merged:
                  capacity_kw is the OUTDOOR unit's own report (page 0x00/12) and is null whenever the
                  variable-length descriptor is too short to carry offset 12; capacity_kw_iu is the
                  INDOOR unit's rated code (0x60/6, same units), which detection reads as its ranking
                  fallback AND (since legacy-225) as the filter that narrows candidates[] when the O/U
                  figure is absent, and which is carried through the fingerprint
                  (config fp_iu_kw_tenths) so the card can show a capacity for the many units that
                  never report the O/U one. They are NOT interchangeable — a 6 kW outdoor unit under
                  an 8 kW indoor unit is an ordinary pairing — so the UI labels which unit it is
                  showing rather than substituting one figure for the other. All three unit facts
                  (both capacities + ou_eeprom) are gated on fp_valid, like candidates[]: POST /detect
                  clears the fingerprint, and reporting the PREVIOUS unit's figures through that
                  window is the stale-fingerprint-as-live-reading case DESIGN.md rules out.
                  RX/TX are auto-detected: read-only on the card while the bus answers, a pins_avail
                  dropdown (re-runs detection) when it doesn't.
GET  /values      decoded readings [{label,value,unit,reg}], plus sparse structural metadata where
                  it applies: "binary":true, "held":true and `x10a_group` only for a catalog label
                  reused on more than one register page. The last field reuses MQTT's audited page
                  namespace (for example `outdoor_state` versus `hydronic`), so the dashboard can
                  keep both independent fault channels without displaying two indistinguishable
                  "Error Code" rows or giving their accordions one shared key. `reg` is the
                  X10A register PAGE the row came from, and it is what lets the BROWSER apply
                  logic/ou_stale.hpp's page rule (0x20/0x21 stop being refreshed while the compressor
                  rests) to any row it shows — structurally, instead of by a label list that would be
                  a second, drifting copy of a rule CI gates in C++ (the catalog spells those rows
                  ~50 ways across 43 profiles). `held` is the DEVICE's own answer to the same
                  question, now that the poll engine applies the rule too (legacy-209 defect 5): the
                  browser still derives it, but a non-browser consumer gets it without
                  reimplementing the rule, and the marker travels WITH the row rather than being
                  recomputed from a snapshot taken elsewhere.
                  An ELIGIBLE switched row (conv 300-307 or the conv-203 fault class) also carries
                  HOW LONG IT HAS READ WHAT IT READS (state_dwell.cpp): `dwell_s` seconds, plus `dwell_min":true`
                  when the transition itself was never witnessed — so the true age is at LEAST that —
                  plus `dwell_blind_s` when part of the run went unread. THREE keys rather than one
                  number, because the number alone is not the claim: a consumer that prints `dwell_s`
                  and ignores the other two states something stronger than the device knows, which is
                  the legacy-35–39 shape drawn as a duration. Neutral P2 overlay flags carry the
                  same raw-bit age without asserting their proprietary semantics; measurements are
                  excluded as before. All three fields are omitted
                  where they do not apply, and an ABSENT `dwell_s` is a
                  first-class answer meaning the device declines to describe that run at all (silent
                  bus, a row unread past DWELL_MAX_GAP_S). A zero would say "it changed just now",
                  which is why absence is a missing key and never a 0.
                  THE RESPONSE IS CHUNK-STREAMED in bounded 1 KB pieces after complete X10A and live
                  HomeHub snapshots. HTTP chunk boundaries carry no domain meaning; concatenating
                  them yields the same JSON object. The exact serializer and sink also carry MCP
                  get_hp_values, with its small JSON-RPC prefix/suffix around that object. This keeps
                  a 129-row profile from demanding one contiguous allocation larger than the healthy
                  target's 15-16 KB largest block, while the staged snapshots still guarantee that a
                  response never mixes poll cycles or starts before a snapshot allocation can fail.
                  X10A rows also carry `concept` where logic/homehub_map.hpp pairs them with a
                  HomeHub register — the browser matches on that string and does NO matching of its
                  own, since a label match here is the substitution lwt_select/ou_stale exist to
                  prevent. The HomeHub's own readings ride a SECOND array, `modbus`
                  [{label,value,unit,off[,binary][,enum][,concept]}] — two arrays, never merged, mirroring
                  the two stacks: the sources have separate liveness, and merging would make "is this
                  reading current?" a per-row question no consumer could answer. `off` is the EKRHH
                  data-model offset (def/homehub.hpp), which is what the pairing keys on.
                  THE ARRAY IS EMITTED ONLY WHILE THE LINK IS LIVE AT THE MOMENT THE SNAPSHOT IS
                  TAKEN and carries that session's latest FULL cycle — bounded to at most four poll
                  intervals old while the 1 Hz fast cycles keep link/gate/context state current. A
                  consumer cannot infer that bound from a row, so it is part of this API contract.
                  Liveness and the cache
                  sit behind two DIFFERENT mutexes, so mb_values_snapshot() reports the link state
                  AFTER copying the cache (the only place the two can be tied into one answer);
                  checking mb_status() and then copying left a window in which one response carried
                  the previous session's rows under that guarantee. Not live -> the KEY IS OMITTED,
                  never emitted empty: an absent array and an empty one are different claims, and
                  only absence says "no current reading"
GET  /history?row=<trend id>[&source=x10a|modbus|env3]   one source's 24-hour series, oldest sample
                  first;
                  X10A is the backwards-compatible default, Modbus is accepted only for the eleven
                  paired concepts (logic/homehub_map.hpp) plus the unpaired Smart-Grid timeline, and
                  env3 only for the three accessory rings. Payload:
                  {id,source,label,dt,unit,t0,b0,v[],held[[from,count],…]}. `unit` is the ROW's own unit, read
                  from the cached value — never a hardcoded "°C": the thirty-one X10A trends mix °C,
                  bar, KiB
                  and unitless rows, and the browser prints this string into the range readout and the
                  crosshair, so a bar row labelled °C would be the legacy-35–39 shape. A catalog test pins
                  that each trend resolves to EXACTLY ONE row per profile, of one type code and one
                  width (which is what makes the tenths exact), across all profiles. Ids — the
                  authoritative list is logic/history.hpp's TRENDS, which is what a request takes:
                  numeric rows dhw_tank, leaving_water, leaving_water_post_buh, return_water,
                  refrigerant_liquid, water_pressure, flow, pump_signal,
                  circuit_pressure, comp_rps, eev, outdoor_air, outdoor_heat_exchanger, discharge,
                  room_temp, inv_current,
                  ct_l1, ct_l2, ct_l3; component-STATE timelines defrost_state, quiet_state,
                  bsh_state, buh_step1, buh_step2, valve_dhw, valve_heat, water_flow_switch; and the
                  four that are not catalog rows at all — smart_grid_mode (two contact bits),
                  circulation_state (the confirmed external MQTT witness) and the two BOARD trends
                  free_heap and
                  max_alloc (the ESP32's own memory in KiB — no register, fixed English labels, and
                  they resolve no catalog row by construction). The ENV III ids are
                  env3_temperature, env3_humidity and env3_pressure, offered on /status.history
                  .env3_rows only while the sensor is enabled — a disabled accessory is absent rather
                  than three permanently empty charts. `v` is TENTHS of that unit (the
                  resolution the converters produce, so a sample is exact rather than rounded on the
                  way in — the browser scales by 10) or null. `held` run-length-marks WHICH nulls
                  were the outdoor unit RESTING rather than a failure to measure: `v` stays a plain
                  number-or-null array any consumer can read, and the reason rides alongside instead
                  of inside it (Modbus has no held-over state, so its array is empty). `b0` is the
                  monotonic 5-minute bucket of sample zero and aligns the two instruments exactly;
                  `t0` is the wall-clock instant of sample 0, derived at SERVE time
                  from the current clock and the sample count (the ring advances on the MONOTONIC
                  clock, so it survives SNTP setting the time mid-boot) and OMITTED when the clock
                  has never synced — the UI then reads out an age rather than a fabricated time,
                  the same refusal logic/timestamp.hpp makes. An unknown id is 404, never a
                  defaulted trend. Sent in CHUNKS (~1.1 kB body): smaller than the model-dependent
                  `/values` body, but still a new allocation on a heap whose largest contiguous block is the real
                  ceiling. Which rows HAVE a trend is /status.history — a row the profile does not
                  carry is omitted, an absent feature stated by absence rather than an empty chart
(no /events)      There is NO live-push route. The web UI POLLS: GET /values every 2 s and
                  GET /status every 8 s, one chain, backing off to 30 s while the device is
                  unreachable and suspended entirely while the browser tab is hidden. The /events
                  WebSocket that used to be the only live transport was removed — a dropped IDF queue
                  message froze one stream until reboot with nothing logged (legacy-238) and its broadcaster
                  ran the /status builder on the task owning the X10A UART (legacy-241); the
                  "Push vs. poll" section above carries the measurements. Consequences worth knowing: EVERY route is
                  now under the http_register OOM guard (the raw-registered WS handler was the one
                  exception), CONFIG_HTTPD_WS_SUPPORT=n, and /status is built on ONE task
GET  /models      pin hint + catalog metadata (def/models_catalog.hpp). Detection is fully automatic;
                  the UI no longer offers a manual model picker. NO shipped client reads this — the
                  web UI never fetches it, and the RX/TX dropdown takes its GPIOs from
                  /status.pins_avail (logic/board_pins.hpp), NOT from this pin_hint. Legacy metadata
                  behind a read-only inspection endpoint for humans/scripts
GET  /diag[?verbose=0|1][?redact=1]   in-memory diag log. ?redact=1 scrubs the handful of
                  lines that interpolate a host/IP/SSID (logic/redact.hpp) and switches the response
                  to CHUNKED: a replacement is longer than most values it replaces, so the redacted
                  text can GROW past the static dump buffer, and the alternatives are a second ~8 KB
                  .bss buffer or a ~6 KB contiguous heap allocation
POST /diag/clear  clear the in-memory diagnostic ring. Destructive actions are POST-only, so a link,
                  prefetch or crawler cannot erase evidence.
GET  /status?redact=1   the bug-report form of /status: all 27 reporter-identifying values read
                  "<redacted>". `logic/redact.hpp` owns the machine-readable ordered field list and
                  `REPORTING.md` owns its human explanations; the redaction audit compares both with
                  the builder. Besides network/location identifiers, names and topics, the set now
                  includes all seven user-typed JSON paths — `zones.<room>.temp` demonstrates why a
                  path can identify the reporter just as readily as a topic.
                  An UNSET field is left EMPTY rather than substituted (redact_identifier, not the
                  raw redact_or primitive): "<redacted>" over an empty value manufactures an
                  identifier that does not exist, and the first question triage asks of a frozen
                  report is which optional sources the installation is even running. mqtt.broker is
                  the sharpest case — empty IS the disabled state, so every broker-less device used
                  to report a hidden broker. The empty string is kept rather than a null so the
                  field's TYPE does not change with the flag; weather_forecast.latitude/longitude
                  reach the same answer from the other side by emitting null when unconfigured.
                  The KEY is always emitted — an omitted field is indistinguishable from an older
                  build that never had it, and "which build produced this?" is the first question a
                  frozen report must answer. Substituted where each value is WRITTEN, never as a
                  pass over the finished string (the httpd stack budget that v1.0.12 overflowed).
                  The UNREDACTED /status is what the dashboard polls — it legitimately shows the
                  SSID and the broker, so redaction is opt-in per request, never the default
GET  /scan        WiFi scan {"networks":[{ssid,rssi}]} — TRUSTED-LAN ONLY and read by NO shipped
                  client: the setup portal takes a TYPED SSID (no dropdown, no fetch), so this is a
                  humans/scripts diagnostic like /models, not part of the provisioning surface
GET  /coredump      stream the current-firmware core-dump image (chunked octet-stream; 404 if
                  none or if the only raw image is a proven foreign-build orphan). Decode offline against the matching-version
                  .elf: scripts/decode-coredump.sh coredump.bin (CI archives the .elf per build). The
                  UI surfaces a crash banner + one-click download when /status.last_crash is set.
POST /coredump/clear erase only the coredump partition while preserving the reset/crash record.
POST /crash/dismiss   ACKNOWLEDGE + DELETE this boot's crash report: erase the core-dump image and
                  mark the cached CrashInfo dismissed (diag_crash_dismiss), so crash_is_notable() is
                  false everywhere at once — /status.last_crash goes null, the retained MQTT crash
                  topic clears on the next heartbeat tick, and the web UI's banner is gone across
                  reloads and browsers. That is the point: the banner's "dismiss" was page state
                  alone, so a reload brought the same crash back. Separate from POST /coredump/clear
                  because they answer different questions — clearing frees the flash slot for the
                  NEXT dump and deliberately leaves the fault reset on record, while this says the
                  crash has been dealt with; and a fault reset commonly carries no dump at all (a
                  stack overflow overruns it), where /coredump/clear changes nothing the banner keys on.
                  ERASE FIRST, mark second: a failed erase of current-firmware evidence answers 500
                  {ok:false,error} and marks NOTHING, since a dismissal surviving it would report
                  "no crash" while the dump was still downloadable. Proven-foreign residue is the
                  exception: it is already suppressed from /status and GET /coredump, so an erase
                  failure cannot pin a separate current-fault banner. RAM-only and needs no NVS — after any reboot the reset reason
                  is no longer a fault and the dump is gone, while a NEW crash must show. POST, not
                  a GET beside /coredump: it destroys the one artifact a bug report needs, so it must
                  not be reachable by a link or a prefetch. The reset REASON survives untouched
                  (/status.sys.reset_reason + the heartbeat's own "Reset Reason" sensor) — what was
                  deleted is the crash report, not the fact that the board rebooted the way it did
POST /set_wifi    {ssid,pass} -> validate (ssid 1-32 chars; pass empty[open] or 8-63) -> persist +
                  reboot. A rejection is 400 {ok:false,error} like every other write endpoint (the
                  shared send_err) — it used to be bare text, which the setup portal couldn't tell
                  apart from success. If WiFi was already configured, the OLD ssid/pass are stashed as a one-shot
                  NVS backup (wifi_rollback flag) and wifi_rolledbk is cleared (a new attempt retires
                  the old verdict): after reboot, if the new creds fail to get a DHCP lease,
                  wifi_start_sta restores the backup + reboots (setting wifi_rolledbk ->
                  /status.wifi.rolled_back); a successful connect clears the backup. So a bad
                  SSID/password entered over the LAN self-heals to the last working network instead of
                  stranding the device in the setup AP. The deadline is REASON-aware
                  (logic/wifi_rollback.hpp): rolling back is destructive, so only an AP that SUSTAINS
                  its refusal (auth class at 2 consecutive 30 s checkpoints, ~60 s) spends them — an
                  absent SSID or a slow DHCP is no evidence against them and gets 180 s, long enough
                  for a rebooting router. wifi.cpp clears the reason on STA_CONNECTED, so an earlier
                  refusal can't outlive the association that disproved it.
POST /set_mqtt    {broker,user,pass,clear_creds,base} -> pre-flight the broker synchronously (DNS -> TCP
                  probe -> short-lived esp-mqtt CONNECT/auth, mirroring mqtt_ha's creds-require-mqtts://
                  policy) -> on success persist + reboot; on failure 400 {ok:false,error} and nothing is
                  saved. Unchanged settings short-circuit to {ok:true,reboot:false} (no probe, no reboot).
                  "" (empty broker) disables MQTT and skips the probe. Blocks up to ~8 s — the one
                  request-path network block (syslog/wifi don't); safe under the handle_all 503 guard.
                  CREDENTIALS: the modal never prefills them, so an empty user+pass means KEEP the
                  stored ones (else an unrelated broker edit would wipe a working login). Empty can
                  therefore not also mean "clear" — clear_creds:true (the UI's "remove stored
                  credentials" checkbox, shown when /status.mqtt.has_creds) is the explicit signal; a
                  non-empty user/pass is an explicit SET and wins over the flag. Without it an
                  authenticated mqtts:// broker can never migrate to an anonymous mqtt:// one: disable
                  + re-add both send empty creds -> both keep -> the kept creds then 400 every
                  plaintext broker ("Credentials require mqtts://"). Only a flash erase escaped that.
                  BASE TOPIC: `base` is this INSTALLATION's MQTT base topic (logic/mqtt_base.hpp),
                  runtime because CI publishes ONE esp32s3 image while the base is a per-installation
                  fact — CONFIG_DAIKIN_MQTT_BASE_TOPIC is now only the DEFAULT, and an empty stored
                  value MEANS that default, so the upgrade is a no-op for every deployed device and
                  needs no migration. OPTIONAL and absent means KEEP, never "reset to the default":
                  the dashboard always sends it, but this is a documented ROUTE — a script, or a
                  browser still holding a cached pre-v16 bundle, posts broker+creds alone, and
                  defaulting on absence would move a deliberately-renamed installation back onto the
                  shared base. Rules
                  are checked BEFORE the broker pre-flight (free and local, versus a DNS lookup + up
                  to ~8 s of the httpd task) and each refusal carries its own machine code beside the
                  English text — the ENV III pattern, so the bilingual UI translates without the API
                  losing its one wording. The browser deliberately keeps NO second copy of the rules:
                  the load-bearing one is that the base must still slugify to something, since
                  device_node_id() falls back to the constant "daikin" and would put two boards back
                  on ONE HA device — the exact collision this setting exists to end. Changing it
                  RENAMES the installation (new HA device, history stays with the old one), FORKS
                  every metrics series (a collector carries the topic as a LABEL, so the two halves
                  never overlap and a query pinned to one reads the other as absent — the firmware's
                  own state->x10a migration cost exactly that), and strands
                  the previous base's retained topics, which the firmware deliberately does NOT
                  retract — and the reason is the setting's own purpose: a base may be SHARED by a
                  second board, so a device sweeping it on the way out would delete the retained state
                  of the installation it was colliding with. That is the user's call
                  (docs/HOME_ASSISTANT.md carries the sweep).
POST /set_syslog  {host,port} -> validate port range -> persist + reboot. Empty host disables syslog.
                  Unchanged settings short-circuit to {ok:true,reboot:false}, same as /set_mqtt and
                  /set_ntp — a re-save of identical values would otherwise reboot for nothing.
                  DNS/reachability are NOT checked here (no request-path network block); they resolve
                  in the syslog task and surface via /status.syslog {resolved,reachable,error}.
POST /set_ntp     {server} -> persist + reboot. No request-path network probe (the SNTP client
                  resolves + retries on its own task after reboot, same as syslog); an empty server
                  is accepted and read by config_load() on the next boot as "reset to the
                  CONFIG_DAIKIN_NTP_SERVER compile-time default" (SNTP has no disabled state, unlike
                  syslog_host's empty-means-off). Unchanged settings short-circuit to
                  {ok:true,reboot:false}, same as /set_mqtt.
POST /set_diagnostics {enabled:boolean} -> persist + apply live, no reboot. This is the one
                  device-wide opt-in for the rolling checkup, heating-curve diagnosis, and their
                  additional room/forecast/circulation collection. It defaults false for fresh and
                  pre-v19 configurations. Every real transition advances a durable generation;
                  disabling clears the old checkup and source runtime state, and enabling starts a
                  new interval that cannot restore evidence from a prior generation. Ordinary X10A,
                  HomeHub, history, ENV III, and technical heartbeat processing remain active.
POST /set_ref_temp   {name,topic,temperature_path,setpoint_topic,setpoint_path,fixed_setpoint_c,
                  timestamp_topic,timestamp_path,enabled_path,hvac_mode_path,max_age_s} -> validate,
                  persist and rebind on the existing MQTT client without reboot. Subscription and
                  decoding occur only while the v19 diagnostics master is enabled; otherwise the
                  saved mapping remains dormant. There is NO
                  test/proof step (legacy-433 removed POST /test_ref_temp and the test_proof gate): the
                  mapping becomes the active binding immediately when that master is on. Empty topic
                  is the explicit disabled state and clears
                  every other field; otherwise the value topic is exact (no wildcards), paths are
                  bounded dot-separated JSON selectors, max_age_s is an integer in 10..3600, and a
                  non-empty source needs a target — either a setpoint mapping or a fixed target
                  (`fixed_setpoint_c`, 0..35 °C). legacy-433 also made the setpoint and timestamp sources
                  INDEPENDENT topics; an old client that sends only `topic` still has its
                  setpoint_path/timestamp_path resolved against it, preserving the v16 request
                  contract. A typo does not fail loudly — it surfaces as a runtime room error on
                  /status (payload/path/freshness), which is what keeps the write-free SHADOW
                  diagnosis fail-closed. An unchanged mapping still re-evaluates the live/dormant
                  binding so the Settings action can retry it, and short-circuits {ok:true,saved:false,
                  reboot:false}. Deleting a source (empty topic) applies the same way — removal must
                  never depend on the thing being removed still working
POST /test_circulation  {name,topic,power_path,timestamp_path,max_age_s,on_threshold_w,
                  off_threshold_w,confirm_s} -> require the v19 diagnostics master (409 while off),
                  subscribe the CANDIDATE mapping on the existing authenticated MQTT client, wait
                  up to 12 s for a frame, decode it through the path the live witness uses, and
                  answer {ok,test_proof,power_w,state,retained} — or 422 with the reason it did not.
                  Writes NOTHING (a probe, not a save): an empty topic is 400, since "test nothing"
                  is not a question
POST /set_circulation   {name,topic,power_path,timestamp_path,max_age_s,on_threshold_w,
                  off_threshold_w,
                  confirm_s,test_proof} -> validate, persist and apply live (no reboot). The
                  EXTERNAL CIRCULATION WITNESS: an independent power meter (in practice a smart plug
                  on the DHW circulation pump) whose confirmed on/off state is what lets the checkup
                  tell a real 3-way-valve leak from ordinary circulation losses. Empty topic is the
                  explicit disabled state; a non-empty one REQUIRES a valid `test_proof` from
                  /test_circulation or answers 409. Circulation is the remaining proof-gated MQTT
                  mapping; the room source saves directly and reports mapping errors at runtime. A
                  mistyped witness does not fail loudly, it silently re-attributes a tank's cooling
                  rate. The proof
                  binds the seven BEHAVIOURAL fields (not the cosmetic name). An unchanged mapping
                  short-circuits to {ok:true,saved:false,reboot:false}; only a change to those seven
                  reconfigures the subscription, so renaming the source does not retire its evidence
POST /set_weather {latitude,longitude} -> validate + persist + notify the weather task (no reboot,
                  and no DNS/TLS/JSON on the request path). SAVING THE LOCATION is the specific
                  consent to hand these coordinates — and this device's public source IP — to a
                  third party; the task additionally requires the device-wide diagnostics opt-in.
                  A saved location remains dormant while that master is off. Both are
                  STRINGS parsed strictly (optional sign, digits, `.` or the German `,`, at most six
                  decimals — an exponent, whitespace or a `+` is rejected rather than coerced, since
                  a coordinate that silently becomes a different one is a request the user cannot
                  see failing). BOTH EMPTY is the explicit disabled state; exactly one empty is 400
                  "latitude and longitude are both required" — half a location is never a location.
                  Disabling also requests the retained MQTT topic's cleanup, so a stopped forecast
                  leaves no last-known values on the broker
(no /set_dynamic_lwt)  RETIRED in legacy-357. There is no controller mode to POST: the heating-curve
                  diagnosis arms itself while diagnostics, the timestamped MQTT room mapping and HomeHub are configured
                  (`heating_curve_diagnosis_armed`). Forecast/location is optional comparison evidence;
                  `/set_weather` applies its own collection/privacy boundary live. What the route bought was a
                  second statement of a fact the configuration already made — and it could not be
                  reached: it answered 409 until those sources existed, while the only editors for
                  them lived inside the Settings card that was hidden until the mode was on. An
                  ACTIVE controller stays unrepresentable for the stronger reason than a rejected
                  word: no controller enum, value field or route exists. `/set_diagnostics` is only
                  a collection opt-in and creates no actuator.
POST /set_env3    {enabled,sda,scl} -> validate + PROVE + persist + REBOOT. A standalone
                  COMPATIBILITY endpoint since legacy-339 folded ENV III into the Board Hardware form — no
                  shipped client posts here (the UI sends env3_* to /set_board), and both routes run
                  the one env3_save_preflight so the two can never disagree about what counts as
                  evidence. Every key is optional
                  and an omitted one keeps its stored value. Refused unless the selected board preset
                  is an M5Stack one (the Grove port is what makes the sensor plausible), the two pins
                  differ, and both survive the same reservation rules the X10A link, the status LED
                  and the recovery button apply to each other. Beyond validation it demands EVIDENCE
                  from the hardware, graded by what is changing (logic/env3.hpp's Env3SaveCheck):
                  enabling on new pins runs a real bus probe (422 env3_sht30_not_found /
                  env3_qmp6988_not_found, 503 env3_probe_busy), enabling on the pins already running
                  requires a fresh sample (422 env3_not_reachable), moving pins while running is 409
                  env3_disable_first (two masters must never briefly drive one shared wire), and
                  DISABLING checks nothing at all — it is the recovery path and must not depend on
                  the hardware that may be the problem. Each refusal carries a machine `code` beside
                  the English `error` so the bilingual UI can translate without the API losing its
                  one wording. Reboots on a real change, unlike /set_hp's live apply: the I2C driver
                  owns the bus for the task's life
POST /set_hp      {profile,rx,tx,mb_host,mb_port,mb_unit_id}
                  -> validate + apply live (no reboot). Every key is OPTIONAL and an omitted one keeps
                  its stored value, which is what lets the pin picker POST {profile,rx,tx} without
                  flipping anyone onto Modbus — and lets the HomeHub modal POST only its three fields.
                  Those are two durability domains, never one transaction: any request that names an
                  X10A field (profile/rx/tx) AND a HomeHub field (mb_host/mb_port/mb_unit_id) returns
                  400 "update X10A and HomeHub in separate requests" before persistence, RAM apply or
                  task reconfiguration. Clients must send two requests when they intend to change both.
                  `mb_host` is the complete explicit HomeHub intent: non-empty polls exactly that
                  address; sending empty persists the discovery latch and suppresses tasks, future
                  automatic searches, sockets and dependent heating-curve diagnosis. This SECOND
                  stack never stops X10A.
                  mb_port 1..65535, mb_unit_id 1..247 and mb_host's LENGTH (at most
                  CONFIG_BLOB_MAX_STR = 512 chars) are checked by validate() — the length bound is
                  not cosmetic: the atomic blob's decoder rejects the WHOLE blob on a longer string,
                  so a saved over-long address discarded the entire configuration on the next boot.
                  A refusal is 400 "mb_host is too long"; config_save refuses independently. The three
                  HomeHub fields (host, port, unit, discovery-done latch) persist in the atomic blob
                  and apply live: the
                  httpd route calls mb_reconfigure(), while the Modbus task remains the sole socket
                  owner and retires/restarts itself as needed. `actuation_enabled` is NOT accepted —
                  the Modbus link is read-only, and an accepted-but-inert field would read like a
                  capability that still exists. rx/tx
                  PERSIST (the physical
                  pin cache — a manual override survives reboot); profile is session-only. The UI
                  always sends profile="auto" (fully automatic — no manual model pick); a concrete id
                  is still accepted (pins the model for this session) but never offered in the UI.
                  proto is NOT accepted (auto-detected); poll_s fixed at 1 s and lang is NOT accepted
                  here — the UI language is its own setting now (POST /set_lang), no longer a /set_hp
                  field. RX/TX are auto-detected; when the bus is silent the Protocol card's pin dropdown
                  posts {profile:"auto",rx,tx} to re-run detection.
POST /discover_homehub   {} -> run the bounded, manual `_http._tcp` mDNS browse and return
                  {ok:true,host:"<resolved IPv4>"}. Trusted-LAN only, no configuration write and no
                  Modbus-task reconfigure: the dialog fills its ordinary address field, and only its
                  later Save persists the result. A miss returns 404 so manual entry remains available.
POST /set_board   {preset_id,led_gpio,led_type,led_inverted,btn_gpio,btn_active_low,
                  env3_enabled,env3_sda,env3_scl} -> validate + PROVE + persist + optional REBOOT.
                  ONE atomic form owns the board identity, its onboard parts and the optional M5Stack
                  ENV III accessory, so choosing AtomS3 Lite and attaching its Grove sensor cannot
                  half-save. It therefore also answers ENV III's graded evidence refusals (the same
                  422/503/409 codes /set_env3 returns, via the shared env3_save_preflight), and a
                  board switch away from M5Stack retires env3_enabled in that same save rather than
                  leaving an I2C task running for hardware the form no longer shows. preset_id is the
                  stable key: a non-string is 400 "preset_id must be a string", an unknown one 400
                  "board preset is unknown", and an omitted one recovers the legacy exact-match choice
                  once for a pre-v12 cached UI.
                  REBOOT. The board's own onboard parts: which pin the status indicator is on, whether
                  it is a plain LED (led_type 0) or a WS2812 (1), and which pin (if any) carries the
                  factory-reset button. -1 = absent for either pin. Runtime rather than Kconfig because
                  CI publishes ONE esp32s3 image and boards disagree about their onboard hardware.
                  Reboots (unlike /set_hp's live apply): both are claimed once at task start — the
                  WS2812 opens an RMT channel, the button installs a pull — and hot-swapping a running
                  driver from another task buys nothing for a once-per-board setting. TWO facts move
                  here, and one comparison for both is what made a save vanish (legacy-257): the five
                  VALUES decide the reboot, while the SUBMIT ITSELF states that the user has said
                  what this board is (the `board_set` key / user_set above). Picking the preset your
                  device already carries moves no value but is still that statement, so it is a SAVE
                  with NO reboot — {ok:true,reboot:false,saved:true}, where `saved` is what stops the
                  UI reporting an NVS write as "no changes". Decided by board_env_save_needed /
                  board_env_reboot_needed (logic/env3.hpp, host-tested), never re-derived here —
                  they OR the board answer with an ENV III change, so a sensor edit always reboots
                  even when no board value moved: its I2C controller is owned for the sensor task's
                  whole life.
                  A submit that moves neither still short-circuits to {ok:true,reboot:false} like
                  /set_mqtt//set_syslog//set_ntp.
                  Validation (board_hw_valid) checks the chip-safe LOCAL-I/O set — wider than the X10A
                  set by exactly the dedicated-JTAG pads 39-42, since a board's button legitimately
                  sits there (AtomS3 Lite: GPIO41) — plus the collision rules, in BOTH directions: no
                  pin may be claimed by the indicator, the button and the X10A link at once, whichever
                  endpoint is called second
   (every /set_*) a failed route-owned NVS write answers 500
                  {ok:false,error:"config write failed"} and does NOT reboot/apply; unrelated
                  self-healing link-cache maintenance failures are logged without rejecting a
                  committed service blob, while an X10A /set_hp requires the atomic `link` blob (its
                  failed write is on /diag and the previous complete link remains intact)
POST /set_ota     {channel:"release"|"dev"} -> validate + persist, applied LIVE (no reboot, unlike
                  /set_board: nothing claims the channel at task start — ota_update.cpp reads it when
                  it fetches, so the very next check uses the new feed). An unknown name is REJECTED,
                  not defaulted — answering ok to a typo would look like a saved setting. Unchanged
                  -> {"ok":true,"reboot":false} like the other /set_* routes
POST /set_lang    {lang:"auto"|"de"|"en"} -> validate + persist, applied LIVE (no reboot, like
                  /set_ota: nothing claims the language at task start — the UI reads /status.ui.lang,
                  so the next poll applies it). The web UI's MANUAL language override on top of the
                  browser default (logic/ui_lang.hpp): "auto" hands the choice back to the browser
                  (navigator.language), "de"/"en" force one on every client that opens the dashboard.
                  An unknown name is REJECTED, not defaulted (a typo would look saved). Unchanged
                  -> {"ok":true,"reboot":false} like the other /set_* routes
POST /detect      re-run auto-detection now (no reboot): reset profile to "auto" + invalidate the
                  fingerprint (RAM only) -> the next poll cycle sweeps protocol + re-fingerprints
GET  /ota/check   start an async manifest check (?ms= is parsed but gates nothing — TLS date
                  validation is compiled out, so OTA needs no wall clock even though SNTP now exists)
POST /ota/update[?downgrade=1]  start the async download of the SELECTED channel's build.
                  Re-fetches the manifest and re-runs the downgrade gate
                  itself rather than trusting what /ota/check left behind: this route is reachable on
                  its own, so gating only in /ota/check would mean no gate at all for a direct caller.
                  ?downgrade=1 (query_flag_on — fires on "1" and nothing else) is the CHANNEL SWITCH:
                  the only way to install a build older than the running one (dev -> the last
                  release). Per-request, never stored
GET  /ota/status  {state:idle|checking|updating|done|error, progress, message, update_available,
                  downgrade, channel, available, current} — the UI polls this; all strings go through
                  json_quote. `downgrade` = the offered build is installable but OLDER (the
                  dev -> release direction); the UI needs BOTH flags, since update_available alone
                  makes a release-channel check on a dev board read "up to date" forever
GET  /mcp         embedded/gzipped static MCP information + setup page; no external assets or
                  network requests, CSP connect-src 'none', never SSE
POST /mcp         stateless read-only MCP: initialize / tools/list / tools/call; get_status +
                  get_hp_values mirror /status + /values. The model-sized values result is bounded-
                  chunk streamed, not materialised as one JSON-RPC string. Notifications → 202; no
                  SSE/session
```

No HTTP auth / TLS by design — trusted LAN only. See docs/SECURITY.md.


## Concurrency: tasks and priorities

Every `xTaskCreate` in this firmware takes its priority from `main/task_config.hpp`, so the ordering
below is the code rather than a description of it. Stack sizes stay at the call sites, where each is
justified by that task's own measured deepest frame — see [Memory constraints](#memory-constraints)
for why a shared table of sizes would be the wrong shape.

| Prio | Task | Owner | Why this tier |
|:----:|------|-------|---------------|
| 5 | `hp_poll` | `hp_poll.cpp` | Owns the X10A UART and is Task-Watchdog-subscribed: a delayed cycle is a step toward a watchdog reboot. |
| 5 | `captive_dns` | `captive_dns.cpp` | Must answer a joining phone's connectivity probe inside that probe's own timeout, or the captive portal never pops. Setup mode only. |
| 4 | `mqtt_pub` | `mqtt_ha.cpp` | The HA bridge publisher, and the inbound room / circulation sources that ride the same client. |
| 4 | `hp_modbus` | `hp_modbus.cpp` | The second, independent HomeHub source. No task at all while `mb_host` is empty. |
| 4 | `env3` | `env3.cpp` | The optional ENV III sensor. No task at all unless enabled on an M5Stack board. |
| 4 | `wifi_wd` | `wifi.cpp` | The ghost-association watchdog: periodic, latency-tolerant, but must run when due. |
| 4 | `eth_fb` | `net.cpp` | Watches for the cable being pulled from a board that came up WIRED, and decides a reboot — so it must not sit behind a long publish. Exists only on such a board. |
| 4 | `ota` / `ota_health` | `ota_update.cpp` | Transient. The download holds a TLS peer that will time out. |
| 3 | `syslog_task` | `syslog.cpp` | Best-effort UDP; a late datagram costs nothing. Opt-in. |
| 3 | `weather` | `weather_forecast.cpp` | A 45-minute fetch cadence. Opt-in. |
| 3 | `recovery_btn` | `recovery_button.cpp` | Debounced sampling of a human-scale action. Opt-in (`btn_gpio` defaults to -1). |
| 2 | `status_led` | `status_led.cpp` | Cosmetic, below everything: a dropped tick costs nothing, since the next recomputes the pattern from scratch. |

The `esp_http_server` task and esp-mqtt's own event task are created by ESP-IDF with their own
Kconfig-set priorities and are not in this table. Seven of the twelve above are optional and simply
do not exist when their feature is unconfigured — which is why the source-absence matrix
(`test/test_source_absence_contract.mjs`) treats absence as a state rather than an error.

Every one of them that allocates also self-guards: an escaping `std::bad_alloc` at a task boundary
reaches `std::terminate` and reboots the board. And every mutex any of them takes goes through the
one `daik::SemGuard` in `main/rtos_guard.hpp` — which replaced nine per-file copies that had drifted
into two shapes disagreeing about whether a failed take is noticed, and which adds the bounded /
try-lock acquire a callback context needs.

## Memory constraints

Heap is tight (WiFi + MQTT + TLS dominate; the binding limit is the
largest *contiguous* free block): keep every HTTP handler under the `handle_all` try/catch (503 on
OOM), stream `/diag`, `/values`, MCP get_hp_values and MQTT discovery instead of building one big
`std::string`, and treat any new large contiguous allocation (big JSON, OTA TLS) as a crash risk to
size-check. A reboot loop is bad here too — it stops the poll cycle and drops MQTT availability.

Two rules follow from that, and they apply to **every** FreeRTOS task loop that allocates, not just
to HTTP handlers:

1. **The task loop self-guards.** A task entry is a C frame boundary exactly like a handler is, so an
   escaping `std::bad_alloc` means `std::terminate()` → reboot. Wrap the loop *body* in
   `try/catch (const std::exception&)` + `catch (...)`, `diag_printf` once, skip the cycle keeping
   the last good state, and continue after the normal delay. `mqtt_task` (`mqtt_ha.cpp`),
   `poll_task` (`hp_poll.cpp`) and `syslog_task` (`syslog.cpp` — its per-cycle `config()` snapshot
   copies ~10 `std::string`s) all do this. `status_led_task` too: its tick copies `std::string`s out
   of `wifi_info()`/`mqtt_status()`/`hp_stats()`, so it can throw under memory pressure, and an
   escape would reboot the board over a cosmetic LED.
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

### The stack: the second budget, and how it was measured

The rules distilled from this history live in [`AGENTS.md`](../AGENTS.md) → "Memory, concurrency,
and HTTP safety"; this is the evidence behind them.

**The STACK is a second, separate budget — and it fails silently.** Everything above is about the
heap; the crash that took v1.0.12 down was a *stack* overflow, and none of the heap rules could see
it. `http_append_status_json()` runs on the httpd task, which had 8 KB; the core dump's task table
read `httpd 7728/460` — 460 bytes off its floor — so it wrote past `pxStack` into its own TCB,
clobbering `pvThreadLocalStoragePointers[0]` with `0x4`, and died ~44 s later inside lwip's
`pthread_getspecific` with a backtrace pointing at an innocent WebSocket send (a transport this
firmware no longer has). Two rules follow:
- **Build long JSON with successive `+=`, never one `a + b + c + …` chain.** A chain materialises
  every intermediate `std::string` at once, all live in the same frame; `+=` holds one at a time and
  takes a bare literal with no wrapper (so it also drops the allocations). http_status.cpp's board /
  presets blocks are the worked example.
- **Read the task table in any core dump you open** (`USED/FREE` per task). It is the only place the
  EXACT figure is visible, and a task can sit one frame from death while every heap number looks
  perfect. Anything under ~1 KB free wants raising — `cfg.stack_size` in http_server.cpp,
  `xTaskCreate` for the rest.
- **…but the trend no longer waits for a crash** (`main/stack_watch.hpp`). Four tasks — httpd,
  hp_poll, mqtt_pub and the HomeHub link — record their own FreeRTOS high-water mark from their own
  loop, and the MQTT heartbeat carries all four as `*_stack_min_free_bytes`. That is the half a core
  dump structurally cannot supply: a dump exists only once the board has died, so the 1200 bytes of
  frame growth measured across legacy-318 accumulated over releases with nothing to see it. A falling
  line in the store is now that warning. It does NOT replace the dump — the sampler reports WORDS
  FREE per task and says nothing about which frame took them — and `0` means NEVER SAMPLED, rendered
  as JSON null at every reporting site (a board with no HomeHub has no such task, and "0 words free"
  would read as one word from death).
`CONFIG_FREERTOS_WATCHPOINT_END_OF_STACK=y` (sdkconfig.defaults) now makes the *first* write past a
limit panic at the offending instruction. IDF's default canary is only compared at a context switch
and a sparsely-writing frame can skip over it — which is exactly what happened here (TLS[1], the
neighbour it would have had to cross, was left intact).

**It happened AGAIN, on the other task, and that is the lesson (legacy-241).** `http_append_status_json()`
ran on TWO tasks — the httpd task *and* `hp_poll`'s WebSocket broadcaster — so raising one stack
fixed half the problem and left the other half to be re-discovered. v1.0.12 raised httpd 8192 ->
12288; `hp_poll` stayed at 8192 until legacy-229 (`health`) and legacy-231 (`history`) grew /status from ~2.2 KB
to ~3.5 KB, and it died with `hp_poll 7664/520` — this time caught *at* the offending instruction by
the watchpoint above (`exccause 0x41 DebugException`), inside a `malloc()` under `Config::Config`,
because `config()` returns a whole `Config` **by value** (~10 `std::string` copies) on the stack of
whoever builds /status. **A builder shared by two tasks is only as safe as its smallest stack** —
check every runner, not the one that crashed.

The SECOND runner is now gone: removing the WebSocket push left /status built on the httpd task
alone, and `hp_poll` went back to 8192, since the builder is precisely what it could not fit.

**And then it happened a THIRD time, on the surviving runner (legacy-318).** ENV III extended the same
builder, and the two signed CI ELFs show exactly what that cost: the httpd handler's FIXED FRAME
grew from 0x2630 (9776) bytes in dev.295 to 0x2950 (10576) in dev.296, leaving 1712 bytes of a
12288 stack for `config()`'s nested `Config`/`std::string` copy, httpd itself and interrupts. The
dev.296 OTA double-faulted inside `config()` with the running task's TCB overwritten, and rolled
back. It is now **16384**, chosen to leave 5808 bytes above the measured frame. Two lessons beyond
the number, both about method: a stack budget is read off the ELF's frame size and a decoded dump,
never off an idle heap reading (an idle board looks fine at every one of these sizes), and the
crash arrived through OTA — the one path where a too-small stack takes down a fleet rather than a
desk. So the rule to carry forward is the general
one, not the numbers: **anything that grows /status grows every stack that builds it**, and a
change that hands a task a large new builder raises that task's stack in the same commit. The task
table in a core dump is still the only place the exact per-frame figure is visible; what the MQTT
heartbeat's `httpd_stack_min_free_bytes` adds is the SLOPE between crashes, which is the signal this
paragraph's own re-measurement had to be performed by hand to find (`main/stack_watch.hpp`).

**Re-measured 2026-08-07 on `main` (f686dff), and the headline margin was the wrong number.** The
builder's fixed frame is now **0x2e00 = 11776** bytes (dev.295 9776 → dev.296 10576 → f686dff 11616
→ 11776 on `main` @ 7524b4c), so 1200 bytes were consumed since legacy-318 with no single change
announcing it — and 160 of them arrived in the two commits merged *during* this measurement. Reproduce it — this is the
prescribed method, off the ELF, never off an idle heap reading:

```bash
scripts/idf-docker.sh bash -c 'A=$(xtensa-esp32s3-elf-nm build/daikin-altherma-esp32.elf | grep " T _ZN4daik23http_append_status_json" | cut -d" " -f1); xtensa-esp32s3-elf-objdump -d --start-address=0x$A --stop-address=$((0x$A+8)) build/daikin-altherma-esp32.elf | grep entry'
```

Two corrections came out of it, and both matter more than the frame number:

**(1) The httpd ceiling is not `h_status`, it is `mcp_post`.** 16384 − 11776 = 4608 reads like the
margin and is not: the frame is one node of a call chain. Walking every `entry a1,N` over the whole
disassembly, the deepest httpd path is `httpd_thread`(32) → `httpd_server`(80) →
`httpd_process_session`(32) → `httpd_uri`(64) → `handle_all`(32) → **`mcp_post`(1456)** →
`http_append_status_json`(11776) → `circulation_source_status`(800) → `config`(48) →
`Config`copy(112) → `_M_construct`(48) → `_M_create`(32) = **14512 bytes**, leaving **~1872** of
16384 — before ISR frames (Xtensa nests them on the current task stack) and before the ~700-byte
`_Unwind_RaiseException` path a `std::bad_alloc` costs *below* the throwing frame. MCP `get_status`
reuses the exact HTTP snapshot builder (mcp_server.cpp), so it pays the builder's frame *plus* its
own — the `/status` route was measured for years while the deeper caller was not. **Measure the
worst PATH, not the biggest FRAME.** The builder is a 3.5× outlier over the next-largest frame in
the firmware (`history_record`, 3296, on the poll task) and nothing else is close.

**(2) Most of that frame is a `-Og` artifact, not live data.** The named locals sum to ~2.2 KB
(`Config` 656 — `const Config& c = config()` lifetime-extends a by-value temporary across the whole
function — `CheckupReport` 332, `WeatherForecastStatus` 208, `ReferenceTemperatureStatus` 168,
`CrashInfo` 164, …). The other ~9 KB is one distinct stack slot per `jstr()`/`std::to_string()`
temporary, because this project builds at IDF's default **`CONFIG_COMPILER_OPTIMIZATION_DEBUG`
(`-Og`)**, which barely coalesces slots across a 760-line function full of EH cleanup regions.
Compiling *only this translation unit* at `-Os` takes the frame **11776 → 3744** and the whole
`mcp_post` path **14512 → 6480** (~9904 free of 16384), with no source change. **This is APPLIED** —
`set_source_files_properties(http_status.cpp PROPERTIES COMPILE_OPTIONS "-Os")` in
`main/CMakeLists.txt`, which carries the full rationale beside the warning contract, and is
per-source-file rather than a `CONFIG_COMPILER_*` key for that contract's own two reasons (a Kconfig
key is global and would re-optimise IDF and the managed components; `sdkconfig.defaults` is hashed
into CI's ccache key). The builder is no longer an outlier at all — 3744 against `history_record`'s
3296. The COST is real and accepted: `-Og`'s precise backtraces are what diagnosed both overflows,
and this is the file whose dumps mattered, so a dump from here is now less exact. A frame two thirds
smaller prevents more dumps than it obscures.

**Verified ON HARDWARE, not just on the ELF.** Both images were built from ONE source base
(`main` @ 7524b4c), signed and USB-flashed to the XIAO bench board in turn — distinct ELF shas
(`de3c4d995` at `-Og`, `14f7fe37f` at `-Os`), each confirmed stable across its own capture.
`/status`, `/status?redact=1`, `/values` and `POST /mcp` `get_status` were captured on both and
compared by JSON PATH: **403 paths on each status surface and 151 on /values, structurally
identical**, with every value difference live-varying state (ENV III drift, the MQTT circulation
witness, heap, RSSI, counters). An `-O` level cannot change semantics for well-defined code, so what
this rules out is LATENT UB that `-Og` happened to mask — the one real risk of the change. Two traps
worth knowing, each of which produced a convincing false alarm first:
- **The bench board OTA'd itself mid-test.** It follows the `dev` channel, and a locally-flashed
  image stamps `1.0.0`, which every `dev.N` outranks — so the board silently replaced the build
  under measurement with the CI one, rebooted (`esp_restart()` after install → reset reason **`sw`**,
  `last_crash: null`) and made a clean stress run read as a crash. Guard every on-hardware
  comparison by reading `app_elf_sha256` BEFORE and AFTER, and treat a changed sha as a void run.
- **Flashing an older build onto an OTA'd board opens the setup portal.** The dev build had already
  rewritten NVS in a NEWER config-blob version, and the older image correctly REFUSED it (the
  exact-length/CRC rule) instead of misreading it — no credentials, so `provisioning.cpp` opened the
  AP. That is the blob contract working, not a fault: rebuilding from the matching base restored the
  board from its own intact NVS with no password re-entry. Only serial shows this (an AP-mode board
  withholds `/diag`), and `cat /dev/cu.*` drops the log often enough to read as a dead board — use
  pyserial.

**Splitting the builder into helpers is the weaker lever, and the measurement says so.** Extracting
the already-braced `health` block dropped the frame 11616 → 11184 (−432; measured on the f686dff
base, before the two commits that took the frame to 11776) but the standalone helper
costs 736, so the *peak* got 304 bytes WORSE; adding `history` gave 10816 + max(736, 496) = 11552,
i.e. 64 bytes better than where it started. The frame is a SUM of block contributions while the peak
is `builder + max(helper)`, so extraction only pays once ~10 blocks are out (~4 KB, extrapolated) —
a large mechanical edit to the most stack-critical function in the firmware, for half of what one
build line buys. **`cfg.stack_size` stays 16384 and was deliberately NOT raised**: 4 KB of permanent
RAM on a board whose binding limit is the largest CONTIGUOUS free block, spent on a compiler
artefact, while `-Os` buys twice as much for one line. Should the `-Os` scoping ever be reverted,
the stack must go to 20480 in the same commit — ~1872 bytes measured before ISR and unwind demands
does not leave enough margin over `AGENTS.md`'s roughly 1 KiB action threshold.
