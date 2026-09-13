#pragma once

#include "cJSON.h"

namespace daik {

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
