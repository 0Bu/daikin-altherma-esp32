// Coverage audit for the web UI's value-description table (main/www/app.js `DESCRIPTIONS`).
//
// ── What this gates, and why it is not covered by anything else ──────────────────────────────────
// Every reading the firmware publishes reaches the value list as a row keyed by its catalog LABEL,
// and tapping that row is supposed to slide down a plain-language explainer. Whether a row IS
// tappable is decided at render time by a first-match-wins regex sweep over DESCRIPTIONS — so a
// label nothing matches produces a silently plain row. Nothing fails, nothing logs, and the only
// evidence is the ABSENCE of a chevron on one row among a hundred.
//
// That is how the page-0x10 protection block shipped: `def/overlay.hpp` added 11 rows and 9 of them
// reached the UI with no explainer at all, while the other two matched the "fin temp" HEATSINK-
// TEMPERATURE entry and were confidently explained as a temperature reading — a protection flag and
// a retry counter described as °C. The #35-#39 shape, one layer up: well-formed, plausible, false.
//
// The catalog is machine-generated and grows without touching this repo's JS, so the gap re-opens
// every time the generator emits a label the copy has never seen. This audit closes the loop by
// asserting, mechanically, that the two sides still line up.
//
// ── Why node, when the rest of the toolchain is C++/python/git ───────────────────────────────────
// The rule under test IS JavaScript regex semantics. Re-implementing 70-odd `/…/i` patterns in
// python `re` would gate a TRANSLATION of the shipped rule, not the rule — the "looser second copy"
// failure this codebase calls out by name in logic/lwt_select.hpp and logic/ou_stale.hpp. So the
// real table is evaluated by a real JS engine, and the table literal is EVALUATED rather than
// field-scraped: a scraper that silently stops recognising an entry would under-report and pass.
// node is preinstalled on ubuntu-latest, so this adds a dependency to the local loop, not to CI.
//
// Usage:  node tools/descriptions/check_descriptions.mjs [--app <app.js>] [--def <def-dir>]
//                                                        [--exceptions <file>] [-v]
// Exit:   0 = clean, 1 = findings, 2 = usage / parse / vacuity error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// ── arguments ────────────────────────────────────────────────────────────────────────────────────
let APP = 'main/www/app.js';
let DEF = 'main/def';
let EXC = 'tools/descriptions/audit_exceptions.txt';
let verbose = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--app') APP = process.argv[++i];
  else if (a === '--def') DEF = process.argv[++i];
  else if (a === '--exceptions') EXC = process.argv[++i];
  else if (a === '-v' || a === '--verbose') verbose = true;
  else die(2, `unknown argument: ${a}`);
  if (APP === undefined || DEF === undefined || EXC === undefined) die(2, 'missing value for an option');
}

function die(code, msg) {
  console.error(`check_descriptions: ${msg}`);
  process.exit(code);
}

// ── 1. the DESCRIPTIONS table, evaluated (not scraped) ───────────────────────────────────────────
// The literal is sliced out by exact markers and handed to a real JS engine, so the RegExp objects
// under test are the very ones the browser builds. Both markers must appear EXACTLY once: a second
// occurrence would mean the slice is guesswork, which is how a checker starts quietly testing half
// a table. Same reasoning as main/www/inline_assets.cmake's marker guards.
const OPEN = 'const DESCRIPTIONS = [';
const CLOSE = '\n];';
// The Model card's copy: a second, smaller table keyed by row id instead of by label, because those
// labels are TRANSLATED and are not catalog labels (see MODEL_DESCRIPTIONS in app.js). Coverage
// cannot be audited for it — there is no generated catalog of card rows to compare against — but the
// SHAPE checks apply unchanged, and "someone adds an entry and forgets the German" is the drift that
// actually happens. Optional: a tree without the table is not a failure, it is an older tree.
const MODEL_OPEN = 'const MODEL_DESCRIPTIONS = {';
const MODEL_CLOSE = '\n};';
const DISPLAY_LABEL_OPEN = 'function displayReadingLabel(label) {';
const DISPLAY_LABEL_CLOSE = '\n}';

// Slice a table literal out by exact markers and evaluate it. `braces` is the literal's own
// delimiter pair, so the same routine reads the array and the object table.
function loadTable(src, file, open, close, braces, what, required) {
  const n = src.split(open).length - 1;
  if (n === 0) {
    if (!required) return null;
    die(2, `'${open}' must appear exactly once in ${file}`);
  }
  if (n !== 1) die(2, `'${open}' must appear exactly once in ${file} (found ${n})`);
  const from = src.indexOf(open);
  const to = src.indexOf(close, from);
  if (to === -1) die(2, `no closing '${close.trim()}' for the ${what} table in ${file}`);

  const literal = src.slice(from + open.length - 1, to + 2);   // the opening brace … closing brace
  if (literal[0] !== braces[0]) die(2, `${what}: slice does not start at '${braces[0]}'`);
  let table;
  try { table = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 }); }
  catch (e) { die(2, `${what} literal does not evaluate: ${e.message}`); }
  return table;
}

// Load the actual browser helper rather than duplicating its transformation in the audit. The
// independent catalog checks below define what it must achieve; evaluating the shipped function
// makes a change to that function immediately visible to this gate.
function loadFunction(src, file, open, close, what) {
  const n = src.split(open).length - 1;
  if (n !== 1) die(2, `'${open}' must appear exactly once in ${file} (found ${n})`);
  const from = src.indexOf(open);
  const to = src.indexOf(close, from);
  if (to === -1) die(2, `no closing brace for ${what} in ${file}`);
  const literal = src.slice(from, to + close.length);
  let fn;
  try { fn = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 }); }
  catch (e) { die(2, `${what} does not evaluate: ${e.message}`); }
  if (typeof fn !== 'function') die(2, `${what} did not evaluate to a function`);
  return fn;
}

function loadDescriptions(file) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) { die(2, `cannot read ${file}: ${e.message}`); }

  const table = loadTable(src, file, OPEN, CLOSE, '[]', 'DESCRIPTIONS', true);
  if (!Array.isArray(table)) die(2, 'DESCRIPTIONS did not evaluate to an array');
  if (table.length === 0) die(2, 'DESCRIPTIONS evaluated to an EMPTY array — refusing to pass vacuously');

  const model = loadTable(src, file, MODEL_OPEN, MODEL_CLOSE, '{}', 'MODEL_DESCRIPTIONS', false);
  if (model !== null && (typeof model !== 'object' || Array.isArray(model))) {
    die(2, 'MODEL_DESCRIPTIONS did not evaluate to an object');
  }
  const displayLabel = loadFunction(src, file, DISPLAY_LABEL_OPEN, DISPLAY_LABEL_CLOSE,
                                    'displayReadingLabel');
  return { table, model, displayLabel };
}

// ── 2. the catalog labels the UI will actually be asked to render ────────────────────────────────
// One row is `{reg, offset, conv, size, type, "Label"}` with an optional 7th `true` = no_publish.
// A no_publish row is a detect-only placeholder (logic/value_def.hpp): hp_poll never caches it and
// it never reaches /values, so requiring copy for it would demand an explainer for something the
// user can never tap.
//
// The extraction is cross-checked PER FILE against a count derived independently (lines that open a
// row), because the real hazard is not a wrong label but a SILENT under-read: if the generator
// changes the row format, a scraper that matches nothing reports full coverage of nothing. That
// cross-check is derived from the file itself, so it never needs updating when the catalog grows.
const ROW_RE = /\{\s*0x[0-9A-Fa-f]+\s*,[^}]*?"((?:[^"\\]|\\.)*)"\s*(,\s*true\s*)?\}/g;
const ROW_OPEN_RE = /^\s*\{\s*0x[0-9A-Fa-f]+\s*,/gm;
// The HomeHub (Modbus) map is a SECOND row format in this same directory, and it was invisible here:
// its rows open with a decimal EKRHH offset rather than an 0x page, so ROW_OPEN_RE matched nothing,
// hits === opens held vacuously at 0 === 0, and def/homehub.hpp passed as a file with no readings in
// it. Twenty-five gateway readings therefore shipped to the web UI with no explainer at all while
// this audit — the one guard whose whole subject is "can the user find out what this value IS" —
// stayed green. A scraper that matches nothing reports full coverage of nothing, which is the exact
// failure the note above ROW_RE warns about, arriving through a format it did not know existed.
// The label is the last STRING in the row; an optional trailing `, true` marks a two-state register
// (def/homehub.hpp `bin`) and must not stop the match — when that field was added this regex matched
// 20 of 27 rows and the parsed-vs-opens cross-check below correctly refused to run rather than
// reporting coverage of a catalog it had only partly read.
const HH_ROW_RE = /\{\s*\d+\s*,\s*MbFunc::[^}]*?"((?:[^"\\]|\\.)*)"\s*(?:,\s*\w+\s*)?\}/g;
const HH_OPEN_RE = /^\s*\{\s*\d+\s*,\s*MbFunc::/gm;

function loadLabels(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.hpp')).sort(); }
  catch (e) { die(2, `cannot read ${dir}: ${e.message}`); }
  if (files.length === 0) die(2, `no .hpp files in ${dir} — refusing to pass vacuously`);

  const labels = new Map();      // label -> Set(file)
  let rows = 0, skipped = 0, profiles = 0;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const opens = (txt.match(ROW_OPEN_RE) || []).length;
    const hits = [...txt.matchAll(ROW_RE)];
    if (hits.length !== opens) {
      die(2, `${f}: row extraction is unreliable (${hits.length} parsed vs ${opens} row starts) — ` +
             'the catalog row format changed; fix ROW_RE before trusting this audit');
    }
    // The HomeHub map, same directory and same question, different row shape. Cross-checked the same
    // way — a format change must stop this audit rather than quietly empty it.
    const hhOpens = (txt.match(HH_OPEN_RE) || []).length;
    const hhHits = [...txt.matchAll(HH_ROW_RE)];
    if (hhHits.length !== hhOpens) {
      die(2, `${f}: HomeHub row extraction is unreliable (${hhHits.length} parsed vs ${hhOpens} ` +
             'row starts) — the map row format changed; fix HH_ROW_RE before trusting this audit');
    }
    if (opens > 0 || hhOpens > 0) profiles++;
    for (const m of hits) {
      rows++;
      if (m[2]) { skipped++; continue; }                       // no_publish: never reaches /values
      const lab = m[1].replace(/\\(["\\])/g, '$1');
      if (!labels.has(lab)) labels.set(lab, new Set());
      labels.get(lab).add(f);
    }
    for (const m of hhHits) {
      rows++;
      const lab = m[1].replace(/\\(["\\])/g, '$1');
      if (!labels.has(lab)) labels.set(lab, new Set());
      labels.get(lab).add(f);
    }
  }
  if (rows === 0) die(2, `no catalog rows found under ${dir} — refusing to pass vacuously`);
  return { labels, rows, skipped, profiles, files: files.length };
}

// ── 3. the adjudication ledger ───────────────────────────────────────────────────────────────────
// Same contract as tools/domain/audit_exceptions.txt: one KEY per line
// suppresses that ONE finding, the finding is still printed (under "suppressed"), and an entry that
// no longer matches anything is itself a finding — a suppression that outlives its cause silences
// the guard against the cause coming back. Absent file = no exceptions, which is the normal state.
function loadExceptions(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return new Map(); die(2, `cannot read ${file}: ${e.message}`); }
  const out = new Map();
  for (const [n, raw] of txt.split('\n').entries()) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    // D001 is the defect this gate exists for: a reading the user can see with nothing to read.
    // There is no version of that which is correct-as-it-stands, so it is refused as a ledger entry
    // rather than merely discouraged in the header — a prose rule is only as strong as the next
    // person's hurry, and silencing D001 would restore the exact blind spot def/overlay.hpp hit.
    if (line.startsWith('D001 ')) {
      die(2, `${file}:${n + 1}: D001 cannot be adjudicated — write the missing copy in ` +
             'main/www/app.js DESCRIPTIONS instead');
    }
    out.set(line, n + 1);
  }
  return out;
}

const { table, model, displayLabel } = loadDescriptions(APP);
const cat = loadLabels(DEF);
const exceptions = loadExceptions(EXC);
const usedExceptions = new Set();
const findings = [];
const suppressed = [];
// A finding's KEY is what the ledger quotes, so it must be stable against edits elsewhere in the
// table: keyed on the LABEL / the regex SOURCE, never on the entry index, which shifts every time
// an unrelated entry is inserted above it.
function add(code, key, msg, detail) {
  const at = exceptions.get(`${code} ${key}`);
  if (at !== undefined) { usedExceptions.add(`${code} ${key}`); suppressed.push({ code, key, msg, at }); return; }
  findings.push({ code, key, msg, detail });
}

// ── 4. the checks ────────────────────────────────────────────────────────────────────────────────
// The table is evaluated in its own vm realm, so its RegExp objects are built by THAT realm's
// RegExp constructor and `x instanceof RegExp` is false for every one of them. Written the obvious
// way this audit reports the whole catalog as uncovered — loudly, as it happens, but the tempting
// "fix" (drop the type check) would have made it report a table of non-regexes as fine. The brand
// check below is realm-independent.
const isRegExp = (v) => Object.prototype.toString.call(v) === '[object RegExp]';

// D001 — a published label no entry matches: the row renders plain and un-tappable.
const firstMatch = (label) => table.findIndex((d) => isRegExp(d.re) && d.re.test(label));
for (const [label, files] of [...cat.labels].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (firstMatch(label) === -1) {
    add('D001', label, `no description matches "${label}"`,
        `carried by ${files.size} profile(s): ${[...files].sort().slice(0, 3).join(', ')}` +
        (files.size > 3 ? ', …' : ''));
  }
}

// D006/D007 — catalog type legends belong in the VALUE column, not in the visible row name.
// D006 checks every spelling the generator currently emits, including the valve's On:…_Off:…
// legend. D007 is the safety rail on the other side: a useful qualifier such as
// "(0:max-100:stop)" must remain untouched.
const LABEL_TYPE_SUFFIX = /(?:[\s.]+ON\/OFF|\s*\([^)]*On\s*:[^)]*Off\s*:[^)]*\))\s*$/i;
for (const label of [...cat.labels.keys()].sort((a, b) => a.localeCompare(b))) {
  const shown = displayLabel(label);
  if (typeof shown !== 'string' || !shown.trim()) {
    add('D006', label, `display label for "${label}" is empty or not a string`, String(shown));
  } else if (LABEL_TYPE_SUFFIX.test(shown)) {
    add('D006', label, `display label still contains a value legend: "${shown}"`,
        'remove the trailing ON/OFF or On:…_Off:… annotation at the UI boundary');
  } else if (!LABEL_TYPE_SUFFIX.test(label) && shown !== label) {
    add('D007', label, `display label unexpectedly changes "${label}" to "${shown}"`,
        'only trailing binary value legends may be removed');
  }
}

// D002 — an entry that matches NOTHING in the catalog. The other end of the same drift: when the
// generator renames a label, the new one loses its copy (D001) and the old regex is left behind
// looking like coverage. Dead entries also make the first-match ORDER harder to reason about,
// which is the mechanism that mis-described the fin-temp rows.
for (const [i, d] of table.entries()) {
  if (!isRegExp(d.re)) { add('D003', `#${i}`, `entry #${i} has no RegExp \`re\``, JSON.stringify(d).slice(0, 120)); continue; }
  const matches = [...cat.labels.keys()].some((l) => d.re.test(l));
  if (!matches) add('D002', String(d.re), `entry #${i} ${d.re} matches no catalog label`, String(d.what || '').slice(0, 80) + '…');
}

// D008 — some labels are semantic collisions, not missing copy: a broad earlier regex matches them,
// but explains a DIFFERENT register. Marking their intended entry `exact:true` makes its precedence
// enforceable instead of leaving the first-match rule as a comment the next table edit can violate.
for (const [i, d] of table.entries()) {
  if (d.exact !== true || !isRegExp(d.re)) continue;
  for (const label of [...cat.labels.keys()].filter((l) => d.re.test(l))) {
    const winner = firstMatch(label);
    if (winner !== i) {
      add('D008', label, `"${label}" is captured by entry #${winner} before exact entry #${i}`,
          `move ${d.re} before ${table[winner]?.re || 'the broader match'}`);
    }
  }
}

// D003/D004 — entry shape. The UI renders `de` when the page is German and falls back to the
// English row when it is absent, so a missing translation is not a crash: it is a German page that
// silently prints English for one reading. Assert the shape instead of discovering it in the field.
// Applied to BOTH copy tables — the coverage checks above are catalog-specific, this is not.
function checkShape(d, key, at) {
  if (typeof d.what !== 'string' || !d.what.trim()) add('D003', key, `${at} has no \`what\` text`, '');
  if (d.normal !== undefined && (typeof d.normal !== 'string' || !d.normal.trim())) add('D003', key, `${at} has an empty \`normal\``, '');
  if (d.de === undefined) { add('D004', key, `${at} has no German copy (\`de\`)`, 'a German page would print the English text for this row'); return; }
  if (typeof d.de.what !== 'string' || !d.de.what.trim()) add('D004', key, `${at} has no \`de.what\``, '');
  if (d.normal !== undefined && (typeof d.de.normal !== 'string' || !d.de.normal.trim())) {
    add('D004', key, `${at} has \`normal\` but no \`de.normal\``, 'the German panel would drop the guidance line');
  }
}
for (const [i, d] of table.entries()) {
  checkShape(d, isRegExp(d.re) ? String(d.re) : `#${i}`, `entry #${i} ${d.re}`);
}
for (const [id, d] of Object.entries(model || {})) {
  checkShape(d, `MODEL_DESCRIPTIONS.${id}`, `MODEL_DESCRIPTIONS.${id}`);
}

// D005 — a ledger entry that suppressed nothing this run. The condition it adjudicated is gone, so
// the line is now only hiding a future recurrence of it. Same rule the domain ledger states for a
// KNOWN-DEFECT that outlives its fix; here it is enforced rather than asked for.
for (const [key, line] of exceptions) {
  if (!usedExceptions.has(key)) {
    findings.push({ code: 'D005', key, msg: `${EXC}:${line} suppresses nothing: "${key}"`,
                    detail: 'the finding it adjudicated is gone — delete the line' });
  }
}

// ── 5. report ────────────────────────────────────────────────────────────────────────────────────
const covered = [...cat.labels.keys()].filter((l) => firstMatch(l) !== -1).length;
// The model-card count is named even though nothing is asserted about its size: a reader must be
// able to tell "the second table was checked and is small" from "the second table was never found".
const summary =
  `${cat.labels.size} published labels from ${cat.profiles} catalog file(s) ` +
  `(${cat.rows} rows, ${cat.skipped} no_publish skipped) vs ${table.length} description entries` +
  (model === null ? ' (no MODEL_DESCRIPTIONS table)'
                  : ` + ${Object.keys(model).length} model-card entries`);

if (verbose) {
  console.log(summary);
  for (const [label, files] of [...cat.labels].sort((a, b) => a[0].localeCompare(b[0]))) {
    const i = firstMatch(label);
    console.log(`  ${i === -1 ? 'MISS' : String(i).padStart(4)}  ${label}   (${files.size} profile(s))`);
  }
}

// Suppressed findings are PRINTED, never hidden — an adjudication is a decision on record, and one
// nobody can see is indistinguishable from a check that stopped running.
for (const s of suppressed) console.log(`  [${s.code}] ${s.msg}   (suppressed by ${EXC}:${s.at})`);

if (findings.length === 0) {
  console.log(`value descriptions: clean — ${covered}/${cat.labels.size} labels covered` +
              (suppressed.length ? `, ${suppressed.length} adjudicated` : '') + `; ${summary}`);
  process.exit(0);
}

console.error(`value descriptions: ${findings.length} finding(s) — ${summary}\n`);
for (const f of findings) {
  console.error(`  [${f.code}] ${f.msg}`);
  if (f.detail) console.error(`          ${f.detail}`);
  console.error(`          key: ${f.code} ${f.key}`);
}
console.error(
  '\n  D001 = a reading users can see has no explainer (add an entry to DESCRIPTIONS in main/www/app.js).\n' +
  '  D002 = an entry matches nothing any more (a renamed label left its regex behind).\n' +
  '  D003 = malformed entry.  D004 = missing/partial German copy.  D005 = stale ledger line.\n' +
  '  D006 = visible label still contains its value legend.  D007 = an unrelated label was changed.\n' +
  '  D008 = an exact semantic description is shadowed by an earlier, broader regex.\n' +
  '  Order matters: a new entry must sit BEFORE any more general one it should out-rank (first match wins).\n' +
  `  A finding that is CORRECT as it stands goes in ${EXC} — copy its key: line, with a reason.`);
process.exit(1);
