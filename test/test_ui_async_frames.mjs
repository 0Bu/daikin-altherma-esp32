import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (name) => fs.readFileSync(new URL(`../main/www/js/${name}.js`, import.meta.url), "utf8");
const later = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness() {
  const requests = [], locales = new Map(), events = [];
  const context = vm.createContext({
    LANG: "en", navigator: { language: "en" },
    uiLangSupported: (lang) => ["en", "de", "fr"].includes(lang), autoLang: () => "en",
    localeReady: (lang) => lang !== "fr", loadLocale: (lang) => {
      const pending = later(); locales.set(lang, pending); return pending.promise;
    },
    lsSet() {}, applyStaticI18n() {}, labelSchematicHits() {},
    location: { reload: () => events.push("reload") },
    pollSignal() {}, hpProbeIsOpen: () => false,
    j: (url) => { const pending = later(); requests.push({ url, ...pending }); return pending.promise; },
    t: (key) => key,
  });
  const i18n = read("i18n");
  vm.runInContext(i18n.slice(i18n.indexOf("function activateLang(next)")) + "\n" +
    read("app_state") + "\n" + read("dashboard") + `
      renderApp = () => events.push("paint");
      renderHeader = () => {};
      hydrateRoutedPopup = () => events.push("hydrate:" + S.status.ui.lang);
      markUnreachable = () => events.push("unreachable");
      this.ui = { S, refreshStatus, refreshValues, setLang, language: () => LANG };
    `, context);
  context.events = events;
  context.ui.S._values = []; context.ui.S._modbus = [];
  return { ...context.ui, context, requests, locales, events };
}

const frame = (lang = "en", patch = {}) => ({ version: "same", app_elf_sha256: "elf-a",
  boot_id: "boot-a", uptime_s: 100, history: { epoch: 1 }, profile: { id: "a" },
  hp: { proto: "I", rx: 44, tx: 43, connected: true }, ui: { lang }, ...patch });

{
  const h = harness();
  const old = h.refreshStatus(false), current = h.refreshStatus(false);
  h.requests[1].reject(new Error("latest transport")); await current;
  h.requests[0].resolve(frame());
  assert.equal(await old, false, "a failed latest request still retires preceding successful frames");
  assert.equal(h.S.status, null);
}

// An older success/failure must never mutate the newest-issued status, history lifetime or route.
for (const failOld of [false, true]) {
  const h = harness();
  const old = h.refreshStatus(false), current = h.refreshStatus(false);
  h.requests[1].resolve(frame("de")); await current;
  h.S.hist.set("sentinel", { v: [42] });
  if (failOld) h.requests[0].reject(new Error("old transport"));
  else h.requests[0].resolve(frame("en", { history: { epoch: 0 } }));
  assert.equal(await old, false);
  assert.equal(h.S.status.ui.lang, "de");
  assert.equal(h.language(), "de");
  assert.equal(h.S.hist.has("sentinel"), true);
  assert.deepEqual(h.events, ["hydrate:de"]);
}

// Lazy locale completion is itself leased: it cannot activate or hydrate a superseded frame.
{
  const h = harness();
  const old = h.refreshStatus(false); h.requests[0].resolve(frame("fr"));
  await new Promise((resolve) => setImmediate(resolve));
  const current = h.refreshStatus(false); h.requests[1].resolve(frame("de")); await current;
  h.locales.get("fr").resolve(true); await old;
  assert.equal(h.language(), "de");
  assert.equal(h.S.status.ui.lang, "de");
  assert.deepEqual(h.events, ["hydrate:de"]);
}

// A pending language choice loses to a later synchronous choice as well.
{
  const h = harness();
  const old = h.setLang("fr"); h.setLang("de"); h.locales.get("fr").resolve(true); await old;
  assert.equal(h.language(), "de");
}

// Retired /values replies cannot attach to a replaced source, even in an A -> B -> A cycle.
for (const failOld of [false, true]) {
  const h = harness();
  const initial = h.refreshStatus(false); h.requests[0].resolve(frame()); await initial;
  const old = h.refreshValues(false);
  for (const id of ["b", "a"]) {
    const status = h.refreshStatus(false);
    h.requests.at(-1).resolve(frame("en", { profile: { id } })); await status;
  }
  const current = h.refreshValues(false); h.requests.at(-1).resolve({ values: [{ value: 22 }] }); await current;
  if (failOld) h.requests[1].reject(new Error("retired transport"));
  else h.requests[1].resolve({ values: [{ value: 11 }] });
  assert.equal(await old, false);
  assert.equal(h.S._values[0].value, 22);
  assert.equal(h.S.transportUnavailable, null);
}

// An unresolved new source identity cannot admit a values response under the previous status.
{
  const h = harness();
  const initial = h.refreshStatus(false); h.requests[0].resolve(frame()); await initial;
  const status = h.refreshStatus(false), values = h.refreshValues(false);
  h.requests[2].resolve({ values: [{ value: 999 }] });
  assert.equal(await values, false, "values cannot attach while the next status identity is unresolved");
  h.requests[1].resolve(frame("en", { profile: { id: "b" } })); await status;
  assert.equal(h.S._values.length, 0);
}

// Failed live transports blank readings at once; a later complete frame recovers honestly.
for (const failed of ["status", "values"]) {
  const h = harness();
  const initial = h.refreshStatus(false); h.requests[0].resolve(frame()); await initial;
  h.S._values = [{ value: 99 }]; h.S._modbus = [{ value: 88 }]; h.S.live = { pump: 90 };
  const request = failed === "status" ? h.refreshStatus(false) : h.refreshValues(false);
  h.requests.at(-1).reject(new Error("network")); await request;
  assert.equal(h.S._values.length, 0); assert.equal(h.S._modbus.length, 0);
  assert.equal(h.S.live, null); assert.equal(h.S.transportUnavailable, failed);
  assert.ok(h.events.includes("paint"));
  const status = h.refreshStatus(false); h.requests.at(-1).resolve(frame()); await status;
  const values = h.refreshValues(false); h.requests.at(-1).resolve({ values: [{ value: 7 }] }); await values;
  assert.equal(h.S.transportUnavailable, null); assert.equal(h.S._values[0].value, 7);
}

// Firmware assets are leased to the first image. Same-version ELF changes also require reload,
// before positional language catalogs or route hydration can consume the new image's response.
for (const change of [{ app_elf_sha256: "elf-b" }, { version: "new" }]) {
  const h = harness();
  const initial = h.refreshStatus(false); h.requests[0].resolve(frame()); await initial;
  h.events.length = 0;
  const changed = h.refreshStatus(false); h.requests.at(-1).resolve(frame("fr", change));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.locales.size, 0, "image change must reload before loading positional locale assets");
  assert.equal(await changed, false);
  assert.deepEqual(h.events, ["reload"]);
}
console.log("UI status/value ordering, lazy locale leases, transport loss and image lease pass");

// Settings must not keep calling cached status measurements current after the full status
// transport fails. A values-only loss leaves these independently status-owned sources usable.
{
  const h = harness(), snapshot = { hidden: true, textContent: "" };
  Object.assign(h.context, {
    $: () => snapshot, esc: String, editIcon: "", histHtml: () => "",
    checkupDuration: String, signalBars: () => "signal",
    t: (key, ...args) => [key, ...args].join(":"),
    descNoteHtml: (label, value) => `${label}=${value};`,
    vcard: (title, rows) => rows,
  });
  vm.runInContext(`
    dynamicInfoRow = (...args) => JSON.stringify(args);
    settingsInfoRow = (...args) => JSON.stringify(args);
    this.views = { roomSourceStatus, roomSourceDetailHtml, weatherSourceDetailHtml,
      circulationSettingsCardHtml, outdoorAxisRow, plantOutdoorAxisRow, connLinks, renderSettings };
  `, h.context);
  const v = h.context.views;
  const room = { configured: true, has_value: true, has_setpoint: true, fresh: true,
    temperature_c: 21.5, setpoint_c: 22, age_s: 1, control_eligible: true };
  const weather = { configured: true, has_value: true, fresh: true };
  const diagnosis = { armed: true, outdoor_temperature_c: 19.5,
    plant_outdoor_temperature_c: 18.5, plant_outdoor_source: "homehub",
    last_sample_outdoor_temperature_c: 17.5, last_sample_plant_outdoor_temperature_c: 16.5,
    last_sample_plant_outdoor_source: "homehub" };
  h.S.status = frame("en", { reference_temperature: room, weather_forecast: weather,
    mqtt: { configured: true, connected: true }, wifi: { connected: true, ssid: "test-wifi" },
    circulation_source: { configured: true, has_value: true, fresh: true, state: "on", power_w: 4.5, age_s: 1 } });
  const config = JSON.stringify(h.S.status);
  for (const unavailable of [null, "values", "status", null]) {
    h.S.transportUnavailable = unavailable;
    const current = unavailable !== "status";
    const state = v.roomSourceStatus(room, h.S.status.mqtt);
    assert.equal(state.key, current ? "measurement_valid" : "unavailable");
    assert.equal(v.roomSourceDetailHtml(room, state, "21.5", "22", "now").includes("21.5"), current);
    assert.equal(v.weatherSourceDetailHtml(weather, "13.5", "150").includes("13.5"), current);
    const circ = v.circulationSettingsCardHtml();
    assert.equal(circ.includes("4.5 W"), current);
    assert.equal(circ.includes("circ.running"), current);
    for (const html of [v.outdoorAxisRow(diagnosis, { enabled: true }),
                        v.plantOutdoorAxisRow(diagnosis, { enabled: true })]) {
      assert.equal(html.includes("dyn.outdoor_detail_now"), current);
      assert.ok(html.includes("dyn.outdoor_detail_sample"), "recorded events remain bounded historical evidence");
    }
    assert.equal(v.connLinks().some(link => link.cls === "ok"), current);
    if (!current) assert.ok(v.connLinks().every(link => !link.detail && !link.value.includes("signal")),
      "a lost status frame must not invent per-service errors or retain a current radio-strength claim");
    h.S.scrub = "held-chart"; // The snapshot warning must update even while a plot owns focus.
    v.renderSettings();
    assert.equal(snapshot.hidden, current);
    if (!current) assert.match(snapshot.textContent, /ota.snapshot_value.*toast.unreachable/);
    assert.equal(JSON.stringify(h.S.status), config, "presentation does not erase the saved draft/configuration");
  }
}
console.log("UI Settings status loss: current claims clear, snapshots are labelled and status-owned recovery passes");
