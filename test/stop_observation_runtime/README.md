# Independent hourly observation runtime

Run `python3 test/stop_observation_runtime/run.py --sanitizer undefined`. `--out` retains the
compiler command, diagnostics, individual case output and JSON results in a chosen directory.
The harness compiles the production `stop_observation_store.cpp`, the exact record geometry and
reader extracted from `history.cpp`, and their real logic/CRC headers as C++17. Only the FreeRTOS
mutex, monotonic/wall clocks and physical journal transport are host adapters.
No device, network service, credential store or NVS is contacted.

Cases cover original-hour late completion and latest-revision replay; independent readable RPS
endpoint coverage and gaps; missing, torn and CRC-damaged slots; source/model/schema/consent/method
binding; future/undated/backwards/corrected clocks; zero-wait commit/failure acknowledgements;
reset during an archive read; report/service/producer lock interleavings at an hour boundary;
expiry during a one-record read; explicit bounded-queue loss and saturation; nine days of hourly
revisions; whole-hour expiry without either producer or flash service; bounded reset-fence
pressure; and the unchanged physical Checkup envelope interpreted by the old structural reader.
Reset cases keep sequence ordering independent of wall time, future/aged timestamps and physical
slot reuse. Missing reset-index completeness stays limited until a complete physical reindex.
Restored loss notices survive their original hour's expiry and another reboot. Reader cases verify
scratch reuse, independently owned output, CRC/commit/manifest refusal and failed physical reads.
The compatibility case prints actual host POD/index/queue sizes and verifies the existing core
80-byte bucket and 128-byte journal payload.

`reset_before_commit` deliberately proves a persistence limit: a same-scope reset is immediately
empty in RAM and reports `persistence_pending`, but it is durable only after its barrier reaches
the journal. Power loss before that commit can restore the old compatible records on the next
boot. The test must retain this boundary instead of claiming that a RAM-only reset is durable.
No ongoing stop candidate or readable endpoint clock is restored across a reboot.

Forget cases cover recovery before startup, allocation/first-lock failures, unpublished mutex
initialization, busy-store and staged-reader interleavings, late claims/receipts and attempted
same-boot re-enablement. Suppressed reports have no pending restoration or persistence. Only a
fixture-modeled cold boot clears the latch. Three compiling controls remove the latch, clear it
from startup or publish the mutex early; each must fail its exact semantic assertion. The runner
retains these outputs and a source-hashed receipt. These are deterministic interleavings, not a
test of the FreeRTOS scheduler or simultaneous execution on two cores.

The actual journal reader verifies the real envelope and CRC. It does not prove the ESP-IDF flash
driver, target ABI, stack budget, heap minima, partition binding or physical device behavior.
Those remain separate integration/review evidence.
