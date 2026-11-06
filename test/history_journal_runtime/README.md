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
a JSON receipt. Each case is a fresh executable process. `--expect-red` retains the original
commit-rejection witness and requires the named retry oracle to fail, rather than accepting a
compiler, setup or sanitizer failure.

The 18 baseline cases cover:

- Regular public Start/bind/record/seal calls creating one Stop population. Consent changes create
  reset barriers; the fixture never seeds private Store observations, claims or latches.
- Data and barrier append failures during slot-preparation reads/erases, body program and commit
  program, followed by the actual shared journal service retry and exactly one committed record.
- A failed verification read after accepted commit, kept explicitly unverified until retry. This
  test observes transport bytes separately and does not treat the original error as proof of no
  physical commit. It covers the first-slot landing/retry path, not every wrap or power-loss path.
- Accepted commit followed by a transport error, with valid readback deciding success and retiring
  the exact claim. No subsequent duplicate append is permitted.
- Core cursor/ahead state established by its real builder, append and future-cursor helper. A Stop
  success must preserve the independent Core cursor and ahead episode.
- The real Stop flash reader rejecting an ERASED request and corrupted committed payload, while
  accepting the exact committed, CRC-checked population. Append ownership is never read admission.
- NOR programming that rejects zero-to-one changes and requires exact aligned erase ranges.

Four independently compiled History mutations remove the failure callback, restore the erroneous
read-header classifier, clear the Core ahead episode after Stop success, or trust a commit error
over valid readback. Seven named semantic failures are required across data/barrier controls.
Three unknown-case probes must fail explicitly. Compilation errors never count as negative proof.

This is deterministic host evidence for the History/Stop append contract. The Core producer and
hardware flash driver are external ports; this fixture does not establish Checkup evaluation,
hardware programming, reboot restoration, target resource fit, HTTP/UI behavior or feature acceptance.
