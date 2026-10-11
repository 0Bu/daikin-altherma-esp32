# MCP integration

The device offers two read-only Model Context Protocol tools at **`POST /mcp`**. They reuse cached
HTTP status/value snapshots; they do not command the heat pump, alter configuration or reach another
source. Keep this unauthenticated, plaintext HTTP endpoint on a trusted LAN.

## Set up a client

Open `http://daikin-altherma-esp32.local/mcp` in a browser. **`GET /mcp`** is a device-local setup
page, not an event stream. It shows the actual serving URL, copyable configuration, a curl example
and the two tools. The page makes no requests and has no external assets (`connect-src 'none'`).

For a client accepting the common `mcpServers` HTTP shape:

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

Use the current device IP if mDNS does not resolve. Configure the URL format required by your client.

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `get_status` | Omitted or empty object | Complete `GET /status` snapshot as `structuredContent`. |
| `get_hp_values` | Omitted or empty object | Complete `GET /values` X10A/HomeHub snapshot as `structuredContent`. |

Each result also has a short text summary. The full JSON is emitted once, in 1 KiB chunks, instead of
being duplicated as escaped text. X10A/HomeHub values are staged before the first byte. Source
absence/held readings and HTTP fields follow [API.md](API.md); read-only access does not strengthen
the physical truth of a reading. In `get_status`, `detect.model` contains only identity fields
established by the candidate set: unestablished fields are null, or the whole object is null if
nothing is established. `profile.id` names the table actually read; its best pick among
indistinguishable candidates does not establish the physical unit's identity.

## Protocol contract

Transport is **stateless Streamable HTTP**, JSON-RPC 2.0, with no session id, SSE or retained request
state. Request bodies must declare `application/json` and are bounded to **1 KiB**.

- `initialize` negotiates `2025-03-26`, `2025-06-18` or `2025-11-25`; missing/unsupported requested
  revision receives the latest supported revision, `2025-11-25`.
- `tools/list` returns exactly the two tools with read-only annotations.
- `tools/call` accepts only those names and no non-empty arguments.
- Valid notifications return HTTP **202** with no body.
- Parse/request/method/parameter errors use `-32700` / `-32600` / `-32601` / `-32602`. Unknown tools use
  `-32601`. Valid string, number or null request ids are echoed exactly.
- A present `MCP-Protocol-Version` header must name one of the supported revisions. If absent, the
  Streamable-HTTP compatibility default applies.

Native clients may omit `Origin`; an HTTP/1.0 probe may also omit `Host`. When supplied, Host and
browser Origin must name the device's mDNS hostname or current WiFi/Ethernet IP, optionally `:80`.
Cross-site Fetch Metadata is rejected with HTTP **403**.
[SECURITY.md](SECURITY.md) owns these LAN/browser boundaries.

During OTA TLS the entire MCP POST returns **503 text/plain** before parsing or snapshot allocation:
`Network TLS operation in progress; retry shortly`. Outside OTA, `get_hp_values` waits behind Weather
TLS in 250 ms steps for at most four seconds; exhaustion returns **503 text/plain**,
`network operation in progress`, before any result byte. These busy responses are transport errors,
not JSON-RPC objects. Retry the complete read-only call later. All route invocations retain the
shared allocation-failure boundary.

## Wire example

```bash
BASE=http://daikin-altherma-esp32.local

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s "$BASE/mcp" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_hp_values","arguments":{}}}'
```

Parser/dispatcher: [`logic/mcp.hpp`](../main/logic/mcp.hpp); HTTP implementation:
[`mcp_server.cpp`](../main/mcp_server.cpp). Repository library-documentation tooling is separate from
this device endpoint. Its pinned `.mcp.json` configuration and generated native Codex registration
in `.codex/config.toml`, including effective-discovery checks, are described in
[AGENT_MIGRATION.md](AGENT_MIGRATION.md).
