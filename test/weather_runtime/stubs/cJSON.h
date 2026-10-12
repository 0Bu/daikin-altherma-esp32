#pragma once
// AST ownership/type adapter. This deliberately has NO JSON lexer; optional --real-cjson uses
// the IDF-lock-resolved source instead and runs a real lexer corpus in the same production TU.
#include "sdk.hpp"
#include <cstdlib>
struct cJSON {
    cJSON *next = nullptr, *child = nullptr;
    int    type        = 0;
    char * valuestring = nullptr, *string = nullptr;
    double valuedouble = 0;
};
constexpr int cJSON_Number = 1, cJSON_String = 2, cJSON_Array = 3, cJSON_Object = 4;
namespace sdk {
inline cJSON* json_tree = nullptr;
}
inline char* fixture_json_string(const char* text) {
    const size_t n    = std::strlen(text) + 1;
    char*        copy = static_cast<char*>(std::malloc(n));
    if (!copy) throw std::bad_alloc();
    std::memcpy(copy, text, n);
    return copy;
}
inline cJSON* cJSON_CreateObject() {
    auto* p = new cJSON;
    p->type = cJSON_Object;
    return p;
}
inline cJSON* cJSON_CreateArray() {
    auto* p = new cJSON;
    p->type = cJSON_Array;
    return p;
}
inline cJSON* cJSON_CreateNumber(double n) {
    auto* p        = new cJSON;
    p->type        = cJSON_Number;
    p->valuedouble = n;
    return p;
}
inline cJSON* cJSON_CreateString(const char* text) {
    auto* p        = new cJSON;
    p->type        = cJSON_String;
    p->valuestring = fixture_json_string(text);
    return p;
}
inline void cJSON_AddItemToArray(cJSON* parent, cJSON* node) {
    cJSON** slot = &parent->child;
    while (*slot) slot = &(*slot)->next;
    *slot = node;
}
inline void cJSON_AddItemToObject(cJSON* parent, const char* key, cJSON* node) {
    node->string = fixture_json_string(key);
    cJSON_AddItemToArray(parent, node);
}
inline bool   cJSON_IsArray(const cJSON* node) { return node && node->type == cJSON_Array; }
inline bool   cJSON_IsObject(const cJSON* node) { return node && node->type == cJSON_Object; }
inline bool   cJSON_IsNumber(const cJSON* node) { return node && node->type == cJSON_Number; }
inline bool   cJSON_IsString(const cJSON* node) { return node && node->type == cJSON_String; }
inline cJSON* cJSON_GetObjectItemCaseSensitive(cJSON* parent, const char* key) {
    if (!parent) return nullptr;
    for (cJSON* child = parent->child; child; child = child->next)
        if (child->string && std::strcmp(key, child->string) == 0) return child;
    return nullptr;
}
inline int cJSON_GetArraySize(cJSON* parent) {
    int n = 0;
    for (cJSON* p = parent ? parent->child : nullptr; p; p = p->next) ++n;
    return n;
}
inline cJSON* cJSON_GetArrayItem(cJSON* parent, int i) {
    cJSON* node = parent ? parent->child : nullptr;
    while (node && i-- > 0) node = node->next;
    return node;
}
inline void fixture_delete_json(cJSON* node) {
    while (node) {
        cJSON* next = node->next;
        fixture_delete_json(node->child);
        std::free(node->string);
        std::free(node->valuestring);
        delete node;
        node = next;
    }
}
inline void cJSON_Delete(cJSON* root) {
    ++sdk::json_deletes;
    fixture_delete_json(root);
}
inline cJSON* cJSON_ParseWithLengthOpts(const char* text, size_t length, const char** end, bool) {
    ++sdk::json_parses;
    if (sdk::json_parse_fails) return nullptr;
    *end           = text + std::min(length, sdk::json_prefix_length);
    auto* root     = sdk::json_tree;
    sdk::json_tree = nullptr;
    if (sdk::fail_alloc_after_parse) sdk::fail_cpp_alloc = true;
    return root;
}
