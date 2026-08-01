
// ── Live system section (the interactive schematic) ──────────────────────────────────────────
// Everything here reads /values through label patterns — the same technique pickValue() already
// uses — so the section degrades per model: a value the profile doesn't carry renders "—", and a
// missing tank/room sensor hides that schematic part entirely (.no-dhw/.no-room). The DOM is
// static (index.html) and updated in place: an innerHTML rebuild like #valueGroups' would restart
// the CSS flow animations on every poll.
const vRow = (re) => (S._values || []).find((x) => re.test(x.label || "") && x.value != null);
const vNum = (re) => { const r = vRow(re); if (!r) return null; const n = parseFloat(r.value); return Number.isFinite(n) ? n : null; };
// Bit-flag values arrive as numeric 1/0 (logic/convert.hpp conv 300-307). null = row absent.
const vOn = (re) => { const r = vRow(re); return r ? String(r.value).trim() === "1" : null; };

// The outdoor unit's OWN register pages — logic/ou_stale.hpp's ou_page_holds_over(), transcribed:
// 0x20 (outdoor sensors) and 0x21 (inverter) are only refreshed while the compressor runs, so with
// it stopped every row on them is the LAST RUN's value. Keyed on the row's REGISTER, which /values
// now carries, and never on its label: the catalog spells these rows ~50 different ways across the
// 43 profiles, so a pattern list would be a second copy of a rule that CI gates in C++ — and would
// stop covering a row the moment a profile spelled it differently.
const OU_HELD_PAGES = [0x20, 0x21];
// Is this /values row still a CURRENT reading? Takes the snapshot rather than reading S.live, so
// every consumer answers from the same poll the rest of its render came from.
const rowHeldOver = (r, d) => !!(d && d.ouHeldOver && r && OU_HELD_PAGES.includes(r.reg));

// Leaving-water MEASUREMENT for ΔT / heat output / COP — NOT a plain vNum, because a measurement
// regex that can also match a setpoint row poisons all three (issue #121, the #35-#39 failure
// shape). Host-tested twin: main/logic/lwt_select.hpp + test/test_logic.cpp test_lwt_select() —
// keep the token lists below byte-for-byte in sync (lowercase substring, no regex).
//   Tier 1 = the pre-BUH heat-exchanger outlet (R1T) under any label form — "before BUH (R1T)",
//     "after PHE (R1T)", "Outlet Water Heat Exch. Temp. (R1T)", "[HPSU] Tv inflow Temp (R1T)";
//     keying on the (R1T) tag (not a "heat exch" keyword, which also hits outdoor/refrigerant rows)
//     lights up the alias-labelled profiles that "leaving water.*before" alone missed.
//   Tier 2 = any leaving/outlet-water measurement that is NOT a setpoint / mixed-zone / post-BUH.
const lwtWater = (l) => l.includes("leaving water") || l.includes("outlet water") || l.includes("inflow");
const lwtReject = (l) => l.includes("setpoint") || l.includes("mixed") || l.includes("r2t") || l.includes("after buh") || l.includes("after buffer");
const lwtRow = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l) && l.includes("r1t"); });
  if (!r) r = vals.find((x) => { const l = low(x); return lwtWater(l) && !lwtReject(l); });
  return r || null;
};
const vLwt = () => {
  const r = lwtRow();
  if (!r) return null;
  const n = parseFloat(r.value);
  return Number.isFinite(n) ? n : null;
};
// The POST-BUH (R2T) leaving-water measurement — the COP numerator when the electrical figure is a
// WHOLE-UNIT one. Host-tested twin: main/logic/cop_scope.hpp cop_is_post_buh / cop_post_buh_select
// (test/test_logic.cpp test_cop_scope), gated against the whole catalog; keep the tokens below
// byte-for-byte in sync with it and with lwtWater/lwtReject above.
// The PAGE is half the address, not defensive style: "(R2T)" also names the compressor's discharge
// pipe on 0x20/4 — same offset, same converter as the water row on 0x61/4. The water tokens happen
// to separate those two today, but that is how one row was spelled, not a property of the data; a
// row on a page the outdoor unit stops refreshing is a held-over reading whatever it is called, and
// a held-over temperature must never reach a heat figure presented as current.
const postBuhRow = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  return vals.find((x) => {
    const l = (x.label || "").toLowerCase();
    return !OU_HELD_PAGES.includes(x.reg) && l.includes("r2t") &&
           !l.includes("setpoint") && !l.includes("mixed") && lwtWater(l);
  }) || null;
};
const fmt1 = (n) => (n == null ? "—" : n.toFixed(1));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const setTxt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };

function liveData() {
  // ΔT is measured across the PHE: leaving water BEFORE the backup heater minus inlet water — with
  // the BUH off (the normal case) before/after are equal, and the derived heat output must not
  // credit the resistive heater to the heat pump.
  const lwt = vLwt();   // pre-BUH R1T measurement, never a setpoint (see vLwt / logic/lwt_select.hpp)
  const ret = vNum(/inlet water/i);
  const cts = (S._values || []).filter((x) => /current measured by ct/i.test(x.label || "") && x.value != null);
  const ct = cts.reduce((a, x) => a + (parseFloat(x.value) || 0), 0);
  const inv = vNum(/inv primary current/i);
  const d = {
    lwt, ret,
    dt: lwt != null && ret != null ? lwt - ret : null,
    out: vNum(/outdoor air/i),
    flow: vNum(/flow sensor/i),
    wp: vNum(/^water pressure$/i),
    rps: vNum(/inv frequency/i),
    hp: vNum(/^high pressure$/i),
    lp: vNum(/^low pressure$/i),
    rp: vNum(/^refrigerant pressure sensor$/i),
    disch: vNum(/discharge pipe temp/i),
    eev: vNum(/expansion valve ?1/i),
    tank: vNum(/dhw tank temp/i),
    tankSet: vNum(/dhw setpoint/i),
    room: vNum(/^indoor ambient temp/i),
    roomSet: vNum(/^rt setpoint/i),
    dtSet: vNum(/target delta t heating/i),
    pumpSig: vNum(/water pump signal/i),
    pumpOn: stateOf(/water pump operation/i, 30),
    // Through stateOf, like every other plant state: X10A while its link is live, else a live
    // gateway, else nothing. Keyed on the EKRHH OFFSET, not a label — those offsets are the
    // documented data model (§9.2.2) and are the one thing about a HomeHub row that cannot be
    // re-spelled.
    valveDhw: stateOf(/3.?way valve/i, 37),        // label documents On:DHW / Off:Space
    buh1: vOn(/buh step ?1/i),
    buh2: vOn(/buh step ?2/i),
    // Exact anchor is intentional: "Thermal protector BSH" is a different flag. BSH is the tank's
    // electric immersion heater and can be the only active component during an SG-Ready boost.
    bsh: vOn(/^bsh$/i),
    defrost: vOn(/defrost operation/i),
    // The SPACE-HEATING branch's own demand — "Space heating Operation ON/OFF", 0x62/2 bit 3, the
    // hydronic page. Anchored so it cannot also take "Space H Operation output" (0x62/8), which is
    // the OUTPUT terminal's state, not the request. Emphatically NOT "Thermostat ON/OFF": that row
    // is 0x60/2 bit 3, a bit in the INDOOR UNIT's status byte, and it is ON for a DHW charge just
    // as readily (measured: every ON minute over three days was one) — drawing it on the heating
    // riser attributed a true reading to the wrong branch. It is still published and still in the
    // value list; it is just no longer claimed to be a room's request for heat. A catalog CHECK in
    // test/test_logic.cpp pins each of the two labels to its one page, which is what makes matching
    // by label here unambiguous — if the generator ever emits page 0x10's own "Thermostat ON/OFF"
    // bit, that test fails and this selection has to become structural (keyed on reg, like ouPage).
    spaceH: stateOf(/^space heating operation/i, 53),
    quiet: vOn(/low noise control|silent mode/i),
    // HomeHub holding offset 56 is the EXTERNAL Smart-Grid request. It is intentionally independent
    // of the plant's operating mode: mode 2 proves that evcc's boost reached the controller, while
    // the DHW flag / valve / flow separately prove whether the controller acted on it.
    sgMode: mbSmartGridMode(),
    // Source provenance for schematic fields. Normally empty: X10A leads. A field is added only
    // when liveData replaces an unavailable X10A reading with the independent HomeHub measurement;
    // renderLive then gives that pill the petrol source colour and the inspector names the register.
    mbFields: new Set(),
  };
  // Pump % — the wire value is inverted ("Water pump signal (0:max-100:stop)").
  d.pump = d.pumpSig == null ? null : Math.min(100, Math.max(0, 100 - d.pumpSig));
  // The outdoor unit refreshes its OWN register pages (0x20 sensors, 0x21 inverter) only while it
  // RUNS — stopped, it answers with the LAST RUN's values (logic/ou_stale.hpp, host-tested against
  // the whole catalog). Measured on a live unit: outdoor air held exactly 19.0 °C for five hours,
  // then stepped to 25.5 at the instant the compressor started, while the hydronic pages decayed
  // smoothly throughout. Those readings must therefore not be drawn as current — DESIGN.md's
  // dead-bus rule ("an idle plant with no readings, not a stale one"), applied to one sleeping unit.
  // A held-over 19.0 °C is exactly the #35-#39 shape: well-formed, plausible, and false — and it is
  // what made an idle plant look like a running one next to a "not running" headline.
  // UNKNOWN rps (a profile with no such row) reads as CURRENT, never as held over: that is absence
  // of evidence, and blanking on a guess would cost a reading that may well be live.
  d.ouHeldOver = d.rps != null && d.rps === 0;
  // X10A's outdoor-air row is held over at rest, but the HomeHub's independent sensor keeps
  // measuring. Prefer that CURRENT reading to a blank pill, while retaining ouHeldOver so every
  // other page-0x20/0x21 value (notably discharge temperature) is still withheld. The pairing is the
  // firmware's structural concept, never a browser label guess; a missing/disconnected HomeHub still
  // leaves the ordinary "—" behaviour intact.
  const takeMb = (key, cid) => {
    const r = mbByConcept(cid);
    if (!r) return;
    const n = parseFloat(r.value);
    if (Number.isFinite(n)) { d[key] = n; d.mbFields.add(key); }
  };
  if (d.ouHeldOver) takeMb("out", "outdoor_air");
  // Circuit refrigerant pressure for the schematic's high-side badge. The outdoor unit's own High
  // Pressure transducer (reg 0x20) reads 0 bar while the compressor is off — but a sealed R32 circuit
  // is never at 0 bar, so "0.0 bar" paints a live-looking fault on an idle unit. Fall back to the
  // always-live Refrigerant pressure sensor (reg 0x62/15), which reports the real equalised system
  // pressure at rest (~14 bar for R32 near 20 °C). When the compressor runs, High Pressure is the true
  // discharge pressure and wins. Neither present (17 profiles carry no pressure row) → null → "—".
  // Gated on ouHeldOver too: this unit reads 0 bar at rest so the fallback already fires, but a unit
  // whose 0x20 freezes at a NON-zero pressure would otherwise show that stale bar as the live one.
  // The chosen ROW is kept, not just its number: the inspector names it as the source line beside the
  // headline, so picking the pill's number here and the pill's source there would let the two drift
  // into naming High Pressure while showing the refrigerant sensor's bar.
  d.circPRow = (!d.ouHeldOver && d.hp != null && d.hp > 0 ? vRow(/^high pressure$/i)
                                                          : vRow(/^refrigerant pressure sensor$/i)) || null;
  d.circP = !d.ouHeldOver && d.hp != null && d.hp > 0 ? d.hp : d.rp;
  // ΔT is a WORKING POINT across the exchanger — it needs water moving to mean anything. With the
  // pump off, R1T and R4T are two stagnant sensors cooling at different rates, and their difference
  // (measured: 14.6 K on a plant idle for an hour) is not a small ΔT, it is no ΔT at all. Decided
  // HERE rather than in renderLive so the drawing and the explainer cannot disagree about it — the
  // pill blanked while the inspector went on quoting the number was the same split that let a
  // held-over outdoor temperature survive in the explainer after the pill stopped showing it.
  // Unknown flow AND unknown pump (no rows) still prints: that is not evidence of no flow.
  d.dtStale = d.pumpOn === false && d.flow != null && d.flow <= 0;
  // Derived figures, marked "est." in the UI — the bus has no energy registers. Thermal output from
  // flow × ΔT (water ≈ 4.186 kJ/kg·K); electrical from the CT phase currents at an assumed 230 V,
  // falling back to the inverter primary current when the profile has no CT rows.
  // SIGNED on purpose: during a defrost the unit pulls heat back OUT of the heating water, so ΔT is
  // genuinely negative. Clamping that to 0 published a measured-looking "0.0 kW" while ~5 kW flowed
  // the other way — the same shape as the #37 sentinel-as-reading bug. Show what is actually there.
  d.pth = d.flow != null && d.dt != null ? d.flow / 60 * 4.186 * d.dt : null;
  // The two electrical sources fall on OPPOSITE sides of the held-over rule, so the fallback has to
  // be gated rather than the pill blanked: the CT clamps sit on the hydronic page 0x63 and keep
  // measuring (a non-zero reading at rest is real standby draw, worth showing), while "INV primary
  // current" is a 0x21 outdoor-unit row that freezes with the rest of that page — every profile in
  // the catalog carries it, only about half carry CT clamps, and an idle plant reads ct == 0, so the
  // ungated fallback fired on the majority of installs almost all of the time. It drew last run's
  // amps as a live kW figure right beside the "not running" headline: plausible, well-formed, false
  // — the #35-#39 shape, and the same reason d.circP already gates. Asserted against the whole
  // catalog by logic/ou_stale.hpp's test (which page each of these two rows lives on).
  const invLive = !d.ouHeldOver && inv != null;
  const ctLive  = cts.length > 0 && ct > 0;
  d.pel = ctLive ? ct * 230 / 1000 : invLive ? inv * 230 / 1000 : null;
  // NULL when neither source is usable — the third state the old two-way expression could not say.
  // It is what decides the COP's SCOPE below, so "no source" must not read as "the inverter".
  d.pelSrc = ctLive ? "CT" : invLive ? "INV" : null;
  // Why the pill is blank, when it is: the INV source EXISTS but is frozen, which is a different
  // statement from "this profile has no current sensor" (the sub-label's other empty case) — so the
  // sub-label stays silent here and the explainer says which of the two it is.
  d.pelHeld = d.pel == null && d.ouHeldOver && inv != null;
  // ── WHICH COP this quotient is, and when it is none ─────────────────────────────────────────
  // Transcribed from logic/cop_scope.hpp's cop_plan() — same branches, same order, so a change
  // there is visibly a change here (test_cop_scope gates the rule against the whole catalog).
  //
  // The two electrical sources sit on different SYSTEM BOUNDARIES: the CT clamps see the whole unit
  // including both resistive heaters, "INV primary current" only the compressor. The heat side above
  // is the PRE-BUH outlet (lwtRow) — heat from the heat pump's own exchanger, with the heaters
  // deliberately not credited to it. Divide a whole-unit denominator into that numerator and a
  // heater's kilowatts land in the divisor while its heat never reaches the dividend: the quotient
  // collapses, and reads as a failing heat pump while nothing at all is wrong.
  //
  // The two heaters are NOT the same problem. The BUH sits in the space-heating flow between R1T and
  // R2T, so moving the NUMERATOR downstream of it re-pairs the boundaries. The BSH is the immersion
  // heater inside the DHW tank: it heats tank water directly, downstream of the flow sensor and of
  // both leaving-water sensors, so no row in the profile would re-pair them and the only honest
  // answer is to state nothing. d.pth itself is untouched throughout — its own pill states the heat
  // pump's output and that is what it must keep saying.
  const pbRow  = postBuhRow();
  const pbT    = pbRow ? parseFloat(pbRow.value) : NaN;
  // The row must also have a usable number and a return temperature to pair with, or it cannot
  // carry the boundary — fall through to the no-row branch, which blocks while the heater fires.
  const pbOk   = pbRow != null && Number.isFinite(pbT) && d.ret != null;
  const buhKnown = d.buh1 != null || d.buh2 != null;
  const buhOn    = d.buh1 === true || d.buh2 === true;
  // UNKNOWN is not OFF, for either heater. Off is the permissive branch, so guessing it is exactly
  // what would ship the collapsed quotient — the mirror of ou_stale's "unknown rps is not stopped".
  const heaterQuiet = buhKnown && !buhOn;
  const tankQuiet   = d.bsh != null && d.bsh !== true;
  if (d.pelSrc == null)      { d.copScope = null;    d.copBlock = "no_pel";     d.copPostBuh = false; }
  else if (d.pelSrc === "INV") { d.copScope = "hp";  d.copBlock = null;         d.copPostBuh = false; }
  // Checked before the numerator is picked: no choice of row answers the tank heater, so claiming
  // one would imply a pairing that does not exist.
  else if (!tankQuiet)       { d.copScope = "plant"; d.copBlock = "tank_heater"; d.copPostBuh = false; }
  else if (pbOk)             { d.copScope = "plant"; d.copBlock = null;         d.copPostBuh = true;  }
  else                       { d.copScope = "plant"; d.copBlock = heaterQuiet ? null : "buh_no_r2t";
                               d.copPostBuh = false; }
  // The COP's own heat figure: the same formula as d.pth, across whichever outlet the scope needs.
  const copDt = d.copPostBuh ? pbT - d.ret : d.dt;
  d.copPth = d.flow != null && copDt != null ? d.flow / 60 * 4.186 * copDt : null;
  const running = (d.rps ?? 0) > 5 && (d.dt ?? 0) > 0.5;
  d.cop = running && d.copBlock == null && d.copPth != null && d.pel != null && d.pel > 0.2
    ? d.copPth / d.pel : null;

  // ── X10A down: let the SECOND stack carry what it can ────────────────────────────────────────
  // Only the quantities the HomeHub actually measures, resolved through the concept the firmware
  // paired them on — never a guess, and never a stale X10A number left standing. Everything else
  // stays null and blanks, which is the honest shape of this state: the HomeHub knows about a dozen
  // registers where X10A knows a hundred, so the drawing becomes visibly sparse. `mbFields` records
  // which pills are Modbus-sourced so renderLive can mark them.
  if (x10aDown() && mbLive()) {
    // EVERY field this snapshot took from X10A is dropped, and it is a KEEP list rather than a drop
    // list — that direction is the point. A drop list is a hand-maintained enumeration of things to
    // forget, and it had already fallen behind the snapshot it was written against: `bsh`, `defrost`
    // and `quiet` stayed exactly as the last X10A cycle left them, so a cable pulled mid-defrost
    // latched the reversing animation and the heater glow onto a drawing whose data was minutes old
    // — and `buh1`/`buh2` were set to `false`, which asserts "the backup heater is OFF" about a
    // state nobody can currently read, where the honest value is "unknown". The paired MEASUREMENTS
    // had the same hole from the other side: `take()` only assigns when the gateway answered, so a
    // register it failed to read left the retained X10A number in place, live-looking.
    //
    // Written this way a field added to liveData() is dropped by DEFAULT, so the failure mode is a
    // missing reading rather than a stale one presented as current.
    //
    // The three plant STATES survive, because they are no longer X10A values: stateOf() already
    // refused the retained X10A bit and returned the gateway's (or nothing). Clearing them here is
    // what used to blank the pump and the demand next to readings that were arriving.
    const KEEP = new Set(["pumpOn", "valveDhw", "spaceH", "sgMode", "mbFields"]);
    Object.keys(d).forEach((k) => { if (!KEEP.has(k)) d[k] = null; });
    d.ouHeldOver = false;         // nothing to hold over: the whole bus is silent, not one unit
    MB_PAIRS.forEach((p) => takeMb(p.fld, p.cid));
    // The HomeHub MEASURES the electrical input; X10A has no such row and the dashboard estimates it
    // from CT clamps at an assumed 230 V. So on this path the figure is better than usual, and it is
    // marked as measured rather than estimated.
    //
    // Addressed by its EKRHH OFFSET, never by its unit. THREE rows in the map carry "kW" — the
    // measured consumption at input 51 and the two power-LIMIT setpoints at holding 57/58 — so a
    // first-match on the unit promoted a configured ceiling to the plant's measured draw the moment
    // 51 was unavailable or answered a sentinel. A limit is a number the installer typed; drawing it
    // as a measurement is the #35-#39 shape wearing a plausible value, and the Modbus card would go
    // on labelling it correctly one card below.
    const pw = mbPower();
    if (pw) { const n = parseFloat(pw.value);
              if (Number.isFinite(n)) { d.pel = n; d.pelSrc = "MB"; d.mbFields.add("pel"); } }
    // ΔT and heat output survive: both sides of each come from the gateway's own hydronic readings,
    // so nothing is mixed across two boundaries.
    d.dt = (d.lwt != null && d.ret != null) ? d.lwt - d.ret : null;
    d.dtStale = !(d.flow != null && d.flow > 1);
    d.pth = (!d.dtStale && d.flow != null && d.dt != null) ? d.flow / 60 * 4.186 * d.dt : null;
    // THE COP DOES NOT. It looks like the same arithmetic and is not: the gateway's power is the
    // WHOLE UNIT's, backup heater and immersion heater included, while d.pth is heat across the
    // plate exchanger alone. That is precisely the boundary mismatch logic/cop_scope.hpp exists to
    // refuse — a quotient of two correct numbers describing two different systems, which collapses
    // exactly when a heater fires and reads as a failing heat pump while nothing is wrong. On the
    // X10A path cop_scope decides it from the BUH/BSH states and the post-BUH row; the gateway map
    // carries neither, so there is nothing to decide it WITH, and the honest answer is the one this
    // firmware gives everywhere else: publish nothing (feature_gate.hpp — disable, never degrade).
    // A circulation-only quotient would be the other half of the same problem.
    d.cop = null;
    d.copScope = null;
    d.copBlock = "mb_scope";      // named, so the explainer says WHY rather than showing a bare "—"
    d.copPostBuh = false;
    ["dt", "pth"].forEach((k) => { if (d[k] != null) d.mbFields.add(k); });
  }
  return d;
}

// Every value pill in the schematic, so a lost link can blank the whole drawing in one pass. The
// SVG now stays on screen when the bus goes quiet (it holds the status block — see renderLive), so
// leaving the last readings in place would assert values nobody is measuring any more.
const SCHEM_PILL_IDS = [
  "svOut", "svRps", "svHp", "svLp", "svDisch", "svEev", "svLwt", "svRwt", "svDt",
  "svFlow", "svWp", "svPump", "svTank", "svTankSet", "svRoom", "svRoomSet", "svPth", "svCop", "svPel",
];
// A held outdoor-unit row has no current X10A value. It may still have a current replacement from
// the independent Modbus stack; mbFields is the proof that `n` is that replacement, not the retained
// X10A cache. Shared by outdoor air and discharge so they cannot drift into two held-over policies.
const ouReadingText = (d, key, n, fmt) =>
  d.ouHeldOver && !(d.mbFields && d.mbFields.has(key)) ? "—" : fmt(n);

// A conditional SVG badge is either an interactive control or absent — never an invisible link.
// CSS visibility alone is insufficient because an SVG descendant with `pointer-events:all` may
// still receive a click. Keep pointer suppression (CSS), keyboard order and the accessibility tree
// on one explicit state. The markup starts unavailable so there is no clickable boot-time window.
function setSchematicHitAvailable(id, available) {
  const hit = $(id);
  if (!hit) return;
  hit.setAttribute("tabindex", available ? "0" : "-1");
  if (available) hit.removeAttribute("aria-hidden");
  else hit.setAttribute("aria-hidden", "true");
}

function clearSchematic() {
  SCHEM_PILL_IDS.forEach((id) => setTxt(id, "—"));
  setTxt("svBuh", "");                 // no BUH step to report
  setTxt("svValve", "3WV");            // valve position unknown — don't claim a branch
  const sc = $("schem");
  ["fan-on", "pump-on", "buh-on", "bsh-on", "defrost-on", "quiet-on", "sg-boost-on"].forEach((c) => sc.classList.remove(c));
  setSchematicHitAvailable("gBshState", false);
  setTxt("svSgRequest", "");
  sc.classList.add("no-spaceh");       // no flag to show; the pill would otherwise sit stale
  $("schem").querySelectorAll(".sc-flow, .sc-rflow").forEach((el) => el.classList.remove("on", "rev"));
}

function renderLive() {
  // The readings were decoded once in renderDashboard (S.live, null when the link is down or no
  // value has arrived). The status block above and this drawing therefore render from the SAME
  // snapshot and cannot disagree about whether the plant is running. The inspector reads it too, so
  // an open explainer follows the live values.
  const d = S.live;
  // Mark every pill this cycle drew from the Modbus stack, and unmark the rest. Done in ONE pass over
  // the known pill set rather than per setTxt, so a pill that stops being Modbus-sourced cannot keep
  // the colour from a previous cycle.
  const mbf = (d && d.mbFields) || new Set();
  // The six paired pills come from MB_PAIRS; the four DERIVED ones have no register and so no
  // concept — they are marked because their inputs were (liveData adds them to mbFields).
  const MB_PILL = { ...Object.fromEntries(MB_PAIRS.map((p) => [p.fld, p.pill])),
                    pel: "svPel", dt: "svDt", pth: "svPth", cop: "svCop" };
  Object.keys(MB_PILL).forEach((k) => {
    const el = $(MB_PILL[k]);
    if (el && el.closest("text")) el.closest("text").classList.toggle("sc-mb", mbf.has(k));
  });
  // Nothing hides when the link drops: the schematic carries the status block (mode / fault /
  // "no data"), which is exactly what must survive a dead bus. Every pill blanks to "—" and every
  // animation stops instead, so the drawing shows an idle plant with no readings, not a stale one.
  if (!d) { clearSchematic(); renderInspect(); return; }

  // Bit-flag states, each drawn at the component it belongs to: the space-heating demand on the
  // heating riser, the BUH step in the BUH label, low-noise mode on the outdoor unit. (Pump and
  // defrost were already drawn — rotation + "PUMP n%", the ❄ pill + the reversed refrigerant loop.)
  const pumping = d.pumpOn ?? (d.flow != null ? d.flow > 1 : null);
  setTxt("svSpaceH", t(d.spaceH ? "chip.demand_on" : "chip.demand_off"));
  $("gSpaceH").classList.toggle("on", d.spaceH === true);
  // A non-breaking space: SVG collapses ordinary leading whitespace in a tspan, which would render
  // the step glued to the label ("BUH2").
  setTxt("svBuh", d.buh2 ? "\u00A02" : d.buh1 ? "\u00A01" : "");

  // Schematic badges
  // Outdoor air + discharge come off the pages the outdoor unit stops refreshing when it stops
  // running (d.ouHeldOver): never assert the retained X10A number as current. Outdoor air may instead
  // carry the independent HomeHub measurement (`mbFields.out`); discharge has no such pairing and
  // keeps the ordinary "—". Petrol makes the replacement source visible without adding a caption.
  setTxt("svOut", ouReadingText(d, "out", d.out, fmt1)); setTxt("svRps", fmt0(d.rps));
  // High-side badge shows the circuit pressure (real refrigerant sensor when the compressor's own HP
  // transducer is idle-zero — see d.circP). Low/suction side has no equivalent at-rest gauge, so show
  // "—" rather than a misleading 0.0 bar when the compressor is off.
  setTxt("svHp", fmt1(d.circP));
  setTxt("svLp", !d.ouHeldOver && d.lp != null && d.lp > 0 ? fmt1(d.lp) : "—");
  setTxt("svDisch", ouReadingText(d, "disch", d.disch, fmt0)); setTxt("svEev", fmt0(d.eev));
  setTxt("svLwt", fmt1(d.lwt)); setTxt("svRwt", fmt1(d.ret));
  // ΔT only means something with water moving (d.dtStale, decided in liveData so the explainer
  // gates on the very same fact). Same reasoning as the derived kW/COP, which already gate.
  setTxt("svDt", d.dtStale ? "—" : fmt1(d.dt)); setTxt("svFlow", fmt1(d.flow));
  setTxt("svWp", fmt1(d.wp)); setTxt("svPump", fmt0(d.pump));
  setTxt("svTank", fmt1(d.tank)); setTxt("svTankSet", fmt1(d.tankSet));
  setTxt("svRoom", fmt1(d.room)); setTxt("svRoomSet", fmt1(d.roomSet));
  // Blanks with the ΔT it is computed from (d.dtStale) — the pill two places to its left already
  // refuses to state that difference, and a product of a refused figure is the same split the ΔT
  // comment above warns about. The zero is arithmetically true (flow 0 carries nothing) and reads
  // as a measured plant output anyway: with the tank heater firing, "≈ 0.0 kW" sat beside a tank
  // climbing at ~2.7 kW. No working point is not an output of zero. Note this gates the LIVE pill
  // only, not the 24-hour curve (DERIVED.pth): there a flat zero is the honest shape of a day that
  // delivered nothing, and a gap would be indistinguishable from missing data.
  setTxt("svPth", d.dtStale ? "—" : fmt1(d.pth));   // derived — the pill carries "≈" + an "est." sub-label
  // THREE-VALUED, and that is the whole fix. `d.valveDhw === true` collapsed "I cannot read the
  // valve" into "heating", which is a positive claim: with X10A silent during a DHW run the drawing
  // routed the water round the radiators while the plant was charging the tank (compared against the
  // live X10A board, which showed the diverter on the tank in the same minute). Unknown now prints
  // the bare "3WV" that clearSchematic() already uses and animates NEITHER branch.
  const toDhw = d.valveDhw;                       // true | false | null(unknown)
  setTxt("svValve", toDhw == null ? "3WV" : t(toDhw ? "schem.to_dhw" : "schem.to_heat"));

  // Schematic state classes drive the CSS animations (flows, fan, pump, BUH glow, defrost)
  const sc = $("schem");
  const rpsOn = (d.rps ?? 0) > 0;
  sc.classList.toggle("fan-on", rpsOn && d.defrost !== true);
  sc.classList.toggle("pump-on", pumping === true);
  sc.classList.toggle("buh-on", !!(d.buh1 || d.buh2));
  const bshActive = d.bsh === true;
  sc.classList.toggle("bsh-on", bshActive);
  setSchematicHitAvailable("gBshState", bshActive);
  sc.classList.toggle("defrost-on", d.defrost === true);
  sc.classList.toggle("quiet-on", d.quiet === true);
  // Mode 2 is evcc's boost / Daikin's Recommended on. The compact marker says only that, without
  // repeating the Modbus source or implying that DHW is already running. Every non-boost state has
  // no drawing label; its exact manufacturer name remains available in the HomeHub row.
  setTxt("svSgRequest", sgRequestText(d.sgMode));
  sc.classList.toggle("sg-boost-on", d.sgMode === 2);
  // A BSH row is itself evidence that this profile has a DHW tank, even if its temperature did not
  // answer in this snapshot. Keep the branch visible so the active heater cannot disappear with it.
  sc.classList.toggle("no-dhw", d.tank == null && d.bsh == null);
  sc.classList.toggle("no-room", d.room == null);
  sc.classList.toggle("no-pth", d.pth == null);
  sc.classList.toggle("no-spaceh", d.spaceH == null);
  const onCls = (id, on) => $(id).classList.toggle("on", !!on);
  onCls("fSup1", pumping); onCls("fSup2", pumping); onCls("fSup3", pumping); onCls("fRet", pumping);
  // Each branch needs the valve to SAY so — `!toDhw` was true for an unknown valve, which is how the
  // heating branch came to animate on no evidence at all.
  const dhwPath = pumping && toDhw === true, heatPath = pumping && toDhw === false;
  onCls("fTank", dhwPath); onCls("fCoil", dhwPath); onCls("fTankRet", dhwPath);
  onCls("fHeat", heatPath); onCls("fHeatRet", heatPath);
  onCls("rfHot", rpsOn); onCls("rfCold", rpsOn);
  $("rfHot").classList.toggle("rev", d.defrost === true);   // defrost reverses the refrigerant loop
  $("rfCold").classList.toggle("rev", d.defrost === true);

  // The derived figures that used to live in KPI tiles below the drawing, now at their place in it:
  // COP beside the heat output it is computed from, and the electrical input on the outdoor unit
  // where the power actually goes in.
  // What is NOT drawn: their longer annotations. The ΔT's target and the electrical figure's source
  // are in the inspector. The compact "≈" still matters in the closed drawing, but only for X10A's
  // current×230 V estimate; the HomeHub register is a measurement and pelApproxText removes it.
  setTxt("svCop", d.cop == null ? "—" : d.cop.toFixed(1));
  setTxt("pelApprox", pelApproxText(d));
  setTxt("svPel", fmt1(d.pel));

  renderInspect();     // keep an open explainer's reading/state sentence current
}

// ── Schematic inspector: tap a pill or a component → what it is, what's normal, what it's doing ──
// The point of the diagram is to be explorable: every hit target in the SVG (data-insp) maps to one
// INSPECT entry here. Two kinds of entry, one renderer:
//   • a VALUE (a pill) — `re` finds its live /values row for the reading and the source label, and
//     `sample` (a canonical register label) resolves the explainer text out of DESCRIPTIONS. The
//     explainer copy therefore has ONE source: the same table the value list below the diagram uses.
//     `sample` is matched instead of the live label on purpose — the pill draws a CONCEPT, and a
//     profile's own spelling of it could match a neighbouring DESCRIPTIONS entry.
//   • a COMPONENT (outdoor unit, PHE, heating circuit, …) — carries its own `what` (nothing in
//     DESCRIPTIONS describes an assembly) plus `now(d)`, a sentence built from the live values that
//     says what the part is doing right now, and `rows`, the readings that belong to it.
// Copy is bilingual like DESCRIPTIONS ({en, de}); `now` returns the same shape.
const tx = (o) => (o == null ? "" : typeof o === "string" ? o : (LANG === "de" && o.de) ? o.de : o.en);
const degC = (n) => (n == null ? "—" : fmt1(n) + " °C");

// X10A has no dedicated BSH-power register. Some profiles do expose the unit's CT clamp currents;
// liveData turns those into an estimated WHOLE-UNIT input at assumed 230 V. Show that useful context
// only while BSH is active and CT is the source — never substitute the inverter current (compressor
// only), and never label the total as heater power because pumps/electronics may be part of it too.
const bshInputRow = () => {
  const d = S.live;
  if (!d || d.bsh !== true || d.pel == null || d.pelSrc !== "CT") return null;
  return {
    label: tx({
      en: "Whole-unit electrical input (from CT, estimated)",
      de: "Geschätzte elektrische Gesamtaufnahme · CT",
    }),
    value: "≈ " + fmt1(d.pel),
    unit: "kW",
  };
};

const PEL_ESTIMATED_WHAT = {
  en: "A rough electrical-input ESTIMATE used as the COP divisor. The UI adds available phase currents and multiplies by an assumed 230 V; it does not know actual voltage or power factor. CT currents are treated as the whole-unit boundary, while inverter current covers the compressor side only. Therefore an inverter-based value is not total plant consumption and does not include a backup heater.",
  de: "Eine grobe SCHÄTZUNG der elektrischen Aufnahme und der Nenner des COP. Die UI addiert verfügbare Phasenströme und multipliziert sie mit angenommenen 230 V; tatsächliche Spannung und Leistungsfaktor sind unbekannt. CT-Ströme behandelt sie als Systemgrenze des ganzen Geräts, der Inverterstrom deckt nur die Verdichterseite ab. Ein Inverterwert ist daher nicht der Gesamtverbrauch der Anlage und enthält den Zusatzheizer nicht.",
};
const PEL_MEASURED_WHAT = {
  en: "The unit's electrical input, MEASURED by the HomeHub. Unlike X10A's current×230 V estimate, this value needs no assumed voltage or power-factor approximation. It covers the whole unit, including an active backup or tank heater; the dashboard therefore does not derive a COP from it because the available heat measurement covers only the heat-pump exchanger.",
  de: "Die elektrische Leistungsaufnahme der Anlage, vom HomeHub GEMESSEN. Anders als die X10A-Schätzung aus Strom×230 V benötigt dieser Wert keine angenommene Spannung oder Leistungsfaktor-Näherung. Er umfasst die ganze Anlage einschließlich eines aktiven Zusatz- oder Speicherheizstabs; das Dashboard berechnet daraus deshalb keinen COP, weil die verfügbare Wärmemessung nur den Wärmepumpen-Wärmetauscher umfasst.",
};
const pelMeasured = (d) => !!d && d.pelSrc === "MB";
const pelApproxText = (d) => d && d.pel != null && !pelMeasured(d) ? "≈ " : "";
const PEL_INSPECT = {
  t: (d) => pelMeasured(d)
    ? { en: "Electrical input (measured)", de: "Gemessene Stromaufnahme" }
    : { en: "Electrical input (estimated)", de: "Geschätzte Stromaufnahme" },
  aria: { en: "Electrical input", de: "Stromaufnahme" },
  trend: "pel",
  what: (d) => pelMeasured(d) ? PEL_MEASURED_WHAT : PEL_ESTIMATED_WHAT,
  head: (d) => (d.pel == null ? "—" : pelApproxText(d) + fmt1(d.pel) + " kW"),
  // Four cases: the measured gateway row, either X10A current source, a held-over inverter row, or
  // no usable electrical source. Keeping this source-aware prevents a HomeHub measurement from
  // being explained as compressor current merely because it is not a CT estimate.
  now: (d) => d.pelHeld
    ? { en: "The compressor is off, so the inverter current this profile reads is left over from the last run rather than measured now — no input power and no COP can be stated.",
        de: "Der Verdichter steht, daher stammt der Inverterstrom dieses Profils vom letzten Lauf und ist kein aktueller Messwert — Leistungsaufnahme und COP lassen sich nicht angeben." }
    : d.pel == null
    ? { en: "No current reading on this profile, so no COP can be derived either.",
        de: "Dieses Profil liefert keinen Strommesswert, daher lässt sich auch kein COP ableiten." }
    : d.pelSrc === "MB"
    ? { en: "Measured at the HomeHub electrical input (whole unit).",
        de: "Am elektrischen Eingang des HomeHub für die gesamte Anlage gemessen." }
    : d.pelSrc === "CT"
    ? { en: "From the CT clamps (whole unit).", de: "Aus den Stromwandlern der gesamten Anlage." }
    : { en: "From the inverter current (compressor only).", de: "Aus dem Inverterstrom des Verdichters." },
  rows: [/current measured by ct/i, /inv primary current/i],
};

const INSPECT = {
  status: {
    t: { en: "Operating mode", de: "Betriebsart" },
    re: /i\/u operation mode/i, sample: "I/U Operation Mode",
    // The source row deliberately keeps Daikin's stable English enum for API/MQTT consumers. The
    // panel is visual UI, just like the schematic headline, and must therefore use the same complete
    // translation instead of exposing "DHW" again after the user opens the explanation.
    head: () => schematicOperationMode(),
    // "Thermostat ON/OFF" belongs HERE, not on the heating riser it used to be drawn on: it is a bit
    // in the very same status byte as the operating mode above it (0x60/2), and it says the indoor
    // unit is asking for the compressor — for hot water just as much as for the house.
    rows: [/i\/u operation mode/i, /thermostat on/i, /(error|fault) code/i],
  },
  sgrequest: {
    t: { en: "Smart-Grid request via Modbus", de: "Smart-Grid-Anforderung über Modbus" },
    what: {
      en: "The external Smart-Grid request read back from the HomeHub: Free running, Forced off, Recommended on or Forced on. It is an energy-management command, not the outdoor unit's heating/cooling mode and not proof that a requested tank charge has started.",
      de: "Die vom HomeHub zurückgelesene externe Smart-Grid-Anforderung: Freier Betrieb, Zwangsabschaltung, Empfehlung ein oder Erzwungen ein. Das ist ein Energiemanagement-Befehl und nicht der Heiz- oder Kühlmodus der Außeneinheit. Ebenso wenig belegt er, dass eine angeforderte Speicherladung bereits begonnen hat.",
    },
    head: (d) => sgModeText(d && d.sgMode),
    now: (d) => !d || d.sgMode == null
      ? { en: "No current Smart-Grid value is available from the HomeHub.",
          de: "Vom HomeHub ist gerade kein aktueller Smart-Grid-Wert verfügbar." }
      : d.sgMode === 2
      ? { en: "The HomeHub reports Recommended on. This is the Smart-Grid state energy managers such as evcc use for boost. It requests extra buffering; DHW mode, the 3-way valve and flow separately show whether the unit is actually charging the tank.",
          de: "Der HomeHub meldet Empfehlung ein. Diesen Smart-Grid-Zustand verwenden Energiemanager wie evcc als Boost. Er fordert zusätzliches Puffern an; Warmwasser-Betriebsart, 3-Wege-Ventil und Durchfluss zeigen separat, ob die Anlage den Speicher tatsächlich lädt." }
      : d.sgMode === 1
      ? { en: "The external energy manager reports Forced off.",
          de: "Das externe Energiemanagement meldet Zwangsabschaltung." }
      : d.sgMode === 3
      ? { en: "The external energy manager reports Forced on.",
          de: "Das externe Energiemanagement meldet Erzwungen ein." }
      : { en: "No external Smart-Grid request is present; the unit is running autonomously.",
          de: "Es liegt keine externe Smart-Grid-Anforderung vor; die Anlage arbeitet selbstständig." },
  },
  ou: {
    t: { en: "Outdoor unit", de: "Außeneinheit" },
    what: {
      en: "The heat-source side shown for an air-source system. The fan moves outdoor air across the coil; refrigerant absorbs heat there and the compressor raises its pressure and temperature before heat is transferred to the water circuit. Monobloc, ground-source and hybrid systems have a different physical layout, so this is a simplified flow diagram rather than a model-specific piping plan.",
      de: "Die hier für eine Luft/Wasser-Anlage gezeigte Wärmequellenseite. Der Ventilator führt Außenluft über den Wärmetauscher; dort nimmt das Kältemittel Wärme auf. Der Verdichter erhöht anschließend Druck und Temperatur, bevor die Wärme an den Wasserkreis übergeht. Monoblock-, Sole- und Hybridanlagen sind physisch anders aufgebaut; die Darstellung ist deshalb ein vereinfachtes Fließbild und kein modellspezifischer Rohrplan.",
    },
    now: (d) => d.defrost
      ? { en: "Defrosting — the circuit is running in reverse to melt ice off the evaporator, so heat is briefly taken back out of the heating water.",
          de: "Abtauen — der Kreis läuft rückwärts, um den Verdampfer abzutauen; dabei wird dem Heizwasser kurzzeitig wieder Wärme entzogen." }
      : (d.rps ?? 0) > 0
        ? { en: `Running — compressor at ${fmt0(d.rps)} rps${d.quiet ? ", capped by quiet mode" : ""}.`,
            de: `Läuft — Verdichter mit ${fmt0(d.rps)} rps${d.quiet ? ", durch den Leise-Modus begrenzt" : ""}.` }
        // Says why held X10A readings are not repeated at rest (logic/ou_stale.hpp). A structurally
        // paired live HomeHub outdoor reading may replace the held value; unpaired fields stay "—".
        : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
          ? { en: "Idle — the compressor is stopped, so no heat is being produced. X10A stops refreshing the outdoor unit's own sensors while it rests; outdoor air is therefore shown from the live HomeHub measurement, while discharge temperature remains \"—\".",
              de: "Standby — der Verdichter steht, es wird gerade keine Wärme erzeugt. X10A aktualisiert die eigenen Sensoren der Außeneinheit im Stillstand nicht mehr; die Außentemperatur stammt deshalb aus der aktuellen HomeHub-Messung, die Heißgastemperatur bleibt „—“." }
          : { en: "Idle — the compressor is stopped, so no heat is being produced. The outdoor unit also stops refreshing its own sensors while it rests, so outdoor air and discharge temperature read \"—\" rather than repeat the last run's values.",
              de: "Standby — der Verdichter steht, es wird gerade keine Wärme erzeugt. Die Außeneinheit aktualisiert im Stillstand auch ihre eigenen Sensoren nicht mehr; Außenluft und Heißgastemperatur zeigen daher „—“ statt die Werte des letzten Laufs zu wiederholen." },
    rows: [/outdoor air/i, /inv frequency/i, /^high pressure$/i, /discharge pipe temp/i, /expansion valve ?1/i, /defrost operation/i],
  },
  comp: {
    t: { en: "Compressor", de: "Verdichter" },
    re: /inv frequency/i, sample: "INV frequency (rps)",
    rows: [/inv frequency/i, /inv primary current/i, /discharge pipe temp/i],
  },
  out: { t: { en: "Outdoor air", de: "Außentemperatur" }, re: /outdoor air/i, sample: "Outdoor Air Temp. (R1T)" },
  // ── One pill, one reading, one entry ──────────────────────────────────────────────────────────
  // The high side and the low side used to be ONE pill each carrying two readings ("28.4 bar ·
  // 71.2 °C"), and one entry explaining the pair. Split into separate pills, each needs its own
  // entry: the headline, the source line and the DESCRIPTIONS copy all resolve from the entry's own
  // row, so a shared entry would answer a tap on the temperature pill with a bar headline and the
  // pressure row's name under it — a number attributed to the wrong sensor, in the panel whose job
  // is to say which sensor it came from. Each still lists the other as a member row, since they do
  // describe one point in the circuit.
  hp: {
    // The pill draws d.circP — the compressor's own HP transducer while it runs, the always-live
    // refrigerant sensor at rest — so the headline must resolve THE SAME row, not the HP row on
    // principle. Reading the HP row here showed the idle unit's stale/zero bar next to a pill
    // reading the real equalised pressure, and named a source the number had not come from.
    pick: () => (S.live ? S.live.circPRow : null),
    t: { en: "High pressure", de: "Hochdruck" },
    sample: "High pressure",
    rows: [/^high pressure$/i, /^refrigerant pressure sensor$/i, /discharge pipe temp/i],
  },
  disch: {
    t: { en: "Discharge temperature", de: "Heißgastemperatur" },
    re: /discharge pipe temp/i, sample: "Discharge pipe temp.",
    rows: [/discharge pipe temp/i, /^high pressure$/i],
  },
  // Both readings belong to the OUTDOOR unit, not to the liquid line they are drawn on: the
  // expansion valve is fitted there, and the low pressure is what exists downstream of it. They sit
  // at this end of the pipe because that is where the valve is — naming it "suction side" implied
  // the pipe itself was the suction leg, which it is not (see rcold).
  lp: {
    t: { en: "Low pressure", de: "Niederdruck" },
    what: {
      en: "Refrigerant pressure on the low-pressure side of the compressor. In heating, this is the evaporating side after expansion. Not every supported profile exposes a low-pressure transducer; the value stays \"—\" when no usable reading is available.",
      de: "Kältemitteldruck auf der Niederdruckseite des Verdichters. Im Heizbetrieb ist das die Verdampferseite nach der Entspannung. Nicht jedes unterstützte Profil liefert einen Niederdruckgeber; ohne nutzbaren Messwert bleibt die Anzeige „—“.",
    },
    re: /^low pressure$/i, sample: "Low pressure",
    rows: [/^low pressure$/i, /expansion valve ?1/i],
  },
  eev: {
    t: { en: "Expansion valve", de: "Expansionsventil" },
    re: /expansion valve ?1/i, sample: "Expansion valve 1 (pls)",
    rows: [/expansion valve ?1/i, /^low pressure$/i],
  },
  phe: {
    t: { en: "Plate heat exchanger", de: "Plattenwärmetauscher" },
    what: {
      en: "The plate heat exchanger transfers heat between refrigerant and the water circuit without mixing the two fluids. The displayed heat output is estimated from water flow and the temperature difference across this exchanger.",
      de: "Der Plattenwärmetauscher überträgt Wärme zwischen Kältemittel und Wasserkreis, ohne dass sich beide Medien vermischen. Die angezeigte Wärmeleistung wird aus Wasserdurchfluss und Temperaturdifferenz über diesem Wärmetauscher geschätzt.",
    },
    // With the pump stopped the ΔT is not a small working point, it is none at all (d.dtStale) — so
    // this says nothing is crossing, rather than quoting the two stagnant sensors' difference as if
    // it were driving a heat flow.
    now: (d) => d.dtStale
      ? { en: "Nothing crossing — the pump is stopped, so no water is carrying heat away from the plates.",
          de: "Kein Übergang — die Pumpe steht, es trägt kein Wasser Wärme von den Platten ab." }
      : d.pth == null
      ? { en: "No estimate — flow rate or ΔT is missing on this model.",
          de: "Keine Schätzung — Durchfluss oder ΔT fehlt bei diesem Modell." }
      : { en: `About ${fmt1(d.pth)} kW crossing into the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Rund ${fmt1(d.pth)} kW gehen ins Wasser über: ${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K.` },
    rows: [lwtRow, /inlet water/i, /flow sensor/i],
  },
  lwt: {
    t: { en: "Leaving water (pre-BUH, R1T)", de: "Vorlauf vor dem Zusatzheizer · R1T" },
    pick: lwtRow,
    sample: "Leaving Water Temp. before BUH (R1T)",
  },
  rwt: { t: { en: "Return water", de: "Rücklauf" }, re: /inlet water/i, sample: "Inlet Water Temp. (R4T)" },
  dt: {
    t: { en: "ΔT across the system", de: "ΔT über die Anlage" },
    trend: "dt",   // computed series — see DERIVED
    what: {
      en: "Leaving-water temperature minus return-water temperature. It is calculated from two sensor readings, not read from a separate register. Together with flow rate it indicates heat transfer through the active hydraulic circuit; the target depends on model, mode and emitter configuration.",
      de: "Vorlauftemperatur minus Rücklauftemperatur. Der Wert wird aus zwei Fühlern berechnet und nicht aus einem eigenen Register gelesen. Zusammen mit dem Durchfluss beschreibt er die Wärmeübertragung im aktiven Hydraulikkreis; das Ziel hängt von Modell, Betriebsart und eingestellter Heizflächenart ab.",
    },
    // Blanks with the pill (d.dtStale) instead of restating the number the pill withheld, and says
    // why — the pill can only blank, the explainer is where the reason belongs.
    head: (d) => (d.dtStale || d.dt == null ? "—" : fmt1(d.dt) + " K"),
    now: (d) => d.dtStale
      ? { en: "No ΔT right now — the pump is stopped. With no water moving, the two sensors just drift apart as they cool, and their difference is not a working point.",
          de: "Derzeit kein ΔT — die Pumpe steht. Ohne Wasserbewegung driften die beiden Fühler beim Auskühlen nur auseinander; ihre Differenz ist kein Arbeitspunkt." }
      : d.dt == null ? null
      : { en: `${fmt1(d.dt)} K${d.dtSet != null ? ` against a ${fmt1(d.dtSet)} K heating target` : ""}. Compare it with the controller target rather than a universal 5 K rule. A negative value can occur during defrost when heat is taken from the water circuit.`,
          de: `${fmt1(d.dt)} K${d.dtSet != null ? ` bei ${fmt1(d.dtSet)} K Heiz-Ziel` : ""}. Vergleiche den Wert mit dem Reglerziel statt mit einer allgemeinen 5-K-Regel. Beim Abtauen kann er negativ werden, weil dem Wasserkreis Wärme entzogen wird.` },
    rows: [lwtRow, /inlet water/i, /target delta t heating/i],
  },
  pth: {
    t: { en: "Heat output (estimated)", de: "Wärmeleistung (geschätzt)" },
    trend: "pth",
    what: {
      en: "A calculated estimate, not a direct power measurement. The UI uses flow × ΔT × 4.186 kJ/kg·K, assuming water. Accuracy therefore depends on the flow sensor, both temperature sensors and the actual fluid; glycol mixtures need a different density and heat capacity. This pre-BUH figure covers the heat pump's exchanger, not heat added later by the backup heater. It can be negative during defrost because heat is taken from the water circuit.",
      de: "Eine berechnete Schätzung, keine direkte Leistungsmessung. Die UI verwendet Durchfluss × ΔT × 4,186 kJ/kg·K und nimmt dabei Wasser an. Die Genauigkeit hängt deshalb vom Durchflusssensor, beiden Temperaturfühlern und dem tatsächlichen Medium ab; Glykolgemische haben eine andere Dichte und Wärmekapazität. Dieser Wert vor dem BUH erfasst den Wärmepumpen-Wärmetauscher, nicht die später vom Zusatzheizer eingebrachte Wärme. Beim Abtauen kann er negativ werden, weil dem Wasserkreis Wärme entzogen wird.",
    },
    head: (d) => (d.dtStale || d.pth == null ? "—" : "≈ " + fmt1(d.pth) + " kW"),
    // The COP is quoted here only while it is built on THIS figure. With a whole-unit electrical
    // input the quotient moves to the post-BUH outlet (logic/cop_scope.hpp), so it is no longer
    // this pill's number divided by anything — printing it beside this one would attach a plant
    // ratio to a heat-pump-only heat output and invite exactly the boundary mix-up the split
    // exists to prevent. The COP pill states it, with its own scope named.
    //
    // Blanks with the pill (d.dtStale), and — like the pel entry's three cases — says WHICH silence
    // this is. A stopped pump alone is one sentence; a stopped pump while the tank heater fires is
    // a different fact and the one that reads as a broken gauge, because the tank IS being heated
    // while every figure the drawing can reach says nothing is happening. The heater sits inside
    // the tank, past the flow sensor and past both water sensors, so no row on this bus states its
    // power — the same "suppressing one wrong claim must not substitute another" rule the pel and
    // COP explainers follow.
    now: (d) => d.dtStale
      ? (d.bsh === true
          ? { en: "Nothing is crossing the exchanger — the pump is stopped. The tank is still being heated, but by the electric heater inside it, which sits past the flow sensor and both water sensors: no reading on this bus can state its power.",
              de: "Am Wärmetauscher geht nichts über — die Pumpe steht. Der Speicher wird trotzdem beheizt, aber vom Heizstab in ihm; der sitzt hinter dem Durchflusssensor und beiden Wasserfühlern, kein Wert auf diesem Bus kann seine Leistung angeben." }
          : { en: "No heat output right now — the pump is stopped, so no water is carrying heat away from the plates. That is no working point at all rather than an output of zero.",
              de: "Derzeit keine Wärmeleistung — die Pumpe steht, es trägt kein Wasser Wärme von den Platten ab. Das ist gar kein Arbeitspunkt und keine Leistung von null." })
      : d.pth == null ? null
      : { en: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, about ${d.cop.toFixed(1)} kW of heat per kW of electricity (COP)` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; etwa ${d.cop.toFixed(1)} kW Wärme je kW Strom` : ""}.` },
    rows: [/flow sensor/i, /target delta t heating/i, /current measured by ct/i, /inv primary current/i],
  },
  // Its own pill next to the heat output, so its own entry — and the one derived figure with no
  // catalog row behind it at all, hence copy written here rather than pulled from DESCRIPTIONS.
  //
  // The TITLE is live (see inspTitleText), because a COP is not one quantity. Which system the
  // quotient describes follows the electrical source — whole-unit CT clamps give a PLANT COP, the
  // inverter current a HEAT-PUMP one — and the two are different numbers whenever the backup heater
  // runs. They look identical on the pill, so naming which one this is has to happen here or
  // nowhere. The rule and the matching numerator are logic/cop_scope.hpp, gated over the catalog.
  cop: {
    t: (d) => (d && d.copScope === "plant"
      ? { en: "COP of the plant (estimated)", de: "Geschätzter COP der Anlage" }
      : { en: "COP of the heat pump (estimated)", de: "Geschätzter COP der Wärmepumpe" }),
    // The hit target's accessible name — stable, because it is applied once at startup (see
    // labelSchematicHits). Which COP it turns out to be is the panel's to say, not the label's.
    aria: { en: "COP (estimated)", de: "Geschätzter COP" },
    trend: "cop",
    what: {
      en: "Estimated heat output divided by estimated electrical input. Both values must cover the same system boundary: with CT currents the UI uses heat after the backup heater when that sensor exists; with inverter current it shows the heat pump alone. The result inherits the water/glycol, sensor, voltage and power-factor assumptions of both estimates. Daikin also describes calculated energy figures as estimates whose accuracy is not guaranteed. Use this as a live indication; metered seasonal energy is more meaningful. With the compressor stopped it shows \"—\".",
      de: "Geschätzte Wärmeleistung geteilt durch geschätzte elektrische Aufnahme. Beide Werte müssen dieselbe Systemgrenze abdecken: Bei CT-Strömen verwendet die UI die Wärme hinter dem Zusatzheizer, sofern dieser Fühler vorhanden ist; beim Inverterstrom zeigt sie nur die Wärmepumpe. Das Ergebnis übernimmt alle Annahmen zu Wasser oder Glykol, Fühlern, Spannung und Leistungsfaktor aus beiden Schätzungen. Auch Daikin bezeichnet berechnete Energiewerte als Schätzungen ohne garantierte Genauigkeit. Nutze den Wert als Live-Hinweis; aussagekräftiger ist saisonal gemessene Energie. Bei stehendem Verdichter zeigt er „—“.",
    },
    head: (d) => (d.cop == null ? "—" : d.cop.toFixed(1)),
    // Four outcomes, four sentences. A suppressed wrong claim must not be replaced by another one,
    // so "the heater is firing and this profile has no post-BUH sensor" and "there is no current
    // reading at all" cannot share a sentence — they are different facts about the hardware.
    now: (d) => d.copBlock === "tank_heater"
      ? { en: "No COP right now — the tank's electric heater is on. Its power is inside the whole-unit current this COP would divide by, but its heat goes straight into the tank and crosses neither leaving-water sensor, so no measurement here can balance the two. This is not a gap in the profile: there is no reading anywhere on the bus that would.",
          de: "Derzeit kein COP — der Heizstab im Speicher läuft. Seine Leistung steckt im Gesamtstrom, durch den hier geteilt würde, seine Wärme geht aber direkt in den Speicher und passiert keinen der Vorlauffühler; kein Messwert kann die beiden also ausgleichen. Das ist keine Lücke des Profils: auf dem Bus gibt es keinen Wert, der es könnte." }
      : d.copBlock === "buh_no_r2t"
      ? { en: "No COP right now — the backup heater is firing, and the electrical figure covers the whole unit while this profile has no leaving-water sensor after the heater to match it. Dividing the two would compare the heat pump's heat against the whole plant's electricity and understate the result.",
          de: "Derzeit kein COP — der Zusatzheizer heizt, und der Strommesswert erfasst das ganze Gerät, während dieses Profil keinen Vorlauffühler hinter dem Heizer hat, der dazu passt. Beides zu teilen, hielte die Wärme der Wärmepumpe gegen den Strom der ganzen Anlage und fiele zu niedrig aus." }
      : d.cop == null ? null
      : d.copScope === "plant"
      ? { en: `${d.cop.toFixed(1)} kW of heat per kW of electricity for the whole plant — ≈ ${fmt1(d.copPth)} kW out for ≈ ${fmt1(d.pel)} kW in, both counted after the backup heater.`,
          de: `${d.cop.toFixed(1)} kW Wärme je kW Strom für die ganze Anlage — ≈ ${fmt1(d.copPth)} kW raus für ≈ ${fmt1(d.pel)} kW rein, beides hinter dem Zusatzheizer gezählt.` }
      : { en: `${d.cop.toFixed(1)} kW of heat per kW of electricity for the heat pump itself — ≈ ${fmt1(d.copPth)} kW out for ≈ ${fmt1(d.pel)} kW in. The backup heater is outside both figures, so this does not fall when it fires; what the plant as a whole draws is higher.`,
          de: `${d.cop.toFixed(1)} kW Wärme je kW Strom für die Wärmepumpe selbst — ≈ ${fmt1(d.copPth)} kW raus für ≈ ${fmt1(d.pel)} kW rein. Der Zusatzheizer steht außerhalb beider Werte, der COP sinkt also nicht, wenn er heizt; die Anlage insgesamt zieht mehr.` },
    // The numerator's own row, but ONLY while the plan actually uses it (d.copPostBuh) — listing it
    // under a heat-pump COP would name an input that figure never touched. Resolved through the one
    // postBuhRow(), never a second pattern: a looser copy here is exactly how the (R2T) tag would
    // start matching the discharge pipe again. pickRow already takes a function (see its definition).
    rows: [/flow sensor/i, () => (S.live && S.live.copPostBuh ? postBuhRow() : null),
           /current measured by ct/i, /inv primary current/i, /buh step ?1/i, /^bsh$/i],
  },
  buh: {
    t: { en: "Backup heater (BUH)", de: "Zusatzheizer · BUH" },
    re: /buh step ?1/i, sample: "BUH step 1",
    now: (d) => (d.buh1 == null && d.buh2 == null) ? null
      : d.buh2 ? { en: "Step 2 — both stages firing.", de: "Stufe 2 — beide Stufen heizen." }
      : d.buh1 ? { en: "Step 1 — one stage firing.", de: "Stufe 1 — eine Stufe heizt." }
      : { en: "Off — no backup-heater stage is active.", de: "Aus — keine Zusatzheizerstufe ist aktiv." },
    rows: [/buh step ?1/i, /buh step ?2/i, /buh output capacity/i],
  },
  bsh: {
    t: { en: "Electric tank heater", de: "Heizstab" },
    re: /^bsh$/i, sample: "BSH",
    // Replace the raw bit (1/0) in the headline with its actual meaning. The source line remains
    // "BSH", so the friendly state is still traceable to the exact X10A register.
    head: (d) => d.bsh == null ? "—" : t(d.bsh ? "state.on" : "state.off"),
    now: (d) => d.bsh == null ? null
      : d.bsh
        ? { en: "Electric tank heater active.", de: "Heizstab aktiv." }
        : { en: "Off — the tank is not using its electric immersion heater.",
            de: "OFF — der Heizstab im Speicher ist nicht aktiv." },
    rows: [() => bshInputRow()],
  },
  valve: {
    t: { en: "3-way valve", de: "3-Wege-Ventil" },
    re: /3.?way valve/i, sample: "3-way valve (On:DHW/Off:Space)",
    now: (d) => d.valveDhw == null ? null
      : d.valveDhw ? { en: "Diverted to the hot-water tank — space heating is paused meanwhile.",
                       de: "Auf den Warmwasserspeicher geschaltet — die Raumheizung pausiert solange." }
                   : { en: "Diverted to the heating circuit.", de: "Auf den Heizkreis geschaltet." },
  },
  tank: {
    t: { en: "DHW tank / thermal store", de: "Warmwasser-/Wärmespeicher" },
    re: /dhw tank temp/i, sample: "DHW Tank Temp. (R5T)",
    // The tank box represents a GROUP even though its temperature is also the compact headline.
    // Keep every member in the one table below the chart; neither the Modbus twin nor a sentence
    // repeating tank + setpoint belongs inside the explanatory prose above it.
    listAllValues: true,
    rows: [/dhw tank temp/i, /dhw setpoint/i, /3.?way valve/i],
  },
  heat: {
    t: { en: "Heating circuit", de: "Heizkreis" },
    what: {
      en: "The radiators or underfloor loops in the house. They are fed only while the 3-way valve points here — a hot-water cycle takes priority and pauses them. How fast they give heat off depends on flow temperature and emitter size, which is why underfloor runs cooler than radiators.",
      de: "Die Heizkörper bzw. Fußbodenkreise im Haus. Sie werden nur versorgt, solange das 3-Wege-Ventil hierher zeigt — eine Warmwasserladung hat Vorrang und pausiert sie. Wie schnell sie Wärme abgeben, hängt von Vorlauftemperatur und Heizflächengröße ab; deshalb läuft eine Fußbodenheizung kühler als Heizkörper.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "Paused — the valve is feeding the hot-water tank right now.",
          de: "Pausiert — das Ventil versorgt gerade den Warmwasserspeicher." }
      : (d.pumpOn ?? (d.flow != null && d.flow > 1))
        ? { en: `Being fed at ${degC(d.lwt)} flow${d.spaceH === false ? ", though space heating is not being called for" : ""}.`,
            de: `Wird mit ${degC(d.lwt)} Vorlauf versorgt${d.spaceH === false ? ", obwohl keine Heizungsanforderung ansteht" : ""}.` }
        : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [/^indoor ambient temp/i, /^rt setpoint/i, /^space heating operation/i],
  },
  // The heating riser's demand pill. Its member rows are the room's controlled variable and its
  // target — what a demand for THIS branch is derived from — and NOT "Thermostat ON/OFF", which
  // belongs to the indoor unit as a whole and now sits under `status` where that byte lives.
  spaceh: {
    t: { en: "Space-heating demand", de: "Heizungsanforderung" },
    re: /^space heating operation/i, sample: "Space heating Operation ON/OFF",
    rows: [/^space heating operation/i, /^indoor ambient temp/i, /^rt setpoint/i],
  },
  room: {
    t: { en: "Room temperature", de: "Raumtemperatur" },
    re: /^indoor ambient temp/i, sample: "Indoor Ambient Temp. (R1T)",
    rows: [/^indoor ambient temp/i, /^rt setpoint/i],
  },
  pump: {
    t: { en: "Circulation pump", de: "Umwälzpumpe" },
    what: {
      en: "Circulates water through the active hydraulic circuit. In the split-system layout shown, it is on the supply side after the plate heat exchanger and backup heater. The controller adjusts its speed according to operating mode, target ΔT and minimum-flow requirements.",
      de: "Fördert Wasser durch den aktiven Hydraulikkreis. Im gezeigten Split-System-Aufbau sitzt sie im Vorlauf hinter Plattenwärmetauscher und Zusatzheizer. Der Regler passt ihre Drehzahl an Betriebsart, Ziel-ΔT und Mindestdurchfluss an.",
    },
    re: /water pump operation/i, sample: "Water pump operation",
    // 0 % is a stopped pump, not a pump "running at 0 %" — the old wording asserted circulation on
    // an idle plant, next to a flow pill reading 0.0 l/min.
    now: (d) => d.pump == null ? null
      : d.pump > 0
        ? { en: `Running at ${fmt0(d.pump)} % of full speed, moving ${fmt1(d.flow)} l/min.`,
            de: `Läuft mit ${fmt0(d.pump)} % der vollen Drehzahl und fördert ${fmt1(d.flow)} l/min.` }
        : { en: "Stopped — no water is circulating.", de: "Steht — es zirkuliert kein Wasser." },
    rows: [/water pump signal/i, /flow sensor/i, /^water pressure$/i],
  },
  pel: PEL_INSPECT,
  defrost: {
    t: { en: "Defrost", de: "Abtauen" },
    re: /defrost operation/i, sample: "Defrost Operation",
  },
  quiet: {
    t: { en: "Quiet mode", de: "Leise-Modus" },
    re: /low noise control|silent mode/i, sample: "Low noise control",
  },

  // ── Pipe runs. Each says what is IN it, which way it goes, and whether anything is moving now —
  //    the questions a schematic invites and that no value row answers.
  // The two interconnecting pipes are named for what they CARRY, which is fixed, not for the role
  // they play, which flips with the mode: this is the gas line and the one below is the liquid line
  // in both directions of the cycle. Calling the lower one a "suction line" was wrong in heating —
  // there it holds warm condensed liquid on the HIGH-pressure side, because the expansion valve sits
  // in the outdoor unit at its far end. The suction leg proper never leaves the outdoor unit.
  rhot: {
    t: { en: "Gas line (hot gas in heating)", de: "Gasleitung · Heißgas im Heizbetrieb" },
    what: {
      en: "The gas line between outdoor and indoor units in the split-system layout shown. In heating, hot high-pressure gas leaves the compressor through this line and condenses in the plate heat exchanger, transferring heat to the water. In cooling, refrigerant flow reverses. Monobloc systems do not have this field refrigerant line.",
      de: "Die Gasleitung zwischen Außen- und Inneneinheit im gezeigten Split-System-Aufbau. Im Heizbetrieb strömt heißes Gas unter hohem Druck vom Verdichter durch diese Leitung und kondensiert im Plattenwärmetauscher; dabei gibt es Wärme ans Wasser ab. Im Kühlbetrieb kehrt sich die Kältemittelrichtung um. Monoblock-Anlagen haben diese bauseitige Kältemittelleitung nicht.",
    },
    now: (d) => (d.rps ?? 0) > 0
      ? { en: `Flowing — ${fmt1(d.circP)} bar at ${fmt0(d.disch)} °C.`,
          de: `Durchströmt — ${fmt1(d.circP)} bar bei ${fmt0(d.disch)} °C.` }
      : { en: "Still — the compressor is stopped, so the circuit is at rest and simply equalised.",
          de: "Steht — der Verdichter ist OFF, der Kreis ruht und ist einfach ausgeglichen." },
    rows: [/^high pressure$/i, /discharge pipe temp/i],
  },
  rcold: {
    t: { en: "Liquid line", de: "Flüssigkeitsleitung" },
    what: {
      en: "The liquid line between outdoor and indoor units in the split-system layout shown. In heating, condensed high-pressure refrigerant returns through this line to the outdoor expansion valve. Downstream of that valve its pressure and temperature fall before it absorbs heat in the outdoor coil. In cooling, the direction reverses. Monobloc systems do not have this field refrigerant line.",
      de: "Die Flüssigkeitsleitung zwischen Außen- und Inneneinheit im gezeigten Split-System-Aufbau. Im Heizbetrieb fließt kondensiertes Kältemittel unter hohem Druck durch diese Leitung zum Expansionsventil im Außengerät zurück. Hinter dem Ventil sinken Druck und Temperatur, bevor es im Außenwärmetauscher Wärme aufnimmt. Im Kühlbetrieb kehrt sich die Richtung um. Monoblock-Anlagen haben diese bauseitige Kältemittelleitung nicht.",
    },
    now: (d) => (d.rps ?? 0) > 0
      ? { en: `Flowing — expansion valve at ${fmt0(d.eev)} pulses.`,
          de: `Durchströmt — Expansionsventil bei ${fmt0(d.eev)} Impulsen.` }
      : { en: "Still — the compressor is stopped.", de: "Steht — der Verdichter ist OFF." },
    rows: [/^low pressure$/i, /expansion valve ?1/i],
  },
  wsup: {
    t: { en: "Flow pipe", de: "Vorlaufleitung" },
    what: {
      en: "Supply water leaving the plate heat exchanger. In the split-system layout shown it passes the electric backup heater and circulation pump before the 3-way valve routes it to the heating circuit or tank circuit. The pre-BUH temperature therefore describes the heat pump exchanger; a post-BUH sensor also includes electric heat added downstream.",
      de: "Vorlaufwasser am Austritt des Plattenwärmetauschers. Im gezeigten Split-System-Aufbau passiert es den elektrischen Zusatzheizer und die Umwälzpumpe, bevor das 3-Wege-Ventil es zum Heiz- oder Speicherkreis leitet. Die Temperatur vor dem BUH beschreibt deshalb den Wärmepumpen-Wärmetauscher; ein Fühler hinter dem BUH enthält zusätzlich die danach eingebrachte elektrische Wärme.",
    },
    now: (d) => (d.pumpOn ?? (d.flow != null && d.flow > 1))
      ? { en: `Carrying ${degC(d.lwt)} at ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? ", reheated by the backup heater" : ""}.`,
          de: `Führt ${degC(d.lwt)} bei ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? ", vom Zusatzheizer nachgeheizt" : ""}.` }
      : { en: "No circulation — the pump is stopped, so this water is standing still.",
          de: "Keine Zirkulation — die Pumpe steht, dieses Wasser steht still." },
    rows: [lwtRow, /flow sensor/i],
  },
  wtank: {
    t: { en: "Tank circuit", de: "Speicherkreis" },
    what: {
      en: "The hydraulic branch used to charge the domestic-hot-water tank or thermal store. The exact heat exchanger differs by tank design: it can be a coil, an integrated charging circuit or a fresh-water storage arrangement. The drawing shows the function, not the model-specific internals. In this diverted layout, charging the tank pauses direct flow to the space-heating branch.",
      de: "Der hydraulische Zweig zum Laden des Warmwasser- oder Wärmespeichers. Der genaue Wärmetauscher hängt von der Speicherbauart ab: möglich sind eine Wendel, ein integrierter Ladekreis oder ein Frischwasserspeicher-Aufbau. Die Zeichnung zeigt die Funktion, nicht den modellspezifischen Innenaufbau. In diesem Umschaltaufbau pausiert während der Speicherladung der direkte Durchfluss zum Heizkreis.",
    },
    now: (d) => d.valveDhw === true
      ? { en: `Charging the tank — ${degC(d.lwt)} in, tank at ${degC(d.tank)}.`,
          de: `Lädt den Speicher — ${degC(d.lwt)} hinein, Speicher bei ${degC(d.tank)}.` }
      : { en: "Closed — the valve is feeding the heating circuit instead.",
          de: "Geschlossen — das Ventil versorgt stattdessen den Heizkreis." },
    rows: [/dhw tank temp/i, /dhw setpoint/i, /3.?way valve/i],
  },
  wheat: {
    // Titled for the CIRCUIT, not one leg of it: this target is both the flow down from the valve
    // and the return back to the merge, like the tank branch's, and the copy already read that way.
    t: { en: "Heating branch", de: "Heizkreis" },
    what: {
      en: "The branch supplying radiators, underfloor loops or other heat emitters. While water circulates, the return is normally cooler in heating because the emitters transfer heat to the building. The displayed ΔT also includes pipe and distribution effects, so it is not a direct room-heat measurement.",
      de: "Der Zweig zu Heizkörpern, Fußbodenheizung oder anderen Heizflächen. Bei laufendem Heizbetrieb ist der Rücklauf normalerweise kühler, weil die Heizflächen Wärme ans Gebäude abgeben. Das angezeigte ΔT enthält auch Rohr- und Verteilverluste und ist deshalb keine direkte Messung der Raumwärme.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "Paused — the valve is diverted to the hot-water tank.",
          de: "Pausiert — das Ventil ist auf den Warmwasserspeicher umgeschaltet." }
      : (d.pumpOn ?? (d.flow != null && d.flow > 1))
        ? { en: `${degC(d.lwt)} out, ${degC(d.ret)} back — ΔT ${fmt1(d.dt)} K.`,
            de: `${degC(d.lwt)} hin, ${degC(d.ret)} zurück — ΔT ${fmt1(d.dt)} K.` }
        : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [lwtRow, /inlet water/i, /^space heating operation/i],
  },
  wret: {
    t: { en: "Return pipe", de: "Rücklaufleitung" },
    what: {
      en: "Return water from the active heating or tank circuit on its way back to the plate heat exchanger. In the split-system layout shown it passes the water-side sensors before being heated again. Return temperature and flow together help describe heat transfer; return temperature alone does not measure the building's absorbed heat.",
      de: "Rücklaufwasser aus dem aktiven Heiz- oder Speicherkreis auf dem Weg zurück zum Plattenwärmetauscher. Im gezeigten Split-System-Aufbau passiert es die wasserseitigen Fühler, bevor es erneut erwärmt wird. Rücklauftemperatur und Durchfluss beschreiben gemeinsam die Wärmeübertragung; die Rücklauftemperatur allein misst nicht die vom Gebäude aufgenommene Wärme.",
    },
    now: (d) => (d.pumpOn ?? (d.flow != null && d.flow > 1))
      ? { en: `Returning at ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.`,
          de: `Kommt mit ${degC(d.ret)} zurück, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` }
      : { en: "No circulation — the pump is stopped.", de: "Keine Zirkulation — die Pumpe steht." },
    rows: [/inlet water/i, /flow sensor/i, /^water pressure$/i],
  },
  flow: {
    t: { en: "Flow rate", de: "Durchfluss" },
    re: /flow sensor/i, sample: "Flow sensor",
    rows: [/flow sensor/i, /^water pressure$/i, /water pump signal/i],
  },
  wp: {
    t: { en: "Water pressure", de: "Wasserdruck" },
    re: /^water pressure$/i, sample: "Water pressure",
    rows: [/^water pressure$/i, /flow sensor/i],
  },
};

// A row selector is either a label pattern or a PICKER FUNCTION. Quantities whose selection is a
// judgement rather than a match — leaving water, where a setpoint / mixed-zone / post-BUH row must
// never be substituted for the measurement (issue #121) — name their picker, so the rule lives in
// exactly one place and stays the one CI gates through logic/lwt_select.hpp.
const pickRow = (sel) => (typeof sel === "function" ? sel() : vRow(sel));
const inspRow = (e) => (e.pick ? e.pick() : e.re ? vRow(e.re) : null);

// The X10A row this target may present as a CURRENT reading: the row while the bus answers, null
// once it does not. The cache is deliberately KEPT when the link drops, so `inspRow` finding a row
// says nothing about whether that row is still being measured — and the panel treated "a row
// exists" as "the drawing is on X10A", which is how tapping a pill that had already switched to the
// gateway opened a headline carrying the old X10A number under the X10A label, with X10A history
// beneath it. The pill and the panel must answer with the same instrument; this is the question
// that decides which one.
const inspCurRow = (e) => {
  const r = inspRow(e);
  return x10aDown() || rowHeldOver(r, S.live) ? null : r;
};

// One member reading, resolved for BOTH the body and the change signature. Returns the pair the
// panel draws: the X10A row where it is current, and the gateway's row beside it (its second
// opinion) or in its place (while X10A is silent). Written once because the signature is what
// decides whether the body repaints — a body that renders something the signature cannot see stops
// updating and shows a value from whenever something else last moved, looking perfectly current.
function inspMember(sel) {
  const r = pickRow(sel);
  // X10A down: the retained row is not a reading any more. The gateway stands in where it carries
  // the same quantity (mbFallbackFor — the helper whose whole job is that substitution) and the
  // member simply disappears where it does not, rather than printing a stale number under its label.
  if (x10aDown()) return { x10a: null, mb: r ? mbFallbackFor(r.concept) : null };
  return { x10a: r, mb: mbTwin(r) };
}

// The component rows shown below the chart. A leaf VALUE entry often includes its own selector in
// `rows` so the same table can also describe an ASSEMBLY; omit its already-prominent headline pair
// by default. A grouped target can explicitly choose `listAllValues`: the DHW tank is both a value
// headline and a box containing temperature, target and valve state, and the group table must be
// complete rather than moving its first pair into the prose above the chart.
function inspMembers(e, row, fb) {
  if (!e || !e.rows) return [];
  return e.rows
    .map((sel) => inspMember(sel))
    .filter((m, i, a) => {
      if (!(m.x10a || m.mb)) return false;
      if (!e.listAllValues && ((row && m.x10a === row) || (fb && m.mb === fb))) return false;
      return a.findIndex((o) =>
        (m.x10a ? o.x10a === m.x10a : o.x10a == null && o.mb === m.mb)) === i;
    });
}

// A paired headline normally uses the compact comparison line in the explainer body. Grouped
// targets put both readings in their complete member table instead, leaving the body as explanation
// rather than a second, exceptional place for values.
const inspSourceNoteHtml = (e, row) =>
  e && e.listAllValues ? "" : mbNoteHtml(row, mbTwin(row));

// The reading of a /values row as one string ("42.8 °C"); "—" for an absent row — and "—" for a row
// the outdoor unit has stopped refreshing (rowHeldOver / logic/ou_stale.hpp), which is the SAME
// answer the pill gives. The panel used to read every row straight off /values, so tapping a pill
// the drawing had blanked produced its held-over number back in 19px — the explainer contradicting
// the picture, and asserting as current exactly the last-run value the blanking exists to withhold.
const inspVal = (r, d) => (r == null || rowHeldOver(r, d) ? "—" : displayValue(r) + (r.unit ? " " + r.unit : ""));

// Said when the entry's headline reading is held over: the pill can only blank, so the reason it is
// blank has to be stated here (the same division of labour the outdoor unit's idle sentence and the
// electrical estimate's already follow). It reads as a NOTE at the END of the explainer, in the
// "Normal:" shape — its own paragraph, a lead-in in stronger ink, the reason in the body's own ink,
// rendered by the same descNoteHtml — and not as the
// bold block ahead of the description that it used to be: the panel exists to say what the value IS,
// and three bold lines about a sensor that is merely resting had come to outweigh the answer. Still
// SUPPRESSES the entry's own `now` (inspNowText), since a sentence about what a reading is doing is
// void when there is no reading.
const HELD_OVER_NOW = {
  lead: { en: "No current reading:", de: "Kein aktueller Messwert:" },
  why: {
    en: "the compressor is stopped, and the outdoor unit only refreshes its own sensors while it runs. The last run's value is withheld rather than shown as if it were being measured now.",
    de: "der Verdichter steht, und die Außeneinheit aktualisiert ihre eigenen Fühler nur im Betrieb. Der Wert des letzten Laufs wird zurückgehalten statt als gerade gemessen dargestellt.",
  },
};
// A held X10A row is still unavailable, but it is no longer a blank headline when the drawing has
// substituted a live HomeHub reading for this target. In that case the inspector names the Modbus
// row and must not append a contradictory "No current reading" note.
const inspHeld = (e, d) => !!d && rowHeldOver(inspRow(e), d) && !mbForInspect(S.insp);
const inspHeldHtml = (e, d) =>
  (inspHeld(e, d) ? descNoteHtml(tx(HELD_OVER_NOW.lead), tx(HELD_OVER_NOW.why)) : "");

// The live sentence above the timeless description — dropped entirely while the reading is held
// over, where the note below the description answers instead.
const inspNowText = (e, d) => {
  if (!d || inspHeld(e, d)) return null;
  return e.now ? tx(e.now(d)) : null;
};

// An entry's title, which may DEPEND on the live values — `t` takes the same {en,de}-or-function
// shape `head` and `now` already do. Only the COP uses it: which system its quotient describes is
// decided per poll (logic/cop_scope.hpp), and the title is where that has to be said, since the
// number itself looks identical either way. Resolved through one helper so renderInspect and
// inspectSig cannot disagree about it — a dynamic title left out of the signature would simply
// stop repainting when the scope flipped.
const inspTitleText = (e, d) => tx(typeof e.t === "function" ? e.t(d) : e.t);

// Everything the panel would draw, as one string — the change key for the render guard above. It
// covers the selection, the headline, the live sentence and every member reading, so a value moving
// still repaints while an idle second does not.
function inspectSig(e) {
  if (!e) return "";
  const d = S.live;
  const row = d ? inspCurRow(e) : null;
  // The fallback headline is a value like any other and moves like any other, so it is in the key.
  const fb = row ? null : mbForInspect(S.insp);
  // Each member reading AND its Modbus twin: the panel draws both, so both have to be in the key.
  // Use the same filtered set as the renderer; grouped targets deliberately include their headline
  // pair here, while leaf targets keep that pair in the dedicated signature fields below.
  // A value the body renders but the signature omits simply stops repainting — the mirror of putting
  // a side effect IN here, and the quieter of the two failures: the panel keeps showing the gateway's
  // reading from whenever something else last changed, looking perfectly current.
  const rows = (d ? inspMembers(e, row, fb).map((m) => {
    return inspVal(m.x10a, d) + (m.mb ? "/" + m.mb.value : "");
  }) : []).join(",");
  const twin = mbTwin(row);
  // LANG guarantees the full body is redrawn even when this particular entry's title/live sentence
  // happens to be spelled identically in both dictionaries.
  return [LANG, S.insp, inspTitleText(e, d), inspVal(row, d), twin ? twin.value : "",
          fb ? fb.value : "", d && e.head ? e.head(d) : "",
          inspNowText(e, d) || "", inspHeld(e, d) ? "held" : "", rows].join("|");
}

// The trend under the inspector: the same chart the value list draws. A resolved X10A row chooses
// its structural trend; one of the six paired schematic measurements also brings its independent
// HomeHub ring, and may therefore keep a petrol curve when X10A has no current row. Computed pills
// still chart only their own derived series — never one of their inputs.
//
// Written on its OWN signature, not the inspector's: the card re-renders whenever a live value
// changes (~1×/s), and re-emitting the plot that often would tear down a crosshair mid-read and
// restart the CSS transition. Only a new series (`gen`) or a moved pin actually changes the markup.
function renderInspectHist(e, row) {
  // A pill drawn from a ROW charts that row; a COMPUTED pill (ΔT, heat output, electrical input,
  // COP) charts its own derived series, named by the entry's `trend`. Never one of its inputs: a
  // curve of the flow rate under a heat-output headline is the substitution this file spends most
  // of its comments preventing.
  const pair = MB_PAIRS.find((p) => p.insp === S.insp);
  const pairedId = pair && hasModbusHist(pair.cid) ? pair.cid : "";
  const id = row ? histIdFor(row.label)
           : pairedId || (e && e.trend && hasHist(e.trend) ? e.trend : "");
  if (id) ensureHistPair(id);              // throttled to once a minute inside; no-op once cached
  const h = id ? S.hist.get(id) : null;
  const mh = id ? S.hist.get(histCacheKey(id, "modbus")) : null;
  const pin = id ? S.histPin.get(id) : null;
  // histHtml carries localised axis/readout copy. A language switch must therefore invalidate the
  // inspector chart even when the series generation and pinned sample are unchanged.
  const sig = [LANG, id, h ? (h.err ? "e" : h.gen) : "", mh ? (mh.err ? "e" : mh.gen) : "",
               pin ? (pin.t ?? `${pin.i}/${pin.gen}`) : ""].join("|");
  if (sig === S.inspHistSig) return;
  S.inspHistSig = sig;
  const el = $("inspHist");
  el.hidden = !id;
  // The chart's name is the entry's STABLE concept, never its live title — the same rule
  // labelSchematicHits follows, for the same reason. The COP is the one that would break: its title
  // states which SYSTEM the present quotient describes (plant vs heat pump, logic/cop_scope.hpp),
  // and a 24-hour curve cannot be named after the state of one second. It would have read "COP of
  // the plant" over a series that is, by construction, the heat pump's own — a scope mismatch under
  // a chart, which is the failure cop_scope exists to prevent.
  const mb = pairedId ? mbByConcept(pairedId) : null;
  el.innerHTML = !id ? ""
    : row ? histHtml(id, row.unit, displayReadingLabel(row.label))
    : pairedId ? histHtml(id, mb ? mb.unit : "", mb ? displayHomeHubLabel(mb) : inspTitleText(e, null))
               : histHtml(id, DERIVED[id].unit, e.aria ? tx(e.aria) : inspTitleText(e, null));
}

function renderInspect() {
  const e = S.insp ? INSPECT[S.insp] : null;
  // Frozen while a trend is being scrubbed, for the reason renderCards is: a rebuild under an active
  // pointer drops the capture and kills the gesture. The inspector's chart is one of the two places
  // a scrub can start, so the freeze has to cover this card too — scrubEnd resumes both.
  if (S.scrub) return;
  // The chart is decided ahead of the early return below, because its own state moves independently
  // of the card's: the series arrives from an async fetch that changes no live value.
  // inspCurRow refuses a retained X10A row. renderInspectHist may still resolve this target's paired
  // Modbus ring, so a petrol headline gets petrol history without reviving stale X10A samples.
  renderInspectHist(e, S.live && e ? inspCurRow(e) : null);
  // This runs on EVERY poll so an open explainer tracks the live values — but writing innerHTML each
  // second would collapse a text selection the user is mid-read of. Diff the rendered result first
  // and touch the DOM only when something actually changed.
  const sig = inspectSig(e);
  if (sig === S.inspSig) return;
  S.inspSig = sig;
  $("inspCard").hidden = !e;
  document.querySelectorAll("#schem .sc-hit").forEach((el) => el.classList.toggle("sel", el.dataset.insp === S.insp));
  if (!e) return;
  // `d` is the drawing's snapshot and is NOT null merely because X10A is silent — liveData() still
  // builds one from the gateway when it is delivering, which is what makes the fallback a drawing
  // rather than a blank card. So "is there a snapshot" and "is the X10A row current" are two
  // questions, and inspCurRow asks the second one.
  const d = S.live;
  const row = d ? inspCurRow(e) : null;
  // The gateway's reading of this target while X10A is silent — null in normal operation, so
  // everything below is the panel it always was unless the drawing itself has switched source.
  const fb = row ? null : mbForInspect(S.insp);
  setTxt("inspTitle", inspTitleText(e, d));
  // The source line names the reading's origin, so a number in the picture can be traced to the row
  // it came from. On the fallback it names the MODBUS row — the X10A label would credit the wrong
  // instrument for the number shown above it, which is the one thing this line exists to prevent.
  // On the fallback the line carries the BADGE as well as the petrol ink. Colour alone was the only
  // thing saying "this came from the gateway" in the whole panel, which is both weaker than a word
  // and invisible to anyone who cannot separate the two hues — DESIGN.md's own rule is that colour
  // never carries a fact by itself. Everywhere else the badge already appears beside a gateway
  // reading; this was the one place it did not.
  const srcName = fb ? displayHomeHubLabel(fb)
                     : displayReadingLabel(row ? row.label : (e.sample || ""));
  $("inspSrc").innerHTML = esc(srcName) +
    (fb ? ` <span class="mb-tag">${esc(t("src.modbus_tag"))}</span>` : "");
  $("inspSrc").hidden = !(row || fb || e.sample);
  $("inspSrc").classList.toggle("src-val-mb", !!fb);
  // Headline = the ONE compact reading this target stands for (its row, or a derived `head` for the
  // computed pills). An assembly like the outdoor unit has no single number, so it gets no headline
  // at all rather than a "—" that would read as a missing value.
  const hasHead = !!(e.re || e.pick || e.head || fb);
  $("inspNow").hidden = !hasHead;
  // An explicit formatter wins over the raw row value. Binary component states use this to say
  // ON/OFF instead of exposing an unexplained 1/0, while the row still names the source. With no
  // X10A row but a gateway reading, the headline is THAT reading, petrol — the pill above is
  // showing it, and a panel answering "—" underneath would deny the number the user just tapped.
  if (hasHead) {
    const explicitHead = d && e.head ? e.head(d) : null;
    setTxt("inspNow", explicitHead != null ? explicitHead
                     : row ? inspVal(row, d)
                     : fb ? displayValue(fb) + (fb.unit ? " " + fb.unit : "")
                     : "—");
  }
  $("inspNow").classList.toggle("src-val-mb", !!fb);
  // `now` is always prose — the live "what is it doing" sentence — and it CLOSES the body, as its
  // own paragraph after the timeless explainer and its "Normal:" note, in the body's own ink. It
  // used to open the body in bold, which inverted the panel: a reader opens an explainer BECAUSE
  // they do not know what the quantity is, and three bold lines about a transient state stood in
  // front of the answer they came for. The held-over note (inspHeldHtml) takes the same slot in the
  // same shape — the two are mutually exclusive, since a sentence about what a reading is doing is
  // void when there is no reading. Never the headline either: a sentence in a 19px number slot
  // reads as a broken value.
  const sentence = inspNowText(e, d);
  const desc = e.sample ? descFor(e.sample) : null;
  const ownWhat = typeof e.what === "function" ? e.what(d) : e.what;
  const what = ownWhat ? descParaHtml(esc(tx(ownWhat)))
                       : (desc ? descBodyHtml(desc, (row || fb)?.value) : "");
  // A leaf reading puts its SECOND source after the description. A grouped target keeps prose and
  // values separate: all of its sources live together in the member table below the chart.
  $("inspBody").innerHTML = what + inspSourceNoteHtml(e, row)
    + (sentence ? descParaHtml(esc(sentence)) : "") + inspHeldHtml(e, d);
  $("inspRows").innerHTML = !d ? "" : inspMembers(e, row, fb)
    // A member reading with a twin gets the gateway's value as its OWN row, labelled "(Modbus)" and
    // petrol throughout — never appended to the X10A value in the same cell, which is what this did
    // first and which rendered as "46.2 °C 46.0 °C": two numbers of equal weight, jammed together,
    // with nothing saying that they come from different instruments or which is which. A reading is
    // a label and a value; a second reading needs both, not a second number in the first one's slot.
    .map((m) => {
      const row = m.x10a
        ? `<div class="inspect-row"><span>${esc(displayReadingLabel(m.x10a.label))}</span>` +
          `<span>${esc(inspVal(m.x10a, d))}</span></div>`
        : "";
      if (!m.mb) return row;
      // The gateway's OWN label, like the explainer line — it names the register the number came
      // from, which is what someone checking the pairing against real hardware needs to read.
      return row +
        `<div class="inspect-row mb-row">` +
          `<span>${esc(displayHomeHubLabel(m.mb))} ` +
            `<span class="mb-tag">${esc(t("src.modbus_tag"))}</span></span>` +
          `<span>${esc(displayValue(m.mb))}${m.mb.unit ? " " + esc(m.mb.unit) : ""}</span></div>`;
    })
    .join("");
}

// Name every schematic hit target from its INSPECT entry. An SVG <title> is BOTH the native hover
// tooltip and the element's accessible name, so pointer users, keyboard users and screen readers all
// get the same wording out of the one copy source — and the markup carries no duplicated English.
function labelSchematicHits() {
  const SVGNS = "http://www.w3.org/2000/svg";
  document.querySelectorAll("#schem [data-insp]").forEach((el) => {
    const e = INSPECT[el.dataset.insp];
    if (!e) return;
    // An entry whose TITLE is live (the COP names the system it describes, and that follows the
    // electrical source) cannot supply the accessible name: this runs at BOOT, before any reading
    // exists — and again on a live language switch (setLang), never on a poll — so a live title
    // would be frozen at whatever it happened to say on the run that last touched the language.
    // `aria` is the stable concept the target opens; the live distinction belongs in the panel,
    // which is where a screen reader meets it too. Falling back through inspTitleText rather than
    // tx() keeps a future function-form title a real string instead of the literal "undefined"
    // that tx() returns for a function.
    const name = e.aria ? tx(e.aria) : inspTitleText(e, null);
    el.setAttribute("aria-label", name);
    // Re-entrant: a language switch re-runs this on the SAME nodes, so reuse the existing <title>
    // rather than inserting a second one — an unconditional insert here left one stale, un-removed
    // <title> child behind every switch, growing without bound over a long-lived tab.
    let ttl = el.querySelector(":scope > title");
    if (!ttl) {
      ttl = document.createElementNS(SVGNS, "title");
      el.insertBefore(ttl, el.firstChild);
    }
    ttl.textContent = name;
  });
  $("inspClose").setAttribute("aria-label", t("insp.close"));
}

// Tap a hit target: select it, or close it when it is already open (tapping the same thing twice is
// the natural "done reading" gesture, and there is no other close on touch besides the ✕).
function inspectPick(key) {
  const opening = S.insp !== key;
  S.insp = opening ? key : null;
  renderInspect();
  if (opening) $("inspCard").scrollIntoView({ block: "nearest", inline: "nearest" });
}
