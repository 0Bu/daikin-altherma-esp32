// Execute the browser-side OTA generation handshake.  A freshly accepted task owns `busy` and its
// generation before the firmware's 1.1 s quiesce lead changes `state`, so consuming the old idle
// payload here recreates the production race even when the firmware API itself is correct.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

class Element {
  constructor() {
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.dataset = {};
    this.disabled = false;
  }
  appendChild() {}
  querySelectorAll() { return []; }
}

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
const storage = new Map();
const S = {
  status: null, busy: false, otaBusy: false, otaInstalling: false, otaShown: false,
  otaView: null, otaAvail: null, otaCached: false,
};
let statuses = [];
let checkResponse = null;
let posted = null;

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; },
});
const context = {
  S,
  $: element,
  document: { createElement: () => new Element() },
  sessionStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  t: key => key,
  esc: value => String(value ?? ""),
  setTimeout: (callback, delay) => { if (delay === 1000) queueMicrotask(callback); return 1; },
  clearTimeout() {},
  URLSearchParams,
  confirm: () => true,
  renderHeaderMeta() {},
  renderOtaDashboardStatus() {},
  renderApp() {},
  setLangFromStatus() {},
  j: async () => {
    assert.ok(statuses.length, "unexpected OTA status poll");
    return statuses.shift();
  },
  fetch: async () => checkResponse,
  post: async url => {
    posted = url;
    return response(200, { ok: true, generation: 8 });
  },
  location: { hostname: "device.test", reload() {} },
  window: {},
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${readAppFragments(["settings.js"])}\nthis.__api = { otaPoll, checkFirmwareUpdate };`,
  sandbox,
  { filename: "main/www/js/settings.js" },
);

// The pre-task idle payload carries the NEW generation but busy=true. It must not finish a check.
statuses = [
  { state: "idle", busy: true, generation: 7, available: "old" },
  { state: "idle", busy: false, generation: 7, available: "1.2.3-dev.4" },
];
const settled = await sandbox.__api.otaPoll(["checking"], 3, null, 7, true);
assert.equal(settled.available, "1.2.3-dev.4");
assert.equal(statuses.length, 0, "polling must wait through the invisible quiesce lead");

statuses = [{ state: "idle", busy: false, generation: 8 }];
const replaced = await sandbox.__api.otaPoll(["checking"], 1, null, 7, true);
assert.equal(replaced.state, "error");
assert.equal(replaced.message, "ota.replaced");

// An answered busy response is retryable device state, not a network/unreachable diagnosis.
checkResponse = response(503, { ok: false, error: "ota operation not accepted" });
await sandbox.__api.checkFirmwareUpdate();
assert.equal(S.otaView.text, "ota.busy");
assert.equal(posted, null);

// The successful flow carries the exact checked generation/channel/version/SHA into the sole POST.
S.busy = false;
S.otaBusy = false;
posted = null;
const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
checkResponse = response(200, { ok: true, generation: 7 });
statuses = [
  { state: "idle", busy: true, generation: 7, available: "old" },
  {
    state: "idle", busy: false, generation: 7, current: "1.2.3-dev.3",
    available: "1.2.3-dev.4", available_sha256: sha, available_channel: "dev",
    update_available: true, downgrade: false,
  },
  { state: "idle", busy: true, generation: 8, available: "1.2.3-dev.4" },
  { state: "error", busy: false, generation: 8, message: "test stop" },
];
await sandbox.__api.checkFirmwareUpdate();
assert.ok(posted, "the confirmed exact offer must reach the update boundary");
const parsed = new URL(posted, "http://device.test");
assert.equal(parsed.pathname, "/ota/update");
assert.deepEqual(Object.fromEntries(parsed.searchParams), {
  after: "7", channel: "dev", version: "1.2.3-dev.4", sha256: sha,
});
assert.equal(statuses.length, 0, "the exact update generation must also own status polling");

console.log("OTA UI handshake: busy lead, generation replacement, 503 and exact artifact passed");
