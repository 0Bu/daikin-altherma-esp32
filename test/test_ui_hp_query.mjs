// X10A protocol-diagnosis UI contract: closed explanation tongue, exact-or-labelled-fallback labels, tuple
// selection, editable request generation and bounded one-shot submission.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readAppFragments } from "../tools/ui/read_app_source.mjs";

const source = readAppFragments(["dashboard.js", "settings.js"]);
const labels = {
  "probe.toggle": "Protokolldiagnose", "probe.title": "X10A Diagnose",
  "probe.readonly": "Nur lesen",
  "probe.intro": "Direkte X10A-Abfrage.", "probe.request": "Anfrage",
  "probe.register": "Register", "probe.manual": "Manuelle Eingabe",
  "probe.page": "Registerseite", "probe.offset": "Payload-Offset", "probe.size": "Feldbreite",
  "probe.byte": "Byte", "probe.bytes": "Bytes", "probe.converter": "Converter",
  "probe.page_help": "Hex oder dezimal", "probe.offset_help": "Index", "probe.size_help": "Bytes",
  "probe.converter_auto": "Automatisch prüfen", "probe.converter_specific": "Converter-ID verwenden",
  "probe.converter_mode_help": "Auswahl", "probe.converter_id": "Converter-ID",
  "probe.converter_help": "ID 0…999", "probe.send": "Register lesen", "probe.querying": "Anfrage läuft…",
  "probe.action_note": "Eine Anfrage pro Poll-Zyklus.",
  "probe.catalog_loading": "Laden", "probe.catalog_empty": "Keine Definitionen",
  "probe.catalog_error": "Fehler", "probe.response": "Antwort", "probe.frame": "Frame",
  "probe.catalog_profile": (profile) => `Profil: ${profile}`,
  "probe.catalog_fallback": (definition, profile) => `main/def: ${definition} · Profil: ${profile}`,
  "probe.payload": "Payload", "probe.slice": "Ausgewählte Bytes",
  "probe.interpretation": "Interpretation", "probe.no_decodes": "Kein Ergebnis",
  "probe.response_for": (reg) => `Antwort von Register ${reg}`,
  "probe.payload_marked": "Payload · Auswahl markiert",
  "probe.slice_note": (offset, size, slice) => `Offset ${offset} · ${size} Byte · 0x${slice.replace(/\s+/g, "")}`,
  "probe.full_frame": "Vollständiger Frame", "probe.decode_value": "Converter-Ergebnis",
  "probe.refused": "Wert verworfen", "probe.unimplemented": "Nicht implementiert",
  "probe.aliases": "auch", "probe.invalid": "Ungültig", "probe.failed": "Fehlgeschlagen",
  "probe.status_ok": "Antwort gültig", "probe.status_unexpected_reply": "Unerwartete Antwort",
  "probe.transport_ok": "Frame vollständig und gültig.",
  "probe.transport_unexpected_reply": "Andere Registerseite.",
  "diagnostics.off": "Aus", "diagnostics.on": "Ein", "toast.unreachable": "Nicht erreichbar",
};
const t = (key, ...args) => typeof labels[key] === "function" ? labels[key](...args) : labels[key] || key;
const esc = (value) => String(value ?? "").replace(/[&<>\"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const elements = {};
const element = (value = "") => ({ value, blur() {}, textContent: "" });
let renders = 0;
let nextPost = async () => ({ ok: true, json: async () => ({ ok: true, status: "ok", decodes: [] }) });
let nextGet = async () => ({ profile: "generic", values: [] });
let getUrl = "", getOptions = null;
const S = {
  status: { profile: { id: "generic" } }, descOpen: new Set(),
  hpProbeCatalog: [], hpProbeCatalogProfile: "",
  hpProbeCatalogDefinition: "", hpProbeCatalogFallback: false,
  hpProbeCatalogBusy: false, hpProbeCatalogError: "",
  hpProbeDraft: { selected: "", reg: "0x60", offset: "11", size: "1", mode: "specific", conv: "105" },
  hpProbeBusy: false, hpProbeResult: null, hpProbeError: "",
};
const context = {
  S, LANG: "de", t, esc, console, setTimeout, clearTimeout,
  $: (id) => elements[id] || null,
  recordRender: () => { renders++; },
  j: (...args) => { [getUrl, getOptions] = args; return nextGet(...args); },
  post: (...args) => nextPost(...args),
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
assert.match(html, /protocol-diagnosis-detail/,
  "protocol diagnosis must expose the same explanation tongue as the other Protocol rows");
assert.match(html, /aria-expanded="false"/, "the protocol-diagnosis tongue must start closed");
assert.match(html, /X10A Diagnose/,
  "the complete diagnosis card must live inside the protocol-diagnosis tongue");
assert.doesNotMatch(html, /e32ProtocolDiagnostics|value="off"|value="on"/,
  "opening the tongue replaces the redundant On/Off selector");

S.descOpen.add("protocol:diagnosis");
S.hpProbeCatalog = [
  { reg: 0x00, offset: 12, conv: 105, size: 1, label: "O/U capacity (kW)" },
  { reg: 0x10, offset: 5, conv: 204, size: 1, label: "Error Code" },
  { reg: 0x60, offset: 3, conv: 204, size: 1, label: "Error Code" },
  { reg: 0x61, offset: 2, conv: 105, size: 2, label: '"><script>bad()</script>' },
];
html = sandbox.__card();
assert.match(html, /X10A Diagnose/);
assert.doesNotMatch(html, /POST \/hp\/query|hpProbeRequest/,
  "the editable fields replace a redundant POST/JSON preview block");
assert.match(html, /<span class="probe-field-label">Register<\/span>/,
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
  selected: "0", reg: "0x00", offset: "12", size: "1", mode: "specific", conv: "105",
}, "selecting a known row must fill the exact four ValueDef request fields");
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__request())),
  { reg: 0, offset: 12, size: 1, conv: 105 });

elements.hpProbeRegister.value = "0";
elements.hpProbeOffset = element("13");
elements.hpProbeOffset.id = "hpProbeOffset";
sandbox.__input(elements.hpProbeOffset);
assert.equal(S.hpProbeDraft.selected, "", "editing a tuple must return the dropdown to manual mode");
assert.equal(elements.hpProbeRegister.value, "");
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__request())),
  { reg: 0, offset: 13, size: 1, conv: 105 }, "the edited fields must be the submitted request");

elements.hpProbeMode = element("sweep");
elements.hpProbeMode.id = "hpProbeMode";
sandbox.__input(elements.hpProbeMode);
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.__request())), { reg: 0, offset: 13, size: 1 },
  "automatic converter evaluation must omit conv from the generated request");
assert.doesNotMatch(sandbox.__card(), /id="hpProbeConv"/,
  "the converter ID field must be hidden while automatic evaluation is selected");

// An unresolved live profile must still receive useful generic examples, labelled as fallback
// provenance rather than pretending that generic was detected on this installation.
S.status.profile.id = "auto";
S.hpProbeCatalog = [];
S.hpProbeCatalogBusy = false;
nextGet = async () => ({ profile: "auto", definition: "generic", fallback: true, values: [
  { reg: 0, offset: 12, conv: 105, size: 1, label: "O/U capacity (kW)" },
] });
await sandbox.__load("auto");
assert.match(getUrl, /^\/models\?active=1&ms=\d+$/,
  "the live register catalog must use a cache-busting request URL");
assert.equal(getOptions?.cache, "no-store", "the live register catalog must bypass the browser cache");
assert.equal(S.hpProbeCatalog.length, 1, "auto must expose generic main/def examples");
assert.equal(S.hpProbeCatalogDefinition, "generic");
assert.equal(S.hpProbeCatalogFallback, true);
assert.match(sandbox.__card(), /main\/def: generic · Profil: auto/);

// A catalog response for a profile that changed while the GET was in flight must be discarded.
let resolveCatalog;
nextGet = () => new Promise((resolve) => { resolveCatalog = resolve; });
S.hpProbeCatalog = [
  { reg: 0, offset: 12, conv: 105, size: 1, label: "old profile row" },
];
S.hpProbeCatalogProfile = "generic";
S.hpProbeCatalogDefinition = "generic";
S.hpProbeCatalogFallback = false;
S.hpProbeDraft.selected = "0";
S.hpProbeCatalogBusy = false;
const loading = sandbox.__load("generic");
S.status.profile.id = "new_profile";
resolveCatalog({ profile: "generic", values: [
  { reg: 0, offset: 12, conv: 105, size: 1, label: "stale" },
] });
await loading;
assert.equal(S.hpProbeCatalog.length, 0, "a stale detected-profile catalog must not reach the menu");
assert.equal(S.hpProbeCatalogProfile, "", "a stale catalog must remain eligible for immediate reload");
assert.equal(S.hpProbeDraft.selected, "", "a stale selected row must fail closed to manual input");

// A newly detected profile may reuse an option index for a different tuple. It must not make the
// old manual request look as if the new label owned it.
S.status.profile.id = "new_profile";
S.hpProbeDraft = { selected: "0", reg: "0x00", offset: "12", size: "1", mode: "specific", conv: "105" };
S.hpProbeCatalogBusy = false;
nextGet = async () => ({ profile: "new_profile", definition: "new_profile", fallback: false, values: [
  { reg: 0x61, offset: 2, conv: 105, size: 2, label: "Different profile row" },
] });
await sandbox.__load("new_profile");
assert.equal(S.hpProbeDraft.selected, "",
  "a profile reload must clear an index whose new tuple no longer matches the draft");
assert.equal(S.hpProbeDraft.reg, "0x00", "the editable manual draft must survive a profile reload");

// Submission is one-shot: the in-flight flag refuses a second call and the successful decode is
// retained as state for the response/interpretation block.
S.hpProbeDraft = { selected: "", reg: "0x00", offset: "12", size: "1", mode: "specific", conv: "105" };
let postCalls = 0, postedUrl = "", postedBody = null, resolvePost;
nextPost = (url, body) => {
  postCalls++;
  postedUrl = url;
  postedBody = JSON.parse(JSON.stringify(body));
  return new Promise((resolve) => { resolvePost = resolve; });
};
const first = sandbox.__run();
await sandbox.__run();
assert.equal(postCalls, 1);
assert.equal(postedUrl, "/hp/query");
assert.deepEqual(postedBody, { reg: 0, offset: 12, size: 1, conv: 105 },
  "the values visible in the four fields must be the exact submitted body");
resolvePost({ ok: true, json: async () => ({
  ok: true, status: "ok", reg: "0x00", proto: "I", rx_pin: 44, tx_pin: 43,
  offset: 12, size: 1, frame: "40 00 0F 00 00 00 00 00 00 00 00 00 00 00 00 50 60",
  payload: "00 00 00 00 00 00 00 00 00 00 00 00 50", slice: "50",
  decodes: [{ conv: 105, value: 8.0 }],
}) });
await first;
assert.equal(S.hpProbeResult.decodes[0].value, 8);
assert.equal(S.hpProbeBusy, false);
assert.ok(renders > 0);

html = sandbox.__result();
assert.match(html, /probe-result-status ok[^>]*><span><\/span>Antwort gültig/);
assert.match(html, /Vollständiger Frame<\/div><div class="probe-frame">40 00 0F 00 00 00 00 00 00 00 00 00 00 00 00 50 60<\/div>/);
assert.match(html, /probe-byte selected">50<\/span>/, "the requested payload slice must be marked");
assert.match(html, />Interpretation<\/div>/);
assert.match(html, /conv 105/);
assert.match(html, /probe-decode-value">8<\/span>/);

// Protocol errors are valid diagnostic answers, not transport failures. Their raw bytes and the
// precise status must remain visible even when no interpretation is possible.
S.hpProbeResult = { ok: false, status: "unexpected_reply", frame: "40 61 04 AA BB F5" };
html = sandbox.__result();
assert.match(html, /probe-result-status err[^>]*><span><\/span>Unerwartete Antwort/);
assert.match(html, /probe-frame">40 61 04 AA BB F5<\/div>/);
assert.doesNotMatch(html, />Interpretation<\/div>/);

console.log("X10A protocol-diagnosis UI contract verified");
