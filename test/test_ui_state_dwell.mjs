// HOW LONG A SWITCHED ROW HAS READ WHAT IT READS, as the value list states it.
//
// The firmware decides the number and what may be claimed about it (logic/state_dwell.hpp, pinned by
// test_state_dwell() on the host). What THIS pins is the other half — that the browser renders the
// claim the device actually made, and not a stronger one. That distinction is the whole feature: a
// duration is a statement about a stretch of time, and the three ways it can overstate itself all
// look identical on screen.
//
//   • `dwell_min` dropped        -> "OFF for 3 h" for a run the board only found already standing.
//   • an absent dwell rendered   -> "OFF for 0 s" on a silent bus, i.e. a reading invented for a row
//                                   the device explicitly declined to describe.
//   • a dwell under a BLANKED row -> the number the row above just refused, restated one line below
//                                   it and looking like the correction (the ou_stale.hpp inspector
//                                   defect, one panel over).
//
// Runs the REAL renderers out of the assembled UI source in a DOM-free VM harness — the shape
// test_ui_source_matrix.mjs uses, and for its reason: CI has no browser.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments, readUiLocale } from "../tools/ui/read_app_source.mjs";

const SOURCE = readAppFragments(["i18n.js"]) + readUiLocale("de") +
  readAppFragments(["descriptions.js", "history.js", "schematic.js"]);

// A /values row exactly as append_values_array() serves one: a bit flag with its state age. `held`
// and `dwell_*` are emitted only when they apply, so an omitted key is the normal shape here, not a
// gap in the fixture.
const ROW = (extra = {}) => ({
  label: "Powerful DHW Operation. ON/OFF", value: "0", unit: "", reg: 0x62, binary: true, ...extra,
});

// The reader sees TEXT, so the sentence assertions run on text content: a tag between "OFF" and the
// age must not fail a check about the wording. The markup itself is asserted separately, once.
const txt = (html) => String(html).replace(/<[^>]+>/g, "");

function api({ lang = "en", x10a = true, values = [] } = {}) {
  const context = {
    S: {
      status: { hp: { connected: x10a }, modbus: { enabled: false, connected: false, host: "" },
                history: { dt: 300, rows: [], modbus_rows: [], env3_rows: [] } },
      _values: values, _modbus: [], descOpen: new Set(), hist: new Map(), histPin: new Map(),
    },
    navigator: { language: lang === "de" ? "de-DE" : "en-GB" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    Date, Math, JSON, Set, Map, Number, String, Array, Object, isNaN, parseFloat, parseInt,
  };
  vm.createContext(context);
  vm.runInContext(
    SOURCE + "\nthis.__api = { vDescRow, dwellNoteHtml, dwellDuration, displayValue, setLang };",
    context, { filename: "main/www/app.sources" });
  context.__api.setLang(lang);
  return context.__api;
}

// Two independent X10A fault channels previously rendered under the same visible label and shared
// one descOpen key. The sparse group marker removes both collisions while retaining both readings.
{
  const a = api();
  const outdoor = a.vDescRow({ label: "Error type", value: "Normal", unit: "", reg: 0x10,
                               x10a_group: "outdoor_state" });
  const hydronic = a.vDescRow({ label: "Error type", value: "Normal", unit: "", reg: 0x60,
                                x10a_group: "hydronic" });
  assert.match(outdoor, />Outdoor State Error type</,
    "the outdoor fault row has a unique visible name");
  assert.match(hydronic, />Hydronic Error type</,
    "the hydronic fault row has a unique visible name");
  assert.match(outdoor, /data-desc="outdoor_state:Error type"/,
    "the outdoor accordion has a structurally unique key");
  assert.match(hydronic, /data-desc="hydronic:Error type"/,
    "the hydronic accordion has a structurally unique key");
}

// ── The claim the device made is the claim that is printed ──────────────────────────────────────
{
  const a = api();
  // A WITNESSED transition: the board saw the state arrive, so the age is stated plainly.
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 12000 }), "OFF")), /OFF for 3 h 20 min/,
    "a witnessed run states its age");
  assert.doesNotMatch(txt(a.dwellNoteHtml(ROW({ dwell_s: 12000 }), "OFF")), /at least/,
    "a witnessed run must not be weakened into a lower bound");

  // A run the board only found already standing is a WEAKER claim and must read as one. This is the
  // assertion the whole file exists for: both cases carry a true number, and only the wording
  // separates "I watched this happen" from "it was already like this when I started looking".
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 12000, dwell_min: true }), "OFF")),
    /OFF ≥ 3 h 20 min/, "an unwitnessed run must be stated as a lower bound");

  // A BOUND FLOORS. Rounding to nearest is right for a measured span and wrong for a bound: 1710 s
  // rounds to 29 min, and "≥ 29 min" asserts 1740 s — thirty seconds the board never observed.
  // Every value in the upper half of a minute does that, so this is the common case, not an edge.
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 1710, dwell_min: true }), "OFF")), /OFF ≥ 28 min/,
    "a lower bound must floor — rounding it up asserts time nobody watched");
  assert.doesNotMatch(txt(a.dwellNoteHtml(ROW({ dwell_s: 1710, dwell_min: true }), "OFF")), /29 min/);
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 1739, dwell_min: true }), "OFF")), /OFF ≥ 28 min/);
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 1740, dwell_min: true }), "OFF")), /OFF ≥ 29 min/,
    "…but a bound that really has reached the minute prints it");
  // A MEASURED run keeps rounding to nearest — the bound rule must not leak into the exact case,
  // where the closest true statement is the nearest minute.
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 1710 }), "OFF")), /OFF for 29 min/,
    "a witnessed run is a measurement and still rounds to nearest");

  // THE STATE WORD carries the emphasis and nothing else does. It is the sentence's subject; the age
  // and the condition on it are one uninterrupted qualifier, so weighting any of that would invite
  // the eye to take the number and skip what bounds it.
  const emph = a.dwellNoteHtml(ROW({ dwell_s: 4260, dwell_min: true, dwell_blind_s: 5 }), "OFF");
  assert.match(emph, /<span class="vdesc-n">OFF<\/span> ≥ 1 h 11 min · 5 s of it not observed/,
    "only the state word is emphasised, and it reuses the panel's existing lead-in token");
  assert.equal((emph.match(/<span/g) || []).length, 1, "the qualifier carries no markup of its own");

  // The device saying nothing renders as nothing. "0 s" would read as "it just changed" — a live
  // reading manufactured for a row the firmware explicitly declined to describe.
  assert.equal(a.dwellNoteHtml(ROW(), "OFF"), "", "an absent dwell renders nothing at all");
  assert.equal(a.dwellNoteHtml(ROW({ dwell_s: 0 }), ""), "",
    "no state word means no sentence to put it in");
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 0 }), "ON")), /ON for 0 s/,
    "a state that just arrived is 0 s, which is a reading — the absent case is the key being missing");

  // Blind time is the caveat that keeps the number honest: a flag can pulse and return unseen inside
  // a gap. Shown whenever there is ANY — a threshold here silently drops unobserved seconds out of a
  // sentence the rest of the panel presents as exact, and every justification offered for one turned
  // out to be factually wrong about the formatter or about where the seconds come from.
  const gapped = txt(a.dwellNoteHtml(ROW({ dwell_s: 12000, dwell_blind_s: 600 }), "OFF"));
  assert.match(gapped, /10 min of it not observed/, "material blind time must be stated");
  assert.match(txt(a.dwellNoteHtml(ROW({ dwell_s: 12000, dwell_blind_s: 5 }), "OFF")),
    /5 s of it not observed/, "a small gap is still unobserved time and must be stated");
  assert.doesNotMatch(txt(a.dwellNoteHtml(ROW({ dwell_s: 12000 }), "OFF")), /observed/,
    "a run with no blind time carries no caveat");
}

// ── Both languages, and the seconds tier ────────────────────────────────────────────────────────
{
  const de = api({ lang: "de" });
  assert.match(txt(de.dwellNoteHtml(ROW({ dwell_s: 12000 }), "OFF")), /OFF seit 3 h 20 min/);
  assert.match(txt(de.dwellNoteHtml(ROW({ dwell_s: 12000, dwell_min: true }), "OFF")),
    /OFF ≥ 3 h 20 min/, "the weaker claim must survive translation");
  // The relation symbol is language-neutral, so both dictionaries carry the identical form — but it
  // must still be PRESENT in both, or a missing key would fall back to English and read the same by
  // accident, hiding the omission from every check.
  assert.match(txt(de.dwellNoteHtml(ROW({ dwell_s: 1710, dwell_min: true }), "OFF")), /OFF ≥ 28 min/);
  assert.match(txt(de.dwellNoteHtml(ROW({ dwell_s: 12000, dwell_blind_s: 600 }), "OFF")),
    /davon 10 min nicht beobachtet/);
  // Sub-minute resolution exists only here: a flag that switched twenty seconds ago is the case a
  // reader is most likely looking at, and the chart raster's "0 min" makes a live number look dead.
  assert.equal(de.dwellDuration(20), "20 s");
  assert.equal(de.dwellDuration(90), "2 min");
  assert.equal(de.dwellDuration(3600), "1 h");
}

// ── In the row ──────────────────────────────────────────────────────────────────────────────────
{
  const a = api();
  const html = a.vDescRow(ROW({ dwell_s: 12000 }));
  assert.match(html, /class="vitem/, "a row carrying a state age must be an expander");
  assert.match(txt(html), /OFF for 3 h 20 min/, "the age must reach the panel");
  // FIRST in the body: it is the only live fact in the panel — the explainer under it is the same
  // sentence on every device at every hour.
  assert.ok(txt(html).indexOf("OFF for 3 h 20 min") < txt(html).indexOf("Powerful operation starts tank heating"),
    "the live age must precede the timeless explainer");

  // A BLANKED row states no value, so it must state no age either. This is the ou_stale.hpp defect
  // in a new place: a reading the row above just refused, restated one line below it.
  const down = api({ x10a: false });
  const dead = down.vDescRow(ROW({ dwell_s: 12000 }));
  assert.match(txt(dead), /—/, "a silent bus blanks the reading");
  assert.doesNotMatch(txt(dead), /for 3 h 20 min/,
    "a blanked row must not restate an age for the value it just refused");

  // The OTHER way a row can have no value: the bus is up and this ROW alone did not answer, so
  // /values carries it as `"value":null`. The slot keeps counting (blind) and the firmware withholds
  // the age, but the browser must refuse it independently — it blanks rows for reasons of its own,
  // and an age has to be withheld by whichever side decided the reading is not stateable. Ungated
  // this rendered the literal "— for 3 h 20 min".
  const nulled = a.vDescRow(ROW({ value: null, dwell_s: 12000 }));
  assert.doesNotMatch(txt(nulled), /for 3 h 20 min/,
    "a row whose own value is null must not carry an age");
  assert.equal(a.dwellNoteHtml(ROW({ value: null, dwell_s: 12000 }), "—"), "",
    "an em-dash is not a state to say an age about");
}

// ── A row with nothing else to say is still an expander ─────────────────────────────────────────
// The chevron is decided at render time, so a tracked row whose label matches no explainer and whose
// trend the firmware does not buffer would otherwise be a plain row silently dropping its age.
{
  const a = api();
  const orphan = { label: "Zzz Unknown Flag ON/OFF", value: "1", unit: "", reg: 0x62, binary: true,
                   dwell_s: 300 };
  assert.match(a.vDescRow(orphan), /class="vitem/,
    "a state age alone must make a row expandable");
  assert.match(txt(a.vDescRow(orphan)), /ON for 5 min/);
  assert.doesNotMatch(a.vDescRow({ ...orphan, dwell_s: undefined }), /class="vitem/,
    "without an age that same row stays the plain row it was");
}

console.log("state dwell: witnessed vs joined-in-progress, blind time, blanking and both languages pinned");
