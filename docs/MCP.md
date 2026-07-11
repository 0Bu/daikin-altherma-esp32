# MCP integration

The device exposes a small **Model Context Protocol** server at `POST /mcp` so AI agents (Claude
Code/Desktop, VS Code, the Python SDK, …) can read heat-pump state directly. It is **read-only** —
the tools only *read* cached values, mirroring the read-only nature of the whole device (it never
changes heat-pump settings).

> Transport: **Streamable HTTP**, stateless JSON-RPC 2.0. `GET /mcp` → `405` (no SSE). Same
> trusted-LAN-only caveat as the rest of the API — no auth/TLS, keep it on your LAN.

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `get_status` | — | device/WiFi/MQTT/heat-pump health (same shape as `GET /status`) |
| `get_hp_values` | — | the latest decoded readings (same shape as `GET /values`) |

*(The MCP core is a work in progress — see `main/mcp_server.cpp`. The JSON-RPC method routing
belongs in a host-tested `main/logic/mcp.hpp`.)*

## Client config

Claude Desktop / Code (`mcpServers`):

```json
{
  "mcpServers": {
    "daikin-altherma": {
      "type": "http",
      "url": "http://daikin-altherma.local/mcp"
    }
  }
}
```

## Wire example

```bash
curl -s http://daikin-altherma.local/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```
