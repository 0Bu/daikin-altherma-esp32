// One reader for every host-side consumer of the embedded UI JavaScript. The firmware-side CMake
// assembly reads the same main/www/app.sources manifest, so audits and tests execute the exact
// ordered classic script that the device ships instead of maintaining a second source order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DAIKIN_UI_ROOT
  ? path.resolve(process.env.DAIKIN_UI_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_APP_SOURCE = path.join(ROOT, "main/www/app.sources");
const UI_LOCALE_DIR = path.join(ROOT, "main/www/locales");

function fail(message) {
  throw new Error(`read_app_source: ${message}`);
}

export function appSourceFiles(source = DEFAULT_APP_SOURCE) {
  const manifest = path.resolve(source);
  if (!manifest.endsWith(".sources")) return [manifest];

  let text;
  try { text = fs.readFileSync(manifest, "utf8"); }
  catch (e) { fail(`cannot read ${manifest}: ${e.message}`); }

  const base = path.dirname(manifest);
  const seen = new Set();
  const files = [];
  for (const raw of text.split(/\r?\n/)) {
    const entry = raw.trim();
    if (!entry || entry.startsWith("#")) continue;
    if (path.isAbsolute(entry)) fail(`${manifest}: absolute entry is not allowed: ${entry}`);
    const file = path.resolve(base, entry);
    const relative = path.relative(base, file);
    if (relative.startsWith(".." + path.sep) || relative === "..") {
      fail(`${manifest}: entry escapes its directory: ${entry}`);
    }
    if (path.extname(file) !== ".js") fail(`${manifest}: entry is not a .js file: ${entry}`);
    if (seen.has(file)) fail(`${manifest}: duplicate entry: ${entry}`);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      fail(`${manifest}: missing source file: ${entry}`);
    }
    seen.add(file);
    files.push(file);
  }
  if (files.length === 0) fail(`${manifest}: no JavaScript sources`);
  return files;
}

export function readAppSource(source = DEFAULT_APP_SOURCE) {
  return appSourceFiles(source).map((file) => fs.readFileSync(file, "utf8")).join("");
}

export function readAppFragments(names, source = DEFAULT_APP_SOURCE) {
  if (!Array.isArray(names) || names.length === 0) {
    fail("readAppFragments requires at least one source basename");
  }

  const requested = new Set(names);
  if (requested.size !== names.length) fail("readAppFragments received duplicate names");

  const matched = new Set();
  const files = appSourceFiles(source).filter((file) => {
    const name = path.basename(file);
    if (!requested.has(name)) return false;
    if (matched.has(name)) fail(`ambiguous source basename: ${name}`);
    matched.add(name);
    return true;
  });
  const missing = names.filter((name) => !matched.has(name));
  if (missing.length) fail(`source fragment not found: ${missing.join(", ")}`);

  // Preserve manifest order. This matters whenever multiple classic-script fragments share a
  // lexical scope, and keeps focused tests faithful to the production bundle.
  return files.map((file) => fs.readFileSync(file, "utf8")).join("");
}

// Locale modules are deliberately outside app.sources so they do not consume the dashboard's
// 160 KiB single-response startup budget. Focused host tests can still execute the exact separately
// shipped source rather than copying translations into fixtures.
export function readUiLocale(code) {
  if (!/^[a-z]{2}$/.test(code)) fail(`invalid locale code: ${code}`);
  const file = path.join(UI_LOCALE_DIR, `${code}.js`);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`missing UI locale: ${code}`);
  return fs.readFileSync(file, "utf8");
}
