// Narrow-viewport row contract: a label and its reading STACK rather than squeeze.
//
// Every row in this UI is one pair — the name of a thing on the left, what it currently reads on
// the right — and the reading is `nowrap`, because breaking "46.3 °C" over two lines reads as two
// numbers. A `nowrap` flex item cannot give ground, so on a phone whatever the row is short of comes
// out of the NAME, and it comes out all at once: an item with `min-width: 0` shrinks to nothing
// before anything else yields. Measured at 320 px in German, that shipped as
// "SMART-GRID-ANFORDERUNG ÜBER MODBUS" six words deep in a 110 px column beside "Freier Betrieb";
// as an inspector source line set ONE CHARACTER PER LINE, sixteen lines tall, with the title printed
// over the reading; and as a value row whose chevron pushed the whole page 11 px wider than the
// phone, giving the dashboard a horizontal scrollbar.
//
// CI has no browser, so this pins the RULES rather than the rendering — the same instrument
// test_ui_modal_scroll.mjs uses for the iOS dynamic-viewport contract, and for the same reason.
// The break rule differs per row ON PURPOSE, which is what these assertions are really protecting:
// a single rule for all three would be wrong for two of them (docs/DESIGN.md §9).
import assert from "node:assert/strict";
import fs from "node:fs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");

// ── The schematic inspector's head: title + headline reading ────────────────────────────────────
// `flex-basis: auto` is the break rule: an item's hypothetical size is its own max-content width, so
// the line breaks exactly when the title can no longer sit beside the reading, and never earlier.
// A share would be wrong here — the title IS the thing being read, and a fixed share would either
// stack short pairs ("COP" · "3.0") or keep crushing long ones.
assert.match(style, /\.inspect-head \{[^}]*flex-wrap: wrap;/s,
  "the inspector's title and reading must be able to stack");
assert.match(style, /\.inspect-title \{ flex: 1 1 auto; min-width: 0;/,
  "the inspector title must break on its own content width, not on a fixed share");
assert.match(style, /\.inspect-now \{ flex: 0 0 auto;/,
  "the headline reading must not shrink — it is nowrap, so shrinking only overflows it");
// The mono source line is the catalog's longest string, so it must not share a line with a 19 px
// reading at all. Its own block, under the head — which is also DESIGN.md §5.3's stated order.
assert.match(style, /\.inspect-head \{[\s\S]*?\}\s*\.inspect-title \{[\s\S]*?\}[\s\S]*?\.inspect-src \{/,
  "the source line must sit outside the title/reading pair");
// The close button leaves the flex line for the card corner; in the line it would have wrapped along
// with the reading, and at 320 px it reached 10 px past the viewport.
assert.match(style, /\.inspect-x \{\s*position: absolute;/,
  "the inspector's close button must not be a flex item of the wrapping pair");
assert.match(style, /\.inspect-head \{[^}]*padding-right:/s,
  "the head must reserve the corner the close button was moved into");
assert.match(style, /\.inspect-x::before \{[^}]*inset:/,
  "a 12 px glyph needs a thumb-sized hit area behind it");

// ── Value rows: label + reading (+ chevron) ─────────────────────────────────────────────────────
// A SHARE, deliberately not `auto`: a content-sized basis would send every long catalog label's
// reading to a second line ("Leaving water temp. before BUH (R1T)" is wider than a 320 px card on
// its own) and double the height of a list whose two-line labels read perfectly well.
assert.match(style, /\.vrow \{[^}]*flex-wrap: wrap;/s,
  "a value row must be able to stack its reading under its label");
assert.match(style, /\.vrow > \.vrow-label \{ flex: 1 1 (\d\d)%; min-width: 0; \}/,
  "the label must keep a stated share of the row before the reading drops below it");
const share = Number(style.match(/\.vrow > \.vrow-label \{ flex: 1 1 (\d\d)%/)[1]);
assert.ok(share >= 45 && share <= 65,
  `the label share (${share}%) must leave the reading a usable column without stacking ordinary ones`);
assert.match(style,
  /\.vrow \.chan-sel, \.vrow \.lang-sel, \.vrow \.diagnostics-sel \{[^}]*min-width:\s*124px;[^}]*max-width:\s*60%;/,
  "all Firmware selectors must remain compact beside their labels instead of filling a second line");

// ── Both, plus the split Settings rows: a dropped reading stays in its own column ───────────────
// `space-between` flushes a lone item to the LEFT — under the name, where a reading reads as a
// second label. Every wrapping row therefore pushes its reading right with an auto margin.
for (const [sel, what] of [
  [/\.vrow > \.vrow-val, \.vrow > \.vrow-end \{ margin-left: auto;/, "a value row's reading"],
  [/\.settings-split-action \{[^}]*margin-left: auto;/s, "a split Settings row's value"],
  [/\.settings-info-value \{[^}]*margin-left: auto;/, "a Settings info row's value"],
]) assert.match(style, sel, `${what} must stay right-aligned once it drops to its own line`);

console.log("narrow-row contract: label and reading stack instead of squeezing");
