// Regression test for the Ethernet connection row. Executes the production connLinks()/connRow()
// functions so Ethernet never renders an edit pencil or data-edit target, properly marks uneditable
// rows as disabled with default cursor, and accurately reflects link/lease state in both languages.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["i18n.js"]) + readUiLocale("de") + readAppFragments(["dashboard.js"]);
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");

const context = {
  navigator: { language: "de-DE" },
  localStorage: { getItem: () => null, setItem: () => {} },
  S: { status: {} },
  signalBars: () => "",
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

function ethRow(patch, lang = "de") {
  sandbox.__setLang(lang);
  context.S.status = {
    wifi: { connected: false, std: "Wi-Fi" },
    mqtt: { configured: false },
    syslog: { configured: false },
    ntp: { synced: true, server: "pool.ntp.org" },
    net: { eth: { present: true, ...patch } },
  };
  return sandbox.__connLinks().find((row) => row.label === "Ethernet");
}

// 1. Unplugged / no cable
{
  const row = ethRow({ link: false, lease: false }, "de");
  assert.ok(row, "Ethernet row must be present when eth controller detected");
  assert.equal(row.cls, "err", "unlinked Ethernet is visibly err");
  assert.equal(row.value, "Kein Kabel");
  assert.equal(row.edit, undefined, "Ethernet has no edit modal target");

  const html = sandbox.__connRow(row);
  assert.doesNotMatch(html, /vcard-edit-icon/, "unlinked Ethernet must NOT render an edit pencil icon");
  assert.doesNotMatch(html, />-<\/button>/, "unlinked Ethernet row must NOT render '-'");
  assert.match(html, /disabled/, "unlinked Ethernet button must be disabled to prevent clicks");
  assert.doesNotMatch(html, /data-edit/, "unlinked Ethernet must NOT define a data-edit modal attribute");
  assert.match(html, /aria-label="Ethernet: Kein Kabel"/, "aria-label must NOT tell user to tap to edit");
  assert.doesNotMatch(html, /Zum Bearbeiten tippen/, "unlinked Ethernet must never claim to be editable");
}

// 2. Cable plugged in, but no DHCP lease yet
{
  const row = ethRow({ link: true, lease: false }, "de");
  assert.equal(row.cls, "warn", "linked but unleased Ethernet is transient warn");
  assert.equal(row.value, "Kabel verbunden, keine Adresse");
  const html = sandbox.__connRow(row);
  assert.doesNotMatch(html, /vcard-edit-icon/, "cable-only Ethernet must NOT render an edit pencil icon");
  assert.doesNotMatch(html, />-<\/button>/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-label="Ethernet: Kabel verbunden, keine Adresse"/);
}

// 3. Full link and lease in German
{
  const row = ethRow({ link: true, lease: true, speed_mbps: 100, full_duplex: true }, "de");
  assert.equal(row.cls, "ok", "leased Ethernet is healthy ok");
  assert.equal(row.value, "100 Mbit/s Vollduplex");
  const html = sandbox.__connRow(row);
  assert.doesNotMatch(html, /vcard-edit-icon/, "connected Ethernet must NOT render an edit pencil icon");
  assert.doesNotMatch(html, />-<\/button>/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-label="Ethernet: 100 Mbit\/s Vollduplex"/);
}

// 4. English localisation
{
  const rowNoCable = ethRow({ link: false, lease: false }, "en");
  assert.equal(rowNoCable.value, "No cable");
  const htmlNoCable = sandbox.__connRow(rowNoCable);
  assert.match(htmlNoCable, /aria-label="Ethernet: No cable"/);
  assert.doesNotMatch(htmlNoCable, /Tap to edit/);

  const rowNoLease = ethRow({ link: true, lease: false }, "en");
  assert.equal(rowNoLease.value, "Cable connected, no address");

  const rowOk = ethRow({ link: true, lease: true, speed_mbps: 100, full_duplex: true }, "en");
  assert.equal(rowOk.value, "100 Mbit/s full duplex");
}

// 5. Board without Ethernet controller
{
  context.S.status = {
    wifi: { connected: true, ssid: "test-wifi", rssi: -60 },
    net: { eth: { present: false } },
  };
  const row = sandbox.__connLinks().find((r) => r.label === "Ethernet");
  assert.equal(row, undefined, "Ethernet row must be absent when no controller is present");
}

// 6. CSS contract: 15px fixed column for perfect vertical right-alignment across rows
assert.match(style, /grid-template-columns:\s*max-content minmax\(0,1fr\) 15px;/,
  "conn-row grid must keep a fixed 15px column for consistent right alignment");
assert.match(style, /\.conn-row\[data-edit\]\s*\{\s*cursor:\s*pointer;\s*\}/,
  "only rows with data-edit target must have cursor: pointer");

console.log("Ethernet connection status: unclickable + clean aria + aligned grid contract passed");
