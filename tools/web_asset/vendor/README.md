# Vendored web minifiers

These two pure-Python modules are used only while building the embedded dashboard:

- `rjsmin.py` 1.2.4
- `rcssmin.py` 1.2.1

Both are Copyright 2011-2025 André Malo or his licensors and licensed under Apache-2.0; see
`LICENSE`.  They are vendored so the pinned ESP-IDF container can build offline without Node or
runtime package installation.  The modules first try their optional C extensions and automatically
use their included Python implementations when those extensions are absent.

## Asset gzip encoder

`zopfli/` contains the unmodified gzip-only C sources and Apache-2.0 `COPYING` from
[Google Zopfli 1.0.3](https://github.com/google/zopfli/tree/bd64b2f0553d4f1ef4e6627647c5d9fc8c71ffc0),
tag `zopfli-1.0.3`, commit `bd64b2f0553d4f1ef4e6627647c5d9fc8c71ffc0`.
`UPSTREAM.json` records the source archive and individual file hashes. PNG code, the upstream CLI,
the zlib container and the unused library dispatcher are omitted. No generated binaries are vendored.

The firmware build selects Zopfli with five iterations for `index.html.gz` and all twelve locale
catalogs. The Python adapter compiles its
small stdin/stdout helper using native `cc` (`HOST_CC` can name another native compiler), with no
package installation or network access. It caches the executable in a private temporary directory
keyed by source/adapter hashes, compiler identity, options and platform. `WEB_ASSET_CACHE_DIR` can
select another private, user-owned cache directory. Concurrent compilation publishes atomically.
The emitted gzip has zero timestamp, no filename, OS byte 255 and a verified exact decode. Setup
and MCP retain zlib. The standalone locale helper also defaults to zlib and needs no native compiler
unless `--gzip-encoder zopfli` is selected.
