
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

// Page 0x20 / offset 2 across the supported model catalog. The sensor's physical role is stable
// while Daikin's labels are not: ordinary air-source units call it the outdoor heat exchanger,
// other families call the same location a deicer or two-phase thermistor. Keep the alternatives
// exact so "Heat exchanger mid-temp." at offset 8 can never substitute for this R4T curve.
const OUTDOOR_HX_RE = /^(?:2 phase thermistor \(R4T\)|O\/U Heat Exch\. Temp\.(?:\(R4T\))?|O\/U Heat Exchanger Temp|Outdoor heat exchanger temp\.|R4T-Deicer temp\.)$/i;

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
// The two tiers as NAMED predicates over a raw label, one per C++ twin (lwt_is_pre_buh /
// lwt_is_measurement). Named rather than inlined into the find() callbacks below because
// scripts/check-presenter-parity.sh calls them directly with the whole def/ catalog's labels and
// diffs the answers against the C++ — a rule nothing can address is a rule nothing can gate, which
// is how this copy drifted far enough to match the bizone kit's MIXED leaving-water row.
const lwtIsPreBuh = (l) => lwtWater(l) && !lwtReject(l) && l.includes("r1t");
const lwtIsMeasurement = (l) => lwtWater(l) && !lwtReject(l);
const lwtRow = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => lwtIsPreBuh(low(x)));
  if (!r) r = vals.find((x) => lwtIsMeasurement(low(x)));
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
// Named for lwtIsPreBuh's reason: this is the addressable twin of cop_is_post_buh(label, reg), and
// the parity gate calls it with the catalog's own (label, page) pairs.
const isPostBuhRow = (l, reg) =>
  !OU_HELD_PAGES.includes(reg) && l.includes("r2t") &&
  !l.includes("setpoint") && !l.includes("mixed") && lwtWater(l);
const postBuhRow = () => {
  const vals = (S._values || []).filter((x) => x.value != null);
  return vals.find((x) => isPostBuhRow((x.label || "").toLowerCase(), x.reg)) || null;
};
// WHICH COP a quotient would be, and when it is none — the addressable twin of
// logic/cop_scope.hpp's cop_plan(), same branches in the same order. A named function rather than a
// cascade inlined in liveData() so scripts/check-presenter-parity.sh can enumerate the whole input
// space (3 electrical sources x 9 backup-heater step pairs x 3 tank-heater states x post-BUH row or
// not = 162 combinations) against the C++ and diff every answer; a rule spelled out inside a
// 200-line builder can only be tested through everything around it.
//
// It takes the two heaters as the RAW tri-states they arrive as (null = this profile carries no such
// row) and collapses them here, rather than being handed two ready-made booleans. That is not
// tidiness: the collapse is the rule's most dangerous step — UNKNOWN is not OFF, and off is the
// PERMISSIVE branch, so guessing it is exactly what ships the collapsed quotient — and a step
// computed in the caller is a step the parity gate would have to re-implement to reach, which would
// make the gate a third copy of the very thing it is comparing. Measured: while these two lines sat
// in liveData(), the selftest's "unknown tank heater treated as off" mutation passed the gate.
const copPlan = (pelSrc, buh1, buh2, bsh, pbOk) => {
  const heaterQuiet = (buh1 != null || buh2 != null) && !(buh1 === true || buh2 === true);
  const tankQuiet   = bsh != null && bsh !== true;
  if (pelSrc == null)    return { scope: null,    block: "no_pel",      postBuh: false };
  if (pelSrc === "INV")  return { scope: "hp",    block: null,          postBuh: false };
  // Checked before the numerator is picked: no choice of row answers the tank heater, so claiming
  // one would imply a pairing that does not exist.
  if (!tankQuiet)        return { scope: "plant", block: "tank_heater", postBuh: false };
  if (pbOk)              return { scope: "plant", block: null,          postBuh: true  };
  return { scope: "plant", block: heaterQuiet ? null : "buh_no_r2t", postBuh: false };
};
const fmt1 = (n) => (n == null ? "—" : n.toFixed(1));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const setTxt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };

// The preferred witness is X10A's actual compressor speed. In a gateway-only snapshot that row is
// necessarily absent, but HomeHub input 31 supplies the corresponding current ON/OFF state. Keep
// the speed threshold used by the thermal calculation when speed exists; the binary fallback has
// no intermediate range to apply it to.
const compressorRunning = (d, minRps = 0) => {
  if (!d) return false;
  return d.rps != null ? d.rps > minRps : d.compressorOn === true;
};

// Prefer the measured flow over the pump command/status. An external pump, coast-down or a stale/
// conflicting binary status can produce real flow while the internal pump reports OFF. Conversely,
// pump ON without a flow reading is only a pump report, not proof that water moves. Return null for
// that unknown state so animations and prose do not turn a command into a measurement.
const waterMoving = (d) => {
  if (!d) return null;
  if (d.flow != null) return d.flow > 0.5;
  return d.pumpOn === false ? false : null;
};
const pumpFlowConflict = (d) => !!d && d.pumpOn === false && d.flow != null && d.flow > 0.5;

// The colour is a claim about THERMAL transfer, not merely hydraulic motion. Modbus-only DHW has
// enough independent evidence for heating (compressor + DHW valve + pump); Modbus-only space Auto
// still cannot distinguish heating from cooling and therefore remains neutral.
const waterThermalKind = (d, pumping) => {
  if (!d || pumping !== true) return null;
  if (d.thermalMode == null || (!compressorRunning(d) && !(d.buh1 || d.buh2))) return "neutral";
  return d.thermalMode === "cool" ? "cool" : "heat";
};

// The hydronic I/U mode is the only X10A row that distinguishes the SPACE circuit's season from
// the task currently using the common water loop. Do not infer it from temperatures: the exact
// cooling screenshot that prompted this rule had 57.8 °C residual DHW water while the I/U mode was
// already Cooling. With X10A down the HomeHub can still say that space operation is active, but its
// Auto holding setting does not say which side Auto selected, so the honest fallback is unknown.
const spaceModeKind = () => {
  if (x10aDown()) return null;
  const r = vRow(/^i\/u operation mode$/i);
  const raw = r && r.value != null ? String(r.value).trim() : "";
  if (/^cooling(?:\s*\+\s*dhw)?$/i.test(raw)) return "cool";
  if (/^heating(?:\s*\+\s*dhw)?$/i.test(raw)) return "heat";
  return null;
};

// Turn the signed water-side balance into the one quantity the current task can honestly name.
// R1T-R4T is positive while heat enters the water and negative while cooling removes it. A running
// pump alone can redistribute stored heat and produce a small, arithmetically real difference; it
// is NOT heat-pump output, so no thermal-power pill is shown without the live compressor witness.
// A direction opposite to the declared task is a transition, sensor tolerance or another state we
// cannot classify — blank it rather than relabel it into a plausible-looking capacity.
function thermalValue(d, raw, allowDefrost) {
  if (raw == null || d.dtStale || !compressorRunning(d, 5)) return null;
  if (d.defrost === true) return allowDefrost ? raw : null;
  if (d.thermalMode === "cool") return raw < 0 ? -raw : null;
  if (d.thermalMode === "heat") return raw > 0 ? raw : null;
  return null;
}

function applyThermalPlan(d) {
  const raw = d.flow != null && d.dt != null ? d.flow / 60 * 4.186 * d.dt : null;
  d.pthRaw = raw;
  d.pth = thermalValue(d, raw, true);
  d.pthKind = d.pth == null ? null
            : d.defrost === true ? "transfer"
            : d.thermalMode === "cool" ? "cooling" : "heating";
  d.efficiencyKind = d.thermalMode === "cool" && d.defrost !== true ? "eer" : "cop";
}

// Name the field circuit for verified ACTIVE transfer, not for the selected season. In particular,
// Cooling + stopped compressor + 57 °C pump overrun is the generic space circuit carrying residual
// heat; calling the emitter box "COOLING" makes the mode look like a claim about that hot water.
function activeSpaceKind(d) {
  if (!d || d.valveDhw === true) return null;
  return d.pthKind === "cooling" ? "cool" : d.pthKind === "heating" ? "heat" : null;
}

function liveData() {
  // ΔT is measured across the PHE: leaving water BEFORE the backup heater minus inlet water — with
  // the BUH off (the normal case) before/after are equal, and the derived heat output must not
  // credit the resistive heater to the heat pump.
  const lwt = vLwt();   // pre-BUH R1T measurement, never a setpoint (see vLwt / logic/lwt_select.hpp)
  const ret = vNum(/inlet water/i);
  const cts = (S._values || []).filter((x) => /current measured by ct/i.test(x.label || "") && x.value != null);
  const ct = cts.reduce((a, x) => a + (parseFloat(x.value) || 0), 0);
  const inv = vNum(/inv primary current/i);
  const postBuh = postBuhRow();
  const d = {
    lwt, ret,
    dt: lwt != null && ret != null ? lwt - ret : null,
    out: vNum(/outdoor air/i),
    ouHx: vNum(OUTDOOR_HX_RE),
    flow: vNum(/flow sensor/i),
    wp: vNum(/^water pressure$/i),
    rps: vNum(/inv frequency/i),
    hp: vNum(/^high pressure$/i),
    lp: vNum(/^low pressure$/i),
    rp: vNum(/^refrigerant pressure sensor$/i),
    disch: vNum(/discharge pipe temp/i),
    eev: vNum(/expansion valve ?1/i),
    r2t: postBuh && Number.isFinite(parseFloat(postBuh.value)) ? parseFloat(postBuh.value) : null,
    r3t: vNum(/refrig\. temp\. liquid side/i),
    tank: vNum(/dhw tank temp/i),
    tankSet: vNum(/dhw setpoint/i),
    room: vNum(/^indoor ambient temp/i),
    roomSet: vNum(/^rt setpoint/i),
    // The catalog currently exposes only the HEATING target. Quoting it while cooling would compare
    // a valid measured ΔT with the wrong controller target, so it is attached after mode resolution.
    dtSet: null,
    pumpSig: vNum(/water pump signal/i),
    pumpOn: stateOf(/water pump operation/i, 30),
    // Through stateOf, like every other plant state: X10A while its link is live, else a live
    // gateway, else nothing. Keyed on the EKRHH OFFSET, not a label — those offsets are the
    // documented data model (§9.2.2) and are the one thing about a HomeHub row that cannot be
    // re-spelled.
    valveDhw: stateOf(/3.?way valve/i, 37),        // label documents On:DHW / Off:Space
    // Historical X10A catalogs call this bit "On:Heat_Off:Cool", but it is a logical output state,
    // not the separate configured/current operating mode or mechanical position feedback. At idle
    // the live unit demonstrates that the two can differ, so retain the electrical ON/OFF fact.
    valve2On: stateOf(/2.?way valve/i),
    flowSwitch: stateOf(/water flow switch/i),
    buh1: vOn(/buh step ?1/i),
    buh2: vOn(/buh step ?2/i),
    // Exact anchor is intentional: "Thermal protector BSH" is a different flag. BSH is the tank's
    // electric immersion heater and can be the only active component during an SG-Ready boost.
    bsh: stateOf(/^bsh$/i, 32),
    defrost: vOn(/defrost operation/i),
    // "Space heating Operation ON/OFF" and HomeHub input 53 both mean normal SPACE heat/cool
    // OPERATION — not a thermostat demand and not heating-only. The controller can report it ON in
    // Cooling while Thermostat is OFF (live unit, 2026-08-01). Keep the exact row anchor, but name
    // the field for what Daikin documents instead of preserving the old interpretation in code.
    spaceOp: stateOf(/^space heating operation/i, 53),
    quiet: stateOf(/low noise control|silent mode/i, 9),
    // HomeHub holding offset 56 is the EXTERNAL Smart-Grid request. It is intentionally independent
    // of the plant's operating mode: mode 2 proves that evcc's boost reached the controller, while
    // the DHW flag / valve / flow separately prove whether the controller acted on it.
    // X10A may answer where the HomeHub cannot — see the note below the literal.
    sgMode: mbSmartGridMode(),
    // Which instrument answered sgMode ("MB" | "X10A" | null). Set below.
    sgSrc: null,
    // Source provenance for schematic fields. Normally empty: X10A leads. A field is added only
    // when liveData replaces an unavailable X10A reading with the independent HomeHub register;
    // renderLive then gives that pill the petrol source colour and the inspector names the register.
    mbFields: new Set(),
  };
  // Smart Grid deliberately does NOT go through stateOf(), and the priority is the REVERSE of every
  // other paired state. Those all have ONE physical subject both buses report, so "whoever is live
  // answers" is safe. These two are different subjects: holding 56 is the request an energy manager
  // WROTE, while the X10A pair is the physical SG-Ready terminal input — docs/REGISTERS.md puts it at
  // 0x60/11 bits 1-2, inside a byte of external inputs beside the flow switch, the tariff contact,
  // the solar input and the thermal protectors. They can legitimately disagree, and one direction is
  // dangerous: an evcc boost written over Modbus leaves UNWIRED contacts reading 00, i.e. a perfectly
  // current "Free running". Letting X10A lead would therefore print a true reading of the wrong
  // instrument under the pill's one name — the substitution logic/homehub_map.hpp refuses for every
  // other concept, and why offset 56 carries no `concept` pairing. So a HomeHub that answers always
  // wins, and X10A speaks only where nothing else does: a plant with no gateway at all, which used
  // to leave this pill blank while the contacts were being read and listed two cards below.
  d.sgSrc = d.sgMode != null ? "MB" : null;
  if (d.sgMode == null) {
    // Already gated on x10aDown() inside, so a retained X10A cache cannot answer here either.
    const sgX10a = x10aSmartGridMode();
    if (sgX10a != null) { d.sgMode = sgX10a; d.sgSrc = "X10A"; }
  }
  // X10A leads when it can state a speed. When its whole link is down (or a profile has no speed
  // row), the live HomeHub compressor flag supplies only the activity fact — never an invented rps.
  d.compressorOn = !x10aDown() && d.rps != null ? d.rps > 0 : mbBool(31);
  d.spaceMode = spaceModeKind();
  // DHW always heats the tank-side hydronic loop, even when the simultaneous space season is Cooling.
  // Otherwise the I/U mode decides which direction across the PHE is useful output.
  d.thermalMode = d.defrost === true ? "defrost"
                : d.valveDhw === true ? "heat" : d.spaceMode;
  if (d.spaceMode === "heat") d.dtSet = vNum(/target delta t heating/i);
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
  // X10A's outdoor-air row is held over at rest, but the independently polled HomeHub register can
  // continue changing. Prefer that register value to a blank pill, while retaining ouHeldOver so every
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
  // A working ΔT needs measured water movement. Pump ON alone is not enough; a missing flow value
  // therefore blanks the working-point claim just like a measured zero does.
  d.dtStale = waterMoving(d) !== true;
  // Derived figures, marked "est." in the UI — the bus has no energy registers. Thermal output from
  // flow × ΔT (water ≈ 4.186 kJ/kg·K); electrical from the CT phase currents at an assumed 230 V,
  // falling back to the inverter primary current when the profile has no CT rows. applyThermalPlan
  // keeps the signed raw balance for defrost, turns active cooling into positive cooling capacity,
  // and refuses to call pump-only residual-heat circulation an output.
  applyThermalPlan(d);
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
  // answer is to state nothing. d.pth remains on the PHE boundary and is separately qualified by
  // compressor state, operating mode and transfer direction.
  const pbRow  = postBuhRow();
  const pbT    = pbRow ? parseFloat(pbRow.value) : NaN;
  // The row must also have a usable number and a return temperature to pair with, or it cannot
  // carry the boundary — fall through to the no-row branch, which blocks while the heater fires.
  const pbOk   = pbRow != null && Number.isFinite(pbT) && d.ret != null;
  // Both heaters go in as the raw tri-states; copPlan owns the "UNKNOWN is not OFF" collapse, so it
  // is one rule in one place and the parity gate can reach it.
  const plan = copPlan(d.pelSrc, d.buh1, d.buh2, d.bsh, pbOk);
  d.copScope = plan.scope; d.copBlock = plan.block; d.copPostBuh = plan.postBuh;
  // The COP's own heat figure: the same formula as d.pth, across whichever outlet the scope needs.
  const copDt = d.copPostBuh ? pbT - d.ret : d.dt;
  const copRaw = d.flow != null && copDt != null ? d.flow / 60 * 4.186 * copDt : null;
  d.copPth = thermalValue(d, copRaw, false);
  d.cop = d.copBlock == null && d.copPth != null && d.pel != null && d.pel > 0.2
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
    // The paired plant STATES survive, because they are no longer X10A values: stateOf() already
    // refused the retained X10A bit and returned the gateway's (or nothing). Clearing them here is
    // what used to blank the pump and the demand next to readings that were arriving.
    // sgSrc rides with sgMode: a preserved value whose provenance was blanked would let the
    // inspector name the wrong instrument, which is the one thing that pill's copy must get right.
    const KEEP = new Set(["pumpOn", "compressorOn", "valveDhw", "spaceOp", "bsh", "quiet", "sgMode",
                          "sgSrc", "mbFields"]);
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
    // ΔT survives because both temperatures come from the gateway's own hydronic readings. Thermal
    // output survives only with its independent input-31 compressor witness: without that current
    // flag, the snapshot still cannot distinguish active PHE transfer from pump-only redistribution.
    d.dt = (d.lwt != null && d.ret != null) ? d.lwt - d.ret : null;
    d.dtStale = waterMoving(d) !== true;
    d.spaceMode = null;
    d.thermalMode = d.valveDhw === true ? "heat" : null;
    applyThermalPlan(d);
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
  "svOut", "svOuHx", "svRps", "svHp", "svLp", "svDisch", "svEev", "svLwt", "svRwt", "svDt",
  "svFlow", "svWp", "svPump", "svTank", "svTankSet", "svRoom", "svRoomSet", "svPth", "svCop", "svPel",
  "svR2t", "svR3t", "svValve2", "svFlowSwitch",
];
// A held outdoor-unit row has no current X10A value. It may still have a current replacement from
// the independent Modbus stack; mbFields is the proof that `n` is that replacement, not the retained
// X10A cache. Shared by outdoor air and discharge so they cannot drift into two held-over policies.
const ouReadingText = (d, key, n, fmt) =>
  d.ouHeldOver && !(d.mbFields && d.mbFields.has(key)) ? "—" : fmt(n);

// Compact permanent state pills contain only their stable names. Preserve the state in the
// accessible name as well as in the inspector, so the colour-only face remains unambiguous.
function updateSchematicStateA11y(d) {
  const set = (id, label, state) => {
    const el = $(id);
    if (el) el.setAttribute("aria-label", `${label}: ${state}`);
  };
  set("gSgRequest", t("schem.sg_boost"), sgModeText(d && d.sgMode));
  set("gBshState", t("schem.bsh_label"),
      !d || d.bsh == null ? "—" : t(d.bsh ? "state.on" : "state.off"));
  set("gDefrostState", t("schem.defrost_pill"),
      !d || d.defrost == null ? "—" : t(d.defrost ? "state.on" : "state.off"));
  set("gQuietState", t("chip.quiet"),
      !d || d.quiet == null ? "—" : t(d.quiet ? "state.on" : "state.off"));
  set("g2wv", t("schem.valve2"),
      !d || d.valve2On == null ? "—" : t(d.valve2On ? "state.on" : "state.off"));
  set("gFlowSwitch", t("schem.flow_switch"),
      !d || d.flowSwitch == null ? "—" : t(d.flowSwitch ? "state.on" : "state.off"));
}

// ENV III is independent of both liveData sources: an X10A outage must not blank a fresh outdoor
// sensor, and a live HomeHub must not make a stale ENV sample current. Keep its formatter and state
// decision in one place so the compact header pill and the inspector always tell the same truth.
function env3State(env) {
  return env.fresh ? { text: t("env.live"), cls: "ok" }
    : env.error === "collecting" ? { text: t("env.collecting"), cls: "warn" }
    : { text: t("env.unavailable"), cls: "err" };
}

function env3Value(env, key, digits, unit) {
  if (!env.fresh || !Number.isFinite(Number(env[key]))) return `— ${unit}`;
  const locale = LANG === "de" ? "de-DE" : "en-US";
  const value = Number(env[key]).toLocaleString(locale,
    { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value} ${unit}`;
}

function renderEnv3Pill() {
  const group = $("gEnv3");
  if (!group) return;
  const env = S.status?.env3 || {};
  const configured = env.supported === true && env.enabled === true;
  group.style.display = configured ? "" : "none";
  group.setAttribute("tabindex", configured ? "0" : "-1");
  if (!configured) {
    group.setAttribute("aria-hidden", "true");
    if (S.insp === "env3") {
      S.insp = null;
      // Null is an invalidation sentinel, not the closed inspector's real empty signature. Using
      // "" for both let renderInspect() take its unchanged-DOM early return and leave the tongue
      // visibly open after its ENV III trigger disappeared.
      S.inspSig = null;
      S.inspHistSig = null;
    }
    return;
  }
  group.removeAttribute("aria-hidden");
  const temperature = env3Value(env, "temperature_c", 1, "°C");
  const state = env3State(env);
  setTxt("svEnv3Temp", temperature);
  group.classList.toggle("fresh", env.fresh === true);
  const label = `${t("env.card")}: ${temperature}; ${state.text}`;
  group.setAttribute("aria-label", label);
  const title = group.querySelector(":scope > title");
  if (title) title.textContent = label;
}

function clearSchematic() {
  SCHEM_PILL_IDS.forEach((id) => setTxt(id, "—"));
  setTxt("svBuh", "");                 // no BUH step to report
  setTxt("svValve", "3WV");            // valve position unknown — don't claim a branch
  setTxt("svSpaceCircuit", t("schem.space_circuit"));
  setTxt("svCopLabel", "COP");
  const sc = $("schem");
  ["fan-on", "pump-on", "buh-on", "bsh-on", "defrost-on", "quiet-on", "sg-boost-on",
   "cooling-mode", "water-neutral", "valve2-on", "flow-switch-on"].forEach((c) => sc.classList.remove(c));
  updateSchematicStateA11y(null);
  sc.classList.add("no-spaceh");       // no flag to show; the pill would otherwise sit stale
  $("schem").querySelectorAll(".sc-flow, .sc-rflow").forEach((el) => el.classList.remove("on", "rev"));
}

function renderLive() {
  // The readings were decoded once in renderDashboard (S.live, null when the link is down or no
  // value has arrived). The status block above and this drawing therefore render from the SAME
  // snapshot and cannot disagree about whether the plant is running. The inspector reads it too, so
  // an open explainer follows the live values.
  renderEnv3Pill();
  const d = S.live;
  // Mark every pill this cycle drew from the Modbus stack, and unmark the rest. Done in ONE pass over
  // the known pill set rather than per setTxt, so a pill that stops being Modbus-sourced cannot keep
  // the colour from a previous cycle.
  const mbf = (d && d.mbFields) || new Set();
  // The eight paired pills come from MB_PAIRS; the four DERIVED ones have no register and so no
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

  // Bit-flag states, each drawn at the component it belongs to: normal space heat/cool operation on
  // the space riser, the BUH step in the BUH label, low-noise mode on the outdoor unit. (Pump and
  // defrost were already drawn — rotation + "PUMP n%", the ❄ pill + the reversed refrigerant loop.)
  const pumping = waterMoving(d);
  setTxt("svSpaceH", t(d.spaceOp ? "chip.space_on" : "chip.space_off"));
  $("gSpaceH").classList.toggle("on", d.spaceOp === true);
  const spaceKind = activeSpaceKind(d);
  setTxt("svSpaceCircuit", t(spaceKind === "cool" ? "schem.cooling"
                            : spaceKind === "heat" ? "schem.heating" : "schem.space_circuit"));
  // A non-breaking space: SVG collapses ordinary leading whitespace in a tspan, which would render
  // the step glued to the label ("BUH2").
  setTxt("svBuh", d.buh2 ? "\u00A02" : d.buh1 ? "\u00A01" : "");

  // Schematic badges
  // Outdoor air, outdoor heat exchanger and discharge come off the pages the outdoor unit stops refreshing when it stops
  // running (d.ouHeldOver): never assert the retained X10A number as current. Outdoor air may instead
  // carry the independent HomeHub register (`mbFields.out`); discharge has no such pairing and
  // keeps the ordinary "—". Petrol makes the replacement source visible without adding a caption.
  setTxt("svOut", ouReadingText(d, "out", d.out, fmt1)); setTxt("svRps", fmt0(d.rps));
  setTxt("svOuHx", ouReadingText(d, "ouHx", d.ouHx, fmt1));
  // High-side badge shows the circuit pressure (real refrigerant sensor when the compressor's own HP
  // transducer is idle-zero — see d.circP). Low/suction side has no equivalent at-rest gauge, so show
  // "—" rather than a misleading 0.0 bar when the compressor is off.
  setTxt("svHp", fmt1(d.circP));
  setTxt("svLp", !d.ouHeldOver && d.lp != null && d.lp > 0 ? fmt1(d.lp) : "—");
  setTxt("svDisch", ouReadingText(d, "disch", d.disch, fmt0)); setTxt("svEev", fmt0(d.eev));
  setTxt("svLwt", fmt1(d.lwt)); setTxt("svRwt", fmt1(d.ret));
  setTxt("svR2t", fmt1(d.r2t)); setTxt("svR3t", fmt1(d.r3t));
  setTxt("svValve2", d.valve2On == null ? "—" : t(d.valve2On ? "state.on" : "state.off"));
  setTxt("svFlowSwitch", d.flowSwitch == null ? "—" : t(d.flowSwitch ? "state.on" : "state.off"));
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
  setTxt("svPth", fmt1(d.pth));   // derived — applyThermalPlan already refuses pump-only circulation
  // THREE-VALUED, and that is the whole fix. `d.valveDhw === true` collapsed "I cannot read the
  // valve" into "heating", which is a positive claim: with X10A silent during a DHW run the drawing
  // routed the water round the radiators while the plant was charging the tank (compared against the
  // live X10A board, which showed the diverter on the tank in the same minute). Unknown now prints
  // the bare "3WV" that clearSchematic() already uses and animates NEITHER branch.
  const toDhw = d.valveDhw;                       // true | false | null(unknown)
  setTxt("svValve", toDhw == null ? "3WV" : t(toDhw ? "schem.to_dhw" : "schem.to_space"));

  // Schematic state classes drive the CSS animations (flows, fan, pump, BUH glow, defrost)
  const sc = $("schem");
  const compressorOn = compressorRunning(d);
  sc.classList.toggle("fan-on", compressorOn && d.defrost !== true);
  sc.classList.toggle("pump-on", pumping === true);
  sc.classList.toggle("buh-on", !!(d.buh1 || d.buh2));
  const bshActive = d.bsh === true;
  sc.classList.toggle("bsh-on", bshActive);
  sc.classList.toggle("defrost-on", d.defrost === true);
  sc.classList.toggle("quiet-on", d.quiet === true);
  sc.classList.toggle("valve2-on", d.valve2On === true);
  sc.classList.toggle("flow-switch-on", d.flowSwitch === true);
  // Water always moves in the same hydraulic direction, but its THERMAL role reverses in cooling:
  // the supply is cold and the return warm. With the compressor stopped neither colour is earned —
  // the live 57 °C case was residual heat being circulated, so use a neutral moving trace instead.
  const waterKind = waterThermalKind(d, pumping);
  sc.classList.toggle("cooling-mode", waterKind === "cool");
  sc.classList.toggle("water-neutral", waterKind === "neutral");
  // Mode 2 is evcc's boost / Daikin's Recommended on. The permanent pill changes colour without
  // implying that DHW is already running. The exact manufacturer mode remains written in the
  // HomeHub row, inspector and accessible name.
  sc.classList.toggle("sg-boost-on", d.sgMode === 2);
  updateSchematicStateA11y(d);
  // A BSH row is itself evidence that this profile has a DHW tank, even if its temperature did not
  // answer in this snapshot. Keep the branch visible so the active heater cannot disappear with it.
  sc.classList.toggle("no-dhw", d.tank == null && d.bsh == null);
  sc.classList.toggle("no-room", d.room == null);
  sc.classList.toggle("no-spaceh", d.spaceOp == null);
  const onCls = (id, on) => $(id).classList.toggle("on", !!on);
  onCls("fPhe", pumping);
  onCls("fSup1", pumping); onCls("fSup2", pumping); onCls("fSup3", pumping); onCls("fRet", pumping);
  // Each branch needs the valve to SAY so — `!toDhw` was true for an unknown valve, which is how the
  // heating branch came to animate on no evidence at all.
  const dhwPath = pumping && toDhw === true, heatPath = pumping && toDhw === false;
  onCls("fTank", dhwPath); onCls("fCoil", dhwPath); onCls("fTankRet", dhwPath);
  onCls("fHeat", heatPath); onCls("fHeatRet", heatPath);
  // Refrigerant direction is supportable only when both activity and the thermal task are known.
  // This is true for Modbus-only DHW, but deliberately not for a gateway-only Auto space cycle.
  const refrigerantOn = compressorOn && d.thermalMode != null;
  onCls("rfHot", refrigerantOn); onCls("rfPhe", refrigerantOn); onCls("rfCold", refrigerantOn);
  // Cooling and defrost both reverse the refrigerant circuit relative to ordinary heating/DHW.
  const refrigerantReverse = d.defrost === true || d.thermalMode === "cool";
  $("rfHot").classList.toggle("rev", refrigerantReverse);
  $("rfPhe").classList.toggle("rev", refrigerantReverse);
  $("rfCold").classList.toggle("rev", refrigerantReverse);

  // The derived figures that used to live in KPI tiles below the drawing, now at their place in it:
  // COP beside the heat output it is computed from, and the electrical input on the outdoor unit
  // where the power actually goes in.
  // What is NOT drawn: their longer annotations. The ΔT's target and the electrical figure's source
  // are in the inspector. The compact "≈" still matters in the closed drawing, but only for X10A's
  // current×230 V estimate; the HomeHub register is a measurement and pelApproxText removes it.
  setTxt("svCopLabel", d.efficiencyKind === "eer" ? "EER" : "COP");
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
//   • a COMPONENT (outdoor unit, PHE, space circuit, …) — carries its own `what` (nothing in
//     DESCRIPTIONS describes an assembly) plus `now(d)`, a sentence built from the live values that
//     says what the part is doing right now, and `rows`, the readings that belong to it.
// Copy is bilingual like DESCRIPTIONS ({en, de}); `now` returns the same shape.
const tx = (o) => (o == null ? "" : typeof o === "string" ? o : (LANG === "de" && o.de) ? o.de : o.en);
const degC = (n) => (n == null ? "—" : fmt1(n) + " °C");

const PEL_ESTIMATED_WHAT = {
  en: "A rough electrical-input ESTIMATE used as the COP or EER divisor. The UI adds available phase currents and multiplies by an assumed 230 V; it does not know actual voltage or power factor. Inverter current covers the compressor side only. CT currents can cover more loads, but the exact boundary depends on how the transformers are installed and wired.",
  de: "Eine grobe SCHÄTZUNG der elektrischen Aufnahme und der Nenner von COP oder EER. Die UI addiert verfügbare Phasenströme und multipliziert sie mit angenommenen 230 V; tatsächliche Spannung und Leistungsfaktor sind unbekannt. Der Inverterstrom deckt nur die Verdichterseite ab. Stromwandler können weitere Verbraucher erfassen; die genaue Bilanzgrenze hängt jedoch von Einbau und Verdrahtung ab.",
};
const PEL_MEASURED_WHAT = {
      en: "The electrical power-consumption value reported by the heat-pump system through HomeHub input register 51. Unlike X10A's current×230 V estimate, the UI does not calculate this number. The public HomeHub register guide does not establish its calibration, exact measurement point or whether every electric heater is included; do not treat it as a certified whole-plant meter.",
      de: "Der vom Wärmepumpensystem über HomeHub-Eingangsregister 51 gemeldete Wert zur elektrischen Leistungsaufnahme. Anders als die X10A-Schätzung aus Strom×230 V berechnet die UI diese Zahl nicht selbst. Die öffentliche HomeHub-Registerbeschreibung belegt weder Kalibrierung und genauen Messpunkt noch, ob jeder Elektroheizer enthalten ist; der Wert ist daher kein nachgewiesener Gesamtanlagen-Zähler.",
};
const pelMeasured = (d) => !!d && d.pelSrc === "MB";
const pelApproxText = (d) => d && d.pel != null && !pelMeasured(d) ? "≈ " : "";
const PEL_INSPECT = {
  t: (d) => pelMeasured(d)
    ? { en: "Electrical input (HomeHub)", de: "Stromaufnahme (HomeHub)" }
    : { en: "Electrical input (estimated)", de: "Geschätzte Stromaufnahme" },
  aria: { en: "Electrical input", de: "Stromaufnahme" },
  trend: "pel",
  what: (d) => pelMeasured(d) ? PEL_MEASURED_WHAT : PEL_ESTIMATED_WHAT,
  head: (d) => (d.pel == null ? "—" : pelApproxText(d) + fmt1(d.pel) + " kW"),
  // Four cases: the measured gateway row, either X10A current source, a held-over inverter row, or
  // no usable electrical source. Keeping this source-aware prevents a HomeHub measurement from
  // being explained as compressor current merely because it is not a CT estimate.
  now: (d) => d.pelHeld
    ? { en: "The compressor is off, so the inverter current this profile reads is left over from the last run rather than measured now — no input power or efficiency quotient can be stated.",
        de: "Der Verdichter steht, daher stammt der Inverterstrom dieses Profils vom letzten Lauf und ist kein aktueller Messwert — Leistungsaufnahme und Effizienzquotient lassen sich nicht angeben." }
    : d.pel == null
    ? { en: "No current reading on this profile, so no COP/EER can be derived either.",
        de: "Dieses Profil liefert keinen Strommesswert, daher lässt sich auch kein COP/EER ableiten." }
    : d.pelSrc === "MB"
    ? { en: "Reported through HomeHub input register 51; the exact measurement boundary is not documented here.",
        de: "Über HomeHub-Eingangsregister 51 gemeldet; die genaue Messgrenze ist hier nicht dokumentiert." }
    : d.pelSrc === "CT"
    ? { en: "Estimated from the CT clamps; included loads depend on their wiring.",
        de: "Aus den Stromwandlern geschätzt; welche Verbraucher enthalten sind, hängt von ihrer Verdrahtung ab." }
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
  // Board-local observation rather than a heat-pump register. Its custom renderer keeps all three
  // current measurements together and hands their three independent history rings to one combined
  // timeline; no X10A/HomeHub row is invented merely to fit the ordinary inspector path.
  env3: {
    t: { en: "Outdoor climate", de: "Außenklima" },
    aria: { en: "Outdoor climate from ENV III", de: "Außenklima vom ENV III" },
    env3: true,
  },
  sgrequest: {
    // Title, explainer and chart all follow d.sgSrc — the instrument that ACTUALLY answered. The
    // HomeHub register and the X10A contacts are different subjects (see liveData), so a fixed
    // "via Modbus" over an X10A-sourced number would be a false provenance on a correct reading.
    // The pill's FACE is unchanged either way: on a plant with no gateway every reading is X10A, so
    // marking this one would be noise, and DESIGN.md keeps provenance in the inspector regardless.
    // Both titles are deliberately the SAME LENGTH as each other. Measured at 390 px with a
    // "Recommended on" headline beside it, this title already wraps to five lines; the natural
    // "…via X10A contacts" / "…über X10A-Kontakte" took it to six, i.e. this change would have made
    // the narrow layout worse than it found it. "via X10A" names the instrument and the explainer
    // directly below says SG-Ready input contacts in full, so nothing is lost but the sixth line.
    t: (d) => sgInspectIsX10a(d)
      ? { en: "Smart-Grid request via X10A", de: "Smart-Grid-Anforderung über X10A" }
      : { en: "Smart-Grid request via Modbus", de: "Smart-Grid-Anforderung über Modbus" },
    trend: "smart_grid_mode",
    // Each source keeps its OWN 24-hour ring, so the chart must show the lane the headline came from
    // rather than a lane that may be empty (or, worse, the other instrument's day).
    trendSource: (d) => (sgInspectIsX10a(d) ? "x10a" : "modbus"),
    what: (d) => sgInspectIsX10a(d)
      ? {
        en: "The external Smart-Grid request as the unit's own SG-Ready input contacts report it: Free running, Forced off, Recommended on or Forced on. It is an energy-management command, not the outdoor unit's heating/cooling mode and not proof that a requested tank charge has started. These are the physical terminals, so a request sent to the plant over a network instead of a wired contact need not appear here.",
        de: "Die externe Smart-Grid-Anforderung, wie die SG-Ready-Eingangskontakte der Anlage sie melden: Freier Betrieb, Zwangsabschaltung, Empfehlung ein oder Erzwungen ein. Das ist ein Energiemanagement-Befehl und nicht der Heiz- oder Kühlmodus der Außeneinheit. Ebenso wenig belegt er, dass eine angeforderte Speicherladung bereits begonnen hat. Es sind die physischen Klemmen — eine Anforderung, die statt über einen verdrahteten Kontakt über das Netzwerk an die Anlage geht, muss hier nicht erscheinen.",
      }
      : {
        en: "The external Smart-Grid request read back from the HomeHub: Free running, Forced off, Recommended on or Forced on. It is an energy-management command, not the outdoor unit's heating/cooling mode and not proof that a requested tank charge has started.",
        de: "Die vom HomeHub zurückgelesene externe Smart-Grid-Anforderung: Freier Betrieb, Zwangsabschaltung, Empfehlung ein oder Erzwungen ein. Das ist ein Energiemanagement-Befehl und nicht der Heiz- oder Kühlmodus der Außeneinheit. Ebenso wenig belegt er, dass eine angeforderte Speicherladung bereits begonnen hat.",
      },
    head: (d) => sgModeText(d && d.sgMode),
    // Modes 0, 1 and 3 name no instrument ("the external energy manager", or nothing), so they read
    // correctly from either source and are deliberately left as one sentence each. Only the two that
    // DO name a reporter are split — and the unavailable case names none at all, since blaming a
    // HomeHub is wrong on a plant that has none.
    now: (d) => !d || d.sgMode == null
      ? { en: "No current Smart-Grid value is available.",
          de: "Es ist gerade kein aktueller Smart-Grid-Wert verfügbar." }
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? { en: "The SG-Ready contacts report Recommended on. This is the Smart-Grid state energy managers such as evcc use for boost. It requests extra buffering; DHW mode, the 3-way valve and flow separately show whether the unit is actually charging the tank.",
          de: "Die SG-Ready-Kontakte melden Empfehlung ein. Diesen Smart-Grid-Zustand verwenden Energiemanager wie evcc als Boost. Er fordert zusätzliches Puffern an; Warmwasser-Betriebsart, 3-Wege-Ventil und Durchfluss zeigen separat, ob die Anlage den Speicher tatsächlich lädt." }
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
      : compressorRunning(d)
        ? d.rps != null
          ? { en: `Running — compressor at ${fmt0(d.rps)} rps${d.quiet ? ", capped by quiet mode" : ""}.`,
              de: `Läuft — Verdichter mit ${fmt0(d.rps)} rps${d.quiet ? ", durch den Leise-Modus begrenzt" : ""}.` }
          : { en: "Running — the HomeHub reports the compressor ON; speed and detailed outdoor-unit readings require X10A.",
              de: "Läuft — der HomeHub meldet den Verdichter ON; Drehzahl und detaillierte Außengerätewerte benötigen X10A." }
        // Says why held X10A readings are not repeated at rest (logic/ou_stale.hpp). A structurally
        // paired HomeHub outdoor register may replace the held value; unpaired fields stay "—".
        : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
          ? { en: "Idle — the compressor is stopped, so no active heating or cooling transfer is taking place. X10A stops refreshing the outdoor unit's own sensors while it rests; outdoor air is therefore shown from the HomeHub Modbus register, while discharge temperature remains \"—\". The register is being read successfully but carries no source timestamp, so the age of the underlying measurement is unknown.",
              de: "Standby — der Verdichter steht, daher findet kein aktiver Heiz- oder Kühltransfer statt. X10A aktualisiert die eigenen Sensoren der Außeneinheit im Stillstand nicht mehr; die Außentemperatur stammt deshalb aus dem HomeHub-Modbus-Register, die Heißgastemperatur bleibt „—“. Das Register wird erfolgreich gelesen, trägt aber keinen Quellzeitstempel; das Alter der zugrunde liegenden Messung ist daher unbekannt." }
          : { en: "Idle — the compressor is stopped, so no active heating or cooling transfer is taking place. The outdoor unit also stops refreshing its own sensors while it rests, so outdoor air and discharge temperature read \"—\" rather than repeat the last run's values.",
              de: "Standby — der Verdichter steht, daher findet kein aktiver Heiz- oder Kühltransfer statt. Die Außeneinheit aktualisiert im Stillstand auch ihre eigenen Sensoren nicht mehr; Außenluft und Heißgastemperatur zeigen daher „—“ statt die Werte des letzten Laufs zu wiederholen." },
    rows: [/outdoor air/i, OUTDOOR_HX_RE, /inv frequency/i, /^high pressure$/i, /discharge pipe temp/i, /expansion valve ?1/i, /defrost operation/i],
  },
  comp: {
    t: { en: "Compressor", de: "Verdichter" },
    re: /inv frequency/i, sample: "INV frequency (rps)",
    rows: [/inv frequency/i, /inv primary current/i, /discharge pipe temp/i],
  },
  out: { t: { en: "Outdoor air", de: "Außentemperatur" }, re: /outdoor air/i, sample: "Outdoor Air Temp. (R1T)" },
  ouhx: {
    t: {
      en: "Outdoor heat-exchanger temperature (R4T)",
      de: "Außengeräte-Wärmetauschertemperatur · R4T",
    },
    re: OUTDOOR_HX_RE,
    sample: "O/U Heat Exch. Temp.(R4T)",
    trend: "outdoor_heat_exchanger",
    what: {
      en: "Temperature at the outdoor air heat exchanger. In heating mode the coil can fall below freezing and accumulate frost; its temperature and the defrost state together show when the controller is protecting and clearing the coil.",
      de: "Temperatur am Außenluft-Wärmetauscher. Im Heizbetrieb kann der Wärmetauscher unter den Gefrierpunkt fallen und bereifen; Temperatur und Abtaustatus zeigen gemeinsam, wann die Regelung den Wärmetauscher schützt und abtaut.",
    },
  },
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
    // Keep the last run visible as a curve while the compressor rests. The current 0x20 reading is
    // intentionally withheld then because the outdoor unit only repeats its held-over value, but
    // the history ring preserves the samples that were genuinely measured during operation.
    trend: "discharge",
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
  r3t: {
    t: { en: "Refrigerant liquid-side temperature (R3T)", de: "Kältemittel-Flüssigkeitstemperatur · R3T" },
    re: /refrig\. temp\. liquid side/i, sample: "Refrig. Temp. liquid side (R3T)",
    trend: "refrigerant_liquid",
    what: {
      en: "Temperature of the refrigerant on the liquid side of the indoor heat exchanger. It is a refrigerant sensor, not a water-return temperature.",
      de: "Temperatur des Kältemittels auf der Flüssigkeitsseite des Innenwärmetauschers. Das ist ein Kältemittelfühler und keine Wasser-Rücklauftemperatur.",
    },
  },
  phe: {
    t: { en: "Plate heat exchanger", de: "Plattenwärmetauscher" },
    what: {
      en: "The plate heat exchanger transfers energy between refrigerant and the water circuit without mixing the two fluids. In heating/DHW it transfers heat into the water; in cooling it removes heat from it. The displayed mode-aware capacity is estimated from water flow and R1T/R4T across the exchanger. Those sensors belong to the hydraulic unit; their exact physical installation depends on the model.",
      de: "Der Plattenwärmetauscher überträgt Energie zwischen Kältemittel und Wasserkreis, ohne dass sich beide Medien vermischen. Beim Heizen beziehungsweise bei Warmwasser geht Wärme ins Wasser, beim Kühlen wird sie ihm entzogen. Die angezeigte betriebsartabhängige Leistung wird aus Wasserdurchfluss sowie R1T/R4T über dem Wärmetauscher geschätzt. Diese Fühler gehören zur Hydraulikeinheit; ihre genaue Einbauposition hängt vom Modell ab.",
    },
    // With the pump stopped the ΔT is not a small working point, it is none at all (d.dtStale) — so
    // this says nothing is crossing, rather than quoting the two stagnant sensors' difference as if
    // it were driving a heat flow.
    now: (d) => !compressorRunning(d, 5)
      ? { en: "No active refrigerant-side transfer — the compressor is stopped. Pump-only circulation can redistribute residual heat, but it is neither heating nor cooling capacity.",
          de: "Kein aktiver Kältemittel-Wärmeübergang — der Verdichter steht. Reiner Pumpenumlauf kann Restwärme verteilen, ist aber weder Heiz- noch Kälteleistung." }
      : d.dtStale
      ? { en: "No water-side transfer can be calculated — current pump and flow readings do not establish water movement through the plates.",
          de: "Kein wasserseitiger Übergang berechenbar — die aktuellen Pumpen- und Durchflusswerte belegen keine Wasserbewegung durch die Platten." }
      : d.pth == null
      ? { en: "No directional estimate — the readings do not establish useful transfer in the selected operating mode.",
          de: "Keine gerichtete Schätzung — die Messwerte belegen im gewählten Betrieb keinen nutzbaren Energieübergang." }
      : d.pthKind === "cooling"
      ? { en: `About ${fmt1(d.pth)} kW removed from the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Dem Wasser werden rund ${fmt1(d.pth)} kW entzogen: ${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K.` }
      : { en: `About ${fmt1(d.pth)} kW transferred into the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Rund ${fmt1(d.pth)} kW gehen ins Wasser über: ${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K.` },
    rows: [lwtRow, /inlet water/i, /flow sensor/i],
  },
  lwt: {
    t: { en: "PHE water outlet (pre-BUH, R1T)", de: "PHE-Wasseraustritt · vor BUH · R1T" },
    pick: lwtRow,
    sample: "Leaving Water Temp. before BUH (R1T)",
  },
  r2t: {
    t: { en: "Leaving water after BUH (R2T)", de: "Vorlauf nach BUH · R2T" },
    pick: postBuhRow, sample: "Leaving water temp. after BUH (R2T)",
    trend: "leaving_water_post_buh",
    what: {
      en: "Water temperature reported after the backup heater. Unlike the pre-BUH R1T reading, it can include heat added by the electric heater. The exact position relative to the pump and field valves depends on the hydraulic unit.",
      de: "Hinter dem Zusatzheizer gemeldete Wassertemperatur. Anders als der R1T-Wert vor dem BUH kann sie die vom elektrischen Heizer eingebrachte Wärme enthalten. Die genaue Lage zu Pumpe und bauseitigen Ventilen hängt von der Hydraulikeinheit ab.",
    },
  },
  rwt: { t: { en: "PHE water inlet (R4T)", de: "PHE-Wassereintritt · R4T" }, re: /inlet water/i, sample: "Inlet Water Temp. (R4T)" },
  dt: {
    t: { en: "Water-side ΔT across the PHE", de: "Wasserseitiges ΔT am PHE" },
    trend: "dt",   // computed series — see DERIVED
    what: {
      en: "R1T at the PHE water outlet minus R4T at its inlet. It is calculated from two sensor readings, not read from a separate register. Together with flow it indicates transfer across the exchanger; the target depends on model, mode and emitter configuration. These internal sensors do not measure downstream emitter supply and return after the field piping.",
      de: "R1T am Wasseraustritt des PHE minus R4T an seinem Eintritt. Die Differenz wird aus zwei Fühlern berechnet und nicht aus einem eigenen Register gelesen. Zusammen mit dem Durchfluss beschreibt sie den Übergang am Wärmetauscher; das Ziel hängt von Modell, Betriebsart und eingestellter Heizflächenart ab. Diese internen Fühler messen nicht Vor- und Rücklauf an den nachgeschalteten Heiz-/Kühlflächen.",
    },
    // Blanks with the pill (d.dtStale) instead of restating the number the pill withheld, and says
    // why — the pill can only blank, the explainer is where the reason belongs.
    head: (d) => (d.dtStale || d.dt == null ? "—" : fmt1(d.dt) + " K"),
    now: (d) => d.dtStale
      ? { en: "No working ΔT right now — current pump and flow readings do not establish water movement. Without measured circulation, the two sensors can drift apart while cooling and their difference is not an operating point.",
          de: "Derzeit kein Arbeits-ΔT — die aktuellen Pumpen- und Durchflusswerte belegen keine Wasserbewegung. Ohne gemessene Zirkulation können die beiden Fühler beim Auskühlen auseinanderdriften; ihre Differenz ist dann kein Arbeitspunkt." }
      : d.dt == null ? null
      : !compressorRunning(d, 5)
      ? { en: `${fmt1(d.dt)} K with pump-only circulation. This is residual-temperature equalisation, not evidence of heating or cooling output.`,
          de: `${fmt1(d.dt)} K bei reinem Pumpenumlauf. Das ist ein Temperaturausgleich von Restwärme und kein Beleg für Heiz- oder Kälteleistung.` }
      : d.thermalMode === "cool"
      ? { en: `${fmt1(d.dt)} K. In active cooling R1T should be below R4T, so this signed difference is negative.`,
          de: `${fmt1(d.dt)} K. Beim aktiven Kühlen soll R1T unter R4T liegen; die vorzeichenbehaftete Differenz ist daher negativ.` }
      : { en: `${fmt1(d.dt)} K${d.dtSet != null ? ` against a ${fmt1(d.dtSet)} K heating target` : ""}. Positive means the PHE is adding heat to the water.`,
          de: `${fmt1(d.dt)} K${d.dtSet != null ? ` bei ${fmt1(d.dtSet)} K Heiz-Ziel` : ""}. Positiv bedeutet, dass der PHE dem Wasser Wärme zuführt.` },
    rows: [lwtRow, /inlet water/i, /target delta t heating/i],
  },
  pth: {
    t: (d) => d && d.pthKind === "cooling"
      ? { en: "Cooling capacity (estimated)", de: "Geschätzte Kälteleistung" }
      : { en: "Heat output (estimated)", de: "Geschätzte Wärmeleistung" },
    aria: { en: "Thermal capacity at the PHE (estimated)", de: "Geschätzte thermische Leistung am PHE" },
    trend: (d) => d && d.pthKind === "cooling" ? "" : "pth",
    what: (d) => d && d.pthKind === "cooling"
      ? { en: "An ESTIMATE of heat removed from the water: flow × (R4T−R1T) × 4.186 kJ/kg·K, assuming water. Accuracy depends on the flow sensor, both temperature sensors and the actual fluid; glycol mixtures need different density and heat capacity. It is shown only with a running compressor and the cooling-direction temperature difference. R1T/R4T are internal PHE sensors, not downstream emitter sensors.",
          de: "Eine SCHÄTZUNG der dem Wasser entzogenen Wärme: Durchfluss × (R4T−R1T) × 4,186 kJ/kg·K unter Annahme von Wasser. Die Genauigkeit hängt vom Durchflusssensor, beiden Temperaturfühlern und dem tatsächlichen Medium ab; Glykolgemische benötigen andere Dichte und Wärmekapazität. Sie erscheint nur bei laufendem Verdichter und Temperaturdifferenz in Kühlrichtung. R1T/R4T sind interne PHE-Fühler und keine Fühler an den nachgeschalteten Flächen." }
      : { en: "An ESTIMATE of heat transferred into the water: flow × (R1T−R4T) × 4.186 kJ/kg·K, assuming water. Accuracy depends on the flow sensor, both temperature sensors and the actual fluid; glycol mixtures need different density and heat capacity. It is shown only with a running compressor and the heating-direction temperature difference. The backup heater sits after R1T and is outside this figure.",
          de: "Eine SCHÄTZUNG der ins Wasser übertragenen Wärme: Durchfluss × (R1T−R4T) × 4,186 kJ/kg·K unter Annahme von Wasser. Die Genauigkeit hängt vom Durchflusssensor, beiden Temperaturfühlern und dem tatsächlichen Medium ab; Glykolgemische benötigen andere Dichte und Wärmekapazität. Sie erscheint nur bei laufendem Verdichter und Temperaturdifferenz in Heizrichtung. Der Zusatzheizer sitzt hinter R1T und ist in diesem Wert nicht enthalten." },
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
          ? { en: "No heat transfer across the PHE can be calculated because current pump and flow readings do not establish circulation. The tank can still be heated by its internal electric heater; its heat crosses neither PHE water sensor, so this bus cannot state that heater's output.",
              de: "Am PHE ist keine Wärmeübertragung berechenbar, weil die aktuellen Pumpen- und Durchflusswerte keine Zirkulation belegen. Der Speicher kann trotzdem durch seinen internen Heizstab erwärmt werden; dessen Wärme passiert keinen der beiden PHE-Wasserfühler, daher kann dieser Bus seine Heizleistung nicht angeben." }
          : { en: "No heat output can be calculated right now because current pump and flow readings do not establish water movement through the PHE. This is no usable operating point rather than an output of zero.",
              de: "Derzeit ist keine Wärmeleistung berechenbar, weil die aktuellen Pumpen- und Durchflusswerte keine Wasserbewegung durch den PHE belegen. Das ist kein nutzbarer Arbeitspunkt und nicht eine Leistung von null." })
      : d.pth == null ? null
      : d.pthKind === "cooling"
      ? { en: `≈ ${fmt1(d.pth)} kW cooling${d.cop != null ? `, EER ${d.cop.toFixed(1)}` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW Kälteleistung${d.cop != null ? `; EER ${d.cop.toFixed(1)}` : ""}.` }
      : { en: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${d.cop.toFixed(1)}` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${d.cop.toFixed(1)}` : ""}.` },
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
    t: (d) => d && d.efficiencyKind === "eer"
      ? { en: "EER of the heat pump (estimated)", de: "Geschätzter EER der Wärmepumpe" }
      : (d && d.copScope === "plant"
      ? { en: "COP with post-BUH boundary (estimated)", de: "Geschätzter COP mit Bilanz hinter BUH" }
      : { en: "COP of the heat pump (estimated)", de: "Geschätzter COP der Wärmepumpe" }),
    // The hit target's accessible name — stable, because it is applied once at startup (see
    // labelSchematicHits). Which COP it turns out to be is the panel's to say, not the label's.
    aria: { en: "Efficiency (estimated)", de: "Geschätzte Effizienz" },
    trend: (d) => d && d.efficiencyKind === "eer" ? "" : "cop",
    what: (d) => d && d.efficiencyKind === "eer"
      ? { en: "Estimated cooling capacity divided by estimated electrical input. The cooling numerator uses internal PHE sensors and is accepted only with a running compressor and R1T below R4T. The result inherits the water/glycol, sensor, voltage and power-factor assumptions of both estimates. Daikin also describes calculated energy figures as estimates whose accuracy is not guaranteed. This is an instantaneous EER, not a seasonal efficiency figure; metered seasonal energy is more meaningful.",
          de: "Geschätzte Kälteleistung geteilt durch geschätzte elektrische Aufnahme. Der Kühlzähler nutzt die internen PHE-Fühler und wird nur bei laufendem Verdichter sowie R1T unter R4T gewertet. Das Ergebnis übernimmt alle Annahmen zu Wasser oder Glykol, Fühlern, Spannung und Leistungsfaktor aus beiden Schätzungen. Auch Daikin bezeichnet berechnete Energiewerte als Schätzungen ohne garantierte Genauigkeit. Das ist ein momentaner EER und keine saisonale Effizienzkennzahl; aussagekräftiger ist saisonal gemessene Energie." }
      : {
      en: "Estimated heat output divided by estimated electrical input. The two values must describe compatible boundaries: with CT currents the UI uses heat after the backup heater when that sensor exists; with inverter current it shows the heat pump alone. Whether the CTs include every relevant electrical load depends on their installation, so this is not automatically a whole-plant meter. The result inherits the fluid, sensor, voltage and power-factor assumptions of both estimates. Use it as a live indication; metered seasonal energy is more meaningful. With the compressor stopped it shows \"—\".",
      de: "Geschätzte Wärmeleistung geteilt durch geschätzte elektrische Aufnahme. Beide Werte müssen zueinander passende Bilanzgrenzen beschreiben: Bei Stromwandlern verwendet die UI die Wärme hinter dem Zusatzheizer, sofern dieser Fühler vorhanden ist; beim Inverterstrom zeigt sie nur die Wärmepumpe. Ob die Stromwandler alle relevanten elektrischen Verbraucher erfassen, hängt von ihrem Einbau ab; der Wert ist daher nicht automatisch ein Gesamtanlagen-Zähler. Das Ergebnis übernimmt die Annahmen zu Medium, Fühlern, Spannung und Leistungsfaktor aus beiden Schätzungen. Als Live-Hinweis verwenden; aussagekräftiger ist saisonal gemessene Energie. Bei stehendem Verdichter zeigt er „—“.",
      },
    head: (d) => (d.cop == null ? "—" : d.cop.toFixed(1)),
    // Every block reason gets its OWN sentence. A suppressed wrong claim must not be replaced by
    // another one, so "the heater is firing and this profile has no post-BUH sensor", "the gateway
    // measures a different system" and "there is no current reading at all" cannot share a sentence
    // — they are different facts about the hardware, and two of them named a code that reached no
    // sentence at all, leaving the generic explainer beside a blank pill whose title still claimed
    // a heat-pump boundary.
    now: (d) => d.copBlock === "tank_heater"
      ? { en: "No COP right now — the tank's electric heater is on. Its electrical load may be included in the available current boundary, while its heat goes straight into the tank and crosses neither leaving-water sensor. These readings cannot form a matching efficiency balance.",
          de: "Derzeit kein COP — der Heizstab im Speicher läuft. Seine elektrische Last kann in der verfügbaren Strombilanz enthalten sein; seine Wärme geht jedoch direkt in den Speicher und passiert keinen der Vorlauffühler. Aus diesen Messwerten entsteht deshalb keine passende Effizienzbilanz." }
      : d.copBlock === "buh_no_r2t"
      ? { en: "No COP right now — the backup heater is firing, but this profile has no leaving-water sensor after it. The electrical estimate can include heater load while the heat estimate stops before the heater, so the two boundaries do not match.",
          de: "Derzeit kein COP — der Zusatzheizer heizt, aber dieses Profil hat keinen Vorlauffühler hinter ihm. Die Stromschätzung kann die Heizlast enthalten, während die Wärmeschätzung vor dem Heizer endet; beide Bilanzgrenzen passen daher nicht zusammen." }
      // The X10A bus is silent and the HomeHub is carrying the drawing. Its power register measures
      // the WHOLE unit including both heaters, while the heat figure is the plate exchanger alone —
      // and the gateway map carries neither heater state nor a post-BUH row, so unlike the X10A path
      // there is nothing here to decide the pairing WITH.
      : d.copBlock === "mb_scope"
      ? { en: "No COP right now — the X10A bus is silent, so these readings come from the HomeHub. Its power figure covers the whole unit including both electric heaters, while the heat figure covers the heat exchanger alone, and this source reports neither heater state nor a post-heater sensor to match the two boundaries. A quotient of the two would describe two different systems.",
          de: "Derzeit kein COP — der X10A-Bus schweigt, daher stammen diese Messwerte vom HomeHub. Dessen Leistungswert erfasst das gesamte Gerät einschließlich beider Elektroheizer, der Wärmewert dagegen nur den Wärmetauscher; zudem meldet diese Quelle weder den Heizerzustand noch einen Fühler hinter dem Heizer, um beide Bilanzgrenzen anzugleichen. Ein Quotient aus beiden beschriebe zwei verschiedene Systeme." }
      // No usable electrical input at all. Which of the two reasons it is matters — the pill's own
      // explainer draws the same distinction, and saying "this profile has no row" about a profile
      // that has one would substitute a second wrong claim for the suppressed one.
      : d.copBlock === "no_pel"
      ? (d.pelHeld
        ? { en: "No COP right now — the compressor is off, so the inverter current this profile reads is left over from the last run rather than measured now. Without a current electrical input there is nothing to divide by.",
            de: "Derzeit kein COP — der Verdichter steht, daher stammt der Inverterstrom dieses Profils vom letzten Lauf und ist kein aktueller Messwert. Ohne aktuelle Leistungsaufnahme lässt sich kein Effizienzquotient bilden." }
        : { en: "No COP right now — this profile reports no electrical input at all (neither CT clamps nor an inverter current), so no efficiency quotient can be formed.",
            de: "Derzeit kein COP — dieses Profil meldet überhaupt keine elektrische Aufnahme (weder Stromwandler noch Inverterstrom), daher lässt sich kein Effizienzquotient bilden." })
      : d.cop == null ? null
      : d.efficiencyKind === "eer"
      ? { en: `${d.cop.toFixed(1)} kW of cooling per kW of electricity — ≈ ${fmt1(d.copPth)} kW removed for ≈ ${fmt1(d.pel)} kW in.`,
          de: `${d.cop.toFixed(1)} kW Kälteleistung je kW Strom — ≈ ${fmt1(d.copPth)} kW entzogen bei ≈ ${fmt1(d.pel)} kW Aufnahme.` }
      : d.copScope === "plant"
      ? { en: `${d.cop.toFixed(1)} kW of post-BUH water-side heat per kW of CT-estimated electricity — ≈ ${fmt1(d.copPth)} kW out for ≈ ${fmt1(d.pel)} kW in. The CT installation determines which electrical loads are included.`,
          de: `${d.cop.toFixed(1)} kW wasserseitige Wärme hinter dem BUH je kW aus Stromwandlern geschätzter Aufnahme — ≈ ${fmt1(d.copPth)} kW raus für ≈ ${fmt1(d.pel)} kW rein. Welche elektrischen Lasten enthalten sind, bestimmt der Einbau der Stromwandler.` }
      : { en: `${d.cop.toFixed(1)} kW of heat per kW of electricity for the heat-pump boundary — ≈ ${fmt1(d.copPth)} kW out for ≈ ${fmt1(d.pel)} kW in. The backup heater is outside both figures; whole-plant efficiency therefore cannot be derived from this value while the heater runs.`,
          de: `${d.cop.toFixed(1)} kW Wärme je kW Strom innerhalb der Wärmepumpen-Bilanz — ≈ ${fmt1(d.copPth)} kW raus für ≈ ${fmt1(d.pel)} kW rein. Der Zusatzheizer liegt außerhalb beider Bilanzgrößen; die Effizienz der Gesamtanlage lässt sich daraus während seines Betriebs nicht ableiten.` },
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
    trend: "buh_state",
    now: (d) => (d.buh1 == null && d.buh2 == null) ? null
      : d.buh2 ? { en: "Step 2 — both stages firing.", de: "Stufe 2 — beide Stufen heizen." }
      : d.buh1 ? { en: "Step 1 — one stage firing.", de: "Stufe 1 — eine Stufe heizt." }
      : { en: "Off — no backup-heater stage is active.", de: "Aus — keine Zusatzheizerstufe ist aktiv." },
    rows: [/buh step ?1/i, /buh step ?2/i, /buh output capacity/i],
  },
  bsh: {
    t: { en: "Electric tank heater", de: "Heizstab" },
    re: /^bsh$/i, sample: "BSH",
    // This panel deliberately presents only the physical X10A BSH contact and its sampled X10A
    // timeline: no HomeHub second opinion and no whole-system power context.
    x10aOnly: true,
    trend: "bsh_state",
    trendSource: "x10a",
    // Replace the raw bit (1/0) in the headline with its actual meaning. The source line remains
    // "BSH", so the friendly state is still traceable to the exact X10A register.
    head: () => {
      const on = x10aDown() ? null : vOn(/^bsh$/i);
      return on == null ? "—" : t(on ? "state.on" : "state.off");
    },
    now: () => {
      const on = x10aDown() ? null : vOn(/^bsh$/i);
      return on == null ? null
      : on
        ? { en: "Electric tank heater active.", de: "Heizstab aktiv." }
        : { en: "Off — the tank is not using its electric immersion heater.",
            de: "OFF — der Heizstab im Speicher ist nicht aktiv." };
    },
  },
  valve: {
    t: { en: "3-way valve", de: "3-Wege-Ventil" },
    re: /3.?way valve/i, sample: "3-way valve (On:DHW/Off:Space)",
    trend: "valve_dhw",
    now: (d) => d.valveDhw == null ? null
      : d.valveDhw ? { en: "The controller reports the tank route selected. This is not mechanical position feedback and does not by itself prove flow or tank charging.",
                       de: "Die Regelung meldet den Speicherweg als gewählt. Das ist keine mechanische Stellungsrückmeldung und belegt allein weder Durchfluss noch Speicherladung." }
                   : { en: "The controller reports the space route selected. This is not mechanical position feedback and does not by itself prove circulation.",
                       de: "Die Regelung meldet den Raumweg als gewählt. Das ist keine mechanische Stellungsrückmeldung und belegt allein keine Zirkulation." },
  },
  valve2: {
    t: { en: "2-way-valve output", de: "2-Wege-Ventil-Ausgang" },
    re: /2.?way valve/i, sample: "2way valve(On:Heat_Off:Cool)", trend: "valve_heat",
    head: (d) => d.valve2On == null ? "—" : t(d.valve2On ? "state.on" : "state.off"),
    now: (d) => d.valve2On == null ? null : d.valve2On
      ? { en: "X10A reports the 2-way-valve output ON. This alone proves neither active Heating nor the mechanical valve position; check operating mode and space operation separately.",
          de: "X10A meldet für den 2WV-Ausgang ON. Das allein beweist weder aktiven Heizbetrieb noch die mechanische Ventilstellung; Betriebsart und Raumbetrieb separat prüfen." }
      : { en: "X10A reports the 2-way-valve output OFF. This alone does not mean Cooling or contradict a configured Heating mode, especially while space operation is idle.",
          de: "X10A meldet für den 2WV-Ausgang OFF. Daraus allein folgt weder Kühlbetrieb noch ein Widerspruch zur eingestellten Betriebsart Heizen – besonders wenn der Raumbetrieb ruht." },
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
    t: (d) => activeSpaceKind(d) === "cool"
      ? { en: "Cooling circuit", de: "Kühlkreis" }
      : activeSpaceKind(d) === "heat"
      ? { en: "Heating circuit", de: "Heizkreis" }
      : { en: "Space circuit", de: "Raumkreis" },
    what: {
      en: "The installation's room emitters on the space branch. Depending on the installed emitters and configuration they can deliver heating, cooling, or both. The selected valve route and measured flow describe the hydraulic path; R1T/R4T are measured at the heat pump's hydraulic circuit and do not confirm the downstream emitter temperature.",
      de: "Die Raumflächen der Installation am Raumzweig. Je nach verbauten Flächen und Konfiguration können sie heizen, kühlen oder beides. Gewählter Ventilweg und gemessener Durchfluss beschreiben den hydraulischen Pfad; R1T/R4T werden im Hydraulikkreis der Wärmepumpe erfasst und bestätigen nicht die Temperatur an den nachgeschalteten Flächen.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "The space route is not selected. Whether water is actually moving through the tank branch is shown separately by pump and flow readings.",
          de: "Der Raumweg ist nicht gewählt. Ob tatsächlich Wasser durch den Speicherzweig fließt, zeigen Pumpen- und Durchflusswert separat." }
      : waterMoving(d)
        ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
          ? { en: `Residual-hot water is routed into the hydraulic space branch. Internal R1T is ${degC(d.lwt)}; no downstream sensor confirms the emitter temperature. This is not active cooling.`,
              de: `Restwarmes Wasser wird hydraulisch in den Raumzweig geführt. Der interne R1T misst ${degC(d.lwt)}; kein nachgeschalteter Fühler bestätigt die Temperatur an den Flächen. Das ist kein aktiver Kühlbetrieb.` }
          : { en: `Water is routed toward the ${activeSpaceKind(d) === "cool" ? "cooling" : activeSpaceKind(d) === "heat" ? "heating" : "space"} circuit. Internal R1T is ${degC(d.lwt)}; no downstream sensor confirms the emitter temperature.`,
              de: `Wasser wird zum ${activeSpaceKind(d) === "cool" ? "Kühlkreis" : activeSpaceKind(d) === "heat" ? "Heizkreis" : "Raumkreis"} geführt. Der interne R1T misst ${degC(d.lwt)}; kein nachgeschalteter Fühler bestätigt die Flächentemperatur.` }
        : { en: "Current pump and flow readings do not establish circulation through the space branch.",
            de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation durch den Raumzweig." },
    rows: [/^indoor ambient temp/i, /^rt setpoint/i, /^space heating operation/i],
  },
  // This catalog row is normal space heat/cool operation, not a heating demand. "Thermostat ON/OFF"
  // remains with the indoor-unit status byte; neither bit alone proves compressor operation.
  spaceh: {
    t: { en: "Space heating/cooling operation", de: "Raumheiz-/kühlbetrieb" },
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
    aria: { en: "Circulation-pump speed", de: "Drehzahl der Umwälzpumpe" },
    trend: "pump_speed",
    what: {
      en: "Circulates water through the common hydronic loop and the branch selected by the 3-way valve. In the split-system layout shown, it is on the supply side after the plate heat exchanger and backup heater. The controller adjusts its speed according to operating mode, target ΔT and minimum-flow requirements; it may also run with the compressor stopped for overrun, protection or temperature equalisation.",
      de: "Fördert Wasser durch den gemeinsamen Hydraulikkreis und den vom 3-Wege-Ventil gewählten Zweig. Im gezeigten Split-System-Aufbau sitzt sie im Vorlauf hinter Plattenwärmetauscher und Zusatzheizer. Der Regler passt ihre Drehzahl an Betriebsart, Ziel-ΔT und Mindestdurchfluss an; für Nachlauf, Schutz oder Temperaturausgleich kann sie auch bei stehendem Verdichter laufen.",
    },
    re: /water pump operation/i, sample: "Water pump operation",
    // 0 % is a stopped pump, not a pump "running at 0 %" — the old wording asserted circulation on
    // an idle plant, next to a flow pill reading 0.0 l/min.
    now: (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d)
        ? { en: `The internal pump reports stopped, but the flow sensor reports ${fmt1(d.flow)} l/min. External circulation, coast-down or conflicting/stale signals can cause this; the two readings must be checked together.`,
            de: `Die interne Pumpe meldet Stillstand, der Durchflusssensor jedoch ${fmt1(d.flow)} l/min. Externe Umwälzung, Nachlauf oder widersprüchliche beziehungsweise veraltete Signale kommen infrage; beide Werte müssen gemeinsam geprüft werden.` }
      : d.pump != null && d.pump > 0
        ? d.flow != null
          ? { en: `The speed signal reports ${fmt0(d.pump)} %; measured flow is ${fmt1(d.flow)} l/min.`,
              de: `Das Drehzahlsignal meldet ${fmt0(d.pump)} %; der gemessene Volumenstrom beträgt ${fmt1(d.flow)} l/min.` }
          : { en: `The speed signal reports ${fmt0(d.pump)} %, but no flow measurement is available; circulation is not confirmed.`,
              de: `Das Drehzahlsignal meldet ${fmt0(d.pump)} %, ein Durchflussmesswert fehlt jedoch; Zirkulation ist damit nicht bestätigt.` }
      : waterMoving(d)
        ? { en: `The flow sensor reports ${fmt1(d.flow)} l/min even though no usable pump-speed value is available.`,
            de: `Der Durchflusssensor meldet ${fmt1(d.flow)} l/min, obwohl kein nutzbarer Pumpendrehzahlwert vorliegt.` }
      : d.pumpOn === true
        ? d.flow != null
          ? { en: `The pump status is ON, but the flow sensor reports only ${fmt1(d.flow)} l/min; water circulation is not established.`,
              de: `Der Pumpenstatus ist ON, der Durchflusssensor meldet jedoch nur ${fmt1(d.flow)} l/min; Wasserzirkulation ist damit nicht belegt.` }
          : { en: "The pump status is ON, but no flow measurement is available; water circulation is not confirmed.",
              de: "Der Pumpenstatus ist ON, ein Durchflussmesswert fehlt jedoch; Wasserzirkulation ist damit nicht bestätigt." }
      : d.pumpOn === false || d.pump === 0
        ? d.flow != null
          ? { en: `The pump reports stopped; the flow sensor reports ${fmt1(d.flow)} l/min. These readings do not establish water circulation.`,
              de: `Die Pumpe meldet Stillstand; der Durchflusssensor meldet ${fmt1(d.flow)} l/min. Diese Werte belegen keine Wasserzirkulation.` }
          : { en: "The pump reports stopped and no flow measurement is available.",
              de: "Die Pumpe meldet Stillstand; ein Durchflussmesswert ist nicht verfügbar." }
        : { en: `No reliable pump state is available; the flow sensor reports ${fmt1(d.flow)} l/min and does not establish circulation.`,
            de: `Kein verlässlicher Pumpenstatus ist verfügbar; der Durchflusssensor meldet ${fmt1(d.flow)} l/min und belegt keine Zirkulation.` },
    rows: [/water pump signal/i, /flow sensor/i, /^water pressure$/i],
  },
  pel: PEL_INSPECT,
  defrost: {
    t: { en: "Defrost", de: "Abtauen" },
    re: /defrost operation/i, sample: "Defrost Operation",
    trend: "defrost_state",
    now: (d) => d.defrost == null ? null : d.defrost
      ? { en: "Defrost is active.", de: "Abtauen ist aktiv." }
      : { en: "Off — no defrost cycle is active.", de: "Aus — kein Abtauvorgang ist aktiv." },
  },
  quiet: {
    t: { en: "Quiet mode", de: "Leise-Modus" },
    re: /low noise control|silent mode/i, sample: "Low noise control",
    trend: "quiet_state",
    now: (d) => d.quiet == null ? null : d.quiet
      ? { en: "Quiet mode is active.", de: "Der Leise-Modus ist aktiv." }
      : { en: "Off — quiet mode is not active.", de: "Aus — der Leise-Modus ist nicht aktiv." },
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
    now: (d) => compressorRunning(d)
      ? d.rps != null
        ? { en: `Flowing — ${fmt1(d.circP)} bar at ${fmt0(d.disch)} °C.`,
            de: `Durchströmt — ${fmt1(d.circP)} bar bei ${fmt0(d.disch)} °C.` }
        : { en: "Flowing — the HomeHub confirms compressor operation; pressure and discharge temperature require X10A.",
            de: "Durchströmt — der HomeHub bestätigt Verdichterbetrieb; Druck und Heißgastemperatur benötigen X10A." }
      : { en: "No active refrigerant circulation — the compressor is stopped. Pressure equalisation depends on the circuit and how long it has been idle.",
          de: "Kein aktiver Kältemittelumlauf — der Verdichter steht. Ob und wie weit sich die Drücke angeglichen haben, hängt vom Kältekreis und der Stillstandszeit ab." },
    rows: [/^high pressure$/i, /discharge pipe temp/i],
  },
  rcold: {
    t: { en: "Liquid line", de: "Flüssigkeitsleitung" },
    what: {
      en: "The liquid line between outdoor and indoor units in the split-system layout shown. In heating, condensed high-pressure refrigerant returns through this line to the outdoor expansion valve. Downstream of that valve its pressure and temperature fall before it absorbs heat in the outdoor coil. In cooling, the direction reverses. Monobloc systems do not have this field refrigerant line.",
      de: "Die Flüssigkeitsleitung zwischen Außen- und Inneneinheit im gezeigten Split-System-Aufbau. Im Heizbetrieb fließt kondensiertes Kältemittel unter hohem Druck durch diese Leitung zum Expansionsventil im Außengerät zurück. Hinter dem Ventil sinken Druck und Temperatur, bevor es im Außenwärmetauscher Wärme aufnimmt. Im Kühlbetrieb kehrt sich die Richtung um. Monoblock-Anlagen haben diese bauseitige Kältemittelleitung nicht.",
    },
    now: (d) => compressorRunning(d)
      ? d.rps != null
        ? { en: `Flowing — expansion valve at ${fmt0(d.eev)} pulses.`,
            de: `Durchströmt — Expansionsventil bei ${fmt0(d.eev)} Impulsen.` }
        : { en: "Flowing — the HomeHub confirms compressor operation; expansion-valve position requires X10A.",
            de: "Durchströmt — der HomeHub bestätigt Verdichterbetrieb; die Stellung des Expansionsventils benötigt X10A." }
      : { en: "Still — the compressor is stopped.", de: "Steht — der Verdichter ist OFF." },
    rows: [/^low pressure$/i, /expansion valve ?1/i],
  },
  wsup: {
    t: { en: "PHE outlet pipe", de: "Leitung ab PHE-Austritt" },
    what: {
      en: "Supply water leaving the plate heat exchanger at R1T. In the split-system layout shown it passes the electric backup heater and circulation pump before the 3-way valve routes it to the space or tank circuit. In heating/DHW it is the warm side; in active cooling it is the cold side. R1T describes the heat-pump exchanger before the backup heater and field branches; a post-BUH sensor also includes electric heat added downstream.",
      de: "Vorlaufwasser am Austritt des Plattenwärmetauschers bei R1T. Im gezeigten Split-System-Aufbau passiert es den elektrischen Zusatzheizer und die Umwälzpumpe, bevor das 3-Wege-Ventil es zum Raum- oder Speicherkreis leitet. Beim Heizen bzw. bei Warmwasser ist dies die warme Seite, beim aktiven Kühlen die kalte. R1T beschreibt den Wärmepumpen-Wärmetauscher vor Zusatzheizer und bauseitigen Zweigen; ein Fühler hinter dem BUH enthält zusätzlich die danach eingebrachte elektrische Wärme.",
    },
    now: (d) => waterMoving(d)
      ? { en: `R1T reports ${degC(d.lwt)} before the backup heater at ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; a backup-heater stage is active downstream" : ""}.`,
          de: `R1T meldet vor dem Zusatzheizer ${degC(d.lwt)} bei ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; dahinter ist eine Zusatzheizerstufe aktiv" : ""}.` }
      : { en: "Current pump and flow readings do not establish circulation in this pipe.",
          de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation in dieser Leitung." },
    rows: [lwtRow, /flow sensor/i],
  },
  wtank: {
    t: { en: "Tank circuit", de: "Speicherkreis" },
    what: {
      en: "The hydraulic branch used to charge the domestic-hot-water tank or thermal store. The exact heat exchanger differs by tank design: it can be a coil, an integrated charging circuit or a fresh-water storage arrangement. The drawing shows the function, not the model-specific internals. In this diverted layout, charging the tank pauses direct flow to the space branch.",
      de: "Der hydraulische Zweig zum Laden des Warmwasser- oder Wärmespeichers. Der genaue Wärmetauscher hängt von der Speicherbauart ab: möglich sind eine Wendel, ein integrierter Ladekreis oder ein Frischwasserspeicher-Aufbau. Die Zeichnung zeigt die Funktion, nicht den modellspezifischen Innenaufbau. In diesem Umschaltaufbau pausiert während der Speicherladung der direkte Durchfluss zum Raumkreis.",
    },
    now: (d) => d.valveDhw === true
      ? waterMoving(d)
        ? { en: `The tank route is selected and measured flow is ${fmt1(d.flow)} l/min; water at the PHE outlet is ${degC(d.lwt)} and the tank sensor reads ${degC(d.tank)}.`,
            de: `Der Speicherweg ist gewählt und der gemessene Volumenstrom beträgt ${fmt1(d.flow)} l/min; am PHE-Austritt liegen ${degC(d.lwt)} an, der Speicherfühler meldet ${degC(d.tank)}.` }
        : { en: "The tank route is selected, but current pump and flow readings do not establish an active tank charge.",
            de: "Der Speicherweg ist gewählt, die aktuellen Pumpen- und Durchflusswerte belegen jedoch keine aktive Speicherladung." }
      : { en: "The tank route is not selected; the controller reports the space route instead.",
          de: "Der Speicherweg ist nicht gewählt; die Regelung meldet stattdessen den Raumweg." },
    rows: [/dhw tank temp/i, /dhw setpoint/i, /3.?way valve/i],
  },
  wheat: {
    // Titled for the CIRCUIT, not one leg of it: this target is both the flow down from the valve
    // and the return back to the merge, like the tank branch's, and the copy already read that way.
    t: (d) => activeSpaceKind(d) === "cool"
      ? { en: "Cooling branch", de: "Kühlkreis" }
      : activeSpaceKind(d) === "heat"
      ? { en: "Heating branch", de: "Heizkreis" }
      : { en: "Space branch", de: "Raumkreis" },
    what: {
      en: "The branch supplying radiators, underfloor loops, fan coils or other room emitters. The installed emitters and controller configuration decide whether it can heat, cool, or both. In heating the return is normally cooler; in cooling it is normally warmer. R1T/R4T are measured at the heat pump's hydraulic circuit, so they cannot prove temperatures at this field branch. The displayed ΔT also includes pipe and distribution effects and is not a direct room-load measurement.",
      de: "Der Zweig zu Heizkörpern, Fußbodenheizung, Gebläsekonvektoren oder anderen Raumflächen. Verbaute Flächen und Reglerkonfiguration entscheiden, ob er heizen, kühlen oder beides kann. Beim Heizen ist der Rücklauf normalerweise kühler, beim Kühlen wärmer. R1T/R4T werden am Wärmepumpen-Hydraulikkreis gemessen und belegen daher nicht die Temperaturen an diesem bauseitigen Zweig. Das angezeigte ΔT enthält zudem Rohr- und Verteileffekte und ist keine direkte Messung der Raumlast.",
    },
    now: (d) => d.valveDhw === true
      ? { en: "The space route is not selected; the controller reports the tank route instead.",
          de: "Der Raumweg ist nicht gewählt; die Regelung meldet stattdessen den Speicherweg." }
      : waterMoving(d)
        ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
          ? { en: `Residual-heat circulation toward the hydraulic space branch at ${fmt1(d.flow)} l/min; no active cooling. Internal PHE sensors read R1T ${degC(d.lwt)} and R4T ${degC(d.ret)}; the field-side temperature is not measured.`,
              de: `Restwärme-Umlauf zum hydraulischen Raumzweig mit ${fmt1(d.flow)} l/min; keine aktive Kühlung. Die internen PHE-Fühler messen R1T ${degC(d.lwt)} und R4T ${degC(d.ret)}; die Temperatur auf der Feldseite wird nicht gemessen.` }
          : { en: `Circulating toward the space branch at ${fmt1(d.flow)} l/min. Internal PHE sensors read R1T ${degC(d.lwt)} and R4T ${degC(d.ret)}.`,
              de: `Zirkulation zum Raumkreis mit ${fmt1(d.flow)} l/min. Die internen PHE-Fühler messen R1T ${degC(d.lwt)} und R4T ${degC(d.ret)}.` }
        : { en: "Current pump and flow readings do not establish circulation through the space branch.",
            de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation durch den Raumzweig." },
    rows: [lwtRow, /inlet water/i, /^space heating operation/i],
  },
  wret: {
    t: { en: "PHE inlet pipe", de: "Leitung zum PHE-Eintritt" },
    what: {
      en: "The common return pipe into the PHE water inlet R4T after the tank and space branches merge. In the split-system layout shown it passes the water-side sensors before reaching the exchanger. In heating it is normally cooler than R1T; in active cooling it is normally warmer. Return temperature and flow together help describe transfer, but R4T is not a dedicated sensor at the building emitters and alone does not measure the building load.",
      de: "Die gemeinsame Rücklaufleitung zum PHE-Wassereintritt R4T, nachdem Speicher- und Raumzweig zusammengeführt wurden. Im gezeigten Split-System-Aufbau passiert sie die wasserseitigen Fühler vor dem Wärmetauscher. Beim Heizen ist sie normalerweise kühler als R1T, beim aktiven Kühlen wärmer. Rücklauftemperatur und Durchfluss beschreiben gemeinsam den Übergang; R4T ist jedoch kein eigener Fühler an den Gebäudeflächen und misst allein nicht die Gebäudelast.",
    },
    now: (d) => waterMoving(d)
      ? { en: `Returning at ${degC(d.ret)}, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.`,
          de: `Kommt mit ${degC(d.ret)} zurück, ${fmt1(d.flow)} l/min, ${fmt1(d.wp)} bar.` }
      : { en: "Current pump and flow readings do not establish circulation in the return pipe.",
          de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation in der Rücklaufleitung." },
    rows: [/inlet water/i, /flow sensor/i, /^water pressure$/i],
  },
  flow: {
    t: { en: "Flow rate", de: "Durchfluss" },
    re: /flow sensor/i, sample: "Flow sensor",
    rows: [/flow sensor/i, /^water pressure$/i, /water pump signal/i],
  },
  flow_switch: {
    t: { en: "Water-flow-switch status", de: "Status „Water flow switch“" },
    re: /water flow switch/i, sample: "Water flow switch", trend: "water_flow_switch",
    head: (d) => d.flowSwitch == null ? "—" : t(d.flowSwitch ? "state.on" : "state.off"),
    now: (d) => d.flowSwitch == null ? null : d.flowSwitch
      ? { en: `The X10A binary status is ON. It is not a flow-rate measurement or proof that the model-specific minimum is met; compare it with the pump and ${fmt1(d.flow)} l/min flow reading.`,
          de: `Der binäre X10A-Status ist ON. Er ist weder eine Durchflussmessung noch ein Nachweis des modellspezifischen Mindestwerts; mit Pumpe und dem Messwert von ${fmt1(d.flow)} l/min vergleichen.` }
      : { en: `The X10A binary status is OFF. That is normally expected with a stopped pump; if the pump runs, compare it with the ${fmt1(d.flow)} l/min flow reading and any 7H/C0 fault.`,
          de: `Der binäre X10A-Status ist OFF. Bei stehender Pumpe ist das normalerweise zu erwarten; läuft die Pumpe, mit dem Messwert von ${fmt1(d.flow)} l/min und einer möglichen 7H-/C0-Störung vergleichen.` },
    rows: [/water flow switch/i, /flow sensor/i, /water pump operation/i],
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

// Every reading below an inspector belongs in ONE value list after the trend. A leaf target keeps
// its X10A reading in the prominent headline, so only the Modbus twin is added here; a grouped
// target already keeps the complete X10A/Modbus pair in inspMembers(). This replaces the exceptional
// path that inserted a leaf's Modbus value between the timeless description and the chart, while
// all other values sat below the chart behind dividers.
function inspValues(e, row, fb) {
  // Some inspectors intentionally expose one authoritative X10A contact only. Do not manufacture
  // the generic leaf twin or append component/context rows for those entries.
  if (e && e.x10aOnly) return [];
  const members = inspMembers(e, row, fb);
  // Keep the old comparison contract: a second opinion is only meaningful while the primary
  // headline has a current value. Grouped targets still show all available readings independently.
  const twin = e && !e.listAllValues && row && row.value != null ? mbTwin(row) : null;
  return twin ? [{ x10a: null, mb: twin, compare: row }, ...members] : members;
}

// Only call two readings equal/different while both are current. In particular, an X10A row held
// over during an outdoor-unit restart must not turn a perfectly valid Modbus value into a false
// disagreement warning.
function inspComparisonHtml(m, d) {
  // `compare` marks the leaf-headline twin that used to carry this note in the explainer. Existing
  // grouped/context rows remain compact: moving the note must not multiply it across every pair.
  const comparison = m.compare;
  return comparison && comparison.value != null && !rowHeldOver(comparison, d)
      && m.mb && m.mb.value != null
    ? mbDeltaHtml(comparison, m.mb)
    : "";
}

// The reading of a /values row as one string ("42.8 °C"); "—" for an absent row — and "—" for a row
// the outdoor unit has stopped refreshing (rowHeldOver / logic/ou_stale.hpp), which is the SAME
// answer the pill gives. The panel used to read every row straight off /values, so tapping a pill
// the drawing had blanked produced its held-over number back in 19px — the explainer contradicting
// the picture, and asserting as current exactly the last-run value the blanking exists to withhold.
const inspVal = (r, d) => {
  if (r == null || rowHeldOver(r, d)) return "—";
  const unit = displayUnit(r);
  return displayValue(r) + (unit ? " " + unit : "");
};

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
  if (e.env3) {
    const env = S.status?.env3 || {};
    return [LANG, S.insp, env.supported, env.enabled, env.fresh, env.error || "",
            env.temperature_c, env.humidity_pct, env.pressure_hpa].join("|");
  }
  const d = S.live;
  const row = d ? inspCurRow(e) : null;
  // The fallback headline is a value like any other and moves like any other, so it is in the key.
  const fb = row ? null : mbForInspect(S.insp);
  // Every value row AND its Modbus twin: the panel draws both, so both have to be in the key. Use
  // the same set as the renderer; grouped targets include their headline pair, while leaf targets
  // include only their headline's Modbus twin because the X10A value is already in the header.
  // A value the body renders but the signature omits simply stops repainting — the mirror of putting
  // a side effect IN here, and the quieter of the two failures: the panel keeps showing the gateway's
  // reading from whenever something else last changed, looking perfectly current.
  const rows = (d ? inspValues(e, row, fb).map((m) => {
    return inspVal(m.x10a, d) + (m.mb ? "/" + m.mb.value : "")
      + (m.compare ? "/" + m.compare.value : "");
  }) : []).join(",");
  // LANG guarantees the full body is redrawn even when this particular entry's title/live sentence
  // happens to be spelled identically in both dictionaries.
  return [LANG, S.insp, inspTitleText(e, d), inspVal(row, d), fb ? fb.value : "",
          d && e.head ? e.head(d) : "",
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
  if (e && e.env3) {
    const offered = ENV3_COMBINED_SERIES.filter((s) => hasEnv3Hist(s.id));
    for (const s of offered) ensureHist(s.id, "env3");
    const seriesSig = offered.map((s) => {
      const h = S.hist.get(histCacheKey(s.id, "env3"));
      return `${s.id}:${h ? (h.err ? "e" : h.gen) : ""}`;
    });
    const pin = S.histPin.get(ENV3_COMBINED_ID);
    const sig = [LANG, ENV3_COMBINED_ID, ...seriesSig,
                 pin ? (pin.t ?? `${pin.i}/${pin.gen}`) : ""].join("|");
    if (sig === S.inspHistSig) return;
    S.inspHistSig = sig;
    const el = $("inspHist");
    el.hidden = !offered.length;
    el.innerHTML = offered.length ? env3HistHtml() : "";
    return;
  }
  // A plain pill drawn from a ROW charts that row. A COMPUTED pill (ΔT, heat output, electrical
  // input, COP) or a grouped component (BUH's two stage rows) charts the explicit series named by
  // the entry's `trend`, even when one source row anchors the inspector. Never silently substitute
  // one input: a flow-rate curve under a heat-output headline would be physically false.
  const pair = MB_PAIRS.find((p) => p.insp === S.insp);
  const pairedId = pair && hasModbusHist(pair.cid) ? pair.cid : "";
  const trendId = e && typeof e.trend === "function" ? e.trend(S.live) : e && e.trend;
  // Function-capable like `trend` above, and for the same reason: an entry whose SOURCE depends on
  // which instrument answered this second cannot state it as a constant (INSPECT.sgrequest).
  const trendSource = (e && (typeof e.trendSource === "function" ? e.trendSource(S.live)
                                                                 : e.trendSource)) || "";
  const offered = (id) => trendSource === "modbus" ? hasModbusHist(id)
    : trendSource === "x10a" ? hasHist(id) : hasHist(id) || hasModbusHist(id);
  const explicitId = trendId && offered(trendId) ? trendId : "";
  const id = explicitId || (row ? histIdFor(row.label) : pairedId);
  if (id) {
    if (trendSource) ensureHist(id, trendSource);
    else ensureHistPair(id);                // throttled to once a minute inside; no-op once cached
  }
  const h = id && trendSource !== "modbus" ? S.hist.get(id) : null;
  const mh = id && trendSource !== "x10a" ? S.hist.get(histCacheKey(id, "modbus")) : null;
  const pin = id ? S.histPin.get(id) : null;
  // histHtml carries localised axis/readout copy. A language switch must therefore invalidate the
  // inspector chart even when the series generation and pinned sample are unchanged.
  const sig = [LANG, id, trendSource, h ? (h.err ? "e" : h.gen) : "", mh ? (mh.err ? "e" : mh.gen) : "",
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
  const chartName = DERIVED[id] && e && e.aria ? tx(e.aria) : null;
  el.innerHTML = !id ? ""
    : row ? histHtml(id, displayUnit(row), chartName || displayReadingLabel(row.label, row), trendSource)
    : pairedId ? histHtml(id, mb ? displayUnit(mb) : "", mb ? displayHomeHubLabel(mb) : inspTitleText(e, null), trendSource)
               : histHtml(id, DERIVED[id]?.unit || "", e.aria ? tx(e.aria) : inspTitleText(e, null), trendSource);
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
  // Use the same live-class accordion as the value/Settings tongues. The body stays mounted inside
  // its 0fr clip so the browser has a real closed geometry to transition FROM; toggling `hidden`
  // here painted the full infobox immediately and could never reproduce their pull-out motion.
  const inspect = $("inspect");
  const card = $("inspCard");
  inspect.classList.toggle("open", !!e);
  if (e) {
    card.removeAttribute("aria-hidden");
    card.removeAttribute("inert");
  } else {
    card.setAttribute("aria-hidden", "true");
    card.setAttribute("inert", "");
  }
  document.querySelectorAll("#schem .sc-hit").forEach((el) => el.classList.toggle("sel", el.dataset.insp === S.insp));
  if (!e) return;
  if (e.env3) {
    const env = S.status?.env3 || {};
    const state = env3State(env);
    const valueRow = (label, value) =>
      `<div class="inspect-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
    setTxt("inspTitle", inspTitleText(e, null));
    setTxt("inspSrc", "ENV III");
    $("inspSrc").hidden = false;
    $("inspSrc").classList.toggle("src-val-mb", false);
    $("inspNow").hidden = false;
    setTxt("inspNow", env3Value(env, "temperature_c", 1, "°C"));
    $("inspNow").classList.toggle("src-val-mb", false);
    // Values precede the chart so the combined timeline is the final, full-width evidence block in
    // the infobox. Temperature is repeated deliberately: the header mirrors the pill while this
    // list keeps the three ENV III instruments directly comparable and independently labelled.
    $("inspBody").innerHTML =
      `<div class="inspect-env-state ${state.cls}">${esc(t("env.sensor_state"))}: ${esc(state.text)}</div>` +
      `<div class="vdesc-p">${esc(t("env.history_help"))}</div>` +
      `<div class="inspect-rows inspect-env-values">` +
        valueRow(t("env.temperature"), env3Value(env, "temperature_c", 1, "°C")) +
        valueRow(t("env.humidity"), env3Value(env, "humidity_pct", 0, "%")) +
        valueRow(t("env.pressure"), env3Value(env, "pressure_hpa", 0, "hPa")) +
      `</div>`;
    $("inspRows").innerHTML = "";
    return;
  }
  // `d` is the drawing's snapshot and is NOT null merely because X10A is silent — liveData() still
  // builds one from the gateway when it is delivering, which is what makes the fallback a drawing
  // rather than a blank card. So "is there a snapshot" and "is the X10A row current" are two
  // questions, and inspCurRow asks the second one.
  const d = S.live;
  const row = d ? inspCurRow(e) : null;
  // The gateway's reading of this target while X10A is silent — null in normal operation, so
  // everything below is the panel it always was unless the drawing itself has switched source.
  const fb = row ? null : mbForInspect(S.insp);
  const fbUnit = fb ? displayUnit(fb) : "";
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
                     : displayReadingLabel(row ? row.label : (e.sample || ""), row);
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
                     : fb ? displayValue(fb) + (fbUnit ? " " + fbUnit : "")
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
  const desc = e.sample ? descFor(e.sample, row || fb) : null;
  const ownWhat = typeof e.what === "function" ? e.what(d) : e.what;
  const what = ownWhat ? descParaHtml(esc(tx(ownWhat)))
                       : (desc ? descBodyHtml(desc, (row || fb)?.value) : "");
  // Prose stays prose. Every live reading, including a leaf headline's second source, is rendered
  // together after the chart in the divided value list below.
  $("inspBody").innerHTML = what + (sentence ? descParaHtml(esc(sentence)) : "")
    + inspHeldHtml(e, d);
  $("inspRows").innerHTML = !d ? "" : inspValues(e, row, fb)
    // A member reading with a twin gets the gateway's value as its OWN row, labelled "(Modbus)" and
    // petrol throughout — never appended to the X10A value in the same cell, which is what this did
    // first and which rendered as "46.2 °C 46.0 °C": two numbers of equal weight, jammed together,
    // with nothing saying that they come from different instruments or which is which. A reading is
    // a label and a value; a second reading needs both, not a second number in the first one's slot.
    .map((m) => {
      const row = m.x10a
        ? `<div class="inspect-row"><span>${esc(displayReadingLabel(m.x10a.label, m.x10a))}</span>` +
          `<span>${esc(inspVal(m.x10a, d))}</span></div>`
        : "";
      if (!m.mb) return row;
      const mbUnit = displayUnit(m.mb);
      // The gateway's OWN label, like the explainer line — it names the register the number came
      // from, which is what someone checking the pairing against real hardware needs to read.
      return row +
        `<div class="inspect-row mb-row">` +
          `<span>${esc(displayHomeHubLabel(m.mb))} ` +
            `<span class="mb-tag">${esc(t("src.modbus_tag"))}</span></span>` +
          `<span>${esc(displayValue(m.mb))}${mbUnit ? " " + esc(mbUnit) : ""}</span></div>` +
        inspComparisonHtml(m, d);
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
  updateSchematicStateA11y(S.live);
}

// Tap a hit target: select it, or close it when it is already open (tapping the same thing twice is
// the natural "done reading" gesture, and there is no other close on touch besides the ✕). Keep the
// viewport exactly where the reader put it: the inspector is deliberately below the drawing and can
// be taller than the viewport, so scrollIntoView() would align its lower edge and move the diagram
// out of sight just when the reader asks for its explanation.
function inspectPick(key) {
  S.insp = S.insp !== key ? key : null;
  renderInspect();
}
