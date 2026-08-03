
// ── App state ────────────────────────────────────────────────────────────
const S = {
  // Which screen is showing (a key of VIEW below). The app opens on "dashboard" and the header gear
  // is the only way off it; every other screen sits under Settings and walks back up through PARENT.
  stage: "dashboard",
  status: null,
  busy: false,
  // Labels of value rows whose description accordion is currently expanded. Kept in app state (not
  // the DOM) because #valueGroups is rebuilt on every poll (renderCards) — a purely-DOM open state
  // would collapse ~1×/s. valueGroupsHtml re-emits the `open` class from this set, so an expanded
  // row survives the rebuild; the click handler only toggles the live element (so the CSS slide
  // animates) and updates this set for the next rebuild to honour.
  descOpen: new Set(),
  // Set while a click is in flight in #valueGroups; suspends the per-poll rebuild so it cannot
  // detach the node the pointer went down on (renderCards explains why that loses the click
  // outright). Released only by a timer, so it can never latch.
  clickHold: false,
  // 24-hour trend per historied concept: id -> {at, dt, unit, b0, v[]} for X10A and `modbus:<id>`
  // for the independent HomeHub ring (or {err:true}). Cached in app
  // state for the same reason descOpen is — #valueGroups is rebuilt on every poll, and re-fetching
  // (or re-deriving) the sparkline 1×/s would both hammer the device and restart the panel's slide.
  // A missing entry means "not fetched yet", which is what makes the panel show its loading line.
  hist: new Map(),
  histBusy: new Set(),
  // A PINNED trend readout per concept: id -> {t} (the pinned sample's unix instant) or {i, gen} when
  // the device has no wall clock to anchor to. In app state, not the DOM, for the same reason
  // descOpen is: the panel is re-emitted on every poll, and a crosshair written imperatively would
  // vanish ~1×/s. Anchored to the INSTANT so the ring rolling under it re-resolves to the same
  // measurement instead of to whatever now occupies that slot (logic/history.hpp's history_pin_index).
  histPin: new Map(),
  // The label of the row whose trend is being scrubbed right now (mouse hover or finger down), or
  // null. It FREEZES the #valueGroups rebuild — see renderCards. Without that the innerHTML is
  // replaced ~1×/s under the pointer: the captured element dies mid-drag and the readout flickers.
  // Same trade the OTA readout takes with the Settings rebuild (S.otaShown), and for the same
  // reason: a live-updating grid must not fight an interaction the user is in the middle of.
  scrub: null,
  // Schematic inspector: which hit target (INSPECT key) is selected, and the last liveData() the
  // poll produced. The panel re-renders from S.live on every poll, so an open explainer keeps
  // showing the CURRENT reading rather than the one that was on screen when it was tapped.
  insp: null,
  live: null,
  inspSig: "",
  // Crash banner. `crashAsk` is the signature of the crash whose delete is awaiting its second tap
  // (the confirm step lives INSIDE the banner — DESIGN.md §5.4 keeps the OTA confirm() the only
  // native dialog). `crashDismissed` is the signature the device has just been told to delete: the
  // banner is hidden on it immediately so a status frame already in flight — carrying the crash the
  // device has since dropped — cannot flash it back for a second. The device's own answer
  // (/status.last_crash going null) is what keeps it gone from then on, across reloads and browsers.
  crashAsk: "",
  crashDismissed: "",
  // The inspector's trend is diffed separately from the rest of the card: it changes on a fetch or a
  // pin, not on a live value, and re-emitting a plot every second would fight the cursor on it.
  inspHistSig: "",
  // OTA: the version a check found (drives the header version's tooltip), and whether a check or
  // download is running. Separate from S.busy — S.busy is the "a config write is landing" lock the
  // OTA flow also takes, otaBusy is what keeps a second tap from starting a parallel check.
  otaAvail: null,
  otaBusy: false,
  // Whether the inline readout currently has something on screen (a ring, a percentage, a terminal
  // message inside its linger window). It is what freezes the Settings rebuild — see renderSettings.
  // Not the same thing as otaBusy: the terminal messages are written after the flow has released.
  otaShown: false,
};

// ── Navigation (dashboard ⇄ Settings) ────────────────────────────────────
// Two screens, both in the DOM; only .active shows. Deliberately FLAT — the gear opens the whole
// configuration at once, with no menu level in between: there is little enough of it that a menu
// would be a list of one or two entries whose only job is to hide a card behind a second tap.
// PARENT still maps the way back, so the header chevron and Esc walk the same path. There is no
// URL/history integration on purpose — the page is served from the device with no paths, and a hash
// route would survive a reload into a screen the user did not ask for.
const VIEW = { dashboard: "viewDash", settings: "viewSettings" };
const PARENT = { settings: "dashboard" };
const TITLE = { settings: () => t("nav.settings") };
// Every overlay that owns the Esc key; the navigation Esc stands down while one of them is open.
const MODALS = ["wifiModal", "mqttModal", "refTempModal", "syslogModal", "ntpModal", "homehubModal", "boardModal", "bugModal"];

// Open a popup without putting the caret into its first field. Focusing the dialog container keeps
// the modal announced to keyboard/screen-reader users, while `preventScroll` avoids moving the page
// and — most visibly on phones — no text selection or software keyboard appears until the user
// deliberately chooses a field. Every modal card carries tabindex="-1" for this one purpose.
function openPopup(id) {
  const modal = $(id);
  modal.hidden = false;
  const dialog = modal.querySelector?.('[role="dialog"]');
  dialog?.focus?.({ preventScroll: true });
}

function go(stage) {
  S.stage = stage;
  for (const [st, id] of Object.entries(VIEW)) $(id).classList.toggle("active", st === stage);
  renderHeader();
  window.scrollTo(0, 0);
}
function goBack() { go(PARENT[S.stage] || "dashboard"); }
// The ONE innerHTML write path for every per-poll container, guarded twice against the same failure:
// a poll lands every 2 s, and a rebuild landing between mousedown and mouseup destroys the element
// under the finger, so the browser fires NO click at all — the tap is lost with nothing logged.
//
//   1. Markup unchanged → don't write. Enough on its own for #connTile, whose rows are stable
//      between polls. NOT enough for #settingsCards any more: the ESP32 card carries the two
//      board-memory rows again, and free heap moves every second, so this check degrades to a plain
//      write there exactly as it does for the value grid — which is why guard 2 below is armed on
//      all three containers and not only on the one that obviously needed it.
//   2. A click is in flight → don't write. Needed because #valueGroups carries LIVE readings: its
//      markup differs on almost every push, so check 1 degrades to a plain write there and cannot
//      help. Without this the value rows lost 3–60 % of taps depending on how long the button was
//      held (DESIGN.md §6 carries the measurements).
//
// The cache is deliberately NOT updated when a write is skipped for reason 2 — recording markup that
// was never written would make the next identical push skip a write the DOM still needs.
const _html = {};
function setHtml(id, html) {
  if (S.clickHold) return;
  if (_html[id] === html) return;
  _html[id] = html;
  $(id).innerHTML = html;
}
// The dashboard header (identity + gear) and the back header (chevron + screen title) are the same
// slot: exactly one shows. The title is re-read from TITLE on every switch rather than stored, so it
// follows the UI language like every other string.
function renderHeader() {
  const dash = S.stage === "dashboard";
  $("hdrDash").hidden = !dash;
  $("hdrBack").hidden = dash;
  if (!dash) $("backTitle").textContent = (TITLE[S.stage] || (() => ""))();
}

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

// ── Status (drives every screen) ─────────────────────────────────────────
// Returns whether the fetch landed, so the poll loop can back off on a device that stopped
// answering. Its failure path IS the unreachable banner — every caller wants that, and a second
// copy of the decision in the loop could disagree with this one.
async function refreshStatus() {
  let s;
  try { s = await j("/status", { signal: pollSignal() }); } catch { markUnreachable(); return false; }
  S.status = s;
  setLangFromStatus(s);   // apply the device's language override (if any) before painting this frame
  renderApp();
  return true;
}
function markUnreachable() {
  sysSet(t("sys.unreachable"), t("sys.unreachable_sub"), "err");
}

// Re-render EVERY screen from the current /status + /values, not just the visible one: the screens
// are all in the DOM (only .active shows), a poll lands every 2 s regardless of where the user is,
// and rendering the hidden ones costs a few string builds — far cheaper than a per-screen refresh
// scheme that has to remember to run when a view is switched to.
function renderApp() {
  renderRecoveryBanner();
  renderRollbackBanner();
  renderCrashBanner();
  const s = S.status || {}, hp = s.hp || {};
  // Header is a fixed product title ("daikin-altherma-esp32", set in index.html) — the detected
  // model name lives in the Model card (statusCardsHtml), not the header.

  // The schematic's own status block: operation mode + fault state. Prefer the hydronic I/U mode
  // (conv 315 — Stop/Heating/Cooling/DHW/…) over the outdoor unit's Operation Mode: during a DHW run
  // the outdoor unit still reports "Heating" (it IS heating — the tank), but the user-relevant answer
  // is what the water side is doing. Plain first-match sorted the outdoor row first.
  const mode = schematicOperationMode();
  const fault = faultValue();
  const faulted = fault && !FAULT_OK.test(String(fault).trim());
  // Decode the readings ONCE, here: the status block and the drawing must not disagree about what
  // the plant is doing, and they did — the headline was written from the link state alone while the
  // pills beneath it were written from the values.
  // The drawing is built from a snapshot that may come from EITHER stack. Normally X10A: it carries
  // ~100 rows against the HomeHub's dozen, so it leads everywhere. When the X10A bus is silent but
  // the HomeHub is live, the snapshot is still built — liveData() fills what the second source can
  // supply and blanks the rest (mbFallbackFor), so the drawing degrades to the handful of readings
  // that ARE being measured instead of going blank while data is arriving.
  S.live = (hp.connected && (S._values || []).length > 0) || (x10aDown() && mbLive() && (S._modbus || []).length)
    ? liveData() : null;
  if (!hp.connected) {
    // "No data" would contradict a drawing full of Modbus readings. What is genuinely unknown here is
    // the heat pump's own STATE — the operating mode and the fault class are X10A-only, the HomeHub
    // carries no equivalent — so the headline says that the X10A link is down and stops short of
    // claiming a mode it cannot read, while the readings below speak for themselves.
    // The gateway KNOWS what the plant is doing, so the headline says it instead of "unknown": DHW
    // operation and space operation are separate flags there (def/homehub.hpp). The X10A fact moves
    // to the sub-line — it is still stated, it is just no longer the most useful thing on the card.
    // Deliberately NOT the gateway's "operation mode" register: that one is the heat/cool SEASON and
    // reads "heat" right through a DHW run, so a headline built from it would contradict the valve
    // drawn beside it.
    if (mbLive()) {
      const mbMode = mode;
      // A FAULT OR WARNING THE GATEWAY IS REPORTING OUTRANKS THE MODE. The diagnostic state and its
      // code are EKRHH offsets 21/22. Withholding either state while the device reports it is the
      // one direction a status headline must never fail in. Without this the card read a calm green
      // "Warmwasser" over a live error.
      const abnormality = mbUnitAbnormality();
      const code = mbVal(22);
      if (abnormality === 1) {
        sysSet(t("sys.fault"), code && !/^-*$/.test(code.trim())
                                 ? t("sys.fault_line", code) : t("sys.mb_only"), "err");
      } else if (abnormality === 2) {
        sysSet(t("sys.warning"), code && !/^-*$/.test(code.trim())
                                   ? t("sys.warning_line", code) : t("sys.mb_only"), "warn");
      } else {
        sysSet(mbMode || t("sys.x10a_down"),
               mbMode ? t("sys.mb_only") : t("sys.mb_carrying"), mbMode ? "" : "warn");
      }
    }
    else          sysSet(t("sys.nodata"), t("sys.waiting"), "dim");
  } else if (faulted) {
    sysSet(mode || t("sys.fault"), t("sys.fault_line", fault), "err");
  } else {
    // The drawing shows leaving water and outdoor itself, so the status line doesn't repeat them — it
    // only adds the poll age when there is no leaving-water pill to prove freshness (vLwt, the same
    // measurement picker the schematic uses; a plain /leaving water/ match could hit a setpoint).
    const stale = vLwt() == null && hp.last_ok_s != null ? " · " + t("sys.polled", hp.last_ok_s) : "";
    const p = plantState(S.live);
    // During a hot pump-overrun interval the Daikin mode row still says Cooling, but the water loop
    // is not producing cold. Name the selected mode as such and let the activity line state the
    // thermodynamic reality; a bare green "Cooling" over 57 °C moving water is otherwise false by
    // ordinary reading even though both underlying registers are individually correct.
    const modeHeadline = p === PLANT_COOL_RESIDUAL ? t("sys.cool_mode") : mode;
    sysSet(modeHeadline || t("sys.online"), t(p.key) + stale, p.tone);
  }
  renderHeaderMeta();
  renderSettings();
  renderLive();
  renderCards();
}
// Header identity line: the IP address (or the mDNS hostname while offline/unknown — whatever the
// browser is actually reached at) and the running firmware version, under the fixed product name.
// The IP moved out of the WiFi row (connectionsHtml) since it is board identity, not a WiFi *link*
// fact; the version moved up out of the ESP32 card, so the one line the user reads first answers
// both "which box is this" and "which firmware is on it" (DESIGN.md §5.4).
//
// This runs on EVERY status frame (~1/s), so it writes only the two fields it owns — #otaStat
// belongs to the OTA flow below and must survive a re-render mid-download, or the percentage would
// blink out once a second.
function renderHeaderMeta() {
  const w = S.status?.wifi || {};
  $("hdrIp").textContent = w.ip || location.hostname;
  const vl = $("verLink");
  vl.textContent = "v" + (S.status?.version || "?");
  vl.title = S.otaAvail ? t("ota.title_avail", S.otaAvail) : t("ota.title_check");
}
// The status block INSIDE the schematic (#scStatus): the operation mode is the drawing's headline —
// or the offline state, when there is no mode to report — over one status line, with a state dot.
// `tone` is "" (running), "err" (fault) or "dim" (no data / unreachable); it colours the line and the
// dot, but the words always say the state too, so colour is never the only carrier (DESIGN.md §9).
const TONE_FILL = { err: "var(--err)", dim: "var(--muted)", idle: "var(--muted)", "": "var(--ok)" };
// What the plant is actually DOING, read off the machine rather than off the fact that the X10A bus
// answers. "Operating" used to be printed unconditionally whenever the link was up, so an idle unit
// — compressor stopped, pump at 0 %, no flow — was announced as running, in green, directly above
// pills that all read zero. It also made the headline mode ("DHW") look like an active charge while
// the 3-way valve right below it said "→ heating"; a parked plant reports its LAST mode, and only
// the activity words can tell that apart from a live one.
// `idle` mutes the DOT but not the text — distinct from `dim` (no data at all), which mutes both.
const PLANT_RUNNING = { key: "sys.operating", tone: "" };
const PLANT_DEFROST = { key: "sys.defrosting", tone: "" };
const PLANT_CIRC = { key: "sys.circulating", tone: "" };
const PLANT_COOL_RESIDUAL = { key: "sys.residual_circulating", tone: "idle" };
const PLANT_BSH = { key: "sys.bsh_active", tone: "" };
const PLANT_STANDBY = { key: "sys.standby", tone: "idle" };
function plantState(d) {
  if (!d) return PLANT_STANDBY;
  if (d.defrost === true) return PLANT_DEFROST;
  // The tank's electric immersion heater can run with compressor, water pump and flow all at zero.
  // It is still active plant operation — and expensive resistive heat — so the exact X10A BSH flag
  // takes precedence over the generic compressor/pump states below.
  if (d.bsh === true) return PLANT_BSH;
  if (compressorRunning(d)) return PLANT_RUNNING;
  // Compressor off but water still moving: pump overrun, or the backup heater carrying the load on
  // its own. Something IS happening — it just isn't the heat pump, which is the point of saying so.
  const moving = d.pumpOn ?? (d.flow != null && d.flow > 1);
  // Positive R1T-R4T while Cooling is selected is the exact residual-hot circulation case: the
  // compressor is stopped, so it cannot be cooling, and the water is losing stored heat on its way
  // around the loop. This can be pump overrun/protection; it must not inherit the generic green
  // "Cooling / Operating" presentation.
  if (moving && d.thermalMode === "cool" && d.pthRaw != null && d.pthRaw > 0)
    return PLANT_COOL_RESIDUAL;
  if (moving) return PLANT_CIRC;
  return PLANT_STANDBY;
}
function sysSet(mode, status, tone) {
  setTxt("svMode", mode);
  setTxt("svStatus", status);
  $("svStatus").setAttribute("class", "sc-status" + (tone ? " " + tone : ""));
  $("svDot").setAttribute("fill", TONE_FILL[tone || ""]);
}
function pickValue(re) {
  const v = (S._values || []).find((x) => re.test(x.label || ""));
  return v ? (v.value == null ? null : String(v.value)) : null;
}
// A "no fault" reading (also the empty/absent case). Shared by the status header + faultValue.
const FAULT_OK = /^(none|no fault|normal|ok|0|—|-)?$/i;
// The unit fault to surface in the status header. Prefer the specific *code* (conv 204, labelled "… Code" →
// e.g. "U4") a technician needs over the generic *class* (conv 203, "Error type" → "Error"/"Caution").
// Both an indoor (0x60) and an outdoor (0x10) pair exist and their offset order differs per model, so
// a plain first-match on /fault|error/ can land on the class (the outdoor "Error type" sorts first).
// Return a faulted code from EITHER unit; else the first code (a healthy "0") or the class label — both
// read as not-faulted via FAULT_OK, so a healthy unit is never shown as faulted.
function faultValue() {
  const codes = (S._values || []).filter((x) => /(error|fault) code/i.test(x.label || "") && x.value != null);
  const bad = codes.find((x) => !FAULT_OK.test(String(x.value).trim()));
  if (bad) return String(bad.value);
  if (codes.length) return String(codes[0].value);
  return pickValue(/fault|error/i);
}

// ── Recovery (safe) mode banner ──────────────────────────────────────────
// Shown when /status.sys.safe_mode is true — the device crash-looped on a bad config and came up
// minimally (network + web UI + OTA only; the X10A poll engine and MQTT bridge are paused). It is not
// dismissible: it reflects a LIVE state and clears itself once a healthy reboot leaves safe mode. The
// recovery controls (behind the gear: the RX/TX pins on the Protocol card, the WiFi/MQTT modals)
// stay fully usable.
function renderRecoveryBanner() {
  const el = $("recoveryBanner");
  if (!el) return;
  if (!(S.status?.sys?.safe_mode)) { el.hidden = true; return; }
  // LANG is part of the draw signature: changing the device override must repaint a banner that is
  // already visible, while identical status polls in the same language still avoid DOM churn.
  const rsig = `1:${LANG}`;
  if (!el.hidden && el.dataset.on === rsig) return;   // already shown in this language
  el.dataset.on = rsig;
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${esc(t("recovery.title"))}</div>` +
    `<div class="crash-meta">${esc(t("recovery.meta"))}</div></div></div>`;
  el.hidden = false;
}

// ── WiFi rollback banner ─────────────────────────────────────────────────
// /status.wifi.rolled_back = the last /set_wifi was UNDONE: the new credentials never got a lease, so
// wifi.cpp restored the previous ones and rebooted. Without this the failure is invisible — the device
// simply reappears on the old SSID and the dashboard looks entirely normal, so the user is left
// believing the change took effect.
//
// This CANNOT be reported from the save flow: wifi.cpp spends 60–180 s deciding
// (logic/wifi_rollback.hpp — an AP that keeps refusing the creds is fast, an absent one gets a grace
// period), far past saveReboot's ~21 s poll, so the verdict almost always lands after the user has
// already reloaded the page. Hence a banner off /status rather than a toast.
//
// Not dismissible: the marker is sticky in NVS until the next /set_wifi retires it, which is exactly
// the "until the user acts on it" lifetime a banner wants.
function renderRollbackBanner() {
  const el = $("rollbackBanner");
  if (!el) return;
  const w = S.status?.wifi || {};
  if (!w.rolled_back) { el.hidden = true; el.dataset.on = ""; return; }
  // Key the re-render on what the banner DRAWS (the fallback SSID), not just on "is it shown" — the
  // same rule renderCrashBanner's `rsig` follows. A boolean key would leave a stale SSID on screen if
  // the name ever changed under a held marker.
  // The fallback network can stay identical while the device language changes from another client.
  // Include LANG so the persistent banner follows that live override instead of retaining old copy.
  const rsig = `${LANG}:1:${w.ssid || ""}`;
  if (el.dataset.on === rsig && !el.hidden) return;   // already rendered this — don't thrash the DOM
  el.dataset.on = rsig;
  // After the rollback the device is back on the OLD network, so /status.wifi.ssid names exactly the
  // network it fell back to.
  const back = w.ssid ? ` (<b>${esc(w.ssid)}</b>)` : "";
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${esc(t("rollback.title"))}</div>` +
    `<div class="crash-meta">${t("rollback.meta", back)}</div></div></div>`;
  el.hidden = false;
}

// ── Crash banner ─────────────────────────────────────────────────────────
// Shown when /status.last_crash is set — a fault reset (panic / watchdog / brown-out) or a core dump
// still waiting in flash. Offers the raw dump download (symbolized offline against the matching .elf
// — scripts/decode-coredump.sh) and a copy-paste diagnostics bundle for a bug report. Lives outside
// #valueGroups (rebuilt every poll), so its state survives re-renders.
//
// "Delete report" is a DEVICE action (POST /crash/dismiss), not a per-page hide: the banner used to
// be suppressed in page state alone, so a reload — the first thing anyone does — brought the same
// crash straight back. The device erases the dump and stops reporting the crash, so it is gone from
// every browser and from Home Assistant's retained crash entity at once. Deleting is irreversible
// and takes the one artifact a bug report needs with it (docs/REPORTING.md), so it asks first — a
// second tap INSIDE the banner, not a native confirm(): DESIGN.md §5.4 keeps the OTA update dialog
// the only one of those, and this needs no fields.
//
// Those two cases need DIFFERENT wording: last_crash is notable when `fault` OR `coredump` is set,
// so an orphan dump left in flash from an earlier crash raises the banner on every later boot — even
// a clean power-on or a USB re-plug (reset=usb, fault=false). Titling that "Device restarted after a
// crash" reports a crash that did not happen on this boot. Key the title on `fault`, which is the
// only field that says THIS boot was a crash.
function renderCrashBanner() {
  const el = $("crashBanner"), c = S.status?.last_crash;
  if (!c) { el.hidden = true; return; }
  // Two different identities. `sig` is WHICH crash this is — the key the delete flow works on, so an
  // answer that arrives about a DIFFERENT crash can't be acted on. `rsig` is what the banner
  // currently DRAWS, which also depends on c.coredump (it gates the download button, and /status
  // reports it live, so it flips to false the moment the dump is cleared) and on whether the confirm
  // step is showing. Keying the re-render on `sig` alone would leave a stale "Download crash report"
  // button pointing at a dump that is gone — a 404 — until a reload, and would freeze the confirm
  // step out of the DOM. They must stay SEPARATE attributes: the click handler reads dataset.sig, so
  // folding the draw state into it would compare "usb::true:" against sig "usb::" and silently break
  // the button.
  const sig  = `${c.reason}:${c.pc || ""}:${c.task || ""}`;
  const ask  = S.crashAsk === sig;
  // The crash identity stays language-neutral (`sig`, used by the delete flow), while the DRAW
  // signature includes LANG because every visible label/action in the banner is localised.
  const rsig = `${LANG}:${sig}:${!!c.coredump}:${ask}`;
  if (S.crashDismissed === sig) { el.hidden = true; return; }
  if (el.dataset.rsig === rsig && !el.hidden) return;   // already rendered this — don't thrash the DOM
  el.dataset.sig  = sig;    // crash key (read by the delete handler)
  el.dataset.rsig = rsig;   // render key

  const s = S.status || {}, bt = Array.isArray(c.backtrace) ? c.backtrace : [];
  const bits = [`${esc(t("crash.reset"))}: <b>${esc(c.reason)}</b>`];
  if (c.task) bits.push(`${esc(t("crash.task"))} <span class="mono">${esc(c.task)}</span>`);
  if (s.version) bits.push(`${esc(t("crash.fw"))} v${esc(s.version)}`);
  if (s.app_elf_sha256) bits.push(`${esc(t("crash.elf"))} <span class="mono">${esc(s.app_elf_sha256.slice(0, 12))}…</span>`);
  const btHtml = bt.length
    ? `<div class="crash-bt mono">${esc(bt.join(" "))}${c.corrupted ? " (" + esc(t("crash.corrupted")) + ")" : ""}</div>` : "";
  const dl = c.coredump
    ? `<a class="btn secondary sm" href="/coredump" download="coredump.bin">${esc(t("crash.download"))}</a>` : "";
  const title = c.fault ? t("crash.title_fault") : t("crash.title_orphan");
  // The confirm step REPLACES the actions row rather than appearing under it: what it asks about is
  // the two buttons beside it (the dump download most of all), and leaving them live next to their
  // own deletion prompt invites the tap that makes the question moot. The question names the dump
  // only when one exists — on a fault reset that overran its own dump there is nothing to lose but
  // the record, and saying otherwise would talk someone out of a harmless delete.
  const actions = ask
    ? `<div class="crash-ask">${esc(t(c.coredump ? "crash.ask_dump" : "crash.ask"))}</div>` +
      `<div class="crash-actions">` +
      `<button class="btn danger sm" type="button" data-cact="del">${esc(t("crash.ask_yes"))}</button>` +
      `<button class="btn ghost sm" type="button" data-cact="keep">${esc(t("crash.ask_no"))}</button></div>`
    : `<div class="crash-actions">${dl}` +
      `<button class="btn secondary sm" type="button" data-cact="copy">${esc(t("crash.copy"))}</button>` +
      `<button class="btn ghost sm" type="button" data-cact="ask">${esc(t("crash.dismiss"))}</button></div>`;
  el.innerHTML =
    `<div class="crash-head"><span class="crash-ico">!</span>` +
    `<div class="crash-txt"><div class="crash-title">${esc(title)}</div>` +
    `<div class="crash-meta">${bits.join(" · ")}</div>${btHtml}</div></div>` + actions;
  el.hidden = false;
}

// Copy text to the clipboard. The async Clipboard API needs a SECURE context (https/localhost), but
// the device is served over plain http on the LAN (no TLS by design) — there navigator.clipboard is
// undefined, so fall back to the legacy execCommand path, which still works in an http page.
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "0"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// Assemble a paste-ready diagnostics bundle (identity + crash summary + the /diag ring) and copy it
// to the clipboard, so a user can drop it straight into a bug report without pulling the binary dump.
async function copyDiagnostics() {
  let diag = "";
  try { diag = await (await fetch("/diag")).text(); } catch { /* keep the rest of the bundle */ }
  const s = S.status || {}, c = s.last_crash || {}, bt = Array.isArray(c.backtrace) ? c.backtrace : [];
  const lines = [
    "daikin-altherma-esp32 crash report",
    `firmware: v${s.version || "?"} (${s.platform || "?"})`,
    `app_elf_sha256: ${s.app_elf_sha256 || "?"}`,
    `reset: ${c.reason || "?"}  fault=${!!c.fault}  coredump=${!!c.coredump}`,
  ];
  if (c.task) lines.push(`task: ${c.task}  pc: ${c.pc || "?"}`);
  if (bt.length) lines.push(`backtrace: ${bt.join(" ")}${c.corrupted ? "  (corrupted)" : ""}`);
  if (c.elf_sha256 && c.elf_sha256 !== s.app_elf_sha256) lines.push(`crashed build elf_sha256: ${c.elf_sha256}`);
  lines.push("", "--- /diag ---", diag.trim());
  if (await copyText(lines.join("\n"))) toast(t("crash.copied"), "ok");
  else toast(t("crash.copy_fail"), "err");
}

// Delete this boot's crash report ON THE DEVICE (POST /crash/dismiss): the dump is erased and the
// device stops reporting the crash, so /status.last_crash goes null and the banner is gone for every
// browser and for Home Assistant's retained crash entity — which is the whole point of the button
// over the page-local hide it replaced.
//
// The banner is hidden on the local signature the moment the device confirms, because the live status
// push builds its frames ~1×/4 s and one composed before the delete landed would draw the crash again
// for a beat. A FAILED delete restores the banner instead: the report is still on the device, and a
// page that hid it anyway would be lying about flash — the same fail-closed direction the firmware
// takes when it refuses to mark a crash dismissed after a failed erase.
async function deleteCrashReport(sig) {
  S.crashAsk = "";
  let ok = false;
  try { ok = (await fetch("/crash/dismiss", { method: "POST" })).ok; } catch { ok = false; }
  if (!ok) { toast(t("crash.delete_fail"), "err"); renderCrashBanner(); return; }
  S.crashDismissed = sig;
  if (S.status) S.status.last_crash = null;
  $("crashBanner").hidden = true;
  toast(t("crash.deleted"), "ok");
}

// ── Bug report ───────────────────────────────────────────────────────────
// The repository bug reports go to. ONE place: the issue URL and the reporting guide are both
// derived from it, so a fork edits a single line.
const REPO = "0Bu/daikin-altherma-esp32";

// Collect the device half of a report: the four read endpoints, /status and /diag in their REDACTED
// form (logic/redact.hpp — the DEVICE scrubs, so this page, the manual fallback in
// docs/REPORTING.md and anything else all get the same answer).
//
// That redaction is why this goes straight into the public issue instead of down a private channel:
// what is left describes the firmware, not the reporter. The one thing that stays private is a core
// dump, which is raw stack memory and can hold a short password inline in a std::string — it is not
// collected here, and /status.last_crash already carries the reason, task, PC and backtrace.
//
// A failed fetch is WRITTEN INTO the report, never dropped: a section that is silently absent reads
// as "the device had nothing to say", which is a different and much more misleading claim than "this
// could not be read". Same reason the /diag truncation below announces itself.
async function collectBugReport() {
  const s = S.status || {};
  const parts = [
    ["Device report (/status)", "/status?redact=1", "json"],
    ["Readings (/values)", "/values", "json"],
    ["Update status (/ota/status)", "/ota/status", "json"],
    ["Device log (/diag)", "/diag?verbose=1&redact=1", "text"],
  ];
  const fetched = [];
  let failed = false;
  for (const [title, url, kind] of parts) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fetched.push([title, kind, (await r.text()).trim()]);
    } catch (e) {
      failed = true;
      fetched.push([title, kind, null, String(e && e.message ? e.message : e)]);
    }
  }
  const head = [
    "# daikin-altherma-esp32 bug report",
    "",
    `firmware: ${s.version || "?"} (${s.platform || "?"})`,
    `app_elf_sha256: ${s.app_elf_sha256 || "?"}`,
    `generated: ${s.ntp?.time || "unknown — the device clock has not synced this boot"}`,
    "redacted: wifi.ssid, wifi.ip, wifi.bssid, wifi.mac, mqtt.broker, reference_temperature.name, reference_temperature.topic, syslog.host, ntp.server",
    "",
    "",
  ].join("\n");
  let body = "";
  for (const [title, kind, text, err] of fetched) {
    body += `## ${title}\n\n`;
    body += err != null
      ? `_Could not be read from the device: ${err}_\n\n`
      : "```" + kind + "\n" + text + "\n```\n\n";
  }
  // A GitHub issue body holds 65,536 characters, and this is pasted into one field of a form that
  // has other fields — so the cap is real rather than cosmetic. /diag is both the longest section
  // and the only one whose oldest end is the expendable end, so it is what gets trimmed —
  // announced, because a report that looks complete and is not is the failure this flow exists to
  // prevent.
  const LIMIT = 60000;
  if (head.length + body.length > LIMIT) {
    const over = head.length + body.length - LIMIT;
    const at = body.indexOf("## Device log (/diag)");
    if (at >= 0) {
      const before = body.slice(0, at), diag = body.slice(at);
      const lines = diag.split("\n");
      let cut = 0, dropped = 0;
      while (dropped < over + 80 && cut < lines.length - 2) { dropped += lines[cut].length + 1; cut++; }
      body = before + lines[0] + "\n\n```text\n" + `[truncated: the oldest ${cut} lines were dropped to fit]\n` +
             lines.slice(cut).join("\n").replace(/^```text\n/, "");
    }
  }
  return { text: head + body, failed };
}

function bugFilename(s) { return `daikin-report-${(s && s.version) || "unknown"}.md`; }

// Offer the report as a file too. The clipboard is the fast path, but it is one Ctrl-V away from
// being lost, and this page is served over plain http where the async Clipboard API does not exist
// at all (copyText's execCommand fallback is what actually runs).
function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openBug() {
  $("bugWhat").value = "";
  $("bugError").hidden = true;
  $("bugStep1").hidden = false;
  $("bugStep2").hidden = true;
  openPopup("bugModal");
}
function closeBug() { $("bugModal").hidden = true; }

// Step 2: build the report and show it. GitHub is NOT opened here — the tab opens on the copy
// button below, so that the moment the user arrives at the form the clipboard already holds what
// the form asks them to paste. Opening it earlier put them in front of an empty field with the
// report still being fetched behind them.
//
// The device report is deliberately not put in the issue URL either — it is a few kB, and an
// over-long URL is a 414, not a truncation anyone would notice. The clipboard carries it.
//
// What IS prefilled is narrow. `hp_model` is not — the form asks for the nameplate, and the device
// only has its own detection GUESS; prefilling it would invite the user to confirm the very guess
// the field exists to catch when it is wrong. `symptom`, `board` and `onset` are not prefilled
// either: their option lists live in the issue form, and a copy of them here would be a second list
// to drift (a mismatched value just silently selects nothing).
async function bugPrepare() {
  const what = $("bugWhat").value.trim();
  if (!what) {
    $("bugError").textContent = t("bug.need_text");
    $("bugError").hidden = false;
    $("bugWhat").focus();
    return;
  }
  const s = S.status || {};
  const q = new URLSearchParams({
    template: "bug_report.yml",
    summary: what,
    fw_version: `${s.version || "?"} (${s.platform || "?"})`,
  });
  const issueUrl = `https://github.com/${REPO}/issues/new?${q}`;

  $("bugStep1").hidden = true;
  $("bugStep2").hidden = false;
  $("bugStep2Text").textContent = t("bug.step2");
  $("bugText").value = t("bug.collecting");
  $("bugCopy").disabled = true;
  const { text, failed } = await collectBugReport();
  $("bugText").value = text;
  $("bugCopy").disabled = false;
  // Copy AND open, in that order in the user's head but this order in code: window.open runs first
  // and synchronously, because a pop-up blocker only honours it while the click that caused it is
  // still the current task, and copyText is an async function — even its execCommand path (the one
  // that actually runs, since the device serves plain http) resumes a microtask later.
  $("bugCopy").onclick = async () => {
    window.open(issueUrl, "_blank", "noopener");
    if (await copyText(text)) toast(t("bug.copied"), "ok");
    else toast(t("bug.copy_fail"), "err");
  };
  $("bugDownload").onclick = () => downloadText(bugFilename(s), text);
  if (failed) toast(t("bug.collect_fail"), "err");
}
