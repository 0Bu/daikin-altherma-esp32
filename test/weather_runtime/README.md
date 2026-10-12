# Weather production runtime fixture

`node test/test_src_runtime.mjs` compiles the complete current `main/weather_forecast.cpp`, including
the production Open-Meteo conversion, forecast derivation and source/refresh state machines.
Seventeen cases and ten temporary source mutations cover epoch bounds, payload shape/units,
JSON cleanup during allocation failure, HTTP cleanup/completion/caps/deadlines, admission,
source/consent invalidation, task failure and an exact refresh-success witness. A valid production
task result survives truncated, malformed and overflowing replacements with an explicit failure;
two committed source changes prove that A→B→A cannot revive the first A generation or its token.

The default cJSON seam receives constructed trees and has no lexer. The optional command
`node test/test_src_runtime.mjs --real-cjson managed_components/espressif__cjson/cJSON` compiles the
IDF-lock-resolved cJSON C source, runs the same cases and mutations, and adds malformed,
embedded-NUL and overflow documents through the real parser. It downloads nothing and reports
the bound source hashes.

HTTP, TLS, the absolute socket watchdog, peer quiescence, clocks and RTOS primitives are adapted.
These tests prove Weather orchestration against those seams, not real TLS, timer dispatch,
concurrent scheduling or provider availability. The first completed task iteration is captured at
its normal wait; a synthetic exception then stops the endless worker. Assertions exclude the
shutdown's subsequent status changes. No device, broker or external provider is contacted.
