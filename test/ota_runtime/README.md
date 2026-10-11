# Production OTA host fixture

`node test/test_ota_runtime.mjs` compiles the complete current `main/ota_update.cpp` with the real
project headers. SDK and external service adapters supply a deterministic clock, HTTP bodies,
resource ledgers and task notifications. The production worker, manifest parsing, image identity
checks, range-resume orchestration, ownership guards, network lease and health task execute directly.
No production function body is copied into the fixture.
Successful original, chunked and resumed streams preserve exact byte order in independent write/hash
ledgers; a wrong resumed range, premature chunked EOF and body deadline failure cannot select boot.

The cases check ordinary SDK null/error returns and separately labelled C++ unwind injections at
resource-owning boundaries. The latter deliberately throw `std::bad_alloc` through host adapters;
ESP-IDF C functions do not throw. They test ownership during future C++ allocation failures rather
than claiming that an SDK call has that hardware failure mode. The long-version probe uses a
rejecting global `operator new` against the actual production helpers.

Every acquired client is closed and cleaned exactly once after its socket deadline is disarmed;
buffers, open OTA handles and active PSA operations have independent ledgers. Ordinary failure and
unwind cases must release the busy/network lease and request MQTT resume. The adapter consumes an
OTA handle on every `esp_ota_end` return, including validation failure. Seven health cases invoke the
actual task and check unknown/valid/unarmed states, the 90-second minimum, the 600-second hard cap,
failed marking and failed task creation. Additional cases drive the real heap, allocation-failure,
X10A publication and recovery-portal input wiring. Probation can refuse `esp_ota_begin` before a
handle is acquired. Each optional owner acknowledgement is stalled separately.
The restart adapter records the request and returns so the fixture can inspect state; the success
case's later worker cleanup is a synthetic continuation, not evidence that hardware resumes before
reboot. Failed task creation checks preservation of a pre-seeded pending latch, not bootloader rollback.

Independent source mutations must compile and fail their named behavioral assertion. A crash,
timeout, compilation failure or unrelated failure is not a passing negative control.

The HTTP transport, timer dispatch, heap measurements, PSA digest and IDF image verification are
adapters. The digest adapter checks byte continuity and supplies a fixed expected digest;
it does not prove SHA-256 or signature security. Host image structures model the public descriptor
fields used by this component. This fixture does not prove target structure layout, real flash/NVS
preservation, socket-watchdog timing, allocator minima, rollback across reboot, WiFi/MQTT recovery,
physical X10A behavior or rendered UI. Pinned ESP32-S3 builds, signed-image verification and separate
authorized bench/production acceptance remain required.
