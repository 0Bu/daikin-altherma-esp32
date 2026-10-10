// Execute the production crash renderer and copy/delete producers. A stored dump identifies a
// build, not a boot: even a matching ELF prefix cannot attribute its frames to the current reset.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("main/www/js/i18n.js", "utf8") + "\n" +
  fs.readFileSync("main/www/js/app_state.js", "utf8");
const ELF_PREFIX = "abcdef012"; // The pinned firmware's default retrieved ELF identity is nine hex characters.
const PRIVATE = "FICTITIOUS_PRIVATE_NTP";
const WITNESS = "[ 124] raw X10A 00 aa bb cc CRC_ERR=7";
const LOG = `[... truncated ...]\n[ 123] sntp: time synced (<redacted>)\n${WITNESS}\n`;
const SUMMARY = {
  task: "stored_httpd", pc: "0x42001234", backtrace: ["0x42001234", "0x42005678"],
  elf_sha256: ELF_PREFIX,
};

function harness({ crash, secure = true, failure = "", deleteFailure = "" } = {}) {
  const state = { calls: [], copies: [], bodyReads: 0, selected: null, deleteFailure };
  const elements = new Map();
  function element() {
    return {
      hidden: true, innerHTML: "", value: "", style: {}, dataset: {}, lastChild: {}, children: [],
      appendChild(child) { this.children.push(child); }, setAttribute() {}, remove() {},
      select() { state.selected = this; },
    };
  }
  const document = {
    body: element(),
    createElement: element,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    execCommand(command) {
      assert.equal(command, "copy"); state.copies.push(state.selected.value); return true;
    },
  };
  const fetch = async (url, options) => {
    state.calls.push({ url, method: options?.method || "GET" });
    if (url === "/crash/dismiss") {
      if (state.deleteFailure === "network") throw new Error("delete unavailable");
      return { ok: !state.deleteFailure, status: state.deleteFailure ? 503 : 200 };
    }
    assert.ok(url === "/diag" || url === "/diag?redact=1", `unexpected evidence request ${url}`);
    if (failure === "network") throw new Error("network unavailable");
    return {
      ok: failure !== "http", status: failure === "http" ? 503 : 200,
      async text() {
        state.bodyReads++;
        if (failure === "body") throw new Error("diagnostic body unavailable");
        return url === "/diag?redact=1" && failure !== "http" ? LOG : `${PRIVATE}\n${LOG}`;
      },
    };
  };
  const context = vm.createContext({
    document, fetch, URL, URLSearchParams, Blob, console, setTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    window: { isSecureContext: secure },
    navigator: { language: "en", clipboard: { async writeText(text) { state.copies.push(text); } } },
  });
  vm.runInContext(source + "\nglobalThis.api = { S, t, renderCrashBanner, copyDiagnostics, deleteCrashReport };", context);
  context.api.S.status = {
    version: "SEC02-fixture", platform: "esp32s3", app_elf_sha256: ELF_PREFIX,
    ntp: { server: PRIVATE }, wifi: { ssid: PRIVATE },
    ...(crash === undefined ? {} : { last_crash: crash }),
  };
  return { state, api: context.api, document, fetch, banner: document.getElementById("crashBanner") };
}

const cases = [
  { name: "current fault with matching old nine-character summary", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: true, ...SUMMARY }, stored: true, download: true,
    task: "stored_httpd", pc: "0x42001234", backtrace: "0x42001234 0x42005678", elf: ELF_PREFIX },
  { name: "normal reset with orphan", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: true, ...SUMMARY }, stored: true, download: true,
    task: "stored_httpd", pc: "0x42001234", backtrace: "0x42001234 0x42005678", elf: ELF_PREFIX },
  { name: "fault without dump", reason: "brownout", fault: true,
    crash: { reason: "brownout", fault: true, coredump: false } },
  { name: "power glitch is a fault without an application crash claim", reason: "pwr_glitch", fault: true,
    crash: { reason: "pwr_glitch", fault: true, coredump: false } },
  { name: "planned software reset is normal", reason: "sw", fault: false,
    crash: { reason: "sw", fault: false, coredump: false } },
  { name: "cached summary without raw image", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, ...SUMMARY }, stored: true,
    task: "stored_httpd", pc: "0x42001234", backtrace: "0x42001234 0x42005678", elf: ELF_PREFIX },
  { name: "only valid stored ELF prefix", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: ELF_PREFIX }, stored: true, elf: ELF_PREFIX },
  { name: "raw image without summary", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: true }, stored: true, download: true },
  { name: "proven foreign summary suppressed on fault", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false } },
  { name: "proven foreign summary suppressed on normal reset", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false } },
  { name: "empty crash object", reason: "?", fault: false, crash: {} },
  { name: "missing crash field", reason: "?", fault: false },
  { name: "null crash field", reason: "?", fault: false, crash: null },
  { name: "malformed flags and summary", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: "true", coredump: "true", task: null, pc: 42,
      backtrace: [null, {}, "not an address"], elf_sha256: "nothex!!!" } },
  { name: "empty metadata fields", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, task: "", pc: "", backtrace: [], elf_sha256: "" } },
  { name: "whitespace-only task cannot invent an earlier report", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, task: " \t\n", pc: " ", elf_sha256: " " } },
  { name: "whitespace-only task on fault adds no stored report", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: " \t\n" } },
  { name: "padded PC and ELF remain invalid", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, pc: " 0x42001234 ",
      backtrace: [" 0x42005678 "], elf_sha256: " abcdef012 " } },
  { name: "short identity alone", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: "abcdef0" } },
  { name: "nonhex identity alone", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: "abcdef01z" } },
  { name: "overlong identity alone", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: "a".repeat(65) } },
  { name: "valid eight-character stored prefix", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: "abcdef01" }, stored: true, elf: "abcdef01" },
  { name: "valid full stored identity", reason: "poweron", fault: false,
    crash: { reason: "poweron", fault: false, coredump: false, elf_sha256: "a".repeat(64) }, stored: true, elf: "a".repeat(64) },
  { name: "invalid metadata on a real fault", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: {}, pc: "address?", backtrace: [], elf_sha256: "?" } },
  { name: "stored task cannot inject a fake reset record", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "x\nreset=panic" }, stored: true, task: "x\nreset=panic" },
  { name: "stored task controls quotes and backslash stay inside one JSON record", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "a\nb\r\t\"\\reset=x" }, stored: true, task: "a\nb\r\t\"\\reset=x" },
  { name: "stored task NEL cannot inject a fake reset record", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "x\u0085reset=panic" }, stored: true, task: "x\u0085reset=panic" },
  { name: "stored task Unicode line separator cannot inject a fake reset record", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "x\u2028reset=panic" }, stored: true, task: "x\u2028reset=panic" },
  { name: "stored task Unicode paragraph separator cannot inject a fake reset record", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "x\u2029reset=panic" }, stored: true, task: "x\u2029reset=panic" },
  { name: "escaped stored task and filtered frames", reason: "panic", fault: true,
    crash: { reason: "panic", fault: true, coredump: false, task: "<stored-task>", pc: "0x42001234",
      backtrace: [null, "0x42005678", "not an address"], corrupted: true }, stored: true,
    task: "<stored-task>", pc: "0x42001234", backtrace: "0x42005678  (corrupted)" },
];

for (const test of cases) for (const secure of [true, false]) {
  const h = harness({ crash: test.crash, secure });
  h.api.renderCrashBanner();
  assert.equal(h.banner.hidden, !test.fault && !test.stored, test.name);
  if (!h.banner.hidden) {
    assert.ok(h.banner.innerHTML.includes(h.api.t(test.fault ? "crash.title_fault" : "crash.title_orphan")), test.name);
    if (test.fault) {
      assert.equal(h.api.t("crash.title_fault"), "Device restarted after a fault");
      assert.ok(!h.banner.innerHTML.includes("Device restarted after a crash"));
    }
    assert.equal(h.banner.innerHTML.includes(h.api.t("crash.stored_hint")), !!test.stored, test.name);
    assert.equal(h.banner.innerHTML.includes('href="/coredump"'), !!test.download, test.name);
    if (test.task === "<stored-task>") {
      assert.ok(h.banner.innerHTML.includes("&lt;stored-task&gt;"));
      assert.ok(!h.banner.innerHTML.includes("<stored-task>"));
    }
  }
  // The raw endpoint proves this fixture catches an accidental unredacted acquisition.
  assert.ok((await (await h.fetch("/diag")).text()).includes(PRIVATE));
  h.state.calls.length = 0;
  await h.api.copyDiagnostics(); // Actual production renderer, acquisition, assembly and clipboard paths.
  const report = h.state.copies.at(-1);
  assert.deepEqual(h.state.calls, [{ url: "/diag?redact=1", method: "GET" }], test.name);
  assert.ok(report.startsWith("daikin-altherma-esp32 crash report\n"));
  assert.ok(report.includes(`current boot reset: ${test.reason}  fault=${test.fault}  coredump=${!!test.download}`), test.name);
  assert.equal(report.includes("stored dump metadata: age unknown; relationship to this reset unknown"), !!test.stored, test.name);
  for (const [label, value] of [["task", test.task], ["pc", test.pc], ["backtrace", test.backtrace], ["elf_sha256", test.elf]]) {
    if (value && label === "task") {
      const prefix = "stored dump task: ";
      const record = report.split("\n").find(line => line.startsWith(prefix));
      assert.ok(record, `${test.name}: missing stored task record`);
      assert.equal(JSON.parse(record.slice(prefix.length)), value, `${test.name}: stored task round trip`);
      assert.doesNotMatch(record, /[\r\t\u0085\u2028\u2029]/);
    }
    else if (value) assert.ok(report.includes(`\nstored dump ${label}: ${value}\n`), `${test.name}: ${label}`);
    else assert.ok(!report.includes(`\nstored dump ${label}:`), `${test.name}: invented ${label}`);
  }
  const header = report.split("\n--- /diag ---")[0];
  assert.doesNotMatch(header, /[\r\t\u0085\u2028\u2029]/, `${test.name}: physical copied record boundary`);
  assert.doesNotMatch(header, /^(?:reset|fault|source|task|pc|elf_sha256)=/m, `${test.name}: forged bare record`);
  assert.doesNotMatch(report, /\n(?:task|pc|backtrace|crashed build elf_sha256):/);
  assert.ok(report.includes(WITNESS));
  assert.ok(report.includes("[... truncated ...]"));
  assert.ok(!report.includes(PRIVATE));

  if (!h.banner.hidden) {
    const sig = h.banner.dataset.sig;
    h.api.S.crashAsk = sig;
    h.api.renderCrashBanner(); // The existing click handler arms this state; no request occurs yet.
    assert.ok(h.banner.innerHTML.includes(h.api.t(test.download ? "crash.ask_dump" : "crash.ask")), test.name);
    assert.ok(h.banner.innerHTML.includes('data-cact="del"'));
    assert.ok(h.banner.innerHTML.includes('data-cact="keep"'));
    assert.ok(!h.banner.innerHTML.includes('data-cact="copy"'));
    assert.ok(!h.banner.innerHTML.includes('href="/coredump"'));
    assert.ok(!h.state.calls.some(call => call.url === "/crash/dismiss"));
    h.api.S.crashAsk = "";
    h.api.renderCrashBanner();
    assert.equal(h.banner.innerHTML.includes('href="/coredump"'), !!test.download);
  }
}

// Clearing the raw image removes the download/erase-dump claim, but keeps a cached summary bounded.
{
  const h = harness({ crash: { reason: "panic", fault: true, coredump: true, ...SUMMARY } });
  h.api.renderCrashBanner();
  const sig = h.banner.dataset.sig;
  h.api.S.status.last_crash.coredump = false;
  h.api.renderCrashBanner();
  assert.equal(h.banner.dataset.sig, sig);
  assert.ok(!h.banner.innerHTML.includes('href="/coredump"'));
  assert.ok(h.banner.innerHTML.includes(h.api.t("crash.stored_hint")));
  h.api.S.crashAsk = sig;
  h.api.renderCrashBanner();
  assert.ok(h.banner.innerHTML.includes(h.api.t("crash.ask")));
  assert.ok(!h.banner.innerHTML.includes(h.api.t("crash.ask_dump")));
}

for (const failure of ["http", "network", "body"]) {
  const h = harness({ crash: { reason: "panic", fault: true, coredump: true, ...SUMMARY }, failure });
  await h.api.copyDiagnostics();
  const report = h.state.copies.at(-1);
  assert.match(report, /current boot reset: panic  fault=true  coredump=true/);
  assert.match(report, /stored dump metadata: age unknown; relationship to this reset unknown/);
  assert.match(report, /stored dump elf_sha256: abcdef012/);
  assert.match(report, /Could not be read from the device:/);
  assert.match(report, failure === "http" ? /HTTP 503/ : failure === "network" ? /network unavailable/ : /diagnostic body unavailable/);
  assert.ok(!report.includes(PRIVATE));
  assert.ok(!report.includes(WITNESS), "unread diagnostic data is not evidence");
  if (failure === "http") assert.equal(h.state.bodyReads, 0, "a rejected response body must not enter the report");
  assert.deepEqual(h.state.calls, [{ url: "/diag?redact=1", method: "GET" }]);
}

// A refused delete retains the record and its bounded metadata; only confirmed success hides it.
for (const deleteFailure of ["http", "network"]) {
  const h = harness({ crash: { reason: "panic", fault: true, coredump: true, ...SUMMARY }, deleteFailure });
  h.api.renderCrashBanner();
  const sig = h.banner.dataset.sig;
  h.api.S.crashAsk = sig;
  await h.api.deleteCrashReport(sig);
  assert.equal(h.banner.hidden, false);
  assert.equal(h.api.S.status.last_crash.task, "stored_httpd");
  assert.ok(h.banner.innerHTML.includes(h.api.t("crash.stored_hint")));
  assert.equal(h.document.getElementById("toasts").children.at(-1).lastChild.textContent, h.api.t("crash.delete_fail"));
  h.state.deleteFailure = "";
  await h.api.deleteCrashReport(sig);
  assert.equal(h.api.S.status.last_crash, null);
  assert.equal(h.api.S.crashDismissed, sig);
  assert.equal(h.banner.hidden, true);
  assert.deepEqual(h.state.calls, [
    { url: "/crash/dismiss", method: "POST" }, { url: "/crash/dismiss", method: "POST" },
  ]);
}

console.log(`crash provenance: ${cases.length * 2} real production renderer/copy states, acquisition failures and delete outcomes passed`);
