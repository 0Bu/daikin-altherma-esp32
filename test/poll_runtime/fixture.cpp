// Full production poll TU, real generated profiles, RAII guard, format/decode headers.
// Only SDK transport, external stores and scheduling are adapters; no copied task loop.
#include "sdk.hpp"
#include <cstring>
#include <new>
#include <cstdarg>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <type_traits>
#ifndef POLL_PRODUCTION_SOURCE
#error "Bind the complete production hp_poll.cpp"
#endif
#include POLL_PRODUCTION_SOURCE
#include "def/signatures.hpp"
void* operator new(size_t n) {
    sdk::last_new_bytes = n;
    if (sdk::fail_next_new) {
        sdk::fail_next_new = false;
        ++sdk::failures;
        sdk::failed_bytes      = n;
        sdk::failed_lock_depth = sdk::lock_depth;
        throw std::bad_alloc();
    }
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void  operator delete(void* p) noexcept { std::free(p); }
void  operator delete(void* p, size_t) noexcept { std::free(p); }
void* operator new[](size_t n) { return ::operator new(n); }
void  operator delete[](void* p) noexcept { std::free(p); }
void  operator delete[](void* p, size_t) noexcept { std::free(p); }
namespace adapter {
daik::Config             cfg;
daik::DetectResult       detect;
bool                     uart_ok                       = true;
bool                     populated                     = false;
bool                     fail_detect_staging           = false;
bool                     fail_model_arguments          = false;
bool                     model_arguments_no_allocation = false;
bool                     available[256];
uint8_t                  pages[256][40] = {};
int                      page_lengths[256];
unsigned                 link_commits = 0, model_commits = 0;
std::string              committed_profile;
std::string              committed_eeprom;
std::vector<std::string> raw_lines;
void (*on_detect)()       = nullptr;
void (*on_query)(uint8_t) = nullptr;
} // namespace adapter
namespace daik {
Config             config() { return adapter::cfg; }
std::string        config_profile() { return adapter::cfg.profile; }
ConfigLinkSnapshot config_link_snapshot() {
    return {adapter::cfg.proto, adapter::cfg.rx_pin, adapter::cfg.tx_pin};
}
bool config_commit_detected_link(const Config&, int, int, Protocol, uint32_t, bool& saved,
                                 uint32_t& revision) {
    ++adapter::link_commits;
    saved    = true;
    revision = adapter::link_commits;
    if (adapter::fail_model_arguments) {
        adapter::fail_model_arguments = false;
        // Bookkeeping is complete. Only construction of the by-value model arguments follows.
        sdk::fail_next_new = true;
    }
    return true;
}
bool config_commit_detected_model(uint32_t, std::string profile, uint32_t, int, int,
                                  std::string eeprom) {
    // Reaching this entry means argument construction already finished. Disarm before adapter
    // bookkeeping; the unspent failpoint distinguishes moves from an allocating parameter copy.
    adapter::model_arguments_no_allocation = sdk::fail_next_new && sdk::failures == 0;
    sdk::fail_next_new                     = false;
    ++adapter::model_commits;
    adapter::committed_profile = std::move(profile);
    adapter::committed_eeprom  = std::move(eeprom);
    return true;
}
bool hp_uart_init(int, int) {
    ++sdk::uart_inits;
    // The next allocation is production fresh.reserve(view.count()), not an adapter throw.
    if (sdk::fail_poll_reserve && adapter::uart_ok) sdk::fail_next_new = true;
    return adapter::uart_ok;
}
void hp_uart_deinit() {}
int  hp_query(uint8_t reg, Protocol proto, uint8_t* buf, size_t cap, HpQueryLogPolicy) {
    ++sdk::queries;
    if (adapter::on_query) adapter::on_query(reg);
    // Synthetic framing/payload only; transport and physical readings are outside this witness.
    if (cap < 36) return -1;
    std::memset(buf, 0, cap);
    if (adapter::populated) {
        if (!adapter::available[reg]) return -1;
        const int length = adapter::page_lengths[reg];
        if (length + payload_offset(proto) + 1 > static_cast<int>(cap)) return -1;
        std::memcpy(buf + payload_offset(proto), adapter::pages[reg], length);
        return payload_offset(proto) + length + 1;
    }
    return payload_offset(proto) + 32 + 1;
}
HpQueryResult hp_query_detailed(uint8_t reg, Protocol proto, uint8_t* frame, size_t cap,
                                HpQueryLogPolicy policy) {
    if (policy != HpQueryLogPolicy::IntegrityOnly)
        throw std::runtime_error("probe transport policy changed");
    if (adapter::on_query) adapter::on_query(reg);
    if (cap < 8) return {};
    std::memset(frame, 0, cap);
    frame[0] = reg; // synthetic transport identity; raw transport validation has its own fixture.
    frame[payload_offset(proto)] = reg;
    return {HpReplyKind::Ok, payload_offset(proto) + 2};
}
DetectResult hp_detect_run() {
    if (adapter::on_detect) adapter::on_detect();
    DetectResult result = adapter::detect;
    if (adapter::fail_detect_staging) {
        adapter::fail_detect_staging = false;
        // All adapter copies are complete. NRVO or this noexcept move cannot spend the failpoint;
        // production's next allocating operation is its detected_profile copy from result.best.
        static_assert(std::is_nothrow_move_constructible_v<DetectResult>);
        sdk::fail_next_new = true;
    }
    return result;
}
void diag_printf(const char* format, ...) {
    if (std::strstr(format, "cycle skipped")) ++sdk::skipped_logs;
    if (std::strstr(format, "poll: raw")) {
        char    line[256];
        va_list args;
        va_start(args, format);
        std::vsnprintf(line, sizeof(line), format, args);
        va_end(args);
        adapter::raw_lines.emplace_back(line);
    }
}
void     stack_watch_sample(StackWatch) noexcept { ++sdk::stack_samples; }
void     heap_guard_sample() {}
void     history_liveness_touch() noexcept {}
void     history_record_board() {}
void     history_record(const CachedValue*, size_t, uint32_t) { ++sdk::history_commits; }
void     history_reset_on_detect(uint32_t) {}
uint32_t history_x10a_identity(const char*, int32_t, int32_t, char) { return 0x13103; }
void     checkup_reset_on_detect(const char*, uint32_t) {}
void     dwell_reset_on_detect(const char*) {}
void     checkup_record(const CachedValue* values, size_t count, bool, bool,
                        const logic::CheckupCoverage&, uint32_t, bool) {
    if (!values && !count) ++sdk::checkup_unread;
}
void dwell_record(const CachedValue* values, size_t count, uint32_t, uint32_t,
                  const HpValuesIdentity*) {
    if (!values && !count) ++sdk::dwell_unread;
}
bool ota_download_active() { return sdk::ota_active; }
bool weather_fetch_active() { return false; }
} // namespace daik
static void oracle(bool pass, const char* name) {
    if (!pass) {
        std::fprintf(stderr, "FAIL oracle=%s phase=%u\n", name, sdk::delay_count);
        std::exit(1);
    }
}
static uint32_t                       good_revision;
static uint32_t                       good_generation;
static size_t                         good_rows;
static unsigned                       good_queries;
static int64_t                        good_time;
static uint64_t                       good_digest;
static std::vector<daik::CachedValue> saved_cache;
static bool                           cache_preserved() {
    if (saved_cache.size() != daik::s_cache.size()) return false;
    for (size_t i = 0; i < saved_cache.size(); ++i) {
        const auto& a = saved_cache[i];
        const auto& b = daik::s_cache[i];
        if (std::strcmp(a.label, b.label) || a.value != b.value || std::strcmp(a.unit, b.unit) ||
            a.reg != b.reg || a.off != b.off || a.held != b.held ||
            a.modbus_definition != b.modbus_definition || a.conv != b.conv)
            return false;
    }
    return true;
}
static void after_delay(TickType_t ticks) {
    using namespace daik;
    oracle(ticks == pdMS_TO_TICKS(POLL_INTERVAL_S * 1000), "normal_poll_delay");
    oracle(sdk::lock_depth == 0 && !sdk::mutex.owned, "cache_mutex_released_at_delay");
    if (sdk::delay_count == 1) {
        oracle(s_stats.connected && s_cache.size() > 0 && hp_link_connected(),
               "initial_successful_commit");
        good_revision          = s_cache_revision;
        good_generation        = hp_cache_generation();
        good_rows              = s_cache.size();
        good_queries           = sdk::queries;
        good_time              = s_last_ok_us;
        good_digest            = probe_x10a_cache_json(s_cache).digest;
        saved_cache            = s_cache;
        sdk::fail_poll_reserve = true;
    } else if (sdk::delay_count == 2) {
        oracle(hp_skipped_cycles() == 1 && sdk::failures == 1 && sdk::skipped_logs == 1,
               "allocation_failure_caught_once");
        oracle(sdk::failed_bytes ==
                   def::lookup_view(adapter::cfg.profile.c_str()).count() * sizeof(CachedValue),
               "real_production_fresh_reserve_failed");
        oracle(sdk::failed_lock_depth == 0, "poll_allocation_outside_cache_mutex");
        oracle(cache_preserved() && s_cache_revision == good_revision &&
                   hp_cache_generation() == good_generation && s_last_ok_us == good_time &&
                   probe_x10a_cache_json(s_cache).digest == good_digest,
               "last_good_cache_preserved");
        oracle(!hp_poll_network_quiesced(), "oom_does_not_claim_quiescence");
        oracle(sdk::queries == good_queries && hp_link_connected() &&
                   hp_stats().values == static_cast<int>(good_rows),
               "recent_last_good_source_preserved");
        oracle(sdk::checkup_unread == 1 && sdk::dwell_unread == 1,
               "oom_records_unread_observation");
        sdk::now_us = good_time + 16000000;
    } else if (sdk::delay_count == 3) {
        oracle(hp_skipped_cycles() == 2 && sdk::failures == 2, "repeated_failure_survived");
        oracle(sdk::skipped_logs == 1, "consecutive_oom_episode_logs_once");
        oracle(cache_preserved() && s_cache_revision == good_revision &&
                   probe_x10a_cache_json(s_cache).digest == good_digest,
               "aged_cache_retained_without_commit");
        CachedValue row;
        size_t      total = 999;
        oracle(hp_values_snapshot(&row, 1, &total) == 0 && total == 0 && !hp_link_connected() &&
                   !hp_stats().connected && hp_stats().values == 0,
               "aged_last_good_source_unavailable");
        sdk::fail_poll_reserve = false;
        sdk::ota_active        = true;
    } else if (sdk::delay_count == 4) {
        oracle(hp_poll_network_quiesced() && sdk::queries == good_queries &&
                   s_cache_revision == good_revision,
               "quiescence_acknowledged_without_poll_work");
        sdk::ota_active = false;
    } else if (sdk::delay_count == 5) {
        oracle(sdk::queries > good_queries && s_cache_revision == good_revision + 1 &&
                   hp_cache_generation() == good_generation + 1 && hp_link_connected(),
               "subsequent_iteration_recovers");
        oracle(!hp_poll_network_quiesced() && !hp_poll_ota_quiesced(),
               "quiescence_released_after_hold");
        oracle(hp_skipped_cycles() == 2 && sdk::failures == 2 && sdk::history_commits == 2,
               "successful_recovery_no_extra_skips");
        // Force a real string-copy failure while hp_stats owns the production SemGuard.
        s_stats.last_error.assign(96, 'e');
        sdk::fail_next_new = true;
        bool threw         = false;
        try {
            (void)hp_stats();
        } catch (const std::bad_alloc&) {
            threw = true;
        }
        oracle(threw && sdk::failed_lock_depth == 1 && sdk::lock_depth == 0 && !sdk::mutex.owned,
               "reader_oom_releases_production_semguard");
        oracle(hp_stats().last_error.size() == 96 && hp_link_connected(),
               "reader_and_poll_state_usable_after_unwind");
        oracle(sdk::takes == sdk::gives && sdk::stack_samples == 5 && sdk::watchdog_adds == 1,
               "mutex_and_task_ownership_balanced");
        sdk::fail_poll_reserve = true;
    } else if (sdk::delay_count == 6) {
        oracle(hp_skipped_cycles() == 3 && sdk::failures == 4 && sdk::skipped_logs == 2,
               "new_oom_episode_logs_after_recovery");
        oracle(s_cache_revision == good_revision + 1 && hp_link_connected(),
               "new_episode_preserves_recovered_source");
        sdk::fail_poll_reserve = false;
    } else if (sdk::delay_count == 7) {
        oracle(s_cache_revision == good_revision + 2 && hp_link_connected() &&
                   !hp_poll_network_quiesced(),
               "new_episode_recovers");
        oracle(hp_skipped_cycles() == 3 && sdk::skipped_logs == 2 && sdk::history_commits == 3 &&
                   sdk::takes == sdk::gives && sdk::stack_samples == 7,
               "episodes_have_balanced_completion");
        throw sdk::Stop{};
    } else
        oracle(false, "bounded_task_execution");
}
static void run_oom() {
    adapter::cfg.profile          = "generic";
    adapter::cfg.rx_pin           = 44;
    adapter::cfg.tx_pin           = 43;
    adapter::cfg.x10a_identity_fp = 0x13103;
    sdk::on_delay                 = after_delay;
    daik::hp_poll_start();
    oracle(sdk::task_fn != nullptr, "production_task_registered");
    try {
        sdk::task_fn(nullptr);
    } catch (const sdk::Stop&) {}
    oracle(sdk::delay_count == 7, "all_poll_phases_completed");
    std::printf("PASS full production hp_poll.cpp: %u phases; %u caught reserve OOMs; %zu "
                "last-good rows; stale unavailable; quiescence release; recovery; SemGuard unwind; "
                "2 episodes log once each\n",
                sdk::delay_count, daik::hp_skipped_cycles(), good_rows);
}

static void setup(const char* profile = "auto") {
    adapter::cfg.profile          = profile;
    adapter::cfg.rx_pin           = 44;
    adapter::cfg.tx_pin           = 43;
    adapter::cfg.x10a_identity_fp = 0x13103;
    daik::hp_poll_start();
}

static daik::DetectResult incomplete(const char* profile) {
    daik::DetectResult d;
    d.bus_ok               = true;
    d.transport_incomplete = true;
    d.best                 = profile;
    d.rx                   = 44;
    d.tx                   = 43;
    return d;
}

static void detect_pass(daik::DetectResult result) {
    adapter::detect = std::move(result);
    (void)daik::poll_detect();
}

static void detect_generation_delay(TickType_t) {
    oracle(adapter::model_commits == 0, "detect_generation_restarts_confirmation");
    throw sdk::Stop{};
}

static void detect_throw_delay(TickType_t) {
    if (sdk::delay_count == 1) {
        oracle(daik::hp_skipped_cycles() == 1 && adapter::model_commits == 0,
               "detect_thrown_sweep_is_caught");
        adapter::on_detect = nullptr;
    } else if (sdk::delay_count == 2) {
        oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
               "detect_thrown_sweep_breaks_confirmation");
    } else if (sdk::delay_count == 3) {
        oracle(adapter::model_commits == 1, "detect_after_throw_adjacent_recovers");
        throw sdk::Stop{};
    } else
        oracle(false, "bounded_detect_throw_schedule");
}

static size_t staging_copy_bytes;
static void   detect_staging_delay(TickType_t) {
    if (sdk::delay_count == 1) {
        std::printf("OBSERVE profile staging: failed_new=%u bytes=%zu expected_copy_bytes=%zu "
                        "lock_depth=%u\n",
                      sdk::failures, sdk::failed_bytes, staging_copy_bytes, sdk::failed_lock_depth);
        oracle(daik::hp_skipped_cycles() == 1 && sdk::failures == 1 &&
                     sdk::failed_bytes == staging_copy_bytes && sdk::failed_lock_depth == 0 &&
                     !sdk::fail_next_new && !adapter::fail_detect_staging &&
                     adapter::model_commits == 0 && adapter::link_commits == 0,
                 "detect_real_post_return_profile_copy_oom_caught");
    } else if (sdk::delay_count == 2) {
        oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
                 "detect_post_return_staging_oom_breaks_confirmation");
    } else if (sdk::delay_count == 3) {
        oracle(adapter::model_commits == 1 && adapter::link_commits == 1,
                 "detect_after_staging_oom_adjacent_recovers");
        throw sdk::Stop{};
    } else
        oracle(false, "bounded_detect_staging_oom_schedule");
}

static std::string expected_model_eeprom;
static void        detect_model_argument_delay(TickType_t) {
    std::printf("OBSERVE model arguments: link=%u model=%u failed_new=%u allocation_free=%u "
                              "profile_bytes=%zu eeprom_bytes=%zu\n",
                       adapter::link_commits, adapter::model_commits, sdk::failures,
                adapter::model_arguments_no_allocation ? 1U : 0U, adapter::committed_profile.size(),
                       adapter::committed_eeprom.size());
    if (adapter::model_commits == 0)
        oracle(adapter::link_commits == 1 && sdk::failures == 1 && sdk::failed_lock_depth == 1 &&
                          !sdk::fail_next_new,
                      "detect_real_model_argument_copy_failed_inside_commit");
    oracle(adapter::model_commits == 1 && adapter::link_commits == 1 && sdk::failures == 0 &&
                      adapter::model_arguments_no_allocation && !sdk::fail_next_new &&
                      adapter::committed_profile == "altherma_ebla_edla_d_series_4_8kw_monobloc" &&
                      adapter::committed_eeprom == expected_model_eeprom,
                  "detect_model_commit_moves_staged_arguments");
    throw sdk::Stop{};
}

static void run_detect(const char* name) {
    setup();
    if (!std::strcmp(name, "detect_no_match_silent")) {
        auto empty                 = incomplete("");
        empty.transport_incomplete = false;
        detect_pass(empty);
        oracle(adapter::model_commits == 0, "detect_first_no_match_does_not_commit");
        detect_pass({});
        detect_pass(empty);
        oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
               "detect_silence_breaks_no_match_confirmation");
        detect_pass(empty);
        oracle(adapter::model_commits == 1 && adapter::committed_profile == "generic",
               "detect_after_silence_adjacent_no_match_commits_generic");
        return;
    }
    detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
    oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
           "detect_first_incomplete_no_side_effects");
    if (!std::strcmp(name, "detect_adjacent")) {
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 1 && adapter::link_commits == 1 &&
                   adapter::committed_profile == "altherma_ebla_edla_d_series_4_8kw_monobloc",
               "detect_adjacent_agreeing_commits");
    } else if (!std::strcmp(name, "detect_silent")) {
        detect_pass({});
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
               "detect_silence_breaks_confirmation");
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 1, "detect_after_silence_adjacent_recovers");
    } else if (!std::strcmp(name, "detect_no_match")) {
        auto empty                 = incomplete("");
        empty.transport_incomplete = false;
        detect_pass(empty);
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 0, "detect_no_match_breaks_confirmation");
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 1, "detect_no_match_then_adjacent_recovers");
    } else if (!std::strcmp(name, "detect_changed")) {
        detect_pass(incomplete("altherma_gshp2"));
        oracle(adapter::model_commits == 0, "detect_changed_representative_restarts_confirmation");
        detect_pass(incomplete("altherma_gshp2"));
        oracle(adapter::model_commits == 1 && adapter::committed_profile == "altherma_gshp2",
               "detect_changed_adjacent_commits_new_representative");
    } else if (!std::strcmp(name, "detect_generation")) {
        adapter::on_detect = [] { daik::hp_poll_reconfigure(); };
        detect_pass(incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc"));
        oracle(adapter::model_commits == 0 && adapter::link_commits == 0,
               "detect_generation_discards_inflight_sweep");
        adapter::on_detect = nullptr;
        sdk::on_delay      = detect_generation_delay;
        try {
            sdk::task_fn(nullptr);
        } catch (const sdk::Stop&) {}
    } else if (!std::strcmp(name, "detect_throw")) {
        adapter::detect    = incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc");
        adapter::on_detect = [] { throw std::bad_alloc(); };
        sdk::on_delay      = detect_throw_delay;
        try {
            sdk::task_fn(nullptr);
        } catch (const sdk::Stop&) {}
    } else if (!std::strcmp(name, "detect_staging_oom")) {
        adapter::detect = incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc");
        // Calibrate this standard library's opaque string-copy allocation size before arming.
        {
            const std::string copy(adapter::detect.best);
            staging_copy_bytes = sdk::last_new_bytes;
            oracle(copy == adapter::detect.best && staging_copy_bytes >= copy.size() + 1,
                   "detect_profile_copy_allocation_calibrated");
        }
        adapter::fail_detect_staging = true;
        sdk::on_delay                = detect_staging_delay;
        try {
            sdk::task_fn(nullptr);
        } catch (const sdk::Stop&) {}
    } else if (!std::strcmp(name, "detect_model_arguments")) {
        adapter::detect = incomplete("altherma_ebla_edla_d_series_4_8kw_monobloc");
        expected_model_eeprom.assign(80, 'A');
        adapter::detect.eeprom        = expected_model_eeprom;
        adapter::fail_model_arguments = true;
        sdk::on_delay                 = detect_model_argument_delay;
        try {
            sdk::task_fn(nullptr);
        } catch (const sdk::Stop&) {}
    } else
        oracle(false, "known_detect_case");
}

static void put16(uint8_t reg, unsigned offset, uint16_t raw) {
    adapter::pages[reg][offset]     = static_cast<uint8_t>(raw);
    adapter::pages[reg][offset + 1] = static_cast<uint8_t>(raw >> 8);
}

static void run_outdoor_hx_scale() {
    setup("altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw");
    adapter::populated          = true;
    adapter::available[0xA0]    = true;
    adapter::page_lengths[0xA0] = 16;
    adapter::pages[0xA0][10]    = 1; // identified unit, not the absent-second-outdoor marker
    const uint16_t raw[]        = {0xFF80, 0x0100, 0xFA00, 0x1780, 0x8000};
    const char*    expected[]   = {"-0.5", "1.0", "-6.0", "23.5", ""};
    for (size_t i = 0; i < 5; ++i) {
        put16(0xA0, 2, raw[i]);
        daik::poll_once();
        bool found = false;
        for (const auto& row : daik::s_cache) {
            if (row.reg != 0xA0 || row.off != 2) continue;
            found = true;
            oracle(row.conv == 103 && row.value == expected[i] && !std::strcmp(row.unit, "°C"),
                   "outdoor_hx_profile_scale_reaches_cache");
        }
        oracle(found, "outdoor_hx_real_profile_row_present");
    }
    // Resolve the known ERGA fingerprint through the real detector before the formatter/cache.
    int               signature_count = 0;
    const auto*       sigs            = daik::def::signatures(signature_count);
    daik::Fingerprint fingerprint{};
    fingerprint.page_mask      = 0x1bff;
    fingerprint.iu_kw_tenths   = 80;
    const char* representative = daik::detect_best(sigs, signature_count, fingerprint);
    oracle(representative &&
               !std::strcmp(representative, "altherma_ebla_edla_d_series_4_8kw_monobloc"),
           "outdoor_hx_known_representative");
    adapter::cfg.profile = representative;
    put16(0xA0, 2, 0x1780);
    daik::poll_once();
    bool represented = false;
    for (const auto& row : daik::s_cache)
        if (row.reg == 0xA0 && row.off == 2) {
            represented = true;
            oracle(row.conv == 103 && row.value == "23.5",
                   "outdoor_hx_detected_representative_corrected");
        }
    oracle(represented, "outdoor_hx_representative_row_present");
    // Another register-identical table alias remains outside the explicit evidence scope.
    adapter::cfg.profile = "altherma_erga_d_ehv_ehb_ehvz_dj_series_04_08_kw";
    put16(0xA0, 2, 0x0100);
    daik::poll_once();
    bool unproven = false;
    for (const auto& row : daik::s_cache)
        if (row.reg == 0xA0 && row.off == 2) {
            unproven = true;
            oracle(row.conv == 119 && row.value == "25.6", "outdoor_hx_unproven_profile_unchanged");
        }
    oracle(unproven, "outdoor_hx_unproven_row_present");
    adapter::cfg.profile = "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw";
    std::memset(adapter::pages[0xA0], 0, sizeof(adapter::pages[0xA0]));
    adapter::pages[0xA0][10] = adapter::pages[0xA0][11] = 0xFF;
    daik::poll_once();
    bool absent = false;
    for (const auto& row : daik::s_cache)
        if (row.reg == 0xA0 && row.off == 2) {
            absent = true;
            oracle(row.value.empty(), "outdoor_hx_absent_unit_stays_absent");
        }
    oracle(absent, "outdoor_hx_absent_row_present");
}

static uint16_t pressure_for(double target) {
    const daik::ValueDef row{0x62, 15, 405, 2, 1, "Pressure sensor(T)"};
    for (uint16_t raw = 1; raw <= 470; ++raw) {
        uint8_t    bytes[] = {static_cast<uint8_t>(raw), static_cast<uint8_t>(raw >> 8)};
        const auto reading = daik::convert(row, bytes, 802);
        if (reading.ok && reading.value > target - 0.5 && reading.value < target + 0.5) return raw;
    }
    oracle(false, "synthetic_pressure_target_exists");
    return 0;
}

static void setup_populated() {
    setup("altherma_ebla_edla_d_series_4_8kw_monobloc");
    adapter::populated = true;
    for (unsigned reg = 0; reg < 256; ++reg) {
        adapter::available[reg]    = true;
        adapter::page_lengths[reg] = 40;
    }
    adapter::pages[0x30][0] = 42;
    put16(0x20, 10, 0); // actual liquid row: exactly zero.
    put16(0x62, 15, pressure_for(49.0));
    const auto& profile = daik::def::lookup(adapter::cfg.profile.c_str());
    oracle(daik::profile_has_saturation_witness(profile.values, profile.count),
           "real_profile_has_saturation_and_liquid_rows");
}

static const daik::CachedValue& liquid() {
    for (const auto& row : daik::s_cache)
        if (row.reg == 0x20 && row.off == 10 && row.conv == 105) return row;
    oracle(false, "real_liquid_row_present");
    return daik::s_cache[0];
}

static void prime_saturation() {
    daik::poll_once();
    oracle(daik::s_sat_witness.ok && daik::s_sat_witness.temp_c > 48.5 &&
               daik::s_sat_witness.temp_c < 49.5 && liquid().value == "0.0" && !liquid().held,
           "saturation_real_pressure_populates_49C");
    sdk::now_us += 1000000;
}

static const char* saturation_case;
static void        saturation_delay(TickType_t) {
    if (sdk::delay_count == 1) {
        oracle(liquid().value == "0.0", "saturation_skipped_cycle_keeps_last_good_row");
        sdk::ota_active        = false;
        sdk::fail_poll_reserve = false;
        adapter::uart_ok       = true;
        put16(0x62, 15, pressure_for(20.0));
    } else if (sdk::delay_count == 2) {
        const char* assertion = !std::strcmp(saturation_case, "saturation_quiesce")
                                           ? "saturation_quiescence_invalidates_old_witness"
                                       : !std::strcmp(saturation_case, "saturation_oom")
                                           ? "saturation_oom_invalidates_old_witness"
                                           : "saturation_uart_failure_invalidates_old_witness";
        oracle(liquid().value == "0.0" && !liquid().held, assertion);
        oracle(daik::s_sat_witness.ok && daik::s_sat_witness.temp_c < 30,
                      "saturation_recovery_captures_current_cold_witness");
        throw sdk::Stop{};
    } else
        oracle(false, "bounded_saturation_skip_schedule");
}

static void run_saturation(const char* name) {
    setup_populated();
    if (!std::strcmp(name, "saturation_commit_gap"))
        adapter::on_query = [](uint8_t reg) {
            if (reg == 0x63) sdk::now_us += 15000000;
        };
    prime_saturation();
    adapter::on_query = nullptr;
    if (!std::strcmp(name, "saturation_recent")) {
        daik::poll_once();
        oracle(liquid().value.empty(), "saturation_recent_hot_witness_suppresses_zero");
    } else if (!std::strcmp(name, "saturation_age_recent")) {
        sdk::now_us = daik::s_last_ok_us + 14999999;
        daik::poll_once();
        oracle(liquid().value.empty(), "saturation_before_cache_age_boundary_keeps_witness");
    } else if (!std::strcmp(name, "saturation_age_expired")) {
        sdk::now_us = daik::s_last_ok_us + 15000000;
        put16(0x62, 15, pressure_for(20.0));
        daik::poll_once();
        oracle(liquid().value == "0.0", "saturation_at_cache_age_boundary_expires_witness");
    } else if (!std::strcmp(name, "saturation_wire_gap")) {
        sdk::now_us       = daik::s_last_ok_us + 14900000;
        adapter::on_query = [](uint8_t reg) {
            if (reg == 0x20) sdk::now_us += 200000;
        };
        put16(0x62, 15, pressure_for(20.0));
        daik::poll_once();
        oracle(liquid().value == "0.0", "saturation_expires_during_current_wire_wait");
    } else if (!std::strcmp(name, "saturation_commit_gap")) {
        oracle(sdk::now_us >= 17000000, "saturation_post_pressure_wire_delay_executed");
        put16(0x62, 15, pressure_for(20.0));
        daik::poll_once();
        oracle(liquid().value == "0.0", "saturation_age_uses_pressure_time_not_commit_time");
    } else if (!std::strcmp(name, "saturation_long_gap")) {
        sdk::now_us += 16000000;
        put16(0x62, 15, pressure_for(20.0));
        daik::poll_once();
        oracle(liquid().value == "0.0", "saturation_long_gap_expires_old_witness");
    } else if (!std::strcmp(name, "saturation_unavailable") ||
               !std::strcmp(name, "saturation_invalid_pressure") ||
               !std::strcmp(name, "saturation_cold")) {
        if (!std::strcmp(name, "saturation_unavailable"))
            adapter::available[0x62] = false;
        else if (!std::strcmp(name, "saturation_invalid_pressure"))
            put16(0x62, 15, 0);
        else
            put16(0x62, 15, pressure_for(20.0));
        daik::poll_once();
        oracle(liquid().value.empty(), "saturation_prior_cycle_hot_witness_retained_once");
        sdk::now_us += 1000000;
        daik::poll_once();
        oracle(liquid().value == "0.0", !std::strcmp(name, "saturation_unavailable")
                                            ? "saturation_missing_witness_recovers_zero"
                                        : !std::strcmp(name, "saturation_invalid_pressure")
                                            ? "saturation_rejected_pressure_witness_recovers_zero"
                                            : "saturation_current_cold_witness_recovers_zero");
    } else {
        saturation_case = name;
        if (!std::strcmp(name, "saturation_quiesce"))
            sdk::ota_active = true;
        else if (!std::strcmp(name, "saturation_oom"))
            sdk::fail_poll_reserve = true;
        else if (!std::strcmp(name, "saturation_uart"))
            adapter::uart_ok = false;
        else
            oracle(false, "known_saturation_case");
        sdk::on_delay = saturation_delay;
        try {
            sdk::task_fn(nullptr);
        } catch (const sdk::Stop&) {}
    }
}

static std::mutex              schedule_mutex;
static std::condition_variable schedule_condition;
static bool                    old_query_entered = false, old_query_resume = false;
static std::thread             old_service;
static uint32_t                old_ticket       = 0;
static unsigned                interleave_phase = 0;

static void probe_query(uint8_t reg) {
    if (reg != 0x60 || interleave_phase != 1) return;
    std::unique_lock<std::mutex> lock(schedule_mutex);
    old_query_entered = true;
    schedule_condition.notify_one();
    schedule_condition.wait(lock, [] { return old_query_resume; });
}

static void probe_interleave(SemaphoreHandle_t, TickType_t) {
    using namespace daik;
    if (interleave_phase == 0) {
        interleave_phase = 1;
        old_ticket       = probe_ticket_of(s_probe_pending.load());
        old_service      = std::thread([] { poll_probe_service(); });
        std::unique_lock<std::mutex> lock(schedule_mutex);
        schedule_condition.wait(lock, [] { return old_query_entered; });
        // Return no completion: xSemaphoreTake advances to the requested absolute timeout.
    } else if (interleave_phase == 1) {
        const uint32_t pending_b = s_probe_pending.load();
        oracle(probe_reg_of(pending_b) == 0x61, "probe_b_pending_before_late_a");
        {
            std::lock_guard<std::mutex> lock(schedule_mutex);
            old_query_resume = true;
        }
        schedule_condition.notify_one();
        old_service.join();
        oracle(s_probe_pending.load() == pending_b, "probe_late_a_cannot_withdraw_b");
        oracle(s_probe_reply_ticket.load() == old_ticket && s_probe_reply.frame[0] == 0x60,
               "probe_actual_service_returns_late_a");
        interleave_phase = 2;
    } else if (interleave_phase == 2) {
        poll_probe_service();
        interleave_phase = 3;
    } else
        oracle(false, "bounded_probe_interleave_schedule");
}

static void run_probe(const char* name) {
    using namespace daik;
    setup("generic");
    HpProbeReply reply;
    if (!std::strcmp(name, "probe_no_task")) {
        oracle(!hp_probe_run(0x60, reply, 10) && reply.status == ProbeStatus::NoLink &&
                   sdk::binary_waits == 0 && s_probe_pending.load() == 0,
               "probe_no_task_immediate_no_link");
    } else if (!std::strcmp(name, "probe_busy")) {
        s_poll_task_running.store(true);
        xSemaphoreTake(s_probe_gate, 0);
        oracle(!hp_probe_run(0x60, reply, 10) && reply.status == ProbeStatus::Busy &&
                   sdk::binary_waits == 0 && s_probe_pending.load() == 0,
               "probe_concurrent_submitter_immediate_busy");
        xSemaphoreGive(s_probe_gate);
    } else if (!std::strcmp(name, "probe_drain")) {
        s_poll_task_running.store(true);
        xSemaphoreGive(s_probe_done);
        sdk::on_binary_wait = [](SemaphoreHandle_t, TickType_t) {
            oracle(sdk::binary_drains == 1, "probe_old_completion_drained_before_request");
            poll_probe_service();
        };
        oracle(hp_probe_run(0x61, reply, 10) && reply.frame[0] == 0x61 && sdk::binary_waits == 1 &&
                   s_probe_pending.load() == 0,
               "probe_drained_then_actual_service_success");
    } else if (!std::strcmp(name, "probe_deadline")) {
        s_poll_task_running.store(true);
        sdk::on_binary_wait = [](SemaphoreHandle_t semaphore, TickType_t) {
            oracle(sdk::binary_waits <= 10, "probe_foreign_wakes_do_not_restart_deadline");
            sdk::now_us += 2000;
            s_probe_reply_ticket.store(0xabc);
            xSemaphoreGive(semaphore);
        };
        const int64_t start = sdk::now_us;
        oracle(!hp_probe_run(0x60, reply, 10) && reply.status == ProbeStatus::Timeout &&
                   sdk::now_us - start == 10000 && s_probe_pending.load() == 0,
               "probe_absolute_timeout_despite_foreign_wakes");
    } else if (!std::strcmp(name, "probe_late") || !std::strcmp(name, "probe_wrap")) {
        s_poll_task_running.store(true);
        if (!std::strcmp(name, "probe_wrap")) s_probe_ticket.store(0x00ffffff);
        adapter::on_query   = probe_query;
        sdk::on_binary_wait = probe_interleave;
        oracle(!hp_probe_run(0x60, reply, 10) && reply.status == ProbeStatus::Timeout &&
                   s_probe_pending.load() == 0 && interleave_phase == 1,
               "probe_a_times_out_while_actual_service_inflight");
        oracle(hp_probe_run(0x61, reply, 10) && reply.status == ProbeStatus::Ok &&
                   reply.frame[0] == 0x61 && interleave_phase == 3,
               !std::strcmp(name, "probe_wrap") ? "probe_wrap_b_rejects_duplicate_a_ticket"
                                                : "probe_b_rejects_late_a_and_gets_own_reply");
        oracle(s_probe_pending.load() == 0 && sdk::takes == sdk::gives,
               "probe_interleave_slots_and_gate_balanced");
    } else
        oracle(false, "known_probe_case");
}

static size_t raw_bytes(const std::string& line) {
    const size_t begin = line.find('['), end = line.find(']');
    oracle(begin != std::string::npos && end != std::string::npos && end > begin,
           "raw_dump_line_has_complete_payload");
    return (end - begin + 1) / 3;
}

static void run_raw(const char* name) {
    setup_populated();
    if (!std::strcmp(name, "raw_recovery") || !std::strcmp(name, "raw_empty")) {
        const bool empty_reply   = !std::strcmp(name, "raw_empty");
        adapter::available[0x10] = adapter::available[0x20] = false;
        if (empty_reply) {
            adapter::available[0x10] = adapter::available[0x20] = true;
            adapter::page_lengths[0x10] = adapter::page_lengths[0x20] = 0;
        }
        daik::poll_once();
        oracle(adapter::raw_lines.empty() && daik::s_raw_capture.emitted == 0,
               empty_reply ? "raw_empty_payloads_do_not_consume_round"
                           : "raw_absent_pages_do_not_consume_round");
        adapter::available[0x10] = adapter::available[0x20] = true;
        adapter::page_lengths[0x10] = adapter::page_lengths[0x20] = 40;
        sdk::now_us += 1000000;
        daik::poll_once();
        oracle(adapter::raw_lines.size() == 2 && daik::s_raw_capture.emitted == 1,
               "raw_recovered_pages_emit_first_successful_round");
    } else if (!std::strcmp(name, "raw_stopped_recovery")) {
        daik::poll_once();
        oracle(adapter::raw_lines.size() == 2, "raw_initial_running_edge_emits");
        adapter::available[0x10] = adapter::available[0x20] = false;
        adapter::pages[0x30][0]                             = 0;
        sdk::now_us += 1000000;
        daik::poll_once();
        oracle(adapter::raw_lines.size() == 2 && daik::s_raw_capture.emitted == 1,
               "raw_stopped_absence_does_not_spend_budget");
        adapter::available[0x10] = adapter::available[0x20] = true;
        adapter::pages[0x30][0]                             = 42;
        sdk::now_us += 1000000;
        daik::poll_once();
        oracle(adapter::raw_lines.size() == 4 && daik::s_raw_capture.emitted == 2,
               "raw_stopped_absence_rearms_next_running_edge");
    } else if (!std::strcmp(name, "raw_one_page")) {
        adapter::available[0x20] = false;
        daik::poll_once();
        oracle(adapter::raw_lines.size() == 1 && daik::s_raw_capture.emitted == 1 &&
                   adapter::raw_lines[0].find("0x10 len=40") != std::string::npos &&
                   raw_bytes(adapter::raw_lines[0]) == 32,
               "raw_one_valid_page_counts_once_and_caps_32_bytes");
    } else if (!std::strcmp(name, "raw_budget")) {
        for (int round = 0; round < 10; ++round) {
            daik::poll_once();
            sdk::now_us += 301000000;
        }
        oracle(daik::s_raw_capture.emitted == 8 && adapter::raw_lines.size() == 16,
               "raw_at_most_eight_successful_rounds");
        for (const auto& line : adapter::raw_lines)
            oracle(raw_bytes(line) == 32, "raw_every_line_caps_32_bytes");
    } else
        oracle(false, "known_raw_case");
}

static void run_mqtt_scalar_source() {
    using namespace daik;
    auto sample = [](bool connected, bool recent, const char* name) {
        sdk::fail_next_new = true;
        HpMqttSourceState state;
        bool              threw = false;
        try {
            state = hp_mqtt_source_state();
        } catch (const std::bad_alloc&) {
            threw = true;
        }
        const bool unspent = sdk::fail_next_new;
        sdk::fail_next_new = false;
        oracle(!threw && unspent && sdk::failures == 0, "mqtt_scalar_sampler_allocation_free");
        oracle(sdk::lock_depth == 0 && !sdk::mutex.owned && sdk::takes == sdk::gives,
               "mqtt_scalar_sampler_unlocks");
        oracle(state.connected == connected && state.recent == recent, name);
    };
    s_mtx = nullptr;
    sample(false, false, "mqtt_scalar_missing_owner_unknown");
    s_mtx = xSemaphoreCreateMutex();
    s_stats.last_error.assign(96, 'e'); // copying HpStats must spend the armed allocation failure
    s_last_ok_us = -1;
    sample(false, false, "mqtt_scalar_never_observed_unknown");
    s_last_ok_us      = 1000000;
    sdk::now_us       = s_last_ok_us + 1;
    s_stats.connected = true;
    sample(true, true, "mqtt_scalar_answering_sweep_current");
    s_stats.connected = false;
    s_cache.clear();
    sdk::now_us = s_last_ok_us + 1000000;
    sample(false, true, "mqtt_scalar_empty_sweep_keeps_grace");
    sdk::now_us = s_last_ok_us + 14999999;
    sample(false, true, "mqtt_scalar_last_recent_microsecond");
    sdk::now_us = s_last_ok_us + 15000000;
    sample(false, false, "mqtt_scalar_source_exact_expiry");
    s_stats.connected = true;
    sample(false, false, "mqtt_scalar_connected_bit_cannot_renew_time");
    sdk::now_us = s_last_ok_us - 1;
    sample(false, false, "mqtt_scalar_future_observation_unknown");
}

// The fresh, unheld conv-105 cache row as decoded tenths (the converter's own bar scaling): proves
// the row a sampler must NOT read was present in the same sweep.
static bool cached_tenths(uint8_t reg, uint8_t off, int& tenths) {
    for (const auto& row : daik::s_cache)
        if (row.reg == reg && row.off == off && row.conv == 105)
            return !row.held && daik::logic::history_parse_tenths(row.value.c_str(), tenths);
    return false;
}

// The refrigerant service reads ONE high-side sensor per profile through the real sampler: a lost
// hydronic page leaves the side missing rather than splicing in the outdoor transducer, and a
// temperature at 0x20/12 never stands in for a pressure. Synthetic bytes, not physical readings.
static void run_refrigerant(const char* name) {
    using namespace daik;
    const auto& sample = s_refrigerant_service_cycle_sample;
    if (!std::strcmp(name, "refrigerant_one_sensor")) {
        setup_populated(); // both structural high-side rows: 0x62/15 and 0x20/12
        put16(0x62, 15, 200);
        put16(0x20, 12, 230);
        poll_once();
        int hydronic = 0, outdoor = 0;
        oracle(cached_tenths(0x62, 15, hydronic) && cached_tenths(0x20, 12, outdoor) &&
                   hydronic != outdoor,
               "refrigerant_two_distinct_fresh_high_side_rows");
        oracle(sample.high_pressure_ok && sample.high_pressure_tenths == hydronic,
               "refrigerant_high_side_reads_selected_sensor");
        adapter::available[0x62] = false;
        sdk::now_us += 1000000;
        poll_once();
        oracle(cached_tenths(0x20, 12, outdoor), "refrigerant_outdoor_sensor_fresh_in_same_sweep");
        oracle(!sample.high_pressure_ok, "refrigerant_lost_page_never_substitutes_other_sensor");
    } else if (!std::strcmp(name, "refrigerant_unidentified_row")) {
        setup("altherma_lt_da_pair_bml"); // 0x20/12 conv 105 is a heat-sink temperature here
        adapter::populated = true;
        for (unsigned reg = 0; reg < 256; ++reg) {
            adapter::available[reg]    = true;
            adapter::page_lengths[reg] = 40;
        }
        adapter::pages[0x30][0] = 42;
        put16(0x20, 12, 450);
        poll_once();
        int heat_sink = 0;
        oracle(cached_tenths(0x20, 12, heat_sink) && heat_sink == 450,
               "refrigerant_unidentified_row_fresh_in_sweep");
        oracle(!sample.high_pressure_ok, "refrigerant_unidentified_row_never_high_side");
    } else
        oracle(false, "known_refrigerant_case");
}

int main(int argc, char** argv) {
    const char* name = argc > 1 ? argv[1] : "oom_raii";
    if (!std::strcmp(name, "oom_raii"))
        run_oom();
    else if (!std::strncmp(name, "detect_", 7))
        run_detect(name);
    else if (!std::strncmp(name, "saturation_", 11))
        run_saturation(name);
    else if (!std::strncmp(name, "probe_", 6))
        run_probe(name);
    else if (!std::strcmp(name, "mqtt_scalar_source"))
        run_mqtt_scalar_source();
    else if (!std::strcmp(name, "outdoor_hx_scale"))
        run_outdoor_hx_scale();
    else if (!std::strncmp(name, "raw_", 4))
        run_raw(name);
    else if (!std::strncmp(name, "refrigerant_", 12))
        run_refrigerant(name);
    else
        oracle(false, "known_runtime_case");
    std::printf("PASS CASE %s\n", name);
}
