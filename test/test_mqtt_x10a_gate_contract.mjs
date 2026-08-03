// Source-boundary regression test for the IDF-facing MQTT lifecycle. The pure C++ gate test proves
// the state transitions; this pins the orchestration host tests cannot link: X10A starts before the
// bridge, the client is not started from mqtt_ha_start(), and the sole start call sits behind the
// first-X10A-response gate in mqtt_task().
import assert from "node:assert/strict";
import fs from "node:fs";

const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main/main.cpp", import.meta.url), "utf8");

const hpStart = main.indexOf("daik::hp_poll_start()");
const mqttStart = main.indexOf("daik::mqtt_ha_start()");
assert.ok(hpStart >= 0 && mqttStart > hpStart,
  "the X10A owner must start before the MQTT bridge");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client()", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the MQTT task boundary must remain identifiable");
const task = mqtt.slice(taskStart, taskEnd);

const startCalls = [...mqtt.matchAll(/esp_mqtt_client_start\s*\(/g)];
assert.equal(startCalls.length, 1, "there must be exactly one MQTT client start call");
assert.ok(startCalls[0].index > taskStart && startCalls[0].index < taskEnd,
  "the client may start only from the gated publish task");

const gateStep = task.indexOf("mqtt_publish_gate_step(");
const clientStart = task.indexOf("esp_mqtt_client_start(s_client)");
const waitingStop = task.indexOf("publish_gate == MqttPublishGateState::WaitingForX10a");
const offline = task.indexOf("if (gate.publish_offline)");
const resume = task.indexOf("if (gate.resumed");
const publishCycle = task.indexOf("if (gate.publish_cycle)");
assert.ok(gateStep >= 0 && clientStart > gateStep && waitingStop > clientStart,
  "the first X10A decision must gate client start and the silent waiting path");
assert.ok(offline > waitingStop && resume > offline && publishCycle > resume,
  "offline/resume transitions must precede the ordinary publish-cycle boundary");

const publicStart = mqtt.indexOf("void mqtt_ha_start()");
const publicStartEnd = mqtt.indexOf("MqttStatus mqtt_status()", publicStart);
assert.ok(publicStart >= 0 && publicStartEnd > publicStart,
  "the public MQTT start boundary must remain identifiable");
assert.doesNotMatch(mqtt.slice(publicStart, publicStartEnd), /esp_mqtt_client_start\s*\(/,
  "mqtt_ha_start must not arm a shared-topic LWT before X10A is proven");
assert.match(mqtt.slice(publicStart, publicStartEnd), /waiting for X10A response/,
  "status must explain why configured MQTT is intentionally not connected");

console.log("MQTT lifecycle: no client/LWT before X10A; offline-once and gated recovery pinned");
