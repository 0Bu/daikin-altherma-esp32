#pragma once
// Query-string flag policy. A parameter like ?clear=1 is a FLAG whose ACTION must fire only on the
// explicit value the API documents ("1"). httpd_query_key_value() succeeds on mere PRESENCE of the
// key, so a handler that acts on that return code alone treats ?clear=0, ?clear=, or ?clear=x the
// same as ?clear=1 — which is how GET /diag?clear=0 wiped the log while the docs promised only
// clear=1. Pure + host-tested (test/test_logic.cpp) so the "exactly 1" rule is asserted, not assumed.
#include <cstddef>

namespace daik {

// True iff `value` is exactly "1" (a NUL-terminated query value). Rejects nullptr, "", "0", "10",
// "1x", "true" — anything that is not the single character '1'. The single-char form is deliberate:
// the API documents `?clear=1`, so "10"/"1x" are typos to ignore, not near-misses to honour.
inline bool query_flag_on(const char* value) {
    return value != nullptr && value[0] == '1' && value[1] == '\0';
}

}  // namespace daik
