# MCP integration

The device exposes a small **Model Context Protocol** server at `POST /mcp` so AI agents and other
MCP clients can read heat-pump state directly. It is **strictly read-only**: the two tools reuse the
same cached snapshots as `GET /status` and `GET /values`; no tool writes configuration, commands the
heat pump, or reaches a separate data source.

> Transport: **Streamable HTTP**, stateless JSON-RPC 2.0. `POST /mcp` is the protocol;
> `GET /mcp` is a self-contained setup and information page (not SSE). Both share the same
> trusted-LAN-only caveat as the rest of the API — no auth/TLS, keep them on your LAN.

The implemented subset follows the date-versioned MCP specification:

- `initialize` negotiates `2025-03-26`, `2025-06-18`, or `2025-11-25`; an unsupported/missing
  revision receives the server's latest supported revision (`2025-11-25`).
- `tools/list` returns exactly the two no-argument tools below, including read-only annotations.
- `tools/call` accepts only those tool names and an omitted or empty `arguments` object.
- A valid notification (for example `notifications/initialized`) is accepted with HTTP `202` and no
  body. There is no session id and no state is retained between requests.
- Native clients may omit `Origin`; the global HTTP boundary requires Host and a present browser
  `Origin` to name the device's mDNS hostname or current WiFi/Ethernet IP (with optional `:80`) and
  rejects cross-site Fetch Metadata with HTTP `403`. The POST body must declare `application/json`.
  A present `MCP-Protocol-Version` header must name one of the three supported revisions; when it is
  absent the Streamable-HTTP compatibility default applies.
- Parse/Request/Method/Params errors use JSON-RPC `-32700`, `-32600`, `-32601`, and `-32602`;
  a valid string, number, or null request id is echoed exactly. Unknown tool names use `-32601`.

The request body is bounded to 1 KiB and parsed by the IDF-free, host-tested
[`logic/mcp.hpp`](../main/logic/mcp.hpp) core. Every route invocation still runs under the shared
HTTP OOM guard. `get_hp_values` stages its X10A/HomeHub snapshots before the first byte, then emits
the JSON-RPC envelope and shared `/values` representation through a host-tested 1 KiB chunk sink;
the complete model-sized response is never one contiguous allocation.

## Browser setup page

Open [`http://daikin-altherma-esp32.local/mcp`](http://daikin-altherma-esp32.local/mcp) in a browser.
The page is embedded in the firmware, pre-compressed, and has no CDN, font, script, image, or other
external dependency.

It explains MCP in the context of the device and shows the exact URL that served the page, a
copyable `mcpServers` configuration, a curl initialization example, the two-tool summary, and the
transport/security contract. The page is deliberately static: it makes no MCP or other network
requests. Its restrictive CSP includes `connect-src 'none'`.

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `get_status` | none | `structuredContent` with the complete device/WiFi/MQTT/heat-pump status (same shape as `GET /status`) |
| `get_hp_values` | none | `structuredContent` with the complete current X10A and, when live, HomeHub snapshot (same shape as `GET /values`) |

Each call result also contains a short `TextContent` summary. The full snapshot is emitted once as
`structuredContent`: serialising and JSON-escaping the same multi-kilobyte value array a second time
would create avoidable contiguous-heap pressure on the ESP32-S3. Transport chunks do not change the
JSON shape; concatenating them produces the documented result object.

## Client config

Clients using the common `mcpServers` shape, including Claude Desktop / Code:

```json
{
  "mcpServers": {
    "daikin-altherma-esp32": {
      "type": "http",
      "url": "http://daikin-altherma-esp32.local/mcp"
    }
  }
}
```

## Wire example

```bash
BASE=http://daikin-altherma-esp32.local

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' | jq

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools[].name'

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_status","arguments":{}}}' \
  | jq '.result.structuredContent'

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_hp_values"}}' \
  | jq '.result.structuredContent'
```

---

## Developer tooling: ESP-IDF Tools MCP server — evaluated, not adopted

Not to be confused with the device's `/mcp` above. Espressif's
[ESP-IDF Tools MCP server](https://developer.espressif.com/blog/2026/04/esp-idf-tools-mcp-server/)
(ESP-IDF v6.0+, `idf.py mcp-server`, stdio) exposes build tooling to an AI client —
`set_target` / `build_project` / `flash_project` / `clean_project` plus read resources
`project://config|status|devices`. **Evaluated 2026-07; decision: do not adopt.**

- **build / set_target / clean are redundant** — `scripts/idf-docker.sh idf.py …` already does this,
  allowlisted (no prompt) and pinned to the exact CI ESP-IDF version.
- **`flash_project` is impossible *and* unsafe here** — Docker Desktop on macOS has no USB
  passthrough (the project flashes from the host with `esptool` for this reason), and it would flash
  the **unsigned** image, which crash-loops on this Secure Boot v2 board — bypassing the mandatory
  sign step, `scripts/require-signed.sh`, and `$flash-esp32`.
- **The native install path the blog recommends needs a local ESP-IDF** (EIM), which this project
  rejects by design — `scripts/idf-docker.sh` is the single build path, so nothing drifts from CI.
- **Nothing for the fast loop** — `scripts/run-mock-tests.sh` (host logic tests) is untouched.

`idf.py mcp-server` *does* exist in the pinned `espressif/idf:v6.0.2` image (verified), so this is a
"no benefit," not a "can't." Re-evaluate only if builds move to a native host ESP-IDF, macOS gains
Docker USB passthrough, or the board drops Secure Boot v2. A read-only ESP-IDF **Documentation** MCP
server would be harmless if ever wanted; library docs are already covered by `context7`.

## Repository agent tooling

This developer-only integration is separate from the device's `/mcp` endpoint. The canonical Codex
configuration in [`.codex/config.toml`](../.codex/config.toml) and the compatible `mcpServers`
configuration in [`.mcp.json`](../.mcp.json) both start
`@upstash/context7-mcp@4.0.2`. Version `4.0.2` is the reviewed public-main pin;
pinning it instead of `@latest` makes a checkout use the same server across runners and prevents an
unreviewed registry release from changing the agent's documentation surface. Keep both files on the
same explicit version and update them deliberately after reviewing the new package version.

Context7 is for library-documentation lookup only. It neither exposes the heat pump nor changes the
read-only device MCP contract above. `.mcp.json` remains supported for Claude and other compatible
clients while `.codex/config.toml` is the canonical Codex entry point.
