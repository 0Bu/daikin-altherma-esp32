#pragma once
// JSON-RPC 2.0 response policy for the (planned) MCP route (F14). The device parses the request body
// with cJSON (mcp_server.cpp) and extracts a few shape facts into JrRequest; this pure logic then
// decides the interim response — which is all the route can give until the read-only tools land.
// Keeping the decision HERE, not inline in the handler, is what makes the spec rules host-tested
// (test/test_logic.cpp) instead of asserted:
//   • a body that is not valid JSON            -> Parse error     (-32700), id null
//   • a structurally-invalid Request object    -> Invalid Request (-32600), id null
//     (not a JSON object, "jsonrpc" != "2.0", no string "method", or an id that is not
//      string/number/null — arrays / objects / booleans are NOT valid ids and must not be mirrored)
//   • a well-formed NOTIFICATION (no id)       -> NO response at all (JSON-RPC 2.0 §4.1)
//   • a well-formed request with a valid id    -> Method not found (-32601), the request's id echoed
// See https://www.jsonrpc.org/specification. The previous stub returned -32601 with id:null for every
// syntactically-valid JSON value — it could not tell a malformed request from a real call, answered
// notifications, and mirrored array/object ids.
namespace daik {

enum class JrIdKind { None, Null, Number, String, Invalid };  // None = absent; Invalid = array/object/bool

struct JrRequest {
    bool     valid_json = false;   // did the body parse as JSON at all?
    bool     is_object  = false;   // top-level is a JSON object
    bool     jsonrpc_ok = false;   // has "jsonrpc" == "2.0"
    bool     has_method = false;   // has "method", and it is a string
    JrIdKind id_kind    = JrIdKind::None;
};

enum class JrAction { NoResponse, Error };

struct JrDecision {
    JrAction action = JrAction::Error;
    int      code   = 0;   // JSON-RPC error code (meaningful when action == Error)
};

inline JrDecision mcp_jsonrpc_decide(const JrRequest& r) {
    if (!r.valid_json) return { JrAction::Error, -32700 };
    if (!r.is_object || !r.jsonrpc_ok || !r.has_method || r.id_kind == JrIdKind::Invalid)
        return { JrAction::Error, -32600 };
    if (r.id_kind == JrIdKind::None) return { JrAction::NoResponse, 0 };   // notification: no reply
    return { JrAction::Error, -32601 };
}

// Only a well-formed call (-32601) echoes the request's own id; a parse / invalid-request error uses
// null, because the id can't be trusted when the request itself is malformed (spec).
inline bool mcp_jsonrpc_echo_id(const JrDecision& d) {
    return d.action == JrAction::Error && d.code == -32601;
}

inline const char* mcp_jsonrpc_message(int code) {
    switch (code) {
        case -32700: return "Parse error";
        case -32600: return "Invalid Request";
        case -32601: return "Method not found";
        default:     return "Error";
    }
}

}  // namespace daik
