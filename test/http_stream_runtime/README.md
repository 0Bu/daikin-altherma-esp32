# Production HTTP stream runtime fixture

Run `node test/test_http_stream_runtime.mjs`; add `--sanitizer=undefined` for non-recovering UBSan.
Node and a C++20 compiler suffice. `HTTP_STREAM_RECORD` optionally saves commands, compiler/source
hashes, raw response hex and controls to a private JSON evidence file.

The complete, unextracted `http_common.cpp`, `http_status.cpp` and `state_dwell.cpp` units compile.
Actual status, values, history and plain/redacted diagnostic handlers run through the common
trampoline. Service snapshots, time and SDK transport are controlled adapters. Other handlers are
compiled and discarded by linker sections. Neither serializers nor their production Dwell fold and
batch reader are substituted by a model.

Node decodes complete response bytes with fatal UTF-8 validation and native `JSON.parse`, then
compares independently specified fields, all 288 signed/absent history samples, all held runs,
separate X10A/Modbus types and protocol framing. Each observed production C++ allocation position
and every data/final send position is failed separately; a following real request must still work.
SDK transport captures exclude their own allocations. A failed first send followed by a later OOM
also closes without a replacement response. The Dwell race matrix exercises the actual producer
before its cache commit, checking source generation, profile, fingerprint, revision and state code;
a subsequent fold during transfer cannot replace prepared values or ages.

`legacy_handlers.json` freezes original functions from commit `819a2c98…` only for compiling
negative controls. Restoring old history/redaction bodies reproduces their post-send error-response
defects; restoring the old live Dwell serializer/getter reproduces its mixed-state metadata.
Additional compiling controls remove individual stream, snapshot, epoch, code and UTF-8 guards.
UBSan has an explicit signed-overflow tripwire. Local tests do not establish sockets, FreeRTOS
scheduling, on-target allocation sizes/heap/stack, physical source truth or device acceptance.
