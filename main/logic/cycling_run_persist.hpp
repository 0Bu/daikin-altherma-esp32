#pragma once

#include "cycling_persist.hpp"
#include "cycling_run_context.hpp"

namespace daik::logic {

// Independent versioned X10A run details inside the existing Checkup journal envelope.
// The journal protects the complete page with its CRC and final commit word.
inline constexpr uint32_t CYCLING_RUN_JOURNAL_SCHEMA   = 0x31584352u; // RCX1
inline constexpr size_t   CYCLING_RUN_JOURNAL_CAPACITY = 5;

struct CyclingRunJournalPage {
    CyclingTraceIdentity identity{};
    CyclingRunContext    entries[CYCLING_RUN_JOURNAL_CAPACITY]{};
};
inline constexpr uint16_t CYCLING_RUN_JOURNAL_WORDS =
    sizeof(CyclingRunJournalPage) / sizeof(HistorySample);
static_assert(std::is_trivially_copyable<CyclingRunJournalPage>::value &&
                  std::is_standard_layout<CyclingRunJournalPage>::value &&
                  offsetof(CyclingRunJournalPage, entries) == 12 &&
                  sizeof(CyclingRunJournalPage) == 192 &&
                  sizeof(CyclingRunJournalPage) ==
                      CYCLING_RUN_JOURNAL_WORDS * sizeof(HistorySample) &&
                  sizeof(CyclingRunJournalPage) <= HISTORY_JOURNAL_PAYLOAD_BYTES,
              "run detail page must fit the existing journal slot");

inline size_t cycling_run_journal_count(const CyclingRunJournalPage& page) {
    size_t count = 0;
    while (count < CYCLING_RUN_JOURNAL_CAPACITY && page.entries[count].start_s) ++count;
    return count;
}

inline bool cycling_run_journal_header_matches(const HistoryJournalHeader& h) {
    return h.source == static_cast<uint8_t>(HistoryJournalSource::Checkup) &&
           history_journal_header_matches(h, CYCLING_RUN_JOURNAL_SCHEMA, CYCLING_RUN_JOURNAL_WORDS,
                                          CHECKUP_DT_S);
}

inline bool cycling_run_journal_entry_valid(const CyclingRunContext& run) {
    constexpr uint8_t required = RUN_CTX_F_STOPPED | RUN_CTX_F_FINALIZED;
    constexpr uint8_t allowed  = required | RUN_CTX_F_LOW_RPS_ABOVE_TGT;
    return run.start_s != 0 && run.stop_s > run.start_s &&
           run.stop_s - run.start_s <= CHECKUP_WINDOW_S && !run.reserved &&
           (run.flags & required) == required && !(run.flags & ~allowed) &&
           run.mode <= static_cast<uint8_t>(CyclingRunMode::Other) &&
           run.start_kind <= static_cast<uint8_t>(CyclingStartKind::DhwStart) &&
           run.stop_kind <= static_cast<uint8_t>(CyclingStopKind::Normal) &&
           (run.flow_tenths == CHECKUP_ABSENT || run.flow_tenths >= 0) &&
           (run.flow_typical_tenths == CHECKUP_ABSENT || run.flow_typical_tenths > 0);
}

inline bool cycling_run_journal_page_valid(const HistoryJournalHeader&  h,
                                           const CyclingRunJournalPage& page) {
    if (!page.identity.model_fp || !page.identity.source_fp ||
        !page.identity.diagnostics_generation)
        return false;

    const size_t count = cycling_run_journal_count(page);
    if (!count || h.bucket != page.entries[count - 1].stop_s / CHECKUP_DT_S) return false;
    uint32_t previous_stop = 0;
    for (size_t i = 0; i < count; ++i) {
        const auto& run = page.entries[i];
        if (!cycling_run_journal_entry_valid(run) || run.start_s < previous_stop) return false;
        previous_stop = run.stop_s;
    }

    const auto* bytes = reinterpret_cast<const unsigned char*>(&page.entries);
    for (size_t i = count * sizeof(CyclingRunContext); i < sizeof(page.entries); ++i)
        if (bytes[i] != 0) return false;
    return true;
}

} // namespace daik::logic
