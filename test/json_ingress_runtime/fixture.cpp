#include <cstdlib>
#include <cstdio>
#include <string>
#include <string_view>
#include JSON_GUARD_SOURCE

namespace {
size_t live = 0, allocations = 0;
int    fail_after = -1;
void*  allocate(size_t size) {
    if (fail_after == 0) return nullptr;
    if (fail_after > 0) --fail_after;
    void* p = std::malloc(size);
    if (p) {
        ++live;
        ++allocations;
    }
    return p;
}
void release(void* p) {
    if (p) {
        --live;
        std::free(p);
    }
}
bool parse(std::string_view payload, bool expected) {
    bool accepted = false;
    {
        daik::JsonGuard root(daik::json_parse_document(payload));
        accepted = static_cast<bool>(root);
        if (root && !cJSON_IsObject(root)) return false;
    }
    return accepted == expected && live == 0;
}
} // namespace

int main() {
    cJSON_Hooks hooks{allocate, release};
    cJSON_InitHooks(&hooks);
    for (const std::string_view payload : {"null", "[]", "true", "false", "0", "-1", "\"{}\""}) {
        const auto before = allocations;
        if (!parse(payload, false) || allocations != before) {
            std::fputs("FAIL configuration_object_root_required\n", stderr);
            return 1;
        }
    }
    for (const std::string_view payload :
         {"{}", " \t\r\n{} \n", "{\"host\":\"\"}", "{\"text\":\"[{\\\"}]\"}"})
        if (!parse(payload, true)) return 2;
    for (const std::string_view payload : {"", " ", "{", "{}{}", "{}garbage", "[1,]", "\f{}"})
        if (!parse(payload, false)) return 3;
    std::string sixteen;
    for (unsigned n = 0; n < 16; ++n) sixteen += "{\"a\":";
    sixteen += "0" + std::string(16, '}');
    if (!parse(sixteen, true)) return 4;
    const auto before = allocations;
    if (!parse("{\"a\":" + sixteen + "}", false) || allocations != before) return 5;
    if (!parse(std::string("{}") + '\0' + "{}", false)) return 6;
    for (const std::string& payload :
         {std::string("{\"host\":\"a") + '\0' + "b\"}", std::string("{\"a") + '\0' + "b\":1}",
          std::string(R"({"host":"a\u0000b"})"), std::string(R"({"a\u0000b":1})"),
          std::string("{\"host\":\"a\nb\"}")}) {
        const auto before_strings = allocations;
        if (!parse(payload, false) || allocations != before_strings) {
            std::fputs("FAIL unrepresentable_strings_rejected_before_parser\n", stderr);
            return 31;
        }
    }
    if (!parse(R"({"text":"a\\u0000b\u0001\n\r\t\b\f\"\\"})", true)) return 32;
    const std::string large = "{\"text\":\"" + std::string(8180, 'x') + "\"}";
    if (large.size() != 8191 || !parse(large, true)) return 7;
    for (int n = 0; n < 4; ++n) {
        fail_after = n;
        if (!parse("{\"a\":{\"b\":1}}", false)) return 8;
    }
    fail_after = -1;
    if (!parse("{\"a\":{\"b\":1}}", true)) return 9;
    std::puts("PASS real JSON adapter: object/types/grammar/depth/trailing/NUL/8191 bytes/partial "
              "OOM/recovery");
}
