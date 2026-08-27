// Persistence/privacy source boundary: one config authority, serialized factory erasure, and
// generation-safe X10A identity publication. Pure host tests cannot observe these IDF call sites.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (rel) => read(rel).split("\n")
  .filter((line) => !line.trim().startsWith("//")).join("\n");

const wifi = code("main/wifi.cpp");
const staStart = wifi.slice(wifi.indexOf("bool wifi_start_sta()"),
                            wifi.indexOf("esp_err_t wifi_forget_persisted_config()"));
assert.ok(staStart.indexOf("esp_wifi_init(&ic)") < staStart.indexOf("WIFI_STORAGE_RAM") &&
          staStart.indexOf("WIFI_STORAGE_RAM") < staStart.indexOf("esp_wifi_set_config("),
  "STA credentials must be configured only after selecting RAM-only WiFi storage");

const provisioning = code("main/provisioning.cpp");
assert.ok(provisioning.indexOf("esp_wifi_init(&ic)") < provisioning.indexOf("WIFI_STORAGE_RAM") &&
          provisioning.indexOf("WIFI_STORAGE_RAM") < provisioning.indexOf("esp_wifi_set_config("),
  "the setup AP must also avoid IDF's default FLASH-backed configuration");
assert.match(wifi, /wifi_forget_persisted_config\([\s\S]*?WIFI_STORAGE_FLASH[\s\S]*?esp_wifi_restore\(\)/,
  "factory reset must erase legacy WiFi-driver persistent settings, including Ethernet-only boots");

const nvs = code("main/nvs_storage.cpp");
for (const setter of ["nvs_set_str", "nvs_set_i32", "nvs_set_blob"]) {
  const at = nvs.indexOf(`esp_err_t ${setter}(`);
  const next = nvs.indexOf("\nesp_err_t ", at + 1);
  const body = nvs.slice(at, next < 0 ? nvs.length : next);
  assert.match(body, /Lock lk\(s_write_mtx\)[\s\S]*?s_writes_disabled\.load[\s\S]*?nvs_open/,
    `${setter} must serialize with and fail behind the factory-reset latch`);
}
const erase = nvs.slice(nvs.indexOf("esp_err_t nvs_erase_all()"),
                        nvs.indexOf("bool nvs_get_blob", nvs.indexOf("esp_err_t nvs_erase_all()")));
assert.ok(erase.indexOf("Lock lk(s_write_mtx)") < erase.indexOf("s_writes_disabled.store(true") &&
          erase.indexOf("s_writes_disabled.store(true") < erase.indexOf("nvs_open("),
  "factory erase must wait out old writers and latch new writers before opening NVS");
const main = code("main/main.cpp");
assert.ok(main.indexOf("nvs_storage_init()") < main.indexOf("config_load()"),
  "the NVS write mutex must exist before config loading or producer tasks");

const recovery = code("main/recovery_button.cpp");
assert.ok(recovery.indexOf("nvs_erase_all()") < recovery.indexOf("wifi_forget_persisted_config()") &&
          recovery.indexOf("wifi_forget_persisted_config()") < recovery.indexOf("history_flash_forget()") &&
          recovery.indexOf("history_flash_forget()") < recovery.indexOf("dwell_forget()") &&
          recovery.indexOf("dwell_forget()") < recovery.indexOf("diag_crash_forget()"),
  "factory reset must erase every persisted user-data domain in a fail-closed order");
assert.match(recovery, /if \(wifi_e != ESP_OK \|\| !history_erased \|\| !crash_erased\)[\s\S]*?return;[\s\S]*?esp_restart\(\)/,
  "an incomplete WiFi/history/coredump wipe must not reboot into a partial reset");

const poll = code("main/hp_poll.cpp");
assert.match(poll, /poll_detect\(\)[\s\S]*?cycle_generation = hp_poll_generation\(\)[\s\S]*?expected = config\(\)[\s\S]*?hp_detect_run\(\)/,
  "detection must capture both generation and config revision before the bus sweep");
assert.match(poll, /Lock lk\(s_mtx\)[\s\S]*?s_target_generation\.load[\s\S]*?config_commit_detected_link\([\s\S]*?history_reset_on_detect\([\s\S]*?config_commit_detected_model\(/,
  "detected link, observer resets and model publication must share the reconfigure barrier");
assert.match(poll, /if \(!first_no_match\) \{\s*committed = config_commit_detected_link\(/,
  "one unconfirmed generic sweep must not persist a replacement X10A identity");

const config = code("main/config.cpp");
assert.match(config, /config_commit_detected_link\([\s\S]*?Lock lk\(g_mtx\)[\s\S]*?g_cfg\.runtime_revision != expected\.runtime_revision[\s\S]*?nvs_set_blob\("link"/,
  "the detection link write must be a revision-checked config transaction");
const httpConfig = code("main/http_config.cpp");
assert.match(httpConfig, /reset_checkup && c\.profile != "auto"[\s\S]*?history_x10a_target_fingerprint\([\s\S]*?if \(c\.x10a_identity_fp != 0\)[\s\S]*?history_reset_on_detect\(c\.x10a_identity_fp\)/,
  "manual concrete-profile or wiring-only updates must install a nonzero history scope");

const modbus = code("main/hp_modbus.cpp");
const mbPoll = modbus.slice(modbus.indexOf("static void mb_poll_once()"),
                            modbus.indexOf("void mb_start()"));
assert.ok(mbPoll.indexOf("history_modbus_reset(logic::history_homehub_target_fingerprint(") <
          mbPoll.indexOf("history_generation = history_modbus_generation()"),
  "the first cycle for a corrected HomeHub target must capture the post-reset history generation");

console.log("factory reset: RAM-only WiFi, serialized erase latch and generation-scoped X10A commits pinned");
