#pragma once
// Deterministic event, queue and SDK adapters for the complete production WiFi/syslog TUs.
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <functional>
#include <stdexcept>
#include <vector>
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

using esp_err_t            = int;
constexpr esp_err_t ESP_OK = 0, ESP_FAIL = -1, ESP_ERR_WIFI_NOT_INIT = -10;
inline const char*  esp_err_to_name(esp_err_t) { return "fake error"; }
#define ESP_ERROR_CHECK(x)                                                                         \
    do {                                                                                           \
        if ((x) != ESP_OK) throw std::runtime_error("SDK failure");                                \
    } while (0)
#define CONFIG_DAIKIN_HOSTNAME "daikin-altherma-esp32"
#define ESP_LOGI(tag, ...) ((void)(tag))
#define ESP_LOGW(tag, ...) ((void)(tag))
#define ESP_LOGE(tag, ...) ((void)(tag))
using TickType_t            = uint32_t;
using BaseType_t            = int;
using UBaseType_t           = unsigned;
constexpr BaseType_t pdTRUE = 1, pdFALSE = 0, pdPASS = 1;
constexpr TickType_t portMAX_DELAY = UINT32_MAX;
#define pdMS_TO_TICKS(x) (static_cast<TickType_t>(x))
#define BIT0 1
#define BIT1 2
using EventBits_t = uint32_t;
struct FakeEvents {
    EventBits_t bits = 0;
};
using EventGroupHandle_t = FakeEvents*;
struct FakeSemaphore {
    bool held = false;
};
using SemaphoreHandle_t = FakeSemaphore*;
using StaticSemaphore_t = FakeSemaphore;
struct FakeTask {
    void (*fn)(void*);
    void* arg;
};
using TaskHandle_t = FakeTask*;
struct FakeQueue {
    std::array<std::array<uint8_t, 320>, 32> rows{};
    size_t                                   item_size = 0, head = 0, count = 0;
};
using QueueHandle_t                          = FakeQueue*;
using esp_event_base_t                       = const char*;
inline constexpr esp_event_base_t WIFI_EVENT = "wifi", IP_EVENT = "ip";
constexpr int                     ESP_EVENT_ANY_ID     = -1;
constexpr int                     WIFI_EVENT_STA_START = 1, WIFI_EVENT_STA_CONNECTED = 2,
              WIFI_EVENT_STA_DISCONNECTED = 3;
constexpr int IP_EVENT_STA_GOT_IP = 10, IP_EVENT_STA_LOST_IP = 11, IP_EVENT_ETH_GOT_IP = 12,
              IP_EVENT_ETH_LOST_IP = 13;
struct FakeHandler {
    esp_event_base_t base;
    int              id;
    void (*fn)(void*, esp_event_base_t, int32_t, void*);
    void* arg;
};
using esp_event_handler_instance_t = FakeHandler*;
struct esp_ip4_addr_t {
    uint32_t addr = 0;
};
using ip4_addr_t = esp_ip4_addr_t;
struct esp_netif_ip_info_t {
    esp_ip4_addr_t ip, netmask, gw;
};
struct esp_netif_t {
    esp_netif_ip_info_t ip;
};
struct ip_event_got_ip_t {
    esp_netif_t*        esp_netif;
    esp_netif_ip_info_t ip_info;
};
struct wifi_event_sta_disconnected_t {
    int reason = 0;
    int rssi   = -60;
};
struct wifi_ap_record_t {
    uint8_t ssid[33] = {}, bssid[6] = {};
    int8_t  rssi     = -45;
    bool    phy_11ax = false, phy_11ac = false, phy_11n = true, phy_11g = false, phy_11b = false;
};
struct wifi_init_config_t {
    bool nvs_enable = true;
};
#define WIFI_INIT_CONFIG_DEFAULT()                                                                 \
    wifi_init_config_t {}
struct wifi_config_t {
    struct {
        uint8_t ssid[32] = {}, password[64] = {};
        int     scan_method = 0, sort_method = 0, failure_retry_cnt = 0, sae_pwe_h2e = 0;
        struct {
            bool capable = false, required = false;
        } pmf_cfg;
    } sta;
};
struct wifi_scan_config_t {};
constexpr int WIFI_STORAGE_RAM = 0, WIFI_STORAGE_FLASH = 1, WIFI_ALL_CHANNEL_SCAN = 1,
              WIFI_CONNECT_AP_BY_SIGNAL = 1, WPA3_SAE_PWE_BOTH = 3, WIFI_MODE_STA = 1,
              WIFI_IF_STA = 0, WIFI_PS_NONE = 0, ESP_MAC_WIFI_STA = 0;
#define IPSTR "%u.%u.%u.%u"
#define IP2STR(p)                                                                                  \
    static_cast<unsigned>((p)->addr & 255), static_cast<unsigned>(((p)->addr >> 8) & 255),         \
        static_cast<unsigned>(((p)->addr >> 16) & 255),                                            \
        static_cast<unsigned>(((p)->addr >> 24) & 255)
struct ip_addr_t {
    int type = 0;
    struct {
        ip4_addr_t ip4;
    } u_addr;
};
constexpr int IPADDR_TYPE_V4 = 0;
inline int    ipaddr_aton(const char* text, ip_addr_t* ip) {
    return inet_pton(AF_INET, text, &ip->u_addr.ip4.addr);
}
struct netif {
    ip_addr_t netmask, ip_addr;
};
inline netif* netif_default = nullptr;
struct eth_addr {};
inline int etharp_find_addr(netif*, const ip4_addr_t*, eth_addr**, const ip4_addr_t**) {
    return -1;
}
using esp_ping_handle_t = void*;
struct esp_ping_config_t {
    ip_addr_t target_addr;
    int       count = 0, timeout_ms = 0, interval_ms = 0;
};
struct esp_ping_callbacks_t {
    void* cb_args                                 = nullptr;
    void (*on_ping_end)(esp_ping_handle_t, void*) = nullptr;
};
#define ESP_PING_DEFAULT_CONFIG()                                                                  \
    esp_ping_config_t {}
constexpr int ESP_PING_PROF_REPLY = 0;
inline int    esp_ping_new_session(const esp_ping_config_t*, const esp_ping_callbacks_t*,
                                   esp_ping_handle_t*) {
    return -1;
}
inline int esp_ping_get_profile(esp_ping_handle_t, int, void*, size_t) { return -1; }
inline int esp_ping_start(esp_ping_handle_t) { return 0; }
inline int esp_ping_stop(esp_ping_handle_t) { return 0; }
inline int esp_ping_delete_session(esp_ping_handle_t) { return 0; }
struct esp_app_desc_t {
    const char* version = "runtime-test";
};
inline const esp_app_desc_t* esp_app_get_description() {
    static esp_app_desc_t app;
    return &app;
}
inline int esp_app_get_elf_sha256(char* out, size_t size) {
    std::snprintf(out, size, "runtime-elf");
    return 0;
}

namespace sdk {
inline TickType_t ticks    = 0;
inline int        connects = 0, restarts = 0, mdns_starts = 0, netif_reads = 0, ap_reads = 0,
           queue_sends = 0, lock_depth = 0;
inline bool                        forbid_alloc = false, queue_reject = false;
inline bool                        fail_dynamic_mutex      = false;
inline unsigned                    dynamic_mutex_creations = 0;
inline uint16_t                    scan_count              = 0;
inline esp_err_t                   scan_start_result = ESP_OK, scan_records_result = ESP_OK;
inline unsigned                    scan_record_reads = 0;
inline unsigned                    scan_clears       = 0;
inline bool                        scan_pending      = false;
inline std::vector<FakeHandler*>   handlers;
inline std::vector<FakeEvents*>    events;
inline std::vector<FakeSemaphore*> semaphores;
inline std::vector<FakeTask*>      tasks;
inline std::vector<FakeQueue*>     queues;
inline std::vector<esp_netif_t*>   netifs;
inline std::function<void()>       on_start, on_netif_read, on_ap_read;
inline std::function<EventBits_t(FakeEvents*, TickType_t)> on_wait;
inline std::function<void(TickType_t)>                     on_delay;
inline std::function<void(TickType_t)>                     on_queue_receive;
inline std::vector<TickType_t>                             wait_budgets;
inline std::vector<std::string>                            packets;
inline bool                                                fail_send = false;
inline int                                                 udp_socket(int, int, int) { return 100; }
inline ssize_t udp_sendto(int, const void* data, size_t size, int, const sockaddr*, socklen_t) {
    if (fail_send) {
        errno = EAGAIN;
        return -1;
    }
    packets.emplace_back(static_cast<const char*>(data), size);
    return static_cast<ssize_t>(size);
}
inline int  udp_close(int) { return 0; }
inline void emit(esp_event_base_t base, int32_t id, void* data = nullptr) {
    for (auto* h : handlers)
        if (h->base == base && (h->id == id || h->id == ESP_EVENT_ANY_ID))
            h->fn(h->arg, base, id, data);
}
} // namespace sdk
inline EventGroupHandle_t xEventGroupCreate() {
    auto* p = new FakeEvents;
    sdk::events.push_back(p);
    return p;
}
inline EventBits_t xEventGroupSetBits(EventGroupHandle_t p, EventBits_t b) { return p->bits |= b; }
inline EventBits_t xEventGroupClearBits(EventGroupHandle_t p, EventBits_t b) {
    auto old = p->bits;
    p->bits &= ~b;
    return old;
}
inline void        vEventGroupDelete(EventGroupHandle_t) {}
inline EventBits_t xEventGroupWaitBits(EventGroupHandle_t p, EventBits_t b, int, int,
                                       TickType_t timeout) {
    sdk::wait_budgets.push_back(timeout);
    if (sdk::on_wait) return sdk::on_wait(p, timeout);
    if (!(p->bits & b)) sdk::ticks += timeout;
    return p->bits;
}
inline TickType_t xTaskGetTickCount() { return sdk::ticks; }
inline void       vTaskDelay(TickType_t ticks) {
    sdk::ticks += ticks;
    if (sdk::on_delay) sdk::on_delay(ticks);
}
inline void       vTaskDelete(TaskHandle_t) {}
inline BaseType_t xTaskCreate(void (*fn)(void*), const char*, unsigned, void* arg, unsigned,
                              TaskHandle_t* out) {
    auto* t = new FakeTask{fn, arg};
    sdk::tasks.push_back(t);
    if (out) *out = t;
    return pdPASS;
}
inline SemaphoreHandle_t xSemaphoreCreateMutex() {
    ++sdk::dynamic_mutex_creations;
    if (sdk::fail_dynamic_mutex) return nullptr;
    auto* p = new FakeSemaphore;
    sdk::semaphores.push_back(p);
    return p;
}
inline SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t* storage) {
    *storage = {};
    return storage;
}
inline SemaphoreHandle_t xSemaphoreCreateBinary() {
    auto* p = new FakeSemaphore;
    sdk::semaphores.push_back(p);
    return p;
}
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t p, TickType_t) {
    if (!p) return 0;
    p->held = true;
    ++sdk::lock_depth;
    return pdTRUE;
}
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t p) {
    p->held = false;
    --sdk::lock_depth;
    return pdTRUE;
}
inline QueueHandle_t xQueueCreate(unsigned count, unsigned size) {
    if (count > 32 || size > 320) throw std::runtime_error("queue exceeds adapter bounds");
    auto* q      = new FakeQueue;
    q->item_size = size;
    sdk::queues.push_back(q);
    return q;
}
inline BaseType_t xQueueSend(QueueHandle_t q, const void* row, TickType_t timeout) {
    if (timeout != 0) throw std::runtime_error("blocking enqueue");
    ++sdk::queue_sends;
    if (sdk::queue_reject || q->count == 32) return pdFALSE;
    std::memcpy(q->rows[(q->head + q->count++) % 32].data(), row, q->item_size);
    return pdTRUE;
}
inline BaseType_t xQueueReceive(QueueHandle_t q, void* row, TickType_t timeout) {
    if (sdk::on_queue_receive) sdk::on_queue_receive(timeout);
    if (!q->count) {
        sdk::ticks += timeout;
        return pdFALSE;
    }
    std::memcpy(row, q->rows[q->head].data(), q->item_size);
    q->head = (q->head + 1) % 32;
    --q->count;
    return pdTRUE;
}
inline esp_err_t esp_event_handler_instance_register(esp_event_base_t b, int id,
                                                     void (*fn)(void*, esp_event_base_t, int32_t,
                                                                void*),
                                                     void* arg, esp_event_handler_instance_t* out) {
    auto* h = new FakeHandler{b, id, fn, arg};
    sdk::handlers.push_back(h);
    *out = h;
    return ESP_OK;
}
inline esp_err_t esp_event_handler_instance_unregister(esp_event_base_t b, int id,
                                                       esp_event_handler_instance_t h) {
    if (h->base != b || h->id != id) throw std::runtime_error("unregister mismatch");
    for (auto it = sdk::handlers.begin(); it != sdk::handlers.end(); ++it)
        if (*it == h) {
            sdk::handlers.erase(it);
            delete h;
            break;
        }
    return ESP_OK;
}
inline esp_netif_t* esp_netif_create_default_wifi_sta() {
    auto* p = new esp_netif_t;
    sdk::netifs.push_back(p);
    return p;
}
inline void      esp_netif_destroy_default_wifi(esp_netif_t*) {}
inline esp_err_t esp_netif_set_hostname(esp_netif_t*, const char*) { return ESP_OK; }
inline esp_err_t esp_netif_get_ip_info(esp_netif_t* p, esp_netif_ip_info_t* out) {
    ++sdk::netif_reads;
    *out = p->ip;
    if (sdk::on_netif_read) sdk::on_netif_read();
    return ESP_OK;
}
inline const char* esp_ip4addr_ntoa(const esp_ip4_addr_t* ip, char* out, int size) {
    std::snprintf(out, size, IPSTR, IP2STR(ip));
    return out;
}
inline esp_err_t esp_read_mac(uint8_t* out, int) {
    const uint8_t mac[6] = {2, 1, 2, 3, 4, 5};
    std::memcpy(out, mac, 6);
    return ESP_OK;
}
inline esp_err_t esp_wifi_connect() {
    ++sdk::connects;
    return ESP_OK;
}
inline esp_err_t esp_wifi_disconnect() {
    sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED);
    return ESP_OK;
}
inline esp_err_t esp_wifi_init(const wifi_init_config_t*) { return ESP_OK; }
inline esp_err_t esp_wifi_set_storage(int) { return ESP_OK; }
inline esp_err_t esp_wifi_set_mode(int) { return ESP_OK; }
inline esp_err_t esp_wifi_set_config(int, const wifi_config_t*) { return ESP_OK; }
inline esp_err_t esp_wifi_set_ps(int) { return ESP_OK; }
inline esp_err_t esp_wifi_start() {
    sdk::emit(WIFI_EVENT, WIFI_EVENT_STA_START);
    if (sdk::on_start) sdk::on_start();
    return ESP_OK;
}
inline esp_err_t esp_wifi_stop() { return ESP_OK; }
inline esp_err_t esp_wifi_deinit() { return ESP_OK; }
inline esp_err_t esp_wifi_restore() { return ESP_OK; }
inline esp_err_t esp_wifi_scan_start(const wifi_scan_config_t*, bool) {
    sdk::scan_pending = true; // even a timeout can leave a partial driver-owned scan list
    return sdk::scan_start_result;
}
inline esp_err_t esp_wifi_scan_get_ap_records(uint16_t* n, wifi_ap_record_t* records) {
    ++sdk::scan_record_reads;
    *n = *n > sdk::scan_count ? sdk::scan_count : *n;
    for (uint16_t i = 0; i < *n; ++i) {
        records[i] = wifi_ap_record_t{};
        std::snprintf(reinterpret_cast<char*>(records[i].ssid), sizeof(records[i].ssid), "%s",
                      i ? "fallback" : "test-wifi");
        records[i].rssi = -40 - i;
    }
    // Error responses deliberately leave plausible output: only ESP_OK attests its validity.
    if (sdk::scan_records_result == ESP_OK) sdk::scan_pending = false;
    return sdk::scan_records_result;
}
inline esp_err_t esp_wifi_clear_ap_list() {
    ++sdk::scan_clears;
    sdk::scan_pending = false;
    return ESP_OK;
}
inline esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t* p) {
    ++sdk::ap_reads;
    *p = wifi_ap_record_t{};
    if (sdk::on_ap_read) sdk::on_ap_read();
    return ESP_OK;
}
struct RestartRequest : std::exception {};
inline void esp_restart() {
    ++sdk::restarts;
    throw RestartRequest{}; // the production SDK never returns from a requested reboot
}
