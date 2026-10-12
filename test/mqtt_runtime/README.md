# MQTT production runtime witness

The fixture compiles the complete current `main/mqtt_ha.cpp` and its production headers. MQTT/RTOS, clocks and unrelated services are deterministic host adapters; parsing uses the repository's lock-resolved espressif/cjson 1.7.19~2 component. No parser source is vendored here.

From the repository root, after managed dependency resolution:

```sh
python3 test/mqtt_runtime/run.py --real-cjson managed_components/espressif__cjson/cJSON
python3 test/mqtt_runtime/run.py --real-cjson managed_components/espressif__cjson/cJSON --ubsan
```

`--root` can select a checkout explicitly. `CC` and `CXX` select the host compilers. Each run creates its own directory through Python `tempfile`, respecting `TMPDIR`. It retains complete source snapshots, binaries, dependency files, exact commands and a manifest with source/cJSON/header/fixture hashes. It never writes repository files, downloads dependencies or deletes shared files.

Six scenarios contain named assertions:

- Real C++ allocation failure in reference/circulation status snapshots: normal delay, released activity/mutex ownership, preserved values/source-time watermarks and successful later iteration.
- Immediate source withdrawal after reconfiguration despite the next actual Config-copy allocation failure, followed by recovery.
- Consecutive failures increment every skip counter, log once per episode and rearm only after successful work.
- Both real cJSON production consumers: valid input, whitespace, quoted bracket/escape characters, depth16/17, malformed input, trailing data/NUL, wrong types, missing fields, and root/partial-tree allocation failures with balanced ownership.
- Long synthetic circulation probe topic: the post-subscribe cleanup owner/generation commit remains allocation-free, and later inactive cleanup unsubscribes that exact topic once.

Eight temporary whole-production-source mutants must fail the expected named assertion: activity release, mutex unwind, skip counter, both source-time watermarks, episode rearming, log rate and allocating post-subscription topic ownership. Compile failure, crash or another assertion is not accepted as mutation evidence.

This is bounded host evidence. Real broker/TLS/reconnect timing, ESP32-S3 task scheduling/stack margin, device heap geometry and physical plant truth require separate evidence. With X10A absent in the adapter, ordinary outgoing telemetry/discovery/heartbeat branches are compiled but not executed.
