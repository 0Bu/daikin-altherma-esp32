// Source-boundary regression test for the IDF-facing MQTT lifecycle. The pure C++ gate test proves
// state transitions; this pins the orchestration host tests cannot link: MQTT connects in a no-LWT
// subscriber-only mode before X10A, inbound reference handling stays outside the publish gate, and
// the first valid X10A response replaces that client with the installation-LWT publisher.
import assert from "node:assert/strict";
import fs from "node:fs";

const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../main/main.cpp", import.meta.url), "utf8");

const hpStart = main.indexOf("daik::hp_poll_start()");
const mqttStart = main.indexOf("daik::mqtt_ha_start()");
assert.ok(hpStart >= 0 && mqttStart > hpStart,
  "the X10A owner must start before the MQTT bridge");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the MQTT task boundary must remain identifiable");
const task = mqtt.slice(taskStart, taskEnd);

const initialStart = task.indexOf("start_current_client()");
const gateStep = task.indexOf("mqtt_publish_gate_step(");
const promote = task.indexOf("if (gate.promote_publisher");
const refSubscription = task.indexOf("service_reference_subscription(ref_config)");
const refProbe = task.indexOf("service_reference_probe_subscription(ref_config)");
const refFrames = task.indexOf("service_reference_frames(ref_config)");
const offline = task.indexOf("if (gate.publish_offline)");
const resume = task.indexOf("if (gate.resumed");
const publishCycle = task.indexOf("if (gate.publish_cycle)");
assert.ok(initialStart >= 0 && gateStep > initialStart && promote > gateStep,
  "the no-LWT client must start before X10A decides publisher promotion");
assert.ok(refSubscription > promote && refProbe > refSubscription && refFrames > refProbe,
  "eligible saved-source/Test servicing and frame decoding must run outside the publish gate");
assert.ok(offline > refFrames && resume > offline && publishCycle > resume,
  "offline/resume transitions and every ordinary publication must follow inbound servicing");
assert.doesNotMatch(task.slice(promote, refSubscription), /SubscriberOnly[\s\S]*continue\s*;/,
  "subscriber-only mode must not skip inbound reference servicing");

const builderStart = taskEnd;
const builderEnd = mqtt.indexOf("static bool start_current_client()", builderStart);
assert.ok(builderStart >= 0 && builderEnd > builderStart,
  "the two-mode MQTT client builder must remain identifiable");
const builder = mqtt.slice(builderStart, builderEnd);
assert.match(builder,
  /if \(publisher_lwt\)\s*\{[\s\S]*last_will\.topic[\s\S]*last_will\.msg[\s\S]*last_will\.retain/,
  "only the proven publisher client may carry the shared installation LWT");

const promoteStart = mqtt.indexOf("static bool promote_client_to_publisher()", builderEnd);
const promoteEnd = mqtt.indexOf("void mqtt_ha_start()", promoteStart);
assert.ok(promoteStart >= 0 && promoteEnd > promoteStart,
  "the subscriber-to-publisher replacement boundary must remain identifiable");
const promoteBody = mqtt.slice(promoteStart, promoteEnd);
const cleanStop = promoteBody.indexOf("esp_mqtt_client_stop(s_client)");
const destroy = promoteBody.indexOf("esp_mqtt_client_destroy(s_client)");
const armedBuild = promoteBody.indexOf("build_client(true)");
const armedStart = promoteBody.indexOf("start_current_client()");
assert.ok(cleanStop >= 0 && destroy > cleanStop && armedBuild > destroy && armedStart > armedBuild,
  "publisher promotion must cleanly stop/destroy the no-LWT client before arming a replacement");

const publicStart = mqtt.indexOf("void mqtt_ha_start()");
const publicStartEnd = mqtt.indexOf("MqttStatus mqtt_status()", publicStart);
assert.ok(publicStart >= 0 && publicStartEnd > publicStart,
  "the public MQTT start boundary must remain identifiable");
const publicBody = mqtt.slice(publicStart, publicStartEnd);
assert.match(publicBody, /build_client\(false\)/,
  "mqtt_ha_start must build the initial subscriber without an installation LWT");
assert.doesNotMatch(publicBody, /waiting for X10A response/,
  "missing X10A must no longer masquerade as an MQTT connection error");

const startCalls = [...mqtt.matchAll(/esp_mqtt_client_start\s*\(/g)];
assert.equal(startCalls.length, 1,
  "all initial and replacement starts must share one checked lifecycle wrapper");

console.log("MQTT lifecycle: no-LWT subscriptions before X10A; all ordinary publishes remain gated");
