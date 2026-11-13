// THE SOURCE-ARBITRATION MATRIX — which of the two stacks answers a given fact, in every state the
// pair can be in. Runs the REAL helpers out of the assembled UI source in a DOM-free VM harness, the same
// shape test_ui_board_preset.mjs uses, because CI has no browser.
//
// It exists because the host gates were all green while the arbitration was wrong. The rule
// ("X10A leads, Modbus supports, stale is never live") was written out separately for the valve, the
// pump and the normal space-operation state, and the three had drifted into three different behaviours:
//
//   • the valve read `X10A ?? Modbus` and was never cleared when the X10A link dropped, so a STALE
//     X10A position beat a live gateway one — the header said "DHW · readings from Modbus" while the
//     drawing routed water through the radiators and left the tank branch idle;
//   • the pump and the demand had the mirror bug, cleared on link loss and never restored from the
//     gateway, so they blanked next to readings that were arriving;
//   • and nothing gated the gateway helpers on the gateway being CONNECTED, so its last cache was
//     drawn as the live second opinion, complete with a computed "difference" against a live X10A
//     value — a number about two instants presented as a number about two instruments.
//
// None of those is visible in a value, a converter or a payload schema, which is why every existing
// gate passed. They are visible in exactly one place: the pair of link states. So that pair is what
// this file enumerates.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

// Keep the source-arbitration test's history boundary stubs: loading the entire history fragment
// would replace hasRoomHist/roomHistName. Execute only its shared pure hydronic rules.
const historySource = readAppFragments(["history.js"]);
const hydronicSource = ["pumpCommandPercent", "usableWaterFlow"].map(name => {
  const match = historySource.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  assert.ok(match, "the production rule must be present: " + name);
  return match[0];
}).join("\n");
const SOURCE = hydronicSource + readAppFragments(["descriptions.js", "schematic.js"]);
const index = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");
const demo = fs.readFileSync(new URL("../tools/uigif/scenes.js", import.meta.url), "utf8");

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
// A /values X10A row and a HomeHub row, exactly as http_status.cpp serves them.
const X = (label, value, concept, extra = {}) => ({ label, value, unit: "°C", reg: 0x61, concept, ...extra });
const M = (off, label, value, concept, extra = {}) => ({ label, value, unit: "°C", off, concept, ...extra });

// The 3-way valve as each side reports it: X10A bit-flag row, HomeHub offset 37.
const X_VALVE = (on) => ({ label: "3way valve(On:DHW_Off:Space)", value: on ? "1" : "0",
                           unit: "", reg: 0x60, binary: true, concept: "valve_dhw" });
const X_DEFROST = (value) => ({ label: "Defrost Operation", value, reg: 0x10, binary: true });
const M_VALVE = (on) => ({ label: "3-way valve", value: on ? 1 : 0,
                           unit: "", off: 37, enum: "three_way_valve", concept: "valve_dhw" });
const M_FLAG = (off, label, on, concept = null) => ({
  label, value: on ? 1 : 0, unit: "", off, binary: true, concept,
});

function ctx({ x10a, mbEnabled, mbConnected, mbCompressor = null, values = [], modbus = [], elements = {} }) {
  const context = {
    INSPECT_I18N: Object.create(null),
    MB_DELTA_I18N: Object.create(null),
    S: {
      // The saved ADDRESS rides with `enabled`, because that is the shape http_status.cpp emits: the
      // stack only ever starts from a non-empty mb_host, so an enabled gateway with no address is
      // not a device state, and a fixture carrying one is a test of the fixture. It matters because
      // `host` is the one modbus field that stays a CONFIG fact in safe mode, where `enabled` drops
      // to false on a plant whose gateway is perfectly well configured.
      status: { hp: { connected: x10a },
                modbus: { enabled: mbEnabled, connected: mbConnected,
                          host: mbEnabled ? "192.0.2.30" : "" } },
      _values: values,
      _modbus: modbus,
      modbusCompressorRunning: mbCompressor,
    },
    // History/i18n live in separate production fragments and are outside this arbitration test;
    // provide only their presentation boundary while executing the complete descriptions and
    // schematic fragments, including their real row/state selectors and consumers.
    esc: (s) => String(s ?? "").replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    displayValue: (v) => {
      if (!v || v.value == null) return "—";
      const raw = String(v.value);
      if (v.binary === true) { const s = raw.trim(); if (s === "1") return "ON"; if (s === "0") return "OFF"; }
      return raw;
    },
    displayUnit: (v) => String(v?.unit ?? "").trim() ||
      (/\((kW|A|rps|pls|step|l\/min)\)\s*$/i.exec(String(v?.label ?? ""))?.[1] || ""),
    displayReadingLabel: (l) => String(l ?? "").trim()
      .replace(/\s*\((kW|A|rps|pls|step|l\/min)\)\s*$/i, "")
      .replace(/\s*\([^)]*On\s*:[^)]*Off\s*:[^)]*\)\s*$/i, "").trim(),
    displayHomeHubLabel: (r) => String(r?.label ?? "").trim(),
    hasRoomHist: (id) => !!context.S.status.history?.room_rows?.some((r) => r.id === id),
    roomHistName: () => `${context.S.status.reference_temperature?.name || "Room"} · MQTT`,
    t: (k, a, b) => (k === "src.disagree" ? "sources disagree"
                   : k === "src.agree" ? "agree"
                   : k === "src.delta" ? `Difference ${a} ${b}`
                   : k === "src.modbus_tag" ? "modbus" : k),
    LANG: "en",
    $: (id) => elements[id] || null,
  };
  vm.createContext(context);
  // `const` is lexical and never becomes a property of the context, so the helpers are handed out
  // explicitly — the same trick test_ui_live_i18n.mjs uses for its production function.
  vm.runInContext(
    SOURCE + "\nthis.__api = { mbByConcept, mbTwin, mbFallbackFor, mbStandInFor, rowNotMeasuring," +
    " mbLive, mbBool, mbVal, stateOf, MB_DELTA_WHY," +
    " MB_PAIRS, MB_OFF_POWER, MB_OFF_SMART_GRID, mbPower, modbusEnumNumber, mbSmartGridMode, mbForInspect," +
    " mbUnitAbnormality," +
    " SMART_GRID_MODE_VALUE, x10aSmartGridModeFrom, x10aSmartGridMode, x10aSmartGridRow," +
    " sgModeText, mbNoteHtml, mbDeltaHtml, descFor, inspCurRow, inspMember," +
    " inspMembers, inspValues, inspComparisonHtml, inspHeld, liveData, compressorRunning," +
    " waterMoving, waterThermalKind, activeSpaceKind, ouReadingText, updateSchematicStateA11y, INSPECT," +
    " pelMeasured, pelApproxText, PEL_INSPECT, vRow, vNum, highSideRow, inspHeldHtml, inspUnknownAge," +
    " inspNowText, heldUnknownText, OUTDOOR_HX_RE };",
    context, { filename: "main/www/app.sources" });
  context.__api.S = context.S;
  context.__api.setTxLang = (lang) => { context.LANG = lang; };
  context.__api.renderLiveFixture = () => vm.runInContext(
    "renderEnv3Pill = () => {}; renderInspect = () => {}; renderLive();", context);
  return context.__api;
}

// Hybrid's default room sensor uses RT Temp.; HPSU6 uses the same label only when that row
// actually reaches /values. The source selector, drawing and inspector must agree on that row.
{
  for (const profile of ["altherma_hybrid", "altherma_hpsu6_ultra"]) {
    const catalog = fs.readFileSync(new URL(`../main/def/${profile}.hpp`, import.meta.url), "utf8");
    assert.match(catalog, /\{0x61, 12, 105, 2, 1, "RT Temp\."\}/);
    assert.match(catalog, /\{0x62, 5, 105, 2, 1, "RT setpoint"\}/);
  }
  const hybrid = fs.readFileSync(new URL("../main/def/altherma_hybrid.hpp", import.meta.url), "utf8");
  assert.match(hybrid, /"RT Temp\."\},\s*\/\/ default_on/);
  const room = X("RT Temp.", "21.5", "room_temp", { off: 12 });
  const setpoint = X("RT setpoint", "22.0", "room_setpoint", { reg: 0x62, off: 5 });
  const hubRoom = M(50, "Remote controller room temperature Main", "23.0", "room_temp");
  const nodes = new Map();
  const elements = new Proxy({}, { get: (_, id) => {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, { textContent: "", setAttribute() {}, closest: () => null, querySelectorAll: () => [],
        classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
          contains: (c) => classes.has(c),
          toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } } });
    }
    return nodes.get(id);
  } });
  const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                  values: [room, setpoint], elements });
  c.S.live = c.liveData();
  assert.equal(c.S.live.room, 21.5);
  assert.equal(c.S.live.roomSet, 22);
  c.renderLiveFixture();
  assert.equal(nodes.get("svRoom").textContent, "21.5");
  assert.equal(nodes.get("svRoomSet").textContent, "22.0");
  assert.equal(nodes.get("schem").classList.contains("no-room"), false);
  assert.equal(c.inspCurRow(c.INSPECT.room), room);
  for (const entry of [c.INSPECT.room, c.INSPECT.heat, c.INSPECT.spaceh])
    assert.ok(c.inspMembers(entry, null, null).some((m) => m.x10a === room),
      "each room/component inspector resolves the actual Hybrid room row");
  for (const missing of [[], [X("RT Temp.", null, "room_temp")],
                         [X("RT Temp. unsupported suffix", "99", "room_temp")]]) {
    c.S._values = [...missing, setpoint];
    c.S.live = c.liveData();
    assert.equal(c.S.live.room, null, "absent, withheld or unrelated room rows never become zero");
    c.renderLiveFixture();
    assert.equal(nodes.get("schem").classList.contains("no-room"), true);
    assert.equal(nodes.get("svRoom").textContent, "—");
  }
  c.S.status.reference_temperature = { configured: true, name: "Example room", has_value: true,
    fresh: true, temperature_valid: true, temperature_c: 23.6, control_eligible: false };
  c.S.status.history = { room_rows: [{ id: "room_temp", label: "Example room" }] };
  c.S.live = null;
  c.renderLiveFixture();
  assert.equal(nodes.get("schem").classList.contains("no-room"), false,
    "an independent MQTT room instrument stays reachable without a plant snapshot");
  assert.equal(nodes.get("svRoom").textContent, "23.6",
    "diagnosis ineligibility cannot blank a fresh, valid room measurement");
  assert.equal(nodes.get("svRoomSet").textContent, "—",
    "the actual-temperature extension cannot substitute the MQTT target for the plant target");
  c.S.status.reference_temperature.fresh = false;
  c.renderLiveFixture();
  assert.equal(nodes.get("svRoom").textContent, "—", "stale MQTT current data is withheld");
  assert.equal(nodes.get("schem").classList.contains("no-room"), false,
    "a stale current sample cannot hide the source's measured history");
  c.S._values = [room, setpoint];
  c.S.live = c.liveData();
  c.renderLiveFixture();
  assert.equal(nodes.get("svRoom").textContent, "21.5", "the device room reading remains primary");
  assert.equal(nodes.get("svRoomSet").textContent, "22.0");
  c.S.status.history.room_rows = [];
  c.S.live = null;
  c.renderLiveFixture();
  assert.equal(nodes.get("schem").classList.contains("no-room"), true,
    "without either instrument the no-data path restores the empty room layout");
  for (const label of ["RT Temp.", "Indoor ambient temp. (R1T)"]) {
    const measured = { ...room, label };
    const both = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                       values: [measured, setpoint], modbus: [hubRoom] });
    assert.equal(both.liveData().room, 21.5, "live X10A room wins over HomeHub");
    assert.equal(both.inspCurRow(both.INSPECT.room), measured);
    both.S.status.hp.connected = false;
    assert.equal(both.liveData().room, 23, "live HomeHub substitutes for a lost X10A source");
    both.S.status.modbus.connected = false;
    assert.equal(both.mbVal(50), null, "stale HomeHub is never a fallback reading");
    both.S.status.hp.connected = true;
    both.S._values = [setpoint];
    assert.equal(both.liveData().room, null, "missing X10A room plus stale HomeHub remains absent");
  }
}

// Boost, BSH and both outdoor modes are permanent state pills. Their compact faces keep only the
// stable component name; the written state remains in the inspector and accessible name while
// colour changes on the face.
{
  assert.match(index, /id="gBshState"[\s\S]*?tabindex="0"/,
    "the heater pill must remain interactive while it is off");
  assert.doesNotMatch(index, /id="gBshState"[^>]*aria-hidden/);
  assert.match(index, /id="gBshState"[\s\S]*?data-i18n="schem\.bsh_label"/,
    "the heater pill keeps only its stable component name");
  assert.match(index,
    /class="sc-bsh-state-box" x="541" y="286" width="70" height="16" rx="8"/,
    "the heater pill stays compact and centred inside the tank");
  assert.match(index, /class="sc-box sc-tank" x="518" y="258" width="120" height="108"/,
    "the DHW tank keeps the shared compact consumer width and matches the space box height");
  assert.match(index, /class="sc-box" x="660" y="258" width="120" height="108"/,
    "the space circuit matches the DHW tank width and shares its band");
  // Tank LEFT on the valve's straight drop, space circuit RIGHT on the L-shaped run. Each flow
  // overlay must ride its own branch's pipe, or a DHW cycle animates the heating leg (and back).
  assert.match(index, /data-insp="wtank"[^>]*>\s*<path class="sc-pipe" d="M610 180 V 258"\/>\s*<path class="sc-pipe" d="M610 366 V 420"\/>/,
    "the DHW tank owns the valve's straight drop and its return on the same axis");
  assert.match(index, /data-insp="wheat"[^>]*>\s*<path class="sc-pipe" d="M610 180 H 720 V 258"\/>\s*<path class="sc-pipe" d="M720 366 V 420 H 610"\/>/,
    "the space circuit owns the right-hand L-shaped supply and return");
  for (const [id, d] of [["fTank", "M610 180 V 258"], ["fTankRet", "M610 366 V 420"],
                         ["fHeat", "M610 180 H 720 V 258"], ["fHeatRet", "M720 366 V 420 H 610"]]) {
    assert.match(index, new RegExp(`id="${id}" d="${d}"`), `#${id} animates its own branch's pipe`);
  }
  // The perimeter flows trace a box EDGE, so the audit's overlay-on-pipe rule (G010) skips them:
  // pin each half to its own box, starting and ending where that branch's riser meets it.
  for (const [id, d] of [
    ["fTankEdgeL", "M610 258 H532 A14 14 0 0 0 518 272 V352 A14 14 0 0 0 532 366 H610"],
    ["fTankEdgeR", "M610 258 H624 A14 14 0 0 1 638 272 V352 A14 14 0 0 1 624 366 H610"],
    ["fSpaceEdgeL", "M720 258 H674 A14 14 0 0 0 660 272 V352 A14 14 0 0 0 674 366 H720"],
    ["fSpaceEdgeR", "M720 258 H766 A14 14 0 0 1 780 272 V352 A14 14 0 0 1 766 366 H720"]]) {
    assert.match(index, new RegExp(`id="${id}" d="${d}"`), `#${id} runs on its own box's perimeter`);
  }
  assert.match(index, /id="tankFlow" gradientUnits="userSpaceOnUse" x1="578" y1="258" x2="578" y2="366"/,
    "the tank's charging gradient spans the tank box");
  assert.match(index, /id="spaceFlow" gradientUnits="userSpaceOnUse" x1="720" y1="258" x2="720" y2="366"/,
    "the space-circuit gradient spans the space box");
  assert.match(index,
    /class="sc-emitter" d="M680 288 v28 M700 288 v28 M720 288 v28 M740 288 v28 M760 288 v28"/,
    "the emitter bars extend to the room-reading block");
  assert.match(index,
    /class="sc-val" x="720" y="336"[^>]*>[\s\S]*?id="svRoom"/,
    "the room temperature shares the DHW temperature baseline");
  assert.match(index,
    /class="sc-sub" x="720" y="353"[^>]*>[\s\S]*?id="svRoomSet"/,
    "the room setpoint shares the DHW setpoint baseline");
  assert.match(style,
    /\.no-room \.sc-emitter \{[^}]*transform:\s*scaleY\(2\.5\)[^}]*transform-origin:\s*top/,
    "without a room reading the emitter bars extend to the box's bottom margin");
  assert.doesNotMatch(index, /id="svSgRequest"/,
    "the Boost pill has no visible active/inactive second line");
  assert.match(style, /svg \.sc-bsh-state-box \{[^}]*fill:\s*var\(--hatch\)/,
    "inactive heater pill uses the neutral light-grey fill");
  assert.match(style, /\.bsh-on \.sc-bsh-state-box \{[^}]*stroke:\s*var\(--warn\)/,
    "active heater pill turns orange as a whole pill");
  assert.match(style, /#schem\.bsh-on \.sc-tank-flow \{[^}]*stroke:\s*var\(--warn\)[^}]*animation:\s*dashfwd/,
    "active heater animates the DHW tank perimeter in orange over its grey resting edge");
  // clearSchematic() (the no-data / X10A-unreachable render path) must stop the box-perimeter flows
  // too — a .sc-flow-only reset silently left the new sc-tank-flow / sc-space-flow overlays animating,
  // so an unreachable plant looked like a live charging one.
  assert.match(SOURCE, /function clearSchematic\(\)[\s\S]*?querySelectorAll\([^)]*\.sc-tank-flow[^)]*\.sc-space-flow[^)]*\)/,
    "clearSchematic resets the box-perimeter flows (sc-tank-flow/sc-space-flow), not just sc-flow/sc-rflow");
  assert.match(SOURCE, /function clearSchematic\(\)[\s\S]*?classList\.toggle\("no-room", !roomReferencePresent\(\)\)/,
    "the no-plant path preserves an independent room instrument while hiding an absent one");
  assert.match(style, /svg \.sc-sg-request-box \{[^}]*fill:\s*var\(--hatch\)/,
    "inactive Boost pill uses the neutral light-grey fill");
  assert.match(style, /\.sg-boost-on \.sc-sg-request-box \{[^}]*stroke:\s*var\(--src-mb\)/,
    "active Boost pill keeps the HomeHub petrol state colour");
  for (const id of ["gDefrostState", "gQuietState"]) {
    assert.match(index, new RegExp(`id="${id}"[\\s\\S]*?tabindex="0"`),
      `${id} must remain interactive while inactive`);
    assert.doesNotMatch(index, new RegExp(`id="${id}"[^>]*aria-hidden`));
  }
  assert.match(index, /<g transform="translate\(74 231\)">[\s\S]*?id="scFan"/,
    "the fan is vertically centred between the outdoor-unit heading and first pill");
  assert.match(index, /data-insp="comp"[\s\S]*?<circle class="sc-comp" cx="158" cy="231" r="26"/,
    "the compressor shares the fan's vertical centre between heading and first pill");
  assert.match(index, /id="gQuietState"[\s\S]*?<rect class="sc-pill sc-ou-mode-pill" x="62" y="316" width="104" height="22" rx="11"[\s\S]*?<text class="sc-val" x="114" y="331"/,
    "Quiet follows the electrical-input row in the outdoor pill column");
  assert.match(index, /id="gDefrostState"[\s\S]*?<rect class="sc-pill sc-ou-mode-pill" x="62" y="348" width="104" height="22" rx="11"[\s\S]*?<text class="sc-val" x="114" y="363"/,
    "Defrost follows Quiet in the single centred outdoor pill column");
  assert.match(index, /data-insp="out"[\s\S]*?<rect class="sc-pill sc-ou-reading" x="62" y="380" width="104" height="22" rx="11"/,
    "outdoor air uses the shared outdoor readout geometry");
  assert.match(index, /data-insp="pel"[\s\S]*?<rect class="sc-pill sc-ou-reading" x="62" y="288" width="104" height="22" rx="11"/,
    "electrical input starts the outdoor pill column below the component row");
  assert.match(index, /data-insp="ouhx"[\s\S]*?<rect class="sc-pill sc-ou-reading" x="62" y="412" width="104" height="22" rx="11"/,
    "outdoor heat-exchanger R4T ends the pill column above the outdoor-unit bottom");
  assert.match(style, /svg \.sc-snow \.sc-pill, svg \.sc-quiet \.sc-pill \{[^}]*fill:\s*var\(--hatch\)[^}]*stroke:\s*var\(--pipe\)/,
    "inactive outdoor-mode pills use the neutral grey treatment");
  assert.match(style, /\.defrost-on \.sc-snow \.sc-pill, \.quiet-on \.sc-quiet \.sc-pill \{[^}]*stroke:\s*var\(--brand\)/,
    "active outdoor modes turn blue");
  assert.doesNotMatch(style, /svg \.sc-snow, svg \.sc-quiet \{[^}]*visibility:\s*hidden/,
    "outdoor-mode pills must never be conditionally hidden");

  const inspectPick = /function inspectPick\(key\) \{[\s\S]*?\n\}/.exec(SOURCE)?.[0] || "";
  assert.match(inspectPick, /S\.insp = S\.insp !== key \? key : null/,
    "every schematic target must use the shared toggle-only inspector handler");
  assert.doesNotMatch(inspectPick, /scrollIntoView|scrollTo|scrollBy/,
    "opening BOOST, BUH or any other inspector must preserve the browser scroll position");

  const attrs = (id) => ({
    setAttribute: (k, v) => elements[id].values.set(k, String(v)),
  });
  const elements = {
    gBshState: { values: new Map() },
    gSgRequest: { values: new Map() },
    gDefrostState: { values: new Map() },
    gQuietState: { values: new Map() },
    g2wv: { values: new Map() },
  };
  Object.keys(elements).forEach((id) => Object.assign(elements[id], attrs(id)));
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, elements });
  c.updateSchematicStateA11y({ bsh: false, defrost: false, quiet: false, sgMode: 0,
                                valve2On: false });
  assert.equal(elements.gBshState.values.get("aria-label"), "schem.bsh_label: state.off");
  assert.equal(elements.gSgRequest.values.get("aria-label"), "schem.sg_boost: sg.mode0");
  assert.equal(elements.gDefrostState.values.get("aria-label"), "schem.defrost_pill: state.off");
  assert.equal(elements.gQuietState.values.get("aria-label"), "chip.quiet: state.off");
  assert.equal(elements.g2wv.values.get("aria-label"), "schem.valve2: state.off");
  c.updateSchematicStateA11y({ bsh: true, defrost: true, quiet: true, sgMode: 2,
                                valve2On: true });
  assert.equal(elements.gBshState.values.get("aria-label"), "schem.bsh_label: state.on");
  assert.equal(elements.gSgRequest.values.get("aria-label"), "schem.sg_boost: sg.mode2");
  assert.equal(elements.gDefrostState.values.get("aria-label"), "schem.defrost_pill: state.on");
  assert.equal(elements.gQuietState.values.get("aria-label"), "chip.quiet: state.on");
  assert.equal(elements.g2wv.values.get("aria-label"), "schem.valve2: state.on");
}

const LWT_X = X("Leaving water temp. before BUH (R1T)", "38.6", "leaving_water");
const LWT_M = M(40, "Leaving water temperature PHE", "38.1", "leaving_water");
const OUT_X = X("R1T-Outdoor air temp.", "19.0", "outdoor_air", { reg: 0x20 });
const RPS_STOP = { label: "INV frequency (rps)", value: "0", unit: "rps", reg: 0x30 };
const DISCH_X = X("Discharge pipe temp.", "72.0", null, { reg: 0x20 });
const OUT_M = M(44, "Outdoor air temperature", "28.5", "outdoor_air");
const SG = (value) => M(56, "Smart Grid operation mode", value, null,
  { unit: "", enum: "smart_grid_mode" });
const ABNORMALITY = (value) => M(21, "Unit abnormality", value, null,
  { unit: "", enum: "unit_abnormality" });
const X_SG = (contact, on) => ({
  label: `SmartGridContact${contact}`, value: on ? "1" : "0", unit: "", reg: 0x60,
  binary: true, binary_semantic: `smart_grid_contact_${contact}`,
});
const X_BSH = (on) => ({ label: "BSH", value: on ? "1" : "0", unit: "", reg: 0x60,
                         binary: true, concept: "bsh_state" });
const M_BSH = (on) => M_FLAG(32, "Booster heater run", on, "bsh_state");
const X_QUIET = (on) => ({ label: "Silent Mode", value: on ? "1" : "0", unit: "", reg: 0x60,
                           binary: true, concept: "quiet_state" });
const X_LOW_NOISE = (on) => ({ label: "Low noise control", value: on ? "1" : "0", unit: "",
                               reg: 0x10, binary: true });
const M_QUIET = (on) => M_FLAG(9, "Quiet mode operation", on, "quiet_state");
const X_2WV = (on) => ({ label: "2way valve(On:Heat_Off:Cool)", value: on ? "1" : "0",
                         unit: "", reg: 0x60, binary: true, binary_semantic: "valve_heat" });

// Explanation semantics are part of source arbitration too: several catalog labels overlap while
// naming different sensors, units or protocols. Pin the distinctions that the installer manuals
// establish so a broad first-match regex cannot silently turn a green coverage audit into bad copy.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true });

  const hx = c.descFor("Outdoor heat exchanger temp.", { reg: 0x20 });
  assert.match(hx.what, /sensor at the outdoor heat exchanger/i);
  assert.doesNotMatch(hx.what, /outside air temperature measured at the unit/i,
    "the outdoor-coil sensor must never inherit ambient-air copy");

  for (const label of ["Pressure(T)", "Pressure sensor(T)", "High pressure(Sat. °C)"]) {
    const d = c.descFor(label, { reg: 0x20 });
    assert.match(d.what, /saturation temperature/i, `${label} is a calculated temperature`);
    assert.match(d.what, /not a pressure value in bar/i, `${label} must not be explained as bar`);
  }

  const beCop = c.descFor("BE_COP", { reg: 0x10 });
  assert.match(beCop.what, /threshold used to choose between heat pump and boiler/i);
  assert.match(beCop.what, /not the plant's currently measured COP/i);

  const output = c.descFor("Space H Operation output", { reg: 0x60 });
  assert.match(output.what, /output terminal/i);
  assert.doesNotMatch(output.what, /thermostat demand/i);

  const pipeFreeze = c.descFor("Freeze Protection for water piping", { reg: 0x60 });
  const genericFreeze = c.descFor("Freeze Protection", { reg: 0x60 });
  assert.match(pipeFreeze.what, /water piping/i);
  assert.match(genericFreeze.what, /proprietary service bit/i);
  assert.notEqual(pipeFreeze, genericFreeze, "room/general and pipe frost protection stay distinct");

  const xMode = c.descFor("Operation Mode", { reg: 0x10 });
  const mbMode = c.descFor("Operation Mode", { off: 3 });
  assert.match(xMode.what, /currently reported by the outdoor unit/i);
  assert.doesNotMatch(xMode.what, /configured HomeHub/i);
  assert.match(mbMode.what, /configured HomeHub heat\/cool selection/i);
  assert.match(mbMode.what, /holding register 3/i);

  const indoorThermostat = c.descFor("Thermostat ON/OFF",
    { reg: 0x60, x10a_group: "hydronic" });
  const outdoorThermostat = c.descFor("Thermostat ON/OFF",
    { reg: 0x10, x10a_group: "outdoor_state" });
  assert.match(indoorThermostat.what, /indoor unit is currently asking the outdoor unit/i);
  assert.match(outdoorThermostat.what, /outdoor controller's own thermostat-state flag/i);
  assert.notEqual(indoorThermostat, outdoorThermostat,
    "the two identically labelled thermostat bits must keep distinct explanations");

  // Ordinary /values rows carry their X10A register but only collision-ledger rows carry
  // x10a_group. The observation-only P2 copy must therefore be located by register, otherwise the
  // broad legacy catch-alls below it incorrectly claim a proven quiet level or solar function.
  const lowNoiseObservation = c.descFor("Low noise control", { reg: 0x10 });
  const solarObservation = c.descFor("Solar input", { reg: 0x60 });
  const validatedSilentMode = c.descFor("Silent Mode", { reg: 0x60 });
  assert.match(lowNoiseObservation.what, /level and trigger are unproven/i);
  assert.match(solarObservation.what, /function and polarity are unproven/i);
  assert.match(validatedSilentMode.what, /reduces outdoor-unit sound/i);
  assert.notEqual(lowNoiseObservation, validatedSilentMode,
    "the P2 bit must not inherit the validated Silent Mode explanation");

  const statusCtx = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values: [
    { label: "Thermostat ON/OFF", value: "1", reg: 0x10, binary: true,
      x10a_group: "outdoor_state" },
    { label: "Thermostat ON/OFF", value: "0", reg: 0x60, binary: true,
      x10a_group: "hydronic" },
    { label: "I/U operation mode", value: "Heating", reg: 0x60 },
  ] });
  const statusThermostats = statusCtx.inspMembers(statusCtx.INSPECT.status, null, null)
    .map((m) => m.x10a).filter((r) => r?.label === "Thermostat ON/OFF");
  assert.equal(statusThermostats.length, 1);
  assert.equal(statusThermostats[0].x10a_group, "hydronic",
    "status inspector must select the indoor thermostat even when outdoor arrives first");

  const flowSwitch = c.descFor("Water flow switch", { reg: 0x60 });
  assert.match(flowSwitch.what, /binary X10A status/i);
  assert.match(flowSwitch.what, /does not prove that the model-specific minimum is met/i);
  assert.doesNotMatch(flowSwitch.what, /safety input|sufficient flow has been proven|binary flow proof/i);

  const valve2 = c.descFor("2way valve(On:Heat_Off:Cool)", { reg: 0x60 });
  assert.match(valve2.what, /controller output for an optional field-supplied 2-way valve/i);
  assert.match(valve2.normal, /OFF alone neither proves Cooling/i);
  assert.match(valve2.normal, /confirms the physical valve position/i);
  assert.doesNotMatch(valve2.what, /selects the water path|Heating or Cooling/i);

  const idle2wv = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                         values: [X_2WV(false)] }).liveData();
  assert.equal(idle2wv.valve2On, false, "the X10A bit remains the logical 2WV output state");
  assert.equal(c.INSPECT.valve2.head(idle2wv), "state.off");
  assert.match(c.INSPECT.valve2.now(idle2wv).en, /does not mean Cooling/i,
    "an OFF output must not be promoted to the configured/current operating mode");
  assert.match(c.INSPECT.valve2.now({ valve2On: true }).en, /neither active Heating/i,
    "an ON output likewise cannot prove the operating mode");

  const heatingWithOutputOff = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
    values: [{ label: "I/U operation mode", value: "Heating", unit: "", reg: 0x60 }, X_2WV(false)],
  }).liveData();
  assert.equal(heatingWithOutputOff.spaceMode, "heat",
    "the authoritative I/U mode remains Heating when the independent 2WV output is OFF");
  assert.equal(heatingWithOutputOff.valve2On, false,
    "the output remains separately visible instead of being overwritten by the mode");

  assert.doesNotMatch(c.mbDeltaHtml(LWT_X, LWT_M), /plate heat exchanger|backup heater/i,
    "the two leaving-water sources must not be assigned invented different measurement points");

  // The two concepts with a real structural explanation must render that explanation in the
  // active device language. A tx() stub fixed to English used to leave this visible path untested.
  const deltaPairs = [
    [X("R1T-Outdoor air temp.", "5.0", "outdoor_air"),
     M(44, "Outdoor air temperature", "6.0", "outdoor_air")],
    [X("Indoor ambient temp. (R1T)", "20.0", "room_temp"),
     M(50, "Remote controller room temperature Main", "21.0", "room_temp")],
  ];
  // These eight remain inline in MB_DELTA_WHY. The five later lazy packs are structurally and
  // renderer-gated by test_ui_locale_catalogs.mjs after their locale script registers MB_DELTA_I18N.
  for (const lang of ["en", "de", "es", "fr", "it", "pl", "cs", "uk"]) {
    c.setTxLang(lang);
    for (const [x10a, homehub] of deltaPairs) {
      const expected = c.MB_DELTA_WHY[x10a.concept][lang];
      const html = c.mbDeltaHtml(x10a, homehub);
      assert.ok(html.includes(expected),
        `${lang} ${x10a.concept} comparison did not render ${expected}: ${html}`);
    }
  }
  c.setTxLang("en");

  assert.equal(c.waterMoving({ pumpOn: false, flow: 5 }), true,
    "measured flow takes precedence over a contradictory internal-pump status");
  assert.equal(c.waterMoving({ pumpOn: true, flow: null }), null,
    "pump ON without a flow reading must remain unknown, not measured circulation");
  for (const flow of [null, NaN, -1]) {
    assert.equal(c.waterMoving({ pumpOn: false, flow, provisionalFlow: 12 }), null,
      "pump OFF and a provisional reading cannot establish zero measured flow");
  }
  assert.equal(c.waterMoving({ pumpOn: false, flow: 0 }), false,
    "a qualified measured zero remains distinct from missing or provisional flow");
  for (const [raw, decoded, invalid] of [
    ["-1.0", null, true], ["Infinity", null, true], ["1.5error", null, true],
    ["NaN", null, true], [null, null, false], ["", null, false], ["   ", null, false],
    ["0.0", 0, false], ["12.0", 12, false], ["100.0", 100, false],
    ["100.1", null, true], ["3276.7", null, true],
  ]) {
    const rawRow = X("Flow sensor", raw, "flow", { unit: "l/min" });
    c.S._values = [rawRow, { label: "Water pump operation", value: "1", binary: true }];
    const live = c.liveData();
    assert.equal(live.flow, decoded, "reject invalid X10A flow before publishing it to the schematic");
    assert.equal(live.flowInvalid, invalid);
    assert.equal(rawRow.value, raw, "leave the source reading untouched");
    const pumpText = c.INSPECT.pump.now(live).en;
    assert.equal(pumpText.includes("schem.flow_invalid"), invalid);
    assert.equal(pumpText.includes("Measured flow"), decoded != null);
    if (decoded == null && !invalid) assert.match(pumpText, /No flow measurement is available/);
    if (invalid) {
      assert.equal(c.INSPECT.flow.head(live), "—");
      assert.equal(c.inspNowText(c.INSPECT.flow, live), "schem.flow_invalid");
    }
  }
  assert.match(c.INSPECT.pump.now({ pump: 0, pumpOn: false, flow: 5 }).en,
    /pump reports stopped[\s\S]*Measured flow 5[\s\S]*OFF conflicts with flow/i);
  const pumpOnNoFlow = c.INSPECT.pump.now({ pump: null, pumpOn: true, flow: null }).en;
  assert.match(pumpOnNoFlow, /pump status is ON.*no flow measurement/i);
  assert.doesNotMatch(pumpOnNoFlow, /pump reports stopped|measured flow is/i);
  const pumpUnknown = c.INSPECT.pump.now({ pump: null, pumpOn: null, flow: 0 }).en;
  assert.match(pumpUnknown, /reported pump state is unknown/i);
  assert.doesNotMatch(pumpUnknown, /pump reports stopped/i);
  assert.match(c.INSPECT.pump.now({ pump: 45, pumpOn: true, flow: null }).en,
    /no flow measurement is available[\s\S]*circulation is not established/i);
  assert.doesNotMatch(c.INSPECT.wtank.now({ valveDhw: true, pumpOn: false, flow: 0,
                                            lwt: 40, tank: 35 }).en, /Charging the tank/i,
    "a selected valve route alone must not be called an active tank charge");
  assert.doesNotMatch(c.INSPECT.wsup.now({ pumpOn: true, flow: null, lwt: 40,
                                            buh1: false, buh2: false }).en, /— l\/min|R1T reports/i,
    "pump ON without a flow value must not become a measured pipe flow");
  const postBuh = c.INSPECT.wsup.now({ pumpOn: true, flow: 5, lwt: 40,
                                        buh1: true, buh2: false }).en;
  assert.match(postBuh, /R1T reports 40\.0 °C before the backup heater/);
  assert.match(postBuh, /backup-heater stage is active downstream/);
  assert.doesNotMatch(postBuh, /reheated by the backup heater/i);
  assert.match(c.INSPECT.valve.now({ valveDhw: true }).en, /not mechanical position feedback/i);

  const mbPowerCopy = c.PEL_INSPECT.what({ pelSrc: "MB" }).en;
  assert.match(mbPowerCopy, /reported.*HomeHub input register 51/i);
  assert.doesNotMatch(mbPowerCopy, /MEASURED by the HomeHub|covers the whole unit/i);
}

// The README recording drives the same production parser. Keep its fake HomeHub on the real API
// boundary (raw numeric enum plus semantic metadata), or a regression to text could stay hidden.
{
  const end = demo.indexOf("\n})();");
  assert.notEqual(end, -1, "demo harness must expose a closed DEMO fixture");
  const demoContext = {};
  vm.runInNewContext(demo.slice(0, end + "\n})();".length) +
    "\nthis.__smartGrid = DEMO.smartGrid; this.__outdoorAir = DEMO.outdoorAir;" +
    " this.__standbyMbOut = DEMO.scenes[0].mbOut; this.__standbyValues = DEMO.scenes[0].v;", demoContext,
  { filename: "tools/uigif/scenes.js" });
  assert.equal(demoContext.__smartGrid(0).value, 0);
  assert.equal(demoContext.__smartGrid(0).enum, "smart_grid_mode");
  assert.equal(demoContext.__smartGrid(2).value, 2);
  const demoOut = demoContext.__outdoorAir(demoContext.__standbyMbOut);
  assert.equal(demoOut.off, 44);
  assert.equal(demoOut.concept, "outdoor_air");
  assert.equal(demoOut.value, "6.8", "the standby recording exercises the live Modbus fallback");
  const standby2wv = demoContext.__standbyValues.find((r) => /2.?way valve/i.test(r.label));
  assert.equal(standby2wv.value, "0",
    "the standby recording reproduces the reported Heating-selected / 2WV-output-OFF split");
  assert.equal(standby2wv.binary, true, "the demo crosses the real binary presentation boundary");
  assert.equal(standby2wv.concept, "valve_heat",
    "the demo crosses the same structural history boundary as the real /values response");
  for (const concept of ["defrost_state", "quiet_state", "bsh_state", "buh_step1", "buh_step2",
                         "valve_dhw", "valve_heat", "water_flow_switch"])
    assert.ok(demoContext.__standbyValues.some((r) => r.concept === concept),
      `the demo keeps ${concept}'s current state attached to its categorical history`);
}

// X10A independently reports Quiet activity. Legacy holding 9 cannot act as a second source.
{
  const both = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [X_QUIET(false)], modbus: [M_QUIET(true)] });
  assert.equal(both.liveData().quiet, false, "live X10A Quiet stays independent");
  assert.equal(both.mbForInspect("quiet"), null);
  assert.equal(both.mbTwin(X_QUIET(false)), null, "the legacy bit cannot appear as a twin");

  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [X_QUIET(false)], modbus: [M_QUIET(true)] });
  assert.equal(down.liveData().quiet, null, "holding 9 cannot assert Quiet activity");
  assert.equal(down.mbBool(9), null);
  assert.equal(down.mbFallbackFor("quiet_state"), null);
  assert.equal(down.INSPECT.quiet.now(down.liveData()), null);
  assert.equal(down.INSPECT.quiet.trend, "quiet_state");
  assert.equal(down.INSPECT.defrost.trend, "defrost_state");

  // Native holding9 selects a quiet policy; even1/2 cannot establish current quiet activity.
  for (const value of [0, 1, 2, 7]) {
    const nativeSelection = {off: 9, label: "Quiet mode selection", value, unit: "",
      profile: "altherma4", enum: "altherma4_quiet_selection"};
    const native = ctx({x10a: false, mbEnabled: true, mbConnected: true,
      values: [X_QUIET(true)], modbus: [nativeSelection]});
    assert.equal(native.liveData().quiet, null, `native quiet selection${value} is not activity`);
    assert.equal(native.mbForInspect("quiet"), null, "selection is not the quiet-active second source");
    const x10aLeads = ctx({x10a: true, mbEnabled: true, mbConnected: true,
      values: [X_QUIET(false)], modbus: [nativeSelection]});
    assert.equal(x10aLeads.liveData().quiet, false, "live X10A quiet activity remains independent");
  }

  const p2Only = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                       values: [{ ...X_QUIET(false), value: null }, X_LOW_NOISE(true)] });
  assert.equal(p2Only.liveData().quiet, null,
    "P2 Low noise control must not become validated Quiet when Silent Mode is unread");
  assert.equal(p2Only.INSPECT.quiet.re.test("Low noise control"), false,
    "the Quiet inspector must not attach quiet-state copy/history to the P2 bit");
  const quietSpeed = both.INSPECT.ou.now({ quiet: true, rps: 18 });
  assert.match(quietSpeed.en, /18 rps.*Quiet mode reports ON/);
  assert.doesNotMatch(quietSpeed.en, /capped|limited/i);
  assert.match(quietSpeed.de, /18 rps.*Leise-Modus meldet EIN/);
}

// The two X10A contact bits are not two user-facing modes. Pin the documented truth table and the
// one derived named row, including fail-closed behaviour when the snapshot is incomplete or stale.
{
  const expected = ["Free running", "Forced off", "Recommended on", "Forced on"];
  const combinations = [
    [false, false, 0], [false, true, 1], [true, false, 2], [true, true, 3],
  ];
  for (const [c1, c2, mode] of combinations) {
    const values = [X_SG(1, c1), X_SG(2, c2)];
    const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values });
    assert.equal(c.x10aSmartGridModeFrom(values), mode, `contact truth table -> mode ${mode}`);
    assert.equal(c.x10aSmartGridMode(), mode, `live X10A snapshot -> mode ${mode}`);
    const row = c.x10aSmartGridRow();
    assert.equal(row?.value, expected[mode], `derived mode ${mode} keeps canonical enum text`);
    assert.equal(row?.label, "Smart Grid operation mode");
    assert.equal(row?.displayLabel, "values.sg_x10a_mode");
    assert.equal(row?.key, "x10a:smart-grid-mode");
  }

  const missing = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                        values: [X_SG(1, true)] });
  assert.equal(missing.x10aSmartGridMode(), null, "one contact cannot invent a four-state mode");
  assert.equal(missing.x10aSmartGridRow(), null, "incomplete contact snapshot adds no row");

  const malformed = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                          values: [X_SG(1, true), { ...X_SG(2, false), value: "2" }] });
  assert.equal(malformed.x10aSmartGridMode(), null, "a malformed bit fails closed");

  const stale = ctx({ x10a: false, mbEnabled: false, mbConnected: false,
                      values: [X_SG(1, true), X_SG(2, false)] });
  assert.equal(stale.x10aSmartGridMode(), null, "a retained X10A cache is not a live contact state");
  assert.equal(stale.x10aSmartGridRow(), null, "stale contacts add no derived row");
}

// Diagnostic state follows the same numeric-enum contract. Unknown values remain visible in the
// value list but cannot become a plausible Fault/Warning state in the status header.
{
  for (const value of [0, 1, 2]) {
    const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                    modbus: [ABNORMALITY(value)] });
    assert.equal(c.mbUnitAbnormality(), value, `unit abnormality constant ${value}`);
  }
  const unknown = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                        modbus: [ABNORMALITY(3)] });
  assert.equal(unknown.mbUnitAbnormality(), null, "unknown diagnostic enum fails closed");
  const stale = ctx({ x10a: false, mbEnabled: true, mbConnected: false,
                      modbus: [ABNORMALITY(1)] });
  assert.equal(stale.mbUnitAbnormality(), null, "disconnected diagnostic enum is not current");
}

// ── 1. Both live, numeric — the gateway is reachable as the second opinion ─────────────────────
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  const twin = c.mbByConcept("leaving_water");
  assert.equal(twin?.value, "38.1", "both live: the twin must resolve");
  assert.equal(c.mbTwin(LWT_X)?.value, "38.1", "both live: mbTwin must resolve off the row");
  // X10A leads: the fallback picker must NOT hand the gateway value over while X10A answers.
  assert.equal(c.mbFallbackFor("leaving_water"), null, "both live: no fallback while X10A answers");
}

// ── HomeHub-only board: no X10A rows at all, but the gateway is answering ────────────────────────
// The space-operation evidence is the only reading a HomeHub-only plant can offer at the RAUMKREIS
// explainer. It used to vanish with the X10A rows: inspMember sourced the Modbus twin from the X10A
// row's `concept`, and there was no X10A row to source it from. The rows entry now carries the
// concept explicitly ({sel, cid}) so the twin stands in on its own — X10A absent, HomeHub live.
{
  const M_SPACE_OP = { label: "Space heating/cooling normal operation", value: 0, unit: "",
                       off: 53, concept: "space_op", binary: true };
  const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [], modbus: [M_SPACE_OP] });
  const members = c.inspMembers(c.INSPECT.heat, null, null);
  const spaceRow = members.find((m) => m.mb && m.mb.concept === "space_op");
  assert.ok(spaceRow, "X10A absent + HomeHub live: the space-operation row must still appear from Modbus");
  assert.equal(spaceRow.x10a, null, "it stands in for the missing X10A row, not beside a present one");
  assert.equal(members.filter((m) => m.x10a).length, 0, "no X10A rows exist, so none are invented");
}

// ── Both links live, but the outdoor unit is resting ────────────────────────────────────────────
// X10A remains connected and its cache remains filled; only page 0x20/0x21 is held over. Outdoor
// air has an independently polled HomeHub twin and should therefore become a per-reading petrol
// fallback. Discharge has no pair and must remain blank. This is distinct from the all-X10A-down
// branch exercised below and is the standby case that used to leave the schematic at "Outdoor —".
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [OUT_X, RPS_STOP, DISCH_X], modbus: [OUT_M] });
  const d = c.liveData();
  c.S.live = d;

  assert.equal(d.ouHeldOver, true, "stopped compressor makes the outdoor-unit page held over");
  assert.equal(d.out, 28.5, "the HomeHub outdoor register replaces retained X10A");
  assert.equal(d.mbFields.has("out"), true, "the replacement carries Modbus provenance");
  assert.equal(c.ouReadingText(d, "out", d.out, (n) => n.toFixed(1)), "28.5",
    "the schematic shows the current replacement instead of a dash");
  assert.equal(c.ouReadingText(d, "disch", d.disch, String), "—",
    "an unpaired held-over outdoor-unit reading remains blank");

  c.S.insp = "out";
  assert.equal(c.inspCurRow(c.INSPECT.out), null,
    "the retained X10A outdoor row must not headline the petrol pill");
  assert.equal(c.mbForInspect("out"), OUT_M,
    "the outdoor inspector resolves the exact HomeHub row used by the pill");
  assert.equal(c.inspHeld(c.INSPECT.out, d), false,
    "a live Modbus headline must not be followed by a no-current-reading note");
  const outdoor = c.inspNowText(c.INSPECT.ou, d);
  assert.match(outdoor, /compressor is stopped.*schem\.outdoor_held.*schem\.outdoor_homehub/,
    "the outdoor-unit explanation names the held X10A page and the independent substitution");
  assert.doesNotMatch(outdoor, /sys\.x10a_down/);

  c.S.insp = "disch";
  assert.equal(c.mbForInspect("disch"), null, "unpaired discharge has no invented fallback");
  assert.equal(c.inspHeld(c.INSPECT.disch, d), true,
    "the unpaired held-over reading still explains why it is blank");
  assert.equal(c.INSPECT.disch.trend, "discharge",
    "the held-over discharge inspector still offers the measured history from the last run");

  // The §6 VALUE TABLES must reach the same verdict as the pill above them. They read every row
  // straight off /values, so before this rule they printed the retained outdoor-unit numbers as
  // ordinary current readings — well-formed, plausible and hours old — while the drawing, the
  // inspector, the chart and MQTT all refused them. Same fact, four refusals and one statement.
  assert.equal(c.rowNotMeasuring(OUT_X), true,
    "a row on a held-over outdoor-unit page is not a current measurement");
  assert.equal(c.rowNotMeasuring(LWT_X), false,
    "a hydronic row keeps measuring while the outdoor unit rests");
  assert.equal(c.mbStandInFor(OUT_X), OUT_M,
    "the independently polled HomeHub twin stands in for the held row");
  assert.equal(c.mbStandInFor(DISCH_X), null,
    "an unpaired held row gets no stand-in, so the table blanks it");
  // The device's own marker is authoritative and needs no page rule to be re-derived: a row the
  // firmware marked held is not current even where the browser could not have worked that out.
  assert.equal(c.rowNotMeasuring({ ...LWT_X, held: true }), true,
    "the firmware's own `held` marker is honoured on any row");
}

// Zero degrees is a valid outdoor measurement, not a missing-value sentinel.
{
  const zero = M(44, "Outdoor air temperature", 0, "outdoor_air");
  for (const [x10a, report] of [[true, null], [false, false], [false, null], [true, true]]) {
    const c = ctx({ x10a, mbEnabled: true, mbConnected: true, mbCompressor: report,
      values: [OUT_X, RPS_STOP], modbus: report == null ? [zero] : [zero, M_FLAG(31, "Compressor running", report)] });
    const d = c.liveData();
    assert.equal(d.out, 0);
    assert.equal(d.mbFields.has("out"), true);
    assert.equal(d.ouHeldOver, x10a, "only a live X10A link can have a held page");
    assert.equal(c.ouReadingText(d, "out", d.out, n => n.toFixed(1)), "0.0");
    const outdoor = c.inspNowText(c.INSPECT.ou, d);
    const state = report === true ? /X10A 0 rps.*HomeHub state\.on/
      : x10a ? /compressor is stopped/
      : report == null ? /dyn\.state_gate/ : /schem\.homehub_compressor_off/;
    assert.match(outdoor, state);
    assert.ok(outdoor.includes(x10a ? "schem.outdoor_held" : "sys.x10a_down"));
    assert.ok(outdoor.includes("schem.outdoor_homehub"));
    assert.doesNotMatch(outdoor, /—/, "the actual outdoor number cannot be described as a dash");
  }
}

// A missing or withheld outdoor row can switch just that pill and both outdoor inspectors
// to HomeHub, even while the compressor reports a current X10A speed.
{
  const speed = X("INV frequency (rps)", "18", null, { reg: 0x30, unit: "rps" });
  for (const row of [null, { ...OUT_X, value: null }, { ...OUT_X, value: "invalid" },
    { ...OUT_X, held: true }, { ...OUT_X, held_unknown: true }, OUT_X]) {
    const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
      values: row ? [speed, row] : [speed], modbus: [OUT_M] });
    const live = c.S.live = c.liveData();
    c.S.insp = "out";
    const primary = row === OUT_X;
    assert.equal(live.out, primary ? 19 : 28.5);
    assert.equal(live.mbFields.has("out"), !primary);
    assert.equal(c.inspCurRow(c.INSPECT.out), primary ? OUT_X : null);
    assert.equal(c.mbForInspect("out"), primary ? null : OUT_M);
    assert.equal(c.inspValues(c.INSPECT.ou, null, null)[0].mb, OUT_M);
    assert.equal(c.inspValues(c.INSPECT.ou, null, null)[0].x10a, primary ? OUT_X : null);
    assert.equal(c.inspNowText(c.INSPECT.ou, live).includes("schem.outdoor_homehub"), !primary);
  }
}

// ── The HomeHub Smart-Grid request LEADS wherever it answers ───────────────────────────────────
// The normal installation has X10A and HomeHub side by side, and that is exactly where the dashboard
// must prove that evcc's mode-2 boost reached the controller. X10A answers only where the gateway
// says nothing at all (next block) — this priority is the REVERSE of stateOf()'s, deliberately, and
// the second half of this block is why.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M, SG(2)] });
  assert.equal(c.MB_OFF_SMART_GRID, 56, "UI uses the EKRHH data-model offset, not PDU address 55");
  assert.equal(c.mbSmartGridMode(), 2, "mode 2 must reach the live schematic");
  assert.equal(c.mbForInspect("sgrequest")?.value, 2,
    "the inspector must remain traceable to the Modbus row while X10A is live");
  assert.equal(c.INSPECT.sgrequest.trendSource, undefined,
    "a HomeHub-sourced request must compare its X10A and Modbus history witnesses");
  assert.equal(c.sgModeText(2), "sg.mode2");
  assert.match(SOURCE, /classList\.toggle\("sg-boost-on", active && d\.sgMode === 2\)/,
    "only mode 2 may apply the active Boost colour");
  assert.doesNotMatch(SOURCE, /sg-request-on/,
    "the former all-nonzero request visibility rule must stay removed");

  // THE CASE THAT FIXES THE PRIORITY. The two sources are different subjects: holding 56 is the
  // request an energy manager WROTE, the X10A pair is the physical SG-Ready terminal. On an
  // installation driven over the network the contacts are unwired and read 00 — a current,
  // plausible "Free running" that must never displace the boost the gateway is reporting.
  const contradicted = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                             values: [LWT_X, X_SG(1, false), X_SG(2, false)],
                             modbus: [LWT_M, SG(2)] });
  assert.equal(contradicted.x10aSmartGridMode(), 0, "the unwired contacts really do read mode 0");
  const cd = contradicted.liveData();
  assert.equal(cd.sgMode, 2, "a live HomeHub request outranks a contradicting contact pair");
  assert.equal(cd.sgSrc, "MB", "and the inspector must attribute it to the HomeHub");
}

// The inspector's copy fields are {en, de} objects (or functions returning one). Read both halves
// explicitly: a source-aware sentence that is only corrected in English is half a fix.
const EN = (o) => (o && o.en) || "";
const DE = (o) => (o && o.de) || "";
const SG_INSP = (c, d) => c.INSPECT.sgrequest;

// ── With NO HomeHub, the SG-Ready contacts answer the pill instead of leaving it blank ─────────
// The firmware already decodes and lists them (x10aSmartGridRow), so a blank pill was the dashboard
// declining to draw a reading it had. The provenance travels with the value: the two sources are
// different instruments, so a fixed "via Modbus" title over a contact reading would be false.
{
  for (const [c1, c2, mode] of [[false, false, 0], [false, true, 1],
                                [true, false, 2], [true, true, 3]]) {
    const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                    values: [LWT_X, X_SG(1, c1), X_SG(2, c2)] });
    const d = c.liveData();
    assert.equal(d.sgMode, mode, `no gateway: contacts ${+c1}${+c2} must reach the pill as ${mode}`);
    assert.equal(d.sgSrc, "X10A", "no gateway: the value is attributed to the contacts");
    assert.equal(c.INSPECT.sgrequest.trendSource, undefined,
      "the shared chart must fall back to the one X10A ring when no gateway exists");
    assert.match(EN(c.INSPECT.sgrequest.t(d)), /X10A/,
      "the inspector title must name the contacts, never Modbus");
    assert.match(EN(c.INSPECT.sgrequest.what(d)), /SG-Ready/,
      "the explainer must describe the physical contacts, not a HomeHub read-back");
  }
  // Mode 2 keeps its full boost explanation on this path, attributed to the contacts.
  const boost = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                      values: [LWT_X, X_SG(1, true), X_SG(2, false)] });
  const bd = boost.liveData();
  assert.match(EN(SG_INSP(boost, bd).now(bd)), /SG-Ready contacts report Recommended on/);
  assert.match(DE(SG_INSP(boost, bd).now(bd)), /SG-Ready-Kontakte melden Empfehlung ein/,
    "the German sentence must be corrected too, with its own plural verb");
  for (const half of [EN, DE])
    assert.doesNotMatch(half(SG_INSP(boost, bd).now(bd)), /HomeHub/,
      "a contact-sourced boost must not credit a gateway this plant does not have");
  assert.match(DE(SG_INSP(boost, bd).t(bd)), /X10A/,
    "the German title names the contacts too");
  assert.match(SOURCE, /classList\.toggle\("sg-boost-on", active && d\.sgMode === 2\)/,
    "the Boost colour keys on the mode alone, so it fires on either source");
}

// Neither source: the pill blanks and the copy blames no instrument — "the HomeHub is not
// answering" is wrong on a plant that has no HomeHub.
{
  const none = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values: [LWT_X] });
  const d = none.liveData();
  assert.equal(d.sgMode, null, "no contacts and no gateway: nothing to state");
  assert.equal(d.sgSrc, null);
  assert.equal(none.sgModeText(d.sgMode), "—");
  for (const half of [EN, DE])
    assert.doesNotMatch(half(SG_INSP(none, d).now(d)), /HomeHub|X10A|SG-Ready/,
      "the unavailable sentence must not name a source that was never consulted");
  // One contact alone cannot invent a mode, so a half-readable pair blanks rather than guessing.
  const half = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                     values: [LWT_X, X_SG(1, true)] });
  assert.equal(half.liveData().sgMode, null, "a single contact must not become a four-state mode");

  // With nothing to attribute, the explainer must still describe the instrument this installation
  // HAS. Defaulting to the HomeHub wording tells a reader with no gateway that a device they do not
  // own is not reporting — the same wrong-source complaint this card started with.
  assert.match(EN(SG_INSP(none, d).t(d)), /X10A/,
    "with no gateway and no value, the title must not name Modbus");
  assert.equal(SG_INSP(none, d).trendSource, undefined,
    "and the shared chart must discover whichever history witnesses this plant offers");
  const hub = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [] });
  const hd = hub.liveData();
  assert.equal(hd.sgMode, null, "a live gateway that does not carry offset 56 states nothing");
  assert.match(EN(SG_INSP(hub, hd).t(hd)), /via Modbus/,
    "but on a plant that HAS a gateway the Modbus wording stays");
}

// A stale HomeHub cache is not an active request, and invalid enum values are not guessed into one.
{
  const down = ctx({ x10a: true, mbEnabled: true, mbConnected: false,
                     modbus: [SG(2)] });
  assert.equal(down.mbSmartGridMode(), null, "disconnected HomeHub: cached boost must disappear");
  assert.equal(down.mbForInspect("sgrequest"), null, "disconnected HomeHub: no stale inspector row");

  const invalid = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                        modbus: [SG(4)] });
  assert.equal(invalid.mbSmartGridMode(), null, "unknown Smart-Grid enum must fail closed");
}

// The schematic and inspector use the same current native BSH report.
{
  const both = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [X_BSH(false)], modbus: [M_BSH(true)] });
  const live = both.liveData();
  both.S.live = live;
  assert.equal(live.bsh, false, "live X10A BSH leads a contradictory HomeHub state");
  assert.equal(both.INSPECT.bsh.x10aOnly, true);
  assert.equal(both.INSPECT.bsh.trend, "bsh_state",
    "the BSH inspector keeps its sampled state timeline");
  assert.equal(both.INSPECT.bsh.trendSource, "x10a",
    "the BSH inspector timeline excludes the HomeHub/Modbus lane");
  assert.equal(both.INSPECT.bsh.rows, undefined,
    "the BSH inspector has no additional value/context rows");
  assert.equal(both.inspValues(both.INSPECT.bsh, both.inspCurRow(both.INSPECT.bsh), null).length, 0,
    "the generic leaf twin must not put the HomeHub BSH value back into the X10A-only panel");
  assert.equal(both.inspCurRow(both.INSPECT.bsh).value, "0");
  assert.match(both.inspNowText(both.INSPECT.bsh, live), /^Off/);

  const power = { label: "Heat pump power consumption", value: "2.40", unit: "kW", off: 51 };
  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [X_BSH(false)], modbus: [M_BSH(true), power] });
  const d = down.liveData();
  down.S.live = d;
  assert.equal(d.bsh, null, "HomeHub input 32 cannot keep the heater state live when X10A is silent");
  assert.equal(down.mbBool(32), true, "the independent HomeHub input remains readable");
  assert.equal(down.mbForInspect("bsh"), null,
    "the X10A-only heater inspector never promotes the HomeHub state into its headline");
  assert.equal(down.inspCurRow(down.INSPECT.bsh), null,
    "a HomeHub-only state must not be rendered under the X10A BSH source label");
  assert.equal(down.INSPECT.bsh.now(d), null,
    "the inspector prose must not leak the HomeHub-only state either");
  assert.equal(down.INSPECT.buh.trend, "buh_state");
  for (const buh1 of [null, false, true])
    assert.match(down.INSPECT.buh.head({ buh1, buh2: true }), /Step 2|hist\.buh_step2/);
  assert.equal(down.INSPECT.buh.head({ buh1: false, buh2: null }), "—");
  const buhNow = (buh1, buh2) => down.INSPECT.buh.now({ buh1, buh2 })?.en;
  for (const buh1 of [null, false, true])
    assert.equal(buhNow(buh1, true), "Step 2 reports ON.");
  assert.equal(buhNow(true, null), "Step 1 reports ON.");
  assert.equal(buhNow(false, false), "Both stages report OFF.");
  assert.equal(buhNow(null, false), undefined);
  assert.equal(buhNow(false, null), undefined);
  assert.doesNotMatch(down.descFor("BSH").what, /HomeHub|Modbus/,
    "the X10A BSH explanation contains no second-source copy");

  for (const [row, expected] of [
    [null, null], [{ ...X_BSH(true), held: true }, null],
    [{ ...X_BSH(true), held_unknown: true }, null],
    [{ ...X_BSH(true), binary: false }, null], [{ ...X_BSH(true), value: "2" }, null],
    [X_BSH(true), true], [X_BSH(false), false],
  ]) {
    const cachedHeater = M_BSH(true);
    const fixture = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
      values: [X_DEFROST("1"), ...(row ? [row] : [])],
      modbus: [cachedHeater, M_FLAG(31, "Compressor running", true), M_VALVE(false)] });
    fixture.S.status.modbus.rx = 100;
    for (const compressor of [0, 1]) {
      // Fast replies keep the link up and update compressor/route; input 32 keeps its old value.
      fixture.S.status.modbus.rx++;
      fixture.S._modbus[1].value = compressor;
      fixture.S._modbus[2].value = compressor;
      fixture.S.live = fixture.liveData();
      assert.equal(fixture.S.live.defrost, true);
      assert.equal(fixture.S.live.bsh, expected, "only a current native BSH report supplies live state");
      const panel = fixture.INSPECT.bsh;
      assert.equal(fixture.inspCurRow(panel), expected == null ? null : row);
      const sentence = fixture.inspNowText(panel, fixture.S.live);
      if (expected == null) assert.ok(!sentence);
      else assert.match(sentence, expected ? /heater active/ : /^Off/);
      assert.equal(fixture.mbByConcept("bsh_state"), cachedHeater);
    }
  }
}

// ── 2. Both live, a discrete CONTRADICTION — X10A still leads, both remain readable ────────────
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [X_VALVE(false)], modbus: [M_VALVE(true)] });
  assert.equal(c.stateOf(/3.?way valve/i, 37), false, "contradiction: X10A leads while it is live");
  assert.equal(c.mbBool(37), true, "contradiction: the gateway's own answer stays readable");
}

// ── 3. X10A only — nothing Modbus exists anywhere ──────────────────────────────────────────────
{
  const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values: [LWT_X, X_VALVE(false)] });
  assert.equal(c.mbLive(), false);
  assert.equal(c.mbByConcept("leaving_water"), null, "X10A only: no gateway rows");
  assert.equal(c.mbBool(37), null, "X10A only: no gateway states");
  assert.equal(c.stateOf(/3.?way valve/i, 37), false, "X10A only: the X10A state answers");
}

// ── 4. Modbus only from an EMPTY X10A cache — the gateway answers ──────────────────────────────
{
  const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                  values: [], modbus: [LWT_M, M_VALVE(true)] });
  assert.equal(c.stateOf(/3.?way valve/i, 37), true, "modbus only: the gateway state answers");
  assert.equal(c.mbFallbackFor("leaving_water")?.value, "38.1", "modbus only: the reading stands in");
}

// The reported regression: during a Modbus-only DHW charge, the gateway already supplied routing,
// pump, temperatures and flow, but the missing X10A rps row was treated as proof that the compressor
// was stopped. That made an active charge look like neutral/cooling-side circulation. Input 31 is
// the missing independent witness; no temperature inference or configured heat/cool mode is needed.
{
  const dhwModbus = [
    M_FLAG(30, "Circulation pump running", true, "pump_running"),
    M_FLAG(31, "Compressor running", true),
    M_VALVE(true),
    M_FLAG(52, "DHW normal operation", true),
    M_FLAG(53, "Space heating/cooling normal operation", false, "space_op"),
    M(40, "Leaving water temperature PHE", 54.1, "leaving_water"),
    M(42, "Return water temperature", 49.4, "return_water"),
    M(43, "Domestic Hot Water temperature", 39.5, "dhw_tank"),
    M(49, "Flow rate", 24.0, "flow", { unit: "L/min" }),
  ];
  for (const metadata of [{}, { flow_scale_unverified: false }, { flow_scale_unverified: true },
    { profile: "altherma4" }]) {
    const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true, mbCompressor: true, values: [],
      modbus: dhwModbus.map(row => row.off === 49 ? { ...row, ...metadata } : row) });
    const d = c.liveData();
    assert.equal(d.rps, null, "Modbus does not invent compressor speed");
    assert.equal(d.compressorOn, true, "HomeHub input 31 independently reports the compressor");
    assert.equal(c.compressorRunning(d), true);
    assert.equal(d.valveDhw, null, "HomeHub-only telemetry cannot establish the current schematic route");
    assert.equal(c.inspNowText(c.INSPECT.wtank, d), "schem.water_route_unknown");
    assert.equal(d.thermalMode, null, "the gateway route alone cannot establish thermal mode");
    assert.equal(d.provisionalFlow, 24, "the numeric flow remains visible with provisional scale");
    assert.equal(d.flow, null, "no Modbus map qualifies input 49");
    assert.equal(c.waterMoving(d), null, "pump ON cannot certify water motion");
    assert.equal(d.dtStale, true, "the 4.7 K sensor difference is not a working ΔT");
    assert.equal(d.pthRaw, null, "the unverified divisor cannot reach thermal arithmetic");
    assert.equal(d.pth, null, "the previous 7.87 kW estimate must not appear");
    assert.equal(d.pthKind, null);
    assert.match(c.mbDeltaHtml({ concept: "flow", value: "12" }, c.mbByConcept("flow")),
      /mb\.flow_scale_help/, "even an omitted or false flag must withhold numeric agreement");
    const provisionalPump = c.INSPECT.pump.now(d).en;
    assert.match(provisionalPump, /circulation is not established/i);
    assert.doesNotMatch(provisionalPump, /no flow measurement/i);
  }

  const stopped = ctx({ x10a: false, mbEnabled: true, mbConnected: true, mbCompressor: false, values: [],
                        modbus: dhwModbus.map((r) => r.off === 31 ? { ...r, value: 0 } : r) });
  const idle = stopped.liveData();
  assert.equal(idle.pth, null, "compressor OFF keeps the same arithmetic from becoming heat output");
  assert.equal(stopped.waterThermalKind(idle, true), "neutral",
    "pump-only DHW remains explicitly neutral");

  const space = ctx({ x10a: false, mbEnabled: true, mbConnected: true, mbCompressor: true, values: [],
                      modbus: dhwModbus.map((r) => r.off === 37 ? M_VALVE(false) : r) });
  const autoSpace = space.liveData();
  assert.equal(autoSpace.thermalMode, null,
    "gateway-only Auto space operation does not guess Heating or Cooling");
  assert.equal(space.waterThermalKind(autoSpace, true), "neutral",
    "unknown gateway-only space direction remains neutral even with the compressor ON");
}

// ── 5. THE REGRESSION: X10A drops with a FILLED cache, the gateway says the OPPOSITE ───────────
// The X10A cache is deliberately kept when its link dies (the trend rings need it), so every
// consumer has to ask "is it CURRENT", not "does it exist". This is the case that shipped wrong.
{
  const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                  values: [X_VALVE(false), LWT_X],          // stale: says "to heating"
                  modbus: [M_VALVE(true), LWT_M] });        // live:  says "to DHW"
  assert.equal(c.stateOf(/3.?way valve/i, 37), true,
    "X10A down with a stale cache: the LIVE gateway state must win, never the stale X10A one");
  assert.equal(c.mbFallbackFor("leaving_water")?.value, "38.1",
    "X10A down: the reading comes from the gateway");
}

// ── 6. THE OTHER REGRESSION: Modbus drops with a FILLED cache ──────────────────────────────────
// `enabled` is still true and the browser may still be holding the last array; nothing may present
// it as current, and above all no difference may be computed from it.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: false,
                  values: [LWT_X, X_VALVE(false)],
                  modbus: [LWT_M, M_VALVE(true)] });        // stale, from before the link died
  assert.equal(c.mbLive(), false, "modbus down: the link is not live");
  assert.equal(c.mbByConcept("leaving_water"), null,
    "modbus down: a stale cached reading must not resolve as the second opinion");
  assert.equal(c.mbTwin(LWT_X), null, "modbus down: no twin, so no difference can be computed");
  assert.equal(c.mbBool(37), null, "modbus down: no stale state");
  assert.equal(c.stateOf(/3.?way valve/i, 37), false, "modbus down: X10A answers, unaffected");
}

// ── 7. No source at all ────────────────────────────────────────────────────────────────────────
{
  const c = ctx({ x10a: false, mbEnabled: false, mbConnected: false });
  assert.equal(c.stateOf(/3.?way valve/i, 37), null, "no source: nobody answers");
  assert.equal(c.mbByConcept("leaving_water"), null);
  assert.equal(c.mbFallbackFor("leaving_water"), null);
}

// ── 8. X10A live but this PROFILE lacks the row; the gateway carries it ────────────────────────
// The map deliberately allows a profile to lack a concept (a monobloc has no room sensor). A
// gateway reading of something X10A never carried is not a fallback — it is simply the answer.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X],                          // no valve row on this profile
                  modbus: [M_VALVE(true)] });
  assert.equal(c.stateOf(/3.?way valve/i, 37), true,
    "profile without the X10A row: the gateway answers even though the bus is healthy");
}

// A cached full-sweep HomeHub valve stays raw. Only a current X10A valve supplies the schematic.
{
  for (const route of [true, false]) {
    const mb = M_VALVE(route);
    const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
      values: [{ ...X_VALVE(!route), value: null }], modbus: [mb] });
    c.S.insp = "valve";
    c.S.live = c.liveData();
    assert.equal(c.S.live.valveDhw, null, "cached HomeHub route cannot supply the schematic reading");
    assert.equal(c.inspCurRow(c.INSPECT.valve), null);
    assert.equal(c.mbForInspect("valve"), null);
    assert.equal(c.mbByConcept("valve_dhw"), mb, "retain the independent gateway register");
    assert.ok(!c.inspValues(c.INSPECT.wtank, null, null).some(member => member.mb === mb));
    assert.equal(c.inspNowText(c.INSPECT.valve, c.S.live), "");
    const x10a = X_VALVE(!route);
    c.S._values = [x10a];
    c.S.live = c.liveData();
    assert.equal(c.S.live.valveDhw, !route);
    assert.equal(c.inspCurRow(c.INSPECT.valve), x10a);
    assert.equal(c.mbForInspect("valve"), null);
    assert.match(c.INSPECT.valve.now(c.S.live).en, /reports the .* route selected.*does not by itself prove/i);
    c.S._values = [];
    c.S._modbus = [{ ...mb, value: 7 }];
    c.S.live = c.liveData();
    assert.equal(c.S.live.valveDhw, null);
    assert.equal(c.mbForInspect("valve"), null);
    assert.equal(c.inspNowText(c.INSPECT.wtank, c.S.live), "schem.water_route_unknown");
  }
}

// ── 9. Enabled but never connected — the same as not live ──────────────────────────────────────
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: false, values: [LWT_X], modbus: [] });
  assert.equal(c.mbLive(), false);
  assert.equal(c.mbTwin(LWT_X), null, "configured-but-unreachable is not a source");
}

// ── 10. A row the gateway did not answer this cycle ────────────────────────────────────────────
// A null value is not a reading. It must not resolve as a twin, or the panel would print an empty
// second opinion and a difference against nothing.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [M(40, "Leaving water temperature PHE", null, "leaving_water")] });
  assert.equal(c.mbByConcept("leaving_water"), null, "an unanswered gateway row is not a reading");
  assert.equal(c.mbTwin(LWT_X), null);
}

// ── 11. The pairing table is the one the firmware defines ──────────────────────────────────────
// MB_PAIRS names each paired quantity four ways (liveData field, pill id, INSPECT target, concept).
// It replaced three hand-kept lists that had already drifted — `ret` against `rwt` — so the shape is
// pinned here rather than left to be re-derived.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true });
  assert.equal(c.MB_PAIRS.length, 9, "eight base pairings plus native-only water pressure");
  for (const p of c.MB_PAIRS) {
    for (const k of ["fld", "pill", "insp", "cid"]) {
      assert.equal(typeof p[k], "string", `MB_PAIRS entry needs ${k}`);
      assert.ok(p[k].length, `MB_PAIRS.${k} must not be empty`);
    }
  }
  const cids = c.MB_PAIRS.map((p) => p.cid);
  assert.equal(new Set(cids).size, cids.length, "a concept may appear once");
}

// ── 12. THE EXPLAINER, with X10A down and a FILLED cache — the second-opinion leak ─────────────
// The row header already switches to the gateway (mbFallbackFor). The BODY went on being built from
// the retained X10A row, so the same gateway reading was printed a second time as this row's
// "second source" and a difference was computed against a number the bus stopped refreshing minutes
// ago — a comparison of two INSTANTS wearing the shape of a comparison of two INSTRUMENTS.
//
// The gate is in mbTwin: a SECOND opinion presupposes a FIRST one. Asserted here on the rendered
// markup rather than on the helper alone, because the helper was never the thing that was wrong.
{
  const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M] });
  assert.equal(c.mbTwin(LWT_X), null, "X10A down: a retained row has no second opinion");
  assert.equal(c.mbNoteHtml(LWT_X, c.mbTwin(LWT_X)), "",
    "X10A down: the explainer must print no second-source line and no difference");
  // The reading itself still stands in — this must suppress the COMPARISON, not the fallback.
  assert.equal(c.mbFallbackFor("leaving_water")?.value, "38.1",
    "X10A down: the gateway still supplies the row's value");
}

// ── 13. …and with both live the comparison is exactly as before ────────────────────────────────
// The guard above must not cost the feature it is guarding. Same rows, healthy bus: the line names
// the GATEWAY's own register and states the difference. Both sources represent the same paired
// leaving-water quantity, so the UI must not invent two different measurement points as a reason.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M] });
  const html = c.mbNoteHtml(LWT_X, c.mbTwin(LWT_X));
  assert.ok(html.includes("Leaving water temperature PHE"),
    "both live: the line names the MODBUS register, not the X10A row");
  assert.ok(html.includes("Difference 0.5"), "both live: the difference is stated");
  assert.ok(!html.includes("X10A before the backup heater"),
    "the paired leaving-water rows must not be assigned invented different sensor locations");
}

// ── 14. A discrete CONTRADICTION prints, agreement does not ────────────────────────────────────
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [X_VALVE(false)], modbus: [M_VALVE(true)] });
  assert.ok(c.mbNoteHtml(X_VALVE(false), c.mbTwin(X_VALVE(false))).includes("sources disagree"),
    "a contradiction between two sources about a discrete fact is worth a line");
  const agree = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                      values: [X_VALVE(true)], modbus: [M_VALVE(true)] });
  assert.ok(!agree.mbNoteHtml(X_VALVE(true), agree.mbTwin(X_VALVE(true))).includes("disagree"),
    "agreement on a flag is unremarkable and says nothing");
}

// ── 15. THE INSPECTOR: a retained row is not a current reading ─────────────────────────────────
// `inspRow` keeps resolving after the link drops (the cache is retained on purpose), and the panel
// treated "a row exists" as "the drawing is on X10A" — so tapping a pill that had already switched
// to the gateway opened a headline carrying the old X10A number under the X10A label.
{
  const E = { re: /leaving water/i };
  const live = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  assert.equal(live.inspCurRow(E)?.value, "38.6", "bus live: the panel reads the X10A row");

  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  assert.equal(down.inspCurRow(E), null,
    "X10A down: the retained row must not be presented as the panel's current reading");
}

// ── 16. …and its MEMBER readings switch with it ────────────────────────────────────────────────
// The member list is the other half of the same panel and had the same defect. With the bus down a
// member is the GATEWAY's row or nothing — never the retained X10A number under its own label.
{
  const live = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  const m1 = live.inspMember(/leaving water/i);
  assert.equal(m1.x10a?.value, "38.6", "bus live: the member is the X10A row");
  assert.equal(m1.mb?.value, "38.1", "bus live: with its gateway twin beside it");

  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  const m2 = down.inspMember(/leaving water/i);
  assert.equal(m2.x10a, null, "X10A down: no retained member reading");
  assert.equal(m2.mb?.value, "38.1", "X10A down: the gateway stands in for it");

  // A member the gateway does NOT carry disappears rather than showing its stale X10A value.
  const orphan = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                       values: [X("Discharge pipe temp.", "78.4", null)], modbus: [LWT_M] });
  const m3 = orphan.inspMember(/discharge pipe/i);
  assert.equal(m3.x10a, null, "X10A down: an unpaired member shows nothing…");
  assert.equal(m3.mb, null, "…and has no gateway row to stand in for it");
}

// ── 17. Leaf values stay compact; grouped targets list every value in one place ─────────────────
// A leaf value does not repeat its X10A headline in the value table, but its Modbus twin belongs
// there after the chart with every additional reading. The tank is a GROUP: temperature, target and
// valve all remain in that same table. No reading gets a special line inside the explanatory prose.
{
  const TANK_X = X("DHW tank temp. (R5T)", "45.2", "dhw_tank");
  const TANK_M = M(43, "Domestic Hot Water temperature", "45.4", "dhw_tank");
  const SETPOINT = X("DHW setpoint", "48.0", null);
  const LEAF = { re: /dhw tank temp/i, rows: [/dhw tank temp/i, /dhw setpoint/i] };
  const live = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [TANK_X, SETPOINT], modbus: [TANK_M] });
  const row = live.inspCurRow(LEAF);
  assert.deepEqual(live.inspMembers(LEAF, row, null).map((m) => m.x10a), [SETPOINT],
    "a leaf value keeps only its additional context row");
  const leafValues = live.inspValues(LEAF, row, null);
  assert.equal(leafValues.length, 2, "the leaf has one source twin and one context value");
  assert.equal(leafValues[0].x10a, null, "the X10A headline is not repeated in the values section");
  assert.equal(leafValues[0].mb, TANK_M,
    "the headline's Modbus twin moves into the values section after the chart");
  assert.equal(leafValues[0].compare, TANK_X,
    "the twin keeps the X10A headline as its comparison reference");
  assert.equal(leafValues[1].x10a, SETPOINT, "additional context follows the source twin");
  assert.match(live.inspComparisonHtml(leafValues[0], live.liveData()), /Difference 0\.2 °C/,
    "two current source readings keep their comparison note with the Modbus row");

  const missingPrimary = { ...TANK_X, value: null };
  assert.deepEqual(live.inspValues({ ...LEAF, rows: [] }, missingPrimary, null), [],
    "a missing X10A headline does not manufacture a two-source value row");
  assert.equal(live.inspComparisonHtml({ compare: missingPrimary, mb: TANK_M }, live.liveData()), "",
    "a missing primary value is not reported as a source disagreement");

  const heldData = { ...live.liveData(), ouHeldOver: true };
  assert.equal(live.inspComparisonHtml({ compare: OUT_X, mb: OUT_M }, heldData), "",
    "a held-over primary value is not reported as a source disagreement");

  const GROUP = { ...LEAF, listAllValues: true };
  const members = live.inspValues(GROUP, row, null);
  assert.equal(members.length, 2, "the grouped target keeps its full value list");
  assert.equal(members[0].x10a, TANK_X, "the X10A tank temperature is the first group row");
  assert.equal(members[0].mb, TANK_M, "its Modbus twin stays on the same group member");
  assert.equal(live.inspComparisonHtml(members[0], live.liveData()), "",
    "existing grouped source rows stay compact without multiplying comparison notes");
  assert.equal(members[1].x10a, SETPOINT, "the DHW setpoint follows in the same group");
  assert.equal(live.INSPECT.tank.listAllValues, true,
    "the production tank inspector opts into the complete group table");
  assert.equal(live.INSPECT.tank.now, undefined,
    "the production tank inspector does not repeat temperature and target as prose");

  // With X10A down, the gateway becomes the headline but remains part of the complete group table.
  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [TANK_X], modbus: [TANK_M] });
  const fallback = down.mbForInspect("tank");
  assert.equal(fallback, TANK_M, "the tank target resolves the exact Modbus fallback row");
  assert.equal(down.inspValues(GROUP, null, fallback)[0].mb, TANK_M,
    "the Modbus fallback remains visible in the complete group table");

  // An assembly has no headline and therefore retains the full list, including the paired reading.
  const assembly = { rows: [/dhw tank temp/i, /dhw setpoint/i] };
  assert.equal(live.inspMembers(assembly, null, null).length, 2,
    "component inspectors retain all of their member readings");
}

assert.doesNotMatch(SOURCE, /inspSourceNoteHtml/,
  "the inspector must not have a special path that inserts a source value into prose");
assert.match(style, /\.inspect-rows\s*>\s*\.mb-delta/,
  "source comparison notes stay attached to their value inside the divided values section");

// ── 18. The REPORTED power is addressed by its offset, never by its unit ───────────────────────
// Three rows in the HomeHub map carry "kW": the consumption value at input 51 and the two power
// LIMIT setpoints at holding 57/58. A first-match on the unit promoted an installer's configured
// ceiling to the plant's measured draw the moment 51 was unavailable — and the Modbus card went on
// labelling it correctly one card below, so the substitution was visible only on the drawing.
{
  const P = (off, label, value) => ({ label, value, unit: "kW", off, concept: null });
  const both = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                     modbus: [P(51, "Heat pump power consumption", "1.4"),
                              P(57, "Power limit during Recommended on / buffering", "5.00"),
                              P(58, "General power limit", "7.00")] });
  assert.equal(both.MB_OFF_POWER, 51, "the reported power is EKRHH input register 51");
  assert.equal(both.mbPower()?.value, "1.4", "the reported consumption value is what is read");
  assert.equal(both.mbForInspect("pel")?.label, "Heat pump power consumption",
    "the measured schematic headline remains traceable to its Modbus register");

  const reported = { pel: 1.4, pelSrc: "MB", pelHeld: false };
  assert.equal(both.pelApproxText(reported), "", "a gateway-reported value has no UI estimate mark");
  assert.equal(both.PEL_INSPECT.t(reported).en, "Electrical input (HomeHub)");
  assert.equal(both.PEL_INSPECT.head(reported), "1.4 kW");
  assert.match(both.PEL_INSPECT.what(reported).en, /reported.*HomeHub input register 51/i);
  assert.match(both.PEL_INSPECT.now(reported).en, /Reported through HomeHub input register 51/);

  const estimated = { pel: 1.42, pelSrc: "INV", pelHeld: false };
  assert.equal(both.pelApproxText(estimated), "≈ ", "an X10A current-derived value stays approximate");
  assert.equal(both.PEL_INSPECT.t(estimated).en, "Electrical input (estimated)");
  assert.equal(both.PEL_INSPECT.head(estimated), "≈ 1.4 kW");
  assert.match(both.PEL_INSPECT.what(estimated).en, /assumed 230 V.*Inverter load coverage is unverified/);
  // The actual SVG and renderer must consume the same source-aware prefix helper the assertions
  // above exercise; otherwise a correct inspector could still leave the closed pill lying.
  assert.match(index, /id="pelApprox"/);
  assert.match(SOURCE, /setTxt\("pelApprox", pelApproxText\(d\)\)/);
  assert.match(SOURCE, /pel:\s*PEL_INSPECT/);

  // 51 absent (sentinel / unread) with both limits valid — the case that produced the wrong number.
  const gone = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                     modbus: [P(51, "Heat pump power consumption", null),
                              P(57, "Power limit during Recommended on / buffering", "5.00"),
                              P(58, "General power limit", "7.00")] });
  assert.equal(gone.mbPower(), null,
    "no reported power: the answer is nothing, never a power LIMIT that happens to share the unit");
  for (const [fixture, power] of [[both, 1.4], [gone, null]]) {
    fixture.S._modbus.push(M_FLAG(31, "Compressor running", true),
      M_FLAG(32, "Booster heater run", true), M_VALVE(true),
      M(40, "Leaving water temperature PHE", 36, "leaving_water"),
      M(41, "Leaving water temperature BUH", 38.5, "leaving_water_post_buh"),
      M(42, "Return water temperature", 30, "return_water"),
      M(49, "Flow rate", 12, "flow", { unit: "L/min" }));
    const live = fixture.liveData();
    assert.equal(live.bsh, null, "the schematic lacks a current native heater report");
    assert.equal(fixture.mbBool(32), true, "the independent HomeHub input remains readable");
    assert.equal(live.r2t, 38.5, "HomeHub can report the post-heater temperature");
    assert.equal(live.pth, null, "provisional Modbus flow cannot carry the exchanger estimate");
    assert.equal(live.pel, power);
    assert.equal(live.cop, null, "heater state and temperature cannot establish a matched power boundary");
    assert.equal(live.copBlock, "mb_scope");
    for (const [lang, boundary, unknownLoads, unsupportedClaims] of [
      ["en", /cannot match HomeHub power to the estimated heat across the plate heat exchanger/i,
        /loads .*including heaters.* unknown/i, /whole unit|reports neither|heaters included/i],
      ["de", /keinen Vergleich .*HomeHub .*geschätzten Wärmeleistung am Plattenwärmetauscher/i,
        /Verbraucher .*etwa Elektroheizer.* unklar/i, /gesamte Gerät|meldet .*weder|einschließlich beider/i],
    ]) {
      fixture.setTxLang(lang);
      const explanation = fixture.inspNowText(fixture.INSPECT.cop, live);
      assert.match(explanation, boundary);
      assert.match(explanation, unknownLoads);
      assert.doesNotMatch(explanation, unsupportedClaims);
    }
  }
  // Prove the trap is really set — a unit-keyed lookup over this very fixture picks a limit.
  const byUnit = [P(51, "Heat pump power consumption", null),
                  P(57, "Power limit during Recommended on / buffering", "5.00")]
    .find((m) => m.unit === "kW" && m.value != null);
  assert.equal(byUnit.off, 57, "the unit-keyed lookup this replaced would have taken the limit");
}

// A fail-closed CT phase is absence, not zero. Summing the remaining phases would replace the
// rejected +64-A spike with an understated denominator and an inflated COP/EER. A complete CT set
// wins; an incomplete one falls back to live inverter current or to no estimate.
{
  const CT = (phase, value) => ({ label: `Current measured by CT sensor of L${phase}`, value,
                                  unit: "A", reg: 0x63 });
  const INV = { label: "INV primary current", value: "4.0", unit: "A", reg: 0x21 };
  const speed = { label: "INV frequency (rps)", value: "18", unit: "rps", reg: 0x30 };
  const complete = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                         values: [CT(1, "2.0"), CT(2, "2.1"), CT(3, "2.2"), INV] });
  assert.equal(complete.liveData().pelSrc, "CT", "a complete declared CT set remains preferred");

  const partial = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                        values: [CT(1, "2.0"), CT(2, "2.1"), CT(3, null), INV, speed] });
  assert.equal(partial.liveData().pelSrc, "INV",
    "L1/L2 plus fail-closed L3 must never become a partial CT estimate");
  assert.equal(partial.liveData().pel, 0.92, "live inverter current is the safe fallback");

  const noFallback = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                           values: [CT(1, "2.0"), CT(2, "2.1"), CT(3, null)] });
  assert.equal(noFallback.liveData().pelSrc, null);
  assert.equal(noFallback.liveData().pel, null, "partial CT without live INV remains blank");
}

// ── 19. Cooling semantics: residual-hot circulation is not cooling capacity ────────────────────
{
  const candidates = [
    ["Cooling + DHW", null, null, false, "cool", null],
    ["Cooling + DHW", false, null, false, "cool", "cool"],
    ["Cooling + DHW", true, null, false, "cool", "heat"],
    ["Cooling + DHW", null, false, false, "cool", null],
    ["Cooling + DHW", null, true, false, "cool", null],
    ["Cooling + DHW", null, null, true, "cool", "defrost"],
    ["Cooling", null, null, false, "cool", "cool"],
    ["Cooling", false, null, false, "cool", "cool"],
    ["Cooling", true, null, false, "cool", null],
    ["Cooling", null, true, false, "cool", "cool"],
    ["Cooling", true, false, false, "cool", null],
    ["Heating", false, null, false, "heat", "heat"],
    ["Heating + DHW", null, null, false, "heat", "heat"],
    ["DHW", true, null, false, null, "heat"],
    ["DHW", null, true, false, null, null],
    ["DHW", false, null, false, null, null],
    ["DHW", null, null, false, null, null],
    ["Stop", true, null, false, null, null],
    ["Stop", null, true, false, null, null],
    [null, null, true, false, null, null],
    ["", true, null, false, null, null],
    ["Unrecognized", null, true, false, null, null],
  ];
  for (const [mode, x10aValve, gatewayValve, defrost, season, task] of candidates) {
    const values = [
      { label: "I/U operation mode", value: mode, reg: 0x60 },
      { label: "INV frequency (rps)", value: "18", reg: 0x30 },
      X_DEFROST(defrost ? "1" : "0"),
      X("Flow sensor", "12", "flow_rate", { unit: "l/min" }),
      X("Leaving Water Temp. before BUH (R1T)", task === "heat" ? "36" : "24", "leaving_water"),
      X("Inlet Water Temp. (R4T)", "30", "return_water"),
      { label: "INV primary current", value: "2.2", unit: "A", reg: 0x21 },
    ];
    if (x10aValve != null) values.push(X_VALVE(x10aValve));
    const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values,
      modbus: gatewayValve == null ? [] : [M_VALVE(gatewayValve)] });
    const live = c.liveData();
    assert.equal(live.spaceMode, season, "the selected space season remains available");
    const context = `${JSON.stringify(mode)}, X10A valve ${x10aValve}, HomeHub valve ${gatewayValve}, defrost ${defrost}`;
    const routeOnlyFromHomeHub = x10aValve == null && gatewayValve != null;
    if (routeOnlyFromHomeHub) {
      assert.equal(live.valveDhw, null, "cached HomeHub route cannot supply the schematic reading");
      assert.equal(c.activeSpaceKind(live), null, "cached HomeHub route cannot name an active branch");
      for (const branch of ["heat", "wtank", "wheat"])
        assert.equal(c.inspNowText(c.INSPECT[branch], live), "schem.water_route_unknown");
    }
    const directionFailure = mode === "Cooling + DHW" && task == null;
    assert.equal(live.thermalMode, task, directionFailure
      ? (routeOnlyFromHomeHub ? "cached HomeHub route cannot select direction"
                             : "Cooling + DHW without a route cannot select direction")
      : context);
    assert.equal(live.dtStale, false, "common flow and the two temperatures still qualify ΔT");
    if (task == null) {
      assert.equal(live.pth, null, "an unknown direction withholds mode-specific capacity");
      assert.equal(live.cop, null);
      assert.equal(c.waterThermalKind(live, true), "neutral");
    }
  }
}

// The indoor mode can still report Heating while the outdoor defrost page is missing. These are
// the decoded values for 0x60/2=0x10, 0x30 speed=0x12, flow=78 00 and R1T/R4T=68 01/2C 01.
{
  const operating = [
    { label: "I/U operation mode", value: "Heating", reg: 0x60 },
    { label: "INV frequency (rps)", value: "18", unit: "rps", reg: 0x30 },
    X("Flow sensor", "12", "flow_rate", { unit: "l/min", reg: 0x62 }),
    X("Leaving Water Temp. before BUH (R1T)", "36", "leaving_water"),
    X("Inlet Water Temp. (R4T)", "30", "return_water"),
    { label: "INV primary current", value: "2.2", unit: "A", reg: 0x21 },
    { label: "Water pump operation", value: "1", reg: 0x60, binary: true },
    X_VALVE(false),
  ];
  for (const row of [null, X_DEFROST(null), X_DEFROST("2"),
    { ...X_DEFROST("0"), binary: false }, { ...X_DEFROST("0"), reg: 0x60 },
    { ...X_DEFROST("0"), held: true }, { ...X_DEFROST("1"), held_unknown: true }]) {
    const c = ctx({ x10a: true, values: row ? [...operating, row] : operating });
    const d = c.liveData();
    assert.equal(d.defrost, null, "an unusable page cannot establish either defrost state");
    assert.equal(d.spaceMode, "heat", "the independently reported indoor mode remains visible");
    assert.equal(d.thermalMode, null, "an unread defrost page cannot establish normal refrigerant direction");
    assert.equal(d.pth, null, "the coincident positive water balance cannot establish heating capacity");
    assert.equal(d.cop, null);
    assert.equal(d.pumpOn, true);
    assert.equal(c.waterMoving(d), true);
    assert.equal(c.waterThermalKind(d, true), "neutral");
    assert.equal(d.dtStale, false);
    assert.equal(d.dt, 6);
  }
  const heatingContext = ctx({ x10a: true, values: [...operating, X_DEFROST("0")] });
  const heating = heatingContext.liveData();
  assert.equal(heating.defrost, false);
  assert.equal(heating.thermalMode, "heat");
  assert.equal(heating.pthKind, "heating");
  assert.ok(Math.abs(heating.pth - 5.0232) < 0.001);
  assert.equal(heatingContext.waterThermalKind(heating, heatingContext.waterMoving(heating)), "heat");
  const defrostValues = operating.map(row => row.concept === "leaving_water"
    ? { ...row, value: "24" } : row);
  const defrostContext = ctx({ x10a: true, values: [...defrostValues, X_DEFROST("1")] });
  const defrost = defrostContext.liveData();
  assert.equal(defrost.defrost, true);
  assert.equal(defrost.thermalMode, "defrost");
  assert.equal(defrost.pthKind, "transfer");
  assert.ok(Math.abs(defrost.pth + 5.0232) < 0.001);
  assert.equal(defrost.cop, null);
  assert.equal(defrostContext.waterMoving(defrost), true);
  assert.equal(defrostContext.waterThermalKind(defrost, true), "neutral",
    "defrost shows hydraulic circulation without assigning a heating colour to signed transfer");
  const gatewayContext = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: true,
    values: [...defrostValues.filter(row => row.reg !== 0x30), X_DEFROST("1")],
    modbus: [M_FLAG(31, "Compressor running", true)] });
  const gateway = gatewayContext.liveData();
  assert.equal(gateway.rps, null);
  assert.equal(gateway.compressorOn, true);
  assert.equal(gateway.pth, null);
  assert.equal(gatewayContext.waterMoving(gateway), true);
  assert.equal(gatewayContext.waterThermalKind(gateway, true), "neutral",
    "a HomeHub activity report cannot colour water during defrost");
  const flagged = ctx({ x10a: true, values: [X_DEFROST("1")] });
  const flagOnly = flagged.liveData();
  assert.equal(flagOnly.defrost, true);
  assert.equal(flagOnly.rps, null);
  assert.equal(flagOnly.flow, null);
  assert.equal(flagOnly.pth, null);
  for (const key of ["ou", "defrost"]) {
    assert.equal(flagged.inspNowText(flagged.INSPECT[key], flagOnly), "X10A reports defrost active.");
    flagged.setTxLang("de");
    assert.equal(flagged.inspNowText(flagged.INSPECT[key], flagOnly), "X10A meldet aktives Abtauen.");
    flagged.setTxLang("en");
  }
}

// This reproduces the live 57.8/57.5 °C screenshot: Cooling selected, space circulation active,
// compressor stopped. The two temperatures are internal PHE readings after a DHW run. Arithmetic
// flow×ΔT is non-zero, but there is no refrigerant-side transfer and therefore no capacity or EER.
{
  const mode = (value) => ({ label: "I/U operation mode", value, unit: "", reg: 0x60 });
  const bin = (label, on, reg = 0x62) => ({ label, value: on ? "1" : "0", unit: "", reg, binary: true });
  const values = [
    mode("Cooling"),
    X_DEFROST("0"),
    X("Leaving Water Temp. before BUH (R1T)", "57.8", "leaving_water"),
    X("Inlet Water Temp. (R4T)", "57.5", "return_water"),
    X("Flow sensor", "19.1", "flow_rate", { unit: "l/min" }),
    { label: "Water pump signal (0:max-100:stop)", value: "34", unit: "%", reg: 0x62 },
    bin("Water pump operation", true),
    bin("Space heating Operation ON/OFF", true),
    bin("Thermostat ON/OFF", false, 0x60),
    X_VALVE(false), RPS_STOP,
    bin("BUH step 1", false), bin("BUH step 2", false), bin("BSH", false),
  ];
  const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values });
  const d = c.liveData();
  assert.equal(d.spaceMode, "cool", "I/U mode establishes the selected space season");
  assert.equal(d.thermalMode, "cool", "space path in Cooling has cooling as its thermal task");
  assert.equal(d.spaceOp, true, "legacy Space heating label is retained only as space operation");
  assert.equal(d.pthRaw > 0, true, "the residual-temperature arithmetic is intentionally non-zero");
  assert.equal(d.pth, null, "stopped compressor suppresses the false cooling-capacity claim");
  assert.equal(d.pthKind, null);
  assert.equal(c.activeSpaceKind(d), null, "pump-only residual circulation is not labelled as a cooling circuit");
  assert.equal(d.cop, null, "no active cooling capacity means no EER");
  assert.equal(d.efficiencyKind, "eer", "the efficiency label still follows Cooling mode");
  assert.equal(c.INSPECT.phe.now(d), "schem.compressor_off");
  assert.match(c.INSPECT.dt.now(d), /0\.3 K.*schem\.compressor_off/);
  for (const buh of [{ buh1: true }, { buh2: true }]) {
    const heating = { ...d, ...buh };
    assert.match(c.INSPECT.phe.now(heating), /schem\.backup_heater_active.*schem\.compressor_off/);
    assert.match(c.INSPECT.dt.now(heating), /0\.3 K.*schem\.backup_heater_active/);
    assert.equal(c.waterThermalKind(heating, c.waterMoving(heating)), "neutral",
      "with the compressor stopped, a backup heater cannot earn cooling colours");
    assert.doesNotMatch(c.INSPECT.heat.now(heating).en, /Residual/);
    assert.doesNotMatch(c.INSPECT.wheat.now(heating).en, /Residual/);
  }
  for (const speed of [1, 5]) {
    const running = ctx({ x10a: true, values: values.map(row => row === RPS_STOP
      ? { ...row, value: String(speed) } : row) });
    const low = running.liveData();
    assert.equal(running.compressorRunning(low), true);
    assert.equal(low.pth, null, "the existing capacity cutoff applies even when the compressor runs");
    assert.equal(running.inspNowText(running.INSPECT.phe, low), "schem.capacity_low_speed");
    assert.match(running.inspNowText(running.INSPECT.dt, low), /0\.3 K.*schem\.capacity_low_speed/);
    for (const key of ["heat", "wheat"])
      assert.doesNotMatch(running.inspNowText(running.INSPECT[key], low), /residual|pump-only/i);
  }
}

// With live X10A flow, temperatures and INV current, input 31 still witnesses activity only.
// Hold those inputs constant while varying the independent compressor speed.
{
  const speed = { label: "INV frequency (rps)", value: "6", unit: "rps", reg: 0x30 };
  for (const cooling of [false, true]) {
    const values = [
      { label: "I/U operation mode", value: cooling ? "Cooling" : "Heating", reg: 0x60 },
      X_DEFROST("0"),
      X_VALVE(false),
      X("Leaving Water Temp. before BUH (R1T)", cooling ? "25" : "35", "leaving_water"),
      X("Inlet Water Temp. (R4T)", "30", "return_water"),
      X("Flow sensor", "15", "flow_rate", { unit: "l/min" }),
      { label: "INV primary current", value: "3", unit: "A", reg: 0x21 },
    ];
    for (const [row, rps] of [[null, null], [{ ...speed, value: null }, null],
      [{ ...speed, held: true }, null], [{ ...speed, held_unknown: true }, null],
      [{ ...speed, value: "0" }, 0], [{ ...speed, value: "3" }, 3],
      [{ ...speed, value: "5" }, 5], [speed, 6]]) {
      const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: true,
        values: row ? [...values, row] : values,
        modbus: [M_FLAG(31, "Compressor running", true)] });
      const d = c.liveData();
      const qualified = rps > 5;
      assert.equal(d.rps, rps);
      assert.equal(d.mbCompressorOn, true, "the independent activity report remains available");
      assert.equal(d.compressorOn, rps !== 0);
      assert.equal(c.compressorRunning(d), rps !== 0, "the activity report cannot replace measured zero speed");
      assert.equal(d.dtStale, false);
      assert.equal(d.pelSrc, rps > 0 ? "INV" : null, "inverter power needs current positive X10A speed");
      assert.equal(d.efficiencyKind, cooling ? "eer" : "cop");
      assert.equal(d.pth > 0, qualified);
      assert.equal(d.cop > 0, qualified);
      if (!qualified) {
        assert.equal(d.pth, null);
        assert.equal(d.cop, null);
        assert.equal(c.inspNowText(c.INSPECT.pth, d), "schem.capacity_low_speed");
        if (rps === 0) {
          for (const key of ["ou", "comp", "rhot", "rcold"]) {
            const sentence = c.inspNowText(c.INSPECT[key], d);
            assert.match(sentence, /sources disagree.*X10A 0 rps.*HomeHub state\.on/);
          }
          assert.equal(c.inspNowText(c.INSPECT.cop, d), "schem.no_usable_power");
          c.S.modbusCompressorRunning = false;
          const agreed = c.liveData();
          assert.equal(agreed.rps, 0);
          assert.equal(agreed.mbCompressorOn, false);
          assert.equal(c.S._modbus[0].value, 1, "the full-sweep row is still available as raw data");
          assert.match(c.inspNowText(c.INSPECT.ou, agreed), /compressor is stopped/);
          assert.equal(c.inspNowText(c.INSPECT.comp, agreed), null);
        } else if (rps == null) {
          assert.equal(c.inspNowText(c.INSPECT.cop, d), c.heldUnknownText());
        } else {
          assert.match(c.inspNowText(c.INSPECT.cop, d), /schem\.efficiency_no_capacity.*schem\.capacity_low_speed/);
        }
      }
    }
  }
}

// With the compressor running and R1T below R4T, the live 13.2/15.4 °C operating point becomes
// positive cooling capacity and the quotient is EER. The opposite direction must still fail closed.
{
  const common = [
    { label: "I/U operation mode", value: "Cooling", unit: "", reg: 0x60 },
    X_DEFROST("0"),
    X("Flow sensor", "15.0", "flow_rate", { unit: "l/min" }),
    { label: "Water pump signal (0:max-100:stop)", value: "42", unit: "%", reg: 0x62 },
    { label: "Water pump operation", value: "1", unit: "", reg: 0x62, binary: true },
    X_VALVE(false),
    { label: "INV frequency (rps)", value: "18", unit: "rps", reg: 0x30 },
    { label: "INV primary current", value: "2.2", unit: "A", reg: 0x21 },
    { label: "BUH step 1", value: "0", unit: "", reg: 0x62, binary: true },
    { label: "BUH step 2", value: "0", unit: "", reg: 0x62, binary: true },
    { label: "BSH", value: "0", unit: "", reg: 0x62, binary: true },
  ];
  const cool = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                     values: [...common,
                       X("Leaving Water Temp. before BUH (R1T)", "13.2", "leaving_water"),
                       X("Inlet Water Temp. (R4T)", "15.4", "return_water")] });
  const d = cool.liveData();
  assert.equal(d.pthKind, "cooling");
  assert.equal(cool.activeSpaceKind(d), "cool", "verified active transfer labels the field circuit as cooling");
  assert.ok(Math.abs(d.pth - 2.302) < 0.01, "cooling capacity is flow×(R4T-R1T)");
  assert.ok(d.cop > 4.5 && d.cop < 4.6, "active cooling quotient is a positive EER");
  assert.equal(cool.INSPECT.pth.t(d).en, "Cooling capacity (estimated)");
  assert.equal(cool.INSPECT.cop.t(null).en, "Estimated COP");
  assert.equal(cool.INSPECT.cop.t(d).en, "Inverter-current-based EER estimate");
  assert.match(cool.INSPECT.cop.what(d).en, /cooling capacity divided/i);
  assert.match(cool.INSPECT.cop.what(d).en, /schem\.efficiency_inv_pair/);
  const ctRows = [1, 2, 3].map(phase => X(`Current measured by CT sensor of L${phase}`,
    "2", null, { reg: 0x63, unit: "A" }));
  const r2t = X("Leaving Water Temp. after BUH (R2T)", "14.3", "leaving_water_post_buh", { off: 4 });
  for (const [hasR2T, heater, usableInv, expected, postBuh] of [
    [false, "0", true, 2.3023, false], [true, "0", true, 1.15115, true],
    [true, "1", false, null, false], [true, null, false, null, false],
    [true, "1", true, 2.3023, false], [true, "1", "below_minimum", null, false],
  ]) {
    const values = cool.S._values.map(row => row.label === "BUH step 1"
      ? { ...row, value: heater } : row.label === "INV primary current" && usableInv !== true
        ? { ...row, value: usableInv === "below_minimum" ? "0.5" : null } : row)
      .concat(ctRows, hasR2T ? [r2t] : []);
    const fixture = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values });
    const live = fixture.liveData();
    assert.equal(live.efficiencyKind, "eer");
    assert.equal(live.pelSrc, "CT");
    assert.equal(live.copPostBuh, postBuh);
    const inspector = fixture.INSPECT.cop;
    if (expected == null) {
      assert.equal(live.copBlock, "backup_heater");
      assert.equal(live.cop, null);
      assert.equal(inspector.t(live).en, "Estimated EER");
      assert.doesNotMatch(inspector.what(live).en, /R[12]T|with current transformers/);
      assert.match(inspector.now(live).en, heater === "1"
        ? /No EER.*reports ON.*load is included/ : /No EER.*status is unknown.*load is included/);
    } else {
      assert.ok(Math.abs(live.copPth - expected) < 0.01);
      const ratioPower = heater === "1" ? 0.506 : 1.38;
      assert.ok(Math.abs(live.copPel - ratioPower) < 0.001,
        "use the power source paired with this thermal boundary");
      assert.ok(Math.abs(live.cop - expected / ratioPower) < 0.01);
      assert.match(inspector.t(live).en, heater === "1"
        ? /Inverter-current-based EER estimate/ : /EER based on current transformers/);
      assert.match(inspector.what(live).en, heater === "1" ? /schem\.efficiency_inv_pair/
        : postBuh ? /R2T after.*R4T with current transformers/ : /R1T before.*R4T with current transformers/);
      if (postBuh) assert.doesNotMatch(fixture.INSPECT.pth.now(live).en, /EER/,
        "the PHE's R1T value cannot carry the separate R2T-based EER");
    }
  }

  const wrongWay = ctx({ x10a: true, mbEnabled: false, mbConnected: false,
                         values: [...common,
                           X("Leaving Water Temp. before BUH (R1T)", "24.0", "leaving_water"),
                           X("Inlet Water Temp. (R4T)", "21.0", "return_water")] }).liveData();
  assert.equal(wrongWay.pth, null, "Cooling never relabels heating-direction ΔT as capacity");
  assert.equal(wrongWay.cop, null);
}

assert.match(index, /id="svSpaceCircuit" data-i18n="schem\.space_circuit"/);
assert.match(index, /id="svCopLabel">COP</);
assert.match(index, /class="sc-flow water-flow hot"/);
assert.match(style, /\.cooling-mode \.water-flow\.hot/);
assert.match(style, /\.water-neutral \.water-flow\.hot[\s\S]*\.water-neutral \.water-flow\.cold/);
assert.doesNotMatch(SOURCE, /chip\.demand_(?:on|off)|schem\.to_heat/);

// ── §6 value-table grouping, measured over the REAL catalog ─────────────────────────────────────
// The grouping is substring keys with first-match-wins over machine-generated labels, so it cannot
// be checked by reading it: the labels change without this repo being touched, and a misfiled row is
// invisible on any single profile — it is present, correct and simply in the wrong card. 66 of 169
// labels had drifted into the bottom catch-all, the unit's own Error Code among them.
//
// Executes the PRODUCTION groupOf over every label the shipped tables contain.
{
  const dash = readAppFragments(["dashboard.js"]);
  const gctx = {}; vm.createContext(gctx);
  vm.runInContext(dash.slice(0, dash.indexOf("async function refreshValues")) +
                  "\nthis.__api = { groupOf, GROUPS, GROUP_ORDER };", gctx,
                  { filename: "main/www/js/dashboard.js" });
  const { groupOf, GROUPS, GROUP_ORDER } = gctx.__api;

  const labels = new Set();
  for (const f of fs.readdirSync(new URL("../main/def", import.meta.url))) {
    if (!f.endsWith(".hpp")) continue;
    const t = fs.readFileSync(new URL(`../main/def/${f}`, import.meta.url), "utf8");
    for (const m of t.matchAll(/\{0x[0-9A-Fa-f]{2},\s*\d+,\s*\d+,\s*\d+,\s*-?\d+,\s*"([^"]+)"/g))
      labels.add(m[1]);
  }
  assert.ok(labels.size > 150, "the catalog scrape must actually find labels");

  // The two orders are separate; neither may lose a group the other has.
  // Spread both into host arrays: `.map` on a VM-realm array returns a VM-realm array, and
  // deepStrictEqual compares prototypes too.
  assert.deepEqual([...GROUP_ORDER].sort(), [...GROUPS].map((g) => g[0]).sort(),
    "GROUP_ORDER and GROUPS must name the same groups");
  assert.equal(GROUPS[0][0], "Protection",
    "Protection matches first: it is the one group with an exactly-known membership");

  // THE REGRESSION THIS PINS: giving another group a broader key silently took two rows out of
  // Protection, which then showed 9 of its 11 and looked complete.
  const protection = [...labels].filter((l) => /drop|retry/i.test(l));
  assert.equal(protection.length, 11,
    "the page-0x10 protection words are 5 retry counters + 6 drop flags");
  for (const l of protection)
    assert.equal(groupOf({ label: l }), "Protection", `"${l}" must stay in Protection`);
  // …and the reason the keys are "drop"/"retry" rather than "protection": these two are normally ON.
  for (const l of ["Freeze Protection", "Freeze Protection for water piping"])
    assert.notEqual(groupOf({ label: l }), "Protection",
      `"${l}" is a default-on flag, not a unit backing off`);

  // Rows DESIGN.md §6 names by group. Spellings are the catalog's own, checked to still exist so a
  // renamed label fails here rather than quietly moving a row to the bottom of the page.
  const filed = {
    "Error Code": "Operation", "Error type": "Operation", "Silent Mode": "Operation",
    "Thermostat ON/OFF": "Operation", "Restart standby": "Operation",
    "Startup Control": "Operation", "Oil Return Operation": "Operation",
    "Pressure equalizing operation": "Operation", "Demand Signal": "Operation",
    "Low noise control": "Operation", "System OFF (ON:System off)": "Operation",
    "Add. Ext. RT Input Cool.": "Operation", "Add. Ext. RT Input Heat.": "Operation",
    "Main RT Cooling": "Operation", "Main RT Heating": "Operation",
    "Pwr consumption limit 4": "Operation", "Pwr consumption limit 3": "Operation",
    "Pwr consumption limit 2": "Operation", "Pwr consumption limit 1": "Operation",
    "Solar input": "Operation", "Error detailed code": "Operation",
    "2nd Domestic hot water temperature": "Domestic hot water",
    "Inlet water temp.(R4T)": "Water circuit",
    "Outlet Water Heat Exch. Temp. (R1T)": "Water circuit",
    "Outlet Water BUH Temp. (R2T)": "Water circuit",
    "LW setpoint (main)": "Water circuit",
    "Floor loop shut off valve": "Water circuit",
    "INV frequency (rps)": "Refrigerant / outdoor",
    "Target Evap. Temp.": "Refrigerant / outdoor",
    "Target Cond. Temp.": "Refrigerant / outdoor",
    "Expansion valve 1 (pls)": "Refrigerant / outdoor",
    "Discharge pipe temp.": "Refrigerant / outdoor",
    "O/U Heat Exch. Temp.": "Refrigerant / outdoor",
    "Suction pipe temp.": "Refrigerant / outdoor",
    "4 Way Valve": "Refrigerant / outdoor",
    "Hot gas bypass valve (Y3S)": "Refrigerant / outdoor",
    "LP bypass valve (Y2S)": "Refrigerant / outdoor", "Y3S": "Refrigerant / outdoor",
    "CT Sensor (L1)": "Electrical",
    "Current measured by CT sensor of L1": "Electrical",
    "BUH Step1": "Electrical",
    "Crank case heater": "Electrical", "Thermal protector (Q1L) BUH": "Electrical",
    "PHE Heater": "Electrical", "BUH output capacity": "Electrical",
  };
  for (const [label, group] of Object.entries(filed)) {
    assert.ok(labels.has(label), `"${label}" must still exist in the catalog`);
    assert.equal(groupOf({ label }), group, `"${label}" belongs in ${group}`);
  }
  // Water pressure must keep beating the refrigerant group's bare "pressure" key.
  for (const l of ["Water Pressure", "Water pressure"])
    assert.equal(groupOf({ label: l }), "Water circuit", `"${l}" is a water reading`);

  // A firmware-stamped group always wins, unchanged.
  assert.equal(groupOf({ label: "Error Code", group: "Custom" }), "Custom");
}

// ── Every COP block reason reaches a sentence ───────────────────────────────────────────────────
// cop_scope's rule is that suppressing one wrong claim must not substitute another, so a blank COP
// pill owes the reader the reason it is blank. Two of the four codes named a reason no explainer
// rendered: `mb_scope` (X10A silent, HomeHub carrying) and `no_pel` (no usable electrical input)
// fell through to the generic copy while the pill's own title still claimed a heat-pump boundary.
// Asserted over the codes liveData can actually PRODUCE, so a fifth added without copy fails here.
{
  const c = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values: [] });
  const sentence = (d) => c.INSPECT.cop.now(d);

  // Each block reason, in both languages, and each distinct from the others.
  const seen = new Map();
  for (const block of ["tank_heater", "backup_heater", "mb_scope", "no_pel"]) {
    const d = { cop: null, copBlock: block, pelHeld: false };
    const s = sentence(d);
    assert.ok(s && (typeof s === "string" || (s.en && s.de)),
      `copBlock "${block}" must reach a localized sentence`);
    const en = s.en || s;
    assert.ok(!seen.has(en), `copBlock "${block}" must not reuse another reason's sentence`);
    seen.set(en, block);
  }
  const tankUnknown = sentence({ copBlock: "tank_heater", bsh: null });
  const tankOn = sentence({ copBlock: "tank_heater", bsh: true });
  assert.match(tankUnknown.en, /status is unknown/);
  assert.match(tankOn.en, /reports ON/);
  assert.match(tankUnknown.de, /Status .* ist unbekannt/);
  assert.match(tankOn.de, /meldet EIN/);
  for (const [buh1, buh2, expected] of [[false, null, /status is unknown/],
                                        [true, null, /reports ON/], [null, true, /reports ON/]]) {
    const backup = sentence({ copBlock: "backup_heater", buh1, buh2 });
    assert.match(backup.en, expected);
    assert.match(backup.en, /cannot establish whether the heater load is included/);
    assert.doesNotMatch(backup.en, /no .*sensor/);
  }
  // no_pel splits: "held over from the last run" and "this profile has no current row" are different
  // facts about the hardware, and saying the wrong one substitutes a second false claim.
  const held = sentence({ cop: null, copBlock: "no_pel", pelHeld: true });
  const absent = sentence({ cop: null, copBlock: "no_pel", pelHeld: false });
  assert.notEqual(held.en, absent.en, "a held-over current must not read as an absent row");
  assert.match(held.de, /letzten Lauf/, "the held case names the previous run");
  assert.equal(absent, "schem.no_usable_power", "the absent case uses the usable-estimate explanation");

  // Every reason the production code can set must be one of the codes covered above.
  //
  // The scrape must read the rule WHERE IT LIVES, and three of the four moved: the COP-scope
  // cascade is now `copPlan()`, which RETURNS `block: "tank_heater"`, and liveData merely copies
  // `plan.block` into `d.copBlock`. Only `mb_scope` is still a direct assignment. That matters more
  // than it sounds, because the assignment regex below also matches the FIRST `=` of a `===`, so
  // the INSPECT explainer's own `d.copBlock === "tank_heater"` comparisons would keep feeding the
  // set: the assertion would go on passing while comparing the explainer table against ITSELF, and
  // a block reason with no sentence would sail through. Measured — with the old
  // `/\bcopBlock\s*=\s*…/` scrape, a fifth code returned from `copPlan` and explained nowhere
  // passed this file with exit 0.
  //
  // So: `=(?!=)` excludes comparisons, and the copPlan BODY is scraped for its returned `block:`
  // literals. Both halves are required to be non-empty — a rule that has moved again must fail
  // LOUDLY here rather than quietly reduce what is checked, which is the whole failure mode this
  // block keeps being bitten by.
  //
  const covered = new Set(seen.values());
  const src = fs.readFileSync(new URL("../main/www/js/schematic.js", import.meta.url), "utf8");

  // (a) direct assignments — `d.copBlock = "mb_scope"`, never `d.copBlock === "…"`.
  const assigned = new Set();
  for (const m of src.matchAll(/\bcopBlock\s*=(?!=)\s*([^;}\n]*)/g))
    for (const q of m[1].matchAll(/"([a-z0-9_]+)"/g)) assigned.add(q[1]);

  // (b) the copPlan cascade's returned reasons. Scoped to that function's body so the surrounding
  // file cannot contribute; an empty body means the rule was renamed or inlined and the scrape has
  // stopped seeing it.
  const planBody = src.match(/const copPlan\s*=[\s\S]*?\n};/);
  assert.ok(planBody, "copPlan must remain an addressable named rule this scrape can read");
  // Scope the scan to the `block:` value expression and pin all four independent reasons.
  const planned = new Set();
  for (const m of planBody[0].matchAll(/\bblock:\s*([^,}\n]*)/g))
    for (const q of m[1].matchAll(/"([a-z0-9_]+)"/g)) planned.add(q[1]);

  assert.ok(assigned.size > 0, "the assignment scrape must still find at least one block reason");
  assert.ok(planned.size > 0, "the copPlan scrape must still find at least one block reason");

  const set = new Set([...assigned, ...planned]);
  assert.deepEqual([...set].sort(), ["backup_heater", "mb_scope", "no_pel", "tank_heater"],
    "the scrape must find exactly the four block reasons the production code can set");
  for (const block of set)
    assert.ok(covered.has(block),
      `copBlock "${block}" is set by the production code but has no explainer sentence`);
}

// ── A label pattern names one row ─────────────────────────────────────────────────────────────
// A row without a value this sweep reads as absent. The next match is another instrument under a
// label the reader takes for this one.
{
  const hxFirst = { label: "O/U Heat Exch. Temp.", value: null, unit: "°C", reg: 0x20 };
  const hxSecondUnit = { label: "Outdoor heat exchanger temp.", value: "-3.5", unit: "°C", reg: 0xa0 };
  const c = ctx({ x10a: true, values: [hxFirst, hxSecondUnit] });
  assert.equal(c.liveData().ouHx, null, "the second outdoor unit's coil never stands in for this unit's");
  c.S._values = [hxSecondUnit];
  assert.equal(c.liveData().ouHx, null, "nor when this unit's page is missing from the sweep");
  c.S._values = [{ ...hxFirst, value: "2.5" }, hxSecondUnit];
  assert.equal(c.liveData().ouHx, 2.5, "this unit's own coil row still reads");
  c.S._values = [{ ...hxSecondUnit, value: "4.5", reg: 0x20 }];
  assert.equal(c.liveData().ouHx, 4.5, "a chiller spells its own coil like that second unit");

  const row = { label: "Example row", value: null, reg: 0x60 };
  c.S._values = [row, { ...row, value: "7", reg: 0x61 }];
  assert.equal(c.vRow(/example row/i), undefined, "the first match without a value reads as absent");
  assert.equal(c.vNum(/example row/i), null, "and vNum therefore reads null");
}

// ── The refrigerant high side is the firmware's row ───────────────────────────────────────────
// /status.history names it for the chart and the service. The browser must not pick a different one
// by label, because 0x62/15 is spelled alike whether or not the profile has that sensor.
{
  const HP = { label: "High Pressure", value: "26.2", unit: "bar", reg: 0x20 };
  const RP = { label: "Refrigerant pressure sensor", value: "14.2", unit: "bar", reg: 0x62 };
  const RPS_RUN = { label: "INV frequency (rps)", value: "45", unit: "rps", reg: 0x30 };
  const trend = (label) => ({ rows: [{ id: "circuit_pressure", label }] });

  const twin = ctx({ x10a: true, values: [HP, RP, RPS_RUN] });
  twin.S.status.history = trend(RP.label);
  assert.equal(twin.liveData().circP, 14.2, "a twinned profile's indoor sensor is its high side, running");
  twin.S._values = [{ ...HP, held: true }, RP, RPS_STOP];
  assert.equal(twin.liveData().circP, 14.2, "and at rest, because the hydronic page stays live");
  assert.equal(twin.INSPECT.hp.pick(), RP, "the pill and the inspector name the same row");

  const twinless = ctx({ x10a: true, values: [HP, RP, RPS_RUN] });
  twinless.S.status.history = trend(HP.label);
  assert.equal(twinless.liveData().circP, 26.2, "a twinless profile's high side is the outdoor row");
  twinless.S._values = [{ ...HP, held: true }, RP, RPS_STOP];
  twinless.S.live = twinless.liveData();
  assert.equal(twinless.S.live.circP, null,
    "at rest it blanks; the 0x62/15 row is not a sensor to fall back on");
  assert.equal(twinless.INSPECT.hp.pick().label, HP.label, "while the inspector can still explain the blank");
  assert.equal(twinless.inspHeld(twinless.INSPECT.hp, twinless.S.live), true,
    "and says why it is blank");

  const zero = ctx({ x10a: true, values: [{ ...HP, value: "0.0" }, RPS_RUN] });
  zero.S.status.history = trend(HP.label);
  assert.equal(zero.liveData().circP, null, "exact 0.0 in a sealed circuit is not a pressure");
  assert.equal(zero.INSPECT.hp.pick(), null, "so the panel prints no 0.0 bar under the blank pill");
  for (const value of ["0.0", null]) {
    const rest = ctx({ x10a: true, values: [{ ...HP, value, held: true }, RPS_STOP] });
    rest.S.status.history = trend(HP.label);
    rest.S.live = rest.liveData();
    assert.equal(rest.S.live.circP, null, `a held high side reading ${value} leaves the pill blank`);
    assert.equal(rest.inspHeld(rest.INSPECT.hp, rest.S.live), true, "and the panel says why");
    const row = { ...HP, value, held_unknown: true };
    const flagOff = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: false, values: [row],
                          modbus: [M(31, "Compressor run", "0", null, { binary: true })] });
    flagOff.S.status.history = trend(HP.label);
    flagOff.S.live = flagOff.liveData();
    assert.equal(flagOff.inspHeld(flagOff.INSPECT.hp, flagOff.S.live), false,
      "a HomeHub flag must not classify an X10A page as held");
    assert.equal(flagOff.S.live.ouUnknown, true);
    const unread = ctx({ x10a: true, values: [row] });
    unread.S.status.history = trend(HP.label);
    unread.S.live = unread.liveData();
    assert.equal(unread.INSPECT.hp.pick(), null, "with no such answer it is simply no reading");
  }

  const unstated = ctx({ x10a: true, values: [HP, RP, RPS_RUN] });
  assert.equal(unstated.liveData().circP, null, "no trend named: this browser does not guess a row");
}

// ── held_unknown: the third answer ────────────────────────────────────────────────────────────
// The firmware cannot tell a live outdoor page from a frozen one. The number stays, a current reading
// outranks it, and nothing is derived from it.
{
  const OUT_U = { ...OUT_X, held_unknown: true };
  const INV_U = { label: "INV primary current (A)", value: "6.0", unit: "A", reg: 0x21, held_unknown: true };
  const plain = ctx({ x10a: true, values: [OUT_U, INV_U] });
  let d = plain.liveData();
  plain.S.live = d;
  assert.equal(d.ouUnknown, true, "no speed reading and a marked row: the state is unknown");
  assert.equal(d.ouHeldOver, false, "which is not held over");
  assert.equal(d.out, 19.0, "the reading stays drawn");
  assert.equal(plain.ouReadingText(d, "out", d.out, (n) => n.toFixed(1)), "19.0", "with its number");
  assert.equal(d.pel, null, "but no kilowatt figure is built on it");
  assert.equal(d.pelUnknown, true, "and the panel can say why");
  assert.equal(d.pelHeld, false, "not by claiming the compressor is off");
  assert.equal(d.cop, null, "nor a COP");
  plain.S.insp = "out";
  assert.equal(plain.inspUnknownAge(plain.INSPECT.out, d), true, "the panel marks the reading");
  assert.ok(plain.inspHeldHtml(plain.INSPECT.out, d).includes(plain.heldUnknownText()),
    "with the shared sentence");
  assert.equal(plain.inspHeld(plain.INSPECT.out, d), false, "and not the no-current-reading note");
  assert.equal(plain.inspNowText(plain.INSPECT.cop, d), plain.heldUnknownText(),
    "the COP panel gives the same reason");
  assert.equal(plain.inspNowText(plain.INSPECT.pel, d), plain.heldUnknownText(),
    "and so does the electrical panel");
  for (const key of ["ou", "phe", "rhot", "rcold"]) {
    assert.equal(plain.inspNowText(plain.INSPECT[key], d), plain.heldUnknownText(),
      `the ${key} panel does not state a stop nobody measured`);
  }
  assert.ok(plain.inspHeldHtml(plain.INSPECT.comp, d).includes(plain.heldUnknownText()),
    "a panel that only lists such a row states the doubt as well");
  assert.equal(plain.inspHeldHtml(plain.INSPECT.ou, d), "", "and one that said it above does not repeat it");
  d.defrost = true;
  assert.notEqual(plain.inspNowText(plain.INSPECT.ou, d), plain.heldUnknownText(),
    "a defrost stays a fact on the outdoor unit");
  for (const key of ["phe", "rhot", "rcold"]) {
    assert.equal(plain.inspNowText(plain.INSPECT[key], d), plain.heldUnknownText(),
      `and proves no stop on the ${key} panel`);
  }
  d.defrost = false;
  assert.equal(d.dtStale, true, "this plant reports no water movement");
  assert.notEqual(plain.inspNowText(plain.INSPECT.dt, d), plain.heldUnknownText(),
    "so its ΔT panel keeps that reason");
  d.dtStale = false;
  assert.equal(plain.inspNowText(plain.INSPECT.dt, d), plain.heldUnknownText(),
    "while a ΔT over moving water does not call it pump-only circulation");
  d.dtStale = true;
  assert.equal(plain.mbStandInFor(OUT_U), null, "without a HomeHub no stand-in exists");

  const COMP_ON = M(31, "Compressor run", "1", null, { binary: true });
  const COMP_OFF = M(31, "Compressor run", "0", null, { binary: true });
  const running = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: true,
    values: [INV_U], modbus: [COMP_ON] });
  d = running.liveData();
  assert.equal(d.pelSrc, null, "HomeHub ON cannot refresh unknown-age X10A current");
  assert.equal(d.ouUnknown, true);
  assert.equal(d.pelUnknown, true);
  assert.equal(d.cop, null);
  assert.match(running.inspNowText(running.INSPECT.ou, d), /HomeHub reports the compressor ON/);
  for (const flag of ["held", "held_unknown"]) {
    const speed = { label: "INV frequency (rps)", value: "18", reg: 0x30 };
    const inv = { ...INV_U, held_unknown: false, [flag]: true };
    const currentSpeed = ctx({ x10a: true, values: [
      inv, speed, X_VALVE(false),
      { label: "I/U operation mode", value: "Heating", reg: 0x60 },
      X_DEFROST("0"),
      X("Flow sensor", "12", "flow_rate", { unit: "l/min" }),
      X("Leaving Water Temp. before BUH (R1T)", "36", "leaving_water"),
      X("Inlet Water Temp. (R4T)", "30", "return_water"),
    ] });
    const live = currentSpeed.liveData();
    assert.ok(live.pth > 0, "current speed and flow still permit the thermal estimate");
    assert.equal(live.pel, null, `current speed cannot refresh an explicitly ${flag} row`);
    assert.equal(live.cop, null);
    assert.doesNotMatch(currentSpeed.inspNowText(currentSpeed.INSPECT.pel, live), /compressor is off/i);
  }
  const stopped = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: false,
    values: [INV_U], modbus: [COMP_OFF] });
  d = stopped.liveData();
  assert.equal(d.compressorOn, false, "HomeHub OFF remains an activity report");
  assert.equal(d.pel, null);
  assert.equal(d.pelHeld, false);
  assert.equal(d.pelUnknown, true, "HomeHub OFF leaves the X10A current of unknown age");
  assert.equal(d.ouHeldOver, false);
  assert.match(stopped.inspNowText(stopped.INSPECT.ou, d), /schem\.homehub_compressor_off/);
  for (const flag of [COMP_OFF, COMP_ON]) {
    for (const [metadata, rps, held, unknown, power] of [
      [{ held: true }, null, true, false, null],
      [{ held_unknown: true }, null, false, true, null],
      [{}, 18, false, false, 1.38],
      [{}, 0, true, false, null],
    ]) {
      const values = [{ ...INV_U, held_unknown: false, ...metadata }];
      if (rps != null) values.push({ label: "INV frequency (rps)", value: String(rps), reg: 0x30 });
      const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: flag === COMP_ON,
        values, modbus: [flag] });
      const live = c.liveData();
      assert.equal(live.pelHeld, held, "an independent flag cannot replace X10A held evidence");
      assert.equal(live.pelUnknown, unknown);
      assert.equal(live.pel, power);
    }
  }
  for (const [current, power] of [["-2", null], ["0", 0], ["2", 0.46]]) {
    const c = ctx({ x10a: true, values: [
      { ...INV_U, value: current, held_unknown: false },
      { label: "INV frequency (rps)", value: "18", reg: 0x30 },
      X_VALVE(false),
      { label: "I/U operation mode", value: "Heating", reg: 0x60 },
      X_DEFROST("0"),
      X("Flow sensor", "12", "flow_rate", { unit: "l/min" }),
      X("Leaving Water Temp. before BUH (R1T)", "36", "leaving_water"),
      X("Inlet Water Temp. (R4T)", "30", "return_water"),
    ] });
    const live = c.liveData();
    assert.ok(live.pth > 0);
    assert.equal(live.pel, power, "reject signed negative current without substituting for zero");
    assert.equal(live.cop > 0, Number(current) > 0);
    assert.equal(live.pelUnknown, false, "a negative current is invalid rather than of unknown age");
  }
  const INV_DROPPED = { ...INV_U, value: null };
  for (const flag of [COMP_OFF, COMP_ON]) {
    const reader = ctx({ x10a: true, mbEnabled: true, mbConnected: true, mbCompressor: flag === COMP_ON,
                         values: [INV_DROPPED], modbus: [flag] });
    const live = reader.liveData();
    assert.equal(live.mbCompressorOn, flag === COMP_ON, "the case carries a current HomeHub reply");
    assert.equal(live.pelHeld, false, "a HomeHub report cannot mark the missing inverter input as held");
    assert.equal(live.pelUnknown, false,
      "a missing inverter value must not be reported as an age-qualified reading");
    for (const key of ["pel", "cop"]) {
      assert.equal(live.pelUnread, "INV primary current",
        "a running compressor does not fabricate its missing inverter reading");
      const text = reader.inspNowText(reader.INSPECT[key], live);
      assert.match(text, /No current reading: INV primary current/,
        "the panel names the unread input without claiming that the profile lacks it");
      assert.notEqual(text, reader.heldUnknownText(),
        "the panel retains the independent HomeHub running witness");
    }
  }
  const absentPage = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                           values: [], modbus: [COMP_ON] });
  absentPage.S.status.history = { rows: [{ id: "inv_current", label: INV_U.label }] };
  const absentInput = absentPage.liveData();
  assert.equal(absentInput.pel, null, "trend metadata cannot fabricate a missing current");
  assert.equal(absentInput.pelUnread, "INV primary current",
    "the profile's trend metadata preserves source identity when its whole page is missing");
  assert.match(absentPage.inspNowText(absentPage.INSPECT.cop, absentInput),
    /No current reading: INV primary current/,
    "a lost outdoor page must not become a claim that the profile lacks electrical inputs");
  const noOutdoor = ctx({ x10a: true, mbEnabled: false, mbConnected: false, values: [] });
  const noWitness = noOutdoor.liveData();
  assert.equal(noWitness.ouUnknown, false, "absent pages carry no row-age marker");
  assert.equal(noWitness.compressorOn, null, "hydronic connectivity alone proves no compressor state");
  noWitness.dtStale = false;
  for (const key of ["ou", "phe", "rhot", "rcold", "dt"])
    assert.equal(noOutdoor.inspNowText(noOutdoor.INSPECT[key], noWitness), "dyn.state_gate",
      `absent outdoor pages cannot become a stopped compressor on the ${key} panel`);
  assert.equal(stopped.ouReadingText(d, "disch", 58, (n) => n.toFixed(0)), "58",
    "HomeHub OFF cannot withhold an independent X10A value");

  const runningPaired = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                              values: [OUT_U], modbus: [OUT_M, COMP_ON] });
  d = runningPaired.liveData();
  runningPaired.S.live = d;
  runningPaired.S.insp = "out";
  assert.equal(d.out, 28.5, "HomeHub ON leaves the X10A air reading of unknown age");
  assert.equal(runningPaired.mbStandInFor(OUT_U), OUT_M, "the independent air reading takes over");
  assert.equal(runningPaired.inspCurRow(runningPaired.INSPECT.out), null);
  assert.equal(runningPaired.mbForInspect("out"), OUT_M, "the inspector follows the displayed source");
  assert.equal(runningPaired.inspUnknownAge(runningPaired.INSPECT.out, d), false,
    "the age note does not apply to the HomeHub replacement");

  const paired = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [OUT_U], modbus: [OUT_M] });
  d = paired.liveData();
  paired.S.live = d;
  assert.equal(d.out, 28.5, "a live paired HomeHub reading outranks a row of unknown age");
  assert.equal(d.mbFields.has("out"), true, "with Modbus provenance");
  assert.equal(paired.mbStandInFor(OUT_U), OUT_M, "the value table takes the same stand-in");
  paired.S.insp = "out";
  assert.equal(paired.inspUnknownAge(paired.INSPECT.out, d), false,
    "and the panel showing the HomeHub row does not doubt it");
  assert.equal(paired.inspCurRow(paired.INSPECT.out), null,
    "nor headlines the X10A number under the pill's HomeHub number");

  const dropped = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                        values: [{ ...OUT_U, value: null }], modbus: [OUT_M] });
  assert.equal(dropped.liveData().out, 28.5,
    "a reading the firmware dropped keeps the HomeHub on the pill instead of flickering to a dash");

  const known = ctx({ x10a: true, values: [{ ...OUT_X }, RPS_STOP] });
  assert.equal(known.liveData().ouUnknown, false, "a read speed is an answer, not an unknown");
  const legacy = ctx({ x10a: true, values: [{ ...OUT_X }] });
  assert.equal(legacy.liveData().ouUnknown, false, "no marked row: this rule does not fire");
  const silent = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [OUT_U], modbus: [OUT_M] });
  assert.equal(silent.liveData().ouUnknown, false, "a silent bus has its own path");
  const silentAlone = ctx({ x10a: false, values: [OUT_U] });
  silentAlone.S.live = silentAlone.liveData();
  silentAlone.S.insp = "out";
  assert.equal(silentAlone.inspUnknownAge(silentAlone.INSPECT.out, silentAlone.S.live), false,
    "and a retained row on it is no reading whose age could be in doubt");
}

console.log("UI source matrix: arbitration, Smart-Grid and mode-aware cooling semantics correct");
console.log("value-table grouping: §6 groups resolved over the real catalog, Protection intact");
console.log("cop block reasons: every code liveData sets reaches its own bilingual sentence");
