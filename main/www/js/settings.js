
// ── WiFi (edit modal) ──────────────────────────────────────────────────────
function fillWifi() {
  const w = S.status?.wifi || {};
  $("wfSSID").value = w.ssid || "";
  $("wfPass").value = "";
}
function openWifi() {
  fillWifi();
  $("wfSSID").classList.remove("invalid");
  $("wfPass").classList.remove("invalid");
  $("wfSSIDError").hidden = true;
  $("wfPassError").hidden = true;
  $("wifiModal").hidden = false;
  $("wfSSID").focus();
}
function closeWifi() { $("wifiModal").hidden = true; }
// Route a /set_wifi rejection to the field it names — wifi_credentials_valid answers "invalid ssid" /
// "invalid password", and the modal's two hints already state exactly those rules, so mark the field
// and unhide its own hint rather than overwriting it with the terser server wording (the toast carries
// that verbatim anyway). A message naming neither field (a malformed body) stays toast-only rather
// than blaming an arbitrary field.
function wifiFieldError(msg) {
  if (/ssid/i.test(msg)) { $("wfSSID").classList.add("invalid"); $("wfSSIDError").hidden = false; }
  else if (/pass/i.test(msg)) { $("wfPass").classList.add("invalid"); $("wfPassError").hidden = false; }
}

// ── MQTT (edit modal) ─────────────────────────────────────────────────────
// The MQTT broker is edited in a modal opened from the Connections tile's MQTT row pencil. Only
// the broker prefills (user/pass aren't exposed by /status); a Save reboots to apply (saveReboot),
// Cancel/backdrop/Esc dismiss without a write.
function fillMqtt() {
  const m = S.status?.mqtt || {};
  $("mqBroker").value = m.broker || "";
  // The credential fields start empty every time (/status never exposes them), which the firmware
  // reads as "keep the stored ones". So empty can't also mean "clear" — the checkbox is the explicit
  // signal, and it only has anything to do when credentials are actually stored (mqtt.has_creds).
  $("mqUser").value = "";
  $("mqPass").value = "";
  setMqttClear(false);
  $("mqClearRow").hidden = !m.has_creds;
}
// Checking "remove stored credentials" means the save must carry NO credentials — the firmware treats
// a non-empty user/pass as an explicit set that overrides the flag, so an editable field here would
// let the user build a request that contradicts itself. Empty + disable them while it's checked.
function setMqttClear(on) {
  $("mqClearCreds").checked = on;
  if (on) { $("mqUser").value = ""; $("mqPass").value = ""; }
  $("mqUser").disabled = on;
  $("mqPass").disabled = on;
}
function openMqtt() {
  fillMqtt();
  $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
  $("mqttModal").hidden = false;
  $("mqBroker").focus();
}
function closeMqtt() { $("mqttModal").hidden = true; }
// Accept a bare host:port (defaults to plaintext mqtt://) OR an explicit scheme. Credentials require
// mqtts:// (the bridge refuses plaintext + creds), so the field MUST allow a scheme — otherwise the
// only secure path is un-enterable. mqtt(s)://host[:port] and ws(s):// forms pass; empty disables.
// A URL path is allowed because a WebSocket broker normally has one (`wss://host:8084/mqtt`) — the
// device takes only host+port for its pre-flight probe and hands esp-mqtt the whole URI. A bare
// host:port is raw TCP, where a path would be meaningless, so it stays path-less.
const validMqtt = (h) => {
  h = h.trim();
  return !h || /^[\w.\-]+:\d{2,5}$/.test(h) || /^(mqtts?|wss?):\/\/[\w.\-]+(:\d{2,5})?(\/\S*)?$/.test(h);
};

// ── Dynamic LWT · first room-temperature source ─────────────────────────
// One observation profile for now: friendly name, exact topic, numeric value path, optional source
// timestamp path and a freshness limit. Calibration/roles/control remain later Dyn-Control fields.
// It is presented as an Observe-mode input under the permanent dynamic-control Settings card. The
// Shelly mapping is a first-open TEST preset, never a firmware-wide default subscription.
const REF_TEMP_TEST_TOPIC = "shelly1pmminig4-fixture00003/status/switch:0";
function fillRefTemp() {
  const r = S.status?.reference_temperature || {};
  const configured = !!r.configured;
  // Keep an explicitly disabled profile empty when it is reopened. A stored name is the marker;
  // only a genuinely untouched mapping gets the Shelly transport-test preset.
  const saved = configured || !!r.name || !!r.temperature_path || !!r.timestamp_path;
  $("rtName").value = saved ? (r.name || "") : "Shelly 1PM Mini G4 · Test";
  $("rtTopic").value = saved ? (r.topic || "") : REF_TEMP_TEST_TOPIC;
  $("rtPath").value = saved ? (r.temperature_path || "") : "temperature.tC";
  $("rtTimePath").value = saved ? (r.timestamp_path || "") : "";
  $("rtMaxAge").value = Number.isInteger(r.max_age_s) ? r.max_age_s : 600;
}
function openRefTemp() {
  fillRefTemp();
  for (const id of ["rtName", "rtTopic", "rtPath", "rtTimePath", "rtMaxAge"])
    $(id).classList.remove("invalid");
  $("rtError").hidden = true;
  $("refTempModal").hidden = false;
  const topic = $("rtTopic");
  topic.focus();
  topic.setSelectionRange(0, 0);
  topic.scrollLeft = 0;
}
function closeRefTemp() { $("refTempModal").hidden = true; }
const validRefTopic = (v) => !v || (v.length <= 192 && v[0] !== "/" && !v.endsWith("/") &&
                                      !/[+#\x00-\x1f\x7f]/.test(v));
const validRefPath = (v) => v.length <= 128 && v.split(".").every((key) =>
  key.length > 0 && key.length <= 64 && !/[\s\x00-\x1f\x7f]/.test(key));

// ── Syslog (edit modal) ────────────────────────────────────────────────────
function fillSyslog() {
  const sy = S.status?.syslog || {};
  $("slHost").value = sy.host ? `${sy.host}:${sy.port || 514}` : "";
}
function openSyslog() {
  fillSyslog();
  $("slHost").classList.remove("invalid");
  $("slError").hidden = true;
  $("syslogModal").hidden = false;
  $("slHost").focus();
}
function closeSyslog() { $("syslogModal").hidden = true; }

// ── NTP (edit modal) ───────────────────────────────────────────────────────
function fillNtp() {
  $("ntpServer").value = S.status?.ntp?.server || "";
}
function openNtp() {
  fillNtp();
  $("ntpServer").classList.remove("invalid");
  $("ntpError").hidden = true;
  $("ntpModal").hidden = false;
  $("ntpServer").focus();
}
function closeNtp() { $("ntpModal").hidden = true; }

// ── HomeHub / Modbus TCP (edit modal) ──────────────────────────────────────
// Auto / Manual / Off is user intent, distinct from whether this boot's bounded search succeeded.
// The host field still shows the endpoint actually in use; in Auto that makes the discovered IPv4
// visible and a switch to Manual can retain it, but only Manual makes the field editable.
function fillHomehub() {
  const mb = S.status?.modbus || {};
  $("hhMode").value = mb.mode || (mb.host ? "manual" : "auto");
  $("hhHost").value = mb.host || "";
  $("hhPort").value = mb.port || 502;
  $("hhUnit").value = mb.unit_id || 1;
  syncHomehubMode();
}
function syncHomehubMode() {
  const manual = $("hhMode").value === "manual";
  $("hhHost").disabled = !manual;
  $("hhHostField").classList.toggle("field-disabled", !manual);
}
function openHomehub() {
  fillHomehub();
  for (const id of ["hhHost", "hhPort", "hhUnit"]) $(id).classList.remove("invalid");
  $("hhError").hidden = true;
  $("homehubModal").hidden = false;
  ($("hhMode").value === "manual" ? $("hhHost") : $("hhMode")).focus();
}
function closeHomehub() { $("homehubModal").hidden = true; }

// ── Board hardware (dashboard edit modal) ───────────────────────────────────
// Fills the two pin dropdowns from /status.board.pins_local — a WIDER list than the RX/TX picker's
// pins_avail, because an onboard LED or button legitimately sits on a dedicated-JTAG pad that the
// X10A picker withholds (logic/board_pins.hpp). The pin currently in use is always offered even if
// it has dropped off the list (e.g. a build that switched to Octal flash), so the modal can always
// show what the device is actually doing.
function boardPinOptions(sel, cur, withNone) {
  const pins = Array.isArray(S.status?.board?.pins_local) ? S.status.board.pins_local : [];
  const list = (cur != null && cur >= 0 && !pins.includes(cur)) ? [cur, ...pins].sort((a, b) => a - b) : pins;
  sel.innerHTML = (withNone ? `<option value="-1">${esc(t("board.none"))}</option>` : "") +
    list.map((p) => `<option value="${p}">${p}</option>`).join("");
  // Without a "None" option there is no element with value "-1", so assigning it leaves the select
  // with selectedIndex -1 and value "" — and the submit handler's `+value` turns "" into 0, posting
  // led_gpio: 0. GPIO0 is a strapping pin, so the device answers "led_gpio is a reserved GPIO":
  // an error naming a pin the user never picked. Reachable by saving the indicator as "None" and
  // then switching the type back to LED. Fall back to the first offered pin instead, which is a
  // real, valid pick the user can see and change.
  const want = cur != null && cur >= 0 ? cur : withNone ? -1 : (list.length ? list[0] : -1);
  sel.value = String(want);
}
// "None" for the LED is expressed as led_gpio = -1, but the TYPE select is what the user picks from
// (None / plain / WS2812) — the pin row and the polarity checkbox only make sense once a type is
// chosen, and "active low" is meaningless for a WS2812 (it encodes "off" as the zero colour, so
// there is no drive level to invert).
function syncBoardFields() {
  const type = +$("bdLedType").value;
  $("bdLedPinRow").hidden = type < 0;
  $("bdLedInvRow").hidden = type !== 0;
  $("bdBtnInvRow").hidden = +$("bdBtnPin").value < 0;
}
// ── Board presets ───────────────────────────────────────────────────────────
// The ready-made per-board settings the device serves in /status.board.presets (logic/
// board_presets.hpp — one table, host-tested against the same validator POST /set_board applies, so
// the browser never carries a second copy of the board facts that could drift from it).
//
// A pick only FILLS the five fields; nothing is written until Save. The stored values do not carry
// a board identity: in particular, the first-boot build defaults happen to equal the XIAO preset,
// but that does not prove the board is a XIAO. Therefore each newly opened modal starts at "Custom".
// While it stays open, editing the five fields still updates the selection so it never claims a
// board the fields below no longer describe.
function boardPresets() {
  return Array.isArray(S.status?.board?.presets) ? S.status.board.presets : [];
}
// Compare only the fields that are actually in play: polarity is meaningless for a WS2812 (it
// encodes "off" as the zero colour) and for an absent LED/button, so a difference there must not
// downgrade an otherwise-exact match to "Custom".
function boardFieldsMatch(p) {
  const type = +$("bdLedType").value;
  const led = type < 0 ? -1 : +$("bdLedPin").value;
  if (p.led_gpio !== led) return false;
  if (led >= 0) {
    if (p.led_type !== type) return false;
    if (type === 0 && !!p.led_inverted !== $("bdLedInv").checked) return false;
  }
  const btn = +$("bdBtnPin").value;
  if (p.btn_gpio !== btn) return false;
  if (btn >= 0 && p.btn_active_low !== $("bdBtnInv").checked) return false;
  return true;
}
// findIndex returns -1 when nothing matches, which is exactly the "Custom" option's value.
function syncPresetSelection() {
  if (boardPresets().length) $("bdPreset").value = String(boardPresets().findIndex(boardFieldsMatch));
}
function applyPreset() {
  const p = boardPresets()[+$("bdPreset").value];
  if (!p) return;                       // "Custom" — leave the fields exactly as the user has them
  $("bdLedType").value = String(p.led_gpio < 0 ? -1 : p.led_type);
  if (p.led_gpio >= 0) boardPinOptions($("bdLedPin"), p.led_gpio, false);
  $("bdLedInv").checked = !!p.led_inverted;
  boardPinOptions($("bdBtnPin"), p.btn_gpio, true);
  $("bdBtnInv").checked = p.btn_active_low !== false;
  syncBoardFields();
}
function fillBoard() {
  const b = S.status?.board || {};
  const presets = boardPresets();
  // Hidden when the device sent none — an older firmware, or a build whose reserved pins withhold
  // every preset (board_presets_offerable). The manual fields still do the whole job.
  $("bdPresetRow").hidden = presets.length === 0;
  $("bdPreset").innerHTML = `<option value="-1">${esc(t("board.preset_custom"))}</option>` +
    presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("");
  const hasLed = b.led_gpio != null && b.led_gpio >= 0;
  $("bdLedType").value = hasLed ? String(b.led_type ?? 0) : "-1";
  boardPinOptions($("bdLedPin"), hasLed ? b.led_gpio : -1, false);
  $("bdLedInv").checked = !!b.led_inverted;
  boardPinOptions($("bdBtnPin"), b.btn_gpio, true);
  $("bdBtnInv").checked = b.btn_active_low !== false;
  syncBoardFields();
  // Name the board only once the USER has stated it (/status.board.user_set). The values alone
  // cannot decide: a device that never saved hardware carries the build's defaults, which happen to
  // EQUAL the XIAO preset, so naming it would label every freshly flashed board a XIAO — including
  // an AtomS3 Lite, where that is an actively wrong claim (#256). Once the user HAS saved, the
  // opposite failure applies and it is the one that got reported: the modal opened on "Custom"
  // although the fields are exactly the AtomS3 preset just saved, so re-picking your own board
  // submitted an unchanged form — no reboot, one grey "no changes" toast, and it reads as a save
  // that did nothing (#257).
  //
  // The selection is DERIVED from the fields either way — syncPresetSelection is the single rule,
  // the same one every field's change handler runs — so user_set decides only WHETHER a name is
  // shown, never WHICH. That is also why forcing "Custom" here was not merely cautious but
  // inconsistent: the same five values read "Custom" until you touched anything and "M5Stack AtomS3
  // Lite" immediately after, one dataset described two ways.
  if (b.user_set) syncPresetSelection(); else $("bdPreset").value = "-1";
}
function openBoard() {
  fillBoard();
  $("bdError").hidden = true;
  $("boardModal").hidden = false;
}
function closeBoard() { $("boardModal").hidden = true; }
function signalBars(rssi) {
  const lit = rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
  const tone = rssi >= -70 ? "var(--ok)" : "var(--warn)";
  let bars = ""; for (let i = 1; i <= 4; i++) bars += `<i class="${i <= lit ? "on" : ""}"></i>`;
  return `<span class="signal lit" style="color:${tone}">${bars}</span>`;
}

// ── Heat pump (model identity + wiring) ──────────────────────────────────

// Dashboard header / Model-card name: the auto-detected model, asserted ONLY when detection is
// unambiguous. Several register-identical families (ambiguous) or a generic fallback read as the
// brand — matching the honest Model card, never claiming e.g. an EBLA monobloc for a register-
// identical ERGA split. Driven purely by /status.detect; there is no manual selection.
function hpModelName() {
  // Assert a concrete model ONLY while the bus is live AND detection is unambiguous — never name a
  // specific unit from a cached fingerprint while the link is silent (offline → the brand only).
  const s = S.status || {}, hp = s.hp || {}, d = s.detect, m = d?.model;
  if (hp.connected && d?.valid && (d.families || []).length === 1 && m && (m.marketing || m.name)) return m.marketing || m.name;
  return "Daikin Altherma";
}

// Partial live write to /set_hp. Omitted keys keep their stored value; a rejection/error surfaces.
async function applyLive(patch, okMsg) {
  try {
    const r = await post("/set_hp", patch);
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || t("toast.rejected"), "err"); return false; }
    if (okMsg) toast(okMsg, "ok");
    return true;
  } catch { toast(t("toast.unreachable"), "err"); return false; }
}

// Picking RX/TX from the dropdown points auto-detection at those pins: reset to "auto" so the next
// poll cycle re-sweeps the chosen pair (+ its swap), then refresh a few times to catch the connect —
// on success the card flips the pins to read-only.
async function onPinPick() {
  const rx = +$("e32Rx").value, tx = +$("e32Tx").value;
  $("e32Rx").blur(); $("e32Tx").blur();
  if (!(await applyLive({ profile: "auto", rx, tx }, t("toast.trying_pins")))) return;
  let n = 0;
  const iv = setInterval(async () => { await refreshStatus(); if (++n >= 5 || S.status?.hp?.connected) clearInterval(iv); }, 1500);
}

// Picking an update channel saves it (POST /set_ota — live, no reboot) and then immediately runs
// the normal OTA flow against the newly-selected feed. Doing the check straight away is the point
// of the pick: nobody switches channel for the setting itself, they switch to get that channel's
// build, and leaving them to find the version afterwards would make a two-step job out of one.
// It stays on this screen. It used to go("dashboard") first, because the readout lived only in that
// header — a real constraint, but the fix for it was to move the user, and being moved off the card
// you are configuring is worse than the problem. The Firmware row directly above carries the
// readout now, so the check reports next to the very version the channel decides.
async function onChannelPick() {
  const sel = $("e32Chan");
  const channel = sel.value;
  sel.blur();
  try {
    const r = await post("/set_ota", { channel });
    if (!r.ok) { toast(await errorOf(r, t("toast.rejected")), "err"); await refreshStatus(); return; }
  } catch { toast(t("toast.unreachable"), "err"); return; }
  toast(t("chan.saved", t(channel === "dev" ? "chan.dev" : "chan.release")), "ok");
  await refreshStatus();
  checkFirmwareUpdate();
}

// The UI language picker (Firmware card). Persisted on the device (POST /set_lang) so the choice
// holds across reboots and every client; applied LIVE here — refreshStatus re-reads /status.ui.lang
// and setLangFromStatus swaps the language and re-localises — rather than reloading the page. "auto"
// hands the choice back to the browser. The success toast comes AFTER the swap so it already reads in
// the newly chosen language.
async function onLangPick() {
  const sel = $("e32Lang");
  const lang = sel.value;
  sel.blur();
  try {
    const r = await post("/set_lang", { lang });
    if (!r.ok) { toast(await errorOf(r, t("toast.rejected")), "err"); await refreshStatus(); return; }
  } catch { toast(t("toast.unreachable"), "err"); return; }
  await refreshStatus();
  toast(t("lang.saved"), "ok");
}

// ── Firmware / OTA ───────────────────────────────────────────────────────
// Tapping the version in the header meta line checks for an OTA update, and offers to install one:
// the full /ota/check -> /ota/status -> /ota/update flow is wired below against the device-side
// implementation in ota_update.cpp (manifest check, two-point downgrade gate, signed install, health
// gate). What the device can actually FIND depends on a served manifest.json — CI stages one and
// publishes it to GitHub Pages, gated on the repo being public (docs/FEATURES.md §2); against no feed
// the check honestly reports "up to date" rather than failing.
//
// The whole flow reports INLINE next to that version (#otaStat) rather than through toasts. A
// download takes tens of seconds and ticks a percentage the entire time, which as toasts meant a
// growing stack of near-identical "Downloading… 78%" cards covering the dashboard, each outliving
// the number it carried. Inline, the progress replaces itself in place, next to the version it is
// about, and the page stays readable underneath.

// A ring sized for the 12.5px meta line: 13px, 2px stroke. `indet` (no percentage yet) draws a
// spinning quarter-arc, otherwise the arc is the download's progress. Colour is inherited
// (currentColor), so the .err class recolours the ring and the text together.
function otaRing(pct, indet) {
  const sz = 13, r = 5.2, c = 2 * Math.PI * r, cx = sz / 2;
  const circle = (cls, extra) =>
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="currentColor" stroke-width="2" ${extra}/>`;
  if (indet) {
    return `<svg class="otaspin" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">` +
      circle("", `opacity=".25"`) +
      circle("", `stroke-linecap="round" stroke-dasharray="${(c * 0.25).toFixed(2)} ${c.toFixed(2)}"`) +
      `</svg>`;
  }
  const p = Math.max(0, Math.min(100, +pct || 0));
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}" style="transform:rotate(-90deg)">` +
    circle("", `opacity=".25"`) +
    circle("", `stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(2)} ${c.toFixed(2)}"`) +
    `</svg>`;
}

// Write the inline readout. `text` is always plain text set via textContent — the only innerHTML is
// our own ring markup, so a device-supplied /ota/status.message can never reach the DOM as markup.
// Every write bumps otaSeq, which is what makes the delayed clear below safe.
//
// There are TWO slots and both get the same content: the dashboard header's (#otaStat) and the one
// in the Settings Firmware card's Version row (#otaStatSet). Either screen can start the flow, so
// either screen has to be able to report it — and painting both unconditionally means a user who
// switches screens mid-download finds the progress already there rather than gone. Only one is on
// screen at a time (the other screen's DOM is hidden), so this is not two readouts competing; it is
// one readout, present wherever the version it belongs to is. A missing slot is skipped, not an
// error: the Settings one exists only while that card is rendered.
let otaSeq = 0;
const OTA_SLOTS = ["otaStat", "otaStatSet"];
function otaInline(text, { ring = false, pct = null, cls = "" } = {}) {
  otaSeq++;
  S.otaShown = !!(text || ring);          // freezes the Settings rebuild — see renderSettings
  for (const id of OTA_SLOTS) {
    const el = $(id);
    if (!el) continue;
    el.className = "otastat" + (cls ? " " + cls : "");
    el.innerHTML = ring ? otaRing(pct, pct == null) : "";
    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      el.appendChild(span);
    }
  }
}
// Clear the readout after a terminal message has had time to be read — but ONLY if nothing has been
// written since. Tapping the version twice inside the linger window (up to date → tap again) would
// otherwise let the FIRST run's pending timer wipe the second run's message a fraction of a second
// after it appeared: a check that looks like it silently did nothing. Sequence-guarded rather than
// otaBusy-guarded, because a terminal message is by definition written after the flow released.
function otaInlineClear(delay = 3500) {
  const mine = otaSeq;
  setTimeout(() => { if (otaSeq === mine) otaInline(""); }, delay);
}

// Poll /ota/status until `state` leaves the set we're waiting on, or we run out of patience.
// Every OTA phase is asynchronous on the device (the download runs on its own task so the single
// httpd worker stays free), so the UI's whole job here is to watch a state machine it does not drive.
async function otaPoll(waitStates, tries, onTick) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let s;
    try { s = await j("/ota/status"); } catch { continue; }   // a dropped poll is not a failure
    if (onTick) onTick(s);
    if (!waitStates.includes(s.state)) return s;
  }
  return null;
}

// Terminal inline failure: show it, let it linger a beat longer than a success, and release the flow.
function otaFail(text) {
  S.otaBusy = false;
  otaInline(text, { cls: "err" });
  otaInlineClear(6000);
}

async function checkFirmwareUpdate() {
  if (S.otaBusy) return;                                       // a check/download is already running
  if (S.busy) { otaInline(t("ota.busy")); otaInlineClear(); return; }
  S.busy = true; S.otaBusy = true;
  // rebootPoll() clears S.busy itself, asynchronously, once the device answers again — so the exit
  // path must hand ownership over rather than clear the flag on the way out. Clearing it here after
  // starting the poll would re-enable the UI while the device is still rebooting.
  let handedOff = false;
  try {
    otaInline("", { ring: true });                             // checking: spinner only, no label
    try { await j("/ota/check?ms=" + Date.now()); }
    catch { otaFail(t("ota.unreachable")); return; }

    const s = await otaPoll(["checking"], 30);
    if (!s)                  { otaFail(t("ota.timeout")); return; }
    if (s.state === "error") { otaFail(s.message || t("ota.check_failed")); return; }
    // `downgrade` is the selected channel offering an OLDER build than the one running — the
    // dev → release direction. Without honouring it here, picking "Release" on a board that has
    // been following dev would report "up to date" forever and the channel would be a one-way door.
    if (!s.update_available && !s.downgrade) {
      S.otaAvail = null; renderHeaderMeta();
      S.otaBusy = false;
      otaInline(t("ota.uptodate")); otaInlineClear();
      return;
    }
    const back = !s.update_available && s.downgrade;

    // A version is on offer: record it so the version's tooltip says so, and clear the readout while
    // the modal dialog is up (confirm() blocks, and a stale spinner behind it explains nothing).
    S.otaAvail = s.available || null; renderHeaderMeta();
    otaInline("");
    // The device re-fetches the manifest and re-runs the gate before downloading, so this prompt is
    // a courtesy, not the safety check — declining here changes nothing on the device. Going
    // BACKWARDS is the exception: the device refuses that outright unless this flow asks for it
    // explicitly (?downgrade=1 below), so for that direction the confirm is the whole permission.
    if (!confirm(t(back ? "ota.downgrade_confirm" : "ota.confirm", s.current, s.available))) {
      S.otaBusy = false;
      otaInline(t("ota.cancelled")); otaInlineClear();
      return;
    }

    otaInline(t("ota.starting"), { ring: true });
    // fetch resolves for ANY answered status, so a 503 from the shared OOM guard arrives as a
    // perfectly successful promise. Left unchecked it would fall through into the poll below and
    // surface 5 minutes later as "Update timed out" — the wrong diagnosis for a retryable refusal.
    let r;
    try { r = await post("/ota/update" + (back ? "?downgrade=1" : ""), {}); }
    catch { otaFail(t("ota.failed")); return; }
    if (r.status === 503) { otaFail(t("ota.busy")); return; }
    if (!r.ok) { otaFail(await errorOf(r, t("ota.failed"))); return; }

    const done = await otaWatch();
    if (!done)                  { otaFail(t("ota.timeout")); return; }
    if (done.state === "error") { otaFail(done.message || t("ota.failed")); return; }

    // state === "done": the device reboots ~600 ms after reporting it. Wait for it in the background
    // and RELOAD the page — see otaWaitReboot.
    otaInline(t("ota.rebooting"), { ring: true, pct: 100 });
    otaWaitReboot();
    handedOff = true;
  } finally {
    if (!handedOff) S.busy = false;
    if (!handedOff && S.otaBusy) S.otaBusy = false;
  }
}

// Watch a running download to its end, ticking the percentage into the header. Split out of
// checkFirmwareUpdate() so resumeOta() can join a download already in flight — e.g. after a page
// reload mid-update, where otherwise the header would sit silent while the device was busy.
function otaWatch() {
  return otaPoll(["checking", "updating"], 300, (st) => {
    if (st.state === "updating") otaInline(t("ota.pct", st.progress ?? 0), { ring: true, pct: st.progress ?? 0 });
  });
}

// On page load, adopt an update that is already running on the device (a reload during a download,
// or a second browser tab). Silent when nothing is happening — a plain GET that finds `idle` leaves
// the header exactly as it was.
async function resumeOta() {
  let s;
  try { s = await j("/ota/status"); } catch { return; }
  if (!s || (s.state !== "updating" && s.state !== "done")) return;
  if (S.otaBusy) return;
  S.busy = true; S.otaBusy = true;
  let handedOff = false;
  try {
    if (s.state === "updating") otaInline(t("ota.pct", s.progress ?? 0), { ring: true, pct: s.progress ?? 0 });
    const done = s.state === "done" ? s : await otaWatch();
    if (!done)                  { otaFail(t("ota.timeout")); return; }
    if (done.state === "error") { otaFail(done.message || t("ota.failed")); return; }
    otaInline(t("ota.rebooting"), { ring: true, pct: 100 });
    otaWaitReboot();
    handedOff = true;
  } finally {
    if (!handedOff) S.busy = false;
    if (!handedOff && S.otaBusy) S.otaBusy = false;
  }
}

// After "done" the device reboots ~600 ms later — and the page in the browser was served by the OLD
// image, so the UI itself is stale until it is re-fetched. Wait for the board to come back, then
// RELOAD. This is why the OTA path does NOT use rebootPoll() like the config saves do: that one
// re-renders from a fresh /status, which is right when only the DATA changed, and wrong here, where
// the HTML, CSS and this very script are what the update replaced.
//
// Three independent "it rebooted" signals, because no single one is reliable:
//   · version changed — the obvious one, but a same-version reinstall and a health-gate ROLLBACK
//     both come back on the version we started from;
//   · uptime went BACKWARDS — survives both of those, and is the only signal for them;
//   · we saw it go down and come back — misses the case where the first probe lands after the board
//     is already up again.
// Any one of them is enough.
const OTA_REBOOT_WAIT_MS = 120000;   // covers a slow boot AND a health-gate rollback cycle
function otaWaitReboot() {
  const preVer = S.status?.version || "";
  const preUp = typeof S.status?.uptime_s === "number" ? S.status.uptime_s : null;
  const started = Date.now();
  let sawDown = false;

  const probe = async () => {
    // Per-request abort: a socket to a rebooting board can hang for the browser's own (much longer)
    // timeout, which would stall the poll exactly while the interesting transition happens.
    const ctl = "AbortController" in window ? new AbortController() : null;
    const to = ctl ? setTimeout(() => ctl.abort(), 3000) : null;
    let s = null;
    try {
      const r = await fetch("/status?ms=" + Date.now(), { cache: "no-store", signal: ctl?.signal });
      if (!r.ok) throw new Error(r.status);
      s = await r.json();
    } catch {
      sawDown = true;          // unreachable or mid-reboot: expected here, not a failure
    } finally {
      if (to) clearTimeout(to);
    }

    if (s) {
      const rebooted = (preVer && s.version && s.version !== preVer) ||
                       (preUp != null && typeof s.uptime_s === "number" && s.uptime_s < preUp) ||
                       sawDown;
      if (rebooted) { location.reload(); return; }
    }
    if (Date.now() - started <= OTA_REBOOT_WAIT_MS) { setTimeout(probe, 1000); return; }

    // Out of patience. Answering but showing no sign of a reboot: reload anyway — it is harmless and
    // settles the question either way. Never answered at all: a reload would replace the one status
    // line the user has with a browser error page, so keep the message and let them choose when.
    if (s) { location.reload(); return; }
    S.busy = false; S.otaBusy = false;
    otaInline(t("ota.reload_hint"), { cls: "err" });   // no auto-clear: it asks the user to act
  };
  probe();
}

// ── Reboot-and-reconnect writes (WiFi / MQTT / Syslog) ────────────────────
// Mark a save button in-flight: disabled + spinner (DESIGN.md §8). The /set_mqtt broker pre-flight
// blocks up to ~8 s, long enough that an un-styled disabled button reads as an ignored click.
function setBusy(id, on) {
  const b = $(id);
  if (!b) return;
  b.disabled = on;
  if (on) {
    if (b.dataset.label == null) b.dataset.label = b.textContent;   // remember the idle label once
    b.innerHTML = `<span class="spin"></span>${esc(t("btn.saving"))}`;
  } else {
    b.textContent = b.dataset.label || t("btn.save");
  }
}

// Read the {"ok":false,"error":…} body every write endpoint answers a rejection with. Take the value
// only when it really is a non-empty error string: .catch covers an unparseable body, but a body that
// parses to JSON `null` would still resolve, and `null.error` throws — which here would escape
// saveReboot before idle() runs and strand S.busy + the Save button disabled for good. Mirrors
// setup.html's errorText().
async function errorOf(r, fallback) {
  const o = await r.json().catch(() => null);
  return (o && typeof o.error === "string" && o.error) || fallback;
}

// Poll /status until the rebooted device answers again, then hand back to `then`.
// A WiFi rollback deliberately outruns this window (wifi.cpp takes 60–180 s to decide), so the
// rollback outcome is NOT reported here — renderRollbackBanner() surfaces it off /status instead.
//
// A recursive setTimeout, NEVER setInterval, and the reason is the same one the OTA reboot-watcher
// states one screen up: a rebooting board does not REFUSE a connection, it stops answering SYNs, so
// a request issued mid-reboot HANGS for the browser's own (much longer) timeout instead of failing.
// A fixed cadence therefore stacks a fresh request on top of every hung one — and when the board
// came back they ALL completed within a millisecond of each other, each running this success path:
// one save produced four "Saved" toasts and four renders (a ~6 s reboot at 1.5 s = 4 in flight).
// One request at a time makes that structural rather than guarded against.
//
// Bounded per request too, for the same reason `j()` is bounded on the poll chain: without it a
// single hung probe eats the whole give-up window, and the toast that says the device did not come
// back would arrive long after it did.
function rebootPoll(then) {
  const deadline = Date.now() + REBOOT_POLL_WAIT_MS;
  const probe = async () => {
    let s = null;
    try { s = await j("/status", { signal: pollSignal(REBOOT_PROBE_TIMEOUT_MS) }); }
    catch { /* unreachable or mid-reboot: expected here, not a failure */ }
    if (s) {
      S.status = s; S.busy = false;
      toast(t("toast.saved"), "ok");
      then();
      return;
    }
    if (Date.now() < deadline) { setTimeout(probe, REBOOT_POLL_EVERY_MS); return; }
    S.busy = false;
    toast(t("toast.rebooted"), "info");
  };
  setTimeout(probe, REBOOT_POLL_EVERY_MS);
}
const REBOOT_POLL_EVERY_MS    = 1500;
const REBOOT_PROBE_TIMEOUT_MS = 3000;   // a probe at a board that is still down, not a live request
// WALL CLOCK, not an attempt count: with probes that hang the two are different numbers, and ~21 s
// is what the user — and saveReboot's own comment about how long the card stays busy — is promised.
const REBOOT_POLL_WAIT_MS     = 21000;

// One flow for all three modal saves. The endpoints share a contract: {"ok":true,"reboot":true} →
// persisted, device restarts; {"ok":true,"reboot":false} → nothing changed, no restart; a 4xx →
// {"ok":false,"error":…} and NOTHING was written; a 503 → the shared heap guard refused the request.
//
// Only a 2xx may enter the reboot-poll. fetch rejects on transport errors ONLY, never on status, so
// an answered 4xx/5xx is a verdict that arrives as a perfectly resolved promise — and firing the poll
// off it reported "Saved" for REJECTED writes: with no reboot to wait for, the follow-up /status
// answers on the first try, which the poll can't tell apart from a device that came back up.
// (/set_wifi's 500 on a failed config_save is the same shape: nothing persisted, no reboot.)
async function saveReboot(url, body, { btn, showError, close, then, busyMsg }) {
  // The reboot-poll keeps S.busy set for ~22 s AFTER the modal closes, so the card is reopenable
  // while a change is still landing. Say so — a silent `return` here is exactly the ignored-write
  // feedback gap this whole flow exists to close.
  if (S.busy) { toast(t("toast.applying"), "info"); return; }
  S.busy = true;
  setBusy(btn, true);
  if (busyMsg) toast(busyMsg, "info");
  const idle = () => { S.busy = false; setBusy(btn, false); };
  const reject = (msg) => { idle(); showError(msg); toast(msg, "err"); };
  let r;
  try {
    r = await post(url, body);
  } catch {
    // The endpoints answer BEFORE rebooting (reboot_soon fires ~400 ms after the response), so a
    // throw here means the request never landed — nothing was written and the modal must stay open.
    reject(t("toast.unreachable"));
    return;
  }
  // 503 is the device out of contiguous heap, not a bad field: nothing was written and the same save
  // is worth retrying verbatim, so it gets a toast and no inline field error blaming the input.
  if (r.status === 503) { idle(); toast(t("toast.busy_retry"), "err"); return; }
  if (!r.ok) { reject(await errorOf(r, t("toast.rejected"))); return; }
  const res = await r.json().catch(() => ({}));
  setBusy(btn, false);
  close();
  // No reboot. Two different things wear that answer, and they must not share a message: nothing was
  // written (the /set_mqtt-style unchanged save), or something WAS written and simply needs no
  // restart — /set_board recording that the user has stated their hardware. Saying "no changes" to
  // the second reports an NVS write as nothing having happened, which is the failure this whole
  // flow exists to close. `saved` is opt-in, so the routes that never send it are unaffected.
  if (res.reboot === false) {
    S.busy = false;
    toast(t(res.saved ? "toast.saved" : "toast.no_changes"), res.saved ? "ok" : "info");
    return;
  }
  toast(t("toast.reboot"), "info");
  rebootPoll(then);   // stays busy until the device answers again (or the poll gives up)
}
