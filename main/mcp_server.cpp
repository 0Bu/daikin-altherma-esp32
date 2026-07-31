// /mcp — read-only Model Context Protocol server for AI agents. Streamable HTTP, one stateless
// JSON-RPC 2.0 message per POST, GET -> 405 (no SSE). logic/mcp.hpp owns all parsing, dispatch and
// fixed result envelopes; this device glue only supplies the same snapshots as /status and /values.
#include "http_handlers.hpp"
#include "logic/mcp.hpp"
#include "wifi.hpp"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include <string>

namespace daik {

static esp_err_t mcp_transport_error(httpd_req_t* req, const char* status, const char* message) {
    httpd_resp_set_status(req, status);
    const std::string response = mcp_error("null", -32600, message);
    return http_send_json(req, response.c_str());
}

static esp_err_t mcp_post(httpd_req_t* req) {
    // Streamable HTTP requires Origin validation against DNS rebinding. Native MCP clients omit the
    // header; browser-originated calls must name the device's fixed mDNS host or its current IP.
    const size_t origin_len = httpd_req_get_hdr_value_len(req, "Origin");
    if (origin_len) {
        char origin[96];
        if (origin_len >= sizeof(origin) ||
            httpd_req_get_hdr_value_str(req, "Origin", origin, sizeof(origin)) != ESP_OK ||
            !mcp_origin_allowed(origin, CONFIG_DAIKIN_HOSTNAME, wifi_info().ip))
            return mcp_transport_error(req, "403 Forbidden", "Origin not allowed");
    }

    // Stateless operation still honours the per-request negotiated-version header. Its absence is
    // the specification's 2025-03-26 compatibility default; a present unknown revision fails closed.
    const size_t version_len = httpd_req_get_hdr_value_len(req, "MCP-Protocol-Version");
    if (version_len) {
        char version[24];
        if (version_len >= sizeof(version) ||
            httpd_req_get_hdr_value_str(req, "MCP-Protocol-Version",
                                        version, sizeof(version)) != ESP_OK ||
            !mcp_protocol_supported(version))
            return mcp_transport_error(req, "400 Bad Request",
                                       "Unsupported MCP-Protocol-Version");
    }

    char body[1024];
    const int n = http_read_body(req, body, sizeof(body));
    McpRequest r = mcp_parse(n >= 0 ? body : nullptr, n);

    // Streamable HTTP accepts notifications with 202 and no body. There is deliberately no session
    // state to mutate; notifications/initialized is accepted in the same way as any valid notice.
    if (r.notification) {
        httpd_resp_set_status(req, "202 Accepted");
        return httpd_resp_send(req, nullptr, 0);
    }

    if (r.error) {
        // Parse/Request failures are malformed HTTP inputs. Method/param/tool errors are valid
        // JSON-RPC calls and therefore ride in a normal application/json response.
        if (r.error == -32700 || r.error == -32600)
            httpd_resp_set_status(req, "400 Bad Request");
        const std::string response = mcp_error(r.id_raw, r.error, mcp_error_message(r));
        return http_send_json(req, response.c_str());
    }

    std::string response;
    mcp_result_begin(response, r.id_raw);
    switch (r.method) {
        case McpMethod::Initialize:
            response += mcp_initialize_result(r.protocol_version,
                                              esp_app_get_description()->version);
            break;
        case McpMethod::ToolsList:
            response += mcp_tools_list_result();
            break;
        case McpMethod::ToolsCall:
            if (r.tool == "get_status") {
                mcp_tool_result_begin(response, "Current device and heat-pump status.");
                http_append_status_json(response, false);
            } else {
                mcp_tool_result_begin(response, "Current decoded heat-pump readings.");
                http_append_values_json(response);
            }
            mcp_tool_result_end(response);
            break;
        default:
            response += "{}";  // unreachable: mcp_parse maps an unknown method to -32601
            break;
    }
    mcp_result_end(response);
    return http_send_json(req, response.c_str());
}

static esp_err_t mcp_get(httpd_req_t* req) {
    httpd_resp_set_status(req, "405 Method Not Allowed");
    httpd_resp_set_hdr(req, "Allow", "POST");
    return httpd_resp_sendstr(req, "POST only");
}

void http_register_mcp(httpd_handle_t s, HttpSurface surface) {
    // MCP is trusted-LAN only — never exposed on the open setup AP (F01).
    http_register_on(s, surface, "/mcp", HTTP_POST, mcp_post);
    http_register_on(s, surface, "/mcp", HTTP_GET, mcp_get);
}

} // namespace daik
