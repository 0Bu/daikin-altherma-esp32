# Checkup runtime integration

`fixture.cpp` compiles the complete production `main/checkup.cpp` with the real project headers,
profile tables, Config accessor, SemGuard and IDF-free logic. Only SDK clock/reset/mutex ports and
external config, history, poll and circulation services are deterministic adapters. Every case runs
in a fresh process. The warm-start mutex failure case sets the consent generation and seals a
retained header before invoking production startup.

```sh
python3 test/checkup_runtime/run.py
python3 test/checkup_runtime/run.py --sanitizer undefined
```

Each invocation creates a unique temporary output directory. `--out DIR` retains results in a new
chosen directory; `--root DIR` selects another repository source tree. Intended uncommitted changes
are tested as they stand. The receipt records HEAD separately from actual source/dependency hashes,
compiler, commands and per-case results. Before linking each baseline or control, the runner
compares the compiler's non-system dependency files for Checkup and the Store separately against
their preflight paths. Each control must substitute only its generated Checkup source, whose
planned bytes are checked before and after compilation. All bound input hashes are checked again
after the runtime cases.

The cases exercise independent heater clocks and unknown inputs, fault severity and missing sibling
rows, exact read-time freshness, stale findings, poll/circulation epoch barriers, consent and source
resets, and producerless expiry of pending/completed hours. Completed synthetic DHW evidence is
created by ordinary modeled polls; dated synthetic records enter through public
`checkup_flash_restore()`. Its host `flash` slug is not evidence of a physical flash read or reboot.

Six consent cases capture the public token before preparing an old endpoint, then interrupt it with
public OFF/ON calls before submission, before mutex acquisition or during external sampling.
Both new and repeated persisted-generation arguments must
leave the new interval empty until a genuinely new sample arrives: its first endpoint adds no
observed seconds, and the next endpoint adds ten. Repeated-generation cases establish the live
admission epoch's independence, not durable-record safety for arbitrary generation reuse.

The default run compiles production mutations of consent boundaries, ageing, stored-hour
selection, Stop forget guards and the absent-mutex and failed-lock reports.
Each must compile and fail its specified oracle;
compiler errors and unrelated failures do not count. Unknown test-case names are also refused.

Forget cases exercise the real Store and Checkup together before startup, with a pending window,
and during producer/report lock acquisition. Subsequent source/consent changes cannot re-enable
Stop collection in that boot. The cases inspect private Stop reducer state after public operations
to distinguish suppressed collection from hidden output. No recovery
button, NVS erasure or physical history wipe is executed.
The shutdown case checks suppression through the real shutdown handler; ordinary sealing already
retires its reducer, so omitting only the extra shutdown guard is not a discriminating control.

This proves component behavior at modeled interleavings, not FreeRTOS scheduling, raw X10A decode,
all-model physical sensor truth, target heap/stack budgets, or hardware persistence across resets.
