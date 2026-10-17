# Production HTTP deadline runtime fixture

Run `node test/test_http_deadline_runtime.mjs`. The wrapper compiles and executes the entire
`main/http_deadline.cpp`, including its real RAII guard and deadline arithmetic. Every scenario
uses a separate process because the boot-owned watchdog intentionally never retires. Builds and
mutations live in a unique temporary directory and are removed after the run.

The SDK-shaped adapters control semaphore creation/registration failures, timer creation/start/stop,
notification delivery and socket shutdown. Host threads run the real watchdog and owner separately.
For queued/running callbacks, the fixture pauses shutdown before its acknowledgement and verifies
that disarm/destruction, descriptor withdrawal, close and reuse cannot overtake it. Other cases cover
boot failure latching, original deadline remainder and wrap, exclusive ownership, stale acknowledgement
draining, destructor cleanup, `ENOTCONN` and fail-closed shutdown/stop/acknowledgement errors. C++
allocations inside the real timer callback are counted.

The original production source at `28223041fb3f6e5e849e4d3695df2142d15040b5` passes the ordinary
stop/disarm positive control and fails the unregistered-semaphore regression case. The wrapper also
compiles defense-removing mutations and requires the selected behavioral assertion to reject each
one. Compilation failures, unknown aborts, signals and timeouts never count as successful controls.
Expected fail-closed cases observe the production `std::abort()` and verify the descriptor remains
owned before accepting the abort.

This proves host behavior under controlled SDK responses. It does not execute ESP-IDF's actual
timer/RTOS/lwIP implementation or prove scheduling bounds, ESP32 heap/stack margins, a live TLS
trickling peer, NVS persistence or board behavior. The semaphore registration failure is an adapter
model of the pinned SDK path, not a live `pthread_setspecific` failure injection.
