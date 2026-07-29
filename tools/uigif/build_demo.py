#!/usr/bin/env python3
"""Build the demo page the dashboard GIF is recorded from: the REAL web UI + a stubbed device.

The splice is the one the firmware build does (main/www/inline_assets.cmake) — style.css and app.js
back into index.html — plus tools/uigif/scenes.js ahead of app.js, so the app boots against a fake
/status + /events instead of a board. Nothing about the UI is re-implemented here: what the GIF
shows is what renderLive() actually drew.

  tools/uigif/build_demo.py <repo-root> <out.html>
"""
import pathlib
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)

root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
here = pathlib.Path(__file__).parent

www = root / "main" / "www"
page = (www / "index.html").read_text()
css = (www / "style.css").read_text()
js = (www / "app.js").read_text()
harness = (here / "scenes.js").read_text()

CSS_MARK = "/*@@INLINE:style.css@@*/\n"
JS_MARK = "//@@INLINE:app.js@@\n"

# Exactly like inline_assets.cmake: a marker missing or doubled would silently record a broken
# page, so it is a hard error rather than a best-effort replace.
for mark in (CSS_MARK, JS_MARK):
    if page.count(mark) != 1:
        sys.exit(f"build_demo: marker {mark!r} appears {page.count(mark)}x in index.html — expected 1")

page = page.replace(CSS_MARK, css)
page = page.replace(JS_MARK, harness + "\n" + js)
out.write_text(page)
print(f"{out} ({len(page)} bytes)")
