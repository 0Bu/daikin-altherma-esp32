// Structural / geometric / editorial audit of the DASHBOARD SCHEMATIC — the inline SVG in
// main/www/index.html, its CSS in main/www/style.css and its bindings in main/www/app.js.
//
// ── What this gates, and why nothing else does ───────────────────────────────────────────────────
// The drawing is the dashboard's whole "what is the plant doing right now" answer (DESIGN.md §5.3),
// and every defect it has ever shipped was INVISIBLE to every other gate in this repo: the firmware
// builds, the host logic tests pass, the domain audit sees a physically correct value, the
// description audit finds copy for it — and the picture still says something false, because a pill
// is drawn 40 px from the pipe it belongs to, sits on the wrong side of a junction, or is struck
// through by a riser. Those are not rendering bugs; they are the #35-#39 failure shape drawn in
// SVG: well-formed, plausible, and attributing a real reading to the wrong thing.
//
// Six real defects from this drawing's history are the corpus (tools/schematic/selftest.sh):
//   (a) a three-blade rotor whose bounding-box centre sat off the hub, so the fan wobbled around a
//       point beside its own axle (the CSS spins about `transform-box: fill-box`, i.e. the BBOX);
//   (b) the leaving-water pill floating ~40 px above the pipe it names;
//   (c) the return-temperature pill on the heating-only section, claiming a branch no sensor there
//       reads (R4T is at the indoor unit's inlet, downstream of the merge — it belongs to NEITHER);
//   (d) the "HEIZUNG" label struck through by the heating riser, rendering as "HEIZUNC";
//   (e) two horizontal runs at unequal spacing where the drawing documents ONE grid;
//   (f) a "1.8 bar" pill with no name sub-label while two other "bar" pills exist — position alone
//       carrying the difference between a sealed heating circuit and a refrigerant circuit.
// Three more came from a person clicking through the finished drawing, all on the ONE structure the
// first six never touched — where a shared run parts into two branches, and which of the three
// answers (the animation, the highlight, the inspector) is allowed to cross that point:
//   (g) a flow overlay reaching across the junction, so a DHW cycle animated heating pipe (E003);
//   (h) a hit target owning pipe on both sides of it, so hovering the return lit one circuit's
//       return and not the other's (E004);
//   (i) a pipe drawn inside no hit target at all — invisible by ABSENCE, which is what made (h)
//       read as a selection that merely stops (S011).
//
// ── Why node, and why the SVG is PARSED ─────────────────────────────────────────────────────────
// The coordinates are read out of the real markup — there is no second copy of the geometry to
// drift (the same reason logic/lwt_select.hpp exists rather than a looser regex twin). The bindings
// (INSPECT, I18N) are EVALUATED in a JS realm rather than field-scraped, like
// tools/descriptions/check_descriptions.mjs: a scraper that silently stops recognising an entry
// would under-report and pass. node is preinstalled on ubuntu-latest, so this adds a dependency to
// the local loop, not to CI.
//
// Where a question cannot be DECIDED mechanically — is this still a true picture of the plant, is a
// new element in the right place, is the German copy right — this stays quiet and the /schematic-review
// skill (the judgement half) answers it. A gate that guesses teaches people to ignore it.
//
// Usage:  node tools/schematic/check_schematic.mjs [--html <index.html>] [--app <app.js>]
//                                                  [--css <style.css>] [--def <def-dir>]
//                                                  [--exceptions <file>] [-v]
// Exit:   0 = clean, 1 = findings, 2 = usage / parse / vacuity error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// ── arguments ────────────────────────────────────────────────────────────────────────────────────
let HTML = 'main/www/index.html';
let APP = 'main/www/app.js';
let CSS = 'main/www/style.css';
let DEF = 'main/def';
let EXC = 'tools/schematic/audit_exceptions.txt';
let verbose = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--html') HTML = process.argv[++i];
  else if (a === '--app') APP = process.argv[++i];
  else if (a === '--css') CSS = process.argv[++i];
  else if (a === '--def') DEF = process.argv[++i];
  else if (a === '--exceptions') EXC = process.argv[++i];
  else if (a === '-v' || a === '--verbose') verbose = true;
  else die(2, `unknown argument: ${a}`);
  if ([HTML, APP, CSS, DEF, EXC].some((v) => v === undefined)) die(2, 'missing value for an option');
}

function die(code, msg) {
  console.error(`check_schematic: ${msg}`);
  process.exit(code);
}
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { die(2, `cannot read ${f}: ${e.message}`); } };

// ── tuning constants — every one of them is a DRAWING CONVENTION, stated once ────────────────────
const PILL_GAP_MAX = 14;    // a pill beside a pipe sits ~12 px off it; 14 leaves the convention 2 px of slack
const ROTOR_HUB_TOL = 1.0;  // px between a rotor's bbox centre and its hub before it visibly orbits
const EDGE_TOL = 0.5;       // px a stroked edge may sit outside the viewBox (antialiasing, not a defect)
const TEXT_EDGE_TOL = 4;    // px, for the ESTIMATED text box — deliberately looser than EDGE_TOL
const TEXT_FIT_SLACK = 2;   // px a width ESTIMATE may exceed the pill before it is called overflow
const PILL_PAD = 4;         // px of breathing room assumed at each end of a pill

// ── 1. the SVG, sliced by exact markers and parsed ───────────────────────────────────────────────
// Both markers must appear exactly once: a second occurrence would make the slice guesswork, which
// is how a checker starts quietly auditing half a drawing (same guard as inline_assets.cmake and
// check_descriptions.mjs). The header/gear icons are also <svg> elements, so the slice is anchored
// on the schematic's own scroll wrapper rather than on "<svg".
const SVG_OPEN = '<div class="schem-scroll">';
const SVG_CLOSE = '</svg>';

const htmlSrc = read(HTML);
{
  const n = htmlSrc.split(SVG_OPEN).length - 1;
  if (n !== 1) die(2, `'${SVG_OPEN}' must appear exactly once in ${HTML} (found ${n})`);
}
const svgFrom = htmlSrc.indexOf('<svg', htmlSrc.indexOf(SVG_OPEN));
const svgTo = htmlSrc.indexOf(SVG_CLOSE, svgFrom);
if (svgFrom === -1 || svgTo === -1) die(2, `no <svg>…</svg> after ${SVG_OPEN} in ${HTML}`);
const svgSrc = htmlSrc.slice(svgFrom, svgTo + SVG_CLOSE.length);

// Line numbers are reported against index.html, so a finding can be opened where it lives.
const NL = [0];
for (let i = 0; i < htmlSrc.length; i++) if (htmlSrc[i] === '\n') NL.push(i + 1);
const lineAt = (off) => { let lo = 0, hi = NL.length - 1; const a = svgFrom + off;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (NL[m] <= a) lo = m; else hi = m - 1; } return lo + 1; };

// A deliberately small XML reader: elements, attributes, comments, text. The schematic is
// hand-written SVG, so this needs no entity/namespace/CDATA machinery — and anything it CANNOT read
// is reported (S009) rather than skipped, because a tag this cannot parse is a tag the audit is
// blind to.
function parseSvg(src) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, off: 0 };
  const stack = [root];
  const stray = [];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt === -1 ? src.length : lt);
    // Character data is only ever PAINTED inside <text>/<tspan> (and read inside <title>). Anywhere
    // else it renders as nothing at all, which is why a comment that lost its "<!--" leaves prose
    // in the markup with no visible symptom — reported as S009 below.
    if (text.trim() && !/^(text|tspan|title)$/.test(top().tag)) stray.push({ text: text.trim(), off: i });
    if (lt === -1) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end === -1) die(2, `unterminated comment at ${HTML}:${lineAt(lt)}`);
      i = end + 3; continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt === -1) die(2, `unterminated tag at ${HTML}:${lineAt(lt)}`);
    const body = src.slice(lt + 1, gt);
    if (body.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      i = gt + 1; continue;
    }
    const m = /^([\w:-]+)/.exec(body);
    if (!m) die(2, `unreadable tag at ${HTML}:${lineAt(lt)}`);
    const el = { tag: m[1], attrs: {}, children: [], parent: top(), off: lt, text: '' };
    const attrRe = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(body)) !== null) el.attrs[a[1]] = a[3] !== undefined ? a[3] : a[4];
    top().children.push(el);
    if (!body.trimEnd().endsWith('/')) stack.push(el);
    i = gt + 1;
    // <text>/<tspan> hold character data; everywhere else character data is not rendered at all,
    // which is why a lost comment opener (see S009) is invisible instead of loud.
    if (el.tag === 'text' || el.tag === 'tspan' || el.tag === 'title') {
      // handled by the generic walk below (children + text collected per node)
    }
  }
  return { root, stray };
}

// Text nodes are collected in a second pass so <tspan> children keep their order relative to the
// literal text around them ("Outdoor <tspan id=svOut>—</tspan> °C").
function collectText(src) {
  // Re-walk, recording for every <text>/<tspan> the RUNS it contains, in document order.
  const runs = new Map();   // element offset -> [{kind:'lit'|'tspan', ...}]
  const stack = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    const lit = src.slice(i, lt);
    if (lit.trim() && stack.length) runs.get(stack[stack.length - 1]).push({ kind: 'lit', text: lit.replace(/\s+/g, ' ') });
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; continue; }
    const gt = src.indexOf('>', lt);
    const body = src.slice(lt + 1, gt);
    if (body.startsWith('/')) { if (/^\/(text|tspan|title)/.test(body)) stack.pop(); i = gt + 1; continue; }
    const tag = /^([\w:-]+)/.exec(body)[1];
    if (tag === 'text' || tag === 'tspan' || tag === 'title') {
      if (stack.length) runs.get(stack[stack.length - 1]).push({ kind: 'child', off: lt });
      runs.set(lt, []);
      if (!body.trimEnd().endsWith('/')) stack.push(lt);
    }
    i = gt + 1;
  }
  return runs;
}

const { root: svgRoot, stray } = parseSvg(svgSrc);
const textRuns = collectText(svgSrc);
const svgEl = svgRoot.children.find((c) => c.tag === 'svg');
if (!svgEl) die(2, `no <svg> element parsed out of ${HTML}`);
const vb = (svgEl.attrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
if (vb.length !== 4 || vb.some(Number.isNaN)) die(2, `the schematic <svg> has no readable viewBox`);
const [VBX, VBY, VBW, VBH] = vb;

// ── 2. the stylesheet: font metrics and which artwork ROTATES ────────────────────────────────────
const cssSrc = read(CSS);
// @keyframes blocks first (nested braces), so the flat rule scan below cannot mistake their inner
// blocks for rules.
const kfRotate = new Set();
{
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(cssSrc)) !== null) {
    let depth = 1, j = re.lastIndex;
    while (j < cssSrc.length && depth > 0) { if (cssSrc[j] === '{') depth++; else if (cssSrc[j] === '}') depth--; j++; }
    if (/rotate\s*\(/.test(cssSrc.slice(re.lastIndex, j))) kfRotate.add(m[1]);
  }
}
const cssFlat = cssSrc.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
const cssRules = [...cssFlat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

// Font size/weight per schematic class, read from the real CSS `font:` shorthand — never a table
// copied in here, which would go stale the first time a label is restyled.
const fontFor = new Map();   // class -> {size, weight}
for (const r of cssRules) {
  const f = /font\s*:\s*([\d.]+)?\s*([\d.]+)px/.exec(r.body);
  if (!f) continue;
  for (const s of r.sel.split(',')) {
    const c = /\.(sc-[\w-]+)\s*$/.exec(s.trim());
    if (c) fontFor.set(c[1], { size: parseFloat(f[2]), weight: f[1] ? parseFloat(f[1]) : 400 });
  }
}
if (fontFor.size === 0) die(2, `no .sc-* font rules found in ${CSS} — refusing to guess text metrics`);

// Stroke width per class, same source.
const strokeFor = new Map();
for (const r of cssRules) {
  const w = /stroke-width\s*:\s*([\d.]+)/.exec(r.body);
  if (!w) continue;
  for (const s of r.sel.split(',')) {
    const c = /\.(sc-[\w-]+)\s*$/.exec(s.trim());
    if (c) strokeFor.set(c[1], parseFloat(w[1]));
  }
}

// Line CAP per class, same source — the half-stroke a `round`/`square` cap adds PAST the declared
// endpoint is a hit area nobody can see in the markup, and G011 exists because that half was left
// out of every trim in the drawing. Read, never assumed: switching sc-hitline to `butt` must make
// the coordinates literal again, and this map is what notices.
const capFor = new Map();
for (const r of cssRules) {
  const c = /stroke-linecap\s*:\s*(round|butt|square)/.exec(r.body);
  if (!c) continue;
  for (const s of r.sel.split(',')) {
    const k = /\.(sc-[\w-]+)\s*$/.exec(s.trim());
    if (k) capFor.set(k[1], c[1]);
  }
}

// Which element ids spin about their own BOUNDING BOX, and are actually animated with a rotation.
// Both halves matter: `transform-box: fill-box; transform-origin: center` is what makes the pivot
// the bbox centre rather than a coordinate, and the animation is what makes a wrong pivot visible.
const fillBoxIds = new Set(), rotatedIds = new Set();
for (const r of cssRules) {
  const fillBox = /transform-box\s*:\s*fill-box/.test(r.body) && /transform-origin\s*:\s*center/.test(r.body);
  const anim = /animation\s*:\s*([\w-]+)/.exec(r.body);
  const spins = anim && kfRotate.has(anim[1]);
  if (!fillBox && !spins) continue;
  for (const s of r.sel.split(',')) {
    const id = /#([\w-]+)\s*$/.exec(s.trim());
    if (!id) continue;
    if (fillBox) fillBoxIds.add(id[1]);
    if (spins) rotatedIds.add(id[1]);
  }
}
const rotorIds = [...fillBoxIds].filter((i) => rotatedIds.has(i)).sort();

// ── 3. app.js: the bindings, EVALUATED ───────────────────────────────────────────────────────────
const appSrc = read(APP);
function evalTable(open, close, brace, what, extraGlobals = {}) {
  const n = appSrc.split(open).length - 1;
  if (n !== 1) die(2, `'${open}' must appear exactly once in ${APP} (found ${n})`);
  const from = appSrc.indexOf(open);
  const to = appSrc.indexOf(close, from);
  if (to === -1) die(2, `no closing '${close.trim()}' for ${what} in ${APP}`);
  const literal = appSrc.slice(from + open.length - 1, to + 2);
  if (literal[0] !== brace) die(2, `${what}: slice does not start at '${brace}'`);
  // The table references a few helpers at EVALUATION time (a row picker used as `pick:`/in `rows`).
  // They are stubbed rather than defaulted-away: an unknown free identifier must fail loudly here,
  // not be silently absorbed and reported as a table that evaluated fine.
  const sandbox = Object.assign(Object.create(null), extraGlobals);
  try { return vm.runInNewContext(`(${literal})`, sandbox, { timeout: 5000 }); }
  catch (e) { die(2, `${what} does not evaluate: ${e.message}`); }
}
const noop = () => null;
const INSPECT = evalTable('const INSPECT = {', '\n};', '{', 'INSPECT', { lwtRow: noop, vRow: noop, pickValue: noop });
const I18N = evalTable('const I18N = {', '\n};', '{', 'I18N');
// The same table the value rows use — an INSPECT `sample` is a key into it (renderInspect →
// descFor), so a sample nothing matches leaves the panel's explainer blank.
const DESCRIPTIONS = evalTable('const DESCRIPTIONS = [', '\n];', '[', 'DESCRIPTIONS');
if (!INSPECT || typeof INSPECT !== 'object' || Object.keys(INSPECT).length === 0) die(2, 'INSPECT evaluated empty — refusing to pass vacuously');
if (!I18N || !I18N.en || !I18N.de) die(2, 'I18N did not evaluate to an {en, de} pair');

// Every "svXxx" string literal in app.js: the ids the app WRITES. Nothing else in this codebase is
// named that way, which is what makes the two directions checkable at all.
const appSvIds = new Set([...appSrc.matchAll(/["'`](sv[A-Z]\w*)["'`]/g)].map((m) => m[1]));

// ── 4. the catalog labels an INSPECT `sample` must resolve to ────────────────────────────────────
// Same extraction and the same self-check as tools/descriptions/check_descriptions.mjs — including
// the per-file count cross-check, because the dangerous failure is not a wrong label but a SILENT
// under-read: a scraper that matches nothing reports every `sample` as unknown, or (worse, after a
// well-meaning "fix") nothing as unknown at all.
const ROW_RE = /\{\s*0x[0-9A-Fa-f]+\s*,[^}]*?"((?:[^"\\]|\\.)*)"\s*(,\s*true\s*)?\}/g;
const ROW_OPEN_RE = /^\s*\{\s*0x[0-9A-Fa-f]+\s*,/gm;
function loadLabels(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.hpp')).sort(); }
  catch (e) { die(2, `cannot read ${dir}: ${e.message}`); }
  if (files.length === 0) die(2, `no .hpp files in ${dir} — refusing to pass vacuously`);
  const labels = new Set();
  let rows = 0;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const opens = (txt.match(ROW_OPEN_RE) || []).length;
    const hits = [...txt.matchAll(ROW_RE)];
    if (hits.length !== opens) {
      die(2, `${f}: row extraction is unreliable (${hits.length} parsed vs ${opens} row starts) — ` +
             'the catalog row format changed; fix ROW_RE before trusting this audit');
    }
    for (const m of hits) { rows++; labels.add(m[1].replace(/\\(["\\])/g, '$1')); }
  }
  if (rows === 0) die(2, `no catalog rows found under ${dir} — refusing to pass vacuously`);
  return { labels, rows, files: files.length };
}
const cat = loadLabels(DEF);

// ── 5. geometry ──────────────────────────────────────────────────────────────────────────────────
const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const xf = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function parseTransform(s) {
  let m = ID;
  if (!s) return m;
  const re = /([\w]+)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s)) !== null) {
    const a = t[2].trim().split(/[\s,]+/).map(Number);
    let n = ID;
    if (t[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (t[1] === 'scale') n = [a[0] || 1, 0, 0, a.length > 1 ? a[1] : (a[0] || 1), 0, 0];
    else if (t[1] === 'matrix') n = a.slice(0, 6);
    else if (t[1] === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s2 = Math.sin(r);
      n = [c, s2, -s2, c, 0, 0];
      if (a.length >= 3) n = mul([1, 0, 0, 1, a[1], a[2]], mul(n, [1, 0, 0, 1, -a[1], -a[2]]));
    } else die(2, `unsupported transform "${t[1]}(…)" — teach parseTransform about it before trusting the geometry`);
    m = mul(m, n);
  }
  return m;
}

// Path data → primitives. Only what this drawing uses, and anything else fails loudly: a command
// this cannot read would silently contribute NO geometry, and an audit blind to a shape passes it.
function parsePath(d, where) {
  const tok = String(d).match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '', prev = null;
  const num = () => { const v = parseFloat(tok[i++]); if (Number.isNaN(v)) die(2, `bad number in path at ${where}`); return v; };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const bx = rel ? cx : 0, by = rel ? cy : 0;
    if (C === 'M') { const x = num() + bx, y = num() + by; cx = x; cy = y; sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { const x = num() + bx, y = num() + by; out.push({ t: 'L', p: [[cx, cy], [x, y]] }); cx = x; cy = y; }
    else if (C === 'H') { const x = num() + bx; out.push({ t: 'L', p: [[cx, cy], [x, cy]] }); cx = x; }
    else if (C === 'V') { const y = num() + by; out.push({ t: 'L', p: [[cx, cy], [cx, y]] }); cy = y; }
    else if (C === 'C') { const p1 = [num() + bx, num() + by], p2 = [num() + bx, num() + by], p3 = [num() + bx, num() + by];
      out.push({ t: 'C', p: [[cx, cy], p1, p2, p3] }); prev = { c: p2, k: 'C' }; cx = p3[0]; cy = p3[1]; }
    else if (C === 'S') { const p2 = [num() + bx, num() + by], p3 = [num() + bx, num() + by];
      const p1 = prev && prev.k === 'C' ? [2 * cx - prev.c[0], 2 * cy - prev.c[1]] : [cx, cy];
      out.push({ t: 'C', p: [[cx, cy], p1, p2, p3] }); prev = { c: p2, k: 'C' }; cx = p3[0]; cy = p3[1]; }
    else if (C === 'Q') { const p1 = [num() + bx, num() + by], p2 = [num() + bx, num() + by];
      out.push({ t: 'Q', p: [[cx, cy], p1, p2] }); prev = { c: p1, k: 'Q' }; cx = p2[0]; cy = p2[1]; }
    else if (C === 'T') { const p2 = [num() + bx, num() + by];
      const p1 = prev && prev.k === 'Q' ? [2 * cx - prev.c[0], 2 * cy - prev.c[1]] : [cx, cy];
      out.push({ t: 'Q', p: [[cx, cy], p1, p2] }); prev = { c: p1, k: 'Q' }; cx = p2[0]; cy = p2[1]; }
    else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(), x = num() + bx, y = num() + by;
      out.push({ t: 'P', p: arcPoints([cx, cy], rx, ry, rot, laf, sf, [x, y]) }); cx = x; cy = y;
    }
    else if (C === 'Z') { out.push({ t: 'L', p: [[cx, cy], [sx, sy]] }); cx = sx; cy = sy; }
    else die(2, `unsupported path command "${cmd}" at ${where}`);
    if (C !== 'C' && C !== 'S' && C !== 'Q' && C !== 'T') prev = null;
  }
  return out;
}

// An elliptical arc, SAMPLED into a polyline (endpoint → centre parameterisation, then 64 steps).
// Sampling rather than solving: the error at these radii is under 0.05 px, the transform then
// applies to plain points like every other primitive, and an arc's contribution to a bounding box
// is the only thing this audit asks of it. The fan blades are the reason it exists at all.
function arcPoints(p0, rx, ry, rotDeg, laf, sf, p1) {
  const pts = [p0];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [p0, p1];
  const phi = (rotDeg * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy;
  let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = laf === sf ? -1 : 1;
  const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num2) / den);
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cosP * cx1 - sinP * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(uy, ux), b = Math.atan2(vy, vx);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const th0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dth = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sf && dth > 0) dth -= 2 * Math.PI;
  if (sf && dth < 0) dth += 2 * Math.PI;
  for (let k = 1; k <= 64; k++) {
    const th = th0 + (dth * k) / 64;
    const ex = rx * Math.cos(th), ey = ry * Math.sin(th);
    pts.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
  }
  return pts;
}

const EMPTY = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
const grow = (b, x, y) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) });
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const valid = (b) => b.x0 <= b.x1 && b.y0 <= b.y1;
const centre = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const inflate = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const overlaps = (a, b, tol = 0) =>
  a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;
const contains = (outer, inner, tol = 0.5) =>
  inner.x0 >= outer.x0 - tol && inner.x1 <= outer.x1 + tol && inner.y0 >= outer.y0 - tol && inner.y1 <= outer.y1 + tol;

// Exact bezier bounds: the control points alone over-estimate, and an over-estimated bbox is a
// false alarm on the viewBox and (worse) a rotor bbox centre that is not where the browser puts it.
function bezierBounds(pts) {
  let b = EMPTY;
  for (const p of [pts[0], pts[pts.length - 1]]) b = grow(b, p[0], p[1]);
  for (const axis of [0, 1]) {
    const v = pts.map((p) => p[axis]);
    const ts = [];
    if (v.length === 4) {
      const a = -v[0] + 3 * v[1] - 3 * v[2] + v[3], bq = 2 * (v[0] - 2 * v[1] + v[2]), c = v[1] - v[0];
      if (Math.abs(a) < 1e-12) { if (Math.abs(bq) > 1e-12) ts.push(-c / bq); }
      else { const disc = bq * bq - 4 * a * c; if (disc >= 0) { const s = Math.sqrt(disc); ts.push((-bq + s) / (2 * a), (-bq - s) / (2 * a)); } }
    } else {
      const den = v[0] - 2 * v[1] + v[2];
      if (Math.abs(den) > 1e-12) ts.push((v[0] - v[1]) / den);
    }
    for (const t of ts) {
      if (!(t > 0 && t < 1)) continue;
      const at = (arr) => {
        if (arr.length === 4) { const u = 1 - t; return u * u * u * arr[0] + 3 * u * u * t * arr[1] + 3 * u * t * t * arr[2] + t * t * t * arr[3]; }
        const u = 1 - t; return u * u * arr[0] + 2 * u * t * arr[1] + t * t * arr[2];
      };
      const x = at(pts.map((p) => p[0])), y = at(pts.map((p) => p[1]));
      b = grow(b, x, y);
    }
  }
  return b;
}

// ── text metrics ─────────────────────────────────────────────────────────────────────────────────
// Advance widths per 1000 units, Helvetica-class — a stand-in for the `system-ui, -apple-system,
// "Segoe UI", Roboto` stack, whose members sit within a few percent of each other at these sizes.
// The estimate is stated with every overflow finding precisely because it IS an estimate: a false
// pass here costs a slightly tight label, a false alarm costs the gate its credibility.
const W = { ' ': 278, '.': 278, ',': 278, ':': 278, ';': 278, '·': 333, '-': 333, '–': 556, '—': 1000, '/': 278, '%': 889,
  '°': 400, '≈': 549, 'Δ': 612, '❄': 800, '→': 1000, '(': 333, ')': 333, "'": 191, '"': 355, '+': 584, '±': 584 };
for (const c of '0123456789') W[c] = 556;
for (const [chars, w] of [['ijl', 222], ['ft', 278], ['r', 333], ['cksvxyzJ', 500], ['abdeghnopqu', 556], ['I', 278],
  ['EFLTZ', 650], ['BCDHKNPRSUVXY', 700], ['AGOQ', 750], ['MW', 900], ['m', 833], ['w', 722], ['ß', 556]]) {
  for (const c of chars) W[c] = w;
}
const charW = (c) => W[c] ?? (c === c.toUpperCase() && c !== c.toLowerCase() ? 700 : 556);
const weightFactor = (w) => (w >= 700 ? 1.06 : w >= 600 ? 1.03 : 1.0);
const textWidth = (s, size, weight) =>
  ([...s].reduce((a, c) => a + charW(c), 0) / 1000) * size * weightFactor(weight);

// A live value renders as a number, never as the "—" placeholder sitting in the markup. Estimating
// with the placeholder would call every pill roomy; this substitutes a wide-but-ordinary reading
// (sign, three digits, one decimal) so the fit check sees what the user does.
const LIVE_SAMPLE = '-88.8';

// ── walk the tree, resolving transforms, classes and text ────────────────────────────────────────
const nodes = [];         // every drawable, with its absolute bbox
const allEls = [];        // every element, drawable or not (a <g> carries the hit target)
const byId = new Map();
const defsIds = new Set();
function classesOf(el) { return (el.attrs.class || '').split(/\s+/).filter(Boolean); }
function styleSize(el) {
  const m = /font-size\s*:\s*([\d.]+)/.exec(el.attrs.style || '');
  return m ? parseFloat(m[1]) : null;
}
function fontOf(el) {
  let size = styleSize(el), weight = 400;
  for (const c of classesOf(el)) { const f = fontFor.get(c); if (f) { if (size == null) size = f.size; weight = f.weight; } }
  if (size == null) {                                   // inherit from the nearest styled ancestor
    for (let p = el.parent; p; p = p.parent) {
      const s = styleSize(p);
      if (s != null) { size = s; break; }
      for (const c of classesOf(p)) { const f = fontFor.get(c); if (f) { size = f.size; weight = f.weight; break; } }
      if (size != null) break;
    }
  }
  return { size: size ?? 11, weight };
}
// The rendered string of a <text>, in both languages: a data-i18n node takes its text from the
// dictionary, and German is routinely the longer one — measuring only the markup would clear a
// label that overflows on exactly the half of the userbase §1.5 renders German for.
function textVariants(el) {
  const runs = textRuns.get(el.off) || [];
  const langs = ['en', 'de'];
  const out = {};
  for (const L of langs) {
    let s = '';
    const walk = (node) => {
      const key = node.attrs['data-i18n'];
      if (key) {
        const v = I18N[L] && I18N[L][key] != null ? I18N[L][key] : I18N.en[key];
        s += typeof v === 'string' ? v : '';
        return;
      }
      for (const r of textRuns.get(node.off) || []) {
        if (r.kind === 'lit') s += r.text;
        else {
          const child = node.children.find((c) => c.off === r.off);
          if (!child) continue;
          if (child.tag === 'title') continue;         // accessible name, never painted
          if (child.attrs.id && /^sv/.test(child.attrs.id)) { s += LIVE_SAMPLE; continue; }
          walk(child);
        }
      }
    };
    walk(el);
    out[L] = s.replace(/\s+/g, ' ').trim();
  }
  return out;
}

function walk(el, ctm) {
  const m = mul(ctm, parseTransform(el.attrs.transform));
  const cls = classesOf(el);
  const rec = { el, ctm: m, cls, id: el.attrs.id, tag: el.tag, line: lineAt(el.off) };
  if (el.attrs.id) byId.set(el.attrs.id, rec);
  const num = (k, d = 0) => (el.attrs[k] !== undefined ? parseFloat(el.attrs[k]) : d);
  if (el.tag === 'rect') {
    let b = EMPTY;
    for (const [x, y] of [[num('x'), num('y')], [num('x') + num('width'), num('y')],
      [num('x'), num('y') + num('height')], [num('x') + num('width'), num('y') + num('height')]]) {
      const p = xf(m, x, y); b = grow(b, p[0], p[1]);
    }
    rec.kind = 'rect'; rec.bbox = b; rec.rect = { x: num('x'), y: num('y'), w: num('width'), h: num('height') };
  } else if (el.tag === 'circle') {
    const c = xf(m, num('cx'), num('cy'));
    const r = num('r') * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    rec.kind = 'circle'; rec.centre = c; rec.r = r;
    rec.bbox = { x0: c[0] - r, y0: c[1] - r, x1: c[0] + r, y1: c[1] + r };
  } else if (el.tag === 'path') {
    const prims = parsePath(el.attrs.d, `${HTML}:${rec.line}`).map((p) => ({ t: p.t, p: p.p.map(([x, y]) => xf(m, x, y)) }));
    let b = EMPTY;
    const segs = [];
    for (const p of prims) {
      if (p.t === 'L') { b = grow(grow(b, p.p[0][0], p.p[0][1]), p.p[1][0], p.p[1][1]); segs.push({ a: p.p[0], b: p.p[1] }); }
      else if (p.t === 'P') b = p.p.reduce((acc, q) => grow(acc, q[0], q[1]), b);
      else b = union(b, bezierBounds(p.p));
    }
    rec.kind = 'path'; rec.bbox = b; rec.prims = prims; rec.segs = segs; rec.d = el.attrs.d;
  } else if (el.tag === 'use') {
    rec.kind = 'use'; rec.href = (el.attrs.href || el.attrs['xlink:href'] || '').replace(/^#/, '');
  } else if (el.tag === 'text') {
    const f = fontOf(el);
    const v = textVariants(el);
    const anchor = el.attrs['text-anchor'] || 'start';
    const x = num('x'), y = num('y');
    const p = xf(m, x, y);
    const wEn = textWidth(v.en, f.size, f.weight), wDe = textWidth(v.de, f.size, f.weight);
    const w = Math.max(wEn, wDe);
    const x0 = anchor === 'middle' ? p[0] - w / 2 : anchor === 'end' ? p[0] - w : p[0];
    rec.kind = 'text'; rec.font = f; rec.text = v; rec.width = w;
    rec.bbox = { x0, x1: x0 + w, y0: p[1] - f.size * 0.8, y1: p[1] + f.size * 0.22 };
  } else if (el.tag === 'defs' || el.tag === 'symbol') {
    for (const c of el.children) defsIds.add(c.attrs.id);
  }
  allEls.push(rec);
  if (rec.kind) nodes.push(rec);
  for (const c of el.children) walk(c, m);
  return rec;
}
walk(svgEl, ID);

// <use> resolves after the walk, since the referenced blade may be declared later in the tree.
for (const u of nodes.filter((n) => n.kind === 'use')) {
  const target = byId.get(u.href);
  if (!target || !target.bbox) continue;
  // Re-place the referenced geometry under THIS use's ctm — the whole point of the four-blade rotor
  // is that the blade is drawn once and rotated, so the bbox must follow the rotation, not the
  // referenced element's own placement.
  const local = mul(u.ctm, invertPlacement(target));
  u.bbox = transformBox(target, local);
  u.refBbox = target.bbox;
}
// The referenced element is authored about a local origin (the whole reason it can be re-used), so
// its own ctm is what has to come back out before the use's is applied.
function invertPlacement(target) {
  const m = target.ctm, det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
function transformBox(target, m) {
  if (target.kind === 'path') {
    let b = EMPTY;
    for (const p of target.prims) {
      const pts = p.p.map(([x, y]) => xf(m, x, y));
      b = p.t === 'L' || p.t === 'P' ? pts.reduce((acc, q) => grow(acc, q[0], q[1]), b) : union(b, bezierBounds(pts));
    }
    return b;
  }
  let b = EMPTY;
  for (const [x, y] of [[target.bbox.x0, target.bbox.y0], [target.bbox.x1, target.bbox.y0],
    [target.bbox.x0, target.bbox.y1], [target.bbox.x1, target.bbox.y1]]) {
    const p = xf(m, x, y); b = grow(b, p[0], p[1]);
  }
  return b;
}

// ── the drawing's vocabulary, resolved out of the parsed tree ────────────────────────────────────
const has = (n, c) => n.cls.includes(c);
const pills = nodes.filter((n) => n.kind === 'rect' && has(n, 'sc-pill'));
const boxes = nodes.filter((n) => n.kind === 'rect' && (has(n, 'sc-box') || has(n, 'sc-plate') || has(n, 'sc-buh')));
// The round fittings — the 3-way valve, the pump body (also .sc-valve) and the compressor. Filled,
// so they answer pointer events over their whole disc; G011 is what keeps that true.
const discs = nodes.filter((n) => n.kind === 'circle' && (has(n, 'sc-valve') || has(n, 'sc-comp')));
const pipePaths = nodes.filter((n) => n.kind === 'path' && (has(n, 'sc-pipe') || has(n, 'sc-rpipe')));
const hitLines = nodes.filter((n) => n.kind === 'path' && has(n, 'sc-hitline'));
const flowPaths = nodes.filter((n) => n.kind === 'path' && (has(n, 'sc-flow') || has(n, 'sc-rflow')));
const texts = nodes.filter((n) => n.kind === 'text');
const hitTargets = allEls.filter((n) => n.el.attrs['data-insp'] !== undefined);
if (pills.length === 0 || pipePaths.length === 0 || hitTargets.length === 0) {
  die(2, `parsed ${pills.length} pills / ${pipePaths.length} pipes / ${hitTargets.length} hit targets — ` +
         'the schematic vocabulary changed; fix the class names before trusting this audit');
}

// Pipe SEGMENTS, absolute and flattened — what "beside a pipe", "axis-aligned" and "the junction"
// are all decided against.
const pipeSegs = [];
for (const p of pipePaths) for (const s of p.segs) pipeSegs.push({ ...s, node: p, sw: strokeWidth(p) });
function strokeWidth(n) {
  for (const c of n.cls) if (strokeFor.has(c)) return strokeFor.get(c);
  return parseFloat(n.el.attrs['stroke-width'] || '1');
}
function lineCap(n) {
  for (const c of n.cls) if (capFor.has(c)) return capFor.get(c);
  return n.el.attrs['stroke-linecap'] || 'butt';                   // the SVG default
}
const isH = (s) => Math.abs(s.a[1] - s.b[1]) < 0.01;
const isV = (s) => Math.abs(s.a[0] - s.b[0]) < 0.01;
const spanX = (s) => [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
const spanY = (s) => [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];

// ── 6. findings ──────────────────────────────────────────────────────────────────────────────────
function loadExceptions(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return new Map(); die(2, `cannot read ${file}: ${e.message}`); }
  const out = new Map();
  for (const [n, raw] of txt.split('\n').entries()) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    // The two findings with no legitimate adjudication, refused as ledger entries rather than
    // merely discouraged in the header — the same rule the description ledger applies to D001,
    // and for the same reason: a prose rule is only as strong as the next person's hurry.
    //   S001 — a hit target that opens nothing: the drawing's whole premise is that it is
    //          explorable (DESIGN.md §5.3 item 2), and a dead target fails silently.
    //   E002 — a reading drawn on a branch its sensor does not read: the wrong-attribution error
    //          the pills exist to prevent, and the #35-#39 shape drawn in SVG.
    for (const code of ['S001', 'E002']) {
      if (line.startsWith(code + ' ')) {
        die(2, `${file}:${n + 1}: ${code} cannot be adjudicated — fix the drawing ` +
               (code === 'S001' ? '(add the INSPECT entry, or drop the hit target)'
                                : '(move the pill onto the section its sensor actually reads)'));
      }
    }
    out.set(line, n + 1);
  }
  return out;
}
const exceptions = loadExceptions(EXC);
const usedExceptions = new Set();
const findings = [];
const suppressed = [];
// A finding KEY is what the ledger quotes, so it is keyed on a STABLE name — the hit-target key, the
// element id, the label — never on an index that shifts when something unrelated is inserted above.
function add(code, key, msg, detail) {
  const at = exceptions.get(`${code} ${key}`);
  if (at !== undefined) { usedExceptions.add(`${code} ${key}`); suppressed.push({ code, key, msg, at }); return; }
  findings.push({ code, key, msg, detail });
}
const at = (n) => `${HTML}:${n.line}`;
const fx = (v) => (Math.round(v * 10) / 10).toString();

// ── LAYER 1 — structural ─────────────────────────────────────────────────────────────────────────
// S001/S002: the drawing and its explainer table must cover each other exactly. A target with no
// entry opens an empty panel; an entry with no target is copy nobody can reach.
const inspKeys = new Set(hitTargets.map((n) => n.el.attrs['data-insp']));
for (const n of hitTargets) {
  const k = n.el.attrs['data-insp'];
  if (!INSPECT[k]) add('S001', k, `hit target data-insp="${k}" has no INSPECT entry (${at(n)})`,
    'tapping it opens an empty inspector — add the entry in app.js or drop the target');
}
for (const k of Object.keys(INSPECT)) {
  if (!inspKeys.has(k)) add('S002', k, `INSPECT.${k} has no hit target in the SVG`,
    'the copy is unreachable — either the target was removed or its data-insp was renamed');
}
// S003/S010: a `sample` is the CANONICAL register label an entry resolves its explainer through —
// deliberately not the LIVE label, since a profile's own spelling could match a neighbouring
// DESCRIPTIONS entry (app.js says so at the table head). Two different things can go wrong with it,
// and they fail in different places, so they are separate findings:
//   S003 — it names no register any profile carries. The inspector's SOURCE line falls back to this
//          string when the row is absent, so it would print a register name that does not exist.
//          Matched on ALPHANUMERICS ONLY: the catalog spells the same register "Inlet water
//          temp.(R4T)" where the concept is written "Inlet Water Temp. (R4T)", and a gate that
//          called punctuation a defect would be edited away rather than obeyed.
//   S010 — it matches no DESCRIPTIONS entry, so the explainer is SILENTLY EMPTY (the D001 shape one
//          layer over). Only for entries with no `what` of their own — a component entry carries
//          its own copy and never consults the table.
const normLabel = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const catNorm = [...cat.labels].map(normLabel);
for (const [k, e] of Object.entries(INSPECT)) {
  if (e.sample === undefined) continue;
  if (typeof e.sample !== 'string' || !e.sample.trim()) { add('S003', k, `INSPECT.${k}.sample is not a label string`, ''); continue; }
  const n = normLabel(e.sample);
  if (!catNorm.some((c) => c === n || c.startsWith(n))) {
    add('S003', k, `INSPECT.${k}.sample "${e.sample}" names no register in the catalog`,
      'the inspector prints it as the source label when the live row is absent — check main/def/');
  }
  if (!e.what && !DESCRIPTIONS.some((d) => Object.prototype.toString.call(d.re) === '[object RegExp]' && d.re.test(e.sample))) {
    add('S010', k, `INSPECT.${k}.sample "${e.sample}" matches no DESCRIPTIONS entry`,
      'the inspector opens with an EMPTY explainer — no error, no log, just a blank panel');
  }
}
// S004/S005: the ids the SVG declares and the ids app.js writes are one contract, and a mismatch is
// SILENT in both directions (setTxt on a missing id is a no-op; an unwritten id keeps its "—").
for (const [id, n] of byId) {
  if (!/^sv/.test(id)) continue;
  if (!appSvIds.has(id)) add('S004', id, `SVG id="${id}" is never written by app.js (${at(n)})`,
    'it will keep its placeholder forever — no error, no log');
}
for (const id of [...appSvIds].sort()) {
  if (!byId.has(id)) add('S005', id, `app.js writes "${id}" but the SVG has no such id`,
    'setTxt() on a missing element is a silent no-op — the reading never appears');
}
// S006: static markup is localised from I18N at boot; a key missing from a dict prints the KEY.
for (const n of allEls) {
  const key = n.el.attrs['data-i18n'];
  if (key === undefined) continue;
  for (const L of ['en', 'de']) {
    if (I18N[L][key] === undefined) add('S006', `${key}/${L}`, `data-i18n="${key}" has no ${L} entry (${at(n)})`,
      L === 'de' ? 'a German page prints the English string (or the raw key)' : 'the raw key would be printed');
  }
}
// S007/S008: ids are unique document-wide (a duplicate makes getElementById a coin flip) and every
// <use> resolves (a dangling href draws nothing — an invisible blade, not an error).
{
  const seen = new Map();
  for (const m of htmlSrc.matchAll(/\sid="([^"]+)"/g)) {
    const id = m[1];
    if (seen.has(id)) add('S007', id, `duplicate id="${id}" (${HTML}:${lineAt(seen.get(id) - svgFrom)} and ${HTML}:${lineAt(m.index - svgFrom)})`,
      'getElementById returns the first — the second element is unreachable');
    else seen.set(id, m.index);
  }
}
for (const u of nodes.filter((n) => n.kind === 'use')) {
  if (!byId.has(u.href) && !defsIds.has(u.href)) {
    add('S008', u.href, `<use href="#${u.href}"> has no target (${at(u)})`, 'it draws nothing at all');
  }
}
// S011: a drawn pipe that belongs to no hit target. Half of the drawing's premise is that every
// part of it can be tapped (DESIGN.md §5.3 item 2) — but unlike S001 (a target that opens nothing)
// this one fails by ABSENCE, so there is nothing to notice: the pipe is painted, the neighbouring
// pipe next to it highlights on hover, and only that one stretch stays dead. It shipped exactly
// that way — the tank's return leg was drawn OUTSIDE the wtank group while its hitline sat inside,
// so the pipe existed for the eye and not for the pointer, and the reachable half of the same run
// made the gap read as "the selection stops here" rather than "this pipe is missing".
for (const p of [...pipePaths, ...hitLines]) {
  let owned = false;
  for (let a = p.el; a; a = a.parent) if (a.attrs && a.attrs['data-insp']) { owned = true; break; }
  if (owned) continue;
  add('S011', p.id || `${p.cls.join('.')}@${p.line}`,
    `${p.cls.includes('sc-hitline') ? 'hit line' : 'pipe'} d="${(p.d || '').replace(/\s+/g, ' ').trim()}" is inside no hit target (${at(p)})`,
    'it cannot be hovered, tapped or selected — a stretch of pipe with no inspector, which reads as ' +
    'the neighbouring selection simply stopping. Put it in the sc-hit group that owns that section');
}
// S009: character data sitting directly in the SVG. It renders as NOTHING (only <text> paints), so
// a comment that lost its opening "<!--" leaves prose in the markup with no visible symptom.
for (const s of stray) {
  add('S009', s.text.slice(0, 24), `stray character data in the SVG at ${HTML}:${lineAt(s.off)}: "${s.text.slice(0, 60)}…"`,
    'nothing renders it — most likely a comment whose "<!--" was lost');
}

// ── LAYER 2 — geometry ───────────────────────────────────────────────────────────────────────────
// G001: anything outside the viewBox is simply not on screen (the SVG scales to fit the card).
const VB = { x0: VBX, y0: VBY, x1: VBX + VBW, y1: VBY + VBH };
const nameOf = (n) => n.id || n.el.attrs['data-insp'] ||
  (n.kind === 'text' ? `text "${(n.text.en || '').slice(0, 24)}"` : `${n.tag}.${n.cls.join('.') || '?'}`);
function hitKey(n) {                       // the nearest enclosing hit target — the stable name
  for (let p = n.el; p; p = p.parent) if (p.attrs && p.attrs['data-insp']) return p.attrs['data-insp'];
  return n.id || n.tag;
}
for (const n of nodes) {
  if (!n.bbox || !valid(n.bbox)) continue;
  const tol = n.kind === 'text' ? TEXT_EDGE_TOL : EDGE_TOL + (n.kind === 'path' ? strokeWidth(n) / 2 : 0);
  const b = n.bbox;
  if (b.x0 < VB.x0 - tol || b.y0 < VB.y0 - tol || b.x1 > VB.x1 + tol || b.y1 > VB.y1 + tol) {
    add('G001', `${hitKey(n)}/${nameOf(n)}`,
      `${nameOf(n)} is drawn outside the viewBox (${at(n)})`,
      `bbox ${fx(b.x0)},${fx(b.y0)} → ${fx(b.x1)},${fx(b.y1)} vs viewBox 0 0 ${VBW} ${VBH}`);
  }
}
// G002: two pills overlapping, or a pill straddling the edge of a box it is not INSIDE. A pill
// nested in a component (the room reading in the emitter box, ΔT on the plate) is the drawing's own
// idiom; a pill half on and half off a box edge is a mistake with no reading of it.
for (let i = 0; i < pills.length; i++) {
  for (let k = i + 1; k < pills.length; k++) {
    if (!overlaps(pills[i].bbox, pills[k].bbox, 0.01)) continue;
    add('G002', `${hitKey(pills[i])}+${hitKey(pills[k])}`,
      `pills "${hitKey(pills[i])}" and "${hitKey(pills[k])}" overlap (${at(pills[i])}, ${at(pills[k])})`,
      'one reading is drawn over another');
  }
}
for (const p of pills) {
  for (const b of boxes) {
    if (!overlaps(p.bbox, b.bbox, 0.01) || contains(b.bbox, p.bbox)) continue;
    add('G002', `${hitKey(p)}|${hitKey(b)}`,
      `pill "${hitKey(p)}" straddles the edge of the "${hitKey(b)}" box (${at(p)})`,
      `pill ${fx(p.bbox.x0)},${fx(p.bbox.y0)}→${fx(p.bbox.x1)},${fx(p.bbox.y1)} vs box ` +
      `${fx(b.bbox.x0)},${fx(b.bbox.y0)}→${fx(b.bbox.x1)},${fx(b.bbox.y1)} — nest it or move it clear`);
  }
}
// G003: a stroked pipe crossing a text label. This drawing shipped it: the heating riser struck
// through "HEIZUNG", which rendered as "HEIZUNC". A label may still sit ON a pipe when an opaque
// pill/box painted AFTER the pipe covers it — that is how the thermostat pill sits on the riser —
// so paint order, not mere overlap, decides.
const opaque = nodes.filter((n) => n.kind === 'rect' && (has(n, 'sc-pill') || has(n, 'sc-box') || has(n, 'sc-plate') || has(n, 'sc-buh')));
for (const t of texts) {
  for (const p of pipePaths) {
    const hw = strokeWidth(p) / 2;
    const hit = p.segs.some((s) => overlaps(t.bbox, inflate({ x0: Math.min(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]),
      x1: Math.max(s.a[0], s.b[0]), y1: Math.max(s.a[1], s.b[1]) }, hw), 0.01));
    if (!hit) continue;
    const shielded = opaque.some((r) => r.el.off > p.el.off && contains(r.bbox, t.bbox, 1));
    if (shielded) continue;
    add('G003', `${hitKey(t)}/${(t.text.en || '').slice(0, 20)}`,
      `the "${t.text.en || t.text.de}" label is crossed by a pipe (${at(t)})`,
      `text ${fx(t.bbox.x0)},${fx(t.bbox.y0)}→${fx(t.bbox.x1)},${fx(t.bbox.y1)} vs the pipe at ${at(p)} — ` +
      'a stroked pipe over a glyph is what turned "HEIZUNG" into "HEIZUNC"');
  }
}
// G004: text overflowing its pill. Conservative on purpose — the width is an ESTIMATE from the font
// stack's metrics, so the slack is printed with every finding and only a CLEAR overflow is called.
for (const p of pills) {
  const avail = p.rect.w - 2 * PILL_PAD;
  for (const t of texts) {
    if (t.el.parent !== p.el.parent) continue;                    // the pill's own group only
    if (!overlaps(p.bbox, t.bbox, 0.01)) continue;
    if (t.width <= avail + TEXT_FIT_SLACK) continue;
    const lang = textWidth(t.text.de, t.font.size, t.font.weight) > textWidth(t.text.en, t.font.size, t.font.weight) ? 'de' : 'en';
    add('G004', `${hitKey(p)}/${lang}`,
      `"${t.text[lang]}" does not fit its pill (${at(t)})`,
      `estimated ${fx(t.width)} px of text in ${fx(avail)} px of pill (${fx(t.width - avail)} px over; ` +
      `the estimate is Helvetica-class metrics at ${t.font.size} px, ±5 %, with a "${LIVE_SAMPLE}" reading)`);
  }
}
// G005: pipes are axis-aligned. A one-pixel skew is invisible in review and permanent in the image.
for (const p of [...pipePaths, ...hitLines]) {
  for (const s of p.segs) {
    if (isH(s) || isV(s)) continue;
    add('G005', `${hitKey(p)}/${fx(s.a[0])},${fx(s.a[1])}`,
      `pipe segment ${fx(s.a[0])},${fx(s.a[1])} → ${fx(s.b[0])},${fx(s.b[1])} is not axis-aligned (${at(p)})`,
      'every run in this drawing is horizontal or vertical — a skew reads as a mistake, not a feature');
  }
  for (const q of p.prims) {
    if (q.t === 'L') continue;
    add('G005', `${hitKey(p)}/curve`, `pipe at ${at(p)} contains a curve command`, 'pipes are straight runs here');
  }
}
// G006: a pill drawn BESIDE a pipe belongs to that pipe — it must sit within the drawing's ~12 px
// of it AND within its span. A pill floating 40 px away, or hanging past the end of the run it
// names, attributes a reading to a place no pipe is. Pills NESTED in a component are exempt: they
// belong to the box, not to a run.
function gapToSeg(b, s) {
  if (isH(s)) {
    const [x0, x1] = spanX(s);
    if (b.x1 < x0 || b.x0 > x1) return null;                      // not over this run at all
    const y = s.a[1];
    return y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
  }
  if (isV(s)) {
    const [y0, y1] = spanY(s);
    if (b.y1 < y0 || b.y0 > y1) return null;
    const x = s.a[0];
    return x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
  }
  return null;
}
const freePills = pills.filter((p) => !boxes.some((b) => contains(b.bbox, p.bbox)));
const pillRun = new Map();
for (const p of freePills) {
  let best = null;
  for (const s of pipeSegs) {
    const g = gapToSeg(p.bbox, s);
    if (g === null) continue;
    if (best === null || g < best.g) best = { g, s };
  }
  if (best === null) {
    // Nothing to belong to. Either the pill is orphaned, or it is beside a run it does not overlap
    // — the "sitting over a different pipe than the one it belongs to" case.
    let near = Infinity;
    for (const s of pipeSegs) {
      const b = { x0: Math.min(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]), x1: Math.max(s.a[0], s.b[0]), y1: Math.max(s.a[1], s.b[1]) };
      near = Math.min(near, Math.hypot(Math.max(b.x0 - p.bbox.x1, p.bbox.x0 - b.x1, 0), Math.max(b.y0 - p.bbox.y1, p.bbox.y0 - b.y1, 0)));
    }
    add('G006', hitKey(p), `pill "${hitKey(p)}" sits over no pipe run (${at(p)})`,
      `pill ${fx(p.bbox.x0)},${fx(p.bbox.y0)}→${fx(p.bbox.x1)},${fx(p.bbox.y1)}; nearest pipe is ${fx(near)} px away ` +
      'and does not span it — a reading beside nothing claims nothing');
    continue;
  }
  pillRun.set(p, best.s);
  if (best.g > PILL_GAP_MAX) {
    add('G006', hitKey(p), `pill "${hitKey(p)}" floats ${fx(best.g)} px from its pipe (${at(p)})`,
      `the drawing's convention is ~12 px (max ${PILL_GAP_MAX}); pill ${fx(p.bbox.x0)},${fx(p.bbox.y0)}→` +
      `${fx(p.bbox.x1)},${fx(p.bbox.y1)}, run at ${isH(best.s) ? 'y=' + fx(best.s.a[1]) : 'x=' + fx(best.s.a[0])} ` +
      `${fx(Math.min(...(isH(best.s) ? spanX(best.s) : spanY(best.s))))}…${fx(Math.max(...(isH(best.s) ? spanX(best.s) : spanY(best.s))))}`);
  }
}
// G007: rotating artwork must be rotationally symmetric about its own hub. The CSS spins these
// about `transform-box: fill-box` — the BOUNDING BOX centre — so a rotor whose bbox is not centred
// on its axle orbits instead of spinning. The four-blade fan is 90°-symmetric precisely for this;
// its three-blade predecessor was not, and wobbled.
for (const id of rotorIds) {
  const rotor = byId.get(id);
  if (!rotor) { add('G007', id, `CSS animates #${id} about its fill-box, but the SVG has no such element`, ''); continue; }
  const sub = nodes.filter((n) => { for (let p = n.el; p; p = p.parent) if (p === rotor.el) return true; return false; });
  let b = EMPTY;
  for (const n of sub) if (n.bbox && valid(n.bbox)) b = union(b, n.bbox);
  if (!valid(b)) { add('G007', id, `#${id} rotates but has no measurable geometry`, ''); continue; }
  const c = centre(b);
  // The hub: the smallest circle INSIDE the rotor (a fan's cap), else the circle the rotor is drawn
  // on (a pump's body). Never guessed — if neither exists the finding says so instead of inventing
  // an axle, since a wrong hub would be a false alarm on artwork that is perfectly fine.
  const inner = sub.filter((n) => n.kind === 'circle').sort((x, y) => x.r - y.r)[0];
  let hub = inner ? inner.centre : null, hubWhat = inner ? `the r=${fx(inner.r)} hub circle inside it` : '';
  if (!hub) {
    const sibs = nodes.filter((n) => n.kind === 'circle' && n.el.parent === rotor.el.parent);
    const near = sibs.sort((x, y) => Math.hypot(x.centre[0] - c[0], x.centre[1] - c[1]) - Math.hypot(y.centre[0] - c[0], y.centre[1] - c[1]))[0];
    if (near) { hub = near.centre; hubWhat = `the r=${fx(near.r)} circle it is drawn on`; }
  }
  if (!hub) {
    add('G007', id, `#${id} rotates about its bounding box, but no hub could be derived (${at(rotor)})`,
      'add the hub circle, or state in the ledger why this artwork has no axle');
    continue;
  }
  const off = Math.hypot(c[0] - hub[0], c[1] - hub[1]);
  if (off > ROTOR_HUB_TOL) {
    add('G007', id, `#${id} spins about a point ${fx(off)} px off its hub (${at(rotor)})`,
      `bounding box ${fx(b.x0)},${fx(b.y0)}→${fx(b.x1)},${fx(b.y1)} has centre ${fx(c[0])},${fx(c[1])}, ` +
      `but ${hubWhat} is at ${fx(hub[0])},${fx(hub[1])}. CSS spins it about the BBOX centre ` +
      '(transform-box: fill-box), so it orbits instead of turning — make the artwork 90°/180° symmetric about the hub');
  }
}
// G008: every horizontal run sits on ONE of the drawing's two documented levels (the hot side and
// the cold side). A third level is a run that drifted off the grid.
const hLevels = new Map();
for (const s of pipeSegs) { if (!isH(s)) continue; const y = Math.round(s.a[1] * 10) / 10; hLevels.set(y, (hLevels.get(y) || 0) + 1); }
const levels = [...hLevels.entries()].sort((a, b) => b[1] - a[1]);
if (levels.length > 2) {
  const keep = levels.slice(0, 2).map((l) => l[0]);
  for (const [y, n] of levels.slice(2)) {
    add('G008', `y=${fx(y)}`, `${n} horizontal pipe segment(s) sit at y=${fx(y)}, off the drawing's two runs (${keep.map(fx).join(' and ')})`,
      'the schematic documents ONE grid: the hot side and the cold side, and everything that flows sits on one of them');
  }
}
// G009: the two runs pass through boxes that span the same band with the same margins ("the plate
// is the boundary between the two fluids, so it and the unit it faces are the same height by
// construction"). Unequal margins mean a run was moved without its boxes.
if (levels.length >= 2) {
  const [yA, yB] = [levels[0][0], levels[1][0]].sort((a, b) => a - b);
  for (const b of boxes) {
    if (!(b.bbox.y0 < yA && b.bbox.y1 > yB)) continue;             // crossed by BOTH runs
    const top = yA - b.bbox.y0, bot = b.bbox.y1 - yB;
    if (Math.abs(top - bot) > 0.5) {
      add('G009', hitKey(b), `the "${hitKey(b)}" box sits ${fx(top)} px below the hot run but ${fx(bot)} px above the cold one (${at(b)})`,
        'both runs cross this box, so its margins are the drawing\'s grid — moving a run means moving both edges with it');
    }
  }
}
// G010: every animated flow overlay traces a real pipe. The overlay is a SECOND copy of the same
// path data, so it drifts the moment one of the two is edited — and the drawn pipe stays put while
// the animation runs somewhere else.
const pipeDs = new Set([...pipePaths, ...nodes.filter((n) => n.kind === 'path' && !n.cls.length && n.el.attrs.stroke)].map((n) => (n.d || '').replace(/\s+/g, ' ').trim()));
for (const f of flowPaths) {
  const d = (f.d || '').replace(/\s+/g, ' ').trim();
  if (pipeDs.has(d)) continue;
  add('G010', f.id || hitKey(f), `flow overlay ${f.id ? '#' + f.id : ''} traces no drawn pipe (${at(f)})`,
    `d="${d}" matches no sc-pipe/sc-rpipe path — the animation and the pipe have drifted apart`);
}
// G011: a pipe's TAP AREA must stop at the edge of the fitting it meets. sc-hitline is a fat
// invisible stroke (a 5 px pipe is not tappable), and with `stroke-linecap: round` it reaches half a
// stroke PAST its declared endpoint — geometry that exists only in the stylesheet. SVG hit testing
// is topmost-wins, so where that overhang covers a component drawn EARLIER, the component silently
// loses the clicks it visibly offers: the drawing outlines the 3-way valve on hover and then opens
// the DHW branch. It shipped exactly so — every trim in the drawing was computed as if the cap were
// flat, and the valve lost 21 % of its disc (18 % to the tank riser trimmed to y=194, its own bottom
// edge, whose cap put it back at y=185; 4 % to the heating run), with the same 9 px bitten out of
// the outdoor-unit box and the plate. Nothing else could see it: the pixels are transparent, the
// markup coordinates read correct, and only a pointer at the rim tells you.
// Hit line vs hit line is deliberately NOT checked. Two runs overlapping at a real junction share a
// physical place, and which branch owns it is E004's question, not a geometry error.
const HIT_INTRUDE_TOL = 0.5;
function distPointSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}
// Segment → axis-aligned rect, as the distance to the rect's FILLED area (0 once they touch).
// Exact, not sampled: between two convex shapes the closest pair always involves a VERTEX of one, so
// the four rect corners and the two segment ends exhaust the candidates — plus a slab test, because
// a run passing clean THROUGH a component (a worse defect than an overhang) has every vertex
// distance positive. The `rx` corner rounding is ignored, which over-states the rect at its corners
// only: conservative in the safe direction, and the real cases are all mid-edge.
function distSegRect(a, b, r) {
  const clampD = (p) => Math.hypot(p[0] - Math.min(Math.max(p[0], r.x0), r.x1),
                                   p[1] - Math.min(Math.max(p[1], r.y0), r.y1));
  if (clampD(a) === 0 || clampD(b) === 0) return 0;                // an end sits inside
  let t0 = 0, t1 = 1;                                              // slab test: does it cross?
  for (const [p, q, lo, hi] of [[a[0], b[0], r.x0, r.x1], [a[1], b[1], r.y0, r.y1]]) {
    const d = q - p;
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; break; } continue; }
    const ta = (lo - p) / d, tb = (hi - p) / d;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t0 <= t1) return 0;
  const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]];
  return Math.min(clampD(a), clampD(b), ...corners.map((c) => distPointSeg(c, a, b)));
}
const shapes = [...pills, ...boxes, ...discs];
for (const h of hitLines) {
  const cap = lineCap(h);
  if (cap === 'butt') continue;                                    // the coordinates ARE the edge
  const reach = strokeWidth(h) / 2;                                // round and square both add this
  for (const sh of shapes) {
    if (h.el.off < sh.el.off) continue;                            // the shape paints later and wins
    if (hitKey(h) === hitKey(sh)) continue;                        // same target — no click changes hands
    let worst = 0, where = null;
    for (const s of h.segs) {
      const gap = sh.kind === 'circle'
        ? Math.max(0, distPointSeg(sh.centre, s.a, s.b) - sh.r)
        : distSegRect(s.a, s.b, sh.bbox);
      if (reach - gap > worst) { worst = reach - gap; where = s; }
    }
    if (worst <= HIT_INTRUDE_TOL) continue;
    const c = sh.kind === 'circle' ? sh.centre : centre(sh.bbox);  // report the END that overhangs
    const end = Math.hypot(where.a[0] - c[0], where.a[1] - c[1]) <
                Math.hypot(where.b[0] - c[0], where.b[1] - c[1]) ? where.a : where.b;
    add('G011', `${hitKey(h)}|${hitKey(sh)}`,
      `the "${hitKey(h)}" hit line reaches ${fx(worst)} px into the "${hitKey(sh)}" component (${at(h)})`,
      `stroke-linecap: ${cap} adds ${fx(reach)} px past its endpoint nearest the fitting ` +
      `(viewBox ${fx(end[0])},${fx(end[1])} — the markup is offset by the drawing's translate), so the run's ` +
      `tap area covers part of a fitting drawn earlier (${at(sh)}) — a tap on that rim opens "${hitKey(h)}" ` +
      `while the drawing outlines "${hitKey(sh)}". Trim the hit line back by the missing ${fx(worst)} px.`);
  }
}

// ── LAYER 3 — domain / editorial ─────────────────────────────────────────────────────────────────
// E001: a pill whose UNIT repeats across the drawing must carry a name, because position alone is a
// weak tell for readings whose same-unit neighbours sit two components away (DESIGN.md §5.3: three
// pills read "bar" and only one of them is water). The name may be a sub-label under the pill or a
// word inside it ("Outdoor 12.5 °C", "ΔT 5.0 K") — both are attribution.
function pillText(p) { return texts.filter((t) => t.el.parent === p.el.parent && !t.cls.includes('sc-sub')); }
function pillSub(p) { return texts.filter((t) => t.el.parent === p.el.parent && t.cls.includes('sc-sub')); }
const unitOf = (s) => {
  // The unit as DRAWN: whatever trails the reading. "kW el." is not "kW" — and that difference is
  // exactly how a reader tells the two derived pills apart, so it is taken verbatim.
  const m = /(?:-88\.8|\d)\s*([^\d]*)$/.exec(s);
  return m ? m[1].trim() : '';
};
const pillUnits = new Map();
for (const p of pills) {
  const t = pillText(p)[0];
  if (!t) continue;
  const u = unitOf(t.text.en);
  if (!u) continue;
  if (!pillUnits.has(u)) pillUnits.set(u, []);
  pillUnits.get(u).push({ pill: p, text: t });
}
for (const [unit, list] of pillUnits) {
  if (list.length < 2) continue;
  for (const { pill, text } of list) {
    const lead = text.text.en.split(LIVE_SAMPLE)[0];
    const named = /\p{L}/u.test(lead) || pillSub(pill).length > 0;
    if (named) continue;
    add('E001', hitKey(pill), `the "${unit}" pill "${hitKey(pill)}" carries no name, and "${unit}" appears on ${list.length} pills (${at(pill)})`,
      `the others are ${list.filter((o) => o.pill !== pill).map((o) => hitKey(o.pill)).join(', ')} — ` +
      'without a name sub-label, position alone has to carry which quantity this is (DESIGN.md §5.3)');
  }
}
// E002: the return run's sensors sit on its COMMON section. R4T is at the indoor unit's water
// INLET, downstream of the merge: it reads whichever branch is flowing and belongs to NEITHER, so a
// pill drawn past the tank junction answers "which return is this?" with the wrong one of the two.
// The junction is DERIVED from the drawing (where a branch riser meets the return run), never
// written down twice.
{
  // COLLINEAR segments of the same kind are ONE physical run. The drawing splits the return into
  // two paths on purpose — each carries its own flow overlay, so the heating-only section can stay
  // still while a DHW cycle animates the shared one — and a junction that ENDS one segment and
  // STARTS the next is still a junction. Reading each path in isolation found no interior joint at
  // all and tripped the vacuity guard, which is how this was noticed rather than silently passing.
  const runs = [];
  for (const h of pipeSegs.filter(isH)) {
    const kind = h.node.cls.includes('sc-rpipe') ? 'r' : 'w';       // refrigerant runs are not water runs
    const [x0, x1] = spanX(h);
    let m = runs.find((r) => r.kind === kind && Math.abs(r.y - h.a[1]) < 0.5);
    if (!m) { m = { kind, y: h.a[1], x0: Infinity, x1: -Infinity, segs: [] }; runs.push(m); }
    m.x0 = Math.min(m.x0, x0); m.x1 = Math.max(m.x1, x1); m.segs.push(h);
  }
  // A joint is where a branch MERGES INTO this run, which is not the same as where one leaves it:
  // the tank's return descends INTO the return run (its span lies above it), while the tank's supply
  // hangs DOWN from the supply run (its span lies below). Both are interior verticals, so counting
  // joints alone made the supply run eligible for a rule that is about being downstream of a merge —
  // and with the return now drawn as two segments the two runs tied, and the supply won on order.
  let run = null, joints = [];
  for (const m of runs) {
    const js = pipeSegs.filter(isV).filter((v) => {
      const [y0, y1] = spanY(v);
      if (!(v.a[0] > m.x0 + 0.5 && v.a[0] < m.x1 - 0.5)) return false;   // strictly INTERIOR
      return Math.abs(y1 - m.y) < 0.5 && y0 < m.y - 0.5;                 // comes DOWN into the run
    });
    if (js.length > joints.length) { run = m; joints = js; }
  }
  if (!run || joints.length === 0) {
    die(2, 'no branch junction found on any horizontal run — the return-run rule would pass vacuously; ' +
           'the drawing changed shape, so re-derive it before trusting this audit');
  }
  const junction = Math.min(...joints.map((v) => v.a[0]));
  for (const [p, seg] of pillRun) {
    if (!run.segs.includes(seg)) continue;
    const [cx] = centre(p.bbox);
    if (cx <= junction) continue;
    add('E002', hitKey(p), `pill "${hitKey(p)}" sits right of the branch junction at x=${fx(junction)} (${at(p)})`,
      `its centre is x=${fx(cx)}, i.e. on the single-branch section of the run at y=${fx(run.y)} — ` +
      'the sensors on this run are at the unit\'s inlet, downstream of the merge, and belong to NEITHER branch');
  }
  // E003: and the same rule for the FLOW overlays. A junction is where two branches' flow states
  // part company — right of it only the heating circuit feeds the run, left of it both share it —
  // so an overlay that SPANS the junction animates both sections together and cannot tell them
  // apart. That is how a DHW cycle came to animate a stretch of heating pipe nothing was flowing
  // through: the return was split at an arbitrary point on the drop instead of at the merge, and
  // every other rule passed, because the pipe was in the right place and the overlay traced it.
  // A reading on the wrong branch is E002; this is the same claim, made by a moving dash.
  for (const j of joints.map((v) => v.a[0])) {
    for (const f of flowPaths) {
      for (const seg of f.segs) {
        if (!isH(seg) || Math.abs(seg.a[1] - run.y) > 0.5) continue;
        const [x0, x1] = spanX(seg);
        if (x0 < j - 0.5 && x1 > j + 0.5) {
          add('E003', `${f.el.attrs.id || '?'}`,
            `flow overlay #${f.el.attrs.id || '?'} spans the branch junction at x=${fx(j)} (${at(f)})`,
            `its segment runs ${fx(x0)}…${fx(x1)} on y=${fx(run.y)}, i.e. across both the single-branch ` +
            'section and the shared one — one animation cannot state two different flow states, so ' +
            'whichever branch is idle is drawn as flowing. Split the overlay AT the junction.');
        }
      }
    }
  }
  // E004: and the same rule a third time, for who OWNS the pipe in the pointer. A hit target is a
  // claim that everything inside it is one thing — hovering it lights the whole group and tapping it
  // opens ONE inspector entry — so a target reaching across the junction says the shared run and one
  // branch are the same pipe, which is the E003 claim made by a highlight instead of a moving dash.
  // Composed with E003 this pins the two splits TOGETHER: the overlay must break at the junction and
  // so must the group, therefore the animated section and the selectable section are the same
  // section. They came apart in the shipped drawing — the return group owned the heating branch's
  // leg as well as the shared run, and the tank's leg belonged to no group at all (S011) — so
  // hovering the return highlighted one branch, ignored the other, and looked like a selection that
  // stops at the heating.
  const ownerSegs = new Map();
  for (const h of [...pipePaths, ...hitLines]) {
    if (h.cls.includes('sc-rpipe')) continue;                       // a refrigerant run is not this run
    for (const s of h.segs) {
      if (!isH(s) || Math.abs(s.a[1] - run.y) > 0.5) continue;
      const k = hitKey(h);
      if (!ownerSegs.has(k)) ownerSegs.set(k, []);
      ownerSegs.get(k).push(spanX(s));
    }
  }
  for (const [k, list] of ownerSegs) {
    // Collinear pieces that TOUCH are one owned stretch — the pipe and its (deliberately shortened)
    // hit line, or a leg and the run it continues into. Pieces separated by a component are not.
    const sorted = list.map(([a, b]) => [a, b]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [x0, x1] of sorted) {
      const last = merged[merged.length - 1];
      if (last && x0 <= last[1] + 0.5) last[1] = Math.max(last[1], x1);
      else merged.push([x0, x1]);
    }
    for (const [x0, x1] of merged) {
      for (const j of joints.map((v) => v.a[0])) {
        if (x0 < j - 0.5 && x1 > j + 0.5) {
          add('E004', k, `hit target "${k}" owns pipe across the branch junction at x=${fx(j)}`,
            `it covers ${fx(x0)}…${fx(x1)} on the run at y=${fx(run.y)}, i.e. the shared section AND a ` +
            'single-branch one — selecting it highlights a branch the reading it opens does not describe, ' +
            'and leaves the other branch out. Split the group AT the junction, where E003 splits the flow');
        }
      }
    }
  }
  if (verbose) console.log(`  return run y=${fx(run.y)} ${fx(run.x0)}…${fx(run.x1)}, junction x=${fx(junction)}`);
}

// A ledger line that suppressed nothing this run is itself a finding: the condition it adjudicated
// is gone, so the line can only hide that condition coming back.
for (const [key, line] of exceptions) {
  if (!usedExceptions.has(key)) {
    findings.push({ code: 'S000', key, msg: `${EXC}:${line} suppresses nothing: "${key}"`,
      detail: 'the finding it adjudicated is gone — delete the line' });
  }
}

// ── 7. report ────────────────────────────────────────────────────────────────────────────────────
const summary =
  `${hitTargets.length} hit targets / ${pills.length} pills / ${pipeSegs.length} pipe segments / ` +
  `${texts.length} labels in a ${VBW}x${VBH} viewBox, vs ${Object.keys(INSPECT).length} INSPECT entries ` +
  `and ${cat.labels.size} catalog labels`;

if (verbose) {
  console.log(summary);
  for (const p of pills.slice().sort((a, b) => hitKey(a).localeCompare(hitKey(b)))) {
    const seg = pillRun.get(p);
    console.log(`  pill ${hitKey(p).padEnd(8)} ${fx(p.bbox.x0)},${fx(p.bbox.y0)} ${fx(p.rect.w)}x${fx(p.rect.h)}` +
      (seg ? `  on ${isH(seg) ? 'y=' + fx(seg.a[1]) : 'x=' + fx(seg.a[0])} (gap ${fx(gapToSeg(p.bbox, seg))})` : '  nested in a component'));
  }
  for (const id of rotorIds) console.log(`  rotor #${id}`);
}
// Suppressed findings are PRINTED, never hidden: an adjudication is a decision on record, and one
// nobody can see is indistinguishable from a check that stopped running.
for (const s of suppressed) console.log(`  [${s.code}] ${s.msg}   (suppressed by ${EXC}:${s.at})`);

if (findings.length === 0) {
  console.log(`schematic: clean — ${summary}` + (suppressed.length ? `; ${suppressed.length} adjudicated` : ''));
  process.exit(0);
}
console.error(`schematic: ${findings.length} finding(s) — ${summary}\n`);
for (const f of findings) {
  console.error(`  [${f.code}] ${f.msg}`);
  if (f.detail) console.error(`          ${f.detail}`);
  console.error(`          key: ${f.code} ${f.key}`);
}
console.error(
  '\n  S001 hit target with no INSPECT entry   S002 INSPECT entry with no hit target\n' +
  '  S003 `sample` is not a catalog label     S004/S005 an id one side writes and the other lacks\n' +
  '  S006 data-i18n key missing from a dict   S007 duplicate id   S008 dangling <use>\n' +
  '  S010 `sample` matches no DESCRIPTIONS entry (the explainer opens blank)\n' +
  '  S009 stray text in the SVG               S000 stale ledger line\n' +
  '  S011 a pipe inside no hit target — unhoverable, and it fails silently\n' +
  '  G001 drawn outside the viewBox           G002 overlapping pill/box\n' +
  '  G003 label crossed by a pipe             G004 text overflows its pill (estimate — see the slack)\n' +
  '  G005 pipe not axis-aligned               G006 pill too far from / not over its run\n' +
  '  G007 rotor not centred on its hub        G008 run off the two-level grid   G009 unequal run margins\n' +
  '  G010 flow overlay traces no pipe\n' +
  '  G011 a pipe\'s tap area reaches into a fitting drawn earlier (the round line cap overhangs)\n' +
  '  E001 repeated unit with no name          E002 pill on the wrong branch\n' +
  '  E003 flow overlay spans a junction — one animation cannot state two branches\' flow states\n' +
  '  E004 hit target spans a junction — one highlight cannot select two branches as one pipe\n' +
  `  A finding that is CORRECT as it stands goes in ${EXC} — copy its key: line, with a reason.\n` +
  '  S001 and E002 are refused there: fix the drawing.\n' +
  '  What this CANNOT decide — is the picture still true, is a new part in the right place, is the\n' +
  '  German copy right — is the /schematic-review skill\'s half.');
process.exit(1);
