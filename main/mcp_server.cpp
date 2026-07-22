// /mcp — Model Context Protocol server for AI agents (Streamable HTTP, stateless JSON-RPC 2.0;
// GET -> 405, no SSE). PLANNED (docs/MCP.md): the read-only tools (get_status, get_hp_values) are
// not implemented yet. What runs today is only the JSON-RPC ERROR envelope, made spec-compliant: the
// decision (parse error / invalid request / notification-no-response / method-not-found + which id to
// echo) is the host-tested pure policy in logic/mcp_jsonrpc.hpp; this file only extracts the request
// shape with cJSON and renders the chosen response.
#include "http_handlers.hpp"
#include "logic/json.hpp"          // json_quote — the shared RFC 8259 string encoder
#include "logic/mcp_jsonrpc.hpp"   // the host-tested JSON-RPC 2.0 response policy
#include "cJSON.h"
#include "esp_http_server.h"
#include <string>

namespace daik {

static esp_err_t mcp_post(httpd_req_t* req) {
    char body[1024];
    const bool body_read = http_read_body(req, body, sizeof(body)) >= 0;   // false: empty/oversized/stalled
    cJSON* j = body_read ? cJSON_Parse(body) : nullptr;

    // Extract only the shape facts the policy needs — never trust any single field beyond its type.
    JrRequest r;
    r.valid_json = (j != nullptr);
    std::string id_json = "null";   // the request's own id, rendered as JSON (for the -32601 echo)
    if (j) {
        r.is_object = cJSON_IsObject(j);
        const cJSON* ver = cJSON_GetObjectItem(j, "jsonrpc");
        r.jsonrpc_ok = ver && cJSON_IsString(ver) && ver->valuestring &&
                       std::string(ver->valuestring) == "2.0";
        const cJSON* method = cJSON_GetObjectItem(j, "method");
        r.has_method = method && cJSON_IsString(method);
        const cJSON* id = cJSON_GetObjectItem(j, "id");
        if (!id)                     r.id_kind = JrIdKind::None;      // absent -> notification
        else if (cJSON_IsNull(id))   r.id_kind = JrIdKind::Null;
        else if (cJSON_IsNumber(id)) r.id_kind = JrIdKind::Number;
        else if (cJSON_IsString(id)) r.id_kind = JrIdKind::String;
        else                         r.id_kind = JrIdKind::Invalid;  // array/object/bool -> not a valid id
        if (r.id_kind == JrIdKind::Number || r.id_kind == JrIdKind::String) {
            char* printed = cJSON_PrintUnformatted(id);   // echo a number/string id verbatim
            if (printed) { id_json = printed; cJSON_free(printed); }
        }
    }
    if (j) cJSON_Delete(j);

    const JrDecision d = mcp_jsonrpc_decide(r);

    // A JSON-RPC notification (well-formed request with no id) gets NO response body (spec §4.1).
    if (d.action == JrAction::NoResponse) {
        httpd_resp_set_status(req, "204 No Content");
        return httpd_resp_send(req, nullptr, 0);
    }

    const std::string echoed = mcp_jsonrpc_echo_id(d) ? id_json : std::string("null");
    const std::string resp = "{\"jsonrpc\":\"2.0\",\"id\":" + echoed +
                             ",\"error\":{\"code\":" + std::to_string(d.code) +
                             ",\"message\":" + json_quote(mcp_jsonrpc_message(d.code)) + "}}";
    // -32601 is a well-formed CALL whose method isn't implemented -> the error rides in a 200 body;
    // -32700 / -32600 are bad input -> 400.
    httpd_resp_set_status(req, d.code == -32601 ? "200 OK" : "400 Bad Request");
    return http_send_json(req, resp.c_str());
}

static esp_err_t mcp_get(httpd_req_t* req) {
    httpd_resp_set_status(req, "405 Method Not Allowed");
    return httpd_resp_sendstr(req, "POST only");
}

void http_register_mcp(httpd_handle_t s, HttpSurface surface) {
    // MCP is trusted-LAN only — never exposed on the open setup AP (F01).
    http_register_on(s, surface, "/mcp", HTTP_POST, mcp_post);
    http_register_on(s, surface, "/mcp", HTTP_GET, mcp_get);
}

} // namespace daik
