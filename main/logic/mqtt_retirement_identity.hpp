#pragma once

#include "availability.hpp"
#include "conv_override.hpp"
#include "discovery.hpp"
#include "label_override.hpp"
#include "profile_view.hpp"
#include <array>
#include <cstddef>

namespace daik {

inline constexpr size_t MQTT_RETIREMENT_OBJECT_CAPACITY = 128;
enum class MqttRetirementIdentityResult { Empty, Ready, TooLong };
enum class MqttRetirementPresence { Pending, Present, Absent };

struct MqttRetirementIdentity {
    std::array<char, MQTT_RETIREMENT_OBJECT_CAPACITY> object{};
    size_t                                            size   = 0;
    bool                                              binary = false;
};

namespace retirement_identity_detail {
template <class Sink>
inline size_t append(Sink& sink, const ValueDef& row, const char* key) noexcept {
    size_t prefix = 1;
    for (const char* group = group_for_page(row.reg); *group; ++group) {
        sink += *group;
        ++prefix;
    }
    sink += '_';
    if (key) {
        for (; *key; ++key) sink += *key;
    } else
        ha_slug_append(sink, row.label);
    return prefix;
}

struct Capture {
    MqttRetirementIdentity& identity;
    bool                    overflow = false;
    Capture&                operator+=(char byte) noexcept {
        if (identity.size == identity.object.size())
            overflow = true;
        else
            identity.object[identity.size++] = byte;
        return *this;
    }
};

struct Compare {
    const MqttRetirementIdentity& identity;
    size_t                        at    = 0;
    bool                          equal = true;
    Compare&                      operator+=(char byte) noexcept {
        if (at >= identity.size || identity.object[at] != byte) equal = false;
        ++at;
        return *this;
    }
};
} // namespace retirement_identity_detail

// Exactly the component + scoped object segment used by discovery_topic/companion_discovery_topic.
// Comparing the joined group/key matters: group prefixes can overlap, and a regular binary row
// can occupy the same namespace as a derived fault companion. Slugging uses the production sink.
inline MqttRetirementIdentityResult
mqtt_retirement_identity_make(MqttRetirementIdentity& identity, const ValueDef& row,
                              const char* companion_key = nullptr) noexcept {
    identity.size   = 0;
    identity.binary = companion_key || conv_is_binary(row.conv);
    retirement_identity_detail::Capture sink{identity};
    const size_t prefix = retirement_identity_detail::append(sink, row, companion_key);
    if (sink.overflow) return MqttRetirementIdentityResult::TooLong;
    return identity.size == prefix ? MqttRetirementIdentityResult::Empty
                                   : MqttRetirementIdentityResult::Ready;
}

inline bool mqtt_retirement_identity_matches(const MqttRetirementIdentity& identity,
                                             const ValueDef&               row,
                                             const char*                   companion_key = nullptr,
                                             bool* has_object = nullptr) noexcept {
    retirement_identity_detail::Compare sink{identity};
    const size_t prefix = retirement_identity_detail::append(sink, row, companion_key);
    if (has_object) *has_object = sink.at > prefix;
    return identity.binary == static_cast<bool>(companion_key || conv_is_binary(row.conv)) &&
           sink.equal && sink.at == identity.size;
}

struct MqttRetirementScan {
    size_t                 row    = 0;
    MqttRetirementPresence result = MqttRetirementPresence::Pending;
};

// A slice may only report Absent after exhausting the entire replacement. Each row consumes work,
// including disabled/grid rows and all of that row's bounded companion comparisons. No allocation.
inline MqttRetirementPresence mqtt_retirement_scan_step(const MqttRetirementIdentity& identity,
                                                        const logic::ProfileView&     profile,
                                                        MqttRetirementScan&           scan,
                                                        size_t& work) noexcept {
    while (scan.result == MqttRetirementPresence::Pending && scan.row < profile.count() && work) {
        --work;
        const ValueDef row = logic::adjudicated(profile, scan.row++);
        if (!row_publishable(row) || !conv_publishable(row.conv)) continue;
        bool has_object = false;
        if (mqtt_retirement_identity_matches(identity, row, nullptr, &has_object))
            scan.result = MqttRetirementPresence::Present;
        else if (has_object && row.conv == 203) {
            for (size_t i = 0; i < FAULT_COMPANION_COUNT; ++i)
                if (mqtt_retirement_identity_matches(identity, row, FAULT_COMPANIONS[i].key)) {
                    scan.result = MqttRetirementPresence::Present;
                    break;
                }
        }
    }
    if (scan.result == MqttRetirementPresence::Pending && scan.row == profile.count())
        scan.result = MqttRetirementPresence::Absent;
    return scan.result;
}

} // namespace daik
