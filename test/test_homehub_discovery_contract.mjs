// Source-boundary regression test for the HomeHub discovery lifecycle. The pure config helpers prove
// that an empty host is disabled; this pins the IDF-facing orchestration that host tests cannot link:
// boot/poll never browse mDNS, and only the explicit HTTP action may run the bounded search.
import assert from "node:assert/strict";
import fs from "node:fs";

const modbus = fs.readFileSync(new URL("../main/hp_modbus.cpp", import.meta.url), "utf8");
const http = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");

const taskStart = modbus.indexOf("static void mb_task(void*)");
const taskEnd = modbus.indexOf("static void mb_task_start_if_enabled()", taskStart + 1);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the Modbus task boundary must remain identifiable");
const task = modbus.slice(taskStart, taskEnd);
assert.doesNotMatch(task, /discover_homehub\s*\(|mdns_query_(?:ptr|a)\s*\(|config_modbus_should_search/,
  "boot/poll task must never perform HomeHub discovery");
assert.match(task, /if \(config_modbus_host\(config\(\)\)\.empty\(\)\) break;/,
  "clearing the address must retire the poll task without a fallback search");

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

console.log("HomeHub discovery lifecycle: explicit UI action only; empty host is boot/poll-off");
