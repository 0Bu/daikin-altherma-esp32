// Execute the browser-side OTA generation handshake.  A freshly accepted task owns `busy` and its
// generation before the firmware's 1.1 s quiesce lead changes `state`, so consuming the old idle
// payload here recreates the production race even when the firmware API itself is correct.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

class Element {
  constructor(id = "") {
    this.id = id;
    this.className = "";
    this.innerHTML = "";
    this._textContent = "";
    this.dataset = {};
    this.disabled = false;
    this.hidden = id.endsWith("Modal");
    this.children = [];
  }
  get textContent() { return this._textContent; }
  set textContent(value) {
    this._textContent = String(value ?? "");
    if (this._textContent === "") this.children = [];
  }
  appendChild(child) { this.children.push(child); }
  querySelectorAll() { return []; }
}

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, new Element(id));
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
  async text() { return typeof body === "string" ? body : JSON.stringify(body); },
});
let changelogResponse = response(200, "Add OTA changelog\nKeep <script> literal");
let changelogFetchFails = false;
let acceptDecision = true;
let sandbox;
const context = {
  S,
  ROUTED_MODALS: [],
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
  openOverlay: id => {
    element(id).hidden = false;
    queueMicrotask(() => sandbox.__api.settleOtaDecision(acceptDecision));
  },
  closeOverlay: id => { element(id).hidden = true; },
  renderHeaderMeta() {},
  renderOtaDashboardStatus() {},
  renderApp() {},
  setLangFromStatus() {},
  j: async () => {
    assert.ok(statuses.length, "unexpected OTA status poll");
    return statuses.shift();
  },
  fetch: async url => {
    if (!String(url).startsWith("/ota/changelog")) return checkResponse;
    if (changelogFetchFails) throw new Error("test changelog transport failure");
    return changelogResponse;
  },
  post: async url => {
    posted = url;
    const after = Number(new URL(url, "http://device.test").searchParams.get("after"));
    return response(200, { ok: true, generation: after === 0xffffffff ? 1 : after + 1 });
  },
  location: { hostname: "device.test", reload() {} },
  window: {},
};
sandbox = vm.createContext(context);
vm.runInContext(
  `${readAppFragments(["settings.js"])}\nthis.__api = { otaPoll, checkFirmwareUpdate, settleOtaDecision };`,
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
const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// The browser budget must outlive both 15-second TLS-headroom waits plus the manifest and changelog
// 30-second deadlines. The old 30-poll budget timed out this valid offer before the localized
// fallback/modal could appear.
S.busy = false;
S.otaBusy = false;
posted = null;
acceptDecision = false;
checkResponse = response(200, { ok: true, generation: 6 });
statuses = Array.from({ length: 142 }, () => ({ state: "checking", busy: true, generation: 6 }));
statuses.push({
  state: "idle", busy: false, generation: 6, current: "1.2.3-dev.2",
  available: "1.2.3-dev.3", available_sha256: sha,
  available_channel: "dev", update_available: true, downgrade: false,
});
await sandbox.__api.checkFirmwareUpdate();
assert.equal(S.otaView.text, "ota.cancelled",
  "bounded optional notes must not turn a completed signed offer into a UI timeout");
assert.equal(statuses.length, 0);

// Changelog transport and content are presentation-only. 204 and a dropped request both open the
// same offer with the explicit no-notes fallback; 409 means the generation lease was replaced and
// must stop before a modal or update POST.
for (const mode of ["empty", "transport"]) {
  S.busy = false;
  S.otaBusy = false;
  posted = null;
  acceptDecision = false;
  changelogResponse = response(204, "");
  changelogFetchFails = mode === "transport";
  const generation = mode === "empty" ? 12 : 13;
  checkResponse = response(200, { ok: true, generation });
  statuses = [{
    state: "idle", busy: false, generation, current: "1.2.3-dev.3",
    available: "1.2.3-dev.4", available_sha256: sha,
    available_channel: "dev", update_available: true, downgrade: false,
  }];
  await sandbox.__api.checkFirmwareUpdate();
  assert.equal(element("otaChanges").hidden, true);
  assert.equal(element("otaNoChanges").hidden, false);
  assert.equal(S.otaView.text, "ota.cancelled");
  assert.equal(posted, null);
}

S.busy = false;
S.otaBusy = false;
posted = null;
changelogFetchFails = false;
changelogResponse = response(409, "");
checkResponse = response(200, { ok: true, generation: 14 });
statuses = [{
  state: "idle", busy: false, generation: 14, current: "1.2.3-dev.3",
  available: "1.2.3-dev.4", available_sha256: sha,
  available_channel: "dev", update_available: true, downgrade: false,
}];
await sandbox.__api.checkFirmwareUpdate();
assert.equal(S.otaView.text, "ota.replaced");
assert.equal(posted, null);

// The successful flow carries the exact checked generation/channel/version/SHA into the sole POST.
S.busy = false;
S.otaBusy = false;
posted = null;
acceptDecision = true;
changelogResponse = response(200, "Add OTA changelog\nKeep <script> literal");
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
assert.equal(element("otaVersionLine").textContent, "v1.2.3-dev.3 → v1.2.3-dev.4");
assert.equal(element("otaChannel").textContent, "chan.dev");
assert.deepEqual(element("otaChanges").children.map(item => item.textContent),
  ["Add OTA changelog", "Keep <script> literal"],
  "feed notes must render as literal per-line text in the custom modal");
const parsed = new URL(posted, "http://device.test");
assert.equal(parsed.pathname, "/ota/update");
assert.deepEqual(Object.fromEntries(parsed.searchParams), {
  after: "7", channel: "dev", version: "1.2.3-dev.4", sha256: sha,
});
assert.equal(statuses.length, 0, "the exact update generation must also own status polling");

// Every custom-modal dismissal is a real cancellation: the checked lease is never posted.
S.busy = false;
S.otaBusy = false;
posted = null;
acceptDecision = false;
checkResponse = response(200, { ok: true, generation: 9 });
statuses = [{
  state: "idle", busy: false, generation: 9, current: "1.2.3-dev.4",
  available: "1.2.3-dev.5", available_sha256: sha, available_channel: "dev",
  update_available: true, downgrade: false,
}];
await sandbox.__api.checkFirmwareUpdate();
assert.equal(posted, null, "dismissing the OTA modal must not post an update");
assert.equal(S.otaView.text, "ota.cancelled");

// Dev -> release remains an explicit downgrade permission, now carried by the modal's older-build
// wording rather than a native confirm().
S.busy = false;
S.otaBusy = false;
posted = null;
acceptDecision = true;
checkResponse = response(200, { ok: true, generation: 10 });
statuses = [{
  state: "idle", busy: false, generation: 10, current: "1.2.4-dev.7",
  available: "1.2.3", available_sha256: sha, available_channel: "release",
  update_available: false, downgrade: true,
}, { state: "error", busy: false, generation: 11, message: "test stop" }];
await sandbox.__api.checkFirmwareUpdate();
const downgrade = new URL(posted, "http://device.test");
assert.equal(downgrade.searchParams.get("downgrade"), "1");
assert.equal(element("otaModalTitle").textContent, "ota.switch_title");
assert.equal(element("otaInstall").textContent, "ota.switch");

console.log("OTA UI handshake: busy lead, generation replacement, 503 and exact artifact passed");
