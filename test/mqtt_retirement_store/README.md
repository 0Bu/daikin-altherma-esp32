# MQTT retirement metadata store host witness

`python3 test/mqtt_retirement_store/run.py --ubsan` compiles the actual
`main/mqtt_retirement_store.cpp` and its allocation-free codec against a mocked NVS API. The
witness freezes and hashes every input, then executes missing namespace/key, read/open failures,
bounded payload reads, set/commit failures and retry, repeated save/reload, every scope field,
corrupt/unsupported records, canonical padding and maximum field lengths. Compiling negative
controls must fail their named semantic assertions.

The single 204-byte record contains only the effective raw MQTT base, full board ID and last
possibly announced profile. It uses the separate `mqtt_retire` namespace and `provenance` key;
it contains no credentials, service configuration or active detection state. The caller owns
retirement-before-save and save-before-discovery ordering, which this adapter witness does not
exercise.

The mock models write-through NVS: a successful set may remain visible after a failed commit,
but the adapter must report failure and permit retry. No NVS initialization, erasure, recovery,
factory reset, flash or network access occurs. Same-process reload proves the codec and adapter
contract only. Persistence after a real reboot, power loss or actual flash failure needs separate
device evidence.
