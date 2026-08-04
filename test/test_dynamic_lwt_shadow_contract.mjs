// Source-boundary regression test for WP2 (#334). The C++ tests prove controller maths and gates;
// this pins what they cannot express: OFF/SHADOW is the whole public mode vocabulary, the runtime
// evaluator remains outside the publish gate, and no production translation unit calls the one
// HomeHub LWT-write entry point.
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
assert.doesNotMatch(controller, /LwtOffsetIntent|mb_request_lwt_offset\s*\(/,
  "the pure controller must expose evidence, never an actuator intent or call");
const modeStart = controller.indexOf("enum class DynamicLwtMode");
const modeEnd = controller.indexOf("};", modeStart);
assert.ok(modeStart >= 0 && modeEnd > modeStart, "the mode enum must remain identifiable");
const modeEnum = controller.slice(modeStart, modeEnd);
assert.match(modeEnum, /Off\s*=\s*0/);
assert.match(modeEnum, /Shadow\s*=\s*1/);
assert.doesNotMatch(modeEnum, /Active/i, "WP2 must not represent ACTIVE");

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
assert.match(subscription, /capture_enabled[\s\S]*DynamicLwtMode::Shadow/,
  "the saved room mapping may be subscribed only after explicit SHADOW enablement");
assert.match(subscription, /if \(!capture_enabled\)[\s\S]*esp_mqtt_client_unsubscribe/,
  "OFF must actively remove an existing saved-source subscription");

const framesStart = mqtt.indexOf("static void service_reference_frames(");
const framesEnd = mqtt.indexOf("static void on_mqtt(", framesStart);
const framesService = mqtt.slice(framesStart, framesEnd);
assert.match(framesService, /service_reference_probe_frame\(frame\);[\s\S]*dynamic_lwt_mode != logic::DynamicLwtMode::Shadow[\s\S]*continue/,
  "OFF must ignore saved-source frames while retaining the independent pre-enable Test path");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
assert.ok(taskStart >= 0 && taskEnd > taskStart, "the MQTT task boundary must remain identifiable");
const task = mqtt.slice(taskStart, taskEnd);
const frames = task.indexOf("service_reference_frames(ref_config)");
const evaluate = task.indexOf("evaluate_dynamic_lwt(ref_config, hp)");
const publishGate = task.indexOf("if (gate.publish_cycle)");
assert.ok(frames >= 0 && evaluate > frames && publishGate > evaluate,
  "SHADOW must evaluate after inbound room data and even while ordinary publication is gated");
assert.match(task, /publish_weather_state\(ref_config\.weather_enabled &&[\s\S]*DynamicLwtMode::Shadow\)/,
  "weather evidence may be published only while the experimental collection switch is enabled");

const weather = read("main/weather_forecast.cpp");
assert.match(weather, /dynamic_lwt_mode != logic::DynamicLwtMode::Shadow[\s\S]*set_feature_inactive\(cfg\)/,
  "OFF must pause Open-Meteo before any network fetch");

const httpConfig = read("main/http_config.cpp");
const setModeStart = httpConfig.indexOf("static esp_err_t set_dynamic_lwt(");
const setModeEnd = httpConfig.indexOf("static esp_err_t set_hp(", setModeStart);
const setMode = httpConfig.slice(setModeStart, setModeEnd);
assert.match(setMode, /mqtt_reference_reconfigure\(\);[\s\S]*weather_forecast_reconfigure\(\);/,
  "the Firmware switch must apply both collection boundaries live");

const cppFiles = fs.readdirSync(path.join(root, "main"), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".cpp"))
  .map(entry => entry.name);
const writeEntrypointOwners = cppFiles.filter(name =>
  /mb_request_lwt_offset\s*\(/.test(read(path.join("main", name))));
assert.deepEqual(writeEntrypointOwners, ["hp_modbus.cpp"],
  "only hp_modbus.cpp may own the HomeHub LWT-write entry point; WP2 must add no caller");

const config = read("main/logic/config_model.hpp");
assert.match(config, /dynamic_lwt_mode\s*=\s*logic::DynamicLwtMode::Off/,
  "install and migration default must remain OFF");
assert.match(config, /dynamic_lwt_disarm_if_unready/,
  "removing MQTT, room mapping or HomeHub must disarm a saved SHADOW mode");

console.log("dynamic LWT WP2: OFF/SHADOW only, evaluates fail-closed, no actuator caller");
