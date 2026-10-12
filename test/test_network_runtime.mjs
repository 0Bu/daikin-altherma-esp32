// Run complete production WiFi/syslog TUs, then remove targeted defenses in temporary sources.
// SDK adapters control event delivery, retained netif state, queue capacity and socket acceptance.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  wifi: path.join(root, "main/wifi.cpp"),
  syslog: path.join(root, "main/syslog.cpp"),
  timestamp: path.join(root, "main/logic/timestamp.hpp"),
};
const sources = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "daikin-network-runtime-"));
function execute(command, args, timeout = 30000) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command}: terminated\n${result.stdout}${result.stderr}`);
  return result;
}
function compile(name, overrides = {}) {
  const production = { ...files, ...overrides };
  const binary = path.join(dir, name);
  const result = execute(process.env.CXX || "c++", [
    "-std=c++17", "-Wall", "-Wextra", "-Werror",
    `-DWIFI_PRODUCTION_SOURCE=${JSON.stringify(production.wifi)}`,
    `-DSYSLOG_PRODUCTION_SOURCE=${JSON.stringify(production.syslog)}`,
    `-I${path.join(root, "test/network_runtime/stubs")}`,
    `-I${path.join(root, "main")}`, path.join(root, "test/network_runtime/fixture.cpp"), "-o", binary,
  ]);
  assert.equal(result.status, 0, `${name}: complete TUs must compile\n${result.stdout}${result.stderr}`);
  return binary;
}
function mutate(mutation) {
  const source = sources[mutation.file];
  const matches = typeof mutation.before === "string" ? source.split(mutation.before).length - 1
    : [...source.matchAll(new RegExp(mutation.before.source, mutation.before.flags + "g"))].length;
  assert.equal(matches, 1, `${mutation.name}: unique source anchor required`);
  const mutated = path.join(dir, `${mutation.name}.${mutation.file === "timestamp" ? "hpp" : "cpp"}`);
  fs.writeFileSync(mutated, source.replace(mutation.before, mutation.after));
  if (mutation.secondaryBefore) {
    assert.equal(source.split(mutation.secondaryBefore).length - 1, 1,
      `${mutation.name}: unique secondary defense anchor required`);
    fs.writeFileSync(mutated, fs.readFileSync(mutated, "utf8").replace(mutation.secondaryBefore, mutation.secondaryAfter));
  }
  if (mutation.file !== "timestamp") return { [mutation.file]: mutated };
  // Quoted includes from an original TU search its own directory first: bind the mutated header
  // explicitly rather than accidentally compiling the unmodified production timestamp helper.
  const syslog = path.join(dir, `${mutation.name}-syslog.cpp`);
  fs.writeFileSync(syslog, sources.syslog.replace('"logic/timestamp.hpp"', JSON.stringify(mutated)));
  return { syslog };
}
const mutations = [
  {
    name: "status-mutex-heap-allocation", file: "syslog", scenario: "status_mutex_failure",
    before: "static SemaphoreHandle_t s_status_mtx = xSemaphoreCreateMutexStatic(&s_status_mtx_storage);",
    after: "static SemaphoreHandle_t s_status_mtx = xSemaphoreCreateMutexStatic(&s_status_mtx_storage);",
    secondaryBefore: "void syslog_init() {",
    secondaryAfter: "void syslog_init() {\n    s_status_mtx = xSemaphoreCreateMutex();",
  },
  {
    name: "scan-record-capacity", file: "wifi", scenario: "scan_failure",
    before: /uint16_t\s+n = 20;/, after: "uint16_t n = 0;",
  },
  {
    name: "scan-record-result", file: "wifi", scenario: "scan_failure",
    before: "if (e == ESP_OK) e = esp_wifi_scan_get_ap_records(&n, recs);",
    after: "if (e == ESP_OK) esp_wifi_scan_get_ap_records(&n, recs);",
  },
  {
    name: "scan-list-cleanup", file: "wifi", scenario: "scan_failure",
    before: "(void)esp_wifi_clear_ap_list();", after: "/* mutation: leave the driver scan list pending */",
  },
  {
    name: "lost-ip-subscription", file: "wifi", scenario: "lost_lease",
    before: "esp_event_handler_instance_register(IP_EVENT, ESP_EVENT_ANY_ID, on_wifi, nullptr, &s_h_ip);",
    after: "esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, nullptr, &s_h_ip);",
  },
  {
    name: "disconnect-wake-withdrawal", file: "wifi", scenario: "disconnect_retry",
    before: "s_wifi_connected = false;\n        xEventGroupClearBits(s_events, CONNECTED_BIT);",
    after: "s_wifi_connected = false; /* mutation: retain stale wake */",
  },
  {
    name: "foreign-netif", file: "wifi", scenario: "foreign_ip",
    before: "if (!e || e->esp_netif != s_sta_netif) return;", after: "if (!e) return;",
  },
  {
    name: "cached-netif", file: "wifi", scenario: "lost_lease",
    before: "if (s_wifi_connected && s_sta_netif && esp_netif_get_ip_info",
    after: "if (s_sta_netif && esp_netif_get_ip_info",
  },
  {
    name: "snapshot-withdrawal", file: "wifi", scenario: "snapshot_loss",
    before: "if (!s_wifi_connected || s_reconnects != lease) info = WifiInfo{};",
    after: "(void)lease; /* mutation: publish a withdrawn lease */",
  },
  {
    name: "snapshot-generation", file: "wifi", scenario: "snapshot_reacquisition",
    before: "if (!s_wifi_connected || s_reconnects != lease) info = WifiInfo{};",
    after: "(void)lease; if (!s_wifi_connected) info = WifiInfo{};",
  },
  {
    name: "current-boot-lease", file: "wifi", scenario: "stale_boot_wake",
    before: "wifi_boot_wake_connected(bits & CONNECTED_BIT, s_wifi_connected)",
    after: "wifi_boot_wake_connected(bits & CONNECTED_BIT, true)",
  },
  {
    name: "boot-window-remainder", file: "wifi", scenario: "stale_boot_timeout",
    before: "waited < window_ticks ? window_ticks - waited : 0", after: "((void)waited, window_ticks)",
  },
  {
    name: "known-good-retries", file: "wifi", scenario: "disconnect_retry",
    before: "if (!s_wifi_ever_connected && s_retry_num >= MAX_RETRY && !s_rollback_pending)",
    after: "if (s_retry_num >= MAX_RETRY && !s_rollback_pending)",
  },
  {
    name: "enqueue-accounting", file: "syslog", scenario: "queue_rejection",
    before: "if (xQueueSend(s_queue, &m, 0) != pdTRUE)", after: "if ((xQueueSend(s_queue, &m, 0), false))",
  },
  {
    name: "enqueue-status", file: "syslog", scenario: "queue_rejection",
    before: "copy.queue_dropped = s_queue_dropped.load(std::memory_order_relaxed);",
    after: "/* mutation: hide observed queue rejection */",
  },
  {
    name: "reentrant-loop-guard", file: "syslog", scenario: "reentrant_suppression",
    before: 'if (sv.find("syslog:") != std::string_view::npos)',
    after: 'if ((static_cast<void>(sv.find("syslog:")), false))',
  },
  {
    name: "counter-saturation", file: "syslog", scenario: "queue_saturation",
    before: "while (dropped != UINT32_MAX &&", after: "while (",
  },
  {
    // The exact-width check independently rejects year10000 too. Remove both paired defenses
    // for this profile negative control; conversion failure remains a separate one-guard test.
    name: "timestamp-profile-defense", file: "timestamp", scenario: "timestamp_framing",
    before: 'if (tm_utc.tm_year > 8099) return "";',
    after: "/* paired mutation: omit the explicit year bound */",
    secondaryBefore: 'if (n != 24) return "";',
    secondaryAfter: '(void)n; /* paired mutation: accept a truncated non-profile result */',
  },
  {
    name: "timestamp-conversion", file: "timestamp", scenario: "timestamp_framing",
    before: 'if (!gmtime_r(&t, &tm_utc)) return "";', after: "gmtime_r(&t, &tm_utc);",
  },
];
try {
  const binary = compile("production");
  const baseline = execute(binary, []);
  assert.equal(baseline.status, 0, `${baseline.stdout}${baseline.stderr}`);
  assert.match(baseline.stdout, /PASS total=16\b/);
  console.log(baseline.stdout.trim());
  for (const mutation of mutations) {
    const result = execute(compile(mutation.name, mutate(mutation)), [mutation.scenario]);
    assert.equal(result.status, 1, `${mutation.name}: oracle must reject mutation\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^FAIL ${mutation.scenario}:`, "m"));
    console.log(`negative control ${mutation.name}: rejected by ${mutation.scenario}`);
  }
  for (const [key, source] of Object.entries(sources)) {
    console.log(`network runtime ${key} sha256=${createHash("sha256").update(source).digest("hex")}`);
  }
  console.log(`production network runtime: 16 cases, ${mutations.length} negative controls`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
