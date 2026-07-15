---
name: project-review
description: Pre-merge project review — check the diff for doc drift (CLAUDE.md ↔ docs ↔ code), memory-safety on HTTP handlers, multi-target build implications, and that new pure logic has host tests. Use before opening/merging a PR.
model: sonnet
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
4. **Target.** Any pin default, sdkconfig, or partition change verified for the esp32s3 target.
5. **Generated data.** Generated `def/*` came from `tools/profiles/` (catalog decode), not hand-edits; and
   value/CRC/converter changes are verified against known-good reference outputs.

Report findings grouped by the above; block on doc drift and untested logic.

## Recording the pass (merge gate — no file marker)

The `require-project-review.sh` PreToolUse hook refuses every PR merge (`gh pr merge` **and**
`mcp__github__merge_pull_request`) until this review is recorded in the PR body as a ticked,
SHA-stamped checkbox whose stamp still matches the PR head. So when the review passes with **no
blocking findings**, tick + stamp the PR's `/project-review` box with the reviewed commit:

```
- [x] `/project-review` clean — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

Edit the PR body with `gh pr edit <pr> --body-file <file>` (or the GitHub MCP update tool in
web/remote). Any later commit changes the head sha and re-stales the box, forcing a fresh review
before the next merge. Don't tick it if findings block the merge — fix first.
