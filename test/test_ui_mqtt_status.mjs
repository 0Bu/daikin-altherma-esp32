// Regression test for the MQTT connection row. Execute the production i18n + row helpers so a
// configured broker that cannot connect keeps its address visible and explains the runtime cause
// underneath it in the selected UI language.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["i18n.js", "dashboard.js"]);
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const context = {
  navigator: { language: "de-DE" },
  localStorage: { getItem: () => null, setItem: () => {} },
  S: { status: {} },
  esc: (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[c])),
};
const sandbox = vm.createContext(context);
vm.runInContext(
  `${source}\nthis.__connLinks = connLinks; this.__connRow = connRow; this.__setLang = (v) => { LANG = v; };`,
  sandbox,
  { filename: "main/www/app.sources" },
);

function mqttRow(patch, lang = "de") {
  sandbox.__setLang(lang);
  context.S.status = {
    wifi: { connected: false, std: "Wi-Fi" },
    mqtt: { configured: true, connected: false, broker: "192.0.2.10:1883", ...patch },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
  };
  return sandbox.__connLinks().find((row) => row.edit === "mqtt");
}

{
  const row = mqttRow({ error: "waiting for X10A response" });
  assert.equal(row.cls, "err", "a bounded MQTT runtime error remains visibly down");
  assert.equal(row.value, "192.0.2.10:1883", "the configured broker stays the primary value");
  assert.equal(row.detail,
    "Noch keine Antwort der Wärmepumpe über X10A — Verkabelung, GND und RX/TX-Pins prüfen.",
    "older firmware's X10A gate reason remains understandable instead of blaming the broker");
  assert.match(row.state, /Fehler: Noch keine Antwort/, "the accessible state carries the same cause");

  const html = sandbox.__connRow(row);
  assert.match(html,
    /class="conn-row has-detail"[\s\S]*class="conn-detail-wrap"><span class="conn-detail">Noch keine Antwort der Wärmepumpe über X10A/,
    "the error tongue is a full-row sibling below the endpoint header, not trapped in its value column");
  assert.ok(html.lastIndexOf("192.0.2.10:1883") < html.lastIndexOf("Noch keine Antwort"),
    "the error is rendered underneath/after the broker");

  assert.match(style,
    /\.conn-detail-wrap\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*overflow:\s*hidden[^}]*box-shadow:\s*inset 0 1px 0 var\(--line\)/s,
    "the runtime cause must get the explainer's full-row clipped slide area");
  assert.match(style,
    /\.conn-detail\s*\{[^}]*margin:\s*0 10px 1px[^}]*padding:\s*13px 14px 12px[^}]*background:\s*var\(--err-tint\)[^}]*border-top:\s*0[^}]*border-radius:\s*0 0 var\(--r-tile\) var\(--r-tile\)[^}]*box-shadow:\s*var\(--shadow-tongue\)[^}]*line-height:\s*1\.55[^}]*animation:\s*conn-tongue-in \.22s ease both/s,
    "the runtime cause must match the inset, type, radius and motion of the value explainer");
  assert.match(style,
    /@keyframes conn-tongue-in\s*\{[\s\S]*from\s*\{[^}]*translateY\(-7px\)[^}]*\}[\s\S]*to\s*\{[^}]*transform:\s*none/,
    "the tongue must slide down from underneath the endpoint exactly once when inserted");
  assert.match(style,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \.view\.active\s*\{\s*animation:\s*none !important;/,
    "the global reduced-motion contract must suppress the tongue animation");
}

{
  const row = mqttRow({ error: "waiting for X10A response" }, "en");
  assert.equal(row.detail,
    "No heat-pump response on X10A yet — check wiring, GND and the RX/TX pins.",
    "the same runtime reason follows the selected UI language");
}

{
  const row = mqttRow({ error: "future socket <failure>" });
  const html = sandbox.__connRow(row);
  assert.equal(row.detail, "future socket <failure>",
    "unknown future firmware reasons remain visible for forward compatibility");
  assert.match(html, /future socket &lt;failure&gt;/, "fallback API prose is escaped in the row");
}

{
  const row = mqttRow({ error: "" });
  assert.equal(row.cls, "warn", "a connection attempt without a failure remains transient");
  assert.equal(row.detail, "", "a transient connection does not invent an error line");
  assert.equal(row.state, "Verbinde…");
}

{
  const row = mqttRow({ connected: true, error: "tls/tcp error" });
  assert.equal(row.cls, "ok");
  assert.equal(row.detail, "", "a connected broker never shows a stale failure");
  assert.equal(row.state, "Verbunden");
}

console.log("MQTT connection status: broker + localised inline runtime error contract passed");
