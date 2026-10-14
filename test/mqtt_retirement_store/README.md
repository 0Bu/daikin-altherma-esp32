# MQTT retirement metadata store host witness

`python3 test/mqtt_retirement_store/run.py --ubsan` compiles the actual
`main/mqtt_retirement_store.cpp` and its allocation-free codec against a mocked NVS API, a mocked
store mutex and a mocked factory-reset latch. The witness freezes and hashes every input, then
executes missing namespace/key, read/open failures, bounded payload reads, set/commit failures and
retry, repeated save/reload, every scope field, corrupt/unsupported records, canonical padding,
maximum field lengths, the factory reset's erase of the store and the save refusal behind the
reset latch. Compiling negative controls must fail their named semantic assertions.

The single 204-byte record contains only the effective raw MQTT base, full board ID and last
possibly announced profile. It uses the separate `mqtt_retire` namespace and `provenance` key;
it contains no credentials, service configuration or active detection state. The caller owns
retirement-before-save and save-before-discovery ordering, which this adapter witness does not
exercise.

The factory reset (`main/recovery_button.cpp`) is the only caller of `mqtt_retirement_forget()`.
The witness proves that it erases the whole dedicated namespace, treats a namespace that was never
written as success without creating it, reports open/erase/commit failures, and takes the store
mutex. A save reads the latch under that same mutex and is refused behind it, so a record cannot
be recreated between the reset's erase and its reboot. The mutex and latch are single-threaded
mocks: they prove which calls happen under the lock, not FreeRTOS scheduling.

The mock models write-through NVS: a successful set may remain visible after a failed commit,
but the adapter must report failure and permit retry. No NVS initialization, real erasure, flash
or network access occurs. Same-process reload proves the codec and adapter contract only.
Persistence after a real reboot, power loss or actual flash failure needs separate device evidence.
