// Explicit Settings source/consent changes and a rebuilt MQTT client must delete superseded
// retained documents even if X10A is absent. The exception stays delete-only, PUBACK-driven and
// bounded to one Weather/HomeHub/ENV-III source-cleanup tombstone in flight.
import assert from "node:assert/strict";
import fs from "node:fs";

const mqtt = fs.readFileSync(new URL("../main/mqtt_ha.cpp", import.meta.url), "utf8");
const cleanupLogic = fs.readFileSync(
  new URL("../main/logic/mqtt_cleanup.hpp", import.meta.url), "utf8");
const http = fs.readFileSync(new URL("../main/http_config.cpp", import.meta.url), "utf8");
const modbus = fs.readFileSync(new URL("../main/hp_modbus.cpp", import.meta.url), "utf8");
const modbusHeader = fs.readFileSync(new URL("../main/hp_modbus.hpp", import.meta.url), "utf8");
const discovery = fs.readFileSync(new URL("../main/logic/discovery.hpp", import.meta.url), "utf8");
const weatherMqtt = fs.readFileSync(
  new URL("../main/logic/weather_mqtt.hpp", import.meta.url), "utf8");
const publishGate = fs.readFileSync(
  new URL("../main/logic/mqtt_publish_gate.hpp", import.meta.url), "utf8");
const sdkconfigDefaults = fs.readFileSync(
  new URL("../sdkconfig.defaults", import.meta.url), "utf8");

// The complete reconnect job is finite and encoded independently of ESP-IDF. The scheduler holds
// one message id until the matching client-epoch PUBACK and does not return another action meanwhile.
assert.match(cleanupLogic, /MQTT_SOURCE_CLEANUP_MAX_STEPS[\s\S]*?== 37/,
  "the complete source cleanup plan must remain explicitly bounded to 37 tombstones");
assert.match(cleanupLogic,
  /MqttCleanupAction next_action[\s\S]*?if \(!connected \|\| client_epoch_ == 0 \|\| in_flight_id_ >= 0\) return \{\}/,
  "a missing PUBACK must not enqueue another source tombstone on the next cycle");
assert.match(cleanupLogic,
  /bool acknowledge\(MqttCleanupDeliveryEvidence evidence\)[\s\S]*?evidence\.client_epoch != client_epoch_[\s\S]*?evidence\.msg_id != in_flight_id_[\s\S]*?\+\+next_step_/,
  "only a matching PUBACK from the active client may advance cleanup");
assert.match(cleanupLogic,
  /bool retry_deleted\(MqttCleanupDeliveryEvidence evidence\)[\s\S]*?MqttCleanupDeliveryOutcome::Deleted[\s\S]*?in_flight_id_ = -1/,
  "an exact ESP-MQTT outbox deletion must retry rather than permanently suppress the source");
assert.match(cleanupLogic,
  /outbox_cleared_after_transport_stop[\s\S]*?in_flight_id_ = -1/,
  "a joined transport stop must release the outbox id while preserving the active step");
assert.match(cleanupLogic,
  /void request\(MqttCleanupSource source\)[\s\S]*?pending_ \|= mqtt_cleanup_bit\(source\)/,
  "a request during an active run must survive as a pending repeat");
assert.match(cleanupLogic,
  /bool suppress[\s\S]*?pending_[\s\S]*?active_ == source[\s\S]*?completed_this_cycle_/,
  "pending, active and just-completed sources must all suppress ordinary same-cycle publish");
assert.match(cleanupLogic,
  /reconstruct_for_client[\s\S]*?client_epoch == client_epoch_[\s\S]*?return false[\s\S]*?request_all\(\)/,
  "same-client reconnect must preserve in-flight state while a replacement client reconstructs all sources");
assert.match(cleanupLogic,
  /class MqttCleanupEvidenceQueue[\s\S]*?head_\.store\(head \+ 1, std::memory_order_release\)[\s\S]*?std::array<MqttCleanupDeliveryEvidence, Capacity>/,
  "PUBACK/deletion evidence must use a static bounded handoff, not a racy last-id scalar");

const cleanupStart = mqtt.indexOf(
  "static RetainedCleanupCycle service_requested_topic_cleanup(const Config& c)");
const cleanupEnd = mqtt.indexOf("static void publish_weather_state", cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart,
  "the source-cleanup runtime boundary must remain identifiable");
const cleanup = mqtt.slice(cleanupStart, cleanupEnd);
const weatherRequest = cleanup.indexOf("s_weather_cleanup_requested.exchange(false");
const modbusRequest = cleanup.indexOf("s_modbus_cleanup_requested.exchange(false");
const env3Request = cleanup.indexOf("s_env3_cleanup_requested.exchange(false");
const ackBefore = cleanup.indexOf("service_source_cleanup_evidence()", env3Request);
const action = cleanup.indexOf("s_source_cleanup.next_action", ackBefore);
const tombstone = cleanup.indexOf('mqtt_enqueue_id(topic, "", 0, 1, 1)', action);
const rememberId = cleanup.indexOf("s_source_cleanup.publish_queued(epoch, msg_id)", tombstone);
const ackAfter = cleanup.indexOf("service_source_cleanup_evidence()", rememberId);
assert.ok(weatherRequest >= 0 && modbusRequest > weatherRequest && env3Request > modbusRequest &&
  ackBefore > env3Request && action > ackBefore && tombstone > action && rememberId > tombstone &&
  ackAfter > rememberId,
"all request bits must be admitted before one tracked tombstone, with ACK evidence drained on both sides");
assert.doesNotMatch(cleanup, /retract_(?:modbus|weather|env3)_discovery\(1\)/,
  "the ACK-driven boundary must never burst a source's discovery tombstones");
assert.doesNotMatch(cleanup, /publish_(?:x10a|modbus_state|weather_state|heartbeat|crash|env3_state|env3_discovery)/,
  "the X10A-free exception must remain delete-only");
assert.match(mqtt,
  /case MQTT_EVENT_PUBLISHED:[\s\S]*?s_source_cleanup_evidence\.push[\s\S]*?MqttCleanupDeliveryOutcome::Published/,
  "MQTT_EVENT_PUBLISHED must hand bounded client-scoped evidence to mqtt_task");
assert.match(mqtt,
  /case MQTT_EVENT_DELETED:[\s\S]*?s_source_cleanup_evidence\.push[\s\S]*?MqttCleanupDeliveryOutcome::Deleted/,
  "MQTT_EVENT_DELETED must hand exact outbox-loss evidence to mqtt_task");
assert.match(sdkconfigDefaults, /^CONFIG_MQTT_REPORT_DELETED_MESSAGES=y$/m,
  "ESP-MQTT must report every expired QoS outbox item instead of silently stranding cleanup");
assert.match(sdkconfigDefaults, /^CONFIG_MQTT_MSG_ID_INCREMENTAL=y$/m,
  "ESP-MQTT packet ids must be incremental so cleanup evidence cannot alias concurrent traffic");
assert.match(mqtt,
  /esp_mqtt_client_enqueue\(s_client[\s\S]*?static RetainedCleanupCycle service_requested_topic_cleanup[\s\S]*?mqtt_enqueue_id\(topic, "", 0, 1, 1\)/,
  "source cleanup must use the unambiguous asynchronous enqueue API rather than publish's queued-but-minus-one path");
assert.match(mqtt, /cfg\.outbox\.limit\s*=\s*MQTT_OUTBOX_LIMIT_BYTES/,
  "esp-mqtt must have an explicit bounded outbox for rare non-source QoS-1 overlap");
assert.match(mqtt, /MQTT_OUTBOX_LIMIT_BYTES\s*=\s*8 \* 1024/,
  "the outbox cap must retain headroom for bounded crash/probe/availability traffic");

const connectedStart = mqtt.indexOf("case MQTT_EVENT_CONNECTED:");
const connectedEnd = mqtt.indexOf("case MQTT_EVENT_DISCONNECTED:", connectedStart);
const connected = mqtt.slice(connectedStart, connectedEnd);
assert.match(connected, /s_connected_client_epoch\.store\(s_mqtt_client_epoch\.load/,
  "a connection must publish the stable client epoch to the scheduler");
assert.ok(connected.indexOf("s_connected_client_epoch.store") <
  connected.indexOf("s_connected.store(true, std::memory_order_release)"),
"the event task must publish the epoch before exposing the connected client");
assert.doesNotMatch(connected, /s_(?:weather|modbus|env3)_cleanup_requested\.store/,
  "a normal reconnect of the same client must not duplicate a complete cleanup run");
assert.match(mqtt,
  /esp_mqtt_client_stop\(s_client\)[\s\S]*?s_source_cleanup\.invalidate_client\(\)[\s\S]*?esp_mqtt_client_destroy\(s_client\)/,
  "publisher promotion must invalidate the old id after stop and before destroy");
assert.match(mqtt,
  /mqtt_transport_pause_if_requested[\s\S]*?esp_mqtt_client_stop\(s_client\)[\s\S]*?source_cleanup_outbox_cleared_after_transport_stop\(\)/,
  "OTA/Weather transport pause must release the cleanup id whose outbox item stop deleted");
assert.match(mqtt,
  /mqtt_cleanup_evidence_recovery_step[\s\S]*?esp_mqtt_client_stop\(s_client\)[\s\S]*?source_cleanup_outbox_cleared_after_transport_stop\(\)/,
  "a fixed evidence-ring overflow must stop and clear the outbox before bounded retry");

// Frozen ledgers prevent future catalog rows from inventing tombstones that were never published.
assert.match(mqtt,
  /static_assert\(MQTT_WEATHER_CLEANUP_DISCOVERY_COUNT == RETIRED_WEATHER_HA_SENSOR_COUNT\)/);
assert.match(mqtt,
  /static_assert\(MQTT_MODBUS_CLEANUP_DISCOVERY_COUNT == RETIRED_MODBUS_HA_SENSOR_COUNT\)/);
assert.match(mqtt,
  /static_assert\(MQTT_ENV3_CLEANUP_DISCOVERY_COUNT == ENV3_HA_SENSOR_COUNT\)/);
const retiredLedgerStart = discovery.indexOf(
  "inline constexpr RetiredModbusHaSensor RETIRED_MODBUS_HA_SENSORS[]");
const retiredLedgerEnd = discovery.indexOf("inline constexpr int RETIRED_MODBUS_HA_SENSOR_COUNT",
  retiredLedgerStart);
const retiredLedger = discovery.slice(retiredLedgerStart, retiredLedgerEnd);
assert.equal([...retiredLedger.matchAll(
  /\{"(sensor|binary_sensor)",\s*"([^"]+)"\}/g)].length, 27,
"retired HomeHub cleanup must keep the exact frozen 27-topic ledger");
assert.doesNotMatch(retiredLedger,
  /compressor_running|booster_heater_run|disinfection_operation|current_operation_mode|leaving_water_main_heating_offset/,
  "HomeHub rows added after discovery retirement must not acquire invented tombstones");
const retiredWeatherLedgerStart = weatherMqtt.indexOf(
  "inline const RetiredHaSensor RETIRED_WEATHER_HA_SENSORS[]");
const retiredWeatherLedgerEnd = weatherMqtt.indexOf(
  "inline constexpr int RETIRED_WEATHER_HA_SENSOR_COUNT", retiredWeatherLedgerStart);
const retiredWeatherEntries = [...weatherMqtt.slice(
  retiredWeatherLedgerStart, retiredWeatherLedgerEnd).matchAll(
  /\{"(sensor|binary_sensor)",\s*"([^"]+)"\}/g)].map((m) => `${m[1]}/${m[2]}`);
assert.deepEqual(retiredWeatherEntries, [
  "sensor/weather_forecast_outdoor_mean_2h",
  "sensor/weather_forecast_solar_energy_2h",
  "binary_sensor/weather_forecast_available",
  "binary_sensor/weather_forecast_fresh",
], "retired Weather cleanup must keep the exact frozen four-topic ledger");

const taskStart = mqtt.indexOf("static void mqtt_task(void*)");
const taskEnd = mqtt.indexOf("static bool build_client(", taskStart);
const task = mqtt.slice(taskStart, taskEnd);
const refs = task.indexOf("service_reference_frames(ref_config)");
const requestedCleanup = task.indexOf("service_requested_topic_cleanup(ref_config)");
const ordinaryGate = task.indexOf("if (gate.publish_cycle)", requestedCleanup);
assert.ok(refs >= 0 && requestedCleanup > refs && ordinaryGate > requestedCleanup,
  "source tombstones must run with inbound MQTT, outside X10A publication authority");
const publishCycleBody = task.slice(ordinaryGate);
assert.match(publishCycleBody, /if \(!cleanup_cycle\.weather\)[\s\S]*?publish_weather_state/,
  "requested Weather cleanup must suppress stale-snapshot publication");
assert.match(publishCycleBody,
  /if \(!cleanup_cycle\.modbus\)[\s\S]*?retained_source_action\(mb_target_enabled\(\), s_modbus_disabled_cleaned\)/,
  "requested HomeHub cleanup must suppress stale-snapshot publication");
assert.match(publishCycleBody, /if \(!cleanup_cycle\.env3\)[\s\S]*?publish_env3_(?:discovery|state)/,
  "requested ENV III cleanup must suppress state and discovery recreation");
assert.doesNotMatch(publishCycleBody,
  /mqtt_publish\(s_(?:weather|modbus|env3), "", 0, 1, 1\)/,
  "ordinary source branches must use the scheduler");

assert.match(publishGate,
  /retained_source_action\(bool target_enabled,[\s\S]*?if \(target_enabled\) return RetainedSourceAction::PublishCurrent;[\s\S]*?retained_deleted \? RetainedSourceAction::Idle\s*:\s*RetainedSourceAction::DeleteRetained/);
assert.match(modbusHeader, /bool mb_target_enabled\(\) noexcept;/);
assert.match(modbus,
  /bool mb_target_enabled\(\) noexcept \{[\s\S]*?s_target_enabled\.load\(std::memory_order_acquire\)/);

// Settings requests stay after durable persistence and synchronous source cutover.
const setHpStart = http.indexOf("static esp_err_t set_hp(");
const setHpEnd = http.indexOf("static esp_err_t discover_homehub_now", setHpStart);
const setHp = http.slice(setHpStart, setHpEnd);
const hpSave = setHp.indexOf("config_save(c, /*require_link=*/x10a_sent)");
const hpReconfigure = setHp.indexOf("mb_reconfigure(modbus_enabled)", hpSave);
const hpRequest = setHp.indexOf("mqtt_request_modbus_cleanup()", hpReconfigure);
assert.ok(hpSave >= 0 && hpReconfigure > hpSave && hpRequest > hpReconfigure,
  "HomeHub cleanup admission must follow persistence and synchronous cutover");
const setWeatherStart = http.indexOf("static esp_err_t set_weather(");
const setWeatherEnd = http.indexOf("static esp_err_t set_board", setWeatherStart);
const setWeather = http.slice(setWeatherStart, setWeatherEnd);
assert.ok(setWeather.indexOf("mqtt_request_weather_cleanup()") > setWeather.indexOf("config_save(c)"),
  "Weather cleanup admission must follow persistence");
const setDiagnosticsStart = http.indexOf("static esp_err_t set_diagnostics(");
const setDiagnosticsEnd = http.indexOf("static esp_err_t set_circulation", setDiagnosticsStart);
const setDiagnostics = http.slice(setDiagnosticsStart, setDiagnosticsEnd);
assert.ok(setDiagnostics.indexOf("mqtt_request_weather_cleanup()") >
  setDiagnostics.indexOf("config_save(c)"),
"diagnostics-consent cleanup admission must follow persistence");
assert.equal((http.match(/mqtt_request_weather_cleanup\(\)/g) || []).length, 2,
  "only Weather source and diagnostics consent routes may request Weather cleanup");

console.log("MQTT source cleanup: 37 tombstones are PUBACK-serialized and source-suppressing");
