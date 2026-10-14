# HTTP server and MCP production runtime fixture

Run `node test/test_http_server_runtime.mjs`; add `--sanitizer=undefined` for non-recovering UBSan.
The suite needs only Node and a C++20 compiler. Complete JSON response bytes are emitted as hex and
validated independently using Node's fatal UTF-8 decoder and native `JSON.parse`.
`HTTP_RUNTIME_RECORD` optionally saves commands, source hashes and results to a private evidence file.

The complete `http_common.cpp`, `http_server.cpp` and `mcp_server.cpp` production units execute with
SDK-shaped transport adapters. Four route-registration functions from status/config/OTA are copied
verbatim, retaining their conditions and method/order, while their unrelated service handlers are
counted adapters. An independent fixed AP5/LAN39 oracle checks actual registration, the real common
trampoline and catch-all order. MCP invokes controlled shared status/values stream adapters; their
production serializers and physical readings remain outside this fixture.

Cases cover startup and route-capacity failures, LAN/AP and Ethernet identities, Host/Origin/Fetch
Metadata and JSON media policy, exact OTA-route exemptions, exception and stack-sample boundaries,
bounded unread-body settlement, body fragments/limits/timeouts, MCP revisions, initialize/catalog,
both bounded tool envelopes, independent snapshot generations, notifications, malformed documents,
UTF-8, null parse-error IDs, unsupported writes, GET gzip headers and SSE rejection. Compiling
mutants restore the old OTA-prefix exemption and remove individual guards/dispatch choices; each
must fail its named independent oracle. These host results do not prove sockets, hardware, NVS,
OTA delivery, on-device heap/stack or rendered browser behavior.
