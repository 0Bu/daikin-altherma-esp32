
// ── Values (dashboard) ───────────────────────────────────────────────────
const GROUPS = [
  ["Operation", ["operation mode", "thermostat", "space heat", "domestic hot water", "fault", "defrost"]],
  ["Domestic hot water", ["tank", "dhw", "hot water"]],
  ["Water circuit", ["leaving water", "return water", "flow", "water pressure", "heating-flow", "heating flow", "target", "delta", "pump", "valve", "3-way"]],
  ["Refrigerant / outdoor", ["outdoor", "heat-exchanger", "heat exchanger", "high pressure", "low pressure", "refrigerant", "compressor", "fan"]],
  // The page-0x10 protection words (def/overlay.hpp): five retry counters + six drop-control flags.
  // They are the "silent protection retries" signal — a unit meeting demand while quietly backing
  // off degrades in a way no temperature row shows — and before this group nine of the eleven fell
  // into the "Other values" catch-all at the bottom, which is where a signal goes to not be read.
  //
  // MUST stay ABOVE "Electrical": groupOf takes the FIRST match, and "Comp. INV Current Drop"/
  // "…Current Protection Retry Qty" contain "current", so below it those two would split off into
  // Electrical and the group would silently show 9 of its 11 rows.
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
  // NOT yet a mechanical gate: a lost row would just go quiet in "Other values", the same silent
  // shape tools/descriptions/ exists to catch one layer over. Worth one there.
  ["Protection", ["drop", "retry"]],
  ["Electrical", ["current", "ct l", "inv ", "backup-heater", "backup heater", "stage", "capacity"]],
  ["Device", ["wi-fi", "wifi", "mqtt", "hp link", "link", "poll", "uptime", "firmware", "rssi"]],
];
function groupOf(v) {
  if (v.group) return v.group;
  const l = (v.label || "").toLowerCase();
  for (const [name, keys] of GROUPS) if (keys.some((k) => l.includes(k))) return name;
  return "Other values";
}
// Deliberately does NOT call markUnreachable(): /status is the reachability probe (it runs on the
// same loop and says so on failure), and a values fetch that lost a race with a reboot must not
// overwrite a banner the status fetch is about to set correctly either way.
async function refreshValues() {
  let r;
  try { r = await j("/values", { signal: pollSignal() }); } catch { return false; }
  S._values = r.values || r || [];
  // The SECOND source, from the independent HomeHub stack (docs/MODBUS_PROTOCOL.md). Absent entirely
  // when that stack is off, which is exactly how a device without a HomeHub behaves — no Modbus row,
  // no comparison, no fallback. Never merged into S._values: the two have separate liveness, and
  // merging would make "is this reading current?" unanswerable per row.
  S._modbus = Array.isArray(r.modbus) ? r.modbus : [];
  renderApp();
  return true;
}
// Dashboard cards: the detected unit (Model) first, then the heat-pump value groups — all one
// continuous card grid, each block styled like OPERATION. The board (ESP32) card and the
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
  setHtml("valueGroups", statusCardsHtml() + valueGroupsHtml(S._values || [], S.status?.hp?.connected));
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

// RX/TX pin dropdown row — shown only when auto-detection hasn't locked a working pin pair, so the
// user picks from the chip's safe GPIOs (logic/board_pins.hpp → /status.pins_avail).
// The current pin is always an option even if it's off-list (e.g. a stale/custom value).
function pinSelRow(label, id, val, pins) {
  const list = (val != null && !pins.includes(val)) ? [val, ...pins].sort((a, b) => a - b) : pins;
  const opts = list.map((p) => `<option value="${p}"${p === val ? " selected" : ""}>${p}</option>`).join("");
  return `<div class="vrow"><span class="vrow-label">${esc(label)}</span>` +
    `<select class="input mono num pin-sel" id="${id}" aria-label="${esc(label)}">${opts}</select></div>`;
}

// The update-channel row (Firmware card): which published feed the next OTA check reads. Two feeds
// exist because a merge to main no longer cuts a release — "Release" is the manually-cut, tagged
// build, "Development" is the last merge. Rendered from /status.ota.channel (the SETTING) rather
// than from the running version's "-dev" suffix (what is INSTALLED): the two differ for exactly as
// long as it takes to switch channels and install, which is when the row matters most.
function channelRow(cur) {
  const opt = (v, label) =>
    `<option value="${v}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  return `<div class="vrow"><span class="vrow-label">${esc(t("card.channel"))}</span>` +
    `<select class="input chan-sel" id="e32Chan" aria-label="${esc(t("card.channel"))}">` +
    opt("release", t("chan.release")) + opt("dev", t("chan.dev")) + `</select></div>`;
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
  return `<div class="vrow"><span class="vrow-label">${esc(t("card.language"))}</span>` +
    `<select class="input lang-sel" id="e32Lang" aria-label="${esc(t("card.language"))}">` +
    opt("auto", t("lang.auto")) + opt("en", t("lang.en")) + opt("de", t("lang.de")) + `</select></div>`;
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
  return `<button class="vrow vrow-btn vrow-fw" type="button" data-act="ota" ` +
    `aria-label="${esc(t("aria.ota"))}" title="${esc(title)}">` +
    `<span class="vrow-label">${esc(t("card.firmware"))}</span>` +
    `<span class="vrow-val mono">v${esc(version || "?")}` +
    `<span class="otastat" id="otaStatSet" role="status" aria-live="polite"></span></span></button>`;
}

// ESP32 board settings (on the Settings screen — renderSettings): THREE cards, split from what was
// one, so each answers one question. ESP32 = the board itself (its onboard hardware and its own
// health — uptime + the two memory curves). Protokoll = the X10A link (whether the bus answers, the
// framing it speaks, and the RX/TX pins). Firmware = the running version, the update feed it follows,
// and the UI language. All three render into one container (#settingsCards) as concatenated vcards,
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
  const pinRow = (label, id, val, other) => pinsLocked
    ? vrow(label, val != null ? String(val) : "—", { cls: "mono num" })
    : pinSelRow(label, id, val, avail.filter((p) => p !== other));
  // ESP32 — the board's onboard hardware and its own health. READINGS AND SETTINGS ONLY; the one
  // action this card family used to carry ("Report a bug") is in the Settings footer line now
  // (index.html #footBug), a rare escape hatch that read as one more board fact under "Largest free block".
  const esp32Rows =
    boardRow() +
    uptimeRow(s.uptime_s) +
    memoryRows(s.sys || {});
  // Protokoll — the X10A link: connection state, framing, and the RX/TX pins it is wired on.
  const protoRows =
    vrow(t("card.hplink"), hp.connected ? t("card.online") : t("card.offline"), { cls: hp.connected ? "ok" : "err" }) +
    vrow(t("card.protocol"), hp.connected ? proto : "—") +
    pinRow(t("card.rxpin"), "e32Rx", hp.rx, hp.tx) +
    pinRow(t("card.txpin"), "e32Tx", hp.tx, hp.rx);
  // Firmware — the running version (tap = OTA check), the feed it follows, and the UI language.
  const fwRows =
    firmwareRow(s.version) +
    channelRow(s.ota?.channel === "dev" ? "dev" : "release") +
    langRow(s.ui?.lang === "de" || s.ui?.lang === "en" ? s.ui.lang : "auto");
  return vcard("ESP32", esp32Rows) + vcard(t("card.proto_title"), protoRows) + vcard(t("card.fw_title"), fwRows);
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

// The board's own onboard parts — status indicator + recovery button — as ONE summary row that
// opens the editor. They are runtime settings (one firmware image serves boards with different
// onboard hardware), but they are also set once per board and never touched again, so they get a
// single collapsed row rather than the permanent real estate the X10A pins have.
function boardRow() {
  const b = S.status?.board || {};
  const led = b.led_gpio == null || b.led_gpio < 0
    ? t("card.hw_off")
    : t("card.hw_led", b.led_gpio, b.led_type === 1 ? "WS2812" : "LED");
  const btn = b.btn_gpio == null || b.btn_gpio < 0 ? t("card.hw_off") : t("card.hw_btn", b.btn_gpio);
  return `<button class="vrow vrow-btn" type="button" data-act="board" aria-label="${esc(t("board.title"))}">` +
    `<span class="vrow-label">${esc(t("card.hardware"))}</span>` +
    `<span class="vrow-val mono">${esc(led)} · ${esc(btn)}</span></button>`;
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
  return hp.connected ? vcard(t("card.model"), model) + checkupCardHtml() : "";
}

// ── The Checkup card — "is anything worth reporting?" (logic/checkup.hpp, issue #208) ─────────
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
  cycling:  "check.cycling",
  defrost:  "check.defrost",
  pressure: "check.pressure",
  flow:     "check.flow",
  heater:   "check.heater",
  retries:  "check.retries",
};
// Verdict → row value colour and card-dot colour. The word beside the reading is the primary signal;
// colour only makes the five states faster to scan and never carries meaning on its own.
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

function checkupDetailHtml(c) {
  const statusKey = checkupStatusKey(c);
  let detail;
  if (statusKey === "collecting") {
    detail = c.required_s > 0
      ? t("check.detail.collecting", checkupDuration(c.observed_s), checkupDuration(c.required_s))
      : t("check.detail.collecting_unknown");
  } else {
    detail = t(`check.detail.${statusKey}`);
  }
  return descNoteHtml(t("check.detail.label"), `${checkupStatusText(c)} — ${detail}`);
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
  const value = checkupMetricValue(c);
  const status = checkupStatusText(c);
  return value ? `${value} · ${status}` : status;
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

function connLinks() {
  const w = S.status?.wifi || {}, m = S.status?.mqtt || {}, sy = S.status?.syslog || {}, nt = S.status?.ntp || {};
  const links = [];

  // WiFi has no "connecting" state in /status (just connected: true/false), so it is a two-state
  // ok/err row — signal bars keep their own strength-based tone regardless.
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
    links.push({ edit: "mqtt", label: "MQTT",
      cls: m.connected ? "ok" : m.error ? "err" : "warn",
      // No TLS padlock marker: an mqtts:// broker already carries its own scheme in the URL, so the
      // icon only restated what the string says. A schemeless/mqtt:// broker is plaintext and shows none.
      value: esc(m.broker || "—"),
      state: m.connected ? t("conn.connected") : m.error ? t("conn.error", m.error) : t("conn.connecting") });
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
  // exactly the case worth seeing. ALWAYS present, even with no address and no hub found. It used to
  // appear only while the stack
  // was `enabled` — i.e. only once an address existed — which stranded the exact user this setting
  // is for: the bounded mDNS search finds nothing, the stack retires, the row is never drawn,
  // and there is no longer anywhere in the UI to type the address in. The standalone HomeHub card
  // was removed at the same time, so on a board with no X10A and no discovered hub the feature had
  // no reachable entry point at all. A configuration row is not a status readout; it has to exist
  // before the thing it configures does.
  const mbs = S.status?.modbus;
  if (mbs) {
    const mode = mbs.mode || (mbs.host ? "manual" : "auto");
    const off = mode === "off";
    const detail = !off && mbs.enabled ? modbusErrorText(mbs) : "";
    // This row reports LINK HEALTH, so it uses the shared status palette. Petrol remains reserved
    // for Modbus READING provenance in the value tables, schematic and inspector.
    const cls = off ? "" : mbs.connected ? "ok" : mbs.discovering ? "" : mbs.enabled ? "err"
                    : mode === "manual" ? "err" : "";
    const state = off ? t("conn.disabled")
                : mbs.connected ? t("conn.connected")
                : mbs.discovering ? t("conn.searching")
                : mbs.enabled ? t("conn.offline")
                : mode === "auto" && mbs.searched ? t("conn.notfound")
                : mode === "manual" ? t("conn.offline") : t("conn.searching");
    const endpoint = !off && mbs.host ? `${mbs.host}:${mbs.port || 502}`
                              : mbs.discovering ? t("conn.searching") : "—";
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
  return `<button class="conn-row" type="button" data-edit="${esc(l.edit)}" aria-label="${esc(t("conn.aria", l.label, l.state))}">` +
    `<span class="conn-label">${esc(l.label)}</span>` +
    `<span class="conn-value"><span class="conn-val ${l.cls || ""}">${l.value}</span>` +
    `${l.detail ? `<span class="conn-detail">${esc(l.detail)}</span>` : ""}</span>` +
    `${editIcon}</button>`;
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
// The whole configuration on one screen, no menu level in between: the Connections tile and the
// ESP32 / Protocol / Firmware cards rendered together by esp32CardHtml().
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
  if (!picking) setHtml("connTile", connectionsHtml());
  if (!picking && !S.otaShown) setHtml("settingsCards", esp32CardHtml());
  $("settingsVer").textContent = "daikin-altherma-esp32 · v" + (S.status?.version || "?");
  renderSettingsDot();
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
