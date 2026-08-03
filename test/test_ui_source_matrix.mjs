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

const SOURCE = readAppFragments(["descriptions.js", "schematic.js"]);
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
const M_VALVE = (on) => ({ label: "3-way valve", value: on ? 1 : 0,
                           unit: "", off: 37, enum: "three_way_valve", concept: "valve_dhw" });
const M_FLAG = (off, label, on, concept = null) => ({
  label, value: on ? 1 : 0, unit: "", off, binary: true, concept,
});

function ctx({ x10a, mbEnabled, mbConnected, values = [], modbus = [], elements = {} }) {
  const context = {
    S: {
      status: { hp: { connected: x10a }, modbus: { enabled: mbEnabled, connected: mbConnected } },
      _values: values,
      _modbus: modbus,
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
    t: (k, a, b) => (k === "src.disagree" ? "sources disagree"
                   : k === "src.agree" ? "agree"
                   : k === "src.delta" ? `Difference ${a} ${b}`
                   : k === "src.modbus_tag" ? "modbus" : k),
    tx: (o) => (o == null ? "" : typeof o === "string" ? o : o.en),
    LANG: "en",
    $: (id) => elements[id] || null,
  };
  vm.createContext(context);
  // `const` is lexical and never becomes a property of the context, so the helpers are handed out
  // explicitly — the same trick test_ui_live_i18n.mjs uses for its production function.
  vm.runInContext(
    SOURCE + "\nthis.__api = { mbByConcept, mbTwin, mbFallbackFor, mbLive, mbBool, mbVal, stateOf," +
    " MB_PAIRS, MB_OFF_POWER, MB_OFF_SMART_GRID, mbPower, modbusEnumNumber, mbSmartGridMode, mbForInspect," +
    " mbUnitAbnormality," +
    " SMART_GRID_MODE_VALUE, x10aSmartGridModeFrom, x10aSmartGridMode, x10aSmartGridRow," +
    " sgModeText, mbNoteHtml, inspCurRow, inspMember," +
    " inspMembers, inspValues, inspComparisonHtml, inspHeld, liveData, compressorRunning," +
    " waterThermalKind, activeSpaceKind, ouReadingText, updateSchematicStateA11y, bshInputRow, INSPECT," +
    " pelMeasured, pelApproxText, PEL_INSPECT };",
    context, { filename: "main/www/app.sources" });
  context.__api.S = context.S;
  return context.__api;
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
    /class="sc-bsh-state-box" x="541" y="278" width="70" height="20" rx="10"/,
    "the heater pill stays compact and centred inside the tank");
  assert.doesNotMatch(index, /id="svSgRequest"/,
    "the Boost pill has no visible active/inactive second line");
  assert.match(style, /svg \.sc-bsh-state-box \{[^}]*fill:\s*var\(--hatch\)/,
    "inactive heater pill uses the neutral light-grey fill");
  assert.match(style, /\.bsh-on \.sc-bsh-state-box \{[^}]*stroke:\s*var\(--warn\)/,
    "active heater pill turns orange as a whole pill");
  assert.match(style, /svg \.sc-sg-request-box \{[^}]*fill:\s*var\(--hatch\)/,
    "inactive Boost pill uses the neutral light-grey fill");
  assert.match(style, /\.sg-boost-on \.sc-sg-request-box \{[^}]*stroke:\s*var\(--src-mb\)/,
    "active Boost pill keeps the HomeHub petrol state colour");
  for (const id of ["gDefrostState", "gQuietState"]) {
    assert.match(index, new RegExp(`id="${id}"[\\s\\S]*?tabindex="0"`),
      `${id} must remain interactive while inactive`);
    assert.doesNotMatch(index, new RegExp(`id="${id}"[^>]*aria-hidden`));
  }
  assert.match(index, /id="gQuietState"[\s\S]*?<rect class="sc-pill" x="42"[^>]*width="64"[\s\S]*?<text class="sc-val" x="74"/,
    "Quiet is centred inside its own pill");
  assert.match(index, /id="gDefrostState"[\s\S]*?<rect class="sc-pill" x="116"[^>]*width="70"[\s\S]*?<text class="sc-val" x="151"/,
    "Defrost is centred inside its own pill");
  assert.equal((42 + 116 + 70) / 2, 24 + 180 / 2,
    "the combined Quiet/Defrost bounds share the outdoor-unit centre line");
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
  };
  Object.keys(elements).forEach((id) => Object.assign(elements[id], attrs(id)));
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, elements });
  c.updateSchematicStateA11y({ bsh: false, defrost: false, quiet: false, sgMode: 0 });
  assert.equal(elements.gBshState.values.get("aria-label"), "schem.bsh_label: state.off");
  assert.equal(elements.gSgRequest.values.get("aria-label"), "schem.sg_boost: sg.mode0");
  assert.equal(elements.gDefrostState.values.get("aria-label"), "schem.defrost_pill: state.off");
  assert.equal(elements.gQuietState.values.get("aria-label"), "chip.quiet: state.off");
  c.updateSchematicStateA11y({ bsh: true, defrost: true, quiet: true, sgMode: 2 });
  assert.equal(elements.gBshState.values.get("aria-label"), "schem.bsh_label: state.on");
  assert.equal(elements.gSgRequest.values.get("aria-label"), "schem.sg_boost: sg.mode2");
  assert.equal(elements.gDefrostState.values.get("aria-label"), "schem.defrost_pill: state.on");
  assert.equal(elements.gQuietState.values.get("aria-label"), "chip.quiet: state.on");
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
const M_QUIET = (on) => M_FLAG(9, "Quiet mode operation", on, "quiet_state");

// The README recording drives the same production parser. Keep its fake HomeHub on the real API
// boundary (raw numeric enum plus semantic metadata), or a regression to text could stay hidden.
{
  const end = demo.indexOf("\n})();");
  assert.notEqual(end, -1, "demo harness must expose a closed DEMO fixture");
  const demoContext = {};
  vm.runInNewContext(demo.slice(0, end + "\n})();".length) +
    "\nthis.__smartGrid = DEMO.smartGrid; this.__outdoorAir = DEMO.outdoorAir;" +
    " this.__standbyMbOut = DEMO.scenes[0].mbOut;", demoContext,
  { filename: "tools/uigif/scenes.js" });
  assert.equal(demoContext.__smartGrid(0).value, 0);
  assert.equal(demoContext.__smartGrid(0).enum, "smart_grid_mode");
  assert.equal(demoContext.__smartGrid(2).value, 2);
  const demoOut = demoContext.__outdoorAir(demoContext.__standbyMbOut);
  assert.equal(demoOut.off, 44);
  assert.equal(demoOut.concept, "outdoor_air");
  assert.equal(demoOut.value, "6.8", "the standby recording exercises the live Modbus fallback");
}

// Quiet is the outdoor-unit state with an exact second source. X10A leads disagreements; HomeHub
// input 9 keeps the pill and inspector current when the service bus is silent.
{
  const both = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [X_QUIET(false)], modbus: [M_QUIET(true)] });
  assert.equal(both.liveData().quiet, false, "live X10A Quiet leads a contradictory HomeHub state");
  assert.equal(both.mbForInspect("quiet"), both.S._modbus[0],
    "the Quiet inspector keeps the exact HomeHub state as a second opinion");

  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [X_QUIET(false)], modbus: [M_QUIET(true)] });
  assert.equal(down.liveData().quiet, true,
    "HomeHub input 9 keeps Quiet current when X10A is silent");
  assert.equal(down.INSPECT.quiet.trend, "quiet_state");
  assert.equal(down.INSPECT.defrost.trend, "defrost_state");
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
  assert.match(c.INSPECT.ou.now(d).de, /HomeHub-Modbus-Register/,
    "the German outdoor-unit explanation names the standby substitution");
  assert.match(c.INSPECT.ou.now(d).de, /Alter der zugrunde liegenden Messung.*unbekannt/,
    "a successful Modbus poll must not claim source-measurement freshness");

  c.S.insp = "disch";
  assert.equal(c.mbForInspect("disch"), null, "unpaired discharge has no invented fallback");
  assert.equal(c.inspHeld(c.INSPECT.disch, d), true,
    "the unpaired held-over reading still explains why it is blank");
}

// Zero degrees is a valid outdoor measurement, not a missing-value sentinel.
{
  const zero = M(44, "Outdoor air temperature", 0, "outdoor_air");
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [OUT_X, RPS_STOP], modbus: [zero] });
  const d = c.liveData();
  assert.equal(d.out, 0);
  assert.equal(d.mbFields.has("out"), true);
}

// ── The Modbus-only Smart-Grid request is visible while BOTH stacks are live ───────────────────
// It is not an X10A fallback: the normal installation has X10A and HomeHub side by side, and that
// is exactly where the dashboard must prove that evcc's mode-2 boost reached the controller.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M, SG(2)] });
  assert.equal(c.MB_OFF_SMART_GRID, 56, "UI uses the EKRHH data-model offset, not PDU address 55");
  assert.equal(c.mbSmartGridMode(), 2, "mode 2 must reach the live schematic");
  assert.equal(c.mbForInspect("sgrequest")?.value, 2,
    "the inspector must remain traceable to the Modbus row while X10A is live");
  assert.equal(c.sgModeText(2), "sg.mode2");
  assert.match(SOURCE, /classList\.toggle\("sg-boost-on", d\.sgMode === 2\)/,
    "only mode 2 may apply the active Boost colour");
  assert.doesNotMatch(SOURCE, /sg-request-on/,
    "the former all-nonzero request visibility rule must stay removed");
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

// BSH uses the same arbitration as the other physical states and remains traceable to HomeHub
// input 32 when X10A cannot answer. Input 51 is whole-system context, never renamed heater power.
{
  const both = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [X_BSH(false)], modbus: [M_BSH(true)] });
  assert.equal(both.liveData().bsh, false, "live X10A BSH leads a contradictory HomeHub state");

  const power = { label: "Heat pump power consumption", value: "2.40", unit: "kW", off: 51 };
  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [X_BSH(false)], modbus: [M_BSH(true), power] });
  const d = down.liveData();
  down.S.live = d;
  assert.equal(d.bsh, true, "HomeHub input 32 keeps the heater state live when X10A is silent");
  assert.equal(down.mbForInspect("bsh"), down.S._modbus[0],
    "the heater inspector names the exact HomeHub state row");
  assert.equal(down.INSPECT.bsh.trend, "bsh_state");
  assert.equal(down.INSPECT.buh.trend, "buh_state");
  const context = down.bshInputRow();
  assert.equal(context.value, "2.4");
  assert.match(context.label, /not heater power/,
    "whole-system input must not be presented as dedicated heater power");
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
  const c = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                  values: [], modbus: dhwModbus });
  const d = c.liveData();
  assert.equal(d.rps, null, "Modbus-only does not invent a compressor speed");
  assert.equal(d.compressorOn, true, "HomeHub input 31 supplies the live compressor witness");
  assert.equal(c.compressorRunning(d), true, "the schematic recognises the gateway witness");
  assert.equal(d.thermalMode, "heat", "a DHW-routed hydronic loop is a heating task");
  assert.equal(c.waterThermalKind(d, true), "heat",
    "active Modbus-only DHW receives heating colours, never cooling or neutral colours");
  assert.equal(d.pthKind, "heating");
  assert.ok(Math.abs(d.pth - 7.87) < 0.01,
    "the witnessed PHE transfer is flow×(R1T−R4T), using the screenshot operating point");

  const stopped = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                        modbus: dhwModbus.map((r) => r.off === 31 ? { ...r, value: 0 } : r) });
  const idle = stopped.liveData();
  assert.equal(idle.pth, null, "compressor OFF keeps the same arithmetic from becoming heat output");
  assert.equal(stopped.waterThermalKind(idle, true), "neutral",
    "pump-only DHW remains explicitly neutral");

  const space = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
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
  assert.equal(c.MB_PAIRS.length, 6, "six measurement pairings");
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
// the GATEWAY's own register and states the difference.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M] });
  const html = c.mbNoteHtml(LWT_X, c.mbTwin(LWT_X));
  assert.ok(html.includes("Leaving water temperature PHE"),
    "both live: the line names the MODBUS register, not the X10A row");
  assert.ok(html.includes("Difference 0.5"), "both live: the difference is stated");
  assert.ok(html.includes("plate heat exchanger"),
    "leaving water is one of the three pairings with a stated reason");
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

// ── 18. The MEASURED power is addressed by its offset, never by its unit ───────────────────────
// Three rows in the HomeHub map carry "kW": the measured consumption at input 51 and the two power
// LIMIT setpoints at holding 57/58. A first-match on the unit promoted an installer's configured
// ceiling to the plant's measured draw the moment 51 was unavailable — and the Modbus card went on
// labelling it correctly one card below, so the substitution was visible only on the drawing.
{
  const P = (off, label, value) => ({ label, value, unit: "kW", off, concept: null });
  const both = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                     modbus: [P(51, "Heat pump power consumption", "1.42"),
                              P(57, "Power limit during Recommended on / buffering", "5.00"),
                              P(58, "General power limit", "7.00")] });
  assert.equal(both.MB_OFF_POWER, 51, "the measured power is EKRHH input register 51");
  assert.equal(both.mbPower()?.value, "1.42", "the measurement is what is read");
  assert.equal(both.mbForInspect("pel")?.label, "Heat pump power consumption",
    "the measured schematic headline remains traceable to its Modbus register");

  const measured = { pel: 1.42, pelSrc: "MB", pelHeld: false };
  assert.equal(both.pelApproxText(measured), "", "a measured gateway value has no approximation mark");
  assert.equal(both.PEL_INSPECT.t(measured).en, "Electrical input (measured)");
  assert.equal(both.PEL_INSPECT.head(measured), "1.4 kW");
  assert.match(both.PEL_INSPECT.what(measured).en, /MEASURED by the HomeHub/);
  assert.match(both.PEL_INSPECT.now(measured).en, /Measured at the HomeHub/);

  const estimated = { pel: 1.42, pelSrc: "INV", pelHeld: false };
  assert.equal(both.pelApproxText(estimated), "≈ ", "an X10A current-derived value stays approximate");
  assert.equal(both.PEL_INSPECT.t(estimated).en, "Electrical input (estimated)");
  assert.equal(both.PEL_INSPECT.head(estimated), "≈ 1.4 kW");
  assert.match(both.PEL_INSPECT.what(estimated).en, /ESTIMATE/);
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
    "no measured power: the answer is nothing, never a power LIMIT that happens to share the unit");
  // Prove the trap is really set — a unit-keyed lookup over this very fixture picks a limit.
  const byUnit = [P(51, "Heat pump power consumption", null),
                  P(57, "Power limit during Recommended on / buffering", "5.00")]
    .find((m) => m.unit === "kW" && m.value != null);
  assert.equal(byUnit.off, 57, "the unit-keyed lookup this replaced would have taken the limit");
}

// ── 19. Cooling semantics: residual-hot circulation is not cooling capacity ────────────────────
// This reproduces the live 57.8/57.5 °C screenshot: Cooling selected, space circulation active,
// compressor stopped. The two temperatures are internal PHE readings after a DHW run. Arithmetic
// flow×ΔT is non-zero, but there is no refrigerant-side transfer and therefore no capacity or EER.
{
  const mode = (value) => ({ label: "I/U operation mode", value, unit: "", reg: 0x60 });
  const bin = (label, on, reg = 0x62) => ({ label, value: on ? "1" : "0", unit: "", reg, binary: true });
  const values = [
    mode("Cooling"),
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
  assert.equal(d.dtSet, null, "heating target ΔT is not quoted in Cooling");
  assert.equal(d.pthRaw > 0, true, "the residual-temperature arithmetic is intentionally non-zero");
  assert.equal(d.pth, null, "stopped compressor suppresses the false cooling-capacity claim");
  assert.equal(d.pthKind, null);
  assert.equal(c.activeSpaceKind(d), null, "pump-only residual circulation is not labelled as a cooling circuit");
  assert.equal(d.cop, null, "no active cooling capacity means no EER");
  assert.equal(d.efficiencyKind, "eer", "the efficiency label still follows Cooling mode");
  assert.match(c.INSPECT.phe.now(d).en, /compressor is stopped/);
  assert.match(c.INSPECT.dt.now(d).en, /residual-temperature equalisation/);
}

// With the compressor running and R1T below R4T, the live 13.2/15.4 °C operating point becomes
// positive cooling capacity and the quotient is EER. The opposite direction must still fail closed.
{
  const common = [
    { label: "I/U operation mode", value: "Cooling", unit: "", reg: 0x60 },
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
  assert.equal(cool.INSPECT.cop.t(d).en, "EER of the heat pump (estimated)");
  assert.match(cool.INSPECT.cop.what(d).en, /cooling capacity divided/i);

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

console.log("UI source matrix: arbitration, Smart-Grid and mode-aware cooling semantics correct");
