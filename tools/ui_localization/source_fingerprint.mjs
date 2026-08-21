// Fingerprint the canonical copy that every shipped locale is translated from. Structural locale
// parity catches added keys; this stamp also catches edited English/domain copy whose positional
// shape did not change. Locale files carry the resulting digest as a review lease: updating the
// marker without reviewing the translation would be equivalent to ticking a stale PR gate.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const BLOCKS = [
  ["main/www/js/i18n.js", "const I18N = {", "\n};"],
  ["main/www/js/descriptions.js", "const DAIKIN_FAULT_CODES = Object.freeze([", "\n]);"],
  ["main/www/js/descriptions.js", "const DESCRIPTIONS = [", "\n];"],
  ["main/www/js/descriptions.js", "const MB_DELTA_WHY = {", "\n};"],
  ["main/www/js/history.js", "const MODEL_DESCRIPTIONS = {", "\n};"],
  ["main/www/js/schematic.js", "const PEL_ESTIMATED_WHAT = {", "\n};"],
  ["main/www/js/schematic.js", "const PEL_MEASURED_WHAT = {", "\n};"],
  ["main/www/js/schematic.js", "const PEL_INSPECT = {", "\n};"],
  ["main/www/js/schematic.js", "const INSPECT = {", "\n};"],
  ["main/www/js/schematic.js", "const HELD_OVER_NOW = {", "\n};"],
];

function sourceBlock(root, [relative, startMarker, endMarker]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`translation source marker missing: ${relative}: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`translation source end missing: ${relative}: ${startMarker}`);
  return `${relative}\n${source.slice(start, end + endMarker.length)}\n`;
}

export function translationSourceFingerprint(root = DEFAULT_ROOT) {
  const canonical = BLOCKS.map((block) => sourceBlock(path.resolve(root), block)).join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.indexOf("--root");
  const root = arg >= 0 ? process.argv[arg + 1] : DEFAULT_ROOT;
  if (!root) throw new Error("--root requires a directory");
  console.log(translationSourceFingerprint(root));
}
