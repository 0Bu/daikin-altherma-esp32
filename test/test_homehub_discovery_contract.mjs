// Source-boundary regression test for the HomeHub discovery lifecycle. Fresh firmware performs one
// persisted search before HTTP starts; the poll loop never browses, and an explicit empty save is a
// durable opt-out. Manual Search remains request-local behind the dialog's Save/Cancel boundary.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const modbus = fs.readFileSync(new URL("../main/hp_modbus.cpp", import.meta.url), "utf8");
const http = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main/main.cpp", import.meta.url), "utf8");
const status = fs.readFileSync(new URL("../main/http_status.cpp", import.meta.url), "utf8");

const taskStart = modbus.indexOf("static void mb_task(void*)");
const taskEnd = modbus.indexOf("static void mb_task_start_if_enabled()", taskStart + 1);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the Modbus task boundary must remain identifiable");
const task = modbus.slice(taskStart, taskEnd);
assert.doesNotMatch(task, /discover_homehub\s*\(|mdns_query_(?:ptr|a)\s*\(|config_modbus_should_search/,
  "the steady-state poll task must never perform HomeHub discovery");
// Clearing the address retires the task outright. There is no restore step any more: the write path
// was removed with dynamic LWT actuation (#294), so the stack owns nothing on the hub to put back.
assert.match(task, /if \(config_modbus_host\(config\(\)\)\.empty\(\)\) break;/,
  "clearing the address must retire the task without a fallback search");
assert.doesNotMatch(task, /request_restore\(|mb_process_actuator\(/,
  "the retired actuator must leave no restore step in the task loop");

const startStart = modbus.indexOf("static void mb_task_start_if_enabled()", taskEnd);
const startEnd = modbus.indexOf("void mb_start()", startStart);
assert.match(modbus.slice(startStart, startEnd), /if \(!config_modbus_enabled\(c\)\) return;/,
  "after the one-shot decision, an empty address must create no HomeHub task");

const autoStart = modbus.indexOf("void mb_autodiscover_initial()");
const autoEnd = modbus.indexOf("// Non-blocking connect", autoStart);
assert.ok(autoStart >= 0 && autoEnd > autoStart, "the initial discovery boundary must exist");
const initial = modbus.slice(autoStart, autoEnd);
assert.match(initial, /config_modbus_should_search\(c\)/,
  "only genuinely undecided firmware may run the automatic search");
assert.match(initial, /if \(!net_is_up\(\)\)/,
  "AP-only startup must defer rather than consume the one-shot decision");
assert.match(initial, /discover_homehub_bounded\(found, "initial"\)/,
  "the initial search must use the bounded mDNS implementation");
assert.match(initial, /c\.mb_discovery_done = true;[\s\S]*if \(ok\) c\.mb_host = found;[\s\S]*config_save\(c\)/,
  "found and not-found outcomes must persist the latch atomically with the address");
const autoCall = main.indexOf("mb_autodiscover_initial()");
const httpStart = main.indexOf("http_start()");
assert.ok(autoCall >= 0 && httpStart > autoCall,
  "initial discovery must finish before HTTP can race it with a user config save");

const setHpStart = http.indexOf("static esp_err_t set_hp(");
const setHpEnd = http.indexOf("static esp_err_t discover_homehub_now", setHpStart);
const setHp = http.slice(setHpStart, setHpEnd);
assert.match(setHp, /if \(host_sent\) \{[\s\S]*c\.mb_host = hostItem->valuestring;[\s\S]*c\.mb_discovery_done = true;/,
  "an explicit host save, including empty delete, must permanently complete discovery");
assert.match(status, /searched[\s\S]{0,120}c\.mb_discovery_done/,
  "status must expose whether the one-shot decision has been persisted");

const handlerStart = http.indexOf("static esp_err_t discover_homehub_now");
const handlerEnd = http.indexOf("static esp_err_t set_syslog", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "the explicit discovery handler must exist");
const handler = http.slice(handlerStart, handlerEnd);
assert.match(handler, /if \(!net_is_up\(\)\)/,
  "manual discovery must work over either WiFi or Ethernet and reject only when the LAN is down");
assert.match(handler, /mb_discover_homehub\(found\)/,
  "the explicit endpoint must invoke the bounded mDNS search");
assert.doesNotMatch(handler, /config_save|mb_reconfigure/,
  "Search may fill the form but must not persist behind Save/Cancel");
assert.match(http, /"\/discover_homehub", HTTP_POST, discover_homehub_now/,
  "the explicit discovery endpoint must be registered on the config surface");
assert.match(html, /id="hhSearch"/, "the HomeHub dialog must expose the only discovery trigger");

// Execute the production dialog functions across the cancellation race. The mDNS request keeps
// running on the device after the browser closes the modal; its late response must not cross the
// Cancel boundary and overwrite the saved address loaded by a newly opened dialog.
const settings = fs.readFileSync(new URL("../main/www/js/settings.js", import.meta.url), "utf8");
const element = (value = "") => ({
  value, hidden: false, disabled: false, innerHTML: "", textContent: "",
  classList: { add() {}, remove() {} }, focus() {},
});
const elements = {
  hhHost: element(), hhPort: element(), hhUnit: element(), hhError: element(),
  hhSearch: element(), homehubModal: element(),
};
let finishSearch;
const pendingSearch = new Promise((resolve) => { finishSearch = resolve; });
const context = vm.createContext({
  S: { status: { modbus: { host: "saved-homehub.local", port: 502, unit_id: 1 } } },
  $: (id) => elements[id], esc: String, t: (key) => key, toast() {},
  openPopup: (id) => { elements[id].hidden = false; },
  closePopup: (id) => { elements[id].hidden = true; },
  post: async () => pendingSearch,
});
vm.runInContext(`${settings}\nthis.__homehub = { openHomehub, closeHomehub, searchHomehub };`, context,
  { filename: "main/www/js/settings.js" });

context.__homehub.openHomehub();
const abandonedSearch = context.__homehub.searchHomehub();
assert.equal(elements.hhSearch.disabled, true, "the active search must disable its trigger");
context.__homehub.closeHomehub();
context.__homehub.openHomehub();
assert.equal(elements.hhHost.value, "saved-homehub.local", "reopen reloads the persisted address");
finishSearch({ ok: true, status: 200, json: async () => ({ host: "203.0.113.137" }) });
assert.equal(await abandonedSearch, false, "the abandoned request must be ignored");
assert.equal(elements.hhHost.value, "saved-homehub.local",
  "a late discovery response must not overwrite the newly opened form");
assert.equal(elements.hhSearch.disabled, false,
  "an old request must not change the trigger state of the new dialog session");

console.log("HomeHub discovery lifecycle: one initial persisted search; explicit empty is durable off");
