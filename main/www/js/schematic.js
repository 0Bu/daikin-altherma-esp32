
// ── Live system section (the interactive schematic) ──────────────────────────────────────────
// Everything here reads /values through label patterns — the same technique pickValue() already
// uses — so the section degrades per model: a value the profile doesn't carry renders "—", and a
// missing tank/room sensor hides that schematic part entirely (.no-dhw/.no-room). The DOM is
// static (index.html) and updated in place. Replacing its animated nodes during polling would
// restart the CSS flow animations.
//
// A pattern names ONE row. A row without a value this sweep reads as absent; the reader never falls
// through to the next match, because that row is another instrument under a label the reader takes
// for this one. tools/presenter/presenter_parity.mjs holds each pattern to one row on every profile
// a device can run, and its SEVERAL_ROWS table lists the few that match several rows on purpose.
const vFind = (match) => {
  const r = (S._values || []).find(match);
  return r && r.value != null ? r : undefined;
};
const vRow = (re) => vFind((x) => re.test(x.label || ""));
const vRowGroup = (re, group) => vFind((x) => re.test(x.label || "") && x.x10a_group === group);
const rowNum = (r) => { if (!r) return null; const n = parseFloat(r.value); return Number.isFinite(n) ? n : null; };
const vNum = (re) => rowNum(vRow(re));
// Bit-flag values arrive as numeric 1/0 (logic/convert.hpp conv 300-307). null = row absent.
const vOn = (re) => { const r = vRow(re); return r ? String(r.value).trim() === "1" : null; };
const pumpX10a = () => {
  const row = x10aDown() ? null : vRow(/water pump operation/i);
  return row?.held || row?.held_unknown || binaryValue(row) == null ? null : row;
};
const valveX10a = () => {
  const row = x10aDown() ? null : vRow(/3.?way valve/i);
  return row?.held === true || row?.held_unknown === true || binaryValue(row) == null ? null : row;
};
const defrostX10a = () => {
  const row = x10aDown() ? null
    : vFind((item) => item.reg === 0x10 && /^defrost operation$/i.test(item.label || ""));
  return row?.held || row?.held_unknown || binaryValue(row) == null ? null : row;
};
const bshX10a = () => {
  const row = x10aDown() ? null : vRow(/^bsh$/i);
  return row?.held || row?.held_unknown || binaryValue(row) == null ? null : row;
};
const outdoorAirRow = () => {
  const row = vRow(/outdoor air/i);
  return rowNum(row) == null ? null : row;
};

// Page 0x20 / offset 2 across the supported model catalog. The sensor's physical role is stable
// while Daikin's labels are not: ordinary air-source units call it the outdoor heat exchanger,
// other families call the same location a deicer or two-phase thermistor. Keep the alternatives
// exact so "Heat exchanger mid-temp." at offset 8 can never substitute for this R4T curve. The page
// is part of the selection: "Outdoor heat exchanger temp." is this row on a chiller and the second
// outdoor unit's row, on page 0xA0, on other profiles.
const OUTDOOR_HX_RE = /^(?:2 phase thermistor \(R4T\)|O\/U Heat Exch\. Temp\.(?:\(R4T\))?|O\/U Heat Exchanger Temp|Outdoor heat exchanger temp\.|R4T-Deicer temp\.)$/i;
const ouHxRow = () => vFind((x) => x.reg === 0x20 && OUTDOOR_HX_RE.test(x.label || ""));
const ROOM_TEMP_RE = /^(?:indoor ambient temp|RT Temp\.$)/i;

// The refrigerant high side is one row per profile, and the firmware names it: /status.history's
// `circuit_pressure` trend resolves the same structural rule as the refrigerant service
// (logic/history.hpp trend_select_high_side). A browser pattern cannot make that choice, because the
// 0x62/15 row is spelled alike on profiles where it is a sensor and on those where the installer
// guides document no such sensor. Null when this profile charts no high side, and on no value or an
// exact 0.0, which a sealed R32 circuit uses as an absent reading rather than a pressure. A row that
// is not measuring stays selected whatever it holds, so that the panel can say why the pill is blank.
const highSideRow = () => {
  const entry = (S.status?.history?.rows || []).find((r) => r.id === "circuit_pressure");
  const row = entry && (S._values || []).find((x) => x.label === entry.label);
  return row && (parseFloat(row.value) > 0 || rowNotMeasuring(row)) ? row : null;
};

// The outdoor unit's OWN register pages — logic/ou_stale.hpp's ou_page_holds_over(), transcribed:
// 0x20 (outdoor sensors) and 0x21 (inverter) are only refreshed while the compressor runs, so with
// it stopped every row on them is the LAST RUN's value. Keyed on the row's REGISTER, which /values
// now carries, and never on its label: the catalog spells these rows ~50 different ways across the
// 43 profiles, so a pattern list would be a second copy of a rule that CI gates in C++ — and would
// stop covering a row the moment a profile spelled it differently.
const OU_HELD_PAGES = [0x20, 0x21];
// Is this /values row still a CURRENT reading? Takes the snapshot rather than reading S.live, so
// every consumer answers from the same poll the rest of its render came from.
const rowHeldOver = (r, d) => !!r && (r.held === true || (!!d?.ouHeldOver && OU_HELD_PAGES.includes(r.reg)));

// Leaving-water MEASUREMENT for ΔT / heat output / COP — NOT a plain vNum, because a measurement
// regex that can also match a setpoint row poisons all three (issue legacy-121, the legacy-35–legacy-39 failure
// shape). Host-tested twin: main/logic/lwt_select.hpp + test/test_logic.cpp test_lwt_select() —
// keep the token lists below byte-for-byte in sync (lowercase substring, no regex).
//   Tier 1 = the pre-BUH heat-exchanger outlet (R1T) under any label form — "before BUH (R1T)",
//     "after PHE (R1T)", "Outlet Water Heat Exch. Temp. (R1T)", "[HPSU] Tv inflow Temp (R1T)";
//     keying on the (R1T) tag (not a "heat exch" keyword, which also hits outdoor/refrigerant rows)
//     lights up the alias-labelled profiles that "leaving water.*before" alone missed.
//   Tier 2 = any leaving/outlet-water measurement that is NOT a setpoint / mixed-zone / post-BUH.
const lwtWater = (l) => l.includes("leaving water") || l.includes("outlet water") || l.includes("water heat exchanger outlet") || l.includes("inflow");
const lwtReject = (l) => l.includes("setpoint") || l.includes("mixed") || l.includes("r2t") || l.includes("after buh") || l.includes("after buffer") || l.includes("raw data") || l.includes("dlwb2") || l.includes("hydro split");
// The two tiers as NAMED predicates over a raw label, one per C++ twin (lwt_is_pre_buh /
// lwt_is_measurement). Named rather than inlined into the find() callbacks below because
// scripts/check-presenter-parity.sh calls them directly with the whole def/ catalog's labels and
// diffs the answers against the C++ — a rule nothing can address is a rule nothing can gate, which
// is how this copy drifted far enough to match the bizone kit's MIXED leaving-water row.
const lwtIsPreBuh = (l) => lwtWater(l) && !lwtReject(l) && l.includes("r1t");
const lwtIsMeasurement = (l) => lwtWater(l) && !lwtReject(l);
const lwtRow = () => {
  const vals = S._values || [];
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => lwtIsPreBuh(low(x)));
  if (!r) r = vals.find((x) => lwtIsMeasurement(low(x)));
  return r || null;
};
const vLwt = () => {
  const r = lwtRow();
  if (!r || r.value == null) return null;
  const n = parseFloat(r.value);
  return Number.isFinite(n) ? n : null;
};
// Return-water MEASUREMENT for ΔT / heat output / COP. Host-tested twin:
// main/logic/rwt_select.hpp + test/test_logic.cpp test_rwt_select() — keep the token lists
// byte-for-byte in sync (lowercase substring, no regex).
//   Tier 1 = the PHE return water inlet (R4T) under any catalog label form ("inlet water temp.(r4t)",
//     "return water temp before phe (r4t)", "[hpsu] tr return temp (r4t)").
//   Tier 2 = any return/inlet-water measurement that is NOT raw data (0xA1), outdoor, or brine.
const rwtWater = (l) => l.includes("inlet water") || l.includes("return water") || l.includes("return temp") || l.includes("water heat exchanger inlet");
const rwtReject = (l) => l.includes("raw data") || l.includes("o/u") || l.includes("deicer") || l.includes("phase") || l.includes("outdoor") || l.includes("brine");
const rwtIsR4t = (l) => rwtWater(l) && !rwtReject(l) && l.includes("r4t");
const rwtIsMeasurement = (l) => rwtWater(l) && !rwtReject(l);
const rwtRow = () => {
  const vals = S._values || [];
  const low = (x) => (x.label || "").toLowerCase();
  let r = vals.find((x) => rwtIsR4t(low(x)));
  if (!r) r = vals.find((x) => rwtIsMeasurement(low(x)));
  return r || null;
};
const vRwt = () => {
  const r = rwtRow();
  if (!r || r.value == null) return null;
  const n = parseFloat(r.value);
  return Number.isFinite(n) ? n : null;
};
// The POST-BUH (R2T) leaving-water measurement — the preferred numerator for a CT-based COP.
// Host-tested twin: main/logic/cop_scope.hpp cop_is_post_buh / cop_post_buh_select
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
  const vals = S._values || [];
  return vals.find((x) => isPostBuhRow((x.label || "").toLowerCase(), x.reg)) || null;
};
// WHICH COP a quotient would be, and when it is none — the addressable twin of
// logic/cop_scope.hpp's cop_plan(), same branches in the same order. A named function rather than a
// cascade inlined in liveData() so scripts/check-presenter-parity.sh can enumerate the whole input
// space (electrical source, heater states, post-BUH row and inverter fallback) against the C++
// and diff every answer; a rule spelled out inside a
// 200-line builder can only be tested through everything around it.
//
// It takes the two heaters as the RAW tri-states they arrive as (null = this profile carries no such
// row) and collapses them here, rather than being handed two ready-made booleans. That is not
// tidiness: the collapse is the rule's most dangerous step — UNKNOWN is not OFF, and off is the
// PERMISSIVE branch, so guessing it is exactly what ships the collapsed quotient — and a step
// computed in the caller is a step the parity gate would have to re-implement to reach, which would
// make the gate a third copy of the very thing it is comparing. Measured: while these two lines sat
// in liveData(), the selftest's "unknown tank heater treated as off" mutation passed the gate.
const copPlan = (pelSrc, buh1, buh2, bsh, pbOk, invPairUsable) => {
  const heaterQuiet = buh1 === false && buh2 === false;
  const tankQuiet   = bsh === false;
  if (pelSrc == null)    return { scope: null,    block: "no_pel",      postBuh: false };
  if (pelSrc === "INV" || (invPairUsable && !(heaterQuiet && tankQuiet)))
    return { scope: "hp", block: null, postBuh: false };
  if (!tankQuiet)   return { scope: "plant", block: "tank_heater",   postBuh: false };
  if (!heaterQuiet) return { scope: "plant", block: "backup_heater", postBuh: false };
  return { scope: "plant", block: null, postBuh: pbOk };
};
// Diagram numbers are user-facing copy too. Keep their width fixed to one decimal while using the
// selected locale's decimal separator (for example 24,3 in Ukrainian instead of 24.3).
const fmt1 = (n) => (n == null ? "—" : Number(n).toLocaleString(LANG, {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
}));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const setTxt = (id, s) => { const el = $(id); if (el && el.textContent !== s) el.textContent = s; };

// X10A speed takes precedence for activity. HomeHub input 31 can report ON/OFF without a speed.
const compressorRunning = (d) => {
  if (!d) return false;
  return d.rps != null ? d.rps > 0 : d.compressorOn === true;
};
const compressorConflict = d => d.rps === 0 && d.mbCompressorOn === true;
const homehubOnlyCompressorOff = d => d.rps == null && d.mbCompressorOn === false;
const compressorStopped = d => d.rps != null
  ? d.rps === 0 && !compressorConflict(d) : d.compressorOn === false;
const compressorConflictText = d =>
  `${t("src.disagree")}. X10A ${fmt0(d.rps)} rps · HomeHub ${t("state.on")}`;
const capacitySpeedQualified = d => d.rps > 5;
const needsCapacitySpeed = d => !compressorStopped(d) && !capacitySpeedQualified(d);
const backupHeaterActive = d => d.buh1 === true || d.buh2 === true;
const heatersOff = d => d.buh1 === false && d.buh2 === false && d.bsh === false;
const stoppedCapacityText = d => {
  const stop = homehubOnlyCompressorOff(d)
    ? t("schem.homehub_compressor_off") + " " + t("schem.capacity_low_speed")
    : t("schem.compressor_off");
  return backupHeaterActive(d) ? `${t("schem.backup_heater_active")}. ${stop}` : stop;
};

// Prefer the measured flow over the pump command/status. An external pump, coast-down or a stale/
// conflicting binary status can produce real flow while the internal pump reports OFF. Conversely,
// pump ON without a flow reading is only a pump report, not proof that water moves. Return null for
// that unknown state so animations and prose do not turn a command into a measurement.
const waterMoving = (d) => usableWaterFlow(d?.flow) ? d.flow > 0.5 : null;
// Each sentence names a separate observation: a STOP command never supplies an OFF report.
// Locale tables supply copy only; all thirteen languages use the same state/flow rule.
// words: command, ON, OFF, unknown, measured flow, missing flow, conflict, unconfirmed circulation.
function pumpNowText(d, words) {
  const moving = waterMoving(d);
  if (d.pump == null && d.pumpOn == null && moving == null && !d.flowInvalid && d.provisionalFlow == null) return null;
  const parts = d.pump == null ? [] : [words[0](fmt1(d.pump))];
  parts.push(d.pumpOn === true ? words[1] : d.pumpOn === false ? words[2] : words[3]);
  if (moving != null) parts.push(words[4](fmt1(d.flow)));
  else if (d.flowInvalid) parts.push(t("schem.flow_invalid"));
  else if (d.provisionalFlow == null) parts.push(words[5]);
  if (moving && d.pumpOn === false) parts.push(words[6]);
  if (moving !== true) parts.push(words[7]);
  return parts.join(" ");
}

// Qualified flow establishes hydraulic motion. Defrost stays neutral. The selected heating or
// cooling mode colours the pipes during compressor activity, or heating with a reported BUH stage.
const waterThermalKind = (d, pumping) => {
  if (!d || pumping !== true) return null;
  if (d.thermalMode == null || d.thermalMode === "defrost") return "neutral";
  const backupHeating = d.thermalMode === "heat" && backupHeaterActive(d);
  if (!compressorRunning(d) && !backupHeating) return "neutral";
  return d.thermalMode === "cool" ? "cool" : "heat";
};

// Turn the signed water-side balance into the one quantity the current task can honestly name.
// R1T-R4T is positive while heat enters the water and negative while cooling removes it. A running
// pump alone can redistribute stored heat and produce a small, arithmetically real difference; it
// is NOT heat-pump output, so no thermal-power pill is shown without the live compressor witness.
// A direction opposite to the declared task is a transition, sensor tolerance or another state we
// cannot classify — blank it rather than relabel it into a plausible-looking capacity.
function thermalValue(d, raw, allowDefrost) {
  if (raw == null || d.dtStale || !capacitySpeedQualified(d)) return null;
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
  if (d?.valveDhw !== false) return null;
  return d.pthKind === "cooling" ? "cool" : d.pthKind === "heating" ? "heat" : null;
}

function liveData() {
  // ΔT is measured across the PHE: leaving water BEFORE the backup heater minus inlet water — with
  // the BUH off (the normal case) before/after are equal, and the derived heat output must not
  // credit the resistive heater to the heat pump.
  const lwt = vLwt();   // pre-BUH R1T measurement, never a setpoint (see vLwt / logic/lwt_select.hpp)
  const ret = vRwt();   // PHE inlet R4T measurement, never 0xA1 raw data (see vRwt / logic/rwt_select.hpp)
  const ctRows = (S._values || []).filter((x) => /current measured by ct/i.test(x.label || ""));
  // A phase withheld by the firmware is not a zero-current phase. In particular, CT-L3 is null
  // while its byte's overlaid HP-Forced bit is asserted. Summing only the surviving phases would
  // understate plant input and inflate COP, so CT is usable only as one complete declared set.
  const ctComplete = ctRows.length > 0 && ctRows.every((x) =>
    x.value != null && Number.isFinite(Number(x.value)));
  const ct = ctComplete ? ctRows.reduce((a, x) => a + Number(x.value), 0) : 0;
  const invRow = (S._values || []).find((x) => /inv primary current/i.test(x.label || "")) ||
    (S.status?.history?.rows || []).find((r) => r.id === "inv_current");
  const inv = rowNum(invRow);
  const speedRow = x10aDown() ? null : vRow(/inv frequency/i);
  const airRow = outdoorAirRow();
  const flowRow = x10aDown() ? null : vRow(/flow sensor/i);
  const flowText = flowRow?.held || flowRow?.held_unknown ? "" : String(flowRow?.value ?? "").trim();
  const flow = flowText ? Number(flowText) : null;
  const flowValid = usableWaterFlow(flow);
  const fanRunning = !x10aDown() && (S._values || []).some(row => {
    const label = row.label || "";
    const fan = (row.reg === 0x30 && /^fan [12] \((?:step|10 rpm)\)$/i.test(label)) ||
      (row.reg === 0x53 && /^outdoor fan \((?:upper|lower)\)\(rps\)$/i.test(label));
    const speed = Number(row.value);
    return fan && !row.held && !row.held_unknown && Number.isFinite(speed) && speed > 0;
  });
  const postBuh = postBuhRow();
  const d = {
    lwt, ret,
    dt: lwt != null && ret != null ? lwt - ret : null,
    out: rowNum(airRow),
    ouHx: rowNum(ouHxRow()),
    flow: flowValid ? flow : null, fanRunning,
    flowInvalid: !!flowText && !flowValid,
    wp: vNum(/^water pressure$/i),
    rps: speedRow?.held === true || speedRow?.held_unknown === true ? null : rowNum(speedRow),
    lp: vNum(/^low pressure$/i),
    disch: vNum(/discharge pipe temp/i),
    eev: vNum(/expansion valve ?1/i),
    r2t: postBuh && Number.isFinite(parseFloat(postBuh.value)) ? parseFloat(postBuh.value) : null,
    r3t: vNum(/refrig\. temp\. liquid side/i),
    tank: vNum(/dhw tank temp/i),
    tankSet: vNum(/dhw setpoint/i),
    room: vNum(ROOM_TEMP_RE),
    roomSet: vNum(/^rt setpoint/i),
    pumpSig: vNum(/water pump signal/i),
    // HomeHub input 30 is a full-sweep reading. Unrelated fast replies do not refresh it.
    pumpOn: binaryValue(pumpX10a()),
    // The HomeHub full-sweep cache can lag its fast poll. Use the current X10A route here.
    valveDhw: binaryValue(valveX10a()),
    // Historical X10A catalogs call this bit "On:Heat_Off:Cool", but it is a logical output state,
    // not the separate configured/current operating mode or mechanical position feedback. At idle
    // the live unit demonstrates that the two can differ, so retain the electrical ON/OFF fact.
    valve2On: stateOf(/2.?way valve/i),
    flowSwitch: stateOf(/water flow switch/i),
    buh1: vOn(/buh step ?1/i),
    buh2: vOn(/buh step ?2/i),
    bsh: binaryValue(bshX10a()),
    defrost: binaryValue(defrostX10a()),
    // "Space heating Operation ON/OFF" and HomeHub input 53 both mean normal SPACE heat/cool
    // OPERATION — not a thermostat demand and not heating-only. The controller can report it ON in
    // Cooling while Thermostat is OFF (live unit, 2026-08-01). Keep the exact row anchor, but name
    // the field for what Daikin documents instead of preserving the old interpretation in code.
    spaceOp: stateOf(/^space heating operation/i, 53),
    // Only the validated hydronic `Silent Mode` row is the Quiet state. The profile-specific
    // outdoor `Low noise control` bit is P2 observation telemetry whose polarity/trigger remains
    // uncorrelated; letting it fall through here would colour the pill and feed quiet history when
    // the hydronic page misses one sweep.
    quiet: x10aDown() ? null : vOn(/^silent mode$/i),
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
  // The raw row can belong to an older full sweep. Only the fresh /values witness can drive
  // activity or contradict the current X10A speed.
  d.mbCompressorOn = mbLive() ? S.modbusCompressorRunning ?? null : null;
  d.compressorOn = d.rps != null ? d.rps > 0 : d.mbCompressorOn;
  // X10A reports the hydronic mode and must supply the route in Cooling + DHW and pure DHW.
  // A current X10A tank route also withholds pure Cooling when it contradicts the mode.
  const modeRow = x10aDown() ? null : vRow(/^i\/u operation mode$/i);
  const mode = String(modeRow?.value ?? "").trim().toLowerCase().replace(/\s*\+\s*/g, " + ");
  const cooling = mode === "cooling";
  const coolingDhw = mode === "cooling + dhw";
  const heating = mode === "heating" || mode === "heating + dhw";
  const route = d.valveDhw;
  d.spaceMode = cooling || coolingDhw ? "cool" : heating ? "heat" : null;
  d.thermalMode = null;
  // Defrost can reverse the circuit before the I/U mode changes. Normal direction needs a
  // current OFF report from the defrost page; a missing report leaves the direction unknown.
  if (d.defrost === true) d.thermalMode = "defrost";
  else if (d.defrost === false) {
    if (heating || ((mode === "dhw" || coolingDhw) && route === true)) d.thermalMode = "heat";
    else if ((cooling && route !== true) || (coolingDhw && route === false)) d.thermalMode = "cool";
  }
  // Pump command % — independent of the reported operation state and measured flow.
  d.pump = pumpCommandPercent(d.pumpSig);
  // The outdoor unit refreshes its OWN register pages (0x20 sensors, 0x21 inverter) only while it
  // RUNS — stopped, it answers with the LAST RUN's values (logic/ou_stale.hpp, host-tested against
  // the whole catalog). Measured on a live unit: outdoor air held exactly 19.0 °C for five hours,
  // then stepped to 25.5 at the instant the compressor started, while the hydronic pages decayed
  // smoothly throughout. Those readings must therefore not be drawn as current — DESIGN.md's
  // dead-bus rule ("an idle plant with no readings, not a stale one"), applied to one sleeping unit.
  // A held-over 19.0 °C is exactly the legacy-35–legacy-39 shape: well-formed, plausible, and false — and it is
  // what made an idle plant look like a running one next to a "not running" headline.
  //
  // HomeHub reports activity in its own poll. The X10A speed and row flags determine freshness.
  const markedUnknown = (S._values || []).some((row) => row.held_unknown === true);
  d.ouHeldOver = d.rps === 0;
  d.ouUnknown = markedUnknown && !d.ouHeldOver;
  // Prefer the structurally paired HomeHub air reading when the X10A value is unavailable or old.
  const takeMb = (key, cid) => {
    const r = mbByConcept(cid);
    if (!r) return;
    const n = parseFloat(r.value);
    if (!Number.isFinite(n)) return;
    if (key === "flow") d.provisionalFlow = n;
    else d[key] = n;
    d.mbFields.add(key);
  };
  d.outHeld = rowHeldOver(airRow, d);
  if (d.out == null || d.outHeld || airRow?.held_unknown === true) takeMb("out", "outdoor_air");
  // Circuit refrigerant pressure for the schematic's high-side badge: the row the chart and the
  // refrigerant service read (highSideRow). On a profile whose high side is the outdoor 0x20/12
  // transducer the pill is blank at rest, since that page holds over and no other row is a sensor for
  // it.
  const hsRow = highSideRow();
  const hsBar = rowNum(hsRow);
  d.circP = hsBar > 0 && !rowHeldOver(hsRow, d) ? hsBar : null;
  // A working ΔT needs qualified measured flow. Without that evidence R1T and R4T can cool at
  // different rates in stagnant water. Neither a pump command nor an ON/OFF report supplies the
  // flow witness. The drawing and inspector share this decision.
  d.dtStale = waterMoving(d) !== true;
  // Derived figures, marked "est." in the UI — the bus has no energy registers. Thermal output from
  // flow/60 × ΔT × ρ·cp (water ≈ 4.186 kJ/l·K); electrical from the CT phase currents at an assumed 230 V,
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
  // — the legacy-35–legacy-39 shape, and the same reason d.circP already gates. Asserted against the whole
  // catalog by logic/ou_stale.hpp's test (which page each of these two rows lives on).
  // The inverter estimate needs positive current X10A speed and an unmarked current row.
  const invHeld = d.ouHeldOver || rowHeldOver(invRow, d);
  const invCurrent = d.rps > 0 && !invHeld && invRow?.held_unknown !== true;
  const invValid = inv != null && inv >= 0;
  const invPower = invCurrent && invValid ? inv * 230 / 1000 : null;
  const ctPower = ctComplete && ct > 0 ? ct * 230 / 1000 : null;
  d.pel = ctPower ?? invPower;
  d.pelSrc = ctPower != null ? "CT" : invPower != null ? "INV" : null;
  // Why the pill is blank, when it is: the INV source EXISTS but is frozen, which is a different
  // statement from "this profile has no current sensor" (the sub-label's other empty case) — so the
  // sub-label stays silent here and the explainer says which of the two it is. With the speed unread
  // it is a third statement again: the source may be frozen. Asked of the row and not of its value,
  // since a value the firmware dropped leaves this profile's source in place.
  d.pelHeld = d.pel == null && !!invRow && invHeld;
  d.pelUnknown = d.pel == null && invValid && !invHeld && !invCurrent;
  d.pelUnread = d.pel == null && inv == null && !d.pelHeld && invRow
    ? displayReadingLabel(invRow.label) : null;
  // ── WHICH COP this quotient is, and when it is none ─────────────────────────────────────────
  // Transcribed from logic/cop_scope.hpp's cop_plan() — same branches, same order, so a change
  // there is visibly a change here (test_cop_scope gates the rule against the whole catalog).
  //
  // CT wiring does not establish heater coverage. Both heaters must be known OFF for the CT
  // estimate. If either may be active, a separately usable inverter/R1T pair can carry the ratio.
  // The electrical-input pill keeps its independent source.
  const pbRow  = postBuhRow();
  const pbT    = pbRow ? parseFloat(pbRow.value) : NaN;
  const pbOk   = pbRow != null && Number.isFinite(pbT) && d.ret != null;
  const ratioSource = ctPower > 0.2 ? "CT" : invPower > 0.2 ? "INV" : null;
  const preBuhPower = thermalValue(d, d.pthRaw, false);
  const plan = copPlan(ratioSource, d.buh1, d.buh2, d.bsh, pbOk,
    invPower > 0.2 && preBuhPower != null);
  d.copScope = plan.scope; d.copBlock = plan.block; d.copPostBuh = plan.postBuh;
  d.copPel = d.copBlock == null ? (d.copScope === "hp" ? invPower : ctPower) : null;
  d.copPth = d.copPostBuh && d.flow != null
    ? thermalValue(d, d.flow / 60 * 4.186 * (pbT - d.ret), false) : preBuhPower;
  d.cop = d.copPel != null && d.copPth != null ? d.copPth / d.copPel : null;

  // ── X10A down: let the SECOND stack carry what it can ────────────────────────────────────────
  // Only the quantities the HomeHub reports, resolved through the concept the firmware
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
    const KEEP = new Set(["pumpOn", "compressorOn", "mbCompressorOn", "spaceOp", "bsh", "sgMode",
                          "sgSrc", "mbFields"]);
    Object.keys(d).forEach((k) => { if (!KEEP.has(k)) d[k] = null; });
    d.ouHeldOver = false;         // nothing to hold over: the whole bus is silent, not one unit
    d.ouUnknown = false;
    MB_PAIRS.forEach((p) => takeMb(p.fld, p.cid));
    // Use the gateway-reported power from input 51. The dashboard does not calculate it from X10A
    // current. Select it by offset because holding power limits share the kW unit.
    const pw = mbPower();
    if (pw) { const n = parseFloat(pw.value);
              if (Number.isFinite(n)) { d.pel = n; d.pelSrc = "MB"; d.mbFields.add("pel"); } }
    // Gateway flow remains provisional. The temperature difference stays unqualified, and both
    // capacity and efficiency also require current X10A compressor speed.
    d.dt = (d.lwt != null && d.ret != null) ? d.lwt - d.ret : null;
    d.dtStale = waterMoving(d) !== true;
    applyThermalPlan(d);
    // The available gateway readings cannot establish a matching COP boundary. Input 51 can
    // report electrical power, but its load coverage (including heaters) is unverified. Input 32
    // (booster state) and input 41 (post-BUH temperature) do not establish which loads 51 covers.
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
  (key === "out" ? d.outHeld ?? d.ouHeldOver : d.ouHeldOver) && !d.mbFields?.has(key) ? "—" : fmt(n);

// Compact permanent state pills contain only their stable names. Preserve the state in the
// accessible name as well as in the inspector, so the colour-only face remains unambiguous.
function updateSchematicStateA11y(d) {
  const set = (id, label, state) => {
    const el = $(id);
    if (el) el.setAttribute("aria-label", `${label}: ${state}`);
  };
  const concept = (key, fallback) => INSPECT?.[key]
    ? (inspHasLocaleField(INSPECT[key], "aria") ? inspFieldText(INSPECT[key], "aria", d) : fallback)
    : fallback;
  set("gSgRequest", concept("sgrequest", t("schem.sg_boost")), sgModeText(d && d.sgMode));
  set("gBshState", concept("bsh", t("schem.bsh_label")),
      !d || d.bsh == null ? "—" : t(d.bsh ? "state.on" : "state.off"));
  set("gDefrostState", concept("defrost", t("schem.defrost_pill")),
      !d || d.defrost == null ? "—" : t(d.defrost ? "state.on" : "state.off"));
  set("gQuietState", concept("quiet", t("chip.quiet")),
      !d || d.quiet == null ? "—" : t(d.quiet ? "state.on" : "state.off"));
  set("g2wv", concept("valve2", t("schem.valve2")),
      !d || d.valve2On == null ? "—" : t(d.valve2On ? "state.on" : "state.off"));
  set("gFlowSwitch", concept("flow_switch", t("schem.flow_switch")),
      !d || d.flowSwitch == null ? "—" : t(d.flowSwitch ? "state.on" : "state.off"));
}

// ENV III is independent of both liveData sources: an X10A outage must not blank a fresh outdoor
// sensor, and a live HomeHub must not make a stale ENV sample current. Keep its formatter and state
// decision in one place so the compact header pill and the inspector always tell the same truth.
function env3State(env) {
  if (S.transportUnavailable === "status") return { text: t("env.unavailable"), cls: "err" };
  const cls = env3ConnectionTone(env);
  return cls === "ok" ? { text: t("env.live"), cls }
    : cls === "warn" ? { text: t("env.collecting"), cls }
    : { text: t("env.unavailable"), cls };
}

function env3Value(env, key, digits, unit) {
  if (S.transportUnavailable === "status" || !env.fresh || !Number.isFinite(Number(env[key]))) return `— ${unit}`;
  const locale = LANG;
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
  group.classList.toggle("fresh", S.transportUnavailable !== "status" && env.fresh === true);
  const label = `${t("env.card")}: ${temperature}; ${state.text}`;
  group.setAttribute("aria-label", label);
  const title = group.querySelector(":scope > title");
  if (title) title.textContent = label;
}

// An independent MQTT room source keeps its history reachable during plant or sensor outages.
function roomReferencePresent() {
  return S.status?.reference_temperature?.configured === true && hasRoomHist("room_temp");
}
function roomReferenceValue() {
  const r = S.status?.reference_temperature || {};
  return roomReferencePresent() && S.transportUnavailable !== "status" && r.has_value === true &&
    r.fresh === true && r.temperature_valid === true && typeof r.temperature_c === "number" &&
    Number.isFinite(r.temperature_c) ? r.temperature_c : null;
}
function renderRoomReference(d) {
  const external = d?.room == null && roomReferencePresent();
  $("svRoom")?.closest("text")?.classList.toggle("sc-room", external);
  if (external) {
    setTxt("svRoom", fmt1(roomReferenceValue()));
    setTxt("svRoomSet", "—");
  }
  const target = $("svRoom")?.closest('[data-insp="room"]');
  if (!target) return;
  const label = inspTitleText(INSPECT.room, d) + (external ? ` · ${roomHistName()}` : "");
  target.setAttribute("aria-label", label);
  const title = target.querySelector(":scope > title");
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
  sc.classList.toggle("no-room", !roomReferencePresent());
  renderRoomReference(null);
  sc.classList.add("no-spaceh");       // no flag to show; the pill would otherwise sit stale
  $("schem").querySelectorAll(".sc-flow, .sc-rflow, .sc-tank-flow, .sc-space-flow").forEach((el) => el.classList.remove("on", "rev"));
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
  // The paired pills come from MB_PAIRS; the four DERIVED ones have no register and so no
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
  const active = !S.otaCached;
  const pumping = active && waterMoving(d);
  setTxt("svSpaceH", t(d.spaceOp ? "chip.space_on" : "chip.space_off"));
  $("gSpaceH").classList.toggle("on", active && d.spaceOp === true);
  const spaceKind = activeSpaceKind(d);
  setTxt("svSpaceCircuit", t(spaceKind === "cool" ? "schem.cooling"
                            : spaceKind === "heat" ? "schem.heating" : "schem.space_circuit"));
  // A non-breaking space: SVG collapses ordinary leading whitespace in a tspan, which would render
  // the step glued to the label ("BUH2").
  setTxt("svBuh", !active ? "" : d.buh2 ? "\u00A02" : d.buh1 ? "\u00A01" : "");

  // Schematic badges
  // Outdoor air, outdoor heat exchanger and discharge come off the pages the outdoor unit stops refreshing when it stops
  // running (d.ouHeldOver): never assert the retained X10A number as current. Outdoor air may instead
  // carry the independent HomeHub register (`mbFields.out`); discharge has no such pairing and
  // keeps the ordinary "—". Petrol makes the replacement source visible without adding a caption.
  setTxt("svOut", ouReadingText(d, "out", d.out, fmt1)); setTxt("svRps", fmt0(d.rps));
  setTxt("svOuHx", ouReadingText(d, "ouHx", d.ouHx, fmt1));
  // High-side badge: the circuit pressure (d.circP). Low/suction side has no equivalent at-rest gauge,
  // so show "—" rather than a misleading 0.0 bar when the compressor is off.
  setTxt("svHp", fmt1(d.circP));
  setTxt("svLp", !d.ouHeldOver && d.lp != null && d.lp > 0 ? fmt1(d.lp) : "—");
  setTxt("svDisch", ouReadingText(d, "disch", d.disch, fmt0)); setTxt("svEev", fmt0(d.eev));
  setTxt("svLwt", fmt1(d.lwt)); setTxt("svRwt", fmt1(d.ret));
  setTxt("svR2t", fmt1(d.r2t)); setTxt("svR3t", fmt1(d.r3t));
  setTxt("svValve2", d.valve2On == null ? "—" : t(d.valve2On ? "state.on" : "state.off"));
  setTxt("svFlowSwitch", d.flowSwitch == null ? "—" : t(d.flowSwitch ? "state.on" : "state.off"));
  // ΔT only means something with water moving (d.dtStale, decided in liveData so the explainer
  // gates on the very same fact). Same reasoning as the derived kW/COP, which already gate.
  setTxt("svDt", d.dtStale ? "—" : fmt1(d.dt)); setTxt("svFlow", fmt1(d.flow ?? d.provisionalFlow));
  setTxt("svWp", fmt1(d.wp)); setTxt("svPump", fmt1(d.pump));
  setTxt("svTank", fmt1(d.tank)); setTxt("svTankSet", fmt1(d.tankSet));
  setTxt("svRoom", fmt1(d.room)); setTxt("svRoomSet", fmt1(d.roomSet));
  // Blanks with the ΔT it is computed from (d.dtStale) — the pill two places to its left already
  // refuses to state that difference, and a product of a refused figure is the same split the ΔT
  // comment above warns about. The zero is arithmetically true (flow 0 carries nothing) and reads
  // as a measured plant output anyway: with the tank heater firing, "≈ 0.0 kW" sat beside a tank
  // climbing at ~2.7 kW. The live pill needs a current working point. History keeps measured
  // no-flow buckets at zero and calculates the signed balance from the independent bucket values.
  setTxt("svPth", fmt1(d.pth));   // derived — applyThermalPlan already refuses pump-only circulation
  setTxt("svValve", d.valveDhw == null ? "3WV" : t(d.valveDhw ? "schem.to_dhw" : "schem.to_space"));

  // Schematic state classes drive the CSS animations (flows, fan, pump, BUH glow, defrost)
  const sc = $("schem");
  sc.classList.toggle("fan-on", active && d.fanRunning === true);
  // The rotor represents reported pump activity, never command magnitude or external flow/RPM.
  // Measured water motion still drives the pipe animations independently below.
  sc.classList.toggle("pump-on", active && d.pumpOn === true);
  sc.classList.toggle("buh-on", active && !!(d.buh1 || d.buh2));
  sc.classList.toggle("bsh-on", active && d.bsh === true);
  sc.classList.toggle("defrost-on", active && d.defrost === true);
  sc.classList.toggle("quiet-on", active && d.quiet === true);
  sc.classList.toggle("valve2-on", active && d.valve2On === true);
  sc.classList.toggle("flow-switch-on", active && d.flowSwitch === true);
  // The supply and return swap thermal colours in cooling. Water keeps its hydraulic direction
  // and a neutral colour during defrost or when the heating/cooling role is unqualified.
  const waterKind = waterThermalKind(d, pumping);
  sc.classList.toggle("cooling-mode", waterKind === "cool");
  sc.classList.toggle("water-neutral", !active || waterKind === "neutral");
  // Mode 2 is evcc's boost / Daikin's Recommended on. The permanent pill changes colour without
  // implying that DHW is already running. The exact manufacturer mode remains written in the
  // HomeHub row, inspector and accessible name.
  sc.classList.toggle("sg-boost-on", active && d.sgMode === 2);
  updateSchematicStateA11y(active ? d : null);
  // A HomeHub heater row can keep the tank visible. Its full-sweep value cannot establish activity.
  sc.classList.toggle("no-dhw", d.tank == null && d.bsh == null && mbBool(32) == null);
  sc.classList.toggle("no-room", d.room == null && !roomReferencePresent());
  renderRoomReference(d);
  sc.classList.toggle("no-spaceh", !active || d.spaceOp == null);
  const onCls = (id, on) => $(id).classList.toggle("on", !!on);
  onCls("fPhe", pumping);
  onCls("fSup1", pumping); onCls("fSup2", pumping); onCls("fSup3", pumping); onCls("fRet", pumping);
  // Common flow proves movement only in the common loop. Each branch needs the current route.
  const toDhw = d.valveDhw;
  const dhwPath = pumping && toDhw === true, heatPath = pumping && toDhw === false;
  onCls("fTank", dhwPath); onCls("fTankEdgeL", dhwPath); onCls("fTankEdgeR", dhwPath); onCls("fTankRet", dhwPath);
  onCls("fHeat", heatPath); onCls("fHeatRet", heatPath); onCls("fSpaceEdgeL", heatPath); onCls("fSpaceEdgeR", heatPath);
  // Directional refrigerant motion requires positive X10A speed and a known thermal task.
  const refrigerantOn = active && d.rps > 0 && d.thermalMode != null;
  onCls("rfHot", refrigerantOn); onCls("rfPhe", refrigerantOn); onCls("rfCold", refrigerantOn);
  // Cooling and defrost both reverse the refrigerant circuit relative to ordinary heating/DHW.
  const refrigerantReverse = refrigerantOn && (d.defrost === true || d.thermalMode === "cool");
  $("rfHot").classList.toggle("rev", refrigerantReverse);
  $("rfPhe").classList.toggle("rev", refrigerantReverse);
  $("rfCold").classList.toggle("rev", refrigerantReverse);

  // The derived figures that used to live in KPI tiles below the drawing, now at their place in it:
  // COP beside the heat output it is computed from, and the electrical input on the outdoor unit
  // where the power actually goes in.
  // What is NOT drawn: their longer annotations. The ΔT's target and the electrical figure's source
  // are in the inspector. The compact "≈" marks the local X10A current×230 V estimate. It is omitted
  // for the value reported by HomeHub; the inspector explains that value's limits.
  setTxt("svCopLabel", efficiencyMetric(d));
  setTxt("svCop", fmt1(d.cop));
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
// English/German copy remains beside the source logic. The eleven newer locale modules mirror only the
// human-facing fields by stable INSPECT key; `now` functions receive the same live snapshot without
// duplicating any source-selection or plant-state logic.
const tx = (o) => (o == null ? "" : typeof o === "string" ? o : o[LANG] ?? o.en);
const degC = (n) => (n == null ? "—" : fmt1(n) + " °C");

const PEL_ESTIMATED_WHAT = {
  en: "Inverter current or the sum of all declared CT phases × assumed 230 V. Voltage and power factor are unknown. Inverter load coverage is unverified. CT coverage depends on wiring.",
  de: "Inverterstrom oder Summe aller gemeldeten CT-Phasen × angenommene 230 V. Spannung und Leistungsfaktor sind unbekannt. Der Inverter-Messumfang ist unbelegt, der CT-Messumfang hängt von der Verdrahtung ab.",
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
  what: (d) => pelMeasured(d) ? PEL_MEASURED_WHAT : PEL_ESTIMATED_WHAT,
  head: (d) => (d.pel == null ? "—" : pelApproxText(d) + fmt1(d.pel) + " kW"),
  // Four cases: the reported gateway row, either X10A current source, a held-over inverter row, or
  // no usable electrical source. Keeping this source-aware prevents a HomeHub reading from
  // being explained as compressor current merely because it is not a CT estimate. An inverter row of
  // unknown age is a fifth, which inspNowText answers before this runs.
  now: (d) => d.pelHeld
    ? { en: "The compressor is off. Inverter current is from the last run, so input power and efficiency are unavailable.",
        de: "Der Verdichter steht. Der Inverterstrom stammt vom letzten Lauf. Stromaufnahme und Effizienz sind nicht verfügbar." }
    : d.pel == null
    ? t("schem.no_usable_power")
    : d.pelSrc === "MB"
    ? { en: "Reported through HomeHub input register 51; the exact measurement boundary is not documented here.",
        de: "Über HomeHub-Eingangsregister 51 gemeldet; die genaue Messgrenze ist hier nicht dokumentiert." }
    : d.pelSrc === "CT"
    ? { en: "Estimated from the CT clamps; included loads depend on their wiring.",
        de: "Aus den Stromwandlern geschätzt; welche Verbraucher enthalten sind, hängt von ihrer Verdrahtung ab." }
    : { en: "Estimated from inverter current.", de: "Aus dem Inverterstrom geschätzt." },
  rows: [/current measured by ct/i, /inv primary current/i],
};

const efficiencyMetric = d => d?.efficiencyKind === "eer" ? "EER" : "COP";
const efficiencyUnavailable = d => t("schem.efficiency_no_capacity", efficiencyMetric(d)) +
  (!d.dtStale && needsCapacitySpeed(d) ? " " + t("schem.capacity_low_speed") : "");

// Copy for a usable plan follows its selected electrical source and outlet. A blocked plan
// has no paired boundary to describe, even when the electrical source is available.
function eerScopeText(d, ct, inverter, unpaired = "") {
  if (!d || d.copBlock != null) return unpaired;
  if (d.copScope === "plant") return typeof ct === "function" ? ct(d.copPostBuh) : ct;
  return d.copScope === "hp" ? inverter : unpaired;
}
const heatingEfficiencyBoundary = d => d?.cop != null ? eerScopeText(d,
  post => " " + t("schem.efficiency_ct_pair", post ? "R2T" : "R1T"),
  " " + t("schem.efficiency_inv_pair")) : "";

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
    rows: [/i\/u operation mode/i, { sel: /thermostat on/i, group: "hydronic" },
           /(error|fault) code/i],
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
    // The hit target and history aria name the stable concept. Source provenance remains explicit
    // in the live title and on the chart lane; freezing a dynamic title at boot could otherwise say
    // X10A on an inspector and timeline that are currently, correctly, sourced from Modbus.
    aria: { en: "Smart-Grid request", de: "Smart-Grid-Anforderung" },
    trend: "smart_grid_mode",
    // The headline still follows the instrument that owns the current request, but history is a
    // comparison of BOTH witnesses. Let the shared history renderer fetch and align both rings: it
    // folds them into one evidence-aware lane, keeps a lone available source labelled, and leaves
    // the exact X10A/Modbus readings to the tooltip.
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
    now: (d) => compressorRunning(d)
        ? d.rps != null
          ? { en: `Running — compressor at ${fmt0(d.rps)} rps.${d.quiet ? " Quiet mode reports ON." : ""}`,
              de: `Läuft — Verdichter mit ${fmt0(d.rps)} rps.${d.quiet ? " Leise-Modus meldet EIN." : ""}` }
          : { en: "HomeHub reports the compressor ON. Speed and detailed outdoor-unit readings require X10A.",
              de: "Der HomeHub meldet den Verdichter als aktiv. Drehzahl und detaillierte Außengerätewerte benötigen X10A." }
        : { en: "The compressor is stopped.", de: "Der Verdichter steht." },
    rows: [{ sel: () => outdoorAirRow(), cid: "outdoor_air" }, ouHxRow, /inv frequency/i,
           highSideRow, /discharge pipe temp/i, /expansion valve ?1/i, () => defrostX10a()],
  },
  comp: {
    t: { en: "Compressor", de: "Verdichter" },
    re: /inv frequency/i, sample: "INV frequency (rps)",
    rows: [/inv frequency/i, /inv primary current/i, /discharge pipe temp/i],
  },
  out: { t: { en: "Outdoor air", de: "Außentemperatur" }, pick: () => outdoorAirRow(), sample: "Outdoor Air Temp. (R1T)" },
  ouhx: {
    t: {
      en: "Outdoor heat-exchanger temperature (R4T)",
      de: "Außengeräte-Wärmetauschertemperatur · R4T",
    },
    pick: ouHxRow,
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
    // The pill draws d.circP from this profile's one high-side row, so the headline resolves THE SAME
    // row. It stays selected while held over, so that the panel can say why the pill is blank, and the
    // curve keeps the last run's samples as the discharge panel's does.
    pick: highSideRow,
    t: { en: "High pressure", de: "Hochdruck" },
    sample: "High pressure",
    trend: "circuit_pressure",
    rows: [highSideRow, /discharge pipe temp/i],
  },
  disch: {
    t: { en: "Discharge temperature", de: "Heißgastemperatur" },
    re: /discharge pipe temp/i, sample: "Discharge pipe temp.",
    rows: [/discharge pipe temp/i, highSideRow],
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
      en: "The plate heat exchanger transfers heat between refrigerant and water without mixing them. Heating and hot-water operation warm the water; cooling removes heat. The estimate uses water flow and R1T/R4T across the exchanger. Sensor placement depends on the model.",
      de: "Der Plattenwärmetauscher überträgt Wärme zwischen Kältemittel und Wasser, ohne beide zu mischen. Beim Heizen und bei Warmwasser geht Wärme ins Wasser; beim Kühlen wird sie ihm entzogen. Die Schätzung nutzt Durchfluss und R1T/R4T am Wärmetauscher. Die Fühlerposition hängt vom Modell ab.",
    },
    // With no qualified flow, the difference between the two temperature readings does not
    // establish an operating point. Use the same decision as the ΔT pill.
    now: (d) => compressorStopped(d)
      ? stoppedCapacityText(d)
      : d.dtStale
      ? { en: "No water-side transfer can be calculated — current pump and flow readings do not establish water movement through the plates.",
          de: "Kein wasserseitiger Übergang berechenbar — die aktuellen Pumpen- und Durchflusswerte belegen keine Wasserbewegung durch die Platten." }
      : needsCapacitySpeed(d) ? t("schem.capacity_low_speed")
      : d.pth == null
      ? { en: "No directional estimate — the readings do not establish useful transfer in the selected operating mode.",
          de: "Keine gerichtete Schätzung — die Messwerte belegen im gewählten Betrieb keinen nutzbaren Energieübergang." }
      : d.pthKind === "cooling"
      ? { en: `About ${fmt1(d.pth)} kW removed from the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Dem Wasser werden rund ${fmt1(d.pth)} kW entzogen: ${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K.` }
      : { en: `About ${fmt1(d.pth)} kW transferred into the water (${fmt1(d.flow)} l/min at ΔT ${fmt1(d.dt)} K).`,
          de: `Rund ${fmt1(d.pth)} kW gehen ins Wasser über: ${fmt1(d.flow)} l/min bei ΔT ${fmt1(d.dt)} K.` },
    rows: [lwtRow, rwtRow, /flow sensor/i],
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
  rwt: { t: { en: "PHE water inlet (R4T)", de: "PHE-Wassereintritt · R4T" }, pick: rwtRow, sample: "Inlet Water Temp. (R4T)" },
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
      : needsCapacitySpeed(d) ? `${fmt1(d.dt)} K. ${t("schem.capacity_low_speed")}`
      : compressorStopped(d)
      ? `${fmt1(d.dt)} K. ${stoppedCapacityText(d)}`
      : d.thermalMode === "cool"
      ? { en: `${fmt1(d.dt)} K. In active cooling R1T should be below R4T, so this signed difference is negative.`,
          de: `${fmt1(d.dt)} K. Beim aktiven Kühlen soll R1T unter R4T liegen; die vorzeichenbehaftete Differenz ist daher negativ.` }
      : { en: `${fmt1(d.dt)} K. Positive means the PHE is adding heat to the water.`,
          de: `${fmt1(d.dt)} K. Positiv bedeutet, dass der PHE dem Wasser Wärme zuführt.` },
    rows: [lwtRow, rwtRow],
  },
  pth: {
    t: (d) => d && d.pthKind === "cooling"
      ? { en: "Cooling capacity (estimated)", de: "Geschätzte Kälteleistung" }
      : { en: "Heat output (estimated)", de: "Geschätzte Wärmeleistung" },
    aria: { en: "Thermal capacity at the PHE (estimated)", de: "Geschätzte thermische Leistung am PHE" },
    trend: (d) => d && d.pthKind === "cooling" ? "" : "pth",
    what: (d) => d && d.pthKind === "cooling"
      ? { en: "Estimated heat removed from water: flow/60 × (R4T−R1T) × ρ·cp (≈ 4.186 kJ/(l·K) for water). Sensor accuracy and fluid properties matter. The estimate needs a running compressor and a cooling-direction difference. R1T/R4T measure the PHE, not the emitters.",
          de: "Geschätzter Wärmeentzug: Durchfluss/60 × (R4T−R1T) × ρ·cp (≈ 4,186 kJ/(l·K) für Wasser). Fühlergenauigkeit und Medium beeinflussen den Wert. Die Schätzung braucht Verdichterlauf und eine Temperaturdifferenz in Kühlrichtung. R1T/R4T messen am PHE, nicht an den Flächen." }
      : { en: "Estimated heat added to water: flow/60 × (R1T−R4T) × ρ·cp (≈ 4.186 kJ/(l·K) for water). Sensor accuracy and fluid properties matter. The estimate needs a running compressor and a heating-direction difference. The backup heater is downstream of R1T and excluded.",
          de: "Geschätzte Wärmezufuhr: Durchfluss/60 × (R1T−R4T) × ρ·cp (≈ 4,186 kJ/(l·K) für Wasser). Fühlergenauigkeit und Medium beeinflussen den Wert. Die Schätzung braucht Verdichterlauf und eine Temperaturdifferenz in Heizrichtung. Der Zusatzheizer hinter R1T ist nicht enthalten." },
    head: (d) => (d.dtStale || d.pth == null ? "—" : "≈ " + fmt1(d.pth) + " kW"),
    // Quote COP here only when it uses this heat estimate. A CT-based ratio may use the post-BUH
    // outlet instead; the COP pill names that scope.
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
      : needsCapacitySpeed(d) ? t("schem.capacity_low_speed")
      : d.pth == null ? null
      : d.pthKind === "cooling"
      ? { en: `≈ ${fmt1(d.pth)} kW cooling${d.cop != null && !d.copPostBuh ? `, EER ${fmt1(d.cop)}` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW Kälteleistung${d.cop != null && !d.copPostBuh ? `; EER ${fmt1(d.cop)}` : ""}.` }
      : { en: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `, COP ${fmt1(d.cop)}` : ""}.`,
          de: `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${fmt1(d.cop)}` : ""}.` },
    rows: [/flow sensor/i, /current measured by ct/i, /inv primary current/i],
  },
  // Its own pill next to the heat output, so its own entry — and the one derived figure with no
  // catalog row behind it at all, hence copy written here rather than pulled from DESCRIPTIONS.
  //
  // The title identifies the electrical source. The CT path prefers a usable post-BUH row, but
  // permits pre-BUH heat when backup heating is known to be off. The inspector lists the post-BUH
  // row only when used. See logic/cop_scope.hpp for the source rule.
  cop: {
    t: (d) => {
      const metric = efficiencyMetric(d);
      return { en: eerScopeText(d, `${metric} based on current transformers (estimated)`,
                                `Inverter-current-based ${metric} estimate`, `Estimated ${metric}`),
               de: eerScopeText(d, `Geschätzter ${metric} aus Stromwandlerwerten`,
                                `${metric}-Schätzung aus Inverterstrom`, `Geschätzter ${metric}`) };
    },
    // The hit target's accessible name — stable, because it is applied once at startup (see
    // labelSchematicHits). Which COP it turns out to be is the panel's to say, not the label's.
    aria: { en: "Efficiency (estimated)", de: "Geschätzte Effizienz" },
    what: (d) => d && d.efficiencyKind === "eer"
      ? {
        en: "Estimated cooling capacity divided by estimated input. Requires a running compressor and outlet below R4T. This live estimate depends on fluid, sensors, voltage and power factor." +
          eerScopeText(d, post => ` Uses ${post ? "R2T after" : "R1T before"} the backup heater and R4T with current transformers. Both BUH stages and BSH must be confirmed off. CT wiring determines which loads are included.`,
            " " + t("schem.efficiency_inv_pair")),
        de: "Geschätzte Kälteleistung geteilt durch geschätzte Stromaufnahme. Erfordert laufenden Verdichter und Vorlauf unter R4T. Der Momentanwert hängt von Medium, Fühlern, Spannung und Leistungsfaktor ab." +
          eerScopeText(d, post => ` Verwendet ${post ? "R2T hinter" : "R1T vor"} dem Zusatzheizer und R4T mit Stromwandlerwerten. Beide BUH-Stufen und der BSH müssen nachweislich aus sein. Die CT-Verdrahtung bestimmt die erfassten Verbraucher.`,
            " " + t("schem.efficiency_inv_pair")),
      }
      : {
      en: "Estimated heat output divided by estimated input. CT requires both BUH stages and BSH confirmed off. Otherwise a usable inverter estimate is required. CT coverage depends on wiring." + heatingEfficiencyBoundary(d),
      de: "Geschätzte Wärmeleistung geteilt durch geschätzte Stromaufnahme. Für CT müssen beide BUH-Stufen und BSH nachweislich aus sein. Sonst ist eine nutzbare Inverterschätzung nötig. Der CT-Messumfang hängt von der Verdrahtung ab." + heatingEfficiencyBoundary(d),
      },
    head: (d) => fmt1(d.cop),
    // The heater guards also block unknown states. Keep those distinct from reported operation.
    now: (d) => d.copBlock === "tank_heater"
      ? { en: `No ${efficiencyMetric(d)}. ${d.bsh === true ? "The tank heater reports ON." : "The tank heater status is unknown."} Its heat bypasses both leaving-water sensors.`,
          de: `Derzeit kein ${efficiencyMetric(d)}. ${d.bsh === true ? "Der Speicherheizstab meldet EIN." : "Der Status des Speicherheizstabs ist unbekannt."} Seine Wärme passiert keinen der Vorlauffühler.` }
      : d.copBlock === "backup_heater"
      ? { en: `No ${efficiencyMetric(d)}. ${d.buh1 === true || d.buh2 === true ? "The backup heater reports ON." : "The backup heater status is unknown."} The electrical estimate cannot establish whether the heater load is included.`,
          de: `Derzeit kein ${efficiencyMetric(d)}. ${d.buh1 === true || d.buh2 === true ? "Der Zusatzheizer meldet EIN." : "Der Status des Zusatzheizers ist unbekannt."} Die Stromschätzung zeigt nicht, ob die Last des Heizers erfasst ist.` }
      : d.copBlock === "mb_scope"
      ? { en: `No ${efficiencyMetric(d)} right now. The available data cannot match HomeHub power to the estimated heat across the plate heat exchanger. Which electrical loads the power reading covers, including heaters, is unknown.`,
          de: `Derzeit kein ${efficiencyMetric(d)}. Die verfügbaren Daten erlauben keinen Vergleich der vom HomeHub gemeldeten elektrischen Leistung mit der geschätzten Wärmeleistung am Plattenwärmetauscher. Welche Verbraucher die Leistung umfasst, etwa Elektroheizer, ist unklar.` }
      // No usable electrical input at all. Which of the two reasons it is matters — the pill's own
      // explainer draws the same distinction, and saying "this profile has no row" about a profile
      // that has one would substitute a second wrong claim for the suppressed one. The third reason,
      // an inverter row of unknown age, is answered by inspNowText before this runs.
      : d.copBlock === "no_pel"
      ? (d.pelHeld
        ? { en: `No ${efficiencyMetric(d)}. The compressor is off and inverter current is from the last run.`,
            de: `Kein ${efficiencyMetric(d)}. Der Verdichter steht und der Inverterstrom stammt vom letzten Lauf.` }
        : t("schem.no_usable_power", efficiencyMetric(d)))
      : d.cop == null ? efficiencyUnavailable(d)
      : d.efficiencyKind === "eer"
      ? { en: `${fmt1(d.cop)} kW of cooling per kW of electricity — ≈ ${fmt1(d.copPth)} kW removed for ≈ ${fmt1(d.copPel)} kW in.`,
          de: `${fmt1(d.cop)} kW Kälteleistung je kW Strom — ≈ ${fmt1(d.copPth)} kW entzogen bei ≈ ${fmt1(d.copPel)} kW Aufnahme.` }
      : { en: `${fmt1(d.cop)} kW of water-side heat per kW of estimated input: ≈ ${fmt1(d.copPth)} kW heat for ≈ ${fmt1(d.copPel)} kW input.`,
          de: `${fmt1(d.cop)} kW wasserseitige Wärme je kW geschätzter Aufnahme: ≈ ${fmt1(d.copPth)} kW Wärme bei ≈ ${fmt1(d.copPel)} kW Aufnahme.` },
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
    now: (d) => d.buh2 === true ? { en: "Step 2 reports ON.", de: "Stufe 2 meldet EIN." }
      : d.buh1 === true ? { en: "Step 1 reports ON.", de: "Stufe 1 meldet EIN." }
      : d.buh1 === false && d.buh2 === false
      ? { en: "Both stages report OFF.", de: "Beide Stufen melden AUS." } : null,
    rows: [/buh step ?1/i, /buh step ?2/i, /buh output capacity/i],
  },
  bsh: {
    t: { en: "Electric tank heater", de: "Heizstab" },
    pick: () => bshX10a(), sample: "BSH",
    // Show the current X10A state and its own sampled timeline.
    x10aOnly: true,
    trend: "bsh_state",
    trendSource: "x10a",
    now: (d) => d.bsh == null ? null
      : d.bsh
        ? { en: "Electric tank heater active.", de: "Heizstab aktiv." }
        : { en: "Off — the tank is not using its electric immersion heater.",
            de: "OFF — der Heizstab im Speicher ist nicht aktiv." },
  },
  valve: {
    t: { en: "3-way valve", de: "3-Wege-Ventil" },
    pick: () => valveX10a(), sample: "3-way valve (On:DHW/Off:Space)",
    x10aOnly: true,
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
    rows: [/dhw tank temp/i, /dhw setpoint/i, { sel: () => valveX10a(), cid: "valve_dhw" }],
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
        ? d.thermalMode === "cool" && compressorStopped(d) && heatersOff(d) && d.pthRaw > 0
          ? { en: `Residual-hot water is routed into the hydraulic space branch. Internal R1T is ${degC(d.lwt)}; no downstream sensor confirms the emitter temperature. This is not active cooling.`,
              de: `Restwarmes Wasser wird hydraulisch in den Raumzweig geführt. Der interne R1T misst ${degC(d.lwt)}; kein nachgeschalteter Fühler bestätigt die Temperatur an den Flächen. Das ist kein aktiver Kühlbetrieb.` }
          : { en: `Water is routed toward the ${activeSpaceKind(d) === "cool" ? "cooling" : activeSpaceKind(d) === "heat" ? "heating" : "space"} circuit. Internal R1T is ${degC(d.lwt)}; no downstream sensor confirms the emitter temperature.`,
              de: `Wasser wird zum ${activeSpaceKind(d) === "cool" ? "Kühlkreis" : activeSpaceKind(d) === "heat" ? "Heizkreis" : "Raumkreis"} geführt. Der interne R1T misst ${degC(d.lwt)}; kein nachgeschalteter Fühler bestätigt die Flächentemperatur.` }
        : { en: "Current pump and flow readings do not establish circulation through the space branch.",
            de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation durch den Raumzweig." },
    rows: [ROOM_TEMP_RE, /^rt setpoint/i, { sel: /^space heating operation/i, cid: "space_op" }],
  },
  // This catalog row is normal space heat/cool operation, not a heating demand. "Thermostat ON/OFF"
  // remains with the indoor-unit status byte; neither bit alone proves compressor operation.
  spaceh: {
    t: { en: "Space heating/cooling operation", de: "Raumheiz-/kühlbetrieb" },
    re: /^space heating operation/i, sample: "Space heating Operation ON/OFF",
    rows: [/^space heating operation/i, ROOM_TEMP_RE, /^rt setpoint/i],
  },
  room: {
    t: { en: "Room temperature", de: "Raumtemperatur" },
    re: ROOM_TEMP_RE, sample: "Indoor Ambient Temp. (R1T)",
    rows: [ROOM_TEMP_RE, /^rt setpoint/i],
  },
  pump: {
    t: { en: "Circulation pump", de: "Umwälzpumpe" },
    aria: { en: "Circulation-pump command", de: "Ansteuerung der Umwälzpumpe" },
    trend: "pump_speed",
    what: { en: "The displayed command is 100 − raw X10A: 0 % requests stop and 100 % maximum effort. The raw signal has the opposite endpoints. Read reported ON/OFF and measured flow separately. The command measures neither speed nor flow. Water can circulate while the compressor is off.",
      de: "Die angezeigte Ansteuerung ist 100 − X10A-Rohwert: 0 % fordert Stopp und 100 % Maximum an. Das Rohsignal hat die umgekehrten Endpunkte. Status und Durchfluss getrennt ablesen. Die Ansteuerung misst weder Drehzahl noch Durchfluss. Wasser kann bei stehendem Verdichter zirkulieren." },
    pick: () => pumpX10a(), sample: "Water pump operation",
    now: (d) => ({ en: pumpNowText(d, [(n) => `Pump command ${n} %.`, "The pump status is ON.", "The pump reports stopped (OFF).", "The reported pump state is unknown.", (n) => `Measured flow ${n} l/min.`, "No flow measurement is available.", "Reported OFF conflicts with flow. Possible causes include external circulation, coast-down or stale readings.", "Water circulation is not established."]),
      de: pumpNowText(d, [(n) => `Pumpenansteuerung ${n} %.`, "Der Pumpenstatus ist ON.", "Die Pumpe meldet Stillstand (OFF).", "Der gemeldete Pumpenstatus ist unbekannt.", (n) => `Gemessener Durchfluss ${n} l/min.`, "Ein Durchflussmesswert fehlt.", "Gemeldetes OFF und Durchfluss widersprechen sich. Mögliche Ursachen sind externe Umwälzung, Nachlauf oder alte Werte.", "Wasserzirkulation ist damit nicht belegt."]) }),
    rows: [/water pump signal/i, { sel: /flow sensor/i, cid: "flow" }, /^water pressure$/i],
  },
  pel: PEL_INSPECT,
  defrost: {
    t: { en: "Defrost", de: "Abtauen" },
    pick: () => defrostX10a(), sample: "Defrost Operation",
    trend: "defrost_state",
    now: (d) => d.defrost == null ? null : d.defrost
      ? { en: "X10A reports defrost active.", de: "X10A meldet aktives Abtauen." }
      : { en: "X10A reports defrost off.", de: "X10A meldet Abtauen als aus." },
  },
  quiet: {
    t: { en: "Quiet mode", de: "Leise-Modus" },
    re: /^silent mode$/i, sample: "Silent Mode",
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
        : { en: "HomeHub reports the compressor ON. Pressure and discharge temperature require X10A.",
            de: "Der HomeHub meldet den Verdichter als aktiv. Druck und Heißgastemperatur benötigen X10A." }
      : { en: "No active refrigerant circulation — the compressor is stopped. Pressure equalisation depends on the circuit and how long it has been idle.",
          de: "Kein aktiver Kältemittelumlauf — der Verdichter steht. Ob und wie weit sich die Drücke angeglichen haben, hängt vom Kältekreis und der Stillstandszeit ab." },
    rows: [highSideRow, /discharge pipe temp/i],
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
        : { en: "HomeHub reports the compressor ON. Expansion-valve position requires X10A.",
            de: "Der HomeHub meldet den Verdichter als aktiv. Die Stellung des Expansionsventils benötigt X10A." }
      : { en: "The compressor is stopped.", de: "Der Verdichter steht." },
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
    rows: [/dhw tank temp/i, /dhw setpoint/i, { sel: () => valveX10a(), cid: "valve_dhw" }],
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
        ? d.thermalMode === "cool" && compressorStopped(d) && heatersOff(d) && d.pthRaw > 0
          ? { en: `Residual-heat circulation toward the hydraulic space branch at ${fmt1(d.flow)} l/min; no active cooling. Internal PHE sensors read R1T ${degC(d.lwt)} and R4T ${degC(d.ret)}; the field-side temperature is not measured.`,
              de: `Restwärme-Umlauf zum hydraulischen Raumzweig mit ${fmt1(d.flow)} l/min; keine aktive Kühlung. Die internen PHE-Fühler messen R1T ${degC(d.lwt)} und R4T ${degC(d.ret)}; die Temperatur an den Heiz-/Kühlflächen des Gebäudes wird nicht gemessen.` }
          : { en: `Circulating toward the space branch at ${fmt1(d.flow)} l/min. Internal PHE sensors read R1T ${degC(d.lwt)} and R4T ${degC(d.ret)}.`,
              de: `Zirkulation zum Raumkreis mit ${fmt1(d.flow)} l/min. Die internen PHE-Fühler messen R1T ${degC(d.lwt)} und R4T ${degC(d.ret)}.` }
        : { en: "Current pump and flow readings do not establish circulation through the space branch.",
            de: "Die aktuellen Pumpen- und Durchflusswerte belegen keine Zirkulation durch den Raumzweig." },
    rows: [lwtRow, rwtRow, /^space heating operation/i],
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
    rows: [rwtRow, /flow sensor/i, /^water pressure$/i],
  },
  flow: {
    t: { en: "Flow rate", de: "Durchfluss" },
    re: /flow sensor/i, sample: "Flow sensor",
    head: (d) => d.flowInvalid ? "—" : null,
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

// Locale modules mirror only the human-facing fields of INSPECT, keyed by this stable target id.
// Keeping the live selectors and source arbitration here prevents a translated copy table from
// becoming a second implementation of plant logic. A locale may use a function for dynamic copy;
// it receives the same liveData snapshot as the English/German source field.
for (const [key, entry] of Object.entries(INSPECT)) entry.i18nKey = key;
const inspLocaleEntry = (e) => INSPECT_I18N[LANG]?.[e?.i18nKey];
const inspHasLocaleField = (e, field) =>
  !!inspLocaleEntry(e) && Object.prototype.hasOwnProperty.call(inspLocaleEntry(e), field);
const inspLocaleField = (e, field, d) => {
  const value = inspLocaleEntry(e)?.[field];
  return typeof value === "function" ? value(d) : value;
};
const inspSourceField = (e, field, d) => {
  const value = e && e[field];
  return typeof value === "function" ? value(d) : value;
};
const inspFieldText = (e, field, d) => {
  if (e.i18nKey === "pth" && d?.defrost) {
    if (field === "t") return t("schem.defrost_transfer");
    if (field === "what") return `(L/min ÷ 60) × (R1T−R4T) × 4.186. ${t("schem.transfer_sign")}`;
  }
  if (inspHasLocaleField(e, field)) {
    const localized = inspLocaleField(e, field, d);
    if (localized != null || field !== "what") return localized == null ? null : String(localized);
  }
  return tx(inspSourceField(e, field, d));
};

// A row selector is either a label pattern or a PICKER FUNCTION. Quantities whose selection is a
// judgement rather than a match — leaving water, where a setpoint / mixed-zone / post-BUH row must
// never be substituted for the measurement (issue legacy-121) — name their picker, so the rule lives in
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
  return x10aDown() || rowHeldOver(r, S.live) ||
    (e.i18nKey === "out" && S.live?.mbFields?.has("out")) ? null : r;
};

// One member reading, resolved for BOTH the body and the change signature. Returns the pair the
// panel draws: the X10A row where it is current, and the gateway's row beside it (its second
// opinion) or in its place (while X10A is silent). Written once because the signature is what
// decides whether the body repaints — a body that renders something the signature cannot see stops
// updating and shows a value from whenever something else last moved, looking perfectly current.
function inspMember(sel) {
  // A selector may carry an explicit Modbus concept ({sel, cid}) so its HomeHub twin can stand in even
  // on a board with NO X10A row to source the concept from — X10A absent, HomeHub live. Without it the
  // space-operation evidence (the only reading a HomeHub-only plant can offer here) vanished with the
  // X10A rows, leaving the RAUMKREIS explainer empty though the gateway was answering.
  const spec = sel && sel.sel ? sel : null;
  const selector = spec && spec.group ? () => vRowGroup(spec.sel, spec.group)
                 : spec ? spec.sel : sel;
  const cid = spec && spec.cid ? spec.cid : null;
  if (cid === "outdoor_air" && (x10aDown() || S.live?.mbFields?.has("out")))
    return { x10a: null, mb: mbForInspect("out") };
  const r = pickRow(selector);
  if (cid === "valve_dhw") return { x10a: r, mb: null };
  // X10A down: the retained row is not a reading any more. The gateway stands in where it carries
  // the same quantity (mbFallbackFor — the helper whose whole job is that substitution) and the
  // member simply disappears where it does not, rather than printing a stale number under its label.
  // With no X10A row at all, the explicit concept (cid) is what still finds the gateway's twin.
  if (x10aDown()) return { x10a: null, mb: mbFallbackFor(r?.concept || cid) };
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
    : modbusScaleHtml(m.mb);
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
  // The third answer, which keeps its number: the pill cannot say the number may be old without
  // becoming a second, dimmer class of reading, so the panel has to. One sentence, because it also
  // explains the withheld electrical estimate and COP, and this copy lands in every locale's flash.
  unknown: {
    en: "The age of these X10A outdoor-unit readings is unknown. They may be from the last run.",
    de: "Das Alter dieser X10A-Außengerätewerte ist unbekannt. Sie können vom letzten Lauf stammen.",
  },
};
// A held X10A row is still unavailable, but it is no longer a blank headline when the drawing has
// substituted a live HomeHub reading for this target. In that case the inspector names the Modbus
// row and must not append a contradictory "No current reading" note.
const inspHeld = (e, d) => !!d && rowHeldOver(inspRow(e), d) && !mbForInspect(S.insp);
const inspHeldHtml = (e, d) => {
  if (inspUnknownAge(e, d)) return inspNowText(e, d)?.startsWith(heldUnknownText()) ? "" : heldUnknownNoteHtml();
  if (!inspHeld(e, d)) return "";
  const localized = INSPECT_I18N[LANG]?.held;
  const reason = compressorConflict(d) ? compressorConflictText(d)
    : homehubOnlyCompressorOff(d) ? t("schem.homehub_compressor_off") + " " + t("schem.outdoor_held")
    : !compressorStopped(d) ? t("schem.outdoor_held")
    : localized?.why || tx(HELD_OVER_NOW.why);
  return descNoteHtml(localized?.lead || tx(HELD_OVER_NOW.lead), reason);
};
// The headline or a listed member row: every number in the panel carries the same doubt.
const inspUnknownAge = (e, d) => !!d && d.ouUnknown && (inspCurRow(e)?.held_unknown === true ||
  inspMembers(e, null, null).some((m) => m.x10a?.held_unknown === true));
const heldUnknownText = () => INSPECT_I18N[LANG]?.held_unknown || tx(HELD_OVER_NOW.unknown);
// One note for the panel and the value table, which both state a reading of unknown age as a number.
const heldUnknownNoteHtml = () => descNoteHtml("", heldUnknownText());

// The panels whose sentence is decided by compressorRunning(), which reads an unknown compressor as
// stopped. The unknown-age sentence replaces theirs, so that no panel states a stop nobody measured.
const COMPRESSOR_NOW = /^(?:phe|rhot|rcold|dt)$/;
const COMPRESSOR_CONFLICT_NOW = /^(?:comp|rhot|rcold)$/;
const WATER_BRANCH_NOW = /^(?:heat|wtank|wheat)$/;
function outdoorInspectorNow(e, d) {
  const unknown = d.rps == null && d.compressorOn == null;
  const state = compressorConflict(d) ? compressorConflictText(d)
    : d.defrost === true ? inspFieldText(INSPECT.defrost, "now", d)
    : unknown ? d.ouUnknown ? heldUnknownText() : t("dyn.state_gate")
    : homehubOnlyCompressorOff(d) ? t("schem.homehub_compressor_off")
    : inspFieldText(e, "now", d);
  const water = !d.defrost && compressorStopped(d) ? " " + t("schem.outdoor_independent") : "";
  // Link state, retained readings and the displayed air source are independent observations.
  const link = x10aDown() ? t("sys.x10a_down") : d.ouHeldOver ? t("schem.outdoor_held") : "";
  const source = Number.isFinite(d.out) && d.mbFields?.has("out") ? t("schem.outdoor_homehub") : "";
  return [state + water, link, source].filter(Boolean).join(" · ");
}
// The live sentence above the timeless description — dropped entirely while the reading is held
// over, where the note below the description answers instead.
const inspNowText = (e, d) => {
  if (S.otaCached && d) return t("ota.snapshot_value");
  if (!d || inspHeld(e, d)) return null;
  if (e.i18nKey === "ou") return outdoorInspectorNow(e, d);
  if (e.i18nKey === "flow" && d.flowInvalid) return t("schem.flow_invalid");
  if (d.pthKind === "transfer" && (e.i18nKey === "phe" || e.i18nKey === "pth"))
    return `≈ ${fmt1(d.pth)} kW.` + (e.i18nKey === "phe" ? " " + t("schem.transfer_sign") : "");
  if (WATER_BRANCH_NOW.test(e.i18nKey) && d.valveDhw == null) return t("schem.water_route_unknown");
  const conflict = compressorConflict(d);
  if (conflict && COMPRESSOR_CONFLICT_NOW.test(e.i18nKey)) return compressorConflictText(d);
  const reportedOff = homehubOnlyCompressorOff(d);
  if (reportedOff && (e.i18nKey === "rhot" || e.i18nKey === "rcold"))
    return t("schem.homehub_compressor_off");
  if (e.i18nKey === "pel" || e.i18nKey === "cop") {
    if (d.pelHeld && (reportedOff || !compressorStopped(d))) {
      const reason = t("schem.no_usable_power", e.i18nKey === "cop" ? efficiencyMetric(d) : "");
      return reportedOff ? t("schem.homehub_compressor_off") + " " + reason : reason;
    }
    if (d.pelUnknown) return heldUnknownText();
    if (d.pelUnread) return `${INSPECT_I18N[LANG]?.held?.lead || tx(HELD_OVER_NOW.lead)} ${d.pelUnread}`;
  }
  // A ΔT without measured water movement has its own reason.
  if (d.rps == null && d.compressorOn == null && COMPRESSOR_NOW.test(e.i18nKey) &&
      !(e.i18nKey === "dt" && d.dtStale))
    return d.ouUnknown ? heldUnknownText() : t("dyn.state_gate");
  return (e.now || INSPECT_I18N[LANG]?.[e.i18nKey]?.now) ? inspFieldText(e, "now", d) : null;
};

// An entry's title, which may DEPEND on the live values — `t` takes the same {en,de}-or-function
// shape `head` and `now` already do. Only the COP uses it: which system its quotient describes is
// decided per poll (logic/cop_scope.hpp), and the title is where that has to be said, since the
// number itself looks identical either way. Resolved through one helper so renderInspect and
// inspectSig cannot disagree about it — a dynamic title left out of the signature would simply
// stop repainting when the scope flipped.
const inspTitleText = (e, d) => inspFieldText(e, "t", d);

// Everything the panel would draw, as one string — the change key for the render guard above. It
// covers the selection, the headline, the live sentence and every member reading, so a value moving
// still repaints while an idle second does not.
const inspectModbusSignature = (row) => row
  ? JSON.stringify([row.value, row.label, row.unit, row.off, row.profile, row.enum, row.binary,
                    row.flow_scale_unverified]) : "";
function inspectSourceStyle(mb = false, room = false) {
  for (const id of ["inspSrc", "inspNow"]) {
    $(id).classList.toggle("src-val-mb", mb);
    $(id).classList.toggle("src-val-room", room);
  }
}
function inspectSig(e) {
  if (!e) return "";
  if (e.env3) {
    const env = S.status?.env3 || {};
    return [LANG, S.insp, S.transportUnavailable === "status", env.supported, env.enabled, env.fresh, env.error || "",
            env.temperature_c, env.humidity_pct, env.pressure_hpa].join("|");
  }
  const d = S.live;
  const room = S.insp === "room" ? S.status?.reference_temperature || {} : {};
  const roomSig = S.insp === "room" ? JSON.stringify([
    roomReferencePresent(), S.transportUnavailable, S.status?.mqtt?.configured, room.name,
    room.temperature_c, room.has_value, room.fresh, room.temperature_valid, room.reason,
    room.freshness_reason, room.error,
  ]) : "";
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
    return inspVal(m.x10a, d) + (m.mb ? "/" + inspectModbusSignature(m.mb) : "")
      + (m.compare ? "/" + m.compare.value : "");
  }) : []).join(",");
  const held = !inspHeld(e, d) ? "" : compressorConflict(d) ? "held-conflict"
    : homehubOnlyCompressorOff(d) ? "held-homehub" : compressorStopped(d) ? "held-stopped" : "held";
  // LANG guarantees the full body is redrawn even when this particular entry's title/live sentence
  // happens to be spelled identically in both dictionaries.
  return [LANG, S.insp, inspTitleText(e, d), inspVal(row, d), inspectModbusSignature(fb),
          d && e.head ? e.head(d) : "",
          inspNowText(e, d) || "", held,
          inspUnknownAge(e, d) ? "unknown_age" : "", rows, roomSig].join("|");
}

// The trend under the inspector: the same chart the value list draws. A resolved X10A row chooses
// its structural trend; one of the six paired schematic measurements also brings its independent
// HomeHub ring, and may therefore keep a petrol curve when X10A has no current row. Computed pills
// still chart only their own derived series — never one of their inputs.
//
// Chart state has its own signature, independent of changing inspector readings. A new series
// (`gen`), categorical live cap or pin updates its markup; ordinary scalar polls keep it mounted.
function renderInspectHist(e, row) {
  if (e && e.env3) {
    const offered = ENV3_COMBINED_SERIES.filter((s) => hasEnv3Hist(s.id));
    for (const s of offered) ensureHist(s.id, "env3");
    const seriesSig = offered.map((s) => {
      const h = S.hist.get(histCacheKey(s.id, "env3"));
      return `${s.id}:${h ? (h.err ? "e" : h.gen) : ""}`;
    });
    const pin = S.histPin.get(ENV3_COMBINED_ID);
    const sig = [LANG, ENV3_COMBINED_ID, S.transportUnavailable === "status", ...seriesSig,
                 pin ? (pin.t ?? `${pin.i}/${pin.gen}`) : ""].join("|");
    if (sig === S.inspHistSig) return;
    S.inspHistSig = sig;
    const el = $("inspHist");
    el.hidden = !offered.length;
    replaceHistoryHtml(el, offered.length ? env3HistHtml() : "");
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
    : trendSource === "x10a" ? hasHist(id) : hasHist(id) || hasModbusHist(id) || hasRoomHist(id);
  const explicitId = trendId && offered(trendId) ? trendId : "";
  const id = explicitId || (row ? histIdFor(row.label) : pairedId)
    || (S.insp === "room" && hasRoomHist("room_temp") ? "room_temp" : "");
  if (id) {
    if (trendSource) ensureHist(id, trendSource);
    else ensureHistPair(id);                // throttled to once a minute inside; no-op once cached
    if (id === "dhw_tank") {
      ensureHist("smart_grid_mode");
      ensureHist("smart_grid_mode", "modbus");
      ensureHist("bsh_state");
      ensureHist("bsh_state", "modbus");
    }
  }
  const h = id && trendSource !== "modbus" ? S.hist.get(id) : null;
  const mh = id && trendSource !== "x10a" ? S.hist.get(histCacheKey(id, "modbus")) : null;
  const rh = id && !trendSource ? S.hist.get(histCacheKey(id, "room")) : null;
  const pin = id ? S.histPin.get(id) : null;
  // Categorical histories append a display-only live sample. Include only that derived state in the
  // chart signature, so an actual change repaints the current cap while unchanged values polls
  // still leave a tooltip/crosshair DOM completely alone.
  const liveGen = id && typeof STATE_HIST !== "undefined" && STATE_HIST[id]
    ? historyView(id, trendSource)?.gen || "" : "";
  const auxGen = id === "dhw_tank"
    ? `${S.hist.get("smart_grid_mode")?.gen || ""}/` +
      `${S.hist.get(histCacheKey("smart_grid_mode", "modbus"))?.gen || ""}/` +
      `${S.hist.get("bsh_state")?.gen || ""}/` +
      `${S.hist.get(histCacheKey("bsh_state", "modbus"))?.gen || ""}`
    : "";
  // histHtml carries localised axis/readout copy. A language switch must therefore invalidate the
  // inspector chart even when the series generation and pinned sample are unchanged.
  const sig = [LANG, id, trendSource, h ? (h.err ? "e" : h.gen) : "", mh ? (mh.err ? "e" : mh.gen) : "",
               rh ? (rh.err ? "e" : rh.gen) : "", id === "room_temp" ? roomHistName() : "",
               liveGen, auxGen, pin ? (pin.t ?? `${pin.i}/${pin.gen}`) : ""].join("|");
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
  const chartName = DERIVED[id] && e && e.aria ? inspFieldText(e, "aria", null) : null;
  replaceHistoryHtml(el, !id ? ""
    : row ? histHtml(id, displayUnit(row), chartName || displayReadingLabel(row.label, row), trendSource)
    : pairedId ? histHtml(id, mb ? displayUnit(mb) : "", mb ? displayHomeHubLabel(mb) : inspTitleText(e, null), trendSource)
               : histHtml(id, DERIVED[id]?.unit || "",
                          e.aria ? inspFieldText(e, "aria", null) : inspTitleText(e, null), trendSource));
}

function renderInspect() {
  const e = S.insp ? INSPECT[S.insp] : null;
  // Freeze with the other trend hosts during a scrub so structural updates cannot replace the
  // captured plot. scrubEnd resumes every affected host.
  if (S.scrub) return;
  // The chart is decided ahead of the early return below, because its own state moves independently
  // of the card's: the series arrives from an async fetch that changes no live value.
  // inspCurRow refuses a retained X10A row. renderInspectHist may still resolve this target's paired
  // Modbus ring, so a petrol headline gets petrol history without reviving stale X10A samples.
  renderInspectHist(e, S.live && e ? inspCurRow(e) : null);
  // Compare the inspector signature before rendering changed live readings; unchanged polls need
  // no DOM writes and preserve the reader's text selection.
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
    setHtml("inspSrc", "ENV III", false);
    $("inspSrc").hidden = false;
    inspectSourceStyle();
    $("inspNow").hidden = false;
    setTxt("inspNow", env3Value(env, "temperature_c", 1, "°C"));
    // Values precede the chart so the combined timeline is the final, full-width evidence block in
    // the infobox. Temperature is repeated deliberately: the header mirrors the pill while this
    // list keeps the three ENV III instruments directly comparable and independently labelled.
    setHtml("inspBody",
      `<div class="inspect-env-state ${state.cls}">${esc(t("env.sensor_state"))}: ${esc(state.text)}</div>` +
      `<div class="vdesc-p">${esc(t("env.history_help"))}</div>` +
      `<div class="inspect-rows inspect-env-values">` +
        valueRow(t("env.temperature"), env3Value(env, "temperature_c", 1, "°C")) +
        valueRow(t("env.humidity"), env3Value(env, "humidity_pct", 0, "%")) +
        valueRow(t("env.pressure"), env3Value(env, "pressure_hpa", 0, "hPa")) +
      `</div>`, false);
    setHtml("inspRows", "", false);
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
  inspectSourceStyle(!!fb);
  if (S.insp === "room" && !row && !fb && roomReferencePresent()) {
    const r = S.status.reference_temperature;
    setTxt("inspTitle", inspTitleText(e, d));
    setHtml("inspSrc", esc(roomHistName()), false);
    $("inspSrc").hidden = false;
    inspectSourceStyle(false, true);
    setTxt("inspNow", `${fmt1(roomReferenceValue())} °C`);
    $("inspNow").hidden = false;
    setHtml("inspBody", descParaHtml(esc(roomSourceStatusText(roomSourceStatus(r, S.status?.mqtt || {})))), false);
    setHtml("inspRows", "", false);
    return;
  }
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
  setHtml("inspSrc", esc(srcName) +
    (fb ? ` <span class="mb-tag">${esc(t("src.modbus_tag"))}</span>` : ""), false);
  $("inspSrc").hidden = !(row || fb || e.sample);
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
  const ownWhat = inspFieldText(e, "what", d);
  // A native replacement must retain its source-specific interpretation limits in every locale.
  // Generic inspector copy describes the X10A quantity and cannot override the defining register.
  const preferSourceDesc = fb && desc?.sourceQualified;
  const what = ownWhat && !preferSourceDesc ? descParaHtml(esc(ownWhat))
                       : (desc ? descBodyHtml(desc, (row || fb)?.value, descriptionCopy(desc)) : "");
  // Prose stays prose. Every live reading, including a leaf headline's second source, is rendered
  // together after the chart in the divided value list below.
  // The inspector records its signature immediately, so its writes cannot wait for clickHold.
  // setHtml still preserves identical prose while a values poll changes the headline number.
  setHtml("inspBody", what + (sentence ? descParaHtml(esc(sentence)) : "")
    + (S.otaCached ? "" : inspHeldHtml(e, d)), false);
  let rows = !d ? "" : inspValues(e, row, fb)
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
  if (S.insp === "room" && roomReferencePresent())
    rows += `<div class="inspect-row room-row"><span>${esc(roomHistName())}</span>` +
      `<span>${esc(fmt1(roomReferenceValue()))} °C</span></div>`;
  setHtml("inspRows", rows, false);
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
    const name = (e.aria || INSPECT_I18N[LANG]?.[e.i18nKey]?.aria)
      ? inspFieldText(e, "aria", null) : inspTitleText(e, null);
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
