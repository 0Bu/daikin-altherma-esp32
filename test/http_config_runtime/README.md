# Configuration HTTP runtime fixture

Run `node test/test_http_config_runtime.mjs` after the pinned dependency resolution has populated
`managed_components/espressif__cjson/cJSON`. `--real-cjson /path/to/export` accepts an unchanged
resolved export; `--sanitizer undefined` adds UBSan. The runner verifies the 1.7.19~2 lock/API and
compiles complete `main/http_config.cpp` and `main/http_ota.cpp` with the real cJSON implementation,
shared JSON ingress, pure validators and `config_save_transaction`. It invokes the actual setter
handlers and `ota_do`, rather than extracting or rewriting their decisions.

CI runs the complete matrix with its default GNU C/C++ pair and again with
`CC=clang-18 CXX=clang++-18 python3 test/http_config_runtime/run.py --sanitizer undefined`.
GCC 13's UBSan rejects the inline constexpr
profile-table assertions because of [GCC PR71962](https://gcc.gnu.org/pipermail/gcc-patches/2025-July/688469.html).
Clang keeps every assertion and the full UBSan instrumentation; no null-check override or sanitizer
suppression is used. The sanitized runner also compiles a deliberate signed overflow into a copied
setter and requires a nonzero exit with the matching UBSan diagnostic before that setter can pass.

The fixture covers all 54 documented fields and all 13 setters. X10A and HomeHub use separate
`/set_hp` rows because they own different durable entries. Every row exercises valid, invalid and
missing inputs, route-owned write failures, response JSON, runtime changes and reboot behavior.
It also tests unchanged requests, valid byte boundaries, quotes/backslashes/Unicode, object roots,
raw/escaped zero, transport failures, preflight rejection and exact downgrade-query semantics.
Unknown fields retain the existing forward-compatible behavior.

| Setter | Validation and missing-field contract | Success effect |
|---|---|---|
| WiFi | SSID 1–32 bytes; pass empty or 8–63 bytes; absent pass means open network | Service save and reboot; re-save rearms trial |
| MQTT | String fields, boolean credential clear, base/URI rules and broker preflight; absent broker disables, empty credentials keep, absent base keeps | Service save and reboot; unchanged skips probe/save |
| Reference temperature | String mappings, fixed-target precision/bounds, integer age; absent topic disables; old single-topic fallback preserved | Service save and live rebind; unchanged still rebinds |
| Circulation | String mappings, numeric thresholds/age/confirmation and current proof; absent topic disables without proof | Service save and live source update |
| Diagnostics | Required boolean consent; unchanged is a no-op | Service save, new generation (random draw from 0, then +1) and live producer resets |
| X10A | Optional profile and exact integer GPIO patch; board/protocol/pin validation; mixed HomeHub request rejected | Link-only save, bounded stale retries and live resets |
| HomeHub | Optional string host/integer port/unit; host ≤512 bytes, port 1–65535, unit 1–247 | Service save and separate Modbus/history/retained cleanup |
| Syslog | String host, integer port/range; absent host disables, port defaults 514 | Service save and reboot; unchanged is a no-op |
| NTP | String server; absent/empty restores compile-time default on load | Service save and reboot; unchanged is a no-op |
| Weather | Strict string coordinates and optional boolean refresh; both absent/empty disable | Service save and live transaction, or nonpersistent refresh token |
| Board | Optional typed identity/peripherals/ENV fields, board/pin/preflight rules | Service save; identity-only needs no reboot, hardware changes reboot |
| ENV III | Optional boolean enable/integer SDA/SCL patch, same preflight as board | Service save and reboot for a real change |
| OTA channel | Required supported string enum | Service save, applied on next check, no reboot |
| UI language | Required supported string enum | Service save, applied on next UI poll, no reboot |

A failed route-owned write must return `500 {ok:false,error:...}` without live publication,
reboot or runtime reconfiguration. The recording store calls the current production transaction:
atomic entries are independent, service saves require `cfg` and treat link-cache
maintenance as best effort, while X10A saves write only `link`. Entry failures here are simulated;
this fixture does not expand CFG-03's physical evidence claims. Response/store capacities are staged
before execution so the C++ allocation witness can observe the real endpoint's post-write path.

Concurrent detection cases execute `config_commit_detected_link_transaction` between the handler's
snapshot validation and `config_save_transaction`. A newly detected RX/TX collision with a requested
indicator, button or ENV III pin must return 409 without an HTTP write, runtime change or reboot;
the independent detection cache write remains intact. Adjacent noncolliding detections must save
and reboot normally, while a genuine service write failure after reconciliation must still return
500. The conflict response uses the allocation-free link snapshot adapter instead of another full
configuration copy. The six rebooting setters also execute the real delayed restart with a reset
latch introduced during its 400 ms response window: the save and response already succeeded, but
the reset then owns the restart. An unlatched window still restarts, and a latch already set holds it.

The consent-generation group starts from the default generation 0 with a fixture-controlled
`esp_random()` adapter. The first opt-in must persist that exact draw in the service entry, RAM and
the live checkup producer; each re-toggle advances by one without a new draw, an unchanged request
draws nothing, and a zero draw still yields a non-zero generation. Compiling mutants that pass 0 instead of the draw,
discard the draw's value or take a fresh draw on every transition must fail this group.

The immutable original HTTP source at `819a2c98ad7e331ce1527ca85f4acb7127e55734` must pass positive
setters and fail the two specific regressions: a present wrong type taking missing-field semantics,
and a fractional integer being truncated. It predates the two-argument generation helper, so the
runner rewrites its one call with entropy 1, which reproduces the original one-argument result for
every generation; the evidence records both the original and the adapted source hash. Additional
compiling mutants independently remove type, missing-value, persistence, runtime ordering, probe,
domain, query, ingress, post-delay reset, reconciliation and generation-entropy defenses. Both
compiler runs retain sixteen groups, 5,517 assertions and 25 compiling controls; the original
thirteen groups retain all 5,233 assertions. The three additional groups cover integration with
detection, reset and the consent generation. Only the selected assertion counts as rejection;
compilation failures, crashes and timeouts never do.

Unique temporary output directories retain `evidence.json`, `commands.txt`, binaries, mutation
sources and `inputs.sha256`. The baseline manifest hashes every non-system compile input and rejects
input changes during the run. Evidence records both compiler versions, command names and the
sanitizer tripwire's commands, source hash and result. Hardware network/sensor access is replaced by
recording adapters.

Limits: no real NVS failure, power-loss durability, RTOS scheduling, live MQTT authentication, sensor
measurement, physical source behavior, ESP32 heap/stack margin or rendered UI is proven. HTTP body,
reply and service adapters do not execute the shared LAN/OOM trampoline; that belongs to the server
fixture. The reset latch and link snapshot are recording adapters, and a reset does not erase any
storage here. This fixture passes no load-yield record to the transaction; production `config.cpp`
and its `s_load_yield` lifecycle and stored yielded pins remain CFG-03's evidence responsibility.
The OTA HTTP query test records an update handoff and never downloads or installs firmware.
