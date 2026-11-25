# Independent heater journal integration harness

Run `python3 test/heater_journal_runtime/run.py`, then repeat with `--sanitizer undefined`.
Every run retains a unique private output directory. `--out` requires a new directory; `--root`
binds a frozen production snapshot. A `--case` subset does not run or claim the mutation suite.

The complete production Store runs as a separate translation unit. Seventeen unchanged extracted
History bodies execute with actual record/source/state declarations: physical validity, core
exclusion, reader, slot preparation, heater building, append/readback/ACK, failure accounting,
dispatch, pinning and positive restore leaf. Source lines, dependencies, hashes and compiler
commands bind the receipts. The large restore entry and shutdown save are inspected rather than
compiled as fake clones: the positive leaf stays unconditional while pinned, all other archive
service budgets stay zero, and the actual shutdown limit stays twelve records. Source-contract
controls remove or pin-gate the leaf; runtime controls suppress its real progress. The actual
four-argument build-only dispatcher is body_16, included before the actual three-argument wrapper
body_13. All earlier body indices remain stable. Both noinline declarations are retained; this
host fixture does not measure target stack frames.

Method 3 persists one complete Data192 per heater/hour and Fence32, without a cohort commit or
multi-piece sequence reservation. All 37 previous case names remain. The original 25 names are
mapped below; the other twelve cover independent populations, retirement during ProofPending,
opaque/Method-2 refusal, latest revision replacement, 48 materialized cells, contended callbacks
and a lost final scan finish. Historical receipts remain separate evidence. The shutdown case
now creates 48 genuinely dirty live cells; an unrelated erase no longer invents dirtiness.

| Historical case | Current substantive oracle |
| --- | --- |
| `cohort_actual_slots` | Two complete Method-3 leaves occupy actual post-abandonment slots, consume one sequence each, bypass core cursors and respect retained opaque bytes. |
| `service_pins_across_ticks` | Each one-piece ACK releases its claim; an ordinary writer may interleave independent heaters without changing counters. Pending pinning moves to `inflight_sector_deferral`. |
| `protected_corrupt_sector` | CRC-damaged target is protected without write, erase or I/O-abandon accounting. |
| `protected_torn_sector` | Uncommitted target is protected at the same boundary. |
| `protected_read_failure` | Unreadable target is protected at the same boundary. |
| `keeper_fence_outside_records` | An aged Method-3 fence survives while lower physical records remain outside its sector. |
| `inflight_sector_deferral` | Deferred data survives real fixture erase/invalidation, false-next ProofPending, multiple positive slices and competing writers with identical bytes/token/sequence, then actual ACK. |
| `sequence_exhaustion` | MAX is never programmed; MAX-1 can commit one atomic leaf while the other stays pending, without wrap. The retired three-piece rule does not apply. |
| `bad_data_readback` | CRC-damaged Data cannot restore; archive stays explicitly incomplete. |
| `unreadable_data_readback` | Failed immediate ACK readback aborts the claim; later genuinely valid physical Data may restore exactly that heater once. No absent cohort commit discards valid independent bytes. |
| `accepted_program_error` | Valid readback accepts a reported program error once, settles the exact claim, restores independent counters and keeps Fence32 out of core restore. |
| `late_revision_deferred_bytes` | Acknowledged cumulative base plus actual seam RAM delta stays exact; deferred revision bytes are immutable; cold latest revision replaces rather than adds its predecessor. |
| `source_interleave` | Source cutover during actual readback cannot publish predecessor counters. |
| `consent_interleave` | Consent cutover has the same exact receipt boundary. |
| `clock_interleave` | Observed clock discontinuity has the same exact receipt boundary. |
| `core_cursor_control` | A genuine ordinary core record reaches the live core ACK/cursor recording port. |
| `bounded_tick_budget` | Positive progress stays within 256 reads; zero-budget writers add none; the separate keeper slice remains bounded. |
| `keeper_pending_cursor` | Pending outside proof retains cursor/claim without I/O-failure accounting; completion permits one Data ACK and later independent BSH ACK. |
| `keeper_combined_fences` | Sixteen fences require one combined outside pass, at most one read per outside slot. |
| `slow_reader_deadline` | Archive and keeper check the 5 ms deadline between non-preemptible Reader calls. |
| `replay_budget` | Index/replay share the budget, including one-read slices and their deadline seam; 24 exact hours per heater publish. |
| `io_retry_repair` | Failed reads stop the slice, respect the one-second retry deadline and restore after repair. |
| `partial_epoch_invalidation` | Mid-scan retirement invalidates the old cursor; zero budget does no work; fences ACK before replacement scan; old counters never publish. |
| `partial_erase_invalidation` | Physical mutation restarts index/keeper proof; erased candidates cannot survive cached partial work. |
| `shutdown_budget` | The shared writer drains twelve ordinary records without a hidden archive scan. |

Retired descriptor slot-pair/three-piece oracles become complete per-heater Method/header/CRC/
physical-slot reads and matching immutable receipts. The old neighboring descriptor-slot mutant
is replaced by an out-of-range ACK slot and wrong-token ACK: there is no descriptor pair to bind
a neighboring slot. Remaining original controls retain their behavioral boundaries. Added controls
remove false-next pin retention, suppress progress while pinned, and restore each of the four
lossy zero-wait callbacks, plus omit the retry of a contended final scan finish. All twenty-two mutants
must compile and fail their specific named oracle;
UBSan additionally proves a signed-overflow tripwire terminates.

Six additional cases exercise successful sector erase separately from generic unknown/failed
mutation. `blocking_invalidate` now contends the actual successful erase callback;
`blocking_unknown_invalidate` contends a real erase failure and retains the generic callback
control. The prior fourteen control names remain, with the generic callback control assigned
to the failure case. New controls restore successful erase callback loss, a moving clock anchor,
all-cell dirtiness, a wrong erased sector and empty-candidate evidence.

| Added case | Oracle |
| --- | --- |
| `unrelated_erase_no_rewrite` | An ordinary History append really erases an unrelated sector; the 48 unaffected durable cells remain clean. |
| `unknown_mutation_no_rewrite` | Unknown mutation blocks writes until full proof; unchanged verified references then produce no rewrite. |
| `clock_negative_jitter` | A permitted -0.5 s correction preserves both anchored endpoints, actual atomic commits and exact cold restoration. |
| `rotation_progress` | Forty live closed cells cross three real prepare/erase/ACK boundaries and reach the youngest hours; a fourth erase rewrites only sixteen affected references, then cold latest revisions restore exact totals. |
| `ghost_no_data` | Pre-fence candidates never count as observed hours or emit empty Data after repeated proof. |
| `blocking_unknown_invalidate` | A failed physical erase cannot lose proof invalidation or claim retirement under owner contention. |

Rotation explicitly positions the cursor at occupied sectors and later simulates wrap into a
previous sector; it does not run through all 16384 slots as a wear test. Archive progress uses
the actual positive restore leaf, once per modeled tick, while writers retain budget 0. The
empty-candidate mutant restores two interacting former behaviors: treating empty candidates
as evidence and making every admitted candidate dirty on unknown mutation. The optional
`HEATER_JOURNAL_LEGACY_SECTOR_CALLBACK` compile define is only a historical Before port for an
old owner that lacked the new callback: successful erase maps to its generic invalidation.
Ordinary runs omit the define. No production source is modified by that compatibility port.

The 43 prior cases and 20 prior controls remain. `dispatcher_sources` additionally executes the
real inner helper and wrapper for Stop, Heater, core and every trend source. Stop/core/trend
builders are recording ports; the Heater builder and owner remain real. `dispatcher_future_note`
checks return values, wait budgets and exact source/cursor/bound transfer, no log on ordinary
refusal or success, and one log-port call per rejected future result after every provider has
returned. Controls omit that log or route Stop to core. The existing log recording port does not
prove the separate production episode-rate limiter or a target lifetime/stack bound.

Actual MMD dependencies must match preflight for both production/fixture units and every compiled
mutant. Their unchanged production include closure and all input bytes are checked before/after.

The flash port is a 4 MiB byte array enforcing erase boundaries and one-to-zero programming.
Unknown torn bytes keep restoration incomplete. Intact-record cases use the real reader/codec.
A slice admits at most 256 Reader calls and checks a 5 ms deadline between calls; one blocking
Reader cannot be interrupted. The accepted tick composition is up to 256 restore/replay reads
plus 256 keeper reads, separately bounded claim/readback work. Explicit setup steps drain bounded
slices without moving the admitted clock backwards. The actual twelve-record best-effort drain
is exercised against 48 dirty independent cells and deliberately leaves the remaining hours pending.

Callback contention models another owner becoming runnable: a zero-wait take loses; a blocking
take acquires after that owner releases. This witnesses callback wait/receipt behavior without
claiming physical scheduling or RTOS timing.
The finalization case injects contention only after the final scan-slot update releases its lock.
The next actual service must finish and materialize rather than call Reader with slot 16384.
Every physical read also rejects execution while the modeled heater owner mutex is held.

Unrelated trend/checkup builders, Stop/manifest services and ordinary ACKs are recording ports.
Host cold-start replay is not a physical reboot. This is not the full History translation unit,
native review, target build, flash/RTOS/stack/heap measurement, power-loss or live-plant acceptance.
The separate Stop harness remains required.
