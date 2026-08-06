# Vendored web minifiers

These two pure-Python modules are used only while building the embedded dashboard:

- `rjsmin.py` 1.2.4
- `rcssmin.py` 1.2.1

Both are Copyright 2011-2025 André Malo or his licensors and licensed under Apache-2.0; see
`LICENSE`.  They are vendored so the pinned ESP-IDF container can build offline without Node or
runtime package installation.  The modules first try their optional C extensions and automatically
use their included Python implementations when those extensions are absent.
