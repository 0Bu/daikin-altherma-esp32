// Source-boundary regression test for the deterministic controller (#294). The C++ tests prove
// controller maths and gates; this pins what they cannot express: arming is DERIVED from the
// configured sources rather than switched, the runtime evaluator remains outside the publish gate,
// and — since dynamic LWT actuation was RETIRED — no Modbus write capability exists anywhere in the
// firmware.
//
// The collection boundary changed shape with the switch that used to hold it. Consent now rides on
// the SAVE of each source, so what has to be pinned is that no OTHER gate crept in front of them:
// a saved room topic is subscribed, a saved location is fetched, and deleting either stops it. The
// pre-enable Test path must still bypass all of it — otherwise a mapping could only be proved by
// first saving it.
//
// That last assertion changed shape deliberately. It used to allow exactly one owner of the write
// entry point and merely forbid callers, which made "nothing is written" a property of this test.
// The write path is now deleted, so the check is that the capability is ABSENT: no intent API, no
// actuator contract, no FC06/FC16 request builder, no write function code issued by any source
// file. Re-adding any of them is a deliberate act that fails here first.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const controller = read("main/logic/dynamic_lwt_controller.hpp");
assert.doesNotMatch(controller, /#include\s+"(?:hp_modbus|homehub_actuator)\.hpp"/,
  "the pure controller must not include the transport or actuator contract");
assert.ok(!fs.existsSync(path.join(root, "main/logic/homehub_actuator.hpp")),
  "the actuator contract must stay deleted: dynamic LWT actuation is retired (#294)");
assert.doesNotMatch(controller, /LwtOffsetIntent|mb_request_lwt_offset\s*\(/,
  "the pure controller must expose evidence, never an actuator intent or call");
// There is no operator mode left to represent — and ACTIVE must not arrive as one. The controller
// takes a plain `armed` bool, so neither the enum nor the persisted byte can express a writing
// controller, because neither exists.
assert.doesNotMatch(controller, /enum class DynamicLwtMode/,
  "the operator mode is retired: arming is derived from the configured sources");
assert.match(controller, /struct DynamicLwtInputs \{\s*\n\s*bool armed/,
  "the controller must be armed by a derived flag, not a stored mode");
const stateStart = controller.indexOf("enum class DynamicLwtState");
const stateEnd = controller.indexOf("};", stateStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart, "the state enum must remain identifiable");
assert.doesNotMatch(controller.slice(stateStart, stateEnd), /Active/i,
  "the controller must not represent an ACTIVE state");

// THE GATE ORDER IS PART OF THE CONTRACT, not an implementation detail: an idle plant must be
// answered before the room source is judged, or a thermostat switched off for the summer turns a
// plant resting exactly as it should into a standing FAILSAFE (measured: failsafes=2734, holds=0).
const evalStart = controller.indexOf("const DynamicLwtSnapshot& evaluate(");
const evalBody = controller.slice(evalStart, controller.indexOf("private:", evalStart));
const gateOrder = ["homehub_connected", "plant_gate_known", "plant_gate_active",
                   "room_control_eligible", "x10a_connected"];
let cursor = -1;
for (const gate of gateOrder) {
  const at = evalBody.indexOf(gate, cursor + 1);
  assert.ok(at > cursor, `evaluate() must test ${gate} after ${gateOrder[gateOrder.indexOf(gate) - 1]}`);
  cursor = at;
}

const mqtt = read("main/mqtt_ha.cpp");
const evaluateStart = mqtt.indexOf("static logic::DynamicLwtSnapshot evaluate_dynamic_lwt(");
const evaluateEnd = mqtt.indexOf("static void publish_heartbeat()", evaluateStart);
assert.ok(evaluateStart >= 0 && evaluateEnd > evaluateStart,
  "the runtime shadow adapter boundary must remain identifiable");
const evaluator = mqtt.slice(evaluateStart, evaluateEnd);
assert.doesNotMatch(evaluator, /mb_request_lwt_offset\s*\(|LwtOffsetIntent|\.offer\s*\(/,
  "the runtime shadow adapter may observe actuator state but must not offer or write an intent");

const subscriptionStart = mqtt.indexOf("static void service_reference_subscription(");
const subscriptionEnd = mqtt.indexOf("static void service_reference_probe_subscription(", subscriptionStart);
const subscription = mqtt.slice(subscriptionStart, subscriptionEnd);
assert.match(subscription, /capture_enabled = configured;/,
  "a saved room topic IS the consent to subscribe — no second gate may sit in front of it");
assert.match(subscription, /if \(!capture_enabled\)[\s\S]*esp_mqtt_client_unsubscribe/,
  "deleting the topic must actively remove an existing saved-source subscription");

const framesStart = mqtt.indexOf("static void service_reference_frames(");
const framesEnd = mqtt.indexOf("static void on_mqtt(", framesStart);
const framesService = mqtt.slice(framesStart, framesEnd);
assert.match(framesService, /service_reference_probe_frame\(frame\);[\s\S]*c\.ref_temp_topic\.empty\(\)[\s\S]*continue/,
  "the candidate Test probe must run BEFORE the saved-source decode, so a mapping can be proved before it is saved");
assert.doesNotMatch(framesService, /dynamic_lwt/,
  "no controller-level gate may stand between a saved source and its own decode");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the MQTT task boundary must remain identifiable");
const task = mqtt.slice(taskStart, taskEnd);
const frames = task.indexOf("service_reference_frames(ref_config)");
const evaluate = task.indexOf("evaluate_dynamic_lwt(ref_config, hp)");
const publishGate = task.indexOf("if (gate.publish_cycle)");
assert.ok(frames >= 0 && evaluate > frames && publishGate > evaluate,
  "SHADOW must evaluate after inbound room data and even while ordinary publication is gated");
assert.match(task, /publish_weather_state\(ref_config\.weather_enabled\)/,
  "weather evidence rides on the saved location alone");

// The location is the consent to hand these coordinates (and this installation's public source IP)
// to a third party, so the check must be BEFORE the URL is built — not merely before it is used.
const weather = read("main/weather_forecast.cpp");
const loopStart = weather.indexOf("void weather_task(void*)");
const loopBody = weather.slice(loopStart);
const disabledAt = loopBody.indexOf("if (!cfg.weather_enabled)");
const urlAt = loopBody.indexOf("fetch_forecast(");
assert.ok(disabledAt >= 0 && urlAt > disabledAt,
  "an unconfigured location must stop the task before any Open-Meteo request is built");
assert.doesNotMatch(weather, /dynamic_lwt/,
  "no controller-level gate may stand between a saved location and its fetch");

// The retired route must stay retired: a re-added /set_dynamic_lwt would be a persisted mode that
// can disagree with the configuration everything else derives arming from.
const httpConfig = read("main/http_config.cpp");
assert.doesNotMatch(httpConfig, /set_dynamic_lwt/,
  "the operator-mode route is retired: arming is derived, not posted");

// NO WRITE CAPABILITY ANYWHERE. Walk every firmware source (main/*.cpp plus main/logic/*.hpp — the
// pure headers are where a "harmless" framing helper would reappear) and refuse each way a Modbus
// write could re-enter: the retired intent/ownership API, the actuator types, an FC06/FC16 request
// builder, or a raw write function code being issued.
const sources = [];
for (const dir of ["main", "main/logic"]) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(cpp|hpp)$/.test(entry.name)) continue;
    sources.push(path.join(dir, entry.name));
  }
}
const forbidden = [
  [/mb_request_lwt_offset\s*\(/, "the retired LWT write entry point"],
  [/mb_set_actuation_writer_ownership\s*\(/, "the retired actuation-ownership API"],
  [/mb_request_actuation_restore\s*\(/, "the retired actuation restore request"],
  [/\bLwtOffsetIntent\b|\bHomeHubActuator\b|\bActuatorPlan\b/, "an actuator contract type"],
  [/mb_build_write_(?:single|multiple)\s*\(/, "a Modbus write-request builder"],
  [/MbFunc::Write(?:Single|Multiple)\s*[,)]/, "an issued Modbus write function code"],
];
for (const rel of sources) {
  const body = read(rel);
  for (const [pattern, what] of forbidden) {
    assert.doesNotMatch(body, pattern,
      `${rel} must not contain ${what}: dynamic LWT actuation is retired (#294)`);
  }
}
const modbus = read("main/logic/modbus.hpp");
assert.doesNotMatch(modbus, /inline int mb_build_write/,
  "the pure protocol header must not regain a write-request builder");

// Arming is a pure function of the configuration, and NOTHING stores it: a persisted copy is the
// one thing that could disagree with the sources a reader can see in the editor.
const config = read("main/logic/config_model.hpp");
assert.doesNotMatch(config, /dynamic_lwt_mode/,
  "no dynamic-LWT mode may be stored in Config: arming is derived on every evaluation");
assert.match(config, /inline bool dynamic_lwt_armed\(const Config& c\) \{[\s\S]*weather_enabled;/,
  "arming must be derived from the configured room source and forecast location");
const store = read("main/logic/config_store.hpp");
assert.match(store, /v14 block[\s\S]*v\.push_back\(0\);/,
  "the retired v14 mode byte must keep its place in the layout and be written as zero");

console.log(`dynamic LWT: derived arming, evaluates fail-closed, no write capability in ${sources.length} sources`);
