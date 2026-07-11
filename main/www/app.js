// Web UI for daikin-altherma-esp32 — a client-side, view-switched SPA over the firmware HTTP API.
// Design contract: docs/DESIGN.md. Split from index.html for edit locality; spliced back in at
// build time (inline_assets.cmake). No framework, no external assets.
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const j = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status); return r.json(); };
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ── App state ────────────────────────────────────────────────────────────
const S = {
  stage: "dashboard",        // dashboard | wifi | mqtt | hp | settings | diag | firmware
  wizard: false,             // first-run wizard (WiFi ✓ → MQTT → Heat pump)
  status: null,
  models: null,
  proto: "I",
  enabled: new Set(),        // value ids ticked in the heat-pump catalogue
  busy: false,
};

const TITLES = { settings: "Settings", wifi: "WiFi", mqtt: "MQTT broker", hp: "Heat pump", diag: "Diagnostics", firmware: "Firmware" };
const VIEW = { dashboard: "viewDash", wifi: "viewWifi", mqtt: "viewMqtt", hp: "viewHp", settings: "viewSettings", diag: "viewDiag", firmware: "viewFw" };

// ── Toasts ───────────────────────────────────────────────────────────────
let _tid = 0;
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = "toast" + (type === "ok" ? " ok" : type === "err" ? " err" : "");
  el.innerHTML = `<span class="disc">${type === "ok" ? "✓" : type === "err" ? "!" : "i"}</span><span></span>`;
  el.lastChild.textContent = msg;
  $("toasts").appendChild(el);
  const id = ++_tid; el.dataset.id = id;
  setTimeout(() => el.remove(), type === "err" ? 4200 : 2600);
}

// ── Navigation ───────────────────────────────────────────────────────────
function go(stage) {
  S.stage = stage;
  for (const [st, id] of Object.entries(VIEW)) $(id).classList.toggle("active", st === stage);
  renderHeader();
  window.scrollTo(0, 0);
  if (stage === "dashboard") { refreshStatus(); refreshValues(); }
  else if (stage === "wifi") loadScan($("wifiSsid"));
  else if (stage === "mqtt") fillMqtt();
  else if (stage === "hp") fillHp();
  else if (stage === "settings") fillSettings();
  else if (stage === "diag") loadDiag();
  else if (stage === "firmware") fillFirmware();
}
function goBack() { go(S.stage === "settings" ? "dashboard" : "settings"); }

function renderHeader() {
  const st = S.stage, wiz = S.wizard && (st === "mqtt" || st === "hp");
  $("hdrSetup").hidden = !wiz;
  $("hdrDash").hidden = st !== "dashboard";
  $("hdrBack").hidden = wiz || st === "dashboard";
  if (wiz) renderStepper();
  if (!wiz && st !== "dashboard") $("backTitle").textContent = TITLES[st] || "";
  // wizard-only chrome inside the MQTT / HP views
  $("wifiConfirm").hidden = !(S.wizard && st === "mqtt");
  $("mqSkipWrap").hidden = !(S.wizard && st === "mqtt");
  $("hpLiveNote").hidden = !(S.wizard && st === "hp");
  $("mqBtn").textContent = (S.wizard && st === "mqtt") ? "Save & continue" : "Save";
  $("hpBtn").textContent = (S.wizard && st === "hp") ? "Finish setup" : "Save changes";
}
function renderStepper() {
  const cur = S.stage; // mqtt = step 2, hp = step 3
  const defs = [
    { label: "WiFi", cls: "done", mark: "✓" },
    { label: "MQTT", cls: cur === "mqtt" ? "current" : "done", mark: cur === "mqtt" ? "2" : "✓" },
    { label: "Heat pump", cls: cur === "hp" ? "current" : "pending", mark: "3" },
  ];
  $("stepper").innerHTML = defs.map((d) =>
    `<div class="step ${d.cls}"><span class="step-mark">${d.mark}</span><span class="step-label">${d.label}</span></div>`).join("");
}

// ── Status (dashboard + shared) ──────────────────────────────────────────
async function refreshStatus() {
  let s;
  try { s = await j("/status"); } catch { markUnreachable(); return; }
  S.status = s;
  if (S.stage === "dashboard") renderDashboard();
}
function markUnreachable() {
  if (S.stage !== "dashboard") return;
  $("heroKicker").textContent = "No data";
  $("heroMode").textContent = "Unreachable";
  $("heroSub").textContent = "Can't reach the device — retrying…";
  $("heroDot").style.background = "var(--err)";
}

function renderDashboard() {
  const s = S.status || {}, hp = s.hp || {}, w = s.wifi || {}, m = s.mqtt || {};
  $("dashMeta").textContent = `${w.ip || location.hostname} · v${s.version || "?"}`;

  // hero: operation mode + fault state
  const mode = pickValue(/operation mode|^mode$/i);
  const fault = pickValue(/fault|error/i);
  const faulted = fault && !/^(none|no fault|ok|0|—|-)?$/i.test(String(fault).trim());
  if (!hp.connected) {
    heroSet("No data", "No data", "Waiting for the heat pump…", "var(--muted)");
  } else if (faulted) {
    heroSet("Fault · " + fault, mode || "Fault", "Unit reported " + fault + " — check the outdoor unit.", "var(--err)");
  } else {
    const lw = pickValue(/leaving water/i), oat = pickValue(/outdoor air|outdoor$/i);
    const sub = lw ? `Leaving water ${lw} °C${oat ? " · outdoor " + oat + " °C" : ""}`
                   : (hp.last_ok_s != null ? `Polled ${hp.last_ok_s}s ago` : "Running");
    heroSet("Operating", mode || "Online", sub, "var(--ok)");
  }

  // health strip
  const badges = [];
  const rssi = w.rssi;
  if (rssi != null) badges.push(["WiFi " + rssi + " dBm", rssi >= -70 ? "ok" : "warn"]);
  else if (w.ssid) badges.push(["WiFi " + w.ssid, "ok"]);
  else badges.push(["WiFi off", "warn"]);
  if (!m.configured) badges.push(["MQTT off", ""]);
  else if (m.connected) badges.push(["MQTT" + (m.tls ? " · TLS" : ""), "ok"]);
  else badges.push([m.error ? "MQTT " + m.error : "MQTT connecting", "warn"]);
  if (hp.crc_err) badges.push(["HP · CRC " + hp.crc_err, "warn"]);
  else if (hp.timeout_err) badges.push(["HP · timeout " + hp.timeout_err, "warn"]);
  else badges.push([hp.connected ? "HP linked" : "HP no data", hp.connected ? "ok" : "err"]);
  if (hp.last_ok_s != null) badges.push(["Polled " + hp.last_ok_s + "s ago", ""]);
  if (s.version) badges.push(["v" + s.version, ""]);
  $("health").innerHTML = badges.map(([t, tone]) => `<span class="badge ${tone}">${esc(t)}</span>`).join("");
}
function heroSet(kicker, mode, sub, dot) {
  $("heroKicker").textContent = kicker; $("heroMode").textContent = mode;
  $("heroSub").textContent = sub; $("heroDot").style.background = dot;
}
function pickValue(re) {
  const v = (S._values || []).find((x) => re.test(x.label || ""));
  return v ? (v.value == null ? null : String(v.value)) : null;
}

// ── Values (dashboard) ───────────────────────────────────────────────────
const GROUPS = [
  ["Operation", ["operation mode", "thermostat", "space heat", "domestic hot water", "fault", "defrost"]],
  ["Domestic hot water", ["tank", "dhw", "hot water"]],
  ["Water circuit", ["leaving water", "return water", "flow", "water pressure", "heating-flow", "heating flow", "target", "delta", "pump", "valve", "3-way"]],
  ["Refrigerant / outdoor", ["outdoor", "heat-exchanger", "heat exchanger", "high pressure", "low pressure", "refrigerant", "compressor", "fan"]],
  ["Electrical", ["current", "ct l", "inv ", "backup-heater", "backup heater", "stage", "capacity"]],
  ["Device", ["wi-fi", "wifi", "mqtt", "hp link", "link", "poll", "uptime", "firmware", "rssi"]],
];
function groupOf(v) {
  if (v.group) return v.group;
  const l = (v.label || "").toLowerCase();
  for (const [name, keys] of GROUPS) if (keys.some((k) => l.includes(k))) return name;
  return "Other values";
}
async function refreshValues() {
  let r;
  try { r = await j("/values"); } catch { return; }
  const vals = r.values || r || [];
  S._values = vals;
  if (S.stage === "dashboard") { renderDashboard(); renderValueGroups(vals); }
}
function renderValueGroups(vals) {
  const box = $("valueGroups");
  if (!vals.length) { box.innerHTML = `<div class="card" style="margin-top:12px"><span class="empty">Waiting for the first poll…</span></div>`; return; }
  const order = [...GROUPS.map((g) => g[0]), "Other values"];
  const buckets = new Map();
  for (const v of vals) { const g = groupOf(v); (buckets.get(g) || buckets.set(g, []).get(g)).push(v); }
  const grouped = buckets.size > 1;
  let html = "";
  const emit = (name, rows) => {
    html += `<div class="vgroup"><div class="card">` +
      (grouped ? `<div class="section-label">${esc(name)}</div>` : ``) +
      rows.map((v) => {
        const val = v.value == null ? "—" : esc(v.value);
        const cls = v.state || v.class || "";
        return `<div class="vrow"><span class="vrow-label">${esc(v.label)}</span>` +
          `<span class="vrow-val ${cls}">${val}${v.unit ? `<span class="vrow-unit">${esc(v.unit)}</span>` : ""}</span></div>`;
      }).join("") + `</div></div>`;
  };
  if (grouped) {
    const done = new Set();
    for (const name of order) if (buckets.has(name)) { emit(name, buckets.get(name)); done.add(name); }
    for (const [name, rows] of buckets) if (!done.has(name)) emit(name, rows); // firmware-supplied custom groups
  } else emit("Values", vals);
  box.innerHTML = html;
}

// ── WiFi (scan + provision) ──────────────────────────────────────────────
async function loadScan(sel) {
  sel.innerHTML = `<option value="">Scanning…</option>`;
  try {
    const r = await j("/scan");
    const nets = (r.networks || r || []).slice().sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
    sel.innerHTML = nets.length
      ? nets.map((n) => `<option value="${esc(n.ssid)}">${esc(n.ssid)} · ${n.rssi} dBm</option>`).join("")
      : `<option value="">No networks found</option>`;
    const cur = S.status?.wifi?.ssid;
    if (cur) sel.value = cur;
  } catch { sel.innerHTML = `<option value="">Scan failed — reload</option>`; }
}

// ── MQTT ─────────────────────────────────────────────────────────────────
function fillMqtt() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {};
  $("wcSsid").textContent = w.ssid || "—";
  $("wcIp").textContent = w.ip || "—";
  $("wcSignal").innerHTML = w.rssi != null ? signalBars(w.rssi) : "—";
  $("mqBroker").value = m.broker || "";
}
const validMqtt = (h) => !h.trim() || /^[\w.\-]+:\d{2,5}$/.test(h.trim());
function signalBars(rssi) {
  const lit = rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
  const tone = rssi >= -70 ? "var(--ok)" : "var(--warn)";
  let bars = ""; for (let i = 1; i <= 4; i++) bars += `<i class="${i <= lit ? "on" : ""}"></i>`;
  return `<span class="signal lit" style="color:${tone}">${bars}</span> <span class="num" style="color:${tone};font-weight:600">${rssi} dBm</span>`;
}

// ── Heat pump (models catalog) ───────────────────────────────────────────
async function loadModels() {
  try { S.models = await j("/models"); } catch { return; }
}
function fillHp() {
  const M = S.models;
  if (!M) { $("valMenu").innerHTML = `<span class="empty">Models unavailable.</span>`; return; }
  fillSelect($("selIndoor"), M.indoor); fillSelect($("selOutdoor"), M.outdoor); fillSelect($("selTank"), M.tank);
  for (const el of [$("selIndoor"), $("selOutdoor"), $("selTank")]) el.onchange = onModelChange;
  $("pinHint").textContent = M.pin_hint || "";
  const hp = S.status?.hp || {}, p = S.status?.profile || {};
  if (hp.rx != null) $("inRx").value = hp.rx;
  if (hp.tx != null) $("inTx").value = hp.tx;
  if (hp.poll_s != null) $("inPoll").value = hp.poll_s;
  S.proto = hp.proto || "I"; syncProto();
  if (p.lang) $("selLang").value = p.lang;
  onModelChange();
}
function fillSelect(sel, items) {
  sel.innerHTML = (items || []).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join("");
}
function resolveProfile() {
  // Each model is one profile, chosen via the heat-pump-model (outdoor) dropdown; the composite
  // (indoor|outdoor|tank) key is tried first for the split-model case, then the model alone.
  const M = S.models; if (!M) return "generic";
  const pm = M.profile_map || {};
  const key = [$("selIndoor").value, $("selOutdoor").value, $("selTank").value].join("|");
  return pm[key] || pm[$("selOutdoor").value] || M.default_profile || "generic";
}
function onModelChange() {
  const M = S.models; if (!M) return;
  const prof = resolveProfile();
  $("profileId").textContent = prof;
  const values = (M.values && M.values[prof]) || M.default_values || [];
  S.enabled = new Set(values.filter((v) => v.on).map((v) => v.id));
  renderCatalogue(values);
}
function renderCatalogue(values) {
  const box = $("valMenu");
  if (!values.length) { box.innerHTML = `<span class="empty">No value list for this profile.</span>`; updateValCount(); return; }
  const grouped = values.some((v) => v.group);
  let html = "";
  const item = (v) => `<label class="cat-item"><input type="checkbox" value="${esc(v.id)}" ${S.enabled.has(v.id) ? "checked" : ""}>` +
    `<span class="lbl">${esc(v.label)}</span><span class="unit">${esc(v.unit || "")}</span></label>`;
  if (grouped) {
    const seen = [];
    for (const v of values) if (!seen.includes(v.group)) seen.push(v.group);
    for (const g of seen) {
      html += `<div class="cat-group"><div class="cat-group-name">${esc(g)}</div>` +
        values.filter((v) => v.group === g).map(item).join("") + `</div>`;
    }
  } else html = values.map(item).join("");
  box.innerHTML = html;
  box.querySelectorAll("input[type=checkbox]").forEach((c) =>
    c.addEventListener("change", () => { c.checked ? S.enabled.add(c.value) : S.enabled.delete(c.value); updateValCount(); }));
  updateValCount();
}
function updateValCount() {
  const n = $("valMenu").querySelectorAll("input:checked").length;
  $("valCount").textContent = n ? `Values · ${n} enabled` : "Values";
}
function syncProto() {
  $("protoSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.proto === S.proto));
}

// ── Settings menu ────────────────────────────────────────────────────────
function fillSettings() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, p = S.status?.profile || {}, s = S.status || {};
  const item = (label, sub, go2) =>
    `<button class="menu-item" data-go="${go2}"><span class="mtext"><span class="mlabel">${esc(label)}</span>` +
    `<span class="msub">${esc(sub)}</span></span>` +
    `<svg class="chev" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>`;
  $("menuSetup").innerHTML =
    item("WiFi", (w.ssid || "not set") + (w.ip ? " · " + w.ip : ""), "wifi") +
    item("MQTT", m.configured ? (m.broker || "configured") + (m.tls ? " · TLS" : "") : "off", "mqtt") +
    item("Heat pump", (p.id || "not set") + (p.lang ? " · " + p.lang : ""), "hp");
  $("menuSystem").innerHTML =
    item("Diagnostics", "Live device log", "diag") +
    item("Firmware", "v" + (s.version || "?") + " · check for updates", "firmware");
  document.querySelectorAll("#menuSetup .menu-item, #menuSystem .menu-item")
    .forEach((b) => b.onclick = () => go(b.dataset.go));
  $("settingsVer").textContent = "Daikin Altherma · v" + (s.version || "?");
}

// ── Diagnostics ──────────────────────────────────────────────────────────
async function loadDiag() {
  const verbose = $("diagVerbose").checked;
  try {
    const r = await fetch("/diag?verbose=" + (verbose ? "1" : "0"));
    $("diagLog").textContent = (await r.text()) || "Log empty.";
  } catch { $("diagLog").textContent = "Failed to load log."; }
}

// ── Firmware / OTA ───────────────────────────────────────────────────────
function fillFirmware() {
  const s = S.status || {}, hp = s.hp || {};
  $("fwVer").textContent = "v" + (s.version || "?");
  $("fwChip").textContent = s.platform || "?";
  $("fwLink").textContent = hp.connected ? "Connected" : "No data";
  $("fwResult").hidden = true;
}
async function checkUpdate() {
  const btn = $("fwCheck"); btn.disabled = true; btn.textContent = "Checking…";
  try {
    await fetch("/ota/check?ms=" + Date.now());
    const poll = setInterval(async () => {
      let st; try { st = await j("/ota/status"); } catch { return; }
      if (st.state === "idle" || st.state === "done" || st.state === "error") {
        clearInterval(poll); btn.disabled = false; btn.textContent = "Check for update";
        const res = $("fwResult"); res.hidden = false;
        if (st.update_available) {
          res.textContent = `Update available: ${st.current} → ${st.available}`;
          if (confirm(`Update ${st.current} → ${st.available}?`)) { await post("/ota/update", {}); toast("Updating — device will reboot…", "info"); }
        } else if (st.state === "error") { res.textContent = "Update check failed: " + (st.message || "error"); }
        else { res.textContent = "✓ Up to date · checked just now"; res.style.color = "var(--ok)"; }
      }
    }, 1500);
  } catch { btn.disabled = false; btn.textContent = "Check for update"; toast("Update check failed", "err"); }
}

// ── Reboot-and-reconnect writes (WiFi / MQTT) ────────────────────────────
async function saveReboot(url, body, then) {
  if (S.busy) return; S.busy = true;
  toast("Rebooting — reconnecting…", "info");
  try { await post(url, body); } catch { /* device may drop the socket as it reboots */ }
  let tries = 0;
  const poll = setInterval(async () => {
    tries++;
    try { S.status = await j("/status"); clearInterval(poll); S.busy = false; toast("Saved", "ok"); then(); }
    catch { if (tries > 14) { clearInterval(poll); S.busy = false; toast("Rebooted — reconnect to the device", "info"); } }
  }, 1500);
}

// ── Boot ─────────────────────────────────────────────────────────────────
function wire() {
  $("btnSettings").onclick = () => go("settings");
  $("btnBack").onclick = goBack;

  $("wifiForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const ssid = $("wifiSsid").value;
    if (!ssid) { toast("Choose a network first", "err"); return; }
    saveReboot("/set_wifi", { ssid, pass: $("wifiForm").pass.value }, () => go("dashboard"));
  });

  $("mqttForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const broker = $("mqBroker").value;
    if (!validMqtt(broker)) { $("mqBroker").classList.add("invalid"); $("mqError").hidden = false; toast("Check the broker address", "err"); return; }
    $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
    const next = () => (S.wizard ? go("hp") : go("settings"));
    saveReboot("/set_mqtt", { broker, user: $("mqUser").value, pass: $("mqPass").value }, next);
  });
  $("mqBroker").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; });
  $("mqSkip").onclick = () => { toast("MQTT skipped", "info"); go("hp"); };
  $("wcChange").onclick = (e) => { e.preventDefault(); go("wifi"); };

  $("protoSeg").querySelectorAll("button").forEach((b) => b.onclick = () => { S.proto = b.dataset.proto; syncProto(); });
  $("selAll").onclick = (e) => { e.preventDefault(); $("valMenu").querySelectorAll("input").forEach((c) => { c.checked = true; S.enabled.add(c.value); }); updateValCount(); };
  $("selNone").onclick = (e) => { e.preventDefault(); $("valMenu").querySelectorAll("input").forEach((c) => { c.checked = false; }); S.enabled.clear(); updateValCount(); };

  $("hpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      profile: resolveProfile(), lang: $("selLang").value, proto: S.proto,
      rx: +$("inRx").value, tx: +$("inTx").value, poll_s: +$("inPoll").value,
      values: [...$("valMenu").querySelectorAll("input:checked")].map((c) => c.value),
    };
    try {
      const r = await post("/set_hp", body);
      if (!r.ok) { const err = await r.json().catch(() => ({})); toast(err.error || "Rejected", "err"); return; }
      if (S.wizard) { S.wizard = false; toast("Setup complete", "ok"); go("dashboard"); }
      else { toast("Applied", "ok"); go("settings"); }
    } catch { toast("Failed", "err"); }
  });

  $("diagVerbose").onchange = loadDiag;
  $("diagClear").onclick = async () => { try { await fetch("/diag?clear=1"); } catch {} loadDiag(); toast("Log cleared", "info"); };
  $("fwCheck").onclick = checkUpdate;
}

async function boot() {
  wire();
  await Promise.all([refreshStatus(), loadModels()]);
  // First-run wizard only when the firmware explicitly reports it (setup_complete === false).
  S.wizard = S.status?.setup_complete === false;
  go(S.wizard ? "mqtt" : "dashboard");
  setInterval(() => { if (S.stage === "dashboard") refreshStatus(); }, 4000);
  setInterval(() => { if (S.stage === "dashboard") refreshValues(); }, 8000);
}
boot();
