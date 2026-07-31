#pragma once
// Stateless, read-only MCP/JSON-RPC 2.0 core. This header owns the bounded request parser,
// method/tool dispatch policy and fixed response/catalog builders; mcp_server.cpp is only the
// ESP-IDF transport glue that supplies the already-serialised /status and /values snapshots.
//
// No DOM parser lives here. A request is at most 1 KiB and the recursive scanner is depth-bounded,
// validates the complete JSON grammar, retains a string/number id verbatim for the response, and
// extracts only the fields the three supported methods need. Keeping this IDF-free makes the real
// wire policy host-testable rather than merely testing facts extracted by a different parser.
#include "json.hpp"
#include <cstddef>
#include <string>

namespace daik {

constexpr const char* MCP_PROTOCOL_LATEST = "2025-11-25";

enum class McpMethod { Initialize, ToolsList, ToolsCall, Unknown };
enum class McpIdKind { None, Null, Number, String, Invalid };

struct McpRequest {
    int         error = 0;                    // JSON-RPC error, or zero
    const char* error_message = nullptr;      // static storage; null selects the standard message
    McpMethod   method = McpMethod::Unknown;
    McpIdKind   id_kind = McpIdKind::None;
    std::string id_raw = "null";              // exact number/string token; null otherwise
    std::string protocol_version;             // negotiated initialize version
    std::string tool;                         // tools/call name
    bool        notification = false;          // valid Request without id -> HTTP 202, no body
};

namespace mcp_detail {

class JsonReader {
public:
    JsonReader(const char* begin, const char* end) : p_(begin), end_(end) {}

    void ws() {
        while (p_ < end_ && (*p_ == ' ' || *p_ == '\t' || *p_ == '\r' || *p_ == '\n')) ++p_;
    }

    char peek() {
        ws();
        return p_ < end_ ? *p_ : '\0';
    }

    const char* mark() {
        ws();
        return p_;
    }

    const char* position() const { return p_; }

    bool take(char c) {
        ws();
        if (p_ >= end_ || *p_ != c) return false;
        ++p_;
        return true;
    }

    bool done() {
        ws();
        return p_ == end_;
    }

    bool literal(const char* s) {
        ws();
        for (const char* q = s; *q; ++q) {
            if (p_ >= end_ || *p_ != *q) return false;
            ++p_;
        }
        return true;
    }

    bool number() {
        ws();
        const char* start = p_;
        if (p_ < end_ && *p_ == '-') ++p_;
        if (p_ >= end_) { p_ = start; return false; }
        if (*p_ == '0') {
            ++p_;
            if (p_ < end_ && *p_ >= '0' && *p_ <= '9') { p_ = start; return false; }
        } else {
            if (*p_ < '1' || *p_ > '9') { p_ = start; return false; }
            do { ++p_; } while (p_ < end_ && *p_ >= '0' && *p_ <= '9');
        }
        if (p_ < end_ && *p_ == '.') {
            ++p_;
            if (p_ >= end_ || *p_ < '0' || *p_ > '9') { p_ = start; return false; }
            do { ++p_; } while (p_ < end_ && *p_ >= '0' && *p_ <= '9');
        }
        if (p_ < end_ && (*p_ == 'e' || *p_ == 'E')) {
            ++p_;
            if (p_ < end_ && (*p_ == '+' || *p_ == '-')) ++p_;
            if (p_ >= end_ || *p_ < '0' || *p_ > '9') { p_ = start; return false; }
            do { ++p_; } while (p_ < end_ && *p_ >= '0' && *p_ <= '9');
        }
        return p_ != start;
    }

    bool string(std::string* out = nullptr) {
        ws();
        if (p_ >= end_ || *p_ != '"') return false;
        ++p_;
        if (out) out->clear();
        while (p_ < end_) {
            const unsigned char c = static_cast<unsigned char>(*p_++);
            if (c == '"') return true;
            if (c < 0x20) return false;
            if (c != '\\') {
                if (out) *out += static_cast<char>(c);
                continue;
            }
            if (p_ >= end_) return false;
            const char esc = *p_++;
            switch (esc) {
                case '"':  if (out) *out += '"';  break;
                case '\\': if (out) *out += '\\'; break;
                case '/':  if (out) *out += '/';  break;
                case 'b':  if (out) *out += '\b'; break;
                case 'f':  if (out) *out += '\f'; break;
                case 'n':  if (out) *out += '\n'; break;
                case 'r':  if (out) *out += '\r'; break;
                case 't':  if (out) *out += '\t'; break;
                case 'u': {
                    unsigned cp = 0;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xD800 && cp <= 0xDBFF) {
                        if (p_ + 2 > end_ || p_[0] != '\\' || p_[1] != 'u') return false;
                        p_ += 2;
                        unsigned low = 0;
                        if (!hex4(low) || low < 0xDC00 || low > 0xDFFF) return false;
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                    } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
                        return false;
                    }
                    if (out) append_utf8(*out, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }

    bool value(int depth = 0) {
        if (depth > 16) return false;
        switch (peek()) {
            case '"': return string();
            case '{':
                if (!take('{')) return false;
                if (take('}')) return true;
                for (;;) {
                    if (!string() || !take(':') || !value(depth + 1)) return false;
                    if (take('}')) return true;
                    if (!take(',')) return false;
                }
            case '[':
                if (!take('[')) return false;
                if (take(']')) return true;
                for (;;) {
                    if (!value(depth + 1)) return false;
                    if (take(']')) return true;
                    if (!take(',')) return false;
                }
            case 't': return literal("true");
            case 'f': return literal("false");
            case 'n': return literal("null");
            default:  return number();
        }
    }

private:
    static void append_utf8(std::string& out, unsigned cp) {
        if (cp <= 0x7F) {
            out += static_cast<char>(cp);
        } else if (cp <= 0x7FF) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp <= 0xFFFF) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    bool hex4(unsigned& out) {
        out = 0;
        for (int i = 0; i < 4; ++i) {
            if (p_ >= end_) return false;
            const char c = *p_++;
            unsigned v = 0;
            if (c >= '0' && c <= '9') v = static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') v = static_cast<unsigned>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v = static_cast<unsigned>(c - 'A' + 10);
            else return false;
            out = (out << 4) | v;
        }
        return true;
    }

    const char* p_;
    const char* end_;
};

inline bool object_value(const char* begin, const char* end) {
    JsonReader r(begin, end);
    return r.peek() == '{' && r.value() && r.done();
}

inline bool initialize_params(const char* begin, const char* end, std::string& protocol) {
    JsonReader r(begin, end);
    if (!r.take('{')) return false;
    if (r.take('}')) return r.done();  // tolerate the issue's minimal initialize example
    bool seen_protocol = false;
    for (;;) {
        std::string key;
        if (!r.string(&key) || !r.take(':')) return false;
        if (key == "protocolVersion") {
            if (seen_protocol || !r.string(&protocol)) return false;
            seen_protocol = true;
        } else if (!r.value()) {
            return false;
        }
        if (r.take('}')) return r.done();
        if (!r.take(',')) return false;
    }
}

inline bool no_arguments_object(JsonReader& r) {
    if (!r.take('{')) return false;
    return r.take('}');
}

inline bool tool_params(const char* begin, const char* end, std::string& tool) {
    JsonReader r(begin, end);
    if (!r.take('{')) return false;
    if (r.take('}')) return false;
    bool seen_name = false;
    bool seen_arguments = false;
    for (;;) {
        std::string key;
        if (!r.string(&key) || !r.take(':')) return false;
        if (key == "name") {
            if (seen_name || !r.string(&tool)) return false;
            seen_name = true;
        } else if (key == "arguments") {
            if (seen_arguments || !no_arguments_object(r)) return false;
            seen_arguments = true;
        } else if (!r.value()) {
            return false;
        }
        if (r.take('}')) return r.done() && seen_name;
        if (!r.take(',')) return false;
    }
}

} // namespace mcp_detail

inline bool mcp_protocol_supported(const std::string& requested) {
    // All three revisions use Streamable HTTP and the tool/result subset implemented here.
    return requested == "2025-03-26" ||
           requested == "2025-06-18" ||
           requested == "2025-11-25";
}

inline bool mcp_origin_allowed(const std::string& origin, const std::string& device_hostname,
                               const std::string& device_ip) {
    // Native clients send no Origin. A browser-originated POST is accepted only when it names this
    // device directly; comparing it to the Host header would preserve the DNS-rebinding hole because
    // a rebound attack deliberately keeps its hostile Host/Origin pair unchanged.
    if (origin.empty()) return true;
    if (!device_hostname.empty()) {
        const std::string mdns = "http://" + device_hostname + ".local";
        if (origin == mdns || origin == mdns + ":80") return true;
    }
    if (device_ip.empty()) return false;
    const std::string base = "http://" + device_ip;
    return origin == base || origin == base + ":80";
}

inline McpRequest mcp_parse(const char* body, int len) {
    McpRequest out;
    if (!body || len <= 0) { out.error = -32700; return out; }

    using mcp_detail::JsonReader;
    JsonReader r(body, body + len);
    if (r.peek() != '{') {
        out.error = r.value() && r.done() ? -32600 : -32700;
        return out;
    }
    if (!r.take('{')) { out.error = -32700; return out; }

    bool seen_jsonrpc = false;
    bool jsonrpc_ok = false;
    bool seen_method = false;
    bool method_is_string = false;
    bool seen_id = false;
    bool structural_invalid = false;
    bool seen_params = false;
    std::string method;
    const char* params_begin = nullptr;
    const char* params_end = nullptr;

    if (!r.take('}')) {
        for (;;) {
            std::string key;
            if (!r.string(&key) || !r.take(':')) { out.error = -32700; return out; }
            if (key == "jsonrpc") {
                if (seen_jsonrpc) structural_invalid = true;
                seen_jsonrpc = true;
                std::string version;
                if (r.peek() == '"') {
                    if (!r.string(&version)) { out.error = -32700; return out; }
                    jsonrpc_ok = version == "2.0";
                } else if (!r.value()) {
                    out.error = -32700; return out;
                }
            } else if (key == "method") {
                if (seen_method) structural_invalid = true;
                seen_method = true;
                if (r.peek() == '"') {
                    if (!r.string(&method)) { out.error = -32700; return out; }
                    method_is_string = true;
                } else if (!r.value()) {
                    out.error = -32700; return out;
                }
            } else if (key == "id") {
                if (seen_id) structural_invalid = true;
                seen_id = true;
                const char* start = r.mark();
                const char c = r.peek();
                if (c == '"') {
                    if (!r.string()) { out.error = -32700; return out; }
                    out.id_kind = McpIdKind::String;
                    out.id_raw.assign(start, r.position() - start);
                } else if (c == '-' || (c >= '0' && c <= '9')) {
                    if (!r.number()) { out.error = -32700; return out; }
                    out.id_kind = McpIdKind::Number;
                    out.id_raw.assign(start, r.position() - start);
                } else if (c == 'n') {
                    if (!r.literal("null")) { out.error = -32700; return out; }
                    out.id_kind = McpIdKind::Null;
                } else {
                    if (!r.value()) { out.error = -32700; return out; }
                    out.id_kind = McpIdKind::Invalid;
                }
            } else if (key == "params") {
                if (seen_params) structural_invalid = true;
                seen_params = true;
                params_begin = r.mark();
                if (!r.value()) { out.error = -32700; return out; }
                params_end = r.position();
            } else if (!r.value()) {
                out.error = -32700; return out;
            }
            if (r.take('}')) break;
            if (!r.take(',')) { out.error = -32700; return out; }
        }
    }
    if (!r.done()) { out.error = -32700; return out; }

    if (structural_invalid || !seen_jsonrpc || !jsonrpc_ok || !seen_method ||
        !method_is_string || out.id_kind == McpIdKind::Invalid) {
        out.error = -32600;
        out.id_raw = "null";
        return out;
    }
    if (!seen_id) {
        out.id_kind = McpIdKind::None;
        out.notification = true;
        return out;
    }

    if (method == "initialize") {
        out.method = McpMethod::Initialize;
        if (seen_params &&
            !mcp_detail::initialize_params(params_begin, params_end, out.protocol_version)) {
            out.error = -32602;
            return out;
        }
        if (!mcp_protocol_supported(out.protocol_version))
            out.protocol_version = MCP_PROTOCOL_LATEST;
        return out;
    }
    if (method == "tools/list") {
        out.method = McpMethod::ToolsList;
        if (seen_params && !mcp_detail::object_value(params_begin, params_end)) out.error = -32602;
        return out;
    }
    if (method == "tools/call") {
        out.method = McpMethod::ToolsCall;
        if (!seen_params || !mcp_detail::tool_params(params_begin, params_end, out.tool)) {
            out.error = -32602;
            return out;
        }
        if (out.tool != "get_status" && out.tool != "get_hp_values") {
            out.error = -32601;
            out.error_message = "Tool not found";
        }
        return out;
    }

    out.error = -32601;
    return out;
}

inline const char* mcp_error_message(const McpRequest& r) {
    if (r.error_message) return r.error_message;
    switch (r.error) {
        case -32700: return "Parse error";
        case -32600: return "Invalid Request";
        case -32601: return "Method not found";
        case -32602: return "Invalid params";
        default:     return "Error";
    }
}

inline std::string mcp_error(const std::string& id_raw, int code, const char* message) {
    std::string out = "{\"jsonrpc\":\"2.0\",\"id\":";
    out += id_raw.empty() ? "null" : id_raw;
    out += ",\"error\":{\"code\":";
    out += std::to_string(code);
    out += ",\"message\":";
    out += json_quote(message ? message : "Error");
    out += "}}";
    return out;
}

inline std::string mcp_result(const std::string& id_raw, const std::string& result_json) {
    std::string out;
    out += "{\"jsonrpc\":\"2.0\",\"id\":";
    out += id_raw.empty() ? "null" : id_raw;
    out += ",\"result\":";
    out += result_json;
    out += "}";
    return out;
}

inline void mcp_result_begin(std::string& out, const std::string& id_raw) {
    out += "{\"jsonrpc\":\"2.0\",\"id\":";
    out += id_raw.empty() ? "null" : id_raw;
    out += ",\"result\":";
}

inline void mcp_result_end(std::string& out) {
    out += "}";
}

inline std::string mcp_initialize_result(const std::string& protocol_version,
                                         const char* server_version) {
    std::string out = "{\"protocolVersion\":";
    out += json_quote(protocol_version.empty() ? MCP_PROTOCOL_LATEST : protocol_version);
    out += ",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":"
           "\"daikin-altherma-esp32\",\"version\":";
    out += json_quote(server_version ? server_version : "");
    out += "}}";
    return out;
}

inline const char* mcp_tools_list_result() {
    return
        "{\"tools\":["
        "{\"name\":\"get_status\","
        "\"description\":\"Read-only device and heat-pump status (version, uptime, WiFi, MQTT, "
        "bus health, detected model).\","
        "\"inputSchema\":{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false},"
        "\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,"
        "\"idempotentHint\":true,\"openWorldHint\":false}},"
        "{\"name\":\"get_hp_values\","
        "\"description\":\"Read-only snapshot of the latest decoded heat-pump readings.\","
        "\"inputSchema\":{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false},"
        "\"annotations\":{\"readOnlyHint\":true,\"destructiveHint\":false,"
        "\"idempotentHint\":true,\"openWorldHint\":false}}"
        "]}";
}

inline void mcp_tool_result_begin(std::string& out, const char* summary) {
    // Modern MCP clients consume structuredContent. A short TextContent block keeps the mandatory
    // content array useful without serialising + escaping the complete snapshot a second time — on
    // this board that duplicate contiguous buffer is a materially worse heap peak than /values.
    out += "{\"content\":[{\"type\":\"text\",\"text\":";
    out += json_quote(summary ? summary : "Read-only snapshot");
    out += "}],\"structuredContent\":";
}

inline void mcp_tool_result_end(std::string& out) {
    out += ",\"isError\":false}";
}

inline std::string mcp_tool_result(const std::string& structured_json, const char* summary) {
    std::string out;
    mcp_tool_result_begin(out, summary);
    out += structured_json;
    mcp_tool_result_end(out);
    return out;
}

} // namespace daik
