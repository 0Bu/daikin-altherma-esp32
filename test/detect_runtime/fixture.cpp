// Complete production detection TU and generated registry. External UART/config/diag adapters
// supply bounded synthetic frames; they do not copy the sweep, retry or selection algorithms.
#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>
#ifndef DETECT_PRODUCTION_SOURCE
#error "Bind complete hp_detect.cpp"
#endif
#include DETECT_PRODUCTION_SOURCE

namespace adapter {
using namespace daik;
using Key = std::tuple<int, int, Protocol, uint8_t>;
struct Reply {
    HpReplyKind          kind = HpReplyKind::NoReply;
    std::vector<uint8_t> payload;
};
struct Query {
    int         rx, tx;
    Protocol    proto;
    uint8_t     reg;
    HpReplyKind kind;
};
Config                           cfg;
bool                             octal;
ReservedPins                     ethernet;
std::vector<std::pair<int, int>> inits;
std::deque<bool>                 init_results;
std::vector<Query>               queries;
std::map<Key, std::deque<Reply>> script;
HpReplyKind                      fallback;
int                              active_rx, active_tx;
std::string                      diagnostics;
std::string                      scenario;

void check(bool pass, const char* oracle) {
    if (!pass) {
        std::fprintf(stderr, "FAIL %s: oracle=%s\n", scenario.c_str(), oracle);
        std::fprintf(stderr, "TRACE init_count=%zu query_count=%zu active_rx=%d active_tx=%d\n",
                     inits.size(), queries.size(), active_rx, active_tx);
        for (size_t i = 0; i < inits.size() && i < 8; ++i)
            std::fprintf(stderr, "TRACE init[%zu]=%d/%d\n", i, inits[i].first, inits[i].second);
        if (!diagnostics.empty())
            std::fprintf(stderr, "TRACE diagnostics=%.768s\n", diagnostics.c_str());
        std::exit(1);
    }
}
template <class T, class = void> struct LocalFailure {
    static bool get(const T&) { return false; }
};
template <class T> struct LocalFailure<T, std::void_t<decltype(std::declval<T>().local_failure)>> {
    static bool get(const T& r) { return r.local_failure; }
};
bool local(const DetectResult& r) { return LocalFailure<DetectResult>::get(r); }
void reset(const char* name) {
    scenario         = name;
    cfg              = Config{};
    cfg.rx_pin       = 44;
    cfg.tx_pin       = 43;
    cfg.proto        = Protocol::I;
    cfg.profile      = "auto";
    cfg.led_gpio     = -1;
    cfg.btn_gpio     = -1;
    cfg.env3_enabled = false;
    octal            = false;
    ethernet         = {};
    inits.clear();
    init_results.clear();
    queries.clear();
    script.clear();
    fallback  = HpReplyKind::Rejected;
    active_rx = active_tx = -1;
    diagnostics.clear();
}
Reply ok(std::vector<uint8_t> bytes = {}) { return {HpReplyKind::Ok, std::move(bytes)}; }
Reply error(HpReplyKind kind) { return {kind, {}}; }
void  replies(int rx, int tx, Protocol proto, uint8_t reg, std::initializer_list<Reply> values) {
    script[{rx, tx, proto, reg}] = std::deque<Reply>(values);
}
void identity(Protocol proto = Protocol::I) {
    const uint8_t reg = proto == Protocol::I ? 0x00 : 0x50;
    replies(cfg.rx_pin, cfg.tx_pin, proto, reg, {ok(), ok()});
}
size_t count(uint8_t reg, Protocol proto = Protocol::I) {
    return static_cast<size_t>(std::count_if(queries.begin(), queries.end(), [&](const Query& q) {
        return q.reg == reg && q.proto == proto;
    }));
}
bool has(const DetectResult& r, const char* id) {
    return std::find(r.candidates.begin(), r.candidates.end(), id) != r.candidates.end();
}
void member(const DetectResult& r) {
    check(r.best.empty() || has(r, r.best.c_str()), "representative_is_candidate");
    for (const auto& id : r.candidates)
        check(id.compare(0, 8, "altherma") == 0 || id == "protocol_s", "no_chiller_candidate");
}
void fingerprint(int outdoor, int indoor, bool short_descriptor = false) {
    const uint8_t pages[] = {0x00, 0x10, 0x20, 0x21, 0x30, 0x60,
                             0x61, 0x62, 0x63, 0x64, 0xA0, 0xA1};
    for (uint8_t reg : pages) {
        std::vector<uint8_t> payload(16, 0);
        if (reg == 0x00) {
            if (short_descriptor)
                payload.resize(12);
            else
                payload[12] = static_cast<uint8_t>(outdoor);
        }
        if (reg == 0x60) payload[6] = static_cast<uint8_t>(indoor);
        replies(44, 43, Protocol::I, reg, {ok(payload), ok(payload)});
    }
}
} // namespace adapter

namespace daik {
Config       config() { return adapter::cfg; }
bool         hw_octal_spi() { return adapter::octal; }
ReservedPins net_eth_reserved_pins() { return adapter::ethernet; }
bool         hp_uart_init(int rx, int tx) {
    adapter::inits.emplace_back(rx, tx);
    bool result = true;
    if (!adapter::init_results.empty()) {
        result = adapter::init_results.front();
        adapter::init_results.pop_front();
    }
    // Failed remap preserves old driver mapping, matching hp_comm.cpp's contract.
    if (result) {
        adapter::active_rx = rx;
        adapter::active_tx = tx;
    }
    return result;
}
HpQueryResult hp_query_detailed(uint8_t reg, Protocol proto, uint8_t* out, size_t cap,
                                HpQueryLogPolicy policy) {
    using namespace adapter;
    check(policy == HpQueryLogPolicy::IntegrityOnly, "fingerprint_integrity_log_policy");
    auto& queue = script[{active_rx, active_tx, proto, reg}];
    Reply reply = error(fallback);
    if (!queue.empty()) {
        reply = queue.front();
        queue.pop_front();
    }
    std::vector<uint8_t> frame;
    if (reply.kind == HpReplyKind::Ok || reply.kind == HpReplyKind::BadCrc ||
        reply.kind == HpReplyKind::UnexpectedReply || reply.kind == HpReplyKind::ShortReply) {
        if (reply.payload.empty()) {
            const int n = proto == Protocol::S ? reply_len(reg, proto) - 2 : 8;
            reply.payload.resize(static_cast<size_t>(n), 0);
        }
        if (proto == Protocol::I) {
            frame = {0x40, reg, static_cast<uint8_t>(reply.payload.size() + 2)};
        } else {
            check(reply.payload.size() == static_cast<size_t>(reply_len(reg, proto) - 2),
                  "synthetic_s_documented_static_length");
            frame = {0x40}; // S has no documented opcode/page echo requirement.
        }
        frame.insert(frame.end(), reply.payload.begin(), reply.payload.end());
        frame.push_back(crc(frame.data(), static_cast<int>(frame.size())));
        if (reply.kind == HpReplyKind::BadCrc) frame.back() ^= 1;
        if (reply.kind == HpReplyKind::UnexpectedReply) {
            check(proto == Protocol::I, "wrong_page_control_is_i_only");
            frame[1] ^= 1;
            frame.back() = crc(frame.data(), static_cast<int>(frame.size()) - 1);
        }
        if (reply.kind == HpReplyKind::ShortReply) frame.pop_back();
    } else if (reply.kind == HpReplyKind::Rejected) {
        frame = {0x15, 0xea};
    }
    check(frame.size() <= cap && frame.size() <= 64, "bounded_synthetic_frame");
    if (!frame.empty()) std::memcpy(out, frame.data(), frame.size());
    HpReplyKind classified = reply.kind;
    if (reply.kind != HpReplyKind::DriverError) {
        const int expected = proto == Protocol::I && frame.size() >= 3 && frame[0] == 0x40
                                 ? reply_len_dynamic(frame.data())
                                 : reply_len(reg, proto);
        classified = hp_reply_classify(reg, proto, out, static_cast<int>(frame.size()), expected);
        check(classified == reply.kind, "real_crc_classifier_matches_scripted_outcome");
    }
    queries.push_back({active_rx, active_tx, proto, reg, classified});
    return {classified, static_cast<int>(frame.size())};
}
void diag_printf(const char* format, ...) {
    char    line[512];
    va_list args;
    va_start(args, format);
    const int n = std::vsnprintf(line, sizeof(line), format, args);
    va_end(args);
    adapter::check(n >= 0 && n < static_cast<int>(sizeof(line)), "diagnostic_line_is_bounded");
    adapter::diagnostics += line;
}
} // namespace daik

namespace {
using namespace daik;
using namespace adapter;
void candidate_dedup() {
    fallback     = HpReplyKind::NoReply;
    const auto r = hp_detect_run();
    check(!r.bus_ok && !local(r), "silence_is_not_local_failure");
    check(inits == std::vector<std::pair<int, int>>{{44, 43}, {43, 44}},
          "dedup_cache_default_pairs");
    check(queries.size() == 4, "each_pair_two_protocols_once");
    check(diagnostics.find("check wiring/GND") != std::string::npos,
          "genuine_silence_wiring_diagnostic");
}
void cached_protocol_order() {
    cfg.rx_pin = 1;
    cfg.tx_pin = 2;
    cfg.proto  = Protocol::S;
    fallback   = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {2, 1}, {44, 43}, {43, 44}},
          "cache_swap_defaults_order");
    check(queries.size() == 8, "sweep_bounded_eight_queries");
    for (size_t i = 0; i < queries.size(); i += 2)
        check(queries[i].proto == Protocol::S && queries[i].reg == 0x50 &&
                  queries[i + 1].proto == Protocol::I && queries[i + 1].reg == 0x00,
              "cached_framing_is_first");
}
void cache_first_winner() {
    cfg.rx_pin = 1;
    cfg.tx_pin = 2;
    identity();
    const auto r = hp_detect_run();
    check(r.bus_ok && r.rx == 1 && r.tx == 2, "cache_first_winner_kept");
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {1, 2}}, "winning_pair_only_settled");
    check(queries.front().proto == Protocol::I, "cache_first_protocol_short_circuits");
}
void swapped_winner() {
    cfg.rx_pin = 1;
    cfg.tx_pin = 2;
    replies(2, 1, Protocol::I, 0x00, {ok(), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && r.rx == 2 && r.tx == 1, "swapped_pair_winner_kept");
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {2, 1}, {2, 1}},
          "swap_before_build_defaults");
}
void default_winner() {
    cfg.rx_pin = 1;
    cfg.tx_pin = 2;
    replies(44, 43, Protocol::I, 0x00, {ok(), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && r.rx == 44 && r.tx == 43, "default_pair_winner_kept");
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {2, 1}, {44, 43}, {44, 43}},
          "default_after_cached_pairs");
}
void led_reservation() {
    cfg.rx_pin   = 1;
    cfg.tx_pin   = 2;
    cfg.led_gpio = 43;
    std::string reason;
    check(board_hw_valid(cfg, reason, 48, false), "led43_with_cached12_is_valid_board_config");
    fallback = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {2, 1}},
          "reserved_default_never_uart_touched");
}
void ethernet_reservation() {
    cfg.rx_pin = 5;
    cfg.tx_pin = 6;
    ethernet   = ReservedPins{5, 6, 7, 8};
    fallback   = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{44, 43}, {43, 44}},
          "ethernet_pairs_never_uart_touched");
}
void env_reservation() {
    cfg.rx_pin       = 1;
    cfg.tx_pin       = 2;
    cfg.env3_enabled = true;
    cfg.env3_sda     = 43;
    cfg.env3_scl     = 44;
    fallback         = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{1, 2}, {2, 1}},
          "env_reserved_default_never_uart_touched");
}
void chip_reserved() {
    cfg.rx_pin = 26;
    cfg.tx_pin = 27;
    fallback   = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{44, 43}, {43, 44}},
          "chip_reserved_cache_never_uart_touched");
}
void octal_reserved() {
    cfg.rx_pin = 33;
    cfg.tx_pin = 34;
    octal      = true;
    fallback   = HpReplyKind::NoReply;
    hp_detect_run();
    check(inits == std::vector<std::pair<int, int>>{{44, 43}, {43, 44}},
          "octal_cache_never_uart_touched");
}
void invalid_candidates() {
    cfg.rx_pin   = -1;
    cfg.tx_pin   = -1;
    cfg.led_gpio = 43;
    const auto r = hp_detect_run();
    check(inits.empty() && queries.empty(), "no_safe_pair_no_uart_query");
    check(local(r), "no_safe_candidates_is_local_config_failure");
    check(diagnostics.find("check wiring/GND") == std::string::npos,
          "no_candidate_is_not_silent_wire");
}
void init_failure() {
    init_results = {false, false};
    const auto r = hp_detect_run();
    check(queries.empty() && !r.bus_ok, "failed_init_has_no_query");
    check(diagnostics.find("check wiring/GND") == std::string::npos,
          "init_failure_not_wiring_diagnosis");
    check(local(r), "init_failure_retains_local_failure");
}
void remap_failure() {
    fallback     = HpReplyKind::NoReply;
    init_results = {true, false};
    const auto r = hp_detect_run();
    check(!r.bus_ok && queries.size() == 2, "failed_remap_never_queries_previous_pair");
    check(local(r), "remap_failure_retains_local_failure");
}
void exclusive_driver_error() {
    fallback     = HpReplyKind::DriverError;
    const auto r = hp_detect_run();
    check(diagnostics.find("check wiring/GND") == std::string::npos,
          "driver_error_not_wiring_diagnosis");
    check(!r.bus_ok && local(r), "driver_error_retains_local_failure");
}
void driver_error_then_winner() {
    replies(44, 43, Protocol::I, 0x00, {error(HpReplyKind::DriverError)});
    replies(44, 43, Protocol::S, 0x50, {ok(), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && r.proto == Protocol::S && r.rx == 44 && r.tx == 43,
          "valid_other_protocol_still_wins_after_local_error");
    check(r.best == "protocol_s", "recovered_protocol_is_fingerprinted");
}
void init_failure_then_winner() {
    cfg.rx_pin   = 1;
    cfg.tx_pin   = 2;
    init_results = {false, true, true};
    replies(2, 1, Protocol::I, 0x00, {ok(), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && r.rx == 2 && r.tx == 1, "later_valid_pair_wins_after_init_failure");
    check(std::all_of(queries.begin(), queries.end(),
                      [](const Query& q) { return q.rx == 2 && q.tx == 1; }),
          "no_query_at_failed_pair_before_later_winner");
}
void reinit_failure() {
    identity();
    init_results = {true, false};
    const auto r = hp_detect_run();
    check(!r.bus_ok && queries.size() == 1, "failed_winning_reinit_no_fingerprint_queries");
    check(local(r), "winning_reinit_retains_local_failure");
}
void recovered_page() {
    identity();
    replies(44, 43, Protocol::I, 0x10, {error(HpReplyKind::NoReply), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && (r.page_mask & page_mask_bit(0x10)), "retry_recovers_page_bit");
    check(count(0x10) == 2 && !r.transport_incomplete, "recovered_page_is_complete");
    check(diagnostics.find("retries=1 transport_err=0") != std::string::npos,
          "only_recovered_retry_counted");
}
void recovered_crc() {
    identity();
    replies(44, 43, Protocol::I, 0x10, {error(HpReplyKind::BadCrc), ok()});
    const auto r = hp_detect_run();
    check(r.bus_ok && (r.page_mask & page_mask_bit(0x10)) && !r.transport_incomplete,
          "recovered_corruption_is_complete");
    check(diagnostics.find("retries=1 transport_err=0") != std::string::npos,
          "corrupt_retry_recovery_counted");
}
void third_attempt_recovers() {
    identity();
    replies(44, 43, Protocol::I, 0x10,
            {error(HpReplyKind::NoReply), error(HpReplyKind::NoReply), ok()});
    const auto r = hp_detect_run();
    check(count(0x10) == 3 && (r.page_mask & page_mask_bit(0x10)) && !r.transport_incomplete,
          "third_attempt_recovers_page");
    check(diagnostics.find("retries=2 transport_err=0") != std::string::npos,
          "two_recovery_attempts_counted");
}
void page_silence_absent() {
    identity();
    replies(
        44, 43, Protocol::I, 0x10,
        {error(HpReplyKind::NoReply), error(HpReplyKind::NoReply), error(HpReplyKind::NoReply)});
    const auto r = hp_detect_run();
    check(count(0x10) == 3 && !(r.page_mask & page_mask_bit(0x10)) && !r.transport_incomplete,
          "absent_page_silence_not_transport_failure");
    check(diagnostics.find("retries=0 transport_err=0") != std::string::npos,
          "healthy_absence_has_zero_recoveries");
}
void error_then_silence() {
    identity();
    replies(44, 43, Protocol::I, 0x10,
            {error(HpReplyKind::BadCrc), error(HpReplyKind::NoReply), error(HpReplyKind::NoReply)});
    const auto r = hp_detect_run();
    check(!(r.page_mask & page_mask_bit(0x10)) && count(0x10) == 3, "failed_page_never_present");
    check(r.transport_incomplete, "earlier_error_survives_later_silence");
    check(diagnostics.find("retries=0 transport_err=1") != std::string::npos,
          "unrecovered_attempts_not_retries");
}
void driver_then_silence() {
    identity();
    replies(44, 43, Protocol::I, 0x10,
            {error(HpReplyKind::DriverError), error(HpReplyKind::NoReply),
             error(HpReplyKind::NoReply)});
    check(hp_detect_run().transport_incomplete, "driver_page_failure_marks_incomplete");
}
void nak_no_retry() {
    identity();
    replies(44, 43, Protocol::I, 0x10, {error(HpReplyKind::Rejected), ok()});
    const auto r = hp_detect_run();
    check(count(0x10) == 1 && !(r.page_mask & page_mask_bit(0x10)), "nak_is_not_retried");
    check(!r.transport_incomplete, "nak_is_not_transport_failure");
}
void nak_after_error() {
    identity();
    replies(44, 43, Protocol::I, 0x10, {error(HpReplyKind::BadCrc), error(HpReplyKind::Rejected)});
    const auto r = hp_detect_run();
    check(count(0x10) == 2 && !r.transport_incomplete,
          "affirmative_nak_clears_missing_page_uncertainty");
}
void eeprom_display_only() {
    fingerprint(80, 80, true);
    replies(44, 43, Protocol::I, 0x11, {ok({0x01, 0x23, 0x45, 0x67, 0x89, 0xab})});
    const auto r = hp_detect_run();
    check(r.eeprom == "01 23 45 67 89 AB", "eeprom_six_bytes_displayed");
    check(r.page_mask == 0x1bff && r.candidates.size() == 5, "eeprom_never_fingerprint_bit");
}
void eeprom_error_optional() {
    identity();
    replies(44, 43, Protocol::I, 0x11,
            {error(HpReplyKind::BadCrc), error(HpReplyKind::NoReply), error(HpReplyKind::NoReply)});
    const auto r = hp_detect_run();
    check(r.eeprom.empty() && !r.transport_incomplete, "eeprom_absence_does_not_block_model");
}
void long_payload_bounded() {
    identity();
    std::vector<uint8_t> descriptor(60, 0x7f);
    descriptor[12] = 80;
    replies(44, 43, Protocol::I, 0x00, {ok(descriptor), ok(descriptor)});
    replies(44, 43, Protocol::I, 0x11, {ok(descriptor)});
    const auto r = hp_detect_run();
    check(r.kw_tenths == 80 && r.eeprom == "7F 7F 7F 7F 7F 7F",
          "large_payload_copies_bounded_prefix");
    check(diagnostics.find("raw 0x00 len=60 [7f 7f") != std::string::npos,
          "raw_dump_retains_original_length");
}
void short_eeprom_absent() {
    identity();
    replies(44, 43, Protocol::I, 0x11, {ok({1, 2, 3, 4, 5})});
    check(hp_detect_run().eeprom.empty(), "short_eeprom_never_fabricates_sixth_byte");
}
void protocol_s() {
    cfg.proto = Protocol::S;
    identity(Protocol::S);
    replies(44, 43, Protocol::S, 0x53, {ok()});
    replies(44, 43, Protocol::S, 0x56, {ok()});
    const auto r = hp_detect_run();
    check(r.proto == Protocol::S && r.best == "protocol_s" && r.candidates.size() == 1,
          "s_fingerprint_uses_s_profile");
    check(r.kw_tenths == -1 && r.eeprom.empty(), "s_never_invents_i_capacity_or_eeprom");
    check(r.page_mask == (page_mask_bit(0x50) | page_mask_bit(0x53) | page_mask_bit(0x56)),
          "s_page_mask_from_received_pages");
    member(r);
}
void protocol_s56_optional() {
    cfg.proto = Protocol::S;
    identity(Protocol::S);
    replies(44, 43, Protocol::S, 0x56,
            {error(HpReplyKind::BadCrc), error(HpReplyKind::NoReply), error(HpReplyKind::NoReply)});
    const auto r = hp_detect_run();
    check(r.best == "protocol_s" && !r.transport_incomplete, "unverified_s56_is_optional");
}
void short_capacity_fallback() {
    fingerprint(0, 80, true);
    const auto r = hp_detect_run();
    check(r.kw_tenths == -1 && r.iu_kw_tenths == 80 && r.page_mask == 0x1bff,
          "short_descriptor_uses_indoor_capacity");
    check(r.candidates.size() == 5 && has(r, "altherma_erga_e_ehv_ehb_ehvz_e_ej_series_04_08kw") &&
              has(r, "altherma_top_grade"),
          "fallback_keeps_consistent_ambiguous_models");
    check(!has(r, "altherma_epra_d_etv16_etb16_etvz16_d_series_14_16kw"),
          "fallback_excludes_contradicting_capacity");
    member(r);
}
void outdoor_precedence() {
    fingerprint(160, 80);
    const auto r = hp_detect_run();
    check(r.kw_tenths == 160 && r.iu_kw_tenths == 80, "both_capacity_observations_preserved");
    int lo = -1, hi = -1;
    check(parse_kw_class(r.best.c_str(), lo, hi) && lo <= 160 && hi >= 160,
          "outdoor_capacity_precedes_indoor_fallback");
    member(r);
}
void unknown_capacity() {
    fingerprint(0, 0, true);
    const auto r = hp_detect_run();
    check(r.kw_tenths == -1 && r.iu_kw_tenths == -1 && r.candidates.size() == 8,
          "unknown_capacity_stays_ambiguous");
    member(r);
}
void uncorroborated_capacity() {
    fingerprint(0, 255, true);
    const auto r = hp_detect_run();
    check(r.iu_kw_tenths == 255 && r.candidates.size() == 8,
          "uncorroborated_capacity_does_not_prune_all_classes");
    member(r);
}
struct Case {
    const char* name;
    void (*run)();
};
const Case cases[] = {
    {"candidate_dedup", candidate_dedup},
    {"cached_protocol_order", cached_protocol_order},
    {"cache_first_winner", cache_first_winner},
    {"swapped_winner", swapped_winner},
    {"default_winner", default_winner},
    {"led_reservation", led_reservation},
    {"ethernet_reservation", ethernet_reservation},
    {"env_reservation", env_reservation},
    {"chip_reserved", chip_reserved},
    {"octal_reserved", octal_reserved},
    {"invalid_candidates", invalid_candidates},
    {"init_failure", init_failure},
    {"remap_failure", remap_failure},
    {"exclusive_driver_error", exclusive_driver_error},
    {"driver_error_then_winner", driver_error_then_winner},
    {"init_failure_then_winner", init_failure_then_winner},
    {"reinit_failure", reinit_failure},
    {"recovered_page", recovered_page},
    {"recovered_crc", recovered_crc},
    {"third_attempt_recovers", third_attempt_recovers},
    {"page_silence_absent", page_silence_absent},
    {"error_then_silence", error_then_silence},
    {"driver_then_silence", driver_then_silence},
    {"nak_no_retry", nak_no_retry},
    {"nak_after_error", nak_after_error},
    {"eeprom_display_only", eeprom_display_only},
    {"eeprom_error_optional", eeprom_error_optional},
    {"long_payload_bounded", long_payload_bounded},
    {"short_eeprom_absent", short_eeprom_absent},
    {"protocol_s", protocol_s},
    {"protocol_s56_optional", protocol_s56_optional},
    {"short_capacity_fallback", short_capacity_fallback},
    {"outdoor_precedence", outdoor_precedence},
    {"unknown_capacity", unknown_capacity},
    {"uncorroborated_capacity", uncorroborated_capacity},
};
} // namespace

int main(int argc, char** argv) {
    size_t executed = 0;
    for (const auto& test : cases) {
        if (argc > 1 && std::strcmp(argv[1], test.name) != 0) continue;
        adapter::reset(test.name);
        test.run();
        ++executed;
        std::printf("PASS %s\n", test.name);
    }
    if (!executed) return 2;
    std::printf("PASS total=%zu\n", executed);
    return 0;
}
