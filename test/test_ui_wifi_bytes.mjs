// Execute the complete standalone setup script, including actual submit and error recovery.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../main/www/setup.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([^]*?)<\/script>/g)];
assert.equal(scripts.length, 1, "standalone setup must expose one complete script");
const source = scripts[0][1];
const cases = [
  ["Network", "password8", true], ["", "password8", false],
  ["ä".repeat(16), "ä".repeat(4), true], ["ä".repeat(17), "password8", false],
  ["😀".repeat(8), "", true], ["😀".repeat(9), "password8", false],
  ["Network", "1234567", false], ["Network", "ä".repeat(31) + "a", true],
  ["Network", "ä".repeat(32), false], [" spaced ", "quoted\\\"pass", true],
];
function harness(script, mode = "ok") {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", className: "", disabled: false, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
    });
    return elements.get(id);
  } };
  const calls = [];
  const context = vm.createContext({ document, TextEncoder, console, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (mode === "unreachable") throw new Error("offline");
    return { ok: mode === "ok", status: mode === "busy" ? 503 : mode === "ok" ? 200 : 400,
      text: async () => JSON.stringify({ ok: false, error: "invalid fixture input" }) };
  } });
  vm.runInContext(script, context);
  return { elements, calls, async submit(ssid, pass) {
    document.getElementById("ssid").value = ssid;
    document.getElementById("pass").value = pass;
    await document.getElementById("f").listeners.submit({ preventDefault() {} });
  } };
}
async function credentialOracle(script) {
  for (const [ssid, pass, accepted] of cases) {
    const h = harness(script);
    await h.submit(ssid, pass);
    assert.equal(h.calls.length, Number(accepted), "setup must enforce UTF-8 byte limits");
    if (accepted) {
      assert.deepEqual(h.calls[0], { url: "/set_wifi", body: { ssid, pass } });
      assert.match(h.elements.get("msg").textContent, /^Saved/);
    } else assert.doesNotMatch(h.elements.get("msg").textContent, /^Saved/);
  }
}
await credentialOracle(source);
for (const mode of ["reject", "busy", "unreachable"]) {
  const h = harness(source, mode);
  await h.submit("Network", "ä".repeat(4));
  assert.equal(h.calls.length, 1);
  assert.equal(h.elements.get("btn").disabled, false, "rejected save must permit retry");
  assert.equal(h.elements.get("pass").value, "ä".repeat(4));
  assert.doesNotMatch(h.elements.get("msg").textContent, /^Saved/);
}
const mutant = source.replace("new TextEncoder().encode(ssid).length", "ssid.length")
  .replace("new TextEncoder().encode(pass).length", "pass.length");
assert.notEqual(mutant, source, "byte-length mutation anchor missing");
await assert.rejects(credentialOracle(mutant), /setup must enforce UTF-8 byte limits/);
console.log(`Setup WiFi: ${cases.length} credential boundaries, three rejection recoveries, compiling UTF-16 regression rejected`);
