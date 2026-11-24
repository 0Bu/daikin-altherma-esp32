# Web UI & Dashboard Invariants

1. **Zero External Dependencies (Zero-CDN)**: All HTML, CSS, JavaScript, icons, and inline SVG assets must be self-contained in the firmware image. Sources are separate files under `main/www/`: `inline_assets.cmake` combines `style.css` and the JavaScript fragments in `app.sources` into intermediate HTML. The asset pipeline minifies the page, packs its startup script and its baseline English dictionary, packs its startup script with the pure-TypedArray LZMA1 decoder, and gzips the served dashboard. The `locales/*.js` sources are packed into five lossless on-device locale packs (`de` plain gzipped plus four cognate packs); `setup.html` and `mcp_dashboard.*` remain separate assets (`main/CMakeLists.txt`). No external fonts, scripts, CDNs, or remote stylesheets.
2. **Localization Copy Parity**: Every user-visible string, tooltip, label, and diagnosis must have complete translations across all 13 supported locales (`en`, `de`, `es`, `fr`, `it`, `pl`, `cs`, `uk`, `zh`, `ja`, `nb`, `sv`, `fi`) in the `i18n` dictionary and locale catalogs. Run `scripts/run-ui-localization-audit.sh`.
3. **Inline SVG Schematic Contract**: The dashboard schematic elements, status pills, pipe animation classes, and DOM IDs must strictly adhere to the schematic contract. Run `scripts/run-schematic-audit.sh`.
4. **Deterministic UI Verification**: Any changes to `main/www/` must pass:
   - `scripts/run-schematic-audit.sh`
   - `scripts/run-ui-localization-audit.sh`
   - `scripts/run-ui-use-case-tests.sh`
   - `scripts/run-browser-render-tests.sh`
