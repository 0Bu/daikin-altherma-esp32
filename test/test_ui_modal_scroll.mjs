// Mobile modal layout contract. iOS Safari's legacy 100vh includes browser chrome, so a long card
// can extend below the visible viewport and hand the gesture to the document behind it. Pin the
// dynamic-viewport sizing and the card-owned momentum/overscroll behavior that prevent that.
import assert from "node:assert/strict";
import fs from "node:fs";

const style = fs.readFileSync(new URL("../main/www/style.css", import.meta.url), "utf8");

assert.match(style, /html\.modal-open, body\.modal-open \{[^}]*overflow: hidden;[^}]*overscroll-behavior: none;/,
  "an open modal must disable both possible document scrollers");
assert.match(style, /\.modal \{[^}]*grid-template-rows: minmax\(0, 1fr\);[^}]*overflow: hidden;[^}]*height: 100vh; height: 100dvh;/s,
  "the overlay must use the visible dynamic viewport with a legacy fallback");
assert.match(style, /\.modal-card \{[^}]*min-height: 0;[^}]*max-height: 100%;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*-webkit-overflow-scrolling: touch;/s,
  "the dialog card must own touch scrolling without chaining it to the page");
assert.doesNotMatch(style, /\.modal-card \{[^}]*max-height:\s*calc\(100vh/s,
  "a card must not size itself from Safari's browser-chrome-inclusive 100vh");

console.log("mobile modal scroll contract passed");
