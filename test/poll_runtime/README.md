# Production poll runtime fixture

`run.py` compiles the complete selected `main/hp_poll.cpp`, `hp_convert.cpp`, generated profile
tables and production logic headers. Cases run as separate processes, so static caches, detection
tallies, saturation carry, tickets and the boot capture budget do not leak between cases.

- `oom_raii` keeps the original seven task iterations, real reserve/copy allocation failures,
  cache aging, quiescence, recovery and mutex-unwind checks and their six semantic controls.
- Detection cases feed the real `poll_detect()` with independent adapter sweeps: adjacent agreeing
  incomplete results, silence, no-match, changed representatives and an in-flight generation change.
  A real allocator failpoint after an allocation-free result return targets the production profile
  copy. Another armed at link-commit return requires allocation-free by-value model arguments with
  their exact profile and synthetic long EEPROM contents. Adapter bookkeeping runs after disarming.
  The config adapters record owned link/model calls; they do not implement NVS or config persistence.
- Saturation cases populate the shipped monobloc profile with RPS 42, zero liquid temperature and
  pressure bytes that its actual R32/405 decoder resolves to approximately 49 C. They distinguish a
  recent witness from quiescence, reserve OOM, UART-init failure, a long gap, an absent witness page
  and a newly cold witness. Synthetic bytes are software input, not physical measurements.
- Probe cases execute both `hp_probe_run()` and `poll_probe_service()`. Binary-semaphore callbacks
  advance a synthetic monotonic clock. One joined host thread pauses the real old service at the
  UART adapter: A times out, B arms its slot, then A completes before B. The same schedule runs
  across the 24-bit ticket wrap. Separate cases cover no task, busy, a drained old wake and repeated
  foreign wakes against the absolute deadline.
- Raw-capture cases require actual successful 0x10/0x20 payloads, test recovery after both are absent,
  one available page, the 32-byte line bound and at most eight successful rounds per boot.

Every semantic mutation must compile and fail its named oracle. Compile commands, complete input
hashes, case results and mutation output are retained in the printed temporary `evidence.json`.
`--sanitizer undefined` applies UBSan to the same fixture; `--case` selects focused cases.

For comparison with a frozen older tree, use `--root /path/to/archive --no-mutations`. The explicit
`--expect-failures` mode accepts only the listed historical regression oracles and cannot run
mutations; ordinary gate runs require every case to pass.

SDK mutexes, scheduling, UART transport, stores, flags and sampling remain adapters. This fixture
does not prove ESP32 heap/stack margins, RTOS race timing, physical protocol replies, durable history
or NVS persistence. Device acceptance remains a separate delivery step.
