from pathlib import Path
import shutil
import subprocess
import tarfile

# Review-only harness. Production function bodies are copied verbatim from the reviewed tree;
# only ESP-IDF I/O, the scheduler and allocation failures are simulated. No live I/O.
checkout = Path.cwd()
out = Path('/tmp/daikin-project-review-2026-09-08-cbcc043f')
out.mkdir(parents=True, exist_ok=True)
reviewed_commit = 'd5fc344a191861ea3979635ad883fb0fc019a4c6'
repo = out / 'reviewed-source'
if repo.exists():
    shutil.rmtree(repo)
repo.mkdir()
archive = out / 'reviewed-source.tar'
with archive.open('wb') as stream:
    subprocess.run(
        ['git', 'archive', '--format=tar', reviewed_commit],
        cwd=checkout,
        stdout=stream,
        check=True,
    )
with tarfile.open(archive) as source:
    source.extractall(repo)
archive.unlink()

def extract(path, start, end):
    text = (repo / path).read_text()
    return text[text.index(start):text.index(end, text.index(start))]

prefix = r'''
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
#include <vector>
#include "config.hpp"
#include "logic/config_store.hpp"
#include "logic/convert.hpp"
#include "def/signatures.hpp"
#include "hp_comm.hpp"
#include "hp_convert.hpp"
static bool fail_alloc = false;
void* operator new(std::size_t n) {
    if (fail_alloc) throw std::bad_alloc();
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void* operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
struct Lock { explicit Lock(int) {} };
void diag_printf(const char*, ...) {}
using esp_err_t = int;
constexpr int ESP_OK = 0;
const char* esp_err_to_name(int) { return "mock"; }
namespace daik {
static Config g_cfg;
static int g_mtx = 0;
static const char* fail_after_nvs_key = nullptr;
static std::vector<uint8_t> stored_cfg;
static int cfg_writes = 0, link_writes = 0;
int nvs_set_blob(const char* key, const void* bytes, std::size_t size) {
    if (std::strcmp(key, "cfg") == 0) {
        const auto* p = static_cast<const uint8_t*>(bytes);
        stored_cfg.assign(p, p + size);
        ++cfg_writes;
    } else ++link_writes;
    if (fail_after_nvs_key && std::strcmp(key, fail_after_nvs_key) == 0) fail_alloc = true;
    return ESP_OK;
}
'''
source = prefix
source += extract('main/config.cpp', 'static uint32_t next_revision(', '\nstatic void publish(const Config& c)')
source += extract('main/config.cpp', 'bool config_save(', '\n// ── Field-owned commits')
source += r'''
static const int PORT = 1, s_rx = 44, s_tx = 43;
static uint8_t uart_reply[20] = {0x40, 0x20, 0x12, 0x6d, 0x00, 0x4d, 0x00};
static int uart_pos = 0;
static uint8_t requested_reg = 0;
int pdMS_TO_TICKS(int n) { return n; }
void uart_flush_input(int) { uart_pos = 20; } // currently received input is empty
void uart_write_bytes(int, const char* p, int) {
    requested_reg = static_cast<uint8_t>(p[2]);
    uart_pos = 0; // the delayed old reply arrives only AFTER flush and the new request
}
int uart_read_bytes(int, uint8_t* p, int, int) {
    if (uart_pos >= 20) return 0;
    *p = uart_reply[uart_pos++]; return 1;
}
int64_t esp_timer_get_time() { static int64_t tick=0; return ++tick; }
'''
source += extract('main/hp_comm.cpp', 'int hp_query(', '\n} // namespace daik')
source += r'''
} // namespace daik
namespace weather_witness {
using daik::Config;
constexpr std::size_t kPayloadMax = 8192;
constexpr int kHttpTimeoutMs = 20000;
struct HttpClientProbe {};
HttpClientProbe http_client_probe() { return {}; }
struct esp_http_client_config_t { const char* url{}; int timeout_ms{}; void* crt_bundle_attach{}; bool keep_alive_enable{}; };
using esp_http_client_handle_t = void*;
void* esp_crt_bundle_attach = nullptr;
static int opened = 0, closed = 0, cleaned = 0;
std::string open_meteo_url(const Config&) { return "https://weather.invalid/"; }
void* esp_http_client_init(const esp_http_client_config_t*) { return &opened; }
void http_client_log_init_failure(const char*, HttpClientProbe) {}
void http_client_log_open_failure(const char*, void*, int, HttpClientProbe) {}
void esp_http_client_set_header(void*, const char*, const char*) {}
int esp_http_client_open(void*, int) { ++opened; fail_alloc = true; return 0; }
int esp_http_client_fetch_headers(void*) { return 4096; }
int esp_http_client_get_status_code(void*) { return 200; }
int64_t esp_http_client_get_content_length(void*) { return 4096; }
int esp_http_client_read(void*, char*, std::size_t) { return 0; }
void esp_http_client_close(void*) { ++closed; }
void esp_http_client_cleanup(void*) { ++cleaned; }
'''
source += extract('main/weather_forecast.cpp', 'bool download_json(', '\nbool json_number_array(')
source += r'''
} // namespace weather_witness
namespace ota_witness {
struct Status { std::string state, message; };
static Status s_status;
static int s_mtx = 0;
static bool s_busy = true, task_deleted = false;
constexpr int kNetworkQuiesceLead = 0;
constexpr char kUpdateDowngradeMode = 2;
struct OtaNetworkFlag {};
void vTaskDelay(int) {}
void vTaskDelete(void*) { task_deleted = true; }
bool wait_for_poll_quiesce() { return true; }
bool wait_for_weather_quiesce() { return true; }
void run_check() { fail_alloc = true; throw std::bad_alloc(); }
void run_update(bool) { run_check(); }
'''
source += extract('main/ota_update.cpp', 'void set_state(', '\nvoid set_progress(')
source += extract('main/ota_update.cpp', 'void ota_task(', '\n// Spawn the single OTA task')
source += r'''
} // namespace ota_witness
int main() {
    using namespace daik;
    for (const char* fail_key : {"cfg", "link"}) {
        g_cfg = Config{};
        g_cfg.wifi_ssid = "old-example-network-name-for-review";
        Config requested = g_cfg;
        requested.wifi_ssid = "new-example-network-name-for-review";
        fail_after_nvs_key = fail_key;
        cfg_writes = link_writes = 0;
        bool escaped = false;
        try { config_save(requested, false); } catch (const std::bad_alloc&) { escaped = true; }
        fail_alloc = false;
        ConfigBlob restored;
        bool decoded = config_blob_deserialize(stored_cfg.data(), stored_cfg.size(), restored);
        std::printf("config fail-after=%s threw=%d cfg_writes=%d link_writes=%d decoded=%d RAM=%s FLASH=%s\n",
          fail_key, escaped, cfg_writes, link_writes, decoded, g_cfg.wifi_ssid.c_str(), restored.wifi_ssid.c_str());
        if (!escaped || !decoded || restored.wifi_ssid != requested.wifi_ssid || g_cfg.wifi_ssid == requested.wifi_ssid) return 1;
    }
    fail_after_nvs_key = nullptr;
    std::string payload, error;
    try { weather_witness::download_json(g_cfg, payload, error); } catch (const std::bad_alloc&) {}
    fail_alloc = false;
    std::printf("weather opened=%d closed=%d cleaned=%d\n", weather_witness::opened, weather_witness::closed, weather_witness::cleaned);
    if (weather_witness::opened != 1 || weather_witness::cleaned != 0) return 2;
    bool ota_escaped = false;
    try { ota_witness::ota_task(nullptr); } catch (const std::bad_alloc&) { ota_escaped = true; }
    fail_alloc = false;
    std::printf("ota exception_escaped_task=%d busy=%d task_deleted=%d\n", ota_escaped, ota_witness::s_busy, ota_witness::task_deleted);
    if (!ota_escaped) return 3;
    uart_reply[19] = crc(uart_reply, 19);
    uint8_t received[64] = {};
    const int received_len = hp_query(0x61, Protocol::I, received, sizeof(received));
    const auto& profile = def::lookup("altherma_ebla_edla_d_series_4_8kw_monobloc");
    const ValueDef* lwt = nullptr;
    for (std::size_t i = 0; i < profile.count; ++i)
        if (profile.values[i].reg == 0x61 && profile.values[i].offset == 2)
            lwt = &profile.values[i];
    if (!lwt) return 5;
    const Reading wrong = convert(*lwt, received + 3 + lwt->offset);
    std::printf("uart requested=0x%02x reply_reg=0x%02x accepted_len=%d crc=%d wrong_LWT=%.1f wire=", requested_reg, received[1], received_len, crc_ok(received, received_len), wrong.value);
    for (auto b : uart_reply) std::printf("%02x ", b);
    std::printf("\n");
    if (received_len != 20 || wrong.value != 7.7) return 4;
    std::string formatted;
    bool format_ok = hp_format(*lwt, received + 3, received_len - 4, 802, formatted, profile.values, profile.count);
    std::printf("uart production_formatter_ok=%d publish_value=%s\n", format_ok, formatted.c_str());
    if (!format_ok || formatted != "7.7") return 6;
    int nsig = 0;
    const Signature* sigs = def::signatures(nsig);
    for (uint32_t mask : {0x1bffu, 0x13ffu, 0x0bffu}) {
        Fingerprint fp{}; fp.page_mask = mask; fp.kw_tenths = 80;
        const char* best = detect_best(sigs, nsig, fp);
        std::printf("detect mask=0x%04x capacity=80 best=%s\n", mask, best ? best : "null");
    }
    for (uint8_t raw : {uint8_t(0x01), uint8_t(0x09), uint8_t(0x05)}) {
        const ValueDef mode{0x64,2,316,1,-1,"Hybrid Op. Mode"};
        const ValueDef demand{0x64,2,303,1,-1,"Boiler Operation Demand"};
        std::printf("hybrid raw=0x%02x mode=%s boiler_demand=%.0f\n", raw, convert(mode,&raw).text, convert(demand,&raw).value);
    }
}
'''
(out / 'reproduce_review.cpp').write_text(source)
subprocess.run(['c++', '-std=c++17', '-I' + str(repo / 'main'), str(out / 'reproduce_review.cpp'), str(repo / 'main/hp_convert.cpp'), '-o', str(out / 'reproduce_review')], check=True)
print(f'reviewed_commit={reviewed_commit}', flush=True)
subprocess.run([str(out / 'reproduce_review')], check=True)
