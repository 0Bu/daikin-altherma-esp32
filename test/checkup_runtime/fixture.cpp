// Complete production checkup TU and real project headers; SDK/external services are host ports.
#include "sdk.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <cstring>
#ifndef CHECKUP_PRODUCTION_SOURCE
#error "Bind complete production main/checkup.cpp"
#endif
#include CHECKUP_PRODUCTION_SOURCE

namespace adapter {
daik::Config cfg;
uint32_t     poll_generation = 7, circulation_generation = 11, mb_target_generation = 3;
daik::CirculationPumpSample circulation{true, true, false};
bool                        journal_pending = true, mb_journal_pending = true;
unsigned                    circulation_samples = 0;
void (*on_circulation)()                        = nullptr;
void (*on_time)()                               = nullptr;
int64_t unix_origin                             = 1700000000;
int32_t unix_offset_ms                          = 0;
bool    clock_synced                            = true;
} // namespace adapter
namespace daik {
namespace detail {
void          config_lock() {}
void          config_unlock() {}
const Config& config_ref_locked() { return adapter::cfg; }
} // namespace detail
void diag_printf(const char*, ...) {}
bool history_checkup_flash_pending() { return adapter::journal_pending; }
bool history_modbus_checkup_flash_pending() { return adapter::mb_journal_pending; }
bool safe_mode_active() { return false; }
bool time_synced() { return adapter::clock_synced; }
void time_now(int64_t& s, int32_t& ms) {
    if (adapter::on_time) {
        const auto f     = adapter::on_time;
        adapter::on_time = nullptr;
        f();
    }
    const int64_t wall_ms =
        adapter::unix_origin * 1000 + sdk::now_us / 1000 + adapter::unix_offset_ms;
    s  = adapter::clock_synced ? wall_ms / 1000 : -1;
    ms = adapter::clock_synced ? static_cast<int32_t>(wall_ms % 1000) : 0;
}
bool     hp_poll_generation_matches(uint32_t g) { return g == adapter::poll_generation; }
uint32_t hp_poll_generation() { return adapter::poll_generation; }
bool     mb_target_generation_matches(uint32_t g) noexcept {
    return g == adapter::mb_target_generation;
}
uint32_t              circulation_source_generation() { return adapter::circulation_generation; }
CirculationPumpSample circulation_pump_sample() {
    ++adapter::circulation_samples;
    if (adapter::on_circulation) {
        auto f                  = adapter::on_circulation;
        adapter::on_circulation = nullptr;
        f();
    }
    return adapter::circulation;
}
} // namespace daik
namespace {
using namespace daik;
using namespace daik::logic;
unsigned assertions = 0;
void     require(bool ok, const char* oracle) {
    ++assertions;
    if (!ok) throw std::runtime_error(oracle);
}
CachedValue row(CheckupLocator l, const char* value) {
    CachedValue v;
    v.label = "synthetic endpoint";
    v.value = value;
    v.reg   = l.reg;
    v.off   = l.off;
    v.conv  = static_cast<uint16_t>(l.conv);
    return v;
}
CachedValue fault(unsigned slot, unsigned index) {
    const auto view  = def::lookup_view("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw");
    unsigned   found = 0;
    for (size_t i = 0; i < view.count(); ++i) {
        if (!row_publishable(view[i])) continue;
        const ValueDef d = adjudicated(view, i);
        if (d.conv != 203) continue;
        if (found++ != slot) continue;
        CachedValue v;
        v.reg   = d.reg;
        v.off   = d.offset;
        v.conv  = d.conv;
        v.label = d.label;
        v.value = daik::ERR_TYPE[index];
        return v;
    }
    throw std::runtime_error("fixture_fault_slot_missing");
}
CheckupCoverage coverage() {
    CheckupCoverage c;
    const auto      view = def::lookup_view("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw");
    for (size_t i = 0; i < view.count(); ++i) {
        if (!row_publishable(view[i])) continue;
        const ValueDef v = adjudicated(view, i);
        checkup_cover_row(c, v.reg, v.offset, v.conv, v.label);
    }
    require(c.buh1 && c.buh2 && c.bsh && c.fault_rows == 2, "fixture_real_profile_coverage");
    return c;
}
void boot() {
    adapter::cfg.circulation_topic = "synthetic/circulation";
    checkup_start(true, 23);
    checkup_reset_on_detect("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", 0x12345678);
}
void sample(int64_t at_s, const std::vector<CachedValue>& rows, const CheckupCoverage& cov,
            bool rps_known = true, bool running = false, bool confirmed = true,
            uint32_t generation = 7) {
    const uint32_t consent_epoch = checkup_consent_epoch();
    sdk::now_us                  = at_s * 1000000;
    checkup_record(rows.data(), rows.size(), rps_known, running, cov, generation, consent_epoch,
                   confirmed);
}
std::vector<CachedValue> heater(const char* first, const char* second, const char* bsh) {
    std::vector<CachedValue> v;
    if (first) v.push_back(row(CHECKUP_LOC_BUH1, first));
    if (second) v.push_back(row(CHECKUP_LOC_BUH2, second));
    if (bsh) v.push_back(row(CHECKUP_LOC_BSH, bsh));
    return v;
}
void heater_case(const std::string& name) {
    require(name == "buh_one_on_other_missing" || name == "buh_second_on_first_missing" ||
                name == "buh_one_off_other_missing" || name == "buh_both_off" ||
                name == "heaters_both_on" || name == "legacy_text_unknown" ||
                name == "single_declared_buh_step",
            "unknown_case");
    boot();
    auto                     cov = coverage();
    std::vector<CachedValue> rows;
    int                      want_buh = -1, want_bsh = -1, want_buh_seen = 0, want_bsh_seen = 0;
    if (name == "buh_one_on_other_missing") {
        rows          = heater("1", nullptr, "0");
        want_buh      = 10;
        want_bsh      = 0;
        want_buh_seen = want_bsh_seen = 10;
    }
    if (name == "buh_second_on_first_missing") {
        rows          = heater(nullptr, "1", "0");
        want_buh      = 10;
        want_bsh      = 0;
        want_buh_seen = want_bsh_seen = 10;
    }
    if (name == "buh_one_off_other_missing") {
        rows          = heater("0", nullptr, "0");
        want_bsh      = 0;
        want_bsh_seen = 10;
    }
    if (name == "buh_both_off") {
        rows     = heater("0", "0", "0");
        want_buh = want_bsh = 0;
        want_buh_seen = want_bsh_seen = 10;
    }
    if (name == "heaters_both_on") {
        rows     = heater("1", "1", "1");
        want_buh = want_bsh = 10;
        want_buh_seen = want_bsh_seen = 10;
    }
    if (name == "legacy_text_unknown") {
        rows = heater("OFF", "0", "ON");
    }
    if (name == "single_declared_buh_step") {
        rows          = heater("0", nullptr, nullptr);
        cov.buh2      = false;
        cov.bsh       = false;
        want_buh      = 0;
        want_buh_seen = 10;
        want_bsh_seen = -1;
    }
    sample(1, rows, cov);
    sample(11, rows, cov);
    const auto  r = checkup_report();
    const auto& h = r[CheckupCheck::Heater];
    require(h.a == want_buh, "buh_endpoint_truth");
    require(h.b == want_bsh, "bsh_endpoint_truth");
    require(h.c == want_buh_seen, "buh_independent_clock");
    require(h.d == want_bsh_seen, "bsh_independent_clock");
    require(r.overall != CheckupVerdict::Ok, "short_population_not_reassuring");
}
void independent_heaters() {
    boot();
    auto cov = coverage();
    auto a   = heater("1", "0", "1");
    auto b   = heater("1", "0", nullptr);
    auto c   = heater("0", "0", "0");
    sample(1, a, cov);
    sample(11, a, cov);
    sample(21, b, cov);
    sample(31, c, cov);
    sample(41, c, cov);
    const auto h = checkup_report()[CheckupCheck::Heater];
    require(h.a == 20 && h.b == 10, "independent_active_seconds");
    require(h.c == 40 && h.d == 20, "independent_endpoint_clocks");
}
void fault_case(const std::string& name) {
    require(name == "fault_missing_sibling" || name == "fault_worst_readable" ||
                name == "fault_worst_readable_reverse" || name == "fault_warning_with_missing" ||
                name == "fault_both_normal",
            "unknown_case");
    boot();
    auto                     cov = coverage();
    std::vector<CachedValue> rows;
    if (name == "fault_missing_sibling") rows = {fault(1, 0)};
    if (name == "fault_worst_readable") rows = {fault(0, 2), fault(1, 1)};
    if (name == "fault_worst_readable_reverse") rows = {fault(0, 1), fault(1, 2)};
    if (name == "fault_warning_with_missing") rows = {fault(1, 2)};
    if (name == "fault_both_normal") rows = {fault(0, 0), fault(1, 0)};
    sample(1, rows, cov);
    const auto r = checkup_report();
    const auto f = r[CheckupCheck::Fault];
    if (name == "fault_missing_sibling")
        require(f.verdict == CheckupVerdict::Collecting && f.a == -1,
                "unread_sibling_not_fault_clear");
    if (name == "fault_worst_readable" || name == "fault_worst_readable_reverse")
        require(f.verdict == CheckupVerdict::Warn && f.a == 1, "worst_readable_fault_wins");
    if (name == "fault_warning_with_missing")
        require(f.verdict == CheckupVerdict::Info && f.a == 1,
                "positive_warning_survives_missing_sibling");
    if (name == "fault_both_normal")
        require(f.verdict == CheckupVerdict::Ok && f.a == 0, "all_fault_rows_normal");
}
void source_freshness() {
    boot();
    auto cov = coverage();
    auto rows =
        std::vector<CachedValue>{fault(0, 0), fault(1, 0), row(CHECKUP_LOC_PRESSURE, "1.5")};
    sample(1, rows, cov);
    sample(11, rows, cov);
    sdk::now_us = 26000000;
    auto r      = checkup_report();
    require(r.source_fresh && r.source_age_s == 15 && r.pressure_current_tenths == 15,
            "inclusive_freshness_boundary");
    sdk::now_us = 26000001;
    r           = checkup_report();
    require(!r.source_fresh && r.pressure_current_tenths == -1, "microsecond_stale_boundary");
    require(r[CheckupCheck::Fault].a == -1 &&
                r[CheckupCheck::Fault].verdict == CheckupVerdict::Collecting,
            "stale_fault_clear_withdrawn");
    sample(27, {}, cov, false, false, false);
    r = checkup_report();
    require(!r.source_fresh && r.source_age_s == 16, "empty_callback_does_not_refresh_source");
    require(r[CheckupCheck::Pressure].verdict != CheckupVerdict::Unavailable,
            "gap_keeps_profile_capability");
}
void stale_finding() {
    boot();
    auto                     cov = coverage();
    std::vector<CachedValue> rows{fault(1, 1), row(CHECKUP_LOC_PRESSURE, "0.9")};
    for (int64_t t = 1; t <= 61; t += 10) sample(t, rows, cov);
    sdk::now_us = 77000000;
    auto r      = checkup_report();
    require(!r.source_fresh && r[CheckupCheck::Fault].verdict == CheckupVerdict::Info &&
                r[CheckupCheck::Fault].a == -1,
            "dated_fault_finding_survives_not_current");
    require(r[CheckupCheck::Pressure].verdict == CheckupVerdict::Info &&
                r[CheckupCheck::Pressure].a == 9,
            "dated_pressure_finding_survives");
}
void backwards_clock() {
    boot();
    auto cov = coverage();
    auto rows =
        std::vector<CachedValue>{fault(0, 0), fault(1, 0), row(CHECKUP_LOC_PRESSURE, "1.5")};
    sample(1, rows, cov);
    sample(11, rows, cov);
    sdk::now_us  = 10000000;
    const auto r = checkup_report();
    require(!r.source_fresh && r.source_age_s == UINT32_MAX && r.pressure_current_tenths == -1,
            "backwards_clock_never_fresh");
}
void generation_case(bool in_flight) {
    boot();
    auto cov  = coverage();
    auto rows = heater("1", "0", "1");
    sample(1, rows, cov);
    sample(11, rows, cov);
    if (in_flight)
        adapter::on_circulation = [] { ++adapter::poll_generation; };
    else
        ++adapter::poll_generation;
    sample(21, rows, cov);
    auto r = checkup_report();
    require(r[CheckupCheck::Heater].a == 10 && r[CheckupCheck::Heater].b == 10,
            "old_generation_not_folded");
    require(r.source_age_s == 10, "old_generation_not_current_source");
}
void reset_read_barrier() {
    boot();
    auto cov  = coverage();
    auto rows = heater("1", "0", "1");
    sample(1, rows, cov);
    sample(11, rows, cov);
    checkup_reset();
    CheckupRestore persist;
    const auto     pending = checkup_report(nullptr, nullptr, &persist);
    require(!pending.source_fresh && pending.available == 0, "queued_reset_report_empty");
    require(persist == CheckupRestore::ModelChanged, "queued_reset_report_provenance");
    sample(21, rows, cov);
    require(!checkup_report().source_fresh, "reset_consuming_sweep_discarded");
    sample(31, rows, cov);
    sample(41, rows, cov);
    require(checkup_report()[CheckupCheck::Heater].a == 10, "reset_no_old_interval_bridge");
}
void reset_during_lock() {
    boot();
    auto cov  = coverage();
    auto rows = heater("1", "0", "1");
    sample(1, rows, cov);
    sample(11, rows, cov);
    sdk::before_take = [] { checkup_reset(); };
    sample(21, rows, cov);
    require(!checkup_report().source_fresh && checkup_report().available == 0,
            "reset_interleaving_discards_staged_sweep");
}
void consent_reset() {
    boot();
    auto cov  = coverage();
    auto rows = heater("1", "0", "1");
    sample(1, rows, cov);
    sample(11, rows, cov);
    sdk::before_take = [] { checkup_set_diagnostics(false, 24); };
    CheckupRestore persist;
    const auto     disabled = checkup_report(nullptr, nullptr, &persist);
    require(!disabled.source_fresh && disabled.available == 0, "disabled_no_observation");
    require(persist == CheckupRestore::DiagnosticsDisabled, "disabled_report_provenance");
    const auto calls = adapter::circulation_samples;
    sample(21, rows, cov);
    require(adapter::circulation_samples == calls, "disabled_does_not_sample_sources");
    checkup_set_diagnostics(true, 25);
    sample(31, rows, cov);
    sample(41, rows, cov);
    require(checkup_report()[CheckupCheck::Heater].a == 10, "consent_does_not_bridge_old_seconds");
}
void circulation_reset() {
    boot();
    auto cov  = coverage();
    auto rows = heater("1", "0", "0");
    rows.push_back(row(CHECKUP_LOC_PUMP, "0"));
    rows.push_back(row(CHECKUP_LOC_VALVE, "0"));
    rows.push_back(row(CHECKUP_LOC_R5T, "50.0"));
    rows.push_back(row(CHECKUP_LOC_PRESSURE, "0.9"));
    for (int64_t t = 1; t <= 7201; t += 10) sample(t, rows, cov);
    const auto before = checkup_report();
    require(before[CheckupCheck::DhwLoss].observed_s == 3600, "fixture_real_dhw_window_completed");
    require(before[CheckupCheck::Heater].a > 6000, "fixture_real_core_seconds_accumulated");
    adapter::cfg.circulation_topic = "synthetic/replaced";
    ++adapter::circulation_generation;
    checkup_dhw_reset();
    const auto pending = checkup_report();
    require(pending[CheckupCheck::DhwLoss].observed_s == 0,
            "dhw_pending_reset_hides_old_observation");
    require(pending[CheckupCheck::Heater].a == before[CheckupCheck::Heater].a &&
                pending[CheckupCheck::Pressure].a == 9,
            "dhw_reset_preserves_core");
    sample(7211, rows, cov);
    const auto after = checkup_report();
    require(after[CheckupCheck::DhwLoss].observed_s == 0,
            "dhw_consumed_reset_retires_old_observation");
    require(after[CheckupCheck::Heater].a == before[CheckupCheck::Heater].a + 10,
            "dhw_reset_core_clock_continues");
    require(after[CheckupCheck::Pressure].a == 9, "dhw_reset_retains_pressure_finding");
    CheckupJournalPayload payload;
    int64_t               bucket = INT64_MIN;
    require(checkup_flash_next(adapter::unix_origin + 7211, INT64_MIN, bucket, payload),
            "dhw_reset_retains_journal_geometry");
    require(payload.checkup.buh_s > 0 && payload.dhw_source_fp == 0 && payload.dhw.windows == 0,
            "dhw_reset_journal_old_source_withheld");
}
void circulation_inflight() {
    boot();
    auto cov  = coverage();
    auto rows = heater("0", "0", "0");
    rows.push_back(row(CHECKUP_LOC_PUMP, "0"));
    rows.push_back(row(CHECKUP_LOC_VALVE, "0"));
    rows.push_back(row(CHECKUP_LOC_R5T, "50.0"));
    for (int64_t t = 1; t <= 3001; t += 10) sample(t, rows, cov);
    const auto before = checkup_report();
    require(before.dhw_candidate_s > 0, "fixture_actual_dhw_candidate_open");
    adapter::on_circulation = [] { ++adapter::circulation_generation; };
    sample(3011, rows, cov);
    const auto after = checkup_report();
    require(after.dhw_candidate_s == before.dhw_candidate_s,
            "circulation_epoch_discards_staged_dhw_sample");
    require(after.source_age_s == 0, "circulation_epoch_preserves_core_source");
}
void pending_expiry() {
    boot();
    auto                     cov = coverage();
    std::vector<CachedValue> rows{fault(1, 1), row(CHECKUP_LOC_PRESSURE, "0.9")};
    for (int64_t t = 100; t <= 160; t += 10) sample(t, rows, cov);
    sdk::now_us = CHECKUP_WINDOW_US - 1;
    auto before = checkup_report();
    require(before[CheckupCheck::Pressure].a == 9,
            "pending_finding_retained_before_exact_deadline");
    sdk::now_us = CHECKUP_WINDOW_US;
    auto after  = checkup_report();
    require(after.covered_s == 0 && after[CheckupCheck::Pressure].a == -1 &&
                after[CheckupCheck::Fault].verdict != CheckupVerdict::Info,
            "pending_expires_without_producer");
}
void report_without_mutex() {
    // Start with a valid retained header and a journal awaiting confirmation.
    sdk::reset_reason        = static_cast<int>(CrashReason::SW);
    s_diagnostics_generation = 23;
    checkup_persist_seal(s_x10a);
    sdk::fail_create_once = true;
    boot();
    require(!s_mtx && s_x10a.persist_verdict == CheckupRestore::FlashPending,
            "warm_start_with_pending_journal_exercised");
    CheckupRestore      persist = CheckupRestore::FlashPending;
    CheckupCyclingHours hours{};
    hours.count = 1;
    hours.epoch = 17;
    CheckupCyclingTrace trace{};
    trace.unix_s          = static_cast<uint32_t>(adapter::unix_origin);
    const auto unreadable = checkup_report(&hours, &trace, &persist);
    require(persist == CheckupRestore::Unknown, "allocation_failure_restore_unknown");
    require(unreadable.covered_s == 0 && !unreadable.source_fresh && hours.count == 0 &&
                hours.epoch == 0 && trace.unix_s == 0,
            "allocation_failure_withholds_all_evidence");
}

void restored_cycling_detail() {
    constexpr auto profile    = "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw";
    sdk::now_us               = 0;
    const auto           wall = adapter::unix_origin;
    CyclingTraceIdentity identity{checkup_model_fingerprint(profile, def::lookup_view(profile)),
                                  0x12345678, 23};
    using Trace = CheckupCyclingTrace;
    Trace saved;
    saved.unix_s       = static_cast<uint32_t>(wall - 900);
    saved.window_end_s = CHECKUP_WINDOW_S;
    saved.end_s        = 86399;
    saved.push(86000, Trace::Off);
    saved.push(86005, Trace::Start);
    saved.push(86005, Trace::Heat);
    saved.push(86020, Trace::Off);
    saved.push(86021, Trace::Stop);
    saved.push(86399, Trace::Start);
    checkup_start(true, 23);
    using Result = CheckupFlashRestoreResult;
    require(checkup_cycling_restore(saved, identity, wall, 0) == Result::Deferred,
            "cycling_waits_for_current_source");
    checkup_reset_on_detect(profile, identity.source_fp);
    auto other = identity;
    ++other.diagnostics_generation;
    require(checkup_cycling_restore(saved, other, wall, 0) == Result::Ignored,
            "cycling_rejects_different_consent");
    adapter::unix_origin -= 905;
    require(checkup_cycling_restore(saved, identity, wall - 905, 0) == Result::TryOlder,
            "cycling_rejects_future_checkpoint");
    adapter::unix_origin    = wall;
    adapter::unix_offset_ms = 750;
    sdk::now_us             = 10500000;
    auto overlaps           = saved;
    overlaps.unix_s = static_cast<uint32_t>(wall + 2); // Its final observation is at wall + 1.
    require(checkup_cycling_restore(overlaps, identity, wall + 11, 0) == Result::TryOlder,
            "cycling_rejects_predecode_clock_rounded_across_boot_boundary");
    sdk::now_us             = 0;
    adapter::unix_offset_ms = 0;
    require(checkup_cycling_restore(saved, identity, wall, 0) == Result::Restored,
            "cycling_restored");
    Trace view;
    checkup_report(nullptr, &view);
    require(view.count == 6 && !view.live && view.unix_s == wall && view.boot_s == 0 &&
                view.end_s == 85499,
            "cycling_restart_gap_and_no_fresh_claim");
    require(Trace::second(view.at(1)) == 85105 && Trace::second(view.at(4)) == 85121,
            "cycling_restored_edges_keep_absolute_time");
    const auto                     cov = coverage();
    const std::vector<CachedValue> rows{row(CHECKUP_LOC_PRESSURE, "1.5")};
    sample(1, rows, cov);
    sample(2, rows, cov, true, true);
    sample(3, rows, cov);
    uint32_t barrier = 0;
    require(checkup_cycling_checkpoint(view, other, barrier, 0, true) && !barrier && view.live &&
                view.boot_s == 3 && view.count > 7 && other.source_fp == identity.source_fp,
            "cycling_checkpoint_contains_both_boots");
    require(Trace::kind(view.at(6)) == Trace::Gap, "cycling_checkpoint_separates_boots");
    sdk::now_us                = int64_t{85400} * 1000000;
    const auto starting_points = [&] {
        checkup_report(nullptr, &view);
        unsigned count = 0;
        for (size_t i = 0; i < view.count; ++i) count += Trace::kind(view.at(i)) == Trace::Start;
        return count;
    };
    require(starting_points() == 2, "cycling_oldest_start_aged_out");
    adapter::unix_origin -= 600;
    require(starting_points() == 2, "cycling_wall_step_cannot_reintroduce_aged_out_start");
    adapter::unix_origin += 600;
    checkup_reset();
    adapter::unix_origin = -1 - sdk::now_us / 1000000;
    require(checkup_cycling_checkpoint(view, other, barrier, 0, false) && barrier && !view.count &&
                view.unix_s == 1 && !other.model_fp && !other.source_fp,
            "cycling_reset_barrier_has_sequence_without_wall_time");
    adapter::unix_origin = wall;
    checkup_cycling_checkpoint_appended(barrier);
    require(!checkup_cycling_checkpoint(view, other, barrier, 0, false),
            "cycling_durable_barrier_acknowledged");
    require(checkup_cycling_restore(saved, identity, wall, 0) == Result::Ignored,
            "cycling_explicit_reset_cannot_reattach_saved_points");
    checkup_cycling_forget();
    checkup_report(nullptr, &view);
    require(!view.unix_s && !checkup_cycling_checkpoint(view, other, barrier, 0, true),
            "cycling_forget_withholds_trace_and_checkpoint");
}

void restored_expiry() {
    boot();
    auto cov = coverage();
    cov.rps  = true;
    std::vector<CachedValue> rows{fault(0, 0), fault(1, 0), row(CHECKUP_LOC_PRESSURE, "1.5")};
    sample(100, rows, cov);
    CheckupFlashRecord record{};
    auto&              p = record.payload;
    p.model_fp           = checkup_model_fingerprint(
        "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw",
        def::lookup_view("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw"));
    p.source_fp              = 0x12345678;
    p.diagnostics_generation = 23;
    p.dhw_source_fp          = checkup_dhw_source_fingerprint(
        adapter::cfg.mqtt_uri.c_str(), adapter::cfg.circulation_topic.c_str(),
        adapter::cfg.circulation_power_path.c_str(), adapter::cfg.circulation_time_path.c_str(),
        adapter::cfg.circulation_max_age_s, adapter::cfg.circulation_on_tenths_w,
        adapter::cfg.circulation_off_tenths_w, adapter::cfg.circulation_confirm_s);
    // Restore between polls with an admitted interval five seconds inside the horizon.
    sdk::now_us              = 120'000'000;
    const int64_t now        = adapter::unix_origin + 120;
    p.end_unix_s             = now - (CHECKUP_RECORD_MAX_AGE_S - 5);
    record.bucket            = checkup_journal_bucket(p.end_unix_s);
    p.checkup.covered_s      = 1200;
    p.checkup.bar_observed_s = 1200;
    p.checkup.min_bar        = 9;
    p.checkup.flags          = CHECKUP_F_FAULT | CHECKUP_F_LOW_BAR;
    p.checkup.rps_observed_s = 1200;
    p.checkup.starts         = 1;
    require(checkup_flash_restore(&record, 1, now) == CheckupFlashRestoreResult::Restored,
            "synthetic_record_admitted_by_real_restore");
    const auto restored = checkup_report();
    require(restored.span_s == CHECKUP_WINDOW_S - 5 && !restored.full_span,
            "restore_span_excludes_duplicate_elapsed_gap");
    sample(121, rows, cov, true, false);
    sample(122, rows, cov, true, true);
    sample(123, rows, cov, true, true);
    adapter::unix_origin -= 30LL * 86400; // later wall-clock correction cannot rejuvenate the slot
    const int64_t deadline = 125'000'000;
    sdk::now_us            = deadline - 1;
    CheckupCyclingHours hours;
    CheckupRestore      persist;
    const auto          takes_before = sdk::takes;
    auto                before       = checkup_report(&hours, nullptr, &persist);
    require(sdk::takes == takes_before + 1, "report_and_restored_chart_use_one_lock");
    require(persist == CheckupRestore::Flash, "real_restore_snapshot_provenance");
    require(hours.count > 2 && hours.hours[0].provenance == CheckupCyclingSlot::Restored &&
                hours.hours[0].observed_s == 1200 &&
                hours.end_unix_s[0] == static_cast<uint32_t>(p.end_unix_s) &&
                hours.hours[hours.count - 1].provenance == CheckupCyclingSlot::Ordinary,
            "restored_chart_keeps_its_timestamp_and_readable_time");
    const auto old_id = hours.bucket_at(0);
    require(before[CheckupCheck::Pressure].a == 9 &&
                before[CheckupCheck::Fault].verdict == CheckupVerdict::Info,
            "restored_finding_before_exact_deadline");
    CheckupCyclingTrace trace{};
    trace.unix_s          = static_cast<uint32_t>(now);
    sdk::fail_take_once   = true;
    const auto unreadable = checkup_report(&hours, &trace, &persist);
    require(persist == CheckupRestore::Unknown, "lock_failure_restore_unknown");
    require(unreadable.covered_s == 0 && !unreadable.source_fresh && hours.count == 0 &&
                hours.epoch == 0 && trace.unix_s == 0,
            "lock_failure_withholds_all_evidence");
    checkup_report(&hours, nullptr, &persist);
    require(persist == CheckupRestore::Flash && hours.count > 2,
            "lock_failure_does_not_retire_valid_restore");
    sdk::now_us = deadline;
    auto after  = checkup_report(&hours);
    require(hours.count > 2 && hours.bucket_at(0) == old_id &&
                hours.hours[0].provenance == CheckupCyclingSlot::Expired &&
                hours.end_unix_s[0] == 0 && hours.hours[0].observed_s == 0 &&
                hours.hours[0].run_s == 0 && hours.hours[0].starts == 0,
            "expired_restored_slot_is_blank_beside_newer_evidence");
    require(hours.hours[1].provenance == CheckupCyclingSlot::Ordinary &&
                hours.hours[1].observed_s == 0 && hours.end_unix_s[1] == 0 &&
                hours.hours[hours.count - 1].observed_s == 2,
            "expiry_preserves_ordinary_gap_and_newer_observation");
    require(after[CheckupCheck::Pressure].a == 15 &&
                after[CheckupCheck::Fault].verdict != CheckupVerdict::Info,
            "restored_expires_without_producer");
    sample(CHECKUP_DT_S, rows, cov, true, true);
    checkup_report(&hours);
    require(hours.count > 1 && hours.bucket_at(0) > old_id &&
                hours.hours[hours.count - 2].observed_s == 2,
            "slot_overwrite_advances_the_window");
    for (size_t i = 0; i < hours.count; ++i)
        require(hours.hours[i].provenance == CheckupCyclingSlot::Ordinary,
                "slot_overwrite_retires_expiry_marker");
}
void late_restore(bool clock_behind) {
    // Cross a wall-hour boundary during the new monotonic hour. A saved wall label can then
    // appear after the last live completed label without being in the future of the wall clock.
    const int64_t hour   = CHECKUP_DT_S;
    adapter::unix_origin = adapter::unix_origin / hour * hour + hour - 10;
    boot();
    const auto                     cov = coverage();
    const std::vector<CachedValue> rows{row(CHECKUP_LOC_VALVE, "1")};
    sample(3591, rows, cov);
    sample(3596, rows, cov, true, true);
    sample(3601, rows, cov, true, true);
    int64_t               live_bucket = INT64_MIN;
    CheckupJournalPayload live;
    require(checkup_flash_next(adapter::unix_origin + 3601, INT64_MIN, live_bucket, live) &&
                live.checkup.starts == 1 && live.checkup.dhw_runs == 0,
            "fixture_run_crosses_monotonic_hour");

    if (clock_behind) adapter::unix_origin -= hour;
    const int64_t last_sample = clock_behind ? 3606 : 3621;
    for (int64_t t = 3606; t <= last_sample; t += 5) sample(t, rows, cov, true, true);
    const int64_t now       = adapter::unix_origin + last_sample;
    const int64_t older_end = (clock_behind ? checkup_journal_bucket(now) : live_bucket) * hour - 1;
    CheckupFlashRecord saved[]{{checkup_journal_bucket(older_end), live}, {live_bucket + 1, live}};
    saved[0].payload.end_unix_s             = older_end;
    saved[0].payload.checkup.starts         = 2;
    saved[0].payload.checkup.rps_observed_s = 30;
    saved[1].payload.end_unix_s             = (live_bucket + 1) * hour + 1;
    saved[1].payload.checkup.starts         = 7;
    saved[1].payload.checkup.rps_observed_s = 30;
    const auto          restored            = checkup_flash_restore(saved, std::size(saved), now);
    CheckupCyclingHours hours;
    checkup_report(&hours);
    if (clock_behind) {
        require(restored == CheckupFlashRestoreResult::Ignored && hours.count == 2 &&
                    hours.hours[0].provenance == CheckupCyclingSlot::Ordinary &&
                    hours.hours[0].starts == 1,
                "late_restore_keeps_live_when_clock_cannot_date_tail");
        return;
    }
    require(restored == CheckupFlashRestoreResult::Restored && hours.count == 3 &&
                hours.hours[0].provenance == CheckupCyclingSlot::Restored &&
                hours.hours[0].starts == 2 &&
                hours.hours[1].provenance == CheckupCyclingSlot::Ordinary &&
                hours.hours[1].starts == 1,
            "late_restore_admits_only_older_prefix");

    sample(3626, rows, cov);
    int64_t               revised = INT64_MIN;
    CheckupJournalPayload replay;
    require(checkup_flash_next(adapter::unix_origin + 3626, live_bucket, revised, replay) &&
                revised == live_bucket && replay.checkup.starts == 1 &&
                replay.checkup.dhw_runs == 1,
            "late_restore_replays_completion_in_live_start_hour");
}
CheckupReport consent_reenabled_report;
uint32_t      consent_restore_generation = 25;
void          consent_off_on() {
    checkup_set_diagnostics(false, 24);
    checkup_set_diagnostics(true, consent_restore_generation);
    consent_reenabled_report = checkup_report();
}
void consent_staged_sample(const std::string& name) {
    const bool lock =
        name == "consent_lock_new_generation" || name == "consent_lock_same_generation";
    const bool sampling =
        name == "consent_sampling_new_generation" || name == "consent_sampling_same_generation";
    const bool caller =
        name == "consent_caller_new_generation" || name == "consent_caller_same_generation";
    require(lock || sampling || caller, "unknown_case");
    boot();
    auto cov    = coverage();
    auto normal = heater("0", "0", "0");
    normal.push_back(fault(0, 0));
    normal.push_back(fault(1, 0));
    normal.push_back(row(CHECKUP_LOC_PRESSURE, "1.5"));
    sample(1, normal, cov);
    sample(11, normal, cov);
    consent_restore_generation       = name.find("same_generation") != std::string::npos ? 23 : 25;
    const uint32_t source_generation = adapter::poll_generation;
    // Capture before the caller acquires its old endpoint, not when it finally submits the rows.
    const uint32_t consent_epoch = checkup_consent_epoch();
    auto           old           = heater("1", "0", "1");
    old.push_back(fault(0, 1));
    old.push_back(fault(1, 0));
    old.push_back(row(CHECKUP_LOC_PRESSURE, "0.9"));
    if (lock)
        sdk::before_take = consent_off_on;
    else if (sampling)
        adapter::on_circulation = consent_off_on;
    else
        consent_off_on();
    sdk::now_us = 21000000;
    checkup_record(old.data(), old.size(), true, false, cov, source_generation, consent_epoch,
                   true);
    const auto after = checkup_report();
    require(adapter::poll_generation == source_generation, "consent_does_not_change_x10a_epoch");
    require(checkup_consent_epoch() != consent_epoch, "consent_runtime_epoch_changed");
    require(!consent_reenabled_report.source_fresh && consent_reenabled_report.available == 0 &&
                consent_reenabled_report.pressure_current_tenths == -1,
            "consent_reenable_report_empty");
    require(!after.source_fresh && after.source_age_s == UINT32_MAX && after.available == 0 &&
                after.covered_s == 0 && after.pressure_current_tenths == -1 &&
                after[CheckupCheck::Pressure].a == -1 && after[CheckupCheck::Fault].a == -1 &&
                after[CheckupCheck::Fault].verdict == CheckupVerdict::Unavailable &&
                after[CheckupCheck::Heater].a == -1 && after[CheckupCheck::Heater].b == -1 &&
                after[CheckupCheck::Heater].c == -1 && after[CheckupCheck::Heater].d == -1,
            caller ? "consent_epoch_discards_already_collected_sample"
                   : "consent_epoch_discards_staged_sample");
    sample(31, normal, cov, true, false, true, source_generation);
    const auto first = checkup_report();
    require(first.source_fresh && first.source_age_s == 0 && first.covered_s == 0 &&
                first.pressure_current_tenths == 15 && first[CheckupCheck::Pressure].a == 15 &&
                first[CheckupCheck::Fault].verdict == CheckupVerdict::Ok &&
                first[CheckupCheck::Heater].c == 0 && first[CheckupCheck::Heater].d == 0,
            "first_new_consent_sample_starts_empty_clock");
    sample(41, normal, cov, true, false, true, source_generation);
    const auto pair = checkup_report();
    require(pair.source_fresh && pair.covered_s == 10 && pair[CheckupCheck::Pressure].a == 15 &&
                pair[CheckupCheck::Fault].verdict == CheckupVerdict::Ok &&
                pair[CheckupCheck::Heater].a == 0 && pair[CheckupCheck::Heater].b == 0 &&
                pair[CheckupCheck::Heater].c == 10 && pair[CheckupCheck::Heater].d == 10,
            "new_consent_positive_control");
}
std::vector<CachedValue> stop_rows(bool running, bool request = true, bool target = true) {
    std::vector<CachedValue> v = {
        row({0x30, 0, 152}, running ? "12" : "0"),
        row({0x61, 2, 105}, "39.7"),
        row({0x60, 2, 303}, request ? "1" : "0"),
        row(CHECKUP_LOC_DEFROST, "0"),
        row(CHECKUP_LOC_VALVE, "0"),
        row(CHECKUP_LOC_IU_MODE, "Heating"),
    };
    if (target) v.push_back(row({0x60, 9, 105}, "35.7"));
    return v;
}

void defrost_start_case() {
    boot();
    const auto read_start = [](DiagnosticsSource src = DiagnosticsSource::X10a) {
        DefrostStartReport report;
        checkup_report(nullptr, nullptr, nullptr, src, &report);
        return report;
    };
    const auto cov = coverage();
    auto       off = stop_rows(true);
    off.push_back(row(CHECKUP_LOC_OUTDOOR, "8"));
    auto on         = off;
    on[3].value     = "1";
    on.back().value = "0";
    sample(1, off, cov, true, true);
    sample(2, on, cov, true, true);
    const auto start = read_start();
    require(start.observed_us == 2000000 && start.route == DefrostStartRoute::SpaceHeating &&
                start.outdoor_tenths == 0,
            "defrost_start_uses_fresh_zero");
    require(read_start(DiagnosticsSource::Modbus).observed_us < 0,
            "defrost_start_modbus_stays_empty");

    // Same-generation pause hides the field while disabled, keeps <24 h evidence on resume,
    // and refuses to bridge an OFF->ON transition across the paused interval.
    sample(3, off, cov, true, true);
    checkup_set_diagnostics(false, 23);
    require(read_start().observed_us < 0, "defrost_start_hidden_while_paused");
    checkup_set_diagnostics(true, 23);
    require(read_start().observed_us == 2000000, "defrost_start_preserved_across_same_gen_pause");
    sample(4, on, cov, true, true);
    require(read_start().observed_us == 2000000, "defrost_start_pause_breaks_edge_bridge");

    sample(5, off, cov, true, true);
    on.back().held_unknown = true;
    sample(6, on, cov, true, true);
    const auto held = read_start();
    require(held.observed_us == 6000000 && held.outdoor_tenths == CHECKUP_ABSENT,
            "defrost_start_withholds_held_outdoor");
    ++adapter::poll_generation;
    require(read_start().observed_us < 0, "defrost_start_hidden_before_new_source_poll");
    sample(7, on, cov, true, true, true, adapter::poll_generation);
    require(read_start().observed_us < 0, "defrost_start_does_not_cross_source_generation");

    sample(8, off, cov, true, true, true, adapter::poll_generation);
    auto unreadable = off;
    unreadable.erase(unreadable.begin() + 3);
    // A stop-only read fence arrives after this poll captured its time, before it held Checkup.
    sdk::before_take = [] { s_stop_read_fence_us = 9500000; };
    sample(9, unreadable, cov, true, true, true, adapter::poll_generation);
    sample(10, on, cov, true, true, true, adapter::poll_generation);
    require(read_start().observed_us < 0,
            "defrost_start_sees_unreadable_sample_during_stop_read_fence");
}

void stop_context_case(const std::string& name) {
    if (name == "stop_unstarted_report_pending") {
        require(checkup_stop_context_report().observation.restore_pending,
                "stop_unstarted_still_reports_restore_pending");
        require(sdk::mutex_count == 0 && sdk::takes == 0,
                "stop_early_read_does_not_allocate_or_lock");
        return;
    }
    if (name == "stop_forget_before_checkup_start" || name == "stop_forget_checkup_alloc_failure") {
        stop_observation_forget();
        if (name == "stop_forget_checkup_alloc_failure") {
            sdk::fail_create_once = true;
            boot();
            require(s_mtx == nullptr, "stop_checkup_allocation_failure_exercised");
        }
        const auto r = checkup_stop_context_report();
        require(!r.observation.restore_pending && !r.observation.persistence_pending &&
                    !r.pending && !r.observation.confirmed && !r.capability_mask,
                "stop_forget_no_mutex_reports_no_restore");
        require(sdk::mutex_count == 0 && sdk::takes == 0,
                "stop_early_read_does_not_allocate_or_lock");
        return;
    }
    require(name == "stop_overlap" || name == "stop_optional" || name == "stop_route" ||
                name == "stop_idle_expiry" || name == "stop_reset" || name == "stop_consent" ||
                name == "stop_shutdown" || name == "stop_tick_wait" ||
                name == "stop_forget_before_start" || name == "stop_forget_pending" ||
                name == "stop_forget_report_lock" || name == "stop_forget_record_lock" ||
                name == "stop_forget_expiry" || name == "stop_forget_shutdown" ||
                name == "stop_forget_during_report" || name == "stop_forget_report_lock_failure",
            "unknown_case");
    if (name == "stop_forget_before_start") stop_observation_forget();
    boot();
    const auto cov    = coverage();
    const bool target = name != "stop_optional";
    sample(1, stop_rows(false, true, target), cov, true, false);
    for (int t = 2; t < 41; ++t) {
        auto v = stop_rows(true, true, target);
        if (name == "stop_route" && t >= 39) {
            v[4].value = "1";
            v[5].value = "DHW";
        }
        sample(t, v, cov, true, true);
    }
    auto stopped = stop_rows(false, false, target);
    if (name == "stop_route") {
        stopped[4].value = "1";
        stopped[5].value = "DHW";
    }
    sample(41, stopped, cov, true, false);
    if (name == "stop_forget_before_start") {
        require(s_stop_context.last_sample_us == -1, "stop_forget_skips_private_producer");
        const auto r = checkup_stop_context_report();
        require(!r.pending && r.capability_mask == 0 && !r.observation.confirmed &&
                    !r.observation.restore_pending && !r.observation.persistence_pending &&
                    r.observation.readable_us == 0 &&
                    r.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_early_forget_blocks_late_checkup_start");
        return;
    }
    const auto pending = checkup_stop_context_report();
    require(pending.pending && pending.capability_mask == STOP_CONTEXT_ALL,
            "stop_source_bound_pending");
    require(pending.observation.counters.witnessed_stops_recent_heating == 0,
            "stop_pending_not_a_final_count");
    if (name.rfind("stop_forget_", 0) == 0) {
        if (name == "stop_forget_report_lock")
            sdk::before_take = [] { stop_observation_forget(); };
        else if (name == "stop_forget_report_lock_failure") {
            sdk::before_take = [] {
                stop_observation_forget();
                sdk::fail_take_once = true;
            };
        } else if (name == "stop_forget_during_report")
            adapter::on_time = [] { stop_observation_forget(); };
        else if (name == "stop_forget_record_lock") {
            sdk::before_take = [] { stop_observation_forget(); };
            sample(42, stopped, cov, true, false);
        } else {
            stop_observation_forget();
        }
        if (name == "stop_forget_expiry") {
            // Before ordinary gap/window expiry: time alone must not clear this witness.
            sdk::now_us = 42000000;
            checkup_stop_context_expire(sdk::now_us);
        } else if (name == "stop_forget_shutdown") {
            require(sdk::shutdown != nullptr, "stop_shutdown_hook_registered");
            sdk::shutdown();
        }
        if (name == "stop_forget_record_lock" || name == "stop_forget_expiry" ||
            name == "stop_forget_shutdown")
            require(!s_stop_context.pending.valid && s_stop_context.last_sample_us == -1,
                    "stop_forget_retires_private_producer");
        const auto r = checkup_stop_context_report();
        require(!r.pending && r.capability_mask == 0 && !r.observation.confirmed &&
                    !r.observation.restore_pending && !r.observation.persistence_pending &&
                    r.observation.readable_us == 0 &&
                    r.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_forget_hides_pending_producer_state");
        if (name != "stop_forget_expiry" && name != "stop_forget_shutdown") {
            checkup_set_diagnostics(false, 24);
            checkup_set_diagnostics(true, 25);
            checkup_reset_on_detect("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", 0x12345678);
            for (int t = 42; t <= 80; ++t) sample(t, stop_rows(true, true), cov, true, true);
            sample(81, stopped, cov, true, false);
            require(s_stop_context.last_sample_us == -1, "stop_forget_skips_private_producer");
        }
        const auto after = checkup_stop_context_report();
        require(!after.pending && after.capability_mask == 0 && !after.observation.confirmed &&
                    !after.observation.restore_pending && !after.observation.persistence_pending &&
                    after.observation.readable_us == 0 &&
                    after.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_forget_survives_later_lifecycle_calls");
        return;
    }
    if (name == "stop_reset") {
        checkup_reset();
        const auto r = checkup_stop_context_report();
        require(!r.pending && !r.observation.confirmed &&
                    r.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_reset_immediate_read_barrier");
        require(r.observation.persistence_pending, "stop_reset_durability_remains_pending");
        return;
    }
    if (name == "stop_consent") {
        const auto old_epoch = checkup_consent_epoch();
        checkup_set_diagnostics(false, 23);
        checkup_set_diagnostics(true, 23);
        sdk::now_us = 42000000;
        checkup_record(stopped.data(), stopped.size(), true, false, cov, adapter::poll_generation,
                       old_epoch, true);
        const auto paused = checkup_stop_context_report();
        require(!paused.pending && paused.observation.readable_us == 40000000 &&
                    paused.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_consent_rejects_staged_inputs");
        checkup_set_diagnostics(false, 24);
        checkup_set_diagnostics(true, 24);
        const auto r = checkup_stop_context_report();
        require(!r.pending && r.observation.readable_us == 0 &&
                    r.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_new_consent_retires_prior_observation");
        return;
    }
    if (name == "stop_tick_wait") {
        sdk::now_us      = 42000000;
        sdk::before_take = [] { sdk::now_us = 57000000; };
        checkup_stop_context_expire(42000000);
        require(stop_observation_report().counters.witnessed_stops_recent_heating == 1,
                "stop_tick_flushes_before_journal_service");
        require(!checkup_stop_context_report().pending, "stop_tick_uses_clock_after_owner_lock");
    } else if (name == "stop_idle_expiry") {
        sdk::now_us = 57000000;
        checkup_stop_context_expire(sdk::now_us);
    } else if (name == "stop_shutdown") {
        require(sdk::shutdown != nullptr, "stop_shutdown_hook_registered");
        sdk::shutdown();
    } else {
        for (int t = 42; t <= 71; ++t) sample(t, stopped, cov, true, false);
    }
    const auto  r = checkup_stop_context_report();
    const auto& c = r.observation.counters;
    require(!r.pending && c.witnessed_stops_recent_heating == 1,
            "stop_finalized_once_in_named_population");
    require(c.positive[1] == 1, "stop_request_overlap_observed");
    require(c.positive[0] == (target ? 1 : 0), "stop_target_only_dependent_category");
    if (name == "stop_idle_expiry" || name == "stop_shutdown" || name == "stop_tick_wait") {
        require(c.censored == 1 && c.partial == 1 && c.complete[1] == 0,
                "stop_stalled_or_shutdown_window_censored");
    } else if (name == "stop_route") {
        require(c.positive[3] == 1 && c.positive[4] == 1, "stop_route_transition_overlap");
        const auto core = checkup_report();
        require(core[CheckupCheck::Cycling].c == 0 && core[CheckupCheck::Cycling].g == 1 &&
                    core.cycling_censored_handover_runs == 1,
                "stop_mixed_run_does_not_enter_completed_heating");
    } else {
        require(c.complete[1] == 1 && c.censored == 0, "stop_complete_window_readable");
        if (!target)
            require(c.evaluable[0] == 0 && c.unknown == 1, "stop_optional_input_independent");
        const auto core = checkup_report();
        require(core[CheckupCheck::Cycling].c == 1, "stop_legacy_completed_heating_preserved");
    }
    sdk::now_us += 1;
    require(checkup_stop_context_report().observation.counters.witnessed_stops_recent_heating == 1,
            "stop_repeat_report_does_not_duplicate");
}
CachedValue mb_row(uint8_t offset, const char* value) {
    CachedValue v;
    v.reg   = def::HOMEHUB_GROUP_REG;
    v.off   = offset;
    v.value = value;
    return v;
}
void dhw_trace_case(const std::string& name) {
    require(name == "dhw_trace_capture" || name == "dhw_trace_pause" ||
                name == "dhw_trace_source_reset" || name == "dhw_trace_circulation_reset" ||
                name == "dhw_trace_forget" || name == "dhw_trace_forget_before_start" ||
                name == "dhw_trace_forget_during_snapshot" ||
                name == "dhw_trace_reset_during_snapshot" || name == "dhw_trace_unavailable" ||
                name == "dhw_trace_restore_forward" || name == "dhw_trace_restore_backward" ||
                name == "dhw_trace_checkpoint_clock_step",
            "unknown_case");
    auto take = [](DiagnosticsSource source, DhwLossTimeline& out) {
        return checkup_report(nullptr, nullptr, nullptr, source, nullptr, &out);
    };
    DhwLossTimeline x, m;
    if (name == "dhw_trace_unavailable") {
        x.epoch = 99;
        x.count = 24;
        take(DiagnosticsSource::X10a, x);
        require(!x.epoch && !x.count, "dhw_trace_absent_mutex_clears_output");
    }
    if (name == "dhw_trace_forget_before_start") checkup_dhw_trace_forget();
    boot();
    checkup_modbus_confirm_source(ModbusProfile::HomeHub, 0x11223344U);
    const auto cov  = coverage();
    auto       rows = heater("1", "0", "0");
    rows.push_back(row(CHECKUP_LOC_PUMP, "0"));
    rows.push_back(row(CHECKUP_LOC_VALVE, "0"));
    rows.push_back(row(CHECKUP_LOC_R5T, "50.0"));
    const std::vector<CachedValue> mb_rows{mb_row(30, "1"), mb_row(31, "0"), mb_row(32, "0"),
                                           mb_row(37, "0"), mb_row(43, "48.0")};
    auto                           mb_sample = [&](int64_t at_s) {
        sdk::now_us = at_s * 1000000;
        checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                                                        adapter::mb_target_generation, checkup_consent_epoch(), true);
    };
    for (int64_t sec = 1; sec <= 7201; sec += 10) {
        sample(sec, rows, cov);
        mb_sample(sec);
    }
    const auto before = take(DiagnosticsSource::X10a, x);
    take(DiagnosticsSource::Modbus, m);
    if (name == "dhw_trace_forget_before_start") {
        require(!x.epoch && !m.epoch && !s_x10a.dhw_trace.begun && !s_modbus.dhw_trace.begun,
                "dhw_trace_forget_before_start_suppresses_both_producers");
        return;
    }
    require(x.epoch && m.epoch && x.count == 1 && m.count == 1,
            "dhw_trace_both_real_source_windows");
    require(x.windows[0].rate_tenths == 0 && !x.windows[0].pump_marker &&
                m.windows[0].pump_marker && !x.windows[0].draw_marker,
            "dhw_trace_context_is_source_specific");
    require(before[CheckupCheck::DhwLoss].b == 1 && before[CheckupCheck::Heater].a > 6000,
            "dhw_trace_does_not_change_aggregate_or_core");
    const uint32_t xepoch = x.epoch, mepoch = m.epoch;
    if (name == "dhw_trace_capture") {
        require(x.live && x.observed && x.observed_end_s == 7201 && x.since_s == 1 &&
                    x.windows[0].end_s - x.windows[0].start_s == 3600,
                "dhw_trace_exact_window_and_collection_scope");
        adapter::clock_synced = false;
        take(DiagnosticsSource::X10a, x);
        require(x.epoch == xepoch && x.count == 1 && !x.unix_s,
                "dhw_trace_unsynced_clock_keeps_uptime_detail");
        adapter::clock_synced = true;
        for (int step : {86400, -86400}) {
            adapter::unix_origin += step;
            take(DiagnosticsSource::X10a, x);
            require(x.count == 1 && x.unix_s == adapter::unix_origin + 7201,
                    "dhw_trace_wall_steps_do_not_retime_or_expire_records");
        }
        sdk::now_us += 200000;
        adapter::on_time = [] { sdk::now_us += 250000; };
        take(DiagnosticsSource::X10a, x);
        require(x.window_end_s == 7201 && x.unix_s == adapter::unix_origin + 7201,
                "dhw_trace_agreeing_clock_bracket_keeps_wall_label");
        adapter::on_time = [] { sdk::now_us += 5000000; };
        take(DiagnosticsSource::X10a, x);
        require(x.window_end_s == 7201 && x.count == 1 && !x.unix_s,
                "dhw_trace_ambiguous_clock_bracket_keeps_relative_window");
        sdk::before_take = [] { sdk::now_us += 20000000; };
        take(DiagnosticsSource::X10a, x);
        require(x.window_end_s == 7226 && !x.live && x.observed_end_s == 7201,
                "dhw_trace_snapshot_clock_is_read_after_lock");
        sdk::now_us = (static_cast<int64_t>(x.windows[0].end_s) + 86400) * 1000000;
        take(DiagnosticsSource::X10a, x);
        require(x.epoch == xepoch && !x.count && !x.live,
                "dhw_trace_stopped_producer_expires_at_exact_cutoff");
    } else if (name == "dhw_trace_checkpoint_clock_step") {
        constexpr auto   source = DiagnosticsSource::X10a;
        DhwLossTracePage checkpoint{};
        uint32_t         token = 0;
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) && checkpoint.count == 1,
                "fresh_tank_checkpoint_carries_completed_window");
        checkup_dhw_trace_checkpoint_appended(token, source);
        const auto prior_unix_s = checkpoint.unix_s;
        adapter::unix_origin += 120;
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) &&
                    dhw_loss_trace_page_valid(checkpoint, true),
                "fresh_tank_checkpoint_clock_step_commits_barrier");
        checkup_dhw_trace_checkpoint_appended(token, source);
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) &&
                    checkpoint.count == 1 && checkpoint.unix_s == prior_unix_s + 120,
                "fresh_tank_checkpoint_is_redated_without_new_completion");
        checkup_dhw_trace_checkpoint_appended(token, source);
        sdk::now_us += int64_t{CHECKUP_WINDOW_S} * 1000000;
        take(source, x);
        require(!x.count, "tank_checkpoint_window_has_expired_in_ram");
        adapter::unix_origin -= 120;
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) &&
                    dhw_loss_trace_page_valid(checkpoint, true),
                "expired_tank_checkpoint_clock_step_commits_barrier");
    } else if (name == "dhw_trace_restore_forward" || name == "dhw_trace_restore_backward") {
        constexpr auto source = DiagnosticsSource::X10a;
        using Result          = CheckupFlashRestoreResult;
        DhwLossTracePage saved{};
        saved.model_fp               = s_x10a.model_fp;
        saved.source_fp              = s_x10a.source_fp;
        saved.dhw_source_fp          = s_x10a.dhw_source_fp;
        saved.diagnostics_generation = 23;
        saved.unix_s                 = static_cast<uint32_t>(adapter::unix_origin - 30);
        saved.count                  = 1;
        require(dhw_loss_trace_pack(saved.records[0], {1, 3601, 21, 3591, true, true}, 3601),
                "dhw_restore_exact_record_encodes");
        require(checkup_dhw_trace_restore(saved, 0, DiagnosticsSource::Modbus) == Result::Ignored,
                "dhw_restore_other_bus_rejected");
        adapter::clock_synced = false;
        require(checkup_dhw_trace_restore(saved, 0, source) == Result::Deferred,
                "dhw_restore_waits_for_clock");
        adapter::clock_synced = true;
        require(checkup_dhw_trace_restore(saved, 0, source) == Result::Restored,
                "dhw_restore_admits_matching_scope");
        take(source, x);
        require(x.count == 2 && x.unix_s - (x.window_end_s - x.windows[0].end_s) == saved.unix_s &&
                    x.windows[0].observed_s == 3591 && x.windows[0].pump_marker &&
                    x.windows[0].draw_marker && x.observed_end_s == x.window_end_s && x.live,
                "dhw_restore_preserves_window_and_current_freshness");
        DhwLossTracePage checkpoint{};
        uint32_t         token = 0;
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) && token &&
                    checkpoint.count == 2,
                "dhw_checkpoint_includes_valid_restored_prefix");
        const bool step_during_append = name == "dhw_trace_restore_forward";
        if (!step_during_append) checkup_dhw_trace_checkpoint_appended(token, source);
        adapter::unix_origin += step_during_append ? 120 : -120;
        take(source, x);
        require(x.count == 1 && x.windows[0].rate_tenths == 0 && x.live,
                "dhw_clock_step_only_withdraws_restored_prefix");
        if (step_during_append) checkup_dhw_trace_checkpoint_appended(token, source);
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) && token &&
                    dhw_loss_trace_page_valid(checkpoint, true),
                "dhw_clock_step_commits_barrier_before_recheckpoint");
        checkup_dhw_trace_checkpoint_appended(token, source);
        require(checkup_dhw_trace_checkpoint(checkpoint, token, 0, source) && checkpoint.count == 1,
                "dhw_clock_step_recheckpoints_live_only");
        DhwLossTrace rebooted;
        require(dhw_loss_trace_restore(rebooted, checkpoint, 1, checkpoint.unix_s + 30) &&
                    rebooted.snapshot(x, 1000000, CHECKUP_MAX_GAP_S) && x.count == 1 && !x.live,
                "dhw_second_boot_does_not_restore_withdrawn_window");
    } else if (name == "dhw_trace_pause") {
        checkup_set_diagnostics(false, 23);
        take(DiagnosticsSource::X10a, x);
        require(!x.epoch && !x.count && s_x10a.dhw_trace.count == 1,
                "dhw_trace_same_generation_pause_hides_without_erasing");
        checkup_set_diagnostics(true, 23);
        take(DiagnosticsSource::X10a, x);
        require(x.epoch == xepoch && x.count == 1 && !x.live,
                "dhw_trace_same_generation_resume_preserves_completed_only");
        for (int64_t sec = 7211; sec <= 10811; sec += 10) sample(sec, rows, cov);
        take(DiagnosticsSource::X10a, x);
        require(x.count == 1, "dhw_trace_pause_does_not_bridge_unfinished_candidate");
        checkup_set_diagnostics(true, 24);
        take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        require(!x.epoch && !m.epoch && !s_x10a.dhw_trace.count && !s_modbus.dhw_trace.count,
                "dhw_trace_new_consent_generation_clears_both_sources");
        sample(10821, rows, cov);
        take(DiagnosticsSource::X10a, x);
        require(x.epoch != xepoch && x.since_s == 10821 && !x.count,
                "dhw_trace_new_generation_begins_its_own_epoch");
    } else if (name == "dhw_trace_source_reset") {
        checkup_modbus_reset();
        take(DiagnosticsSource::Modbus, m);
        take(DiagnosticsSource::X10a, x);
        require(!m.epoch && x.epoch == xepoch && x.count == 1,
                "dhw_trace_modbus_reset_preserves_x10a_completion");
        checkup_modbus_confirm_source(ModbusProfile::HomeHub, 0x22334455U);
        mb_sample(7211); // reset-consuming old/new boundary is deliberately discarded
        take(DiagnosticsSource::Modbus, m);
        require(!m.epoch, "dhw_trace_full_reset_discards_consuming_sample");
        mb_sample(7221);
        take(DiagnosticsSource::Modbus, m);
        require(m.epoch && m.epoch != mepoch && !m.count && m.since_s == 7221,
                "dhw_trace_source_reconfirmation_starts_fresh_detail");
        checkup_reset();
        take(DiagnosticsSource::X10a, x);
        DhwLossTimeline independent;
        take(DiagnosticsSource::Modbus, independent);
        require(!x.epoch && independent.epoch == m.epoch && independent.since_s == m.since_s,
                "dhw_trace_x10a_reset_preserves_modbus_epoch");
    } else if (name == "dhw_trace_circulation_reset") {
        checkup_dhw_reset();
        const auto pending = take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        require(!x.epoch && !m.epoch && pending[CheckupCheck::DhwLoss].b == 0 &&
                    pending[CheckupCheck::Heater].a == before[CheckupCheck::Heater].a,
                "dhw_trace_circulation_reset_hides_both_traces_only");
        sample(7211, rows, cov);
        mb_sample(7211);
        take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        require(!x.epoch && !m.epoch, "dhw_trace_dhw_reset_discards_consuming_sample");
        sample(7221, rows, cov);
        mb_sample(7221);
        take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        require(x.epoch && m.epoch && x.epoch != xepoch && m.epoch != mepoch && !x.count &&
                    !m.count && x.since_s == 7221 && m.since_s == 7221,
                "dhw_trace_circulation_reset_restarts_independent_epochs");
        // Fill a complete day after the first DHW-only reset, while the core clocks keep running.
        constexpr int64_t full_scope_s = 7211 + CHECKUP_WINDOW_S + 30;
        for (int64_t sec = 7231; sec <= full_scope_s; sec += 10) {
            sample(sec, rows, cov);
            mb_sample(sec);
        }
        const auto x_full = take(DiagnosticsSource::X10a, x);
        const auto m_full = take(DiagnosticsSource::Modbus, m);
        require(x_full.full_span && m_full.full_span && x.count && m.count &&
                    x_full.dhw_candidate_s > 0 && m_full.dhw_candidate_s > 0,
                "dhw_trace_fixture_has_full_prior_scope_and_active_candidates");
        checkup_dhw_reset();
        const auto x_pending = take(DiagnosticsSource::X10a, x);
        const auto m_pending = take(DiagnosticsSource::Modbus, m);
        for (const auto* report : {&x_pending, &m_pending}) {
            const auto& dhw = (*report)[CheckupCheck::DhwLoss];
            require(report->full_span && report->source_fresh && !report->dhw_blocked &&
                        dhw.verdict == CheckupVerdict::Collecting && dhw.b == 0 &&
                        !report->dhw_candidate_s && !report->dhw_settle_remaining_s,
                    "dhw_pending_reset_collects_despite_full_old_scope");
        }
        require(!x.epoch && !m.epoch &&
                    x_pending[CheckupCheck::Heater].a == x_full[CheckupCheck::Heater].a &&
                    s_x10a.dhw_reset_requested.load() && s_modbus.dhw_reset_requested.load(),
                "dhw_pending_reset_hides_detail_without_consuming_reset_or_retiring_core");
        sample(full_scope_s + 10, rows, cov);
        mb_sample(full_scope_s + 10);
        const auto x_reset = take(DiagnosticsSource::X10a, x);
        const auto m_reset = take(DiagnosticsSource::Modbus, m);
        require(!x.epoch && !m.epoch && !x_reset.dhw_blocked && !m_reset.dhw_blocked &&
                    x_reset[CheckupCheck::DhwLoss].verdict == CheckupVerdict::Collecting &&
                    m_reset[CheckupCheck::DhwLoss].verdict == CheckupVerdict::Collecting,
                "dhw_consumed_reset_starts_new_scope_despite_full_core");
    } else if (name == "dhw_trace_forget_during_snapshot" ||
               name == "dhw_trace_reset_during_snapshot") {
        adapter::on_time  = name == "dhw_trace_forget_during_snapshot"
                                ? +[] { checkup_dhw_trace_forget(); }
                                : +[] { checkup_dhw_reset(); };
        const auto during = take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        if (name == "dhw_trace_reset_during_snapshot") {
            require(during[CheckupCheck::DhwLoss].b == 0 &&
                        during[CheckupCheck::DhwLoss].observed_s == 0 && !during.dhw_candidate_s &&
                        !during.dhw_settle_remaining_s &&
                        during[CheckupCheck::Heater].a == before[CheckupCheck::Heater].a,
                    "dhw_reset_during_clock_read_retires_aggregate_and_progress");
        }
        require(!x.epoch && !m.epoch && !x.count && !m.count,
                "dhw_trace_withdrawal_during_clock_read_clears_captured_output");
    } else if (name == "dhw_trace_forget") {
        checkup_dhw_trace_forget();
        const int64_t prior_end = s_x10a.dhw_trace.last_us;
        sample(7211, rows, cov);
        mb_sample(7211);
        take(DiagnosticsSource::X10a, x);
        take(DiagnosticsSource::Modbus, m);
        require(!x.epoch && !m.epoch && s_x10a.dhw_trace.last_us == prior_end &&
                    s_modbus.dhw_trace.last_us == prior_end,
                "dhw_trace_forget_immediately_suppresses_producer_and_report");
    } else {
        sdk::fail_take_once = true;
        take(DiagnosticsSource::X10a, x);
        require(!x.epoch && !x.count, "dhw_trace_lock_failure_clears_prior_output");
        auto unsupported = cov;
        unsupported.r5t  = false;
        sample(7211, rows, unsupported);
        take(DiagnosticsSource::X10a, x);
        require(!x.epoch && !x.count, "dhw_trace_unsupported_profile_withholds_detail");
    }
}

void modbus_dual_source() {
    boot();
    require(s_x10a.persist_magic == CHECKUP_PERSIST_MAGIC &&
                s_modbus.persist_magic == CHECKUP_MODBUS_PERSIST_MAGIC,
            "independent_persist_magics_configured");
    checkup_modbus_confirm_source(ModbusProfile::HomeHub, 0x11223344U);

    const auto xcov  = coverage();
    const auto xrows = heater("1", "0", "0");
    sample(10, xrows, xcov, true, false);
    sample(20, xrows, xcov, true, false);
    sample(30, xrows, xcov, true, false);

    const std::vector<CachedValue> mb_rows{
        mb_row(21, "1"), mb_row(30, "1"),    mb_row(31, "1"),   mb_row(32, "1"),    mb_row(37, "1"),
        mb_row(38, "1"), mb_row(43, "48.0"), mb_row(44, "5.0"), mb_row(49, "12.0"),
    };
    const uint32_t epoch = checkup_consent_epoch();
    sdk::now_us          = 100000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, epoch, true);
    sdk::now_us = 110000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, epoch, true);
    sdk::now_us = 120000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation + 1, epoch, true);

    require(checkup_has_data(DiagnosticsSource::X10a) &&
                checkup_has_data(DiagnosticsSource::Modbus),
            "dual_source_slots_accumulate_independently");
    const auto xrep = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::X10a);
    const auto mrep = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(xrep.covered_s == 20 && xrep[CheckupCheck::Fault].verdict != CheckupVerdict::Warn,
            "x10a_slot_keeps_its_own_window");
    require(mrep.covered_s == 10 && mrep[CheckupCheck::Fault].verdict == CheckupVerdict::Warn &&
                mrep[CheckupCheck::Pressure].verdict == CheckupVerdict::Unavailable,
            "modbus_slot_accumulates_without_stale_generation");

    checkup_modbus_reset();
    require(!checkup_has_data(DiagnosticsSource::Modbus) &&
                checkup_has_data(DiagnosticsSource::X10a),
            "modbus_reset_preserves_x10a_slot");
    const auto mreset = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    const auto xafter = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::X10a);
    require(mreset.covered_s == 0 && xafter.covered_s == 20,
            "modbus_reset_report_stays_empty_while_x10a_remains");

    checkup_modbus_confirm_source(ModbusProfile::HomeHub, 0x11223344U);
    sdk::now_us = 130000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, epoch, true);
    require(!checkup_has_data(DiagnosticsSource::Modbus),
            "first_modbus_sample_consumes_reset_barrier");
    sdk::now_us = 140000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, epoch, true);
    sdk::now_us = 150000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, epoch, true);
    require(checkup_has_data(DiagnosticsSource::Modbus) &&
                checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus).covered_s ==
                    10,
            "modbus_resumes_after_reset");

    checkup_set_diagnostics(false, 23);
    CheckupRestore paused_persist = CheckupRestore::Fresh;
    const auto xpaused = checkup_report(nullptr, nullptr, &paused_persist, DiagnosticsSource::X10a);
    const auto mpaused = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(checkup_consent_epoch() != epoch &&
                paused_persist == CheckupRestore::DiagnosticsDisabled && xpaused.covered_s == 0 &&
                mpaused.covered_s == 0 && checkup_has_data(DiagnosticsSource::X10a) &&
                checkup_has_data(DiagnosticsSource::Modbus),
            "pausing_diagnostics_hides_reports_while_preserving_both_slots");
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, checkup_consent_epoch(), true);

    checkup_set_diagnostics(true, 23);
    const auto xresumed = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::X10a);
    const auto mresumed = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(xresumed.covered_s == 20 && !xresumed.source_fresh && mresumed.covered_s == 10 &&
                !mresumed.source_fresh,
            "resuming_same_generation_keeps_both_sources_without_stale_freshness");

    const uint32_t resumed_epoch = checkup_consent_epoch();
    sample(60, xrows, xcov, true, false);
    sample(70, xrows, xcov, true, false);
    sdk::now_us = 180000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, resumed_epoch, true);
    sdk::now_us = 190000000;
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, resumed_epoch, true);
    require(checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::X10a).covered_s == 30 &&
                checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus).covered_s ==
                    20,
            "resuming_does_not_bridge_paused_seconds");

    checkup_set_diagnostics(false, 23);
    sdk::now_us +=
        (static_cast<int64_t>(logic::CHECKUP_WINDOW_S) + logic::CHECKUP_DT_S + 60LL) * 1000000LL;
    checkup_set_diagnostics(true, 23);
    require(!checkup_has_data(DiagnosticsSource::X10a) &&
                !checkup_has_data(DiagnosticsSource::Modbus) &&
                checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::X10a).covered_s == 0 &&
                checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus).covered_s == 0,
            "paused_pending_buckets_expire_while_offline");

    checkup_set_diagnostics(false, 24);
    require(checkup_consent_epoch() != resumed_epoch &&
                !checkup_has_data(DiagnosticsSource::X10a) &&
                !checkup_has_data(DiagnosticsSource::Modbus),
            "new_generation_clears_both_sources_and_advances_epoch");
}

void x10a_modbus_fault_trace_lifecycle() {
    const char*                profile = "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw";
    const uint32_t             wall    = static_cast<uint32_t>(adapter::unix_origin + 1);
    const CyclingTraceIdentity x10a_id{
        checkup_model_fingerprint(profile, def::lookup_view(profile)), 0x12345678, 23};

    CheckupFaultTrace saved;
    saved.unix_s       = wall - 900;
    saved.window_end_s = CHECKUP_FAULT_WINDOW_S;
    saved.end_s        = 86390;
    saved.push(86000, {FaultTraceKind::Normal});
    saved.push(86010, {FaultTraceKind::Error, FaultUnitOrigin::Outdoor, fault_code_pack("U4"), 0});
    saved.push(86040, {FaultTraceKind::Normal});

    boot();
    auto cov = coverage();
    require(checkup_fault_restore(saved, x10a_id, wall, 0) == CheckupFlashRestoreResult::Restored,
            "fault_flash_restored_after_confirm");
    sample(2, {fault(0, 0), fault(1, 0)}, cov);
    const auto rep_restored = checkup_report();
    require(rep_restored[CheckupCheck::Fault].verdict == CheckupVerdict::Info,
            "restored_fault_raises_checkup_info");

    const auto code_row = [](uint8_t reg, uint8_t off, const char* txt) {
        CachedValue v;
        v.reg   = reg;
        v.off   = off;
        v.conv  = 204;
        v.label = "Error Code";
        v.value = txt;
        return v;
    };
    const std::vector<CachedValue> both_active{
        fault(0, 1),
        code_row(0x10, 5, "U4: Comm error"),
        fault(1, 2),
        code_row(0x60, 3, "7H"),
    };
    sample(10, both_active, cov);
    sample(25, {fault(0, 0), fault(1, 0)}, cov);

    CheckupFaultTrace trace_snap;
    require(checkup_fault_timeline_snapshot(trace_snap), "fault_timeline_snapshot_present");
    const auto latest = checkup_fault_latest_extract(trace_snap, true);
    require(latest.present && !latest.ongoing && latest.code == fault_code_pack("U4") &&
                latest.unit == FaultUnitOrigin::Outdoor && latest.duration_s == 15,
            "x10a_primary_outdoor_latest_extracted");
    FaultTraceKind sec_k = FaultTraceKind::Gap;
    uint16_t       sec_c = 0;
    require(fault_aux_get_secondary(latest.aux, sec_k, sec_c) && sec_k == FaultTraceKind::Warning &&
                sec_c == fault_code_pack("7H"),
            "x10a_secondary_indoor_encoded");

    const uint32_t mb_src = 0x55AA1234u;
    const uint32_t mb_ep  = checkup_consent_epoch();
    checkup_modbus_confirm_source(ModbusProfile::HomeHub, mb_src);
    const auto mb_val = [](uint8_t off, const char* txt) {
        CachedValue v;
        v.reg   = def::HOMEHUB_GROUP_REG;
        v.off   = off;
        v.value = txt;
        return v;
    };
    sdk::now_us = 30'000'000;
    const std::vector<CachedValue> mb_rows{mb_val(21, "1"), mb_val(22, "7H"), mb_val(23, "2")};
    checkup_record_modbus(mb_rows.data(), mb_rows.size(), ModbusProfile::HomeHub,
                          adapter::mb_target_generation, mb_ep, true);
    const auto mb_st = checkup_fault_latest_status(DiagnosticsSource::Modbus, true);
    require(mb_st.diagnostics_enabled && mb_st.latest.present && mb_st.latest.ongoing &&
                mb_st.latest.code == fault_code_pack("7H") &&
                fault_aux_get_subcode(mb_st.latest.aux) == 2,
            "modbus_fault_subcode_tracked_independently");

    checkup_reset();
    CyclingTraceIdentity bar_id{};
    uint32_t             bar_tok = 0;
    require(checkup_fault_checkpoint(trace_snap, bar_id, bar_tok, 0, false, false) && bar_tok &&
                !trace_snap.count && !bar_id.model_fp,
            "fault_reset_emits_barrier");
    checkup_fault_checkpoint_appended(bar_tok);
    require(!checkup_fault_checkpoint(trace_snap, bar_id, bar_tok, 0, false, false),
            "fault_barrier_acked");
    checkup_fault_forget();
    require(!checkup_fault_timeline_snapshot(trace_snap), "fault_forget_withholds_timeline");
}

void modbus_flow_scale_gate() {
    boot();
    checkup_modbus_confirm_source(ModbusProfile::HomeHub, 0x22334455U);
    const uint32_t epoch = checkup_consent_epoch();

    const auto make_rows = [](bool unverified) {
        auto flow                         = mb_row(49, "12.0");
        flow.modbus_flow_scale_unverified = unverified;
        return std::vector<CachedValue>{
            mb_row(21, "0"),    mb_row(30, "1"),   mb_row(31, "1"),
            mb_row(32, "0"),    mb_row(37, "0"),   mb_row(38, "1"),
            mb_row(43, "48.0"), mb_row(44, "5.0"), flow,
        };
    };

    // Fallback sweeps must never admit Input 49 into the 24-hour flow check even if row flags vary.
    const auto fallback_rows = make_rows(true);
    for (int t = 10; t <= 90; t += 10) {
        sdk::now_us = static_cast<int64_t>(t) * 1000000LL;
        checkup_record_modbus(fallback_rows.data(), fallback_rows.size(), ModbusProfile::HomeHub,
                              adapter::mb_target_generation, epoch, true,
                              ModbusProfileBasis::Fallback);
    }
    const auto fallback_rep = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(fallback_rep[CheckupCheck::Flow].verdict == CheckupVerdict::Unavailable,
            "fallback_basis_withholds_flow_check");

    // Even in Affirmative HomeHub, an individual unverified row 49 cannot populate flow_min.
    const auto unverified_rows = make_rows(true);
    for (int t = 100; t <= 180; t += 10) {
        sdk::now_us = static_cast<int64_t>(t) * 1000000LL;
        checkup_record_modbus(unverified_rows.data(), unverified_rows.size(),
                              ModbusProfile::HomeHub, adapter::mb_target_generation, epoch, true,
                              ModbusProfileBasis::Affirmative);
    }
    const auto unverified_rep =
        checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(unverified_rep[CheckupCheck::Flow].verdict == CheckupVerdict::Collecting &&
                unverified_rep[CheckupCheck::Flow].observed_s == 0 &&
                unverified_rep[CheckupCheck::Flow].a < 0,
            "unverified_row_49_never_enters_flow_min");

    // Verified Affirmative HomeHub sweep with pump ON for >= 60s produces Ok and 12.0 L/min.
    const auto verified_rows = make_rows(false);
    for (int t = 190; t <= 270; t += 10) {
        sdk::now_us = static_cast<int64_t>(t) * 1000000LL;
        checkup_record_modbus(verified_rows.data(), verified_rows.size(), ModbusProfile::HomeHub,
                              adapter::mb_target_generation, epoch, true,
                              ModbusProfileBasis::Affirmative);
    }
    const auto verified_rep = checkup_report(nullptr, nullptr, nullptr, DiagnosticsSource::Modbus);
    require(verified_rep[CheckupCheck::Flow].verdict == CheckupVerdict::Ok &&
                verified_rep[CheckupCheck::Flow].a == 120,
            "verified_affirmative_homehub_admits_flow");
}

constexpr int64_t     HYDR_SECOND  = 1000000;
constexpr const char* HYDR_PROFILE = "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw";

std::vector<CachedValue> hydronic_rows() {
    const auto  plan     = hydronic_input_plan(HYDR_PROFILE, def::lookup_view(HYDR_PROFILE));
    const char* values[] = {"45", "35", "10", "59.55", "1", "12", "Heating", "0",
                            "0",  "0",  "0",  "0",     "0", "0",  "0"};
    std::vector<CachedValue> rows;
    for (size_t i = 0; i < HYDRONIC_INPUTS; ++i) {
        require(hydronic_input_supported(plan, static_cast<HydronicInput>(i)),
                "hydronic_fixture_registered_inputs");
        rows.push_back(row(plan.rows[i], values[i]));
    }
    // Independent hard-coordinate checks prevent a self-consistent resolver/fixture substitution.
    require(rows.size() == 15 && rows[0].reg == 0x61 && rows[0].off == 2 && rows[0].conv == 105 &&
                rows[1].reg == 0x61 && rows[1].off == 8 && rows[1].conv == 105 &&
                rows[2].reg == 0x62 && rows[2].off == 9 && rows[2].conv == 105,
            "hydronic_fixture_pre_buh_return_flow_identity");
    return rows;
}
void hydronic_sample(int64_t now, const std::vector<CachedValue>& rows, const CheckupCoverage& cov,
                     int64_t started, bool known = true, bool running = true,
                     uint32_t generation = 7) {
    sdk::now_us      = now;
    const auto epoch = checkup_consent_epoch();
    checkup_record(rows.data(), rows.size(), known, running, cov, generation, epoch, true, started);
}
void hydronic_settle(const std::vector<CachedValue>& rows, const CheckupCoverage& cov) {
    for (int64_t t = 1; t <= 601; t += 15)
        hydronic_sample(t * HYDR_SECOND, rows, cov, t * HYDR_SECOND);
}
void hydronic_case(const std::string& name) {
    require(name == "hydronic_waiting" || name == "hydronic_population" || name == "hydronic_age" ||
                name == "hydronic_expiry" || name == "hydronic_consent_lock" ||
                name == "hydronic_source_lock" || name == "hydronic_shared_witness" ||
                name == "hydronic_reader_generation" || name == "hydronic_shutdown" ||
                name == "hydronic_pause_resume" || name == "hydronic_agreement",
            "unknown_case");
    boot();
    const auto cov  = coverage();
    auto       rows = hydronic_rows();
    if (name == "hydronic_waiting") {
        const auto r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::MissingWitness && r.schema_fp != 0 &&
                    r.source_generation == 7 && r.observation.confirmed && r.r1_r4_supported &&
                    r.agree_reason == AgreementReason::MissingWitness,
                "hydronic_capable_waits_for_first_witness");
        require(r.observation.totals.samples == 0 && r.observation.totals.observed_us == 0 &&
                    r.observation.totals.r1_r4_samples == 0 &&
                    r.observation.totals.r2_r1_samples == 0,
                "hydronic_waiting_has_no_fabricated_population");
        return;
    }
    if (name == "hydronic_agreement") {
        const auto plan = hydronic_input_plan(HYDR_PROFILE, def::lookup_view(HYDR_PROFILE));
        rows[0].value   = "25.1"; // R1T
        rows[1].value   = "24.9"; // R4T
        rows[2].value   = "8.0";  // flow >= 5.0 l/min
        rows[5].value   = "0";    // rps == 0
        rows[6].value   = "Stop"; // IuOperationMode == Stop allowed
        rows[11].value  = "1";    // Restart standby (0x10/1/306) allowed
        if (plan.bsh_state == InstrumentState::Supported) rows.push_back(row(plan.bsh, "0"));
        if (plan.post_buh_state == InstrumentState::Supported)
            rows.push_back(row(plan.post_buh_leaving, "25.3"));
        for (int64_t t = 1; t <= 586; t += 15)
            hydronic_sample(t * HYDR_SECOND, rows, cov, t * HYDR_SECOND, true, false);
        auto r = checkup_hydronic_report();
        require(r.current && r.agree_reason == AgreementReason::Settling &&
                    r.agree_settling_remaining_s == 15 && r.observation.totals.r1_r4_samples == 0 &&
                    r.observation.totals.samples == 0 && r.observation.totals.candidate_us == 0,
                "hydronic_agreement_settles_without_polluting_h1");
        hydronic_sample(601 * HYDR_SECOND, rows, cov, 601 * HYDR_SECOND, true, false);
        hydronic_sample(616 * HYDR_SECOND, rows, cov, 616 * HYDR_SECOND, true, false);
        r = checkup_hydronic_report();
        require(r.current && r.agree_reason == AgreementReason::None &&
                    r.observation.totals.r1_r4_samples == 2 &&
                    r.observation.totals.r1_r4_windows == 1 &&
                    r.observation.totals.r1_r4_qualified_us == 15 * HYDR_SECOND &&
                    r.observation.totals.samples == 0 && r.observation.totals.candidate_us == 0,
                "hydronic_agreement_admits_r1_r4_independently");
        if (plan.post_buh_state == InstrumentState::Supported) {
            require(r.r2_r1_supported && r.observation.totals.r2_r1_samples == 2 &&
                        r.observation.totals.r2_r1_windows == 1 &&
                        r.observation.totals.r2_r1_qualified_us == 15 * HYDR_SECOND,
                    "hydronic_agreement_admits_r2_r1_when_supported");
        }
        sdk::now_us = 617 * HYDR_SECOND;
        checkup_set_diagnostics(false, 23);
        r = checkup_hydronic_report();
        require(!r.current && r.agree_reason == AgreementReason::NoConsent &&
                    !r.observation.confirmed,
                "hydronic_agreement_hides_while_paused");
        sdk::now_us = 620 * HYDR_SECOND;
        checkup_set_diagnostics(true, 23);
        r = checkup_hydronic_report();
        require(!r.current && r.agree_reason == AgreementReason::PollGap &&
                    r.observation.confirmed && r.observation.totals.r1_r4_samples == 2,
                "hydronic_agreement_same_gen_resume_keeps_population");
        hydronic_sample(621 * HYDR_SECOND, rows, cov, 621 * HYDR_SECOND, true, false);
        r = checkup_hydronic_report();
        require(r.current && r.agree_reason == AgreementReason::Settling &&
                    r.agree_settling_remaining_s == 600 && r.observation.totals.r1_r4_samples == 2,
                "hydronic_agreement_pause_resets_settling_and_stability");
        return;
    }
    if (name == "hydronic_population") {
        for (int64_t t = 1; t <= 586; t += 15)
            hydronic_sample(t * HYDR_SECOND, rows, cov, t * HYDR_SECOND);
        hydronic_sample(601 * HYDR_SECOND - 1, rows, cov, 601 * HYDR_SECOND - 1);
        auto r = checkup_hydronic_report();
        require(r.current && r.reason == HydronicReason::Settling && r.settling_remaining_s == 1 &&
                    r.observation.totals.samples == 0,
                "hydronic_not_before_600s");
        require(r.observation.totals.observed_us == 600 * HYDR_SECOND - 1 &&
                    r.observation.totals.candidate_us == 600 * HYDR_SECOND - 1 &&
                    r.observation.totals.qualified_us == 0,
                "hydronic_eligible_duration_is_actual_elapsed");
        hydronic_sample(601 * HYDR_SECOND, rows, cov, 601 * HYDR_SECOND);
        r                 = checkup_hydronic_report();
        const auto& first = r.observation.totals;
        require(r.current && r.reason == HydronicReason::None && r.settling_remaining_s == 0 &&
                    first.samples == 1 && first.command_samples == 1 &&
                    first.observed_us == 600 * HYDR_SECOND &&
                    first.candidate_us == 600 * HYDR_SECOND && first.qualified_us == 0,
                "hydronic_first_sample_exact_600s_no_retrobook");
        require(first.spread.min_milli == 10000 && first.spread.max_milli == 10000 &&
                    first.spread.sum_milli == 10000 && first.flow.sum_milli == 10000 &&
                    first.command.sum_milli == 40450 &&
                    first.first_accepted_unix_us == (adapter::unix_origin + 601) * HYDR_SECOND &&
                    first.last_accepted_unix_us == first.first_accepted_unix_us,
                "hydronic_actual_dated_values_and_fractional_command");
        rows.erase(rows.begin() + static_cast<size_t>(HydronicInput::Command));
        hydronic_sample(602 * HYDR_SECOND, rows, cov, 602 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.observation.totals.samples == 2 && r.observation.totals.command_samples == 1 &&
                    r.observation.totals.qualified_us == HYDR_SECOND &&
                    r.observation.totals.observed_us == 601 * HYDR_SECOND &&
                    r.observation.totals.candidate_us == 601 * HYDR_SECOND &&
                    (r.limitations & HydronicCommandUnavailable) &&
                    r.observation.totals.spread.sum_milli == 20000,
                "hydronic_optional_command_preserves_joint_thermal_population");
        const auto core = checkup_report();
        require(CHECKUP_CHECK_COUNT == 8 && core[CheckupCheck::Flow].a == 100 &&
                    core[CheckupCheck::Flow].verdict == CheckupVerdict::Ok &&
                    r.secondary.samples == 0 && !r.secondary.source.conv,
                "hydronic_preserves_eight_checks_and_old_flow_minimum");
        return;
    }
    if (name == "hydronic_age") {
        hydronic_sample(16 * HYDR_SECOND, rows, cov, HYDR_SECOND);
        require(checkup_hydronic_report().current, "hydronic_exact_15s_sweep_allowed");
        hydronic_sample(31 * HYDR_SECOND, rows, cov, 16 * HYDR_SECOND);
        auto r = checkup_hydronic_report();
        require(r.observation.totals.candidate_us == 15 * HYDR_SECOND,
                "hydronic_exact_15s_continuity_allowed");
        hydronic_sample(46 * HYDR_SECOND + 1, rows, cov, 31 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::PollGap &&
                    r.observation.totals.candidate_us == 15 * HYDR_SECOND,
                "hydronic_15s_plus_microsecond_sweep_rejected");
        sdk::now_us = 48 * HYDR_SECOND;
        checkup_record(rows.data(), rows.size(), true, true, cov, 7, checkup_consent_epoch(), true);
        require(!checkup_hydronic_report().current, "hydronic_legacy_omitted_start_cannot_qualify");
        hydronic_sample(49 * HYDR_SECOND, rows, cov, 49 * HYDR_SECOND + 1);
        require(!checkup_hydronic_report().current, "hydronic_future_start_rejected");
        hydronic_sample(50 * HYDR_SECOND, {}, cov, 50 * HYDR_SECOND);
        require(!checkup_hydronic_report().current, "hydronic_empty_sweep_cannot_qualify");
        hydronic_sample(51 * HYDR_SECOND, rows, cov, 51 * HYDR_SECOND);
        sdk::before_take = [] { sdk::now_us = 67 * HYDR_SECOND; };
        hydronic_sample(61 * HYDR_SECOND, rows, cov, 51 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::PollGap &&
                    r.observation.totals.candidate_us == 15 * HYDR_SECOND,
                "hydronic_admission_clock_after_lock");
        return;
    }
    if (name == "hydronic_shared_witness") {
        hydronic_sample(HYDR_SECOND, rows, cov, HYDR_SECOND, false, true);
        require(checkup_hydronic_report().reason == HydronicReason::MissingWitness &&
                    checkup_hydronic_report().observation.totals.samples == 0,
                "hydronic_unknown_shared_witness_blocks");
        hydronic_sample(2 * HYDR_SECOND, rows, cov, 2 * HYDR_SECOND, true, false);
        require(checkup_hydronic_report().reason == HydronicReason::MissingWitness,
                "hydronic_positive_rps_shared_off_contradiction");
        rows[static_cast<size_t>(HydronicInput::Rps)].value = "0";
        hydronic_sample(3 * HYDR_SECOND, rows, cov, 3 * HYDR_SECOND, true, true);
        require(checkup_hydronic_report().reason == HydronicReason::MissingWitness,
                "hydronic_zero_rps_shared_on_contradiction");
        hydronic_sample(4 * HYDR_SECOND, rows, cov, 4 * HYDR_SECOND, true, false);
        hydronic_sample(5 * HYDR_SECOND, rows, cov, 5 * HYDR_SECOND, true, false);
        auto r = checkup_hydronic_report();
        require(r.reason == HydronicReason::CompressorOff &&
                    r.observation.totals.observed_us == HYDR_SECOND &&
                    r.observation.totals.candidate_us == 0,
                "hydronic_consistent_off_is_observed_not_eligible");
        rows[static_cast<size_t>(HydronicInput::Rps)].value = "12";
        hydronic_sample(6 * HYDR_SECOND, rows, cov, 6 * HYDR_SECOND);
        hydronic_sample(21 * HYDR_SECOND, rows, cov, 21 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.reason == HydronicReason::Settling && r.settling_remaining_s == 585 &&
                    r.observation.totals.candidate_us == 15 * HYDR_SECOND &&
                    r.observation.totals.observed_us == 17 * HYDR_SECOND,
                "hydronic_consistent_running_starts_new_settling");
        rows[static_cast<size_t>(HydronicInput::Rps)].held = true;
        hydronic_sample(22 * HYDR_SECOND, rows, cov, 22 * HYDR_SECOND);
        require(checkup_hydronic_report().reason == HydronicReason::MissingWitness &&
                    checkup_hydronic_report().observation.totals.candidate_us == 15 * HYDR_SECOND,
                "hydronic_held_rps_cannot_bridge_shared_witness");
        return;
    }
    hydronic_settle(rows, cov);
    hydronic_sample(602 * HYDR_SECOND, rows, cov, 602 * HYDR_SECOND);
    const auto before = checkup_hydronic_report();
    require(before.observation.totals.samples == 2 &&
                before.observation.totals.qualified_us == HYDR_SECOND,
            "hydronic_fixture_actual_qualified_population");
    if (name == "hydronic_pause_resume") {
        sdk::now_us = 603 * HYDR_SECOND;
        checkup_set_diagnostics(false, 23);
        hydronic_sample(604 * HYDR_SECOND, rows, cov, 604 * HYDR_SECOND);
        auto r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::NoConsent && !r.observation.confirmed &&
                    r.observation.totals.samples == 0,
                "hydronic_pause_withholds_live_and_population_while_off");
        sdk::now_us = 608 * HYDR_SECOND;
        checkup_set_diagnostics(true, 23);
        r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::PollGap && r.observation.confirmed &&
                    r.observation.totals.samples == 2 &&
                    r.observation.totals.observed_us == 601 * HYDR_SECOND &&
                    r.observation.totals.qualified_us == HYDR_SECOND,
                "hydronic_same_gen_resume_restores_24h_population");
        hydronic_sample(610 * HYDR_SECOND, rows, cov, 610 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.current && r.reason == HydronicReason::Settling &&
                    r.settling_remaining_s == 600 && r.observation.totals.samples == 2 &&
                    r.observation.totals.observed_us == 601 * HYDR_SECOND &&
                    r.observation.totals.qualified_us == HYDR_SECOND,
                "hydronic_pause_resume_resets_settling_and_never_bridges_pause");
        hydronic_sample(625 * HYDR_SECOND, rows, cov, 625 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.current && r.reason == HydronicReason::Settling &&
                    r.settling_remaining_s == 585 &&
                    r.observation.totals.observed_us == 616 * HYDR_SECOND &&
                    r.observation.totals.samples == 2,
                "hydronic_resume_restarts_settling_countdown");
        return;
    }
    if (name == "hydronic_reader_generation") {
        // HTTP advances the poll epoch before it can acquire the Checkup mutex for reset.
        // Stop precisely there: no reset, detection callback or new producer has run.
        ++adapter::poll_generation;
        const auto r = checkup_hydronic_report();
        require(!r.current && !r.observation.confirmed &&
                    r.reason == HydronicReason::SourceChanged &&
                    r.observation.totals.samples == 0 && r.observation.totals.observed_us == 0,
                "hydronic_source_epoch_reader_withdraws_before_reset");
        const auto retained = hydronic_observation_report();
        require(retained.confirmed && retained.totals.samples == 2 &&
                    retained.totals.qualified_us == HYDR_SECOND,
                "hydronic_source_epoch_reader_does_not_mutate_store");
        return;
    }
    if (name == "hydronic_consent_lock" || name == "hydronic_source_lock") {
        if (name == "hydronic_consent_lock") {
            consent_restore_generation = 23;
            sdk::before_take           = consent_off_on;
        } else {
            sdk::before_take = [] {
                ++adapter::poll_generation;
                checkup_reset_on_detect(HYDR_PROFILE, 0x87654321);
            };
        }
        hydronic_sample(603 * HYDR_SECOND, rows, cov, 603 * HYDR_SECOND);
        auto r = checkup_hydronic_report();
        require(!r.current && r.observation.totals.samples == 0 &&
                    r.observation.totals.observed_us == 0 && r.observation.persistence_pending,
                name == "hydronic_consent_lock" ? "hydronic_consent_discards_staged_sample"
                                                : "hydronic_source_discards_staged_sample");
        // Source replacement conservatively discards the reset-consuming new sweep as well.
        if (name == "hydronic_source_lock")
            hydronic_sample(604 * HYDR_SECOND, rows, cov, 604 * HYDR_SECOND, true, true, 8);
        hydronic_sample(605 * HYDR_SECOND, rows, cov, 605 * HYDR_SECOND, true, true,
                        adapter::poll_generation);
        r = checkup_hydronic_report();
        require(r.current && r.reason == HydronicReason::Settling &&
                    r.settling_remaining_s == 600 && r.observation.totals.samples == 0 &&
                    r.observation.totals.candidate_us == 0,
                "hydronic_replacement_first_new_sweep_is_baseline");
        return;
    }
    if (name == "hydronic_expiry") {
        sdk::now_us      = 616 * HYDR_SECOND;
        sdk::before_take = [] { sdk::now_us = 618 * HYDR_SECOND; };
        checkup_hydronic_expire(616 * HYDR_SECOND);
        auto r = checkup_hydronic_report();
        require(!r.current && r.reason == HydronicReason::PollGap &&
                    r.observation.totals.samples == 2 &&
                    r.observation.totals.qualified_us == HYDR_SECOND,
                "hydronic_reader_expiry_after_lock_retains_dated_population");
        sdk::now_us = 619 * HYDR_SECOND;
        checkup_hydronic_report();
        hydronic_sample(620 * HYDR_SECOND, rows, cov, 617 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(!r.current && r.observation.totals.samples == 2 &&
                    r.observation.totals.candidate_us == 601 * HYDR_SECOND,
                "hydronic_expiry_fences_inflight");
        sdk::now_us = 622 * HYDR_SECOND;
        checkup_hydronic_report(); // this reader must not move the fence beyond fresh start 621
        checkup_hydronic_expire(622 * HYDR_SECOND);
        hydronic_sample(623 * HYDR_SECOND, rows, cov, 621 * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.current && r.reason == HydronicReason::Settling &&
                    r.settling_remaining_s == 600 && r.observation.totals.samples == 2,
                "hydronic_repeat_expiry_does_not_starve_fresh_sweep");
        for (int64_t t = 638; t <= 1223; t += 15)
            hydronic_sample(t * HYDR_SECOND, rows, cov, t * HYDR_SECOND);
        r = checkup_hydronic_report();
        require(r.observation.totals.samples == 3 &&
                    r.observation.totals.candidate_us == 1201 * HYDR_SECOND &&
                    r.observation.totals.qualified_us == HYDR_SECOND,
                "hydronic_after_expiry_settles_again_without_blind_credit");
        return;
    }
    require(sdk::shutdown != nullptr, "hydronic_shutdown_hook_registered");
    sdk::now_us = 604 * HYDR_SECOND;
    sdk::shutdown();
    auto r = checkup_hydronic_report();
    require(!r.current && r.reason == HydronicReason::PollGap &&
                r.observation.totals.samples == before.observation.totals.samples &&
                r.observation.totals.observed_us == before.observation.totals.observed_us &&
                r.observation.totals.qualified_us == before.observation.totals.qualified_us &&
                r.observation.persistence_pending,
            "hydronic_shutdown_seals_without_fabricated_duration");
    hydronic_sample(605 * HYDR_SECOND, rows, cov, 605 * HYDR_SECOND);
    require(!checkup_hydronic_report().current &&
                checkup_hydronic_report().observation.totals.samples == 2,
            "hydronic_sealed_producer_does_not_reopen_population");
}

void x10a_cycling_run_contexts() {
    boot();
    const auto cov      = coverage();
    const auto ctx_rows = [](const char* rps, const char* lwt, const char* rwt, const char* tgt,
                             const char* flow, const char* req = "1") {
        return std::vector<CachedValue>{
            row({0x30, 0, 152}, rps),
            row({0x61, 2, 105}, lwt),
            row({0x61, 8, 105}, rwt),
            row({0x60, 9, 105}, tgt),
            row(CHECKUP_LOC_FLOW, flow),
            row({0x60, 2, 303}, req),
            row(CHECKUP_LOC_DEFROST, "0"),
            row(CHECKUP_LOC_VALVE, "0"),
            row(CHECKUP_LOC_IU_MODE, "Heating"),
        };
    };

    // Run 1: >= 600 s space heating -> sets typical flow = 18.0 L/min, stops on RequestWithdrawal.
    sample(10, ctx_rows("0", "28.0", "26.0", "35.0", "0.0", "0"), cov, true, false);
    sample(20, ctx_rows("25.0", "28.5", "26.5", "35.0", "18.0", "1"), cov, true, true);
    for (int t = 30; t <= 630; t += 10) {
        sample(t, ctx_rows("25.0", "32.0", "29.0", "35.0", "18.0", "1"), cov, true, true);
    }
    sample(640, ctx_rows("0", "34.0", "31.0", "35.0", "18.0", "0"), cov, true, false);

    // Pause > 30 s with request already On, then short run stopping with LowRpsAboveTarget.
    sample(650, ctx_rows("0", "32.5", "30.0", "35.0", "0.0", "0"), cov, true, false);
    for (int t = 660; t <= 700; t += 10) {
        sample(t, ctx_rows("0", "30.0", "28.0", "35.0", "0.0", "1"), cov, true, false);
    }
    sample(710, ctx_rows("24.0", "30.5", "28.5", "35.0", "16.5", "1"), cov, true, true);
    for (int t = 720; t <= 760; t += 10) {
        sample(t, ctx_rows("16.0", "37.5", "34.5", "35.0", "16.5", "1"), cov, true, true);
    }
    sample(770, ctx_rows("0", "38.2", "35.2", "35.0", "16.5", "1"), cov, true, false);

    sdk::now_us = 780LL * 1000000LL;
    CheckupRunContextSnapshot snap;
    require(checkup_cycling_run_contexts(snap, 780, DiagnosticsSource::X10a),
            "run_context_snapshot_present");
    require(snap.count == 2 && snap.flow_typical_tenths == 180, "run_context_typical_flow");
    require(snap.entries[0].start_kind == static_cast<uint8_t>(CyclingStartKind::RequestOn) &&
                snap.entries[0].stop_kind ==
                    static_cast<uint8_t>(CyclingStopKind::RequestWithdrawal) &&
                snap.entries[0].stop_rwt_tenths == 310 && snap.entries[0].flow_tenths == 180,
            "run_context_first_run");
    require(snap.entries[1].start_kind == static_cast<uint8_t>(CyclingStartKind::CooldownRestart) &&
                snap.entries[1].stop_kind ==
                    static_cast<uint8_t>(CyclingStopKind::LowRpsAboveTarget) &&
                snap.entries[1].stop_rwt_tenths == 352 && snap.entries[1].flow_tenths == 165,
            "run_context_second_run");

    checkup_set_diagnostics(false, 23);
    require(!checkup_has_cycling_run_contexts(DiagnosticsSource::X10a, 780, 0),
            "run_context_hidden_while_paused");
    require(!checkup_cycling_run_contexts(snap, 780, DiagnosticsSource::X10a) && snap.count == 0,
            "run_context_snapshot_blocked_while_paused");
    checkup_set_diagnostics(true, 23);
    sample(785, ctx_rows("0", "32.0", "29.5", "35.0", "0.0", "0"), cov, true, false);
    sdk::now_us = 790LL * 1000000LL;
    require(checkup_has_cycling_run_contexts(DiagnosticsSource::X10a, 790, 0),
            "run_context_preserved_after_pause_resume");
    require(!checkup_has_cycling_run_contexts(DiagnosticsSource::X10a, CHECKUP_WINDOW_S + 840, 0),
            "cycling_context_expired_runs_do_not_admit_snapshot");
    require(checkup_cycling_run_contexts(snap, 790, DiagnosticsSource::X10a) && snap.count == 2 &&
                snap.flow_typical_tenths == 180,
            "run_context_entries_survive_pause_resume");

    CheckupRunContextSnapshot mb_snap;
    require(!checkup_cycling_run_contexts(mb_snap, 780, DiagnosticsSource::Modbus) &&
                mb_snap.count == 0,
            "modbus_run_context_isolated");

    checkup_reset();
    require(!checkup_cycling_run_contexts(snap, 780, DiagnosticsSource::X10a) && snap.count == 0,
            "checkup_reset_clears_run_contexts");

    checkup_reset_on_detect("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw", 0x12345678);
    // First post-reset sample consumes the reset barrier and is conservatively discarded.
    sample(800, ctx_rows("0", "28.0", "26.0", "35.0", "0.0", "0"), cov, true, false);
    sample(810, ctx_rows("0", "28.0", "26.0", "35.0", "0.0", "1"), cov, true, false);
    sample(820, ctx_rows("22.0", "29.0", "27.0", "35.0", "15.0", "1"), cov, true, true);
    sample(830, ctx_rows("0", "32.0", "29.0", "35.0", "15.0", "0"), cov, true, false);
    sdk::now_us = 840LL * 1000000LL;
    require(checkup_cycling_run_contexts(snap, 840, DiagnosticsSource::X10a) && snap.count == 1,
            "run_context_restarted_after_detect");

    checkup_cycling_forget();
    require(!checkup_cycling_run_contexts(snap, 840, DiagnosticsSource::X10a) && snap.count == 0,
            "cycling_forget_withholds_run_contexts");
}
void x10a_cycling_run_context_restart() {
    boot();
    const auto               cov = coverage();
    std::vector<CachedValue> rows{
        row({0x61, 2, 105}, "34.0"), row({0x61, 8, 105}, "30.0"),
        row({0x60, 9, 105}, "35.0"), row(CHECKUP_LOC_FLOW, "18.0"),
        row({0x60, 2, 303}, "1"),    row(CHECKUP_LOC_DEFROST, "0"),
        row(CHECKUP_LOC_VALVE, "0"), row(CHECKUP_LOC_IU_MODE, "Heating"),
    };
    auto running = rows;
    rows.push_back(row({0x30, 0, 152}, "0"));
    running.push_back(row({0x30, 0, 152}, "24.0"));
    sample(10, rows, cov);
    sample(20, running, cov, true, true);
    sample(30, running, cov, true, true);
    sample(40, rows, cov);

    const auto            first_anchor = static_cast<uint32_t>(adapter::unix_origin);
    CyclingRunJournalPage page;
    uint32_t              cursor = 0;
    CheckupCyclingTrace   trace;
    CyclingTraceIdentity  identity;
    uint32_t              barrier = 0;
    sdk::now_us                   = 60LL * 1000000;
    require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true) && !barrier,
            "cycling_context_checkpoint_has_companion_trace");
    require(!checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 40, first_anchor),
            "cycling_context_not_saved_before_refinement");
    sdk::now_us           = 72LL * 1000000;
    adapter::clock_synced = false;
    require(!checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 40, first_anchor),
            "cycling_context_waits_for_wall_clock");
    adapter::clock_synced = true;
    require(!checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 0, first_anchor),
            "cycling_context_waits_for_verified_trace");
    CheckupRunContextSnapshot snap;
    require(checkup_cycling_run_contexts(snap, 72) && snap.count == 1 &&
                (snap.entries[0].flags & RUN_CTX_F_STOPPED),
            "cycling_context_producer_observed_stop");
    ++adapter::unix_origin; // SNTP steps after the trace is saved, before the run page.
    require(!checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 39, first_anchor),
            "cycling_context_waits_for_verified_stop_edge");
    require(checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 40, first_anchor),
            "cycling_context_checkpoint_contains_finalized_observed_run");
    require(cursor == 40 && cycling_run_journal_count(page) == 1 &&
                page.entries[0].flow_tenths == 180 &&
                page.entries[0].start_s == first_anchor + 20 &&
                page.entries[0].stop_s == first_anchor + 40,
            "cycling_context_checkpoint_has_original_measurements");
    const auto archived = page;
    require(!checkup_cycling_runs_checkpoint(page, cursor, cursor, 0, 40, first_anchor),
            "cycling_context_durable_cursor_excludes_saved_run");
    require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true) &&
                trace.unix_s == first_anchor + 40 && trace.boot_s == 40,
            "cycling_context_checkpoint_date_ends_at_sample_despite_forward_step");
    adapter::unix_origin -= 2; // A later trace checkpoint must keep the same stored time frame.
    sample(72, rows, cov);
    require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true) &&
                trace.unix_s == first_anchor + 71 && trace.boot_s == 71 &&
                trace.end_s == CHECKUP_WINDOW_S,
            "cycling_context_keeps_archive_anchor_with_a_newer_live_sample");
    CheckupCyclingTrace live;
    checkup_report(nullptr, &live);
    require(live.unix_s == first_anchor + 71 && live.boot_s == 72,
            "cycling_context_live_trace_uses_corrected_clock");
    adapter::unix_origin -= 50;
    require(!checkup_cycling_checkpoint(live, identity, barrier, 0, true),
            "cycling_context_future_observation_cannot_supplant_checkpoint");

    sdk::now_us          = 0;
    adapter::unix_origin = first_anchor + 90;
    const auto wall      = static_cast<uint32_t>(adapter::unix_origin);
    boot();
    using Result = CheckupFlashRestoreResult;
    require(checkup_cycling_runs_restore(archived, wall, 0) == Result::Ignored,
            "cycling_context_cannot_restore_without_trace");
    require(checkup_cycling_restore(trace, identity, wall, 0) == Result::Restored,
            "cycling_context_restores_companion_trace");
    auto wrong = archived;
    ++wrong.identity.diagnostics_generation;
    require(checkup_cycling_runs_restore(wrong, wall, 0) == Result::Ignored,
            "cycling_context_refuses_other_consent");
    wrong = archived;
    ++wrong.entries[0].stop_s;
    require(checkup_cycling_runs_restore(wrong, wall, 0) == Result::Ignored,
            "cycling_context_refuses_nonmatching_stop");
    require(checkup_cycling_runs_restore(archived, wall, 0) == Result::Restored &&
                checkup_cycling_runs_restore(archived, wall, 0) == Result::Ignored,
            "cycling_context_restores_once_with_both_edges");

    // The first live sample cannot erase the restored prefix.
    sample(10, rows, cov);
    require(checkup_cycling_run_contexts(snap, 10, DiagnosticsSource::X10a, wall + 10) &&
                snap.count == 1 && snap.entries[0].start_s == CHECKUP_WINDOW_S - 80 &&
                snap.entries[0].stop_s == CHECKUP_WINDOW_S - 60 &&
                (snap.entries[0].flags & RUN_CTX_F_RESTORED) &&
                snap.entries[0].flow_tenths == archived.entries[0].flow_tenths,
            "cycling_context_projects_preboot_evidence_with_original_measurements");
    require(
        checkup_has_cycling_run_contexts(DiagnosticsSource::X10a, 10, wall + 10) &&
            !checkup_has_cycling_run_contexts(DiagnosticsSource::X10a, 10, wall + CHECKUP_WINDOW_S),
        "cycling_context_snapshot_admission_expires_restored_rows");
    sample(20, running, cov, true, true);
    sample(30, rows, cov);
    require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true) && trace.live,
            "cycling_context_recheckpoint_combines_restored_and_live_edges");
    sdk::now_us = 0;
    adapter::unix_origin += 90;
    boot();
    require(checkup_cycling_restore(trace, identity, adapter::unix_origin, 0) == Result::Restored &&
                checkup_cycling_runs_restore(archived, adapter::unix_origin, 0) == Result::Restored,
            "cycling_context_survives_second_boot_with_combined_trace");

    sample(10, rows, cov);
    sample(20, running, cov, true, true);
    sample(30, running, cov, true, true);
    sample(40, rows, cov);
    require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true),
            "cycling_context_sets_checkpoint_anchor_before_day_step");
    const uint32_t before_step = trace.unix_s - trace.boot_s;
    sdk::now_us                = 72LL * 1000000;
    for (const int64_t delta : {2LL, -4LL}) {
        adapter::unix_origin += delta * CHECKUP_WINDOW_S;
        const auto corrected = static_cast<uint32_t>(adapter::unix_origin);
        require(checkup_cycling_checkpoint(trace, identity, barrier, 0, true) &&
                    trace.unix_s - trace.boot_s == corrected,
                "cycling_context_reanchors_after_a_clock_step_exceeding_retention");
        require(!checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 40, before_step),
                "cycling_context_refuses_coverage_from_previous_clock_frame");
        require(checkup_cycling_runs_checkpoint(page, 0, cursor, 0, 40, corrected) &&
                    page.entries[0].start_s == corrected + 20 &&
                    page.entries[0].stop_s == corrected + 40,
                "cycling_context_accepts_coverage_verified_on_the_corrected_clock_frame");
    }
    checkup_reset();
    require(!checkup_cycling_run_contexts(snap, 10, DiagnosticsSource::X10a, wall + 10),
            "cycling_context_reset_withdraws_restored_evidence");
}
} // namespace
int main(int argc, char** argv) {
    std::string name = argc == 2 ? argv[1] : "";
    try {
        if (name.rfind("hydronic_", 0) == 0)
            hydronic_case(name);
        else if (name.rfind("stop_", 0) == 0)
            stop_context_case(name);
        else if (name.rfind("buh_", 0) == 0 || name == "heaters_both_on" ||
                 name == "legacy_text_unknown" || name == "single_declared_buh_step")
            heater_case(name);
        else if (name == "independent_heaters")
            independent_heaters();
        else if (name.rfind("fault_", 0) == 0)
            fault_case(name);
        else if (name.rfind("dhw_trace_", 0) == 0)
            dhw_trace_case(name);
        else if (name == "source_freshness")
            source_freshness();
        else if (name == "defrost_start_context")
            defrost_start_case();
        else if (name == "stale_finding")
            stale_finding();
        else if (name == "backwards_clock")
            backwards_clock();
        else if (name == "generation_mismatch")
            generation_case(false);
        else if (name == "inflight_generation")
            generation_case(true);
        else if (name == "reset_read_barrier")
            reset_read_barrier();
        else if (name == "reset_during_lock")
            reset_during_lock();
        else if (name == "consent_reset")
            consent_reset();
        else if (name == "circulation_reset")
            circulation_reset();
        else if (name == "circulation_inflight")
            circulation_inflight();
        else if (name == "pending_expiry")
            pending_expiry();
        else if (name == "report_without_mutex")
            report_without_mutex();
        else if (name == "restored_cycling_detail")
            restored_cycling_detail();
        else if (name == "restored_expiry")
            restored_expiry();
        else if (name == "late_restore_prefix" || name == "late_restore_clock_behind")
            late_restore(name == "late_restore_clock_behind");
        else if (name == "modbus_dual_source")
            modbus_dual_source();
        else if (name == "modbus_flow_scale_gate")
            modbus_flow_scale_gate();
        else if (name == "x10a_modbus_fault_trace_lifecycle")
            x10a_modbus_fault_trace_lifecycle();
        else if (name == "x10a_cycling_run_contexts")
            x10a_cycling_run_contexts();
        else if (name == "x10a_cycling_run_context_restart")
            x10a_cycling_run_context_restart();
        else if (name.rfind("consent_lock_", 0) == 0 || name.rfind("consent_sampling_", 0) == 0 ||
                 name.rfind("consent_caller_", 0) == 0)
            consent_staged_sample(name);
        else
            throw std::runtime_error("unknown_case");
        require(sdk::takes == sdk::gives && !sdk::mutex.owned, "modeled_mutex_balanced");
        for (const auto& mutex : sdk::additional_mutexes)
            require(!mutex.owned, "modeled_independent_mutex_balanced");
        std::cout << "PASS case=" << name << " assertions=" << assertions << "\n";
        return 0;
    } catch (const std::exception& e) {
        std::cout << "FAIL oracle=" << e.what() << " case=" << name << "\n";
        return 1;
    }
}
