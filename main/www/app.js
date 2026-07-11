// Web UI for daikin-altherma-esp32. Talks to the firmware HTTP API (see docs/README.md).
// Split from index.html for edit locality; spliced back in at build time (inline_assets.cmake).
"use strict";

const $ = (id) => document.getElementById(id);
const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); };
let MODELS = null;   // /models catalog, fetched once

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function setV(id, text, cls) { const e = $(id); e.textContent = text; e.className = "v" + (cls ? " " + cls : ""); }

// ── Status (polled) ────────────────────────────────────────────────────────
async function refreshStatus() {
  let s;
  try { s = await j("/status"); } catch { setV("s-wifi", "unreachable", "err"); return; }
  $("ver").textContent = "v" + (s.version || "?");
  const w = s.wifi || {};
  setV("s-wifi", w.ssid ? `${w.ssid} (${w.rssi ?? "?"} dBm)` : "not connected", w.ssid ? "ok" : "warn");
  setV("s-ip", w.ip || "—");
  const m = s.mqtt || {};
  setV("s-mqtt", !m.configured ? "off" : m.connected ? `connected${m.tls ? " (TLS)" : ""}` : (m.error || "connecting…"),
       !m.configured ? "" : m.connected ? "ok" : "warn");
  const hp = s.hp || {};
  setV("s-hp", hp.connected ? "online" : "no data", hp.connected ? "ok" : "err");
  setV("s-link", `${hp.proto || "?"} · RX${hp.rx ?? "?"} TX${hp.tx ?? "?"} · ${hp.poll_s ?? "?"}s`);
  setV("s-last", hp.last_ok_s != null ? `${hp.last_ok_s}s ago` : "—");
  setV("s-err", `${hp.crc_err || 0} CRC · ${hp.timeout_err || 0} timeout`, (hp.crc_err || hp.timeout_err) ? "warn" : "ok");
  const p = s.profile || {};
  setV("s-prof", p.id ? `${p.id} (${p.lang || "en"})` : "—");
}

// ── Values (polled) ────────────────────────────────────────────────────────
async function refreshValues() {
  let vals;
  try { vals = await j("/values"); } catch { return; }
  const rows = (vals.values || vals).map(v =>
    `<tr><td>${esc(v.label)}</td><td>${esc(fmt(v))}</td></tr>`).join("");
  $("values").querySelector("tbody").innerHTML =
    rows || `<tr><td class="muted">No values yet — check wiring / model.</td></tr>`;
}
const esc = (s) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (v) => v.value == null ? "—" : `${v.value}${v.unit ? " " + v.unit : ""}`;

// ── Models catalog → populate selects + value menu + pin hint ───────────────
async function loadModels() {
  try { MODELS = await j("/models"); } catch { return; }
  fill($("selIndoor"), MODELS.indoor); fill($("selOutdoor"), MODELS.outdoor); fill($("selTank"), MODELS.tank);
  for (const el of [$("selIndoor"), $("selOutdoor"), $("selTank")]) el.onchange = onModelChange;
  if (MODELS.pin_hint) $("pinHint").textContent = MODELS.pin_hint;
  onModelChange();
}
function fill(sel, items) {
  sel.innerHTML = (items || []).map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
}
function onModelChange() {
  if (!MODELS) return;
  const prof = resolveProfile();
  const values = (MODELS.values && MODELS.values[prof]) || MODELS.default_values || [];
  $("valMenu").className = "valmenu";
  $("valMenu").innerHTML = values.length
    ? values.map(v => `<label><input type="checkbox" value="${esc(v.id)}" ${v.on ? "checked" : ""}>${esc(v.label)}</label>`).join("")
    : `<span class="muted">No value list for this profile.</span>`;
}
function resolveProfile() {
  // The firmware maps (indoor,outdoor,tank) → profile id; mirror its lookup table if provided.
  const key = [$("selIndoor").value, $("selOutdoor").value, $("selTank").value].join("|");
  return (MODELS.profile_map && MODELS.profile_map[key]) || MODELS.default_profile || "generic";
}

// ── Form submit handlers ────────────────────────────────────────────────────
function onSubmit(formId, url, build, reboots) {
  $(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(build(new FormData(e.target))) });
      toast(reboots ? "Saved — rebooting…" : "Applied ✓");
    } catch { toast("Failed ✗"); }
  });
}
onSubmit("wifiForm", "/set_wifi", f => ({ ssid: f.get("ssid"), pass: f.get("pass") }), true);
onSubmit("mqttForm", "/set_mqtt", f => ({ broker: f.get("broker"), user: f.get("user"), pass: f.get("pass") }), true);
onSubmit("hpForm", "/set_hp", f => ({
  profile: resolveProfile(), lang: f.get("lang"), proto: f.get("proto"),
  rx: +f.get("rx"), tx: +f.get("tx"), poll_s: +f.get("poll_s"),
  values: [...document.querySelectorAll("#valMenu input:checked")].map(c => c.value),
}), false);
onSubmit("relayForm", "/set_relays", f => ({
  therm_pin: +f.get("therm_pin"), sg1_pin: +f.get("sg1_pin"), sg2_pin: +f.get("sg2_pin"),
}), false);

// ── OTA (tap the version) ───────────────────────────────────────────────────
$("ver").addEventListener("click", async () => {
  toast("Checking for updates…");
  try {
    await fetch("/ota/check?ms=" + Date.now());
    const poll = setInterval(async () => {
      const st = await j("/ota/status");
      if (st.state === "idle" || st.state === "done") {
        clearInterval(poll);
        if (st.update_available && confirm(`Update ${st.current} → ${st.available}?`)) {
          await fetch("/ota/update", { method: "POST" }); toast("Updating — device will reboot…");
        } else toast(st.update_available ? "Update available" : "Up to date");
      }
    }, 1500);
  } catch { toast("Update check failed"); }
});

// ── WiFi scan for the SSID datalist ─────────────────────────────────────────
async function loadSsids() {
  try {
    const s = await j("/status");
    if (s.wifi?.ssid) $("wifiForm").ssid.value = s.wifi.ssid;
  } catch {}
}

// ── boot ────────────────────────────────────────────────────────────────────
loadModels(); loadSsids();
refreshStatus(); refreshValues();
setInterval(refreshStatus, 4000);
setInterval(refreshValues, 8000);
$("refreshVals").onclick = refreshValues;
