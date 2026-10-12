# Detection runtime fixture

`node test/test_detect_runtime.mjs` compiles the complete production `main/hp_detect.cpp` with its
real generated profile registry, signatures, CRC classifiers and GPIO reservation rules. The host
adapters supply config snapshots, UART initialization outcomes, bounded synthetic reply frames,
build-default pins, active Ethernet reservations and a diagnostic sink. No detection algorithm is
copied into the fixture.

The named cases cover cache/default ordering and deduplication, cached/swapped/default winners,
reserved or unavailable pins, initialization/remap/query/reinitialization failures, bounded page
retries and NAK behavior, error followed by silence, capacities and short descriptors, EEPROM
display, maximum-sized frames, Protocol S page selection and ambiguous model membership. Temporary
source mutations must compile and then fail the specified runtime assertion.

To compare a preserved pre-fix source tree, run
`python3 test/detect_runtime/run.py --root /path/to/baseline --baseline`. This mode expects the
documented old reservation and local-failure defects while requiring the other cases to pass.
`--root` selects every production dependency from that tree; it does not select another test copy.
`--sanitizer undefined` adds UBSan. Each successful run retains compiler commands, exact dependency
hashes, case and mutation outcomes, and claim limits in a temporary `evidence.json`; changed compile
inputs invalidate the run.

Synthetic frames prove software behavior only. They do not prove physical wiring, electrical UART
behavior, device timing, firmware memory budgets, persistence, rendered UI or delivery. Protocol S
uses the implementation's still-unverified register `0x56` length; this test establishes no physical
length or echo rule.
