#include "sdk.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <set>
#include <string_view>
#include <vector>
#ifndef QUERY_HTTP_PRODUCTION_SOURCE
#error Bind the complete production HTTP translation unit explicitly
#endif
#include QUERY_HTTP_PRODUCTION_SOURCE

namespace fixture {
inline daik::Config       current;
inline daik::HpProbeReply reply;
inline unsigned           probe_calls = 0, config_reads = 0;
inline uint8_t            last_reg     = 0;
inline int                last_timeout = 0;
inline std::string        oracle;
[[noreturn]] void         fail(const char* reason) {
    std::fprintf(stderr, "FAIL oracle=%s: %s\n", oracle.c_str(), reason);
    std::exit(1);
}
void check(bool good, const char* reason) {
    if (!good) fail(reason);
}
void reset() {
    current           = daik::Config{};
    current.profile   = "generic";
    reply             = daik::HpProbeReply{};
    reply.status      = daik::ProbeStatus::Ok;
    reply.proto       = daik::Protocol::I;
    reply.rx_pin      = 44;
    reply.tx_pin      = 43;
    reply.frame_len   = 64;
    reply.payload_off = 5;
    reply.payload_len = 32;
    for (int i = 0; i < 64; ++i) reply.frame[i] = static_cast<uint8_t>(i);
    reply.frame[5] = 42;
    reply.frame[6] = 0;
    probe_calls = config_reads = 0;
    last_reg                   = 0;
    last_timeout               = 0;
}
httpd_req_t invoke(std::string body, esp_err_t* result = nullptr, int fail_chunk = -1) {
    httpd_req_t req;
    req.body         = std::move(body);
    req.fail_chunk   = fail_chunk;
    const auto value = daik::hp_query_probe(&req);
    if (result)
        *result = value;
    else
        check(value == ESP_OK, "handler adapter did not complete");
    return req;
}
daik::JsonGuard parse(const httpd_req_t& req) {
    return daik::JsonGuard(daik::json_parse_document(req.response));
}
cJSON* field(cJSON* object, const char* name) {
    auto* value = cJSON_GetObjectItemCaseSensitive(object, name);
    check(value != nullptr, "response field missing");
    return value;
}
void text(cJSON* object, const char* name, const char* expected) {
    auto* value = field(object, name);
    check(cJSON_IsString(value) && std::strcmp(value->valuestring, expected) == 0,
          "response text does not match");
}
void integer(cJSON* object, const char* name, int expected) {
    auto* value = field(object, name);
    check(cJSON_IsNumber(value) && value->valuedouble == expected,
          "response integer does not match");
}
void rejected(std::string body, const char* reason) {
    reset();
    const auto req = invoke(std::move(body));
    check(probe_calls == 0 && config_reads == 0, "invalid request reached UART handoff/store");
    check(req.status == "400 Bad Request", "invalid request is not HTTP 400");
    const auto document = parse(req);
    check(bool(document), "error response is not complete JSON");
    check(cJSON_IsFalse(field(document, "ok")), "invalid request response is ok");
    text(document, "error", reason);
}
void success(const httpd_req_t& req) {
    check(req.status == "200 OK" && probe_calls == 1, "valid request needs one HTTP 200 handoff");
    check(last_timeout == 3000, "probe handoff timeout changed");
    check(req.content_type == "application/json", "stream JSON content type missing");
    check(req.final_chunks == 1 && req.chunks > 0 && req.max_chunk <= 1024,
          "stream completion or chunk bound changed");
}
} // namespace fixture

namespace daik {
Config config() {
    ++fixture::config_reads;
    return fixture::current;
}
bool hp_probe_run(uint8_t reg, HpProbeReply& out, int timeout_ms) {
    ++fixture::probe_calls;
    fixture::last_reg     = reg;
    fixture::last_timeout = timeout_ms;
    out                   = fixture::reply;
    return out.status == ProbeStatus::Ok;
}
int http_read_body(httpd_req_t* req, char* bytes, size_t max) {
    if (req->body_failed || req->body.size() >= max) return -1;
    std::memcpy(bytes, req->body.data(), req->body.size());
    bytes[req->body.size()] = '\0';
    return static_cast<int>(req->body.size());
}
esp_err_t http_send_json(httpd_req_t* req, const char* json) {
    req->content_type = "application/json";
    req->response     = json;
    return ESP_OK;
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
        std::printf("PASS oracle=%s\n", name);
    };
    run("fractional_fields_rejected_before_handoff", [] {
        rejected(R"({"reg":96.9,"offset":"bad","size":1.9,"conv":"bad"})", "reg must be 0..255");
    });
    run("absent_optional_defaults", [] {
        const auto req = invoke(R"({"reg":96})");
        success(req);
        check(last_reg == 96, "register changed");
        const auto doc = parse(req);
        check(bool(doc), "valid response JSON failed");
        integer(doc, "offset", 0);
        integer(doc, "size", 1);
        text(doc, "status", "ok");
        check(cJSON_IsTrue(field(doc, "ok")), "valid decode is not ok");
        check(cJSON_IsArray(field(doc, "decodes")) && cJSON_GetArraySize(field(doc, "decodes")) > 1,
              "absent converter did not execute the sweep");
    });
    for (const auto& field_name : {"reg", "offset", "size", "conv"}) {
        const std::string name(field_name);
        const char*       reason = name == "reg"      ? "reg must be 0..255"
                                   : name == "offset" ? "offset must be 0..31"
                                   : name == "size"   ? "size must be 1 or 2"
                                                      : "conv must be 0..999 or omitted";
        for (const auto& invalid :
             {"null", "true", "false", "\"bad\"", "[]", "{}", "1.9", "-1.9", "1e100", "-1e100"}) {
            const std::string value(invalid);
            const std::string test = "strict_" + name + "_" + value;
            run(test.c_str(), [name, value, reason] {
                std::string body = name == "reg" ? "{" : "{\"reg\":96,";
                body += "\"" + name + "\":" + value + "}";
                rejected(body, reason);
            });
        }
    }
    run("required_register", [] { rejected("{}", "reg must be 0..255"); });
    run("integer_json_number_forms", [] {
        const auto req = invoke(R"({"reg":9.6e1,"offset":0.0,"size":1e0,"conv":2.11e2})");
        success(req);
        const auto doc = parse(req);
        check(bool(doc), "integer-valued JSON numbers are invalid");
        integer(doc, "offset", 0);
        integer(doc, "size", 1);
        auto* decoded = cJSON_GetArrayItem(field(doc, "decodes"), 0);
        integer(decoded, "conv", 211);
        integer(decoded, "value", 42);
    });
    run("explicit_sweep_sentinel", [] {
        const auto req = invoke(R"({"reg":96,"conv":-1})");
        success(req);
        const auto doc = parse(req);
        check(cJSON_GetArraySize(field(doc, "decodes")) > 1, "explicit sweep was removed");
    });
    run("request_bounds_before_handoff", [] {
        for (const auto* body : {R"({"reg":-1})", R"({"reg":256})"})
            rejected(body, "reg must be 0..255");
        for (const auto* body : {R"({"reg":96,"offset":-1})", R"({"reg":96,"offset":32})"})
            rejected(body, "offset must be 0..31");
        for (const auto* body : {R"({"reg":96,"size":0})", R"({"reg":96,"size":3})"})
            rejected(body, "size must be 1 or 2");
        for (const auto* body : {R"({"reg":96,"conv":-2})", R"({"reg":96,"conv":1000})"})
            rejected(body, "conv must be 0..999 or omitted");
    });
    run("complete_object_document", [] {
        for (const auto* body :
             {"", "null", "[]", "true", R"({"reg":96} trailing)", R"({"reg":96}{"reg":97})",
              R"({"reg":96)", R"({"reg":96,"bad":"\uZZZZ"})"})
            rejected(body, "bad json");
        const auto req = invoke(" \n{\"reg\":96}\t ");
        success(req);
    });
    run("bounded_body_rejection", [] { rejected(std::string(192, ' '), "bad body"); });
    run("numeric_representation_limits", [] {
        for (const auto* value :
             {"2147483647", "-2147483648", "2147483648", "-2147483649", "1e309", "-1e309"}) {
            rejected(std::string("{\"reg\":") + value + "}", "reg must be 0..255");
        }
    });
    run("scheduler_status_http_mapping", [] {
        for (const auto status :
             {daik::ProbeStatus::Busy, daik::ProbeStatus::NoLink, daik::ProbeStatus::Timeout}) {
            reset();
            reply.status   = status;
            const auto req = invoke(R"({"reg":96})");
            check(probe_calls == 1 && config_reads == 0, "scheduler failure decoded/read store");
            check(req.status == (status == daik::ProbeStatus::Busy ? "409 Conflict"
                                                                   : "503 Service Unavailable"),
                  "scheduler failure HTTP mapping changed");
            const auto doc = parse(req);
            check(bool(doc) && cJSON_IsFalse(field(doc, "ok")), "scheduler failure JSON changed");
            text(doc, "error",
                 status == daik::ProbeStatus::Busy ? "another register probe is in flight"
                                                   : daik::probe_status_name(status));
        }
    });
    run("reply_failures_are_results", [] {
        for (const auto status :
             {daik::ProbeStatus::NoReply, daik::ProbeStatus::Rejected, daik::ProbeStatus::BadCrc,
              daik::ProbeStatus::UnexpectedReply, daik::ProbeStatus::InvalidLength,
              daik::ProbeStatus::ShortReply}) {
            reset();
            reply.status    = status;
            reply.frame_len = status == daik::ProbeStatus::NoReply ? 0 : 2;
            reply.frame[0]  = 0x15;
            reply.frame[1]  = 0xea;
            const auto req  = invoke(R"({"reg":96})");
            success(req);
            const auto doc = parse(req);
            check(bool(doc) && cJSON_IsFalse(field(doc, "ok")), "reply error became ok");
            text(doc, "status", daik::probe_status_name(status));
            check(config_reads == 0, "reply error entered decoder/store");
            if (reply.frame_len)
                text(doc, "frame", "15 ea");
            else
                check(!cJSON_HasObjectItem(doc, "frame"), "silent reply fabricated a frame");
            check(!cJSON_HasObjectItem(doc, "payload") && !cJSON_HasObjectItem(doc, "decodes"),
                  "reply error fabricated a payload/decode");
        }
    });
    run("slice_status_emitted_once", [] {
        reply.payload_len = 1;
        const auto req    = invoke(R"({"reg":96,"size":2})");
        success(req);
        const auto doc = parse(req);
        check(bool(doc) && cJSON_IsFalse(field(doc, "ok")), "short payload was usable");
        text(doc, "status", "out_of_bounds");
        text(doc, "payload", "2a");
        check(!cJSON_HasObjectItem(doc, "slice") && !cJSON_HasObjectItem(doc, "decodes"),
              "out-of-bounds response decoded a slice");
        unsigned statuses = 0;
        for (auto* child = doc->child; child; child = child->next)
            if (child->string && std::strcmp(child->string, "status") == 0) ++statuses;
        check(statuses == 1, "response contains duplicate status keys");
    });
    run("valid_converter_and_slice", [] {
        const auto req = invoke(R"({"reg":96,"offset":0,"size":2,"conv":105})");
        success(req);
        const auto doc = parse(req);
        check(bool(doc), "success JSON failed");
        text(doc, "reg", "0x60");
        text(doc, "proto", "I");
        integer(doc, "rx_pin", 44);
        integer(doc, "tx_pin", 43);
        text(doc, "slice", "2a 00");
        const auto* decodes = field(doc, "decodes");
        check(cJSON_GetArraySize(decodes) == 1, "single converter did not yield one decode");
        auto* decoded = cJSON_GetArrayItem(decodes, 0);
        integer(decoded, "conv", 105);
        check(cJSON_IsNumber(field(decoded, "value")) &&
                  field(decoded, "value")->valuedouble == 4.2,
              "real converter numeric value changed");
    });
    run("unknown_converter_reported", [] {
        const auto req = invoke(R"({"reg":255,"conv":999})");
        success(req);
        const auto doc     = parse(req);
        auto*      decodes = field(doc, "decodes");
        check(cJSON_GetArraySize(decodes) == 1, "unknown converter outcome missing");
        auto* decoded = cJSON_GetArrayItem(decodes, 0);
        integer(decoded, "conv", 999);
        check(cJSON_IsTrue(field(decoded, "unimplemented")), "unknown converter was fabricated");
    });
    run("sweep_preserves_converter_coverage", [] {
        reply.frame[5] = 0;
        reply.frame[6] = 0x80;
        const auto req = invoke(R"({"reg":96,"size":2})");
        success(req);
        const auto    doc     = parse(req);
        auto*         decodes = field(doc, "decodes");
        std::set<int> represented;
        bool          refused = false;
        for (int i = 0; i < cJSON_GetArraySize(decodes); ++i) {
            auto* decoded = cJSON_GetArrayItem(decodes, i);
            check(represented.insert(field(decoded, "conv")->valueint).second,
                  "sweep converter represented twice");
            refused |= cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(decoded, "refused"));
            auto* aliases = cJSON_GetObjectItemCaseSensitive(decoded, "aliases");
            if (!aliases) continue;
            for (int a = 0; a < cJSON_GetArraySize(aliases); ++a)
                check(represented.insert(cJSON_GetArrayItem(aliases, a)->valueint).second,
                      "sweep alias represented twice");
        }
        const std::set<int> expected = {105, 106, 107, 108, 114, 119, 101, 102, 103, 104,
                                        109, 110, 111, 118, 151, 152, 161, 164, 405};
        check(represented == expected && refused, "sweep lost candidate/alias/refused evidence");
    });
    run("protocol_s_response_serialization", [] {
        reply.proto       = daik::Protocol::S;
        reply.frame_len   = 18;
        reply.payload_off = 2;
        reply.payload_len = 15;
        reply.frame[2]    = 42;
        const auto req    = invoke(R"({"reg":86,"conv":211})");
        success(req);
        const auto doc = parse(req);
        text(doc, "proto", "S");
        text(doc, "reg", "0x56");
        integer(doc, "payload_len", 15);
        text(doc, "slice", "2a");
        check(std::strlen(field(doc, "frame")->valuestring) == 53,
              "18-byte S frame lost received bytes");
    });
    run("maximum_frame_preserved", [] {
        const auto req = invoke(R"({"reg":0,"offset":31,"conv":211})");
        success(req);
        const auto  doc   = parse(req);
        const auto* frame = field(doc, "frame");
        check(cJSON_IsString(frame) && std::strlen(frame->valuestring) == 191,
              "64-byte received frame truncated");
        check(std::string_view(frame->valuestring).substr(186) == "3e 3f", "frame tail lost");
        text(doc, "slice", "24");
    });
    run("serialization_escapes_text", [] {
        httpd_req_t           req;
        daik::ProbeJsonChunks out(daik::ProbeChunkEmitter{&req});
        daik::ProbeDecode     decoded;
        decoded.conv    = 217;
        decoded.is_text = true;
        std::strcpy(decoded.text, "He\"at\n\\");
        daik::probe_append_decode(out, decoded);
        check(out.finish(), "text stream failed");
        const auto doc = parse(req);
        check(bool(doc), "escaped text is invalid JSON");
        text(doc, "text", "He\"at\n\\");
    });
    run("failed_chunk_propagated", [] {
        esp_err_t  result = ESP_OK;
        const auto req    = invoke(R"({"reg":96})", &result, 0);
        check(result == ESP_FAIL && req.final_chunks == 0, "failed stream reported completed");
    });
    check(cases > 0, "unknown named scenario");
    std::printf("PASS total=%u\n", cases);
    return 0;
}
