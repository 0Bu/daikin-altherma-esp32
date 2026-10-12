# X10A production UART runtime fixture

`node test/test_uart_runtime.mjs` compiles the complete current `main/hp_comm.cpp` with its real
request builder, frame receiver, checksum, query logging policy, detection classification and
manual-probe mapping. Twenty-two named cases cover literal synthetic Protocol I/S golden frames,
request echo, leading noise, NAK, silence, truncated/corrupt/wrong-page/protocol frames, length guards,
partial bulk reads, deadlines, local driver failures, recovery and the legacy integer return values.
Fourteen temporary production-source mutations must fail their named runtime assertion; a failed
compilation does not satisfy a negative control.

The UART seams follow the ESP-IDF v6.1 API return contracts: a missing driver coherently fails
flush, write, TX wait and read; TX ring size zero accepts the complete write or returns `-1`, never
a short positive count. TX completion can time out. A read can return `-1` when its RX mutex wait
fails, while the installed driver remains usable for the next explicit query. Driver withdrawal
between successful flush and write/TX wait is an injected API fault control, not an observed
application transition. No test combines a failed flush with a functioning driver that returns
stale RX bytes. A reported driver failure stops that query without retry or resend, retains copied
bytes in the detailed transport result, remains visible during detection, and maps a manual probe
to the existing `NoLink` status. Ordinary zero-byte reads still expire as `NoReply`.

Protocol S has no documented reply-identity check in the current transport. A checksum-valid
fixed-length candidate is accepted even when its prefix resembles Protocol I. The fixture pins
that limitation; its foreign-frame rejection example does not establish protocol/page identity.

This fixture establishes the production software decision and diagnostic path. Its synthetic
frames and deterministic SDK scheduling do not establish physical X10A replies, electrical
compatibility, actual UART contention, RTOS races, stack/heap budgets, or the cause of an earlier
device timeout. It neither contacts a device nor changes configuration.
