# HomeHub production runtime contract

`test/test_modbus_runtime_contract.mjs` is discovered by `scripts/run-contract-tests.sh`. It compiles the complete current `main/hp_modbus.cpp` inside `fixture.cpp` and runs transport, polling, cache, status, configuration-cutover and task-lifecycle cases. No production source copy or extracted implementation is stored here. Each single-invariant mutation is written only to the runner's temporary directory and must fail its specific runtime oracle.

The project headers, register tables, pure logic and `SemGuard` are real. The socketpair, `send`, `recv`, stream fragmentation, EOF and per-call timeouts use host POSIX sockets. The send/recv wrapper forwards to libc and optionally advances controlled SDK time: immediate sends plus 1499 ms for prefix and body each model the successful final receive overrun admitted by the transport deadline. Real deadline/trickle tests use `steady_clock` and disable that model.

SDK/mDNS, config/history, OTA/weather and RTOS scheduling are adapters. Task creation queues a callback; lifecycle cases execute the production callback with changes scheduled at task-delay or watchdog-delete boundaries. Mutexes are real host mutexes. Watchdog checks record production feed sites without resetting a device. Discovery uses64 unresolved matching responders and charged SDK timeout budgets; the complete operation must finish within 17 seconds of controlled time.

The contract proves host-executed production behavior. It does not prove ESP32 compilation, physical HomeHub/mDNS behavior, target heap/stack margin, NVS persistence, OTA, or dual-core RTOS scheduling.

The runtime cases also check both public profile accessors after a rejected stale socket writer, target-generation cutovers at the final full/fast status boundary, a complete poll/cache commit at monotonic time zero, and early inputs38/44 already expired when a long sweep finishes. Separate mutations that stamp these inputs with sweep completion must fail their own runtime oracle.
