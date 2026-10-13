# MQTT production runtime witness

The fixture compiles the complete current `main/mqtt_ha.cpp` and its production headers. MQTT/RTOS, clocks and unrelated services are deterministic host adapters; parsing uses the repository's lock-resolved espressif/cjson 1.7.19~2 component. No parser source is vendored here.

From the repository root, after managed dependency resolution:

```sh
python3 test/mqtt_runtime/run.py --real-cjson managed_components/espressif__cjson/cJSON
python3 test/mqtt_runtime/run.py --real-cjson managed_components/espressif__cjson/cJSON --ubsan
```

`--root` can select a checkout explicitly. `CC` and `CXX` select the host compilers. Each run creates its own directory through Python `tempfile`, respecting `TMPDIR`. It retains complete source snapshots, binaries, dependency files, exact commands and a manifest with source/cJSON/header/fixture hashes. It never writes repository files, downloads dependencies or deletes shared files.

Forty-four scenarios contain named assertions:

- Real C++ allocation failure in reference/circulation status snapshots: normal delay, released activity/mutex ownership, preserved values/source-time watermarks and successful later iteration.
- Immediate source withdrawal after reconfiguration despite the next actual Config-copy allocation failure, followed by recovery.
- Consecutive failures increment every skip counter, log once per episode and rearm only after successful work.
- Both real cJSON production consumers: valid input, whitespace, quoted bracket/escape characters, depth16/17, malformed input, trailing data/NUL, wrong types, missing fields, and root/partial-tree allocation failures with balanced ownership.
- Long synthetic circulation probe topic: the post-subscribe cleanup owner/generation commit remains allocation-free, and later inactive cleanup unsubscribes that exact topic once.
- Saved circulation and three-topic room subscriptions: accepted SDK effects retain their exact cleanup owners without a subsequent allocation, including the final room-owner array commit.
- A saved circulation epoch changes inside the successful SDK call: stale status stays withdrawn, but the accepted topic remains owned and is unsubscribed once when disabled.
- Failed first subscriptions, partial room batches and failed re-subscriptions: retain accepted or still-live prior owners, report incomplete subscription status, retry without resetting the source and eventually unsubscribe each accepted topic once.
- Clean-session reconnect with unchanged long accepted owners: real C++ allocation failures in both room mapping copies, all three desired-topic copies and the circulation owner copy cannot consume the pending resubscription. The failed call releases locks without an SDK subscribe; the next production service call restores actual broker subscriptions, truthful status and current wire-value acceptance.
- Rejected unsubscribe on deletion, replacement and both probe teardown paths: preserve exact live cleanup ownership, defer replacement effects until retirement succeeds and accept one eventual unsubscribe per topic.
- One topic shared by room, saved circulation and probe owners: retiring each owner preserves the remaining subscription until the final owner releases it.
- A new active probe starts before the prior inactive cleanup cycle: retire the previous owner before the new SDK effect, preserve it on rejection, and judge shared ownership from accepted subscriptions rather than saved configuration.
- SDK-owned callbacks record the transport task's stack; caller-side error/disconnect callbacks cannot misfile that sample under the SDK or publisher slot.
- Heartbeat, Weather and heating-curve emitters: inspect actual topic, payload length, QoS/retention and independently expected typed wire fields with real cJSON. Flat bounded SDK traces allocate no C++ storage. Weather tests suppress unconfigured/unchanged output, retain the last accepted cache on SDK rejection, retry later and commit without allocation after acceptance.
- Scalar HP/Crash helpers preserve first-source promotion, current publication permission, confirmed source withdrawal and changed/dismissed crash evidence.
- All five discovery builders round-trip accepted quote/backslash/UTF-8 topics through real cJSON; both ENV III availability entries are checked and ordinary documents stay byte-identical.
- Actual DATA fragments reach the queue and source owner only when complete and consecutive. Boundary sizes, source cutover, overflow, timestamp rollback and retained input without source time have independent assertions.
- Probe captures belong to their original test generation; save proof expires with the original source observation even after clock rollback or queue delay.
- Initial transport-start rejection retains the initialized client, backs off and restores inbound service without reboot; rejected event registration reports its cause before any unobserved transport can start.

Fifty temporary whole-production-source mutants must fail the expected named assertion: activity release, mutex unwind, skip counter, both source-time watermarks, episode rearming, log rate and allocating post-subscription ownership. Subscription controls also remove epoch-safe ownership, retention after partial failure, retry despite unchanged owners, each reconnect retry latch before allocating preparation, rejected-unsubscribe retention, active-probe retirement and protection of another actual owner. Two controls omit an SDK sample or admit a caller-side error sample; thirteen controls change outgoing wire identity/fields, accepted-cache ownership, suppression/consent or scalar gate/crash facts. Three controls remove probe generation, original-observation expiry or dequeue-time freshness; three more remove initial retry, backoff or event-registration rejection. Compile failure, crash or another assertion is not accepted as mutation evidence.

This is bounded host evidence. Real broker/TLS/reconnect timing, ESP32-S3 task scheduling/stack margin, device heap geometry and physical plant truth require separate evidence. Outgoing cases execute the complete production emitters with controlled source snapshots; ordinary outgoing publication, discovery publication orchestration and X10A/Modbus state-payload emission remain compiled but unexecuted. The subscriber-only task loop and all five discovery builders execute in their named cases.
