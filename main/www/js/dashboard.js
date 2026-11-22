
// ── Values (dashboard) ───────────────────────────────────────────────────
// TWO orders, deliberately separate — they were ONE array until a key edit proved they conflict.
// `GROUPS` is MATCH PRECEDENCE (groupOf takes the first matching key); `GROUP_ORDER` below is
// DESIGN.md §6's reading order, which is what history.js renders by. Fusing them meant a group could
// only be made to win a label by also being MOVED UP THE PAGE, and the Protection group has carried
// a comment about that trap since it was written. The trap then sprang from the other side: giving
// the refrigerant group "discharge" — correct for Target/Discharge pipe temp. — silently took
// "Discharge Temp. Drop" and "Discharge Temp. Protection Retry Qty" out of Protection, which then
// showed 9 of its 11 rows exactly as that comment predicted. Precedence now says what it means, so a
// key can be made specific without anything moving on screen.
//
// Each key below was measured over the real catalog rather than guessed:
//   node -e '…read main/def/*.hpp labels…' | check which group each lands in
// The catalog audit once found dozens of published labels in the catch-all "Other values" at the
// bottom, including the unit's own Error Code — §6 group 1's named row, sitting below everything
// because "fault" was a key and "error" was not. Four keys
// were also claiming rows from the group after them ("target" took the three REFRIGERANT targets,
// "valve" took the five expansion valves, "domestic hot water" took the extra DHW SENSOR into
// Operation, "inv " took compressor speed into Electrical). None of that is visible from a single
// profile, which is why it survived: every row is present and plausible, just filed where nobody
// reading about the water circuit would look for it.
const GROUPS = [
  // FIRST, because it is the one group with an exactly-known membership: the eleven page-0x10
  // protection words (def/overlay.hpp), five retry counters + six drop-control flags. Every other
  // group is a family of labels that may grow; this one is a fixed set that must never lose a row to
  // a broader key, and putting it first is what makes that true from ALL directions instead of only
  // from Electrical's. Before it existed nine of the eleven sat in "Other values" — where a signal
  // goes to not be read — and the signal is precisely a unit that meets demand while quietly backing
  // off, which no temperature row shows.
  //
  // Keys are "drop" + "retry", NOT "protection", and that is MEASURED rather than assumed. Over the
  // published catalog labels, "drop" matches exactly the 6 flags and "retry" exactly the 5 counters,
  // while "protection" ALSO matches "Freeze Protection" and "Freeze Protection for water piping" —
  // two default_on hydronic flags (page 0x60, conv 302/300) that are normally ON. They would have
  // landed here reading permanently "limiting", the opposite of what this group says.
  //
  // Re-derive rather than trust that sentence (the catalog is machine-generated and grows without
  // touching this file), and re-run it at the def/overlay.hpp -> gen_profiles.py handover, which is
  // when these 11 labels can change out from under the patterns:
  //   grep -rhoE '\{0x[0-9A-Fa-f]{2}, *[0-9]+, *[0-9]+, *[0-9]+, *-?[0-9]+, *"[^"]+"' main/def/ \
  //     | sed -E 's/.*"([^"]+)"$/\1/' | sort -u | grep -icE 'drop|retry'      # must be 11
  // test_ui_source_matrix.mjs now asserts that count through the real groupOf, so a broader key
  // elsewhere can no longer take a row from here in silence.
  ["Protection", ["drop", "retry"]],
  // "error" catches the error type, code and detailed-code rows. The DHW
  // on-off flag §6 names here spells itself "Powerful DHW Operation. ON/OFF", so it lands in the DHW
  // group below; the old "domestic hot water" key matched ONLY the 2nd-tank SENSOR, i.e. it never
  // did the job it was written for and did one it should not have.
  ["Operation", ["operation mode", "thermostat", "space heat", "fault", "error", "defrost", "silent mode",
                 "restart standby", "startup control", "oil return operation",
                 "pressure equalizing operation", "demand signal", "low noise control",
                 "system off", "rt input", "main rt", "pwr consumption limit", "solar input"]],
  ["Domestic hot water", ["tank", "dhw", "hot water"]],
  // "heating target" for the hybrid/boiler water targets, NOT bare "target": that also took
  // Target Evap./Cond./Discharge Temp. — refrigerant-circuit control targets — into the water group.
  // Same for the valves: bare "valve" took all five expansion valves off the refrigerant circuit.
  ["Water circuit", ["leaving water", "return water", "inlet water", "outlet water", "mixed water",
                     "flow", "water pressure", "heating-flow", "heating flow", "heating target",
                     "lw setpoint", "delta", "pump", "2way valve", "3way valve", "3-way", "mix valve",
                     "floor loop shut off"]],
  // Bare "pressure" is safe HERE and only here: the two water-pressure spellings are claimed by the
  // group above, so what is left ("Pressure", "Pressure sensor(T)", …) is refrigerant — the same
  // generically-named rows logic/convert.hpp documents as its known is_refrigerant_pressure gap.
  ["Refrigerant / outdoor", ["outdoor", "heat-exchanger", "heat exchanger", "o/u heat exch",
                             "pressure", "refrigerant", "refrig.", "compressor", "fan",
                             "expansion valve", "discharge", "suction", "liquid", "deicer",
                             "target evap", "target cond", "inv frequency", "4 way valve",
                             "bypass valve", "y3s"]],
  // "ct sensor" beside "ct l": the catalog spells the clamps BOTH ways ("CT Sensor (L1)" and
  // "Current measured by CT sensor of L1") and only the second contains "current", so the short
  // spelling fell through to "Other values". "buh" brings BUH Step1/Step2 — §6's "backup-heater …
  // stages" — in from the same place, and MEASURED it cannot reach a leaving-water row: all five
  // "…BUH…" temperature spellings are claimed by the water group above it. "stage" is gone with
  // "capacity": it matched ZERO catalog labels, so it read as covering §6's "backup-heater … stages"
  // while doing nothing — the inert-setting shape this project rejects elsewhere. "capacity" is gone
  // for the opposite reason: it caught three unit NAMEPLATE ratings
  // (O/U, I/U, Indoor Unit) that are not electrical readings at all, while the one row it was meant
  // for, "BUH output capacity", is already claimed by "buh".
  ["Electrical", ["current", "ct l", "ct sensor", "inv ", "backup-heater", "backup heater", "buh",
                  "heat sink", "fin temp", "crank case heater", "phe heater"]],
  ["Device", ["wi-fi", "wifi", "mqtt", "hp link", "link", "poll", "uptime", "firmware", "rssi"]],
];
// DESIGN.md §6's reading order — "what is it doing" first, then detail. This is what the page is
// laid out by; GROUPS above decides only which group a label BELONGS to. Every name here must exist
// in GROUPS and vice versa (asserted in test_ui_source_matrix.mjs), so a group added to one and
// forgotten in the other cannot silently vanish from the page or render in an arbitrary place.
const GROUP_ORDER = ["Operation", "Domestic hot water", "Water circuit", "Refrigerant / outdoor",
                     "Protection", "Electrical", "Device"];
function groupOf(v) {
  if (v.group) return v.group;
  const l = (v.label || "").toLowerCase();
  for (const [name, keys] of GROUPS) if (keys.some((k) => l.includes(k))) return name;
  return "Other values";
}
// Deliberately does NOT call markUnreachable(): /status is the reachability probe (it runs on the
// same loop and says so on failure), and a values fetch that lost a race with a reboot must not
// overwrite a banner the status fetch is about to set correctly either way.
async function refreshValues(paint = true) {
  const request = S.valuesRequest = (S.valuesRequest || 0) + 1;
  const statusRequest = S.statusRequest, epoch = S.histEpoch;
  const current = () => request === S.valuesRequest && statusRequest === S.statusRequest &&
    (statusRequest == null || statusRequest === S.statusAcceptedRequest) &&
    epoch === S.histEpoch && !S.imageReloading;
  let r;
  try { r = await j("/values", { signal: pollSignal() }); }
  catch (error) {
    if (current()) invalidateLiveReadings(S.transportUnavailable === "status" ? "status" : "values",
      String(error.message) === "503");
    return false;
  }
  if (!current() || S.transportUnavailable === "status") return false;
  S._values = r.values || r || [];
  // The SECOND source, from the independent HomeHub stack (docs/MODBUS_PROTOCOL.md). Absent entirely
  // when that stack is off, which is exactly how a device without a HomeHub behaves — no Modbus row,
  // no comparison, no fallback. Never merged into S._values: the two have separate liveness, and
  // merging would make "is this reading current?" unanswerable per row.
  S._modbus = Array.isArray(r.modbus) ? r.modbus : [];
  // A successful values response follows a successful status response in pollTick, so together
  // they supersede a restored OTA snapshot. While installation continues, keep this newer complete
  // frame as the next reload's bounded fallback.
  S.otaCached = false;
  S.transportUnavailable = null;
  S.transportBusy = false;
  if (typeof expireLiveHistoryPins === "function") expireLiveHistoryPins();
  if (S.otaInstalling) otaCacheStore();
  if (paint) renderApp();
  return true;
}
// Dashboard cards: diagnostics, detected unit and value groups share one selectable panel below
// the live diagram. The board (ESP32) card and the
// WiFi/MQTT/Syslog/NTP rows are NOT here: both moved behind the gear onto Settings (renderSettings).
function checkupSourceReadyFor(status = S.status) {
  const diagSource = status?.health?.source || status?.diagnostics?.effective_source || "x10a";
  const hasRetainedHealth = Number(status?.health?.covered_s) > 0 ||
    status?.health?.persist === "unknown" ||
    Number(status?.health?.available) > 0;
  return (diagSource === "modbus"
    ? status?.modbus?.connected === true
    : status?.hp?.connected === true) || hasRetainedHealth;
}
const refrigerantStatusUnavailable = () => S.otaCached || S.transportUnavailable === "status";
function renderCards(hold = true) {
  retireCheckupDhwTimeline();
  if (refrigerantStatusUnavailable()) {
    markCyclingStale();
    // A click or scrub may defer rebuilding the card. Hide its retired status immediately.
    const item = $("valueGroups")?.querySelector?.('[data-desc="service:refrigerant"]')?.closest(".vitem");
    if (item && !item.hidden) {
      const focused = item.contains(document.activeElement);
      item.hidden = true;
      if (focused) $("cardNav")?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
      S.descOpen.delete("service:refrigerant");
      // If removal is held and the next frame is byte-identical, rebuild to remove hidden.
      delete _html.valueGroups;
    }
  }
  // Freeze trend hosts during a scrub so structural updates cannot replace the captured plot.
  // Rows catch up when scrubEnd resumes rendering.
  if (S.scrub || (hold && S.clickHold)) return;
  // The opt-in controls the entire diagnosis card and its navigation entry. Its 24-hour rows
  // follow the active diagnostics source (X10A or Modbus). During X10A loss, independent dated
  // water evidence and passive refrigerant observations keep only those X10A rows visible.
  const checkupSourceReady = checkupSourceReadyFor();
  const checkup = S.status?.diagnostics?.enabled === true
    ? checkupCardHtml(checkupSourceReady) : "";
  const card = S.dashboardCard;
  setHtml("valueGroups", checkup + statusCardsHtml() +
    valueGroupsHtml(S._values || [], S.status?.hp?.connected), false);
  const selected = syncDashboardCards();
  // A source change can select a card whose charts were paused in this frame.
  if (S.dashboardCard !== card) renderCards(false);
  else {
    for (const slot of selected?.querySelectorAll("[data-chart][inert], [data-checkup-hours][inert], [data-checkup-dhw][inert], [data-checkup-fault][inert]") || [])
      slot.inert = false;
    syncCheckupCyclingChart(selected);
    syncCheckupDhwChart(selected);
  }
}

function recoverOpenHistory() {
  if (S.scrub || S.clickHold || S.histBusy.size) return;
  const dashboard = S.stage === "dashboard";
  const inspector = dashboard && S.insp && INSPECT[S.insp];
  if (inspector && renderInspectHist(inspector, S.live ? inspCurRow(inspector) : null, "refresh"))
    return;
  const host = globalThis.document?.getElementById(dashboard ? "valueGroups" : "settingsCards");
  const rows = dashboard ? ".vgroup:not([hidden]) .vitem.open [data-trend]" : ".vitem.open [data-trend]";
  for (const button of host?.querySelectorAll(rows) || []) {
    const started = button.dataset.desc === "model:health_pressure"
      ? ensureHist(button.dataset.trend, "x10a", "refresh")
      : ensureHistPair(button.dataset.trend, "refresh");
    if (started) break;
  }
}

// Reconcile navigation against the installed frame, including while a poll is deferred.
// Keep inactive cards mounted so their accordions, trend state and delegated handlers survive.
function syncDashboardCards() {
  const browser = $("cardBrowser"), nav = $("cardNav"), host = $("valueGroups");
  if (!browser || !nav || !host) return;
  const cards = Array.from(host.querySelectorAll(".vgroup[data-dashboard-card]"));
  browser.hidden = !cards.length;
  const selected = cards.find(card => card.dataset.dashboardCard === S.dashboardCard) || cards[0];
  if (!selected) {
    setHtml("cardNav", "", false);
    host.removeAttribute("aria-labelledby");
    return;
  }
  S.dashboardCard = selected.dataset.dashboardCard;
  nav.setAttribute("aria-label", t("nav.cards"));
  const active = document.activeElement;
  const focused = nav.contains(active) ? active.dataset.card : null;
  setHtml("cardNav", cards.map((card, index) =>
    `<button type="button" class="dashboard-card-button" id="dashboard-card-${index}" ` +
    `data-card="${esc(card.dataset.dashboardCard)}" aria-pressed="false" aria-controls="valueGroups">` +
    `${dashboardCardIcon(card.dataset.dashboardCard)}` +
    `<span class="dashboard-card-label">${esc(card.dataset.dashboardLabel)}</span></button>`).join(""), false);
  for (const card of cards) card.hidden = card !== selected;
  const buttons = [...nav.querySelectorAll("[data-card]")];
  const chosenButton = buttons.find(button => button.dataset.card === S.dashboardCard);
  for (const button of buttons)
    button.setAttribute("aria-pressed", String(button === chosenButton));
  host.setAttribute("aria-labelledby", chosenButton.id);
  if (focused && !nav.contains(active))
    (buttons.find(button => button.dataset.card === focused) || chosenButton).focus({ preventScroll: true });
  return selected;
}

function retireMountedHistory() {
  const host = globalThis.document?.getElementById("valueGroups");
  if (!host) return;
  const rebuilding = S.trendRebuilding;
  S.trendRebuilding = true;
  try {
    const settings = document.getElementById("settingsCards");
    const inspector = document.getElementById("inspHist");
    const slots = [...host.querySelectorAll("[data-chart], [data-checkup-hours], [data-checkup-dhw]"),
      ...(settings?.querySelectorAll("[data-chart]") || [])];
    if (inspector) slots.push(inspector);
    for (const plot of settings?.querySelectorAll("#diagnostics-circulation-detail .vhist") || [])
      plot.remove();
    for (const slot of slots) {
      slot.textContent = "";
      delete slot._checkupMarkup;
      delete slot._dhwKey;
    }
  } finally { S.trendRebuilding = rebuilding; }
}

function selectDashboardCard(key) {
  const cards = $("valueGroups").querySelectorAll(".vgroup[data-dashboard-card]");
  if (!Array.from(cards).some(card => card.dataset.dashboardCard === key)) return;
  // Switching cards abandons the gesture on the previously visible plot.
  cancelHistoryGesture();
  S.dashboardCard = key;
  // Switch within the installed frame while the live poll is in progress. Its old chart
  // geometry cannot select a sample from the newer cache before the next complete paint.
  if (_pollBusy) {
    const selected = syncDashboardCards();
    for (const slot of selected?.querySelectorAll("[data-chart], [data-checkup-hours], [data-checkup-dhw], [data-checkup-fault]") || [])
      slot.inert = true;
  } else renderCards(false);
}

/*!
 * Lucide icon geometry — ISC License
 * Copyright (c) 2026 Lucide Icons and Contributors
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this permission notice
 * appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
 * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
 * DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH
 * THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Power derives from Feather — The MIT License (MIT)
 * Copyright (c) 2013-present Cole Bemis
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
const DASHBOARD_CARD_ICONS = Object.freeze({
  diagnosis: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  model: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h3M5 12h3M5 15h3M5 19v2M19 19v2"/><circle cx="15.5" cy="12" r="4.5"/><path d="M15.5 12c-2-1-3-3-1-4m1 4c2-1 4-1 4 1m-4-1c0 2-1 4-3 3"/>',
  'group:Operation': '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  'group:Domestic hot water': '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  'group:Water circuit': '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  'group:Refrigerant / outdoor': '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/>',
  'group:Protection': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'group:Electrical': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'group:Device': '<path d="M12 20v2M12 2v2M17 20v2M17 2v2M2 12h2M2 17h2M2 7h2M20 12h2M20 17h2M20 7h2M7 20v2M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  'group:Other values': '<path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13"/>',
  modbus: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
});
function dashboardCardIcon(key) {
  const paths = DASHBOARD_CARD_ICONS[key] || DASHBOARD_CARD_ICONS['group:Other values'];
  return `<svg class="dashboard-card-icon" width="17" height="17" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

// Defer guarded writes while a pointer sequence and its following fetch/slide settle (DESIGN.md
// §5.3). Only the timer releases this hold, so a cancelled or missing click cannot strand it and an
// event cannot end it before the post-click work finishes. The next poll applies deferred markup;
// timer release itself does not render.
const CLICK_HOLD_DOWN_MS = 1200;   // press → covers a long press, the click, and the fetch behind it
const CLICK_HOLD_UP_MS   = 600;    // release → covers the click, the slide and that same fetch
let clickHoldTimer = 0;
function clickHold(ms) {
  S.clickHold = true;
  clearTimeout(clickHoldTimer);
  clickHoldTimer = setTimeout(() => { S.clickHold = false; }, ms);
}
// One label→value row; `v` is escaped unless opt.html (e.g. signal-bar markup).
function vrow(k, v, opt = {}) {
  const val = (opt.html ? v : esc(v)) + (opt.unit ? `<span class="vrow-unit">${esc(opt.unit)}</span>` : "");
  return `<div class="vrow"><span class="vrow-label">${esc(k)}</span>` +
    `<span class="vrow-val ${opt.cls || ""}">${val}</span></div>`;
}
// `badge` is an optional short status word rendered beside the heading. It carries TEXT, never a
// bare colour: DESIGN.md §9 forbids conveying status by colour alone, and this one has to survive a
// reader who cannot tell --warn from --muted.
// `badgeCls` tints the badge's DOT only ("ok" / "err" / "dim"; the default is --warn). The word
// itself stays --fg in every state, which is what keeps §9 satisfied: the dot carries the emphasis
// and the text carries the statement, so a reader who cannot separate the colours loses nothing.
const vcard = (label, rows, badge, badgeCls, key, navLabel = label) =>
  `<div class="vgroup"${key ? ` data-dashboard-card="${esc(key)}" ` +
    `data-dashboard-label="${esc(navLabel)}"` : ""}><div class="card">` +
  `<div class="section-label">${esc(label)}` +
  (badge ? `<span class="section-badge ${badgeCls || ""}">${esc(badge)}</span>` : "") +
  `</div>${rows}</div></div>`;
const editIcon = `<svg class="vcard-edit-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const settingsChevIcon = `<svg class="vrow-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

// One Settings row with the same pull-out explanation tongue used by measured values. A passive
// readout makes the WHOLE row one accordion button; only a real second control (editor, selector or
// OTA action) keeps the split interaction. This avoids a dead value-shaped patch on otherwise
// read-only rows while still preventing a select or editor tap from toggling the explanation too.
function settingsInfoRow(stateKey, detailId, label, rightHtml, bodyHtml, itemCls = "", trendId = "",
                         wholeRow = false) {
  const open = S.descOpen?.has(stateKey) === true;
  const attrs = `data-desc="${stateKey}" ` +
    `${trendId ? `data-trend="${esc(trendId)}" ` : ""}` +
    `aria-expanded="${open ? "true" : "false"}" aria-controls="${detailId}"`;
  const row = wholeRow
    ? `<button class="vrow settings-whole-info-row settings-info-row" type="button" ${attrs}>` +
      `<span class="settings-whole-info-label"><span class="vrow-label">${esc(label)}</span>` +
      `${settingsChevIcon}</span>${rightHtml}</button>`
    : `<div class="vrow settings-split-row settings-info-row">` +
      `<button class="settings-split-info settings-info-toggle" type="button" ${attrs}>` +
      `<span class="vrow-label">${esc(label)}</span>${settingsChevIcon}</button>${rightHtml}</div>`;
  return `<div class="vitem${open ? " open" : ""} settings-info-item${itemCls ? ` ${itemCls}` : ""}">` +
    row +
    `<div class="vdesc"><div class="vdesc-inner"><div class="vdesc-body settings-info-tongue" ` +
    `id="${detailId}">${bodyHtml}</div></div></div></div>`;
}

function settingsValueInfoRow(scope, key, label, value, valueCls, help) {
  const right = `<span class="settings-info-value vrow-val settings-wrap ${valueCls || ""}">${esc(value)}</span>`;
  return settingsInfoRow(`${scope}:${key}`, `${scope}-${key}-detail`, label, right,
    `<div class="vdesc-p">${esc(help)}</div>`, "", "", true);
}

// RX/TX pin dropdown row — shown only when auto-detection hasn't locked a working pin pair. For a
// concrete board, /status.pins_avail is already narrowed to its physical headers and live
// reservations, so an old board-foreign value must not be resurrected here. Custom boards retain
// that compatibility fallback: only their owner can know whether an off-list stored pad is wired.
function pinSelRow(label, id, val, pins, key, help, keepOffList = true) {
  const list = (keepOffList && val != null && !pins.includes(val))
    ? [val, ...pins].sort((a, b) => a - b) : pins;
  const opts = list.map((p) => `<option value="${p}"${p === val ? " selected" : ""}>${p}</option>`).join("");
  const select = `<select class="input mono num pin-sel" id="${id}" aria-label="${esc(label)}">${opts}</select>`;
  return settingsInfoRow(`protocol:${key}`, `protocol-${key}-detail`, label, select,
    `<div class="vdesc-p">${esc(help)}</div>`);
}

// Resolve a distinct editable pair when a newly selected concrete board still carries an old
// board's cached link (XIAO 44/43 on Atom is the common transition). The dropdown may contain only
// offerable pins, yet changing either select must submit two usable values. Keep either current pin
// that is valid; fill only the absent side(s) from the ordered server list.
function boardLinkPickerValues(rx, tx, pins, restricted) {
  if (!restricted) return { rx, tx };
  let nextRx = pins.includes(rx) ? rx : null;
  let nextTx = pins.includes(tx) && tx !== nextRx ? tx : null;
  if (nextRx == null) nextRx = pins.find((p) => p !== nextTx) ?? null;
  if (nextTx == null) nextTx = pins.find((p) => p !== nextRx) ?? null;
  return { rx: nextRx, tx: nextTx };
}

// The update-channel row (Firmware card): which published feed the next OTA check reads. Two feeds
// exist because a merge to main no longer cuts a release — "Release" is the manually-cut, tagged
// build, "Development" is the last merge. Rendered from /status.ota.channel (the SETTING) rather
// than from the running version's "-dev" suffix (what is INSTALLED): the two differ for exactly as
// long as it takes to switch channels and install, which is when the row matters most.
function channelRow(cur) {
  const opt = (v, label) =>
    `<option value="${v}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const select = `<select class="input chan-sel" id="e32Chan" aria-label="${esc(t("card.channel"))}">` +
    opt("release", t("chan.release")) + opt("dev", t("chan.dev")) + `</select>`;
  return settingsInfoRow("firmware:channel", "firmware-channel-detail", t("card.channel"), select,
    `<div class="vdesc-p">${esc(t("card.channel_help"))}</div>`);
}

// The language row (Firmware card): the web UI's manual language override. "Browser" hands the
// choice back to the browser (navigator.language, the default); picking a language forces it on every
// client that opens the dashboard and persists it in NVS (POST /set_lang). Rendered from
// /status.ui.lang like every other setting; "auto" reads as "Browser" (it IS what the browser
// reports, not a separate automatic mode), and each language is named in its OWN tongue, the
// convention for a language picker.
const LANGUAGE_CHOICES = Object.freeze(["en", "de", "es", "fr", "it", "pl", "cs", "uk", "zh", "ja", "nb", "sv", "fi"]);
function langRow(cur) {
  const opt = (v, label) =>
    `<option value="${v}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const select = `<select class="input lang-sel" id="e32Lang" aria-label="${esc(t("card.language"))}">` +
    opt("auto", t("lang.auto")) + LANGUAGE_CHOICES.map((lang) => opt(lang, t(`lang.${lang}`))).join("") +
    `</select>`;
  return settingsInfoRow("firmware:language", "firmware-language-detail", t("card.language"), select,
    `<div class="vdesc-p">${esc(t("card.language_help"))}</div>`);
}

// The one device-wide consent boundary for optional plant diagnostics. OFF is persisted/default and
// leaves the source mappings dormant; X10A / Modbus keeps both sources recording in parallel and
// chooses which one feeds the dashboard checkup card.
function diagnosticsRow(diag) {
  const obj = diag && typeof diag === "object" ? diag : null;
  const enabled = obj ? obj.enabled === true : diag === true;
  const s = S.status || {};
  const avail = Array.isArray(obj?.available_sources)
    ? (obj.available_sources.length
        ? obj.available_sources.filter((v) => v === "x10a" || v === "modbus")
        : [obj.effective_source === "modbus" ? "modbus" : "x10a"])
    : (() => {
        const list = [];
        if (s.hp?.connected || !s.modbus?.host) list.push("x10a");
        if (s.modbus?.host) list.push("modbus");
        return list.length ? list : ["x10a"];
      })();
  const effective = obj?.effective_source || obj?.source || "x10a";
  const selected = !enabled ? "off" : (avail.includes(effective) ? effective : avail[0]);
  const opt = (value, label) =>
    `<option value="${value}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  const labels = { x10a: "X10A", modbus: "Modbus" };
  const sourceOpts = avail.map((src) => opt(src, labels[src] || src)).join("");
  const select = `<select class="input diagnostics-sel" id="e32Diagnostics" ` +
    `aria-label="${esc(t("card.diagnostics"))}">` +
    opt("off", t("diagnostics.off")) + sourceOpts + `</select>`;
  return settingsInfoRow("firmware:diagnostics", "firmware-diagnostics-detail",
    t("card.diagnostics"), select,
    `<div class="vdesc-p">${esc(t("card.diagnostics_help"))}</div>`);
}

// Browser-session accordion for the expert register reader. There is deliberately no second On/Off
// control or nested card: opening this ordinary explanation tongue reveals the form directly and
// closing it hides the form. The disclosure state is neither posted nor persisted.
function protocolDiagnosticsRow() {
  return settingsInfoRow("protocol:diagnosis", "protocol-diagnosis-detail", t("probe.toggle"), "",
    x10aDiagnosisCardHtml(), "protocol-diagnosis-item", "", true);
}

function hpProbeRegNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(text)) return null;
  const n = Number.parseInt(text, /^0x/i.test(text) ? 16 : 10);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

// Converter choices are the exact implemented candidates the firmware can sweep for each field
// width (logic/hp_probe.hpp). The host UI contract compares both tables so a firmware candidate
// cannot appear as an unexplained number here, or a stale browser option outlive its decoder.
const HP_PROBE_CONVERTERS = Object.freeze([
  [105, 2], [106, 2], [107, 2], [108, 2], [114, 2], [119, 2],
  [101, 2], [102, 2], [103, 2], [104, 2], [109, 2], [110, 2], [111, 2], [118, 2],
  [151, 2], [152, 2], [161, 2], [164, 2], [405, 2],
  [105, 1], [101, 1], [152, 1], [161, 1], [164, 1], [312, 1],
  [211, 1], [219, 1], [214, 1], [215, 1], [200, 1], [310, 1], [311, 1],
  [217, 1], [201, 1], [203, 1], [204, 1], [315, 1], [316, 1],
  [300, 1], [301, 1], [302, 1], [303, 1], [304, 1], [305, 1], [306, 1], [307, 1],
]);

function hpProbeConvertersForSize(size) {
  const width = Number(size);
  return HP_PROBE_CONVERTERS.filter((entry) => entry[1] === width).map((entry) => entry[0]);
}

function hpProbeConverterDescription(conv, size) {
  const one = Number(size) === 1;
  switch (Number(conv)) {
    case 101: return one ? t("probe.conv_raw_byte") : t("probe.conv_signed_raw_le");
    case 102: return t("probe.conv_signed_raw_be");
    case 103: return t("probe.conv_signed_256_le");
    case 104: return t("probe.conv_signed_256_be");
    case 105: return one ? t("probe.conv_tenth_byte") : t("probe.conv_signed_tenth_le");
    case 106: return t("probe.conv_signed_tenth_be");
    case 107: case 114: case 119: return t("probe.conv_signed_tenth_nodata_le");
    case 108: return t("probe.conv_signed_tenth_nodata_be");
    case 109: return t("probe.conv_signed_128_le");
    case 110: return t("probe.conv_signed_128_be");
    case 111: return t("probe.conv_signed_half_be");
    case 118: return t("probe.conv_signed_hundredth_be");
    case 151: return t("probe.conv_unsigned_raw_le");
    case 152: return one ? t("probe.conv_unsigned_byte") : t("probe.conv_unsigned_raw_be");
    case 161: return one ? t("probe.conv_unsigned_half_byte") : t("probe.conv_unsigned_half_be");
    case 405: return t("probe.conv_saturation");
    case 211: return t("probe.conv_raw_fan");
    case 219: return t("probe.conv_capacity");
    case 214: return t("probe.conv_eeprom_digit");
    case 215: return t("probe.conv_eeprom_pair");
    case 310: return t("probe.conv_bits_high");
    case 311: return t("probe.conv_bits_low");
    case 217: return t("probe.conv_operation_mode");
    case 203: return t("probe.conv_error_class");
    case 204: return t("probe.conv_error_code");
    case 315: return t("probe.conv_indoor_mode");
    case 316: return t("probe.conv_hybrid_mode");
    default:
      return Number(conv) >= 300 && Number(conv) <= 307
        ? t("probe.conv_bit", Number(conv) - 300) : t("probe.conv_unknown");
  }
}

function hpProbeDraftRequest(draft = S.hpProbeDraft) {
  const reg = hpProbeRegNumber(draft.reg);
  const offset = Number(draft.offset), size = Number(draft.size);
  const convText = String(draft.conv ?? "").trim();
  const sweep = draft.mode === "sweep";
  const conv = sweep ? null : Number(convText);
  if (reg == null || !Number.isInteger(offset) || offset < 0 || offset > 31 ||
      (size !== 1 && size !== 2) ||
      (!sweep && (!Number.isInteger(conv) || conv < 0 || conv > 999))) return null;
  const request = { reg, offset, size };
  if (conv != null) request.conv = conv;
  return request;
}

function hpProbeHexBytes(value) {
  return String(value || "").trim().split(/\s+/).filter((byte) => /^[0-9a-f]{2}$/i.test(byte));
}

function hpProbeResultHtml() {
  if (S.hpProbeError) return `<div class="probe-error" role="status">${esc(S.hpProbeError)}</div>`;
  const r = S.hpProbeResult;
  if (!r) return "";
  const status = String(r.status || "error");
  const statusText = t(`probe.status_${status}`);
  const frameBytes = hpProbeHexBytes(r.frame);
  const payloadBytes = hpProbeHexBytes(r.payload);
  const offset = Number.isInteger(r.offset) ? r.offset : Number(S.hpProbeDraft.offset);
  const size = Number.isInteger(r.size) ? r.size : Number(S.hpProbeDraft.size);
  const reg = r.reg || (hpProbeRegNumber(S.hpProbeDraft.reg) == null ? S.hpProbeDraft.reg
    : `0x${hpProbeRegNumber(S.hpProbeDraft.reg).toString(16).toUpperCase().padStart(2, "0")}`);
  const meta = [r.proto ? `X10A-${r.proto}` : "X10A", Number.isInteger(r.rx_pin) ? `RX ${r.rx_pin}` : "",
    Number.isInteger(r.tx_pin) ? `TX ${r.tx_pin}` : "", `${frameBytes.length} ${t(frameBytes.length === 1 ? "probe.byte" : "probe.bytes")}`]
    .filter(Boolean).join(" · ");
  let payload = "";
  if (payloadBytes.length) {
    const bytes = payloadBytes.map((byte, index) =>
      `<span class="probe-byte${index >= offset && index < offset + size ? " selected" : ""}">${esc(byte.toUpperCase())}</span>`).join("");
    payload = `<div class="probe-subheading">${esc(t("probe.payload_marked"))}</div>` +
      `<div class="probe-byte-strip" aria-label="${esc(t("probe.payload"))}">${bytes}</div>`;
    if (r.slice) payload += `<div class="probe-slice-note">${esc(t("probe.slice_note", offset, size, r.slice.toUpperCase()))}</div>`;
  }
  const frame = r.frame ? `<div class="probe-subheading">${esc(t("probe.full_frame"))}</div>` +
    `<div class="probe-frame">${esc(r.frame.toUpperCase())}</div>` : "";
  let decoded = "";
  const values = Array.isArray(r.decodes) ? r.decodes : [];
  for (const d of values) {
    const aliases = Array.isArray(d.aliases) && d.aliases.length
      ? `<small>${esc(t("probe.aliases"))}: ${d.aliases.map((v) => `conv ${esc(v)}`).join(", ")}</small>` : "";
    const value = d.text != null ? d.text : d.value != null ? String(d.value)
      : d.refused ? t("probe.refused") : d.unimplemented ? t("probe.unimplemented") : "—";
    decoded += `<div class="probe-decode"><span class="probe-converter">conv ${esc(d.conv)}${aliases}</span>` +
      `<span class="probe-decode-label">${esc(t("probe.decode_value"))}</span>` +
      `<span class="probe-decode-value">${esc(value)}</span></div>`;
  }
  const interpretation = decoded ? `<div class="probe-subheading">${esc(t("probe.interpretation"))}</div>` +
    `<div class="probe-decodes">${decoded}</div>`
    : r.ok ? `<div class="probe-subheading">${esc(t("probe.interpretation"))}</div>` +
      `<div class="probe-empty">${esc(t("probe.no_decodes"))}</div>` : "";
  return `<div class="probe-response" aria-live="polite"><div class="probe-result-head"><div>` +
    `<div class="probe-result-title">${esc(t("probe.response_for", reg))}</div>` +
    `<div class="probe-result-meta">${esc(meta)}</div></div>` +
    `<div class="probe-result-status ${r.ok ? "ok" : "err"}"><span></span>${esc(statusText)}</div></div>` +
    `<div class="probe-transport ${r.ok ? "ok" : "err"}">${esc(t(`probe.transport_${status}`))}</div>` +
    payload + frame + interpretation + `</div>`;
}

function x10aDiagnosisCardHtml() {
  const d = S.hpProbeDraft || { selected: "", reg: "0x60", offset: "11", size: "1", mode: "specific", conv: "105" };
  let registerOptions = `<option value="">${esc(t("probe.manual"))}</option>`;
  const catalog = Array.isArray(S.hpProbeCatalog) ? S.hpProbeCatalog : [];
  catalog.forEach((row, index) => {
    registerOptions += `<option value="${index}"${d.selected === String(index) ? " selected" : ""}>` +
      `${esc(row.label)}</option>`;
  });
  const catalogState = S.hpProbeCatalogBusy ? t("probe.catalog_loading")
    : S.hpProbeCatalogError ? t("probe.catalog_error")
    : !catalog.length ? t("probe.catalog_empty")
    : S.hpProbeCatalogFallback
      ? t("probe.catalog_fallback", S.hpProbeCatalogDefinition || "generic", S.hpProbeCatalogProfile || "auto")
      : t("probe.catalog_profile", S.hpProbeCatalogDefinition || S.hpProbeCatalogProfile);
  const sizeOption = (n) => `<option value="${n}"${String(d.size) === String(n) ? " selected" : ""}>` +
    `${n} ${esc(t(n === 1 ? "probe.byte" : "probe.bytes"))}</option>`;
  const mode = d.mode === "sweep" ? "sweep" : "specific";
  const converters = hpProbeConvertersForSize(d.size);
  const selectedConv = converters.includes(Number(d.conv)) ? Number(d.conv) : converters[0];
  const converterOptions = `<option value="sweep"${mode === "sweep" ? " selected" : ""}>${esc(t("probe.converter_auto"))}</option>` +
    converters.map((conv) => `<option value="${conv}"${mode !== "sweep" && conv === selectedConv ? " selected" : ""}>` +
    `${conv}</option>`).join("");
  const regNumber = hpProbeRegNumber(d.reg);
  const regLabel = regNumber == null ? "—" : `0x${regNumber.toString(16).toUpperCase().padStart(2, "0")}`;
  const body = `<p class="probe-intro">${esc(t("probe.intro"))}</p>` +
    `<form id="hpProbeForm" class="probe-form">` +
    `<div class="probe-section-title">${esc(t("probe.request"))}</div><div class="probe-grid">` +
    `<label class="probe-field probe-wide"><span class="probe-field-label">${esc(t("probe.register"))}</span>` +
    `<select class="input probe-control" id="hpProbeRegister"${S.hpProbeCatalogBusy ? " disabled" : ""}>${registerOptions}</select>` +
    (catalogState ? `<span class="field-help${S.hpProbeCatalogError ? " err" : ""}">${esc(catalogState)}</span>` : "") +
    `</label><label class="probe-field"><span class="probe-field-label">${esc(t("probe.page"))}` +
    `<span class="probe-normalized" id="hpProbeRegNormalized">${esc(regLabel)}</span></span>` +
    `<input class="input mono probe-control" id="hpProbeReg" value="${esc(d.reg)}" inputmode="text" autocomplete="off">` +
    `<span class="field-help">${esc(t("probe.page_help"))}</span></label>` +
    `<label class="probe-field"><span class="probe-field-label">${esc(t("probe.offset"))}</span>` +
    `<input class="input mono num probe-control" id="hpProbeOffset" value="${esc(d.offset)}" type="number" min="0" max="31">` +
    `<span class="field-help">${esc(t("probe.offset_help"))}</span></label>` +
    `<label class="probe-field"><span class="probe-field-label">${esc(t("probe.size"))}</span>` +
    `<select class="input probe-control" id="hpProbeSize">${sizeOption(1)}${sizeOption(2)}</select>` +
    `<span class="field-help">${esc(t("probe.size_help"))}</span></label>` +
    `<label class="probe-field"><span class="probe-field-label">${esc(t("probe.converter"))}</span>` +
    `<select class="input probe-control" id="hpProbeConv">${converterOptions}</select>` +
    `<span class="field-help">${esc(mode === "sweep" ? t("probe.converter_auto_help", d.size) :
      hpProbeConverterDescription(selectedConv, d.size))}</span></label></div>` +
    `<div class="probe-action-row"><span class="probe-action-note">${esc(t("probe.action_note"))}</span>` +
    `<button class="btn primary probe-submit" id="hpProbeSubmit" type="submit" aria-busy="${S.hpProbeBusy ? "true" : "false"}"${S.hpProbeBusy ? " disabled" : ""}>` +
    (S.hpProbeBusy ? `<span class="spin"></span>${esc(t("probe.querying"))}` : esc(t("probe.send"))) + `</button></div>` +
    `</form>${hpProbeResultHtml()}`;
  return `<div class="probe-card">${body}</div>`;
}

// The version row (Firmware card): the running version, and the SAME OTA trigger the dashboard
// header's version is — one gesture with one meaning wherever the version is printed. Not a second
// copy of the flow: the tap runs checkFirmwareUpdate() itself. It does NOT leave the screen. An
// update is started from here *while reading this card* — the version, the channel it follows, the
// build it is about to become are all on it — and yanking the user to the dashboard mid-thought to
// show them a progress ring is the app deciding where they should be looking. So the readout comes
// to them instead: `#otaStatSet` is the second slot otaInline paints, right after the version, the
// same place the header keeps its own (`#otaStat`).
function firmwareRow(version) {
  const title = S.otaAvail ? t("ota.title_avail", S.otaAvail) : t("ota.title_check");
  const action = `<button class="settings-split-action vrow-fw" type="button" data-act="ota" ` +
    `aria-label="${esc(t("aria.ota"))}" title="${esc(title)}">` +
    `<span class="vrow-val mono">v${esc(version || "?")}` +
    `<span class="otastat" id="otaStatSet" aria-hidden="true"></span></span></button>`;
  return settingsInfoRow("firmware:version", "firmware-version-detail", t("card.firmware"), action,
    `<div class="vdesc-p">${esc(t("card.firmware_help"))}</div>`);
}

// The circulation witness's own condition, as ONE rule — the same shape roomSourceStatus() has, and
// for the same reason: it is read three times (the tongue's assessment line, the row's status colour
// and its accessible name), and three copies of a ladder is the drift this project keeps paying for.
//
// The BROKER branch is why this exists at all. The witness is an MQTT subscription, so clearing the
// broker silences it completely — and this row used to answer that with "waiting for a message",
// forever, while the room source one row up in the same card said so plainly (`ref.broker_off`). A
// row that cannot say why it is empty is a row that reads as a broken sensor.
function circulationSourceStatus(c, mqtt) {
  if (S.transportUnavailable === "status")
    return { key: "unavailable", text: t("circ.unavailable"), cls: "dim" };
  if (!c.configured) return { key: "not_configured", text: t("circ.not_configured"), cls: "dim" };
  if (!mqtt.configured) return { key: "broker_off", text: t("circ.broker_off"), cls: "err" };
  if (c.error) return { key: "unavailable", text: t("circ.unavailable"), cls: "err" };
  if (c.has_value && c.fresh) {
    return { key: "live", cls: "ok",
      text: c.state === "on" ? t("circ.running")
          : c.state === "off" ? t("circ.stopped") : t("circ.checking") };
  }
  if (c.has_value) return { key: "stale", text: t("circ.stale"), cls: "warn" };
  return { key: "waiting", text: t("circ.waiting"), cls: "warn" };
}

function circulationSettingsCardHtml() {
  const c = S.status?.circulation_source || {};
  const mqtt = S.status?.mqtt || {};
  const status = circulationSourceStatus(c, mqtt);
  const value = status.text;
  let body = `<div class="vdesc-p">${esc(t("circ.settings_help"))}</div>`;
  if (c.configured) {
    const source = c.name || "MQTT";
    body = descNoteHtml(t("circ.detail.source"), source);
    if (c.has_value && S.transportUnavailable !== "status") {
      const power = Number(c.power_w).toLocaleString(LANG,
        { maximumFractionDigits: 1 });
      body += descNoteHtml(t("circ.detail.power"), `${power} W`);
    }
    // The row header identifies WHICH pump is configured. Its current assessment belongs here with
    // the evidence, including waiting/error states that do not have a power value yet.
    body += descNoteHtml(t("circ.detail.state"), value);
    if (c.has_value && S.transportUnavailable !== "status" && Number.isFinite(c.age_s))
      body += descNoteHtml(t("circ.detail.age"), checkupDuration(c.age_s));
    body += `<div class="vdesc-p">${esc(t("circ.settings_help"))}</div>`;
  }
  if (S.stage !== "dashboard" && S.descOpen.has("diagnostics:circulation"))
    body += typeof histHtml === "function" ? histHtml("circulation_state", "", t("circ.row")) : "";
  const sourceName = c.configured ? (c.name || "MQTT") : t("circ.not_configured");
  // The face NAMES the source and states its condition in colour — the room-source row's shape. That
  // makes the colour load-bearing, so DESIGN.md §9 requires the accessible name to spell the same
  // condition out in words; before this the row carried neither, and a witness that had gone silent
  // looked exactly like one that was running.
  // On an UNCONFIGURED row the name IS the status ("Not configured"), so appending it again reads as
  // "Not configured · Not configured" to a screen reader. Append the condition only where it says
  // something the name does not.
  const ariaState = value === sourceName ? "" : ` · ${value}`;
  const right = `<button class="settings-split-action vrow-val settings-wrap ${status.cls}" type="button" ` +
    `data-act="circulation" aria-label="${esc(`${t("circ.title")}: ${sourceName}${ariaState}`)}">` +
    `<span>${esc(sourceName)}</span>${editIcon}</button>`;
  const row = settingsInfoRow("diagnostics:circulation", "diagnostics-circulation-detail",
    t("circ.row"), right, body, "", "circulation_state");

  return vcard(t("settings.diagnostics"), row);
}

// Settings cards rendered below Connections: THREE permanent ESP32-family cards, the plant-
// diagnostics card and then the heating-curve diagnosis card. Those dependent cards render only
// after the Firmware card's explicit master opt-in; their saved source mappings remain dormant while
// it is off. The ESP32 cards
// were split from what was
// one, so each answers one question. ESP32 = the board itself (its onboard hardware and its own
// health — uptime + the two memory curves). Protokoll = the X10A link (whether the bus answers, the
// framing it speaks, and the RX/TX pins). Firmware = the running version, the update feed it follows,
// and the UI language. All four render into one container (#settingsCards) as concatenated vcards,
// so the delegated click/change listeners bound there keep working across the split.
//
// The board-health rows are the ONLY telemetry here, and each earns its place by answering a question
// no other screen does: uptime says whether the board restarted (the crash banner only fires on a
// FAULT), and the two memory rows carry 24-hour curves that show DRIFT. The chip id and the last
// reset reason stay off the cards — static or one-shot facts that /status, /diag and the MQTT
// heartbeat's diagnostic entities already carry, and Settings is otherwise what the board is SET TO.
// (Tapping the version — here or in the dashboard header — runs the OTA check, DESIGN.md §5.4; the
// channel row below it is the SETTING that decides which feed that check reads, not a second copy of
// the flow.) Pins are auto-detected: once the bus answers on a pair they show read-only; until then a
// dropdown of the board's wire-able GPIOs lets the user point the firmware at their wiring. A brief
// timeout doesn't flip back to the dropdown (last_ok_s grace).
function esp32CardHtml() {
  const s = S.status || {}, hp = s.hp || {};
  const proto = hp.proto === "I" ? "X10A-I" : hp.proto === "S" ? "X10A-S" : "—";
  const pinsLocked = hp.connected || (typeof hp.last_ok_s === "number" && hp.last_ok_s >= 0 && hp.last_ok_s <= 30);
  const avail = Array.isArray(s.pins_avail) ? s.pins_avail : [];
  const boardRestricted = !!(s.board?.preset_id && s.board.preset_id !== "custom");
  const picker = boardLinkPickerValues(hp.rx, hp.tx, avail, boardRestricted);
  const pinRow = (label, id, val, other, key, help) => pinsLocked
    ? settingsValueInfoRow("protocol", key, label, val != null ? String(val) : "—", "mono num", help)
    : pinSelRow(label, id, val, avail.filter((p) => p !== other), key, help, !boardRestricted);
  // ESP32 — the board's onboard hardware and its own health. READINGS AND SETTINGS ONLY; the one
  // action this card family used to carry ("Report a bug") is in the Settings footer line now
  // (index.html #footBug), a rare escape hatch that read as one more board fact under "Largest free block".
  const esp32Rows =
    boardRow() +
    uptimeRow(s.uptime_s) +
    memoryRows(s.sys || {});
  // Protokoll — the X10A link: connection state, framing, and the RX/TX pins it is wired on.
  const protoRows =
    settingsValueInfoRow("protocol", "link", t("card.hplink"),
      hp.connected ? t("card.online") : t("card.offline"), hp.connected ? "ok" : "err", t("card.hplink_help")) +
    settingsValueInfoRow("protocol", "framing", t("card.protocol"), hp.connected ? proto : "—", "",
      t("card.protocol_help")) +
    pinRow(t("card.rxpin"), "e32Rx", pinsLocked ? hp.rx : picker.rx,
      pinsLocked ? hp.tx : picker.tx, "rx", t("card.rxpin_help")) +
    pinRow(t("card.txpin"), "e32Tx", pinsLocked ? hp.tx : picker.tx,
      pinsLocked ? hp.rx : picker.rx, "tx", t("card.txpin_help")) +
    (hp.connected ? protocolDiagnosticsRow() : "");
  // Firmware — running build, update feed, language and the explicit plant-diagnostics consent.
  // This is not a heat-pump controller mode: it only gates optional observations and their sources.
  const diagnosticsEnabled = s.diagnostics?.enabled === true;
  const fwRows =
    firmwareRow(s.version) +
    channelRow(s.ota?.channel === "dev" ? "dev" : "release") +
    langRow(uiLangSupported(s.ui?.lang) ? s.ui.lang : "auto") +
    diagnosticsRow(s.diagnostics || diagnosticsEnabled);
  return vcard("ESP32", esp32Rows) + vcard(t("card.proto_title"), protoRows) +
         vcard(t("card.fw_title"), fwRows) +
         (diagnosticsEnabled ? circulationSettingsCardHtml() + dynamicControlCardHtml() : "");
}

// The Settings home for the heating-curve diagnosis. Every main row uses the same split
// interaction as Board Hardware: the label owns the otherwise empty left area and toggles its
// explanation tongue; a compact value on the right opens an editor only where one exists. This
// keeps status/explanation and configuration as two explicit actions on configured and empty rows.
// `ariaState` is DESIGN.md §9's escape hatch, not decoration: a row whose face states a NAME conveys
// its status by colour alone, which §5.6 permits for the Connections rows only because their
// accessible names spell that status out in words. The room source is that shape now, so it passes
// the state here; a row whose visible value already IS its state passes nothing and reads as before.
function dynamicInfoRow(key, label, value, valueCls, bodyHtml, action = "", title = "",
                        ariaState = "") {
  const aria = ariaState ? `${title}: ${value} · ${ariaState}` : `${title}: ${value}`;
  const right = action
    ? `<button class="settings-split-action dynamic-config-open vrow-val settings-wrap ${valueCls}" ` +
      `type="button" data-act="${action}" aria-label="${esc(aria)}">` +
      `<span>${esc(value)}</span>${editIcon}</button>`
    : `<span class="settings-info-value vrow-val settings-wrap ${valueCls}">${esc(value)}</span>`;
  return settingsInfoRow(`dynamic:${key}`, `dynamic-${key}-detail`, label, right, bodyHtml,
    "dynamic-info-item", "", !action);
}

// The weather tongue explains the two derived forecast numbers instead of compressing them into
// one slash-separated status line. It deliberately uses the ordinary explainer paragraphs and
// lead-ins, so this permanent Settings panel reads like every opened value/checkup explainer.
// Old values remain visible when freshness fails because they are useful diagnostic evidence; the
// status paragraph says explicitly that they are no longer current.
function weatherSourceDetailHtml(w, outdoor, solar) {
  if (S.transportUnavailable === "status") return descNoteHtml(t("sys.nodata"), t("ota.snapshot_value"));
  let statusKey;
  let detailText;
  const reason = w.freshness_reason || w.reason;
  if (w.fetching) {
    statusKey = "fetching";
  } else if (w.has_value && w.fresh) {
    statusKey = "fresh";
  } else if (reason === "clock_unsynced") {
    statusKey = "unavailable";
    detailText = t("ref.clock_unsynced");
  } else if (reason === "network_unavailable") {
    statusKey = "unavailable";
    detailText = t("card.offline");
  } else if (w.error) {
    statusKey = "unavailable";
  } else if (w.has_value) {
    statusKey = "stale";
  } else {
    statusKey = "waiting";
  }

  const detail = detailText || t(`wx.detail.${statusKey}`);
  let html = descNoteHtml(t("wx.detail.status"),
    `${t(`wx.status.${statusKey}`)} — ${detail}`);
  if (w.has_value) {
    html += descNoteHtml(t("wx.detail.temperature_label"), t("wx.detail.temperature", outdoor));
    html += descNoteHtml(t("wx.detail.solar_label"), t("wx.detail.solar", solar));
  }
  return html + descNoteHtml(t("wx.detail.source_label"), t("wx.detail.source"));
}

// Why a room reading that ARRIVED cannot produce a verdict — logic/reference_temperature.hpp's
// ReferenceRoomReason, in the words a user can act on. ONE table, read by both the state line at
// the top of the card and the source's own explanation further down, so the two can never give
// different accounts of the same block. A reason with no entry here falls back to the generic line
// rather than printing a raw enum name; the firmware may add reasons without this file changing.
const ROOM_BLOCK_LINES = {
  disabled:                   "dyn.room_off",
  non_heating_mode:           "dyn.room_not_heating",
  stale:                      "dyn.room_stale",
  retained_without_timestamp: "dyn.room_retained_no_time",
  clock_unsynced:             "dyn.state_clock",
  no_value:                   "dyn.room_no_value",
  invalid_payload:            "dyn.room_invalid_payload",
  future_timestamp:           "dyn.room_future_time",
  backward_timestamp:         "dyn.room_backward_time",
  arrival_clock_invalid:      "dyn.room_invalid_time",
  temperature_out_of_range:   "dyn.room_invalid_temperature",
  setpoint_out_of_range:      "dyn.room_invalid_setpoint",
  missing_setpoint:           "dyn.room_no_setpoint",
  missing_setpoint_mapping:   "dyn.room_no_setpoint",
  missing_source_time:        "dyn.room_no_time",
  missing_enabled_state:      "dyn.room_no_enabled",
  missing_hvac_mode:          "dyn.room_no_hvac_mode",
};

// What the row header calls the configured source. The name is cosmetic and may be empty, so one
// stable fallback keeps the compact row identifiable.
function roomSourceName(r) { return r.name || "MQTT"; }

// The source's measurement condition and the diagnosis decision are related but not identical. A
// switched-off thermostat can still supply a fresh, plausible room temperature; only its target is
// unusable as an active heating reference. Keep that distinction in one result so the row can stay
// amber for the blocked diagnosis without falsely calling the measurement itself unusable.
function roomSourceStatus(r, mqtt) {
  if (S.transportUnavailable === "status")
    return { key: "unavailable", detail: t("sys.nodata"), cls: "dim" };
  if (!r.configured)
    return { key: "not_configured", detail: t("ref.detail.setup"), cls: "dim" };
  if (!mqtt.configured)
    return { key: "unavailable", detail: t("ref.broker_off"), cls: "err" };
  if (r.error)
    return { key: "error", detail: t("ref.detail.error", r.error), cls: "err" };
  if (!r.has_value)
    return { key: "waiting", detail: t("ref.detail.waiting"), cls: "warn" };
  if (!r.fresh) {
    const freshnessDetail = ({
      missing_source_time: t("dyn.room_no_time"),
      retained_without_timestamp: t("ref.time_untrusted"),
      clock_unsynced: t("ref.clock_unsynced"),
      future_timestamp: t("dyn.room_future_time"),
      backward_timestamp: t("dyn.room_backward_time"),
      arrival_clock_invalid: t("dyn.room_invalid_time"),
    })[r.freshness_reason];
    if (freshnessDetail)
      return { key: "unusable", detail: freshnessDetail, cls: "warn" };
    return { key: "stale",
      detail: t("ref.detail.stale"), cls: "warn" };
  }
  if (r.temperature_valid === false)
    return { key: "unusable", detail: t(ROOM_BLOCK_LINES[r.reason] || "dyn.room_invalid_payload"),
      cls: "warn" };
  const diagnosis = !r.control_eligible
    ? { key: "unusable", detail: t(ROOM_BLOCK_LINES[r.reason] || "dyn.room_invalid_payload") }
    : { key: "usable", detail: "" };
  return { key: "measurement_valid", detail: "", diagnosis,
    cls: r.control_eligible ? "ok" : "warn" };
}

function roomSourceStatusText(status) {
  const state = t(`ref.status.${status.key}`);
  return status.detail ? `${state} — ${status.detail}` : state;
}

function roomSourceAccessibleStatus(status) {
  const measurement = roomSourceStatusText(status);
  if (!status.diagnosis) return measurement;
  return `${measurement} · ${t("ref.detail.diagnosis_label")} ${roomSourceStatusText(status.diagnosis)}`;
}

function roomSourceDetailHtml(r, status, temperature, setpoint, age) {
  // This tongue is a live status, not a second copy of the editor. The source name is already the
  // row value; topic/path mechanics belong in the modal. State measurement validity first, then
  // separately say whether the heating-curve diagnosis may use it.
  let html = descNoteHtml(t("ref.detail.status_label"), roomSourceStatusText(status));
  if (status.diagnosis)
    html += descNoteHtml(t("ref.detail.diagnosis_label"), roomSourceStatusText(status.diagnosis));
  if (r.has_value && S.transportUnavailable !== "status") {
    html += descNoteHtml(t("ref.detail.temperature_label"), t("ref.detail.temperature", temperature));
    if (r.has_setpoint)
      html += descNoteHtml(t("ref.detail.setpoint_label"), t("ref.detail.setpoint", setpoint));
    const last = status.key === "stale" && Number.isFinite(r.max_age_s)
      ? t("ref.detail.last_measurement_stale", age, r.max_age_s)
      : t("ref.detail.last_measurement", age);
    html += descNoteHtml(t("ref.detail.last_measurement_label"),
      last + (r.retained ? ` · ${t("ref.retained")}` : ""));
  }
  return html + `<div class="vdesc-p">${esc(t("ref.detail.purpose"))}</div>`;
}

// state + reason -> one plain-language line, its severity class and its explanation. Keyed on the
// STATE first because that is what decides whether anything is being recorded at all; the reason
// only refines it. HOLD/plant_inactive is deliberately neutral, not a warning.
//
// Two of these lines name something OUTSIDE the sampler's own vocabulary, and that is the point:
// a blocked diagnosis is only useful if it says which thing to go and fix.
//  - NOT ARMED means the required room source is not configured. Forecast is deliberately optional:
//    requiring a location would block raw room-error evidence and turn disclosure to a third-party
//    weather service into a prerequisite for a local diagnosis.
//  - ROOM_UNAVAILABLE used to read "room input unavailable" while the source sat green and current
//    two rows below it, which is the opposite of a diagnosis. The room reason (`disabled` — the
//    thermostat is switched off; `stale`; `non_heating_mode`; …) is already on /status and says
//    exactly what is wrong, so it is what gets printed.
//  - SAMPLER_INACTIVE means the device is ARMED — a room source is mapped and a broker is configured
//    — and yet nothing is evaluating it, because the task the sampler lives on was never created.
//    Safe mode, the boot window or a failed MQTT start. "Set up a room source" would send the reader
//    to fix the one thing already done, so this names the real state (safe mode only when it is).
//  - OFF plus a CONFIGURED room source is the other half of the same mistake, and it is not the same
//    state: arming also requires a broker (heating_curve_diagnosis_armed), so clearing the broker
//    disarms a fully-configured room source. The old copy told those users to set up the source they
//    were looking at.
function dynamicStateRow(d, room, weather, modbus, mqtt, sys) {
  if (d.reason === "evaluation_stale")
    return { key: "dyn.state_stale", cls: "", help: "dyn.state_help_stale" };
  if (d.reason === "sampler_inactive") {
    return { key: sys.safe_mode ? "dyn.state_safe_mode" : "dyn.state_inactive",
             cls: "warn", help: "dyn.state_help_inactive" };
  }
  if (d.state === "off" && room.configured && !mqtt.configured)
    return { key: "dyn.state_no_broker", cls: "warn", help: "dyn.state_help_no_broker" };
  if (d.state === "recording")
    return { key: "dyn.state_recording", cls: "ok", help: "dyn.state_help_recording" };
  if (d.state === "degraded")
    return { key: "dyn.state_recording_nowx", cls: "ok", help: "dyn.state_help_recording" };
  if (d.state === "hold" && d.reason === "non_heating_mode")
    return { key: "dyn.state_cooling", cls: "", help: "dyn.state_help_cooling" };
  if (d.state === "hold")
    return { key: "dyn.state_waiting", cls: "", help: "dyn.state_help_waiting" };
  if (d.state === "off" && modbus.searched && !modbus.host)
    return { key: "dyn.state_homehub_disabled", cls: "dim",
             help: "dyn.state_help_homehub_disabled" };
  if (d.state === "off")
    return { key: "dyn.state_setup_room", cls: "dim", help: "dyn.state_help_setup" };
  if (d.reason === "room_unavailable")
    return { key: ROOM_BLOCK_LINES[room.reason] || "dyn.state_room", cls: "warn",
             help: "dyn.state_help_room" };
  if (d.reason === "homehub_unavailable" && !modbus.enabled)
    return { key: "dyn.state_setup_homehub", cls: "dim", help: "dyn.state_help_setup_homehub" };
  const blocked = {
    x10a_unavailable:    "dyn.state_x10a",
    homehub_unavailable: "dyn.state_homehub",
    plant_gate_unknown:  "dyn.state_gate",
    heating_mode_unknown:"dyn.state_mode",
    clock_invalid:       "dyn.state_clock",
  }[d.reason];
  return { key: blocked || "dyn.state_blocked", cls: "warn", help: "dyn.state_help_blocked" };
}

// The OUTDOOR AXIS of the recorded evidence, from the optional ENV III sensor.
//
// The number is the one the DIAGNOSIS holds (/status.heating_curve), never /status.env3 read a
// second time. Those two disagree exactly when it matters: the sensor can be live while the sampler
// is not evaluating at all (safe mode, no broker), and a green reading here beside a blocked state
// row is the same mistake the room-source row above documents — one row on the card looking fine
// while the card's subject is doing nothing. The env3 block is consulted only to tell "no sensor"
// apart from "sensor configured, value not reaching the sampler", which are different findings.
//
// An absent sensor is styled DIM, not warn: the axis is optional and its absence stops no sampling,
// so it must not read as a fault — the same rule that keeps the summer cooling HOLD unstyled.
//
// The FACE names the SOURCE, like every other source row on this card ("Open-Meteo", the room
// source's own name) — not the reading, and not a configuration action. Two reasons, and the second
// is why the row header changed rather than merely losing its pencil:
//  - There is exactly ONE editor for this sensor, the Board Hardware modal on the ESP32 card, where
//    it is saved in one atomic POST /set_board beside the board identity that decides whether the
//    Grove port exists at all. A second door into that modal from a DIAGNOSIS card invited editing
//    hardware from a place that reports evidence, and offered it on a row whose own copy says the
//    value changes nothing about what gets recorded.
//  - A measurement in the face made this the one source row whose header was a reading, so the card
//    showed two outdoor temperatures (this and the forecast) in two different shapes. The reading is
//    not lost: it is stated inside, beside the recorded event's own value, which is where the
//    durable half already lived.
function outdoorAxisRow(d, env) {
  // typeof, NOT Number(): the device sends JSON `null` for every absent figure here, and
  // `Number(null)` is 0, which `Number.isFinite` then accepts. Read that way an unrecorded event
  // prints "0,0 °C" — a real reading invented out of absence, the one thing this row's own copy
  // promises it does not do. undefined happens to be safe (NaN); null is not.
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const live = S.transportUnavailable === "status" ? null : num(d.outdoor_temperature_c);
  const hasLive = live !== null;
  const sample = num(d.last_sample_outdoor_temperature_c);
  const hasSample = sample !== null;
  const hasEvent = num(d.last_sample_room_error_k) !== null;
  const enabled = env.enabled === true;
  // Whether the RECORDER is running at all, which decides who is to blame for a missing value.
  // Clearing the broker disarms the diagnosis while leaving ENV III perfectly healthy, so without
  // this the row would warn about the sensor and send the reader to check hardware that is fine —
  // the same mistake as telling someone to set up the room source sitting one row below.
  const evaluating = d.armed === true && !["sampler_inactive", "evaluation_stale"].includes(d.reason);
  // NO-BREAK SPACE before the unit. Both readings this formats now sit in the tongue, where a lead-in
  // ("Aktueller Messwert") and the number share one wrapping paragraph — so a plain space still puts
  // "22,2" and "°C" on two lines at a phone width, which reads as a layout fault rather than as a
  // measurement.
  const fmt = (n) => `${n.toLocaleString(LANG,
    { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

  // The sensor's product name, untranslated and inline like "Open-Meteo" one row above: it is what
  // the hardware is called in every language, so a translation key would be many spellings of one
  // proper noun waiting to disagree.
  const SENSOR = "ENV III";
  // Precedence states the ACTIONABLE thing: a set-up sensor names itself; an absent one says so;
  // only a running recorder that is not being fed warrants a warning, because only then is the
  // sensor the thing to go and look at. The COLOUR carries the condition the face no longer spells
  // out, and the tongue's status line says it in words.
  let cls = "dim";
  let value = t("dyn.not_configured");
  let statusKey = "dyn.outdoor_status_absent";
  if (hasLive) {
    cls = "ok"; value = SENSOR; statusKey = "dyn.outdoor_status_live";
  } else if (!enabled) {
    statusKey = "dyn.outdoor_status_absent";
  } else if (!evaluating) {
    value = SENSOR; statusKey = "dyn.outdoor_status_idle";
  } else {
    cls = "warn"; value = SENSOR; statusKey = "dyn.outdoor_status_unavailable";
  }

  let body = descNoteHtml(t("dyn.outdoor_detail_status"), t(statusKey, SENSOR));
  // The LIVE reading, which the face used to carry. It says what the axis would record NOW — worth
  // stating, and distinct from the event value below it, which is what a recorded sample actually
  // holds. Only when there IS one: "—" here would be a third way of saying what the status line
  // above has already said in a sentence.
  if (hasLive) body += descNoteHtml(t("dyn.outdoor_detail_now"), fmt(live));
  // What the LAST EVENT actually carries, which is the durable half — the live reading says only
  // what the axis would record now. An event recorded without the axis says so rather than going
  // unmentioned, since that is precisely the gap a later analysis would trip over.
  if (hasSample) body += descNoteHtml(t("dyn.outdoor_detail_sample"), fmt(sample));
  else if (hasEvent) body += descNoteHtml(t("dyn.outdoor_detail_sample"), t("dyn.outdoor_sample_none"));
  body += `<div class="vdesc-p">${esc(t("dyn.outdoor_help_axis"))}</div>`;
  // The placement caveat is not a footnote: the firmware cannot know where the sensor hangs, so
  // whether this number is outdoor air at all is the reader's fact to supply, not the device's.
  body += `<div class="vdesc-p">${esc(t(enabled ? "dyn.outdoor_help_placement"
                                                : "dyn.outdoor_help_setup"))}</div>`;
  // NO action argument: the row is passive, and the Board Hardware modal stays the sensor's one
  // editor. Passing "board" here is what made this row a second door into it.
  return dynamicInfoRow("outdoor", t("dyn.outdoor"), value, cls, body);
}

function outdoorSourceLabel(source) {
  return ({ homehub: "HomeHub", x10a: "X10A", env3: "ENV III" })[source] || "—";
}

// The plant's own axis. It is separate from ENV III on purpose: HomeHub input 44 belongs to the
// heat pump and answers in the same current-cycle sweep as the sampler's plant gates; ENV III is an
// optional accessory whose mounting position the firmware cannot know. Neither value is a gate.
function plantOutdoorAxisRow(d, modbus) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const live = S.transportUnavailable === "status" ? null : num(d.plant_outdoor_temperature_c);
  const sample = num(d.last_sample_plant_outdoor_temperature_c);
  const hasEvent = num(d.last_sample_room_error_k) !== null;
  const liveSource = typeof d.plant_outdoor_source === "string"
    ? d.plant_outdoor_source : null;
  const sampleSource = typeof d.last_sample_plant_outdoor_source === "string"
    ? d.last_sample_plant_outdoor_source : null;
  const source = liveSource || sampleSource || (modbus.enabled ? "homehub" : null);
  const fmt = (n) => `${n.toLocaleString(LANG,
    { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

  const evaluating = d.armed === true && !["sampler_inactive", "evaluation_stale"].includes(d.reason);
  let statusKey = "dyn.outdoor_status_absent";
  if (live !== null) statusKey = "dyn.outdoor_status_live";
  else if (source && evaluating) statusKey = "dyn.outdoor_status_unavailable";
  else if (source) statusKey = "dyn.outdoor_status_idle";

  let body = descNoteHtml(t("dyn.outdoor_detail_status"), t(statusKey, "HomeHub"));
  if (live !== null)
    body += descNoteHtml(t("dyn.outdoor_detail_now"),
      `${fmt(live)} · ${outdoorSourceLabel(liveSource)}`);
  if (sample !== null)
    body += descNoteHtml(t("dyn.outdoor_detail_sample"),
      `${fmt(sample)} · ${outdoorSourceLabel(sampleSource)}`);
  else if (hasEvent)
    body += descNoteHtml(t("dyn.outdoor_detail_sample"), t("dyn.outdoor_sample_none"));
  body += `<div class="vdesc-p">${esc(t("dyn.plant_outdoor_help"))}</div>`;
  return dynamicInfoRow("plant-outdoor", t("dyn.plant_outdoor"),
    source ? outdoorSourceLabel(source) : t("dyn.not_configured"), live !== null ? "ok" : "dim", body);
}

function heatingCurveBinsRow(d) {
  const bins = d.outdoor_bins;
  if (bins === undefined) return ""; // Earlier firmware does not offer this detail.
  const count = n => t("dyn.bins_count", n.toLocaleString(LANG));
  const populated = Number.isSafeInteger(bins?.scope_samples) && bins.scope_samples > 0;
  let body = Number.isFinite(bins?.target_c)
    ? descNoteHtml(t("ref.target"), `${bins.target_c.toLocaleString(LANG, { maximumFractionDigits: 2 })} °C`)
    : "";
  if (!populated) {
    body += descParaHtml(esc(t("dyn.bins_no_scope")));
  } else {
    const bands = ["<0", "0–<5", "5–<10", "≥10"];
    const when = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
    const dated = s => Number.isSafeInteger(s) && s >= 0 && s <= 8.64e12;
    const stats = (n, sum, min, max, unit) => {
      if (![sum, min, max].every(Number.isFinite) || min > max) return t("sys.nodata");
      const fmt = x => `${x.toLocaleString(LANG, { minimumFractionDigits: 1,
        maximumFractionDigits: 1, signDisplay: unit === "K" ? "exceptZero" : "auto" })} ${unit}`;
      return t("dyn.bins_stats", fmt(sum / (n * 10)), fmt(min / 10), fmt(max / 10));
    };
    for (const source of ["homehub", "env3"]) {
      const axis = bins[source];
      const name = outdoorSourceLabel(source);
      let detail = "";
      for (const [i, band] of bands.entries()) {
        const bin = axis?.[i];
        const n = bin?.samples;
        if (!Number.isSafeInteger(n) || n <= 0) continue;
        const first = bin.first_unix_s, last = bin.last_unix_s;
        let period = t("dyn.bins_no_date");
        if (dated(first) && dated(last) && first <= last)
          period = first === last ? when.format(first * 1000)
            : `${when.format(first * 1000)} – ${when.format(last * 1000)}`;
        const room = stats(n, bin.room_sum_tenths, bin.room_min_tenths, bin.room_max_tenths, "K");
        const air = stats(n, bin.outdoor_sum_tenths, bin.outdoor_min_tenths, bin.outdoor_max_tenths, "°C");
        const lines = [[t("dyn.bins_room"), room], [t("dyn.bins_air"), air], [t("dyn.bins_period"), period]];
        detail += descParaHtml(`<span class="vdesc-n">${esc(`${name} · ${band} °C`)}</span> · ${esc(count(n))}` +
          lines.map(([label, value]) => `<br>${esc(label)} · ${esc(value)}`).join(""));
      }
      body += detail || descNoteHtml(name, t("dyn.bins_no_axis"));
    }
  }
  body += descParaHtml(esc(t("dyn.bins_help")));
  return dynamicInfoRow("outdoor-bins", t("dyn.bins"),
    populated ? count(bins.scope_samples) : t("sys.nodata"), populated ? "" : "dim", body);
}

function dynamicControlCardHtml() {
  const r = S.status?.reference_temperature || {};
  const w = S.status?.weather_forecast || {};
  const mqtt = S.status?.mqtt || {};
  const d = S.status?.heating_curve || {};
  const modbus = S.status?.modbus || {};
  // The Firmware master opt-in owns visibility. Once enabled this card remains visible regardless of
  // which individual source is configured, so its own editors are always reachable.
  const sourceStatus = roomSourceStatus(r, mqtt);
  const sourceCls = sourceStatus.cls;
  let temperature = "", setpoint = "", age = "";
  if (r.has_value) {
    temperature = Number(r.temperature_c).toLocaleString(
      LANG, { maximumFractionDigits: 2 });
    if (r.has_setpoint) setpoint = Number(r.setpoint_c).toLocaleString(
      LANG, { maximumFractionDigits: 2 });
    // The firmware sends age_s exactly when it has a trusted age (source time, or a live non-retained
    // arrival). Otherwise (missing, unusable or unsynced source time, or a retained replay) the
    // reading has no known age, and the MQTT arrival clock must not stand in for it.
    const seconds = Number.isFinite(r.age_s) ? r.age_s : null;
    age = Number.isFinite(seconds) ? (seconds < 2 ? t("ref.now") : t("ref.ago", seconds))
      : t("ref.age_unknown");
  }
  // The STATE, not an imaginary operating mode. What a reader needs is why no sample exists yet;
  // through the summer the honest answer ("the plant is not heating") must NOT be styled as a fault,
  // because it is the expected state for months.
  const st = dynamicStateRow(d, r, w, modbus, mqtt, S.status?.sys || {});
  // The state tongue carries WHAT THIS IS before what it is doing. That paragraph used to hang off
  // the Firmware switch, which is where a reader met the feature first; with the switch gone the
  // first row of its own card is that place, and a card whose title is the only thing explaining it
  // would leave the short method label as the sole account of what is being recorded.
  let rows = dynamicInfoRow("state", t("dyn.state"), t(st.key), st.cls,
    `<div class="vdesc-p">${esc(t("dyn.card_help"))}</div>` +
    `<div class="vdesc-p">${esc(t(st.help))}</div>`);
  // The row header IDENTIFIES the source, exactly as the circulation row does. "Configured" merely
  // repeated that a form had been saved; the unconfigured row already says so on its face and its
  // tongue gives the only useful follow-up: where to add one.
  const sourceValue = r.configured ? roomSourceName(r) : t("dyn.not_configured");
  const sourceBody = roomSourceDetailHtml(r, sourceStatus, temperature, setpoint, age);
  rows += dynamicInfoRow("room-sources", t("dyn.room_source"), sourceValue, sourceCls,
    sourceBody, "ref-temp", t("ref.title"),
    r.configured ? roomSourceAccessibleStatus(sourceStatus) : "");
  let weatherCls = "dim";
  let outdoor = "", solar = "";
  if (w.configured && w.has_value) {
    outdoor = Number(w.outdoor_mean_2h_c).toLocaleString(
      LANG, { maximumFractionDigits: 1 });
    solar = Number(w.solar_energy_2h_wh_m2).toLocaleString(
      LANG, { maximumFractionDigits: 0 });
  }
  if (w.configured && w.fetching) weatherCls = "warn";
  else if (w.configured && w.has_value && S.transportUnavailable !== "status") {
    if (w.fresh) weatherCls = "ok";
    else weatherCls = w.error ? "err" : "warn";
  } else if (w.configured) weatherCls = w.error ? "err" : "warn";
  const weatherValue = w.configured ? "Open-Meteo" : t("dyn.not_configured");
  const weatherBody = (w.configured ? weatherSourceDetailHtml(w, outdoor, solar) : "") +
    `<div class="vdesc-p">${esc(t(w.configured ? "wx.hint.configured" : "wx.hint.setup"))}</div>`;
  rows += dynamicInfoRow("weather", t("dyn.weather"), weatherValue, weatherCls,
    weatherBody, "weather", t("wx.title"));

  // Plant and accessory axes stay separate and name their sources. Input 44 is the plant reading;
  // ENV III remains a second, placement-dependent comparison and is never silently replaced.
  rows += plantOutdoorAxisRow(d, modbus);
  rows += outdoorAxisRow(d, S.status?.env3 || {});
  rows += heatingCurveBinsRow(d);

  rows += dynamicInfoRow("strategy", t("dyn.strategy"), t("dyn.shadow_strategy"), "",
    `<div class="vdesc-p">${esc(t("dyn.strategy_help"))}</div>`);
  // No "Safety & output → read-only" row. It was a hardcoded constant that could never say anything
  // else, and since the write path was deleted (legacy-294) it can never BECOME anything else either —
  // the same reason bus_tx_writes was dropped from the heartbeat. The card's own copy carries it.
  if (r.error) rows += vrow(t("ref.error"), r.error, { cls: "err settings-wrap" });
  if (w.error) rows += vrow(t("wx.error"), w.error, { cls: "err settings-wrap" });
  return vcard(t("dyn.card"), rows);
}

// How long the board has been up (/status.uptime_s — seconds since boot, esp_timer). TWO units at
// most, coarsest first: at three days nobody is reading the minutes, and a figure that reshuffles
// every second is a clock, not a diagnostic. The unit symbols are SI and identical in both
// languages, so this needs no translation table of its own — checkupDuration() already prints "min"
// and "h" untranslated for the same reason. Deliberately NOT the heartbeat's own uptime string
// (logic/heartbeat.hpp's format_uptime, "Ddd+HH:MM:SS.mmm"): that one is read by Home Assistant and
// sorts/parses as a fixed field, this one is read by a person standing in front of the board.
//
// It sits directly ABOVE the two memory rows because it is what makes them readable: both curves
// live in RAM and start over at a reboot, so a heap line that begins mid-chart is explained by the
// row above it rather than looking like data loss. And it is the one board fact that answers "did
// this thing restart while I wasn't looking" without opening /diag — the crash banner only appears
// when the reboot was a FAULT, and a config save, an OTA or a power cut leave no banner at all.
function fmtUptime(s) {
  if (typeof s !== "number" || !(s >= 0)) return "—";
  if (s < 60) return `${Math.floor(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const uptimeRow = (s) => vrow(t("card.uptime"), fmtUptime(s), { cls: "mono num" });

// Bytes as whole KiB — the same unit the firmware's own trend stores (logic/history.hpp), so the row
// and the chart under it cannot disagree about what the number is. Whole KiB avoids fractional
// noise on each `/status` refresh.
const fmtKiB = (b) => (b == null ? "—" : `${Math.round(b / 1024)} KiB`);

// The board's own memory: free heap and the largest CONTIGUOUS free block. These two are back on the
// card after legacy-186 dropped them, and the reason they are worth their space now is the reason they
// were not then: each carries a 24-HOUR TREND. As spot numbers they were a diagnosis nobody could
// make — "148 KiB" says nothing without the last day of it — and a diagnosis is what the /status
// endpoint and the MQTT heartbeat are for. As curves they answer the one memory question this
// firmware actually has: is it DRIFTING? A leak shows as a slope; fragmentation shows as the two
// lines separating, free heap holding while the largest block sinks. Nothing else in the UI can say
// that, and it is the failure mode the "Memory, concurrency, and HTTP safety" section of AGENTS.md
// is about.
//
// Both rows are expandable exactly like a value row — same accordion, same chart, same scrub and pin
// — and attach their series by TREND ID, since the row labels here are translated and there is no
// catalog label to match on.
const boardHistoryMarkup = new WeakMap();
function boardHistoryHtml(id, unit, label) {
  const ring = S.hist.get(id);
  if (!ring) return histHtml(id, unit, label, "x10a");
  const revision = historyRingRevision(ring);
  const pin = S.histPin.get(id);
  const cached = boardHistoryMarkup.get(ring);
  if (cached?.id === id && cached.epoch === S.histEpoch && cached.lang === LANG &&
      cached.pin === pin && cached.revision === revision)
    return cached.html;
  const html = histHtml(id, unit, label, "x10a");
  boardHistoryMarkup.set(ring, { id, epoch: S.histEpoch, lang: LANG, pin, revision, html });
  return html;
}

function memoryRows(sys) {
  const row = (id, labelKey, bytes) => {
    const label = t(labelKey);
    const d = MODEL_DESCRIPTIONS[id];
    const hid = hasHist(id) ? id : "";      // absent on firmware that predates the trend
    const val = esc(fmtKiB(bytes));
    if (!hid && !d) return vrow(label, fmtKiB(bytes), { cls: "mono num" });
    return descAccordion(`board:${id}`, label, val, "mono num",
                         d ? descBodyHtml(d, undefined, modelDescriptionCopy(id)) : "", hid, "KiB",
                         S.stage === "dashboard" || undefined, boardHistoryHtml);
  };
  return row("free_heap", "card.freeheap", sys.free_heap) +
         row("max_alloc", "card.maxalloc", sys.max_alloc);
}

const boardLedPhases = ["off", "setup", "connecting", "healthy", "bus_down", "mqtt_down", "wipe_armed", "wiping"];
const boardLedRgbSwatches = ["led-off", "led-blue", "led-yellow", "led-green", "led-red", "led-orange", "led-red", "led-white"];

// Render the legend for the SAVED LED backend in the explanation tongue. The editor deliberately
// contains controls only; its unsaved selection must not replace the meaning of the active hardware.
// No configured LED means no legend, matching the explicit "None" selection in the editor. The
// points stay static: colour helps scanning, while the adjacent text carries the complete pattern.
function boardLedLegend(b) {
  if (b.led_gpio == null || b.led_gpio < 0) return "";
  const kind = b.led_type === 1 ? "rgb" : "gpio";
  const swatches = kind === "rgb" ? boardLedRgbSwatches : boardLedPhases.map((phase) => phase === "off" ? "led-off" : "led-plain");
  const rows = boardLedPhases.map((phase, index) =>
    `<li><span class="led-swatch ${swatches[index]}" aria-hidden="true"></span>` +
    `<span>${esc(t(`board.led_${kind}_${phase}`))}</span></li>`).join("");
  return `<div class="hardware-led-legend"><div class="led-legend-title">` +
    `${esc(t(kind === "rgb" ? "board.ledlegend_rgb" : "board.ledlegend_gpio"))}</div>` +
    `<ul class="led-pattern-list">${rows}</ul></div>`;
}

function boardHardwareSection(kind, title, detail, help = "") {
  return `<section class="hardware-detail-section hardware-${kind}-section">` +
    `<div class="hardware-detail-title">${esc(title)}</div>` +
    `<div class="vdesc-p">${esc(detail)}</div>${help}</section>`;
}

// The board's own onboard parts — status indicator + recovery button — as ONE summary row with TWO
// explicit actions. "Hardware" on the left expands the explanation tongue; the selected board name
// on the right opens the editor. Keeping those actions in separate buttons avoids one
// tap both explaining and editing, while S.descOpen preserves the tongue across values-poll renders.
function boardRow() {
  const b = S.status?.board || {};
  const env = S.status?.env3 || {};
  const board = b.preset_name || (b.user_set ? t("board.preset_custom") : t("board.not_selected"));
  const boardDetail = b.preset_id === "m5stack_atoms3_lite" ? t("card.hw_board_m5stack")
    : b.preset_id === "seeed_xiao_esp32s3" ? t("card.hw_board_seeed")
    : t("card.hw_board_other", board);
  const active = b.led_inverted ? t("card.hw_active_low") : t("card.hw_active_high");
  const ledDetail = b.led_gpio == null || b.led_gpio < 0 ? t("card.hw_led_disabled")
    : t("card.hw_led_detail", b.led_type === 1 ? "WS2812" : "LED", b.led_gpio,
        b.led_type === 1 ? "" : active);
  const btnActive = b.btn_active_low === false ? t("card.hw_active_high") : t("card.hw_active_low");
  const btnDetail = b.btn_gpio == null || b.btn_gpio < 0 ? t("card.hw_btn_disabled")
    : t("card.hw_btn_detail", b.btn_gpio, btnActive);
  const envDetail = !env.supported ? "" : env.enabled
    ? t("card.hw_env_detail", env.sda ?? "—", env.scl ?? "—") : t("card.hw_env_disabled");
  const detail = `<div class="vdesc-p">${esc(boardDetail)}</div>` +
    boardHardwareSection("led", t("board.ledtype"), ledDetail, boardLedLegend(b)) +
    boardHardwareSection("reset", t("board.reset_section"), btnDetail,
      `<div class="hardware-detail-help vdesc-p">${esc(t("board.hint"))}</div>`) +
    (env.supported ? boardHardwareSection("env3", t("board.env3_section"), envDetail,
      `<div class="hardware-detail-help vdesc-p">${esc(t("env.pins_hint"))}</div>`) : "");
  const key = "board:hardware";
  const open = S.descOpen?.has(key) === true;
  return `<div class="vitem${open ? " open" : ""} hardware-item">` +
    `<div class="vrow hardware-row settings-split-row">` +
    `<button class="hardware-info-toggle settings-split-info" type="button" data-desc="${key}" ` +
    `aria-expanded="${open ? "true" : "false"}" aria-controls="board-hardware-detail">` +
    `<span class="vrow-label">${esc(t("card.hardware"))}</span>${settingsChevIcon}</button>` +
    `<button class="hardware-config-open settings-split-action vrow-val settings-wrap" type="button" data-act="board" ` +
    `aria-label="${esc(`${t("board.title")}: ${board}`)}">` +
    `<span>${esc(board)}</span>${editIcon}</button></div>` +
    `<div class="vdesc"><div class="vdesc-inner"><div class="vdesc-body board-hardware-tongue" ` +
    `id="board-hardware-detail">${detail}</div></div></div></div>`;
}

// Every family name in def/model_names.hpp starts with "Altherma ", and the Model card's own heading
// already says the brand — dropping the prefix is what lets four families share one row ("3 M · 3 H ·
// 3 R · LT / older") instead of wrapping into three lines of repeated words.
const shortFamily = (f) => String(f).replace(/^Altherma\s+/, "");

// The dashboard's Model card, from /status.detect (the detected unit). The ESP32 card that used to
// sit above it is on the Settings screen now (renderSettings), as are the WiFi/MQTT/Syslog/NTP rows
// (connectionsHtml) — what the plant IS stays on the dashboard, what the board is SET TO moved.
function statusCardsHtml() {
  const hp = S.status?.hp || {}, d = S.status?.detect || {};
  // Outdoor unit as a full-width heading — model names are long and don't fit a label→value row.
  // The X10A link + protocol live on the Protocol card (they're about the board's bus), not here.
  // Identity is bus-derived: the model name degrades to the brand offline (hpModelName), and capacity
  // (from the cached fingerprint) is shown ONLY while connected — never a stale value read as live.
  // No "Detection: auto/manual" row: detection is fully automatic, an internal detail.
  let model = `<div class="vname">${esc(hpModelName())}</div>`;
  // Capacity: the OUTDOOR unit's own report when it makes one, else the INDOOR unit's rated code
  // under its OWN label. Never merged into one row and never silently substituted — the two halves
  // of a plant are routinely different sizes (a 6 kW outdoor unit under an 8 kW indoor unit is an
  // ordinary pairing), so an unlabelled fallback would state a figure for the wrong unit. The
  // fallback matters because a unit whose 0x00 descriptor is too short to carry offset 12 never
  // reports an O/U capacity at all, and this card then showed no capacity whatsoever.
  if (hp.connected && d.capacity_kw != null)
    model += modelDescRow("capacity", t("card.capacity"), String(d.capacity_kw), { unit: "kW" });
  else if (hp.connected && d.capacity_kw_iu != null)
    model += modelDescRow("capacity_iu", t("card.capacity_iu"), String(d.capacity_kw_iu), { unit: "kW" });
  // Why the heading says only "Daikin Altherma": several register-identical profiles from DIFFERENT
  // marketing families fit this unit equally well, so no single name can honestly be asserted
  // (hpModelName). Naming the families that remain turns a card reading like a FAILED detection into
  // what it actually is — one that succeeded as far as the bus permits. Shown only while the name is
  // withheld; a unique identification needs no list of what it isn't.
  const fams = d.families || [];
  // Which explainer is TRUE here depends on capacity_kw: it is null exactly when the outdoor unit's
  // 0x00 descriptor carried no capacity (http_status kw_field), which is exactly the case in which
  // logic/detect.hpp says the candidate set spans kW classes and the pick DOES affect the values.
  if (hp.connected && d.valid && fams.length > 1)
    model += modelDescRow(d.capacity_kw != null ? "candidates" : "candidates_nocap",
                          t("card.candidates"), fams.map(shortFamily).join(" · "));
  // The O/U EEPROM digits are the one identifier that CAN settle it — against the nameplate, by a
  // person. Deliberately not decoded to a name (no digit→name table exists anywhere in the repo), so
  // they are shown verbatim, monospaced, to be compared character by character.
  if (hp.connected && d.valid && d.ou_eeprom)
    model += modelDescRow("oueeprom", t("card.oueeprom"), d.ou_eeprom, { cls: "mono" });

  // Model identity is only meaningful while the bus answers — hide the card entirely when the
  // heat-pump link is down instead of naming a unit (or showing a stale capacity) that isn't live.
  return hp.connected ? vcard(t("card.model"), model, "", "", "model") : "";
}

// ── The diagnosis card — "is anything worth reporting?" (logic/checkup.hpp, legacy-208/legacy-349) ─────────
// The dashboard already answers what the plant is doing NOW (the schematic) and what one reading did
// today (a value row's trend). This is the third question, and the only one that needs counting
// rather than reading: how often the compressor started, what share of runtime went into defrosting,
// how low the water pressure got. The firmware does all of it — every verdict, every threshold and
// every coverage decision arrives in /status.health, judged. Nothing is re-decided here.
//
// That split is deliberate and load-bearing. The rules live in a host-tested C++ header that CI gates
// against the whole profile catalog; a browser-side threshold would be a second, ungated definition
// of the same judgement, which is precisely how lwt_select's rule came to be re-opened by a looser
// copy of itself. The browser's job is words and colour.
//
// Rendered in the order received: logic/checkup.hpp declares the checks in reading order, so there is
// no second opinion here about which row matters most.
const CHECKUP_ROW = {
  fault:    "check.fault",
  dhw_loss: "check.dhw_loss",
  cycling:  "check.cycling",
  defrost:  "check.defrost",
  pressure: "check.pressure",
  flow:     "check.flow",
  heater:   "check.heater",
  retries:  "check.retries",
};
// Verdict → colour for the compact readings. The expanded row carries the full assessment.
const CHECKUP_TONE = { warn: "err", info: "warn", ok: "ok", collecting: "dim",
                       observation: "dim", experimental: "dim", unavailable: "dim" };

function checkupDuration(s) {
  const seconds = Number(s);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function checkupCyclingShortRunCount(c) {
  const rec = c?.timeline?.records;
  if (c?.timeline?.run_edges !== true || !Array.isArray(rec)) return 0;
  const ctxByStart = new Map();
  if (Array.isArray(c.run_contexts)) {
    for (const rc of c.run_contexts) ctxByStart.set(rc.at, rc);
  }
  let shortN = 0, run = null;
  for (const r of rec) {
    const at = r >>> 3, k = r & 7;
    if (k === 5) {
      run = { start: at, mode: ctxByStart.get(at)?.mode || null };
    } else if (k === 6) {
      if (run && run.mode === "space" && at >= run.start && at - run.start < 300) shortN++;
      run = null;
    } else if (k === 0) {
      run = null;
    } else if (run && !ctxByStart.has(run.start)) {
      if (k === 3) run.mode = "space";
      else if (k === 2 || k === 4) run.mode = "other";
    }
  }
  return shortN;
}

function checkupCyclingDetailHtml(c, report) {
  const starts = checkupMetricValue(c);
  const count = n => Number.isInteger(n) && n >= 0;
  const shortHeat = checkupCyclingShortRunCount(c);
  const runs = [
    ["mode.heat", c.space_runs, c.space_mean_run_s, shortHeat],
    ["mode.dhw", c.dhw_runs, c.dhw_mean_run_s, 0],
    ["mode.cool", c.cooling_runs > 0 ? c.cooling_runs : null, null, 0],
    ["check.cycling.unclear", c.censored_runs > 0 ? c.censored_runs : null, null, 0],
  ];
  const rows = c.verdict === "unavailable" ? "" : runs.filter(([, n]) => count(n))
    .map(([label, n, mean, shortN]) => {
      let value = t("check.cycling.runs", n) + (n > 0 && Number.isFinite(mean) && mean >= 0
        ? ` · ${t("check.cycling.mean", checkupDuration(mean))}` : "");
      if (shortN > 0) value += ` · ${t("check.cycling.short_runs", shortN)}`;
      return `<div class="inspect-row"><span>${esc(t(label))}</span><span>${esc(value)}</span></div>`;
    }).join("");
  let assessment = "waiting";
  if (c.verdict === "unavailable") assessment = "unavailable";
  else if (c.evidence === "heuristic" && c.verdict === "info") assessment = "short";
  else if (c.reason === "class_unavailable") assessment = "class_unavailable";
  else if (report.source_fresh === false || c.reason === "source_stale") assessment = "stale";
  else if (c.evidence === "heuristic" && c.verdict === "ok") assessment = "normal";
  else if (c.reason === "heating_runs_insufficient" && starts) assessment = "few";

  const description = MODEL_DESCRIPTIONS.health_cycling;
  const [what] = modelDescriptionCopy("health_cycling") || [description.what];
  const saved = Array.isArray(c.hours) ? c.hours.reduce((sum, h) => sum +
    (h?.restored && !h.expired && count(h.starts) ? h.starts : 0), 0) : 0;
  const detail = [t(`check.cycling.${assessment}`)];
  if (starts && saved > 0 && saved <= c.starts)
    detail.push(t("check.cycling.saved_starts", t("check.starts", saved)));
  else {
    detail.push(what);
    if (rows && c.censored_runs > 0) detail.push(t("check.cycling.unclear_hint"));
  }

  return `<div class="vdesc-p checkup-cycling-total"><span class="vdesc-n">${esc(starts || checkupStatusText(c))}</span></div>` +
    `<div class="vdesc-p checkup-cycling-assessment">${esc(detail.join(" "))}</div>` +
    (rows ? `<div class="vdesc-p">${esc(t("check.cycling.completed"))}</div>` +
      `<div class="inspect-rows checkup-cycling-grid">${rows}</div>` : "") +
    `<div data-checkup-hours></div>`;
}

function syncCheckupCyclingChart(card) {
  if (S.stage !== "dashboard" || S.scrub || card?.dataset.dashboardCard !== "diagnosis" ||
      !S.descOpen.has("model:health_cycling")) return;
  const slot = card.querySelector(".vitem.open [data-checkup-hours]");
  if (slot) renderCheckupCyclingChart(slot);
}

function renderCheckupCyclingChart(slot, open = true) {
  const check = open && S.status?.health?.checks?.find(c => c.id === "cycling");
  const html = open ? checkupCyclingChartHtml(check) : "";
  if (slot._checkupMarkup !== html) {
    replaceHistoryHtml(slot, html);
    slot._checkupMarkup = html;
  } else if (typeof paintCyclingChart === "function") {
    const chart = slot.querySelector("[data-cycling]");
    if (chart) paintCyclingChart(chart);
  }
  const trace = check?.timeline;
  // Both device timestamps are rounded down. Use the upper bound on the sample age.
  const age = historyClock() - cyclingStatusAt + 1000 * (trace?.window_end_s - trace?.observed_end_s + 1);
  if (trace?.live === false || S.otaCached || S.transportUnavailable === "status" ||
      !(age >= 0 && age < CYCLING_FRESH_MS)) markCyclingStale();
  else {
    $("valueGroups").setAttribute("data-cycling-stale", "false");
    clearTimeout(cyclingExpiry);
    cyclingExpiry = setTimeout(markCyclingStale, CYCLING_FRESH_MS - age);
  }
}

let cyclingMarkup = [];
let cyclingTrace;

function checkupCyclingDuration(s) {
  return s >= 60 && s % 60
    ? t("check.min", `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`) : dwellDuration(s);
}

function checkupCyclingRunsHtml(runs, wall) {
  const clockOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  const clock = new Intl.DateTimeFormat(LANG, clockOptions);
  const heads = ["start", "stop", "duration"].map(key => `<th scope="col">${esc(t(`check.cycling.run_${key}`))}</th>`);
  const rows = runs.map(({ start, stop, latest }) => {
    const from = new Date(wall(start)), to = stop == null ? null : new Date(wall(stop));
    const date = to && from.toDateString() !== to.toDateString();
    const offset = to && from.getTimezoneOffset() !== to.getTimezoneOffset();
    const stamp = date || offset ? new Intl.DateTimeFormat(LANG, {
      ...clockOptions,
      ...(date && { month: "short", day: "numeric" }),
      ...(offset && { timeZoneName: "shortOffset" }),
    }) : clock;
    const time = value => `<time datetime="${value.toISOString()}">${esc(stamp.format(value))}</time>`;
    const unknown = esc(t("check.cycling.run_stop_unknown"));
    const ongoing = (live, stale) => `<span class="checkup-run-live">${live}</span><span class="checkup-run-stale">${stale}</span>`;
    const end = to ? time(to) : latest == null ? unknown : ongoing(esc(t("check.cycling.run_ongoing")), unknown);
    const duration = ended => esc(checkupCyclingDuration(ended - start));
    const elapsed = to ? duration(stop) : latest == null ? "—" : ongoing(duration(latest), "—");
    return `<tr><td>${time(from)}</td><td>${end}</td><td>${elapsed}</td></tr>`;
  });
  return `<table class="checkup-run-table"><thead><tr>${heads.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// These are visual categories filled bottom-to-top proportionally across active + unknown segments
// within an hour. Readable off-time adds no colour.
const CHECKUP_CYCLING_MODES = [
  ["space", "mode.heat", "--flow-hot"],
  ["dhw", "mode.dhw", "--brand"],
  ["other", "check.fault_unknown", "--muted"],
];
const _cyclingModels = new Map();
let cyclingModelRev = 0;

function checkupCyclingFillHtml(segments) {
  const merged = [];
  for (const s of segments || []) {
    if (!s || !(s.dur > 0)) continue;
    const prev = merged.at(-1);
    if (prev && prev.cat === s.cat) prev.dur += s.dur;
    else merged.push({ cat: s.cat, dur: s.dur });
  }
  const total = merged.reduce((sum, s) => sum + s.dur, 0);
  if (total <= 0) return `<s class="checkup-chart-fill" aria-hidden="true" data-modes=""></s>`;
  const colorMap = Object.fromEntries(CHECKUP_CYCLING_MODES.map(([m, , c]) => [m, `var(${c})`]));
  const present = CHECKUP_CYCLING_MODES.filter(([m]) => merged.some(s => s.cat === m));
  const modesAttr = present.map(([m]) => m).join(" ");
  if (present.length === 1) {
    return `<s class="checkup-chart-fill" aria-hidden="true" data-modes="${modesAttr}" style="--cycling-a:${colorMap[present[0][0]]}"></s>`;
  }
  let acc = 0;
  const stops = [];
  for (const seg of merged) {
    const p0 = (acc / total * 100).toFixed(2);
    acc += seg.dur;
    const p1 = (acc / total * 100).toFixed(2);
    const col = colorMap[seg.cat] || colorMap.other;
    stops.push(`${col} ${p0}%`, `${col} ${p1}%`);
  }
  return `<s class="checkup-chart-fill segmented" aria-hidden="true" data-modes="${modesAttr}" style="--cycling-fill:linear-gradient(to top, ${stops.join(", ")})"></s>`;
}
function checkupCyclingLegendHtml() {
  return CHECKUP_CYCLING_MODES.map(([mode, label]) =>
    `<span class="checkup-chart-key"><i class="${mode}" aria-hidden="true"></i>${esc(t(label))}</span>`).join("");
}

function cyclingRichText(fn, ...items) {
  const tokens = items.map((item, idx) => `\u0003${idx}\u0004`);
  let out = esc(fn(...tokens));
  items.forEach((item, idx) => {
    const ph = `\u0003${idx}\u0004`;
    const repl = item && typeof item === "object" && "raw" in item
      ? item.raw : `<strong>${esc(item == null ? "" : String(item))}</strong>`;
    out = out.replaceAll(ph, repl);
  });
  return out;
}

function cyclingIsLowFlow(ctx, flowTypical) {
  return Number.isFinite(ctx?.flow_l_min) && Number.isFinite(flowTypical) &&
    flowTypical > 0 && ctx.flow_l_min <= flowTypical * 0.65;
}

const CYCLING_STOP_KEYS = {
  request_withdrawal: "stop_req_off",
  target_changed: "stop_tgt_drop",
  dhw_transition: "stop_dhw",
};
function cyclingStopSummaryText(r, flowTypical) {
  const ctx = r.ctx;
  const mode = ctx?.mode || r.mode || "space";
  if (!ctx) return null;
  if (!ctx.stop_kind) return null;
  if (ctx.stop_kind === "low_rps_above_target") {
    return t(cyclingIsLowFlow(ctx, flowTypical) ? "check.cycling.stop_low_flow" : "check.cycling.stop_low_rps");
  }
  if (ctx.stop_kind === "defrost") return t(mode === "other" ? "check.cycling.stop_defrost_done" : "check.cycling.stop_defrost");
  if (ctx.stop_kind === "normal") return t(mode === "dhw" ? "check.cycling.stop_normal_dhw" : "check.cycling.stop_normal");
  const k = CYCLING_STOP_KEYS[ctx.stop_kind];
  return t(k ? `check.cycling.${k}` : "check.cycling.run_stop_unknown");
}

function collectPeriodRuns(model, from, to) {
  const runs = [];
  for (let i = from; i <= to; ++i) {
    for (const r of model.hours[i].runs) {
      runs.push({ ...r, ctx: model.runContextByStart.get(r.start) || null });
    }
  }
  return runs.sort((a, b) => a.start - b.start);
}

function cyclingPeriodFindingHtml(model, from, to) {
  const runs = collectPeriodRuns(model, from, to);
  const startsTotal = model.hours.slice(from, to + 1).reduce((s, h) => s + h.starts.length, 0);
  if (!runs.length && startsTotal === 0) return esc(t("check.cycling.no_timed_runs"));
  if (!runs.length) return esc(t("check.cycling.run_details_unavailable"));

  const heating = runs.filter(r => (r.ctx?.mode || r.mode) === "space");
  const completedHeat = heating.filter(r => r.stop != null);
  const shortHeat = completedHeat.filter(r => (r.stop - r.start) < 600).length;
  const isCycling = model.hours.slice(from, to + 1).some(h => h.isCycling) || shortHeat >= 2;

  let lowRps = 0, reqOff = 0, tgtDrop = 0, defrost = 0, dhwTrans = 0;
  for (const r of runs) {
    const sk = r.ctx?.stop_kind;
    if (sk === "low_rps_above_target") ++lowRps;
    else if (sk === "request_withdrawal") ++reqOff;
    else if (sk === "target_changed") ++tgtDrop;
    else if (sk === "defrost" || r.ctx?.start_kind === "defrost_start") ++defrost;
    else if (sk === "dhw_transition") ++dhwTrans;
  }

  const outVals = runs.map(r => r.ctx?.outdoor_c).filter(Number.isFinite);
  const outdoorMean = outVals.length
    ? outVals.reduce((a, b) => a + b, 0) / outVals.length
    : (Number.isFinite(model.outdoorMean) ? model.outdoorMean : null);
  const outCond = outdoorMean != null ? t("check.cycling.out_cond", `${histFmt1(outdoorMean)} °C`) : "";

  const flowVals = completedHeat.map(r => r.ctx?.flow_l_min).filter(v => Number.isFinite(v) && v > 0);
  const minFlow = flowVals.length ? Math.min(...flowVals) : null;
  const meanFlow = flowVals.length ? flowVals.reduce((a, b) => a + b, 0) / flowVals.length : null;
  const typ = model.flowTypical;
  const lowFlow = minFlow != null && typ != null && typ > 0 && minFlow <= typ * 0.65;

  const fmtFind = (key, ...args) => {
    const raw = String(t(key, ...args));
    const colon = raw.search(/[:：]/);
    if (colon > 0 && colon < 72) {
      return `<span class="vdesc-n">${esc(raw.slice(0, colon + 1))}</span>${esc(raw.slice(colon + 1))}`;
    }
    return esc(raw);
  };

  if (isCycling && lowRps >= 2 && lowFlow) {
    const typTag = typ != null ? t("check.cycling.typ_tag", `~${histFmt1(typ)} L/min`) : "";
    return fmtFind("check.cycling.find_low_flow", `${histFmt1(minFlow)} L/min`, typTag);
  }
  if (isCycling && lowRps >= 2) {
    const flowStr = meanFlow != null ? `${histFmt1(meanFlow)} L/min` : t("check.fault_unknown");
    return fmtFind("check.cycling.find_low_rps", flowStr, outCond);
  }
  if (isCycling && reqOff + tgtDrop >= 2) return fmtFind("check.cycling.find_control");
  if (defrost > 0 && dhwTrans > 0) return fmtFind("check.cycling.find_defrost_dhw", outCond);
  if (defrost > 0) return fmtFind("check.cycling.find_defrost", outCond);
  if (dhwTrans > 0) return fmtFind("check.cycling.find_dhw");
  const meanHeatS = completedHeat.length
    ? completedHeat.reduce((s, r) => s + (r.stop - r.start), 0) / completedHeat.length : 0;
  if (completedHeat.length > 0 && meanHeatS >= 600) {
    return fmtFind("check.cycling.find_steady", minFlow != null ? `${histFmt1(minFlow)} L/min` : "");
  }
  return esc(t("check.starts", startsTotal));
}

function cyclingRunExplainHtml(r, fromExact, toExact, priorPauseS, flowTypical) {
  const ctx = r.ctx;
  const rich = (k, ...a) => cyclingRichText(I18N[LANG]?.[`check.cycling.${k}`] || I18N.en[`check.cycling.${k}`], ...a);
  const f1 = (v, u) => Number.isFinite(v) ? `${histFmt1(v)} ${u}` : null;
  const pauseStr = priorPauseS != null && priorPauseS >= 0 && priorPauseS <= 7200
    ? t("check.cycling.pause_tag", priorPauseS < 1800 ? checkupCyclingDuration(priorPauseS) : checkupDuration(priorPauseS))
    : "";
  const lwt = f1(ctx.lwt_c, "°C"), tgt = f1(ctx.target_c, "°C"), rwt = f1(ctx.rwt_c, "°C");
  const flow = f1(ctx.flow_l_min, "L/min");
  const typ = Number.isFinite(flowTypical) && flowTypical > 0 ? `${histFmt1(flowTypical)} L/min` : null;
  const sep = LANG === "ja" ? "、" : LANG === "zh" ? "，" : ", ";
  const startLwt = f1(ctx.start_lwt_c, "°C");
  const startTgt = f1(ctx.start_target_c, "°C") || tgt || null;
  const startPrev = f1(ctx.start_target_prev_c, "°C");
  const startCond = startLwt ? t("check.cycling.cond_tag", startLwt, startTgt || "") : "";
  const startLwtOnly = startLwt ? t("check.cycling.cond_tag", startLwt, "") : "";
  const pauseItem = { raw: esc(pauseStr) };
  const startCondItem = { raw: startCond ? esc(` · ${startCond}`) : "" };
  const fromPrevItem = { raw: startPrev ? esc(t("check.cycling.from_tag", startPrev)) : "" };
  const startOpt = { raw: startLwtOnly ? esc(` · ${startLwtOnly}`) : "" };

  let startHtml;
  switch (ctx.start_kind) {
    case "cooldown_restart": startHtml = rich("s_cool", fromExact, pauseItem, startLwt || "—", startTgt || "—"); break;
    case "request_on": startHtml = rich("s_req", fromExact, pauseItem, startCondItem); break;
    case "target_raised": startHtml = rich("s_tgt", fromExact, pauseItem, fromPrevItem, startTgt || "—", startOpt); break;
    case "after_defrost": startHtml = rich("s_defrost_after", fromExact, pauseItem, startCondItem); break;
    case "after_dhw": startHtml = rich("s_dhw_after", fromExact, pauseItem, startCondItem); break;
    case "defrost_start": startHtml = rich("s_defrost", fromExact, pauseItem); break;
    case "dhw_start": startHtml = rich("s_dhw", fromExact, pauseItem, startOpt); break;
    default: startHtml = rich("s_gen", fromExact, pauseItem, startCondItem); break;
  }

  if (!ctx.stop_kind) {
    if (r.latest == null) return `${startHtml} ${esc(t("check.cycling.run_stop_unknown"))}`;
    return `${startHtml} <span class="checkup-run-live">${esc(t("check.cycling.e_ongoing"))}</span>` +
      `<span class="checkup-run-stale">${esc(t("check.cycling.run_stop_unknown"))}</span>`;
  }

  const stopTemp = lwt
    ? t("check.cycling.cond_tag", lwt, ctx.stop_kind === "target_changed" ? "" : (tgt || ""))
    : null;
  const metricParts = [stopTemp, rwt && t("check.cycling.rwt_tag", rwt), flow].filter(Boolean);
  const valsItem = { raw: metricParts.length ? esc(` · ${metricParts.join(sep)}`) : "" };
  const rwtItem = { raw: rwt ? esc(`${sep}${t("check.cycling.rwt_tag", rwt)}`) : "" };
  const typItem = { raw: typ ? esc(t("check.cycling.typ_tag", `~${typ}`)) : "" };
  const prevItem = { raw: Number.isFinite(ctx.target_prev_c) ? esc(t("check.cycling.from_tag", `${histFmt1(ctx.target_prev_c)} °C`)) : "" };

  let stopHtml;
  switch (ctx.stop_kind) {
    case "low_rps_above_target":
      stopHtml = cyclingIsLowFlow(ctx, flowTypical)
        ? rich("e_low_flow", toExact, lwt || "—", tgt || "—", rwtItem, flow || "—", typItem)
        : rich("e_low_rps", toExact, lwt || "—", tgt || "—", rwtItem, flow || "—", Number.isFinite(ctx.min_rps) && ctx.min_rps > 0 ? `${histFmt1(ctx.min_rps)} rps` : "—");
      break;
    case "request_withdrawal": stopHtml = rich("e_req", toExact, valsItem); break;
    case "target_changed": stopHtml = rich("e_tgt", toExact, prevItem, tgt || "—", valsItem); break;
    case "defrost": stopHtml = rich(ctx.mode === "other" ? "e_defrost_run" : "e_defrost_pause", toExact, valsItem); break;
    case "dhw_transition": stopHtml = rich("e_dhw", toExact, valsItem); break;
    default: stopHtml = rich("e_norm", toExact, valsItem); break;
  }
  return `${startHtml} ${stopHtml}`;
}

function cyclingPeriodDetailsHtml(model, from, to) {
  const runs = collectPeriodRuns(model, from, to);

  if (!model.hasContext) {
    if (runs.length) return checkupCyclingRunsHtml(runs, model.wall);
    const anyObserved = model.runEdges && model.hours.slice(from, to + 1).some(h => h.observed);
    return esc(t(anyObserved ? "check.cycling.no_timed_runs" : "check.cycling.run_details_unavailable"));
  }

  const findingHtml = `<p class="vdesc-p checkup-period-finding">${cyclingPeriodFindingHtml(model, from, to)}</p>`;
  if (!runs.length) {
    const anyObserved = model.runEdges && model.hours.slice(from, to + 1).some(h => h.observed);
    const startsTotal = model.hours.slice(from, to + 1).reduce((s, h) => s + h.starts.length, 0);
    const emptyMsg = t(startsTotal > 0 || !anyObserved ? "check.cycling.run_details_unavailable" : "check.cycling.no_timed_runs");
    return `${findingHtml}<div class="vdesc-p">${esc(emptyMsg)}</div>`;
  }

  const clockOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
  const fullClock = new Intl.DateTimeFormat(LANG, clockOptions);
  const shortClock = new Intl.DateTimeFormat(LANG, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const modeLabel = m => t({ space: "mode.heat", dhw: "mode.dhw" }[m] || "check.fault_unknown");
  const ongoing = (live, stale) => `<span class="checkup-run-live">${live}</span><span class="checkup-run-stale">${stale}</span>`;
  const unknownStop = esc(t("check.cycling.run_stop_unknown"));

  const rowsHtml = runs.map((r) => {
    const ctx = r.ctx;
    const rawMode = ctx?.mode || r.mode || "space";
    const dotMode = rawMode === "space" || rawMode === "dhw" ? rawMode : "other";
    const fromD = new Date(model.wall(r.start));
    const toD = r.stop != null ? new Date(model.wall(r.stop)) : null;
    const durHtml = r.stop != null
      ? esc(checkupCyclingDuration(r.stop - r.start))
      : (r.latest == null ? "—" : ongoing(esc(checkupCyclingDuration(r.latest - r.start)), "—"));
    const stopTxt = ctx ? cyclingStopSummaryText(r, model.flowTypical) : null;
    const stopCellHtml = r.stop != null
      ? esc(stopTxt || t("check.cycling.run_stop_unknown"))
      : (r.latest == null ? unknownStop : ongoing(esc(t("check.cycling.run_ongoing")), unknownStop));
    const rowKey = r.key ?? `s:${r.start}`;
    const isOpen = !!ctx && S.cyclingExpandedRun === rowKey;
    let subHtml = "";
    if (ctx) {
      const prev = model.prevRunByStart.get(r.start);
      const priorPauseS = prev && prev.stop != null && r.start > prev.stop ? r.start - prev.stop : null;
      const fromExact = fullClock.format(fromD);
      const toExact = toD ? fullClock.format(toD) : "?";
      const explain = cyclingRunExplainHtml(r, fromExact, toExact, priorPauseS, model.flowTypical);
      subHtml = `<tr class="checkup-run-sub" data-run-sub="${esc(rowKey)}"${isOpen ? "" : " hidden"}><td colspan="3">` +
        `<p class="checkup-run-explain">${explain}</p></td></tr>`;
    }
    return `<tr class="checkup-run-row"${ctx ? ` data-run-row="${esc(rowKey)}" tabindex="0" aria-expanded="${isOpen}"` : ""}>` +
      `<td><span class="checkup-run-start"><i class="mode-dot ${dotMode}" aria-hidden="true" title="${esc(modeLabel(dotMode))}"></i>` +
      `<time datetime="${fromD.toISOString()}">${esc(shortClock.format(fromD))}</time></span></td>` +
      `<td>${durHtml}</td>` +
      `<td><div class="checkup-stop-cell"><span class="checkup-stop-text">${stopCellHtml}</span>` +
      (ctx ? `<span class="checkup-run-chev" aria-hidden="true">›</span>` : "") +
      `</div></td></tr>${subHtml}`;
  }).join("");

  return `${findingHtml}<table class="checkup-run-table has-cause"><thead><tr>` +
    `<th scope="col">${esc(t("check.cycling.run_start"))}</th>` +
    `<th scope="col">${esc(t("check.cycling.run_duration"))}</th>` +
    `<th scope="col">${esc(t("check.cycling.col_stop"))}</th>` +
    `</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

// Geometry uses seconds in the trace's frame and labels use its wall-clock anchor.
// A dated frame can include older boots, with a gap record standing between observations.
function checkupCyclingTimelineHtml(trace, scope, checkObj) {
  const end = trace?.window_end_s, observedEnd = trace?.observed_end_s, unix = trace?.unix_s;
  const records = trace?.records, boot = trace?.boot_s;
  if (![end, observedEnd, unix].every(Number.isSafeInteger) || end > 0x1fffffff || end < observedEnd ||
      observedEnd < 0 || unix <= 0 || unix > 0xffffffff ||
      (boot !== undefined && (!Number.isSafeInteger(boot) || boot < 0 || end < 86400 ||
        observedEnd > 86400 || typeof trace.live !== "boolean")) ||
      !Array.isArray(records) || !records.length || records.length > 192) return "";
  const start = end - 86400;
  const runKey = at => {
    if (boot !== undefined) {
      return at >= end - boot ? `b:${at + boot - end}` : `u:${unix + at - end}`;
    }
    return `s:${at}`;
  };
  const hours = Array.from({ length: 24 }, (_, idx) => ({
    starts: [], runs: [], modes: new Set(), segments: [], gap: false, observed: false,
    fromSec: start + 3600 * idx, toSec: start + 3600 * (idx + 1), isCycling: false,
  }));
  const readable = [];
  const modes = ["", "", "other", "space", "dhw"];
  const runEdges = trace.run_edges === true;
  let run;
  let cursor = start, kind = 0, prior = -1;
  const cover = (from, until, state) => {
    if (until <= from) return;
    if (state !== 0) {
      const previous = readable.at(-1);
      if (previous?.[1] === from) previous[1] = until;
      else readable.push([from, until]);
    }
    const cat = state === 3 ? "space" : state === 4 ? "dhw" : (state === 0 || state === 2) ? "other" : null;
    const first = Math.max(0, Math.floor((from - start) / 3600));
    const last = Math.min(24, Math.ceil((until - start) / 3600));
    for (let i = first; i < last; ++i) {
      if (state === 0) hours[i].gap = true;
      else hours[i].observed = true;
      if (modes[state]) hours[i].modes.add(modes[state]);
      const segFrom = Math.max(from, start + 3600 * i);
      const segUntil = Math.min(until, start + 3600 * (i + 1));
      const dur = segUntil - segFrom;
      if (cat && dur > 0) {
        const segs = hours[i].segments;
        const prev = segs.at(-1);
        if (prev && prev.cat === cat) prev.dur += dur;
        else segs.push({ cat, dur });
      }
    }
  };
  for (const record of records) {
    if (!Number.isSafeInteger(record) || record < 0 || record > 0xffffffff) return "";
    const at = record >>> 3, next = record & 7;
    if (at < prior || at > observedEnd || next > 6) return "";
    prior = at;
    if (next === 5) {
      if (at >= start) {
        const hour = hours[Math.min(23, Math.floor((at - start) / 3600))];
        hour.starts.push(at);
        if (runEdges) {
          run = { start: at, key: runKey(at) };
          hour.runs.push(run);
        }
      }
      continue;
    }
    if (next === 6) {
      if (run) run.stop = at;
      run = undefined;
      continue;
    }
    // A later stop cannot establish that the same run continued through a gap.
    if (next === 0) run = undefined;
    if (run && !run.mode && (next === 2 || next === 3 || next === 4)) run.mode = modes[next];
    if (at > cursor) cover(cursor, at, kind);
    cursor = Math.max(at, start);
    kind = next;
  }
  const last = Math.max(start, observedEnd);
  cover(cursor, last, kind);
  cover(last, end, 0);
  if (run && trace.live !== false && end - observedEnd <= 15) run.latest = observedEnd;

  const runContextByStart = new Map();
  const hasContext = Array.isArray(checkObj?.run_contexts) && checkObj.run_contexts.length > 0;
  if (hasContext) {
    for (const rc of checkObj.run_contexts) runContextByStart.set(rc.at, rc);
  }
  for (const h of hours) {
    let shortHeating = 0;
    for (const r of h.runs) {
      const mode = runContextByStart.get(r.start)?.mode || r.mode;
      if (mode === "space" && r.stop != null && (r.stop - r.start) < 600) ++shortHeating;
    }
    h.isCycling = shortHeating >= 2;
  }
  const episodes = [];
  let openEp = null;
  for (let i = 0; i < 24; ++i) {
    if (hours[i].isCycling) {
      if (!openEp) openEp = { from: i, to: i };
      else openEp.to = i;
    } else if (openEp) {
      episodes.push(openEp);
      openEp = null;
    }
  }
  if (openEp) episodes.push(openEp);
  const allRuns = hours.flatMap(h => h.runs).sort((a, b) => a.start - b.start);
  const prevRunByStart = new Map();
  for (let i = 1; i < allRuns.length; ++i) prevRunByStart.set(allRuns[i].start, allRuns[i - 1]);

  const count = hours.reduce((n, h) => n + h.starts.length, 0);
  const x = sec => ((sec - start) / 86400 * 2400).toFixed(2);
  const y = n => (96 - n * 90 / Math.max(count, 1)).toFixed(2);
  const clockOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const stamp = new Intl.DateTimeFormat(LANG, clockOptions);
  const date = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric" });
  const wall = sec => (unix + sec - end) * 1000;
  const clock = sec => stamp.format(wall(sec));
  const offsetStamp = new Intl.DateTimeFormat(LANG, { ...clockOptions, timeZoneName: "shortOffset" });
  const events = hours.flatMap(h => h.starts);
  let n = 0, path = "";
  for (const [from, to] of readable) {
    while (n < count && events[n] < from) {
      path += `M ${x(events[n])} ${y(n)} V ${y(n + 1)} `;
      ++n;
    }
    path += `M ${x(from)} ${y(n)} `;
    while (n < count && events[n] <= to) {
      path += `H ${x(events[n])} V ${y(n + 1)} `;
      ++n;
    }
    path += `H ${x(to)} `;
  }
  while (n < count) {
    path += `M ${x(events[n])} ${y(n)} V ${y(n + 1)} `;
    ++n;
  }

  _cyclingModels.clear();
  _cyclingModels.set(scope, {
    hours, wall, clock, offsetStamp, episodes, runContextByStart, prevRunByStart, hasContext,
    runEdges, rev: ++cyclingModelRev,
    flowTypical: Number.isFinite(checkObj?.flow_typical_l_min) ? checkObj.flow_typical_l_min : null,
    outdoorMean: Number.isFinite(checkObj?.outdoor_mean_c) ? checkObj.outdoor_mean_c : null,
  });

  let cols = "";
  hours.forEach(({ starts, modes, segments, gap, observed, isCycling }, i) => {
    const from = start + 3600 * i, to = from + 3600;
    const offsetChange = new Date(wall(from)).getTimezoneOffset() !== new Date(wall(to)).getTimezoneOffset();
    const span = offsetChange ? `${offsetStamp.format(wall(from))}–${offsetStamp.format(wall(to))}`
      : `${clock(from)}–${clock(to)}`;
    const countLabel = !gap || starts.length
      ? checkupCyclingCountPrefix(starts.length) + t("check.starts", starts.length) : "";
    const labels = CHECKUP_CYCLING_MODES.filter(([mode]) => modes.has(mode))
      .map(([mode, label]) => t(mode === "other" ? "check.cycling.unclear" : label));
    if (gap) labels.push(t(observed || starts.length ? "check.hour.gap" : "sys.nodata"));
    const value = starts.length || !gap ? starts.length : "";
    cols += `<button type="button" class="checkup-chart-col" data-bucket="${i}" data-span="${esc(span)}"` +
      (offsetChange ? " data-offset-change" : "") +
      (runEdges && observed ? " data-run-observed" : "") +
      ` tabindex="${i === 23 ? 0 : -1}" aria-pressed="false" aria-label="${esc([date.format(wall(from)), span, countLabel, ...labels].filter(Boolean).join(" · "))}">` +
      `<b${isCycling ? ' class="warn"' : ""}>${value}</b>${checkupCyclingFillHtml(segments)}</button>`;
  });
  const axis = [0, 6, 12, 18, 24].map(i => `<span>${esc(clock(start + i * 3600))}</span>`).join("");
  const legend = checkupCyclingLegendHtml();
  const total = readable.length || count
    ? t("check.cycling.timed_starts", checkupCyclingCountPrefix(count) + t("check.starts", count))
    : t("sys.nodata");
  return `<div class="vhist checkup-cycling-chart checkup-cycling-timeline" role="group" aria-label="${esc(t("hist.aria", t("check.cycling")))}"` +
    ` data-cycling="${esc(scope)}"${hasContext ? ' data-has-context="true"' : ""}><div class="checkup-chart-total mono num">${esc(total)}</div>` +
    `<div class="checkup-chart-graph"><svg class="checkup-chart-plot" viewBox="0 0 2400 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>` +
    `<div class="checkup-chart-cols">${cols}</div></div><div class="vhist-axis checkup-chart-axis">` +
    `<div class="checkup-chart-ticks">${axis}</div><span class="checkup-chart-span" aria-live="polite" hidden></span></div>` +
    `<div class="checkup-chart-legend">${legend}</div><div class="checkup-run-details" hidden></div></div>`;
}

function checkupCyclingChartHtml(c) {
  // History forget retires precise times independently of the diagnosis hour buckets.
  const source = S.status?.health?.source || "x10a";
  const scope = JSON.stringify([S.status?.boot_id, S.status?.history?.epoch, source, c?.hours_epoch, "timeline"]);
  if (cyclingTrace?.scope !== scope) cyclingTrace = null;
  let trace = c?.timeline;
  if (!trace && c && cyclingTrace) {
    const previous = cyclingTrace.trace;
    const uptime = S.status?.uptime_s || 0;
    const elapsed = Math.max(0, uptime - (previous.boot_s ?? previous.window_end_s));
    // A temporarily omitted snapshot carries no new readings. Move both anchors so
    // the chart advances but the wall time of each retained record stays the same.
    trace = {
      ...previous,
      ...(previous.boot_s !== undefined ? { boot_s: previous.boot_s + elapsed } : {}),
      window_end_s: previous.window_end_s + elapsed,
      unix_s: previous.unix_s + elapsed,
    };
  }
  if (trace) {
    const cachedCtx = trace !== c?.timeline;
    const mergedCheck = c ? {
      ...c,
      run_contexts: c.run_contexts ?? (cachedCtx ? cyclingTrace?.run_contexts : undefined),
      flow_typical_l_min: c.flow_typical_l_min ?? (cachedCtx ? cyclingTrace?.flow_typical_l_min : undefined),
    } : c;
    const key = JSON.stringify([LANG, scope, trace, mergedCheck?.run_contexts, mergedCheck?.flow_typical_l_min]);
    if (cyclingMarkup[0] === key) return cyclingMarkup[1];
    const timeline = checkupCyclingTimelineHtml(trace, scope, mergedCheck);
    if (timeline) {
      if (trace === c.timeline) {
        cyclingTrace = {
          scope, trace,
          run_contexts: c.run_contexts,
          flow_typical_l_min: c.flow_typical_l_min,
        };
      }
      cyclingMarkup = [key, timeline];
      return timeline;
    }
  }
  const hrs = Array.isArray(c?.hours) ? c.hours.slice(-24) : [];
  if (!hrs.length) return descParaHtml(esc(t("check.cycling.history_empty")));
  const identified = Number.isSafeInteger(c.hours_epoch) && hrs.every(h => Number.isSafeInteger(h?.bucket));
  // Only firmware bucket identities outlive a changing frame. Legacy snapshots can be explored,
  // but a pin must not jump to different evidence when that snapshot or its hour changes.
  const hourlyScope = JSON.stringify([S.status?.boot_id, source, identified ? c.hours_epoch :
    [Math.floor((S.status?.uptime_s || 0) / 3600), hrs]]);
  const key = JSON.stringify([LANG, hourlyScope, hrs]);
  if (cyclingMarkup[0] === key) return cyclingMarkup[1];
  const pad = 24 - hrs.length;
  let sumS = 0, sumR = 0, cols = "", hasObservation = false;
  const stamp = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric", hour: "2-digit",
    minute: "2-digit", timeZoneName: "shortOffset" });
  const duration = checkupCyclingDuration;
  const startsText = n => checkupCyclingCountPrefix(n) + t("check.starts", n);
  for (let i = 0; i < 24; i++) {
    const h = hrs[i - pad];
    if (!h || h.expired === true) {
      cols += `<span class="checkup-chart-col" aria-hidden="true" inert></span>`;
      continue;
    }
    const observed = Number.isInteger(h.observed_s) && h.observed_s >= 0 && h.observed_s <= 3600
      ? h.observed_s : 0;
    const s = h.starts > 0 ? Math.round(h.starts) : 0;
    const r = observed && h.run_s > 0 ? Math.min(observed, Math.round(h.run_s)) : 0;
    sumS += s;
    sumR += r;
    hasObservation ||= observed > 0;
    const n = 23 - i, dated = identified && Number.isSafeInteger(h.end_unix_s) &&
      h.end_unix_s > 0 && h.end_unix_s <= 8.64e12;
    const when = dated ? t(h.restored === true ? "check.hour.saved" : "check.hour.ending",
      stamp.format(h.end_unix_s * 1000))
      : n ? t("check.hour.earlier", n) : t("check.hour.latest");
    // Restored records may be short. Legacy slots cannot identify whether a record was restored.
    let possible = null;
    if (identified && h.restored !== true) {
      if (n) possible = 3600;
      else if (Number.isInteger(h.elapsed_s) && h.elapsed_s >= observed && h.elapsed_s <= 3600)
        possible = h.elapsed_s;
    }
    const missing = possible == null ? 0 : possible - observed;
    const valid = identified && [h.space_s, h.dhw_s].every(v => Number.isInteger(v) && v >= 0) &&
      h.space_s + h.dhw_s <= r;
    const space = valid ? h.space_s : 0, dhw = valid ? h.dhw_s : 0;
    const otherActive = r - space - dhw;
    const modes = [[space, "space", "mode.heat"], [dhw, "dhw", "mode.dhw"],
      [otherActive, "other", "check.fault_unknown"]].filter(([seconds]) => seconds > 0);
    const tip = [when, observed || s ? startsText(s) : t("sys.nodata")];
    if (observed) tip.push(duration(r));
    for (const [seconds, , label] of modes) tip.push(`${t(label)} ${duration(seconds)}`);
    tip.push(t("check.hour.coverage", duration(observed), possible == null ? "" : duration(possible)));
    const segments = [];
    if (space > 0) segments.push({ cat: "space", dur: space });
    if (dhw > 0) segments.push({ cat: "dhw", dur: dhw });
    const otherTotal = otherActive + (missing > 0 ? missing : (possible == null && !observed ? 1 : 0));
    if (otherTotal > 0) segments.push({ cat: "other", dur: otherTotal });
    cols += `<button type="button" class="checkup-chart-col"` +
      ` data-bucket="${identified ? h.bucket : i}" tabindex="${n ? -1 : 0}" aria-pressed="false"` +
      ` aria-label="${esc(tip.join(" · "))}"><b${s > 2 ? ' class="warn"' : ""}>${s || ""}</b>` +
      `${checkupCyclingFillHtml(segments)}</button>`;
  }
  let meta = hasObservation || sumS ? startsText(sumS) : t("sys.nodata");
  if (hasObservation) meta += ` · ${checkupDuration(sumR)}`;
  const legend = checkupCyclingLegendHtml();
  const html = `<div class="vhist checkup-cycling-chart" role="group" aria-label="${esc(t("hist.aria", t("check.cycling")))}"` +
    ` data-cycling="${esc(hourlyScope)}" data-tip="${esc(meta)}">` +
    `<div class="checkup-chart-cols">${cols}</div>` +
    `<div class="vhist-axis"><span>${esc(t("check.hour.earlier", 23))}</span><span>${esc(t("check.hour.latest"))}</span></div>` +
    `<div class="checkup-chart-legend">${legend}</div>` +
    `<div class="vhist-range mono num">${esc(meta)}</div><div class="checkup-run-details" hidden></div></div>`;
  cyclingMarkup = [key, html];
  return html;
}

function checkupFaultDuration(s) {
  const sec = Math.max(0, Math.round(Number(s) || 0));
  return sec < 60 ? dwellDuration(sec) : checkupDuration(sec);
}
function checkupFaultExactDuration(s) {
  const sec = Math.max(0, Math.round(Number(s) || 0));
  return sec >= 60 && sec < 3600 ? checkupCyclingDuration(sec) : checkupFaultDuration(sec);
}
function checkupFaultStateLabel(kind) {
  if (kind === "fault" || kind === "err") return t("enum.fault");
  if (kind === "caution") return t("check.fault_severity_caution");
  return t("enum.warning");
}
function checkupFaultUnitLabel(unit) {
  if (unit === "outdoor" || unit === "indoor" || unit === "both") return t(`check.fault_unit_${unit}`);
  return "";
}
function checkupFaultClock(unixS, ageS) {
  const u = Number(unixS);
  if (Number.isFinite(u) && u > 0) {
    return new Intl.DateTimeFormat(LANG, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(u * 1000);
  }
  const age = Number(ageS);
  return Number.isFinite(age) && age >= 0 ? t("check.fault_ago_short", checkupFaultDuration(age)) : t("sys.nodata");
}
function extractFaultEpisodes(timeline, sourceFresh) {
  const segs = Array.isArray(timeline?.segments) ? timeline.segments : [];
  const winEnd = Number(timeline?.window_end_s) > 0 ? Number(timeline.window_end_s) : 86400;
  const winStart = Math.max(0, winEnd - 86400);
  const obsEnd = Math.max(winStart, Math.min(winEnd, Number(timeline?.observed_end_s) || 0));
  const unixEnd = Number(timeline?.unix_s) > winEnd ? Number(timeline.unix_s) : 0;
  const isFaultSeg = k => k === "err" || k === "warn" || k === "caution";
  const toneMap = new Map();
  const spans = [];
  const episodes = [];
  const totals = new Map();

  if (segs.length && Number(segs[0]?.t) > winStart) {
    spans.push({ kind: "gap", startS: winStart, endS: Math.min(winEnd, Number(segs[0].t)) });
  }
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const startS = Math.max(winStart, Math.min(winEnd, Number(seg?.t) || 0));
    const nextT = i + 1 < segs.length ? Number(segs[i + 1]?.t) : obsEnd;
    const endS = Math.max(startS, Math.min(winEnd, Number.isFinite(nextT) ? nextT : obsEnd));
    if (!isFaultSeg(seg?.k)) {
      if (endS > startS) spans.push({ kind: seg?.k === "ok" ? "ok" : "gap", startS, endS });
      continue;
    }
    const code = String(seg.c || "?").trim() || "?";
    if (!toneMap.has(code)) toneMap.set(code, toneMap.size % 6);
    const tone = toneMap.get(code);
    const baseCode = String(seg.b || code.split("-")[0]).trim().toUpperCase();
    const lastEp = episodes[episodes.length - 1];
    const contiguous = lastEp && lastEp._lastIdx === i - 1 && lastEp.stopS === startS &&
      lastEp.kindKey === seg.k && lastEp.code === code && lastEp.unitRaw === (seg.u || "") &&
      lastEp.sub === (seg.sub || 0) && lastEp.sc === (seg.sc || "") && lastEp.sk === (seg.sk || "");
    let ep;
    if (contiguous) {
      ep = lastEp;
      ep._lastIdx = i;
      ep.stopS = endS;
      ep.durationS = Math.max(0, ep.stopS - ep.startS);
    } else {
      ep = {
        idx: episodes.length,
        _lastIdx: i,
        kindKey: seg.k,
        code,
        baseCode,
        meaning: faultCodeMeaning(baseCode),
        unitRaw: seg.u || "",
        sub: Number(seg.sub) || 0,
        sc: String(seg.sc || "").trim(),
        sk: String(seg.sk || "").trim(),
        tone,
        startS,
        stopS: endS,
        durationS: Math.max(0, endS - startS),
      };
      episodes.push(ep);
    }
    totals.set(code, (totals.get(code) || 0) + Math.max(0, endS - startS));
    spans.push({ kind: seg.k, startS, endS, code, baseCode, tone, epIdx: ep.idx });
  }
  if (obsEnd < winEnd && segs.length) {
    spans.push({ kind: "gap", startS: obsEnd, endS: winEnd });
  }
  for (const ep of episodes) {
    const atEnd = ep._lastIdx + 1 === segs.length;
    const isLive = atEnd && sourceFresh !== false && timeline?.live === true && (winEnd - obsEnd <= 300);
    ep.ongoing = isLive;
    ep.stopUnknown = !isLive && (!atEnd ? (segs[ep._lastIdx + 1]?.k !== "ok") : true);
    ep.startUnixS = unixEnd ? unixEnd - (winEnd - ep.startS) : 0;
    ep.endUnixS = !ep.ongoing && unixEnd ? unixEnd - (winEnd - ep.stopS) : 0;
    ep.startAgeS = Math.max(0, winEnd - ep.startS);
    ep.stopAgeS = Math.max(0, winEnd - ep.stopS);
  }
  return { episodes, spans, toneMap, totals, winStart, winEnd, obsEnd };
}
function faultSecNoteHtml(secCode, secState) {
  if (!secCode) return "";
  const m = faultCodeMeaning(secCode);
  const label = `${secCode}${m ? ` (${m})` : ""}` + (secState ? ` · ${checkupFaultStateLabel(secState)}` : "");
  return t("check.fault_secondary", label);
}
function checkupFaultDetailHtml(c, report = {}) {
  const stale = report?.source_fresh === false || c.reason === "source_stale";
  const isModbus = report?.source === "modbus";
  const timeline = c.timeline && Array.isArray(c.timeline.segments) ? c.timeline : null;
  const parsed = timeline ? extractFaultEpisodes(timeline, report?.source_fresh) : null;
  const toneFor = (code, kind) => {
    if (parsed && parsed.toneMap.has(code)) return parsed.toneMap.get(code);
    return (kind === "fault" || kind === "err") ? 0 : 1;
  };
  let heroHtml = "";
  if (c.latest && c.latest.code) {
    const lt = c.latest;
    const tone = toneFor(lt.code, lt.state);
    const meaning = faultCodeMeaning(lt.base_code || lt.code);
    const startAge = lt.ongoing ? lt.age_s : Number(lt.age_s || 0) + Number(lt.duration_s || 0);
    const startTxt = checkupFaultClock(lt.start_unix_s, startAge);
    const stopTxt = lt.ongoing ? t("check.fault_stop_ongoing")
                  : lt.stop_unknown ? t("check.fault_stop_unknown")
                  : checkupFaultClock(lt.end_unix_s, lt.age_s);
    const metaParts = [
      checkupFaultStateLabel(lt.state),
      checkupFaultUnitLabel(lt.unit),
      faultSecNoteHtml(lt.secondary_code, lt.secondary_state),
    ].filter(Boolean);
    const timeLine = `${t("check.cycling.run_start")}: ${startTxt} · ${t("check.cycling.run_stop")}: ${stopTxt} · ` +
      `${t("check.cycling.run_duration")}: ${checkupFaultExactDuration(lt.duration_s)}`;
    heroHtml = `<div class="checkup-fault-hero">` +
      `<div class="checkup-fault-hero-head">` +
      `<span class="fault-code-badge fault-tone-${tone}"><i class="fault-dot" aria-hidden="true"></i>${esc(lt.code)}</span>` +
      `<span class="checkup-fault-meaning">${esc(meaning)}</span>` +
      `</div>` +
      (metaParts.length ? `<div class="checkup-fault-meta">${esc(metaParts.join(" · "))}</div>` : "") +
      `<div class="checkup-fault-meta num">${esc(timeLine)}</div>` +
      (stale ? `<div class="checkup-fault-meta">${esc(t(isModbus ? "check.detail.source_stale_modbus" : "check.detail.source_stale"))}</div>` : "") +
      `</div>`;
  } else if (c.saved === 1) {
    heroHtml = `<div class="checkup-fault-hero"><div class="vdesc-p">${esc(t("check.fault_latched_only"))}</div></div>`;
  } else if (c.verdict === "ok" && c.active === 0) {
    const okMsg = Number.isFinite(c.observed_s) && c.observed_s > 0
      ? t("check.fault_hero_ok", checkupDuration(c.observed_s)) : t("check.fault_none");
    heroHtml = `<div class="checkup-fault-hero"><div class="vdesc-p">${esc(okMsg)}</div></div>`;
  } else {
    const statusKey = checkupStatusKey(c);
    const msg = statusKey === "collecting"
      ? (c.required_s > 0 ? t("check.detail.collecting", checkupDuration(c.observed_s), checkupDuration(c.required_s))
                          : t("check.detail.collecting_unknown"))
      : t(checkupDetailKey(c, statusKey));
    const staleNote = stale ? ` ${t(isModbus ? "check.detail.source_stale_modbus" : "check.detail.source_stale")}` : "";
    heroHtml = `<div class="checkup-fault-hero"><div class="vdesc-p"><span class="vdesc-n">${esc(checkupStatusText(c))}</span> — ${esc(msg + staleNote)}</div></div>`;
  }

  let chartHtml = "";
  let tableHtml = "";
  if (parsed && parsed.spans.length) {
    const validCodes = new Set(parsed.toneMap.keys());
    for (const active of [...S.faultCodes]) if (!validCodes.has(active)) S.faultCodes.delete(active);
    const validEpSet = new Set(parsed.episodes.map(ep => String(ep.idx)));
    if (S.faultSnapKeys) {
      for (const k of [...S.faultSnapKeys]) if (!validEpSet.has(k)) S.faultSnapKeys.delete(k);
      if (!S.faultSnapKeys.size) S.faultSnapKeys = null;
    }
    const hasFilter = S.faultCodes.size > 0 || (S.faultSnapKeys && S.faultSnapKeys.size > 0);
    const pct = v => (v / 864).toFixed(4) + "%";
    const segsHtml = parsed.spans.map((sp) => {
      const left = pct(sp.startS - parsed.winStart);
      const width = pct(sp.endS - sp.startS);
      if (sp.kind === "gap") {
        const msg = `${t("check.fault_gap_label")} · ${checkupFaultExactDuration(sp.endS - sp.startS)}`;
        return `<span class="vhist-state-gap" style="left:${left};width:${width}" data-fault-tip="${esc(msg)}"></span>`;
      }
      if (sp.kind === "ok") {
        const msg = `${t("check.fault_ok_label")} · ${checkupFaultExactDuration(sp.endS - sp.startS)}`;
        return `<span class="vhist-state-ok" style="left:${left};width:${width}" data-fault-tip="${esc(msg)}"></span>`;
      }
      const ep = parsed.episodes[sp.epIdx];
      const match = !hasFilter || S.faultCodes.has(sp.code) || S.faultSnapKeys?.has(String(sp.epIdx));
      const snapped = S.faultSnapKeys?.has(String(sp.epIdx));
      const tip = `${sp.code} (${ep.meaning}) · ${checkupFaultExactDuration(sp.endS - sp.startS)}`;
      return `<span class="vhist-state-seg fault-tone-${sp.tone}${match ? " is-match" : ""}${snapped ? " is-snapped" : ""}"` +
        ` data-fault-seg="${sp.epIdx}" data-fault-code="${esc(sp.code)}" data-fault-tip="${esc(tip)}"` +
        ` style="left:${left};width:${width}"></span>`;
    }).join("");
    const chipsHtml = parsed.toneMap.size
      ? `<div class="checkup-fault-chips">` +
        [...parsed.toneMap.entries()].map(([code, tone]) => {
          const pressed = S.faultCodes.has(code);
          const tot = parsed.totals.get(code) || 0;
          return `<button type="button" class="fault-chip fault-tone-${tone}" data-fault-chip="${esc(code)}"` +
            ` aria-pressed="${pressed ? "true" : "false"}">` +
            `<i class="fault-dot" aria-hidden="true"></i><span class="mono">${esc(code)}</span>` +
            `<span class="num">· ${esc(checkupFaultDuration(tot))}</span></button>`;
        }).join("") + `</div>`
      : "";
    const axisHtml = `<div class="vhist-axis"><span>${esc(t("check.hour.earlier", 24))}</span><span>${esc(t("check.hour.latest"))}</span></div>`;
    const defaultTip = parsed.episodes.length ? "" : t("check.fault_none");
    chartHtml = `<div class="checkup-fault-chart${hasFilter ? " is-filtered" : ""}" role="group" aria-label="${esc(t("hist.aria", t("check.fault")))}">` +
      `<div class="vhist-state-track checkup-fault-track" tabindex="0">${segsHtml}</div>` +
      axisHtml +
      `<div class="checkup-fault-readout num" data-fault-default="${esc(defaultTip)}">${esc(defaultTip)}</div>` +
      chipsHtml + `</div>`;

    if (parsed.episodes.length) {
      const rows = parsed.episodes.slice().reverse().map((ep) => {
        const show = hasFilter && (S.faultCodes.has(ep.code) || S.faultSnapKeys?.has(String(ep.idx)));
        const snapped = S.faultSnapKeys?.has(String(ep.idx));
        const startStr = checkupFaultClock(ep.startUnixS, ep.startAgeS);
        const stopStr = ep.ongoing ? t("check.fault_stop_ongoing")
                      : ep.stopUnknown ? t("check.fault_stop_unknown")
                      : checkupFaultClock(ep.endUnixS, ep.stopAgeS);
        const sub = ep.sc ? `<span class="checkup-fault-sub">${esc(faultSecNoteHtml(ep.sc, ep.sk))}</span>` : "";
        return `<tr data-fault-row-ep="${ep.idx}" data-fault-code="${esc(ep.code)}"` +
          `${snapped ? ' class="is-snapped"' : ""}${show ? "" : " hidden"}>` +
          `<td class="mono"><span class="fault-tone-${ep.tone}"><i class="fault-dot" aria-hidden="true"></i> ${esc(ep.code)}</span></td>` +
          `<td>${esc(ep.meaning)}${sub}</td>` +
          `<td class="num">${esc(startStr)}</td>` +
          `<td class="num">${esc(stopStr)}</td>` +
          `<td class="num">${esc(checkupFaultExactDuration(ep.durationS))}</td></tr>`;
      }).join("");
      tableHtml = `<div class="checkup-fault-table-wrap"${hasFilter ? "" : " hidden"}>` +
        `<table class="checkup-fault-table"><thead><tr>` +
        `<th>${esc(t("check.fault_col_code"))}</th>` +
        `<th>${esc(t("check.fault_col_meaning"))}</th>` +
        `<th>${esc(t("check.cycling.run_start"))}</th>` +
        `<th>${esc(t("check.cycling.run_stop"))}</th>` +
        `<th>${esc(t("check.cycling.run_duration"))}</th>` +
        `</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
  const copy = modelDescriptionCopy("health_fault");
  const what = copy ? copy[0] : MODEL_DESCRIPTIONS.health_fault.what;
  return `<div class="checkup-fault-panel" data-checkup-fault>${heroHtml}${chartHtml}${tableHtml}` +
    `<p class="vdesc-p checkup-fault-boundary">${esc(what)}</p></div>`;
}
function syncCheckupFaultPanel(panel) {
  if (!panel) return;
  const hasFilter = S.faultCodes.size > 0 || (S.faultSnapKeys && S.faultSnapKeys.size > 0);
  const chart = panel.querySelector(".checkup-fault-chart");
  if (chart) {
    chart.classList.toggle("is-filtered", !!hasFilter);
    for (const seg of chart.querySelectorAll("[data-fault-seg]")) {
      const ep = seg.dataset.faultSeg;
      const code = seg.dataset.faultCode;
      seg.classList.toggle("is-match", !hasFilter || S.faultCodes.has(code) || !!S.faultSnapKeys?.has(ep));
      seg.classList.toggle("is-snapped", !!S.faultSnapKeys?.has(ep));
    }
    for (const chip of chart.querySelectorAll("button.fault-chip[data-fault-chip]")) {
      chip.setAttribute("aria-pressed", S.faultCodes.has(chip.dataset.faultChip) ? "true" : "false");
    }
  }
  const wrap = panel.querySelector(".checkup-fault-table-wrap");
  if (wrap) {
    wrap.hidden = !hasFilter;
    for (const tr of wrap.querySelectorAll("tr[data-fault-row-ep]")) {
      const ep = tr.dataset.faultRowEp;
      const code = tr.dataset.faultCode;
      const show = hasFilter && (S.faultCodes.has(code) || !!S.faultSnapKeys?.has(ep));
      tr.hidden = !show;
      tr.classList.toggle("is-snapped", !!S.faultSnapKeys?.has(ep));
    }
  }
}

// H1 is an independent dated population, not a new verdict or a replacement for min_l_min.
function checkupHydronicKnown(h) {
  return h?.method === 1 && h.confirmed === true && h.dated === true &&
    typeof h.first_evidence_unix_s === "number" && Number.isFinite(h.first_evidence_unix_s) &&
    h.first_evidence_unix_s >= 0 && typeof h.last_evidence_unix_s === "number" &&
    Number.isFinite(h.last_evidence_unix_s) && h.last_evidence_unix_s >= h.first_evidence_unix_s &&
    h.last_evidence_unix_s <= 8640000000000;
}

function checkupHydronicHtml(c, isModbus = false) {
  const h = !isModbus && c.id === "flow" ? c.hydronic : null;
  if (!h || typeof h !== "object") return ["", ""];
  const labels = t("check.hydronic.labels").split("|");
  const reasons = t("check.hydronic.reasons").split("|");
  const limits = t("check.hydronic.limits").split("|");
  const state = t("check.hydronic.states").split("|");
  const nd = t("sys.nodata");
  const row = (l, v) => `${l}: ${v}`;
  const html = r => "<br>" + r.map(esc).join("<br>");
  if (h.method !== 1) return ["", html([row(labels[5], reasons[13])])];
  const known = checkupHydronicKnown(h);
  const num = n => typeof n === "number" && Number.isFinite(n);
  const cnt = n => num(n) && Number.isSafeInteger(n) && n >= 0;
  const fmt = (n, p = 3) => n.toLocaleString(LANG, { maximumFractionDigits: p });
  const pre = h.population_saturated === true ? "≥" : "";
  const val = n => known && cnt(n) ? pre + fmt(n) : nd;
  const dur = n => known && num(n) && n >= 0 ? pre + t("hist.duration_sec", fmt(n, 6)) : nd;
  const rng = (r, n, u) => known && cnt(n) && n > 0 && r && [r.min, r.mean, r.max].every(num)
    ? t("service.metric.range", fmt(r.min), fmt(r.mean), fmt(r.max), u) : nd;
  const dt = n => known && num(n) && n >= 0 && Number.isFinite(n * 1000) && n <= 8640000000000
    ? new Date(n * 1000).toLocaleString(LANG, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) + " UTC" : nd;
  const meas = [
    row(labels[0], rng(h.spread_k, h.samples, "K")),
    row(t("schem.flow_rate"), rng(h.flow_l_min, h.samples, "l/min")),
    row(labels[1], rng(h.pump_command_pct, h.command_samples, "%")),
    t("check.hydronic.counts", val(h.samples), val(h.command_samples)),
    row(labels[2], [h.observed_s, h.candidate_s, h.qualified_s].map(dur).join(" / ")),
    row(labels[3], `${dt(h.first_evidence_unix_s)} – ${dt(h.last_evidence_unix_s)}`),
    row(labels[4], `${dt(h.first_accepted_unix_s)} – ${dt(h.last_accepted_unix_s)}`),
    row(labels[7], val(h.observed_hours)),
    row(labels[8], nd),
  ];
  const sr = k => t(`service.reason.${k}`);
  const code = Number.isInteger(h.reason_code) && h.reason_code >= 0 && h.reason_code <= 19 ? h.reason_code : -1;
  const reason = [reasons[0], sr("unsupported_profile"), reasons[1], reasons[2],
    sr("missing_fresh_signal"), reasons[3], reasons[4],
    sr("compressor_not_running"), sr("unsupported_or_unknown_mode"),
    reasons[5], sr("defrost"), reasons[6],
    sr("special_controller_phase"), reasons[7], sr("poll_gap"),
    reasons[8], reasons[9], reasons[10], reasons[11], reasons[12]][code];
  // A retained pump/valve/run-up reason is not a fresh current state after a source gap.
  const fresh = h.current === true && h.confirmed === true;
  const sec = c.secondary_supply;
  if (fresh && sec?.zone_context === "unknown" && num(sec.delta_k) &&
      num(sec.duration_s) && sec.duration_s >= 0 && cnt(sec.samples) && sec.samples > 0) {
    meas.push(t("check.hydronic.secondary", (sec.delta_k > 0 ? "+" : "") + fmt(sec.delta_k) + " K",
      t("hist.duration_sec", fmt(sec.duration_s, 6)), fmt(sec.samples)));
  }
  const cur = fresh || [1, 2, 3, 14, 15, 16, 17, 18, 19].includes(code) ? reason || reasons[13] : reasons[13];
  const settle = fresh && code === 13 && num(h.settling_remaining_s) &&
    h.settling_remaining_s > 0 && h.settling_remaining_s <= 600
    ? ` ${t("hist.duration_sec", fmt(h.settling_remaining_s))}` : "";
  const flags = m => cnt(m) && m <= 7
    ? [limits[0], limits[1], state[5]].filter((_, i) => m & (1 << i)).join(" · ") : nd;
  const pop = [known ? state[1] : h.dated === false ? state[2] : nd];
  if (h.confirmed === false) pop.push(state[0]);
  if (h.coverage_partial === true) pop.push(state[3]);
  if (h.restore_pending === true) pop.push(limits[2]);
  if (h.persistence_pending === true) pop.push(state[4]);
  if (h.population_saturated === true && !(known && cnt(h.population_limitations_mask) && h.population_limitations_mask <= 7 && (h.population_limitations_mask & 4))) pop.push(state[5]);
  if (known) pop.push(flags(h.population_limitations_mask));
  if (cnt(h.dropped)) pop.push(t("check.hydronic.loss", `≥${fmt(h.dropped)}`));
  return [html(meas), html([row(labels[5], [cur + settle, fresh ? flags(h.current_limitations_mask) : nd].filter(Boolean).join(" · ")),
    row(labels[6], pop.filter(Boolean).join(" · "))])];
}

function checkupStatusKey(c) {
  const verdict = typeof c === "string" ? c : c?.verdict;
  // Older firmware reported this completed, unsuccessful day as collecting. Keep its
  // evidence visible without promising that another hour will necessarily produce a result.
  if (c?.id === "dhw_loss" && c.blocked === true) return "unavailable";
  if (verdict === "ok" && c?.evidence === "observation") return "observation";
  if (verdict === "ok" && c?.evidence === "experimental") return "experimental";
  return ["ok", "info", "warn", "collecting", "unavailable"].includes(verdict)
    ? verdict : "unavailable";
}

function checkupStatusText(c) {
  if (c?.id === "dhw_loss" && c.blocked === true) return t("check.status.no_window");
  return t(`check.status.${checkupStatusKey(c)}`);
}

function checkupDhwHasRate(c) {
  return c.verdict !== "unavailable" && c.blocked !== true &&
         Number.isFinite(c.max_k_h) && c.max_k_h >= 0 &&
         Number.isFinite(c.windows) && c.windows >= 1;
}

function checkupDhwEnergy(c) {
  if (!checkupDhwHasRate(c) || c.blocked === true || c.verdict === "unavailable") return "";
  // Illustration only: assumed uniform 200 l of water, 0.001163 kWh/(l K).
  // A single R5T sensor and an unknown actual COP cannot meter tank/electrical energy.
  const heat = c.max_k_h * 200 * 0.001163;
  if (!Number.isFinite(heat)) return "";
  const fmt = (n, digits) => n.toLocaleString(LANG,
    { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return t("check.detail.dhw_energy",
    fmt(c.max_k_h, 1), fmt(heat, 2), fmt(heat / 3, 2), fmt(heat / 2.5, 2));
}

// Timed DHW windows are separate from the persisted diagnosis totals. No scalar, journal
// bucket or previous snapshot can reconstruct a missing current-boot timeline.
function checkupDhwTimeline(c) {
  const trace = c?.timeline;
  const uint = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
  if (!trace || !uint(trace.epoch) || !trace.epoch || !uint(trace.window_end_s) ||
      !uint(trace.since_s) || trace.since_s > trace.window_end_s ||
      !(trace.observed_end_s === null || (uint(trace.observed_end_s) &&
        trace.observed_end_s >= trace.since_s && trace.observed_end_s <= trace.window_end_s)) ||
      (trace.unix_s != null && (!uint(trace.unix_s) || !trace.unix_s)) ||
      typeof trace.live !== "boolean" || (trace.live && trace.observed_end_s === null) ||
      !Array.isArray(trace.windows) || trace.windows.length > 24)
    return null;
  let end = trace.since_s;
  for (const w of trace.windows) {
    if (!w || !uint(w.start_s) || !uint(w.end_s) || w.start_s < end ||
        w.end_s - w.start_s < 3600 || w.end_s - w.start_s > 3631 ||
        w.end_s <= trace.window_end_s - 86400 || w.end_s > trace.window_end_s ||
        !Number.isFinite(w.rate_k_h) || w.rate_k_h < 0 ||
        !uint(w.observed_s) || w.observed_s > w.end_s - w.start_s ||
        typeof w.pump_marker !== "boolean" || typeof w.draw_marker !== "boolean") return null;
    end = w.end_s;
  }
  return trace;
}
function checkupDhwScope(trace, report = S.status?.health) {
  return JSON.stringify([S.status?.boot_id, S.status?.history?.epoch,
    report?.source || "x10a", trace?.epoch ?? null]);
}
let dhwSelection = { scope: "", end: null }, dhwExpiry;
function markCheckupDhwStale(stale = true) {
  if (dhwExpiry != null) clearTimeout(dhwExpiry);
  dhwExpiry = undefined;
  const host = globalThis.document?.getElementById?.("valueGroups"), state = String(stale);
  if (host?.getAttribute?.("data-dhw-stale") !== state) host?.setAttribute?.("data-dhw-stale", state);
}
function checkupDhwFreshAge(trace, report, check) {
  if (report?.source_fresh === false || check?.reason === "source_stale" ||
      S.otaCached || S.transportUnavailable === "status") return Infinity;
  // DHW comes entirely from /status. An omitted or rejected timeline leaves freshness unknown.
  if (!trace) return NaN;
  if (!trace.live) return Infinity;
  // The device times are whole seconds. Include their uncertainty and the request age.
  return historyClock() - S.statusRequestedAt + 1000 * (trace.window_end_s - trace.observed_end_s + 1);
}
function syncCheckupDhwFreshness(trace, report, check) {
  const age = checkupDhwFreshAge(trace, report, check);
  markCheckupDhwStale(age >= 15000);
  if (age >= 0 && age < 15000)
    dhwExpiry = setTimeout(markCheckupDhwStale, 15000 - age);
}
// Called at status adoption as well as rendering: a held click/gesture cannot leave the
// previous source or reset epoch's evidence interactive while its replacement is pending.
function retireCheckupDhwTimeline() {
  const slot = globalThis.document?.getElementById?.("valueGroups")?.querySelector?.("[data-checkup-dhw]");
  if (!slot) return;
  const report = S.status?.health, check = report?.checks?.find(c => c.id === "dhw_loss");
  const trace = checkupDhwTimeline(check), scope = checkupDhwScope(trace, report);
  syncCheckupDhwFreshness(trace, report, check);
  if (slot.dataset.dhwScope !== scope) {
    if (S.cancelDhwDrag) S.cancelDhwDrag();
    const focused = slot.contains?.(globalThis.document?.activeElement);
    slot.textContent = "";
    delete slot._dhwKey;
    slot.dataset.dhwScope = scope;
    dhwSelection = { scope, end: null };
    if (focused) slot.closest(".vitem")?.querySelector('[data-desc="model:health_dhw_loss"]')
      ?.focus({ preventScroll: true });
  }
}
function syncCheckupDhwChart(card) {
  if (S.stage !== "dashboard" || S.scrub || card?.dataset.dashboardCard !== "diagnosis" ||
      !S.descOpen.has("model:health_dhw_loss")) return;
  const slot = card.querySelector(".vitem.open [data-checkup-dhw]");
  if (slot) renderCheckupDhwChart(slot);
}
function renderCheckupDhwChart(slot, open = true) {
  const panel = slot.closest(".checkup-dhw-detail");
  if (panel) panel.inert = !open;
  if (!open) {
    if (S.cancelDhwDrag) S.cancelDhwDrag();
    slot.textContent = "";
    delete slot._dhwKey;
    return;
  }
  const report = S.status?.health || {};
  const c = report.checks?.find(c => c.id === "dhw_loss");
  const trace = checkupDhwTimeline(c), scope = checkupDhwScope(trace, report);
  if (dhwSelection.scope !== scope) dhwSelection = { scope, end: null };
  slot.dataset.dhwScope = scope;
  // Frame/freshness scalars are patched on connected nodes. Only actual record, locale or
  // lifecycle changes construct a chart; ordinary polling never detaches its bars or controls.
  const key = JSON.stringify([LANG, scope, trace?.windows ?? null]);
  if (slot._dhwKey !== key) {
    replaceHistoryHtml(slot, checkupDhwChartHtml(trace, scope));
    slot._dhwKey = key;
  }
  const chart = slot.querySelector("[data-dhw-timeline]");
  if (chart) {
    chart._dhwTrace = trace;
    updateCheckupDhwGeometry(chart, trace);
    paintCheckupDhwChart(chart);
    wireCheckupDhwChart(chart);
  }
  const item = slot.closest(".vitem");
  if (item && !item._dhwDisclosures) {
    item._dhwDisclosures = true;
    item.addEventListener("toggle", e => {
      const key = e.target.dataset?.dhwDisclosure;
      if (!key) return;
      const id = `dhw:${key}`;
      if (e.target.open) S.descOpen.add(id); else S.descOpen.delete(id);
      delete _html.valueGroups;
    }, true);
  }
  syncCheckupDhwFreshness(trace, report, c);
}
function checkupDhwWindowTime(trace, w) {
  if (!trace.unix_s) {
    const before = s => t("check.dhw.before_snapshot", checkupCyclingDuration(trace.window_end_s - s));
    return `${before(w.start_s)} – ${before(w.end_s)}`;
  }
  const stamp = new Intl.DateTimeFormat(LANG, { month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" });
  const at = s => stamp.format(new Date((trace.unix_s + s - trace.window_end_s) * 1000));
  return `${at(w.start_s)} – ${at(w.end_s)}`;
}
function checkupDhwMarkerText(w) {
  const marker = present => t(`check.dhw.marker_${present ? "yes" : "no"}`);
  return `${t("check.dhw.pump")}: ${marker(w.pump_marker)} · ${t("check.dhw.draw")}: ${marker(w.draw_marker)}`;
}
function checkupDhwChartHtml(trace, scope) {
  if (!trace) return `<div class="vdesc-p checkup-dhw-empty">${esc(t("check.dhw.timeline_unavailable"))}</div>`;
  const scale = Math.max(1, ...trace.windows.map(w => w.rate_k_h));
  const bars = trace.windows.map(w =>
    `<button type="button" class="checkup-dhw-window${w.rate_k_h === 0 ? " is-zero" : ""}"` +
    ` data-dhw-window="${w.end_s}" data-start-s="${w.start_s}" data-end-s="${w.end_s}"` +
    ` data-rate="${w.rate_k_h}" tabindex="-1" aria-pressed="false">` +
    `<span class="checkup-dhw-bar" aria-hidden="true" style="height:${w.rate_k_h / scale * 100}%"></span></button>`).join("");
  const lane = name => `<div class="checkup-dhw-lane" data-dhw-lane="${name}" aria-hidden="true">` +
    trace.windows.filter(w => w[`${name}_marker`]).map(w =>
      `<span data-dhw-marker="${w.end_s}" class="checkup-dhw-marker ${name}"></span>`).join("") + `</div>`;
  const readout = trace.windows.length ?
    `<div class="checkup-dhw-window-details">` +
    `<button type="button" data-dhw-action="previous" aria-label="${esc(t("check.dhw.previous"))}">‹</button>` +
    `<div class="checkup-dhw-readout" aria-live="off" aria-atomic="true">` +
    `<div class="vdesc-n num" data-dhw-readout="rate"></div><div data-dhw-readout="time"></div>` +
    `<div data-dhw-readout="coverage"></div><div data-dhw-readout="markers"></div></div>` +
    `<button type="button" data-dhw-action="next" aria-label="${esc(t("check.dhw.next"))}">›</button></div>` :
    `<div class="vdesc-p checkup-dhw-empty">${esc(t("check.dhw.timeline_empty"))}</div>`;
  return `<div class="vhist checkup-dhw-chart" data-dhw-timeline="${esc(scope)}" role="group"` +
    ` aria-label="${esc(t("hist.aria", t("check.dhw_loss")))}">` +
    `<div class="vhist-head"><span class="vhist-t">${esc(t("check.dhw.chart_title"))}</span><span>K/h</span></div>` +
    `<div class="checkup-dhw-grid"><div class="checkup-dhw-y" aria-hidden="true"><span>${esc(checkupFmt1(scale))}</span><span>0</span></div>` +
    `<div class="checkup-dhw-plot"><span class="checkup-dhw-before" aria-hidden="true"></span>` +
    `<span class="checkup-dhw-unread" aria-hidden="true"></span>${bars}</div>` +
    `<div></div><div class="vhist-axis checkup-dhw-axis" aria-hidden="true">` +
    `<span data-dhw-axis="0"></span><span data-dhw-axis="12"></span><span data-dhw-axis="24"></span></div>` +
    `<span class="checkup-dhw-lane-label">${esc(t("check.dhw.pump"))}</span>${lane("pump")}` +
    `<span class="checkup-dhw-lane-label">${esc(t("check.dhw.draw"))}</span>${lane("draw")}</div>` +
    `<div class="checkup-dhw-caption">${esc(t("check.dhw.timed_scope", trace.windows.length))}</div>` +
    `<div class="checkup-dhw-caption">${esc(t("check.dhw.blank"))}</div>` + readout + `</div>`;
}
function checkupDhwText(node, value) {
  if (!node || node.textContent === value) return;
  if (node.childNodes?.length === 1 && node.firstChild?.nodeType === 3)
    node.firstChild.nodeValue = value;
  else node.textContent = value;
}
function updateCheckupDhwGeometry(chart, trace) {
  chart.dataset.dhwClock = trace.unix_s ? "wall" : "relative";
  const start = trace.window_end_s - 86400;
  const pct = s => Math.max(0, Math.min(100, (s - start) * 100 / 86400));
  for (const w of trace.windows) {
    const button = chart.querySelector(`[data-dhw-window="${w.end_s}"]`);
    button.style.left = `${pct(w.start_s)}%`;
    button.style.width = `${pct(w.end_s) - pct(w.start_s)}%`;
    const label = `${checkupDhwWindowTime(trace, w)} · ${checkupFmt1(w.rate_k_h)} K/h · ${checkupDhwMarkerText(w)}`;
    if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
    for (const marker of chart.querySelectorAll(`[data-dhw-marker="${w.end_s}"]`))
      marker.style.left = `${(pct(w.start_s) + pct(w.end_s)) / 2}%`;
  }
  chart.querySelector(".checkup-dhw-before").style.width = `${pct(trace.since_s)}%`;
  const last = trace.observed_end_s ?? trace.since_s;
  const unread = chart.querySelector(".checkup-dhw-unread");
  unread.style.left = `${pct(last)}%`;
  unread.style.width = `${100 - pct(last)}%`;
  const clock = trace.unix_s && new Intl.DateTimeFormat(LANG, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const h of [0, 12, 24]) checkupDhwText(chart.querySelector(`[data-dhw-axis="${h}"]`), clock
    ? clock.format(new Date((trace.unix_s - (24 - h) * 3600) * 1000))
    : h === 24 ? t("check.dhw.snapshot") : `−${24 - h} h`);
}
function paintCheckupDhwChart(chart, end = dhwSelection.end, announce = false) {
  // Announce deliberate window exploration, never every scalar poll's relative-time update.
  chart.querySelector(".checkup-dhw-readout")?.setAttribute("aria-live", announce ? "polite" : "off");
  const trace = chart._dhwTrace;
  if (!trace) return;
  const windows = trace.windows;
  const chosen = windows.find(w => String(w.end_s) === String(end)) || windows.at(-1);
  dhwSelection = { scope: chart.dataset.dhwTimeline, end: chosen?.end_s ?? null };
  for (const button of chart.querySelectorAll("[data-dhw-window]")) {
    const selected = button.dataset.dhwWindow === String(chosen?.end_s);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  if (!chosen) return;
  const text = (key, value) => checkupDhwText(chart.querySelector(`[data-dhw-readout="${key}"]`), value);
  text("rate", `${checkupFmt1(chosen.rate_k_h)} K/h`);
  text("time", checkupDhwWindowTime(trace, chosen));
  text("coverage", t("check.hour.coverage", checkupCyclingDuration(chosen.observed_s),
    checkupCyclingDuration(chosen.end_s - chosen.start_s)));
  text("markers", checkupDhwMarkerText(chosen));
  const index = windows.indexOf(chosen);
  chart.querySelector('[data-dhw-action="previous"]').disabled = index === 0;
  chart.querySelector('[data-dhw-action="next"]').disabled = index === windows.length - 1;
}
function wireCheckupDhwChart(chart) {
  if (chart._dhwWired) return;
  chart._dhwWired = true;
  const buttons = () => [...chart.querySelectorAll("[data-dhw-window]")];
  const select = (button, focus = false) => {
    if (!button || chart.closest("[hidden], [inert]")) return;
    paintCheckupDhwChart(chart, button.dataset.dhwWindow, true);
    if (focus) button.focus({ preventScroll: true });
  };
  chart.addEventListener("click", e => {
    const action = e.target.closest("[data-dhw-action]");
    if (action) {
      const list = buttons(), index = list.findIndex(b => b.getAttribute("aria-pressed") === "true");
      select(list[index + (action.dataset.dhwAction === "previous" ? -1 : 1)]);
    } else select(e.target.closest("[data-dhw-window]"));
  });
  chart.addEventListener("keydown", e => {
    if (!e.target.matches("[data-dhw-window]")) return;
    const list = buttons(), i = list.indexOf(e.target);
    const index = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: list.length - 1,
      Escape: list.length - 1 }[e.key];
    if (!Number.isInteger(index)) return; // Enter/Space retain the native button action.
    e.preventDefault();
    e.stopPropagation();
    select(list[Math.max(0, Math.min(list.length - 1, index))], true);
  });
  chart.addEventListener("focusin", e => select(e.target.closest("[data-dhw-window]")));
  let drag, watchdog;
  const finish = e => {
    if (!drag || (e?.pointerId != null && e.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    clearTimeout(watchdog);
    for (const event of ["pointerup", "pointercancel"]) document.removeEventListener(event, finish);
    if (S.scrub === "checkup-dhw") S.scrub = null;
    try { chart.releasePointerCapture(id); } catch {}
  };
  S.cancelDhwDrag = finish;
  chart.addEventListener("pointerdown", e => {
    if (e.button !== 0 || S.scrub || !e.target.closest("[data-dhw-window]")) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    S.scrub = "checkup-dhw";
    for (const event of ["pointerup", "pointercancel"]) document.addEventListener(event, finish);
    watchdog = setTimeout(finish, SCRUB_MAX_MS);
  });
  chart.addEventListener("pointermove", e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
    if (!drag.moved && dy > dx && dy > 6) return finish(); // Leave vertical touch scrolling native.
    if (!drag.moved && dx <= 6) return;
    drag.moved = true;
    S.scrub = "checkup-dhw";
    e.preventDefault();
    try { chart.setPointerCapture(e.pointerId); } catch {}
    const plot = chart.querySelector(".checkup-dhw-plot").getBoundingClientRect();
    const at = chart._dhwTrace.window_end_s - 86400 + (e.clientX - plot.left) * 86400 / plot.width;
    const w = chart._dhwTrace.windows.find(w => w.start_s <= at && at <= w.end_s);
    // A blank interval is not a zero window and cannot select neighbouring evidence.
    if (w) select(chart.querySelector(`[data-dhw-window="${w.end_s}"]`));
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"])
    chart.addEventListener(event, finish);
}
function checkupDhwDetailHtml(c, fullSpan, report) {
  const hasRate = checkupDhwHasRate(c), scope = checkupDhwScope(checkupDhwTimeline(c), report);
  const count = Number.isInteger(c.windows) && c.windows >= 0 ? c.windows.toLocaleString(LANG) : "—";
  let assessment = hasRate ? t("check.dhw.measurement")
    : c.blocked ? t("check.detail.dhw_blocked", 0, "", "")
    : c.verdict === "unavailable" ? t("check.detail.unavailable")
    : Number(c.settle_remaining_s) > 0
      ? t("check.detail.dhw_settling", count, "", checkupDuration(c.settle_remaining_s))
    : Number(c.candidate_s) > 0
      ? t("check.detail.dhw_candidate", count, "", checkupDuration(c.candidate_s), checkupDuration(3600))
      : t("check.detail.dhw_waiting", count, "");
  if (hasRate && c.evidence === "heuristic" && ["info", "warn"].includes(c.verdict))
    assessment += ` ${t("check.dhw.hint")}`;
  const value = hasRate ? `${esc(checkupFmt1(c.max_k_h))}<span class="checkup-dhw-unit">K/h</span>`
    : esc(checkupStatusText(c));
  const energy = checkupDhwEnergy(c);
  const disclosure = (key, label, body) => `<details class="checkup-dhw-disclosure" data-dhw-disclosure="${key}"` +
    `${S.descOpen.has(`dhw:${key}`) ? " open" : ""}><summary>${esc(t(label))}${chevIcon}</summary>` +
    `<div class="checkup-dhw-disclosure-body">${body}</div></details>`;
  return `<div class="checkup-dhw-detail"${S.descOpen.has("model:health_dhw_loss") ? "" : " inert"}><div class="checkup-dhw-hero">` +
    (hasRate ? `<div class="checkup-dhw-heading">${esc(t("check.dhw.maximum"))}</div>` : "") +
    `<div class="checkup-dhw-value num${hasRate ? " has-rate" : ""}">${value}</div>` +
    `<div class="vdesc-p checkup-dhw-assessment">${esc(assessment)}</div></div>` +
    `<div class="vdesc-p checkup-dhw-stale">${esc(t("check.dhw.stale"))}</div>` +
    `<div data-checkup-dhw data-dhw-scope="${esc(scope)}"></div>` +
    `<div class="vdesc-p checkup-dhw-limit">${esc(t("check.dhw.limit"))}</div>` +
    disclosure("basis", "check.dhw.basis", checkupGenericDetailHtml(c, fullSpan, report)) +
    (energy ? disclosure("energy", "check.dhw.energy", descParaHtml(esc(energy))) : "") + `</div>`;
}

// Fault copy follows the unit’s reported class. A remembered message does not establish
// its cause, resolution or current severity when the source is unreadable.
function checkupDetailKey(c, statusKey) {
  if (c.id === "retries" && statusKey === "info") return "check.detail.experimental";
  if (c.id === "fault") {
    if (statusKey === "warn") return "check.detail.fault.error";
    if (statusKey === "info") {
      if (c.active === 1) return "check.detail.fault.warning";
      if (c.active === 0) return "check.detail.fault.past";
      return "check.detail.fault.past_unknown";
    }
  }
  const specific = `check.detail.${c.id}.${statusKey}`;
  if (t(specific) !== specific) return specific;
  return `check.detail.${statusKey}`;
}

// The reasons the firmware sent, as words. It sends SLUGS and never a bitmask, so this translates
// rather than decodes — an unknown slug from a newer firmware is dropped instead of rendering a
// placeholder that looks like a cause.
function checkupDhwReasons(c, isModbus = false) {
  const list = Array.isArray(c.abort_reasons) ? c.abort_reasons : [];
  return list.map((r) => t(`check.detail.dhw_reason.${isModbus && r === "blind" ? "blind_modbus" : r}`))
             .filter((s) => s && !s.startsWith("check.detail."))
             .join(", ");
}

const checkupFmt1 = (n) => n.toLocaleString(LANG, { maximumFractionDigits: 1 });
function checkupDetailHtml(c, fullSpan = c.full_span === true, report = {}) {
  if (c.id === "fault") return checkupFaultDetailHtml(c, report);
  if (c.id === "cycling") return checkupCyclingDetailHtml(c, report);
  if (c.id === "dhw_loss") return checkupDhwDetailHtml(c, fullSpan, report);
  return checkupGenericDetailHtml(c, fullSpan, report);
}
function checkupGenericDetailHtml(c, fullSpan, report) {
  const isModbus = report?.source === "modbus";
  const statusKey = checkupStatusKey(c);
  const metric = checkupMetricValue(c);
  const parts = metric.split(" · ");
  const compactMetric = ["dhw_loss", "defrost"].includes(c.id);
  const value = (compactMetric ? parts.shift() : metric) || checkupStatusText(c);
  const description = MODEL_DESCRIPTIONS[`health_${c.id}`];
  const copy = modelDescriptionCopy(`health_${c.id}`);
  const base = LANG === "de" && description.de ? description.de : description;
  const what = copy ? copy[0] : base.what;
  const normal = copy ? copy[1] : base.normal;
  if (c.id === "pressure" && c.verdict !== "unavailable" && hasHist("water_pressure")) {
    return descNoteHtml(t("normal.label"), normal);
  }
  let detail;
  // Discard reasons are aggregates, without a per-candidate cause ranking. Missing readings
  // include necessary valve/heater/pump inputs as well as tank temperature; missing X10A/HomeHub
  // replies and deliberate board-side polling pauses can both create that gap.
  if (c.id === "dhw_loss" && c.blocked === true) {
    const reasons = Array.isArray(c.abort_reasons) ? c.abort_reasons : [];
    const blindOnly = Number(c.aborts) > 0 && reasons.length === 1 && reasons[0] === "blind";
    const sentence = blindOnly
      ? t("check.detail.dhw_blocked_link", Number(c.aborts) || 0,
          checkupDuration(c.best_aborted_s))
      : t("check.detail.dhw_blocked", Number(c.aborts) || 0, checkupDhwReasons(c, isModbus),
          checkupDuration(c.best_aborted_s));
    detail = sentence;
  }
  if (statusKey === "collecting" && !detail) {
    if (c.id === "dhw_loss") {
      const done = Number.isFinite(c.windows) ? c.windows.toLocaleString(LANG)
                                            : checkupDuration(c.observed_s);
      const required = checkupDuration(c.required_s);
      if (Number(c.settle_remaining_s) > 0) {
        detail = t("check.detail.dhw_settling", done, required,
                   checkupDuration(c.settle_remaining_s));
      } else if (Number(c.candidate_s) > 0) {
        detail = t("check.detail.dhw_candidate", done, required,
                   checkupDuration(c.candidate_s), checkupDuration(3600));
      } else {
        detail = t("check.detail.dhw_waiting", done, required);
      }
      // Appended to all three: what was thrown away is the same fact whatever is happening now, and
      // it is the half that says whether waiting will ever help.
      if (Number(c.aborts) > 0)
        detail += t("check.detail.dhw_aborted", Number(c.aborts), checkupDhwReasons(c, isModbus),
                    checkupDuration(c.best_aborted_s));
    } else {
      detail = c.required_s > 0
        ? t("check.detail.collecting", checkupDuration(c.observed_s), checkupDuration(c.required_s))
        : t("check.detail.collecting_unknown");
    }
  } else if (!detail) {
    const hydronicEvidence = !isModbus && c.id === "flow" && checkupHydronicKnown(c.hydronic);
    detail = t(statusKey === "unavailable" && hydronicEvidence
      ? "check.detail.observation" : checkupDetailKey(c, statusKey));
  }
  // The reason is selected by firmware, not inferred from missing numbers in the browser.
  const reasonKey = {
    defrost_events_insufficient: "defrost_events_insufficient",
    source_stale: isModbus ? "source_stale_modbus" : "source_stale",
    no_paired_runtime: "no_paired_runtime",
  }[c.reason];
  if (reasonKey) detail += ` ${t(`check.detail.${reasonKey}`)}`;
  if (compactMetric && c.id !== "dhw_loss" && parts.length) detail += ` ${parts.join(" · ")}.`;
  if (c.id === "dhw_loss" && statusKey !== "collecting" && !c.blocked && Number(c.aborts) > 0)
    detail += t("check.detail.dhw_aborted", Number(c.aborts), checkupDhwReasons(c, isModbus),
                checkupDuration(c.best_aborted_s));
  if (c.id === "defrost") {
    if (checkupOutdoorContext(c)) detail += t("check.detail.outdoor_defrost");
    const start = c.last_observed_start;
    if (start && typeof start === "object") {
      const missing = t("sys.nodata");
      const date = Number.isInteger(start.unix_s) && start.unix_s > 0 && start.unix_s <= 0xffffffff
        ? new Date(start.unix_s * 1000).toLocaleString(LANG,
            { dateStyle: "short", timeStyle: "short" }) : missing;
      const route = start.route === "space_heating" ? t("check.defrost.route_space")
        : start.route === "dhw_route" ? t("check.defrost.route_dhw") : missing;
      const outdoor = Number.isFinite(start.outdoor_c) ? `${checkupFmt1(start.outdoor_c)} °C` : missing;
      detail += ` ${t("check.defrost.last_start", date, route, outdoor)}`;
    }
  }
  // Three paragraphs: observation with its real time scope, current interpretation, then normal
  // context. A report window is never a verdict's "since" timestamp.
  const time = [];
  if (Number.isFinite(report.span_s))
    time.push(`${t("check.detail.period_label")} ${checkupDuration(report.span_s)}`);
  if ((report.source_fresh === false || c.reason === "source_stale") && Number.isFinite(report.source_age_s))
    detail += ` ${t("check.detail.age_label")} ${dwellDuration(report.source_age_s)}.`;
  if (c.id === "heater") {
    const channelCoverage = [["BUH", c.buh_observed_s], ["BSH", c.bsh_observed_s]]
      .filter(([, duration]) => Number.isFinite(duration))
      .map(([label, duration]) => t("check.detail.channel_coverage", label, checkupDuration(duration)));
    if (channelCoverage.length) detail += ` ${channelCoverage.join(" · ")}.`;
  }
  if (report.source_fresh === false && c.reason !== "source_stale")
    detail += ` ${t(isModbus ? "check.detail.source_stale_modbus" : "check.detail.source_stale")}`;
  if (statusKey === "collecting" && Number(c.required_s) > Number(c.observed_s))
    detail += ` ${t("check.detail.coverage_missing",
                    Math.ceil(c.required_s - c.observed_s).toLocaleString(LANG))}`;
  // Only the bounded daily assessments need a complete day; flow waits for eligible pump time.
  if (["pressure", "defrost"].includes(c.id) && statusKey === "collecting" &&
      fullSpan === false && Number.isFinite(report.span_s) &&
      ["day_incomplete", "input_coverage"].includes(c.reason))
    detail += ` ${t("check.detail.horizon_wait",
                   checkupDuration(Math.max(0, 86400 - report.span_s)))}`;
  if (c.id === "dhw_loss" && checkupDhwHasRate(c) && !c.blocked &&
      Number.isFinite(c.pump_windows) && Number.isFinite(c.draw_windows) &&
      Number.isFinite(c.quiet_high_windows))
    detail += ` ${t("check.detail.dhw_context",
      c.pump_windows.toLocaleString(LANG), c.draw_windows.toLocaleString(LANG),
      c.quiet_high_windows.toLocaleString(LANG))}`;
  // DHW's value and short interpretation lead its panel; the longer evidence remains in
  // the collapsed basis. Its separately collapsed energy example is never part of the chart.
  if (c.id === "dhw_loss")
    return (time.length ? descParaHtml(esc(time.join(" · "))) : "") +
      (metric ? descParaHtml(esc(metric)) : "") + descParaHtml(esc(detail)) +
      descNoteHtml(t("normal.label"), normal);
  const [hydronicMeasurements, hydronicContext] = checkupHydronicHtml(c, isModbus);
  return descParaHtml(`<span class="vdesc-n">${esc(value)}</span>` +
           (time.length ? ` · ${esc(time.join(" · "))}` : "") + ` — ${esc(what)}` +
           hydronicMeasurements) +
         descParaHtml(esc(detail) + hydronicContext) +
         descNoteHtml(t("normal.label"), normal);
}

function checkupDefrostShare(c) {
  const part = Number(c.defrost_s), total = Number(c.run_s);
  if (Number.isFinite(part) && part >= 0 && Number.isFinite(total) && total > 0) {
    if (part === 0) return "0 %";
    const exact = part * 100 / total;
    if (exact < 1) return "<1 %";
    // Five decimals keep every rational step distinguishable around an integer-percent boundary for
    // a denominator up to this 86,400-second window. Floor rather than round so the renderer never
    // crosses any firmware-owned limit, without copying that limit into the browser.
    const hundredThousandth = Math.floor(exact * 100000) / 100000;
    return `${hundredThousandth.toFixed(5).replace(/\.?0+$/, "")} %`;
  }
  return c.share_pct == null ? "" : `${c.share_pct} %`; // older firmware
}

function checkupHeaterRuntime(seconds, minutes) {
  if (seconds != null) return checkupDuration(seconds);
  return minutes == null ? "" : t("check.min", minutes); // older firmware
}

function checkupHeaterValue(c) {
  const parts = [];
  for (const [label, seconds, legacyMinutes] of [
    ["check.buh_short", c.buh_s, c.buh_min], ["check.tank_short", c.bsh_s, c.bsh_min],
  ]) {
    if (seconds != null && !Number.isFinite(seconds)) continue;
    const minutes = seconds == null ? legacyMinutes : seconds / 60;
    if (!Number.isFinite(minutes) || minutes < 0) continue;
    const value = minutes > 0 && minutes < 1 ? "<1"
      : Math.floor(minutes).toLocaleString(LANG, { useGrouping: false });
    parts.push(`${t(label)} ${value}`);
  }
  return parts.length ? t("check.min", parts.join(" · ")) : "";
}

function checkupOutdoorContext(c) {
  if (typeof c.outdoor_source !== "string" ||
      !Number.isFinite(c.outdoor_min_c) || !Number.isFinite(c.outdoor_mean_c) ||
      !(Number(c.outdoor_samples) > 0)) return "";
  const fmt = (n) => n.toLocaleString(LANG,
    { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const source = c.outdoor_source === "homehub" ? "Modbus" : outdoorSourceLabel(c.outdoor_source);
  return c.outdoor_min_c === c.outdoor_mean_c
    ? t("check.outdoor_one", source, fmt(c.outdoor_mean_c))
    : t("check.outdoor_range", source, fmt(c.outdoor_min_c), fmt(c.outdoor_mean_c));
}

function checkupWithOutdoor(c, value) {
  return [value, checkupOutdoorContext(c)].filter(Boolean).join(" · ");
}

function checkupCyclingCountPrefix(n) {
  return n > 0 ? "≥" : "";
}

// One row's value text. Every branch that has no number says so with a dash — a check that could not
// be evaluated must never print a plausible zero (DESIGN.md's "an idle plant with no readings, not a
// stale one", applied to a count).
function checkupMetricValue(c) {
  const v = c.verdict;
  // Count-only defrost evidence without an RPS witness or positive runtime denominator is a supported
  // observation. `unavailable` means the defrost row itself was absent, so even a legacy payload's
  // numeric zero proves nothing.
  if (v === "unavailable") return "";
  const collecting = v === "collecting";
  switch (c.id) {
    case "fault":
      if (v === "warn") return t("check.fault_err");
      if (v === "info") {
        if (c.active === 1) return t("check.fault_warn");
        if (c.active === 0) return t("check.fault_past");
        return t("check.fault_past_unknown");
      }
      if (c.active == null) return t("check.fault_unknown");
      return t("check.fault_none");
    case "dhw_loss": {
      if (c.blocked === true) return "";
      if (!checkupDhwHasRate(c)) return Number.isFinite(c.windows) && c.windows > 0
        ? t("check.loss_windows", c.windows) : "";
      const high = c.high_windows == null ? "" : t("check.loss_high", c.high_windows, c.windows || 0);
      // Circulation counts aggregate several hours; they cannot qualify the maximum hour.
      return [t("check.loss_max", checkupFmt1(c.max_k_h)), high || t("check.loss_windows", c.windows || 0)].filter(Boolean).join(" · ");
    }
    case "cycling":
      return Number.isInteger(c.starts) && c.starts >= 0
        ? checkupCyclingCountPrefix(c.starts) + t("check.starts", c.starts) : "";
    case "defrost": {
      if (c.count == null) return "";
      const n = t("check.cycles", c.count);
      if (collecting) return checkupWithOutdoor(c, n);
      const share = checkupDefrostShare(c);
      const paired = c.paired_count == null ? "" : t("check.paired_cycles", c.paired_count);
      return checkupWithOutdoor(c, [n, paired, share].filter(Boolean).join(" · "));
    }
    case "pressure": {
      if (v === "warn" && Number.isFinite(c.min_bar))
        return `${t("check.detail.pressure.warn")} · ${checkupFmt1(c.min_bar)} bar`;
      if (v === "info" && Number.isFinite(c.min_bar))
        return `${t("check.detail.pressure.info")} · ${checkupFmt1(c.min_bar)} bar`;
      const shown = Number.isFinite(c.current_bar) ? c.current_bar : c.min_bar;
      return !Number.isFinite(shown) ? "" : `${checkupFmt1(shown)} bar`;
    }
    case "flow":
      return !Number.isFinite(c.min_l_min) ? "" : `${checkupFmt1(c.min_l_min)} l/min`;
    case "heater": {
      const parts = [];
      const buh = checkupHeaterRuntime(c.buh_s, c.buh_min);
      const bsh = checkupHeaterRuntime(c.bsh_s, c.bsh_min);
      if (buh) parts.push(t("check.buh_runtime", buh));
      if (bsh) parts.push(t("check.tank_runtime", bsh));
      return parts.join(" · ");
    }
    case "retries":  return c.seen == null ? "" : c.seen ? t("check.retry_seen") : t("check.retry_none");
  }
  return "";
}

function checkupFaultRow(c) {
  if (!c || c.verdict === "unavailable" || c.verdict === "collecting")
    return { text: checkupStatusText(c), aria: "" };
  if (c.verdict === "ok" && c.active === 0)
    return { text: "", aria: t("check.fault_none") };
  if (c.latest && c.latest.code) {
    if (c.active === 1)
      return { text: `${c.latest.code} · ${t("check.fault_since_short", checkupFaultDuration(c.latest.duration_s))}`, aria: "" };
    if (c.active === 0 && c.verdict === "info")
      return { text: `${c.latest.code} · ${t("check.fault_ago_short", checkupFaultDuration(c.latest.age_s))}`, aria: "" };
    if (c.active == null)
      return { text: `${c.latest.code} · ${t("check.fault_unknown")}`, aria: "" };
  }
  return { text: checkupMetricValue(c) || checkupStatusText(c), aria: "" };
}

function checkupValue(c) {
  const st = checkupStatusText(c);
  if (c?.id === "fault") return checkupFaultRow(c).text;
  if (!c || c.verdict === "unavailable" || (c.id === "dhw_loss" && c.blocked === true)) return st;
  if (c.id === "dhw_loss")
    return checkupDhwHasRate(c) ? `${checkupFmt1(c.max_k_h)} K/h` : st;
  if (c.id === "cycling")
    return Number.isFinite(c.starts) && c.starts >= 0
      ? checkupCyclingCountPrefix(c.starts) + c.starts.toLocaleString(LANG) : st;
  if (c.id === "defrost") {
    const share = c.verdict !== "collecting" && checkupDefrostShare(c);
    return share || (Number.isFinite(c.count) && c.count >= 0 ? t("check.cycles", c.count) : st);
  }
  if (c.id === "heater") return checkupHeaterValue(c) || st;
  return (c.id === "fault" && c.verdict === "collecting") ? st : (checkupMetricValue(c) || st);
}

const checkupPressureHistoryMarkup = new WeakMap();
function checkupPressureHistoryHtml(id, unit, label) {
  const ring = S.hist.get(id);
  if (!ring) return histHtml(id, unit, label, "x10a", true);
  const revision = historyRingRevision(ring);
  const pin = S.histPin.get(id);
  const cached = checkupPressureHistoryMarkup.get(ring);
  if (cached?.id === id && cached.label === label && cached.epoch === S.histEpoch &&
      cached.lang === LANG && cached.pin === pin && cached.revision === revision)
    return cached.html;
  const html = histHtml(id, unit, label, "x10a", true);
  checkupPressureHistoryMarkup.set(ring, { id, label, epoch: S.histEpoch, lang: LANG, pin, revision, html });
  return html;
}

const MODBUS_HIDDEN_CHECKS = new Set(["defrost", "pressure", "retries"]);
function checkupCardHtml(includeHealth = true) {
  const h = S.status?.health;
  const source = h?.source || S.status?.diagnostics?.effective_source || "x10a";
  const isModbus = source === "modbus";
  const avail = S.status?.diagnostics?.available_sources;
  const dualAvail = Array.isArray(avail) && avail.includes("x10a") && avail.includes("modbus");
  const cardTitle = isModbus ? `${t("card.checkup")} · Modbus`
                  : dualAvail ? `${t("card.checkup")} · X10A`
                  : t("card.checkup");
  let healthRows = "";
  const unreadable = includeHealth && h?.persist === "unknown";
  const visibleChecks = Array.isArray(h?.checks)
    ? h.checks.filter((c) => {
        if (isModbus && (MODBUS_HIDDEN_CHECKS.has(c.id) || (c.id === "flow" && c.verdict === "unavailable")))
          return false;
        return includeHealth || (!isModbus && c.id === "flow" && checkupHydronicKnown(c.hydronic));
      })
    : [];
  if (unreadable) healthRows = `<span class="empty">${esc(t("sys.nodata"))}</span>`;
  if (!unreadable && visibleChecks.length) {
    for (const c of visibleChecks) {
      const key = CHECKUP_ROW[c.id];
      if (!key) continue;                             // a check this UI does not know: skipped, never guessed at
      const tone = CHECKUP_TONE[checkupStatusKey(c)] || "";
      const isPressure = c.id === "pressure" && c.verdict !== "unavailable" && hasHist("water_pressure");
      const rowVal = c.id === "fault" ? checkupFaultRow(c) : { text: checkupValue(c), aria: "" };
      healthRows += modelDescRow(`health_${c.id}`, t(key), rowVal.text,
                                 { cls: `checkup-val${tone ? ` ${tone}` : ""}`,
                                   ariaValue: rowVal.aria,
                                   bodyHtml: checkupDetailHtml(c, h.full_span === true, h),
                                   trendId: isPressure ? "water_pressure" : "",
                                   histUnit: isPressure ? "bar" : "",
                                   paused: isPressure ? ("diagnosis" !== S.dashboardCard) : undefined,
                                   renderHistory: isPressure ? checkupPressureHistoryHtml : undefined,
                                   chartFirst: isPressure });
    }
  }
  // This row remains independent of /status.health and is not counted by the badge below.
  // renderCards() gates the whole card on the diagnostics opt-in, including this observation.
  const rows = healthRows + (isModbus ? "" : refrigerantServiceRowHtml());
  if (!rows) return "";                               // older firmware — no card rather than an empty one
  if (unreadable || !healthRows || !includeHealth)
    return vcard(cardTitle, rows, "", "", "diagnosis", t("nav.diagnosis"));
  // Findings are counts of serialized verdicts, not a health score or a second threshold rule.
  const warnings = visibleChecks.filter(c => c.verdict === "warn").length;
  const notes = visibleChecks.filter(c => c.verdict === "info").length;
  const badge = warnings ? t("check.summary.warnings", warnings)
              : notes ? t("check.summary.notes", notes)
              : h.status === "ok" ? t("check.summary.ok")
              : h.status === "collecting" ? t("check.summary.collecting")
              : t("check.summary.observations");
  const badgeCls = { warn: "err", ok: "ok", collecting: "dim", unavailable: "dim" }[h.status] || "";
  return vcard(cardTitle, rows, badge, badgeCls, "diagnosis", t("nav.diagnosis"));
}

// A read-only context window for a qualified refrigerant service check.  This is deliberately not a
// ninth CHECKUP_ROW: it has no verdict, does not affect health counts and makes no browser-side
// threshold decision.  It is rendered as the same expandable status/description row used by the
// eight diagnoses, inside their card. Older firmware omits the object and gets no placeholder row.
function refrigerantServiceRowHtml() {
  if (refrigerantStatusUnavailable()) return "";
  const service = S.status?.refrigerant_service;
  if (!service || typeof service !== "object" || Array.isArray(service)) return "";

  const states = ["unsupported", "waiting", "observing", "limited", "interrupted"];
  const state = states.includes(service.state) ? service.state : "unknown";
  const tones = { unsupported: "dim", waiting: "dim", observing: "", limited: "dim",
                  interrupted: "dim", unknown: "dim" };
  const reasonSlugs = ["unsupported_profile", "compressor_not_running",
    "unsupported_or_unknown_mode", "dhw_path", "defrost", "unit_fault",
    "special_controller_phase", "missing_fresh_signal", "poll_gap"];

  const time = [], detail = [];
  const seconds = service.continuous_s, samples = service.samples;
  if (Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(samples) && samples >= 0)
    time.push(t("service.window", checkupDuration(seconds), Math.floor(samples)));
  if (typeof service.blocker === "string") {
    const reasonKey = reasonSlugs.includes(service.blocker)
      ? `service.reason.${service.blocker}` : "sys.nodata";
    detail.push(t(reasonKey));
  }
  const metricKeys = [
    ["compressor_rps", "comp", "rps"], ["discharge_c", "disch", "°C"],
    ["eev_command_pls", "eev", "pls"], ["high_pressure_bar", "hp", "bar"],
    ["low_pressure_bar", "lp", "bar"],
  ];
  let hasMetricMeta = false;
  for (const [key, inspectorKey, unit] of metricKeys) {
    const metric = service.metrics?.[key];
    const readable = metric && [metric.min, metric.mean, metric.max].every(Number.isFinite);
    const meta = service.metric_meta?.[key];
    const counted = meta && Number.isInteger(meta.samples) && meta.samples >= 0 && meta.samples <= 0xffffffff;
    // With no qualifying window, the existing blocker already explains the absence. Within an
    // observed window, a zero-count optional input remains visible beside the populated ranges.
    if (!readable && (!counted || !Number.isInteger(samples) || samples <= 0)) continue;
    const number = n => n.toLocaleString(LANG, { maximumFractionDigits: 1 });
    const label = t(`service.metric.${inspectorKey}`);
    let text = `${label}: ${readable ? t("service.metric.range", number(metric.min),
                              number(metric.mean), number(metric.max), unit) : t("sys.nodata")}`;
    if (counted) {
      hasMetricMeta = true;
      text += ` · ${t("service.metric.samples", meta.samples)}`;
      // Only the unselected state is named; a selected input with zero readings stays "no data".
      if (meta.source === null) text += ` · ${t("service.metric.input_none")}`;
    }
    detail.push(text);
  }
  if (hasMetricMeta) detail.push(t("service.metric.meta_limit"));
  const limitations = Array.isArray(service.limitations) ? service.limitations : [];
  const knownLimitations = ["special_phases_unavailable", "temperature_context_incomplete",
                           "pressure_sides_incomplete", "outdoor_context_incomplete"];
  const missing = limitations.filter(key => knownLimitations.includes(key))
                            .map(key => t(`service.limit.${key}`));
  // Older additive payloads still expose this one specific missing input.
  if (service.special_phases_known === false && !limitations.includes("special_phases_unavailable"))
    missing.unshift(t("service.limit.special_phases_unavailable"));
  if (missing.length) detail.push(`${t("service.row.limits")} ${missing.join(" · ")}`);
  // Waiting/unsupported carry a blocker; partial windows name missing inputs in the explanation.
  // Recording and interrupted windows add their continuity consequence beside the time.
  const helpKey = ["observing", "interrupted"].includes(state)
                ? `service.help.${state}` : null;
  const status = state === "unsupported" ? t("check.status.unavailable")
               : state === "unknown" ? t("sys.nodata") : t(`service.state.${state}`);
  const body = descParaHtml(`<span class="vdesc-n">${esc(status)}</span>` +
                 (time.length ? ` · ${esc(time.join(" · "))}` : "") +
                 ` — ${esc(t(helpKey || "service.title"))}`) +
               descParaHtml(detail.length
                 ? hasMetricMeta ? detail.map(esc).join("<br>") : esc(detail.join(" · "))
                 : esc(t("sys.nodata"))) +
               descNoteHtml(t("normal.label"), t("service.common"));
  return descAccordion("service:refrigerant", t("service.title"), esc(status),
                       `checkup-val${tones[state] ? ` ${tones[state]}` : ""}`, body);
}

// ── Connections tile (Settings — WiFi · MQTT · Syslog · NTP · Modbus) ─────────────────────────
// One tappable row per link: label, colour-coded value (green connected/synced, yellow reconnecting/
// syncing, red down — the same ok/warn/err semantics the rest of the app uses), a trailing
// pencil that opens that link's existing edit modal (§5.1 in docs/DESIGN.md). MAC/BSSID are dropped
// entirely (bus-level detail nobody edits from here) and the IP address lives in the dashboard
// header (renderHeaderMeta) — it is board identity, not a per-row WiFi fact.
//
// connLinks() derives the network/service rows' state ONCE and both consumers read it: the rows
// themselves and the header dot that summarises them a level up. Re-deriving "is this link healthy"
// for the summary is exactly how a menu ends up claiming everything is fine while the row behind it
// is red. X10A and ENV III live on their own Settings/dashboard surfaces, so the aggregate below
// adds those two independent links from the same red-state facts their own renderers use.
function modbusErrorText(mb) {
  if (!mb || !mb.error) return "";
  const code = String(mb.error_code || "");
  const reg = Number.isFinite(mb.error_register) ? mb.error_register : 0;
  const detail = Number.isFinite(mb.error_detail) ? mb.error_detail : -1;
  if (code === "modbus_exception") {
    const why = t(`modbus.exc.${detail}`);
    return t("modbus.err.exception", reg, detail, why.startsWith("modbus.exc.") ? t("modbus.exc.unknown") : why);
  }
  const key = `modbus.err.${code}`;
  const text = t(key, reg);
  // Forward compatibility: a newer firmware can introduce a structured code before this browser
  // asset knows it. In that case show the complete human-readable API message, never the key name.
  return code && text !== key ? text : String(mb.error);
}

// /status.mqtt.error is deliberately a bounded firmware-owned reason, not a broker address or
// credential. Keep the broker as the row's primary value and translate the known runtime reasons
// into an actionable second line. A newer firmware may add another literal before these assets are
// updated, so unknown text remains visible instead of degrading to an untranslated key.
function mqttErrorText(mqtt) {
  if (!mqtt || !mqtt.error) return "";
  const keys = {
    "waiting for X10A response": "mqtt.err.waiting_x10a",
    "publish task alloc failed": "mqtt.err.task_alloc",
    "tls/tcp error": "mqtt.err.transport",
    "broker refused (auth/creds?)": "mqtt.err.refused",
    "connection error": "mqtt.err.connection",
  };
  const raw = String(mqtt.error);
  return keys[raw] ? t(keys[raw]) : raw;
}

function connLinks() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, sy = S.status?.syslog || {}, nt = S.status?.ntp || {};
  const links = [];

  // THE WIRE, when there is one. A board on Ethernet has no radio started at all (main.cpp), so its
  // WiFi row below is truthfully "offline" — and that reads as a fault unless this row says what is
  // actually carrying the device. Shown only when a controller was DETECTED: on every board without
  // one there is no wire to have an opinion about, and a permanently-absent row is the thing the
  // modbus/env3 cards already refuse to render (an absent feature is stated by absence).
  //
  // No pencil: unlike WiFi there is nothing to configure — the transport is decided by whether a
  // cable is plugged in, which no dialog can change.
  const eth = S.status?.net?.eth || {};
  if (eth.present) {
    const speed = eth.speed_mbps != null
      ? `${eth.speed_mbps} Mbit/s${eth.full_duplex ? " " + t("conn.eth_fd") : ""}` : "";
    const state = eth.lease ? (speed || t("conn.connected")) : eth.link ? t("conn.eth_no_lease") : t("conn.eth_no_cable");
    links.push({ label: "Ethernet",
      cls: eth.lease ? "ok" : eth.link ? "warn" : "err",
      value: esc(state),
      state });
  }

  // WiFi has no "connecting" state in /status (just connected: true/false), so it is a two-state
  // ok/err row — signal bars keep their own strength-based tone regardless. On a wired board it is
  // deliberately still shown as offline rather than hidden: the radio really is off, and the row
  // above says why.
  if (w.connected && (w.rssi != null || w.ssid)) {
    links.push({ edit: "wifi", label: w.std || "Wi-Fi", cls: "ok",
      value: (w.rssi != null ? signalBars(w.rssi) : "") +
        (w.rssi != null ? ` <span class="conn-dbm">${w.rssi} dBm</span>` : "") +
        (w.ssid ? ` <span class="conn-name">${esc(w.ssid)}</span>` : ""),
      state: w.ssid ? t("conn.connected_to", w.ssid) : t("conn.connected") });
  } else {
    links.push({ edit: "wifi", label: w.std || "Wi-Fi", cls: "err",
      value: t("conn.offline"), state: t("conn.offline") });
  }

  if (!m.configured) {
    links.push({ edit: "mqtt", label: "MQTT", cls: "", value: t("conn.disabled"), state: t("conn.disabled") });
  } else {
    const detail = !m.connected ? mqttErrorText(m) : "";
    links.push({ edit: "mqtt", label: "MQTT",
      cls: m.connected ? "ok" : m.error ? "err" : "warn",
      // No TLS padlock marker: an mqtts:// broker already carries its own scheme in the URL, so the
      // icon only restated what the string says. A schemeless/mqtt:// broker is plaintext and shows none.
      value: esc(m.broker || "—"),
      detail,
      state: m.connected ? t("conn.connected") : detail ? t("conn.error", detail) : t("conn.connecting") });
  }

  if (!sy.configured) {
    links.push({ edit: "syslog", label: "Syslog", cls: "", value: t("conn.disabled"), state: t("conn.disabled") });
  } else {
    // Delivery is gated on DNS only (resolved); reachability is an advisory ping hint — green once
    // resolving, yellow (still forwarding) when the host doesn't answer the probe or resolution is
    // still pending, red on a DNS error.
    links.push({ edit: "syslog", label: "Syslog",
      cls: sy.error ? "err" : sy.resolved ? (sy.reachable ? "ok" : "warn") : "warn",
      value: esc(sy.host ? `${sy.host}:${sy.port || 514}` : "—"),
      state: sy.error ? sy.error : sy.resolved ? (sy.reachable ? t("conn.enabled") : t("conn.enabled_noping")) : t("conn.resolving") });
  }

  // NTP has no "disabled" or error state (unlike MQTT/Syslog) — it always has a server, so it is a
  // two-state ok/warn row keyed on whether the first sync of this boot has landed.
  links.push({ edit: "ntp", label: "NTP", cls: nt.synced ? "ok" : "warn",
    value: esc(nt.server || "—"), state: nt.synced ? t("conn.synced") : t("conn.syncing") });

  // The HomeHub, as its OWN row — never folded into a combined link state with X10A. The two stacks
  // fail for unrelated reasons and either can be down alone, so one merged "connected" would hide
  // exactly the case worth seeing. ALWAYS present, even with no configured address. It used to
  // appear only while the stack
  // was `enabled` — i.e. only once an address existed — which stranded the exact user this setting
  // is for: no address means no task, the row is never drawn,
  // and there is no longer anywhere in the UI to type the address in. The standalone HomeHub card
  // was removed at the same time, so on a board with no X10A and no discovered hub the feature had
  // no reachable entry point at all. A configuration row is not a status readout; it has to exist
  // before the thing it configures does.
  const mbs = S.status?.modbus;
  if (mbs) {
    const off = !mbs.host;
    const detail = !off && mbs.enabled ? modbusErrorText(mbs) : "";
    // This row reports LINK HEALTH, so it uses the shared status palette. Petrol remains reserved
    // for Modbus READING provenance in the value tables, schematic and inspector.
    const cls = off ? "" : mbs.connected ? "ok" : "err";
    const state = off ? t("conn.disabled")
                : mbs.connected ? t("conn.connected")
                : t("conn.offline");
    const endpoint = !off ? `${mbs.host}:${mbs.port || 502}` : "—";
    links.push({ edit: "homehub", label: t("conn.homehub"), cls,
      value: esc(endpoint),
      detail, state: detail ? t("conn.error", detail) : state });
  }

  return S.transportUnavailable === "status"
    ? links.map(l => ({ ...l, cls: "dim", state: t("sys.nodata"), detail: "",
      value: l.edit === "wifi" ? esc(w.ssid || "—") : l.value })) : links;
}
// The row conveys state by colour alone (the value IS the address/name, just tinted) — DESIGN.md
// §9's "status never conveyed by colour alone" would otherwise be broken for colourblind users and
// screen readers, so `state` (a plain-text status word, never shown visually) goes into the row's
// aria-label instead of the generic "Edit X" every other edit affordance in this app uses.
function connRow(l) {
  const aria = l.edit ? t("conn.aria", l.label, l.state) : `${l.label}: ${l.state}`;
  return `<button class="conn-row${l.detail ? " has-detail" : ""}" type="button"${l.edit ? ` data-edit="${esc(l.edit)}"` : " disabled"} aria-label="${esc(aria)}">` +
    `<span class="conn-label">${esc(l.label)}</span>` +
    `<span class="conn-value"><span class="conn-val ${l.cls}">${l.value}</span></span>` +
    `${l.edit ? editIcon : ""}${l.detail ? `<span class="conn-detail-wrap"><span class="conn-detail">${esc(l.detail)}</span></span>` : ""}</button>`;
}
function connectionsHtml() {
  return `<div class="section-label">${esc(t("conn.title"))}</div>` + connLinks().map(connRow).join("");
}
// The links the gear should call out as broken: `err` only. `warn` is the transient half of the
// vocabulary (MQTT still connecting, NTP not yet synced, a syslog host that ignores ping) and every
// boot passes through it, so raising the alarm on warn would leave the gear permanently marked and
// the marker would stop meaning anything. A disabled link (neutral, no class) is a choice, not a fault.
const connDown = () => connLinks().filter((l) => l.cls === "err");

// One status vocabulary for both consumers of the optional sensor link: its schematic pill and the
// Settings alert aggregate. Keeping the transient first sample distinct here prevents either
// surface from calling it a fault while the other still says "collecting".
function env3ConnectionTone(env) {
  return env?.fresh === true ? "ok" : env?.error === "collecting" ? "warn" : "err";
}

// Every broken configured link that must raise the gear's attention marker. X10A is the permanently
// expected heat-pump link and its Protocol-card value is red whenever `connected` is false. ENV III
// is optional: disabled/unsupported is neutral, and the short boot-time `collecting` phase is the
// same transient warning used by its schematic pill. Once configured, an unavailable or stale whole
// sample is a real failure and therefore joins the red network/service rows from connDown().
function settingsConnectionsDown() {
  const down = connDown();
  const hp = S.status?.hp;
  if (hp?.connected === false) down.push({ label: "X10A", cls: "err" });

  const env = S.status?.env3;
  if (env?.enabled === true && env3ConnectionTone(env) === "err")
    down.push({ label: "ENV III", cls: "err" });
  return down;
}

// ── Settings screen (behind the header gear) ─────────────────────────────────────────────────
// The whole configuration on one screen, no menu level in between: Connections, ESP32 / Protocol /
// Firmware, then the always-visible heating-curve diagnosis at the bottom, rendered together by
// esp32CardHtml().
function renderSettings() {
  const snapshot = $("statusSnapshot");
  const otaOnly = S.otaInstalling && !S.status;
  snapshot.hidden = S.transportUnavailable !== "status" && !otaOnly;
  if (!snapshot.hidden) {
    const snapshotLabel = S.status ? `${t("ota.snapshot_label")}: ${t("ota.snapshot_value")}` : t("sys.nodata");
    snapshot.textContent = S.otaInstalling ? snapshotLabel : `${snapshotLabel} · ` +
      t(S.transportBusy ? "toast.busy_retry" : "toast.unreachable");
  }
  if (otaOnly) {
    syncOtaSettingsLock();
    return;
  }
  // Changed status regenerates card markup. Defer writes while an interactive control has focus
  // so replacement cannot close it mid-selection. A scrub also holds its plot's host.
  // The live OTA view is retained separately and repainted after a card update. This lets visible
  // history age during a status refusal without dropping the progress message.
  if (S.scrub) return;
  const a = document.activeElement;
  const picking = !!(a && a.classList && (a.classList.contains("pin-sel") ||
    a.classList.contains("chan-sel") || a.classList.contains("lang-sel") ||
    a.classList.contains("diagnostics-sel") || a.classList.contains("probe-control")));
  if (!picking) {
    $("connTile").hidden = false;             // resumeOta hides the unavailable pre-status shell
    setHtml("connTile", connectionsHtml());
  }
  if (!picking) {
    setHtml("settingsCards", (S.otaCached ? otaSnapshotCardHtml() : "") + esp32CardHtml());
    if (!S.clickHold) {
      S.settingsHydrated = true;
      if (S.otaShown) paintOtaInline();
    }
  }
  $("settingsVer").textContent = "daikin-altherma-esp32 · v" + (S.status?.version || "?");
  syncOtaSettingsLock();
  renderSettingsDot();
}

// A restored frame is valuable only if its age is impossible to miss. Use the same expandable
// information row as the other Settings facts: the compact value says "snapshot", and its tongue
// explains that live reads may be paused and writes are locked until the install finishes.
function otaSnapshotCardHtml() {
  return vcard(t("ota.snapshot_title"), settingsValueInfoRow("ota", "snapshot",
    t("ota.snapshot_label"), t("ota.snapshot_value"), "warn", t("ota.snapshot_help")));
}
// The gear's attention marker. Network/service rows live behind it, while X10A and ENV III report on
// separate surfaces; without this aggregate, a failed configured link can be invisible from the
// dashboard — the screen the user is on all day. The dot is never the sole carrier of the fact: the
// button's accessible name spells it out, which is also what a screen reader announces (§9).
function renderSettingsDot() {
  const n = settingsConnectionsDown().length;
  $("settingsDot").hidden = n === 0;
  $("btnSettings").setAttribute("aria-label", n ? t("nav.settings_alert", n) : t("nav.settings"));
}
