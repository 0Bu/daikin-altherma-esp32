// Source boundaries supplement the executable complete-TU MQTT runtime witness. Transport, source
// availability and independent-source publication have different owners.
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mqtt = read("main/mqtt_ha.cpp");
const main = read("main/main.cpp");
const discovery = read("main/logic/discovery.hpp");
assert.ok(main.indexOf("daik::mqtt_ha_start()") > main.indexOf("daik::hp_poll_start()"),
  "the X10A owner must start before the MQTT bridge");
const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart);
const task = mqtt.slice(taskStart, taskEnd);
const sample = task.indexOf("mqtt_cycle_gate(publish_gate, x10a_connected)");
const withdrawal = task.indexOf('mqtt_publish(s_x10a_avail, "offline", 0, 1, 1)');
const config = task.indexOf("const Config ref_config = config()");
const frames = task.indexOf("service_reference_frames(ref_config)");
const gateAt = task.indexOf("if (gate.publish_cycle) {");
assert.ok(task.indexOf("start_current_client()") < sample && sample < withdrawal &&
  withdrawal < config && config < frames && frames < gateAt,
"transport starts independently and source withdrawal precedes allocating Config/inbound work");
assert.ok(task.indexOf("service_source_cleanup_evidence();") < config,
  "a low-heap Config failure must not discard broker cleanup ACK evidence");
assert.match(mqtt,
  /mqtt_cycle_gate[\s\S]*?const HpMqttSourceState hp = hp_mqtt_source_state\(\);[\s\S]*?return mqtt_publish_gate_step\(state, hp\.recent, s_connected\.load\(\)\)/,
  "source withdrawal must use the allocation-free poll-owned freshness sample");
// Preserve source offsets while ignoring comments and quoted strings before following braces.
const structural = task.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"/g,
  (match) => " ".repeat(match.length));
let depth = 0, gateEnd = -1;
for (let i = structural.indexOf("{", gateAt); i < structural.length; ++i) {
  if (structural[i] === "{") ++depth;
  if (structural[i] === "}" && --depth === 0) { gateEnd = i; break; }
}
assert.ok(gateEnd > gateAt, "the X10A source gate must have a bounded identifiable body");
const x10a = task.slice(gateAt, gateEnd);
assert.match(x10a, /publish_x10a_discovery\(\)/);
assert.match(x10a, /if \(x10a_connected && prof != "auto" && !seed_attempted\)/,
  "a grace-period empty sweep must not overwrite retained X10A readings with an empty document");
assert.match(x10a, /if \(x10a_connected && !s_last_x10a_digest_valid\)/,
  "a discovery retry must not force an empty X10A seed during observation grace");
assert.match(x10a,
  /s_x10a_publish_proven\.load[\s\S]*?hp_mqtt_source_state\(\)\.recent[\s\S]*?mqtt_publish\(s_x10a_avail, "online"/,
  "source online needs an accepted state seed and a still-recent source");
for (const call of ["publish_modbus_state", "publish_weather_state", "publish_env3_state",
  "publish_heartbeat()", "publish_heating_curve_telemetry(ref_config)"]) {
  assert.ok(task.indexOf(call, gateEnd) > gateEnd, `${call} must remain outside X10A authority`);
}
assert.doesNotMatch(mqtt, /promote_client_to_publisher|publisher_lwt|s_client_is_publisher/,
  "X10A must not change the broker lifecycle or LWT ownership");
const builderEnd = mqtt.indexOf("static bool start_current_client()", taskEnd);
const builder = mqtt.slice(taskEnd, builderEnd);
assert.match(builder,
  /last_will\.topic\s*=\s*s_avail\.c_str\(\)[\s\S]*last_will\.msg\s*=\s*"offline"[\s\S]*last_will\.retain\s*=\s*1/,
  "the initial client must arm the retained broker-transport LWT");
assert.match(mqtt, /if \(s_board\.empty\(\)\)[\s\S]*?set_status\(false, "board MAC read failed"\)[\s\S]*?return;/,
  "a failed MAC read must stop before creating an unidentified client");
assert.match(discovery, /append_x10a_availability[\s\S]*?state_topic,\s*"\/status[\s\S]*?availability_mode/,
  "X10A discovery must require both exact transport/source availability topics");
assert.equal([...mqtt.matchAll(/esp_mqtt_client_start\s*\(/g)].length, 1,
  "initial start and resume retries must share the checked lifecycle wrapper");
console.log("MQTT lifecycle: one initial transport LWT, pre-allocation X10A withdrawal, independent sources");
