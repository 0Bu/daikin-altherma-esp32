# Device UI JavaScript layout

The device UI is authored as ordered classic-script fragments and still ships as one inline script.
[`../app.sources`](../app.sources) is the single source of ordering for the firmware build, tests,
audits and the GIF recorder. The fragments intentionally share one lexical scope; they are not
separate browser modules and do not create additional HTTP requests.

| Source | Responsibility |
|---|---|
| `i18n.js` | shared browser/API helpers, language selection and the bilingual `I18N` catalog |
| `app_state.js` | application state, hash/history navigation, status rendering, banners and bug reports |
| `dashboard.js` | value/status cards, the observation card, connections and Settings layout |
| `descriptions.js` | Daikin error meanings, value explanations and X10A/HomeHub source semantics |
| `history.js` | device/derived trends, scrubbing, display labels and value-group rendering |
| `schematic.js` | live-value derivation, SVG painting and the schematic inspector |
| `settings.js` | configuration modals, board controls, OTA and reboot/reconnect flows |
| `bootstrap.js` | event wiring, bounded polling and application startup |

Keep declarations in dependency order. When adding or moving a fragment, update only
`app.sources`; CMake watches that manifest and derives all build dependencies from it. Do not add
`import`/`export`: the target is one classic script inside the self-contained page.

Run `node test/test_ui_bundle.mjs` after changing the manifest. It validates every entry and parses
the exact concatenation that the device receives. The semantic UI tests and audits read that same
concatenation through `tools/ui/read_app_source.mjs`.
