#!/usr/bin/env python3
"""Build the demo page the dashboard GIF is recorded from: the REAL web UI + a stubbed device.

The splice is the one the firmware build does (main/www/inline_assets.cmake) — style.css and the
ordered app.sources fragments back into index.html — plus tools/uigif/scenes.js ahead of the app,
so the app boots against a fake /status + /values instead of a board. Nothing about the UI is
re-implemented here: what the GIF shows is what renderLive() actually drew.

  tools/uigif/build_demo.py <repo-root> <out.html>
"""
import pathlib
import shutil
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)

root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
here = pathlib.Path(__file__).parent

www = root / "main" / "www"
page = (www / "index.html").read_text()
css = (www / "style.css").read_text()
manifest = www / "app.sources"
entries = []
for raw in manifest.read_text().splitlines():
    entry = raw.strip()
    if not entry or entry.startswith("#"):
        continue
    candidate = (www / entry).resolve()
    try:
        candidate.relative_to(www.resolve())
    except ValueError:
        sys.exit(f"build_demo: app.sources entry escapes main/www: {entry!r}")
    if candidate.suffix != ".js" or not candidate.is_file():
        sys.exit(f"build_demo: invalid app.sources entry: {entry!r}")
    if candidate in entries:
        sys.exit(f"build_demo: duplicate app.sources entry: {entry!r}")
    entries.append(candidate)
if not entries:
    sys.exit("build_demo: app.sources contains no JavaScript sources")
js = "".join(source.read_text() for source in entries)
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
# The dashboard header's brand mark is an embedded firmware asset rather than an inline SVG.
# Keep the local recording page faithful too: its absolute URL resolves at the demo server root.
brand_icon = www / "heat_pump_icon.png"
if not brand_icon.is_file():
    sys.exit("build_demo: missing main/www/heat_pump_icon.png")
# The firmware route is hyphenated even though the source asset filename uses underscores.
# Copy to the URL basename the real index requests; otherwise Chrome records a broken-image icon.
shutil.copyfile(brand_icon, out.parent / "heat-pump-icon.png")
print(f"{out} ({len(page)} bytes)")
