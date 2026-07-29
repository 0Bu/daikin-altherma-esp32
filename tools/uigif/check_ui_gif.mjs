#!/usr/bin/env node
// ── Is the README's dashboard GIF still a picture of THIS UI? ────────────────────────────────────
//
// docs/media/dashboard.gif is the first thing a new user sees, and it is the one artefact here that
// rots INVISIBLY: it is a recording, so it keeps rendering perfectly long after the thing it
// recorded has changed. Nothing else can catch that. The schematic audit checks the drawing, the
// description audit checks the copy, the domain audit checks the values — all three stay green
// while the picture in the README shows last month's pipes, a pill that has since moved, or a
// component that no longer exists. A screenshot cannot fail a test; it can only be out of date.
//
// Re-rendering it here is not an option: CI has no browser (the recorder needs Chrome + ffmpeg —
// scripts/record-dashboard-gif.sh). So this gate compares a STAMP instead. It fingerprints exactly
// the sources the recording depends on — the schematic markup, the CSS that draws and animates it,
// the app.js functions that paint it, the strings it prints, the scenes it shows and the recorder's
// own framing — and fails when that fingerprint no longer matches the one recorded beside the GIF.
//
// What it therefore does NOT claim: that the GIF looks good, that the scenes are still the right
// four, or that a number in it is physically true. That is the /ui-gif skill's half, and the
// domain/schematic gates'. This one answers one question — was this GIF made from these sources.
//
// Usage:  node tools/uigif/check_ui_gif.mjs [--write-stamp] [-v]
// Exit:   0 = current, 1 = findings, 2 = usage / the fingerprint could not be taken (vacuity).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (rel) => resolve(ROOT, rel);

const GIF = "docs/media/dashboard.gif";
const STAMP = "tools/uigif/gif_stamp.txt";
const README = "README.md";

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write-stamp");
const VERBOSE = argv.includes("-v") || argv.includes("--verbose");
for (const a of argv) {
  if (!["--write-stamp", "-v", "--verbose"].includes(a)) {
    console.error(`check_ui_gif: unknown argument ${a}`);
    process.exit(2);
  }
}

const die = (msg) => { console.error(`check_ui_gif: ${msg}`); process.exit(2); };
const sha = (s) => createHash("sha256").update(s).digest("hex");
const read = (rel) => { try { return readFileSync(P(rel), "utf8"); } catch { die(`cannot read ${rel}`); } };

// ── 1. The sources the recording depends on ─────────────────────────────────────────────────────
// Deliberately NOT "all of main/www": a settings-modal edit cannot change a frame, and a gate that
// fires on changes it knows are irrelevant is a gate people learn to re-stamp without looking.

// The GIF's crop is the dashboard header line + the schematic card, so both blocks count.
function block(html, openRe, tag, what) {
  const m = openRe.exec(html);
  if (!m) die(`${what}: ${openRe} matches nothing in main/www/index.html — the recording's frame has moved`);
  const start = m.index;
  let i = start, depth = 0;
  const re = new RegExp(`</?${tag}\\b`, "g");
  re.lastIndex = start;
  for (let m; (m = re.exec(html)); ) {
    depth += m[0][1] === "/" ? -1 : 1;
    i = m.index + m[0].length;
    if (depth === 0) return html.slice(start, html.indexOf(">", i) + 1);
  }
  die(`${what}: <${tag}> is never closed`);
}

// A tiny CSS reader: every rule, at any nesting depth, with its at-rule context. Enough to select
// the rules that reach the drawing without pulling in the rest of a 41 kB stylesheet.
function* cssRules(css, prefix = "") {
  let i = 0, sel = "";
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") { i = css.indexOf("*/", i) + 2 || css.length; continue; }
    if (c === "{") {
      let depth = 1, j = i + 1;
      while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
      const body = css.slice(i + 1, j - 1);
      const s = (prefix + sel).trim().replace(/\s+/g, " ");
      if (/^@(media|supports|layer|container)/.test(sel.trim())) yield* cssRules(body, s + " ");
      else yield { sel: s, body: body.trim().replace(/\s+/g, " ") };
      sel = ""; i = j; continue;
    }
    if (c === ";") { sel = ""; i++; continue; }   // @import / @charset
    sel += c; i++;
  }
}

// Selectors whose rules are visible in the recorded crop.
const SEL_VISIBLE = [
  /(^|[\s,>~+(])#schem\b/, /\.sc-/, /#sc[A-Z]/,
  /^@keyframes\s+(dashfwd|rdashfwd|rdashrev|spin)\b/,
  /(^|[\s,])(:root|body|header|\.card|\.pad|\.view)\b/,
  /(^|[\s,])(#hdrIp|#verLink|\.hdr|\.brand|\.logo)/,
];
// If any of these stops matching, the extractor has gone blind rather than the CSS gone quiet —
// the "clean" that follows would be a lie, so it is exit 2, not a pass.
const SEL_REQUIRED = [/\.sc-flow/, /#scFan/, /^:root/, /^@keyframes\s+dashfwd/];

function schematicCss(css) {
  const kept = [];
  for (const r of cssRules(css)) if (SEL_VISIBLE.some((re) => re.test(r.sel))) kept.push(`${r.sel}{${r.body}}`);
  if (kept.length < 20) die(`only ${kept.length} schematic CSS rules found — the stylesheet's shape changed`);
  for (const re of SEL_REQUIRED) {
    if (!kept.some((r) => re.test(r))) die(`no CSS rule matches ${re} — the drawing's own styles are no longer being read`);
  }
  return kept.sort().join("\n");
}

// The app.js functions that PAINT the frames. A rename must stop the gate loudly: silently
// fingerprinting nothing is how a checker starts passing everything.
const FNS = ["renderApp", "renderLive", "clearSchematic", "liveData", "plantState", "sysSet",
             "vLwt", "renderHeaderMeta", "fmt0", "fmt1"];

function fnSource(js, name) {
  const re = new RegExp(`^(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=)`, "m");
  const m = re.exec(js);
  if (!m) die(`app.js has no ${name}() — the function that draws the recording was renamed or removed`);
  const start = m.index;
  const open = js.indexOf("{", start);
  const arrowEnd = js.indexOf("\n", start);
  // const f = (x) => expr;  — a one-liner with no block body.
  if (open === -1 || (arrowEnd !== -1 && arrowEnd < open)) return js.slice(start, arrowEnd);
  let depth = 0, i = open;
  for (; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}" && --depth === 0) return js.slice(start, i + 1);
  }
  die(`${name}() is never closed`);
}

// The words the frames print. Full dicts would drag in every settings string; the keys the drawing
// itself declares are exactly the visible ones.
function i18nForFigure(figure, js) {
  const keys = [...new Set([...figure.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]))].sort();
  if (!keys.length) die("the schematic declares no data-i18n keys — its markup no longer looks the way this reads it");
  const lines = [];
  for (const k of keys) {
    const hits = [...js.matchAll(new RegExp(`"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:.*`, "g"))].map((m) => m[0].trim());
    lines.push(`${k} => ${hits.join(" | ")}`);
  }
  return lines.join("\n");
}

const html = read("main/www/index.html");
const css = read("main/www/style.css");
const js = read("main/www/app.js");

const figure = block(html, /<figure\b[^>]*\bid="schem"/, "figure", "schematic card");
const header = block(html, /<header\b[^>]*\bid="hdrDash"/, "header", "dashboard header");

const parts = {
  "schematic markup": figure,
  "header markup": header,
  "schematic css": schematicCss(css),
  "painting code": FNS.map((n) => fnSource(js, n)).join("\n"),
  "drawing strings": i18nForFigure(figure, js),
  "scenes": read("tools/uigif/scenes.js"),
  "framing": read("scripts/record-dashboard-gif.sh"),
};
const fingerprint = sha(Object.entries(parts).map(([k, v]) => `${k}\n${sha(v)}`).join("\n"));

// ── 2. The artefact itself ──────────────────────────────────────────────────────────────────────
// A GIF that is technically present but has one frame, or crawls at 2 s per frame, fails the thing
// it was asked for: the water and gas flow has to be VISIBLE as motion.
function readGif(buf) {
  if (buf.length < 14 || buf.toString("latin1", 0, 3) !== "GIF") return { err: "not a GIF" };
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  let i = 13 + (buf[10] & 0x80 ? 3 * (1 << ((buf[10] & 7) + 1)) : 0);
  const skipSub = () => { while (i < buf.length && buf[i]) i += buf[i] + 1; i++; };
  const delays = [];
  let frames = 0, pendingDelay = null;
  while (i < buf.length) {
    const b = buf[i++];
    if (b === 0x3b) break;                                   // trailer
    if (b === 0x21) {                                        // extension
      const label = buf[i++];
      if (label === 0xf9 && buf[i] === 4) pendingDelay = buf.readUInt16LE(i + 2);
      skipSub();
    } else if (b === 0x2c) {                                 // image descriptor
      const flags = buf[i + 8];
      i += 9 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
      i++;                                                   // LZW minimum code size
      skipSub();
      frames++;
      delays.push(pendingDelay ?? 0);
      pendingDelay = null;
    } else return { err: `unknown block 0x${b.toString(16)} at ${i - 1}` };
  }
  return { w, h, frames, delays };
}

const findings = [];
const add = (code, msg, fix) => findings.push({ code, msg, fix });

let gifInfo = null, gifSha = null;
if (!existsSync(P(GIF))) {
  add("U003", `${GIF} is missing — the README links a picture that is not there`,
      "scripts/record-dashboard-gif.sh");
} else {
  const buf = readFileSync(P(GIF));
  gifSha = createHash("sha256").update(buf).digest("hex");
  gifInfo = readGif(buf);
  if (gifInfo.err) add("U004", `${GIF}: ${gifInfo.err}`, "scripts/record-dashboard-gif.sh");
  else {
    if (gifInfo.frames < 2) {
      add("U004", `${GIF} has ${gifInfo.frames} frame(s) — a still, not a recording: the flow, the fan and the pump cannot be seen moving`,
          "scripts/record-dashboard-gif.sh");
    }
    const slow = gifInfo.delays.filter((d) => d > 20);        // 1/100 s units
    if (gifInfo.frames >= 2 && slow.length) {
      add("U004", `${GIF} holds ${slow.length} frame(s) for over 200 ms — that reads as a slideshow, not as flow`,
          "lower STEP_MS in scripts/record-dashboard-gif.sh and re-record");
    }
  }
}

const readme = read(README);
if (!readme.includes(`(${GIF})`)) {
  add("U003", `${README} does not embed ${GIF} — the recording is maintained for a page that no longer shows it`,
      `add ![…](${GIF}) back, or delete the GIF and this gate`);
}

// ── 3. Compare with the stamp ───────────────────────────────────────────────────────────────────
const stampText = existsSync(P(STAMP)) ? readFileSync(P(STAMP), "utf8") : "";
const stamp = Object.fromEntries(
  stampText.split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const k = l.indexOf("="); return [l.slice(0, k).trim(), l.slice(k + 1).trim()]; }));

if (WRITE) {
  const now = new Date().toISOString().slice(0, 10);
  writeFileSync(P(STAMP), [
    "# Recorded by scripts/record-dashboard-gif.sh — do not hand-edit.",
    "#",
    "# ui = a fingerprint of the sources docs/media/dashboard.gif was recorded FROM (the schematic",
    "#      markup and header, the CSS that draws and animates them, the app.js functions that paint",
    "#      them, the strings they print, the scenes, and this recorder's own framing).",
    "# gif = the sha256 of the recording itself, so a hand-edited or re-compressed GIF is caught too.",
    "#",
    "# tools/uigif/check_ui_gif.mjs fails when the UI has moved on and the recording has not. The fix",
    "# is to RE-RECORD (that is what the stamp is for), never to edit this file.",
    `ui=${fingerprint}`,
    // Per-source hashes so a failure can NAME what moved — "the schematic markup changed" sends
    // you to the right file; "the fingerprint differs" sends you to re-stamp without looking.
    ...Object.entries(parts).map(([k, v]) => `part.${k.replace(/\s+/g, "_")}=${sha(v)}`),
    `gif=${gifSha ?? ""}`,
    `frames=${gifInfo?.frames ?? 0}`,
    `size=${gifInfo ? `${gifInfo.w}x${gifInfo.h}` : ""}`,
    `recorded=${now}`,
    "",
  ].join("\n"));
  console.log(`check_ui_gif: stamped ui=${fingerprint.slice(0, 12)}… gif=${(gifSha ?? "").slice(0, 12)}… ` +
              `(${gifInfo?.frames ?? 0} frames, ${gifInfo ? `${gifInfo.w}x${gifInfo.h}` : "?"})`);
  process.exit(findings.length ? 1 : 0);
}

if (!stamp.ui) {
  add("U005", `${STAMP} is missing or carries no fingerprint — nothing says which UI this GIF is of`,
      "scripts/record-dashboard-gif.sh");
} else if (stamp.ui !== fingerprint) {
  const changed = Object.entries(parts)
    .filter(([k, v]) => { const was = stamp[`part.${k.replace(/\s+/g, "_")}`]; return was && was !== sha(v); })
    .map(([k]) => k);
  add("U001",
      "the dashboard UI has changed since the GIF was recorded — the README shows an older drawing" +
      (changed.length ? `: ${changed.join(", ")}` : ""),
      "scripts/record-dashboard-gif.sh");
}
if (stamp.gif && gifSha && stamp.gif !== gifSha) {
  add("U002", `${GIF} is not the file that was stamped — it was replaced or re-compressed outside the recorder`,
      "scripts/record-dashboard-gif.sh");
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────
if (VERBOSE) {
  console.log("sources fingerprinted:");
  for (const [k, v] of Object.entries(parts)) console.log(`  ${sha(v).slice(0, 12)}  ${k} (${v.length} B)`);
  if (gifInfo && !gifInfo.err) {
    const d = gifInfo.delays;
    console.log(`gif: ${gifInfo.w}x${gifInfo.h}, ${gifInfo.frames} frames, ` +
                `delay ${Math.min(...d) * 10}-${Math.max(...d) * 10} ms, ${(d.reduce((a, x) => a + x, 0) / 100).toFixed(2)} s total`);
  }
  console.log(`ui=${fingerprint}`);
}

if (!findings.length) {
  console.log(`check_ui_gif: ${GIF} is current with the UI ` +
              `(${gifInfo?.frames ?? 0} frames, ${gifInfo ? `${gifInfo.w}x${gifInfo.h}` : "?"}, stamped ${stamp.recorded ?? "?"})`);
  process.exit(0);
}
console.log(`check_ui_gif: ${findings.length} finding(s)\n`);
for (const f of findings) console.log(`  ${f.code}  ${f.msg}\n        fix: ${f.fix}\n`);
console.log("The GIF is the first thing a new user sees. Re-record it, then LOOK at it —");
console.log("this gate proves it is current, never that it is right.");
process.exit(1);
