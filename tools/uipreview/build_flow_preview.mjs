#!/usr/bin/env node
// Builds tools/uipreview/flow-preview.html: today's water-flow animation and the four candidates
// from flow_variants.css, side by side, on the REAL schematic.
//
// Why it generates rather than hand-copies: a mock-up drawn beside the product is a drawing of the
// product, and it drifts the day someone moves a pipe. This reads main/www/index.html and
// main/www/style.css directly, so what the preview shows is what the firmware would ship — down to
// the pill positions, the thermal colour swap in cooling and the subdued plate channels. Rerun it
// after any schematic change and the comparison is current again.
//
// Usage: node tools/uipreview/build_flow_preview.mjs [-o out.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const args = process.argv.slice(2);
const outIdx = args.indexOf('-o');
const outPath = outIdx >= 0 ? args[outIdx + 1] : path.join(root, 'tools/uipreview/flow-preview.html');

// ── 1. The real markup and the real stylesheet ──────────────────────────────────────────────────
const indexHtml = read('main/www/index.html');
const start = indexHtml.indexOf('<svg viewBox="0 0 790 451"');
const end = indexHtml.indexOf('</svg>', start);
if (start < 0 || end < 0) {
  console.error('build_flow_preview: the schematic <svg viewBox="0 0 790 451"> block is gone from ' +
                'main/www/index.html — the drawing was restructured, so fix this extractor rather ' +
                'than shipping a preview of markup that no longer exists.');
  process.exit(2);
}
const svgSource = indexHtml.slice(start, end + '</svg>'.length);
const shippedCss = read('main/www/style.css');
const variantCss = read('tools/uipreview/flow_variants.css');

// Ids referenced from inside the SVG by url(#…) / href="#…". Five copies of the drawing live on one
// page, so these get a per-copy prefix; without it every copy would resolve its gradients and its
// fan blades against the FIRST copy's defs, which also means against that copy's custom-property
// values — one figure's thermal colours painted onto all five.
const LOCAL_IDS = ['pheRefrigerantFlow', 'pheWaterFlow', 'tankFlow', 'spaceFlow', 'fanBlade', 'pumpVane'];
// The four GRADIENTS are named in main/www/style.css, not in the markup (`stroke: url(#tankFlow)`),
// so prefixing the definition alone leaves those four rules pointing at an id that no longer
// exists — the overlay then paints with no stroke at all and the tank, the space circuit and both
// plate channels simply vanish. Each panel therefore gets its own copies of those four rules,
// scoped by the panel and pointing at its own prefixed gradient. `#schem.bsh-on .sc-tank-flow`
// outranks them on specificity, so the electric-heater orange still wins over the charge gradient.
const CSS_GRADIENT_RULES = [
  ['sc-phe-refrigerant-flow', 'pheRefrigerantFlow'],
  ['sc-phe-water-flow', 'pheWaterFlow'],
  ['sc-tank-flow', 'tankFlow'],
  ['sc-space-flow', 'spaceFlow'],
];

function scopeSvg(svg, prefix) {
  let out = svg;
  for (const id of LOCAL_IDS) {
    out = out.replaceAll(`id="${id}"`, `id="${prefix}-${id}"`);
    out = out.replaceAll(`url(#${id})`, `url(#${prefix}-${id})`);
    out = out.replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
  }
  return out;
}

// A light-ribbon variant needs SEVERAL overlays on one pipe, so each flow path becomes a <g> that
// takes over the run's id with N identical children under it. The id moves to the group because the
// id is what says "this run is flowing" — the renderer toggles `.on` there and every strand follows.
// The children keep the run's classes (which is how each still picks up its own thermal colour, the
// cooling swap and the neutral grey) and gain `fx-s<i>`, which is all the variant CSS needs to give
// strand 3 a different width, blur, speed and wander from strand 1.
// Every clone carries the SAME `d` as the pipe it traces and the same endpoints, so G010 and
// E003/E004 read a stack of strands exactly as they read one overlay.
const FLOW_CLASSES = /\b(?:sc-flow|sc-rflow|sc-tank-flow|sc-space-flow)\b/;

function strandify(svg, count) {
  if (count < 2) return svg;
  return svg.replace(/<path\b([^>]*?)\/>/g, (whole, attrs) => {
    const cls = /class="([^"]*)"/.exec(attrs);
    if (!cls || !FLOW_CLASSES.test(cls[1])) return whole;
    const id = /id="([^"]*)"/.exec(attrs);
    const body = attrs.replace(/\s*id="[^"]*"/, '');
    let out = `<g class="fx-strands"${id ? ` id="${id[1]}"` : ''}>`;
    for (let i = 1; i <= count; i++) {
      out += `<path${body.replace(/class="([^"]*)"/, `class="$1 fx-s${i}"`)}/>`;
    }
    return `${out}</g>`;
  });
}

function gradientRulesFor(prefix) {
  return CSS_GRADIENT_RULES
    .map(([cls, id]) => `.panel[data-variant="${prefix}"] svg .${cls} { stroke: url(#${prefix}-${id}); }`)
    .join('\n');
}

// The firmware's palette switches on `prefers-color-scheme` alone, so the page's own light/dark
// button would recolour the bench and leave all five drawings in the OS theme. Re-emitting the two
// token blocks under explicit [data-theme] stamps — the light one included, so the button wins in
// both directions — makes the toggle reach the schematic without editing style.css.
function braceBlock(css, from) {
  const open = css.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced braces in style.css near index ' + from);
}

function themeStamps(css) {
  const lightAt = css.indexOf('\n:root {');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark) {');
  if (lightAt < 0 || darkAt < 0) {
    console.error('build_flow_preview: style.css no longer opens with a :root token block plus a ' +
                  'prefers-color-scheme dark block — the theme button cannot be wired without ' +
                  'them, so update this extractor.');
    process.exit(2);
  }
  const light = braceBlock(css, lightAt);
  const dark = braceBlock(css, css.indexOf(':root {', darkAt));
  return `:root[data-theme="light"] {${light}}\n:root[data-theme="dark"] {${dark}}`;
}

// ── 2. The panels, in two families ──────────────────────────────────────────────────────────────
const VARIANTS = [
  { key: 'a', cls: 'fx-a', strands: 5, family: 'ribbon', name: 'Aurora', tag: 'Version A',
    claim: 'Fünf Stränge, lange weiche Striche, jeder auf einer anderen Umlaufzeit — sie gleiten ' +
           'ewig aneinander vorbei, ohne sich je zu wiederholen. Breiter Dunst um einen harten ' +
           'hellen Faden. Die langsamste: ein Vorhang, keine Strömung.',
    specs: ['5 Stränge · 3,4× bis 0,22×', 'Striche 70/34', '3,6–6,3 s Drift', 'Band ~22 Einheiten breit'] },
  { key: 'b', cls: 'fx-b', strands: 4, family: 'ribbon', name: 'Magnetfeld', tag: 'Version B',
    claim: 'Die beiden mittleren Stränge schwingen gegenphasig und eine halbe Strichperiode ' +
           'versetzt — sie kreuzen sich alle 0,95 s und lesen sich als Doppelhelix um das Rohr. ' +
           'Kurze Striche, 1,25 s: die schnelle, gespannte. Auch die billigste im Zeichnen.',
    specs: ['4 Stränge, 2 als Helix ±7', 'Striche 26/14', '1,25 s Drift', 'Kreuzung alle 0,95 s'] },
  { key: 'c', cls: 'fx-c', strands: 6, family: 'ribbon', name: 'Sternenstrom', tag: 'Version C',
    claim: 'Ein breiter Dunst als Flussbett, darüber fünf feine Stränge aus sehr kurzen Strichen — ' +
           'jeder mit eigener Länge, Geschwindigkeit, Wanderung und Funkeltakt, keiner ein Teiler ' +
           'des anderen. Kein Band, sondern ein Schwarm. Die körnige.',
    specs: ['6 Stränge', 'Striche 0,8 bis 120', '0,75–6,5 s Drift', 'Funkeln 0,9–2,6 s'] },
  { key: 'now', cls: '', strands: 1, family: 'ref', name: 'Aktuell', tag: 'heute im Gerät',
    claim: 'Gleichmäßige Striche, 9 an / 15 aus, 1,1 s pro Takt. Die Referenz — daran wird gemessen.',
    specs: ['dasharray 9 15', '1,1 s', 'kein Leuchten'] },
  { key: 'v1', cls: 'fx-v1', strands: 1, family: 'quiet', name: 'Plasmastrom', tag: 'Variante 1',
    claim: 'Tropfen, die sich zu Schlieren dehnen, verschmelzen und wieder abreißen. Weiche ' +
           'Kanten durch einen 1,4-px-Blur, zwei Perioden (1,7 s / 4,1 s), die sich nie treffen.',
    specs: ['Muster atmet 4/20 ↔ 19/5', 'blur + 2 Höfe', '1,7 s · 4,1 s'] },
  { key: 'v2', cls: 'fx-v2', strands: 1, family: 'quiet', name: 'Kometenschweif', tag: 'Variante 2',
    claim: 'Ein heller Kopf, dahinter ein Schweif aus kleiner werdenden Funken — alles ein ' +
           'einziges achtstelliges Strichmuster, kurz genug, dass ein ganzer Komet auch in die 47 ' +
           'Einheiten kurzen Vorlaufstücke passt.',
    specs: ['dasharray 1 3 2 3 5 3 12 10', '0,55 s', 'Hof pulst 2,3 s'] },
  { key: 'v3', cls: 'fx-v3', strands: 1, family: 'quiet', name: 'Fusionsimpuls', tag: 'Variante 3',
    claim: 'Keine Strömung, sondern Entladungen: drei runde Pakete in ungleichem Abstand, schnell, ' +
           'weißglühender Kern. Die lauteste der ersten vier.',
    specs: ['dasharray 1 33 1 25 1 43', '0,82 s', 'brightness 1,28'] },
  { key: 'v4', cls: 'fx-v4', strands: 1, family: 'quiet', name: 'Polarlicht', tag: 'Variante 4',
    claim: 'Das Rohr wirkt gefüllt; was wandert, ist die Naht. Drei langsame Wellen für Breite, ' +
           'Deckkraft und Hof laufen gegeneinander. Die ruhigste der ersten vier.',
    specs: ['dasharray 54 7 26 7', '3,2 s · 2,05 s · 6,5 s', 'nur Sättigung, kein Hue-Shift'] },
];

// ── 3. Scenarios: which branch flows, in what thermal colour, with which readings ───────────────
// The class sets and the overlay lists mirror renderSchematic() in main/www/js/schematic.js —
// notably that a branch animates only when the 3-way valve SAYS which way it is pointing, and that
// pump-only circulation is thermally neutral rather than painted as heating.
const COMMON = ['fPhe', 'fSup1', 'fSup2', 'fSup3', 'fRet'];
const HEATING = ['fHeat', 'fHeatRet', 'fSpaceEdgeL', 'fSpaceEdgeR'];
const DHW = ['fTank', 'fTankRet', 'fTankEdgeL', 'fTankEdgeR'];
const REFRIGERANT = ['rfHot', 'rfPhe', 'rfCold'];

const SCENARIOS = [
  { key: 'heat', label: 'Heizen',
    cls: ['pump-on', 'fan-on'], on: [...COMMON, ...HEATING, ...REFRIGERANT], rev: [],
    values: { svMode: 'Heizen', svStatus: 'Verdichter läuft · Raum 21,4 °C', svDotFill: 'var(--ok)',
              svLwt: '38,6', svR2t: '38,6', svRwt: '34,1', svDt: '4,5', svFlow: '18,4',
              svPth: '5,8', svPel: '1,4', svCop: '4,1', svRps: '58', svHp: '28,4', svLp: '7,9',
              svDisch: '71,2', svR3t: '33,6', svEev: '42', svOut: '4,8', svOuHx: '-1,8',
              svWp: '1,8', svPump: '64', svValve: '3WV → Heizung', svValve2: 'zu',
              svFlowSwitch: 'ja', svSpaceH: 'EIN', svTank: '46,2', svTankSet: '50',
              svRoom: '21,4', svRoomSet: '21,5', svEnv3Temp: '20,9' } },
  { key: 'cool', label: 'Kühlen',
    cls: ['pump-on', 'fan-on', 'cooling-mode'], on: [...COMMON, ...HEATING, ...REFRIGERANT], rev: REFRIGERANT,
    values: { svMode: 'Kühlen', svStatus: 'Verdichter läuft · Raum 25,8 °C', svDotFill: 'var(--ok)',
              svLwt: '16,2', svR2t: '16,3', svRwt: '21,0', svDt: '-4,8', svFlow: '17,9',
              svPth: '6,0', svPel: '1,7', svCop: '3,5', svCopLabel: 'EER', svRps: '44',
              svHp: '21,6', svLp: '11,2', svDisch: '58,3', svR3t: '29,4', svEev: '51',
              svOut: '31,2', svOuHx: '36,4', svWp: '1,7', svPump: '58',
              svValve: '3WV → Heizung', svValve2: 'zu', svFlowSwitch: 'ja', svSpaceH: 'EIN',
              svTank: '44,8', svTankSet: '50', svRoom: '25,8', svRoomSet: '24,0',
              svEnv3Temp: '26,4' } },
  { key: 'dhw', label: 'Warmwasser',
    cls: ['pump-on', 'fan-on'], on: [...COMMON, ...DHW, ...REFRIGERANT], rev: [],
    values: { svMode: 'Warmwasser', svStatus: 'Speicherladung läuft', svDotFill: 'var(--ok)',
              svLwt: '52,4', svR2t: '52,4', svRwt: '45,9', svDt: '6,5', svFlow: '12,6',
              svPth: '5,7', svPel: '1,8', svCop: '3,2', svRps: '72', svHp: '36,5', svLp: '7,2',
              svDisch: '84,6', svR3t: '46,8', svEev: '38', svOut: '4,8', svOuHx: '-3,6',
              svWp: '1,9', svPump: '71', svValve: '3WV → Speicher', svValve2: 'zu',
              svFlowSwitch: 'ja', svSpaceH: 'AUS', svTank: '46,2', svTankSet: '55',
              svRoom: '21,1', svRoomSet: '21,5', svEnv3Temp: '20,7' } },
  // The immersion heater sits IN the store, so the water loop is carrying residual heat, not a
  // compressor output: `water-neutral` for the grey circulation, `bsh-on` for the orange store.
  // The outdoor unit's own readings stay blank because its pages freeze with the compressor off —
  // the same reason the drawing suppresses the inverter-current fallback there.
  { key: 'bsh', label: 'Heizstab',
    cls: ['pump-on', 'bsh-on', 'water-neutral'], on: [...COMMON, ...DHW], rev: [],
    values: { svMode: 'Warmwasser', svStatus: 'Elektrischer Heizstab aktiv', svDotFill: 'var(--warn)',
              svLwt: '41,0', svR2t: '41,0', svRwt: '40,2', svDt: '0,8', svFlow: '14,6',
              svPel: '2,9', svWp: '1,8', svPump: '55', svValve: '3WV → Speicher', svValve2: 'zu',
              svFlowSwitch: 'ja', svSpaceH: 'AUS', svTank: '58,9', svTankSet: '60',
              svRoom: '21,0', svRoomSet: '21,5', svOut: '3,1', svEnv3Temp: '20,6' } },
  { key: 'neutral', label: 'Nur Pumpe',
    cls: ['pump-on', 'water-neutral'], on: [...COMMON, ...HEATING], rev: [],
    values: { svMode: 'Bereitschaft', svStatus: 'Umwälzung ohne Wärmeerzeugung', svDotFill: 'var(--muted)',
              svLwt: '29,4', svR2t: '29,4', svRwt: '29,0', svDt: '0,4', svFlow: '12,1',
              svWp: '1,7', svPump: '42', svValve: '3WV → Heizung', svValve2: 'zu',
              svFlowSwitch: 'ja', svSpaceH: 'AUS', svTank: '43,7', svTankSet: '50',
              svRoom: '21,2', svRoomSet: '21,5', svOut: '6,2', svEnv3Temp: '20,9' } },
];

// The readings are invented, but they are not arbitrary: a picture of a plant that cannot exist is
// the exact failure shape scripts/run-domain-audit.sh is there to catch, and it would be no less
// wrong for being a preview. So the three derived figures are checked against the two they come
// from before the page is written, the same relation the firmware computes:
//   Pth [kW] = flow [l/min] / 60 · 4.18 kJ/(kg·K) · ΔT [K]   (water, ρ ≈ 1 kg/l)
//   COP/EER  = Pth / Pel
// ΔT is SIGNED — R1T at the PHE outlet minus R4T at its inlet — so it is negative in cooling, where
// the outlet is the cold supply. A scenario with the compressor off declares neither figure at all:
// pump-only circulation and an immersion-heater charge are not compressor output, and the firmware
// withholds both rather than crediting residual heat to the heat pump.
const num = (s) => parseFloat(String(s).replace(',', '.'));
for (const sc of SCENARIOS) {
  const v = sc.values;
  if (v.svPth === undefined) {
    if (v.svCop !== undefined) {
      console.error(`build_flow_preview: scenario "${sc.key}" states a COP with no heat output.`);
      process.exit(2);
    }
    continue;
  }
  const pth = Math.abs(num(v.svFlow)) / 60 * 4.18 * Math.abs(num(v.svDt));
  if (Math.abs(pth - num(v.svPth)) > 0.06) {
    console.error(`build_flow_preview: scenario "${sc.key}" claims ${v.svPth} kW at ${v.svFlow} l/min ` +
                  `and ΔT ${v.svDt} K, but that is ${pth.toFixed(2)} kW — fix the fixture, not this check.`);
    process.exit(2);
  }
  if (Math.abs(num(v.svPth) / num(v.svPel) - num(v.svCop)) > 0.06) {
    console.error(`build_flow_preview: scenario "${sc.key}" claims ${v.svCop} from ${v.svPth} kW ` +
                  `over ${v.svPel} kW, which is ${(num(v.svPth) / num(v.svPel)).toFixed(2)}.`);
    process.exit(2);
  }
}

// Every scenario declares a full drawing: anything a scenario leaves out is blanked back to the
// firmware's own "no reading" dash rather than left showing the previous scenario's number.
const ALL_VALUE_IDS = [...new Set(SCENARIOS.flatMap((s) => Object.keys(s.values)))]
  .filter((id) => id !== 'svDotFill');

// ── 4. Emit ─────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FAMILY_INTRO = {
  ribbon: { title: 'Lichtbänder',
            note: 'Mehrere Stränge auf demselben Rohr, jeder mit eigener Breite, Farbe, ' +
                  'Unschärfe, Geschwindigkeit und einer langsamen Wanderung von wenigen Einheiten. ' +
                  'Wo sie sich überlagern, addieren sie sich — der helle Grat dieser Summe wandert ' +
                  'die Leitung entlang. Für das dunkle Schema gebaut.' },
  ref:    { title: 'Referenz', note: 'Was heute im Gerät läuft.' },
  quiet:  { title: 'Die ruhigere Familie',
            note: 'Aus der ersten Runde: je ein reiner CSS-Block auf der Überlagerung, die es ' +
                  'schon gibt — kein zusätzliches Element, keine Markup-Änderung, keine neue Farbe.' },
};

let lastFamily = null;
const panels = VARIANTS.map((v) => {
  const head = v.family === lastFamily ? '' : `
      <header class="family">
        <h2 class="family-title">${esc(FAMILY_INTRO[v.family].title)}</h2>
        <p class="family-note">${esc(FAMILY_INTRO[v.family].note)}</p>
      </header>`;
  lastFamily = v.family;
  return `${head}
      <article class="panel" data-variant="${v.key}">
        <header class="panel-head">
          <p class="panel-tag">${esc(v.tag)}</p>
          <h3 class="panel-name">${esc(v.name)}</h3>
          <p class="panel-claim">${esc(v.claim)}</p>
          <ul class="spec">${v.specs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </header>
        <div class="stage">
          <figure class="schem-card" id="schem" data-fx="${v.cls}">
            <div class="card schem-face">
              <div class="schem-scroll">
${strandify(scopeSvg(svgSource, v.key), v.strands)}
              </div>
            </div>
          </figure>
        </div>
      </article>`;
}).join('\n');

const html = `<title>Fließende Leitungen</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
/* ── Page chrome. Deliberately NOT the firmware's stylesheet: the bench around the drawing must not
      be mistaken for the drawing. Cool instrument neutrals, Daikin's own cyan as the only accent. ── */
:root {
  --bench:#EEF1F5; --slab:#FFFFFF; --ink:#0F1621; --ink-2:#55637A; --rule:#DCE2EA;
  --accent:#0079BD; --accent-soft:#E4F2FB; --stage:#F7F9FB;
  --fx-sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --fx-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bench:#0B0F15; --slab:#141A23; --ink:#E7ECF3; --ink-2:#93A2B6; --rule:#242D3A;
    --accent:#33ABE8; --accent-soft:#122435; --stage:#0F141C;
  }
}
:root[data-theme="dark"] {
  --bench:#0B0F15; --slab:#141A23; --ink:#E7ECF3; --ink-2:#93A2B6; --rule:#242D3A;
  --accent:#33ABE8; --accent-soft:#122435; --stage:#0F141C;
}
body { background: var(--bench); color: var(--ink); font-family: var(--fx-sans); }
.wrap { max-width: 1060px; margin: 0 auto; padding-inline: 18px; padding-block: 0 56px; }

.masthead { padding-block: 40px 22px; border-bottom: 2px solid var(--ink); }
.eyebrow { margin: 0 0 10px; font-family: var(--fx-mono); font-size: 11.5px; letter-spacing: .14em;
  text-transform: uppercase; color: var(--accent); }
.masthead h1 { margin: 0; font-size: clamp(30px, 6vw, 46px); font-weight: 700; letter-spacing: -.025em;
  line-height: 1.05; text-wrap: balance; }
.lede { margin: 14px 0 0; max-width: 62ch; font-size: 16px; line-height: 1.6; color: var(--ink-2); }

/* The control bar sticks because the panels are tall: the comparison is only worth anything if the
   scenario can be changed while a variant is on screen. */
.controls { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 20;
  background: color-mix(in srgb, var(--bench) 92%, transparent); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule); margin-inline: -18px; padding: 12px 18px;
  display: flex; flex-wrap: wrap; gap: 18px 26px; align-items: center; }
.ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ctl > legend, .ctl-label { font-family: var(--fx-mono); font-size: 11px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-2); padding: 0; }
fieldset.ctl { border: 0; margin: 0; padding: 0; }
.chip { font: 500 13px/1 var(--fx-sans); color: var(--ink); background: var(--slab);
  border: 1px solid var(--rule); border-radius: 999px; padding: 8px 14px; cursor: pointer;
  transition: background .15s, border-color .15s, color .15s; }
.chip:hover { border-color: var(--accent); }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
:root[data-theme="dark"] .chip[aria-pressed="true"],
:root:not([data-theme="light"]) .chip[aria-pressed="true"] { color: #06131D; }
.switch { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer;
  color: var(--ink); }
.switch input { accent-color: var(--accent); width: 16px; height: 16px; }
.chip:focus-visible, .switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.panels { display: flex; flex-direction: column; gap: 34px; padding-block: 30px 0; }
/* A family heading is the page's real structure — the two groups differ in what shipping one costs,
   not in taste — so it gets the weight and the panels below it drop to a third level. */
.family { padding-block: 26px 0; }
.panels > .family:first-child { padding-top: 6px; }
.family-title { margin: 0; font-size: clamp(19px, 3.4vw, 23px); font-weight: 700;
  letter-spacing: -.01em; }
.family-note { margin: 7px 0 0; max-width: 68ch; font-size: 14px; line-height: 1.6;
  color: var(--ink-2); }
/* Not a card: the stage below carries the fill and the border, the header is plain text with a
   rule, so the eye lands on the drawing rather than on five identical boxes. */
.panel-head { border-top: 1px solid var(--rule); padding-top: 16px; }
.panel[data-variant="now"] .panel-head { border-top-color: var(--ink); }
.panel-tag { margin: 0; font-family: var(--fx-mono); font-size: 11.5px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--accent); }
.panel[data-variant="now"] .panel-tag { color: var(--ink-2); }
.panel-name { margin: 4px 0 0; font-size: clamp(20px, 3.6vw, 26px); font-weight: 600;
  letter-spacing: -.02em; }
.panel-claim { margin: 8px 0 0; max-width: 68ch; font-size: 14.5px; line-height: 1.6; color: var(--ink-2); }
.spec { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
.spec li { font-family: var(--fx-mono); font-size: 11.5px; color: var(--ink-2);
  background: var(--accent-soft); border-radius: 5px; padding: 4px 8px; }
.stage { margin-top: 14px; background: var(--stage); border: 1px solid var(--rule);
  border-radius: 14px; padding: 10px; }

/* The drawing scales to the panel by default so the whole plant is in one frame; "Nah am
   Wasserkreis" swaps the viewBox for the water circuit instead of zooming the page. */
.stage .schem-scroll svg { min-width: 0; }
.stage .schem-face { box-shadow: none; border-color: transparent; }
body.zoom .stage .schem-scroll svg { min-width: 0; }

.foot { margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--rule);
  font-size: 13.5px; line-height: 1.65; color: var(--ink-2); max-width: 70ch; }
.foot code { font-family: var(--fx-mono); font-size: 12.5px; }
@media (max-width: 560px) { .controls { gap: 12px 18px; } .chip { padding: 7px 12px; } }
</style>

<style>
/* ── The firmware's own stylesheet, verbatim from main/www/style.css ──────────────────────────── */
${shippedCss}
</style>

<style>
/* ── The candidates, verbatim from tools/uipreview/flow_variants.css ──────────────────────────── */
${variantCss}
</style>

<style>
/* ── Generated: one gradient set per panel, and the firmware palette on an explicit theme stamp ── */
${VARIANTS.map((v) => gradientRulesFor(v.key)).join('\n')}
${themeStamps(shippedCss)}
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Dashboard-Schema · Wasserkreis</p>
    <h1>Sieben Arten, fließendes Wasser zu zeigen</h1>
    <p class="lede">Dieselbe Zeichnung, dieselben Rohre, dieselben Messwerte — nur die Animation der
      Vor- und Rücklaufüberlagerung ist ausgetauscht. Zuerst die drei Lichtbänder, dann die heutige
      Fassung als Referenz, darunter die vier ruhigeren aus der ersten Runde. Szenario wechseln,
      vergleichen, einen Namen nennen.</p>
    <p class="lede">Die Lichtbänder sind für das <strong>dunkle Schema</strong> gebaut: dort
      addieren sich die Stränge, im hellen fallen sie auf gewöhnliche Deckkraft zurück. Der Schalter
      rechts oben wechselt.</p>
  </header>

  <div class="controls">
    <fieldset class="ctl" id="scenarioCtl">
      <legend>Szenario</legend>
    </fieldset>
    <div class="ctl">
      <span class="ctl-label" id="viewLabel">Ansicht</span>
      <button type="button" class="chip" id="zoomBtn" aria-pressed="false">Nah am Wasserkreis</button>
      <label class="switch" for="refrigerantChk">
        <input type="checkbox" id="refrigerantChk">
        Kältemittel mitanimieren
      </label>
      <button type="button" class="chip" id="themeBtn" aria-pressed="false">Dunkel</button>
    </div>
  </div>

  <main class="panels">
${panels}
  </main>

  <footer class="foot">
    <p><strong>Was die vier ruhigeren kosten:</strong> nichts außer CSS. Kein neues SVG-Element,
      keine neue Pfadgeometrie, kein SVG-Filter, und die Farbe kommt unverändert aus
      <code>--flow-hot</code> / <code>--flow-cold</code>.</p>
    <p><strong>Was die drei Lichtbänder kosten:</strong> aus jeder animierten Leitung wird eine
      Gruppe mit vier bis sechs gleichen Pfaden. Der Schema-Audit trägt das — jeder Strang hat
      dasselbe <code>d</code> wie das gezeichnete Rohr und dieselben Enden —, aber es ist eine
      Markup-Änderung an einer stark abgesicherten Datei, und es sind vier bis sechs Striche statt
      einem, mehrere davon unscharf. Dazu kommen neue Farbtöne: die breitesten und hellsten Stränge
      tragen weiter <code>--flow-hot</code> / <code>--flow-cold</code> samt Tausch im Kühlbetrieb und
      neutralem Grau bei reiner Umwälzung, die Akzentstränge aber sind Bernstein/Rosé bzw.
      Cyan/Violett — nicht mehr das farbfehlsichtigkeitsgeprüfte Paar aus DESIGN.md §9. Das ist die
      eine Sache, die man bewusst entscheiden sollte.</p>
    <p>In beiden Familien gilt: bei <code>prefers-reduced-motion</code> steht die Bewegung still und
      der aktive Strang bleibt durch Farbe und Leuchten erkennbar.</p>
    <p>Erzeugt aus <code>main/www/index.html</code> und <code>main/www/style.css</code> —
      <code>node tools/uipreview/build_flow_preview.mjs</code>.</p>
  </footer>
</div>

<script>
const SCENARIOS = ${JSON.stringify(SCENARIOS)};
const ALL_VALUE_IDS = ${JSON.stringify(ALL_VALUE_IDS)};
const STATE_CLASSES = ['pump-on', 'fan-on', 'cooling-mode', 'water-neutral', 'bsh-on'];
const FULL_VIEWBOX = '0 0 790 451';
/* The water circuit alone, in the diagram group's own translated coordinates (it hangs 48 px up):
   the supply run at y=132, the return at y=372, the tank out to x=780. */
const WATER_VIEWBOX = '362 108 428 292';

const figures = [...document.querySelectorAll('.stage .schem-card')];
let scenario = SCENARIOS[0];
let zoom = false;

function paint() {
  for (const fig of figures) {
    fig.className = 'schem-card';
    // no-room / no-spaceh / no-dhw stay OFF: the preview shows a fully equipped plant, which is the
    // case where the most pipe is animated and therefore the hardest one for a variant to carry.
    for (const c of scenario.cls) fig.classList.add(c);
    if (fig.dataset.fx) fig.classList.add(fig.dataset.fx);
    if (document.getElementById('refrigerantChk').checked) fig.classList.add('fx-refrigerant');

    fig.querySelectorAll('.sc-flow, .sc-rflow, .sc-tank-flow, .sc-space-flow, .fx-strands')
       .forEach((el) => el.classList.remove('on', 'rev'));
    for (const id of scenario.on) {
      const el = fig.querySelector('#' + id);
      if (el) el.classList.add('on');
    }
    for (const id of scenario.rev) {
      const el = fig.querySelector('#' + id);
      if (el) el.classList.add('rev');
    }
    for (const id of ALL_VALUE_IDS) {
      const el = fig.querySelector('#' + id);
      if (el) el.textContent = scenario.values[id] ?? '—';
    }
    const dot = fig.querySelector('#svDot');
    if (dot) dot.setAttribute('fill', scenario.values.svDotFill || 'var(--muted)');
    const svg = fig.querySelector('svg');
    if (svg) svg.setAttribute('viewBox', zoom ? WATER_VIEWBOX : FULL_VIEWBOX);
  }
}

const ctl = document.getElementById('scenarioCtl');
for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = s.label;
  b.setAttribute('aria-pressed', String(s === scenario));
  b.addEventListener('click', () => {
    scenario = s;
    ctl.querySelectorAll('.chip').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    paint();
  });
  ctl.append(b);
}

const zoomBtn = document.getElementById('zoomBtn');
zoomBtn.addEventListener('click', () => {
  zoom = !zoom;
  zoomBtn.setAttribute('aria-pressed', String(zoom));
  zoomBtn.textContent = zoom ? 'Ganze Anlage' : 'Nah am Wasserkreis';
  paint();
});
document.getElementById('refrigerantChk').addEventListener('change', paint);

const themeBtn = document.getElementById('themeBtn');
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeBtn.textContent = dark ? 'Hell' : 'Dunkel';
});

paint();
</script>
`;

fs.writeFileSync(outPath, html);
console.log(`build_flow_preview: ${path.relative(root, outPath)} — ${VARIANTS.length} panels, ` +
            `${SCENARIOS.length} scenarios, ${(html.length / 1024).toFixed(0)} KB`);
