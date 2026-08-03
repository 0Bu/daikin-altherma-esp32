// Explicit Settings disables must delete their retained source documents even if X10A is absent.
// This is the one deliberately narrow outbound exception to the installation publish gate: only a
// zero-length retained tombstone may pass, and only after an enabled->disabled persisted change.
import assert from "node:assert/strict";
import fs from "node:fs";

const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const http = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");

const cleanupStart = mqtt.indexOf("static void service_requested_topic_cleanup(const Config& c)");
const cleanupEnd = mqtt.indexOf("static void publish_weather_state", cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart,
  "the user-requested source cleanup boundary must remain identifiable");
const cleanup = mqtt.slice(cleanupStart, cleanupEnd);
assert.match(cleanup,
  /s_weather_cleanup_requested\.exchange\(false\)[\s\S]*!c\.weather_enabled[\s\S]*mqtt_publish\(s_weather, "", 0, 1, 1\)/,
  "weather disable must send one QoS1 retained tombstone only while still disabled");
assert.match(cleanup,
  /s_modbus_cleanup_requested\.exchange\(false\)[\s\S]*!config_modbus_enabled\(c\)[\s\S]*mqtt_publish\(s_modbus, "", 0, 1, 1\)/,
  "HomeHub disable must send one QoS1 retained tombstone only while still disabled");
assert.doesNotMatch(cleanup, /publish_(x10a|modbus|weather|heartbeat|crash|env3)/,
  "the X10A-free exception must not call any ordinary publisher");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
const task = mqtt.slice(taskStart, taskEnd);
const refs = task.indexOf("service_reference_frames(ref_config)");
const requestedCleanup = task.indexOf("service_requested_topic_cleanup(ref_config)");
const ordinaryGate = task.indexOf("if (gate.publish_cycle)");
assert.ok(refs >= 0 && requestedCleanup > refs && ordinaryGate > requestedCleanup,
  "explicit tombstones must be serviced with inbound MQTT, outside the ordinary X10A publish gate");

const setHpStart = http.indexOf("static esp_err_t set_hp(");
const setHpEnd = http.indexOf("static esp_err_t discover_homehub_now", setHpStart);
const setHp = http.slice(setHpStart, setHpEnd);
const hpSave = setHp.indexOf("config_save(c, /*require_link=*/true)");
const hpRequest = setHp.indexOf("mqtt_request_modbus_cleanup()");
assert.match(setHp, /modbus_was_enabled\s*=\s*config_modbus_enabled\(c\)/);
assert.match(setHp, /modbus_was_enabled && !config_modbus_enabled\(c\)/);
assert.ok(hpSave >= 0 && hpRequest > hpSave,
  "HomeHub cleanup may be requested only after the disabling config was persisted");

const setWeatherStart = http.indexOf("static esp_err_t set_weather(");
const setWeatherEnd = http.indexOf("static esp_err_t set_board", setWeatherStart);
const setWeather = http.slice(setWeatherStart, setWeatherEnd);
const weatherSave = setWeather.indexOf("config_save(c)");
const weatherRequest = setWeather.indexOf("mqtt_request_weather_cleanup()");
assert.match(setWeather, /weather_was_enabled\s*=\s*c\.weather_enabled/);
assert.match(setWeather, /weather_was_enabled && !location.enabled/);
assert.ok(weatherSave >= 0 && weatherRequest > weatherSave,
  "weather cleanup may be requested only after the disabling config was persisted");

console.log("MQTT source cleanup: explicit weather + Modbus tombstones bypass X10A safely");
