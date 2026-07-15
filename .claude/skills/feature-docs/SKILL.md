---
name: feature-docs
description: Keep docs/FEATURES.md (this firmware's technical-feature catalog) in sync when a new platform feature lands — a new ESP-IDF component, an sdkconfig capability, an HTTP/OTA/security/network/diagnostic mechanism, a new logic/ header, or a stub becoming real. Use after implementing or changing a technical feature, before opening the PR.
model: sonnet
---

# feature-docs

[`docs/FEATURES.md`](../../../docs/FEATURES.md) is the cross-cutting catalog of **what this firmware
does** at the platform level (Secure Boot v2 signing, OTA + health gate, WebSocket push, the ESP-IDF
component inventory, diagnostics, WiFi resilience). It is a project-specific record — not a how-to for
other projects. It rots silently: a new component gets linked, a `CONFIG_*` gets flipped, a `🔭` stub
becomes real — and the catalog still describes the old world. This skill closes that gap. It is the
feature-level companion to [`project-review`](../project-review/SKILL.md) (broad pre-merge drift) and
[`doc-drift-checker`](../../agents/doc-drift-checker.md) (CLAUDE.md ↔ deep-dive docs).

**FEATURES.md must never overstate the firmware.** Every `✅`/`🧪` claim points at code that backs
it; anything not fully wired is `🟡`/`🔭` with the TODO named. When in doubt, downgrade the label.

## When to run

After a change whose diff shows any of these — each is a signal a catalog entry must be added,
promoted, or corrected:

| Signal (grep the diff) | Catalog impact |
|------------------------|----------------|
| new entry in `main/CMakeLists.txt` `REQUIRES` or `main/idf_component.yml` | add a row to the **ESP-IDF component inventory** (§11) + a feature section |
| a `CONFIG_*` added/flipped in `sdkconfig.defaults` | new capability (§ relevant) or a footprint-trim row (§10) |
| new `main/logic/*.hpp` header or new `CHECK`s in `test/test_logic.cpp` | update the logic-core list + the **212-checks** count (§8) |
| new `http_register(...)` route / `is_websocket` handler | HTTP/WebSocket feature (§4) + the matrix |
| a `TODO`/stub in `ota_update.cpp` / `mcp_server.cpp` becoming real | promote the status label `🔭`/`🟡` → `✅` (§2, §11, matrix) |
| new `partitions.csv` layout, signing/OTA/rollback change | §1/§2 + cross-check [`SECURITY.md`](../../../docs/SECURITY.md) |
| new MQTT topic / HA entity, heartbeat/crash field | §5/§6 + the entity counts (13 heartbeat, 2 crash) |
| new WiFi/mDNS/DHCP/watchdog behaviour | §3 |

If the diff touches none of these, FEATURES.md probably needs nothing — say so and stop.

## Steps

1. **Diff the surface.** `git diff main...HEAD -- main/ sdkconfig.defaults partitions.csv scripts/ .github/` and
   scan for the signals above. Read the *actual* new code — do not infer a feature from a commit message.
2. **Locate the catalog entry.** Find the matching section **and** the feature-matrix row at the top
   of FEATURES.md. Most features appear in both — update both, plus the ESP-IDF inventory (§11) if a
   component was added.
3. **Write the entry code-verified.** State what the feature does, point at the file with a
   repo-relative markdown link (targets are relative to `docs/`, e.g. `../main/wifi.cpp`), and label
   the status honestly (`✅` shipping / `🧪` host-tested logic / `🟡` partial / `🔭` planned). Copy
   exact numbers from the source — sensor counts, `CHECK` count, partition sizes, `CONFIG_*` names —
   never round or guess.
4. **Promote, don't just append, when a stub goes real.** If `ota_update.cpp`'s download or
   `mcp_server.cpp` graduates from TODO, change the label everywhere it appears (matrix + section +
   inventory) and delete the "planned" wording.
5. **Keep the deep-dive docs authoritative.** FEATURES.md links to [`ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md),
   [`SECURITY.md`](../../../docs/SECURITY.md), etc.; it summarizes, it does not fork their detail. If the
   feature also needs a deep-dive edit, do that there and link — don't duplicate the prose.
6. **Verify.**
   - Links resolve — every `](../…)` target exists (they're relative to `docs/`).
   - `scripts/run-mock-tests.sh` still passes if a `logic/` count changed.
   - No `✅`/`🧪` claim is unbacked; no shipped feature left as `🔭`.
7. **Keep the framing hooks current.** FEATURES.md opens with a status legend and closes with a
   pointer back to this skill — leave both intact.

## Guardrails

- **Verified, not aspirational.** The catalog's value is that a reader can trust it. A `✅` you can't
  point at is worse than an omitted feature.
- **A catalog, not a tutorial.** It records what *this* firmware does and where — it is not a
  copy/paste guide for reusing a feature in another project. Keep entries descriptive, not how-to.
- **Don't rename the file or restructure sections** without reason — other docs, the README and
  [`.claude/CLAUDE.md`](../../CLAUDE.md) may link to `docs/FEATURES.md` and its anchors.
- **The project convention holds:** always write the full name `daikin-altherma-esp32`, and don't name
  other projects in the catalog (the README credit is the sole exception).

## Recording the pass (merge gate — no file marker)

The `require-feature-docs.sh` PreToolUse hook gates every PR merge (`gh pr merge` **and**
`mcp__github__merge_pull_request`), the sibling of the `/project-review` gate. It is **conditional**:
it fires only when the PR changes technical-feature surface (`main/`, `test/`, `sdkconfig.defaults`,
`partitions.csv`, or the CI build workflow). A docs-only / script-only / chore PR is not gated.

When it applies, record the pass — after running this skill and confirming `docs/FEATURES.md` matches
the code — by TICKING and SHA-STAMPING the PR's `/feature-docs` box with the reviewed commit:

```
- [x] `/feature-docs` synced — merge gate @ <short-sha>    # <short-sha> = git rev-parse --short=12 HEAD
```

The gate allows the merge only while that box is checked AND its stamp still matches the PR head, so
any later commit re-stales it and forces a fresh run. Edit the PR body with
`gh pr edit <pr> --body-file <file>` (or the GitHub MCP update tool in web/remote). If the skill
concludes no catalog change was needed (§*When to run* → "nothing"), the docs are already in sync —
still tick + stamp the box to record that you checked. Don't tick it if FEATURES.md is out of date —
fix it first. The gate fails **closed**: if GitHub can't be read, the merge is blocked with guidance.
