# MCP integration

> **Status: PLANNED — not yet implemented.** The `POST /mcp` route exists, but it does not yet
> serve any tools. Today it only returns a **spec-compliant JSON-RPC 2.0 error** (policy host-tested in
> `main/logic/mcp_jsonrpc.hpp`): a body that isn't valid JSON → `-32700` *Parse error* (`id:null`); a
> structurally-invalid request → `-32600` *Invalid Request* (`id:null`); a well-formed **notification**
> (no `id`) → **no response** (`204`); a well-formed call → `-32601` *Method not found* with the
> request's own `id` echoed (a number/string/null id only — array/object/boolean ids are never
> mirrored). The tools, client config and wire example below describe the **intended** surface once the
> read-only tools land (`main/mcp_server.cpp`) — a design target, not shipped behaviour.

The device is planned to expose a small **Model Context Protocol** server at `POST /mcp` so AI agents
(Claude Code/Desktop, VS Code, the Python SDK, …) can read heat-pump state directly. It will be
**read-only** — the tools only *read* cached values, mirroring the read-only nature of the whole
device (it never changes heat-pump settings).

> Transport: **Streamable HTTP**, stateless JSON-RPC 2.0. `GET /mcp` → `405` (no SSE). Same
> trusted-LAN-only caveat as the rest of the API — no auth/TLS, keep it on your LAN.

## Tools (planned)

| Tool | Args | Returns |
|------|------|---------|
| `get_status` | — | device/WiFi/MQTT/heat-pump health (same shape as `GET /status`) |
| `get_hp_values` | — | the latest decoded readings (same shape as `GET /values`) |

## Client config (once implemented)

Claude Desktop / Code (`mcpServers`):

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
curl -s http://daikin-altherma-esp32.local/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
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
  sign step, `scripts/require-signed.sh`, and the `flash-esp32` skill.
- **The native install path the blog recommends needs a local ESP-IDF** (EIM), which this project
  rejects by design — `scripts/idf-docker.sh` is the single build path, so nothing drifts from CI.
- **Nothing for the fast loop** — `scripts/run-mock-tests.sh` (host logic tests) is untouched.

`idf.py mcp-server` *does* exist in the pinned `espressif/idf:v6.0.2` image (verified), so this is a
"no benefit," not a "can't." Re-evaluate only if builds move to a native host ESP-IDF, macOS gains
Docker USB passthrough, or the board drops Secure Boot v2. A read-only ESP-IDF **Documentation** MCP
server would be harmless if ever wanted; library docs are already covered by `context7` in `.mcp.json`.
