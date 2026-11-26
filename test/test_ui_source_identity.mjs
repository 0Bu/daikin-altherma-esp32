// Execute the actual history consumers: source identity is independent of a plausible
// value, a recent fetch and a request that happened to finish after a replacement was configured.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createStrictDocument } from "../tools/ui/strict_dom.mjs";

const read = (file) => fs.readFileSync(new URL(`../main/www/js/${file}.js`, import.meta.url), "utf8");
const document = createStrictDocument("main/www/index.html");
const $ = (id) => document.getElementById(id);
const pending = [];
const context = {
  document, $, LANG: "en", pollSignal: () => undefined, hpProbeIsOpen: () => false,
  TextDecoder,
  esc: String, t: key => key,
  setLangFromStatus: async () => {}, displayUnit: (j) => j.unit,
  j: async () => context.nextStatus,
  fetch: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
};
vm.createContext(context);
const settings = read("settings");
const schematic = read("schematic");
const inspectorHistory = schematic.slice(schematic.indexOf("function renderInspectHist("),
  schematic.indexOf("function renderInspect("));
vm.runInContext(read("app_state") + "\n" + read("history") + "\n" + read("dashboard") + "\n" +
  inspectorHistory + "\n" +
  settings.slice(settings.indexOf("const OTA_RENDER_CACHE_KEY"), settings.indexOf("function otaCacheStore()")) + `

  renderApp = () => {};
  hydrateRoutedPopup = () => {};
  this.ui = { S, refreshStatus,
    ensureHist, ensureHistPair, ensureDerived, historyView, histPinIndex, histCacheKey, syncHistSources,
    yieldHistoryToPoll, pumpHistoryQueue, histPinToggle, histSeriesToggle,
    histAxisEnd, scrubTime, histHtml, renderInspectHist };
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
const historyReply = (request, body) => {
  const query = new URL(request.url, "http://device").searchParams;
  const id = query.get("row");
  const source = query.get("source") || (id === "circulation_state" ? "mqtt" : "x10a");
  request.resolve(Response.json({ id, source, ...body }));
};
const reply = (request, value, epoch = 1, boot_id = "boot-a") =>
  historyReply(request, sample(value, epoch, boot_id));
await reset();

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
  historyReply(request, body);
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
historyReply(pending.shift(), { ok: false, error: "history changed; retry" });
await loading;
for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
assert.equal(pending.length, 0, "a refused reply does not re-enter as a request loop");
context.renderApp = quietRender;

// A refusal that is not a history change ("history unavailable": no snapshot identity at all) is a
// cached error for the usual period, not a chart left loading and re-asked every status period.
await reset();
loading = ui.ensureHist("dhw_tank");
historyReply(pending.shift(), { ok: false, error: "history unavailable" });
await loading;
assert.equal(ui.S.hist.get("dhw_tank")?.err, true, "an unavailable history is an error state");
ui.S.histAwait?.delete("dhw_tank");
await ui.ensureHist("dhw_tank");
assert.equal(pending.length, 0, "the error state is cached, not re-asked at once");

// A derived chart whose input was refused for identity is pending, not "Trend unavailable.".
await reset();
const refusedDerived = ui.ensureHist("dt");
assert.equal(pending.length, 1);
reply(pending.shift(), 250, 2);
await new Promise(resolve => setImmediate(resolve));
reply(pending.shift(), 200, 2);
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
pending.shift().resolve(Response.json({ dt: 300, v: [333] }));
await loading;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 333);

// Derived charts and another direct consumer must await the same existing transport. Returning
// immediately while an input is busy used to cache an empty/error derived chart for one minute.
await reset();
const leaving = ui.ensureHist("leaving_water"), leavingRequest = pending.shift();
const returning = ui.ensureHist("return_water");
const derived = ui.ensureHist("dt");
const secondDerived = ui.ensureHist("dt");
let secondFinished = false;
secondDerived.then(() => { secondFinished = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pending.length, 0, "shared input requests are not duplicated");
assert.equal(ui.S.hist.has("dt"), false, "an active input is not absence");
assert.equal(secondFinished, false, "a second derived consumer waits for the same assembly");
reply(leavingRequest, 250);
await leaving;
assert.equal(pending.length, 1, "the next independent history starts after the first reply");
reply(pending.shift(), 200);
await Promise.all([leaving, returning, derived, secondDerived]);
assert.equal(ui.S.hist.get("dt").v[0], 50);
assert.equal(secondFinished, true);

// Repainting an open chart while its requests stall must neither issue another fetch nor
// subscribe another waiter. A source retirement aborts both transports and releases their leases.
await reset();
const timeout = new Map();
let nextTimer = 0;
Object.assign(context, {
  AbortController,
  POLL_TIMEOUT_MS: 6000,
  setTimeout(callback, delay) {
    assert.equal(delay, 6000);
    timeout.set(++nextTimer, callback);
    return nextTimer;
  },
  clearTimeout(timer) { timeout.delete(timer); },
  fetch: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    pending.push({ url, signal, resolve, reject });
  }),
});
const initialPair = ui.ensureHistPair("dhw_tank", "refresh");
const [tankX10a] = pending.splice(0);
assert.ok(tankX10a);
assert.equal(timeout.size, 1, "background recovery starts one history transport at a time");
for (let paint = 0; paint < 30; ++paint)
  assert.equal(ui.ensureHistPair("dhw_tank", "refresh"), undefined, "polls do not wait on existing requests");
assert.equal(pending.length, 0);
const replacement = fixture();
replacement.history.epoch = 2;
await status(replacement);
await initialPair;
assert.ok(tankX10a.signal.aborted);
assert.equal(timeout.size, 0);
assert.equal(ui.S.hist.size, 0, "aborted old transports leave no errors in the new lifetime");
ui.S.hist.set("dhw_tank", { at: 0, gen: 1, v: [400] });
const stalled = ui.ensureHist("dhw_tank");
const stalledRequest = pending.shift();
assert.equal(timeout.size, 1);
timeout.values().next().value();
await stalled;
assert.equal(stalledRequest.signal.aborted, true);
assert.equal(timeout.size, 0);
assert.equal(ui.S.histBusy.size, 0);
assert.equal(ui.S.hist.get("dhw_tank").v[0], 400, "a current timeout keeps the compatible ring");
ui.S.hist.set(ui.histCacheKey("dhw_tank", "modbus"), { at: Date.now() });
assert.equal(ui.ensureHistPair("dhw_tank", "refresh"), undefined, "the selected chart honors the error cooldown");
ui.S.hist.get("dhw_tank").at -= 60001;
const recovering = ui.ensureHistPair("dhw_tank", "refresh");
assert.equal(pending.length, 1, "the selected chart retries its expired error without refetching its other ring");
reply(pending.shift(), 450, 2);
await recovering;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 450);
assert.equal(ui.S.hist.get("dhw_tank").gen, 2, "recovery cannot reuse the previous ring generation");

await reset();
const opening = ui.ensureHistPair("dhw_tank");
const firstRead = pending.shift();
assert.ok(firstRead && pending.length === 0, "explicit paired disclosure starts a single transport");
context._pollBusy = true;
await ui.yieldHistoryToPoll();
assert.equal(firstRead.signal.aborted, true, "live polling preempts the running history read");
assert.equal(pending.length, 0, "nothing else starts while the live poll owns the transport");
context._pollBusy = false;
ui.pumpHistoryQueue();
const resumed = pending.shift();
assert.equal(resumed.url, firstRead.url, "the preempted read resumes once the poll finishes");
context._pollBusy = true;
const settling = ui.yieldHistoryToPoll();
assert.equal(resumed.signal.aborted, false, "a second poll lets the retried request finish");
assert.equal(pending.length, 0, "the retry and the following poll still share one transport");
reply(resumed, 455);
await settling;
assert.equal(pending.length, 0, "the Modbus ring cannot start before the waiting poll finishes");
context._pollBusy = false;
ui.pumpHistoryQueue();
assert.equal(pending.length, 1);
assert.match(pending[0].url, /source=modbus/);
reply(pending.shift(), 445);
await opening;
assert.equal(ui.S.hist.get("dhw_tank").v[0], 455);
assert.equal(ui.S.hist.get(ui.histCacheKey("dhw_tank", "modbus")).v[0], 445);

context.fetch = (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject }));

await reset();
context.MB_PAIRS = [];
context.replaceHistoryHtml = () => {};
context.inspFieldText = () => "ΔT";
ui.S.insp = "dt";
context._pollBusy = true;
assert.equal(ui.renderInspectHist({ trend: "dt", aria: "ΔT" }, null, "refresh"), undefined);
assert.equal(ui.S.histBusy.size, 0, "a live poll blocks inspector background refresh");
const openedDuringPoll = ui.renderInspectHist({ trend: "dt", aria: "ΔT" }, null, "open");
assert.ok(openedDuringPoll, "the explicit inspector open is accepted during a poll");
assert.equal(pending.length, 0, "the live poll still owns the transport");
context._pollBusy = false;
ui.pumpHistoryQueue();
assert.match(pending[0].url, /leaving_water/);
reply(pending.shift(), 450);
await new Promise(resolve => setImmediate(resolve));
reply(pending.shift(), 400);
await openedDuringPoll;
assert.equal(ui.S.hist.get("dt").v[0], 50);
ui.S.insp = null;

// Default fallback can change the plotted instrument while both undated ring generations stay
// unchanged. The retired X10A pin must not silently select Modbus or reappear after failback.
await reset();
const undated = { at: Date.now(), gen: 1, t0: null, b0: null, dt: 300, v: [452, 454] };
ui.S.hist.set("dhw_tank", undated);
ui.S.hist.set(ui.histCacheKey("dhw_tank", "modbus"), { ...undated, v: [431, 434] });
context.renderTrendHosts = () => {};
ui.histPinToggle("dhw_tank", 1);
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), 1);
const disconnected = fixture();
disconnected.hp.connected = false;
await status(disconnected);
assert.equal(ui.S.histPin.has("dhw_tank"), false);
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), -1);
await status(fixture());
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), -1);
ui.histPinToggle("dhw_tank", 1);
ui.histSeriesToggle("dhw_tank", "modbus");
assert.equal(ui.S.histPin.has("dhw_tank"), false, "changing visible instruments retires the saved pin");
ui.histSeriesToggle("dhw_tank", "modbus");
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), -1, "legend round trip cannot restore a retired pin");

const bootOnly = { ...undated, b0: 100 };
ui.S.histHidden.delete("dhw_tank");
ui.S.hist.set("dhw_tank", bootOnly);
ui.S.hist.set(ui.histCacheKey("dhw_tank", "modbus"), { ...bootOnly, v: [431, null] });
ui.histPinToggle("dhw_tank", 1);
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), 1);
await status(disconnected);
assert.equal(ui.S.histPin.has("dhw_tank"), false, "status failover retires an unscoped X10A-only boot pin");
await status(fixture());
assert.equal(ui.histPinIndex("dhw_tank", ui.historyView("dhw_tank")), -1);
ui.S.hist.set(ui.histCacheKey("dhw_tank", "modbus"), { ...bootOnly, v: [431, 434] });

{
  const inspector = { trend: "dhw_tank", aria: "Tank" };
  const historyMarkup = [];
  context.replaceHistoryHtml = (_el, html) => historyMarkup.push(html);
  ui.histPinToggle("dhw_tank", 0);
  ui.renderInspectHist(inspector, null);
  ui.histPinToggle("dhw_tank", 1);
  ui.renderInspectHist(inspector, null);
  assert.equal(historyMarkup.length, 2, "pinning a new boot bucket must invalidate the inspector");
  assert.match(historyMarkup[0], /vhist-cross vhist-pinned" style="left:0\.000%/);
  assert.match(historyMarkup[1], /vhist-cross vhist-pinned" style="left:100\.000%/);
  ui.histPinToggle("dhw_tank", 1);
}

// The cached delta uses two undated rings. A transient failure on both inputs preserves the
// selected index and generation. A successful new ring changes that generation.
await reset();
const delta = ui.ensureDerived("dt");
assert.equal(pending.length, 1);
reply(pending.shift(), 450);
await new Promise(resolve => setImmediate(resolve));
reply(pending.shift(), 400);
await delta;
const oldDelta = ui.S.hist.get("dt");
ui.histPinToggle("dt", 0);
for (const id of ["leaving_water", "return_water", "dt"]) ui.S.hist.get(id).at = 0;
const failedDelta = ui.ensureDerived("dt");
assert.equal(pending.length, 1);
pending.shift().reject(new Error("refresh interrupted"));
await new Promise(resolve => setImmediate(resolve));
reply(pending.shift(), 390);
await failedDelta;
assert.equal(ui.S.hist.get("dt").gen, oldDelta.gen);
assert.equal(ui.histPinIndex("dt", ui.historyView("dt")), 0);
assert.equal(ui.histAxisEnd(ui.historyView("dt")), "", "a cached plot does not claim the edge is live");
assert.equal(ui.scrubTime(ui.historyView("dt"), 0), "hist.retained");
for (const id of ["leaving_water", "dt"]) ui.S.hist.get(id).at = 0;
const nextDelta = ui.ensureDerived("dt");
assert.equal(pending.length, 1);
reply(pending.shift(), 460);
await nextDelta;
assert.equal(ui.S.hist.get("dt").gen, oldDelta.gen + 1);
assert.equal(ui.histPinIndex("dt", ui.historyView("dt")), -1);
assert.equal(ui.histAxisEnd(ui.historyView("dt")), "hist.now");

await reset();
const emptyDelta = ui.ensureDerived("dt");
for (let i = 0; i < 2; i++) {
  historyReply(pending.shift(), { ...sample(0), v: [] });
  await new Promise(resolve => setImmediate(resolve));
}
await emptyDelta;
assert.match(ui.histHtml("dt", "K", "Temperature difference"), /hist\.none/,
  "two successfully read empty inputs must be shown as empty");
assert.doesNotMatch(ui.histHtml("dt", "K", "Temperature difference"), /hist\.err/);

// A new status lifetime clears every lease, preserving main's global lifecycle model. Completion
// of the predecessor may neither publish its samples nor release the successor's active request.
for (const failOld of [false, true]) {
  await reset();
  const old = ui.ensureHist("dhw_tank"), oldRequest = pending.shift();
  const changed = fixture(); changed.history.epoch = 2; changed.profile.id = "profile-b";
  await status(changed);
  const returned = fixture(); returned.history.epoch = 3;
  await status(returned);
  const current = ui.ensureHist("dhw_tank");
  assert.equal(pending.length, 0, "a retired request cannot leave two transports in flight");
  if (failOld) oldRequest.reject(new Error("retired transport"));
  else reply(oldRequest, 111, 1);
  await old;
  assert.equal(ui.S.hist.has("dhw_tank"), false);
  assert.equal(ui.S.histBusy.has("dhw_tank"), true);
  reply(pending.shift(), 444, 3); await current;
  assert.equal(ui.S.hist.get("dhw_tank").v[0], 444);
  assert.equal(ui.S.histBusy.has("dhw_tank"), false);
}

// Inspector history fallbacks resolve Modbus-only series without inventing X10A rings.
{
  await reset();
  const rendered = [];
  context.MB_PAIRS = [];
  context.replaceHistoryHtml = (_el, html) => rendered.push(html);
  context.displayHomeHubLabel = (r) => r.label;
  context.inspFieldText = (_e, _f) => "Inspector";
  const mbOnly = fixture();
  mbOnly.hp.connected = false;
  mbOnly.history.rows = [{ id: "free_heap", label: "Free memory" }];
  mbOnly.history.modbus_rows = [
    { id: "modbus_power", label: "Heat pump power consumption" },
    { id: "compressor_state", label: "Compressor running" },
    { id: "modbus_defrost_state", label: "Defrost / Restart" },
    { id: "pump_state", label: "Circulation pump running" },
  ];
  await status(mbOnly);
  ui.S._modbus = [
    { off: 51, history: "modbus_power", label: "Heat pump power consumption", value: "1.4", unit: "kW" },
    { off: 31, history: "compressor_state", label: "Compressor running", value: "1", binary: true },
    { off: 35, history: "modbus_defrost_state", label: "Defrost / Restart", value: "0", binary: true },
    { off: 30, history: "pump_state", label: "Circulation pump running", value: "1", binary: true },
  ];
  ui.S.hist.set(ui.histCacheKey("modbus_power", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "kW", b0: 1, held: [], v: [12, 14] });
  ui.S.hist.set(ui.histCacheKey("compressor_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 1, held: [], v: [10, 0, 10] });
  ui.S.hist.set(ui.histCacheKey("modbus_defrost_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 1, held: [], v: [0, 10, 0] });
  ui.S.hist.set(ui.histCacheKey("pump_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 1, held: [], v: [10, 10, 0] });
  ui.S.live = { pelSrc: "MB" };
  for (const [insp, expectedId] of [["pel", "modbus_power"],
    ["comp", "compressor_state"], ["defrost", "modbus_defrost_state"], ["pump", "pump_state"]]) {
    ui.S.insp = insp;
    ui.S.inspHistSig = "";
    ui.renderInspectHist({}, null);
    assert.match(rendered.at(-1), new RegExp(`data-hist="${expectedId}"`),
      `${insp} inspector falls back to ${expectedId}`);
  }
  ui.S.insp = "ou";
  ui.S.inspHistSig = "";
  ui.renderInspectHist({}, null);
  assert.equal(rendered.at(-1), "", "ou inspector stays prose-only without duplicating compressor_state");
  ui.S.live = { pelSrc: "INV" };
  ui.S.insp = "pel";
  ui.S.inspHistSig = "";
  ui.renderInspectHist({}, null);
  assert.equal(rendered.at(-1), "", "INV pel keeps inspector history hidden");
  ui.S.insp = null;
}

// Dual-stack compressor & pump inspectors repaint #inspHist with numeric trends + live Modbus overlay flips.
{
  await reset();
  const rendered = [];
  context.MB_PAIRS = [];
  context.replaceHistoryHtml = (_el, html) => rendered.push(html);
  context.displayHomeHubLabel = (r) => r.label;
  context.displayReadingLabel = (l) => l;
  context.inspFieldText = (_e, _f) => "Inspector";
  const dual = fixture();
  dual.hp.connected = true;
  dual.modbus.enabled = true;
  dual.modbus.connected = true;
  dual.history.rows = [
    { id: "comp_rps", label: "INV frequency (rps)" },
    { id: "pump_signal", label: "Water pump signal" },
  ];
  dual.history.modbus_rows = [
    { id: "compressor_state", label: "Compressor running" },
    { id: "pump_state", label: "Circulation pump running" },
  ];
  await status(dual);
  ui.S._modbus = [
    { off: 31, history: "compressor_state", label: "Compressor running", value: "1", binary: true },
    { off: 30, history: "pump_state", label: "Circulation pump running", value: "0", binary: true },
  ];
  ui.S.hist.set("comp_rps", { at: Date.now(), gen: 1, dt: 300, unit: "rps", b0: 1, held: [], v: [0, 200, 300] });
  ui.S.hist.set("pump_speed", { at: Date.now(), gen: 1, dt: 300, unit: "%", b0: 1, held: [], v: [0, 500, 1000] });
  ui.S.hist.set(ui.histCacheKey("compressor_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 1, held: [], v: [0, 10, 0] });
  ui.S.hist.set(ui.histCacheKey("pump_state", "modbus"), { at: Date.now(), gen: 1, dt: 300, unit: "", b0: 1, held: [], v: [0, 10, 10] });

  ui.S.insp = "comp";
  ui.S.inspHistSig = "";
  ui.renderInspectHist({ trend: "comp_rps" }, { label: "INV frequency (rps)", unit: "rps" });
  const compBefore = rendered.length;
  assert.match(rendered.at(-1), /data-hist="comp_rps"/);
  assert.match(rendered.at(-1), /vhist-phase vhist-phase-state mb/);
  assert.match(rendered.at(-1), /vhist-phase-live mb/);
  assert.match(rendered.at(-1), /Modbus · state\.on/);

  ui.S._modbus[0].value = "0";
  ui.renderInspectHist({ trend: "comp_rps" }, { label: "INV frequency (rps)", unit: "rps" });
  assert.equal(rendered.length, compBefore + 1, "live Modbus flip repaints comp inspector chart");
  assert.match(rendered.at(-1), /Modbus · state\.off/);
  assert.doesNotMatch(rendered.at(-1), /vhist-phase-live/);

  ui.S.insp = "pump";
  ui.S.inspHistSig = "";
  ui.renderInspectHist({ trend: "pump_speed" }, { label: "Water pump operation", unit: "" });
  assert.match(rendered.at(-1), /data-hist="pump_speed"/);
  assert.match(rendered.at(-1), /vhist-phase vhist-phase-state mb/);
  assert.match(rendered.at(-1), /Modbus · state\.off/);
  ui.S.insp = null;
}
console.log("snapshot identity admission and shared history awaits pass");
