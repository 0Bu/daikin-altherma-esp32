// /mcp — read-only Model Context Protocol server for AI agents. Streamable HTTP, one stateless
// JSON-RPC 2.0 message per POST; GET serves the self-documenting dashboard (not SSE). logic/mcp.hpp
// owns all parsing, dispatch and fixed result envelopes; this device glue only supplies the same
// snapshots as /status and /values.
#include "http_handlers.hpp"
#include "logic/mcp.hpp"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include <string>

extern const unsigned char mcp_html_gz_start[] asm("_binary_mcp_html_gz_start");
extern const unsigned char mcp_html_gz_end[]   asm("_binary_mcp_html_gz_end");

namespace daik {

static esp_err_t mcp_transport_error(httpd_req_t* req, const char* status, const char* message) {
    httpd_resp_set_status(req, status);
    const std::string response = mcp_error("null", -32600, message);
    return http_send_json(req, response.c_str());
}

static esp_err_t mcp_post(httpd_req_t* req) {
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
    // One URL, method-selected: a person gets local setup help; an MCP client POSTs the protocol.
    // The static page has no external assets or network activity. Inline CSS/JS is unavoidable
    // because the asset is deliberately one pre-gzipped response in flash.
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(req, "X-Frame-Options", "DENY");
    httpd_resp_set_hdr(req, "Referrer-Policy", "no-referrer");
    httpd_resp_set_hdr(req, "Content-Security-Policy",
                       "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
                       "connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    return http_send_gzip(req, "text/html", mcp_html_gz_start, mcp_html_gz_end);
}

void http_register_mcp(httpd_handle_t s, HttpSurface surface) {
    // MCP is trusted-LAN only — never exposed on the open setup AP (F01).
    http_register_on(s, surface, "/mcp", HTTP_POST, mcp_post);
    http_register_on(s, surface, "/mcp", HTTP_GET, mcp_get);
}

} // namespace daik
