// Whole-component contract for the read-only heating-curve diagnosis (#294), named for its current
// observation-only scope rather than the retired dynamic-LWT actuator project.
// Host C++ tests own the sampling maths; this file owns source boundaries that linking a pure header
// cannot prove: derived arming, heating-only gate order, durable telemetry and absence of any Modbus
// write capability in the complete firmware tree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const diagnosis = read("main/logic/heating_curve_diagnosis.hpp");
assert.match(diagnosis, /class HeatingCurveDiagnosis/);
assert.match(diagnosis, /HEATING_CURVE_DIAGNOSIS_METHOD_VERSION\s*=\s*2/);
assert.doesNotMatch(diagnosis,
  /DYNAMIC_LWT_P_GAIN|DYNAMIC_LWT_DEADBAND|DYNAMIC_LWT_OFFSET_(?:MIN|MAX)|DYNAMIC_LWT_MAX_STEP|\brequested_offset_k\b|\bp_term_k\b|\bbounded_offset_k\b|\brate_limited\b/,
  "diagnosis must sample raw room error, not retain actuator shaping");
assert.doesNotMatch(diagnosis, /#include\s+"(?:hp_modbus|homehub_actuator)\.hpp"/,
  "the pure diagnosis must not include transport or actuator contracts");
assert.ok(!fs.existsSync(path.join(root, "main/logic/homehub_actuator.hpp")),
  "the retired actuator contract must stay deleted");

// Register 53 is heating OR cooling. A sample is allowed only after the independent current-mode
// witness proves HEATING. Idle summer operation remains a neutral hold before room-source checks.
const evalStart = diagnosis.indexOf("const HeatingCurveSnapshot& evaluate(");
const evalBody = diagnosis.slice(evalStart, diagnosis.indexOf("private:", evalStart));
assert.match(evalBody,
  /if \(!in\.homehub_connected\)[\s\S]*if \(!in\.plant_gate_known\)[\s\S]*if \(!in\.plant_gate_active\)[\s\S]*if \(!in\.heating_mode_known\)[\s\S]*if \(!in\.heating_mode_active\)[\s\S]*if \(!in\.room_control_eligible[\s\S]*if \(!in\.x10a_connected\)/,
  "evaluation order must prove active normal space HEATING before accepting room evidence");

// The optional ENV III outdoor axis is CONTEXT recorded with an event, never a condition for one.
// A gate here would silently stop sampling on every installation without the accessory — the one
// failure mode that looks like the feature merely being idle.
assert.doesNotMatch(evalBody, /in\.outdoor_available[^;]*\)\s*return\s+(?:blocked|hold)\(/,
  "an absent outdoor sensor must never block or hold a sample");
assert.doesNotMatch(evalBody, /if \([^)]*outdoor[^)]*\)\s*return/,
  "no branch of the evaluation may depend on the outdoor axis");
assert.match(diagnosis, /has_last_sample_outdoor = s_\.has_outdoor_temperature;/,
  "the recorded event must take the outdoor flag as it stood at that event");
const resetStart = diagnosis.indexOf("void reset_samples()");
const resetBody = diagnosis.slice(resetStart, diagnosis.indexOf("}", resetStart));
assert.match(resetBody, /has_last_sample_outdoor = false/,
  "disarming clears sample memory, and the outdoor value must not outlive it");

const config = read("main/logic/config_model.hpp");
assert.doesNotMatch(config, /dynamic_lwt_mode/,
  "no operator mode may be stored: diagnosis arming is derived");
const armingStart = config.indexOf("inline bool heating_curve_diagnosis_armed(");
const arming = config.slice(armingStart, config.indexOf("}", armingStart) + 1);
assert.match(arming, /ref_temp_topic/);
assert.doesNotMatch(arming, /weather_enabled|latitude|longitude/,
  "optional forecast/location disclosure must never gate local room-error sampling");

const mqtt = read("main/mqtt_ha.cpp");
const evaluateStart = mqtt.indexOf("static logic::HeatingCurveSnapshot evaluate_heating_curve(");
const evaluateEnd = mqtt.indexOf("static void publish_heartbeat()", evaluateStart);
assert.ok(evaluateStart >= 0 && evaluateEnd > evaluateStart,
  "runtime diagnosis adapter boundary must remain identifiable");
const evaluator = mqtt.slice(evaluateStart, evaluateEnd);
assert.match(evaluator, /heating_mode_known = mbs\.heating_mode_known/);
assert.match(evaluator, /heating_mode_active = mbs\.heating_mode_active/);
assert.match(evaluator, /now_unix_s = now_unix_s/,
  "every sample needs an absolute event timestamp, not only boot-monotonic milliseconds");
assert.doesNotMatch(evaluator, /mb_request|LwtOffsetIntent|\.offer\s*\(/,
  "runtime diagnosis may observe the plant but never offer an intent");

const subscriptionStart = mqtt.indexOf("static void service_reference_subscription(");
const subscriptionEnd = mqtt.indexOf("static void service_circulation_probe_frame(", subscriptionStart);
const subscription = mqtt.slice(subscriptionStart, subscriptionEnd);
assert.match(subscription, /capture_enabled = configured;/,
  "saving the exact room topic is the subscription consent boundary");
assert.match(subscription, /if \(!capture_enabled\)[\s\S]*unsubscribe_reference_topic_if_unused/,
  "deleting the room mapping must retire every saved value-topic subscription");
const unsubscribeStart = mqtt.indexOf("static void unsubscribe_reference_topic_if_unused(");
const unsubscribeEnd = mqtt.indexOf("static void service_reference_subscription(", unsubscribeStart);
assert.match(mqtt.slice(unsubscribeStart, unsubscribeEnd), /esp_mqtt_client_unsubscribe/,
  "the shared topic-retirement helper must actively unsubscribe once no source owns it");
assert.match(subscription, /const ReferenceTopicSet desired = reference_topics\(c\)[\s\S]*for \(const std::string& topic : desired\)[\s\S]*esp_mqtt_client_subscribe/,
  "the saved logical room source must subscribe all distinct temperature, target and timestamp topics");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
const task = mqtt.slice(taskStart, taskEnd);
const frames = task.indexOf("service_reference_frames(ref_config)");
const evaluate = task.indexOf("evaluate_heating_curve(ref_config, hp)");
const publishGate = task.indexOf("if (gate.publish_cycle)");
assert.ok(frames >= 0 && evaluate > frames && publishGate > evaluate,
  "diagnosis must consume inbound room data before evaluation and outside the publish gate");
const heartbeatPublish = task.indexOf("publish_heartbeat()", publishGate);
const telemetryPublish = task.indexOf("publish_heating_curve_telemetry()", publishGate);
assert.ok(heartbeatPublish > publishGate && telemetryPublish > heartbeatPublish,
  "technical heartbeat and grouped heating-curve telemetry must publish together inside the X10A gate");

const heartbeat = read("main/logic/heartbeat.hpp");
assert.doesNotMatch(heartbeat, /room_(?:source|temperature|setpoint|control|error|age|messages|rejections)|heating_curve_/,
  "room-source and heating-curve domain telemetry must stay out of the board/link heartbeat");
const telemetry = read("main/logic/heating_curve_mqtt.hpp");
assert.match(telemetry, /return base \+ "\/heating_curve"/);
assert.match(telemetry, /\\"room\\"/);
assert.match(telemetry, /\\"diagnosis\\"/);
assert.match(telemetry, /last_sample_unix_s/);
assert.match(telemetry, /sequence/);
assert.doesNotMatch(telemetry, /lwt_controller_|proposal_produced|last_decision_ms/,
  "retired one-cycle proposal events and actuator telemetry must not survive the diagnosis migration");
assert.match(mqtt, /publish_heating_curve_telemetry\(\)/);
assert.match(mqtt, /mqtt_publish\(s_heating_curve_topic/);

// Walk the COMPLETE main tree recursively. The former non-recursive scan skipped main/def entirely,
// so its claim about "every firmware source" covered only 119 of 169 C++ files.
function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(absolute));
    else if (/\.(cpp|hpp)$/.test(entry.name)) out.push(path.relative(root, absolute));
  }
  return out;
}
const sources = collect(path.join(root, "main"));
const forbidden = [
  [/mb_request_lwt_offset\s*\(/, "retired LWT write entry point"],
  [/mb_set_actuation_writer_ownership\s*\(/, "retired writer-ownership API"],
  [/mb_request_actuation_restore\s*\(/, "retired restore request"],
  [/\bLwtOffsetIntent\b|\bHomeHubActuator\b|\bActuatorPlan\b/, "actuator contract type"],
  [/mb_build_write_(?:single|multiple)\s*\(/, "Modbus write-request builder"],
  [/MbFunc::Write(?:Single|Multiple)/, "Modbus write function code"],
];
for (const rel of sources) {
  const body = read(rel);
  for (const [pattern, what] of forbidden)
    assert.doesNotMatch(body, pattern, `${rel} must not contain ${what}`);
}

const modbus = read("main/logic/modbus.hpp");
assert.doesNotMatch(modbus,
  /WriteSingle|WriteMultiple|EchoMismatch|echo_addr|echo_value|mb_encode|MB_MAX_WRITE_REGS/,
  "read-only protocol core must not retain write framing, echo parsing or value encoders");

const store = read("main/logic/config_store.hpp");
assert.match(store, /v14 block[\s\S]*v\.push_back\(0\);/,
  "retired v14 mode byte must retain its layout position and serialize as zero");

console.log(`heating-curve diagnosis: raw heating-only samples, no write capability in ${sources.length} sources`);
