// Execute the actual mapping and history consumers: source identity is independent of a plausible
// value, a recent fetch and a request that happened to finish after a replacement was configured.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (file) => fs.readFileSync(new URL(`../main/www/js/${file}.js`, import.meta.url), "utf8");
const elements = new Map();
const $ = (id) => {
  if (!elements.has(id)) elements.set(id, { value: "", disabled: false });
  return elements.get(id);
};
const pending = [];
const context = {
  $, LANG: "en", pollSignal: () => undefined, hpProbeIsOpen: () => false,
  setLangFromStatus: async () => {}, displayUnit: (j) => j.unit,
  j: async () => context.nextStatus,
  fetch: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
};
vm.createContext(context);
const settings = read("settings");
vm.runInContext(read("app_state") + "\n" + read("history") + "\n" +
  settings.slice(settings.indexOf("function fillRefTemp()"),
    settings.indexOf("// ── DHW circulation-pump")) + `
  renderApp = () => {};
  hydrateRoutedPopup = () => {};
  this.ui = { S, refreshStatus, fillRefTemp, refTempFormPayload, formatRefSource, parseRefSource,
    ensureHist, ensureDerived, syncHistSources };
`, context);
const ui = context.ui;
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixture = () => ({
  version: "test", app_elf_sha256: "app-a", uptime_s: 100, boot_id: "boot-a",
  profile: { id: "profile-a" }, hp: { proto: "I", rx: 44, tx: 43 },
  detect: { valid: true, capacity_kw: 6, capacity_kw_iu: 8, ou_eeprom: "1234" },
  modbus: { host: "hub-a", port: 502, unit_id: 1 },
  env3: { supported: true, enabled: true, sda: 2, scl: 1 },
  board: { preset_id: "atom_s3_lite" }, diagnostics: { enabled: true },
  circulation_source: { configured: true, topic: "pump/a", power_path: "watts",
    timestamp_path: "time", max_age_s: 120, on_threshold_w: 3, off_threshold_w: 1, confirm_s: 60 },
  history: {
    epoch: 1,
    rows: ["dhw_tank", "leaving_water", "return_water", "free_heap", "max_alloc", "circulation_state"]
      .map((id) => ({ id, label: id })),
    modbus_rows: ["dhw_tank", "disinfection_state"].map((id) => ({ id, label: id })),
    env3_rows: [{ id: "env3_temperature", label: "Temperature" }],
  },
});
const status = async (value) => {
  context.nextStatus = value;
  assert.equal(await ui.refreshStatus(false), true);
};
const reset = async () => {
  for (const key of ["hist", "histRequests", "histPin"]) ui.S[key].clear();
  ui.S.histBusy.clear();
  ui.S.histAwait?.clear();
  ui.S.histIdentity = null;
  ui.S.histUptime = null;
  ui.S.scrub = null;
  pending.length = 0;
  await status(fixture());
};
const sample = (value, epoch = 1, boot_id = "boot-a") => ({
  dt: 300, unit: "°C", label: "Temperature", v: [value], epoch, boot_id,
});
const reply = (request, value, epoch = 1, boot_id = "boot-a") => request.resolve({
  json: async () => sample(value, epoch, boot_id),
});
await reset();

// Actual historical unchanged-save witness: missing time must stay absent, with hidden gates intact.
const room = { configured: true, name: "Room", topic: "room/state", temperature_path: "temperature",
  setpoint_topic: "", setpoint_path: "", fixed_setpoint_c: 20,
  timestamp_topic: "", timestamp_path: "", enabled_path: "enabled", hvac_mode_path: "mode",
  max_age_s: 600 };
ui.S.status.reference_temperature = room;
ui.fillRefTemp();
assert.equal($("rtTimestampSource").value, "");
let saved = ui.refTempFormPayload();
assert.equal(saved.timestamp_topic, "");
assert.equal(saved.timestamp_path, "");
assert.equal(saved.enabled_path, "enabled");
assert.equal(saved.hvac_mode_path, "mode");

// Older source mappings use the temperature topic implicitly. Normalizing their visible topics
// does not change the mapping and must not discard invisible eligibility gates.
ui.S.status.reference_temperature = { ...room, fixed_setpoint_c: null,
  setpoint_path: "target", timestamp_path: "time" };
ui.fillRefTemp();
saved = ui.refTempFormPayload();
assert.equal(saved.setpoint_topic, "room/state");
assert.equal(saved.timestamp_topic, "room/state");
assert.equal(saved.enabled_path, "enabled");
assert.equal(saved.hvac_mode_path, "mode");
$("rtTemperatureSource").value = "other/state$temperature";
saved = ui.refTempFormPayload();
assert.equal(saved.enabled_path, "");
assert.equal(saved.hvac_mode_path, "");

// Dollars and backslashes belong to MQTT topics/JSON keys too. Exercise canonical forms, plain
// legacy syntax and dollar-prefixed broker topics rather than matching parser source text.
for (const [topic, path] of [
  ["room/state", "price$temperature"], ["room$state", "temperature"],
  ["room$state", ""], ["$SYS/room", "t$C"],
  ["room\\state", "sensor\\$temperature"], ["room\\$state\\", "\\$key\\"],
  [" room/state ", " temperature.. "], [" room$state\\ ", " .bad$path\\ "],
  [" room/state ", ""], [" ", " . "],
  ["20", ""],
  ["$".repeat(192), "$".repeat(128)],
]) assert.deepEqual(plain(ui.parseRefSource(ui.formatRefSource(topic, path))), { topic, path });
const html = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
for (const id of ["rtTemperatureSource", "rtTarget", "rtTimestampSource"])
  assert.match(html, new RegExp(`id="${id}" maxlength="641"`));
assert.deepEqual(plain(ui.parseRefSource("room/state$temperature")),
  { topic: "room/state", path: "temperature" });
assert.deepEqual(plain(ui.parseRefSource("$SYS/room$temp")), { topic: "$SYS/room", path: "temp" });
assert.deepEqual(plain(ui.parseRefSource("room\\state$temp\\raw")),
  { topic: "room\\state", path: "temp\\raw" });
ui.S.status.reference_temperature = { ...room, topic: "room$state\\", temperature_path: "t\\$C",
  setpoint_topic: "target$state", setpoint_path: "target\\value", fixed_setpoint_c: null,
  timestamp_topic: "$SYS/clock", timestamp_path: "unix$seconds" };
ui.fillRefTemp();
saved = ui.refTempFormPayload();
for (const [field, sourceField] of [["topic", "topic"], ["temperature_path", "temperature_path"],
  ["setpoint_topic", "setpoint_topic"], ["setpoint_path", "setpoint_path"],
  ["timestamp_topic", "timestamp_topic"], ["timestamp_path", "timestamp_path"],
  ["enabled_path", "enabled_path"], ["hvac_mode_path", "hvac_mode_path"]])
  assert.equal(saved[field], ui.S.status.reference_temperature[sourceField]);

// Valid topic spaces and unverified path bytes are operator intent. Opening the form must not
// normalize them, silently replace the subscription or clear hidden eligibility gates.
for (const mapping of [
  { topic: " room/state ", temperature_path: " temperature.. ",
    setpoint_topic: " target/state ", setpoint_path: " target.. ",
    timestamp_topic: " clock/state ", timestamp_path: " source..time " },
  { topic: " room$state\\ ", temperature_path: " .bad$path\\ ",
    setpoint_topic: "", setpoint_path: " target.. ",
    timestamp_topic: "", timestamp_path: " time.. " },
  { topic: " room/state ", temperature_path: "", setpoint_topic: " 20 ", setpoint_path: "",
    timestamp_topic: " clock/state ", timestamp_path: "" },
]) {
  ui.S.status.reference_temperature = { ...room, fixed_setpoint_c: null, ...mapping };
  ui.fillRefTemp();
  saved = ui.refTempFormPayload();
  assert.equal(saved.topic, mapping.topic);
  assert.equal(saved.temperature_path, mapping.temperature_path);
  assert.equal(saved.setpoint_topic, mapping.setpoint_topic || mapping.topic);
  assert.equal(saved.setpoint_path, mapping.setpoint_path);
  assert.equal(saved.timestamp_topic, mapping.timestamp_topic || mapping.topic);
  assert.equal(saved.timestamp_path, mapping.timestamp_path);
  assert.equal(saved.fixed_setpoint_c, 0, "numeric-looking MQTT topic stays a mapped target");
  assert.equal(saved.enabled_path, "enabled");
  assert.equal(saved.hvac_mode_path, "mode");
}

// A history response carries its own snapshot lifetime. A request begun under the last status
// cannot admit samples from a reset or a reboot that status has not observed yet. A refusal neither
// caches a one-minute error nor re-asks at once: production re-renders after every request, so an
// immediate retry only repeated the refusal against the single httpd task until /status caught up.
for (const [epoch, boot, missing] of [[2, "boot-a", false], [1, "boot-b", false],
  [1, "boot-a", true]]) {
  await reset();
  const loading = ui.ensureHist("dhw_tank");
  const request = pending.shift();
  const body = sample(111, epoch, boot);
  if (missing) { delete body.epoch; delete body.boot_id; }
  request.resolve({ json: async () => body });
  await loading;
  assert.equal(ui.S.hist.has("dhw_tank"), false, "unmatched snapshot identity is refused");
  assert.equal(ui.S.histBusy.has("dhw_tank"), false, "refusal releases the request");
  await ui.ensureHist("dhw_tank");
  assert.equal(pending.length, 0, "a refused identity waits instead of re-asking at once");
  const next = fixture(); next.history.epoch = 2;
  await status(next);
  const retry = ui.ensureHist("dhw_tank");
  assert.equal(pending.length, 1, "the next status lifetime retries the refused row");
  reply(pending.shift(), 222, 2); await retry;
  assert.equal(ui.S.hist.get("dhw_tank").v[0], 222);
}
// Without a new lifetime, one status period releases the wait as well.
await reset();
let loading = ui.ensureHist("dhw_tank");
reply(pending.shift(), 111, 2); await loading;
await ui.ensureHist("dhw_tank");
assert.equal(pending.length, 0);
ui.S.histAwait.get("dhw_tank").at -= 8000;
loading = ui.ensureHist("dhw_tank");
assert.equal(pending.length, 1, "a refused row is retried after one status period");
reply(pending.shift(), 222); await loading;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 222);

// The inspector re-enters ensureHist from every render. The firmware's own epoch-less 503 body
// ("history changed; retry") must not turn that re-entry into a back-to-back request loop.
await reset();
const quietRender = context.renderApp;
context.renderApp = () => { ui.ensureHist("dhw_tank"); };
loading = ui.ensureHist("dhw_tank");
pending.shift().resolve({ json: async () => ({ ok: false, error: "history changed; retry" }) });
await loading;
for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(pending.length, 0, "a refused reply does not re-enter as a request loop");
context.renderApp = quietRender;

// A derived chart whose input was refused for identity is pending, not "Trend unavailable.".
await reset();
const refusedDerived = ui.ensureHist("dt");
const [leavingRefused, returnRefused] = [pending.shift(), pending.shift()];
reply(leavingRefused, 250, 2); reply(returnRefused, 200, 2);
await refusedDerived;
assert.equal(ui.S.hist.has("dt"), false, "a refused input leaves the derived chart pending");
await ui.ensureHist("dt");
assert.equal(pending.length, 0, "the pending derived chart does not re-ask at once");

await reset();
loading = ui.ensureHist("dhw_tank");
reply(pending.shift(), 222); await loading;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 222);

// Firmware predating snapshot metadata remains usable when status also predates those fields.
await reset();
delete ui.S.status.history.epoch;
delete ui.S.status.boot_id;
loading = ui.ensureHist("dhw_tank");
pending.shift().resolve({ json: async () => ({ dt: 300, v: [333] }) });
await loading;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 333);

// Derived charts and another direct consumer must await the same existing transport. Returning
// immediately while an input is busy used to cache an empty/error derived chart for one minute.
await reset();
const leaving = ui.ensureHist("leaving_water"), leavingRequest = pending.shift();
const returning = ui.ensureHist("return_water"), returnRequest = pending.shift();
const derived = ui.ensureHist("dt");
const secondDerived = ui.ensureHist("dt");
let secondFinished = false;
secondDerived.then(() => { secondFinished = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pending.length, 0, "shared input requests are not duplicated");
assert.equal(ui.S.hist.has("dt"), false, "an active input is not absence");
assert.equal(secondFinished, false, "a second derived consumer waits for the same assembly");
reply(leavingRequest, 250); reply(returnRequest, 200);
await Promise.all([leaving, returning, derived, secondDerived]);
assert.equal(ui.S.hist.get("dt").v[0], 50);
assert.equal(secondFinished, true);

// A new status lifetime clears every lease, preserving main's global lifecycle model. Completion
// of the predecessor may neither publish its samples nor release the successor's active request.
for (const failOld of [false, true]) {
  await reset();
  const old = ui.ensureHist("dhw_tank"), oldRequest = pending.shift();
  const changed = fixture(); changed.history.epoch = 2; changed.profile.id = "profile-b";
  await status(changed);
  const returned = fixture(); returned.history.epoch = 3;
  await status(returned);
  const current = ui.ensureHist("dhw_tank"), currentRequest = pending.shift();
  if (failOld) oldRequest.reject(new Error("retired transport"));
  else reply(oldRequest, 111, 1);
  await old;
  assert.equal(ui.S.hist.has("dhw_tank"), false);
  assert.equal(ui.S.histBusy.has("dhw_tank"), true);
  reply(currentRequest, 444, 3); await current;
  assert.equal(ui.S.hist.get("dhw_tank").v[0], 444);
  assert.equal(ui.S.histBusy.has("dhw_tank"), false);
}
console.log("room mapping round trips, snapshot identity admission and shared history awaits pass");
