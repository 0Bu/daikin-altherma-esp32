// Regression for the red attention dot on the dashboard Settings button. Execute the production
// connection aggregate so links rendered outside the Connections tile (X10A and ENV III) cannot
// silently stop contributing to the same accessible alert count as Wi-Fi/MQTT/HomeHub.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["i18n.js", "dashboard.js"]);
const elements = {
  settingsDot: { hidden: true },
  btnSettings: {
    ariaLabel: "",
    setAttribute(name, value) {
      if (name === "aria-label") this.ariaLabel = String(value);
    },
  },
};
const context = {
  navigator: { language: "de-DE" },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { getElementById: (id) => elements[id] },
  S: { status: {} },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${source}\nthis.__renderSettingsDot = renderSettingsDot; this.__setLang = (value) => { LANG = value; };`,
  sandbox,
  { filename: "main/www/app.sources" },
);
sandbox.__setLang("de");

function status(patch = {}) {
  return {
    wifi: { connected: true, ssid: "test-wifi", std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
    modbus: { enabled: false, connected: false, host: "", port: 502 },
    hp: { connected: true },
    env3: { supported: true, enabled: false, connected: false, fresh: false, error: "disabled" },
    ...patch,
  };
}

function render(next) {
  context.S.status = next;
  sandbox.__renderSettingsDot();
  return { hidden: elements.settingsDot.hidden, label: elements.btnSettings.ariaLabel };
}

assert.deepEqual(render(status()), { hidden: true, label: "Einstellungen" },
  "all healthy or disabled links keep the marker hidden");

assert.deepEqual(render(status({ hp: { connected: false } })),
  { hidden: false, label: "Einstellungen — 1 Verbindung gestört" },
  "a failed X10A link alone raises the marker");

assert.deepEqual(render(status({
  env3: { supported: true, enabled: true, connected: false, fresh: false, error: "sensor_not_found" },
})), { hidden: false, label: "Einstellungen — 1 Verbindung gestört" },
  "a configured failed ENV III link alone raises the marker");

assert.deepEqual(render(status({
  env3: { supported: true, enabled: true, connected: false, fresh: false, error: "collecting" },
})), { hidden: true, label: "Einstellungen" },
  "the transient first ENV III collection does not claim a broken connection");

assert.deepEqual(render(status({
  env3: { supported: true, enabled: true, connected: true, fresh: false, error: "none" },
})), { hidden: false, label: "Einstellungen — 1 Verbindung gestört" },
  "a stale ENV III sample remains a failed configured source even if the last bus contact connected");

assert.deepEqual(render(status({
  hp: { connected: false },
  env3: { supported: true, enabled: true, connected: false, fresh: false, error: "sht30_read" },
  modbus: { enabled: true, connected: false, host: "homehub.local", port: 502 },
})), { hidden: false, label: "Einstellungen — 3 Verbindungen gestört" },
  "HomeHub, X10A and ENV III failures contribute independently to the accessible count");

console.log("Settings connection alert: Connections rows + X10A + configured ENV III passed");
