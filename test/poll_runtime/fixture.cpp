// Full production poll TU, real generated profiles, RAII guard, format/decode headers.
// Only SDK transport, external stores and scheduling are adapters; no copied task loop.
#include "sdk.hpp"
#include <cstring>
#include <new>
#ifndef POLL_PRODUCTION_SOURCE
#error "Bind the complete production hp_poll.cpp"
#endif
#include POLL_PRODUCTION_SOURCE
void* operator new(size_t n) {
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
daik::Config cfg;
}
namespace daik {
Config             config() { return adapter::cfg; }
std::string        config_profile() { return adapter::cfg.profile; }
ConfigLinkSnapshot config_link_snapshot() {
    return {adapter::cfg.proto, adapter::cfg.rx_pin, adapter::cfg.tx_pin};
}
bool config_commit_detected_link(const Config&, int, int, Protocol, uint32_t, bool&, uint32_t&) {
    return false;
}
bool config_commit_detected_model(uint32_t, std::string, uint32_t, int, int, std::string) {
    return false;
}
bool hp_uart_init(int, int) {
    ++sdk::uart_inits;
    // The next allocation is production fresh.reserve(view.count()), not an adapter throw.
    if (sdk::fail_poll_reserve) sdk::fail_next_new = true;
    return true;
}
void hp_uart_deinit() {}
int  hp_query(uint8_t, Protocol proto, uint8_t* buf, size_t cap, HpQueryLogPolicy) {
    ++sdk::queries;
    // Synthetic framing/payload only; transport and physical readings are outside this witness.
    if (cap < 36) return -1;
    std::memset(buf, 0, cap);
    return payload_offset(proto) + 32 + 1;
}
HpQueryResult hp_query_detailed(uint8_t, Protocol, uint8_t*, size_t, HpQueryLogPolicy) {
    return {};
}
DetectResult hp_detect_run() { return {}; }
void         diag_printf(const char* format, ...) {
    if (std::strstr(format, "cycle skipped")) ++sdk::skipped_logs;
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
                        const logic::CheckupCoverage&, uint32_t) {
    if (!values && !count) ++sdk::checkup_unread;
}
void dwell_record(const CachedValue* values, size_t count, uint32_t, uint32_t) {
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
int main() {
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
