// Source-boundary regression test for the HomeHub discovery lifecycle. The pure config helpers prove
// that an empty host is disabled; this pins the IDF-facing orchestration that host tests cannot link:
// boot/poll never browse mDNS, and only the explicit HTTP action may run the bounded search.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const modbus = fs.readFileSync(new URL("../main/hp_modbus.cpp", import.meta.url), "utf8");
const http = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");

const taskStart = modbus.indexOf("static void mb_task(void*)");
const taskEnd = modbus.indexOf("static void mb_task_start_if_enabled()", taskStart + 1);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the Modbus task boundary must remain identifiable");
const task = modbus.slice(taskStart, taskEnd);
assert.doesNotMatch(task, /discover_homehub\s*\(|mdns_query_(?:ptr|a)\s*\(|config_modbus_should_search/,
  "boot/poll task must never perform HomeHub discovery");
assert.match(task,
  /if \(config_modbus_host\(config\(\)\)\.empty\(\)\) \{[\s\S]*?request_restore\([\s\S]*?mb_process_actuator\(\/\*enabled=\*\/false, ignored\);[\s\S]*?break;[\s\S]*?\}/,
  "clearing the address must attempt the bounded restore, then retire without a fallback search");

const startStart = modbus.indexOf("static void mb_task_start_if_enabled()", taskEnd);
const startEnd = modbus.indexOf("void mb_start()", startStart);
assert.match(modbus.slice(startStart, startEnd), /if \(!config_modbus_enabled\(c\)\) return;/,
  "boot must create no HomeHub task for an empty address");

const handlerStart = http.indexOf("static esp_err_t discover_homehub_now");
const handlerEnd = http.indexOf("static esp_err_t set_syslog", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "the explicit discovery handler must exist");
const handler = http.slice(handlerStart, handlerEnd);
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

console.log("HomeHub discovery lifecycle: explicit UI action only; empty host is boot/poll-off");
