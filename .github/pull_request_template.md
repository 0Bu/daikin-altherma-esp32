<!--
Fill in each section. Delete checklist lines that don't apply. This template is used by human
authors and by Claude Code — keep it honest: say what was actually verified, and note anything
that couldn't be (a cloud session cannot build or USB-flash — see .claude/CLAUDE.md).
-->

## Summary

<!-- What changed and why, in 1-3 sentences. -->

## Changes

-

## Verification

- [ ] `scripts/run-mock-tests.sh` passes (host-side logic tests — CI's `logic-test` gate)
- [ ] Firmware built (`scripts/idf-docker.sh idf.py build`, or relied on CI) — N/A in a cloud session (no Docker daemon / no USB)
- [ ] Exercised against a real heat pump / device where relevant (or noted why not)

## Checklist

- [ ] Docs kept in sync where behaviour changed (`.claude/CLAUDE.md`, `docs/ARCHITECTURE.md`, `README.md`, `docs/README.md`, `docs/SECURITY.md`)
- [ ] New hardware-free logic lives in `main/logic/` with a `CHECK` in `test/test_logic.cpp` (see the `add-logic-test` skill)
- [ ] Value/CRC/protocol changes match a verified reference; generated `def/*` came from `tools/gen_defs.py` (not hand-edited)
- [ ] Heap-safe — no new large *contiguous* allocations; HTTP handlers stay under the OOM try/catch
- [ ] Target-agnostic — still builds for all four chips (esp32 / esp32s3 / esp32c3 / esp32c6)
- [ ] `/project-review` run clean (doc drift, memory, tests, multi-target)
