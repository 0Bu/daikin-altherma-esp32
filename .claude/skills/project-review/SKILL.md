---
name: project-review
description: Pre-merge project review — check the diff for doc drift (CLAUDE.md ↔ docs ↔ code), memory-safety on HTTP handlers, multi-target build implications, and that new pure logic has host tests. Use before opening/merging a PR.
---

# project-review

A holistic pass before a PR merges. Not a linter — it checks the things that rot silently.

## Checklist

1. **Doc drift.** If the diff changed the component map, NVS keys, the HTTP API, the config
   model, or the poll/OTA/MQTT behaviour, are `.claude/CLAUDE.md`, `docs/README.md` and
   `docs/ARCHITECTURE.md` updated to match? They must not disagree with the code.
2. **Memory safety.** New HTTP handlers run under the OOM discipline (try/catch → 503, no big
   contiguous `std::string`, stream large output). New large allocations (JSON, TLS) size-checked.
3. **Host tests.** New pure logic is in `main/logic/` with a `CHECK` in `test/test_logic.cpp`,
   and `scripts/run-mock-tests.sh` passes. No decode/config logic buried in a device-only `.cpp`.
4. **Multi-target.** Any pin default, sdkconfig, or partition change considered for all four
   targets (esp32/s3/c3/c6). The classic esp32 uses UART0 console + needs ECO3 for signed OTA.
5. **Provenance.** Protocol/value changes match ESPAltherma; scaffolding changes match the
   tesla-key-esp32 pattern. Generated `def/*` came from `tools/gen_defs.py`, not hand-edits.

Report findings grouped by the above; block on doc drift and untested logic.
