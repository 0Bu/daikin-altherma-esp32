#include "sdk.hpp"
#include <cstdarg>
#include <cstdlib>
#include <functional>
#include <new>
#include <stdexcept>
#include <unistd.h>
#include <fcntl.h>
#include "http_handlers.hpp"
#include "stack_watch.hpp"

namespace fixture {
inline std::string oracle;
inline bool        ap = false, download = false, busy = false;
inline size_t      largest       = 32768;
inline unsigned    handler_calls = 0, status_calls = 0, values_calls = 0, stack_samples = 0;
inline unsigned    status_generation = 7, values_generation = 19;
inline int         failure = 0;
inline bool        fail_nothrow = false;
inline std::string status_prefix, status_suffix, values_prefix, values_suffix;
[[noreturn]] void  fail(const char* reason) {
    std::fprintf(stderr, "FAIL %s: %s\n", oracle.c_str(), reason);
    std::exit(1);
}
void check(bool value, const char* reason) {
    if (!value) fail(reason);
}
esp_err_t handler(httpd_req_t* req, const char* name);
} // namespace fixture

void* operator new(size_t size, const std::nothrow_t&) noexcept {
    if (fixture::fail_nothrow) return nullptr;
    try {
        return ::operator new(size);
    } catch (...) {
        return nullptr;
    }
}

#include HTTP_COMMON_SOURCE
#include HTTP_SERVER_SOURCE
#include MCP_SERVER_SOURCE
#include ROUTE_GROUP_SOURCE

// Flash asset link symbols are supplied by the adapter, not copied from the device image.
asm(".globl _binary_mcp_html_gz_start\n"
    "_binary_mcp_html_gz_start:\n.byte 31,139,8,0,102,105,120,116,117,114,101\n"
    ".globl _binary_mcp_html_gz_end\n_binary_mcp_html_gz_end:\n");

namespace fixture {
void reset() {
    for (auto& [fd, session] : sdk::sessions)
        if (session.context && session.free_context) session.free_context(session.context);
    sdk::sessions.clear();
    sdk::fail_receive_override = false;
    ap = download = busy = false;
    largest              = 32768;
    handler_calls = status_calls = values_calls = stack_samples = 0;
    status_generation                                           = 7;
    values_generation                                           = 19;
    failure                                                     = 0;
    fail_nothrow                                                = false;
    status_prefix.clear();
    status_suffix.clear();
    values_prefix.clear();
    values_suffix.clear();
    sdk::routes.clear();
    sdk::config            = {};
    sdk::fail_start        = false;
    sdk::fail_registration = -1;
    sdk::start_calls = sdk::registration_calls = 0;
    sdk::log.clear();
    sdk::now = sdk::clock_step = 0;
}
std::string snapshot(bool status) {
    if (status)
        return "{\"version\":\"snapshot-" + std::to_string(status_generation) +
               "\",\"sys\":{\"uptime\":" + std::to_string(status_generation) +
               "},\"hp\":{\"state\":\"idle\"}}";
    return "{\"profile\":\"fixture\",\"generation\":" + std::to_string(values_generation) +
           ",\"values\":{\"unicode\":\"Wärmepumpe\",\"quoted\":\"a\\\"b\\\\c\",\"padding\":\"" +
           std::string(2600, 'x') + "\"}}";
}
esp_err_t stream(httpd_req_t* req, std::string_view prefix, std::string_view suffix, bool status) {
    if (failure == 1) throw std::bad_alloc();
    if (failure == 2) throw std::runtime_error("injected snapshot exception");
    if (failure == 3) return ESP_FAIL;
    httpd_resp_set_type(req, "application/json");
    const std::string data = snapshot(status);
    for (const auto part : {prefix, std::string_view(data), suffix}) {
        for (size_t off = 0; off < part.size(); off += 512) {
            const auto error = httpd_resp_send_chunk(req, part.data() + off,
                                                     std::min<size_t>(512, part.size() - off));
            if (error != ESP_OK) return error;
        }
    }
    return httpd_resp_send_chunk(req, nullptr, 0);
}
esp_err_t handler(httpd_req_t* req, const char* name) {
    ++handler_calls;
    if (std::strcmp(name, "h_status") == 0) return daik::http_send_status_json(req);
    if (std::strcmp(name, "h_values") == 0) return daik::http_send_values_json(req);
    if (failure == 1) throw std::bad_alloc();
    if (failure == 2) throw std::runtime_error("injected route exception");
    if (failure == 3) return ESP_FAIL;
    return httpd_resp_sendstr(req, name);
}
void start(bool setup = false) {
    ap = setup;
    daik::http_start();
}
httpd_req_t request(std::string body = {}) {
    httpd_req_t req;
    req.body                            = std::move(body);
    req.content_len                     = req.body.size();
    req.headers["Host"]                 = "daikin-altherma-esp32.local";
    req.headers["Content-Type"]         = "application/json";
    req.headers["MCP-Protocol-Version"] = "2025-11-25";
    return req;
}
esp_err_t dispatch(httpd_req_t& req, const char* uri, int method) {
    req.uri                = uri;
    req.method             = method;
    const std::string path = std::string(uri).substr(0, std::string(uri).find('?'));
    for (const auto& route : sdk::routes) {
        if (route.method != method || (route.uri != path && std::strcmp(route.uri, "/*") != 0))
            continue;
        req.user_ctx      = route.user_ctx;
        const auto result = route.handler(&req);
        if (result == ESP_OK && req.content_type == "application/json") {
            std::printf("JSONHEX %s ", oracle.c_str());
            for (const unsigned char byte : req.response) std::printf("%02x", byte);
            std::printf("\n");
        }
        return result;
    }
    req.status = "404 Not Found";
    return ESP_OK;
}
httpd_req_t invoke(const char* uri, int method, std::string body = {}) {
    auto req = request(std::move(body));
    check(dispatch(req, uri, method) == ESP_OK, "trampoline did not complete");
    return req;
}
void text(const httpd_req_t& req, const char* key, const char* expected) {
    // Independent leaf-token oracle; Node validates the complete emitted JSON tree too.
    std::string escaped;
    for (const char* c = expected; *c; ++c) {
        if (*c == '"' || *c == '\\') escaped += '\\';
        escaped += *c;
    }
    check(req.response.find(std::string("\"") + key + "\":\"" + escaped + "\"") !=
              std::string::npos,
          "response text differs from oracle");
}
void error(const httpd_req_t& req, int code, const char* id = "null") {
    check(req.response.find(std::string("\"error\":{\"code\":") + std::to_string(code) + ",") !=
              std::string::npos,
          "wrong JSON-RPC error code");
    check(req.response.find(std::string("\"id\":") + id + ",") != std::string::npos,
          "error id differs from wire oracle");
}
const char* tool_request(bool status) {
    return status
               ? R"({"jsonrpc":"2.0","id":"wire-id","method":"tools/call","params":{"name":"get_status","arguments":{}}})"
               : R"({"jsonrpc":"2.0","id":"wire-id","method":"tools/call","params":{"name":"get_hp_values","arguments":{}}})";
}
struct SocketPair {
    int  fd[2]           = {-1, -1};
    bool receiver_closed = false;
    SocketPair() {
        check(socketpair(AF_UNIX, SOCK_STREAM, 0, fd) == 0, "socketpair failed");
        sdk::sessions[fd[1]] = {};
        check(sdk::config.open_fn &&
                  sdk::config.open_fn(reinterpret_cast<void*>(1), fd[1]) == ESP_OK,
              "startup failed to install ingress protection");
        check(sdk::sessions[fd[1]].receive != nullptr, "receive override absent");
    }
    ~SocketPair() {
        auto it = sdk::sessions.find(fd[1]);
        if (it != sdk::sessions.end()) {
            if (it->second.context && it->second.free_context)
                it->second.free_context(it->second.context);
            sdk::sessions.erase(it);
        }
        if (fd[0] >= 0) close(fd[0]);
        if (fd[1] >= 0 && !receiver_closed) close(fd[1]);
    }
    int byte() {
        check(send(fd[0], "x", 1, 0) == 1, "fragment send failed");
        char out = 0;
        return sdk::sessions[fd[1]].receive(reinterpret_cast<void*>(1), fd[1], &out, 1, 0);
    }
};
void reject_headers(const char* key, std::string value) {
    auto req         = request();
    req.headers[key] = std::move(value);
    check(dispatch(req, "/status", HTTP_GET) == ESP_OK, "header rejection broke settlement");
    check(req.status == "403 Forbidden" && handler_calls == 0, "untrusted header reached route");
}
} // namespace fixture

namespace daik {
bool     provisioning_ap_active() { return fixture::ap; }
bool     ota_busy() { return fixture::busy; }
bool     ota_download_active() { return fixture::download; }
size_t   heap_largest_internal_block() { return fixture::largest; }
WifiInfo wifi_info() {
    WifiInfo out{};
    std::strcpy(out.ip, "192.0.2.10");
    return out;
}
EthInfo net_eth_info() {
    EthInfo out{};
    std::strcpy(out.ip, "192.0.2.20");
    return out;
}
void stack_watch_sample(StackWatch slot) noexcept {
    if (slot == StackWatch::Httpd) ++fixture::stack_samples;
}
void diag_printf(const char* format, ...) {
    char    bytes[1024];
    va_list args;
    va_start(args, format);
    std::vsnprintf(bytes, sizeof(bytes), format, args);
    va_end(args);
    sdk::log += bytes;
}
esp_err_t http_send_status_json(httpd_req_t* req, std::string_view prefix, std::string_view suffix,
                                bool redact) {
    ++fixture::status_calls;
    fixture::status_prefix = prefix;
    fixture::status_suffix = suffix;
    fixture::check(!redact, "MCP unexpectedly requested a different status snapshot");
    return fixture::stream(req, prefix, suffix, true);
}
esp_err_t http_send_values_json(httpd_req_t* req, std::string_view prefix,
                                std::string_view suffix) {
    ++fixture::values_calls;
    fixture::values_prefix = prefix;
    fixture::values_suffix = suffix;
    return fixture::stream(req, prefix, suffix, false);
}
} // namespace daik

int main(int argc, char** argv) {
    using namespace fixture;
    const std::string selected = argc > 1 ? argv[1] : "";
    unsigned          cases    = 0;
    auto              run      = [&](const char* name, const std::function<void()>& fn) {
        if (!selected.empty() && selected != name) return;
        oracle = name;
        reset();
        fn();
        ++cases;
        std::printf("PASS %s\n", name);
    };
    run("registration_oracle", [] {
        // Independent checked-in URI/method/order oracle, not counted from production text.
        const std::vector<std::pair<const char*, int>> lan   = {{"/", 0},
                                                                {"/index.html", 0},
                                                                {"/favicon.ico", 0},
                                                                {"/heat-pump-icon.png", 0},
                                                                {"/locale.js", 0},
                                                                {"/status", 0},
                                                                {"/values", 0},
                                                                {"/history", 0},
                                                                {"/scan", 0},
                                                                {"/models", 0},
                                                                {"/diag", 0},
                                                                {"/diag/clear", 1},
                                                                {"/coredump", 0},
                                                                {"/coredump/clear", 1},
                                                                {"/crash/dismiss", 1},
                                                                {"/set_wifi", 1},
                                                                {"/set_mqtt", 1},
                                                                {"/set_ref_temp", 1},
                                                                {"/test_circulation", 1},
                                                                {"/set_circulation", 1},
                                                                {"/set_syslog", 1},
                                                                {"/set_ntp", 1},
                                                                {"/set_weather", 1},
                                                                {"/set_hp", 1},
                                                                {"/discover_homehub", 1},
                                                                {"/set_board", 1},
                                                                {"/set_env3", 1},
                                                                {"/set_ota", 1},
                                                                {"/set_lang", 1},
                                                                {"/set_diagnostics", 1},
                                                                {"/detect", 1},
                                                                {"/hp/query", 1},
                                                                {"/ota/check", 0},
                                                                {"/ota/update", 1},
                                                                {"/ota/status", 0},
                                                                {"/ota/changelog", 0},
                                                                {"/mcp", 1},
                                                                {"/mcp", 0},
                                                                {"/*", 0}};
        const std::vector<std::pair<const char*, int>> setup = {
            {"/", 0}, {"/index.html", 0}, {"/favicon.ico", 0}, {"/set_wifi", 1}, {"/*", 0}};
        for (bool ap_mode : {false, true}) {
            reset();
            start(ap_mode);
            const auto& expected = ap_mode ? setup : lan;
            check(sdk::routes.size() == expected.size(), "AP5/LAN39 exact route count changed");
            for (size_t i = 0; i < expected.size(); ++i) {
                check(sdk::routes[i].uri == std::string(expected[i].first) &&
                          sdk::routes[i].method == expected[i].second,
                      "route URI/method/order changed");
                check(sdk::routes[i].handler == daik::handle_then_settle_body &&
                          sdk::routes[i].user_ctx != nullptr,
                      "route bypassed production trampoline");
            }
            check(sdk::config.max_uri_handlers == 39 && sdk::config.stack_size == 10240 &&
                      sdk::config.lru_purge_enable &&
                      sdk::config.uri_match_fn == httpd_uri_match_wildcard,
                  "server capacity/stack/LRU/wildcard configuration changed");
            check(daik::http_server_handle() != nullptr, "started server handle absent");
        }
    });
    run("startup_and_registration_failures", [] {
        sdk::fail_start = true;
        start();
        check(sdk::start_calls == 1 && sdk::registration_calls == 0 &&
                  sdk::log.find("server start failed") != std::string::npos,
              "server failure must log and stop registration");
        reset();
        sdk::fail_registration = 38;
        start();
        check(sdk::routes.size() == 38 &&
                  sdk::log.find("route /* not registered: ESP_ERR_HTTPD_HANDLERS_FULL") !=
                      std::string::npos,
              "catch-all capacity failure went silent");
        reset();
        start();
        sdk::config.max_uri_handlers = 39;
        daik::http_register(daik::http_server_handle(), "/overflow", HTTP_GET,
                            [](httpd_req_t*) { return ESP_OK; });
        check(sdk::routes.size() == 39 &&
                  sdk::log.find("route /overflow not registered") != std::string::npos,
              "capacity failure changed registration or went silent");
    });
    run("lan_header_policy", [] {
        start();
        for (const auto* host :
             {"evil.example", "daikin-altherma-esp32.local.evil", "192.0.2.99", "user@192.0.2.10"})
            reject_headers("Host", host);
        reject_headers("Host", std::string(96, 'x'));
        reject_headers("Host", "");
        reject_headers("Origin", "");
        reject_headers("Sec-Fetch-Site", "");
        reject_headers("Origin", "https://evil.example");
        reject_headers("Origin", "null");
        reject_headers("Origin", std::string(128, 'x'));
        reject_headers("Sec-Fetch-Site", "cross-site");
        reject_headers("Sec-Fetch-Site", "future-value");
        reject_headers("Sec-Fetch-Site", std::string(24, 'x'));
        auto missing = request();
        missing.headers.erase("Host");
        check(dispatch(missing, "/status", HTTP_GET) == ESP_OK && missing.status == "200 OK",
              "native HTTP1.0 missing Host rejected");
        missing = request();
        missing.headers.erase("Host");
        missing.headers["Sec-Fetch-Site"] = "same-origin";
        check(dispatch(missing, "/status", HTTP_GET) == ESP_OK && missing.status == "403 Forbidden",
              "browser signals without Host accepted");
        auto unreadable          = request();
        unreadable.failed_header = "Host";
        check(dispatch(unreadable, "/status", HTTP_GET) == ESP_OK &&
                  unreadable.status == "403 Forbidden",
              "failed Host read accepted");
        for (const auto* host : {"daikin-altherma-esp32.local", "daikin-altherma-esp32.local:80",
                                 "192.0.2.10", "192.0.2.20"}) {
            auto req                      = request();
            req.headers["Host"]           = host;
            req.headers["Origin"]         = std::string("http://") + host;
            req.headers["Sec-Fetch-Site"] = "same-origin";
            check(dispatch(req, "/status", HTTP_GET) == ESP_OK && req.status == "200 OK",
                  "device WiFi/Ethernet identity rejected");
        }
    });
    run("ap_surface_dispatch", [] {
        start(true);
        auto req            = request();
        req.headers["Host"] = "connectivity-check.example";
        check(dispatch(req, "/status", HTTP_GET) == ESP_OK && req.response == "h_captive" &&
                  status_calls == 0,
              "AP fallback exposed status rather than captive route");
        req                 = request("{}");
        req.headers["Host"] = "arbitrary.example";
        check(dispatch(req, "/set_wifi", HTTP_POST) == ESP_OK && req.response == "set_wifi",
              "AP provisioning Host rejected");
        auto denied = invoke("/mcp", HTTP_POST, "{}");
        check(denied.status == "404 Not Found", "AP exposed MCP POST");
    });
    run("post_media_policy", [] {
        start();
        for (const auto* type : {"text/plain", "application/x-www-form-urlencoded",
                                 "application/json;", "text/html"}) {
            auto req                    = request("{}");
            req.headers["Content-Type"] = type;
            check(dispatch(req, "/set_wifi", HTTP_POST) == ESP_OK &&
                      req.status == "415 Unsupported Media Type" && handler_calls == 0,
                  "non-JSON body reached route");
        }
        auto missing = request("{}");
        missing.headers.erase("Content-Type");
        check(dispatch(missing, "/set_wifi", HTTP_POST) == ESP_OK &&
                  missing.status == "415 Unsupported Media Type",
              "missing media accepted");
        for (const auto* type : {"application/json", "Application/JSON; charset=utf-8"}) {
            auto req                    = request("{}");
            req.headers["Content-Type"] = type;
            check(dispatch(req, "/set_wifi", HTTP_POST) == ESP_OK && req.status == "200 OK",
                  "valid JSON media rejected");
        }
        auto empty = request();
        empty.headers.erase("Content-Type");
        check(dispatch(empty, "/detect", HTTP_POST) == ESP_OK && empty.status == "200 OK",
              "bodyless action requires fake JSON");
    });
    run("ota_exact_route_guard", [] {
        start();
        download = true;
        for (const auto* uri : {"/ota/not-a-route", "/ota", "/ota?x=1", "/ota/status-suffix",
                                "/ota/check/extra", "/ota/update", "/ota/update?x=1"}) {
            const auto req = invoke(uri, HTTP_GET);
            check(req.status == "503 Service Unavailable" && handler_calls == 0,
                  "OTA prefix catch-all bypassed download guard");
        }
        for (const auto* uri : {"/ota/status", "/ota/check", "/ota/changelog", "/ota/status?x=1"})
            check(invoke(uri, HTTP_GET).status == "200 OK", "real OTA GET incorrectly blocked");
        check(invoke("/ota/update", HTTP_POST).status == "200 OK",
              "real OTA update route incorrectly blocked");
        download      = false;
        largest       = 6143;
        handler_calls = 0;
        check(invoke("/ota/not-a-route", HTTP_GET).status == "503 Service Unavailable" &&
                  handler_calls == 0,
              "OTA prefix catch-all bypassed heap guard");
        check(invoke("/ota/status", HTTP_GET).status == "200 OK",
              "real OTA status heap exemption lost");
        largest = 6144;
        check(invoke("/status", HTTP_GET).status == "200 OK", "heap boundary rejected safe block");
        busy          = true;
        handler_calls = 0;
        check(invoke("/ota/update", HTTP_POST).status == "503 Service Unavailable" &&
                  handler_calls == 0,
              "busy POST reached update handler");
        start(true);
        largest = 6143;
        for (const auto* uri : {"/ota/status", "/ota/check", "/ota/changelog", "/ota/update"}) {
            handler_calls = 0;
            check(invoke(uri, HTTP_GET).status == "503 Service Unavailable" && handler_calls == 0,
                  "unregistered AP OTA route bypassed heap guard");
        }
    });
    run("exception_boundary", [] {
        start();
        for (const int mode : {1, 2}) {
            failure  = mode;
            auto req = invoke("/detect", HTTP_POST);
            check(req.status ==
                          (mode == 1 ? "503 Service Unavailable" : "500 Internal Server Error") &&
                      req.response == (mode == 1 ? "out of memory" : "handler error"),
                  "exception crossed SDK C boundary");
        }
        check(stack_samples == 2, "exception exits did not sample httpd stack");
        auto null     = request();
        null.user_ctx = nullptr;
        check(daik::handle_then_settle_body(&null) == ESP_OK &&
                  null.status == "500 Internal Server Error" && stack_samples == 3,
              "missing handler boundary changed");
    });
    run("unread_body_bound", [] {
        start();
        auto req            = request(std::string(8192, 'x'));
        req.headers["Host"] = "evil.example";
        check(dispatch(req, "/detect", HTTP_POST) == ESP_OK && req.recv_bytes == 8192 &&
                  req.recv_calls == 65,
              "bounded unread body not fully settled");
        req                 = request(std::string(9000, 'x'));
        req.headers["Host"] = "evil.example";
        check(dispatch(req, "/detect", HTTP_POST) == ESP_FAIL && req.recv_bytes <= 8320 &&
                  req.recv_calls <= 65,
              "oversized unread body reached unbounded SDK purge");
        req                 = request("unread");
        req.headers["Host"] = "evil.example";
        req.receive_script  = {HTTPD_SOCK_ERR_TIMEOUT};
        check(dispatch(req, "/detect", HTTP_POST) == ESP_FAIL && req.recv_calls == 1,
              "unread timeout retried");
        req                 = request("unread");
        req.headers["Host"] = "evil.example";
        req.receive_script  = {-2};
        check(dispatch(req, "/detect", HTTP_POST) == ESP_FAIL && req.recv_calls == 1,
              "unread receive error ignored");
        req             = request(std::string(200, 'x'));
        req.fragment    = 1;
        sdk::clock_step = 500000;
        check(dispatch(req, "/detect", HTTP_POST) == ESP_FAIL && req.recv_bytes < 10,
              "unread trickle ignored deadline");
    });
    run("initialize_and_revisions", [] {
        start();
        auto req = request(
            R"({"jsonrpc":"2.0","id":"a\"b","method":"initialize","params":{"protocolVersion":"2025-06-18"}})");
        req.headers.erase("MCP-Protocol-Version");
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "200 OK",
              "headerless initialize rejected");
        text(req, "protocolVersion", "2025-06-18");
        text(req, "name", "daikin-altherma-esp32");
        text(req, "version", "fixture-version");
        text(req, "id", "a\"b");
        for (const auto* revision : {"2025-11-25", "2025-03-26", "future"}) {
            const auto r = invoke(
                "/mcp", HTTP_POST,
                std::string(
                    R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":")") +
                    revision + "\"}}");
            text(r, "protocolVersion", "2025-11-25");
        }
    });
    run("tool_catalog", [] {
        start();
        const auto req =
            invoke("/mcp", HTTP_POST, R"({"jsonrpc":"2.0","id":2,"method":"tools/list"})");
        text(req, "name", "get_status");
        text(req, "name", "get_hp_values");
        check(req.response.find("\"additionalProperties\":false") != std::string::npos &&
                  req.response.find("\"readOnlyHint\":true") != std::string::npos &&
                  req.response.find("\"destructiveHint\":false") != std::string::npos,
              "catalog permits write arguments or changed read-only annotations");
        check(status_calls == 0 && values_calls == 0, "catalog fetched snapshots");
    });
    run("streamed_tool_snapshots", [] {
        start();
        for (const bool status : {true, false}) {
            const auto        plain = invoke(status ? "/status" : "/values", HTTP_GET);
            const auto        req   = invoke("/mcp", HTTP_POST, tool_request(status));
            const std::string prefix =
                std::string("{\"jsonrpc\":\"2.0\",\"id\":\"wire-id\",\"result\":{\"content\":[{"
                            "\"type\":\"text\",\"text\":\"") +
                (status ? "Current device and heat-pump status."
                        : "Current decoded heat-pump readings.") +
                "\"}],\"structuredContent\":";
            const std::string suffix = ",\"isError\":false}}";
            check((status ? status_prefix : values_prefix) == prefix &&
                      (status ? status_suffix : values_suffix) == suffix,
                  "MCP changed stream framing or dispatch");
            check(req.response == prefix + plain.response + suffix,
                  "MCP snapshot differs from shared route snapshot");
            check(req.chunks > 2 && req.max_chunk <= 512 && req.final_chunks == 1,
                  "snapshot stream did not finish in bounded chunks");
        }
        check(status_calls == 2 && values_calls == 2, "tool dispatch sampled wrong instrument");
    });
    run("stateless_independent_generations", [] {
        start();
        const auto first = invoke("/mcp", HTTP_POST, tool_request(true));
        ++values_generation;
        const auto values = invoke("/mcp", HTTP_POST, tool_request(false));
        check(values.response.find("\"generation\":20") != std::string::npos && status_calls == 1,
              "value generation coupled to status/session");
        ++status_generation;
        const auto second = invoke("/mcp", HTTP_POST, tool_request(true));
        check(first.response != second.response &&
                  second.response.find("snapshot-8") != std::string::npos && values_calls == 1,
              "status was session-cached or sampled values");
        for (const auto* notice :
             {R"({"jsonrpc":"2.0","method":"notifications/initialized"})",
              R"({"jsonrpc":"2.0","method":"unrecognized/notice","params":{}})"}) {
            const auto req = invoke("/mcp", HTTP_POST, notice);
            check(req.status == "202 Accepted" && req.response.empty(),
                  "valid notification mutated/responded");
        }
        check(status_calls == 2 && values_calls == 1, "notification dispatched tool");
    });
    run("malformed_wire_and_null_error_id", [] {
        start();
        for (const auto* body :
             {"", "{", R"({"id":9,"jsonrpc":"2.0","method":"tools/list"} trailing)",
              R"({"id":9,"jsonrpc":"2.0","method":"tools/list",)",
              R"({"id":9,"jsonrpc":"2.0","method":"tools/list","extra":"\uD800"})"}) {
            const auto req = invoke("/mcp", HTTP_POST, body);
            check(req.status == "400 Bad Request", "malformed document not HTTP400");
            error(req, -32700);
        }
        for (const auto* body :
             {"[]", R"({"jsonrpc":"2.0","method":null,"id":8})",
              R"({"jsonrpc":"2.0","method":"tools/list","id":[]})",
              R"({"jsonrpc":"2.0","jsonrpc":"2.0","method":"tools/list","id":8})"}) {
            const auto req = invoke("/mcp", HTTP_POST, body);
            error(req, -32600);
        }
        check(status_calls == 0 && values_calls == 0, "malformed input fetched snapshot");
    });
    run("invalid_utf8_rejected", [] {
        start();
        for (const auto& bytes :
             {std::string("\x80", 1), std::string("\xc0\xaf", 2), std::string("\xed\xa0\x80", 3),
              std::string("\xf4\x90\x80\x80", 4), std::string("\xe2\x82", 2)}) {
            const auto req =
                invoke("/mcp", HTTP_POST,
                       std::string(R"({"id":7,"jsonrpc":"2.0","method":"tools/list","extra":")") +
                           bytes + "\"}");
            check(req.status == "400 Bad Request", "invalid UTF8 accepted");
            error(req, -32700);
        }
        const auto req = invoke("/mcp", HTTP_POST,
                                R"({"id":"Wärmepumpe 😀","jsonrpc":"2.0","method":"tools/list"})");
        check(req.status == "200 OK", "valid UTF8 rejected");
        text(req, "id", "Wärmepumpe 😀");
    });
    run("malformed_notifications", [] {
        start();
        for (const auto* body :
             {R"({"jsonrpc":"2.0","method":"notifications/initialized","params":null})",
              R"({"jsonrpc":"2.0","method":"notifications/initialized","params":[]})",
              R"({"jsonrpc":"2.0","method":"notifications/initialized","params":"x"})",
              R"({"jsonrpc":"2.0","method":1})"}) {
            const auto req = invoke("/mcp", HTTP_POST, body);
            check(req.status == "400 Bad Request" && !req.response.empty(),
                  "malformed notification silently accepted");
            error(req, -32600);
        }
    });
    run("unsupported_write_dispatch", [] {
        start();
        for (const auto* method : {"set_wifi", "resources/write", "prompts/get", "shutdown"}) {
            const auto req =
                invoke("/mcp", HTTP_POST,
                       std::string(R"({"jsonrpc":"2.0","id":3,"method":")") + method + "\"}");
            error(req, -32601, "3");
        }
        const auto unknown = invoke(
            "/mcp", HTTP_POST,
            R"({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"set_wifi","arguments":{}}})");
        error(unknown, -32601, "4");
        const auto args = invoke(
            "/mcp", HTTP_POST,
            R"({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_status","arguments":{"write":true}}})");
        error(args, -32602, "5");
        check(handler_calls == 0 && status_calls == 0 && values_calls == 0,
              "unsupported write dispatched service");
    });
    run("body_fragmentation_and_limits", [] {
        start();
        auto req     = request(tool_request(true));
        req.fragment = 1;
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "200 OK" &&
                  status_calls == 1 && req.recv_bytes == req.body.size(),
              "fragmented valid request lost bytes");
        status_calls = 0;
        req          = request(std::string(1024, 'x'));
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "400 Bad Request" &&
                  status_calls == 0,
              "oversized body reached MCP snapshot");
        error(req, -32700);
        req                = request(tool_request(true));
        req.receive_script = {HTTPD_SOCK_ERR_TIMEOUT, HTTPD_SOCK_ERR_TIMEOUT,
                              HTTPD_SOCK_ERR_TIMEOUT};
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "400 Bad Request" &&
                  req.recv_calls < 10,
              "body stall not bounded");
        req                = request(tool_request(true));
        req.receive_script = {5, -2};
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "400 Bad Request",
              "partial body error accepted");
        req             = request(tool_request(true));
        req.fragment    = 1;
        sdk::clock_step = 5000000;
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_FAIL && req.status == "400 Bad Request" &&
                  req.recv_calls < 10,
              "body overall deadline not enforced");
    });
    run("protocol_header_guard", [] {
        start();
        auto empty_initialize = request(R"({"jsonrpc":"2.0","id":1,"method":"initialize"})");
        empty_initialize.headers["MCP-Protocol-Version"] = "";
        check(dispatch(empty_initialize, "/mcp", HTTP_POST) == ESP_OK &&
                  empty_initialize.status == "400 Bad Request",
              "supplied-empty initialize revision treated as absent");
        for (const auto* revision : {"", "2025-03-26", "future", "123456789012345678901234"}) {
            auto req                            = request(tool_request(true));
            req.headers["MCP-Protocol-Version"] = revision;
            check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "400 Bad Request" &&
                      status_calls == 0,
                  "unsupported revision reached snapshot");
            error(req, -32600);
        }
        auto unreadable          = request(tool_request(true));
        unreadable.failed_header = "MCP-Protocol-Version";
        check(dispatch(unreadable, "/mcp", HTTP_POST) == ESP_OK &&
                  unreadable.status == "400 Bad Request" && status_calls == 0,
              "failed version header read reached snapshot");
        error(unreadable, -32600);
        for (const auto* body :
             {tool_request(true), R"({"jsonrpc":"2.0","method":"notifications/initialized"})",
              R"({"jsonrpc":"2.0","id":2,"method":"unknown"})"}) {
            auto req = request(body);
            req.headers.erase("MCP-Protocol-Version");
            check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "400 Bad Request",
                  "headerless postinitialize call assumed unsupported March revision");
        }
        for (const auto* revision : {"2025-06-18", "2025-11-25"}) {
            auto req                            = request(tool_request(true));
            req.headers["MCP-Protocol-Version"] = revision;
            check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK && req.status == "200 OK",
                  "supported revision rejected");
        }
    });
    run("mcp_get_transport_headers", [] {
        start();
        const auto req = invoke("/mcp", HTTP_GET);
        check(req.content_type == "text/html" && req.response.size() == 11 &&
                  static_cast<unsigned char>(req.response[0]) == 31 &&
                  static_cast<unsigned char>(req.response[1]) == 139,
              "GET help not embedded gzip asset");
        for (const auto& [key, value] :
             std::map<std::string, std::string>{{"Content-Encoding", "gzip"},
                                                {"Cache-Control", "no-store"},
                                                {"X-Content-Type-Options", "nosniff"},
                                                {"X-Frame-Options", "DENY"},
                                                {"Referrer-Policy", "no-referrer"}})
            check(req.response_headers.at(key) == value, "GET help response header changed");
        check(req.response_headers.at("Content-Security-Policy").find("connect-src 'none'") !=
                  std::string::npos,
              "GET help unexpectedly permits network connections");
        auto sse              = request();
        sse.headers["Accept"] = "text/event-stream";
        check(dispatch(sse, "/mcp", HTTP_GET) == ESP_OK && sse.status == "405 Method Not Allowed" &&
                  sse.response.empty() && sse.response_headers.at("Allow") == "POST",
              "SSE request received help HTML");
        auto mixed              = request();
        mixed.headers["Accept"] = "text/html, text/event-stream";
        check(dispatch(mixed, "/mcp", HTTP_GET) == ESP_OK && mixed.status == "200 OK",
              "browser help negotiation rejected HTML");
        for (const auto* accept :
             {"text/event-stream,text/html;q=0", "text/event-stream;q=1,text/html;Q=0.000",
              "text/html;note=\"comma,semicolon;\";q=0,text/event-stream"}) {
            auto excluded              = request();
            excluded.headers["Accept"] = accept;
            check(dispatch(excluded, "/mcp", HTTP_GET) == ESP_OK &&
                      excluded.status == "405 Method Not Allowed" && excluded.response.empty(),
                  "excluded HTML bypassed SSE rejection");
        }
        mixed.headers["Accept"] = "text/event-stream,text/html;q=0.001";
        check(dispatch(mixed, "/mcp", HTTP_GET) == ESP_OK && mixed.status == "200 OK",
              "nonzero HTML weight rejected browser help");
        auto long_header              = request();
        long_header.headers["Accept"] = std::string(192, 'x');
        check(dispatch(long_header, "/mcp", HTTP_GET) == ESP_OK &&
                  long_header.status == "400 Bad Request",
              "unbounded Accept accepted");
        auto unreadable              = request();
        unreadable.headers["Accept"] = "text/html";
        unreadable.failed_header     = "Accept";
        check(dispatch(unreadable, "/mcp", HTTP_GET) == ESP_OK &&
                  unreadable.status == "400 Bad Request",
              "failed Accept read accepted");
    });
    run("mcp_snapshot_failures", [] {
        start();
        for (const bool status : {true, false}) {
            for (const int mode : {1, 2, 3}) {
                failure           = mode;
                auto       req    = request(tool_request(status));
                const auto result = dispatch(req, "/mcp", HTTP_POST);
                check(mode == 3 ? result == ESP_FAIL : result == ESP_OK,
                      "snapshot failure escape status changed");
                if (mode != 3)
                    check(req.status ==
                              (mode == 1 ? "503 Service Unavailable" : "500 Internal Server Error"),
                          "snapshot exception uncaught");
            }
        }
        failure        = 0;
        auto req       = request(tool_request(false));
        req.fail_chunk = 2;
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_FAIL && req.final_chunks == 0 &&
                  req.chunks == 2,
              "failed snapshot stream falsely completed");
        check(stack_samples == 7, "MCP failure exits lost stack sample");
    });
    run("mcp_busy_before_parsing", [] {
        start();
        busy                = true;
        auto req            = request(tool_request(true));
        req.headers["Host"] = "invalid.example";
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK &&
                  req.status == "503 Service Unavailable" && req.header_reads == 2 &&
                  status_calls == 0 && values_calls == 0,
              "busy MCP parsed non-framing headers or fetched snapshots");
        busy     = false;
        download = true;
        req      = request(tool_request(false));
        check(daik::mcp_post(&req) == ESP_OK && req.status == "503 Service Unavailable" &&
                  req.header_reads == 0 && req.recv_calls == 0 && status_calls == 0 &&
                  values_calls == 0,
              "MCP direct download guard parsed body or fetched snapshot");
        download = false;
        largest  = 6143;
        req      = request(tool_request(true));
        check(dispatch(req, "/mcp", HTTP_POST) == ESP_OK &&
                  req.status == "503 Service Unavailable" && status_calls == 0 && values_calls == 0,
              "low-heap MCP fetched snapshot");
    });
    run("incoming_progress_budget", [] {
        start();
        check(sdk::config.recv_wait_timeout == 5, "blocking receive ceiling changed");
        SocketPair pair;
        for (unsigned i = 0; i < 12; ++i) {
            sdk::now = i * 2'500'000LL;
            check(pair.byte() == 1, "healthy bounded fragment was refused");
        }
        sdk::now = 30'000'000LL;
        check(pair.byte() == HTTPD_SOCK_ERR_FAIL, "progress reset the total ingress budget");
    });
    run("incoming_final_read_expiry", [] {
        start();
        SocketPair pair;
        sdk::clock_step = 30'000'000LL;
        check(pair.byte() == HTTPD_SOCK_ERR_FAIL, "last received byte bypassed total expiry");
    });
    run("incoming_keepalive_budget", [] {
        start();
        SocketPair pair;
        check(pair.byte() == 1, "first request fragment failed");
        auto req   = request();
        req.sockfd = pair.fd[1];
        check(dispatch(req, "/status", HTTP_GET) == ESP_OK, "request settlement failed");
        auto* state = static_cast<daik::HttpIngressSession*>(sdk::sessions[pair.fd[1]].context);
        check(state && !state->budget.active, "successful settlement retained old budget");
        sdk::now = 90'000'000LL;
        check(pair.byte() == 1, "idle keepalive time poisoned the next request");
    });
    run("incoming_admission_failure", [] {
        start();
        const auto server = reinterpret_cast<void*>(1);
        check(sdk::config.open_fn(server, 999) == ESP_FAIL, "missing session admitted protection");
        sdk::sessions[998]         = {};
        sdk::fail_receive_override = true;
        check(sdk::config.open_fn(server, 998) == ESP_FAIL, "failed override admitted a session");
        check(sdk::sessions[998].context && sdk::sessions[998].free_context,
              "failed open did not leave cleanup with the SDK owner");
    });
    run("incoming_socket_failures", [] {
        start();
        SocketPair pair;
        const auto server  = reinterpret_cast<void*>(1);
        const auto receive = sdk::sessions[pair.fd[1]].receive;
        char       byte    = 0;
        check(receive(server, pair.fd[1], nullptr, 1, 0) == HTTPD_SOCK_ERR_FAIL,
              "null receive buffer admitted");
        check(receive(server, 999, &byte, 1, 0) == HTTPD_SOCK_ERR_FAIL,
              "unprotected receive admitted");
        const timeval wait{0, 1000};
        check(setsockopt(pair.fd[1], SOL_SOCKET, SO_RCVTIMEO, &wait, sizeof(wait)) == 0,
              "host timeout setup failed");
        check(receive(server, pair.fd[1], &byte, 1, 0) == HTTPD_SOCK_ERR_TIMEOUT,
              "socket timeout lost SDK classification");
        check(shutdown(pair.fd[0], SHUT_WR) == 0, "peer shutdown failed");
        check(receive(server, pair.fd[1], &byte, 1, 0) == 0, "peer close did not propagate");
        close(pair.fd[1]);
        pair.receiver_closed = true;
        check(receive(server, pair.fd[1], &byte, 1, 0) == HTTPD_SOCK_ERR_FAIL,
              "hard socket error was treated as timeout");
    });
    run("incoming_body_framing", [] {
        start();
        char bytes[16] = {};
        auto req       = request("{}\n");
        req.fragment   = 1;
        check(daik::http_read_body(&req, bytes, sizeof(bytes)) == 3 && std::string(bytes) == "{}\n",
              "valid fragmented body failed");
        req             = request("{}");
        req.content_len = 8;
        check(daik::http_read_body(&req, bytes, sizeof(bytes)) < 0,
              "incomplete announced body was accepted");
        req                = request("{}");
        req.receive_script = {HTTPD_SOCK_ERR_TIMEOUT, 1, 1};
        check(daik::http_read_body(&req, bytes, sizeof(bytes)) == 2,
              "recoverable body timeout was refused");
        req             = request("{}");
        sdk::clock_step = 15'000'000LL;
        check(daik::http_read_body(&req, bytes, sizeof(bytes)) < 0,
              "final body read bypassed absolute body deadline");
    });
    run("incoming_wire_length_guard", [] {
        start();
        auto unreadable           = request();
        unreadable.header_failure = true;
        check(dispatch(unreadable, "/status", HTTP_GET) == ESP_FAIL &&
                  unreadable.status == "400 Bad Request" && handler_calls == 0,
              "unreadable framing reached handler or settlement");
        for (const char* invalid :
             {"4294967296", "4294967295", "", "-1", "1x", "999999999999999999999999999999999999"}) {
            auto req                      = request();
            req.headers["Content-Length"] = invalid;
            check(dispatch(req, "/status", HTTP_GET) == ESP_FAIL &&
                      req.status == "400 Bad Request" && handler_calls == 0 && req.recv_calls == 0,
                  "narrowed or malformed wire length reached handler/purge");
        }
        for (const char* transfer : {"chunked", "identity", ""}) {
            auto req                         = request();
            req.headers["Transfer-Encoding"] = transfer;
            check(dispatch(req, "/status", HTTP_GET) == ESP_FAIL &&
                      req.status == "400 Bad Request" && handler_calls == 0,
                  "unsupported body framing reached handler");
        }
        auto req                      = request();
        req.headers["Content-Length"] = "0";
        check(dispatch(req, "/status", HTTP_GET) == ESP_OK && handler_calls == 1,
              "refused framing poisoned subsequent valid request");
    });
    run("incoming_early_framing", [] {
        start();
        for (const bool during_ota : {false, true}) {
            busy = during_ota;
            for (const bool transfer : {false, true}) {
                for (const char* narrowed : {"4294967296", "4294967295"}) {
                    auto req            = request();
                    req.headers["Host"] = "invalid.example";
                    if (transfer)
                        req.headers["Transfer-Encoding"] = "chunked";
                    else
                        req.headers["Content-Length"] = narrowed;
                    check(dispatch(req, "/mcp", HTTP_POST) == ESP_FAIL &&
                              req.status == "400 Bad Request" && req.recv_calls == 0 &&
                              status_calls == 0 && values_calls == 0,
                          "early rejection kept unsupported framing alive");
                }
            }
        }
    });
    run("incoming_close_owner", [] {
        start();
        const auto server = reinterpret_cast<void*>(1);
        // Mirror IDF 6.1's session-delete then accept-exit sequence with real descriptors.
        // The session callback must leave a failed opening descriptor valid until accept-exit.
        for (const bool oom : {false, true}) {
            int fd[2];
            check(socketpair(AF_UNIX, SOCK_STREAM, 0, fd) == 0, "failure socketpair failed");
            sdk::sessions[fd[1]]       = {};
            fail_nothrow               = oom;
            sdk::fail_receive_override = !oom;
            check(sdk::config.open_fn(server, fd[1]) != ESP_OK, "failed admission accepted");
            fail_nothrow               = false;
            sdk::fail_receive_override = false;
            if (sdk::config.close_fn)
                sdk::config.close_fn(server, fd[1]);
            else
                close(fd[1]);
            auto& session = sdk::sessions.at(fd[1]);
            check(oom ? session.context == nullptr : session.context != nullptr,
                  "allocation/override failure context ownership lost");
            if (session.context && session.free_context) session.free_context(session.context);
            sdk::sessions.erase(fd[1]);
            check(fcntl(fd[1], F_GETFD) >= 0, "session delete closed failed opening descriptor");
            check(close(fd[1]) == 0, "accept-exit lost sole close ownership");
            close(fd[0]);
        }
        SocketPair pair;
        check(sdk::config.close_fn != nullptr, "normal session missing close callback");
        sdk::config.close_fn(server, pair.fd[1]);
        pair.receiver_closed = true;
        errno                = 0;
        check(fcntl(pair.fd[1], F_GETFD) == -1 && errno == EBADF,
              "admitted session callback failed to close descriptor");
    });
    check(cases != 0, "unknown requested oracle");
    std::printf("PASS total=%u\n", cases);
}
