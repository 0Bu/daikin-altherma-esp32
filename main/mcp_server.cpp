// /mcp — Model Context Protocol server for AI agents (Streamable HTTP, stateless JSON-RPC 2.0;
// GET -> 405, no SSE). Read-only tools mirror the read-only nature of the device: get_status and
// get_hp_values (never controls the heat pump). Ported in shape from tesla-key-esp32/
// mcp_server.cpp; the JSON-RPC core belongs in logic/mcp.hpp (host-tested) once fleshed out.
#include "http_handlers.hpp"
#include "esp_http_server.h"

namespace daik {

// TODO: implement initialize / tools/list / tools/call (get_status, get_hp_values). For now a
// minimal well-formed JSON-RPC error so the route exists and clients get a clean response.
static esp_err_t mcp_post(httpd_req_t* req) {
    char body[1024];
    http_read_body(req, body, sizeof(body));
    return http_send_json(
        req, "{\"jsonrpc\":\"2.0\",\"id\":null,"
             "\"error\":{\"code\":-32601,\"message\":\"MCP not yet implemented\"}}");
}

static esp_err_t mcp_get(httpd_req_t* req) {
    httpd_resp_set_status(req, "405 Method Not Allowed");
    return httpd_resp_sendstr(req, "POST only");
}

void http_register_mcp(httpd_handle_t s) {
    httpd_uri_t post = {"/mcp", HTTP_POST, mcp_post, nullptr};
    httpd_uri_t get  = {"/mcp", HTTP_GET, mcp_get, nullptr};
    httpd_register_uri_handler(s, &post);
    httpd_register_uri_handler(s, &get);
}

} // namespace daik
