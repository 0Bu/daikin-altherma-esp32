// /mcp — Model Context Protocol server for AI agents (Streamable HTTP, stateless JSON-RPC 2.0;
// GET -> 405, no SSE). Read-only tools mirror the read-only nature of the device: get_status and
// get_hp_values (never controls the heat pump). The JSON-RPC core belongs in logic/mcp.hpp
// (host-tested) once fleshed out.
#include "http_handlers.hpp"
#include "esp_http_server.h"

namespace daik {

// TODO: implement initialize / tools/list / tools/call (get_status, get_hp_values). For now a
// minimal well-formed JSON-RPC error so the route exists and clients get a clean response.
static esp_err_t mcp_post(httpd_req_t* req) {
    char body[1024];
    // Checked even though the stub never reads `body`: http_read_body leaves the buffer untouched
    // when it fails (empty or oversized body, stalled or vanished peer), so the tools/call
    // implementation that starts parsing here must not inherit uninitialised stack. id is null
    // because a body we could not read is a body we could not find an id in. Same guard as the
    // /set_* handlers in http_config.cpp.
    if (http_read_body(req, body, sizeof(body)) < 0) {
        httpd_resp_set_status(req, "400 Bad Request");
        return http_send_json(
            req, "{\"jsonrpc\":\"2.0\",\"id\":null,"
                 "\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}");
    }
    return http_send_json(
        req, "{\"jsonrpc\":\"2.0\",\"id\":null,"
             "\"error\":{\"code\":-32601,\"message\":\"MCP not yet implemented\"}}");
}

static esp_err_t mcp_get(httpd_req_t* req) {
    httpd_resp_set_status(req, "405 Method Not Allowed");
    return httpd_resp_sendstr(req, "POST only");
}

void http_register_mcp(httpd_handle_t s) {
    http_register(s, "/mcp", HTTP_POST, mcp_post);
    http_register(s, "/mcp", HTTP_GET, mcp_get);
}

} // namespace daik
