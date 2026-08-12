
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
// Measured before this list was last edited: 66 of the 169 published labels fell into the catch-all
// "Other values" at the bottom, including the unit's own Error Code on 44 of 45 profiles — §6 group
// 1's named row, sitting below everything because "fault" was a key and "error" was not. Four keys
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
  // "error" catches exactly "Error type" + "Error Code" and nothing else in the catalog. The DHW
  // on-off flag §6 names here spells itself "Powerful DHW Operation. ON/OFF", so it lands in the DHW
  // group below; the old "domestic hot water" key matched ONLY the 2nd-tank SENSOR, i.e. it never
  // did the job it was written for and did one it should not have.
  ["Operation", ["operation mode", "thermostat", "space heat", "fault", "error", "defrost", "silent mode"]],
  ["Domestic hot water", ["tank", "dhw", "hot water"]],
  // "heating target" for the hybrid/boiler water targets, NOT bare "target": that also took
  // Target Evap./Cond./Discharge Temp. — refrigerant-circuit control targets — into the water group.
  // Same for the valves: bare "valve" took all five expansion valves off the refrigerant circuit.
  ["Water circuit", ["leaving water", "return water", "inlet water", "outlet water", "mixed water",
                     "flow", "water pressure", "heating-flow", "heating flow", "heating target",
                     "lw setpoint", "delta", "pump", "2way valve", "3way valve", "3-way", "mix valve"]],
  // Bare "pressure" is safe HERE and only here: the two water-pressure spellings are claimed by the
  // group above, so what is left ("Pressure", "Pressure sensor(T)", …) is refrigerant — the same
  // generically-named rows logic/hp_convert.cpp documents as its known is_refrigerant_pressure gap.
  ["Refrigerant / outdoor", ["outdoor", "heat-exchanger", "heat exchanger", "o/u heat exch",
                             "pressure", "refrigerant", "refrig.", "compressor", "fan",
                             "expansion valve", "discharge", "suction", "liquid", "deicer",
                             "target evap", "target cond", "inv frequency"]],
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
                  "heat sink", "fin temp"]],
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
  let r;
  try { r = await j("/values", { signal: pollSignal() }); } catch { return false; }
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
  if (S.otaInstalling) otaCacheStore();
  if (paint) renderApp();
  return true;
}
// Dashboard cards: the rolling plant diagnostics first, directly below the live diagram, followed by the
// detected unit (Model) and the heat-pump value groups — all one continuous card grid, each block
// styled like OPERATION. The board (ESP32) card and the
// WiFi/MQTT/Syslog/NTP rows are NOT here: both moved behind the gear onto Settings (renderSettings).
function renderCards() {
  // Frozen while a trend is being scrubbed (S.scrub): rebuilding innerHTML under an active pointer
  // drops pointer capture and restarts the accordion, so the gesture would break ~1×/s. The rows
  // stop updating for the few seconds the finger is down and catch up on release — the same
  // deliberate stall renderSettings takes for the OTA readout.
  if (S.scrub) return;
  // Through setHtml like the other two per-poll containers, rather than writing innerHTML directly:
  // that is where the click-in-flight and unchanged-markup guards live, and this grid was the one
  // container bypassing both. The unchanged-markup half earns its keep here too — an idle plant or a
  // dropped X10A link produces identical markup, so those pushes stop writing at all.
  // Keep the observation first in the card stream: #valueGroups immediately follows #hpLive in the
  // document, so this places plant diagnostics directly after the diagram before every other card.
  // It remains linked to X10A liveness, as it was when statusCardsHtml() owned the card.
  const checkup = S.status?.hp?.connected ? checkupCardHtml() : "";
  setHtml("valueGroups", checkup + statusCardsHtml() + valueGroupsHtml(S._values || [], S.status?.hp?.connected));
}

// Hold the rebuild for the duration of one click, and make it IMPOSSIBLE to leave held — the same
// obligation the scrub freeze carries (DESIGN.md §6): a pointerdown whose click never arrives would
// otherwise stop every value row from updating, which reads as a dead device with no error anywhere.
// A pointerdown that ends outside the row, a cancelled gesture and a browser that swallows the
// sequence entirely are all covered — the last one by the watchdog alone.
// The hold is released ONLY by its timer, never by an event. Two reasons, and the second is why an
// event-based release would have been wrong rather than merely redundant:
//
//   * Nothing can leave it held. Every path ends in a timeout that always fires — there is no
//     "pointerup that never came" to strand it (the failure mode the scrub guard needed two
//     mechanisms to cover).
//   * The window that must be covered extends PAST the click. Opening a trended row starts a fetch
//     whose completion calls renderApp(), which landed ~80 ms after the click and replaced the panel
//     mid-slide — the 220 ms open animation was cut a third of the way through, so even a click that
//     DID register looked like one that had not. Releasing on `click` would leave that uncovered.
//
// Deliberately not a rebuild-on-release either: the next poll frame (≤1 s) redraws anyway.
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
const vcard = (label, rows, badge, badgeCls) => `<div class="vgroup"><div class="card">` +
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
// reports, not a separate automatic mode), and de/en are named in their OWN tongue (Deutsch /
// English), the convention for a language picker.
function langRow(cur) {
  const opt = (v, label) =>
    `<option value="${v}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  const select = `<select class="input lang-sel" id="e32Lang" aria-label="${esc(t("card.language"))}">` +
    opt("auto", t("lang.auto")) + opt("en", t("lang.en")) + opt("de", t("lang.de")) + `</select>`;
  return settingsInfoRow("firmware:language", "firmware-language-detail", t("card.language"), select,
    `<div class="vdesc-p">${esc(t("card.language_help"))}</div>`);
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
    `<span class="otastat" id="otaStatSet" role="status" aria-live="polite"></span></span></button>`;
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
    if (c.has_value) {
      const power = Number(c.power_w).toLocaleString(LANG === "de" ? "de-DE" : "en-US",
        { maximumFractionDigits: 1 });
      body += descNoteHtml(t("circ.detail.power"), `${power} W`);
    }
    // The row header identifies WHICH pump is configured. Its current assessment belongs here with
    // the evidence, including waiting/error states that do not have a power value yet.
    body += descNoteHtml(t("circ.detail.state"), value);
    if (c.has_value && Number.isFinite(c.age_s))
      body += descNoteHtml(t("circ.detail.age"), checkupDuration(c.age_s));
    body += `<div class="vdesc-p">${esc(t("circ.settings_help"))}</div>`;
  }
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
// diagnostics card and then the heating-curve diagnosis card. The latter is ALWAYS rendered — it is
// where its two sources are configured, so hiding it until they were configured left no way to
// configure them. The ESP32 cards
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
      pinsLocked ? hp.rx : picker.rx, "tx", t("card.txpin_help"));
  // Firmware — running build, update feed and language. No heating-curve switch: that diagnosis arms
  // itself from the two sources configured on its own card, so a switch here would have been a
  // second statement of a fact the configuration already makes — and an unreachable one, since the
  // editors for those sources live inside the card the switch used to reveal.
  const fwRows =
    firmwareRow(s.version) +
    channelRow(s.ota?.channel === "dev" ? "dev" : "release") +
    langRow(s.ui?.lang === "de" || s.ui?.lang === "en" ? s.ui.lang : "auto");
  return vcard("ESP32", esp32Rows) + vcard(t("card.proto_title"), protoRows) +
         vcard(t("card.fw_title"), fwRows) + circulationSettingsCardHtml() +
         dynamicControlCardHtml();
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
  let statusKey;
  if (w.fetching) statusKey = "fetching";
  else if (w.has_value && w.fresh) statusKey = "fresh";
  else if (w.error) statusKey = "unavailable";
  else if (w.has_value) statusKey = "stale";
  else statusKey = "waiting";

  let html = descNoteHtml(t("wx.detail.status"),
    `${t(`wx.status.${statusKey}`)} — ${t(`wx.detail.${statusKey}`)}`);
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

// The source's own condition, as ONE rule. Freshness is only one input to this verdict: a fresh
// packet from a thermostat that reports itself switched off is NOT a healthy source for this card.
// The returned class, visible status and accessible status all come from this same result so an
// amber row can never explain itself as merely "Current" again.
function roomSourceStatus(r, mqtt) {
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
  if (!r.control_eligible)
    return { key: "unusable", detail: t(ROOM_BLOCK_LINES[r.reason] || "dyn.room_invalid_payload"),
      cls: "warn" };
  return { key: "usable", detail: "", cls: "ok" };
}

function roomSourceStatusText(status) {
  const state = t(`ref.status.${status.key}`);
  return status.detail ? `${state} — ${status.detail}` : state;
}

function roomSourceDetailHtml(r, status, temperature, setpoint, age) {
  // This tongue is a live status, not a second copy of the editor. The source name is already the
  // row value; topic/path mechanics belong in the modal. Start with the one overall verdict, then
  // show only the readings that help a user understand it.
  let html = descNoteHtml(t("ref.detail.status_label"), roomSourceStatusText(status));
  if (r.has_value) {
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
//    That is safe mode. "Set up a room source" would send the reader to fix the one thing already
//    done, so this names the real state and says the recording resumes by itself.
//  - OFF plus a CONFIGURED room source is the other half of the same mistake, and it is not the same
//    state: arming also requires a broker (heating_curve_diagnosis_armed), so clearing the broker
//    disarms a fully-configured room source. The old copy told those users to set up the source they
//    were looking at.
function dynamicStateRow(d, room, weather, modbus, mqtt, sys) {
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
  const live = num(d.outdoor_temperature_c);
  const hasLive = live !== null;
  const sample = num(d.last_sample_outdoor_temperature_c);
  const hasSample = sample !== null;
  const hasEvent = num(d.last_sample_room_error_k) !== null;
  const enabled = env.enabled === true;
  // Whether the RECORDER is running at all, which decides who is to blame for a missing value.
  // Clearing the broker disarms the diagnosis while leaving ENV III perfectly healthy, so without
  // this the row would warn about the sensor and send the reader to check hardware that is fine —
  // the same mistake as telling someone to set up the room source sitting one row below.
  const evaluating = d.armed === true && d.reason !== "sampler_inactive";
  // NO-BREAK SPACE before the unit. Both readings this formats now sit in the tongue, where a lead-in
  // ("Aktueller Messwert") and the number share one wrapping paragraph — so a plain space still puts
  // "22,2" and "°C" on two lines at a phone width, which reads as a layout fault rather than as a
  // measurement.
  const fmt = (n) => `${n.toLocaleString(LANG === "de" ? "de-DE" : "en-US",
    { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;

  // The sensor's product name, untranslated and inline like "Open-Meteo" one row above: it is what
  // the hardware is called in both languages, so a translation key would be two spellings of one
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

  let body = descNoteHtml(t("dyn.outdoor_detail_status"), t(statusKey));
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

function dynamicControlCardHtml() {
  const r = S.status?.reference_temperature || {};
  const w = S.status?.weather_forecast || {};
  const mqtt = S.status?.mqtt || {};
  const d = S.status?.heating_curve || {};
  const modbus = S.status?.modbus || {};
  // ALWAYS rendered. Through v1.0.0-dev.331 this returned "" unless an explicit switch had selected
  // SHADOW — while that switch answered 409 until the very sources whose only editors live on this
  // card were configured. The feature could not be reached from the UI at all.
  const sourceStatus = roomSourceStatus(r, mqtt);
  const sourceCls = sourceStatus.cls;
  let temperature = "", setpoint = "", age = "";
  if (r.has_value) {
    temperature = Number(r.temperature_c).toLocaleString(
      LANG === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 2 });
    if (r.has_setpoint) setpoint = Number(r.setpoint_c).toLocaleString(
      LANG === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 2 });
    const seconds = Number.isFinite(r.age_s) ? r.age_s : r.received_ago_s;
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
    r.configured ? roomSourceStatusText(sourceStatus) : "");
  let weatherCls = "dim";
  let outdoor = "", solar = "";
  if (w.configured && w.has_value) {
    outdoor = Number(w.outdoor_mean_2h_c).toLocaleString(
      LANG === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 1 });
    solar = Number(w.solar_energy_2h_wh_m2).toLocaleString(
      LANG === "de" ? "de-DE" : "en-US", { maximumFractionDigits: 0 });
  }
  if (w.configured && w.fetching) weatherCls = "warn";
  else if (w.configured && w.has_value) {
    if (w.fresh) weatherCls = "ok";
    else weatherCls = w.error ? "err" : "warn";
  } else if (w.configured) weatherCls = w.error ? "err" : "warn";
  const weatherValue = w.configured ? "Open-Meteo" : t("dyn.not_configured");
  const weatherBody = (w.configured ? weatherSourceDetailHtml(w, outdoor, solar) : "") +
    `<div class="vdesc-p">${esc(t(w.configured ? "wx.hint.configured" : "wx.hint.setup"))}</div>`;
  rows += dynamicInfoRow("weather", t("dyn.weather"), weatherValue, weatherCls,
    weatherBody, "weather", t("wx.title"));

  // Beside the forecast row on purpose: both are optional outdoor evidence, and the two labels have
  // to keep MEASURED apart from FORECAST or a reader sees two outdoor temperatures and no way to
  // tell which is which.
  rows += outdoorAxisRow(d, S.status?.env3 || {});

  rows += dynamicInfoRow("strategy", t("dyn.strategy"), t("dyn.shadow_strategy"), "",
    `<div class="vdesc-p">${esc(t("dyn.strategy_help"))}</div>`);
  // No "Safety & output → read-only" row. It was a hardcoded constant that could never say anything
  // else, and since the write path was deleted (#294) it can never BECOME anything else either —
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
// and the chart under it cannot disagree about what the number is. Whole KiB rather than a decimal:
// the row is rebuilt on every poll, and a tenth of a KiB ticking once a second is noise, not news.
const fmtKiB = (b) => (b == null ? "—" : `${Math.round(b / 1024)} KiB`);

// The board's own memory: free heap and the largest CONTIGUOUS free block. These two are back on the
// card after #186 dropped them, and the reason they are worth their space now is the reason they
// were not then: each carries a 24-HOUR TREND. As spot numbers they were a diagnosis nobody could
// make — "148 KiB" says nothing without the last day of it — and a diagnosis is what the /status
// endpoint and the MQTT heartbeat are for. As curves they answer the one memory question this
// firmware actually has: is it DRIFTING? A leak shows as a slope; fragmentation shows as the two
// lines separating, free heap holding while the largest block sinks. Nothing else in the UI can say
// that, and it is the failure mode the whole "Memory constraints" section of CLAUDE.md is about.
//
// Both rows are expandable exactly like a value row — same accordion, same chart, same scrub and pin
// — and attach their series by TREND ID, since the row labels here are translated and there is no
// catalog label to match on.
function memoryRows(sys) {
  const row = (id, labelKey, bytes) => {
    const label = t(labelKey);
    const d = MODEL_DESCRIPTIONS[id];
    const hid = hasHist(id) ? id : "";      // absent on firmware that predates the trend
    const val = esc(fmtKiB(bytes));
    if (!hid && !d) return vrow(label, fmtKiB(bytes), { cls: "mono num" });
    return descAccordion(`board:${id}`, label, val, "mono num",
                         (d ? descBodyHtml(d) : "") + histHtml(hid, "KiB", label), hid);
  };
  return row("free_heap", "card.freeheap", sys.free_heap) +
         row("max_alloc", "card.maxalloc", sys.max_alloc);
}

const boardLedPhases = ["off", "setup", "connecting", "healthy", "bus_down", "mqtt_down", "wipe_armed", "wiping"];
const boardLedRgbSwatches = ["led-off", "led-blue", "led-yellow", "led-green", "led-red", "led-orange", "led-red", "led-white"];

// Render the legend for the SAVED LED backend in the explanation tongue. The editor deliberately
// contains controls only; its unsaved selection must not replace the meaning of the active hardware.
// No configured LED means no legend, matching the explicit "None" selection in the editor.
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
// tap both explaining and editing, while S.descOpen preserves the tongue across status-poll rebuilds.
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
  return hp.connected ? vcard(t("card.model"), model) : "";
}

// ── The diagnosis card — "is anything worth reporting?" (logic/checkup.hpp, #208/#349) ─────────
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
// Verdict → row-status colour and card-dot colour. The collapsed row deliberately carries only this
// status; its reading and assessment live together in the explainer so the card remains scannable.
// Colour only makes the states faster to scan and never carries meaning on its own.
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

function checkupStatusKey(c) {
  const verdict = typeof c === "string" ? c : c?.verdict;
  if (verdict === "ok" && c?.evidence === "observation") return "observation";
  if (verdict === "ok" && c?.evidence === "experimental") return "experimental";
  return ["ok", "info", "warn", "collecting", "unavailable"].includes(verdict)
    ? verdict : "unavailable";
}

function checkupStatusText(c) {
  return t(`check.status.${checkupStatusKey(c)}`);
}

// The fault row is the ONE check whose verdict comes from the DEVICE rather than from a project
// heuristic, so the generic per-verdict sentence ("a notable value or pattern") explains nothing a
// reader can act on there: NOTE means one of THREE different device states — a warning class active
// right now, a message that has since cleared, or an unreadable class with history behind it — and
// they call for different follow-up (read the code under Operation / nothing / check the link).
// Naming which one is the whole point of the sentence, so this check gets its own copy.
function checkupDetailKey(c, statusKey) {
  if (c.id === "fault") {
    if (statusKey === "warn") return "check.detail.fault.error";
    if (statusKey === "info") {
      if (c.active === 1) return "check.detail.fault.warning";
      if (c.active === 0) return "check.detail.fault.past";
      return "check.detail.fault.past_unknown";
    }
  }
  return `check.detail.${statusKey}`;
}

// The reasons the firmware sent, as words. It sends SLUGS and never a bitmask, so this translates
// rather than decodes — an unknown slug from a newer firmware is dropped instead of rendering a
// placeholder that looks like a cause.
function checkupDhwReasons(c) {
  const list = Array.isArray(c.abort_reasons) ? c.abort_reasons : [];
  return list.map((r) => t(`check.detail.dhw_reason.${r}`))
             .filter((s) => s && !s.startsWith("check.detail."))
             .join(", ");
}

function checkupDetailHtml(c) {
  const statusKey = checkupStatusKey(c);
  const value = checkupMetricValue(c);
  let detail;
  // "This check cannot be completed HERE" is an unavailable verdict like a profile that lacks the
  // rows, and needs the opposite advice — so it gets its own sentence rather than the generic one.
  if (statusKey === "unavailable" && c.id === "dhw_loss" && c.blocked) {
    const reasons = Array.isArray(c.abort_reasons) ? c.abort_reasons : [];
    // Same verdict, two causes, opposite actions. When the ONLY thing that ever ended a candidate
    // was the bus going quiet, this is the X10A link and not the plant's duty cycle — a flapping
    // bus can reach the blocked bar, and blaming the heat pump for it sends the reader nowhere.
    const linkOnly = reasons.length === 1 && reasons[0] === "blind";
    const sentence = linkOnly
      ? t("check.detail.dhw_blocked_link", Number(c.aborts) || 0,
          checkupDuration(c.best_aborted_s))
      : t("check.detail.dhw_blocked", Number(c.aborts) || 0, checkupDhwReasons(c),
          checkupDuration(c.best_aborted_s));
    return descNoteHtml(t("check.detail.assessment_label"),
                        `${checkupStatusText(c)} — ${sentence}`);
  }
  if (statusKey === "collecting") {
    if (c.id === "dhw_loss" && c.required_s > 0) {
      const done = checkupDuration(c.observed_s), required = checkupDuration(c.required_s);
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
        detail += t("check.detail.dhw_aborted", Number(c.aborts), checkupDhwReasons(c),
                    checkupDuration(c.best_aborted_s));
    } else {
      detail = c.required_s > 0
        ? t("check.detail.collecting", checkupDuration(c.observed_s), checkupDuration(c.required_s))
        : t("check.detail.collecting_unknown");
    }
  } else {
    detail = t(checkupDetailKey(c, statusKey));
  }
  const reading = value ? descNoteHtml(t("check.detail.value_label"), value) : "";
  return reading + descNoteHtml(t("check.detail.assessment_label"),
                                `${checkupStatusText(c)} — ${detail}`);
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
      if (c.max_k_h == null) return c.windows ? t("check.loss_windows", c.windows) : "";
      const rate = Number(c.max_k_h).toLocaleString(LANG === "de" ? "de-DE" : "en-US",
        { maximumFractionDigits: 1 });
      const attribution = c.high_pump_off > 0 ? t("check.loss_pump_off")
        : c.high_with_pump > 0 ? t("check.loss_with_pump")
        : c.high_windows > 0 ? t("check.loss_unattributed") : "";
      return [`${rate} K/h`, t("check.loss_windows", c.windows || 0), attribution].filter(Boolean).join(" · ");
    }
    case "cycling": {
      if (c.starts == null) return "";
      const starts = t("check.starts", c.starts);
      if (collecting || c.mean_run_s == null) return starts;
      return `${starts} · ${t("check.mean", checkupDuration(c.mean_run_s))}`;
    }
    case "defrost": {
      if (c.count == null) return "";
      const n = t("check.cycles", c.count);
      if (collecting) return n;
      const share = checkupDefrostShare(c);
      const paired = c.paired_count == null ? "" : t("check.paired_cycles", c.paired_count);
      return [n, paired, share].filter(Boolean).join(" · ");
    }
    case "pressure": {
      return c.min_bar == null ? "" : `${c.min_bar} bar`;
    }
    case "flow": {
      return c.min_l_min == null ? "" : `${c.min_l_min} l/min`;
    }
    case "heater": {
      const parts = [];
      const buh = checkupHeaterRuntime(c.buh_s, c.buh_min);
      const bsh = checkupHeaterRuntime(c.bsh_s, c.bsh_min);
      if (buh) parts.push(buh);
      if (bsh) parts.push(t("check.tank_runtime", bsh));
      return parts.join(" · ");
    }
    case "retries":  return c.seen == null ? "" : c.seen ? t("check.retry_seen") : t("check.retry_none");
  }
  return "";
}

function checkupValue(c) {
  return checkupStatusText(c);
}

function checkupCardHtml() {
  const h = S.status?.health;
  if (!h || !Array.isArray(h.checks)) return "";      // an older firmware — no card rather than an empty one
  let rows = "";
  for (const c of h.checks) {
    const key = CHECKUP_ROW[c.id];
    if (!key) continue;                               // a check this UI does not know: skipped, never guessed at
    const tone = CHECKUP_TONE[checkupStatusKey(c)] || "";
    rows += modelDescRow(`health_${c.id}`, t(key), checkupValue(c),
                         { cls: `checkup-val${tone ? ` ${tone}` : ""}`,
                           bodyPrefix: checkupDetailHtml(c) });
  }
  if (!rows) return "";
  // The badge gives only the card-level verdict and judgement progress. Evidence clocks live in each
  // row's explainer, where they qualify the result without competing with the first-glance status.
  const status = checkupStatusText(h.status);
  const available = Number.isFinite(h.available) ? h.available : h.checks.filter(c => c.verdict !== "unavailable").length;
  const evaluated = Number.isFinite(h.evaluated) ? h.evaluated
                  : h.checks.filter(c => c.verdict !== "unavailable" && c.verdict !== "collecting").length;
  // New firmware distinguishes facts it can report from checks capable of a bounded judgement.
  // Older payloads had only `available`; using it as the fallback keeps their established contract.
  const assessable = Number.isFinite(h.assessable) ? h.assessable : available;
  const badge = t("check.summary", status, evaluated, assessable);
  const badgeCls = { warn: "err", ok: "ok", collecting: "dim", unavailable: "dim" }[h.status] || "";
  return vcard(t("card.checkup"), rows, badge, badgeCls);
}

// ── Connections tile (Settings — WiFi · MQTT · Syslog · NTP · Modbus) ─────────────────────────
// One tappable row per link: label, colour-coded value (green connected/synced, yellow reconnecting/
// syncing, red down — the same ok/warn/err semantics the rest of the app uses), a trailing
// pencil that opens that link's existing edit modal (§5.1 in docs/DESIGN.md). MAC/BSSID are dropped
// entirely (bus-level detail nobody edits from here) and the IP address lives in the dashboard
// header (renderHeaderMeta) — it is board identity, not a per-row WiFi fact.
//
// connLinks() derives the five rows' state ONCE and both consumers read it: the rows themselves and
// the Settings menu entry + header dot that summarise them a level up. Re-deriving "is this link
// healthy" for the summary is exactly how a menu ends up claiming everything is fine while the row
// behind it is red.
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
    links.push({ label: "Ethernet",
      cls: eth.lease ? "ok" : eth.link ? "warn" : "err",
      // The three states are genuinely different and a user acts differently on each: no cable, a
      // cable with no lease (a DHCP or VLAN problem), and a working link.
      value: eth.lease ? esc(speed || t("conn.connected"))
           : eth.link  ? t("conn.eth_no_lease") : t("conn.eth_no_cable"),
      state: eth.lease ? t("conn.connected") : eth.link ? t("conn.eth_no_lease") : t("conn.eth_no_cable") });
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

  return links;
}
// The row conveys state by colour alone (the value IS the address/name, just tinted) — DESIGN.md
// §9's "status never conveyed by colour alone" would otherwise be broken for colourblind users and
// screen readers, so `state` (a plain-text status word, never shown visually) goes into the row's
// aria-label instead of the generic "Edit X" every other edit affordance in this app uses.
function connRow(l) {
  return `<button class="conn-row${l.detail ? " has-detail" : ""}" type="button" data-edit="${esc(l.edit)}" aria-label="${esc(t("conn.aria", l.label, l.state))}">` +
    `<span class="conn-label">${esc(l.label)}</span>` +
    `<span class="conn-value"><span class="conn-val ${l.cls || ""}">${l.value}</span></span>` +
    `${editIcon}${l.detail ? `<span class="conn-detail-wrap"><span class="conn-detail">${esc(l.detail)}</span></span>` : ""}</button>`;
}
function connectionsHtml() {
  return `<div class="section-label">${esc(t("conn.title"))}</div>` + connLinks().map(connRow).join("");
}
// The links the gear should call out as broken: `err` only. `warn` is the transient half of the
// vocabulary (MQTT still connecting, NTP not yet synced, a syslog host that ignores ping) and every
// boot passes through it, so raising the alarm on warn would leave the gear permanently marked and
// the marker would stop meaning anything. A disabled link (neutral, no class) is a choice, not a fault.
const connDown = () => connLinks().filter((l) => l.cls === "err");

// ── Settings screen (behind the header gear) ─────────────────────────────────────────────────
// The whole configuration on one screen, no menu level in between: Connections, ESP32 / Protocol /
// Firmware, then the always-visible heating-curve diagnosis at the bottom, rendered together by
// esp32CardHtml().
function renderSettings() {
  // Both containers are rebuilt on every poll (link state, pins and the OTA row all change). The
  // Protocol card's RX/TX pin dropdown is interactive, so skip the rebuild while it is focused/open — otherwise the
  // poll would collapse it mid-pick. It resumes once focus leaves (onPinPick blurs it after
  // applying). setHtml keeps the rest from thrashing rows the user is tapping.
  //
  // The OTA readout in the Firmware row is the second reason to hold still, and it is not a
  // cosmetic one: that readout is painted straight into the DOM by otaInline (it is not built from
  // S, so a rebuild does not re-emit it), and a download reports for tens of seconds. Rebuilt once
  // a second, the percentage would blink out and the checking spinner would restart its animation
  // from zero on every frame — the header's own #otaStat is exempt from re-render for exactly this
  // reason, and this slot needs the same protection by a different means. So the card freezes while
  // the readout has anything to say — S.otaShown covers the terminal messages too, which are
  // written after the flow released and would otherwise be wiped a fraction of a second into their
  // linger. What freezes is a card of static facts, for the seconds an
  // update takes; the one state that can meaningfully change under it (a new version) arrives with
  // the page reload the install ends in. It freezes that card ALONE — the Connections tile carries
  // no part of the readout, and a WiFi or broker link going down during a download is exactly the
  // thing a user would want to see move.
  // …and the third reason, since the ESP32 card carries charts again: a rebuild under an active
  // pointer drops its capture and kills the scrub mid-drag (renderCards has the same guard).
  if (S.scrub) return;
  const a = document.activeElement;
  const picking = !!(a && a.classList && (a.classList.contains("pin-sel") || a.classList.contains("chan-sel") || a.classList.contains("lang-sel")));
  if (!picking) {
    $("connTile").hidden = false;             // resumeOta hides the unavailable pre-status shell
    setHtml("connTile", connectionsHtml());
  }
  // otaShown normally freezes an ALREADY-RENDERED card so direct progress DOM writes survive the
  // once-per-status rebuild. A reload reverses that order: resumeOta learns about the download first
  // and can set otaShown before /status has ever produced the full cards. Permit exactly that first
  // status-backed render, then repaint the retained OTA view into the newly-created #otaStatSet.
  const firstStatusRender = !S.settingsHydrated;
  if (!picking && (!S.otaShown || firstStatusRender)) {
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
// The gear's attention marker. The connection rows live behind it now, so a broker that stopped
// answering would otherwise be invisible from the dashboard — the screen the user is on all day.
// The dot is never the sole carrier of the fact: the button's accessible name spells it out, which
// is also what a screen reader announces (DESIGN.md §9).
function renderSettingsDot() {
  const n = connDown().length;
  $("settingsDot").hidden = n === 0;
  $("btnSettings").setAttribute("aria-label", n ? t("nav.settings_alert", n) : t("nav.settings"));
}
