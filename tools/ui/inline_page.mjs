// Host-side twin of main/www/inline_assets.cmake: splice the stylesheet and the script into their
// marker lines of a page shell exactly as the firmware build does. CMake's string(REPLACE) copies
// the asset bytes literally. String.prototype.replace(string, string) does not: its replacement
// argument expands $$, $&, $` and $', so a template literal such as `${a}$${b}` would reach
// a host-rendered page with one dollar sign fewer than the device serves. Every host assembler that
// claims to reproduce the shipped page goes through this one literal splice.

export const CSS_MARKER = "/*@@INLINE:style.css@@*/\n";
export const JS_MARKER = "//@@INLINE:app.js@@\n";

const ASSETS = [
  { key: "css", marker: CSS_MARKER, label: "CSS" },
  { key: "js", marker: JS_MARKER, label: "JavaScript" },
];

function fail(message) {
  throw new Error(`inline_page: ${message}`);
}

// Returns the page with both markers replaced by the literal asset text. Fails closed on the same
// conditions as inline_assets.cmake: a marker missing or repeated in the shell, or marker text
// inside either asset (which would make the result depend on splice order).
export function spliceInlineAssets(page, { css, js }) {
  const content = { css, js };
  for (const { key, label } of ASSETS) {
    if (typeof content[key] !== "string") fail(`${label} asset must be a string`);
  }
  for (const { key, label } of ASSETS) {
    for (const { marker } of ASSETS) {
      if (content[key].includes(marker.trimEnd())) {
        fail(`${label} asset contains reserved marker ${marker.trimEnd()}`);
      }
    }
  }
  let out = page;
  for (const { key, marker, label } of ASSETS) {
    const first = out.indexOf(marker);
    if (first < 0) fail(`${label} inline marker not found`);
    if (out.indexOf(marker, first + marker.length) !== -1) fail(`${label} inline marker appears more than once`);
    out = out.slice(0, first) + content[key] + out.slice(first + marker.length);
  }
  return out;
}
