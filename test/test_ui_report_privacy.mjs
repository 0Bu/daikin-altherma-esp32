// Execute every shipped public-report producer. Endpoint fixtures keep private sentinels in the
// operational routes, so requesting an unredacted route is an executable negative control.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("main/www/js/app_state.js", "utf8");
const PRIVATE = "PRIVATE-IDENTITY-'\\n\"ü";
const PRIVATE_URL = "https://private.invalid/house/person/token/manifest.json";

function harness({ configured = true, failure = "", secure = true, log = "raw 0xA1 32B 01 02\n" } = {}) {
  const state = { calls: [], copies: [], downloads: [], opens: [], selected: null };
  const elements = new Map();
  function element(tag) {
    return {
      tag, value: "", hidden: false, disabled: false, style: {}, dataset: {}, lastChild: {},
      appendChild() {}, setAttribute() {}, focus() {}, remove() {},
      select() { state.selected = this; },
      click() { state.downloads.push({ name: this.download, blob: state.blobs.get(this.href) }); },
    };
  }
  const document = {
    body: { appendChild() {} },
    createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
    execCommand(command) {
      assert.equal(command, "copy"); state.copies.push(state.selected.value); return true;
    },
  };
  state.blobs = new Map();
  class ReportURL extends URL {
    static createObjectURL(blob) { const id = `blob:report-${state.blobs.size}`; state.blobs.set(id, blob); return id; }
    static revokeObjectURL() {}
  }
  const rawStatus = {
    wifi: { ssid: configured ? PRIVATE : "", ip: configured ? PRIVATE : "", mac: PRIVATE },
    mqtt: { broker: configured ? PRIVATE : "" },
    reference_temperature: { name: configured ? PRIVATE : "" },
    ntp: { server: configured ? PRIVATE : "" }, syslog: { host: configured ? PRIVATE : "" },
  };
  const redact = node => typeof node === "string" ? (node ? "<redacted>" : "")
    : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, redact(v)]));
  const fetch = async url => {
    state.calls.push(url);
    if (failure === "network") throw new Error("network unavailable");
    if (failure === "http") return { ok: false, status: 503, async text() { return PRIVATE; } };
    const redacted = url.includes("redact=1");
    const payload = url.startsWith("/status") ? JSON.stringify(redacted ? redact(rawStatus) : rawStatus)
      : url.startsWith("/ota/status") ? JSON.stringify({ effective_manifest_url: redacted ? "<redacted>" : PRIVATE_URL,
          effective_firmware_base_url: redacted ? "<redacted>" : PRIVATE_URL })
      : url.startsWith("/diag") ? (redacted ? log : PRIVATE + "\n" + log)
      : '{"temperature":42.5}';
    return { ok: true, status: 200, async text() { return payload; } };
  };
  const context = vm.createContext({ document, fetch, URL: ReportURL, URLSearchParams, Blob,
    $: id => document.getElementById(id), t: key => key,
    window: { isSecureContext: secure, open: (...args) => state.opens.push(args) },
    navigator: { clipboard: { async writeText(text) { state.copies.push(text); } } },
    setTimeout() {}, console,
  });
  vm.runInContext(source + "\nglobalThis.api = { S, copyDiagnostics, collectBugReport, bugPrepare };", context);
  context.api.S.status = { version: "1.2.3", platform: "esp32s3", app_elf_sha256: "abc123",
    wifi: rawStatus.wifi, ntp: { ...rawStatus.ntp, time: "2026-10-10T00:00:00Z" },
    last_crash: { reason: "panic", fault: true, coredump: true, task: "httpd", pc: "0x40001234",
      backtrace: ["0x40001234", "0x40004321"] },
  };
  return { state, document, api: context.api, fetch };
}

function assertPrivateAbsent(text) {
  assert.ok(!text.includes(PRIVATE), "private operational identity escaped into a public report");
  assert.ok(!text.includes(PRIVATE_URL), "effective private OTA override escaped into a public report");
}

for (const configured of [true, false]) for (const secure of [true, false]) {
  const h = harness({ configured, secure });
  // Confirm the fixtures would expose a bypass. These reads never happen in the producer itself.
  assert.ok((await (await h.fetch("/diag")).text()).includes(PRIVATE));
  assert.ok((await (await h.fetch("/ota/status")).text()).includes(PRIVATE_URL));
  h.state.calls.length = 0;
  await h.api.copyDiagnostics();
  assert.deepEqual(h.state.calls, ["/diag?redact=1"]);
  assertPrivateAbsent(h.state.copies.at(-1));
  assert.match(h.state.copies.at(-1), /raw 0xA1 32B 01 02/);
  assert.match(h.state.copies.at(-1), /reset: panic/);
  h.state.calls.length = 0;
  const report = await h.api.collectBugReport(); // real producer, never a test stub
  assert.equal(report.failed, false);
  assertPrivateAbsent(report.text);
  assert.deepEqual(h.state.calls, ["/status?redact=1", "/values", "/ota/status?redact=1", "/diag?verbose=1&redact=1"]);
  assert.ok(!h.state.calls.some(url => url.startsWith("/coredump")));
  if (!configured) assert.match(report.text, /"broker":""/);
  h.document.getElementById("bugWhat").value = "Observed a reboot";
  await h.api.bugPrepare(); // display, clipboard and Markdown download all use the production flow
  const displayed = h.document.getElementById("bugText").value;
  assertPrivateAbsent(displayed);
  await h.document.getElementById("bugCopy").onclick();
  assert.equal(h.state.copies.at(-1), displayed);
  assert.equal(h.state.opens.length, 1);
  assert.ok(!h.state.opens[0][0].includes(encodeURIComponent(PRIVATE)));
  h.document.getElementById("bugDownload").onclick();
  assert.equal(await h.state.downloads.at(-1).blob.text(), displayed);
  assert.equal(h.state.downloads.at(-1).name, "daikin-report-1.2.3.md");
}

for (const failure of ["http", "network"]) {
  const h = harness({ failure });
  await h.api.copyDiagnostics();
  const crash = h.state.copies.at(-1);
  assertPrivateAbsent(crash);
  assert.match(crash, /Could not be read from the device:/);
  assert.match(crash, failure === "http" ? /HTTP 503/ : /network unavailable/);
  const report = await h.api.collectBugReport();
  assert.equal(report.failed, true);
  assertPrivateAbsent(report.text);
  assert.equal((report.text.match(/Could not be read from the device:/g) || []).length, 4);
  h.document.getElementById("bugWhat").value = "Observed a read failure";
  await h.api.bugPrepare();
  assert.match(h.document.getElementById("bugText").value, /Could not be read from the device:/);
}

// Preserve the explicit device truncation witness and a final record without a newline. The browser
// trusts source-side framing/redaction; it must not erase evidence or substitute a false no-data claim.
for (const log of ["[... truncated ...]\n[ 2] raw 0xA1 32B 01 02\n", "[ 3] error=202"]) {
  const h = harness({ log });
  const report = await h.api.collectBugReport();
  assert.ok(report.text.includes(log.trim()));
  await h.api.copyDiagnostics();
  assert.ok(h.state.copies.at(-1).includes(log.trim()));
}
console.log("public report privacy: actual crash, report, display, clipboard and download producers passed");
