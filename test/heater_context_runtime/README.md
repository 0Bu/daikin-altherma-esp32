# Independent heater owner runtime fixture

This fixture links the current [owner](../../main/heater_context_store.cpp) as a separate
translation unit, using current production reducer, hourly splitter, Method-3 codec and payload
headers. There are no frozen-header fallbacks. Flash is a fixed host array with the real 64-byte
History header, normalized header-plus-payload CRC and a separate reused 4096-byte Reader buffer.
The [History fixture](../heater_journal_runtime/README.md) covers actual prepare/append/ACK bodies;
this fixture does not execute `esp_partition_*`.

```sh
python3 test/heater_context_runtime/run.py --out /new/private/output
python3 test/heater_context_runtime/run.py --sanitizer undefined --out /another/private/output
```

`CXX` selects a host C++17 compiler. Output must be a new directory; omitting `--out` creates a
private temporary directory. A full run executes 62 cases and requires 16 privately compiled
guard-removal controls to fail at their exact expressions. Unknown cases fail explicitly; UBSan
also requires a signed-overflow tripwire to terminate. `--case NAME` repeats may select a subset,
which does not run or claim the mutation suite. Exact commands, compiler identity, object/binary
hashes, stack-usage files and case logs stay in the output. Actual `-MMD` dependencies must match
preflight; all compiler inputs and runner/help files are hashed before and after the run.

The 58 independent-hour scenarios cover early unreadable/live samples, once-only nonoverlapping
base admission, independent heater restoration, full revision replacement, immutable claims and
contended callbacks, source/consent/clock fences, opaque bytes, retry, keeper retention, aging,
saturation, read fences and exact receipts. Four added cases cover pre-start guard behavior,
unsynchronized time and recovery, conflicting highest sequences in two physical slots, and codec
body parity over 1776 single-bit mutations. Codec comparisons use canonical encoded fields rather
than C++ padding. Before startup, status/record/service/next perform no Reader I/O or initialization;
normal startup then admits real test samples. Unsynchronized time masks dated counters and blocks
archive reads/writes; recovery counts only the witnessed intervals.

Method 3 stores one complete Data192 per heater/hour and Fence32. A complete BUH record can restore
without BSH; there is no cross-heater Commit. The former 34 cohort-case source is preserved in
private change evidence with a complete replacement mapping. Fragment-pair/descriptor assertions
are retired, not renamed as passing tests. The former `no_warm_base` rule is deliberately superseded:
once admitted, materialized full counters remain authoritative within their scope after a later
read failure, with loss/incomplete/pending qualifiers. Unknown mutation still blocks archive
adoption and writes until proof; cold startup/reset never inherits a warm aggregate.

Archive scan/replay share at most 256 Reader calls per positive-budget invocation and a 5 ms soft
deadline checked between calls. Budget 0 performs no Reader I/O; a blocking Reader is not preempted.
Read errors back off for one monotonic second. Keeper checks all target fences in one combined
outside pass. Exact successful erase revokes only affected durable references; unknown mutation
only withdraws proof. Rotation reaches younger hours rather than repeatedly rewriting all older
cells. Empty pre-fence candidates do not count or write synthetic hours. The 12-record shutdown
drain remains best effort against 48 dirty cells.

Global 64-bit sequence exhaustion and hourly counter saturation have runtime witnesses. The
32-bit token, lifecycle epoch and per-cell mutation exhaustion guards are source-inspected only:
their internal counters cannot be driven to exhaustion in a bounded public-API fixture without
changing production code. This is an explicit remaining boundary, not a runtime pass.

FreeRTOS wait hooks model a contended owner releasing its lock; they do not prove real scheduling.
Most assertion counts include every Reader's lock/slot checks. Host cold restore is not a physical
reboot. No target build, stack/heap/WDT measurement, flash, power-loss, physical heater, consumption,
CI, release or hardware acceptance is implied. Reported ON flags are synthetic test inputs.
