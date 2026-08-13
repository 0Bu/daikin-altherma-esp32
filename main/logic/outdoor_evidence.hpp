#pragma once
// One provenance + freshness contract for outdoor-air context.
//
// There are three physically different sources in this firmware and none may borrow another one's
// freshness rule:
//   * X10A page 0x20 answers while the outdoor unit sleeps, but the bytes are held from the last
//     compressor run. A row is current only when it answered THIS poll cycle and the independent
//     RPS witness positively says the compressor is running. `held == false` is insufficient when
//     that witness is unknown.
//   * HomeHub input 44 is current only when that row answered in THIS Modbus cycle and the socket
//     session which read it is still current. It does not depend on compressor state.
//   * ENV III is a local accessory. Its driver owns age and plausibility; both must pass now.
//
// The result is CONTEXT, never permission. Heating-curve and checkup logic consume this object but
// no verdict/gate reads `available`; absence therefore remains null and cannot hold, block or clear
// a diagnosis.
#include <cmath>
#include <cstdint>

namespace daik::logic {

enum class OutdoorSource : uint8_t {
    None    = 0,
    X10a    = 1,
    HomeHub = 2,
    Env3    = 3,
};

inline const char* outdoor_source_name(OutdoorSource source) {
    switch (source) {
        case OutdoorSource::X10a:    return "x10a";
        case OutdoorSource::HomeHub: return "homehub";
        case OutdoorSource::Env3:    return "env3";
        case OutdoorSource::None:    return "none";
    }
    return "none";
}

struct OutdoorEvidence {
    bool available = false;
    OutdoorSource source = OutdoorSource::None;
    double temperature_c = 0.0;
};

inline OutdoorEvidence outdoor_evidence(OutdoorSource source, bool answered_this_cycle,
                                        bool source_fresh, double temperature_c) {
    if (source == OutdoorSource::None || !answered_this_cycle || !source_fresh ||
        !std::isfinite(temperature_c))
        return {};
    return OutdoorEvidence{true, source, temperature_c};
}

inline OutdoorEvidence outdoor_x10a_evidence(bool row_answered_this_cycle, bool rps_known,
                                             bool rps_running, double temperature_c) {
    return outdoor_evidence(OutdoorSource::X10a, row_answered_this_cycle,
                            rps_known && rps_running, temperature_c);
}

inline OutdoorEvidence outdoor_homehub_evidence(bool row_answered_this_cycle,
                                                bool current_session, double temperature_c) {
    return outdoor_evidence(OutdoorSource::HomeHub, row_answered_this_cycle, current_session,
                            temperature_c);
}

inline OutdoorEvidence outdoor_env3_evidence(bool fresh, bool plausible, double temperature_c) {
    return outdoor_evidence(OutdoorSource::Env3, true, fresh && plausible, temperature_c);
}

inline bool outdoor_evidence_valid(const OutdoorEvidence& evidence) {
    return evidence.available && evidence.source != OutdoorSource::None &&
           std::isfinite(evidence.temperature_c);
}

}  // namespace daik::logic
