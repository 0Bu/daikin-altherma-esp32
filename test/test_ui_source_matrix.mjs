// THE SOURCE-ARBITRATION MATRIX — which of the two stacks answers a given fact, in every state the
// pair can be in. Runs the REAL helpers out of main/www/app.js in a DOM-free VM harness, the same
// shape test_ui_board_preset.mjs uses, because CI has no browser.
//
// It exists because the host gates were all green while the arbitration was wrong. The rule
// ("X10A leads, Modbus supports, stale is never live") was written out separately for the valve, the
// pump and the space-heating demand, and the three had drifted into three different behaviours:
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

const app = fs.readFileSync(new URL("../main/www/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../main/www/index.html", import.meta.url), "utf8");

// The arbitration helpers are one contiguous block. Extracting the REAL source rather than
// re-implementing the rule is the whole point: a second copy of it would be a second thing to drift.
function span(start, end) {
  const from = app.indexOf(start);
  assert.notEqual(from, -1, `missing production source marker: ${start}`);
  const to = app.indexOf(end, from);
  assert.notEqual(to, -1, `missing production source marker: ${end}`);
  return app.slice(from, to);
}
// THREE spans, and the second and third are the whole point of this round. The first review of this
// file was right that it stopped at the helper boundary: it drove the arbitration helpers and never
// the code that RENDERS with them, and the next two defects sat exactly in that gap — the value
// row's explainer and the schematic inspector each went on building from the retained X10A row after
// the bus fell silent, so the row header showed the gateway's reading while the body beneath it
// printed a "difference" against a number minutes old. Every helper assertion below was green
// throughout. A gate that stops one call short of the consumer is a gate on the wrong thing.
const SOURCE =
  span("const mbByConcept = (cid) =>", "// First matching description for a value label") +
  span("function mbNoteHtml(row, mb)", "// Description body: the plain") +
  span("// The X10A row this target may present as a CURRENT reading", "// The reading of a /values row as one string") +
  span("const PEL_ESTIMATED_WHAT =", "\nconst INSPECT = {");

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────
// A /values X10A row and a HomeHub row, exactly as http_status.cpp serves them.
const X = (label, value, concept, extra = {}) => ({ label, value, unit: "°C", reg: 0x61, concept, ...extra });
const M = (off, label, value, concept, extra = {}) => ({ label, value, unit: "°C", off, concept, ...extra });

// The 3-way valve as each side reports it: X10A bit-flag row, HomeHub offset 37.
const X_VALVE = (on) => ({ label: "3way valve(On:DHW_Off:Space)", value: on ? "1" : "0",
                           unit: "", reg: 0x60, binary: true, concept: "valve_dhw" });
const M_VALVE = (on) => ({ label: "3-way valve to DHW", value: on ? "1" : "0",
                           unit: "", off: 37, binary: true, concept: "valve_dhw" });

function ctx({ x10a, mbEnabled, mbConnected, values = [], modbus = [] }) {
  const context = {
    S: {
      status: { hp: { connected: x10a }, modbus: { enabled: mbEnabled, connected: mbConnected } },
      _values: values,
      _modbus: modbus,
    },
    // vOn is the X10A bit-flag reader; the real one is defined far from this block, so it is stubbed
    // to exactly what it does — find a row by label regex and read its "1"/"0".
    vOn: (re) => {
      const r = context.S._values.find((v) => re.test(v.label || ""));
      return r ? String(r.value).trim() === "1" : null;
    },
    // The row lookups the extracted renderers call. Stubbed because what is under test here is which
    // SIDE answers, not how a label resolves to a row — and the resolution itself is already gated
    // by the catalog CHECKs in test_logic.cpp. `pickRow`/`inspRow` read the X10A cache exactly as
    // the real ones do, INCLUDING the part that matters: they keep answering after the link drops,
    // because the cache is deliberately retained.
    vRow: (re) => context.S._values.find((v) => re.test(v.label || "")) || null,
    pickRow: (sel) => (typeof sel === "function" ? sel()
                       : context.S._values.find((v) => sel.test(v.label || "")) || null),
    inspRow: (e) => (e.pick ? e.pick() : e.re ? context.vRow(e.re) : null),
    // Presentation helpers, faithful to the originals in the ways these assertions depend on.
    esc: (s) => String(s ?? "").replace(/[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    displayValue: (v) => {
      if (!v || v.value == null) return "—";
      const raw = String(v.value);
      if (v.binary === true) { const s = raw.trim(); if (s === "1") return "ON"; if (s === "0") return "OFF"; }
      return raw;
    },
    displayReadingLabel: (l) => String(l ?? "").trim()
      .replace(/\s*\([^)]*On\s*:[^)]*Off\s*:[^)]*\)\s*$/i, "").trim(),
    t: (k, a, b) => (k === "src.disagree" ? "sources disagree"
                   : k === "src.agree" ? "agree"
                   : k === "src.delta" ? `Difference ${a} ${b}`
                   : k === "src.modbus_tag" ? "modbus" : k),
    tx: (o) => (o == null ? "" : typeof o === "string" ? o : o.en),
    fmt1: (n) => (n == null ? "—" : n.toFixed(1)),
    LANG: "en",
  };
  vm.createContext(context);
  // `const` is lexical and never becomes a property of the context, so the helpers are handed out
  // explicitly — the same trick test_ui_live_i18n.mjs uses for its production function.
  vm.runInContext(
    SOURCE + "\nthis.__api = { mbByConcept, mbTwin, mbFallbackFor, mbLive, mbBool, mbVal, stateOf," +
    " MB_PAIRS, MB_OFF_POWER, MB_OFF_SMART_GRID, mbPower, mbSmartGridMode, mbForInspect," +
    " sgModeText, sgRequestText, mbNoteHtml, inspCurRow, inspMember," +
    " inspMembers, pelMeasured, pelApproxText, PEL_INSPECT };",
    context, { filename: "main/www/app.js" });
  return context.__api;
}

const LWT_X = X("Leaving water temp. before BUH (R1T)", "38.6", "leaving_water");
const LWT_M = M(40, "Leaving water temp. (PHE)", "38.1", "leaving_water");
const SG = (value) => M(56, "Smart-Grid operation mode", String(value), null, { unit: "" });

// ── 1. Both live, numeric — the gateway is reachable as the second opinion ─────────────────────
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true, values: [LWT_X], modbus: [LWT_M] });
  const twin = c.mbByConcept("leaving_water");
  assert.equal(twin?.value, "38.1", "both live: the twin must resolve");
  assert.equal(c.mbTwin(LWT_X)?.value, "38.1", "both live: mbTwin must resolve off the row");
  // X10A leads: the fallback picker must NOT hand the gateway value over while X10A answers.
  assert.equal(c.mbFallbackFor("leaving_water"), null, "both live: no fallback while X10A answers");
}

// ── The Modbus-only Smart-Grid request is visible while BOTH stacks are live ───────────────────
// It is not an X10A fallback: the normal installation has X10A and HomeHub side by side, and that
// is exactly where the dashboard must prove that evcc's mode-2 boost reached the controller.
{
  const c = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                  values: [LWT_X], modbus: [LWT_M, SG(2)] });
  assert.equal(c.MB_OFF_SMART_GRID, 56, "UI uses the EKRHH data-model offset, not PDU address 55");
  assert.equal(c.mbSmartGridMode(), 2, "mode 2 must reach the live schematic");
  assert.equal(c.mbForInspect("sgrequest")?.value, "2",
    "the inspector must remain traceable to the Modbus row while X10A is live");
  assert.equal(c.sgModeText(2), "sg.mode2");
  assert.equal(c.sgRequestText(2), "schem.sg_boost");
}

// A stale HomeHub cache is not an active request, and invalid enum values are not guessed into one.
{
  const down = ctx({ x10a: true, mbEnabled: true, mbConnected: false, modbus: [SG(2)] });
  assert.equal(down.mbSmartGridMode(), null, "disconnected HomeHub: cached boost must disappear");
  assert.equal(down.mbForInspect("sgrequest"), null, "disconnected HomeHub: no stale inspector row");

  const invalid = ctx({ x10a: true, mbEnabled: true, mbConnected: true, modbus: [SG(4)] });
  assert.equal(invalid.mbSmartGridMode(), null, "unknown Smart-Grid enum must fail closed");
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
                  values: [LWT_X], modbus: [M(40, "Leaving water temp. (PHE)", null, "leaving_water")] });
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
  assert.ok(html.includes("Leaving water temp. (PHE)"),
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

// ── 17. A headline reading is not repeated in the inspector's member list ─────────────────────
// Value entries share the `rows` mechanism with components, and commonly include their own row in
// that list. The headline already prints the X10A value and the explainer already prints its Modbus
// twin; the member list must contain only the additional context rows. This is the exact shape that
// duplicated both DHW tank temperatures in the panel.
{
  const TANK_X = X("DHW tank temp. (R5T)", "45.2", "dhw_tank");
  const TANK_M = M(43, "DHW tank temp.", "45.4", "dhw_tank");
  const SETPOINT = X("DHW setpoint", "48.0", null);
  const E = { re: /dhw tank temp/i, rows: [/dhw tank temp/i, /dhw setpoint/i] };
  const live = ctx({ x10a: true, mbEnabled: true, mbConnected: true,
                     values: [TANK_X, SETPOINT], modbus: [TANK_M] });
  const row = live.inspCurRow(E);
  const members = live.inspMembers(E, row, null);
  assert.equal(members.length, 1, "the member list keeps only the additional context row");
  assert.equal(members[0].x10a, SETPOINT, "the DHW setpoint remains");
  assert.equal(members.some((m) => m.x10a === TANK_X), false,
    "the X10A headline is not repeated as a member");
  assert.equal(members.some((m) => m.mb === TANK_M), false,
    "the Modbus comparison is not repeated as a member");

  // With X10A down, the gateway becomes the headline. It must still be removed from the list.
  const down = ctx({ x10a: false, mbEnabled: true, mbConnected: true,
                     values: [TANK_X], modbus: [TANK_M] });
  const fallback = down.mbForInspect("tank");
  assert.equal(fallback, TANK_M, "the tank target resolves the exact Modbus fallback row");
  assert.deepEqual(down.inspMembers(E, null, fallback), [],
    "the Modbus fallback headline is not repeated as a member");

  // An assembly has no headline and therefore retains the full list, including the paired reading.
  const assembly = { rows: [/dhw tank temp/i, /dhw setpoint/i] };
  assert.equal(live.inspMembers(assembly, null, null).length, 2,
    "component inspectors retain all of their member readings");
}

// ── 18. The MEASURED power is addressed by its offset, never by its unit ───────────────────────
// Three rows in the HomeHub map carry "kW": the measured consumption at input 51 and the two power
// LIMIT setpoints at holding 57/58. A first-match on the unit promoted an installer's configured
// ceiling to the plant's measured draw the moment 51 was unavailable — and the Modbus card went on
// labelling it correctly one card below, so the substitution was visible only on the drawing.
{
  const P = (off, label, value) => ({ label, value, unit: "kW", off, concept: null });
  const both = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                     modbus: [P(51, "Power consumption", "1.42"),
                              P(57, "Power limit (buffering)", "5.00"),
                              P(58, "Power limit (general)", "7.00")] });
  assert.equal(both.MB_OFF_POWER, 51, "the measured power is EKRHH input register 51");
  assert.equal(both.mbPower()?.value, "1.42", "the measurement is what is read");
  assert.equal(both.mbForInspect("pel")?.label, "Power consumption",
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
  assert.match(app, /setTxt\("pelApprox", pelApproxText\(d\)\)/);
  assert.match(app, /pel:\s*PEL_INSPECT/);

  // 51 absent (sentinel / unread) with both limits valid — the case that produced the wrong number.
  const gone = ctx({ x10a: false, mbEnabled: true, mbConnected: true, values: [],
                     modbus: [P(51, "Power consumption", null),
                              P(57, "Power limit (buffering)", "5.00"),
                              P(58, "Power limit (general)", "7.00")] });
  assert.equal(gone.mbPower(), null,
    "no measured power: the answer is nothing, never a power LIMIT that happens to share the unit");
  // Prove the trap is really set — a unit-keyed lookup over this very fixture picks a limit.
  const byUnit = [P(51, "Power consumption", null), P(57, "Power limit (buffering)", "5.00")]
    .find((m) => m.unit === "kW" && m.value != null);
  assert.equal(byUnit.off, 57, "the unit-keyed lookup this replaced would have taken the limit");
}

console.log("UI source matrix: X10A/Modbus arbitration correct in all 18 states");
