#pragma once

#include "cJSON.h"
#include "logic/payload_complete.hpp"

namespace daik {

inline cJSON* json_parse_document(std::string_view payload) {
    return json_parse_bounded(
        payload,
        [](const char* bytes, size_t length, const char** end) noexcept {
            return cJSON_ParseWithLengthOpts(bytes, length, end, false);
        },
        [](cJSON* root) noexcept { cJSON_Delete(root); }, JSON_MAX_DEPTH);
}

struct JsonGuard {
    explicit JsonGuard(cJSON* root = nullptr) : root(root) {}
    ~JsonGuard() { reset(); }
    JsonGuard(const JsonGuard&)            = delete;
    JsonGuard& operator=(const JsonGuard&) = delete;
    void       reset(cJSON* next = nullptr) {
        if (root) cJSON_Delete(root);
        root = next;
    }
    cJSON* release() {
        cJSON* r = root;
        root     = nullptr;
        return r;
    }
    cJSON* get() const { return root; }
    operator cJSON*() const { return root; }
    cJSON*   operator->() const { return root; }
    explicit operator bool() const { return root != nullptr; }
    cJSON*   root = nullptr;
};

} // namespace daik
