// Regression test for the HomeHub connection row. Executes the production connLinks()/connRow()
// functions so a backend error cannot turn the hostname red again without explaining why below it.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const app = fs.readFileSync(new URL("../main/www/app.js", import.meta.url), "utf8");
const from = app.indexOf("function modbusErrorText(");
const to = app.indexOf("// ── Settings screen", from);
assert.notEqual(from, -1, "missing production modbusErrorText()");
assert.notEqual(to, -1, "missing end of production connection helpers");

const translated = {
  "modbus.err.response_timeout": (r) => `Zeitüberschreitung bei Register ${r}`,
  "modbus.err.exception": (r, n, why) => `Register ${r}: Ausnahme ${n} (${why})`,
  "modbus.exc.2": "unzulässige Registeradresse",
  "modbus.exc.unknown": "unbekannter Grund",
};
const context = {
  S: { status: {} },
  esc: (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[c])),
  editIcon: '<svg class="vcard-edit-icon"></svg>',
  t: (key, ...args) => {
    if (key === "conn.error") return `Fehler: ${args[0]}`;
    if (key === "conn.aria") return `${args[0]}: ${args[1]}`;
    const value = translated[key];
    return typeof value === "function" ? value(...args) : value ?? key;
  },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${app.slice(from, to)}\nthis.__connLinks = connLinks; this.__connRow = connRow;`,
  sandbox,
  { filename: "main/www/app.js" },
);

function baseModbus(patch) {
  context.S.status = {
    wifi: { connected: false, std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
    modbus: { enabled: true, connected: false, host: "203.0.113.137", ...patch },
  };
  return sandbox.__connLinks().find((row) => row.edit === "homehub");
}

{
  const row = baseModbus({
    error: "HomeHub response timed out at register 42",
    error_code: "response_timeout",
    error_detail: 110,
    error_register: 42,
  });
  assert.equal(row.cls, "err", "a disconnected HomeHub remains visibly down");
  assert.equal(row.value, "203.0.113.137", "the discovered IPv4 stays the primary value");
  assert.equal(row.detail, "Zeitüberschreitung bei Register 42", "the structured cause is localised");
  assert.match(row.state, /Zeitüberschreitung/, "the accessible state includes the same cause");

  const html = sandbox.__connRow(row);
  assert.match(html, /class="conn-detail">Zeitüberschreitung bei Register 42<\/span>/);
  assert.ok(html.lastIndexOf("203.0.113.137") < html.lastIndexOf("Zeitüberschreitung"),
    "the subtle error line is rendered under/after the host");
  assert.doesNotMatch(html, /HomeHub response timed out/, "raw backend prose does not replace localisation");
}

{
  const row = baseModbus({
    connected: true,
    error: "HomeHub rejected register 56 (Modbus exception 2: illegal data address)",
    error_code: "modbus_exception",
    error_detail: 2,
    error_register: 56,
  });
  assert.equal(row.cls, "mb", "one rejected register does not claim the TCP link is down");
  assert.equal(row.detail, "Register 56: Ausnahme 2 (unzulässige Registeradresse)");
}

{
  const row = baseModbus({ error: "future socket <failure>", error_code: "future_code" });
  const html = sandbox.__connRow(row);
  assert.match(html, /future socket &lt;failure&gt;/,
    "unknown future codes fall back to escaped human-readable API prose");
}

console.log("Modbus connection status: IPv4 + localised inline error contract passed");
