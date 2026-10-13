# Register-probe HTTP runtime fixture

`run.py` compiles the complete, unextracted production `main/http_config.cpp` translation unit and
invokes its actual static `/hp/query` handler. It uses the real build-resolved cJSON parser,
`JsonGuard`, probe validators/decoders, profile registry, hex renderer and bounded JSON serializer.
Function sections discard unrelated config handlers; compiling them is not execution evidence.

Run after the pinned firmware dependency resolution has populated cJSON, or provide an unchanged
local export from that build:

```sh
scripts/agent-python.sh test/query_http_runtime/run.py
scripts/agent-python.sh test/query_http_runtime/run.py --sanitizer undefined
scripts/agent-python.sh test/query_http_runtime/run.py --root /path/to/frozen/source \
    --real-cjson /path/to/resolved/cJSON --baseline-expect-defect
```

The matrix covers strict integer fields, absence defaults, request/body bounds, complete JSON,
scheduler HTTP errors, received-frame failures, slices, single converters, sweeps and serialization.
Named compiling mutations must fail their associated runtime assertions. Evidence records the
compiler, commands, mutation sources and hashes of every non-system compile input, rejecting input
changes during a run. The baseline mode confirms the earlier fractional/defaulting defect.

HTTP transport and config snapshots are adapters; `hp_probe_run` is an instrumented handoff that
returns chosen replies. Neither the shared HTTP/LAN/OOM trampoline nor RTOS, physical UART replies,
on-device memory, persistence or browser behavior is exercised. Protocol-S serialization here
does not validate its physical request length or reply identity. The text-escape control supplies a
synthetic decode label to the actual serializer rather than claiming a catalog label exists.
