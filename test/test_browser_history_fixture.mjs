import assert from "node:assert/strict";
import fs from "node:fs";

// Full-day, source-qualified telemetry for the live-poll history matrix. These expected inspector
// classifications are independent of INSPECT so a new production entry cannot silently evade it.
export const INSPECTOR_TRENDS = Object.freeze({
  env3: "env3_combined", sgrequest: "smart_grid_mode", comp: "comp_rps",
  out: "outdoor_air", ouhx: "outdoor_heat_exchanger", hp: "circuit_pressure",
  disch: "discharge", eev: "eev", r3t: "refrigerant_liquid", lwt: "leaving_water",
  r2t: "leaving_water_post_buh", rwt: "return_water", dt: "dt", pth: "pth",
  buh: "buh_state", bsh: "bsh_state", valve: "valve_dhw", valve2: "valve_heat",
  tank: "dhw_tank", room: "room_temp", pump: "pump_speed",
  defrost: "defrost_state", quiet: "quiet_state", flow: "flow",
  flow_switch: "water_flow_switch", wp: "water_pressure",
});

export const NO_HISTORY_INSPECTORS = Object.freeze([
  "status", "ou", "lp", "phe", "heat", "spaceh", "rhot", "rcold", "wsup", "wtank",
  "wheat", "wret", "pel", "cop",
]);

// Tank preheat is an auxiliary raw row outside the schematic; categorical disclosures use the
// Modbus-only case.
export const OMITTED_HISTORY_MOTION_ROWS = Object.freeze({
  tank_preheat_state: "Auxiliary raw detail without its own schematic inspector",
});

// Stable labels/pages are the real X10A rows used by liveData and the catalog-backed demo. Board
// memory and the MQTT circulation witness have device histories but are not X10A value rows.
export const HISTORY_MOTION_ROWS = Object.freeze([
  { id: "leaving_water", label: "Leaving water temp. before BUH (R1T)", unit: "°C", value: 45, reg: 0x61 },
  { id: "leaving_water_post_buh", label: "Leaving water temp. after BUH (R2T)", unit: "°C", value: 45, reg: 0x61 },
  { id: "return_water", label: "Inlet water temp.(R4T)", unit: "°C", value: 40, reg: 0x61 },
  { id: "refrigerant_liquid", label: "Refrig. Temp. liquid side (R3T)", unit: "°C", value: 41, reg: 0x61 },
  { id: "circuit_pressure", label: "Refrigerant pressure sensor", unit: "bar", value: 32, reg: 0x62 },
  { id: "dhw_tank", label: "DHW tank temp. (R5T)", unit: "°C", value: 42, reg: 0x61 },
  { id: "outdoor_air", label: "R1T-Outdoor air temp.", unit: "°C", value: 8, reg: 0x20 },
  { id: "outdoor_heat_exchanger", label: "O/U Heat Exch. Temp.(R4T)", unit: "°C", value: 1, reg: 0x20 },
  { id: "discharge", label: "Discharge pipe temp.", unit: "°C", value: 65, reg: 0x20 },
  { id: "comp_rps", label: "INV frequency (rps)", unit: "rps", value: 42, reg: 0x30 },
  { id: "eev", label: "Expansion valve 1 (pls)", unit: "pls", value: 360, reg: 0x21 },
  { id: "flow", label: "Flow sensor (l/min)", unit: "l/min", value: 24.5, reg: 0x62 },
  { id: "room_temp", label: "Indoor ambient temp. (R1T)", unit: "°C", value: 21, reg: 0x61 },
  { id: "water_pressure", label: "Water pressure", unit: "bar", value: 1.5, reg: 0x62 },
  { id: "inv_current", label: "INV primary current (A)", unit: "A", value: 8.3, reg: 0x21 },
  { id: "ct_l1", label: "Current measured by CT sensor of L1", unit: "A", value: 4.8, reg: 0x63 },
  { id: "ct_l2", label: "Current measured by CT sensor of L2", unit: "A", value: 4.4, reg: 0x63 },
  { id: "ct_l3", label: "Current measured by CT sensor of L3", unit: "A", value: 4.0, reg: 0x63 },
  { id: "pump_signal", label: "Water pump signal (0:max-100:stop)", unit: "%", value: 18, reg: 0x62 },
  { id: "defrost_state", label: "Defrost Operation", value: 0, reg: 0x10, binary: true },
  { id: "quiet_state", label: "Silent Mode", value: 0, reg: 0x60, binary: true },
  { id: "bsh_state", label: "BSH", value: 0, reg: 0x60, binary: true },
  { id: "buh_step1", label: "BUH Step1", value: 0, reg: 0x60, binary: true },
  { id: "buh_step2", label: "BUH Step2", value: 0, reg: 0x60, binary: true },
  { id: "valve_dhw", label: "3way valve(On:DHW_Off:Space)", value: 1, reg: 0x60,
    binary: true, binary_semantic: "valve_dhw" },
  { id: "valve_heat", label: "2way valve(On:Heat_Off:Cool)", value: 1, reg: 0x60,
    binary: true, binary_semantic: "valve_heat" },
  { id: "water_flow_switch", label: "Water flow switch", value: 1, reg: 0x60, binary: true },
  { id: "smart_grid_mode", label: "Smart Grid operation mode", value: 2, enum: "smart_grid_mode", kind: "contacts" },
  { id: "free_heap", label: "Free heap", value: 180, unit: "KiB", kind: "board" },
  { id: "max_alloc", label: "Largest free block", value: 96, unit: "KiB", kind: "board" },
  { id: "circulation_state", label: "DHW circulation pump", value: 1, binary: true, kind: "mqtt" },
]);

// HOMEHUB_HISTORIES, not MB_PAIRS, is the offer boundary. In particular, water pressure has a
// possible current-value pairing but no HomeHub history. Power is likewise not a historied row.
export const MODBUS_HISTORY_ROWS = Object.freeze([
  { id: "leaving_water", label: "Leaving water temperature PHE", off: 40, value: 45.1, unit: "°C" },
  { id: "leaving_water_post_buh", label: "Leaving water temperature BUH", off: 41, value: 45.1, unit: "°C" },
  { id: "return_water", label: "Return water temperature", off: 42, value: 40.1, unit: "°C" },
  { id: "dhw_tank", label: "Domestic Hot Water temperature", off: 43, value: 42.1, unit: "°C" },
  { id: "outdoor_air", label: "Outside air temperature", off: 44, value: 8.1, unit: "°C" },
  { id: "refrigerant_liquid", label: "Liquid refrigerant temperature", off: 45, value: 41.1, unit: "°C" },
  { id: "flow", label: "Flow rate", off: 49, value: 24.6, unit: "L/min", flow_scale_unverified: true },
  { id: "room_temp", label: "Remote controller room temperature Main", off: 50, value: 21.1, unit: "°C" },
  { id: "bsh_state", label: "Booster heater run", off: 32, value: 0, binary: true },
  { id: "valve_dhw", label: "3-way valve", off: 37, value: 0, enum: "three_way_valve" },
  // Stale API negative control. Current firmware retains the storage slot but does not serve it.
  { id: "quiet_state", label: "Quiet mode operation", off: 9, value: 0, binary: true },
  { id: "smart_grid_mode", label: "Smart-Grid operation mode", off: 56, value: 2, enum: "smart_grid_mode" },
  { id: "disinfection_state", label: "Disinfection operation", off: 33, value: 0, binary: true },
]);

export const ENV3_HISTORY_ROWS = Object.freeze([
  { id: "env3_temperature", label: "ENV III temperature", value: 8.2, unit: "°C" },
  { id: "env3_humidity", label: "ENV III humidity", value: 72, unit: "%" },
  { id: "env3_pressure", label: "ENV III air pressure", value: 1013, unit: "hPa" },
]);

const END = Date.parse("2026-11-05T12:00:00Z") / 1000;
const BOOT_ID = "history-motion-fixture";
const EPOCH = 1;

function ring(row, source) {
  const seed = [...row.id + source].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const state = row.binary || row.enum;
  const gapPeriod = { x10a: 61, modbus: 67, env3: 71, room: 53 }[source];
  const base = row.value;
  return {
    id: row.id, label: row.label, source: row.kind === "mqtt" ? "mqtt" : source,
    boot_id: BOOT_ID, epoch: EPOCH, dt: 300, b0: 1000,
    t0: END - 287 * 300, unit: row.unit || "", held: [],
    v: Array.from({ length: 288 }, (_, index) => {
      if ((index + seed) % gapPeriod === 17) return null;
      if (row.enum === "smart_grid_mode") return (Math.floor(index / 18) % 4) * 10;
      if (state) return Math.floor((index + seed) / 24) % 2 ? 10 : 0;
      const amplitude = Math.max(0.2, Math.min(Math.abs(base) * 0.01, 1.5));
      return Math.round((base + amplitude * Math.sin((index + seed) / 13)) * 10);
    }),
  };
}

function reading(row, tick) {
  const { id, value, kind: _kind, ...metadata } = row;
  const vary = row.unit && !["rps", "pls", "%", "KiB"].includes(row.unit);
  return { ...metadata, concept: id,
    value: String(value + (vary ? (tick % 10) / 100 : 0)), unit: row.unit || "" };
}

export function makeHistoryMotionFixture(originalStatus, lang = "en") {
  const status = structuredClone(originalStatus);
  Object.assign(status, {
    boot_id: BOOT_ID, uptime_s: 86400,
    ui: { ...status.ui, lang },
    hp: { ...status.hp, connected: true, values: 40, last_ok_s: 0, proto: "I", rx: 44, tx: 43 },
    modbus: { ...status.modbus, host: "192.0.2.20", port: 502, unit_id: 1,
      profile: "homehub", enabled: true, connected: true, values: 20 },
    mqtt: { ...status.mqtt, configured: true, connected: true },
    sys: { ...status.sys, free_heap: 180 * 1024, max_alloc: 96 * 1024, safe_mode: false },
    diagnostics: { ...status.diagnostics, enabled: true },
    ntp: { ...status.ntp, synced: true, time: new Date(END * 1000).toISOString() },
    history: {
      epoch: EPOCH,
      modbus_binding: true,
      rows: HISTORY_MOTION_ROWS.map(({ id, label }) => ({ id, label })),
      modbus_rows: MODBUS_HISTORY_ROWS.map(({ id, label }) => ({ id, label })),
      env3_rows: ENV3_HISTORY_ROWS.map(({ id, label }) => ({ id, label })),
      room_rows: [{ id: "room_temp", label: "Example room" }],
    },
    env3: { ...status.env3, supported: true, enabled: true, connected: true,
      sda: 5, scl: 6, fresh: true, age_s: 0, error: "", samples: 288, errors: 0,
      temperature_c: 8.2, humidity_pct: 72, pressure_hpa: 1013 },
    weather_forecast: { ...status.weather_forecast, configured: true, available: true, fresh: true,
      latitude: "12.345678", longitude: "23.456789", fetching: false,
      hourly: Array.from({ length: 6 }, (_, index) => ({ time_unix_s: END + (index + 1) * 3600,
        temperature_c: 8.5 + index / 2, humidity_pct: 71 - index, pressure_hpa: 1013 + index / 2 })) },
    reference_temperature: { configured: true, name: "Example room", topic: "fixture/room",
      temperature_path: "temperature", timestamp_topic: "", timestamp_path: "timestamp",
      source_id: "fixture-room", calibration_k: 0, max_age_s: 300,
      temperature_min_c: -10, temperature_max_c: 50,
      subscribed: true, has_value: true, temperature_c: 21.3, fresh: true,
      temperature_valid: true, has_setpoint: true, setpoint_c: 21, enabled: true, hvac_mode: "heat",
      control_eligible: false, reason: "disabled", freshness_reason: "fresh", age_s: 0,
      received_at: END, received_ago_s: 0, source_at: END, source_unix_s: END,
      timestamp_source: "source", retained: false },
    circulation_source: { configured: true, name: "Example circulation pump", topic: "fixture/circulation",
      power_path: "power", timestamp_path: "timestamp", max_age_s: 300,
      on_threshold_w: 5, off_threshold_w: 2, confirm_s: 30,
      subscribed: true, has_value: true, power_w: 25, fresh: true, state: "on", age_s: 0,
      source_at: END, source_unix_s: END, timestamp_source: "source", retained: false },
  });
  const histories = {};
  for (const row of HISTORY_MOTION_ROWS) histories[`x10a:${row.id}`] = ring(row, "x10a");
  for (const row of MODBUS_HISTORY_ROWS) histories[`modbus:${row.id}`] = ring(row, "modbus");
  const provisionalFlow = histories["modbus:flow"];
  provisionalFlow.b0--;
  provisionalFlow.t0 -= provisionalFlow.dt;
  provisionalFlow.v[0] = 10000;
  for (const row of ENV3_HISTORY_ROWS) histories[`env3:${row.id}`] = ring(row, "env3");
  histories["room:room_temp"] = ring({ id: "room_temp", label: "Example room",
    value: 21.3, unit: "°C" }, "room");

  const values = (tick = 0) => ({
    values: [
      { label: "I/U operation mode", value: "Heating + DHW", reg: 0x60 },
      { label: "Operation Mode", value: "Heating", reg: 0x10 },
      ...HISTORY_MOTION_ROWS.filter(row => !row.kind).map(row => reading(row, tick)),
      { label: "High Pressure", value: "32", unit: "bar", reg: 0x20 },
      { label: "Low Pressure", value: "5", unit: "bar", reg: 0x20 },
      { label: "Fan 1 (step)", value: "5", unit: "", reg: 0x30 },
      { label: "DHW setpoint", value: "48", unit: "°C", reg: 0x60 },
      { label: "LW setpoint (main)", value: "45", unit: "°C", reg: 0x60 },
      { label: "RT setpoint", value: "21", unit: "°C", reg: 0x60 },
      { label: "Water pump operation", value: "1", unit: "", reg: 0x60,
        binary: true, concept: "pump_running" },
      { label: "Space heating Operation ON/OFF", value: "1", unit: "", reg: 0x62,
        binary: true, concept: "space_op" },
      { label: "Smart Grid contact 1", value: "1", unit: "", reg: 0x60,
        binary: true, binary_semantic: "smart_grid_contact_1" },
      { label: "Smart Grid contact 2", value: "0", unit: "", reg: 0x60,
        binary: true, binary_semantic: "smart_grid_contact_2" },
    ],
    modbus_history_epoch: EPOCH,
    modbus_history_boot_id: BOOT_ID,
    modbus: [
      ...MODBUS_HISTORY_ROWS.map(row => {
        const value = reading(row, tick);
        return { ...value, value: Number(value.value), history: row.id, profile: "homehub" };
      }),
      { label: "Circulation pump running", value: 1, unit: "", off: 30, binary: true },
      { label: "Compressor running", value: 1, unit: "", off: 31, binary: true },
      { label: "DHW normal operation", value: 1, unit: "", off: 52, binary: true },
      { label: "Space heating/cooling normal operation", value: 1, unit: "", off: 53, binary: true },
      { label: "Current operation mode", value: 1, unit: "", off: 38, enum: "current_operation_mode" },
      { label: "Heat pump power consumption", value: 2.1, unit: "kW", off: 51 },
    ],
  });
  return { status, histories, values };
}

export function assertHistoryMotionFixtureInventory() {
  const raw = fs.readFileSync(new URL("../main/logic/history.hpp", import.meta.url), "utf8");
  const modbus = fs.readFileSync(new URL("../main/logic/homehub_map.hpp", import.meta.url), "utf8");
  const runner = fs.readFileSync(new URL("../scripts/run-browser-render-tests.sh", import.meta.url), "utf8");
  const filter = runner.match(/ui_pattern='([^']+)'/);
  assert.ok(filter, "browser change filter must remain inspectable");
  for (const file of ["main/logic/history.hpp", "main/logic/homehub_map.hpp"])
    assert.match(file, new RegExp(filter[1]), "history-table-only changes must run the browser inventory gate");
  const table = (source, declaration) => {
    const start = source.indexOf(declaration), end = source.indexOf("\n};", start);
    assert.ok(start >= 0 && end > start, "history inventory declaration must remain present");
    return source.slice(start + declaration.length, end);
  };
  const rawIds = source => [...table(source, "TRENDS[] = {")
    .matchAll(/\{\s*"([a-z0-9_]+)"\s*,\s*TrendKind::/g)].map(match => match[1]).sort();
  const modbusIds = source => [...table(source, "HOMEHUB_HISTORIES[] = {")
    .matchAll(/\{\s*(\d+)\s*,\s*"([a-z0-9_]+)"\s*,/g)]
    .map(match => match[2] + "@" + match[1]).sort();
  const checkRaw = source => assert.deepEqual(rawIds(source),
    [...HISTORY_MOTION_ROWS.map(row => row.id), ...Object.keys(OMITTED_HISTORY_MOTION_ROWS)].sort(),
    "raw history fixture inventory must classify every firmware trend");
  const checkModbus = source => assert.deepEqual(modbusIds(source),
    MODBUS_HISTORY_ROWS.map(row => row.id + "@" + row.off).sort(),
    "HomeHub history fixture inventory must match every supported id and offset");
  checkRaw(raw); checkModbus(modbus);
  // A new firmware ring can make an existing implicit inspector (such as low pressure) trended
  // without adding an INSPECT key. Prove this separate source-inventory boundary cannot pass empty.
  assert.throws(() => checkRaw(raw.replace("TRENDS[] = {",
    'TRENDS[] = {\n{"fixture_added", TrendKind::Row, 0, 0, "", ""},')),
  /raw history fixture inventory must classify every firmware trend/);
  assert.throws(() => checkModbus(modbus.replace("HOMEHUB_HISTORIES[] = {",
    'HOMEHUB_HISTORIES[] = {\n{999, "fixture_added", false, false, HOMEHUB_DECODE_TEMP},')),
  /HomeHub history fixture inventory must match every supported id and offset/);
  return { raw: rawIds(raw).length, modbus: modbusIds(modbus).length,
    explicitOmissions: Object.keys(OMITTED_HISTORY_MOTION_ROWS).length };
}

assertHistoryMotionFixtureInventory();
