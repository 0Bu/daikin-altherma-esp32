// Re-decide the C++ golden vectors with the PRODUCTION browser rules and diff.
//
// The three headers behind those vectors — logic/lwt_select.hpp, logic/cop_scope.hpp,
// logic/ou_stale.hpp — each state in their own comments that they have no firmware caller: they
// exist so CI can gate a rule the BROWSER applies. That has always gated the C++ copy. This gates
// the copy that ships.
//
// It executes the real main/www/js/schematic.js out of the real app.sources manifest, in the same
// DOM-free VM harness the test_ui_*.mjs suite uses, and calls the real functions. There is no second
// implementation of anything here — a checker that re-implemented the rule to compare against would
// be a THIRD copy, and the whole finding is that copies drift.
//
// Usage: node tools/presenter/presenter_parity.mjs <golden.tsv>
import fs from "node:fs";
import vm from "node:vm";
import { readAppFragments } from "../ui/read_app_source.mjs";

const goldenPath = process.argv[2];
if (!goldenPath) {
  console.error("presenter_parity: usage: presenter_parity.mjs <golden.tsv>");
  process.exit(2);
}

// schematic.js is a classic script fragment sharing one lexical scope; `const` never becomes a
// context property, so the rules under test are handed out explicitly — the trick every
// test_ui_*.mjs already uses. Only the presenter rules are exported: this file must not become a
// place where other UI behaviour is quietly re-tested.
const SOURCE = readAppFragments(["descriptions.js", "schematic.js"]);
const context = {
  S: { status: {}, _values: [], _modbus: [] },
  $: () => null,
  esc: (s) => String(s ?? ""),
  displayValue: (v) => String(v?.value ?? "—"),
  displayUnit: (v) => String(v?.unit ?? ""),
  displayReadingLabel: (l) => String(l ?? ""),
  displayHomeHubLabel: (r) => String(r?.label ?? ""),
  t: (k) => k,
  tx: (o) => (o == null ? "" : typeof o === "string" ? o : o.en),
  LANG: "en",
};
vm.createContext(context);
try {
  vm.runInContext(
    SOURCE +
      "\nthis.__api = { lwtIsPreBuh, lwtIsMeasurement, isPostBuhRow, copPlan, OU_HELD_PAGES," +
      " lwtRow, postBuhRow };",
    context, { filename: "main/www/app.sources" });
} catch (e) {
  // A renamed or inlined-away rule lands here as a bare ReferenceError. Say what it means instead of
  // printing a stack: the rule is UNREACHABLE, which is not the same finding as the two copies
  // disagreeing, and it must not be reported as one.
  console.error(`presenter_parity: cannot reach the browser presenter rules — ${e.message}\n` +
                "Each of lwtIsPreBuh / lwtIsMeasurement / isPostBuhRow / copPlan / lwtRow / " +
                "postBuhRow / OU_HELD_PAGES must stay a named binding in main/www/js/schematic.js: " +
                "a rule folded back into its caller is one this gate can no longer compare.");
  process.exit(2);
}
const ui = context.__api;

for (const name of ["lwtIsPreBuh", "lwtIsMeasurement", "isPostBuhRow", "copPlan",
                    "lwtRow", "postBuhRow"]) {
  if (typeof ui[name] !== "function") {
    // Exit 2, not a diff: a rule that has been renamed or inlined away is not "in parity", it is
    // unreachable — and a gate that silently compares nothing is worse than no gate.
    console.error(`presenter_parity: main/www/js/schematic.js no longer exports ${name}()`);
    process.exit(2);
  }
}
if (!Array.isArray(ui.OU_HELD_PAGES)) {
  console.error("presenter_parity: schematic.js no longer defines OU_HELD_PAGES");
  process.exit(2);
}

const lines = fs.readFileSync(goldenPath, "utf8").split("\n");
const fails = [];
const counts = { ROW: 0, PICK: 0, COP: 0 };
const picks = new Map();   // case id -> rows, in the order the dumper emitted them

const bad = (kind, subject, field, want, got) =>
  fails.push(`${kind} ${JSON.stringify(subject)} — ${field}: C++ says ${want}, browser says ${got}`);

// The browser lowercases the raw label itself (production does `(x.label||"").toLowerCase()`), so
// the RAW label is what crosses the boundary and the case fold is compared too. That matters: the
// C++ folds ASCII A-Z only, JavaScript folds by Unicode, and a non-ASCII label would diverge here
// rather than in the field.
const low = (label) => label.toLowerCase();

for (const raw of lines) {
  if (!raw || raw.startsWith("#")) continue;
  const f = raw.split("\t");
  switch (f[0]) {
    case "ROW": {
      const [, label, regStr, pre, meas, post, held] = f;
      const reg = Number(regStr);
      const l = low(label);
      const subject = `${label} @0x${reg.toString(16)}`;
      if (ui.lwtIsPreBuh(l) !== (pre === "1")) bad("ROW", subject, "pre-BUH", pre, ui.lwtIsPreBuh(l) ? 1 : 0);
      if (ui.lwtIsMeasurement(l) !== (meas === "1")) bad("ROW", subject, "measurement", meas, ui.lwtIsMeasurement(l) ? 1 : 0);
      if (ui.isPostBuhRow(l, reg) !== (post === "1")) bad("ROW", subject, "post-BUH", post, ui.isPostBuhRow(l, reg) ? 1 : 0);
      if (ui.OU_HELD_PAGES.includes(reg) !== (held === "1")) bad("ROW", subject, "held-over page", held, ui.OU_HELD_PAGES.includes(reg) ? 1 : 0);
      counts.ROW++;
      break;
    }
    case "PICKROW": {
      const [, id, label, regStr] = f;
      if (!picks.has(id)) picks.set(id, []);
      // A /values row exactly as http_status.cpp serves one. `value` must be non-null or the
      // production selectors filter it out before any rule runs.
      picks.get(id).push({ label, reg: Number(regStr), value: "40.0", unit: "°C" });
      break;
    }
    case "PICKANS": {
      const [, id, lwtIdx, pbIdx] = f;
      const rows = picks.get(id) || [];
      // Drive the REAL selectors through the real state object, so list filtering and ordering are
      // exercised, not just the per-row predicate.
      context.S._values = rows;
      const gotLwt = rows.indexOf(ui.lwtRow());
      const gotPb = rows.indexOf(ui.postBuhRow());
      if (gotLwt !== Number(lwtIdx)) bad("PICK", id, "leaving-water index", lwtIdx, gotLwt);
      if (gotPb !== Number(pbIdx)) bad("PICK", id, "post-BUH index", pbIdx, gotPb);
      context.S._values = [];
      counts.PICK++;
      break;
    }
    case "COP": {
      const [, pel, b1, b2, bsh, pbOk, scope, block, postBuh] = f;
      // The heater states cross the boundary as the RAW tri-states, exactly as the row data supplies
      // them: -1 unknown (no such row on this profile) / 0 off / 1 on. Nothing is collapsed here —
      // the collapse is the rule's most dangerous step and belongs to the two copies being compared,
      // not to the thing comparing them.
      const tri = (v) => (v === "-1" ? null : v === "1");
      const got = ui.copPlan(pel === "null" ? null : pel, tri(b1), tri(b2), tri(bsh), pbOk === "1");
      const subject = `pel=${pel} buh=(${b1},${b2}) bsh=${bsh} postBuhRow=${pbOk}`;
      const gotScope = got.scope === null ? "null" : got.scope;
      const gotBlock = got.block === null ? "null" : got.block;
      if (gotScope !== scope) bad("COP", subject, "scope", scope, gotScope);
      if (gotBlock !== block) bad("COP", subject, "block", block, gotBlock);
      if ((got.postBuh ? "1" : "0") !== postBuh) bad("COP", subject, "use post-BUH numerator", postBuh, got.postBuh ? 1 : 0);
      counts.COP++;
      break;
    }
    default:
      console.error(`presenter_parity: unknown record type ${JSON.stringify(f[0])}`);
      process.exit(2);
  }
}

// A vector file that produced no comparisons passes every assertion above. Refuse it: "no vectors
// found" must never read as "the two copies agree", which is the one thing a parity gate exists to
// establish.
if (counts.ROW === 0 || counts.PICK === 0 || counts.COP === 0) {
  console.error(`presenter_parity: incomplete vector file (rows=${counts.ROW} picks=${counts.PICK} ` +
                `cop=${counts.COP}) — every family must be exercised`);
  process.exit(2);
}

if (fails.length) {
  console.error(`presenter_parity: ${fails.length} disagreement(s) between the C++ rule and the ` +
                `browser copy in main/www/js/schematic.js:\n`);
  for (const f of fails.slice(0, 40)) console.error(`  ${f}`);
  if (fails.length > 40) console.error(`  … and ${fails.length - 40} more`);
  console.error("\nThe two are supposed to be one rule. Fix whichever copy is wrong — and if the " +
                "C++ moved deliberately, the browser has to move in the same commit.");
  process.exit(1);
}

console.log(`presenter parity OK: ${counts.ROW} catalog/adversarial rows, ${counts.PICK} ordering ` +
            `cases, ${counts.COP} COP-scope combinations agree`);
