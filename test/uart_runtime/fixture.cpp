// Compile the complete production UART translation unit against SDK-shaped transport seams.
#include "sdk.hpp"
#include <cstdarg>
#include <cstdio>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <utility>

#ifndef UART_PRODUCTION_SOURCE
#define UART_PRODUCTION_SOURCE "../../main/hp_comm.cpp"
#endif
#include UART_PRODUCTION_SOURCE
#ifndef UART_DETECT_SOURCE
#define UART_DETECT_SOURCE "../../main/logic/detect.hpp"
#endif
#include UART_DETECT_SOURCE
#ifndef UART_PROBE_SOURCE
#define UART_PROBE_SOURCE "../../main/logic/hp_probe.hpp"
#endif
#include UART_PROBE_SOURCE

namespace daik {
void diag_printf(const char* fmt, ...) {
    char    text[256];
    va_list args;
    va_start(args, fmt);
    const int n = vsnprintf(text, sizeof(text), fmt, args);
    va_end(args);
    if (n > 0) sdk::logs.append(text, std::min<size_t>(static_cast<size_t>(n), sizeof(text) - 1));
}
} // namespace daik

namespace {
using namespace daik;
void require(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}
void setup() {
    hp_uart_deinit();
    sdk::installed   = false;
    sdk::param_fails = sdk::pin_fails = sdk::install_fails = false;
    sdk::installs = sdk::deletes = sdk::pin_sets = 0;
    sdk::clear_transaction();
    require(hp_uart_init(44, 43), "UART initialization must succeed");
    require(sdk::rx_buffer_size == 256 && sdk::tx_buffer_size == 0,
            "production uses unbuffered TX");
    sdk::clear_transaction();
}
std::vector<uint8_t> golden_i() {
    // Synthetic valid page 0x60; checksum is a literal independently recorded oracle.
    return {0x40, 0x60, 0x0a, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x31};
}
inline uint8_t buffer[64]{};
HpQueryResult  query(Protocol proto = Protocol::I, HpQueryLogPolicy policy = HpQueryLogPolicy::All,
                     uint8_t reg = 0x60, size_t size = sizeof(buffer)) {
    std::memset(buffer, 0xcc, sizeof(buffer));
    return hp_query_detailed(reg, proto, buffer, size, policy);
}
void one_request(Protocol proto = Protocol::I, uint8_t reg = 0x60) {
    const std::vector<uint8_t> expected =
        proto == Protocol::I
            ? std::vector<uint8_t>{0x03, 0x40, reg, static_cast<uint8_t>(~(0x43 + reg))}
            : std::vector<uint8_t>{0x02, reg, static_cast<uint8_t>(~(0x02 + reg))};
    require(sdk::writes == 1 && sdk::requests.size() == 1 && sdk::requests[0] == expected,
            "exact request must be sent once without retry");
    require(sdk::now_us <= HP_QUERY_TIMEOUT_US + 20000,
            "query must stay within the request deadline plus one SDK wait");
}
void expect_driver_diagnostic(const char* phase);
void driver_result(const HpQueryResult& result, const char* phase, int copied = 0) {
    require(result.kind == HpReplyKind::DriverError, "local SDK error must retain DriverError");
    require(result.received == copied, "driver error must preserve copied-byte count");
    require(is_transport_error(result.kind),
            "detection must count local driver failures as transport errors");
    require(probe_status_from_reply(result.kind) == ProbeStatus::NoLink,
            "manual probe must report a local NoLink failure");
    expect_driver_diagnostic(phase);
}
void expect_driver_diagnostic(const char* phase) {
    require(sdk::logs.find("HP UART ") != std::string::npos,
            "local SDK failure must emit a UART diagnostic");
    require(sdk::logs.find("failed") != std::string::npos &&
                sdk::logs.find("reg 0x60") != std::string::npos,
            "UART diagnostic must retain failure and requested page");
    require(sdk::logs.find(phase) != std::string::npos,
            "UART diagnostic must identify failed phase");
    require(sdk::logs.find("HP no reply") == std::string::npos,
            "local SDK failure must not be described as remote silence");
    require(sdk::logs.size() < 256, "one bounded UART error diagnostic per query");
}
void witness_missing_driver() {
    setup();
    sdk::installed    = false;
    const auto result = query();
    require(sdk::transmitted == 0, "missing driver cannot physically transmit a query");
    driver_result(result, "flush");
    require(sdk::flushes == 1 && sdk::writes == 0 && sdk::waits == 0 && sdk::reads == 0,
            "failed flush must stop before write, wait or read");
}
void witness_header_read() {
    setup();
    sdk::pending_reply      = golden_i();
    sdk::negative_read_call = 1;
    const auto result       = query();
    require(sdk::requests.size() == 1 && sdk::transmitted == 4,
            "negative header read occurs after a valid request");
    driver_result(result, "read");
    require(sdk::reads == 1, "header driver failure must stop immediately");
}
void witness_bulk_read() {
    setup();
    sdk::pending_reply      = golden_i();
    sdk::negative_read_call = 4;
    const auto result       = query();
    require(sdk::requests.size() == 1 && sdk::read_sizes.back() == 9,
            "negative bulk read follows a complete Protocol-I header");
    driver_result(result, "read", 3);
    require(std::memcmp(buffer, sdk::pending_reply.data(), 3) == 0,
            "partial reply bytes remain available to detailed callers");
    require(sdk::reads == 4, "bulk driver failure must stop immediately");
}
void silence() {
    setup();
    const auto result = query();
    require(result.kind == HpReplyKind::NoReply && result.received == 0,
            "real silence must remain NoReply");
    require(sdk::logs.find("HP no reply") != std::string::npos,
            "real silence must retain its remote NoReply diagnostic");
    require(sdk::writes == 1 && sdk::requests.size() == 1, "silent queries must not resend");
    require(sdk::now_us == HP_QUERY_TIMEOUT_US && sdk::reads == 15,
            "20ms reads must respect the 300ms request deadline");
}
void protocol_i() {
    setup();
    sdk::pending_reply = golden_i();
    const auto result  = query();
    require(result.kind == HpReplyKind::Ok && result.received == 12,
            "valid Protocol-I frame must be accepted");
    require(std::memcmp(buffer, sdk::pending_reply.data(), 12) == 0,
            "Protocol-I bytes must match literal golden frame");
    one_request();
    require(sdk::read_sizes == std::vector<int>({1, 1, 1, 9}),
            "complete Protocol-I header enables one bounded bulk read");
    require(sdk::logs.empty(), "valid frame must not emit a failure diagnostic");
}
void protocol_s() {
    setup();
    sdk::pending_reply = {0x50, 0x01, 0x02, 0x03, 0x04, 0xa5};
    const auto result  = query(Protocol::S, HpQueryLogPolicy::All, 0x50);
    require(result.kind == HpReplyKind::Ok && result.received == 6,
            "valid Protocol-S fixed-length golden frame must be accepted");
    require(std::memcmp(buffer, sdk::pending_reply.data(), 6) == 0,
            "Protocol-S bytes must match literal golden frame");
    one_request(Protocol::S, 0x50);
    require(sdk::read_sizes == std::vector<int>({1, 1, 4}),
            "Protocol-S header enables one bounded bulk read");
}
void echoed_frames() {
    setup();
    sdk::pending_reply = {0x03, 0x40, 0x60, 0x5c, 0x55, 0xaa};
    const auto frame   = golden_i();
    sdk::pending_reply.insert(sdk::pending_reply.end(), frame.begin(), frame.end());
    const auto result = query();
    require(result.kind == HpReplyKind::Ok && result.received == 12,
            "Protocol-I local echo and leading noise must be stripped");
    require(std::memcmp(buffer, frame.data(), frame.size()) == 0,
            "noise and echo must not contaminate payload");
    one_request();
    sdk::clear_transaction();
    sdk::pending_reply = {0x02, 0x50, 0xad, 0x50, 0x01, 0x02, 0x03, 0x04, 0xa5};
    const auto s       = query(Protocol::S, HpQueryLogPolicy::All, 0x50);
    require(s.kind == HpReplyKind::Ok && s.received == 6,
            "Protocol-S local request echo must be stripped");
    one_request(Protocol::S, 0x50);
}
void rejected_frames() {
    for (const auto proto : {Protocol::I, Protocol::S}) {
        setup();
        sdk::pending_reply = {0x15, 0xea};
        const auto result  = query(proto);
        require(result.kind == HpReplyKind::Rejected && result.received == 2,
                "two-byte NAK must retain its distinct result");
        require(buffer[0] == 0x15 && buffer[1] == 0xea, "raw NAK bytes must remain available");
        one_request(proto);
        require(sdk::reads == 2, "NAK must finish immediately without trailing reads");
    }
}
void partial_reply() {
    setup();
    sdk::pending_reply = golden_i();
    sdk::pending_reply.resize(5);
    const auto result = query();
    require(result.kind == HpReplyKind::ShortReply && result.received == 5,
            "truncated reply must remain ShortReply after deadline");
    require(sdk::logs.find("HP short reply") != std::string::npos,
            "remote truncation must retain its existing diagnostic");
    one_request();
    require(sdk::now_us == HP_QUERY_TIMEOUT_US, "truncation must not extend the deadline");
}
void corrupt_reply() {
    setup();
    sdk::pending_reply        = golden_i();
    sdk::pending_reply.back() = 0x30;
    const auto result         = query();
    require(result.kind == HpReplyKind::BadCrc && result.received == 12,
            "bad checksum must retain BadCrc");
    require(sdk::logs.find("HP wrong CRC") != std::string::npos, "CRC failure must be logged");
    one_request();
}
void wrong_page() {
    setup();
    sdk::pending_reply        = golden_i();
    sdk::pending_reply[1]     = 0x61;
    sdk::pending_reply.back() = 0x30;
    const auto result         = query();
    require(result.kind == HpReplyKind::UnexpectedReply && result.received == 12,
            "CRC-valid wrong page must remain UnexpectedReply");
    one_request();
}
void invalid_lengths() {
    for (uint8_t length : {uint8_t(0x00), uint8_t(0x3f)}) {
        setup();
        sdk::pending_reply = {0x40, 0x60, length};
        const auto result  = query();
        require(result.kind == HpReplyKind::InvalidLength && result.received == 3,
                "invalid dynamic length must be rejected before bulk read");
        require(sdk::reads == 3 && sdk::cursor == 3, "invalid length must stop at header");
        one_request();
    }
    setup();
    const auto result = query(Protocol::I, HpQueryLogPolicy::All, 0x60, 11);
    require(result.kind == HpReplyKind::InvalidLength && result.received == 0,
            "insufficient caller buffer must be rejected before request");
    require(sdk::flushes == 0 && sdk::writes == 0 && sdk::waits == 0 && sdk::reads == 0,
            "invalid request capacity must never touch the transport");
}
void partial_bulk_reads() {
    setup();
    sdk::pending_reply    = golden_i();
    sdk::partial_bulk_cap = 2;
    const auto result     = query();
    require(result.kind == HpReplyKind::Ok && result.received == 12,
            "short positive reads must accumulate into a valid frame");
    require(sdk::read_sizes == std::vector<int>({1, 1, 1, 9, 7, 5, 3, 1}),
            "every bulk read must ask only for the remaining reply bytes");
    one_request();
}
void noise_deadline() {
    setup();
    sdk::pending_reply.assign(1000, 0x55);
    sdk::positive_read_us = 1000;
    const auto result     = query();
    require(result.kind == HpReplyKind::NoReply && result.received == 0,
            "leading noise must not fabricate a reply");
    require(sdk::now_us == HP_QUERY_TIMEOUT_US && sdk::reads == 300,
            "continuous noise must respect the same absolute deadline");
    one_request();
}
void delayed_reply() {
    setup();
    sdk::pending_reply       = golden_i();
    sdk::initial_empty_reads = 14;
    const auto result        = query();
    require(result.kind == HpReplyKind::Ok && result.received == 12 && sdk::now_us == 280000,
            "a reply arriving within the deadline must succeed");
    one_request();
}
void write_error() {
    setup();
    sdk::pending_reply     = golden_i();
    sdk::withdraw_at_write = true;
    const auto result      = query();
    driver_result(result, "write");
    require(sdk::flushes == 1 && sdk::writes == 1 && sdk::waits == 0 && sdk::reads == 0,
            "failed write must stop before TX wait or RX");
    require(sdk::transmitted == 0 && sdk::requests.empty(), "failed write sent no bytes");
}
void wait_error() {
    for (bool missing : {false, true}) {
        setup();
        sdk::pending_reply    = golden_i();
        sdk::tx_timeout       = !missing;
        sdk::withdraw_at_wait = missing;
        const auto result     = query();
        driver_result(result, "wait");
        require(sdk::flushes == 1 && sdk::writes == 1 && sdk::waits == 1 && sdk::reads == 0,
                "failed TX wait must stop before reply reads");
        one_request();
    }
}
void error_policies() {
    for (const auto policy : {HpQueryLogPolicy::All, HpQueryLogPolicy::IntegrityOnly}) {
        setup();
        sdk::negative_read_call = 1;
        const auto result       = query(Protocol::I, policy);
        driver_result(result, "read");
        require(hp_query_should_log(policy, HpQueryFailure::DriverError),
                "driver faults must remain visible during fingerprint detection");
    }
    setup();
    (void)query(Protocol::I, HpQueryLogPolicy::IntegrityOnly);
    require(sdk::logs.empty(), "expected remote silence must stay quiet in detection");
    sdk::clear_transaction();
    sdk::pending_reply = {0x15, 0xea};
    (void)query(Protocol::I, HpQueryLogPolicy::IntegrityOnly);
    require(sdk::logs.empty(), "expected unsupported-page NAK must stay quiet in detection");
}
void read_recovery() {
    setup();
    sdk::pending_reply      = golden_i();
    sdk::negative_read_call = 1;
    const auto first        = query();
    driver_result(first, "read");
    require(sdk::installed && sdk::requests.size() == 1, "RX mutex timeout need not remove driver");
    sdk::negative_read_call = 0;
    const auto second       = query();
    require(second.kind == HpReplyKind::Ok && second.received == 12,
            "next query must recover after temporary RX mutex failure");
    require(sdk::writes == 2 && sdk::requests.size() == 2 && sdk::flushes == 2,
            "recovery is a new explicit call, never a hidden resend");
}
void legacy_results() {
    setup();
    sdk::pending_reply = golden_i();
    require(hp_query(0x60, Protocol::I, buffer, sizeof(buffer)) == 12,
            "legacy success must remain verified byte count");
    sdk::clear_transaction();
    sdk::pending_reply = {0x15, 0xea};
    require(hp_query(0x60, Protocol::I, buffer, sizeof(buffer)) == -2, "legacy NAK must remain -2");
    sdk::clear_transaction();
    sdk::pending_reply        = golden_i();
    sdk::pending_reply.back() = 0x30;
    require(hp_query(0x60, Protocol::I, buffer, sizeof(buffer)) == -3,
            "legacy CRC failure must remain -3");
    sdk::clear_transaction();
    require(hp_query(0x60, Protocol::I, buffer, sizeof(buffer)) == -1,
            "legacy remote silence must remain -1");
    sdk::clear_transaction();
    sdk::negative_read_call = 1;
    require(hp_query(0x60, Protocol::I, buffer, sizeof(buffer)) == -1,
            "legacy driver error must remain -1");
}
void driver_mapping() {
    require(is_transport_error(HpReplyKind::DriverError),
            "driver errors must count as transport errors");
    require(probe_status_from_reply(HpReplyKind::DriverError) == ProbeStatus::NoLink,
            "driver errors must map to the existing NoLink probe outcome");
    require(!is_transport_error(HpReplyKind::NoReply) && !is_transport_error(HpReplyKind::Rejected),
            "silence and absent pages must not become transport corruption");
    require(probe_status_from_reply(HpReplyKind::NoReply) == ProbeStatus::NoReply,
            "genuine remote silence must stay distinguishable from a local link failure");
}
void install_lifecycle() {
    setup();
    require(sdk::installs == 1, "initial setup installs once");
    require(hp_uart_init(44, 43) && sdk::installs == 1 && sdk::pin_sets == 1,
            "same pins must not reinstall or remap driver");
    require(hp_uart_init(43, 44) && sdk::installs == 1 && sdk::pin_sets == 2 && sdk::flushes == 1,
            "pin remap must preserve the installed driver");
    sdk::pin_fails = true;
    require(!hp_uart_init(44, 43) && sdk::installed && sdk::installs == 1,
            "failed pin remap must not destroy or reinstall driver");
    hp_uart_deinit();
    sdk::pin_fails = false;
    for (int phase : {0, 1, 2}) {
        sdk::param_fails   = phase == 0;
        sdk::pin_fails     = phase == 1;
        sdk::install_fails = phase == 2;
        require(!hp_uart_init(44, 43) && !sdk::installed,
                "failed bringup must never claim a usable installed driver");
    }
    sdk::param_fails = sdk::pin_fails = sdk::install_fails = false;
    require(hp_uart_init(44, 43) && sdk::installed, "later valid bringup must recover");
}
} // namespace

int main(int argc, char** argv) {
    const std::vector<std::pair<std::string, std::function<void()>>> cases{
        {"missing_driver", witness_missing_driver},
        {"header_read_error", witness_header_read},
        {"bulk_read_error", witness_bulk_read},
        {"silence", silence},
        {"protocol_i", protocol_i},
        {"protocol_s", protocol_s},
        {"echoed_frames", echoed_frames},
        {"rejected_frames", rejected_frames},
        {"partial_reply", partial_reply},
        {"corrupt_reply", corrupt_reply},
        {"wrong_page", wrong_page},
        {"invalid_lengths", invalid_lengths},
        {"partial_bulk_reads", partial_bulk_reads},
        {"noise_deadline", noise_deadline},
        {"delayed_reply", delayed_reply},
        {"write_error", write_error},
        {"wait_error", wait_error},
        {"error_policies", error_policies},
        {"read_recovery", read_recovery},
        {"legacy_results", legacy_results},
        {"driver_mapping", driver_mapping},
        {"install_lifecycle", install_lifecycle},
    };
    const std::string selected  = argc > 1 ? argv[1] : "";
    int               completed = 0;
    for (const auto& test : cases) {
        if (!selected.empty() && selected != test.first) continue;
        try {
            test.second();
            std::cout << "PASS " << test.first << '\n';
            ++completed;
        } catch (const std::exception& e) {
            std::cerr << "FAIL " << test.first << ": " << e.what() << '\n';
            return 1;
        }
    }
    if (!completed) return 2;
    std::cout << "PASS total=" << completed << '\n';
    return 0;
}
