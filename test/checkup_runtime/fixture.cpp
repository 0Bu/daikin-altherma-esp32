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
daik::Config                cfg;
uint32_t                    poll_generation = 7, circulation_generation = 11;
daik::CirculationPumpSample circulation{true, true, false};
bool                        journal_pending     = true;
unsigned                    circulation_samples = 0;
void (*on_circulation)()                        = nullptr;
void (*on_time)()                               = nullptr;
int64_t unix_origin                             = 1700000000;
} // namespace adapter
namespace daik {
namespace detail {
void          config_lock() {}
void          config_unlock() {}
const Config& config_ref_locked() { return adapter::cfg; }
} // namespace detail
void diag_printf(const char*, ...) {}
bool history_checkup_flash_pending() { return adapter::journal_pending; }
bool safe_mode_active() { return false; }
bool time_synced() { return true; }
void time_now(int64_t& s, int32_t& ms) {
    if (adapter::on_time) {
        const auto f     = adapter::on_time;
        adapter::on_time = nullptr;
        f();
    }
    s  = adapter::unix_origin + sdk::now_us / 1000000;
    ms = 0;
}
bool     hp_poll_generation_matches(uint32_t g) { return g == adapter::poll_generation; }
uint32_t              hp_poll_generation() { return adapter::poll_generation; }
uint32_t circulation_source_generation() { return adapter::circulation_generation; }
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
    sample(1, rows, cov);
    sample(11, rows, cov);
    sdk::now_us = 27000000;
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
    require(!checkup_report().source_fresh && checkup_report().available == 0,
            "queued_reset_report_empty");
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
    checkup_set_diagnostics(false, 24);
    const auto calls = adapter::circulation_samples;
    sample(21, rows, cov);
    require(adapter::circulation_samples == calls, "disabled_does_not_sample_sources");
    require(checkup_report().available == 0, "disabled_no_observation");
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
    sample(100, rows, cov);
    sample(110, rows, cov);
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
    const int64_t now        = adapter::unix_origin + 100;
    p.end_unix_s             = now - 22 * 3600;
    record.bucket            = checkup_journal_bucket(p.end_unix_s);
    p.checkup.covered_s      = 3600;
    p.checkup.bar_observed_s = 3600;
    p.checkup.min_bar        = 9;
    p.checkup.flags          = CHECKUP_F_FAULT;
    p.checkup.rps_observed_s = 1200;
    p.checkup.starts         = 1;
    require(checkup_flash_restore(&record, 1, now) == CheckupFlashRestoreResult::Restored,
            "synthetic_record_admitted_by_real_restore");
    require(std::strcmp(checkup_persist_state(), "flash") == 0, "real_restore_provenance_slug");
    adapter::unix_origin -= 30LL * 86400; // later wall-clock correction cannot rejuvenate the slot
    const int64_t deadline = 100000000LL + 3600LL * 1000000;
    sdk::now_us            = deadline - 1;
    CheckupCyclingHours hours;
    const auto          takes_before = sdk::takes;
    auto                before       = checkup_report(&hours);
    require(sdk::takes == takes_before + 1, "report_and_restored_chart_use_one_lock");
    require(hours.count > 1 && hours.hours[0].restored && hours.hours[0].observed_s == 1200 &&
                hours.end_unix_s[0] == static_cast<uint32_t>(p.end_unix_s) &&
                !hours.hours[hours.count - 1].restored,
            "restored_chart_keeps_its_timestamp_and_readable_time");
    require(before[CheckupCheck::Pressure].a == 9 &&
                before[CheckupCheck::Fault].verdict == CheckupVerdict::Info,
            "restored_finding_before_exact_deadline");
    sdk::now_us = deadline;
    auto after  = checkup_report(&hours);
    require(hours.count == 0, "expired_restored_hour_not_in_chart");
    require(after[CheckupCheck::Pressure].a == 15 &&
                after[CheckupCheck::Fault].verdict != CheckupVerdict::Info,
            "restored_expires_without_producer");
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
                    !hours.hours[0].restored && hours.hours[0].starts == 1,
                "late_restore_keeps_live_when_clock_cannot_date_tail");
        return;
    }
    require(restored == CheckupFlashRestoreResult::Restored && hours.count == 3 &&
                hours.hours[0].restored && hours.hours[0].starts == 2 && !hours.hours[1].restored &&
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
        const auto r = checkup_stop_context_report();
        require(!r.pending && r.observation.readable_us == 0 &&
                    r.observation.counters.witnessed_stops_recent_heating == 0,
                "stop_consent_rejects_staged_inputs");
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
} // namespace
int main(int argc, char** argv) {
    std::string name = argc == 2 ? argv[1] : "";
    try {
        if (name.rfind("stop_", 0) == 0)
            stop_context_case(name);
        else if (name.rfind("buh_", 0) == 0 || name == "heaters_both_on" ||
                 name == "legacy_text_unknown" || name == "single_declared_buh_step")
            heater_case(name);
        else if (name == "independent_heaters")
            independent_heaters();
        else if (name.rfind("fault_", 0) == 0)
            fault_case(name);
        else if (name == "source_freshness")
            source_freshness();
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
        else if (name == "restored_expiry")
            restored_expiry();
        else if (name == "late_restore_prefix" || name == "late_restore_clock_behind")
            late_restore(name == "late_restore_clock_behind");
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
