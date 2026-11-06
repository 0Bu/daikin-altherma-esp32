# Shared journal append runtime fixture

This fixture compiles the complete production `main/history.cpp` translation unit and separately
compiles the real `main/stop_observation_store.cpp`. The local ports provide only SDK mutexes,
clocks, partition transport and external service boundaries. There is no hydronic production
dependency and no extracted or rewritten production body in the baseline build.

Run from the repository root:

```sh
python3 test/history_journal_runtime/run.py --sanitizer undefined --out /private/tmp/stop-journal-run
```

An explicit output directory must be new; otherwise a private temporary directory is created.
It retains compiler commands/version, each translation unit's
MMD dependencies, dependency hashes, production snapshots, binaries, per-case stdout/stderr and
a JSON receipt. Each case is a fresh executable process. `--expect-red` requires the original
claim-release oracle to fail. `--expect-red --expect-red-case late-correction` instead runs the
paired seed/restore witness and requires the named acknowledged-correction oracle to fail in the
fresh process. A compiler, setup or sanitizer failure never counts as an expected RED. Historical
RED receipts retain the source and fixture hashes from the respective pre-fix execution.

The 24 baseline process cases cover:

- Regular public Start/bind/record/seal calls creating one Stop population. Consent changes create
  reset barriers; the fixture never seeds private Store observations, claims or latches.
- Data and barrier append failures during slot-preparation reads/erases, body program and commit
  program, followed by the actual shared journal service retry and exactly one committed record.
- A failed verification read after accepted commit, kept explicitly unverified until retry. This
  test observes transport bytes separately and does not treat the original error as proof of no
  physical commit. Every valid append attempt reserves a unique sequence before any flash I/O,
  including preparation/program/verification failures; gaps do not acknowledge data. Verified
  readback alone decides the claim receipt. Retries use a new sequence and count the population once.
- A non-sector-first unverified commit after a real Core append, followed by an ordinary late Stop
  correction and real service retry in the next sector. Both physical revisions survive. A fresh
  executable process loads only the synthetic NOR bytes, runs the actual History scan and Store
  reconstruction, and must retain the same acknowledged corrected population.
- Accepted commit followed by a transport error, with valid readback deciding success and retiring
  the exact claim. No subsequent duplicate append is permitted.
- Core cursor/ahead state established by its real builder, append and future-cursor helper. A Stop
  success must preserve the independent Core cursor and ahead episode.
- The real Stop flash reader rejecting an ERASED request and corrupted committed payload, while
  accepting the exact committed, CRC-checked population. Append ownership is never read admission.
- NOR programming that rejects zero-to-one changes and requires exact aligned erase ranges.
- Core preparation/readback failure and accepted commit-error cases exercising the shared sequence
  contract and exactly one Core acknowledgment. Zero, out-of-order and already consumed requests
  must be rejected before all flash I/O. Exhaustion arithmetic is covered by the separate pure
  logic tests; this fixture does not modify private counters to manufacture an exhausted runtime.

Five independently compiled History mutations remove the failure callback, restore the erroneous
read-header classifier, clear the Core ahead episode after Stop success, or trust a commit error
over valid readback. The fifth restores success-only sequence consumption: data/barrier/Core
reservation oracles must fail, and a passing paired seed followed by a fresh process must lose the
acknowledged late correction at its precise oracle. Eleven named semantic failures are required.
Five unknown-case probes must fail explicitly. Compilation errors never count as negative proof.

This is deterministic host evidence for the History/Stop append contract. The Core producer and
hardware flash driver are external ports; this fixture does not establish Checkup evaluation,
hardware programming, physical reboot restoration, all wrap/power-loss outcomes, target resource
fit, HTTP/UI behavior or feature acceptance.
