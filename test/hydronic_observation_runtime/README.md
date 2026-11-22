# Hydronic hourly observation runtime

Run `python3 test/hydronic_observation_runtime/run.py --sanitizer undefined`. `--out` retains the
compiler command, input hashes, per-case logs and JSON results. The harness compiles the actual
`main/hydronic_observation_store.cpp` and its production logic/CRC headers as C++17. SDK mutexes,
monotonic/UTC clocks and the physical flash transport are the only host adapters. The adapter
executes the production normalized codec, exact header binding and CRC. It models the required
recognizable-corrupt-record scan ordering; it does not execute `history.cpp`.

Cases cover the real tracker's 600-second settling boundary without retrospective duration;
hour seams and actual endpoint sample ownership; independent observed, eligible and qualified
time; optional command populations; UTC evidence dates distinct from accepted dates; same-hour
FIFO delta revisions and exact-identity restore across a replacement monotonic epoch; source,
model, schema, consent and source-generation replacement; immediate reset/disable withdrawal;
immutable claimed entries and reset/read/publication races; bounded queue loss and durable
watermarks; whole-hour expiry with no producer or flash service; clock readiness, tolerated
two-second drift, larger corrections and regression; zero-wait receipts, failed transactions
and readback-confirmed commits after transport errors; recycled fence slots, corrupt committed
records, finite data-index loss and indefinite fence-index uncertainty; seal and privacy forget;
rolling counts beyond `UINT32_MAX`; negative, absent and inconsistent codec fields; exact wire
width, padding exclusion and Core/STOP/HYDR format separation. Producer and report paths perform
no flash reads; flash callbacks run outside the Store lock.

Privacy cases call the real `forget` before startup, during mutex creation/publication, after
failed creation, while the Store lock is busy, and during staged flash reads and claims. They
verify an allocation-free per-boot atomic latch, safe nullable handle publication, immediate
report withdrawal, ignored late receipts and refusal to re-enable through Start/bind/config.
Three source mutations must compile and then fail their exact semantic oracle: removing the
forget latch, publishing the mutex before initialization, and omitting canonical live defaults
before startup publication. Their generated source, compiler
logs and results are retained separately in `negative-controls.json`.

Index-storage cases invoke reset, valid-record, incomplete-record, service and next hooks
before Store startup. They check the exact shared index defaults, repeated placement resets,
preservation of earlier indexed evidence across Start, producer/report separation, refusal
to first construct an index after forget, and continued reset cleanup of an existing index.
The union initially has only an active zero-byte member;
the exclusive Flash owner explicitly constructs the typed member before access. No index
observations are seeded through private state. Host results establish lifecycle behavior;
flash-image savings, target placement and stack costs require an actual firmware build.

Inactive-image cases exercise public lifecycle calls before Start, startup recovery after mutex
creation or first-acquire failure, and readers at creation/publication boundaries. They require
canonical absent dates and a successful first queued append after startup. A partial failed
reader output must remain unobserved and be fully replaced by a later real decode. Reset and
forget run after a successful decode but before the store consumes its borrowed payload; its
encoded fields must stay unchanged while the old epoch is withheld. These cases do not seed
private observation state or reset Flash-owner scratch through a producer path.

A RAM reset withdraws evidence immediately and reports `persistence_pending`. Its same-identity
fence becomes durable only when History commits it. Power loss before that commit can restore
old compatible records. `forget` withdraws evidence and disables this store for the rest of
the boot; physical journal erasure
and consent persistence remain History/configuration responsibilities. The same boot remains
suppressed through the allocation-free `hydronic_observation_suppressed()` accessor even if
the mutex did not exist or was busy when forget ran. Only the fixture's explicit model of new
process static initialization resets this latch; production Start never clears it. No ongoing
settling interval or monotonic endpoint is restored. Empty populations have no defined sample mean.

This evidence does not prove actual History scheduling, flash-driver behavior, ESP32 ABI/stack
budgets, partition binding, physical reboot restoration, live plant eligibility, API/UI output
or device acceptance. Those require separate integration and target/hardware validation.
