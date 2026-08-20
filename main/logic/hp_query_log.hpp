#pragma once
// X10A query logging policy (hp_comm.cpp). Pure, IDF-free and host-tested.
//
// Auto-detection deliberately asks for the union of pages used by every supported profile. An
// individual unit is therefore expected to reject or ignore some of those requests. Reporting each
// expected absence from the transport layer made a healthy detection pass look like a broken cable
// (and one absent page is retried three times). Detection still reports its final page mask and a
// single actionable error when NO protocol/pin pair answers; only corrupt/partial replies remain
// noteworthy per request. Normal polling reads pages selected for the detected profile, so every
// failure there remains diagnostic.
#include <cstdint>

namespace daik {

enum class HpQueryLogPolicy : uint8_t {
    All,
    IntegrityOnly,
};

enum class HpQueryFailure : uint8_t {
    NoReply,
    Rejected,
    ShortReply,
    InvalidLength,
    BadCrc,
    UnexpectedReply,
};

inline bool hp_query_should_log(HpQueryLogPolicy policy, HpQueryFailure failure) {
    return policy == HpQueryLogPolicy::All ||
           (failure != HpQueryFailure::NoReply && failure != HpQueryFailure::Rejected);
}

} // namespace daik
