// Regression test for the HomeHub connection row. Executes the production connLinks()/connRow()
// functions so the endpoint and shared status palette cannot drift from the other connections, and
// a backend error cannot replace the address without explaining the failure below it.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const dashboardSource = readAppFragments(["dashboard.js"]);

const translated = {
  "conn.homehub": "HomeHub",
  "conn.disabled": "Deaktiviert",
  "conn.offline": "Offline",
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
  t: (key, ...args) => {
    if (key === "conn.error") return `Fehler: ${args[0]}`;
    if (key === "conn.aria") return `${args[0]}: ${args[1]}`;
    const value = translated[key];
    return typeof value === "function" ? value(...args) : value ?? key;
  },
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${dashboardSource}\nthis.__connLinks = connLinks; this.__connRow = connRow;`,
  sandbox,
  { filename: "main/www/app.sources" },
);

function baseModbus(patch) {
  context.S.status = {
    wifi: { connected: false, std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
    modbus: { enabled: true, connected: false,
      host: "192.0.2.137", port: 502, ...patch },
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
  assert.equal(row.label, "HomeHub", "the connection row names the configured peer, not its protocol");
  assert.equal(row.value, "192.0.2.137:502", "the configured IPv4 and port stay the primary value");
  assert.equal(row.detail, "Zeitüberschreitung bei Register 42", "the structured cause is localised");
  assert.match(row.state, /Zeitüberschreitung/, "the accessible state includes the same cause");

  const html = sandbox.__connRow(row);
  assert.match(html, /aria-label="HomeHub: Fehler:/, "the accessible label uses the same HomeHub name");
  assert.match(html, /class="conn-detail">Zeitüberschreitung bei Register 42<\/span>/);
  assert.ok(html.lastIndexOf("192.0.2.137:502") < html.lastIndexOf("Zeitüberschreitung"),
    "the subtle error line is rendered under/after the endpoint");
  assert.doesNotMatch(html, /HomeHub response timed out/, "raw backend prose does not replace localisation");
}

{
  const row = baseModbus({
    connected: true,
    port: 1502,
    error: "HomeHub rejected register 56 (Modbus exception 2: illegal data address)",
    error_code: "modbus_exception",
    error_detail: 2,
    error_register: 56,
  });
  assert.equal(row.cls, "ok", "a connected Modbus endpoint uses the shared healthy-link colour");
  assert.equal(row.value, "192.0.2.137:1502", "the configured non-default port is shown");
  assert.equal(row.detail, "Register 56: Ausnahme 2 (unzulässige Registeradresse)");
}

{
  const row = baseModbus({ error: "future socket <failure>", error_code: "future_code" });
  const html = sandbox.__connRow(row);
  assert.match(html, /future socket &lt;failure&gt;/,
    "unknown future codes fall back to escaped human-readable API prose");
}

{
  const row = baseModbus({ enabled: false, host: "" });
  assert.equal(row.cls, "", "an empty address is the neutral disabled state");
  assert.equal(row.value, "—");
  assert.equal(row.state, "Deaktiviert");
}

{
  const row = baseModbus({ enabled: false, host: "homehub.local" });
  assert.equal(row.cls, "err", "a saved address without a running link is visibly offline");
  assert.equal(row.value, "homehub.local:502");
  assert.equal(row.state, "Offline");
}

console.log("Modbus connection status: endpoint + shared state colours + localised inline error contract passed");
