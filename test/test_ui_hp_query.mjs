// X10A protocol-diagnosis UI contract: default-off disclosure, exact active-profile labels, tuple
// selection, editable request generation and bounded one-shot submission.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js", "settings.js"]);
const labels = {
  "probe.toggle": "Protokolldiagnose", "probe.title": "X10A Diagnose",
  "probe.intro": "Einmalige X10A-Abfrage.", "probe.request": "Anfrage",
  "probe.register": "Register", "probe.manual": "Manuelle Eingabe",
  "probe.page": "Registerseite", "probe.offset": "Payload-Offset", "probe.size": "Feldbreite",
  "probe.byte": "Byte", "probe.bytes": "Bytes", "probe.converter": "Converter",
  "probe.converter_help": "Leer = alle", "probe.send": "Anfragen", "probe.querying": "Anfrage läuft…",
  "probe.catalog_loading": "Laden", "probe.catalog_empty": "Kein Profil",
  "probe.catalog_error": "Fehler", "probe.response": "Antwort", "probe.frame": "Frame",
  "probe.payload": "Payload", "probe.slice": "Ausgewählte Bytes",
  "probe.interpretation": "Interpretation", "probe.no_decodes": "Kein Ergebnis",
  "probe.refused": "Wert verworfen", "probe.unimplemented": "Nicht implementiert",
  "probe.aliases": "auch", "probe.invalid": "Ungültig", "probe.failed": "Fehlgeschlagen",
  "diagnostics.off": "Aus", "diagnostics.on": "Ein", "toast.unreachable": "Nicht erreichbar",
};
const t = (key) => labels[key] || key;
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const elements = {};
const element = (value = "") => ({ value, blur() {}, textContent: "" });
let renders = 0;
let nextPost = async () => ({ ok: true, json: async () => ({ ok: true, status: "ok", decodes: [] }) });
let nextGet = async () => ({ profile: "generic", values: [] });
const S = {
  status: { profile: { id: "generic" } }, descOpen: new Set(),
  protocolDiagnostics: false, hpProbeCatalog: [], hpProbeCatalogProfile: "",
  hpProbeCatalogBusy: false, hpProbeCatalogError: "",
  hpProbeDraft: { selected: "", reg: "0x60", offset: "11", size: "1", conv: "105" },
  hpProbeBusy: false, hpProbeResult: null, hpProbeError: "",
};
const context = {
  S, LANG: "de", t, esc, console, setTimeout, clearTimeout,
  $: (id) => elements[id] || null,
  recordRender: () => { renders++; },
  j: (...args) => nextGet(...args), post: (...args) => nextPost(...args),
  descNoteHtml: () => "", hasHist: () => false, histHtml: () => "",
  checkupDuration: String, MODEL_DESCRIPTIONS: {},
};
const sandbox = vm.createContext(context);
vm.runInContext(`${source}
  renderSettings = recordRender;
  this.__toggle = protocolDiagnosticsRow;
  this.__card = x10aDiagnosisCardHtml;
  this.__result = hpProbeResultHtml;
  this.__request = hpProbeDraftRequest;
  this.__pick = onHpProbeRegisterPick;
  this.__input = onHpProbeDraftInput;
  this.__load = loadHpProbeCatalog;
  this.__run = runHpProbe;`, sandbox, { filename: "main/www/app.sources" });

let html = sandbox.__toggle();
assert.match(html, />Protokolldiagnose</);
assert.match(html, /value="off" selected/, "protocol diagnosis must start off after page load");

S.protocolDiagnostics = true;
S.hpProbeCatalog = [
  { reg: 0x00, offset: 12, conv: 105, size: 1, label: "O/U capacity (kW)" },
  { reg: 0x10, offset: 5, conv: 204, size: 1, label: "Error Code" },
  { reg: 0x60, offset: 3, conv: 204, size: 1, label: "Error Code" },
  { reg: 0x61, offset: 2, conv: 105, size: 2, label: '"><script>bad()</script>' },
];
html = sandbox.__card();
assert.match(html, /X10A Diagnose/);
assert.match(html, /<span class="field-label">Register<\/span>/,
  "the dropdown label must be exactly Register");
assert.match(html, />O\/U capacity \(kW\)<\/option>/,
  "visible option text must be the exact ValueDef label only");
assert.equal((html.match(/>Error Code<\/option>/g) || []).length, 2,
  "duplicate labels must remain separate selectable tuples");
assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
assert.match(html, /&quot;&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;/,
  "profile labels must be escaped before interpolation");

elements.hpProbeRegister = element("0");
sandbox.__pick();
assert.deepEqual(JSON.parse(JSON.stringify(S.hpProbeDraft)), {
  selected: "0", reg: "0x00", offset: "12", size: "1", conv: "105",
}, "selecting a known row must fill the exact four ValueDef request fields");
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__request())),
  { reg: 0, offset: 12, size: 1, conv: 105 });

elements.hpProbeRegister.value = "0";
elements.hpProbeRequest = element();
elements.hpProbeOffset = element("13");
elements.hpProbeOffset.id = "hpProbeOffset";
sandbox.__input(elements.hpProbeOffset);
assert.equal(S.hpProbeDraft.selected, "", "editing a tuple must return the dropdown to manual mode");
assert.equal(elements.hpProbeRegister.value, "");
assert.match(elements.hpProbeRequest.textContent, /"offset":13/);

// A catalog response for a profile that changed while the GET was in flight must be discarded.
let resolveCatalog;
nextGet = () => new Promise((resolve) => { resolveCatalog = resolve; });
S.hpProbeCatalog = [];
S.hpProbeCatalogBusy = false;
const loading = sandbox.__load("generic");
S.status.profile.id = "new_profile";
resolveCatalog({ profile: "generic", values: [
  { reg: 0, offset: 12, conv: 105, size: 1, label: "stale" },
] });
await loading;
assert.equal(S.hpProbeCatalog.length, 0, "a stale detected-profile catalog must not reach the menu");

// A newly detected profile may reuse an option index for a different tuple. It must not make the
// old manual request look as if the new label owned it.
S.status.profile.id = "new_profile";
S.hpProbeDraft = { selected: "0", reg: "0x00", offset: "12", size: "1", conv: "105" };
S.hpProbeCatalogBusy = false;
nextGet = async () => ({ profile: "new_profile", values: [
  { reg: 0x61, offset: 2, conv: 105, size: 2, label: "Different profile row" },
] });
await sandbox.__load("new_profile");
assert.equal(S.hpProbeDraft.selected, "",
  "a profile reload must clear an index whose new tuple no longer matches the draft");
assert.equal(S.hpProbeDraft.reg, "0x00", "the editable manual draft must survive a profile reload");

// Submission is one-shot: the in-flight flag refuses a second call and the successful decode is
// retained as state for the response/interpretation block.
S.hpProbeDraft = { selected: "", reg: "0x60", offset: "11", size: "1", conv: "105" };
let postCalls = 0, resolvePost;
nextPost = () => { postCalls++; return new Promise((resolve) => { resolvePost = resolve; }); };
const first = sandbox.__run();
await sandbox.__run();
assert.equal(postCalls, 1);
resolvePost({ ok: true, json: async () => ({
  ok: true, status: "ok", frame: "40 60", payload: "50", slice: "50",
  decodes: [{ conv: 105, value: 8.0 }],
}) });
await first;
assert.equal(S.hpProbeResult.decodes[0].value, 8);
assert.equal(S.hpProbeBusy, false);
assert.ok(renders > 0);

html = sandbox.__result();
assert.match(html, />Status<\/span><span class="vrow-val ok mono">ok<\/span>/);
assert.match(html, />Frame<\/span><span class="vrow-val mono probe-hex">40 60<\/span>/);
assert.match(html, />Interpretation<\/div>/);
assert.match(html, /conv 105/);
assert.match(html, />8<\/span>/);

// Protocol errors are valid diagnostic answers, not transport failures. Their raw bytes and the
// precise status must remain visible even when no interpretation is possible.
S.hpProbeResult = { ok: false, status: "unexpected_reply", frame: "40 61 04 AA BB F5" };
html = sandbox.__result();
assert.match(html, /vrow-val err mono">unexpected_reply<\/span>/);
assert.match(html, /probe-hex">40 61 04 AA BB F5<\/span>/);
assert.doesNotMatch(html, />Interpretation<\/div>/);

console.log("X10A protocol-diagnosis UI contract verified");
