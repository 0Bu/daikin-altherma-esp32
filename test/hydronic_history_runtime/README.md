# Complete History journal runtime fixture

`python3 test/hydronic_history_runtime/run.py --sanitizer undefined` compiles the complete production
`history.cpp` with both actual independent observation stores and real codec/index headers. Only the
SDK NOR-flash transport, mutex/clock ports and external services are modeled. Core Checkup's callback
checks that only its own format reaches it; Checkup semantics have a separate runtime fixture.

Cases cover mixed Core/Stop/HYDR heads and revisions, hooks before Store startup, recognizable damaged
envelopes, uncommitted bodies, partial scans, erase-sector reuse, verified append receipts, rejected
commits, accepted writes that report failure, unreadable commit verification, bounded shutdown drain
and early History forget. Compiling mutations must fail their named semantic oracle; compile errors
and unrelated failures do not count.

Each valid append attempt reserves its sequence before slot preparation or programming. Failed
attempts leave gaps; verified readback alone acknowledges the logical population. A retry uses a
new sequence and must not double-count its data. The pure host suite covers zero/stale requests and
the final usable sequence followed by fail-closed exhaustion.

Four paired cases start separate executable processes with only synthetic flash bytes carried
between them. A reset fence hides the old population after its real journal commit. Before that
commit, a new process may still restore the old compatible records. No fixture clears a Store privacy
latch or seeds private Store state to represent a new boot.

The late-delta pair first commits a real Core record in slot zero. Public reader expiry closes an
unsealed Hydronic hour; its slot-one commit succeeds but verification cannot be read. A delayed
delta with an increasing sample time corrects that same old hour, and the real shared service retries
in the next sector. Both revisions and the byte-identical prior Core record remain. A fresh process
must reconstruct the same two acknowledged samples and eight qualified seconds. The sequence-reuse
mutation must allow its seed to pass, then lose the correction at the exact fresh-restore oracle.

All original 24 process cases and nine compiling controls remain. Four additional cases verify
Stop data/fence commit failures through the actual public poll retry, independent Stop/HYDR
successes preserving a real Core future cursor/ahead episode, and zero/stale/consumed request
rejection before all flash I/O. Three additional compiling controls remove Stop failure cleanup,
classify an ERASED Stop fence request with the committed reader, or clear Core ahead after HYDR
success. The sequence-reuse control also fails the exact before-transport request oracle.
Totals are 28 normal process cases and 12 compiling controls. Retained output binds source hashes, compiler, each translation
unit's MMD inputs, commands, binaries, synthetic NOR bytes and results. Git is not invoked.
This proves modeled
component integration, not ESP-IDF flash-driver behavior, FreeRTOS scheduling, physical measurements,
real reboot/power-loss persistence or hardware acceptance.
