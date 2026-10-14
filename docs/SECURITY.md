# Security model

The device is intended for a trusted home LAN. It reads X10A and an optional HomeHub and exposes
observations without user authentication. [API.md](API.md) owns request/field contracts;
[MAINTENANCE.md](MAINTENANCE.md) owns build, publication and authorized delivery procedures.

## Trust boundary

| Surface | Protection and limit |
|---|---|
| Device HTTP/UI | No authentication or TLS. Anyone reaching the operational LAN API can read data and change device configuration. Never expose port 80 directly to the internet. |
| Browser requests | LAN Host must name the fixed mDNS hostname or current WiFi/Ethernet IPv4 address. Present Origin is checked independently; cross-site/unknown Fetch Metadata is refused. Body-bearing POSTs require JSON. Native clients may omit browser headers; a supplied Host must still match. |
| Open setup AP | Unauthenticated `daikin-altherma-esp32-setup` exposes provisioning only. Nearby clients can submit WiFi credentials, but cannot read live state, logs, dumps or the full config/OTA/MCP API. The captive GET fallback serves setup; withheld POSTs are 404. |
| Ethernet | A wired boot with a lease starts no setup AP. The HTTP surface follows whether an open AP is running, not STA mode or the existence of a cable. Registration is server-wide, not per-interface. |
| LAN discovery | DHCP/mDNS announce product, root HTTP path and version, never board identity, MAC/serial, SSID, broker or configured services. |
| X10A/HomeHub | Both are read-only. No Modbus write builder, command subscription, writable HA entity or raw Modbus proxy exists. `/hp/query` can issue only an X10A read. |
| HomeHub itself | Its Modbus TCP port has no protocol credential or encryption. Other LAN clients can write it. Restrict port 502 to intended clients; this firmware cannot secure other clients or the hub. |
| MCP | LAN-only stateless read tools, using existing snapshots. No session, SSE or write tool. Its setup page uses `connect-src 'none'`. |
| MQTT | Stored credentials require `mqtts://` or `wss://` with common-root certificate verification; plaintext with credentials is refused. An anonymous broker may use plaintext on the trusted LAN. Uncovered/private roots are rejected. |
| Syslog | Optional cleartext unauthenticated UDP. Logs plus boot/crash summary reveal operational metadata, version and code addresses, but do not export raw memory or credentials. Use a trusted collector. |
| Weather | Explicit location plus diagnostics consent permits provider HTTPS requests, disclosing coordinates and source IP. Removing/replacing a source clears old decision/retained evidence. |

Use network isolation where access control is required. An authenticated reverse proxy is a separate
security boundary: it must also handle CSRF and send an allowed upstream Host without forwarding
an external Origin or cross-site Fetch Metadata. A plain port forward supplies none of that.
The device guards browser-origin attacks; they are not LAN-client authentication.

Config, MQTT and Weather JSON ingress permits one complete document, at most 16 container levels,
no raw or decoded NUL or trailing non-whitespace. HTTP body acceptance has a 30-second absolute budget;
unread-body cleanup admits receives for two seconds and checks its 8 KiB cap after each 128-byte
read. One in-progress read can add a socket timeout and the cap can reach 8 KiB + 128 bytes.
Beyond those bounds the connection closes. During active OTA or below a 6,144-byte internal block,
the common guard refuses every non-OTA route, including assets and both `/diag` forms.

The two transient HIL HTTPS headers on `/ota/check` add outbound-HTTPS/SSRF capability for trusted
LAN clients. They carry no controller bearer token/device credential, cap URLs at 255 bytes and
still require trusted images. They must remain unavailable on the setup AP.

## Credential storage

WiFi/MQTT credentials are in `daik_cfg` NVS, unencrypted by default. Physical flash access can read
them. Hardware Flash Encryption, NVS Encryption and Secure Boot eFuse changes are separate,
potentially irreversible deployment decisions; the official software-signing scheme burns no eFuses.
Do not confuse signed OTA with encrypted storage or authenticated HTTP.

## OTA image signing

The running app requires Secure Boot v2 RSA-3072 signatures without hardware Secure Boot. Initial
signed USB/browser installation establishes the signing identity; later OTA must use that same
identity. The bootloader does not perform hardware Secure Boot verification. An unsigned application
aborts before `app_main`, so application-level recovery cannot intercept it.

An accepted install captures a completed check generation, channel, version and application SHA.
The worker re-fetches that feed, verifies the same manifest identity, checks the image's embedded
version before writing, hashes the complete download and validates its signature before selecting
an inactive slot. A valid signature alone does not prove freshness: numeric SemVer comparison
(including dev identifiers) refuses an older/equal or unparseable version. Explicit per-request
`downgrade=1` allows an older channel-switch target, never an equal version, and changes no digest
or signature condition.

### Heap and transport bounds

- The delivery worker's 11,776-byte stack/control block is boot-static. OTA quiesces complete MQTT
  transport and allocation-rich X10A/HomeHub/Syslog work before network allocation; active Weather
  unwinds within a bound. A 1.1-second lead allows a running publisher cycle to finish.
- Before each manifest/image TLS handshake, four samples require **56 KiB free internal heap and
  a 24 KiB largest internal block**. TLS admission waits at most 15 seconds. Free the client and
  1 KiB transfer buffer before RSA/PSA validation; each validation admission takes two **24/12 KiB**
  samples with a five-second limit. Both end-image and boot-selection validation remain enabled.
- Monotonic deadlines are 30 seconds for manifest/changelog and five minutes for firmware. Client
  open timeouts are six seconds for changelog, 15 for manifest/image; socket watchdog protection
  begins only after successful open, covering both headers and body. The boot-static worker performs
  shutdown and joins before socket reuse. Timer/task/lwIP-prime failure disables downloads for the boot.
- Only allocator-shaped setup failure gets one cleaned-up retry. A validated known-length prefix
  may resume at most twice inside the same accepted generation/deadline. Each resume needs fresh
  heap admission, HTTP 206, one exact Content-Range and matching remaining Content-Length, and must
  commit new bytes before another reconnect. Chunked/200/416 or ambiguous range metadata aborts.
- The existing sequential OTA handle and hash bind every byte across a resume. No failed host update
  POST is repeated. The ten-minute stale-quiesce cap exceeds valid transfer and observer budgets.

The default dynamic TLS-record strategy remains selected; `HTTP_TLS_DYN_BUF_RX_STATIC` is not enabled
because the pinned SDK's reported TLS-1.2 invalid-free/assert risk is unresolved. This is a retained
implementation constraint, not a claim about a future SDK.

`ESP_ERR_OTA_VALIDATE_FAILED` covers image structure, digest/signature and verifier allocation
failure. The UI states “image validation failed”; diagnostic heap/error samples permit investigation
without guessing which cause occurred.

### Optional changelog

`changelog.json` is display text, never artifact authority. It must come from the selected manifest's
HTTPS directory without redirects, fit 1025 bytes and exactly match the offered version. CI includes
only normalized allowed user-facing commit subjects, excludes authors/bodies/private metadata and
bounds cumulative dev history. The sole migration seed is bound to a reviewed exact source/version.
A changed dev core requires an ancestry-verified stable baseline; invalid provenance/overflow fails
publication. Missing/malformed notes change only explanatory copy.

Firmware decodes notes in one transient slot, selects the newer range only after TLS cleanup and
releases it after first response, a 60-second expiry or the next operation. Notes allocation/headroom
failure leaves the signed offer usable. API generation checks prevent stale text being attached to
another offer. Source commit subjects selected for the public feed must contain no private detail.

## Boot recovery (anti-brick)

| Delivery/failure | Recovery boundary |
|---|---|
| OTA receives unsigned/tampered data | Validation fails before boot selection; running slot remains selected. |
| OTA boots a signed but broken candidate | Pending-image probation can roll back to the previous valid slot. |
| Signed but older image | Manifest and embedded-version checks refuse it unless the caller explicitly requests a channel downgrade. |
| Direct USB/Web Serial writes a bad image | No automatic rollback promise; prevent it with trusted signed artifacts and the flash guard. ROM USB recovery remains available. |

A full `@flash_args` flash rewrites bootloader/table/otadata and writes `ota_0` directly. There is no
recorded previous-slot lease. The authoritative IDF
[`esp_ota_get_state_partition()`](https://docs.espressif.com/projects/esp-idf/en/v6.1/esp32s3/api-reference/system/ota.html#_CPPv427esp_ota_get_state_partitionPK15esp_partition_tP20esp_ota_img_states_t)
returns `ESP_ERR_NOT_FOUND` (not `PENDING_VERIFY`) for blank/no-record otadata. Status preserves
`image_state:"unknown"` and `rollback_pending:null`; unknown cannot prove rollback absent.

`scripts/require-signed.sh <app.bin>` checks signature-block CRC, full image digest, RSA-PSS/SHA-256,
RSA-3072/exponent and the pinned public-key digest. Run it immediately before every authorized flash.
CI applies it to the staged app before publishing browser parts. Unsigned PR builds are diagnostic
artifacts only. Recovery from a directly flashed bad image requires a trusted signed USB image.

The browser binds the raw manifest to `artifacts.json` by SHA-256 and verifies every selected part's
indexed size/hash before erase or write; the app hash also matches provenance. Files remain within
the selected HTTPS directory, without redirects, duplicate metadata or substituted plans. WebCrypto
is required. Browser hashes prove byte identity, not RSA validation; the producer validates the
staged signature. The sparse plan binds bootloader `0`, table `0x8000`, OTA data `0xf000` and app
`0x20000`, excluding rounded erase sectors for NVS, dump and history. Installation rechecks ESP32-S3
and recognized flash of at least 8 MB, using `flashSize:"keep"`.

Sparse browser parts and ordinary `flash_args` leave `nvs@0x9000` and the history journal untouched
without Erase. Erase is a deliberate factory reset; the separately published merged image also
writes its gap through NVS. OTA never installs a partition table. Signed bootstrap/recovery and
partition migrations are described in [MAINTENANCE.md](MAINTENANCE.md#signed-usb-bootstrap-or-recovery).

<a id="the-health-gate-mode-1"></a>
### Rollback health gate

Only a recorded `PENDING_VERIFY` image arms the health task. After about 90 seconds, normal service
must simultaneously show:

- active WiFi/Ethernet IP link;
- at least 24 KiB free internal heap and 16 KiB largest internal block;
- no inherited heap-restart evidence or skipped MQTT/poll allocation cycle;
- if X10A is live and MQTT configured, one retained X10A state accepted by the MQTT client.

The recovery exception is a provisioning portal that is actually running. Stored credentials or
an Ethernet lease lost after boot do not prove a recovery surface. Missing proof at about ten
minutes deliberately restarts while still pending, allowing rollback. Blank USB otadata leaves
unknown state and does not arm this task. Host decision tests do not prove physical rollback.
Its aligned 4,096-byte stack and task storage are reserved statically at boot and armed once.

<a id="trusted-release-construction-and-separate-hardware-acceptance"></a>
<a id="role-pinned-maintainer-ota-gates"></a>
### Publication and hardware acceptance

The trusted builder holds signing material with no repository-write permission. The separate
publisher holds write permission with no signing secret and revalidates the artifact handoff.
Manual `release:true` publication skips the PR mechanical suite, builds once, publishes the feed
and creates the exact-source tag/Release. It contacts no board and includes no hardware acceptance.
Published Pages bytes remain public even if repository source is private.
An equal-version publication resume requires the original source and complete original offered
bytes, including signature, index and changelog. Rebuilding the same source is insufficient;
recover the original handoff or publish the next version.

Authorized bench and production gates separately bind inventory roles, exact artifacts, source,
current version, observed verifier/heap/stack evidence, probation and pressure. The canonical
commands and their abort behavior are in [MAINTENANCE.md](MAINTENANCE.md#role-pinned-ota).
Running version plus ELF build id is not cryptographic readback of complete flash. Host/CI,
artifact identity, injection, reboot, API and rendered UI evidence must be reported separately.

<a id="config-crash-loop-recovery-safe-mode--a-distinct-failure-class"></a>
### Configuration recovery

Crash-loop and heap-watchdog safe mode retain network/HTTP recovery while omitting optional plant
workers. The guard runs after NVS initialization and its static lock, before Netif, OTA and config.
Four crash boots latch recovery; ten minutes of uptime clear the crash count only outside latched
safe mode. Heap-watchdog restarts are counted separately and neither count is cleared by the
other's resets; only a clean boot (any non-crash reset other than the watchdog's own) clears both,
and a clean boot never comes up in heap safe mode.
NVS initialization errors never erase the partition automatically. Failed initialization disables
WiFi-driver NVS before driver startup; STA/AP credentials use RAM storage every boot.
Mandatory-startup or persistence failures remain outside the recovery guarantee, as does an unsigned
image failure before `app_main`. `safe_mode_cause` distinguishes heap from crash loop.
Recovery is best effort and adds no endpoint or privilege. Factory reset is destructive and must
complete all configured data erasures, including the MQTT retirement record, before declaring
success; it keeps only the board hardware statement, and no other restart runs while it erases.

## Signing key lifecycle

The private RSA-3072 PEM stays offline and is never committed or inspected by agents. CI materializes
`OTA_SIGNING_KEY` only in the trusted builder; an `always()` step runs `rm -f ota_signing_key.pem`.
That is ephemeral workspace cleanup, not secure storage-media erasure. Missing signing material
fails trusted publication. PR builds have no signing secret and publish no flashable images.

`tools/release/ota_signing_key_digest.txt` contains only the reviewed public-key identity. Build,
handoff, manifest and flash checks require it. Rotation requires a deliberately authorized new
key, updated reviewed digest/CI secret and signed USB adoption on every old-key device. Updating
only the secret or only the digest fails continuity. Do not read, print, copy or stage private keys;
an authorized signing invocation passes the offline key by path without wrapping unrelated commands.

## Report redaction contract

`GET /status?redact=1` redacts the following 28 identifying fields at emission, with `<redacted>`
for set identifying values. HVAC mode preserves only its allowlisted public vocabulary; unknown
source text is hidden without changing control evaluation.
Unset strings remain empty, unset coordinates null; keys/types and configured-source evidence stay
present. The dashboard uses ordinary unredacted status. `main/logic/redact.hpp` owns the ordered
machine contract; the redaction audit compares it with this table and the serializer.

<!-- redacted-status-fields:start -->
| Field | Why it goes |
|---|---|
| `wifi.ssid` | names your home network |
| `wifi.ip` | your internal address |
| `wifi.bssid` | your router's radio address — locatable in public databases |
| `wifi.mac` | identifies this specific board |
| `mqtt.broker` | may contain credentials if they were typed into the URL |
| `mqtt.base` | is user-typed and becomes the installation's Home Assistant device id |
| `net.ip` | the active transport's internal address |
| `net.eth.ip` | the wired interface's internal address |
| `net.eth.mac` | identifies this specific wired controller |
| `reference_temperature.name` | a name you typed, usually naming a room or a person |
| `reference_temperature.topic` | a path through your own broker — normally carries a room or device name |
| `reference_temperature.temperature_path` | user-typed JSON path; may contain room, person or device names |
| `reference_temperature.setpoint_topic` | a second broker path when the target temperature is published separately |
| `reference_temperature.setpoint_path` | user-typed JSON path; may contain room, person or device names |
| `reference_temperature.timestamp_topic` | a second broker path when the source timestamp is published separately |
| `reference_temperature.timestamp_path` | user-typed JSON path; may contain room, person or device names |
| `reference_temperature.enabled_path` | user-typed JSON path; may contain room, person or device names |
| `reference_temperature.hvac_mode_path` | user-typed JSON path; may contain room, person or device names |
| `reference_temperature.hvac_mode` | unknown source text may contain private names; known mode vocabulary remains visible |
| `circulation_source.name` | a name you typed for the circulation-pump meter |
| `circulation_source.topic` | a path through your own broker — normally embeds the smart plug's device id |
| `circulation_source.power_path` | user-typed JSON path; may contain room, person or device names |
| `circulation_source.timestamp_path` | user-typed JSON path; may contain room, person or device names |
| `weather_forecast.latitude` | where your house is, to six decimals |
| `weather_forecast.longitude` | the other half of the same |
| `syslog.host` | an internal hostname |
| `ntp.server` | often an internal hostname too |
| `modbus.host` | your saved HomeHub address, whether found automatically, typed manually or filled by manual Search |
<!-- redacted-status-fields:end -->

Redacted `/diag` scrubs identifying interpolations line by line. Build identity, model, signal
strength, liveness, counters, heap and uptime remain because they diagnose firmware behavior.
`/ota/status?redact=1` hides effective feed URLs, preserving unset empty values. Oversized redaction
query/flag values return 414 before private snapshots. Diagnostic identifiers are bounded/escaped;
wrapped or clipped tails discard incomplete privacy spans rather than exposing them.
No automatic redaction makes user-written issue prose private; inspect the finished report.

## Reporting

Use [private vulnerability reporting](https://github.com/0Bu/daikin-altherma-esp32/security/advisories/new)
for exploitable issues and requested raw coredumps. Dumps contain task/RAM memory and may hold
credentials even when heap capture is disabled; never attach them to public issues. Keep the
matching version/ELF identity and preserve evidence before an authorized deletion.
Current reset/fault describes this boot; stored task/PC/backtrace/ELF has unknown age and relationship
to that reset even when the ELF matches. Proven foreign dumps stay on flash but their download and
summary are suppressed for this boot. Missing or malformed identity stays unresolved. The decoder
checks raw integrity and one valid 72-byte SDK identity note before build association and GDB.
Syslog replay repeats stored provenance; its timestamp does not date that incident.

Non-sensitive bugs and hardening suggestions use ordinary [issues](https://github.com/0Bu/daikin-altherma-esp32/issues)
and [REPORTING.md](REPORTING.md). Include version and applicable build id. The documented trusted-LAN
access model is intentional; there is no bounty or response-time guarantee.
